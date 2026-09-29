//! Frank Harmon Architect's drawing standards, shared by the four sample projects rebuilt from the firm's sets
//! (Schaeffer Residence, Walnut Creek Environmental Education Center, First Presbyterian Church, AIA NC Center):
//! the title strip along the right edge of an ARCH D sheet, Futura lettering, the firm's materials and wall,
//! floor and roof types, its dimension and text types and view styles - and the helpers every one of the models
//! is built with, so each is 3D first: walls from a base level to a top level (or attached to the roof), floors
//! on their levels, roofs by footprint, stairs counted from their levels, the ground from its contours. The sets
//! are imperial; the models are metric (feet are only how the source dimensions were read: ft()).

import { newDocument } from "./bim.js";
import { Editor } from "./ops.js";

export const ft = v => Math.round(v * 304.8);                  // a dimension read in feet, in mm
export const FT = pts => pts.map(p => [ft(p[0]), ft(p[1])]);
export const PT = (x, y) => [ft(x), ft(y)];

/** A new FHA project: the firm's standards in its library, and the helpers to build it with. */
export function fhaProject(name, project) {
  const doc = newDocument(name);
  doc.meta.displayUnits = "mm";
  doc.meta.project = Object.assign({ firm: "FRANK HARMON ARCHITECT", firmAddress: "14 E PEACE STREET\nRALEIGH NORTH CAROLINA 27604", phone: "919 829 9464", fax: "919 829 2202",
    drawn: "JB", checked: "FH", issue: "PERMIT SET" }, project);
  doc.meta.annotation = { kind: "revit", font: "Futura", gridHead: 8, gridText: 4.2, gridEnd: 4, gridCentreColour: "#000000",
    markerRadius: 4.5, markerText: 2.2, markerSheetText: 2.0, levelText: 2.0, levelValueText: 2.0, levelHeads: "Right" };
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
  L.dimTypes["DT-FH"] = { name: "FHA - architectural tick, Futura 2.0", arrow1: "Oblique", arrow2: "Oblique", arrowSize: 2.0, tickWeight: 0.35, lineWeight: 0.13, extWeight: 0.13,
    dimExtend: 1.5, extFixed: 2.5, extBeyond: 1.5, font: "Futura", textHeight: 2.0, textGap: 1.0, unit: "Project", precision: 0, roundOff: 5, textSide: "Readable", fit: "Keep inside" };
  doc.meta.defaultDimType = "DT-FH";

  // ---------------------------------------------------------------- patterns and materials
  Object.assign(L.patterns, {
    "P-FH-SEAM": { name: "Standing seam, 406 (16\") o.c.", kind: "model", lines: [{ angle: 90, origin: [0, 0], delta: [0, 406] }] },
    "P-FH-SIDING": { name: "Board siding, 203 (8\")", kind: "model", lines: [{ angle: 0, origin: [0, 0], delta: [0, 203] }] },
    "P-FH-PANEL": { name: "Panel joints 1219 (4') grid", kind: "model", lines: [{ angle: 0, origin: [0, 0], delta: [0, 2438] }, { angle: 90, origin: [0, 0], delta: [0, 1219] }] },
    "P-FH-CLAD": { name: "Vertical cladding, 305 (12\")", kind: "model", lines: [{ angle: 90, origin: [0, 0], delta: [0, 305] }] },
    "P-FH-EARTH": { name: "Earth", kind: "drafting", lines: [{ angle: 45, origin: [0, 0], delta: [0, 1.6] }, { angle: 45, origin: [0.8, 0], delta: [0, 1.6], dashes: [0.6, -1.0] }] },
    "P-FH-GRAVEL": { name: "Gravel", kind: "drafting", lines: [{ angle: 30, origin: [0, 0], delta: [0.9, 1.2], dashes: [0.25, -1.1] }, { angle: 120, origin: [0.4, 0.2], delta: [0.9, 1.2], dashes: [0.25, -1.3] }] },
  });
  const mat = (id, name, mark, cut, proj, shade) => { L.materials[id] = { name, mark, description: name, cut, projection: proj, shading: { colour: shade } }; };
  mat("M-FH-CONC", "Architectural concrete", "21", { pattern: "P-CONC", pen: "heavy", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#c9c7c2");
  mat("M-FH-STUD", "Wood stud and batt", "66", { pattern: "P-INSUL", pen: "heavy", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#e8e1d4");
  mat("M-FH-PLY", "Plywood siding", "60", { pattern: null, pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-PANEL", lineColour: "#9a9a9a" }, "#c9a47a");
  mat("M-FH-CEMENT", "Fiber cement panel", "72", { pattern: null, pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-PANEL", lineColour: "#9a9a9a" }, "#b8b7b1");
  mat("M-FH-POLY", "Polygal clip system", "82", { pattern: null, pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-CLAD", lineColour: "#b0b0b0" }, "#e4ecee");
  mat("M-FH-GYP", "Gypsum board", "90", { pattern: null, pen: "thin", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#f2f0ec");
  mat("M-FH-METAL", "Standing seam metal roof", "70", { pattern: null, pen: "heavy", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-SEAM", lineColour: "#8c8c8c" }, "#8d949b");
  mat("M-FH-WOOD", "Wood decking / siding", "62", { pattern: "P-TIMBER", pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-FH-SIDING", lineColour: "#a0a0a0" }, "#b58c5e");
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
  const win = (id, name, mark, w, h, mullions = 0) => { L.types[id] = { family: "F-CASEMENT", name, mark, width: w, height: h, frame: 50, mullions }; };
  win("T-FH-W24", "Aluminum clad window 2'-0\"x4'-0\"", "W1", 610, 1219);
  win("T-FH-W44", "Aluminum clad window 4'-0\"x4'-0\"", "W2", 1219, 1219);
  win("T-FH-W46", "Aluminum clad window 4'-0\"x6'-0\"", "W3", 1219, 1829);
  win("T-FH-W84", "Aluminum clad window 8'-0\"x4'-0\"", "W4", 2438, 1219, 1);
  win("T-FH-W86", "Aluminum clad window 8'-0\"x6'-0\"", "W5", 2438, 1829, 1);
  win("T-FH-W48", "Aluminum clad window 4'-0\"x8'-0\"", "W6", 1219, 2438);
  win("T-FH-W1210", "Storefront 12'-0\"x10'-0\"", "W7", 3658, 3048, 2);
  win("T-FH-W42", "Aluminum clad awning 4'-0\"x2'-0\"", "W8", 1219, 610);
  win("T-FH-W417", "Stair glazing 4'-0\"x16'-0\"", "W9", 1219, 4877);
  win("T-FH-SF1615", "Storefront 16'-0\"x15'-0\"", "W10", 4877, 4572, 3);
  win("T-FH-SF2111", "Storefront 21'-0\"x11'-0\"", "W11", 6401, 3353, 4);

  // ---------------------------------------------------------------- view styles
  const base = JSON.parse(JSON.stringify(L.viewStyles["VS-CONSTRUCTION"] || {}));
  L.viewStyles["VS-FH-PLAN"] = Object.assign(JSON.parse(JSON.stringify(base)), { name: "FHA - plans", rules: [] });
  L.viewStyles["VS-FH-ELEV"] = Object.assign(JSON.parse(JSON.stringify(base)), { name: "FHA - elevations", rules: [] });
  L.viewStyles["VS-FH-SEC"] = Object.assign(JSON.parse(JSON.stringify(base)), { name: "FHA - sections (cut poché black)", rules: [
    { id: "FH-SEC-POCHE", when: { param: "Category", in: ["IfcWall", "IfcStair", "IfcColumn", "IfcBeam"] }, then: { cut: { fill: "#000000", pattern: "none" } } }] });
  L.viewStyles["VS-FH-3D"] = Object.assign(JSON.parse(JSON.stringify(base)), { name: "FHA - 3D" });
  // the site plan: the plans' style with the planting and the ground shown
  L.viewStyles["VS-FH-SITE"] = Object.assign(JSON.parse(JSON.stringify(L.viewStyles["VS-FH-PLAN"])), { name: "FHA - site plan" });
  for (const k of ["VS-FH-PLAN", "VS-FH-ELEV", "VS-FH-SEC"]) { const s = L.viewStyles[k]; s.byCategory = Object.assign({}, s.byCategory, { Furniture: { visible: false }, Planting: { visible: false } }); }

  // ---------------------------------------------------------------- the helpers the models are built with
  const R = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const H = {
    doc, ed, add, set, line, R,
    level: (id, name, z) => add({ id, type: "Level", name, args: { name, elevation: z } }),
    grid: (id, name, a, b) => add({ id, type: "Grid", name: `Grid ${name}`, args: { name, line: line(a, b), ends: "End", headSize: 8, textSize: 4.2 } }),
    /** A wall from its base level to its top level (or up a height), or up to the roof it is attached to. */
    wall: (id, a, b, type, base, top, o = {}) => add({ id, type: "Wall", name: o.name || id, args: Object.assign({ centreline: line(a, b), mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: base }, baseOffset: o.baseOffset || 0,
      topLevel: top ? { ref: top } : null, topOffset: o.topOffset || 0, height: o.height || 3000, flipped: false }, o.roof ? { attachTop: { ref: o.roof } } : {}) }),
    /** A chain of walls through points (closed if asked): ids id1, id2, ... */
    walls: (id, pts, type, base, top, o = {}) => { const n = o.closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) H.wall(`${id}${i + 1}`, pts[i], pts[(i + 1) % pts.length], type, base, top, o); },
    floor: (id, name, boundary, type, lev, off = 0) => add({ id, type: "Floor", name, args: { boundary, floorType: { ref: type }, level: { ref: lev }, heightOffset: off } }),
    roof: (id, name, boundary, lev, off, slopes, o = {}) => add({ id, type: "Roof", name, args: Object.assign({ boundary, level: { ref: lev }, heightOffset: off, thickness: o.thickness || 250, material: o.material || "M-FH-METAL", edgeSlopes: slopes, ridgeHeight: o.ridge || 0 }, o.args || {}) }),
    stair: (id, name, base, top, flights, o = {}) => add({ id, type: "Stair", name, args: Object.assign({ baseLevel: { ref: base }, topLevel: top ? { ref: top } : null, flights, width: o.width || 914, material: o.material || "M-FH-WOOD", railings: o.railings || "Both" }, o.args || {}) }),
    topo: (id, name, contours, boundary, base) => add({ id, type: "Toposurface", name, args: { contours, boundary, base, interval: 305, major: 5, material: "M-SOIL" } }),
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
    sheet: (number, name, vps, size = "ARCH D") => add({ id: `SH-${number}`, type: "Sheet", name: `${number} ${name}`, args: { number, sheetName: name, size, orientation: "landscape", titleBlock: { ref: "SY-TB-FHA" },
      viewports: vps.map(([view, at, extra], i) => Object.assign({ id: `VP${i + 1}`, view: { ref: view }, at, clipVisible: false }, extra || {})), revision: "" } }),
    /** Where a viewport goes so that the drawing sits where the source set has it: a model point `m` the set draws
     *  at paper point `p` at its scale (1:srcScale), matched at the drawing's middle `c` so a small difference of
     *  scale spreads evenly to both ends. */
    place: (p, m, c, crop, scale, srcScale = 48) => { const pc = [p[0] + (c[0] - m[0]) / srcScale, p[1] + (c[1] - m[1]) / srcScale]; return [pc[0] + ((crop[0] + crop[2]) / 2 - c[0]) / scale, pc[1] + ((crop[1] + crop[3]) / 2 - c[1]) / scale]; },
    /** Where a viewport goes so that a model point lands on a paper point: the crop's centre, from that pair. */
    at: (paper, model, crop, scale) => [paper[0] + ((crop[0] + crop[2]) / 2 - model[0]) / scale, paper[1] + ((crop[1] + crop[3]) / 2 - model[1]) / scale],
  };
  return H;
}
