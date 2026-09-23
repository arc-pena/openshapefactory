// A curve is a curve, and a pad off one is a surface.
//
// Everything in this program that is not a line, a circle or a conic is worked
// out as points - a Catmull-Rom through them, a Hermite blend, a parabola
// walked out along its arms, a curve pulled down onto a skin - and every one
// of them used to be handed on as the polyline it had been sampled as. A
// sketched spline came out as forty-eight straight edges, and a pad off it as
// forty-eight flat strips. The geometry really was faceted; it was not the
// display.
//
// So the check is a count, and it is one: ONE edge off each curve node, and
// ONE face off the pad. Nothing here is a tolerance.
//
// And the fillet: an arc that rounds a corner has to MEET both arms, and the
// only honest test of that is the angle between the curves where they join.
// It is measured off the built wire, at every join, for corners from twenty
// degrees to a hundred and thirty-five - because the bug that prompted this
// read one arm backwards, which turns a corner into its own supplement, and a
// corner and its supplement are the same number at exactly one angle: ninety.
// A test that only squared corners would have passed it.
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

const kernel = await createWasmKernel({ initModule: init,
                                        wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                      select: () => {}, selected: () => null });
await mdl.run({ op: "model", model: { format: "ocaf-parametric-model", version: 1,
                                      name: "Smooth", units: "mm", features: [] } });
const add = async (type, more = {}) => (await mdl.run({ op: "add", type, ...more })).id;
const set = (id, key, value) => mdl.run({ op: "set", id, key, value });
const at = async id => (await kernel.tree()).tree.features.find(f => f.id === id);
const howMany = async (id, kind) => {
  const got = await kernel.picks(id, kind);
  return got && got.items ? got.items.length : -1;
};
const point = async (x, y, z = 0) => {
  const id = await add("Point");
  await set(id, "x", x); await set(id, "y", y); await set(id, "z", z);
  return id;
};

const PT = await point(0, 0);
const VZ = await add("Vector");
await set(VZ, "dx", 0); await set(VZ, "dz", 1);
const PL = await add("Plane", { refs: { origin: PT, normal: VZ } });

console.log("1. a sketched spline is one edge, and a pad off it is one face");
{
  const SK = await add("Sketch", { refs: { plane: PL } });
  await kernel.setSketch(SK, "drawing", { elements: [
    { id: "s1", type: "spline", closed: false,
      pts: [[0, 0], [40, 60], [110, 70], [170, 10], [230, 80]] },
  ], constraints: [] });
  check("the sketch builds", !(await at(SK)).error, (await at(SK)).error);
  check("as one edge", await howMany(SK, "edge") === 1, String(await howMany(SK, "edge")));

  const EX = await add("Extrude", { refs: { profile: SK, direction: VZ } });
  await set(EX, "distance", 40);
  await set(EX, "cap", 1);
  check("and the pad off it is one face",
        await howMany(EX, "face") === 1, String(await howMany(EX, "face")));

  // A B-spline is a different path through the same code: control points
  // rather than points it passes through, de Boor rather than Catmull-Rom.
  const SB = await add("Sketch", { refs: { plane: PL } });
  await kernel.setSketch(SB, "drawing", { elements: [
    { id: "b1", type: "bspline", degree: 3, closed: false,
      ctrl: [[0, 0], [50, 120], [140, -30], [220, 90], [300, 20]] },
  ], constraints: [] });
  check("a sketched B-spline is one edge too",
        await howMany(SB, "edge") === 1, String(await howMany(SB, "edge")));
}

console.log("\n2. the curve nodes, each one edge");
{
  const a = await point(0, 0), b = await point(200, 120), c = await point(100, 220);

  const BL = await add("BlendCurve");
  await kernel.setReference(BL, "points", a);
  await kernel.setReference(BL, "points", b);
  check("a blend curve", await howMany(BL, "edge") === 1,
        (await at(BL)).error || String(await howMany(BL, "edge")));

  const IN = await add("Interpolate");
  for (const p of [a, c, b]) await kernel.setReference(IN, "points", p);
  check("an interpolated curve", await howMany(IN, "edge") === 1,
        (await at(IN)).error || String(await howMany(IN, "edge")));

  const CL = await add("Interpolate");
  for (const p of [a, c, b]) await kernel.setReference(CL, "points", p);
  await set(CL, "closed", 1);
  check("and a closed one", await howMany(CL, "edge") === 1,
        (await at(CL)).error || String(await howMany(CL, "edge")));

  const CO = await add("Conic", { refs: { plane: PL } });
  check("a parabola", await howMany(CO, "edge") === 1,
        (await at(CO)).error || String(await howMany(CO, "edge")));
  await set(CO, "kind", 1);
  check("and a hyperbola", await howMany(CO, "edge") === 1,
        (await at(CO)).error || String(await howMany(CO, "edge")));

  // A polyline is still a polyline. It is the one node here that is MEANT to
  // be segments, and quietly smoothing it would be the same mistake the other
  // way round.
  const PY = await add("Polyline");
  for (const p of [a, c, b]) await kernel.setReference(PY, "points", p);
  check("a polyline is still two segments, because that is what it is",
        await howMany(PY, "edge") === 2, String(await howMany(PY, "edge")));
}

console.log("\n3. a fillet arc meets both arms");
// Measured off the built wire rather than off the numbers that made it: the
// angle between each pair of edges where they touch, which is zero when the
// arc is tangent and is not when it is the other circle through those points.
const kit = kernel.toolkit();
const { oc, subShapes } = kit;

async function worstJoin(pts, closed, radius) {
  const one = await createWasmKernel({ initModule: init,
                                       wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
  const held = new Mdl({ kernel: one, setNode: () => {}, readLayout: () => ({}),
                         select: () => {}, selected: () => null });
  await held.run({ op: "model", model: { format: "ocaf-parametric-model", version: 1,
                                         name: "F", units: "mm", features: [] } });
  const ids = [];
  for (const [x, y] of pts) {
    const made = await held.run({ op: "add", type: "Point" });
    await held.run({ op: "set", id: made.id, key: "x", value: x });
    await held.run({ op: "set", id: made.id, key: "y", value: y });
    await held.run({ op: "set", id: made.id, key: "z", value: 0 });
    ids.push(made.id);
  }
  const line = (await held.run({ op: "add", type: "Polyline" })).id;
  for (const id of ids) await one.setReference(line, "points", id);
  if (closed) await held.run({ op: "set", id: line, key: "closed", value: 1 });
  const fillet = (await held.run({ op: "add", type: "FilletCurve",
                                   refs: { curve: line } })).id;
  await held.run({ op: "set", id: fillet, key: "radius", value: radius });
  const entry = (await one.tree()).tree.features.find(f => f.id === fillet);
  if (entry.error) return { error: entry.error };

  const kitOne = one.toolkit();
  const whole = kitOne.oc.BRepToolsWrapper.Read((await one.exportShapes("brep")).text);
  const wires = kitOne.subShapes(whole, kitOne.oc.TopAbs_ShapeEnum.TopAbs_WIRE,
                                 kitOne.oc.TopoDS.Wire);
  let worst = -1, arcs = 0, joins = 0;
  for (const wire of wires) {
    const info = kitOne.subShapes(wire, kitOne.oc.TopAbs_ShapeEnum.TopAbs_EDGE,
                                  kitOne.oc.TopoDS.Edge).map(edge => {
      const walk = new kitOne.oc.BRepAdaptor_Curve(edge);
      const first = walk.FirstParameter(), last = walk.LastParameter();
      const way = u => { const d = walk.DN(u, 1);
        const m = Math.hypot(d.X(), d.Y(), d.Z()) || 1;
        return [d.X() / m, d.Y() / m, d.Z() / m]; };
      const spot = u => { const p = walk.Value(u); return [p.X(), p.Y(), p.Z()]; };
      return { p0: spot(first), p1: spot(last), t0: way(first), t1: way(last),
               kind: String(walk.GetType()) };
    });
    const round = info.filter(i => i.kind === "GeomAbs_Circle").length;
    if (!round) continue;                                // not the fillet's wire
    arcs = round;
    let mine = 0, met = 0;
    for (let i = 0; i < info.length; i++)
      for (let j = 0; j < info.length; j++) {
        if (i === j) continue;
        const apart = Math.hypot(...[0, 1, 2].map(k => info[i].p1[k] - info[j].p0[k]));
        if (apart > 1e-6) continue;
        // Only where an ARC meets something. A corner the fillet gave up is
        // still a corner, and it is supposed to read as one.
        if (info[i].kind !== "GeomAbs_Circle" && info[j].kind !== "GeomAbs_Circle") continue;
        const dot = [0, 1, 2].reduce((s, k) => s + info[i].t1[k] * info[j].t0[k], 0);
        mine = Math.max(mine, Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI);
        met++;
      }
    worst = mine; joins = met;
  }
  return { worst, arcs, joins, note: entry.note };
}

for (const [name, pts, closed, radius, wantArcs] of [
  ["a square's four right angles", [[0, 0], [200, 0], [200, 200], [0, 200]], true, 40, 4],
  ["a sharp 60 degree vee", [[0, 0], [200, 0], [100, 173.205]], false, 30, 1],
  ["a shallow 135 degrees", [[0, 0], [200, 0], [341.42, 141.42]], false, 50, 1],
  ["a very sharp 20 degrees", [[0, 0], [300, 0], [281.9, 102.6]], false, 12, 1],
  ["an open chain of four corners",
   [[0, 0], [300, 0], [300, 150], [120, 260], [0, 120]], false, 35, 3],
]) {
  const got = await worstJoin(pts, closed, radius);
  if (got.error) { check(name, false, got.error); continue; }
  check(name + " rounds into " + wantArcs + (wantArcs === 1 ? " arc" : " arcs"),
        got.arcs === wantArcs, got.arcs + " arcs · " + got.note);
  check("  and every join is tangent", got.worst >= 0 && got.worst < 1e-3,
        got.joins + " joins · worst break " + got.worst.toFixed(6) + "°");
}

console.log("\n4. two fillets cannot eat the same edge twice");
// A closed shape with one very short edge in it. Both corners either side of
// that edge back off further than the edge is long, so what is left of it is
// nothing, it drops out of the wire, and the wire has a hole in it. That used
// to come back as "the rounded curve would not join up", which is true and
// tells you nothing: there is nothing wrong with any of the arcs.
{
  const pinched = [[0, 0], [300, 0], [312, 22], [150, 240]];
  const tight = await worstJoin(pinched, true, 60);
  check("it rounds what fits rather than refusing all of it",
        !tight.error && tight.arcs > 0, tight.error || (tight.arcs + " arcs · " + tight.note));
  check("and says the one it gave up was too tight",
        /too tight for 60/.test(tight.note || ""), tight.note);
  check("what it did round is still tangent",
        tight.worst >= 0 && tight.worst < 1e-3,
        tight.joins + " joins · worst break " + (tight.worst || 0).toFixed(6) + "°");

  // The same shape at a radius that fits everywhere rounds everything.
  const roomy = await worstJoin(pinched, true, 8);
  check("and at a radius that fits, every corner is rounded",
        !roomy.error && roomy.arcs === 4 && !/too tight/.test(roomy.note || ""),
        roomy.error || (roomy.arcs + " arcs · " + roomy.note));
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
