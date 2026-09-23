//! Hidden-line removal for a 3D camera view on a sheet (§6.4). This build has
//! no OCCT: the solids it makes are convex, planar-faced pieces (a straight wall
//! span is a hexahedron; an arc wall is chorded), so an exact per-edge visibility
//! test against front-facing faces is possible and returns vectors, sorted into
//! the same categories HLRBRep_HLRToShape does: visible sharp (V), visible
//! silhouette (OutLineV), visible smooth (Rg1LineV), hidden (H), hidden
//! silhouette (OutLineH). Roughly quadratic — so it is cached, stepped and never
//! interactive.

import { TOL, samplePath, segStart, segEnd, dist, add, mul, sub, perp, normalise } from "./geom2d.js";
import { wallRegions } from "./joins.js";
import { pointAt, uOf } from "./walls.js";
import { F } from "./ocaf.js";
import { elementParts } from "./solids.js";

const hlrCross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const hlrDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function cameraBasis(cam) {
  const az = cam.azimuth * Math.PI / 180, el = cam.elevation * Math.PI / 180;
  const D = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];      // toward the camera
  const right = norm3(hlrCross([0, 0, 1], D)), up = hlrCross(D, right);
  const t = cam.target || [0, 0, 0];
  return { D, right, up, t, project: p => { const q = sub3(p, t); return [hlrDot(q, right), hlrDot(q, up), hlrDot(q, D)]; } };
}

// ---------------------------------------------------------------- the model as faces and edges
/** Convex solids (occluders) and drawable edges for everything with a body. */
export function buildHLRModel(doc, opts = {}) {
  const solids = [], edges = [];
  const chord = opts.chord || 400;
  for (const f of doc.elements()) {
    if (f.get("Integer") === 0 || doc.error(f)) continue;
    if (opts.visible && !opts.visible(f)) continue;           // the view's Visibility/Graphics
    const t = doc.typeOf(f);
    if (t === "Door" || t === "Window" || t === "Floor" || t === "Beam") { for (const pt of elementParts(doc, f)) if (pt.foot && pt.foot.length >= 3) prism(pt.foot, pt.z0, pt.z1, solids, edges, false); continue; }
    if (t === "Wall") { const w = doc.plan(f); if (!w || !w.pieces) continue; wallSolids(w, solids); wallEdges(w, edges, chord); }
    if (t === "Column") { const p = doc.plan(f); if (!p) continue; const foot = p.foot.length ? p.foot : samplePath(p.path).slice(0, -1); prism(foot, p.z0, p.z1, solids, edges, !!(p.foot.length === 16)); }
  }
  return { solids, edges };
}
function top3(piece, p) { const zt = piece.topAt ? piece.topAt(p) : piece.z1; const lean = piece.lean ? mul(piece.n2, Math.tan(piece.lean) * (zt - piece.zRef)) : [0, 0]; return [p[0] + lean[0], p[1] + lean[1], zt]; }
function bot3(piece, p) { const lean = piece.lean ? mul(piece.n2, Math.tan(piece.lean) * (piece.z0 - piece.zRef)) : [0, 0]; return [p[0] + lean[0], p[1] + lean[1], piece.z0]; }
function wallSolids(w, solids) {
  for (const pc of w.pieces) {
    const b = pc.foot.map(p => bot3(pc, p)), t = pc.foot.map(p => top3(pc, p));
    solids.push(solidFrom(b, t));
  }
}
function solidFrom(b, t) {
  const n = b.length, faces = [];
  const ccw = ((b[1][0] - b[0][0]) * (b[2][1] - b[0][1]) - (b[1][1] - b[0][1]) * (b[2][0] - b[0][0])) > 0;
  const B = ccw ? b : b.slice().reverse(), T = ccw ? t : t.slice().reverse();
  faces.push(B.slice().reverse());     // bottom, outward normal down
  faces.push(T.slice());               // top
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([B[i], B[j], T[j], T[i]]); }
  return { faces: faces.map(poly => ({ poly, n: faceNormal(poly) })) };
}
function faceNormal(poly) {
  let n = [0, 0, 0];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])]; }
  return norm3(n);
}
function prism(foot, z0, z1, solids, edges, smooth) {
  const b = foot.map(p => [p[0], p[1], z0]), t = foot.map(p => [p[0], p[1], z1]);
  const s = solidFrom(b, t); solids.push(s);
  const n = foot.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    edges.push({ a: b[i], b: b[j], kind: "sharp" }, { a: t[i], b: t[j], kind: "sharp" });
    if (smooth) { const fa = s.faces[2 + ((i - 1 + n) % n)].n, fb = s.faces[2 + i].n; edges.push({ a: b[i], b: t[i], kind: "smooth", n1: fa, n2: fb }); }
    else edges.push({ a: b[i], b: t[i], kind: "sharp" });
  }
}
/** Edges from the construction, not from the pieces: the joined outline at the
 *  floor and at the top, corners, and each opening's reveal. Seams between
 *  pieces of one wall and mitre seams between welded walls are not edges. */
function wallEdges(w, out, chord) {
  const lowRegs = wallRegions(w, "Coarse", w.z0 + 1, w.openings || []);
  const highRegs = wallRegions(w, "Coarse", w.z1 - 1, (w.openings || []).filter(o => o.sill + o.h >= w.height - 1));
  const topAt = p => w.z1 + (w.topSlope ? Math.tan(w.topSlope) * uOf(w, p) : 0);
  const leanAt = (p, z) => w.lean ? add(p, mul(perp(w.d || [1, 0]), Math.tan(w.lean) * (z - w.z0))) : p;
  const P3 = (p, z) => { const q = leanAt(p, z); return [q[0], q[1], z]; };
  const chordPts = s => s.k === "L" ? [s.a, s.b] : samplePath([s], Math.max(8, Math.ceil(Math.abs(s.a1 - s.a0) * s.r / chord)));
  const corners = [];
  const jambHead = p => { for (const o of w.openings || []) { const u = uOf(w, p); if (Math.abs(u - o.u0) < 1 || Math.abs(u - o.u1) < 1) if (o.sill < 1) return w.z0 + o.sill + o.h; } return null; };
  for (const r of lowRegs) for (const e of r.edges) {
    if (e.role === "weld" || e.role === "hidden") continue;
    const pts = chordPts(e.seg);
    for (let i = 0; i < pts.length - 1; i++) out.push({ a: P3(pts[i], w.z0), b: P3(pts[i + 1], w.z0), kind: "sharp" });
    corners.push(segStart(e.seg));
    // curved faces: vertical smooth seams between chords
    if (e.seg.k === "A") for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], nrm = normalise(sub(p, e.seg.c)), tn = [-nrm[1], nrm[0]];
      // the two chord faces either side of this seam lean ±(half a chord angle) off the radial
      const n0 = norm3([nrm[0] - tn[0] * 0.05, nrm[1] - tn[1] * 0.05, 0]), n2 = norm3([nrm[0] + tn[0] * 0.05, nrm[1] + tn[1] * 0.05, 0]);
      out.push({ a: P3(p, w.z0), b: P3(p, topAt(p)), kind: "smooth", n1: n0, n2: n2, onCurve: true, centre: e.seg.c });
    }
  }
  for (const r of highRegs) for (const e of r.edges) {
    if (e.role === "weld" || e.role === "hidden") continue;
    const pts = chordPts(e.seg);
    for (let i = 0; i < pts.length - 1; i++) out.push({ a: P3(pts[i], topAt(pts[i])), b: P3(pts[i + 1], topAt(pts[i + 1])), kind: "sharp" });
  }
  const seen = [];
  for (const p of corners) {
    if (seen.some(q => dist(p, q) < 1)) continue; seen.push(p);
    const h = jambHead(p);
    out.push({ a: P3(p, w.z0), b: P3(p, h ?? topAt(p)), kind: "sharp" });
  }
  // Openings: face rectangles and reveal edges.
  const n = w.stack.s.length - 1;
  for (const o of w.openings || []) {
    if (o.recess) continue;
    const zs = w.z0 + o.sill, zh = w.z0 + o.sill + o.h;
    for (const s of [w.stack.s[0], w.stack.s[n]]) {
      const a = pointAt(w, s, o.u0), b = pointAt(w, s, o.u1);
      out.push({ a: P3(a, zh), b: P3(b, zh), kind: "sharp" });
      if (o.sill > 1) { out.push({ a: P3(a, zs), b: P3(b, zs), kind: "sharp" }); out.push({ a: P3(a, zs), b: P3(a, zh), kind: "sharp" }); out.push({ a: P3(b, zs), b: P3(b, zh), kind: "sharp" }); }
    }
    for (const u of [o.u0, o.u1]) for (const z of (o.sill > 1 ? [zs, zh] : [zh])) out.push({ a: P3(pointAt(w, w.stack.s[0], u), z), b: P3(pointAt(w, w.stack.s[n], u), z), kind: "sharp" });
  }
}

// ---------------------------------------------------------------- visibility
/** Stepped HLR: yields progress so a caller can run it in slices (a frozen tab
 *  is a bug; minutes with a progress bar is a feature). Returns categorised
 *  2D segments in view millimetres (model scale). */
export function* hlrSteps(model, cam) {
  const C = cameraBasis(cam);
  // Only faces turned toward the camera can hide anything.
  const occ = [];
  for (const s of model.solids) for (const fc of s.faces) {
    if (hlrDot(fc.n, C.D) <= 1e-9) continue;
    const P = fc.poly.map(C.project);
    const pts2 = P.map(p => [p[0], p[1]]);
    // plane in view space: depth = a x + b y + c
    const nv = [hlrDot(fc.n, C.right), hlrDot(fc.n, C.up), hlrDot(fc.n, C.D)];
    const k = nv[0] * P[0][0] + nv[1] * P[0][1] + nv[2] * P[0][2];
    const bb = [Math.min(...pts2.map(p => p[0])), Math.min(...pts2.map(p => p[1])), Math.max(...pts2.map(p => p[0])), Math.max(...pts2.map(p => p[1]))];
    occ.push({ pts: ccw2(pts2), plane: { a: -nv[0] / nv[2], b: -nv[1] / nv[2], c: k / nv[2] }, bb });
  }
  const lines = { visible: [], outlineV: [], smoothV: [], hidden: [], outlineH: [] };
  const all = [];
  let i = 0;
  for (const e of model.edges) {
    const A = C.project(e.a), B = C.project(e.b);
    let cat = "sharp";
    if (e.kind === "smooth") {
      const f1 = hlrDot(e.n1, C.D), f2 = hlrDot(e.n2, C.D);
      cat = (f1 > 0) !== (f2 > 0) ? "outline" : "smooth";
      if (f1 <= 0 && f2 <= 0) cat = "backsmooth";
    }
    const hidden = hiddenIntervals(A, B, occ);
    const vis = complement(hidden);
    const seg = t => [[A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]];
    for (const [t0, t1] of vis) if (t1 - t0 > 1e-6) {
      const s = [seg(t0)[0], seg(t1)[0]];
      if (cat === "sharp") lines.visible.push(s); else if (cat === "outline") lines.outlineV.push(s); else if (cat === "smooth") lines.smoothV.push(s);
    }
    for (const [t0, t1] of hidden) if (t1 - t0 > 1e-6) {
      const s = [seg(t0)[0], seg(t1)[0]];
      if (cat === "sharp") lines.hidden.push(s); else if (cat === "outline") lines.outlineH.push(s);
    }
    all.push(A, B);
    if (++i % 50 === 0) yield { done: i, total: model.edges.length };
  }
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const bbox = xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 1, 1];
  return { lines, bbox, counts: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v.length])), faces: occ.length, edges: model.edges.length };
}
export function runHLR(model, cam) { const it = hlrSteps(model, cam); let r; do { r = it.next(); } while (!r.done); return r.value; }

function ccw2(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a < 0 ? pts.slice().reverse() : pts; }
/** Parameter intervals of segment AB hidden behind some face (depth larger = nearer the camera). */
function hiddenIntervals(A, B, occ) {
  const out = [];
  const bx0 = Math.min(A[0], B[0]), bx1 = Math.max(A[0], B[0]), by0 = Math.min(A[1], B[1]), by1 = Math.max(A[1], B[1]);
  const d = [B[0] - A[0], B[1] - A[1]];
  for (const o of occ) {
    if (o.bb[0] > bx1 + TOL || o.bb[2] < bx0 - TOL || o.bb[1] > by1 + TOL || o.bb[3] < by0 - TOL) continue;
    // Cyrus–Beck inside interval, strictly inside (an edge ON a face boundary is not behind it)
    let tin = 0, tout = 1, ok = true;
    const P = o.pts;
    for (let i = 0; i < P.length && ok; i++) {
      const p = P[i], q = P[(i + 1) % P.length], e = [q[0] - p[0], q[1] - p[1]];
      const nrm = [e[1], -e[0]], ln = Math.hypot(nrm[0], nrm[1]) || 1;
      const num = (nrm[0] * (A[0] - p[0]) + nrm[1] * (A[1] - p[1])) / ln + 0.05;   // shrink the face by 0.05 mm
      const den = (nrm[0] * d[0] + nrm[1] * d[1]) / ln;
      if (Math.abs(den) < 1e-12) { if (num > 0) ok = false; continue; }
      const t = -num / den;
      if (den < 0) tin = Math.max(tin, t); else tout = Math.min(tout, t);
      if (tin >= tout) ok = false;
    }
    if (!ok) continue;
    // Within [tin,tout]: face depth − edge depth is linear in t; hidden where > eps.
    const f = t => { const x = A[0] + d[0] * t, y = A[1] + d[1] * t; return o.plane.a * x + o.plane.b * y + o.plane.c - (A[2] + (B[2] - A[2]) * t); };
    const eps = 0.5;
    const g0 = f(tin) - eps, g1 = f(tout) - eps;
    if (g0 <= 0 && g1 <= 0) continue;
    if (g0 > 0 && g1 > 0) { out.push([tin, tout]); continue; }
    const tc = tin + (tout - tin) * (g0 / (g0 - g1));
    out.push(g0 > 0 ? [tin, tc] : [tc, tout]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of out) { const last = merged[merged.length - 1]; if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1]); else merged.push(iv.slice()); }
  return merged;
}
function complement(iv) {
  const out = []; let t = 0;
  for (const [a, b] of iv) { if (a > t) out.push([t, a]); t = Math.max(t, b); }
  if (t < 1) out.push([t, 1]);
  return out;
}
