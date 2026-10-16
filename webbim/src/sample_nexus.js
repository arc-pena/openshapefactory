//! The Nexus: a reality check of the level plans, A2_2000_L0 … L16, rebuilt from their 2D mesh.
//!
//! The red chain lines of the plans are a mesh, not a grid: every slab and every facade wall on every level is made
//! from the cells that level uses (MeshGrid MG1; the meshsync op). Edit the mesh (Edit Mesh: move, add and delete
//! nodes, split and merge cells, pick the cells each level uses, place cores) and the slabs and walls follow. The
//! drawn plans are kept as traced references (PlanReference, one per level) to check the mesh against, and the lifts,
//! atria and risers the plans name are cores (Core) that cut the slabs above their base.
//!
//! Levels as briefed: the ground floor L00 at ±0, L01 at +8 m, then 6 m a storey to L16 at +98 m. Plans cut 1 m
//! above each floor. Sheets A1 landscape.

import { newDocument } from "./bim.js";
import { Editor } from "./ops.js";
import { nexusData } from "./nexus_data.js";
import { meshSyncPlan, polyCentroid } from "./meshgrid.js";

const NX_ISSUE = "2026-10-15";
const NX_SCALES = [500, 750, 1000, 1250, 1500, 2000, 2500];

export function buildNexusSample() {
  const D = nexusData();
  const doc = newDocument("Nexus — layout reality check");
  const ed = new Editor(doc); ed.autoMeshSync = false;
  const add = (element) => { const r = ed.apply({ op: "add", element }, { regenerate: false, undoable: false }); if (!r.ok) throw new Error(`${element.id || element.type}: ${r.error}`); return r.id; };
  const apply = (op) => { const r = ed.apply(op, { undoable: false }); if (!r.ok) throw new Error(`${op.op}: ${r.error}`); return r; };
  const L = doc.lib;

  // ---------------------------------------------------------------- standards
  L.types["T-NX-SLAB"] = { family: "F-FLOOR", name: "Slab, concrete 300", mark: "SL1", layers: [{ function: "Structure", thickness: 300, material: "M-CONC" }], coreStart: 0, coreEnd: 1 };
  L.types["T-NX-FACADE"] = { family: "F-BASICWALL", name: "Facade zone 200 (massing study)", mark: "FZ", layers: [{ function: "Structure", thickness: 200, material: "M-GLASS" }], coreStart: 0, coreEnd: 1, params: { Function: "Exterior" } };
  for (const [id, h, bold] of [["TT-NX20", 2.0], ["TT-NX25", 2.5], ["TT-NX35", 3.5, true], ["TT-NX50", 5.0, true], ["TT-NX80", 8.0, true]])
    L.textTypes[id] = { name: `${h} mm Arial${bold ? " Bold" : ""}`, height: h, font: bold ? "ArialBold" : "Arial", widthFactor: 1, colour: "#000000", pen: h >= 3.5 ? "medium" : "thin" };
  const VS = JSON.parse(JSON.stringify(L.viewStyles["VS-CONSTRUCTION"])); VS.name = "Nexus study";
  VS.byCategory.IfcWall = Object.assign({}, VS.byCategory.IfcWall, { cut: { fill: "#5b6470", pattern: "solid", pen: "thin", detailLevel: "Coarse" } });
  // the plates of the plan's level tinted; the mesh a light red chain, under the slab edges and walls
  VS.byCategory.IfcSlab = { cut: { pen: "medium" }, projection: { pen: "thin", fill: "#f2ead4" } };
  VS.byCategory.Mesh = { pen: "hairline", colour: "#ee8a8a" };
  L.viewStyles["VS-NX"] = VS;
  const VSS = JSON.parse(JSON.stringify(VS)); VSS.name = "Nexus sections"; VSS.byCategory.Mesh = { visible: false }; VSS.byCategory.Reference = { visible: false }; L.viewStyles["VS-NX-SEC"] = VSS;
  doc.meta.displayUnits = "mm";
  doc.meta.project = Object.assign({}, doc.meta.project || {}, { number: "NX", issued: NX_ISSUE, issue: "Layout reality check", address: "Nexus", "Key Plan Note": "Rebuilt from the 2D mesh of A2_2000_L0 … L16" });

  // ---------------------------------------------------------------- levels, site
  for (const lv of D.levels) add({ id: lv.id, type: "Level", name: lv.name, args: { name: lv.name, elevation: lv.elevation }, params: { Comments: `Traced from ${lv.source}` } });
  const loop = D.site;
  add({ id: "SITE", type: "SiteBoundary", name: "Site boundary", args: { sketch: { elements: loop.map((a, i) => ({ id: `e${i + 1}`, type: "line", a, b: loop[(i + 1) % loop.length] })), constraints: [], dims: [] }, edges: {}, setback: 30000, level: { ref: "L00" }, label: true } });

  // ---------------------------------------------------------------- the mesh, the drawings it was traced from, the cores
  add({ id: "MG1", type: "MeshGrid", name: "Nexus mesh", args: { nodes: D.nodes, cells: D.cells, use: D.use, slabType: { ref: "T-NX-SLAB" }, wallType: { ref: "T-NX-FACADE" }, walls: "Perimeter", topHeight: 4000, showMesh: true, showIds: false, showUse: false } });
  for (const lv of D.levels) {
    const r = D.reference[lv.id]; if (!r || !(r.zones.length || r.outlines.length || r.labels.length)) continue;
    add({ id: `PR-${lv.id}`, type: "PlanReference", name: `${lv.id} as drawn`, args: { level: { ref: lv.id }, source: lv.source, zones: r.zones, outlines: r.outlines, labels: r.labels } });
  }
  let nc = 0;
  for (const v of D.vertical) {
    const id = `VC${String(++nc).padStart(2, "0")}`;
    const args = { use: v.use, at: v.at, baseLevel: { ref: v.base }, topLevel: { ref: v.top }, topOffset: 0, label: v.label, cutsSlabs: true };
    if (v.use === "Lift") { const cars = v.cars || 1, rows = cars > 2 ? 2 : 1, cols = Math.ceil(cars / rows); Object.assign(args, { cars, width: cols * 2600, depth: rows * 2600, topOffset: 4500 }); }
    else if (v.use === "Riser") Object.assign(args, { width: 3000, depth: 2000 });
    else if (v.use === "Atrium" && v.outline && v.outline.length >= 3) { const c = polyCentroid(v.outline).map(Math.round); Object.assign(args, { at: c, outline: v.outline.map(q => [q[0] - c[0], q[1] - c[1]]) }); }
    else Object.assign(args, { width: 12000, depth: 12000 });
    add({ id, type: "Core", name: `${v.label} ${id}`, args });
  }
  doc.regenerate();
  apply({ op: "meshsync", id: "MG1" });

  // ---------------------------------------------------------------- views
  // Every plan - the site plan and the 17 levels - has the same crop: the whole site boundary with 30 m round it,
  // at the largest scale that fits an A1 sheet's drawing area (1:1500). With the same crop, scale and viewport
  // point, the plans land on the same spot on every sheet: leaf through the set and only the floor changes.
  const plan = meshSyncPlan(doc, "MG1");
  const bbox = pts => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
  const all = plan.floors.flatMap(s => s.outer), B0 = bbox(all), towers = plan.floors.filter(s => +s.level.slice(1) >= 4).flatMap(s => s.outer), BT = towers.length ? bbox(towers) : B0;
  const fit = (bb, W = 760, H = 470) => NX_SCALES.find(k => (bb[2] - bb[0]) / k <= W && (bb[3] - bb[1]) / k <= H) || 2500;
  const SB = bbox(D.site), sm = 30000;
  const planRect = [Math.floor((SB[0] - sm) / 1000) * 1000, Math.floor((SB[1] - sm) / 1000) * 1000, Math.ceil((SB[2] + sm) / 1000) * 1000, Math.ceil((SB[3] + sm) / 1000) * 1000];
  const planScale = fit(planRect);
  for (const lv of D.levels) {
    const podium = +lv.id.slice(1) <= 3;
    add({ id: `V-${lv.id}`, type: "PlanView", name: `${lv.id} FLOOR PLAN`, args: { level: { ref: lv.id }, scale: planScale,
      viewRange: { top: 2300, cut: 1000, bottom: 0, depth: podium ? 0 : -lv.elevation }, detailLevel: "Coarse", style: { ref: "VS-NX" }, clip: { rect: planRect.slice(), visible: false, active: true } } });
  }
  add({ id: "V-SITE", type: "PlanView", name: "SITE PLAN", args: { level: { ref: "L16" }, scale: planScale, viewRange: { top: 30000, cut: 20000, bottom: -110000, depth: -110000 }, detailLevel: "Coarse", style: { ref: "VS-NX" }, clip: { rect: planRect.slice(), visible: false, active: true } } });
  // sections through the towers (a section looks to the right of the way its line is drawn): A-A drawn east to west,
  // looking north; B-B drawn north to south, looking west
  const top = D.levels[D.levels.length - 1].elevation + 14000, cx = Math.round((BT[0] + BT[2]) / 2), cy = Math.round((BT[1] + BT[3]) / 2);
  const sec = (id, name, a, b, depth) => add({ id, type: "SectionView", name, args: { line: { type: "line", start: a, end: b }, depth, scale: 1000, baseLevel: { ref: "L00" }, top, style: { ref: "VS-NX-SEC" }, detailLevel: "Coarse", clip: { rect: null, visible: false, active: false } } });
  sec("V-S-A", "SECTION A-A", [B0[2] + 30000, cy], [B0[0] - 30000, cy], 60000);
  sec("V-S-B", "SECTION B-B", [cx, B0[3] + 30000], [cx, B0[1] - 30000], 60000);
  const bc = [(B0[0] + B0[2]) / 2, (B0[1] + B0[3]) / 2].map(Math.round);
  add({ id: "V-AXO", type: "View3D", name: "AXONOMETRIC FROM THE SOUTH-WEST", args: { camera: { azimuth: 235, elevation: 32, target: [bc[0], bc[1], 30000] }, scale: 2500, style: { ref: "VS-NX-SEC" }, visualStyle: "Shaded", render: { display: "hidden", rasterDPI: 150, silhouetteWeight: 0.35 } } });
  add({ id: "SC-AREAS", type: "Schedule", name: "SLAB AREAS BY LEVEL", args: { of: "IfcSlab", fields: ["Level", "Top elevation", "Area"], sort: [{ field: "Top elevation" }],
    grandTotals: { on: true, mode: "Title and totals", title: "Total slab area" }, format: { Level: { heading: "LEVEL" }, "Top elevation": { heading: "FFL" }, Area: { heading: "SLAB AREA", total: "Calculate totals" } },
    appearance: { title: true, headers: true, gridlines: true, outline: true, stripes: true, blankRow: false, textHeight: 2.2, rowHeight: 5.4, padding: 3, font: "Arial", titleHeight: 3.5, titleFont: "ArialBold" } } });

  // ---------------------------------------------------------------- notes
  add({ id: "V-NOTES", type: "DraftingView", name: "STUDY NOTES", args: { scale: 1, clip: { rect: [0, 0, 700, 480], visible: false, active: true } } });
  const T = (id, at, content, type, wrap) => add({ id, type: "Text", args: { content, position: at, rotation: 0, textType: { ref: type }, wrapWidth: wrap || 300, leaders: [], view: { ref: "V-NOTES" } } });
  T("TX-N0", [10, 465], "NEXUS — LAYOUT REALITY CHECK", "TT-NX80", 600);
  T("TX-N1", [10, 440], [
    "1. Rebuilt from the level plans A2_2000_L0 to A2_2000_L16, drawn at 1:2000. Ground floor L00 at ±0.000; L01 at +8.000; then 6.000 a storey to L16 at +98.000.",
    "2. The red chain lines of the plans are a 2D mesh, not a grid. Every slab and facade wall here is made from the cells each level uses; edit the mesh and they follow.",
    "3. Cells used: a cell at least half under the drawn floor is used whole. On L04–L16 a cell partly under a tower plate is used in part, scaled to the drawn share and centred on it.",
    "4. Cores: the lift banks, atria and MEP risers the plans name. Lift cores run from L00 up while there is floor under them. Sizes are placeholders: 2.6 m a car.",
    "5. The plans as drawn are traced on each level (zones and plates in colour, labels in grey) to check the mesh against. Turn them off in Visibility: Traced plans.",
    "6. Plans cut 1.000 above each floor. Slabs 300, facade zone 200. Areas are slab areas to the slab edge, holes deducted.",
  ].join("\n\n"), "TT-NX25", 330);
  T("TX-N2", [370, 440], ["LEVELS", ...D.levels.map(l => `${l.id}   ${(l.elevation / 1000).toFixed(3).padStart(7, " ")}   ${l.source}`)].join("\n"), "TT-NX25", 300);

  // ---------------------------------------------------------------- sheets (A1 landscape)
  const sheet = (id, number, name, vps) => add({ id, type: "Sheet", name: `${number} ${name}`, args: { number, sheetName: name, size: "A1", orientation: "landscape", titleBlock: { ref: "SY-TB-A1" }, revision: "P01",
    viewports: vps.map(([view, at, extra], i) => Object.assign({ id: `VP${i + 1}`, view: { ref: view }, at, clipVisible: false, number: i + 1 }, extra || {})) } });
  sheet("SH-G001", "G001", "Study notes", [["V-NOTES", [420, 330], { noTitle: true }]]);
  const PLAN_AT = [420, 320];   // every plan's crop centred here, so the set registers sheet to sheet
  sheet("SH-A100", "A100", "Site plan", [["V-SITE", PLAN_AT.slice()]]);
  D.levels.forEach((lv, i) => sheet(`SH-A${101 + i}`, `A${101 + i}`, `${lv.id} floor plan, FFL ${lv.elevation ? "+" : "±"}${(lv.elevation / 1000).toFixed(3)}`, [[`V-${lv.id}`, PLAN_AT.slice()]]));
  sheet("SH-A301", "A301", "Sections A-A and B-B", [["V-S-A", [420, 430]], ["V-S-B", [420, 190]]]);
  sheet("SH-A601", "A601", "Slab areas by level", [["SC-AREAS", [250, 330]]]);
  sheet("SH-A901", "A901", "Axonometric", [["V-AXO", [420, 320]]]);

  doc.graph.layout = {};
  doc.browser = { organisation: "by-discipline", expanded: ["Views", "Sheets"] };
  doc.regenerate();
  return doc;
}
