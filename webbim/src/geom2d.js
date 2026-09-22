//! Plane geometry: the nine closed-form primitives of spec §10.6, arcs, the
//! Curve2D family a wall centreline can be, and the path/region vocabulary the
//! 2D scene is written in.
//!
//! Lines are always `P + t·d` with a unit `d`. There is no slope-intercept form
//! anywhere in this file, so a vertical line is not special: every intersection
//! is one determinant and one `|det| < TOL` check (acceptance test 33a/33b).

export const TOL = 1e-6;          // model mm — every coincidence test goes through this
// |det| of two unit directions is the sine of the angle between them. 1e-5 is
// 0.00057°: two walls 0.0001° apart are parallel, not an intersection 500m
// away (test 33b); the smallest deliberate angle a person draws is far above it.
export const ANG_TOL = 1e-5;
export const OFFSET_TOL = 0.5;    // mm — refit tolerance for ellipse/spline offsets (§3.2)
export const MITER_LIMIT = 4;     // × offset, then bevel (§3.4)

// ---------------------------------------------------------------- vectors
export const v = (x, y) => [x, y];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = a => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const perp = a => [-a[1], a[0]];
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const normalise = a => { const l = len(a); return l < TOL ? [0, 0] : [a[0] / l, a[1] / l]; };
export const near = (a, b, tol = TOL) => dist(a, b) <= tol;
export const rot = (a, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [a[0] * c - a[1] * s, a[0] * s + a[1] * c]; };

// ---------------------------------------------------------------- lines (§10.6)
export const lineThrough = (p, q) => ({ p, d: normalise(sub(q, p)) });
export const normalOf = L => perp(L.d);
export const offsetLine = (L, k) => ({ p: add(L.p, mul(normalOf(L), k)), d: L.d });

/** Intersection of two infinite lines, or null when parallel within tolerance. */
export function intersectLines(A, B) {
  const det = cross(A.d, B.d);
  if (Math.abs(det) < ANG_TOL) return null;
  const t = cross(sub(B.p, A.p), B.d) / det;
  return add(A.p, mul(A.d, t));
}
export const projectPoint = (L, P) => add(L.p, mul(L.d, dot(sub(P, L.p), L.d)));
export const signedDistance = (L, P) => dot(sub(P, L.p), normalOf(L));
export const miterPoint = (A, B, k) => intersectLines(offsetLine(A, k), offsetLine(B, k));
export const bisector = (A, B) => sub(normalise(A.d), normalise(B.d));
export const signedAngle = (A, B) => Math.atan2(cross(A.d, B.d), dot(A.d, B.d));
export const pointAlong = (L, t) => add(L.p, mul(L.d, t));
export const paramOn = (L, P) => dot(sub(P, L.p), L.d);

// ---------------------------------------------------------------- arcs
/** An arc is { c, r, a0, a1, ccw }. Offsetting keeps the centre (exact, free). */
export const offsetArcR = (r, k, ccw) => ccw ? r - k : r + k;   // + k is to the LEFT of travel

/** Line/circle: 0, 1 or 2 points (a quadratic). */
export function intersectLineCircle(L, c, r) {
  const f = sub(L.p, c);
  const b = dot(f, L.d), cc = dot(f, f) - r * r;
  const disc = b * b - cc;
  if (disc < -TOL) return [];
  if (Math.abs(disc) <= TOL) return [add(L.p, mul(L.d, -b))];
  const s = Math.sqrt(disc);
  return [add(L.p, mul(L.d, -b - s)), add(L.p, mul(L.d, -b + s))];
}
/** Circle/circle via the radical line, then line/circle. */
export function intersectCircles(c0, r0, c1, r1) {
  const d = dist(c0, c1);
  if (d < TOL || d > r0 + r1 + TOL || d < Math.abs(r0 - r1) - TOL) return [];
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const u = normalise(sub(c1, c0));
  const m = add(c0, mul(u, a));
  return intersectLineCircle({ p: m, d: perp(u) }, c0, r0);
}
export const angleOf = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
export const TAU = Math.PI * 2;
export const wrap = a => { a %= TAU; return a < 0 ? a + TAU : a; };
/** Signed sweep from a0 to a1 in the arc's own direction, in (0, 2π]. */
export const sweepOf = (a0, a1, ccw) => { let s = ccw ? wrap(a1 - a0) : -wrap(a0 - a1); if (Math.abs(s) < 1e-12) s = ccw ? TAU : -TAU; return s; };

// ---------------------------------------------------------------- Curve2D
//! A Curve2D is data (JSON on disk): {type:"line", start, end} ·
//! {type:"arc", centre, radius, start (deg), end (deg), ccw} ·
//! {type:"circle", centre, radius} · {type:"ellipse", centre, rx, ry, rotation} ·
//! {type:"spline", points:[...]} (a Catmull-Rom through the points).
//! `curveOf(json)` wraps it with an evaluator; everything downstream reads the
//! evaluator, so "a wall from a line" and "a wall from an arc" share one idea of
//! what a curve is.

export function curveOf(j) {
  switch (j.type) {
    case "line": return lineCurve(j.start, j.end);
    case "arc": return arcCurve(j.centre, j.radius, j.start * Math.PI / 180, j.end * Math.PI / 180, j.ccw !== false);
    case "circle": return arcCurve(j.centre, j.radius, 0, TAU, true, true);
    case "ellipse": return sampledCurve(ellipseFn(j), true, "ellipse");
    case "spline": return sampledCurve(catmull(j.points), false, "spline");
    default: throw new Error(`a centreline of type "${j.type}" is not one of line, arc, circle, ellipse, spline`);
  }
}

function lineCurve(a, b) {
  const L = len(sub(b, a));
  const d = normalise(sub(b, a));
  return {
    type: "line", closed: false, start: a, end: b, length: L, exact: true,
    at: t => lerp(a, b, t), tangentAt: () => d, normalAt: () => perp(d),
    atLength: s => add(a, mul(d, s)),
    lengthAt: p => dot(sub(p, a), d),
    line: { p: a, d },
    /** Exact offset; k positive to the LEFT of travel. */
    offset: k => lineCurve(add(a, mul(perp(d), k)), add(b, mul(perp(d), k))),
    segs: () => [{ k: "L", a, b }],
    reversed: () => lineCurve(b, a),
  };
}

function arcCurve(c, r, a0, a1, ccw, closed = false) {
  const sweep = closed ? TAU : sweepOf(a0, a1, ccw);
  const at = t => { const a = a0 + sweep * t; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; };
  const tan = t => { const a = a0 + sweep * t; const s = Math.sign(sweep); return [-Math.sin(a) * s, Math.cos(a) * s]; };
  const self = {
    type: closed ? "circle" : "arc", closed, centre: c, radius: r, a0, a1: a0 + sweep, sweep, ccw: sweep > 0, exact: true,
    start: at(0), end: at(1), length: Math.abs(sweep) * r,
    at, tangentAt: tan, normalAt: t => perp(tan(t)),
    atLength: s => at(s / (Math.abs(sweep) * r)),
    lengthAt: p => { let da = angleOf(c, p) - a0; da = sweep > 0 ? wrap(da) : wrap(-da); return da * r; },
    /** Same centre, radius ∓ k: exact (§3.2 table). Throws a sentence when degenerate. */
    offset: k => {
      const r2 = sweep > 0 ? r - k : r + k;
      if (r2 <= TOL) throw new DegenerateOffset(r, k);
      return arcCurve(c, r2, a0, a0 + sweep, sweep > 0, closed);
    },
    segs: () => [{ k: "A", c, r, a0, a1: a0 + sweep }],
    reversed: () => arcCurve(c, r, a0 + sweep, a0, !(sweep > 0), closed),
  };
  return self;
}

export class DegenerateOffset extends Error {
  constructor(r, k) { super(`offset ${Math.abs(k).toFixed(0)}mm collapses a ${r.toFixed(0)}mm radius`); this.r = r; this.k = k; }
}

function ellipseFn(j) {
  const rot = (j.rotation || 0) * Math.PI / 180, c = j.centre;
  return t => {
    const a = t * TAU, x = j.rx * Math.cos(a), y = j.ry * Math.sin(a);
    return [c[0] + x * Math.cos(rot) - y * Math.sin(rot), c[1] + x * Math.sin(rot) + y * Math.cos(rot)];
  };
}
function catmull(P) {
  const n = P.length - 1;
  return t => {
    const x = Math.min(n - 1e-9, Math.max(0, t * n)), i = Math.floor(x), u = x - i;
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)];
    const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
  };
}

/** A curve with no closed-form offset: sampled densely for evaluation, and
 *  offset by sample → normal → refit to cubic Béziers within OFFSET_TOL. */
function sampledCurve(fn, closed, type, N = 400) {
  const pts = []; for (let i = 0; i <= N; i++) pts.push(fn(i / N));
  const cum = [0]; for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const L = cum[N];
  const h = 1e-4;
  const tan = t => normalise(sub(fn(Math.min(1, t + h)), fn(Math.max(0, t - h))));
  const tOfLen = s => { let i = 1; while (i < N && cum[i] < s) i++; const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return (i - 1 + f) / N; };
  const self = {
    type, closed, exact: false, start: fn(0), end: fn(1), length: L,
    at: fn, tangentAt: tan, normalAt: t => perp(tan(t)),
    atLength: s => fn(tOfLen(s)),
    lengthAt: p => { let bi = 0, bd = Infinity; for (let i = 0; i <= N; i++) { const d = dist(p, pts[i]); if (d < bd) { bd = d; bi = i; } } return cum[bi]; },
    offset: k => {
      const g = t => add(fn(t), mul(perp(tan(t)), k));
      const off = sampledCurve(g, closed, type, N);
      // Self-intersection check: an offset whose tangent reverses against the
      // source tangent has passed a centre of curvature — a loop (§3.2).
      for (let i = 0; i < 64; i++) { const t = (i + 0.5) / 64; if (dot(off.tangentAt(t), tan(t)) < 0) throw new LoopingOffset(type, k); }
      return off;
    },
    segs: () => fitBeziers(fn, tan, 0, 1, OFFSET_TOL),
    reversed: () => sampledCurve(t => fn(1 - t), closed, type, N),
  };
  return self;
}
export class LoopingOffset extends Error {
  constructor(type, k) { super(`offsetting this ${type} by ${Math.abs(k).toFixed(0)}mm passes its tightest radius and would loop`); }
}

/** Refit a smooth parametric curve into cubic Béziers (Hermite from end tangents),
 *  subdividing until the midpoint deviation is under `tol`. The result prints as
 *  curves, not facets (acceptance 12). */
export function fitBeziers(fn, tan, t0, t1, tol, depth = 0, out = []) {
  const a = fn(t0), b = fn(t1);
  const chord = dist(a, b) || 1e-9;
  const ta = tan(t0), tb = tan(t1);
  // Hermite handle length for a near-circular span.
  const k = chord / 3;
  const c1 = add(a, mul(ta, k)), c2 = sub(b, mul(tb, k));
  let err = 0;
  for (const s of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
    const q = bez(a, c1, c2, b, s), p = fn(t0 + (t1 - t0) * s);
    err = Math.max(err, dist(p, q));
  }
  if (err > tol && depth < 12) {
    const m = (t0 + t1) / 2;
    fitBeziers(fn, tan, t0, m, tol, depth + 1, out);
    fitBeziers(fn, tan, m, t1, tol, depth + 1, out);
  } else out.push({ k: "C", a, c1, c2, b });
  return out;
}
export const bez = (a, c1, c2, b, t) => {
  const u = 1 - t;
  return [u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
          u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]];
};

// ---------------------------------------------------------------- paths & regions
//! A path is a list of segments, each {k:"L",a,b} · {k:"A",c,r,a0,a1} (a0→a1
//! signed) · {k:"C",a,c1,c2,b}. A region is a closed path. Both renderers and
//! both exporters consume exactly this.

export const segStart = s => s.k === "A" ? [s.c[0] + s.r * Math.cos(s.a0), s.c[1] + s.r * Math.sin(s.a0)] : s.a;
export const segEnd = s => s.k === "A" ? [s.c[0] + s.r * Math.cos(s.a1), s.c[1] + s.r * Math.sin(s.a1)] : s.b;

export function reverseSeg(s) {
  if (s.k === "L") return { k: "L", a: s.b, b: s.a };
  if (s.k === "A") return { k: "A", c: s.c, r: s.r, a0: s.a1, a1: s.a0 };
  return { k: "C", a: s.b, c1: s.c2, c2: s.c1, b: s.a };
}
export const reversePath = p => p.slice().reverse().map(reverseSeg);

/** Points along a path for hit tests / bounds / polygon ops (never for output). */
export function samplePath(path, perArc = 24) {
  const out = [];
  for (const s of path) {
    if (s.k === "L") { out.push(s.a); }
    else if (s.k === "A") {
      const n = Math.max(2, Math.ceil(Math.abs(s.a1 - s.a0) / TAU * perArc * 4));
      for (let i = 0; i < n; i++) { const a = s.a0 + (s.a1 - s.a0) * i / n; out.push([s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)]); }
    } else { for (let i = 0; i < 8; i++) out.push(bez(s.a, s.c1, s.c2, s.b, i / 8)); }
  }
  if (path.length) out.push(segEnd(path[path.length - 1]));
  return out;
}

/** Exact signed area of a closed path (Green's theorem per segment kind). */
export function pathArea(path) {
  let A = 0;
  for (const s of path) {
    if (s.k === "L") A += cross(s.a, s.b) / 2;
    else if (s.k === "A") {
      // ∮ x dy − y dx / 2 along a circular arc
      const { c, r, a0, a1 } = s;
      A += 0.5 * (r * r * (a1 - a0) + c[0] * r * (Math.sin(a1) - Math.sin(a0)) - c[1] * r * (Math.cos(a1) - Math.cos(a0)));
    } else {
      // integrate numerically — exact enough for a cubic with 64 steps (Simpson)
      const N = 64; let acc = 0;
      for (let i = 0; i < N; i++) { const p = bez(s.a, s.c1, s.c2, s.b, i / N), q = bez(s.a, s.c1, s.c2, s.b, (i + 1) / N); acc += cross(p, q) / 2; }
      A += acc;
    }
  }
  return A;
}
export function polyArea(pts) { let A = 0; for (let i = 0; i < pts.length; i++) A += cross(pts[i], pts[(i + 1) % pts.length]); return A / 2; }
export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function polyPath(pts, close = true) {
  const out = [];
  for (let i = 0; i < pts.length - (close ? 0 : 1); i++) out.push({ k: "L", a: pts[i], b: pts[(i + 1) % pts.length] });
  return out;
}
export function bboxOf(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}
/** Distance from P to a segment of any kind, measured to the analytic curve (§10.8). */
export function distToSeg(P, s) {
  if (s.k === "L") { const d = sub(s.b, s.a), L2 = dot(d, d); const t = L2 < TOL ? 0 : Math.max(0, Math.min(1, dot(sub(P, s.a), d) / L2)); return { d: dist(P, add(s.a, mul(d, t))), at: add(s.a, mul(d, t)) }; }
  if (s.k === "A") {
    const a = angleOf(s.c, P);
    const lo = Math.min(s.a0, s.a1), hi = Math.max(s.a0, s.a1);
    let best = null;
    for (const k of [-1, 0, 1]) { const aa = a + k * TAU; if (aa >= lo - 1e-12 && aa <= hi + 1e-12) best = aa; }
    const cand = best === null ? [segStart(s), segEnd(s)] : [[s.c[0] + s.r * Math.cos(best), s.c[1] + s.r * Math.sin(best)]];
    let bd = Infinity, bp = null; for (const q of cand) { const d = dist(P, q); if (d < bd) { bd = d; bp = q; } }
    return { d: bd, at: bp };
  }
  let bd = Infinity, bp = null;
  for (let i = 0; i <= 32; i++) { const q = bez(s.a, s.c1, s.c2, s.b, i / 32); const d = dist(P, q); if (d < bd) { bd = d; bp = q; } }
  return { d: bd, at: bp };
}

// ---------------------------------------------------------------- polygon clipping
/** Clip a polygon (points) to the half-plane left of the directed line L. */
export function clipHalf(poly, L, keepLeft = true) {
  const out = [];
  const side = p => (keepLeft ? 1 : -1) * cross(L.d, sub(p, L.p));
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa >= -TOL) out.push(a);
    if ((sa > TOL && sb < -TOL) || (sa < -TOL && sb > TOL)) { const t = sa / (sa - sb); out.push(lerp(a, b, t)); }
  }
  return out;
}

/** Segment [a,b] minus a convex polygon (CCW): returns the visible sub-segments.
 *  The one clipping primitive that elevation occlusion and HLR both use. */
export function segMinusConvex(a, b, poly, grow = 0) {
  // Cyrus–Beck: the part inside the polygon is [tin, tout]. `grow` treats the
  // polygon as closed by that margin: an edge lying ON an occluder's boundary
  // (a rear wall's foot on the same ground line) is behind it, not beside it.
  let tin = 0, tout = 1;
  const d = sub(b, a);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const e = sub(q, p);
    const n = [e[1], -e[0]];                 // outward for a CCW polygon
    const num = dot(n, sub(a, p)) - grow * len(n), den = dot(n, d);
    if (Math.abs(den) < 1e-12) { if (num > -1e-9) return [[a, b]]; continue; }
    const t = -num / den;
    if (den < 0) tin = Math.max(tin, t); else tout = Math.min(tout, t);
    if (tin > tout) return [[a, b]];
  }
  const out = [];
  if (tin > 1e-9) out.push([a, lerp(a, b, tin)]);
  if (tout < 1 - 1e-9) out.push([lerp(a, b, tout), b]);
  if (tin <= 1e-9 && tout >= 1 - 1e-9) return [];
  return out;
}
export function ensureCCW(poly) { return polyArea(poly) < 0 ? poly.slice().reverse() : poly; }

/** Convex hull (monotone chain), CCW. */
export function convexHull(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const lower = [], upper = [];
  for (const p of P) { while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 2])) <= 0) lower.pop(); lower.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 2])) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// ---------------------------------------------------------------- spatial index
/** A uniform grid over points/boxes: "index before joining" (§10.6). */
export class GridIndex {
  constructor(cell = 1000) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return i + "," + j; }
  insert(box, item) {
    const c = this.cell;
    for (let i = Math.floor(box[0] / c); i <= Math.floor(box[2] / c); i++)
      for (let j = Math.floor(box[1] / c); j <= Math.floor(box[3] / c); j++) {
        const k = this.key(i, j); if (!this.map.has(k)) this.map.set(k, []); this.map.get(k).push(item);
      }
  }
  query(box) {
    const c = this.cell, seen = new Set(), out = [];
    for (let i = Math.floor(box[0] / c); i <= Math.floor(box[2] / c); i++)
      for (let j = Math.floor(box[1] / c); j <= Math.floor(box[3] / c); j++)
        for (const it of this.map.get(this.key(i, j)) || []) if (!seen.has(it)) { seen.add(it); out.push(it); }
    return out;
  }
}
