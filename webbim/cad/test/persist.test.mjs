// A pick that still means the same thing tomorrow.
//
// "Fillet this edge" is a sentence about an edge, and an edge is a thing the
// kernel enumerates - so the obvious way to write it down is "edge 7", and the
// obvious way is wrong the first time the body underneath changes and edge 7 is
// somewhere else.
//
// There are two halves to surviving that, and until now only one was here.
//
//   WHERE IT WAS.  A pick carries an anchor - the middle, the direction, the
//   size - so when the index lands on something else, the thing that IS in the
//   same place pointing the same way is taken instead. That half already
//   worked.
//
//   WHY IT WAS PICKED.  Double-clicking an edge walked the arris at the time of
//   the click and wrote down the eight edges it found. The selection was
//   stored; the REASON for it was thrown away. Rebuild with the arris in nine
//   pieces and the fillet rounds the eight it remembers, silently.
//
// What CATIA stores is the rule, and re-asks it. That is what this file is
// about: the pick is a seed, the mode is what grows from it, and the growing
// happens on every rebuild.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { growPicks, PICK_MODES } from "../src/subshape.js";
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
                                      name: "Persist", units: "mm", features: [] } });
const at = async id => (await kernel.tree()).tree.features.find(f => f.id === id);
const add = async (type, more = {}) => (await mdl.run({ op: "add", type, ...more })).id;
const set = (id, key, value) => mdl.run({ op: "set", id, key, value });
const faceCount = async id => ((await kernel.picks(id, "face")).items || []).length;

console.log("1. the growing itself, as arithmetic");
{
  //! A square drawn as four separate edges: every one touches two others and
  //! none of them continues one. So touching takes all four from any seed and
  //! tangent takes only the seed - which is exactly the distinction asked for,
  //! and the reason both are offered.
  const square = [
    [[0, 0, 0], [100, 0, 0]], [[100, 0, 0], [100, 100, 0]],
    [[100, 100, 0], [0, 100, 0]], [[0, 100, 0], [0, 0, 0]],
  ];
  check("one takes exactly what it is given",
        JSON.stringify(growPicks("edge", square, [1], { mode: "one" })) === "[1]",
        JSON.stringify(growPicks("edge", square, [1], { mode: "one" })));
  const touching = growPicks("edge", square, [1], { mode: "touching" });
  check("touching walks the whole square from any one side",
        touching.length === 4, JSON.stringify(touching));
  const tangent = growPicks("edge", square, [1], { mode: "tangent" });
  check("tangent takes only that side, because corners are not tangencies",
        tangent.length === 1 && tangent[0] === 1, JSON.stringify(tangent));
  check("an unknown mode is treated as one, not as a crash",
        JSON.stringify(growPicks("edge", square, [2], { mode: "nonsense" })) === "[2]",
        JSON.stringify(growPicks("edge", square, [2], { mode: "nonsense" })));
  check("the three modes are the three named",
        JSON.stringify(PICK_MODES) === '["one","touching","tangent"]',
        JSON.stringify(PICK_MODES));
}

console.log("\n2. a fillet on a cylinder's rim, and then the cylinder changes");
{
  //! THE CASE THIS IS FOR. A cylinder's top rim is one circular edge in this
  //! kernel, and its side is a face with a seam. Pick the rim, fillet it,
  //! change the radius, and the fillet has to still be on the rim.
  const pt = await add("Point");
  const up = await add("Vector"); await set(up, "dx", 0); await set(up, "dz", 1);
  const plane = await add("Plane", { refs: { origin: pt, normal: up } });
  const disc = await add("Circle", { refs: { plane } });
  await set(disc, "radius", 200);
  const pipe = await add("Extrude", { refs: { profile: disc, direction: up } });
  await set(pipe, "distance", 400);
  const plain = await faceCount(pipe);
  check("the cylinder builds", plain >= 3, plain + " faces");

  //! Which edge is the top rim: the one whose anchor sits at the top.
  const edges = (await kernel.picks(pipe, "edge")).items || [];
  const top = edges.findIndex(one => Math.abs(one.near[2] - 400) < 1);
  check("its top rim is there to be picked", top >= 0, "edge " + top);

  const round = await add("Fillet", { refs: { body: pipe } });
  await set(round, "radius", 20);
  await mdl.run({ op: "pick", id: round, key: "edges", mode: "tangent",
                  picks: [{ of: pipe, kind: "edge", at: top, near: edges[top].near }] });
  const filleted = await at(round);
  check("the fillet builds on that rim", !filleted.error, filleted.error || "built");
  const rounded = await faceCount(round);
  check("  and adds a face, which is the fillet itself",
        rounded > plain, rounded + " faces vs " + plain);

  //! NOW MOVE IT. A different radius and a different height rebuild the
  //! cylinder from scratch: new edges, new indices, new anchors.
  for (const [r, h] of [[320, 400], [320, 650], [90, 650]]) {
    await set(disc, "radius", r);
    await set(pipe, "distance", h);
    const again = await at(round);
    check("r" + r + " h" + h + ": the fillet is still on the rim",
          !again.error, again.error || again.note || "built");
    check("  and still adds its face", (await faceCount(round)) > (await faceCount(pipe)),
          (await faceCount(round)) + " vs " + (await faceCount(pipe)));
  }
}

console.log("\n3. the rule is stored, not the answer");
{
  //! The test that says this is a RULE: the same pick, read back, still says
  //! how it spreads - and says it in the model file, so it survives a save.
  const pt = await add("Point");
  const box = await add("Cube", { refs: { origin: pt } });
  const round = await add("Fillet", { refs: { body: box } });
  await set(round, "radius", 8);
  const edges = (await kernel.picks(box, "edge")).items || [];
  await mdl.run({ op: "pick", id: round, key: "edges", mode: "touching",
                  picks: [{ of: box, kind: "edge", at: 0, near: edges[0].near }] });
  const entry = await at(round);
  check("one edge is stored, not the twelve it grew to",
        (entry.lists.edges || []).length === 1,
        (entry.lists.edges || []).length + " picks");
  check("  and the rule beside it",
        entry.values.edges && entry.values.edges.mode === "touching",
        JSON.stringify(entry.values.edges));
  //! Touching from one edge of a cube reaches every edge, so the fillet rounds
  //! the whole box: twelve fillets and eight corners on top of six faces.
  check("  and it rounded more than the one edge",
        (await faceCount(round)) > 7, (await faceCount(round)) + " faces");

  const saved = await kernel.model();
  const stored = (saved.features || []).find(f => f.id === round);
  check("the model file carries the rule with the picks",
        stored.args.edges && stored.args.edges.mode === "touching"
        && Array.isArray(stored.args.edges.picks),
        JSON.stringify(stored.args.edges));
  //! A pick with no rule is still written as a bare list, which is what every
  //! file saved before this looks like - and reads back the same way.
  await mdl.run({ op: "pick", id: round, key: "edges", mode: "one" });
  const plainFile = await kernel.model();
  const bare = (plainFile.features || []).find(f => f.id === round);
  check("  and writes a bare list when nothing spreads",
        Array.isArray(bare.args.edges), JSON.stringify(bare.args.edges));
  //! Both forms load.
  await mdl.run({ op: "model", model: saved });
  const back = await at(round);
  check("the object form loads back with its rule",
        back.values.edges && back.values.edges.mode === "touching",
        JSON.stringify(back.values.edges));
  await mdl.run({ op: "model", model: plainFile });
  const plainBack = await at(round);
  check("  and the bare list loads as one-by-one",
        plainBack.values.edges && plainBack.values.edges.mode === "one",
        JSON.stringify(plainBack.values.edges));
}

console.log("\n4. and when the edge really is gone, it says so");
{
  //! The failure the whole scheme is allowed to have, and it has to be loud.
  //! A pick that matches nothing is counted as lost and reported - not
  //! quietly rounded to the nearest other edge, which is the one outcome
  //! worse than an error.
  const pt = await add("Point");
  const box = await add("Cube", { refs: { origin: pt } });
  const round = await add("Fillet", { refs: { body: box } });
  await set(round, "radius", 6);
  await mdl.run({ op: "pick", id: round, key: "edges", mode: "tangent",
                  picks: [{ of: box, kind: "edge", at: 3,
                            near: [9999, 9999, 9999, 0, 0, 1, 5] }] });
  const entry = await at(round);
  const said = (entry.note || "") + " " + (entry.error || "");
  check("a pick that matches nothing is reported rather than swapped",
        /lost|not found|gone|missing/i.test(said) || !!entry.error, said.trim() || "(silent)");
}

console.log("\n5. a pick survives a parametric change of ANY size");
{
  //! THE ONE THAT CAME IN AS A BUG REPORT: a cap whose cylinder is driven by
  //! a top-level radius, filleted on its rim. Grow the radius and the fillet
  //! failed - "none of the picked edges is in this body any more" - which was
  //! never about the fillet. The PICK was being thrown away, by two absolute
  //! tolerances measured against a shape that is supposed to change:
  //!
  //!   radius 200   the body had shrunk, so 1.5 spans of it had shrunk too,
  //!                while the stored position had not moved: gap 495, limit
  //!                362, refused.
  //!   radius 900   the rim was 5.03 times the length it was picked at, and
  //!                the size test allows 4.
  //!
  //! The edge was index 2 of 3 every single time, pointing the same way to
  //! three decimal places. What was missing was the evidence that says so:
  //! how many edges the body HAD when the pick was taken. Same count, same
  //! list, same edge - and no opinion about radius at all.
  const pt = await add("Point");
  const up = await add("Vector"); await set(up, "dx", 0); await set(up, "dz", 1);
  const plane = await add("Plane", { refs: { origin: pt, normal: up } });
  const radius = await add("Number", { name: "Radius" });
  await set(radius, "value", 155);
  const disc = await add("Circle", { refs: { plane } });
  await kernel.setReference(disc, "radius", radius);
  const pipe = await add("Extrude", { refs: { profile: disc, direction: up } });
  await set(pipe, "distance", 300);

  const edges = (await kernel.picks(pipe, "edge")).items || [];
  const top = edges.findIndex(one => Math.abs(one.near[2] - 300) < 1);
  const round = await add("Fillet", { refs: { body: pipe } });
  await set(round, "radius", 12);
  //! Picked the way the interface picks it, count and all.
  await mdl.run({ op: "pick", id: round, key: "edges",
                  picks: [{ of: pipe, kind: "edge", at: top,
                            near: edges[top].near, count: edges.length }] });
  check("the fillet builds at the radius it was picked at",
        !(await at(round)).error, (await at(round)).error || "built");

  //! Fifty thousand to one, in both directions from where the pick was taken.
  const swept = [];
  for (const r of [40, 80, 155, 400, 900, 1500, 4000, 20000, 200000, 2000000]) {
    await set(radius, "value", r);
    const entry = await at(round);
    swept.push(r + (entry.error ? " FAILED" : " ok"));
    check("r=" + r + ": the fillet is still on the rim",
          !entry.error, entry.error || "built");
  }
  check("across a 50,000 to 1 range of radius", !/FAILED/.test(swept.join(" ")),
        swept.join(", "));

  //! And the guard still guards. A pick whose count does NOT match is a pick
  //! about a different topology, and the ordering of a list it was never
  //! about says nothing - so it falls through to the geometric tests rather
  //! than being trusted on its index.
  await set(radius, "value", 155);
  const wrong = await add("Fillet", { refs: { body: pipe } });
  await set(wrong, "radius", 8);
  await mdl.run({ op: "pick", id: wrong, key: "edges",
                  picks: [{ of: pipe, kind: "edge", at: 1,
                            near: [90000, 90000, 90000, 0, 0, 1, 5], count: 99 }] });
  const nonsense = await at(wrong);
  check("a pick with the wrong count and nothing near it is still refused",
        !!nonsense.error, nonsense.error || "built anyway");
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
