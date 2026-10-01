// node projects/wetlap/build.mjs [--pdf A0100,A0800 ...]
// Builds the Wetlap project from its extracted data (data/) and writes wetlap.json beside this file: a web-bim
// document to open with File > Open. With --pdf, also writes those sheets (or all) to out/<number>.pdf for checking
// against the set (tools/ovs.py).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildWetlap } from "./wetlap.js";

const here = path.dirname(fileURLToPath(import.meta.url)), data = p => path.join(here, "data", p);
const t0 = Date.now();
const set = JSON.parse(fs.readFileSync(data("wetlap_set.json"), "utf8"));
const lift = JSON.parse(fs.readFileSync(data("wl_lift.json"), "utf8"));
const fix = JSON.parse(fs.readFileSync(data("wl_fix.json"), "utf8"));
const fin = JSON.parse(fs.readFileSync(data("wl_fin.json"), "utf8"));
const site = JSON.parse(fs.readFileSync(data("wl_site.json"), "utf8"));
const doc = buildWetlap({ set, lift, fix, fin, site });
const errs = doc.elements().filter(f => doc.error(f));
console.log(`built in ${Date.now() - t0} ms: ${doc.elements().length} elements, ${errs.length} with errors`);
for (const f of errs.slice(0, 12)) console.log("  ", doc.idOf(f), doc.error(f));
const json = JSON.stringify(doc.toJSON()) + "\n";           // compact: the drafted layers are long flat arrays
fs.writeFileSync(path.join(here, "wetlap.json"), json);
console.log(`wetlap.json: ${(json.length / 1e6).toFixed(1)} MB`);

const i = process.argv.indexOf("--pdf");
if (i > 0) {
  const { sheetScene } = await import("../../src/scene.js"), { writePDF } = await import("../../src/pdf.js");
  const want = (process.argv[i + 1] || "").split(",").filter(Boolean);
  fs.mkdirSync(path.join(here, "out"), { recursive: true });
  for (const sh of doc.elements().filter(f => doc.typeOf(f) === "Sheet")) {
    const n = doc.argValue(sh, "number"); if (want.length && !want.includes(n)) continue;
    const t1 = Date.now(), sc = sheetScene(doc, sh);
    fs.writeFileSync(path.join(here, "out", `${n}.pdf`), Buffer.from(writePDF([{ size: sc.size, prims: sc.prims, title: n }]).bytes));
    console.log(`  ${n}.pdf ${Date.now() - t1} ms`);
  }
}
