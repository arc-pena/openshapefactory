// The sketcher: a drawing in two dimensions, on a plane.
//
// What is being checked is the thing that makes a sketch a sketch: the drawing
// is written in the plane's coordinates and nowhere else, so moving the plane
// moves the drawing and nothing in the JSON changes. After that, that the
// loops it closes really are faces - measured, not assumed - and that a pad
// off a sketch is a solid with a volume you can predict on paper.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { EMPTY_SKETCH, SKETCH_CLICKS, SKETCH_TYPES, builtDrawing, currentLayer,
         elementLocked, isConstruction,
         elementShown, readSketch, shownDrawing, sketchBox, sketchDirectionAt, sketchCrossings,
         sketchDistanceTo, sketchElement, sketchEndKeys, sketchEnds, sketchExtent, sketchGrain,
         sketchInBox, sketchLayers, sketchLoops, sketchMoveElement, sketchOverlaps,
         sketchOnLayer, sketchRelation,
         sketchRelationMarks, sketchSummary, sketchTangentArc,
         solveSketch } from "../src/sketch.js";
import { Mdl } from "../src/mdl.js";
import { readFileSync } from "fs";

const WASM_DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const initModule = (await import(WASM_DIR + "/replicad_single.js")).default;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};

const kernel = await createWasmKernel({
  initModule, wasmBinary: readFileSync(WASM_DIR + "/replicad_single.wasm"),
});
const tree = async () => (await kernel.tree()).tree;
const at = async id => (await tree()).features.find(f => f.id === id);

const square = side => ({
  elements: [
    { id: "e1", type: "line", a: [0, 0], b: [side, 0] },
    { id: "e2", type: "line", a: [side, 0], b: [side, side] },
    { id: "e3", type: "line", a: [side, side], b: [0, side] },
    { id: "e4", type: "line", a: [0, side], b: [0, 0] },
  ],
  constraints: [],
});

console.log("1. the drawing on its own");
{
  const drawn = SKETCH_TYPES.map(type =>
    sketchElement(type, "x", [[0, 0], [40, 0], [40, 30], [10, 50]]
      .slice(0, Math.max(1, SKETCH_CLICKS[type] || 4))));
  check("every kind of element draws from clicks", drawn.length === SKETCH_TYPES.length);
  check("a square is one loop", sketchLoops(square(100)).loops.length === 1);
  const gappy = square(100);
  gappy.elements[1].a = [100, 0.02];
  check("a hand-drawn gap still reads as a loop", sketchLoops(gappy).loops.length === 1);
  check("nonsense in the file is dropped, not fatal",
    readSketch('{"elements":[{"id":"a","type":"line","a":[0,0],"b":[1,1]},{"type":"kite"}]}')
      .elements.length === 1);
  check("the summary says what is there", sketchSummary(square(100)) === "4 elements · 1 loop",
    sketchSummary(square(100)));
}

console.log("\n2. constraints");
{
  const slanted = {
    elements: [{ id: "e1", type: "line", a: [0, 0], b: [100, 7] }],
    constraints: [sketchRelation("horizontal", ["e1"])],
  };
  const solved = solveSketch(slanted, 24);
  const line = solved.drawing.elements[0];
  check("horizontal levels a line", Math.abs(line.a[1] - line.b[1]) < 1e-6,
    JSON.stringify([line.a, line.b]));
  check("and says how far off it finished", solved.residual < 1e-6, String(solved.residual));

  const corner = {
    elements: [{ id: "e1", type: "line", a: [0, 0], b: [100, 0] },
               { id: "e2", type: "line", a: [90, 20], b: [90, 90] }],
    constraints: [sketchRelation("coincident", ["e1.b", "e2.a"])],
  };
  const met = solveSketch(corner, 40).drawing;
  const gap = Math.hypot(met.elements[0].b[0] - met.elements[1].a[0],
                         met.elements[0].b[1] - met.elements[1].a[1]);
  check("coincident brings two ends together", gap < 1e-6, String(gap));
}

console.log("\n3. the sketch is a feature");
await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "Sketching",
                         units: "mm", features: [] });
let out = await kernel.addFeature("Sketch", {});
const sketchId = out.id;
check("an empty sketch says so rather than crashing",
  /empty/.test((await at(sketchId)).error || ""), (await at(sketchId)).error || "no error");

out = await kernel.setSketch(sketchId, "drawing", square(100));
check("drawing on it builds", !(await at(sketchId)).error, (await at(sketchId)).error);
{
  const entry = await at(sketchId);
  check("the tree publishes the drawing whole", entry.sketch.drawing.elements.length === 4);
  check("with a summary a node can print", entry.sketch.summary === "4 elements · 1 loop",
    entry.sketch.summary);
}
{
  const model = (await kernel.model());
  const stored = model.features.find(f => f.id === sketchId);
  check("the model file carries the drawing as JSON", stored.args.drawing.elements.length === 4);
  check("and only the drawing - no world coordinates",
    JSON.stringify(stored.args.drawing).indexOf("null") < 0);
}

console.log("\n4. closed loops become faces");
const up = (await kernel.addFeature("Vector", {})).id;
await kernel.setParameter(up, "dx", 0);
await kernel.setParameter(up, "dz", 1);
const pad = (await kernel.addFeature("Extrude", { profile: sketchId, direction: up })).id;
await kernel.setParameter(pad, "distance", 40);
check("a pad off the sketch builds", !(await at(pad)).error, (await at(pad)).error);
const gauge = (await kernel.addFeature("Measure", { shape: pad })).id;
await kernel.setParameter(gauge, "quantity", 2);
const volumeOf = async () => {
  const entry = await at(gauge);
  return entry && entry.data ? Number(entry.data.preview) : NaN;
};
check("and it is a solid of the volume the drawing says", Math.abs(await volumeOf() - 100 * 100 * 40) < 1,
  String(await volumeOf()));

// Solid or surface is the difference between a body and a skin, and the way
// to tell them apart is to measure them: a capped pad has its two ends, a
// swept wire has only the four walls.
const areaOf = async () => {
  await kernel.setParameter(gauge, "quantity", 1);
  const entry = await at(gauge);
  const area = entry && entry.data ? Number(entry.data.preview) : NaN;
  await kernel.setParameter(gauge, "quantity", 2);
  return area;
};
check("as a solid it has its two ends on it", Math.abs(await areaOf() - 36000) < 1,
  String(await areaOf()));
await kernel.setParameter(pad, "cap", 1);
check("on Surface it is the four walls and nothing else",
  Math.abs(await areaOf() - 16000) < 1, String(await areaOf()));
await kernel.setParameter(pad, "cap", 0);

console.log("\n5. two loops pad into two bodies");
{
  const twice = square(60);
  twice.elements.push({ id: "c1", type: "circle", c: [200, 30], r: 25 });
  await kernel.setSketch(sketchId, "drawing", twice);
  const both = await volumeOf();
  check("a circle and a square pad into both",
    Math.abs(both - (60 * 60 * 40 + Math.PI * 25 * 25 * 40)) < 200, String(both));
}

console.log("\n6. a loop inside a loop is a hole");
{
  const plate = square(200);
  plate.elements.push({ id: "h1", type: "circle", c: [50, 100], r: 18 },
                      { id: "h2", type: "circle", c: [150, 100], r: 18 });
  await kernel.setSketch(sketchId, "drawing", plate);
  const want = (200 * 200 - 2 * Math.PI * 18 * 18) * 40;
  check("two circles drawn inside a square are drilled, not padded",
    Math.abs(await volumeOf() - want) < 400, (await volumeOf()) + " vs " + want.toFixed(0));

  // Draw a third circle inside one of the holes: an island, solid again.
  plate.elements.push({ id: "i1", type: "circle", c: [50, 100], r: 8 });
  await kernel.setSketch(sketchId, "drawing", plate);
  const island = (200 * 200 - 2 * Math.PI * 18 * 18 + Math.PI * 8 * 8) * 40;
  check("and a loop inside a hole is solid again",
    Math.abs(await volumeOf() - island) < 400, (await volumeOf()) + " vs " + island.toFixed(0));
}

console.log("\n7. the plane moves the whole drawing");
{
  await kernel.setSketch(sketchId, "drawing", square(100));
  const before = (await kernel.mesh([pad])).features[0].positions;
  const json = JSON.stringify((await at(sketchId)).sketch.drawing);

  const origin = (await kernel.addFeature("Point", {})).id;
  const normal = (await kernel.addFeature("Vector", {})).id;
  await kernel.setParameter(normal, "dz", 0);
  await kernel.setParameter(normal, "dx", 1);
  const plane = (await kernel.addFeature("Plane", { origin, normal })).id;
  await kernel.setReference(sketchId, "plane", plane);

  const after = (await kernel.mesh([pad])).features[0].positions;
  check("the drawing does not change when the plane does",
    JSON.stringify((await at(sketchId)).sketch.drawing) === json);
  check("but the geometry does", before.length === after.length &&
    JSON.stringify(before) !== JSON.stringify(after));

  // The origin says WHERE ON THE PLANE the drawing's (0,0) is. Moved within
  // the plane it takes the drawing with it; moved along the normal it does
  // not, because the drawing is on the plane and a point off the plane is not
  // a reason for it to leave. The plane here is YZ, so y is across it and x is
  // straight off it.
  const moved = (await kernel.addFeature("Point", {})).id;
  await kernel.setParameter(moved, "y", 300);
  await kernel.setReference(sketchId, "origin", moved);
  const shifted = (await kernel.mesh([pad])).features[0].positions;
  check("and moving the origin across the plane moves the drawing with it",
    JSON.stringify(shifted) !== JSON.stringify(after));

  await kernel.setParameter(moved, "x", 300);
  const lifted = (await kernel.mesh([pad])).features[0].positions;
  check("but an origin off the plane does not take the drawing off it",
    JSON.stringify(lifted) === JSON.stringify(shifted));
  // And the frame the viewport draws through says the same thing: its origin
  // is ON the plane, whatever point it was handed.
  const frame = (await at(sketchId)).sketch.frame;
  check("with the frame still seated on the plane",
    Math.abs(frame.origin[0]) < 1e-6, JSON.stringify(frame.origin));
  await kernel.setParameter(moved, "x", 0);
}

console.log("\n8. arcs, ellipses, oblongs and splines all build");
{
  const menagerie = {
    elements: [
      { id: "a1", type: "arc", c: [0, 0], r: 50, a0: 0, a1: Math.PI },
      { id: "l1", type: "line", a: [-50, 0], b: [0, -50] },
      { id: "l2", type: "line", a: [0, -50], b: [50, 0] },
      { id: "el", type: "ellipse", c: [200, 0], rx: 60, ry: 30, rot: 0.4 },
      { id: "ob", type: "oblong", a: [400, 0], b: [500, 0], r: 25 },
      { id: "sp", type: "spline", pts: [[0, 200], [60, 260], [140, 180], [220, 240]], closed: false },
      { id: "pt", type: "point", p: [0, 400] },
    ],
    constraints: [],
  };
  await kernel.setSketch(sketchId, "drawing", menagerie);
  check("all seven kinds build together", !(await at(sketchId)).error,
    (await at(sketchId)).error);
  const entry = await at(sketchId);
  check("the point in it comes out as a point", entry.data && entry.data.kind === "point",
    JSON.stringify(entry.data || null));
}

console.log("\n9. a sketch is a node like any other");
{
  const file = (await kernel.model());
  const back = await kernel.loadModel(file);
  check("the model file reloads", back.report.failed.length === 0,
    JSON.stringify(back.report.failed.map(f => f.message)));
  const reloaded = (await tree()).features.find(f => f.type === "Sketch");
  check("with its drawing intact", reloaded.sketch.drawing.elements.length === 7,
    String(reloaded.sketch.drawing.elements.length));
}

console.log("\n10. an element the chain walks backwards is still itself");
{
  // The walker chains elements end to end whichever way round they were drawn,
  // so half of them get built in reverse. A line does not care. An arc very
  // much does: its sweep is a pair of angles that only ever increases, so
  // "reversed" cannot be written down as angles at all - and an attempt to
  // write it turned a quarter turn into a three-quarter turn the other way,
  // silently, in geometry that still looked plausible. Measure it.
  const backwards = {
    elements: [
      // Drawn so that the walk has to take the arc from its end to its start.
      { id: "run", type: "line", a: [-100, 10], b: [0, 10] },
      { id: "turn", type: "arc", c: [0, -30], r: 40, a0: 0, a1: Math.PI / 2 },
    ],
    constraints: [],
  };
  const walk = sketchLoops(backwards);
  check("the chain is one open run of two", walk.open.length === 1 && walk.open[0].length === 2);
  check("with the arc walked backwards", walk.open[0].some(step => step.reversed));

  await kernel.setSketch(sketchId, "drawing", backwards);
  // Measured on the sketch itself, not on what was padded from it: the length
  // of the drawing is the thing the reversal got wrong.
  const rule = (await kernel.addFeature("Measure", { shape: sketchId })).id;
  await kernel.setParameter(rule, "quantity", 0);
  const length = Number((await at(rule)).data.preview);
  const want = 100 + Math.PI * 40 / 2;
  check("and it measures the length it was drawn", Math.abs(length - want) < 0.01,
    length + " vs " + want.toFixed(2));
  await kernel.deleteFeature(rule);
}

console.log("\n11. drawing that carries on from what was drawn");
{
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {},
                        readLayout: () => ({}), select: () => {}, selected: () => null });
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                           units: "mm", features: [] });
  const sk = (await mdl.run({ op: "add", type: "Sketch", name: "Chain" })).id;
  const drawing = async () => (await at(sk)).sketch.drawing;

  // A polyline is the line tool used again and again, so what it writes is the
  // same edit again and again.
  for (const [a, b] of [[[0, 0], [100, 0]], [[100, 0], [100, 60]], [[100, 60], [0, 60]]])
    await mdl.run({ op: "draw", id: sk, type: "line", at: [a, b] });
  check("three segments make a run", (await drawing()).elements.length === 3);

  // An arc off the end of the last line: it starts there, leaves the way the
  // line was going, and only needs where it ends.
  await mdl.run({ op: "draw", id: sk, type: "arc", at: [[-60, 0]], from: "e3.b" });
  const arc = (await drawing()).elements[3];
  check("the arc is an arc", arc.type === "arc", JSON.stringify(arc));

  // Tangency, measured: at the join, the arc's direction and the line's must
  // be the same, and both ends must sit on the circle.
  const line = (await drawing()).elements[2];
  const join = line.b;
  const ends = sketchEnds(arc);
  const onCircle = p => Math.abs(Math.hypot(p[0] - arc.c[0], p[1] - arc.c[1]) - arc.r);
  check("it starts where the line stopped",
    Math.min(Math.hypot(ends.a[0] - join[0], ends.a[1] - join[1]),
             Math.hypot(ends.b[0] - join[0], ends.b[1] - join[1])) < 1e-3);
  check("and reaches where it was told", Math.min(onCircle(ends.a), onCircle(ends.b)) < 1e-3);
  // sketchDirectionAt answers "which way was it going when it got here", so the
  // way out of a handle and back along the element is the opposite of it. The
  // line arrives at the corner going one way; the arc must leave going the same.
  const heading = sketchDirectionAt(line, "b");
  const near = Math.hypot(ends.a[0] - join[0], ends.a[1] - join[1]) < 1e-3 ? "start" : "end";
  const inward = sketchDirectionAt(arc, near);
  const along = [-inward[0], -inward[1]];
  check("leaving exactly the way the line came in",
    Math.abs(along[0] - heading[0]) < 1e-4 && Math.abs(along[1] - heading[1]) < 1e-4,
    JSON.stringify([along, heading]));

  // Straight on has no arc through it - the "circle" is infinite. That is a
  // line, and drawing one beats refusing the click. e3 runs to [0,60] from
  // [100,60], so carrying on out of its far end means going back east.
  await mdl.run({ op: "draw", id: sk, type: "arc", at: [[240, 60]], from: "e3.a" });
  check("a straight tangent comes out as a line",
    (await drawing()).elements[4].type === "line", (await drawing()).elements[4].type);

  // And a handle moves without tearing the element it belongs to.
  await mdl.run({ op: "drag", id: sk, handle: "e1.b", to: [140, -20] });
  check("dragging an end moves it",
    JSON.stringify((await drawing()).elements[0].b) === "[140,-20]",
    JSON.stringify((await drawing()).elements[0].b));
  let refused = "";
  try { await mdl.run({ op: "drag", id: sk, handle: "nope.b", to: [0, 0] }); }
  catch (e) { refused = e.message; }
  check("dragging nothing is refused in words", /no handle/.test(refused), refused);
}

console.log("\n12. the sample the sketcher ships with");
{
  const { SAMPLES } = await import("../src/ocaf.js");
  const sample = SAMPLES.find(s => s.key === "sketcher");
  check("it sits after the hillside", SAMPLES.slice(0, 2).map(s => s.key).join(",")
    === "hillside-town,sketcher", SAMPLES.map(s => s.key).join(","));
  const built = await kernel.loadModel(sample.model);
  check("the Sketcher sample builds", built.report.failed.length === 0,
    JSON.stringify(built.report.failed.map(f => f.id + ": " + f.message)));
  const bad = (await tree()).features.filter(f => f.error);
  check("with nothing in error", bad.length === 0,
    bad.map(f => f.id + ": " + f.error).join("; "));

  const measure = async (shape, quantity) => {
    const id = (await kernel.addFeature("Measure", { shape })).id;
    await kernel.setParameter(id, "quantity", quantity);
    return Number((await at(id)).data.preview);
  };
  // Every number in the sample can be read off the drawing, so read them off.
  const outline = 210 + Math.PI * 50 + 210 + 100          // the four outer elements
                + 2 * Math.PI * 16 + 2 * Math.PI * 22     // two bolt circles
                + 2 * 70 + 2 * Math.PI * 14;              // and the slot
  check("the plate outline is as long as it is drawn",
    Math.abs(await measure("SK1", 0) - outline) < 0.05, String(await measure("SK1", 0)));

  const plate = await measure("EX1", 2), rib = await measure("EX2", 2);
  const union = await measure("BO1", 2);
  // A Boolean that appears to do nothing is the failure mode that looks right,
  // so the fuse is measured rather than believed: what it removed is the
  // trapezoid of rib standing in the plate's 14 mm, 14 mm thick.
  const overlap = (210 + 196) / 2 * 14 * 14;
  check("fusing the rib to the plate removes exactly where they overlap",
    Math.abs(plate + rib - union - overlap) < 1,
    (plate + rib - union) + " vs " + overlap);

  // The fin is the other half of the solid/surface toggle: an open chain,
  // swept, and nothing but the sweep.
  const chain = await measure("SK3", 0);
  check("the open chain sweeps into its own area, and no ends",
    Math.abs(await measure("EX3", 1) - chain * 40) < 0.05,
    (await measure("EX3", 1)) + " vs " + (chain * 40).toFixed(2));
  check("and the part is real geometry",
    (await kernel.mesh(["FI1"])).features[0].triangles > 2000);
}

console.log("\n13. a point held where two curves cross");
{
  // A line straight through a circle crosses it twice, so which crossing is
  // meant matters: it is the one the point is already nearest, and it stays
  // that one as the curves move.
  const drawing = {
    elements: [
      { id: "L1", type: "line", a: [-200, 0], b: [200, 0] },
      { id: "C1", type: "circle", c: [0, 0], r: 60 },
      { id: "P1", type: "point", p: [40, 8] },
    ],
    constraints: [sketchRelation("intersect", ["P1.p", "L1", "C1"])],
  };
  const at = d => solveSketch(d, 12).drawing.elements.find(e => e.id === "P1").p;
  const near = (p, want) => Math.abs(p[0] - want[0]) < 0.01 && Math.abs(p[1] - want[1]) < 0.01;
  check("the point goes to the crossing it is nearest", near(at(drawing), [60, 0]),
    JSON.stringify(at(drawing)));

  const other = JSON.parse(JSON.stringify(drawing));
  other.elements[2].p = [-40, 8];
  check("started on the other side it takes the other crossing",
    near(at(other), [-60, 0]), JSON.stringify(at(other)));

  // The crossing is a fact about the two curves, so growing one moves the
  // point and nothing else.
  const bigger = JSON.parse(JSON.stringify(drawing));
  bigger.elements[1].r = 150;
  const moved = solveSketch(bigger, 12).drawing;
  check("growing the circle takes the point with it",
    near(moved.elements.find(e => e.id === "P1").p, [150, 0]),
    JSON.stringify(moved.elements.find(e => e.id === "P1").p));
  check("and neither curve was moved to suit it",
    moved.elements[0].a[0] === -200 && moved.elements[1].c[0] === 0);

  // Curves that never meet leave it alone rather than throwing it somewhere.
  const apart = JSON.parse(JSON.stringify(drawing));
  apart.elements[0].a = [-200, 500];
  apart.elements[0].b = [200, 500];
  const still = solveSketch(apart, 12).drawing.elements.find(e => e.id === "P1").p;
  check("two that never meet leave the point where it was", near(still, [40, 8]),
    JSON.stringify(still));

  check("the mark sits on the point, not between the three things it names",
    near(sketchRelationMarks(drawing)[0].p, [40, 8]),
    JSON.stringify(sketchRelationMarks(drawing)[0].p));

  check("a file that carries one reads it back",
    readSketch(JSON.stringify(drawing)).constraints.length === 1);
  check("and one written with too few names is dropped rather than half-read",
    readSketch({ elements: drawing.elements,
                 constraints: [{ type: "intersect", of: ["P1.p", "L1"] }] }).constraints.length === 0);

  check("the crossings are found by id as well",
    sketchCrossings(drawing, "L1", "C1").length === 2,
    JSON.stringify(sketchCrossings(drawing, "L1", "C1")));
}

console.log("\n13. a drawing that closes nothing is still a drawing");
{
  // The thing that was wrong: a sketch of loose lines, or of nothing but
  // points, came in as a feature in error. A survey closes nothing and is
  // still a survey; setting-out is points and nothing else.
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {},
                        readLayout: () => ({}), select: () => {}, selected: () => null });
  const build = async drawing => {
    await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                             units: "mm", features: [] });
    const id = (await mdl.run({ op: "add", type: "Sketch", name: "Loose" })).id;
    await mdl.run({ op: "sketch", id, drawing });
    return await at(id);
  };

  const loose = await build({ elements: [
    { id: "a", type: "line", a: [0, 0], b: [100, 30] },
    { id: "b", type: "line", a: [200, 0], b: [260, 90] },
    { id: "c", type: "arc", c: [400, 0], r: 50, a0: 0, a1: 2 },
  ], constraints: [] });
  check("loose lines and an arc that close nothing build",
        loose.built && !loose.error, String(loose.error));

  const marks = await build({ elements: [
    { id: "p", type: "point", p: [10, 10] },
    { id: "q", type: "point", p: [90, 40] },
  ], constraints: [] });
  check("and a drawing of nothing but points builds too",
        marks.built && !marks.error, String(marks.error));
  check("with the points published, so they can be pointed at",
        marks.data && marks.data.count === 2, JSON.stringify(marks.data));

  const open = await build({ elements: [
    { id: "a", type: "line", a: [0, 0], b: [100, 0] },
    { id: "b", type: "line", a: [100, 0], b: [100, 80] },
  ], constraints: [{ type: "coincident", of: ["a.b", "b.a"] }] });
  check("an open chain builds as the wire it is", open.built && !open.error, String(open.error));

  const empty = await build({ elements: [], constraints: [] });
  check("an empty sketch is the one thing still refused",
        !empty.built && /empty/.test(empty.error || ""), String(empty.error));
}

console.log("\n14. layers");
{
  const drawing = {
    elements: [
      { id: "a", type: "line", a: [0, 0], b: [100, 0], layer: "OUTLINE" },
      { id: "b", type: "line", a: [100, 0], b: [100, 80], layer: "OUTLINE" },
      { id: "c", type: "circle", c: [50, 40], r: 12, layer: "FURNITURE" },
      { id: "d", type: "point", p: [5, 5] },
    ],
    constraints: [{ type: "coincident", of: ["a.b", "b.a"] }],
    layers: [{ name: "OUTLINE", on: true, locked: false },
             { name: "FURNITURE", on: false, locked: false }],
    current: "OUTLINE",
  };
  const layers = sketchLayers(drawing);
  check("every layer is found, declared or not",
        layers.map(l => l.name).join(",") === "OUTLINE,FURNITURE,0",
        layers.map(l => l.name).join(","));
  check("with what is on each of them",
        layers.map(l => l.count).join(",") === "2,1,1", layers.map(l => l.count).join(","));
  check("an element that names no layer is on the drawing's own",
        elementShown(drawing, drawing.elements[3]));
  check("and a drawing that has never heard of layers has one",
        sketchLayers({ elements: [{ id: "x", type: "point", p: [0, 0] }] })
          .map(l => l.name + ":" + l.count).join() === "0:1");

  const shown = shownDrawing(drawing);
  check("off means off: the elements on it are not there to be built",
        shown.elements.map(el => el.id).join(",") === "a,b,d",
        shown.elements.map(el => el.id).join(","));
  check("and a relation whose other end went off with it goes too",
        shownDrawing({ ...drawing,
          layers: [{ name: "OUTLINE", on: false }] }).constraints.length === 0);
  check("the summary counts what is hidden",
        /2 hidden/.test(sketchSummary({ ...drawing,
          layers: [{ name: "OUTLINE", on: false }] })),
        sketchSummary({ ...drawing, layers: [{ name: "OUTLINE", on: false }] }));
  // The relations go off with what they hold. A coincidence drawn beside two
  // ends that are no longer on the screen is a glyph hanging over nothing, and
  // that is what the sketcher used to show.
  const relations = { ...drawing,
    constraints: [{ type: "coincident", of: ["a.b", "b.a"] },
                  { type: "horizontal", of: ["c"] }] };
  const marksWith = (outline, furniture) => sketchRelationMarks({ ...relations,
    layers: [{ name: "OUTLINE", on: outline }, { name: "FURNITURE", on: furniture }] });
  check("every relation is marked while every layer is on",
        marksWith(true, true).length === 2, String(marksWith(true, true).length));
  check("one whose element is on a layer that is off is not drawn either",
        marksWith(true, false).map(m => m.type).join() === "coincident",
        marksWith(true, false).map(m => m.type).join());
  check("a relation reaching onto a layer that is off goes with it",
        marksWith(false, true).map(m => m.type).join() === "horizontal",
        marksWith(false, true).map(m => m.type).join());
  check("and the marks that stay keep their place in the constraints list",
        marksWith(false, true).every(m => m.at === 1));
  check("with every layer off there is nothing to mark",
        marksWith(false, false).length === 0);

  check("a locked layer is still shown, and still built",
        elementShown({ ...drawing, layers: [{ name: "OUTLINE", locked: true }] },
                     drawing.elements[0]));
  check("but nothing on it answers to the cursor",
        elementLocked({ ...drawing, layers: [{ name: "OUTLINE", locked: true }] },
                      drawing.elements[0]));
  check("new elements go on the current layer", currentLayer(drawing) === "OUTLINE");
  check("and never on one that is off or locked",
        currentLayer({ ...drawing, current: "FURNITURE" }) === "OUTLINE",
        currentLayer({ ...drawing, current: "FURNITURE" }));
  check("layers survive being written into the document",
        readSketch(JSON.stringify(drawing)).layers.length === 2
        && readSketch(JSON.stringify(drawing)).current === "OUTLINE");

  // And through the edit language, which is what the panel's buttons write.
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {},
                        readLayout: () => ({}), select: () => {}, selected: () => null });
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                           units: "mm", features: [] });
  const id = (await mdl.run({ op: "add", type: "Sketch", name: "Plan" })).id;
  await mdl.run({ op: "sketch", id, drawing });
  const held = async () => readSketch((await at(id)).sketch.drawing);

  await mdl.run({ op: "layer", id, name: "FURNITURE", show: true, lock: true });
  const locked = (await held()).layers.find(l => l.name === "FURNITURE");
  check("a layer can be shown and locked in one edit",
        locked.on && locked.locked, JSON.stringify(locked));

  await mdl.run({ op: "layer", id, name: "OUTLINE", rename: "Slab edge" });
  const renamed = await held();
  check("renaming a layer carries everything on it across",
        renamed.elements.filter(el => el.layer === "Slab edge").length === 2
        && renamed.current === "Slab edge",
        JSON.stringify(renamed.layers.map(l => l.name)));

  await mdl.run({ op: "layer", id, name: "Setting out", current: true });
  check("a layer nobody has used yet is made by naming it",
        (await held()).layers.some(l => l.name === "Setting out"));

  await mdl.run({ op: "unlayer", id, name: "FURNITURE" });
  const after = await held();
  check("deleting a layer takes what was drawn on it",
        after.elements.length === 3 && !after.elements.some(el => el.layer === "FURNITURE"),
        after.elements.map(el => el.id).join(","));

  let refused = "";
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                           units: "mm", features: [] });
  const only = (await mdl.run({ op: "add", type: "Sketch", name: "One" })).id;
  await mdl.run({ op: "sketch", id: only, drawing: { elements: [
    { id: "a", type: "line", a: [0, 0], b: [10, 0] }], constraints: [] } });
  try { await mdl.run({ op: "unlayer", id: only, name: "0" }); }
  catch (err) { refused = err.message; }
  check("and the last layer cannot go - a drawing is always on one",
        /only layer/.test(refused), refused);
}

console.log("\n15. construction geometry drives the drawing and is never built");
{
  // The measurement that says it worked: a square with a diagonal drawn across
  // it closes TWO loops and pads into two triangles. Mark the diagonal
  // construction and the same drawing is one square again - the line is still
  // there, still solved, still holding what is tangent to it, and the solid
  // has never heard of it.
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {},
                        readLayout: () => ({}), select: () => {}, selected: () => null });
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                           units: "mm", features: [] });
  const id = (await mdl.run({ op: "add", type: "Sketch", name: "Plate" })).id;
  const cut = square(100);
  cut.elements.push({ id: "d", type: "circle", c: [50, 50], r: 20 },
                    { id: "m", type: "point", p: [50, 50] });
  cut.constraints.push({ type: "coincident", of: ["m.p", "d.c"] });
  await mdl.run({ op: "sketch", id, drawing: cut });

  const rise = (await kernel.addFeature("Vector", {})).id;
  await kernel.setParameter(rise, "dx", 0);
  await kernel.setParameter(rise, "dz", 1);
  const slab = (await kernel.addFeature("Extrude", { profile: id, direction: rise })).id;
  await kernel.setParameter(slab, "distance", 10);
  const rule = (await kernel.addFeature("Measure", { shape: slab })).id;
  await kernel.setParameter(rule, "quantity", 2);
  const volume = async () => {
    const entry = await at(rule);
    return entry && entry.data ? Number(entry.data.preview) : NaN;
  };
  check("a circle drawn inside a square is a hole through the slab",
        Math.abs(await volume() - (100 * 100 - Math.PI * 400) * 10) < 60,
        String(await volume()));

  await mdl.run({ op: "construct", id, of: ["d"] });
  const marked = readSketch((await at(id)).sketch.drawing);
  check("marking it construction is one flag on the element",
        isConstruction(marked.elements.find(el => el.id === "d")),
        JSON.stringify(marked.elements.find(el => el.id === "d")));
  check("the circle is still in the drawing - it is scaffolding, not rubbish",
        marked.elements.length === 6 && marked.constraints.length === 1,
        marked.elements.length + "/" + marked.constraints.length);
  check("and what is built no longer knows about it",
        builtDrawing(marked).elements.length === 5
        && !builtDrawing(marked).elements.some(el => el.id === "d"),
        builtDrawing(marked).elements.map(el => el.id).join(","));
  check("so the relation that held the centre to it goes too",
        builtDrawing(marked).constraints.length === 0,
        String(builtDrawing(marked).constraints.length));
  check("and the slab is solid where the hole was",
        Math.abs(await volume() - 100 * 100 * 10) < 20, String(await volume()));

  // And the other way: it comes back.
  await mdl.run({ op: "construct", id, of: ["d"], on: false });
  check("and it can be made real again",
        !isConstruction(readSketch((await at(id)).sketch.drawing)
          .elements.find(el => el.id === "d")));

  await mdl.run({ op: "construct", id, of: ["e1", "e2", "e3", "e4", "d", "m"] });
  const all = await at(id);
  check("a drawing of nothing but construction says so rather than failing oddly",
        /construction geometry/.test(all.error || ""), String(all.error));

  // It survives the document, and it does not leave in the DXF.
  await mdl.run({ op: "construct", id, of: ["e1", "e2", "e3", "e4", "m"], on: false });
  const written = await kernel.exportShapes("dxf");
  check("a DXF of the sketch is the geometry, without the scaffolding",
        (written.text.match(/\nLINE\r?\n/g) || []).length === 4,
        String((written.text.match(/\nLINE\r?\n/g) || []).length));
  check("and the note says what it held back",
        /1 construction held back/.test(written.note), written.note);
  check("the summary counts it", /1 construction/.test(
          sketchSummary(readSketch((await at(id)).sketch.drawing))),
        sketchSummary(readSketch((await at(id)).sketch.drawing)));
}

console.log("\n16. one element nothing can be made of is one element");
{
  // What the road survey did: six duplicate lines of no length, invisible in
  // any viewer, each of which BRepBuilderAPI_MakeEdge answers with "BRep_API:
  // command not done". That raise came up through the whole build, so a
  // drawing of five hundred and eighty-one elements showed none of them.
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {},
                        readLayout: () => ({}), select: () => {}, selected: () => null });
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                           units: "mm", features: [] });
  const id = (await mdl.run({ op: "add", type: "Sketch", name: "Survey" })).id;
  const rough = square(100);
  rough.elements.push({ id: "z1", type: "line", a: [40, 40], b: [40, 40] },
                      { id: "z2", type: "line", a: [-20, -20], b: [-20, -20] },
                      { id: "z3", type: "circle", c: [60, 60], r: 0 },
                      { id: "z4", type: "arc", c: [10, 90], r: 5, a0: 1, a1: 1 });
  await mdl.run({ op: "sketch", id, drawing: rough });
  const entry = await at(id);
  check("a drawing carrying four degenerate elements still builds",
        entry.built && !entry.error, String(entry.error));

  const rise = (await kernel.addFeature("Vector", {})).id;
  await kernel.setParameter(rise, "dx", 0);
  await kernel.setParameter(rise, "dz", 1);
  const slab = (await kernel.addFeature("Extrude", { profile: id, direction: rise })).id;
  await kernel.setParameter(slab, "distance", 10);
  const rule = (await kernel.addFeature("Measure", { shape: slab })).id;
  await kernel.setParameter(rule, "quantity", 2);
  const made = await at(rule);
  check("and the square around them is built, whole",
        Math.abs(Number(made.data.preview) - 100 * 100 * 10) < 20,
        made.data && made.data.preview);
}

console.log("\n17. a window, a layer, and everything picked moved at once");
{
  const drawing = {
    elements: [
      { id: "a", type: "line", a: [0, 0], b: [40, 0], layer: "PLAN" },
      { id: "b", type: "line", a: [40, 0], b: [40, 40], layer: "PLAN" },
      { id: "c", type: "circle", c: [20, 20], r: 8, layer: "PLAN" },
      { id: "far", type: "line", a: [200, 200], b: [240, 200], layer: "NOTES" },
      { id: "half", type: "line", a: [30, 30], b: [300, 30], layer: "NOTES" },
    ],
    constraints: [{ type: "coincident", of: ["a.b", "b.a"] }],
    layers: [{ name: "PLAN", on: true, locked: false },
             { name: "NOTES", on: true, locked: false }],
    current: "PLAN",
  };

  // Left to right takes only what is wholly inside. Right to left takes
  // anything it touches. That is the difference, and it is the whole of it.
  const box = sketchBox([-5, -5], [50, 50]);
  check("a window takes what is wholly inside it",
        sketchInBox(drawing, box).join(",") === "a,b,c",
        sketchInBox(drawing, box).join(","));
  check("and leaves the line that only starts in it",
        !sketchInBox(drawing, box).includes("half"));
  check("a crossing window takes anything it touches",
        sketchInBox(drawing, box, { crossing: true }).join(",") === "a,b,c,half",
        sketchInBox(drawing, box, { crossing: true }).join(","));
  check("neither of them reaches what is nowhere near",
        !sketchInBox(drawing, box, { crossing: true }).includes("far"));
  check("a crossing window catches a line that passes right through it, "
        + "both ends outside",
        sketchInBox({ elements: [{ id: "t", type: "line", a: [-50, 20], b: [90, 20] }],
                      constraints: [] }, box, { crossing: true }).join(",") === "t");
  check("a window two corners make is the same box whichever way round",
        JSON.stringify(sketchBox([50, 50], [-5, -5])) === JSON.stringify(box));
  check("and nothing on a layer that is off is ever in one",
        sketchInBox({ ...drawing, layers: [{ name: "PLAN", on: false }] },
                    box, { crossing: true }).join(",") === "half");
  check("nor on a locked one",
        sketchInBox({ ...drawing, layers: [{ name: "PLAN", locked: true }] },
                    box, { crossing: true }).join(",") === "half");

  // Measured to the element rather than to the points it was sampled at. A
  // line's outline is its two ends, so this is the difference between being
  // able to take hold of a line and only being able to take hold of its ends.
  const long = { id: "x", type: "line", a: [0, 0], b: [400, 0] };
  check("halfway along a line is ON the line",
        sketchDistanceTo(long, [200, 0]) < 1e-9, String(sketchDistanceTo(long, [200, 0])));
  check("and three millimetres off it is three millimetres away",
        Math.abs(sketchDistanceTo(long, [200, 3]) - 3) < 1e-9,
        String(sketchDistanceTo(long, [200, 3])));
  check("past the end it is measured from the end",
        Math.abs(sketchDistanceTo(long, [404, 3]) - 5) < 1e-9,
        String(sketchDistanceTo(long, [404, 3])));
  // A circle is its rim, not its centre: a millimetre outside the rim is a
  // millimetre away, and the middle of it is fifty.
  const ring = { id: "o", type: "circle", c: [0, 0], r: 50 };
  check("and a circle is its rim", Math.abs(sketchDistanceTo(ring, [0, 51]) - 1) < 0.02,
        String(sketchDistanceTo(ring, [0, 51])));
  check("with nothing in the middle of it to take hold of",
        Math.abs(sketchDistanceTo(ring, [0, 0]) - 50) < 0.15,
        String(sketchDistanceTo(ring, [0, 0])));

  check("everything on a layer, by name", sketchOnLayer(drawing, "PLAN").join(",") === "a,b,c");
  check("including what is on the drawing's own by saying nothing",
        sketchOnLayer({ elements: [{ id: "x", type: "point", p: [0, 0] }] }, "0").join(",") === "x");

  // Moved bodily: an arc keeps its radius and its sweep, because it moves by
  // its centre rather than by each end.
  const arc = { id: "r", type: "arc", c: [10, 10], r: 5, a0: 0, a1: 1.2 };
  sketchMoveElement(arc, [7, -3]);
  check("an arc moves by its centre and is the same arc",
        arc.c.join(",") === "17,7" && arc.r === 5 && arc.a1 === 1.2,
        JSON.stringify(arc));

  // And through the edit language, which is what the window drag writes.
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {},
                        readLayout: () => ({}), select: () => {}, selected: () => null });
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                           units: "mm", features: [] });
  const id = (await mdl.run({ op: "add", type: "Sketch", name: "Plan" })).id;
  await mdl.run({ op: "sketch", id, drawing });
  const held = async () => readSketch((await at(id)).sketch.drawing);

  await mdl.run({ op: "nudge", id, of: ["a", "b", "c"], by: [100, 0] });
  const moved = await held();
  check("a nudge moves every element it names by the same amount",
        moved.elements.find(el => el.id === "a").a.join(",") === "100,0"
        && moved.elements.find(el => el.id === "c").c.join(",") === "120,20",
        JSON.stringify(moved.elements.slice(0, 3).map(el => el.id + ":" + JSON.stringify(el.a || el.c))));
  check("and leaves everything it does not",
        moved.elements.find(el => el.id === "far").a.join(",") === "200,200");
  check("the corner they were holding is still a corner",
        moved.elements.find(el => el.id === "a").b.join(",")
          === moved.elements.find(el => el.id === "b").a.join(","));

  await mdl.run({ op: "relayer", id, of: ["a", "b"], to: "SETTING OUT" });
  const sorted = await held();
  check("relayer moves elements onto a layer",
        sorted.elements.filter(el => el.layer === "SETTING OUT").map(el => el.id).join(",") === "a,b",
        sorted.elements.map(el => el.id + ":" + el.layer).join(" "));
  check("a layer nobody had used is made by moving something onto it",
        sorted.layers.some(l => l.name === "SETTING OUT"),
        sorted.layers.map(l => l.name).join(","));
  check("and the sketch still builds", (await at(id)).built, String((await at(id)).error));

  let refused = "";
  try { await mdl.run({ op: "relayer", id, of: ["nope"], to: "PLAN" }); }
  catch (err) { refused = err.message; }
  check("naming an element that is not there says so",
        /no element called nope/.test(refused), refused);
}

console.log("\n18. corners that only happen to meet, held together");
{
  // A site boundary off a DXF: eight arcs and lines that close, drawn in
  // millimetres on survey coordinates six hundred and fifty metres across.
  // Two of its eight corners miss by a third of a millimetre - six parts in
  // ten million, which is nothing on a survey and was more than enough to stop
  // the outline closing at a flat five hundredths of a millimetre.
  const site = { elements: [
    { id: "d1", type: "arc", c: [138645.9216, 720885.4224], r: 14000, a0: 1.523152, a1: 3.138084 },
    { id: "d2", type: "arc", c: [1033837.0172, 717744.7755], r: 909196.604815,
      a0: 3.138084, a1: 3.771894 },
    { id: "d3", type: "arc", c: [310652.7433, 190126.0995], r: 14000, a0: -2.511291, a1: -0.784433 },
    { id: "d4", type: "line", a: [455448.894, 315383.8425], b: [320561.7863, 180236.1618] },
    { id: "d5", type: "arc", c: [445539.851, 325273.7802], r: 14000, a0: -0.784433, a1: 0.588324 },
    { id: "d6", type: "arc", c: [1033837.0172, 717744.7755], r: 693196.604827,
      a0: -3.133357, a1: -2.553269 },
    { id: "d7", type: "arc", c: [326664.3954, 711920.6168], r: 13999.999998,
      a0: 0.008236, a1: 1.523152 },
    { id: "d8", type: "line", a: [139312.6904, 734869.5355], b: [327331.1642, 725904.7299] },
  ], constraints: [] };
  check("the drawing is six hundred and fifty metres across",
        Math.abs(sketchExtent(site) - 651120) < 10, sketchExtent(site).toFixed(0));
  check("so what counts as the same point on it is two thirds of a millimetre",
        Math.abs(sketchGrain(site) - 0.651) < 0.01, sketchGrain(site).toFixed(4));
  check("and the outline closes into one loop", sketchLoops(site, 0.05).loops.length === 1,
        JSON.stringify(sketchLoops(site, 0.05)).slice(0, 80));
  // On anything of an ordinary size the grain is far below the tolerance the
  // caller asks for, so it changes nothing: it only ever loosens, and only for
  // drawings big enough that a flat number of millimetres stops meaning
  // anything.
  check("while on a hundred-millimetre drawing it is a fraction of a micron, "
        + "so the tolerance asked for is the one that counts",
        sketchGrain(square(100)) < 0.0002 && sketchGrain(square(100)) < 0.05,
        String(sketchGrain(square(100))));

  // Every corner said out loud, so the drawing survives being pulled about.
  const welds = sketchOverlaps(site);
  check("every one of the eight corners is found", welds.length === 8, String(welds.length));
  check("and each one names two ends of two different elements",
        welds.every(w => w.type === "coincident" && w.of.length === 2
          && w.of[0].split(".")[0] !== w.of[1].split(".")[0]),
        JSON.stringify(welds[0]));
  check("an arc's ends are called start and end, which is what a coincidence names",
        JSON.stringify(sketchEndKeys({ type: "arc" })) === JSON.stringify({ a: "start", b: "end" }));
  check("asking twice does not say it twice",
        sketchOverlaps({ ...site, constraints: welds }).length === 0);

  // Three ends at one corner is one corner: two relations, not three.
  const tee = { elements: [
    { id: "a", type: "line", a: [0, 0], b: [50, 0] },
    { id: "b", type: "line", a: [50, 0], b: [50, 50] },
    { id: "c", type: "line", a: [50, 0], b: [100, 0] },
  ], constraints: [] };
  check("three ends meeting at a corner want two relations, not three",
        sketchOverlaps(tee, 0.01).length === 2,
        String(sketchOverlaps(tee, 0.01).length));
  const nearly = { elements: [{ id: "o", type: "arc", c: [0, 0], r: 50, a0: 0, a1: 6.28 }],
                   constraints: [] };
  check("and an arc that nearly closes on itself is an arc, not a mistake",
        sketchOverlaps(nearly, 1).length === 0, String(sketchOverlaps(nearly, 1).length));

  // A coincidence is the truth about a corner, whatever the numbers still say.
  const apart = { elements: [
    { id: "a", type: "line", a: [0, 0], b: [100, 0] },
    { id: "b", type: "line", a: [100, 4], b: [100, 100] },
    { id: "c", type: "line", a: [100, 100], b: [0, 0] },
  ], constraints: [{ type: "coincident", of: ["a.b", "b.a"] }] };
  check("a gap a coincidence holds is not a gap",
        sketchLoops(apart, 0.05).loops.length === 1,
        JSON.stringify(sketchLoops(apart, 0.05).open));
  check("and without the coincidence it is one",
        sketchLoops({ ...apart, constraints: [] }, 0.05).loops.length === 0);

  // Through the edit language, and then through the kernel: a face.
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {},
                        readLayout: () => ({}), select: () => {}, selected: () => null });
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                           units: "mm", features: [] });
  const id = (await mdl.run({ op: "add", type: "Sketch", name: "Boundary" })).id;
  await mdl.run({ op: "sketch", id, drawing: site });
  await mdl.run({ op: "weld", id });
  const welded = readSketch((await at(id)).sketch.drawing);
  check("weld writes the corners into the drawing", welded.constraints.length === 8,
        String(welded.constraints.length));
  check("and the sketch builds one loop", /1 loop/.test((await at(id)).sketch.summary),
        (await at(id)).sketch.summary);

  const rule = (await kernel.addFeature("Measure", { shape: id })).id;
  await kernel.setParameter(rule, "quantity", 1);
  const area = Number((await at(rule)).data.preview);
  // Measured against the same outline walked as a polygon: within a hundredth
  // of one per cent, which is the polygon under-measuring the arcs.
  check("and the face it makes is the area the outline encloses",
        Math.abs(area - 111.5e9) / 111.5e9 < 0.001, (area / 1e6).toFixed(0) + " m2");

  let refused = "";
  try { await mdl.run({ op: "weld", id }); } catch (err) { refused = err.message; }
  check("welding twice says there is nothing left to hold",
        /already held together/.test(refused), refused);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
