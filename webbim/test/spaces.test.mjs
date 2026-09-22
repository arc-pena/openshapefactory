// Expected values below were derived by hand before running the code; each
// case says how.
import test from "node:test";
import assert from "node:assert/strict";
import { findLoops, claimLoops, filterWallFaces, interiorPoint } from "../src/spaces.js";

const rect = (x0, y0, x1, y1) => [
  [[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]],
];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b}, got ${a}`);
const areas = loops => loops.map(l => l.area).sort((a, b) => a - b);

test("single 6000x4000 rectangle -> one loop, 24e6", () => {
  // 6000 * 4000 = 24,000,000; 4 vertices, 4 edges; the CCW face is the only positive one.
  const r = findLoops(rect(0, 0, 6000, 4000));
  assert.equal(r.loops.length, 1);
  near(r.loops[0].area, 24e6, 1e-6);
  near(r.loops[0].net, 24e6, 1e-6);
  assert.equal(r.loops[0].holes.length, 0);
  assert.deepEqual(r.stats, { vertices: 4, edges: 4 });
  // Bounded face returned CCW.
  const p = r.loops[0].pts; let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  assert.ok(s > 0);
  // The unbounded face is reported with negative signed area.
  assert.ok(r.faces.some(f => Math.abs(f.area + 24e6) < 1e-6));
});

test("wall-outline style: two concentric rectangles", () => {
  // outer (-150,-150)-(6150,4150): 6300*4300 = 27,090,000
  // inner (150,150)-(5850,3850):   5700*3700 = 21,090,000
  // ring face = outer with inner as hole, net = 27.09e6 - 21.09e6 = 6.0e6
  const r = findLoops([...rect(-150, -150, 6150, 4150), ...rect(150, 150, 5850, 3850)]);
  assert.equal(r.loops.length, 2);
  const outer = r.loops.find(l => Math.abs(l.area - 27.09e6) < 1);
  const inner = r.loops.find(l => Math.abs(l.area - 21.09e6) < 1);
  assert.ok(outer && inner);
  assert.equal(outer.holes.length, 1);
  near(outer.net, 6.0e6, 1e-6);
  assert.equal(inner.holes.length, 0);
  near(inner.net, 21.09e6, 1e-6);
  // Ring predicate: inside outer and not inside inner.
  const inRing = p => p[0] > -150 && p[0] < 6150 && p[1] > -150 && p[1] < 4150 &&
    !(p[0] > 150 && p[0] < 5850 && p[1] > 150 && p[1] < 3850);
  // interiorPoint of the ring: middle scanline y=2000 crosses at x=-150,150,5850,6150;
  // widest interval is the first 300-wide one -> (0, 2000).
  const ip = interiorPoint(outer.pts, outer.holes);
  near(ip[0], 0, 1e-9); near(ip[1], 2000, 1e-9);
  const kept = filterWallFaces(r.loops, inRing);
  assert.equal(kept.length, 1);
  near(kept[0].area, 21.09e6, 1e-6);
});

test("two rooms sharing a wall, with 300 mm dangling overshoots", () => {
  // Split x=2500 from y=-300 to y=4300. Left 2500*4000 = 10e6, right 3500*4000 = 14e6.
  // After pruning: vertices (0,0),(2500,0),(6000,0),(6000,4000),(2500,4000),(0,4000) = 6;
  // edges: bottom 2 + top 2 + left + right + middle = 7 (the two 300 mm stubs gone).
  const r = findLoops([...rect(0, 0, 6000, 4000), [[2500, -300], [2500, 4300]]]);
  assert.deepEqual(areas(r.loops), [10e6, 14e6]);
  assert.deepEqual(r.stats, { vertices: 6, edges: 7 });
});

test("T-junction with no vertex on the long segment", () => {
  // Bottom and top are single 6000-long segments; the stem x=2500 touches both
  // at their interiors. The lower end stops 0.3 mm short (within tol 0.5).
  // Expected: 10e6 and 14e6 (within ~0.3*2500 mm² for the short end).
  const r = findLoops([...rect(0, 0, 6000, 4000), [[2500, 0.3], [2500, 4000]]]);
  const a = areas(r.loops);
  assert.equal(a.length, 2);
  near(a[0], 10e6, 2000); near(a[1], 14e6, 2000);
  assert.deepEqual(r.stats, { vertices: 6, edges: 7 });
});

test("collinear overlapping segments merge, no duplicate edge", () => {
  // Bottom drawn as [0,4000] and [2000,6000]: split at 2000 and 4000; the
  // 2000..4000 piece appears twice and must be deduped.
  // Vertices: (0,0),(2000,0),(4000,0),(6000,0),(6000,4000),(0,4000) = 6; edges = 6.
  const segs = [[[0, 0], [4000, 0]], [[2000, 0], [6000, 0]],
    [[6000, 0], [6000, 4000]], [[6000, 4000], [0, 4000]], [[0, 4000], [0, 0]]];
  const r = findLoops(segs);
  assert.equal(r.loops.length, 1);
  near(r.loops[0].area, 24e6, 1e-6);
  assert.deepEqual(r.stats, { vertices: 6, edges: 6 });
  assert.equal(r.loops[0].pts.length, 6);
});

test("weld tolerance: 0.2 mm miss closes, 5 mm gap does not", () => {
  // Corners miss by <= 0.28 mm, all under tol 0.5; area ~ 24e6 (error ~ 0.2*6000 = 1200 mm²).
  const nearMiss = [[[0, 0], [6000, 0]], [[6000.2, 0], [6000, 4000]],
    [[6000, 4000.2], [0, 4000]], [[0.1, 4000.1], [0, 0.2]]];
  const r1 = findLoops(nearMiss);
  assert.equal(r1.loops.length, 1);
  near(r1.loops[0].area, 24e6, 2000);
  // Bottom stops at x=5995: its end is 5 mm from the right side -> dangling -> all pruned.
  const gap = [[[0, 0], [5995, 0]], [[6000, 0], [6000, 4000]], [[6000, 4000], [0, 4000]], [[0, 4000], [0, 0]]];
  const r2 = findLoops(gap);
  assert.equal(r2.loops.length, 0);
  assert.deepEqual(r2.stats, { vertices: 0, edges: 0 });
  // Same gap with tol 6 closes: (5995,0) welds to (6000,0) at the centroid (5997.5,0);
  // area = trapezoid-ish, 24e6 - 2.5*4000/2 = 23,995,000.
  const r3 = findLoops(gap, { tol: 6 });
  assert.equal(r3.loops.length, 1);
  near(r3.loops[0].area, 23995000, 1e-3);
});

test("nested: core loop inside a floor plate", () => {
  // plate 20000*10000 = 200e6, core 4000*4000 = 16e6 at (8000,3000)-(12000,7000).
  // plate net = 200e6 - 16e6 = 184e6.
  const r = findLoops([...rect(0, 0, 20000, 10000), ...rect(8000, 3000, 12000, 7000)]);
  assert.equal(r.loops.length, 2);
  const plate = r.loops.find(l => Math.abs(l.area - 200e6) < 1);
  const core = r.loops.find(l => Math.abs(l.area - 16e6) < 1);
  assert.ok(plate && core);
  near(plate.net, 184e6, 1e-6);
  assert.equal(plate.holes.length, 1);
  near(core.net, 16e6, 1e-6);
  // Middle scanline y=5000 crosses 0,8000,12000,20000 -> widest (tie, first) [0,8000] -> (4000,5000).
  assert.deepEqual(interiorPoint(plate.pts, plate.holes), [4000, 5000]);
  // Claims: anchor in core -> core (smallest containing), anchor beside it -> plate.
  const c = claimLoops(r.loops, [{ id: "core", anchor: [10000, 5000] }, { id: "office", anchor: [2000, 2000] }]);
  assert.equal(c.core.loop, core);
  assert.equal(c.office.loop, plate);
  assert.equal(c.core.status, "ok"); assert.equal(c.office.status, "ok");
});

test("claimLoops: ok, not enclosed, redundant", () => {
  const r = findLoops([...rect(0, 0, 6000, 4000), [[2500, -300], [2500, 4300]]]);
  const left = r.loops.find(l => Math.abs(l.area - 10e6) < 1);
  const right = r.loops.find(l => Math.abs(l.area - 14e6) < 1);
  const c = claimLoops(r.loops, [
    { id: "A", anchor: [1000, 2000] },
    { id: "B", anchor: [-1000, -1000] },
    { id: "C", anchor: [3000, 2000] },
    { id: "D", anchor: [5000, 1000] },
  ]);
  assert.deepEqual(c.A, { loop: left, status: "ok" });
  assert.deepEqual(c.B, { loop: null, status: "not enclosed" });
  assert.deepEqual(c.C, { loop: right, status: "ok" });
  assert.deepEqual(c.D, { loop: right, status: "redundant" });
});

test("rectangle rotated 30 degrees, with a rotated partition", () => {
  // Rotation preserves area: 24e6 overall, 10e6 + 14e6 when split at local x=2500.
  const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
  const R = p => [p[0] * c - p[1] * s + 1234.5, p[0] * s + p[1] * c - 777];
  const rotSegs = segs => segs.map(([p, q]) => [R(p), R(q)]);
  const r1 = findLoops(rotSegs(rect(0, 0, 6000, 4000)));
  assert.equal(r1.loops.length, 1);
  near(r1.loops[0].area, 24e6, 24e6 * 1e-3);
  const r2 = findLoops(rotSegs([...rect(0, 0, 6000, 4000), [[2500, -300], [2500, 4300]]]));
  const a2 = areas(r2.loops);
  assert.equal(a2.length, 2);
  near(a2[0], 10e6, 10e6 * 1e-3); near(a2[1], 14e6, 14e6 * 1e-3);
});

test("grid of rooms scales and every interior cell is found", () => {
  // 10x10 grid of 1000 mm cells drawn as 11 horizontal + 11 vertical full-length
  // lines: 100 loops of 1e6 each; vertices 121, edges 2*11*10 = 220.
  const segs = [];
  for (let i = 0; i <= 10; i++) { segs.push([[0, i * 1000], [10000, i * 1000]]); segs.push([[i * 1000, 0], [i * 1000, 10000]]); }
  const r = findLoops(segs);
  assert.equal(r.loops.length, 100);
  assert.ok(r.loops.every(l => Math.abs(l.area - 1e6) < 1e-6));
  assert.deepEqual(r.stats, { vertices: 121, edges: 220 });
});
