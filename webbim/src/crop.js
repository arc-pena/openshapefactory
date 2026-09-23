//! A view's crop region: a rectangle, or a closed sketch that drives the boundary.
//!
//! The crop is data on the view (`clip`): `rect` in model mm, `active`, `visible`,
//! `annotation` (how far the annotation crop stands outside the crop, in paper mm:
//! left, bottom, right, top) and, after Edit Crop, `shape` - the sketch itself:
//! lines, arcs, circles, ellipses and splines. The sketch is kept as drawn so it
//! can be edited again; the boundary a view clips to is sampled from it here.

const TAU_ = Math.PI * 2;
export const ANNOTATION_CROP = [8, 8, 8, 8];          // paper mm, as Revit's default feels at 1:100
export const CLOSE_TOL = 2;                            // mm: sketch ends closer than this meet

/** Points along one sketch element, in drawing order. */
export function sampleCropElement(el, n = 48) {
  if (el.type === "line") return [el.a, el.b];
  if (el.type === "arc") { const pts = [], sw = el.a1 - el.a0; for (let i = 0; i <= n; i++) { const a = el.a0 + sw * i / n; pts.push([el.c[0] + el.r * Math.cos(a), el.c[1] + el.r * Math.sin(a)]); } return pts; }
  if (el.type === "circle") { const pts = []; for (let i = 0; i <= n; i++) { const a = TAU_ * i / n; pts.push([el.c[0] + el.r * Math.cos(a), el.c[1] + el.r * Math.sin(a)]); } return pts; }
  if (el.type === "ellipse") {
    const pts = [], c = Math.cos(el.rot || 0), s = Math.sin(el.rot || 0);
    for (let i = 0; i <= n; i++) { const a = TAU_ * i / n, x = el.rx * Math.cos(a), y = el.ry * Math.sin(a); pts.push([el.c[0] + x * c - y * s, el.c[1] + x * s + y * c]); }
    return pts;
  }
  if (el.type === "spline") return catmullRom(el.pts, !!el.closed, 12);
  return [];
}
/** Centripetal-free, uniform Catmull-Rom through the clicked points. */
export function catmullRom(P, closed, per = 12) {
  if (P.length < 2) return P.slice();
  const pts = [], n = P.length, at = i => closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      pts.push([0, 1].map(d => 0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  pts.push(closed ? P[0] : P[n - 1]);
  return pts;
}
const isClosedEl = el => el.type === "circle" || el.type === "ellipse" || (el.type === "spline" && el.closed);
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** The sketch's elements chained end to end into one closed loop: { pts } or { error }. */
export function chainLoop(elements) {
  const els = (elements || []).filter(Boolean);
  if (!els.length) return { error: "the sketch is empty - draw a closed boundary" };
  const closed = els.filter(isClosedEl);
  if (closed.length) return els.length === 1 ? { pts: sampleCropElement(els[0]).slice(0, -1) } : { error: "a circle, ellipse or closed spline must be the whole boundary on its own" };
  const runs = els.map(el => sampleCropElement(el));
  const used = new Array(runs.length).fill(false);
  let loop = runs[0].slice(); used[0] = true;
  for (let step = 1; step < runs.length; step++) {
    const end = loop[loop.length - 1];
    let found = -1, rev = false;
    for (let i = 0; i < runs.length; i++) {
      if (used[i]) continue;
      if (d2(runs[i][0], end) <= CLOSE_TOL) { found = i; break; }
      if (d2(runs[i][runs[i].length - 1], end) <= CLOSE_TOL) { found = i; rev = true; break; }
    }
    if (found < 0) return { error: `the boundary is open near (${Math.round(end[0])}, ${Math.round(end[1])}) - its ends must meet` };
    used[found] = true;
    const r = rev ? runs[found].slice().reverse() : runs[found];
    loop = loop.concat(r.slice(1));
  }
  if (d2(loop[0], loop[loop.length - 1]) > CLOSE_TOL) return { error: "the boundary does not close - the last element must end where the first began" };
  return { pts: loop.slice(0, -1) };
}
/** The loop a view clips to, in model mm: the sketch when there is one, else the rectangle. */
export function cropLoop(clip) {
  if (!clip) return null;
  if (clip.shape && clip.shape.elements && clip.shape.elements.length) { const r = chainLoop(clip.shape.elements); if (r.pts) return r.pts; }
  if (!clip.rect) return null;
  const [x0, y0, x1, y1] = clip.rect;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
export const loopBBox = pts => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
/** The annotation crop, in paper mm, around a crop bbox given in paper mm. */
export function annotationRect(clip, bbPaper) {
  const a = (clip && clip.annotation) || ANNOTATION_CROP;
  return [bbPaper[0] - a[0], bbPaper[1] - a[1], bbPaper[2] + a[2], bbPaper[3] + a[3]];
}
/** Layers that belong to the annotation crop rather than the model crop. */
export const isAnnotationLayer = layer => /^(Annotation|IfcGrid|Crop)/.test(layer || "");
