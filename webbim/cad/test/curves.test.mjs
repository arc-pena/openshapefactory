// The drawn curve family, measured.
//
// A rectangle of 240 by 160 has a perimeter of 800 and no other number will
// do. Round its corners by 20 and it loses exactly four times (2r - pi r / 2),
// because each corner gives up two straight bits of r and gains a quarter
// circle. A slot 240 long and 80 across is two straights of 160 and a whole
// circle of radius 40. Every check here is a number that can be written down
// before the kernel is asked, which is the only kind of check worth having.
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
//! How long a curve is, through the Measure node - the shape's own length,
//! read off the B-Rep rather than off the numbers that made it.
let measured = 0;
const lengthOf = async id => {
  const m = "MM" + (++measured);
  await run([{ op: "add", type: "Measure", id: m, name: m, refs: { shape: id } },
             { op: "set", id: m, key: "quantity", value: 0 }]);
  const got = await of(m);
  if (got && got.error) return NaN;
  return Number((((got || {}).data || {}).preview || "").match(/[\d.]+/));
};

await mdl.run({ op: "model", model: { format: "ocaf-parametric-model",
  version: 1, name: "Curves", units: "mm", features: [] } });
await run([
  { op: "add", type: "Point", id: "P0", name: "Origin" },
  { op: "add", type: "Vector", id: "VZ", name: "Z" },
  { op: "set", id: "VZ", key: "dz", value: 1 },
  { op: "add", type: "Plane", id: "PL", name: "XY", refs: { origin: "P0", normal: "VZ" } },
  { op: "add", type: "Point", id: "UP", name: "Two metres up" },
  { op: "set", id: "UP", key: "x", value: 300 },
  { op: "set", id: "UP", key: "y", value: 0 },
  { op: "set", id: "UP", key: "z", value: 2000 },
]);

console.log("1. a circle stands where it is told, and the plane means what you say");
await run([
  { op: "add", type: "Circle", id: "C1", name: "Up there", refs: { plane: "PL" } },
  { op: "set", id: "C1", key: "radius", value: 50 },
  { op: "connect", id: "C1", key: "centre", from: "UP" },
]);
{
  check("it built", !(await of("C1")).error, (await of("C1")).error);
  check("and it is a circle of radius 50",
        near(await lengthOf("C1"), 2 * Math.PI * 50, 0.01));
  // The plane only says which way it faces, so the circle is two metres up.
  const zed = async () => {
    const m = "ZZ" + (++measured);
    await run([{ op: "add", type: "Measure", id: m, name: m, refs: { shape: "C1" } },
               { op: "set", id: m, key: "quantity", value: 5 }]);
    return Number(((((await of(m)) || {}).data || {}).preview || "").match(/[\d.]+/));
  };
  check("and it is flat, whatever height it is at", near(await zed(), 0, 1e-6));
  await run([{ op: "set", id: "C1", key: "onPlane", value: 1 }]);
  check("dropped onto the plane it is still a circle of radius 50",
        near(await lengthOf("C1"), 2 * Math.PI * 50, 0.01));
  check("and it did not fail on the way",
        !(await of("C1")).error, (await of("C1")).error);
}

console.log("\n2. a circle sized by a point it passes through");
await run([
  { op: "set", id: "C1", key: "onPlane", value: 0 },
  { op: "set", id: "C1", key: "kind", value: 1 },
  { op: "connect", id: "C1", key: "through", from: "P0" },
]);
{
  const c = await of("C1");
  check("it built", !c.error, c.error);
  // The centre is at (300, 0, 2000) and the point is the world origin; on the
  // circle's own plane that is 300 away, so the radius is 300 - NOT the 2022
  // the two points are apart in space.
  check("the radius is measured on the plane, not through the air",
        near(await lengthOf("C1"), 2 * Math.PI * 300, 0.1),
        (c.note || "") + "  length " + (await lengthOf("C1")));
}

console.log("\n3. an ellipse, whole and as an arc");
await run([
  { op: "add", type: "Ellipse", id: "E1", name: "Oval", refs: { plane: "PL" } },
  { op: "set", id: "E1", key: "major", value: 100 },
  { op: "set", id: "E1", key: "minor", value: 100 },
]);
{
  // An ellipse whose two radii are equal is a circle, and a circle's
  // circumference is a number nobody can argue with.
  check("with both radii the same it is a circle",
        near(await lengthOf("E1"), 2 * Math.PI * 100, 0.05));
  await run([{ op: "set", id: "E1", key: "minor", value: 60 },
             { op: "set", id: "E1", key: "trim", value: 1 },
             { op: "set", id: "E1", key: "from", value: 0 },
             { op: "set", id: "E1", key: "to", value: 180 }]);
  const half = await lengthOf("E1");
  await run([{ op: "set", id: "E1", key: "trim", value: 0 }]);
  const whole = await lengthOf("E1");
  // AGAINST THE ARITHMETIC, NOT AGAINST ITSELF. The perimeter of an ellipse
  // is an elliptic integral, so it is integrated here to as many places as
  // anybody could want and the kernel is measured against THAT.
  //
  // Worth knowing what that turns up: the half arc comes back exact to four
  // places, and the whole closed ellipse comes back 0.05 per cent long. The
  // geometry is the same gp_Elips either way - it is the length of a CLOSED
  // conic edge that OpenCascade integrates a little coarsely. So the arc is
  // held to four places and the whole to a tenth of a per cent, and the
  // difference is written down rather than papered over with one loose
  // tolerance for both.
  let exact = 0;
  const N = 400000;
  for (let i = 0; i < N; i++) {
    const u = ((i + 0.5) / N) * Math.PI * 2;
    exact += Math.hypot(100 * Math.sin(u), 60 * Math.cos(u)) * (Math.PI * 2 / N);
  }
  check("half of it is half of the elliptic integral, to four places",
        near(half, exact / 2, 0.001), half + " wanted " + (exact / 2).toFixed(4));
  check("and the whole of it is the whole, to a tenth of a per cent",
        near(whole, exact, exact * 0.001), whole + " wanted " + exact.toFixed(4));
  await run([{ op: "set", id: "E1", key: "minor", value: 140 }]);
  check("a short radius longer than the long one is refused",
        !!(await of("E1")).error, (await of("E1")).error);
  await run([{ op: "set", id: "E1", key: "minor", value: 60 }]);
}

console.log("\n4. a slot: two straights and a circle between them");
await run([
  { op: "add", type: "Oblong", id: "O1", name: "Slot", refs: { plane: "PL" } },
  { op: "set", id: "O1", key: "length", value: 240 },
  { op: "set", id: "O1", key: "width", value: 80 },
]);
{
  const o = await of("O1");
  check("it built", !o.error, o.error);
  // 240 long, 80 across: the straights are 240 - 80 = 160 each, and the two
  // half-circles make one circle of radius 40.
  check("its length is two straights of 160 and a circle of radius 40",
        near(await lengthOf("O1"), 2 * 160 + 2 * Math.PI * 40, 0.05),
        "" + (await lengthOf("O1")) + " wanted " + (320 + 2 * Math.PI * 40).toFixed(4));
  await run([{ op: "set", id: "O1", key: "length", value: 60 }]);
  check("and shorter than it is wide is refused by name",
        /at least as long/.test((await of("O1")).error || ""), (await of("O1")).error);
  await run([{ op: "set", id: "O1", key: "length", value: 240 }]);
}

console.log("\n5. a rectangle, square-cornered and rounded");
await run([
  { op: "add", type: "Rectangle", id: "R1", name: "Sheet", refs: { plane: "PL" } },
  { op: "set", id: "R1", key: "width", value: 240 },
  { op: "set", id: "R1", key: "height", value: 160 },
]);
{
  check("square corners give a perimeter of 800",
        near(await lengthOf("R1"), 800, 0.01), "" + (await lengthOf("R1")));
  await run([{ op: "set", id: "R1", key: "radius", value: 20 }]);
  // Each corner gives up 2r of straight and gains a quarter circle: the
  // perimeter drops by 4 * (2r - pi*r/2) = 8r - 2*pi*r.
  const want = 800 - 8 * 20 + 2 * Math.PI * 20;
  check("rounding by 20 costs exactly 8r and buys back 2 pi r",
        near(await lengthOf("R1"), want, 0.02),
        (await lengthOf("R1")) + " wanted " + want.toFixed(4));
  await run([{ op: "set", id: "R1", key: "radius", value: 90 }]);
  check("a radius past half the short side is refused",
        /nothing left of the straight/.test((await of("R1")).error || ""),
        (await of("R1")).error);
  await run([{ op: "set", id: "R1", key: "radius", value: 0 }]);
}

console.log("\n6. rounding the corners of a curve after the fact");
await run([
  { op: "add", type: "FilletCurve", id: "F1", name: "Softened", refs: { curve: "R1" } },
  { op: "set", id: "F1", key: "radius", value: 20 },
]);
{
  const f = await of("F1");
  check("it built", !f.error, f.error);
  check("and it says it rounded four corners",
        /4 corners rounded/.test(f.note || ""), f.note);
  const want = 800 - 8 * 20 + 2 * Math.PI * 20;
  check("the rounded rectangle is the same length either way",
        near(await lengthOf("F1"), want, 0.05),
        (await lengthOf("F1")) + " wanted " + want.toFixed(4));
  await run([{ op: "set", id: "F1", key: "radius", value: 400 }]);
  check("a radius nothing fits says so",
        /too tight|no arc/.test(((await of("F1")).error || "") + ((await of("F1")).note || "")),
        (await of("F1")).error || (await of("F1")).note);
  await run([{ op: "set", id: "F1", key: "radius", value: 20 }]);

  // A circle has no corners, and saying so is the job.
  await run([
    { op: "add", type: "FilletCurve", id: "F2", name: "Nothing to round",
      refs: { curve: "E1" } },
    { op: "set", id: "F2", key: "radius", value: 10 }]);
  check("a curve with no corners is refused in words",
        !!(await of("F2")).error, (await of("F2")).error || "no error at all");
}

console.log("\n7. a conic, sampled");
await run([
  { op: "add", type: "Conic", id: "K1", name: "Parabola", refs: { plane: "PL" } },
  { op: "set", id: "K1", key: "focal", value: 50 },
  { op: "set", id: "K1", key: "extent", value: 200 },
]);
{
  const k = await of("K1");
  check("it built", !k.error, k.error);
  check("and says which conic it is", /parabola/.test(k.note || ""), k.note);
  // A parabola y^2 = 4fx from y = -200 to 200 with f = 50 has an arc length
  // that can be written down: 2 * [ y/2 sqrt(1 + (y/2f)^2) + f asinh(y/2f) ]
  // at y = 200, f = 50 - which is 2 * (100*sqrt(5) + 50*asinh(2)).
  const want = 2 * (100 * Math.sqrt(5) + 50 * Math.asinh(2));
  const got = await lengthOf("K1");
  check("its length is the arc length of y^2 = 4fx, to within the sampling",
        near(got, want, want * 0.001), got + " wanted " + want.toFixed(4));
  await run([{ op: "set", id: "K1", key: "kind", value: 1 }]);
  check("and the hyperbola builds too",
        !(await of("K1")).error && /hyperbola/.test((await of("K1")).note || ""),
        (await of("K1")).error || (await of("K1")).note);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
