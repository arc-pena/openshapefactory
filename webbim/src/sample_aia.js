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
  const { doc, add, wall, floor, roof, stair, topo, line } = H; const RECT = H.R;
  doc.meta.surveyElevation = ft(323);
  const L = doc.lib;
  // ---------------------------------------------------------------- materials and assemblies, as the details specify them
  const mat = (id, name, mark, cut, proj, shade) => { L.materials[id] = { name, mark, description: name, cut, projection: proj, shading: { colour: shade } }; };
  mat("M-AIA-STUD", "Metal studs with batt insulation", "ST", { pattern: null, pen: "thin", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#e3ddcf");
  mat("M-AIA-RIGID", "Rigid insulation", "RI", { pattern: "P-RIGID", pen: "thin", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#dfe8d0");
  mat("M-AIA-SHEATH", "1/2\" fire retardant sheathing", "SH", { pattern: null, pen: "thin", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#d9c39a");
  mat("M-AIA-AIR", "Air space", "AS", { pattern: null, pen: "hairline", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#ffffff");
  mat("M-AIA-SIDING", "Ship lap wood siding", "6.2", { pattern: "P-TIMBER", pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-AIA-LAP", lineColour: "#8c8c8c" }, "#b08556");
  mat("M-AIA-SEAM", "Standing seam metal panels", "7.1", { pattern: null, pen: "heavy", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-AIA-SEAM", lineColour: "#8c8c8c" }, "#8d949b");
  mat("M-AIA-CEMENT", "Cementitious panel", "6.3", { pattern: null, pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-AIA-CEMENT", lineColour: "#a0a0a0" }, "#c4c3bd");
  mat("M-AIA-STONE", "Stone", "4.1", { pattern: "P-STONE", pen: "heavy", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-AIA-STONE", lineColour: "#a0a0a0" }, "#cbc3b1");
  mat("M-AIA-DECK", "Composite metal deck, concrete filled", "MD", { pattern: "P-CONC", pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#b7b6b1");
  mat("M-AIA-GRAVEL", "Drainage course, washed stone", "DC", { pattern: "P-GRAVEL", pen: "thin", lineColour: "#000000", background: "#ffffff" }, { pen: "thin" }, "#bdb6a6");
  mat("M-AIA-ALUM", "Aluminum storefront, clear anodized", "8.1", { pattern: null, pen: "medium", lineColour: "#000000", background: "#e0e3e6" }, { pen: "thin" }, "#aab0b6");
  Object.assign(L.patterns, {
    "P-AIA-LAP": { name: "Ship lap, 6\" courses", kind: "model", lines: [{ angle: 0, origin: [0, 0], delta: [0, 152.4] }] },
    "P-AIA-SEAM": { name: "Standing seam, 16\" o.c.", kind: "model", lines: [{ angle: 90, origin: [0, 0], delta: [0, 406.4] }] },
    "P-AIA-CEMENT": { name: "Cementitious panels 4'x8'", kind: "model", lines: [{ angle: 0, origin: [0, 0], delta: [0, 1219.2] }, { angle: 90, origin: [0, 0], delta: [0, 2438.4] }] },
    "P-AIA-STONE": { name: "Stone coursing", kind: "model", lines: [{ angle: 0, origin: [0, 0], delta: [0, 152.4] }] },
  });
  const wt = (id, name, mark, layers, fn = "Exterior") => { L.types[id] = { family: "F-BASICWALL", name, mark, layers, coreStart: 0, coreEnd: layers.length, params: { Function: fn } }; };
  const lay = (fn, inch, material) => ({ function: fn, thickness: Math.round(inch * 25.4), material });
  wt("T-AIA-C8", "Concrete wall 8\"", "C8", [lay("Structure", 8, "M-FH-CONC")], "Core");
  wt("T-AIA-C12", "Concrete wall 12\"", "C12", [lay("Structure", 12, "M-FH-CONC")], "Core");
  wt("T-AIA-C14", "Concrete wall 14\"", "C14", [lay("Structure", 13.9, "M-FH-CONC")], "Core");
  wt("T-AIA-C24", "Concrete retaining wall 24\"", "C24", [lay("Structure", 24, "M-FH-CONC")], "Retaining");
  // south and east: wood siding, air space, building paper, 1/2" FR sheathing, 6" metal studs 16" oc with batt, 5/8" gyp bd - 8 5/8"
  wt("T-AIA-SPAN", "Ship lap siding on 6\" metal studs (south, east)", "S1", [lay("Finish 1", 0.75, "M-AIA-SIDING"), lay("Thermal/Air Layer", 0.75, "M-AIA-AIR"), lay("Substrate", 0.5, "M-AIA-SHEATH"),
    lay("Structure", 6, "M-AIA-STUD"), lay("Finish 2", 0.625, "M-FH-GYP")]);
  L.types["T-AIA-SPAN"].coreStart = 3; L.types["T-AIA-SPAN"].coreEnd = 4;
  // north: metal roofing system on slip sheet and building paper, two layers 1 1/2" rigid, 5 3/8" studs, gyp bd - 12 1/4"
  wt("T-AIA-SKIN", "Standing seam metal panels on 2 layers 1 1/2\" rigid (north)", "M1", [lay("Finish 1", 2.625, "M-AIA-SEAM"), lay("Thermal/Air Layer", 3, "M-AIA-RIGID"), lay("Substrate", 0.625, "M-AIA-SHEATH"),
    lay("Structure", 5.375, "M-AIA-STUD"), lay("Finish 2", 0.625, "M-FH-GYP")]);
  L.types["T-AIA-SKIN"].coreStart = 3; L.types["T-AIA-SKIN"].coreEnd = 4;
  wt("T-AIA-P7", "Partition 7\" (plumbing)", "P7", [lay("Finish 1", 0.625, "M-FH-GYP"), lay("Structure", 5.75, "M-AIA-STUD"), lay("Finish 2", 0.625, "M-FH-GYP")], "Interior");
  wt("T-AIA-P45", "Partition 4 1/2\"", "P4", [lay("Finish 1", 0.625, "M-FH-GYP"), lay("Structure", 3.25, "M-AIA-STUD"), lay("Finish 2", 0.625, "M-FH-GYP")], "Interior");
  for (const k of ["T-AIA-P7", "T-AIA-P45"]) { L.types[k].family = "F-PARTITION"; L.types[k].coreStart = 1; L.types[k].coreEnd = 2; }
  // storefront (8.1): aluminum 2" x 4 1/2", its grid set wall by wall
  L.types["T-AIA-SF"] = { family: "F-CURTAINWALL", name: "Storefront 2\"x4 1/2\" (8.1)", mark: "8.1", layers: [lay("Structure", 4.5, "M-GLASS")], coreStart: 0, coreEnd: 1,
    curtain: { vertical: { layout: "None" }, horizontal: { layout: "None" }, mullion: { width: 51, depth: 114, material: "M-AIA-ALUM" }, panel: { material: "M-GLASS", thickness: 25 } } };
  const flt = (id, name, mark, layers) => { L.types[id] = { family: "F-FLOOR", name, mark, layers, coreStart: 0, coreEnd: layers.length }; };
  flt("T-AIA-DECK", "4 1/2\" concrete slab on 1 1/2\" metal deck", "S2", [lay("Structure", 4.5, "M-FH-CONC"), lay("Structure", 1.5, "M-AIA-DECK")]);
  // (its 18" drainage course under it is the ground's, drawn in the details as the washed stone it is)
  flt("T-AIA-SOG", "6\" concrete slab on vapor barrier on 18\" drainage course", "S1", [lay("Structure", 6, "M-FH-CONC")]);
  flt("T-AIA-CLG", "5/8\" gyp bd ceiling", "C1", [lay("Finish 1", 0.625, "M-FH-GYP")]);
  flt("T-AIA-CAN", "Canopy: standing seam on framing, 1'-10\"", "CN", [lay("Finish 1", 2.625, "M-AIA-SEAM"), lay("Structure", 19.4, "M-AIA-STUD")]);
  const col = (id, name, mark, o) => { L.types[id] = Object.assign({ family: "F-COLUMN", name, mark, material: "M-FH-STEEL" }, o); };
  col("T-AIA-W10", "W10x49", "C1", { shape: "I", width: 254, depth: 254, flange: 14.2, web: 8.6 });
  col("T-AIA-HSS10", "HSS 10x10x1/2", "C2", { shape: "RHS", width: 254, depth: 254, thick: 12.7 });
  L.types["T-AIA-W14"] = { family: "F-STEELBEAM", name: "W14x22", mark: "B1", shape: "I", width: 127, depth: 349, flange: 8.5, web: 5.8, material: "M-FH-STEEL" };
  // the girders A to B: cellular (castellated) beams 27" deep, 20" round openings at 24"
  L.types["T-AIA-W18"] = { family: "F-STEELBEAM", name: "Cellular beam 27\" (20\" openings at 24\")", mark: "G1", shape: "I", width: 178, depth: 686, flange: 12.7, web: 9.5, material: "M-FH-STEEL", cells: { d: 508, spacing: 610 } };
  L.types["T-AIA-W12"] = { family: "F-STEELBEAM", name: "W12x19 purlin", mark: "P1", shape: "I", width: 102, depth: 310, flange: 8.9, web: 5.8, material: "M-FH-STEEL" };
  flt("T-AIA-SOFFIT", "Cementitious panels on 1 1/2\" hat channels", "SF", [lay("Finish 1", 0.5, "M-AIA-CEMENT"), lay("Structure", 1.5, "M-AIA-STUD")]);

  // ---------------------------------------------------------------- levels and grids (the set's: from the cafe floor, 323'-0")
  H.level("L-0", "CAFE + EXHIBIT", 0); H.level("L-1", "LOBBY + MULTI-PURPOSE", ft(10)); H.level("L-2", "AIA", ft(24));
  H.level("L-3", "TENANT", ft(35.5)); H.level("L-T", "TOP OF CONSTRUCTION", ft(51 + 7.75 / 12));
  const GX = [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 116];
  GX.forEach((x, i) => H.grid(`G-${i + 1}`, String(i + 1).padStart(2, "0"), PT(x, -44), PT(x, 47.33)));
  H.grid("G-A", "A", PT(-20, 30), PT(167.8, 30)); H.grid("G-B", "B", PT(-20, 0), PT(167.8, 0));
  const SLAB = ft(0.5);                                     // the slabs' tops stand 6" over the levels (ELEV = 333'-6", 347'-6", 359'-0")

  // ---------------------------------------------------------------- the shed roof: 2:12 rising north, over the south eave at 43'-6"
  const ROOFY0 = -12.8, EAVE = 43.5 + 1.2, SLOPE = 2 / 12;   // the roof's top about 46'-10" over grid B (A501 draws it at 47'-0", A403 at 46'-8")
  roof("RF-1", "Standing seam roof on 6\" rigid on metal deck", FT([[-16, ROOFY0], [124, ROOFY0], [124, 31.2], [-16, 31.2]]), "L-0", ft(EAVE), [Math.atan(SLOPE) * 180 / Math.PI, null, null, null], { thickness: 216, material: "M-AIA-SEAM" });
  const r = { roof: "RF-1" };

  // under the roof: W12 purlins about every 4' square to the slope, the sloped 5/8" gyp bd ceiling 2'-11" under the roof's top,
  // and the flat cementitious soffit out to the eave
  const roofTop = y => EAVE + (y - ROOFY0) * SLOPE;
  for (let y = 27.33; y > -12.5; y -= 4) add({ id: `B-P${Math.round(y * 10)}`, type: "Beam", name: "Purlin", args: { axis: line(PT(-15, y), PT(123, y)), beamType: { ref: "T-AIA-W12" }, level: { ref: "L-0" }, topOffset: ft(roofTop(y) - 0.47), rotation: -Math.atan(SLOPE) * 180 / Math.PI } });
  roof("RF-CLG", "Sloped gyp bd ceiling", FT([[-2.67, 0], [117, 0], [117, 29.5], [-2.67, 29.5]]), "L-0", ft(43.62) - 51 + 16, [Math.atan(SLOPE) * 180 / Math.PI, null, null, null], { thickness: 16, material: "M-FH-GYP" });
  floor("FL-SOF", "Eave soffit", FT([[-16, ROOFY0 + 0.4], [124, ROOFY0 + 0.4], [124, -1.33], [-16, -1.33]]), "T-AIA-SOFFIT", "L-0", ft(43.62));
  // ---------------------------------------------------------------- structure: W10 columns on B, HSS 10 on A, beams and girders at the floors
  GX.forEach((x, i) => add({ id: `C-B${i + 1}`, type: "Column", name: `Column B/${String(i + 1).padStart(2, "0")}`, args: { position: PT(x, 0), columnType: { ref: "T-AIA-W10" }, baseLevel: { ref: "L-0" }, height: ft(43.2), rotation: [60, 72, 84].includes(x) ? 90 : 0, baseOffset: 0 } }));
  [48, 60, 72, 84].forEach(x => add({ id: `C-A${x}`, type: "Column", name: `Column A/${x}`, args: { position: PT(x, 30), columnType: { ref: "T-AIA-HSS10" }, baseLevel: { ref: "L-1" }, height: ft(40), rotation: 0, baseOffset: 0 } }));
  for (const lv of ["L-1", "L-2", "L-3"]) {
    const top = -ft(0.5) + SLAB - 152;                     // under the deck
    // the lobby floor is framed over the cafe only: east of it the multi-purpose room's slab is on grade (A502)
    const xe = lv === "L-1" ? 66 : 117;
    add({ id: `B-B-${lv}`, type: "Beam", name: `Beam B ${lv}`, args: { axis: line(PT(-3, 0), PT(xe, 0)), beamType: { ref: "T-AIA-W14" }, level: { ref: lv }, topOffset: SLAB - 152, rotation: 0 } });
    add({ id: `B-A-${lv}`, type: "Beam", name: `Beam A ${lv}`, args: { axis: line(PT(-1, 29.4), PT(xe, 29.4)), beamType: { ref: "T-AIA-W14" }, level: { ref: lv }, topOffset: SLAB - 152, rotation: 0 } });
    GX.forEach((x, i) => x <= xe && add({ id: `G-${lv}-${i + 1}`, type: "Beam", name: `Girder ${String(i + 1).padStart(2, "0")} ${lv}`, args: { axis: line(PT(x, 0.4), PT(x, 29.6)), beamType: { ref: "T-AIA-W18" }, level: { ref: lv }, topOffset: SLAB - 152, rotation: 0 } }));
    void top;
  }

  // ---------------------------------------------------------------- floors
  flt("T-AIA-SOG6", "6\" concrete slab on grade", "S0", [lay("Structure", 6, "M-FH-CONC")]);
  floor("FL-0", "Cafe + exhibit slab", FT([[-2.92, -1], [65.67, -1], [65.67, 29.33], [-0.67, 29.33], [-0.67, 20.67], [-2.92, 20.67]]), "T-AIA-SOG6", "L-0");
  const plate = FT([[-2.67, -1.33], [117.33, -1.33], [117.33, 29.9], [-2.67, 29.9]]);
  // the lobby opens over the cafe on the west, and its stair goes down beside the elevator
  H.floorHoles("FL-1W", "Lobby slab (over the cafe)", FT([[-2.67, -1.33], [66, -1.33], [66, 29.9], [-2.67, 29.9]]), [FT([[-2.5, -0.61], [11, -0.61], [11, 20.83], [-2.67, 20.83]]), FT([[24.33, 21.67], [35.67, 21.67], [35.67, 29.47], [24.33, 29.47]])], "T-AIA-DECK", "L-1", SLAB);
  floor("FL-1E", "Multi-purpose slab on grade", FT([[66, -1.33], [117.33, -1.33], [117.33, 29.9], [66, 29.9]]), "T-AIA-SOG", "L-1", SLAB);
  H.floorHoles("FL-2", "AIA slab", FT([[-2.67, -1.33], [117.33, -1.33], [117.33, 29.9], [97.14, 29.9], [97.14, 34], [46.86, 34], [46.86, 29.9], [-2.67, 29.9]]), [FT([[-2.5, -0.61], [18, -0.61], [18, 20.79], [-2.67, 20.79]])], "T-AIA-DECK", "L-2", SLAB);
  floor("FL-2B", "Balcony", FT([[18.17, -5.67], [35.25, -5.67], [35.25, -1.33], [18.17, -1.33]]), "T-AIA-DECK", "L-2", SLAB);
  floor("FL-3", "Tenant slab", plate, "T-AIA-DECK", "L-3", SLAB);
  void plate;
  // ceilings: 5/8" gyp bd 2'-9" under the slabs' tops
  // (under the lobby floor only over the cafe: east of it the slab is on grade)
  for (const lv of ["L-1", "L-2", "L-3"]) { const xe = lv === "L-1" ? 65.67 : 116.6; floor(`CL-${lv}`, `Ceiling under ${lv}`, FT([[-0.5, -0.61], [xe, -0.61], [xe, 29.5], [-0.5, 29.5]]), "T-AIA-CLG", lv, SLAB - ft(2.75)); }

  // ---------------------------------------------------------------- the cores: concrete, from the cafe (or the lobby) to the roof
  const C8 = "T-AIA-C8", C12 = "T-AIA-C12";
  const op = (id, host, a, b, lev, sill, h) => { const hw = doc.element(host); void hw; add({ id, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at: ft((a + b) / 2), sill: ft(sill) + lev, w: ft(b - a), h: ft(h) }, farProfile: null, depth: "through" } }); };
  const LZ = { "L-0": 0, "L-1": ft(10), "L-2": ft(24), "L-3": ft(35.5) };
  // west stair (000)
  wall("W-SW-S", PT(-0.67, 21), PT(24.33, 21), C8, "L-0", null, Object.assign({ height: ft(47) }, r));
  wall("W-SW-W", PT(-0.17, 20.67), PT(-0.17, 30.33), C12, "L-0", null, Object.assign({ height: ft(49) }, r));
  wall("W-SW-E", PT(24, 20.67), PT(24, 30.33), C8, "L-0", null, Object.assign({ height: ft(49) }, r));
  wall("W-SW-N", PT(-0.67, 29.83), PT(24.33, 29.83), C12, "L-0", null, Object.assign({ height: ft(50) }, r));
  op("OP-SW-S0a", "W-SW-S", 0.67 + 0.67, 4 + 0.67, 0, 0, 8.5); op("OP-SW-S0b", "W-SW-S", 5.33 + 0.67, 18 + 0.67, 0, 0, 8.5);
  for (const lv of ["L-1", "L-2", "L-3"]) { op(`OP-SW-S-${lv}`, "W-SW-S", 19.83 + 0.67, 22.83 + 0.67, LZ[lv], 0.5, 7); op(`OP-SW-W-${lv}`, "W-SW-W", 30.33 - 29.33, 30.33 - 27.33, LZ[lv], 3.5, 6); }
  for (const lv of ["L-2", "L-3"]) op(`OP-SW-E-${lv}`, "W-SW-E", 25.67 - 20.67, 29.33 - 20.67, LZ[lv], 0.5, 7);
  // elevator (001): concrete 8", its door on the west at every level
  wall("W-EL-S", PT(35.67, 15), PT(43.27, 15), C8, "L-0", null, Object.assign({ height: ft(49) }, r));
  wall("W-EL-N", PT(35.67, 24), PT(43.27, 24), C8, "L-0", null, Object.assign({ height: ft(49) }, r));
  wall("W-EL-W", PT(36, 14.67), PT(36, 24.33), C8, "L-0", null, Object.assign({ height: ft(49) }, r));
  wall("W-EL-E", PT(42.94, 14.67), PT(42.94, 24.33), C8, "L-0", null, Object.assign({ height: ft(49) }, r));
  for (const lv of ["L-0", "L-1", "L-2", "L-3"]) op(`OP-EL-${lv}`, "W-EL-W", 16.21 - 14.67, 19.71 - 14.67, LZ[lv], lv === "L-0" ? 0 : 0.5, 7);
  // the chase (104) beside it on the lobby floor
  wall("W-CH-E", PT(48, 14.67), PT(48, 24.33), C8, "L-1", "L-2"); wall("W-CH-S", PT(43.27, 15), PT(48.33, 15), C8, "L-1", "L-2"); wall("W-CH-N", PT(43.27, 24), PT(48.33, 24), C8, "L-1", "L-2");
  // east stair (100): from the lobby up
  wall("W-SE-S", PT(95.67, 21), PT(116.33, 21), C8, "L-1", null, Object.assign({ baseOffset: -ft(1), height: ft(40) }, r));
  wall("W-SE-W", PT(96, 20.67), PT(96, 30.49), C8, "L-1", null, Object.assign({ baseOffset: -ft(1), height: ft(40) }, r));
  wall("W-SE-E", PT(115.83, 20.67), PT(115.83, 30.49), C12, "L-1", null, Object.assign({ baseOffset: -ft(1), height: ft(40) }, r));
  wall("W-SE-N", PT(95.67, 29.91), PT(116.33, 29.91), "T-AIA-C14", "L-1", null, Object.assign({ baseOffset: -ft(1), height: ft(41) }, r));
  for (const lv of ["L-1", "L-2", "L-3"]) op(`OP-SE-W-${lv}`, "W-SE-W", 25.83 - 20.67, 29.33 - 20.67, LZ[lv] + ft(1), 0.5, 7);
  op("OP-SE-E-L-1", "W-SE-E", 25.5 - 20.67, 29.33 - 20.67, LZ["L-1"] + ft(1), 0.5, 7);
  for (const lv of ["L-2", "L-3"]) op(`OP-SE-E-${lv}`, "W-SE-E", 27.33 - 20.67, 29.33 - 20.67, LZ[lv] + ft(1), 3.5, 6);

  // ---------------------------------------------------------------- the cafe level (L-0): dug in on the south, east and north
  wall("W-R0S", PT(-46, -2), PT(49, -2), "T-AIA-C24", "L-0", "L-1", { baseOffset: -ft(1) });
  wall("W-R0S2", PT(49, -1.33), PT(66.33, -1.33), C8, "L-0", "L-1", { baseOffset: -ft(1) });
  wall("W-R0E", PT(66, -1.67), PT(66, 29.33), C8, "L-0", "L-1", { baseOffset: -ft(1) });
  add({ id: "GM-R0N", type: "Generic", name: "North retaining wall and exterior stair", args: { boundary: FT([[35.9, 29.33], [87.88, 29.33], [94.52, 40.83], [107.13, 40.83], [113.63, 47.33], [100.81, 47.33], [94.81, 41.33], [81.77, 41.33], [75.9, 31.17], [48.33, 31.17], [48.33, 33.17], [35.9, 33.17]]), level: { ref: "L-0" }, baseOffset: -ft(1), height: ft(11), ifcClass: "IfcWall", material: "M-FH-CONC", colour: "" } });
  add({ id: "GM-R0P", type: "Generic", name: "Elevator machine pit", args: { boundary: FT([[36.58, 24.33], [43.27, 24.33], [43.27, 29.33], [36.58, 29.33]]), level: { ref: "L-0" }, baseOffset: -ft(1), height: ft(11), ifcClass: "IfcWall", material: "M-FH-CONC", colour: "" } });
  wall("W-M0S", PT(43.27, 15), PT(51.17, 15), C8, "L-0", "L-1");
  wall("W-M0S2", PT(54.17, 15), PT(65.67, 15), "T-AIA-P45", "L-0", "L-1");
  // the cafe's toilets: M, JAN, W along the south
  const P7 = "T-AIA-P7", P45 = "T-AIA-P45";
  wall("W-T0N", PT(25.08, 10.38), PT(65.67, 10.38), P7, "L-0", "L-1");
  op("OP-T0M", "W-T0N", 35.88 - 25.08, 38.88 - 25.08, 0, 0, 7); op("OP-T0J", "W-T0N", 41.08 - 25.08, 44.08 - 25.08, 0, 0, 7); op("OP-T0W", "W-T0N", 46.29 - 25.08, 49.29 - 25.08, 0, 0, 7);
  wall("W-T0W", PT(25.38, -1), PT(25.38, 10.67), P7, "L-0", "L-1");
  wall("W-T0a", PT(39.42, -1), PT(39.42, 10.38), P7, "L-0", "L-1"); wall("W-T0b", PT(45.75, -1), PT(45.75, 10.38), P7, "L-0", "L-1");
  wall("W-T0c", PT(33.94, 5), PT(33.94, 10.38), P45, "L-0", "L-1"); wall("W-T0d", PT(51.23, 5), PT(51.23, 10.38), P45, "L-0", "L-1");
  // the barista's counter walls and the storage in the stair core
  wall("W-B0a", PT(4.52, 21.33), PT(4.52, 25.04), P45, "L-0", "L-1"); wall("W-B0b", PT(4.33, 25.23), PT(8.79, 25.23), P45, "L-0", "L-1"); wall("W-B0c", PT(8.79, 25.23), PT(8.79, 29.33), P45, "L-0", "L-1");
  wall("W-B0d", PT(16.67, 25.23), PT(18.67, 25.23), P45, "L-0", "L-1"); wall("W-B0e", PT(16.67, 25.23), PT(16.67, 29.33), P45, "L-0", "L-1");

  // ---------------------------------------------------------------- the lobby level (L-1)
  wall("W-P1a", PT(95.85, 3.43), PT(95.85, 20.67), P45, "L-1", "L-2", { baseOffset: SLAB });
  wall("W-P1b", PT(96.04, 3.62), PT(99.04, 3.62), P45, "L-1", "L-2", { baseOffset: SLAB });
  wall("W-P1c", PT(95.67, 9.04), PT(117.03, 9.04), P7, "L-1", "L-2", { baseOffset: SLAB });
  wall("W-P1d", PT(110.56, -0.61), PT(110.56, 8.75), P45, "L-1", "L-2", { baseOffset: SLAB });
  op("OP-P1a", "W-P1a", 11.0 - 3.43, 19.0 - 3.43, ft(10) + SLAB, 0, 7);

  // ---------------------------------------------------------------- the AIA level (L-2): the offices along the south, the core's rooms
  const off = [[45, -0.43, 10.29], [60, 0.02, 10.29], [72, 0.02, 10.29], [84, 0.02, 10.29], [90.4, -0.61, 10.29]];
  off.forEach(([x, a, b], i) => wall(`W-O2-${i}`, PT(x, a), PT(x, b), P45, "L-2", "L-3", { baseOffset: SLAB }));
  wall("W-O2N", PT(45, 10.48), PT(97.88, 10.48), P45, "L-2", "L-3", { baseOffset: SLAB });
  [[56.56, 60.19], [68.56, 72.19], [80.56, 84.19], [86.96, 90.58], [94.33, 97.88]].forEach(([a, b], i) => op(`OP-O2-${i}`, "W-O2N", a - 45, b - 45, ft(24) + SLAB, 0, 7));
  wall("W-O2E", PT(97.88, -0.61), PT(97.88, 16.42), P7, "L-2", "L-3", { baseOffset: SLAB });
  for (const lv of ["L-2", "L-3"]) {
    const o = { baseOffset: SLAB };
    wall(`W-K${lv}a`, PT(43.27, 14.96), PT(65.9, 14.96), P7, lv, lv === "L-2" ? "L-3" : "L-T", o);
    wall(`W-K${lv}b`, PT(53.46, 15.25), PT(53.46, 23.67), P45, lv, lv === "L-2" ? "L-3" : "L-T", o);
    wall(`W-K${lv}c`, PT(59.77, 15.25), PT(59.77, 23.75), P7, lv, lv === "L-2" ? "L-3" : "L-T", o);
    wall(`W-K${lv}d`, PT(66.08, 14.96), PT(66.08, 23.75), P45, lv, lv === "L-2" ? "L-3" : "L-T", o);
    wall(`W-K${lv}e`, PT(46.85, 24), PT(53.27, 24), P7, lv, lv === "L-2" ? "L-3" : "L-T", o);
    wall(`W-K${lv}f`, PT(56.9, 24.04), PT(62.65, 24.04), P7, lv, lv === "L-2" ? "L-3" : "L-T", o);
    wall(`W-K${lv}g`, PT(65.9, 24.04), PT(66.08, 24.04), P7, lv, lv === "L-2" ? "L-3" : "L-T", o);
  }

  // ---------------------------------------------------------------- stairs: two flights a storey in each core (12" treads), the lobby's open stair
  const SW = [{ from: PT(6.67, 27.375), to: PT(19.67, 27.375) }, { from: PT(19.67, 23.29), to: PT(6.67, 23.29) }];
  const SE = [{ from: PT(100.25, 27.375), to: PT(113.33, 27.375) }, { from: PT(113.33, 23.29), to: PT(100.25, 23.29) }];
  const stA = { width: ft(3.42), railings: "Both", args: { maxRiser: 180, material: "M-FH-STEEL", numbers: false } };
  [["L-0", "L-1"], ["L-1", "L-2"], ["L-2", "L-3"]].forEach(([a, b], i) => stair(`ST-W${i}`, "Stair 000", a, b, SW, stA));
  [["L-1", "L-2"], ["L-2", "L-3"]].forEach(([a, b], i) => stair(`ST-E${i}`, "Stair 100", a, b, SE, stA));
  stair("ST-L", "Lobby stair", "L-0", "L-1", [{ from: PT(35.4, 25.57), to: PT(24.6, 25.57) }], { width: ft(7.6), railings: "Both", args: { maxRiser: 180, material: "M-FH-CONC", numbers: false } });
  // ---------------------------------------------------------------- the envelope: south and east siding with storefronts set in it,
  // the north standing seam skin between the tubes on A with its punched windows, the west storefront wall
  const SP = "T-AIA-SPAN";
  wall("W-S1", PT(-3.5, -0.97), PT(117.38, -0.97), SP, "L-1", "L-2", { baseOffset: SLAB, topOffset: 0 });
  wall("W-S2", PT(-3.5, -0.97), PT(117.38, -0.97), SP, "L-2", "L-3", { baseOffset: 0 });
  // the tenant floor's siding stops at the soffit (43'-5 1/2"): over it the roof's structure, sprayed (A501)
  wall("W-S3", PT(-3.5, -0.97), PT(117.38, -0.97), SP, "L-3", null, { height: ft(43.45 - 35.5) });
  wall("W-E", PT(117.03, -1.33), PT(117.03, 21.33), SP, "L-1", null, { baseOffset: SLAB, height: ft(42.03 - 10.5) });
  // a storefront set in a wall: its opening in the host, and a curtain wall filling it with its own grid (Revit's embedded storefront)
  const SF = (id, host, u0, u1, z0, z1, vs, hs, panels = {}) => {
    const hw = doc.element(host), c = doc.argValue(hw, "centreline"), d0 = [c.end[0] - c.start[0], c.end[1] - c.start[1]], Lh = Math.hypot(...d0), dn = [d0[0] / Lh, d0[1] / Lh];
    const base = H.levelZ(doc.argValue(hw, "baseLevel").ref) + (doc.argValue(hw, "baseOffset") || 0);
    add({ id: `OP-${id}`, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at: (ft(u0) + ft(u1)) / 2, sill: ft(z0) - base, w: ft(u1) - ft(u0), h: ft(z1 - z0) }, farProfile: null, depth: "through" } });
    const a = [c.start[0] + dn[0] * ft(u0), c.start[1] + dn[1] * ft(u0)], b = [c.start[0] + dn[0] * ft(u1), c.start[1] + dn[1] * ft(u1)];
    const sh = SF.shift && SF.shift[host] ? SF.shift[host] : [0, 0], a2 = [a[0] + ft(sh[0]), a[1] + ft(sh[1])], b2 = [b[0] + ft(sh[0]), b[1] + ft(sh[1])];
    add({ id, type: "Wall", name: `Storefront ${id}`, args: { centreline: line(a2, b2), mounting: "Centred", wallType: { ref: "T-AIA-SF" }, baseLevel: { ref: "L-0" }, baseOffset: ft(z0), topLevel: null, topOffset: 0, height: ft(z1 - z0), flipped: false,
      curtainGrid: { vertical: { positions: vs.map(v => ft(v - u0)) }, horizontal: { positions: hs.map(h => ft(h - z0)) }, panels } } });
  };
  H.SF = SF;
  // the south storefronts stand in the siding's inner half: their mullions' centre 9 5/8" out from grid B (A501, A502)
  SF.shift = { "W-S1": [0, 0.168], "W-S2": [0, 0.168], "W-S3": [0, 0.168] };
  // the details draw the roof's framing as the structural drawings have it, not the model's purlins
  L.viewStyles["VS-FH-DET"].rules.push({ id: "R-DET-PURLIN", name: "Purlins by structural", when: { param: "Type", is: "T-AIA-W12" }, then: { visible: false } });
  // ---- north: the standing seam skin on A, running past both ends; perforated sunscreens over its windows; the box at the AIA floor
  L.types["T-AIA-PANEL"] = { family: "F-BASICWALL", name: "Standing seam metal panels on hat channels (over concrete)", mark: "M2", layers: [lay("Finish 1", 2.625, "M-AIA-SEAM")], coreStart: 0, coreEnd: 1, params: { Function: "Exterior" } };
  mat("M-AIA-PERF", "Perforated metal sun screen", "7.3", { pattern: null, pen: "medium", lineColour: "#000000", background: "#ffffff" }, { pen: "thin", pattern: "P-AIA-PERF", lineColour: "#8a8a8a" }, "#9aa0a6");
  L.patterns["P-AIA-PERF"] = { name: "Perforated metal", kind: "drafting", lines: [{ angle: 0, origin: [0, 0], delta: [0.35, 0.6], dashes: [0.08, -0.6] }] };
  const NZ0 = 12.49, NTOP = 51.67;
  wall("W-N", PT(24.33, 29.98), PT(95.67, 29.98), "T-AIA-SKIN", "L-0", null, { baseOffset: ft(10.5), height: ft(NTOP - 10.5) });
  wall("W-NW", PT(-16, 29.98), PT(-0.67, 29.98), "T-AIA-SKIN", "L-0", null, { baseOffset: ft(NZ0), height: ft(NTOP - NZ0) });
  wall("W-NE", PT(116.33, 29.98), PT(124, 29.98), "T-AIA-SKIN", "L-0", null, { baseOffset: ft(NZ0), height: ft(NTOP - NZ0) });
  wall("W-NC1", PT(-0.67, 30.44), PT(24.33, 30.44), "T-AIA-PANEL", "L-0", null, { baseOffset: ft(NZ0), height: ft(NTOP - NZ0) });
  wall("W-NC2", PT(95.67, 30.44), PT(116.33, 30.44), "T-AIA-PANEL", "L-0", null, { baseOffset: ft(NZ0), height: ft(NTOP - NZ0) });
  // the canopy the skin turns under along the north: 1'-10" deep, level on the west, rising 2'-9" to the east end
  floor("FL-CAN0", "North canopy (west)", FT([[-16, 30.49], [24.33, 30.49], [24.33, 36], [-16, 36]]), "T-AIA-CAN", "L-0", ft(12.49));
  roof("RF-CAN", "North canopy", FT([[24.33, 30.49], [24.33, 36], [124, 36], [124, 30.49]]), "L-0", ft(12.49), [Math.atan(2.77 / 99.67) * 180 / Math.PI, null, null, null], { thickness: 430, material: "M-AIA-SEAM" });
  const PF = "M-AIA-PERF";
  // the lobby's storefront under the canopy, the sunscreened windows over it
  SF("SF-N1", "W-N", 47.8 - 24.33, 95.67 - 24.33, 10.5, 21.2, [60, 72, 84].map(x => x - 24.33), [12.6, 13.3], { "*,1": "M-AIA-SEAM", "*,2": PF });
  SF("SF-N1b", "W-N", 0, 36 - 24.33, 11.6, 21.2, [], [], { "0,0": PF });
  SF("SF-N2", "W-N", 26.1 - 24.33, 36 - 24.33, 23.9, 33, [], [], { "0,0": PF });
  [[47.8, 52.5], [59.8, 64.5], [71.8, 76.5]].forEach(([a, b], i) => SF(`SF-N3m${i}`, "W-N", a - 24.33, b - 24.33, 35.3, 42.7, [], [], { "0,0": PF }));
  SF("SF-N3a", "W-N", 0, 36 - 24.33, 35.3, 47.6, [], [], { "0,0": PF }); SF("SF-N3b", "W-N", 83.9 - 24.33, 95.6 - 24.33, 35.3, 47.6, [], [], { "0,0": PF });
  [[36.3, 47.5], [48.4, 59.5], [60.4, 71.5], [72.4, 83.6]].forEach(([a, b], i) => SF(`SF-N3u${i}`, "W-N", a - 24.33, b - 24.33, 43.2, 47.6, [], [], { "0,0": PF }));
  // the box: siding and storefront, projecting 3'-6" at the AIA floor
  add({ id: "OP-BX", type: "Opening", args: { host: { ref: "W-N" }, profile: { kind: "rect", at: ft((46.86 + 95.67) / 2 - 24.33), sill: ft(22.94 - 10.5), w: ft(95.67 - 46.86), h: ft(33.42 - 22.94) }, farProfile: null, depth: "through" } });
  wall("W-BXW", PT(46.86, 30.49), PT(46.86, 34), SP, "L-0", null, { baseOffset: ft(22.94), height: ft(33.42 - 22.94) });
  wall("W-BXE", PT(97.14, 34), PT(97.14, 30.49), SP, "L-0", null, { baseOffset: ft(22.94), height: ft(33.42 - 22.94) });
  wall("W-BXN", PT(97.14, 33.64), PT(46.86, 33.64), SP, "L-0", null, { baseOffset: ft(22.94), height: ft(33.42 - 22.94) });
  SF("SF-BX", "W-BXN", 97.14 - 96.62, 97.14 - 66.44, 24.0, 32.75, [93.95, 84.7, 81.78, 72.7, 69.78].map(x => 97.14 - x), [27.09], { "0,1": { m: "M-GLASS", swing: "L" }, "2,1": { m: "M-GLASS", swing: "L" }, "4,1": { m: "M-GLASS", swing: "L" } });
  floor("FL-BXR", "Box roof", FT([[46.86, 30.49], [97.14, 30.49], [97.14, 34], [46.86, 34]]), "T-AIA-DECK", "L-0", ft(33.42));

  // ---- east: siding over the south bay, the stair's door at grade, the clerestory up under the roof
  SF("SF-E1", "W-E", 0.68 + 1.33, 4.01 + 1.33, 10.5, 17.19, [], [], { "0,0": { m: "M-GLASS", swing: "D" } });
  SF("SF-E2", "W-E", 10.92 + 1.33, 22.0 + 1.33, 23.96, 32.84, [14.3 + 1.33], [], { "0,0": { m: "M-GLASS", swing: "L" } });
  // the clerestory: its grid under the roof's slope (the curtain wall's top follows the roof it is attached to)
  wall("W-E3", PT(117.03, -1.33), PT(117.03, 21.33), "T-AIA-SF", "L-0", null, Object.assign({ baseOffset: ft(42.03), height: ft(8) }, r));
  H.set("W-E3", "curtainGrid", { vertical: { positions: [0.66, 7.5, 14.33].map(v => ft(v + 1.33)) }, horizontal: { positions: [] } });
  add({ id: "OP-SE-EG", type: "Opening", args: { host: { ref: "W-SE-E" }, profile: { kind: "rect", at: ft((25.5 + 28.83) / 2 - 20.67), sill: ft(4.94 - 9), w: ft(28.83 - 25.5), h: ft(12.11 - 4.94) }, farProfile: null, depth: "through" } });

  // ---- west: the storefront wall of the cafe and the lobby's void, three storeys and up under the roof
  wall("W-W", PT(-2.92, 21.33), PT(-2.92, -1.33), "T-AIA-SF", "L-0", null, Object.assign({ baseOffset: 0, height: ft(47) }, r));
  H.set("W-W", "curtainGrid", { vertical: { positions: [21.25 - 17.9, 21.25 - 11.5, 21.25 - 5.26].map(v => ft(v + 0.08)) }, horizontal: { positions: [7.0, 7.46, 12.17, 13.17, 21.08, 22.08, 32.96, 33.13, 38.5, 38.67].map(ft) },
    panels: { "*,1": "M-AIA-ALUM", "*,3": "M-AIA-ALUM", "*,5": "M-AIA-ALUM", "*,7": "M-AIA-ALUM", "*,8": "M-AIA-SIDING", "*,9": "M-AIA-ALUM", "1,0": { m: "M-GLASS", swing: "D" } } });
  // south, lobby: a glass ribbon over the terrace's stone; the storefront of the lobby and the multi-purpose room (doors, folding doors)
  const R_ = "R", D_ = "D";
  SF("SF-S1a", "W-S1", -3.5 + 3.5, 19 + 3.5, 13.17, 15.83, [0 + 3.5, 12 + 3.5], []);
  SF("SF-S1b", "W-S1", 19.17 + 3.5, 95.5 + 3.5, 10.5, 21.08, [26.69, 33.31, 42, 48, 54, 60.5, 66, 72, 78, 83.5, 90].map(x => x + 3.5), [13.0, 17.3],
    { "1,0": { m: "M-GLASS", swing: D_ }, "1,1": { m: "M-GLASS", swing: D_ }, "6,0": { m: "M-GLASS", swing: D_ }, "6,1": { m: "M-GLASS", swing: D_ }, "7,0": { m: "M-GLASS", swing: D_ }, "7,1": { m: "M-GLASS", swing: D_ }, "8,0": { m: "M-GLASS", swing: D_ }, "8,1": { m: "M-GLASS", swing: D_ }, "9,0": { m: "M-GLASS", swing: D_ }, "9,1": { m: "M-GLASS", swing: D_ } });
  // south, AIA: the balcony's doors and the offices' windows (fixed lights, 3' operable sashes)
  SF("SF-S2a", "W-S2", 19.17 + 3.5, 35.42 + 3.5, 24.5, 32.96, [26.92, 33.08].map(x => x + 3.5), [31.08], { "1,0": { m: "M-GLASS", swing: D_ } });
  SF("SF-S2b", "W-S2", 42.5 + 3.5, 60 + 3.5, 27.17, 32.96, [45.04, 56.96].map(x => x + 3.5), [], { "0,0": { m: "M-GLASS", swing: R_ }, "2,0": { m: "M-GLASS", swing: R_ } });
  SF("SF-S2c", "W-S2", 60 + 3.5, 72 + 3.5, 27.17, 32.96, [68.96 + 3.5], [], { "1,0": { m: "M-GLASS", swing: R_ } });
  SF("SF-S2d", "W-S2", 72 + 3.5, 83.73 + 3.5, 27.17, 32.96, [80.69 + 3.5], [], { "1,0": { m: "M-GLASS", swing: R_ } });
  SF("SF-S2e", "W-S2", 90.25 + 3.5, 93.25 + 3.5, 27.17, 32.96, [], [], { "0,0": { m: "M-GLASS", swing: R_ } });
  SF("SF-S2f", "W-S2", 97.92 + 3.5, 111 + 3.5, 27.17, 34.83, [108 + 3.5], [33.04], { "1,0": { m: "M-GLASS", swing: R_ } });
  // south, tenant: the clerestory under the eave, a 3' operable sash at every grid line and fixed lights between
  { const vs = []; for (let k = 0; k <= 9; k++) vs.push(12 * k, 12 * k + 3, 12 * k + 6); const sw = {}; for (let k = 0; k <= 9; k++) sw[`${1 + 3 * k},0`] = { m: "M-GLASS", swing: R_ };
    SF("SF-S3", "W-S3", 0, 116.5 + 3.5, 38.58, 43.42, vs.filter(x => x < 113).map(x => x + 3.5), [], sw); }
  // ---------------------------------------------------------------- the ground, from the elevations' grade lines: the plaza on the south and
  // east at the lobby's floor (333'), the cafe's terrace on the west at 323', the north falling from 1' to the east's 4'
  const G_ = (z, pts) => ({ z: ft(z), points: FT(pts) });
  const contours = [G_(10, [[-46, -3.3], [150, -3.3]]), G_(10, [[-60, -40], [150, -40]]), G_(10, [[119, -1.4], [150, -1.4]]),
    G_(0, [[-46, -0.8], [-3.3, -0.8], [-3.3, 29.2], [-46, 29.2]]), G_(0.5, [[-78, 36], [-3.3, 36]]), G_(1, [[-78, 40], [2, 38]]), G_(0, [[2, 33.5], [47, 33.5]]),
    G_(-0.6, [[48, 31.4], [117.6, 31.4]]), G_(5.9, [[119, 13.5], [150, 13.5]]), G_(4.4, [[119, 29.5], [150, 29.5]]), G_(3.8, [[100, 46], [150, 46]]), G_(2, [[-70, 60], [150, 60]])];
  topo("TS-1", "Existing grade", contours, FT(RECT(-80, -60, 160, 70)), -ft(10), [{ boundary: FT(RECT(-3.2, -1.4, 66.3, 29.4)), z: -ft(0.5) }, { boundary: FT(RECT(66.3, -1.4, 117.4, 30.5)), z: ft(9.5) }]);
  // ---------------------------------------------------------------- views
  const PC = [ft(-50), ft(-40), ft(150), ft(42)];
  H.plan("V-P0", "PLAN cafe + exhibit", "L-0", { top: 2300, cut: 1200, bottom: -300, depth: -600 }, PC, 96);
  H.plan("V-P1", "PLAN lobby + multi-purpose", "L-1", { top: 2300, cut: 1200, bottom: -300, depth: -3500 }, PC, 96);
  H.plan("V-P2", "PLAN aia", "L-2", { top: 2300, cut: 1200, bottom: -300, depth: -4000 }, PC, 96);
  H.plan("V-P3", "PLAN tenant", "L-3", { top: 2300, cut: 1200, bottom: -300, depth: -4000 }, PC, 96);
  H.plan("V-PR", "ROOF PLAN", "L-T", { top: ft(10), cut: ft(8), bottom: -ft(60), depth: -ft(62) }, PC, 96, "VS-FH-SITE");
  const EZ = [-ft(6), ft(58)];
  H.elev("V-W", "ELEVATION west", PT(-60, -45), PT(-60, 60), ft(100), "L-0", [ft(10), EZ[0], ft(100), EZ[1]], 96, { top: ft(58) });
  H.elev("V-N", "ELEVATION north", PT(-40, 60), PT(160, 60), ft(80), "L-0", [ft(10), EZ[0], ft(200), EZ[1]], 96, { top: ft(58) });
  H.elev("V-E", "ELEVATION east", PT(170, 60), PT(170, -45), ft(100), "L-0", [ft(10), EZ[0], ft(100), EZ[1]], 96, { top: ft(58) });
  H.elev("V-S", "ELEVATION south", PT(160, -45), PT(-60, -45), ft(80), "L-0", [ft(10), EZ[0], ft(215), EZ[1]], 96, { top: ft(58) });
  // the sections: A402 at 01+6' looking east (A on the left), A403 at 06+6' looking west (B on the left)
  const XC = [ft(3), -ft(10), ft(92), ft(54)];
  H.sect("V-X", "SECTION", PT(30, -34.5), PT(30, 49.33), ft(6), "L-0", XC, 48, { top: ft(58) });
  H.sect("V-X2", "SECTION ", PT(66.6, 49.33), PT(66.6, -34.5), ft(6), "L-0", [ft(3), -ft(10), ft(92), ft(54)], 48, { top: ft(58) });
  H.view3d("V-3D", "AXONOMETRIC", { azimuth: 215, elevation: 24, target: [ft(58), ft(12), ft(20)] }, 200);

  // ---------------------------------------------------------------- sheets: the set's own (its PDF's title strips, names and notes)
  H.useSet("aia");
  const pl = p0 => H.place(p0, [0, 0], [ft(50), ft(0)], PC, 96, 96);
  H.pdfSheet(1, [["V-P0", pl([283.8, 433.4])], ["V-P1", pl([283.8, 133.3])]]);
  H.pdfSheet(2, [["V-P2", pl([283.8, 433.4])], ["V-P3", pl([283.8, 133.3])]]);
  const ev = (p0, s, crop) => H.place(p0, [s, 0], [(crop[0] + crop[2]) / 2, ft(25)], crop, 96, 96);
  H.pdfSheet(5, [["V-W", ev([217.4, 405.7], ft(30), [ft(10), EZ[0], ft(100), EZ[1]])], ["V-N", ev([642.2, 48.7], ft(160), [ft(10), EZ[0], ft(200), EZ[1]])]]);
  H.pdfSheet(6, [["V-E", ev([613.4, 405.7], ft(45), [ft(10), EZ[0], ft(100), EZ[1]])], ["V-S", ev([331.9, 43.7], ft(60), [ft(10), EZ[0], ft(215), EZ[1]])]]);
  H.pdfSheet(3, [["V-X", H.at([407.0, 145.46], [ft(19.33), 0], XC, 48), { noTitle: true }]]);
  H.pdfSheet(4, [["V-X2", H.at([451.45, 145.46], [ft(34.5), 0], [ft(3), -ft(10), ft(92), ft(54)], 48), { noTitle: true }]]);
  // ---------------------------------------------------------------- the details (A501-A503): 1:12 callouts of the section, where the set has them.
  // North-south details cut with A403 (x 66'-7", looking west: s = y + 34'-6"); east and west ones on a cut at y 5' looking south (s = 130' - x)
  const NS = [PT(66.6, 49.33), PT(66.6, -34.5)], EW = [PT(-20, 5), PT(130, 5)], near = { depth: 600 }, sN = y => ft(y + 34.5), sE = x => ft(130 - x);
  const X2 = (px, py) => [ft(34.5) + Math.round((px - 451.45) * 48), Math.round((py - 145.46) * 48)];
  const box = (x0, y0, x1, y1) => [...X2(x0, y0), ...X2(x1, y1)];
  const co = (rect, bubble, label) => ({ parent: "V-X2", rect, bubble: X2(...bubble), label, radius: 3 });
  const D = H.detail, soffitBot = ft(43.62) - 51;
  H.pdfSheet(7, [
    D("V-D501-4", "SOUTH EAVE/WALL", ...NS, [48, 286.3, 634.2, 540], [456.53, 413.96], [sN(0), soffitBot], { number: 4, gridHead: true, gridTop: sN(0) * 0 + Math.round((584.09 - 413.96) * 12) + soffitBot, callout: co(box(355.6, 346.0, 514.8, 472.4), [324.45, 408.83], "1") }),
    D("V-D501-3", "SOUTH WALL", ...NS, [411, 62.5, 634.2, 280.6], [456.53, 167.24], [sN(0), ft(36)], { number: 3 }),
    D("V-D501-2", "NORTH WALL @ roof", ...NS, [688.4, 286.3, 816.4, 557.2], [739.68, 557.2], [sN(30), ft(51.73)], { number: 2, gridHead: true, gridTop: Math.round((584.88 - 557.2) * 12) + ft(51.73), callout: co(box(622.6, 442.5, 661.5, 480.9), [692.75, 461.72], "4") }),
    D("V-D501-1", "NORTH WALL", ...NS, [680.1, 62.5, 825, 273.6], [739.68, 167.24], [sN(30), ft(36)], { number: 1 })]);
  H.pdfSheet(8, [
    D("V-D502-1", "SOUTH WALL", ...NS, [285.7, 319.8, 639.9, 538], [405.73, 424.59], [sN(0), ft(24.5)], { number: 1, gridHead: true, gridTop: Math.round((584.25 - 424.59) * 12) + ft(24.5), callout: co(box(431.8, 272.6, 470.2, 311.6), [400.65, 283.61], "2") }),
    D("V-D502-2", "NORTH WALL", ...NS, [640.1, 319.8, 785.9, 538], [663.48, 424.59], [sN(30), ft(36)], { number: 2, gridHead: true, gridTop: Math.round((584.25 - 424.59) * 12) + ft(36), callout: {} }),
    D("V-D502-4", "SOUTH WALL @ foundation wall", ...NS, [292, 109.3, 639.5, 314.1], [405.73, 185.46], [sN(0), ft(10.5)], { number: 4, callout: co(box(431.8, 185.1, 470.2, 221.2), [400.65, 194.15], "3") }),
    D("V-D502-3", "NORTH WALL @ foundation wall", ...NS, [640.4, 102.6, 821.5, 307.1], [663.48, 185.46], [sN(30), ft(10.5)], { number: 3, callout: {} })]);
  // A502/2 is cut through a window of the AIA floor's box, not through its roof: the box is not seen there
  { const ov = Object.assign({}, doc.argValue(doc.element("V-D502-2"), "overrides")); for (const k of ["FL-BXR", "W-BXN", "W-BXW", "W-BXE", "SF-BX"]) ov[k] = { visible: false }; H.set("V-D502-2", "overrides", ov); }
  const eastTop = ft(47.37 - 0.71);
  H.pdfSheet(9, [
    D("V-D503-9", "EAST WALL @ ROOF", ...EW, [126.6, 387.5, 222.4, 492.3], [187.21, 459.9], [sE(116), eastTop], { number: 9, ...near, gridHead: true, gridTop: Math.round((583.6 - 459.9) * 12) + eastTop, callout: {} }),
    D("V-D503-8", "EAST WALL@ 3rd level", ...EW, [83.9, 231.4, 222.4, 374.8], [187.21, 265.79], [sE(116), ft(36)], { number: 8, ...near, callout: {} }),
    D("V-D503-7", "EAST WALL@ storage", ...EW, [83.3, 79.5, 239.7, 228.6], [187.21, 91.17], [sE(116), ft(10.5)], { number: 7, ...near, callout: {} }),
    D("V-D503-5", "METAL CEILING DETAIL", ...EW, [240.2, 178.7, 379.2, 265.8], [298.6, 265.79], [sE(60), ft(36)], { number: 5, ...near, gridHead: true, gridTop: Math.round((583.6 - 265.79) * 12) + ft(36), callout: {} }),
    D("V-D503-3", "WEST WALL @ roof", ...EW, [382.4, 387.5, 843.9, 578.5], [405.73, 462.38], [sE(0), ft(44.47)], { number: 3, ...near, gridHead: true, gridTop: Math.round((583.65 - 462.38) * 12) + ft(44.47), callout: {} }),
    D("V-D503-2", "WEST WALL @ 3rd level", ...EW, [381.2, 167.1, 572.4, 374.8], [405.73, 265.79], [sE(0), ft(36)], { number: 2, ...near, callout: {} }),
    D("V-D503-1", "WEST WALL @ basement level", ...EW, [405.7, 35.1, 565.7, 154.4], [405.73, 56.4], [sE(0), ft(7.5)], { number: 1, ...near, callout: {} })]);
  H.sheet("A901", "Axonometric", [["V-3D", [420, 300]]], "ARCH D", { titleBlock: "SY-TB-AIA" });
  // the datums where the set draws them: level heads at the left (the east elevation's at the right), grid heads over the drawing
  H.pdfDatums(5, "V-W", { levels: [103.06, 153.86], gridHead: 586.32, gridFoot: 386 }); H.pdfDatums(5, "V-N", { levels: [103.06, 153.86], gridHead: 229.83, gridFoot: 30 });
  H.pdfDatums(6, "V-E", { levels: [822.92, 772.12], gridHead: 586.52, gridFoot: 386 });
  H.pdfDatums(3, "V-X", { levels: [197.45, 299.05], gridHead: 507.41, gridFoot: 85, R: 6.35 }); H.pdfDatums(4, "V-X2", { levels: [851.5, 749.9], gridHead: 507.41, gridFoot: 85, R: 6.35 }); H.pdfDatums(6, "V-S", { levels: [103.06, 153.86], gridHead: 224.84, gridFoot: 25 });
  for (const pg of [1, 2, 3, 4, 5, 6, 7, 8, 9]) H.annotate(pg, { rooms: pg <= 2 });
  for (const pg of [7, 8, 9]) H.lift(pg);
  H.joinTolerance = 50; H.joinWalls();
  doc.regenerate();
  return doc;
}
