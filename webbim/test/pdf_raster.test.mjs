// §12.3: verify stroke width by rasterising the exported PDF and measuring ink —
// the only check that exercises scene → CTM → writer → rasteriser together.
// 1 mm at 600 dpi = 23.622 px; the same line in viewports at 1:20 and 1:200.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { newDocument } from "../src/bim.js";
import { Editor } from "../src/ops.js";
import { deriveView } from "../src/scene.js";
import { writePDF } from "../src/pdf.js";

function havePyMuPDF() { try { execFileSync("python3", ["-c", "import pymupdf"], { stdio: "ignore" }); return true; } catch (e) { return false; } }
const MEASURE = `
import sys, pymupdf
doc = pymupdf.open(sys.argv[1]); pix = doc[0].get_pixmap(dpi=600, colorspace=pymupdf.csGRAY)
w, h, s = pix.width, pix.height, pix.samples
x = int(round(float(sys.argv[2]) / 25.4 * 600)); col = [255 - s[y * w + x] for y in range(h)]
bands, y = [], 0
while y < h:
    if col[y] > 0:
        a = y
        while y < h and col[y] > 0: y += 1
        bands.append(sum(col[a:y]) / 255.0)
    y += 1
print(",".join("%.3f" % b for b in bands))
`;

test("28e1/28e2 · 1mm line rasterised at 600 dpi, viewports at 1:20 and 1:200", { skip: havePyMuPDF() ? false : "PyMuPDF not installed (pip install pymupdf)" }, () => {
  const doc = newDocument("raster"), ed = new Editor(doc);
  doc.addElement({ id: "L0", type: "Level", args: { name: "G", elevation: 0 } });
  for (const [id, sc] of [["V20", 20], ["V200", 200]]) {
    doc.addElement({ id, type: "PlanView", name: id, args: { level: { ref: "L0" }, scale: sc, style: { ref: "VS-CONSTRUCTION" }, clip: { rect: [-100, -100, 100 * sc + 100, 100], active: true } } });
    // a detail line 100 mm long on paper at each scale, drawn with pen "extra" (1.00 mm)
    doc.addElement({ id: "DL" + sc, type: "DetailLine", args: { curve: { type: "line", start: [0, 0], end: [100 * sc, 0] }, pen: "heavy", view: { ref: id } } });
  }
  ed.apply({ op: "type", lib: "pens", id: "PEN-ISO", path: "pens.heavy.weight", value: 1.0 });
  doc.addElement({ id: "SH", type: "Sheet", args: { number: "T-1", sheetName: "Raster", size: "A3", orientation: "landscape", viewports: [{ id: "VP1", view: { ref: "V20" }, at: [120, 200] }, { id: "VP2", view: { ref: "V200" }, at: [120, 100] }] } });
  doc.regenerate();
  const sc = deriveView(doc, doc.element("SH"));
  // the viewports only (no border, no titles): nothing else crosses the measured column
  const prims = sc.prims.filter(p => p.t === "group");
  const pdf = writePDF([{ size: sc.size, prims, links: [], title: "T-1" }]);
  const f = path.join(os.tmpdir(), "webbim-raster.pdf"), py = path.join(os.tmpdir(), "webbim-measure.py");
  fs.writeFileSync(f, pdf.bytes); fs.writeFileSync(py, MEASURE);
  // Both lines are centred on x = 120 mm. Walk the column and sum ink per band
  // (antialiasing included): a band's coverage in pixels is its width.
  const bands = execFileSync("python3", [py, f, "120"]).toString().trim().split(",").map(Number);
  assert.equal(bands.length, 2, `expected two ink bands (1:20 and 1:200), measured ${bands.join(", ")}`);
  for (const b of bands) assert.ok(Math.abs(b - 23.622) <= 0.5, `1 mm line measured ${b} px at 600 dpi; expected 23.622 ± 0.5 (bands ${bands.join(", ")})`);
});
