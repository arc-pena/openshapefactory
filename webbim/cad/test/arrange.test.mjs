// Living in the tree: duplicating, and putting things in order.
//
// Two edits a person makes constantly once the model works, and neither was
// here. Copying a column and moving it up two rows are not modelling - they are
// what you do so that the modelling can be read tomorrow.
//
// The one thing worth saying about REORDERING is that it is safe, and why: a
// feature's identity is a string stored on it, not its position, and a wire is
// a pointer to a label rather than a path to one. So nothing that refers to a
// feature refers to where it sits, and the rebuild order is the dependency
// graph rather than the tree - which is why a feature can be dragged above the
// thing it is built from and still build after it.
//
// The one thing worth saying about DUPLICATING is what happens to a wire that
// leaves the selection. Instantiating a set from a file CUTS those and declares
// them as inputs, because the point of reuse is that the somewhere else is
// different. Duplicating KEEPS them, because the point of a duplicate is
// another one of these.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { duplicateEdits } from "../src/reuse.js";
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
const fresh = async () => mdl.run({ op: "model", model: {
  format: "ocaf-parametric-model", version: 1, name: "Arrange", units: "mm", features: [] } });
await fresh();
const tree = async () => (await kernel.tree()).tree.features;
const at = async id => (await tree()).find(f => f.id === id);
const order = async () => (await tree()).map(f => f.id);
const add = async (type, more = {}) => (await mdl.run({ op: "add", type, ...more })).id;
//! THE REAL CATALOGUE. Without it a choice stored as its label - "Blind" on an
//! extrude's limit - has nothing to say it is a choice, and falls through to
//! the edit for a script. Both callers in the program pass this; a test that
//! did not was testing a road nobody drives.
const schema = await kernel.schema();
const spec = type => schema.types.find(t => t.type === type);
const set = (id, key, value) => mdl.run({ op: "set", id, key, value });

console.log("1. moving a row up and down");
{
  const a = await add("Point", { name: "A" });
  const b = await add("Point", { name: "B" });
  const c = await add("Point", { name: "C" });
  check("they start in the order they were made",
        (await order()).join(",") === [a, b, c].join(","), (await order()).join(","));
  await mdl.run({ op: "reorder", ids: [c], before: a });
  check("C moves to the front", (await order()).join(",") === [c, a, b].join(","),
        (await order()).join(","));
  await mdl.run({ op: "reorder", ids: [c], after: b });
  check("and back to the end", (await order()).join(",") === [a, b, c].join(","),
        (await order()).join(","));
  //! Several at once, keeping the order they were given - which is what a
  //! block selection moved up two rows has to do.
  await mdl.run({ op: "reorder", ids: [b, c], before: a });
  check("two move together, in the order given",
        (await order()).join(",") === [b, c, a].join(","), (await order()).join(","));
  //! And the nonsense cases refuse rather than scrambling the tree.
  let refused = null;
  try { await mdl.run({ op: "reorder", ids: [a], before: a }); }
  catch (error) { refused = error.message; }
  check("a feature cannot be moved before itself", !!refused, refused || "(allowed)");
}

console.log("\n2. reordering changes nothing but the order");
{
  await fresh();
  const pt = await add("Point");
  const up = await add("Vector"); await set(up, "dx", 0); await set(up, "dz", 1);
  const plane = await add("Plane", { refs: { origin: pt, normal: up } });
  const disc = await add("Circle", { refs: { plane } });
  await set(disc, "radius", 120);
  const pipe = await add("Extrude", { refs: { profile: disc, direction: up } });
  await set(pipe, "distance", 300);
  const before = await at(pipe);
  check("the extrude builds", !before.error, before.error || "built");
  const wasRevision = before.revision;
  //! MOVED ABOVE WHAT IT IS BUILT FROM. CATIA forbids this arrangement; this
  //! only declines to pretend the tree is the graph, so the feature stays
  //! built and stays wired.
  await mdl.run({ op: "reorder", ids: [pipe], before: pt });
  const after = await at(pipe);
  check("moved to the top of the tree, it is still first",
        (await order())[0] === pipe, (await order()).join(","));
  check("  and still built", !after.error, after.error || "built");
  check("  and still wired to the circle it was wired to",
        after.refs.profile === disc, JSON.stringify(after.refs));
  check("  and was not rebuilt, because nothing about it changed",
        after.revision === wasRevision, after.revision + " vs " + wasRevision);
  //! And it survives the file, because the file is written in tree order.
  const saved = await kernel.model();
  check("the model file is written in the new order",
        saved.features[0].id === pipe, saved.features.map(f => f.id).join(","));
  await mdl.run({ op: "model", model: saved });
  check("  and reads back in it", (await order())[0] === pipe, (await order()).join(","));
}

console.log("\n3. duplicating, and what happens to the wires");
{
  await fresh();
  const pt = await add("Point");
  const up = await add("Vector"); await set(up, "dx", 0); await set(up, "dz", 1);
  const plane = await add("Plane", { refs: { origin: pt, normal: up } });
  const disc = await add("Circle", { refs: { plane } });
  await set(disc, "radius", 90);
  const pipe = await add("Extrude", { refs: { profile: disc, direction: up } });
  await set(pipe, "distance", 250);

  const model = await kernel.model();
  const here = await tree();
  const plan = duplicateEdits(model, [pipe], {
    taken: new Set(here.map(f => f.id)), takenNames: new Set(here.map(f => f.name)),
    spec,
  });
  await mdl.runAll(plan.edits);
  const copy = await at(plan.made[0]);
  check("a copy appears", !!copy, JSON.stringify(plan.made));
  check("  with a new id", copy.id !== pipe, copy.id);
  check("  and a new name", copy.name !== (await at(pipe)).name, copy.name);
  //! THE WIRE THAT LEFT THE SELECTION IS KEPT. Only the extrude was copied, so
  //! its profile still points at the one circle there is - which is what
  //! "another one of these" means, and the opposite of what instantiating a
  //! set from a file does.
  check("  reading the SAME circle, because only the extrude was copied",
        copy.refs.profile === disc, JSON.stringify(copy.refs));
  check("  and it builds", !copy.error, copy.error || "built");
  check("  carrying the value that was set on it",
        Math.abs(copy.values.distance - 250) < 1e-9, String(copy.values.distance));

  //! COPIED TOGETHER, WIRED TOGETHER. The same two features duplicated as a
  //! pair give a copy of the extrude reading the COPY of the circle - which
  //! falls out of the same rule rather than being a second one.
  const both = duplicateEdits(await kernel.model(), [disc, pipe], {
    taken: new Set((await tree()).map(f => f.id)),
    takenNames: new Set((await tree()).map(f => f.name)),
    spec,
  });
  await mdl.runAll(both.edits);
  const pairCircle = both.renamed[disc], pairPipe = both.renamed[pipe];
  const madePipe = await at(pairPipe);
  check("duplicated as a pair, the copy reads the COPY",
        madePipe.refs.profile === pairCircle,
        madePipe.refs.profile + " vs " + pairCircle);
  check("  and both build", !madePipe.error && !(await at(pairCircle)).error,
        madePipe.error || (await at(pairCircle)).error || "built");
}

console.log("\n4. a folder brings its contents");
{
  await fresh();
  const pt = await add("Point");
  const folder = await add("GeometricalSet", { name: "Bay" });
  const one = await add("Point", { name: "Near" });
  const two = await add("Point", { name: "Far" });
  await set(two, "x", 400);
  await mdl.runAll([{ op: "group", id: one, into: folder },
                    { op: "group", id: two, into: folder }]);
  const plan = duplicateEdits(await kernel.model(), [folder], {
    taken: new Set((await tree()).map(f => f.id)),
    takenNames: new Set((await tree()).map(f => f.name)),
    spec,
  });
  await mdl.runAll(plan.edits);
  const copied = plan.renamed[folder];
  const inside = (await tree()).filter(f => f.parent === copied);
  check("the folder is copied", !!(await at(copied)), copied);
  check("  with what was in it, not empty", inside.length === 2,
        inside.length + " inside");
  check("  and the copies are filed in the COPY, not the original",
        inside.every(f => f.parent === copied), inside.map(f => f.parent).join(","));
  check("  and carry their own values",
        Math.abs((inside.find(f => /Far/.test(f.name)) || {}).values.x - 400) < 1e-9,
        JSON.stringify(inside.map(f => [f.name, f.values.x])));
  check("the original is untouched",
        (await tree()).filter(f => f.parent === folder).length === 2,
        String((await tree()).filter(f => f.parent === folder).length));
}

console.log("\n5. moving several sets at once keeps them whole");
{
  //! THE BUG: two sets shift-selected in the tree and dropped into a third
  //! came out as one set and a pile. Shift-clicking two rows picks everything
  //! DRAWN BETWEEN them, which includes the contents of the first - the right
  //! answer for hiding, deleting and duplicating, all of which are about every
  //! feature named, and the wrong one for moving. A child whose parent is also
  //! being moved is already going where its parent goes; re-parenting it too
  //! files it straight into the destination, so the set it came out of arrives
  //! empty and its contents arrive loose beside it.
  await fresh();
  const A = await add("GeometricalSet", { name: "Bay A" });
  const B = await add("GeometricalSet", { name: "Bay B" });
  const C = await add("GeometricalSet", { name: "Holder" });
  const a1 = await add("Point", { name: "A one" });
  const a2 = await add("Point", { name: "A two" });
  const b1 = await add("Point", { name: "B one" });
  await mdl.runAll([{ op: "group", id: a1, into: A }, { op: "group", id: a2, into: A },
                    { op: "group", id: b1, into: B }]);
  //! What a shift-selection from Bay A to Bay B actually contains.
  const picked = [A, a1, a2, B];
  //! topOf, as the interface computes it - the members with no other member
  //! above them.
  const here = await tree();
  const parentOf = id => (here.find(f => f.id === id) || {}).parent || null;
  const chosen = new Set(picked);
  const roots = picked.filter(id => {
    for (let up = parentOf(id); up; up = parentOf(up)) if (chosen.has(up)) return false;
    return true;
  });
  check("the roots of that selection are the two sets",
        roots.length === 2 && roots.includes(A) && roots.includes(B),
        JSON.stringify(roots));
  await mdl.runAll(roots.map(id => ({ op: "group", id, into: C })));
  const after = await tree();
  const childrenOf = id => after.filter(f => f.parent === id).map(f => f.id);
  check("both sets are in the holder",
        childrenOf(C).includes(A) && childrenOf(C).includes(B),
        JSON.stringify(childrenOf(C)));
  check("  and only the two sets, nothing loose beside them",
        childrenOf(C).length === 2, childrenOf(C).length + " in the holder");
  check("  Bay A still holds its two points",
        childrenOf(A).length === 2, JSON.stringify(childrenOf(A)));
  check("  Bay B still holds its one",
        childrenOf(B).length === 1, JSON.stringify(childrenOf(B)));
  //! And moving every picked id, which is what it used to do, is the failure
  //! written down so it cannot come back quietly.
  await fresh();
  const D = await add("GeometricalSet", { name: "Bay" });
  const E = await add("GeometricalSet", { name: "Holder" });
  const one = await add("Point");
  await mdl.run({ op: "group", id: one, into: D });
  await mdl.runAll([{ op: "group", id: D, into: E }, { op: "group", id: one, into: E }]);
  const flat = await tree();
  check("moving a child as well as its parent is what emptied the set",
        flat.filter(f => f.parent === D).length === 0
        && flat.filter(f => f.parent === E).length === 2,
        "Bay holds " + flat.filter(f => f.parent === D).length
        + ", Holder holds " + flat.filter(f => f.parent === E).length);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
