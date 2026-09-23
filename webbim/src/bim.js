//! The application layer (spec §4–§11): every element type is two declarations —
//! a catalogue entry and a driver — and nothing else. The panel, the tree, the
//! node editor and the save path read the entries; none of them names a type.

import {
  TOL, add, sub, mul, dot, dist, perp, normalise, lerp, curveOf, samplePath, pathArea, polyArea, pointInPoly, polyPath,
  lineThrough, intersectLines, signedDistance, projectPoint, segStart, segEnd, bboxOf, TAU,
} from "./geom2d.js";
import { parse, evaluate, namesIn, formatValue, ExprError } from "./expr.js";
import {
  Document, declare, BUILDERS, CATALOGUE, F, real, integer, bool, text, choice, ref, curve2d, point2d, json, when,
  documentLookup, propertyOf, PLAN_TAG, DATA_TAG, NOTE_TAG, RESULT_TAG, REVISION_TAG, loadDocument, danglingRefs, clone,
} from "./ocaf.js";
import { wallRecord, wallReferences, pointAt, uOf, sideOf, boundary, wallPieces, faceLine, layerStack } from "./walls.js";
import { resolveJoins, wallRegions, solidSpans, coarseMaterial, JOIN_TOL } from "./joins.js";
import { findLoops, claimLoops, filterWallFaces, interiorPoint } from "./spaces.js";
import {
  PEN_ISO, PATTERNS, MATERIALS, PARAM_SPECS, CATEGORIES, FAMILIES, TYPES, TEXT_TYPES, SYMBOLS, VS_PRESENTATION, VS_CONSTRUCTION,
} from "./library.js";

const L = (v) => ({ kind: "Length", v });
const N = (v) => ({ kind: "Number", v });
const T = (v) => ({ kind: "Text", v: String(v) });
const levelElev = (doc, f, key = "baseLevel") => { const lv = F.reference(f, key); const d = lv && doc.data(lv); return d ? d.value : 0; };

// ---------------------------------------------------------------- datum elements
declare({ type: "Level", guid: "wb-0001", category: "IfcBuildingStorey", kind: "level", idPrefix: "L",
  summary: "A plane z = elevation, and nothing more. Its elevation rep is a line with a level head.",
  args: [ text("name", "Name", "Level", { group: "Identity Data" }), real("elevation", "Elevation", 0, -100000, 100000, 1) ] });
BUILDERS.Level = { build: (f) => {
  const e = F.real(f, "elevation");
  return { data: { value: e, kind: "Length", props: { Elevation: L(e), Name: T(F.text(f, "name")) } } };
} };

declare({ type: "Grid", guid: "wb-0002", category: "IfcGrid", kind: "grid", idPrefix: "G-",
  summary: "A datum line with a bubble. Publishes its line as a reference.",
  args: [ text("name", "Label", "A", { group: "Identity Data" }), curve2d("line", "Line", ["line"], { type: "line", start: [0, 0], end: [0, 10000] }) ],
  handles: (f) => { const c = F.json(f, "line"); return [
    { key: "start", at: c.start, constraint: "free2d", writes: "line.start" },
    { key: "end", at: c.end, constraint: "free2d", writes: "line.end" } ]; } });
BUILDERS.Grid = { build: (f) => {
  const c = F.json(f, "line");
  return { data: { value: dist(c.start, c.end), kind: "Length", refs: [{ key: "line", kind: "line", geom: lineThrough(c.start, c.end) }],
    props: { Length: L(dist(c.start, c.end)), Name: T(F.text(f, "name")) } } };
} };

// ---------------------------------------------------------------- values: Number & Expression
declare({ type: "Number", guid: "wb-0003", category: "Parameter", kind: "number", idPrefix: "N",
  summary: "A named value other fields can bind to by name.",
  args: [ real("value", "Value", 0, -1e9, 1e9, 1, ""), choice("quantity", "Quantity", ["Length", "Number", "Angle"], 0) ] });
BUILDERS.Number = { build: (f) => ({ data: { value: F.real(f, "value"), kind: F.choice(f, "quantity") } }) };

declare({ type: "Expression", guid: "wb-0004", category: "Parameter", kind: "number", idPrefix: "EX",
  summary: "An inline value that acquired dependencies, promoted to a first-class element (§4.1).",
  args: [ text("formula", "Formula", "0"), choice("quantity", "Quantity", ["Length", "Number", "Angle", "Text"], 0) ],
  // The graph falls out of the names in the formula: they are references.
  dependsOn: (f, doc) => {
    try { return namesIn(parse(doc.argValue(f, "formula"))).map(n => resolveName(doc, n)).filter(Boolean); }
    catch (e) { return []; }
  } });
function resolveName(doc, n) {
  const head = n.split(".")[0];
  if (doc.element(head)) return head;
  const g = doc.elements().find(x => x.get("Name") === head);
  return g ? doc.idOf(g) : null;
}
BUILDERS.Expression = {
  build: (f, doc) => {
    const q = F.choice(f, "quantity");
    const v = evaluate(parse(F.text(f, "formula")), { lookup: documentLookup(doc, f), into: q });
    if (v.kind === "Number" && (q === "Length" || q === "Angle")) v.kind = q;
    return { data: { value: v.v, kind: v.kind, text: formatValue(v) } };
  },
};

// ---------------------------------------------------------------- walls
const MOUNTINGS = ["Centred", "Core centre", "Finish exterior", "Finish interior", "Core exterior", "Core interior", "Offset"];
declare({ type: "Wall", guid: "wb-0101", category: "IfcWall", kind: "wall", idPrefix: "W",
  summary: "A wall built by offsetting a centreline curve.",
  args: [
    curve2d("centreline", "Centreline", ["line", "arc", "circle", "ellipse", "spline"], { type: "line", start: [0, 0], end: [4000, 0] }),
    choice("mounting", "Location line", MOUNTINGS, 0),
    when(real("mountOffset", "Offset", 0, -2000, 2000, 1), "mounting", "Offset"),
    ref("wallType", "Type", ["wallType"]),
    ref("baseLevel", "Base level", ["level"]),
    real("baseOffset", "Base offset", 0, -10000, 10000, 1),
    real("height", "Height", 3000, 1, 100000, 1, "mm", { group: "Dimensions" }),
    bool("flipped", "Flipped", false),
    json("slope", "Top slope & lean", { top: 0, lean: 0 }, { group: "Constraints" }),
  ],
  handles: (f, doc) => {
    const c = F.json(f, "centreline"), w = doc.plan(f);
    if (c.type !== "line") return c.type === "arc" ? [{ key: "centre", at: c.centre, constraint: "free2d", writes: "centreline.centre" }] : [];
    const d = normalise(sub(c.end, c.start)), mid = lerp(c.start, c.end, 0.5);
    const hs = [
      { key: "start", at: c.start, constraint: "free2d", writes: "centreline.start" },
      { key: "end", at: c.end, constraint: "free2d", writes: "centreline.end", readout: "length" },
      { key: "length", at: add(c.end, mul(d, 350)), constraint: { axis: d, origin: c.start }, writes: "centreline.end", readout: "length" },
      { key: "move", at: mid, constraint: "free2d", writes: "centreline" },
    ];
    if (F.choice(f, "mounting") === "Offset" && w) hs.push({ key: "side", at: add(mid, mul(perp(d), w.stack.T / 2)), constraint: { axis: perp(d), origin: mid }, writes: "mountOffset" });
    return hs;
  },
});
BUILDERS.Wall = {
  precondition: (f, doc) => F.type(f, "wallType") ? null : (F.refId(f, "wallType") ? `wall type ${F.refId(f, "wallType")} is not in the document` : "pick a wall type"),
  build: (f, doc) => {
    const t = F.type(f, "wallType");
    if (!t.layers || !t.layers.length) throw new Error(`${t.name || t.id} has no layers`);
    const z0 = levelElev(doc, f) + F.real(f, "baseOffset");
    const height = F.real(f, "height");
    if (!(height > 0)) throw new Error(`a wall ${height}mm high has nothing to draw`);
    const w = wallRecord({ id: doc.idOf(f), centreline: F.json(f, "centreline"), type: t, mounting: F.choice(f, "mounting"),
      mountOffset: F.real(f, "mountOffset"), flipped: F.bool(f, "flipped"), z0, height, slope: F.json(f, "slope"), stats: doc.stats });
    if (w.L < TOL) throw new Error("the centreline has no length");
    const len = w.L, thick = w.stack.T;
    const lv = F.reference(f, "baseLevel");
    return {
      plan: w,
      data: { value: len, kind: "Length", refs: wallReferences(w), props: {
        Length: L(len), Width: L(thick), Height: L(height), "Base elevation": L(z0),
        Area: { kind: "Area", v: len * height }, Volume: { kind: "Number", v: len * height * thick / 1e9 } } },
      note: lv ? null : (F.refId(f, "baseLevel") ? null : "no base level: built from z = 0"),
    };
  },
};

// ---------------------------------------------------------------- openings and fillers (§5.1)
declare({ type: "Opening", guid: "wb-0201", category: "IfcOpeningElement", kind: "opening", idPrefix: "OP",
  summary: "Two sketches in the host's own (u, v) frame, a loft between them, and a void. Exists with or without a filler.",
  args: [
    ref("host", "Host", ["wall"]),
    json("profile", "Profile", { kind: "rect", at: 1000, sill: 0, w: 1000, h: 2100 }, { group: "Dimensions" }),
    json("farProfile", "Far profile", null, { group: "Dimensions" }),
    json("depth", "Depth", "through", { group: "Dimensions" }),
  ],
  handles: (f, doc) => {
    const host = F.reference(f, "host"), w = host && doc.plan(host), p = F.json(f, "profile");
    if (!w) return [];
    return [{ key: "at", at: pointAt(w, 0, p.at), constraint: { onCurve: doc.idOf(host) }, writes: "profile.at", readout: "at" }];
  } });
BUILDERS.Opening = {
  precondition: (f, doc) => {
    const h = F.reference(f, "host");
    if (!h) return F.refId(f, "host") ? `host ${F.refId(f, "host")} is not in the document` : "pick a host wall";
    if (!doc.plan(h)) return `host ${doc.idOf(h)} has not built`;
    return null;
  },
  build: (f, doc) => {
    const host = F.reference(f, "host"), w = doc.plan(host);
    const p = F.json(f, "profile"), far = F.json(f, "farProfile"), depth = F.json(f, "depth");
    if (p.kind !== "rect") throw new Error(`profile kind "${p.kind}" — this build draws rect profiles; the sketch form is kept in the file`);
    const u0 = p.at - p.w / 2, u1 = p.at + p.w / 2;
    let note = null, flagged = false;
    // Never delete user work because a wall moved: flag and keep (§5.1, test 19d).
    if (u0 < -TOL || u1 > w.L + TOL) { flagged = true; note = `lies ${u1 > w.L ? "past the end" : "before the start"} of ${doc.idOf(host)} (now ${Math.round(w.L)}mm long) — kept, not cut`; }
    if (p.sill + p.h > w.height + TOL) note = (note ? note + "; " : "") + `head at ${p.sill + p.h}mm is above the wall top (${w.height}mm)`;
    let recess = null;
    const T = w.stack.T;
    if (depth !== "through" && depth != null) {
      const dd = Number(depth);
      if (!(dd > 0)) throw new Error(`a depth of ${depth} is neither "through" nor a positive number`);
      if (dd < T - TOL) {
        // Layers from the exterior face lying within the depth are cut; the rest stays.
        let acc = 0; const layers = [];
        w.stack.layers.forEach((l, i) => { if (acc + l.thickness <= dd + TOL) layers.push(i); acc += l.thickness; });
        recess = { depth: dd, layers };
        if (!layers.length) note = (note ? note + "; " : "") + `recess ${dd}mm is shallower than the first layer; drawn in 3D only`;
      }
    }
    // Volume of the void, as a loft between the near and far profiles (prismatoid rule).
    const dv = recess ? recess.depth : T;
    const A1 = p.w * p.h, fw = far ? far.w : p.w, fh = far ? far.h : p.h, A2 = fw * fh, Am = ((p.w + fw) / 2) * ((p.h + fh) / 2);
    const voidVolume = dv / 6 * (A1 + 4 * Am + A2);
    const frame = { host: doc.idOf(host), u0, u1, at: p.at, sill: p.sill, h: p.h, w: p.w, far, recess, flagged, voidVolume };
    return {
      data: { value: p.w, kind: "Length", frame, props: { Width: L(p.w), Height: L(p.h), "Sill height": L(p.sill), "Along host": L(p.at),
        "Void volume": { kind: "Number", v: voidVolume / 1e9 } } },
      note,
    };
  },
};

function fillerDecl(type, guid, typeKind, extraArgs, summary, idPrefix, category) {
  declare({ type, guid, category, kind: type.toLowerCase(), idPrefix, summary,
    args: [ ref("fills", "Fills", ["opening"]), ref(typeKind, "Type", [typeKind]), ...extraArgs ] });
}
fillerDecl("Door", "wb-0202", "doorType", [bool("flipHand", "Flip hand", false), bool("flipFacing", "Flip facing", false),
    choice("operation", "Operation", ["Single", "Double"], 0), real("swingAngle", "Swing angle", 90, 0, 180, 1, "°"),
    real("openAngle", "Open angle (3D)", 0, 0, 180, 1, "°"), choice("clearance", "ADA clearance", ["Front approach", "Hinge approach", "Latch approach", "None"], 0)],
  "A filler with a symbol: panel, frame and swing, drawn in its opening's host frame.", "D", "IfcDoor");
fillerDecl("Window", "wb-0203", "windowType", [bool("flipFacing", "Flip facing", false)],
  "A filler with glazing and frame, drawn in its opening's host frame.", "WN", "IfcWindow");

function fillerFrame(f, doc) {
  const op = F.reference(f, "fills"), od = op && doc.data(op);
  if (!od || !od.frame) return null;
  const host = doc.element(od.frame.host), w = host && doc.plan(host);
  return w ? { op, fr: od.frame, w } : null;
}
const fillerPre = (typeKey) => (f, doc) => {
  if (!F.reference(f, "fills")) return F.refId(f, "fills") ? `opening ${F.refId(f, "fills")} is not in the document` : "pick an opening to fill";
  if (!F.type(f, typeKey)) return "pick a type";
  if (!fillerFrame(f, doc)) return `opening ${F.refId(f, "fills")} has not built`;
  return null;
};
/** Everything a filler draws is in host (u, s) coordinates, mapped once. */
const hostPt = (w, u, s) => pointAt(w, s, u);

/** A box in the host's (u, s, z) frame, as a plan footprint and a height range: what the 3D view and the CAD bridge build from. */
const hostBox = (w, u0, u1, s0, s1, z0, z1, sub, extra = {}) =>
  Object.assign({ foot: [pointAt(w, s0, u0), pointAt(w, s0, u1), pointAt(w, s1, u1), pointAt(w, s1, u0)], z0: w.z0 + z0, z1: w.z0 + z1, sub }, extra);
/** ADA 2010 §404.2.4 maneuvering clearances at a manual swinging door, mm: depth
 *  in front of the door, and how far the clear floor runs past the latch or the hinge. */
export const ADA_CLEARANCE = {
  "Front approach": { pull: { depth: 1525, latch: 455, hinge: 0 }, push: { depth: 1220, latch: 305, hinge: 0 } },
  "Hinge approach": { pull: { depth: 1525, latch: 915, hinge: 0 }, push: { depth: 1065, latch: 0, hinge: 560 } },
  "Latch approach": { pull: { depth: 1220, latch: 610, hinge: 0 }, push: { depth: 1065, latch: 610, hinge: 0 } },
};
export const SWING_SCENARIOS = ["Left hand, swing in", "Right hand, swing in", "Left hand, swing out", "Right hand, swing out"];

BUILDERS.Door = {
  precondition: fillerPre("doorType"),
  build: (f, doc) => {
    const { fr, w } = fillerFrame(f, doc), t = F.type(f, "doorType");
    const n = w.stack.s.length - 1, sExt = w.stack.s[0], sInt = w.stack.s[n];
    const facing = F.bool(f, "flipFacing") ? -1 : 1;                 // swing toward the interior face unless flipped
    const sFace = facing > 0 ? sInt : sExt, sFar = facing > 0 ? sExt : sInt;
    const dir = Math.sign(sFace - sFar) || 1;                          // +s toward the swing side
    const fw = t.frame || 40, lt = t.leafThickness || 44;
    const pair = F.choice(f, "operation") === "Double";
    const swingDeg = Math.max(0, Math.min(180, F.real(f, "swingAngle") ?? 90));
    const openDeg = Math.max(0, Math.min(swingDeg, F.real(f, "openAngle") ?? 0));
    const hingeAtU0 = !F.bool(f, "flipHand");
    const ua = fr.u0 + fw, ub = fr.u1 - fw;                            // clear opening between the jambs
    const leaves = pair ? [{ uh: ua, uo: (ua + ub) / 2 }, { uh: ub, uo: (ua + ub) / 2 }]
      : [hingeAtU0 ? { uh: ua, uo: ub } : { uh: ub, uo: ua }];
    const sMin = Math.min(sExt, sInt), sMax = Math.max(sExt, sInt);
    const plan = [], parts = [], swing = [];
    const hz = 1000;                                                    // handle height above the floor
    for (const L of leaves) {
      const H = hostPt(w, L.uh, sFace), len = Math.abs(L.uo - L.uh) - (pair ? 2 : 0);
      const c = normalise(sub(hostPt(w, L.uo, sFace), H)), o = normalise(sub(hostPt(w, L.uh, sFace + dir * 10), H));
      const at = deg => { const r = deg * Math.PI / 180; return { d: add(mul(c, Math.cos(r)), mul(o, Math.sin(r))), t: add(mul(o, -Math.cos(r)), mul(c, Math.sin(r))) }; };
      const leafPoly = deg => { const { d, t: th } = at(deg); return [H, add(H, mul(d, len)), add(add(H, mul(d, len)), mul(th, lt)), add(H, mul(th, lt))]; };
      // plan: the leaf drawn open at the swing angle, and the arc it sweeps
      const a0 = Math.atan2(c[1], c[0]), turn = Math.sign(c[0] * o[1] - c[1] * o[0]) || 1;
      plan.push({ sub: "Panel", role: "cut", path: polyPath(leafPoly(swingDeg)) });
      if (swingDeg > 0) plan.push({ sub: "Swing", role: "swing", path: [{ k: "A", c: H, r: len, a0, a1: a0 + turn * swingDeg * Math.PI / 180 }] });
      // 3D: the leaf at its open angle, with a lever handle on each face; all of it turns about the hinge
      const local = (x, y) => { const { d, t: th } = at(openDeg); return add(add(H, mul(d, x)), mul(th, y)); };
      const box3 = (x0, x1, y0, y1, z0, z1, sub_) => ({ foot: [local(x0, y0), local(x1, y0), local(x1, y1), local(x0, y1)], z0: w.z0 + fr.sill + z0, z1: w.z0 + fr.sill + z1, sub: sub_, leaf: true, pivot: H, turn, openDeg, swingDeg });
      parts.push(box3(0, len, 0, lt, 5, fr.h - fw - 3, t.glazed ? "Glass" : "Panel"));
      for (const side of [-1, 1]) {                                     // push face and pull face
        const y0 = side < 0 ? -14 : lt, y1 = side < 0 ? 0 : lt + 14;       // rose on the face
        const yb0 = side < 0 ? -62 : lt + 48, yb1 = side < 0 ? -48 : lt + 62; // lever bar, standing off the face
        const yn0 = side < 0 ? -48 : lt + 14, yn1 = side < 0 ? -14 : lt + 48; // neck from rose to bar
        parts.push(box3(len - 95, len - 45, y0, y1, hz - 35, hz + 35, "Handle"));
        parts.push(box3(len - 80, len - 60, yn0, yn1, hz - 9, hz + 9, "Handle"));
        parts.push(box3(len - 200, len - 60, yb0, yb1, hz - 9, hz + 9, "Handle"));
      }
      swing.push({ hinge: H, closed: c, open: o, len, lt, turn, swingDeg, openDeg, z0: w.z0 + fr.sill, z1: w.z0 + fr.sill + fr.h });
    }
    // frame: two jambs lining the reveal, and the head
    const frames = [[fr.u0, fr.u0 + fw], [fr.u1 - fw, fr.u1]].map(([u0, u1]) => [hostPt(w, u0, sExt), hostPt(w, u1, sExt), hostPt(w, u1, sInt), hostPt(w, u0, sInt)]);
    for (const p of frames) plan.push({ sub: "Frame", role: "cut", path: polyPath(p) });
    parts.push(hostBox(w, fr.u0, fr.u0 + fw, sMin, sMax, fr.sill, fr.sill + fr.h, "Frame"), hostBox(w, fr.u1 - fw, fr.u1, sMin, sMax, fr.sill, fr.sill + fr.h, "Frame"),
      hostBox(w, fr.u0, fr.u1, sMin, sMax, fr.sill + fr.h - fw, fr.sill + fr.h, "Frame"));
    // ADA maneuvering clearances: red dashed, on the pull (swing) side and the push side
    const scenario = F.choice(f, "clearance") || "Front approach";
    const C = ADA_CLEARANCE[scenario];
    if (C) {
      const uHinge = pair ? fr.u0 : (hingeAtU0 ? fr.u0 : fr.u1), uLatch = pair ? fr.u1 : (hingeAtU0 ? fr.u1 : fr.u0), sg = Math.sign(uLatch - uHinge) || 1;
      for (const [side, spec, sLine, sd] of [["pull", C.pull, sFace, dir], ["push", C.push, sFar, -dir]]) {
        const u0 = uHinge - sg * spec.hinge, u1 = uLatch + sg * (pair ? spec.hinge : spec.latch);
        const rect = [hostPt(w, u0, sLine), hostPt(w, u1, sLine), hostPt(w, u1, sLine + sd * spec.depth), hostPt(w, u0, sLine + sd * spec.depth)];
        plan.push({ sub: "Clearance", role: "clearance", side, path: polyPath(rect) });
      }
    }
    const elev = { rects: [{ u0: fr.u0, u1: fr.u1, z0: fr.sill, z1: fr.sill + fr.h, sub: "Frame" }, { u0: fr.u0 + fw, u1: fr.u1 - fw, z0: fr.sill, z1: fr.sill + fr.h - fw, sub: "Panel" }],
      handle: { u: leaves[0].uo - Math.sign(leaves[0].uo - leaves[0].uh) * 80, z: fr.sill + hz }, glazed: !!t.glazed };
    const leafW = Math.abs(leaves[0].uo - leaves[0].uh);
    const scen = SWING_SCENARIOS[(hingeAtU0 ? 0 : 1) + (facing > 0 ? 0 : 2)];
    return { plan, elev, data: { value: t.width, kind: "Length", host: fr.host, frame: fr, parts, swing, props: {
      Width: L(t.width), Height: L(t.height), TypeMark: T(t.mark || t.id), "Leaf width": L(leafW), "Clear width": L(leafW - lt), Swing: T(pair ? "Double" : scen), "ADA clearance": T(scenario) } },
      note: Math.abs(fr.w - t.width) > 1 ? `type is ${t.width}mm wide; its opening is ${fr.w}mm` : null };
  },
};
BUILDERS.Window = {
  precondition: fillerPre("windowType"),
  build: (f, doc) => {
    const { fr, w } = fillerFrame(f, doc), t = F.type(f, "windowType");
    const n = w.stack.s.length - 1;
    const sMid = (w.stack.s[w.stack.cs] + w.stack.s[w.stack.ce]) / 2, g = 12;
    const fwid = t.frame || 60;
    const out = Math.sign(w.stack.s[0] - w.stack.s[n]) || -1;           // toward the exterior face
    const plan = [
      { sub: "Glass", role: "cut", path: [{ k: "L", a: hostPt(w, fr.u0, sMid - g), b: hostPt(w, fr.u1, sMid - g) }] },
      { sub: "Glass", role: "cut", path: [{ k: "L", a: hostPt(w, fr.u0, sMid + g), b: hostPt(w, fr.u1, sMid + g) }] },
      { sub: "Frame", role: "cut", path: polyPath([hostPt(w, fr.u0, sMid - 35), hostPt(w, fr.u0 + fwid, sMid - 35), hostPt(w, fr.u0 + fwid, sMid + 35), hostPt(w, fr.u0, sMid + 35)]) },
      { sub: "Frame", role: "cut", path: polyPath([hostPt(w, fr.u1 - fwid, sMid - 35), hostPt(w, fr.u1, sMid - 35), hostPt(w, fr.u1, sMid + 35), hostPt(w, fr.u1 - fwid, sMid + 35)]) },
      { sub: "Sill", role: "projection", path: [{ k: "L", a: hostPt(w, fr.u0 - 40, w.stack.s[0] + 30 * out), b: hostPt(w, fr.u1 + 40, w.stack.s[0] + 30 * out) }] },
    ];
    const mull = Math.max(0, t.mullions || 0);
    const rects = [{ u0: fr.u0, u1: fr.u1, z0: fr.sill, z1: fr.sill + fr.h, sub: "Frame" }, { u0: fr.u0 + fwid, u1: fr.u1 - fwid, z0: fr.sill + fwid, z1: fr.sill + fr.h - fwid, sub: "Glass" }];
    const lines = [];
    const top = fr.sill + fr.h, s0 = sMid - 35, s1 = sMid + 35;
    const parts = [
      hostBox(w, fr.u0, fr.u0 + fwid, s0, s1, fr.sill, top, "Frame"), hostBox(w, fr.u1 - fwid, fr.u1, s0, s1, fr.sill, top, "Frame"),
      hostBox(w, fr.u0, fr.u1, s0, s1, fr.sill, fr.sill + fwid, "Frame"), hostBox(w, fr.u0, fr.u1, s0, s1, top - fwid, top, "Frame"),
      hostBox(w, fr.u0 + fwid, fr.u1 - fwid, sMid - 6, sMid + 6, fr.sill + fwid, top - fwid, "Glass"),
      hostBox(w, fr.u0 - 40, fr.u1 + 40, w.stack.s[0], w.stack.s[0] + 50 * out, fr.sill - 30, fr.sill, "Sill"),
    ];
    for (let i = 1; i <= mull; i++) {
      const u = fr.u0 + (fr.u1 - fr.u0) * i / (mull + 1);
      lines.push({ u0: u, z0: fr.sill + fwid, u1: u, z1: top - fwid, sub: "Frame" });
      parts.push(hostBox(w, u - fwid / 2, u + fwid / 2, s0, s1, fr.sill + fwid, top - fwid, "Frame"));
    }
    return { plan, elev: { rects, lines }, data: { value: t.width, kind: "Length", host: fr.host, frame: fr, parts, props: { Width: L(t.width), Height: L(t.height), TypeMark: T(t.mark || t.id), "Sill height": L(fr.sill) } } };
  },
};

// ---------------------------------------------------------------- columns & furniture
declare({ type: "Column", guid: "wb-0301", category: "IfcColumn", kind: "column", idPrefix: "C",
  summary: "A column at a point. Columns do not join to walls — they overlap, deliberately (§16).",
  args: [ point2d("position", "Position", [0, 0]), ref("columnType", "Type", ["columnType"]), ref("baseLevel", "Base level", ["level"]),
          real("height", "Height", 3000, 1, 100000, 1, "mm", { group: "Dimensions" }), real("rotation", "Rotation", 0, -360, 360, 1, "°") ],
  handles: (f) => [{ key: "move", at: F.point(f, "position"), constraint: "free2d", writes: "position" }] });
BUILDERS.Column = {
  precondition: (f) => F.type(f, "columnType") ? null : "pick a column type",
  build: (f, doc) => {
    const t = F.type(f, "columnType"), c = F.point(f, "position"), rot = F.real(f, "rotation") * Math.PI / 180;
    const z0 = levelElev(doc, f), h = F.real(f, "height");
    let path, foot;
    if (t.round) { path = [{ k: "A", c, r: t.width / 2, a0: 0, a1: TAU }]; foot = []; for (let i = 0; i < 16; i++) foot.push(add(c, [Math.cos(i / 16 * TAU) * t.width / 2, Math.sin(i / 16 * TAU) * t.width / 2])); }
    else { foot = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => { const p = [x * t.width / 2, y * t.depth / 2]; return add(c, [p[0] * Math.cos(rot) - p[1] * Math.sin(rot), p[0] * Math.sin(rot) + p[1] * Math.cos(rot)]); }); path = polyPath(foot); }
    return { plan: { path, foot, material: t.material, z0, z1: z0 + h }, data: { value: h, kind: "Length",
      refs: [{ key: "centre", kind: "point", geom: c }], props: { Height: L(h), Width: L(t.width), TypeMark: T(t.mark || t.id) } } };
  },
};

// ---------------------------------------------------------------- floors and beams
//! A floor is a wall laid flat: a boundary instead of a centreline, and the
//! type's layers stacked down from the top surface instead of across from the
//! exterior face. A beam is a column laid along a line: its type's profile
//! swept along the axis, hung from the level by its top.
declare({ type: "Floor", guid: "wb-0401", category: "IfcSlab", kind: "floor", idPrefix: "FL",
  summary: "A boundary on a level, and the type's layers stacked down from its top surface.",
  args: [ json("boundary", "Boundary", [[0, 0], [6000, 0], [6000, 4000], [0, 4000]]), ref("floorType", "Type", ["floorType"]), ref("level", "Level", ["level"]),
          real("heightOffset", "Height offset from level", 0, -10000, 10000, 1, "mm", { group: "Constraints" }) ],
  handles: (f) => { const b = F.json(f, "boundary") || []; return b.map((p, i) => ({ key: "v" + i, at: p, constraint: "free2d", writes: `boundary.${i}` })); } });
BUILDERS.Floor = {
  precondition: (f) => { const b = F.json(f, "boundary"); if (!Array.isArray(b) || b.length < 3) return "a floor needs a boundary of three points or more"; return F.type(f, "floorType") ? null : "pick a floor type"; },
  build: (f, doc) => {
    const t = F.type(f, "floorType"), b = F.json(f, "boundary"), top = levelElev(doc, f, "level") + F.real(f, "heightOffset");
    const layers = t.layers || [{ function: "Structure", thickness: 200, material: "M-CONC" }];
    const parts = []; let z = top;
    for (const L of layers) { parts.push({ foot: b.map(p => p.slice()), z0: z - L.thickness, z1: z, sub: L.function, material: L.material }); z -= L.thickness; }
    const T_ = top - z, area = Math.abs(polyArea(b));
    const per = b.reduce((a, p, i) => a + dist(p, b[(i + 1) % b.length]), 0);
    return { plan: { path: polyPath(b), foot: b, z0: z, z1: top, material: layers[layers.length > 1 ? 1 : 0].material, parts },
      data: { value: area, kind: "Area", parts, props: { Area: { kind: "Area", v: area / 1e6 }, Thickness: L(T_), Perimeter: L(per), "Top elevation": L(top), TypeMark: T(t.mark || t.id) } } };
  },
};
declare({ type: "Beam", guid: "wb-0402", category: "IfcBeam", kind: "beam", idPrefix: "B",
  summary: "A profile swept along a line, hung from its level by its top.",
  args: [ curve2d("axis", "Axis", ["line"], { type: "line", start: [0, 0], end: [6000, 0] }), ref("beamType", "Type", ["beamType"]), ref("level", "Reference level", ["level"]),
          real("topOffset", "Top offset", 0, -10000, 10000, 1, "mm", { group: "Constraints" }) ],
  handles: (f) => { const c = F.json(f, "axis"); return c && c.type === "line" ? [{ key: "start", at: c.start, constraint: "free2d", writes: "axis.start" }, { key: "end", at: c.end, constraint: "free2d", writes: "axis.end", readout: "length" }, { key: "move", at: lerp(c.start, c.end, 0.5), constraint: "free2d", writes: "axis" }] : []; } });
BUILDERS.Beam = {
  precondition: (f) => { const c = F.json(f, "axis"); if (!c || c.type !== "line" || dist(c.start, c.end) < 1) return "a beam needs an axis"; return F.type(f, "beamType") ? null : "pick a beam type"; },
  build: (f, doc) => {
    const t = F.type(f, "beamType"), c = F.json(f, "axis"), top = levelElev(doc, f, "level") + F.real(f, "topOffset");
    const d = normalise(sub(c.end, c.start)), n = perp(d);
    const band = (w, z0, z1, sub_) => ({ foot: [add(c.start, mul(n, -w / 2)), add(c.end, mul(n, -w / 2)), add(c.end, mul(n, w / 2)), add(c.start, mul(n, w / 2))], z0, z1, sub: sub_, material: t.material });
    const D = t.depth || 600, W = t.width || 300;
    const parts = t.shape === "I" ? [band(W, top - (t.flange || 12), top, "Flange"), band(t.web || 8, top - D + (t.flange || 12), top - (t.flange || 12), "Web"), band(W, top - D, top - D + (t.flange || 12), "Flange")] : [band(W, top - D, top, "Beam")];
    const foot = band(W, 0, 0).foot, len = dist(c.start, c.end);
    return { plan: { path: polyPath(foot), foot, axis: c, z0: top - D, z1: top, parts },
      data: { value: len, kind: "Length", parts, refs: [{ key: "axis", kind: "line", geom: lineThrough(c.start, c.end) }], props: { Length: L(len), Depth: L(D), Width: L(W), "Top elevation": L(top), TypeMark: T(t.mark || t.id) } } };
  },
};

declare({ type: "Furniture", guid: "wb-0302", category: "Furniture", kind: "furniture", idPrefix: "FU",
  summary: "A loose furniture item. Its family defines a fill; the presentation style draws it stroke-only.",
  args: [ point2d("position", "Position", [0, 0]), choice("shape", "Shape", ["Table", "Chair", "Desk", "Sofa"], 0), json("size", "Size", [1600, 800], { group: "Dimensions" }), real("rotation", "Rotation", 0, -360, 360, 1, "°"), ref("level", "Level", ["level"]) ],
  handles: (f) => [{ key: "move", at: F.point(f, "position"), constraint: "free2d", writes: "position" }] });
BUILDERS.Furniture = { build: (f, doc) => {
  const c = F.point(f, "position"), [sx, sy] = F.json(f, "size"), rot = F.real(f, "rotation") * Math.PI / 180, shape = F.choice(f, "shape");
  const tr = p => add(c, [p[0] * Math.cos(rot) - p[1] * Math.sin(rot), p[0] * Math.sin(rot) + p[1] * Math.cos(rot)]);
  const rect = (x0, y0, x1, y1) => polyPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(tr));
  const paths = [rect(-sx / 2, -sy / 2, sx / 2, sy / 2)];
  if (shape === "Table" || shape === "Desk") for (const [x, y] of [[-1, 1], [1, 1], [-1, -1], [1, -1]].slice(0, shape === "Table" ? 4 : 0)) paths.push(rect(x * sx / 4 - 225, y * (sy / 2 + 80) - 200, x * sx / 4 + 225, y * (sy / 2 + 80) + 200));
  if (shape === "Sofa") paths.push(rect(-sx / 2, sy / 2 - 200, sx / 2, sy / 2));
  const z0 = levelElev(doc, f, "level");
  return { plan: { paths, fill: "#EEF0F3", z0, z1: z0 + 750 }, data: { props: {} } };
} };

// ---------------------------------------------------------------- spaces (§3.6)
declare({ type: "Space", guid: "wb-0401", category: "IfcSpace", kind: "space", idPrefix: "SP",
  summary: "The volume between two horizontal surfaces, bounded by room-bounding elements. Found by planar face-finding; kept by its anchor.",
  args: [ ref("level", "Level", ["level"]), json("upperLimit", "Upper limit", { mode: "offset", offset: 3000 }), point2d("anchor", "Anchor", [0, 0]),
          choice("boundaryAt", "Boundary at", ["finishFace", "coreFace", "coreCentre", "wallCentre"], 0) ],
  handles: (f) => [{ key: "anchor", at: F.point(f, "anchor"), constraint: "free2d", writes: "anchor" }] });
BUILDERS.Space = { build: (f, doc) => ({ data: { props: {} } }) };      // phase 3 finds its loop

declare({ type: "RoomSeparator", guid: "wb-0402", category: "IfcSpace", kind: "separator", idPrefix: "RS",
  summary: "A room-bounding line with no wall: divides spaces, draws nothing on an issued plan.",
  args: [ curve2d("line", "Line", ["line"], { type: "line", start: [0, 0], end: [1000, 0] }), ref("level", "Level", ["level"]) ] });
BUILDERS.RoomSeparator = { build: () => ({ data: {} }) };

// ---------------------------------------------------------------- views, sheets, schedules (§6, §11)
declare({ type: "PlanView", guid: "wb-0501", category: "View", kind: "view", idPrefix: "V-P",
  summary: "A plan: three planes (top, cut, bottom) over a level. Contents are a query, not references.",
  args: [ ref("level", "Level", ["level"]), integer("scale", "Scale 1:", 100, 1, 5000, { group: "Graphics" }),
          json("viewRange", "View range", { top: 2300, cut: 1200, bottom: 0 }), choice("detailLevel", "Detail level", ["Coarse", "Medium", "Fine"], 2, { group: "Graphics" }),
          ref("style", "View style", ["viewStyle"], { group: "Graphics" }), json("filters", "Filters", [], { group: "Graphics" }),
          json("clip", "Crop region", { rect: [-3000, -3000, 20000, 14000], visible: false, active: false }, { group: "Extents" }),
          json("overrides", "Element overrides", {}, { group: "Graphics" }) ] });
BUILDERS.PlanView = { precondition: (f) => F.reference(f, "level") ? null : "pick a level", build: () => ({ data: {} }) };

declare({ type: "ElevationView", guid: "wb-0502", category: "View", kind: "view", idPrefix: "V-E",
  summary: "A line in plan: the view plane is the line extruded in z, looking along its right-hand normal.",
  args: [ curve2d("line", "View line", ["line"], { type: "line", start: [0, -3000], end: [12000, -3000] }), real("depth", "Depth", 15000, 1, 1e6, 1),
          integer("scale", "Scale 1:", 100, 1, 5000, { group: "Graphics" }), ref("baseLevel", "Base level", ["level"]), real("top", "Top", 6000, 1, 1e5, 1),
          ref("style", "View style", ["viewStyle"], { group: "Graphics" }), choice("detailLevel", "Detail level", ["Coarse", "Medium", "Fine"], 0, { group: "Graphics" }),
          json("clip", "Crop region", { rect: null, visible: false, active: false }, { group: "Extents" }) ],
  handles: (f) => { const c = F.json(f, "line"); return [
    { key: "start", at: c.start, constraint: "free2d", writes: "line.start" }, { key: "end", at: c.end, constraint: "free2d", writes: "line.end" },
    { key: "move", at: lerp(c.start, c.end, 0.5), constraint: "free2d", writes: "line" } ]; } });
BUILDERS.ElevationView = { build: () => ({ data: {} }) };
declare({ type: "SectionView", guid: "wb-0505", category: "View", kind: "view", idPrefix: "V-S",
  summary: "A line in plan cutting the building: what it crosses is drawn cut, layer by layer, and what lies beyond it as in an elevation.",
  args: [ curve2d("line", "Section line", ["line"], { type: "line", start: [0, 4000], end: [12000, 4000] }), real("depth", "Far clip", 15000, 1, 1e6, 1),
          integer("scale", "Scale 1:", 50, 1, 5000, { group: "Graphics" }), ref("baseLevel", "Base level", ["level"]), real("top", "Top", 6000, 1, 1e5, 1),
          ref("style", "View style", ["viewStyle"], { group: "Graphics" }), choice("detailLevel", "Detail level", ["Coarse", "Medium", "Fine"], 2, { group: "Graphics" }),
          json("clip", "Crop region", { rect: null, visible: false, active: false }, { group: "Extents" }) ],
  handles: (f) => { const c = F.json(f, "line"); return [
    { key: "start", at: c.start, constraint: "free2d", writes: "line.start" }, { key: "end", at: c.end, constraint: "free2d", writes: "line.end" },
    { key: "move", at: lerp(c.start, c.end, 0.5), constraint: "free2d", writes: "line" } ]; } });
BUILDERS.SectionView = { build: () => ({ data: {} }) };

declare({ type: "View3D", guid: "wb-0503", category: "View", kind: "view", idPrefix: "V-3D",
  summary: "A camera. On a sheet it becomes exact hidden-line line-work, cached and never interactive (§6.4).",
  args: [ json("camera", "Camera", { azimuth: 225, elevation: 30, target: [6000, 4000, 1500] }), integer("scale", "Scale 1:", 200, 1, 5000, { group: "Graphics" }),
          ref("style", "View style", ["viewStyle"], { group: "Graphics" }), json("render", "Render", { mode: "lines", hidden: false, rasterDPI: 300, silhouetteWeight: 0.35 }, { group: "Graphics" }) ] });
BUILDERS.View3D = { build: () => ({ data: {} }) };

declare({ type: "Schedule", guid: "wb-0504", category: "View", kind: "schedule", idPrefix: "SC",
  summary: "The property panel, transposed: one row per element. Editing a cell edits the model.",
  args: [ choice("of", "Category", ["IfcWall", "IfcDoor", "IfcWindow", "IfcSpace", "IfcColumn"], 0), json("fields", "Fields", ["Id", "TypeMark", "Length", "Height", "FireRating", "Phase"]) ] });
BUILDERS.Schedule = { build: () => ({ data: {} }) };

export const PAPER = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210], "ARCH D": [914.4, 609.6], "ANSI D": [863.6, 558.8] };
declare({ type: "Sheet", guid: "wb-0601", category: "Sheet", kind: "sheet", idPrefix: "SH-",
  summary: "Paper space: a size, a title block and viewports placed in paper millimetres from the bottom-left.",
  args: [ text("number", "Sheet number", "A-101", { group: "Identity Data" }), text("sheetName", "Sheet name", "Plan", { group: "Identity Data" }),
          choice("size", "Size", ["A0", "A1", "A2", "A3", "A4", "ARCH D", "ANSI D", "Custom"], 1), choice("orientation", "Orientation", ["landscape", "portrait"], 0),
          when(json("custom", "Custom size", { w: 600, h: 400 }), "size", "Custom"), ref("titleBlock", "Title block", ["symbol"], { view: true }),
          // Placement is a view-side link: moving a viewport never rebuilds the model (§6.5).
          json("viewports", "Viewports", [], { view: true }), text("revision", "Revision", "P01", { group: "Identity Data" }) ] });
BUILDERS.Sheet = { build: (f) => ({ data: { size: sheetSize(f) } }) };
export function sheetSize(f) {
  const s = F.choice(f, "size");
  let wh = s === "Custom" ? [F.json(f, "custom").w, F.json(f, "custom").h] : PAPER[s];
  const land = F.choice(f, "orientation") === "landscape";
  return land ? [Math.max(...wh), Math.min(...wh)] : [Math.min(...wh), Math.max(...wh)];
}

// ---------------------------------------------------------------- detail elements & annotation (§9)
declare({ type: "Text", guid: "wb-0701", category: "Annotation", kind: "text", idPrefix: "TX",
  summary: "Text in paper millimetres, placed in model coordinates. A leader's target stays put when the text moves.",
  args: [ text("content", "Content", "Note"), point2d("position", "Position", [0, 0]), real("rotation", "Rotation", 0, -360, 360, 1, "°"),
          ref("textType", "Text type", ["textType"], { view: true }), real("wrapWidth", "Wrap width (paper mm)", 60, 1, 1000, 1, ""),
          json("leaders", "Leaders", []), ref("view", "View", ["view"], { view: true }) ],
  handles: (f) => {
    const hs = [{ key: "move", at: F.point(f, "position"), constraint: "free2d", writes: "position" }];
    (F.json(f, "leaders") || []).forEach((l, i) => {
      hs.push({ key: "target" + i, at: l.target, constraint: "free2d", writes: `leaders.${i}.target` });
      if (l.elbow) hs.push({ key: "elbow" + i, at: l.elbow, constraint: "free2d", writes: `leaders.${i}.elbow` });
    });
    return hs;
  } });
BUILDERS.Text = { build: () => ({ data: {} }) };

declare({ type: "DetailLine", guid: "wb-0702", category: "Detail", kind: "detail", idPrefix: "DL",
  summary: "A line that lives in one view. No 3D; appears nowhere else.",
  args: [ curve2d("curve", "Curve", ["line", "arc", "spline"], { type: "line", start: [0, 0], end: [1000, 0] }), choice("pen", "Pen", ["hairline", "thin", "medium", "heavy", "bold"], 1), ref("view", "View", ["view"], { view: true }) ] });
BUILDERS.DetailLine = { build: () => ({ data: {} }) };

declare({ type: "FilledRegion", guid: "wb-0703", category: "Detail", kind: "detail", idPrefix: "FR",
  summary: "A hatched region that lives in one view.",
  args: [ json("boundary", "Boundary", [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]), text("pattern", "Pattern", "P-DIAG"), ref("view", "View", ["view"], { view: true }) ] });
BUILDERS.FilledRegion = { build: () => ({ data: { props: {} } }) };

declare({ type: "SymbolInstance", guid: "wb-0704", category: "Annotation", kind: "detail", idPrefix: "SY",
  summary: "A placed symbol. Paper symbols keep their size on the sheet; model symbols scale with the drawing.",
  args: [ ref("symbol", "Symbol", ["symbol"], { view: true }), point2d("position", "Position", [0, 0]), real("rotation", "Rotation", 0, -360, 360, 1, "°"), ref("view", "View", ["view"], { view: true }) ],
  handles: (f) => [{ key: "move", at: F.point(f, "position"), constraint: "free2d", writes: "position" }] });
BUILDERS.SymbolInstance = { build: () => ({ data: {} }) };

declare({ type: "Dimension", guid: "wb-0705", category: "Annotation", kind: "dimension", idPrefix: "DIM",
  summary: "Binds to references, never to points (§10.2). Padlocked, it is a constraint row.",
  args: [ json("of", "References", []), real("offset", "Offset", 600, -1e5, 1e5, 1), ref("view", "View", ["view"], { view: true }), bool("locked", "Padlocked", false) ] });
BUILDERS.Dimension = { build: () => ({ data: {} }) };   // measured at derive time: annotation stays out of the model graph

// ---------------------------------------------------------------- references resolution (§10.2)
/** "W1:core.exterior" → the reference's current geometry, or null (lost). */
export function resolveReference(doc, key) {
  const [id, rk] = String(key).split(":");
  const f = doc.element(id); if (!f) return null;
  const d = doc.data(f); const refs = d && d.refs;
  if (!refs) {
    if (doc.typeOf(f) === "Level" && rk === "plane") return { key: rk, kind: "plane", z: d ? d.value : 0 };
    return null;
  }
  return refs.find(r => r.key === rk) || null;
}
/** A dimension's value between two references, measured on the analytic geometry. */
export function measureRefs(doc, keys) {
  const R = keys.map(k => resolveReference(doc, k));
  const lost = keys.filter((k, i) => !R[i]);
  if (lost.length) return { lost };
  const [a, b] = R;
  if (a.kind === "line" && b.kind === "line") {
    const par = Math.abs(a.geom.d[0] * b.geom.d[1] - a.geom.d[1] * b.geom.d[0]) < 1e-6;
    if (!par) return { value: null, why: "the references are not parallel" };
    return { value: Math.abs(signedDistance(a.geom, b.geom.p)), a, b, kind: "parallel" };
  }
  const pa = a.kind === "point" ? a.geom : a.kind === "line" ? a.geom.p : null;
  const pb = b.kind === "point" ? b.geom : b.kind === "line" ? projectPoint(b.geom, pa) : null;
  if (a.kind === "point" && b.kind === "line") return { value: Math.abs(signedDistance(b.geom, a.geom)), a, b, kind: "pointLine" };
  if (a.kind === "line" && b.kind === "point") return { value: Math.abs(signedDistance(a.geom, b.geom)), a, b, kind: "pointLine" };
  if (pa && pb) return { value: dist(pa, pb), a, b, kind: "points" };
  return { value: null, why: "these references cannot be measured against each other" };
}

// ---------------------------------------------------------------- phase 3: the system pass
/** Joins, openings into hosts, solids with batched cuts, spaces. Reads the
 *  unjoined reps every wall built for itself; writes resolved ones. */
export function systemPass(doc, rebuilt) {
  const walls = new Map();
  for (const f of doc.elements()) if (doc.typeOf(f) === "Wall" && !doc.error(f) && doc.plan(f)) walls.set(doc.idOf(f), doc.plan(f));
  const relKey = JSON.stringify(doc.joins) + "|" + doc.relationRevision;
  const relationsChanged = relKey !== doc._lastRelKey; doc._lastRelKey = relKey;
  const notes = resolveJoins(walls, doc.joins);
  // Openings per host.
  const openingsOf = new Map();
  for (const f of doc.elements()) if (doc.typeOf(f) === "Opening" && !doc.error(f)) {
    const d = doc.data(f); if (!d || !d.frame || d.frame.flagged) continue;
    const fr = d.frame;
    const cuts = h => { const z0 = walls.get(fr.host)?.z0 ?? 0; return h > z0 + fr.sill + TOL && h < z0 + fr.sill + fr.h - TOL; };
    if (!openingsOf.has(fr.host)) openingsOf.set(fr.host, []);
    openingsOf.get(fr.host).push({ id: doc.idOf(f), u0: fr.u0, u1: fr.u1, sill: fr.sill, h: fr.h, recess: fr.recess, far: fr.far, cuts });
  }
  // Which walls' resolved reps are dirty: rebuilt, joined to rebuilt, or hosting a rebuilt opening.
  const dirty = new Set();
  for (const f of rebuilt) {
    const id = doc.idOf(f), ty = doc.typeOf(f);
    if (ty === "Wall") { dirty.add(id); const w = walls.get(id); if (w) for (const j of w.joinedTo) dirty.add(j); }
    if (ty === "Opening") { const d = doc.data(f); if (d && d.frame) dirty.add(d.frame.host); }
  }
  if (relationsChanged) for (const id of walls.keys()) dirty.add(id);
  doc.stats.resolved = doc.stats.resolved || {};
  for (const [id, w] of walls) {
    w.openings = openingsOf.get(id) || [];
    w.joinNotes = notes.get(id) || [];
    if (!dirty.has(id) && w.pieces) continue;
    doc.stats.resolved[id] = (doc.stats.resolved[id] || 0) + 1;
    try { w.pieces = wallPieces(w, solidSpans(w, w.openings, doc.stats)); w.solidError = null; }
    catch (e) { w.solidError = e.message; w.pieces = w.pieces || []; }
    w.resolvedRev = ++doc.modelRevision;
  }
  // Spaces, per level and boundary mode — only when something bounding changed.
  const spaceTouched = [...rebuilt].some(f => ["Wall", "Space", "RoomSeparator", "Level"].includes(doc.typeOf(f))) || relationsChanged || doc._spacesDirty;
  if (spaceTouched) { computeSpaces(doc, walls); doc._spacesDirty = false; }
}

/** Room-bounding curves at a level for a boundary mode, as segments. */
function boundingSegments(doc, walls, levelId, mode) {
  const segs = [];
  const addPath = path => { const pts = samplePath(path, 48); for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]); };
  const solids = [];
  for (const [id, w] of walls) {
    const f = doc.element(id); if (F.refId(f, "baseLevel") !== levelId) continue;
    if (mode === "wallCentre") { addPath(w.curve.segs()); continue; }
    if (mode === "coreCentre") {
      const s = (w.stack.s[w.stack.cs] + w.stack.s[w.stack.ce]) / 2;
      const c = s === 0 ? w.curve : w.curve.offset(s); addPath(c.segs()); continue;
    }
    // Face modes: outlines of the joined regions (before any opening — a doorway
    // does not break a room, test 51). Coarse for finish faces, core band for core faces.
    const regs = mode === "finishFace" ? wallRegions(w, "Coarse", Infinity, []) : coreRegions(w);
    for (const r of regs) { addPath(r.path); solids.push(samplePath(r.path, 48)); }
  }
  for (const f of doc.elements()) if (doc.typeOf(f) === "RoomSeparator" && F.refId(f, "level") === levelId) { const c = F.json(f, "line"); segs.push([c.start, c.end]); }
  return { segs, solids };
}
function coreRegions(w) {
  // The core band alone, with the wall's own end terminators.
  const saveLayers = w.stack.layers;
  const tmp = Object.assign({}, w, { stack: Object.assign({}, w.stack, { s: [w.stack.s[w.stack.cs], w.stack.s[w.stack.ce]], layers: [{ function: "Structure", thickness: 1, priority: 1 }], cs: 0, ce: 1 }), offsets: new Map() });
  void saveLayers;
  try { return wallRegions(tmp, "Coarse", Infinity, []); } catch (e) { return []; }
}
function computeSpaces(doc, walls) {
  const spaces = doc.elements().filter(f => doc.typeOf(f) === "Space");
  const groups = new Map();
  for (const f of spaces) { const k = (F.refId(f, "level") || "") + "|" + F.choice(f, "boundaryAt"); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
  for (const [k, fs] of groups) {
    const [levelId, mode] = k.split("|");
    const { segs, solids } = boundingSegments(doc, walls, levelId, mode);
    let loops = segs.length ? findLoops(segs, { tol: 0.5 }).loops : [];
    if (solids.length) loops = filterWallFaces(loops, p => solids.some(s => pointInPoly(p, s)));
    const claims = claimLoops(loops, fs.map(f => ({ id: doc.idOf(f), anchor: F.point(f, "anchor") })));
    const lv = levelId && doc.element(levelId), z0 = lv ? doc.data(lv)?.value ?? 0 : 0;
    for (const f of fs) {
      const c = claims[doc.idOf(f)] || { loop: null, status: "not enclosed" };
      const up = F.json(f, "upperLimit") || {};
      const upper = up.mode === "toLevel" && up.level ? ((doc.element(up.level.ref) && doc.data(doc.element(up.level.ref))?.value) ?? z0 + 3000) + (up.offset || 0) : z0 + (up.offset ?? 3000);
      const area = c.loop ? c.loop.net : 0;
      const perim = c.loop ? c.loop.pts.reduce((acc, p, i, a) => acc + dist(p, a[(i + 1) % a.length]), 0) : 0;
      const plan = { loop: c.loop, status: c.status, mode, z0, z1: upper };
      f.child(PLAN_TAG).set("Json", plan);
      const props = { Area: { kind: "Area", v: area }, Perimeter: L(perim), Volume: { kind: "Number", v: area * (upper - z0) / 1e9 },
        Name: T(f.get("Name")), "Boundary basis": T(mode) };
      f.child(DATA_TAG).set("Json", { value: area, kind: "Area", props });
      const note = c.status === "ok" ? null : c.status === "redundant" ? "another space already claims this room — pick which one keeps it" : "not enclosed: kept with its name and number, waiting for its room";
      if (note) f.child(NOTE_TAG).set("Text", note); else f.forget(NOTE_TAG);
    }
  }
  doc.bumpView();
}

// ---------------------------------------------------------------- documents
export function newDocument(name = "Untitled") {
  const doc = new Document();
  doc.meta.name = name;
  Object.assign(doc.lib, {
    categories: clone(CATEGORIES), paramSpecs: clone(PARAM_SPECS), pens: { "PEN-ISO": clone(PEN_ISO) }, patterns: clone(PATTERNS),
    materials: clone(MATERIALS), symbols: clone(SYMBOLS), families: clone(FAMILIES), types: clone(TYPES), textTypes: clone(TEXT_TYPES),
    viewStyles: { "VS-PRESENTATION": clone(VS_PRESENTATION), "VS-CONSTRUCTION": clone(VS_CONSTRUCTION) },
  });
  attach(doc);
  return doc;
}
/** Hook the system pass and the accessor to a document (new or loaded). */
export function attach(doc) {
  if (!doc.systemPasses.includes(systemPass)) doc.systemPasses.push(systemPass);
  const run = doc.regenerate.bind(doc);
  doc.regenerate = () => { F.doc = doc; const r = run(); annotateDangling(doc, r); return r; };
  const ex = doc.execute.bind(doc);
  doc.execute = (f) => { F.doc = doc; return ex(f); };
  return doc;
}
/** Dangling references are notes on the holder, never a load failure (§2.3). */
function annotateDangling(doc, rebuilt) {
  for (const f of rebuilt) {
    const dang = danglingRefs(doc, f);
    if (!dang.length) continue;
    const had = doc.note(f);
    const msg = `missing reference${dang.length > 1 ? "s" : ""}: ${dang.join(", ")}`;
    if (!(had || "").includes(msg)) doc.setNote(f, had ? had + "; " + msg : msg);
  }
}
export function openDocument(json) {
  const doc = loadDocument(json);
  // Fill library sections a file left out, so an older file still draws.
  const defaults = newDocument();
  for (const k of Object.keys(defaults.lib)) if (!Object.keys(doc.lib[k]).length && Object.keys(defaults.lib[k]).length) { doc.lib[k] = defaults.lib[k]; doc.loadReport.push(`no ${k} in the file: using the defaults`); doc._filledLibs = (doc._filledLibs || []).concat(k); }
  attach(doc);
  return doc;
}
