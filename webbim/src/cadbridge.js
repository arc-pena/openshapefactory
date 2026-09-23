//! The building as parametric-CAD nodes, and back.
//!
//! Web BIM has a second interface: the OpenCascade/OCAF modeller, carried in
//! the page and switched to with one button. It is not a second model. The BIM
//! document stays the truth; this file writes it out as the modeller's own
//! nodes (a folder per element, holding the element's parameters as Number and
//! Point nodes and its body as sketches pulled into solids), reads edits to
//! those parameters back as ordinary BIM ops, and works out the smallest set of
//! modeller edits that brings its copy up to date after the building changes.
//!
//! Everything it writes has an id starting "B_". Anything else in the
//! modeller's document is the modeller's own, and is carried through untouched.

import { F, CATALOGUE } from "./ocaf.js";
import { elementParts } from "./solids.js";

const PREFIX = "B_";
const sid = id => String(id).replace(/[^A-Za-z0-9]/g, "_");
const COLOURS = { Wall: [0.80, 0.62, 0.52], Column: [0.62, 0.63, 0.66], Door: [0.55, 0.40, 0.26], Window: [0.55, 0.75, 0.90],
  Floor: [0.72, 0.72, 0.70], Beam: [0.50, 0.55, 0.62], Generic: [0.70, 0.66, 0.60] };
const SUB_COLOURS = { Glass: [0.62, 0.82, 0.95], Frame: [0.93, 0.93, 0.92], Handle: [0.75, 0.75, 0.78], Panel: [0.62, 0.45, 0.30] };
export const CAD_TYPES = ["Wall", "Column", "Door", "Window", "Floor", "Beam", "Generic"];
const cround = v => Math.round(v * 1000) / 1000;

/** The document written as a modeller file, and the table of which nodes are parameters of what. */
export function bimToCad(doc) {
  const features = [], params = new Map();
  const put = (id, type, name, args, parent, extra = {}) => { features.push(Object.assign({ id, type, name, parent: parent || undefined, args }, extra)); return id; };
  const root = put(PREFIX + "ROOT", "GeometricalSet", doc.meta.name || "Web BIM", { inputs: "", shell: "Open" }, null);
  const datums = put(PREFIX + "DATUMS", "GeometricalSet", "Datums (from Web BIM)", { inputs: "", shell: "Open" }, root);
  put(PREFIX + "VZ", "Vector", "Up", { dx: 0, dy: 0, dz: 1 }, datums);
  const planes = new Map();
  //! One plane per height, shared: two hundred wall pieces standing on one floor are one plane.
  const planeAt = z => {
    const k = cround(z); if (planes.has(k)) return planes.get(k);
    const tag = String(k).replace(/[^0-9]/g, m => m === "-" ? "m" : "_");
    const pt = put(PREFIX + "PZ" + tag, "Point", `z ${k}`, { x: 0, y: 0, z: k }, datums);
    const pl = put(PREFIX + "PL" + tag, "Plane", `Plane z ${k}`, { origin: { ref: pt }, normal: { ref: PREFIX + "VZ" }, size: 1000 }, datums);
    planes.set(k, pl); return pl;
  };
  const levelSets = new Map();
  const levelSet = f => {
    const lv = F.reference(f, "baseLevel") || F.reference(f, "level") || null;
    const key = lv ? doc.idOf(lv) : "none";
    if (!levelSets.has(key)) levelSets.set(key, put(PREFIX + "LV_" + sid(key), "GeometricalSet", lv ? `Level: ${F.text(lv, "name")}` : "Not on a level", { inputs: "", shell: "Open" }, root));
    return levelSets.get(key);
  };
  for (const f of doc.elements()) {
    const t = doc.typeOf(f); if (!CAD_TYPES.includes(t) || f.get("Integer") === 0 || doc.error(f)) continue;
    const id = doc.idOf(f), s = sid(id);
    const typeName = (() => { const k = ["wallType", "columnType", "doorType", "windowType", "floorType", "beamType"].find(k => F.refId(f, k)); const ty = k && doc.lib.types[F.refId(f, k)]; return ty ? ty.name : t; })();
    const set = put(PREFIX + s, "GeometricalSet", `${id} · ${typeName}`, { inputs: "", shell: "Open" }, levelSet(f));
    // the element's parameters, as the modeller's own parameter nodes
    const decl = CATALOGUE.get(t);
    for (const a of decl ? decl.args : []) {
      if (a.kind !== "Real" && a.kind !== "Integer") continue;
      const v = F.real(f, a.key); if (!Number.isFinite(v)) continue;
      const nid = put(`${PREFIX}${s}__${a.key}`, "Number", `${id} ${a.label}`, { value: cround(v) }, set);
      params.set(nid, { el: id, key: a.key, kind: "number", value: cround(v) });
    }
    if (t === "Wall" || t === "Beam") {
      const c = doc.argValue(f, t === "Wall" ? "centreline" : "axis");
      if (c && c.type === "line") for (const end of ["start", "end"]) {
        const z = t === "Wall" ? (doc.plan(f) || { z0: 0 }).z0 : (c.z || 0);
        const nid = put(`${PREFIX}${s}__${end}`, "Point", `${id} ${end}`, { x: cround(c[end][0]), y: cround(c[end][1]), z: cround(z) }, set);
        params.set(nid, { el: id, key: end, kind: t === "Wall" ? "wallEnd" : "beamEnd", value: [cround(c[end][0]), cround(c[end][1])] });
      }
    }
    if (t === "Column") {
      const p = F.point(f, "position"), z = (doc.plan(f) || { z0: 0 }).z0;
      const nid = put(`${PREFIX}${s}__position`, "Point", `${id} position`, { x: cround(p[0]), y: cround(p[1]), z: cround(z) }, set);
      params.set(nid, { el: id, key: "position", kind: "point", value: [cround(p[0]), cround(p[1])] });
    }
    // the body: each part a sketch pulled up into a solid, the parts joined
    const parts = elementParts(doc, f).filter(p => p.foot && p.foot.length >= 3 && p.z1 - p.z0 > 1e-6);
    const bodies = parts.map((p, i) => {
      const els = p.foot.map((q, k) => ({ id: "e" + (k + 1), type: "line", a: [cround(q[0]), cround(q[1])], b: [cround(p.foot[(k + 1) % p.foot.length][0]), cround(p.foot[(k + 1) % p.foot.length][1])] }));
      const sk = put(`${PREFIX}${s}_s${i}`, "Sketch", `${id} ${p.sub || "part"} ${i + 1} outline`, { plane: { ref: planeAt(p.z0) }, faces: "Make faces", solve: "Ignore", passes: 0, drawing: { elements: els, constraints: [] } }, set,
        { appearance: { finish: "matte", color: [0.16, 0.42, 0.78] } });
      return put(`${PREFIX}${s}_x${i}`, "Extrude", `${id} ${p.sub || "part"} ${i + 1}`, { profile: { ref: sk }, limit: "Distance", distance: cround(p.z1 - p.z0), cap: "Solid", way: "Normal to the profile" }, set,
        { appearance: { finish: "matte", color: SUB_COLOURS[p.sub] || COLOURS[t] } });
    });
    if (bodies.length > 1) put(`${PREFIX}${s}_body`, "Join", `${id} ${typeName}`, { parts: bodies.map(ref => ({ ref })) }, set, { appearance: { finish: "matte", color: COLOURS[t] } });
  }
  for (const f of features) if (f.parent === undefined) delete f.parent;
  return { model: { format: "ocaf-parametric-model", version: 1, name: doc.meta.name || "Web BIM", units: "mm", features }, params };
}

const numB = v => (v && typeof v === "object" ? Number(v.value) : Number(v));

/** Edits made in the modeller to the building's parameter nodes, as BIM ops. */
export function cadEditsToOps(doc, cadModel, params) {
  const byId = new Map((cadModel.features || []).map(f => [f.id, f]));
  const ops = [], ends = [];
  for (const [nid, p] of params) {
    const f = byId.get(nid); if (!f || !doc.element(p.el)) continue;
    if (p.kind === "number") {
      const v = numB(f.args.value); if (!Number.isFinite(v) || Math.abs(v - p.value) < 1e-6) continue;
      ops.push({ op: "set", id: p.el, key: p.key, value: v });
    } else {
      const x = numB(f.args.x), y = numB(f.args.y); if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (Math.abs(x - p.value[0]) < 1e-6 && Math.abs(y - p.value[1]) < 1e-6) continue;
      if (p.kind === "wallEnd") { ops.push({ op: "drag", id: p.el, key: "centreline." + p.key, value: [x, y] }); ends.push({ id: p.el, end: p.key }); }
      else if (p.kind === "beamEnd") ops.push({ op: "drag", id: p.el, key: "axis." + p.key, value: [x, y] });
      else ops.push({ op: "set", id: p.el, key: p.key, value: [x, y] });
    }
  }
  if (ends.length) ops.push({ op: "autojoin", ends });
  return ops;
}

/** The modeller edits that turn its copy (`cur`) into `next`, or null when the
 *  shape of the tree changed and the building's part must be written afresh. */
export function cadDiff(cur, next) {
  const mine = m => (m.features || []).filter(f => String(f.id).startsWith(PREFIX));
  const a = new Map(mine(cur).map(f => [f.id, f])), b = mine(next);
  if (a.size !== b.length || b.some(f => !a.has(f.id) || a.get(f.id).type !== f.type || (a.get(f.id).parent || null) !== (f.parent || null))) return null;
  const cmds = [];
  for (const f of b) {
    const g = a.get(f.id);
    if (g.name !== f.name) cmds.push({ op: "rename", id: f.id, name: f.name });
    for (const [k, v] of Object.entries(f.args)) {
      const was = g.args ? g.args[k] : undefined;
      if (k === "drawing") { if (!sameDrawing(was, v)) cmds.push({ op: "sketch", id: f.id, drawing: v }); continue; }
      if (v && typeof v === "object" && v.ref !== undefined) { if (!was || was.ref !== v.ref) return null; continue; }
      if (Array.isArray(v)) { if (JSON.stringify(was) !== JSON.stringify(v)) return null; continue; }
      if (typeof v === "number") { if (!(Math.abs(numB(was) - v) < 1e-6)) cmds.push({ op: "set", id: f.id, key: k, value: v }); continue; }
    }
    if (f.appearance && JSON.stringify(f.appearance.color) !== JSON.stringify(g.appearance && g.appearance.color)) cmds.push({ op: "appearance", id: f.id, appearance: f.appearance });
  }
  return cmds;
}
function sameDrawing(a, b) {
  if (!a || !b || !a.elements || a.elements.length !== b.elements.length) return false;
  return a.elements.every((e, i) => { const o = b.elements[i]; return e.type === o.type && Math.abs(e.a[0] - o.a[0]) < 1e-6 && Math.abs(e.a[1] - o.a[1]) < 1e-6 && Math.abs(e.b[0] - o.b[0]) < 1e-6 && Math.abs(e.b[1] - o.b[1]) < 1e-6; });
}
/** The building's part written afresh, with the modeller's own features carried after it. */
export function mergeModel(cur, next) {
  const theirs = (cur && cur.features || []).filter(f => !String(f.id).startsWith(PREFIX));
  return Object.assign({}, next, { features: next.features.concat(theirs), layout: cur && cur.layout, hidden: cur && cur.hidden });
}
