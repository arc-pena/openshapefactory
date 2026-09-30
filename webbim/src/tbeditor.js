//! The title block editor (Revit's Edit Family on a title block): a window of its own over the app, the
//! family's design sheet on a drawing board. Draw lines, rectangles, circles and fills; write fixed text;
//! place labels - smart fields that write the sheet's or the project's values (pick a built-in field, or
//! name a new one: every sheet then gets a box for it); insert symbols (a north arrow, a logo). Any item can
//! be tied to a Yes/No visibility parameter, and every sheet shows a check box for each. Finish saves the
//! family into the project (one undo step) and every sheet that uses it redraws; Cancel leaves it as it was.

import { h, clear } from "./ui_util.js";
import { TB_FIELDS, drawTitleFamily, isTitleFamily } from "./titleblocks.js";
import { textWidth } from "./scene.js";

const TBE_NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(TBE_NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); return e; };
const tbClone = o => JSON.parse(JSON.stringify(o));
const TBE_TOOLS = [["select", "Select / move"], ["line", "Line"], ["rect", "Rectangle"], ["circle", "Circle"], ["fill", "Filled region"], ["text", "Text"], ["label", "Label (smart field)"], ["symbol", "Symbol"]];

export function titleBlockEditor(app, symbolId) {
  const doc = app.doc, src = doc.lib.symbols[symbolId];
  if (!isTitleFamily(src)) { app.say("this title block is drawn by code: pick a title block family (Duplicate one to start)", "note"); return; }
  const fam = tbClone(src);
  fam.fields = fam.fields || []; fam.visibility = fam.visibility || [];
  const [DW, DH] = fam.design || [841, 594];
  let tool = "select", sel = -1, pending = [], showValues = false, snap = 0.5, drag = null;
  const sheet = [...doc.elements()].find(f => doc.typeOf(f) === "Sheet" && (doc.argValue(f, "titleBlock") || {}).ref === symbolId);

  // ---- the window
  const back = h("div", { class: "tbe-back", role: "dialog", "aria-label": `Edit title block ${fam.name}`, style: { position: "fixed", inset: "0", background: "rgba(20,24,30,.55)", zIndex: 60, display: "flex" } });
  const win = h("div", { class: "tbe", style: { margin: "2vh auto", width: "96vw", height: "96vh", background: "var(--bg, #fff)", color: "var(--fg, #111)", borderRadius: "10px", display: "grid", gridTemplateRows: "auto 1fr", gridTemplateColumns: "1fr 320px", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.4)" } });
  const title = h("input", { type: "text", value: fam.name || symbolId, "aria-label": "Family name", style: { fontWeight: 600, fontSize: "14px", minWidth: "320px" }, onchange: e => { fam.name = e.target.value; } });
  const toolbar = h("div", { style: { gridColumn: "1 / 3", display: "flex", gap: "6px", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--line, #ddd)", flexWrap: "wrap" } });
  const board = h("div", { style: { position: "relative", overflow: "hidden", background: "#e9ecef" } });
  const side = h("div", { style: { borderLeft: "1px solid var(--line, #ddd)", overflow: "auto", padding: "10px 12px", display: "grid", gap: "12px", alignContent: "start", fontSize: "12.5px" } });
  win.append(toolbar, board, side); back.append(win); document.body.append(back);
  const status = h("span", { class: "muted", style: { marginLeft: "auto" } });
  const toolBtns = TBE_TOOLS.map(([k, label]) => h("button", { class: "btn small" + (k === tool ? " primary" : ""), "aria-pressed": String(k === tool), onclick: () => setTool(k) }, label));
  toolbar.append(h("b", {}, "Title block editor"), title, ...toolBtns,
    h("label", {}, h("input", { type: "checkbox", onchange: e => { showValues = e.target.checked; draw(); } }), sheet ? ` show values of ${doc.argValue(sheet, "number")}` : " show sample values"),
    status,
    h("button", { class: "btn", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn primary", onclick: () => finish() }, "Finish"));
  function setTool(k) { tool = k; pending = []; toolBtns.forEach((b, i) => { b.classList.toggle("primary", TBE_TOOLS[i][0] === k); b.setAttribute("aria-pressed", String(TBE_TOOLS[i][0] === k)); }); status.textContent = hint(); draw(); }
  const hint = () => ({ select: "click an item to edit it, drag to move it; Delete removes it", line: "click points; double-click or Enter ends the line", rect: "click two corners", circle: "click the centre, then a point on the circle", fill: "click the corners; double-click or Enter closes it",
    text: "click where the text starts", label: "click where the field's value starts", symbol: "click where the symbol goes" })[tool];

  // ---- the board: paper at the family's design size, zoom (wheel) and pan (middle drag or space)
  const svg = svgEl("svg", { width: "100%", height: "100%", style: "display:block;cursor:crosshair;user-select:none" });
  board.append(svg);
  let vb = [-10, -10, DW + 20, DH + 20];
  const setVB = () => svg.setAttribute("viewBox", vb.join(" "));
  // paper y runs up, the screen's down: the drawing is flipped once, in one group
  const root = svgEl("g"); svg.append(root);
  const toPaper = e => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, DH - q.y]; };
  const snapP = q => snap ? [Math.round(q[0] / snap) * snap, Math.round(q[1] / snap) * snap] : q;
  svg.addEventListener("wheel", e => { e.preventDefault(); const q = toPaper(e), k = e.deltaY > 0 ? 1.15 : 1 / 1.15, x = q[0], y = DH - q[1]; vb = [x - (x - vb[0]) * k, y - (y - vb[1]) * k, vb[2] * k, vb[3] * k]; setVB(); }, { passive: false });
  setVB();

  // what an item is on the design sheet, as SVG: drawn through the same renderer the sheets use
  function draw() {
    clear(root);
    root.append(svgEl("rect", { x: 0, y: 0, width: DW, height: DH, fill: "#fff", stroke: "#888", "stroke-width": 0.3 }));
    fam.items.forEach((it, i) => {
      const g = svgEl("g", { "data-i": i, style: "cursor:" + (tool === "select" ? "move" : "crosshair") });
      const one = Object.assign({}, fam, { items: [Object.assign({}, it, { vis: undefined })] });
      const io = {
        segs: (pts, closed) => ({ pts, closed }), circ: (c, r) => ({ c, r }), tw: textWidth, scales: [{ n: 100, name: "1:100" }],
        put: (p, w, colour) => { if (p.c) g.append(svgEl("circle", { cx: p.c[0], cy: DH - p.c[1], r: p.r, fill: "none", stroke: colour, "stroke-width": Math.max(w, 0.15) }));
          else g.append(svgEl(p.closed ? "polygon" : "polyline", { points: p.pts.map(q => `${q[0]},${DH - q[1]}`).join(" "), fill: "none", stroke: colour, "stroke-width": Math.max(w, 0.15) })); },
        fill: (p, colour) => g.append(svgEl("polygon", { points: p.pts.map(q => `${q[0]},${DH - q[1]}`).join(" "), fill: colour })),
        txt: (at, text, hh, o) => { const t = svgEl("text", { x: at[0], y: DH - at[1], "font-size": hh / 0.7, "font-family": /Futura/.test(o.font || "") ? "Futura, 'Century Gothic', 'Avenir Next', sans-serif" : "Arial, Helvetica, sans-serif", "font-weight": /Bold/.test(o.font || "") ? 700 : 400, fill: o.colour || (it.k === "label" && !showValues ? "#1c5fd4" : "#111"),
            "text-anchor": o.align === "right" ? "end" : o.align === "centre" ? "middle" : "start", transform: o.rot ? `rotate(${-o.rot} ${at[0]} ${DH - at[1]})` : null }); t.textContent = text; g.append(t); },
        sym: (id, at) => { g.append(svgEl("circle", { cx: at[0], cy: DH - at[1], r: 4, fill: "none", stroke: "#1c5fd4", "stroke-width": 0.3 })); const t = svgEl("text", { x: at[0], y: DH - at[1] + 1, "font-size": 2.4, "text-anchor": "middle", fill: "#1c5fd4" }); t.textContent = (doc.lib.symbols[id] || {}).name || id; g.append(t); },
      };
      // a label shows its field's name (or, asked, the sheet's value)
      const shown = it.k === "label" && (!showValues || !sheet) ? Object.assign({}, one, { items: [Object.assign({}, one.items[0], { k: "text", text: `‹${it.field}›`, room: 0, upper: false })] }) : one;
      if (it.k === "label" && showValues && !sheet) return;
      drawTitleFamily(doc, sheet, DW, DH, shown, io);
      if (it.vis) g.setAttribute("opacity", "0.85");
      if (i === sel) { const bb = () => { try { const b = g.getBBox(); root.append(svgEl("rect", { x: b.x - 0.8, y: b.y - 0.8, width: b.width + 1.6, height: b.height + 1.6, fill: "none", stroke: "#e8590c", "stroke-width": 0.35, "stroke-dasharray": "1.2 0.8", "pointer-events": "none" })); } catch (e) { /* not laid out yet */ } }; requestAnimationFrame(bb); }
      root.append(g);
    });
    if (pending.length) root.append(svgEl("polyline", { points: pending.map(q => `${q[0]},${DH - q[1]}`).join(" "), fill: "none", stroke: "#e8590c", "stroke-width": 0.3, "stroke-dasharray": "1 0.6" }));
    sidePanel();
  }
  // items are stored in design coordinates; with a sheet's values shown they still are (the design sheet is the sheet)
  const newItem = (it) => { fam.items.push(Object.assign({ hold: it.hold || (it.at ? (it.at[0] > DW / 2 ? "right" : "left") : "stretch") }, it)); sel = fam.items.length - 1; setTool("select"); };
  svg.addEventListener("pointerdown", e => {
    if (e.button === 1) { const s0 = [e.clientX, e.clientY], v0 = vb.slice(), k = vb[2] / svg.clientWidth; const mv = ev => { vb = [v0[0] - (ev.clientX - s0[0]) * k, v0[1] - (ev.clientY - s0[1]) * k, v0[2], v0[3]]; setVB(); }; svg.setPointerCapture(e.pointerId); svg.addEventListener("pointermove", mv); svg.addEventListener("pointerup", () => svg.removeEventListener("pointermove", mv), { once: true }); return; }
    const q = snapP(toPaper(e));
    if (tool === "select") {
      const g = e.target.closest("g[data-i]"); sel = g ? +g.getAttribute("data-i") : -1; draw();
      if (sel >= 0) { const it = fam.items[sel], start = q, orig = tbClone(it); drag = true; svg.setPointerCapture(e.pointerId);
        const mv = ev => { const p = snapP(toPaper(ev)), dx = p[0] - start[0], dy = p[1] - start[1]; moveItem(it, orig, dx, dy); draw(); };
        svg.addEventListener("pointermove", mv); svg.addEventListener("pointerup", () => { svg.removeEventListener("pointermove", mv); drag = null; }, { once: true }); }
      return;
    }
    if (tool === "line" || tool === "fill") { if (e.detail >= 2 && pending.length >= 2) { newItem(tool === "line" ? { k: "line", pts: pending, w: 0.19 } : { k: "fill", pts: pending, colour: "#1b1f24" }); return; } pending.push(q); draw(); return; }
    if (tool === "rect") { pending.push(q); if (pending.length === 2) newItem({ k: "rect", a: pending[0], b: pending[1], w: 0.19 }); else draw(); return; }
    if (tool === "circle") { pending.push(q); if (pending.length === 2) newItem({ k: "circle", c: pending[0], r: Math.hypot(pending[1][0] - pending[0][0], pending[1][1] - pending[0][1]), w: 0.19 }); else draw(); return; }
    if (tool === "text") { const t = prompt("Text", "TEXT"); if (t) newItem({ k: "text", text: t, at: q, h: 2.5, font: "Arial" }); return; }
    if (tool === "label") { pickField(name => newItem({ k: "label", field: name, at: q, h: 2.5, font: "Arial" })); return; }
    if (tool === "symbol") { const syms = Object.entries(doc.lib.symbols).filter(([, s]) => !isTitleFamily(s) && s.space === "paper"); const id = syms.length ? syms[0][0] : null; if (id) newItem({ k: "symbol", symbol: id, at: q, rot: 0, scale: 1 }); return; }
  });
  function moveItem(it, o, dx, dy) {
    const mv = p => [p[0] + dx, p[1] + dy];
    if (o.pts) it.pts = o.pts.map(mv); if (o.a) it.a = mv(o.a); if (o.b) it.b = mv(o.b); if (o.c) it.c = mv(o.c); if (o.at) it.at = mv(o.at);
  }
  const onKey = e => {
    if (e.target.closest && e.target.closest("input, select, textarea")) return;
    if (e.key === "Escape") { if (pending.length) { pending = []; draw(); } else setTool("select"); e.stopPropagation(); }
    if (e.key === "Enter" && pending.length >= 2 && (tool === "line" || tool === "fill")) newItem(tool === "line" ? { k: "line", pts: pending, w: 0.19 } : { k: "fill", pts: pending, colour: "#1b1f24" });
    if ((e.key === "Delete" || e.key === "Backspace") && sel >= 0) { fam.items.splice(sel, 1); sel = -1; draw(); e.preventDefault(); }
  };
  window.addEventListener("keydown", onKey, true);

  // ---- a field: one of the built-in ones, one of this family's, or a new one named here
  function pickField(done) {
    const names = [...TB_FIELDS.map(([n]) => n), ...fam.fields.map(f => f.name)];
    const s = h("select", { "aria-label": "Field" }, names.map(n => h("option", {}, n)), h("option", { value: "__new" }, "New field…"));
    const box = h("div", { style: { position: "absolute", left: "12px", top: "12px", background: "#fff", padding: "10px", borderRadius: "8px", boxShadow: "0 6px 20px rgba(0,0,0,.25)", display: "flex", gap: "6px", alignItems: "center" } },
      "Field", s, h("button", { class: "btn small primary", onclick: () => { let n = s.value; if (n === "__new") { n = (prompt("Name the field (every sheet gets a box for it)", "Consultant") || "").trim(); if (!n) return; if (!names.includes(n)) fam.fields.push({ name: n, default: "" }); } box.remove(); done(n); } }, "Place"),
      h("button", { class: "btn small", onclick: () => box.remove() }, "Cancel"));
    board.append(box); s.focus();
  }

  // ---- the side: the selected item's properties, the family's fields and its visibility parameters
  function sidePanel() {
    clear(side);
    const it = fam.items[sel];
    const row = (label, input) => h("label", { style: { display: "grid", gridTemplateColumns: "96px 1fr", gap: "6px", alignItems: "center" } }, h("span", { class: "muted" }, label), input);
    const num = (obj, key, step = 0.1) => h("input", { type: "number", step, value: obj[key] ?? "", onchange: e => { obj[key] = e.target.value === "" ? undefined : Number(e.target.value); draw(); } });
    const pt = (obj, key) => h("span", { style: { display: "flex", gap: "4px" } }, h("input", { type: "number", step: 0.1, value: +obj[key][0].toFixed(2), style: { width: "80px" }, onchange: e => { obj[key][0] = Number(e.target.value); draw(); } }), h("input", { type: "number", step: 0.1, value: +obj[key][1].toFixed(2), style: { width: "80px" }, onchange: e => { obj[key][1] = Number(e.target.value); draw(); } }));
    const choice = (obj, key, opts, dflt) => h("select", { onchange: e => { obj[key] = e.target.value || undefined; draw(); } }, opts.map(o => h("option", { value: o, selected: (obj[key] || dflt) === o }, o || "—")));
    if (it) {
      const box = h("div", { style: { display: "grid", gap: "6px" } }, h("h3", { style: { margin: 0 } }, { line: "Line", rect: "Rectangle", circle: "Circle", fill: "Filled region", text: "Text", label: "Label", symbol: "Symbol" }[it.k]));
      if (it.at) box.append(row("At (mm)", pt(it, "at")));
      if (it.a) box.append(row("Corner", pt(it, "a")), row("Corner", pt(it, "b")));
      if (it.c) box.append(row("Centre", pt(it, "c")), row("Radius", num(it, "r")));
      if (it.k === "text") box.append(row("Text", h("input", { type: "text", value: it.text, onchange: e => { it.text = e.target.value; draw(); } })));
      if (it.k === "label") {
        const names = [...TB_FIELDS.map(([n]) => n), ...fam.fields.map(f => f.name)];
        box.append(row("Field", choice(it, "field", names, it.field)), row("Prefix", h("input", { type: "text", value: it.prefix || "", onchange: e => { it.prefix = e.target.value || undefined; draw(); } })),
          row("Capitals", h("input", { type: "checkbox", checked: !!it.upper, onchange: e => { it.upper = e.target.checked || undefined; draw(); } })), row("Fit in (mm)", num(it, "room", 1)), row("Line no.", num(it, "line", 1)));
      }
      if (it.k === "text" || it.k === "label") box.append(row("Height (mm)", num(it, "h")), row("Rotation °", num(it, "rot", 90)), row("Align", choice(it, "align", ["left", "centre", "right"], "left")),
        row("Font", choice(it, "font", ["Arial", "ArialBold", "Futura"], "Arial")));
      if (it.k === "symbol") box.append(row("Symbol", h("select", { onchange: e => { it.symbol = e.target.value; draw(); } }, Object.entries(doc.lib.symbols).filter(([, s]) => !isTitleFamily(s)).map(([k, s]) => h("option", { value: k, selected: k === it.symbol }, s.name || k)))),
        row("Rotation °", num(it, "rot", 90)), row("Scale", num(it, "scale", 0.1)));
      if (it.w != null || ["line", "rect", "circle"].includes(it.k)) box.append(row("Pen (mm)", num(it, "w", 0.01)));
      box.append(row("Held to", choice(it, "hold", ["left", "right", "stretch"], "left")), row("…and to", choice(it, "holdY", ["bottom", "top", "stretch"], "bottom")),
        row("Visible when", h("select", { onchange: e => { it.vis = e.target.value || undefined; draw(); } }, h("option", { value: "" }, "always"), fam.visibility.map(v => h("option", { selected: v.name === it.vis }, v.name)))),
        h("button", { class: "btn small", onclick: () => { fam.items.splice(sel, 1); sel = -1; draw(); } }, "Delete item"));
      side.append(box);
    } else side.append(h("div", { class: "muted" }, "Nothing selected. Pick a tool above, or click an item to edit it."));
    // fields: the family's own (every sheet gets a box for each), with a default
    const fl = h("div", { style: { display: "grid", gap: "4px" } }, h("h3", { style: { margin: "6px 0 0" } }, "Fields of this title block"),
      h("div", { class: "muted" }, "Built in: " + TB_FIELDS.map(([n]) => n).join(", ") + ". Name your own below: each sheet then has a value for it."));
    fam.fields.forEach((f, i) => fl.append(h("div", { style: { display: "flex", gap: "4px" } }, h("input", { type: "text", value: f.name, style: { width: "40%" }, "aria-label": "Field name", onchange: e => { const old = f.name; f.name = e.target.value; fam.items.forEach(x => { if (x.field === old) x.field = f.name; }); draw(); } }),
      h("input", { type: "text", value: f.default || "", placeholder: "default", style: { flex: 1 }, "aria-label": "Default", onchange: e => { f.default = e.target.value; draw(); } }), h("button", { class: "iconbtn", "aria-label": "Remove field", onclick: () => { fam.fields.splice(i, 1); draw(); } }, "✕"))));
    fl.append(h("button", { class: "btn small", onclick: () => { const n = (prompt("Field name", "Consultant") || "").trim(); if (n) { fam.fields.push({ name: n, default: "" }); draw(); } } }, "+ Field"));
    // visibility parameters: Yes/No, a check box on every sheet
    const vl = h("div", { style: { display: "grid", gap: "4px" } }, h("h3", { style: { margin: "6px 0 0" } }, "Show / hide parameters"), h("div", { class: "muted" }, "Tie items to one (Visible when); each sheet gets a check box to show or hide them."));
    fam.visibility.forEach((v, i) => vl.append(h("div", { style: { display: "flex", gap: "4px", alignItems: "center" } }, h("input", { type: "checkbox", checked: v.default !== false, "aria-label": "Shown by default", onchange: e => { v.default = e.target.checked; } }),
      h("input", { type: "text", value: v.name, style: { flex: 1 }, "aria-label": "Parameter name", onchange: e => { const old = v.name; v.name = e.target.value; fam.items.forEach(x => { if (x.vis === old) x.vis = v.name; }); draw(); } }),
      h("button", { class: "iconbtn", "aria-label": "Remove parameter", onclick: () => { fam.items.forEach(x => { if (x.vis === v.name) delete x.vis; }); fam.visibility.splice(i, 1); draw(); } }, "✕"))));
    vl.append(h("button", { class: "btn small", onclick: () => { const n = (prompt("Parameter name", "North arrow") || "").trim(); if (n) { fam.visibility.push({ name: n, default: true }); if (sel >= 0) fam.items[sel].vis = n; draw(); } } }, "+ Show/hide parameter"));
    const sz = h("div", { class: "muted" }, `Design sheet ${DW} × ${DH} mm. Items held right stay with the right edge, held top with the top, on any sheet size.`);
    side.append(fl, vl, sz);
  }
  function close() { window.removeEventListener("keydown", onKey, true); back.remove(); }
  function finish() { fam.name = title.value || fam.name; const r = app.apply({ op: "type", lib: "symbols", id: symbolId, value: fam }); if (r && r.ok === false) { status.textContent = r.error; return; } app.say(`Saved title block ${fam.name}`, "ok"); close(); }
  setTool("select");
  return { close };
}
