//! Dimension types - AutoCAD's dimension styles (DIMSTYLE), Revit's dimension types: everything about how a
//! dimension looks lives on its type, so one change restyles every dimension of that type. The settings follow
//! AutoCAD's tabs: Lines, Symbols and Arrows, Text, Fit, Primary Units, Alternate Units, Tolerances. Sizes are
//! paper millimetres (a 2.5 text is 2.5 mm high on the sheet at any scale); the system variable each one
//! corresponds to is named beside it.

import { fmtLength } from "./units.js";

export const DIM_ARROWS = ["Architectural tick", "Oblique", "Closed filled", "Closed blank", "Closed", "Open", "Open 30", "Right angle", "Dot", "Dot small", "Dot blank", "Origin indicator", "Box filled", "Box blank", "Datum triangle filled", "None"];
export const DIM_UNITS = ["Project", "mm", "cm", "m", "in", "ft-in"];
export const DIM_TEXT_V = ["Above", "Centred", "Below"];
export const DIM_TEXT_H = ["Centred", "At extension line 1", "At extension line 2"];
export const DIM_TEXT_ALIGN = ["Aligned with dimension line", "Horizontal", "ISO standard"];
export const DIM_FIT = ["Best fit", "Text outside", "Arrows outside", "Keep inside"];
export const DIM_TOLERANCES = ["None", "Symmetrical", "Deviation", "Limits", "Basic"];

/** Every setting a dimension type has, with its default (ISO-25 like, with ticks as architects draw). */
export const DIM_DEFAULTS = {
  // Lines
  lineColour: "#000000", lineWeight: 0.13,          // DIMCLRD, DIMLWD
  dimExtend: 0,                                     // DIMDLE: the dimension line past the extension lines (with ticks)
  suppressDim1: false, suppressDim2: false,         // DIMSD1, DIMSD2
  extColour: "#000000", extWeight: 0.13,            // DIMCLRE, DIMLWE
  extBeyond: 1.25,                                  // DIMEXE: extension line past the dimension line
  extOffset: 0.625,                                 // DIMEXO: gap between the extension line and what it measures
  extFixed: 0,                                      // DIMFXL: a fixed extension line length (0 = to the object)
  suppressExt1: false, suppressExt2: false,         // DIMSE1, DIMSE2
  // Symbols and arrows
  arrow1: "Architectural tick", arrow2: "Architectural tick",   // DIMBLK1, DIMBLK2
  arrowSize: 2.5,                                   // DIMASZ
  tickWeight: 0.35,                                 // the heavier pen of a tick
  // Text
  font: "Sans", textHeight: 2.5, textColour: "#000000", widthFactor: 1,   // DIMTXSTY, DIMTXT, DIMCLRT
  textFill: "",                                     // DIMTFILL: a background behind the text ("" none)
  textFrame: false,                                 // a box round the text
  textVertical: "Above", textHorizontal: "Centred", // DIMTAD, DIMJUST
  textGap: 0.625,                                   // DIMGAP: from the dimension line to the text
  textAlign: "Aligned with dimension line",         // DIMTIH / DIMTOH
  // Fit
  fit: "Best fit", overallScale: 1,                 // DIMATFIT, DIMSCALE
  // Primary units
  unit: "Project", precision: 0, decimal: ".",      // DIMLUNIT, DIMDEC, DIMDSEP
  roundOff: 0, scaleFactor: 1,                      // DIMRND, DIMLFAC
  prefix: "", suffix: "",                           // DIMPOST
  suppressLeading: false, suppressTrailing: false,  // DIMZIN
  showUnit: false,                                  // write "mm", "m"… after the number
  // Alternate units
  altUnits: false, altUnit: "in", altPrecision: 2, altPlacement: "After",   // DIMALT, DIMALTU, DIMALTD, DIMAPOST
  // Tolerances
  tolerance: "None", tolUpper: 0, tolLower: 0, tolPrecision: 1, tolHeight: 0.7,   // DIMTOL/DIMLIM, DIMTP, DIMTM, DIMTDEC, DIMTFAC
};

/** The types a new document starts with. */
export const DIM_TYPES = {
  "DT-ARCH": { name: "Architectural - tick 2.5" },
  "DT-ISO": { name: "ISO-25 - closed arrow", arrow1: "Closed filled", arrow2: "Closed filled", dimExtend: 0 },
  "DT-DOT": { name: "Dot 2.0", arrow1: "Dot small", arrow2: "Dot small", arrowSize: 2.5, textHeight: 2.0 },
  "DT-STRUCT": { name: "Structural - oblique 3.5, m", arrow1: "Oblique", arrow2: "Oblique", arrowSize: 3, textHeight: 3.5, font: "Arial", unit: "m", precision: 3, dimExtend: 1.5 },
};
export const DEFAULT_DIM_TYPE = "DT-ARCH";

/** A type's settings, every one filled in; an unknown or missing type is the default. */
export function dimStyleOf(doc, typeId) {
  const lib = (doc.lib && doc.lib.dimTypes) || DIM_TYPES;
  const t = lib[typeId] || lib[(doc.meta && doc.meta.defaultDimType) || DEFAULT_DIM_TYPE] || Object.values(lib)[0] || {};
  return Object.assign({}, DIM_DEFAULTS, t);
}

// ---------------------------------------------------------------- the number
const PER_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 };
/** A number in the type's own terms: precision, rounding, decimal separator, zero suppression. */
function number(v, precision, st) {
  let x = st.roundOff > 0 ? Math.round(v / st.roundOff) * st.roundOff : v;
  let s = x.toFixed(Math.max(0, Math.min(8, precision | 0)));
  if (st.suppressTrailing && s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (st.suppressLeading) s = s.replace(/^(-?)0\./, "$1.");
  return st.decimal && st.decimal !== "." ? s.replace(".", st.decimal) : s;
}
function inUnit(doc, mm, unit, precision, st, withUnit) {
  const u = unit === "Project" ? ((doc.meta && doc.meta.displayUnits) || "mm") : unit;
  if (u === "ft-in") return fmtLength(mm, { unit: "ft-in" });
  const f = PER_MM[u] || 1;
  return number(mm / f, precision, st) + (withUnit ? (u === "in" ? '"' : " " + u) : "");
}
/** What a dimension writes: its value in the primary units (with prefix and suffix), the alternate units,
 *  and tolerances - `{ main, alt, altBelow, tol: { kind, up, low } }`. An override replaces the value;
 *  "<>" in it stands for the measured value, as in AutoCAD. */
export function formatDimension(doc, st, valueMm, over = {}) {
  const v = valueMm * (st.scaleFactor || 1);
  let main = inUnit(doc, v, st.unit, st.precision, st, st.showUnit);
  const val = main;
  main = `${st.prefix || ""}${main}${st.suffix || ""}`;
  if (over.value) main = String(over.value).replace(/<>/g, val);
  if (over.prefix) main = over.prefix + main;
  if (over.suffix) main = main + over.suffix;
  const alt = st.altUnits ? inUnit(doc, v, st.altUnit, st.altPrecision, st, true) : "";
  let tol = null;
  if (st.tolerance === "Symmetrical") tol = { kind: "sym", up: "±" + inUnit(doc, st.tolUpper, st.unit, st.tolPrecision, st, false) };
  else if (st.tolerance === "Deviation") tol = { kind: "dev", up: "+" + inUnit(doc, st.tolUpper, st.unit, st.tolPrecision, st, false), low: "-" + inUnit(doc, st.tolLower, st.unit, st.tolPrecision, st, false) };
  else if (st.tolerance === "Limits") { const hi = inUnit(doc, v + st.tolUpper, st.unit, st.precision, st, false), lo = inUnit(doc, v - st.tolLower, st.unit, st.precision, st, false); main = hi; tol = { kind: "lim", low: lo }; }
  else if (st.tolerance === "Basic") tol = { kind: "basic" };
  return { main, alt, altBelow: st.altPlacement === "Below", tol };
}
