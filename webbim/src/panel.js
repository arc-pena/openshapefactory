//! The property panel (§4.5), the schedule (§4.5: the panel transposed), the
//! type editor (§5) and Visibility/Graphics (§7). All four are generated from
//! declarations and specs, and every edit goes through the one op pipeline —
//! so a cell edited in a schedule is validated exactly as the panel would.

import { parseLength, parseNumber, bareFactor, fmtArea } from "./units.js";
import { h, clear, icon, dialog, fmtLen } from "./ui_util.js";
import { propertyModel, referenceOptions, specsFor, TYPE_KEYS } from "./props.js";
import { readValue, formatValue, parse, evaluate, ExprError } from "./expr.js";
import { documentLookup, F, CATALOGUE, clone } from "./ocaf.js";
import { scheduleRows, paramText, emOf } from "./scene.js";
import { drawScene } from "./render.js";
import { OPERATORS, categoryOf, penWeight } from "./styles.js";
import { LAYER_PRIORITY, layerStack } from "./walls.js";

/** Live preview of what a typed value will resolve to (type-ahead resolution). */
function preview(app, f, row, text) {
  const q = row.arg ? row.arg.quantity : (row.kind === "Integer" ? "Number" : row.kind);
  try {
    const r = readValue(text, { kind: q === "Integer" ? "Number" : q, lookup: documentLookup(app.doc, f), bare: q === "Length" ? bareFactor() : 1 });
    return { ok: true, text: `= ${formatValue(r.val)}${r.names.length ? `  · binds ${r.names.join(", ")}` : ""}` };
  } catch (e) {
    const at = e.at !== undefined ? ` (at character ${e.at + 1})` : "";
    return { ok: false, text: e.message + at };
  }
}

export function renderPanel(app, root) {
  clear(root);
  const doc = app.doc;
  let ids = [...app.selection].filter(id => doc.element(id));
  let viewMode = false;
  if (!ids.length && app.activeView && doc.element(app.activeView)) { ids = [app.activeView]; viewMode = true; }
  if (!ids.length) { root.append(h("div", { class: "empty" }, h("h3", {}, "Nothing selected"), "Pick something in the view, the browser or a schedule. Shift adds to the selection; the panel then shows what the selection has in common.")); return; }
  const m = propertyModel(doc, ids);
  const f0 = doc.element(ids[0]);
  const decl = doc.declOf(f0);
  const pp = h("div", { class: "pp" });
  // ---- header
  const nameInput = ids.length === 1 ? h("input", { class: "name", type: "text", value: f0.get("Name"), id: "pp-name", "aria-label": "Name",
    onchange: e => app.apply({ op: "rename", id: ids[0], name: e.target.value }) }) : h("div", { style: { fontWeight: 600, fontSize: "15px" } }, `${ids.length} selected`);
  pp.append(h("div", { class: "pp-head" },
    h("div", { class: "title" }, nameInput),
    h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
      ids.length === 1 ? h("span", { class: "chip" }, ids[0]) : null,
      h("span", { class: "chip accent" }, m.types.join(" · ")),
      decl ? h("span", { class: "chip" }, categoryOf(doc, f0)) : null,
      viewMode ? h("span", { class: "chip" }, "active view") : null),
    decl && ids.length === 1 ? h("div", { class: "muted", style: { fontSize: "12px" } }, decl.summary) : null));
  for (const e of m.errors) pp.append(h("div", { class: "banner error", role: "alert" }, e));
  for (const n of m.notes) pp.append(h("div", { class: "banner note" }, n));
  if (ids.length === 1) { const w = doc.plan(f0); if (w && w.joinNotes) for (const n of w.joinNotes) pp.append(h("div", { class: "banner note" }, n)); }
  // ---- the type selector at the head, with Edit Type (the two-tier split made visible)
  if (m.typeKey) {
    const arg = decl.args.find(a => a.key === m.typeKey);
    const opts = referenceOptions(doc, arg, f0);
    const cur = m.typeIds.length === 1 ? m.typeIds[0] : "";
    const sel = h("select", { id: "pp-type", "aria-label": "Type", onchange: e => app.apply({ op: "set", ids, key: m.typeKey, value: { ref: e.target.value } }) },
      cur ? null : h("option", { value: "" }, "<varies>"), opts.map(o => h("option", { value: o.value, selected: o.value === cur }, o.label)));
    pp.append(h("div", { class: "pp-head", style: { paddingTop: "8px" } },
      h("div", { class: "typebar" }, sel, h("button", { class: "btn small", disabled: !cur, onclick: () => typeEditor(app, cur) }, "Edit Type")),
      cur ? h("div", { class: "muted", style: { fontSize: "11.5px" } }, `Type parameters change every element of this type (${countUsers(doc, cur)} use it). Instance parameters below change only ${ids.length === 1 ? "this one" : "these"}.`) : null));
  }
  // ---- grouped rows
  const groups = new Map();
  for (const r of m.rows) { if (r.key === m.typeKey) continue; if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push(r); }
  // Revit's property grid: a Parameter | Value table, one collapsible band per group (the band remembers being folded)
  pp.append(h("div", { class: "pgrid-head" }, h("span", {}, "Parameter"), h("span", {}, "Value")));
  const folded = app.foldedGroups || (app.foldedGroups = new Set());
  for (const [g, rows] of groups) {
    const det = h("details", { class: "grp", open: folded.has(g) ? false : (g !== "Computed" || ids.length === 1), ontoggle: e => { if (e.target.open) folded.delete(g); else folded.add(g); } }, h("summary", {}, g));
    for (const r of rows) det.append(rowEditor(app, ids, f0, r));
    pp.append(det);
  }
  if (viewMode && ["PlanView", "ElevationView", "View3D"].includes(doc.typeOf(f0))) pp.append(h("div", { style: { padding: "12px 14px" } }, h("button", { class: "btn", onclick: () => vvDialog(app, ids[0]) }, "Visibility / Graphics…")));
  root.append(pp);
}
function countUsers(doc, typeId) { return doc.elements().filter(f => TYPE_KEYS.some(k => F.refId(f, k) === typeId)).length; }

function rowEditor(app, ids, f, r) {
  const doc = app.doc;
  const id = `pp-${r.source}-${r.key}`;
  const label = h("label", { for: id }, r.label);
  const val = h("div", { class: "val" });
  const under = h("div", { class: "under" });
  const setKey = r.source === "param" ? "params." + r.key : r.key;
  const commit = (op) => { const res = app.apply(Object.assign({ op: "set", ids, key: setKey }, op)); if (!res.ok) { under.textContent = res.error; under.classList.add("err"); } return res; };
  switch (r.editor) {
    case "value": {
      const bound = r.bound;
      let shown = r.varies ? "" : bound ? bound.expr : (r.value && typeof r.value === "object" && r.value.expr) ? r.value.expr : r.value ?? "";
      // a length is shown in the project's unit; what is typed back may be in any unit
      const isLen = (r.arg && r.arg.quantity === "Length") || (r.spec && r.spec.kind === "Length");
      if (isLen && typeof shown === "number") shown = fmtLen(shown);
      const inp = h("input", { type: "text", id, class: bound ? "bound" : "", value: String(shown), placeholder: r.varies ? "<varies>" : (r.placeholder ?? ""), inputmode: "decimal", spellcheck: false, autocomplete: "off" });
      const base = bound ? (bound.error ? `⚠ ${bound.expr}: ${bound.error}` : `= ${bound.result} · ${bound.id}`) : r.arg && r.arg.unit ? `${r.arg.unit === "mm" ? "length · any unit or formula (10m, 3'-6\", span/2)" : r.arg.unit}` : "";
      under.textContent = base; if (bound && bound.error) under.classList.add("err");
      inp.addEventListener("input", () => { if (!inp.value.trim()) { under.textContent = base; return; } const p = preview(app, f, r, inp.value); under.textContent = p.text; under.classList.toggle("err", !p.ok); });
      let committed = false; // Enter commits, then the re-render blurs the field: never commit twice
      const done = () => { if (committed || inp.value.trim() === String(shown).trim() || !inp.value.trim()) return; committed = true; if (r.source === "param") { let v; try { v = isLen ? parseLength(inp.value) : parseNumber(inp.value); } catch (e) { under.textContent = e.message; under.classList.add("err"); committed = false; return; } commit({ value: v }); } else commit({ text: inp.value }); };
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); done(); inp.blur(); } if (e.key === "Escape") { inp.value = shown; under.textContent = base; inp.blur(); } });
      inp.addEventListener("change", done);
      const line = h("div", { class: "line" }, inp);
      if (r.source === "arg") line.append(h("button", { class: "iconbtn", title: "Bind by picking in the view", "aria-label": `Bind ${r.label} by picking`, onclick: () => app.startPick({ ids, key: r.key, kind: r.arg.quantity === "Integer" ? "Number" : r.arg.quantity, label: r.label }) }, icon("pick")));
      if (bound) {
        line.append(h("button", { class: "iconbtn", title: "Show in the node graph", "aria-label": "Show binding in the graph", onclick: () => app.openGraph(bound.id) }, icon("graph")));
        line.append(h("button", { class: "iconbtn", title: "Clear to a literal", "aria-label": "Unbind", onclick: () => { const res = app.apply({ op: "unbind", id: ids[0], key: r.key }); if (res.said) app.say(res.said, "note"); } }, "✕"));
      }
      val.append(line, under);
      break;
    }
    case "check": {
      const cb = h("input", { type: "checkbox", id, checked: !r.varies && !!r.value, indeterminate: !!r.varies, onchange: e => commit({ value: e.target.checked }) });
      val.append(h("div", { class: "ro" }, cb));
      break;
    }
    case "choice": {
      const cur = r.varies ? "" : (r.value ?? r.placeholder ?? "");
      const sel = h("select", { id, onchange: e => commit({ value: e.target.value }) }, r.varies ? h("option", { value: "" }, "<varies>") : null,
        (r.options || []).map(o => h("option", { value: o.value, selected: o.value === cur }, o.label)));
      val.append(sel);
      if (r.value === undefined && r.placeholder && r.source === "param") val.append(h("div", { class: "under" }, `default: ${r.placeholder}`));
      break;
    }
    case "reference": {
      const opts = r.options || (r.spec && r.spec.kind === "Material" ? Object.entries(doc.lib.materials).map(([k, v]) => ({ value: k, label: v.name })) : []);
      const cur = r.varies ? "" : r.value && r.value.ref ? r.value.ref : (typeof r.value === "string" ? r.value : "");
      const sel = h("select", { id, onchange: e => commit({ value: r.source === "param" ? e.target.value : (e.target.value ? { ref: e.target.value } : null) }) },
        h("option", { value: "" }, r.varies ? "<varies>" : "— none —"), opts.map(o => h("option", { value: o.value, selected: o.value === cur }, o.label)));
      const line = h("div", { class: "line" }, sel);
      if (r.spec && r.spec.kind === "Material") line.append(h("button", { class: "iconbtn", title: "Pick a material from an element", "aria-label": "Pick material", onclick: () => app.startPick({ ids, key: "params." + r.key, kind: "Material", label: r.label, param: true }) }, icon("pick")));
      val.append(line);
      if (cur && !opts.some(o => o.value === cur)) val.append(h("div", { class: "under err" }, `${cur} is not in the document`));
      break;
    }
    case "edit-in-view": {
      val.append(h("button", { class: "btn small", onclick: () => app.editInView(ids[0], r.key) }, r.kind === "Curve2D" ? `Edit ${r.label.toLowerCase()} in view` : `Place in view`));
      if (!r.varies && r.value && r.value.type) val.append(h("div", { class: "under" }, describeCurve(r.value)));
      break;
    }
    case "json": {
      const ta = h("textarea", { id, spellcheck: false }, r.varies ? "" : JSON.stringify(r.value));
      ta.addEventListener("change", () => { try { commit({ value: JSON.parse(ta.value) }); } catch (e) { under.textContent = "not valid JSON: " + e.message; under.classList.add("err"); } });
      val.append(ta, under);
      break;
    }
    case "readonly": {
      const shownRO = r.varies ? "<varies>" : r.value === undefined ? "—" : typeof r.value === "object" ? JSON.stringify(r.value) : typeof r.value === "number" && r.spec && r.spec.kind === "Length" ? fmtLen(r.value) : String(r.value);
      val.append(h("div", { class: "ro", "data-qty": r.live ? r.key : null }, shownRO));
      if (r.origin) val.append(h("div", { class: "origin" }, `from ${r.origin}`));
      break;
    }
    default: {
      const shown = r.varies ? "" : r.value && typeof r.value === "object" && r.value.expr ? "=" + r.value.expr : r.value ?? "";
      const inp = h("input", { type: "text", id, value: String(shown), placeholder: r.varies ? "<varies>" : (r.placeholder ?? "") });
      if (r.display) under.textContent = `= ${r.display}`;
      // Text fields take expressions too: a leading "=" (§4.1).
      inp.addEventListener("input", () => { if (inp.value.startsWith("=")) { try { const v = evaluate(parse(inp.value.slice(1)), { lookup: documentLookup(doc, f), into: "Text" }); under.textContent = "= " + formatValue(v); under.classList.remove("err"); } catch (e) { under.textContent = e.message; under.classList.add("err"); } } });
      inp.addEventListener("change", () => commit({ value: inp.value.startsWith("=") ? { expr: inp.value.slice(1), kind: "Text" } : inp.value }));
      val.append(inp, under);
    }
  }
  if (r.entry) val.append(h("div", { class: "under" }, `${r.entry} · ${r.kind}`));
  return h("div", { class: "prow" }, label, val);
}
function describeCurve(c) {
  if (c.type === "line") return `line ${c.start.map(fmtLen).join(",")} → ${c.end.map(fmtLen).join(",")}`;
  if (c.type === "arc") return `arc r=${fmtLen(c.radius)} ${c.start}°→${c.end}°`;
  if (c.type === "spline") return `spline, ${c.points.length} points`;
  return c.type;
}

// ---------------------------------------------------------------- schedules
export function renderSchedule(app, root, v) {
  clear(root);
  const doc = app.doc, { fields, rows } = scheduleRows(doc, v);
  const pane = h("div", { class: "sheetpane" });
  const card = h("div", { class: "doccard" });
  card.append(h("header", {}, h("h2", {}, v.get("Name")), h("span", { class: "muted" }, `${rows.length} rows · editing a cell edits the model`),
    doc.typeOf(v) === "Schedule" && F.choice(v, "of") === "IfcSpace" ? h("span", { class: "chip" }, "areas to the boundary each space states") : null));
  const table = h("table", { class: "sched" }, h("thead", {}, h("tr", {}, fields.map(k => h("th", {}, k)))));
  const tb = h("tbody");
  for (const r of rows) {
    const tr = h("tr", { class: app.selection.has(r.id) ? "sel" : "", onclick: e => { if (e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT") app.select([r.id], e.shiftKey); } });
    fields.forEach((k, i) => {
      const f = r.f, decl = doc.declOf(f), arg = decl && decl.args.find(a => a.key === k), spec = specsFor(doc, f)[k];
      let td;
      if (k === "Id") td = h("td", { class: "id" }, r.id);
      else if (k === "Name") td = h("td", {}, h("input", { type: "text", value: f.get("Name"), "aria-label": `${r.id} name`, onchange: e => app.apply({ op: "rename", id: r.id, name: e.target.value }) }));
      else if (arg && (arg.kind === "Real" || arg.kind === "Integer") && !(doc.argValue(f, k) && doc.argValue(f, k).ref)) td = h("td", {}, h("input", { type: "text", value: r.cells[i], "aria-label": `${r.id} ${k}`, onchange: e => { const res = app.apply({ op: "set", id: r.id, key: k, text: e.target.value }); if (!res.ok) { e.target.value = r.cells[i]; app.say(res.error, "error"); } } }));
      else if (spec && spec.binding !== "type" && spec.kind === "Enum") { const cur = doc.getParam(f, k) ?? spec.default; td = h("td", {}, h("select", { "aria-label": `${r.id} ${k}`, onchange: e => app.apply({ op: "set", id: r.id, key: "params." + k, value: e.target.value }) }, spec.values.map(o => h("option", { selected: o === cur }, o)))); }
      else if (spec && spec.binding !== "type" && spec.kind !== "Material") td = h("td", {}, h("input", { type: "text", value: doc.getParam(f, k) ?? "", "aria-label": `${r.id} ${k}`, onchange: e => app.apply({ op: "set", id: r.id, key: "params." + k, value: spec.kind === "Length" ? parseLength(e.target.value) : spec.kind === "Integer" || spec.kind === "Number" ? parseNumber(e.target.value) : e.target.value }) }));
      else td = h("td", {}, r.cells[i]);
      tr.append(td);
    });
    tb.append(tr);
  }
  table.append(tb);
  if (F.choice(v, "of") === "IfcSpace") {
    const total = rows.reduce((a, r) => a + ((doc.data(r.f) || {}).value || 0), 0);
    table.append(h("tfoot", {}, h("tr", {}, fields.map((k, i) => h("td", { style: { fontWeight: 600, borderTop: "1px solid var(--rule)" } }, k === "Area" ? fmtArea(total) : i === 0 ? "Total" : "")))));
  }
  card.append(h("div", { class: "tablewrap" }, table));
  pane.append(card);
  root.append(pane);
}

// ---------------------------------------------------------------- type editor (§5)
export function typeEditor(app, typeId) {
  const doc = app.doc;
  const t = clone(doc.lib.types[typeId]);
  const r = doc.resolveType(typeId);
  const isWall = r && r.category === "IfcWall";
  const body = h("div", { style: { display: "grid", gap: "14px" } });
  const nameIn = h("input", { type: "text", value: t.name || typeId, id: "te-name" });
  body.append(h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } }, h("label", { for: "te-name" }, "Name"), nameIn,
    h("span", { class: "chip" }, r.chain.map(c => c.name || c.id).reverse().join(" › ")), h("span", { class: "muted" }, `used by ${countUsers(doc, typeId)} element(s)`)));
  const cv = h("canvas", { width: 600, height: 300 });
  const redraw = () => { if (isWall) drawSection(doc, t, cv); };
  if (isWall) {
    const tbody = h("tbody");
    const funcs = Object.keys(LAYER_PRIORITY);
    const rowsUI = () => {
      clear(tbody);
      t.layers.forEach((L, i) => tbody.append(h("tr", {},
        h("td", { class: "mono" }, String(i + 1)),
        h("td", {}, h("select", { "aria-label": `Layer ${i + 1} function`, onchange: e => { L.function = e.target.value; redraw(); } }, funcs.map(fn => h("option", { selected: fn === L.function }, fn)))),
        h("td", {}, h("input", { type: "text", value: fmtLen(L.thickness), style: { width: "88px" }, "aria-label": `Layer ${i + 1} thickness`, onchange: e => { try { L.thickness = Math.max(0, parseLength(e.target.value)); } catch (err) { e.target.value = fmtLen(L.thickness); return; } e.target.value = fmtLen(L.thickness); redraw(); totalEl.textContent = total(); } })),
        h("td", {}, h("select", { "aria-label": `Layer ${i + 1} material`, onchange: e => { L.material = e.target.value; redraw(); } }, Object.entries(doc.lib.materials).map(([k, m]) => h("option", { value: k, selected: k === L.material }, m.name)))),
        h("td", {}, h("span", { class: "chip" }, `p${LAYER_PRIORITY[L.function] ?? 4}`)),
        h("td", { style: { whiteSpace: "nowrap" } },
          h("button", { class: "iconbtn", "aria-label": "Move up", disabled: i === 0, onclick: () => { t.layers.splice(i - 1, 0, t.layers.splice(i, 1)[0]); rowsUI(); redraw(); } }, "↑"), " ",
          h("button", { class: "iconbtn", "aria-label": "Remove layer", onclick: () => { t.layers.splice(i, 1); rowsUI(); redraw(); } }, "✕")))));
    };
    const total = () => `${fmtLen(t.layers.reduce((a, l) => a + l.thickness, 0))} total`;
    const totalEl = h("span", { class: "muted" }, total());
    rowsUI();
    const core = h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, "Core between boundaries",
      h("input", { type: "number", min: 0, value: t.coreStart ?? 0, style: { width: "56px" }, "aria-label": "Core start boundary", oninput: e => { t.coreStart = Number(e.target.value); redraw(); } }), "and",
      h("input", { type: "number", min: 0, value: t.coreEnd ?? t.layers.length, style: { width: "56px" }, "aria-label": "Core end boundary", oninput: e => { t.coreEnd = Number(e.target.value); redraw(); } }), totalEl);
    body.append(h("h3", {}, "Layers, exterior first"),
      h("div", { class: "layers-edit" },
        h("div", {}, h("table", {}, h("thead", {}, h("tr", {}, ["#", "Function", "Thickness", "Material", "Priority", ""].map(x => h("th", {}, x)))), tbody),
          h("div", { style: { marginTop: "8px", display: "flex", gap: "8px" } }, h("button", { class: "btn small", onclick: () => { t.layers.push({ function: "Finish 1", thickness: 13, material: "M-PLAS" }); rowsUI(); redraw(); } }, "+ Layer")), core),
        h("div", {}, cv, h("div", { class: "muted", style: { fontSize: "11.5px", marginTop: "4px" } }, "Live section at 1:10, drawn through the same scene renderer as every view."))));
  }
  const specs = Object.entries(r.specs || {}).concat(Object.entries(doc.lib.paramSpecs).filter(([k, s]) => s.binding === "type" && (s.categories.includes("*") || s.categories.includes(r.category))));
  const ptab = h("tbody");
  t.params = t.params || {};
  for (const [k, s] of specs) {
    const cur = t.params[k] ?? "";
    const inherited = r.params[k] !== undefined && t.params[k] === undefined ? `inherits ${r.params[k]} from ${r.origin[k]}` : "";
    const ed = s.kind === "Enum" ? h("select", { "aria-label": k, onchange: e => { t.params[k] = e.target.value; } }, h("option", { value: "" }, "—"), s.values.map(o => h("option", { selected: String(o) === String(cur) }, o)))
      : h("input", { type: "text", value: cur, placeholder: inherited, "aria-label": k, onchange: e => { t.params[k] = s.kind === "Length" ? parseLength(e.target.value) : s.kind === "Number" || s.kind === "Integer" ? parseNumber(e.target.value) : e.target.value; } });
    ptab.append(h("tr", {}, h("td", {}, k), h("td", {}, ed), h("td", { class: "muted" }, inherited ? `from ${r.origin[k]}` : s.kind)));
  }
  if (specs.length) body.append(h("h3", {}, "Type parameters"), h("table", {}, ptab));
  if (!isWall) body.append(h("div", { class: "muted" }, "Dimensions: ", JSON.stringify(Object.fromEntries(Object.entries(t).filter(([k]) => ["width", "height", "depth", "frame", "leafThickness", "mullions"].includes(k))))));
  const orig = { op: "type", lib: "types", id: typeId, value: clone(doc.lib.types[typeId]) };
  const live = liveEdit(app, body, () => { t.name = nameIn.value; return { op: "type", lib: "types", id: typeId, value: t }; });
  body.prepend(live.status);
  const d = dialog(`Edit Type — ${t.name || typeId}`, body, [
    { label: "Duplicate…", run: () => { let n = 2; while (doc.lib.types[typeId + "-" + n]) n++; const nid = typeId + "-" + n; const copy = clone(t); copy.name = (t.name || typeId) + " " + n; app.apply({ op: "type", lib: "types", id: nid, value: copy }); app.say(`Created ${copy.name} (${nid})`, "ok"); return false; } },
    { label: "Revert", run: () => { live.revert(orig); typeEditor(app, typeId); } },
    { label: "Close", primary: true, run: () => true },
  ], { modeless: true });
  d.onClose = live.done;
  requestAnimationFrame(redraw);
  return d;
}
/** The live section preview: layers as regions, materials resolved, drawn by drawScene. */
function drawSection(doc, t, cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
  const g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height);
  const T = t.layers.reduce((a, l) => a + l.thickness, 0) || 1;
  const S = 10, prims = []; let y = 0;
  const len = 900;
  t.layers.forEach((L, i) => {
    const m = doc.lib.materials[L.material] || { cut: {} };
    const path = [[0, y], [len, y], [len, y + L.thickness], [0, y + L.thickness]].map(p => [p[0] / S, p[1] / S]);
    const segs = path.map((p, k) => ({ k: "L", a: p, b: path[(k + 1) % 4] }));
    if (m.cut.background) prims.push({ t: "fill", path: segs, colour: m.cut.background });
    const pat = m.cut.pattern && doc.lib.patterns[m.cut.pattern];
    if (pat && !pat.batt) prims.push({ t: "hatch", path: segs, pattern: Object.assign({ id: m.cut.pattern }, pat), scale: pat.kind === "model" ? 1 / S : 1, colour: "#333", weight: 0.13 });
    prims.push({ t: "stroke", path: segs, weight: penWeight(doc, m.cut.pen || "thin", S), colour: "#000" });
    const core = i >= (t.coreStart ?? 0) && i < (t.coreEnd ?? t.layers.length);
    prims.push({ t: "text", at: [len / S + 3, (y + L.thickness / 2) / S - 0.9], text: `${L.thickness} ${(doc.lib.materials[L.material] || {}).name || L.material}${core ? " · core" : ""}`, height: 1.8, colour: "#222" });
    y += L.thickness;
  });
  const W = r.width, H = r.height;
  const wmm = len / S + 60, hmm = T / S + 10;
  const z = Math.min(W / wmm, H / hmm);
  drawScene(g, { prims }, { x: -3, y: -((H / z) - T / S) / 2, z, W, H, dpr });
}

// ---------------------------------------------------------------- Visibility / Graphics (§7)
export function vvDialog(app, viewId) {
  const doc = app.doc, v = doc.element(viewId);
  const styleId = F.refId(v, "style") || "VS-CONSTRUCTION";
  const st = clone(doc.lib.viewStyles[styleId]);
  st.byCategory = st.byCategory || {}; st.rules = st.rules || [];
  const body = h("div", {});
  const cats = Object.entries(doc.lib.categories);
  const catTable = h("tbody");
  for (const [k, c] of cats) {
    const cs = st.byCategory[k] = st.byCategory[k] || {};
    const subs = Object.entries(c.subcategories || {});
    catTable.append(h("tr", {}, h("td", {}, h("input", { type: "checkbox", checked: cs.visible !== false, "aria-label": `${c.name} visible`, onchange: e => { cs.visible = e.target.checked; } })),
      h("td", {}, c.name, h("div", { class: "mono muted" }, k)),
      h("td", {}, subs.map(([sn, pens]) => h("div", { class: "mono", style: { fontSize: "11px" } }, `${sn}: ${Object.entries(pens).map(([role, p]) => `${role} ${p}`).join(", ")}`)))));
  }
  const pens = clone(doc.lib.pens["PEN-ISO"]);
  const penRows = h("tbody", {}, Object.entries(pens.pens).map(([n, p]) => h("tr", {}, h("td", {}, n), h("td", {}, h("input", { type: "number", step: "0.01", min: "0", value: p.weight, style: { width: "80px" }, "aria-label": `${n} weight`, oninput: e => { p.weight = Number(e.target.value); } })), h("td", { class: "muted" }, "mm on paper"))));
  const specs = Object.assign({ Category: { kind: "Enum", values: Object.keys(doc.lib.categories) } }, doc.lib.paramSpecs);
  const rulesBox = h("div", { style: { display: "grid", gap: "8px" } });
  const drawRules = () => {
    clear(rulesBox);
    st.rules.forEach((rule, i) => {
      const w = rule.when && rule.when.param ? rule.when : { param: "Phase", is: "Demolished" };
      rule.when = w;
      const op = Object.keys(w).find(k => k !== "param") || "is";
      const kind = (specs[w.param] || { kind: "Text" }).kind;
      const opSel = h("select", { "aria-label": "Operator", onchange: e => { const val = w[op]; delete w[op]; w[e.target.value] = val; drawRules(); } }, (OPERATORS[kind] || OPERATORS.Text).map(o => h("option", { selected: o === op }, o)));
      const pSel = h("select", { "aria-label": "Parameter", onchange: e => { rule.when = { param: e.target.value, is: "" }; drawRules(); } }, Object.keys(specs).map(p => h("option", { selected: p === w.param }, p)));
      const valIn = (specs[w.param] && specs[w.param].values) ? h("select", { "aria-label": "Value", onchange: e => { w[op] = e.target.value; } }, specs[w.param].values.map(x => h("option", { selected: String(x) === String(w[op]) }, x))) : h("input", { type: "text", value: w[op] ?? "", "aria-label": "Value", oninput: e => { w[op] = e.target.value; } });
      rule.then = rule.then || {}; rule.then.cut = rule.then.cut || {};
      rulesBox.append(h("div", { style: { border: "1px solid var(--rule)", borderRadius: "6px", padding: "8px", display: "grid", gap: "6px" } },
        h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } }, h("span", { class: "mono" }, rule.id || "rule"), "when", pSel, opSel, valIn,
          h("label", {}, h("input", { type: "checkbox", checked: !!rule.stop, onchange: e => { rule.stop = e.target.checked; } }), " stop"),
          h("button", { class: "btn small", onclick: () => { st.rules.splice(i, 1); drawRules(); } }, "Remove")),
        h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } }, "then cut",
          h("input", { type: "text", value: rule.then.cut.colour || "", placeholder: "colour", style: { width: "90px" }, "aria-label": "Cut colour", oninput: e => { rule.then.cut.colour = e.target.value || undefined; } }),
          h("select", { "aria-label": "Line type", onchange: e => { rule.then.cut.lineType = e.target.value || undefined; } }, ["", "solid", "dashed1", "dashed2", "dotted"].map(x => h("option", { selected: x === (rule.then.cut.lineType || "") }, x || "line type"))),
          h("input", { type: "text", value: rule.then.cut.fill || "", placeholder: "fill", style: { width: "90px" }, "aria-label": "Cut fill", oninput: e => { rule.then.cut.fill = e.target.value || undefined; } }),
          h("label", {}, h("input", { type: "checkbox", checked: !!rule.then.halftone, onchange: e => { rule.then.halftone = e.target.checked; } }), " halftone"))));
    });
  };
  drawRules();
  body.append(h("h3", {}, `Style · ${st.name || styleId}`), h("div", { class: "muted" }, "Changes apply to every view using this style. Nothing here rebuilds geometry: it bumps the view revision only."),
    h("h3", {}, "Categories"), h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["", "Category", "Subcategory pens"].map(x => h("th", {}, x)))), catTable)),
    h("h3", {}, "Filter rules (first match with stop wins)"), rulesBox, h("div", {}, h("button", { class: "btn small", onclick: () => { st.rules.push({ id: "FL-" + (st.rules.length + 1), when: { param: "Phase", is: "Existing" }, then: { cut: { colour: "#888888" }, halftone: true } }); drawRules(); } }, "+ Rule")),
    h("h3", {}, "Pens — ISO 128 (weight is what a pen is)"), h("table", {}, penRows));
  const orig = [{ op: "style", id: styleId, value: clone(doc.lib.viewStyles[styleId]) }, { op: "type", lib: "pens", id: "PEN-ISO", value: clone(doc.lib.pens["PEN-ISO"]) }];
  const live = liveEdit(app, body, () => [{ op: "style", id: styleId, value: st }, { op: "type", lib: "pens", id: "PEN-ISO", value: pens }]);
  body.prepend(live.status);
  const d = dialog("Visibility / Graphics", body, [
    { label: "Revert", run: () => { live.revert(orig); vvDialog(app, viewId); } },
    { label: "Close", primary: true, run: () => true }], { modeless: true });
  d.onClose = live.done;
}
/** Every click and keystroke in `body` applies at once (one undo step for the session), so the view shows the result while you edit. */
function liveEdit(app, body, makeOps) {
  const key = "live:" + Math.random().toString(36).slice(2);
  const status = h("div", { class: "live", role: "status" }, "Changes apply as you edit · Ctrl+Z undoes the session");
  let queued = false;
  const push = () => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const r = app.apply(makeOps(), { quiet: true, coalesce: key });
      status.textContent = r.ok ? "✓ Applied live · Ctrl+Z undoes the session" : "⚠ " + (r.error || "not applied");
      status.style.color = r.ok ? "" : "var(--error)";
    });
  };
  body.addEventListener("input", push); body.addEventListener("change", push);
  body.addEventListener("click", e => { if (e.target.closest("button")) push(); });
  return { push, status,
    revert: ops => { app.apply(ops, { quiet: true, coalesce: key }); app.editor.seal(); app.refresh({ keepMain: true }); },
    done: () => { app.editor.seal(); app.refresh({ keepMain: true }); } };
}
