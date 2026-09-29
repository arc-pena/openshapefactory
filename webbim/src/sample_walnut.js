//! Walnut Creek Urban Wetland Park, Environmental Education Center, Raleigh NC (Frank Harmon Architect, 1.22.08):
//! a long timber bar on wood piles over a wetland slope - classrooms, a lobby and an open porch under one shed roof
//! falling south over a deck, ramps and bridges down to the parking lots and a stair to the wetland.
//! Read off the set's floor plan (A201), roof plan (A203), elevations (A301) and sections (A402): x east from grid
//! 0.1 along the 8' grid (grid 1 at 24', grid 29 at 248'), y north from grid B.8 (the deck's edge; C.9 at 12', the
//! north wall G.1 at 44'), in feet converted to mm. Heights from the top of the subfloor (227'-0").

import { fhaProject, ft, FT, PT } from "./sample_fha.js";

export function buildWalnutSample() {
  const H = fhaProject("Walnut Creek Urban Wetland Park\nEnvironmental Education Center", { number: "0301", issued: "1.22.08", issue: "", issueDate: "", place: "Raleigh, NC  WAKE COUNTY",
    firmAddress: "706 MONTFORD STREET\nRALEIGH NORTH CAROLINA 27603", drawn: "ES", checked: "FH" });
  const { doc, add, wall, floor, roof, stair, topo } = H; const RECT = H.R;
  doc.meta.surveyElevation = ft(227);                           // the subfloor on the survey's datum

  // ---------------------------------------------------------------- levels and grids
  H.level("L-GRD", "GRADE", -ft(6)); H.level("L-1", "TOP OF SUBFLOOR", 0);
  H.level("L-HD", "TOP OF DOORS AND WINDOWS", ft(6 + 10 / 12)); H.level("L-TOB", "TOP OF BEAM", ft(9)); H.level("L-TOP", "TOP OF ROOF", ft(21));
  const gx = n => (n < 1 ? Math.round((n - 0.1) * 10) * 8 : 24 + 8 * (n - 1));
  for (const n of [0.1, 0.2, 0.3, ...Array.from({ length: 29 }, (_, i) => i + 1)]) H.grid(`G-${n}`, String(n), PT(gx(n), -8), PT(gx(n), 62));
  H.grid("G-G1", "G.1", PT(-10, 44), PT(260, 44)); H.grid("G-C9", "C.9", PT(-10, 12), PT(260, 12)); H.grid("G-B8", "B.8", PT(-10, 0), PT(260, 0));

  // ---------------------------------------------------------------- the roof: one shed over the bar and the deck, 6' past the north wall
  // 3 1/3:12 rising north from the deck's edge (7'-11" above the subfloor); both ends run out square (no slope)
  roof("RF-1", "Metal roof", FT([[16, 0], [252, 0], [252, 50.2], [16, 50.2]]), "L-1", ft(7.92), [15.5, null, null, null], { thickness: 400, material: "M-FH-METAL" });

  // ---------------------------------------------------------------- the floor on its piles: the bar, the deck, the west deck, the porch's landing
  floor("FL-1", "Building floor", FT(RECT(24, 12, 248, 44)), "T-FH-WOOD", "L-1");
  floor("FL-DK", "South deck", FT(RECT(16, 0, 252, 12)), "T-FH-DECK", "L-1");
  floor("FL-DKW", "West deck", FT(RECT(-4, 5, 24, 35)), "T-FH-DECK", "L-1");
  floor("FL-DKS", "Porch landing", FT(RECT(159, -32, 193, 0)), "T-FH-DECK", "L-1");
  // piles: every grid line, under the deck's edge, the south wall, two lines inside and the north wall
  const pileTop = -ft(1.55);
  const piles = []; for (let n = 1; n <= 29; n++) for (const y of [0, 12, 22.6, 32.7, 42]) piles.push([gx(n), y]);
  for (const x of [-2, 8, 16]) for (const y of [7, 19, 33]) piles.push([x, y]);
  for (const y of [-10, -21, -31]) for (const x of [160, 176, 192]) piles.push([x, y]);
  piles.forEach(([x, y], i) => add({ id: `PI-${i + 1}`, type: "Column", name: "Wood pile", args: { position: PT(x, y), columnType: { ref: "T-FH-PILE" }, baseLevel: { ref: "L-GRD" }, baseOffset: -ft(3), height: ft(9) + pileTop, rotation: 0 } }));

  // ---------------------------------------------------------------- walls: 2x6 exterior to the roof; the porch open north and south
  const X = "T-FH-EXT6", I = "T-FH-INT4", r = { roof: "RF-1" };
  wall("W-S1", PT(24, 12), PT(160, 12), X, "L-1", "L-TOP", r); wall("W-S2", PT(192, 12), PT(248, 12), X, "L-1", "L-TOP", r);
  wall("W-N1", PT(160, 44), PT(24, 44), X, "L-1", "L-TOP", r); wall("W-N2", PT(248, 44), PT(192, 44), X, "L-1", "L-TOP", r);
  wall("W-W", PT(24, 44), PT(24, 12), X, "L-1", "L-TOP", r); wall("W-E", PT(248, 12), PT(248, 44), X, "L-1", "L-TOP", r);
  wall("W-PW", PT(160, 12), PT(160, 44), X, "L-1", "L-TOP", r); wall("W-PE", PT(192, 44), PT(192, 12), X, "L-1", "L-TOP", r);
  // inside: classroom 1, storage and mechanical, the toilets, the conference room, office and storage, classroom 2, mechanical and prep
  for (const [id, x] of [["W-I1", 60], ["W-I2", 67.2], ["W-I3", 95.6], ["W-I4", 111.6], ["W-I5", 122.3], ["W-I6", 234.3]]) wall(id, PT(x, 12), PT(x, 44), I, "L-1", "L-TOP", r);
  wall("W-I7", PT(60, 28.9), PT(95.6, 28.9), I, "L-1", "L-TOP", r); wall("W-I8", PT(81.4, 28.9), PT(81.4, 44), I, "L-1", "L-TOP", r);
  wall("W-I9", PT(111.6, 28), PT(122.3, 28), I, "L-1", "L-TOP", r); wall("W-I10", PT(111.6, 20), PT(122.3, 20), I, "L-1", "L-TOP", r);
  wall("W-I11", PT(234.3, 34.2), PT(248, 34.2), I, "L-1", "L-TOP", r);

  // ---------------------------------------------------------------- windows and doors, read off the elevations (distances along each wall from its start)
  const w = H.window, d = H.door;
  // south: 4'x4' clad windows at 2'-2" over the floor; a glazed door to the deck from each room
  [27.9, 38, 42.5, 47.3, 97.5, 102.8, 123.2, 138.2, 149.8, 155.6].forEach((x, i) => w(`WN-S${i + 1}`, "W-S1", ft(x - 24), "T-FH-W44", ft(2.2)));
  [197.7, 205.7, 218.8, 223.3, 229.6, 241].forEach((x, i) => w(`WN-S${i + 11}`, "W-S2", ft(x - 192), "T-FH-W44", ft(2.2)));
  d("DR-S1", "W-S1", ft(54 - 24), "T-FH-D60G"); d("DR-S2", "W-S1", ft(107 - 24), "T-FH-D30G"); d("DR-S3", "W-S1", ft(131 - 24), "T-FH-D60G"); d("DR-S4", "W-S2", ft(212 - 192), "T-FH-D60G");
  // north: small windows at 3'-7"; classroom 2's sliding door; the lobby's and classroom 2's glass onto the porch
  [[127.4, "W-N1"], [114, "W-N1"], [110.6, "W-N1"], [94.6, "W-N1"], [58.3, "W-N1"]].forEach(([x], i) => w(`WN-N${i + 1}`, "W-N1", ft(160 - x), "T-FH-W44", ft(3.6)));
  w("WN-N6", "W-N2", ft(248 - 233.8), "T-FH-W44", ft(3.6)); d("DR-N1", "W-N2", ft(248 - 205), "T-FH-D60G");
  d("DR-P1", "W-PW", ft(12), "T-FH-D60G"); w("WN-P1", "W-PW", ft(22), "T-FH-W86", ft(0.8)); d("DR-P2", "W-PE", ft(20), "T-FH-D60G"); w("WN-P2", "W-PE", ft(10), "T-FH-W86", ft(0.8));
  // the ends: classroom 1's sliding door to the west deck, the prep area's to the east
  d("DR-W1", "W-W", ft(8), "T-FH-D60G"); d("DR-E1", "W-E", ft(10), "T-FH-D30G");
  // inside
  d("DR-I1", "W-I1", ft(4), "T-FH-D30"); d("DR-I2", "W-I3", ft(8), "T-FH-D30"); d("DR-I3", "W-I4", ft(4), "T-FH-D30"); d("DR-I4", "W-I5", ft(24), "T-FH-D30"); d("DR-I5", "W-I6", ft(26), "T-FH-D30");

  // ---------------------------------------------------------------- ramps, bridges and stairs, railings on the decks
  const M = { width: ft(7), railings: "Both", infill: "Mesh", material: "M-FH-WOOD" };
  // to the west parking lot (+225'-7"), north from the west deck; to the east lot (+225'-10") from the porch; the stair down to the wetland (+221')
  add({ id: "RA-1", type: "Ramp", name: "Ramp to parking lot", args: Object.assign({ baseLevel: { ref: "L-1" }, baseOffset: -ft(1.4), topLevel: { ref: "L-1" }, topOffset: 0, runs: [{ from: PT(20, 83), to: PT(20, 35) }] }, M) });
  add({ id: "RA-2", type: "Ramp", name: "Bridge to parking lot", args: Object.assign({ baseLevel: { ref: "L-1" }, baseOffset: -ft(1.17), topLevel: { ref: "L-1" }, topOffset: 0, runs: [{ from: PT(179.6, 74.2), to: PT(179.6, 44) }] }, M) });
  stair("ST-1", "Stair to the wetland", "L-GRD", "L-1", [{ from: PT(163, -43), to: PT(163, -33) }], { width: ft(7), railings: "Both" });
  const rail = (id, pts) => add({ id, type: "Railing", name: "Mesh railing", args: { level: { ref: "L-1" }, path: FT(pts), height: 1067, postSpacing: ft(8), postSize: 140, infill: "Mesh", material: "M-FH-WOOD" } });
  rail("RL-1", [[16.5, 0.3], [159, 0.3]]); rail("RL-2", [[193, 0.3], [251.5, 0.3], [251.5, 11.7]]);
  rail("RL-3", [[16.5, 0.3], [16.5, 5.3], [-3.7, 5.3], [-3.7, 34.7], [16.5, 34.7]]);
  rail("RL-4", [[159.3, -0.3], [159.3, -31.7], [158.6, -31.7]]); rail("RL-5", [[166.5, -31.7], [192.7, -31.7], [192.7, -0.3]]);

  // ---------------------------------------------------------------- the wetland's slope, falling south; the trees kept
  const contours = [[-9, -60], [-8, -40], [-7, -22], [-6, -2], [-5, 14], [-4, 30], [-3, 46], [-2, 62], [-1, 80], [0, 96]].map(([e, y]) => ({ z: ft(e),
    points: [-40, -10, 20, 50, 80, 110, 140, 170, 200, 230, 260, 290].map(x => [ft(x), ft(y + 3 * Math.sin(x / 37) + 0.02 * (x - 120))]) }));
  topo("TS-1", "Existing grade", contours, FT(RECT(-40, -70, 290, 100)), -ft(14));
  const tree = (id, sp, x, y, cd, ht) => add({ id, type: "Planting", name: sp, args: { position: PT(x, y), topo: { ref: "TS-1" }, form: "Deciduous", species: sp, canopy: ft(cd), height: ft(ht), trunk: ft(cd / 30), existing: true } });
  tree("PL-1", "Existing river birch", -22, -30, 24, 40); tree("PL-2", "Existing sycamore", 120, -48, 34, 60); tree("PL-3", "Existing red maple", 270, -20, 26, 45);
  tree("PL-4", "Existing willow oak", 60, 78, 30, 55); tree("PL-5", "Existing sweetgum", 230, 70, 22, 45);

  // ---------------------------------------------------------------- views
  const PC = [ft(-12), ft(-50), ft(262), ft(90)];
  H.plan("V-A201", "FLOOR PLAN", "L-1", { top: 2300, cut: 1200, bottom: -300, depth: -2500 }, PC, 100);
  H.plan("V-A203", "ROOF PLAN", "L-TOP", { top: 3000, cut: 2500, bottom: -ft(15), depth: -ft(16) }, PC, 100);
  H.plan("V-SITE", "SITE PLAN", "L-1", { top: 30000, cut: 29000, bottom: -ft(10), depth: -ft(12) }, [ft(-45), ft(-75), ft(295), ft(105)], 200, "VS-FH-SITE");
  const EZ = [-ft(10), ft(25)];
  H.elev("V-S", "SOUTH ELEVATION", PT(270, -60), PT(-20, -60), ft(140), "L-1", [0, EZ[0], ft(290), EZ[1]], 100);
  H.elev("V-N", "NORTH ELEVATION", PT(-20, 100), PT(270, 100), ft(140), "L-1", [0, EZ[0], ft(290), EZ[1]], 100);
  H.elev("V-E", "EAST ELEVATION", PT(275, 100), PT(275, -60), ft(300), "L-1", [ft(28), -ft(7), ft(132), EZ[1]], 100);
  H.elev("V-W", "WEST ELEVATION", PT(-30, -60), PT(-30, 100), ft(300), "L-1", [ft(8), EZ[0], ft(112), EZ[1]], 100);
  // sections looking west: through classroom 1, the toilets and classroom 2
  const SX = [ft(8), -ft(12), ft(70), ft(24)];
  H.sect("V-X3", "SECTION THROUGH CLASSROOM 1", PT(40, 60), PT(40, -20), ft(10), "L-1", SX, 50);
  H.sect("V-X2", "SECTION @ TOILET", PT(84, 60), PT(84, -20), ft(10), "L-1", SX, 50);
  H.sect("V-X1", "SECTION @ CLASSROOM 2", PT(214, 60), PT(214, -20), ft(10), "L-1", SX, 50);
  H.view3d("V-3D", "AXONOMETRIC", { azimuth: 210, elevation: 26, target: [ft(130), ft(20), ft(6)] }, 200);

  // ---------------------------------------------------------------- sheets: the set's, on ARCH D, each drawing where the set draws it
  const c = [ft(125), ft(20)], pl = p0 => H.place(p0, [0, 0], c, PC, 100, 96);
  H.sheet("A201", "Floor Plan", [["V-A201", pl([57.5, 203.8])]]);
  H.sheet("A203", "Roof Plan", [["V-A203", pl([57.5, 140.6])]]);
  const EC = [0, EZ[0], ft(290), EZ[1]], ec = s => [s, ft(5)];
  H.sheet("A301", "Elevations", [["V-S", H.place([45.7, 472.9], [ft(20), 0], ec(ft(145)), EC, 100, 96)], ["V-N", H.place([45.7, 318.6], [ft(22), 0], ec(ft(145)), EC, 100, 96)],
    ["V-E", H.place([139.9, 81.6], [ft(60), 0], ec(ft(80)), [ft(28), -ft(7), ft(132), EZ[1]], 100, 96)], ["V-W", H.place([525.6, 199.8], [ft(56), 0], ec(ft(60)), [ft(8), EZ[0], ft(112), EZ[1]], 100, 96)]]);
  // a section's s runs from the line's end (the south): grid B.8 at 20'
  const sc = p0 => H.place(p0, [ft(20), 0], [ft(39), ft(6)], SX, 50, 48);
  H.sheet("A402", "Sections", [["V-X3", sc([454.7, 431.8])], ["V-X2", sc([117.9, 154.4])], ["V-X1", sc([454.7, 154.4])]]);
  H.sheet("A901", "Axonometric", [["V-3D", [420, 300]]]);
  doc.regenerate();
  return doc;
}
