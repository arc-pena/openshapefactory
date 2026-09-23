// Lines and circles from constraints, as nodes in a document.
//
// gcc.test.mjs checks the arithmetic. This checks that the arithmetic reaches
// the model: that a Circle drawn somewhere can be pointed at, read back as a
// circle on a plane, and used as the thing a tangency is about - and that what
// comes out the other end is a real edge in the B-Rep with the radius the
// solver said it would have.
//
// Measured, not eyeballed: the built circle's own radius is read back off the
// kernel's adaptor and compared against what was asked for.
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
const tree = async () => (await kernel.tree()).features || (await kernel.tree()).tree.features;
const of = async id => (await tree()).find(f => f.id === id);
//! The radius the kernel says the built curve has - read off the shape, not
//! off the node's own numbers, so a driver that wrote the right note and the
//! wrong edge is caught.
const builtRadius = async id => {
  const got = await kernel.measure(id, "radius").catch(() => null);
  return got;
};

console.log("1. two circles and a line to constrain against");
await mdl.run({ op: "model", model: { format: "ocaf-parametric-model",
  version: 1, name: "Constraints", units: "mm", features: [] } });
await run([
  { op: "add", type: "Point", id: "P0", name: "Origin" },
  { op: "add", type: "Vector", id: "VZ", name: "Z" },
  { op: "set", id: "VZ", key: "dz", value: 1 },
  { op: "add", type: "Plane", id: "PLANE1", name: "XY",
    refs: { origin: "P0", normal: "VZ" } },
  { op: "add", type: "Point", id: "PA", name: "A" },
  { op: "set", id: "PA", key: "x", value: 0 },
  { op: "set", id: "PA", key: "y", value: 0 },
  { op: "set", id: "PA", key: "z", value: 0 },
  { op: "add", type: "Point", id: "PB", name: "B" },
  { op: "set", id: "PB", key: "x", value: 140 },
  { op: "set", id: "PB", key: "y", value: 0 },
  { op: "set", id: "PB", key: "z", value: 0 },
  { op: "add", type: "Circle", id: "C1", name: "One", refs: { plane: "PLANE1" } },
  { op: "set", id: "C1", key: "radius", value: 50 },
  { op: "add", type: "Plane", id: "PL2", name: "Shifted",
    refs: { origin: "PB", normal: "VZ" } },
  { op: "add", type: "Circle", id: "C2", name: "Two", refs: { plane: "PL2" } },
  { op: "set", id: "C2", key: "radius", value: 50 },
]);
{
  const one = await of("C1"), two = await of("C2");
  check("both circles built", one && !one.error && two && !two.error,
        (one || {}).error + " / " + (two || {}).error);
}

console.log("\n2. tangent to two circles, with a radius");
await run([
  { op: "add", type: "ConstrainedCircle", id: "K1", name: "Tangent",
    refs: { plane: "PLANE1", first: "C1", second: "C2" } },
  { op: "set", id: "K1", key: "kind", value: 0 },
  { op: "set", id: "K1", key: "radius", value: 120 },
]);
{
  const k = await of("K1");
  check("it built", k && !k.error, (k || {}).error);
  check("and says how many answers there were",
        k && /of \d+ answers/.test(k.note || ""), k && k.note);
  check("the note carries the radius it was asked for",
        k && /r 120/.test(k.note || ""), k && k.note);
}

console.log("\n3. the qualifiers narrow it, and the answer picker picks");
{
  const all = (await of("K1")).note;
  await run([{ op: "set", id: "K1", key: "askFirst", value: 1 },
             { op: "set", id: "K1", key: "askSecond", value: 1 }]);
  const outside = (await of("K1")).note;
  const count = s => Number((String(s).match(/of (\d+) answers/) || [])[1] || 1);
  check("outside both leaves fewer than either side",
        count(outside) < count(all), all + "  ->  " + outside);
  check("and it is the two that sit clear of them", count(outside) === 2, outside);
  await run([{ op: "set", id: "K1", key: "answer", value: 2 }]);
  check("asking for the second gives the second",
        /2 of 2/.test((await of("K1")).note || ""), (await of("K1")).note);
  // Past the end is the last one rather than a failure: a number that walked
  // off the end of a list is a number to clamp, not a model to break.
  await run([{ op: "set", id: "K1", key: "answer", value: 9 }]);
  check("and past the end is the last one, not an error",
        !(await of("K1")).error && /2 of 2/.test((await of("K1")).note || ""),
        (await of("K1")).note);
  await run([{ op: "set", id: "K1", key: "answer", value: 1 },
             { op: "set", id: "K1", key: "askFirst", value: 0 },
             { op: "set", id: "K1", key: "askSecond", value: 0 }]);
}

console.log("\n4. tangent to three - the Apollonius node");
await run([
  { op: "add", type: "Point", id: "PC", name: "C" },
  { op: "set", id: "PC", key: "x", value: 70 },
  { op: "set", id: "PC", key: "y", value: 120 },
  { op: "set", id: "PC", key: "z", value: 0 },
  { op: "add", type: "Plane", id: "PL3", name: "Third",
    refs: { origin: "PC", normal: "VZ" } },
  { op: "add", type: "Circle", id: "C3", name: "Three", refs: { plane: "PL3" } },
  { op: "set", id: "C3", key: "radius", value: 50 },
  { op: "add", type: "ConstrainedCircle", id: "K2", name: "Apollonius",
    refs: { plane: "PLANE1", first: "C1", second: "C2", third: "C3" } },
  { op: "set", id: "K2", key: "kind", value: 1 },
]);
{
  const k = await of("K2");
  check("tangent to three built", k && !k.error, (k || {}).error);
  const many = Number((((k || {}).note || "").match(/of (\d+)/) || [])[1]);
  check("and the documentation's several answers came back",
        many >= 4, (k || {}).note);
}

console.log("\n5. through three points, whole and trimmed to the arc");
await run([
  { op: "add", type: "ConstrainedCircle", id: "K3", name: "Through three",
    refs: { plane: "PLANE1", first: "PA", second: "PB", third: "PC" } },
  { op: "set", id: "K3", key: "kind", value: 5 },
]);
{
  const k = await of("K3");
  check("through three points built", k && !k.error, (k || {}).error);
  check("exactly one answer", k && /one answer/.test(k.note || ""), k && k.note);
  await run([{ op: "set", id: "K3", key: "trim", value: 1 }]);
  const arc = await of("K3");
  check("and the arc through them builds too", arc && !arc.error, (arc || {}).error);
}

console.log("\n6. a spline is refused by name rather than approximated");
await run([
  { op: "add", type: "Point", id: "PD", name: "D" },
  { op: "set", id: "PD", key: "x", value: 40 },
  { op: "set", id: "PD", key: "y", value: 90 },
  { op: "add", type: "Interpolate", id: "SP", name: "Wiggle", refs: { points: "PA" } },
  { op: "connect", id: "SP", key: "points", from: "PD" },
  { op: "connect", id: "SP", key: "points", from: "PC" },
  { op: "add", type: "ConstrainedCircle", id: "K4", name: "Against a spline",
    refs: { plane: "PLANE1", first: "SP", second: "C2" } },
  { op: "set", id: "K4", key: "kind", value: 0 },
  { op: "set", id: "K4", key: "radius", value: 60 },
]);
{
  const k = await of("K4");
  check("it fails rather than pretending",
        k && !!k.error, (k || {}).error || "no error at all");
  check("and says why, in words a person can act on",
        k && /point|straight|circle/.test(k.error || ""), (k || {}).error);
}

console.log("\n7. lines from constraints");
await run([
  { op: "add", type: "ConstrainedLine", id: "L1", name: "Between them",
    refs: { plane: "PLANE1", first: "C1", second: "C2" } },
  { op: "set", id: "L1", key: "kind", value: 0 },
  { op: "set", id: "L1", key: "length", value: 400 },
]);
{
  const l = await of("L1");
  check("tangent to two circles built", l && !l.error, (l || {}).error);
  check("four of them, as the documentation's pictures say",
        l && /of 4 answers/.test(l.note || ""), l && l.note);
}

console.log("\n8. the bisector, and what it turns out to be");
await run([
  { op: "add", type: "Bisector", id: "B1", name: "Between two points",
    refs: { plane: "PLANE1", first: "PA", second: "PB" } },
]);
{
  const b = await of("B1");
  check("between two points it is a line", b && !b.error && /line/.test(b.note || ""),
        (b || {}).error || (b || {}).note);
}
await run([
  { op: "add", type: "Bisector", id: "B2", name: "Line and a point",
    refs: { plane: "PLANE1", first: "C1", second: "PC" } },
  { op: "set", id: "B2", key: "span", value: 400 },
]);
{
  const b = await of("B2");
  check("and between a circle and a point outside it, a hyperbola",
        b && !b.error && /hyperbola/.test(b.note || ""),
        (b || {}).error || (b || {}).note);
}

console.log("\n9. the answers are real geometry, not just a note");
{
  // The tangent circle of radius 120 has to BE 120: measured off the shape the
  // kernel built, through the same Measure node a person would use.
  await run([
    { op: "add", type: "Measure", id: "M1", name: "How long", refs: { shape: "K1" } },
    { op: "set", id: "M1", key: "quantity", value: 0 }]);
  const m = await of("M1");
  const length = Number((((m || {}).data || {}).preview || "").match(/[\d.]+/));
  check("its length is a circle of radius 120's circumference",
        near(length, 2 * Math.PI * 120, 1),
        (m || {}).error || "read " + length + ", wanted "
          + (2 * Math.PI * 120).toFixed(4));
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
