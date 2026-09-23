//! Pure models the interface draws (§4.5, §4.2, §10.3). Kept free of the DOM so
//! the tests measure exactly what the panel shows.
//!
//! PropertyPanel(element) = merge(driver arguments, type parameters (read-only,
//! behind Edit Type), instance parameters, computed values). Generated from the
//! declarations — nothing here names an element type.

import { TOL, sub, dot, perp, normalise, dist, signedDistance, lineThrough } from "./geom2d.js";
import { CATALOGUE, F, GEOMETRIC_KINDS, displayParam, evalParam } from "./ocaf.js";
import { formatValue } from "./expr.js";
import { categoryOf } from "./styles.js";
import { resolveReference } from "./bim.js";

const GROUP_ORDER = ["Constraints", "Dimensions", "Graphics", "Extents", "Construction", "Identity Data", "Phasing", "Finishes", "Other"];
export const TYPE_KEYS = ["wallType", "doorType", "windowType", "columnType"];

/** Which editor a kind gets. Geometry is never a text box (§4.5, test 37e). */
export function editorFor(arg) {
  if (arg.kind === "Curve2D" || arg.kind === "Point2D") return "edit-in-view";
  if (arg.kind === "Json") return "json";
  if (arg.kind === "Real" || arg.kind === "Integer") return "value";
  if (arg.kind === "Boolean") return "check";
  if (arg.kind === "Choice") return "choice";
  if (arg.kind === "Reference") return "reference";
  return "text";
}
export function specEditor(spec) {
  return { Enum: "choice", Boolean: "check", Length: "value", Number: "value", Integer: "value", Angle: "value", Text: "text", MultiText: "text", Colour: "colour", URL: "text", Material: "reference" }[spec.kind] || "text";
}

/** Parameter specs that apply to an element: document specs + its family chain's. */
export function specsFor(doc, f) {
  const cat = categoryOf(doc, f);
  const out = {};
  for (const [k, s] of Object.entries(doc.lib.paramSpecs)) if (s.categories && (s.categories.includes("*") || s.categories.includes(cat))) out[k] = s;
  const tk = TYPE_KEYS.find(k => F.refId(f, k));
  if (tk) { const t = doc.resolveType(F.refId(f, tk)); if (t) for (const [k, s] of Object.entries(t.specs || {})) out[k] = Object.assign({ binding: "type", group: "Identity Data" }, s); }
  return out;
}

/** The panel for one element or a multi-selection (common rows, <varies>). */
export function propertyModel(doc, ids) {
  const els = ids.map(id => doc.element(id)).filter(Boolean);
  if (!els.length) return null;
  const types = [...new Set(els.map(f => f.get("Type")))];
  const rows = [];
  const push = r => rows.push(Object.assign({ group: "Other" }, r));
  const vary = vals => vals.every(v => JSON.stringify(v) === JSON.stringify(vals[0])) ? { value: vals[0] } : { varies: true };
  // driver arguments: only when every element is the same type
  if (types.length === 1) {
    const decl = CATALOGUE.get(types[0]);
    decl && decl.args.forEach((a, i) => {
      if (a.when) { const ctl = els.map(f => doc.argValue(f, a.when.key)); if (!ctl.every(v => v === a.when.value)) return; }
      const vals = els.map(f => doc.argValue(f, a.key));
      const v = vary(vals);
      const row = { source: "arg", key: a.key, label: a.label, kind: a.kind, editor: editorFor(a), group: a.group || "Constraints", arg: a, entry: els.length === 1 ? els[0].child(1 + i, false)?.entry() : null };
      Object.assign(row, v);
      if (!v.varies && v.value && typeof v.value === "object" && v.value.ref && (a.kind === "Real" || a.kind === "Integer")) {
        // A bound value shows its expression, not its result (§4.5, test 37d).
        const ex = doc.element(v.value.ref);
        row.bound = { id: v.value.ref, expr: ex ? (doc.argValue(ex, "formula") ?? ex.get("Name")) : "?", result: ex && doc.data(ex) ? formatValue({ kind: doc.data(ex).kind, v: doc.data(ex).value }) : "—", error: ex ? doc.error(ex) : "missing" };
      }
      if (a.kind === "Reference") row.options = referenceOptions(doc, a, els[0]);
      if (a.kind === "Choice") row.options = a.options.map(o => ({ value: o, label: o }));
      push(row);
    });
  }
  // instance and type parameters
  const specSets = els.map(f => specsFor(doc, f));
  const common = Object.keys(specSets[0]).filter(k => specSets.every(s => s[k]));
  for (const k of common) {
    const spec = specSets[0][k];
    if (spec.binding === "type") {
      const vals = els.map(f => { const tk = TYPE_KEYS.find(t => F.refId(f, t)); const t = tk && doc.resolveType(F.refId(f, tk)); return t ? t.params[k] : undefined; });
      const origin = els.length === 1 ? (() => { const tk = TYPE_KEYS.find(t => F.refId(els[0], t)); const t = tk && doc.resolveType(F.refId(els[0], tk)); return t && t.origin[k]; })() : null;
      push(Object.assign({ source: "type", key: k, label: k, kind: spec.kind, editor: "readonly", group: spec.group || "Identity Data", spec, origin, readonly: true }, vary(vals)));
    } else {
      const vals = els.map(f => doc.getParam(f, k));
      const row = Object.assign({ source: "param", key: k, label: k, kind: spec.kind, editor: specEditor(spec), group: spec.group || "Identity Data", spec }, vary(vals));
      if (spec.kind === "Enum") row.options = spec.values.map(o => ({ value: o, label: o }));
      if (row.value === undefined && spec.default !== undefined) row.placeholder = spec.default;
      if (row.value && typeof row.value === "object" && row.value.expr) row.display = displayParam(doc, els[0], row.value);
      push(row);
    }
  }
  // computed values: read-only (length, area, volume)
  if (els.length === 1) {
    const d = doc.data(els[0]);
    // what the element measures of itself - length, area, volume, heights - live, in the project's units,
    // where Revit shows them: read-only rows in Dimensions (text facts in Identity Data)
    for (const [k, v] of Object.entries((d && d.props) || {})) push({ source: "computed", key: k, label: k, editor: "readonly", readonly: true, group: v && v.kind === "Text" ? "Identity Data" : "Dimensions", value: formatValue(v), live: true });
  }
  rows.sort((a, b) => (GROUP_ORDER.indexOf(a.group) + 1 || 99) - (GROUP_ORDER.indexOf(b.group) + 1 || 99));
  const tk = types.length === 1 ? TYPE_KEYS.find(k => CATALOGUE.get(types[0]).args.some(a => a.key === k)) : null;
  return { ids, types, rows, typeKey: tk, typeIds: tk ? [...new Set(els.map(f => F.refId(f, tk)))] : [], errors: els.map(f => doc.error(f)).filter(Boolean), notes: els.map(f => doc.note(f)).filter(Boolean) };
}

/** What a reference field may point at: elements and library entries whose kind
 *  is in the declaration's `kinds` — the same check the graph uses for wires. */
export function referenceOptions(doc, arg, self) {
  const out = [];
  for (const g of doc.elements()) { if (g === self) continue; const d = doc.declOf(g); if (d && arg.kinds.includes(d.kind)) out.push({ value: doc.idOf(g), label: `${g.get("Name")} (${doc.idOf(g)})` }); }
  const libKind = { wallType: "IfcWall", doorType: "IfcDoor", windowType: "IfcWindow", columnType: "IfcColumn" };
  for (const k of arg.kinds) {
    if (libKind[k]) for (const [id, t] of Object.entries(doc.lib.types)) { const r = doc.resolveType(id); if (r && r.category === libKind[k]) out.push({ value: id, label: t.name || id }); }
    if (k === "viewStyle") for (const [id, s] of Object.entries(doc.lib.viewStyles)) out.push({ value: id, label: s.name || id });
    if (k === "textType") for (const [id, s] of Object.entries(doc.lib.textTypes)) out.push({ value: id, label: s.name || id });
    if (k === "symbol") for (const [id, s] of Object.entries(doc.lib.symbols)) out.push({ value: id, label: s.name || id });
  }
  return out;
}
/** Can an output of element `src` be wired into argument `arg`? One check, for
 *  the panel's dropdown, the graph's wires and the pick popover. */
export function canConnect(doc, src, arg) {
  const d = doc.declOf(src); if (!d) return false;
  if (arg.kind === "Reference") return arg.kinds.includes(d.kind);
  if (arg.kind === "Real" || arg.kind === "Integer") return d.kind === "number";
  return false;
}

// ---------------------------------------------------------------- pick-binding (§4.2)
/** Clicking an element while a typed field is active: offer only what matches
 *  the field's kind — Lengths for a Length, materials for a Material (37g, 37i). */
export function pickCandidates(doc, targetId, kind) {
  const f = doc.element(targetId); if (!f) return [];
  const id = doc.idOf(f), out = [];
  if (kind === "Material") {
    const tk = TYPE_KEYS.find(k => F.refId(f, k)), t = tk && doc.resolveType(F.refId(f, tk));
    const mats = new Set((t && t.layers ? t.layers.map(l => l.material) : []).concat(t && t.material ? [t.material] : []));
    for (const m of mats) out.push({ text: m, label: `${doc.lib.materials[m] ? doc.lib.materials[m].name : m} (${m})`, kind: "Material" });
    return out;
  }
  const d = doc.data(f);
  for (const [k, v] of Object.entries((d && d.props) || {})) if (v && v.kind === kind) out.push({ text: `${id}.${k}`, label: `${k} = ${formatValue(v)}`, kind });
  const decl = doc.declOf(f);
  for (const a of decl ? decl.args : []) if ((a.kind === "Real") && a.quantity === kind && !out.some(o => o.text === `${id}.${a.key}`)) {
    let val; try { F.doc = doc; val = F.real(f, a.key); } catch (e) { val = NaN; }
    out.push({ text: `${id}.${a.key}`, label: `${a.label} = ${formatValue({ kind, v: val })}`, kind });
  }
  // the element's type's own lengths: total thickness
  const tk = TYPE_KEYS.find(k => F.refId(f, k)), t = tk && doc.resolveType(F.refId(f, tk));
  if (kind === "Length" && t && t.layers) out.push({ text: `${id}.Width`, label: `Type thickness = ${formatValue({ kind: "Length", v: t.layers.reduce((a, l) => a + l.thickness, 0) })}`, kind, dedupe: true });
  const seen = new Set();
  return out.filter(o => { if (seen.has(o.text)) return false; seen.add(o.text); return true; }).sort((a, b) => (a.text.endsWith(".Length") ? -1 : 0) - (b.text.endsWith(".Length") ? -1 : 0));
}

// ---------------------------------------------------------------- the node graph (a second projection)
/** Nodes and wires from the same declarations: an input port per reference or
 *  bindable numeric argument; every element has one output. A binding typed
 *  into a field IS a wire here (test 37h) — there is no second link mechanism. */
export function graphModel(doc) {
  const nodes = [], wires = [];
  for (const f of doc.elements()) {
    const decl = doc.declOf(f); if (!decl) continue;
    const id = doc.idOf(f);
    const ports = decl.args.filter(a => a.kind === "Reference" || a.kind === "Real" || a.kind === "Integer").map(a => ({ key: a.key, label: a.label, kind: a.kind, kinds: a.kinds, view: !!a.view }));
    nodes.push({ id, name: f.get("Name"), type: decl.type, kind: decl.kind, ports, error: doc.error(f), note: doc.note(f) });
    decl.args.forEach(a => {
      const v = doc.argValue(f, a.key);
      if (v && typeof v === "object" && v.ref && doc.element(v.ref)) wires.push({ from: v.ref, to: id, port: a.key, view: !!a.view });
    });
    if (decl.dependsOn) for (const dep of decl.dependsOn(f, doc)) wires.push({ from: dep, to: id, port: "formula", derived: true });
  }
  return { nodes, wires };
}
/** A layered layout: column = longest path from a source. */
export function autoLayout(doc, model) {
  const depth = new Map(), incoming = new Map();
  for (const w of model.wires) { if (!incoming.has(w.to)) incoming.set(w.to, []); incoming.get(w.to).push(w.from); }
  const visit = (id, seen = new Set()) => { if (depth.has(id)) return depth.get(id); if (seen.has(id)) return 0; seen.add(id); const d = Math.max(-1, ...(incoming.get(id) || []).map(x => visit(x, seen))) + 1; depth.set(id, d); return d; };
  const cols = new Map();
  for (const n of model.nodes) { const d = visit(n.id); if (!cols.has(d)) cols.set(d, []); cols.get(d).push(n.id); }
  const layout = {};
  for (const [d, ids] of cols) ids.forEach((id, i) => { layout[id] = [40 + d * 230, 30 + i * 74]; });
  return layout;
}

// ---------------------------------------------------------------- listening dimensions (§10.3)
/** Temporary dimensions from the active wall to nearby parallel references.
 *  Capped at four; relevance = parallel only; preference order chooses which
 *  face of each neighbour is measured to. */
export const PREFERENCE = ["centreline", "core.exterior", "core.interior", "face.exterior", "face.interior", "line"];
export function listeningDimensions(doc, id, { radius = 15000, max = 4, prefer = PREFERENCE } = {}) {
  const f = doc.element(id); if (!f || doc.typeOf(f) !== "Wall") return [];
  const d = doc.data(f); if (!d || !d.refs) return [];
  const own = d.refs.find(r => r.key === "centreline"); if (!own || own.kind !== "line") return [];
  const L = own.geom, mid = doc.plan(f) ? doc.plan(f).curve.at(0.5) : L.p;
  const cands = [];
  for (const g of doc.elements()) {
    if (g === f) continue;
    const t = doc.typeOf(g); if (t !== "Wall" && t !== "Grid") continue;
    const gd = doc.data(g); if (!gd || !gd.refs) continue;
    const lines = gd.refs.filter(r => r.kind === "line");
    let best = null;
    for (const key of prefer) { const r = lines.find(x => x.key === key); if (r) { best = r; break; } }
    if (!best) continue;
    const par = Math.abs(best.geom.d[0] * L.d[1] - best.geom.d[1] * L.d[0]) < 1e-6;
    if (!par) continue;                                    // a reference at 37° is noise
    const sd = signedDistance(L, best.geom.p);
    if (Math.abs(sd) > radius || Math.abs(sd) < TOL) continue;
    // overlap along the wall: the neighbour must be beside it, not far down the line
    const gc = t === "Wall" ? doc.plan(g).curve : null;
    const along = gc ? [dot(sub(gc.start, L.p), L.d), dot(sub(gc.end, L.p), L.d)] : [-Infinity, Infinity];
    const mine = [0, dist(doc.plan(f).curve.start, doc.plan(f).curve.end)];
    if (Math.max(...along) < mine[0] - radius / 3 || Math.min(...along) > mine[1] + radius / 3) continue;
    cands.push({ to: doc.idOf(g) + ":" + best.key, from: id + ":centreline", value: Math.abs(sd), side: Math.sign(sd), at: mid });
  }
  // nearest on each side first, then the next ones
  cands.sort((a, b) => a.value - b.value);
  const pos = cands.filter(c => c.side > 0), neg = cands.filter(c => c.side < 0);
  const out = [];
  while (out.length < max && (pos.length || neg.length)) { if (pos.length) out.push(pos.shift()); if (out.length < max && neg.length) out.push(neg.shift()); }
  return out;
}
/** Typing into a temporary dimension moves the element to satisfy it exactly. */
export function dimensionMove(doc, dim, value) {
  const f = doc.element(dim.from.split(":")[0]);
  const c = doc.argValue(f, "centreline");
  const other = resolveReference(doc, dim.to), own = resolveReference(doc, dim.from);
  if (!other || !own || own.kind !== "line") return null;
  const n = perp(own.geom.d);
  const cur = dot(sub(own.geom.p, other.geom.p), n);         // own relative to other, along n
  const want = Math.sign(cur || 1) * value;
  const delta = want - cur;
  const mv = [n[0] * delta, n[1] * delta];
  return { type: "line", start: [c.start[0] + mv[0], c.start[1] + mv[1]], end: [c.end[0] + mv[0], c.end[1] + mv[1]] };
}
