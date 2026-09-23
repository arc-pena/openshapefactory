// What a drawing board owes you: a rectangle, a rounded corner, and a profile
// that can be lofted.
//
// Four complaints, all of them the same complaint in the end - the sketcher
// could draw but it could not MODIFY, and what it drew was not always usable
// downstream:
//
//   * there was no rectangle, so the commonest profile in architecture was
//     four lines and four coincidences drawn by hand;
//   * there was no fillet, so a rounded corner was an arc placed by eye and
//     held on with two tangencies that may or may not have solved;
//   * a sketch with more than one loop in it could not be a loft section at
//     all - "BRep_API: command not done" - because every edge of every loop
//     was poured into one wire;
//   * and an origin point that was not on the plane took the whole drawing off
//     the plane with it, so the sketch was not where it said it was.
//
// Checked here, against a real kernel, in that order.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { sketchEnds, sketchFillet, sketchHandles, sketchMoveHandle, sketchOutline,
         solveSketch, SKETCH_CLICKS, SKETCH_TYPES } from "../src/sketch.js";
import { readFileSync } from "fs";

const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const init = (await import(DIR + "/replicad_single.js")).default;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const deg = r => r * 180 / Math.PI;

console.log("1. a rectangle, which is two corners and nothing else");
{
  check("it is one of the sketcher's kinds", SKETCH_TYPES.includes("rect"));
  check("and it takes two clicks", SKETCH_CLICKS.rect === 2, String(SKETCH_CLICKS.rect));
  const rect = { id: "r1", type: "rect", a: [0, 0], b: [100, 60] };
  const line = sketchOutline(rect);
  check("it draws as a closed run of five points", line.length === 5
        && line[0][0] === line[4][0] && line[0][1] === line[4][1],
        JSON.stringify(line));
  check("through all four corners",
        JSON.stringify(line.slice(0, 4)) === JSON.stringify([[0, 0], [100, 0], [100, 60], [0, 60]]),
        JSON.stringify(line.slice(0, 4)));
  check("and it is a loop, so a chain can close on it",
        sketchEnds(rect).closed === true);
  // All four corners are handles, because a rectangle is dragged by whichever
  // one is nearest the hand - not only by the two that happen to be stored.
  const handles = sketchHandles(rect);
  check("all four corners are handles", handles.length === 4,
        handles.map(h => h[0]).join(","));
  const grabbed = JSON.parse(JSON.stringify(rect));
  sketchMoveHandle(grabbed, "ab", [-20, 90]);
  check("dragging the corner that is not stored moves the two edges at it",
        grabbed.a[0] === -20 && grabbed.b[1] === 90
        && grabbed.a[1] === 0 && grabbed.b[0] === 100,
        JSON.stringify(grabbed));
}

console.log("\n2. a fillet, worked out rather than placed by eye");
{
  const corner = { elements: [
    { id: "l1", type: "line", a: [0, 100], b: [0, 0] },
    { id: "l2", type: "line", a: [0, 0], b: [100, 0] },
  ], constraints: [{ type: "coincident", of: ["l1.b", "l2.a"] }] };
  const out = sketchFillet(corner, "l1", "l2", 20, "f1");
  const arc = out.drawing.elements.find(el => el.id === "f1");
  check("an arc appears", !!arc && arc.type === "arc");
  // A 20 mm arc tangent to both arms of a right angle at the origin has its
  // centre at (20, 20) and sweeps exactly a quarter turn. Nothing here is
  // approximate: this is the answer, and it is checked as the answer.
  check("centred where an arc tangent to both arms must be",
        near(arc.c[0], 20, 1e-6) && near(arc.c[1], 20, 1e-6), JSON.stringify(arc.c));
  check("with the radius asked for", near(arc.r, 20, 1e-6), String(arc.r));
  check("sweeping a quarter turn", near(deg(arc.a1 - arc.a0), 90, 1e-4),
        deg(arc.a1 - arc.a0).toFixed(4));
  const [l1, l2] = out.drawing.elements;
  check("the first arm is trimmed back to the tangency point",
        near(l1.b[0], 0, 1e-6) && near(l1.b[1], 20, 1e-6), JSON.stringify(l1.b));
  check("and so is the second", near(l2.a[0], 20, 1e-6) && near(l2.a[1], 0, 1e-6),
        JSON.stringify(l2.a));
  // The coincidence that held the corner is about a corner that has gone.
  const held = out.drawing.constraints;
  const meet = held.filter(c => c.type === "coincident");
  const tangents = held.filter(c => c.type === "tangent");
  check("the old corner's coincidence is taken off", meet.length === 2,
        JSON.stringify(held));
  check("and the arc is held on at both ends",
        meet.every(c => c.of.some(r => r.startsWith("f1."))), JSON.stringify(meet));
  //! AND HELD TANGENT AT BOTH, which the drawing used to say nothing about.
  //! Two coincidences say the three curves meet; they do not say the join is
  //! smooth, so the first time anything moved, the solver was free to put the
  //! kink back and nothing in the sketch disagreed.
  check("and tangent to both arms, which is what makes it a fillet",
        tangents.length === 2
        && tangents.every(c => c.of.includes("f1"))
        && tangents.some(c => c.of.includes("l1"))
        && tangents.some(c => c.of.includes("l2")),
        JSON.stringify(tangents));
  //! Built tangent, and STILL tangent after the solver has had it - the check
  //! that the relation is one the solver can actually run. It could not before:
  //! the tangency case looked for a "circle" and a fillet is an "arc", so it
  //! found no round element and did nothing at all.
  {
    const again = solveSketch(out.drawing, 24).drawing;
    const a = again.elements.find(el => el.id === "f1");
    const gap = line => {
      const el = again.elements.find(x => x.id === line);
      const run = [el.b[0] - el.a[0], el.b[1] - el.a[1]];
      const reach = Math.hypot(run[0], run[1]);
      const across = ((a.c[0] - el.a[0]) * run[1] - (a.c[1] - el.a[1]) * run[0]) / reach;
      return Math.abs(Math.abs(across) - a.r);
    };
    check("and the solver leaves it tangent and the size it was asked for",
          gap("l1") < 1e-6 && gap("l2") < 1e-6 && near(a.r, 20, 1e-6),
          "l1 off by " + gap("l1").toFixed(9) + ", l2 by " + gap("l2").toFixed(9)
          + ", r " + a.r);
  }

  // A line and an arc, which is where a fillet stops being arithmetic you can
  // do in your head: the centre is on a line parallel to the one at r AND on a
  // circle about the arc's centre at R + r, and it must be exactly that.
  const mixed = { elements: [
    { id: "l1", type: "line", a: [-200, 0], b: [0, 0] },
    { id: "a1", type: "arc", c: [100, 0], r: 100, a0: Math.PI / 2, a1: Math.PI },
  ], constraints: [] };
  const round2 = sketchFillet(mixed, "l1", "a1", 30, "f2");
  const f2 = round2.drawing.elements.find(el => el.id === "f2");
  check("a line and an arc round too", !!f2);
  check("its centre is 30 from the line", near(f2.c[1], 30, 1e-6), String(f2.c[1]));
  check("and 130 from the arc's centre, which is tangency",
        near(Math.hypot(f2.c[0] - 100, f2.c[1]), 130, 1e-4),
        Math.hypot(f2.c[0] - 100, f2.c[1]).toFixed(4));

  // Refusals, each of them something a person can act on.
  const says = (a, b, r, drawing = corner) => {
    try { sketchFillet(drawing, a, b, r, "x"); return ""; } catch (e) { return e.message; }
  };
  check("a spline is refused rather than approximated",
        /is a spline/.test(says("s1", "l2", 10, { elements: [
          { id: "s1", type: "spline", pts: [[0, 0], [10, 10]] },
          ...corner.elements], constraints: [] })),
        says("s1", "l2", 10, { elements: [{ id: "s1", type: "spline", pts: [[0, 0], [10, 10]] },
          ...corner.elements], constraints: [] }));
  check("one element is not a corner", /two different/.test(says("l1", "l1", 10)),
        says("l1", "l1", 10));
  check("and a radius of nothing is not a fillet",
        /greater than zero/.test(says("l1", "l2", 0)), says("l1", "l2", 0));
  // Two that already run into each other have no corner, and a zero-length arc
  // in the drawing would only break the chain it was put into.
  const smooth = { elements: [
    { id: "l1", type: "line", a: [-100, 0], b: [0, 0] },
    { id: "l2", type: "line", a: [0, 0], b: [100, 0] },
  ], constraints: [] };
  check("and two in a straight line are told there is no corner there",
        /no corner/.test(says("l1", "l2", 10, smooth)), says("l1", "l2", 10, smooth));
}

console.log("\n3. through the model, where a drawing becomes geometry");
const kernel = await createWasmKernel({ initModule: init,
                                        wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                      select: () => {}, selected: () => null });
const at = async id => (await kernel.tree()).tree.features.find(f => f.id === id);
const why = f => (f && (f.error || f.note)) || "";
const num = f => Number((f && f.data && f.data.preview) || NaN);

await mdl.run({ op: "model", model: { format: "ocaf-parametric-model",
  version: 1, name: "Drawing", units: "mm", features: [] } });
await mdl.run({ op: "add", type: "Point", id: "P0", name: "Origin" });
await mdl.run({ op: "add", type: "Vector", id: "VZ", name: "Z" });
await mdl.run({ op: "set", id: "VZ", key: "dz", value: 1 });
await mdl.run({ op: "add", type: "Plane", id: "PL", name: "XY",
                refs: { origin: "P0", normal: "VZ" } });
{
  await mdl.run({ op: "add", type: "Sketch", id: "SK", name: "Plan",
                  refs: { plane: "PL", origin: "P0" } });
  await mdl.run({ op: "sketch", id: "SK", drawing: { elements: [
    { id: "r1", type: "rect", a: [0, 0], b: [200, 120] }], constraints: [] } });
  const drawn = await at("SK");
  check("a rectangle builds", !drawn.error, why(drawn));
  check("and the kernel reads it as one closed loop",
        /1 loop/.test(drawn.sketch.summary), drawn.sketch.summary);
  await mdl.run({ op: "add", type: "Measure", id: "MA", name: "Area",
                  refs: { shape: "SK" } });
  await mdl.run({ op: "set", id: "MA", key: "quantity", value: 1 });
  check("the face it makes is 200 by 120", near(num(await at("MA")), 24000, 1),
        String(num(await at("MA"))));

  // Rounded: four corners at 20 takes 4 * (400 - pi*100) off the area.
  await mdl.run({ op: "sketch", id: "SK", drawing: { elements: [
    { id: "l1", type: "line", a: [0, 0], b: [200, 0] },
    { id: "l2", type: "line", a: [200, 0], b: [200, 120] },
    { id: "l3", type: "line", a: [200, 120], b: [0, 120] },
    { id: "l4", type: "line", a: [0, 120], b: [0, 0] },
  ], constraints: [] } });
  for (const [a, b] of [["l1", "l2"], ["l2", "l3"], ["l3", "l4"], ["l4", "l1"]])
    await mdl.run({ op: "fillet", id: "SK", of: [a, b], radius: 20 });
  const rounded = await at("SK");
  check("four fillets applied one after another", !rounded.error, why(rounded));
  check("and the drawing is eight elements", rounded.sketch.summary.startsWith("8 elements"),
        rounded.sketch.summary);
  // Each corner loses the square of the radius less the quarter circle in it.
  const lost = -4 * (20 * 20 - Math.PI * 20 * 20 / 4);
  check("with exactly the corner area taken off",
        near(num(await at("MA")), 24000 + lost, 1),
        num(await at("MA")) + " vs " + (24000 + lost).toFixed(2));
  check("and it is still one loop", /1 loop/.test(rounded.sketch.summary),
        rounded.sketch.summary);
}

console.log("\n4. a drawing with more than one loop is still a loft section");
{
  await mdl.run({ op: "add", type: "Plane", id: "PT", name: "Top", refs: { from: "PL" } });
  await mdl.run({ op: "set", id: "PT", key: "kind", value: 2 });
  await mdl.run({ op: "set", id: "PT", key: "offset", value: 300 });
  await mdl.run({ op: "add", type: "Sketch", id: "SU", name: "Upper",
                  refs: { plane: "PT", origin: "P0" } });
  await mdl.run({ op: "sketch", id: "SU", drawing: { elements: [
    { id: "r1", type: "rect", a: [50, 30], b: [150, 90] }], constraints: [] } });
  await mdl.run({ op: "sketch", id: "SK", drawing: { elements: [
    { id: "r1", type: "rect", a: [0, 0], b: [200, 120] }], constraints: [] } });
  await mdl.run({ op: "add", type: "Loft", id: "LF", name: "Massing",
                  refs: { sections: ["SK", "SU"] } });
  const plain = await at("LF");
  check("one loop each lofts", !plain.error, why(plain));
  await mdl.run({ op: "add", type: "Measure", id: "MV", name: "Volume",
                  refs: { shape: "LF" } });
  await mdl.run({ op: "set", id: "MV", key: "quantity", value: 2 });
  // A prismatoid: h/6 * (A0 + 4*Am + A1), and the middle section of a loft
  // between two rectangles is the rectangle halfway between them.
  const want = 300 / 6 * (200 * 120 + 4 * (150 * 90) + 100 * 60);
  check("with the volume a prismatoid has", near(num(await at("MV")), want, 1),
        num(await at("MV")) + " vs " + want);

  // The one that could not be built at all: a drawing with a hole in it.
  await mdl.run({ op: "sketch", id: "SK", drawing: { elements: [
    { id: "r1", type: "rect", a: [0, 0], b: [200, 120] },
    { id: "c1", type: "circle", c: [100, 60], r: 25 },
  ], constraints: [] } });
  const holed = await at("LF");
  check("and a section with a hole in it lofts rather than failing", !holed.error, why(holed));
  check("saying which loop it took", /outer loop/.test(holed.note || ""), why(holed));
  check("which is the outer one, so the solid is the same size",
        near(num(await at("MV")), want, 1), String(num(await at("MV"))));
}

console.log("\n5. the sketch is ON its plane, whatever point it is given");
{
  // A point two metres above the XY plane. The drawing's origin slides to
  // where that point is ON the plane; it does not go up with it.
  await mdl.run({ op: "add", type: "Point", id: "PH", name: "High" });
  for (const [key, value] of [["x", 80], ["y", 40], ["z", 2000]])
    await mdl.run({ op: "set", id: "PH", key, value });
  await mdl.run({ op: "sketch", id: "SK", drawing: { elements: [
    { id: "r1", type: "rect", a: [0, 0], b: [200, 120] }], constraints: [] } });
  await mdl.run({ op: "connect", id: "SK", key: "origin", from: "PH" });
  const frame = (await at("SK")).sketch.frame;
  check("the frame slides across the plane", near(frame.origin[0], 80, 1e-6)
        && near(frame.origin[1], 40, 1e-6), JSON.stringify(frame.origin));
  check("and stays on it", near(frame.origin[2], 0, 1e-6), String(frame.origin[2]));
}

console.log("\n6. and a point can be dropped onto a plane on purpose");
{
  await mdl.run({ op: "add", type: "Point", id: "PJ", name: "Dropped",
                  refs: { what: "PH", onto: "PL" } });
  await mdl.run({ op: "set", id: "PJ", key: "kind", value: 5 });
  const dropped = await at("PJ");
  check("it builds", !dropped.error, why(dropped));
  check("and lands on the plane under the point",
        dropped.data.preview.replace(/[()\s]/g, "") === "80,40,0", dropped.data.preview);

  // Onto a solid, where "nearest" is a different answer from "straight down".
  await mdl.run({ op: "add", type: "Cube", id: "CB", name: "Block",
                  refs: { origin: "P0", plane: "PL" } });
  for (const [key, value] of [["dx", 200], ["dy", 120], ["dz", 80]])
    await mdl.run({ op: "set", id: "CB", key, value });
  await mdl.run({ op: "add", type: "Point", id: "PO", name: "Over" });
  for (const [key, value] of [["x", 100], ["y", 60], ["z", 500]])
    await mdl.run({ op: "set", id: "PO", key, value });
  await mdl.run({ op: "add", type: "Point", id: "PD", name: "On the block",
                  refs: { what: "PO", onto: "CB" } });
  await mdl.run({ op: "set", id: "PD", key: "kind", value: 5 });
  check("a point over a block lands on its lid",
        (await at("PD")).data.preview.replace(/[()\s]/g, "") === "100,60,80",
        (await at("PD")).data.preview);
  await mdl.run({ op: "set", id: "PD", key: "way", value: 1 });
  check("and straight down says the same thing here",
        (await at("PD")).data.preview.replace(/[()\s]/g, "") === "100,60,80",
        (await at("PD")).data.preview);
}

console.log("\n7. holes, which are holes whichever way round they were drawn");
{
  //! WHICH WAY A LOOP RUNS IS DECIDED BY THE ORDER SOMEBODY DREW IT IN, and
  //! OpenCascade decides what a wire added to a face MEANS by exactly that:
  //! running the same way as the outline it is a second outline and the face
  //! comes back bigger; running against it, it is a hole. Reversing every
  //! hole is therefore right half the time and silently wrong the rest -
  //! the face builds, it is just the wrong face.
  //!
  //! The file that brought this up: a hexagon with three rectangles inside
  //! it, padded. It came out as a solid hexagon with three solid blocks
  //! standing in it. The numbers below are worked out on paper from the
  //! coordinates, so they say which answer is which.
  const hex = [[-485.013, 5977.253], [6087.047, 4924.201], [4418.907, -9174.733],
               [573.732, -6745.401], [-5095.825, -4537.135], [-4187.286, 1068.172]];
  const holes = [[[-2028.588, -4266.692], [-351.448, -1229.19]],
                 [[135.458, -3067.021], [2929.248, -1043.265]],
                 [[-1445.695, -543.641], [1673.661, 2805.237]]];
  const shoelace = ring => Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
  const outer = shoelace(hex);
  const cut = holes.reduce((sum, [a, b]) =>
    sum + Math.abs(b[0] - a[0]) * Math.abs(b[1] - a[1]), 0);

  const elements = hex.map((p, i) => ({ id: "h" + i, type: "line", a: p,
                                        b: hex[(i + 1) % hex.length] }));
  holes.forEach(([a, b], i) => elements.push({ id: "v" + i, type: "rect", a, b }));
  await mdl.run({ op: "add", type: "Sketch", id: "SH", name: "Holed",
                  refs: { plane: "PL", origin: "P0" } });
  await mdl.run({ op: "sketch", id: "SH", drawing: { elements, constraints: [] } });
  const drawn = await at("SH");
  check("a boundary with three rectangles in it builds", !drawn.error, why(drawn));
  check("and reads as four loops", /4 loops/.test(drawn.sketch.summary),
        drawn.sketch.summary);

  await mdl.run({ op: "add", type: "Measure", id: "AH", name: "Holed area",
                  refs: { shape: "SH" } });
  await mdl.run({ op: "set", id: "AH", key: "quantity", value: 1 });
  check("the face is the outline LESS the three holes",
        near(num(await at("AH")), outer - cut, 1),
        num(await at("AH")).toFixed(1) + " vs " + (outer - cut).toFixed(1));
  check("  and not the outline PLUS them, which is what reversing gave",
        Math.abs(num(await at("AH")) - (outer + cut)) > 1,
        num(await at("AH")).toFixed(1) + " vs " + (outer + cut).toFixed(1));

  //! And the pad, because a face with holes that pads as four solids is the
  //! thing anybody actually notices.
  await mdl.run({ op: "add", type: "Extrude", id: "EH", name: "Pad",
                  refs: { profile: "SH" } });
  await mdl.run({ op: "set", id: "EH", key: "distance", value: 615.771 });
  await mdl.run({ op: "add", type: "Measure", id: "VH", name: "Volume",
                  refs: { shape: "EH" } });
  await mdl.run({ op: "set", id: "VH", key: "quantity", value: 2 });
  check("and the pad is that face times its depth",
        near(num(await at("VH")), (outer - cut) * 615.771, 1e3),
        num(await at("VH")).toFixed(0) + " vs " + ((outer - cut) * 615.771).toFixed(0));
  //! 20 faces: six outer sides, twelve inner sides, two caps. Four separate
  //! solids would be 26, and that was the shape this used to make.
  const faces = (await kernel.picks("EH", "face")).items || [];
  check("  six sides, twelve inside the holes, and two caps",
        faces.length === 20, String(faces.length));
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
