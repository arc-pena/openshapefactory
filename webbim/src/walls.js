//! Walls, derived the way a draftsman draws them (spec §3): a wall is bounded
//! by surfaces; its plan is those surfaces cut at a height; in the common case
//! (everything vertical and horizontal) that cut is independent of the height
//! and collapses to offsetting the centreline — the fast path.

import {
  TOL, sub, add, mul, dot, cross, dist, perp, normalise, lerp, curveOf, DegenerateOffset, LoopingOffset,
  intersectLines, intersectLineCircle, angleOf, wrap, TAU, fitBeziers, clipHalf, polyPath, lineThrough, segStart, segEnd,
} from "./geom2d.js";

/** Layer function → join priority (§3.4). Membrane: zero thickness, never participates. */
export const LAYER_PRIORITY = { "Structure": 1, "Substrate": 2, "Thermal": 3, "Air": 3, "Thermal/Air": 3, "Finish 1": 4, "Finish 2": 5, "Membrane": 99 };
export const MIN_FACE_RADIUS = 5;   // mm: a face tighter than this is not a wall face, it is a point

// ---------------------------------------------------------------- layer stack
/** Signed left-offsets of every layer boundary, exterior face first.
 *  Exterior is on the RIGHT of travel unless flipped: a room drawn
 *  anticlockwise gets its finishes inside (spec §13 draws W1→W2 that way). */
export function layerStack(type, mounting, mountOffset = 0, flipped = false) {
  const layers = (type.layers || []).map(l => Object.assign({}, l, { priority: LAYER_PRIORITY[l.function] ?? 4 }));
  const c = [0]; for (const l of layers) c.push(c[c.length - 1] + l.thickness);
  const T = c[c.length - 1];
  const cs = type.coreStart ?? 0, ce = type.coreEnd ?? layers.length;
  const m = {
    "Centred": T / 2, "Wall centreline": T / 2, "Core centre": (c[cs] + c[ce]) / 2,
    "Finish exterior": 0, "Finish interior": T, "Core exterior": c[cs], "Core interior": c[ce],
    "Offset": T / 2 - mountOffset,
  }[mounting] ?? T / 2;
  const sgn = flipped ? -1 : 1;
  const s = c.map(ci => sgn * (ci - m));
  return { layers, s, T, cs, ce, flipped };
}

// ---------------------------------------------------------------- the surface set (§3.1)
//! A plane is { n:[x,y,z] (unit), c } with n·X = c. Six per layer. Every corner
//! is a three-plane intersection — Cramer's rule, one expression, no iteration.
export function plane(n, p) { const l = Math.hypot(...n); const u = n.map(x => x / l); return { n: u, c: u[0] * p[0] + u[1] * p[1] + u[2] * p[2] }; }
export function intersect3(A, B, C) {
  const [a, b, c] = [A.n, B.n, C.n];
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(det) < 1e-12) return null;
  const d = [A.c, B.c, C.c];
  const col = (i, v) => [0, 1, 2].map(r => [a, b, c][r].map((x, j) => j === i ? v[r] : x));
  const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  return [det3(col(0, d)) / det, det3(col(1, d)) / det, det3(col(2, d)) / det];
}

/** The six surfaces of a straight wall layer between boundaries sa, sb. Lean
 *  tilts the faces about the base line toward the wall's left; a raking top
 *  rises along the wall. Offsets are measured perpendicular to the face, so a
 *  leaning wall's horizontal spacing is s / cos(lean) (test 47). */
export function wallSurfaces(w, sa, sb, startPlane = null, endPlane = null) {
  const { a, d, z0, z1, lean, topSlope, L } = w;
  const n2 = perp(d);
  const cl = Math.cos(lean), sl = Math.sin(lean);
  const face = s => {
    const p = add(a, mul(n2, s / cl));
    const up = [n2[0] * sl, n2[1] * sl, cl];            // in-plane "up" of a leaning face
    const nrm = cross3([d[0], d[1], 0], up);          // horizontal direction × lean-up
    return plane(nrm, [p[0], p[1], z0]);
  };
  const tt = Math.tan(topSlope);
  return {
    outer: face(sa), inner: face(sb),
    base: plane([0, 0, 1], [0, 0, z0]),
    top: plane([-d[0] * tt, -d[1] * tt, 1], [a[0], a[1], z1]),
    start: startPlane || plane([-d[0], -d[1], 0], [a[0], a[1], 0]),
    end: endPlane || plane([d[0], d[1], 0], [a[0] + d[0] * L, a[1] + d[1] * L, 0]),
  };
}
const cross3 = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

/** The 8 corners of a layer hexahedron: every one a three-surface intersection. */
export function layerCorners(S) {
  const out = [];
  for (const f of [S.outer, S.inner]) for (const h of [S.base, S.top]) for (const e of [S.start, S.end]) out.push(intersect3(f, h, e));
  return out;   // order: (outer|inner) × (base|top) × (start|end)
}

/** Plan cut at height h: each surface meets z = h in a line; the region is the
 *  intersection of their half-planes. General path (§3.1) — sloped, stepped,
 *  inclined — and counted, so the fast path can prove it was not taken (test 45). */
export function cutAtHeight(S, h, stats) {
  if (stats) stats.surfacePath++;
  if (h < S.base.c - TOL) return [];
  const big = 1e7;
  let poly = [[-big, -big], [big, -big], [big, big], [-big, big]];
  // Keep the side of each plane where the solid is: evaluate with an interior probe.
  const probe = interiorProbe(S);
  for (const key of ["outer", "inner", "start", "end", "top"]) {
    const P = S[key];
    const n2 = [P.n[0], P.n[1]], c2 = P.c - P.n[2] * h;
    const ln = Math.hypot(n2[0], n2[1]);
    if (ln < 1e-12) { if ((P.n[2] * h - P.c) * (dot3(P.n, probe) - P.c) < 0) return []; continue; }
    const p = mul(n2, c2 / (ln * ln)), dd = normalise(perp(n2));
    const L = { p, d: dd };
    const inside = cross(dd, sub([probe[0], probe[1]], p)) >= 0;
    // for "top", the solid is below: the side of the trace where the plane is above h
    poly = clipHalf(poly, L, key === "top" ? (P.n[2] * (P.c - dot2(n2, [probe[0], probe[1]])) / (P.n[2] * P.n[2]) > h ? inside : !inside) : inside);
    if (poly.length < 3) return [];
  }
  return poly;
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
function interiorProbe(S) {
  const cs = layerCorners(S).filter(Boolean);
  const m = cs.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return m.map(x => x / cs.length);
}

// ---------------------------------------------------------------- the wall record
/** Everything a wall's drawing and solid are derived from, built in phase 2.
 *  Offsets themselves are NOT built here: they are computed per detail level
 *  on demand and counted (test 13), so coarse never builds the intermediate ones. */
export function wallRecord({ id, centreline, type, mounting, mountOffset, flipped, z0, height, slope, stats }) {
  const curve = curveOf(centreline);
  const stack = layerStack(type, mounting, mountOffset, flipped);
  const lean = ((slope && slope.lean) || 0) * Math.PI / 180;
  const topSlope = ((slope && slope.top) || 0) * Math.PI / 180;
  if (curve.type === "arc" || curve.type === "circle") {
    // Toward the centre is the left of an anticlockwise arc. The largest offset
    // that way must leave a face, or the wall has no inner side (§3.2, test 11).
    const inward = Math.max(0, ...stack.s.map(s => curve.ccw ? s : -s));
    if (curve.radius - inward < MIN_FACE_RADIUS) {
      throw new Error(`the inner face of this wall would self-intersect at r=${round(curve.radius)}mm; minimum radius for this type is ${round(inward + MIN_FACE_RADIUS)}mm`);
    }
  }
  const fast = Math.abs(lean) < 1e-12 && Math.abs(topSlope) < 1e-12;
  // A raking top rises (or falls) along the wall: the band a view tests is the whole range.
  const rise = curve.length * Math.tan(topSlope);
  const rec = {
    id, curve, type, stack, z0, z1: z0 + height, height, lean, topSlope, fast,
    zLo: z0, zHi: z0 + height + Math.max(0, rise), zTopMin: z0 + height + Math.min(0, rise),
    a: curve.start, d: curve.type === "line" ? curve.tangentAt(0) : null, L: curve.length,
    offsets: new Map(), stats,
  };
  return rec;
}
const round = x => Math.round(x);

/** The boundary curve at stack index i, computed once per build and counted. */
export function boundary(w, i) {
  let c = w.offsets.get(i);
  if (!c) {
    if (w.stats) w.stats.offsets++;
    try { c = w.curve.offset(w.stack.s[i]); }
    catch (e) { if (e instanceof DegenerateOffset || e instanceof LoopingOffset) throw new Error(`boundary ${i} of ${w.id}: ${e.message}`); throw e; }
    w.offsets.set(i, c);
  }
  return c;
}
/** A point on boundary s at centreline arc length u — exact for lines and arcs. */
export function pointAt(w, s, u) {
  const t = Math.max(0, Math.min(1, u / w.L));
  return add(w.curve.at(t), mul(w.curve.normalAt(t), s));
}
export function normalLineAt(w, u) {
  const t = Math.max(0, Math.min(1, u / w.L));
  return { p: w.curve.at(t), d: w.curve.normalAt(t) };
}
export function faceLine(w, s) {
  if (w.curve.type !== "line") return null;
  return { p: add(w.a, mul(perp(w.d), s)), d: w.d };
}

// ---------------------------------------------------------------- references (§10.2)
/** Named references. The key is stable; the geometry is recomputed every build. */
export function wallReferences(w) {
  const S = w.stack.s, n = S.length - 1;
  const mk = (key, s) => ({ key, kind: w.curve.type === "line" ? "line" : "curve", s,
    geom: w.curve.type === "line" ? faceLine(w, s) : { curve: w.curve, s } });
  const refs = [
    mk("centreline", 0),
    mk("face.exterior", S[0]), mk("face.interior", S[n]),
    mk("core.exterior", S[w.stack.cs]), mk("core.interior", S[w.stack.ce]),
    { key: "end.start", kind: "point", geom: w.curve.start },
    { key: "end.end", kind: "point", geom: w.curve.end },
  ];
  return refs;
}

// ---------------------------------------------------------------- terminators & regions
//! A terminator closes a layer's span: {k:"normal", u} — the plane normal to the
//! curve (a free end or a jamb); {k:"line", L} — another surface's trace (a butt
//! against a layer of another wall); {k:"poly", pts} — a mitre polyline at a node.
//! Choosing the terminator IS the join (§3.4): the geometry after is one intersection.

export function termPoint(w, s, term, nearU) {
  if (term.k === "normal") return pointAt(w, s, term.u);
  const guess = pointAt(w, s, nearU);
  const hitOn = L => {
    if (w.curve.type === "line") return intersectLines(faceLine(w, s), L);
    if (w.curve.type === "arc" || w.curve.type === "circle") {
      const r = w.curve.ccw ? w.curve.radius - s : w.curve.radius + s;
      const hits = intersectLineCircle(L, w.curve.centre, r);
      let best = null, bd = Infinity; for (const h of hits) { const dd = dist(h, guess); if (dd < bd) { bd = dd; best = h; } }
      return best;
    }
    // A sampled curve has no closed-form meet with a line: take the nearest
    // sample crossing. (Joins on ellipse/spline walls are reported as free ends.)
    return null;
  };
  if (term.k === "line") return hitOn(term.L) || guess;
  // poly: the segment the boundary crosses; else the nearest extension
  let best = null, bd = Infinity;
  for (let i = 0; i < term.pts.length - 1; i++) {
    const A = term.pts[i], B = term.pts[i + 1];
    const L = lineThrough(A, B); if (!L.d[0] && !L.d[1]) continue;
    const h = hitOn(L); if (!h) continue;
    const t = dot(sub(h, A), L.d), segL = dist(A, B);
    const out = t < -TOL ? -t : t > segL + TOL ? t - segL : 0;
    const score = out * 1e3 + dist(h, guess) * 1e-6;
    if (score < bd) { bd = score; best = h; }
  }
  return best || guess;
}
/** u (centreline arc length) of a point on boundary s — for ordering spans. */
export function uOf(w, p) {
  if (w.curve.type === "line") return dot(sub(p, w.a), w.d);
  if (w.curve.type === "arc" || w.curve.type === "circle") {
    let da = angleOf(w.curve.centre, p) - w.curve.a0;
    da = w.curve.sweep > 0 ? wrap(da) : wrap(-da);
    if (da > Math.abs(w.curve.sweep) + 1e-9 && !w.curve.closed) { const back = TAU - da; if (back < da - Math.abs(w.curve.sweep)) da = -back; }
    return da * w.curve.radius;
  }
  return w.curve.lengthAt(p);
}

/** The boundary curve between two points (in the curve's direction). */
export function boundarySegs(w, i, pA, pB) {
  const s = w.stack.s[i];
  const c = boundary(w, i);
  if (c.type === "line") return [{ k: "L", a: pA, b: pB }];
  if (c.type === "arc" || c.type === "circle") {
    const aA = angleOf(c.centre, pA), aB = angleOf(c.centre, pB);
    let sw = c.sweep > 0 ? wrap(aB - aA) : -wrap(aA - aB);
    if (Math.abs(sw) < 1e-12 && dist(pA, pB) > TOL) sw = c.sweep > 0 ? TAU : -TAU;
    return [{ k: "A", c: c.centre, r: c.radius, a0: aA, a1: aA + sw }];
  }
  // ellipse/spline offset: refit the span to Béziers within OFFSET_TOL (§3.2)
  const tA = Math.max(0, Math.min(1, w.curve.lengthAt(pA) / w.L)), tB = Math.max(0, Math.min(1, w.curve.lengthAt(pB) / w.L));
  const fn = t => add(w.curve.at(t), mul(w.curve.normalAt(t), s));
  const tan = t => { const h = 1e-4; return normalise(sub(fn(Math.min(1, t + h)), fn(Math.max(0, t - h)))); };
  return fitBeziers(fn, tan, tA, tB, 0.5);
}

/** One closed layer region between boundaries lo and hi, from term0 to term1.
 *  Returns { path, edges } where each edge carries its role for graphics. */
export function layerRegion(w, lo, hi, t0, t1, roles) {
  const sLo = w.stack.s[lo], sHi = w.stack.s[hi];
  const u0 = t0.u ?? t0.nearU ?? 0, u1 = t1.u ?? t1.nearU ?? w.L;
  const P0 = termPoint(w, sLo, t0, u0), P1 = termPoint(w, sLo, t1, u1);
  const Q0 = termPoint(w, sHi, t0, u0), Q1 = termPoint(w, sHi, t1, u1);
  // Degenerate span (a trim consumed it): drop it rather than draw a sliver.
  if (uOf(w, P1) - uOf(w, P0) < -TOL && uOf(w, Q1) - uOf(w, Q0) < -TOL) return null;
  const bLo = boundarySegs(w, lo, P0, P1);
  const bHi = boundarySegs(w, hi, Q0, Q1);
  const capPts = (t, A, B) => {       // A on lo, B on hi
    if (t.k !== "poly") return [A, B];
    // include the polyline's interior vertices that lie between A and B
    const inner = t.pts.slice(1, -1).filter(v => {
      const sd = sideOf(w, v, (uOf(w, A) + uOf(w, B)) / 2);
      return sd > Math.min(sLo, sHi) + TOL && sd < Math.max(sLo, sHi) - TOL;
    });
    inner.sort((x, y) => (sideOf(w, x) - sLo) * Math.sign(sHi - sLo) - (sideOf(w, y) - sLo) * Math.sign(sHi - sLo));
    return [A, ...inner, B];
  };
  const endCap = capPts(t1, P1, Q1), startCap = capPts(t0, P0, Q0).reverse();
  const path = [], edges = [];
  const pushSegs = (segs, role) => { for (const s of segs) { path.push(s); edges.push({ seg: s, role }); } };
  pushSegs(bLo, roles.lo);
  pushSegs(polyPath(endCap, false), roles.end);
  pushSegs(reverseAll(bHi), roles.hi);
  pushSegs(polyPath(startCap, false), roles.start);
  return { path, edges };
}
function reverseAll(segs) {
  return segs.slice().reverse().map(s => s.k === "L" ? { k: "L", a: s.b, b: s.a } : s.k === "A" ? { k: "A", c: s.c, r: s.r, a0: s.a1, a1: s.a0 } : { k: "C", a: s.b, c1: s.c2, c2: s.c1, b: s.a });
}
/** Signed left-offset of a point relative to the centreline. */
export function sideOf(w, p, nearU = null) {
  if (w.curve.type === "line") return dot(sub(p, w.a), perp(w.d));
  if (w.curve.type === "arc" || w.curve.type === "circle") { const r = dist(p, w.curve.centre); return w.curve.ccw ? w.curve.radius - r : r - w.curve.radius; }
  const u = nearU ?? w.curve.lengthAt(p); const t = u / w.L;
  return dot(sub(p, w.curve.at(t)), w.curve.normalAt(t));
}

// ---------------------------------------------------------------- 3D pieces
/** Convex hexahedra for the 3D view and HLR: one per u-span of the coarse
 *  wall (openings split it; a straight span is one piece, an arc span is
 *  chorded). Corners come from intersect3 on the surface set. */
export function wallPieces(w, spans, opts = {}) {
  const pieces = [];
  const n = w.stack.s.length - 1;
  for (const sp of spans) {
    const segsN = w.curve.type === "line" ? 1 : Math.max(1, Math.ceil(Math.abs(sp.u1 - sp.u0) / (opts.chord || 400)));
    for (let k = 0; k < segsN; k++) {
      const ua = sp.u0 + (sp.u1 - sp.u0) * k / segsN, ub = sp.u0 + (sp.u1 - sp.u0) * (k + 1) / segsN;
      const t0 = k === 0 ? sp.t0 : { k: "normal", u: ua }, t1 = k === segsN - 1 ? sp.t1 : { k: "normal", u: ub };
      // A recess span keeps only the part of the thickness behind the void.
      const sa = sp.sRange ? sp.sRange[0] : w.stack.s[0], sb = sp.sRange ? sp.sRange[1] : w.stack.s[n];
      const foot = [termPoint(w, sa, t0, ua), termPoint(w, sa, t1, ub), termPoint(w, sb, t1, ub), termPoint(w, sb, t0, ua)];
      const zb = sp.zb ?? w.z0, zt = sp.zt ?? w.z1;
      pieces.push({ foot, z0: zb, z1: zt, topAt: w.topSlope ? (p => w.z1 + Math.tan(w.topSlope) * uOf(w, p) + (zt - w.z1)) : null, lean: w.lean, n2: w.d ? perp(w.d) : null, zRef: w.z0, openingSide: sp.openingSide });
    }
  }
  return pieces;
}
