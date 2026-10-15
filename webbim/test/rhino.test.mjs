// Provide Python, run in a stand-in Rhino (test/rhino): the first run makes everything; the same script again changes
// nothing; a newer export after edits renames the level's layers, moves the slab onto its new level's layer and
// deletes what is gone. Skipped where python3 is not installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildNexusSample } from "../src/sample_nexus.js";
import { rhinoScript } from "../src/rhinoexport.js";
import { Editor } from "../src/ops.js";

let py = null; try { execFileSync("python3", ["--version"]); py = "python3"; } catch (e) { /* none */ }
test("Provide Python keeps Rhino in step with the project", { skip: py ? false : "python3 is not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wbrhino-")), doc = buildNexusSample(), ed = new Editor(doc);
  ed.apply({ op: "add", element: { id: "FL-T", type: "Floor", name: "Test slab", args: { boundary: [[300000, 300000], [320000, 300000], [320000, 320000], [300000, 320000]], floorType: { ref: "T-NX-SLAB" }, level: { ref: "L05" } } } });
  const v1 = await rhinoScript(doc); fs.writeFileSync(path.join(dir, "v1.py"), v1.text);
  ed.apply([{ op: "set", id: "FL-T", key: "level", value: { ref: "L06" } }, { op: "set", id: "FL-T", key: "Name", value: "Test slab on L06" }]);
  ed.apply([{ op: "set", id: "L06", key: "name", value: "L06T" }]);
  const use = doc.argValue(doc.element("MG1"), "use"), gone = Object.keys(use.L06)[0];
  ed.apply({ op: "meshedit", id: "MG1", use: { L06: { [gone]: null } } });
  const v2 = await rhinoScript(doc); fs.writeFileSync(path.join(dir, "v2.py"), v2.text);
  const out = execFileSync(py, [path.resolve("test/rhino/run.py"), path.join(dir, "v1.py"), path.join(dir, "v1.py"), path.join(dir, "v2.py")], { encoding: "utf8", maxBuffer: 64 << 20 }).trim().split("\n").filter(l => l.startsWith("{")).map(l => JSON.parse(l));
  const [r1, r2, r3] = out;
  assert.equal(r1.counts["objects added"], v1.stats.objects, "first run adds every object");
  assert.equal(r1.counts["layers added"], v1.stats.layers);
  assert.equal(r1.pages, v1.stats.sheets); assert.equal(r1.details, v1.stats.details);
  assert.ok(r1.clips_with_viewports >= 17, "each plan's clipping plane clips its detail");
  assert.equal(r2.counts["objects unchanged"], v1.stats.objects, "the same script again changes nothing");
  assert.ok(!r2.counts["objects added"] && !r2.counts["objects deleted"] && !r2.counts["objects updated"]);
  assert.equal(r2.pages, v1.stats.sheets, "layouts are found again, not doubled");
  assert.equal(r3.counts["layers renamed"], 1, "the renamed level renames its layer");
  assert.ok(r3.counts["objects deleted"] >= 1 && r3.counts["objects updated"] >= 1);
  assert.match(r3.where["FL-T"], /::L06T \+38\.000::Slabs$/, "the slab moved up a level is on that level's layer");
  assert.ok(!(`MG1:L06:${gone}` in r3.where), "the cell no longer used on L06 is gone from it");
  assert.deepEqual(r3.duplicates, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
