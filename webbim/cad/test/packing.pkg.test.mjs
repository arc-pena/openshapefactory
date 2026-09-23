// Space Packing, as a package.
//
// The arithmetic is checked in packing.test.mjs against numbers anybody can
// work out. What is checked here is the other half: that it is a PACKAGE -
// declared before it runs, its node absent from the catalogue until it is
// loaded and a real node afterwards, refusing to unload while somebody is
// using it - and that the node really builds, in the real kernel, out of a
// real envelope.
//
// And the failure that would look like success, which for this one is the
// whole point of the package: a packer that quietly drops what does not fit
// builds a tidy model and reports a happy number. So the committed solid is
// counted against the brief, and the report it carries has to name what was
// left out.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { PluginHost, availablePlugins, findPlugin } from "../src/plugin.js";
import { PACKING, PACKING_NODES, envelopeMesh, packRun } from "../src/packing-plugin.js";
import { meshVolume, readBrief, sampleBrief } from "../src/packing.js";
import { typeSpec } from "../src/ocaf.js";
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
const at = async id => ((await kernel.tree()).tree.features).find(f => f.id === id);

console.log("1. it is declared before it runs");
{
  check("it is on the shelf", !!findPlugin("packing"));
  check("and says what it is for", PACKING.summary.length > 60);
  check("it declares its node with the package off",
        PACKING_NODES.length === 1 && PACKING_NODES.every(n => n.type && n.guid && n.args));
  check("which is not in the catalogue yet",
        PACKING_NODES.every(n => typeSpec(n.type) === null));
  check("it declares its API operation by operation",
        PACKING.api.operations.length >= 6
        && PACKING.api.operations.every(o => o.name && o.takes && o.gives && o.summary));
  check("and a mode", PACKING.view.key === "packing" && PACKING.view.label === "Packing");
  check("the shelf lists it while it is off",
        availablePlugins().some(p => p.id === "packing"));
  check("it says what kind of number it gives - a heuristic, and it says so",
        /NP-hard|heuristic/i.test(PACKING.api.summary),
        "a packer that implies its answer is optimal is lying about the hardest part");
  check("and that it is not a code check", /code check/i.test(PACKING.api.summary),
        "geometry is not permission to build");
}

console.log("\n2. loading it, building with it, putting it away");
{
  const host = new PluginHost({
    toolkit: () => kernel.toolkit(),
    installDrivers: (specs, builders) => kernel.installDrivers(specs, builders),
    removeDrivers: specs => kernel.removeDrivers(specs),
    typesInUse: types => kernel.typesInUse(types),
  });
  const told = host.schema();
  check("the assistant is told it exists while it is off",
        told.available.some(p => p.id === "packing"));

  await host.load("packing");
  check("loaded", host.isLoaded("packing"));
  check("its node is a catalogue type like any other",
        PACKING_NODES.every(n => typeSpec(n.type) !== null));

  // A real envelope: a 30 by 20 by 11 m block, built by the kernel.
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "P",
                           units: "mm", features: [] });
  const origin = (await kernel.addFeature("Point", {})).id;
  const block = (await kernel.addFeature("Cube", { origin })).id;
  for (const [key, value] of [["dx", 30000], ["dy", 20000], ["dz", 11000]])
    await kernel.setParameter(block, key, value);

  const brief = ["Office A, 120, 3.0, 1.5, 2", "Office B, 120, 3.0, 1.5, 2",
                 "Studio, 200, 3.0, 1.2, 3", "Store, 40, 2.6, 1, 1",
                 "Hall, 3000, 3.0, 1, 1"].join("\n");
  const plan = (await kernel.addFeature("SpacePlan", { envelope: block })).id;
  await kernel.setCode(plan, "brief", brief);
  let entry = await at(plan);
  check("a package node builds in the real kernel", !entry.error, entry.error || "");
  check("and it is a solid, so everything downstream can take it",
        entry.produces === "solid");

  // Four of the five fit in 600 m² a storey; the 3000 m² hall cannot, in any
  // storey, and that is the whole finding.
  check("it says what went in and what did not",
        /4 of 5 rooms placed/.test(entry.data.preview), entry.data.preview);
  check("and names the one that did not fit rather than dropping it",
        /not placed . Hall/.test(entry.data.preview), entry.data.preview);
  check("with the area it wanted, so the finding is a number and not a shrug",
        /3000 m²/.test(entry.data.preview), entry.data.preview);

  // The number that would look right if rooms were being silently dropped: the
  // volume of what was actually built.
  const meshed = (await kernel.mesh([plan])).features[0];
  const want = (120 + 120 + 200 + 40) * 1e6 * 3000;      // four rooms, 3 m and 2.6 m tall
  const built = meshVolume(meshed);
  check("and the solid it built really is those four rooms",
        near(built / 1e9, (120 * 3 + 120 * 3 + 200 * 3 + 40 * 2.6), 1),
        (built / 1e9).toFixed(1) + " m³ of rooms");

  // Change the envelope and the plan rebuilds with it - which is the whole
  // reason this is a node rather than a screenshot. A 3000 m² hall needs a
  // 3000 m² plate, so it is the FOOTPRINT that has to grow: making the
  // building taller does nothing for a room that is too big in plan, and a
  // packer that let it in on a taller envelope would be packing by volume,
  // which is the mistake that puts a sports hall on three floors at once.
  await kernel.setParameter(block, "dz", 25000);
  entry = await at(plan);
  check("a taller envelope does NOT admit a room that is too big in plan",
        /not placed . Hall/.test(entry.data.preview), entry.data.preview);
  await kernel.setParameter(block, "dx", 90000);
  await kernel.setParameter(block, "dy", 60000);
  entry = await at(plan);
  check("a wider one does, and it packs again on rebuild",
        /5 of 5 rooms placed/.test(entry.data.preview), entry.data.preview);
  check("and nothing is reported outstanding any more",
        !/not placed/.test(entry.data.preview), entry.data.preview);

  await kernel.setParameter(block, "dx", 30000);
  await kernel.setParameter(block, "dy", 20000);
  await kernel.setParameter(block, "dz", 2000);
  entry = await at(plan);
  check("squash it under the headroom and it refuses rather than inventing one",
        !!entry.error, entry.error || "it built something out of nothing");
  await kernel.setParameter(block, "dz", 11000);

  let refused = "";
  try { await host.unload("packing"); } catch (e) { refused = e.message; }
  check("it will not unload while its node is in the model",
        /still in the model/.test(refused), refused);

  await kernel.deleteFeature(plan);
  await host.unload("packing");
  check("with the node gone it unloads", !host.isLoaded("packing"));
  check("and its type leaves the catalogue with it",
        PACKING_NODES.every(n => typeSpec(n.type) === null));
  await host.load("packing");
  check("and it loads again cleanly",
        host.isLoaded("packing") && PACKING_NODES.every(n => typeSpec(n.type) !== null));
  await host.unload("packing");
}

console.log("\n3. both kinds of envelope, and only one of them is tessellated");
{
  const host = new PluginHost({
    toolkit: () => kernel.toolkit(),
    installDrivers: (specs, builders) => kernel.installDrivers(specs, builders),
    removeDrivers: specs => kernel.removeDrivers(specs),
    typesInUse: types => kernel.typesInUse(types),
  });
  await host.load("packing");
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "P",
                           units: "mm", features: [] });
  const origin = (await kernel.addFeature("Point", {})).id;
  const plane = (await kernel.addFeature("Plane", {})).id;
  const block = (await kernel.addFeature("Cube", { origin })).id;
  for (const [key, value] of [["dx", 24000], ["dy", 16000], ["dz", 8000]])
    await kernel.setParameter(block, key, value);
  const grid = (await kernel.addFeature("MeshBox", { origin, plane })).id;
  for (const [key, value] of [["dx", 24000], ["dy", 16000], ["dz", 8000]])
    await kernel.setParameter(grid, key, value);

  const brief = readBrief(["A, 60, 3, 1.4, 1", "B, 60, 3, 1.4, 1", "C, 60, 3, 1.4, 1"].join("\n"));
  const fromBrep = (await kernel.mesh([block])).features[0];
  const fromMesh = (await kernel.mesh([grid])).features[0];
  check("a BRep envelope and a mesh envelope of the same size hold the same volume",
        near(meshVolume(fromBrep) / 1e9, meshVolume(fromMesh) / 1e9, 1),
        (meshVolume(fromBrep) / 1e9).toFixed(0) + " vs " + (meshVolume(fromMesh) / 1e9).toFixed(0));
  const one = packRun(fromBrep, brief, { storey: 3500, gap: 300 });
  const two = packRun(fromMesh, brief, { storey: 3500, gap: 300 });
  check("and pack the same", one.placed.length === two.placed.length && one.placed.length === 3,
        one.placed.length + " vs " + two.placed.length);

  // And through the driver's own reader, which is the path the node takes.
  const treeNow = (await kernel.tree()).tree.features;
  check("the mesh envelope is read as triangles without being tessellated",
        treeNow.some(f => f.id === grid && f.produces === "mesh"),
        "a mesh is already triangles - converting one would lose the vertices "
        + "somebody moved by hand");
  await host.unload("packing");
}

console.log("\n4. the sample, on a real envelope");
{
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "P",
                           units: "mm", features: [] });
  const origin = (await kernel.addFeature("Point", {})).id;
  const block = (await kernel.addFeature("Cube", { origin })).id;
  for (const [key, value] of [["dx", 40000], ["dy", 28000], ["dz", 14000]])
    await kernel.setParameter(block, key, value);
  const mesh = (await kernel.mesh([block])).features[0];
  const brief = sampleBrief(mesh, { seed: 3, storey: 3500 });
  check("it invents a brief for whatever is in the document", brief.length > 5,
        brief.length + " rooms");
  const run = packRun(mesh, brief, { storey: 3500, gap: 300 });
  check("and most of it goes in", run.placed.length > brief.length * 0.6,
        run.placed.length + " of " + brief.length);
  check("with the report counting the same rooms the boxes are drawn from",
        run.report.placed === run.placed.length
        && run.report.unplaced === run.unplaced.length
        && run.report.rooms === brief.length);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
