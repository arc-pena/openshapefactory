//! The application shell, laid out the way a BIM author expects (Revit's
//! arrangement): Quick Access Toolbar, a ribbon whose File tab sits at the far
//! left, an options bar, the Properties palette over the Project Browser on the
//! left, document tabs over the view, a view control bar under it, and the
//! status bar. The shell owns no model state: every command goes through one
//! registry, and every edit through app.apply → the op pipeline → regenerate.

import { h, clear, icon, dialog, saveFile, store, forget, loadDrawingFont, fmtLen } from "./ui_util.js";
import { SketchSession } from "./sketchui.js";
import { LENGTH_UNITS, setLengthUnit, fmtLength, parseLength } from "./units.js";
import { formatValue } from "./expr.js";
import { fromPolygon } from "./bimsketch.js";
import { Editor } from "./ops.js";
import { buildSample } from "./sample.js";
import { buildRmuhSample } from "./sample_rmuh.js";
import { openDocument, newDocument, sheetSize } from "./bim.js";
import { F, CATALOGUE } from "./ocaf.js";
import { deriveView, sheetScene, shownInView, SHEET_DIAGRAMS } from "./scene.js";
import { elementsBox } from "./hlr.js";
import { writePDF } from "./pdf.js";
import { writeDXF, readDXF, dxfDrawing, makeZip } from "./dxf.js";
import { runAll, CASES } from "./acceptance.js";
import { renderPanel, renderSchedule, typeEditor, vvDialog, viewStyleEditor, materialsEditor } from "./panel.js";
import { renderSpaceGraph, importProgram, briefDialog, sheetDiagramUrl } from "./sgui.js";
import { renderGraph } from "./graph.js";
import { View2D, SNAP_KINDS, MODIFY_TOOLS } from "./canvas2d.js";
import { View3D, VISUAL_STYLES, hiddenLineFor } from "./view3d.js";
import { categoryOf, lockedKey, SCHEMES, STYLE_SETTINGS, blankStyle } from "./styles.js";
import { bimToCad, cadEditsToOps, cadDiff, mergeModel } from "./cadbridge.js";
import { importIfc } from "./ifcimport.js";

const VIEW_TYPES = ["PlanView", "ElevationView", "SectionView", "View3D", "Schedule", "Sheet"];
const PLACE_TOOLS = new Set(["section", "floor", "beam", "wall", "opening", "door", "window", "column", "grid", "text", "dim", "space", "elev", "sep", "mtag"]);

const app = {
  doc: null, editor: null, selection: new Set(), activeView: null, tabs: [], tool: "select",
  toolOpts: { wallType: "T-EXTCAV300", mounting: "Core exterior", height: 3000, doorType: "T-DOOR915", windowType: "T-WIN1215", columnType: "T-COL400", floorType: "T-SLAB200", beamType: "T-UB406", floorOffset: 0, beamTop: 3000, width: 1000, height_: 2100, openSill: 0, sill: 900, boundaryAt: "finishFace", spaceName: "Room", mirrorCopy: true, moveCopy: false, rotateCopy: false },
  snaps: Object.fromEntries(SNAP_KINDS.map(k => [k, k !== "angle"])), thinLines: false, pickMode: null,
  views: new Map(), visualStyle3d: {}, expanded: new Set(["Views (all)", "Floor Plans", "3D Views", "Elevations (Building Elevation)", "Schedules/Quantities (all)", "Sheets (all)"]),
  ribbonTab: "Architecture", ribbonAuto: null, ribbonCollapsed: false, browserTab: "browser", treeFilter: "", lastCommand: null, workLevel: null,
};
window.webbim = app;       // for the console and for tests: the document, the editor, the op pipeline

// ---------------------------------------------------------------- the one edit path
app.apply = (op, opts = {}) => {
  const r = app.editor.apply(op, { coalesce: opts.coalesce || null });
  if (!r.ok && !opts.quiet) app.say(r.error || (r.conflicts || []).map(c => c.say).join("; "), "error");
  if (r.ok && r.said) app.say(r.said, "note");
  if (opts.quiet) { const v = app.views.get(app.activeView); if (v && v.draw) v.draw(); if (v && v.refresh && v.T) v.refresh(); updateStatus(); liveQuantities(); if (!r.ok && r.conflicts) app.say(r.error, "error"); }
  else app.refresh();
  saveDraftSoon();
  return r;
};
/** Mid-drag the palettes are not rebuilt (that would steal the drag), but what the selection
 *  measures of itself is: its read-only quantities are rewritten in place as it changes. */
function liveQuantities() {
  const ids = [...app.selection].filter(id => app.doc.element(id)); if (ids.length !== 1) return;
  const d = app.doc.data(app.doc.element(ids[0])); if (!d || !d.props) return;
  for (const el of document.querySelectorAll("#left [data-qty]")) { const v = d.props[el.dataset.qty]; if (v) el.textContent = formatValue(v); }
}
app.say = (msg, kind = "") => { const m = document.getElementById("msg"); if (!m) return; m.textContent = msg; m.className = "msg " + kind; m.title = msg; };
app.select = (ids, add = false) => {
  if (!add) app.selection.clear();
  for (const id of ids) { if (add && app.selection.has(id)) app.selection.delete(id); else app.selection.add(id); }
  // Revit's contextual tab: selecting something brings up "Modify | <Category>"
  const els = [...app.selection].filter(id => app.doc.element(id));
  if (els.length && app.tool === "select") { if (app.ribbonTab !== "__context") app.ribbonAuto = app.ribbonTab; app.ribbonTab = "__context"; }
  else if (!els.length && app.ribbonTab === "__context") { app.ribbonTab = app.ribbonAuto || "Architecture"; app.ribbonAuto = null; }
  app.refresh({ keepMain: true });
};
app.refresh = (opts = {}) => {
  setLengthUnit(app.doc.meta.displayUnits || "mm");
  renderQAT(); renderRibbon(); renderOptionsBar(); renderPalettes(); updateStatus();
  const v = app.views.get(app.activeView);
  if (!opts.keepMain || !v) renderMain();
  // a 3D view switched to or from Sheet Line-work changes what draws it
  else if (app.doc.element(app.activeView) && app.doc.typeOf(app.doc.element(app.activeView)) === "View3D" && (v instanceof View3D) === (visual3d(app.activeView) === "Sheet Line-work")) renderMain();
  else { if (v.draw) v.draw(); if (v.refresh && v.T) v.refresh(); renderViewControl(); }
  scheduleHiddenLine();
  if (opts.keepMain && (app.activeView === "__graph" || app.activeView === "__spacegraph" || app.activeView === "__tree" || (app.activeView && app.doc.element(app.activeView) && app.doc.typeOf(app.doc.element(app.activeView)) === "Schedule"))) renderMain();
};
app.openView = id => {
  if (!app.tabs.includes(id)) app.tabs.push(id);
  app.activeView = id; app.pickMode = null;
  if (app.tool !== "select" && !canUseTool(app.tool)) app.tool = "select";
  store("tabs", { tabs: app.tabs, active: id });
  app.refresh();
  if (window.innerWidth <= 860) document.body.classList.remove("show-left");
};
app.closeTab = id => { app.tabs = app.tabs.filter(t => t !== id); app.views.delete(id); if (app.activeView === id) app.activeView = app.tabs[app.tabs.length - 1] || null; store("tabs", { tabs: app.tabs, active: app.activeView }); app.refresh(); };
app.openGraph = id => { app.graphFocus = id; app.openView("__graph"); };
app.revealInView = id => {
  const f = app.doc.element(id); if (!f) return;
  if (VIEW_TYPES.includes(app.doc.typeOf(f))) return app.openView(id);
  const cur = app.doc.element(app.activeView);
  if (cur && ["PlanView", "View3D"].includes(app.doc.typeOf(cur))) return;
  const plan = app.tabs.find(t => app.doc.element(t) && app.doc.typeOf(app.doc.element(t)) === "PlanView") || firstOf("PlanView");
  if (plan) app.openView(plan);
};
app.editInView = (id, key) => { app.select([id]); app.revealInView(id); app.say(`Drag the grips to edit ${key}; type a number mid-drag for an exact value`, "note"); };
app.startPick = pm => { app.pickMode = pm; app.revealInView(pm.ids[0]); app.say(`Pick an element to bind ${pm.label} (${pm.kind} only) — Esc cancels`, "note"); app.refresh(); };
app.endPick = () => { app.pickMode = null; app.refresh(); };
app.hoverInfo = id => {
  const f = app.doc.element(id); if (!f) return;
  const tk = ["wallType", "doorType", "windowType", "columnType"].find(k => F.refId(f, k));
  const t = tk && app.doc.resolveType(F.refId(f, tk));
  const cat = (app.doc.lib.categories[categoryOf(app.doc, f)] || {}).name || app.doc.typeOf(f);
  app.say(`${cat} : ${t ? `${(t.chain[0] || {}).name || ""} : ${t.name}` : f.get("Name")}  ·  ${id}`, "");
};
/** Placement shared by the plan and the 3D view: one path for "a door in this wall at u". */
app.place = element => { const r = app.apply({ op: "add", element }); if (r.ok) { app.say(`Placed ${r.id}`, "ok"); } return r; };
app.placeOpening = (tool, wallId, u) => {
  const doc = app.doc, o = app.toolOpts;
  const t = tool === "door" ? doc.lib.types[o.doorType] : tool === "window" ? doc.lib.types[o.windowType] : null;
  const w = t ? t.width : o.width, hh = t ? t.height : o.height_;
  const sill = tool === "door" ? 0 : tool === "window" ? (o.sill ?? 900) : (o.openSill ?? 0);
  const opId = doc.freshId("Opening");
  const ops = [{ op: "add", element: { id: opId, type: "Opening", args: { host: { ref: wallId }, profile: { kind: "rect", at: u, sill, w, h: hh }, farProfile: null, depth: "through" } } }];
  if (tool === "door") ops.push({ op: "add", element: { type: "Door", args: { fills: { ref: opId }, doorType: { ref: o.doorType } }, params: { Phase: "New" } } });
  if (tool === "window") ops.push({ op: "add", element: { type: "Window", args: { fills: { ref: opId }, windowType: { ref: o.windowType } } } });
  const r = app.apply(ops);
  app.say(r.ok ? `${tool === "opening" ? "Opening" : tool[0].toUpperCase() + tool.slice(1)} placed in ${wallId} at ${u} mm along it` : r.error, r.ok ? "ok" : "error");
  return r;
};
const firstOf = type => { const f = app.doc.elements().find(g => app.doc.typeOf(g) === type); return f ? app.doc.idOf(f) : null; };
const activeType = () => { const v = app.activeView && app.doc.element(app.activeView); return v ? app.doc.typeOf(v) : app.activeView; };
const canUseTool = k => { const t = activeType(); if (t === "PlanView") return true; if (t === "ElevationView" || t === "SectionView") return k === "select" || k === "dim" || k === "mtag"; if (t === "View3D") return ["wall", "door", "window", "opening", "column", "select"].includes(k); return k === "select"; };

// ---------------------------------------------------------------- documents
/** There is always a {3D} view: the house button must have somewhere to go. */
/** Revit's "Show in 3D" and Selection Box (BX): the {3D} view, framed on what is selected - with a
 *  section box around it, when asked. */
function showIn3D(withBox) {
  const ids = [...app.selection].filter(id => app.doc.element(id));
  if (!ids.length) return app.say("select something first", "note");
  const box = elementsBox(app.doc, ids); if (!box) return app.say("nothing selected has a body to show in 3D", "note");
  ensureDefault3D(app.doc); const vid = default3D();
  if (withBox) {
    const pad = 300, b = { on: true, min: box.min.map(v => Math.floor((v - pad) / 10) * 10), max: box.max.map(v => Math.ceil((v + pad) / 10) * 10) };
    app.apply({ op: "set", id: vid, key: "sectionBox", value: b });
  }
  app.openView(vid);
  const v = app.views.get(vid); if (v && v.fitBox) { v.refresh(); v.fitBox(box.min, box.max); }
  app.select(ids);
  app.say(withBox ? `Section box around ${ids.length} element${ids.length > 1 ? "s" : ""}: drag its blue arrows to push or pull a face; Section Box on the View tab turns it off` : `Showing ${ids.join(", ")} in 3D`, "ok");
}
function toggleSectionBox() {
  const v = app.doc.element(app.activeView);
  if (!v || app.doc.typeOf(v) !== "View3D") return app.say("open a 3D view", "note");
  const b = Object.assign({ on: false, min: null, max: null }, app.doc.argValue(v, "sectionBox") || {});
  if (!b.on && !(b.min && b.max)) { const all = elementsBox(app.doc, app.doc.elements().filter(f => shownInView(app.doc, v, f)).map(f => app.doc.idOf(f))); if (!all) return; b.min = all.min.map(x => x - 300); b.max = all.max.map(x => x + 300); }
  b.on = !b.on;
  app.apply({ op: "set", id: app.activeView, key: "sectionBox", value: b });
  app.say(b.on ? "Section box on: drag its arrows to push or pull each face" : "Section box off (its size is kept for next time)", "ok");
}
function ensureDefault3D(doc) {
  if (doc.elements().some(f => doc.typeOf(f) === "View3D" && f.get("Name") === "{3D}")) return;
  let id = "V-3D"; let n = 1; while (doc.element(id)) id = "V-3D" + (++n);
  doc.addElement({ id, type: "View3D", name: "{3D}", args: { camera: { azimuth: 225, elevation: 30, target: [6000, 4000, 1500] }, scale: 100, style: { ref: "VS-CONSTRUCTION" }, render: { mode: "lines", hidden: false, rasterDPI: 300 } } });
  doc.regenerate();
}
function setDocument(doc, note) {
  ensureDefault3D(doc); setLengthUnit(doc.meta.displayUnits || "mm");
  app.doc = doc; app.editor = new Editor(doc); app.selection.clear(); app.views.clear();
  const saved = store("tabs");
  app.tabs = (saved && saved.tabs || []).filter(t => t.startsWith("__") || doc.element(t));
  // a project with a brief opens on its analysis; otherwise on its ground plan and 3D
  if (!app.tabs.length && doc.elements().some(g => doc.typeOf(g) === "SpaceGraph")) app.tabs = ["__spacegraph", firstOf("PlanView"), default3D()].filter(Boolean);
  if (!app.tabs.length) app.tabs = ["V-P00", default3D()].filter(t => t && doc.element(t));
  if (!app.tabs.length) { const p = firstOf("PlanView"); if (p) app.tabs = [p]; }
  app.activeView = saved && app.tabs.includes(saved.active) ? saved.active : app.tabs[0] || null;
  app.refresh();
  if (note) app.say(note.msg, note.kind);
}
function default3D() { const f = app.doc.elements().find(g => app.doc.typeOf(g) === "View3D" && g.get("Name") === "{3D}") || app.doc.elements().find(g => app.doc.typeOf(g) === "View3D"); return f ? app.doc.idOf(f) : null; }
let draftTimer = null;
function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(() => { try { store("draft-v5", app.doc.toJSON()); } catch (e) { /* too big or blocked: the draft is a convenience only */ } }, 800); }

// ---------------------------------------------------------------- the command registry
//! Ribbon buttons, the Quick Access Toolbar, keyboard shortcuts and the
//! right-click menu all name commands here — one registry, four surfaces.
const tool = (id, label, ic, key, hint) => ({ label, icon: ic, key, hint, tool: id, run: () => app.setTool(id) });
const COMMANDS = {
  select: tool("select", "Modify", "select", "MD", "Click to select, Shift adds. Drag a window left→right to enclose, right→left to cross. Drag an element to move it. Middle-drag pans, Shift+middle-drag orbits in 3D, the wheel zooms, right-click for the menu."),
  wall: tool("wall", "Wall", "wall", "WA", "Click points; the chain shares corners (joins) and lands on walls (T joins). Type a length + Enter. Enter ends, C closes, Esc cancels. Works in plan and in 3D."),
  door: tool("door", "Door", "door", "DR", "Click a wall to place a door (plan or 3D)."),
  window: tool("window", "Window", "window", "WN", "Click a wall to place a window (plan or 3D)."),
  opening: tool("opening", "Wall Opening", "opening", "OP", "Click a wall: an opening with nothing in it."),
  column: tool("column", "Column", "column", "CL", "Click to place (plan or 3D)."),
  floor: { label: "Floor", icon: "floor", key: "SB", hint: "Sketch the floor's boundary: lines, arcs, circles, splines, Pick Walls. Closed loops inside are holes. Finish ✓ makes the floor; its layers hang down from the level.", run: () => startFloorSketch(), active: () => !!(app.sketch && app.sketch.target.kind === "floor") },
  editboundary: { label: "Edit Boundary", icon: "skline", hint: "Back into the floor's sketch", run: () => { const id = [...app.selection].find(i => app.doc.element(i) && app.doc.typeOf(app.doc.element(i)) === "Floor"); if (id) app.editBoundary(id); else app.say("select a floor", "note"); } },
  beam: tool("beam", "Beam", "beam", "BM", "Two clicks: the beam's axis. Its top sits at the level plus the top offset."),
  grid: tool("grid", "Grid", "grid", "GR", "Two clicks."),
  space: tool("space", "Room", "room", "RM", "Click inside an enclosed area. The room keeps its name by this point."),
  sep: tool("sep", "Room Separator", "sepline", "RS", "Two clicks: divides rooms where there is no wall."),
  dim: tool("dim", "Aligned", "dim", "DI", "Click two parallel references: faces, centrelines, grids. It binds to them, not to points."),
  text: tool("text", "Text", "text", "TX", "Click, type, Enter. Height is paper millimetres."),
  mtag: tool("mtag", "Material Tag", "mtag", "MT", "Click on a material (a wall layer, a floor layer, a column), then where the tag goes: it shows that material's Mark. Works in plans and sections."),
  keynote: { label: "Keynote", icon: "keynote", key: "KN", hint: "A material keynote: the material's Mark in a box, on a leader", tool: "mtag", run: () => { app.toolOpts.mtagShow = "Mark"; app.toolOpts.mtagFrame = "Keynote box"; app.setTool("mtag"); } },
  repeat: { label: "Repeating Detail", icon: "repeat", key: "RD", hint: "Sketch a path (lines, arcs, splines): a component repeats along it - batt or rigid insulation, brick coursing, blocking, or any loaded symbol", run: () => startRepeatSketch("Batt insulation") },
  insulation: { label: "Insulation", icon: "insul", key: "IN", hint: "Batt insulation along a sketched path; its width is the insulation's thickness", run: () => startRepeatSketch("Batt insulation") },
  siteboundary: { label: "Site Boundary", icon: "skpoly", key: "SB", hint: "The plot lines: sketch them (or edit the project's), or import them from a DXF in Brief Analysis. Each edge takes its own setback and zoning plane.", run: () => {
    const doc = app.doc, sb = doc.elements().find(g => doc.typeOf(g) === "SiteBoundary"), v = app.views.get(app.activeView);
    if (!v || v.kind !== "PlanView") return app.say("open a plan to sketch the site boundary in", "error");
    if (sb) return app.stepInto(doc.idOf(sb), v);
    app.startSketch(v, { kind: "site", id: null }, null);
  } },
  spacegraph: { label: "Brief Analysis", icon: "bubbles", key: "SG", hint: "The program as a graph: import an Excel program or write a brief, relax the bubble diagram, set the site, setbacks and entry - it packs and builds the rooms", run: () => app.openView("__spacegraph") },
  sgimport: { label: "Import Program", icon: "importI", run: () => importProgram(app) },
  sgbrief: { label: "Brief", icon: "text", run: () => briefDialog(app) },
  materials: { label: "Materials", icon: "material", key: "MA", run: () => materialsEditor(app) },
  elev: tool("elev", "Elevation", "elevview", "EL", "Two clicks: the marker line is the view."),
  section: tool("section", "Section", "section", "SE", "Two clicks: the section line. It looks to the right of the direction you drew it; double-click its head to open it."),
  move: tool("move", "Move", "move", "MV", "Click a base point, then the destination (or type a distance + Enter)."),
  copy: tool("copy", "Copy", "copy", "CO", "Click a base point, then where the copy goes."),
  rotate: tool("rotate", "Rotate", "rotate", "RO", "Click the start of the angle, then its end (or type degrees + Enter)."),
  mirror: tool("mirror", "Mirror", "mirror", "MM", "Click two points on the mirror axis."),
  split: tool("split", "Split Element", "split", "SL", "Click anywhere on a wall, beam, detail line or room separator: it is cut in two there, joins and hosted doors kept."),
  del: { label: "Delete", icon: "del", key: "DE", run: () => deleteSelection() },
  undo: { label: "Undo", icon: "undo", run: () => { app.editor.undo(); app.refresh(); saveDraftSoon(); } },
  redo: { label: "Redo", icon: "redo", run: () => { app.editor.redo(); app.refresh(); saveDraftSoon(); } },
  default3d: { label: "Default 3D View", icon: "house", key: "3D", run: () => { ensureDefault3D(app.doc); app.openView(default3D()); } },
  showin3d: { label: "Show in 3D", icon: "view3d", hint: "Open the 3D view centred on the selection", run: () => showIn3D(false) },
  selectionbox: { label: "Selection Box", icon: "crop", key: "BX", hint: "Open the 3D view with a section box around the selection; push or pull its faces", run: () => showIn3D(true) },
  sectionbox: { label: "Section Box", icon: "crop", hint: "Clip the 3D view to a box; drag its arrows to push or pull each face", active: () => { const v = app.doc.element(app.activeView); const b = v && app.doc.typeOf(v) === "View3D" && app.doc.argValue(v, "sectionBox"); return !!(b && b.on); }, run: () => toggleSectionBox() },
  planview: { label: "Floor Plan", icon: "plan", hint: "Pick a level without a floor plan: one plan per level", run: () => floorPlanDialog() },
  level: { label: "Level", icon: "level", key: "LL", run: () => newLevel() },
  schedule: { label: "Schedule", icon: "schedule", run: () => newSchedule() },
  sheet: { label: "Sheet", icon: "sheet", run: () => newSheet() },
  vv: { label: "Visibility/ Graphics", icon: "vv", key: "VV", run: () => { const v = app.doc.element(app.activeView); if (v && ["PlanView", "ElevationView", "SectionView", "View3D"].includes(app.doc.typeOf(v))) vvDialog(app, app.activeView); else app.say("open a plan, elevation or 3D view first", "note"); } },
  thin: { label: "Thin Lines", icon: "thin", key: "TL", active: () => app.thinLines, run: () => { app.thinLines = !app.thinLines; app.refresh({ keepMain: true }); } },
  zoomfit: { label: "Zoom to Fit", icon: "fit", key: "ZF", run: () => { const v = app.views.get(app.activeView); if (v && v.fit) v.fit(); } },
  graph: { label: "Node Graph", icon: "graph", run: () => app.openView("__graph") },
  tree: { label: "Feature Tree", icon: "tree", run: () => app.openView("__tree") },
  tests: { label: "Acceptance Tests", icon: "tests", run: () => app.openView("__diag") },
  cadmode: { label: "Parametric CAD", icon: "view3d", key: "PC", hint: "Switch the whole interface to the OpenCascade parametric modeller - the same building, as nodes", run: () => switchToCad() },
  dooranim: { label: "Open / Close", icon: "door", run: () => animateSelectedDoors() },
  swingnext: { label: "Swing Scenario", icon: "rotate", run: () => nextSwingScenario() },
  fliphand: { label: "Flip Hand", icon: "mirror", run: () => flipDoors("flipHand") },
  flipfacing: { label: "Flip Facing", icon: "mirror", run: () => flipDoors("flipFacing") },
  closehidden: { label: "Close Inactive", icon: "close", run: () => { app.tabs = app.tabs.filter(t => t === app.activeView); app.refresh(); } },
  importcad: { label: "Import CAD", icon: "importI", key: "IC", hint: "A DXF into this view as ONE element, its layers kept, pinned at the file's origin. X/Y offset, scale and rotation in Properties; Explode makes it detail lines.", run: () => importCAD() },
  pin: { label: "Pin", icon: "pin", key: "PN", hint: "Pinned elements cannot be dragged, moved or rotated", run: () => { const ids = [...app.selection]; if (ids.length) app.apply({ op: "pin", ids, value: true }); } },
  unpin: { label: "Unpin", icon: "unpin", key: "UP", hint: "Let a pinned element be moved again", run: () => { const ids = [...app.selection]; if (ids.length) app.apply({ op: "pin", ids, value: false }); } },
  explode: { label: "Explode", icon: "skline", hint: "The import becomes detail lines in this view, each on its DXF layer", run: () => { const id = [...app.selection].find(i => app.doc.element(i) && app.doc.typeOf(app.doc.element(i)) === "CADImport"); if (!id) return app.say("select an imported drawing", "note"); const r = app.apply({ op: "explode", id }); if (r.ok) app.select(r.ids || []); } },
  region: { label: "Filled Region", icon: "skrect", key: "FR", hint: "Sketch a hatched region in this view: closed loops, holes inside; Finish ✓ makes it", run: () => startRegionSketch() },
  edittype: { label: "Edit Type", icon: "edittype", run: () => { const t = selectedType(); if (t) typeEditor(app, t); else app.say("select an element with a type", "note"); } },
  props: { label: "Properties", icon: "props", key: "PP", active: () => !document.body.classList.contains("hide-props"), run: () => document.body.classList.toggle("hide-props") },
  viewstyles: { label: "View Styles", icon: "vv", key: "VT", run: () => { const v = app.doc.element(app.activeView); const isV = v && ["PlanView", "ElevationView", "SectionView", "View3D"].includes(app.doc.typeOf(v)); viewStyleEditor(app, isV ? F.refId(v, "style") : null, isV ? app.activeView : null); } },
  pens: { label: "Object Styles & Pens", icon: "pens", run: () => { const v = app.activeView && app.doc.element(app.activeView); vvDialog(app, v && ["PlanView", "ElevationView", "SectionView", "View3D"].includes(app.doc.typeOf(v)) ? app.activeView : firstOf("PlanView"), { tab: "pens" }); } },
  projectinfo: { label: "Project Information", icon: "info", run: () => projectInfo() },
  units: { label: "Project Units", icon: "dim", key: "UN", hint: "How lengths are shown: mm, cm, m, feet-inches or inches. Fields take any unit and maths whatever this says.", run: () => unitsDialog() },
  open: { label: "Open…", icon: "open", run: () => openFile() },
  save: { label: "Save", icon: "save", key: "", run: () => saveModel() },
  importdxf: { label: "Import DXF Symbol", icon: "importI", run: () => importDXF() },
  importifc: { label: "Import IFC", icon: "importI", hint: "IfcWall, IfcSlab, IfcFooting, IfcColumn, IfcBeam, IfcDoor, IfcWindow and IfcBuildingElementProxy come in as walls, floors, columns, beams, doors, windows and generic models; each storey gets its floor plan", run: () => importIfcFile() },
  placesymbol: { label: "Symbol", icon: "symbol", run: () => placeSymbol(Object.keys(app.doc.lib.symbols).find(k => app.doc.lib.symbols[k].source) || "SY-NORTH") },
  export: { label: "Export", icon: "exportI", run: () => exportDialog() },
  selectall: { label: "Select All Instances", icon: "select", key: "SA", run: () => selectAllInstances() },
  flip: { label: "Flip", icon: "mirror", run: () => { for (const id of app.selection) { const f = app.doc.element(id); if (f && app.doc.typeOf(f) === "Wall") app.apply({ op: "set", id, key: "flipped", value: !F.bool(f, "flipped") }); if (f && app.doc.typeOf(f) === "Door") app.apply({ op: "set", id, key: "flipFacing", value: !F.bool(f, "flipFacing") }); } } },
};
function selectedType() { for (const id of app.selection) { const f = app.doc.element(id); if (!f) continue; const k = ["wallType", "doorType", "windowType", "columnType"].find(k => F.refId(f, k)); if (k) return F.refId(f, k); } return null; }
app.setTool = k => {
  if (!canUseTool(k)) { if (PLACE_TOOLS.has(k) || MODIFY_TOOLS.has(k)) { const plan = firstOf("PlanView"); if (plan) app.openView(plan); } }
  if (PLACE_TOOLS.has(k)) app.selection.clear(); // placing starts from a clean selection, as in Revit
  app.tool = k; app.pickMode = null; app.lastCommand = k !== "select" ? k : app.lastCommand;
  const v = app.views.get(app.activeView); if (v && v.tool) { v.tool.pts = []; v.tool.refs = []; v.tool.preview = null; v.tool.ghost = null; v.tool.centre = null; }
  if (k !== "select" && app.ribbonTab === "__context" && !MODIFY_TOOLS.has(k)) { app.ribbonTab = app.ribbonAuto || "Architecture"; }
  // the wall tool brings up its own tab (Modify | Place Wall), with the sketcher's draw shapes
  if (k === "wall") { app.ribbonAuto = app.ribbonTab === "__context" ? app.ribbonAuto : app.ribbonTab; app.ribbonTab = "__context"; }
  app.refresh({ keepMain: true });
  app.say((COMMANDS[k] && COMMANDS[k].hint) || "", "note");
};
app.run = id => { const c = COMMANDS[id]; if (!c) return; closeMenus(); c.run(); if (!c.tool && id !== "undo" && id !== "redo") app.lastCommand = id; };

// ---------------------------------------------------------------- the ribbon
const big = id => ({ id, size: "big" }), small = id => ({ id, size: "small" });
const RIBBON = [
  { tab: "Architecture", panels: [
    { title: "Build", items: [big("wall"), big("door"), big("window"), big("column"), big("floor")] },
    { title: "Opening", items: [big("opening")] },
    { title: "Room & Area", items: [big("space"), small("sep"), small("schedule")] },
    { title: "Program", items: [big("spacegraph"), small("sgimport"), small("sgbrief")] },
    { title: "Site", items: [big("siteboundary")] },
    { title: "Datum", items: [big("level"), big("grid"), big("planview")] },
  ] },
  { tab: "Structure", panels: [
    { title: "Structure", items: [big("beam"), big("column"), big("floor"), big("wall")] },
    { title: "Datum", items: [big("grid"), big("level")] },
  ] },
  { tab: "Insert", panels: [
    { title: "Import", items: [big("importcad"), big("importifc"), big("importdxf"), big("open")] },
    { title: "Load from Library", items: [big("placesymbol")] },
  ] },
  { tab: "Annotate", panels: [
    { title: "Dimension", items: [big("dim")] },
    { title: "Text", items: [big("text")] },
    { title: "Detail", items: [big("region"), big("repeat"), big("insulation")] },
    { title: "Tag", items: [big("mtag"), big("keynote")] },
    { title: "Symbol", items: [big("placesymbol")] },
  ] },
  { tab: "View", panels: [
    { title: "Graphics", items: [big("vv"), big("viewstyles"), small("thin"), small("zoomfit")] },
    { title: "Create", items: [big("planview"), big("default3d"), big("sectionbox"), big("section"), small("elev"), small("schedule"), big("sheet")] },
    { title: "Windows", items: [small("graph"), small("tree"), small("closehidden")] },
    { title: "Interface", items: [big("cadmode")] },
  ] },
  { tab: "Manage", panels: [
    { title: "Settings", items: [big("materials"), big("pens"), big("projectinfo"), big("units")] },
    { title: "Inquiry", items: [big("tests")] },
  ] },
  { tab: "Modify", panels: [
    { title: "Select", items: [big("select")] },
    { title: "Properties", items: [big("props"), big("edittype")] },
    { title: "Modify", items: [small("move"), small("copy"), small("rotate"), small("mirror"), small("split"), small("del"), small("selectall")] },
    { title: "View", items: [small("zoomfit"), small("thin")] },
  ] },
];
/** The wall tool's draw shapes: the sketcher's, without its Finish - each shape is walls at once. */
const WALL_SHAPES = [["line", "Line", "skline"], ["rect", "Rectangle", "skrect"], ["polygon", "Polygon", "skpoly"], ["arc", "Arc", "skarc"], ["circle", "Circle", "skcircle"],
  ["ellipse", "Ellipse", "skellipse"], ["bspline", "Spline (control points)", "skbspline"], ["spline", "Spline (through points)", "skspline"], ["pick", "Pick Lines", "pick"]];
for (const [k, label, ic] of WALL_SHAPES) COMMANDS["wallshape_" + k] = { label, icon: ic, hint: k === "pick" ? "Click a grid, detail line, room separator, floor edge or wall face: a wall along it" : `Draw walls as a ${label.toLowerCase()}`, active: () => app.tool === "wall" && (app.toolOpts.wallShape || "line") === k,
  run: () => { app.toolOpts.wallShape = k; const v = app.views.get(app.activeView); if (v && v.tool) { v.tool.pts = []; v.tool.cursor = null; } app.refresh({ keepMain: true }); } };
function contextTab() {
  if (app.tool === "wall") return { tab: "__context", label: "Modify | Place Wall", panels: [
    { title: "Draw", items: WALL_SHAPES.map(([k], i) => (i < 5 || k === "pick" ? big : small)("wallshape_" + k)) },
    { title: "Modify", items: [small("move"), small("copy"), small("rotate"), small("split")] },
  ] };
  const els = [...app.selection].map(id => app.doc.element(id)).filter(Boolean);
  if (!els.length) return null;
  const cats = [...new Set(els.map(f => (app.doc.lib.categories[categoryOf(app.doc, f)] || {}).name || app.doc.typeOf(f)))];
  const hasWall = els.some(f => ["Wall", "Door"].includes(app.doc.typeOf(f)));
  return { tab: "__context", label: `Modify | ${cats.length === 1 ? cats[0] : "Multi-Select"}`, panels: [
    { title: "Properties", items: [big("props"), big("edittype")] },
    { title: "Modify", items: [big("move"), big("copy"), big("rotate"), big("mirror"), big("split"), big("del")] },
    ...(hasWall ? [{ title: "Mode", items: [big("flip")] }] : []),
    ...(els.length === 1 && app.doc.typeOf(els[0]) === "Floor" ? [{ title: "Mode", items: [big("editboundary")] }] : []),
    ...(els.some(f => app.doc.typeOf(f) === "CADImport") ? [{ title: "Import CAD", items: [big("explode")] }] : []),
    ...(els.some(f => (app.doc.declOf(f) || { args: [] }).args.some(a => a.key === "pinned")) ? [{ title: "Pin", items: [big(els.some(f => F.bool(f, "pinned")) ? "unpin" : "pin")] }] : []),
    ...(els.some(f => app.doc.typeOf(f) === "Door") ? [{ title: "Door", items: [big("dooranim"), big("swingnext"), small("fliphand"), small("flipfacing")] }] : []),
    { title: "View", items: [small("showin3d"), small("selectionbox")] },
    { title: "Select", items: [small("selectall"), small("select")] },
  ] };
}
function renderRibbon() {
  const root = clear(document.getElementById("ribbon"));
  if (app.sketch) return renderSketchRibbon(root);
  const ctx = contextTab();
  if (app.ribbonTab === "__context" && !ctx) app.ribbonTab = app.ribbonAuto || "Architecture";
  const tabs = h("div", { class: "rtabs", role: "tablist" },
    h("button", { class: "rtab file", onclick: e => fileMenu(e.currentTarget) }, "File"),
    RIBBON.map(t => h("button", { class: "rtab", role: "tab", "aria-selected": String(app.ribbonTab === t.tab), onclick: () => { app.ribbonTab = t.tab; app.ribbonAuto = null; renderRibbon(); }, ondblclick: () => { app.ribbonCollapsed = !app.ribbonCollapsed; renderRibbon(); } }, t.tab)),
    ctx ? h("button", { class: "rtab context", role: "tab", "aria-selected": String(app.ribbonTab === "__context"), onclick: () => { app.ribbonTab = "__context"; renderRibbon(); } }, ctx.label) : null,
    h("span", { class: "grow" }),
    h("button", { class: "rtab mini", title: app.ribbonCollapsed ? "Show the ribbon" : "Minimise the ribbon", "aria-label": "Toggle ribbon", onclick: () => { app.ribbonCollapsed = !app.ribbonCollapsed; renderRibbon(); } }, app.ribbonCollapsed ? "▾" : "▴"));
  root.append(tabs);
  if (app.ribbonCollapsed) { root.classList.add("collapsed"); return; }
  root.classList.remove("collapsed");
  const def = app.ribbonTab === "__context" ? ctx : RIBBON.find(t => t.tab === app.ribbonTab) || RIBBON[0];
  const strip = h("div", { class: "rpanels" });
  for (const p of def.panels) {
    const body = h("div", { class: "rpbody" });
    let smalls = null;
    for (const it of p.items) {
      const c = COMMANDS[it.id]; if (!c) continue;
      const on = (c.tool && app.tool === c.tool) || (c.active && c.active());
      const title = `${c.label}${c.key ? ` (${c.key})` : ""}${c.hint ? "\n" + c.hint : ""}`;
      if (it.size === "big") { smalls = null; body.append(h("button", { class: "rbig", "aria-pressed": String(!!on), title, onclick: () => app.run(it.id) }, icon(c.icon, 30), h("span", {}, c.label))); }
      else { if (!smalls || smalls.children.length >= 3) { smalls = h("div", { class: "rsmallcol" }); body.append(smalls); } smalls.append(h("button", { class: "rsmall", "aria-pressed": String(!!on), title, onclick: () => app.run(it.id) }, icon(c.icon, 16), h("span", {}, c.label))); }
    }
    strip.append(h("div", { class: "rpanel" }, body, h("div", { class: "rptitle" }, p.title)));
  }
  root.append(strip);
}
/** In sketch mode the ribbon is the sketch's own tab, as Revit's "Modify | Create Floor Boundary":
 *  Mode (Finish / Cancel), Draw, Modify, Measure. The rest of the ribbon waits until it ends. */
function renderSketchRibbon(root) {
  const S = app.sketch;
  root.classList.remove("collapsed");
  root.append(h("div", { class: "rtabs", role: "tablist" },
    h("button", { class: "rtab file", onclick: e => fileMenu(e.currentTarget) }, "File"),
    h("button", { class: "rtab context", role: "tab", "aria-selected": "true" }, `Modify | ${S.title}`)));
  const strip = h("div", { class: "rpanels" });
  for (const p of S.ribbonPanels()) {
    const body = h("div", { class: "rpbody" }); let smalls = null;
    for (const it of p.items) {
      const title = `${it.label}${it.hint ? "\n" + it.hint : ""}`;
      if (it.size === "big") { smalls = null; body.append(h("button", { class: "rbig" + (it.finish ? " finish" : ""), "aria-pressed": String(!!it.on), title, onclick: () => it.run() }, icon(it.icon, 30), h("span", {}, it.label))); }
      else { if (!smalls || smalls.children.length >= 3) { smalls = h("div", { class: "rsmallcol" }); body.append(smalls); } smalls.append(h("button", { class: "rsmall", "aria-pressed": String(!!it.on), title, onclick: () => it.run() }, icon(it.icon, 16), h("span", {}, it.label))); }
    }
    strip.append(h("div", { class: "rpanel" }, body, h("div", { class: "rptitle" }, p.title)));
  }
  root.append(strip);
}
/** Into sketch mode, in a plan view: for a new floor, a floor's boundary, or a crop. */
app.startSketch = (view, target, drawing) => {
  if (app.sketch) app.sketch.cancel();
  app.sketch = new SketchSession(app, view, target, drawing);
  app.tool = "sketch"; app.selection.clear();
  if (target.kind === "crop" || (drawing && drawing.elements && drawing.elements.length)) app.sketch.tool = "select";
  app.refresh({ keepMain: true });
  app.say(`${app.sketch.title}: ${target.kind === "repeat" ? "lines, arcs and splines, open or closed: the component repeats along them" : target.kind === "crop" ? "the crop's boundary" : "closed loops make the floor; a loop inside another is a hole"}. Draw, then Finish ✓ on the ribbon (or Cancel ✕).`, "note");
};
app.endSketch = () => { app.sketch = null; app.tool = "select"; const v = app.views.get(app.activeView); if (v && v.hideHud) { v.hideHud(); v.showSnap && v.showSnap(null); } app.refresh({ keepMain: true }); };
function planViewForSketch(levelId) {
  const cur = app.views.get(app.activeView);
  if (cur && cur.kind === "PlanView" && (!levelId || F.refId(cur.view, "level") === levelId)) return cur;
  const pv = app.doc.elements().find(f => app.doc.typeOf(f) === "PlanView" && (!levelId || F.refId(f, "level") === levelId));
  if (!pv) return null;
  app.openView(app.doc.idOf(pv)); return app.views.get(app.doc.idOf(pv));
}
function startFloorSketch() {
  const v = planViewForSketch(null); if (!v) return app.say("open a floor plan to sketch a floor in", "error");
  app.startSketch(v, { kind: "floor", id: null }, null);
}
/** Repeating Detail: sketch its path in the plan with the sketch tools; Finish places the component along it. */
function startRepeatSketch(component) {
  const v = app.views.get(app.activeView);
  if (!v || v.kind !== "PlanView") return app.say("open a plan to sketch a repeating detail in", "error");
  app.startSketch(v, { kind: "repeat", id: null, component }, null);
}
app.startRepeatSketch = startRepeatSketch;
function startRegionSketch() {
  const v = app.views.get(app.activeView);
  if (!v || v.kind !== "PlanView") return app.say("open a plan to sketch a filled region in", "error");
  app.startSketch(v, { kind: "region", id: null }, null);
}
/** Double-click is "step into": whatever the element is, go where it is edited - its view, its
 *  sketch, its text, its value, its type - rather than select-then-find-the-button. */
app.stepInto = (id, view) => {
  const doc = app.doc, f = doc.element(id); if (!f) return;
  const t = doc.typeOf(f);
  if (["ElevationView", "SectionView", "PlanView", "View3D", "Schedule", "Sheet"].includes(t)) return app.openView(id);
  if (t === "Floor") return app.editBoundary(id);
  if (t === "SiteBoundary") {
    const vv = view && view.kind === "PlanView" ? view : app.views.get(app.activeView); if (!vv || vv.kind !== "PlanView") return;
    return app.startSketch(vv, { kind: "site", id }, doc.argValue(f, "sketch"));
  }
  if (t === "RepeatingDetail") {
    const vv = view && view.kind === "PlanView" ? view : app.views.get(app.activeView); if (!vv || vv.kind !== "PlanView") return;
    return app.startSketch(vv, { kind: "repeat", id }, doc.argValue(f, "path"));
  }
  if (t === "FilledRegion") {
    const vv = view && view.kind === "PlanView" ? view : app.views.get(app.activeView); if (!vv || vv.kind !== "PlanView") return;
    const sk = doc.argValue(f, "sketch");
    return app.startSketch(vv, { kind: "region", id, pattern: F.text(f, "pattern") }, sk && sk.elements && sk.elements.length ? sk : fromPolygon(F.json(f, "boundary") || []));
  }
  app.select([id]);
  const ask = (title, label, value, apply) => {
    const inp = h(label === "Text" ? "textarea" : "input", { type: "text", value, rows: 4, style: { width: "320px" }, "aria-label": label }); if (label === "Text") inp.value = value;
    dialog(title, h("label", { style: { display: "grid", gap: "6px" } }, label, inp), [{ label: "Cancel", run: () => true }, { label: "OK", primary: true, run: () => { apply(inp.value); return true; } }]);
    setTimeout(() => { inp.focus(); inp.select && inp.select(); }, 30);
  };
  if (t === "Text") return ask(`Edit text ${id}`, "Text", F.text(f, "content"), v => app.apply({ op: "set", id, key: "content", value: v }));
  if (t === "Grid") return ask(`Grid ${F.text(f, "name")}`, "Name", F.text(f, "name"), v => app.apply([{ op: "set", id, key: "name", value: v }, { op: "rename", id, name: "Grid " + v }]));
  if (t === "Level") return ask(`Level ${F.text(f, "name")}`, "Name", F.text(f, "name"), v => app.apply([{ op: "set", id, key: "name", value: v }, { op: "rename", id, name: v }]));
  if (t === "Space") return ask(`Room ${id}`, "Name", f.get("Name") || "", v => app.apply({ op: "rename", id, name: v }));
  if (t === "Dimension") { setTimeout(() => { const b = document.querySelector("#main .overlay .tdim button:not(.lock)"); if (b) b.click(); }, 60); return; }
  if (["Door", "Window", "Wall", "Column", "Beam"].includes(t)) return app.run("edittype");
};
/** A floor's boundary, back in its sketch. A floor drawn before sketches (or imported) opens as its polygon. */
app.editBoundary = id => {
  const f = app.doc.element(id); if (!f || app.doc.typeOf(f) !== "Floor") return;
  const v = planViewForSketch(F.refId(f, "level")); if (!v) return app.say("open a plan of the floor's level first", "error");
  const sk = app.doc.argValue(f, "sketch");
  app.startSketch(v, { kind: "floor", id }, sk && sk.elements && sk.elements.length ? sk : fromPolygon(F.json(f, "boundary") || []));
};
function renderQAT() {
  const q = clear(document.getElementById("qat"));
  const b = (id, ic) => h("button", { class: "qbtn", title: COMMANDS[id].label + (COMMANDS[id].key ? ` (${COMMANDS[id].key})` : ""), "aria-label": COMMANDS[id].label, disabled: (id === "undo" && !app.editor.undoStack.length) || (id === "redo" && !app.editor.redoStack.length), onclick: () => app.run(id) }, icon(ic || COMMANDS[id].icon, 16));
  const v = app.activeView && app.doc.element(app.activeView);
  const viewName = v ? `${{ PlanView: "Floor Plan", ElevationView: "Elevation", SectionView: "Section", View3D: "3D View", Schedule: "Schedule", Sheet: "Sheet" }[app.doc.typeOf(v)]}: ${v.get("Name")}` : app.activeView === "__graph" ? "Node Graph" : app.activeView === "__spacegraph" ? "Brief Analysis" : app.activeView === "__tree" ? "Feature Tree" : app.activeView === "__diag" ? "Acceptance Tests" : "";
  q.append(
    h("button", { class: "qbtn mobile-only", "aria-label": "Palettes", onclick: () => document.body.classList.toggle("show-left") }, icon("menu", 16)),
    h("div", { class: "logo", title: "Web BIM" }, "B"),
    b("open"), b("save"), h("span", { class: "qsep" }), b("undo"), b("redo"), h("span", { class: "qsep" }),
    b("dim"), b("text"), h("span", { class: "qsep" }), b("default3d"), b("elev"), b("thin"), b("closehidden"),
    h("div", { class: "qtitle" }, h("b", {}, app.doc.meta.name), viewName ? " — " + viewName : ""),
    h("button", { class: "qbtn", title: "Export (PDF set, DXF)", "aria-label": "Export", onclick: () => exportDialog() }, icon("exportI", 16)),
    h("button", { class: "qswitch", title: "Switch to the parametric CAD interface (PC) - the same model", onclick: () => switchToCad() }, icon("view3d", 15), h("span", {}, "Parametric CAD")));
}
app.renderOptions = () => renderOptionsBar();
function renderOptionsBar() {
  const bar = clear(document.getElementById("options"));
  const o = app.toolOpts, doc = app.doc, t = app.tool;
  const typesOf = cat => Object.entries(doc.lib.types).filter(([id]) => (doc.resolveType(id) || {}).category === cat);
  const sel = (key, opts, label) => h("label", {}, label + " ", h("select", { onchange: e => { o[key] = e.target.value; } }, opts.map(([v, l]) => h("option", { value: v, selected: o[key] === v }, l))));
  // lengths: any unit, any maths; shown back in the project's unit
  const num = (key, label) => h("label", {}, label + " ", h("input", { type: "text", value: fmtLen(o[key] ?? 0), style: { width: "80px" }, onchange: e => { try { o[key] = parseLength(e.target.value); } catch (err) { app.say(`${e.target.value}: ${err.message}`, "error"); } e.target.value = fmtLen(o[key] ?? 0); } }));
  const chk = (key, label) => h("label", {}, h("input", { type: "checkbox", checked: !!o[key], onchange: e => { o[key] = e.target.checked; } }), " " + label);
  const els = [...app.selection].filter(id => doc.element(id));
  let title, kids = [];
  if (app.sketch) { app.sketch.optionsBar(bar); return; }
  if (app.pickMode) { title = `Bind ${app.pickMode.label}`; kids = [h("span", {}, "Click an element in the view"), h("button", { class: "btn small", onclick: app.endPick }, "Cancel")]; }
  else if (t === "select") { title = els.length ? `Modify | ${els.length} selected` : "Modify"; kids = els.length ? [h("span", { class: "muted" }, "Drag to move · MV CO RO MM · DE deletes · Esc clears")] : [h("span", { class: "muted" }, "Pick elements, or window-select by dragging on empty space")]; }
  else {
    title = `Modify | Place ${COMMANDS[t] ? COMMANDS[t].label : t}`;
    if (t === "wall") {
      // Revit's wall options: location line, offset from what is drawn, rounded chain corners
      const radiusOn = h("label", {}, h("input", { type: "checkbox", checked: !!o.wallRadiusOn, onchange: e => { o.wallRadiusOn = e.target.checked; } }), " Radius");
      kids = [sel("wallType", typesOf("IfcWall").map(([id, x]) => [id, x.name]), "Type:"), sel("mounting", ["Centred", "Core centre", "Core exterior", "Core interior", "Finish exterior", "Finish interior"].map(x => [x, x]), "Location Line:"), num("height", "Height:"), levelPicker(),
        num("wallOffset", "Offset:"), radiusOn, num("wallRadius", ""), ...((o.wallShape || "line") === "polygon" ? [h("label", {}, "Sides ", h("input", { type: "text", value: o.wallSides || 6, style: { width: "40px" }, onchange: e => { o.wallSides = Math.max(3, Math.round(Number(e.target.value)) || 6); } }))] : [])];
    }
    if (t === "grid") kids = [h("label", { title: "Ticked: new grids run horizontal or vertical" }, h("input", { type: "checkbox", checked: o.gridOrtho !== false, onchange: e => { o.gridOrtho = e.target.checked; } }), " Orthogonal")];
    if (t === "door") kids = [sel("doorType", typesOf("IfcDoor").map(([id, x]) => [id, x.name]), "Type:")];
    if (t === "window") kids = [sel("windowType", typesOf("IfcWindow").map(([id, x]) => [id, x.name]), "Type:"), num("sill", "Sill Height:")];
    if (t === "opening") kids = [num("width", "Width:"), num("height_", "Height:"), num("openSill", "Sill:")];
    if (t === "floor") kids = [sel("floorType", typesOf("IfcSlab").map(([id, x]) => [id, x.name]), "Type:"), num("floorOffset", "Height offset:")];
    if (t === "beam") kids = [sel("beamType", typesOf("IfcBeam").map(([id, x]) => [id, x.name]), "Type:"), num("beamTop", "Top offset:")];
    if (t === "column") kids = [sel("columnType", typesOf("IfcColumn").map(([id, x]) => [id, x.name]), "Type:"), levelPicker()];
    if (t === "space") kids = [h("label", {}, "Name: ", h("input", { type: "text", value: o.spaceName, style: { width: "110px" }, onchange: e => { o.spaceName = e.target.value; } })), sel("boundaryAt", [["finishFace", "Finish face (net)"], ["coreFace", "Core face"], ["coreCentre", "Core centre"], ["wallCentre", "Wall centre (gross)"]], "Boundary:")];
    if (t === "move") kids = [chk("moveCopy", "Copy")];
    if (t === "rotate") kids = [chk("rotateCopy", "Copy"), h("span", { class: "muted" }, "rotates about the selection's centre")];
    if (t === "mirror") kids = [chk("mirrorCopy", "Copy")];
    kids.push(h("button", { class: "btn small", onclick: () => app.setTool("select") }, "Finish ✓"));
  }
  bar.append(h("span", { class: "otitle" }, title), ...kids);
}
function levelPicker() {
  const lv = app.doc.elements().filter(f => app.doc.typeOf(f) === "Level");
  return h("label", {}, "Level: ", h("select", { onchange: e => { app.workLevel = e.target.value; } }, lv.map(f => h("option", { value: app.doc.idOf(f), selected: app.workLevel === app.doc.idOf(f) }, F.text(f, "name")))));
}
let openMenu = null;
function closeMenus() { if (openMenu) { openMenu.remove(); openMenu = null; } }
function menuAt(x, y, items) {
  closeMenus();
  const m = h("div", { class: "cmenu", role: "menu", style: { left: Math.min(x, window.innerWidth - 240) + "px", top: Math.min(y, window.innerHeight - items.length * 30 - 10) + "px" } },
    items.map(it => it === "-" ? h("div", { class: "csep" }) : h("button", { role: "menuitem", disabled: it.disabled, onclick: () => { closeMenus(); it.run(); } }, it.icon ? icon(it.icon, 16) : h("span", { style: { width: "16px" } }), h("span", {}, it.label), it.key ? h("span", { class: "ck" }, it.key) : null)));
  document.body.append(m); openMenu = m;
  setTimeout(() => window.addEventListener("pointerdown", ev => { if (!m.contains(ev.target)) closeMenus(); }, { once: true }), 0);
}
/** Right-click: the Revit context menu. */
app.contextMenu = (e) => {
  const items = [];
  const c = id => ({ label: COMMANDS[id].label, icon: COMMANDS[id].icon, key: COMMANDS[id].key, run: () => app.run(id) });
  items.push({ label: "Cancel", run: () => { app.setTool("select"); app.select([]); } });
  if (app.lastCommand && COMMANDS[app.lastCommand]) items.push({ label: `Repeat [${COMMANDS[app.lastCommand].label}]`, icon: COMMANDS[app.lastCommand].icon, run: () => app.run(app.lastCommand) });
  items.push("-");
  if (app.selection.size) items.push(c("showin3d"), c("selectionbox"), "-", c("selectall"), c("edittype"), c("move"), c("copy"), c("rotate"), c("mirror"), c("del"), "-");
  { const v = app.doc.element(app.activeView); if (v && app.doc.typeOf(v) === "View3D") items.push(c("sectionbox")); }
  items.push(c("zoomfit"), c("default3d"), c("props"));
  menuAt(e.clientX, e.clientY, items);
};
function fileMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  menuAt(r.left, r.bottom, [
    { label: "New", icon: "sheet", run: () => newEmpty() }, { label: "Open…", icon: "open", run: () => openFile() }, { label: "Save", icon: "save", run: () => saveModel() },
    "-", { label: "Export…", icon: "exportI", run: () => exportDialog() }, { label: "Import IFC…", icon: "importI", run: () => importIfcFile() }, { label: "Import DXF Symbol…", icon: "importI", run: () => importDXF() },
    "-", { label: "Project Information…", icon: "info", run: () => projectInfo() }, { label: "Reset to Sample Project (D1 RMUH)", icon: "house", run: () => { forget("draft-v5"); forget("tabs"); setDocument(buildRmuhSample(), { msg: "D1 RMUH sample loaded: the brief analysed, the client's plot as the site boundary", kind: "ok" }); app.openView("__spacegraph"); } },
    { label: "Studio House Sample", icon: "house", run: () => { forget("draft-v5"); forget("tabs"); setDocument(buildSample(), { msg: "Studio House sample loaded", kind: "ok" }); } },
  ]);
}

// ---------------------------------------------------------------- palettes: Properties over the Project Browser
function renderPalettes() {
  const leftEl = document.getElementById("left");
  // keep the browser where it was scrolled: a click re-renders it
  const keep = [...leftEl.querySelectorAll(".palette")].map(p => [p.classList.contains("browser") ? "browser" : "props", p.querySelector(".pbody") ? p.querySelector(".pbody").scrollTop : 0]);
  const left = clear(leftEl);
  const props = h("section", { class: "palette props" },
    h("header", {}, h("span", {}, "Properties"), h("button", { class: "pclose", title: "Close (PP toggles)", "aria-label": "Close Properties", onclick: () => document.body.classList.add("hide-props") }, "✕")));
  const pbody = h("div", { class: "pbody" }); props.append(pbody);
  const vp = [...app.selection].find(id => id.includes(":VP"));
  if (vp) renderViewportPanel(pbody, vp); else renderPanel(app, pbody);
  const browser = h("section", { class: "palette browser" },
    h("header", {}, h("span", {}, app.browserTab === "browser" ? `Project Browser - ${app.doc.meta.name}` : "Feature Tree"),
      h("div", { class: "ptabs" }, h("button", { "aria-pressed": String(app.browserTab === "browser"), onclick: () => { app.browserTab = "browser"; renderPalettes(); } }, "Views"), h("button", { "aria-pressed": String(app.browserTab === "tree"), onclick: () => { app.browserTab = "tree"; renderPalettes(); } }, "Tree"))));
  const bbody = h("div", { class: "pbody" }); browser.append(bbody);
  if (app.browserTab === "browser") renderBrowser(bbody); else renderTree(bbody);
  left.append(props, h("div", { class: "psplit", role: "separator", "aria-label": "Resize palettes", onpointerdown: splitDrag }), browser);
  const was = Object.fromEntries(keep);
  if (was.browser) bbody.scrollTop = was.browser;
  const selKey = [...app.selection].join(",");
  if (was.props && selKey === renderPalettes.selKey) pbody.scrollTop = was.props;
  renderPalettes.selKey = selKey;
}
function splitDrag(e) {
  const left = document.getElementById("left"), r = left.getBoundingClientRect();
  e.target.setPointerCapture(e.pointerId);
  const mv = ev => { const f = Math.max(0.2, Math.min(0.8, (ev.clientY - r.top) / r.height)); left.style.setProperty("--split", (f * 100).toFixed(1) + "%"); store("split", f); };
  e.target.addEventListener("pointermove", mv);
  e.target.addEventListener("pointerup", () => e.target.removeEventListener("pointermove", mv), { once: true });
}
// a click re-renders the palette, so the row a double-click started on is gone before
// the browser's dblclick: detect the second click ourselves, by row key and time
let lastRowClick = { key: null, t: 0 };
function rowClick(key, single, dbl) {
  const now = performance.now();
  if (dbl && lastRowClick.key === key && now - lastRowClick.t < 500) { lastRowClick = { key: null, t: 0 }; dbl(); return; }
  lastRowClick = { key, t: now }; if (single) single();
}
const ELEMENT_ICON = { Wall: "wall", Door: "door", Window: "window", Column: "column", Floor: "floor", Beam: "beam", Grid: "grid", Level: "level", Space: "room", Text: "text", Dimension: "dim",
  SectionView: "section", ElevationView: "elevview", PlanView: "plan", RoomSeparator: "sepline", DetailLine: "skline", FilledRegion: "skrect", SymbolInstance: "symbol", CADImport: "importI", Generic: "column", Furniture: "select" };
const BODY_TYPES = new Set(["Wall", "Column", "Door", "Window", "Floor", "Beam", "Generic"]);
/** What a view shows that can be picked in it - the inclusion test is "visible and editable here": the
 *  ids its drawing publishes as hits (plans, elevations, sections), or the bodies it shows (3D).
 *  Cached per model and view revision; with `quick`, an uncached view is worked out in the background
 *  (the browser shows its count when it arrives) rather than now. */
const CONTENTS = new Map(); let contentsQueue = [], contentsTimer = null;
function viewContents(vid, quick = false) {
  const doc = app.doc, v = doc.element(vid); if (!v) return null;
  const t = doc.typeOf(v); if (!["PlanView", "ElevationView", "SectionView", "View3D"].includes(t)) return null;
  const key = [doc.modelRevision, doc.viewRevision, JSON.stringify(doc.elementJSON(v))].join("|"), hit = CONTENTS.get(vid);
  if (hit && hit.key === key && hit.doc === doc) return hit.ids;
  if (quick) { if (!contentsQueue.includes(vid)) contentsQueue.push(vid); if (!contentsTimer) contentsTimer = setTimeout(drainContents, 30); return null; }
  let ids;
  if (t === "View3D") ids = doc.elements().filter(f => BODY_TYPES.has(doc.typeOf(f)) && !doc.error(f) && shownInView(doc, v, f)).map(f => doc.idOf(f));
  else ids = [...new Set(deriveView(doc, v).hits.map(x => x.id).filter(id => id && id !== vid && doc.element(id)))];
  const order = id => doc.typeOf(doc.element(id));
  ids.sort((a, b) => order(a).localeCompare(order(b)) || a.localeCompare(b, undefined, { numeric: true }));
  CONTENTS.set(vid, { key, ids, doc });
  return ids;
}
function drainContents() {
  contentsTimer = null; const t0 = performance.now();
  while (contentsQueue.length && performance.now() - t0 < 40) { try { viewContents(contentsQueue.shift()); } catch (e) { /* a view that cannot draw shows no count */ } }
  if (contentsQueue.length) contentsTimer = setTimeout(drainContents, 30); else renderPalettes();
}
function renameElement(id) {
  const f = app.doc.element(id); if (!f) return;
  const inp = h("input", { type: "text", value: f.get("Name") || id, style: { width: "280px" }, "aria-label": "Name" });
  dialog(`Rename ${id}`, h("label", { style: { display: "grid", gap: "6px" } }, "Name", inp), [{ label: "Cancel", run: () => true }, { label: "OK", primary: true, run: () => { app.apply({ op: "rename", id, name: inp.value }); return true; } }]);
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}
function node(label, kidsIn, opts = {}) {
  const key = opts.key || label, open = app.expanded.has(key);
  // children may be a function: built only when the node is open (a view's contents are not free)
  const kids = typeof kidsIn === "function" ? (open ? kidsIn() : []) : kidsIn;
  const toggle = () => { if (app.expanded.has(key)) app.expanded.delete(key); else app.expanded.add(key); renderPalettes(); };
  const li = h("li");
  const row = h("div", { class: "row" + (opts.sel ? " sel" : "") + (opts.active ? " active" : ""), draggable: opts.drag ? "true" : null, tabindex: 0,
    ondragstart: opts.drag ? (e => { e.dataTransfer.setData("text/x-webbim-view", opts.drag); e.dataTransfer.effectAllowed = "copy"; app.say("Drop it on a sheet: the viewport is centred where you let go", "note"); }) : null,
    onclick: () => rowClick(key, opts.onclick || (kids ? toggle : null), opts.ondbl),
    onkeydown: e => { if (e.key === "Enter") (opts.ondbl || opts.onclick || toggle)(); } },
    h("button", { class: "fold", tabindex: -1, "aria-label": open ? "Collapse" : "Expand", onclick: e => { e.stopPropagation(); toggle(); } }, kids ? (open ? "−" : "+") : ""),
    opts.ic ? icon(opts.ic, 14) : null,
    h("span", { class: "lab" + (opts.head ? " head" : "") }, label), opts.extra || null);
  li.append(row);
  if (kids && (open || app.treeFilter)) li.append(h("ul", {}, kids));
  return li;
}
function renderBrowser(body) {
  const doc = app.doc, els = doc.elements();
  const byType = t => els.filter(f => doc.typeOf(f) === t);
  const placed = new Map(); for (const sh of byType("Sheet")) for (const vp of doc.argValue(sh, "viewports") || []) placed.set(vp.view.ref, doc.argValue(sh, "number"));
  // single click selects the view (its properties show above); double-click opens it; drag it onto a sheet
  const viewRow = (f, ic) => {
    const id = doc.idOf(f), got = viewContents(id, true), n = got ? got.length : null;
    const count = n === null ? null : h("span", { class: "chip" + (n === 0 ? " warn" : ""), title: n === 0 ? "nothing visible and editable in this view" : `${n} element${n > 1 ? "s" : ""} visible and editable here - open the view's list` }, n === 0 ? "empty" : String(n));
    const kids = n === 0 ? null : () => (viewContents(id) || []).map(eid => elementRow(id, eid));
    return node(f.get("Name"), kids, { key: "view:" + id, ic, sel: app.selection.has(id), active: app.activeView === id, drag: id,
      onclick: () => app.select([id]), ondbl: () => app.openView(id),
      extra: h("span", { class: "extras" }, count, placed.has(id) ? h("span", { class: "chip", title: "placed on sheet" }, placed.get(id)) : null) });
  };
  /** One element in a view's list: click selects it (in that view), double-click steps into it, and
   *  its small tools rename or delete it. What is selected in the view is highlighted here. */
  const elementRow = (vid, eid) => {
    const f = doc.element(eid); if (!f) return null;
    const t = doc.typeOf(f), nm = f.get("Name"), label = `${t} ${eid}${nm && nm !== eid ? " · " + nm : ""}`;
    const tools = h("span", { class: "rowtools" },
      h("button", { class: "iconbtn", title: "Rename", "aria-label": `Rename ${eid}`, onclick: e => { e.stopPropagation(); renameElement(eid); } }, "✎"),
      h("button", { class: "iconbtn", title: "Delete", "aria-label": `Delete ${eid}`, onclick: e => { e.stopPropagation(); app.select([eid]); deleteSelection(); } }, "✕"));
    return node(label, null, { key: `in:${vid}:${eid}`, ic: ELEMENT_ICON[t] || "select", sel: app.selection.has(eid),
      onclick: () => { if (app.activeView !== vid) app.openView(vid); app.select([eid]); }, ondbl: () => app.stepInto(eid, app.views.get(vid)), extra: tools });
  };
  const tree = h("ul", { class: "tree" });
  tree.append(node("Views (all)", [
    node("Floor Plans", byType("PlanView").map(f => viewRow(f, "plan"))),
    node("3D Views", byType("View3D").map(f => viewRow(f, "view3d"))),
    node("Elevations (Building Elevation)", byType("ElevationView").map(f => viewRow(f, "elevview"))),
    node("Sections (Building Section)", byType("SectionView").map(f => viewRow(f, "section"))),
  ], { head: true }));
  tree.append(node("Schedules/Quantities (all)", byType("Schedule").map(f => viewRow(f, "schedule")), { head: true }));
  tree.append(node("Sheets (all)", byType("Sheet").sort((a, b) => String(doc.argValue(a, "number")).localeCompare(doc.argValue(b, "number"))).map(f => { const id = doc.idOf(f); return node(`${doc.argValue(f, "number")} - ${doc.argValue(f, "sheetName")}`, null, { key: "view:" + id, ic: "sheet", sel: app.selection.has(id), active: app.activeView === id, onclick: () => app.select([id]), ondbl: () => app.openView(id) }); }), { head: true }));
  const fams = doc.lib.families, roots = Object.keys(fams).filter(k => !fams[k].extends);
  const famNode = id => node(fams[id].name, [
    ...Object.keys(fams).filter(k => fams[k].extends === id).map(famNode),
    ...Object.entries(doc.lib.types).filter(([, t]) => t.family === id).map(([tid, t]) => node(t.name || tid, null, { onclick: () => { const k = { IfcWall: "wallType", IfcDoor: "doorType", IfcWindow: "windowType", IfcColumn: "columnType" }[(doc.resolveType(tid) || {}).category]; if (k) app.toolOpts[k] = tid; }, ondbl: () => typeEditor(app, tid) })),
  ], { key: "fam:" + id });
  tree.append(node("Families", roots.map(r => node((doc.lib.categories[fams[r].category] || {}).name || fams[r].category, [famNode(r)], { key: "cat:" + r })), { head: true }));
  tree.append(node("Levels", byType("Level").map(f => node(`${F.text(f, "name")} (${fmtLen(F.real(f, "elevation"))})`, null, { ic: "level", sel: app.selection.has(doc.idOf(f)), onclick: () => app.select([doc.idOf(f)]) })), { head: true }));
  tree.append(node("Relationships", [
    node("Joins", doc.joins.map(j => node(`${j.a.of}.${j.a.end} ⟷ ${j.b.of}${j.b.end ? "." + j.b.end : " @ " + Math.round(j.b.u)}`, null, { onclick: () => app.select([j.a.of, j.b.of]) }))),
    node("Constraints", doc.constraints.map(c => node(`${c.id} ${c.kind} ${c.value ?? ""}${c.locked === false ? " (off)" : ""}`, null, { onclick: () => app.select(c.of.map(r => r.split(":")[0]).filter(id => doc.element(id))),
      extra: h("button", { class: "iconbtn", title: c.locked === false ? "Enable" : "Disable", "aria-label": `Toggle ${c.id}`, onclick: e => { e.stopPropagation(); app.apply({ op: "relate", store: "constraints", row: Object.assign({}, c, { locked: c.locked === false }) }); } }, icon(c.locked === false ? "unlock" : "lock", 14)) }))),
  ], { head: true }));
  body.append(tree);
}
function renderTree(body) {
  const doc = app.doc, q = app.treeFilter.toLowerCase();
  const input = h("input", { type: "search", placeholder: "Search", value: app.treeFilter, "aria-label": "Search the feature tree", oninput: e => { app.treeFilter = e.target.value; const pos = e.target.selectionStart; renderPalettes(); const i = document.querySelector(".browser .search input"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } } });
  body.append(h("div", { class: "search" }, input));
  const ul = h("ul", { class: "tree" });
  for (const f of doc.elements()) {
    const id = doc.idOf(f), name = f.get("Name"), t = doc.typeOf(f);
    if (q && !(`${name} ${id} ${t}`.toLowerCase().includes(q))) continue;
    const err = doc.error(f), note = doc.note(f);
    ul.append(h("li", {}, h("div", { class: "row" + (app.selection.has(id) ? " sel" : ""), onclick: e => rowClick("el:" + id, () => app.select([id], e.shiftKey || e.ctrlKey || e.metaKey), () => app.revealInView(id)), title: err || note || (CATALOGUE.get(t) || {}).summary || "" },
      h("span", { class: "dot " + (err ? "err" : note ? "note" : "ok") }),
      h("button", { class: "eye", "aria-pressed": String(f.get("Integer") !== 0), "aria-label": `Toggle visibility of ${id}`, onclick: e => { e.stopPropagation(); app.apply({ op: "set", id, key: "visible", value: f.get("Integer") === 0 }); } }, "◉"),
      h("span", { class: "lab", style: f.get("Integer") === 0 ? { opacity: .5 } : {} }, name), h("span", { class: "id" }, `${t} · ${id}`))));
  }
  body.append(ul);
}
function renderViewportPanel(body, key) {
  const [shId, vpId] = key.split(":"), doc = app.doc, sh = doc.element(shId);
  const vp = (doc.argValue(sh, "viewports") || []).find(v => v.id === vpId); if (!vp) return;
  const view = doc.element(vp.view.ref);
  body.append(h("div", { class: "pp" }, h("div", { class: "pp-head" }, h("div", { style: { fontWeight: 600, fontSize: "14px" } }, `Viewport ${vpId}`), h("div", { class: "muted" }, "A frame holding a view, not a copy of it. Scale and crop live on the view.")),
    h("div", { class: "prow" }, h("label", {}, "View"), h("div", { class: "val" }, h("button", { class: "btn small", onclick: () => app.openView(vp.view.ref) }, view ? view.get("Name") : vp.view.ref))),
    h("div", { class: "prow" }, h("label", {}, "Position"), h("div", { class: "ro mono" }, `${fmtLen(vp.at[0])}, ${fmtLen(vp.at[1])} on paper`)),
    h("div", { class: "prow" }, h("label", { for: "vp-clip" }, "Show crop"), h("div", { class: "ro" }, h("input", { id: "vp-clip", type: "checkbox", checked: !!vp.clipVisible, onchange: e => app.apply({ op: "sheet", id: shId, viewport: vpId, value: { clipVisible: e.target.checked } }) }))),
    view && F.int(view, "scale") ? h("div", { class: "prow" }, h("label", {}, "Scale"), h("div", { class: "ro" }, "1:" + F.int(view, "scale"))) : null,
    h("div", { style: { padding: "12px 14px" } }, h("button", { class: "btn", onclick: () => { app.apply({ op: "sheet", id: shId, viewport: vpId, remove: true }); app.select([]); app.say("Viewport removed; the view itself survives", "ok"); } }, "Remove from sheet"))));
}

// ---------------------------------------------------------------- the view area: document tabs, view, view control bar
function renderMain() {
  const cams3d = new Map();
  for (const [k, v] of app.views) if (v && v.dispose) { cams3d.set(k, v.cam); v.dispose(); app.views.delete(k); }
  const area = clear(document.getElementById("main"));
  const doc = app.doc;
  const tabs = h("div", { class: "dtabs", role: "tablist" }, app.tabs.map(t => {
    const f = doc.element(t), label = t === "__graph" ? "Node Graph" : t === "__spacegraph" ? "Brief Analysis" : t === "__diag" ? "Acceptance Tests" : t === "__tree" ? "Feature Tree" : f ? f.get("Name") : t;
    const ic = t === "__graph" ? "graph" : t === "__spacegraph" ? "bubbles" : t === "__diag" ? "tests" : t === "__tree" ? "tree" : { PlanView: "plan", View3D: "view3d", ElevationView: "elevview", SectionView: "section", Schedule: "schedule", Sheet: "sheet" }[f && doc.typeOf(f)];
    return h("button", { class: "dtab", role: "tab", "aria-selected": String(t === app.activeView), onclick: () => app.openView(t), onauxclick: e => { if (e.button === 1) app.closeTab(t); } }, icon(ic, 14), h("span", {}, label),
      h("span", { class: "x", role: "button", "aria-label": `Close ${label}`, onclick: e => { e.stopPropagation(); app.closeTab(t); } }, "✕"));
  }));
  const main = h("div", { class: "viewhost" });
  const vcb = h("div", { class: "vcb", id: "vcb" });
  area.append(tabs, main, vcb);
  const id = app.activeView;
  if (!id) { main.append(h("div", { class: "empty", style: { maxWidth: "520px", margin: "60px auto" } }, h("h3", {}, "No view open"), "Double-click a view in the Project Browser, or press the 3D house in the Quick Access Toolbar.")); return; }
  if (id === "__graph") { renderGraph(app, main, app.graphFocus); app.graphFocus = null; app.views.set(id, {}); return; }
  if (id === "__diag") { renderDiagnostics(main); app.views.set(id, {}); return; }
  if (id === "__spacegraph") { renderSpaceGraph(app, main); app.views.set(id, {}); return; }
  if (id === "__tree") { const b = h("div", { class: "sheetpane" }, h("div", { class: "doccard" }, h("header", {}, h("h2", {}, "Feature Tree"), h("span", { class: "muted" }, "construction order; ● built, ● note, ● error; double-click shows it")), h("div", { style: { padding: "0 0 10px" } }))); renderTree(b.querySelector(".doccard > div")); main.append(b); app.views.set(id, {}); return; }
  const v = doc.element(id); if (!v) { app.closeTab(id); return; }
  const t = doc.typeOf(v);
  if (t === "Schedule") { renderSchedule(app, main, v); app.views.set(id, {}); renderViewControl(); return; }
  if (t === "View3D" && visual3d(id) !== "Sheet Line-work") { const view = new View3D(app, main, id); if (cams3d.has(id)) { view.cam = cams3d.get(id); view.render(); } app.views.set(id, view); renderViewControl(); return; }
  const prev = app.views.get(id);
  const view = new View2D(app, main, id);
  if (prev && prev.cam) view.cam = prev.cam;
  app.views.set(id, view);
  view.canvas.addEventListener("keydown", e => { if (view.key(e)) { e.preventDefault(); e.stopPropagation(); } });
  view.draw();
  renderViewControl();
}
/** The view control bar: scale, detail level, visual style, thin lines, crop, VV — at the foot of the view. */
/** The view's style as a dropdown: the file's styles, "None", and "Edit…" (the View Style editor). */
function styleSelect(id, cls) {
  const doc = app.doc, v = doc.element(id), st = F.refId(v, "style") || "";
  return h("select", { class: cls, title: "View style (view template)", "aria-label": "View style", onchange: e => {
      const val = e.target.value;
      if (val === "__edit") { e.target.value = st; return viewStyleEditor(app, st || Object.keys(doc.lib.viewStyles)[0], id); }
      app.apply({ op: "set", id, key: "style", value: val ? { ref: val } : null });
    } },
    h("option", { value: "", selected: !st }, "<None>"),
    Object.entries(doc.lib.viewStyles).map(([k, s]) => h("option", { value: k, selected: k === st }, s.name || k)),
    h("option", { value: "__edit" }, "Edit view styles…"));
}
app.styleSelect = styleSelect;
function visual3d(id) { const v = app.doc.element(id); return (v && F.choice(v, "visualStyle")) || "Shaded"; }
function renderViewControl() {
  const bar = document.getElementById("vcb"); if (!bar) return; clear(bar);
  const doc = app.doc, id = app.activeView, v = doc.element(id); if (!v) return;
  const t = doc.typeOf(v);
  const ib = (ic, title, on, run) => h("button", { class: "vbtn", title, "aria-label": title, "aria-pressed": on === undefined ? null : String(!!on), onclick: run }, icon(ic, 16));
  if (["PlanView", "ElevationView", "SectionView", "View3D"].includes(t)) bar.append(h("select", { class: "vscale", "aria-label": "View scale", title: lockedKey(doc, v, "scale") ? `View scale - set by the view style ${lockedKey(doc, v, "scale")}` : "View scale", disabled: !!lockedKey(doc, v, "scale"), onchange: e => app.apply({ op: "set", id, key: "scale", value: Number(e.target.value) }) }, [10, 20, 50, 100, 200, 500].map(s => h("option", { value: s, selected: F.int(v, "scale") === s }, "1 : " + s))));
  if (t === "PlanView" || t === "ElevationView" || t === "SectionView") {
    const dl = F.choice(v, "detailLevel");
    bar.append(h("select", { class: "vsel", title: lockedKey(doc, v, "detailLevel") ? `Detail level - set by the view style ${lockedKey(doc, v, "detailLevel")}` : "Detail level", "aria-label": "Detail level", disabled: !!lockedKey(doc, v, "detailLevel"), onchange: e => app.apply({ op: "set", id, key: "detailLevel", value: e.target.value }) }, ["Coarse", "Medium", "Fine"].map(d => h("option", { selected: dl === d }, d))));
    const st = F.refId(v, "style");
    bar.append(styleSelect(id, "vsel"));
    if (t === "PlanView") {
      const clip = doc.argValue(v, "clip") || {};
      const withRect = c => Object.assign({}, clip, { rect: clip.rect || [-5000, -5000, 20000, 15000] }, c);
      bar.append(ib("fit", "Crop view", clip.active, () => app.apply({ op: "set", id, key: "clip", value: withRect({ active: !clip.active }) })));
      bar.append(ib("crop", "Show crop region", clip.visible, () => app.apply({ op: "set", id, key: "clip", value: withRect({ visible: !clip.visible }) })));
      bar.append(h("button", { class: "btn small", title: "Edit Crop: sketch the boundary - any shape", onclick: () => { if (!clip.rect || !clip.visible) app.apply({ op: "set", id, key: "clip", value: withRect({ visible: true }) }); const v = app.views.get(id); if (v && v.startCropSketch) v.startCropSketch(); } }, "Edit Crop"));
      if (clip.shape) bar.append(h("button", { class: "btn small", title: "Back to a rectangle", onclick: () => app.apply({ op: "set", id, key: "clip", value: Object.assign({}, clip, { shape: null }) }) }, "Reset Crop"));
      bar.append(h("select", { class: "vsel", "aria-label": "Colour fill", title: "Colour-fill plan", onchange: e => { const ov = Object.assign({}, doc.argValue(v, "overrides") || {}); if (e.target.value) ov.__colourFill = e.target.value; else delete ov.__colourFill; app.apply({ op: "set", id, key: "overrides", value: ov }); } },
        h("option", { value: "" }, "No colour fill"), ["Department", "Number", "Name"].map(k => h("option", { value: k, selected: (doc.argValue(v, "overrides") || {}).__colourFill === k }, "Fill by " + k))));
    }
  }
  if (t === "View3D") {
    bar.append(styleSelect(id, "vsel"));
    const cur = visual3d(id), lk = lockedKey(doc, v, "visualStyle");
    bar.append(h("select", { class: "vsel", title: lk ? `Visual style - set by the view style ${lk}` : "Visual style", "aria-label": "Visual style", disabled: !!lk, onchange: e => app.apply({ op: "set", id, key: "visualStyle", value: e.target.value }) }, [...VISUAL_STYLES, "Sheet Line-work"].map(s => h("option", { selected: s === cur }, s))));
    const view = app.views.get(id);
    if (view && view.saveCamera) bar.append(h("button", { class: "btn small", title: "Store this camera in the view (and its sheets)", onclick: () => view.saveCamera() }, "Save camera"));
  }
  bar.append(ib("thin", "Thin lines (screen only)", app.thinLines, () => app.run("thin")));
  if (t !== "Schedule" && t !== "Sheet") bar.append(ib("vv", "Visibility/Graphics (VV)", undefined, () => app.run("vv")));
  bar.append(ib("fit", "Zoom to fit (ZF)", undefined, () => app.run("zoomfit")));
  const snaps = h("div", { class: "snaps", role: "group", "aria-label": "Snaps" }, SNAP_KINDS.map(k => h("button", { "aria-pressed": String(!!app.snaps[k]), title: `Snap: ${k}`, onclick: e => { app.snaps[k] = !app.snaps[k]; e.target.setAttribute("aria-pressed", String(app.snaps[k])); store("snaps", app.snaps); } }, { endpoint: "end", midpoint: "mid", centre: "cen", intersection: "int", perpendicular: "perp", nearest: "near", grid: "grid", angle: "15°" }[k])));
  if (t === "PlanView") bar.append(h("span", { class: "grow" }), snaps);
}

// ---------------------------------------------------------------- status bar
function updateStatus() {
  const st = document.getElementById("status");
  if (!st.querySelector("#msg")) { clear(st); st.append(h("div", { id: "msg", class: "msg", role: "status", "aria-live": "polite" }, "Ready"), h("div", { id: "stats", class: "mono hide-narrow" })); }
  const s = app.doc.stats, lr = s.lastRegen;
  document.getElementById("stats").textContent = `${app.selection.size ? app.selection.size + " selected · " : ""}regen ${lr ? lr.ms.toFixed(1) : "–"} ms · ${lr ? lr.rebuilt.length : 0} rebuilt · rev ${app.doc.modelRevision}/${app.doc.viewRevision}`;
}

// ---------------------------------------------------------------- commands' bodies
function deleteSelection() {
  const ids = [...app.selection].filter(id => app.doc.element(id)), vps = [...app.selection].filter(id => id.includes(":VP"));
  if (!ids.length && !vps.length) return app.say("nothing selected to delete", "note");
  if (ids.length) { const r = app.apply({ op: "delete", ids }); if (r.ok) app.say(`Deleted ${r.deleted.join(", ")}`, "ok"); }
  for (const k of vps) { const [sh, vp] = k.split(":"); app.apply({ op: "sheet", id: sh, viewport: vp, remove: true }); }
  app.select([]);
}
function selectAllInstances() {
  const t = selectedType(); const f0 = app.doc.element([...app.selection][0]);
  if (!f0) return app.say("select one element first", "note");
  const ids = app.doc.elements().filter(f => t ? ["wallType", "doorType", "windowType", "columnType"].some(k => F.refId(f, k) === t) : app.doc.typeOf(f) === app.doc.typeOf(f0)).map(f => app.doc.idOf(f));
  app.select(ids); app.say(`${ids.length} instances selected`, "note");
}
/** Levels with no floor plan yet: one plan per level, so these are the only ones a new plan can be for. */
function levelsWithoutPlan() {
  const planned = new Set(app.doc.elements().filter(f => app.doc.typeOf(f) === "PlanView").map(f => F.refId(f, "level")));
  return app.doc.elements().filter(f => app.doc.typeOf(f) === "Level" && !planned.has(app.doc.idOf(f)))
    .sort((a, b) => F.real(a, "elevation") - F.real(b, "elevation"));
}
/** View ▸ Floor Plan, as Revit's New Floor Plan: pick among the levels that have no plan (several at once). */
function floorPlanDialog() {
  const free = levelsWithoutPlan();
  if (!app.doc.elements().some(f => app.doc.typeOf(f) === "Level")) return app.say("add a level first (LL)", "error");
  if (!free.length) return app.say("every level already has its floor plan: open it from the Project Browser", "note");
  const picked = new Set(free.length === 1 ? [app.doc.idOf(free[0])] : []);
  const list = h("div", { class: "levelpick", role: "listbox", "aria-multiselectable": "true", style: { display: "grid", gap: "2px", maxHeight: "50vh", overflow: "auto", minWidth: "280px" } },
    free.map(f => { const id = app.doc.idOf(f);
      return h("label", { style: { display: "flex", gap: "8px", alignItems: "center", padding: "3px 4px" } },
        h("input", { type: "checkbox", checked: picked.has(id), onchange: e => e.target.checked ? picked.add(id) : picked.delete(id) }),
        h("span", { style: { flex: "1" } }, F.text(f, "name") || id), h("span", { class: "muted" }, `+${(F.real(f, "elevation") / 1000).toFixed(3)}`)); }));
  dialog("New Floor Plan", h("div", { style: { display: "grid", gap: "8px" } },
    h("div", { class: "muted" }, "Levels without a floor plan. Each level has one plan; pick one or more."), list), [
    { label: "Select all", run: () => { list.querySelectorAll("input").forEach((c, i) => { c.checked = true; picked.add(app.doc.idOf(free[i])); }); return false; } },
    { label: "Cancel", run: () => true },
    { label: "OK", primary: true, run: () => { if (!picked.size) { app.say("pick a level", "note"); return false; } let last = null; for (const id of picked) last = newPlanView(id, { open: false }) || last; if (last) app.openView(last); app.say(`${picked.size} floor plan${picked.size > 1 ? "s" : ""} made`, "ok"); return true; } },
  ]);
}
function newPlanView(levelId, { open = true } = {}) {
  const lv = levelId || app.workLevel || firstOf("Level"); if (!lv) return app.say("add a level first", "error");
  // one plan per level: a level that has one opens it
  const has = app.doc.elements().find(f => app.doc.typeOf(f) === "PlanView" && F.refId(f, "level") === lv);
  if (has) { if (open) app.openView(app.doc.idOf(has)); return app.doc.idOf(has); }
  const r = app.apply({ op: "add", element: { type: "PlanView", name: `${F.text(app.doc.element(lv), "name")} Plan`, args: { level: { ref: lv }, scale: 100, viewRange: { top: 2300, cut: 1200, bottom: 0 }, detailLevel: "Fine", style: { ref: "VS-CONSTRUCTION" }, filters: [], clip: { rect: null, visible: false, active: false }, overrides: {} } } });
  if (r.ok && open) app.openView(r.id);
  return r.ok ? r.id : null;
}
function newLevel() {
  const lv = app.doc.elements().filter(f => app.doc.typeOf(f) === "Level");
  const top = Math.max(0, ...lv.map(f => F.real(f, "elevation")));
  const name = `Level ${lv.length + 1}`;
  const r = app.apply({ op: "add", element: { type: "Level", name, args: { name, elevation: lv.length ? top + 3000 : 0 } } });
  if (r.ok) { app.workLevel = r.id; newPlanView(r.id); app.say(`${name} at +${((lv.length ? top + 3000 : 0) / 1000).toFixed(3)} with its floor plan — set the elevation in Properties`, "ok"); }
}
function newSchedule() { const r = app.apply({ op: "add", element: { type: "Schedule", name: "Wall Schedule " + (app.doc.elements().filter(f => app.doc.typeOf(f) === "Schedule").length + 1), args: { of: "IfcWall", fields: ["Id", "TypeMark", "Length", "Height", "FireRating", "Phase"] } } }); if (r.ok) app.openView(r.id); }
function newSheet() {
  const n = app.doc.elements().filter(f => app.doc.typeOf(f) === "Sheet").length + 1;
  const r = app.apply({ op: "add", element: { type: "Sheet", name: `A-${100 + n} Unnamed`, args: { number: `A-${100 + n}`, sheetName: "Unnamed", size: "A1", orientation: "landscape", viewports: [], revision: "P01" } } });
  if (r.ok) { app.openView(r.id); app.say("Drag a view from the Project Browser onto the sheet: it lands where you drop it", "note"); }
}
function placeSymbol(symId) {
  const v = app.activeView && app.doc.element(app.activeView);
  if (!v || app.doc.typeOf(v) !== "PlanView") return app.say("open a plan view to place a symbol in", "note");
  const view = app.views.get(app.activeView), c = view.toModel(view.W / 2, view.H / 2);
  app.apply({ op: "add", element: { type: "SymbolInstance", args: { symbol: { ref: symId }, position: c.map(Math.round), rotation: 0, view: { ref: app.activeView } } } });
}
/** Revit's Project Units (UN). The model is millimetres whatever is chosen: this is how lengths are
 *  written - in Properties, temporary dimensions, schedules and on the drawings - and what a number
 *  typed with no unit means. Fields always take any unit: 10m, 3'-6", 250mm + 2*1.2m, L1 + 300. */
function unitsDialog() {
  const cur = app.doc.meta.displayUnits || "mm";
  const sample = u => `${fmtLength(3657.6, { unit: u })} · ${fmtLength(215, { unit: u })}`;
  const sel = h("select", { "aria-label": "Length unit" }, Object.entries(LENGTH_UNITS).map(([k, u]) => h("option", { value: k, selected: k === cur }, `${u.label} - e.g. ${sample(k)}`)));
  const tryIn = h("input", { type: "text", placeholder: `try 10m, 3'-6", 2*1.2m + 300mm`, "aria-label": "Try a value" }), out = h("div", { class: "muted" }, " ");
  const show = () => { try { out.textContent = tryIn.value.trim() ? `= ${fmtLength(parseLength(tryIn.value, { unit: sel.value }), { unit: sel.value })}  (${Math.round(parseLength(tryIn.value, { unit: sel.value }) * 1000) / 1000} mm in the model)` : " "; out.classList.remove("err"); } catch (e) { out.textContent = e.message; out.classList.add("err"); } };
  tryIn.addEventListener("input", show); sel.addEventListener("change", show);
  dialog("Project Units", h("div", { style: { display: "grid", gap: "10px", minWidth: "360px" } },
    h("label", {}, "Length ", sel),
    h("div", { class: "muted" }, "The model is always millimetres - switching changes how lengths are shown and what a bare number means, never a size. Any field takes any unit and maths."),
    h("label", {}, "Try: ", tryIn), out), [
    { label: "Cancel", run: () => true },
    { label: "OK", primary: true, run: () => { const r = app.apply({ op: "units", value: sel.value }); if (r.ok) app.say(`Lengths now shown in ${LENGTH_UNITS[sel.value].label}`, "ok"); return true; } },
  ]);
}
function projectInfo() {
  const inp = h("input", { type: "text", value: app.doc.meta.name, id: "pi-name" });
  dialog("Project Information", h("div", { style: { display: "grid", gap: "8px" } }, h("label", { for: "pi-name" }, "Project name"), inp), [{ label: "Cancel", run: () => true }, { label: "OK", primary: true, run: () => { app.doc.meta.name = inp.value; saveDraftSoon(); app.refresh({ keepMain: true }); } }]);
}
function openFile() {
  const inp = h("input", { type: "file", accept: ".json,application/json", hidden: true }); document.body.append(inp);
  inp.addEventListener("change", async () => { const file = inp.files[0]; inp.remove(); if (!file) return;
    try { const doc = openDocument(await file.text()); doc.regenerate(); setDocument(doc, { msg: `Opened ${file.name}${doc.loadReport.length ? " — " + doc.loadReport.join("; ") : ""}`, kind: doc.loadReport.length ? "note" : "ok" }); }
    catch (err) { app.say(`Could not open ${file.name}: ${err.message}`, "error"); } });
  inp.click();
}
async function saveModel() { const r = await saveFile(`${app.doc.meta.name || "model"}.json`, app.doc.serialise(), "application/json"); app.say(r.ok ? "Model saved" : r.error, r.ok ? "ok" : "error"); }
function newEmpty() {
  forget("draft-v5"); forget("tabs");
  const doc = newDocument("Untitled");
  doc.addElement({ id: "L0", type: "Level", name: "Level 1", args: { name: "Level 1", elevation: 0 } });
  doc.addElement({ id: "L1", type: "Level", name: "Level 2", args: { name: "Level 2", elevation: 3000 } });
  doc.addElement({ id: "V-P00", type: "PlanView", name: "Level 1", args: { level: { ref: "L0" }, scale: 100, style: { ref: "VS-CONSTRUCTION" } } });
  doc.addElement({ id: "V-P01", type: "PlanView", name: "Level 2", args: { level: { ref: "L1" }, scale: 100, style: { ref: "VS-CONSTRUCTION" } } });
  doc.regenerate();
  setDocument(doc, { msg: "New model: press WA to draw walls, or 3D to model in the {3D} view", kind: "ok" });
}
/** IFC in as the building: classes mapped to Web BIM classes, one undo step, and a report of what did not map. */
function importIfcFile() {
  const inp = h("input", { type: "file", accept: ".ifc", hidden: true }); document.body.append(inp);
  inp.addEventListener("change", async () => {
    const file = inp.files[0]; inp.remove(); if (!file) return;
    let r;
    try { r = importIfc(app.doc, await file.text()); } catch (e) { return app.say(`Could not read ${file.name}: ${e.message}`, "error"); }
    const res = app.apply(r.ops);
    if (!res.ok) return app.say(`${file.name}: ${res.error}`, "error");
    // "9 Floors (footing)", not "9 Floor (footing)s"
    const plural = (k, n) => n > 1 ? (/ \(/.test(k) ? k.replace(/ \(/, "s (") : k + "s") : k;
    const made = Object.entries(r.report.made).map(([k, n]) => `${n} ${plural(k, n)}`).join(", ") || "nothing";
    const missed = Object.entries(r.report.missed).map(([k, n]) => `${n} × ${k}${r.report.why && r.report.why[k] ? " (" + Object.entries(r.report.why[k]).map(([w, c]) => (c > 1 ? c + ": " : "") + w).join("; ") + ")" : ""}`).join(", ");
    dialog(`Imported ${file.name}`, h("div", { style: { display: "grid", gap: "8px" } },
      h("div", {}, `Made: ${made}${r.types ? ` · ${r.types} new type${r.types > 1 ? "s" : ""}` : ""}.`),
      missed ? h("div", { class: "banner note" }, `Not mapped (kept out, counted here): ${missed}. The Parametric CAD interface's IFC package can bring these in as geometry.`) : null,
      ...r.report.notes.map(n => h("div", { class: "muted" }, n))), [{ label: "OK", primary: true, run: () => true }]);
    app.say(`${file.name}: ${made}`, "ok");
  });
  inp.click();
}
/** Revit's Import CAD: the DXF into the active 2D view as one element, origin to origin, pinned. */
function importCAD() {
  const v = app.views.get(app.activeView);
  if (!v || !["PlanView", "ElevationView", "SectionView", "Sheet"].includes(v.kind)) return app.say("open a plan, elevation, section or sheet to import into", "error");
  const inp = h("input", { type: "file", accept: ".dxf", hidden: true }); document.body.append(inp);
  inp.addEventListener("change", async () => {
    const file = inp.files[0]; inp.remove(); if (!file) return;
    const text = await file.text();
    const place = r => {
      const { drawing } = dxfDrawing(r), layers = drawing.layers;
      if (!drawing.elements.length && !drawing.texts.length) return app.say(`${file.name}: nothing drawable in it (${r.message})`, "error");
      const res = app.apply({ op: "add", element: { type: "CADImport", name: file.name, args: { file: file.name, drawing, view: { ref: app.activeView }, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, pinned: true } } });
      if (!res.ok) return;
      app.select([res.id]); const vv = app.views.get(app.activeView); if (vv && vv.fit) vv.fit();
      const skipped = Object.entries(r.manifest.skipped || {}).map(([k, n]) => `${n} × ${k}`).join(", ");
      app.say(`${file.name}: ${drawing.elements.length} elements on ${Object.keys(layers).length} layers, pinned at the origin${skipped ? ` · not read: ${skipped}` : ""}`, "ok");
    };
    const r = readDXF(text);
    if (r.needsUnits) {
      const sel = h("select", { "aria-label": "Units" }, ["mm", "cm", "m", "in", "ft"].map(u => h("option", {}, u)));
      dialog("This DXF does not say its units", h("div", { style: { display: "grid", gap: "8px" } }, h("div", {}, "$INSUNITS is missing or 0. Which unit was it drawn in?"), sel),
        [{ label: "Cancel", run: () => true }, { label: "Import", primary: true, run: () => { place(readDXF(text, { askUnits: () => sel.value })); return true; } }]);
    } else place(r);
  });
  inp.click();
}
function importDXF() {
  const inp = h("input", { type: "file", accept: ".dxf", hidden: true });
  document.body.append(inp);
  inp.addEventListener("change", async () => {
    const file = inp.files[0]; inp.remove(); if (!file) return;
    const text = await file.text();
    const finish = (r, units) => {
      const bb = r.bbox, w = bb[2] - bb[0], hh = bb[3] - bb[1];
      const wIn = h("input", { type: "number", value: 18, min: 1, style: { width: "80px" }, "aria-label": "Nominal width" }), space = h("select", { "aria-label": "Space" }, h("option", { value: "paper" }, "paper (constant on the sheet)"), h("option", { value: "model" }, "model (scales with the drawing)"));
      dialog(`Import ${file.name}`, h("div", { style: { display: "grid", gap: "8px" } },
        h("div", {}, r.message, units ? ` · read as ${units}` : ""),
        h("div", { class: "mono" }, `measured ${fmtLen(w)} × ${fmtLen(hh)}`),
        h("label", {}, "Nominal width, mm ", wIn), h("label", {}, "Space ", space),
        h("div", { class: "muted" }, "Scale = nominal ÷ measured, smaller ratio under uniform. DXF layers become the symbol's subcategories.")),
        [{ label: "Cancel", run: () => true }, { label: "Add symbol", primary: true, run: () => {
          const id = "SY-" + file.name.replace(/\.dxf$/i, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 16);
          const nw = Number(wIn.value) || 18, nh = nw * hh / (w || 1);
          app.apply({ op: "type", lib: "symbols", id, value: { name: file.name.replace(/\.dxf$/i, ""), source: { text: units ? text.replace(/\$INSUNITS\s*\n\s*70\s*\n\s*\d+/, "$INSUNITS\n70\n4") : text, units }, sourceBBox: { w, h: hh }, nominalSize: { w: nw, h: nh }, scaleMode: "uniform", anchor: "centre", space: space.value } });
          app.say(`Symbol ${id} added — ${r.message}`, "ok");
        } }]);
    };
    const r = readDXF(text);
    if (r.needsUnits) {
      // $INSUNITS absent or 0: ask, never guess (§12.4)
      const sel = h("select", { "aria-label": "Units" }, ["mm", "cm", "m", "in", "ft"].map(u => h("option", {}, u)));
      dialog("This DXF does not say its units", h("div", { style: { display: "grid", gap: "8px" } }, h("div", {}, "$INSUNITS is missing or 0. Which unit was it drawn in? A factor of 25.4 applied twice or not at all is the cheapest catastrophic bug in this space."), sel),
        [{ label: "Cancel", run: () => true }, { label: "Read it", primary: true, run: () => finish(readDXF(text, { askUnits: () => sel.value }), sel.value) }]);
    } else finish(r, r.units);
  });
  inp.click();
}

// ---------------------------------------------------------------- hidden-line line-work, kept current automatically
/** 3D views placed on these sheets whose line-work is missing or out of date. */
function staleHiddenLine(sheets) {
  const doc = app.doc, ids = new Set();
  for (const sh of sheets) for (const vp of doc.argValue(sh, "viewports") || []) { const v = doc.element(vp.view.ref); if (v && doc.typeOf(v) === "View3D" && deriveView(doc, v).stale) ids.add(vp.view.ref); }
  return [...ids];
}
let hiddenLineBusy = null;
async function ensureHiddenLine(ids) {
  while (hiddenLineBusy) await hiddenLineBusy;
  if (!ids.length || !window.THREE) return;
  hiddenLineBusy = (async () => {
    for (const id of ids) {
      const f = app.doc.element(id); if (!f) continue;
      app.say(`Computing hidden-line drawing: ${f.get("Name")}…`, "note");
      try { await hiddenLineFor(app, id); } catch (e) { app.say(`Hidden-line for ${f.get("Name")} failed: ${e.message}`, "error"); }
    }
  })();
  try { await hiddenLineBusy; } finally { hiddenLineBusy = null; }
}
let hiddenLineTimer = null;
/** An open sheet (or a 3D view shown as sheet line-work) updates itself shortly after the model changes. */
function scheduleHiddenLine() {
  clearTimeout(hiddenLineTimer);
  hiddenLineTimer = setTimeout(async () => {
    const f = app.activeView && app.doc.element(app.activeView); if (!f) return;
    const t = app.doc.typeOf(f);
    const ids = t === "Sheet" ? staleHiddenLine([f]) : t === "View3D" && visual3d(app.activeView) === "Sheet Line-work" && deriveView(app.doc, f).stale ? [app.activeView] : [];
    if (!ids.length) return;
    await ensureHiddenLine(ids);
    app.say("Hidden-line drawing updated", "ok");
    const v = app.views.get(app.activeView); if (v && v.draw) v.draw();
  }, 350);
}

// ---------------------------------------------------------------- export (§12)
function exportDialog() {
  const doc = app.doc;
  const sheets = doc.elements().filter(f => doc.typeOf(f) === "Sheet").sort((a, b) => String(doc.argValue(a, "number")).localeCompare(doc.argValue(b, "number")));
  const checks = sheets.map(sh => { const size = sheetSize(sh); return { sh, cb: h("input", { type: "checkbox", checked: true, "aria-label": doc.argValue(sh, "number") }), size }; });
  const issuedBy = h("input", { type: "text", value: "", placeholder: "Issued by", "aria-label": "Issued by" });
  const body = h("div", { style: { display: "grid", gap: "10px" } },
    h("h3", {}, "Sheet set → one multi-page PDF"),
    h("table", {}, h("tbody", {}, checks.map(c => h("tr", {}, h("td", {}, c.cb), h("td", { class: "mono" }, doc.argValue(c.sh, "number")), h("td", {}, doc.argValue(c.sh, "sheetName")), h("td", { class: "muted" }, `${doc.argValue(c.sh, "size")} ${c.size.map(fmtLen).join("×")} mm`))))),
    h("div", {}, issuedBy),
    h("div", { class: "muted" }, "Page size per sheet; line weights are physical mm; hatches as tiling patterns; the font embedded; bookmarks, category layers and marker links included. Sheets are re-derived for export, and 3D viewports get their hidden-line drawing computed automatically."),
    h("h3", {}, "Current view → DXF (zipped)"),
    h("div", { class: "muted" }, "Plans and elevations export to model space at full size ($INSUNITS 4, mm); sheets export paper space 1:1. Lineweights go in group 370, snapped to the DXF ladder with every substitution reported."));
  dialog("Export", body, [
    { label: "DXF of current view", run: () => { exportDXF(); return false; } },
    { label: "Export PDF set", primary: true, run: () => { exportPDF(checks.filter(c => c.cb.checked).map(c => c.sh), issuedBy.value); return false; } },
  ]);
}
async function exportPDF(sheets, issuedBy) {
  const doc = app.doc;
  if (!sheets.length) return app.say("choose at least one sheet", "error");
  // an issued set never carries stale 3D line-work (§12.1): bring it up to date here, then export
  await ensureHiddenLine(staleHiddenLine(sheets));
  const still = staleHiddenLine(sheets);
  if (still.length) return app.say(`Could not compute hidden-line for ${still.map(id => doc.element(id).get("Name")).join(", ")} (3D engine unavailable); nothing exported`, "error");
  app.say(`Writing ${sheets.length} sheet(s)…`, "note");
  const pages = [];
  for (const sh of sheets) {
    const sc = sheetScene(doc, sh);          // re-derived, never the screen cache of the sheet
    const prims = await rastersToJpeg(sc.prims);
    pages.push({ size: sc.size, prims, links: sc.links, title: `${doc.argValue(sh, "number")} ${doc.argValue(sh, "sheetName")}`, sheet: doc.idOf(sh) });
  }
  const out = writePDF(pages, { title: doc.meta.name + " drawing set", project: doc.meta.name, revision: sheets.map(s => doc.argValue(s, "revision")).join(","), issuedBy, issueDate: new Date().toISOString().slice(0, 10) });
  const r = await saveFile(`${doc.meta.name || "set"}.pdf`, out.bytes, "application/pdf");
  app.say(r.ok ? `PDF: ${pages.length} page(s), ${(out.bytes.length / 1024).toFixed(0)} KB, ${out.layers.length} layers, ${out.patterns} tiling patterns${out.report.length ? " — " + out.report.join("; ") : ""}` : r.error, r.ok ? "ok" : "error");
}
async function rastersToJpeg(prims) {
  const out = [];
  for (const p of prims) {
    if (p.t === "group") { out.push(Object.assign({}, p, { prims: await rastersToJpeg(p.prims) })); continue; }
    if (p.t === "raster" && p.url && p.url.startsWith("data:image/jpeg")) {
      const bin = atob(p.url.split(",")[1]), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const img = new Image(); img.src = p.url; await img.decode();
      out.push(Object.assign({}, p, { jpeg: bytes, pxW: img.naturalWidth, pxH: img.naturalHeight })); continue;
    }
    out.push(p);
  }
  return out;
}
async function exportDXF() {
  const doc = app.doc, v = app.activeView && doc.element(app.activeView);
  if (!v || !["PlanView", "ElevationView", "Sheet"].includes(doc.typeOf(v))) return app.say("open a plan, elevation or sheet to export it as DXF", "note");
  const sc = deriveView(doc, v), sheet = doc.typeOf(v) === "Sheet";
  const S = sheet ? 1 : (F.int(v, "scale") || 100);
  const flat = []; const walk = ps => { for (const p of ps) { if (p.t === "group") walk(p.prims); else flat.push(p); } };
  walk(sc.prims);
  // model space at full size: undo the view scale for geometry, keep weights and text as paper values
  const k = sheet ? 1 : S;
  const T = q => [q[0] * k, q[1] * k];
  const prims = flat.filter(p => p.t !== "raster").map(p => {
    const q = Object.assign({}, p);
    if (p.path) q.path = p.path.map(s => s.k === "L" ? { k: "L", a: T(s.a), b: T(s.b) } : s.k === "A" ? Object.assign({}, s, { c: T(s.c), r: s.r * k }) : { k: "C", a: T(s.a), c1: T(s.c1), c2: T(s.c2), b: T(s.b) });
    if (p.at) q.at = T(p.at);
    if (p.t === "text") q.height = p.height * k;
    if (p.t === "hatch") q.scale = p.scale * k;
    return q;
  });
  const out = writeDXF({ prims }, { units: "mm", space: sheet ? "paper" : "model", name: v.get("Name") });
  const zip = makeZip([{ name: `${v.get("Name").replace(/[^\w\- ]+/g, "")}.dxf`, data: out.text }]);
  const r = await saveFile(`${v.get("Name").replace(/[^\w\- ]+/g, "")}-dxf.zip`, zip, "application/zip");
  app.say(r.ok ? `DXF (${sheet ? "paper space 1:1" : "model space, full size"}), ${prims.length} entities${out.report.length ? " — " + out.report.join("; ") : ""}` : r.error, r.ok ? "ok" : "error");
}

// ---------------------------------------------------------------- diagnostics
function renderDiagnostics(main) {
  const pane = h("div", { class: "sheetpane" }), card = h("div", { class: "doccard" });
  const doc = app.doc, s = doc.stats;
  const summary = h("div", { class: "summary" });
  const list = h("div", { class: "results" });
  const run = () => {
    clear(summary); clear(list);
    const t0 = performance.now(); const res = runAll(); const ms = performance.now() - t0;
    const pass = res.filter(r => r.pass).length, gaps = res.filter(r => r.gap).length, fail = res.length - pass - gaps;
    summary.append(stat(pass, "passed"), stat(fail, "failed"), stat(gaps, "declared gaps"), stat(`${ms.toFixed(0)} ms`, "suite time"));
    for (const r of res.sort((a, b) => (a.pass === b.pass ? 0 : a.pass ? 1 : -1))) list.append(h("div", { class: "result " + (r.gap ? "gap" : r.pass ? "pass" : "fail") },
      h("div", { class: "st" }, r.gap ? "GAP" : r.pass ? "PASS" : "FAIL"),
      h("div", {}, h("div", { class: "nm" }, `${r.id} · ${r.name}`), h("div", { class: "kv" }, h("span", {}, "expected"), h("span", {}, String(r.expected)), h("span", {}, "measured"), h("span", {}, String(r.got)), r.note ? h("span", {}, "note") : null, r.note ? h("span", {}, r.note) : null))));
  };
  const stat = (b, l) => h("div", { class: "stat" }, h("b", {}, b), h("span", {}, l));
  card.append(h("header", {}, h("h2", {}, "Diagnostics"), h("span", { class: "muted" }, `§15 acceptance tests — every expected value derived by hand first. ${CASES.length} cases; the same suite runs under node --test.`), h("button", { class: "btn small primary", onclick: run }, "Run again")),
    h("div", { style: { padding: "10px 18px", overflowWrap: "anywhere" }, class: "mono muted" }, `This document: builds ${JSON.stringify(s.builds)} · offsets ${s.offsets} · fused cuts ${s.cuts} · derives ${s.derives} · fast path ${s.fastPath} · surface path ${s.surfacePath}`),
    ...(doc.loadReport.length ? [h("div", { class: "banner note" }, "Load report: " + doc.loadReport.join("; "))] : []),
    summary, list);
  pane.append(card); main.append(pane);
  setTimeout(run, 30);
}


// ---------------------------------------------------------------- doors: swing scenarios and the open/close animation
function selectedDoors() { return [...app.selection].filter(id => { const f = app.doc.element(id); return f && app.doc.typeOf(f) === "Door"; }); }
function flipDoors(key) { const ids = selectedDoors(); if (!ids.length) return app.say("select a door", "note"); app.apply(ids.map(id => ({ op: "set", id, key, value: !F.bool(app.doc.element(id), key) }))); }
/** Left in → right in → left out → right out: the four ways a single door can hang. */
function nextSwingScenario() {
  const ids = selectedDoors(); if (!ids.length) return app.say("select a door", "note");
  const ops = [];
  for (const id of ids) { const f = app.doc.element(id), i = (F.bool(f, "flipHand") ? 1 : 0) + (F.bool(f, "flipFacing") ? 2 : 0), n = (i + 1) % 4; ops.push({ op: "set", id, key: "flipHand", value: !!(n & 1) }, { op: "set", id, key: "flipFacing", value: !!(n & 2) }); }
  const r = app.apply(ops); if (r.ok) { const d = app.doc.data(app.doc.element(ids[0])); app.say(`Swing: ${d && d.props && d.props.Swing ? d.props.Swing.v : ""}`, "ok"); }
}
function animateSelectedDoors() {
  const ids = selectedDoors(); if (!ids.length) return app.say("select a door", "note");
  const v = app.views.get(app.activeView);
  if (v && v.animateDoor) { let any = false; for (const id of ids) any = v.animateDoor(id) || any; if (any) return app.say("Opening and closing through the swing angle", "ok"); }
  const v3 = default3D(); app.say("Opening it in the {3D} view", "note"); app.openView(v3);
  setTimeout(() => { const w = app.views.get(app.activeView); if (w && w.animateDoor) for (const id of ids) w.animateDoor(id); }, 400);
}

// ---------------------------------------------------------------- the other interface: parametric CAD
//! One building, two interfaces. The Revit-style one is this page; the other is
//! the OpenCascade/OCAF modeller, carried inside this page and started in a frame
//! the first time it is asked for. The building stays the one document: switching
//! writes it into the modeller as nodes (cadbridge.js), edits there come back as
//! ordinary ops, and switching back shows whatever either side did.
const cad = { frame: null, bridge: null, params: null, syncing: false, timer: null, on: false, booting: null };
function cadSource() {
  const el = document.getElementById("cad-page");
  return el ? { srcdoc: el.textContent.replace(/<\\\/(script)/gi, "</$1").replace(/<\\!--/g, "<" + "!--") } : { src: "cad/parametric-cad.html" };
}
function bootCad() {
  if (cad.booting) return cad.booting;
  cad.booting = new Promise((resolve, reject) => {
    const src = cadSource();
    const fr = h("iframe", { id: "cadframe", title: "Parametric CAD interface" });
    if (src.srcdoc) fr.srcdoc = src.srcdoc; else fr.src = src.src;
    document.body.append(fr); cad.frame = fr;
    const t0 = performance.now();
    const poll = () => {
      let b = null; try { b = fr.contentWindow && fr.contentWindow.__webbimCad; } catch (e) { return reject(new Error("the CAD frame is not reachable from this page")); }
      if (b && b.ready) { cad.bridge = b; b.onChange = () => { if (!cad.syncing && cad.on) { clearTimeout(cad.timer); cad.timer = setTimeout(pullFromCad, 250); } }; return resolve(b); }
      if (performance.now() - t0 > 120000) return reject(new Error("the CAD interface did not start within two minutes"));
      setTimeout(poll, 150);
    };
    poll();
  });
  return cad.booting;
}
/** The modeller's copy brought up to date with the building: small edits when it can, the building's part rewritten when the tree changed shape. */
async function pushToCad(cur) {
  const b = cad.bridge; if (!b) return;
  const { model, params } = bimToCad(app.doc);
  cad.syncing = true;
  try {
    cur = cur || await b.model();
    const cmds = cadDiff(cur, model);
    if (cmds === null) await b.load(mergeModel(cur, model));
    else for (const c of cmds) await b.run(c);
    cad.params = params;
  } finally { cad.syncing = false; }
}
/** Edits made in the modeller to the building's parameters, applied to the building - then the modeller shown what the building made of them. */
async function pullFromCad() {
  const b = cad.bridge; if (!b || cad.syncing || !cad.params) return;
  const cur = await b.model();
  const ops = cadEditsToOps(app.doc, cur, cad.params);
  if (!ops.length) return;
  const r = app.apply(ops, { quiet: true });
  b.say(r.ok ? `Web BIM: ${ops.length} change${ops.length > 1 ? "s" : ""} applied to the building` : `Web BIM refused: ${r.error}`);
  await pushToCad(r.ok ? null : cur);
}
async function switchToCad() {
  if (cad.on) return;
  closeMenus();
  const boot = document.getElementById("cadboot") || h("div", { id: "cadboot", role: "status" }, h("span", { class: "spin" }), h("span", {}, "Starting OpenCascade…"));
  document.body.append(boot);
  document.body.classList.add("cad-switching");
  let b;
  try { b = await bootCad(); }
  catch (e) { boot.remove(); document.body.classList.remove("cad-switching"); return app.say(`Parametric CAD could not start: ${e.message}`, "error"); }
  boot.querySelector("span:last-child").textContent = "Writing the building as nodes…";
  const first = !cad.params;
  try { await pushToCad(first ? { features: [] } : null); } catch (e) { app.say(`the building could not be written into the CAD interface: ${e.message}`, "error"); }
  if (first) b.fit();
  boot.remove();
  cad.on = true;
  document.body.classList.remove("cad-switching");
  document.body.classList.add("cad-mode");
  try { cad.frame.contentWindow.focus(); } catch (e) { /* focus is a nicety */ }
}
async function switchToRevit() {
  if (!cad.on) return;
  clearTimeout(cad.timer);
  try { await pullFromCad(); } catch (e) { app.say(`edits in the CAD interface could not be read back: ${e.message}`, "error"); }
  cad.on = false;
  document.body.classList.remove("cad-mode");
  app.refresh();
  app.say("Revit-style interface — the same model", "ok");
}
window.addEventListener("message", e => { if (e.data && e.data.webbim === "revit") switchToRevit(); });
/** A STEP (or BREP) read by the OpenCascade kernel for its triangles, without switching interface. */
app.kernelMesh = async ({ format, name, data, encoding }) => { const b = await bootCad(); if (!b.importMesh) throw new Error("this build's CAD kernel cannot hand back meshes"); return b.importMesh({ format, name, data, encoding }); };

// ---------------------------------------------------------------- keys (Revit two-letter shortcuts)
const SHORTCUTS = Object.fromEntries(Object.entries(COMMANDS).filter(([, c]) => c.key).map(([id, c]) => [c.key.toUpperCase(), id]));
let keyBuf = "", keyTimer = null;
window.addEventListener("keydown", e => {
  const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (app.sketch) {
    // sketch mode: its own undo, its own keys and a few of Revit's two-letter shortcuts
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? app.sketch.redo() : app.sketch.undo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); app.sketch.redo(); return; }
    if (e.key === "Escape") { app.sketch.escape(); return; }
    if (app.sketch.key(e)) { e.preventDefault(); return; }
    if (mod || e.altKey || !/^[a-z]$/i.test(e.key)) return;
    keyBuf = (keyBuf + e.key.toUpperCase()).slice(-2);
    clearTimeout(keyTimer); keyTimer = setTimeout(() => { keyBuf = ""; }, 1200);
    const SK = { LI: "line", RC: "rect", RE: "rect", PG: "polygon", AR: "arc", CI: "circle", EL: "ellipse", SP: "spline", BS: "bspline", PW: "pickwalls", MV: "move", CO: "copy", RO: "rotate", MM: "mirror", SC: "scale", S1: "scale1d", OF: "offset", FL: "fillet", TR: "fillet", SL: "split", DI: "dim", MD: "select" };
    if (keyBuf.length === 2 && SK[keyBuf]) { app.sketch.setTool(SK[keyBuf]); keyBuf = ""; e.preventDefault(); }
    if (keyBuf === "ZF" || keyBuf === "ZE") { app.run("zoomfit"); keyBuf = ""; }
    return;
  }
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); app.run(e.shiftKey ? "redo" : "undo"); return; }
  if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); app.run("redo"); return; }
  // a drawing tool keeps its keys (Enter ends a chain, digits type a length) wherever focus is -
  // clicking a ribbon button to change shape must not leave Enter with nothing to do
  if (!mod && app.tool !== "select") { const av = app.views.get(app.activeView); if (av && av.key && !(av.canvas && document.activeElement === av.canvas) && av.key(e)) { e.preventDefault(); return; } }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); app.run("save"); return; }
  if (e.key === "Escape") {
    keyBuf = ""; if (openMenu) { closeMenus(); return; }
    if (app.pickMode) { app.endPick(); return; }
    if (app.sketch) { app.sketch.escape(); return; }
    if (app.tool !== "select") { app.setTool("select"); return; }
    if (app.selection.size) app.select([]); return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && app.selection.size && app.activeView !== "__graph") { e.preventDefault(); deleteSelection(); return; }
  if (mod || e.altKey) return;
  if (e.key === "Enter" && !keyBuf && app.lastCommand && app.tool === "select") { app.run(app.lastCommand); return; }
  if (!/^[a-z0-9]$/i.test(e.key)) return;
  keyBuf = (keyBuf + e.key.toUpperCase()).slice(-2);
  clearTimeout(keyTimer); keyTimer = setTimeout(() => { keyBuf = ""; const s = document.getElementById("stats"); if (s) s.dataset.keys = ""; }, 1200);
  const m = document.getElementById("stats"); if (m) m.dataset.keys = keyBuf;
  if (keyBuf.length === 2 && SHORTCUTS[keyBuf]) { const id = SHORTCUTS[keyBuf]; keyBuf = ""; if (m) m.dataset.keys = ""; e.preventDefault(); app.run(id); return; }
  if (keyBuf.length === 1 && e.key.toLowerCase() === "f" && !Object.keys(SHORTCUTS).some(k => k[0] === "F")) { keyBuf = ""; app.run("zoomfit"); }
});
// typing a value into Properties while "pick to bind" is waiting means you meant the value: stop picking
document.addEventListener("focusin", e => { if (app.pickMode && e.target.closest && e.target.closest("#left") && e.target.tagName === "INPUT") { app.pickMode = null; app.say("Pick cancelled: type the value and press Enter", "note"); renderOptionsBar(); } });
document.addEventListener("pointerdown", e => { if (openMenu && !openMenu.contains(e.target)) closeMenus(); }, true);
window.addEventListener("resize", () => { const v = app.views.get(app.activeView); if (v && v.resize) v.resize(); });

// ---------------------------------------------------------------- boot
async function boot() {
  const snaps = store("snaps"); if (snaps) Object.assign(app.snaps, snaps);
  const split = store("split"); if (split) document.getElementById("left").style.setProperty("--split", (split * 100).toFixed(1) + "%");
  await loadDrawingFont();
  let doc = null, note = null;
  const draft = store("draft-v5");
  if (draft) { try { doc = openDocument(draft); doc.regenerate(); note = { msg: "Restored your draft from this browser. File › New to start empty.", kind: "note" }; } catch (e) { doc = null; } }
  if (!doc) { try { doc = buildRmuhSample(); } catch (e) { console.error(e); doc = buildSample(); } }
  setDocument(doc, note || { msg: doc.meta.brief ? `D1 RMUH: the brief read into a space graph (${(doc.meta.brief.report || [])[0] || ""}) and a first massing built on the client's plot. File › Studio House Sample for the small house.` : `Studio House: ${doc.elements().length} elements.`, kind: "ok" });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
/** Blocks of a massing study moved by hand (plan or 3D): the graph that built them re-packs around where they now are. */
app.repackMoved = ids => {
  const doc = app.doc, sgs = new Set();
  for (const id of ids || []) { const f = doc.element(id); const sg = f && doc.typeOf(f) === "Generic" && doc.getParam(f, "SpaceGraph"); if (sg && doc.element(sg) && F.bool(doc.element(sg), "auto") !== false) sgs.add(sg); }
  for (const sg of sgs) { const r = app.apply({ op: "sgbuild", id: sg }); if (r.ok) app.say(`${sg}: the moved block holds there (an attractor); the rest re-packed around it`, "ok"); }
};

// a sheet's brief-analysis diagrams are drawn here, from the space graph as it is now
SHEET_DIAGRAMS.url = (doc, im) => sheetDiagramUrl(app, doc, im);
{ let t = 0; window.addEventListener("webbim:raster", () => { clearTimeout(t); t = setTimeout(() => app.refresh({ keepMain: true }), 30); }); }
