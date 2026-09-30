//! Frank Harmon Architect's drawing standards, shared by the four sample projects rebuilt from the firm's sets
//! (Schaeffer Residence, Walnut Creek Environmental Education Center, First Presbyterian Church, AIA NC Center):
//! the title strip along the right edge of an ARCH D sheet, Futura lettering, the firm's materials and wall,
//! floor and roof types, its dimension and text types and view styles - and the helpers every one of the models
//! is built with, so each is 3D first: walls from a base level to a top level (or attached to the roof), floors
//! on their levels, roofs by footprint, stairs counted from their levels, the ground from its contours. The sets
//! are imperial; the models are metric (feet are only how the source dimensions were read: ft()).

import { newDocument, elementRefs } from "./bim.js";
import { Editor } from "./ops.js";
import { fhaPdf } from "./fha_pdf.js";
import { emptySketch, weld } from "./bimsketch.js";
import { dimensionGeometry } from "./scene.js";

export const ft = v => Math.round(v * 304.8);                  // a dimension read in feet, in mm
export const FT = pts => pts.map(p => [ft(p[0]), ft(p[1])]);
export const PT = (x, y) => [ft(x), ft(y)];

/** The firm's view title: the number in a circle, the name on a rule from it, the scale under the name (measured off the sets). */
const FHA_VIEW_TITLE = { font: "Futura", R: 4.76, numH: 3.95, numDy: -1.79, nameH: 3.46, nameDx: 8.1, nameDy: 0.7, scaleH: 2.47, scaleDx: 7.35, scaleDy: -3.43, w: 0.19 };

/** A new FHA project: the firm's standards in its library, and the helpers to build it with. */
export function fhaProject(name, project) {
  const doc = newDocument(name);
  doc.meta.displayUnits = "mm";
  doc.meta.project = Object.assign({ firm: "FRANK HARMON ARCHITECT", firmAddress: "14 E PEACE STREET\nRALEIGH NORTH CAROLINA 27604", phone: "919 829 9464", fax: "919 829 2202",
    drawn: "JB", checked: "FH", issue: "PERMIT SET" }, project);
  doc.meta.annotation = { kind: "revit", font: "Futura", gridHead: 6.35, gridText: 2.47, gridEnd: 4, gridCentreColour: "#000000",
    markerRadius: 4.76, markerText: 3.95, markerSheetText: 2.0, calloutSheet: false, levelText: 2.0, levelValueText: 2.0, levelHeads: "Left", levelStyle: "fha", sectionStyle: "fha", annoRef: 96 };
  const ed = new Editor(doc), L = doc.lib;
  const add = element => { const r = ed.apply({ op: "add", element }, { regenerate: false }); if (!r.ok) throw new Error(`${element.id || element.type}: ${r.error}`); return r.id; };
  const set = (id, key, value) => ed.apply({ op: "set", id, key, value }, { regenerate: false });
  const line = (a, b) => ({ type: "line", start: a, end: b });

  // ---------------------------------------------------------------- pens, lettering, dimensions
  L.pens["PEN-ISO"] = { name: "Frank Harmon Architect", pens: { gossamer: { weight: 0.1 }, hairline: { weight: 0.13 }, thin: { weight: 0.18 }, light: { weight: 0.23 },
    medium: { weight: 0.35 }, heavy: { weight: 0.5 }, bold: { weight: 0.6 }, extra: { weight: 0.8 }, primary: { weight: 1.0 } }, perScale: {} };
  Object.assign(L.textTypes, {
    "TT-FH-15": { name: "Futura 1.5 (notes, keynotes)", height: 1.5, font: "Futura", widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
    "TT-FH-20": { name: "Futura 2.0 (room sizes, labels)", height: 2.0, font: "Futura", widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
    "TT-FH-25": { name: "Futura 2.5 (room names)", height: 2.5, font: "Futura", widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
    "TT-FH-35": { name: "Futura 3.5 (view titles)", height: 3.5, font: "Futura", widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
  });
  L.dimTypes["DT-FH"] = { name: "FHA - closed arrows, Futura 2.2", arrow1: "Closed filled", arrow2: "Closed filled", arrowSize: 2.87, tickWeight: 0.35, lineWeight: 0.13, extWeight: 0.13,
    dimExtend: 1.5, extFixed: 2.5, extBeyond: 1.5, font: "Futura", textHeight: 2.22, textGap: 0.7, unit: "ft-in", archFtIn: true, precision: 0, roundOff: 0, textSide: "Readable", fit: "Keep inside" };
  doc.meta.defaultDimType = "DT-FH";
  // the sets are imperial: their dimensions, scales and spot elevations read in feet and inches over a metric model
  doc.meta.scaleNames = "imperial";

  // ---------------------------------------------------------------- patterns and materials
  Object.assign(L.patterns, {
    "P-FH-SEAM": { name: "Standing seam, 406 (16\") o.c.", kind: "model", lines: [{ angle: 90, origin: [0, 0], delta: [0, 406] }] },
    "P-FH-SIDING": { name: "Board siding, 203 (8\")", kind: "model", lines: [{ angle: 0, origin: [0, 0], delta: [0, 203] }] },
    "P-FH-PANEL": { name: "Panel joints 1219 (4') grid", kind: "model", lines: [{ angle: 0, origin: [0, 0], delta: [0, 2438] }, { angle: 90, origin: [0, 0], delta: [0, 1219] }] },
    "P-FH-SLATE": { name: "Slate courses, 152 (6\")", kind: "model", lines: [{ angle: 0, origin: [0, 0], delta: [0, 152] }] },
    "P-FH-CLAD": { name: "Vertical cladding, 305 (12\")", kind: "model", lines: [{ angle: 90, origin: [0, 0], delta: [0, 305] }] },
    "P-FH-EARTH": { name: "Earth", kind: "drafting", lines: [{ angle: 45, origin: [0, 0], delta: [0, 1.6] }, { angle: 45, origin: [0.8, 0], delta: [0, 1.6], dashes: [0.6, -1.0] }] },
    "P-FH-GRAVEL": { name: "Gravel", kind: "drafting", lines: [{ angle: 30, origin: [0, 0], delta: [0.9, 1.2], dashes: [0.25, -1.1] }, { angle: 120, origin: [0.4, 0.2], delta: [0.9, 1.2], dashes: [0.25, -1.3] }] },
  });
  const mat = (id, name, mark, cut, proj, shade) => { L.materials[id] = { name, mark, description: name, cut, projection: proj, shading: { colour: shade } }; };
  mat("M-FH-CONC", "Architectural concrete", "21", { pattern: null, pen: "heavy", lineColour: "#000000", background: "#cbcbcb" }, { pen: "thin" }, "#c9c7c2");
  mat("M-FH-STUD", "Wood stud and batt", "66", { pattern: "P-INSUL", pen: "heavy", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#e8e1d4");
  mat("M-FH-PLY", "Plywood siding", "60", { pattern: null, pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-PANEL", lineColour: "#9a9a9a" }, "#c9a47a");
  mat("M-FH-CEMENT", "Fiber cement panel", "72", { pattern: null, pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-PANEL", lineColour: "#9a9a9a" }, "#b8b7b1");
  mat("M-FH-POLY", "Polygal clip system", "82", { pattern: null, pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-CLAD", lineColour: "#b0b0b0" }, "#e4ecee");
  mat("M-FH-GYP", "Gypsum board", "90", { pattern: null, pen: "thin", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#f2f0ec");
  mat("M-FH-METAL", "Standing seam metal roof", "70", { pattern: null, pen: "heavy", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-SEAM", lineColour: "#8c8c8c" }, "#8d949b");
  mat("M-FH-WOOD", "Wood decking / siding", "62", { pattern: "P-TIMBER", pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-SIDING", lineColour: "#a0a0a0" }, "#b58c5e");
  mat("M-FH-SLATE", "Slate roof", "SL", { pattern: null, pen: "heavy", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-SLATE", lineColour: "#9a9a9a" }, "#5d6168");
  mat("M-FH-BRICK", "Brick", "BR", { pattern: "P-BRICK", pen: "heavy", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-SIDING", lineColour: "#b8b8b8" }, "#9c5c46");
  mat("M-FH-STEEL", "Structural steel, galvanized", "51", { pattern: null, pen: "heavy", lineColour: "#000000", background: "#555555" }, { pen: "thin" }, "#7c8288");
  mat("M-SOIL", "Earth", "20", { pattern: "P-FH-EARTH", pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#a89779");

  // ---------------------------------------------------------------- types: walls, floors, doors, windows
  const wt = (id, name, mark, layers, fn = "Exterior", family = "F-BASICWALL") => { L.types[id] = { family, name, mark, layers, coreStart: layers.length > 2 ? 1 : 0, coreEnd: layers.length > 2 ? layers.length - 1 : layers.length, params: { Function: fn } }; };
  wt("T-FH-EXT6", "Exterior 2x6 wood stud, siding", "A", [{ function: "Finish 1", thickness: 19, material: "M-FH-PLY" }, { function: "Structure", thickness: 140, material: "M-FH-STUD" }, { function: "Finish 2", thickness: 16, material: "M-FH-GYP" }]);
  wt("T-FH-EXT6C", "Exterior 2x6 wood stud, fiber cement", "B", [{ function: "Finish 1", thickness: 19, material: "M-FH-CEMENT" }, { function: "Structure", thickness: 140, material: "M-FH-STUD" }, { function: "Finish 2", thickness: 16, material: "M-FH-GYP" }]);
  wt("T-FH-POLY", "Polygal clip wall on 2x6", "C", [{ function: "Finish 1", thickness: 16, material: "M-FH-POLY" }, { function: "Structure", thickness: 140, material: "M-FH-STUD" }, { function: "Finish 2", thickness: 16, material: "M-FH-GYP" }]);
  wt("T-FH-CONC8", "Concrete wall 8\"", "D", [{ function: "Structure", thickness: 203, material: "M-FH-CONC" }]);
  wt("T-FH-CONC12", "Concrete wall 12\"", "E", [{ function: "Structure", thickness: 305, material: "M-FH-CONC" }]);
  wt("T-FH-INT4", "Interior 2x4 partition", "1", [{ function: "Finish 1", thickness: 16, material: "M-FH-GYP" }, { function: "Structure", thickness: 89, material: "M-FH-STUD" }, { function: "Finish 2", thickness: 16, material: "M-FH-GYP" }], "Interior", "F-PARTITION");
  wt("T-FH-INT6", "Interior 2x6 partition", "2", [{ function: "Finish 1", thickness: 16, material: "M-FH-GYP" }, { function: "Structure", thickness: 140, material: "M-FH-STUD" }, { function: "Finish 2", thickness: 16, material: "M-FH-GYP" }], "Interior", "F-PARTITION");
  wt("T-FH-BRICK", "Brick masonry 12\" (existing)", "M", [{ function: "Structure", thickness: 305, material: "M-FH-BRICK" }]);
  wt("T-FH-GLASS", "Storefront / curtain wall", "G", [{ function: "Structure", thickness: 60, material: "M-GLASS" }]);
  const flt = (id, name, mark, layers) => { L.types[id] = { family: "F-FLOOR", name, mark, layers, coreStart: 0, coreEnd: layers.length }; };
  flt("T-FH-SOG", "Concrete slab on grade 4\"", "S1", [{ function: "Structure", thickness: 102, material: "M-FH-CONC" }]);
  flt("T-FH-CEIL", "Plywood ceiling under trusses", "C1", [{ function: "Finish 1", thickness: 19, material: "M-FH-PLY" }]);
  flt("T-FH-WOOD", "Wood floor on 18\" trusses", "F1", [{ function: "Finish 1", thickness: 19, material: "M-FH-WOOD" }, { function: "Structure", thickness: 457, material: "M-FH-STUD" }]);
  flt("T-FH-JOIST", "Wood floor on 2x10 joists", "F2", [{ function: "Finish 1", thickness: 19, material: "M-FH-WOOD" }, { function: "Structure", thickness: 235, material: "M-FH-STUD" }]);
  flt("T-FH-DECK", "Wood deck", "F3", [{ function: "Finish 1", thickness: 38, material: "M-FH-WOOD" }, { function: "Structure", thickness: 235, material: "M-TIMBER" }]);
  flt("T-FH-CONCDECK", "Concrete deck on metal deck 6\"", "S2", [{ function: "Structure", thickness: 152, material: "M-FH-CONC" }]);
  const door = (id, name, mark, w, h, extra = {}) => { L.types[id] = Object.assign({ family: "F-SINGLEDOOR", name, mark, width: w, height: h, leafThickness: 44, frame: 40 }, extra); };
  door("T-FH-D30", "Flush wood door 3'-0\"x7'-0\"", "D1", 914, 2134);
  door("T-FH-D28", "Flush wood door 2'-8\"x7'-0\"", "D2", 813, 2134);
  door("T-FH-D30G", "Aluminum clad door 3'-0\"x7'-0\" glazed", "D3", 914, 2134, { glazed: true, leafThickness: 44 });
  door("T-FH-D60G", "Aluminum clad door pair 6'-0\"x7'-0\" glazed", "D4", 1829, 2134, { glazed: true });
  door("T-FH-GARAGE", "Polygal garage door 18'-0\"x9'-6\"", "D5", 5486, 2896, { glazed: false, leafThickness: 60 });
  L.types["T-FH-PIN"] = { family: "F-COLUMN", name: "Masonry pinnacle 2'-6\" square", mark: "P2", width: 762, depth: 762, material: "M-FH-BRICK" };
  L.types["T-FH-PILE"] = { family: "F-COLUMN", name: "Wood pile 10\" round", mark: "P1", width: 254, depth: 254, round: true, material: "M-FH-WOOD" };
  const win = (id, name, mark, w, h, mullions = 0) => { L.types[id] = { family: "F-CASEMENT", name, mark, width: w, height: h, frame: 50, mullions }; };
  win("T-FH-W24", "Aluminum clad window 2'-0\"x4'-0\"", "W1", 610, 1219);
  win("T-FH-W44", "Aluminum clad window 4'-0\"x4'-0\"", "W2", 1219, 1219);
  win("T-FH-W46", "Aluminum clad window 4'-0\"x6'-0\"", "W3", 1219, 1829);
  win("T-FH-W84", "Aluminum clad window 8'-0\"x4'-0\"", "W4", 2438, 1219, 1);
  win("T-FH-W86", "Aluminum clad window 8'-0\"x6'-0\"", "W5", 2438, 1829, 1);
  win("T-FH-W48", "Aluminum clad window 4'-0\"x8'-0\"", "W6", 1219, 2438);
  win("T-FH-W1210", "Storefront 12'-0\"x10'-0\"", "W7", 3658, 3048, 2);
  // arched heads (the existing church): round, and pointed as a Gothic lancet; the new building's tall windows and storefronts
  const arch = (id, name, mark, w, h, head, mullions = 0, o = {}) => { L.types[id] = Object.assign({ family: "F-CASEMENT", name, mark, width: w, height: h, frame: 60, mullions, head }, o); };
  arch("T-FH-WPT36", "Lancet window 3'-7\"x16'-2\" (existing)", "E1", 1097, 4928, "Pointed", 1);
  arch("T-FH-WPT30", "Belfry louver 3'-0\"x10'-0\" (existing)", "E2", 914, 3048, "Pointed", 0);
  arch("T-FH-WRD36", "Round-head window 3'-7\"x6'-4\" (existing)", "E3", 1097, 1930, "Round", 1);
  arch("T-FH-WRD72", "Round-head window 7'-2\"x11'-8\" (existing)", "E4", 2184, 3556, "Round", 2);
  arch("T-FH-W3686", "Aluminum window 3'-7\"x8'-7\"", "8", 1097, 2616, "Square", 0, { transoms: 1 });
  arch("T-FH-W3654", "Aluminum window 3'-7\"x5'-5\"", "4", 1097, 1651, "Square", 0);
  arch("T-FH-SF1509", "Storefront 15'-6\"x9'-0\"", "17", 4724, 2743, "Square", 3);
  arch("T-FH-SF1009", "Storefront 10'-0\"x9'-0\"", "18", 3048, 2743, "Square", 2);
  arch("T-FH-SF3406", "Storefront transom 34'-0\"x6'-0\"", "19", 10363, 1829, "Square", 7);
  door("T-FH-DRD4", "Round-head door 4'-0\"x9'-0\" (existing)", "D6", 1219, 2743, { glazed: false, leafThickness: 50, head: "Round" });
  door("T-FH-DRD9", "Round-head entry, pair 9'-0\"x12'-0\"", "D7", 2743, 3658, { glazed: true, head: "Round" });
  door("T-FH-D809G", "Aluminum storefront doors, pair 8'-0\"x9'-0\"", "D8", 2438, 2743, { glazed: true });
  win("T-FH-W42", "Aluminum clad awning 4'-0\"x2'-0\"", "W8", 1219, 610);
  win("T-FH-W417", "Stair glazing 4'-0\"x16'-0\"", "W9", 1219, 4877);
  win("T-FH-SF1615", "Storefront 15'-0\"x15'-0\"", "W10", 4572, 4572, 3);
  win("T-FH-SF2111", "Storefront 21'-0\"x11'-0\"", "W11", 6401, 3353, 4);

  // ---------------------------------------------------------------- view styles
  const base = JSON.parse(JSON.stringify(L.viewStyles["VS-CONSTRUCTION"] || {}));
  L.viewStyles["VS-FH-PLAN"] = Object.assign(JSON.parse(JSON.stringify(base)), { name: "FHA - plans", rules: [] });
  L.viewStyles["VS-FH-ELEV"] = Object.assign(JSON.parse(JSON.stringify(base)), { name: "FHA - elevations", rules: [] });
  // sections: what the cut meets outlined in its material (concrete grey, the rest white), as the sets draw them
  L.viewStyles["VS-FH-SEC"] = Object.assign(JSON.parse(JSON.stringify(base)), { name: "FHA - sections", rules: [] });
  // details: the section's style at 1:12, no level lines (the details write their heights as spot elevations)
  L.viewStyles["VS-FH-DET"] = Object.assign(JSON.parse(JSON.stringify(base)), { name: "FHA - details", rules: [
    // at 1:12 the cut is drawn in outline, white: what fills it is the detail's (its insulation, its hatching)
    { id: "R-DET-CUT", name: "Cut in outline", when: null, then: { cut: { fill: "#ffffff", pattern: "none" } } }] });
  L.viewStyles["VS-FH-DET"].byCategory = Object.assign({}, L.viewStyles["VS-FH-DET"].byCategory, { IfcBuildingStorey: { visible: false }, Furniture: { visible: false }, Planting: { visible: false }, Topography: { visible: false } });
  L.viewStyles["VS-FH-3D"] = Object.assign(JSON.parse(JSON.stringify(base)), { name: "FHA - 3D" });
  // the site plan: the plans' style with the planting and the ground shown
  L.viewStyles["VS-FH-SITE"] = Object.assign(JSON.parse(JSON.stringify(L.viewStyles["VS-FH-PLAN"])), { name: "FHA - site plan" });
  L.viewStyles["VS-FH-SITE"].byCategory = Object.assign({}, L.viewStyles["VS-FH-SITE"].byCategory, { IfcStair: { visible: false }, Furniture: { visible: false } });
  for (const k of ["VS-FH-PLAN", "VS-FH-ELEV", "VS-FH-SEC"]) { const s = L.viewStyles[k]; s.byCategory = Object.assign({}, s.byCategory, { Furniture: { visible: false }, Planting: { visible: false } }); }
  // rooms: no fill; the tag the office uses - name over number in an oblong, a rule between them
  L.viewStyles["VS-FH-PLAN"].byCategory.IfcSpace = Object.assign({}, L.viewStyles["VS-FH-PLAN"].byCategory.IfcSpace, { fill: "none",
    label: { height: 2.222, font: "Futura", content: "{Name}\n{Number}", upper: true, quiet: true, lineSpacing: 1.786, frame: "oblong", frameR: 4.23, framePad: 2.1, extraHeight: 1.6 } });
  // plans show no contours (the grading plan's site style does)
  L.viewStyles["VS-FH-PLAN"].byCategory.Topography = { visible: false };
  L.viewStyles["VS-FH-PLAN"].byCategory.IfcBeam = { visible: false };

  // ---------------------------------------------------------------- the helpers the models are built with
  const R = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const H = {
    doc, ed, add, set, line, R,
    /** Every wall's ends joined where they meet another's (a corner) or land in another (a T), as drawing them would:
     *  built first, so each wall knows its thickness and its heights and a stacked wall joins nothing below it. */
    joinWalls: () => { doc.regenerate(); const ends = doc.elements().filter(f => doc.typeOf(f) === "Wall" && !(doc.resolveType(F_ref(doc, f, "wallType")) || {}).curtain).flatMap(f => [{ id: doc.idOf(f), end: "start" }, { id: doc.idOf(f), end: "end" }]); return ed.apply({ op: "autojoin", ends, maxMove: H.joinTolerance ?? 1e9 }, { regenerate: false }); },
    levelZ: id => doc.argValue(doc.element(id), "elevation") || 0,
    level: (id, name, z) => add({ id, type: "Level", name, args: { name, elevation: z } }),
    grid: (id, name, a, b) => add({ id, type: "Grid", name: `Grid ${name}`, args: { name, line: line(a, b), ends: "End", headSize: 6.35, textSize: 2.47 } }),
    /** A wall from its base level to its top level (or up a height), or up to the roof it is attached to. */
    wall: (id, a, b, type, base, top, o = {}) => add({ id, type: "Wall", name: o.name || id, args: Object.assign({ centreline: line(a, b), mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: base }, baseOffset: o.baseOffset || 0,
      topLevel: top ? { ref: top } : null, topOffset: o.topOffset || 0, height: o.height || 3000, flipped: false }, o.roof ? { attachTop: { ref: o.roof } } : {}) }),
    /** A chain of walls through points (closed if asked): ids id1, id2, ... */
    walls: (id, pts, type, base, top, o = {}) => { const n = o.closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) H.wall(`${id}${i + 1}`, pts[i], pts[(i + 1) % pts.length], type, base, top, o); },
    /** A floor with holes (a stair's well, a void over the room below): its boundary sketched as loops. */
    floorHoles: (id, name, outer, holes, type, lev, off = 0) => { const w = emptySketch(); let n = 0;
      for (const loop of [outer, ...holes]) loop.forEach((p, i) => w.elements.push({ id: "e" + (++n), type: "line", a: [p[0], p[1]], b: [loop[(i + 1) % loop.length][0], loop[(i + 1) % loop.length][1]] }));
      return add({ id, type: "Floor", name, args: { boundary: outer, floorType: { ref: type }, level: { ref: lev }, heightOffset: off, sketch: weld(w) } }); },
    floor: (id, name, boundary, type, lev, off = 0) => add({ id, type: "Floor", name, args: { boundary, floorType: { ref: type }, level: { ref: lev }, heightOffset: off } }),
    roof: (id, name, boundary, lev, off, slopes, o = {}) => add({ id, type: "Roof", name, args: Object.assign({ boundary, level: { ref: lev }, heightOffset: off, thickness: o.thickness || 250, material: o.material || "M-FH-METAL", edgeSlopes: slopes, ridgeHeight: o.ridge || 0 }, o.args || {}) }),
    stair: (id, name, base, top, flights, o = {}) => add({ id, type: "Stair", name, args: Object.assign({ baseLevel: { ref: base }, topLevel: top ? { ref: top } : null, flights, width: o.width || 914, material: o.material || "M-FH-WOOD", railings: o.railings || "Both" }, o.args || {}) }),
    topo: (id, name, contours, boundary, base, pads = []) => add({ id, type: "Toposurface", name, args: { contours, boundary, base, pads, interval: 305, major: 5, material: "M-SOIL" } }),
    /** An opening at distance `at` (its centre) along a wall, filled with a door or a window of a type. */
    door: (id, host, at, type, o = {}) => { const t = L.types[type]; add({ id: `OP-${id}`, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at, sill: o.sill || 0, w: t.width, h: t.height }, farProfile: null, depth: "through" } });
      add({ id, type: "Door", args: Object.assign({ fills: { ref: `OP-${id}` }, doorType: { ref: type }, flipHand: !!o.flipHand, flipFacing: !!o.flipFacing, clearance: "None" }, o.args || {}), params: { Mark: o.mark || id } }); },
    window: (id, host, at, type, sill, o = {}) => { const t = L.types[type]; add({ id: `OP-${id}`, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at, sill, w: o.w || t.width, h: o.h || t.height }, farProfile: null, depth: "through" } });
      add({ id, type: "Window", args: { fills: { ref: `OP-${id}` }, windowType: { ref: type } }, params: { Mark: o.mark || id } }); },
    text: (id, view, content, at, tt = "TT-FH-20", o = {}) => add({ id, type: "Text", args: Object.assign({ content, position: at, rotation: o.rot || 0, textType: { ref: tt }, wrapWidth: 1000, leaders: [], view: { ref: view } }, o.align ? { align: o.align } : {}) }),
    plan: (id, name, lev, range, crop, scale = 50, style = "VS-FH-PLAN") => add({ id, type: "PlanView", name, args: { level: { ref: lev }, scale, viewRange: range, detailLevel: "Medium", style: { ref: style }, clip: { rect: crop, visible: false, active: !!crop } } }),
    elev: (id, name, a, b, depth, base, crop, scale = 50, o = {}) => add({ id, type: "ElevationView", name, args: { line: line(a, b), depth, scale, baseLevel: { ref: base }, top: o.top || 12000, style: { ref: "VS-FH-ELEV" }, detailLevel: "Medium",
      clip: { rect: crop, visible: false, active: !!crop, annotation: [80, 20, 70, 50] }, groundLine: true, levelExtent: o.levelExtent || (crop ? [crop[0], crop[2]] : undefined), overrides: { __gridTop: o.gridTop ?? (crop ? crop[3] + 400 : 9000), __gridBottom: o.gridBottom ?? (crop ? crop[1] + 800 : -300) } } }),
    sect: (id, name, a, b, depth, base, crop, scale = 50, o = {}) => add({ id, type: "SectionView", name, args: { line: line(a, b), depth, scale, baseLevel: { ref: base }, top: o.top || 12000, style: { ref: "VS-FH-SEC" }, detailLevel: "Medium",
      clip: { rect: crop, visible: false, active: !!crop, annotation: [80, 20, 70, 50] }, heads: o.heads || "End", groundLine: false, levelExtent: o.levelExtent || (crop ? [crop[0], crop[2]] : undefined), overrides: { __gridTop: o.gridTop ?? (crop ? crop[3] + 400 : 9000), __gridBottom: o.gridBottom ?? (crop ? crop[1] + 800 : -300) } } }),
    view3d: (id, name, cam, scale = 100) => add({ id, type: "View3D", name, args: { camera: cam, scale, style: { ref: "VS-FH-3D" }, visualStyle: "Shaded", render: { display: "renderedEdges", rasterDPI: 200, silhouetteWeight: 0.35 } } }),
    /** An ARCH D sheet in the firm's title strip; viewports [view, at (paper mm), extra]. */
    sheet: (number, name, vps, size = "ARCH D", o = {}) => add({ id: `SH-${number}`, type: "Sheet", name: `${number} ${name}`, args: { number, sheetName: name, size, orientation: o.orientation || "landscape", titleBlock: { ref: o.titleBlock || "SY-TB-FHA" },
      viewports: vps.map(([view, at, extra], i) => Object.assign({ id: `VP${i + 1}`, view: { ref: view }, at, clipVisible: false }, extra || {})), revision: "" } }),
    /** Where a viewport goes so that the drawing sits where the source set has it: a model point `m` the set draws
     *  at paper point `p` at its scale (1:srcScale), matched at the drawing's middle `c` so a small difference of
     *  scale spreads evenly to both ends. */
    place: (p, m, c, crop, scale, srcScale = 48) => { const pc = [p[0] + (c[0] - m[0]) / srcScale, p[1] + (c[1] - m[1]) / srcScale]; return [pc[0] + ((crop[0] + crop[2]) / 2 - c[0]) / scale, pc[1] + ((crop[1] + crop[3]) / 2 - c[1]) / scale]; },
    // ------------------------------------------------------------ the set's own sheets, lifted from its PDF
    pdf: null,
    /** Use a set's PDF data: its title block families go into the library (each with the firm's view title). */
    useSet: (set) => { H.pdf = fhaPdf(set); H.pdf.setName = set.toUpperCase(); for (const [id, fam] of Object.entries(H.pdf.titleBlocks)) L.symbols[id] = Object.assign(JSON.parse(JSON.stringify(fam)), { viewTitle: FHA_VIEW_TITLE }); return H.pdf; },
    /** A sheet as the PDF page has it: its number, its name (its lines), its title block and its size. */
    pdfSheet: (page, vps, o = {}) => { const S0 = H.pdf.sheets[page], P = H.pdf.pages[page], land = P.size[0] > P.size[1];
      return H.sheet(S0.number, S0.name, vps, o.size || "ARCH D", Object.assign({ orientation: land ? "landscape" : "portrait", titleBlock: S0.tb }, o)); },
    /** Every note, dimension and bubble of a PDF page, in the view of the viewport it belongs to (its leader's tip or
     *  its middle falls in that viewport's crop, the smallest first), in that view's coordinates; what lies on no
     *  viewport goes into the sheet's own notes (a drafting view laid over the whole sheet). `skip(note)` leaves out
     *  what the model already writes (grid heads, level heads, view titles). Returns what it placed. */
    annotate: (page, o = {}) => annotatePage(H, page, o),
    /** A paper point of a PDF page, in the coordinates of a view placed on that page's sheet. */
    paperToView: (page, viewId, q) => { const sh = doc.element(`SH-${H.pdf.sheets[page].number}`), vp = (doc.argValue(sh, "viewports") || []).find(x => x.view.ref === viewId), v = doc.element(viewId);
      const r = doc.argValue(v, "clip").rect, S = doc.argValue(v, "scale"); return [(q[0] - vp.at[0]) * S + (r[0] + r[2]) / 2, (q[1] - vp.at[1]) * S + (r[1] + r[3]) / 2]; },
    /** An elevation's or a section's datums as the PDF draws them: its level lines between two paper x (the head at the
     *  first), and its grid lines' heads with their centres at a paper y (and their feet at another). */
    pdfDatums: (page, viewId, { levels, head = "Left", gridHead, gridFoot, R = 3.17 } = {}) => {
      const v = doc.element(viewId), ov = Object.assign({}, doc.argValue(v, "overrides") || {}), S = doc.argValue(v, "scale");
      if (levels) { const a = H.paperToView(page, viewId, [levels[0], 0])[0], b = H.paperToView(page, viewId, [levels[1], 0])[0]; set(viewId, "levelExtent", [Math.min(a, b), Math.max(a, b)]); ov.__levelHead = a < b ? (head === "Left" ? "Left" : "Right") : (head === "Left" ? "Right" : "Left"); }
      if (gridHead != null) ov.__gridTop = H.paperToView(page, viewId, [0, gridHead])[1] - R * S;
      if (gridFoot != null) ov.__gridBottom = H.paperToView(page, viewId, [0, gridFoot])[1];
      set(viewId, "overrides", ov); },
    /** A detail: a section at 1:12 (Revit's callout, its boundary drawn on the parent section) whose crop is the region
     *  of a PDF page the detail occupies, placed so that the view point `anchor` [s, z] (along the cut, height) lands
     *  on the paper point `paper`. Returns the viewport for H.pdfSheet. */
    detail: (id, name, a, b, rect, paper, anchor, o = {}) => { const S = o.scale || 12, V = q => [Math.round(anchor[0] + (q[0] - paper[0]) * S), Math.round(anchor[1] + (q[1] - paper[1]) * S)];
      const c0 = V([rect[0], rect[1]]), c1 = V([rect[2], rect[3]]), crop = [c0[0], c0[1], c1[0], c1[1]];
      add({ id, type: "SectionView", name, args: Object.assign({ line: line(a, b), depth: o.depth || 1800, scale: S, baseLevel: { ref: o.base || "L-0" }, top: o.top || 20000, style: { ref: "VS-FH-DET" }, detailLevel: "Fine",
        clip: { rect: crop, visible: false, active: true, annotation: [20, 20, 20, 20] }, heads: "End", groundLine: false, levelExtent: [crop[0], crop[2]],
        overrides: Object.assign({ __annoK: 1, __gridTop: o.gridTop ?? crop[3] + (o.gridHead ? 400 : 0), __gridBottom: o.gridBottom ?? crop[1], __gridHeads: !!o.gridHead }, o.overrides || {}) },
        // a detail is a callout (of its parent, or of none): it is never marked as a cut on the plans and elevations
        { callout: o.callout || {} }) });
      return [id, [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2], Object.assign({ number: o.number }, o.vp || {})]; },
    /** A detail sheet's drafting, lifted from its PDF (tools/fha/dlift.py) into its views: the batts as insulation
     *  (the repeating detail, at the cavity's width), the rest as the view's detail components - what the model's cut
     *  does not draw (flashings, sills, blocking, plates, gutters, hatching). */
    lift: (page) => { const P = H.pdf.pages[page]; if (!P.lift || globalThis.__NO_LIFT) return 0; let n = 0;
      const dec = v => { const o = v.slice(0, 2); for (let i = 2; i < v.length; i++) o.push(o[i - 2] + v[i]); return o.map(x => x / 100); };
      for (const [vid, r] of Object.entries(P.lift)) { if (!doc.element(vid)) continue; const S = doc.argValue(doc.element(vid), "scale"), o0 = H.paperToView(page, vid, [0, 0]);
        r.b.forEach((z, i) => { const A = H.paperToView(page, vid, [z[0], z[1]]), B2 = H.paperToView(page, vid, [z[2], z[3]]);
          add({ id: `RD-${vid.slice(2)}-${i + 1}`, type: "RepeatingDetail", name: "Batt insulation", args: { path: { elements: [{ id: "e1", type: "line", a: A, b: B2 }], constraints: [], dims: [] }, component: "Batt insulation", width: Math.round(z[4] * S), view: { ref: vid } } }); n++; });
        const elements = [];
        for (const [w, ps] of Object.entries(r.l)) elements.push({ type: "path", layer: "DETAIL", w: +w, p: ps.map(dec) });
        for (const [w, cs] of Object.entries(r.c)) elements.push({ type: "path", layer: "DETAIL", w: +w, s: cs.map(c => ["C", ...dec(c)]) });
        const fills = r.f.map(f => { const v = dec(f.slice(0, -1)), pts = []; for (let i = 0; i < v.length; i += 2) pts.push([v[i], v[i + 1]]); return { layer: "DETAIL", pts, colour: f[f.length - 1] }; });
        // the hatches: the set's own tiles (stones, aggregate, stipple) as drafting patterns, each region a filled region
        (r.h || []).forEach((h, i) => { const pid = `P-${H.pdf.setName || "PDF"}-${h[0]}`, T = (H.pdf.tiles || {})[h[0]]; if (!T) return;
          if (!L.patterns[pid]) L.patterns[pid] = { name: `${H.pdf.sheets[page].number} hatch ${h[0]}`, kind: "drafting", lines: [], tile: T };
          const po = H.paperToView(page, vid, h[1]).map(Math.round);
          h.slice(2).forEach((lp, j) => { const v = dec(lp), pts = []; for (let k = 0; k < v.length; k += 2) pts.push(H.paperToView(page, vid, [v[k], v[k + 1]]).map(Math.round));
            add({ id: `FR-${vid.slice(2)}-${i + 1}${j ? "-" + j : ""}`, type: "FilledRegion", name: L.patterns[pid].name, args: { boundary: pts, pattern: pid, view: { ref: vid }, background: "none", lineColour: "none", patternOrigin: po } }); n++; }); });
        add({ id: `CAD-${vid.slice(2)}`, type: "CADImport", name: "Detail components", args: { file: `${H.pdf.sheets[page].number} (drafted)`, drawing: { elements, constraints: [], texts: [], fills, layers: [{ name: "DETAIL", on: true, colour: "#000000" }] },
          view: { ref: vid }, offsetX: o0[0], offsetY: o0[1], scale: S, rotation: 0, pinned: true } }); n++; }
      return n; },
    /** Where a viewport goes so that a model point lands on a paper point: the crop's centre, from that pair. */
    at: (paper, model, crop, scale) => [paper[0] + ((crop[0] + crop[2]) / 2 - model[0]) / scale, paper[1] + ((crop[1] + crop[3]) / 2 - model[1]) / scale],
  };
  return H;
}

// ---------------------------------------------------------------- a PDF page's annotation, into the views on its sheet
const F_ref = (doc, f, k) => (doc.argValue(f, k) || {}).ref;
/** A text type for words of a cap height, font and line spacing, made the first time it is needed. */
function textTypeFor(L, h, font, ls) {
  const id = `TT-P-${font}-${Math.round(h * 100)}-${ls ? Math.round(ls / h * 100) : 160}`;
  if (!L.textTypes[id]) L.textTypes[id] = { name: `${font} ${h.toFixed(2)}${ls ? ` · ${(ls / h).toFixed(2)}` : ""}`, height: h, font, widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: ls ? ls / h : 1.6 };
  return id;
}
function annotatePage(H, page, o) {
  const { doc, add, L } = Object.assign({ L: H.doc.lib }, H), P = H.pdf.pages[page], S0 = H.pdf.sheets[page];
  const sh = doc.element(`SH-${S0.number}`); if (!sh) throw new Error(`annotate: no sheet ${S0.number}`);
  // each viewport's crop on the paper, and the map from paper to its view's coordinates
  const vps = (doc.argValue(sh, "viewports") || []).map(vp => { const v = doc.element(vp.view.ref), clip = doc.argValue(v, "clip") || {}, r = clip.rect, S = doc.argValue(v, "scale") || 100;
    if (!r) return null; const cc = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], hw = (r[2] - r[0]) / 2 / S, hh = (r[3] - r[1]) / 2 / S, m = (o.margins || {})[vp.view.ref] ?? (o.margin ?? 2);
    return { id: vp.view.ref, v, S, rect: [vp.at[0] - hw - m, vp.at[1] - hh - m, vp.at[0] + hw + m, vp.at[1] + hh + m], map: q => [(q[0] - vp.at[0]) * S + cc[0], (q[1] - vp.at[1]) * S + cc[1]], area: hw * hh }; }).filter(Boolean);
  const titles = new Set((doc.argValue(sh, "viewports") || []).map(vp => String(doc.element(vp.view.ref).get("Name") || "").toUpperCase()));
  const levelWords = new Set(doc.elements().filter(f => doc.typeOf(f) === "Level").flatMap(f => [String(doc.argValue(f, "name") || "").toUpperCase()]));
  const own = o.own || null;   // the sheet's own notes: a drafting view over the whole sheet, made when first needed
  let notesView = null;
  const sheetNotes = () => { if (notesView) return notesView; const id = `V-N-${S0.number}`;
    add({ id, type: "DraftingView", name: `${S0.number} SHEET NOTES`, args: { scale: 1, clip: { rect: [0, 0, P.size[0], P.size[1]], visible: false, active: true } } });
    const vpsNow = doc.argValue(sh, "viewports") || []; H.ed.apply({ op: "set", id: doc.idOf(sh), key: "viewports", value: vpsNow.concat([{ id: `VP${vpsNow.length + 1}`, view: { ref: id }, at: [P.size[0] / 2, P.size[1] / 2], clipVisible: false, noTitle: true }]) }, { regenerate: false });
    notesView = { id, S: 1, map: q => q }; return notesView; };
  const claim = q => vps.filter(v => q[0] >= v.rect[0] && q[0] <= v.rect[2] && q[1] >= v.rect[1] && q[1] <= v.rect[3]).sort((a, b) => a.area - b.area)[0] || null;
  const isTitle = n => titles.has(n.t.toUpperCase()) || /^\d+(\/\d+)?" = 1'-0"$|^1" = 1'-0"$|^N\.?T\.?S\.?$/i.test(n.t) && !n.leader;
  const gridNames = new Set(doc.elements().filter(f => doc.typeOf(f) === "Grid").map(f => String(doc.argValue(f, "name") || "")));
  const viewTitleNear = n => (doc.argValue(sh, "viewports") || []).some(vp => vp.titleAt && Math.hypot(vp.titleAt[0] - (n.bb[0] + n.bb[2]) / 2, vp.titleAt[1] - (n.bb[1] + n.bb[3]) / 2) < 6);
  const skip = n => (o.skip && o.skip(n)) || isTitle(n) || (n.end === "none" && n.leader && n.leader.length === 2 && Math.abs(n.leader[0][1] - n.leader[1][1]) < 0.05 && (titles.has(n.t.toUpperCase()) || /" = /.test(n.t)))
    // a grid's head (a letter or two on its line): the model's grid draws it
    || (n.t.length <= 2 && n.leader && n.leader.length === 2 && Math.abs(n.leader[0][0] - n.leader[1][0]) < 0.05 && Math.abs(n.leader[0][1] - n.leader[1][1]) > 8)
    || (!n.leader && gridNames.has(n.t.trim()))
    // a view title's number: the sheet's view title draws it
    || (/^\d{1,2}$/.test(n.t) && viewTitleNear(n))
    // a level's head (its height over its name, one block or two): the model's level draws it
    || n.t.split("\n").every(l => levelWords.has(l.trim().toUpperCase()) || /^\d{3}'-\d+( \d\/\d)?"$/.test(l.trim()));
  // the view titles where the drawing has them: the circle left of the name, the rule as long as drawn
  { const vpl = (doc.argValue(sh, "viewports") || []).map(x => Object.assign({}, x)); let moved = false;
    for (const n of P.notes) { if (!n.leader || n.end !== "none") continue; const x = vpl.find(vp => String(doc.element(vp.view.ref).get("Name") || "").toUpperCase() === n.t.toUpperCase()); if (!x || x.titleAt) continue;
      x.titleAt = [+(n.at[0] - FHA_VIEW_TITLE.nameDx).toFixed(2), +(n.at[1] - FHA_VIEW_TITLE.nameDy).toFixed(2)]; x.titleLength = +(Math.max(n.leader[0][0], n.leader[1][0]) - x.titleAt[0]).toFixed(2); moved = true; }
    if (moved) H.ed.apply({ op: "set", id: doc.idOf(sh), key: "viewports", value: vpl }, { regenerate: false }); }
  let k = 0; const placed = { notes: 0, dims: 0, bubbles: 0, sheet: 0 };
  // room tags (a name and a three-figure number): rooms of the plan's level, tagged as the office tags them
  const isTag = n => { const ls = n.t.split("\n"); return (ls.length === 2 || ls.length === 3) && ls.some(l => /^\d{3}$/.test(l.trim())) && n.h > 2 && n.h < 2.5; };
  for (const n of P.notes) {
    if (!o.rooms || !isTag(n)) continue;
    const c = [(n.bb[0] + n.bb[2]) / 2, n.at[1]], vp = claim(c); if (!vp || doc.typeOf(vp.v) !== "PlanView") continue;
    const ls = n.t.split("\n").map(x => x.trim()), numFirst = /^\d{3}$/.test(ls[0]), num = numFirst ? ls[0] : ls[1], name = numFirst ? ls[1] : ls[0];
    const lev = F_ref(doc, vp.v, "level"), sid = `SP-${num}`; if (doc.element(sid)) continue;
    add({ id: sid, type: "Space", name, args: { level: { ref: lev }, upperLimit: { mode: "offset", offset: 3000 }, anchor: vp.map(c), boundaryAt: "finishFace" },
      params: Object.assign({ Number: num }, numFirst ? { LabelFormat: ls.length === 3 ? "{Number}\\n{Name}\\n{AreaNote}" : "{Number}\\n{Name}", AreaNote: ls[2] || "" } : {}) });
    n.__room = true; placed.rooms = (placed.rooms || 0) + 1;
  }
  for (const n of P.notes) {
    if (n.__room || skip(n)) continue;
    const bbc = [(n.bb[0] + n.bb[2]) / 2, (n.bb[1] + n.bb[3]) / 2], q = n.leader ? n.leader[n.leader.length - 1] : bbc;
    let vp = claim(q) || claim(bbc); if (!vp) { if (o.noSheetNotes) continue; vp = sheetNotes(); placed.sheet++; }
    const tt = textTypeFor(L, n.h, n.font, n.ls), leaders = n.leader ? [{ side: n.side, from: vp.map(n.leader[0]), points: n.leader.slice(1, -1).map(vp.map), target: vp.map(n.leader[n.leader.length - 1]), end: n.end }] : [];
    add({ id: `TX-${S0.number}-${++k}`, type: "Text", args: Object.assign({ content: n.t, position: vp.map(n.at), rotation: n.rot || 0, textType: { ref: tt }, wrapWidth: 1000, leaders, view: { ref: vp.id } }, n.align ? { align: n.align } : {}) });
    placed.notes++;
  }
  // bubbles that are not grid heads: a keynote or a tag, its circle and its words
  for (const b of P.bubbles) {
    // grid heads and view numbers are the model's own; keynotes (3.1, 6.2...) and tags are placed here
    if (o.skipBubble ? o.skipBubble(b) : !/\./.test(b.t)) continue;
    const c = [b.circle[0], b.circle[1]], vp = claim(c) || sheetNotes(), cc = vp.map(c), r = b.circle[2] * vp.S;
    add({ id: `DL-${S0.number}-B${++k}`, type: "DetailLine", args: { curve: { type: "arc", centre: cc, radius: r, start: 0, end: 360, ccw: true }, pen: "thin", view: { ref: vp.id } } });
    add({ id: `TX-${S0.number}-${++k}`, type: "Text", args: { content: b.t, position: vp.map(b.at), rotation: 0, textType: { ref: textTypeFor(L, b.h, b.font, b.ls) }, wrapWidth: 1000, leaders: [], view: { ref: vp.id }, align: b.align || "left" } });
    placed.bubbles++;
  }
  // dimensions: to the model's references where the string lands on them, else to witness lines at its ends
  for (const dm of P.dims) {
    if (!dm.line || (o.skipDim && o.skipDim(dm))) continue;
    let [a, b] = dm.line; const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], vp = claim(mid); if (!vp) continue;
    // the drafted line runs on past its arrows: in a section or a detail the string's own value (at the view's
    // scale) sets its length, centred where the line is
    { const L = ftInOf(dm.t), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L != null && doc.typeOf(vp.v) !== "PlanView" && len > 0 && Math.abs(len - L / vp.S) > 0.4) { const k = L / vp.S / len / 2, dx = (b[0] - a[0]) * k, dy = (b[1] - a[1]) * k; a = [mid[0] - dx, mid[1] - dy]; b = [mid[0] + dx, mid[1] + dy]; } }
    const A = vp.map(a), B2 = vp.map(b), vert = Math.abs(a[0] - b[0]) < Math.abs(a[1] - b[1]), plan = doc.typeOf(vp.v) === "PlanView";
    const lo = vert ? Math.min(A[1], B2[1]) : Math.min(A[0], B2[0]), hi = vert ? Math.max(A[1], B2[1]) : Math.max(A[0], B2[0]), at = vert ? A[0] : A[1];
    const witness = c => { const lid = `DL-${S0.number}-W${++k}`, e = 1 * vp.S;
      add({ id: lid, type: "DetailLine", args: { curve: { type: "line", start: vert ? [at - e, c] : [c, at - e], end: vert ? [at + e, c] : [c, at + e] }, pen: "gossamer", view: { ref: vp.id } } });
      return `${lid}:line`; };
    let ra = null, rb = null;
    // a grid line where the string ends on one (the set's bays), else the nearest wall face
    if (plan) { const tol = 1.5 * vp.S, pick = c => { let best = null; for (const r of planRefs(doc, vert)) { const d = Math.abs(r.c - c) - (r.grid ? tol : 0); if (Math.abs(r.c - c) < tol && (!best || d < best.d)) best = { d, key: r.key }; } return best && best.key; }; ra = pick(lo); rb = pick(hi); }
    const keyA = ra || witness(lo), keyB = (rb && rb !== ra) ? rb : witness(hi);
    const id = `DM-${S0.number}-${++k}`;
    add({ id, type: "Dimension", args: { of: [keyA, keyB], offset: plan ? 0 : at, view: { ref: vp.id }, locked: false, dimType: { ref: "DT-FH" } } });
    if (plan) { const g = dimOffsetFor(doc, id, vert, at); if (g != null) H.ed.apply({ op: "set", id, key: "offset", value: g }, { regenerate: false }); }
    placed.dims++;
  }
  return placed;
}
/** A dimension string's value in mm: 1'-4", 5 3/8", 16'-0", 3/4". */
function ftInOf(t) {
  const m = String(t).replace(/[’′]/g, "'").replace(/[”″]/g, '"').match(/^(?:(\d+)'\s?-?\s?)?(?:(\d+)(?:\s(\d+)\/(\d+))?|(\d+)\/(\d+))?"?$/);
  if (!m || (!m[1] && !m[2] && !m[5])) return null;
  const inch = (+m[2] || 0) + (m[3] ? +m[3] / +m[4] : 0) + (m[5] ? +m[5] / +m[6] : 0);
  return ((+m[1] || 0) * 12 + inch) * 25.4;
}
/** The model's lines a plan dimension can bind to: wall faces and grid lines square to what it measures. */
function planRefs(doc, vert) {
  const out = [];
  for (const f of doc.elements()) { const t = doc.typeOf(f); if (!["Wall", "Grid", "Column"].includes(t) || doc.error(f)) continue;
    let rs; try { rs = elementRefs(doc, f); } catch (e) { continue; }
    for (const r of rs) if (r.kind === "line" && r.a && r.b) { const vx = Math.abs(r.a[0] - r.b[0]) < 0.5, hy = Math.abs(r.a[1] - r.b[1]) < 0.5;
      // a vertical string (vert) measures heights along y: horizontal lines; a horizontal one, vertical lines
      if (vert && hy) out.push({ key: `${doc.idOf(f)}:${r.key}`, c: r.a[1], grid: t === "Grid" }); if (!vert && vx) out.push({ key: `${doc.idOf(f)}:${r.key}`, c: r.a[0], grid: t === "Grid" }); } }
  return out;
}
/** A plan dimension's offset that puts its line where the drawing has it. */
function dimOffsetFor(doc, id, vert, at) {
  try { doc.regenerate(); const f = doc.element(id), g = dimensionGeometry(doc, f); if (!g) return null; return Math.round((vert ? at - g.a[0] : at - g.a[1]) * (vert ? g.along[0] : g.along[1])); } catch (e) { return null; }
}
