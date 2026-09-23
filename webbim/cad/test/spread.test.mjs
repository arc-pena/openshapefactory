// Lists arriving on a feature, and what it does with them.
//
// A number that came down a wire from a Series is not one number. It is
// twenty-eight, and until this existed the feature read the first of them and
// dropped the rest: the Series was wired up, the slider showed -97, and one
// curve came out where twenty-eight were asked for.
//
// The rules below are Grasshopper's, under Grasshopper's names, because
// anybody who wants this already knows them:
//
//   longest    as many rows as the longest list; a shorter one repeats its
//              last value. The default.
//   shortest   as many rows as the shortest; the surplus is dropped.
//   cross      every combination.
//
// The numbers here are all countable on paper: 4 and 2 give 4, 2 and 8.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { spreadRows, MATCHES } from "../src/ocaf.js";
import { readFileSync } from "fs";

const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const init = (await import(DIR + "/replicad_single.js")).default;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};

console.log("1. the rows, before any geometry is involved");
{
  //! spreadRows is pure arithmetic and worth checking as arithmetic: it is
  //! what decides how many times every driver in the catalogue runs.
  check("no lists is one row and no picks",
        JSON.stringify(spreadRows([])) === "[null]", JSON.stringify(spreadRows([])));
  const two = [{ key: "a", count: 4 }, { key: "b", count: 2 }];
  const longest = spreadRows(two, "longest");
  check("longest takes the longer of the two", longest.length === 4, String(longest.length));
  check("  and the shorter one repeats its last value",
        longest[3].b === 1 && longest[2].b === 1 && longest[1].b === 1,
        JSON.stringify(longest.map(r => r.b)));
  check("  rather than wrapping round to the first",
        longest[2].b !== 0, JSON.stringify(longest.map(r => r.b)));
  const shortest = spreadRows(two, "shortest");
  check("shortest takes the shorter", shortest.length === 2, String(shortest.length));
  check("  and drops the surplus of the longer",
        shortest.every(r => r.a < 2), JSON.stringify(shortest.map(r => r.a)));
  const cross = spreadRows(two, "cross");
  check("cross takes every combination", cross.length === 8, String(cross.length));
  check("  and each one exactly once",
        new Set(cross.map(r => r.a + ":" + r.b)).size === 8,
        String(new Set(cross.map(r => r.a + ":" + r.b)).size));
  check("longest is the default", MATCHES[0] === "longest", MATCHES[0]);
}

const kernel = await createWasmKernel({ initModule: init,
                                        wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                      select: () => {}, selected: () => null });
await mdl.run({ op: "model", model: { format: "ocaf-parametric-model", version: 1,
                                      name: "Spread", units: "mm", features: [] } });
const at = async id => (await kernel.tree()).tree.features.find(f => f.id === id);
const add = async (type, more = {}) => (await mdl.run({ op: "add", type, ...more })).id;
const set = (id, key, value) => mdl.run({ op: "set", id, key, value });
const items = async id => {
  const entry = await at(id);
  if (entry.error) return { error: entry.error };
  const said = /^(\d+) items?/.exec(entry.note || "");
  return { count: said ? Number(said[1]) : 1, note: entry.note || "" };
};

const PT = await add("Point");
const VZ = await add("Vector"); await set(VZ, "dx", 0); await set(VZ, "dz", 1);
const PL = await add("Plane", { refs: { origin: PT, normal: VZ } });

console.log("\n2. one list on one input, which is the case that started this");
{
  //! The file that came in: a polyline, a Series wired into the offset's
  //! distance, and one curve where twenty-eight were meant.
  const run = [];
  for (const [x, y] of [[0, 0], [69, -433], [-551.5, -497], [-733, 564.5], [261.5, 712.5]]) {
    const p = await add("Point");
    await set(p, "x", x); await set(p, "y", y); await set(p, "z", 0);
    run.push(p);
  }
  const line = await add("Polyline");
  await kernel.setReference(line, "points", null, true);
  for (const p of run) await kernel.setReference(line, "points", p);

  const series = await add("Series", { name: "Offsets" });
  await set(series, "start", 120); await set(series, "step", 120); await set(series, "count", 8);
  const family = await add("ParallelCurve", { refs: { curve: line } });
  await kernel.setReference(family, "distance", series);
  const got = await items(family);
  check("eight distances make eight curves", got.count === 8, got.error || got.note);
  //! And the shapes are really there, not just the count in the note: every
  //! one of the eight is a wire of its own in the compound.
  const drawn = await kernel.picks(family, "edge");
  check("  and eight runs are drawn, not one",
        (drawn.items || []).length >= 8, (drawn.items || []).length + " edge items");
  //! One value down a wire is still one build, which is the behaviour every
  //! model saved before this existed depends on.
  const one = await add("Number", { name: "Just one" });
  await set(one, "value", 250);
  const single = await add("ParallelCurve", { refs: { curve: line } });
  await kernel.setReference(single, "distance", one);
  const only = await items(single);
  check("one value down a wire is still one build",
        !/items/.test(only.note || ""), only.error || only.note || "(no note)");
}

console.log("\n3. two lists on one feature - the three rules");
{
  const four = await add("Series", { name: "Four" });
  await set(four, "start", 40); await set(four, "step", 40); await set(four, "count", 4);
  const two = await add("Series", { name: "Two" });
  await set(two, "start", 60); await set(two, "step", 90); await set(two, "count", 2);
  const box = await add("Cube", { refs: { origin: PT } });
  await kernel.setReference(box, "dx", four);
  await kernel.setReference(box, "dz", two);
  const entry = await at(box);
  check("both lists are seen",
        entry.lists && entry.lists.dx === 4 && entry.lists.dz === 2,
        JSON.stringify(entry.lists));
  for (const [match, want] of [["longest", 4], ["shortest", 2], ["cross", 8]]) {
    await mdl.run({ op: "spread", id: box, match });
    const got = await items(box);
    check(match + " gives " + want, got.count === want, got.error || got.note);
  }
  //! And the setting survives the model file, which is what makes it part of
  //! the document rather than part of this session.
  await mdl.run({ op: "spread", id: box, match: "cross" });
  const saved = await kernel.model();
  const stored = (saved.features || []).find(f => f.id === box);
  check("it is written into the model file",
        stored && stored.spread && stored.spread.match === "cross",
        JSON.stringify(stored && stored.spread));
  //! Only where somebody chose something: a file with the default on every
  //! feature is a file nobody can read a diff of.
  const plain = (saved.features || []).find(f => f.id === PL);
  check("  and left off the features that never chose",
        plain && plain.spread === undefined, JSON.stringify(plain && plain.spread));
  await mdl.run({ op: "model", model: saved });
  const back = await items(box);
  check("  and comes back the same on reload", back.count === 8, back.error || back.note);
}

console.log("\n4. a row that will not build is skipped and counted");
{
  //! Grasshopper's behaviour and the right one: twenty-eight setbacks off one
  //! curve, four of which have nowhere to go, should give twenty-four
  //! setbacks and a word about the four - not a refusal.
  //!
  //! THE PRECONDITION IS PART OF THE ROW. It reads the same numbers the build
  //! does, so asked once before the loop it was asked about row zero and
  //! answered for all of them: a Series starting at 0 wired into a cube's
  //! height refused all eight boxes because the first was flat.
  const fromZero = await add("Series", { name: "From zero" });
  await set(fromZero, "start", 0); await set(fromZero, "step", 90); await set(fromZero, "count", 2);
  const box = await add("Cube", { refs: { origin: PT } });
  await kernel.setReference(box, "dz", fromZero);
  const got = await items(box);
  check("the flat one is skipped and the other is built", got.count === 1,
        got.error || got.note);
  check("  and the note says how many would not build",
        /1 item of 2 - 1 would not build/.test(got.note || ""), got.note || got.error);
  //! All of them failing IS an error, because then there is nothing to show.
  const allFlat = await add("Series", { name: "All flat" });
  await set(allFlat, "start", 0); await set(allFlat, "step", 0); await set(allFlat, "count", 3);
  const none = await add("Cube", { refs: { origin: PT } });
  await kernel.setReference(none, "dz", allFlat);
  const empty = await items(none);
  check("but every row failing is an error, not an empty answer",
        !!empty.error, empty.error || empty.note);
  check("  and the note is cleared rather than left over",
        !(await at(none)).note, (await at(none)).note || "(cleared)");
}

console.log("\n5. it multiplies downstream on its own");
{
  //! The reason the answer is a COMPOUND and not something new: extruding a
  //! compound of six wires gives six solids, and the Extrude driver was not
  //! told about any of this.
  const sketch = await add("Sketch", { refs: { plane: PL } });
  await kernel.setSketch(sketch, "drawing",
    { elements: [{ id: "r1", type: "rect", a: [-300, -200], b: [300, 200] }], constraints: [] });
  const series = await add("Series");
  await set(series, "start", 40); await set(series, "step", 40); await set(series, "count", 6);
  const family = await add("ParallelCurve", { refs: { curve: sketch } });
  await kernel.setReference(family, "distance", series);
  check("six setbacks", (await items(family)).count === 6, (await items(family)).note);
  const wall = await add("Extrude", { refs: { profile: family, direction: VZ } });
  await set(wall, "distance", 120);
  const built = await at(wall);
  check("extruding them builds", !built.error, built.error || built.note || "built");
  const faces = await kernel.picks(wall, "face");
  //! Six closed rectangles extruded is six boxes: six faces each.
  check("  and gives six solids' worth of faces, not one",
        (faces.items || []).length === 36, (faces.items || []).length + " faces");
}

console.log("\n6. a driver that reads its own lists is left alone");
{
  //! Point, Math, Expression and the two Evaluate nodes call F.reals and pair
  //! up x, y and z themselves, and have done since before this existed.
  //! Iterated from outside as well they would spread over their lists twice:
  //! a Point fed twenty-eight x values would come back as seven hundred and
  //! eighty-four points.
  const xs = await add("Series", { name: "Xs" });
  await set(xs, "start", 0); await set(xs, "step", 100); await set(xs, "count", 7);
  const row = await add("Point", { name: "A row of points" });
  await kernel.setReference(row, "x", xs);
  const entry = await at(row);
  check("seven x values make seven points, not forty-nine",
        entry.data && entry.data.count === 7,
        JSON.stringify(entry.data && entry.data.count));
  check("  and no error", !entry.error, entry.error || "none");
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
