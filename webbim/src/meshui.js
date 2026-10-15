//! Edit Mesh: the mode in a plan where a MeshGrid is edited, and with it every slab and wall it makes.
//!
//! It takes the sketch slot (app.sketch), as Revit's edit modes take the ribbon: the ribbon becomes the mesh's tab
//! and the options bar carries the level being edited and the tool's numbers. Every edit is one step in the
//! project's own undo (a meshedit op: the mesh changed, its slabs and walls made again), so Ctrl+Z works as anywhere.
//!
//!   Move Node      drag a node: the cells round it follow, and their slabs and walls
//!   Add Node       click an edge: a node there, in the cells either side
//!   Delete Node    click a node where two edges meet (a node holding three or more cells together stays)
//!   Split Cell     click two corners of a cell: it becomes two cells
//!   Merge Cells    click two cells that share an edge: they become one
//!   Draw Cell      click corners (nodes, edges or anywhere), back on the first to close: a new cell
//!   Delete Cell    click a cell: it goes, from every level
//!   Cells Used     click a cell: used on this level or not (whole, or in part at the scale in the options bar)
//!   Lift, Stair, Escalator, Riser, Shaft, Structural Core: click to place one from this level up
//!   Atrium         click a cell: a void the shape of the cell (inset), from this level up

import { h } from "./ui_util.js";
import { parseLength } from "./units.js";
import { F } from "./ocaf.js";
import { dist } from "./geom2d.js";
import { cellShape, cellPolys, meshGridEdges, meshMoveNode, meshAddNodeOnEdge, meshDeleteNode, meshDeleteCell, meshSplitCell, meshMergeCells, meshAddCell, meshEdgeNear, meshCellAt, meshCopyUse, levelsByElevation, CORE_COLOUR } from "./meshgrid.js";

const MESH_BLUE = "#1d6fd8", MESH_RED = "#c62828";
export const MESH_TOOLS = [
  ["move", "Move Node", "move", "drag a node: the cells round it, their slabs and walls follow"],
  ["addnode", "Add Node", "skline", "click an edge: a node there, in the cells either side"],
  ["delnode", "Delete Node", "close", "click a node where two edges meet"],
  ["split", "Split Cell", "split", "click two corners of a cell: it becomes two"],
  ["merge", "Merge Cells", "skrect", "click two cells that share an edge: they become one"],
  ["drawcell", "Draw Cell", "skpoly", "click corners - on nodes, on edges or anywhere - and the first again to close"],
  ["delcell", "Delete Cell", "close", "click a cell: it goes from the mesh and every level"],
  ["use", "Cells Used", "floor", "click a cell: used on this level, or not (whole, or in part at the scale set)"],
];
export const MESH_CORES = [["Lift", 5200, 2600], ["Stair", 6000, 3000], ["Escalator", 12000, 1600], ["Riser", 3000, 2000], ["Shaft", 3000, 3000], ["Structural core", 12000, 8000]];

export class MeshSession {
  constructor(app, view, meshId) {
    this.app = app; this.view = view; this.id = meshId; this.target = { kind: "mesh", id: meshId };
    this.tool = "use"; this.pts = []; this.first = null; this.hoverNode = null; this.hoverEdge = null; this.hoverCell = null; this.drag = null;
    this.opts = Object.assign({ part: false, scale: 0.7, coreUse: "Lift", coreTop: null, inset: 2000 }, app.meshOpts || {});
    app.meshOpts = this.opts;
    this.level = F.refId(view.view, "level") || null;
  }
  /** The plan the session works in: looked up each time, since the app may rebuild a view's canvas after an edit. */
  get view() { return (this.viewId && this.app.views.get(this.viewId)) || this.viewObj; }
  set view(v) { this.viewObj = v; this.viewId = v && v.viewId; }
  get title() { return `Edit Mesh ${this.id}${this.level ? " · " + this.level : ""}`; }
  get doc() { return this.app.doc; }
  say(msg, kind = "note") { this.app.say(msg, kind); }
  mesh() { const f = this.doc.element(this.id); return { nodes: F.json(f, "nodes") || {}, cells: F.json(f, "cells") || {}, use: F.json(f, "use") || {} }; }
  /** One step: the mesh as given, its slabs and walls made again. */
  commit(next, msg) {
    const r = this.app.apply({ op: "meshedit", id: this.id, nodes: next.nodes, cells: next.cells, use: next.use, replace: true });
    if (r.ok) this.say(`${msg}${r.said ? " - " + r.said : ""}`, "ok"); else this.say(r.error, "error");
    this.refresh(); return r.ok;
  }
  /** A pure edit that may refuse (it says why). */
  run(fn, msg) { try { const out = fn(this.mesh()); const m = out && out.mesh ? out.mesh : out; return this.commit(m, typeof msg === "function" ? msg(out) : msg); } catch (e) { this.say(e.message, "error"); return false; } }
  refresh() { this.view.draw(); this.app.renderOptions && this.app.renderOptions(); }
  undo() { this.app.run("undo"); this.refresh(); }
  redo() { this.app.run("redo"); this.refresh(); }
  setTool(t) {
    if (!MESH_TOOLS.some(r => r[0] === t) && t !== "core" && t !== "atrium") return;
    this.tool = t; this.pts = []; this.first = null;
    const row = MESH_TOOLS.find(r => r[0] === t);
    this.say(row ? `${row[1]}: ${row[3]}` : t === "atrium" ? "Atrium: click a cell - a void the shape of the cell, inset as set, from this level up" : `${this.opts.coreUse}: click where it goes (its centre); it runs from this level up`);
    this.app.refresh({ keepMain: true });
  }
  tol() { return 9 * this.view.modelPerPx(); }
  nodeNear(p) { const N = this.mesh().nodes; let best = null, bd = this.tol(); for (const [id, q] of Object.entries(N)) { const d = dist(p, q); if (d < bd) { bd = d; best = id; } } return best; }

  // ------------------------------------------------------------ levels
  levels() { return levelsByElevation(this.doc); }
  /** Edit another level: its plan opens and the session moves to it. */
  setLevel(lid) {
    this.level = lid; this.pts = []; this.first = null;
    const pv = this.doc.elements().find(g => this.doc.typeOf(g) === "PlanView" && F.refId(g, "level") === lid);
    if (pv) { const vid = this.doc.idOf(pv); this.app.openView(vid); const v = this.app.views.get(vid); if (v) this.view = v; }
    this.app.refresh({ keepMain: true }); this.refresh();
  }
  neighbour(k) { const L = this.levels(), i = L.findIndex(l => l.id === this.level); return L[i + k] ? L[i + k].id : null; }

  // ------------------------------------------------------------ pointer
  /** Move Node takes the press: drag the node, the cells round it shown where they go, applied on release. */
  pointerDown(sx, sy, e) {
    if (this.tool !== "move" || e.button !== 0) return false;
    const p = this.view.toModel(sx, sy), nid = this.nodeNear(p); if (!nid) return false;
    const start = this.mesh().nodes[nid].slice();
    this.drag = { nid, start, to: start.slice() };
    const move = ev => { const r = this.view.canvas.getBoundingClientRect(); const q = this.view.quantise(this.view.toModel(ev.clientX - r.left, ev.clientY - r.top)); this.drag.to = q; this.view.draw(); };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const d = this.drag; this.drag = null; if (!d) return;
      if (dist(d.to, d.start) < 1) { this.view.draw(); return; }
      this.run(m => meshMoveNode(m, d.nid, d.to), `${d.nid} moved ${Math.round(dist(d.to, d.start))} mm`);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return true;
  }
  hover(p) {
    const m = this.mesh();
    this.cursor = p;
    this.hoverNode = ["move", "delnode", "split", "drawcell"].includes(this.tool) ? this.nodeNear(p) : null;
    this.hoverEdge = ["addnode", "drawcell"].includes(this.tool) && !this.hoverNode ? meshEdgeNear(m, p, this.tol()) : null;
    this.hoverCell = ["use", "merge", "delcell", "atrium", "split"].includes(this.tool) ? meshCellAt(m, p) : null;
    this.view.draw();
  }
  click(p, e) {
    const t = this.tool, m = this.mesh();
    if (t === "move") return;
    if (t === "addnode") { const ed = meshEdgeNear(m, p, this.tol()); if (!ed) return this.say("click on an edge of the mesh"); return this.run(x => meshAddNodeOnEdge(x, ed[0], ed[1], p), out => `${out.id} added on ${ed[0]}-${ed[1]}`); }
    if (t === "delnode") { const n = this.nodeNear(p); if (!n) return this.say("click on a node"); return this.run(x => meshDeleteNode(x, n), `${n} deleted`); }
    if (t === "delcell") { const c = meshCellAt(m, p); if (!c) return this.say("click inside a cell"); return this.run(x => meshDeleteCell(x, c), `${c} deleted from the mesh and every level`); }
    if (t === "use") {
      if (!this.level) return this.say("open a level's plan to pick its cells", "error");
      const c = meshCellAt(m, p); if (!c) return this.say("click inside a cell");
      const next = JSON.parse(JSON.stringify(m)); next.use[this.level] = next.use[this.level] || {};
      const had = next.use[this.level][c];
      if (had != null && !(this.opts.part && !Array.isArray(had)) && !(!this.opts.part && Array.isArray(had))) { delete next.use[this.level][c]; return this.commit(next, `${c} no longer used on ${this.level}`); }
      next.use[this.level][c] = this.opts.part ? [Math.max(0.05, Math.min(1, this.opts.scale)), 0, 0] : 1;
      return this.commit(next, `${c} used on ${this.level}${this.opts.part ? ` in part (scale ${this.opts.scale})` : ""}`);
    }
    if (t === "split") {
      const n = this.nodeNear(p); if (!n) return this.say("click a corner of the cell to split");
      if (!this.first) { this.first = n; this.say(`Split Cell: from ${n} - now click the opposite corner`); this.view.draw(); return; }
      const a = this.first; this.first = null;
      const cid = Object.keys(m.cells).find(c => m.cells[c].includes(a) && m.cells[c].includes(n));
      if (!cid) { this.view.draw(); return this.say(`${a} and ${n} are not corners of one cell`, "error"); }
      return this.run(x => meshSplitCell(x, cid, a, n), out => `${cid} split: ${out.id} made`);
    }
    if (t === "merge") {
      const c = meshCellAt(m, p); if (!c) return this.say("click inside a cell");
      if (!this.first) { this.first = c; this.say(`Merge Cells: ${c} - now click the cell next to it`); this.view.draw(); return; }
      const a = this.first; this.first = null;
      return this.run(x => meshMergeCells(x, a, c), out => `${a} and ${c} merged into ${out.id}`);
    }
    if (t === "drawcell") {
      const n = this.nodeNear(p), q = n ? m.nodes[n].slice() : this.view.quantise(p);
      if (this.pts.length >= 3 && dist(q, this.pts[0]) < this.tol()) return this.closeCell();
      this.pts.push(q); this.view.draw(); return;
    }
    if (t === "atrium") {
      const c = meshCellAt(m, p); if (!c) return this.say("click inside a cell");
      return this.placeCore({ use: "Atrium", mesh: { ref: this.id }, cell: c, inset: this.opts.inset, at: this.view.quantise(p), label: "Atrium" });
    }
    if (t === "core") {
      const row = MESH_CORES.find(r => r[0] === this.opts.coreUse) || MESH_CORES[0];
      return this.placeCore({ use: row[0], at: this.view.quantise(p), width: this.opts.coreW || row[1], depth: this.opts.coreD || row[2], cars: row[0] === "Lift" ? 2 : 1, label: row[0] });
    }
  }
  closeCell() {
    const P = this.pts; this.pts = [];
    if (P.length < 3) return this.say("a cell needs three corners or more");
    const ok = this.run(x => meshAddCell(x, P, this.tol()), out => `${out.id} drawn`);
    if (ok && this.level) { const m = this.mesh(), cid = Object.keys(m.cells).sort().pop(); this.say(`${cid} drawn - Cells Used to put it on a level`, "ok"); }
  }
  placeCore(args) {
    if (!this.level) return this.say("open a level's plan to place a core from", "error");
    const L = this.levels(), i = L.findIndex(l => l.id === this.level), top = this.opts.coreTop && L.some(l => l.id === this.opts.coreTop) && L.findIndex(l => l.id === this.opts.coreTop) > i ? this.opts.coreTop : (L[i + 1] || L[i]).id;
    const r = this.app.apply({ op: "add", element: { type: "Core", name: `${args.label}`, args: Object.assign({ baseLevel: { ref: this.level }, topLevel: { ref: top }, topOffset: args.use === "Lift" ? 4500 : 0, cutsSlabs: true }, args) } });
    if (r.ok) this.say(`${args.label} ${r.id}: ${this.level} to ${top}${r.said ? " - " + r.said : ""}. Select it to change its size, levels or cars.`, "ok"); else this.say(r.error, "error");
    this.refresh();
  }
  enter() { if (this.tool === "drawcell" && this.pts.length >= 3) this.closeCell(); }
  escape() { if (this.pts.length || this.first) { this.pts = []; this.first = null; this.view.draw(); return; } this.finish(); }
  key(e) { if (e.key === "Enter" && this.tool === "drawcell") { this.enter(); return true; } if (e.key === "Backspace" && this.pts.length) { this.pts.pop(); this.view.draw(); return true; } return false; }
  finish() { this.app.endSketch(); this.say(`Edit Mesh ended. Every change is in the undo history.`, "ok"); return true; }
  cancel() { this.app.endSketch(); }

  // ------------------------------------------------------------ drawing
  /** Over the plan: the cells this level uses shaded, the nodes as small squares, what the cursor is on in blue. */
  draw(g) {
    const V = this.view, S = p => V.toScreen(p), m = this.mesh();
    let polys; try { polys = cellPolys(m.nodes, m.cells); } catch (e) { return; }
    const ring = (pts) => { g.beginPath(); pts.forEach((p, i) => { const q = S(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); };
    const use = (this.level && m.use[this.level]) || {};
    for (const [cid, u] of Object.entries(use)) { const P = polys[cid]; if (!P) continue; ring(cellShape(P, u)); g.fillStyle = Array.isArray(u) ? "rgba(240,140,40,0.22)" : "rgba(255,200,0,0.20)"; g.fill(); }
    // the mesh's edges, drawn over the plan so the edit reads (and the ones a drag moves, where they will be)
    const N = Object.assign({}, m.nodes); if (this.drag) N[this.drag.nid] = this.drag.to;
    g.lineWidth = 1; g.strokeStyle = "rgba(198,40,40,0.75)";
    g.beginPath(); for (const [a, b] of meshGridEdges(m.cells)) { const A = S(N[a]), B = S(N[b]); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); } g.stroke();
    if (this.drag) { g.strokeStyle = MESH_BLUE; g.lineWidth = 2; g.setLineDash([6, 4]); for (const [cid, loop] of Object.entries(m.cells)) if (loop.includes(this.drag.nid)) ring(loop.map(n => N[n])), g.stroke(); g.setLineDash([]); }
    // nodes: small squares, the hovered one large
    const big = V.cam.z > 0.02;
    if (big) { g.fillStyle = "#ffffff"; g.strokeStyle = MESH_RED; g.lineWidth = 1; for (const q of Object.values(N)) { const s = S(q); g.fillRect(s[0] - 2.5, s[1] - 2.5, 5, 5); g.strokeRect(s[0] - 2.5, s[1] - 2.5, 5, 5); } }
    const mark = (id, colour) => { const q = N[id]; if (!q) return; const s = S(q); g.fillStyle = colour; g.fillRect(s[0] - 5, s[1] - 5, 10, 10); };
    if (this.hoverNode) mark(this.hoverNode, MESH_BLUE);
    if (this.first && N[this.first]) mark(this.first, "#0a8a3a");
    if (this.hoverEdge) { const A = S(N[this.hoverEdge[0]]), B = S(N[this.hoverEdge[1]]); g.strokeStyle = MESH_BLUE; g.lineWidth = 3; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); }
    if (this.hoverCell && polys[this.hoverCell]) { ring(polys[this.hoverCell]); g.strokeStyle = MESH_BLUE; g.lineWidth = 2.5; g.stroke(); const c = S(polys[this.hoverCell].reduce((a, q) => [a[0] + q[0] / polys[this.hoverCell].length, a[1] + q[1] / polys[this.hoverCell].length], [0, 0])); g.fillStyle = MESH_BLUE; g.font = "12px sans-serif"; g.textAlign = "center"; g.fillText(this.hoverCell + (use[this.hoverCell] != null ? (Array.isArray(use[this.hoverCell]) ? ` · part ${use[this.hoverCell][0]}` : " · used") : ""), c[0], c[1]); }
    if (this.tool === "merge" && this.first && polys[this.first]) { ring(polys[this.first]); g.strokeStyle = "#0a8a3a"; g.lineWidth = 2.5; g.stroke(); }
    if (this.pts.length) { g.strokeStyle = MESH_BLUE; g.lineWidth = 2; g.setLineDash([6, 4]); g.beginPath(); [...this.pts, this.cursor || this.pts[this.pts.length - 1]].forEach((p, i) => { const q = S(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); g.setLineDash([]); }
    if (this.tool === "core" && this.cursor) { const row = MESH_CORES.find(r => r[0] === this.opts.coreUse) || MESH_CORES[0], w = (this.opts.coreW || row[1]) / 2, d = (this.opts.coreD || row[2]) / 2, c = this.cursor; ring([[c[0] - w, c[1] - d], [c[0] + w, c[1] - d], [c[0] + w, c[1] + d], [c[0] - w, c[1] + d]]); g.strokeStyle = CORE_COLOUR[row[0]] || MESH_BLUE; g.lineWidth = 2; g.stroke(); }
  }
  overlay() {}

  // ------------------------------------------------------------ ribbon and options bar
  ribbonPanels() {
    const b = ([id, label, ic, hint], size) => ({ label, icon: ic, hint, size, on: this.tool === id, run: () => this.setTool(id) });
    const core = (use, ic) => ({ label: use, icon: ic, hint: `${use}: click to place, from this level up`, size: "small", on: this.tool === "core" && this.opts.coreUse === use, run: () => { this.opts.coreUse = use; this.setTool("core"); } });
    return [
      { title: "Level", items: [b(MESH_TOOLS.find(r => r[0] === "use"), "big"),
        { label: "Copy Below", icon: "copy", hint: "This level uses the cells the level below uses", size: "small", run: () => this.copyFrom(-1) },
        { label: "Copy Above", icon: "copy", hint: "This level uses the cells the level above uses", size: "small", run: () => this.copyFrom(1) },
        { label: "Clear Level", icon: "close", hint: "This level uses no cells: its slabs and walls go", size: "small", run: () => this.clearLevel() }] },
      { title: "Nodes", items: ["move", "addnode", "delnode"].map((k, i) => b(MESH_TOOLS.find(r => r[0] === k), i ? "small" : "big")) },
      { title: "Cells", items: ["split", "merge", "drawcell", "delcell"].map((k, i) => b(MESH_TOOLS.find(r => r[0] === k), i ? "small" : "big")) },
      { title: "Vertical", items: [core("Lift", "door"), core("Stair", "stair"), core("Escalator", "ramp"), core("Riser", "column"), core("Shaft", "opening"), core("Structural core", "wall"),
        { label: "Atrium", icon: "skpoly", hint: "Click a cell: a void the shape of the cell, inset as set, from this level up", size: "small", on: this.tool === "atrium", run: () => this.setTool("atrium") }] },
      { title: "Mode", items: [{ label: "Finish", icon: "skfinish", hint: "Finish Edit Mesh (every change is already in the undo history)", size: "big", run: () => this.finish(), finish: true }] },
    ];
  }
  copyFrom(k) {
    const src = this.neighbour(k); if (!src || !this.level) return this.say(`there is no level ${k < 0 ? "below" : "above"} ${this.level}`, "error");
    this.run(x => meshCopyUse(x, src, this.level), `${this.level} now uses the cells of ${src}`);
  }
  clearLevel() { if (!this.level) return; this.run(x => { const o = JSON.parse(JSON.stringify(x)); o.use[this.level] = {}; return o; }, `${this.level} uses no cells`); }
  optionsBar(bar) {
    const o = this.opts, L = this.levels(), m = this.mesh(), use = (this.level && m.use[this.level]) || {};
    const lenBox = (key, label, def) => h("label", {}, label + " ", h("input", { type: "text", value: String(o[key] || def), style: { width: "70px" }, "aria-label": label, onkeydown: e => e.stopPropagation(),
      onchange: e => { try { o[key] = parseLength(e.target.value); } catch (err) { this.say(err.message, "error"); } e.target.value = String(o[key] || def); this.view.draw(); } }));
    const kids = [h("span", { class: "otitle" }, `Modify | ${this.title}`),
      h("label", {}, "Level ", h("select", { "aria-label": "Mesh level", onchange: e => this.setLevel(e.target.value) }, L.map(l => h("option", { value: l.id, selected: l.id === this.level }, `${l.name} (${(l.z / 1000).toFixed(3)})`))))];
    if (this.tool === "use") kids.push(h("label", {}, h("input", { type: "checkbox", checked: !!o.part, "aria-label": "Use in part", onchange: e => { o.part = e.target.checked; } }), " In part, scale "),
      h("input", { type: "number", min: 0.05, max: 1, step: 0.05, value: o.scale, style: { width: "56px" }, "aria-label": "Part scale", onkeydown: e => e.stopPropagation(), onchange: e => { o.scale = Math.max(0.05, Math.min(1, Number(e.target.value) || 0.7)); } }));
    if (this.tool === "core") {
      const row = MESH_CORES.find(r => r[0] === o.coreUse) || MESH_CORES[0];
      kids.push(h("label", {}, "Use ", h("select", { onchange: e => { o.coreUse = e.target.value; o.coreW = null; o.coreD = null; this.app.refresh({ keepMain: true }); } }, MESH_CORES.map(r => h("option", { selected: r[0] === o.coreUse }, r[0])))),
        lenBox("coreW", "Width", row[1]), lenBox("coreD", "Depth", row[2]));
    }
    if (this.tool === "atrium") kids.push(lenBox("inset", "Inset", 2000));
    if (this.tool === "core" || this.tool === "atrium") {
      const i = L.findIndex(l => l.id === this.level);
      kids.push(h("label", {}, "Up to ", h("select", { onchange: e => { o.coreTop = e.target.value || null; } }, h("option", { value: "" }, "the level above"), L.slice(i + 1).map(l => h("option", { value: l.id, selected: o.coreTop === l.id }, l.name)))));
    }
    const nUse = Object.keys(use).length, nPart = Object.values(use).filter(Array.isArray).length;
    kids.push(h("span", { class: "grow" }), h("span", { class: "muted" }, `${Object.keys(m.nodes).length} nodes · ${Object.keys(m.cells).length} cells · ${this.level || "-"} uses ${nUse}${nPart ? ` (${nPart} in part)` : ""}`),
      h("button", { class: "btn small", title: "Undo (Ctrl+Z)", onclick: () => this.undo() }, "↶"),
      h("button", { class: "btn small primary", onclick: () => this.finish() }, "✓ Finish"));
    bar.append(...kids);

  }
}
