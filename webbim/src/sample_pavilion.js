//! A second small sample: a house in the manner of the Barcelona Pavilion (Mies van der Rohe, 1929).
//! A travertine podium with two reflecting pools, a thin roof plate on eight cruciform chrome columns,
//! and free-standing walls of travertine, Tinos marble and onyx slipping past glass. It is not the
//! pavilion: it is a house on its principles - one room that flows, a glass-walled bedroom, a marble
//! service core - drawn as a small architectural set: plans, roof plan, four elevations, two sections,
//! an axonometric, schedules, and five A1 sheets.
//!
//! Coordinates in mm: x east, y north. The podium runs 0-36,000 × 0-14,000 and stands 1,000 above
//! the ground; the roof plate is 20 × 9 m and its soffit 3,200 above the podium.

import { newDocument } from "./bim.js";
import { Editor } from "./ops.js";

export function buildPavilionSample() {
  const doc = newDocument("Pavilion House");
  const ed = new Editor(doc);
  const add = (element) => { const r = ed.apply({ op: "add", element }, { regenerate: false }); if (!r.ok) throw new Error(`${element.id || element.type}: ${r.error}`); return r.id; };
  const line = (a, b) => ({ type: "line", start: a, end: b });
  const PODIUM = 1000, CLEAR = 3200, ROOF = 350;
  add({ id: "L0", type: "Level", name: "Ground", args: { name: "Ground", elevation: 0 } });
  add({ id: "LP", type: "Level", name: "Podium", args: { name: "Podium", elevation: PODIUM } });
  add({ id: "LR", type: "Level", name: "Roof", args: { name: "Roof", elevation: PODIUM + CLEAR + ROOF } });

  // the column grid: four bays of 5 m by one of 4 m, the roof cantilevering 2.5 m all round
  const GX = [15500, 20500, 25500, 30500], GY = [5500, 9500];
  GX.forEach((x, i) => add({ id: `G-${"ABCD"[i]}`, type: "Grid", name: `Grid ${"ABCD"[i]}`, args: { name: "ABCD"[i], line: line([x, -3000], [x, 17000]) } }));
  GY.forEach((y, i) => add({ id: `G-${i + 1}`, type: "Grid", name: `Grid ${i + 1}`, args: { name: String(i + 1), line: line([-3000, y], [39000, y]) } }));

  // the podium: a travertine-clad base with the big pool cut from its south edge and the court pool from its north-east corner
  const podium = [[0, 0], [1500, 0], [1500, 8000], [11500, 8000], [11500, 0], [36000, 0], [36000, 9000], [32000, 9000], [32000, 14000], [0, 14000]];
  add({ id: "PD-BASE", type: "Generic", name: "Podium base (travertine-clad)", args: { boundary: podium, level: { ref: "L0" }, baseOffset: 0, height: PODIUM - 400, ifcClass: "IfcSlab", material: "M-TRAV", colour: "" } });
  add({ id: "FL-POD", type: "Floor", name: "Podium paving", args: { boundary: podium, floorType: { ref: "T-PODIUM" }, level: { ref: "LP" }, heightOffset: 0 } });
  add({ id: "FL-POOL1", type: "Floor", name: "Big reflecting pool", args: { boundary: [[1500, 0], [11500, 0], [11500, 8000], [1500, 8000]], floorType: { ref: "T-POOL" }, level: { ref: "LP" }, heightOffset: -250 } });
  add({ id: "FL-POOL2", type: "Floor", name: "Court pool", args: { boundary: [[32000, 9000], [36000, 9000], [36000, 14000], [32000, 14000]], floorType: { ref: "T-POOL" }, level: { ref: "LP" }, heightOffset: -250 } });
  // steps up from the ground on the south: five risers of 200 on 350 treads
  for (let i = 0; i < 5; i++) add({ id: `ST${i + 1}`, type: "Generic", name: `Step ${i + 1}`, args: { boundary: [[13000, -350 * (5 - i)], [19000, -350 * (5 - i)], [19000, 0], [13000, 0]], level: { ref: "L0" }, baseOffset: 0, height: 200 * (i + 1), ifcClass: "IfcStair", material: "M-TRAV", colour: "" } });

  // the roof plate and the eight cruciform columns that carry it
  add({ id: "FL-ROOF", type: "Floor", name: "Roof plate", args: { boundary: [[13000, 3000], [33000, 3000], [33000, 12000], [13000, 12000]], floorType: { ref: "T-ROOF350" }, level: { ref: "LR" }, heightOffset: 0 } });
  let c = 0; for (const y of GY) for (const x of GX) add({ id: `C${++c}`, type: "Column", name: `Column ${c}`, args: { position: [x, y], columnType: { ref: "T-COLX180" }, baseLevel: { ref: "LP" }, height: CLEAR, rotation: 0 }, params: { Mark: `C${c}` } });

  // walls: stone planes that slide past one another, glass between them
  const wall = (id, name, a, b, type, extra = {}) => add({ id, type: "Wall", name, args: Object.assign({ centreline: line(a, b), mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: "LP" }, baseOffset: 0, height: CLEAR, flipped: false }, extra), params: { Phase: "New" } });
  wall("W-N", "North travertine wall", [400, 13600], [20000, 13600], "T-TRAV300");
  wall("W-W", "West court wall", [400, 9000], [400, 13600], "T-TRAV300");
  // the court pool is walled on its two outer edges, standing on the ground
  wall("W-C1", "Court wall north", [27000, 13850], [35850, 13850], "T-TRAV300", { baseLevel: { ref: "L0" }, height: PODIUM + CLEAR });
  wall("W-C2", "Court wall east", [35850, 13850], [35850, 9000], "T-TRAV300", { baseLevel: { ref: "L0" }, height: PODIUM + CLEAR });
  // the big pool's rim along the south edge, low: the water reads from the steps
  wall("W-RIM", "Pool rim", [1500, 150], [11500, 150], "T-TRAV300", { baseLevel: { ref: "L0" }, height: PODIUM + 450 });
  wall("W-ONYX", "Onyx wall", [18500, 7500], [23500, 7500], "T-ONYX200");
  wall("W-M1", "Marble screen", [31900, 4500], [31900, 8500], "T-MARBLE200");
  // the bedroom: glass on two sides, a marble wall on the third, the travertine wall behind
  wall("W-BG1", "Bedroom glass west", [13300, 10300], [13300, 13450], "T-GLASS30");
  wall("W-BG2", "Bedroom glass south", [13300, 10300], [18000, 10300], "T-GLASS30");
  wall("W-BM", "Bedroom marble wall", [18000, 10300], [18000, 13450], "T-MARBLE200");
  // the south glass wall of the living room, set back under the roof
  wall("W-SG", "South glass wall", [13300, 4300], [28000, 4300], "T-GLASS30");
  // the service core: kitchen and bath inside four marble walls
  wall("W-K1", "Core south", [27000, 10500], [31500, 10500], "T-MARBLE200");
  wall("W-K2", "Core east", [31500, 10500], [31500, 13300], "T-MARBLE200");
  wall("W-K3", "Core north", [31500, 13300], [27000, 13300], "T-MARBLE200");
  wall("W-K4", "Core west", [27000, 13300], [27000, 10500], "T-MARBLE200");
  wall("W-K5", "Core partition", [29300, 10500], [29300, 13300], "T-PART100");
  ed.apply({ op: "autojoin", ends: ["W-BG1", "W-BG2", "W-BM", "W-K1", "W-K2", "W-K3", "W-K4", "W-C1", "W-C2"].flatMap(id => [{ id, end: "start" }, { id, end: "end" }]) }, { regenerate: false });

  // openings and doors
  const op = (id, host, at, w, h) => add({ id, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at, sill: 0, w, h }, farProfile: null, depth: "through" } });
  op("OP1", "W-SG", 7200, 1200, 2600);
  op("OP2", "W-BG2", 3300, 1200, 2600);
  op("OP3", "W-K1", 1100, 915, 2100);
  op("OP4", "W-K1", 3400, 915, 2100);
  add({ id: "D1", type: "Door", args: { fills: { ref: "OP1" }, doorType: { ref: "T-DOOR1200G" }, flipHand: false, flipFacing: false }, params: { Phase: "New", Mark: "D01" } });
  add({ id: "D2", type: "Door", args: { fills: { ref: "OP2" }, doorType: { ref: "T-DOOR1200G" }, flipHand: true, flipFacing: false }, params: { Phase: "New", Mark: "D02" } });
  add({ id: "D3", type: "Door", args: { fills: { ref: "OP3" }, doorType: { ref: "T-DOOR915" }, flipHand: false, flipFacing: true }, params: { Phase: "New", Mark: "D03" } });
  add({ id: "D4", type: "Door", args: { fills: { ref: "OP4" }, doorType: { ref: "T-DOOR915" }, flipHand: true, flipFacing: true }, params: { Phase: "New", Mark: "D04" } });

  // rooms (the enclosed ones) and furniture: Barcelona chairs by the onyx wall, a bed, a table
  const space = (id, name, anchor, number) => add({ id, type: "Space", name, args: { level: { ref: "LP" }, upperLimit: { mode: "offset", offset: CLEAR }, anchor, boundaryAt: "finishFace" }, params: { Number: number, Department: "Residential", Occupancy: 2 } });
  space("SP1", "Bedroom", [15600, 11900], "01");
  space("SP2", "Kitchen", [28100, 11900], "02");
  space("SP3", "Bath", [30400, 11900], "03");
  const fu = (id, shape, at, size, rot = 0) => add({ id, type: "Furniture", args: { position: at, shape, size, rotation: rot, level: { ref: "LP" } } });
  fu("FU1", "Chair", [20000, 6300], [750, 750]); fu("FU2", "Chair", [21400, 6300], [750, 750]); fu("FU3", "Table", [20700, 5500], [900, 900]);
  fu("FU4", "Sofa", [22500, 9000], [2400, 900], 180); fu("FU5", "Table", [15600, 12300], [2000, 1800]); fu("FU6", "Desk", [25000, 8400], [2200, 1000]);

  // ---------------------------------------------------------------- views
  const vr = (top, cut, bottom, depth) => ({ top, cut, bottom, depth });
  add({ id: "V-PLAN", type: "PlanView", name: "Podium Plan", args: { level: { ref: "LP" }, scale: 100, viewRange: vr(2300, 1200, -1000, -1000), detailLevel: "Medium", style: { ref: "VS-CONSTRUCTION" }, clip: { rect: [-4000, -4500, 40000, 17500], visible: false, active: true } } });
  add({ id: "V-ROOF", type: "PlanView", name: "Roof Plan", args: { level: { ref: "LR" }, scale: 200, viewRange: vr(2000, 1200, -500, -5000), detailLevel: "Coarse", style: { ref: "VS-CONSTRUCTION" }, clip: { rect: [-4000, -4500, 40000, 17500], visible: false, active: true } } });
  add({ id: "V-PRES", type: "PlanView", name: "Podium Plan — Presentation", args: { level: { ref: "LP" }, scale: 100, viewRange: vr(2300, 1200, -1000, -1000), detailLevel: "Coarse", style: { ref: "VS-PRESENTATION" }, clip: { rect: [-2000, -2500, 38000, 16000], visible: false, active: true } } });
  add({ id: "V-DET", type: "PlanView", name: "Bedroom Corner Detail", args: { level: { ref: "LP" }, scale: 20, viewRange: vr(2300, 1200, -1000, -1000), detailLevel: "Fine", style: { ref: "VS-CONSTRUCTION" }, clip: { rect: [12300, 9300, 15300, 11600], visible: true, active: true } } });
  // elevations: the line runs so that the view looks to its right-hand side
  const elev = (id, name, a, b, depth) => add({ id, type: "ElevationView", name, args: { line: line(a, b), depth, scale: 100, baseLevel: { ref: "L0" }, top: 6500, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Coarse", clip: { rect: null, visible: false, active: false } } });
  elev("V-E-S", "South Elevation", [38000, -4000], [-2000, -4000], 22000);
  elev("V-E-N", "North Elevation", [-2000, 18000], [38000, 18000], 22000);
  elev("V-E-E", "East Elevation", [39000, 16000], [39000, -2000], 42000);
  elev("V-E-W", "West Elevation", [-3000, -2000], [-3000, 16000], 42000);
  add({ id: "V-S-A", type: "SectionView", name: "Section A-A", args: { line: line([-2000, 7000], [38000, 7000]), depth: 9000, scale: 100, baseLevel: { ref: "L0" }, top: 6000, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Medium", clip: { rect: null, visible: false, active: false } } });
  add({ id: "V-S-B", type: "SectionView", name: "Section B-B", args: { line: line([22300, -2500], [22300, 16500]), depth: 16000, scale: 100, baseLevel: { ref: "L0" }, top: 6000, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Medium", clip: { rect: null, visible: false, active: false } } });
  add({ id: "V-3D", type: "View3D", name: "Axonometric", args: { camera: { azimuth: 215, elevation: 32, target: [18000, 7000, 2000] }, scale: 100, style: { ref: "VS-CONSTRUCTION" }, visualStyle: "Shaded", render: { mode: "lines", hidden: false, rasterDPI: 300, silhouetteWeight: 0.35 } } });
  add({ id: "V-3D2", type: "View3D", name: "View from the Steps", args: { camera: { azimuth: 200, elevation: 14, target: [22000, 8000, 2500] }, scale: 150, style: { ref: "VS-PRESENTATION" }, visualStyle: "Shaded" } });
  add({ id: "SC1", type: "Schedule", name: "Wall Schedule", args: { of: "IfcWall", fields: ["Id", "Name", "TypeMark", "Length", "Height"] } });
  add({ id: "SC2", type: "Schedule", name: "Door Schedule", args: { of: "IfcDoor", fields: ["Mark", "TypeMark", "Width", "Height"] } });
  add({ id: "SC3", type: "Schedule", name: "Room Schedule", args: { of: "IfcSpace", fields: ["Number", "Name", "Area", "Boundary basis"] } });
  add({ id: "SC4", type: "Schedule", name: "Column Schedule", args: { of: "IfcColumn", fields: ["Mark", "TypeMark", "Height"] } });

  // annotation on the podium plan: the materials, and the grid dimensioned
  const note = (id, content, at, target, side = "left") => add({ id, type: "Text", args: { content, position: at, rotation: 0, textType: { ref: "TT-25" }, wrapWidth: 45, leaders: [{ side, elbow: [at[0] - (side === "left" ? 600 : -600), at[1]], target, arrow: "AR-DOT", attachment: "middle" }], view: { ref: "V-PLAN" } } });
  note("TX1", "Onyx doré wall, book-matched", [19200, 2600], [20500, 7400]);
  note("TX2", "Cruciform chrome-plated steel columns, 8 no.", [24200, 2600], [25500, 5500]);
  note("TX3", "Reflecting pool, water 300 deep", [4000, -2300], [6500, 4000]);
  note("TX4", "Travertine podium +1.000", [3000, 15800], [5000, 12000]);
  note("TX5", "Tinos marble core", [33200, 15800], [29000, 13300], "right");
  // grid bays and the overall, measured from the grid lines' own start points (they begin at y = -3,000 and x = -3,000)
  const dim = (id, a, b, offset) => add({ id, type: "Dimension", args: { of: [`${a}:line`, `${b}:line`], offset, view: { ref: "V-PLAN" }, locked: false } });
  dim("DIM1", "G-A", "G-B", -19000); dim("DIM2", "G-B", "G-C", -19000); dim("DIM3", "G-C", "G-D", -19000); dim("DIM4", "G-A", "G-D", -20000);
  dim("DIM5", "G-1", "G-2", -40800);

  // ---------------------------------------------------------------- the sheets (A1 landscape)
  const sheet = (id, number, name, vps) => add({ id, type: "Sheet", name: `${number} ${name}`, args: { number, sheetName: name, size: "A1", orientation: "landscape", titleBlock: { ref: "SY-TB-A1" }, viewports: vps.map(([view, at], i) => ({ id: `VP${i + 1}`, view: { ref: view }, at, clipVisible: false })), revision: "P01" } });
  sheet("SH-A000", "A-000", "Cover — Axonometric", [["V-3D", [410, 370]], ["V-3D2", [560, 115]], ["SC3", [210, 90]]]);
  sheet("SH-A100", "A-100", "Podium Plan", [["V-PLAN", [420, 350]], ["V-ROOF", [270, 115]], ["V-DET", [610, 115]]]);
  sheet("SH-A101", "A-101", "Presentation Plan", [["V-PRES", [420, 300]]]);
  sheet("SH-A200", "A-200", "Elevations", [["V-E-S", [420, 480]], ["V-E-N", [420, 350]], ["V-E-E", [420, 220]], ["V-E-W", [420, 90]]]);
  sheet("SH-A300", "A-300", "Sections & Schedules", [["V-S-A", [420, 470]], ["V-S-B", [310, 250]], ["SC1", [600, 280]], ["SC2", [600, 120]], ["SC4", [310, 90]]]);

  doc.graph.layout = {};
  doc.browser = { organisation: "by-discipline", expanded: ["Views", "Sheets"] };
  doc.regenerate();
  return doc;
}
