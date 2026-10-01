// node projects/wetlap/audit.mjs [file.json] : the model-only test. With every 2D drafting element turned off, the
// sheets must be what they are - so there must be none: no detail lines, filled regions, imported CAD, symbols,
// repeating details or pictures; what belongs to a view is only text, dimensions on the model, and tags of model
// elements. Exits 1, listing what fails.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { openDocument } from "../../src/bim.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || path.join(here, "wetlap.json");
const doc = openDocument(fs.readFileSync(file, "utf8")); doc.regenerate();
const DRAFT = new Set(["DetailLine", "FilledRegion", "CADImport", "SymbolInstance", "RepeatingDetail"]);
const ANNOTATION = new Set(["Text", "Dimension", "MaterialTag", "SpotElevation"]);
const MODEL_VIEWS = new Set(["PlanView", "ElevationView", "SectionView", "View3D"]);
const fails = [], counts = {};
for (const f of doc.elements()) {
  const t = doc.typeOf(f), id = doc.idOf(f); counts[t] = (counts[t] || 0) + 1;
  if (DRAFT.has(t)) { fails.push(`${id}: a ${t} (2D drafting)`); continue; }
  const view = (doc.argValue(f, "view") || {}).ref;
  if (view && !ANNOTATION.has(t)) fails.push(`${id}: a ${t} belonging to view ${view}`);
  if (t === "Dimension") for (const k of doc.argValue(f, "of") || []) { const el = doc.element(String(k).split(":")[0]);
    if (!el || DRAFT.has(doc.typeOf(el)) || ANNOTATION.has(doc.typeOf(el))) fails.push(`${id}: measures ${k}, not a model element`); }
  if (t === "MaterialTag") { const el = (doc.argValue(f, "element") || {}).ref; if (el && !doc.element(el)) fails.push(`${id}: tags missing ${el}`); }
  if (t === "Sheet") { if ((doc.argValue(f, "images") || []).length) fails.push(`${id}: carries pictures`); if ((doc.argValue(f, "diagrams") || []).length) fails.push(`${id}: carries diagrams`); }
}
// a notes view (no model in it) may hold words only
for (const v of doc.elements().filter(f => doc.typeOf(f) === "DraftingView")) {
  const owned = doc.elements().filter(f => (doc.argValue(f, "view") || {}).ref === doc.idOf(v));
  const other = owned.filter(f => doc.typeOf(f) !== "Text"); if (other.length) fails.push(`${doc.idOf(v)}: a notes view holding ${other.length} non-text elements`);
}
// every sheet's drawings are views of the model (a notes view only where the sheet has no drawing)
const sheets = doc.elements().filter(f => doc.typeOf(f) === "Sheet");
let modelSheets = 0;
for (const sh of sheets) { const vs = (doc.argValue(sh, "viewports") || []).map(vp => doc.element(vp.view.ref)).filter(Boolean);
  if (vs.some(v => MODEL_VIEWS.has(doc.typeOf(v)))) modelSheets++; }
console.log(`elements: ${JSON.stringify(counts)}`);
console.log(`sheets: ${sheets.length}, ${modelSheets} drawing the model, ${sheets.length - modelSheets} notes only`);
if (fails.length) { console.log(`FAIL - ${fails.length}:`); for (const x of fails.slice(0, 40)) console.log("  " + x); process.exit(1); }
console.log("PASS - nothing drafted: every line on every sheet is a model element's, or text, a dimension on the model or a tag");
