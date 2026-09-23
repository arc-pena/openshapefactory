//! The application shell, laid out the way a BIM author expects (Revit's
//! arrangement): Quick Access Toolbar, a ribbon whose File tab sits at the far
//! left, an options bar, the Properties palette over the Project Browser on the
//! left, document tabs over the view, a view control bar under it, and the
//! status bar. The shell owns no model state: every command goes through one
//! registry, and every edit through app.apply → the op pipeline → regenerate.

import { h, clear, icon, dialog, saveFile, store, forget, loadDrawingFont, fmtLen } from "./ui_util.js";
import { Editor } from "./ops.js";
import { buildSample } from "./sample.js";
import { openDocument, newDocument, sheetSize } from "./bim.js";
import { F, CATALOGUE } from "./ocaf.js";
import { deriveView, sheetScene } from "./scene.js";
import { writePDF } from "./pdf.js";
import { writeDXF, readDXF, makeZip } from "./dxf.js";
import { runAll, CASES } from "./acceptance.js";
import { renderPanel, renderSchedule, typeEditor, vvDialog } from "./panel.js";
import { renderGraph } from "./graph.js";
import { View2D, SNAP_KINDS, MODIFY_TOOLS } from "./canvas2d.js";
import { View3D, VISUAL_STYLES, hiddenLineFor } from "./view3d.js";
import { categoryOf } from "./styles.js";
import { bimToCad, cadEditsToOps, cadDiff, mergeModel } from "./cadbridge.js";

const VIEW_TYPES = ["PlanView", "ElevationView", "View3D", "Schedule", "Sheet"];
const PLACE_TOOLS = new Set(["wall", "opening", "door", "window", "column", "grid", "text", "dim", "space", "elev", "sep"]);

const app = {
  doc: null, editor: null, selection: new Set(), activeView: null, tabs: [], tool: "select",
  toolOpts: { wallType: "T-EXTCAV300", mounting: "Core exterior", height: 3000, doorType: "T-DOOR915", windowType: "T-WIN1215", columnType: "T-COL400", width: 1000, height_: 2100, openSill: 0, sill: 900, boundaryAt: "finishFace", spaceName: "Room", mirrorCopy: true, moveCopy: false, rotateCopy: false },
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
  if (opts.quiet) { const v = app.views.get(app.activeView); if (v && v.draw) v.draw(); if (v && v.refresh && v.T) v.refresh(); updateStatus(); if (!r.ok && r.conflicts) app.say(r.error, "error"); }
  else app.refresh();
  saveDraftSoon();
  return r;
};
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
  renderQAT(); renderRibbon(); renderOptionsBar(); renderPalettes(); updateStatus();
  const v = app.views.get(app.activeView);
  if (!opts.keepMain || !v) renderMain();
  else { if (v.draw) v.draw(); if (v.refresh && v.T) v.refresh(); renderViewControl(); }
  scheduleHiddenLine();
  if (opts.keepMain && (app.activeView === "__graph" || app.activeView === "__tree" || (app.activeView && app.doc.element(app.activeView) && app.doc.typeOf(app.doc.element(app.activeView)) === "Schedule"))) renderMain();
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
const canUseTool = k => { const t = activeType(); if (t === "PlanView") return true; if (t === "View3D") return ["wall", "door", "window", "opening", "column", "select"].includes(k); return k === "select"; };

// ---------------------------------------------------------------- documents
/** There is always a {3D} view: the house button must have somewhere to go. */
function ensureDefault3D(doc) {
  if (doc.elements().some(f => doc.typeOf(f) === "View3D" && f.get("Name") === "{3D}")) return;
  let id = "V-3D"; let n = 1; while (doc.element(id)) id = "V-3D" + (++n);
  doc.addElement({ id, type: "View3D", name: "{3D}", args: { camera: { azimuth: 225, elevation: 30, target: [6000, 4000, 1500] }, scale: 100, style: { ref: "VS-CONSTRUCTION" }, render: { mode: "lines", hidden: false, rasterDPI: 300 } } });
  doc.regenerate();
}
function setDocument(doc, note) {
  ensureDefault3D(doc);
  app.doc = doc; app.editor = new Editor(doc); app.selection.clear(); app.views.clear();
  const saved = store("tabs");
  app.tabs = (saved && saved.tabs || []).filter(t => t.startsWith("__") || doc.element(t));
  if (!app.tabs.length) app.tabs = ["V-P00", default3D()].filter(t => t && doc.element(t));
  if (!app.tabs.length) { const p = firstOf("PlanView"); if (p) app.tabs = [p]; }
  app.activeView = saved && app.tabs.includes(saved.active) ? saved.active : app.tabs[0] || null;
  app.refresh();
  if (note) app.say(note.msg, note.kind);
}
function default3D() { const f = app.doc.elements().find(g => app.doc.typeOf(g) === "View3D" && g.get("Name") === "{3D}") || app.doc.elements().find(g => app.doc.typeOf(g) === "View3D"); return f ? app.doc.idOf(f) : null; }
let draftTimer = null;
function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(() => { try { store("draft-v3", app.doc.toJSON()); } catch (e) { /* too big or blocked: the draft is a convenience only */ } }, 800); }

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
  grid: tool("grid", "Grid", "grid", "GR", "Two clicks."),
  space: tool("space", "Room", "room", "RM", "Click inside an enclosed area. The room keeps its name by this point."),
  sep: tool("sep", "Room Separator", "sepline", "RS", "Two clicks: divides rooms where there is no wall."),
  dim: tool("dim", "Aligned", "dim", "DI", "Click two parallel references: faces, centrelines, grids. It binds to them, not to points."),
  text: tool("text", "Text", "text", "TX", "Click, type, Enter. Height is paper millimetres."),
  elev: tool("elev", "Elevation", "elevview", "EL", "Two clicks: the marker line is the view."),
  move: tool("move", "Move", "move", "MV", "Click a base point, then the destination (or type a distance + Enter)."),
  copy: tool("copy", "Copy", "copy", "CO", "Click a base point, then where the copy goes."),
  rotate: tool("rotate", "Rotate", "rotate", "RO", "Click the start of the angle, then its end (or type degrees + Enter)."),
  mirror: tool("mirror", "Mirror", "mirror", "MM", "Click two points on the mirror axis."),
  del: { label: "Delete", icon: "del", key: "DE", run: () => deleteSelection() },
  undo: { label: "Undo", icon: "undo", run: () => { app.editor.undo(); app.refresh(); saveDraftSoon(); } },
  redo: { label: "Redo", icon: "redo", run: () => { app.editor.redo(); app.refresh(); saveDraftSoon(); } },
  default3d: { label: "Default 3D View", icon: "house", key: "3D", run: () => { ensureDefault3D(app.doc); app.openView(default3D()); } },
  planview: { label: "Plan View", icon: "plan", run: () => newPlanView() },
  level: { label: "Level", icon: "level", key: "LL", run: () => newLevel() },
  schedule: { label: "Schedule", icon: "schedule", run: () => newSchedule() },
  sheet: { label: "Sheet", icon: "sheet", run: () => newSheet() },
  vv: { label: "Visibility/ Graphics", icon: "vv", key: "VV", run: () => { const v = app.doc.element(app.activeView); if (v && ["PlanView", "ElevationView", "View3D"].includes(app.doc.typeOf(v))) vvDialog(app, app.activeView); else app.say("open a plan, elevation or 3D view first", "note"); } },
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
  edittype: { label: "Edit Type", icon: "edittype", run: () => { const t = selectedType(); if (t) typeEditor(app, t); else app.say("select an element with a type", "note"); } },
  props: { label: "Properties", icon: "props", key: "PP", active: () => !document.body.classList.contains("hide-props"), run: () => document.body.classList.toggle("hide-props") },
  pens: { label: "Object Styles & Pens", icon: "pens", run: () => { const v = app.activeView && app.doc.element(app.activeView); vvDialog(app, v && ["PlanView", "ElevationView", "View3D"].includes(app.doc.typeOf(v)) ? app.activeView : firstOf("PlanView")); } },
  projectinfo: { label: "Project Information", icon: "info", run: () => projectInfo() },
  open: { label: "Open…", icon: "open", run: () => openFile() },
  save: { label: "Save", icon: "save", key: "", run: () => saveModel() },
  importdxf: { label: "Import DXF Symbol", icon: "importI", run: () => importDXF() },
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
  app.refresh({ keepMain: true });
  app.say((COMMANDS[k] && COMMANDS[k].hint) || "", "note");
};
app.run = id => { const c = COMMANDS[id]; if (!c) return; closeMenus(); c.run(); if (!c.tool && id !== "undo" && id !== "redo") app.lastCommand = id; };

// ---------------------------------------------------------------- the ribbon
const big = id => ({ id, size: "big" }), small = id => ({ id, size: "small" });
const RIBBON = [
  { tab: "Architecture", panels: [
    { title: "Build", items: [big("wall"), big("door"), big("window"), big("column")] },
    { title: "Opening", items: [big("opening")] },
    { title: "Room & Area", items: [big("space"), small("sep"), small("schedule")] },
    { title: "Datum", items: [big("level"), big("grid")] },
  ] },
  { tab: "Structure", panels: [
    { title: "Structure", items: [big("column"), big("wall")] },
    { title: "Datum", items: [big("grid"), big("level")] },
  ] },
  { tab: "Insert", panels: [
    { title: "Import", items: [big("importdxf"), big("open")] },
    { title: "Load from Library", items: [big("placesymbol")] },
  ] },
  { tab: "Annotate", panels: [
    { title: "Dimension", items: [big("dim")] },
    { title: "Text", items: [big("text")] },
    { title: "Symbol", items: [big("placesymbol")] },
  ] },
  { tab: "View", panels: [
    { title: "Graphics", items: [big("vv"), small("thin"), small("zoomfit")] },
    { title: "Create", items: [big("default3d"), small("planview"), small("elev"), small("schedule"), big("sheet")] },
    { title: "Windows", items: [small("graph"), small("tree"), small("closehidden")] },
    { title: "Interface", items: [big("cadmode")] },
  ] },
  { tab: "Manage", panels: [
    { title: "Settings", items: [big("pens"), big("projectinfo")] },
    { title: "Inquiry", items: [big("tests")] },
  ] },
  { tab: "Modify", panels: [
    { title: "Select", items: [big("select")] },
    { title: "Properties", items: [big("props"), big("edittype")] },
    { title: "Modify", items: [small("move"), small("copy"), small("rotate"), small("mirror"), small("del"), small("selectall")] },
    { title: "View", items: [small("zoomfit"), small("thin")] },
  ] },
];
function contextTab() {
  const els = [...app.selection].map(id => app.doc.element(id)).filter(Boolean);
  if (!els.length) return null;
  const cats = [...new Set(els.map(f => (app.doc.lib.categories[categoryOf(app.doc, f)] || {}).name || app.doc.typeOf(f)))];
  const hasWall = els.some(f => ["Wall", "Door"].includes(app.doc.typeOf(f)));
  return { tab: "__context", label: `Modify | ${cats.length === 1 ? cats[0] : "Multi-Select"}`, panels: [
    { title: "Properties", items: [big("props"), big("edittype")] },
    { title: "Modify", items: [big("move"), big("copy"), big("rotate"), big("mirror"), big("del")] },
    ...(hasWall ? [{ title: "Mode", items: [big("flip")] }] : []),
    ...(els.some(f => app.doc.typeOf(f) === "Door") ? [{ title: "Door", items: [big("dooranim"), big("swingnext"), small("fliphand"), small("flipfacing")] }] : []),
    { title: "Select", items: [small("selectall"), small("select")] },
  ] };
}
function renderRibbon() {
  const root = clear(document.getElementById("ribbon"));
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
function renderQAT() {
  const q = clear(document.getElementById("qat"));
  const b = (id, ic) => h("button", { class: "qbtn", title: COMMANDS[id].label + (COMMANDS[id].key ? ` (${COMMANDS[id].key})` : ""), "aria-label": COMMANDS[id].label, disabled: (id === "undo" && !app.editor.undoStack.length) || (id === "redo" && !app.editor.redoStack.length), onclick: () => app.run(id) }, icon(ic || COMMANDS[id].icon, 16));
  const v = app.activeView && app.doc.element(app.activeView);
  const viewName = v ? `${{ PlanView: "Floor Plan", ElevationView: "Elevation", View3D: "3D View", Schedule: "Schedule", Sheet: "Sheet" }[app.doc.typeOf(v)]}: ${v.get("Name")}` : app.activeView === "__graph" ? "Node Graph" : app.activeView === "__tree" ? "Feature Tree" : app.activeView === "__diag" ? "Acceptance Tests" : "";
  q.append(
    h("button", { class: "qbtn mobile-only", "aria-label": "Palettes", onclick: () => document.body.classList.toggle("show-left") }, icon("menu", 16)),
    h("div", { class: "logo", title: "Web BIM" }, "B"),
    b("open"), b("save"), h("span", { class: "qsep" }), b("undo"), b("redo"), h("span", { class: "qsep" }),
    b("dim"), b("text"), h("span", { class: "qsep" }), b("default3d"), b("elev"), b("thin"), b("closehidden"),
    h("div", { class: "qtitle" }, h("b", {}, app.doc.meta.name), viewName ? " — " + viewName : ""),
    h("button", { class: "qbtn", title: "Export (PDF set, DXF)", "aria-label": "Export", onclick: () => exportDialog() }, icon("exportI", 16)),
    h("button", { class: "qswitch", title: "Switch to the parametric CAD interface (PC) - the same model", onclick: () => switchToCad() }, icon("view3d", 15), h("span", {}, "Parametric CAD")));
}
function renderOptionsBar() {
  const bar = clear(document.getElementById("options"));
  const o = app.toolOpts, doc = app.doc, t = app.tool;
  const typesOf = cat => Object.entries(doc.lib.types).filter(([id]) => (doc.resolveType(id) || {}).category === cat);
  const sel = (key, opts, label) => h("label", {}, label + " ", h("select", { onchange: e => { o[key] = e.target.value; } }, opts.map(([v, l]) => h("option", { value: v, selected: o[key] === v }, l))));
  const num = (key, label) => h("label", {}, label + " ", h("input", { type: "text", value: o[key], style: { width: "64px" }, onchange: e => { o[key] = Number(e.target.value); } }));
  const chk = (key, label) => h("label", {}, h("input", { type: "checkbox", checked: !!o[key], onchange: e => { o[key] = e.target.checked; } }), " " + label);
  const els = [...app.selection].filter(id => doc.element(id));
  let title, kids = [];
  if (t === "cropsketch" && app.cropView && app.cropView.cropSk) {
    // Edit Crop: Revit's sketch mode - draw tools, modify tools, and Finish / Cancel
    const cv = app.cropView, S = cv.cropSk;
    const tb = (tool, label, tip) => h("button", { class: "btn small" + (S.tool === tool ? " primary" : ""), title: tip, onclick: () => cv.cropSetTool(tool) }, label);
    const offIn = h("input", { type: "text", value: S.offset, style: { width: "60px" }, "aria-label": "Offset distance", onchange: e => { S.offset = Number(e.target.value) || 0; } });
    bar.append(h("span", { class: "otitle" }, "Modify | Edit Crop"),
      h("span", { class: "muted" }, "Draw"), tb("line", "Line", "click points; Enter ends the chain"), tb("rect", "Rectangle", "two corners"), tb("arc", "Arc", "start, through, end"), tb("circle", "Circle", "centre, then radius"), tb("ellipse", "Ellipse", "centre, major axis, minor"), tb("spline", "Spline", "click points; click the first to close, or Enter"),
      h("span", { class: "muted" }, "Modify"), tb("pick", "Pick", "click elements to pick them (Shift adds); Delete removes"), tb("move", "Move", "base point, then destination"), tb("rotate", "Rotate", "centre, then from, then to"), tb("scale", "Scale", "centre, then from, then to"),
      h("label", {}, "Offset ", offIn), h("button", { class: "btn small", onclick: () => cv.cropOffset(S.offset) }, "Offset"),
      h("button", { class: "btn small primary", onclick: () => cv.finishCropSketch() }, "Finish ✓"), h("button", { class: "btn small", onclick: () => cv.cancelCropSketch() }, "Cancel ✗"));
    return;
  }
  if (app.pickMode) { title = `Bind ${app.pickMode.label}`; kids = [h("span", {}, "Click an element in the view"), h("button", { class: "btn small", onclick: app.endPick }, "Cancel")]; }
  else if (t === "select") { title = els.length ? `Modify | ${els.length} selected` : "Modify"; kids = els.length ? [h("span", { class: "muted" }, "Drag to move · MV CO RO MM · DE deletes · Esc clears")] : [h("span", { class: "muted" }, "Pick elements, or window-select by dragging on empty space")]; }
  else {
    title = `Modify | Place ${COMMANDS[t] ? COMMANDS[t].label : t}`;
    if (t === "wall") kids = [sel("wallType", typesOf("IfcWall").map(([id, x]) => [id, x.name]), "Type:"), sel("mounting", ["Centred", "Core centre", "Core exterior", "Core interior", "Finish exterior", "Finish interior"].map(x => [x, x]), "Location Line:"), num("height", "Height:"), levelPicker()];
    if (t === "door") kids = [sel("doorType", typesOf("IfcDoor").map(([id, x]) => [id, x.name]), "Type:")];
    if (t === "window") kids = [sel("windowType", typesOf("IfcWindow").map(([id, x]) => [id, x.name]), "Type:"), num("sill", "Sill Height:")];
    if (t === "opening") kids = [num("width", "Width:"), num("height_", "Height:"), num("openSill", "Sill:")];
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
  if (app.selection.size) items.push(c("selectall"), c("edittype"), c("move"), c("copy"), c("rotate"), c("mirror"), c("del"), "-");
  items.push(c("zoomfit"), c("default3d"), c("props"));
  menuAt(e.clientX, e.clientY, items);
};
function fileMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  menuAt(r.left, r.bottom, [
    { label: "New", icon: "sheet", run: () => newEmpty() }, { label: "Open…", icon: "open", run: () => openFile() }, { label: "Save", icon: "save", run: () => saveModel() },
    "-", { label: "Export…", icon: "exportI", run: () => exportDialog() }, { label: "Import DXF Symbol…", icon: "importI", run: () => importDXF() },
    "-", { label: "Project Information…", icon: "info", run: () => projectInfo() }, { label: "Reset to Sample Project", icon: "house", run: () => { forget("draft-v3"); forget("tabs"); setDocument(buildSample(), { msg: "Sample project loaded", kind: "ok" }); } },
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
function node(label, kids, opts = {}) {
  const key = opts.key || label, open = app.expanded.has(key);
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
  const viewRow = (f, ic) => { const id = doc.idOf(f); return node(f.get("Name"), null, { key: "view:" + id, ic, sel: app.selection.has(id), active: app.activeView === id, drag: id,
    onclick: () => app.select([id]), ondbl: () => app.openView(id),
    extra: placed.has(id) ? h("span", { class: "chip", title: "placed on sheet" }, placed.get(id)) : null }); };
  const tree = h("ul", { class: "tree" });
  tree.append(node("Views (all)", [
    node("Floor Plans", byType("PlanView").map(f => viewRow(f, "plan"))),
    node("3D Views", byType("View3D").map(f => viewRow(f, "view3d"))),
    node("Elevations (Building Elevation)", byType("ElevationView").map(f => viewRow(f, "elevview"))),
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
    h("div", { class: "prow" }, h("label", {}, "Position"), h("div", { class: "ro mono" }, `${fmtLen(vp.at[0])}, ${fmtLen(vp.at[1])} mm on paper`)),
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
    const f = doc.element(t), label = t === "__graph" ? "Node Graph" : t === "__diag" ? "Acceptance Tests" : t === "__tree" ? "Feature Tree" : f ? f.get("Name") : t;
    const ic = t === "__graph" ? "graph" : t === "__diag" ? "tests" : t === "__tree" ? "tree" : { PlanView: "plan", View3D: "view3d", ElevationView: "elevview", Schedule: "schedule", Sheet: "sheet" }[f && doc.typeOf(f)];
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
  if (id === "__tree") { const b = h("div", { class: "sheetpane" }, h("div", { class: "doccard" }, h("header", {}, h("h2", {}, "Feature Tree"), h("span", { class: "muted" }, "construction order; ● built, ● note, ● error; double-click shows it")), h("div", { style: { padding: "0 0 10px" } }))); renderTree(b.querySelector(".doccard > div")); main.append(b); app.views.set(id, {}); return; }
  const v = doc.element(id); if (!v) { app.closeTab(id); return; }
  const t = doc.typeOf(v);
  if (t === "Schedule") { renderSchedule(app, main, v); app.views.set(id, {}); renderViewControl(); return; }
  if (t === "View3D" && (app.visualStyle3d[id] || "Shaded") !== "Sheet Line-work") { const view = new View3D(app, main, id); if (cams3d.has(id)) { view.cam = cams3d.get(id); view.render(); } app.views.set(id, view); renderViewControl(); return; }
  const prev = app.views.get(id);
  const view = new View2D(app, main, id);
  if (prev && prev.cam) view.cam = prev.cam;
  app.views.set(id, view);
  view.canvas.addEventListener("keydown", e => { if (view.key(e)) { e.preventDefault(); e.stopPropagation(); } });
  view.draw();
  renderViewControl();
}
/** The view control bar: scale, detail level, visual style, thin lines, crop, VV — at the foot of the view. */
function renderViewControl() {
  const bar = document.getElementById("vcb"); if (!bar) return; clear(bar);
  const doc = app.doc, id = app.activeView, v = doc.element(id); if (!v) return;
  const t = doc.typeOf(v);
  const ib = (ic, title, on, run) => h("button", { class: "vbtn", title, "aria-label": title, "aria-pressed": on === undefined ? null : String(!!on), onclick: run }, icon(ic, 16));
  if (["PlanView", "ElevationView", "View3D"].includes(t)) bar.append(h("select", { class: "vscale", "aria-label": "View scale", title: "View scale", onchange: e => app.apply({ op: "set", id, key: "scale", value: Number(e.target.value) }) }, [10, 20, 50, 100, 200, 500].map(s => h("option", { value: s, selected: F.int(v, "scale") === s }, "1 : " + s))));
  if (t === "PlanView" || t === "ElevationView") {
    const dl = F.choice(v, "detailLevel");
    bar.append(h("select", { class: "vsel", title: "Detail level", "aria-label": "Detail level", onchange: e => app.apply({ op: "set", id, key: "detailLevel", value: e.target.value }) }, ["Coarse", "Medium", "Fine"].map(d => h("option", { selected: dl === d }, d))));
    const st = F.refId(v, "style");
    bar.append(h("select", { class: "vsel", title: "View style", "aria-label": "View style", onchange: e => app.apply({ op: "set", id, key: "style", value: { ref: e.target.value } }) }, Object.entries(doc.lib.viewStyles).map(([k, s]) => h("option", { value: k, selected: k === st }, s.name))));
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
    const cur = app.visualStyle3d[id] || "Shaded";
    bar.append(h("select", { class: "vsel", title: "Visual style", "aria-label": "Visual style", onchange: e => { app.visualStyle3d[id] = e.target.value; renderMain(); } }, [...VISUAL_STYLES, "Sheet Line-work"].map(s => h("option", { selected: s === cur }, s))));
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
function newPlanView(levelId) {
  const lv = levelId || app.workLevel || firstOf("Level"); if (!lv) return app.say("add a level first", "error");
  const r = app.apply({ op: "add", element: { type: "PlanView", name: `${F.text(app.doc.element(lv), "name")} Plan`, args: { level: { ref: lv }, scale: 100, viewRange: { top: 2300, cut: 1200, bottom: 0 }, detailLevel: "Fine", style: { ref: "VS-CONSTRUCTION" }, filters: [], clip: { rect: null, visible: false, active: false }, overrides: {} } } });
  if (r.ok) app.openView(r.id);
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
  forget("draft-v3"); forget("tabs");
  const doc = newDocument("Untitled");
  doc.addElement({ id: "L0", type: "Level", name: "Level 1", args: { name: "Level 1", elevation: 0 } });
  doc.addElement({ id: "L1", type: "Level", name: "Level 2", args: { name: "Level 2", elevation: 3000 } });
  doc.addElement({ id: "V-P00", type: "PlanView", name: "Level 1", args: { level: { ref: "L0" }, scale: 100, style: { ref: "VS-CONSTRUCTION" } } });
  doc.addElement({ id: "V-P01", type: "PlanView", name: "Level 2", args: { level: { ref: "L1" }, scale: 100, style: { ref: "VS-CONSTRUCTION" } } });
  doc.regenerate();
  setDocument(doc, { msg: "New model: press WA to draw walls, or 3D to model in the {3D} view", kind: "ok" });
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
        h("div", { class: "mono" }, `measured ${fmtLen(w)} × ${fmtLen(hh)} mm`),
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
    const ids = t === "Sheet" ? staleHiddenLine([f]) : t === "View3D" && app.visualStyle3d[app.activeView] === "Sheet Line-work" && deriveView(app.doc, f).stale ? [app.activeView] : [];
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

// ---------------------------------------------------------------- keys (Revit two-letter shortcuts)
const SHORTCUTS = Object.fromEntries(Object.entries(COMMANDS).filter(([, c]) => c.key).map(([id, c]) => [c.key.toUpperCase(), id]));
let keyBuf = "", keyTimer = null;
window.addEventListener("keydown", e => {
  const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); app.run(e.shiftKey ? "redo" : "undo"); return; }
  if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); app.run("redo"); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); app.run("save"); return; }
  if (e.key === "Escape") {
    keyBuf = ""; if (openMenu) { closeMenus(); return; }
    if (app.pickMode) { app.endPick(); return; }
    if (app.tool === "cropsketch" && app.cropView) { app.cropView.cancelCropSketch(); return; }
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
  const draft = store("draft-v3");
  if (draft) { try { doc = openDocument(draft); doc.regenerate(); note = { msg: "Restored your draft from this browser. File › New to start empty.", kind: "note" }; } catch (e) { doc = null; } }
  if (!doc) doc = buildSample();
  setDocument(doc, note || { msg: `Studio House: ${doc.elements().length} elements. Double-click a view in the Project Browser to open it; WA draws walls; 3D opens the {3D} view.`, kind: "ok" });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
