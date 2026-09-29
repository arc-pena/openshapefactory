//! The CAD goodies library: 978 blocks from cad_goodies.dxf - people, vehicles, trees and plants, furniture,
//! fixtures, doors, site furniture, sports fields, north arrows - each named by what it is (from its block's coded
//! name or, where the name says nothing, from how it looks), sorted into categories and views, and sized true in mm.
//! Kept compressed and decoded on first use; a symbol is loaded into a project (as Revit loads a family) when placed.

import { CADLIB_Z } from "./cadlib_data.js";
import { inflateRaw } from "./inflate.js";

let LIB = null;
function load() {
  if (LIB) return LIB;
  const bin = typeof atob === "function" ? atob(CADLIB_Z) : Buffer.from(CADLIB_Z, "base64").toString("binary");
  const z = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) z[i] = bin.charCodeAt(i);
  const raw = inflateRaw(z), n = raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24);
  const index = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + n)));
  index.forEach((s, i) => { s.id = `SY-CL-${String(i + 1).padStart(4, "0")}`; });
  LIB = { index, geo: raw.subarray(4 + n) };
  return LIB;
}
/** Every symbol in the library: id, name (n), category (c), view (v), source block (b), size (w, h) in mm. */
export function cadLibraryIndex() { return load().index; }
/** The categories, with how many symbols each holds. */
export function cadLibraryCategories() { const m = new Map(); for (const s of load().index) m.set(s.c, (m.get(s.c) || 0) + 1); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])); }
/** A symbol's polylines (and solid fills) in mm about its insertion point. */
export function cadLibraryGeometry(id) {
  const L = load(), s = L.index.find(q => q.id === id); if (!s) return null;
  const g = L.geo; let p = s.o;
  const vi = () => { let r = 0, sh = 0, b; do { b = g[p++]; r += (b & 0x7f) * 2 ** sh; sh += 7; } while (b & 0x80); return r; };
  const zz = v => (v % 2 ? -(v + 1) / 2 : v / 2);
  const polylines = [], fills = [];
  for (let k = vi(); k > 0; k--) {
    const hdr = vi(), m = Math.floor(hdr / 2), pts = []; let x = 0, y = 0;
    for (let i = 0; i < m; i++) { x += zz(vi()); y += zz(vi()); pts.push([x, y]); }
    (hdr % 2 ? fills : polylines).push(pts);
  }
  return { polylines, fills };
}
/** The library symbol as a project symbol (lib.symbols): a model symbol, drawn at its true size in any 2D view. */
export function cadLibrarySymbol(id) {
  const s = load().index.find(q => q.id === id); if (!s) return null;
  const geo = cadLibraryGeometry(id);
  const cat = { People: "Entourage", Vehicles: "Entourage", Planting: "Planting", Annotation: "Annotation" }[s.c] || s.c;
  return { name: s.n, category: cat, library: "CAD goodies", view: s.v, block: s.b, cadlib: id, space: "model", weight: s.c === "Annotation" ? 0.25 : 0.18,
    fill: /People|Vehicles/.test(s.c) && /elevation/i.test(s.v) ? "#ffffff" : undefined, size: { w: s.w, h: s.h }, source: { polylines: geo.polylines, fills: geo.fills } };
}
/** A symbol's preview as SVG path data in a box, for the library's browser. */
export function cadLibraryPreview(id, box = 96) {
  const s = load().index.find(q => q.id === id), geo = cadLibraryGeometry(id); if (!s || !geo) return "";
  const pts = geo.polylines.concat(geo.fills).flat(); if (!pts.length) return "";
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), sz = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0, 1), k = (box - 8) / sz;
  const P = q => `${((q[0] - x0) * k + 4).toFixed(1)} ${(box - 4 - (q[1] - y0) * k).toFixed(1)}`;
  return { stroke: geo.polylines.map(pl => "M" + pl.map(P).join("L")).join(""), fill: geo.fills.map(pl => "M" + pl.map(P).join("L") + "Z").join("") };
}
