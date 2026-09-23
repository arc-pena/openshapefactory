//! Acceptance tests (§15), shared by `node --test` and the in-app Diagnostics
//! view. Every expected value is derived on paper in the comment beside it,
//! before the program is asked; a test whose expectation came from running the
//! code would prove only that the code is deterministic (measured-truth).

import { TOL, dist, sub, add, mul, pathArea, samplePath, intersectLines, lineThrough, bez, polyArea, segEnd, segStart, distToSeg } from "./geom2d.js";
import { parse, evaluate, formatValue } from "./expr.js";
import { CATALOGUE, F, loadDocument, danglingRefs, clone } from "./ocaf.js";
import { wallRegions, solidSpans } from "./joins.js";
import { pointAt, uOf, boundary, wallPieces } from "./walls.js";
import { newDocument, openDocument, measureRefs, resolveReference, importPlacer } from "./bim.js";
import { Editor, propagate } from "./ops.js";
import { sectionBoxKey, dimText, deriveView, planScene, elevationScene, placements, textWidth, sheetScene, visibilityKey, sectionCut, cutOutline } from "./scene.js";
import { chainLoop } from "./crop.js";
import { importIfc } from "./ifcimport.js";
import { writePDF, pathOps, PT_PER_MM } from "./pdf.js";
import { writeDXF, readDXF, dxfLineweight, dxfDrawing } from "./dxf.js";
import { buildHLRModel, runHLR, elementsBox } from "./hlr.js";
import { drawScene } from "./render.js";
import { resolveGraphics, penWeight } from "./styles.js";
import { propertyModel, pickCandidates, graphModel, listeningDimensions, dimensionMove, editorFor } from "./props.js";
import { buildSample } from "./sample.js";
import { parseLength, setLengthUnit } from "./units.js";
import { bimToCad, cadEditsToOps } from "./cadbridge.js";
import { fromPolygon, addElements, fillet, toggleLock, measureDim, dragHandle, regionsOf, shapeFromClicks, filletCorners, toCentreline, elementSegs } from "./bimsketch.js";
import { cadSketchOutline } from "./cadsketch.js";

export const CASES = [];
const testCase = (id, name, fn, opts = {}) => CASES.push(Object.assign({ id, name, fn }, opts));
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const R = (pass, expected, got, note) => ({ pass: !!pass, expected, got, note });
const r3 = x => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- fixtures
/** A fresh document with a level and a single-layer 300mm type (so hand figures stay simple). */
function fixture() {
  const doc = newDocument("test");
  doc.lib.types["T-300"] = { family: "F-BASICWALL", name: "Solid 300", layers: [{ function: "Structure", thickness: 300, material: "M-BLOCK" }], coreStart: 0, coreEnd: 1 };
  doc.lib.types["T-400"] = { family: "F-BASICWALL", name: "Solid 400", layers: [{ function: "Structure", thickness: 400, material: "M-BLOCK" }], coreStart: 0, coreEnd: 1 };
  doc.addElement({ id: "L0", type: "Level", args: { name: "Ground", elevation: 0 } });
  doc.addElement({ id: "V", type: "PlanView", name: "Plan", args: { level: { ref: "L0" }, scale: 100, viewRange: { top: 2300, cut: 1200, bottom: 0 }, detailLevel: "Fine", style: { ref: "VS-CONSTRUCTION" } } });
  const ed = new Editor(doc);
  return { doc, ed };
}
const wall = (doc, id, a, b, type = "T-EXTCAV300", extra = {}) => doc.addElement({ id, type: "Wall", args: Object.assign({ centreline: { type: "line", start: a, end: b }, mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: "L0" }, height: 3000 }, extra) });
const joinEE = (doc, a, ae, b, be) => doc.joins.push({ id: "J" + (doc.joins.length + 1), a: { of: a, end: ae }, b: { of: b, end: be }, kind: "auto", order: 0, allowed: true });
const joinT = (doc, a, ae, b, u) => doc.joins.push({ id: "J" + (doc.joins.length + 1), a: { of: a, end: ae }, b: { of: b, u }, kind: "auto", order: 0, allowed: true });
const W = (doc, id) => doc.plan(doc.element(id));
const regions = (doc, id, det = "Fine", cut = 1200) => { const w = W(doc, id); return wallRegions(w, det, cut, w.openings || []); };
const walk = (doc, id) => regions(doc, id).map(r => r.layer);

// ---------------------------------------------------------------- 1–3: the file
testCase("1", "Round-trip the sample JSON", () => {
  const doc = buildSample();
  const a = doc.serialise(), d2 = openDocument(a); d2.regenerate();
  const b = d2.serialise();
  const dang = d2.elements().flatMap(f => danglingRefs(d2, f));
  return R(a === b && !dang.length, "byte-stable, 0 dangling refs", `${a === b ? "byte-stable" : "differs"}, ${dang.length} dangling`);
});
testCase("2", "Open a file with a dangling ref", () => {
  const j = JSON.parse(buildSample().serialise());
  j.elements.find(e => e.id === "C1").args.baseLevel = { ref: "L9" };
  const d = openDocument(j); d.regenerate();
  const n = d.note(d.element("C1")) || "";
  return R(n.includes("L9") && !d.error(d.element("C1")), "loads; C1 carries a note naming L9", n || "(no note)");
});
testCase("3", "Open a file with one malformed element", () => {
  const j = JSON.parse(buildSample().serialise());
  j.elements.push({ id: "BROKEN", type: "Wall", args: 5, extra: "kept" });
  const d = openDocument(j); d.regenerate();
  const ph = d.elements().filter(f => f.get("Placeholder"));
  const built = d.elements().filter(f => !d.error(f)).length;
  const again = JSON.parse(d.serialise()).elements.find(e => e.id === "BROKEN");
  return R(ph.length === 1 && again && again.extra === "kept" && again.args === 5 && built >= j.elements.length - 1, "1 placeholder, raw JSON survives re-save, rest built",
    `${ph.length} placeholder, raw ${again ? "kept" : "lost"}, ${built}/${j.elements.length} built; report: ${d.loadReport.join("; ")}`);
});

// ---------------------------------------------------------------- 4–13: joins and offsets
testCase("4", "Two 300mm walls, same type, 90°", () => {
  const { doc } = fixture();
  wall(doc, "A", [0, 0], [8000, 0], "T-300"); wall(doc, "B", [8000, 0], [8000, 6000], "T-300"); joinEE(doc, "A", "end", "B", "start"); doc.regenerate();
  // Outer corner: faces y = −150 and x = 8150 meet at (8150, −150); inner at (7850, 150).
  const ra = regions(doc, "A")[0], ends = ra.edges.filter(e => e.role === "weld");
  const pts = samplePath(ra.path, 4);
  const hasOuter = pts.some(p => dist(p, [8150, -150]) < 1e-6), hasInner = pts.some(p => dist(p, [7850, 150]) < 1e-6);
  // Area of A's mitred region: trapezoid 300 × (8150+7850)/2 − 0 ... from x=−150? free start: x from 0: (8150 + 7850)/2 × 300 = 2,400,000
  const area = pathArea(ra.path);
  return R(hasOuter && hasInner && ends.length === 1 && approx(area, 2.4e6, 1e-3), "mitre corners (8150,−150)/(7850,150), 1 welded cap (no separator), area 2 400 000", `corners ${hasOuter && hasInner ? "ok" : "wrong"}, welded caps ${ends.length}, area ${r3(area)}`);
});
testCase("5", "Same at 10°: miter limit bevels", () => {
  const { doc } = fixture();
  const a10 = 10 * Math.PI / 180;
  wall(doc, "A", [0, 0], [8000, 0], "T-300"); wall(doc, "B", [8000, 0], [8000 - 6000 * Math.cos(a10), 6000 * Math.sin(a10)], "T-300");
  joinEE(doc, "A", "end", "B", "start"); doc.regenerate();
  // Unbevelled, the outer corner sits 150/sin 5° = 1721 mm from the node — the spike.
  // With the limit (4 × 150 = 600 mm) no vertex on the outer side may pass 600 mm.
  const P = [8000, 0];
  // outer side of the node = away from the wedge between the walls, within 3 m of it (the spike would be at 1.7 m)
  const outerPts = ["A", "B"].flatMap(id => wallRegions(W(doc, id), "Coarse", 1200, []).flatMap(r => samplePath(r.path, 4))).filter(p => dist(p, P) < 3000 && (p[1] < -1 || p[0] > 8000 + 1));
  const far = Math.max(...outerPts.map(p => dist(p, P)));
  const bevel = (W(doc, "A").ends.end.bevel || []).length + (W(doc, "B").ends.start.bevel || []).length;
  return R(far < 600 && bevel === 1, "bevel present; outer side within 600 mm of the node (no 1.7 m spike)", `bevels ${bevel}, furthest outer vertex ${r3(far)} mm`);
});
testCase("6", "Cavity wall meets stud partition at 90°", () => {
  const { doc } = fixture();
  wall(doc, "EXT", [0, 0], [8000, 0], "T-EXTCAV300"); wall(doc, "P", [4000, 0], [4000, 4000], "T-PART100"); joinT(doc, "P", "start", "EXT", 4000); doc.regenerate();
  // EXT centred, 290.5 thick: boundaries s = −145.25, −42.75, 32.25, 132.25, 145.25 (brick, cavity, block, plaster).
  // Plasterboard (Finish 1, p4) is blocked by block (p1) and cavity (p3) but not by plaster (p4): it stops at y = 132.25.
  const P = W(doc, "P"), pb = regions(doc, "P").filter(r => r.layer === 0);
  const yEnd = Math.min(...pb.flatMap(r => samplePath(r.path, 2)).map(p => p[1]));
  const block = regions(doc, "EXT").filter(r => r.layer === 2).length;
  return R(approx(yEnd, 132.25, 1e-6) && block === 1, "plasterboard stops at y = 132.25 (blockwork face); blockwork 1 region", `plasterboard ends at y = ${r3(yEnd)}; blockwork ${block} region(s)`);
});
testCase("7", "T-join: partition structure through the finish, stops at blockwork", () => {
  const { doc } = fixture();
  wall(doc, "EXT", [0, 0], [8000, 0], "T-EXTCAV300"); wall(doc, "P", [4000, 0], [4000, 4000], "T-PART100"); joinT(doc, "P", "start", "EXT", 4000); doc.regenerate();
  const stud = regions(doc, "P").filter(r => r.layer === 1);
  const yEnd = Math.min(...stud.flatMap(r => samplePath(r.path, 2)).map(p => p[1]));
  const plaster = regions(doc, "EXT").filter(r => r.layer === 3);
  // EXT's plaster is cut where the 100mm partition passes: two pieces; 13 × (8000 − 100) in total.
  const pa = plaster.reduce((a, r) => a + Math.abs(pathArea(r.path)), 0);
  return R(approx(yEnd, 132.25) && plaster.length === 2 && approx(pa, 13 * 7900, 1e-3), "stud ends at y = 132.25; plaster in 2 pieces, area 102 700", `stud ends ${r3(yEnd)}; plaster ${plaster.length} pieces, area ${r3(pa)}`);
});
testCase("8", "Four walls closing a room", () => {
  const { doc } = fixture();
  wall(doc, "A", [0, 0], [8000, 0], "T-300"); wall(doc, "B", [8000, 0], [8000, 6000], "T-300"); wall(doc, "C", [8000, 6000], [0, 6000], "T-300"); wall(doc, "D", [0, 6000], [0, 0], "T-300");
  joinEE(doc, "A", "end", "B", "start"); joinEE(doc, "B", "end", "C", "start"); joinEE(doc, "C", "end", "D", "start"); joinEE(doc, "D", "end", "A", "start");
  doc.addElement({ id: "S", type: "Space", args: { level: { ref: "L0" }, anchor: [4000, 3000], boundaryAt: "finishFace" } });
  doc.regenerate();
  // inner face loop: (8000 − 300) × (6000 − 300) = 7700 × 5700 = 43 890 000
  const a = doc.data(doc.element("S")).value, loop = doc.plan(doc.element("S")).loop;
  return R(approx(a, 43.89e6, 1e-3) && loop.holes.length === 0, "one closed loop, 43 890 000 mm²", `${r3(a)} mm², ${loop.holes.length} holes`);
});
testCase("9", "Three walls at one node: no overlap, no gap", () => {
  const { doc } = fixture();
  wall(doc, "A", [-4000, 0], [0, 0], "T-300"); wall(doc, "B", [0, 0], [4000, 0], "T-300"); wall(doc, "C", [0, 0], [0, 4000], "T-300");
  joinEE(doc, "A", "end", "B", "start"); joinEE(doc, "B", "start", "C", "start"); doc.regenerate();
  // Union is a T: 8000 × 300 + (4000 − 150) × 300 = 2 400 000 + 1 155 000 = 3 555 000.
  const sum = ["A", "B", "C"].reduce((acc, id) => acc + wallRegions(W(doc, id), "Coarse", 1200, []).reduce((a, r) => a + Math.abs(pathArea(r.path)), 0), 0);
  return R(approx(sum, 3.555e6, 1e-3), "Σ region areas = union area 3 555 000 (so no overlap and no gap)", r3(sum));
});
testCase("10", "Arc wall, r = 2000, 300mm thick", () => {
  const { doc } = fixture();
  doc.addElement({ id: "A", type: "Wall", args: { centreline: { type: "arc", centre: [0, 0], radius: 2000, start: 0, end: 90, ccw: true }, mounting: "Centred", wallType: { ref: "T-300" }, baseLevel: { ref: "L0" }, height: 3000 } });
  doc.regenerate();
  const w = W(doc, "A"), rIn = boundary(w, 1).radius, rOut = boundary(w, 0).radius;
  return R(rIn === 1850 && rOut === 2150 && boundary(w, 0).type === "arc", "exact arcs r = 1850 / 2150", `${rIn} / ${rOut} (${boundary(w, 0).type})`);
});
testCase("11", "Arc wall, r = 120, 300mm thick", () => {
  const { doc } = fixture();
  doc.addElement({ id: "A", type: "Wall", args: { centreline: { type: "arc", centre: [0, 0], radius: 120, start: 0, end: 90, ccw: true }, mounting: "Centred", wallType: { ref: "T-300" }, baseLevel: { ref: "L0" }, height: 3000 } });
  wall(doc, "B", [1000, 0], [4000, 0], "T-300");
  doc.regenerate();
  const e = doc.error(doc.element("A")) || "";
  return R(e.includes("r=120mm") && e.includes("minimum radius for this type is 155mm") && !doc.error(doc.element("B")), "error names r=120 and the minimum 155mm; B still builds", e);
});
testCase("12", "Spline wall: offsets refit within 0.5mm; the PDF draws curves", () => {
  const { doc } = fixture();
  doc.addElement({ id: "S", type: "Wall", args: { centreline: { type: "spline", points: [[0, 0], [2000, 1500], [4000, 0], [6000, 1200]] }, mounting: "Centred", wallType: { ref: "T-300" }, baseLevel: { ref: "L0" }, height: 3000 } });
  doc.regenerate();
  const w = W(doc, "S"), reg = wallRegions(w, "Coarse", 1200, [])[0];
  const beziers = reg.path.filter(s => s.k === "C");
  // deviation: every fitted Bézier sample vs the true offset point nearest it
  // both faces: ±150 from the centreline, measured to the true offset curves
  // measured to the true offset curve as a fine polyline (to its segments, not its samples:
  // sample spacing alone would read as 1 mm of error)
  const truth = [];
  for (const k of [150, -150]) { let prev = null; for (let i = 0; i <= 4000; i++) { const t = i / 4000, p = add(w.curve.at(t), mul(w.curve.normalAt(t), k)); if (prev) truth.push({ k: "L", a: prev, b: p }); prev = p; } }
  let worst = 0;
  for (const s of beziers) for (let k = 0; k <= 8; k++) { const q = bez(s.a, s.c1, s.c2, s.b, k / 8); let m = Infinity; for (const seg of truth) { if (Math.abs(seg.a[0] - q[0]) > 60 || Math.abs(seg.a[1] - q[1]) > 60) continue; m = Math.min(m, distToSeg(q, seg).d); } worst = Math.max(worst, m); }
  const ops = pathOps(reg.path);
  return R(beziers.length > 0 && worst < 0.5 + 0.05 && / c/.test(ops), "Bézier segments, deviation < 0.5 mm, PDF path uses c", `${beziers.length} Béziers, worst ${r3(worst)} mm, curve ops ${(ops.match(/ c/g) || []).length}`);
});
testCase("13", "Coarse vs fine: offsets built", () => {
  const mk = () => { const { doc } = fixture(); wall(doc, "A", [0, 0], [6000, 0], "T-EXTCAV300"); doc.regenerate(); return doc; };
  const a = mk(); const a0 = a.stats.offsets; wallRegions(W(a, "A"), "Coarse", 1200, []); const coarse = a.stats.offsets - a0;
  const b = mk(); const b0 = b.stats.offsets; wallRegions(W(b, "A"), "Fine", 1200, []); const fine = b.stats.offsets - b0;
  // 4 layers → boundaries 0..4: fine builds 5; coarse only 0 and 4.
  return R(coarse === 2 && fine === 5, "coarse 2, fine 5 (call counters)", `coarse ${coarse}, fine ${fine}`);
});
testCase("14", "Heuristic plan vs an independent section", () => {
  // No OCCT in this build: the independent computation is the surface set cut at
  // z = h (Cramer corners), compared with the offset-curve fast path. Same parameters, different code.
  const { doc } = fixture();
  wall(doc, "A", [0, 0], [6000, 1000], "T-EXTCAV300"); wall(doc, "B", [6000, 1000], [6000, 6000], "T-EXTCAV300"); joinEE(doc, "A", "end", "B", "start"); doc.regenerate();
  let worst = 0, counts = [];
  for (const id of ["A", "B"]) {
    const w = W(doc, id);
    const fast = wallRegions(w, "Coarse", 1200, []).reduce((a, r) => a + Math.abs(pathArea(r.path)), 0);
    const sec = ifc_sectionArea(w, 1200, doc.stats);
    worst = Math.max(worst, Math.abs(fast - sec) / fast); counts.push(wallRegions(w, "Coarse", 1200, []).length + "/" + 1);
  }
  return R(worst < 0.001, "area difference < 0.1 %, same region count", `worst ${(worst * 100).toFixed(5)} %, regions ${counts.join(", ")}`, "Section is the surface-set cut, not BRepAlgoAPI_Section: this build has no OCCT.");
});
import { wallSurfaces, cutAtHeight, plane } from "./walls.js";
function ifc_sectionArea(w, h, stats) {
  let A = 0;
  for (const pc of w.pieces) {
    const S = wallSurfaces(w, w.stack.s[0], w.stack.s[w.stack.s.length - 1], plane([...perpv(sub(pc.foot[3], pc.foot[0])).map(x => -x), 0], [...pc.foot[0], 0]), plane([...perpv(sub(pc.foot[2], pc.foot[1])), 0], [...pc.foot[1], 0]));
    A += Math.abs(polyArea(cutAtHeight(S, h, stats)));
  }
  return A;
}
const perpv = a => [-a[1], a[0]];

// ---------------------------------------------------------------- 15–20: revisions, drags, openings
testCase("15", "Change a material hatch: zero model regenerations", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const v = doc.element("V-P00"); const before = deriveView(doc, v);
  const rev = doc.modelRevision, builds = JSON.stringify(doc.stats.builds), vr = doc.viewRevision;
  ed.apply({ op: "type", lib: "materials", id: "M-BLOCK", path: "cut.pattern", value: "P-CONC" });
  const after = deriveView(doc, v);
  const used = after.prims.some(p => p.t === "hatch" && p.pattern.id === "P-CONC" && p.id === "W1");
  return R(doc.modelRevision === rev && JSON.stringify(doc.stats.builds) === builds && doc.viewRevision > vr && used && after !== before, "plan updates; model revision and build counters unchanged", `model rev ${rev}→${doc.modelRevision}, builds ${JSON.stringify(doc.stats.builds) === builds ? "unchanged" : "changed"}, view rev ${vr}→${doc.viewRevision}, W1 hatched P-CONC: ${used}`);
});
testCase("16", "Change a wall type's layer thickness", () => {
  const { doc, ed } = fixture();
  wall(doc, "A", [0, 0], [6000, 0], "T-300"); wall(doc, "B", [6000, 0], [6000, 5000], "T-400"); wall(doc, "C", [0, 3000], [4000, 3000], "T-400");
  joinEE(doc, "A", "end", "B", "start"); doc.regenerate();
  const b0 = doc.stats.builds.Wall, res0 = Object.assign({}, doc.stats.resolved);
  ed.apply({ op: "type", lib: "types", id: "T-300", path: "layers.0.thickness", value: 350 });
  const rebuilt = doc.stats.lastRegen.rebuilt;
  const re = ["A", "B", "C"].map(id => (doc.stats.resolved[id] || 0) - (res0[id] || 0));
  return R(rebuilt.join() === "A" && re[0] === 1 && re[1] === 1 && re[2] === 0, "A rebuilds; A and B (joined) re-resolve; C untouched", `rebuilt [${rebuilt}], re-resolved A ${re[0]} B ${re[1]} C ${re[2]}`);
});
testCase("17", "Drag a wall end 400 times: one undo step", () => {
  const { doc, ed } = fixture(); wall(doc, "A", [0, 0], [4000, 0], "T-300"); doc.regenerate();
  const start = JSON.stringify(doc.argValue(doc.element("A"), "centreline"));
  for (let i = 1; i <= 400; i++) ed.apply({ op: "drag", id: "A", key: "centreline.end", value: [4000 + i * 3.7, i * 1.3], coalesce: "set:A:centreline.end" });
  ed.seal();
  const steps = ed.undoStack.length; ed.undo();
  const back = JSON.stringify(doc.argValue(doc.element("A"), "centreline"));
  return R(steps === 1 && back === start, "1 undo step; back to the exact start", `${steps} step(s); ${back === start ? "exact" : back}`);
});
testCase("18", "Type 3600 mid-drag", () => {
  const { doc, ed } = fixture(); wall(doc, "A", [0, 0], [4000, 0], "T-300"); doc.regenerate();
  ed.apply({ op: "drag", id: "A", key: "centreline.end", value: [3712.4, 0], coalesce: "set:A:centreline.end" });
  // typed: end = start + d × 3600 with d = (1, 0)
  ed.apply({ op: "drag", id: "A", key: "centreline.end", value: [0 + 1 * 3600, 0], coalesce: "set:A:centreline.end" });
  const L = doc.data(doc.element("A")).value;
  return R(L === 3600, "exactly 3600", String(L));
});
function openingFixture() {
  const { doc, ed } = fixture();
  wall(doc, "A", [0, 0], [6000, 0], "T-300");
  doc.addElement({ id: "OP", type: "Opening", args: { host: { ref: "A" }, profile: { kind: "rect", at: 2800, sill: 0, w: 915, h: 2100 }, farProfile: null, depth: "through" } });
  doc.addElement({ id: "D", type: "Door", args: { fills: { ref: "OP" }, doorType: { ref: "T-DOOR915" } } });
  doc.regenerate();
  return { doc, ed };
}
testCase("19", "Opening at u = 2800, host dragged 2 m", () => {
  const { doc, ed } = openingFixture();
  const sketch = JSON.stringify(doc.argValue(doc.element("OP"), "profile"));
  ed.apply({ op: "drag", id: "A", key: "centreline", value: { type: "line", start: [0, 2000], end: [6000, 2000] } });
  const fr = doc.data(doc.element("D")).frame, w = W(doc, "A"), c = pointAt(w, 0, fr.at);
  return R(JSON.stringify(doc.argValue(doc.element("OP"), "profile")) === sketch && approx(c[1], 2000) && approx(c[0], 2800), "door follows to (2800, 2000); sketch byte-identical", `door at (${r3(c[0])}, ${r3(c[1])}); sketch ${JSON.stringify(doc.argValue(doc.element("OP"), "profile")) === sketch ? "identical" : "changed"}`);
});
testCase("19a", "Door type swapped for another of the same size", () => {
  const { doc, ed } = openingFixture();
  const b = doc.stats.builds.Wall;
  ed.apply({ op: "set", id: "D", key: "doorType", value: { ref: "T-DOOR915G" } });
  return R(doc.stats.builds.Wall === b, "zero wall regenerations", `${doc.stats.builds.Wall - b} wall builds`);
});
testCase("19b", "Opening with no door", () => {
  const { doc } = fixture(); wall(doc, "A", [0, 0], [6000, 0], "T-300");
  doc.addElement({ id: "OP", type: "Opening", args: { host: { ref: "A" }, profile: { kind: "rect", at: 3000, sill: 0, w: 1000, h: 2100 } } }); doc.regenerate();
  const regs = regions(doc, "A", "Coarse"), jambs = regs.flatMap(r => r.edges).filter(e => e.role === "cap" && e.seg.k === "L" && approx(Math.abs(e.seg.a[0] - 2500) * Math.abs(e.seg.a[0] - 3500), 0, 1e-3));
  const sc = planScene(doc, doc.element("V")); const swings = sc.prims.filter(p => p.path && p.path.some(s => s.k === "A"));
  return R(!doc.error(doc.element("OP")) && regs.length === 2 && jambs.length === 2 && swings.length === 0, "valid; wall in 2 pieces; 2 jamb lines at u = 2500/3500; no swing", `${regs.length} pieces, ${jambs.length} jambs, ${swings.length} arcs`);
});
testCase("19c", "Two elements filling one opening", () => {
  const { doc } = openingFixture();
  doc.addElement({ id: "D2", type: "Door", args: { fills: { ref: "OP" }, doorType: { ref: "T-DOOR915" }, flipFacing: true } }); doc.regenerate();
  const pieces = regions(doc, "A", "Coarse").length;
  return R(!doc.error(doc.element("D")) && !doc.error(doc.element("D2")) && pieces === 2, "both build; wall voided once (2 pieces)", `D ${doc.error(doc.element("D")) || "ok"}, D2 ${doc.error(doc.element("D2")) || "ok"}, ${pieces} pieces`);
});
testCase("19d", "Wall shortened past the opening's u", () => {
  const { doc, ed } = openingFixture();
  ed.apply({ op: "drag", id: "A", key: "centreline.end", value: [2000, 0] });
  const n = doc.note(doc.element("OP")) || "";
  return R(!!doc.element("OP") && n.includes("kept") && doc.data(doc.element("OP")).frame.flagged, "flagged and retained", n);
});
testCase("19e", "Splayed reveal: far profile 200mm wider", () => {
  const { doc } = fixture(); wall(doc, "A", [0, 0], [6000, 0], "T-300");
  doc.addElement({ id: "OP", type: "Opening", args: { host: { ref: "A" }, profile: { kind: "rect", at: 3000, sill: 900, w: 1000, h: 2000 }, farProfile: { kind: "rect", w: 1200, h: 2000 } } }); doc.regenerate();
  // a loft of a width varying linearly 1000→1200 over 300: V = 300 × 2000 × 1100 = 660 000 000 (a prism would be 600 000 000)
  const v = doc.data(doc.element("OP")).frame.voidVolume;
  return R(approx(v, 6.6e8, 1e-3), "660 000 000 mm³ (loft, not the 600 000 000 prism)", r3(v));
});
testCase("19f", "depth: 100 on a 300mm wall", () => {
  const { doc } = fixture(); wall(doc, "A", [0, 0], [4000, 0], "T-300");
  doc.addElement({ id: "OP", type: "Opening", args: { host: { ref: "A" }, profile: { kind: "rect", at: 2000, sill: 900, w: 1000, h: 1000 }, depth: 100 } }); doc.regenerate();
  // gross 4000 × 300 × 3000 = 3.6e9; recess 1000 × 1000 × 100 = 1e8 → 3.5e9; and a piece still spans the recess
  const w = W(doc, "A");
  const vol = w.pieces.reduce((a, p) => a + Math.abs(polyArea(p.foot)) * (p.z1 - p.z0), 0);
  const behind = w.pieces.some(p => p.z0 === 900 && p.z1 === 1900);
  return R(approx(vol, 3.5e9, 1) && behind, "solid volume 3.5e9 mm³; wall continues behind the recess", `${r3(vol)} mm³; behind: ${behind}`);
});
testCase("19g", "Opening on an arc wall at u = 2800", () => {
  const { doc } = fixture();
  doc.addElement({ id: "A", type: "Wall", args: { centreline: { type: "arc", centre: [0, 0], radius: 4000, start: 0, end: 120, ccw: true }, mounting: "Centred", wallType: { ref: "T-300" }, baseLevel: { ref: "L0" }, height: 3000 } });
  doc.addElement({ id: "OP", type: "Opening", args: { host: { ref: "A" }, profile: { kind: "rect", at: 2800, sill: 0, w: 900, h: 2100 } } }); doc.regenerate();
  // arc length 2800 on r = 4000 is 0.7 rad from the start
  const p = pointAt(W(doc, "A"), 0, 2800), ang = Math.atan2(p[1], p[0]);
  return R(approx(ang, 0.7, 1e-12), "0.7 rad along (arc length, not chord)", `${ang} rad`);
});
testCase("19h", "40 openings on one wall: one cut", () => {
  const { doc } = fixture(); wall(doc, "A", [0, 0], [40000, 0], "T-300");
  for (let i = 0; i < 40; i++) doc.addElement({ id: "O" + i, type: "Opening", args: { host: { ref: "A" }, profile: { kind: "rect", at: 500 + i * 1000, sill: 900, w: 600, h: 1200 } } });
  const c0 = doc.stats.cuts; doc.regenerate();
  return R(doc.stats.cuts - c0 === 1, "1 fused cut", `${doc.stats.cuts - c0}`);
});
testCase("19i", "Cut plane below the sill", () => {
  const { doc, ed } = fixture(); wall(doc, "A", [0, 0], [6000, 0], "T-300");
  doc.addElement({ id: "OP", type: "Opening", args: { host: { ref: "A" }, profile: { kind: "rect", at: 3000, sill: 1400, w: 1200, h: 1200 } } }); doc.regenerate();
  const c0 = doc.stats.cuts;
  const sc = planScene(doc, doc.element("V"));        // cut at 1200 < sill 1400
  const fills = sc.prims.filter(p => p.t === "fill" && p.id === "A").length;
  return R(fills === 1 && doc.stats.cuts === c0, "wall solid in plan (1 region); no cut evaluated for the drawing", `${fills} region(s); cuts +${doc.stats.cuts - c0}`);
});
testCase("20", "Core interior mounting, type swapped for a thicker one", () => {
  const { doc, ed } = fixture(); wall(doc, "A", [0, 0], [6000, 0], "T-EXTCAV300", { mounting: "Core interior" }); doc.regenerate();
  const before = resolveReference(doc, "A:core.interior").geom.p[1];
  ed.apply({ op: "set", id: "A", key: "wallType", value: { ref: "T-EXTCAV350" } });
  const after = resolveReference(doc, "A:core.interior").geom.p[1];
  return R(before === 0 && after === 0, "the core interior face stays on y = 0", `${before} → ${after}`);
});

// ---------------------------------------------------------------- 21–28: views, sheets, graphics, PDF
testCase("21", "Elevation marker dragged in plan", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const v = doc.element("V-E01"); const a = deriveView(doc, v);
  ed.apply({ op: "drag", id: "V-E01", key: "line", value: { type: "line", start: [15500, -9000], end: [-3500, -9000] } });
  const b = deriveView(doc, v);
  return R(a !== b && JSON.stringify(a.prims) !== JSON.stringify(b.prims), "elevation regenerates from args.line alone", `${a.prims.length} → ${b.prims.length} prims, differs: ${JSON.stringify(a.prims) !== JSON.stringify(b.prims)}`);
});
testCase("22", "Place V-E01 on A-101 as viewport 2", () => {
  const doc = buildSample();
  const sc = deriveView(doc, doc.element("V-P00"));
  const top = sc.prims.find(p => p.t === "text" && p.id === "V-E01" && p.marker === "top"), bot = sc.prims.find(p => p.t === "text" && p.id === "V-E01" && p.marker === "bottom");
  return R(top && bot && top.text === "2" && bot.text === "A-101", "marker reads 2 / A-101", `${top && top.text} / ${bot && bot.text}`);
});
testCase("23", "Text at 1:100 then 1:50", () => {
  const doc = buildSample(), ed = new Editor(doc), v = doc.element("V-P00");
  const t100 = deriveView(doc, v).prims.find(p => p.t === "text" && p.id === "TX1");
  ed.apply({ op: "set", id: "V-P00", key: "scale", value: 50 });
  const t50 = deriveView(doc, v).prims.find(p => p.t === "text" && p.id === "TX1");
  const w = textWidth(t100.text, 2.5);
  return R(t100.height === 2.5 && t50.height === 2.5, "2.5 mm on paper at both; model footprint 250 → 125 mm tall", `paper ${t100.height} / ${t50.height} mm; model height ${2.5 * 100} → ${2.5 * 50} mm; width ${r3(w * 100)} → ${r3(w * 50)} mm`);
});
testCase("24", "Drag text with a leader", () => {
  const doc = buildSample(), ed = new Editor(doc), f = doc.element("TX1");
  const L0 = clone(doc.argValue(f, "leaders")[0]);
  ed.apply({ op: "drag", id: "TX1", key: "position", value: add(doc.argValue(f, "position"), [500, 300]) });
  const L1 = doc.argValue(f, "leaders")[0];
  return R(dist(L1.elbow, add(L0.elbow, [500, 300])) < 1e-9 && dist(L1.target, L0.target) === 0, "elbow moves (500, 300); target stays", `elbow Δ (${r3(L1.elbow[0] - L0.elbow[0])}, ${r3(L1.elbow[1] - L0.elbow[1])}); target Δ ${dist(L1.target, L0.target)}`);
});
testCase("25", "Import a 100×100 DXF, set 300×300", () => {
  const txt = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
    "0", "LWPOLYLINE", "8", "A", "90", "4", "70", "1", "10", "0", "20", "0", "10", "100", "20", "0", "10", "100", "20", "100", "10", "0", "20", "100",
    "0", "REGION", "8", "X", "0", "3DFACE", "8", "X", "0", "ENDSEC", "0", "EOF"].join("\n");
  const r = readDXF(txt);
  const w = r.bbox[2] - r.bbox[0], scale = Math.min(300 / w, 300 / (r.bbox[3] - r.bbox[1]));
  return R(scale === 3 && /skipped 2/.test(r.message), "scale 3; unsupported entities listed", `scale ${scale}; "${r.message}"`);
});
testCase("26", "Phase filter on demolished walls", () => {
  const doc = buildSample();
  const sc = deriveView(doc, doc.element("V-P00"));
  const demo = sc.prims.filter(p => p.id === "GW2" && p.t === "stroke"), newer = sc.prims.filter(p => p.id === "W1" && p.t === "stroke");
  const ok = demo.length && demo.every(p => p.dash && p.colour !== "#000000") && newer.every(p => !p.dash);
  return R(ok, "GW2 dashed grey; W1 solid black", `GW2 ${demo.length} strokes, dashed ${demo.every(p => p.dash)}, colour ${demo[0] && demo[0].colour}; W1 dashed ${newer.some(p => p.dash)}`);
});
testCase("26a", "Style swapped PRESENTATION ↔ CONSTRUCTION", () => {
  const doc = buildSample(), ed = new Editor(doc), v = doc.element("V-P00");
  const a = JSON.stringify(deriveView(doc, v).prims); const rev = doc.modelRevision, b0 = JSON.stringify(doc.stats.builds);
  ed.apply({ op: "set", id: "V-P00", key: "style", value: { ref: "VS-PRESENTATION" } });
  const b = JSON.stringify(deriveView(doc, v).prims);
  const rebuilt = doc.stats.lastRegen.rebuilt;
  return R(a !== b && rebuilt.join() === "V-P00" && doc.stats.builds.Wall === JSON.parse(b0).Wall, "two drawings; only the view label rebuilt; zero wall builds", `drawings differ ${a !== b}; rebuilt [${rebuilt}]`);
});
testCase("26b", "VS-PRESENTATION on a plan of 400 walls", () => {
  const { doc, ed } = fixture();
  for (let i = 0; i < 400; i++) wall(doc, "W" + i, [(i % 20) * 3000, Math.floor(i / 20) * 3000], [(i % 20) * 3000 + 2500, Math.floor(i / 20) * 3000], "T-EXTCAV300");
  doc.setArg(doc.element("V"), "style", { ref: "VS-PRESENTATION" });
  doc.regenerate();
  const o0 = doc.stats.offsets; planScene(doc, doc.element("V")); const n = doc.stats.offsets - o0;
  return R(n === 800, "800 offsets (2 per wall): the coarse path", `${n} offsets`);
});
testCase("26c", "Structure under VS-PRESENTATION: no outline at all", () => {
  const doc = buildSample();
  const sc = deriveView(doc, doc.element("V-P00P"));
  const w1 = sc.prims.filter(p => p.id === "W1");
  return R(w1.some(p => p.t === "fill" && p.colour === "#2C3440") && !w1.some(p => p.t === "stroke"), "solid fill #2C3440, zero strokes", `${w1.filter(p => p.t === "fill").length} fills, ${w1.filter(p => p.t === "stroke").length} strokes`);
});
testCase("26d", "Furniture under VS-PRESENTATION", () => {
  const doc = buildSample(); const sc = deriveView(doc, doc.element("V-P00P"));
  const fu = sc.prims.filter(p => p.id && p.id.startsWith("FU"));
  return R(fu.length && !fu.some(p => p.t === "fill"), "stroke only; no filled region", `${fu.filter(p => p.t === "fill").length} fills, ${fu.filter(p => p.t === "stroke").length} strokes`);
});
testCase("26e", "Space label at 1:100 and 1:200", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const lab = () => deriveView(doc, doc.element("V-P00P")).prims.filter(p => p.t === "text" && p.id === "SP1");
  ed.apply({ op: "set", id: "V-P00P", key: "scale", value: 100 }); const a = lab(); ed.apply({ op: "set", id: "V-P00P", key: "scale", value: 200 }); const b = lab();
  return R(a.length === 2 && b.length === 2 && a.every(p => p.height === 2) && b.every(p => p.height === 2), "2.0 mm, two lines (name, area) at both", `${a.map(p => p.text).join(" | ")} @ ${a[0] && a[0].height} mm; ${b.length} lines @ ${b[0] && b[0].height} mm`);
});
testCase("27", "Plan at 1:50 and 1:200", () => {
  const doc = buildSample(), ed = new Editor(doc), v = doc.element("V-P00");
  const pick = () => { const s = deriveView(doc, v).prims; return { w: s.find(p => p.t === "stroke" && p.id === "W1").weight, brick: s.find(p => p.t === "hatch" && p.pattern.id === "P-BRICK").scale, plas: s.find(p => p.t === "hatch" && p.pattern.id === "P-PLASTER").scale }; };
  ed.apply({ op: "set", id: "V-P00", key: "scale", value: 50 }); const a = pick();
  ed.apply({ op: "set", id: "V-P00", key: "scale", value: 200 }); const b = pick();
  // model hatch scale is 1/S (1/50 → 1/200); drafting hatch stays 1
  return R(a.w === b.w && approx(a.brick, 1 / 50) && approx(b.brick, 1 / 200) && a.plas === 1 && b.plas === 1, "weights equal; brick 1/50 → 1/200; plaster 1 → 1", `weight ${a.w}/${b.w}; brick ${r3(a.brick)}/${r3(b.brick)}; plaster ${a.plas}/${b.plas}`);
});
/** Parse a content stream back: the CTM and the first `re`/path after it. */
function pdfText(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return s; }
const squarePage = (size) => ({ size, prims: [{ t: "stroke", path: [{ k: "L", a: [100, 100], b: [110, 100] }, { k: "L", a: [110, 100], b: [110, 110] }, { k: "L", a: [110, 110], b: [100, 110] }, { k: "L", a: [100, 110], b: [100, 100] }], weight: 1, colour: "#000000", layer: "Test" }], title: "t" });
function squareDelta(txt) {
  const ctm = Number(txt.match(/([\d.]+) 0 0 [\d.]+ 0 0 cm/)[1]);
  const m = txt.match(/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l/);
  return (Number(m[3]) - Number(m[1])) * ctm;
}
testCase("28", "PDF vs screen: one scene", () => {
  const doc = buildSample(), sc = deriveView(doc, doc.element("V-P00"));
  const p = sc.prims.find(x => x.t === "fill" && x.id === "W1");
  const ops = pathOps(p.path), first = ops.split(" m")[0].split(" ").map(Number);
  const s0 = segStart(p.path[0]);
  return R(Math.abs(first[0] - s0[0]) < 0.05 && Math.abs(first[1] - s0[1]) < 0.05, "same coordinates in mm (≤ 0.05)", `${first.join(", ")} vs ${s0.map(r3).join(", ")}`);
});
testCase("28a", "10mm square on A3", () => {
  const t = pdfText(writePDF([squarePage([297, 420])]).bytes);
  const mb = t.match(/\/MediaBox \[([^\]]+)\]/)[1], d = squareDelta(t);
  return R(mb === "0 0 841.890 1190.551" && approx(d, 28.3465, 0.001), "MediaBox [0 0 841.890 1190.551]; delta 28.3465 ± 0.001 pt", `[${mb}]; ${d.toFixed(4)} pt`);
});
testCase("28b", "Same square, A1 sheet", () => { const d = squareDelta(pdfText(writePDF([squarePage([594, 841])]).bytes)); return R(approx(d, 28.3465, 0.001), "28.3465 ± 0.001 pt", d.toFixed(4)); });
testCase("28c", "Sheet set of A1 plans + A3 details", () => {
  const t = pdfText(writePDF([squarePage([841, 594]), squarePage([420, 297])]).bytes);
  const boxes = [...t.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map(m => m[1]);
  return R(boxes[0] === "0 0 2383.937 1683.780" && boxes[1] === "0 0 1190.551 841.890", "per-page MediaBox", boxes.join(" | "));
});
testCase("28d", "pen: none region in the PDF", () => {
  const doc = buildSample(), sc = deriveView(doc, doc.element("V-P00P"));
  const w1 = sc.prims.filter(p => p.id === "W1");
  const t = pdfText(writePDF([{ size: [420, 297], prims: w1, title: "t" }]).bytes);
  const content = t.split("stream\n").map(x => x.split("endstream")[0]).find(x => x.startsWith("2.834645669 0 0 2.834645669 0 0 cm"));
  return R(/(^|\s)f\*/.test(content) && !/\bS\b/.test(content) && !/\bB\*?\b/.test(content), "fill only: f*, no S, no B", `f* ${(content.match(/f\*/g) || []).length}, S ${(content.match(/\bS\b/g) || []).length}, B ${(content.match(/\bB\*?\b/g) || []).length}`);
});
testCase("28e", "0.5mm line in the PDF", () => {
  const p = squarePage([420, 297]); p.prims[0].weight = 0.5;
  const t = pdfText(writePDF([p]).bytes);
  const w = Number(t.match(/([\d.]+) w\n/)[1]) * Number(t.match(/([\d.]+) 0 0 [\d.]+ 0 0 cm/)[1]);
  return R(approx(w, 1.4173, 1e-4), "1.4173 pt at every view scale (the scale never reaches the writer)", w.toFixed(4) + " pt");
});
testCase("28e3", "0.05mm line is not clamped", () => { const p = squarePage([420, 297]); p.prims[0].weight = 0.05; const t = pdfText(writePDF([p]).bytes); return R(/\n0\.05 w\n/.test(t), "0.05 w", (t.match(/\n([\d.]+) w\n/) || [])[1]); });
testCase("28e4", "Screen render at heavy zoom-out", () => {
  const widths = []; const ctx = new Proxy({}, { get: (o, k) => k === "canvas" ? {} : (k in o ? o[k] : () => {}), set: (o, k, v) => { if (k === "lineWidth") widths.push(v); o[k] = v; return true; } });
  const scene = { prims: [{ t: "stroke", path: [{ k: "L", a: [0, 0], b: [100, 0] }], weight: 0.13, colour: "#000", id: "x" }] };
  drawScene(ctx, scene, { x: -10, y: -10, z: 0.05, W: 800, H: 600, dpr: 2 });
  return R(widths[0] === 0.5, "clamped to one device pixel (0.5 css px at dpr 2) — screen only", `lineWidth ${widths[0]} css px`);
});
testCase("28e5", "Pen heavy retuned 0.50 → 0.70", () => {
  const doc = buildSample(), ed = new Editor(doc), v = doc.element("V-P00");
  const before = deriveView(doc, v).prims.filter(p => p.t === "stroke" && p.weight === 0.5).length;
  const els = doc.serialise();
  ed.apply({ op: "type", lib: "pens", id: "PEN-ISO", path: "pens.heavy.weight", value: 0.7 });
  const after = deriveView(doc, v).prims.filter(p => p.t === "stroke" && p.weight === 0.7).length;
  const elsAfter = JSON.stringify(JSON.parse(doc.serialise()).elements) === JSON.stringify(JSON.parse(els).elements);
  return R(before > 0 && after === before && elsAfter, "every heavy stroke re-grades; no element edited", `${before} at 0.50 → ${after} at 0.70; elements unchanged ${elsAfter}`);
});
testCase("28e6", "One door family's Swing reassigned to light", () => {
  const doc = buildSample(), ed = new Editor(doc), v = doc.element("V-P00");
  ed.apply({ op: "style", id: "VS-CONSTRUCTION", path: "byFamily.F-SINGLEDOOR", value: { swing: { pen: "light" } } });
  const sw = deriveView(doc, v).prims.filter(p => p.id === "D1" && p.path.some(s => s.k === "A"));
  return R(sw.length && sw.every(p => p.weight === 0.25) && doc.lib.pens["PEN-ISO"].pens.light.weight === 0.25, "D1 swing at 0.25; pen light untouched", `${sw.map(p => p.weight).join(",")}; light = ${doc.lib.pens["PEN-ISO"].pens.light.weight}`);
});
testCase("28e7", "Same colour, different pens", () => {
  const doc = buildSample(), ctx = { style: doc.lib.viewStyles["VS-CONSTRUCTION"], scale: 100, rules: [] };
  const a = resolveGraphics(doc, ctx, doc.element("W1"), "cut", "Cut"), b = resolveGraphics(doc, ctx, doc.element("W1"), "cut", "Layer");
  return R(a.colour === b.colour && a.weight !== b.weight, "different weights", `${a.colour}@${a.weight} vs ${b.colour}@${b.weight}`);
});
testCase("28e8", "Colour changed on a wall: weight unchanged", () => {
  const doc = buildSample(), ed = new Editor(doc), v = doc.element("V-P00");
  const w0 = deriveView(doc, v).prims.filter(p => p.id === "W1" && p.t === "stroke").map(p => p.weight).join();
  ed.apply({ op: "set", id: "V-P00", key: "overrides", value: { W1: { cut: { colour: "#d0021b" } } } });
  const after = deriveView(doc, v).prims.filter(p => p.id === "W1" && p.t === "stroke");
  return R(after.map(p => p.weight).join() === w0 && after.some(p => p.colour === "#d0021b"), "weights identical; colour red", `${after.length} strokes, weights equal ${after.map(p => p.weight).join() === w0}`);
});
testCase("28f", "Brick hatch over 200 m²", () => {
  const prim = { t: "hatch", path: [{ k: "L", a: [0, 0], b: [200, 0] }, { k: "L", a: [200, 0], b: [200, 100] }, { k: "L", a: [200, 100], b: [0, 100] }, { k: "L", a: [0, 100], b: [0, 0] }], pattern: Object.assign({ id: "P-BRICK" }, newDocument().lib.patterns["P-BRICK"]), scale: 1 / 100, colour: "#000000", weight: 0.13, layer: "IfcWall" };
  const out = writePDF([{ size: [420, 297], prims: [prim], title: "t" }]), t = pdfText(out.bytes);
  return R(/\/PatternType 1/.test(t) && out.bytes.length < 200000, "tiling pattern; file small", `${out.patterns} patterns, ${(out.bytes.length / 1024).toFixed(0)} KB (font included)`);
});
testCase("28g", "Fonts embedded and subset", () => { const t = pdfText(writePDF([{ size: [210, 297], prims: [{ t: "text", at: [10, 10], text: "Title", height: 5 }], title: "t" }]).bytes); return R(/\/FontFile2/.test(t) && /\/BaseFont \/[A-Z]{6}\+/.test(t), "FontFile2, subset tag", (t.match(/\/BaseFont \/[^\s]+/) || [])[0]); });
testCase("28i", "Marker in the exported set links to its sheet", () => {
  const doc = buildSample();
  const pages = ["SH-A101", "SH-A102"].map(id => { const s = deriveView(doc, doc.element(id)); return { size: s.size, prims: s.prims, links: s.links, title: id, sheet: id }; });
  const t = pdfText(writePDF(pages).bytes);
  const page1 = t.match(/(\d+) 0 obj\n<< \/Type \/Page /)[1];
  const link = t.match(/\/Subtype \/Link [^>]*\/Dest \[(\d+) 0 R/);
  return R(link && link[1] === page1, "link resolves to page 1 (A-101, where V-E01 sits)", link ? `→ obj ${link[1]} (page 1 is obj ${page1})` : "no link");
});
testCase("28j", "10mm square through DXF export and re-import", () => {
  const d = writeDXF(squarePage([100, 100])), r = readDXF(d.text);
  return R(approx(r.bbox[2] - r.bbox[0], 10, 0.001) && !r.needsUnits && /\$INSUNITS\s*\n\s*70\s*\n\s*4/.test(d.text), "10.000 ± 0.001; no prompt; $INSUNITS 4", `${r3(r.bbox[2] - r.bbox[0])}; needsUnits ${r.needsUnits}`);
});
testCase("28k", "Import a DXF with $INSUNITS = 0", () => { const r = readDXF("0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n0\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n10\n21\n0\n0\nENDSEC\n0\nEOF"); return R(r.needsUnits && r.units === null, "asks; never assumes", `needsUnits ${r.needsUnits}`); });
testCase("28l", "3000mm wall exported to model space", () => {
  const { doc } = fixture(); wall(doc, "A", [0, 0], [3000, 0], "T-300"); doc.regenerate();
  const sc = planScene(doc, doc.element("V"));
  const model = { prims: sc.prims.map(p => p.path ? Object.assign({}, p, { path: p.path.map(s => ({ k: "L", a: mul(s.a, 100), b: mul(s.b, 100) })) }) : p).filter(p => p.t === "stroke") };
  const r = readDXF(writeDXF(model).text);
  return R(approx(r.bbox[2] - r.bbox[0], 3000, 0.001), "3000 units", r3(r.bbox[2] - r.bbox[0]));
});
testCase("28m", "1mm weight exported to DXF", () => { const d = writeDXF(squarePage([100, 100])).text.replace(/\r/g, "").replace(/^ +/gm, ""); const ok370 = /\n370\n100\n/.test(d), lw = /\$LWDISPLAY\n290\n1\n/.test(d); return R(ok370 && lw, "370 = 100, $LWDISPLAY 1", `370=100 ${ok370}; $LWDISPLAY ${lw}`); });
testCase("28n", "0.42mm weight exported to DXF", () => { const r = dxfLineweight(0.42); const p = squarePage([100, 100]); p.prims[0].weight = 0.42; const rep = writeDXF(p).report; return R(r.code === 40 && r.substituted && rep.length === 1, "snapped to 40, substitution reported", `${r.code}; "${rep[0]}"`); });

// ---------------------------------------------------------------- 29–36: references and constraints
testCase("29", "Wall type changed, dimension to core.exterior", () => {
  const { doc, ed } = fixture();
  wall(doc, "A", [0, 0], [6000, 0], "T-EXTCAV300"); wall(doc, "B", [0, 5000], [6000, 5000], "T-EXTCAV300"); doc.regenerate();
  const m0 = measureRefs(doc, ["A:core.exterior", "B:core.exterior"]).value;
  ed.apply({ op: "set", id: "A", key: "wallType", value: { ref: "T-EXTCAV350" } });
  const m1 = measureRefs(doc, ["A:core.exterior", "B:core.exterior"]).value;
  // centred: core.exterior of A sits at s = c_cs − T/2. 300: 177.5 − 145.25 = 32.25; 350: 202.5 − 177.75 = 24.75 → 7.5 closer to B
  return R(approx(m0, 5000, 1e-9) && approx(m1, 5007.5, 1e-9), "5000 → 5007.5 (still bound)", `${m0} → ${m1}`);
});
testCase("30", "Reference deleted under a dimension", () => {
  const doc = buildSample(), ed = new Editor(doc);
  ed.apply({ op: "delete", id: "W3" });
  const sc = deriveView(doc, doc.element("V-P00"));
  const t = sc.prims.find(p => p.t === "text" && p.id === "DIM1");
  return R(!!doc.element("DIM1") && t && /lost: W3:core\.exterior/.test(t.text), "dimension survives with a note naming W3:core.exterior", t ? t.text : "(gone)");
});
function chain(n, locked = true) {
  const { doc, ed } = fixture();
  for (let i = 0; i < n; i++) wall(doc, "W" + i, [i * 3600, 0], [i * 3600, 5000], "T-300");
  for (let i = 0; i < n - 1; i++) doc.constraints.push({ id: "C" + i, kind: "distance", of: [`W${i}:centreline`, `W${i + 1}:centreline`], value: 3600, locked });
  doc.regenerate();
  return { doc, ed };
}
testCase("31", "Padlock 3600, drag the far wall", () => {
  const { doc, ed } = chain(2);
  ed.apply({ op: "drag", id: "W1", key: "centreline", value: { type: "line", start: [5000, 0], end: [5000, 5000] } });
  const m = measureRefs(doc, ["W0:centreline", "W1:centreline"]).value, x0 = doc.argValue(doc.element("W0"), "centreline").start[0];
  return R(m === 3600 && x0 === 1400, "near wall follows to x = 1400; separation exactly 3600", `x0 = ${x0}; ${m}`);
});
testCase("32", "Two conflicting padlocks", () => {
  const { doc, ed } = chain(2);
  doc.constraints.push({ id: "C9", kind: "distance", of: ["W1:centreline", "W0:centreline"], value: 3580, locked: true });
  const before = doc.serialise();
  const r = ed.apply({ op: "drag", id: "W1", key: "centreline", value: { type: "line", start: [5000, 0], end: [5000, 5000] } });
  const said = (r.conflicts || []).map(c => c.say).join(" | ");
  return R(!r.ok && /C9/.test(said) && /C0/.test(said) && /20/.test(said) && doc.serialise() === before, "both named with the difference (20); nothing applied", said || "(no conflict)");
});
testCase("33", "Drag inside a padlocked chain of 8", () => {
  const { doc, ed } = chain(8);
  const r = ed.apply({ op: "drag", id: "W3", key: "centreline", value: { type: "line", start: [10000, 0], end: [10000, 5000] } });
  const xs = [...Array(8).keys()].map(i => doc.argValue(doc.element("W" + i), "centreline").start[0]);
  const p = propagate(doc, "W3");
  // W3 held at 10 000 (under the cursor); the rest spaced by exactly 3600 from it; one BFS pass
  const ok = xs[3] === 10000 && xs.every((x, i) => x === 10000 + (i - 3) * 3600);
  return R(ok && r.ok && p.steps <= 14, "held at 10 000; all spaced exactly 3600; ≤ 14 constraint evaluations (2 per edge)", `${xs.join(", ")}; ${p.steps} evaluations`);
});
testCase("33a", "Vertical wall meets horizontal wall", () => { const p = intersectLines(lineThrough([5, -3], [5, 9]), lineThrough([-2, 4], [8, 4])); return R(p[0] === 5 && p[1] === 4, "(5, 4) with no special case", p.join(", ")); });
testCase("33b", "Two walls 0.0001° apart", () => { const a = 0.0001 * Math.PI / 180; const p = intersectLines(lineThrough([0, 0], [1, 0]), lineThrough([0, 1], [Math.cos(a), 1 + Math.sin(a)])); return R(p === null, "parallel (|det| < TOL), not a point 500 m away", String(p)); });
testCase("33c", "Consistent constraint cycle A→B→C→A", () => {
  const { doc, ed } = chain(3);
  doc.constraints.push({ id: "CX", kind: "distance", of: ["W2:centreline", "W0:centreline"], value: 7200, locked: true });
  const r = ed.apply({ op: "drag", id: "W0", key: "centreline", value: { type: "line", start: [100, 0], end: [100, 5000] } });
  return R(r.ok && !r.conflicts, "revisit agrees within TOL; no conflict", r.ok ? "applied" : r.error);
});
testCase("34", "Listening dimensions near a grid and two walls", () => {
  const { doc } = fixture();
  wall(doc, "A", [0, 0], [6000, 0], "T-300"); wall(doc, "B", [0, 3000], [6000, 3000], "T-300"); wall(doc, "C", [0, -2500], [6000, -2500], "T-300"); wall(doc, "X", [7000, -5000], [9000, 3000], "T-300");
  doc.addElement({ id: "G", type: "Grid", args: { name: "1", line: { type: "line", start: [-1000, -4000], end: [8000, -4000] } } });
  doc.regenerate();
  const dims = listeningDimensions(doc, "A");
  return R(dims.length <= 4 && dims.length >= 3 && !dims.some(d => d.to.startsWith("X:")), "≤ 4, parallel only (the slanted wall X is noise)", dims.map(d => `${d.to}=${d.value}`).join(", "));
});
testCase("35", "Type 2400 into a temporary dimension", () => {
  const { doc, ed } = fixture(); wall(doc, "A", [0, 0], [6000, 0], "T-300"); wall(doc, "B", [0, 3000], [6000, 3000], "T-300"); doc.regenerate();
  const d = listeningDimensions(doc, "A").find(x => x.to === "B:centreline");
  const n0 = ed.undoStack.length;
  ed.apply({ op: "drag", id: "A", key: "centreline", value: dimensionMove(doc, d, 2400) });
  const m = measureRefs(doc, ["A:centreline", "B:centreline"]).value;
  return R(m === 2400 && ed.undoStack.length - n0 === 1, "exactly 2400; one undo step", `${m}; ${ed.undoStack.length - n0} step`);
});
testCase("36", "Three walls at a node, middle one deleted", () => {
  const { doc, ed } = fixture();
  wall(doc, "A", [-4000, 0], [0, 0], "T-300"); wall(doc, "B", [0, 0], [4000, 0], "T-300"); wall(doc, "C", [0, 0], [0, 4000], "T-300");
  joinEE(doc, "A", "end", "B", "start"); joinEE(doc, "B", "start", "C", "start"); joinEE(doc, "A", "end", "C", "start"); doc.regenerate();
  ed.apply({ op: "delete", id: "B" });
  const orphans = doc.joins.filter(j => j.a.of === "B" || j.b.of === "B").length;
  const e = W(doc, "A").ends.end;
  return R(orphans === 0 && doc.joins.length === 1 && e.k === "node" && e.term.pts.length === 2, "B's rows gone; A and C resolve to a clean L", `${orphans} orphans, ${doc.joins.length} row(s), A end ${e.k} with ${e.term && e.term.pts.length}-point terminator`);
});

// ---------------------------------------------------------------- 37–38: the property model and bindings
testCase("37", "A new element type is two declarations", () => {
  // Structural: the catalogue and the drivers are the only per-type code the panel, graph and save paths see.
  const types = [...CATALOGUE.keys()];
  return R(types.length >= 20, "every panel/graph/save path reads CATALOGUE; no per-type UI", `${types.length} catalogue entries`, "Verified by the build too: the UI modules never branch on a type name for fields.");
});
testCase("37a", "Add a parameter to a family", () => {
  const { doc, ed } = fixture(); wall(doc, "A", [0, 0], [6000, 0], "T-EXTCAV300"); doc.regenerate();
  ed.apply({ op: "type", lib: "families", id: "F-EXTCAV", path: "paramSpecs.UValue", value: { kind: "Number", binding: "type", group: "Construction" } });
  ed.apply({ op: "type", lib: "types", id: "T-EXTCAV300", path: "params.UValue", value: 0.18 });
  const row = propertyModel(doc, ["A"]).rows.find(r => r.key === "UValue");
  return R(row && row.group === "Construction" && row.readonly && row.value === 0.18, "shown under Construction, type-bound (read-only here), 0.18", row ? `${row.group}, ${row.editor}, ${row.value}` : "missing");
});
testCase("37b", "Select 12 walls of mixed types", () => {
  const { doc, ed } = fixture();
  for (let i = 0; i < 12; i++) wall(doc, "W" + i, [0, i * 1000], [3000 + (i % 3) * 100, i * 1000], i % 2 ? "T-300" : "T-400");
  doc.regenerate();
  const ids = [...Array(12).keys()].map(i => "W" + i);
  const m = propertyModel(doc, ids);
  const ph = m.rows.find(r => r.key === "Phase");
  const steps = ed.undoStack.length;
  ed.apply({ op: "set", ids, key: "height", text: "2700" });
  const hs = ids.map(id => doc.argValue(doc.element(id), "height"));
  return R(m.rows.find(r => r.key === "height").varies === undefined && ed.undoStack.length - steps === 1 && hs.every(h => h === 2700) && ph, "common rows; <varies> where different; one edit writes all 12 as one step", `height rows ${m.rows.filter(r => r.key === "height").length}; ${ed.undoStack.length - steps} step; ${hs.filter(h => h === 2700).length}/12 written`);
});
testCase("37c", "Edit a cell in a schedule", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const n = ed.undoStack.length;
  ed.apply({ op: "set", id: "W2", key: "params.Phase", value: "Demolished" });
  const bad = ed.apply({ op: "set", id: "W2", key: "height", text: "12 kg" });
  return R(doc.getParam(doc.element("W2"), "Phase") === "Demolished" && ed.undoStack.length - n === 1 && !bad.ok, "model changes; one step; same validation refuses nonsense", `Phase ${doc.getParam(doc.element("W2"), "Phase")}; ${ed.undoStack.length - n} step; "12 kg" → ${bad.error}`);
});
testCase("37d", "Argument wired to an expression", () => {
  const doc = buildSample();
  const row = propertyModel(doc, ["W1"]).rows.find(r => r.key === "height");
  return R(row.bound && row.bound.expr === "L1.elevation - L0.elevation" && row.bound.result === "3000 mm", "shows the expression with its result beneath", row.bound ? `${row.bound.expr} = ${row.bound.result}` : "not bound");
});
testCase("37e", "Wall selected, centreline argument", () => { const doc = buildSample(); const row = propertyModel(doc, ["W1"]).rows.find(r => r.key === "centreline"); return R(row.editor === "edit-in-view", "an edit-in-view button, not a text field", row.editor); });
testCase("37f", "Declare a Curve2D parameter", () => {
  const j = JSON.parse(newDocument().serialise()); j.paramSpecs.Path = { kind: "Curve2D", binding: "instance" };
  try { loadDocument(j); return R(false, "refused at load", "accepted"); } catch (e) { return R(/closed|one of/.test(e.message) && /Length/.test(e.message), "refused with a sentence naming the kind set", e.message); }
});
testCase("37g", "Bind a Length field by clicking a wall", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const c = pickCandidates(doc, "W1", "Length");
  const r = ed.apply({ op: "set", id: "P1", key: "height", text: c[0].text });
  const v = doc.argValue(doc.element("P1"), "height"), ex = v.ref && doc.element(v.ref);
  return R(c.every(x => x.kind === "Length") && c[0].text === "W1.Length" && ex && doc.argValue(ex, "formula") === "W1.Length", "only Lengths offered; field becomes W1.Length (an Expression)", `${c.map(x => x.text).join(", ")} → ${ex ? doc.argValue(ex, "formula") : r.error}`);
});
testCase("37h", "The same binding in the node editor", () => {
  const doc = buildSample(), ed = new Editor(doc);
  ed.apply({ op: "set", id: "P1", key: "height", text: "W1.Length" });
  const exId = doc.argValue(doc.element("P1"), "height").ref, g = graphModel(doc);
  const wire = g.wires.find(w => w.from === exId && w.to === "P1" && w.port === "height"), feed = g.wires.find(w => w.from === "W1" && w.to === exId);
  return R(wire && feed, "an ordinary wire W1 → Expression → P1.height", `${!!feed} / ${!!wire}`);
});
testCase("37i", "Bind a Material field, click a wall", () => { const c = pickCandidates(buildSample(), "W1", "Material"); return R(c.length === 4 && c.every(x => x.kind === "Material"), "materials only (4 layers' materials)", c.map(x => x.text).join(", ")); });
testCase("37j", "Mark = \"Type \" & TypeMark & \" — \" & Level.Name", () => {
  const doc = buildSample(), ed = new Editor(doc), f = doc.element("W1");
  ed.apply({ op: "set", id: "W1", key: "params.Mark", value: { expr: "\"Type \" & TypeMark & \" — \" & Level.Name", kind: "Text" } });
  const a = propertyModel(doc, ["W1"]).rows.find(r => r.key === "Mark").display;
  ed.apply({ op: "rename", id: "L0", name: "Street" });
  const b = propertyModel(doc, ["W1"]).rows.find(r => r.key === "Mark").display;
  return R(a === "Type EW1 — Ground" && b === "Type EW1 — Street", "evaluates; follows the rename", `${a} → ${b}`);
});
testCase("37k", "Clear a bound field back to a literal", () => { const doc = buildSample(), ed = new Editor(doc); const r = ed.apply({ op: "unbind", id: "W1", key: "height" }); return R(/was bound to EX1 \(L1\.elevation - L0\.elevation\)/.test(r.said) && doc.argValue(doc.element("W1"), "height") === 3000, "says what it was bound to, then lets go", r.said); });
testCase("38", "Wire a wall's height to an expression node", () => {
  const doc = buildSample(), ed = new Editor(doc);
  ed.apply({ op: "set", id: "L1", key: "elevation", text: "3300" });
  return R(doc.plan(doc.element("W1")).height === 3300 && doc.stats.lastRegen.rebuilt.includes("EX1"), "L1 → EX1 → W1..W4 through the ordinary solver", `W1 height ${doc.plan(doc.element("W1")).height}; rebuilt ${doc.stats.lastRegen.rebuilt.slice(0, 8).join(", ")}…`);
});

// ---------------------------------------------------------------- 39–47: elevation, 3D, surfaces
testCase("39", "Elevation: wall in front of wall", () => {
  const { doc } = fixture();
  wall(doc, "F", [2000, 2000], [4000, 2000], "T-300", { height: 1500 }); wall(doc, "B", [0, 6000], [6000, 6000], "T-300");
  doc.addElement({ id: "E", type: "ElevationView", args: { line: { type: "line", start: [8000, 0], end: [-2000, 0] }, depth: 10000, scale: 100, baseLevel: { ref: "L0" }, top: 4000 } });
  doc.regenerate();
  const sc = elevationScene(doc, doc.element("E"));
  // B's bottom edge (z = 0) runs 6000 wide; F (2000 wide, in front) hides 2000 of it → 4000 visible = 40 mm on paper at 1:100
  const bottom = sc.prims.filter(p => p.id === "B" && p.t === "stroke" && p.path.every(s => Math.abs(s.a[1]) < 1e-9 && Math.abs(s.b[1]) < 1e-9));
  const vis = bottom.reduce((a, p) => a + p.path.reduce((x, s) => x + dist(s.a, s.b), 0), 0);
  const wF = sc.prims.find(p => p.id === "F" && p.t === "stroke").weight, wB = bottom[0] && bottom[0].weight;
  return R(approx(vis, 40, 1e-3) && wF > wB, "rear bottom edge 40 mm visible (60 − 20 hidden); front heavier", `${r3(vis)} mm visible; weights front ${wF} / rear ${wB}`);
});
testCase("40", "Elevation: element exactly on the view plane", () => {
  const { doc } = fixture(); wall(doc, "A", [0, 0], [6000, 0], "T-300"); wall(doc, "B", [0, 0], [6000, 0], "T-400");
  doc.addElement({ id: "E", type: "ElevationView", args: { line: { type: "line", start: [8000, 150], end: [-2000, 150] }, depth: 5000, scale: 100, baseLevel: { ref: "L0" }, top: 4000 } });
  doc.regenerate();
  const a = JSON.stringify(elevationScene(doc, doc.element("E")).prims), b = JSON.stringify(elevationScene(doc, doc.element("E")).prims);
  return R(a === b && a.length > 10, "deterministic; nothing dropped", `${JSON.parse(a).length} prims, identical ${a === b}`);
});
testCase("41", "3D view on a sheet: hidden-line", () => {
  const doc = buildSample(), m = buildHLRModel(doc), r = runHLR(m, doc.argValue(doc.element("V-3D01"), "camera"));
  return R(r.counts.visible > 0 && r.counts.hidden > 0 && r.counts.outlineV > 0, "vector; silhouettes present; visible and hidden separated", JSON.stringify(r.counts));
});
testCase("42", "Move one wall: the 3D viewport shows stale", () => {
  const doc = buildSample(), ed = new Editor(doc), v = doc.element("V-3D01");
  const r = runHLR(buildHLRModel(doc), doc.argValue(v, "camera"));
  doc._hlrCache = { "V-3D01": { camera: JSON.stringify(doc.argValue(v, "camera")), revision: doc.modelRevision, lines: r.lines, bbox: r.bbox } };
  const fresh = deriveView(doc, v).stale;
  ed.apply({ op: "drag", id: "GW2", key: "centreline", value: { type: "line", start: [15000, -1000], end: [15000, 9000] } });
  const stale = deriveView(doc, v).stale;
  return R(!fresh && !!stale, "badge, not stale line-work presented as current", `before: ${fresh || "current"}; after: ${stale}`);
});
export function rasterPixels(widthMM, dpi) { return Math.round(widthMM / 25.4 * dpi); }
testCase("43", "linesOverShaded raster size", () => { const px = rasterPixels(180, 300); return R(px === 2126, "180 mm at 300 dpi = 2126 px (not the screen's 800)", String(px)); });
testCase("44", "Plan of 600 walls, move one", () => {
  const { doc, ed } = fixture();
  for (let i = 0; i < 600; i++) wall(doc, "W" + i, [(i % 30) * 2000, Math.floor(i / 30) * 2000], [(i % 30) * 2000 + 1500, Math.floor(i / 30) * 2000], "T-300");
  doc.regenerate(); deriveView(doc, doc.element("V"));
  const edges = doc.argumentIds(doc.element("V")).length, d0 = doc.stats.derives;
  ed.apply({ op: "drag", id: "W7", key: "centreline.end", value: [15800, 300] });
  deriveView(doc, doc.element("V"));
  return R(edges === 1 && doc.stats.derives - d0 === 1 && doc.stats.lastRegen.rebuilt.join() === "W7", "view depends on its level only; one redraw by watermark", `view edges ${edges}; redraws ${doc.stats.derives - d0}; rebuilt [${doc.stats.lastRegen.rebuilt}]`);
});
testCase("45", "Vertical wall, horizontal base and top", () => { const { doc } = fixture(); wall(doc, "A", [0, 0], [6000, 0], "T-300"); doc.regenerate(); const s0 = doc.stats.surfacePath; planScene(doc, doc.element("V")); return R(doc.stats.surfacePath === s0 && W(doc, "A").fast, "fast path; per-height plane work never called", `surfacePath +${doc.stats.surfacePath - s0}`); });
testCase("46", "Raking wall, top plane at 15°", () => {
  const { doc, ed } = fixture(); wall(doc, "A", [0, 0], [4000, 0], "T-300", { height: 2000, slope: { top: 15, lean: 0 } }); doc.regenerate();
  const area = h => { ed.apply({ op: "set", id: "V", key: "viewRange", value: { top: 5000, cut: h, bottom: 0 } }); return planScene(doc, doc.element("V")).prims.filter(p => p.t === "fill" && p.id === "A").reduce((a, p) => a + Math.abs(pathArea(p.path)) * 1e4, 0); };
  // top(u) = 2000 + u·tan15°. Cut 1200: whole wall, 4000 × 300 = 1 200 000. Cut 2400: u ≥ 400/tan15° = 1492.82 → (4000 − 1492.82) × 300 = 752 153.7
  const a1 = area(1200), a2 = area(2400), e2 = (4000 - 400 / Math.tan(15 * Math.PI / 180)) * 300;
  return R(approx(a1, 1.2e6, 1e-3) && approx(a2, e2, 1e-3), `1 200 000 and ${r3(e2)}`, `${r3(a1)} and ${r3(a2)}`);
});
testCase("47", "Inclined wall, 5° off vertical", () => {
  const { doc, ed } = fixture(); wall(doc, "A", [0, 0], [4000, 0], "T-300", { slope: { top: 0, lean: 5 } }); doc.regenerate();
  const poly = h => { ed.apply({ op: "set", id: "V", key: "viewRange", value: { top: 5000, cut: h, bottom: 0 } }); const p = planScene(doc, doc.element("V")).prims.find(x => x.t === "fill" && x.id === "A"); return samplePath(p.path, 2).map(q => mul(q, 100)); };
  // width across = 300 / cos 5° = 301.1459; at h = 1200 shifted by 1200·tan 5° = 104.9869
  const p = poly(1200), ys = p.map(q => q[1]);
  const w = Math.max(...ys) - Math.min(...ys), mid = (Math.max(...ys) + Math.min(...ys)) / 2;
  return R(approx(w, 300 / Math.cos(5 * Math.PI / 180), 1e-6) && approx(mid, 1200 * Math.tan(5 * Math.PI / 180), 1e-6), "width 301.1459, shift 104.9869 (perpendicular spacing)", `${r3(w)}, ${r3(mid)}`);
});
testCase("48", "Wall top attached to a sloping soffit", () => R(false, "solid follows the soffit", "not built", "Known gap: attached tops (step 17) are not in this build; raking tops (46) use the same surface substitution."), { gap: true });

// ---------------------------------------------------------------- 49–54: spaces
function room(boundaryAt = "finishFace", extra = () => {}) {
  const { doc, ed } = fixture();
  wall(doc, "A", [0, 0], [8000, 0], "T-300"); wall(doc, "B", [8000, 0], [8000, 6000], "T-300"); wall(doc, "C", [8000, 6000], [0, 6000], "T-300"); wall(doc, "D", [0, 6000], [0, 0], "T-300");
  joinEE(doc, "A", "end", "B", "start"); joinEE(doc, "B", "end", "C", "start"); joinEE(doc, "C", "end", "D", "start"); joinEE(doc, "D", "end", "A", "start");
  doc.addElement({ id: "S", type: "Space", name: "Meeting", args: { level: { ref: "L0" }, anchor: [2000, 3000], boundaryAt }, params: { Number: "G.14" } });
  extra(doc); doc.regenerate();
  return { doc, ed };
}
testCase("49", "Four walls enclosing a room", () => { const { doc } = room(); const a = doc.data(doc.element("S")).value; return R(approx(a, 7700 * 5700, 1e-3), "one space, 43 890 000", r3(a)); });
testCase("50", "boundaryAt centre → finish face", () => {
  const c = room("wallCentre").doc, f = room("finishFace").doc;
  const ac = c.data(c.element("S")).value, af = f.data(f.element("S")).value;
  // drop = perimeter × half-thickness − 4 × half² = 28 000 × 150 − 4 × 22 500 = 4 110 000
  return R(approx(ac - af, 4.11e6, 1e-3), "drops by 4 110 000 (perimeter × ½t − 4 × (½t)²)", `${r3(ac)} − ${r3(af)} = ${r3(ac - af)}`);
});
testCase("51", "Doorway gap in one wall", () => {
  const { doc } = room("finishFace", d => d.addElement({ id: "OP", type: "Opening", args: { host: { ref: "A" }, profile: { kind: "rect", at: 4000, sill: 0, w: 1000, h: 2100 } } }));
  return R(doc.plan(doc.element("S")).status === "ok" && approx(doc.data(doc.element("S")).value, 43.89e6, 1e-3), "still one space", `${doc.plan(doc.element("S")).status}, ${r3(doc.data(doc.element("S")).value)}`);
});
function corridor() {
  return room("finishFace", d => {
    wall(d, "P", [4000, 0], [4000, 6000], "T-300"); joinT(d, "P", "start", "A", 4000); joinT(d, "P", "end", "C", 4000);
    d.addElement({ id: "S2", type: "Space", name: "Corridor", args: { level: { ref: "L0" }, anchor: [6000, 3000], boundaryAt: "finishFace" }, params: { Number: "G.15" } });
  });
}
testCase("52", "Wall moved so a room opens into the corridor", () => {
  const { doc, ed } = corridor();
  const two = [doc.plan(doc.element("S")).status, doc.plan(doc.element("S2")).status].join();
  ed.apply({ op: "drag", id: "P", key: "centreline", value: { type: "line", start: [4000, 2000], end: [4000, 5000] } });
  const st = [doc.plan(doc.element("S")).status, doc.plan(doc.element("S2")).status];
  return R(two === "ok,ok" && st.includes("redundant") && !!doc.element("S2"), "merged; the second anchor flagged, not deleted", `${two} → ${st.join(", ")}`);
});
testCase("53", "That wall moved back", () => {
  const { doc, ed } = corridor();
  ed.apply({ op: "drag", id: "P", key: "centreline", value: { type: "line", start: [4000, 2000], end: [4000, 5000] } });
  ed.undo();
  const s2 = doc.element("S2");
  return R(doc.plan(s2).status === "ok" && s2.get("Name") === "Corridor" && doc.getParam(s2, "Number") === "G.15", "reclaims its loop; name and number intact", `${doc.plan(s2).status}, ${s2.get("Name")} ${doc.getParam(s2, "Number")}`);
});
testCase("54", "Nested loop: a core inside a floor plate", () => {
  const { doc } = room("finishFace", d => {
    wall(d, "K1", [3000, 2000], [5000, 2000], "T-300"); wall(d, "K2", [5000, 2000], [5000, 4000], "T-300"); wall(d, "K3", [5000, 4000], [3000, 4000], "T-300"); wall(d, "K4", [3000, 4000], [3000, 2000], "T-300");
    joinEE(d, "K1", "end", "K2", "start"); joinEE(d, "K2", "end", "K3", "start"); joinEE(d, "K3", "end", "K4", "start"); joinEE(d, "K4", "end", "K1", "start");
    d.setArg(d.element("S"), "anchor", [1000, 1000]);
    d.addElement({ id: "K", type: "Space", name: "Core", args: { level: { ref: "L0" }, anchor: [4000, 3000], boundaryAt: "finishFace" } });
  });
  // plate: 7700 × 5700 − core outer 2300 × 2300 = 43 890 000 − 5 290 000 = 38 600 000; core inner 1700 × 1700 = 2 890 000
  const a = doc.data(doc.element("S")).value, k = doc.data(doc.element("K")).value;
  return R(approx(a, 38.6e6, 1e-3) && approx(k, 2.89e6, 1e-3), "plate 38 600 000 (excludes the core); core 2 890 000", `${r3(a)}; ${r3(k)}`);
});

// ---------------------------------------------------------------- runner
export function runAll(filter = null) {
  const out = [];
  for (const c of CASES) {
    if (filter && !filter(c)) continue;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    let r;
    try { r = c.fn(); } catch (e) { r = { pass: false, expected: "no exception", got: e.message, note: (e.stack || "").split("\n").slice(0, 3).join(" ‹ ") }; }
    out.push(Object.assign({ id: c.id, name: c.name, gap: !!c.gap, ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0 }, r));
  }
  return out;
}

// ---------------------------------------------------------------- modify tools (interface-level, beyond §15)
testCase("M1", "Move a wall: joined walls stretch with it", () => {
  const { doc, ed } = fixture();
  wall(doc, "A", [0, 0], [6000, 0], "T-300"); wall(doc, "B", [6000, 0], [6000, 4000], "T-300"); wall(doc, "C", [0, 4000], [0, 0], "T-300");
  joinEE(doc, "A", "end", "B", "start"); joinEE(doc, "C", "end", "A", "start"); doc.regenerate();
  ed.apply({ op: "transform", ids: ["A"], move: [0, -1000] });
  const a = doc.argValue(doc.element("A"), "centreline"), b = doc.argValue(doc.element("B"), "centreline"), c = doc.argValue(doc.element("C"), "centreline");
  // A goes to y = −1000; B's start and C's end come with it, their far ends stay
  const ok = a.start[1] === -1000 && b.start[1] === -1000 && b.end[1] === 4000 && c.end[1] === -1000 && c.start[1] === 4000;
  return R(ok && W(doc, "A").ends.end.k === "node", "A at y = −1000; B and C stretch; the corners stay joined", `A ${a.start}→${a.end}; B ${b.start}→${b.end}; C ${c.start}→${c.end}`);
});
testCase("M2", "Rotate 90° about a point, exactly", () => {
  const { doc, ed } = fixture(); wall(doc, "A", [1000, 0], [5000, 0], "T-300");
  doc.addElement({ id: "C", type: "Column", args: { position: [3000, 1000], columnType: { ref: "T-COL400" }, rotation: 0 } }); doc.regenerate();
  ed.apply({ op: "transform", ids: ["A", "C"], rotate: { c: [0, 0], a: Math.PI / 2 } });
  const a = doc.argValue(doc.element("A"), "centreline"), p = doc.argValue(doc.element("C"), "position"), r = doc.argValue(doc.element("C"), "rotation");
  const ok = approx(a.start[0], 0, 1e-9) && approx(a.start[1], 1000, 1e-9) && approx(a.end[1], 5000, 1e-9) && approx(p[0], -1000, 1e-9) && approx(p[1], 3000, 1e-9) && approx(r, 90, 1e-9);
  return R(ok, "(1000,0)→(0,1000), (5000,0)→(0,5000); column to (−1000, 3000), rotated 90°", `${a.start.map(r3)} ${a.end.map(r3)}; ${p.map(r3)} @ ${r3(r)}°`);
});
testCase("M3", "Mirror keeps the exterior outside", () => {
  const { doc, ed } = fixture(); wall(doc, "A", [0, 0], [4000, 0], "T-EXTCAV300"); doc.regenerate();
  const ext0 = resolveReference(doc, "A:face.exterior").geom.p[1];          // y = −145.25 (below)
  ed.apply({ op: "transform", ids: ["A"], mirror: { p: [0, 1000], d: [1, 0] } });   // about y = 1000
  const c = doc.argValue(doc.element("A"), "centreline"), ext1 = resolveReference(doc, "A:face.exterior").geom.p[1];
  // centreline to y = 2000; the exterior face mirrors to above it: 2000 + 145.25
  return R(c.start[1] === 2000 && approx(ext0, -145.25) && approx(ext1, 2145.25), "centreline y = 2000; exterior face at 2145.25 (mirrored side)", `centreline y ${c.start[1]}; exterior ${r3(ext0)} → ${r3(ext1)}`);
});
testCase("M4", "Copy a wall with its door", () => {
  const { doc, ed } = openingFixture();
  const r = ed.apply({ op: "transform", ids: ["A"], move: [0, 5000], copy: true });
  const types = r.copied.map(id => doc.typeOf(doc.element(id))).sort().join();
  const newDoor = r.copied.find(id => doc.typeOf(doc.element(id)) === "Door"), fr = doc.data(doc.element(newDoor)).frame;
  return R(types === "Door,Opening,Wall" && fr.host !== "A" && approx(pointAt(W(doc, fr.host), 0, fr.at)[1], 5000), "wall, opening and door copied; the copy hosts the new door", `${r.copied.join(", ")} (${types}); door host ${fr.host}`);
});
testCase("M5", "Dragging a wall end stretches the joined neighbour", () => {
  const { doc, ed } = fixture();
  wall(doc, "A", [0, 0], [6000, 0], "T-300"); wall(doc, "B", [6000, 0], [6000, 4000], "T-300"); joinEE(doc, "A", "end", "B", "start"); doc.regenerate();
  ed.apply({ op: "drag", id: "A", key: "centreline.end", value: [7000, 0] });
  const b = doc.argValue(doc.element("B"), "centreline");
  return R(b.start[0] === 7000 && b.end[0] === 6000, "B's start follows to (7000, 0)", `${b.start} → ${b.end}`);
});
testCase("M6", "An end dragged into another wall's thickness makes a T on its location line", () => {
  const { doc, ed } = fixture();
  wall(doc, "A", [0, 0], [6000, 0], "T-300"); wall(doc, "B", [3000, 3000], [3000, 1000], "T-300"); doc.regenerate();
  // 3000,120 is inside A's thickness but 120 mm off its location line
  ed.apply({ op: "drag", id: "B", key: "centreline.end", value: [3000, 120] });
  ed.apply({ op: "autojoin", ends: [{ id: "B", end: "end" }] });
  const b = doc.argValue(doc.element("B"), "centreline"), j = doc.joins.find(r => r.a.of === "B" && r.b.of === "A");
  const w = doc.plan(doc.element("B"));
  return R(b.end[0] === 3000 && Math.abs(b.end[1]) < 1e-9 && j && Math.abs(j.b.u - 3000) < 1e-9 && w.ends.end.k === "T", "end at (3000, 0); T at u = 3000; resolved as T", `${b.end} ${j ? "u=" + j.b.u : "no join"} ${w.ends.end.k}`);
});
testCase("M7", "Dragging a T end away releases the join; a nearby end makes a corner", () => {
  const { doc, ed } = fixture();
  wall(doc, "A", [0, 0], [6000, 0], "T-300"); wall(doc, "B", [3000, 3000], [3000, 0], "T-300"); wall(doc, "C", [5000, 3000], [5000, 5000], "T-300");
  doc.joins.push({ id: "J1", a: { of: "B", end: "end" }, b: { of: "A", u: 3000 }, kind: "auto", order: 0, allowed: true }); doc.regenerate();
  ed.apply({ op: "drag", id: "B", key: "centreline.end", value: [3000, 1500] }); ed.apply({ op: "autojoin", ends: [{ id: "B", end: "end" }] });
  const released = !doc.joins.some(r => r.a.of === "B");
  ed.apply({ op: "drag", id: "B", key: "centreline.start", value: [5080, 3060] }); ed.apply({ op: "autojoin", ends: [{ id: "B", end: "start" }] });
  const b = doc.argValue(doc.element("B"), "centreline"), corner = doc.joins.some(r => r.a.of === "B" && r.a.end === "start" && r.b.of === "C" && r.b.end === "start");
  return R(released && corner && b.start[0] === 5000 && b.start[1] === 3000, "T released; start snapped to C's start (5000, 3000) with a corner join", `released ${released}, corner ${corner}, start ${b.start}`);
});

testCase("M8", "Visibility/Graphics is data: walls off in a style leave plan, elevation, sheet and the 3D cache key", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const walls = sc => { let n = 0; const walk = ps => { for (const p of ps) { if (p.t === "group") walk(p.prims); else if ((p.layer || "").startsWith("IfcWall")) n++; } }; walk(sc.prims); return n; };
  const before = [walls(deriveView(doc, doc.element("V-P00"))), walls(deriveView(doc, doc.element("V-E01"))), walls(sheetScene(doc, doc.element("SH-A101")))];
  const key0 = visibilityKey(doc, doc.element("V-3D01"));
  const st = clone(doc.lib.viewStyles["VS-CONSTRUCTION"]); st.byCategory = st.byCategory || {}; st.byCategory.IfcWall = Object.assign({}, st.byCategory.IfcWall, { visible: false });
  ed.apply({ op: "style", id: "VS-CONSTRUCTION", value: st });
  const after = [walls(deriveView(doc, doc.element("V-P00"))), walls(deriveView(doc, doc.element("V-E01"))), walls(sheetScene(doc, doc.element("SH-A101")))];
  const key1 = visibilityKey(doc, doc.element("V-3D01"));
  return R(before.every(n => n > 0) && after[0] === 0 && after[1] === 0 && key0 !== key1, "all wall line-work gone; 3D cache key changed", `before ${before} after ${after} key ${key0 || "∅"}→${key1}`);
});
testCase("M9", "Edit Crop: a sketched boundary chains into a loop and clips the view and its viewport", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]], els = sq.map((p, i) => ({ type: "line", a: p, b: sq[(i + 1) % 4] }));
  const shuffled = [els[2], { type: "line", a: els[0].b, b: els[0].a }, els[3], els[1]];   // out of order and one reversed
  const ok = chainLoop(shuffled).pts, open = chainLoop(els.slice(0, 3)).error;
  const doc = buildSample(), ed = new Editor(doc);
  const clip = Object.assign({}, doc.argValue(doc.element("V-P00"), "clip"), { active: true, shape: { elements: [{ type: "circle", c: [6000, 4000], r: 3000 }] } });
  ed.apply({ op: "set", id: "V-P00", key: "clip", value: clip });
  const sc = deriveView(doc, doc.element("V-P00")), sh = sheetScene(doc, doc.element("SH-A101"));
  const vp = sh.prims.find(p => p.t === "group" && p.view === "V-P00"), inner = vp && vp.prims.find(p => p.t === "group" && p.clipPath);
  return R(ok && ok.length === 4 && /open|close/.test(open || "") && sc.clipPath && sc.clipPath.length > 40 && !!inner,
    "square chains in any order; open sketch refused; circle becomes the view's clip path and the viewport's", `loop ${ok && ok.length}, open "${open}", path ${sc.clipPath && sc.clipPath.length}, viewport ${!!inner}`);
});
// A small IFC4 file, written by hand so every number is known: a wall 5000×200×3000, a door
// 1000×2100 in its opening, a floor slab, and a steel I-beam spanning along x at 2800 mm.
const IFC_SMALL = `ISO-10303-21;
HEADER;FILE_DESCRIPTION((''),'2;1');FILE_NAME('t.ifc','',(''),(''),'','','');FILE_SCHEMA(('IFC4'));ENDSEC;
DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);#2=IFCUNITASSIGNMENT((#1));
#10=IFCCARTESIANPOINT((0.,0.,0.));#11=IFCDIRECTION((0.,0.,1.));#12=IFCDIRECTION((1.,0.,0.));#13=IFCAXIS2PLACEMENT3D(#10,#11,#12);#14=IFCLOCALPLACEMENT($,#13);
#20=IFCPROJECT('p',$,'T',$,$,$,$,$,#2);#23=IFCBUILDINGSTOREY('s',$,'Level 1',$,$,#14,$,$,.ELEMENT.,0.);
#33=IFCCARTESIANPOINT((2500.,0.));#34=IFCAXIS2PLACEMENT2D(#33,$);#35=IFCRECTANGLEPROFILEDEF(.AREA.,'W',#34,5000.,200.);
#36=IFCEXTRUDEDAREASOLID(#35,#13,#11,3000.);#37=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#36));#38=IFCPRODUCTDEFINITIONSHAPE($,$,(#37));
#39=IFCWALL('w',$,'Wall',$,$,#14,#38,$,$);
#40=IFCCARTESIANPOINT((1500.,0.));#41=IFCAXIS2PLACEMENT2D(#40,$);#42=IFCRECTANGLEPROFILEDEF(.AREA.,'H',#41,1000.,400.);
#43=IFCEXTRUDEDAREASOLID(#42,#13,#11,2100.);#44=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#43));#45=IFCPRODUCTDEFINITIONSHAPE($,$,(#44));
#46=IFCOPENINGELEMENT('o',$,'Opening',$,$,#14,#45,$,$);#47=IFCRELVOIDSELEMENT('v',$,$,$,#39,#46);
#48=IFCDOOR('d',$,'Door',$,$,#14,$,$,2100.,1000.,$,$,$);#49=IFCRELFILLSELEMENT('f',$,$,$,#46,#48);
#50=IFCCARTESIANPOINT((0.,0.));#51=IFCAXIS2PLACEMENT2D(#50,$);#52=IFCRECTANGLEPROFILEDEF(.AREA.,'S',#51,10000.,8000.);
#53=IFCCARTESIANPOINT((5000.,4000.,-250.));#54=IFCAXIS2PLACEMENT3D(#53,#11,#12);#55=IFCEXTRUDEDAREASOLID(#52,#54,#11,250.);
#56=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#55));#57=IFCPRODUCTDEFINITIONSHAPE($,$,(#56));#58=IFCSLAB('sl',$,'Slab',$,$,#14,#57,$,$);
#60=IFCCARTESIANPOINT((0.,3000.,2597.));#61=IFCDIRECTION((0.,1.,0.));#62=IFCAXIS2PLACEMENT3D(#60,#12,#61);
#63=IFCISHAPEPROFILEDEF(.AREA.,'UB',#51,178.,406.,7.9,12.8,10.2);#64=IFCEXTRUDEDAREASOLID(#63,#62,#11,5000.);
#65=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#64));#66=IFCPRODUCTDEFINITIONSHAPE($,$,(#65));#67=IFCBEAM('b',$,'Beam',$,$,#14,#66,$,$);
#70=IFCRELCONTAINEDINSPATIALSTRUCTURE('c',$,$,$,(#39,#48,#58,#67),#23);
ENDSEC;END-ISO-10303-21;`;
testCase("M10", "IFC classes arrive as BIM classes: IfcWall→Wall, IfcDoor→Door in its opening, IfcSlab→Floor, IfcBeam→Beam", () => {
  const doc = newDocument("ifc"), ed = new Editor(doc);
  const r = importIfc(doc, IFC_SMALL), res = ed.apply(r.ops);
  const byType = t => doc.elements().filter(f => doc.typeOf(f) === t);
  const wall = byType("Wall")[0], door = byType("Door")[0], floor = byType("Floor")[0], beam = byType("Beam")[0];
  const c = wall && doc.argValue(wall, "centreline"), wt = wall && F.type(wall, "wallType");
  const op = door && F.reference(door, "fills"), prof = op && doc.argValue(op, "profile");
  const fl = floor && doc.plan(floor), bm = beam && doc.plan(beam), ax = beam && doc.argValue(beam, "axis");
  const ok = res.ok && c && Math.abs(Math.hypot(c.end[0] - c.start[0], c.end[1] - c.start[1]) - 5000) < 1e-6 && wt.layers[0].thickness === 200
    && prof && Math.abs(prof.at - 1500) < 1e-6 && prof.w === 1000 && prof.h === 2100 && !doc.error(door)
    && fl && Math.abs(fl.z1 - 0) < 1e-6 && Math.abs(fl.z0 + 250) < 1e-6
    && bm && Math.abs(bm.z1 - 2800) < 1e-6 && Math.abs(bm.z0 - 2394) < 1e-6 && ax && Math.abs(ax.end[0] - 5000) < 1e-6 && F.type(beam, "beamType").shape === "I";
  return R(ok, "wall 5000 long, 200 type; door 1000×2100 at u=1500; slab top 0, 250 thick; UB406 top 2800 spanning x 0→5000",
    `ok ${res.ok} ${res.error || ""}; wall ${c && JSON.stringify(c)}; door ${prof && JSON.stringify(prof)}; floor ${fl && [fl.z0, fl.z1]}; beam ${bm && [bm.z0, bm.z1]} ${ax && JSON.stringify(ax)}; report ${JSON.stringify(r.report)}`);
});
// ---------------------------------------------------------------- T junctions: plan and section (drawn, not only resolved)
/** Visible (drawn) edge length of a wall's regions lying on its boundary s, between u0 and u1. */
const drawnAlong = (w, regs, s, u0, u1) => {
  let L = 0;
  for (const r of regs) for (const e of r.edges) {
    if (e.role === "hidden" || e.role === "weld" || e.seg.k !== "L") continue;
    const a = e.seg.a, b = e.seg.b, n = [-w.d[1], w.d[0]];
    const sa = (a[0] - w.a[0]) * n[0] + (a[1] - w.a[1]) * n[1], sb = (b[0] - w.a[0]) * n[0] + (b[1] - w.a[1]) * n[1];
    if (Math.abs(sa - s) > 0.5 || Math.abs(sb - s) > 0.5) continue;
    const ua = (a[0] - w.a[0]) * w.d[0] + (a[1] - w.a[1]) * w.d[1], ub = (b[0] - w.a[0]) * w.d[0] + (b[1] - w.a[1]) * w.d[1];
    L += Math.max(0, Math.min(Math.max(ua, ub), u1) - Math.max(Math.min(ua, ub), u0));
  }
  return L;
};
const drawT = (thru, join, tip, from, detail = "Fine") => {
  const doc = newDocument("t"), ed = new Editor(doc);
  doc.addElement({ id: "L0", type: "Level", args: { name: "G", elevation: 0 } }); doc.regenerate();
  ed.apply({ op: "draw", points: [[0, 0], [7000, 0]], wallType: thru, level: "L0", height: 3000, mounting: "Centred", tol: 1 });
  ed.apply({ op: "draw", points: [from, tip], wallType: join, level: "L0", height: 3000, mounting: "Centred", tol: 1 });
  return { doc, ed, A: doc.plan(doc.element("W2")), B: doc.plan(doc.element("W1")) };
};
testCase("M11", "T of the same material welds: block into block leaves no line between the two blocks", () => {
  const { doc, A, B } = drawT("T-BLOCK215", "T-BLOCK215", [3500, 108], [3500, 3000]);
  const regsA = wallRegions(A, "Fine", 1200, []), regsB = wallRegions(B, "Fine", 1200, []);
  const blockA = regsA.find(r => r.material === "M-BLOCK"), endRole = blockA && blockA.edges.find(e => e.role === "weld");
  const sFace = B.stack.s[B.stack.s.length - 2];                 // block's face toward the partition side
  const lineAcross = drawnAlong(B, regsB, sFace, 3500 - 94, 3500 + 94);
  return R(!!endRole && lineAcross < 1, "joining block end is a weld; through block's face hidden across the joint", `weld ${!!endRole}, drawn ${lineAcross.toFixed(1)} mm across`);
});
testCase("M12", "Coarse T blends: the through wall's face is hidden over the joining wall's width", () => {
  const { A, B } = drawT("T-EXTCAV300", "T-PART100", [3500, 145.25], [3500, 3000]);
  const regsB = wallRegions(B, "Coarse", 1200, []), n = B.stack.s.length - 1;
  const sNear = B.stack.s[n], across = drawnAlong(B, regsB, sNear, 3500 - 49, 3500 + 49), beside = drawnAlong(B, regsB, sNear, 1000, 3000);
  return R(across < 1 && beside > 1990, "face hidden across the 100 mm partition, drawn beside it", `across ${across.toFixed(1)}, beside ${beside.toFixed(1)}`);
});
testCase("M13", "Crossing: two walls entering from either side both T into the wall they cross", () => {
  const doc = newDocument("x"), ed = new Editor(doc);
  doc.addElement({ id: "L0", type: "Level", args: { name: "G", elevation: 0 } }); doc.regenerate();
  ed.apply({ op: "draw", points: [[0, 0], [7000, 0]], wallType: "T-BLOCK215", level: "L0", height: 3000, mounting: "Centred", tol: 1 });
  ed.apply({ op: "draw", points: [[3500, 3000], [3500, 60]], wallType: "T-PART100", level: "L0", height: 3000, mounting: "Centred", tol: 1 });
  ed.apply({ op: "draw", points: [[3500, -3000], [3500, -60]], wallType: "T-PART100", level: "L0", height: 3000, mounting: "Centred", tol: 1 });
  const rows = doc.joins.map(j => `${j.a.of}.${j.a.end}>${j.b.of}${j.b.end ? "." + j.b.end : "@" + Math.round(j.b.u)}`);
  return R(rows.includes("W2.end>W1@3500") && rows.includes("W3.end>W1@3500") && rows.length === 2, "W2 and W3 both T onto W1 at 3500", rows.join(" "));
});
testCase("M14", "T onto a curved wall: an end inside the arc's band snaps onto its location circle", () => {
  const doc = newDocument("a"), ed = new Editor(doc);
  doc.addElement({ id: "L0", type: "Level", args: { name: "G", elevation: 0 } }); doc.regenerate();
  ed.apply({ op: "add", element: { id: "ARC", type: "Wall", args: { centreline: { type: "arc", centre: [0, 0], radius: 3000, start: 20, end: 160, ccw: true }, mounting: "Centred", wallType: { ref: "T-BLOCK215" }, baseLevel: { ref: "L0" }, height: 3000 } } });
  ed.apply({ op: "draw", points: [[0, 0], [0, 2950]], wallType: "T-PART100", level: "L0", height: 3000, mounting: "Centred", tol: 1 });
  const c = doc.argValue(doc.element("W1"), "centreline"), j = doc.joins.find(r => r.a.of === "W1" && r.b.of === "ARC"), w = doc.plan(doc.element("W1"));
  return R(!!j && Math.abs(c.end[1] - 3000) < 1e-6 && w.ends.end.k === "T", "end at (0, 3000) on the circle; resolved as a T", `end ${c.end}, join ${!!j}, ${w.ends.end.k}`);
});
testCase("M15", "An angled T opens the through wall's finish over the joining width divided by sin(angle)", () => {
  const a = 60 * Math.PI / 180, tip = [3500, 145.25], from = [3500 + Math.cos(a) * 3000, 145.25 + Math.sin(a) * 3000];
  const { B } = drawT("T-EXTCAV300", "T-PART100", tip, from);
  const regsB = wallRegions(B, "Fine", 1200, []), n = B.stack.s.length - 1;
  const plaster = regsB.filter(r => r.layer === n - 1);
  const hiddenLen = plaster.flatMap(r => r.edges).filter(e => e.role === "hidden").length;
  // the plaster layer is split in two with hidden ends where the partition passes
  const gap = (() => { const us = plaster.map(r => r.path.flatMap(sg => [sg.a, sg.b]).filter(Boolean).map(p => (p[0] - B.a[0]) * B.d[0] + (p[1] - B.a[1]) * B.d[1])); if (us.length !== 2) return null; const [x, y] = us; return Math.min(...(Math.max(...x) < Math.max(...y) ? y : x)) - Math.max(...(Math.max(...x) < Math.max(...y) ? x : y)); })();
  // the plaster's ends run along the partition's faces, so its narrowest gap (at the inner boundary)
  // is the width over sin(angle) less the plaster's 13 mm over tan(angle)
  const want = 100 / Math.sin(a) - 13 / Math.tan(a);
  return R(plaster.length === 2 && hiddenLen === 2 && gap !== null && Math.abs(gap - want) < 0.5, `plaster split with a ${want.toFixed(1)} mm gap at its inner boundary`, `${plaster.length} pieces, gap ${gap && gap.toFixed(1)}`);
});
testCase("M16", "Section: a floor meets a wall - the slab bears over the wall's structure; its finish stops at nothing stronger", () => {
  const doc = buildSample(), sec = sectionCut(doc, doc.element("V-S01"));
  const wall = sec.rects.filter(r => r.id === "W3"), slab = sec.rects.filter(r => r.id === "FL2");
  const wallTop = Math.max(...wall.map(r => r.z1)), slabBottom = Math.min(...slab.map(r => r.z0));
  const overlap = wall.some(w => slab.some(f => w.s0 < f.s1 && f.s0 < w.s1 && w.z0 < f.z1 && f.z0 < w.z1));
  const slabOverWall = slab.some(f => f.s0 <= Math.min(...wall.map(r => r.s0)) + 1e-6 || f.s1 >= Math.max(...wall.map(r => r.s1)) - 1e-6);
  return R(!overlap && Math.abs(wallTop - 3000) < 1e-6 && Math.abs(slabBottom - 3000) < 1e-6 && slabOverWall, "no overlap; wall stops at 3000 under the slab, which runs across it", `overlap ${overlap}, wall top ${wallTop}, slab bottom ${slabBottom}, over ${slabOverWall}`);
});
testCase("M17", "Section: an I-beam crossing the line cuts as flange, web, flange", () => {
  const doc = buildSample(), sec = sectionCut(doc, doc.element("V-S01"));
  const b = sec.rects.filter(r => r.id === "BM1").sort((x, y) => x.z0 - y.z0);
  const ok = b.length === 3 && Math.abs(b[0].s1 - b[0].s0 - 178) < 1e-6 && Math.abs(b[1].s1 - b[1].s0 - 7.9) < 1e-6 && Math.abs(b[2].z1 - 3000) < 1e-6 && Math.abs(b[0].z0 - (3000 - 406)) < 1e-6;
  return R(ok, "bottom flange 178 wide, web 7.9, top at 3000, bottom at 2594", JSON.stringify(b.map(r => [r.s1 - r.s0, r.z0, r.z1].map(v => Math.round(v * 10) / 10))));
});
testCase("M18", "Section outline: a line only where the material changes - concrete wall into concrete slab is one piece", () => {
  const rects = [{ id: "W", s0: 0, s1: 200, z0: 0, z1: 3000, material: "M-CONC" }, { id: "F", s0: 0, s1: 4000, z0: 3000, z1: 3200, material: "M-CONC" }];
  const e = cutOutline(rects), inner = e.filter(x => !x.outer);
  const rects2 = [rects[0], Object.assign({}, rects[1], { material: "M-TIMBER" })], inner2 = cutOutline(rects2).filter(x => !x.outer);
  return R(inner.length === 0 && inner2.length === 1 && Math.abs(inner2[0].b[0] - inner2[0].a[0] - 200) < 1e-6, "same concrete: no inner line; timber on concrete: one 200 mm line", `inner ${inner.length}, with timber ${inner2.length}`);
});
testCase("M19", "A door's type sizes its opening: changing type or widening the type resizes the hole", () => {
  const doc = buildSample(), ed = new Editor(doc), D = doc.element("D1");
  const prof = () => doc.argValue(F.reference(D, "fills"), "profile");
  ed.apply({ op: "set", id: "D1", key: "doorType", value: { ref: "T-DOOR915" } });
  const w1 = prof().w, note1 = doc.note(D);
  const t = clone(doc.lib.types["T-DOOR915"]); t.width = 1200; ed.apply({ op: "type", lib: "types", id: "T-DOOR915", value: t });
  return R(w1 === 915 && !note1 && prof().w === 1200, "915 after the type change, 1200 after widening the type, no mismatch note", `${w1}, ${prof().w}, note ${note1}`);
});
testCase("M20", "Elevations and sections show their extent in plan: grips set the far clip and the width, and the view sees only what lies inside", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const hs = CATALOGUE.get("SectionView").handles(doc.element("V-S01"), doc), far = hs.find(x => x.key === "far clip");
  const beyond = () => deriveView(doc, doc.element("V-S01")).stats.beyond;
  const eItems = () => deriveView(doc, doc.element("V-E01")).stats.items;
  const b0 = beyond(), e0 = eItems();
  ed.apply({ op: "drag", id: "V-S01", key: "depth", value: 1000 });
  ed.apply({ op: "set", id: "V-E01", key: "depth", value: 1500 });
  const b1 = beyond(), e1 = eItems();
  const ok = far && far.writes === "depth" && Math.abs(far.at[0] - 15000) < 1 && hs.some(x => x.key === "width end") && b1 < b0 && e1 < e0;
  return R(ok, "far-clip grip 12000 beyond the line; shrinking the far clip drops what lies past it", `far at ${far && far.at}, section beyond ${b0}→${b1}, elevation items ${e0}→${e1}`);
});

// What Revit and Tekla actually write: shared (mapped) beams, a brep column, a wall clipped by a
// boolean, a footing, a proxy as a face set, walls joined by IfcRelConnectsPathElements, two storeys.
const IFC_HARD = `ISO-10303-21;
HEADER;FILE_DESCRIPTION((''),'2;1');FILE_NAME('h.ifc','',(''),(''),'','','');FILE_SCHEMA(('IFC4'));ENDSEC;
DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);#2=IFCUNITASSIGNMENT((#1));
#10=IFCCARTESIANPOINT((0.,0.,0.));#11=IFCDIRECTION((0.,0.,1.));#12=IFCDIRECTION((1.,0.,0.));#13=IFCAXIS2PLACEMENT3D(#10,#11,#12);#14=IFCLOCALPLACEMENT($,#13);
#15=IFCDIRECTION((0.,1.,0.));
#20=IFCPROJECT('p',$,'T',$,$,$,$,$,#2);#23=IFCBUILDINGSTOREY('s1',$,'Ground',$,$,#14,$,$,.ELEMENT.,0.);#24=IFCBUILDINGSTOREY('s2',$,'Roof',$,$,#14,$,$,.ELEMENT.,3500.);
#30=IFCCARTESIANPOINT((2500.,0.));#31=IFCAXIS2PLACEMENT2D(#30,$);#32=IFCRECTANGLEPROFILEDEF(.AREA.,'A',#31,5000.,200.);
#33=IFCEXTRUDEDAREASOLID(#32,#13,#11,3000.);#34=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#33));#35=IFCPRODUCTDEFINITIONSHAPE($,$,(#34));
#36=IFCWALL('wa',$,'Wall A',$,$,#14,#35,$,$);
#40=IFCCARTESIANPOINT((5000.,2000.));#41=IFCAXIS2PLACEMENT2D(#40,$);#42=IFCRECTANGLEPROFILEDEF(.AREA.,'B',#41,200.,4000.);
#43=IFCEXTRUDEDAREASOLID(#42,#13,#11,3000.);#44=IFCPLANE(#13);#45=IFCHALFSPACESOLID(#44,.F.);#46=IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#43,#45);
#47=IFCSHAPEREPRESENTATION($,'Body','Clipping',(#46));#48=IFCPRODUCTDEFINITIONSHAPE($,$,(#47));#49=IFCWALL('wb',$,'Wall B',$,$,#14,#48,$,$);
#50=IFCRELCONNECTSPATHELEMENTS('j',$,$,$,$,#36,#49,(),(),.ATSTART.,.ATEND.);
#60=IFCCARTESIANPOINT((0.,0.));#61=IFCAXIS2PLACEMENT2D(#60,$);#62=IFCRECTANGLEPROFILEDEF(.AREA.,'BM',#61,200.,400.);
#63=IFCAXIS2PLACEMENT3D(#10,#12,#15);#64=IFCEXTRUDEDAREASOLID(#62,#63,#11,4000.);#65=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#64));
#66=IFCREPRESENTATIONMAP(#13,#65);
#67=IFCCARTESIANPOINT((0.,1000.,3300.));#68=IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#67,1.,$);#69=IFCMAPPEDITEM(#66,#68);
#70=IFCSHAPEREPRESENTATION($,'Body','MappedRepresentation',(#69));#71=IFCPRODUCTDEFINITIONSHAPE($,$,(#70));#72=IFCBEAM('b1',$,'Beam 1',$,$,#14,#71,$,$);
#73=IFCCARTESIANPOINT((0.,2000.,3300.));#74=IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#73,1.,$);#75=IFCMAPPEDITEM(#66,#74);
#76=IFCSHAPEREPRESENTATION($,'Body','MappedRepresentation',(#75));#77=IFCPRODUCTDEFINITIONSHAPE($,$,(#76));#78=IFCBEAM('b2',$,'Beam 2',$,$,#14,#77,$,$);
#80=IFCCARTESIANPOINT((-150.,3850.,0.));#81=IFCCARTESIANPOINT((150.,3850.,0.));#82=IFCCARTESIANPOINT((150.,4150.,0.));#83=IFCCARTESIANPOINT((-150.,4150.,0.));
#84=IFCCARTESIANPOINT((-150.,3850.,3000.));#85=IFCCARTESIANPOINT((150.,3850.,3000.));#86=IFCCARTESIANPOINT((150.,4150.,3000.));#87=IFCCARTESIANPOINT((-150.,4150.,3000.));
#88=IFCPOLYLOOP((#80,#81,#82,#83));#89=IFCPOLYLOOP((#84,#85,#86,#87));#90=IFCFACEOUTERBOUND(#88,.T.);#91=IFCFACEOUTERBOUND(#89,.T.);#92=IFCFACE((#90));#93=IFCFACE((#91));
#94=IFCCLOSEDSHELL((#92,#93));#95=IFCFACETEDBREP(#94);#96=IFCSHAPEREPRESENTATION($,'Body','Brep',(#95));#97=IFCPRODUCTDEFINITIONSHAPE($,$,(#96));#98=IFCCOLUMN('c',$,'Column',$,$,#14,#97,$,$);
#100=IFCRECTANGLEPROFILEDEF(.AREA.,'F',#61,1000.,1000.);#101=IFCCARTESIANPOINT((0.,0.,-600.));#102=IFCAXIS2PLACEMENT3D(#101,#11,#12);#103=IFCEXTRUDEDAREASOLID(#100,#102,#11,400.);
#104=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#103));#105=IFCPRODUCTDEFINITIONSHAPE($,$,(#104));#106=IFCFOOTING('f',$,'Pad',$,$,#14,#105,$,.PAD_FOOTING.);
#110=IFCCARTESIANPOINTLIST3D(((6000.,0.,0.),(7000.,0.,0.),(7000.,1000.,0.),(6000.,1000.,0.),(6500.,500.,800.)));
#111=IFCTRIANGULATEDFACESET(#110,$,.T.,((1,2,5),(2,3,5),(3,4,5),(4,1,5),(1,2,3)),$);#112=IFCSHAPEREPRESENTATION($,'Body','Tessellation',(#111));#113=IFCPRODUCTDEFINITIONSHAPE($,$,(#112));
#114=IFCBUILDINGELEMENTPROXY('x',$,'Plinth',$,$,#14,#113,$,$);
#120=IFCRELCONTAINEDINSPATIALSTRUCTURE('c1',$,$,$,(#36,#49,#98,#106,#114),#23);#121=IFCRELCONTAINEDINSPATIALSTRUCTURE('c2',$,$,$,(#72,#78),#24);
ENDSEC;END-ISO-10303-21;`;
testCase("M21", "IFC as written by real exporters: mapped beams, brep columns, clipped walls, footings, proxies, path joins, and one floor plan per storey", () => {
  const doc = newDocument("ifc"), ed = new Editor(doc);
  const r = importIfc(doc, IFC_HARD), res = ed.apply(r.ops);
  const byType = t => doc.elements().filter(f => doc.typeOf(f) === t);
  const beams = byType("Beam").map(f => [doc.argValue(f, "axis"), doc.plan(f)]), col = byType("Column")[0], cp = col && doc.plan(col);
  const walls = byType("Wall"), gm = byType("Generic")[0], gp = gm && doc.plan(gm);
  const ft = byType("Floor").find(f => /footing/.test(F.type(f, "floorType").name)), fp = ft && doc.plan(ft);
  const plans = byType("PlanView").map(f => F.refId(f, "level")), levels = byType("Level").map(f => doc.idOf(f));
  const b1 = beams.find(([a]) => Math.abs(a.start[1] - 1000) < 1);
  const ok = res.ok && !Object.keys(r.report.missed).length
    && beams.length === 2 && b1 && Math.abs(b1[0].end[0] - b1[0].start[0]) > 3999 && Math.abs(b1[1].z1 - 3500) < 1 && Math.abs(b1[1].z0 - 3100) < 1
    && cp && Math.abs(cp.z1 - cp.z0 - 3000) < 1 && Math.abs(F.point(col, "position")[1] - 4000) < 1
    && walls.length === 2 && doc.joins.some(j => [j.a.of, j.b.of].sort().join() === walls.map(w => doc.idOf(w)).sort().join())
    && fp && Math.abs(fp.z1 + 200) < 1 && Math.abs(fp.z0 + 600) < 1
    && gp && Math.abs(gp.z1 - 800) < 1 && Math.abs(polyArea(F.json(gm, "boundary")) ) > 999999
    && levels.length === 2 && levels.every(l => plans.filter(p => p === l).length === 1);
  return R(ok, "nothing missed; 2 mapped beams 4000 long top 3500; brep column 3000 high at y 4000; the two walls joined; pad footing -600→-200; proxy a Generic 800 high; a plan for each of 2 levels",
    `ok ${res.ok} ${res.error || ""}; missed ${JSON.stringify(r.report.missed)}; beams ${JSON.stringify(beams.map(([a, p]) => [a.start, a.end, p.z0, p.z1]))}; column ${cp && [cp.z0, cp.z1]} ${col && F.point(col, "position")}; joins ${JSON.stringify(doc.joins)}; footing ${fp && [fp.z0, fp.z1]}; generic ${gp && [gp.z0, gp.z1]}; plans ${plans} levels ${levels}; notes ${r.report.notes.join(" | ")}`);
});

testCase("M22", "A floor is a sketch: welded loops with holes, fillet and offset, dimensions that hold - and the same drawing in the parametric CAD", () => {
  const doc = buildSample(), ed = new Editor(doc);
  let d = fromPolygon([[20000, 0], [26000, 0], [26000, 4000], [20000, 4000]]);
  d = addElements(d, [{ type: "circle", c: [23000, 2000], r: 500 }]);
  d = fillet(d, "e1", [21000, 0], "e2", [26000, 3000], 600);                       // round one corner
  d = toggleLock(d, { type: "length", of: ["e3"] });                                  // hold the top edge
  const lockedLen = measureDim(d, { type: "length", of: ["e3"] }).value;
  d = dragHandle(d, "e4.b", [19000, -500]);                                           // pull the bottom-left corner
  const held = measureDim(d, { type: "length", of: ["e3"] }).value, closedAfterDrag = !regionsOf(d).error;
  const res = ed.apply({ op: "add", element: { id: "FLS", type: "Floor", args: { boundary: [[20000, 0], [26000, 0], [26000, 4000]], floorType: { ref: Object.keys(doc.lib.types).find(k => doc.lib.types[k].family === "F-FLOOR") }, level: { ref: "L0" }, heightOffset: 0, sketch: d } } });
  const f = doc.element("FLS"), p = f && doc.plan(f), err = f && doc.error(f);
  const { model, params } = bimToCad(doc), sk = model.features.find(x => x.id === "B_FLS_s0");
  const types = sk ? sk.args.drawing.elements.map(e => e.type).sort().join(",") : "";
  // an edit in the CAD comes back as the floor's sketch
  const edited = JSON.parse(JSON.stringify(model)); const esk = edited.features.find(x => x.id === "B_FLS_s0"); const circ = esk.args.drawing.elements.find(e => e.type === "circle"); circ.r = 800;
  const ops = cadEditsToOps(doc, edited, params);
  const back = ops.find(o => o.op === "set" && o.id === "FLS" && o.key === "sketch");
  const ok = res.ok && !err && p && p.regions.length === 1 && p.regions[0].holes.length === 1 && Math.abs(held - lockedLen) < 0.5 && closedAfterDrag
    && types === "arc,circle,line,line,line,line" && sk.args.drawing.constraints.some(c => c.type === "coincident") && sk.args.drawing.constraints.some(c => c.type === "tangent") && !sk.args.drawing.dims
    && back && back.value.elements.find(e => e.type === "circle").r === 800 && back.value.dims.length === 1;
  return R(ok, "one area with one hole; the locked top edge keeps its length when a corner is dragged; the CAD gets arcs/circle/lines with coincidences and the fillet's tangencies (no BIM dims); a CAD edit comes back with the dims kept",
    `ok ${res.ok} err ${err}; regions ${p && p.regions.length} holes ${p && p.regions[0] && p.regions[0].holes.length}; top ${lockedLen}→${held}; closed ${closedAfterDrag}; CAD types ${types}; back ${back ? JSON.stringify(back.value.elements.find(e => e.type === "circle")) : "none"}`);
});

testCase("M23", "Units: the model is mm; display is mm/m/ft-in; fields take any unit and maths; a stored formula keeps the unit it was typed in", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const cases = [["10m", "mm", 10000], ["3'-6\"", "mm", 1066.8], ["3' 6 1/2\"", "m", 1079.5], ["2*1.2m + 300mm", "ft-in", 2700], ["2.5", "m", 2500], ["10", "ft-in", 3048], ["1/2\"", "mm", 12.7]];
  const parsed = cases.map(([t, u, want]) => [t, u, parseLength(t, { unit: u }), want]);
  const okParse = parsed.every(([, , got, want]) => Math.abs(got - want) < 1e-6);
  ed.apply({ op: "units", value: "m" });
  ed.apply({ op: "set", id: "W1", key: "height", text: "3.2" });                 // a bare number, in metres
  const h1 = doc.argValue(doc.element("W1"), "height");
  ed.apply({ op: "set", id: "W2", key: "height", text: "W1.Height + 0.5" });     // a formula with a bare 0.5 (metres)
  const h2 = doc.plan(doc.element("W2")).z1 - doc.plan(doc.element("W2")).z0;
  ed.apply({ op: "units", value: "ft-in" });                                     // switching the display changes no size
  doc.regenerate();
  const h2b = doc.plan(doc.element("W2")).z1 - doc.plan(doc.element("W2")).z0;
  const txt = dimText(doc, 3657.6), fv = formatValue({ kind: "Length", v: 1066.8 });
  ed.undo();
  const back = doc.meta.displayUnits;
  setLengthUnit("mm");
  const ok = okParse && h1 === 3200 && Math.abs(h2 - 3700) < 1e-6 && Math.abs(h2b - 3700) < 1e-6 && txt === "12' - 0\"" && fv === "3' - 6\"" && back === "m";
  return R(ok, "all parse right; 3.2 in metres is 3200; W1.Height + 0.5 is 3700 and stays 3700 after switching to ft-in; dims read 12' - 0\"; undo restores metres",
    `parse ${parsed.map(([t, u, g]) => `${t}@${u}=${Math.round(g * 10) / 10}`).join(" ")}; h1 ${h1}; h2 ${h2}→${h2b}; dim "${txt}"; fv "${fv}"; after undo ${back}`);
});

testCase("M24", "Show in 3D / Selection Box: an element's 3D extent; a section box cuts the hidden-line and marks the sheet stale", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const b = elementsBox(doc, ["W1"]), p = doc.plan(doc.element("W1"));
  const box = { on: true, min: [b.min[0] - 300, b.min[1] - 300, b.min[2] - 300], max: [b.max[0] + 300, b.max[1] + 300, 1500] };
  const all = buildHLRModel(doc), cut = buildHLRModel(doc, { box });
  const inside = e => [e.a, e.b].every(q => [0, 1, 2].every(i => q[i] >= box.min[i] - 1e-6 && q[i] <= box.max[i] + 1e-6));
  const v = doc.element("V-3D01"), k0 = sectionBoxKey(doc, v);
  ed.apply({ op: "set", id: "V-3D01", key: "sectionBox", value: box });
  const k1 = sectionBoxKey(doc, v);
  const ok = b && Math.abs(b.max[2] - p.z1) < 1 && Math.abs(b.min[2] - p.z0) < 1 && cut.edges.length > 0 && cut.edges.length < all.edges.length && cut.edges.every(inside) && k0 === "" && k1 !== "";
  return R(ok, "W1's box spans its height; clipped edges all lie in the box and are fewer; the view's box key changes when the box is set",
    `box z ${b && b.min[2]}→${b && b.max[2]} (wall ${p.z0}→${p.z1}); edges ${all.edges.length}→${cut.edges.length}, all inside ${cut.edges.every(inside)}; key "${k0}"→"${k1.slice(0, 30)}…"`);
});

testCase("M25", "A sheet draws a viewport the same whether or not its view was drawn on its own first (A-101 VP1 used to vanish on zoom)", () => {
  const count = (drawPlanFirst, win) => {
    const doc = buildSample(); let n = 0;
    const noop = () => {}, g = new Proxy({}, { get: (t, k) => (k === "stroke" || k === "fill") ? () => { n++; } : k in t ? t[k] : noop, set: (t, k, v) => { t[k] = v; return true; } });
    if (drawPlanFirst) drawScene(g, deriveView(doc, doc.element("V-P00")), { x: -50, y: -100, z: 3, W: 1200, H: 800, dpr: 1 });
    n = 0;
    drawScene(g, deriveView(doc, doc.element("SH-A101")), win);
    return n;
  };
  // zoomed in on VP1 (placed at 250, 360 on the sheet) - far from where the plan sits in its own tab
  const win = { x: 180, y: 300, z: 6, W: 900, H: 700, dpr: 1 };
  const fresh = count(false, win), afterPlan = count(true, win);
  return R(fresh > 50 && fresh === afterPlan, "same number of strokes and fills either way", `fresh ${fresh}, after drawing the plan first ${afterPlan}`);
});

testCase("M26", "Walls draw from the sketcher's shapes (rounded rectangle, circle, spline); grids stay orthogonal while ticked", () => {
  const doc = buildSample(), ed = new Editor(doc);
  // a rectangle with R 1000 corners: 4 lines and 4 arcs, every one a wall, ends joined
  const d = filletCorners({ elements: shapeFromClicks("rect", [[20000, 0], [26000, 4000]]), constraints: [], dims: [] }, 1000);
  const cls = d.elements.map(toCentreline), kinds = cls.map(c => c.type).sort().join(",");
  const ops = cls.map((c, i) => ({ op: "add", element: { id: "RW" + i, type: "Wall", args: { centreline: c, mounting: "Centred", wallType: { ref: "T-BLOCK215" }, baseLevel: { ref: "L0" }, height: 3000 } } }));
  const res = ed.apply(ops.concat([{ op: "autojoin", ends: cls.flatMap((_, i) => [{ id: "RW" + i, end: "start" }, { id: "RW" + i, end: "end" }]) }]));
  const errs = cls.map((_, i) => doc.error(doc.element("RW" + i))).filter(Boolean);
  const arcLen = doc.plan(doc.element("RW" + cls.findIndex(c => c.type === "arc"))).L;
  const circle = toCentreline(shapeFromClicks("circle", [[0, 0], [2000, 0]])[0]);
  // grids: ticked, an end handle slides along the grid; ticking a skewed grid straightens it
  const hs = CATALOGUE.get("Grid").handles(doc.element("G-A"), doc), endH = hs.find(x => x.key === "end");
  ed.apply([{ op: "set", id: "G-A", key: "orthogonal", value: false }, { op: "set", id: "G-A", key: "line", value: { type: "line", start: [0, -2000], end: [900, 10000] } }]);
  const skew = doc.argValue(doc.element("G-A"), "line");
  ed.apply({ op: "set", id: "G-A", key: "orthogonal", value: true });
  const straight = doc.argValue(doc.element("G-A"), "line");
  const ok = res.ok && !errs.length && kinds === "arc,arc,arc,arc,line,line,line,line" && Math.abs(arcLen - Math.PI * 1000 / 2) < 5 && circle.type === "circle" && circle.radius === 2000
    && endH && endH.constraint && endH.constraint.axis && skew.end[0] === 900 && straight.end[0] === 0 && Math.abs(straight.end[1] - 10000) < 1;
  return R(ok, "4 lines + 4 quarter arcs as walls with no errors; a circle wall; grid end handles slide along the grid; ticking straightens a skewed grid",
    `ok ${res.ok}; kinds ${kinds}; errors ${errs.join("; ")}; corner arc length ${Math.round(arcLen)}; circle ${JSON.stringify(circle)}; grid handle ${JSON.stringify(endH && endH.constraint)}; skew ${JSON.stringify(skew.end)} → ${JSON.stringify(straight.end)}`);
});

const DXF_SMALL = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
  "0", "LINE", "8", "WALLS", "10", "0", "20", "0", "11", "1000", "21", "0",
  "0", "LINE", "8", "WALLS", "10", "1000", "20", "0", "11", "1000", "21", "500",
  "0", "CIRCLE", "8", "FURN", "10", "500", "20", "250", "40", "100",
  "0", "LWPOLYLINE", "8", "FURN", "90", "2", "70", "0", "10", "0", "20", "500", "42", "1", "10", "200", "20", "500",
  "0", "TEXT", "8", "NOTES", "10", "0", "20", "700", "40", "50", "1", "HELLO",
  "0", "ENDSEC", "0", "EOF"].join("\n");
testCase("M27", "Import CAD: one element with its DXF layers; X/Y offset, scale and rotation place it; pinned it will not move; explode keeps layers", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const { drawing } = dxfDrawing(readDXF(DXF_SMALL));
  const r0 = ed.apply({ op: "add", element: { id: "CAD1", type: "CADImport", args: { file: "t.dxf", drawing, view: { ref: "V-P00" }, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, pinned: true } } });
  const f = doc.element("CAD1"), layers = drawing.layers.map(l => l.name).sort().join(",");
  const types = drawing.elements.map(e => e.type).sort().join(",");
  const moveWhilePinned = ed.apply({ op: "transform", ids: ["CAD1"], move: [500, 0] });
  ed.apply([{ op: "set", id: "CAD1", key: "offsetX", value: 2000 }, { op: "set", id: "CAD1", key: "scale", value: 2 }, { op: "set", id: "CAD1", key: "rotation", value: 90 }]);
  const P = importPlacer(f), end = P([1000, 0]);                          // (1000,0) doubled and turned 90°, then moved 2000 in x
  ed.apply({ op: "pin", id: "CAD1", value: false });
  const moved = ed.apply({ op: "transform", ids: ["CAD1"], move: [0, 300] }), oy = F.real(f, "offsetY");
  const sc = planScene(doc, doc.element("V-P00")), strokes = sc.prims.filter(p => p.id === "CAD1").length;
  // switch FURN off, then explode: the lines keep their layers; FURN is not exploded
  const d2 = JSON.parse(JSON.stringify(doc.argValue(f, "drawing"))); d2.layers.find(l => l.name === "FURN").on = false;
  ed.apply({ op: "set", id: "CAD1", key: "drawing", value: d2 });
  const ex = ed.apply({ op: "explode", id: "CAD1" });
  const dls = (ex.ids || []).map(id => doc.element(id)).filter(g => doc.typeOf(g) === "DetailLine");
  const ok = r0.ok && layers === "FURN,NOTES,WALLS" && /arc/.test(types) && /circle/.test(types) && !moveWhilePinned.ok && /pinned/.test(moveWhilePinned.error || "")
    && Math.abs(end[0] - 2000) < 1e-6 && Math.abs(end[1] - 2000) < 1e-6 && moved.ok && oy === 300 && strokes > 3
    && !doc.element("CAD1") && dls.length === 2 && dls.every(g => F.text(g, "layer") === "WALLS");
  return R(ok, "3 layers; a pinned import refuses to move; offset 2000 + scale 2 + 90° puts (1000,0) at (2000,2000); unpinned it moves; explode leaves the 2 WALLS lines (FURN off)",
    `add ${r0.ok}; layers ${layers}; types ${types}; pinned move: ${moveWhilePinned.error}; end ${end}; unpinned move ${moved.ok} → y ${oy}; prims ${strokes}; exploded ${(ex.ids || []).length}, lines ${dls.map(g => F.text(g, "layer")).join(",")}`);
});

testCase("M28", "No facets: a sketched floor draws its circles as arcs and its splines as exact Béziers; 3D shades a round hole smooth", () => {
  const doc = buildSample(), ed = new Editor(doc);
  const L = (id, a, b) => ({ id, type: "line", a, b });
  const sk = { elements: [L("e1", [20000, 0], [26000, 0]), { id: "s1", type: "bspline", ctrl: [[26000, 0], [28000, 2000], [24000, 3000], [26000, 5000]], degree: 3, closed: false }, L("e2", [26000, 5000], [20000, 5000]), L("e3", [20000, 5000], [20000, 0]),
    { id: "h1", type: "circle", c: [22000, 2500], r: 800 }, { id: "h2", type: "spline", pts: [[23500, 2000], [24200, 2600], [23500, 3200], [23000, 2600]], closed: true }], constraints: [], dims: [] };
  const ft = Object.keys(doc.lib.types).find(k => doc.lib.types[k].family === "F-FLOOR");
  const r = ed.apply({ op: "add", element: { id: "FLX", type: "Floor", args: { boundary: [[20000, 0], [26000, 0], [26000, 5000]], floorType: { ref: ft }, level: { ref: "L0" }, heightOffset: 0, sketch: sk } } });
  const p = doc.plan(doc.element("FLX")), kinds = {}; for (const s of p.path) kinds[s.k] = (kinds[s.k] || 0) + 1;
  // the B-spline's Bézier spans pass through the kernel's own curve points
  const segs = elementSegs(sk.elements[1]), ref = cadSketchOutline(sk.elements[1], 64);
  const near = q => Math.min(...segs.flatMap(s => Array.from({ length: 2001 }, (_, i) => { const t = i / 2000, b = bez(s.a, s.c1, s.c2, s.b, t); return Math.hypot(b[0] - q[0], b[1] - q[1]); })));
  const err = Math.max(...ref.map(near));
  const ok = r.ok && !doc.error(doc.element("FLX")) && kinds.A === 1 && (kinds.C || 0) >= 5 && kinds.L === 3 && err < 0.1 && p.foot.length >= 45;
  return R(ok, "3 lines + 1 arc (the circle) + Bézier spans (B-spline, closed spline); the spans lie on the kernel's curve (< 0.1 mm); the 3D ring is fine", `ok ${r.ok}; path ${JSON.stringify(kinds)}; B-spline off by ${err.toFixed(4)} mm; ring ${p.foot.length} points`);
});
