//! Casa Mazatlan: a sample built from a real drawing set - the INAH submission for a house on the corner
//! of Melchor Ocampo and Guillermo Nelson in Mazatlan's historic centre (Alexander Peña de León, rev. 3,
//! 26/04/2023) - and the photographs of it built. An existing single-storey corner house of 400 mm masonry
//! with a moulded cornice keeps its two street facades (restored doors and windows, pale pink lime
//! render); inside, a new concrete frame and slab make a terracotta courtyard house: a central patio open
//! to the sky with green steel glazed doors round it, a studio on the upper floor, a roof terrace behind a
//! brick screen, and the car in the open patio on the north-west.
//!
//! Every wall, column and opening is where the set draws it (read off its vectors, to the millimetre).
//! Coordinates in mm: x east from grid A (the Guillermo Nelson facade), y north from grid 5 (the Melchor
//! Ocampo facade). Grids A-D: 0, 4475, 9600, 13450; grids 5-1: 0, 3700, 5050, 10150, 14570. Heights
//! from the drawing's bench mark (0): sidewalk -1300 (Melchor Ocampo) to -900 (the corner), Planta Baja 2
//! -693, Planta Baja 1 -170, Planta Alta 2330, Techo 4730. What the set draws in 2D and never models - the
//! furniture, the car and the plants in plan, the hand-drawn survey of the existing house, the site map -
//! is imported into the views as drawings (Revit's Import CAD), and the general notes are text in a
//! drafting view. Every sheet of the set (A001-A904, 17 sheets, A3) is here, in its title band.

import { newDocument, elementRefs } from "./bim.js";
import { dimensionGeometry, viewLineGeometry } from "./scene.js";
import { Editor } from "./ops.js";
import { clone } from "./ocaf.js";
import { VS_CONSTRUCTION } from "./library.js";
import { mazatlanPdf, MZ_IMAGES } from "./mazatlan_pdf.js";

const GREEN = "#2f8a6c";          // the steel of the doors and windows
const MZ_RED = "#ff0000", MZ_PINK = "#ffabab", MZ_FACADE = "#808080", MZ_ORANGE = "#c14f00";

export function buildMazatlanSample() {
  const doc = newDocument("Casa Mazatlan");
  doc.meta.project = { number: "001", address: "Melchor Ocampo\nEsquina Guillermo Nelson\nMazatlan", client: "Torres Hernandez", author: "Alexander Peña de Leon",
    drafted: "Author", checked: "Checker", issued: "26/04/2023", notes: "No tomar cotas del dibujo.\nContratista comprobar\ndimensiones en obra.", revisions: "Reviciones para esta entrega señaladas con nube" };
  // the set is drawn in Revit: its annotation as Revit draws it (grid bubbles, level heads on the left,
  // section flags), in Arial
  doc.meta.annotation = { kind: "revit", font: "Arial", gridHead: 9, gridText: 5.08, gridEnd: 4, gridCentreColour: MZ_ORANGE,
    markerRadius: 4, markerText: 2.04, markerSheetText: 2.04, levelText: 2.04, levelValueText: 2.04, levelHeads: "Left" };
  const ed = new Editor(doc);
  const add = (element) => { const r = ed.apply({ op: "add", element }, { regenerate: false }); if (!r.ok) throw new Error(`${element.id || element.type}: ${r.error}`); return r.id; };
  const line = (a, b) => ({ type: "line", start: a, end: b });
  const L = doc.lib;

  // ---------------------------------------------------------------- pens, text and materials of this set
  // the set's pens, as its PDF has them: 0.085 (annotation), 0.17 (projection), 0.21, 0.34, 0.38 (cut), 0.47
  L.pens["PEN-ISO"] = { name: "Casa Mazatlan (Revit)", pens: {
    gossamer: { weight: 0.085 }, hairline: { weight: 0.17 }, thin: { weight: 0.17 }, light: { weight: 0.21 },
    medium: { weight: 0.34 }, heavy: { weight: 0.38 }, bold: { weight: 0.47 }, extra: { weight: 0.7 }, primary: { weight: 1.0 } }, perScale: {} };
  Object.assign(L.textTypes, {
    "TT-MZ-10": { name: "Arial 1.0 (rooms, notes)", height: 1.0, font: "Arial", widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
    "TT-MZ-13": { name: "Arial 1.3 (sheet notes)", height: 1.28, font: "Arial", widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: 1.66 },
    "TT-MZ-17": { name: "Arial 1.67 (legend)", height: 1.67, font: "Arial", widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
    "TT-MZ-20": { name: "Arial 2.0", height: 2.01, font: "Arial", widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
    "TT-MZ-12": { name: "Arial 1.2 (stair numbers)", height: 1.19, font: "Arial", widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
    "TT-MZ-20N": { name: "Arial Narrow 2.0", height: 2.06, font: "Arial", widthFactor: 0.82, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
    "TT-MZ-30B": { name: "Arial Bold 3.0 (streets)", height: 3.03, font: "ArialBold", widthFactor: 1, colour: "#000000", pen: "thin", lineSpacing: 1.6 },
  });
  // the set's dimension type (Revit's, as its PDF measures it): 2.0 Arial over the line, oblique ticks, fixed witness lines
  L.dimTypes["DT-MZ"] = { name: "Revit - diagonal 3 mm, Arial 2.0", arrow1: "Oblique", arrow2: "Oblique", arrowSize: 2.0, tickWeight: 0.21, lineWeight: 0.085, extWeight: 0.085,
    dimExtend: 1.5, extFixed: 2.5, extBeyond: 1.5, font: "Arial", textHeight: 2.01, textGap: 1.35, unit: "mm", precision: 0, roundOff: 5, textSide: "Readable", fit: "Keep inside" };
  doc.meta.defaultDimType = "DT-MZ";
  L.patterns["P-HERRING"] = { name: "Herringbone (clay tile 250×125)", kind: "model", lines: [
    { angle: 45, origin: [0, 0], delta: [176.78, 176.78], dashes: [353.55, -176.78] },
    { angle: 135, origin: [176.78, 0], delta: [-176.78, 176.78], dashes: [353.55, -176.78] }] };
  L.patterns["P-MZ-DIAG"] = { name: "Diagonal 45 (1.3 mm)", kind: "drafting", lines: [{ angle: 45, origin: [0, 0], delta: [0, 1.3] }] };
  L.patterns["P-MZ-GREEN"] = { name: "Diagonal 45 (Losa Alex)", kind: "drafting", lines: [{ angle: 45, origin: [0, 0.22], delta: [0, 1.5] }] };
  L.patterns["P-MZ-GREEN-S"] = { name: "Diagonal 45 (sections)", kind: "drafting", lines: [{ angle: 45, origin: [0, 0], delta: [0, 2.9] }] };
  L.patterns["P-MZ-GREEN2"] = { name: "Diagonal 45 (Losa Alex, kitchen)", kind: "drafting", lines: [{ angle: 45, origin: [0, 1.757], delta: [0, 1.5] }] };
  L.patterns["P-MZ-STIPPLE"] = { name: "Render stipple (Revit's sand)", kind: "drafting", lines: [
    { angle: 17, origin: [0, 0], delta: [1.13, 1.47], dashes: [0.12, -2.6] }, { angle: 71, origin: [0.4, 0.2], delta: [1.71, 1.34], dashes: [0.12, -3.1] },
    { angle: 131, origin: [0.9, 0.6], delta: [2.03, 1.61], dashes: [0.12, -3.7] }] };
  L.patterns["P-MZ-TILE"] = { name: "Square tile 600", kind: "model", lines: [{ angle: 0, origin: [0, 0], delta: [0, 600] }, { angle: 90, origin: [0, 0], delta: [0, 600] }] };
  Object.assign(L.materials, {
    "M-MZ-ROSA": { name: "Aplanado de cal, rosa", mark: "AP-01", description: "Lime render, pale pink (the street facades)", cut: { pattern: null, pen: "heavy", lineColour: "#000000", background: MZ_FACADE }, projection: { pen: "thin", pattern: "P-MZ-STIPPLE", background: "#fff3ee", patternColour: "#a6a6a6" }, shading: { colour: "#f1d5ca" } },
    "M-MZ-TERRA": { name: "Aplanado de cal, terracota", mark: "AP-02", description: "Lime render pigmented terracotta (the courtyard)", cut: { pattern: null, pen: "heavy", lineColour: "#000000", background: "#ffffff" }, projection: { pen: "thin" }, shading: { colour: "#d98468" } },
    "M-MZ-LADRILLO": { name: "Mampostería existente", mark: "MA-01", description: "Existing brick and stone masonry", cut: { pattern: "P-MZ-DIAG", pen: "heavy", lineColour: "#000000", background: "#ffffff" }, projection: { pen: "thin" }, shading: { colour: "#f2e6e1" } },
    "M-MZ-BLOCK": { name: "Block de concreto", mark: "MA-02", description: "New concrete block, rendered", cut: { pattern: null, pen: "heavy", lineColour: "#000000", background: "#ffffff" }, projection: { pen: "thin" }, shading: { colour: "#f3efeb" } },
    "M-MZ-CONC": { name: "Concreto armado", mark: "CO-01", description: "Reinforced concrete (the new frame)", cut: { pattern: null, pen: "heavy", lineColour: "#000000", background: MZ_RED }, projection: { pen: "thin" }, shading: { colour: "#f3efeb" } },
    "M-MZ-BARRO": { name: "Piso de barro en espiga", mark: "PI-01", description: "Handmade clay tile, herringbone", cut: { pattern: null, pen: "thin", lineColour: "#000000", background: "#ffffff" }, projection: { pen: "hairline", pattern: "P-HERRING", lineColour: "#d1d1d1" }, shading: { colour: "#b8613f" } },
    "M-MZ-GRAVA": { name: "Grava", mark: "PI-02", description: "Crushed stone, loose", cut: { pattern: null, pen: "thin", lineColour: "#000000", background: "#ffffff" }, projection: { pen: "hairline" }, shading: { colour: "#8f8984" } },
    "M-MZ-DECK": { name: "Duela de madera", mark: "PI-03", description: "Timber deck (the roof terrace)", cut: { pattern: null, pen: "thin", lineColour: "#000000", background: "#ffffff" }, projection: { pen: "hairline" }, shading: { colour: "#b58a5e" } },
    "M-MZ-ACERO": { name: "Acero pintado verde", mark: "AC-01", description: "Steel sections, painted green", cut: { pattern: null, pen: "medium", lineColour: "#000000", background: GREEN }, projection: { pen: "thin" }, shading: { colour: GREEN } },
    "M-MZ-CELOSIA": { name: "Celosía de ladrillo", mark: "CE-01", description: "Brick screen: flat courses and bricks stood on end", cut: { pattern: null, pen: "thin", lineColour: "#000000", background: "#e5a488" }, projection: { pen: "thin" }, shading: { colour: "#b5613d" } },
    "M-MZ-CORNISA": { name: "Cornisa de cal", mark: "AP-04", description: "Moulded lime cornice", cut: { pattern: null, pen: "heavy", lineColour: "#000000", background: "#ffffff" }, projection: { pen: "thin", background: "#ffffff" }, shading: { colour: "#e8e4de" } },
    "M-MZ-CONTRA": { name: "Contraventana de madera", mark: "MD-01", description: "Timber shutters, painted grey", cut: { pattern: null, pen: "medium", lineColour: "#000000", background: "#c0c0c0" }, projection: { pen: "thin", background: "#c0c0c0" }, shading: { colour: "#9a9a9a" } },
    // under the floors, as the sections hatch them: the new footings and the compacted fill in green, the old
    // ground's fill in the render's stipple, the natural ground green below the sidewalk
    "M-MZ-CIMIENTO": { name: "Cimiento de concreto", mark: "CI-01", description: "Strip footing, reinforced concrete", cut: { pattern: "P-MZ-GREEN-S", pen: "heavy", lineColour: "#000000", patternColour: "#00ff00", background: "#ffffff" }, projection: { pen: "thin" }, shading: { colour: "#a9adb2" } },
    "M-MZ-RELLENO": { name: "Relleno compactado", mark: "RE-01", description: "Compacted fill", cut: { pattern: "P-MZ-GREEN-S", pen: "thin", lineColour: "#000000", patternColour: "#00ff00", background: "#ffffff" }, projection: { pen: "thin" }, shading: { colour: "#b59a7a" } },
    "M-MZ-TIERRA": { name: "Relleno existente", mark: "RE-02", description: "Existing fill under the old floors", cut: { pattern: "P-MZ-STIPPLE", pen: "thin", lineColour: "#000000", patternColour: "#a6a6a6", background: "#fff3ee" }, projection: { pen: "thin" }, shading: { colour: "#c9a58a" } },
    "M-MZ-TERRENO": { name: "Terreno natural", mark: "TE-01", description: "Natural ground", cut: { pattern: "P-MZ-GREEN-S", pen: "thin", lineColour: "#000000", patternColour: "#00ff00", background: "#ffffff" }, projection: { pen: "thin" }, shading: { colour: "#8d7b62" } },
    "M-MZ-GRIS": { name: "Moldura gris", mark: "AP-03", description: "Lime render, grey (door and window surrounds, plinth, cornice)", cut: { pattern: null, pen: "heavy", lineColour: "#000000", background: MZ_FACADE }, projection: { pen: "thin", background: "#e3e3e3" }, shading: { colour: "#dddbd7" } },
  });
  // the set cuts its concrete white (the frame is told apart by the plans' red, not by the sections' poché)
  L.materials["M-CONC"] = Object.assign({}, L.materials["M-CONC"], { cut: Object.assign({}, L.materials["M-CONC"].cut, { pattern: null, background: "#ffffff" }) });
  const wt = (name, mark, layers, fn, family = "F-BASICWALL") => ({ family, name, mark, layers, coreStart: layers.length > 1 ? 1 : 0, coreEnd: layers.length > 1 ? layers.length - 1 : 1, params: { Function: fn } });
  const one = (t, m) => [{ function: "Structure", thickness: t, material: m }];
  Object.assign(L.types, {
    // the existing house: the street facades (grey in plan), the party walls, the interior masonry (hatched)
    "T-MZ-FACHADA": wt("Muro existente de fachada 398", "MF1", one(398, "M-MZ-ROSA"), "Exterior"),
    "T-MZ-COLIND280": wt("Muro colindante 280", "MC1", one(280, "M-MZ-ROSA"), "Exterior"),
    "T-MZ-EXIST462": wt("Muro interior existente 462", "MI1", one(462, "M-MZ-LADRILLO"), "Interior"),
    "T-MZ-EXIST398": wt("Muro interior existente 398", "MI2", one(398, "M-MZ-LADRILLO"), "Interior"),
    "T-MZ-EXIST199": wt("Muro interior existente 199", "MI3", one(199, "M-MZ-LADRILLO"), "Interior"),
    // the new work: concrete (red in plan, "Estructura Alex") and block partitions (white)
    "T-MZ-CONC300": wt("Muro de concreto 300", "MN1", one(300, "M-MZ-CONC"), "Interior"),
    "T-MZ-CONC150": wt("Muro de concreto 150", "MN2", one(149, "M-MZ-CONC"), "Interior"),
    "T-MZ-CONC400": wt("Pilar de concreto 398", "MN4", one(398, "M-MZ-CONC"), "Interior"),
    "T-MZ-CONC152": wt("Muro de concreto 152", "MN5", one(152, "M-MZ-CONC"), "Interior"),
    "T-MZ-CONC200": wt("Muro de concreto 200", "MN3", one(199, "M-MZ-CONC"), "Interior"),
    "T-MZ-BLOCK300": wt("Muro de block 300", "MB1", one(301, "M-MZ-BLOCK"), "Interior", "F-PARTITION"),
    "T-MZ-BLOCK200": wt("Muro de block 200", "MB2", one(199, "M-MZ-BLOCK"), "Interior", "F-PARTITION"),
    "T-MZ-BLOCK152": wt("Muro de block 152", "MB5", one(152, "M-MZ-BLOCK"), "Interior", "F-PARTITION"),
    "T-MZ-BLOCK150": wt("Muro de block 150", "MB3", one(149, "M-MZ-BLOCK"), "Interior", "F-PARTITION"),
    "T-MZ-BLOCK100": wt("Muro de block 100", "MB4", one(97, "M-MZ-BLOCK"), "Interior", "F-PARTITION"),
    "T-MZ-CANCEL": wt("Cancelería de acero verde", "CA1", one(50, "M-GLASS"), "Exterior"),
    // green steel: glazed doors with glazing bars, windows with mullions and transoms
    "T-MZ-PV900": { family: "F-SINGLEDOOR", name: "Puerta de acero verde 900×2300", mark: "PA1", width: 920, height: 2300, leafThickness: 40, frame: 40, glazed: true, bars: { cols: 2, rows: 6, width: 40 }, frameColour: GREEN },
    "T-MZ-PV1900": { family: "F-SINGLEDOOR", name: "Puerta doble de acero verde 1900×2300", mark: "PA2", width: 1900, height: 2300, leafThickness: 40, frame: 40, glazed: true, bars: { cols: 2, rows: 6, width: 40 }, frameColour: GREEN },
    "T-MZ-PC": { family: "F-SINGLEDOOR", name: "Puerta corrediza de acero verde", mark: "PC1", width: 2400, height: 2400, leafThickness: 30, frame: 40, glazed: true, bars: { cols: 2, rows: 8, width: 40 }, frameColour: GREEN },
    "T-MZ-P900": { family: "F-SINGLEDOOR", name: "Puerta de madera 900×2100", mark: "PM1", width: 920, height: 2100, leafThickness: 44, frame: 40, panelColour: "#8b5a3c" },
    "T-MZ-P700": { family: "F-SINGLEDOOR", name: "Puerta de madera 700×2100", mark: "PM2", width: 724, height: 2100, leafThickness: 44, frame: 40, panelColour: "#8b5a3c" },
    "T-MZ-PR-S1": { family: "F-SINGLEDOOR", name: "Puerta restaurada de madera 1100×2610", mark: "PR1", width: 1100, height: 2610, leafThickness: 50, frame: 60, panelColour: "#6d4a33", frameColour: "#e3e3e3" },
    "T-MZ-PR-S3": { family: "F-SINGLEDOOR", name: "Puerta restaurada de madera 1101×2451", mark: "PR2", width: 1101, height: 2451, leafThickness: 50, frame: 60, panelColour: "#6d4a33", frameColour: "#e3e3e3" },
    "T-MZ-PR-O1": { family: "F-SINGLEDOOR", name: "Puerta restaurada de madera 1100×2246", mark: "PR3", width: 1100, height: 2246, leafThickness: 50, frame: 60, panelColour: "#6d4a33", frameColour: "#e3e3e3" },
    "T-MZ-VR1100": { family: "F-CASEMENT", name: "Ventana restaurada 1100", mark: "VR1", width: 1101, height: 2119, frame: 60, mullions: 1, transoms: 2, frameColour: "#6d4a33" },
    "T-MZ-VR1200": { family: "F-CASEMENT", name: "Ventana restaurada 1180", mark: "VR2", width: 1182, height: 1899, frame: 60, mullions: 1, transoms: 1, frameColour: "#6d4a33" },
    "T-MZ-VR2200": { family: "F-CASEMENT", name: "Ventana restaurada 2200", mark: "VR3", width: 2201, height: 2001, frame: 60, mullions: 3, transoms: 2, frameColour: "#6d4a33" },
    "T-MZ-V1900": { family: "F-CASEMENT", name: "Ventana de acero verde 1900", mark: "VA1", width: 1909, height: 1500, frame: 40, mullions: 3, transoms: 4, frameColour: GREEN },
    "T-MZ-V1200": { family: "F-CASEMENT", name: "Ventana abatible 1200", mark: "VA2", width: 1211, height: 1539, frame: 60, mullions: 0, transoms: 0, openingMark: "Left", frameColour: GREEN },
    "T-MZ-V1000": { family: "F-CASEMENT", name: "Ventana abatible 1000", mark: "VA3", width: 1003, height: 1539, frame: 60, mullions: 0, transoms: 0, openingMark: "Left", frameColour: GREEN },
    "T-MZ-P1100": { family: "F-SINGLEDOOR", name: "Puerta de madera 1100×2288", mark: "PM3", width: 1101, height: 2288, leafThickness: 44, frame: 40, openingMark: "Right", panelColour: "#8b5a3c" },
    "T-MZ-P1000": { family: "F-SINGLEDOOR", name: "Puerta de madera 1000×2823", mark: "PM4", width: 1004, height: 2823, leafThickness: 44, frame: 40, openingMark: "Right", panelColour: "#8b5a3c" },
    "T-MZ-COL300": { family: "F-RCCOLUMN", name: "Castillo de concreto 300×300", mark: "K1", width: 300, depth: 300, material: "M-MZ-CONC" },
    "T-MZ-BARRO": { family: "F-FLOOR", name: "Barro en espiga 20 + mortero 30 + firme 100", mark: "PB1",
      layers: [{ function: "Finish 1", thickness: 20, material: "M-MZ-BARRO" }, { function: "Finish 2", thickness: 30, material: "M-SCREED" }, { function: "Structure", thickness: 100, material: "M-CONC" }], coreStart: 2, coreEnd: 3 },
    "T-MZ-GRAVA": { family: "F-FLOOR", name: "Grava 80 sobre terreno", mark: "PB2", layers: [{ function: "Finish 1", thickness: 80, material: "M-MZ-GRAVA" }, { function: "Structure", thickness: 70, material: "M-CONC" }], coreStart: 1, coreEnd: 2 },
    "T-MZ-FIRME": { family: "F-FLOOR", name: "Barro 20 + firme de concreto 180", mark: "PB0",
      layers: [{ function: "Finish 1", thickness: 20, material: "M-MZ-BARRO" }, { function: "Structure", thickness: 180, material: "M-CONC" }], coreStart: 1, coreEnd: 2 },
    "T-MZ-LOSA": { family: "F-FLOOR", name: "Losa de concreto 199 + duela 21", mark: "LO1",
      layers: [{ function: "Finish 1", thickness: 21, material: "M-MZ-DECK" }, { function: "Structure", thickness: 199, material: "M-CONC" }], coreStart: 1, coreEnd: 2 },
    "T-MZ-LOSA-T": { family: "F-FLOOR", name: "Losa de azotea 129 + enladrillado 21", mark: "LO2",
      layers: [{ function: "Finish 1", thickness: 21, material: "M-MZ-BARRO" }, { function: "Structure", thickness: 129, material: "M-CONC" }], coreStart: 1, coreEnd: 2 },
    "T-MZ-REL-P": { family: "F-FLOOR", name: "Relleno 535 + relleno existente 394", mark: "RL1", layers: [{ function: "Structure", thickness: 535, material: "M-MZ-RELLENO" }, { function: "Substrate", thickness: 394, material: "M-MZ-TIERRA" }], coreStart: 0, coreEnd: 2 },
    "T-MZ-REL": { family: "F-FLOOR", name: "Relleno existente", mark: "RL2", layers: [{ function: "Structure", thickness: 387, material: "M-MZ-TIERRA" }], coreStart: 0, coreEnd: 1 },
    "T-MZ-REL-C": { family: "F-FLOOR", name: "Relleno existente (patio)", mark: "RL3", layers: [{ function: "Structure", thickness: 407, material: "M-MZ-TIERRA" }], coreStart: 0, coreEnd: 1 },
    "T-MZ-TERRENO": { family: "F-FLOOR", name: "Terreno natural", mark: "TN1", layers: [{ function: "Structure", thickness: 400, material: "M-MZ-TERRENO" }], coreStart: 0, coreEnd: 1 },
    "T-MZ-BANQUETA": { family: "F-FLOOR", name: "Banqueta de concreto 150", mark: "BQ1", layers: [{ function: "Structure", thickness: 150, material: "M-CONC" }], coreStart: 0, coreEnd: 1 },
  });

  // the drawing set's view style: facades grey, existing interior walls hatched pink, the new frame red, the
  // stairs and the fixtures drawn by the imported plan graphics (the stairs are model in section and 3D)
  const vs = L.viewStyles["VS-MZ"] = Object.assign(clone(VS_CONSTRUCTION), { name: "Casa Mazatlan - propuesta", detailLevel: "Medium" });
  vs.byCategory.IfcSpace = { fill: "none", label: { height: 1.0, colour: "#000000", align: "centre", content: "{Label}", font: "Arial", upper: true } };
  vs.byCategory.IfcDoor = { cut: { pen: "hairline" }, swing: { pen: "hairline" }, clearance: { visible: false } };
  vs.byCategory.IfcWindow = { cut: { pen: "hairline" }, projection: { pen: "hairline" } };
  vs.byCategory.IfcColumn = { cut: { pen: "heavy" } };
  vs.byCategory.IfcFurniture = { visible: false };
  vs.rules = [
    { id: "MZ-EXIST-INT", when: { param: "TypeMark", in: ["MI1", "MI2", "MI3"] }, then: { cut: { fill: "#ffffff", pattern: "P-MZ-DIAG" }, cutPattern: { colour: MZ_PINK } } },
    { id: "MZ-MZ_FACADE", when: { param: "TypeMark", in: ["MF1", "MC1"] }, then: { cut: { fill: MZ_FACADE, pattern: "solid" } } },
    { id: "MZ-NEW", when: { any: [{ param: "Category", is: "IfcColumn" }, { param: "TypeMark", in: ["MN1", "MN2", "MN3", "MN4", "MN5"] }] }, then: { cut: { fill: MZ_RED, pattern: "solid" } } },
    { id: "MZ-MOLD", when: { param: "Name", is: "Moldura" }, then: { cut: { fill: MZ_FACADE, pattern: "solid" } } },
  ];
  L.viewStyles["VS-MZ-PLAN"] = Object.assign(clone(vs), { name: "Casa Mazatlan - plantas" });
  L.viewStyles["VS-MZ-PLAN"].byCategory.IfcStair = { visible: false };
  L.viewStyles["VS-MZ-PLAN"].byCategory.IfcBuildingElementProxy = { visible: false };
  // the set's door and window symbols are its own (double-acting doors drawn as ovals, dashed swings, sliding
  // panels, restored street doors shown open): drawn by each plan's imported drawing; the model's doors and
  // windows cut their walls and draw in section, elevation and 3D
  L.viewStyles["VS-MZ-PLAN"].byCategory.IfcDoor = { visible: false };
  L.viewStyles["VS-MZ-PLAN"].byCategory.IfcWindow = { visible: false };
  // elevations: the facades as the set draws them - its openings open (the doors and windows are the plans' and
  // the sections'), no sidewalk slab (the ground is a poché)
  L.viewStyles["VS-MZ-ELEV"] = Object.assign(clone(vs), { name: "Casa Mazatlan - alzados" });
  Object.assign(L.viewStyles["VS-MZ-ELEV"].byCategory, { IfcDoor: { visible: false }, IfcWindow: { visible: false }, IfcSlab: { visible: false }, IfcStair: { visible: false } });
  // sections: only the street facades and the party walls grey in the cut, the rest white (as the set's sections)
  L.viewStyles["VS-MZ-SEC"] = Object.assign(clone(vs), { name: "Casa Mazatlan - secciones" });
  L.viewStyles["VS-MZ-SEC"].rules = [{ id: "MZ-SEC-WHITE", when: { param: "TypeMark", in: ["MI1", "MI2", "MI3", "MN1", "MN2", "MN3", "MN4", "MN5"] }, then: { cut: { fill: "#ffffff", pattern: "none" } } },
    ...vs.rules.filter(r => r.id === "MZ-FACADE" || r.id === "MZ-MOLD")];
  // the last two sections are the set's shaded views: the walls seen in shadow, grey
  L.viewStyles["VS-MZ-SEC-SH"] = Object.assign(clone(L.viewStyles["VS-MZ-SEC"]), { name: "Casa Mazatlan - secciones sombreadas", surfaceShade: "#7d7d7d" });
  // the old ground's fill under the floors, cut, reads dark in the shaded pictures
  L.viewStyles["VS-MZ-SEC-SH"].rules.unshift({ id: "MZ-SEC-TIERRA", when: { param: "TypeMark", in: ["RL1", "RL2", "RL3"] }, then: { cut: { fill: "#595959", pattern: "none" } } });
  // ... but what stands over the roof is in the sun, white, and so is the courtyard (and what is seen through its glass)
  L.viewStyles["VS-MZ-SEC-SH"].rules.unshift({ id: "MZ-SEC-SUN", when: { param: "Name", in: ["Muro 1100 terraza", "Muro estudio sur", "Muro norte del patio central", "Cancel estudio (hueco puertas corredizas)", "Cancel patio oriente", "Cancel patio sur", "Pretil estudio poniente", "Pretil estudio sur", "Pretil escalera sur", "Pretil escalera norte", "Casetón sur", "Casetón oriente", "Casetón norte", "Casetón poniente"] }, then: { surface: "#ffffff" } });
  // the upper plans write their room names larger
  L.viewStyles["VS-MZ-PLAN2"] = Object.assign(clone(L.viewStyles["VS-MZ-PLAN"]), { name: "Casa Mazatlan - plantas altas" });
  L.viewStyles["VS-MZ-PLAN2"].byCategory.IfcSpace = { fill: "none", label: { height: 1.66, colour: "#000000", align: "centre", content: "{Label}", font: "Arial" } };

  // ---------------------------------------------------------------- levels and grids
  const level = (id, name, z) => add({ id, type: "Level", name, args: { name, elevation: z } });
  level("L-T", "TECHO", 4730); level("L-LAF", "LECHO ALTO DE FACHADA", 4350); level("L-LAC", "lecho alto de cornisa", 3650); level("L-LBC", "Lecho bajo cornisa", 3200);
  level("L-PA", "PLANTA ALTA", 2330); level("L-BN", "BANCO DE NIVEL", 0); level("L-PB1", "PLANTA BAJA 1", -170); level("L-H2", "habitacion 2", -520);
  level("L-PB2", "PLANTA BAJA 2", -693); level("L-BE", "banqueta en esquina", -900); level("L-BQ", "BANQUETA MELCHOR OCAMPO", -1300);
  // grid lines as the set draws them: the bubbles north and east
  const GX = [0, 4475, 9600, 13450], GY = [["1", 14570], ["2", 10150], ["3", 5050], ["4", 3700], ["5", 0]];
  GX.forEach((x, i) => add({ id: `G-${"ABCD"[i]}`, type: "Grid", name: `Grid ${"ABCD"[i]}`, args: { name: "ABCD"[i], line: line([x, -1110], [x, 17848]), ends: "End", headSize: 9, textSize: 5.08 } }));
  GY.forEach(([n, y]) => add({ id: `G-${n}`, type: "Grid", name: `Grid ${n}`, args: { name: n, line: line([-1610, y], [16400, y]), ends: "End", headSize: 9, textSize: 5.08 } }));

  // ---------------------------------------------------------------- walls
  const wall = (id, name, a, b, type, base, off, h, phase, extra = {}) => add({ id, type: "Wall", name, args: Object.assign({ centreline: line(a, b), mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: base }, baseOffset: off, height: h, flipped: false }, extra), params: { Phase: phase } });
  const H0 = 2110 + 913, H1 = 4580 - 2330;     // from their footing at -913 to under the slab at +2110; from +2330 to under the roof
  // the existing house: two street facades to +4350 (the south-west corner rounded), the party walls to +4730
  wall("W-S", "Fachada Melchor Ocampo", [13452, 1], [261, 1], "T-MZ-FACHADA", "L-BQ", 0, 5650, "Existing");
  add({ id: "W-SO", type: "Wall", name: "Esquina", args: { centreline: { type: "arc", centre: [261, 259], radius: 259, start: 180, end: 270, ccw: true }, mounting: "Centred", wallType: { ref: "T-MZ-FACHADA" }, baseLevel: { ref: "L-BQ" }, baseOffset: 0, height: 5650, flipped: false }, params: { Phase: "Existing" } });
  wall("W-O", "Fachada Guillermo Nelson", [2, 259], [2, 14432], "T-MZ-FACHADA", "L-BQ", 0, 5650, "Existing");
  wall("W-N", "Colindancia norte", [2, 14432], [13452, 14432], "T-MZ-COLIND280", "L-BQ", 0, 6030, "Existing");
  wall("W-E", "Colindancia oriente", [13452, 14432], [13452, 1], "T-MZ-FACHADA", "L-BQ", 0, 6030, "Existing");
  // existing interior walls, hatched
  wall("W-I1", "Muro habitación 2 / patio abierto", [201, 10150], [4422, 10150], "T-MZ-EXIST462", "L-PB2", -220, H0, "Existing");
  wall("W-I2", "Muro habitación 2 / patio central", [4222, 5250], [4222, 9919], "T-MZ-EXIST398", "L-PB2", -220, H0, "Existing");
  wall("W-I3", "Muro pasillo / habitación 2", [201, 5051], [6082, 5051], "T-MZ-EXIST398", "L-PB2", -220, H0, "Existing");
  wall("W-I7", "Muro habitación doctores / baño", [4271.5, 200], [4271.5, 3502], "T-MZ-EXIST199", "L-PB2", -220, H0, "Existing");
  // the new work: the concrete wall on grid 4, the courtyard's north wall, the stair core; block partitions
  wall("W-N4a", "Muro eje 4 (baño)", [4003, 3652], [6602, 3652], "T-MZ-CONC300", "L-PB2", -220, H0, "New");
  wall("W-N4b", "Muro eje 4 (sala)", [8503, 3652], [13253, 3652], "T-MZ-CONC300", "L-PB2", -220, H0, "New");
  wall("W-N4c", "Jamba pasillo", [2961.5, 3652], [3101, 3652], "T-MZ-BLOCK300", "L-PB2", -220, H0, "New");
  wall("W-P1", "Pilar patio central", [6082, 5051], [6602, 5051], "T-MZ-CONC400", "L-PB2", -220, H0, "New");
  wall("W-C1", "Muro pasillo poniente", [2961.5, 3502], [2961.5, 4852], "T-MZ-BLOCK200", "L-PB2", -220, H0, "New");
  wall("W-C2", "Muro baño / segunda entrada", [6502.5, 200], [6502.5, 3502], "T-MZ-BLOCK200", "L-PB2", -220, H0, "New");
  wall("W-N9", "Muro segunda entrada / habitación huésped", [8653.5, 200], [8653.5, 3502], "T-MZ-BLOCK300", "L-PB2", -220, H0, "New");
  wall("W-K0", "Muro norte del patio central", [4371, 10152], [9352.5, 10152], "T-MZ-CONC152", "L-PB2", -220, H0, "New");
  wall("W-K1", "Muro cocina poniente", [5901.5, 10076], [5901.5, 14292], "T-MZ-CONC200", "L-PB2", -220, H0, "New");
  wall("W-K2", "Muro escalera norte", [5802, 12616], [9352.5, 12616], "T-MZ-CONC150", "L-PB2", -220, H0, "New");
  wall("W-K3", "Muro escalera oriente", [9278, 12541.5], [9278, 11439], "T-MZ-CONC150", "L-PB2", -220, H0, "New");
  wall("W-K4", "Muro descanso", [6971, 11513], [8270, 11513], "T-MZ-CONC150", "L-PB2", -220, H0, "New");
  wall("W-K5", "Muro escalera sur (puerta)", [8270, 11513], [9203, 11513], "T-MZ-CONC150", "L-PB2", -220, H0, "New");
  // the courtyard's glass: sliding doors to the living room (east)
  wall("W-GE", "Cancel patio oriente", [8552, 5250], [8552, 10076], "T-MZ-CANCEL", "L-PB2", -220, H0, "New");
  wall("W-GS", "Cancel patio sur", [6602, 5051], [8577, 5051], "T-MZ-CANCEL", "L-PB2", -220, H0, "New");
  // upper floor: the studio, its bathroom and the stair
  wall("W-U1", "Muro estudio poniente", [5896.5, 10081], [5896.5, 14297], "T-MZ-CONC200", "L-PA", 0, H1, "New");
  // the terrace's wall over the open patio, 1100 high (the set's "Muro 1100mm")
  wall("W-M1", "Muro 1100 terraza", [201, 10148], [5802, 10148], "T-MZ-BLOCK150", "L-PA", 0, 1099, "New");
  wall("W-U2", "Muro estudio sur", [5996, 10159], [9345, 10159], "T-MZ-CONC150", "L-PA", 0, H1, "New");
  wall("W-U3", "Muro baño estudio oriente", [8089.5, 10233], [8089.5, 11444], "T-MZ-BLOCK100", "L-PA", 0, H1, "New");
  wall("W-U4", "Muro baño estudio norte", [5996, 11520], [8206, 11520], "T-MZ-BLOCK150", "L-PA", 0, H1, "New");
  wall("W-U5", "Muro escalera norte (alta)", [5996, 12618.5], [9345, 12618.5], "T-MZ-CONC150", "L-PA", 0, H1, "New");
  wall("W-U6", "Muro escalera oriente (alta)", [9271, 12544], [9271, 11444], "T-MZ-CONC150", "L-PA", 0, H1, "New");
  wall("W-U7", "Cancel estudio (hueco puertas corredizas)", [9345, 10159], [13253, 10159], "T-MZ-CANCEL", "L-PA", 0, H1, "New");
  // the stair's roof hut, 1805 over the roof, from x 6974 (sections 3 and 6); the studio's parapet, 1100 over the
  // roof along its south line from its west wall to grid D, and the stair's open head between the two
  wall("W-H1", "Casetón sur", [7024, 11515], [9276, 11515], "T-MZ-BLOCK152", "L-T", 0, 1805, "New");
  wall("W-H2", "Casetón oriente", [9276, 11515], [9276, 12616], "T-MZ-BLOCK150", "L-T", 0, 1805, "New");
  wall("W-H3", "Casetón norte", [9276, 12616], [7024, 12616], "T-MZ-BLOCK152", "L-T", 0, 1805, "New");
  wall("W-H4", "Casetón poniente", [7024, 12616], [7024, 11515], "T-MZ-BLOCK100", "L-T", 0, 1805, "New");
  wall("W-PR0", "Pretil estudio poniente", [5896.5, 10081], [5896.5, 14297], "T-MZ-CONC200", "L-T", 0, 1100, "New");
  wall("W-PR1", "Pretil estudio sur", [5996, 10159], [13253, 10159], "T-MZ-CONC150", "L-T", 0, 1100, "New");
  wall("W-PR2", "Pretil escalera sur", [5996, 11515], [6974, 11515], "T-MZ-BLOCK152", "L-T", 0, 1100, "New");
  wall("W-PR3", "Pretil escalera norte", [5996, 12616], [6974, 12616], "T-MZ-BLOCK152", "L-T", 0, 1100, "New");
  const before = {}; for (const f of doc.elements()) if (doc.typeOf(f) === "Wall") before[doc.idOf(f)] = JSON.stringify(doc.argValue(f, "centreline"));
  ed.apply({ op: "autojoin", ends: ["W-S", "W-SO", "W-O", "W-N", "W-E", "W-H1", "W-H2", "W-H3", "W-H4"].flatMap(id => [{ id, end: "start" }, { id, end: "end" }]) }, { regenerate: false });
  if (globalThis.MZ_DEBUG) for (const f of doc.elements()) if (doc.typeOf(f) === "Wall" && before[doc.idOf(f)] !== JSON.stringify(doc.argValue(f, "centreline"))) console.log("moved", doc.idOf(f), before[doc.idOf(f)], JSON.stringify(doc.argValue(f, "centreline")));

  // ---------------------------------------------------------------- openings, doors and windows
  const op = (id, host, at, w, sill, h, phase = "Existing") => add({ id, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at, sill, w, h }, farProfile: null, depth: "through" }, params: { Phase: phase } });
  const door = (id, opId, type, mark, extra = {}, phase = "New") => add({ id, type: "Door", args: Object.assign({ fills: { ref: opId }, doorType: { ref: type }, flipHand: false, flipFacing: false, clearance: "None" }, extra), params: { Phase: phase, Mark: mark } });
  const win = (id, opId, type, mark, phase = "New") => add({ id, type: "Window", args: { fills: { ref: opId }, windowType: { ref: type } }, params: { Phase: phase, Mark: mark } });
  // an opening between two positions along its wall (u runs from the wall's start)
  const span = (a, b, a0) => [Math.abs((a + b) / 2 - a0), Math.abs(b - a)];
  const opAt = (id, host, from, a, b, sill, h, phase) => { const [u, w] = span(a, b, from); return op(id, host, u, w, sill, h, phase); };
  // Melchor Ocampo (runs east to west from x = 13452): the street's doors and windows, restored
  opAt("OP-S1", "W-S", 13452, 621, 1721, 508, 2610); door("D-S1", "OP-S1", "T-MZ-PR-S1", "P01", {}, "Existing");
  opAt("OP-S2", "W-S", 13452, 2940, 4041, 999, 2119); win("WN-S2", "OP-S2", "T-MZ-VR1100", "V01", "Existing");
  opAt("OP-S3", "W-S", 13452, 6962, 8063, 618, 2451); door("D-S3", "OP-S3", "T-MZ-PR-S3", "P02", {}, "Existing");
  opAt("OP-S4", "W-S", 13452, 9892, 12093, 1096, 2001); win("WN-S4", "OP-S4", "T-MZ-VR2200", "V02", "Existing");
  // Guillermo Nelson (runs south to north from y = 259)
  opAt("OP-O1", "W-O", 259, 729, 1829, 606, 2246); door("D-O1", "OP-O1", "T-MZ-PR-O1", "P03", { flipFacing: true }, "Existing");
  opAt("OP-O2", "W-O", 259, 7036, 8218, 1378, 1899); win("WN-O2", "OP-O2", "T-MZ-VR1200", "V03", "Existing");
  opAt("OP-O3", "W-O", 259, 10940, 13941, 1299, 2269, "New");                 // widened to 3000: the car comes in here
  // inside (the restored door-window of habitación 2 and its window to the courtyard are niches in the old walls)
  opAt("OP-I3", "W-I3", 201, 3092, 3992, 0, 2100); door("D-I3", "OP-I3", "T-MZ-P900", "P05", { flipFacing: true });
  opAt("OP-I4", "W-I3", 201, 4443, 5341, 0, 2100); door("D-I4", "OP-I4", "T-MZ-P900", "P06");
  opAt("OP-N4a", "W-N4a", 4003, 4443, 5341, 0, 2100, "New"); door("D-N4a", "OP-N4a", "T-MZ-P900", "P07", { flipFacing: true, flipHand: true });
  opAt("OP-N9", "W-N9", 200, 504, 1406, 0, 2100, "New"); door("D-N9", "OP-N9", "T-MZ-P900", "P08", { flipFacing: true });
  opAt("OP-K0", "W-K0", 4371, 6602, 8511, 800, 1500, "New"); win("WN-K0", "OP-K0", "T-MZ-V1900", "V04");
  opAt("OP-K1a", "W-K1", 10076, 10245, 11346, 743, 2288, "New"); door("D-K1a", "OP-K1a", "T-MZ-P1100", "P12");
  opAt("OP-K1b", "W-K1", 10076, 12696, 13700, 200, 2823, "New"); door("D-K1b", "OP-K1b", "T-MZ-P1000", "P13");
  // the courtyard's east side: two sliding doors, a steel post between (the plans' two "puertas corredizas")
  opAt("OP-GE", "W-GE", 5250, 5250, 7635, 0, 2400, "New"); door("D-GE", "OP-GE", "T-MZ-PC", "PC1", { operation: "Sliding" });
  opAt("OP-GE2", "W-GE", 5250, 7735, 10076, 0, 2400, "New"); door("D-GE2", "OP-GE2", "T-MZ-PC", "PC4", { operation: "Sliding" });
  opAt("OP-GS", "W-GS", 6602, 6602, 8503, 0, 2400, "New"); door("D-GS", "OP-GS", "T-MZ-PC", "PC3", { operation: "Sliding" });
  opAt("OP-U1a", "W-U1", 10081, 10233, 11444, 499, 1539, "New"); win("WN-U1a", "OP-U1a", "T-MZ-V1200", "V05");
  opAt("OP-U1b", "W-U1", 10081, 12693, 13696, 499, 1539, "New"); win("WN-U1b", "OP-U1b", "T-MZ-V1000", "V06");
  opAt("OP-U3", "W-U3", 10233, 10271, 10995, 0, 2100, "New"); door("D-U3", "OP-U3", "T-MZ-P700", "P09");
  opAt("OP-U5", "W-U5", 5996, 6047, 6966, 0, 2100, "New"); door("D-U5", "OP-U5", "T-MZ-P900", "P10");
  // the dining room's door into the stair (section 2 draws it; the plan its swing)
  opAt("OP-K5", "W-K5", 8270, 8270, 9203, 220, 2100, "New"); door("D-K5", "OP-K5", "T-MZ-P900", "P12");
  opAt("OP-U7", "W-U7", 9345, 9345, 13248, 0, 2250, "New"); door("D-U7", "OP-U7", "T-MZ-PC", "PC2", { operation: "Sliding" });
  opAt("OP-H1", "W-H1", 7024, 8262, 9201, 0, 1750, "New"); door("D-H1", "OP-H1", "T-MZ-P900", "P11");

  // ---------------------------------------------------------------- structure: the new frame's columns
  let c = 0;
  for (const [x, y] of [[351.5, 10150], [4221, 10150], [351.5, 5049], [4221, 5049], [351.5, 350], [4221, 350], [8661.5, 350]])
    add({ id: `K${++c}`, type: "Column", name: `Castillo K${c}`, args: { position: [x, y], columnType: { ref: "T-MZ-COL300" }, baseLevel: { ref: "L-PB2" }, baseOffset: -220, height: 2110 + 913, rotation: 0 }, params: { Mark: `K${c}`, Phase: "New" } });

  // ---------------------------------------------------------------- floors, slabs, the courtyard
  const floor = (id, name, boundary, type, lev, off = 0, phase = "New") => add({ id, type: "Floor", name, args: { boundary, floorType: { ref: type }, level: { ref: lev }, heightOffset: off }, params: { Phase: phase } });
  const R = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  floor("FL-PATIO", "Patio abierto (cochera)", R(201, 10381, 5802, 14292), "T-MZ-FIRME", "L-PB1");
  floor("FL-DESCANSO", "Descanso de la escalera", R(6001, 10228, 7546, 11439), "T-MZ-FIRME", "L-PB1");
  floor("FL-COCINA", "Cocina y comedor", [[7546, 10228], [13253, 10228], [13253, 14292], [6001, 14292], [6001, 11439], [7546, 11439]], "T-MZ-FIRME", "L-PB2", -20);
  floor("FL-HAB2", "Habitación 2", R(201, 5250, 4024, 9919), "T-MZ-FIRME", "L-PB2", -20);
  floor("FL-PATIOC", "Patio central", R(4422, 5250, 8503, 10076), "T-MZ-FIRME", "L-PB2");
  floor("FL-SALA", "Sala", R(8503, 3802, 13253, 10076), "T-MZ-FIRME", "L-PB2", -20);
  floor("FL-PASILLO", "Pasillo", R(201, 3802, 8503, 4852), "T-MZ-FIRME", "L-PB2", -20);
  floor("FL-SUR", "Habitaciones sur", R(201, 200, 13253, 3502), "T-MZ-FIRME", "L-PB2", -20);
  // below them: the fill down to the sidewalk's level, the ground under it all
  floor("FL-R-PATIO", "Relleno patio abierto", R(201, 10381, 5802, 14292), "T-MZ-REL-P", "L-PB1", -201);
  floor("FL-R-DESC", "Relleno descanso", R(6001, 10228, 7546, 11439), "T-MZ-REL-P", "L-PB1", -201);
  floor("FL-R-COCINA", "Relleno cocina", [[7546, 10228], [13253, 10228], [13253, 14292], [6001, 14292], [6001, 11439], [7546, 11439]], "T-MZ-REL", "L-PB2", -220);
  for (const [id, b] of [["HAB2", R(201, 5250, 4024, 9919)], ["SALA", R(8503, 3802, 13253, 10076)], ["PASILLO", R(201, 3802, 8503, 4852)], ["SUR", R(201, 200, 13253, 3502)]]) floor(`FL-R-${id}`, "Relleno", b, "T-MZ-REL", "L-PB2", -220);
  floor("FL-R-PATIOC", "Relleno patio central", R(4422, 5250, 8503, 10076), "T-MZ-REL-C", "L-PB2", -200);
  floor("FL-TERRENO", "Terreno", R(201, 200, 13253, 14292), "T-MZ-TERRENO", "L-BQ", 0, "Existing");
  // strip footings: the old walls' under the facades and party walls, the new ones' under the bearing walls
  const FOOTS = [];
  const foot = (id, a, b, w, z0, z1) => { FOOTS.push({ id, a, b }); const d = [b[0] - a[0], b[1] - a[1]], L0 = Math.hypot(...d), n = [-d[1] / L0 * w / 2, d[0] / L0 * w / 2];
    add({ id, type: "Generic", name: "Cimiento", args: { boundary: [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]], level: { ref: "L-BN" }, baseOffset: z0, height: z1 - z0, ifcClass: "IfcFooting", material: "M-MZ-CIMIENTO", colour: "" }, params: { Phase: "New" } }); };
  for (const [k, a, b, w] of [["N", [-198, 14432], [13651, 14432], 280], ["S", [-198, 1], [13651, 1], 398], ["O", [2, -198], [2, 14572], 398], ["E", [13452, -198], [13452, 14572], 398]]) {
    foot(`CI-${k}1`, a, b, w, -1520, -1300); foot(`CI-${k}2`, a, b, 790, -1920, -1520); }
  for (const [k, a, b] of [["I1", [201, 10150], [4422, 10150]], ["I3", [201, 5051], [6602, 5051]], ["I2", [4222, 5250], [4222, 9919]], ["K0", [4422, 10152], [13253, 10152]], ["N4", [8503, 3652], [13253, 3652]]]) {
    foot(`CI-${k}1`, a, b, 460, -1160, -913); foot(`CI-${k}2`, a, b, 865, -1395, -1160); }
  // the stair core's walls stand on deeper T footings (section 2)
  for (const [k, a, b] of [["K1", [5901.5, 10076], [5901.5, 14292]], ["K3", [9278, 10152], [9278, 12616]]]) {
    foot(`CI-${k}1`, a, b, 200, -1395, -370); foot(`CI-${k}2`, a, b, 906, -1795, -1395); }
  // the new slab at +2330: the whole house but the courtyard, the open patio, and the stair
  floor("FL-PA1", "Losa planta alta - terraza", [[201, 200], [13253, 200], [13253, 10076], [8503, 10076], [8503, 5250], [4422, 5250], [4422, 10076], [201, 10076]], "T-MZ-LOSA", "L-PA");
  floor("FL-PA2", "Losa estudio", [[5802, 10076], [13253, 10076], [13253, 14292], [5802, 14292], [5802, 12688], [9201, 12688], [9201, 11587], [5802, 11587]], "T-MZ-LOSA", "L-PA");
  floor("FL-T", "Losa techo estudio", [[5802, 10076], [13253, 10076], [13253, 14292], [5802, 14292], [5802, 12688], [9350, 12688], [9350, 11439], [5802, 11439]], "T-MZ-LOSA-T", "L-T");
  floor("FL-CASETON", "Techo casetón", R(6974, 11439, 9350, 12688), "T-MZ-LOSA-T", "L-T", 1805);
  // the sidewalks: Melchor Ocampo at -1300; Guillermo Nelson climbing north from the corner
  floor("FL-BQ-S", "Banqueta Melchor Ocampo", R(-2300, -2300, 15500, -220), "T-MZ-BANQUETA", "L-BQ", 0, "Existing");
  floor("FL-BQ-O", "Banqueta Guillermo Nelson", R(-2300, -220, -220, 16500), "T-MZ-BANQUETA", "L-BE", 0, "Existing");

  // ---------------------------------------------------------------- stairs, cornice, surrounds, the brick screen
  const gen = (id, name, boundary, lev, base, h, material, cls = "IfcBuildingElementProxy", colour = "", phase = "New") =>
    add({ id, type: "Generic", name, args: { boundary, level: { ref: lev }, baseOffset: base, height: h, ifcClass: cls, material, colour }, params: { Phase: phase } });
  // the stair in the core: three steps up from the kitchen to the landing, then a flight west to east with
  // winders at both ends, to the studio at +2330; its plan is the set's own (imported with the plan)
  const riser = 2500 / 15;
  [[7127, 7356], [7356, 7589], [7589, 7817]].forEach(([x0, x1], i) => gen(`ST${i + 1}`, `Escalón ${i + 1}`, R(7796 - 250 * (3 - i), 10228, 8046, 11439), "L-PB1", 0, riser * (i + 1), "M-CONC", "IfcStair"));
  const treads = [6001, 6300, 6650, 6954, 7127, 7356, 7589, 7817, 8046, 8224, 8550, 8900, 9201];
  for (let i = 0; i < treads.length - 1; i++) gen(`ST${i + 4}`, `Escalón ${i + 4}`, R(treads[i], 11587, treads[i + 1], 12540), "L-PB1", 0, riser * (i + 4), "M-CONC", "IfcStair");
  // the flight to the roof, over it: east to west
  for (let i = 0; i < 12; i++) gen(`SU${i + 1}`, `Escalón azotea ${i + 1}`, R(9197 - 250 * (i + 1), 11596, 9197 - 250 * i, 12544), "L-PA", 0, 200 * (i + 1), "M-CONC", "IfcStair");
  // the cornice: four stepped courses along both street facades, +3399 to +3649, turning the rounded corner
  [[3399, 70, 70], [3469, 140, 70], [3539, 210, 70], [3609, 280, 40]].forEach(([z0, t, hh], i) => {
    const o = 198 + t / 2, ty = `T-MZ-CORN${t}`;
    L.types[ty] = wt(`Cornisa ${t}`, "CO" + (i + 1), one(t, "M-MZ-CORNISA"), "Exterior");
    wall(`CO-S${i + 1}`, "Cornisa Melchor Ocampo", [13651, -o], [261, -o], ty, "L-BN", z0, hh, "Existing");
    add({ id: `CO-SO${i + 1}`, type: "Wall", name: "Cornisa esquina", args: { centreline: { type: "arc", centre: [261, 259], radius: 259 + 199 + t / 2, start: 180, end: 270, ccw: true }, mounting: "Centred", wallType: { ref: ty }, baseLevel: { ref: "L-BN" }, baseOffset: z0, height: hh, flipped: false }, params: { Phase: "Existing" } });
    wall(`CO-O${i + 1}`, "Cornisa Guillermo Nelson", [-o, 259], [-o, 14572], ty, "L-BN", z0, hh, "Existing");
  });
  // the grey mouldings round the street openings (and the plinth of Melchor Ocampo), 22 proud of the render,
  // drawn in the facade's plane as the elevations give them; the arched window's grey shutters inside
  const EL = mazatlanPdf().MZ_ELEV;
  const mould = (id, name, wp, loops, material, depth = 22, cls = "IfcMember") => add({ id, type: "Generic", name, args: { boundary: [[0, 0], [1, 0], [1, 1]], level: { ref: "L-BN" }, baseOffset: 0, height: depth, ifcClass: cls, material, colour: "", workPlane: wp, profile: loops }, params: { Phase: "Existing" } });
  EL.GN.surrounds.forEach((loops, i) => mould(`MO${i + 1}`, "Moldura", { start: [-220, 0], end: [-220, 1] }, loops, "M-MZ-GRIS"));
  EL.GN.shutters.forEach((l, i) => mould(`CV${i + 1}`, "Contraventana", { start: [-160, 0], end: [-160, 1] }, [l], "M-MZ-CONTRA", 40, "IfcShadingDevice"));
  EL.MO.surrounds.forEach((loops, i) => mould(`MS${i + 1}`, "Moldura", { start: [0, -198], end: [1, -198] }, loops, "M-MZ-GRIS"));
  // the terrace's brick screen round the courtyard's void: flat courses and bricks stood on end, as built
  const screen = (id, name, a, b) => add({ id, type: "Lattice", name, args: { line: line(a, b), level: { ref: "L-PA" }, baseOffset: 0, height: 1000, brickLength: 240, brickHeight: 60, brickDepth: 120, gap: 120, bed: 10, bond: "Soldier screen", material: "M-MZ-CELOSIA", colour: "#b5613d" }, params: { Phase: "New" } });
  screen("CE1", "Celosía patio poniente", [4362, 10076], [4362, 5190]);
  screen("CE2", "Celosía patio sur", [4362, 5190], [8563, 5190]);
  screen("CE3", "Celosía patio oriente", [8563, 5190], [8563, 10076]);

  // ---------------------------------------------------------------- rooms
  // the open plan divided where the drawing names its rooms
  add({ id: "RS1", type: "RoomSeparator", args: { line: line([9275, 12614], [9275, 14292]), level: { ref: "L-PB1" } } });
  add({ id: "RS2", type: "RoomSeparator", args: { line: line([8540, 3802], [8540, 5250]), level: { ref: "L-PB2" } } });
  add({ id: "RS3", type: "RoomSeparator", args: { line: line([9352.5, 10152], [13253, 10152]), level: { ref: "L-PB2" } } });
  add({ id: "RS3b", type: "RoomSeparator", args: { line: line([9352.5, 10152], [13253, 10152]), level: { ref: "L-PB1" } } });
  add({ id: "RS4", type: "RoomSeparator", args: { line: line([3080, 3652], [4003, 3652]), level: { ref: "L-PB2" } } });
  add({ id: "RS5", type: "RoomSeparator", args: { line: line([6602, 3652], [8503, 3652]), level: { ref: "L-PB2" } } });
  // label: as the set writes it (upper case, Arial 1.0, centred on the point)
  const space = (id, name, lev, anchor, number, h, label) => add({ id, type: "Space", name, args: { level: { ref: lev }, upperLimit: { mode: "offset", offset: h }, anchor, boundaryAt: "finishFace" }, params: { Number: number, Department: "Residencial", Phase: "New", Label: label || name } });
  space("SP-01", "Patio abierto al aire", "L-PB1", [2610, 11300], "01", 2500, "PATIO ABIERTO AL AIRE");
  space("SP-02", "Cocina", "L-PB1", [6800, 13090], "02", 2500, "COCINA");
  space("SP-03", "Comedor", "L-PB1", [11400, 11922], "03", 2500, "COMEDOR O ISLA");
  space("SP-04", "Sala", "L-PB2", [10470, 8205], "04", 3000, "SALA");
  space("SP-05", "Habitación 2", "L-H2", [2080, 8704], "05", 2500, "HABITACION\nRAFITA");
  space("SP-06", "Pasillo", "L-PB2", [5500, 4300], "06", 3000, " ");
  space("SP-07", "Patio central", "L-PB2", [6460, 7688], "07", 3000, "PATIO ABIERTO AL AIRE");
  space("SP-08", "Habitación doctores", "L-PB2", [1470, 2439], "08", 3000, "HABITACION\nDOCTORES");
  space("SP-09", "Baño", "L-PB2", [5250, 2519], "09", 3000, "BAÑO");
  space("SP-10", "Segunda entrada", "L-PB2", [7420, 492], "10", 3000, "SEGUNDA\nENTRADA");
  space("SP-11", "Habitación huésped", "L-PB2", [10730, 2113], "11", 3000, "HABITACION\nHUESPED");
  space("SP-12", "Estudio", "L-PA", [10900, 11334], "12", 2250, "STUDIO");

  // ---------------------------------------------------------------- views
  const vr = (top, cut, bottom, depth) => ({ top, cut, bottom, depth });
  const plan = (id, name, lev, range, clipRect, style = "VS-MZ-PLAN") => add({ id, type: "PlanView", name, args: { level: { ref: lev }, scale: 100, viewRange: range, detailLevel: "Medium", style: { ref: style }, clip: { rect: clipRect, visible: false, active: true } } });
  // crops: what the set's viewports show - the plan, its dimension strings, its markers and the street names
  plan("V-PB1", "PLANTA BAJA 1", "L-PB1", vr(2300, 1200, -580, -580), [-7700, -4700, 17600, 18800]);
  plan("V-PA", "PLANTA ALTA", "L-PA", vr(2300, 1200, -400, -400), [-7700, -4700, 17600, 18800], "VS-MZ-PLAN2");
  plan("V-T", "PLANTA TECHO", "L-T", vr(2500, 1900, -2500, -2500), [-7700, -4700, 17600, 18800], "VS-MZ-PLAN2");
  // the street elevations: what stands on the facade line, seen square (the far clip keeps the rooms behind out),
  // cropped as the set crops them, level heads on the left, grids bubbled above
  // where each view's grid lines stop below the ground, as the set draws them
  const GRID_BOTTOM = { "V-E-GN": -1941, "V-E-MO": -1812, "V-S1": -2407, "V-S2": -1914, "V-S3": -1865, "V-S4": -1865, "V-S5": -1800, "V-S6": -2009 };
  const elev = (id, name, a, b, depth, crop, levelExtent, gridTop) => add({ id, type: "ElevationView", name, args: { line: line(a, b), depth, scale: 50, baseLevel: { ref: "L-BN" }, top: 7000, style: { ref: "VS-MZ-ELEV" }, detailLevel: "Medium",
    clip: { rect: crop, visible: false, active: true, annotation: [95, Math.max(12, 12 + (crop[1] + 1500) / 50), 15, 65] }, levelExtent, groundLine: false, overrides: { __gridTop: gridTop, __gridBottom: GRID_BOTTOM[id] } } });
  // the elevation tags and the section flags where the set's plans draw them (the flag's base on the line)
  elev("V-E-GN", "ELEVACION GUILLERMO NELSON", [-2711, -4000], [-2711, 16024], 2800, [295, -1702, 17938, 4800], [-119, 17190], 5797);
  elev("V-E-MO", "ELEVACION SUR", [15000, -2654], [-1554, -2654], 2800, [900, -1500, 16000, 4800], [-1698, 16004], 6328);
  // the six cuts of the set, placed where its plan puts them, looking the way its flags point; each cropped,
  // its levels and grid bubbles where its sheet has them
  const sect = (id, name, a, b, depth, heads, crop, levelExtent, gridTop, hide) => add({ id, type: "SectionView", name, args: { line: line(a, b), depth, scale: 50, baseLevel: { ref: "L-BN" }, top: 7000, style: { ref: "VS-MZ-SEC" }, detailLevel: "Medium",
    clip: { rect: crop, visible: false, active: true, annotation: [95, 25, 20, 65] }, heads, levelExtent, groundLine: false,
    overrides: Object.assign({ __gridTop: gridTop, __gridBottom: GRID_BOTTOM[id] }, Object.fromEntries(hide.map(k => [k, { visible: false }]))) } });
  const ALL = ["L-T", "L-LAF", "L-LAC", "L-LBC", "L-PA", "L-BN", "L-PB1", "L-H2", "L-PB2", "L-BE", "L-BQ"], only = (...ks) => ALL.filter(k => !ks.includes(k));
  sect("V-S1", "Section 1", [1302, -4485], [1302, 16517], 12500, "End", [1500, -1950, 17300, 6700], [373, 18270], 6319, only("L-T", "L-PA", "L-PB1", "L-PB2", "L-BQ"));
  sect("V-S2", "Section 2", [17213, 11012], [-4957, 11012], 3700, "End", [4300, -1950, 18800, 6700], [3333, 21003], 6342, [...only("L-T", "L-PA", "L-PB1"), "FL-TERRENO", "FL-R-PATIO", "FL-R-DESC", "FL-R-COCINA"]);
  sect("V-S3", "Section 3", [6602, -4485], [6602, 16517], 7000, "End", [1500, -1950, 17300, 6700], [373, 18270], 7194, only("L-T", "L-PA", "L-PB1", "L-PB2"));
  sect("V-S4", "Section 4", [5404, -4485], [5404, 16517], 8300, "End", [1500, -1950, 17300, 6700], [373, 18270], 7255, only("L-T", "L-PA", "L-PB1", "L-BE"));
  sect("V-S5", "Section 5", [10006, 16532], [10006, -4513], 10300, "Start", [3900, -1950, 19300, 6700], [2642, 20290], 9234, only("L-T", "L-PA", "L-PB1", "L-PB2"));
  sect("V-S6", "Section 6", [17128, 6016], [-5040, 6016], 8700, "End", [4400, -1950, 18900, 6700], [2677, 21024], 7902, only("L-T", "L-PA", "L-PB1", "L-PB2"));
  // the set's 3D sheets: shaded, the sun on, the edges drawn, sized as the set sizes them (about 1:80)
  const axo = (id, name, az, el, scale = 80) => add({ id, type: "View3D", name, args: { camera: { azimuth: az, elevation: el, target: [6700, 7200, 1500] }, scale, style: { ref: "VS-MZ" }, visualStyle: "Shaded",
    render: { display: "renderedEdges", rasterDPI: 200, silhouetteWeight: 0.35 } } });
  axo("V-3D-SO", "PERSPECTIVA SUR-OESTE", 225, 18, 60); axo("V-3D-UB", "VISTA DE UBICACION", 225, 25, 250); axo("V-3D-SE", "AXO SUR-ESTE", 315, 30); axo("V-3D-SO2", "AXO SUR-OESTE", 225, 35); axo("V-3D-NE", "AXO NORTE-ESTE", 45, 35);
  add({ id: "SC-P", type: "Schedule", name: "Cuadro de puertas", args: { of: "IfcDoor", fields: ["Mark", "TypeMark", "Width", "Height"] } });
  add({ id: "SC-L", type: "Schedule", name: "Cuadro de locales", args: { of: "IfcSpace", fields: ["Number", "Name", "Area"] } });

  // drafting views: the existing house as surveyed by hand (a drawing, not a model), the general notes
  add({ id: "V-EX", type: "DraftingView", name: "DIBUJOS EXISTENTES", args: { scale: 100, clip: { rect: [0, 0, 42000, 29700], visible: false, active: true } } });
  add({ id: "V-NOTAS", type: "DraftingView", name: "NOTAS GENERALES", args: { scale: 100, clip: { rect: [0, 0, 42000, 29700], visible: false, active: true } } });
  const pdf = mazatlanPdf();
  add({ id: "IM-EX", type: "CADImport", name: "Levantamiento existente (dibujo a mano)", args: { file: "levantamiento.dxf", drawing: pdf.MZ_A010, view: { ref: "V-EX" }, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, pinned: true } });
  add({ id: "IM-MAP", type: "CADImport", name: "Plano de ubicación", args: { file: "ubicacion.dxf", drawing: pdf.MZ_A001_MAP, view: { ref: "V-NOTAS" }, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, pinned: true } });
  // the notes page: each line in a text type of its own measured height; the stamp in Arial Narrow
  const noteType = t => {
    // the stamp under the picture is Arial drawn wide (width factor 2.27 on a 1.95 cap)
    const wide = t.text === "NOT FOR CONSTRUCTION", narrow = t.text === "BAJO REVISION", font = narrow || wide ? "Arial" : t.font;
    const cap = wide ? 1.95 : t.cap, wf = narrow ? 0.82 : wide ? 2.27 : 1, key = `TT-MZN-${font}${narrow ? "N" : wide ? "W" : ""}-${cap.toFixed(2)}`;
    if (!doc.lib.textTypes[key]) doc.lib.textTypes[key] = { name: `${font}${narrow ? " Narrow" : wide ? " Wide" : ""} ${cap.toFixed(2)} (notes)`, height: cap, font, widthFactor: wf, colour: "#000000", pen: "thin", lineSpacing: 1.6 };
    return key;
  };
  pdf.MZ_A001_TEXT.forEach((t, i) => add({ id: `TXN${i + 1}`, type: "Text", args: { content: t.text, position: t.at, rotation: t.rot || 0, textType: { ref: noteType(t) }, wrapWidth: 1000, leaders: [], view: { ref: "V-NOTAS" } } }));

  // ---------------------------------------------------------------- the plans' annotation, as the set has it
  // Each plan's page was read apart: what the model draws is the model's; the dimension strings are real
  // dimensions bound to what they measure; the spot levels read the floors; the notes are text; and what the
  // set only ever drew in 2D - furniture, fixtures, the car, the plants, the door symbols, the hand marks -
  // is the plan's imported drawing.
  doc.regenerate();
  const TT = (cap, font) => font === "ArialBold" ? "TT-MZ-30B" : font === "ArialNarrow" ? "TT-MZ-20N" : cap < 1.1 ? "TT-MZ-10" : cap < 1.4 ? "TT-MZ-12" : cap < 1.8 ? "TT-MZ-17" : cap < 2.5 ? "TT-MZ-20" : "TT-MZ-30B";
  const planNotes = (v, data, cutZ, rooms, zMin = cutZ) => {
    add({ id: `IM-${v}`, type: "CADImport", name: "Dibujo 2D (mobiliario, muebles fijos, simbología)", args: { file: `${v}.dxf`, drawing: data.import, view: { ref: v }, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, pinned: true } });
    const roomText = new Set(rooms.flatMap(r => r.split("\n")));
    let n = 0;
    // a room's name is its label: the room's point goes where the set wrote its first line
    const spaces = doc.elements().filter(f => doc.typeOf(f) === "Space");
    for (const t of data.texts) {
      const first = spaces.filter(f => String(doc.getParam(f, "Label") || "").split("\n")[0] === t.text);
      if (first.length) {
        const c = [t.at[0] + t.w / 2, t.at[1]], near = first.map(f => ({ f, d: Math.hypot(doc.argValue(f, "anchor")[0] - c[0], doc.argValue(f, "anchor")[1] - c[1]) })).sort((a, b) => a.d - b.d)[0];
        if (near.d < 1500) ed.apply({ op: "set", id: doc.idOf(near.f), key: "anchor", value: c }, { regenerate: false });
      }
    }
    for (const t of data.texts) {
      if (roomText.has(t.text)) continue;
      add({ id: `TX-${v}-${++n}`, type: "Text", args: { content: t.text, position: t.at, rotation: t.rot || 0, textType: { ref: TT(t.cap, t.font) }, wrapWidth: 1000, leaders: [], view: { ref: v } } });
    }
    data.npts.forEach((q, i) => add({ id: `NP-${v}-${i + 1}`, type: "SpotElevation", args: { position: [q.at[0], q.at[1] - 212], view: { ref: v }, prefix: "NPT ", units: "m", textSize: 1.0 } }));
    // the references a dimension may bind to: lines square to what it measures, crossing the cut
    const refs = [];
    for (const f of doc.elements()) {
      const t = doc.typeOf(f); if (!["Wall", "Column", "Grid", "Opening", "Door", "Window"].includes(t) || doc.error(f)) continue;
      const seen = q => q && q.z0 <= cutZ + 1e-6 && q.z1 >= zMin - 1e-6;
      const pl = doc.plan(f); if (t !== "Grid" && !seen(pl) && t !== "Opening") continue;
      if (t === "Opening") { const host = doc.element(doc.argValue(f, "host").ref), hp = host && doc.plan(host); if (!seen(hp)) continue; }
      for (const r of elementRefs(doc, f)) if (r.kind === "point" && t === "Wall") {
        refs.push({ key: `${doc.idOf(f)}:${r.key}`, v: true, c: r.geom[0], lo: r.geom[1], hi: r.geom[1], wall: true }, { key: `${doc.idOf(f)}:${r.key}`, v: false, c: r.geom[1], lo: r.geom[0], hi: r.geom[0], wall: true });
      } else if (r.kind === "line" && r.a && r.b) {
        const vx = Math.abs(r.a[0] - r.b[0]) < 0.5, hy = Math.abs(r.a[1] - r.b[1]) < 0.5; if (!vx && !hy) continue;
        refs.push({ key: `${doc.idOf(f)}:${r.key}`, v: vx, c: vx ? r.a[0] : r.a[1], lo: vx ? Math.min(r.a[1], r.b[1]) : Math.min(r.a[0], r.b[0]), hi: vx ? Math.max(r.a[1], r.b[1]) : Math.max(r.a[0], r.b[0]), grid: t === "Grid", wall: t === "Wall" });
      }
    }
    const pick = (c, vert, at) => {
      let best = null;
      for (const r of refs) {
        if (r.v !== vert || Math.abs(r.c - c) > (r.grid ? 1.5 : 6)) continue;
        const gap = at < r.lo ? r.lo - at : at > r.hi ? at - r.hi : 0, sc = Math.abs(r.c - c) * 20 + gap + (r.grid ? 300 : 0);
        if (!best || sc < best.sc) best = { sc, r };
      }
      return best && best.r;
    };
    let k = 0;
    for (const dm of data.dims) {
      if (Math.abs(dm.to - dm.from) < 50) continue;
      const vert = dm.h;                         // a horizontal string measures between vertical lines
      if (!dm.value) continue;
      // what the string measures that the model does not hold (a stair's tread, a niche, a door's leaf) is
      // measured to a detail line laid on the dimension's own witness line
      const witness = c => { const lid = `DL-${v}-${++k}`, side = (vert ? 7200 : 6700) > dm.at ? 1 : -1;
        add({ id: lid, type: "DetailLine", args: { curve: line(vert ? [c, dm.at - 150 * side] : [dm.at - 150 * side, c], vert ? [c, dm.at + 250 * side] : [dm.at + 250 * side, c]), pen: "gossamer", view: { ref: v } } });
        return { key: `${lid}:line` }; };
      const ra = pick(dm.from, vert, dm.at) || witness(dm.from), rb = pick(dm.to, vert, dm.at) || witness(dm.to);
      if (ra.key === rb.key) { if (globalThis.MZ_DEBUG) console.log("dim unbound", v, JSON.stringify(dm)); continue; }
      const id = add({ id: `DM-${v}-${++k}`, type: "Dimension", args: { of: [ra.key, rb.key], offset: 0, view: { ref: v }, locked: false, dimType: { ref: "DT-MZ" }, below: dm.below || "" } });
      // the model here is read off the drawing to within a few millimetres: where the string still disagrees
      // with what the set wrote, its end is the drawing's own witness line
      const reads = () => { const g = dimensionGeometry(doc, doc.element(id)); return g && String(Math.round(g.value / 5) * 5) === dm.value.replace(/\D/g, ""); };
      if (!reads()) { ed.apply({ op: "set", id, key: "of", value: [ra.key, witness(dm.to).key] }, { regenerate: false }); if (!reads()) ed.apply({ op: "set", id, key: "of", value: [witness(dm.from).key, rb.key] }, { regenerate: false }); if (!reads()) ed.apply({ op: "set", id, key: "of", value: [witness(dm.from).key, witness(dm.to).key] }, { regenerate: false });
        if (!reads()) { const w0 = +dm.value.replace(/\D/g, ""), sg = Math.sign(dm.to - dm.from); ed.apply({ op: "set", id, key: "of", value: [witness(dm.from).key, witness(dm.from + sg * w0).key] }, { regenerate: false }); } }
      const g = dimensionGeometry(doc, doc.element(id));
      if (g) ed.apply({ op: "set", id, key: "offset", value: Math.round((dm.h ? dm.at - g.a[1] : dm.at - g.a[0]) * (dm.h ? g.along[1] : g.along[0])) }, { regenerate: false });
      if (globalThis.MZ_DEBUG && g && dm.value && String(Math.round(g.value / 5) * 5) !== dm.value) console.log("dim value", v, dm.value, "measures", g.value, JSON.stringify(doc.argValue(doc.element(id), "of")));
    }
  };
  const pdfPlans = mazatlanPdf();
  // the new slab ("Losa Alex"), hatched green over the ground floor
  add({ id: "FR-LOSA", type: "FilledRegion", name: "Losa Alex", args: { boundary: [[4371, 3502], [13253, 3502], [13253, 10076], [8503, 10076], [8503, 5250], [4371, 5250]],
    pattern: "P-MZ-GREEN", view: { ref: "V-PB1" }, background: "none", patternColour: "#00ff00", lineColour: "none" } });
  add({ id: "FR-LOSA2", type: "FilledRegion", name: "Losa Alex (cocina)", args: { boundary: [[6001, 10076], [13253, 10076], [13253, 14292], [9176, 14292], [9176, 13690], [8473, 13690], [8473, 14292], [6704, 14292], [6704, 13690], [6001, 13690]],
    pattern: "P-MZ-GREEN2", view: { ref: "V-PB1" }, background: "none", patternColour: "#00ff00", lineColour: "none" } });
  planNotes("V-PA", pdfPlans.MZ_PA, 2330 + 1200, ["STUDIO"], 2330);
  planNotes("V-T", pdfPlans.MZ_T, 4730 + 1900, [], 4730 - 2500);
  // each plan draws the section flags and tails where the set moved them in that view
  const ends = (v, o) => ed.apply({ op: "set", id: v, key: "overrides", value: Object.fromEntries(Object.entries(o).map(([k, [a, b]]) => [k, { markerLine: line(a, b) }])) }, { regenerate: false });
  ends("V-PA", { "V-S1": [[1302, -4425], [1302, 16939]], "V-S4": [[5404, -4425], [5404, 16939]], "V-S3": [[6602, -4425], [6602, 16939]], "V-S5": [[10006, 16867], [10006, -4425]],
    "V-S2": [[17257, 11012], [-4955, 11012]], "V-S6": [[17137, 6016], [-5040, 6016]] });
  ends("V-T", { "V-S1": [[1302, -3510], [1302, 15786]], "V-S4": [[5404, -3510], [5404, 15786]], "V-S3": [[6602, -3510], [6602, 15786]], "V-S5": [[10006, 15291], [10006, -4005]],
    "V-S2": [[17228, 11012], [-4927, 11012]], "V-S6": [[17157, 6016], [-5012, 6016]] });
  planNotes("V-PB1", pdfPlans.MZ_PB1, -170 + 1200, ["PATIO ABIERTO AL AIRE", "COCINA", "COMEDOR O ISLA", "SALA", "HABITACION\nRAFITA", "HABITACION\nDOCTORES", "BAÑO", "SEGUNDA\nENTRADA", "HABITACION\nHUESPED"]);

  // ---------------------------------------------------------------- the elevations' annotation
  // the ground in poché (the sidewalk falling to the corner), the sections crossing (flag up top, tail below),
  // the heights between levels, and the people the set stands in its openings
  const sGN = y => 16024 - y, sMO = x => x + 1554;
  add({ id: "FR-GN-SUELO", type: "FilledRegion", name: "Terreno", args: { boundary: EL.GN.ground[0].map(([u, z]) => [sGN(u), z]), pattern: "", view: { ref: "V-E-GN" }, background: "#808080", lineColour: "none" } });
  // its top, the sidewalk's edge, in the heavy line the set gives it
  { const G0 = EL.GN.ground[0], lo = Math.min(...G0.map(q => q[1])), xs = G0.map(q => q[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
    const top = G0.filter(q => q[1] > lo + 1).map(([u, z]) => [sGN(u), z]).sort((a, b) => a[0] - b[0]).filter((q, i, a) => i === 0 || q[0] - a[i - 1][0] > 1);
    const pts = [top[0]];
    for (let i = 1; i < top.length - 1; i++) { const a = pts[pts.length - 1], b = top[i], c = top[i + 1], cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (Math.abs(cr) > 400 * Math.hypot(c[0] - a[0], c[1] - a[1]) / 100) pts.push(b); }
    pts.push(top[top.length - 1]);
    for (let i = 0; i + 1 < pts.length; i++) add({ id: `DL-GN-SUELO${i + 1}`, type: "DetailLine", args: { curve: line(pts[i], pts[i + 1]), pen: "extra", view: { ref: "V-E-GN" } } }); }
  // the heights on the facade, level to level
  add({ id: "DM-GN-1", type: "Dimension", args: { of: ["L-BN:plane", "L-PA:plane"], offset: 1330, view: { ref: "V-E-GN" }, locked: false, dimType: { ref: "DT-MZ" } } });
  add({ id: "DM-GN-2", type: "Dimension", args: { of: ["L-PA:plane", "L-T:plane"], offset: 1330, view: { ref: "V-E-GN" }, locked: false, dimType: { ref: "DT-MZ" } } });
  // the shutters' meeting line
  add({ id: "DL-GN-CV", type: "DetailLine", args: { curve: line([sGN(7621.5), 78], [sGN(7621.5), 1977]), pen: "medium", view: { ref: "V-E-GN" } } });
  const setOv = (v, o) => ed.apply({ op: "set", id: v, key: "overrides", value: Object.assign({}, doc.argValue(doc.element(v), "overrides") || {}, o) }, { regenerate: false });
  setOv("V-E-GN", { "V-S2": { markerZ: [-1917, 6222], stubs: [17.1, 9.9] }, "V-S6": { markerZ: [-1917, 6222], stubs: [17.1, 9.9] } });
  setOv("V-E-MO", { "V-S1": { markerZ: [-2123, 7290], stubs: [9, 4.6] }, "V-S3": { markerZ: [-2123, 7290], stubs: [9, 4.6] }, "V-S4": { markerZ: [-2123, 7290], stubs: [9, 4.6] }, "V-S5": { markerZ: [-2107, 7280], stubs: [9, 4.6] } });
  // Melchor Ocampo: the grid bays over the facade, the wall's height from the sidewalk, the sidewalk's edge;
  // only the levels the set shows here
  [["G-A", "G-B"], ["G-B", "G-C"], ["G-C", "G-D"]].forEach(([a, b], i) => add({ id: `DM-MO-${i + 1}`, type: "Dimension", args: { of: [`${a}:line`, `${b}:line`], offset: 5670, view: { ref: "V-E-MO" }, locked: false, dimType: { ref: "DT-MZ" } } }));
  add({ id: "DM-MO-H", type: "Dimension", args: { of: ["L-BQ:plane", "L-LAF:plane"], offset: -136, view: { ref: "V-E-MO" }, locked: false, dimType: { ref: "DT-MZ" }, below: "ALTURA PARED EXISTENTE" } });
  // under the plinth and the sidewalk nothing of the facade is seen: a masking region down from the ground line
  add({ id: "FR-MO-SUELO", type: "FilledRegion", name: "Región de enmascaramiento", args: { boundary: [[sMO(-199), -1300], [sMO(-47), -1203], [sMO(-47), -1097], [sMO(13498), -1097], [sMO(13498), -1203], [sMO(13650), -1300], [sMO(13650), -1500], [sMO(-199), -1500]], pattern: "", background: "#ffffff", lineColour: "none", view: { ref: "V-E-MO" } } });
  [[13650, -1300], [13498, -1203], [-47, -1203], [-199, -1300], [-1586, -1300]].map(([x, z]) => [sMO(x), z]).forEach((q, i, a) => { if (i) add({ id: `DL-MO-BQ${i}`, type: "DetailLine", args: { curve: line(a[i - 1], q), pen: "bold", view: { ref: "V-E-MO" } } }); });
  // the entrance's steps down to the sidewalk, behind the plinth's face: hidden lines, as the set draws them
  [[[8334, -714], [9794, -714]],[[8334, -714], [8334, -875]],[[9794, -714], [9794, -875]],[[8156, -875], [9974, -875]],[[8156, -875], [8156, -1034]],[[9974, -875], [9974, -1034]],[[7954, -1034], [10175, -1034]],[[7954, -1034], [7954, -1194]],[[10175, -1034], [10175, -1194]],[[8514, -682], [8514, -714]],[[9614, -682], [9614, -714]]].forEach(([a, b], i) => add({ id: `DL-MO-ST${i + 1}`, type: "DetailLine", args: { curve: line(a, b), pen: "medium", lineStyle: a[1] === b[1] ? "Hidden" : "Solid", view: { ref: "V-E-MO" } } }));
  setOv("V-E-MO", Object.fromEntries(["L-LAC", "L-LBC", "L-BN", "L-H2", "L-PB2", "L-BE"].map(k => [k, { visible: false }])));
  // in each section, the others that cross it: flag up top, tail below, where its sheet puts them
  const mk = (tz, hz, ts, hs) => ({ markerZ: [tz, hz], stubs: [ts, hs] });
  setOv("V-S1", { "V-S2": mk(-2417, 7310, 10.1, 5.8), "V-S6": mk(-2417, 7310, 8.4, 6.5) });
  setOv("V-S2", { "V-S1": mk(-2215, 7276, 15.2, 4.7), "V-S4": mk(-2245, 7276, 15.2, 4.7), "V-S3": mk(-2225, 7276, 15.1, 4.7), "V-S5": mk(-2245, 7276, 15.2, 4.8) });
  setOv("V-S3", { "V-S2": mk(-2124, 7156, 19.1, 6.2), "V-S6": mk(-2066, 7156, 18.6, 4.5) });
  setOv("V-S4", { "V-S2": mk(-2361, 7181, 11.2, 5.4), "V-S6": mk(-2361, 7181, 11.2, 9.0) });
  setOv("V-S5", { "V-S2": mk(-2124, 9231, 7.5, 11.2), "V-S6": mk(-2099, 9231, 6.4, 10.8) });
  setOv("V-S6", { "V-S1": mk(-2144, 7606, 11.3, 5.1), "V-S4": mk(-2145, 7598, 11.2, 5.3), "V-S3": mk(-2146, 7593, 11.3, 4.5), "V-S5": mk(-2140, 7601, 11.1, 4.5) });
  const figure = (id, sym, view, at) => add({ id, type: "SymbolInstance", args: { symbol: { ref: sym }, position: at, rotation: 0, view: { ref: view } } });
  figure("EN1", "SY-ENT-WOMAN1", "V-E-GN", [sGN(12824), 0]); figure("EN2", "SY-ENT-WOMAN2", "V-E-GN", [sGN(1223), -828]);

  // ---------------------------------------------------------------- the sections' annotation
  // Each section's page read apart as the plans were: its furniture, fixtures, the car and the faint figures
  // imported; its notes as text; its strings as dimensions between levels (heights) and grids (bays)
  const secNotes = (v, data, headS) => {
    const G0 = viewLineGeometry(doc, doc.element(v));
    if (data.import.elements.length) add({ id: `IM-${v}`, type: "CADImport", name: "Dibujo 2D (mobiliario, figuras)", args: { file: `${v}.dxf`, drawing: data.import, view: { ref: v }, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, pinned: true } });
    let n = 0;
    for (const t of data.texts) {
      if (Math.abs(t.cap - 2.04) < 0.05 && t.at[0] < headS + 450) continue;          // the level heads' own words
      add({ id: `TX-${v}-${++n}`, type: "Text", args: { content: t.text, position: t.at, rotation: t.rot || 0, textType: { ref: TT(t.cap, t.font) }, wrapWidth: 1000, leaders: [], view: { ref: v } } });
    }
    const levels = doc.elements().filter(f => doc.typeOf(f) === "Level").map(f => ({ id: doc.idOf(f), z: doc.argValue(f, "elevation") }));
    const grids = doc.elements().filter(f => doc.typeOf(f) === "Grid").map(f => { const c = doc.argValue(f, "line"), vert = Math.abs(c.start[0] - c.end[0]) < 1;
      const p = vert ? [c.start[0], G0.o[1]] : [G0.o[0], c.start[1]]; return { id: doc.idOf(f), s: G0.sOf(p) }; });
    // the horizontal planes this view can dimension to: slabs' faces and walls' tops and bases along its line
    const planes = [];
    for (const f of doc.elements()) { const t = doc.typeOf(f); if (t !== "Floor" && t !== "Wall" && t !== "Generic") continue;
      for (const r of elementRefs(doc, f)) if (r.kind === "plane" && (!r.foot || r.foot.some(q => { const dd = G0.depthOf(q); return dd >= -50 && dd <= G0.depthMax; }))) planes.push({ key: `${doc.idOf(f)}:${r.key}`, z: r.z, floor: t === "Floor" }); }
    planes.sort((a, b) => (b.floor ? 1 : 0) - (a.floor ? 1 : 0));
    let k = 0;
    for (const dm of data.dims) {
      const near = (arr, key, v0) => arr.map(o => ({ o, d: Math.abs(o[key] - v0) })).sort((a, b) => a.d - b.d)[0];
      if (dm.h) { const a = near(grids, "s", dm.from), b = near(grids, "s", dm.to); if (a.d > 30 || b.d > 30) continue;
        add({ id: `DM-${v}-${++k}`, type: "Dimension", args: { of: [`${a.o.id}:line`, `${b.o.id}:line`], offset: dm.at, view: { ref: v }, locked: false, dimType: { ref: "DT-MZ" } } }); }
      else {
        // a height: between levels where it ends on one, else on what drives it there (a slab's face, a wall's top)
        const end = z => { const l = near(levels, "z", z); if (l.d <= 10) return `${l.o.id}:plane`; const pl = near(planes, "z", z); return pl && pl.d <= 10 ? pl.o.key : null; };
        const a = end(dm.from), b = end(dm.to); if (!a || !b || a === b) continue;
        add({ id: `DM-${v}-${++k}`, type: "Dimension", args: { of: [a, b], offset: dm.at, view: { ref: v }, locked: false, dimType: { ref: "DT-MZ" } } }); }
    }
  };
  const pdfS = mazatlanPdf();
  // Section 2 cuts the stair core: its stairs, doors and fittings as the set draws them there (the model's
  // stair is the plans' and 3D's)
  for (const v of ["V-S2", "V-S3"]) ed.apply({ op: "set", id: v, key: "vg", value: { byCategory: { IfcStair: { visible: false } } } }, { regenerate: false });
  for (const v of ["V-S5", "V-S6"]) ed.apply({ op: "set", id: v, key: "style", value: { ref: "VS-MZ-SEC-SH" } }, { regenerate: false });
  secNotes("V-S1", pdfS.MZ_S1, 373); secNotes("V-S2", pdfS.MZ_S2, 3333); secNotes("V-S3", pdfS.MZ_S3, 373); secNotes("V-S4", pdfS.MZ_S4, 373);
  figure("EN-S1", "SY-ENT-WOMAN2", "V-S1", [8045, -713]);
  // sections 5 and 6 are pictures in the set (shaded, with shadows): their notes and strings read off them
  const T13 = (text, at) => ({ text, at, cap: 1.7, font: "Arial", rot: 0 });
  const H = (at, from, to) => ({ h: true, at, from, to }), V = (at, from, to) => ({ h: false, at, from, to });
  secNotes("V-S5", { import: { elements: [] }, texts: [T13("HABITACION", [7380, 747]), T13("PASILLO", [8908, 747]), T13("COMEDOR", [15740, 747]), T13("STUDIO DR", [17965, 3502])],
    dims: [H(6148, 4513, 8213), H(6148, 8213, 9563), H(6148, 9563, 14663), H(6148, 14663, 19083), V(3677, 2330, 4730), V(3677, -170, 2330), V(19190, -713, 2110), V(19615, -693, 2330)] }, 2642);
  secNotes("V-S6", { import: { elements: [] }, texts: [T13("HABITACION", [7164, 908]), T13("COCINA/SALA", [16220, 908])],
    dims: [H(7045, 5040, 9515), H(7045, 9515, 14640), H(7045, 14640, 18490), V(10230, 4730, 5830), V(10230, 5830, 6535), V(4095, 2330, 3429), V(4095, -713, 2110)] }, 2677);
  // a section draws the footings it cuts, not those it would see beyond under the ground (as the set's do)
  for (const [v, axis, c] of [["V-S1", 0, 1302], ["V-S2", 1, 11012], ["V-S3", 0, 6602], ["V-S4", 0, 5404], ["V-S5", 0, 10006], ["V-S6", 1, 6016]]) {
    const ov = Object.assign({}, doc.argValue(doc.element(v), "overrides"));
    for (const { id, a, b } of FOOTS) if (!(Math.min(a[axis], b[axis]) <= c && Math.max(a[axis], b[axis]) >= c)) ov[id] = { visible: false };
    ed.apply({ op: "set", id: v, key: "overrides", value: ov }, { regenerate: false }); }
  figure("EN-S5a", "SY-ENT-WALK", "V-S5", [8926, 2330]); figure("EN-S5b", "SY-ENT-WOMAN1", "V-S5", [6290, -713]);

  // ---------------------------------------------------------------- the sheets: every page of the set, A3, in its title band
  // a plan's viewport is placed so the model's origin (grid A on grid 5) falls where the set's does
  const planAt = (anchor, rect, s = 100) => [anchor[0] + (rect[0] + rect[2]) / 2 / s, anchor[1] + (rect[1] + rect[3]) / 2 / s];
  const sheet = (number, name, vps) => add({ id: `SH-${number}`, type: "Sheet", name: `${number} ${name}`, args: { number, sheetName: name, size: "A3", orientation: "landscape", titleBlock: { ref: "SY-TB-BAND" }, viewports: vps.map(([view, at, extra], i) => Object.assign({ id: `VP${i + 1}`, view: { ref: view }, at, clipVisible: false }, extra || {})), revision: "REV3" } });
  const PR = [-7700, -4700, 17600, 18800];
  sheet("A001", "Notas Generales", [["V-NOTAS", [210, 148.5], { noTitle: true }]]);
  ed.apply({ op: "set", id: "SH-A001", key: "scaleLabel", value: "As indicated" }, { regenerate: false });
  sheet("A010", "Dibujos Existentes", [["V-EX", [210, 148.5], { noTitle: true }]]);
  sheet("A101", "Planta Baja", [["V-PB1", planAt([91.5, 98.8], PR), { titleAt: [25.74, 44.37], titleLength: 58.72 }]]);
  sheet("A102", "Planta Alta", [["V-PA", planAt([89.552, 93.847], PR), { titleAt: [17.82, 44.79], titleLength: 69.39 }]]);
  sheet("A103", "Planta Techo", [["V-T", planAt([89.679, 93.974], PR), { noTitle: true }]]);
  // an elevation's viewport: its crop's centre, from where the set puts a grid and the bench mark on the paper
  const elevAt = (px, s, pz, crop) => [px + ((crop[0] + crop[2]) / 2 - s) / 50, pz + (crop[1] + crop[3]) / 2 / 50];
  sheet("A201", "Elevacion Guillermo Nelson", [["V-E-GN", elevAt(80.28, 16024 - 14570, 107.06, [295, -1702, 17938, 4800]), { titleAt: [53.68, 50.88], titleLength: 123.7 }]]);
  sheet("A202", "Calle Melchor Ocampo", [["V-E-MO", elevAt(106.05, 1554, 104.15, [900, -1500, 16000, 4800]), { titleAt: [43.01, 43.35], titleLength: 91.1 }]]);
  // a section's viewport: from where its sheet puts a grid (s along the view) and the bench mark
  const SEC = { 1: [73.55, 16517 - 14570, 93.65, [1500, -1950, 17300, 6700], [20.15, 43.26, 39.75]], 2: [79.08, 4957, 89.59, [4300, -1950, 18800, 6700], [19.98, 43.31, 39.33]],
    3: [73.55, 16517 - 14570, 93.65, [1500, -1950, 17300, 6700], [19.98, 43.22, 39.71]], 4: [73.55, 16517 - 14570, 93.65, [1500, -1950, 17300, 6700], [20.06, 43.35, 38.28]],
    5: [375.85, 14570 + 4513, 93.65, [3900, -1950, 19300, 6700], [20.02, 43.35, 44.5]], 6: [80.31, 5040, 89.59, [4400, -1950, 18900, 6700], [20.06, 43.26, 55.51]] };
  for (let i = 1; i <= 6; i++) { const [px, s0, pz, crop, [tx, ty, tl]] = SEC[i]; sheet(`A30${i}`, `Seccion 0${i}`, [[`V-S${i}`, elevAt(px, s0, pz, crop), { titleAt: [tx, ty], titleLength: tl }]]); }
  // the set's hand markup over four of its sheets, as it was scanned onto them
  const sketch = (n, rect, name = "Croquis a mano") => { const f = doc.element(`SH-${n}`), im = MZ_IMAGES[n]; ed.apply({ op: "set", id: `SH-${n}`, key: "images", value: [{ rect, url: im.url, w: im.w, h: im.h, blend: "multiply", name }] }, { regenerate: false }); };
  sketch("A101", [93.53, 0, 145.7, 242.84]); sketch("A102", [84.4, 93.74, 144.64, 203.27]); sketch("A303", [262.2, 137.7, 134.7, 61.3]); sketch("A304", [76.5, 79.3, 209.9, 134.0]);
  sketch("A001", [255.67, 49.18, 93.73, 53.09], "Vista 3D");
  // the 3D sheets: the picture where the set has it, no title, no scale in the band
  for (const [n, name, v, at] of [["A901", "Perspectiva Sur-Oeste", "V-3D-SO", [204, 165]], ["A902", "Axo Sur-Este", "V-3D-SE", [192, 157]], ["A903", "Axo Sur-Oeste", "V-3D-SO2", [202, 165]], ["A904", "Axo Norte-Este", "V-3D-NE", [197, 162]]]) {
    sheet(n, name, [[v, at, { noTitle: true }]]); ed.apply({ op: "set", id: `SH-${n}`, key: "scaleLabel", value: " " }, { regenerate: false }); }

  doc.graph.layout = {};
  doc.browser = { organisation: "by-discipline", expanded: ["Views", "Sheets"] };
  doc.regenerate();
  return doc;
}
