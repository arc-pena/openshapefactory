// The samples, opened the way the menu opens them.
//
// A sample is the first thing somebody clicks, so a broken one is the first
// thing they see. Two of them are written into src/ocaf.js and are covered
// where they are used; these are the ones kept as model files in data/samples/,
// and they are checked three ways: the file the menu asks for is there, it is a
// model this program can read, and every node in it builds against a real
// kernel. A sample that opens with red in the tree is not a sample.
//
// The list and the folder are checked against each other as well. docs/build.py
// packs a named file per sample into the single-file build, and a sample whose
// file nobody packs loads from the served site and not from the Artifact -
// which is the kind of difference only somebody else ever finds.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { SAMPLES } from "../src/ocaf.js";
import { readFileSync, readdirSync } from "fs";

const WASM_DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const initModule = (await import(WASM_DIR + "/replicad_single.js")).default;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};

const kernel = await createWasmKernel({
  initModule, wasmBinary: readFileSync(WASM_DIR + "/replicad_single.wasm"),
});
const tree = async () => (await kernel.tree()).tree;

const kept = SAMPLES.filter(one => one.file);

// Samples whose point is the diagnosis. The node is named, so this is a claim
// about one node in one file and not a blanket excuse.
const ALLOWED = { fillsurface: [{ id: "FI2", name: "FillSurface.2" }] };

console.log("1. the list and the folder agree");
{
  check("the menu offers samples kept as files", kept.length > 0,
    kept.map(one => one.key).join(","));
  const onDisk = readdirSync("docs/data/samples").filter(n => n.endsWith(".json")).sort();
  const listed = kept.map(one => one.file.replace(/^samples\//, "")).sort();
  check("every file in the folder is one the menu lists",
    onDisk.join(",") === listed.join(","), onDisk.join(",") + " vs " + listed.join(","));
  const packed = readFileSync("docs/build.py", "utf8");
  const missing = kept.filter(one => !packed.includes('"' + one.key + '"'));
  check("and build.py packs each of them into the single file",
    missing.length === 0, missing.map(one => one.key).join(","));
  check("no two samples share a key",
    new Set(SAMPLES.map(one => one.key)).size === SAMPLES.length);
  check("every sample says what it is",
    SAMPLES.every(one => one.name && one.summary && (one.model || one.file)));
}

for (const sample of kept) {
  console.log("\n" + sample.name + " — " + sample.file);
  let model = null;
  try { model = JSON.parse(readFileSync("docs/data/" + sample.file, "utf8")); }
  catch (error) { check("the file is there and is JSON", false, error.message); continue; }
  check("it says what it is", model.format === "ocaf-parametric-model", String(model.format));
  check("it has nodes in it",
    Array.isArray(model.features) && model.features.length > 0,
    String(model.features && model.features.length));

  const built = await kernel.loadModel(model);
  const bad = (await tree()).features.filter(f => f.error);
  const said = bad.map(f => f.name + ": " + f.error).join(" | ");
  // ONE SAMPLE REPORTS ON PURPOSE. fillsurface's second patch is drawn over a
  // loop with a 500 mm gap in it, and the node saying so - naming both loose
  // ends - is the thing that sample is worth opening for. Named here rather
  // than tolerated in general, so a sample that breaks some OTHER way still
  // fails this.
  const allowed = ALLOWED[sample.key] || [];
  const loud = bad.filter(f => !allowed.some(one => one.name === f.name));
  check("every node built",
    built.report.failed.filter(f => !allowed.some(one => one.id === f.id)).length === 0,
    JSON.stringify(built.report.failed.map(f => f.id + ": " + f.message)));
  check("and nothing is left in error that should not be", loud.length === 0, said);
  for (const one of allowed)
    check("\"" + one.name + "\" still says what is wrong with it",
      bad.some(f => f.name === one.name), said || "it built without complaint");
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
