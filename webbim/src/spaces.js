//! Planar face-finding (spec §3.6): turn a soup of straight segments into the
//! bounded faces of their planar subdivision, then give each face to the space
//! whose anchor lies in it.
//!
//! Pipeline: split at every intersection (grid-indexed) → weld within tol
//! (union-find over a grid, not rounded keys, so two points 0.4 mm apart on
//! either side of a rounding boundary still merge) → drop zero-length and
//! duplicate edges → prune dangles → sort half-edges by angle at each vertex →
//! walk faces with the "next = previous in CCW order around the far vertex"
//! rule, which keeps the face on the left, so bounded faces come out CCW
//! (positive area) and each component's outer boundary comes out CW (negative).

import { TOL, sub, cross, dot, dist, polyArea, pointInPoly, bboxOf, GridIndex } from "./geom2d.js";

// ---------------------------------------------------------------- step 1: split
/** Split parameters for every segment against every nearby segment. */
function spSplit(segs, tol) {
  const n = segs.length;
  const params = segs.map(() => [0, 1]);
  if (!n) return params;
  const all = [];
  for (const s of segs) all.push(s[0], s[1]);
  const bb = bboxOf(all);
  const W = bb[2] - bb[0], H = bb[3] - bb[1];
  const diag = Math.hypot(W, H);
  // Cell ~ mean spacing, but never so small that one long segment covers
  // more than ~256² cells.
  const cell = Math.max(4 * tol, (W + H) / (2 * Math.sqrt(n)), diag / 256, 1);
  const grid = new GridIndex(cell);
  const boxes = segs.map(s => [Math.min(s[0][0], s[1][0]) - tol, Math.min(s[0][1], s[1][1]) - tol,
                               Math.max(s[0][0], s[1][0]) + tol, Math.max(s[0][1], s[1][1]) + tol]);
  segs.forEach((s, i) => grid.insert(boxes[i], i));
  for (let i = 0; i < n; i++) {
    for (const j of grid.query(boxes[i])) {
      if (j <= i) continue;
      spPair(segs[i], segs[j], params[i], params[j], tol);
    }
  }
  return params;
}

/** Push onto pa / pb the parameters where segments a and b meet. */
function spPair(a, b, pa, pb, tol) {
  const da = sub(a[1], a[0]), db = sub(b[1], b[0]);
  const La2 = dot(da, da), Lb2 = dot(db, db);
  const La = Math.sqrt(La2), Lb = Math.sqrt(Lb2);
  // Endpoint-on-segment: T-touches and collinear overlaps (each segment is
  // split at the other's endpoints; the overlapping pieces then coincide and
  // are removed as duplicates).
  spTouch(b[0], a[0], da, La2, La, pa, tol);
  spTouch(b[1], a[0], da, La2, La, pa, tol);
  spTouch(a[0], b[0], db, Lb2, Lb, pb, tol);
  spTouch(a[1], b[0], db, Lb2, Lb, pb, tol);
  // Proper crossing.
  const det = cross(da, db);
  if (Math.abs(det) <= 1e-12 * La * Lb) return;
  const w = sub(b[0], a[0]);
  const t = cross(w, db) / det, u = cross(w, da) / det;
  const ea = tol / La, eb = tol / Lb;
  if (t < -ea || t > 1 + ea || u < -eb || u > 1 + eb) return;
  pa.push(Math.min(1, Math.max(0, t)));
  pb.push(Math.min(1, Math.max(0, u)));
}

function spTouch(E, P, d, L2, L, out, tol) {
  const t = dot(sub(E, P), d) / L2;
  if (t <= 0 || t >= 1) return;
  const q = [P[0] + d[0] * t, P[1] + d[1] * t];
  if (dist(E, q) <= tol) out.push(t);
}

// ---------------------------------------------------------------- step 2: weld
/** Union-find weld of points within tol. Returns { verts, idOf } where idOf[k]
 *  is the welded vertex of input point k and verts are cluster centroids. */
function spWeld(points, tol) {
  const n = points.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const grid = new GridIndex(Math.max(tol, 1e-3) * 2);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const box = [p[0] - tol, p[1] - tol, p[0] + tol, p[1] + tol];
    for (const j of grid.query(box)) {
      if (dist(p, points[j]) <= tol) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
    }
    grid.insert([p[0], p[1], p[0], p[1]], i);
  }
  const rootId = new Map(), sums = [], idOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let id = rootId.get(r);
    if (id === undefined) { id = sums.length; rootId.set(r, id); sums.push([0, 0, 0]); }
    sums[id][0] += points[i][0]; sums[id][1] += points[i][1]; sums[id][2]++;
    idOf[i] = id;
  }
  return { verts: sums.map(s => [s[0] / s[2], s[1] / s[2]]), idOf };
}

// ---------------------------------------------------------------- findLoops
export function findLoops(segments, opts = {}) {
  const tol = opts.tol ?? 0.5;
  const segs = (segments || []).filter(s => s && dist(s[0], s[1]) > Math.max(tol, TOL) * 1e-3);
  const params = spSplit(segs, tol);

  // Sub-pieces as pairs of point indices into `pts`.
  const pts = [], pieces = [];
  segs.forEach((s, i) => {
    const ts = params[i].sort((x, y) => x - y);
    const d = sub(s[1], s[0]);
    let prev = -1;
    for (const t of ts) {
      const k = pts.length;
      pts.push(t === 0 ? s[0] : t === 1 ? s[1] : [s[0][0] + d[0] * t, s[0][1] + d[1] * t]);
      if (prev >= 0) pieces.push([prev, k]);
      prev = k;
    }
  });
  const { verts, idOf } = spWeld(pts, tol);

  // Step 3: zero-length and duplicate edges.
  const seen = new Set();
  let edges = [];
  for (const [p, q] of pieces) {
    const a = idOf[p], b = idOf[q];
    if (a === b) continue;
    const key = a < b ? a + "," + b : b + "," + a;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  // Prune dangles iteratively.
  const deg = new Int32Array(verts.length);
  const inc = verts.map(() => []);
  edges.forEach((e, k) => { deg[e[0]]++; deg[e[1]]++; inc[e[0]].push(k); inc[e[1]].push(k); });
  const alive = edges.map(() => true);
  const stack = [];
  for (let v = 0; v < verts.length; v++) if (deg[v] === 1) stack.push(v);
  while (stack.length) {
    const v = stack.pop();
    if (deg[v] !== 1) continue;
    for (const k of inc[v]) {
      if (!alive[k]) continue;
      alive[k] = false;
      const o = edges[k][0] === v ? edges[k][1] : edges[k][0];
      deg[v]--; deg[o]--;
      if (deg[o] === 1) stack.push(o);
    }
  }
  edges = edges.filter((_, k) => alive[k]);
  // Compact vertex ids.
  const remap = new Int32Array(verts.length).fill(-1), V = [];
  for (const e of edges) for (let s = 0; s < 2; s++) { if (remap[e[s]] < 0) { remap[e[s]] = V.length; V.push(verts[e[s]]); } e[s] = remap[e[s]]; }

  // Step 4: half-edges h = 2k (a→b), 2k+1 (b→a); twin = h ^ 1.
  const org = h => edges[h >> 1][h & 1];
  const dst = h => edges[h >> 1][(h & 1) ^ 1];
  const out = V.map(() => []);
  for (let h = 0; h < edges.length * 2; h++) out[org(h)].push(h);
  const pos = new Int32Array(edges.length * 2);
  for (let v = 0; v < V.length; v++) {
    const ang = h => { const q = V[dst(h)], p = V[v]; return Math.atan2(q[1] - p[1], q[0] - p[0]); };
    out[v].sort((x, y) => ang(x) - ang(y));
    out[v].forEach((h, i) => { pos[h] = i; });
  }
  // Step 5: walk. next(h) = the half-edge just clockwise of twin(h) at dst(h).
  const next = h => { const t = h ^ 1, L = out[org(t)]; return L[(pos[t] - 1 + L.length) % L.length]; };
  // Component of each vertex (for hole assignment).
  const comp = spComponents(V.length, edges);
  const used = new Uint8Array(edges.length * 2);
  const faces = [];
  for (let h0 = 0; h0 < edges.length * 2; h0++) {
    if (used[h0]) continue;
    const cyc = [];
    let h = h0, guard = 0;
    while (!used[h] && guard++ <= edges.length * 2) { used[h] = 1; cyc.push(V[org(h)]); h = next(h); }
    faces.push({ pts: cyc, area: polyArea(cyc), comp: comp[org(h0)] });
  }

  // Step 6: assemble bounded faces with holes.
  const areaEps = Math.max(tol * tol, 1e-9);
  const pos_ = faces.filter(f => f.area > areaEps);
  const neg = faces.filter(f => f.area < -areaEps);
  const loops = pos_.map(f => ({ pts: f.pts, holes: [], area: f.area, net: f.area }));
  for (const f of neg) {
    const probe = f.pts[0];
    let best = -1;
    pos_.forEach((g, i) => {
      if (g.comp === f.comp) return;
      if (best >= 0 && g.area >= pos_[best].area) return;
      if (pointInPoly(probe, g.pts)) best = i;
    });
    if (best < 0) continue;           // the unbounded face of an outermost component
    loops[best].holes.push(f.pts);
    loops[best].net += f.area;        // f.area is negative
  }
  return {
    loops,
    faces: faces.map(f => ({ pts: f.pts, area: f.area })),
    stats: { vertices: V.length, edges: edges.length },
  };
}

function spComponents(nv, edges) {
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const [a, b] of edges) { const x = find(a), y = find(b); if (x !== y) parent[x] = y; }
  const c = new Int32Array(nv);
  for (let i = 0; i < nv; i++) c[i] = find(i);
  return c;
}

// ---------------------------------------------------------------- inside tests
function spInLoop(p, loop) {
  if (!pointInPoly(p, loop.pts)) return false;
  for (const h of loop.holes || []) if (pointInPoly(p, h)) return false;
  return true;
}

/** A point strictly inside `pts` and outside every hole: scan horizontal lines
 *  (middle of the bbox first, then quarters, eighths…) and return the midpoint
 *  of the widest inside interval found. */
export function interiorPoint(pts, holes = []) {
  const rings = [pts, ...holes];
  const bb = bboxOf(pts);
  const fracs = [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875];
  for (let k = 4; k <= 6; k++) for (let i = 1; i < (1 << k); i += 2) fracs.push(i / (1 << k));
  let best = null, bestW = 0;
  for (const f of fracs) {
    const y = bb[1] + (bb[3] - bb[1]) * f;
    const xs = [];
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i], b = r[j];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (w > bestW) { bestW = w; best = [(xs[i] + xs[i + 1]) / 2, y]; }
    }
    // The middle scanline is good enough unless it is a sliver.
    if (best && bestW > 1e-6 * Math.max(1, bb[2] - bb[0]) && f === 0.5) return best;
  }
  if (best) return best;
  let sx = 0, sy = 0; for (const p of pts) { sx += p[0]; sy += p[1]; }
  return [sx / pts.length, sy / pts.length];
}

// ---------------------------------------------------------------- claim / filter
export function claimLoops(loops, spaces) {
  const result = {};
  const owner = new Map();
  for (const s of spaces || []) {
    let bi = -1;
    loops.forEach((l, i) => {
      if (bi >= 0 && Math.abs(l.area) >= Math.abs(loops[bi].area)) return;
      if (spInLoop(s.anchor, l)) bi = i;
    });
    if (bi < 0) { result[s.id] = { loop: null, status: "not enclosed" }; continue; }
    if (owner.has(bi)) result[s.id] = { loop: loops[bi], status: "redundant" };
    else { owner.set(bi, s.id); result[s.id] = { loop: loops[bi], status: "ok" }; }
  }
  return result;
}

export function filterWallFaces(loops, isInsideSolid) {
  return loops.filter(l => !isInsideSolid(interiorPoint(l.pts, l.holes)));
}
