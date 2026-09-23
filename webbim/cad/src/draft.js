// A cheap stand-in for a section, computed on triangles.
//
// WHY THIS EXISTS. Dragging a slider asks the kernel for the whole model once
// a frame, and one node in that model - the intersection of a solid by a set
// of extruded offsets - takes four and a half seconds on its own. The reason
// is not that the WASM is slow. It is that OpenCascade has no analytic
// intersector for the pair it is being handed: every one of a hundred and
// sixty face pairs is a plane or a cylinder against a surface of extrusion
// over a B-spline, so each one goes to the general numeric intersector at
// about thirty milliseconds. Exact, and correct, and the right thing to have
// when the number has stopped moving.
//
// It is the wrong thing to have WHILE the number is moving. What a hand
// dragging a slider wants is the shape of the answer at the frame rate; what
// it wants when the hand comes off is the answer. So the section is computed
// twice by two different roads: here, on the triangles the viewer was going
// to be given anyway, while the slider is live - and in OpenCascade, once,
// when it stops.
//
// Nothing in this file knows what OpenCascade is. It takes triangles in and
// gives polylines back, which is the whole of the contract: the kernel
// tessellates, calls one of these, and strings the answer into edges.
//
// THE ACCURACY IS THE TESSELLATION'S. A section computed on triangles is
// exactly as close to the true curve as the triangles are to the true
// surface, which is the deflection the viewer draws at - the error is
// invisible for the same reason the drawn surface looks smooth. What it is
// NOT is topologically the same thing: a preview is a pile of polylines with
// no analytic curve under it, so it is never what a downstream feature gets
// to keep. It is what gets drawn for a few hundred milliseconds.

import { V } from "./factory.js";

//! Below this, two points are the same point. Relative to the model, because a
//! bridge and a bracket are not measured in the same numbers.
const DRAFT_JOIN = 1e-4;

const cornerAt = (positions, i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];

//! The longest edge of a triangle, which is the only scale its own arithmetic
//! has: every tolerance below is a fraction of it, so a triangle a metre
//! across and one a micron across are judged the same way.
function longestEdge(a, b, c) {
  return Math.max(V.length(V.sub(b, a)), V.length(V.sub(c, b)), V.length(V.sub(a, c)));
}

//! Is a point that is already known to be ON the plane of a triangle inside
//! its three edges? Asked with the triangle's own normal, so no projection to
//! a dominant axis is needed and no axis has to be chosen.
function insideTriangle(p, a, b, c, normal, tol) {
  const side = (u, v) => V.dot(V.cross(V.sub(v, u), V.sub(p, u)), normal);
  const s1 = side(a, b), s2 = side(b, c), s3 = side(c, a);
  return (s1 >= -tol && s2 >= -tol && s3 >= -tol)
      || (s1 <= tol && s2 <= tol && s3 <= tol);
}

//! Where the segment from p to q crosses a plane, given the two signed
//! distances. Never called unless they straddle it, so the denominator is
//! never zero.
function alongTo(p, q, dp, dq) {
  const t = dp / (dp - dq);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
}

//! The segment two triangles share, or nothing.
//!
//! Done by clipping rather than by the interval arithmetic of the textbook
//! method: each triangle's edges are cut against the other's plane and the
//! cuts that land inside the other triangle are kept. At most four points
//! come back from that; the two furthest apart are the segment. It is a few
//! operations more than Moller's test and it does not need a separate case
//! for coplanar triangles, which on a preview would show as a dropped edge
//! wherever two flats met.
function sharedSegment(p0, p1, p2, q0, q1, q2, out) {
  const np = V.cross(V.sub(p1, p0), V.sub(p2, p0));
  const nq = V.cross(V.sub(q1, q0), V.sub(q2, q0));
  const lp = V.length(np), lq = V.length(nq);
  if (lp < 1e-18 || lq < 1e-18) return false;          // a triangle with no area
  const un = [np[0] / lp, np[1] / lp, np[2] / lp];
  const uq = [nq[0] / lq, nq[1] / lq, nq[2] / lq];

  const spanP = longestEdge(p0, p1, p2), spanQ = longestEdge(q0, q1, q2);
  const tolP = spanP * 1e-7, tolQ = spanQ * 1e-7;

  const dp = [V.dot(uq, V.sub(p0, q0)), V.dot(uq, V.sub(p1, q0)), V.dot(uq, V.sub(p2, q0))];
  if ((dp[0] > tolQ && dp[1] > tolQ && dp[2] > tolQ)
   || (dp[0] < -tolQ && dp[1] < -tolQ && dp[2] < -tolQ)) return false;
  const dq = [V.dot(un, V.sub(q0, p0)), V.dot(un, V.sub(q1, p0)), V.dot(un, V.sub(q2, p0))];
  if ((dq[0] > tolP && dq[1] > tolP && dq[2] > tolP)
   || (dq[0] < -tolP && dq[1] < -tolP && dq[2] < -tolP)) return false;

  const found = [];
  const clip = (tri, d, other, normal, span) => {
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if ((d[i] > 0 && d[j] > 0) || (d[i] < 0 && d[j] < 0)) continue;
      if (d[i] === d[j]) continue;                     // both on it: its ends are caught as vertices
      const hit = alongTo(tri[i], tri[j], d[i], d[j]);
      if (insideTriangle(hit, other[0], other[1], other[2], normal, span * span * 1e-6)) found.push(hit);
      if (found.length >= 8) return;
    }
  };
  clip([p0, p1, p2], dp, [q0, q1, q2], uq, spanQ);
  clip([q0, q1, q2], dq, [p0, p1, p2], un, spanP);
  if (found.length < 2) return false;

  let a = found[0], b = found[1], best = -1;
  for (let i = 0; i < found.length; i++)
    for (let j = i + 1; j < found.length; j++) {
      const d = V.length(V.sub(found[j], found[i]));
      if (d > best) { best = d; a = found[i]; b = found[j]; }
    }
  if (best <= Math.min(spanP, spanQ) * 1e-6) return false;   // a touch, not a crossing
  out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  return true;
}

/* ------------------------------------------------------- where the triangles are

   A GRID, NOT A TREE. Two meshes tested pair against pair is a hundred
   million tests on the model this was written for, which is slower than the
   exact answer it was meant to replace. A uniform grid over one of them turns
   that into a handful of candidates per triangle, and it is thirty lines
   rather than three hundred because every triangle goes in by its bounding
   box and nothing ever has to be rebalanced.                                */

function draftBox(positions) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (positions[i + k] < lo[k]) lo[k] = positions[i + k];
      if (positions[i + k] > hi[k]) hi[k] = positions[i + k];
    }
  return { lo, hi };
}

function draftGrid(positions, index) {
  const box = draftBox(positions);
  const size = [box.hi[0] - box.lo[0], box.hi[1] - box.lo[1], box.hi[2] - box.lo[2]];
  const triangles = index.length / 3;
  // One cell per triangle, near enough: the cube root of the count over the
  // longest side. Clamped so a flat sheet does not ask for a million cells in
  // the direction it has no thickness in.
  const longest = Math.max(size[0], size[1], size[2]) || 1;
  const steps = Math.max(1, Math.min(64, Math.round(Math.cbrt(triangles))));
  const cell = longest / steps || 1;
  const cells = new Map();
  const key = (x, y, z) => x + "," + y + "," + z;
  const cellOf = (v, k) => Math.floor((v - box.lo[k]) / cell);

  for (let t = 0; t < triangles; t++) {
    const a = cornerAt(positions, index[t * 3]), b = cornerAt(positions, index[t * 3 + 1]),
          c = cornerAt(positions, index[t * 3 + 2]);
    const lo = [0, 0, 0], hi = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      lo[k] = cellOf(Math.min(a[k], b[k], c[k]), k);
      hi[k] = cellOf(Math.max(a[k], b[k], c[k]), k);
    }
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const at_ = key(x, y, z);
          const list = cells.get(at_);
          if (list) list.push(t); else cells.set(at_, [t]);
        }
  }
  return {
    box, cell,
    near(a, b, c, seen) {
      seen.clear();
      const lo = [0, 0, 0], hi = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        lo[k] = cellOf(Math.min(a[k], b[k], c[k]), k);
        hi[k] = cellOf(Math.max(a[k], b[k], c[k]), k);
      }
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const list = cells.get(key(x, y, z));
            if (list) for (const t of list) seen.add(t);
          }
      return seen;
    },
  };
}

/* ------------------------------------------------------------------ the two cuts */

//! Where two triangulated shapes cross, as loose segments.
export function meshCross(a, b) {
  const out = [];
  if (!a || !b || !a.index || !b.index || !a.index.length || !b.index.length) return out;
  // The grid goes over whichever is bigger, so the walk is over the smaller.
  const flip = b.index.length > a.index.length;
  const over = flip ? b : a, walk = flip ? a : b;
  const grid = draftGrid(over.positions, over.index);
  const seen = new Set();
  const triangles = walk.index.length / 3;
  for (let t = 0; t < triangles; t++) {
    const q0 = cornerAt(walk.positions, walk.index[t * 3]),
          q1 = cornerAt(walk.positions, walk.index[t * 3 + 1]),
          q2 = cornerAt(walk.positions, walk.index[t * 3 + 2]);
    for (const other of grid.near(q0, q1, q2, seen)) {
      const p0 = cornerAt(over.positions, over.index[other * 3]),
            p1 = cornerAt(over.positions, over.index[other * 3 + 1]),
            p2 = cornerAt(over.positions, over.index[other * 3 + 2]);
      sharedSegment(p0, p1, p2, q0, q1, q2, out);
    }
  }
  return out;
}

//! Where a triangulated shape crosses an unbounded plane. No grid: a plane is
//! one test per triangle and the test is three subtractions.
export function meshSlice(mesh, origin, normal) {
  const out = [];
  if (!mesh || !mesh.index || !mesh.index.length) return out;
  const n = V.norm(normal);
  if (!n) return out;
  const triangles = mesh.index.length / 3;
  for (let t = 0; t < triangles; t++) {
    const p = [cornerAt(mesh.positions, mesh.index[t * 3]),
               cornerAt(mesh.positions, mesh.index[t * 3 + 1]),
               cornerAt(mesh.positions, mesh.index[t * 3 + 2])];
    const d = [V.dot(n, V.sub(p[0], origin)), V.dot(n, V.sub(p[1], origin)),
               V.dot(n, V.sub(p[2], origin))];
    const tol = longestEdge(p[0], p[1], p[2]) * 1e-9;
    if ((d[0] > tol && d[1] > tol && d[2] > tol)
     || (d[0] < -tol && d[1] < -tol && d[2] < -tol)) continue;
    const hits = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if ((d[i] > 0 && d[j] > 0) || (d[i] < 0 && d[j] < 0)) continue;
      if (d[i] === d[j]) continue;
      hits.push(alongTo(p[i], p[j], d[i], d[j]));
    }
    if (hits.length < 2) continue;
    let a = hits[0], b = hits[1], best = V.length(V.sub(b, a));
    for (let i = 0; i < hits.length; i++)
      for (let j = i + 1; j < hits.length; j++) {
        const far = V.length(V.sub(hits[j], hits[i]));
        if (far > best) { best = far; a = hits[i]; b = hits[j]; }
      }
    if (best > 0) out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  return out;
}

/* ----------------------------------------------------- segments into polylines

   A pile of unordered segments draws the same picture as a chain of them and
   is a hundred times the edges to build, so they are threaded first. The
   thread is a hash of the endpoints onto a grid of the joining tolerance -
   which is exact enough because the segments were cut from triangles that
   SHARE those vertices, so the ends that should meet meet to the last bit.  */

export function chainSegments(flat, join = DRAFT_JOIN) {
  const segments = flat.length / 6;
  if (!segments) return [];
  const cell = Math.max(join, 1e-9);
  const keyAt = p => Math.round(p[0] / cell) + "|" + Math.round(p[1] / cell)
                   + "|" + Math.round(p[2] / cell);

  const ends = new Map();                 // key -> [segment index, ...]
  const point = new Array(segments * 2);
  const keys = new Array(segments * 2);
  for (let s = 0; s < segments; s++)
    for (let e = 0; e < 2; e++) {
      const p = [flat[s * 6 + e * 3], flat[s * 6 + e * 3 + 1], flat[s * 6 + e * 3 + 2]];
      const k = keyAt(p);
      point[s * 2 + e] = p; keys[s * 2 + e] = k;
      const list = ends.get(k);
      if (list) list.push(s); else ends.set(k, [s]);
    }

  const used = new Uint8Array(segments);
  //! The next unused segment at this end, or nothing. A vertex where three
  //! segments meet - which happens where the section touches an edge of the
  //! solid - takes whichever comes first and leaves the rest to start chains
  //! of their own. A preview does not owe anybody a canonical winding.
  const step = (k, from) => {
    const list = ends.get(k);
    if (!list) return -1;
    for (const s of list) if (s !== from && !used[s]) return s;
    return -1;
  };

  const runs = [];
  for (let s = 0; s < segments; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const run = [point[s * 2], point[s * 2 + 1]];
    let head = keys[s * 2], tail = keys[s * 2 + 1];
    for (;;) {                                        // forwards
      const next = step(tail, -1);
      if (next < 0) break;
      used[next] = 1;
      const sameEnd = keys[next * 2] === tail;
      run.push(point[next * 2 + (sameEnd ? 1 : 0)]);
      tail = keys[next * 2 + (sameEnd ? 1 : 0)];
      if (tail === head) break;                       // closed
    }
    if (tail !== head)
      for (;;) {                                      // and backwards
        const next = step(head, -1);
        if (next < 0) break;
        used[next] = 1;
        const sameEnd = keys[next * 2] === head;
        run.unshift(point[next * 2 + (sameEnd ? 1 : 0)]);
        head = keys[next * 2 + (sameEnd ? 1 : 0)];
        if (tail === head) break;
      }
    if (run.length >= 2) runs.push(run);
  }
  return runs;
}

/* ------------------------------------------------------------------ thinning

   A chain straight off the triangles has a vertex per triangle it crossed,
   and most of them say nothing: a cylinder cut square gives a circle sampled
   at the tessellation, and three hundred of those points draw what thirty
   draw. Douglas-Peucker, to the deflection the mesh was built at, because
   that is the accuracy the points had in the first place.                   */

export function thin(run, tolerance) {
  if (run.length < 3 || !(tolerance > 0)) return run;
  const closed = V.length(V.sub(run[0], run[run.length - 1])) <= tolerance;
  const keep = new Uint8Array(run.length);
  keep[0] = keep[run.length - 1] = 1;
  const stack = [[0, run.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    const a = run[lo], b = run[hi];
    const along = V.sub(b, a);
    const length = V.length(along);
    let worst = -1, where = -1;
    for (let i = lo + 1; i < hi; i++) {
      const away = V.sub(run[i], a);
      const off = length > 1e-12
        ? V.length(V.cross(away, along)) / length
        : V.length(away);
      if (off > worst) { worst = off; where = i; }
    }
    if (worst > tolerance && where > 0) {
      keep[where] = 1;
      stack.push([lo, where], [where, hi]);
    }
  }
  const out = [];
  for (let i = 0; i < run.length; i++) if (keep[i]) out.push(run[i]);
  // A loop thinned to two points is a degenerate loop; keep enough of it to
  // still be a loop.
  if (closed && out.length < 4) return run;
  return out.length >= 2 ? out : run;
}
