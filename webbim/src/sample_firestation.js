//! A study model of the Vitra Fire Station (Zaha Hadid, 1993, Weil am Rhein), drawn from published descriptions.
//! The dimensions are approximate: a reading of the building, not a survey of it. What the published accounts give
//! and this model keeps:
//!
//! - a long, narrow building of exposed in-situ concrete planes that tilt, fold and slide past one another;
//! - the garage: a 32 m span (with the entrance zone) holding five engines in parallel lanes at 60°, five sliding
//!   doors of about 23 m² hung from the main beam, two pivot doors of about 30 m² at the back, and a tilted glass
//!   wall of about 90 m² closing its short end;
//! - the canopy over the garage doors: 4 m out from the main beam, then 12 m on along its axis, on slender columns;
//! - three "beams" west of the entrance: the changing beam (closed, its outer wall leaning outward and cut only by
//!   slits), the fitness beam (one long room behind a curved frameless glass wall of over 29 m, ending in a golden
//!   wall that leans out), and the clubroom above the changing beam, with a terrace over the fitness room and a
//!   21 m long, low slice of window in the 70 m wall;
//! - three locker units between the changing and fitness beams, and a cantilevered stair up to the clubroom.
//!
//! Coordinates in mm: x east along the building, y north. The long south wall runs 70 m from x = 0 to 70,000.

import { newDocument } from "./bim.js";
import { Editor } from "./ops.js";

export function buildFireStationSample() {
  const doc = newDocument("Fire Station Study");
  const ed = new Editor(doc);
  const add = (element) => { const r = ed.apply({ op: "add", element }, { regenerate: false }); if (!r.ok) throw new Error(`${element.id || element.type}: ${r.error}`); return r.id; };
  const rnd = p => [Math.round(p[0]), Math.round(p[1])];
  const line = (a, b) => ({ type: "line", start: rnd(a), end: rnd(b) });
  doc.meta.name = "Fire Station Study";
  const L = doc.lib;

  // ---------------------------------------------------------------- materials and types: concrete, glass, the golden wall, brushed aluminium
  const mat = (id, name, mark, cut, proj, shade) => { L.materials[id] = { name, mark, description: name, cut, projection: proj, shading: { colour: shade } }; };
  mat("M-VFS-CONC", "Exposed concrete, cast in situ, board-smooth", "CN-01", { pattern: "P-CONC", pen: "heavy", lineColour: "#1b1f24", background: "#e4e4e1" }, { pen: "thin" }, "#cfcdc6");
  mat("M-VFS-GOLD", "Gilded render", "GD-01", { pattern: null, pen: "heavy", lineColour: "#1b1f24", background: "#e8d9a8" }, { pen: "thin" }, "#cfae52");
  mat("M-VFS-ALU", "Brushed aluminium", "AL-01", { pattern: null, pen: "medium", lineColour: "#1b1f24", background: "#e0e3e6" }, { pen: "thin" }, "#b9bec4");
  mat("M-VFS-SS", "Stainless steel", "SS-03", { pattern: null, pen: "medium", lineColour: "#1b1f24", background: "#eef0f2" }, { pen: "thin" }, "#c8ccd0");
  const wt = (id, name, mark, layers, fn = "Exterior") => { L.types[id] = { family: "F-BASICWALL", name, mark, layers, coreStart: 0, coreEnd: layers.length, params: { Function: fn } }; };
  wt("T-VFS-RC300", "Exposed concrete 300", "C30", [{ function: "Structure", thickness: 300, material: "M-VFS-CONC" }]);
  wt("T-VFS-RC250", "Exposed concrete 250", "C25", [{ function: "Structure", thickness: 250, material: "M-VFS-CONC" }]);
  wt("T-VFS-RC150", "Concrete partition 150, rendered", "C15", [{ function: "Structure", thickness: 150, material: "M-VFS-CONC" }], "Interior");
  wt("T-VFS-GOLD", "Golden wall: concrete 250, gilded render", "GW", [{ function: "Finish 1", thickness: 20, material: "M-VFS-GOLD" }, { function: "Structure", thickness: 250, material: "M-VFS-CONC" }]);
  L.types["T-VFS-SLAB300"] = Object.assign({}, L.types["T-SLAB300"], { name: "Concrete slab 300, no upstand or flashing", mark: "S30" });
  L.types["T-VFS-COL120"] = { family: "F-COLUMN", name: "Steel tube Ø120", mark: "C1", width: 120, depth: 120, round: true, material: "M-STEEL" };

  // ---------------------------------------------------------------- levels
  const CLUB = 3400, ROOF = 6800, GAR = 6000;            // the clubroom beam stands 0.8 m above the garage; the canopy floats above both
  add({ id: "L0", type: "Level", name: "Ground", args: { name: "Ground", elevation: 0 } });
  add({ id: "L1", type: "Level", name: "Clubroom", args: { name: "Clubroom", elevation: CLUB } });
  add({ id: "LR", type: "Level", name: "Roof", args: { name: "Roof", elevation: ROOF } });

  // ---------------------------------------------------------------- the lines the building is set out from
  const yS = x => 3000 - 3000 * x / 70000;                          // the 70 m south wall: it closes 3 m on the building's axis over its length
  const yC = x => 6500 + (x - 8000) * 700 / 29500;                    // the changing beam's inner face, opening as it runs east
  // the fitness beam's curved glass: a circle through three points
  const A0 = [9500, 8800], A1 = [22000, 12400], A2 = [37500, 11500];
  const circ = (a, b, c) => { const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])), s = p => p[0] * p[0] + p[1] * p[1];
    const x = (s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d, y = (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d; return { c: [x, y], r: Math.hypot(a[0] - x, a[1] - y) }; };
  const ARC = circ(A0, A1, A2);
  const ang = p => ((Math.atan2(p[1] - ARC.c[1], p[0] - ARC.c[0]) * 180 / Math.PI) + 360) % 360;
  const arcY = x => ARC.c[1] + Math.sqrt(ARC.r * ARC.r - (x - ARC.c[0]) ** 2) * (A1[1] > ARC.c[1] ? 1 : -1);
  const arcPts = (x0, x1, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const x = x0 + (x1 - x0) * i / n; return [x, arcY(x)]; });

  const wall = (id, name, a, b, type, extra = {}) => add({ id, type: "Wall", name, args: Object.assign({ centreline: line(a, b), mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: "L0" }, baseOffset: 0, height: ROOF, flipped: false }, extra), params: { Phase: "New" } });

  // the 70 m wall: west of the entrance it leans out 8° over the changing beam; along the garage it stands plumb
  wall("W-S1", "South wall, changing beam (leans out 8°)", [38000, yS(38000)], [0, yS(0)], "T-VFS-RC300", { slope: { top: 0, lean: 8 } });
  wall("W-S2", "South wall, garage", [70000, yS(70000)], [38000, yS(38000)], "T-VFS-RC300", { height: GAR });
  // the garage: the sliding-door wall under the canopy, and the tilted glass end
  wall("W-GN", "Garage door wall and main beam", [43000, 14000], [72000, 14000], "T-VFS-RC300", { height: GAR });
  wall("W-GE", "Tilted glass wall, garage end (leans out 10°)", [72000, 14000], [70000, yS(70000)], "T-GLASS30", { height: GAR - 400, slope: { top: 0, lean: 10 } });
  // the free-standing plane between the entrance and the equipment space
  wall("W-FREE", "Free-standing plane", [43000, 4000], [44000, 11000], "T-VFS-RC250", { height: 5200 });
  // the beams: changing (south), fitness (north, behind the curved glass); the golden wall closes the fitness room to the west
  wall("W-C", "Wall between changing and fitness beams", [8000, yC(8000)], [37500, yC(37500)], "T-VFS-RC250", { height: CLUB });
  // the same plane carried on west past the enclosure as a free blade: the beams read as layers sliding past each other
  wall("W-CX", "Free blade, west", [8000, yC(8000)], [1500, yC(1500)], "T-VFS-RC250", { height: CLUB });
  wall("W-CW", "Changing beam, west end", [8000, yS(8000)], [8000, yC(8000)], "T-VFS-RC250", { height: CLUB });
  // the east end in two lifts: above the clubroom floor the 70 m wall has leaned out 0.5-0.9 m, and the end follows it
  wall("W-CE", "Changing beam, east end", [37500, yS(37500)], [37500, yC(37500)], "T-VFS-RC250", { height: CLUB });
  wall("W-CE2", "Clubroom east end", [37500, yS(37500) - 600], [37500, yC(37500)], "T-VFS-RC250", { baseLevel: { ref: "L1" }, height: ROOF - CLUB });
  wall("W-GOLD", "Golden wall (leans out 12°)", [8000, yC(8000)], A0, "T-VFS-GOLD", { height: CLUB + 600, slope: { top: 0, lean: 12 } });
  add({ id: "W-FIT", type: "Wall", name: "Fitness beam: curved frameless glass", args: { centreline: { type: "arc", centre: rnd(ARC.c), radius: Math.round(ARC.r), start: +ang(A2).toFixed(4), end: +ang(A0).toFixed(4), ccw: true }, mounting: "Centred", wallType: { ref: "T-GLASS30" }, baseLevel: { ref: "L0" }, baseOffset: 0, height: CLUB, flipped: false }, params: { Phase: "New" } });
  wall("W-FX", "Fitness beam, east glass screen", [31000, yC(31000)], [31000, arcY(31000)], "T-GLASS30", { height: CLUB });
  wall("W-ENT", "Entrance glazing", A2, [43000, 14000], "T-GLASS30", { height: GAR });
  // changing beam compartments: technical, women, showers and WCs, men, first aid, WC
  const parts = [12000, 18000, 24000, 30000, 34000];
  // partitions run into the leaning wall: at the plan cut (1.2 m) its inner face has moved out about 170 mm
  parts.forEach((x, i) => wall(`W-P${i + 1}`, "Changing beam partition", [x, yS(x)], [x, yC(x)], "T-VFS-RC150", { height: 3000 }));
  // the clubroom above the changing beam: a glass wall to the terrace, a concrete end to the west
  wall("W-CLN", "Clubroom glass to terrace", [14000, yC(14000)], [37500, yC(37500)], "T-GLASS30", { baseLevel: { ref: "L1" }, height: ROOF - CLUB });
  wall("W-CLW", "Clubroom west end", [14000, yS(14000) - 600], [14000, yC(14000)], "T-VFS-RC250", { baseLevel: { ref: "L1" }, height: ROOF - CLUB });

  // ---------------------------------------------------------------- openings: the slits, the 21 m slice, the garage doors
  const op = (id, host, at, sill, w, h) => add({ id, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at: Math.round(at), sill, w, h }, farProfile: null, depth: "through" } });
  [12500, 17000, 21500, 27000, 32000].forEach((x, i) => op(`OP-SL${i + 1}`, "W-S1", 38000 - x, 600, 150, 2200));
  op("OP-SLICE", "W-S1", 38000 - 26000, CLUB + 900, 21000, 900);
  const lanes = [45500, 50700, 55900, 61100, 66300];
  lanes.forEach((x, i) => op(`OP-G${i + 1}`, "W-GN", x - 43000, 0, 5000, 4600));
  [53500, 58700].forEach((x, i) => op(`OP-R${i + 1}`, "W-S2", 70000 - x, 0, 4900, 6100));
  // doors from the fitness beam into the changing compartments, and the entrance
  let dn = 0;
  const door = (host, at, type, flip) => { const id = `OP-D${++dn}`; op(id, host, at, 0, type === "T-DOOR1200G" ? 1200 : 915, type === "T-DOOR1200G" ? 2600 : 2100); add({ id: `D${dn}`, type: "Door", args: { fills: { ref: id }, doorType: { ref: type }, flipHand: !!flip, flipFacing: false, clearance: "None" }, params: { Phase: "New", Mark: `D${String(dn).padStart(2, "0")}` } }); };
  [[10000], [15000], [21000], [27000], [32000], [35700]].forEach(([x]) => door("W-C", Math.hypot(x - 8000, yC(x) - yC(8000)), "T-DOOR915", false));
  door("W-ENT", 3000, "T-DOOR1200G", false);
  door("W-CLN", Math.hypot(30000 - 14000, yC(30000) - yC(14000)), "T-DOOR1200G", true);

  // ---------------------------------------------------------------- slabs: ground, clubroom floor, terrace, roof
  const fl = (id, name, boundary, level, type = "T-VFS-SLAB300") => add({ id, type: "Floor", name, args: { boundary: boundary.map(rnd), floorType: { ref: type }, level: { ref: level }, heightOffset: 0 } });
  const footprint = [[8000, yS(8000)], [70000, yS(70000)], [72000, 14000], [43000, 14000], A2, ...arcPts(A2[0], A0[0]).slice(1), [8000, yC(8000)]];
  fl("FL-G", "Ground slab", footprint, "L0");
  fl("FL-CLUB", "Clubroom floor", [[8000, yS(8000)], [37500, yS(37500)], [37500, yC(37500)], [8000, yC(8000)]], "L1");
  fl("FL-TER", "Terrace over the fitness beam", [[8000, yC(8000)], [31600, yC(31600)], ...arcPts(31600, A0[0]), A0], "L1");
  fl("FL-ROOF", "Roof over the clubroom", [[14000, yS(14000)], [37500, yS(37500)], [37500, yC(37500)], [14000, yC(14000)]], "LR");
  add({ id: "LG", type: "Level", name: "Garage roof", args: { name: "Garage roof", elevation: GAR } });
  fl("FL-ROOF2", "Roof over the entrance hall and garage", [[37500, yS(37500)], [70000, yS(70000)], [72000, 14000], [43000, 14000], A2, ...arcPts(A2[0], 31000).slice(1), [31000, yC(31000)], [37500, yC(37500)]], "LG");

  // ---------------------------------------------------------------- the canopy: a blade hung from the main beam, carried west on thin columns
  const canopy = [[21000, 17900], [40000, 18300], [73500, 17200], [73500, 14000], [43000, 14000], [40000, 15700]];
  add({ id: "GM-CAN", type: "Generic", name: "Canopy blade (cantilever 4 m, then 12 m on along its axis)", args: { boundary: canopy, level: { ref: "L0" }, baseOffset: GAR + 300, height: 300, ifcClass: "IfcSlab", material: "M-VFS-CONC", colour: "" } });
  [[25000, 17800], [29000, 17450], [32000, 17100], [34500, 16700], [37000, 16300]].forEach((p, i) => add({ id: `C${i + 1}`, type: "Column", name: `Canopy column ${i + 1}`, args: { position: p, columnType: { ref: "T-VFS-COL120" }, baseLevel: { ref: "L0" }, height: GAR + 300, rotation: 0 }, params: { Mark: `C${i + 1}` } }));

  // ---------------------------------------------------------------- lockers, the stair, the sliding door leaves, the engines' lanes
  [[11000, 17000], [18500, 24500], [25500, 30500]].forEach(([x0, x1], i) => {
    const o = 450, d = 600;
    add({ id: `GM-LK${i + 1}`, type: "Generic", name: `Locker unit ${i + 1} (${i === 2 ? "stainless" : "steel"})`, args: { boundary: [[x0, yC(x0) + o], [x1, yC(x1) + o], [x1, yC(x1) + o + d], [x0, yC(x0) + o + d]].map(rnd), level: { ref: "L0" }, baseOffset: 0, height: 2100, ifcClass: "IfcFurniture", material: i === 2 ? "M-VFS-SS" : "M-STEEL", colour: "" } });
  });
  add({ id: "ST1", type: "Stair", name: "Cantilevered precast stair to the clubroom", args: { baseLevel: { ref: "L0" }, topLevel: { ref: "L1" }, flights: [{ from: [37200, 8400], to: [31700, 8400] }], width: 1100, material: "M-VFS-CONC", railings: "Right" } });
  lanes.forEach((x, i) => add({ id: `GM-SD${i + 1}`, type: "Generic", name: `Sliding door leaf ${i + 1} (brushed aluminium, about 23 m²)`, args: { boundary: [[x - 2500, 14200], [x + 2500, 14200], [x + 2500, 14260], [x - 2500, 14260]], level: { ref: "L0" }, baseOffset: 0, height: 4600, ifcClass: "IfcDoor", material: "M-VFS-ALU", colour: "" } }));

  // ---------------------------------------------------------------- rooms
  const space = (id, name, anchor, level, number, dept = "Fire station") => add({ id, type: "Space", name, args: { level: { ref: level }, upperLimit: { mode: "offset", offset: level === "L0" ? CLUB : ROOF - CLUB }, anchor: rnd(anchor), boundaryAt: "finishFace" }, params: { Number: number, Department: dept, Occupancy: 0 } });
  const mid = (a, b) => (a + b) / 2;
  space("SP1", "Technical", [10000, mid(yS(10000), yC(10000))], "L0", "01");
  space("SP2", "Changing, women (10)", [15000, mid(yS(15000), yC(15000))], "L0", "02");
  space("SP3", "Showers and WCs", [21000, mid(yS(21000), yC(21000))], "L0", "03");
  space("SP4", "Changing, men (25)", [27000, mid(yS(27000), yC(27000))], "L0", "04");
  space("SP5", "First aid", [32000, mid(yS(32000), yC(32000))], "L0", "05");
  space("SP6", "WC", [35700, mid(yS(35700), yC(35700))], "L0", "06");
  space("SP7", "Fitness", [20000, 9500], "L0", "07");
  space("SP8", "Garage, five engines", [58000, 7000], "L0", "08");
  space("SP9", "Clubroom", [26000, mid(yS(26000), yC(26000))], "L1", "11");

  // ---------------------------------------------------------------- views
  const vr = (top, cut, bottom, depth) => ({ top, cut, bottom, depth });
  const CLIP = [-4000, -5000, 76000, 21000];
  add({ id: "V-G", type: "PlanView", name: "Ground Floor Plan", args: { level: { ref: "L0" }, scale: 150, viewRange: vr(2300, 1200, -500, -500), detailLevel: "Medium", style: { ref: "VS-CONSTRUCTION" }, clip: { rect: CLIP, visible: false, active: true } } });
  add({ id: "V-1", type: "PlanView", name: "Clubroom Floor Plan", args: { level: { ref: "L1" }, scale: 150, viewRange: vr(2300, 1200, -500, -3400), detailLevel: "Medium", style: { ref: "VS-CONSTRUCTION" }, clip: { rect: CLIP, visible: false, active: true } } });
  add({ id: "V-R", type: "PlanView", name: "Roof Plan", args: { level: { ref: "LR" }, scale: 150, viewRange: vr(2000, 1500, -500, -7000), detailLevel: "Coarse", style: { ref: "VS-CONSTRUCTION" }, clip: { rect: CLIP, visible: false, active: true } } });
  // the five lanes at 60°, as the floor's light slots draw them
  lanes.forEach((x, i) => { const dx = -0.5, dy = -0.866, t = 13800 / 0.866 * (i >= 3 ? 1 : 0.62);
    add({ id: `DL-LANE${i + 1}`, type: "DetailLine", args: { curve: line([x, 13800], [x + dx * t, 13800 + dy * t]), pen: "thin", lineStyle: "Hidden", view: { ref: "V-G" }, layer: "Lanes", colour: "#5a5a5a" } }); });
  const elev = (id, name, a, b, depth, scale = 150) => add({ id, type: "ElevationView", name, args: { line: line(a, b), depth, scale, baseLevel: { ref: "L0" }, top: 9000, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Coarse", clip: { rect: null, visible: false, active: false } } });
  elev("V-E-S", "South Elevation (from the road)", [76000, -6000], [-4000, -6000], 30000);
  elev("V-E-N", "North Elevation", [-4000, 22000], [76000, 22000], 30000);
  elev("V-E-E", "East Elevation", [76000, 21000], [76000, -5000], 80000, 100);
  elev("V-E-W", "West Elevation", [-4000, -5000], [-4000, 21000], 80000, 100);
  const sec = (id, name, a, b, depth, scale = 100) => add({ id, type: "SectionView", name, args: { line: line(a, b), depth, scale, baseLevel: { ref: "L0" }, top: 9000, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Medium", clip: { rect: null, visible: false, active: false } } });
  sec("V-S-A", "Section A-A (long, through the changing beam and clubroom)", [75000, 4500], [-3000, 4500], 20000, 150);
  sec("V-S-B", "Section B-B (across the beams)", [26000, -5000], [26000, 20000], 12000);
  sec("V-S-C", "Section C-C (across the garage)", [56000, -5000], [56000, 20000], 20000);
  add({ id: "V-3D", type: "View3D", name: "Axonometric from the south-west", args: { camera: { azimuth: 215, elevation: 30, target: [36000, 8000, 3000] }, scale: 150, style: { ref: "VS-CONSTRUCTION" }, visualStyle: "Shaded", render: { mode: "lines", hidden: false, rasterDPI: 300, silhouetteWeight: 0.35 } } });
  add({ id: "V-3D2", type: "View3D", name: "Axonometric from the north-east", args: { camera: { azimuth: 35, elevation: 28, target: [36000, 8000, 3000] }, scale: 250, style: { ref: "VS-CONSTRUCTION" }, visualStyle: "Shaded", render: { mode: "lines", hidden: false, rasterDPI: 300, silhouetteWeight: 0.35 } } });
  add({ id: "SC1", type: "Schedule", name: "Room Schedule", args: { of: "IfcSpace", fields: ["Number", "Name", "Area"] } });
  add({ id: "SC2", type: "Schedule", name: "Door Schedule", args: { of: "IfcDoor", fields: ["Mark", "TypeMark", "Width", "Height"] } });

  // notes on the ground plan: what each move does
  const note = (id, content, at, target, view = "V-G") => add({ id, type: "Text", args: { content, position: rnd(at), rotation: 0, textType: { ref: "TT-25" }, wrapWidth: 60, leaders: target ? [{ side: "left", elbow: [at[0] - 1500, at[1]], target: rnd(target), arrow: "AR-DOT", attachment: "middle" }] : [], view: { ref: view } } });
  note("TX1", "70 m south wall: leans out 8° over the changing beam, cut only by slits", [6000, -3800], [20000, yS(20000)]);
  note("TX2", "Canopy: 4 m out from the main beam, 12 m on along its axis on thin columns", [20000, 19800], [30000, 17500]);
  note("TX3", "Five engines in lanes at 60°; sliding doors hung from the main beam", [50000, 19800], [55900, 14000]);
  note("TX4", "Tilted glass wall, about 90 m²", [66000, -3800], [71000, 7000]);
  note("TX5", "Curved frameless glass, over 29 m", [8000, 15500], [16000, 11300]);
  note("TX6", "Golden wall, leaning out", [-2000, 10500], [8700, 7600]);
  note("TX7", "Terrace over the fitness beam; 21 m slice of window in the 70 m wall", [6000, 15000], [20000, 9000], "V-1");
  note("TX0", "STUDY MODEL. After the Vitra Fire Station, Zaha Hadid, 1993. Drawn from published descriptions; dimensions approximate.", [-3000, 20000], null, "V-R");

  // ---------------------------------------------------------------- sheets (A1 landscape)
  const sheet = (id, number, name, vps) => add({ id, type: "Sheet", name: `${number} ${name}`, args: { number, sheetName: name, size: "A1", orientation: "landscape", titleBlock: { ref: "SY-TB-A1" }, viewports: vps.map(([view, at], i) => ({ id: `VP${i + 1}`, view: { ref: view }, at, clipVisible: false })), revision: "P01" } });
  sheet("SH-A000", "A-000", "Axonometrics", [["V-3D", [330, 360]], ["V-3D2", [660, 200]], ["SC1", [140, 110]], ["SC2", [390, 110]]]);
  sheet("SH-A100", "A-100", "Ground and Clubroom Plans", [["V-G", [420, 420]], ["V-1", [420, 180]]]);
  sheet("SH-A101", "A-101", "Roof Plan", [["V-R", [420, 300]]]);
  sheet("SH-A200", "A-200", "Elevations", [["V-E-S", [420, 490]], ["V-E-N", [420, 350]], ["V-E-E", [230, 160]], ["V-E-W", [620, 160]]]);
  sheet("SH-A300", "A-300", "Sections", [["V-S-A", [420, 460]], ["V-S-B", [230, 190]], ["V-S-C", [620, 190]]]);

  doc.graph.layout = {};
  doc.browser = { organisation: "by-discipline", expanded: ["Views", "Sheets"] };
  doc.regenerate();
  return doc;
}
