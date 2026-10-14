//! Two office towers, each a design-development set drawn from one parametric massing.
//!
//! The massing is a Massing element with a `tower`: numbers (towers.js) that the parametric CAD shows as a
//! geometrical set called Tower massing - one closed solid, its sliders the tower's parameters. Everything else is
//! made from it by the towersync op and follows it: a level per storey, a slab per level cut from the massing, the
//! core from the ground to the roof, the glass skin, the diagrid and the perimeter columns, the core's doors and
//! rooms on the levels the sheets show, the crops round each plate, the dimensions to each plate, and the notes
//! that quote the tower's numbers.
//!
//!   Diagrid tower  - after Brookfield Place, Dubai (Foster + Partners): a square plate swelling to 1.06 at 62% of
//!                    its height and narrowing to 0.86 at the top, folded on a giant diagrid (one diamond a face,
//!                    node rows every 13 storeys), its corners chamfered and pushed in (a bird's mouth).
//!   Twisting tower - after the Generali Tower, Milan (Zaha Hadid Architects): a rounded four-sided plate with two
//!                    notched corners, turned 52° over the height (most of it low), flared at the foot.
//!
//! Sheets follow the US National CAD Standard: G (general), A (architectural); 0 general, 1 plans, 2 elevations,
//! 3 sections, 4 enlarged views, 5 details, 6 schedules, 9 3D. A1 landscape, metric, in an AIA-style strip.

import { newDocument } from "./bim.js";
import { Editor } from "./ops.js";
import { towerGeometry, towerParams, towerCore } from "./towers.js";
import { checkFitout } from "./fitout.js";

const ISSUE_DATE = "2026-10-14";
const KINDS = {
  diagrid: {
    name: "Diagrid Office Tower", short: "DIAGRID", precedent: "Brookfield Place, Dubai (Foster + Partners)",
    params: {}, elevScale: 500, planScale: 200, siteScale: 500, number: "T1",
    character: "A square plate that swells to its widest at 62% of the height and narrows to the top, folded on a giant diagrid, its corners cut back into a bird's mouth.",
  },
  twist: {
    name: "Twisting Office Tower", short: "TWIST", precedent: "the Generali Tower, Milan (Zaha Hadid Architects)",
    params: {}, elevScale: 500, planScale: 200, siteScale: 500, number: "T2",
    character: "A rounded four-sided plate with two notched corners, turned storey by storey about a fixed core; the turn is taken mostly low, where the plate flares out to meet the podium.",
  },
};

export function buildDiagridTowerSample() { return buildTowerSet("diagrid"); }
export function buildTwistTowerSample() { return buildTowerSet("twist"); }

function buildTowerSet(kind) {
  const K = KINDS[kind];
  const doc = newDocument(K.name);
  const ed = new Editor(doc);
  const add = (element) => { const r = ed.apply({ op: "add", element }, { regenerate: false, undoable: false }); if (!r.ok) throw new Error(`${element.id || element.type}: ${r.error}`); return r.id; };
  const apply = (op) => { const r = ed.apply(op, { undoable: false }); if (!r.ok) throw new Error(`${op.op}: ${r.error}`); return r; };
  const rnd = p => [Math.round(p[0]), Math.round(p[1])];
  const line = (a, b) => ({ type: "line", start: rnd(a), end: rnd(b) });
  const L = doc.lib;

  // ---------------------------------------------------------------- standards: text, materials, types, view styles
  for (const [id, h, bold] of [["TT-T18", 1.8], ["TT-T20", 2.0], ["TT-T25", 2.5], ["TT-T35", 3.5, true], ["TT-T50", 5.0, true], ["TT-T80", 8.0, true], ["TT-T14", 14.0, true]])
    L.textTypes[id] = { name: `${h} mm Arial${bold ? " Bold" : ""}`, height: h, font: bold ? "ArialBold" : "Arial", widthFactor: 1, colour: "#000000", pen: h >= 3.5 ? "medium" : "thin" };
  L.materials["M-TWR-RAF"] = { name: "Raised access floor on pedestals", mark: "RF-01", description: "Raised access floor, 600 × 600 panels on pedestals", cut: { pattern: null, pen: "thin", lineColour: "#1b1f24", background: "#ffffff" }, projection: { pen: "thin" }, shading: { colour: "#d9d6cf" } };
  L.types["T-TWR-SLAB"] = { family: "F-FLOOR", name: "Office floor: raised floor 150 on concrete slab 250", mark: "FL1",
    layers: [{ function: "Finish 1", thickness: 150, material: "M-TWR-RAF" }, { function: "Structure", thickness: 250, material: "M-CONC" }], coreStart: 1, coreEnd: 2 };
  const wt = (id, name, mark, th) => { L.types[id] = { family: "F-BASICWALL", name, mark, layers: [{ function: "Structure", thickness: th, material: "M-CONC" }], coreStart: 0, coreEnd: 1, params: { Function: "Core", FireRating: "120" } }; };
  wt("T-TWR-CORE500", "Core wall, reinforced concrete 500", "CW5", 500);
  wt("T-TWR-CORE250", "Core wall, reinforced concrete 250", "CW2", 250);
  L.types["T-TWR-LIFT"] = { family: "F-SINGLEDOOR", name: "Lift landing door 1100 × 2400", mark: "LD", width: 1100, height: 2400, leafThickness: 40, frame: 50, params: { FireRating: "60" } };
  L.types["T-TWR-D1"] = { family: "F-SINGLEDOOR", name: "Fire door 1000 × 2200, 90 min", mark: "D1", width: 1000, height: 2200, leafThickness: 54, frame: 50, params: { FireRating: "90" } };
  // the sets' style: the construction style, the massing envelope off (its slabs, core and skin draw the tower),
  // columns and diagrid solid when cut, the core's rooms tagged by name and number
  const VS = JSON.parse(JSON.stringify(L.viewStyles["VS-CONSTRUCTION"])); VS.name = "Tower DD";
  VS.byCategory.Mass = { visible: false };
  VS.byCategory.IfcColumn = { materialPriority: "view", cut: { fill: "#1b1f24", pattern: "solid", pen: "thin" } };
  VS.byCategory.IfcMember = { materialPriority: "view", cut: { fill: "#1b1f24", pattern: "solid", pen: "thin" } };
  VS.byCategory.IfcSlab = { cut: { pen: "medium" }, projection: { pen: "thin" } };
  VS.byCategory.IfcSpace = { fill: "none", label: { height: 2.0, colour: "#000000", align: "centre", content: "{Name}\n{Number}" } };
  // the core's concrete solid grey at 1:200 and smaller; hatched in the enlarged core plan (its own style)
  const VSC = JSON.parse(JSON.stringify(VS)); VSC.name = "Tower DD enlarged"; L.viewStyles["VS-TWR-CORE"] = VSC;
  VS.byCategory.IfcWall = Object.assign({}, VS.byCategory.IfcWall, { cut: { fill: "#8d939a", pattern: "solid", pen: "thin", detailLevel: "Coarse" } });
  L.viewStyles["VS-TWR"] = VS;
  const VS3 = JSON.parse(JSON.stringify(VS)); VS3.name = "Tower DD 3D"; VS3.byCategory.IfcSpace = { visible: false }; L.viewStyles["VS-TWR-3D"] = VS3;
  const VSS = JSON.parse(JSON.stringify(VS)); VSS.name = "Tower DD site"; VSS.byCategory.IfcSpace = { visible: false }; VSS.byCategory.IfcDoor = { visible: false }; VSS.byCategory.IfcGrid = { visible: false }; L.viewStyles["VS-TWR-SITE"] = VSS;
  // elevations and sections: no grids (they would stand over the crown), the rest as the plans
  const VSE = JSON.parse(JSON.stringify(VS)); VSE.name = "Tower DD elevation"; VSE.byCategory.IfcGrid = { visible: false }; VSE.byCategory.IfcSpace = { visible: false }; L.viewStyles["VS-TWR-ELEV"] = VSE;

  // the project: what is known is written; what is not (the firm, the client, the consultants) stays blank
  doc.meta.project = Object.assign({}, doc.meta.project || {}, {
    number: K.number, issued: ISSUE_DATE, issue: "Design development", address: "Site to be confirmed",
    "Issue No.": "01\n02", "Issue Description": "Schematic design\nDesign development", "Issue Dates": `${ISSUE_DATE}\n${ISSUE_DATE}`,
    "Key Plan Note": `Study ${K.number}: ${kind === "diagrid" ? "diagrid" : "twisting"} tower`,
  });
  doc.meta.displayUnits = "mm";

  // ---------------------------------------------------------------- the massing, and the building made from it
  const p = towerParams({ kind, params: K.params }), G0 = towerGeometry(kind, p), core = towerCore(p);
  add({ id: "MS", type: "Massing", name: "Tower massing", args: { tower: { kind, params: p, sync: { floorType: "T-TWR-SLAB", coreType: "T-TWR-CORE500", coreInnerType: "T-TWR-CORE250", liftDoorType: "T-TWR-LIFT", doorType: "T-TWR-D1" } }, floorToFloor: p.floorToFloor } });
  doc.regenerate();
  apply({ op: "towersync", id: "MS" });

  // the site: the podium's block with room round it; streets on two sides
  const pr = G0.podium ? G0.podium.ring : [[-40000, -40000], [40000, -40000], [40000, 40000], [-40000, 40000]];
  const PX0 = pr[0][0], PY0 = pr[0][1], PX1 = pr[2][0], PY1 = pr[2][1];
  const SX0 = PX0 - 18000, SY0 = PY0 - 16000, SX1 = PX1 + 14000, SY1 = PY1 + 12000;
  add({ id: "SITE", type: "SiteBoundary", name: "Site boundary", args: { sketch: { elements: [[SX0, SY0], [SX1, SY0], [SX1, SY1], [SX0, SY1]].map((a, i, A) => ({ id: `e${i + 1}`, type: "line", a: rnd(a), b: rnd(A[(i + 1) % 4]) })), constraints: [], dims: [] }, edges: {}, setback: 0, level: { ref: "MS-L00" }, label: false } });

  // grids: on the core's outer walls and its end-zone walls (numbers across, letters up)
  const cg = (q) => core.rotate(q);
  const gx = [-p.coreWidth / 2 + 250, core.xa, core.xb, p.coreWidth / 2 - 250], gy = [-p.coreDepth / 2 + 250, p.coreDepth / 2 - 250];
  // the grid lines reach past the widest plate, their heads inside each plan's crop
  const big = Math.max(p.plateWidth, p.plateDepth) / 2 * Math.max(1, p.bellyScale || 1, kind === "twist" ? 1 + p.baseFlare : 1);
  const reach = big + 8000;
  gx.forEach((x, i) => add({ id: `G-${i + 1}`, type: "Grid", name: String(i + 1), args: { name: String(i + 1), line: line(cg([x, -reach]), cg([x, reach])), orthogonal: false, headSize: 8, textSize: 3.5 } }));
  gy.forEach((y, i) => add({ id: `G-${"AB"[i]}`, type: "Grid", name: "AB"[i], args: { name: "AB"[i], line: line(cg([-reach, y]), cg([reach, y])), orthogonal: false, headSize: 8, textSize: 3.5 } }));

  // ---------------------------------------------------------------- views
  const vr = (top, cut, bottom, depth) => ({ top, cut, bottom, depth });
  const plan = (id, name, tag, o = {}) => add({ id, type: "PlanView", name, args: Object.assign({ level: { ref: "MS-L00" }, scale: K.planScale, viewRange: vr(2300, 1200, 0, 0), detailLevel: "Medium", style: { ref: "VS-TWR" }, clip: { rect: null, visible: false, active: false } }, o.args || {}),
    params: Object.assign({ "Tower level": tag, "Tower view title": o.title || name }, o.crop === false ? {} : { "Tower crop": String(o.crop || 12500) }) });
  const podCrop = { rect: [PX0 - 6000, PY0 - 7000, PX1 + 6000, PY1 + 7000].map(Math.round), visible: false, active: true };
  plan("V-L00", "GROUND FLOOR PLAN", "ground", { crop: false, args: { scale: 250, clip: podCrop, viewRange: vr(2300, 1200, 0, 0) } });
  plan("V-POD", "LEVEL {n} — PODIUM ROOF", "podium", { title: "LEVEL {n} — PODIUM ROOF", crop: false, args: { scale: 250, clip: podCrop, viewRange: vr(2300, 1200, -500, -500) } });
  plan("V-LOW", "LEVEL {n} — TYPICAL FLOOR, LOW RISE", "0.12", { title: "LEVEL {n} — TYPICAL FLOOR, LOW RISE" });
  plan("V-MID", "LEVEL {n} — TYPICAL FLOOR, MID RISE", "0.5", { title: "LEVEL {n} — TYPICAL FLOOR, MID RISE" });
  plan("V-HIGH", "LEVEL {n} — TYPICAL FLOOR, HIGH RISE", "0.88", { title: "LEVEL {n} — TYPICAL FLOOR, HIGH RISE" });
  plan("V-ROOF", "ROOF PLAN", "roof", { args: { viewRange: vr(Math.round(p.crownHeight + 2000), 1200, -600, -600) } });
  // the site: the roofs seen from above, down to the ground
  add({ id: "V-SITE", type: "PlanView", name: "SITE PLAN", args: { level: { ref: `MS-L${String(G0.roof).padStart(2, "0")}` }, scale: K.siteScale, viewRange: vr(Math.round(p.crownHeight + 4000), Math.round(p.crownHeight + 2000), -400000, -400000), detailLevel: "Coarse", style: { ref: "VS-TWR-SITE" },
    clip: { rect: [SX0 - 22000, SY0 - 26000, SX1 + 22000, SY1 + 22000].map(Math.round), visible: false, active: true } }, params: { "Tower level": "roof", "Tower view title": "SITE PLAN" } });
  // the enlarged core plan and the details
  add({ id: "V-CORE", type: "PlanView", name: "ENLARGED CORE PLAN, LEVEL {n}", args: { level: { ref: "MS-L00" }, scale: 50, viewRange: vr(2300, 1200, 0, 0), detailLevel: "Fine", style: { ref: "VS-TWR-CORE" },
    clip: { rect: [...rnd(cg([-p.coreWidth / 2 - 2500, -p.coreDepth / 2 - 2500])), ...rnd(cg([p.coreWidth / 2 + 2500, p.coreDepth / 2 + 2500]))].map((v, i, a) => i < 2 ? Math.min(v, a[i + 2]) : Math.max(v, a[i - 2])), visible: false, active: true } },
    params: { "Tower level": "0.5", "Tower view title": "ENLARGED CORE PLAN, LEVEL {n}" } });
  add({ id: "V-CORNER", type: "PlanView", name: "CORNER PLAN, LEVEL {n}", args: { level: { ref: "MS-L00" }, scale: 50, viewRange: vr(2300, 1200, 0, 0), detailLevel: "Fine", style: { ref: "VS-TWR-CORE" }, clip: { rect: null, visible: false, active: false } },
    params: { "Tower level": kind === "diagrid" ? (Math.round(p.diagridStart) === 1 ? "row:1" : "row:2") : "0.5", "Tower view title": kind === "diagrid" ? "BIRD'S MOUTH CORNER AT A CORNER NODE, LEVEL {n}" : "NOTCHED CORNER, LEVEL {n}", "Tower corner crop": kind === "diagrid" ? "se:11000" : "notch:12000" } });

  // elevations and sections: a view looks to the right of its line
  const elev = (id, name, a, b, depth, o = {}) => add({ id, type: o.section ? "SectionView" : "ElevationView", name, args: Object.assign({ line: line(a, b), depth: Math.round(depth), scale: o.scale || K.elevScale, baseLevel: { ref: "MS-L00" }, top: Math.round(G0.top + 8000),
    style: { ref: "VS-TWR-ELEV" }, detailLevel: o.detail || "Coarse", clip: { rect: null, visible: false, active: false }, levelExtent: o.levelExtent || null }, o.args || {}), params: Object.fromEntries(Object.entries(Object.assign({ "Tower view": "fit" }, o.params || {})).filter(([, v]) => v !== undefined)) });
  const W0 = PX1 - PX0, D0 = PY1 - PY0, mX = 12000, mY = 12000;
  elev("V-E-S", "SOUTH ELEVATION", [PX1 + mX, PY0 - 40000], [PX0 - mX, PY0 - 40000], D0 + 80000);
  elev("V-E-N", "NORTH ELEVATION", [PX0 - mX, PY1 + 40000], [PX1 + mX, PY1 + 40000], D0 + 80000);
  elev("V-E-E", "EAST ELEVATION", [PX1 + 40000, PY1 + mY], [PX1 + 40000, PY0 - mY], W0 + 80000);
  elev("V-E-W", "WEST ELEVATION", [PX0 - 40000, PY0 - mY], [PX0 - 40000, PY1 + mY], W0 + 80000);
  // A-A north to south through the east end of the core (its stair and WCs), looking east
  const xA = Math.round((core.xb + p.coreWidth / 2) / 2);
  elev("V-S-A", "SECTION A-A", [xA, PY0 - mY], [xA, PY1 + mY], W0 / 2 + 40000, { section: true, detail: "Medium" });
  // B-B through the office floor south of the core, looking north at the core's south wall
  const yB = -(p.coreDepth / 2 + 3500);
  elev("V-S-B", "SECTION B-B", [PX1 + mX, yB], [PX0 - mX, yB], D0 / 2 + 40000, { section: true, detail: "Medium" });
  // details: the slab edge where A-A cuts the south facade (a callout of A-A), and the facade's fold in elevation
  elev("V-D-FOLD", kind === "diagrid" ? "DIAGRID NODE, SOUTH FACE" : "NOTCH AND FOLD IN THE FACADE", [PX1 + mX, PY0 - 40000], [PX0 - mX, PY0 - 40000], D0 + 80000, { scale: 100, detail: "Medium",
    args: { hideCoarserThan: 100 }, params: { "Tower node crop": kind === "diagrid" ? "1" : "corner", "Tower view": undefined } });
  // the twisting tower's plates, all of them seen from above the roof
  if (kind === "twist") add({ id: "V-STACK", type: "PlanView", name: "ROTATION OF THE FLOOR PLATES", args: { level: { ref: "MS-L00" }, scale: 200, viewRange: vr(Math.round(p.crownHeight + 4000), Math.round(p.crownHeight + 2000), -400000, -400000), detailLevel: "Coarse", style: { ref: "VS-TWR-3D" }, clip: { rect: null, visible: false, active: false } },
    params: { "Tower level": "roof", "Tower view title": "ROTATION OF THE FLOOR PLATES", "Tower crop": "4000" } });

  // 3D: an axonometric and a view from the street
  const H = G0.top;
  add({ id: "V-AXO", type: "View3D", name: "AXONOMETRIC FROM THE SOUTH-WEST", args: { camera: { azimuth: 225, elevation: 28, target: [0, 0, Math.round(H * 0.45)] }, scale: kind === "diagrid" ? 800 : 600, style: { ref: "VS-TWR-3D" }, visualStyle: "Shaded", render: { display: "hidden", rasterDPI: 200, silhouetteWeight: 0.35 } } });
  const persp = (id, name, eye, target, scale) => { const d = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]], h = Math.hypot(d[0], d[1]);
    add({ id, type: "View3D", name, args: { camera: { azimuth: +(Math.atan2(d[1], d[0]) * 180 / Math.PI).toFixed(2), elevation: +(Math.atan2(d[2], h) * 180 / Math.PI).toFixed(2), target, distance: Math.round(Math.hypot(h, d[2])) }, scale, style: { ref: "VS-TWR-3D" }, visualStyle: "Shaded", render: { display: "hidden", rasterDPI: 200, silhouetteWeight: 0.35 } } }); };
  persp("V-PERSP", "VIEW FROM THE STREET, SOUTH-EAST", [PX1 + 130000, PY0 - 190000, 1700], [0, 0, Math.round(H * 0.42)], kind === "diagrid" ? 800 : 600);

  // schedules: the sheet index, and the floor areas
  add({ id: "SC-SHEETS", type: "Schedule", name: "SHEET INDEX", args: { of: "Sheet", fields: ["Sequence", "Sheet Number", "Sheet Name", "SD", "DD", "Sheet Size"], sort: [{ field: "Sequence" }],
    format: { Sequence: { hidden: true }, "Sheet Number": { heading: "NUMBER" }, "Sheet Name": { heading: "SHEET TITLE" }, SD: { heading: "01 SD", align: "center" }, DD: { heading: "02 DD", align: "center" }, "Sheet Size": { heading: "SIZE", align: "center" } },
    appearance: { title: true, headers: true, gridlines: true, outline: true, stripes: false, blankRow: false, textHeight: 3.2, rowHeight: 8.5, padding: 3, font: "Arial", titleHeight: 5, titleFont: "ArialBold" } } });
  add({ id: "SC-AREAS", type: "Schedule", name: "GROSS FLOOR AREAS, TO THE SLAB EDGE", args: { of: "IfcSlab", fields: ["Level", "Top elevation", "Area"], sort: [{ field: "Top elevation" }],
    grandTotals: { on: true, mode: "Title and totals", title: "Total gross floor area" }, format: { Level: { heading: "LEVEL" }, "Top elevation": { hidden: true }, Area: { heading: "GROSS AREA", total: "Calculate totals" } },
    appearance: { title: true, headers: true, gridlines: true, outline: true, stripes: true, blankRow: false, textHeight: 2.2, rowHeight: 5.4, padding: 3, font: "Arial", titleHeight: 3.5, titleFont: "ArialBold" } } });

  // ---------------------------------------------------------------- notes: general notes, the cover's text, plan notes
  const T = (id, view, at, content, type = "TT-T25", o = {}) => add({ id, type: "Text", args: Object.assign({ content, position: rnd(at), rotation: 0, textType: { ref: type }, wrapWidth: o.wrap || 120, leaders: o.leaders || [], view: { ref: view } }, o.args || {}), params: o.params || {} });
  add({ id: "V-NOTES", type: "DraftingView", name: "GENERAL NOTES AND ABBREVIATIONS", args: { scale: 1, clip: { rect: [0, 0, 700, 560], visible: false, active: true } } });
  const NOTES = [
    "1. Dimensions are in millimetres. Levels are in metres above the ground floor finished level (±0.000).",
    "2. Do not scale from the drawings. Work to figured dimensions; report discrepancies to the architect before proceeding.",
    "3. This set records the design at the design-development stage. It is not for construction.",
    "4. Slab edges follow the tower envelope at each level, set back from the glass line by the dimension on the plans. Floor areas are gross, measured to the slab edge, core included.",
    "5. Structural members are shown at their preliminary sizes, for coordination with the structural engineer.",
    "6. The core is reinforced concrete, 500 outer walls and 250 inner walls, from the ground floor to the lift overruns above the roof.",
    "7. Lifts, stairs and toilet provision are shown for coordination with the vertical transportation consultant and the MEP engineer. Lift numbers and sizes are to be confirmed by a traffic analysis.",
    "8. Facade: unitised curtain wall, mullions at the spacing noted on A501, floor-to-floor transoms at each slab edge.",
    "9. Fire strategy, means of escape and refuge provision are to be confirmed by the fire engineer.",
  ];
  const ABBR = [["AFF", "Above finished floor"], ["CL", "Centreline"], ["CW", "Curtain wall"], ["DD", "Design development"], ["EQ", "Equal"], ["FFL", "Finished floor level"], ["GFA", "Gross floor area"],
    ["LL", "Lift lobby"], ["MEP", "Mechanical, electrical and plumbing"], ["NIC", "Not in contract"], ["RC", "Reinforced concrete"], ["SD", "Schematic design"], ["SSL", "Structural slab level"],
    ["TBC", "To be confirmed"], ["TYP", "Typical"], ["VT", "Vertical transportation"], ["WC", "Toilet"]];
  T("TX-N0", "V-NOTES", [10, 540], "GENERAL NOTES", "TT-T50");
  T("TX-N1", "V-NOTES", [10, 525], NOTES.join("\n\n"), "TT-T25", { wrap: 300 });
  T("TX-A0", "V-NOTES", [360, 540], "ABBREVIATIONS", "TT-T50");
  T("TX-A1", "V-NOTES", [360, 525], ABBR.map(a => a[0]).join("\n"), "TT-T25", { wrap: 30 });
  T("TX-A2", "V-NOTES", [390, 525], ABBR.map(a => a[1]).join("\n"), "TT-T25", { wrap: 150 });
  T("TX-D0", "V-NOTES", [360, 300], "THE TOWER IN NUMBERS", "TT-T50");
  const facts = kind === "diagrid"
    ? "Storeys above ground: {storeys}\nPodium storeys: {podiumStoreys}\nRoof level: {roofLevel}\nHeight to the top of the crown: {height} m\nGround floor height: {ground}\nTypical floor to floor: {f2f}\nPlate at the base: {plate} m\nCore: {core} m, {lifts} lifts\nDiagrid: {diagrid}; members {member} wide\nPerimeter columns: Ø{columns} at {colSpacing} centres\nCorner chamfer: {chamfer}; bird's mouth set in {birdMouth}\nGross floor area: {gfa} m²"
    : "Storeys above ground: {storeys}\nPodium storeys: {podiumStoreys}\nRoof level: {roofLevel}\nHeight to the top of the crown: {height} m\nGround floor height: {ground}\nTypical floor to floor: {f2f}\nPlate at the base: {plate} m\nTurn over the height: {twist}°\nCore: {core} m, {lifts} lifts\nPerimeter columns: Ø{columns} at {colSpacing} centres\nGross floor area: {gfa} m²";
  T("TX-D1", "V-NOTES", [360, 285], "", "TT-T25", { wrap: 300, params: { "Tower text": facts } });
  T("TX-D2", "V-NOTES", [360, 120], `PRECEDENT\nA study after ${K.precedent}. ${K.character}`, "TT-T25", { wrap: 300 });

  // the cover
  add({ id: "V-COVER", type: "DraftingView", name: "COVER", args: { scale: 1, clip: { rect: [0, 0, 300, 520], visible: false, active: true } } });
  T("TX-C0", "V-COVER", [0, 500], K.name.toUpperCase(), "TT-T14", { wrap: 300 });
  T("TX-C1", "V-COVER", [0, 478], "DESIGN DEVELOPMENT", "TT-T80", { wrap: 300 });
  T("TX-C2", "V-COVER", [0, 462], `Issue 02 · ${ISSUE_DATE}`, "TT-T35", { wrap: 300 });
  T("TX-C3", "V-COVER", [0, 420], "", "TT-T35", { wrap: 260, params: { "Tower text": "{storeys} storeys · {height} m to the top of the crown\nGross floor area {gfa} m²\nTypical floor to floor {f2f} mm" } });
  T("TX-C4", "V-COVER", [0, 360], `${K.character}\n\nA study after ${K.precedent}.`, "TT-T25", { wrap: 240 });
  T("TX-C5", "V-COVER", [0, 40], "NOT FOR CONSTRUCTION", "TT-T50", { wrap: 300 });

  // ---------------------------------------------------------------- sheets (A1 landscape, AIA strip)
  // the index lists the sheets in the standard's order: general first, then architectural by series
  let seq = 0;
  const sheet = (id, number, name, vps, o = {}) => add({ id, type: "Sheet", name: `${number} ${name}`, args: { number, sheetName: name, size: "A1", orientation: "landscape", titleBlock: { ref: "SY-TB-AIA-A1" }, revision: "02",
    viewports: vps.map(([view, at, extra], i) => Object.assign({ id: `VP${i + 1}`, view: { ref: view }, at, clipVisible: false, number: i + 1 }, extra || {})) },
    params: { SD: o.sd === false ? "" : "\u2022", DD: "\u2022", Sequence: String(++seq).padStart(2, "0") } });
  const C = [375, 300];
  sheet("SH-G001", "G001", "Cover sheet", [["V-COVER", [180, 300], { noTitle: true }], ["V-PERSP", [520, 300], { noTitle: true }]]);
  sheet("SH-G002", "G002", "Sheet index and issue record", [["SC-SHEETS", [290, 400]]]);
  sheet("SH-G003", "G003", "General notes and abbreviations", [["V-NOTES", [375, 300], { noTitle: true }]], { sd: false });
  sheet("SH-A100", "A100", "Site plan", [["V-SITE", C]]);
  sheet("SH-A101", "A101", "Ground floor plan", [["V-L00", [285, 300]], ["V-PN-L00", [640, 440], { noTitle: true }]]);
  sheet("SH-A102", "A102", "Podium roof plan", [["V-POD", [285, 300]], ["V-PN-POD", [640, 440], { noTitle: true }]], { sd: false });
  sheet("SH-A103", "A103", "Typical floor plan, low rise", [["V-LOW", [320, 300]], ["V-PN-LOW", [640, 440], { noTitle: true }]]);
  sheet("SH-A104", "A104", "Typical floor plan, mid rise", [["V-MID", [320, 300]], ["V-PN-MID", [640, 440], { noTitle: true }]], { sd: false });
  sheet("SH-A105", "A105", "Typical floor plan, high rise", [["V-HIGH", [320, 300]], ["V-PN-HIGH", [640, 440], { noTitle: true }]], { sd: false });
  sheet("SH-A106", "A106", "Roof plan", [["V-ROOF", [320, 300]], ["V-PN-ROOF", [640, 440], { noTitle: true }]]);
  sheet("SH-A201", "A201", "Elevations, south and north", [["V-E-S", [195, 300]], ["V-E-N", [545, 300]]]);
  sheet("SH-A202", "A202", "Elevations, east and west", [["V-E-E", [195, 300]], ["V-E-W", [545, 300]]], { sd: false });
  sheet("SH-A301", "A301", "Building sections", [["V-S-A", [195, 300]], ["V-S-B", [545, 300]]]);
  sheet("SH-A401", "A401", "Enlarged core plan", [["V-CORE", [375, 330]]], { sd: false });
  sheet("SH-A501", "A501", "Facade details", [["V-CORNER", [185, 405]], ["V-DET-EDGE", [545, 330]], ["V-D-FOLD", [185, 140]]], { sd: false });
  if (kind === "twist") sheet("SH-A502", "A502", "Rotation of the floor plates", [["V-STACK", C]], { sd: false });
  sheet("SH-A601", "A601", "Floor area schedule", [["SC-AREAS", [190, 300]]], { sd: false });
  sheet("SH-A901", "A901", "Three-dimensional views", [["V-AXO", [200, 300]], ["V-PERSP", [540, 300]]]);

  // ---------------------------------------------------------------- dimensions: grids, the plate, the lease depths
  L.dimTypes["DT-TWR"] = { name: "Tower DD - oblique 2.5, Arial", arrow1: "Oblique", arrow2: "Oblique", arrowSize: 2.5, textHeight: 2.2, font: "Arial", unit: "mm", precision: 0, dimExtend: 1.5 };
  let nd = 0;
  const DIM = (view, a, b, off) => add({ id: `DM-${view}-${++nd}`, type: "Dimension", args: { of: [a, b], offset: Math.round(off), view: { ref: view }, locked: false, dimType: { ref: "DT-TWR" } } });
  const GX = ["G-1", "G-2", "G-3", "G-4"];
  // the ground and the podium roof: the grids, and the podium overall
  for (const v of ["V-L00", "V-POD"]) {
    DIM(v, "G-1:line", "G-4:line", -(2 * reach - 2000));
    for (let i = 0; i < 3; i++) DIM(v, `${GX[i]}:line`, `${GX[i + 1]}:line`, -(2 * reach - 4500));
    DIM(v, "G-A:line", "G-B:line", -2000);
    DIM(v, "MS-F00:extent.west", "MS-F00:extent.east", 3500);
    DIM(v, "MS-F00:extent.south", "MS-F00:extent.north", 3500);
  }
  for (const v of ["V-LOW", "V-MID", "V-HIGH", "V-ROOF"]) {
    // across the top: the grids overall, then bay by bay; down the west side: A to B
    DIM(v, "G-1:line", "G-4:line", -(2 * reach - 2000));
    for (let i = 0; i < 3; i++) DIM(v, `${GX[i]}:line`, `${GX[i + 1]}:line`, -(2 * reach - 4500));
    DIM(v, "G-A:line", "G-B:line", -2000);
    // the plate (its slab edge at this level), south and west of it
    DIM(v, "MS-F00:extent.west", "MS-F00:extent.east", 2500);
    DIM(v, "MS-F00:extent.south", "MS-F00:extent.north", 2500);
    // the lease depths: core to slab edge, each side
    DIM(v, "G-A:line", "MS-F00:extent.south", -reach - core.xa / 2);
    DIM(v, "G-B:line", "MS-F00:extent.north", -reach - core.xb / 2);
    DIM(v, "G-1:line", "MS-F00:extent.west", -reach - 0);
    DIM(v, "G-4:line", "MS-F00:extent.east", -reach - 0);
  }
  // the core plan: grids, the lift shafts bay by bay, the lobby's width
  DIM("V-CORE", "G-1:line", "G-4:line", -reach - (p.coreDepth / 2 + 2000));
  for (let i = 0; i < 3; i++) DIM("V-CORE", `${GX[i]}:line`, `${GX[i + 1]}:line`, -reach - (p.coreDepth / 2 + 1100));
  DIM("V-CORE", "G-A:line", "G-B:line", -reach + p.coreWidth / 2 + 1500);
  const shaftWalls = core.walls.map((w, i) => ({ w, id: `MS-CW${String(i).padStart(2, "0")}` })).filter(o => o.w.role === "shaft" && o.w.a[1] > 0).sort((a, b) => a.w.a[0] - b.w.a[0]);
  for (let i = 0; i + 1 < shaftWalls.length; i++) DIM("V-CORE", `${shaftWalls[i].id}:centreline`, `${shaftWalls[i + 1].id}:centreline`, shaftWalls[i].w.a[1] - (p.coreDepth / 2 - 1600));
  DIM("V-CORE", "MS-CW05:face.interior", "MS-CW04:face.interior", -(core.xa / 2 + p.coreWidth / 2) - 600);

  // ---------------------------------------------------------------- plan notes, one block to each plan sheet
  const notesView = (id, title, lines) => {
    add({ id, type: "DraftingView", name: title, args: { scale: 1, clip: { rect: [0, 0, 150, 230], visible: false, active: true } } });
    T(`${id}-T`, id, [0, 222], title, "TT-T35", { wrap: 150 });
    T(`${id}-B`, id, [0, 212], "", "TT-T20", { wrap: 150, params: { "Tower text": lines.map((l, i) => `${i + 1}  ${l}`).join("\n\n") } });
  };
  const common = [
    "Perimeter column, reinforced concrete Ø{columns}, {colSpacing} centres along each face; the columns rake with the plate from floor to floor.",
    "Slab edge {slabEdgeInset} inside the glass line. Gross floor areas: A601.",
    "Core: reinforced concrete, 500 outer and 250 inner walls. Enlarged plan: A401.",
    "Lifts: {lifts} in two banks of the lift lobby; numbers and sizes to the vertical transportation analysis.",
  ];
  const facade = kind === "diagrid"
    ? ["Diagrid member, steel, {member} wide, outside the glass line; node rows every {diagridStoreys} storeys. Node elevation: 3/A501.", "Bird's mouth corner: chamfer {chamfer} each leg, set in {birdMouth} at the node rows. Corner plan: 1/A501."]
    : ["Facade turns {twist}° over the height; the slab edge follows the plate at each level. Plates: A502.", "Notched corner: the slot runs up the tower with the turn. Corner plan: 1/A501."];
  notesView("V-PN-L00", "PLAN NOTES", ["Podium: tower lobby and retail; the podium layout is developed with the brief.", "Podium columns, reinforced concrete, on a {colSpacing} grid square to the tower.", ...common]);
  notesView("V-PN-POD", "PLAN NOTES", ["Podium roof below: landscape and plant zones to the landscape architect and the MEP engineer.", ...facade, ...common]);
  for (const v of ["LOW", "MID", "HIGH"]) notesView(`V-PN-${v}`, "PLAN NOTES", [...facade, ...common]);
  notesView("V-PN-ROOF", "PLAN NOTES", ["Crown: the facade carried {crownHeight} above the roof slab as a screen to the roof plant.", "Lift overruns and stair heads within the core.", ...common.slice(1, 3)]);

  // ---------------------------------------------------------------- the typical slab edge (a drafted detail, 1:10)
  // the glass line at x = 0 (outside to the right), the slab's structural top at z = 0
  add({ id: "V-DET-EDGE", type: "DraftingView", name: "TYPICAL SLAB EDGE", args: { scale: 10, clip: { rect: [-1900, -1500, 1250, 1350], visible: false, active: true } } });
  let nl = 0;
  const DL = (a, b, pen = "thin", style = "Solid") => add({ id: `DL-E${++nl}`, type: "DetailLine", args: { curve: line(a, b), pen, lineStyle: style, view: { ref: "V-DET-EDGE" }, colour: "#000000" } });
  const POLY = (pts, pen = "thin", closed = true) => pts.forEach((q, i) => { if (closed || i + 1 < pts.length) DL(q, pts[(i + 1) % pts.length], pen); });
  const FR = (pts, pattern, bg = "") => add({ id: `FR-E${++nl}`, type: "FilledRegion", args: { boundary: pts.map(rnd), pattern, view: { ref: "V-DET-EDGE" }, background: bg, lineColour: "#000000" } });
  const se = -p.slabEdgeInset, md = 150;
  FR([[-1900, -250], [se, -250], [se, 0], [-1900, 0]], "P-CONC", "#ffffff");                                   // the slab
  FR([[-760, -750], [-560, -750], [-560, -735], [-667, -735], [-667, -265], [-560, -265], [-560, -250], [-760, -250], [-760, -265], [-653, -265], [-653, -735], [-760, -735]], "", "#d8dade"); // perimeter beam
  for (const x of [-1800, -1200]) { DL([x, 0], [x, 110], "thin"); DL([x - 50, 110], [x + 50, 110], "thin"); }    // pedestals
  POLY([[-1900, 110], [-260, 110], [-260, 150], [-1900, 150]], "thin");                                            // raised floor panels
  FR([[se - 10, -250], [-md - 5, -250], [-md - 5, -120], [se - 10, -120]], "", "#2b2f33");                             // fire and smoke seal
  FR([[-md + 20, -760], [-35, -760], [-35, 140], [-md + 20, 140]], "P-INSUL", "#ffffff");                            // spandrel insulation
  POLY([[-md, -1500], [-md, 1350]], "medium", false);                                                              // mullion back
  POLY([[0, -1500], [0, 1350]], "medium", false); POLY([[-28, -1500], [-28, 1350]], "thin", false);                // glass, two panes
  POLY([[-md, -80], [0, -80], [0, 40], [-md, 40]], "medium");                                                      // stack joint, the units' transoms meeting
  POLY([[-md, -850], [0, -850], [0, -790], [-md, -790]], "thin");                                                  // the head of the vision zone
  POLY([[-340, 0], [-340, 70], [-md - 5, 70]], "medium", false);                                                     // the unit's bracket on the slab
  POLY([[-1900, -1150], [-420, -1150]], "medium", false); POLY([[-420, -1150], [-420, -900], [-md - 20, -900]], "thin", false);   // ceiling and its edge trim
  POLY([[-400, -1150], [-400, -1020], [-md - 20, -1020]], "thin", false);                                           // blind box
  for (const [z, t] of [[150, "FFL +150"], [0, "SSL ±0"], [-1150, "CEILING"]]) { DL([-1900, z], [-2300, z], "thin", "Centre"); }
  const NT = (id, at, content, target, side = "right") => T(id, "V-DET-EDGE", at, content, "TT-T20", { wrap: 55, leaders: target ? [{ side, elbow: [at[0] + (side === "left" ? -120 : 120), at[1]], target: rnd(target), arrow: "AR-DOT", attachment: "middle" }] : [] });
  NT("TX-E1", [200, 1100], "Double glazed unit, low-e; frit on face 4 across the spandrel", [-14, 900], "left");
  NT("TX-E2", [200, 780], "Unitised curtain wall: mullions at the facade's set spacing, stack joint at each slab", [-75, 40], "left");
  NT("TX-E3", [200, 420], "Spandrel insulation behind the fritted glass", [-80, -300], "left");
  NT("TX-E4", [200, 120], "Smoke and fire seal, two hours, between slab edge and unit", [-160, -190], "left");
  NT("TX-E5", [200, -260], "Unit bracket on cast-in channel at the slab edge", [-300, 50], "left");
  NT("TX-E6", [-1850, 600], "Raised access floor on pedestals", [-1500, 130]);
  NT("TX-E7", [-1850, -500], "Reinforced concrete slab 250 on perimeter beam; sizes to the structural engineer", [-1100, -150]);
  NT("TX-E8", [-1850, -1350], "Suspended ceiling and blind box at the glass", [-500, -1150]);
  T("TX-E9", "V-DET-EDGE", [-2280, 165], "FFL", "TT-T20"); T("TX-E10", "V-DET-EDGE", [-2280, 15], "SSL", "TT-T20"); T("TX-E11", "V-DET-EDGE", [-2280, -1135], "CLG", "TT-T20");
  T("TX-E12", "V-DET-EDGE", [200, -900], "", "TT-T20", { wrap: 55, params: { "Tower text": "Slab edge {slabEdgeInset} inside the glass line; mullions at {mullions} centres." } });

  // ---------------------------------------------------------------- the site: its boundary dimensioned, its area stated
  const siteArea = Math.round((SX1 - SX0) * (SY1 - SY0) / 1e6);
  T("TX-SITE", "V-SITE", [SX0 + 3000, SY1 - 5000], `STUDY SITE ${siteArea.toLocaleString("en-US")} m²\nBoundary to be confirmed by survey`, "TT-T25", { wrap: 80 });
  DIM("V-SITE", "SITE:edge.0", "SITE:edge.2", 6000);
  DIM("V-SITE", "SITE:edge.3", "SITE:edge.1", 6000);

  // the views' levels, crops, dimensions and notes, as the tower now is
  apply({ op: "towersync", id: "MS" });
  doc.graph.layout = {};
  doc.browser = { organisation: "by-discipline", expanded: ["Views", "Sheets"] };
  doc.regenerate();
  return doc;
}
