//! Massing: the maximum envelope a building may fill, as a triangle mesh - read here from OBJ or STL,
//! or from STEP through the OpenCascade kernel (which also says which B-Rep face each triangle came
//! from). Levels are laid through it at a floor-to-floor height; each level's floor plate is the
//! envelope cut at that level, and what a level can hold is measured from its plate.
//!
//! Everything here is plain geometry on { positions: [x,y,z,…], index: [a,b,c,…], faces?: [..] }
//! in millimetres, z up - so it is tested without a browser.

import { polyArea, pointInPoly, dist, sub, add, mul, dot, normalise, lerp } from "./geom2d.js";

// ---------------------------------------------------------------- reading
/** OBJ: v and f records (polygons fanned; negative indices honoured). `scale` turns file units to mm. */
export function parseOBJ(text, scale = 1) {
  const P = [], I = [], faceOf = []; let group = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const s = raw.trim(); if (!s || s[0] === "#") continue;
    const t = s.split(/\s+/);
    if (t[0] === "v") P.push(+t[1] * scale, +t[2] * scale, +t[3] * scale);
    else if (t[0] === "g" || t[0] === "o") group++;
    else if (t[0] === "f") {
      const n = P.length / 3, ids = t.slice(1).map(x => { const k = parseInt(x.split("/")[0], 10); return k < 0 ? n + k : k - 1; });
      for (let i = 1; i + 1 < ids.length; i++) { I.push(ids[0], ids[i], ids[i + 1]); faceOf.push(group); }
    }
  }
  return { positions: P, index: I, groups: faceOf };
}
/** STL, ASCII or binary. Coincident vertices are merged so the mesh has topology to slice and grow. */
export function parseSTL(buf, scale = 1) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const head = new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 512)));
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const binary = u8.length >= 84 && 84 + dv.getUint32(80, true) * 50 === u8.length;
  const tri = [];
  if (binary || !/^\s*solid/.test(head)) {
    const n = dv.getUint32(80, true);
    for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; for (let k = 0; k < 9; k++) tri.push(dv.getFloat32(o + k * 4, true) * scale); }
  } else {
    const txt = new TextDecoder().decode(u8), re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g; let m;
    while ((m = re.exec(txt))) tri.push(+m[1] * scale, +m[2] * scale, +m[3] * scale);
  }
  const w = weldTriangles(tri); delete w.kept; return w;
}
/** Loose triangles (9 numbers each) → an indexed mesh, vertices within `tol` mm merged. */
export function weldTriangles(tri, tol = 0.5) {
  const map = new Map(), P = [], I = [], key = (x, y, z) => `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
  for (let i = 0; i < tri.length; i += 3) {
    const k = key(tri[i], tri[i + 1], tri[i + 2]); let id = map.get(k);
    if (id === undefined) { id = P.length / 3; map.set(k, id); P.push(tri[i], tri[i + 1], tri[i + 2]); }
    I.push(id);
  }
  // drop triangles that collapsed in the weld; `kept` says which input triangle each output one was
  const J = [], kept = []; for (let i = 0; i < I.length; i += 3) if (I[i] !== I[i + 1] && I[i + 1] !== I[i + 2] && I[i] !== I[i + 2]) { J.push(I[i], I[i + 1], I[i + 2]); kept.push(i / 3); }
  return { positions: P, index: J, kept };
}
/** A mesh as the OpenCascade kernel streams it: per part positions, index and face groups
 *  [start, count, faceId] in index units - welded across face seams, each triangle keeping its face. */
export function meshFromKernel(parts) {
  const tri = [], face = []; let fbase = 0;
  for (const m of parts || []) {
    if (!m.positions || !m.index) continue;
    const ft = new Array(m.index.length / 3).fill(0), fg = m.faceGroups || []; let fmax = 0;
    for (let g = 0; g + 2 < fg.length; g += 3) { for (let t = fg[g] / 3; t < (fg[g] + fg[g + 1]) / 3; t++) ft[t] = fg[g + 2]; fmax = Math.max(fmax, fg[g + 2]); }
    for (let t = 0; t < m.index.length / 3; t++) { for (let e = 0; e < 3; e++) { const v = m.index[t * 3 + e] * 3; tri.push(m.positions[v], m.positions[v + 1], m.positions[v + 2]); } face.push(fbase + ft[t]); }
    fbase += fmax + 1;
  }
  const w = weldTriangles(tri, 0.01);
  return { positions: w.positions, index: w.index, faces: w.kept.map(t => face[t]) };
}
/** Round coordinates to 0.1 mm so a stored mesh stays small. */
export function packMesh(m) { const out = { positions: m.positions.map(v => Math.round(v * 10) / 10), index: m.index.slice() }; if (m.faces) out.faces = m.faces.slice(); return out; }
/** Move, turn about z and scale a mesh. */
export function placeMesh(m, { x = 0, y = 0, z = 0, rotation = 0, scale = 1 } = {}) {
  const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), P = m.positions, out = new Array(P.length);
  for (let i = 0; i < P.length; i += 3) { const px = P[i] * scale, py = P[i + 1] * scale; out[i] = px * c - py * s + x; out[i + 1] = px * s + py * c + y; out[i + 2] = P[i + 2] * scale + z; }
  return Object.assign({}, m, { positions: out });
}

// ---------------------------------------------------------------- measuring
export function meshBox(m) {
  const P = m.positions; if (!P.length) return null;
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], P[i + k]); b[k + 3] = Math.max(b[k + 3], P[i + k]); }
  return b;
}
/** Signed volume (mm³) and surface area (mm²). Positive volume for an outward-facing closed mesh. */
export function meshMeasure(m) {
  const P = m.positions, I = m.index; let V = 0, A = 0;
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[c], cy = P[c + 1], cz = P[c + 2];
    V += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    A += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return { volume: V, area: A };
}

// ---------------------------------------------------------------- cutting
/**
 * The mesh cut by the plane z = h: closed loops (and any open runs, if the mesh has holes), each a
 * list of [x, y]. Segments are joined end to end by their shared mesh edges, so the loops are
 * exact to the tessellation.
 */
export function sliceMesh(m, h) {
  const P = m.positions, I = m.index, segs = [];
  const eKey = (a, b) => a < b ? a + "_" + b : b + "_" + a;
  for (let i = 0; i < I.length; i += 3) {
    const v = [I[i], I[i + 1], I[i + 2]], z = v.map(k => P[k * 3 + 2] - h);
    // nudge vertices exactly on the plane just above it, so every crossing is an edge crossing
    const zz = z.map(x => Math.abs(x) < 1e-7 ? 1e-7 : x);
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3], za = zz[e], zb = zz[(e + 1) % 3];
      if ((za > 0) === (zb > 0)) continue;
      const t = za / (za - zb);
      pts.push({ key: eKey(a, b), p: [P[a * 3] + (P[b * 3] - P[a * 3]) * t, P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t] });
    }
    if (pts.length === 2) segs.push(pts);
  }
  // chain by edge keys
  const byKey = new Map(); segs.forEach((s, i) => { for (const e of s) { if (!byKey.has(e.key)) byKey.set(e.key, []); byKey.get(e.key).push(i); } });
  const used = new Set(), loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue; used.add(i);
    const chain = [segs[i][0], segs[i][1]];
    const grow = (end) => {
      for (;;) {
        const tip = end ? chain[chain.length - 1] : chain[0];
        const nxt = (byKey.get(tip.key) || []).find(j => !used.has(j)); if (nxt === undefined) return;
        used.add(nxt); const s = segs[nxt], other = s[0].key === tip.key ? s[1] : s[0];
        if (end) chain.push(other); else chain.unshift(other);
      }
    };
    grow(true); grow(false);
    const closed = chain.length > 3 && chain[0].key === chain[chain.length - 1].key;
    const pts = chain.map(c => c.p); if (closed) pts.pop();
    if (pts.length >= 2) loops.push({ pts, closed });
  }
  return loops;
}
/** The floor plate at height h: the outer loops (holes, if any, inside them), counter-clockwise, and its area. */
export function plateAt(m, h) {
  const loops = sliceMesh(m, h).filter(l => l.closed && l.pts.length >= 3).map(l => (polyArea(l.pts) < 0 ? l.pts.slice().reverse() : l.pts));
  const outers = loops.filter(l => !loops.some(o => o !== l && Math.abs(polyArea(o)) > Math.abs(polyArea(l)) && pointInPoly(l[0], o)));
  const holes = loops.filter(l => !outers.includes(l));
  const plates = outers.map(o => ({ outer: o, holes: holes.filter(hh => pointInPoly(hh[0], o)) }));
  const area = plates.reduce((a, p) => a + Math.abs(polyArea(p.outer)) - p.holes.reduce((s, hh) => s + Math.abs(polyArea(hh)), 0), 0);
  return { plates, area };
}
/**
 * The usable plate of a storey from zBot to zTop: the envelope cut near the floor and near the
 * ceiling, and the smaller of the two kept - where the envelope leans in, a room must fit at its
 * ceiling as well as its floor. Convex plates are intersected exactly.
 */
export function storeyPlate(m, zBot, zTop) {
  const a = plateAt(m, zBot + 1), b = plateAt(m, zTop - 1);
  if (!a.plates.length) return b; if (!b.plates.length) return a;
  if (a.plates.length === 1 && b.plates.length === 1 && isConvex(b.plates[0].outer)) {
    const c = clipConvex(a.plates[0].outer, b.plates[0].outer);
    if (c.length >= 3) return { plates: [{ outer: c, holes: a.plates[0].holes }], area: Math.abs(polyArea(c)) - a.plates[0].holes.reduce((s, hh) => s + Math.abs(polyArea(hh)), 0) };
  }
  return a.area <= b.area ? a : b;
}
export function isConvex(poly) { let sgn = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length], cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(cr) < 1e-9) continue; const s = Math.sign(cr); if (sgn && s !== sgn) return false; sgn = s; } return true; }
/** Sutherland–Hodgman: `subject` clipped by the convex counter-clockwise `clip`. */
export function clipConvex(subject, clip) {
  let out = subject.slice();
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], inside = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], ip = inside(p), iq = inside(q);
      if (ip) out.push(p);
      if (ip !== iq) { const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]), t = d1 / (d1 - d2); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  return out;
}
/** A polygon clipped to the half-plane dot(p, n) between lo and hi: a strip across it. */
export function clipStrip(poly, n, lo, hi) {
  const half = (pts, k, c) => { const out = []; for (let j = 0; j < pts.length; j++) { const p = pts[j], q = pts[(j + 1) % pts.length], dp = k * (dot(p, n) - c), dq = k * (dot(q, n) - c); if (dp >= 0) out.push(p); if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } } return out; };
  return half(half(poly, 1, lo), -1, hi);
}
/** Douglas–Peucker on a closed loop: vertices closer than tol to the chord go. */
export function simplifyLoop(pts, tol = 50) {
  if (pts.length < 5) return pts.slice();
  const dp = (a, b, list) => { let md = -1, mi = -1; const d = sub(b, a), L = Math.hypot(d[0], d[1]) || 1; for (let i = 0; i < list.length; i++) { const q = sub(list[i], a), dd = Math.abs(q[0] * d[1] - q[1] * d[0]) / L; if (dd > md) { md = dd; mi = i; } } return md > tol ? [...dp(a, list[mi], list.slice(0, mi)), list[mi], ...dp(list[mi], b, list.slice(mi + 1))] : []; };
  // split at the vertex farthest from the first
  let fi = 0, fd = -1; pts.forEach((p, i) => { const d = dist(p, pts[0]); if (d > fd) { fd = d; fi = i; } });
  const A = pts.slice(0, fi + 1), B = pts.slice(fi).concat([pts[0]]);
  const out = [pts[0], ...dp(pts[0], pts[fi], A.slice(1, -1)), pts[fi], ...dp(pts[fi], pts[0], B.slice(1, -1))];
  return out.length >= 3 ? out : pts.slice();
}
/** A counter-clockwise loop moved inward by d, each edge parallel, neighbours met (miter), with a guard on sharp corners. */
export function offsetLoop(pts, d) {
  const n = pts.length, lines = pts.map((a, i) => { const b = pts[(i + 1) % n], t = normalise(sub(b, a)), nr = [-t[1], t[0]]; return { p: add(a, mul(nr, d)), t }; });
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i + n - 1) % n], L2 = lines[i], den = L1.t[0] * L2.t[1] - L1.t[1] * L2.t[0];
    if (Math.abs(den) < 1e-6) { out.push(L2.p); continue; }
    const s = ((L2.p[0] - L1.p[0]) * L2.t[1] - (L2.p[1] - L1.p[1]) * L2.t[0]) / den, q = add(L1.p, mul(L1.t, s));
    // a miter longer than 4 d on a sharp corner is cut back to the corner's own normal
    out.push(dist(q, pts[i]) > Math.abs(d) * 4 ? add(pts[i], mul(normalise(add(sub(L1.p, pts[(i + n - 1) % n]), sub(L2.p, pts[i]))), Math.abs(d))) : q);
  }
  return out;
}

// ---------------------------------------------------------------- levels
/** How many storeys of height h fit from z0 to the top of the envelope; a storey counts when at least `minPlate` of it has a plate. */
export function levelsIn(m, h, { z0 = null, minPlate = 20e6 } = {}) {
  const b = meshBox(m); if (!b) return [];
  const base = z0 ?? b[2], out = [];
  for (let k = 0; base + (k + 1) * h <= b[5] + 1; k++) {
    const zb = base + k * h, pl = storeyPlate(m, zb, zb + h);
    if (pl.area >= minPlate) out.push({ index: k, z: zb, area: pl.area, plates: pl.plates });
  }
  return out;
}

// ---------------------------------------------------------------- faces
/** Per-vertex normals, area-weighted, from the triangles that use each vertex. */
export function vertexNormals(m) {
  const P = m.positions, I = m.index, N = new Array(P.length).fill(0);
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const k of [a, b, c]) { N[k] += n[0]; N[k + 1] += n[1]; N[k + 2] += n[2]; }
  }
  for (let i = 0; i < N.length; i += 3) { const L = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= L; N[i + 1] /= L; N[i + 2] /= L; }
  return N;
}
function triNormal(m, t) {
  const P = m.positions, I = m.index, a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
  const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], L = Math.hypot(...n) || 1;
  return [n[0] / L, n[1] / L, n[2] / L];
}
/**
 * The face a click on triangle t means. A B-Rep face when the kernel said which triangles are one
 * face; otherwise the triangles reachable across edges whose normals turn less than `angle` degrees -
 * 1° for a single flat facet of a faceted mesh, more to follow a smooth surface.
 */
export function faceRegion(m, t, angle = 1) {
  if (m.faces && m.faces.length === m.index.length / 3) { const f = m.faces[t]; return m.faces.map((x, i) => x === f ? i : -1).filter(i => i >= 0); }
  const I = m.index, nt = I.length / 3, edges = new Map();
  for (let i = 0; i < nt; i++) for (let e = 0; e < 3; e++) { const a = I[i * 3 + e], b = I[i * 3 + (e + 1) % 3], k = a < b ? a + "_" + b : b + "_" + a; if (!edges.has(k)) edges.set(k, []); edges.get(k).push(i); }
  const cosT = Math.cos(angle * Math.PI / 180), seen = new Set([t]), queue = [t];
  while (queue.length) {
    const i = queue.shift(), ni = triNormal(m, i);
    for (let e = 0; e < 3; e++) {
      const a = I[i * 3 + e], b = I[i * 3 + (e + 1) % 3], k = a < b ? a + "_" + b : b + "_" + a;
      for (const j of edges.get(k)) if (!seen.has(j)) { const nj = triNormal(m, j); if (ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2] >= cosT) { seen.add(j); queue.push(j); } }
    }
  }
  return [...seen].sort((a, b) => a - b);
}
/** The triangles listed, as their own mesh (vertices renumbered). */
export function subMesh(m, tris) {
  const map = new Map(), P = [], I = [];
  for (const t of tris) for (let e = 0; e < 3; e++) { const v = m.index[t * 3 + e]; let k = map.get(v); if (k === undefined) { k = P.length / 3; map.set(v, k); P.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); } I.push(k); }
  return { positions: P, index: I };
}
/** A surface moved along its vertex normals by d. Flat patches move exactly; curved ones as their offset surface, to the tessellation. */
export function offsetMesh(m, d, normals = vertexNormals(m)) {
  const P = m.positions, out = new Array(P.length);
  for (let i = 0; i < P.length; i++) out[i] = P[i] + normals[i] * d;
  return { positions: out, index: m.index.slice() };
}
/** The boundary edges of an open patch, as vertex pairs in the patch's winding. */
export function boundaryEdges(m) {
  const I = m.index, count = new Map();
  for (let i = 0; i < I.length; i += 3) for (let e = 0; e < 3; e++) { const a = I[i + e], b = I[i + (e + 1) % 3], k = a < b ? a + "_" + b : b + "_" + a; const c = count.get(k); count.set(k, c ? { n: c.n + 1, a: c.a, b: c.b } : { n: 1, a, b }); }
  return [...count.values()].filter(c => c.n === 1).map(c => [c.a, c.b]);
}
/**
 * A shell between two offsets of a patch - one wall layer - as triangles: the two surfaces and the
 * strips along the patch's rim that close them.
 */
export function layerShell(patch, dA, dB, normals = vertexNormals(patch)) {
  const A = offsetMesh(patch, dA, normals), B = offsetMesh(patch, dB, normals), n = patch.positions.length / 3;
  const P = A.positions.concat(B.positions), I = [];
  for (let i = 0; i < patch.index.length; i += 3) { const [a, b, c] = patch.index.slice(i, i + 3); I.push(a, b, c, c + n, b + n, a + n); }
  for (const [a, b] of boundaryEdges(patch)) I.push(a, a + n, b + n, a, b + n, b);
  return { positions: P, index: I };
}
/**
 * The storeys a massing holds between the levels that exist - so moving or deleting a level (as any
 * level is edited) changes the plates. A level whose storey cuts less than `minPlate` of envelope
 * is not a storey of this massing. levels: [{ id, name, z }].
 */
export function storeysFor(m, levels, floorToFloor, minPlate = 20e6) {
  const b = meshBox(m); if (!b) return [];
  const L = levels.slice().sort((a, c) => a.z - c.z), out = [];
  L.forEach((lv, i) => {
    if (lv.z < b[2] - 1 || lv.z > b[5] - 1000) return;
    const top = Math.min(b[5], i + 1 < L.length ? L[i + 1].z : lv.z + floorToFloor);
    if (top - lv.z < 1000) return;
    const pl = storeyPlate(m, lv.z, top);
    if (pl.area >= minPlate) out.push({ key: lv.id, name: lv.name, z: lv.z, height: top - lv.z, plates: pl.plates, area: pl.area });
  });
  return out;
}
