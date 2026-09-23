//! The sample project, built through the same op pipeline a person, a test or
//! an assistant uses: a model file and an edit script are the same kind of
//! thing (§1.8). A small studio building: cavity walls on a grid, a partition
//! T-joined through, a blockwork store as a nested room, doors, windows, a
//! doorway with nothing in it, a curved and a raking garden wall.

import { newDocument } from "./bim.js";
import { Editor } from "./ops.js";

export function buildSample() {
  const doc = newDocument("Studio House");
  const ed = new Editor(doc);
  const add = (element) => ed.apply({ op: "add", element }, { regenerate: false });
  const line = (a, b) => ({ type: "line", start: a, end: b });
  add({ id: "L0", type: "Level", name: "Ground", args: { name: "Ground", elevation: 0 } });
  add({ id: "L1", type: "Level", name: "First", args: { name: "First", elevation: 3000 } });
  add({ id: "N1", type: "Number", name: "parapet", args: { value: 450, quantity: "Length" } });
  add({ id: "EX1", type: "Expression", name: "storeyHeight", args: { formula: "L1.elevation - L0.elevation", quantity: "Length" } });
  for (const [id, name, a, b] of [["G-A", "A", [0, -2500], [0, 10500]], ["G-B", "B", [6000, -2500], [6000, 10500]], ["G-C", "C", [12000, -2500], [12000, 10500]],
    ["G-1", "1", [-2500, 0], [14500, 0]], ["G-2", "2", [-2500, 8000], [14500, 8000]]])
    add({ id, type: "Grid", name: "Grid " + name, args: { name, line: line(a, b) } });
  const wall = (id, a, b, type, extra = {}) => add({ id, type: "Wall", name: id, args: Object.assign({ centreline: line(a, b), mounting: "Core exterior", wallType: { ref: type }, baseLevel: { ref: "L0" }, baseOffset: 0, height: { ref: "EX1" }, flipped: false }, extra), params: { Phase: "New" } });
  wall("W1", [0, 0], [12000, 0], "T-EXTCAV300");
  wall("W2", [12000, 0], [12000, 8000], "T-EXTCAV300");
  wall("W3", [12000, 8000], [0, 8000], "T-EXTCAV300");
  wall("W4", [0, 8000], [0, 0], "T-EXTCAV300");
  wall("P1", [6000, 0], [6000, 8000], "T-PART100", { mounting: "Centred" });
  // the store: blockwork, a closed loop that does not touch the room around it
  wall("S1", [8000, 4800], [10600, 4800], "T-BLOCK215", { mounting: "Centred" });
  wall("S2", [10600, 4800], [10600, 7000], "T-BLOCK215", { mounting: "Centred" });
  wall("S3", [10600, 7000], [8000, 7000], "T-BLOCK215", { mounting: "Centred" });
  wall("S4", [8000, 7000], [8000, 4800], "T-BLOCK215", { mounting: "Centred" });
  // garden walls: an arc and a raking wall — the exact-offset path and the surface path
  add({ id: "GW1", type: "Wall", name: "Garden arc", args: { centreline: { type: "arc", centre: [6000, -2500], radius: 4000, start: 200, end: 340, ccw: true }, mounting: "Centred", wallType: { ref: "T-BLOCK215" }, baseLevel: { ref: "L0" }, height: 1500 }, params: { Phase: "Existing" } });
  add({ id: "GW2", type: "Wall", name: "Raking wall", args: { centreline: line([14500, -1000], [14500, 9000]), mounting: "Centred", wallType: { ref: "T-BLOCK215" }, baseLevel: { ref: "L0" }, height: 900, slope: { top: 8, lean: 0 } }, params: { Phase: "Demolished" } });
  const rel = row => ed.apply({ op: "relate", store: "joins", row }, { regenerate: false });
  const J = (a, ae, b, be) => rel({ a: { of: a, end: ae }, b: { of: b, end: be }, kind: "auto", order: 0, allowed: true });
  J("W1", "end", "W2", "start"); J("W2", "end", "W3", "start"); J("W3", "end", "W4", "start"); J("W4", "end", "W1", "start");
  rel({ a: { of: "P1", end: "start" }, b: { of: "W1", u: 6000 }, kind: "auto", order: 0, allowed: true });
  rel({ a: { of: "P1", end: "end" }, b: { of: "W3", u: 6000 }, kind: "auto", order: 0, allowed: true });
  J("S1", "end", "S2", "start"); J("S2", "end", "S3", "start"); J("S3", "end", "S4", "start"); J("S4", "end", "S1", "start");
  // openings, then their fillers (Wall ← Opening ← Door: all DAG edges)
  const op = (id, host, at, sill, w, h, extra = {}) => add(Object.assign({ id, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at, sill, w, h }, farProfile: null, depth: "through" } }, extra));
  op("OP1", "W1", 3000, 0, 1015, 2100);
  op("OP2", "W1", 9000, 900, 2400, 1500);
  op("OP3", "W3", 3000, 900, 2400, 1500);
  op("OP4", "W3", 9000, 900, 1200, 1500);
  op("OP5", "P1", 2200, 0, 915, 2100);
  op("OP6", "S1", 800, 0, 900, 2100);                         // a doorway with nothing in it
  op("OP7", "W4", 4000, 900, 1200, 1500);
  add({ id: "D1", type: "Door", args: { fills: { ref: "OP1" }, doorType: { ref: "T-DOOR1015" }, flipHand: false, flipFacing: false }, params: { Phase: "New", Mark: "D01" } });
  add({ id: "D2", type: "Door", args: { fills: { ref: "OP5" }, doorType: { ref: "T-DOOR915" }, flipHand: true, flipFacing: false }, params: { Phase: "New", Mark: "D02" } });
  add({ id: "WN1", type: "Window", args: { fills: { ref: "OP2" }, windowType: { ref: "T-WIN2415" } }, params: { Mark: "W01" } });
  add({ id: "WN2", type: "Window", args: { fills: { ref: "OP3" }, windowType: { ref: "T-WIN2415" } }, params: { Mark: "W02" } });
  add({ id: "WN3", type: "Window", args: { fills: { ref: "OP4" }, windowType: { ref: "T-WIN1215" } }, params: { Mark: "W03" } });
  add({ id: "WN4", type: "Window", args: { fills: { ref: "OP7" }, windowType: { ref: "T-WIN1215" } }, params: { Mark: "W04" } });
  // the ground slab under the rooms, the first floor on the walls, and two steel beams carrying it over the studio
  add({ id: "FL1", type: "Floor", name: "Ground slab", args: { boundary: [[0, 0], [12000, 0], [12000, 8000], [0, 8000]], floorType: { ref: "T-FLOOR250" }, level: { ref: "L0" }, heightOffset: 0 } });
  add({ id: "FL2", type: "Floor", name: "First floor", args: { boundary: [[-178, -178], [12178, -178], [12178, 8178], [-178, 8178]], floorType: { ref: "T-FLOOR250" }, level: { ref: "L1" }, heightOffset: 250 } });
  add({ id: "BM1", type: "Beam", args: { axis: { type: "line", start: [0, 2800], end: [6000, 2800] }, beamType: { ref: "T-UB406" }, level: { ref: "L1" }, topOffset: 0 } });
  add({ id: "BM2", type: "Beam", args: { axis: { type: "line", start: [0, 5600], end: [6000, 5600] }, beamType: { ref: "T-UB406" }, level: { ref: "L1" }, topOffset: 0 } });
  add({ id: "C1", type: "Column", args: { position: [3000, 4400], columnType: { ref: "T-COL300R" }, baseLevel: { ref: "L0" }, height: 3000, rotation: 0 } });
  add({ id: "FU1", type: "Furniture", args: { position: [3000, 6100], shape: "Table", size: [1800, 900], rotation: 0, level: { ref: "L0" } } });
  add({ id: "FU2", type: "Furniture", args: { position: [2400, 1700], shape: "Sofa", size: [2000, 850], rotation: 0, level: { ref: "L0" } } });
  add({ id: "FU3", type: "Furniture", args: { position: [8400, 2200], shape: "Desk", size: [1600, 800], rotation: 90, level: { ref: "L0" } } });
  const space = (id, name, anchor, number, dept, occ) => add({ id, type: "Space", name, args: { level: { ref: "L0" }, upperLimit: { mode: "toLevel", level: { ref: "L1" }, offset: 0 }, anchor, boundaryAt: "finishFace" }, params: { Number: number, Department: dept, Occupancy: occ } });
  space("SP1", "Studio", [3000, 3200], "G.01", "Workplace", 6);
  space("SP2", "Office", [9500, 2600], "G.02", "Workplace", 2);
  space("SP3", "Store", [9300, 5900], "G.03", "Support", 0);
  // views
  add({ id: "V-P00", type: "PlanView", name: "Ground Floor Plan", args: { level: { ref: "L0" }, scale: 100, viewRange: { top: 2300, cut: 1200, bottom: 0 }, detailLevel: "Fine", style: { ref: "VS-CONSTRUCTION" }, filters: ["FL-DEMO"], clip: { rect: [-3500, -7200, 16000, 11500], visible: false, active: true }, overrides: {} } });
  add({ id: "V-P00P", type: "PlanView", name: "Ground Floor — Presentation", args: { level: { ref: "L0" }, scale: 100, viewRange: { top: 2300, cut: 1200, bottom: 0 }, detailLevel: "Coarse", style: { ref: "VS-PRESENTATION" }, filters: [], clip: { rect: [-1500, -1500, 13500, 9500], visible: false, active: true }, overrides: {} } });
  add({ id: "V-P00D", type: "PlanView", name: "Corner Detail", args: { level: { ref: "L0" }, scale: 20, viewRange: { top: 2300, cut: 1200, bottom: 0 }, detailLevel: "Fine", style: { ref: "VS-CONSTRUCTION" }, filters: [], clip: { rect: [10600, -1300, 13400, 1800], visible: true, active: true }, overrides: {} } });
  add({ id: "V-E01", type: "ElevationView", name: "South Elevation", args: { line: line([15500, -6000], [-3500, -6000]), depth: 16000, scale: 100, baseLevel: { ref: "L0" }, top: 5000, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Coarse", clip: { rect: null, visible: false, active: false } } });
  add({ id: "V-S01", type: "SectionView", name: "Section A-A", args: { line: line([3000, -1500], [3000, 9500]), depth: 12000, scale: 50, baseLevel: { ref: "L0" }, top: 4500, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Fine", clip: { rect: null, visible: false, active: false } } });
  add({ id: "V-E02", type: "ElevationView", name: "East Elevation", args: { line: line([18000, 10000], [18000, -2000]), depth: 20000, scale: 100, baseLevel: { ref: "L0" }, top: 5000, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Coarse", clip: { rect: null, visible: false, active: false } } });
  add({ id: "V-3D01", type: "View3D", name: "Axonometric", args: { camera: { azimuth: 235, elevation: 32, target: [6000, 4000, 1500] }, scale: 200, style: { ref: "VS-CONSTRUCTION" }, render: { mode: "lines", hidden: false, rasterDPI: 300, silhouetteWeight: 0.35 } } });
  add({ id: "SC1", type: "Schedule", name: "Wall Schedule", args: { of: "IfcWall", fields: ["Id", "TypeMark", "Length", "Height", "FireRating", "Phase"] } });
  add({ id: "SC2", type: "Schedule", name: "Door Schedule", args: { of: "IfcDoor", fields: ["Id", "Mark", "TypeMark", "Width", "Height", "FireRating", "Phase"] } });
  add({ id: "SC3", type: "Schedule", name: "Area Schedule", args: { of: "IfcSpace", fields: ["Number", "Name", "Department", "Area", "Boundary basis", "Occupancy"] } });
  // annotation in the ground floor plan
  add({ id: "TX1", type: "Text", args: { content: "190mm blockwork, plaster both sides", position: [11200, 9800], rotation: 0, textType: { ref: "TT-25" }, wrapWidth: 40, leaders: [{ side: "left", elbow: [10600, 9800], target: [10600, 7000], arrow: "AR-DOT", attachment: "middle" }], view: { ref: "V-P00" } } });
  add({ id: "TX2", type: "Text", args: { content: "=\"Wall type \" & W1.TypeMark & \" — \" & W1.FireRating & \" min\"", position: [500, -1600], rotation: 0, textType: { ref: "TT-25" }, wrapWidth: 80, leaders: [], view: { ref: "V-P00" } } });
  add({ id: "DIM1", type: "Dimension", args: { of: ["W1:core.exterior", "W3:core.exterior"], offset: 1800, view: { ref: "V-P00" }, locked: false } });
  add({ id: "DIM2", type: "Dimension", args: { of: ["W4:core.exterior", "P1:centreline"], offset: 1300, view: { ref: "V-P00" }, locked: false } });
  add({ id: "DIM3", type: "Dimension", args: { of: ["P1:centreline", "W2:core.exterior"], offset: -9300, view: { ref: "V-P00" }, locked: false } });
  ed.apply({ op: "relate", store: "constraints", row: { id: "C1", kind: "distance", of: ["W4:core.exterior", "P1:centreline"], value: 6000, locked: false } }, { regenerate: false });
  // sheets
  add({ id: "SH-A101", type: "Sheet", name: "A-101 Ground Floor Plan", args: { number: "A-101", sheetName: "Ground Floor Plan", size: "A1", orientation: "landscape", titleBlock: { ref: "SY-TB-A1" },
    viewports: [{ id: "VP1", view: { ref: "V-P00" }, at: [250, 360], clipVisible: false }, { id: "VP2", view: { ref: "V-E01" }, at: [250, 110], clipVisible: false }, { id: "VP3", view: { ref: "SC3" }, at: [560, 470], clipVisible: false }, { id: "VP4", view: { ref: "V-E02" }, at: [540, 170], clipVisible: false }], revision: "P01" } });
  add({ id: "SH-A102", type: "Sheet", name: "A-102 Presentation Plan", args: { number: "A-102", sheetName: "Presentation Plan", size: "A3", orientation: "landscape", titleBlock: { ref: "SY-TB-A1" },
    viewports: [{ id: "VP1", view: { ref: "V-P00P" }, at: [170, 160], clipVisible: false }], revision: "P01" } });
  add({ id: "SH-A501", type: "Sheet", name: "A-501 Details", args: { number: "A-501", sheetName: "Corner Detail & Axonometric", size: "A3", orientation: "landscape", titleBlock: { ref: "SY-TB-A1" },
    viewports: [{ id: "VP1", view: { ref: "V-P00D" }, at: [95, 170], clipVisible: true }, { id: "VP2", view: { ref: "V-3D01" }, at: [245, 160], clipVisible: false }, { id: "VP3", view: { ref: "SC2" }, at: [165, 45], clipVisible: false }], revision: "P01" } });
  doc.graph.layout = {};
  doc.browser = { organisation: "by-discipline", expanded: ["Views", "Sheets"] };
  doc.regenerate();
  return doc;
}
