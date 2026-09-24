//! Catalogue sections as project types. The catalogue (sections.js) stays outside the document -
//! 2 300 rows would swell every saved file - and a section becomes a type only when it is loaded,
//! as a Revit family type is: one row in doc.lib.types, the same for a beam or a column.

import { SECTION_CATALOGUE } from "./sections.js";

/** Every row flattened, with where it came from: {std, family, shape, name, dims, check}. */
export function sectionRows() {
  const out = [];
  for (const s of SECTION_CATALOGUE) for (const f of s.families) for (const r of f.items)
    out.push({ std: s.std, family: f.name, shape: f.shape, name: r[0], dims: r.slice(1), check: !!s.check });
  return out;
}
/** A catalogue row by standard and name ("American (AISC)", "W14x90"). */
export function findSection(std, name) {
  const s = SECTION_CATALOGUE.find(x => x.std === std); if (!s) return null;
  for (const f of s.families) { const r = f.items.find(x => x[0] === name); if (r) return { std, family: f.name, shape: f.shape, name: r[0], dims: r.slice(1), check: !!s.check }; }
  return null;
}
/** Short label of a row's sizes in mm. */
export function sectionLabel(r) {
  const [a, b, c, d] = r.dims;
  return r.shape === "I" ? `${a} × ${b} · tw ${c} · tf ${d}` : r.shape === "RHS" ? `${a} × ${b} × ${c}` : `Ø${a} × ${b}`;
}
const STD_TAG = { "American (AISC)": "US", "European (EN)": "EU", "British (BS 4)": "UK", "Australian (AS/NZS)": "AU" };
/** The type id and definition a row loads as, for a category (IfcColumn or IfcBeam). */
export function sectionType(r, category) {
  const [a, b, c, d] = r.dims, col = category === "IfcColumn";
  const geo = r.shape === "I" ? { shape: "I", depth: a, width: b, web: c, flange: d }
    : r.shape === "RHS" ? { shape: "RHS", depth: a, width: b, thick: c } : { shape: "CHS", width: a, depth: a, thick: b };
  const tag = STD_TAG[r.std] || "X";
  const id = `T-${col ? "C" : "B"}-${tag}-${r.name.replace(/[^A-Za-z0-9.]+/g, "")}`;
  return { id, value: Object.assign({ family: col ? "F-COLUMN" : "F-STEELBEAM", name: `${r.name} (${tag})`, mark: r.name, material: "M-STEEL", section: `${r.std} ${r.name}`, standard: r.std }, geo) };
}
