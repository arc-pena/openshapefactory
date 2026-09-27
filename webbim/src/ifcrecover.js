import { sliceMesh } from "./massing.js";

//! Reading a parametric element back out of a mesh. Many IFC files (SketchUp's, most coordination
//! exports, every IFC4 "reference view") carry walls, slabs and members as triangles or breps, not as
//! extrusions. A wall that IS a box, a slab that IS a flat plate, a beam that IS a bar is recognised
//! here and comes in as a real wall, floor or beam - its holes as openings, its gable as a top profile -
//! so it can be edited, joined, scheduled and drawn like one drawn by hand. Each recogniser proves its
//! reading by volume: the element it would make must hold the same volume as the mesh (within 2%), or
//! it answers null and the shape is kept exactly as the file has it.

/** The convex hull of plan points (monotone chain), anticlockwise. */
export function hull2(pts) {
  const P = pts.map(p => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-9) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 1e-9) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
/** The smallest box around plan points: its centre, long direction, length and width. */
export function orientedBox(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]];
    const us = pts.map(p => p[0] * d[0] + p[1] * d[1]), vs = pts.map(p => p[0] * n[0] + p[1] * n[1]);
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-6) best = { area, d, n, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { d, n, u0, u1, v0, v1 } = best, len = u1 - u0, wid = v1 - v0;
  const long = len >= wid ? d : n, L = Math.max(len, wid), W = Math.min(len, wid);
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, centre = [d[0] * cu + n[0] * cv, d[1] * cu + n[1] * cv];
  return { centre, dir: long, length: L, width: W };
}

// ---------------------------------------------------------------- mesh basics
/** Triangles of a {positions, index} mesh, each with its unit normal and area. */
export function meshTriangles(m) {
  const P = m.positions, I = m.index, out = [];
  for (let k = 0; k < I.length; k += 3) {
    const a = [P[I[k] * 3], P[I[k] * 3 + 1], P[I[k] * 3 + 2]], b = [P[I[k + 1] * 3], P[I[k + 1] * 3 + 1], P[I[k + 1] * 3 + 2]], c = [P[I[k + 2] * 3], P[I[k + 2] * 3 + 1], P[I[k + 2] * 3 + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
    if (l < 1e-9) continue;
    out.push({ p: [a, b, c], n: n.map(x => x / l), area: l / 2 });
  }
  return out;
}
/** Enclosed volume (divergence theorem); positive for an outward-wound closed mesh. */
export function meshVolume(tris) {
  let v = 0;
  for (const { p: [a, b, c] } of tris) v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  return Math.abs(v);
}
const area2 = pts => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
/** Drop points that do not turn the loop (collinear within tol mm) and repeats. */
function simplify(loop, tol = 0.5) {
  let pts = loop.slice(), changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]), off = L < 1e-9 ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Math.abs((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / L;
      if (off < tol) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}
/** The boundary loops of a set of coplanar triangles in a 2D projection: edges used by one triangle
 *  only, chained. Anticlockwise outer loop first (the largest), holes after, each simplified. */
export function faceLoops(tris, proj) {
  const key = q => Math.round(q[0] * 2) + "," + Math.round(q[1] * 2);
  const pt = new Map(), count = new Map(), dirEdges = [];
  for (const t of tris) {
    let q = t.p.map(proj);
    if (area2(q) < 0) q = [q[0], q[2], q[1]];           // wind every triangle anticlockwise in the projection
    const ks = q.map(key); q.forEach((x, i) => pt.set(ks[i], x));
    for (let i = 0; i < 3; i++) {
      const a = ks[i], b = ks[(i + 1) % 3]; if (a === b) continue;
      const u = a < b ? a + "|" + b : b + "|" + a; count.set(u, (count.get(u) || 0) + 1); dirEdges.push([a, b, u]);
    }
  }
  // T-junctions: a vertex lying on another triangle's edge splits that edge, so both sides count it alike
  const keys = [...pt.keys()], split = [];
  for (const [a, b] of dirEdges) {
    const A = pt.get(a), B = pt.get(b), L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 1e-9) continue;
    const on = [];
    for (const k of keys) { if (k === a || k === b) continue; const Q = pt.get(k), t = ((Q[0] - A[0]) * (B[0] - A[0]) + (Q[1] - A[1]) * (B[1] - A[1])) / (L * L);
      if (t <= 1e-6 || t >= 1 - 1e-6) continue; const off = Math.abs((B[0] - A[0]) * (Q[1] - A[1]) - (B[1] - A[1]) * (Q[0] - A[0])) / L; if (off < 0.6) on.push([t, k]); }
    const chain = [a, ...on.sort((x, y) => x[0] - y[0]).map(x => x[1]), b];
    for (let i = 0; i < chain.length - 1; i++) split.push([chain[i], chain[i + 1]]);
  }
  count.clear();
  const uk = (a, b) => a < b ? a + "|" + b : b + "|" + a;
  for (const [a, b] of split) count.set(uk(a, b), (count.get(uk(a, b)) || 0) + 1);
  // an edge shared by two triangles in opposite directions is interior; one used once is boundary
  const next = new Map();
  for (const [a, b] of split) if (count.get(uk(a, b)) === 1) next.set(a, b);
  const loops = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let k = start, guard = 0;
    while (k && !seen.has(k) && guard++ < 100000) { seen.add(k); loop.push(pt.get(k)); k = next.get(k); }
    if (loop.length >= 3) loops.push(simplify(loop));
  }
  const withArea = loops.map(l => ({ pts: l, area: area2(l) })).filter(l => Math.abs(l.area) > 1).sort((x, y) => Math.abs(y.area) - Math.abs(x.area));
  return withArea.map((l, i) => { const ccw = l.area > 0; const pts = (i === 0) === ccw ? l.pts : l.pts.slice().reverse(); return { pts, area: Math.abs(l.area) }; });
}

// ---------------------------------------------------------------- prisms: slabs, footings, spaces
/** A flat plate: every vertex on its top or bottom plane. Its plan outline (with holes), top, bottom. */
export function recognisePrism(m, { tol = 1.5 } = {}) {
  const tris = meshTriangles(m); if (tris.length < 8) return null;
  const P = m.positions, zs = []; for (let i = 2; i < P.length; i += 3) zs.push(P[i]);
  const zTop = Math.max(...zs), zBot = Math.min(...zs), thick = zTop - zBot;
  if (thick < 5 || zs.some(z => Math.abs(z - zTop) > tol && Math.abs(z - zBot) > tol)) return null;
  const top = tris.filter(t => t.n[2] > 0.999 && t.p.every(q => Math.abs(q[2] - zTop) <= tol));
  const loops = faceLoops(top, q => [q[0], q[1]]); if (!loops.length) return null;
  const [outer, ...holes] = loops, net = outer.area - holes.reduce((s, h) => s + h.area, 0);
  const vol = meshVolume(tris);
  if (Math.abs(vol - net * thick) > 0.02 * vol + 1e3) return null;
  return { outer: outer.pts, holes: holes.map(h => h.pts), zTop, zBot, thick, area: net };
}

// ---------------------------------------------------------------- tilted plates: roof planes
/** A plate on the slant (a roof plane): every vertex on one of two parallel sloping planes. Its footprint
 *  is where its mid-plane runs (read in the plate's own frame and laid back on plan), with its holes; its
 *  pitch, the direction it rises, its thickness square to the slope, its top plane. */
export function recogniseTiltedPlate(m, { tol = 1.5 } = {}) {
  const tris = meshTriangles(m); if (tris.length < 8) return null;
  const big = tris.reduce((a, b) => (b.area > a.area ? b : a));
  let n = big.n.slice(); if (n[2] < 0) n = n.map(x => -x);
  if (n[2] > 0.999 || n[2] < 0.05) return null;                                 // flat (a slab) or upright (a wall)
  const P = m.positions, pts = []; for (let i = 0; i < P.length; i += 3) pts.push([P[i], P[i + 1], P[i + 2]]);
  const dOf = q => q[0] * n[0] + q[1] * n[1] + q[2] * n[2], ds = pts.map(dOf), dTop = Math.max(...ds), dBot = Math.min(...ds), t = dTop - dBot;
  if (t < 5 || ds.some(d => Math.abs(d - dTop) > tol && Math.abs(d - dBot) > tol)) return null;
  // the plate's own frame: e1 along the slope's level lines, e2 up the slope, n out of it
  const hz = Math.hypot(n[0], n[1]), e1 = [-n[1] / hz, n[0] / hz, 0], e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  const local = [], mid = (dTop + dBot) / 2;
  for (const q of pts) local.push(q[0] * e1[0] + q[1] * e1[1] + q[2] * e1[2], q[0] * e2[0] + q[1] * e2[1] + q[2] * e2[2], dOf(q));
  const loops = sliceMesh({ positions: local, index: m.index }, mid).filter(l => l.closed && l.pts.length >= 3);
  if (!loops.length) return null;
  const toPlan = ([x, y]) => [x * e1[0] + y * e2[0] + mid * n[0], x * e1[1] + y * e2[1] + mid * n[1]];
  const area2 = ps => { let a = 0; for (let i = 0; i < ps.length; i++) { const p = ps[i], q = ps[(i + 1) % ps.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const plan = loops.map(l => simplify(l.pts.map(toPlan))).map(ps => ({ ps, a: Math.abs(area2(ps)) })).sort((x, y) => y.a - x.a);
  const outer = plan[0].ps, holes = plan.slice(1).map(x => x.ps), net = plan[0].a - plan.slice(1).reduce((s, x) => s + x.a, 0);
  const tv = t / n[2], vol = meshVolume(tris);
  if (Math.abs(vol - net * tv) > 0.03 * vol + 1e3) return null;
  const up = [-n[0] / hz, -n[1] / hz], pivot = outer[0];
  const topAt = p => (dTop - n[0] * p[0] - n[1] * p[1]) / n[2];
  // how its edges are cut: plumb (upright side faces) or square to the slope (side faces along its normal)
  // (only the eave and ridge faces tell: the rake edges run up the slope and are upright either way)
  const side = tris.filter(tr => Math.abs(tr.n[0] * n[0] + tr.n[1] * n[1] + tr.n[2] * n[2]) < 0.2 && tr.area > 1 && Math.abs(tr.n[0] * n[0] + tr.n[1] * n[1]) / (hz * (Math.hypot(tr.n[0], tr.n[1]) || 1)) > 0.5);
  const plumb = side.filter(tr => Math.abs(tr.n[2]) < 0.02).reduce((a2, tr) => a2 + tr.area, 0), square = side.reduce((a2, tr) => a2 + tr.area, 0) - plumb;
  return { outer, holes, pitch: Math.acos(n[2]) * 180 / Math.PI, direction: Math.atan2(up[1], up[0]) * 180 / Math.PI, pivot, top: topAt(pivot), thickness: t, zLow: Math.min(...pts.map(q => q[2])), square: square > plumb };
}

// ---------------------------------------------------------------- walls
/** Where the upright line u = x crosses a set of polygon loops in (u, z): [lowest, highest], or null. */
function span(loops, x) {
  let lo = Infinity, hi = -Infinity;
  for (const L of loops) for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length];
    if ((a[0] - x) * (b[0] - x) > 0 || Math.abs(b[0] - a[0]) < 1e-9) continue;
    const z = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); lo = Math.min(lo, z); hi = Math.max(hi, z);
  }
  return hi > -Infinity ? [lo, hi] : null;
}
/** A wall: every vertex on one of two parallel upright planes, so it is one constant thickness. Its
 *  face, read in the wall's own elevation (u along it, z up), gives the rest: the top as a profile
 *  along the wall (a gable, a rake, steps - small pockets in it for beams are filled), a slope across
 *  the thickness where the two faces' tops differ by the same amount everywhere (a top cut under a
 *  roof), rectangular holes (windows), notches up from the base (doors) and gaps between pieces
 *  (openings the full height). */
export function recogniseWall(m, { tol = 1.5, why = null } = {}) {
  const no = tag => { if (why) why.push(tag); return null; };
  const tris = meshTriangles(m); if (tris.length < 12) return no(2);
  const P = m.positions, pts = []; for (let i = 0; i < P.length; i += 3) pts.push([P[i], P[i + 1], P[i + 2]]);
  const box = orientedBox(hull2(pts)); if (!box || box.width < 5 || box.width > 0.5 * box.length) return no(3);
  const d = box.dir, n = [-d[1], d[0]], t = box.width, L = box.length;
  const a = [box.centre[0] - d[0] * L / 2, box.centre[1] - d[1] * L / 2];
  const sOf = q => (q[0] - box.centre[0]) * n[0] + (q[1] - box.centre[1]) * n[1], uOf = q => (q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1];
  // vertices between the faces are allowed only in pockets and bevels; the faces themselves must be two planes
  const face = sign => tris.filter(tr => (tr.n[0] * n[0] + tr.n[1] * n[1]) * sign > 0.999 && tr.p.every(q => Math.abs(sOf(q) - sign * t / 2) <= tol));
  if (pts.some(q => Math.abs(sOf(q)) > t / 2 + tol)) return no(4);
  const proj = q => [uOf(q), q[2]];
  const F = [face(1), face(-1)].map(f => faceLoops(f, proj)); if (!F[0].length || !F[1].length) return no(5);
  const z0 = Math.min(...pts.map(q => q[2]));
  // breakpoints along the wall: every vertex of either face; read each face's top and bottom either side of each
  const us = [...new Set(F.flat().flatMap(l => l.pts.map(q => Math.round(q[0] * 10) / 10)).concat([0, L]))].filter(u => u >= -tol && u <= L + tol).sort((x, y) => x - y);
  const outers = F.map(ls => { const ol = []; for (const l of ls) { const c = l.pts.reduce((acc, q) => [acc[0] + q[0], acc[1] + q[1]], [0, 0]).map(v => v / l.pts.length); if (!ls.some(o => o !== l && o.area > l.area && inside(c, o.pts))) ol.push(l.pts); } return ol; });
  const holesOf = F.map((ls, i) => ls.map(l => l.pts).filter(p => !outers[i].includes(p)));
  const eps = 0.05, samples = [];
  for (let k = 0; k < us.length; k++) for (const x of [us[k] - eps, us[k] + eps]) if (x > 0 && x < L) samples.push(x);
  const top = [[], []], bot = [[], []];
  for (const x of samples) for (let i = 0; i < 2; i++) { const sp = span(outers[i], x); top[i].push(sp ? sp[1] : null); bot[i].push(sp ? sp[0] : null); }
  // the two faces must stand over the same stretches, and their tops differ by one constant (a bevel)
  const deltas = [];
  for (let k = 0; k < samples.length; k++) { if ((top[0][k] === null) !== (top[1][k] === null)) return no(6); if (top[0][k] !== null) deltas.push(top[0][k] - top[1][k]); }
  if (!deltas.length) return no(7);
  // the bevel is what most of the wall agrees on (the median); a pocket cut into one face only (a beam
  // seat) is filled from the other face, and the volume check below bounds what that may add
  const delta = deltas.slice().sort((x, y) => x - y)[Math.floor(deltas.length / 2)];
  const cross = Math.abs(delta) > tol ? delta / t : 0;              // rise per mm to the wall's left
  // the centreline top profile, and the stretches with no wall (full-height openings) or a raised base (doors)
  const profile = [], openings = [];
  let gap = null, notch = null;
  for (let k = 0; k < samples.length; k++) {
    const x = samples[k], tp = top[0][k], bt = bot[0][k];
    if (tp === null) { if (!gap) gap = { u0: x }; gap.u1 = x; continue; }
    if (gap) { openings.push({ u0: gap.u0 - eps, u1: gap.u1 + eps, sill: 0, h: Infinity }); gap = null; }
    profile.push([x, Math.max(tp - delta / 2, top[1][k] + delta / 2) - z0]);
    const raised = Math.max(bt, bot[1][k]) - z0;
    if (raised > tol) { if (notch && Math.abs(notch.h - raised) > tol) return no(9); if (!notch) notch = { u0: x, h: raised }; notch.u1 = x; }
    else if (notch) { openings.push({ u0: notch.u0 - eps, u1: notch.u1 + eps, sill: 0, h: notch.h }); notch = null; }
    if (Math.max(bt, bot[1][k]) < z0 - tol) return no(10);
  }
  if (gap || notch) return no(11);                                        // a wall starts and ends with wall
  // holes: upright rectangles through both faces (windows)
  for (const hp of holesOf[0]) {
    const U = hp.map(q => q[0]), Z = hp.map(q => q[1]), u0 = Math.min(...U), u1 = Math.max(...U), zb = Math.min(...Z), zt = Math.max(...Z);
    if (hp.length !== 4 || hp.some(q => !(Math.abs(q[0] - u0) <= tol || Math.abs(q[0] - u1) <= tol) || !(Math.abs(q[1] - zb) <= tol || Math.abs(q[1] - zt) <= tol))) return no(12);
    if (!holesOf[1].some(o => o.every(q => (Math.abs(q[0] - u0) <= tol || Math.abs(q[0] - u1) <= tol) && (Math.abs(q[1] - zb) <= tol || Math.abs(q[1] - zt) <= tol)))) return no(13);
    openings.push({ u0, u1, sill: zb - z0, h: zt - zb });
  }
  // the profile, simplified: a point stays where the slope changes (steps are two points at one u)
  const prof = [profile[0]];
  for (let k = 1; k < profile.length - 1; k++) {
    const p = prof[prof.length - 1], q = profile[k], r = profile[k + 1];
    const cr = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    if (Math.abs(cr) > 0.5 * Math.max(1, Math.hypot(r[0] - p[0], r[1] - p[1]))) prof.push(q);
  }
  prof.push(profile[profile.length - 1]);
  prof[0] = [0, prof[0][1]]; prof[prof.length - 1] = [L, prof[prof.length - 1][1]];
  // the volume the wall element will hold, against the mesh's
  let area = 0; for (let k = 1; k < prof.length; k++) area += (prof[k][0] - prof[k - 1][0]) * (prof[k][1] + prof[k - 1][1]) / 2;
  const topAt = u => { for (let k = 1; k < prof.length; k++) if (u <= prof[k][0] + 1e-9) { const p = prof[k - 1], q = prof[k]; return q[0] - p[0] < 1e-9 ? q[1] : p[1] + (q[1] - p[1]) * (u - p[0]) / (q[0] - p[0]); } return prof[prof.length - 1][1]; };
  for (const o of openings) { const hmax = Math.min(o.h, Math.max(topAt(o.u0 + 0.1), topAt(o.u1 - 0.1))); area -= (o.u1 - o.u0) * (isFinite(o.h) ? o.h : (topAt(o.u0 + 0.1) + topAt(o.u1 - 0.1)) / 2); void hmax; }
  const vol = meshVolume(tris);
  if (Math.abs(vol - t * area) > 0.03 * vol + 1e3) return no(14);
  const r = v => Math.round(v * 10) / 10;
  const heights = prof.map(q => q[1]), flat = heights.every(hh => Math.abs(hh - heights[0]) <= tol);
  return { start: a, end: [a[0] + d[0] * L, a[1] + d[1] * L], thickness: t, length: L, z0, height: Math.max(...heights), cross,
    profile: flat ? null : prof.map(q => [r(Math.max(0, Math.min(L, q[0]))), r(q[1])]),
    openings: openings.map(o => ({ u0: r(Math.max(0, o.u0)), u1: r(Math.min(L, o.u1)), sill: r(o.sill), h: isFinite(o.h) ? r(o.h) : null })).sort((x, y) => x.u0 - y.u0) };
}
function inside(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

// ---------------------------------------------------------------- bars: beams and columns
/** A straight member of rectangular section: its axis (end to end through the section's centre) and
 *  its section's two sides, when the mesh fills that box. */
export function recogniseBar(m, { tol = 1.5 } = {}) {
  const tris = meshTriangles(m); if (tris.length < 12) return null;
  const P = m.positions, pts = []; for (let i = 0; i < P.length; i += 3) pts.push([P[i], P[i + 1], P[i + 2]]);
  const c = [0, 1, 2].map(k => pts.reduce((s, q) => s + q[k], 0) / pts.length);
  // the long axis: the direction of the longest spread (power iteration on the covariance)
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of pts) { const v = [q[0] - c[0], q[1] - c[1], q[2] - c[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += v[i] * v[j]; }
  let ax = [1, 0.3, 0.2]; for (let it = 0; it < 60; it++) { const w = [0, 1, 2].map(i => C[i][0] * ax[0] + C[i][1] * ax[1] + C[i][2] * ax[2]), l = Math.hypot(...w) || 1; ax = w.map(x => x / l); }
  // snap a nearly level or nearly upright axis exactly
  if (Math.abs(ax[2]) > 0.999) ax = [0, 0, Math.sign(ax[2])]; else if (Math.abs(ax[2]) < 0.001) { const l = Math.hypot(ax[0], ax[1]); ax = [ax[0] / l, ax[1] / l, 0]; }
  const up = Math.abs(ax[2]) > 0.9;
  // across: for a level bar, horizontal and vertical; for an upright one, the plan box's own sides
  let e1, e2;
  if (up) { const b = orientedBox(hull2(pts)); if (!b) return null; e1 = [b.dir[0], b.dir[1], 0]; e2 = [-b.dir[1], b.dir[0], 0]; }
  else { const h = Math.hypot(ax[0], ax[1]); e1 = [-ax[1] / h, ax[0] / h, 0]; e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]]; if (e2[2] < 0) e2 = e2.map(x => -x); }
  const dot = (q, v) => (q[0] - c[0]) * v[0] + (q[1] - c[1]) * v[1] + (q[2] - c[2]) * v[2];
  const ext = v => { const s = pts.map(q => dot(q, v)); return [Math.min(...s), Math.max(...s)]; };
  // the section's own sides: the smallest box round the points seen end-on, and how far it is turned (roll)
  const sec = orientedBox(hull2(pts.map(q => [dot(q, e1), dot(q, e2)])));
  let roll = 0;
  if (sec && !up) {
    const ang = Math.atan2(sec.dir[1], sec.dir[0]);                   // the long side of the section from e1
    const turn = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2), r0 = turn > Math.PI / 4 ? turn - Math.PI / 2 : turn;
    if (Math.abs(r0) > 0.002) { roll = r0; const c1 = Math.cos(r0), s1 = Math.sin(r0), f1 = e1.map((v, k) => v * c1 + e2[k] * s1), f2 = e2.map((v, k) => -e1[k] * s1 + v * c1); e1 = f1; e2 = f2; }
  }
  const [u0, u1] = ext(ax), [a0, a1] = ext(e1), [b0, b1] = ext(e2);
  const Lb = u1 - u0, W = a1 - a0, D = b1 - b0;
  if (Lb < 2 * Math.max(W, D) || W < 5 || D < 5) return null;
  const vol = meshVolume(tris); if (Math.abs(vol - Lb * W * D) > 0.02 * vol + 1e3) return null;
  const mid = [0, 1, 2].map(k => c[k] + e1[k] * (a0 + a1) / 2 + e2[k] * (b0 + b1) / 2);
  const c0 = [0, 1, 2].map(k => mid[k] + ax[k] * u0), c1 = [0, 1, 2].map(k => mid[k] + ax[k] * u1);
  return { c0, c1, W, D, up, dir: e1, roll: roll * 180 / Math.PI };
}

// ---------------------------------------------------------------- tubes: round ducts and pipes
/** A straight round tube (a duct or pipe run): its axis and outside diameter, and its wall thickness
 *  when it is hollow. Vertices lie on one or two circles about the axis at each end. */
export function recogniseTube(m, { tol = 2 } = {}) {
  const tris = meshTriangles(m); if (tris.length < 16) return null;
  const P = m.positions, pts = []; for (let i = 0; i < P.length; i += 3) pts.push([P[i], P[i + 1], P[i + 2]]);
  const bar = recogniseBarAxis(pts); if (!bar) return null;
  const { c, ax } = bar;
  const along = q => (q[0] - c[0]) * ax[0] + (q[1] - c[1]) * ax[1] + (q[2] - c[2]) * ax[2];
  const radial = q => { const s = along(q); return Math.hypot(q[0] - c[0] - ax[0] * s, q[1] - c[1] - ax[1] * s, q[2] - c[2] - ax[2] * s); };
  // the points on the axis are end-cap centres; the rest lie on the outside circle, and on an inside one if hollow
  const rs = pts.map(radial).filter(x => x > tol), R = Math.max(...rs), inner = rs.filter(x => x < R - 0.1), r = inner.length ? Math.min(...inner) : 0;
  if (!rs.length || rs.some(x => Math.abs(x - R) > 0.1 && Math.abs(x - r) > 0.1)) return null;       // not circles about one axis
  const us = pts.map(along), u0 = Math.min(...us), u1 = Math.max(...us), L = u1 - u0;
  if (L < 2 * R || R < 5) return null;
  // polygonal circles hold less than the true ones: compare with the n-gon's area
  const n = Math.max(6, Math.round(pts.filter(q => Math.abs(along(q) - u0) < tol && Math.abs(radial(q) - R) < 0.1).length));
  const ngon = rad => n / 2 * rad * rad * Math.sin(2 * Math.PI / n);
  const hollow = r > 0, vol = meshVolume(tris), want = L * (ngon(R) - (hollow ? ngon(r) : 0));
  if (Math.abs(vol - want) > 0.03 * vol + 1e3) return null;
  const c0 = [0, 1, 2].map(k => c[k] + ax[k] * u0), c1 = [0, 1, 2].map(k => c[k] + ax[k] * u1);
  return { c0, c1, diameter: 2 * R, wall: hollow ? R - r : 0 };
}
function recogniseBarAxis(pts) {
  const c = [0, 1, 2].map(k => pts.reduce((s, q) => s + q[k], 0) / pts.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of pts) { const v = [q[0] - c[0], q[1] - c[1], q[2] - c[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += v[i] * v[j]; }
  let ax = [0.2, 0.3, 1]; for (let it = 0; it < 80; it++) { const w = [0, 1, 2].map(i => C[i][0] * ax[0] + C[i][1] * ax[1] + C[i][2] * ax[2]), l = Math.hypot(...w) || 1; ax = w.map(x => x / l); }
  if (Math.abs(ax[2]) > 0.999) ax = [0, 0, 1];
  // the centre of a ring of points is its middle, not its mean when the ring is uneven: use the bounding middle across the axis
  return { c, ax };
}
