//! Units: the model is millimetres, always; the project chooses how lengths are SHOWN.
//!
//! As in CATIA and OpenCascade, a quantity is a length whatever it is written in. A field takes any
//! unit and any maths - `10m`, `3'-6"`, `2*1.2m + 300mm`, `span/2` - and the model stores the
//! length. The project's display unit (meta.displayUnits, saved with the file) decides only how a
//! length is written back: in Properties, in temporary dimensions, on the drawings. A number typed
//! with no unit is read in the display unit, as Revit does (in feet-and-inches it is feet).

import { parse, evaluate, ExprError, setQuantityDisplay } from "./expr.js";

export const LENGTH_UNITS = {
  mm: { label: "Millimetres (mm)", f: 1, dp: 0, suffix: "mm" },
  cm: { label: "Centimetres (cm)", f: 10, dp: 1, suffix: "cm" },
  m: { label: "Metres (m)", f: 1000, dp: 3, suffix: "m" },
  "ft-in": { label: "Feet and fractional inches (ft-in)", f: 304.8, imperial: true },
  in: { label: "Fractional inches (in)", f: 25.4, imperial: true },
};
let current = "mm";
export const setLengthUnit = u => { current = LENGTH_UNITS[u] ? u : "mm"; };
export const lengthUnit = () => current;
/** Millimetres in one bare (unit-less) number, in a unit setting. */
export const bareFactor = (u = current) => (LENGTH_UNITS[u] || LENGTH_UNITS.mm).f;
export const isImperial = (u = current) => !!(LENGTH_UNITS[u] || {}).imperial;

const unitTrim = s => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
/** Inches as whole + a fraction to 1/den, reduced: 11.625 → "11 5/8". */
function inchText(inches, den = 16) {
  let whole = Math.floor(inches + 1e-9), n = Math.round((inches - whole) * den);
  if (n === den) { whole += 1; n = 0; }
  if (!n) return String(whole);
  let d = den; while (n % 2 === 0 && d % 2 === 0) { n /= 2; d /= 2; }
  return whole ? `${whole} ${n}/${d}` : `${n}/${d}`;
}
/** A length (mm) written in a unit setting. `suffix: false` is how dimension strings read (metric
 *  bare, imperial always with its marks); `fixed` keeps a metric unit's decimals. */
export function fmtLength(v, { unit = current, suffix = true, fixed = false } = {}) {
  if (!Number.isFinite(v)) return "—";
  const U = LENGTH_UNITS[unit] || LENGTH_UNITS.mm, neg = v < 0 ? "-" : "", a = Math.abs(v);
  if (unit === "ft-in") {
    const inches = a / 25.4; let ft = Math.floor(inches / 12 + 1e-9), rest = inches - ft * 12;
    let r = inchText(rest); if (r === "12") { ft += 1; r = "0"; }
    return `${neg}${ft}' - ${r}"`;
  }
  if (unit === "in") return `${neg}${inchText(a / 25.4)}"`;
  let s = (a / U.f).toFixed(U.dp === 0 ? (Math.abs(a - Math.round(a)) < 1e-6 ? 0 : 1) : U.dp);
  if (!fixed) s = unitTrim(s);
  return neg + s + (suffix ? " " + U.suffix : "");
}
/** Areas: m² in metric, ft² in imperial. Volumes likewise. */
export const fmtArea = (mm2, unit = current) => isImperial(unit) ? `${unitTrim((mm2 / 92903.04).toFixed(2))} ft²` : `${unitTrim((mm2 / 1e6).toFixed(2))} m²`;
export const fmtVolume = (mm3, unit = current) => isImperial(unit) ? `${unitTrim((mm3 / 28316846.6).toFixed(2))} ft³` : `${unitTrim((mm3 / 1e9).toFixed(3))} m³`;
/** What a length field's text is worth, in mm: any unit, any maths, names through `lookup`. */
export function parseLength(text, { unit = current, lookup } = {}) {
  const src = String(text).trim(); if (!src) throw new ExprError("type a length");
  const v = evaluate(parse(src), { lookup, into: "Length", bare: bareFactor(unit) });
  if (v.kind !== "Length" && v.kind !== "Number") throw new ExprError(`that is ${v.kind === "Angle" ? "an angle" : "a " + v.kind.toLowerCase()}, not a length`);
  return v.kind === "Number" ? v.v * bareFactor(unit) : v.v;
}
/** Angles: degrees unless a unit says otherwise (`0.5rad`). */
export function parseAngle(text, { lookup } = {}) {
  const v = evaluate(parse(String(text).trim()), { lookup, into: "Angle" });
  if (v.kind !== "Angle" && v.kind !== "Number") throw new ExprError(`that is not an angle`);
  return v.v;
}
/** Plain numbers (counts, factors): maths allowed, units not. */
export function parseNumber(text, { lookup } = {}) {
  const v = evaluate(parse(String(text).trim()), { lookup, into: "Number" });
  if (v.kind !== "Number") throw new ExprError(`that is a ${v.kind.toLowerCase()}; a plain number is wanted here`);
  return v.v;
}
// every formatted quantity - Properties, schedules, tags - goes through the project's units
setQuantityDisplay({ length: v => fmtLength(v), area: v => fmtArea(v), volume: v => fmtVolume(v) });
