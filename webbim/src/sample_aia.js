//! AIA North Carolina Headquarters Building, Raleigh NC (Frank Harmon Architect, 08 12 08): a four-level bar on a
//! site rising south - a cafe and exhibit level dug in under the lobby and multi-purpose room, the AIA's offices and a
//! tenant floor over them - under one shed roof rising north, its north face a standing-seam skin with a ribbon window,
//! its south face ship-lap siding with storefronts, a clerestory under the eave and a green screen at the lobby.
//! Read off the set's plans (A201-A202), elevations (A301-A302) and section (A402): x east from grid 01 (grids at 12',
//! 11 at 116'), y north from grid B (A at 30'), in feet converted to mm. Heights from the cafe floor (323'-0").

import { fhaProject, ft, FT, PT } from "./sample_fha.js";

export function buildAiaSample() {
  const H = fhaProject("AIA North Carolina\nHeadquarters Building", { number: "0801", issued: "08 12 08", issue: "", issueDate: "", place: "WAKE COUNTY\nNORTH CAROLINA",
    firmAddress: "706 MONTFORD STREET\nRALEIGH NORTH CAROLINA 27603", drawn: "MG/ES", checked: "FH" });
  const { doc, add, wall, floor, roof, stair, topo } = H; const RECT = H.R;
  doc.meta.surveyElevation = ft(323);
  const L = doc.lib;
  // the kit's types, and this building's own: its metal skin, ship-lap siding, a few storefront sizes
  const wt = (id, name, mark, layers) => { L.types[id] = { family: "F-BASICWALL", name, mark, layers, coreStart: 1, coreEnd: 2, params: { Function: "Exterior" } }; };
  wt("T-AIA-SKIN", "Standing seam metal panels on 2x6", "M1", [{ function: "Finish 1", thickness: 25, material: "M-FH-METAL" }, { function: "Structure", thickness: 140, material: "M-FH-STUD" }, { function: "Finish 2", thickness: 16, material: "M-FH-GYP" }]);
  wt("T-AIA-SHIP", "Ship-lap wood siding on 2x6", "S1", [{ function: "Finish 1", thickness: 19, material: "M-FH-WOOD" }, { function: "Structure", thickness: 140, material: "M-FH-STUD" }, { function: "Finish 2", thickness: 16, material: "M-FH-GYP" }]);
  const sf = (id, w, h, m) => { L.types[id] = { family: "F-CASEMENT", name: `Storefront ${w}'x${h}'`, mark: "8.1", width: ft(w), height: ft(h), frame: 50, mullions: m }; };
  sf("T-AIA-SF1045", 10, 4.5, 1); sf("T-AIA-SF2157", 20.6, 5.7, 3); sf("T-AIA-SF1157", 10.6, 5.7, 1); sf("T-AIA-SF1557", 15.2, 5.7, 2);
  sf("T-AIA-SF3097", 30, 9.7, 4); sf("T-AIA-SF2325", 21, 24.5, 3); sf("T-AIA-SF2309", 23, 9, 4); sf("T-AIA-SF1109", 10.7, 5.7, 1);

  // ---------------------------------------------------------------- levels and grids
  H.level("L-0", "CAFE + EXHIBIT", 0); H.level("L-1", "LOBBY + MULTI-PURPOSE", ft(10)); H.level("L-2", "AIA", ft(24));
  H.level("L-3", "TENANT", ft(35.5)); H.level("L-T", "TOP OF CONSTRUCTION", ft(51 + 7.75 / 12));
  const GX = [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 116];
  GX.forEach((x, i) => H.grid(`G-${i + 1}`, String(i + 1).padStart(2, "0"), PT(x, -44), PT(x, 44)));
  H.grid("G-A", "A", PT(-20, 30), PT(146, 30)); H.grid("G-B", "B", PT(-20, 0), PT(146, 0));

  // ---------------------------------------------------------------- the shed roof: 2 1/8":12 falling south, 12'-9" over the south face
  roof("RF-1", "Standing seam roof", FT([[-14, -12.8], [122, -12.8], [122, 31], [-14, 31]]), "L-0", ft(43.8), [10.2, null, null, null], { thickness: 300, material: "M-FH-METAL" });
  const r = { roof: "RF-1" };

  // ---------------------------------------------------------------- floors
  floor("FL-0", "Cafe + exhibit", FT(RECT(0.3, 0.3, 66, 29.7)), "T-FH-SOG", "L-0");
  floor("FL-1", "Lobby + multi-purpose", FT(RECT(0.3, 0.3, 115.7, 29.7)), "T-FH-CONCDECK", "L-1");
  floor("FL-2", "AIA", FT(RECT(0.3, 0.3, 115.7, 29.7)), "T-FH-CONCDECK", "L-2");
  floor("FL-2B", "Balcony", FT(RECT(18.5, -5, 36, 0.3)), "T-FH-DECK", "L-2");
  floor("FL-3", "Tenant", FT(RECT(0.3, 0.3, 115.7, 29.7)), "T-FH-CONCDECK", "L-3");

  // ---------------------------------------------------------------- walls
  // north: the cafe's and lobby's glass under the metal skin, which runs past both ends to the roof
  wall("W-NG0", PT(66, 30), PT(0, 30), "T-FH-GLASS", "L-0", "L-1", { topOffset: ft(4.5) });
  wall("W-NG1", PT(116, 30), PT(66, 30), "T-FH-GLASS", "L-1", "L-1", { topOffset: ft(4.5) });
  wall("W-N", PT(122, 30.4), PT(-14, 30.4), "T-AIA-SKIN", "L-1", "L-T", Object.assign({ baseOffset: ft(4.5) }, r));
  // south: the cafe's retaining wall, then a wall a storey, ship-lap to the roof
  wall("W-S0", PT(0, 0), PT(66, 0), "T-FH-CONC12", "L-0", "L-1");
  wall("W-S1", PT(0, 0), PT(116, 0), "T-AIA-SHIP", "L-1", "L-2"); wall("W-S2", PT(0, 0), PT(116, 0), "T-AIA-SHIP", "L-2", "L-3");
  wall("W-S3", PT(0, 0), PT(116, 0), "T-AIA-SHIP", "L-3", "L-T", r);
  // the ends
  wall("W-W", PT(0, 30), PT(0, 0), "T-FH-EXT6C", "L-0", "L-T", r); wall("W-E", PT(116, 0), PT(116, 30), "T-AIA-SHIP", "L-1", "L-T", r);
  // the cores: two stairs and the elevator, the cafe's toilets and mechanical room
  const CMU = "T-FH-CONC8";
  wall("W-C1a", PT(0.5, 21.5), PT(23.5, 21.5), CMU, "L-0", "L-T", r); wall("W-C1b", PT(23.5, 21.5), PT(23.5, 29.5), CMU, "L-0", "L-T", r);
  wall("W-C2a", PT(115.5, 21.5), PT(96, 21.5), CMU, "L-1", "L-T", r); wall("W-C2b", PT(96, 21.5), PT(96, 29.5), CMU, "L-1", "L-T", r);
  wall("W-EL1", PT(36, 29.5), PT(36, 20), CMU, "L-0", "L-3"); wall("W-EL2", PT(36, 20), PT(47, 20), CMU, "L-0", "L-3"); wall("W-EL3", PT(47, 20), PT(47, 29.5), CMU, "L-0", "L-3");
  wall("W-T1", PT(24, 0.5), PT(24, 12), "T-FH-INT4", "L-0", "L-1"); wall("W-T2", PT(24, 12), PT(66, 12), "T-FH-INT4", "L-0", "L-1");
  wall("W-T3", PT(41, 0.5), PT(41, 12), "T-FH-INT4", "L-0", "L-1"); wall("W-T4", PT(50, 0.5), PT(50, 12), "T-FH-INT4", "L-0", "L-1");
  wall("W-C0", PT(66, 0.5), PT(66, 29.5), CMU, "L-0", "L-1");
  // the AIA floor's offices along the south, the tenant floor open
  for (const x of [48, 60, 72, 84]) wall(`W-O${x}`, PT(x, 0.5), PT(x, 12), "T-FH-INT4", "L-2", "L-3");
  wall("W-OC", PT(42, 12), PT(96, 12), "T-FH-INT4", "L-2", "L-3");
  // the stairs: two flights a storey in each core
  const S1 = [{ from: PT(5, 23.6), to: PT(15.5, 23.6) }, { from: PT(15.5, 27.6), to: PT(5, 27.6) }], S2 = [{ from: PT(111, 23.6), to: PT(100.5, 23.6) }, { from: PT(100.5, 27.6), to: PT(111, 27.6) }];
  [["L-0", "L-1"], ["L-1", "L-2"], ["L-2", "L-3"]].forEach(([a, b], i) => stair(`ST-1${i}`, "Stair 000", a, b, S1, { width: ft(3.7) }));
  [["L-1", "L-2"], ["L-2", "L-3"]].forEach(([a, b], i) => stair(`ST-2${i}`, "Stair 100", a, b, S2, { width: ft(3.7) }));
  // the terrace steps down the west side, from the lobby's terrace to the cafe
  stair("ST-T", "Terrace steps", "L-0", "L-1", [{ from: PT(-16, -14), to: PT(-44, -14) }], { width: ft(22), railings: "None", args: { maxRiser: 165, material: "M-FH-CONC" } });
  floor("FL-TR", "Lobby terrace", FT(RECT(-16, -26, 0, 0)), "T-FH-SOG", "L-1");

  // ---------------------------------------------------------------- windows, doors, the green screen and the balcony
  const w = H.window, d = H.door;
  for (let i = 0; i < 9; i++) w(`WN-SC${i}`, "W-S3", ft(6 + 12 * i), "T-AIA-SF1045", ft(2.1));
  w("WN-S21", "W-S2", ft(52.3), "T-AIA-SF2157", ft(2.1)); w("WN-S22", "W-S2", ft(77.7), "T-AIA-SF1157", ft(2.1)); w("WN-S23", "W-S2", ft(104), "T-AIA-SF1557", ft(2.1));
  d("DR-S2", "W-S2", ft(29.7), "T-FH-D60G");
  d("DR-S1", "W-S1", ft(29.7), "T-FH-D60G"); w("WN-S1", "W-S1", ft(72.5), "T-AIA-SF2309", 0);
  w("WN-N2", "W-N", ft(122 - 82.3), "T-AIA-SF3097", ft(9.9));
  w("WN-W", "W-W", ft(19.5), "T-AIA-SF2325", ft(10));
  w("WN-E", "W-E", ft(17), "T-AIA-SF1109", ft(16.1)); d("DR-E", "W-E", ft(6), "T-FH-D30G");
  add({ id: "RL-GS", type: "Railing", name: "Green screen", args: { level: { ref: "L-1" }, path: FT([[37, -2], [111, -2]]), height: ft(13), postSpacing: ft(12), postSize: 100, infill: "Mesh", material: "M-FH-STEEL" } });
  add({ id: "RL-B", type: "Railing", name: "Balcony rail", args: { level: { ref: "L-2" }, path: FT([[18.7, 0], [18.7, -4.8], [35.8, -4.8], [35.8, 0]]), height: 1067, postSpacing: ft(4), postSize: 60, infill: "Rails", material: "M-FH-STEEL" } });

  // ---------------------------------------------------------------- the ground: rising south and east; the lobby terrace at the lobby's floor
    const contours = [];
  for (let c = 1; c <= 9; c++) { const pts = []; for (let x = -70; x <= 190; x += 26) { const y = 30 - (c - 3 - 0.05 * x) / 0.2; if (y > -80 && y < 110) pts.push([ft(x), ft(y)]); } if (pts.length >= 2) contours.push({ z: ft(c), points: pts }); }
  // south of the building the ground levels off at the lobby terrace's height
  contours.push({ z: ft(9.8), points: FT([[-70, -30], [190, -30]]) }, { z: ft(9.8), points: FT([[-70, -80], [190, -80]]) });
  // building pads: the cafe dug in to its floor, the lobby's east half on its own
  topo("TS-1", "Existing grade", contours, FT(RECT(-70, -80, 190, 110)), -ft(10), [{ boundary: FT(RECT(-1, -1, 66, 31)), z: -ft(0.5) }, { boundary: FT(RECT(66, -1, 117, 31)), z: ft(9.5) }, { boundary: FT(RECT(-16, -26, -1, -1)), z: ft(9.7) }]);
  [[-40, 60, 34], [150, 70, 30], [160, -30, 28], [60, -60, 30], [-50, -60, 26]].forEach(([x, y, c], i) => add({ id: `PL-${i + 1}`, type: "Planting", name: "Existing tree", args: { position: PT(x, y), topo: { ref: "TS-1" }, form: "Deciduous", canopy: ft(c), height: ft(c * 1.7), trunk: ft(c / 30), existing: true } }));

  // ---------------------------------------------------------------- views
  const PC = [ft(-50), ft(-40), ft(150), ft(42)];
  H.plan("V-P0", "PLAN cafe + exhibit", "L-0", { top: 2300, cut: 1200, bottom: -300, depth: -600 }, PC, 100);
  H.plan("V-P1", "PLAN lobby + multi-purpose", "L-1", { top: 2300, cut: 1200, bottom: -300, depth: -3500 }, PC, 100);
  H.plan("V-P2", "PLAN aia", "L-2", { top: 2300, cut: 1200, bottom: -300, depth: -4000 }, PC, 100);
  H.plan("V-P3", "PLAN tenant", "L-3", { top: 2300, cut: 1200, bottom: -300, depth: -4000 }, PC, 100);
  H.plan("V-PR", "ROOF PLAN", "L-T", { top: ft(10), cut: ft(8), bottom: -ft(60), depth: -ft(62) }, PC, 100, "VS-FH-SITE");
  const EZ = [-ft(6), ft(58)];
  H.elev("V-W", "ELEVATION west", PT(-60, -45), PT(-60, 60), ft(100), "L-0", [ft(10), EZ[0], ft(100), EZ[1]], 100);
  H.elev("V-N", "ELEVATION north", PT(-40, 60), PT(160, 60), ft(80), "L-0", [ft(10), EZ[0], ft(200), EZ[1]], 100);
  H.elev("V-E", "ELEVATION east", PT(170, 60), PT(170, -45), ft(100), "L-0", [ft(10), EZ[0], ft(100), EZ[1]], 100);
  H.elev("V-S", "ELEVATION south", PT(160, -45), PT(-60, -45), ft(80), "L-0", [ft(10), EZ[0], ft(215), EZ[1]], 100);
  H.sect("V-X", "SECTION", PT(31, -30), PT(31, 45), ft(6), "L-0", [ft(-2), EZ[0], ft(76), EZ[1]], 50);
  H.view3d("V-3D", "AXONOMETRIC", { azimuth: 215, elevation: 24, target: [ft(58), ft(12), ft(20)] }, 200);

  // ---------------------------------------------------------------- sheets: the set's, on ARCH D, the strip at the right
  const pl = p0 => H.place(p0, [0, 0], [ft(50), ft(0)], PC, 100, 96);
  H.sheet("A201", "Ground Level Plans", [["V-P0", pl([283.8, 433.4])], ["V-P1", pl([283.8, 133.3])]]);
  H.sheet("A202", "AIA NC + Tenant Level Plans", [["V-P2", pl([283.8, 433.4])], ["V-P3", pl([283.8, 133.3])]]);
  const ev = (p0, s, crop) => H.place(p0, [s, 0], [(crop[0] + crop[2]) / 2, ft(25)], crop, 100, 96);
  H.sheet("A301", "Elevations", [["V-W", ev([217.4, 405.7], ft(30), [ft(10), EZ[0], ft(100), EZ[1]])], ["V-N", ev([642.2, 48.7], ft(160), [ft(10), EZ[0], ft(200), EZ[1]])]]);
  H.sheet("A302", "Elevations", [["V-E", ev([613.4, 405.7], ft(45), [ft(10), EZ[0], ft(100), EZ[1]])], ["V-S", ev([331.9, 43.7], ft(60), [ft(10), EZ[0], ft(215), EZ[1]])]]);
  H.sheet("A402", "Section", [["V-X", H.place([406.6, 147.5], [ft(15), 0], [ft(37), ft(25)], [ft(-2), EZ[0], ft(76), EZ[1]], 50, 48)]]);
  H.sheet("A901", "Axonometric", [["V-3D", [420, 300]]]);
  doc.regenerate();
  return doc;
}
