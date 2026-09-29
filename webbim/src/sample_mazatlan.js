//! Casa Mazatlan: a sample built from a real drawing set - the INAH submission for a house on the corner
//! of Melchor Ocampo and Guillermo Nelson in Mazatlan's historic centre (Alexander Peña de León, rev. 3,
//! 26/04/2023) - and the photographs of it built. An existing single-storey corner house of 400 mm masonry
//! with a moulded cornice keeps its two street facades (restored doors and windows, pale pink lime
//! render); inside, a new concrete frame and slab make a terracotta courtyard house: a central patio open
//! to the sky with green steel glazed doors round it, a studio on the upper floor, a roof terrace with a
//! pool, and the car in the open patio on the north-west.
//!
//! Coordinates in mm: x east from grid A (the Guillermo Nelson facade), y north from grid 5 (the Melchor
//! Ocampo facade). Grids A-D: 0, 4475, 9600, 13450; grids 5-1: 0, 3700, 5050, 10150, 14570. Heights
//! from the drawing's bench mark (0): sidewalk -1300 (Melchor Ocampo) to -900 (the corner), Planta Baja 2
//! -693, Planta Baja 1 -170, Planta Alta 2330, Techo 4730; the facades stand 5650 from the sidewalk to
//! +4350. Every sheet of the set (A001-A904, 17 sheets, A3) is here, in its title band.

import { newDocument } from "./bim.js";
import { Editor } from "./ops.js";
import { clone } from "./ocaf.js";
import { VS_CONSTRUCTION } from "./library.js";

const GREEN = "#2f8a6c";          // the steel of the doors and windows
export function buildMazatlanSample() {
  const doc = newDocument("Casa Mazatlan");
  doc.meta.project = { number: "001", address: "Melchor Ocampo\nEsquina Guillermo Nelson\nMazatlan", client: "Torres Hernandez", author: "Alexander Peña de Leon",
    drafted: "Author", checked: "Checker", issued: "26/04/2023", notes: "No tomar cotas del dibujo.\nContratista comprobar\ndimensiones en obra.", revisions: "Reviciones para esta entrega señaladas con nube" };
  const ed = new Editor(doc);
  const add = (element) => { const r = ed.apply({ op: "add", element }, { regenerate: false }); if (!r.ok) throw new Error(`${element.id || element.type}: ${r.error}`); return r.id; };
  const line = (a, b) => ({ type: "line", start: a, end: b });
  const L = doc.lib;

  // ---------------------------------------------------------------- materials and types of this house
  Object.assign(L.materials, {
    "M-MZ-ROSA": { name: "Aplanado de cal, rosa", mark: "AP-01", description: "Lime render, pale pink (the street facades)", cut: { pattern: "P-PLASTER", pen: "thin", lineColour: "#1b1f24", background: "#fbe9e3" }, projection: { pen: "hairline" }, shading: { colour: "#f1d5ca" } },
    "M-MZ-TERRA": { name: "Aplanado de cal, terracota", mark: "AP-02", description: "Lime render pigmented terracotta (the courtyard)", cut: { pattern: "P-PLASTER", pen: "thin", lineColour: "#1b1f24", background: "#f3d2c4" }, projection: { pen: "hairline" }, shading: { colour: "#d98468" } },
    "M-MZ-LADRILLO": { name: "Mampostería existente", mark: "MA-01", description: "Existing brick and stone masonry", cut: { pattern: "P-BRICK", pen: "heavy", lineColour: "#1b1f24", background: "#8e8e8e" }, projection: { pen: "thin" }, shading: { colour: "#b87a62" } },
    "M-MZ-BLOCK": { name: "Block de concreto", mark: "MA-02", description: "New concrete block, rendered", cut: { pattern: "P-CONC", pen: "heavy", lineColour: "#1b1f24", background: "#f2c9c0" }, projection: { pen: "thin" }, shading: { colour: "#d98468" } },
    "M-MZ-BARRO": { name: "Piso de barro en espiga", mark: "PI-01", description: "Handmade clay tile, herringbone", cut: { pattern: null, pen: "thin", lineColour: "#1b1f24", background: "#e7b59c" }, projection: { pen: "hairline" }, shading: { colour: "#b8613f" } },
    "M-MZ-GRAVA": { name: "Grava", mark: "PI-02", description: "Crushed stone, loose", cut: { pattern: null, pen: "thin", lineColour: "#1b1f24", background: "#dcd8d2" }, projection: { pen: "hairline" }, shading: { colour: "#8f8984" } },
    "M-MZ-ACERO": { name: "Acero pintado verde", mark: "AC-01", description: "Steel sections, painted green", cut: { pattern: null, pen: "medium", lineColour: "#1b1f24", background: GREEN }, projection: { pen: "thin" }, shading: { colour: GREEN } },
    "M-MZ-CELOSIA": { name: "Celosía de ladrillo", mark: "CE-01", description: "Brick lattice, laid open", cut: { pattern: "P-BRICK", pen: "thin", lineColour: "#1b1f24", background: "#e5a488" }, projection: { pen: "thin" }, shading: { colour: "#b5613d" } },
    "M-MZ-GRIS": { name: "Moldura gris", mark: "AP-03", description: "Lime render, grey (door and window surrounds, plinth)", cut: { pattern: null, pen: "thin", lineColour: "#1b1f24", background: "#e3e3e3" }, projection: { pen: "hairline" }, shading: { colour: "#dddbd7" } },
  });
  const wt = (name, mark, layers, fn) => ({ family: "F-BASICWALL", name, mark, layers, coreStart: layers.length > 1 ? 1 : 0, coreEnd: layers.length > 1 ? layers.length - 1 : 1, params: { Function: fn } });
  Object.assign(L.types, {
    // the street walls: pink lime render outside, terracotta inside
    "T-MZ-FACHADA400": wt("Muro existente 400, fachada", "MF1", [{ function: "Finish 2", thickness: 20, material: "M-MZ-ROSA" }, { function: "Structure", thickness: 360, material: "M-MZ-LADRILLO" }, { function: "Finish 1", thickness: 20, material: "M-MZ-TERRA" }], "Exterior"),
    "T-MZ-COLIND400": wt("Muro colindante 400", "MC1", [{ function: "Structure", thickness: 380, material: "M-MZ-LADRILLO" }, { function: "Finish 1", thickness: 20, material: "M-MZ-TERRA" }], "Exterior"),
    "T-MZ-COLIND280": wt("Muro colindante 280", "MC2", [{ function: "Structure", thickness: 260, material: "M-MZ-LADRILLO" }, { function: "Finish 1", thickness: 20, material: "M-MZ-TERRA" }], "Exterior"),
    "T-MZ-EXIST450": wt("Muro interior existente 450", "MI1", [{ function: "Finish 1", thickness: 20, material: "M-MZ-TERRA" }, { function: "Structure", thickness: 410, material: "M-MZ-LADRILLO" }, { function: "Finish 1", thickness: 20, material: "M-MZ-TERRA" }], "Interior"),
    "T-MZ-EXIST400": wt("Muro interior existente 400", "MI2", [{ function: "Finish 1", thickness: 20, material: "M-MZ-TERRA" }, { function: "Structure", thickness: 360, material: "M-MZ-LADRILLO" }, { function: "Finish 1", thickness: 20, material: "M-MZ-TERRA" }], "Interior"),
    "T-MZ-EXIST200": wt("Muro interior existente 200", "MI3", [{ function: "Finish 1", thickness: 15, material: "M-MZ-TERRA" }, { function: "Structure", thickness: 170, material: "M-MZ-LADRILLO" }, { function: "Finish 1", thickness: 15, material: "M-MZ-TERRA" }], "Interior"),
    "T-MZ-BLOCK300": wt("Muro nuevo 300", "MN1", [{ function: "Finish 1", thickness: 15, material: "M-MZ-TERRA" }, { function: "Structure", thickness: 270, material: "M-MZ-BLOCK" }, { function: "Finish 1", thickness: 15, material: "M-MZ-TERRA" }], "Interior"),
    "T-MZ-BLOCK150": wt("Muro nuevo 150", "MN2", [{ function: "Finish 1", thickness: 15, material: "M-MZ-TERRA" }, { function: "Structure", thickness: 120, material: "M-MZ-BLOCK" }, { function: "Finish 1", thickness: 15, material: "M-MZ-TERRA" }], "Interior"),
    "T-MZ-CANCEL": wt("Cancelería de acero verde", "CA1", [{ function: "Structure", thickness: 50, material: "M-GLASS" }], "Exterior"),
    "T-MZ-BARANDAL": wt("Barandal de vidrio 1000", "BA1", [{ function: "Structure", thickness: 20, material: "M-GLASS" }], "Exterior"),
    // green steel: glazed doors with glazing bars, windows with mullions and transoms
    "T-MZ-PV1100": { family: "F-SINGLEDOOR", name: "Puerta de acero verde 1100×2300", mark: "PA1", width: 1100, height: 2300, leafThickness: 40, frame: 40, glazed: true, bars: { cols: 2, rows: 6, width: 40 }, frameColour: GREEN },
    "T-MZ-PV1400": { family: "F-SINGLEDOOR", name: "Puerta de acero verde 1400×2300", mark: "PA2", width: 1400, height: 2300, leafThickness: 40, frame: 40, glazed: true, bars: { cols: 2, rows: 6, width: 40 }, frameColour: GREEN },
    "T-MZ-PV1900": { family: "F-SINGLEDOOR", name: "Puerta doble de acero verde 1900×2300", mark: "PA3", width: 1900, height: 2300, leafThickness: 40, frame: 40, glazed: true, bars: { cols: 2, rows: 6, width: 40 }, frameColour: GREEN },
    "T-MZ-PP1250": { family: "F-SINGLEDOOR", name: "Puerta plegable de acero verde 1250×2400", mark: "PA4", width: 1250, height: 2400, leafThickness: 40, frame: 40, glazed: true, bars: { cols: 2, rows: 8, width: 40 }, frameColour: GREEN },
    "T-MZ-PP900": { family: "F-SINGLEDOOR", name: "Puerta plegable de acero verde 900×2400", mark: "PA6", width: 900, height: 2400, leafThickness: 40, frame: 40, glazed: true, bars: { cols: 2, rows: 8, width: 40 }, frameColour: GREEN },
    "T-MZ-PV900": { family: "F-SINGLEDOOR", name: "Puerta de acero verde 900×2100", mark: "PA5", width: 900, height: 2100, leafThickness: 40, frame: 40, glazed: true, bars: { cols: 2, rows: 5, width: 40 }, frameColour: GREEN },
    "T-MZ-P900": { family: "F-SINGLEDOOR", name: "Puerta de madera 900×2100", mark: "PM1", width: 900, height: 2100, leafThickness: 44, frame: 40, panelColour: "#8b5a3c" },
    "T-MZ-PR1100": { family: "F-SINGLEDOOR", name: "Puerta restaurada de madera 1100", mark: "PR1", width: 1100, height: 2450, leafThickness: 50, frame: 60, panelColour: "#6d4a33", frameColour: "#e3e3e3" },
    "T-MZ-V1700": { family: "F-CASEMENT", name: "Ventana de acero verde 1700×1500", mark: "VA1", width: 1700, height: 1500, frame: 40, mullions: 3, transoms: 4, frameColour: GREEN },
    "T-MZ-V900": { family: "F-CASEMENT", name: "Ventana de acero verde 900×1700", mark: "VA2", width: 900, height: 1700, frame: 40, mullions: 1, transoms: 4, frameColour: GREEN },
    "T-MZ-VR1100": { family: "F-CASEMENT", name: "Ventana restaurada 1100", mark: "VR1", width: 1100, height: 2100, frame: 60, mullions: 1, transoms: 2, frameColour: "#6d4a33" },
    "T-MZ-VR2200": { family: "F-CASEMENT", name: "Ventana restaurada 2200", mark: "VR2", width: 2200, height: 2000, frame: 60, mullions: 3, transoms: 2, frameColour: "#6d4a33" },
    "T-MZ-VR1200": { family: "F-CASEMENT", name: "Ventana restaurada con arco 1200", mark: "VR3", width: 1180, height: 1900, frame: 60, mullions: 1, transoms: 1, frameColour: "#6d4a33" },
    "T-MZ-COL300": { family: "F-RCCOLUMN", name: "Castillo de concreto 300×300", mark: "K1", width: 300, depth: 300, material: "M-CONC" },
    "T-MZ-BARRO": { family: "F-FLOOR", name: "Barro en espiga 20 + mortero 30 + firme 100", mark: "PB1",
      layers: [{ function: "Finish 1", thickness: 20, material: "M-MZ-BARRO" }, { function: "Finish 2", thickness: 30, material: "M-SCREED" }, { function: "Structure", thickness: 100, material: "M-CONC" }], coreStart: 2, coreEnd: 3 },
    "T-MZ-GRAVA": { family: "F-FLOOR", name: "Grava 80 sobre terreno", mark: "PB2", layers: [{ function: "Finish 1", thickness: 80, material: "M-MZ-GRAVA" }, { function: "Structure", thickness: 70, material: "M-CONC" }], coreStart: 1, coreEnd: 2 },
    "T-MZ-LOSA": { family: "F-FLOOR", name: "Losa de concreto 150 + ladrillo de azotea 20", mark: "LO1",
      layers: [{ function: "Finish 1", thickness: 20, material: "M-MZ-BARRO" }, { function: "Structure", thickness: 150, material: "M-CONC" }, { function: "Finish 2", thickness: 10, material: "M-PLAS" }], coreStart: 1, coreEnd: 2 },
    "T-MZ-BANQUETA": { family: "F-FLOOR", name: "Banqueta de concreto 150", mark: "BQ1", layers: [{ function: "Structure", thickness: 150, material: "M-CONC" }], coreStart: 0, coreEnd: 1 },
  });
  // the drawing set's own view style: existing walls grey, new structure red (as its legend)
  L.viewStyles["VS-MZ"] = Object.assign(clone(VS_CONSTRUCTION), { name: "Casa Mazatlan - propuesta" });
  L.viewStyles["VS-MZ"].rules = [
    { id: "MZ-NEW", when: { all: [{ param: "Phase", is: "New" }, { any: [{ param: "Category", is: "IfcColumn" }, { param: "TypeMark", is: "MN1" }, { param: "TypeMark", is: "MN2" }] }] }, then: { cut: { fill: "#ff0000", pattern: "solid" } } },
    { id: "MZ-EXIST", when: { all: [{ param: "Phase", is: "Existing" }, { param: "Category", is: "IfcWall" }] }, then: { cut: { fill: "#808080", pattern: "solid" } } },
  ];
  L.viewStyles["VS-MZ-EXIST"] = Object.assign(clone(VS_CONSTRUCTION), { name: "Casa Mazatlan - existente" });
  L.viewStyles["VS-MZ-EXIST"].rules = [{ id: "MZ-HIDE-NEW", when: { param: "Phase", is: "New" }, then: { visible: false } }];

  // ---------------------------------------------------------------- levels and grids
  const level = (id, name, z) => add({ id, type: "Level", name, args: { name, elevation: z } });
  level("L-BQ", "Banqueta Melchor Ocampo", -1300); level("L-PB2", "Planta Baja 2", -693); level("L-PB1", "Planta Baja 1", -170);
  level("L-BN", "Banco de nivel", 0); level("L-PA", "Planta Alta", 2330); level("L-T", "Techo", 4730);
  const GX = [0, 4475, 9600, 13450], GY = [["1", 14570], ["2", 10150], ["3", 5050], ["4", 3700], ["5", 0]];
  GX.forEach((x, i) => add({ id: `G-${"ABCD"[i]}`, type: "Grid", name: `Grid ${"ABCD"[i]}`, args: { name: "ABCD"[i], line: line([x, -2500], [x, 17500]) } }));
  GY.forEach(([n, y]) => add({ id: `G-${n}`, type: "Grid", name: `Grid ${n}`, args: { name: n, line: line([16500, y], [-3000, y]) } }));

  // ---------------------------------------------------------------- walls
  const wall = (id, name, a, b, type, base, off, h, phase, extra = {}) => add({ id, type: "Wall", name, args: Object.assign({ centreline: line(a, b), mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: base }, baseOffset: off, height: h, flipped: false }, extra), params: { Phase: phase } });
  // the existing house: two street facades to +4350, the party walls to the new roof
  wall("W-S", "Fachada Melchor Ocampo", [13451, -4], [1, -4], "T-MZ-FACHADA400", "L-BQ", 0, 5650, "Existing");
  wall("W-O", "Fachada Guillermo Nelson", [1, -4], [1, 14427], "T-MZ-FACHADA400", "L-BQ", 0, 5650, "Existing");
  wall("W-N", "Colindancia norte", [1, 14427], [13451, 14427], "T-MZ-COLIND280", "L-BQ", 0, 6030, "Existing");
  wall("W-E", "Colindancia oriente", [13451, 14427], [13451, -4], "T-MZ-COLIND400", "L-BQ", 0, 6030, "Existing");
  // existing interior walls
  wall("W-I1", "Muro patio / habitación", [200, 10145], [4222, 10145], "T-MZ-EXIST450", "L-PB1", 0, 2500, "Existing");
  wall("W-I2", "Muro habitación / patio central", [4222, 10145], [4222, 5045], "T-MZ-EXIST400", "L-PB2", 0, 3023, "Existing");
  wall("W-I3", "Muro habitación / pasillo", [200, 5045], [4222, 5045], "T-MZ-EXIST400", "L-PB2", 0, 3023, "Existing");
  wall("W-I5", "Muro pasillo / patio central", [4222, 5045], [6601, 5045], "T-MZ-EXIST400", "L-PB2", 0, 3023, "Existing");
  wall("W-I7", "Muro habitación doctores / baño", [4270, 196], [4270, 3497], "T-MZ-EXIST200", "L-PB2", 0, 3023, "Existing");
  wall("W-I8", "Muro baño / pasillo", [6500, 196], [6500, 3497], "T-MZ-EXIST200", "L-PB2", 0, 3023, "Existing");
  // the new work: the wall along grid 4, the courtyard's north wall, the stair core, the studio
  wall("W-N4", "Muro eje 4", [200, 3647], [13252, 3647], "T-MZ-BLOCK300", "L-PB2", 0, 3023, "New");
  wall("W-N9", "Muro pasillo / habitación huésped", [8652, 3497], [8652, 196], "T-MZ-BLOCK300", "L-PB2", 0, 3023, "New");
  wall("W-N6", "Muro norte del patio central", [4222, 10146], [9275, 10146], "T-MZ-BLOCK150", "L-PB2", 0, 3023, "New");
  wall("W-K1", "Muro cocina poniente", [5900, 10146], [5900, 14287], "T-MZ-BLOCK150", "L-PB1", 0, 2500, "New");
  wall("W-K2", "Muro escalera norte", [5900, 12608], [9275, 12608], "T-MZ-BLOCK150", "L-PB1", 0, 2500, "New");
  wall("W-K3", "Muro escalera oriente", [9275, 12608], [9275, 10146], "T-MZ-BLOCK150", "L-PB1", 0, 2500, "New");
  // the courtyard's glass: green steel folding doors to the living room (east) and to the corridor (south)
  wall("W-GE", "Cancel patio oriente", [8652, 5045], [8652, 10146], "T-MZ-CANCEL", "L-PB2", 0, 3023, "New");
  wall("W-GS", "Cancel patio sur", [6601, 5045], [8652, 5045], "T-MZ-CANCEL", "L-PB2", 0, 3023, "New");
  // upper floor: the studio
  wall("W-U1", "Muro estudio sur", [5900, 10146], [13252, 10146], "T-MZ-BLOCK150", "L-PA", 0, 2400, "New");
  wall("W-U2", "Muro estudio poniente", [5900, 10146], [5900, 14287], "T-MZ-BLOCK150", "L-PA", 0, 2400, "New");
  wall("W-U3", "Muro escalera norte (alta)", [5900, 12608], [9275, 12608], "T-MZ-BLOCK150", "L-PA", 0, 2400, "New");
  wall("W-U4", "Muro escalera oriente (alta)", [9275, 12608], [9275, 10146], "T-MZ-BLOCK150", "L-PA", 0, 2400, "New");
  wall("W-U5", "Muro baño estudio", [5900, 11434], [7350, 11434], "T-MZ-BLOCK150", "L-PA", 0, 2400, "New");
  // the stair's roof hut, 1805 above the roof
  wall("W-H1", "Casetón sur", [5900, 11434], [8269, 11434], "T-MZ-BLOCK150", "L-T", 0, 1805, "New");
  wall("W-H2", "Casetón oriente", [8269, 11434], [8269, 12608], "T-MZ-BLOCK150", "L-T", 0, 1805, "New");
  wall("W-H3", "Casetón norte", [8269, 12608], [5900, 12608], "T-MZ-BLOCK150", "L-T", 0, 1805, "New");
  wall("W-H4", "Casetón poniente", [5900, 12608], [5900, 11434], "T-MZ-BLOCK150", "L-T", 0, 1805, "New");
  // the roof terrace: a steel railing round the courtyard's void, and round the open patio
  wall("W-B1", "Barandal patio sur", [4422, 5245], [8452, 5245], "T-MZ-BARANDAL", "L-PA", 0, 1000, "New");
  wall("W-B2", "Barandal patio oriente", [8452, 5245], [8452, 10000], "T-MZ-BARANDAL", "L-PA", 0, 1000, "New");
  wall("W-B3", "Barandal patio abierto", [200, 10370], [4422, 10370], "T-MZ-BARANDAL", "L-PA", 0, 1000, "New");
  ed.apply({ op: "autojoin", ends: ["W-S", "W-O", "W-N", "W-E", "W-I1", "W-I2", "W-I3", "W-I5", "W-N6", "W-K1", "W-K2", "W-K3", "W-U1", "W-U2", "W-U3", "W-U4", "W-H1", "W-H2", "W-H3", "W-H4", "W-GE", "W-GS", "W-N4", "W-N9", "W-I7", "W-I8"].flatMap(id => [{ id, end: "start" }, { id, end: "end" }]) }, { regenerate: false });

  // ---------------------------------------------------------------- openings, doors and windows
  const op = (id, host, at, w, sill, h) => add({ id, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at, sill, w, h }, farProfile: null, depth: "through" }, params: { Phase: "Existing" } });
  const door = (id, opId, type, mark, extra = {}) => add({ id, type: "Door", args: Object.assign({ fills: { ref: opId }, doorType: { ref: type }, flipHand: false, flipFacing: false, clearance: "None" }, extra), params: { Phase: "New", Mark: mark } });
  const win = (id, opId, type, mark) => add({ id, type: "Window", args: { fills: { ref: opId }, windowType: { ref: type } }, params: { Phase: "New", Mark: mark } });
  // Melchor Ocampo (the south facade; the wall runs east to west, u from x = 13451): heights from the sidewalk
  const us = x => 13451 - x;
  op("OP-S1", "W-S", us(1170), 1100, 410, 2450); door("D-S1", "OP-S1", "T-MZ-PR1100", "P01");
  op("OP-S2", "W-S", us(3503), 1100, 875, 2100); win("WN-S2", "OP-S2", "T-MZ-VR1100", "V01");
  op("OP-S3", "W-S", us(7521), 1100, 494, 2450); door("D-S3", "OP-S3", "T-MZ-PR1100", "P02");
  op("OP-S4", "W-S", us(10986), 2200, 960, 2000); win("WN-S4", "OP-S4", "T-MZ-VR2200", "V02");
  // Guillermo Nelson (the west facade, south to north, u from y = -4)
  const uw = y => y + 4;
  op("OP-O1", "W-O", uw(1250), 1100, 350, 2450); door("D-O1", "OP-O1", "T-MZ-PR1100", "P03");
  op("OP-O2", "W-O", uw(7622), 1180, 1210, 1900); win("WN-O2", "OP-O2", "T-MZ-VR1200", "V03");
  op("OP-O3", "W-O", uw(12400), 3000, 1130, 2300);                 // the widened opening to the patio: the car comes in here
  // the street doors and windows are the house's own, restored: existing
  for (const id of ["D-S1", "D-S3", "D-O1", "WN-S2", "WN-S4", "WN-O2"]) ed.apply({ op: "set", id, key: "params.Phase", value: "Existing" }, { regenerate: false });
  // inside
  const u = (x, x0) => Math.abs(x - x0);
  op("OP-I1", "W-I1", u(2200, 200), 1400, 0, 2300); door("D-I1", "OP-I1", "T-MZ-PV1400", "P04");
  op("OP-I2", "W-I2", u(8860, 10145), 1100, 0, 2300); door("D-I2", "OP-I2", "T-MZ-PV1100", "P05");
  op("OP-I3", "W-I3", u(3524, 200), 900, 0, 2100); door("D-I3", "OP-I3", "T-MZ-P900", "P06", { flipFacing: true });
  op("OP-N4a", "W-N4", u(3524, 200), 900, 0, 2100); door("D-N4a", "OP-N4a", "T-MZ-P900", "P07");
  op("OP-N4b", "W-N4", u(4889, 200), 900, 0, 2100); door("D-N4b", "OP-N4b", "T-MZ-P900", "P08");
  op("OP-N4c", "W-N4", u(7546, 200), 1900, 0, 2300); door("D-N4c", "OP-N4c", "T-MZ-PV1900", "P09", { operation: "Double" });
  op("OP-N9", "W-N9", u(950, 3497), 900, 0, 2100); door("D-N9", "OP-N9", "T-MZ-P900", "P10");
  op("OP-N6", "W-N6", u(7550, 4222), 1700, 800, 1500); win("WN-N6", "OP-N6", "T-MZ-V1700", "V04");
  op("OP-K1a", "W-K1", u(13240, 10146), 900, 0, 2100); door("D-K1a", "OP-K1a", "T-MZ-PV900", "P11");
  op("OP-K1b", "W-K1", u(11000, 10146), 900, 0, 2100); door("D-K1b", "OP-K1b", "T-MZ-PV900", "P12");
  // the courtyard's folding doors: four to the living room, two to the corridor
  [5700, 6950, 8200, 9450].forEach((y, i) => { op(`OP-GE${i + 1}`, "W-GE", u(y, 5045), 1250, 0, 2400); door(`D-GE${i + 1}`, `OP-GE${i + 1}`, "T-MZ-PP1250", `PP${i + 1}`, { flipHand: i % 2 === 1, flipFacing: true }); });
  [7131, 8121].forEach((x, i) => { op(`OP-GS${i + 1}`, "W-GS", u(x, 6601), 900, 0, 2400); door(`D-GS${i + 1}`, `OP-GS${i + 1}`, "T-MZ-PP900", `PP${i + 5}`, { flipHand: i % 2 === 1 }); });
  // the studio: sliding glass to the terrace, windows over the open patio
  [9950, 11250, 12550].forEach((x, i) => { op(`OP-U1${i + 1}`, "W-U1", u(x, 5900), 1250, 0, 2250); door(`D-U1${i + 1}`, `OP-U1${i + 1}`, "T-MZ-PP1250", `PE${i + 1}`, { flipHand: i % 2 === 1 }); });
  op("OP-U2a", "W-U2", u(13487, 10146), 900, 400, 1700); win("WN-U2a", "OP-U2a", "T-MZ-V900", "V05");
  op("OP-U2b", "W-U2", u(10765, 10146), 900, 400, 1700); win("WN-U2b", "OP-U2b", "T-MZ-V900", "V06");
  op("OP-H1", "W-H1", u(7700, 5900), 900, 0, 1750); door("D-H1", "OP-H1", "T-MZ-P900", "P13");

  // ---------------------------------------------------------------- structure: the new frame's columns
  let c = 0;
  for (const [x, y] of [[350, 10145], [4220, 10145], [350, 5044], [4220, 5044], [350, 342], [4220, 342], [8660, 342], [8652, 10146], [13252, 10146]])
    add({ id: `K${++c}`, type: "Column", name: `Castillo K${c}`, args: { position: [x, y], columnType: { ref: "T-MZ-COL300" }, baseLevel: { ref: "L-PB2" }, height: 2330 + 693, rotation: 0 }, params: { Mark: `K${c}`, Phase: "New" } });

  // ---------------------------------------------------------------- floors, slabs, the courtyard
  const floor = (id, name, boundary, type, lev, off = 0, phase = "New") => add({ id, type: "Floor", name, args: { boundary, floorType: { ref: type }, level: { ref: lev }, heightOffset: off }, params: { Phase: phase } });
  const R = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  floor("FL-PATIO", "Patio abierto (cochera)", R(200, 10370, 5825, 14287), "T-MZ-BARRO", "L-PB1");
  floor("FL-COCINA", "Cocina y comedor", R(5975, 10221, 13252, 14287), "T-MZ-BARRO", "L-PB1");
  floor("FL-SALA", "Sala", R(8727, 3797, 13252, 10071), "T-MZ-BARRO", "L-PB2", -20);
  floor("FL-HAB2", "Habitación 2", R(200, 5245, 4022, 9920), "T-MZ-BARRO", "L-PB1", -350);
  floor("FL-PASILLO", "Pasillo", R(200, 3797, 8577, 4845), "T-MZ-BARRO", "L-PB2");
  floor("FL-PATIOC", "Patio central", R(4422, 5245, 8577, 10071), "T-MZ-GRAVA", "L-PB2", -20);
  floor("FL-SUR", "Habitaciones sur", R(200, 196, 13252, 3497), "T-MZ-BARRO", "L-PB2");
  // the new slab at +2330: the whole house but the courtyard, the open patio and the stair
  floor("FL-PA1", "Losa planta alta - sur", R(200, 196, 13252, 5245), "T-MZ-LOSA", "L-PA");
  floor("FL-PA2", "Losa planta alta - poniente", R(200, 5245, 4422, 10370), "T-MZ-LOSA", "L-PA");
  floor("FL-PA3", "Losa planta alta - oriente", R(8577, 5245, 13252, 10146), "T-MZ-LOSA", "L-PA");
  floor("FL-PA4", "Losa estudio", R(5900, 10146, 13252, 14287), "T-MZ-LOSA", "L-PA");
  floor("FL-T", "Losa techo estudio", R(5825, 10071, 13252, 14287), "T-MZ-LOSA", "L-T");
  floor("FL-CASETON", "Techo casetón", R(5825, 11359, 8344, 12683), "T-MZ-LOSA", "L-T", 1805);
  // the sidewalks: Melchor Ocampo at -1300; Guillermo Nelson climbing north from the corner
  floor("FL-BQ-S", "Banqueta Melchor Ocampo", R(-2300, -2300, 15500, -204), "T-MZ-BANQUETA", "L-BQ", 0, "Existing");
  [[-2300, -204, 3000, -900], [3000, 6000, 9000, -520], [9000, 12000, 16500, -170], [12000, 16500, 16500, 0]].slice(0, 3).forEach(([y0, y1, , z], i) =>
    floor(`FL-BQ-O${i + 1}`, `Banqueta Guillermo Nelson ${i + 1}`, R(-2300, y0, -198, y1), "T-MZ-BANQUETA", "L-BN", z, "Existing"));

  // ---------------------------------------------------------------- the rest: stairs, pool, cornice, surrounds, lattice
  const gen = (id, name, boundary, lev, base, h, material, cls = "IfcBuildingElementProxy", colour = "", phase = "New") =>
    add({ id, type: "Generic", name, args: { boundary, level: { ref: lev }, baseOffset: base, height: h, ifcClass: cls, material, colour }, params: { Phase: phase } });
  // the straight stair in the core: 12 risers from +(-170) to +2330, then 12 more up to the roof
  for (let i = 0; i < 12; i++) gen(`ST${i + 1}`, `Escalón ${i + 1}`, R(6150 + 250 * i, 11584, 6400 + 250 * i, 12533), "L-PB1", 0, 208 * (i + 1), "M-CONC", "IfcStair");
  for (let i = 0; i < 12; i++) gen(`SU${i + 1}`, `Escalón azotea ${i + 1}`, R(9025 - 250 * (i + 1), 11584, 9025 - 250 * i, 12533), "L-PA", 0, 200 * (i + 1), "M-CONC", "IfcStair");
  // the spiral stair in the courtyard, from the gravel to the terrace: 14 wedges round a steel post
  const sc = [5130, 9380], rOut = 700, n = 14, rise = (2330 + 713) / n;
  for (let i = 0; i < n; i++) {
    const a0 = (i * 26) * Math.PI / 180, a1 = ((i + 1) * 26) * Math.PI / 180, pts = [[sc[0] + 70 * Math.cos((a0 + a1) / 2), sc[1] + 70 * Math.sin((a0 + a1) / 2)]];
    for (let k = 0; k <= 4; k++) { const a = a0 + (a1 - a0) * k / 4; pts.push([Math.round(sc[0] + rOut * Math.cos(a)), Math.round(sc[1] + rOut * Math.sin(a))]); }
    gen(`SE${i + 1}`, `Escalera helicoidal ${i + 1}`, pts, "L-PB2", -20 + rise * i, 40, "M-MZ-ACERO", "IfcStair", GREEN);
  }
  const circ = (cx, cy, r, k = 16) => Array.from({ length: k }, (_, i) => [Math.round(cx + r * Math.cos(i / k * 2 * Math.PI)), Math.round(cy + r * Math.sin(i / k * 2 * Math.PI))]);
  gen("SE-POSTE", "Poste de escalera helicoidal", circ(sc[0], sc[1], 60, 12), "L-PB2", -20, 3043 + 1000, "M-MZ-ACERO", "IfcMember", GREEN);
  // on the terrace: the pool and a round plunge pool
  gen("ALBERCA", "Alberca", R(4545, 2058, 11580, 3550), "L-PA", 0, 450, "M-WATER", "IfcBuildingElementProxy", "#4fb0d6");
  gen("CHAPOTEADERO", "Chapoteadero", circ(5352, 1650, 650, 20), "L-PA", 0, 450, "M-WATER", "IfcBuildingElementProxy", "#4fb0d6");
  // the railings' green steel top rails
  gen("PASAMANOS1", "Pasamanos sur", R(4422, 5220, 8477, 5270), "L-PA", 1000, 50, "M-MZ-ACERO", "IfcRailing", GREEN);
  gen("PASAMANOS2", "Pasamanos oriente", R(8427, 5245, 8477, 10000), "L-PA", 1000, 50, "M-MZ-ACERO", "IfcRailing", GREEN);
  gen("PASAMANOS3", "Pasamanos patio abierto", R(200, 10345, 4422, 10395), "L-PA", 1000, 50, "M-MZ-ACERO", "IfcRailing", GREEN);
  // the brick lattice over the courtyard's west wall (the terrace parapet), as in the photographs
  gen("CELOSIA-O", "Celosía de ladrillo, poniente", R(4122, 5145, 4322, 10070), "L-PA", 0, 1100, "M-MZ-CELOSIA", "IfcBuildingElementProxy", "#b5613d");
  gen("CELOSIA-N", "Celosía de ladrillo, norte del patio", R(4322, 9996, 5825, 10196), "L-PA", 0, 1100, "M-MZ-CELOSIA", "IfcBuildingElementProxy", "#b5613d");
  // the cornice: three stepped courses along both street facades, +3200 to +3650
  const corn = [[3200, 3350, 120], [3350, 3500, 220], [3500, 3650, 320]];
  corn.forEach(([z0, z1, p], i) => {
    gen(`CO-S${i + 1}`, `Cornisa Melchor Ocampo ${i + 1}`, R(-198 - p, -204 - p, 13650, -204), "L-BN", z0, z1 - z0, "M-MZ-GRIS", "IfcBuildingElementProxy", "", "Existing");
    gen(`CO-O${i + 1}`, `Cornisa Guillermo Nelson ${i + 1}`, R(-198 - p, -204, -198, 14566), "L-BN", z0, z1 - z0, "M-MZ-GRIS", "IfcBuildingElementProxy", "", "Existing");
  });
  // the grey surrounds of the street openings and the plinth of Melchor Ocampo
  const surroundS = (x, w, z0, z1) => { const t = 250, y0 = -234, y1 = -204;
    gen(`MS-${x}a`, "Moldura", R(x - w / 2 - t, y0, x - w / 2, y1), "L-BN", z0, z1 - z0 + t, "M-MZ-GRIS", "IfcBuildingElementProxy", "", "Existing");
    gen(`MS-${x}b`, "Moldura", R(x + w / 2, y0, x + w / 2 + t, y1), "L-BN", z0, z1 - z0 + t, "M-MZ-GRIS", "IfcBuildingElementProxy", "", "Existing");
    gen(`MS-${x}c`, "Moldura", R(x - w / 2 - t - 60, y0 - 20, x + w / 2 + t + 60, y1), "L-BN", z1, t + 80, "M-MZ-GRIS", "IfcBuildingElementProxy", "", "Existing"); };
  surroundS(1170, 1100, -890, 1160); surroundS(3503, 1100, -425, 1675); surroundS(7521, 1100, -806, 1644); surroundS(10986, 2200, -340, 1660);
  gen("ZOCALO-S", "Zócalo Melchor Ocampo", R(260, -224, 13650, -204), "L-BQ", 0, 1130, "M-MZ-GRIS", "IfcBuildingElementProxy", "", "Existing");
  const surroundO = (y, w, z0, z1) => { const t = 250, x0 = -228, x1 = -198;
    gen(`MO-${y}a`, "Moldura", R(x0, y - w / 2 - t, x1, y - w / 2), "L-BN", z0, z1 - z0 + t, "M-MZ-GRIS", "IfcBuildingElementProxy", "", "Existing");
    gen(`MO-${y}b`, "Moldura", R(x0, y + w / 2, x1, y + w / 2 + t), "L-BN", z0, z1 - z0 + t, "M-MZ-GRIS", "IfcBuildingElementProxy", "", "Existing");
    gen(`MO-${y}c`, "Moldura", R(x0 - 20, y - w / 2 - t - 60, x1, y + w / 2 + t + 60), "L-BN", z1, t + 80, "M-MZ-GRIS", "IfcBuildingElementProxy", "", "Existing"); };
  surroundO(1250, 1100, -950, 1500); surroundO(7622, 1180, -90, 1810); surroundO(12400, 3000, -170, 2130);
  // stepping stones and a planter in the courtyard (the photographs)
  gen("PASO1", "Losa de paso", R(5300, 6000, 6300, 6700), "L-PB2", -20, 60, "M-MZ-TERRA", "IfcSlab", "#d98468");
  gen("PASO2", "Losa de paso", R(6600, 7200, 7900, 7800), "L-PB2", -20, 60, "M-MZ-TERRA", "IfcSlab", "#d98468");
  gen("PASO3", "Losa de paso", R(5600, 8100, 6700, 8800), "L-PB2", -20, 60, "M-MZ-TERRA", "IfcSlab", "#d98468");
  gen("JARDINERA", "Jardinera", R(6700, 9300, 8500, 9950), "L-PB2", -20, 450, "M-MZ-TERRA", "IfcBuildingElementProxy", "#d98468");

  // ---------------------------------------------------------------- rooms and furniture
  // the open plan divided where the drawing names its rooms: kitchen from dining, corridor from living room
  add({ id: "RS1", type: "RoomSeparator", args: { line: line([9275, 12608], [9275, 14287]), level: { ref: "L-PB1" } } });
  add({ id: "RS2", type: "RoomSeparator", args: { line: line([8652, 3797], [8652, 5045]), level: { ref: "L-PB2" } } });
  add({ id: "RS3", type: "RoomSeparator", args: { line: line([9275, 10146], [13252, 10146]), level: { ref: "L-PB2" } } });
  const space = (id, name, lev, anchor, number, h) => add({ id, type: "Space", name, args: { level: { ref: lev }, upperLimit: { mode: "offset", offset: h }, anchor, boundaryAt: "finishFace" }, params: { Number: number, Department: "Residencial", Phase: "New" } });
  space("SP-01", "Patio abierto", "L-PB1", [2300, 12300], "01", 2500); space("SP-02", "Cocina", "L-PB1", [7500, 13500], "02", 2500);
  space("SP-03", "Comedor", "L-PB1", [11400, 12300], "03", 2500); space("SP-04", "Sala", "L-PB2", [10900, 7000], "04", 3000);
  space("SP-05", "Habitación 2", "L-PB1", [2100, 7600], "05", 2500); space("SP-06", "Pasillo", "L-PB2", [1500, 4300], "06", 3000);
  space("SP-07", "Patio central", "L-PB2", [6400, 7600], "07", 3000); space("SP-08", "Habitación doctores", "L-PB2", [2000, 1800], "08", 3000);
  space("SP-09", "Baño", "L-PB2", [5300, 1800], "09", 3000); space("SP-10", "Segunda entrada", "L-PB2", [7500, 1800], "10", 3000);
  space("SP-11", "Habitación huésped", "L-PB2", [11000, 1800], "11", 3000); space("SP-12", "Estudio", "L-PA", [11000, 12300], "12", 2400);
  const fu = (id, shape, at, size, rot, lev) => add({ id, type: "Furniture", args: { position: at, shape, size, rotation: rot, level: { ref: lev } }, params: { Phase: "New" } });
  fu("FU1", "Table", [11300, 12300], [2400, 1000], 0, "L-PB1"); fu("FU2", "Sofa", [12300, 7200], [2400, 900], 90, "L-PB2"); fu("FU3", "Table", [10800, 7200], [1000, 1000], 0, "L-PB2");
  fu("FU4", "Desk", [11300, 13400], [1800, 800], 0, "L-PA"); fu("FU5", "Table", [2200, 7400], [1600, 2000], 0, "L-PB1"); fu("FU6", "Table", [2000, 1800], [1600, 2000], 0, "L-PB2");
  fu("FU7", "Table", [11600, 1600], [1600, 2000], 0, "L-PB2");

  // ---------------------------------------------------------------- views
  const vr = (top, cut, bottom, depth) => ({ top, cut, bottom, depth });
  const plan = (id, name, lev, range, style = "VS-MZ", extra = {}) => add({ id, type: "PlanView", name, args: Object.assign({ level: { ref: lev }, scale: 100, viewRange: range, detailLevel: "Medium", style: { ref: style }, clip: { rect: [-3500, -3500, 17000, 18000], visible: false, active: true } }, extra) });
  plan("V-PB1", "Planta Baja 1", "L-PB1", vr(2300, 1200, -1300, -1300));
  plan("V-PA", "Planta Alta", "L-PA", vr(2300, 1200, -400, -400));
  plan("V-T", "Planta Techo", "L-T", vr(2300, 1200, -2500, -2500));
  plan("V-EX", "Planta existente", "L-PB1", vr(2300, 1200, -1300, -1300), "VS-MZ-EXIST", { clip: { rect: [-2500, -2500, 14500, 16000], visible: false, active: true } });
  plan("V-NOTAS", "Notas generales", "L-PB1", vr(2300, 1200, -1300, -1300), "VS-MZ", { clip: { rect: [30500, 4000, 60000, 25000], visible: false, active: true } });
  const elev = (id, name, a, b, depth, style = "VS-MZ", scale = 50) => add({ id, type: "ElevationView", name, args: { line: line(a, b), depth, scale, baseLevel: { ref: "L-BN" }, top: 7000, style: { ref: style }, detailLevel: "Medium", clip: { rect: null, visible: false, active: false } } });
  elev("V-E-GN", "Elevación Guillermo Nelson", [-3500, -1500], [-3500, 16000], 17000);
  elev("V-E-MO", "Elevación Sur", [15000, -3500], [-1500, -3500], 18000);
  elev("V-EX-GN", "Fachada Guillermo Nelson", [-3500, -700], [-3500, 15200], 17000, "VS-MZ-EXIST", 100);
  elev("V-EX-MO", "Fachada Melchor Ocampo", [14200, -3500], [-800, -3500], 18000, "VS-MZ-EXIST", 100);
  const sect = (id, name, a, b, depth) => add({ id, type: "SectionView", name, args: { line: line(a, b), depth, scale: 50, baseLevel: { ref: "L-BN" }, top: 7000, style: { ref: "VS-MZ" }, detailLevel: "Medium", clip: { rect: null, visible: false, active: false } } });
  // the six cuts of the set, placed where its plan puts them, looking the way its markers point
  sect("V-S1", "Section 1", [1321, -2500], [1321, 16500], 6000);
  sect("V-S2", "Section 2", [15500, 10906], [-2000, 10906], 4000);
  sect("V-S3", "Section 3", [6621, -2500], [6621, 16500], 3500);
  sect("V-S4", "Section 4", [5423, -2500], [5423, 16500], 3500);
  sect("V-S5", "Section 5", [10029, 16500], [10029, -2500], 5000);
  sect("V-S6", "Section 6", [15500, 5910], [-2000, 5910], 5000);
  const axo = (id, name, az, el, scale = 100) => add({ id, type: "View3D", name, args: { camera: { azimuth: az, elevation: el, target: [6700, 7200, 1500] }, scale, style: { ref: "VS-MZ" }, visualStyle: "Shaded" } });
  axo("V-3D-SO", "Perspectiva Sur-Oeste", 225, 18); axo("V-3D-UB", "Vista de ubicación", 225, 25, 250); axo("V-3D-SE", "Axo Sur-Este", 315, 30); axo("V-3D-SO2", "Axo Sur-Oeste", 225, 35); axo("V-3D-NE", "Axo Norte-Este", 45, 35);
  add({ id: "SC-P", type: "Schedule", name: "Cuadro de puertas", args: { of: "IfcDoor", fields: ["Mark", "TypeMark", "Width", "Height"] } });
  add({ id: "SC-L", type: "Schedule", name: "Cuadro de locales", args: { of: "IfcSpace", fields: ["Number", "Name", "Area"] } });

  // ---------------------------------------------------------------- annotation: people and the car, from the set's own drawings
  const figure = (id, sym, view, at) => add({ id, type: "SymbolInstance", args: { symbol: { ref: sym }, position: at, rotation: 0, view: { ref: view } } });
  // positions along each view as it reads, left to right (s), and heights from the bench mark
  figure("EN1", "SY-ENT-WOMAN1", "V-E-GN", [2600, -170]); figure("EN2", "SY-ENT-WOMAN2", "V-E-GN", [14700, -960]);
  figure("EN3", "SY-ENT-WALK", "V-S2", [9300, 2330]); figure("EN4", "SY-ENT-WALK", "V-S2", [13200, 2330]); figure("EN5", "SY-ENT-WALK", "V-S2", [8600, -170]);
  figure("EN6", "SY-ENT-CAR", "V-S2", [4300, -170]); figure("EN7", "SY-ENT-WALK", "V-S1", [8900, -520]);
  figure("EN8", "SY-ENT-WOMAN1", "V-E-MO", [5500, -1300]);
  // dimensions: the grid bays on the plans
  const dim = (id, a, b, offset, view) => add({ id, type: "Dimension", args: { of: [`${a}:line`, `${b}:line`], offset, view: { ref: view }, locked: false } });
  for (const v of ["V-PB1", "V-PA", "V-T"]) {
    // the grid lines start 2.5 m south of grid 5 and 16.5 m east of grid A: the strings stand clear of the walls, north and east as the set has them
    dim(`${v}-DX1`, "G-A", "G-B", -18700, v); dim(`${v}-DX2`, "G-B", "G-C", -18700, v); dim(`${v}-DX3`, "G-C", "G-D", -18700, v); dim(`${v}-DX`, "G-A", "G-D", -19400, v);
    dim(`${v}-DY1`, "G-1", "G-2", -1200, v); dim(`${v}-DY2`, "G-2", "G-3", -1200, v); dim(`${v}-DY3`, "G-3", "G-4", -1200, v); dim(`${v}-DY4`, "G-4", "G-5", -1200, v); dim(`${v}-DY`, "G-1", "G-5", -500, v);
  }
  // the general notes and the drawing index, set on their own sheet (A001), in a view kept for them
  const txt = (id, content, at, wrap = 90) => add({ id, type: "Text", args: { content, position: at, rotation: 0, textType: { ref: "TT-25" }, wrapWidth: wrap, leaders: [], view: { ref: "V-NOTAS" } } });
  txt("TX-N0", "NOTAS GENERALES", [31000, 24000]);
  txt("TX-N1", "TODOS LOS MATERIALES Y LAS PRÁCTICAS DE TRABAJO DEBERÁN CUMPLIR, ENTRE OTROS, CON EL REGLAMENTO DE CONSTRUCCION DEL MUNICIPIO DE MAZATLAN, Y TODAS LAS NORMAS MEXICANAS ACTUALES PERTINENTES (SEGÚN ENMIENDAS).", [31000, 22500]);
  txt("TX-N2", "TODAS LAS MEDIDAS Y NIVELES EN MILIMETROS A MENOS QUE SE INDIQUE LO CONTRARIO. LAS DIMENSIONES NUMERALES TIENEN PRIORIDAD SOBRE LAS DIMENSIONES A ESCALA EN LOS ELEMENTOS GRAFICOS.", [31000, 19500]);
  txt("TX-N3", "EL CONSTRUCTOR Y LOS SUBCONTRATISTAS DEBERÁN COMPROBAR Y VERIFICAR TODAS LAS DIMENSIONES, COTAS, NIVELES Y ESPECIFICACIONES Y TODAS LAS DEMÁS DOCUMENTACIONES PERTINENTES ANTES DEL COMIENZO DE CUALQUIER OBRA.", [31000, 16500]);
  txt("TX-N4", "VENTANAS - LOS TAMAÑOS NOMINADOS SON NOMINALES. EL TAMAÑO REAL PUEDE VARIAR SEGÚN EL FABRICANTE.", [31000, 13500]);
  txt("TX-N5", "CLASIFICACIÓN DEL SITIO - ESTOS PLANOS SE LEERÁN JUNTO CON EL INFORME DE SUELO ADJUNTO.", [31000, 11500]);
  txt("TX-I0", "INDICE DE DIBUJOS", [50000, 24000], 60);
  txt("TX-I1", "A001 NOTAS GENERALES\nA010 DIBUJOS EXISTENTES\nA101 PLANTA BAJA\nA102 PLANTA ALTA\nA103 PLANTA TECHO\nA201 ELEVACION GUILLERMO NELSON\nA202 CALLE MELCHOR OCAMPO\nA301 SECCION 01\nA302 SECCION 02\nA303 SECCION 03\nA304 SECCION 04\nA305 SECCION 05\nA306 SECCION 06\nA901 PERSPECTIVA SUR-OESTE\nA902 AXO SUR-ESTE\nA903 AXO SUR-OESTE\nA904 AXO NORTE-ESTE", [50000, 22500], 60);

  // ---------------------------------------------------------------- the sheets: every page of the set, A3, in its title band
  const sheet = (number, name, vps) => add({ id: `SH-${number}`, type: "Sheet", name: `${number} ${name}`, args: { number, sheetName: name, size: "A3", orientation: "landscape", titleBlock: { ref: "SY-TB-BAND" }, viewports: vps.map(([view, at], i) => ({ id: `VP${i + 1}`, view: { ref: view }, at, clipVisible: false })), revision: "REV3" } });
  sheet("A001", "Notas Generales", [["V-NOTAS", [160, 165]], ["V-3D-UB", [345, 95]]]);
  sheet("A010", "Dibujos Existentes", [["V-EX", [95, 170]], ["V-EX-GN", [305, 225]], ["V-EX-MO", [305, 105]]]);
  sheet("A101", "Planta Baja", [["V-PB1", [200, 170]]]);
  sheet("A102", "Planta Alta", [["V-PA", [200, 170]]]);
  sheet("A103", "Planta Techo", [["V-T", [200, 170]]]);
  sheet("A201", "Elevacion Guillermo Nelson", [["V-E-GN", [210, 165]]]);
  sheet("A202", "Calle Melchor Ocampo", [["V-E-MO", [210, 165]]]);
  for (let i = 1; i <= 6; i++) sheet(`A30${i}`, `Seccion 0${i}`, [[`V-S${i}`, [210, 165]]]);
  sheet("A901", "Perspectiva Sur-Oeste", [["V-3D-SO", [210, 165]]]);
  sheet("A902", "Axo Sur-Este", [["V-3D-SE", [210, 165]]]);
  sheet("A903", "Axo Sur-Oeste", [["V-3D-SO2", [210, 165]]]);
  sheet("A904", "Axo Norte-Este", [["V-3D-NE", [210, 165]]]);

  doc.graph.layout = {};
  doc.browser = { organisation: "by-discipline", expanded: ["Views", "Sheets"] };
  doc.regenerate();
  return doc;
}
