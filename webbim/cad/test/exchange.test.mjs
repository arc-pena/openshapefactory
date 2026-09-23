// Files in, files out.
//
// The thing worth testing here is not that a file appears. It is that what
// goes round the loop comes back the same: a quad cage stays a quad cage, a
// solid keeps its volume, an assembly stays several parts, and an import
// survives being written into the model file and read back out - because an
// import that cannot be reopened is worse than no import at all.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { FORMATS, PACK_FROM, countObjParts, formatFor, isBinaryStl, isPacked, latin1,
         packGeometry, parseObj, parseStl, productNames, scanLines, scanStep, sniffFormat,
         toBase64, unpackGeometry, whyNot, writeObj, writeStl } from "../src/exchange.js";
import { isElided, lightenModel } from "../src/ocaf.js";
import { readFileSync } from "fs";

const WASM_DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const initModule = (await import(WASM_DIR + "/replicad_single.js")).default;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const inKb = n => (n / 1024).toFixed(1) + " kB";

console.log("1. the formats, declared");
{
  check("a step file is a STEP file", (formatFor("bracket.STP") || {}).key === "step");
  check("and so is one with a long name", (formatFor("/a/b/c.d.step") || {}).key === "step");
  check("an unknown extension is not guessed at", formatFor("part.zip") === null);
  check("IGES says why not, rather than nothing",
        /not compiled/.test((whyNot("part.igs") || {}).reason || ""));
  check("so does a Rhino file", /Rhino/.test((whyNot("house.3dm") || {}).name || ""));
  // Only a format that carries several parts may be broken into several.
  const structured = FORMATS.filter(f => f.structure).map(f => f.key).sort().join(",");
  check("only STEP and OBJ carry more than one part", structured === "obj,step", structured);
}

console.log("2. OBJ keeps the faces it was given");
{
  // A cube as six quads, the way Blender writes one.
  const blender = [
    "# Blender v3.6", "o Cube",
    "v -1 -1 -1", "v -1 -1 1", "v -1 1 -1", "v -1 1 1",
    "v 1 -1 -1", "v 1 -1 1", "v 1 1 -1", "v 1 1 1",
    "vt 0.5 0.5", "vn 0 0 1",
    "s off",
    "f 1/1/1 2/1/1 4/1/1 3/1/1", "f 3/1/1 4/1/1 8/1/1 7/1/1",
    "f 7/1/1 8/1/1 6/1/1 5/1/1", "f 5/1/1 6/1/1 2/1/1 1/1/1",
    "f 3/1/1 7/1/1 5/1/1 1/1/1", "f 8/1/1 4/1/1 2/1/1 6/1/1",
  ].join("\n");
  const parts = parseObj(blender);
  check("one object", parts.length === 1 && parts[0].name === "Cube");
  check("eight vertices, six faces", parts[0].points.length === 8 && parts[0].faces.length === 6);
  check("and every face still has four sides - NOT triangulated",
        parts[0].faces.every(f => f.length === 4),
        parts[0].faces.map(f => f.length).join(","));

  // Out and back in again. This is the round trip that matters: a cage that
  // loses its quads cannot be subdivided, so the loop has to preserve them.
  const back = parseObj(writeObj(parts, "round trip"));
  check("written out and read back, still six quads",
        back.length === 1 && back[0].faces.length === 6
        && back[0].faces.every(f => f.length === 4));
  check("and the vertices are where they were",
        back[0].points.every((p, i) => p.every((v, k) => near(v, parts[0].points[i][k], 1e-9))));

  const grouped = parseObj([
    "v 0 0 0", "v 1 0 0", "v 1 1 0", "v 0 1 0",
    "g floor", "f 1 2 3 4",
    "g wall", "v 0 0 1", "v 1 0 1", "f 1 2 6 5",
  ].join("\n"));
  check("groups come in as separate parts", grouped.length === 2
        && grouped[0].name === "floor" && grouped[1].name === "wall");
  check("and each carries only the vertices it uses",
        grouped[0].points.length === 4 && grouped[1].points.length === 4,
        grouped.map(g => g.points.length).join(","));

  const relative = parseObj(["v 0 0 0", "v 1 0 0", "v 1 1 0", "f -3 -2 -1"].join("\n"));
  check("a negative index counts back from the vertices so far",
        relative.length === 1 && relative[0].faces[0].length === 3
        && relative[0].points.length === 3);

  const named = parseObj(["v 0 0 0", "v 1 0 0", "v 1 1 0", "g empty", "g real", "f 1 2 3"].join("\n"));
  check("a group with nothing in it is not a part", named.length === 1 && named[0].name === "real");
}

console.log("3. STL, both encodings");
{
  const quad = [{ name: "q", points: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
                  faces: [[0, 1, 2, 3]] }];
  const ascii = writeStl(quad);
  check("a quad is fanned into two triangles, because STL has nothing else",
        (ascii.match(/facet normal/g) || []).length === 2);
  check("with a normal that points somewhere", /facet normal 0 0 1/.test(ascii), ascii.split("\n")[1]);
  const read = parseStl(ascii);
  check("read back as six loose vertices in two triangles",
        read.points.length === 6 && read.faces.length === 2);

  // A binary STL of one triangle, built by hand: 80 bytes of header, a count,
  // then 50 bytes a triangle.
  const bytes = new Uint8Array(84 + 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  const corners = [[0, 0, 0], [5, 0, 0], [0, 5, 0]];
  corners.forEach((p, i) => p.forEach((v, k) => view.setFloat32(84 + 12 + i * 12 + k * 4, v, true)));
  check("a binary file is recognised by its size, not its first word", isBinaryStl(bytes));
  const binary = parseStl(bytes);
  check("and reads as one triangle", binary.faces.length === 1 && binary.points.length === 3);
  check("with the corners it was written with",
        near(binary.points[1][0], 5, 1e-6) && near(binary.points[2][1], 5, 1e-6));
  // The word "solid" at the start proves nothing: this is what the guard is for.
  const liar = new Uint8Array(84 + 50);
  new Uint8Array(liar.buffer, 0, 5).set([115, 111, 108, 105, 100]);
  new DataView(liar.buffer).setUint32(80, 1, true);
  check("a binary file that begins with the word solid is still binary", isBinaryStl(liar));
}

console.log("4. round trips through the kernel");
const kernel = await createWasmKernel({
  initModule, wasmBinary: readFileSync(WASM_DIR + "/replicad_single.wasm"),
});
const mdl = new Mdl({
  kernel, setNode: () => {}, readLayout: () => ({}), select: () => {}, selected: () => null,
});
const tree = async () => (await kernel.tree()).tree;
const at = async id => (await tree()).features.find(f => f.id === id);
const blank = async () => await mdl.run({ op: "model", model: {
  format: "ocaf-parametric-model", version: 1, name: "Exchange", units: "mm", features: [] } });
const volumeOf = async id => {
  const measure = await mdl.run({ op: "add", type: "Measure" });
  await mdl.run({ op: "connect", id: measure.id, key: "shape", from: id });
  await mdl.run({ op: "set", id: measure.id, key: "quantity", value: 2 });   // volume
  const entry = await at(measure.id);
  await mdl.run({ op: "delete", id: measure.id });
  return entry.data ? Number(entry.data.preview.replace(/[^0-9.eE+-]/g, "")) : NaN;
};

await blank();
const point = await mdl.run({ op: "add", type: "Point" });
const cube = await mdl.run({ op: "add", type: "Cube", refs: { origin: point.id } });
for (const [key, value] of [["dx", 40], ["dy", 30], ["dz", 20]])
  await mdl.run({ op: "set", id: cube.id, key, value });
const wanted = 40 * 30 * 20;
check("a cube to start from", near(await volumeOf(cube.id), wanted, 1));

{
  const step = await kernel.exportShapes("step");
  check("STEP comes out as ISO-10303 text", /ISO-10303-21/.test(step.text), step.text.slice(0, 20));

  await blank();
  const back = await mdl.run({ op: "import", format: "step", name: "block.step", data: step.text });
  check("and reads back as one feature", back.created.length === 1, JSON.stringify(back.created));
  const entry = await at(back.created[0]);
  check("of type Imported, built, with no error",
        entry.type === "Imported" && entry.built && !entry.error, entry.error || "");
  check("named after the file", entry.name === "block", entry.name);
  check("the note says what came in", /one object, 1 solid, 6 faces/.test(back.note), back.note);
  check("and the volume survived the trip", near(await volumeOf(back.created[0]), wanted, 1),
        String(await volumeOf(back.created[0])));
}

console.log("5. an assembly comes in as parts, or as one object");
{
  // Two products in one file - which is what a STEP assembly is.
  await blank();
  const p1 = await mdl.run({ op: "add", type: "Point" });
  const a = await mdl.run({ op: "add", type: "Cube", refs: { origin: p1.id } });
  const p2 = await mdl.run({ op: "add", type: "Point" });
  await mdl.run({ op: "set", id: p2.id, key: "x", value: 300 });
  const b = await mdl.run({ op: "add", type: "Cube", refs: { origin: p2.id } });
  await mdl.run({ op: "set", id: b.id, key: "dx", value: 20 });
  const step = await kernel.exportShapes("step");
  check("two solids went out", step.solids === 2, String(step.solids));
  check("and the file names two products", productNames(step.text).length === 2,
        productNames(step.text).join(" | "));

  await blank();
  const parts = await mdl.run({ op: "import", format: "step", name: "asm.step",
                                data: step.text, as: "parts" });
  check("as sub-components: two features", parts.created.length === 2, parts.note);
  check("filed under one set", !!parts.set);
  const set = await at(parts.set);
  const inside = (await tree()).features.filter(f => f.parent === parts.set);
  check("which is a Body holding both", set.type === "Body" && inside.length === 2,
        set.type + " " + inside.length);
  // OpenCascade's own writer numbers its products after itself, and that is not
  // a name anybody gave: those are numbered here instead, and the note says so.
  check("a translator's own product names are not used as part names",
        /numbered - the file gave no usable names/.test(parts.note), parts.note);

  // The same file with names a person would have given it.
  // The writer numbers its products from a counter that has been running all
  // through this file, so they are replaced in the order they appear.
  const give = ["Bracket", "Spacer"];
  let nth = 0;
  // A STEP PRODUCT carries the same name twice - as its id and as its name - so
  // the replacements come in pairs.
  const named = step.text.replace(/'Open CASCADE STEP translator [^']*'/g,
                                  () => "'" + (give[Math.floor(nth++ / 2)] || "Extra") + "'");
  await blank();
  const real = await mdl.run({ op: "import", format: "step", name: "asm.step",
                               data: named, as: "parts" });
  check("but names from the file are", /named from the file/.test(real.note), real.note);
  const rows = (await tree()).features.filter(f => f.type === "Imported").map(f => f.name);
  check("and they are the names the file gave", rows.join(", ") === "Bracket, Spacer",
        rows.join(", "));

  await blank();
  const single = await mdl.run({ op: "import", format: "step", name: "asm.step",
                                 data: step.text, as: "single" });
  check("as one object: one feature, no set", single.created.length === 1 && !single.set);
  check("holding both solids", /2 solids/.test(single.note), single.note);
}

console.log("6. BREP, the kernel's own");
{
  await blank();
  const p = await mdl.run({ op: "add", type: "Point" });
  const c = await mdl.run({ op: "add", type: "Cube", refs: { origin: p.id } });
  for (const [key, value] of [["dx", 10], ["dy", 10], ["dz", 10]])
    await mdl.run({ op: "set", id: c.id, key, value });
  const brep = await kernel.exportShapes("brep");
  check("it says what it is", /CASCADE Topology/.test(brep.text), brep.text.slice(1, 30));
  await blank();
  const back = await mdl.run({ op: "import", format: "brep", name: "cube.brep", data: brep.text });
  check("read back as one shape", back.created.length === 1);
  check("with the volume it had", near(await volumeOf(back.created[0]), 1000, 0.5));
}

console.log("7. a quad cage, out to OBJ and back - the trip that matters");
{
  await blank();
  const grid = await mdl.run({ op: "add", type: "MeshBox", name: "Cage" });
  for (const key of ["segX", "segY", "segZ"])
    await mdl.run({ op: "set", id: grid.id, key, value: 2 });
  const before = await at(grid.id);
  const faces = before.data.faces;
  check("a cage of quads to start", faces === 24, String(faces));

  const obj = await kernel.exportShapes("obj");
  const parsed = parseObj(obj.text);
  check("the OBJ has the same faces, not triangles",
        parsed.length === 1 && parsed[0].faces.length === faces
        && parsed[0].faces.every(f => f.length === 4), obj.note);
  check("and the export says so", /faces of more than three sides kept/.test(obj.note), obj.note);

  await blank();
  const back = await mdl.run({ op: "import", format: "obj", name: "cage.obj", data: obj.text });
  const entry = await at(back.created[0]);
  check("imported as a mesh", entry.type === "MeshImported" && entry.data.kind === "mesh");
  check("with every quad intact", entry.data.faces === faces && /24 quads/.test(entry.data.preview),
        entry.data.preview);
  check("the note counts them", /24 of them with more than three sides/.test(back.note), back.note);

  // And it is still a cage: Catmull-Clark needs the quads to be there.
  const sub = await mdl.run({ op: "add", type: "Subdivide" });
  await mdl.run({ op: "connect", id: sub.id, key: "mesh", from: back.created[0] });
  await mdl.run({ op: "set", id: sub.id, key: "levels", value: 1 });
  const smoothed = await at(sub.id);
  check("so it subdivides, which is what a cage is for - one quad becomes four",
        smoothed.built && smoothed.data.faces === faces * 4,
        smoothed.error || smoothed.data.preview);
}

console.log("8. an import survives the model file");
{
  await blank();
  const p = await mdl.run({ op: "add", type: "Point" });
  const c = await mdl.run({ op: "add", type: "Cube", refs: { origin: p.id } });
  for (const [key, value] of [["dx", 12], ["dy", 12], ["dz", 12]])
    await mdl.run({ op: "set", id: c.id, key, value });
  const step = (await kernel.exportShapes("step")).text;
  await blank();
  const first = await mdl.run({ op: "import", format: "step", name: "keep.step", data: step });
  const model = await kernel.model();
  const entry = model.features.find(f => f.type === "Imported");
  check("the model file carries the geometry itself", typeof entry.args.brep === "string"
        && entry.args.brep.length > 100, String((entry.args.brep || "").length));
  check("and says where it came from", entry.args.source === "keep.step");

  // Undo has to reach back past the import, which means the whole document -
  // geometry and all - went on the stack.
  await mdl.run({ op: "undo" });
  check("undo takes the import away",
        !(await tree()).features.some(f => f.type === "Imported"));
  await mdl.run({ op: "redo" });
  check("and redo brings it back, still built",
        ((await tree()).features.find(f => f.type === "Imported") || {}).built);

  // Reopened from its own file, with nothing else in memory.
  await mdl.run({ op: "model", model });
  const again = (await tree()).features.find(f => f.type === "Imported");
  check("reopening the file rebuilds it", again.built && !again.error, again.error || "");
  check("with the same volume", near(await volumeOf(again.id), 1728, 0.5));

  check("the log does not keep the file", (() => {
    const record = mdl.history.find(r => r.edit && r.edit.op === "import");
    return record && /characters of file/.test(record.edit.data);
  })(), "the whole file would be kept twice over");
  void first;
}

console.log("9. STL out and in, and base64 in");
{
  await blank();
  const p = await mdl.run({ op: "add", type: "Point" });
  const c = await mdl.run({ op: "add", type: "Cube", refs: { origin: p.id } });
  for (const [key, value] of [["dx", 10], ["dy", 10], ["dz", 10]])
    await mdl.run({ op: "set", id: c.id, key, value });
  const stl = await kernel.exportShapes("stl");
  check("a box tessellates to twelve triangles",
        (stl.text.match(/facet normal/g) || []).length === 12, stl.note);

  await blank();
  const back = await mdl.run({ op: "import", format: "stl", name: "box.stl", data: stl.text });
  const entry = await at(back.created[0]);
  check("welded on the way in: eight vertices, not thirty-six",
        entry.data.count === 8 && entry.data.faces === 12,
        entry.data.preview);

  // The same file as bytes, which is how a binary STL arrives.
  const bytes = new Uint8Array(84 + 50);
  new DataView(bytes.buffer).setUint32(80, 1, true);
  [[0, 0, 0], [8, 0, 0], [0, 8, 0]].forEach((q, i) =>
    q.forEach((v, k) => new DataView(bytes.buffer).setFloat32(84 + 12 + i * 12 + k * 4, v, true)));
  await blank();
  const binary = await mdl.run({ op: "import", format: "stl", name: "tri.stl",
                                 data: toBase64(bytes), encoding: "base64" });
  const one = await at(binary.created[0]);
  check("base64 bytes come in too", one.built && one.data.faces === 1, one.error || one.data.preview);
}

console.log("10. what is refused, and how");
{
  await blank();
  let message = "";
  try { await mdl.run({ op: "import", format: "iges", name: "a.igs", data: "x" }); }
  catch (err) { message = err.message; }
  check("a format the kernel cannot read is refused by name",
        /cannot read "iges"/.test(message), message);

  message = "";
  try { await mdl.run({ op: "import", format: "step", name: "a.step", data: "not a step file" }); }
  catch (err) { message = err.message; }
  check("and rubbish in a real format is refused by the reader",
        /STEP/.test(message), message);

  message = "";
  try { await mdl.run({ op: "import", format: "obj", name: "a.obj", data: "v 0 0 0" }); }
  catch (err) { message = err.message; }
  check("an OBJ with no faces says so", /no faces/.test(message), message);
}

console.log("11. shortened for reading, and refused for building");
{
  await blank();
  const p = await mdl.run({ op: "add", type: "Point" });
  const c = await mdl.run({ op: "add", type: "Cube", refs: { origin: p.id } });
  const step = (await kernel.exportShapes("step")).text;
  void c;
  await blank();
  await mdl.run({ op: "import", format: "step", name: "big.step", data: step });
  const model = await kernel.model();
  const light = lightenModel(model);
  const heavy = model.features.find(f => f.type === "Imported").args.brep;
  const shown = light.features.find(f => f.type === "Imported").args.brep;
  check("the geometry is replaced by its size", isElided(shown) && shown.length < 40, shown);
  check("and the whole of it is accounted for", light.elided === heavy.length,
        light.elided + " vs " + heavy.length);
  check("a model with nothing imported is handed back unchanged",
        lightenModel({ features: [] }).elided === undefined);

  let message = "";
  try { await mdl.run({ op: "model", model: light }); }
  catch (err) { message = err.message; }
  check("rebuilding from the shortened text is refused, by name",
        /shortened so it could be read/.test(message), message);
  check("and the document is untouched",
        (await tree()).features.some(f => f.type === "Imported"));
}

console.log("12. an import is a node like any other node");
{
  await blank();
  const p = await mdl.run({ op: "add", type: "Point" });
  const c = await mdl.run({ op: "add", type: "Cube", refs: { origin: p.id } });
  for (const [key, value] of [["dx", 60], ["dy", 60], ["dz", 60]])
    await mdl.run({ op: "set", id: c.id, key, value });
  const step = (await kernel.exportShapes("step")).text;

  await blank();
  const one = await mdl.run({ op: "import", format: "step", name: "block.step", data: step });
  const entry = await at(one.created[0]);
  check("it says what it holds, the way every node says what it computed",
        !!entry.data && /1 solid, 6 faces/.test(entry.data.preview), (entry.data || {}).preview);
  check("and where it came from", /from block.step/.test((entry.data || {}).preview || ""),
        (entry.data || {}).preview);

  // The thing that matters: what comes out of an import is an ordinary body,
  // so the operations take it without knowing it was imported.
  const fillet = await mdl.run({ op: "add", type: "Fillet" });
  await mdl.run({ op: "connect", id: fillet.id, key: "body", from: one.created[0] });
  await mdl.run({ op: "set", id: fillet.id, key: "radius", value: 6 });
  const rounded = await at(fillet.id);
  check("a fillet rounds it", rounded.built && !rounded.error, rounded.error || "");
  check("and the result has the twelve rounded edges a box has",
        (await kernel.mesh([fillet.id])).features[0].triangles > 100,
        String((await kernel.mesh([fillet.id])).features[0].triangles));

  const at2 = await mdl.run({ op: "add", type: "Point" });
  await mdl.run({ op: "set", id: at2.id, key: "x", value: 60 });
  const ball = await mdl.run({ op: "add", type: "Sphere", refs: { center: at2.id } });
  const cut = await mdl.run({ op: "add", type: "Boolean" });
  await mdl.run({ op: "connect", id: cut.id, key: "a", from: fillet.id });
  await mdl.run({ op: "connect", id: cut.id, key: "b", from: ball.id });
  await mdl.run({ op: "set", id: cut.id, key: "op", value: 1 });          // difference
  const booled = await at(cut.id);
  check("and a boolean cuts it", booled.built && !booled.error, booled.error || "");

  // Nothing downstream should meet a container where every other node hands
  // back a body.
  const volume = await volumeOf(one.created[0]);
  check("one part in, one body out - not a compound of one",
        near(volume, 60 * 60 * 60, 1), String(volume));
}

console.log("13. what cannot be rounded says so, rather than faulting");
{
  await blank();
  const p = await mdl.run({ op: "add", type: "Point" });
  const v = await mdl.run({ op: "add", type: "Vector" });
  await mdl.run({ op: "add", type: "Plane", refs: { origin: p.id, normal: v.id } });
  const brep = (await kernel.exportShapes("brep")).text;

  await blank();
  const skin = await mdl.run({ op: "import", format: "brep", name: "skin.brep", data: brep });
  const entry = await at(skin.created[0]);
  check("a surface import says it is a surface", /face/.test((entry.data || {}).preview || ""),
        (entry.data || {}).preview);

  const fillet = await mdl.run({ op: "add", type: "Fillet" });
  await mdl.run({ op: "connect", id: fillet.id, key: "body", from: skin.created[0] });
  const refused = await at(fillet.id);
  // OpenCascade does not refuse this - it faults, and a fault is a number with
  // no explanation in it. The precondition is what turns it into a sentence.
  check("and a fillet on it is refused by name, not by a fault",
        !refused.built && /no solid to round/.test(refused.error || ""), refused.error || "built!");
}

console.log("14. a file dropped on the page, read from its own first lines");
{
  // Only ever asked when the NAME said nothing - so what is checked here is
  // that each format really does declare itself, and that nothing is guessed
  // at when there is nothing to go on.
  const of = text => sniffFormat(new TextEncoder().encode(text));
  check("a model file says so in its own first key",
        of('{ "format": "ocaf-parametric-model", "version": 1, "features": [] }') === "model");
  check("a STEP file says ISO-10303 before anything else",
        of("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n") === "step");
  check("a BREP file is OpenCascade's own header",
        of("DBRep_DrawableShape\n\nCASCADE Topology V1, (c) Matra-Datavision\n") === "brep");
  check("an ASCII STL is the word solid AND a facet",
        of("solid box\n facet normal 0 0 1\n  outer loop\n") === "stl");
  check("the word solid on its own is not an STL", of("solid ground, no facets here") === null);
  check("a DXF is group code 0 and the word SECTION",
        of("0\nSECTION\n2\nHEADER\n9\n$ACADVER\n") === "dxf");
  check("an OBJ is vertices and something that uses them",
        of("# blender\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n") === "obj");
  check("and a file that says nothing is not guessed at",
        of("the quick brown fox jumps over the lazy dog") === null);
  check("nor is an empty one", sniffFormat(new Uint8Array(0)) === null);

  // A binary STL has no words at all: it says what it is by being exactly as
  // long as its own triangle count claims.
  const bytes = new Uint8Array(84 + 50 * 3);
  new DataView(bytes.buffer).setUint32(80, 3, true);
  check("a binary STL is recognised by its arithmetic", sniffFormat(bytes) === "stl");
  const short = new Uint8Array(84 + 50 * 3 - 1);
  new DataView(short.buffer).setUint32(80, 3, true);
  check("and one that does not add up is not claimed", sniffFormat(short) === null);

  // The name still wins when there is one. A .step is read as STEP whatever
  // is inside it, which is why the sniff is a fallback and not a vote.
  check("the name is what is asked first", formatFor("bracket.step").key === "step");
  check("and the sniff only has anything to say when it said nothing",
        formatFor("attachment.dat") === null);
}

console.log("15. counting through a file nobody can hold");
{
  // The window is what makes a 184 MB import askable-about at all: the page
  // never has the text, so the one question the dialog asks has to be answered
  // by reading a few megabytes at a time out of wherever the file already is.
  //
  // THE FAILURE THAT WOULD LOOK LIKE SUCCESS is a boundary. Every count here
  // is right on a file read in one go; the only way to be wrong is for a token
  // that straddles a window join to be counted twice or not at all, and on a
  // real file that is a number two or three too high in a dialog nobody
  // double-checks. So every count is taken twice - once whole, once through
  // windows small enough that the joins land inside the tokens - and the two
  // have to agree.
  const windowed = text => (at, length) => text.slice(at, at + length);

  const step = ["ISO-10303-21;", "HEADER;", "FILE_NAME('a.step');", "ENDSEC;", "DATA;"]
    .concat([1, 2, 3, 4, 5].map(n =>
      "#" + n + " = PRODUCT('Part " + n + "','Part " + n + "','',(#9));"))
    .concat(["#20 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#1,#2,$);", "ENDSEC;", "END-ISO-10303-21;"])
    .join("\n");

  const whole = scanStep(windowed(step), step.length, step.length + 10, 16);
  check("five products, read in one go", whole.products === 5, String(whole.products));
  check("and it says it is an assembly", whole.assembly === true);
  // 13 characters is smaller than a PRODUCT entity, so joins land inside them.
  for (const slice of [7, 13, 29, 64]) {
    const got = scanStep(windowed(step), step.length, slice, 512);
    check("still five through " + slice + "-character windows",
          got.products === 5 && got.assembly === true,
          got.products + " products, assembly " + got.assembly);
  }
  // The same count the whole-text reader gets, which is the only definition of
  // right that matters - the two must not be able to disagree.
  check("and it agrees with productNames on the whole text",
        whole.products === productNames(step).length,
        whole.products + " vs " + productNames(step).length);

  // A PRODUCT entity wrapped over lines, the way most writers emit them. The
  // newlines go before the match is tried, on both roads.
  const wrapped = "#1 = PRODUCT(\n  'Wrapped',\n  'Wrapped',\n  '',\n  (#9)\n);\n";
  check("a product wrapped over five lines is one product",
        scanStep(windowed(wrapped), wrapped.length, 11, 256).products === 1);

  // OBJ: a part is a part when something is drawn in it. A file that names
  // forty layers and fills three has three parts, and saying forty would offer
  // to break it into thirty-seven empty ones.
  const obj = ["# two groups and an empty one", "v 0 0 0", "v 1 0 0", "v 0 1 0", "v 1 1 0",
               "o Alpha", "f 1 2 3",
               "g Nothing",
               "o Beta", "f 2 3 4", "f 1 3 4"].join("\n");
  check("two parts, not three", countObjParts(windowed(obj), obj.length) === 2,
        String(countObjParts(windowed(obj), obj.length)));
  check("which is what parseObj makes of it too",
        countObjParts(windowed(obj), obj.length) === parseObj(obj).length);
  for (const slice of [3, 9, 17, 40]) {
    const got = countObjParts(windowed(obj), obj.length, slice);
    check("and two through " + slice + "-character windows", got === 2, String(got));
  }

  // Faces before any group are a part of their own, and the ones after a group
  // belong to it rather than starting another.
  const loose = ["v 0 0 0", "v 1 0 0", "v 0 1 0", "f 1 2 3", "f 1 2 3",
                 "g Later", "f 1 2 3", "f 1 2 3"].join("\n");
  check("loose faces are one part and the group is another",
        countObjParts(windowed(loose), loose.length) === 2 &&
        parseObj(loose).length === 2);

  // The line reader itself: a line split across a join is one line, not two.
  const lines = "alpha\nbeta\ngamma\ndelta";
  const seen = [];
  scanLines(windowed(lines), lines.length, line => seen.push(line), 4);
  check("four lines through four-character windows",
        seen.join("|") === "alpha|beta|gamma|delta", seen.join("|"));

  // One byte, one character. A window that decoded as UTF-8 would turn a
  // multi-byte character split across a join into two broken ones, and every
  // offset after it would be wrong.
  const bytes = new Uint8Array([0x41, 0xC3, 0xA9, 0x42]);
  check("latin1 is one character per byte", latin1(bytes).length === 4, latin1(bytes));
  check("and the ASCII in it is untouched",
        latin1(bytes)[0] === "A" && latin1(bytes)[3] === "B");
}

console.log("16. geometry packed into the document");
{
  // What lets a 184 MB import live in a model file at all. BREP is ASCII and
  // repetitive; the measurement on a real one was 7.8 times.
  const brep = "DBRep_DrawableShape\n\nCASCADE Topology V1, (c) Matra-Datavision\n"
    + "0 0 0 1 0 0 0 1 0 0 0 1\n".repeat(20000);
  const packed = await packGeometry(brep);
  check("it is marked as packed rather than flagged beside", isPacked(packed));
  check("and it is a great deal smaller", packed.length < brep.length / 4,
        (brep.length / packed.length).toFixed(1) + "x");
  check("and it comes back exactly", await unpackGeometry(packed) === brep);

  // A small import stays readable in the model file, which is worth more than
  // the bytes - and unpacking is a no-op on text that was never packed.
  const small = "a little BREP".repeat(10);
  check("something small is left alone", await packGeometry(small) === small);
  check("and reads straight back", await unpackGeometry(small) === small);
  check("the threshold is declared, not buried", PACK_FROM > 0 && PACK_FROM < 1024 * 1024);

  // Already-compressed input comes out bigger. Keeping the bigger one would be
  // paying for the idea rather than for the result.
  const noise = Array.from({ length: PACK_FROM + 1000 },
    (_, i) => String.fromCharCode(33 + ((i * 7919) % 94))).join("");
  const tried = await packGeometry(noise);
  check("and what will not pack is kept plain", tried === noise || tried.length < noise.length);
}

console.log("17. a file streamed into the kernel, never held whole");
{
  // The road the page takes for every format now: read a slice, hand it over,
  // drop it, read the next. What is tested here is that the file put together
  // on the other side is the same file, that the reader reads it from there,
  // and that what lands in the document is the geometry rather than the file.
  await blank();
  const origin = await mdl.run({ op: "add", type: "Point" });
  const box = await mdl.run({ op: "add", type: "Cube", refs: { origin: origin.id } });
  for (const [key, value] of [["dx", 12], ["dy", 8], ["dz", 5]])
    await mdl.run({ op: "set", id: box.id, key, value });
  const solid = 12 * 8 * 5;
  const step = await kernel.exportShapes("step");

  // Slices deliberately smaller than the file, so the join is exercised: a
  // chunk written at the wrong offset gives a file that is the right length
  // and the wrong contents, which reads as a corrupt STEP rather than as an
  // error anybody could trace.
  const stream = async (path, text, slice) => {
    const bytes = new TextEncoder().encode(text);
    for (let at = 0; at < bytes.length; at += slice)
      await kernel.takeUpload({ path, bytes: bytes.subarray(at, Math.min(at + slice, bytes.length)),
                                at });
    return await kernel.finishUpload({ path });
  };

  const path = "/streamed.step";
  const wrote = await stream(path, step.text, 997);
  check("every slice landed", wrote.wrote === new TextEncoder().encode(step.text).length,
        wrote.wrote + " of " + step.text.length);

  // And the survey answers the dialog's one question without the page ever
  // having had the text.
  const survey = await kernel.surveyUpload({ path, format: "step" });
  check("the survey sees the whole file", survey.size === wrote.wrote,
        survey.size + " vs " + wrote.wrote);
  check("and counts what productNames counts",
        survey.parts === Math.max(productNames(step.text).length, 1),
        survey.parts + " vs " + productNames(step.text).length);

  await blank();
  const came = await mdl.run({ op: "import", format: "step", name: "streamed.step",
                               from: path, as: "single" });
  check("it imports from the path, with no data at all", came.created.length === 1, came.note);
  check("and the solid is the one that went out",
        near(await volumeOf(came.created[0]), solid, 1),
        String(await volumeOf(came.created[0])));

  // The file is the largest thing in the kernel's filesystem, and an import
  // that leaves it there is an import that stops the next one.
  let still = true;
  try { await kernel.surveyUpload({ path, format: "step" }); } catch (err) { still = false; }
  const after = still ? (await kernel.surveyUpload({ path, format: "step" })).size : 0;
  check("and the file is gone once the shapes are out of it", after === 0, String(after));

  // A BREP, packed on the way into the document. This is what makes a large
  // import a model file somebody can still send.
  const brep = await kernel.exportShapes("brep");
  await blank();
  const big = "/streamed.brep";
  await stream(big, brep.text, 1024);
  const solidBack = await mdl.run({ op: "import", format: "brep", name: "tower.brep",
                                    from: big, as: "single" });
  check("a BREP streams in the same way", solidBack.created.length === 1, solidBack.note);
  check("with the same solid in it", near(await volumeOf(solidBack.created[0]), solid, 1),
        String(await volumeOf(solidBack.created[0])));

  // AND IT REOPENS. An import that cannot be reopened is worse than no import
  // at all, and packed geometry that only the session that made it can read
  // would be exactly that.
  const saved = await kernel.model();
  const model = saved.model || saved;
  await mdl.run({ op: "model", model });
  const rows = (await tree()).features.filter(f => f.type === "Imported");
  check("the model file carries it", rows.length === 1 && rows[0].built && !rows[0].error,
        rows.length + " " + (rows[0] ? rows[0].error || "built" : ""));
  check("and the geometry came back", near(await volumeOf(rows[0].id), solid, 1),
        String(await volumeOf(rows[0].id)));

  // AND ONE THAT IS ACTUALLY BIG ENOUGH TO BE PACKED. The cube above is a few
  // kilobytes and packGeometry leaves it alone on purpose, so nothing above
  // this line exercises a packed blob at all - which is precisely the thing
  // that would look like success and be a document nobody can reopen.
  const mesh = ["o Big"];
  for (let i = 0; i < 4000; i++)
    mesh.push("v " + i + " 0 0", "v " + i + " 1 0", "v " + i + " 0 1");
  for (let i = 0; i < 4000; i++)
    mesh.push("f " + (i * 3 + 1) + " " + (i * 3 + 2) + " " + (i * 3 + 3));
  const objText = mesh.join("\n");
  check("the mesh is well past the packing threshold", objText.length > PACK_FROM * 2,
        inKb(objText.length));

  await blank();
  const heavy = "/streamed.obj";
  await stream(heavy, objText, 8192);
  const meshIn = await mdl.run({ op: "import", format: "obj", name: "big.obj",
                                 from: heavy, as: "single" });
  check("it streams in as one mesh", /4000 faces/.test(meshIn.note), meshIn.note);

  const heldModel = (await kernel.model()).model || (await kernel.model());
  const held = (heldModel.features || []).find(f => f.type === "MeshImported");
  check("and the document holds it PACKED, not as the file",
        !!held && isPacked(held.args.obj), held ? held.args.obj.slice(0, 8) : "no feature");
  // Half, not the 7.8x a real BREP gets: this mesh is four thousand distinct
  // numbers with nothing repeated in them, which is close to the worst case
  // there is. The ratio is said out loud rather than asserted at, because what
  // matters is that packing pays on the files people actually import.
  check("which is a good deal smaller than the text that came in",
        held.args.obj.length < objText.length / 2,
        (objText.length / held.args.obj.length).toFixed(1) + "x");

  await mdl.run({ op: "model", model: heldModel });
  const meshRows = (await tree()).features.filter(f => f.type === "MeshImported");
  check("it reopens from the packed form",
        meshRows.length === 1 && meshRows[0].built && !meshRows[0].error,
        meshRows.length + " " + (meshRows[0] ? meshRows[0].error || "built" : ""));
  const backMesh = await at(meshRows[0].id);
  check("with every face still on it",
        !!backMesh.data && backMesh.data.faces === 4000,
        backMesh.data ? String(backMesh.data.faces) : "no data");

  // A BINARY STL, which is the one format that is not text at all. Read off
  // the filesystem as BYTES rather than as text: reading it as any encoding
  // would corrupt every float in it, and the file would still be the right
  // length and still import - into a mesh of noise.
  await blank();
  const count = 2000;
  const stl = new Uint8Array(84 + count * 50);
  const view = new DataView(stl.buffer);
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    const face = [[t, 0, 0], [t + 1, 0, 0], [t, 1, 0]];
    for (let v = 0; v < 3; v++)
      for (let c = 0; c < 3; c++)
        view.setFloat32(84 + t * 50 + 12 + v * 12 + c * 4, face[v][c], true);
  }
  const stlPath = "/streamed.stl";
  for (let at2 = 0; at2 < stl.length; at2 += 4096)
    await kernel.takeUpload({ path: stlPath,
                              bytes: stl.subarray(at2, Math.min(at2 + 4096, stl.length)), at: at2 });
  await kernel.finishUpload({ path: stlPath });
  const stlIn = await mdl.run({ op: "import", format: "stl", name: "bar.stl",
                                from: stlPath, as: "single" });
  check("a binary STL streams in as bytes, not as text",
        /2000 faces/.test(stlIn.note), stlIn.note);
  const stlRow = await at(stlIn.created[0]);
  //! The triangles are a staircase one unit wide, so the corners weld to
  //! 2001 + 2000 vertices rather than 6000. A file read as text would come
  //! back with a different number here, or not read at all.
  check("and the geometry in it is the geometry that went in",
        !!stlRow.data && stlRow.data.count === 4001,
        stlRow.data ? String(stlRow.data.count) : "no data");

  // A DXF, which is surveyed rather than counted: its dialog asks about
  // layers, not about parts.
  const dxf = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
               "0", "SECTION", "2", "ENTITIES"];
  for (let i = 0; i < 300; i++)
    dxf.push("0", "LINE", "8", i % 3 ? "walls" : "grid", "10", String(i * 10), "20", "0",
             "30", "0", "11", String(i * 10 + 8), "21", "40", "31", "0");
  dxf.push("0", "ENDSEC", "0", "EOF");
  const dxfBytes = new TextEncoder().encode(dxf.join("\n"));
  const dxfPath = "/streamed.dxf";
  await kernel.takeUpload({ path: dxfPath, bytes: dxfBytes, at: 0 });
  await kernel.finishUpload({ path: dxfPath });
  const dxfSurveyed = await kernel.surveyUpload({ path: dxfPath, format: "dxf" });
  check("a DXF is surveyed, layers and all",
        !!dxfSurveyed.survey && dxfSurveyed.survey.entities === 300
        && dxfSurveyed.survey.layers.length === 2,
        dxfSurveyed.survey
          ? dxfSurveyed.survey.entities + " on "
            + dxfSurveyed.survey.layers.map(l => l.name).join(",")
          : "no survey");

  await blank();
  const drawn = await mdl.run({ op: "import", format: "dxf", name: "plan.dxf",
                                from: dxfPath, units: "mm", layers: ["walls"] });
  // Two of every three lines are on "walls", so 200 of the 300 arrive - and
  // the report counts what it took, not what it was offered.
  check("and only the layers asked for come in",
        /200 elements from 200 entities/.test(drawn.note), drawn.note);
}

console.log(failures ? "\n" + failures + " failed" : "\nall good");
process.exit(failures ? 1 : 0);
