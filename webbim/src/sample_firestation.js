//! A study model of the Vitra Fire Station (Zaha Hadid, 1993, Weil am Rhein). The plan is set out from drawn
//! plans of the building at their stated scale, checked against their figured dimensions (the changing wing's
//! south wall 33.05 m, the fitness wing's west end 6.05 m); heights are read from elevation views and
//! photographs. Approximate throughout: a reading of the building, not a survey of it. What it keeps:
//!
//! - the garage: a trapezoid whose five lanes run parallel to the equipment room's east wall; four sliding doors
//!   under the main beam on the street side;
//! - the equipment room: a wedge north of the garage, its long north-west wall the edge of the recreation court;
//! - the wing, cutting into the street at an angle: the fitness space and an open men's changing area with two
//!   free-standing locker runs; a closed strip of women's changing, WCs and first aid along the south wall; two
//!   mechanical rooms in a wedge at the west end, split from the fitness space by a V;
//! - the club room over the entrance and the east end of the wing, rotated off the wing and cantilevered over the
//!   court, its stair rising along the south glazing; the roof terrace over the fitness space;
//! - the garage roof in two planes, folded along a line from the equipment room's prow;
//! - the canopy: two planes from a root over the entrance to a point beyond the east end, folded on the line from
//!   the outer root to the top of the tie-hole wall: the root plane tips its underside toward the street, the tip
//!   plane turns up to the point; it stands on the main beam and a cluster of steel tubes, seven upright, four leaning;
//! - the tie-hole wall: the south wall carried 16 m past the doors, its top climbing with the canopy, its end raked;
//! - the garage's east end: tilted glass under a concrete band that oversails it;
//! - the stair: an upstand along the opening and a fan of steel rods over the flight.
//!
//! Coordinates in mm: x east along the garage's south wall, y north; the origin is the garage's south-west corner.

import { newDocument } from "./bim.js";
import { Editor } from "./ops.js";

export function buildFireStationSample() {
  const doc = newDocument("Fire Station Study");
  const ed = new Editor(doc);
  const add = (element) => { const r = ed.apply({ op: "add", element }, { regenerate: false }); if (!r.ok) throw new Error(`${element.id || element.type}: ${r.error}`); return r.id; };
  const rnd = p => [Math.round(p[0]), Math.round(p[1])];
  const line = (a, b) => ({ type: "line", start: rnd(a), end: rnd(b) });
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const unit = v => { const L = Math.hypot(v[0], v[1]); return [v[0] / L, v[1] / L]; };
  const off = (p, v, d) => [p[0] + v[0] * d, p[1] + v[1] * d];
  const along = (a, b, d) => off(a, unit(sub(b, a)), d);
  // where the line through p along v meets the line through a and b
  const meet = (p, v, a, b) => { const w = sub(b, a), t = ((a[0] - p[0]) * w[1] - (a[1] - p[1]) * w[0]) / (v[0] * w[1] - v[1] * w[0]); return [p[0] + v[0] * t, p[1] + v[1] * t]; };
  const centroid = pts => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  doc.meta.name = "Fire Station Study";
  const L = doc.lib;

  // ---------------------------------------------------------------- materials and types
  const mat = (id, name, mark, cut, proj, shade) => { L.materials[id] = { name, mark, description: name, cut, projection: proj, shading: { colour: shade } }; };
  const concCut = { pattern: "P-CONC", pen: "heavy", lineColour: "#1b1f24", background: "#e4e4e1" };
  mat("M-VFS-CONC", "Exposed concrete, cast in situ, board-smooth", "CN-01", concCut, { pen: "thin" }, "#cfcdc6");
  // the big garage walls show their formwork: tie holes on a 1200 x 1500 grid, drawn wherever the face is seen
  L.patterns["P-VFS-TIE"] = { name: "Tie holes, 1200 × 1500 grid (model)", kind: "model", lines: [{ angle: 0, origin: [600, 750], delta: [0, 1500], dashes: [70, -1130] }] };
  mat("M-VFS-TIE", "Exposed concrete, cast in situ, tie holes left open", "CN-02", concCut, { pen: "thin", pattern: "P-VFS-TIE", patternColour: "#4a4a4a" }, "#cfcdc6");
  mat("M-VFS-ALU", "Brushed aluminium", "AL-01", { pattern: null, pen: "medium", lineColour: "#1b1f24", background: "#e0e3e6" }, { pen: "thin" }, "#b9bec4");
  mat("M-VFS-SS", "Stainless steel", "SS-03", { pattern: null, pen: "medium", lineColour: "#1b1f24", background: "#eef0f2" }, { pen: "thin" }, "#c8ccd0");
  const wt = (id, name, mark, layers, fn = "Exterior") => { L.types[id] = { family: "F-BASICWALL", name, mark, layers, coreStart: 0, coreEnd: layers.length, params: { Function: fn } }; };
  wt("T-VFS-RC300", "Exposed concrete 300", "C30", [{ function: "Structure", thickness: 300, material: "M-VFS-CONC" }]);
  wt("T-VFS-TIE300", "Exposed concrete 300, tie holes", "C31", [{ function: "Structure", thickness: 300, material: "M-VFS-TIE" }]);
  wt("T-VFS-RC250", "Exposed concrete 250", "C25", [{ function: "Structure", thickness: 250, material: "M-VFS-CONC" }]);
  wt("T-VFS-RC150", "Concrete partition 150, rendered", "C15", [{ function: "Structure", thickness: 150, material: "M-VFS-CONC" }], "Interior");
  L.types["T-VFS-SLAB300"] = Object.assign({}, L.types["T-SLAB300"], { name: "Concrete slab 300, no upstand or flashing", mark: "S30" });
  L.types["T-VFS-CHS168"] = { family: "F-COLUMN", name: "Steel tube Ø168", mark: "C1", width: 168, depth: 168, shape: "CHS", thick: 10, material: "M-STEEL" };

  // ---------------------------------------------------------------- levels
  const CLUB = 3600, ROOF = 7200;
  add({ id: "L0", type: "Level", name: "Ground", args: { name: "Ground", elevation: 0 } });
  add({ id: "L1", type: "Level", name: "Club room and terrace", args: { name: "Club room and terrace", elevation: CLUB } });
  add({ id: "LR", type: "Level", name: "Roof", args: { name: "Roof", elevation: ROOF } });

  // ---------------------------------------------------------------- setting out (mm)
  const P = {
    // the wing: fitness (north), the V, the mechanical wedge, the changing strip along the south wall
    FN_W: [-49110, -200], FS_W: [-44670, -4250], V: [-30950, -2570], MNW: [-39060, -4550], MSW: [-37700, -8130],
    ME_S: [-29530, -6400], MP_N: [-34080, -3330], MP_S: [-32340, -7020],
    CB_NW: [-19430, -470], CB_SW: [-18510, -4120], CB_NE: [-6250, 1150], CE_N: [-6630, 2440], CS_E: [-5470, -1490],
    // the entrance, the equipment room and the garage
    J: [-4140, 4390], ENT_SW: [-6290, 1250], SW_A: [-1060, 1610], SW_B: [-2560, 4370],
    EQ_TIP: [-17110, 17100], EQ_NE: [-7200, 13370], EQ_NWE: [-5830, 6000], EQ_E1: [-6540, 11730], EQ_E2: [-3570, 5720],
    GP1: [-2290, 13330], GP2: [-1270, 13210], GN_S: [3020, 12980], G_NE: [20340, 11740], NB_END: [27360, 11350],
    G_SW: [0, 0], T0: [24670, 0], G_SE: [31310, 0], SB_END: [40760, 0],
    // the club room, a floor up
    CL_NW: [-24030, 4930], CL_NE: [-2640, 3050], CL_SE: [-3140, 0], CL_SG: [-6290, 0], CL_SW: [-27000, -130], DB_END: [11090, 1830],
    ST_B: [-8540, 1590], ST_T: [-14380, 840], TRI1: [-15170, 3440], TRI2: [-11650, 3040], TRI3: [-9160, 3450],
    // the roof planes and the canopy
    R_A: [-18470, 18960], R_NW: [-10030, 15860], R_NE: [22620, 13620], R_SE: [32910, 0],
    C_W1: [-1950, 1020], C_NE: [38960, 150], C_TIP: [44790, -5570], C_W2: [-60, -3290],
  };
  const wingN = sub(P.J, P.FN_W);
  const FN_CL = meet(P.FN_W, wingN, P.CL_SW, P.CL_NW);              // the club room's west wall crosses the wing's north wall
  const X1 = meet(P.FN_W, wingN, P.CL_NW, P.CL_NE);                 // ... and so does its north wall, further east
  const SEPN = meet(P.CE_N, [0, 1], P.FN_W, P.J);                   // the entrance's open side, up to the north wall
  const PE = meet(P.ENT_SW, sub(P.SW_A, P.ENT_SW), P.CL_SE, P.CL_NE); // where the entrance screen leaves the club room's underside
  const CE0 = meet(P.CE_N, sub(P.CS_E, P.CE_N), P.CL_SW, P.CL_SG);   // the changing strip's east wall under the club room's glazing

  // the roof planes: the garage roof folds along R_A - R_SE, its north plane rising 800 mm to the north-east corner;
  // the canopy is one plane through its root (5.0 m and 5.3 m) and its tip (10.2 m), all to the top surface
  const crease = unit(sub(P.R_SE, P.R_A)), up = [-crease[1], crease[0]];
  const riseN = 800, runN = (P.R_NE[0] - P.R_A[0]) * up[0] + (P.R_NE[1] - P.R_A[1]) * up[1];
  const zN = p => ROOF + Math.max(0, ((p[0] - P.R_A[0]) * up[0] + (p[1] - P.R_A[1]) * up[1]) * riseN / runN);
  // the canopy: two planes folded on the line from its outer root to the top of the tie-hole wall's raked end. The
  // root plane rides the main beam and the wall, its underside tipped toward the street; the tip plane turns up
  // toward the street to the point. Heights to the top surface
  const CANT = 400, cz = { W1: 5400, NE: 9500, TIP: 11500, W2: 4600 };
  const plane = (a, b, c) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const gx = -n[0] / n[2], gy = -n[1] / n[2], pitch = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI;
    return { pitch, dir: Math.atan2(gy, gx) * 180 / Math.PI, tv: CANT / Math.cos(pitch * Math.PI / 180), top: p => a[2] + gx * (p[0] - a[0]) + gy * (p[1] - a[1]) };
  };
  const canIn = plane([...P.C_W1, cz.W1], [...P.C_NE, cz.NE], [...P.C_W2, cz.W2]), canOut = plane([...P.C_W2, cz.W2], [...P.C_NE, cz.NE], [...P.C_TIP, cz.TIP]);
  const side = p => { const a = sub(P.C_NE, P.C_W2), b = sub(p, P.C_W2); return Math.sign(a[0] * b[1] - a[1] * b[0]); };
  const canOf = p => side(p) === side(P.C_W1) ? canIn : canOut;
  const canUnder = p => { const c = canOf(p); return c.top(p) - c.tv; };

  // ---------------------------------------------------------------- walls
  const wall = (id, name, a, b, type, extra = {}) => add({ id, type: "Wall", name, args: Object.assign({ centreline: line(a, b), mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: "L0" }, baseOffset: 0, height: CLUB, flipped: false }, extra), params: { Phase: "New" } });
  const up1 = (h, extra = {}) => Object.assign({ baseLevel: { ref: "L1" }, height: h }, extra);
  const RC300 = "T-VFS-RC300", RC250 = "T-VFS-RC250", RC150 = "T-VFS-RC150", GLASS = "T-GLASS30", TIE = "T-VFS-TIE300";
  // the wing: the terrace parapets stand 1.1 m above the roof; the two west ends lean out
  wall("W-FN1", "North wall, fitness (terrace parapet)", P.FN_W, FN_CL, RC300, { height: CLUB + 1100 });
  wall("W-FN2", "North wall, changing area", FN_CL, P.J, RC300);
  wall("W-FW", "Fitness, west end (leans out 15°)", P.FS_W, P.FN_W, RC300, { height: CLUB + 1100, slope: { top: 0, lean: 15 } });
  wall("W-FS", "Fitness, south wall (terrace parapet)", P.FS_W, P.V, RC300, { height: CLUB + 1100 });
  wall("W-MN", "Mechanical, north wall", P.MNW, P.V, RC250, { height: CLUB + 400 });
  wall("W-MW", "Mechanical, west end (leans out 12°)", P.MSW, P.MNW, RC300, { height: CLUB + 400, slope: { top: 0, lean: 12 } });
  wall("W-S", "South wall of the wing, cut by slits", P.MSW, P.CS_E, RC300, { height: CLUB + 400 });
  wall("W-ME", "Mechanical, east wall", P.V, P.ME_S, RC250);
  wall("W-MP", "Mechanical, partition", P.MP_N, P.MP_S, RC150);
  // the closed strip: women's changing, WCs, first aid
  const boxDir = unit(sub(P.CB_SW, P.CB_NW));
  wall("W-CW", "Changing strip, west wall", P.CB_NW, P.CB_SW, RC250);
  wall("W-CN", "Changing strip, north wall", P.CB_NW, P.CB_NE, RC250);
  wall("W-CE", "Changing strip and entrance, east wall", P.CE_N, P.CS_E, RC250);
  const P9N = [-13240, 310], P10N = [-10080, 660], P9S = meet(P9N, boxDir, P.MSW, P.CS_E), P10S = meet(P10N, boxDir, P.MSW, P.CS_E);
  wall("W-P9", "Partition, women's changing and WCs", P9N, P9S, RC150);
  wall("W-P10", "Partition, WCs and first aid", P10N, P10S, RC150);
  // the men's WCs against the south wall
  const sDir = unit(sub(P.CS_E, P.MSW)), nIn = [-sDir[1], sDir[0]];
  const wcFoot = [9150, 10920, 12740].map(d => along(P.MSW, P.CS_E, d)), wcHead = wcFoot.map(p => off(p, nIn, 1700));
  wcFoot.forEach((p, i) => wall(`W-WC${i + 1}`, "WC partition", p, wcHead[i], RC150));
  wall("W-WCF", "WC front", wcHead[0], wcHead[2], RC150);
  // the entrance: a glass screen under the club room, full height where the garage roof is over it
  wall("W-ENT1", "Entrance screen", P.ENT_SW, PE, GLASS, { height: CLUB - 300 });
  wall("W-ENT2", "Entrance screen, under the garage roof", PE, P.SW_A, GLASS, { height: ROOF - 300 });
  wall("W-ENG", "Entrance glazing to the garage", P.J, P.SW_B, GLASS, { height: ROOF - 300 });
  wall("W-GSW1", "Garage, west wall", P.SW_B, P.SW_A, RC300, { height: ROOF });
  wall("W-GSW2", "Garage, west wall", P.SW_A, P.G_SW, RC300, { height: ROOF });
  // the equipment room: a wedge, its north-west wall the court's edge, its east wall standing free in the garage
  wall("W-EQN", "Equipment room, north wall", P.EQ_TIP, P.EQ_NE, RC300, { height: ROOF });
  wall("W-EQW", "Equipment room, north-west wall", P.EQ_TIP, P.EQ_NWE, RC300, { height: ROOF });
  wall("W-EQG", "Equipment room, glazing to the court", P.EQ_NWE, P.J, GLASS, { height: ROOF - 300 });
  wall("W-EQE", "Equipment room, east wall (free-standing)", P.EQ_E1, P.EQ_E2, RC250, { height: ROOF });
  // the garage's north side: glazing under a beam, then the north wall carried past the corner as a blade
  wall("W-GNG1", "Garage, north glazing", P.EQ_NE, P.GP1, GLASS, { height: 4600 });
  wall("W-GNP", "Garage, north pier", P.GP1, P.GP2, RC300, { height: Math.round(zN(P.GP2)) });
  wall("W-GNG2", "Garage, north glazing", P.GP2, P.GN_S, GLASS, { height: 4600 });
  const hdr = [Math.round(zN(P.EQ_NE) - 300 - 4600), Math.round(zN(P.GN_S) - 300 - 4600)];
  wall("W-GNH", "Garage, beam over the north glazing", P.EQ_NE, P.GN_S, RC300, up1(Math.max(...hdr), { baseOffset: 1000, topProfile: [[0, hdr[0]], [Math.round(dist(P.EQ_NE, P.GN_S)), hdr[1]]] }));
  const LGN = dist(P.GN_S, P.NB_END), LGN1 = dist(P.GN_S, P.G_NE);
  wall("W-GN", "Garage, north wall, carried east as a blade", P.GN_S, P.NB_END, TIE, { height: 8400, topProfile: [[0, Math.round(zN(P.GN_S))], [Math.round(LGN1), Math.round(zN(P.G_NE))], [Math.round(LGN - 1800), 8400], [Math.round(LGN), 0]] });
  // the east end: tilted glass to the height of the club room floor, then a concrete band set 0.9 m out over it
  wall("W-GE", "Garage, east end: tilted glass (leans out 8°)", P.G_NE, P.G_SE, GLASS, { height: CLUB, slope: { top: 0, lean: 8 } });
  const eD = unit(sub(P.G_SE, P.G_NE)), eOut = [-eD[1], eD[0]];
  const bandN = meet(off(P.G_NE, eOut, 900), eD, P.GN_S, P.NB_END), bandS = meet(off(P.G_NE, eOut, 900), eD, P.G_SW, P.SB_END), LB = dist(bandN, bandS);
  wall("W-GE2", "Garage, east end: concrete band over the glass", bandN, bandS, TIE, up1(Math.round(zN(bandN) - 300 - CLUB), { topProfile: [[0, Math.round(zN(bandN) - 300 - CLUB)], [Math.round(LB), Math.round(zN(bandS) - 300 - CLUB)]] }));
  // the street side: the door wall under the main beam, then the tie-hole wall rising to 8.4 m, its end raked 12°
  // where the canopy's underside climbs past the roof, the main beam climbs with it to carry it
  const LGS = dist(P.G_SW, P.T0), zT0 = Math.round(canUnder(P.T0));
  let lo = 0, hi = LGS; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (canUnder(along(P.G_SW, P.T0, m)) < ROOF) lo = m; else hi = m; }
  wall("W-GS", "Garage, south wall: door wall and main beam", P.G_SW, P.T0, RC300, { height: zT0, topProfile: [[0, ROOF], [Math.round(lo), ROOF], [Math.round(LGS), zT0]] });
  const LT = dist(P.T0, P.SB_END), TOPEND = along(P.T0, P.SB_END, LT - 1800), zTE = Math.round(canUnder(TOPEND));
  wall("W-TIE", "Tie-hole wall: its top carries the canopy", P.T0, P.SB_END, TIE, { height: zTE, topProfile: [[0, zT0], [Math.round(LT - 1800), zTE], [Math.round(LT), 0]] });
  // the club room: rotated off the wing, its north wall cantilevered over the court and carried into the garage
  wall("W-CLN", "Club room, north wall (cantilevers over the court)", P.CL_NW, P.CL_NE, RC250, up1(ROOF - CLUB));
  wall("W-CLE", "Club room, east wall", P.CL_NE, P.CL_SE, RC250, up1(ROOF - CLUB));
  wall("W-CLS", "Club room, south wall on the main beam's line", P.CL_SE, P.CL_SG, RC250, up1(ROOF - CLUB));
  wall("W-CLG", "Club room, south glazing", P.CL_SW, P.CL_SG, GLASS, up1(ROOF - CLUB));
  wall("W-CLW", "Club room, west end (leans out 10°)", P.CL_SW, P.CL_NW, RC250, up1(ROOF - CLUB, { slope: { top: 0, lean: 10 } }));
  wall("W-DB", "Downstand: the club room's north wall carried into the garage", P.CL_NE, P.DB_END, RC250, up1(ROOF - CLUB - 1100, { baseOffset: 1100 }));

  // ---------------------------------------------------------------- openings: slits, garage doors
  const op = (id, host, at, sill, w, h) => add({ id, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at: Math.round(at), sill, w, h }, farProfile: null, depth: "through" } });
  // the wing's south wall: a low horizontal slot, a tall slit, a small square, a long slot
  [[3130, 1900, 1100, 250], [15040, 600, 150, 2000], [20570, 2800, 250, 250], [27300, 2300, 3900, 220]].forEach(([at, sill, w, h], i) => op(`OP-SL${i + 1}`, "W-S", at, sill, w, h));
  // the lanes run parallel to the equipment room's east wall; a door in each of the four western bays
  const laneDir = unit(sub(P.EQ_E2, P.EQ_E1));
  const laneTops = [[-1970, 13180], [3150, 12860], [8260, 12540], [13370, 12170], [18490, 11850]];
  const laneFeet = laneTops.map(p => meet(p, laneDir, P.G_SW, P.G_SE));
  const doorsAt = [0, 1, 2, 3].map(i => (laneFeet[i][0] + laneFeet[i + 1][0]) / 2);
  doorsAt.forEach((x, i) => op(`OP-G${i + 1}`, "W-GS", x, 0, 4600, 4600));
  let dn = 0;
  const door = (host, a, p, type, flip) => { const id = `OP-D${++dn}`, w = type === "T-DOOR1200G" ? 1200 : 915; op(id, host, dist(a, p), 0, w, type === "T-DOOR1200G" ? 2600 : 2100); add({ id: `D${dn}`, type: "Door", args: { fills: { ref: id }, doorType: { ref: type }, flipHand: !!flip, flipFacing: false, clearance: "None" }, params: { Phase: "New", Mark: `D${String(dn).padStart(2, "0")}` } }); };
  door("W-ENT1", P.ENT_SW, along(P.ENT_SW, PE, 2300), "T-DOOR1200G", false);
  door("W-ENG", P.J, along(P.J, P.SW_B, 800), "T-DOOR1200G", false);
  door("W-ME", P.V, along(P.V, P.ME_S, 1100), "T-DOOR915", false);
  door("W-MN", P.MNW, along(P.MNW, P.V, 900), "T-DOOR915", false);
  door("W-MP", P.MP_N, along(P.MP_N, P.MP_S, 900), "T-DOOR915", false);
  door("W-CN", P.CB_NW, along(P.CB_NW, P.CB_NE, 1500), "T-DOOR915", false);
  door("W-P9", P9N, along(P9N, P9S, 1700), "T-DOOR915", false);
  door("W-CN", P.CB_NW, along(P.CB_NW, P.CB_NE, 12400), "T-DOOR915", true);
  door("W-WCF", wcHead[0], centroid([wcHead[0], wcHead[1]]), "T-DOOR915", false);
  door("W-WCF", wcHead[0], centroid([wcHead[1], wcHead[2]]), "T-DOOR915", false);
  door("W-CLW", P.CL_SW, along(P.CL_SW, P.CL_NW, 1300), "T-DOOR1200G", true);

  // ---------------------------------------------------------------- slabs
  const fl = (id, name, boundary, level) => add({ id, type: "Floor", name, args: { boundary: boundary.map(rnd), floorType: { ref: "T-VFS-SLAB300" }, level: { ref: level }, heightOffset: 0 } });
  let ne = 0;
  const loopEls = pts => pts.map((a, i) => ({ id: `e${++ne}`, type: "line", a: rnd(a), b: rnd(pts[(i + 1) % pts.length]) }));
  const flHoles = (id, name, outer, holes, level) => add({ id, type: "Floor", name, args: { boundary: outer.map(rnd), floorType: { ref: "T-VFS-SLAB300" }, level: { ref: level }, heightOffset: 0, sketch: { elements: [outer, ...holes].flatMap(loopEls), constraints: [], dims: [] } } });
  fl("FL-G", "Ground slab", [P.FN_W, P.J, P.EQ_NWE, P.EQ_TIP, P.EQ_NE, P.GN_S, P.G_NE, P.G_SE, P.G_SW, P.SW_A, P.ENT_SW, P.CS_E, P.MSW, P.MNW, P.V, P.FS_W], "L0");
  // the club room's floor: the stair's opening along the glazing, and the triangular hole by the north wall
  const club = [P.CL_SW, P.CL_NW, P.CL_NE, P.CL_SE, P.CL_SG];
  const stU = unit(sub(P.ST_T, P.ST_B)), stN = [stU[1], -stU[0]];           // along the stair (west), and across it (north)
  const B0 = off(P.ST_B, stU, -50), T1 = off(P.ST_T, stU, 50);
  const stHole = [off(B0, stN, -650), off(B0, stN, 650), off(T1, stN, 650), off(T1, stN, -650)];
  flHoles("FL-CLUB", "Club room floor", club, [stHole, [P.TRI1, P.TRI2, P.TRI3]], "L1");
  fl("FL-TER", "Roof terrace over the fitness space", [P.FN_W, FN_CL, P.CL_SW, P.V, P.FS_W], "L1");
  fl("FL-WR", "Roof over the changing strip and the mechanical wedge", [P.MNW, P.V, P.CL_SW, P.CL_SG, CE0, P.CS_E, P.MSW], "L1");
  fl("FL-WR2", "Roof over the changing area, north of the club room", [X1, P.J, P.CL_NE], "L1");
  fl("FL-CROOF", "Club room roof", club, "LR");
  fl("FL-GES", "Soffit over the east glass", [P.G_NE, P.G_SE, meet(off(P.G_NE, eOut, 1050), eD, P.G_SW, P.SB_END), meet(off(P.G_NE, eOut, 1050), eD, P.GN_S, P.NB_END)], "L1");
  fl("FL-GROOF", "Garage roof, south plane", [P.R_A, P.R_SE, P.CL_SE, P.CL_NE], "LR");
  const dirN = Math.atan2(up[1], up[0]) * 180 / Math.PI, pitchN = Math.atan(riseN / runN) * 180 / Math.PI;
  const roof = (id, name, boundary, pivot, z, pitch, direction, thickness = 300) => add({ id, type: "Roof", name, args: { boundary: boundary.map(rnd), holes: [], level: { ref: "L0" }, heightOffset: Math.round(z), pivot: rnd(pivot), pitch: +pitch.toFixed(3), direction: +direction.toFixed(3), thickness, material: "M-VFS-CONC", colour: "", rafterCut: "Plumb", edgeSlopes: [], ridgeHeight: 0 } });
  roof("RF-N", "Garage roof, north plane (folds up to the north-east)", [P.R_NW, P.R_NE, P.R_SE], P.R_A, ROOF, pitchN, dirN);
  roof("RF-CAN1", "Canopy, root plane: on the main beam and the tie-hole wall, tipped toward the street", [P.C_W1, P.C_NE, P.C_W2], P.C_W1, cz.W1, canIn.pitch, canIn.dir, CANT);
  roof("RF-CAN2", "Canopy, tip plane: turned up toward the street to the point", [P.C_W2, P.C_NE, P.C_TIP], P.C_W2, cz.W2, canOut.pitch, canOut.dir, CANT);

  // ---------------------------------------------------------------- the steel tubes under the canopy: seven upright, four leaning west
  [[21000, -1400], [21600, -2400], [22400, -1800], [23400, -2800], [24200, -1200], [25000, -2200], [25800, -1600]].forEach((p, i) =>
    add({ id: `C${i + 1}`, type: "Column", name: `Steel tube ${i + 1}`, args: { position: p, columnType: { ref: "T-VFS-CHS168" }, baseLevel: { ref: "L0" }, height: Math.round(canUnder(p)), rotation: 0 }, params: { Mark: `C${i + 1}` } }));
  [[-2000, 24800], [-2600, 25600], [-1000, 25200], [-3000, 26200]].forEach(([y, xb], i) => {
    const xt = xb - 1800, H = Math.round(canUnder([xt, y])), S = [xt - 300, y + 80], ub = xb - S[0], ut = xt - S[0];
    add({ id: `GM-CL${i + 1}`, type: "Generic", name: `Leaning steel tube ${i + 1}`, args: { boundary: [[0, 0], [1, 0], [1, 1]], level: { ref: "L0" }, baseOffset: 0, height: 160, ifcClass: "IfcColumn", material: "M-STEEL", colour: "",
      workPlane: { start: rnd(S), end: rnd([xb + 300, y + 80]) }, profile: [[ub - 80, 0], [ub + 80, 0], [ut + 80, H], [ut - 80, H]].map(rnd) } });
  });

  // ---------------------------------------------------------------- lockers, louvres, stair, door leaves, separators
  // two locker runs standing free in the fitness and changing space, each bent where it turns
  const run = (id, name, pts, w = 600) => {
    const L1 = [], R1 = [];
    pts.forEach((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], t = unit(sub(b, a)), n = [-t[1], t[0]]; L1.push(off(p, n, w / 2)); R1.push(off(p, n, -w / 2)); });
    add({ id, type: "Generic", name, args: { boundary: [...L1, ...R1.reverse()].map(rnd), level: { ref: "L0" }, baseOffset: 0, height: 2100, ifcClass: "IfcFurniture", material: "M-STEEL", colour: "" } });
  };
  run("GM-LK1", "Locker run 1 (steel)", [[-33480, -1500], [-31200, -510], [-27970, -360], [-25880, 370], [-22400, 1160]]);
  run("GM-LK2", "Locker run 2 (stainless)", [[-28280, -2770], [-27590, -1610], [-18900, 870], [-17870, 1780]]);
  // the louvres over the club room's glazing: eight blades, the band the street reads
  const glN = unit(sub(P.CL_SG, P.CL_SW)), glOut = [glN[1], -glN[0]], lvL = dist(P.CL_SW, P.CL_SG);
  const lvS = off(P.CL_SW, glOut, 40), lvE = off(P.CL_SG, glOut, 40);
  for (let k = 0; k < 8; k++) { const z = 900 + k * 280;
    add({ id: `GM-LV${k + 1}`, type: "Generic", name: `Louvre blade ${k + 1}`, args: { boundary: [[0, 0], [1, 0], [1, 1]], level: { ref: "L1" }, baseOffset: 0, height: 260, ifcClass: "IfcShadingDevice", material: "M-VFS-ALU", colour: "",
      workPlane: { start: rnd(lvS), end: rnd(lvE) }, profile: [[600, z], [Math.round(lvL * 0.7), z], [Math.round(lvL * 0.7), z + 50], [600, z + 50]] } }); }
  // the stair rises west along the club room's glazing: two flights and a landing
  add({ id: "ST1", type: "Stair", name: "Stair to the club room", args: { baseLevel: { ref: "L0" }, topLevel: { ref: "L1" }, flights: [{ from: rnd(P.ST_B), to: rnd(along(P.ST_B, P.ST_T, 2340)) }, { from: rnd(along(P.ST_B, P.ST_T, 3550)), to: rnd(P.ST_T) }], width: 1200, maxRiser: 180, material: "M-VFS-CONC", railings: "None" } });
  // over the flight, a solid upstand along the opening's north side, and a fan of steel rods pinned through it:
  // they gather low toward the foot of the stair and open out above the upstand's top
  const pA = off(T1, stN, 750), pB = off(B0, stN, 750), LP = dist(pA, pB);
  wall("W-STP", "Upstand to the stair opening", pA, pB, RC150, up1(1100));
  const rodLine = { start: rnd(off(pA, stN, -135)), end: rnd(off(pB, stN, -135)) }, hub = [LP * 0.74, -2300];
  [250, 650, 1050, 1450, 1850, 2250, 2650].forEach((u, i) => {
    const a = [u, 1350], b = [a[0] + (hub[0] - a[0]) * 0.72, a[1] + (hub[1] - a[1]) * 0.72];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [-(b[1] - a[1]) / L * 24, (b[0] - a[0]) / L * 24];
    add({ id: `GM-ROD${i + 1}`, type: "Generic", name: `Stair rod ${i + 1} (steel tube Ø48)`, args: { boundary: [[0, 0], [1, 0], [1, 1]], level: { ref: "L1" }, baseOffset: 0, height: 48, ifcClass: "IfcRailing", material: "M-STEEL", colour: "",
      workPlane: rodLine, profile: [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]].map(rnd) } });
  });
  // the sliding door leaves, hung outside the door wall
  doorsAt.forEach((x, i) => add({ id: `GM-SD${i + 1}`, type: "Generic", name: `Sliding door leaf ${i + 1} (brushed aluminium)`, args: { boundary: [[x - 2350, -160], [x + 2350, -160], [x + 2350, -220], [x - 2350, -220]], level: { ref: "L0" }, baseOffset: 0, height: 4700, ifcClass: "IfcDoor", material: "M-VFS-ALU", colour: "" } }));
  const sep = (id, a, b, level = "L0") => add({ id, type: "RoomSeparator", args: { line: line(a, b), level: { ref: level } } });
  sep("RS1", P.V, meet(P.V, [-0.263, 0.965], P.FN_W, P.J));            // fitness | men's changing
  sep("RS2", P.CE_N, SEPN);                                            // men's changing | entrance
  sep("RS3", P.EQ_NE, P.EQ_E1);                                        // equipment room | garage, north opening
  sep("RS4", P.EQ_E2, P.J);                                            // equipment room | garage, south opening
  sep("RS5", P.V, P.CL_SW, "L1");                                      // the terrace's edge over the changing strip

  // ---------------------------------------------------------------- rooms, numbered as the plans number them
  const space = (id, name, anchor, level, number, upper = 3300) => add({ id, type: "Space", name, args: { level: { ref: level }, upperLimit: { mode: "offset", offset: upper }, anchor: rnd(anchor), boundaryAt: "finishFace" }, params: { Number: number, Department: "Fire station", Occupancy: 0 } });
  space("SP01", "Entrance", centroid([P.J, P.SW_B, P.SW_A, P.ENT_SW, P.CE_N]), "L0", "01");
  space("SP02", "Fire engine shed", [14000, 6000], "L0", "02");
  space("SP03", "Equipment room", centroid([P.EQ_TIP, P.EQ_NE, P.EQ_E1, P.EQ_E2, P.J, P.EQ_NWE]), "L0", "03");
  space("SP05", "Fitness space", [-38000, -1000], "L0", "05");
  space("SP071", "Mechanical", centroid([P.MNW, P.MP_N, P.MP_S, P.MSW]), "L0", "07.1");
  space("SP072", "Mechanical", centroid([P.MP_N, P.V, P.ME_S, P.MP_S]), "L0", "07.2");
  space("SP08", "Men's changing room", [-24000, -1800], "L0", "08");
  space("SP081", "WC", off(centroid([wcFoot[0], wcFoot[1]]), nIn, 850), "L0", "08.1");
  space("SP082", "WC", off(centroid([wcFoot[1], wcFoot[2]]), nIn, 850), "L0", "08.2");
  space("SP09", "Women's changing room", centroid([P.CB_NW, P.CB_SW, P9N, P9S]), "L0", "09");
  space("SP091", "WCs", centroid([P9N, P9S, P10N, P10S]), "L0", "09.1");
  space("SP10", "First aid", centroid([P10N, P10S, P.CS_E, P.CB_NE]), "L0", "10");
  space("SP11", "Club room", [-15000, 2300], "L1", "11");
  space("SP12", "Roof terrace", [-40000, -1200], "L1", "12", 1000);

  // ---------------------------------------------------------------- views
  const vr = (top, cut, bottom, depth) => ({ top, cut, bottom, depth });
  const CLIP = [-54000, -14000, 50000, 24000];
  add({ id: "V-G", type: "PlanView", name: "Ground Floor Plan", args: { level: { ref: "L0" }, scale: 150, viewRange: vr(2300, 1200, -500, -500), detailLevel: "Medium", style: { ref: "VS-CONSTRUCTION" }, clip: { rect: CLIP, visible: false, active: true } } });
  add({ id: "V-1", type: "PlanView", name: "Upper Floor Plan", args: { level: { ref: "L1" }, scale: 150, viewRange: vr(2300, 1200, -500, -3600), detailLevel: "Medium", style: { ref: "VS-CONSTRUCTION" }, clip: { rect: CLIP, visible: false, active: true } } });
  add({ id: "V-R", type: "PlanView", name: "Roof Plan", args: { level: { ref: "LR" }, scale: 150, viewRange: vr(5000, 4600, -7500, -7500), detailLevel: "Coarse", style: { ref: "VS-CONSTRUCTION" }, clip: { rect: CLIP, visible: false, active: true } } });
  // on the ground plan: the lanes, and what is overhead (the canopy, the garage roof's edge, the club room's cantilever)
  const dl = (id, a, b, view, style = "Solid", colour = "#5a5a5a") => add({ id, type: "DetailLine", args: { curve: line(a, b), pen: "thin", lineStyle: style, view: { ref: view }, layer: style === "Hidden" ? "Overhead" : "Lanes", colour } });
  laneTops.forEach((p, i) => dl(`DL-LANE${i + 1}`, p, laneFeet[i], "V-G"));
  const outline = (pre, pts, view) => pts.forEach((p, i) => dl(`${pre}${i + 1}`, p, pts[(i + 1) % pts.length], view, "Hidden", "#3a3a3a"));
  outline("DL-CAN", [P.C_W1, P.C_NE, P.C_TIP, P.C_W2], "V-G");
  outline("DL-RF", [P.R_A, P.R_NW, P.R_NE, P.R_SE], "V-G");
  outline("DL-CL", [P.CL_NW, X1], "V-G");
  // elevations and sections: a view looks to the right of its line
  const elev = (id, name, a, b, depth, scale = 150) => add({ id, type: "ElevationView", name, args: { line: line(a, b), depth, scale, baseLevel: { ref: "L0" }, top: 12500, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Coarse", clip: { rect: null, visible: false, active: false } } });
  elev("V-E-S", "Street Elevation", [48000, -13000], [-52000, -13000], 40000);
  elev("V-E-N", "Court Elevation", [-52000, 23000], [48000, 23000], 40000);
  elev("V-E-E", "East End Elevation", [49000, 22000], [49000, -12000], 104000);
  elev("V-E-W", "West End Elevation", [-53000, -12000], [-53000, 22000], 104000);
  const sec = (id, name, a, b, depth, scale = 100) => add({ id, type: "SectionView", name, args: { line: line(a, b), depth, scale, baseLevel: { ref: "L0" }, top: 12500, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Medium", clip: { rect: null, visible: false, active: false } } });
  const sa = y => [y, P.ST_B[1] + (P.ST_T[1] - P.ST_B[1]) / (P.ST_T[0] - P.ST_B[0]) * (y - P.ST_B[0])];
  sec("V-S-A", "Section A-A (long, along the stair)", sa(48000), sa(-52000), 25000, 150);
  sec("V-S-B", "Section B-B (across the wing, the stair and the club room)", [-12000, -11000], [-12000, 21000], 12000);
  sec("V-S-C", "Section C-C (across the garage, the canopy and the tubes)", [23000, -11000], [23000, 21000], 25000);
  add({ id: "V-3D", type: "View3D", name: "Axonometric from the street", args: { camera: { azimuth: 298, elevation: 24, target: [2000, 2000, 3500] }, scale: 200, style: { ref: "VS-CONSTRUCTION" }, visualStyle: "Shaded", render: { mode: "lines", hidden: false, rasterDPI: 300, silhouetteWeight: 0.35 } } });
  add({ id: "V-3D2", type: "View3D", name: "Axonometric from the court", args: { camera: { azimuth: 140, elevation: 36, target: [-4000, 4000, 3500] }, scale: 300, style: { ref: "VS-CONSTRUCTION" }, visualStyle: "Shaded", render: { mode: "lines", hidden: false, rasterDPI: 300, silhouetteWeight: 0.35 } } });
  // eye-level perspectives from the street, taken where the published photographs stand
  const persp = (id, name, eye, target, scale) => { const d = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]], h = Math.hypot(d[0], d[1]);
    add({ id, type: "View3D", name, args: { camera: { azimuth: +(Math.atan2(d[1], d[0]) * 180 / Math.PI).toFixed(2), elevation: +(Math.atan2(d[2], h) * 180 / Math.PI).toFixed(2), target, distance: Math.round(Math.hypot(h, d[2])) }, scale, style: { ref: "VS-CONSTRUCTION" }, visualStyle: "Shaded", render: { mode: "lines", hidden: false, rasterDPI: 300, silhouetteWeight: 0.35 } } }); };
  persp("V-P1", "Street, east: the canopy and the tubes", [62000, -30000, 1600], [16000, -1000, 5000], 100);
  persp("V-P2", "Street, west: the wing's two ends", [-60000, -22000, 1600], [-30000, -2000, 3800], 100);
  add({ id: "SC1", type: "Schedule", name: "Room Schedule", args: { of: "IfcSpace", fields: ["Number", "Name", "Area"], filters: [{ field: "Number", op: "has a value" }], sort: [{ field: "Number" }] } });
  add({ id: "SC2", type: "Schedule", name: "Door Schedule", args: { of: "IfcDoor", fields: ["Mark", "TypeMark", "Width", "Height"], sort: [{ field: "Mark" }] } });

  // notes: what each move does
  const note = (id, content, at, target, view = "V-G") => add({ id, type: "Text", args: { content, position: rnd(at), rotation: 0, textType: { ref: "TT-25" }, wrapWidth: 60, leaders: target ? [{ side: "left", elbow: [at[0] - 1500, at[1]], target: rnd(target), arrow: "AR-DOT", attachment: "middle" }] : [], view: { ref: view } } });
  note("TX1", "04 Recreation court", [-17500, 8500], null);
  note("TX2", "06 Lockers: two free-standing runs", [-36000, 4800], [-30000, -650]);
  note("TX3", "Canopy overhead: two planes, folded; 4.6 to 5.4 m at the root, 11.5 m at the tip", [30000, -9500], [26000, -3000]);
  note("TX4", "Seven upright steel tubes, four leaning", [8000, -9500], [22500, -1900]);
  note("TX5", "Four sliding doors under the main beam; lanes parallel to the equipment room wall", [4000, 21000], [9000, 6500]);
  note("TX6", "Tie-hole wall: its top carries the canopy, rising to 9.1 m; end raked", [34000, 5000], [36000, 0]);
  note("TX7", "Club room cantilevers over the court", [-38000, 9000], P.CL_NW, "V-1");
  note("TX8", "Stair rises along the south glazing", [-16000, -7000], [-11500, 1000], "V-1");
  note("TX9", "Garage roof: two planes, folded along the line from the equipment room's prow", [4000, 21500], [6000, 12500], "V-R");
  note("TX0", "STUDY MODEL. After the Vitra Fire Station, Zaha Hadid, 1993. Plan set out from drawn plans at their scale; heights read from elevations and photographs. Dimensions approximate.", [-50000, 21500], null, "V-R");

  // ---------------------------------------------------------------- sheets (A1 landscape)
  const sheet = (id, number, name, vps) => add({ id, type: "Sheet", name: `${number} ${name}`, args: { number, sheetName: name, size: "A1", orientation: "landscape", titleBlock: { ref: "SY-TB-A1" }, viewports: vps.map(([view, at], i) => ({ id: `VP${i + 1}`, view: { ref: view }, at, clipVisible: false })), revision: "P02" } });
  sheet("SH-A000", "A-000", "Axonometrics", [["V-3D", [400, 380]], ["V-3D2", [660, 170]], ["SC1", [140, 150]], ["SC2", [380, 120]]]);
  sheet("SH-A001", "A-001", "Perspectives from the Street", [["V-P1", [420, 390]], ["V-P2", [420, 120]]]);
  sheet("SH-A100", "A-100", "Ground Floor Plan", [["V-G", [420, 320]]]);
  sheet("SH-A101", "A-101", "Upper Floor Plan", [["V-1", [420, 320]]]);
  sheet("SH-A102", "A-102", "Roof Plan", [["V-R", [420, 320]]]);
  sheet("SH-A200", "A-200", "Elevations", [["V-E-S", [420, 480]], ["V-E-N", [420, 350]], ["V-E-E", [230, 165]], ["V-E-W", [620, 165]]]);
  sheet("SH-A300", "A-300", "Sections", [["V-S-A", [420, 470]], ["V-S-B", [230, 200]], ["V-S-C", [610, 200]]]);

  doc.graph.layout = {};
  doc.browser = { organisation: "by-discipline", expanded: ["Views", "Sheets"] };
  doc.regenerate();
  return doc;
}
