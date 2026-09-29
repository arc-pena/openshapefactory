//! Schaeffer Residence, Raleigh NC (Frank Harmon Architect, permit set 12.11.2014): a long timber house on a
//! slope, one standing-seam gable 33' x 79'-5" over a split section - the garage and a lower office dug into the
//! hill, the living floor over them, a studio at the entry level at the north end and the master suite over it.
//! Read off the set's plans (A201-A203), elevations (A301-A302) and sections (A401): x east from the living
//! room's west face, y north from the south face, in feet converted to mm. Heights from the garage floor (380'):
//! studio/lower 382', office 387', living 392', master 396', top of wall 405'.

import { fhaProject, ft, FT, P } from "./sample_fha.js";

export function buildSchaefferSample() {
  const H = fhaProject("Schaeffer Residence\nRaleigh, NC", { number: "1310", issued: "07 07 2014", issueDate: "12.11.2014", place: "Raleigh, NC" });
  const { doc, add, wall, walls, floor, roof, stair, topo, R } = H;
  const Z = f => ft(f - 380);                                   // an elevation of the set (feet above sea level), in mm above the garage floor

  // ---------------------------------------------------------------- levels
  H.level("L-GAR", "GARAGE FFE", Z(380)); H.level("L-LOW", "STUDIO FFE", Z(382)); H.level("L-OFF", "OFFICE FFE", Z(387));
  H.level("L-LIV", "LIVING LEVEL FFE", Z(392)); H.level("L-MB", "MASTER BED FFE", Z(396)); H.level("L-TOW", "TOP OF WALL", Z(405));
  // grids 1 and 2 of the elevations: the north face, and 4' south of it (the entry)
  H.grid("G-1", "1", [ft(-8), ft(70.42)], [ft(36), ft(70.42)]); H.grid("G-2", "2", [ft(-8), ft(66.42)], [ft(36), ft(66.42)]);

  // ---------------------------------------------------------------- the roof: one gable, 4' over the long sides, 4' and 5' over the ends
  const RF = [[-2, -5], [31, -5], [31, 74.42], [-2, 74.42]];
  roof("RF-1", "Standing seam roof", FT(RF), "L-TOW", 0, [null, 18.43, null, 18.43], { thickness: 305 });   // 4:12

  // ---------------------------------------------------------------- the ground floor: concrete, dug into the slope
  const C = "T-FH-CONC8", S = "T-FH-EXT6", PG = "T-FH-POLY";
  // the garage (south, 380') and the lower office (382'): concrete walls up to the living floor
  walls("W-GAR", FT([[2.28, 0.28], [28.72, 0.28], [28.72, 22.28]]), C, "L-GAR", "L-LIV");
  wall("W-GARW", P(2.28, 22.28), P(2.28, 0.28), C, "L-GAR", "L-LIV");
  wall("W-GARN", P(2.28, 22.28), P(28.72, 22.28), C, "L-GAR", "L-LOW");
  walls("W-OFF", FT([[0.28, 22.28], [0.28, 42.42], [26.72, 42.42]]), C, "L-LOW", "L-LIV");
  wall("W-OFFE", P(28.72, 22.28), P(28.72, 36.42), C, "L-LOW", "L-LIV");
  wall("W-OFFJ", P(28.72, 36.42), P(26.72, 36.42), C, "L-LOW", "L-LIV");
  wall("W-OFFE2", P(26.72, 36.42), P(26.72, 42.42), C, "L-LOW", "L-LIV");
  // the north block's crawl space and foundation, up to the office floor
  walls("W-CRL", FT([[2.28, 42.42], [2.28, 70.14], [26.72, 70.14], [26.72, 42.42]]), C, "L-LOW", "L-OFF");
  floor("FL-GAR", "Garage slab", FT(R(2.28, 0.28, 28.72, 22.28)), "T-FH-SOG", "L-GAR");
  floor("FL-LOW", "Office slab", FT(R(0.28, 22.28, 28.72, 42.42)), "T-FH-SOG", "L-LOW");

  // ---------------------------------------------------------------- the timber house over it, walls to the top of wall
  wall("W-S", P(2.28, 0.28), P(28.72, 0.28), S, "L-LIV", "L-TOW", { roof: "RF-1" });
  wall("W-E1", P(28.72, 0.28), P(28.72, 36.42), S, "L-LIV", "L-TOW");
  wall("W-EJ", P(28.72, 36.42), P(26.72, 36.42), S, "L-LIV", "L-TOW");
  wall("W-E2", P(26.72, 36.42), P(26.72, 42.42), S, "L-LIV", "L-TOW");
  wall("W-E3", P(26.72, 42.42), P(26.72, 70.14), S, "L-OFF", "L-TOW");
  wall("W-N", P(26.72, 70.14), P(2.28, 70.14), S, "L-OFF", "L-TOW", { roof: "RF-1" });
  wall("W-W3", P(2.28, 70.14), P(2.28, 42.42), S, "L-OFF", "L-TOW");
  wall("W-WJN", P(2.28, 42.42), P(0.28, 42.42), S, "L-LIV", "L-TOW");
  wall("W-W2", P(0.28, 42.42), P(0.28, 22.28), PG, "L-LIV", "L-TOW");
  wall("W-WJS", P(0.28, 22.28), P(2.28, 22.28), S, "L-LIV", "L-TOW");
  wall("W-W1", P(2.28, 22.28), P(2.28, 0.28), PG, "L-LIV", "L-TOW");
  // inside: the screened porch's wall and the bedroom wing's partition at the south; the studio's bath and
  // laundry and the pantry
  const I = "T-FH-INT4";
  wall("W-I1", P(2.28, 22.28), P(18.28, 22.28), I, "L-LIV", "L-MB");
  wall("W-I2", P(18.28, 0.28), P(18.28, 22.28), I, "L-LIV", "L-TOW");
  walls("W-BTH", FT([[2.28, 42.8], [18.25, 42.8], [18.25, 48.46], [2.28, 48.46]]), I, "L-OFF", "L-LIV");
  wall("W-BTH5", P(11.8, 42.8), P(11.8, 48.46), I, "L-OFF", "L-LIV");
  walls("W-PAN", FT([[26.72, 30.2], [18.75, 30.2], [18.75, 36.3], [22.4, 36.3]]), I, "L-LIV", "L-MB");
  walls("W-MBB", FT([[2.28, 54.2], [11.4, 54.2], [11.4, 48.46]]), I, "L-MB", "L-TOW", { topOffset: -300 });
  wall("W-MBS", P(2.28, 48.46), P(26.72, 48.46), I, "L-MB", "L-TOW");

  // ---------------------------------------------------------------- floors
  floor("FL-OFF", "Studio floor", FT(R(2.28, 42.42, 26.72, 70.14)), "T-FH-WOOD", "L-OFF");
  floor("FL-LIV", "Living floor", FT([[2.28, 0.28], [28.72, 0.28], [28.72, 36.42], [26.72, 36.42], [26.72, 42.42], [0.28, 42.42], [0.28, 22.28], [2.28, 22.28]]), "T-FH-WOOD", "L-LIV");
  // the master suite over the studio; the living room is open to the roof
  floor("FL-MB", "Master suite floor", FT([[2.28, 48.46], [20.2, 48.46], [20.2, 45.9], [26.72, 45.9], [26.72, 70.14], [2.28, 70.14]]), "T-FH-JOIST", "L-MB");

  // ---------------------------------------------------------------- stairs (counted from their levels, numbered in plan)
  stair("ST-1", "Stair, lower to office", "L-LOW", "L-OFF", [{ from: [ft(24.6), ft(44.2)], to: [ft(24.6), ft(51.4)] }], { width: ft(3.2) });
  stair("ST-2", "Stair, office to living", "L-OFF", "L-LIV", [{ from: P(19.6, 44.1), to: P(26.0, 44.1) }], { width: ft(2.7) });
  stair("ST-3", "Stair, living to master", "L-LIV", "L-MB", [{ from: P(22.3, 53.9), to: P(22.3, 49.6) }], { width: ft(3.0) });
  // the garden stair from the driving deck to the entry, outside the west wall
  stair("ST-4", "Garden stair", "L-GAR", "L-LOW", [{ from: P(-1.2, 18.5), to: P(-1.2, 21.3) }], { width: ft(3.0), railings: "Left" });

  // ---------------------------------------------------------------- windows and doors, read off the elevations
  const w = H.window, d = H.door;
  // west: the studio's windows (master bed band above, studio below), the living room's polygal
  w("WN-W1", "W-W3", ft(12.0), "T-FH-W86", ft(4.0)); w("WN-W2", "W-W3", ft(22.5), "T-FH-W44", ft(9.5)); w("WN-W3", "W-W3", ft(8.0), "T-FH-W44", ft(13.4));
  w("WN-W4", "W-W1", ft(6.0), "T-FH-W86", ft(3.0)); w("WN-W5", "W-W1", ft(15.0), "T-FH-W86", ft(3.0));
  // east: the stair's tall window, the kitchen band, the entry door at the north end
  w("WN-E1", "W-E3", ft(7.0), "T-FH-W48", ft(0.5)); w("WN-E2", "W-E1", ft(20.0), "T-FH-W84", ft(3.5)); w("WN-E3", "W-E1", ft(30.0), "T-FH-W44", ft(3.5));
  d("DR-E1", "W-E3", ft(25.0), "T-FH-D30G");
  // south: the screened porch opens wide; north: the studio door and windows
  w("WN-S1", "W-S", ft(8.0), "T-FH-W1210", ft(1.0)); w("WN-S2", "W-S", ft(22.0), "T-FH-W44", ft(4.5));
  d("DR-N1", "W-N", ft(3.0), "T-FH-D30G"); w("WN-N1", "W-N", ft(14.0), "T-FH-W44", ft(9.5)); w("WN-N2", "W-N", ft(14.0), "T-FH-W44", ft(2.5));
  d("DR-G1", "W-GAR1", ft(14.0), "T-FH-GARAGE");
  d("DR-I1", "W-I2", ft(12.0), "T-FH-D30", { flipFacing: true }); d("DR-I2", "W-I1", ft(8.0), "T-FH-D60G");
  d("DR-B1", "W-BTH3", ft(4.0), "T-FH-D28"); d("DR-B2", "W-BTH1", ft(14.0), "T-FH-D28");

  // ---------------------------------------------------------------- the ground: contours of the grading plan (L001), falling south
  const contours = [[378.5, -38], [379, -28], [380, -12], [381, 8], [382, 20], [383, 33], [384, 46], [385, 58], [386, 70], [387, 82], [388, 94]].map(([e, y]) => ({ z: Z(e),
    points: [-22, -10, 0, 10, 20, 30, 40, 50].map(x => [ft(x), ft(y + 0.06 * (x - 14) + 1.6 * Math.sin((x + y) / 9))]) }));
  topo("TS-1", "Existing grade", contours, FT(R(-22, -38, 50, 94)), Z(372));

  // ---------------------------------------------------------------- views
  const lot = [ft(-22), ft(-38), ft(50), ft(94)];
  H.plan("V-L001", "SITE PLAN", "L-GAR", { top: 12000, cut: 11000, bottom: -3000, depth: -5000 }, lot, 100);
  H.plan("V-A201", "LOWER LEVEL GARAGE + OFFICE", "L-GAR", { top: 2300, cut: 1500, bottom: -300, depth: -600 }, [ft(-7), ft(-7), ft(35), ft(77)], 50);
  H.plan("V-A202", "LOWER LEVEL LIVING + STUDIO", "L-LIV", { top: 2300, cut: 1200, bottom: -1600, depth: -1700 }, [ft(-7), ft(-7), ft(35), ft(77)], 50);
  H.plan("V-A203", "UPPER LEVEL MASTER SUITE", "L-MB", { top: 2300, cut: 1200, bottom: 0, depth: -1400 }, [ft(-7), ft(-7), ft(35), ft(77)], 50);
  H.plan("V-A203R", "ROOF PLAN", "L-TOW", { top: 6000, cut: 5000, bottom: -500, depth: -1000 }, [ft(-4), ft(-7), ft(33), ft(76)], 50);
  // elevations: east and west along the long sides, south and north on the ends
  H.elev("V-E", "EAST ELEVATION", P(40, 85), P(40, -15), ft(30), "L-GAR", [ft(-6), -ft(8), ft(96), ft(34)]);
  H.elev("V-W", "WEST ELEVATION", P(-12, -15), P(-12, 85), ft(30), "L-GAR", [ft(-6), -ft(8), ft(96), ft(34)]);
  H.elev("V-S", "SOUTH ELEVATION", P(38, -14), P(-8, -14), ft(30), "L-GAR", [ft(-4), -ft(8), ft(44), ft(34)]);
  H.elev("V-N", "NORTH ELEVATION", P(-8, 80), P(38, 80), ft(30), "L-GAR", [ft(-4), -ft(8), ft(44), ft(34)]);
  H.sect("V-S1", "SECTION", P(14.5, 85), P(14.5, -15), ft(15), "L-GAR", [ft(5), -ft(8), ft(105), ft(34)]);
  H.sect("V-S2", "SECTION", P(23.5, -15), P(23.5, 85), ft(8), "L-GAR", [ft(5), -ft(8), ft(105), ft(34)]);
  H.view3d("V-3D", "AXONOMETRIC", { azimuth: 225, elevation: 28, target: [ft(14), ft(35), ft(12)] }, 100);

  // ---------------------------------------------------------------- sheets: the set's, on ARCH D
  // each drawing where the set has it: a point of the model read against where the set's sheet draws it
  const PL = [ft(-7), ft(-7), ft(35), ft(77)], RP = [ft(-4), ft(-7), ft(33), ft(76)], EL = [ft(-6), -ft(8), ft(96), ft(34)], EN = [ft(4), -ft(8), ft(44), ft(34)], SE = [ft(5), -ft(8), ft(105), ft(34)];
  const c = [ft(14.5), ft(35.2)], pl = (p0) => H.place(p0, [0, 0], c, PL, 50);
  H.sheet("L001", "Site Plan", [["V-L001", [330, 310]]]);
  H.sheet("A201", "Floor Plans Garage/Office", [["V-A201", pl([559.3, 91.3])]]);
  H.sheet("A202", "Floor Plans Studio + Living", [["V-A202", pl([569.45, 82.26])]]);
  H.sheet("A203", "Plans Master Suite + Roof", [["V-A203", pl([184, 85.5])], ["V-A203R", H.place([569.7, 88.6], [0, 0], c, RP, 50)]]);
  // elevations and sections: grid 1 (the north face) and the garage floor, as each sheet draws them
  const ev = (p0, sN, crop) => H.place(p0, [ft(sN), 0], [ft(sN) - ft(35), ft(12)], crop, 50);
  H.sheet("A301", "Elevations", [["V-E", ev([704, 339.4], 85.42, EL)], ["V-W", H.place([257.7, 76.2], [ft(14.58), 0], [ft(14.58) + ft(35), ft(12)], EL, 50)]]);
  H.sheet("A302", "Elevations", [["V-S", H.place([589, 353], [ft(36), 0], [ft(36) - ft(12.5), ft(12)], EN, 50)], ["V-N", H.place([584, 64], [ft(11), 0], [ft(11) + ft(12.5), ft(12)], EN, 50)]]);
  H.sheet("A401", "Sections", [["V-S1", ev([644, 346.4], 85.42, SE)], ["V-S2", H.place([277, 86.4], [ft(14.58), 0], [ft(14.58) + ft(35), ft(12)], SE, 50)]]);
  H.sheet("A901", "Axonometric", [["V-3D", [420, 320]]]);
  doc.regenerate();
  return doc;
}
