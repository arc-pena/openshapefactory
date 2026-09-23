// A geometrical set out of one file and into another.
//
// The claim is that a set is already a user-defined feature: what it needs
// from the rest of the document is whatever its contents read from outside
// it, and everything else about it travels. So the checks are about exactly
// that: what came across, what was left for you to supply, and that nothing
// arrived pointed at whatever happened to be lying about in the new file.
//
// Planned here as a list of edits and then RUN against a real kernel, because
// a plan that is right and a document that is wrong is not an import.
import { contentsOf, gatherInputs, inputsOf, instantiateEdits, membersOf, reachesIn,
         reachesOut, readDeclared, saysReuse, setInputGroups, setsIn,
         wiresIn } from "../src/reuse.js";
import { CATALOGUE } from "../src/ocaf.js";
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { readFileSync } from "fs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const spec = type => CATALOGUE.find(one => one.type === type) || null;

//! A file with a set in it that reads two things from outside: the plane the
//! circle stands on and the number the extrude is driven by. Written out the
//! way the modeller writes one, so if the format changes this test notices.
const FILE = {
  format: "ocaf-parametric-model", version: 1, name: "Library", units: "mm",
  features: [
    { id: "P0", type: "Point", name: "Origin", args: { kind: "Coordinates", x: 0, y: 0, z: 0 } },
    { id: "VZ", type: "Vector", name: "Up", args: { kind: "Typed in", dx: 0, dy: 0, dz: 1 } },
    { id: "PL", type: "Plane", name: "Ground",
      args: { origin: { ref: "P0" }, normal: { ref: "VZ" } } },
    { id: "NU", type: "Number", name: "Post height", args: { value: 2400 } },
    { id: "GS", type: "GeometricalSet", name: "Post", args: {} },
    { id: "PT", type: "Point", name: "Foot", parent: "GS",
      args: { kind: "Coordinates", x: 100, y: 200, z: 0 } },
    { id: "CI", type: "Circle", name: "Section", parent: "GS",
      args: { plane: { ref: "PL" }, radius: 60, centre: { ref: "PT" },
              onPlane: "Only says which way it faces", kind: "A radius" } },
    { id: "EX", type: "Extrude", name: "Shaft", parent: "GS",
      args: { profile: { ref: "CI" }, direction: { ref: "VZ" },
              distance: { value: 1200, from: "NU" } } },
  ],
};

console.log("1. what a file offers");
{
  const sets = setsIn(FILE);
  check("it finds the set", sets.length === 1 && sets[0].id === "GS",
        JSON.stringify(sets));
  check("and says how much is in it", sets[0].holds === 3, "" + sets[0].holds);
  check("and how much it would ask for", sets[0].inputs === 3, "" + sets[0].inputs);
  check("said in one line", /Post · 3 features · 3 inputs/.test(saysReuse(sets[0])),
        saysReuse(sets[0]));
  check("its contents are the three inside it",
        contentsOf(FILE, "GS").map(f => f.id).join() === "PT,CI,EX");
}

console.log("\n2. the wires, all three ways they are written");
{
  const circle = FILE.features.find(f => f.id === "CI");
  check("a plain wire is found", wiresIn(circle).some(w => w.key === "plane" && w.to === "PL"));
  check("and so is a second one on the same feature",
        wiresIn(circle).some(w => w.key === "centre" && w.to === "PT"));
  const extrude = FILE.features.find(f => f.id === "EX");
  check("a driven number is a wire too",
        wiresIn(extrude).some(w => w.key === "distance" && w.to === "NU" && w.drives));
  const inputs = inputsOf(FILE, "GS");
  check("only the ones that leave the set are inputs",
        inputs.map(one => one.key).sort().join() === "direction,distance,plane",
        JSON.stringify(inputs.map(one => one.holderName + "." + one.key)));
  check("and the one that stays inside it is not",
        !inputs.some(one => one.key === "centre"));
}

console.log("\n3. the plan");
const plan = instantiateEdits(FILE, "GS", { spec, taken: new Set(["PT"]) });
{
  check("it makes the set and everything in it",
        plan.edits.filter(e => e.op === "add").length === 4,
        "" + plan.edits.filter(e => e.op === "add").length);
  check("and files each one under it",
        plan.edits.filter(e => e.op === "group").length === 3);
  // An id already taken in this document is not taken twice.
  check("an id already in use is stepped round",
        plan.renamed.PT !== "PT", JSON.stringify(plan.renamed));
  check("the wire that stayed inside the set is remade",
        plan.edits.some(e => e.op === "connect" && e.key === "centre"
                          && e.from === plan.renamed.PT));
  check("the two that left it are not",
        !plan.edits.some(e => e.op === "connect" && (e.from === "PL" || e.from === "NU")),
        JSON.stringify(plan.edits.filter(e => e.op === "connect")));
  check("and they come back as the inputs to supply",
        plan.inputs.map(one => one.key).sort().join() === "direction,distance,plane",
        JSON.stringify(plan.inputs));
  check("a choice written in the file's own words is put back as its number",
        plan.edits.some(e => e.op === "set" && e.key === "onPlane" && e.value === 0),
        JSON.stringify(plan.edits.filter(e => e.key === "onPlane")));
  check("a driven number keeps the value it falls back on",
        plan.edits.some(e => e.op === "set" && e.key === "distance" && e.value === 1200));
  check("and the numbers travel", plan.edits.some(e => e.op === "set" && e.key === "radius"
                                                    && e.value === 60));
}

console.log("\n4. and it really runs, against a real kernel");
{
  const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
  const init = (await import(DIR + "/replicad_single.js")).default;
  const kernel = await createWasmKernel({ initModule: init,
                                          wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
  const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                        select: () => {}, selected: () => null });
  await mdl.run({ op: "model", model: { format: "ocaf-parametric-model", version: 1,
                                        name: "Host", units: "mm", features: [] } });
  // A host document with its own plane and its own number, so the imported
  // set has something to be supplied WITH.
  await mdl.runAll([
    { op: "add", type: "Point", id: "HP", name: "Origin" },
    { op: "add", type: "Vector", id: "HV", name: "Z" },
    { op: "set", id: "HV", key: "dz", value: 1 },
    { op: "add", type: "Plane", id: "HPL", name: "Site plane",
      refs: { origin: "HP", normal: "HV" } },
    { op: "add", type: "Number", id: "HN", name: "Storey" },
    { op: "set", id: "HN", key: "value", value: 3000 },
  ]);
  const tree = async () => {
    const answer = await kernel.tree();
    return (answer.tree || answer).features || [];
  };
  const taken = new Set((await tree()).map(f => f.id));
  const takenNames = new Set((await tree()).map(f => f.name));
  const here = instantiateEdits(FILE, "GS", { spec, taken, takenNames });
  await mdl.runAll(here.edits);
  const after = await tree();
  const set = after.find(f => f.id === here.id);
  check("the set arrived", !!set, here.id + " of " + after.map(f => f.id).join());
  check("with everything in it", after.filter(f => f.parent === here.id).length === 3,
        "" + after.filter(f => f.parent === here.id).length);
  const circle = after.find(f => f.name === "Section" || /Section/.test(f.name));
  check("the circle came with its radius",
        circle && circle.values.radius === 60, JSON.stringify(circle && circle.values));
  check("and still stands on the point that came with it",
        circle && circle.refs.centre === here.renamed.PT,
        JSON.stringify(circle && circle.refs));
  check("and its plane arrived empty, waiting to be supplied",
        circle && !circle.refs.plane, JSON.stringify(circle && circle.refs));
  // NOW SUPPLY IT, which is the whole point.
  const extrude = after.find(f => /Shaft/.test(f.name));
  await mdl.runAll([
    { op: "connect", id: circle.id, key: "plane", from: "HPL" },
    { op: "connect", id: extrude.id, key: "distance", from: "HN" },
    { op: "connect", id: extrude.id, key: "direction", from: "HV" },
  ]);
  const done = await tree();
  const built = done.find(f => f.id === extrude.id);
  check("supplied, the set builds", built && !built.error, (built || {}).error);
  // A circle of radius 60 extruded 3000 is pi r^2 h and nothing else.
  await mdl.runAll([
    { op: "add", type: "Measure", id: "MV", name: "Volume", refs: { shape: extrude.id } },
    { op: "set", id: "MV", key: "quantity", value: 2 }]);
  const measured = (await tree()).find(f => f.id === "MV");
  const volume = Number((((measured || {}).data || {}).preview || "").match(/[\d.]+/));
  check("and it is the right size: pi r squared, three metres tall",
        Math.abs(volume - Math.PI * 60 * 60 * 3000) < Math.PI * 60 * 60 * 3000 * 0.001,
        volume + " wanted " + (Math.PI * 3600 * 3000).toFixed(0));
  // Twice, and the second one does not tread on the first.
  const again = instantiateEdits(FILE, "GS",
    { spec, taken: new Set(done.map(f => f.id)),
      takenNames: new Set(done.map(f => f.name)) });
  await mdl.runAll(again.edits);
  const both = await tree();
  check("a second copy lands beside the first, not on it",
        both.filter(f => f.type === "GeometricalSet").length === 2,
        both.filter(f => f.type === "GeometricalSet").map(f => f.name).join(" / "));
  check("and the two have different names",
        new Set(both.filter(f => f.type === "GeometricalSet").map(f => f.name)).size === 2,
        both.filter(f => f.type === "GeometricalSet").map(f => f.name).join(" / "));
  check("the first one still builds after the second arrived",
        !(await tree()).find(f => f.id === extrude.id).error);
}

console.log("\n5. a real file, with a sketch in the set");
// THE ONE THAT GOT AWAY. A drawing is published as an OBJECT - elements and
// constraints - and the copier only ever looked at objects for a driven
// number or a hand-moved vertex, so a sketch fell straight through and the
// copy arrived with an empty one. Everything ELSE about the sketch came
// across, which is what made it look skipped rather than emptied.
//
// Checked against a real file rather than a fixture written to suit, because
// the thing that was wrong was a shape of data nobody had thought to write
// down.
{
  const real = JSON.parse(readFileSync(new URL("./files/wideflange.json",
                                               import.meta.url), "utf8"));
  const sets = setsIn(real, { isSet: one => one.type === "GeometricalSet" });
  check("the file offers its sets", sets.length >= 2,
        sets.map(one => one.name).join(", "));
  const column = sets.find(one => /Column one/i.test(one.name));
  check("including the column", !!column, sets.map(one => one.name).join(", "));

  const drawn = contentsOf(real, column.id).filter(one => one.type === "Sketch");
  check("which has a sketch in it", drawn.length === 1, "" + drawn.length);
  check("and that sketch's drawing is an object, not a string",
        drawn[0].args.drawing && typeof drawn[0].args.drawing === "object"
        && Array.isArray(drawn[0].args.drawing.elements),
        typeof drawn[0].args.drawing);
  check("with twelve lines in it, which is a wide flange",
        drawn[0].args.drawing.elements.length === 12,
        "" + drawn[0].args.drawing.elements.length);

  const made = instantiateEdits(real, column.id, { spec });
  const sketches = made.edits.filter(one => one.op === "sketch");
  check("the plan writes the drawing across", sketches.length === 1,
        "" + sketches.length);
  check("with every one of its elements",
        sketches[0].drawing.elements.length === 12,
        "" + (sketches[0].drawing.elements || []).length);
  check("and its constraints too",
        (sketches[0].drawing.constraints || []).length === 12,
        "" + (sketches[0].drawing.constraints || []).length);

  // And it really lands: run it, and ask the kernel how much sketch there is.
  const DIR2 = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
  const init2 = (await import(DIR2 + "/replicad_single.js")).default;
  const k2 = await createWasmKernel({ initModule: init2,
                                      wasmBinary: readFileSync(DIR2 + "/replicad_single.wasm") });
  const m2 = new Mdl({ kernel: k2, setNode: () => {}, readLayout: () => ({}),
                       select: () => {}, selected: () => null });
  await m2.run({ op: "model", model: { format: "ocaf-parametric-model", version: 1,
                                       name: "Host", units: "mm", features: [] } });
  await m2.runAll([
    { op: "add", type: "Point", id: "HP", name: "Here" },
    { op: "add", type: "Vector", id: "HV", name: "Z" },
    { op: "set", id: "HV", key: "dz", value: 1 },
  ]);
  const read = async () => {
    const answer = await k2.tree();
    return (answer.tree || answer).features || [];
  };
  const here = await read();
  const landed = instantiateEdits(real, column.id, {
    spec, taken: new Set(here.map(f => f.id)), takenNames: new Set(here.map(f => f.name)) });
  await m2.runAll(landed.edits);
  const after = await read();
  const sketch = after.find(f => f.type === "Sketch");
  check("the sketch arrived", !!sketch, after.map(f => f.type).join(", "));
  check("and it is not empty",
        sketch && sketch.sketch && sketch.sketch.drawing.elements.length === 12,
        sketch && sketch.sketch
          ? sketch.sketch.drawing.elements.length + " elements" : "no drawing at all");
  // Supplied with an origin, the whole column builds - and a wide flange of
  // 14.52 by 14.02 with 0.71 flanges and a 0.44 web has an area that can be
  // written down: 2*14.52*0.71 + 0.44*(14.02 - 2*0.71) = 26.1908 mm^2.
  for (const one of landed.inputs)
    if (one.key === "origin") await m2.run({ op: "connect", id: one.id, key: "origin", from: "HP" });
  const built = (await read()).find(f => f.id === (landed.renamed.SK_COL || ""));
  check("and with its origin supplied it builds",
        !!built && !built.error,
        !built ? "the sketch is not in the tree" : built.error || built.name);
  await m2.runAll([
    { op: "add", type: "Measure", id: "MA", name: "Area", refs: { shape: built.id } },
    { op: "set", id: "MA", key: "quantity", value: 1 }]);
  const area = Number((((((await read()).find(f => f.id === "MA")) || {}).data || {})
                       .preview || "").match(/[\d.]+/));
  const want = 2 * 14.52 * 0.71 + 0.44 * (14.02 - 2 * 0.71);
  check("to the area a wide flange of those dimensions has",
        Math.abs(area - want) < 0.01, area + " wanted " + want.toFixed(4));
}

console.log("\n6. two things reading one thing are one input, not two");
// THE TRAP THIS CLOSES. A set where the plane and the sketch both stood on
// the same point used to arrive as TWO empty fields. Repoint one and the
// other is quietly still pointing somewhere else, so the copy is wired to two
// different things where the original was wired to one. Once the wires are
// cut there is nothing left in the copy to say they belonged together, so it
// is written down at the moment they are cut - which is the only moment it is
// still known.
{
  const real = JSON.parse(readFileSync(new URL("./files/wideflange.json",
                                               import.meta.url), "utf8"));
  const made = instantiateEdits(real, "GSCOL", { spec });
  check("the column asks for one thing twice",
        made.inputs.filter(one => one.key === "origin").length === 2,
        JSON.stringify(made.inputs.map(one => one.holder + "." + one.key)));
  check("and the two are gathered into one input",
        made.groups.length === 1 && made.groups[0].holders.length === 2,
        JSON.stringify(made.groups));
  check("named for what it used to point at",
        made.groups[0].name === "Point.2", made.groups[0].name);
  const note = made.edits.find(one => one.op === "code" && one.key === "inputs");
  check("and written onto the set itself", !!note, "no note at all");
  check("on the set, not on something in it", note.id === made.id, note && note.id);

  const read = readDeclared(note.text);
  check("it reads back", read.length === 1, JSON.stringify(read));
  check("with both the arguments that share it",
        read[0].holders.map(one => one.id + "." + one.key).sort().join() ===
          [made.renamed.PL_BASE + ".origin", made.renamed.SK_COL + ".origin"].sort().join(),
        JSON.stringify(read[0].holders));

  // A set whose note somebody hand-edited loses the row it got wrong rather
  // than the whole list, because a panel that will not draw is worse than one
  // with a gap in it.
  check("nonsense reads back as nothing", readDeclared("not json at all").length === 0);
  check("and so does an empty note", readDeclared("").length === 0);
  check("a row with no holders is dropped",
        readDeclared(JSON.stringify({ inputs: [{ name: "x", holders: [] }] })).length === 0);
  check("a bare array is read as well as a wrapped one",
        readDeclared(JSON.stringify([{ name: "x", was: "y",
                                       holders: [{ id: "A", key: "b" }] }])).length === 1);

  // And a set with nothing shared writes no note, because there is nothing
  // to say and an empty note is a thing to explain later.
  const post = instantiateEdits(FILE, "GS", { spec });
  check("a set that shares nothing gathers into one group each",
        post.groups.every(one => one.holders.length === 1),
        JSON.stringify(post.groups.map(one => one.holders.length)));
}

console.log("\n7. a set as a node: what goes in, what comes out");
// The definition panel lists what a set asks for; the node editor draws the
// same set as ONE node with those same things as ports. Two implementations
// of "how many inputs does this set have" would sooner or later disagree in a
// way nobody can debug from a screenshot, so there is one, and it is this.
{
  // A live tree, in the shape the document hands out: parents, refs, lists,
  // driven numbers.
  const live = [
    { id: "PL", type: "Plane", name: "Ground", refs: {}, lists: {}, values: {} },
    { id: "PT", type: "Point", name: "Somewhere", refs: {}, lists: {}, values: { kind: 0 } },
    { id: "NU", type: "Number", name: "Height", refs: {}, lists: {}, values: {} },
    { id: "GS", type: "GeometricalSet", name: "Post", refs: {}, lists: {},
      values: {}, texts: {} },
    { id: "C1", type: "Circle", name: "One", parent: "GS", values: { kind: 0 },
      refs: { plane: "PL", centre: "PT" }, lists: {} },
    { id: "C2", type: "Circle", name: "Two", parent: "GS", values: { kind: 0 },
      refs: { plane: "PL", centre: null }, lists: {} },
    { id: "EX", type: "Extrude", name: "Pad", parent: "GS",
      values: { limit: 0 }, refs: { profile: "C1", direction: null }, lists: {},
      driven: { distance: "NU" } },
    { id: "FI", type: "Fillet", name: "Round it", refs: { body: "EX" }, lists: {}, values: {} },
  ];
  const spec = type => CATALOGUE.find(one => one.type === type) || null;
  const applies = (entry, arg) => {
    if (!arg.showWhen) return true;
    const now = (entry.values || {})[arg.showWhen.key];
    return arg.showWhen.any ? arg.showWhen.any.includes(now) : now === arg.showWhen.equals;
  };

  check("everything filed under the set is found",
        membersOf(live, "GS").map(one => one.id).sort().join() === "C1,C2,EX");

  const groups = setInputGroups(live, "GS", { spec, applies,
    nameOf: id => (live.find(one => one.id === id) || {}).name || id });
  const named = groups.map(one => one.name || one.rows[0].arg.label);
  check("the plane both circles stand on is ONE input",
        groups.filter(one => one.rows.length > 1).length === 1,
        JSON.stringify(groups.map(one => one.rows.map(r => r.child.id + "." + r.arg.key))));
  check("named for what it points at", named.includes("Ground"), JSON.stringify(named));
  check("and the two that read it are both on it",
        groups.find(one => one.rows.length > 1).rows
          .map(r => r.child.id).sort().join() === "C1,C2");
  check("the point only one circle stands on is its own input",
        groups.some(one => one.rows.length === 1 && one.to === "PT"));
  check("an empty argument is an input too - it is the set asking",
        groups.some(one => !one.to && one.rows[0].arg.key === "centre"));
  check("and a number driven from outside is one as well",
        groups.some(one => one.rows[0].number && one.to === "NU"),
        JSON.stringify(groups.map(one => one.rows[0].arg.key + ":" + one.to)));
  check("a wire that stays inside the set is not an input",
        !groups.some(one => one.rows.some(r => r.arg.key === "profile")),
        JSON.stringify(groups.map(one => one.rows[0].arg.key)));

  // And out the other side.
  const out = reachesOut(live, "GS", { spec, applies });
  check("what the model reads out of the set is its result",
        out.length === 1 && out[0].id === "EX" && out[0].by === "FI",
        JSON.stringify(out));

  // Declared beats live, because a declared input survives its wires being cut.
  const cut = live.map(one => one.id === "C1" || one.id === "C2"
    ? { ...one, refs: { ...one.refs, plane: null } } : one);
  const apart = setInputGroups(cut, "GS", { spec, applies });
  check("with the wires cut the two are two separate inputs",
        apart.filter(one => one.rows.some(r => r.arg.key === "plane")).length === 2);
  const withNote = cut.map(one => one.id === "GS"
    ? { ...one, texts: { inputs: JSON.stringify({ version: 1, inputs: [{ name: "Ground",
        was: "PL", holders: [{ id: "C1", key: "plane" }, { id: "C2", key: "plane" }] }] }) } }
    : one);
  const together = setInputGroups(withNote, "GS", { spec, applies,
    declaredText: withNote.find(one => one.id === "GS").texts.inputs });
  const one = together.find(g => g.rows.length > 1);
  check("but the set's own note puts them back together",
        !!one && one.rows.map(r => r.child.id).sort().join() === "C1,C2",
        JSON.stringify(together.map(g => g.rows.map(r => r.child.id + "." + r.arg.key))));
  check("keeping the name the file gave it", one && one.name === "Ground", one && one.name);

  // The pieces on their own.
  const rows = reachesIn(live, "GS", { spec, applies });
  check("reachesIn finds every argument that leaves the set",
        rows.length === groups.reduce((n, g) => n + g.rows.length, 0));
  check("and gathering them never loses one",
        gatherInputs(rows).reduce((n, g) => n + g.rows.length, 0) === rows.length);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
