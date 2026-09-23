//! The BIM sketch: the parametric CAD's drawing, used the way Revit and ArchiCAD use a sketch.
//!
//! A floor's boundary, a crop region, anything drawn as closed loops, is stored in the CAD's own
//! drawing format ({ elements, constraints }, cad/src/sketch.js) and solved by the CAD's own
//! kernel. What differs is the hand: here nobody places a Coincident. Ends that land on each other
//! are welded automatically (weld), and dragging or moving an element drags the ends welded to it,
//! so a loop stays closed the way joined walls stay joined. The constraints are all there - open
//! the same floor in the Parametric CAD interface and they are drawn as its relation marks - they
//! are only not asked for.
//!
//! Dimensions are the other half, as the plan's wall dimensions are: a length, a distance between
//! parallel lines, an angle or a radius, shown as a temporary dimension and padlocked to hold.
//! They live in `dims` beside the drawing, not in its constraints, because the CAD solver has no
//! such relation: it would carry them without understanding them. They are held here, by moving
//! what they measure, between passes of the CAD solver.

import { cadSketchLoops, cadSketchNesting, cadSketchOutline, cadSketchEnds, cadSketchEndKeys, cadSketchHandles, cadSketchMoveHandle,
  cadSolveSketch, cadCoincidentGroup, cadSketchFillet, cadNextSketchId, cadSketchDistanceTo, cadEllipseAt } from "./cadsketch.js";

const skAdd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const skSub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const skMul = (a, k) => [a[0] * k, a[1] * k];
const skDot = (a, b) => a[0] * b[0] + a[1] * b[1];
const skDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const skUnit = a => { const l = Math.hypot(a[0], a[1]); return l < 1e-12 ? [1, 0] : [a[0] / l, a[1] / l]; };
const skLeft = a => [-a[1], a[0]];
const skClone = x => JSON.parse(JSON.stringify(x));
const SK_TAU = Math.PI * 2;

export const WELD_TOL = 1;            // mm: ends closer than this are one corner
export const emptySketch = () => ({ elements: [], constraints: [], dims: [] });
export const sketchOf = d => Object.assign(emptySketch(), skClone(d || {}));
export const newId = (d, prefix = "e") => cadNextSketchId(d, prefix);
export const outline = (el, q = 64) => cadSketchOutline(el, q);
export const distanceTo = (el, p) => cadSketchDistanceTo(el, p);

/** Each end of each element, by its handle name: [{ ref, id, key, p }]. */
export function endsOf(d) {
  const out = [];
  for (const el of d.elements) {
    const e = cadSketchEnds(el), k = cadSketchEndKeys(el); if (!e || e.closed || !k) continue;
    out.push({ ref: el.id + "." + k.a, id: el.id, key: k.a, p: e.a }, { ref: el.id + "." + k.b, id: el.id, key: k.b, p: e.b });
  }
  return out;
}
/** The hidden constraints: every pair of ends that touch is welded - snapped to one point and held
 *  by a coincidence. Rebuilt after every edit, so what touches is joined and what was pulled apart
 *  on purpose is not. Other relations (a fillet's tangencies) are kept while their elements live. */
export function weld(d, tol = WELD_TOL) {
  const w = skClone(d), ids = new Set(w.elements.map(e => e.id));
  w.constraints = (w.constraints || []).filter(c => c.type !== "coincident" && (c.of || []).every(r => ids.has(String(r).split(".")[0])));
  w.dims = (w.dims || []).filter(x => (x.of || []).every(id => ids.has(id)));
  const ends = endsOf(w), byId = new Map(w.elements.map(e => [e.id, e]));
  const groups = [];
  for (const e of ends) {
    const g = groups.find(g => skDist(g.p, e.p) <= tol);
    if (g) g.refs.push(e); else groups.push({ p: e.p, refs: [e] });
  }
  for (const g of groups) {
    if (g.refs.length < 2) continue;
    for (const e of g.refs) cadSketchMoveHandle(byId.get(e.id), e.key, g.p);
    for (let i = 1; i < g.refs.length; i++) w.constraints.push({ type: "coincident", of: [g.refs[0].ref, g.refs[i].ref] });
  }
  return w;
}
/** Where a handle is now. */
function handleAt(w, ref) {
  const [id, key] = ref.split("."), el = w.elements.find(e => e.id === id); if (!el) return null;
  const h = cadSketchHandles(el).find(([k]) => k === key); return h ? { el, key, p: h[1] } : null;
}
/** Move a handle and everything welded to it. */
function moveGroup(w, ref, to) {
  for (const r of [ref, ...cadCoincidentGroup(w, ref)]) { const h = handleAt(w, r); if (h) cadSketchMoveHandle(h.el, h.key, to); }
}
/** After an element changed, the ends welded to it go where its ends now are (neighbours stretch). */
function followEnds(w, id, before) {
  const el = w.elements.find(e => e.id === id), e = el && cadSketchEnds(el), k = el && cadSketchEndKeys(el);
  if (!e || e.closed || !k) return;
  for (const [key, p] of [[k.a, e.a], [k.b, e.b]]) for (const r of cadCoincidentGroup(before || w, id + "." + key)) {
    const h = handleAt(w, r); if (h && h.el.id !== id) cadSketchMoveHandle(h.el, h.key, p);
  }
}

// ---------------------------------------------------------------- loops and regions
/** The closed loops, and which are holes in which: { regions: [{ outer, holes }], open, error }.
 *  Rings are sampled polygons in plan mm; outers counter-clockwise, holes clockwise. */
export function regionsOf(d, quality = 48) {
  const w = weld(sketchOf(d));
  if (!w.elements.length) return { regions: [], open: [], error: "the sketch is empty - draw a closed boundary" };
  const { loops, open } = cadSketchLoops(w, WELD_TOL);
  if (open.length) {
    const byId = new Map(w.elements.map(e => [e.id, e])), ch = open[0], el = byId.get(ch[ch.length - 1].id), e = el && cadSketchEnds(el);
    const at = e ? (ch[ch.length - 1].reversed ? e.a : e.b) : [0, 0];
    return { regions: [], open, error: `the boundary is open near (${Math.round(at[0])}, ${Math.round(at[1])}) - its ends must meet` };
  }
  const nest = cadSketchNesting(w, loops, quality);
  const area2 = r => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const orient = (r, ccw) => { const pts = dedupe(r); return (area2(pts) > 0) === ccw ? pts : pts.reverse(); };
  const regions = [];
  nest.forEach((n, i) => { if (!n.hole) regions.push({ index: i, outer: orient(n.ring, true), holes: [] }); });
  nest.forEach(n => { if (n.hole) { const r = regions.find(x => x.index === n.parent); if (r) r.holes.push(orient(n.ring, false)); } });
  return { regions: regions.map(({ outer, holes }) => ({ outer, holes })), open: [], error: null };
}
function dedupe(r) {
  const out = [];
  for (const p of r) if (!out.length || skDist(out[out.length - 1], p) > 1e-6) out.push([p[0], p[1]]);
  if (out.length > 2 && skDist(out[0], out[out.length - 1]) < 1e-6) out.pop();
  return out;
}
/** A polygon with holes as one simple polygon, each hole joined to the outline by a two-way cut -
 *  what an ear-clipper can fill. The cut's two edges coincide; whoever draws edges draws the rings. */
export function bridgeHoles(outer, holes) {
  let poly = outer.slice();
  const sorted = (holes || []).filter(h => h.length >= 3).map(h => ({ h, x: Math.max(...h.map(p => p[0])) })).sort((a, b) => b.x - a.x);
  for (const { h } of sorted) {
    const hi = h.reduce((b, p, i) => (p[0] > h[b][0] ? i : b), 0), m = h[hi];
    // the nearest outline vertex the hole's rightmost point can see
    let best = -1, bd = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const q = poly[i], dd = skDist(m, q); if (dd >= bd) continue;
      let blocked = false;
      for (let j = 0; j < poly.length && !blocked; j++) { const a = poly[j], b = poly[(j + 1) % poly.length]; if (j === i || (j + 1) % poly.length === i) continue; if (segCross(m, q, a, b)) blocked = true; }
      for (let j = 0; j < h.length && !blocked; j++) { const a = h[j], b = h[(j + 1) % h.length]; if (j === hi || (j + 1) % h.length === hi) continue; if (segCross(m, q, a, b)) blocked = true; }
      if (!blocked) { best = i; bd = dd; }
    }
    if (best < 0) continue;
    const ring = h.slice(hi).concat(h.slice(0, hi));
    poly = poly.slice(0, best + 1).concat(ring, [ring[0], poly[best]], poly.slice(best + 1));
  }
  return poly;
}
function segCross(p, q, a, b) {
  const o = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const d1 = o(a, b, p), d2 = o(a, b, q), d3 = o(p, q, a), d4 = o(p, q, b);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

// ---------------------------------------------------------------- dimensions (held here)
/** What a dimension measures now, and where to draw it: { value, a, b, kind, unit }. */
export function measureDim(d, dim) {
  const el = i => d.elements.find(e => e.id === dim.of[i]);
  const A = el(0), B = dim.of.length > 1 ? el(1) : null; if (!A) return null;
  if (dim.type === "length" && A.type === "line") return { value: skDist(A.a, A.b), a: A.a, b: A.b, unit: "mm" };
  if (dim.type === "radius" && (A.type === "arc" || A.type === "circle")) { const ang = A.type === "arc" ? (A.a0 + A.a1) / 2 : Math.PI / 4; return { value: A.r, a: A.c, b: skAdd(A.c, [A.r * Math.cos(ang), A.r * Math.sin(ang)]), unit: "mm", radius: true }; }
  if (dim.type === "distance" && B && A.type === "line" && B.type === "line") {
    const u = skUnit(skSub(A.b, A.a)), n = skLeft(u), m = skMul(skAdd(B.a, B.b), 0.5), s = skDot(skSub(m, A.a), n), foot = skAdd(A.a, skMul(u, skDot(skSub(m, A.a), u)));
    return { value: Math.abs(s), a: foot, b: skAdd(foot, skMul(n, s)), unit: "mm", signed: s };
  }
  if (dim.type === "angle" && B && A.type === "line" && B.type === "line") {
    const ua = skUnit(skSub(A.b, A.a)), ub = skUnit(skSub(B.b, B.a));
    let ang = Math.acos(Math.max(-1, Math.min(1, skDot(ua, ub)))) * 180 / Math.PI;
    const X = lineX(A.a, A.b, B.a, B.b) || A.b;
    return { value: ang, a: X, b: X, unit: "°", corner: X, ua, ub };
  }
  return null;
}
/** The dimensions a selection offers (Revit's temporary dimensions): a line's length, an arc's radius. */
export function tempDimsFor(d, ids) {
  const out = [];
  for (const id of ids) { const el = d.elements.find(e => e.id === id); if (!el) continue;
    if (el.type === "line") out.push({ type: "length", of: [id] });
    if (el.type === "arc" || el.type === "circle") out.push({ type: "radius", of: [id] }); }
  if (ids.length === 2) {
    const [A, B] = ids.map(id => d.elements.find(e => e.id === id));
    if (A && B && A.type === "line" && B.type === "line") {
      const ua = skUnit(skSub(A.b, A.a)), ub = skUnit(skSub(B.b, B.a)), par = Math.abs(ua[0] * ub[1] - ua[1] * ub[0]) < 1e-3;
      out.push({ type: par ? "distance" : "angle", of: [A.id, B.id] });
    }
  }
  return out;
}
const sameDim = (a, b) => a.type === b.type && JSON.stringify(a.of) === JSON.stringify(b.of);
/** Hold one dimension at its value, moving what is not pinned (and what is welded to it). */
function holdDim(w, dim, pinned) {
  const m = measureDim(w, dim); if (!m) return 0;
  const want = dim.value, err = Math.abs(m.value - want); if (err < 1e-6) return 0;
  const el = i => w.elements.find(e => e.id === dim.of[i]);
  const isPinned = ref => pinned.has(ref) || cadCoincidentGroup(w, ref).some(r => pinned.has(r));
  if (dim.type === "length") {
    const L = el(0), u = skUnit(skSub(L.b, L.a));
    if (!isPinned(L.id + ".b")) moveGroup(w, L.id + ".b", skAdd(L.a, skMul(u, want)));
    else if (!isPinned(L.id + ".a")) moveGroup(w, L.id + ".a", skSub(L.b, skMul(u, want)));
  } else if (dim.type === "radius") {
    const C = el(0), before = skClone(w); C.r = Math.max(1, want); followEnds(w, C.id, before);
  } else if (dim.type === "distance") {
    const B = el(1), A = el(0), n = skLeft(skUnit(skSub(A.b, A.a))), s = Math.sign(m.signed || 1), shift = skMul(n, s * (want - m.value));
    const [mv, other] = isPinned(B.id + ".a") || isPinned(B.id + ".b") ? [A, -1] : [B, 1];
    const by = skMul(shift, other), before = skClone(w);
    mv.a = skAdd(mv.a, by); mv.b = skAdd(mv.b, by); followEnds(w, mv.id, before);
  } else if (dim.type === "angle") {
    const A = el(0), B = el(1), X = m.corner, ua = skUnit(skSub(A.b, A.a)), ub = skUnit(skSub(B.b, B.a));
    const cur = Math.atan2(ua[0] * ub[1] - ua[1] * ub[0], skDot(ua, ub)), sgn = cur >= 0 ? 1 : -1, target = sgn * want * Math.PI / 180, turn = target - cur;
    const rot = p => { const v = skSub(p, X); return skAdd(X, [v[0] * Math.cos(turn) - v[1] * Math.sin(turn), v[0] * Math.sin(turn) + v[1] * Math.cos(turn)]); };
    const before = skClone(w); B.a = rot(B.a); B.b = rot(B.b); followEnds(w, B.id, before);
  }
  return err;
}
/** Solve: the locked dimensions, then the CAD kernel's relations, in turn until they agree. */
export function solve(d, pinned = []) {
  let w = skClone(d); const pin = new Set(pinned);
  for (let pass = 0; pass < 20; pass++) {
    let err = 0;
    for (const dim of w.dims || []) if (dim.locked) err += holdDim(w, dim, pin);
    const dims = w.dims; w = cadSolveSketch(w, 8, [...pin]).drawing; w.dims = dims;
    if (err < 1e-6) break;
  }
  return w;
}
/** Type a dimension's value: what it measures moves to it. Locked dimensions hold as it does. */
export function setDimValue(d, dim, value) {
  const w = skClone(d); w.dims = w.dims || [];
  let row = w.dims.find(x => sameDim(x, dim));
  const tmp = !row; if (tmp) { row = Object.assign({}, dim, { locked: true }); w.dims.push(row); }
  const wasLocked = row.locked; row.value = value; row.locked = true;
  const out = solve(w);
  const r2 = out.dims.find(x => sameDim(x, dim));
  if (tmp) out.dims = out.dims.filter(x => x !== r2); else r2.locked = wasLocked;
  return out;
}
export function toggleLock(d, dim) {
  const w = skClone(d); w.dims = w.dims || [];
  const row = w.dims.find(x => sameDim(x, dim));
  if (row) { row.locked = !row.locked; if (!row.locked && !row.kept) w.dims = w.dims.filter(x => x !== row); return w; }
  const m = measureDim(w, dim); if (!m) return w;
  w.dims.push(Object.assign({}, dim, { value: Math.round(m.value * 1000) / 1000, locked: true }));
  return w;
}
export function addDim(d, dim) {
  const w = skClone(d); w.dims = w.dims || []; const m = measureDim(w, dim); if (!m || w.dims.some(x => sameDim(x, dim))) return w;
  w.dims.push(Object.assign({}, dim, { value: Math.round(m.value * 1000) / 1000, locked: false, kept: true })); return w;
}

// ---------------------------------------------------------------- editing
/** Drag a handle: it and everything welded to it go there; locked dimensions hold. */
export function dragHandle(d, ref, to) {
  const w = skClone(d), group = [ref, ...cadCoincidentGroup(w, ref)];
  moveGroup(w, ref, to);
  return solve(w, group);
}
/** Move, rotate or scale elements: points through f, radii times k, angles plus a. The ends of
 *  elements left behind that were welded to them stretch to follow, so the loop stays closed. */
export function transform(d, ids, f, k = 1, a = 0) {
  const w = skClone(d), set = new Set(ids), before = skClone(w);
  for (const el of w.elements) if (set.has(el.id)) xform(el, f, k, a);
  for (const id of set) followEnds(w, id, before);
  const pinned = w.elements.filter(e => set.has(e.id)).flatMap(e => cadSketchHandles(e).map(([key]) => e.id + "." + key));
  return solve(w, pinned);
}
function xform(el, f, k, a) {
  if (el.type === "line") { el.a = f(el.a); el.b = f(el.b); }
  else if (el.type === "arc") { el.c = f(el.c); el.r *= k; if (k < 0) { el.r = -el.r; } el.a0 += a; el.a1 += a; }
  else if (el.type === "circle") { el.c = f(el.c); el.r *= Math.abs(k); }
  else if (el.type === "ellipse") { el.c = f(el.c); el.rx *= Math.abs(k); el.ry *= Math.abs(k); el.rot = (el.rot || 0) + a; }
  else if (el.type === "spline") el.pts = el.pts.map(f);
  else if (el.type === "bspline") el.ctrl = el.ctrl.map(f);
  else if (el.type === "rect") { el.a = f(el.a); el.b = f(el.b); }
}
/** Scale along one direction u about c by k. Lines and splines stay what they are (an affine map
 *  keeps them); a circle becomes an ellipse; an arc or a turned ellipse becomes a spline through
 *  points on it, because nothing else draws a squashed arc. */
export function scale1d(d, ids, c, u, k) {
  u = skUnit(u);
  const f = p => { const v = skSub(p, c), t = skDot(v, u); return skAdd(p, skMul(u, (k - 1) * t)); };
  const w = skClone(d), set = new Set(ids), before = skClone(w);
  w.elements = w.elements.map(el => {
    if (!set.has(el.id)) return el;
    if (el.type === "circle") { const rot = Math.atan2(u[1], u[0]); return { id: el.id, type: "ellipse", c: f(el.c), rx: el.r * Math.abs(k), ry: el.r, rot }; }
    if (el.type === "arc" || el.type === "ellipse") {
      const pts = cadSketchOutline(el, 48).map(f), closed = el.type === "ellipse" && !cadSketchEnds(el).a;
      return { id: el.id, type: "spline", pts: closed ? pts.slice(0, -1).filter((_, i) => i % 3 === 0) : pts.filter((_, i, A) => i % 3 === 0 || i === A.length - 1), closed };
    }
    const c2 = skClone(el); xform(c2, f, 1, 0); return c2;
  });
  for (const id of set) followEnds(w, id, before);
  return solve(w, w.elements.filter(e => set.has(e.id)).flatMap(e => cadSketchHandles(e).map(([key]) => e.id + "." + key)));
}
export function remove(d, ids) { const w = skClone(d), set = new Set(ids); w.elements = w.elements.filter(e => !set.has(e.id)); return weld(w); }
export function addElements(d, els) { const w = skClone(d); for (const el of els) { const e = skClone(el); if (!e.id || w.elements.some(x => x.id === e.id)) e.id = newId(w); w.elements.push(e); } return weld(w); }

// ---------------------------------------------------------------- offset
/** The chain an element is in (a closed loop or an open run), walked in order. */
function chainOf(w, id) {
  const { loops, open } = cadSketchLoops(w, WELD_TOL);
  for (const ch of loops) if (ch.some(s => s.id === id)) return { steps: ch, closed: true };
  for (const ch of open) if (ch.some(s => s.id === id)) return { steps: ch, closed: false };
  return { steps: [{ id, reversed: false }], closed: false };
}
/** Offset an element's whole chain by dist toward the side of `toward` - Revit's sketch Offset,
 *  AutoCAD's OFFSET on a polyline. Lines slide along their normals and meet again; arcs and circles
 *  change radius; splines move their points along the curve's normal. With copy, the offset chain
 *  is added and the original kept. Returns the new drawing and the ids made. */
export function offsetChain(d, id, toward, dist, copy = true) {
  const w0 = weld(sketchOf(d)), { steps, closed } = chainOf(w0, id);
  const byId = new Map(w0.elements.map(e => [e.id, e]));
  // which side: the clicked element's walk direction against the cursor
  const pick = byId.get(id), st = steps.find(s => s.id === id), run = cadSketchOutline(pick, 32);
  const walk = st && st.reversed ? run.slice().reverse() : run;
  let bi = 0, bd = Infinity; for (let i = 0; i < walk.length - 1; i++) { const dd = skDist(toward, skMul(skAdd(walk[i], walk[i + 1]), 0.5)); if (dd < bd) { bd = dd; bi = i; } }
  const dir = walk.length > 1 ? skSub(walk[Math.min(bi + 1, walk.length - 1)], walk[bi]) : [1, 0];
  const s = Math.sign(dir[0] * (toward[1] - walk[bi][1]) - dir[1] * (toward[0] - walk[bi][0])) || 1;   // +1: left of the walk
  const off = s * dist, made = [];
  const w = copy ? skClone(w0) : w0;
  const newEls = steps.map(({ id: eid, reversed }) => {
    const el = skClone(byId.get(eid)); if (copy) el.id = newId({ elements: w.elements.concat(made.map(x => ({ id: x }))) }, "o"), made.push(el.id);
    offsetOne(el, reversed, off);
    return { el, reversed };
  });
  // consecutive pieces meet again where they cross, if they no longer touch
  const ends = x => { const e = cadSketchEnds(x.el); return x.reversed ? { a: e.a, b: e.b, fa: "b", fb: "a" } : { a: e.a, b: e.b, fa: "a", fb: "b" }; };
  for (let i = 0; i < newEls.length; i++) {
    const A = newEls[i], B = newEls[(i + 1) % newEls.length]; if (!closed && i === newEls.length - 1) break; if (A === B) break;
    const ea = cadSketchEnds(A.el), eb = cadSketchEnds(B.el); if (!ea || ea.closed || !eb || eb.closed) continue;
    const tailA = A.reversed ? ea.a : ea.b, headB = B.reversed ? eb.b : eb.a; if (skDist(tailA, headB) < 1e-6) continue;
    const X = meetPoint(A.el, B.el, skMul(skAdd(tailA, headB), 0.5)); if (!X) continue;
    setEnd(A.el, A.reversed ? "a" : "b", X); setEnd(B.el, B.reversed ? "b" : "a", X);
  }
  if (copy) { for (const x of newEls) w.elements.push(x.el); }
  else { const put = new Map(newEls.map(x => [x.el.id, x.el])); w.elements = w.elements.map(e => put.get(e.id) || e); }
  return { drawing: weld(w), made };
}
function offsetOne(el, reversed, off) {
  const sg = reversed ? -1 : 1;
  if (el.type === "line") { const n = skLeft(skUnit(skSub(el.b, el.a))); const v = skMul(n, off * sg); el.a = skAdd(el.a, v); el.b = skAdd(el.b, v); }
  else if (el.type === "arc") { const ccw = el.a1 > el.a0 ? 1 : -1; el.r = Math.max(1, el.r - off * sg * ccw); }    // left of a ccw walk is the centre
  else if (el.type === "circle") el.r = Math.max(1, el.r - off);                                                   // a circle walks ccw
  else if (el.type === "ellipse") { el.rx = Math.max(1, el.rx - off); el.ry = Math.max(1, el.ry - off); }
  else if (el.type === "spline" || el.type === "bspline") {
    const key = el.type === "spline" ? "pts" : "ctrl", pts = el[key], n = pts.length;
    el[key] = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], t = el.closed ? skSub(pts[(i + 1) % n], pts[(i - 1 + n) % n]) : skSub(b, a); return skAdd(p, skMul(skLeft(skUnit(t)), off * sg)); });
  }
}
function setEnd(el, which, X) {
  const k = cadSketchEndKeys(el); if (!k) return;
  cadSketchMoveHandle(el, which === "a" ? k.a : k.b, X);
}
const lineX = (a, b, c, d) => {
  const r = skSub(b, a), s = skSub(d, c), den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den; return skAdd(a, skMul(r, t));
};
function circleLine(c, r, a, b) {
  const d = skSub(b, a), f = skSub(a, c), A = skDot(d, d), B = 2 * skDot(f, d), C = skDot(f, f) - r * r, disc = B * B - 4 * A * C; if (disc < 0 || A < 1e-12) return [];
  const sq = Math.sqrt(disc); return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].map(t => skAdd(a, skMul(d, t)));
}
function circleCircle(c1, r1, c2, r2) {
  const d = skDist(c1, c2); if (d < 1e-9 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a)), u = skUnit(skSub(c2, c1)), m = skAdd(c1, skMul(u, a));
  return [skAdd(m, skMul(skLeft(u), h)), skAdd(m, skMul(skLeft(u), -h))];
}
/** Where two elements' lines or circles cross, nearest `near`. */
function meetPoint(A, B, near) {
  const L = e => e.type === "line", C = e => e.type === "arc" || e.type === "circle";
  let pts = [];
  if (L(A) && L(B)) { const x = lineX(A.a, A.b, B.a, B.b); if (x) pts = [x]; }
  else if (L(A) && C(B)) pts = circleLine(B.c, B.r, A.a, A.b);
  else if (C(A) && L(B)) pts = circleLine(A.c, A.r, B.a, B.b);
  else if (C(A) && C(B)) pts = circleCircle(A.c, A.r, B.c, B.r);
  return pts.length ? pts.reduce((b, p) => (skDist(p, near) < skDist(b, near) ? p : b)) : null;
}

// ---------------------------------------------------------------- corner and fillet
/** AutoCAD's FILLET: two lines (or a line and an arc) that do not meet are trimmed or extended to
 *  meet at a sharp corner, keeping the part of each that was picked; with a radius the corner is
 *  then rounded by the CAD kernel's own fillet (which keeps the arc tangent under later edits). */
export function fillet(d, idA, pickA, idB, pickB, radius = 0) {
  if (idA === idB) throw new Error("pick two different elements");
  let w = weld(sketchOf(d));
  const A = w.elements.find(e => e.id === idA), B = w.elements.find(e => e.id === idB);
  if (!A || !B) throw new Error("pick two elements of the sketch");
  const ok = e => e.type === "line" || e.type === "arc";
  if (!ok(A) || !ok(B)) throw new Error("fillet works between lines and arcs");
  const near = skMul(skAdd(pickA, pickB), 0.5), X = meetPoint(A, B, near);
  if (!X) throw new Error("those two are parallel - they never meet");
  const before = skClone(w);
  for (const [el, pick] of [[A, pickA], [B, pickB]]) trimToward(el, X, pick);
  // the ends that moved take their welded neighbours along only if they were the corner itself
  void before;
  w = weld(w);
  if (radius > 0) {
    const r = cadSketchFillet(w, idA, idB, radius, newId(w, "f"));
    w = r.drawing; w.dims = d.dims || [];
    w = weld(w);
  }
  return w;
}
/** Move the end of `el` that should reach X: the part holding the pick is kept. */
function trimToward(el, X, pick) {
  if (el.type === "line") {
    const u = skSub(el.b, el.a), L2 = skDot(u, u) || 1, tX = skDot(skSub(X, el.a), u) / L2, tP = skDot(skSub(pick, el.a), u) / L2;
    if (tX >= 1 - 1e-9) el.b = X; else if (tX <= 1e-9) el.a = X; else if (tP > tX) el.a = X; else el.b = X;
  } else if (el.type === "arc") {
    const ang = p => Math.atan2(p[1] - el.c[1], p[0] - el.c[0]), s = el.a1 - el.a0, dirn = Math.sign(s) || 1;
    const along = p => (((ang(p) - el.a0) * dirn % SK_TAU) + SK_TAU) % SK_TAU;           // 0..TAU from a0 in the sweep's direction
    const tX = along(X), tP = along(pick), sw = Math.abs(s);
    const toA = tX > sw ? (SK_TAU - tX < tX - sw) : tP > tX;                            // beyond the sweep: extend the nearer end
    if (toA) el.a0 = el.a0 + dirn * (tX > sw ? tX - SK_TAU : tX); else el.a1 = el.a0 + dirn * tX;
  }
}

// ---------------------------------------------------------------- building blocks for tools
export function arcThrough3(a, b, m) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = m[0], cy = m[1];
  const Dd = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)); if (Math.abs(Dd) < 1e-9) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / Dd;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / Dd;
  const c = [ux, uy], r = skDist(c, a), angOf = p => Math.atan2(p[1] - uy, p[0] - ux);
  const a0 = angOf(a), a1 = angOf(b), am = angOf(m), ccw = x => ((x % SK_TAU) + SK_TAU) % SK_TAU;
  const sweep = ccw(a1 - a0), mid = ccw(am - a0);
  return mid <= sweep ? { type: "arc", c, r, a0, a1: a0 + sweep } : { type: "arc", c, r, a0: a1, a1: a1 + (SK_TAU - sweep) };
}
/** The loops as the CAD sketcher wants them: geometry and the coincidences/tangencies, no dims. */
export function forCad(d) { const w = weld(sketchOf(d)); return { elements: w.elements, constraints: w.constraints }; }
/** A drawing made from a plain polygon (a floor drawn before sketches, an imported slab). */
export function fromPolygon(pts) {
  const w = emptySketch();
  pts.forEach((p, i) => w.elements.push({ id: "e" + (i + 1), type: "line", a: [p[0], p[1]], b: [pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]] }));
  return weld(w);
}
export const ellipsePoint = (el, t) => cadEllipseAt(el, t);
export const handlesOf = el => cadSketchHandles(el);

// ---------------------------------------------------------------- shapes from clicks (walls, and anything else that draws)
/** How many clicks finish a shape; 0 = a chain, ended by Enter, a double-click or closing on its start. */
export const SHAPE_CLICKS = { line: 0, rect: 2, polygon: 2, arc: 3, circle: 2, ellipse: 3, spline: 0, bspline: 0 };
/** The sketch elements a run of clicks makes (the cursor may be the last one, for a preview). */
export function shapeFromClicks(shape, P, { sides = 6, closed = false } = {}) {
  const n = P.length, out = [];
  if (shape === "line") { for (let i = 0; i + 1 < n; i++) if (skDist(P[i], P[i + 1]) > 1e-6) out.push({ type: "line", a: P[i], b: P[i + 1] }); if (closed && n > 2) out.push({ type: "line", a: P[n - 1], b: P[0] }); }
  else if (shape === "rect" && n >= 2) { const [a, b] = P, c = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; for (let k = 0; k < 4; k++) out.push({ type: "line", a: c[k], b: c[(k + 1) % 4] }); }
  else if (shape === "polygon" && n >= 2) {
    const [c, v] = P, N = Math.max(3, Math.round(sides) || 6), r = skDist(c, v), a0 = Math.atan2(v[1] - c[1], v[0] - c[0]);
    const cs = Array.from({ length: N }, (_, k) => [c[0] + r * Math.cos(a0 + k * SK_TAU / N), c[1] + r * Math.sin(a0 + k * SK_TAU / N)]);
    cs.forEach((p, k) => out.push({ type: "line", a: p, b: cs[(k + 1) % N] }));
  }
  else if (shape === "arc" && n === 2) out.push({ type: "line", a: P[0], b: P[1] });
  else if (shape === "arc" && n >= 3) { const el = arcThrough3(P[0], P[1], P[2]); if (el) out.push(el); }
  else if (shape === "circle" && n >= 2) out.push({ type: "circle", c: P[0], r: Math.max(1, skDist(P[0], P[1])) });
  else if (shape === "ellipse" && n >= 2) {
    const ax = P[1], rx = skDist(P[0], ax), rot = Math.atan2(ax[1] - P[0][1], ax[0] - P[0][0]);
    const v = n >= 3 ? skSub(P[2], P[0]) : null, ry = v ? Math.abs(-Math.sin(rot) * v[0] + Math.cos(rot) * v[1]) : rx / 2;
    out.push({ type: "ellipse", c: P[0], rx: Math.max(1, rx), ry: Math.max(1, Math.min(ry, rx * 0.999 + 1e-6)), rot });
  }
  else if (shape === "spline" && n >= 2) out.push({ type: "spline", pts: P.slice(), closed });
  else if (shape === "bspline" && n >= 2) out.push({ type: "bspline", ctrl: P.slice(), degree: 3, closed });
  return out.map((e, i) => Object.assign({ id: "e" + (i + 1) }, e));
}
/** Round every corner where two lines meet (Revit's Radius option on a wall chain). */
export function filletCorners(d, radius) {
  let w = weld(sketchOf(d));
  for (let guard = 0; guard < 200; guard++) {
    const lines = w.elements.filter(e => e.type === "line");
    let pair = null;
    for (const c of w.constraints) {
      if (c.type !== "coincident") continue;
      const [ra, rb] = c.of.map(r => r.split(".")[0]), A = lines.find(e => e.id === ra), B = lines.find(e => e.id === rb);
      if (!A || !B) continue;
      const ua = skUnit(skSub(A.b, A.a)), ub = skUnit(skSub(B.b, B.a));
      if (Math.abs(ua[0] * ub[1] - ua[1] * ub[0]) < 1e-6) continue;                 // straight on: no corner
      if (w.constraints.some(t => t.type === "tangent" && t.of.includes(ra) && t.of.includes(rb))) continue;
      if (w.elements.some(e => e.type === "arc" && w.constraints.some(t => t.type === "tangent" && t.of.includes(e.id) && t.of.includes(ra)) && w.constraints.some(t => t.type === "tangent" && t.of.includes(e.id) && t.of.includes(rb)))) continue;
      pair = [A, B]; break;
    }
    if (!pair) break;
    const [A, B] = pair;
    try { w = fillet(w, A.id, skMul(skAdd(A.a, A.b), 0.5), B.id, skMul(skAdd(B.a, B.b), 0.5), radius); }
    catch (e) { w.constraints.push({ type: "tangent", of: [A.id, B.id] }); }            // cannot round this one: leave it sharp, and move on
  }
  w.constraints = w.constraints.filter(c => !(c.type === "tangent" && c.of.length === 2 && w.elements.filter(e => c.of.includes(e.id)).every(e => e.type === "line")));
  return w;
}
/** A sketch element as a wall centreline (geom2d's curve JSON). A spline by control points has no
 *  wall curve of its own, so it becomes the through-points spline of points sampled on it. */
export function toCentreline(el) {
  const deg = r => r * 180 / Math.PI;
  if (el.type === "line") return { type: "line", start: el.a.slice(), end: el.b.slice() };
  if (el.type === "arc") { const ccw = el.a1 > el.a0; return { type: "arc", centre: el.c.slice(), radius: el.r, start: deg(ccw ? el.a0 : el.a0), end: deg(el.a1), ccw }; }
  if (el.type === "circle") return { type: "circle", centre: el.c.slice(), radius: el.r };
  if (el.type === "ellipse") return { type: "ellipse", centre: el.c.slice(), rx: el.rx, ry: el.ry, rotation: deg(el.rot || 0) };
  if (el.type === "spline") { const pts = el.pts.map(p => p.slice()); if (el.closed) pts.push(pts[0].slice()); return { type: "spline", points: pts }; }
  if (el.type === "bspline") { const pts = cadSketchOutline(el, 64).filter((_, i, A) => i % 4 === 0 || i === A.length - 1); return { type: "spline", points: pts.map(p => p.slice()) }; }
  return null;
}
