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
const DRAWING = [4, 50, 837, 590];      // where a sheet's drawing is (above the title strip), sheet mm

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
  mat("M-WL-EXBR", "Existing brick / structure", "EX-BR", { pattern: null, pen: "thin", lineColour: "#000000", background: "#000000" }, "#9c5c46");
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
  style("VS-WL-PLAN", "Techne - plans", ["IfcSlab", "IfcSpace", "Furniture", "Planting", "Topography", "IfcBeam"]);
  // each building's plans show that building only (the other is hatched and named in the drafting, as the set has it)
  for (const [id, name, other] of [["VS-WL-PLAN-APT", "Techne - plans, apartments", "LOFTS"], ["VS-WL-PLAN-LOFT", "Techne - plans, lofts", "APARTMENTS"]]) {
    L.viewStyles[id] = Object.assign(JSON.parse(JSON.stringify(L.viewStyles["VS-WL-PLAN"])), { name });
    L.viewStyles[id].rules = [{ id: `R-HIDE-${other}`, name: `The ${other.toLowerCase()} hidden`, when: { param: "Building", is: other }, then: { visible: false } }]; }
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
    const off = Math.abs(-(w[1][0] - a[0]) * u[1] + (w[1][1] - a[1]) * u[0]); if (off > (t + w[3]) / 2 - 5) return false;
    const s0 = (w[1][0] - a[0]) * u[0] + (w[1][1] - a[1]) * u[1], s1 = (w[2][0] - a[0]) * u[0] + (w[2][1] - a[1]) * u[1];
    return Math.min(L0, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1)) > 0.5 * Math.min(L0, L1); });
  const r5 = v => Math.round(v / 5) * 5;
  let nW = 0, nC = 0;
  for (const [pg, P] of Object.entries(PLANS)) {
    if (!P.walls) continue; const Lf = D.lift[pg]; if (!Lf) continue;
    const bld = P.o === LOFT || +pg === 14 ? "LOFTS" : "APARTMENTS";
    const top = P.top ? { top: P.top } : { height: 1200 }, bb = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = q => { bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]); };
    const wall = (a, b, cls, t) => { if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 40 || overlaps(P.lev, a, b, t)) return; placed.push([P.lev, a, b, t]); grow(a); grow(b);
      const id = `W-${pg}-${++nW}`;
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
    if (Number.isFinite(bb[0])) add({ id: `FL-${P.lev}-${pg}`, type: "Floor", name: `Slab ${P.lev} (${bld.toLowerCase()})`, args: { boundary: H.R(r5(bb[0]), r5(bb[1]), r5(bb[2]), r5(bb[3])), floorType: { ref: "T-WL-SLAB" }, level: { ref: P.lev }, heightOffset: 0 }, params: { Building: bld } });
  }

  // ---------------------------------------------------------------- views and sheets
  const dec = v => { const o = v.slice(0, 2); for (let i = 2; i < v.length; i++) o.push(o[i - 2] + v[i]); return o.map(x => x / 100); };
  const drafted = (pg, vid) => { const Lf = D.lift[pg]; if (!Lf) return; const S = doc.argValue(doc.element(vid), "scale"), o0 = H.paperToView(+pg, vid, [0, 0]), elements = [];
    for (const [key, r] of Object.entries(Lf.res)) { const [ws, c] = key.split("|"), w = +ws;
      if (r.l.length) elements.push({ type: "path", layer: "DRAFTED", w, c, p: r.l.map(dec) });
      if (r.c.length) elements.push({ type: "path", layer: "DRAFTED", w, c, s: r.c.map(q => ["C", ...dec(q)]) }); }
    const fills = Lf.fills.map(([v, c]) => { const q = dec(v), pts = []; for (let i = 0; i < q.length; i += 2) pts.push([q[i], q[i + 1]]); return { layer: "DRAFTED", pts, colour: c }; });
    add({ id: `CAD-${vid.slice(2)}`, type: "CADImport", name: "Drafted (from the set)", args: { file: `${S0(pg).number} (drafted)`, drawing: { elements, constraints: [], texts: [], fills, layers: [{ name: "DRAFTED", on: true, colour: "#000000" }] },
      view: { ref: vid }, offsetX: o0[0], offsetY: o0[1], scale: S, rotation: 0, pinned: true } }); };
  const S0 = pg => S.sheets[pg];
  const images = pg => { const m = D.raster.meta[pg], url = D.raster.urls[pg]; return m && url ? [{ rect: m.rect, url, w: m.w, h: m.h, blend: "multiply" }] : []; };
  const sheet = (pg, vps) => { const id = H.pdfSheet(+pg, vps, { size: "A1", orientation: "landscape" }); const im = images(pg); if (im.length) set(`SH-${S0(pg).number}`, "images", im); return id; };
  const skipLevels = new Set(LEVELS.map(l => l[2]));
  const annotate = (pg, extra = {}) => H.annotate(+pg, Object.assign({ dimType: "DT-WL",
    skip: n => skipLevels.has(n.t.trim().toUpperCase()),
    skipDim: dm => /^\d{5}$/.test(dm.t) && LEVELS.some(l => String(l[1]) === dm.t) }, extra));

  const T = globalThis.__WL_TRACE ? (m => console.log(`${((Date.now() - globalThis.__WL_T0) / 1000).toFixed(1)}s ${m}`)) : () => {};
  globalThis.__WL_T0 = Date.now(); T(`model: ${nW} walls, ${nC} columns`);
  for (let pg = 1; pg <= 38; pg++) {
    const P = PLANS[pg], sh = S0(pg); T(`page ${pg}`);
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
      sheet(pg, [[vid, [(DRAWING[0] + DRAWING[2]) / 2, (DRAWING[1] + DRAWING[3]) / 2], { noTitle: true }]]);
      drafted(pg, vid); annotate(pg);
    } else {
      // a sheet of drafting (the site and location plans, the notes, the demolition, the elevations): the set's
      // drawing on the sheet as it is, its words as annotation
      const vid = `V-D-${sh.number}`;
      add({ id: vid, type: "DraftingView", name: sh.name, args: { scale: 1, clip: { rect: [0, 0, 841, 594], visible: false, active: true } } });
      sheet(pg, [[vid, [420.5, 297], { noTitle: true }]]);
      drafted(pg, vid);
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
