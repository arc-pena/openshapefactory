// The blend curve and the fill surface, measured against their constraints.
//
// The point of both is that they OBEY something. A blend curve told to leave a
// point heading along Y either leaves heading along Y or it does not, and the
// way to find out is to read the direction of the first millimetre of it. A
// fill surface told to meet a plane tangentially either does or does not, and
// the kernel is asked how badly it missed rather than asked whether it is
// happy - MakeFilling reports the worst gap, the worst angle and the worst
// curvature it left behind, which for this kind of work is the whole answer.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { readFileSync } from "fs";

const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const init = (await import(DIR + "/replicad_single.js")).default;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const kernel = await createWasmKernel({ initModule: init,
                                        wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                      select: () => {}, selected: () => null });
const run = async edits => { for (const edit of edits) await mdl.run(edit); };
const of = async id => {
  const answer = await kernel.tree();
  return ((answer.tree || answer).features || []).find(f => f.id === id);
};
let counted = 0;
const measure = async (id, quantity) => {
  const m = "MM" + (++counted);
  await run([{ op: "add", type: "Measure", id: m, name: m, refs: { shape: id } },
             { op: "set", id: m, key: "quantity", value: quantity }]);
  const got = await of(m);
  if (!got || got.error) return NaN;
  return Number((((got.data || {}).preview) || "").match(/[-\d.]+/));
};
//! Which way a curve leaves its first point, read off the shape itself - the
//! direction from the start to a point a whisker along it.
const leavesAlong = async id => {
  const a = "EV" + (++counted), b = "EV" + (++counted);
  for (const [node, t] of [[a, 0], [b, 0.004]])
    await run([{ op: "add", type: "EvaluateCurve", id: node, name: node, refs: { curve: id } },
               { op: "set", id: node, key: "t", value: t }]);
  const read = async node => {
    const got = await of(node);
    const said = (((got || {}).data || {}).preview || "").match(/\(([^)]*)\)/);
    return said ? said[1].split(",").map(Number) : null;
  };
  const p0 = await read(a), p1 = await read(b);
  if (!p0 || !p1) return null;
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const n = Math.hypot(...d);
  return n > 1e-9 ? d.map(v => v / n) : null;
};

await mdl.run({ op: "model", model: { format: "ocaf-parametric-model",
  version: 1, name: "Blends", units: "mm", features: [] } });
await run([
  { op: "add", type: "Point", id: "P0", name: "Origin" },
  { op: "add", type: "Vector", id: "VZ", name: "Z" },
  { op: "set", id: "VZ", key: "dz", value: 1 },
  { op: "add", type: "Plane", id: "PL", name: "XY", refs: { origin: "P0", normal: "VZ" } },
  { op: "add", type: "Point", id: "PA", name: "A" },
  { op: "set", id: "PA", key: "x", value: 0 },
  { op: "add", type: "Point", id: "PB", name: "B" },
  { op: "set", id: "PB", key: "x", value: 100 },
  { op: "set", id: "PB", key: "y", value: 100 },
  { op: "add", type: "Point", id: "PC", name: "C" },
  { op: "set", id: "PC", key: "x", value: 200 },
  { op: "add", type: "Vector", id: "VY", name: "Y" },
  { op: "set", id: "VY", key: "dx", value: 0 },
  { op: "set", id: "VY", key: "dy", value: 1 },
  { op: "set", id: "VY", key: "dz", value: 0 },
]);

console.log("1. a blend curve with nothing said about it is a spline");
await run([
  { op: "add", type: "BlendCurve", id: "BL", name: "Through three",
    refs: { points: "PA" } },
  { op: "connect", id: "BL", key: "points", from: "PB" },
  { op: "connect", id: "BL", key: "points", from: "PC" },
]);
{
  const b = await of("BL");
  check("it built", !b.error, b.error);
  check("and says nothing was constrained",
        /no directions given/.test(b.note || ""), b.note);
  // Three points at (0,0), (100,100), (200,0): it has to be longer than the
  // two chords, because it bulges, and not absurdly longer.
  const chord = 2 * Math.hypot(100, 100);
  const length = await measure("BL", 0);
  check("it is longer than the chords and not by much",
        length > chord && length < chord * 1.2,
        length + " against chords of " + chord.toFixed(2));
}

console.log("\n2. told which way to leave, it leaves that way");
// Sampled finely, because the curve travels as a run of segments and the
// FIRST of those segments is a chord across a slice of the span - at
// twenty-four steps it has already begun to turn towards the next point, so
// reading the direction off it would be reading the chord, not the tangent.
await run([{ op: "connect", id: "BL", key: "tangents", from: "VY" },
           { op: "set", id: "BL", key: "steps", value: 200 }]);
{
  const b = await of("BL");
  check("it built with a direction given",
        !b.error && /1 with a direction given/.test(b.note || ""), b.error || b.note);
  const way = await leavesAlong("BL");
  // Measured as a secant over the first half per cent of the curve, so a
  // little of the bend that follows is already in it - the check is that it
  // leaves along Y, not that it is a straight line.
  check("and the first of it runs along Y",
        way && Math.abs(way[0]) < 0.06 && near(way[1], 1, 0.06),
        JSON.stringify(way));
}

console.log("\n3. tension changes how far it holds that direction");
{
  const tight = await measure("BL", 0);
  await run([{ op: "set", id: "BL", key: "tension", value: 4 }]);
  const loose = await measure("BL", 0);
  check("more tension makes a longer curve", loose > tight,
        tight + " -> " + loose);
  const way = await leavesAlong("BL");
  check("and it still leaves along Y", way && near(way[1], 1, 0.02), JSON.stringify(way));
  await run([{ op: "code", id: "BL", key: "tensions", text: "0.2" }]);
  const typed = await measure("BL", 0);
  check("a tension typed for one point overrides the one for all of them",
        typed < loose, loose + " -> " + typed);
  await run([{ op: "set", id: "BL", key: "tension", value: 1 },
             { op: "code", id: "BL", key: "tensions", text: "" }]);
}

console.log("\n4. a direction wired in backwards");
{
  await run([{ op: "set", id: "VY", key: "dy", value: -1 }]);
  const kind = await leavesAlong("BL");
  check("honoured exactly, it turns round and goes the way it was told",
        kind && near(kind[1], -1, 0.02), JSON.stringify(kind));
  await run([{ op: "set", id: "BL", key: "honour", value: 1 }]);
  const gentle = await leavesAlong("BL");
  check("as a suggestion, it is turned to run the way the curve is going",
        gentle && near(gentle[1], 1, 0.02), JSON.stringify(gentle));
  await run([{ op: "set", id: "VY", key: "dy", value: 1 },
             { op: "set", id: "BL", key: "honour", value: 0 }]);
}

console.log("\n5. a fill surface through a boundary");
await run([
  { op: "add", type: "Rectangle", id: "R1", name: "Frame", refs: { plane: "PL" } },
  { op: "set", id: "R1", key: "width", value: 200 },
  { op: "set", id: "R1", key: "height", value: 200 },
  { op: "add", type: "FillSurface", id: "FS", name: "Patch", refs: { boundary: "R1" } },
]);
{
  const s = await of("FS");
  check("it built", !s.error, s.error);
  check("and it took four edges", /4 edges/.test(s.note || ""), s.note);
  check("with nothing held tangent", /0 held tangent/.test(s.note || ""), s.note);
  // A flat 200 by 200 boundary fills to 40,000 square millimetres and nothing
  // else, because there is nowhere else for the surface to go.
  check("a flat square boundary fills to its own area",
        near(await measure("FS", 1), 40000, 40),
        "" + (await measure("FS", 1)));
  check("and it closed to within the tolerance it was given",
        /gap 0(\.0*)? mm/.test(s.note || "") || /gap 0\.0/.test(s.note || ""), s.note);
}

console.log("\n6. and made to pass through a point");
await run([
  { op: "add", type: "Point", id: "UP", name: "Lift" },
  { op: "set", id: "UP", key: "x", value: 0 },
  { op: "set", id: "UP", key: "y", value: 0 },
  { op: "set", id: "UP", key: "z", value: 40 },
  { op: "connect", id: "FS", key: "through", from: "UP" },
]);
{
  const s = await of("FS");
  check("it built", !s.error, s.error);
  // NOT "it was asked to", but "it got there". The note carries the measured
  // miss, because a point constraint is a request the solver weighs against
  // the boundary and the smoothness - and a patch that sails past the point
  // used to report exactly the same sentence as one that hit it.
  check("and says how near it got to the point",
        /1 point to pass through, the furthest missed by/.test(s.note || ""), s.note);
  const off = Number((String(s.note).match(/missed by ([\d.]+) mm/) || [])[1]);
  check("and it got there, to the tolerance it was given",
        Number.isFinite(off) && off <= 0.01, off + " mm");
  // Pulled 40 up in the middle, the patch has to have more area than the flat
  // one it was - a surface that ignored the point would still measure 40,000.
  const area = await measure("FS", 1);
  check("and the surface really moved to reach it", area > 40400,
        area + " against the flat 40000");
  // It reaches the point, and then some: a minimum-energy surface pulled up
  // by one point in the middle overshoots it a little on the way, which is
  // what a sheet does. So the check is that it got there, not that it stopped
  // there.
  const tall = await measure("FS", 5);
  check("it reached the point it was told to pass through",
        tall >= 40 - 0.01 && tall < 60, tall + " tall, for a point 40 up");
}

console.log("\n7. and made to meet a surface tangentially");
// The boundary lies on the XY plane, so the plane is a surface the patch can
// be held tangent to: held that way it has to LEAVE the boundary flat and
// climb to the point afterwards, which is a longer way round and therefore
// more surface. That difference is the whole of what the constraint does, and
// it is a number rather than a look.
await run([
  { op: "add", type: "FillSurface", id: "FT", name: "Tangent patch",
    refs: { boundary: "R1", supports: "PL", through: "UP" } },
  { op: "set", id: "FT", key: "continuity", value: 1 },
]);
{
  const s = await of("FT");
  check("it built", !s.error, s.error);
  check("and it held every edge tangent to the plane",
        /4 held tangent/.test(s.note || ""), s.note);
  check("and reports the tangency it managed, as an angle",
        /tangency [-\d.]+°/.test(s.note || ""), s.note);
  // Tangent to within a degree is what "tangent" means for this kind of work;
  // anything else and the node is claiming something it did not do.
  const off = Number((String(s.note).match(/tangency ([-\d.]+)°/) || [])[1]);
  check("and it is tangent to within a degree", Number.isFinite(off) && Math.abs(off) < 1,
        off + "°");
  // And without the constraint there is no tangency figure at all, because
  // nothing was being held to one - the note says what was asked for rather
  // than reporting a number about a constraint that was never set.
  check("and the same patch with nothing held reports no tangency",
        !/tangency/.test(((await of("FS")) || {}).note || ""),
        ((await of("FS")) || {}).note);
  await run([{ op: "code", id: "FT", key: "each", text: "G0" }]);
  check("and a per-curve override is read back",
        /0 held tangent/.test(((await of("FT")) || {}).note || ""),
        ((await of("FT")) || {}).note);
  await run([{ op: "code", id: "FT", key: "each", text: "" }]);
}

console.log("\n7b. a tangency that will not take is said, not swallowed");
await run([
  { op: "add", type: "Cube", id: "CB", name: "Block", refs: { origin: "P0", plane: "PL" } },
  { op: "set", id: "CB", key: "dx", value: 200 },
  { op: "set", id: "CB", key: "dy", value: 200 },
  { op: "set", id: "CB", key: "dz", value: 60 },
  { op: "add", type: "FillSurface", id: "FX", name: "Against a block",
    refs: { boundary: "R1", supports: "CB" } },
  { op: "set", id: "FX", key: "continuity", value: 1 },
]);
{
  const s = await of("FX");
  check("it still builds a surface", !s.error, s.error);
  check("and says the constraint was dropped, and why",
        /would not take the constraint|would not build on this boundary/.test(s.note || ""),
        s.note);
}

console.log("\n8. a boundary that is not one is refused in words");
await run([
  { op: "add", type: "FillSurface", id: "FB", name: "Nothing to fill" },
]);
{
  const s = await of("FB");
  check("with no boundary at all it says so",
        /wire in the curves/.test(s.error || ""), s.error || "no error at all");
}

console.log("\n8. a boundary that does not close is refused, and says where");
// A SURFACE IS FILLED INSIDE A LOOP. Handed a chain with a gap in it,
// MakeFilling does not refuse - it solves an under-determined problem and
// hands back a sheet that sprawls outside the curves it was given, which is
// exactly what a broken fill looks like from the outside. So the loop is
// checked here, where the gap can be measured and named.
await run([
  { op: "add", type: "Point", id: "GA", name: "A" },
  { op: "set", id: "GA", key: "x", value: 0 },
  { op: "add", type: "Point", id: "GB", name: "B" },
  { op: "set", id: "GB", key: "x", value: 200 },
  { op: "add", type: "Point", id: "GC", name: "C" },
  { op: "set", id: "GC", key: "x", value: 200 },
  { op: "set", id: "GC", key: "y", value: 200 },
  { op: "add", type: "Point", id: "GD", name: "D" },
  { op: "set", id: "GD", key: "x", value: 0 },
  { op: "set", id: "GD", key: "y", value: 200 },   // three sides of a square:
                                                  // A and D are 200 mm apart
  { op: "add", type: "Polyline", id: "GPL", name: "Three sides", refs: { points: "GA" } },
  { op: "connect", id: "GPL", key: "points", from: "GB" },
  { op: "connect", id: "GPL", key: "points", from: "GC" },
  { op: "connect", id: "GPL", key: "points", from: "GD" },
  { op: "add", type: "FillSurface", id: "GFI", name: "Open", refs: { boundary: "GPL" } },
]);
{
  const g = await of("GFI");
  check("it is refused rather than filled", !!g.error, g.note || "no error at all");
  check("and it says the boundary does not close",
        /does not close/.test(g.error || ""), g.error);
  check("and how big the gap is, to the millimetre",
        /200 mm apart/.test(g.error || ""), g.error);
  check("and which curves the loose ends belong to",
        /Three sides/.test(g.error || ""), g.error);
  // Closed up, the same boundary fills.
  await run([{ op: "connect", id: "GPL", key: "points", from: "GA" }]);
  const shut = await of("GFI");
  check("and closed up it fills", !shut.error, shut.error);
  check("to its own area, and nothing outside it",
        near(await measure("GFI", 1), 200 * 200, 200),
        "" + (await measure("GFI", 1)));
}

console.log("\n9. a section that becomes another one along the rail");
// The third kind of pipe surface the documentation lists, and the one a
// constant section cannot fake. A circle of radius 60 swept 1000 along Z into
// a circle of radius 20 is a truncated cone: pi h (R^2 + Rr + r^2) / 3, which
// is a number that can be written down before the kernel is asked.
await run([
  { op: "add", type: "Point", id: "TOP", name: "Top" },
  { op: "set", id: "TOP", key: "z", value: 1000 },
  { op: "add", type: "Plane", id: "PT2", name: "High", refs: { origin: "TOP", normal: "VZ" } },
  { op: "add", type: "Circle", id: "BIG", name: "Foot", refs: { plane: "PL" } },
  { op: "set", id: "BIG", key: "radius", value: 60 },
  { op: "add", type: "Circle", id: "SMALL", name: "Head", refs: { plane: "PT2" } },
  { op: "set", id: "SMALL", key: "radius", value: 20 },
  { op: "add", type: "Polyline", id: "RAIL", name: "Rail", refs: { points: "P0" } },
  { op: "connect", id: "RAIL", key: "points", from: "TOP" },
  { op: "add", type: "Sweep", id: "SW", name: "Taper",
    refs: { profile: "BIG", spine: "RAIL" } },
  { op: "connect", id: "SW", key: "into", from: "SMALL" },
]);
{
  const w = await of("SW");
  check("it built", !w.error, w.error);
  check("and says the section becomes the other one",
        /becomes Head/.test(w.note || ""), w.note);
  const want = Math.PI * 1000 * (60 * 60 + 60 * 20 + 20 * 20) / 3;
  const got = await measure("SW", 2);
  check("and it is a truncated cone: pi h (R^2 + Rr + r^2) over 3",
        near(got, want, want * 0.005), got + " wanted " + want.toFixed(0));
}

console.log("\n10. a real file that went wrong, and what closing it up does now");
// The model that started this. Its boundary is four curves - two sketches and
// two blend curves - but one of the blends is wired to the tip of a tangent
// ray rather than to the end of the sketch, so the loop has a 500 mm hole in
// it, and it used to come back as a surface with no complaint attached.
//
// It also used to be unfillable even CLOSED, and that has changed: the
// boundary was 132 tessellated edges, because a sketched spline and a blend
// curve were each handed on as the run of segments they had been sampled as,
// and a filling with a fixed number of pieces cannot span that many. Fitted
// back to one B-spline edge apiece it is EIGHT edges, and the same filling
// solves it. So what is checked here is that it builds, and that it is still
// honest about how far it missed the point it was told to pass through.
{
  const kernel2 = await createWasmKernel({ initModule: init,
    wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
  const mdl2 = new Mdl({ kernel: kernel2, setNode: () => {}, readLayout: () => ({}),
                         select: () => {}, selected: () => null });
  await mdl2.run({ op: "model", model: JSON.parse(readFileSync(
    new URL("./files/fillsurface.json", import.meta.url), "utf8")) });
  const read = async id => {
    const answer = await kernel2.tree();
    return ((answer.tree || answer).features || []).find(f => f.id === id);
  };
  const open = await read("FI2");
  check("as it came in, the open loop is refused",
        !!open.error && /does not close/.test(open.error), open.error || open.note);
  check("and the 500 mm hole is measured and placed",
        /500 mm apart/.test(open.error || ""), open.error);

  // Close it the way the model meant, and the other reason surfaces.
  await mdl2.runAll([{ op: "disconnect", id: "BL2", key: "points", from: "TP4" },
                     { op: "connect", id: "BL2", key: "points", from: "PO4" },
                     { op: "set", id: "FI2", key: "tolerance", value: 0.01 }]);
  const shut = await read("FI2");
  check("closed up, it fills", !shut.error, shut.error || shut.note);
  check("off eight edges, not a hundred and thirty-two",
        /^8 edges/.test(shut.note || ""), shut.note);
  check("and it still says how far it missed the point it was aimed at",
        /point to pass through, the furthest missed by/.test(shut.note || ""), shut.note);

  // A loft through the same two sketches, as a second reading of the same
  // boundary: it lands on the boundary's own reach, which is what says the
  // fill above is looking at the shape somebody drew.
  await mdl2.runAll([
    { op: "add", type: "Loft", id: "LO", name: "Between the rails", refs: { sections: "SK1" } },
    { op: "connect", id: "LO", key: "sections", from: "SK2" },
    { op: "set", id: "LO", key: "cap", value: 1 },
    { op: "add", type: "Measure", id: "LZ", name: "How tall", refs: { shape: "LO" } },
    { op: "set", id: "LZ", key: "quantity", value: 5 }]);
  const loft = await read("LO");
  check("the loft through them builds", !loft.error, loft.error);
  const tall = Number(((((await read("LZ")) || {}).data || {}).preview || "").match(/[\d.]+/));
  check("and it is the boundary's own height, not tens of metres",
        near(tall, 670, 1), tall + " mm tall, boundary is 670");
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
