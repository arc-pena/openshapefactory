//! The one number a feature is about, and the hand that sets it.
//!
//! Adding a fillet and then going to look for its radius in a panel is two
//! actions where there is one thought. Every CAD modeller worth the name puts
//! the number you are about to type under the cursor the moment the feature
//! exists - CATIA's value field, SolidWorks' Instant3D - and lets the mouse
//! drive it against the model instead. That is what this is for.
//!
//! Two halves, and the second is the part that matters.
//!
//! The first is knowing WHICH number. A feature has ten arguments and one of
//! them is the answer to "how big": a fillet is its radius, a pad is its
//! distance, a cube standing on a plane is its height. That is a judgement,
//! not something that can be read off a schema, so it is a table - and the
//! table is checked against the catalogue so a row can never name an argument
//! that is not there.
//!
//! The second is turning a pointer into that number. A ruler, the way a real
//! modeller does it: the pad's distance is how far along the profile's normal
//! the cursor has travelled, in millimetres, in the model's own space - not
//! pixels, not a made-up sensitivity. Drag away from the face and the number
//! is the distance you dragged. That only works if the axis is the RIGHT axis,
//! which is why every feature here says where its ruler is anchored and which
//! way it runs, in terms of the inputs it was given.
//!
//! Nothing in this file knows about three.js, the DOM or the kernel. It is
//! arithmetic and a table, so both can be checked without a browser.

/* --------------------------------------------------------------- geometry */

const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vMul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];
const vLen = a => Math.hypot(a[0], a[1], a[2]);
export const vUnit = a => { const n = vLen(a); return n > 1e-12 ? vMul(a, 1 / n) : null; };

//! How far along an axis the point on it nearest a ray lies. The classic
//! closest-approach of two skew lines, and the whole of a ruler drag: the
//! answer is in the model's units, so a pad dragged out by forty millimetres
//! is forty millimetres whatever the zoom.
//!
//! Zero when the ray is along the axis, because then every point on it is as
//! near as every other and any answer would be invented.
export function rulerAt(from, way, at, dir) {
  // Along a UNIT direction, so the answer is a distance rather than a count of
  // however long the vector happened to be. A ruler that read 4.4 because the
  // direction it was handed was nine long would be a ruler nobody could use.
  const along = vUnit(dir);
  if (!along) return 0;
  const w = vSub(at, from);
  const a = vDot(along, along), b = vDot(along, way), c = vDot(way, way);
  const d = vDot(along, w), e = vDot(way, w);
  const bottom = a * c - b * b;
  if (Math.abs(bottom) < 1e-9) return 0;
  return (b * e - c * d) / bottom;
}

//! Where a ray meets a plane, or null when it runs along it.
export function onPlane(from, way, at, normal) {
  const facing = vDot(way, normal);
  if (Math.abs(facing) < 1e-9) return null;
  return vAdd(from, vMul(way, vDot(vSub(at, from), normal) / facing));
}

//! The place on a polyline nearest a ray: where it is, how far along the whole
//! run it is as a fraction, and how far the ray passed from it.
//!
//! \p edges is the line soup the viewport is already drawing - pairs of points,
//! in order along the curve. The fraction is by LENGTH rather than by the
//! curve's own parameter, which is the same thing on a line and close on
//! anything smooth; the kernel recomputes from the number, so what is seen is
//! always the truth and the drag only has to get near.
export function nearestOnEdges(edges, from, way) {
  if (!edges || edges.length < 6) return null;
  const point = i => [edges[i * 3], edges[i * 3 + 1], edges[i * 3 + 2]];
  const count = Math.floor(edges.length / 3);
  let total = 0;
  const runs = [];
  for (let i = 0; i + 1 < count; i += 2) {
    const a = point(i), b = point(i + 1);
    const span = vLen(vSub(b, a));
    runs.push({ a, b, span, before: total });
    total += span;
  }
  if (!runs.length || total < 1e-9) return null;

  let best = null;
  for (const run of runs) {
    const along = vSub(run.b, run.a);
    // The nearest point of the SEGMENT to the ray, which is the nearest point
    // of its infinite line clamped to the ends - a curve has ends, and a drag
    // past the last one belongs at the last one.
    let t = rulerAt(from, way, run.a, along) / Math.max(1e-12, run.span);
    t = Math.max(0, Math.min(1, t));
    const here = vAdd(run.a, vMul(along, t));
    // How near the ray came, measured across it rather than along it.
    const off = vSub(here, from);
    const gap = vLen(vSub(off, vMul(way, vDot(off, way) / Math.max(1e-12, vDot(way, way)))));
    if (!best || gap < best.gap)
      best = { at: here, gap, t: (run.before + run.span * t) / total };
  }
  return best;
}

//! The middle of a run of points, by its extents - where a ruler is anchored
//! when nothing more particular says where.
export function middleOf(positions) {
  if (!positions || positions.length < 3) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3)
    for (let a = 0; a < 3; a++) {
      if (positions[i + a] < lo[a]) lo[a] = positions[i + a];
      if (positions[i + a] > hi[a]) hi[a] = positions[i + a];
    }
  return Number.isFinite(lo[0]) ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2,
                                   (lo[2] + hi[2]) / 2] : null;
}

//! Which way a drawn surface faces, weighted by area so the big flat part of a
//! thing decides and a chamfer does not. This is how a plane datum and a
//! sketch's face say which way "out" is without anybody asking the kernel.
export function faceWay(positions, index) {
  if (!positions || !index || index.length < 3) return null;
  const sum = [0, 0, 0];
  const at = i => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = at(index[t]), b = at(index[t + 1]), c = at(index[t + 2]);
    const n = vCross(vSub(b, a), vSub(c, a));
    sum[0] += n[0] / 2; sum[1] += n[1] / 2; sum[2] += n[2] / 2;
  }
  return vUnit(sum);
}

//! Which way a drawn curve runs: end to end, which is the direction of a line
//! and a fair reading of anything straighter than it is curved.
export function lineWay(edges) {
  if (!edges || edges.length < 6) return null;
  const first = [edges[0], edges[1], edges[2]];
  const last = [edges[edges.length - 3], edges[edges.length - 2], edges[edges.length - 1]];
  return vUnit(vSub(last, first));
}

/* ----------------------------------------------------------- what to edit */

//! The number each feature is about, and how a hand sets it.
//!
//! `drag` says what the pointer means:
//!   axis    a ruler along a direction - millimetres of pointer are millimetres
//!   radius  how far from a middle, across the screen
//!   curve   where along a curve, as a fraction of it
//!   place   where in space, which writes three numbers rather than one
//!   (none)  a slider and a number box, because there is nothing to drag
//!           against - an angle on a draft, a count, a factor.
//!
//! `when` narrows a row to one setting of a node that has several, because a
//! point by coordinates and a point along a curve are not edited the same way
//! at all. Which setting is named, not assumed: a point's is called `kind`, a
//! pad's is called `limit` and an array's is called `mode`, and guessing would
//! be a row that quietly never matches.
export const LEADS = {
  Fillet: [{ key: "radius", drag: "radius" }],
  Extrude: [{ key: "distance", when: { key: "limit", is: 0 }, drag: "axis" }],
  Cube: [{ key: "dz", drag: "axis" }],
  Sphere: [{ key: "radius", drag: "radius" }],
  Circle: [{ key: "radius", drag: "radius" }],
  Line: [{ key: "length", when: { key: "limit", is: 0 }, drag: "axis" }],
  Plane: [{ key: "offset", when: { key: "kind", is: 2 }, drag: "axis" },
          { key: "at", when: { key: "kind", is: 1 }, drag: "curve" },
          { key: "angle", when: { key: "kind", is: 4 } }],
  Point: [{ keys: ["x", "y", "z"], when: { key: "kind", is: 0 }, drag: "place" },
          { key: "at", when: { key: "kind", is: 1 }, drag: "curve" }],
  Move: [{ key: "distance", when: { key: "kind", is: 0 }, drag: "axis" }],
  ThickSurface: [{ key: "thickness", drag: "radius" }],
  ParallelCurve: [{ key: "distance", drag: "radius" }],
  MeshDisplace: [{ key: "amount", drag: "radius" }],
  Draft: [{ key: "angle" }],
  Rotate: [{ key: "end" }],
  Scale: [{ key: "factor" }],
  Subdivide: [{ key: "levels" }],
  DivideCurve: [{ key: "count" }],
  Array: [{ key: "countX", when: { key: "mode", is: 0 } },
          { key: "count", when: { key: "mode", is: 1 } }],
};

//! Where a feature's ruler is anchored and which way it runs, named by the
//! inputs the feature was given. Each list is tried in order and the first one
//! that is actually wired and actually drawn wins; an empty answer falls back
//! to the feature's own geometry, which is always there.
export const RULERS = {
  Extrude: { dir: ["direction", "profile"], at: ["profile"] },
  Cube: { dir: ["plane"], at: ["origin"] },
  Line: { dir: ["direction"], at: ["origin"] },
  Plane: { dir: ["from"], at: ["from"] },
  Move: { dir: ["direction"], at: ["shape"] },
  Sphere: { at: ["center"] },
  Circle: { at: ["plane"] },
  Fillet: { at: ["body"] },
  ThickSurface: { at: ["surface"] },
  ParallelCurve: { at: ["curve"] },
  MeshDisplace: { at: ["mesh"] },
};

//! The lead argument of a feature as it stands, with everything needed to put
//! a slider on the screen - or null when this feature has no one number, which
//! is a perfectly ordinary thing for a feature to be.
export function leadFor(entry, spec) {
  if (!entry || !spec) return null;
  const rows = LEADS[entry.type];
  if (!rows) return null;
  const values = entry.values || {};
  for (const row of rows) {
    if (row.when && (values[row.when.key] || 0) !== row.when.is) continue;
    if (row.keys) {
      const args = row.keys.map(key => (spec.args || []).find(a => a.key === key));
      if (args.some(a => !a || a.kind !== "real")) continue;
      return { keys: row.keys, drag: row.drag, label: entry.name,
               unit: args[0].unit, step: args[0].step,
               values: row.keys.map(key => values[key]) };
    }
    const arg = (spec.args || []).find(a => a.key === row.key && a.kind === "real");
    if (!arg) continue;
    return { key: row.key, drag: row.drag, label: arg.label,
             unit: arg.unit, step: arg.step, min: arg.min, max: arg.max,
             value: values[row.key] };
  }
  return null;
}
