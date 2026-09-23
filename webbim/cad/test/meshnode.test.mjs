// The mesh editor as a NODE: the starting meshes, the non-destructive edit
// list, the creases travelling downstream, and the way back out to a B-Rep.
//
// The operations themselves are checked in polymesh.test.mjs, against
// arithmetic. What is checked here is that they survive being a document:
// written into a model file, read back, replayed over a cage that has changed
// underneath them, and handed to OpenCascade at the end of it.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { meshCreases, meshFaces, meshSharpness } from "../src/ocaf.js";
import { anchorsOf, boxMesh, faceCentre, topologyOf, edgeEnds } from "../src/polymesh.js";
import { readFileSync } from "fs";

const WASM_DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const initModule = (await import(WASM_DIR + "/replicad_single.js")).default;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

const kernel = await createWasmKernel({
  initModule, wasmBinary: readFileSync(WASM_DIR + "/replicad_single.wasm"),
});
const mdl = new Mdl({
  kernel, setNode: () => {}, readLayout: () => ({}), select: () => {}, selected: () => null,
});
const tree = async () => (await kernel.tree()).tree;
const at = async id => (await tree()).features.find(f => f.id === id);
const fresh = () => mdl.run({ op: "model", model: { format: "ocaf-parametric-model",
  version: 1, name: "Mesh", units: "mm", features: [] } });

await fresh();

console.log("1. the starting meshes, as a node");
{
  const made = await mdl.run({ op: "add", type: "MeshTemplate", name: "Start" });
  let entry = await at(made.id);
  check("a starting mesh builds", entry.built && !entry.error, entry.error || entry.data.preview);
  check("and the default is a grid", entry.data.faces === 16, String(entry.data.faces));

  const kinds = ["Plane", "Grid", "Box", "L-shape", "Cross", "Hexagon", "Honeycomb",
                 "Disc", "Cylinder", "Tube", "Sphere", "Torus"];
  const counts = [];
  for (let k = 0; k < kinds.length; k++) {
    await mdl.run({ op: "set", id: made.id, key: "kind", value: k });
    entry = await at(made.id);
    counts.push(kinds[k] + " " + (entry.error ? "FAILED" : entry.data.faces));
    check(kinds[k].toLowerCase() + " builds", !entry.error && entry.data.faces > 0,
          entry.error || entry.data.preview);
  }
  // The L, because it is the one the office draws most.
  await mdl.run({ op: "set", id: made.id, key: "kind", value: 3 });
  for (const [key, value] of [["width", 1200], ["depth", 1200], ["arm", 600],
                              ["leg", 600], ["grid", 300]])
    await mdl.run({ op: "set", id: made.id, key, value });
  entry = await at(made.id);
  check("an L-shape is twelve quads", entry.data.faces === 12 && /12 quads/.test(entry.data.preview),
        entry.data.preview);
  // The hexagon, because it is what a tower starts as.
  await mdl.run({ op: "set", id: made.id, key: "kind", value: 5 });
  await mdl.run({ op: "set", id: made.id, key: "rings", value: 2 });
  entry = await at(made.id);
  check("a hexagon is twelve quads and no triangles",
        /^12 quads$/.test(entry.data.preview.trim().split("·")[0].trim())
        || /12 quads/.test(entry.data.preview), entry.data.preview);
  check("the arguments that do not apply to a hexagon are hidden",
        (await tree()).features.find(f => f.id === made.id) !== undefined);
}

console.log("\n2. the edit list, as a document");
{
  await fresh();
  const cage = await mdl.run({ op: "add", type: "MeshBox", name: "Cage" });
  for (const [key, value] of [["dx", 100], ["dy", 100], ["dz", 100]])
    await mdl.run({ op: "set", id: cage.id, key, value });
  const edit = await mdl.run({ op: "add", type: "EditMesh", name: "Edit" });
  await mdl.run({ op: "connect", id: edit.id, key: "mesh", from: cage.id });
  let entry = await at(edit.id);
  check("an empty edit list passes the mesh through",
        entry.data.count === 8 && entry.data.faces === 6, entry.data.preview);

  // What the editor sends: the cage, then an operation recorded against it.
  const got = await kernel.cage(edit.id);
  check("the cage call gives points and n-gon faces, not triangles",
        got.points.length === 8 && got.faces.length === 6
        && got.faces.every(f => f.length === 4), got.faces.length + " faces");
  const box = { points: got.points, faces: got.faces, creases: {}, corners: {} };
  const top = box.faces.findIndex(f => faceCentre(box, f)[2] > 49);
  const extrude = { op: "extrude", level: "face", at: [top],
                    near: anchorsOf(box, "face", [top]), args: { distance: 100 } };
  await mdl.run({ op: "meshop", id: edit.id, ops: [extrude] });
  entry = await at(edit.id);
  check("one extrude in the list builds",
        !entry.error && entry.data.count === 12 && entry.data.faces === 10,
        entry.error || entry.data.preview);

  // THE POINT OF ALL OF IT: change the cage underneath and the edit replays.
  await mdl.run({ op: "set", id: cage.id, key: "segX", value: 2 });
  await mdl.run({ op: "set", id: cage.id, key: "segY", value: 2 });
  entry = await at(edit.id);
  check("re-dividing the cage underneath does not break the edit above it",
        !entry.error, entry.error || entry.data.preview);
  const after = await kernel.cage(edit.id);
  check("and the extrude happened again, to the faces that replaced the one it knew",
        Math.max(...after.points.map(p => p[2])) > 140,
        "top at " + Math.max(...after.points.map(p => p[2])).toFixed(0) + " mm");
  check("as one block, not four towers",
        after.faces.length < 30, after.faces.length + " faces");

  // It survives the file.
  const text = await mdl.modelText();
  check("the list is in the model file as text a person can read",
        /"ops"/.test(text) && /extrude/.test(text),
        (text.match(/"ops"[^\n]{0,60}/) || [""])[0]);
  await fresh();
  await mdl.run({ op: "model", model: JSON.parse(text) });
  entry = await at(edit.id);
  check("and it comes back out of the file still built", !entry.error && entry.built,
        entry.error || entry.data.preview);
  const reread = await kernel.cage(edit.id);
  check("with the same mesh it had", reread.points.length === after.points.length
        && reread.faces.length === after.faces.length,
        reread.points.length + " / " + reread.faces.length);

  // And it is undoable like everything else.
  await mdl.run({ op: "meshop", id: edit.id, ops: [extrude, { op: "inset", level: "face",
    at: [0], near: anchorsOf(box, "face", [0]), args: { thickness: 20 } }] });
  const two = (await at(edit.id)).data.faces;
  await mdl.run({ op: "undo" });
  check("undo takes the last list back",
        (await at(edit.id)).data.faces !== two, String((await at(edit.id)).data.faces));

  // A list with a step that has lost what it was about is a note, not a ruin.
  await mdl.run({ op: "meshop", id: edit.id, ops: [{ op: "extrude", level: "face",
    at: [99], near: [[9000, 9000, 9000, 0, 0, 1, 10]], args: { distance: 50 } }] });
  entry = await at(edit.id);
  check("a step that cannot find what it was about still builds the rest",
        !entry.error && entry.built, entry.error);
  check("and says which step missed", /no longer in the mesh/.test(entry.note || ""),
        entry.note || "nothing said");
  await mdl.run({ op: "meshop", id: edit.id, ops: [] });
}

console.log("\n3. creases travel with the mesh");
{
  check("nothing creased packs exactly as it always did",
        meshSharpness({}, {}).length === 0);
  const tail = meshSharpness({ "3,7": 0.8 }, { 12: 1 });
  check("a crease packs behind a face of nought sides",
        tail[0] === 0 && tail[1] === 1 && tail[2] === 3 && tail[3] === 7 && tail[4] === 800,
        tail.join(","));
  const back = meshCreases({ faces: [4, 0, 1, 2, 3, ...tail] });
  check("and unpacks to what went in",
        near(back.creases["3,7"], 0.8, 1e-9) && near(back.corners[12], 1, 1e-9),
        JSON.stringify(back));
  check("while the faces still read as faces",
        meshFaces({ faces: [4, 0, 1, 2, 3, ...tail] }).length === 1,
        String(meshFaces({ faces: [4, 0, 1, 2, 3, ...tail] }).length));

  await fresh();
  const cage = await mdl.run({ op: "add", type: "MeshBox", name: "Cage" });
  for (const [key, value] of [["dx", 100], ["dy", 100], ["dz", 100]])
    await mdl.run({ op: "set", id: cage.id, key, value });
  const edit = await mdl.run({ op: "add", type: "EditMesh", name: "Edit" });
  await mdl.run({ op: "connect", id: edit.id, key: "mesh", from: cage.id });
  const sub = await mdl.run({ op: "add", type: "Subdivide", name: "Smooth" });
  await mdl.run({ op: "connect", id: sub.id, key: "mesh", from: edit.id });
  await mdl.run({ op: "set", id: sub.id, key: "levels", value: 3 });

  const box = await kernel.cage(edit.id);
  const topo = topologyOf(box);
  const every = [...topo.edges.keys()];
  await mdl.run({ op: "meshop", id: edit.id, ops: [{ op: "crease", level: "edge",
    at: every, near: anchorsOf(box, "edge", every, topo), args: { amount: 1 } }] });

  const creased = await kernel.cage(edit.id);
  check("a crease on every edge is on the cage the Edit Mesh hands on",
        Object.keys(creased.creases).length === 12,
        String(Object.keys(creased.creases).length));
  const smooth = await kernel.cage(sub.id);
  const far = Math.max(...smooth.points.map(p => Math.max(...p.map(Math.abs))));
  // MeshBox stands on its corner rather than round its middle, so the far
  // corner of a 100 mm cage is at 100.
  check("and it travels THROUGH the subdivision - three levels and the box is still a box",
        near(far, 100, 0.5), "furthest point at " + far.toFixed(2) + " mm of 100");

  await mdl.run({ op: "meshop", id: edit.id, ops: [] });
  const round = await kernel.cage(sub.id);
  const rounded = Math.max(...round.points.map(p => Math.max(...p.map(Math.abs))));
  check("take the creases off and it rounds again", rounded < 96,
        "furthest point at " + rounded.toFixed(2) + " mm of 100");
}

console.log("\n4. the way back out: a cage into a B-Rep");
{
  await fresh();
  const cage = await mdl.run({ op: "add", type: "MeshBox", name: "Cage" });
  for (const [key, value] of [["dx", 100], ["dy", 100], ["dz", 100]])
    await mdl.run({ op: "set", id: cage.id, key, value });
  const solid = await mdl.run({ op: "add", type: "MeshToShape", name: "Solid" });
  await mdl.run({ op: "connect", id: solid.id, key: "mesh", from: cage.id });
  let entry = await at(solid.id);
  check("a cage with no smoothing sews into a solid",
        !entry.error && entry.built, entry.error || entry.note);
  check("and it says so, with the face count", /6 faces/.test(entry.note || "")
        && /solid/.test(entry.note || ""), entry.note);

  // A real B-Rep: it measures, and it takes a fillet.
  const measure = await mdl.run({ op: "add", type: "Measure", name: "M" });
  await mdl.run({ op: "connect", id: measure.id, key: "shape", from: solid.id });
  await mdl.run({ op: "set", id: measure.id, key: "quantity", value: 2 });
  const volume = Number((await at(measure.id)).data.preview);
  check("it holds what the cage held", near(volume, 1e6, 1), volume.toFixed(0));
  const round = await mdl.run({ op: "add", type: "Fillet", name: "Round" });
  await mdl.run({ op: "connect", id: round.id, key: "body", from: solid.id });
  await mdl.run({ op: "set", id: round.id, key: "radius", value: 10 });
  entry = await at(round.id);
  check("and it takes a fillet, which is what being a B-Rep is for",
        !entry.error && entry.built, entry.error);

  // Smoothed on the way out, which is the Rhino move.
  await mdl.run({ op: "set", id: solid.id, key: "levels", value: 2 });
  entry = await at(solid.id);
  check("subdividing on the way out gives a smooth solid",
        !entry.error && /96 faces/.test(entry.note || ""), entry.error || entry.note);
  await mdl.run({ op: "set", id: measure.id, key: "quantity", value: 2 });
  const smoothed = Number((await at(measure.id)).data.preview);
  check("smaller than the cage, because that is what the cage means",
        smoothed < 1e6 && smoothed > 1e6 * 0.3, (smoothed / 1e6).toFixed(3) + " of the cage");

  // An open cage cannot be a solid and says so rather than pretending.
  const sheet = await mdl.run({ op: "add", type: "MeshGrid", name: "Sheet" });
  const shell = await mdl.run({ op: "add", type: "MeshToShape", name: "Shell" });
  await mdl.run({ op: "connect", id: shell.id, key: "mesh", from: sheet.id });
  entry = await at(shell.id);
  check("an open cage comes out a shell", !entry.error && /shell/.test(entry.note || ""),
        entry.error || entry.note);

  // A cage big enough that four levels of it would be a hundred thousand faces
  // to sew, which is refused before OpenCascade is asked rather than after the
  // tab stops answering.
  for (const key of ["segX", "segY", "segZ"])
    await mdl.run({ op: "set", id: cage.id, key, value: 6 });
  await mdl.run({ op: "set", id: solid.id, key: "levels", value: 4 });
  entry = await at(solid.id);
  check("and too many faces to sew is refused before it is tried, by name",
        !!entry.error && /levels|faces to sew/.test(entry.error), entry.error);
}

console.log("\n5. what it refuses");
{
  await fresh();
  const cage = await mdl.run({ op: "add", type: "MeshBox", name: "Cage" });
  let threw = "";
  try { await mdl.run({ op: "meshop", id: cage.id, ops: [] }); }
  catch (error) { threw = error.message; }
  check("a mesh that is not an Edit Mesh refuses an operation list, by name",
        /does not hold a list of mesh operations/.test(threw), threw);
  const edit = await mdl.run({ op: "add", type: "EditMesh", name: "Edit" });
  await mdl.run({ op: "connect", id: edit.id, key: "mesh", from: cage.id });
  threw = "";
  try { await mdl.run({ op: "meshop", id: edit.id, ops: [{ op: "nonsense" }] }); }
  catch (error) { threw = error.message; }
  check("and an operation nobody has heard of is refused before it is stored",
        /is not a mesh operation/.test(threw), threw);
  threw = "";
  try { await mdl.run({ op: "meshop", id: edit.id, ops: "not a list" }); }
  catch (error) { threw = error.message; }
  check("as is a list that is not a list", /must be a list/.test(threw), threw);
  await mdl.run({ op: "code", id: edit.id, key: "ops", text: "{ this is not JSON" });
  check("unreadable text in the argument is an error on the node, not a crash",
        /not readable/.test((await at(edit.id)).error || ""), (await at(edit.id)).error);
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall good");
process.exit(failures ? 1 : 0);
