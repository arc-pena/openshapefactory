//! The application shell. It owns no model state: the document is the kernel,
//! the interface mirrors it, and every change goes through app.apply → the op
//! pipeline → regenerate → refresh. Three projections of one document sit side
//! by side: the project browser (views, sheets, families, relationships), the
//! feature tree (construction order) and the node graph.

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
import { View2D, SNAP_KINDS } from "./canvas2d.js";
import { View3D } from "./view3d.js";
import { categoryOf } from "./styles.js";

const TOOLS = [
  ["select", "Select", "V"], ["wall", "Wall", "W"], ["opening", "Opening", "O"], ["door", "Door", "D"], ["window", "Window", "N"],
  ["column", "Column", "C"], ["grid", "Grid", "G"], ["text", "Text", "T"], ["dim", "Dimension", "M"], ["space", "Space", "S"],
  ["elev", "Elevation", "E"], ["sep", "Room line", "R"],
];
const TOOL_ICON = { select: "select", wall: "wall", opening: "opening", door: "door", window: "window", column: "column", grid: "grid", text: "text", dim: "dim", space: "space", elev: "elev", sep: "sep" };
const VIEW_TYPES = ["PlanView", "ElevationView", "View3D", "Schedule", "Sheet"];

const app = {
  doc: null, editor: null, selection: new Set(), activeView: null, tabs: [], tool: "select",
  toolOpts: { wallType: "T-EXTCAV300", mounting: "Core exterior", height: 3000, doorType: "T-DOOR915", windowType: "T-WIN1215", columnType: "T-COL400", width: 1000, height_: 2100, openSill: 0, sill: 900, boundaryAt: "finishFace", spaceName: "Room" },
  snaps: Object.fromEntries(SNAP_KINDS.map(k => [k, k !== "angle"])), thinLines: false, leftTab: "project", pickMode: null,
  views: new Map(), mode3d: {}, expanded: new Set(["Views", "Floor plans", "Elevations", "3D views", "Schedules", "Sheets"]), treeFilter: "",
};
window.webbim = app;       // for the console and for tests: the document, the editor, the op pipeline

// ---------------------------------------------------------------- the one edit path
app.apply = (op, opts = {}) => {
  const r = app.editor.apply(op);
  if (!r.ok && !opts.quiet) app.say(r.error || (r.conflicts || []).map(c => c.say).join("; "), "error");
  if (r.ok && r.said) app.say(r.said, "note");
  if (opts.quiet) { const v = app.views.get(app.activeView); if (v && v.draw) v.draw(); updateStatus(); if (!r.ok && r.conflicts) app.say(r.error, "error"); }
  else app.refresh();
  saveDraftSoon();
  return r;
};
app.say = (msg, kind = "") => { const m = document.getElementById("msg"); if (!m) return; m.textContent = msg; m.className = "msg " + kind; m.title = msg; };
app.select = (ids, add = false, raw = false) => {
  if (!add) app.selection.clear();
  for (const id of ids) { if (add && app.selection.has(id)) app.selection.delete(id); else app.selection.add(id); }
  app.refresh({ keepMain: true });
};
app.refresh = (opts = {}) => {
  renderLeft(); renderRight(); renderBar(); updateStatus();
  const v = app.views.get(app.activeView);
  if (!opts.keepMain || !v) renderMain(); else if (v.draw) v.draw(); else if (v.render) v.render();
  if (opts.keepMain && v && v.refresh && v.T) v.render();
  if (opts.keepMain && (app.activeView === "__graph" || (app.activeView && app.doc.element(app.activeView) && app.doc.typeOf(app.doc.element(app.activeView)) === "Schedule"))) renderMain();
};
app.openView = (id) => {
  if (!app.tabs.includes(id)) app.tabs.push(id);
  app.activeView = id; app.tool = "select"; app.pickMode = null;
  store("tabs", { tabs: app.tabs, active: id });
  app.refresh();
  if (window.innerWidth <= 860) document.body.classList.remove("show-left");
};
app.closeTab = id => { app.tabs = app.tabs.filter(t => t !== id); app.views.delete(id); if (app.activeView === id) app.activeView = app.tabs[app.tabs.length - 1] || null; store("tabs", { tabs: app.tabs, active: app.activeView }); app.refresh(); };
app.openGraph = id => { app.graphFocus = id; app.openView("__graph"); };
app.revealInView = id => {
  const f = app.doc.element(id); if (!f) return;
  if (VIEW_TYPES.includes(app.doc.typeOf(f))) return app.openView(id);
  const plan = app.tabs.find(t => app.doc.element(t) && app.doc.typeOf(app.doc.element(t)) === "PlanView") || firstOf("PlanView");
  if (plan && app.activeView !== plan) app.openView(plan);
};
app.editInView = (id, key) => { app.select([id]); app.revealInView(id); app.tool = "select"; app.say(`Drag the handles to edit ${key}; type a number mid-drag for an exact value`, "note"); app.refresh(); };
app.startPick = (pm) => { app.pickMode = pm; app.revealInView(pm.ids[0]); app.say(`Pick an element to bind ${pm.label} (${pm.kind} only) — Esc cancels`, "note"); app.refresh(); };
app.endPick = () => { app.pickMode = null; app.refresh(); };
const firstOf = type => { const f = app.doc.elements().find(g => app.doc.typeOf(g) === type); return f ? app.doc.idOf(f) : null; };

// ---------------------------------------------------------------- documents
function setDocument(doc, note) {
  app.doc = doc; app.editor = new Editor(doc); app.selection.clear(); app.views.clear();
  const saved = store("tabs");
  app.tabs = (saved && saved.tabs || []).filter(t => t.startsWith("__") || doc.element(t));
  if (!app.tabs.length) app.tabs = ["V-P00", "SH-A101"].filter(t => doc.element(t));
  if (!app.tabs.length) { const p = firstOf("PlanView"); if (p) app.tabs = [p]; }
  app.activeView = saved && app.tabs.includes(saved.active) ? saved.active : app.tabs[0] || null;
  app.refresh();
  if (note) app.say(note.msg, note.kind);
}
let draftTimer = null;
function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(() => { try { store("draft", app.doc.toJSON()); } catch (e) { /* too big or blocked: the draft is a convenience only */ } }, 800); }

// ---------------------------------------------------------------- top bar
function renderBar() {
  const bar = clear(document.getElementById("bar"));
  const doc = app.doc;
  bar.append(
    h("button", { class: "btn ghost mobile-only", "aria-label": "Project browser", onclick: () => document.body.classList.toggle("show-left") }, icon("menu")),
    h("div", { class: "brand" }, h("b", {}, "B"), h("span", { class: "hide-narrow" }, "Web BIM")),
    h("input", { class: "docname hide-narrow", id: "docname", value: doc.meta.name, "aria-label": "Project name", onchange: e => { doc.meta.name = e.target.value; saveDraftSoon(); app.refresh(); } }),
    h("span", { class: "sep hide-narrow" }),
    h("div", { class: "tabs grow", role: "tablist" }, app.tabs.map(t => {
      const f = doc.element(t), label = t === "__graph" ? "Node graph" : t === "__diag" ? "Diagnostics" : f ? f.get("Name") : t;
      return h("button", { class: "tab", role: "tab", "aria-selected": String(t === app.activeView), onclick: () => app.openView(t) }, label,
        h("span", { class: "x", role: "button", "aria-label": `Close ${label}`, onclick: e => { e.stopPropagation(); app.closeTab(t); } }, "✕"));
    })),
    h("button", { class: "btn ghost", title: "Undo (Ctrl+Z)", "aria-label": "Undo", disabled: !app.editor.undoStack.length, onclick: () => { app.editor.undo(); app.refresh(); saveDraftSoon(); } }, icon("undo")),
    h("button", { class: "btn ghost", title: "Redo (Ctrl+Shift+Z)", "aria-label": "Redo", disabled: !app.editor.redoStack.length, onclick: () => { app.editor.redo(); app.refresh(); saveDraftSoon(); } }, icon("redo")),
    h("span", { class: "sep hide-narrow" }),
    h("button", { class: "btn hide-narrow", onclick: fileMenu }, "File"),
    h("button", { class: "btn primary", onclick: exportDialog }, "Export"),
    h("button", { class: "btn ghost mobile-only", "aria-label": "Properties", onclick: () => document.body.classList.toggle("show-right") }, icon("props")));
}

// ---------------------------------------------------------------- left dock
function renderLeft() {
  const left = clear(document.getElementById("left"));
  const tabs = h("div", { class: "dock-tabs", role: "tablist" },
    [["project", "Project"], ["tree", "Feature tree"]].map(([k, l]) => h("button", { role: "tab", "aria-selected": String(app.leftTab === k), onclick: () => { app.leftTab = k; renderLeft(); } }, l)));
  const body = h("div", { class: "dock-body" });
  left.append(tabs, body);
  if (app.leftTab === "project") renderBrowser(body); else renderTree(body);
}
function node(label, kids, opts = {}) {
  const open = app.expanded.has(opts.key || label);
  const li = h("li");
  const row = h("div", { class: "row" + (opts.sel ? " sel" : ""), draggable: opts.drag ? "true" : null, ondragstart: opts.drag ? (e => e.dataTransfer.setData("text/x-webbim-view", opts.drag)) : null,
    onclick: opts.onclick || (kids ? () => { const k = opts.key || label; if (app.expanded.has(k)) app.expanded.delete(k); else app.expanded.add(k); renderLeft(); } : null), ondblclick: opts.ondbl },
    h("button", { class: "fold", tabindex: -1, "aria-label": open ? "Fold" : "Unfold", onclick: e => { e.stopPropagation(); const k = opts.key || label; if (app.expanded.has(k)) app.expanded.delete(k); else app.expanded.add(k); renderLeft(); } }, kids ? (open ? "−" : "+") : ""),
    opts.dot ? h("span", { class: "dot " + opts.dot, title: opts.dotTitle || "" }) : null,
    h("span", { class: "lab" + (opts.head ? " head" : "") }, label), opts.count !== undefined ? h("span", { class: "count" }, opts.count) : null, opts.extra || null, opts.id ? h("span", { class: "id" }, opts.id) : null);
  li.append(row);
  if (kids && (open || app.treeFilter)) li.append(h("ul", {}, kids));
  return li;
}
function renderBrowser(body) {
  const doc = app.doc, els = doc.elements();
  const byType = t => els.filter(f => doc.typeOf(f) === t);
  const viewRow = f => node(f.get("Name"), null, { id: doc.idOf(f), sel: app.activeView === doc.idOf(f), onclick: () => app.openView(doc.idOf(f)), drag: doc.idOf(f),
    extra: placedChip(doc.idOf(f)) });
  const placed = new Map(); for (const sh of byType("Sheet")) for (const vp of doc.argValue(sh, "viewports") || []) placed.set(vp.view.ref, doc.argValue(sh, "number"));
  function placedChip(id) { return placed.has(id) ? h("span", { class: "chip", title: "placed on sheet" }, placed.get(id)) : null; }
  const tree = h("ul", { class: "tree" });
  tree.append(node("Views", [
    node("Floor plans", byType("PlanView").map(viewRow), { count: byType("PlanView").length, extra: h("button", { class: "iconbtn", title: "New plan view", "aria-label": "New plan view", onclick: e => { e.stopPropagation(); newPlanView(); } }, "+") }),
    node("Elevations", byType("ElevationView").map(viewRow), { count: byType("ElevationView").length }),
    node("3D views", byType("View3D").map(viewRow), { count: byType("View3D").length }),
    node("Schedules", byType("Schedule").map(viewRow), { count: byType("Schedule").length }),
  ], { head: true }));
  tree.append(node("Sheets", byType("Sheet").sort((a, b) => String(doc.argValue(a, "number")).localeCompare(doc.argValue(b, "number"))).map(f => node(`${doc.argValue(f, "number")} ${doc.argValue(f, "sheetName")}`, null, { sel: app.activeView === doc.idOf(f), onclick: () => app.openView(doc.idOf(f)) })),
    { head: true, count: byType("Sheet").length, extra: h("button", { class: "iconbtn", title: "New sheet", "aria-label": "New sheet", onclick: e => { e.stopPropagation(); newSheet(); } }, "+") }));
  tree.append(node("Levels", byType("Level").map(f => node(`${F.text(f, "name")}  ${fmtLen(F.real(f, "elevation"))}`, null, { id: doc.idOf(f), sel: app.selection.has(doc.idOf(f)), onclick: () => app.select([doc.idOf(f)]) })), { head: true, count: byType("Level").length }));
  // families as classes: the extends chain, types at the leaves
  const fams = doc.lib.families, roots = Object.keys(fams).filter(k => !fams[k].extends);
  const famNode = id => node(fams[id].name + (fams[id].sealed ? " (system)" : ""), [
    ...Object.keys(fams).filter(k => fams[k].extends === id).map(famNode),
    ...Object.entries(doc.lib.types).filter(([, t]) => t.family === id).map(([tid, t]) => node(t.name || tid, null, { id: tid, onclick: () => typeEditor(app, tid) })),
  ], { key: "fam:" + id });
  tree.append(node("Families & types", roots.map(famNode), { head: true, key: "Families" }));
  tree.append(node("View styles", Object.entries(doc.lib.viewStyles).map(([id, s]) => node(s.name || id, null, { id, onclick: () => { const v = app.activeView && doc.element(app.activeView); if (v && F.refId(v, "style") === id) vvDialog(app, app.activeView); else app.say(`Open a view that uses ${s.name} and press Visibility / Graphics`, "note"); } })), { head: true, key: "Styles" }));
  tree.append(node("Relationships", [
    node("Joins", doc.joins.map(j => node(`${j.a.of}.${j.a.end} ⟷ ${j.b.of}${j.b.end ? "." + j.b.end : " @ " + Math.round(j.b.u)}`, null, { id: j.id, extra: h("span", { class: "chip" }, j.allowed === false ? "off" : j.kind || "auto"), onclick: () => app.select([j.a.of, j.b.of]) })), { count: doc.joins.length }),
    node("Constraints", doc.constraints.map(c => node(`${c.kind} ${c.value ?? ""}`, null, { id: c.id, extra: h("button", { class: "iconbtn", title: c.locked === false ? "Enable" : "Disable", "aria-label": `Toggle ${c.id}`, onclick: e => { e.stopPropagation(); app.apply({ op: "relate", store: "constraints", row: Object.assign({}, c, { locked: c.locked === false }) }); } }, c.locked === false ? icon("unlock") : icon("lock")),
      onclick: () => app.select(c.of.map(r => r.split(":")[0]).filter(id => doc.element(id))) })), { count: doc.constraints.length }),
  ], { head: true, key: "Relationships" }));
  tree.append(node("Symbols", Object.entries(doc.lib.symbols).map(([id, s]) => node(s.name || id, null, { id, extra: s.source ? h("button", { class: "btn small", onclick: e => { e.stopPropagation(); placeSymbol(id); } }, "Place") : null })), { head: true, extra: h("button", { class: "iconbtn", title: "Import a DXF symbol", "aria-label": "Import DXF symbol", onclick: e => { e.stopPropagation(); importDXF(); } }, "+") }));
  tree.append(node("Node graph", null, { head: true, onclick: () => app.openView("__graph"), sel: app.activeView === "__graph" }));
  tree.append(node("Diagnostics & acceptance tests", null, { head: true, onclick: () => app.openView("__diag"), sel: app.activeView === "__diag" }));
  body.append(tree);
}
function renderTree(body) {
  const doc = app.doc;
  const q = app.treeFilter.toLowerCase();
  const input = h("input", { type: "search", placeholder: "Search the tree", value: app.treeFilter, "aria-label": "Search the feature tree", oninput: e => { app.treeFilter = e.target.value; const pos = e.target.selectionStart; renderLeft(); const i = document.querySelector(".left .search input"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } } });
  body.append(h("div", { class: "search" }, input));
  const ul = h("ul", { class: "tree" });
  for (const f of doc.elements()) {
    const id = doc.idOf(f), name = f.get("Name"), t = doc.typeOf(f);
    if (q && !(`${name} ${id} ${t}`.toLowerCase().includes(q))) continue;
    const err = doc.error(f), note = doc.note(f);
    const eye = h("button", { class: "eye", "aria-pressed": String(f.get("Integer") !== 0), "aria-label": `Toggle visibility of ${id}`, title: "visible", onclick: e => { e.stopPropagation(); app.apply({ op: "set", id, key: "visible", value: f.get("Integer") === 0 }); } }, "◉");
    ul.append(h("li", {}, h("div", { class: "row" + (app.selection.has(id) ? " sel" : ""), onclick: e => app.select([id], e.shiftKey || e.ctrlKey || e.metaKey), ondblclick: () => app.revealInView(id), title: err || note || CATALOGUE.get(t)?.summary || "" },
      h("span", { class: "dot " + (err ? "err" : note ? "note" : "ok"), title: err || note || "built" }), eye,
      h("span", { class: "lab", style: f.get("Integer") === 0 ? { opacity: .5 } : {} }, name), h("span", { class: "id" }, `${t} · ${id}`))));
  }
  body.append(ul);
}

// ---------------------------------------------------------------- right dock
function renderRight() {
  const right = clear(document.getElementById("right"));
  right.append(h("div", { class: "dock-tabs" }, h("button", { "aria-selected": "true" }, "Properties")));
  const body = h("div", { class: "dock-body" });
  right.append(body);
  const vp = [...app.selection].find(id => id.includes(":VP"));
  if (vp) return renderViewportPanel(body, vp);
  renderPanel(app, body);
}
function renderViewportPanel(body, key) {
  const [shId, vpId] = key.split(":"), doc = app.doc, sh = doc.element(shId);
  const vp = (doc.argValue(sh, "viewports") || []).find(v => v.id === vpId); if (!vp) return;
  const view = doc.element(vp.view.ref);
  body.append(h("div", { class: "pp" }, h("div", { class: "pp-head" }, h("div", { style: { fontWeight: 600, fontSize: "15px" } }, `Viewport ${vpId}`), h("div", { class: "muted" }, "A frame holding a view, not a copy of it. Scale and crop live on the view.")),
    h("div", { class: "prow" }, h("label", {}, "View"), h("div", { class: "val" }, h("button", { class: "btn small", onclick: () => app.openView(vp.view.ref) }, view ? view.get("Name") : vp.view.ref))),
    h("div", { class: "prow" }, h("label", {}, "Position"), h("div", { class: "ro mono" }, `${fmtLen(vp.at[0])}, ${fmtLen(vp.at[1])} mm on paper`)),
    h("div", { class: "prow" }, h("label", { for: "vp-clip" }, "Show crop"), h("div", { class: "ro" }, h("input", { id: "vp-clip", type: "checkbox", checked: !!vp.clipVisible, onchange: e => app.apply({ op: "sheet", id: shId, viewport: vpId, value: { clipVisible: e.target.checked } }) }))),
    view && F.int(view, "scale") ? h("div", { class: "prow" }, h("label", {}, "Scale"), h("div", { class: "ro" }, "1:" + F.int(view, "scale"))) : null,
    h("div", { style: { padding: "12px 14px" } }, h("button", { class: "btn", onclick: () => { app.apply({ op: "sheet", id: shId, viewport: vpId, remove: true }); app.select([]); app.say("Viewport removed; the view itself survives", "ok"); } }, "Remove from sheet"))));
}

// ---------------------------------------------------------------- main area
function renderMain() {
  const main = document.getElementById("main");
  clear(main);
  const id = app.activeView, doc = app.doc;
  if (!id) { main.append(h("div", { class: "empty", style: { maxWidth: "520px", margin: "60px auto" } }, h("h3", {}, "No view open"), "Open a plan, elevation, 3D view, schedule or sheet from the project browser.")); return; }
  if (id === "__graph") { renderGraph(app, main, app.graphFocus); app.graphFocus = null; app.views.set(id, {}); return; }
  if (id === "__diag") { renderDiagnostics(main); app.views.set(id, {}); return; }
  const v = doc.element(id); if (!v) { app.closeTab(id); return; }
  const t = doc.typeOf(v);
  if (t === "Schedule") { renderSchedule(app, main, v); app.views.set(id, {}); return; }
  if (t === "View3D" && app.mode3d[id] !== "lines") {
    const view = new View3D(app, main, id);
    app.views.set(id, view);
    main.append(h("div", { class: "viewbar", style: { bottom: "auto", top: "10px" } }, h("div", { class: "card" }, h("div", { class: "seg" },
      h("button", { "aria-pressed": "true" }, "Shaded"), h("button", { "aria-pressed": "false", onclick: () => { app.mode3d[id] = "lines"; renderMain(); } }, "Sheet line-work")))));
    return;
  }
  const prev = app.views.get(id);
  const view = new View2D(app, main, id);
  if (prev && prev.cam) view.cam = prev.cam;
  app.views.set(id, view);
  view.canvas.addEventListener("keydown", e => { if (view.key(e)) { e.preventDefault(); e.stopPropagation(); } });
  if (t === "PlanView") main.append(rail(), toolOptions());
  main.append(viewBar(v, t));
  view.draw();
  if (t === "View3D") { const sc = deriveView(doc, v); if (sc.stale) main.append(h("div", { class: "stale" }, `Hidden-line ${sc.stale} — regenerate from the Shaded tab. Export refuses stale viewports.`)); }
}
function viewBar(v, t) {
  const doc = app.doc, id = doc.idOf(v);
  const card = h("div", { class: "card" });
  if (t === "PlanView" || t === "ElevationView") {
    const styleId = F.refId(v, "style");
    card.append(h("div", { class: "seg", role: "group", "aria-label": "View style" },
      [["VS-CONSTRUCTION", "Construction"], ["VS-PRESENTATION", "Presentation"]].map(([sid, l]) => h("button", { "aria-pressed": String(styleId === sid), onclick: () => app.apply({ op: "set", id, key: "style", value: { ref: sid } }) }, l))));
    card.append(h("div", { class: "seg", role: "group", "aria-label": "Detail level" }, ["Coarse", "Medium", "Fine"].map(d => h("button", { "aria-pressed": String(F.choice(v, "detailLevel") === d), onclick: () => app.apply({ op: "set", id, key: "detailLevel", value: d }) }, d))));
    card.append(h("select", { "aria-label": "Scale", onchange: e => app.apply({ op: "set", id, key: "scale", value: Number(e.target.value) }) }, [10, 20, 50, 100, 200, 500].map(s => h("option", { value: s, selected: F.int(v, "scale") === s }, "1:" + s))));
    if (t === "PlanView") card.append(h("select", { "aria-label": "Colour fill", title: "Colour-fill plan", onchange: e => { const ov = Object.assign({}, doc.argValue(v, "overrides") || {}); if (e.target.value) ov.__colourFill = e.target.value; else delete ov.__colourFill; app.apply({ op: "set", id, key: "overrides", value: ov }); } },
      h("option", { value: "" }, "No colour fill"), ["Department", "Number", "Name"].map(k => h("option", { value: k, selected: (doc.argValue(v, "overrides") || {}).__colourFill === k }, "Fill by " + k))));
    card.append(h("button", { class: "btn small", onclick: () => vvDialog(app, id) }, "VV"));
  }
  if (t === "View3D") card.append(h("div", { class: "seg" }, h("button", { "aria-pressed": "false", onclick: () => { app.mode3d[id] = "shaded"; renderMain(); } }, "Shaded"), h("button", { "aria-pressed": "true" }, "Sheet line-work")));
  card.append(h("button", { class: "btn small", title: "Thin lines (screen only — never exported)", "aria-pressed": String(app.thinLines), onclick: () => { app.thinLines = !app.thinLines; app.refresh({ keepMain: true }); } }, app.thinLines ? "Thin lines ✓" : "Thin lines"));
  card.append(h("button", { class: "btn small", onclick: () => app.views.get(id).fit() }, "Fit"));
  return h("div", { class: "viewbar" }, card);
}
function rail() {
  return h("nav", { class: "rail", "aria-label": "Tools" }, TOOLS.map(([k, label, key]) => h("button", { "aria-pressed": String(app.tool === k), title: `${label} (${key})`, onclick: () => setTool(k) },
    h("span", { html: "" }, icon(TOOL_ICON[k])), h("span", { class: "lbl" }, label), h("span", { class: "k lbl" }, key))));
}
function setTool(k) { app.tool = k; app.pickMode = null; const v = app.views.get(app.activeView); if (v && v.tool) { v.tool.pts = []; v.tool.refs = []; v.tool.preview = null; } app.refresh(); app.say(TOOL_HINT[k] || "", "note"); }
const TOOL_HINT = {
  select: "Click to select, Shift adds. Drag empty space to pan; wheel zooms. Handles write parameters.",
  wall: "Click points; the chain shares nodes (L joins) and lands on centrelines (T joins, never splits). Type a length + Enter. Enter ends, C closes, Esc cancels.",
  opening: "Click a wall: an opening with nothing in it — a doorway, a service hole.", door: "Click a wall: an opening, then a door filling it.", window: "Click a wall: an opening, then a window filling it.",
  column: "Click to place.", grid: "Two clicks.", text: "Click, type, Enter. Height is paper millimetres.", dim: "Click two parallel references: faces, centrelines, grids. The dimension binds to them, not to points.",
  space: "Click inside a room. The space keeps its identity by this anchor.", elev: "Two clicks: the marker line is the view.", sep: "Two clicks: divides rooms with no wall.",
};
function toolOptions() {
  const o = app.toolOpts, doc = app.doc, tool = app.tool;
  const typesOf = cat => Object.entries(doc.lib.types).filter(([id]) => (doc.resolveType(id) || {}).category === cat);
  const sel = (key, opts, label) => h("label", {}, label + " ", h("select", { onchange: e => { o[key] = e.target.value; } }, opts.map(([v, l]) => h("option", { value: v, selected: o[key] === v }, l))));
  const num = (key, label) => h("label", {}, label + " ", h("input", { type: "text", value: o[key], style: { width: "64px" }, onchange: e => { o[key] = Number(e.target.value); } }));
  let kids = null;
  if (tool === "wall") kids = [sel("wallType", typesOf("IfcWall").map(([id, t]) => [id, t.name]), "Type"), sel("mounting", ["Centred", "Core centre", "Core exterior", "Core interior", "Finish exterior", "Finish interior"].map(x => [x, x]), "Location"), num("height", "Height")];
  if (tool === "door") kids = [sel("doorType", typesOf("IfcDoor").map(([id, t]) => [id, t.name]), "Type")];
  if (tool === "window") kids = [sel("windowType", typesOf("IfcWindow").map(([id, t]) => [id, t.name]), "Type"), num("sill", "Sill")];
  if (tool === "opening") kids = [num("width", "Width"), num("height_", "Height"), num("openSill", "Sill")];
  if (tool === "column") kids = [sel("columnType", typesOf("IfcColumn").map(([id, t]) => [id, t.name]), "Type")];
  if (tool === "space") kids = [h("label", {}, "Name ", h("input", { type: "text", value: o.spaceName, style: { width: "110px" }, onchange: e => { o.spaceName = e.target.value; } })), sel("boundaryAt", [["finishFace", "Finish face (net)"], ["coreFace", "Core face"], ["coreCentre", "Core centre"], ["wallCentre", "Wall centre (gross)"]], "Boundary")];
  if (app.pickMode) kids = [h("span", {}, `Binding ${app.pickMode.label}: click an element`), h("button", { class: "btn small", onclick: app.endPick }, "Cancel")];
  return kids ? h("div", { class: "toolopts" }, kids) : h("span");
}

// ---------------------------------------------------------------- status bar
function updateStatus() {
  const st = document.getElementById("status");
  if (!st.querySelector("#msg")) {
    clear(st);
    st.append(h("div", { id: "msg", class: "msg", role: "status", "aria-live": "polite" }, "Ready"),
      h("div", { class: "snaps hide-narrow", role: "group", "aria-label": "Snaps" }, SNAP_KINDS.map(k => h("button", { "aria-pressed": String(!!app.snaps[k]), title: `Snap: ${k}`, onclick: e => { app.snaps[k] = !app.snaps[k]; e.target.setAttribute("aria-pressed", String(app.snaps[k])); store("snaps", app.snaps); } }, { endpoint: "end", midpoint: "mid", centre: "cen", intersection: "int", perpendicular: "perp", nearest: "near", grid: "grid", angle: "15°" }[k]))),
      h("div", { id: "stats", class: "mono hide-narrow" }));
  }
  const s = app.doc.stats, lr = s.lastRegen;
  document.getElementById("stats").textContent = `regen ${lr ? lr.ms.toFixed(1) : "–"} ms · ${lr ? lr.rebuilt.length : 0} rebuilt · model rev ${app.doc.modelRevision} · view rev ${app.doc.viewRevision}`;
}

// ---------------------------------------------------------------- new views & sheets
function newPlanView() {
  const lv = firstOf("Level"); if (!lv) return app.say("add a level first", "error");
  const r = app.apply({ op: "add", element: { type: "PlanView", name: "Plan " + (app.doc.elements().filter(f => app.doc.typeOf(f) === "PlanView").length + 1), args: { level: { ref: lv }, scale: 100, viewRange: { top: 2300, cut: 1200, bottom: 0 }, detailLevel: "Fine", style: { ref: "VS-CONSTRUCTION" }, filters: [], clip: { rect: null, visible: false, active: false }, overrides: {} } } });
  if (r.ok) app.openView(r.id);
}
function newSheet() {
  const n = app.doc.elements().filter(f => app.doc.typeOf(f) === "Sheet").length + 1;
  const r = app.apply({ op: "add", element: { type: "Sheet", name: `A-${100 + n} New Sheet`, args: { number: `A-${100 + n}`, sheetName: "New Sheet", size: "A3", orientation: "landscape", viewports: [], revision: "P01" } } });
  if (r.ok) { app.openView(r.id); app.say("Drag a view from the browser onto the sheet to place it", "note"); }
}
function placeSymbol(symId) {
  const v = app.activeView && app.doc.element(app.activeView);
  if (!v || app.doc.typeOf(v) !== "PlanView") return app.say("open a plan view to place a symbol in", "note");
  const view = app.views.get(app.activeView), c = view.toModel(view.W / 2, view.H / 2);
  app.apply({ op: "add", element: { type: "SymbolInstance", args: { symbol: { ref: symId }, position: c.map(Math.round), rotation: 0, view: { ref: app.activeView } } } });
}

// ---------------------------------------------------------------- files
function fileMenu() {
  const openIn = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: async e => {
    const file = e.target.files[0]; if (!file) return;
    try { const doc = openDocument(await file.text()); doc.regenerate(); setDocument(doc, { msg: `Opened ${file.name}${doc.loadReport.length ? " — " + doc.loadReport.join("; ") : ""}`, kind: doc.loadReport.length ? "note" : "ok" }); d.close(); }
    catch (err) { app.say(`Could not open ${file.name}: ${err.message}`, "error"); }
  } });
  const d = dialog("File", h("div", { style: { display: "grid", gap: "10px" } },
    h("button", { class: "btn", onclick: () => openIn.click() }, "Open a model (.json)…"), openIn,
    h("button", { class: "btn", onclick: async () => { const r = await saveFile(`${app.doc.meta.name || "model"}.json`, app.doc.serialise(), "application/json"); app.say(r.ok ? "Model saved" : r.error, r.ok ? "ok" : "error"); } }, "Save the model (.json) — readable, diffable, the same format edits are"),
    h("button", { class: "btn", onclick: () => { d.close(); importDXF(); } }, "Import a DXF symbol…"),
    h("button", { class: "btn", onclick: () => { forget("draft"); forget("tabs"); setDocument(buildSample(), { msg: "Sample project loaded", kind: "ok" }); d.close(); } }, "Reset to the sample project"),
    h("button", { class: "btn", onclick: () => { forget("draft"); const doc = newDocument("Untitled"); doc.addElement({ id: "L0", type: "Level", name: "Ground", args: { name: "Ground", elevation: 0 } }); doc.addElement({ id: "V-P00", type: "PlanView", name: "Ground Floor Plan", args: { level: { ref: "L0" }, scale: 100, style: { ref: "VS-CONSTRUCTION" } } }); doc.regenerate(); forget("tabs"); setDocument(doc, { msg: "New empty model: draw walls with W", kind: "ok" }); d.close(); } }, "New empty model"),
    h("div", { class: "muted" }, "Your edits are kept as a draft in this browser only. Save the model to keep it anywhere else.")));
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
    h("div", { class: "muted" }, "Page size per sheet; line weights are physical mm; hatches as tiling patterns; the font embedded; bookmarks, category layers and marker links included. Sheets are re-derived for export, and a stale hidden-line viewport stops the export."),
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
  // HLR viewports must be current: a staleness badge is fine on screen, not in an issued set (§12.1)
  const stale = [];
  for (const sh of sheets) for (const vp of doc.argValue(sh, "viewports") || []) { const v = doc.element(vp.view.ref); if (v && doc.typeOf(v) === "View3D") { const sc = deriveView(doc, v); if (sc.stale) stale.push(`${doc.argValue(sh, "number")} ${vp.id} (${v.get("Name")}: ${sc.stale})`); } }
  if (stale.length) return app.say(`Export refused — regenerate these hidden-line viewports first: ${stale.join("; ")}`, "error");
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

// ---------------------------------------------------------------- keys
window.addEventListener("keydown", e => {
  const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) app.editor.redo(); else app.editor.undo(); app.refresh(); saveDraftSoon(); return; }
  if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); app.editor.redo(); app.refresh(); return; }
  if (e.key === "Escape") { if (app.pickMode) { app.endPick(); return; } if (app.tool !== "select") { setTool("select"); return; } if (app.selection.size) app.select([]); return; }
  if ((e.key === "Delete" || e.key === "Backspace") && app.selection.size && app.activeView !== "__graph") {
    const ids = [...app.selection].filter(id => app.doc.element(id));
    const vps = [...app.selection].filter(id => id.includes(":VP"));
    if (ids.length) { const r = app.apply({ op: "delete", ids }); if (r.ok) app.say(`Deleted ${r.deleted.join(", ")}`, "ok"); }
    for (const k of vps) { const [sh, vp] = k.split(":"); app.apply({ op: "sheet", id: sh, viewport: vp, remove: true }); }
    app.select([]); return;
  }
  if (mod || e.altKey) return;
  const v = app.doc.element(app.activeView);
  if (v && app.doc.typeOf(v) === "PlanView") { const tool = TOOLS.find(x => x[2].toLowerCase() === e.key.toLowerCase()); const view = app.views.get(app.activeView); if (tool && !(view && view.tool && view.tool.pts.length)) { setTool(tool[0]); e.preventDefault(); } }
  if (e.key === "f" || e.key === "F") { const view = app.views.get(app.activeView); if (view && view.fit) view.fit(); }
});

// ---------------------------------------------------------------- boot
async function boot() {
  const snaps = store("snaps"); if (snaps) Object.assign(app.snaps, snaps);
  await loadDrawingFont();
  let doc = null, note = null;
  const draft = store("draft");
  if (draft) { try { doc = openDocument(draft); doc.regenerate(); note = { msg: "Restored your draft from this browser. File › Reset to go back to the sample.", kind: "note" }; } catch (e) { doc = null; } }
  if (!doc) doc = buildSample();
  setDocument(doc, note || { msg: `Studio House: ${doc.elements().length} elements regenerated in ${doc.stats.lastRegen.ms.toFixed(0)} ms. Select a wall to see its handles and listening dimensions.`, kind: "ok" });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
