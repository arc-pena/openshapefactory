// Deleting an idea, not just a folder; and the two new defaults.
//
// "Delete set" hands the contents back to whatever the set was in, which is
// right when you are undoing the FOLDER and wrong when you are undoing the
// WORK. A geometrical set holding a sketch, an extrude and three planes is
// usually one idea, and getting rid of the idea means getting rid of all of it
// - one command, not "delete the five things in dependency order, then delete
// the folder they were in".
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
const fresh = () => mdl.run({ op: "model", model: { format: "ocaf-parametric-model",
  version: 1, name: "Del", units: "mm", features: [] } });
await fresh();
const tree = async () => (await kernel.tree()).tree.features;
const at = async id => (await tree()).find(f => f.id === id);
const add = async (type, more = {}) => (await mdl.run({ op: "add", type, ...more })).id;
const set = (id, key, value) => mdl.run({ op: "set", id, key, value });

console.log("1. deleting a set takes what is in it, however deep");
{
  const folder = await add("GeometricalSet", { name: "Bay" });
  const inner = await add("GeometricalSet", { name: "Inner" });
  const one = await add("Point", { name: "Inside" });
  await mdl.runAll([{ op: "group", id: inner, into: folder },
                    { op: "group", id: one, into: inner }]);
  await mdl.run({ op: "delete", id: folder });
  check("the set goes", !(await at(folder)));
  check("  and the set inside it", !(await at(inner)));
  check("  and the point inside that", !(await at(one)),
        (await tree()).map(f => f.name).join(",") || "(empty)");
  //! Which is ONE op, not a list the caller had to work out. Deleting a set
  //! used to hand its contents back to whatever the set was in - ungrouping
  //! it, which is a different thing and is what moving them out is for.
}

console.log("\n2. and a wire from outside does not stop it");
{
  await fresh();
  const folder = await add("GeometricalSet", { name: "Bay" });
  const pt = await add("Point");
  const up = await add("Vector"); await set(up, "dx", 0); await set(up, "dz", 1);
  await mdl.runAll([{ op: "group", id: pt, into: folder },
                    { op: "group", id: up, into: folder }]);
  //! A plane OUTSIDE the set, reading a point inside it. That used to be
  //! refused - "Plane.1 still reads from Point.1" - which is true and is not a
  //! reason to keep the point: the plane has to hear about this sooner or
  //! later, and an empty input it can complain about is better than making
  //! somebody work out the order to take a model apart in.
  const plane = await add("Plane", { refs: { origin: pt, normal: up } });
  await mdl.run({ op: "delete", id: folder });
  check("the set and its contents go, wire or no wire",
        !(await at(folder)) && !(await at(pt)) && !(await at(up)),
        (await tree()).map(f => f.name).join(",") || "(empty)");
  const left = await at(plane);
  check("  and the plane that read into it is still there", !!left,
        left ? left.name : "gone");
  check("  with its inputs empty rather than pointing at nothing",
        !left.refs.origin && !left.refs.normal, JSON.stringify(left.refs.origin));
  check("  and says so", !!left.error, left.error || "(no complaint)");
  //! UPSTREAM IS UNTOUCHED, which is the other half of what a node editor's
  //! delete means: what the plane read from is gone, and what read FROM the
  //! plane - nothing here - would have been left alone.
  check("nothing else was taken with it", (await tree()).length === 1,
        (await tree()).map(f => f.name).join(","));
}

console.log("\n3. a point on a plane");
{
  await fresh();
  const pt = await add("Point");
  const up = await add("Vector"); await set(up, "dx", 0); await set(up, "dz", 1);
  const plane = await add("Plane", { refs: { origin: pt, normal: up } });
  const on = await add("Point", { refs: { plane } });
  await set(on, "kind", 6);
  await set(on, "h", 40);
  await set(on, "v", 25);
  const made = await at(on);
  check("it builds", !made.error, made.error || "built");
  //! The XY plane's own two directions are X and Y, so H and V land there -
  //! which is the check that they are measured in the PLANE and not in the
  //! world by accident.
  check("  40 across and 25 up the XY plane is (40, 25, 0)",
        made.data && made.data.preview === "(40, 25, 0)",
        made.data && made.data.preview);
  //! Now turn the plane on its side. The point must follow it, which three
  //! world coordinates would not.
  await set(up, "dx", 1); await set(up, "dz", 0);
  const moved = await at(on);
  check("  and it follows the plane when the plane turns",
        moved.data && moved.data.preview !== "(40, 25, 0)",
        moved.data && moved.data.preview);
  //! (0, -25, 40) is 40 up the turned plane's Y and 25 along its X, which is
  //! the same two measurements in the plane's own frame. The distance from the
  //! plane's origin is the one number that is the same either way round.
  const far = moved.data && Math.hypot(...String(moved.data.preview)
    .replace(/[()]/g, "").split(",").map(Number));
  check("  still the same distance from the plane's origin",
        Math.abs(far - Math.hypot(40, 25)) < 1e-6, String(far));
}

console.log("\n4. an extrude comes off its profile without being told");
{
  await fresh();
  const pt = await add("Point");
  const up = await add("Vector"); await set(up, "dx", 0); await set(up, "dz", 1);
  const plane = await add("Plane", { refs: { origin: pt, normal: up } });
  const sketch = await add("Sketch", { refs: { plane } });
  await kernel.setSketch(sketch, "drawing",
    { elements: [{ id: "r1", type: "rect", a: [-100, -60], b: [100, 60] }], constraints: [] });
  //! No direction wired, and none asked for: "Normal to the profile" is the
  //! default and the argument only applies when it is not.
  const pad = await add("Extrude", { refs: { profile: sketch } });
  await set(pad, "distance", 90);
  const built = await at(pad);
  check("it builds with no direction wired at all", !built.error,
        built.error || "built");
  check("  and nothing is wired into Direction", !built.refs.direction,
        JSON.stringify(built.refs.direction));
  const box = await add("Measure", { refs: { shape: pad } });
  await set(box, "quantity", 5);        // Size Z
  const tall = await at(box);
  check("  and it went 90 along the sketch's own normal",
        tall.data && Math.abs(Number(tall.data.preview) - 90) < 0.01,
        tall.data && tall.data.preview);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
