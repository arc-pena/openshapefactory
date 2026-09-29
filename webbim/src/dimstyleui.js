//! The Dimension Style Manager: AutoCAD's DIMSTYLE dialog over the document's dimension types. A list of
//! types (New, Duplicate, Rename, Delete, Set current), the settings on AutoCAD's seven tabs, and a live
//! preview drawn by the same code that draws every dimension. Each change is one "type" op, so it undoes
//! and every dimension of the type restyles at once.

import { h, clear, dialog } from "./ui_util.js";
import { clone } from "./ocaf.js";
import { DIM_ARROWS, DIM_UNITS, DIM_TEXT_V, DIM_TEXT_H, DIM_TEXT_ALIGN, DIM_FIT, DIM_TOLERANCES, DIM_GROUPING, DEFAULT_DIM_TYPE, dimStyleOf } from "./dimstyles.js";
import { TEXT_FONTS, dimStylePreview } from "./scene.js";
import { drawScene } from "./render.js";

const PEN_WEIGHTS = [0.05, 0.09, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0];
/** The tabs, as AutoCAD lays them out: [label, [[key, label, kind, options]]]. Sizes are paper mm. */
export const DIM_TABS = [
  ["Lines", [
    ["—", "Dimension lines"], ["lineColour", "Colour", "colour"], ["lineWeight", "Lineweight", "weight"], ["dimExtend", "Extend beyond ticks", "mm"],
    ["suppressDim1", "Suppress dim line 1", "bool"], ["suppressDim2", "Suppress dim line 2", "bool"],
    ["—", "Extension lines"], ["extColour", "Colour", "colour"], ["extWeight", "Lineweight", "weight"], ["extBeyond", "Extend beyond dim lines", "mm"], ["extOffset", "Offset from origin", "mm"],
    ["extFixed", "Fixed length (0 = to the object)", "mm"], ["suppressExt1", "Suppress ext line 1", "bool"], ["suppressExt2", "Suppress ext line 2", "bool"]]],
  ["Symbols and Arrows", [
    ["—", "Arrowheads and ticks"], ["arrow1", "First", "choice", DIM_ARROWS], ["arrow2", "Second", "choice", DIM_ARROWS], ["arrowSize", "Arrow / tick size", "mm"], ["tickWeight", "Tick lineweight", "weight"]]],
  ["Text", [
    ["—", "Text appearance"], ["font", "Font", "choice", Object.keys(TEXT_FONTS)], ["textHeight", "Text height (on paper)", "mm"], ["textColour", "Text colour", "colour"],
    ["widthFactor", "Width factor", "num"], ["textFill", "Fill colour (blank: none)", "fill"], ["textFrame", "Draw frame around text", "bool"],
    ["—", "Text placement"], ["textVertical", "Vertical", "choice", DIM_TEXT_V], ["textHorizontal", "Horizontal", "choice", DIM_TEXT_H], ["textGap", "Offset from dim line", "mm"], ["textSide", "Above means", "choice", ["Object", "Readable"]],
    ["—", "Text alignment"], ["textAlign", "Alignment", "choice", DIM_TEXT_ALIGN]]],
  ["Fit", [
    ["—", "When there is not room for text and arrows inside the extension lines"], ["fit", "Move", "choice", DIM_FIT],
    ["—", "Scale for dimension features"], ["overallScale", "Overall scale", "num"]]],
  ["Primary Units", [
    ["—", "Linear dimensions"], ["unit", "Unit format", "choice", DIM_UNITS], ["precision", "Precision (decimals)", "int"], ["decimal", "Decimal separator", "choice", [".", ","]], ["thousands", "Digit grouping", "pairs", DIM_GROUPING],
    ["roundOff", "Round off (mm, 0 = none)", "num"], ["prefix", "Prefix", "text"], ["suffix", "Suffix", "text"], ["showUnit", "Write the unit", "bool"],
    ["—", "Measurement scale"], ["scaleFactor", "Scale factor", "num"],
    ["—", "Zero suppression"], ["suppressLeading", "Leading", "bool"], ["suppressTrailing", "Trailing", "bool"]]],
  ["Alternate Units", [
    ["altUnits", "Display alternate units", "bool"], ["altUnit", "Unit format", "choice", DIM_UNITS.filter(u => u !== "Project")], ["altPrecision", "Precision", "int"],
    ["altPlacement", "Placement", "choice", ["After", "Below"]]]],
  ["Tolerances", [
    ["tolerance", "Method", "choice", DIM_TOLERANCES], ["tolPrecision", "Precision", "int"], ["tolUpper", "Upper value (mm)", "num"], ["tolLower", "Lower value (mm)", "num"],
    ["tolHeight", "Scaling for height", "num"]]],
];

/** Open the manager, on `typeId` (or the current type). `onPick(id)` gets the type set current. */
export function dimStyleManager(app, typeId, onPick) {
  const doc = app.doc, lib = () => doc.lib.dimTypes || {};
  let cur = typeId && lib()[typeId] ? typeId : app.dimType && lib()[app.dimType] ? app.dimType : Object.keys(lib())[0] || DEFAULT_DIM_TYPE;
  let tab = app.dimStyleTab || 0;
  const list = h("div", { class: "vslist", role: "listbox", "aria-label": "Dimension types" }), right = h("div", { class: "vsright", style: { minWidth: "0" } });
  const preview = h("canvas", { width: 340, height: 170, "aria-label": "Preview of the dimension type", style: { width: "340px", maxWidth: "100%", height: "170px", border: "1px solid var(--line, #ccd)", borderRadius: "6px", background: "#fff" } });
  // a dimension with no type, or one whose type is gone, is drawn with the default: it counts there
  const typeOf = f => { const r = (doc.argValue(f, "dimType") || {}).ref; return r && lib()[r] ? r : (doc.meta && doc.meta.defaultDimType) || DEFAULT_DIM_TYPE; };
  const users = id => doc.elements().filter(f => doc.typeOf(f) === "Dimension" && typeOf(f) === id).length;
  const newId = () => { let n = 1; while (lib()["DT-NEW" + n]) n++; return "DT-NEW" + n; };
  const save = (value, id = cur) => { const r = app.apply({ op: "type", lib: "dimTypes", id, value }); if (!r.ok) app.say(r.error, "error"); return r.ok; };
  const drawPreview = () => {
    const sc = dimStylePreview(doc, dimStyleOf(doc, cur)), bb = sc.bbox || [0, 0, 100, 50], dpr = window.devicePixelRatio || 1;
    const W = 340, H = 170; preview.width = W * dpr; preview.height = H * dpr;
    const z = Math.min((W - 16) / (bb[2] - bb[0] || 1), (H - 16) / (bb[3] - bb[1] || 1));
    const g = preview.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, preview.width, preview.height);
    drawScene(g, sc, { x: (bb[0] + bb[2]) / 2 - W / 2 / z, y: (bb[1] + bb[3]) / 2 - H / 2 / z, z, W, H, dpr }, {});
  };
  const drawList = () => {
    clear(list);
    for (const [id, t] of Object.entries(lib())) list.append(h("button", { role: "option", "aria-selected": String(id === cur), class: "vsitem" + (id === cur ? " on" : ""), onclick: () => { cur = id; drawList(); drawRight(); } },
      (id === (app.dimType || DEFAULT_DIM_TYPE) ? "▸ " : "") + (t.name || id), h("span", { class: "muted small" }, `  ${users(id)}`)));
    list.append(h("div", { class: "cellrow", style: { marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "4px" } },
      h("button", { class: "btn small", title: "The type new dimensions take", onclick: () => { app.dimType = cur; if (onPick) onPick(cur); app.say(`${lib()[cur].name || cur} is current: new dimensions take it`, "ok"); drawList(); } }, "Set current"),
      h("button", { class: "btn small", onclick: () => { const id = newId(); if (save({ name: "New dimension type" }, id)) { cur = id; drawList(); drawRight(); } } }, "New"),
      h("button", { class: "btn small", onclick: () => { const id = newId(), t = clone(lib()[cur]); t.name = (t.name || cur) + " copy"; if (save(t, id)) { cur = id; drawList(); drawRight(); } } }, "Duplicate"),
      h("button", { class: "btn small", disabled: users(cur) > 0 || Object.keys(lib()).length < 2, title: users(cur) ? "Dimensions use it: give them another type first" : "Delete this type",
        onclick: () => { const r = app.apply({ op: "type", lib: "dimTypes", id: cur, remove: true }); if (r.ok) { cur = Object.keys(lib())[0]; drawList(); drawRight(); } } }, "Delete")));
  };
  const field = (key, label, kind, options) => {
    const st = dimStyleOf(doc, cur), v = st[key];
    const set = x => { const t = Object.assign({}, lib()[cur]); t[key] = x; if (save(t)) drawPreview(); };
    let input;
    if (kind === "bool") input = h("input", { type: "checkbox", checked: !!v, onchange: e => set(e.target.checked) });
    else if (kind === "choice" || kind === "weight") {
      const opts = kind === "weight" ? PEN_WEIGHTS : options;
      input = h("select", { onchange: e => set(kind === "weight" ? Number(e.target.value) : e.target.value) }, opts.map(o => h("option", { value: String(o), selected: String(o) === String(v) }, kind === "weight" ? `${o.toFixed(2)} mm` : kind === "choice" && key === "font" ? (TEXT_FONTS[o].label || o) : String(o))));
      if (kind === "weight" && !opts.includes(v)) input.prepend(h("option", { value: String(v), selected: true }, `${v} mm`));
    } else if (kind === "pairs") input = h("select", { onchange: e => set(e.target.value) }, options.map(([val, lab]) => h("option", { value: val, selected: val === (v || "") }, lab)));
    else if (kind === "colour") input = h("input", { type: "color", value: v || "#000000", onchange: e => set(e.target.value) });
    else if (kind === "fill") input = h("span", { style: { display: "inline-flex", gap: "6px", alignItems: "center" } },
      h("input", { type: "checkbox", checked: !!v, "aria-label": "Fill behind the text", onchange: e => set(e.target.checked ? "#ffffff" : "") }),
      h("input", { type: "color", value: v || "#ffffff", disabled: !v, onchange: e => set(e.target.value) }));
    else if (kind === "text") input = h("input", { type: "text", value: v || "", onchange: e => set(e.target.value) });
    else input = h("input", { type: "number", value: String(v), step: kind === "int" ? "1" : "any", min: kind === "int" ? "0" : undefined, max: kind === "int" ? "8" : undefined, style: { width: "90px" },
      onchange: e => { const x = Number(e.target.value); if (!Number.isFinite(x) || (kind !== "num" && x < 0)) { app.say("a size is a number, not negative", "error"); return; } set(kind === "int" ? Math.round(x) : x); } });
    input.setAttribute("aria-label", label);
    return h("label", { class: "dsrow", style: { display: "grid", gridTemplateColumns: "200px 1fr", alignItems: "center", gap: "8px", fontSize: "12.5px" } }, h("span", {}, label + (kind === "mm" ? " (mm)" : "")), input);
  };
  const drawRight = () => {
    clear(right);
    const t = lib()[cur] || {};
    const name = h("input", { type: "text", value: t.name || cur, "aria-label": "Type name", style: { flex: "1" }, onchange: e => { const v = Object.assign({}, lib()[cur], { name: e.target.value }); if (save(v)) drawList(); } });
    const tabs = h("div", { class: "tabs", role: "tablist", style: { display: "flex", flexWrap: "wrap", gap: "2px", margin: "8px 0" } },
      DIM_TABS.map(([lab], i) => h("button", { role: "tab", "aria-selected": String(i === tab), class: "btn small" + (i === tab ? " primary" : ""), onclick: () => { tab = app.dimStyleTab = i; drawRight(); } }, lab)));
    const rows = h("div", { style: { display: "grid", gap: "6px", maxHeight: "250px", overflow: "auto", paddingRight: "4px" } },
      DIM_TABS[tab][1].map(([key, label, kind, options]) => key === "—" ? h("div", { class: "muted", style: { fontWeight: "600", marginTop: "6px", fontSize: "12px" } }, label) : field(key, label, kind, options)));
    const reset = h("button", { class: "btn small", title: "Every setting on this tab back to the default", onclick: () => { const v = Object.assign({}, lib()[cur]); for (const [k] of DIM_TABS[tab][1]) if (k !== "—") delete v[k]; if (save(v)) drawRight(); } }, "Defaults for this tab");
    right.append(h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, h("span", { class: "muted" }, "Name"), name),
      h("div", { class: "muted small", style: { fontSize: "11.5px", marginTop: "4px" } }, `${users(cur)} dimension${users(cur) === 1 ? "" : "s"} use this type. Sizes are on paper: a 2.5 text is 2.5 mm high on the sheet at any scale.`),
      tabs, rows, h("div", { style: { margin: "8px 0" } }, reset), preview);
    drawPreview();
  };
  drawList(); drawRight();
  const d = dialog("Dimension Style Manager", h("div", { class: "vstyle", style: { display: "grid", gridTemplateColumns: "minmax(150px, 190px) minmax(0, 1fr)", gap: "12px", overflow: "auto" } }, list, right),
    [{ label: "Close", primary: true, run: () => {} }], { modeless: true });
  d.el.style.width = "min(740px, calc(100vw - 32px))";
  return d;
}
