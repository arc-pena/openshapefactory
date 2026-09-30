//! Schaeffer Residence, Raleigh NC (Frank Harmon Architect, permit set 12.11.2014): a long timber house on a
//! slope, one standing-seam gable 33' x 79'-5" over a split section - the garage and a lower office dug into the
//! hill, the living floor over them, a studio at the entry level at the north end and the master suite over it.
//! Read off the set's plans (A201-A203), elevations (A301-A302) and sections (A401): x east from the living
//! room's west face, y north from the south face, in feet converted to mm. Heights from the garage floor (380'):
//! studio/lower 382', office 387', living 392', master 396', top of wall 405'.

import { fhaProject, ft, FT, PT } from "./sample_fha.js";

export function buildSchaefferSample() {
  const H = fhaProject("Schaeffer Residence\nRaleigh, NC", { number: "1310", issued: "07 07 2014", issueDate: "12.11.2014", place: "Raleigh, NC" });
  const { doc, add, wall, walls, floor, roof, stair, topo } = H; const RECT = H.R;
  doc.meta.surveyElevation = ft(380);                           // the garage floor on the survey's datum: levels and contours read as the set's
  const Z = f => ft(f - 380);                                   // an elevation of the set (feet above sea level), in mm above the garage floor

  // ---------------------------------------------------------------- levels
  H.level("L-GAR", "GARAGE FFE", Z(380)); H.level("L-LOW", "STUDIO FFE", Z(382)); H.level("L-OFF", "OFFICE FFE", Z(387));
  H.level("L-LIV", "LIVING LEVEL FFE", Z(392)); H.level("L-MB", "MASTER BED FFE", Z(396)); H.level("L-TOW", "TOP OF WALL", Z(405));
  // grids 1 and 2 of the elevations: the north face, and 4' south of it (the entry)
  H.grid("G-1", "1", [ft(-8), ft(70.42)], [ft(36), ft(70.42)]); H.grid("G-2", "2", [ft(-8), ft(66.42)], [ft(36), ft(66.42)]);

  // ---------------------------------------------------------------- the roof: one gable, 4' over the long sides, 4' and 5' over the ends
  const RF = [[-2, -5], [31, -5], [31, 74.42], [-2, 74.42]];
  roof("RF-1", "Standing seam roof", FT(RF), "L-TOW", 0, [null, 14.04, null, 14.04], { thickness: 200 });   // 3:12

  // ---------------------------------------------------------------- the ground floor: concrete, dug into the slope
  const C = "T-FH-CONC8", S = "T-FH-EXT6", PG = "T-FH-POLY";
  // the garage (south, 380') and the lower office (382'): concrete walls up to the living floor
  walls("W-GAR", FT([[2.28, 0.28], [28.72, 0.28], [28.72, 22.28]]), C, "L-GAR", "L-OFF");
  // the polygal band between the concrete and the living floor, south and east
  walls("W-PGB", FT([[2.28, 0.28], [28.72, 0.28], [28.72, 36.42]]), PG, "L-OFF", "L-LIV");
  wall("W-GARW", PT(2.28, 22.28), PT(2.28, 0.28), C, "L-GAR", "L-LIV");
  wall("W-GARN", PT(2.28, 22.28), PT(28.72, 22.28), C, "L-GAR", "L-LOW");
  walls("W-OFF", FT([[0.28, 22.28], [0.28, 42.42], [26.72, 42.42]]), C, "L-LOW", "L-LIV");
  wall("W-OFFE", PT(28.72, 22.28), PT(28.72, 36.42), C, "L-LOW", "L-OFF");
  wall("W-OFFJ", PT(28.72, 36.42), PT(26.72, 36.42), C, "L-LOW", "L-LIV");
  wall("W-OFFE2", PT(26.72, 36.42), PT(26.72, 42.42), C, "L-LOW", "L-LIV");
  // the north block's crawl space and foundation, up to the office floor
  walls("W-CRL", FT([[2.28, 42.42], [2.28, 70.14], [26.72, 70.14], [26.72, 42.42]]), C, "L-LOW", "L-OFF");
  floor("FL-GAR", "Garage slab", FT(RECT(2.28, 0.28, 28.72, 22.28)), "T-FH-SOG", "L-GAR");
  floor("FL-LOW", "Office slab", FT(RECT(0.28, 22.28, 28.72, 42.42)), "T-FH-SOG", "L-LOW");

  // ---------------------------------------------------------------- the timber house over it, walls to the top of wall
  wall("W-S", PT(2.28, 0.28), PT(28.72, 0.28), S, "L-LIV", "L-TOW", { roof: "RF-1" });
  wall("W-E1", PT(28.72, 0.28), PT(28.72, 36.42), S, "L-LIV", "L-TOW");
  wall("W-EJ", PT(28.72, 36.42), PT(26.72, 36.42), S, "L-LIV", "L-TOW");
  wall("W-E2", PT(26.72, 36.42), PT(26.72, 42.42), S, "L-LIV", "L-TOW");
  wall("W-E3", PT(26.72, 42.42), PT(26.72, 70.14), S, "L-OFF", "L-TOW");
  wall("W-N", PT(26.72, 70.14), PT(2.28, 70.14), S, "L-OFF", "L-TOW", { roof: "RF-1" });
  wall("W-W3", PT(2.28, 70.14), PT(2.28, 42.42), S, "L-OFF", "L-TOW");
  wall("W-WJN", PT(2.28, 42.42), PT(0.28, 42.42), S, "L-LIV", "L-TOW");
  wall("W-W2", PT(0.28, 42.42), PT(0.28, 22.28), PG, "L-LIV", "L-TOW");
  wall("W-WJS", PT(0.28, 22.28), PT(2.28, 22.28), S, "L-LIV", "L-TOW");
  wall("W-W1", PT(2.28, 22.28), PT(2.28, 0.28), PG, "L-LIV", "L-TOW");
  // inside: the screened porch's wall and the bedroom wing's partition at the south; the studio's bath and
  // laundry and the pantry
  const I = "T-FH-INT4";
  wall("W-I1", PT(2.28, 22.28), PT(18.28, 22.28), I, "L-LIV", "L-MB");
  wall("W-I2", PT(18.28, 0.28), PT(18.28, 22.28), I, "L-LIV", "L-TOW");
  walls("W-BTH", FT([[2.28, 42.8], [18.25, 42.8], [18.25, 48.46], [2.28, 48.46]]), I, "L-OFF", "L-LIV");
  wall("W-BTH5", PT(11.8, 42.8), PT(11.8, 48.46), I, "L-OFF", "L-LIV");
  walls("W-PAN", FT([[28.72, 30.2], [18.75, 30.2], [18.75, 36.3], [22.4, 36.3]]), I, "L-LIV", "L-MB");
  walls("W-MBB", FT([[2.28, 54.2], [11.4, 54.2], [11.4, 48.46]]), I, "L-MB", "L-TOW", { topOffset: -300 });
  wall("W-MBS", PT(2.28, 48.46), PT(26.72, 48.46), I, "L-MB", "L-TOW");

  // ---------------------------------------------------------------- floors
  floor("FL-OFF", "Studio floor", FT(RECT(2.28, 42.42, 26.72, 70.14)), "T-FH-WOOD", "L-OFF");
  floor("FL-LIV", "Living floor", FT([[2.28, 0.28], [28.72, 0.28], [28.72, 36.42], [26.72, 36.42], [26.72, 42.42], [0.28, 42.42], [0.28, 22.28], [2.28, 22.28]]), "T-FH-WOOD", "L-LIV");
  // the master suite over the studio; the living room is open to the roof
  // the ceiling under the roof trusses, at the top of wall everywhere
  floor("FL-CEIL", "Ceiling", FT([[2.28, 0.28], [28.72, 0.28], [28.72, 36.42], [26.72, 36.42], [26.72, 70.14], [2.28, 70.14], [2.28, 42.42], [0.28, 42.42], [0.28, 22.28], [2.28, 22.28]]), "T-FH-CEIL", "L-TOW");
  floor("FL-MB", "Master suite floor", FT([[2.28, 48.46], [20.2, 48.46], [20.2, 45.9], [26.72, 45.9], [26.72, 70.14], [2.28, 70.14]]), "T-FH-JOIST", "L-MB");

  // ---------------------------------------------------------------- stairs (counted from their levels, numbered in plan)
  stair("ST-1", "Stair, lower to office", "L-LOW", "L-OFF", [{ from: [ft(24.6), ft(44.2)], to: [ft(24.6), ft(51.4)] }], { width: ft(3.2) });
  stair("ST-2", "Stair, office to living", "L-OFF", "L-LIV", [{ from: PT(19.6, 44.1), to: PT(26.0, 44.1) }], { width: ft(2.7) });
  stair("ST-3", "Stair, living to master", "L-LIV", "L-MB", [{ from: PT(22.3, 53.9), to: PT(22.3, 49.6) }], { width: ft(3.0) });
  // the garden stair from the driving deck to the entry, outside the west wall
  stair("ST-4", "Garden stair", "L-GAR", "L-LOW", [{ from: PT(-1.2, 18.5), to: PT(-1.2, 21.3) }], { width: ft(3.0), railings: "Left" });

  // ---------------------------------------------------------------- windows and doors, read off the elevations
  const w = H.window, d = H.door;
  // west: the master suite's and studio's windows at the north end; the living room's storefront; the garage door under it
  w("WN-W1", "W-W3", ft(5.3), "T-FH-W86", ft(3.1)); w("WN-W2", "W-W3", ft(17.4), "T-FH-W44", ft(13.4)); w("WN-W3", "W-W3", ft(22.7), "T-FH-W24", ft(4.6));
  w("WN-W4", "W-W1", ft(11.0), "T-FH-SF2111", ft(0.3));
  d("DR-G1", "W-GARW", ft(9.9), "T-FH-GARAGE");
  // east: the kitchen's ribbon of awnings, the stair's full-height glazing, the master bed window
  [2.2, 6.4, 10.6, 14.8, 19.0].forEach((x, i) => w("WN-E" + (i + 2), "W-E1", ft(x), "T-FH-W42", ft(3.4)));
  w("WN-E1", "W-E3", ft(1.9), "T-FH-W417", ft(1.0)); w("WN-E7", "W-E3", ft(13.9), "T-FH-W44", ft(4.1));
  // south: the living room's storefront up into the gable; north: the entry door and the studio's windows
  w("WN-S1", "W-S", ft(8.25), "T-FH-SF1615", ft(0.1)); w("WN-S2", "W-S", ft(22.0), "T-FH-W44", ft(4.5));
  d("DR-N1", "W-N", ft(3.0), "T-FH-D30G"); w("WN-N1", "W-N", ft(14.0), "T-FH-W44", ft(9.5)); w("WN-N2", "W-N", ft(14.0), "T-FH-W44", ft(2.5));
  d("DR-I1", "W-I2", ft(12.0), "T-FH-D30", { flipFacing: true }); d("DR-I2", "W-I1", ft(8.0), "T-FH-D60G");
  d("DR-B1", "W-BTH3", ft(4.0), "T-FH-D28"); d("DR-B2", "W-BTH1", ft(14.0), "T-FH-D28");

  // ---------------------------------------------------------------- the ground: contours of the grading plan (L001), falling south
  const contours = [[378.5, -38], [379, -28], [380, -12], [381, 8], [382, 20], [383, 33], [384, 46], [385, 58], [386, 70], [387, 82], [388, 94], [389, 106], [390, 120], [391, 136], [392, 152]].map(([e, y]) => ({ z: Z(e),
    points: [-40, -30, -20, -10, 0, 10, 20, 30, 40, 50].map(x => [ft(x), ft(y + 0.06 * (x - 14) + 1.6 * Math.sin((x + y) / 9))]) }));
  topo("TS-1", "Existing grade", contours, FT(RECT(-40, -34, 50, 150)), Z(372));
  // the lot, read off the grading plan (L001): Barmettler Road along the north line
  const LOT = [[-28.4, -13.9], [37.6, -17.6], [34.6, 135.5], [-30.7, 138.5]];
  H.add({ id: "SITE", type: "SiteBoundary", name: "Property line", args: { sketch: { elements: LOT.map((a, i) => ({ type: "line", a: PT(...a), b: PT(...LOT[(i + 1) % 4]) })), constraints: [], dims: [] },
    edges: {}, setback: 0, level: { ref: "L-GAR" }, showPlanes: false, planeHeight: 12000, label: false } });
  // the trees the survey keeps: they stand on the grade
  const tree = (id, sp, x, y, cd, ht, form = "Deciduous") => H.add({ id, type: "Planting", name: sp, args: { position: PT(x, y), topo: { ref: "TS-1" }, form, species: sp, canopy: ft(cd), height: ft(ht), trunk: ft(cd / 30), existing: true } });
  tree("PL-1", "Existing holly", 23, 142.4, 14, 20); tree("PL-2", "32\" pine", 19.6, 119.4, 30, 70, "Conifer");
  tree("PL-3", "15\" Drake's elm (to remain)", -32.3, 28.1, 10, 30); tree("PL-4", "17\" pine", 32.3, 0.4, 14, 55, "Conifer");
  tree("PL-5", "31\" pine", 24.2, -8.8, 21, 65, "Conifer"); tree("PL-6", "15\" pine", 17.3, -23.8, 18, 50, "Conifer");

  // ---------------------------------------------------------------- views
  const lot = [ft(-38), ft(-30), ft(46), ft(150)];
  H.plan("V-L001", "GRADING PLAN", "L-GAR", { top: 30000, cut: 29000, bottom: -3000, depth: -5000 }, lot, 125, "VS-FH-SITE");
  // under the roof in the site plan: the stairs hidden in this view
  H.set("V-L001", "overrides", { "ST-1": { visible: false }, "ST-2": { visible: false }, "ST-3": { visible: false } });
  H.plan("V-A201", "LOWER LEVEL GARAGE + OFFICE", "L-GAR", { top: 2300, cut: 1500, bottom: -300, depth: -600 }, [ft(-7), ft(-7), ft(35), ft(77)], 50);
  H.plan("V-A202", "LOWER LEVEL LIVING + STUDIO", "L-LIV", { top: 2300, cut: 1200, bottom: -1600, depth: -1700 }, [ft(-7), ft(-7), ft(35), ft(77)], 50);
  H.plan("V-A203", "UPPER LEVEL MASTER SUITE", "L-MB", { top: 2300, cut: 1200, bottom: 0, depth: -1400 }, [ft(-7), ft(-7), ft(35), ft(77)], 50);
  H.plan("V-A203R", "ROOF PLAN", "L-TOW", { top: 6000, cut: 5000, bottom: -500, depth: -1000 }, [ft(-4), ft(-7), ft(33), ft(76)], 50);
  // elevations: east and west along the long sides, south and north on the ends
  H.elev("V-E", "EAST ELEVATION", PT(40, 85), PT(40, -15), ft(30), "L-GAR", [ft(-6), -ft(8), ft(96), ft(34)]);
  H.elev("V-W", "WEST ELEVATION", PT(-12, -15), PT(-12, 85), ft(30), "L-GAR", [ft(-6), -ft(8), ft(96), ft(34)]);
  H.elev("V-S", "SOUTH ELEVATION", PT(38, -14), PT(-8, -14), ft(30), "L-GAR", [ft(-4), -ft(8), ft(44), ft(34)]);
  H.elev("V-N", "NORTH ELEVATION", PT(-8, 80), PT(38, 80), ft(30), "L-GAR", [ft(-4), -ft(8), ft(44), ft(34)]);
  H.sect("V-S1", "SECTION", PT(14.5, 85), PT(14.5, -15), ft(15), "L-GAR", [ft(5), -ft(8), ft(105), ft(34)]);
  H.sect("V-S2", "SECTION", PT(23.5, -15), PT(23.5, 85), ft(8), "L-GAR", [ft(5), -ft(8), ft(105), ft(34)]);
  H.view3d("V-3D", "AXONOMETRIC", { azimuth: 225, elevation: 28, target: [ft(14), ft(35), ft(12)] }, 100);

  // ---------------------------------------------------------------- sheets: the set's, on ARCH D
  // each drawing where the set has it: a point of the model read against where the set's sheet draws it
  const PL = [ft(-7), ft(-7), ft(35), ft(77)], RP = [ft(-4), ft(-7), ft(33), ft(76)], EL = [ft(-6), -ft(8), ft(96), ft(34)], EN = [ft(-4), -ft(8), ft(44), ft(34)], SE = [ft(5), -ft(8), ft(105), ft(34)];
  const c = [ft(14.5), ft(35.2)], pl = (p0) => H.place(p0, [0, 0], c, PL, 50);
  H.sheet("L001", "Grading Plan", [["V-L001", H.place([244, 253], [ft(14.5), ft(35.2)], [ft(4), ft(60)], lot, 125, 120)]]);
  H.sheet("A201", "Floor Plans Garage/Office", [["V-A201", pl([559.3, 91.3])]]);
  H.sheet("A202", "Floor Plans Studio + Living", [["V-A202", pl([569.45, 82.26])]]);
  H.sheet("A203", "Plans Master Suite + Roof", [["V-A203", pl([184, 85.5])], ["V-A203R", H.place([569.7, 88.6], [0, 0], c, RP, 50)]]);
  // elevations and sections: grid 1 (the north face) and the garage floor, as each sheet draws them
  const ev = (p0, sN, crop) => H.place(p0, [ft(sN), 0], [ft(sN) - ft(35), ft(12)], crop, 50);
  H.sheet("A301", "Elevations", [["V-E", ev([704, 339.4], 85.42, EL)], ["V-W", H.place([257.7, 76.2], [ft(14.58), 0], [ft(14.58) + ft(35), ft(12)], EL, 50)]]);
  H.sheet("A302", "Elevations", [["V-S", H.place([746, 353], [ft(36), 0], [ft(36) - ft(12.5), ft(12)], EN, 50)], ["V-N", H.place([584, 64], [ft(11), 0], [ft(11) + ft(12.5), ft(12)], EN, 50)]]);
  H.sheet("A401", "Sections", [["V-S1", ev([644, 346.4], 85.42, SE)], ["V-S2", H.place([277, 86.4], [ft(14.58), 0], [ft(14.58) + ft(35), ft(12)], SE, 50)]]);
  H.sheet("A901", "Axonometric", [["V-3D", [420, 320]]]);
  H.joinWalls();
  doc.regenerate();
  return doc;
}
