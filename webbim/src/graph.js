//! The node editor: the same document as a graph (a second projection, not a
//! second model). Ports come from the catalogue declarations; a wire is a
//! reference argument; whether a wire may connect is the same `canConnect`
//! check the panel's dropdown uses. Positions ride in the file (graph.layout).

import { h, s, clear } from "./ui_util.js";
import { graphModel, autoLayout, canConnect } from "./props.js";

const NODE_W = 184, HEAD = 26, PORT_H = 17;
const HIDE_TYPES = new Set(["PlanView", "ElevationView", "View3D", "Schedule", "Sheet", "Text", "Dimension", "DetailLine", "FilledRegion", "SymbolInstance", "Furniture", "Grid"]);

export function renderGraph(app, root, focusId = null) {
  clear(root);
  const doc = app.doc;
  const pane = h("div", { class: "graphpane" });
  const model = graphModel(doc);
  const showAll = app.graphShowAll;
  const nodes = model.nodes.filter(n => showAll || !HIDE_TYPES.has(n.type) || n.id === focusId);
  const visible = new Set(nodes.map(n => n.id));
  const layout = Object.assign(autoLayout(doc, { nodes, wires: model.wires.filter(w => visible.has(w.from) && visible.has(w.to)) }), doc.graph.layout || {});
  const view = app.graphView || (app.graphView = { x: 0, y: 0, z: 1 });
  if (focusId && layout[focusId]) { const r = root.getBoundingClientRect(); view.z = 1; view.x = r.width / 2 - layout[focusId][0] - NODE_W / 2; view.y = r.height / 2 - layout[focusId][1] - 40; }
  const svg = s("svg", { role: "img", "aria-label": "Node graph of the document" });
  const g = s("g", { transform: `translate(${view.x},${view.y}) scale(${view.z})` });
  svg.append(g);
  const portPos = (id, key) => { const n = nodes.find(x => x.id === id), p = layout[id]; const i = n.ports.findIndex(q => q.key === key); return [p[0], p[1] + HEAD + (i + 0.5) * PORT_H]; };
  const outPos = id => { const p = layout[id]; return [p[0] + NODE_W, p[1] + HEAD / 2]; };
  const wiresG = s("g"), nodesG = s("g");
  g.append(wiresG, nodesG);
  const curve = (a, b) => `M${a[0]},${a[1]} C${a[0] + 60},${a[1]} ${b[0] - 60},${b[1]} ${b[0]},${b[1]}`;
  const drawWires = () => {
    clear(wiresG);
    for (const w of model.wires) {
      if (!visible.has(w.from) || !visible.has(w.to)) continue;
      const n = nodes.find(x => x.id === w.to); if (!n.ports.some(p => p.key === w.port)) continue;
      const path = s("path", { class: "gwire" + (w.view ? " view" : "") + (app.graphWire === w ? " sel" : ""), d: curve(outPos(w.from), portPos(w.to, w.port)) });
      const hit = s("path", { d: curve(outPos(w.from), portPos(w.to, w.port)), stroke: "transparent", "stroke-width": 10, fill: "none", style: "cursor:pointer",
        onclick: e => { e.stopPropagation(); app.graphWire = w; drawWires(); app.say(`${w.from} → ${w.to}.${w.port} · Delete disconnects`, "note"); } });
      wiresG.append(path, hit);
    }
  };
  let drag = null;
  for (const n of nodes) {
    const [x, y] = layout[n.id];
    const H = HEAD + Math.max(1, n.ports.length) * PORT_H + 6;
    const ng = s("g", { class: "gnode" + (app.selection.has(n.id) ? " sel" : "") + (n.error ? " err" : ""), transform: `translate(${x},${y})` });
    ng.append(s("rect", { class: "b", width: NODE_W, height: H, rx: 6 }));
    ng.append(s("text", { x: 10, y: 17 }, trim(n.name, 20)));
    ng.append(s("text", { class: "t", x: NODE_W - 10, y: 17, "text-anchor": "end" }, n.type));
    n.ports.forEach((p, i) => {
      const py = HEAD + (i + 0.5) * PORT_H;
      const c = s("circle", { class: "port", cx: 0, cy: py, r: 4.5, "data-node": n.id, "data-port": p.key });
      ng.append(c, s("text", { class: "p", x: 10, y: py + 3.5 }, p.label + (p.view ? " ◌" : "")));
    });
    const out = s("circle", { class: "port out", cx: NODE_W, cy: HEAD / 2, r: 5, style: "cursor:crosshair" });
    ng.append(out);
    out.addEventListener("pointerdown", e => {
      e.stopPropagation(); out.setPointerCapture(e.pointerId);
      const src = doc.element(n.id);
      // light the ports this output may connect to — the declared kinds decide
      nodesG.querySelectorAll("circle.port:not(.out)").forEach(pc => { const tn = doc.element(pc.dataset.node), arg = tn && doc.declOf(tn).args.find(a => a.key === pc.dataset.port); pc.classList.add(arg && canConnect(doc, src, arg) && tn !== src ? "ok" : "no"); });
      const temp = s("path", { class: "gwire sel" }); wiresG.append(temp);
      drag = { kind: "wire", from: n.id, temp };
    });
    ng.addEventListener("pointerdown", e => {
      if (e.button !== 0) return; e.stopPropagation(); ng.setPointerCapture(e.pointerId);
      drag = { kind: "node", id: n.id, start: [e.clientX, e.clientY], at: layout[n.id].slice(), ng, moved: false };
    });
    ng.addEventListener("dblclick", () => { app.select([n.id]); app.revealInView(n.id); });
    nodesG.append(ng);
  }
  drawWires();
  svg.addEventListener("pointerdown", e => { drag = { kind: "pan", start: [e.clientX, e.clientY], v: [view.x, view.y] }; svg.setPointerCapture(e.pointerId); app.graphWire = null; drawWires(); });
  svg.addEventListener("pointermove", e => {
    if (!drag) return;
    if (drag.kind === "pan") { view.x = drag.v[0] + e.clientX - drag.start[0]; view.y = drag.v[1] + e.clientY - drag.start[1]; g.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.z})`); }
    if (drag.kind === "node") {
      const dx = (e.clientX - drag.start[0]) / view.z, dy = (e.clientY - drag.start[1]) / view.z;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      layout[drag.id] = [drag.at[0] + dx, drag.at[1] + dy]; drag.ng.setAttribute("transform", `translate(${layout[drag.id][0]},${layout[drag.id][1]})`); drawWires();
    }
    if (drag.kind === "wire") { const r = svg.getBoundingClientRect(); const p = [(e.clientX - r.left - view.x) / view.z, (e.clientY - r.top - view.y) / view.z]; drag.temp.setAttribute("d", curve(outPos(drag.from), p)); }
  });
  svg.addEventListener("pointerup", e => {
    if (!drag) return;
    if (drag.kind === "node") {
      if (drag.moved) app.apply({ op: "layout", id: drag.id, at: layout[drag.id].map(Math.round), coalesce: "layout:" + drag.id });
      else app.select([drag.id], e.shiftKey);
    }
    if (drag.kind === "wire") {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el.dataset && el.dataset.port) {
        const tn = doc.element(el.dataset.node), arg = doc.declOf(tn).args.find(a => a.key === el.dataset.port), src = doc.element(drag.from);
        if (!canConnect(doc, src, arg)) app.say(`${arg.label} takes ${arg.kinds ? arg.kinds.join(" or ") : "a number"}, not a ${doc.declOf(src).kind}`, "error");
        else app.apply({ op: "connect", id: el.dataset.node, key: el.dataset.port, to: drag.from });
      }
      renderGraph(app, root);
    }
    drag = null;
  });
  svg.addEventListener("wheel", e => { e.preventDefault(); const r = svg.getBoundingClientRect(), k = Math.exp(-e.deltaY * 0.0015), mx = e.clientX - r.left, my = e.clientY - r.top; view.x = mx - (mx - view.x) * k; view.y = my - (my - view.y) * k; view.z *= k; g.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.z})`); }, { passive: false });
  root.addEventListener("keydown", e => { if ((e.key === "Delete" || e.key === "Backspace") && app.graphWire) { const w = app.graphWire; const f = doc.element(w.to), a = doc.declOf(f).args.find(x => x.key === w.port); app.apply(a.kind === "Reference" ? { op: "disconnect", id: w.to, key: w.port } : { op: "unbind", id: w.to, key: w.port }); app.graphWire = null; renderGraph(app, root); } });
  pane.tabIndex = 0;
  pane.append(svg);
  const bar = h("div", { class: "viewbar" }, h("div", { class: "card" },
    h("label", {}, h("input", { type: "checkbox", checked: !!showAll, onchange: e => { app.graphShowAll = e.target.checked; renderGraph(app, root); } }), " views & annotation"),
    h("button", { class: "btn small", onclick: () => { app.apply({ op: "layout", reset: true }); renderGraph(app, root); } }, "Tidy"),
    h("span", { class: "muted" }, "drag ● → port to wire · a typed binding shows here as a wire")));
  pane.append(bar);
  root.append(pane);
}
const trim = (t, n) => t.length > n ? t.slice(0, n - 1) + "…" : t;
