//! Wetlap Residential Development (Techne Architecture + Interior Design, Melbourne, 2021): the Design Development
//! set, part 1 (38 A1 sheets), rebuilt from its PDF as a model and its sheets. Not a sample: a project file,
//! written by build.mjs to wetlap.json and opened with File > Open.
//!
//! What it is made of (see tools/README.md for how each part is read off the PDF):
//!   - the office's standards (Techne, Australian practice): A1 sheets and the title strip, Arial (the set's
//!     Swiss 721 Condensed) at 0.82 width, RLs in mm on the survey datum, level heads RL / V / name at the right,
//!     grid heads 9 mm, oblique ticks, existing work in solid black poche and new partitions in grey outline;
//!   - the model: levels of both buildings (the apartments, "NORTH", and the lofts) on the AHD datum, the grids
//!     1-19 / A-K, every wall the GA plans cut (concrete and masonry in black, partitions in grey) from its level
//!     to the next, the existing brick piers and columns, a slab on each level;
//!   - the sheets: one view per drawing, placed where the set has it, the notes, tags, dimensions and bubbles as
//!     annotation in its view, and what the model does not draw (joinery, fixtures, finishes, swings) as the view's
//!     drafted layer, pen for pen; the elevations' and site plans' shaded raster as the sheet's own image.

import { fhaProject } from "../../src/sample_fha.js";
import { emptySketch, weld } from "../../src/bimsketch.js";
import { textWidth } from "../../src/scene.js";

// the survey datum: the model's zero is the apartments' ground floor, RL 25600
const DATUM = 25600;
const GX = [0, 7664, 11460, 15867, 18073, 22137, 25400, 28478, 31740, 35453, 39210, 42438, 45496, 50928, 56415, 61902, 67389, 72876, 79072];
const GY = { A: 0, B: 2402, C: 5265, D: 10451, E: 12575, F: 20851, G: 24045, H: -1034, I: 516, J: 8872, K: 10260 };
const LEVELS = [
  ["L-B", 22600, "BASEMENT / LOWER GROUND PLAN"],
  ["L-AG", 25600, "GROUND LEVEL NORTH"], ["L-A1", 28855, "LEVEL 1 NORTH"], ["L-A2", 32110, "LEVEL 2 NORTH"], ["L-A3", 35365, "LEVEL 3 NORTH"],
  ["L-A4", 38620, "LEVEL 4 NORTH"], ["L-AR", 42225, "ROOFTOP NORTH"],
  ["L-LG", 27500, "GROUND LEVEL LOFTS"], ["L-L1", 30650, "LEVEL 1 LOFTS"], ["L-L2", 33750, "LEVEL 2 LOFTS"], ["L-L3", 36900, "LEVEL 3 LOFTS"], ["L-LR", 40362, "ROOFTOP LOFTS"],
];
// each page: the level its plan cuts, the next level up (its walls' top), whether its walls are modelled, the
// sheet point of the model's origin (grid 1 x grid A) and the scale
const APT = [152.86, 170.0], LOFT = [-209.08, 236.29];
const PLANS = {
  4: { lev: "L-AG", o: [198.34, 214.24], scale: 200, style: "VS-WL-GRID" },
  7: { lev: "L-B", top: "L-AG", walls: true, o: [140.06, 290.0] }, 8: { lev: "L-AG", top: "L-A1", walls: true, o: APT }, 9: { lev: "L-A1", top: "L-A2", walls: true, o: APT },
  10: { lev: "L-A2", top: "L-A3", walls: true, o: APT }, 11: { lev: "L-A3", top: "L-A4", walls: true, o: APT }, 12: { lev: "L-A4", top: "L-AR", walls: true, o: APT },
  13: { lev: "L-AR", walls: true, o: APT },
  14: { lev: "L-B", top: "L-LG", walls: true, o: [-162.83, 251.88] }, 15: { lev: "L-LG", top: "L-L1", walls: true, o: LOFT }, 16: { lev: "L-L1", top: "L-L2", walls: true, o: LOFT },
  17: { lev: "L-L2", top: "L-L3", walls: true, o: LOFT }, 18: { lev: "L-L3", top: "L-LR", walls: true, o: LOFT }, 19: { lev: "L-LR", walls: true, o: LOFT },
  20: { lev: "L-AG", o: [151.51, 187.45] }, 21: { lev: "L-A1", o: [151.51, 187.45] }, 22: { lev: "L-B", o: [140.06, 290.0] },
  23: { lev: "L-AG", o: [151.46, 187.45] }, 24: { lev: "L-A1", o: [151.46, 187.45] }, 25: { lev: "L-B", o: [139.66, 290.15] },
  26: { lev: "L-AG", o: APT }, 27: { lev: "L-A1", o: APT }, 28: { lev: "L-A2", o: APT }, 29: { lev: "L-A3", o: APT }, 30: { lev: "L-A4", o: APT },
  31: { lev: "L-B", o: [-162.95, 251.81] }, 32: { lev: "L-LG", o: LOFT }, 33: { lev: "L-L1", o: LOFT }, 34: { lev: "L-L2", o: LOFT }, 35: { lev: "L-L3", o: LOFT },
};
const DRAWING = [4, 50, 837, 590];
// the elevations: each view's direction (from its grids' order on the sheet), a grid and an RL where the set draws
// them, its drawing's area, where its level heads are and its grid heads' height
const ELEVS = {
  36: [{ id: "V-EL-N", name: "PROPOSED WETLAP NORTH ELEVATION", look: "+x", ref: ["G", 258.8], z0: [0, 356.25], rect: [215, 340, 600, 575], head: 575.66, gridHead: 579.3, bld: "A" },
       { id: "V-EL-E", name: "PROPOSED WETLAP EAST ELEVATION", look: "-y", ref: ["1", 582.0], z0: [0, 86.6], rect: [40, 75, 770, 312], head: 759.76, gridHead: 317.1, bld: "A" }],
  37: [{ id: "V-EL-W", name: "PROPOSED WETLAP WEST ELEVATION", look: "+y", ref: ["1", 152.1], z0: [0, 349.03], rect: [60, 340, 650, 572], head: 101.7, gridHead: 576.6, bld: "A", line: -25000 },
       { id: "V-EL-S", name: "PROPOSED WETLAP SOUTH ELEVATION", look: "-x", ref: ["A", 231.2], z0: [0, 101.1], rect: [60, 62, 560, 322], head: 69.9, gridHead: 325.9, bld: "A", line: 47500 }],
  38: [{ id: "V-EL-LW", name: "PROPOSED LOFTS WEST ELEVATION", look: "+y", ref: ["10", 84.7], z0: [1900, 371.44], rect: [60, 345, 580, 577], head: 561.36, gridHead: 581.1, bld: "L", line: -25000 },
       { id: "V-EL-LS", name: "PROPOSED LOFTS SOUTH ELEVATION", look: "-x", ref: ["H", 153.4], z0: [1900, 134.72], rect: [60, 62, 330, 325], head: 96.6, gridHead: 329.6, bld: "L", line: 82000 },
       { id: "V-EL-LE", name: "PROPOSED LOFTS EAST ELEVATION", look: "-y", ref: ["19", 459.6], z0: [1900, 134.72], rect: [420, 62, 800, 310], head: 432.4, gridHead: 314.3, bld: "L" }],
};
/** An elevation's line (in front of its face, looking along its direction) and its coordinate at its ref grid. */
function elevLine(E) {
  const LN = { "+x": [[E.line ?? -8000, -40000], [E.line ?? -8000, 90000]], "-x": [[E.line ?? 100000, 90000], [E.line ?? 100000, -40000]],
    "+y": [[120000, E.line ?? -25000], [-40000, E.line ?? -25000]], "-y": [[-40000, E.line ?? 30000], [120000, E.line ?? 30000]] }[E.look];
  const [a, b] = LN, dl = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / dl, (b[1] - a[1]) / dl];
  const g = gridCoord(E.ref[0]), Pref = E.look.endsWith("x") ? [0, g] : [g, 0];
  return { a, b, d, sRef: (b[0] - Pref[0]) * d[0] + (b[1] - Pref[1]) * d[1] };
}
const gridCoord = n => /^\d+$/.test(n) ? GX[+n - 1] : GY[n];
      // where a sheet's drawing is (above the title strip), sheet mm

/** The project, from its extracted data: { set, lift, raster: { meta, urls } } (see build.mjs). */
export function buildWetlap(D) {
  const H = fhaProject("WETLAP RESIDENTIAL DEVELOPMENT", {});
  const { doc, add, set } = H, L = doc.lib; H.bulk = true;
  // ---------------------------------------------------------------- the office: Techne, Australian practice
  doc.meta.project = { firm: "TECHNE ARCHITECTURE + INTERIOR DESIGN", firmAddress: "29-31 Rathdowne Street\nCarlton 3053 Australia", phone: "+61 (0) 3 9600 0222",
    web: "techne.com.au", number: "18023", client: "GLENVILL", address: "YARRABEND, HEIDELBERG ROAD\nALPHINGTON 3078", issue: "DESIGN DEVELOPMENT", issueDate: "25/03/2021",
    status: "FOR PRICING ONLY - NOT FOR CONSTRUCTION", drawn: "", checked: "SMa", codes: "NCC 2019 / Building Regulations 2018 (Vic)" };
  doc.meta.displayUnits = "mm"; delete doc.meta.scaleNames;
  doc.meta.surveyElevation = DATUM;
  doc.meta.annotation = { kind: "revit", font: "Arial", widthFactor: 0.81, gridHead: 9, gridText: 4.67, gridEnd: 0, gridCentreColour: null,
    markerRadius: 4.5, markerText: 2.0, markerSheetText: 1.6, calloutSheet: false, levelText: 1.85, levelValueText: 1.85, levelHeads: "Right", levelStyle: "techne", sectionStyle: "revit" };
  L.pens["PEN-ISO"] = { name: "Techne (Revit export)", pens: { gossamer: { weight: 0.085 }, hairline: { weight: 0.085 }, thin: { weight: 0.17 }, light: { weight: 0.21 },
    medium: { weight: 0.25 }, heavy: { weight: 0.34 }, bold: { weight: 0.5 }, extra: { weight: 0.68 }, primary: { weight: 0.7 } }, perScale: {} };
  Object.assign(L.textTypes, {
    "TT-WL-18": { name: "Swiss 721 Cond 1.8 (notes, tags)", height: 1.85, font: "Arial", widthFactor: 0.81, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
    "TT-WL-25": { name: "Swiss 721 Cond 2.5 (room names)", height: 2.5, font: "Arial", widthFactor: 0.82, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
    "TT-WL-35": { name: "Swiss 721 Cond 3.5 (titles)", height: 3.5, font: "Arial", widthFactor: 0.82, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
  });
  L.dimTypes["DT-WL"] = { name: "Techne - oblique 2 mm, mm, Swiss 721 Cond 1.9", arrow1: "Oblique", arrow2: "Oblique", arrowSize: 2.0, tickWeight: 0.21, lineWeight: 0.085, extWeight: 0.085,
    dimExtend: 1.5, extFixed: 2.0, extBeyond: 1.5, font: "Arial", widthFactor: 0.82, textHeight: 1.89, textGap: 0.75, unit: "mm", precision: 0, roundOff: 0, textSide: "Readable", fit: "Keep inside" };
  doc.meta.defaultDimType = "DT-WL";
  // materials as the set cuts them: concrete and masonry outlined black, partitions grey, existing work solid black
  const mat = (id, name, mark, cut, shade) => { L.materials[id] = { name, mark, description: name, cut, projection: { pen: "gossamer" }, shading: { colour: shade } }; };
  mat("M-WL-CONC", "Concrete (new)", "CON", { pattern: null, pen: "thin", lineColour: "#000000", background: "#ffffff" }, "#c9c7c2");
  mat("M-WL-PART", "Plasterboard on stud", "PB", { pattern: null, pen: "thin", lineColour: "#ababab", background: "#ffffff" }, "#eeeae4");
  mat("M-WL-JOINERY", "Joinery (laminate)", "JN", { pattern: null, pen: "gossamer", lineColour: "#aaaaaa", background: "#ffffff" }, "#e9e4dc");
  mat("M-WL-CERAMIC", "Vitreous china", "VC", { pattern: null, pen: "gossamer", lineColour: "#aaaaaa", background: "#ffffff" }, "#f4f4f2");
  mat("M-WL-EXBR", "Existing brick / structure", "EX-BR", { pattern: null, pen: "thin", lineColour: "#000000", background: "#000000" }, "#9c5c46");
  // the existing brick seen in elevation: stretcher bond, 230 x 76 with 10 joints (Revit's brick surface pattern)
  L.patterns["P-WL-BRICK"] = { name: "Brick stretcher bond 230x86", kind: "model", lines: [{ angle: 0, origin: [0, 0], delta: [0, 86] }, { angle: 90, origin: [0, 0], delta: [86, 120], dashes: [86, -86] }] };
  L.materials["M-WL-EXBR"].projection = { pen: "gossamer", pattern: "P-WL-BRICK", lineColour: "#b4b4b4" };
  mat("M-WL-GROUND", "Ground", "GL", { pattern: null, pen: "thin", lineColour: "#000000", background: "#d0d0d0" }, "#8f8a7f");
  L.materials["M-WL-GROUND"].projection = { pen: "thin", background: "#cfcfcf" };
  L.types["T-WL-SLAB"] = { family: "F-FLOOR", name: "Concrete slab 200", mark: "SL1", layers: [{ function: "Structure", thickness: 200, material: "M-WL-CONC" }], coreStart: 0, coreEnd: 1 };
  const wtype = (cls, t) => { const id = `T-WL-${cls}-${t}`; if (!L.types[id]) {
      const m = cls === "C" ? "M-WL-CONC" : cls === "EX" ? "M-WL-EXBR" : "M-WL-PART", nm = cls === "C" ? "Concrete / masonry" : cls === "EX" ? "Existing brick" : "Partition";
      L.types[id] = { family: cls === "P" ? "F-PARTITION" : "F-BASICWALL", name: `${nm} ${t}`, mark: `${cls}${t}`, layers: [{ function: "Structure", thickness: t, material: m }], coreStart: 0, coreEnd: 1,
        params: { Function: cls === "P" ? "Interior" : "Exterior" } }; }
    return id; };
  const ctype = (w, d) => { const id = `T-WL-COL-${w}x${d}`; if (!L.types[id]) L.types[id] = { family: "F-COLUMN", name: `Existing column ${w}x${d}`, mark: "EC", width: w, depth: d, material: "M-WL-EXBR" }; return id; };
  // view styles: the plans (floors' edges are the drafting's), the elevations (their shaded image is the set's own),
  // the grid setout (datums only)
  const base = JSON.parse(JSON.stringify(L.viewStyles["VS-FH-PLAN"]));
  const style = (id, name, hide) => { L.viewStyles[id] = Object.assign(JSON.parse(JSON.stringify(base)), { name }); const s = L.viewStyles[id];
    s.byCategory = Object.assign({}, s.byCategory); for (const c of hide) s.byCategory[c] = { visible: false }; s.byCategory.IfcGrid = Object.assign({}, s.byCategory.IfcGrid, { colour: "#8c8c8c" }); };
  style("VS-WL-PLAN", "Techne - plans", ["IfcSpace", "Planting", "Topography", "IfcBeam"]);
  // the structural slab is not drawn on the plans (its finishes are)
  L.viewStyles["VS-WL-PLAN"].rules = [{ id: "R-SLAB", name: "Structural slab not drawn", when: { param: "Type", is: "T-WL-SLAB" }, then: { visible: false } }];
  // fixtures and joinery in the set's grey hairline
  L.viewStyles["VS-WL-PLAN"].byCategory.Furniture = { visible: true, projection: { pen: "gossamer", colour: "#aaaaaa", fill: "none" } };
  // each building's plans show that building only (the other is hatched and named in the drafting, as the set has it)
  for (const [id, name, other] of [["VS-WL-PLAN-APT", "Techne - plans, apartments", "LOFTS"], ["VS-WL-PLAN-LOFT", "Techne - plans, lofts", "APARTMENTS"]]) {
    L.viewStyles[id] = Object.assign(JSON.parse(JSON.stringify(L.viewStyles["VS-WL-PLAN"])), { name });
    L.viewStyles[id].rules = L.viewStyles["VS-WL-PLAN"].rules.concat([{ id: `R-HIDE-${other}`, name: `The ${other.toLowerCase()} hidden`, when: { param: "Building", is: other }, then: { visible: false } }]); }
  style("VS-WL-GRID", "Techne - grid setout", ["IfcSlab", "IfcWall", "IfcColumn", "IfcSpace", "IfcStair", "Furniture", "Planting", "Topography", "IfcBeam", "IfcWindow", "IfcDoor"]);
  L.viewStyles["VS-WL-3D"] = Object.assign(JSON.parse(JSON.stringify(L.viewStyles["VS-FH-3D"])), { name: "Techne - 3D" });

  // ---------------------------------------------------------------- the set's data
  const S = D.set;
  H.pdf = { titleBlocks: S.titleBlocks, sheets: S.sheets, pages: S.pages, tiles: {}, setName: "WETLAP" };
  // the strip's words are set in GT Walsheim and Swiss 721 Condensed, read here as Futura and Arial: each fixed text
  // takes the width it has on the set (its measured room), the fields the office's average (0.93 Walsheim, 0.9 the title)
  for (const [id, fam] of Object.entries(S.titleBlocks)) { const f = L.symbols[id] = JSON.parse(JSON.stringify(fam));
    for (const it of f.items) { if (it.k === "text" && it.room && it.text.length > 1) { const w = textWidth(it.text, it.h, it.font); if (w > 0) it.widthFactor = +Math.min(1.1, Math.max(0.7, it.room / 1.03 / w)).toFixed(3); }
      if (it.k === "label") it.widthFactor = it.font === "Arial" ? 0.9 : 0.93; } }

  // ---------------------------------------------------------------- levels and grids
  for (const [id, rl, name] of LEVELS) H.level(id, name, rl - DATUM);
  const Z = Object.fromEntries(LEVELS.map(([id, rl]) => [id, rl - DATUM]));
  const gridIds = {};
  GX.forEach((x, i) => { const n = String(i + 1), id = `G-${n}`; gridIds[n] = id;
    add({ id, type: "Grid", name: `Grid ${n}`, args: { name: n, line: H.line([x, i < 13 ? -3000 : -4000], [x, i < 13 ? 27000 : 14000]), ends: "End", headSize: 9, textSize: 4.67 } }); });
  for (const [n, y] of Object.entries(GY)) { const id = `G-${n}`, loft = "HIJK".includes(n); gridIds[n] = id;
    add({ id, type: "Grid", name: `Grid ${n}`, args: { name: n, line: H.line([loft ? 82000 : 48000, y], [loft ? 48000 : -3000, y]), ends: "End", headSize: 9, textSize: 4.67 } }); }

  // ---------------------------------------------------------------- the model: walls, columns, brick, slabs
  const placed = [];                           // [level, a, b, t] of walls placed (the basement is on two pages)
  const overlaps = (lev, a, b, t) => placed.some(w => { if (w[0] !== lev) return false;
    const d = [b[0] - a[0], b[1] - a[1]], L0 = Math.hypot(...d); if (!L0) return true; const u = [d[0] / L0, d[1] / L0];
    const e = [w[2][0] - w[1][0], w[2][1] - w[1][1]], L1 = Math.hypot(...e); if (!L1) return false; if (Math.abs(u[0] * e[1] - u[1] * e[0]) / L1 > 0.02) return false;
    // a duplicate lies over the other (its band inside, not touching) along most of the new wall
    const off = Math.abs(-(w[1][0] - a[0]) * u[1] + (w[1][1] - a[1]) * u[0]); if (off > Math.abs(t - w[3]) / 2 + 30) return false;
    const s0 = (w[1][0] - a[0]) * u[0] + (w[1][1] - a[1]) * u[1], s1 = (w[2][0] - a[0]) * u[0] + (w[2][1] - a[1]) * u[1];
    return Math.min(L0, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1)) > 0.5 * L0; });
  const r5 = v => Math.round(v / 5) * 5;
  const dec = v => { const o = v.slice(0, 2); for (let i = 2; i < v.length; i++) o.push(o[i - 2] + v[i]); return o.map(x => x / 100); };
  // a window's sill and head, read off the set's elevation that faces it: its span projected onto that sheet, the
  // rows where its frame draws a line across most of that span (the lowest above the floor, the highest below
  // the next floor). Measured at build time; the elevations in the file are the model's own.
  const measureWin = (c, u, w, z0, z1, bld) => { if (!D.ras) return null;
    for (const [pg, list] of Object.entries(ELEVS)) { const R = D.ras[pg]; if (!R) continue;
      for (const E of list) { if ((E.bld === "L") !== (bld === "LOFTS")) continue; const alongY = E.look.endsWith("x"); if (alongY ? Math.abs(u[1]) < 0.9 : Math.abs(u[0]) < 0.9) continue;
        const ln = elevLine(E), d = ln.d, sOfP = P => (ln.b[0] - P[0]) * d[0] + (ln.b[1] - P[1]) * d[1];
        const px = P => E.ref[1] + (sOfP(P) - ln.sRef) / 100, py = z => E.z0[1] + (z - E.z0[0]) / 100;
        let x1 = px([c[0] - u[0] * w * 0.4, c[1] - u[1] * w * 0.4]), x2 = px([c[0] + u[0] * w * 0.4, c[1] + u[1] * w * 0.4]); if (x1 > x2) [x1, x2] = [x2, x1];
        if (x1 < E.rect[0] || x2 > E.rect[2]) continue;
        const [rx, ry, rw, rh] = R.rect, k = R.gw / rw, U = x => Math.round((x - rx) * k), V = y => Math.round((ry + rh - y) * k);
        const u1 = U(x1), u2 = U(x2), vTop = V(py(z1 - 60)), vBot = V(py(z0 + 40)); if (u2 - u1 < 4 || vBot <= vTop) continue;
        const rows = [];
        for (let v = vTop; v <= vBot; v++) { if (v < 0 || v >= R.gh) continue; let dk = 0; for (let x = u1; x <= u2; x++) if (R.buf[v * R.gw + x] < 120) dk++; if (dk / (u2 - u1 + 1) > 0.55) rows.push(v); }
        if (rows.length < 2) continue;
        const zOf = v => E.z0[0] + ((ry + rh - v / k) - E.z0[1]) * 100, head = zOf(rows[0]), sill = zOf(rows[rows.length - 1]);
        if (head - sill < 500) continue;
        return { sill: r5(sill - z0), h: r5(head - sill) }; } }
    return null; };
  // ---------------------------------------------------------------- doors and windows
  // Read off the plans, built as elements: a door where the set draws a swing (its centre the hinge, its radius
  // the leaf, the side it bulges to the facing), in the gap its wall leaves; a window or a sliding door where a
  // wall breaks under a window or door tag (A.G.23 / WT01: its Mark over its type); a window in every break of
  // the existing brick. The wall is closed over the gap and the opening cut in it, so the plans, elevations, 3D and
  // schedules all draw the one element.
  const dtypes = {}, wtypes = {};
  const dtype = (code, w, o = {}) => { const id = `T-WL-${code}-${w}`; if (!L.types[id]) L.types[id] = Object.assign({ family: "F-SINGLEDOOR", name: `${code} door ${w}x2040`, mark: code, width: w, height: 2040, leafThickness: 40, frame: 35 }, o); return id; };
  const wtypeW = (code, w, h) => { const id = `T-WL-${code}-${w}x${h}`; if (!L.types[id]) L.types[id] = { family: "F-CASEMENT", name: `${code} window ${w}x${h}`, mark: code, width: w, height: h, frame: 50, mullions: Math.max(0, Math.round(w / 1200) - 1) }; return id; };
  let nD = 0, nWin = 0, nTag = 0, nMeas = 0;
  const tagsOf = (pg, O) => (S.pages[pg].notes || []).filter(n => /^[A-Z]\.[A-Z0-9]+\.\d+\n[A-Z]{2,3}\.?\d*$/.test(n.t))
    .map(n => { const [mark, code] = n.t.split("\n"), c = [(n.bb[0] + n.bb[2]) / 2, (n.bb[1] + n.bb[3]) / 2]; return { mark, code, paper: c, at: [(c[0] - O[0]) * 100, (c[1] - O[1]) * 100] }; })
    .filter((t, i, all) => all.findIndex(u => u.mark === t.mark && Math.hypot(u.at[0] - t.at[0], u.at[1] - t.at[1]) < 300) === i);
  // a quarter circle drawn as a cubic: its centre from the tangent at its start, its radius
  const arcOf = q => { const P0 = [q[0], q[1]], P1 = [q[2], q[3]], P3 = [q[6], q[7]], t0 = [P1[0] - P0[0], P1[1] - P0[1]], lt = Math.hypot(...t0); if (lt < 1e-6) return null;
    const n0 = [-t0[1] / lt, t0[0] / lt], d = [P0[0] - P3[0], P0[1] - P3[1]], den = 2 * (n0[0] * d[0] + n0[1] * d[1]); if (Math.abs(den) < 1e-6) return null;
    const t = -(d[0] * d[0] + d[1] * d[1]) / den, C = [P0[0] + n0[0] * t, P0[1] + n0[1] * t], r = Math.abs(t);
    return { C, r, E: [P0, P3] }; };
  const openings = (pg, P, bld, walls, top) => {
    const Lf = D.lift[pg], O = P.o, M = q => [(q[0] - O[0]) * 100, (q[1] - O[1]) * 100], tags = tagsOf(pg, O), used = new Set();
    // the swings: arcs of a door's radius, one per hinge
    const arcs = [];
    const keep = a => { if (a && a.r > 550 && a.r < 1250 && !arcs.some(b => Math.hypot(b.C[0] - a.C[0], b.C[1] - a.C[1]) < 60 && Math.abs(b.r - a.r) < 60)) arcs.push(a); };
    for (const r of Object.values(Lf.res)) {
      for (const c of r.c) { const q = dec(c); keep(arcOf([...M([q[0], q[1]]), ...M([q[2], q[3]]), ...M([q[4], q[5]]), ...M([q[6], q[7]])])); }
      // the PDF flattens most swings into polylines: a circle through the first, middle and last points that every
      // point keeps to, turning a quarter or more
      for (const pl of r.l) { if (pl.length < 12) continue; const q = dec(pl), all = []; for (let i = 0; i < q.length; i += 2) all.push(M([q[i], q[i + 1]]));
        // a swing is often chained to its leaf: split the chain where it turns sharply, fit each smooth run
        const runs = [[all[0]]];
        for (let i = 1; i < all.length; i++) { const r0 = runs[runs.length - 1]; if (r0.length >= 2) { const a0 = r0[r0.length - 2], a1 = r0[r0.length - 1], b1 = all[i];
            const v1 = [a1[0] - a0[0], a1[1] - a0[1]], v2 = [b1[0] - a1[0], b1[1] - a1[1]], cs = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
            if (cs < 0.87 || Math.hypot(...v2) > 400) { runs.push([a1, b1]); continue; } } r0.push(all[i]); }
        for (const pts of runs) { if (pts.length < 5) continue;
        const A = pts[0], B = pts[pts.length >> 1], Cq = pts[pts.length - 1], d = 2 * (A[0] * (B[1] - Cq[1]) + B[0] * (Cq[1] - A[1]) + Cq[0] * (A[1] - B[1])); if (Math.abs(d) < 1e-6) continue;
        const a2 = A[0] * A[0] + A[1] * A[1], b2 = B[0] * B[0] + B[1] * B[1], c2 = Cq[0] * Cq[0] + Cq[1] * Cq[1];
        const C = [(a2 * (B[1] - Cq[1]) + b2 * (Cq[1] - A[1]) + c2 * (A[1] - B[1])) / d, (a2 * (Cq[0] - B[0]) + b2 * (A[0] - Cq[0]) + c2 * (B[0] - A[0])) / d], r = Math.hypot(A[0] - C[0], A[1] - C[1]);
        if (pts.some(p => Math.abs(Math.hypot(p[0] - C[0], p[1] - C[1]) - r) > 0.04 * r)) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, ((A[0] - C[0]) * (Cq[0] - C[0]) + (A[1] - C[1]) * (Cq[1] - C[1])) / (r * r)))); if (ang < 1.2) continue;
        keep({ C, r, E: [A, Cq] }); } } }
    // walls by line: direction (0-180 deg) and offset, to 20 mm; each piece's span along it
    const lines = new Map(), lineOf = w => { const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L0 = Math.hypot(dx, dy); let u = [dx / L0, dy / L0]; if (u[0] < -1e-9 || (Math.abs(u[0]) < 1e-9 && u[1] < 0)) u = [-u[0], -u[1]];
      const n = [-u[1], u[0]], off = w.a[0] * n[0] + w.a[1] * n[1], s0 = w.a[0] * u[0] + w.a[1] * u[1], s1 = w.b[0] * u[0] + w.b[1] * u[1]; return { u, n, off, s0: Math.min(s0, s1), s1: Math.max(s0, s1) }; };
    for (const w of walls) { const g = lineOf(w), key = `${Math.round(Math.atan2(g.u[1], g.u[0]) * 180 / Math.PI)}|${Math.round(g.off / 20)}|${w.cls}`; if (!lines.has(key)) lines.set(key, []); lines.get(key).push(Object.assign({ w }, g)); }
    for (const run of lines.values()) run.sort((a, b) => a.s0 - b.s0);
    const at = (g, s_) => [r5(g.u[0] * s_ + g.n[0] * g.off), r5(g.u[1] * s_ + g.n[1] * g.off)];
    // close a gap [sa, sb] on a line with a piece of its wall; returns its id
    const bridge = (g, sa, sb, name) => { const id = `W-${pg}-${++nW}`;
      add({ id, type: "Wall", name, args: { centreline: H.line(at(g, sa), at(g, sb)), mounting: "Centred", wallType: { ref: wtype(g.w.cls, g.w.t) },
        baseLevel: { ref: P.lev }, baseOffset: 0, topLevel: P.top ? { ref: P.top } : null, topOffset: 0, height: top.height || 3000, flipped: false }, params: { Building: bld } }); return id; };
    const nearestTag = (p, codes, d = 2500) => { let best = null, bd = d; for (const t of tags) { if (used.has(t) || !codes.test(t.code)) continue; const dd = Math.hypot(t.at[0] - p[0], t.at[1] - p[1]); if (dd < bd) { bd = dd; best = t; } } return best; };
    const gaps = [];
    for (const run of lines.values()) for (let i = 0; i + 1 < run.length; i++) { const A = run[i], B = run[i + 1];
      if (Math.abs(A.w.t - B.w.t) > 10 || B.s0 - A.s1 < 250 || B.s0 - A.s1 > 6000) continue; gaps.push({ g: A, sa: A.s1, sb: B.s0, cls: A.w.cls }); }
    // doors: the swing is the door. Its centre is the hinge; of its ends, the one on a wall line is the leaf shut
    // (that wall hosts it, the opening from the hinge to there), the other the side it opens to. The wall is closed
    // over the opening where it breaks there, and the door cut in it.
    if (globalThis.__WL_DEBUG) globalThis.__WL_DEBUG[pg] = { arcs, gaps: gaps.length, tags: tags.length, doors: [] };
    const pieces = [...lines.values()].flat();
    for (const a of arcs) {
      let best = null;
      for (const E of a.E) { const d = [E[0] - a.C[0], E[1] - a.C[1]], L0 = Math.hypot(...d); if (L0 < 1) continue; const u0 = [d[0] / L0, d[1] / L0];
        for (const g of pieces) { if (Math.abs(u0[0] * g.u[1] - u0[1] * g.u[0]) > 0.08) continue;
          const off = Math.abs(a.C[0] * g.n[0] + a.C[1] * g.n[1] - g.off); if (off > g.w.t / 2 + 150) continue;
          const sC = a.C[0] * g.u[0] + a.C[1] * g.u[1], sE = E[0] * g.u[0] + E[1] * g.u[1], lo = Math.min(sC, sE), hi = Math.max(sC, sE);
          // the wall line runs up to the opening (a piece ends near a jamb)
          const reach = Math.min(Math.abs(g.s1 - lo), Math.abs(g.s0 - hi), (g.s0 <= lo && g.s1 >= hi) ? 0 : 1e9);
          if (reach > 400) continue; const score = off + reach; if (!best || score < best.score) best = { g, E, sC, sE, lo, hi, score }; } }
      if (!best) continue;
      const { g, E, sC, lo, hi } = best, key = `${Math.round(Math.atan2(g.u[1], g.u[0]) * 180 / Math.PI)}|${Math.round(g.off / 20)}|${g.w.cls}`, run = lines.get(key) || [g];
      // the opening: hinge to shut leaf, and its frame each side; the wall closed from the pieces either side
      const f0 = lo - 35, f1 = hi + 35;
      if (run.some(x => x.s0 < f0 + 1 && x.s1 > f1 - 1)) { /* the wall runs through: host there */ }
      const left = run.filter(x => x.s1 <= f0 + 60).sort((x, y) => y.s1 - x.s1)[0], right = run.filter(x => x.s0 >= f1 - 60).sort((x, y) => x.s0 - y.s0)[0];
      const sa = left && f0 - left.s1 < 400 ? Math.min(f0, left.s1) : f0, sb = right && right.s0 - f1 < 400 ? Math.max(f1, right.s0) : f1;
      const through = run.find(x => x.s0 < f0 + 1 && x.s1 > f1 - 1);
      let host, atU;
      if (through) { host = through.w.id; const ws = through.w.a[0] * g.u[0] + through.w.a[1] * g.u[1]; atU = Math.abs((lo + hi) / 2 - ws); }
      else { host = bridge(g, sa, sb, "Wall over door"); atU = (lo + hi) / 2 - sa; const pc = { w: { id: host, a: at(g, sa), b: at(g, sb), cls: g.w.cls, t: g.w.t }, u: g.u, n: g.n, off: g.off, s0: sa, s1: sb }; run.push(pc); run.sort((x, y) => x.s0 - y.s0); }
      for (const G of gaps) if (!G.done && G.g.off === g.off && G.sa < hi && G.sb > lo) G.done = true;
      // hand and facing, in the host's own frame (its start to its end, its left the side a door opens to)
      const hw = doc.argValue(doc.element(host), "centreline"), hu = [hw.end[0] - hw.start[0], hw.end[1] - hw.start[1]], hl = Math.hypot(...hu), hn = [-hu[1] / hl, hu[0] / hl];
      const Eo = a.E.find(x => x !== E), side = (Eo[0] - a.C[0]) * hn[0] + (Eo[1] - a.C[1]) * hn[1];
      const hingeS = (a.C[0] - hw.start[0]) * hu[0] / hl + (a.C[1] - hw.start[1]) * hu[1] / hl, shutS = (E[0] - hw.start[0]) * hu[0] / hl + (E[1] - hw.start[1]) * hu[1] / hl;
      const w = r5(hi - lo + 70), mid = at(g, (lo + hi) / 2), t = nearestTag(mid, /^DT/, 3000), id = `D-${pg}-${++nD}`;
      H.door(id, host, Math.round(through ? atU : atU), dtype(t ? t.code : "DT", w), { flipHand: hingeS > shutS, flipFacing: side < 0, mark: t ? t.mark : id });
      if (t) { used.add(t); placedTags.push({ pg, el: id, t }); }
      if (globalThis.__WL_DEBUG) globalThis.__WL_DEBUG[pg].doors.push(id);
    }
    // windows between the existing piers (the brick façades are piers with windows between, no wall line to break):
    // a window tag still unplaced, two piers in line either side of it, the window from face to face
    const piers = (Lf.cols || []).map(r => ({ x0: Math.min(r[0], r[2]), y0: Math.min(r[1], r[3]), x1: Math.max(r[0], r[2]), y1: Math.max(r[1], r[3]) }));
    for (const t of tags) { if (used.has(t) || !/^(WT|WEX|LT)/.test(t.code)) continue; let best = null;
      for (const vert of [true, false]) for (const a of piers) for (const b of piers) { if (a === b) continue;
        const ca = vert ? (a.x0 + a.x1) / 2 : (a.y0 + a.y1) / 2, cb = vert ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2; if (Math.abs(ca - cb) > 120) continue;
        const lo = vert ? a.y1 : a.x1, hi = vert ? b.y0 : b.x0, tp = vert ? t.at[1] : t.at[0], line = (ca + cb) / 2, off = Math.abs((vert ? t.at[0] : t.at[1]) - line);
        if (hi - lo < 300 || hi - lo > 4500 || tp < lo - 200 || tp > hi + 200 || off > 1800) continue;
        if (piers.some(c => c !== a && c !== b && Math.abs((vert ? (c.x0 + c.x1) / 2 : (c.y0 + c.y1) / 2) - line) < 150 && (vert ? c.y0 : c.x0) > lo - 1 && (vert ? c.y1 : c.x1) < hi + 1)) continue;
        const score = off + (hi - lo) * 0.2; if (!best || score < best.score) best = { score, vert, lo, hi, line, th: Math.min(vert ? a.x1 - a.x0 : a.y1 - a.y0, vert ? b.x1 - b.x0 : b.y1 - b.y0) }; }
      if (!best) continue;
      const { vert, lo, hi, line } = best, th = r5(Math.max(100, best.th)), A = vert ? [r5(line), r5(lo)] : [r5(lo), r5(line)], B = vert ? [r5(line), r5(hi)] : [r5(hi), r5(line)];
      const id = `W-${pg}-${++nW}`, w = r5(hi - lo), code = t.code;
      add({ id, type: "Wall", name: "Existing brick over window", args: { centreline: H.line(A, B), mounting: "Centred", wallType: { ref: wtype("EX", th) }, baseLevel: { ref: P.lev }, baseOffset: 0,
        topLevel: P.top ? { ref: P.top } : null, topOffset: 0, height: top.height || 3000, flipped: false }, params: { Building: bld } });
      const m = measureWin([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], vert ? [0, 1] : [1, 0], w, Z[P.lev], P.top ? Z[P.top] : Z[P.lev] + 3000, bld);
      const wid = `WN-${pg}-${++nWin}`; H.window(wid, id, w / 2, wtypeW(code, w, m ? m.h : code === "WEX" ? 2100 : 2400), m ? m.sill : code === "WEX" ? 700 : 300, { mark: t.mark });
      used.add(t); placedTags.push({ pg, el: wid, t }); }
    // windows and sliding doors: the tagged gaps, and every gap in the existing brick
    for (const G of gaps) { if (G.done) continue; const g = G.g, mid = at(g, (G.sa + G.sb) / 2), w = r5(G.sb - G.sa);
      const t = nearestTag(mid, /^(WT|DT|LT|WEX)/, 3000);
      if (!t && G.cls !== "EX") continue; G.done = true;
      const host = bridge(g, G.sa, G.sb, t ? `Wall over ${t.code}` : "Existing brick over window"), code = t ? t.code : "WEX";
      if (/^DT/.test(code)) { const id = `D-${pg}-${++nD}`; H.door(id, host, w / 2, dtype(code, w, { glazed: true }), { mark: t.mark, args: { operation: "Sliding" } }); used.add(t); placedTags.push({ pg, el: id, t }); }
      else { const id = `WN-${pg}-${++nWin}`, m = measureWin(mid, g.u, w, Z[P.lev], P.top ? Z[P.top] : Z[P.lev] + 3000, bld);
        const h = m ? m.h : code === "WEX" ? 2100 : 2400, sill = m ? m.sill : code === "WEX" ? 700 : 300;
        H.window(id, host, w / 2, wtypeW(code, w, h), sill, { mark: t ? t.mark : `EX.${nWin}` }); if (t) { used.add(t); placedTags.push({ pg, el: id, t }); } }
    }
  };
  const placedTags = [];
  let nW = 0, nC = 0, nF = 0, nFin = 0;
  // a finish's pattern, material and floor type: boards one way at their step, or a grid of tiles or pavers
  const FIN_NAME = { "#d4d4d4": "Timber floor", "#d2d2d2": "Floor tiles", "#787878": "Pavers", "#7f7f7f": "Decking", "#e4e4e4": "Tiles", "#cccccc": "Carpet" };
  const finType = r => { const nm = FIN_NAME[r.pen] || "Floor finish", key = `${r.kind}-${r.step}-${r.phase}${r.step2 ? `x${r.step2}-${r.phase2}` : ""}-${r.pen.slice(1)}`;
    const pid = `P-WL-${key}`, mid = `M-WL-FIN-${key}`, tid = `T-WL-FIN-${key}`;
    if (!L.patterns[pid]) { const lines = [];
      if (r.kind === "boards-H" || r.kind === "grid") lines.push({ angle: 0, origin: [0, r.phase], delta: [0, r.step] });
      if (r.kind === "boards-V") lines.push({ angle: 90, origin: [r.phase, 0], delta: [0, r.step] });
      if (r.kind === "grid") lines.push({ angle: 90, origin: [r.phase2 || 0, 0], delta: [0, r.step2 || r.step] });
      L.patterns[pid] = { name: `${nm} ${r.step}${r.step2 ? "x" + r.step2 : ""}`, kind: "model", lines }; }
    if (!L.materials[mid]) L.materials[mid] = { name: `${nm} ${r.step}${r.step2 ? "x" + r.step2 : ""}`, mark: nm.split(" ").map(w => w[0]).join(""), description: nm,
      cut: { pattern: null, pen: "thin", lineColour: "#000000", background: "#ffffff" }, projection: { pen: "gossamer", pattern: pid, lineColour: r.pen, edges: false }, shading: { colour: nm === "Timber floor" ? "#b58c5e" : "#d9d6cf" } };
    if (!L.types[tid]) L.types[tid] = { family: "F-FLOOR", name: `${nm} ${r.step}${r.step2 ? "x" + r.step2 : ""}`, mark: "FF", layers: [{ function: "Finish 1", thickness: 20, material: mid }], coreStart: 0, coreEnd: 1 };
    return tid; };
  const FIXFAM = { WC: "F-SANITARY", Basin: "F-SANITARY", Bath: "F-SANITARY", Vanity: "F-CASEWORK", Bench: "F-CASEWORK", Island: "F-CASEWORK", Appliance: "F-FIXTURE", Joinery: "F-CASEWORK" };
  const FIXMAT = { WC: "M-WL-CERAMIC", Basin: "M-WL-CERAMIC", Bath: "M-WL-CERAMIC" };
  const fixType = key => { const t = ((D.fix || {}).types || {})[key]; if (!t) return null; const id = `T-WL-FX-${key}`;
    if (!L.types[id]) L.types[id] = { family: FIXFAM[t.kind] || "F-FIXTURE", name: `${t.kind} ${key.slice(0, 5)}`, mark: t.kind.slice(0, 3).toUpperCase(), lines: t.lines, body: t.body, height: t.height, base: 0, material: FIXMAT[t.kind] || "M-WL-JOINERY" };
    return id; };
  for (const [pg, P] of Object.entries(PLANS)) {
    if (!P.walls) continue; const Lf = D.lift[pg]; if (!Lf) continue;
    const bld = P.o === LOFT || +pg === 14 ? "LOFTS" : "APARTMENTS";
    const top = P.top ? { top: P.top } : { height: 1200 }, bb = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = q => { bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]); };
    const mine = [];
    const wall = (a, b, cls, t) => { if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 40 || overlaps(P.lev, a, b, t)) return; placed.push([P.lev, a, b, t]); grow(a); grow(b);
      const id = `W-${pg}-${++nW}`; mine.push({ id, a, b, cls, t });
      add({ id, type: "Wall", name: `${cls === "P" ? "Partition" : cls === "EX" ? "Existing brick" : "Wall"} ${t}`, args: { centreline: H.line(a, b), mounting: "Centred", wallType: { ref: wtype(cls, t) },
        baseLevel: { ref: P.lev }, baseOffset: 0, topLevel: P.top ? { ref: P.top } : null, topOffset: 0, height: top.height || 3000, flipped: false }, params: { Building: bld } }); };
    // the existing brick first: where a pair of lines also runs along it (a sill, a frame), the solid poche is the wall
    for (const r of Lf.brick) { const w = r[2] - r[0], h = r[3] - r[1];
      if (w >= h) wall([r5(r[0]), r5((r[1] + r[3]) / 2)], [r5(r[2]), r5((r[1] + r[3]) / 2)], "EX", r5(h)); else wall([r5((r[0] + r[2]) / 2), r5(r[1])], [r5((r[0] + r[2]) / 2), r5(r[3])], "EX", r5(w)); }
    for (const w of Lf.walls) wall(w.a.map(r5), w.b.map(r5), w.cls, Math.max(10, r5(w.t)));
    for (const r of Lf.cols) { const c = [r5((r[0] + r[2]) / 2), r5((r[1] + r[3]) / 2)]; grow(c);
      if (placed.some(w => w[0] === P.lev && w[3] === -1 && Math.hypot(w[1][0] - c[0], w[1][1] - c[1]) < 50)) continue; placed.push([P.lev, c, c, -1]);
      add({ id: `C-${pg}-${++nC}`, type: "Column", name: "Existing column", args: { position: c, columnType: { ref: ctype(r5(r[2] - r[0]), r5(r[3] - r[1])) }, baseLevel: { ref: P.lev },
        height: P.top ? Z[P.top] - Z[P.lev] : 1200, rotation: 0, baseOffset: 0 }, params: { Building: bld } }); }
    openings(pg, P, bld, mine, top);
    // the floor finishes: each hatched region of the plan a finish floor on the slab, its material's surface pattern
    // the set's boards, tiles or pavers, set out on the set's lines (tools/finishes.py)
    for (const r of ((D.fin || {})[pg] || [])) { const ty = finType(r); if (!ty) continue; const id = `FN-${pg}-${++nFin}`;
      if (r.holes && r.holes.length) H.floorHoles(id, L.types[ty].name, r.ring, r.holes, ty, P.lev, 0); else H.floor(id, L.types[ty].name, r.ring, ty, P.lev, 0);
      set(id, "params", { Building: bld }); }
    // the fixtures and joinery: instances of the family types the plans' symbols make (tools/fixtures.py)
    for (const fx of ((D.fix || {}).pages || {})[pg] || []) { const ty = fixType(fx.type); if (!ty) continue;
      add({ id: `FX-${pg}-${++nF}`, type: "Fixture", name: L.types[ty].name, args: { position: fx.at, rotation: fx.rot, mirror: false, fixtureType: { ref: ty }, level: { ref: P.lev }, baseOffset: 0 }, params: { Building: bld } }); }
    if (Number.isFinite(bb[0])) add({ id: `FL-${P.lev}-${pg}`, type: "Floor", name: `Slab ${P.lev} (${bld.toLowerCase()})`, args: { boundary: H.R(r5(bb[0]), r5(bb[1]), r5(bb[2]), r5(bb[3])), floorType: { ref: "T-WL-SLAB" }, level: { ref: P.lev }, heightOffset: 0 }, params: { Building: bld } });
  }

  // ---------------------------------------------------------------- the existing north façade's two gables
  // The warehouse's brick end wall rises in two gables over Level 3 (the new Level 4 set back behind them):
  // the Level 3 walls on that face take the gables as their top profile (Revit's Edit Profile). Heights above
  // Level 3, read off the north elevation: eaves at the ends, two ridges, the valley between.
  const GABLE = [[24045, 530], [18035, 3650], [11685, 185], [5445, 3650], [-445, 530]];
  const gableAt = y => { for (let i = 1; i < GABLE.length; i++) { const [y0, z0] = GABLE[i - 1], [y1, z1] = GABLE[i]; if (y <= y0 && y >= y1) return z0 + (z1 - z0) * (y0 - y) / (y0 - y1); } return 530; };
  for (const f of doc.elements()) { if (doc.typeOf(f) !== "Wall" || (doc.argValue(f, "baseLevel") || {}).ref !== "L-A3") continue;
    const c = doc.argValue(f, "centreline"); if (Math.abs(c.start[0] - c.end[0]) > 50 || Math.abs(c.start[0]) > 900) continue;
    const L0 = Math.abs(c.end[1] - c.start[1]), sgn = Math.sign(c.end[1] - c.start[1]), pts = [[0, gableAt(c.start[1])]];
    for (const [y] of GABLE) { const u = (y - c.start[1]) * sgn; if (u > 0 && u < L0) pts.push([u, gableAt(y)]); }
    pts.push([L0, gableAt(c.end[1])]); pts.sort((a, b) => a[0] - b[0]);
    set(doc.idOf(f), "topProfile", pts.map(([u, z]) => [Math.round(u), Math.round(z)])); }
  // the ground: the site's earth under its ground level, as the elevations cut and show it
  if (D.site) add({ id: "GM-GROUND", type: "Generic", name: "Ground", args: { boundary: D.site, level: { ref: "L-AG" }, baseOffset: -1600, height: 900, ifcClass: "IfcGeographicElement", material: "M-WL-GROUND", category: "Topography" } });

  // ---------------------------------------------------------------- the site: its boundary as the grid setout draws it
  if (D.site && D.site.length > 2) { const sk = emptySketch(); D.site.forEach((p, i) => sk.elements.push({ id: "e" + (i + 1), type: "line", a: p, b: D.site[(i + 1) % D.site.length] }));
    add({ id: "SITE-1", type: "SiteBoundary", name: "Site boundary", args: { sketch: weld(sk), edges: {}, setback: 0, level: { ref: "L-AG" }, showPlanes: false, planeHeight: 60000, label: false } }); }
  for (const st of Object.values(L.viewStyles)) if (/^VS-WL/.test(st.name || "") || true) { st.byCategory = Object.assign({}, st.byCategory, { Site: Object.assign({ visible: true }, (st.byCategory || {}).Site, { colour: "#ff0000", pen: "extra", dash: [12, 2, 1.5, 2, 1.5, 2] }) }); }

  // ---------------------------------------------------------------- views and sheets
  const S0 = pg => S.sheets[pg];
  // sheets carry views of the model and annotation only: nothing traced, no pictures of the set
  const sheet = (pg, vps) => H.pdfSheet(+pg, vps, { size: "A1", orientation: "landscape" });
  const skipLevels = new Set(LEVELS.map(l => l[2]));
  const annotate = (pg, extra = {}) => H.annotate(+pg, Object.assign({ dimType: "DT-WL",
    // the level heads and the door and window tags are the model's own
    skip: n => skipLevels.has(n.t.trim().toUpperCase()) || /^[A-Z]\.[A-Z0-9]+\.\d+\n[A-Z]{2,3}\.?\d*$/.test(n.t),
    skipDim: dm => /^\d{5}$/.test(dm.t) && LEVELS.some(l => String(l[1]) === dm.t) }, extra));

  const T = globalThis.__WL_TRACE ? (m => console.log(`${((Date.now() - globalThis.__WL_T0) / 1000).toFixed(1)}s ${m}`)) : () => {};
  globalThis.__WL_T0 = Date.now(); T(`model: ${nW} walls, ${nC} columns, ${nD} doors, ${nWin} windows`);
  // ---------------------------------------------------------------- the elevations: views of the model
  // Each view's direction from its grids' order on the sheet (letters or numbers, rising or falling left to right),
  // placed so a grid and an RL land where the set draws them; its crop the drawing's area; its levels the
  // building's own, their heads where the set has them; its grid heads at the set's height.
  L.viewStyles["VS-WL-ELEV"] = Object.assign(JSON.parse(JSON.stringify(L.viewStyles["VS-FH-ELEV"])), { name: "Techne - elevations" });
  L.viewStyles["VS-WL-ELEV"].byCategory = Object.assign({}, L.viewStyles["VS-WL-ELEV"].byCategory, { IfcGrid: { colour: "#8c8c8c" }, Site: { visible: false } });
  const elevation = (pg, E) => {
    const { a, b, sRef } = elevLine(E);
    const sOf = px => sRef + (px - E.ref[1]) * 100, zOf = py => E.z0[0] + (py - E.z0[1]) * 100;
    const crop = [Math.round(sOf(E.rect[0])), Math.round(zOf(E.rect[1])), Math.round(sOf(E.rect[2])), Math.round(zOf(E.rect[3]))];
    add({ id: E.id, type: "ElevationView", name: E.name, args: { line: H.line(a, b), depth: 160000, scale: 100, baseLevel: { ref: E.bld === "L" ? "L-LG" : "L-AG" }, top: 30000, style: { ref: "VS-WL-ELEV" },
      detailLevel: "Medium", clip: { rect: crop, visible: false, active: true, annotation: [0, 0, 0, 0] }, groundLine: false,
      levelExtent: [Math.min(sOf(E.head), sOf(E.head > (E.rect[0] + E.rect[2]) / 2 ? E.rect[0] : E.rect[2])), Math.max(sOf(E.head), sOf(E.head > (E.rect[0] + E.rect[2]) / 2 ? E.rect[0] : E.rect[2]))],
      overrides: Object.assign({ __levelHead: E.head > (E.rect[0] + E.rect[2]) / 2 ? "Right" : "Left", __gridTop: zOf(E.gridHead) - 4.5 * 100, __gridBottom: crop[1] },
        // the other building's levels are not this view's
        Object.fromEntries(LEVELS.filter(l => l[0] !== "L-B" && (E.bld === "L" ? !/LOFTS/.test(l[2]) : /LOFTS/.test(l[2]))).map(l => [l[0], { visible: false }]))) } });
    return [E.id, [(E.rect[0] + E.rect[2]) / 2, (E.rect[1] + E.rect[3]) / 2], { noTitle: true }]; };

  for (let pg = 1; pg <= 38; pg++) {
    const P = PLANS[pg], sh = S0(pg); T(`page ${pg}`);
    if (ELEVS[pg]) { sheet(pg, ELEVS[pg].map(E => elevation(pg, E))); annotate(pg); continue; }
    if (P) {
      const sc = P.scale || 100, O = P.o, M = q => [Math.round((q[0] - O[0]) * sc), Math.round((q[1] - O[1]) * sc)];
      const c0 = M([DRAWING[0], DRAWING[1]]), c1 = M([DRAWING[2], DRAWING[3]]), crop = [c0[0], c0[1], c1[0], c1[1]], vid = `V-${sh.number}`;
      add({ id: vid, type: "PlanView", name: sh.name, args: { level: { ref: P.lev }, scale: sc, viewRange: { top: 2300, cut: 1200, bottom: 0 }, detailLevel: "Fine", style: { ref: P.style || (P.o === LOFT || [14, 31].includes(pg) ? "VS-WL-PLAN-LOFT" : "VS-WL-PLAN-APT") },
        clip: { rect: crop, visible: false, active: true, annotation: [0, 0, 0, 0] } } });
      // the grids as this sheet draws them: where each line starts and ends (its head at the end), the rest hidden
      const ov = {}, Lf = D.lift[pg] || { gridext: [] }, pageBubbles = S.pages[pg].bubbles.filter(b => gridIds[b.t.trim()]);
      for (const [n, gid] of Object.entries(gridIds)) {
        const b = pageBubbles.find(x => x.t.trim() === n); if (!b) { ov[gid] = { visible: false }; continue; }
        const [cx, cy, r] = b.circle, num = /^\d+$/.test(n);
        // the line as drawn (its extent on the page), its head at the end the bubble is on
        const e = Lf.gridext.find(g => g[0] === (num ? "x" : "y") && Math.abs(g[1] - (num ? cx : cy)) < 0.3);
        if (num) { const x = M([cx, 0])[0], lo = e ? e[2] : DRAWING[1], hi = e ? e[3] : DRAWING[3], top = cy > (lo + hi) / 2;
          const head = M([0, top ? cy - r : cy + r])[1], far = M([0, top ? lo : hi])[1];
          ov[gid] = { gridLine: { type: "line", start: [x, far], end: [x, head] } }; }
        else { const y = M([0, cy])[1], lo = e ? e[2] : DRAWING[0], hi = e ? e[3] : DRAWING[2], right = cx > (lo + hi) / 2;
          const head = M([right ? cx - r : cx + r, 0])[0], far = M([right ? lo : hi, 0])[0];
          ov[gid] = { gridLine: { type: "line", start: [far, y], end: [head, y] } }; }
      }
      set(vid, "overrides", ov);
      // the door and window tags: the elements' own, where the set puts them (only the elements this page modelled)
      for (const pt of placedTags.filter(x => +x.pg === pg || (PLANS[x.pg] && PLANS[x.pg].lev === P.lev && PLANS[x.pg].o === P.o && pg !== +x.pg && false)))
        add({ id: `TG-${sh.number}-${++nTag}`, type: "MaterialTag", name: `Tag ${pt.t.mark}`, args: { target: M(pt.t.paper), position: M(pt.t.paper), show: "Element Mark / Type Mark", frame: "Split circle", leader: false, textSize: 1.62, element: { ref: pt.el }, view: { ref: vid } } });
      sheet(pg, [[vid, [(DRAWING[0] + DRAWING[2]) / 2, (DRAWING[1] + DRAWING[3]) / 2], { noTitle: true }]]);
      annotate(pg);
    } else {
      // a sheet of drafting (the site and location plans, the notes, the demolition, the elevations): the set's
      // drawing on the sheet as it is, its words as annotation
      const vid = `V-D-${sh.number}`;
      add({ id: vid, type: "DraftingView", name: sh.name, args: { scale: 1, clip: { rect: [0, 0, 841, 594], visible: false, active: true } } });
      sheet(pg, [[vid, [420.5, 297], { noTitle: true }]]);
      annotate(pg, { keepAll: true, skip: () => false, skipBubble: () => false });
      // the RLs over their level lines (read as dimension strings): words, where the set writes them
      S.pages[pg].dims.filter(dm => /^\d{5}$/.test(dm.t)).forEach((dm, i) => add({ id: `TX-${sh.number}-RL${i + 1}`, type: "Text",
        args: { content: dm.t, position: dm.at, rotation: dm.rot || 0, textType: { ref: "TT-WL-18" }, wrapWidth: 1000, leaders: [], view: { ref: vid } } }));
    }
  }
  // the set's lettering is Swiss 721 Condensed: every Arial the notes made is set at its measured width (0.81)
  for (const t of Object.values(L.textTypes)) if (t.font === "Arial") t.widthFactor = 0.81;
  // the elevations' levels and grids are drawn on their images; a 3D view of the whole
  H.view3d("V-3D", "3D - WETLAP", { azimuth: 215, elevation: 28, target: [40000, 12000, 6000] }, 200);
  doc.regenerate();
  return doc;
}
