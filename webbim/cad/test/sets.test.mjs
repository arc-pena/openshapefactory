// Geometrical sets and bodies: the folder that is also a node.
//
// A set has one job that no slider can do - it has a BOUNDARY, so you can ask
// what crosses it. Everything here is that question asked from a different
// side: what feeds the contents from outside, what reads out of them, and what
// survives the set being deleted. And the thing a folder must never do is
// change the part, so that is measured too.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { branchOf, branchesIn } from "../src/ocaf.js";
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
const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {}, readLayout: () => ({}),
                      select: () => {}, selected: () => null, picked: () => [] });
const tree = async () => (await kernel.tree()).tree.features;
const at = async id => (await tree()).find(f => f.id === id);
const names = list => list.map(id => id).sort().join(",");

console.log("1. a part, then a folder put round half of it");
const BASE = { format: "ocaf-parametric-model", version: 1, name: "S", units: "mm",
  features: [
    { id: "PT", type: "Point", name: "Origin", args: { x: 0, y: 0, z: 0 } },
    { id: "VZ", type: "Vector", name: "Up", args: { dz: 1, dx: 0, dy: 0 } },
    { id: "PL", type: "Plane", name: "Ground", args: { origin: { ref: "PT" }, normal: { ref: "VZ" } } },
    { id: "CI", type: "Circle", name: "Ring", args: { plane: { ref: "PL" }, radius: 500 } },
    { id: "EX", type: "Extrude", name: "Tower",
      args: { profile: { ref: "CI" }, direction: { ref: "VZ" }, distance: 3000 } },
  ] };
await kernel.loadModel(BASE);
const volume = async id => {
  const gauge = (await kernel.addFeature("Measure", { shape: id })).id;
  await kernel.setParameter(gauge, "quantity", 2);
  const entry = await at(gauge);
  const value = entry && entry.data ? Number(entry.data.preview) : NaN;
  await kernel.deleteFeature(gauge);
  return value;
};
const before = await volume("EX");
check("the tower builds", Number.isFinite(before) && before > 0, before.toFixed(0));
//! Consumed, built and visible for every feature, so filing things away can be
//! compared against how they were rather than against an assumption.
const standing = async () => Object.fromEntries((await tree()).map(f =>
  [f.id, (f.consumedBy || "-") + "/" + (f.built ? "built" : "no") + "/" + f.visible]));
const wasStanding = await standing();

await mdl.run({ op: "add", type: "GeometricalSet", id: "GS", name: "Layout" });
check("a set is a feature like any other", !!(await at("GS")), (await at("GS")) && (await at("GS")).type);
for (const id of ["CI", "PL"]) await mdl.run({ op: "group", id, into: "GS" });
check("two things are filed in it", names((await at("GS")).contents) === "CI,PL",
  JSON.stringify((await at("GS")).contents));
check("and each one says where it lives", (await at("CI")).parent === "GS"
  && (await at("PL")).parent === "GS");
check("filing them away changed nothing about the part",
  Math.abs((await volume("EX")) - before) < 1, (await volume("EX")).toFixed(0));
{
  const now = await standing();
  const moved = Object.keys(wasStanding).filter(id => now[id] !== wasStanding[id]);
  check("and nothing about them changed - not consumed, not hidden, not unbuilt",
    moved.length === 0, moved.map(id => id + ": " + wasStanding[id] + " -> " + now[id]).join("; "));
}

console.log("\n2. what crosses the boundary");
{
  const set = await at("GS");
  // Ground stands on Origin and Up; the ring stands on Ground, which is inside.
  check("its inputs are what feeds it from outside, and only that",
    names(set.inputs) === "PT,VZ", JSON.stringify(set.inputs));
  check("and its outputs are what reads out of it",
    names(set.outputs) === "EX", JSON.stringify(set.outputs));

  const answer = await kernel.inputsOf("GS");
  check("the kernel answers the same question directly",
    names(answer.inputs.map(i => i.id)) === "PT,VZ",
    answer.inputs.map(i => i.name).join(", "));

  // Move the point in as well and it stops being an input: it is no longer
  // outside.
  await mdl.run({ op: "group", id: "PT", into: "GS" });
  check("moving a feeder inside takes it off the list",
    names((await at("GS")).inputs) === "VZ", JSON.stringify((await at("GS")).inputs));
  await mdl.run({ op: "group", id: "PT" });
  check("and taking it back out puts it back",
    names((await at("GS")).inputs) === "PT,VZ", JSON.stringify((await at("GS")).inputs));
  check("out means out - it is at the top level again", !(await at("PT")).parent);
}

console.log("\n3. a set inside a set");
{
  await mdl.run({ op: "add", type: "Body", id: "BD", name: "Solids" });
  await mdl.run({ op: "group", id: "EX", into: "BD" });
  await mdl.run({ op: "group", id: "GS", into: "BD" });
  check("a body holds the tower and the set both",
    names((await at("BD")).contents) === "EX,GS", JSON.stringify((await at("BD")).contents));
  check("its inputs are what feeds everything inside, however deep",
    names((await at("BD")).inputs) === "PT,VZ", JSON.stringify((await at("BD")).inputs));
  check("and nothing reads out of it now", (await at("BD")).outputs.length === 0,
    JSON.stringify((await at("BD")).outputs));

  let refused = "";
  try { await mdl.run({ op: "group", id: "BD", into: "GS" }); }
  catch (e) { refused = e.message; }
  check("a set cannot be put inside something it already holds", !!refused, refused);
}

console.log("\n4. the file carries it, and brings it back");
{
  const model = await kernel.model();
  const stored = model.features.find(f => f.id === "CI");
  check("a member says which set it is in, by name", stored.parent === "GS",
    JSON.stringify(stored.parent));
  await kernel.loadModel(model);
  check("it round-trips", names((await at("GS")).contents) === "CI,PL",
    JSON.stringify((await at("GS")).contents));
  check("nesting round-trips too", (await at("GS")).parent === "BD");
  check("and the part is the part it was",
    Math.abs((await volume("EX")) - before) < 1, (await volume("EX")).toFixed(0));

  // The order features are written in must not matter: a set may be written
  // after the things it holds.
  const shuffled = { ...model, features: [...model.features].reverse() };
  await kernel.loadModel(shuffled);
  check("written back to front it still comes back whole",
    names((await at("GS")).contents) === "CI,PL", JSON.stringify((await at("GS")).contents));
}

console.log("\n5. deleting a set takes what is in it");
{
  //! IT USED TO DISSOLVE. The contents were handed back to whatever the set
  //! was in and the folder vanished from under them, which is what anybody
  //! means by UNGROUPING a set and not by deleting one. Ungrouping is still
  //! there and is still called what it is: move the contents out first, which
  //! the menu offers by name, and then the empty folder goes on its own.
  //!
  //! Deleting is now the node editor's delete: what is named goes, what was
  //! inside it goes, and what read from any of that loses an input and says
  //! so. Nothing is refused.
  const kept = await tree();
  check("the set and its contents are all there to begin with",
    kept.some(f => f.id === "GS") && kept.some(f => f.id === "CI"),
    kept.map(f => f.id).join(","));
  await mdl.run({ op: "delete", id: "GS" });
  check("the set is gone", !(await at("GS")));
  check("and so are the ring and the plane that were in it",
    !(await at("CI")) && !(await at("PL")));
  //! The tower was built from the ring, so it is exactly the thing that has
  //! to hear about this - and it hears about it by losing the wire, not by
  //! stopping the delete.
  const tower = await at("EX");
  check("the tower is still in the tree", !!tower);
  check("  with the input it read from the set now empty",
    tower && !tower.refs.profile, JSON.stringify(tower && tower.refs.profile));
  check("  and it says so rather than going quiet", !!(tower && tower.error),
    (tower && tower.error) || "(silent)");

  await mdl.run({ op: "delete", id: "BD" });
  check("deleting the outer set takes the tower with it",
    !(await at("BD")) && !(await at("EX")),
    (await tree()).map(f => f.id).join(",") || "(empty)");
  check("  and leaves the datums that were never in it",
    !!(await at("PT")), (await tree()).map(f => f.id).join(",") || "(empty)");
}

console.log("\n6. one undo puts a set back where it was");
{
  //! Rebuilt first, because section 5 now deletes the ring along with the set
  //! it was in - which it did not when deleting a set dissolved it.
  await mdl.run({ op: "model", model: BASE });
  await mdl.run({ op: "add", type: "GeometricalSet", id: "G2", name: "Second" });
  await mdl.run({ op: "group", id: "CI", into: "G2" });
  check("filed away", (await at("CI")).parent === "G2");
  await mdl.run({ op: "undo" });
  check("undo takes it out again", !(await at("CI")).parent, (await at("CI")).parent);
  await mdl.run({ op: "redo" });
  check("redo puts it back", (await at("CI")).parent === "G2", (await at("CI")).parent);
}

console.log("\n7. a branch, taken out into a file of its own");
{
  // THE REASON A THING IS FILED ANYWHERE. A massing set that depends on a
  // plane filed somewhere else has to arrive with that plane, or what comes
  // out is a list rather than a document.
  await mdl.run({ op: "model", model: { format: "ocaf-parametric-model", version: 1,
    name: "Scheme", units: "mm", features: [] } });
  await mdl.run({ op: "add", type: "Point", id: "P0", name: "Datum point" });
  await mdl.run({ op: "add", type: "Vector", id: "VZ", name: "Up" });
  await mdl.run({ op: "set", id: "VZ", key: "dz", value: 1 });
  await mdl.run({ op: "add", type: "Plane", id: "PL", name: "Ground",
                  refs: { origin: "P0", normal: "VZ" } });
  await mdl.run({ op: "add", type: "GeometricalSet", id: "MASS", name: "Massing" });
  await mdl.run({ op: "add", type: "GeometricalSet", id: "SITE", name: "Site" });
  await mdl.run({ op: "add", type: "Cube", id: "TOWER", name: "Tower",
                  refs: { origin: "P0", plane: "PL" } });
  await mdl.run({ op: "add", type: "Cube", id: "PODIUM", name: "Podium",
                  refs: { origin: "P0", plane: "PL" } });
  await mdl.run({ op: "add", type: "Cube", id: "WALL", name: "Site wall",
                  refs: { origin: "P0" } });
  for (const [id, into] of [["TOWER", "MASS"], ["PODIUM", "MASS"],
                            ["WALL", "SITE"], ["P0", "SITE"], ["VZ", "SITE"], ["PL", "SITE"]])
    await mdl.run({ op: "group", id, into });

  const model = await mdl.snapshot();
  const rows = branchesIn(model);
  check("the document itself is the first branch, and it is named after the part",
        rows[0].whole && rows[0].name === "Scheme" && rows[0].holds === 8,
        JSON.stringify(rows[0]));
  check("and every set is a row under it, with what it holds",
        rows.length === 3
        && rows.find(r => r.id === "MASS").holds === 2
        && rows.find(r => r.id === "SITE").holds === 4,
        rows.map(r => r.name + ":" + r.holds).join(", "));

  const massing = branchOf(model, "MASS");
  check("taking the massing out gives a model file named after the set",
        massing.name === "Massing" && massing.format === model.format, massing.name);
  const ids = massing.features.map(f => f.id).sort();
  check("with the set, what is in it, AND what those read from",
        ids.join(",") === "MASS,P0,PL,PODIUM,TOWER,VZ", ids.join(","));
  check("and it says which ones it had to bring in from outside",
        massing.branch.brought.sort().join(",") === "P0,PL,VZ",
        massing.branch.brought.join(","));
  check("the site wall, which the massing does not read from, is left behind",
        !ids.includes("WALL"));
  check("what came from another set lands at the top rather than under a set that did not come",
        !massing.features.find(f => f.id === "PL").parent,
        String(massing.features.find(f => f.id === "PL").parent));
  check("while what was in the branch keeps its filing",
        massing.features.find(f => f.id === "TOWER").parent === "MASS");

  // AND IT REBUILDS, which is the whole claim.
  await mdl.run({ op: "model", model: massing });
  const rebuilt = await tree();
  check("the branch opens as a document and every feature in it builds",
        rebuilt.length === 6 && rebuilt.every(f => !f.error),
        rebuilt.map(f => f.name + (f.error ? " FAILED: " + f.error : "")).join(" | "));
  check("and the tower is still on the plane it was on",
        (await at("TOWER")).built && !(await at("TOWER")).error);

  check("asking for the whole thing gives the whole thing back",
        branchOf(model, null).features.length === model.features.length);
  check("asking for a set that is not there gives nothing rather than an empty file",
        branchOf(model, "NOPE") === null);
  check("two branches at once come out together",
        branchOf(model, ["MASS", "SITE"]).features.length === 8,
        String(branchOf(model, ["MASS", "SITE"]).features.length));
  check("and a model with no sets in it lists only itself",
        branchesIn({ name: "Bare", features: [] }).length === 1);
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall checks passed");
process.exit(failures ? 1 : 0);
