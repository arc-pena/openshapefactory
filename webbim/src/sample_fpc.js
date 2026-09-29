//! First Presbyterian Church, Raleigh NC - New Construction and Renovation (Frank Harmon Architect PA, permit set
//! 04 18 2011): a three-storey brick education building (grids 1-7 by A-E, a basement under it, stair and elevator
//! towers over the roof deck) set against the existing church - the gabled sanctuary and chancel, the steeple with its
//! pinnacles and octagonal spire, the narthex's gable of round-arched windows, the Vanguard and Fellowship halls and
//! Baucom Parlor - under their slate roofs, on a site falling south.
//! Read off the set's plans (A201-A204) and elevations (A301): x east from grid 1, y north from grid E, in feet
//! converted to mm. Heights from the addition's ground floor (346'-7"); the existing ground floor is 4'-10" above it.

import { fhaProject, ft, FT, PT } from "./sample_fha.js";

export function buildFpcSample() {
  const H = fhaProject("First Presbyterian Church\nNew Construction and Renovation", { number: "0701", issued: "04 18 2011", issue: "", issueDate: "", county: "WAKE COUNTY\nNC",
    firm: "FRANK HARMON  ARCHITECT PA", firmAddress: "706  MOUNTFORD AVENUE\nRALEIGH NORTH CAROLINA 27603", drawn: "JC", checked: "FH", place: "Raleigh, NC" });
  const { doc, add, wall, walls, floor, roof, stair, topo } = H; const RECT = H.R;
  doc.meta.surveyElevation = ft(346 + 7 / 12);

  // ---------------------------------------------------------------- levels and grids (the addition's)
  H.level("L-B", "ADDITION BASEMENT LEVEL", -ft(4 + 2 / 12)); H.level("L-1", "ADDITION GROUND LEVEL", 0); H.level("L-EX", "EXISTING GROUND LEVEL", ft(4 + 10 / 12));
  H.level("L-2", "ADDITION SECOND LEVEL", ft(17 + 4 / 12)); H.level("L-3", "ADDITION THIRD LEVEL", ft(29 + 4 / 12));
  H.level("L-R", "ADDITION TOP OF ROOF DECK", ft(43)); H.level("L-TW", "ADDITION TOP OF TOWER", ft(48 + 2 / 12));
  const GX = [0, 17.17, 34.33, 48.33, 62.33, 78.58, 92.71], GY = { E: 0, D: 10, C: 29.3, B: 47.33, A: 59 };
  GX.forEach((x, i) => H.grid(`G-${i + 1}`, String(i + 1), PT(x, 70), PT(x, -10)));
  for (const [n, y] of Object.entries(GY)) H.grid(`G-${n}`, n, PT(-14, y), PT(108, y));

  // ---------------------------------------------------------------- the education building: brick to a 3' parapet over the roof deck
  const BR = "T-FH-BRICK", C = [-6.83, -1.83, 96.83, 61.5];
  walls("W-AD-", FT([[C[0], C[1]], [C[2], C[1]], [C[2], C[3]], [C[0], C[3]]]), BR, "L-B", "L-R", { topOffset: ft(3), closed: true });
  for (const [id, lv, ty] of [["FL-AB", "L-B", "T-FH-SOG"], ["FL-A1", "L-1", "T-FH-CONCDECK"], ["FL-A2", "L-2", "T-FH-CONCDECK"], ["FL-A3", "L-3", "T-FH-CONCDECK"], ["FL-AR", "L-R", "T-FH-CONCDECK"]])
    floor(id, "Addition floor", FT(RECT(C[0] + 0.5, C[1] + 0.5, C[2] - 0.5, C[3] - 0.5)), ty, lv);
  // the stair towers (to the top of tower) and the elevator's shaft
  const CMU = "T-FH-CONC8";
  wall("W-ST1a", PT(14.8, 61.2), PT(14.8, 48.5), CMU, "L-B", "L-TW"); wall("W-ST1b", PT(14.8, 48.5), PT(-6.5, 48.5), CMU, "L-B", "L-TW");
  wall("W-ST2a", PT(73, -1.5), PT(73, 8.5), CMU, "L-B", "L-TW"); wall("W-ST2b", PT(73, 8.5), PT(96.5, 8.5), CMU, "L-B", "L-TW");
  walls("W-EL", FT([[61, 61.2], [61, 49.4], [70.6, 49.4], [70.6, 61.2]]), CMU, "L-B", "L-R");
  // the towers' own walls over the roof, and their roofs
  walls("W-TW1", FT([[-6.83, 48.5], [-6.83, 61.5], [14.8, 61.5]]), BR, "L-R", "L-TW", { topOffset: ft(1) });
  walls("W-TW2", FT([[73, -1.83], [96.83, -1.83], [96.83, 8.5]]), BR, "L-R", "L-TW", { topOffset: ft(1) });
  floor("FL-TW1", "Stair tower roof", FT(RECT(-6.5, 48.8, 14.5, 61.2)), "T-FH-CONCDECK", "L-TW"); floor("FL-TW2", "Stair tower roof", FT(RECT(73.3, -1.5, 96.5, 8.2)), "T-FH-CONCDECK", "L-TW");
  // the stairs: two flights a storey, each tower
  const U1 = [{ from: PT(-4.5, 51.1), to: PT(8.5, 51.1) }, { from: PT(8.5, 58.6), to: PT(-4.5, 58.6) }], U2 = [{ from: PT(76, 0.6), to: PT(89.5, 0.6) }, { from: PT(89.5, 6.4), to: PT(76, 6.4) }];
  [["L-B", "L-1"], ["L-1", "L-2"], ["L-2", "L-3"], ["L-3", "L-R"]].forEach(([a, b], i) => { stair(`ST-1${i}`, "Stair 102/202/302", a, b, U1, { width: ft(3.7) }); stair(`ST-2${i}`, "Stair 103/203/303", a, b, U2, { width: ft(3.7) }); });
  // the connector to the existing buildings: one storey, glazed
  walls("W-CN", FT([[32.4, 61.5], [32.4, 75.5]]), BR, "L-1", "L-2", { topOffset: -ft(0.33) });
  floor("FL-CN", "Connector", FT(RECT(32.4, 61.5, 75, 75.5)), "T-FH-CONCDECK", "L-1"); floor("FL-CNR", "Connector roof", FT(RECT(32.4, 61.5, 75, 75.5)), "T-FH-CONCDECK", "L-2", -ft(0.33));

  // windows: east and west faces, the second floor's short and the third floor's tall, the ground floor's storefronts
  const w = H.window, d = H.door, SX = [14.4, 20.7, 27, 33.3, 39.6];
  // east wall runs south to north from its start (-1.83); west wall north to south
  SX.forEach((y, i) => { w(`WN-E3${i}`, "W-AD-2", ft(y + 1.83), "T-FH-W3686", ft(33.9)); w(`WN-E2${i}`, "W-AD-2", ft(y + 1.83), "T-FH-W3654", ft(22.35)); });
  w("WN-E12", "W-AD-2", ft(4.3), "T-FH-W44", ft(34.5)); w("WN-E1", "W-AD-2", ft(20.8), "T-FH-SF1509", ft(4.17 + 1));
  d("DR-E1", "W-AD-2", ft(35.1), "T-FH-DRD9");
  [0, 1, 2].forEach(k => w(`WN-ET${k}`, "W-AD-2", ft(54), "T-FH-W24", ft(4.17) + [ft(2), ft(19.3), ft(31.3)][k]));
  const WY = [45, 38.8, 32.4, 26.2, 19.9, 14];
  WY.forEach((y, i) => { w(`WN-W3${i}`, "W-AD-4", ft(61.5 - y), "T-FH-W3686", ft(33.9)); w(`WN-W2${i}`, "W-AD-4", ft(61.5 - y), "T-FH-W3654", ft(22.35)); });
  w("WN-W12", "W-AD-4", ft(61.5 - 56.8), "T-FH-W44", ft(34.5));
  w("WN-W1a", "W-AD-4", ft(61.5 - 38.7), "T-FH-SF1509", ft(4.17)); d("DR-W1", "W-AD-4", ft(61.5 - 26.6), "T-FH-D809G"); w("WN-W1b", "W-AD-4", ft(61.5 - 17), "T-FH-SF1009", ft(4.17));
  w("WN-W1t", "W-AD-4", ft(61.5 - 29.2), "T-FH-SF3406", ft(4.17 + 10));
  // south: the classrooms' windows over the new roof below
  [8, 24, 40, 56].forEach((x, i) => { w(`WN-S3${i}`, "W-AD-1", ft(x + 6.83), "T-FH-W3686", ft(0.4) + ft(33.5)); w(`WN-S2${i}`, "W-AD-1", ft(x + 6.83), "T-FH-W3654", ft(0.85) + ft(21.5)); });

  // ---------------------------------------------------------------- the existing church: brick bearing walls on the existing ground floor
  const EX = "L-EX", ER = "L-2", HR = -ft(0.33);                  // the halls' flat roofs: 17'-0", just under the second level
  // the sanctuary and chancel: one gable over both, 38 degrees, its ends (west and east) walls up to the roof
  roof("RF-S", "Sanctuary roof", FT([[-7, 132], [90, 132], [90, 198], [-7, 198]]), "L-1", ft(19.6), [38, null, 38, null], { thickness: 300, material: "M-FH-SLATE" });
  const rS = { roof: "RF-S" };
  wall("W-S-S", PT(-6, 133), PT(89, 133), BR, EX, "L-3", rS); wall("W-S-E", PT(89, 133), PT(89, 197), BR, EX, "L-TW", rS);
  wall("W-S-N", PT(89, 197), PT(-6, 197), BR, EX, "L-3", rS); wall("W-S-W", PT(-6, 197), PT(-6, 133), BR, EX, "L-TW", rS);
  floor("FL-S", "Sanctuary floor", FT(RECT(-5.5, 133.5, 88.5, 196.5)), "T-FH-WOOD", EX);
  // the narthex: its own steep gable facing east
  roof("RF-N", "Narthex roof", FT([[88, 144], [111, 144], [111, 182], [88, 182]]), "L-1", ft(25.7), [51, null, 51, null], { thickness: 250, material: "M-FH-SLATE" });
  const rN = { roof: "RF-N" };
  wall("W-N-S", PT(89, 145), PT(110, 145), BR, EX, "L-R", rN); wall("W-N-E", PT(110, 145), PT(110, 181), BR, EX, "L-TW", rN); wall("W-N-N", PT(110, 181), PT(89, 181), BR, EX, "L-R", rN);
  floor("FL-N", "Narthex floor", FT(RECT(89, 145.5, 109.5, 180.5)), "T-FH-WOOD", EX);
  // the steeple: a square brick tower, four pinnacles, an octagonal spire
  walls("W-T-", FT([[93, 184], [109, 184], [109, 200], [93, 200]]), BR, EX, null, { height: ft(39) - ft(4.83), closed: true });
  floor("FL-T", "Tower floor", FT(RECT(93.5, 184.5, 108.5, 199.5)), "T-FH-WOOD", EX);
  const oct = Array.from({ length: 8 }, (_, i) => [101 + 8 * Math.cos((i + 0.5) * Math.PI / 4), 192 + 8 * Math.sin((i + 0.5) * Math.PI / 4)]);
  roof("RF-T", "Spire", FT(oct), "L-1", ft(39), oct.map(() => 81), { thickness: 150, material: "M-FH-SLATE" });
  [[93.5, 184.5], [108.5, 184.5], [108.5, 199.5], [93.5, 199.5]].forEach(([x, y], i) => {
    add({ id: `PN-${i + 1}`, type: "Column", name: "Pinnacle", args: { position: PT(x, y), columnType: { ref: "T-FH-PIN" }, baseLevel: { ref: EX }, baseOffset: 0, height: ft(50) - ft(4.83), rotation: 0 } });
    roof(`RF-P${i + 1}`, "Pinnacle cap", FT(RECT(x - 1.5, y - 1.5, x + 1.5, y + 1.5)), "L-1", ft(50), [80, 80, 80, 80], { thickness: 100, material: "M-FH-SLATE" });
  });
  // the halls south of the sanctuary: Vanguard (flat, parapet), Fellowship (hipped), Baucom Parlor (hipped), the kitchen wing (flat)
  const pp = { topOffset: HR + ft(1.5) }, hr = { topOffset: HR };
  wall("W-V-W", PT(-6, 133), PT(-6, 62), BR, EX, ER, pp); wall("W-V-S", PT(-6, 62), PT(34, 62), BR, EX, ER, pp); wall("W-V-E", PT(34, 62), PT(34, 133), BR, EX, ER, pp);
  floor("FL-V", "Vanguard floor", FT(RECT(-5.5, 62.5, 33.5, 132.5)), "T-FH-WOOD", EX); floor("FL-VR", "Vanguard roof", FT(RECT(-5.5, 62.5, 33.5, 132.5)), "T-FH-CONCDECK", ER, HR);
  roof("RF-F", "Fellowship roof", FT([[33, 93], [79, 93], [79, 134], [33, 134]]), "L-1", ft(17), [36, 36, 36, 36], { thickness: 250, material: "M-FH-SLATE" });
  wall("W-F-S", PT(34, 94), PT(78, 94), BR, EX, ER, hr); wall("W-F-E", PT(78, 94), PT(78, 133), BR, EX, ER, hr);
  floor("FL-F", "Fellowship floor", FT(RECT(34.5, 94.5, 77.5, 132.5)), "T-FH-WOOD", EX);
  roof("RF-B", "Baucom Parlor roof", FT([[77, 93], [106, 93], [106, 134], [77, 134]]), "L-1", ft(17), [40, 40, 40, 40], { thickness: 250, material: "M-FH-SLATE" });
  wall("W-B-S", PT(78, 94), PT(105, 94), BR, EX, ER, hr); wall("W-B-E", PT(105, 94), PT(105, 133), BR, EX, ER, hr); wall("W-B-N", PT(105, 133), PT(89, 133), BR, EX, ER, hr);
  floor("FL-B", "Baucom Parlor floor", FT(RECT(78.5, 94.5, 104.5, 132.5)), "T-FH-WOOD", EX);
  wall("W-K-S", PT(34, 75.5), PT(98, 75.5), BR, EX, ER, pp); wall("W-K-E", PT(98, 75.5), PT(98, 94), BR, EX, ER, pp);
  floor("FL-K", "Kitchen wing floor", FT(RECT(34.5, 76, 97.5, 93.5)), "T-FH-WOOD", EX); floor("FL-KR", "Kitchen wing roof", FT(RECT(34.5, 76, 97.5, 93.5)), "T-FH-CONCDECK", ER, HR);

  // the church's openings: lancets in the sanctuary's west gable, round heads along the halls, the narthex's three, the steeple's
  const e = ft(4.83);
  w("WN-SW1", "W-S-W", ft(24.1), "T-FH-WPT36", ft(14.8)); w("WN-SW2", "W-S-W", ft(37.6), "T-FH-WPT36", ft(14.8));
  [15, 30, 45, 60, 75].forEach((x, i) => w(`WN-SN${i}`, "W-S-N", ft(89 - x), "T-FH-WPT36", ft(2.5)));
  [14.1, 24, 34, 44, 53.5].forEach((u, i) => w(`WN-VW${i}`, "W-V-W", ft(u), "T-FH-WRD36", ft(4)));
  [10.7, 20.6, 30.5].forEach((u, i) => w(`WN-NE${i}`, "W-N-E", ft(u), "T-FH-WRD72", ft(11.9)));
  d("DR-NE", "W-N-S", ft(10.5), "T-FH-DRD4");
  [9, 18, 27].forEach((u, i) => w(`WN-BE${i}`, "W-B-E", ft(u), "T-FH-WRD36", ft(3)));
  ["W-T-1", "W-T-2", "W-T-3", "W-T-4"].forEach((h, i) => w(`WN-T${i}`, h, ft(8), "T-FH-WPT30", ft(20)));
  d("DR-T", "W-T-2", ft(4), "T-FH-DRD4");
  // the new stair and ramp up the west side to the Vanguard's door
  add({ id: "RA-1", type: "Ramp", name: "New ramp", args: { baseLevel: { ref: "L-1" }, baseOffset: ft(1.8), topLevel: { ref: "L-EX" }, topOffset: 0, runs: [{ from: PT(-11, 172), to: PT(-11, 136) }], width: ft(5), railings: "Both", infill: "Balusters", railHeight: 1067, material: "M-FH-CONC" } });

  // ---------------------------------------------------------------- the ground, falling to the south; the street trees
  const contours = [[4.3, 230], [4, 140], [3, 110], [2, 90], [1, 72], [0, 40], [-1, -12], [-2, -30]].map(([el, y]) => ({ z: ft(el), points: [-40, 0, 40, 80, 120, 150].map(x => [ft(x), ft(y + 0.02 * (x - 50))]) }));
  topo("TS-1", "Existing grade", contours, FT(RECT(-40, -40, 150, 230)), -ft(12));
  [[-24, 150, 30], [-24, 100, 26], [-24, 30, 28], [125, 60, 32], [125, 140, 30], [60, -25, 24]].forEach(([x, y, c], i) => add({ id: `PL-${i + 1}`, type: "Planting", name: "Street tree", args: { position: PT(x, y), topo: { ref: "TS-1" }, form: "Deciduous", canopy: ft(c), height: ft(c * 1.6), trunk: ft(c / 30), existing: true } }));

  // ---------------------------------------------------------------- views
  const PC = [ft(-16), ft(-12), ft(116), ft(212)];
  H.plan("V-A201", "BASEMENT LEVEL PLAN", "L-B", { top: 2300, cut: 1200, bottom: -300, depth: -600 }, PC, 100);
  H.plan("V-A202", "GROUND LEVEL PLAN", "L-1", { top: 2300, cut: 1500, bottom: -300, depth: -1800 }, PC, 100);
  const PU = [ft(-12), ft(-6), ft(102), ft(66)];
  H.plan("V-A203a", "SECOND LEVEL PLAN", "L-2", { top: 2300, cut: 1200, bottom: -300, depth: -600 }, PU, 100);
  H.plan("V-A203b", "THIRD LEVEL PLAN", "L-3", { top: 2300, cut: 1200, bottom: -300, depth: -600 }, PU, 100);
  H.plan("V-A204", "ROOF PLAN", "L-TW", { top: ft(60), cut: ft(50), bottom: -ft(52), depth: -ft(53) }, PC, 100, "VS-FH-SITE");
  const EZ = [-ft(8), ft(86)];
  // west looks east (north on the left); east looks west (south on the left)
  H.elev("V-W", "WEST ELEVATION", PT(-30, -20), PT(-30, 215), ft(160), "L-1", [ft(-2), EZ[0], ft(236), EZ[1]], 100);
  H.elev("V-E", "EAST ELEVATION", PT(125, 215), PT(125, -20), ft(160), "L-1", [ft(-2), EZ[0], ft(236), EZ[1]], 100);
  H.sect("V-X1", "SECTION", PT(40, 215), PT(40, -12), ft(8), "L-1", [ft(-2), EZ[0], ft(228), ft(60)], 100);
  H.view3d("V-3D", "AXONOMETRIC", { azimuth: 235, elevation: 28, target: [ft(50), ft(100), ft(20)] }, 200);

  // ---------------------------------------------------------------- sheets: the set's, upright ARCH D, the band along the foot
  const up = { orientation: "portrait", titleBlock: "SY-TB-FHAB" }, c = [ft(50), ft(100)], pl = (p0, crop) => H.place(p0, [0, 0], crop === PU ? [ft(45), ft(30)] : c, crop || PC, 100, 96);
  H.sheet("A201", "Basement Level Plan", [["V-A201", pl([67.3, 119.3])]], "ARCH D", up);
  H.sheet("A202", "Ground Level Plan", [["V-A202", pl([76.9, 119.3])]], "ARCH D", up);
  H.sheet("A203", "Second + Third Level New Education Bldg", [["V-A203a", pl([88.6, 119.3], PU)], ["V-A203b", pl([89.6, 560.6], PU)]], "ARCH D", up);
  H.sheet("A204", "Roof Plan", [["V-A204", pl([75.1, 119.9])]], "ARCH D", up);
  // the elevations sheet is the set's only landscape one, with the firm's strip along its right edge
  const el = (p0, m, crop) => H.place(p0, m, [(crop[0] + crop[2]) / 2, ft(30)], crop, 100, 96);
  H.sheet("A301", "E+W Elevations", [["V-W", el([617.3, 330.2], [ft(156), 0], [ft(-2), EZ[0], ft(236), EZ[1]])], ["V-E", el([200, 30.3], [ft(20), 0], [ft(-2), EZ[0], ft(236), EZ[1]])]], "ARCH D");
  H.sheet("A901", "Axonometric", [["V-3D", [305, 480]]], "ARCH D", up);
  doc.regenerate();
  return doc;
}
