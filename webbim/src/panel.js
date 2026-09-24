//! The property panel (§4.5), the schedule (§4.5: the panel transposed), the
//! type editor (§5) and Visibility/Graphics (§7). All four are generated from
//! declarations and specs, and every edit goes through the one op pipeline —
//! so a cell edited in a schedule is validated exactly as the panel would.

import { parseLength, parseNumber, bareFactor, fmtArea, fmtVolume } from "./units.js";
import { h, clear, icon, dialog, fmtLen } from "./ui_util.js";
import { sectionPicker } from "./sectionui.js";
import { propertyModel, referenceOptions, specsFor, TYPE_KEYS } from "./props.js";
import { readValue, formatValue, parse, evaluate, ExprError } from "./expr.js";
import { documentLookup, F, CATALOGUE, clone } from "./ocaf.js";
import { scheduleRows, paramText, emOf } from "./scene.js";
import { drawScene } from "./render.js";
import { OPERATORS, categoryOf, penWeight, LINE_TYPES, SCHEMES, isAnnotationCategory, lockedBy, lockedKey, blankStyle, mix } from "./styles.js";
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
      h("div", { class: "typebar" }, sel, h("button", { class: "btn small", disabled: !cur, onclick: () => typeEditor(app, cur) }, "Edit Type"),
        // beams and columns take any catalogue section: loaded as a type, then given to the selection
        m.typeKey === "beamType" || m.typeKey === "columnType" ? h("button", { class: "btn small", title: "Load a section from the AISC, EN, BS or AS/NZS catalogue", onclick: () => sectionPicker(app, m.typeKey === "beamType" ? "IfcBeam" : "IfcColumn", id => app.apply({ op: "set", ids, key: m.typeKey, value: { ref: id } })) }, "Sections…") : null),
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
  if (viewMode && ["PlanView", "ElevationView", "SectionView", "View3D"].includes(doc.typeOf(f0))) pp.append(h("div", { style: { padding: "12px 14px" } }, h("button", { class: "btn", onclick: () => vvDialog(app, ids[0]) }, "Visibility / Graphics…")));
  root.append(pp);
  if (ids.length === 1 && doc.typeOf(doc.element(ids[0])) === "CADImport") root.append(importLayers(app, doc.element(ids[0])));
  if (ids.length === 1 && doc.typeOf(doc.element(ids[0])) === "SiteBoundary") root.append(siteEdges(app, doc.element(ids[0])));
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
  const isView = ids.length === 1 && doc.declOf(f) && doc.declOf(f).kind === "view" && r.source === "arg";
  // the view's style: the file's styles, and Edit (the View Style editor)
  if (isView && r.key === "style") {
    val.append(h("div", { class: "line" }, app.styleSelect ? app.styleSelect(ids[0], "") : null,
      h("button", { class: "btn small", onclick: () => viewStyleEditor(app, F.refId(f, "style"), ids[0]) }, "Edit…")));
    const st = doc.lib.viewStyles[F.refId(f, "style")], n = st && st.include ? Object.values(st.include).filter(Boolean).length : 0;
    val.append(h("div", { class: "under" }, st ? (n ? `holds ${n} setting${n === 1 ? "" : "s"} of this view (🔒 below)` : "holds graphics only: every setting stays this view's") : "no style: default graphics"));
    return h("div", { class: "prow" }, label, val);
  }
  // this view's own V/G, filters and element overrides: edited in Visibility/Graphics, not as JSON
  if (isView && (r.key === "vg" || r.key === "filters" || r.key === "overrides")) {
    if (r.key !== "vg") return h("div", { hidden: true });
    const vg = r.value || {}, n = Object.keys(vg.byCategory || {}).length, nf = (vg.filters || []).length;
    val.append(h("button", { class: "btn small", onclick: () => vvDialog(app, ids[0]) }, "Edit… (VV)"),
      h("div", { class: "under" }, n || nf || vg.scheme ? `${n} categor${n === 1 ? "y" : "ies"} · ${nf} filter${nf === 1 ? "" : "s"}${vg.scheme ? " · own scheme" : ""}` : "no overrides: as the style"));
    return h("div", { class: "prow" }, h("label", {}, "Visibility/Graphics"), val);
  }
  // a setting the view's style includes: shown, locked, changed in the style
  const lk = isView && lockedKey(doc, f, r.key);
  if (lk) {
    const shownL = r.value && typeof r.value === "object" ? Object.entries(r.value).map(([k, x]) => `${k} ${typeof x === "number" ? fmtLen(x) : x}`).join(" · ") : r.key === "scale" ? `1 : ${r.value}` : r.key === "depth" ? fmtLen(r.value) : String(r.value ?? "—");
    val.append(h("div", { class: "ro locked" }, "🔒 ", shownL), h("div", { class: "under" }, `set by the view style ${lk} · `, h("a", { href: "#", onclick: e => { e.preventDefault(); viewStyleEditor(app, F.refId(f, "style"), ids[0]); } }, "edit style")));
    return h("div", { class: "prow locked" }, label, val);
  }
  // a wall's inclination: the angle it leans, what it turns about, and its raking top
  if (r.key === "slope" && r.source === "arg" && doc.typeOf(f) === "Wall") {
    const cur = Object.assign({ top: 0, lean: 0 }, r.value || {});
    const num = (k, label) => { const i = h("input", { type: "text", value: String(cur[k] || 0), style: { width: "60px" }, "aria-label": label }); i.addEventListener("change", () => { const v = Number(i.value); if (!Number.isFinite(v) || Math.abs(v) >= 89) { under.textContent = "an angle between -89° and 89°"; under.classList.add("err"); return; } const next = Object.assign({}, cur, { [k]: v }); if (k === "lean" && next.pivot === undefined) next.pivot = "centre"; commit({ value: next }); }); return i; };
    const piv = h("select", { "aria-label": "Inclination pivot", onchange: e => commit({ value: Object.assign({}, cur, { pivot: e.target.value }) }) },
      [["centre", "Centreline at floor finish"], ["base", "Location line at base"]].map(([v, l]) => h("option", { value: v, selected: (cur.pivot || "base") === v }, l)));
    const grid = h("div", { style: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 6px", alignItems: "center" } },
      h("span", { class: "muted" }, "Inclination °"), num("lean", "Inclination"), h("span", { class: "muted" }, "Turns about"), piv, h("span", { class: "muted" }, "Top slope °"), num("top", "Top slope"));
    under.textContent = "positive leans toward the wall's left; about its centreline where it meets the floor finish, the base line moves so the wall pivots there";
    val.append(grid, under);
    return h("div", { class: "prow" }, h("label", {}, "Inclination"), val);
  }
  // a plan's View Range, as Revit's dialog has it: four planes measured from the level, any unit
  if (r.key === "viewRange" && r.source === "arg") {
    const cur = Object.assign({ top: 2300, cut: 1200, bottom: 0 }, r.value || {}); if (cur.depth === undefined) cur.depth = cur.bottom;
    const rows = [["top", "Top"], ["cut", "Cut plane"], ["bottom", "Bottom"], ["depth", "View depth"]];
    const grid = h("div", { class: "vrange", style: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 6px", alignItems: "center" } });
    for (const [k, lab] of rows) {
      const inp = h("input", { type: "text", value: fmtLen(cur[k]), "aria-label": `View range ${lab}`, style: { width: "100%" } });
      inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); });
      inp.addEventListener("change", () => {
        let v; try { v = parseLength(inp.value); } catch (e) { under.textContent = e.message; under.classList.add("err"); return; }
        const next = Object.assign({}, cur, { [k]: v });
        // Revit's rule: top ≥ cut ≥ bottom ≥ depth
        if (!(next.top >= next.cut && next.cut >= next.bottom && next.bottom >= next.depth)) { under.textContent = "keep top ≥ cut plane ≥ bottom ≥ view depth"; under.classList.add("err"); inp.value = fmtLen(cur[k]); return; }
        commit({ value: next });
      });
      grid.append(h("span", { class: "muted" }, lab), inp);
    }
    under.textContent = "from the view's level. Below Bottom, down to View depth, is drawn as seen beyond; deeper is not shown";
    val.append(grid, under);
    return h("div", { class: "prow" }, label, val);
  }
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
  const isWall = r && (r.category === "IfcWall" || r.category === "IfcSlab") && Array.isArray(t.layers);
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
        h("td", {}, h("select", { "aria-label": `Layer ${i + 1} material`, onchange: e => { L.material = e.target.value; redraw(); } }, Object.entries(doc.lib.materials).map(([k, m]) => h("option", { value: k, selected: k === L.material }, (m.mark ? m.mark + " · " : "") + m.name)))),
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
    body.append(h("h3", {}, r.category === "IfcSlab" ? "Layers, top first (each its own material: a finish, a screed, the slab)" : "Layers, exterior first", " ", h("button", { class: "btn small ghost", onclick: () => materialsEditor(app) }, "Materials…")),
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
//! Revit's VV, per view. What the view's style INCLUDES is the style's: shown, greyed and locked here,
//! changed only in the style. Everything else is this view's own, kept in its `vg` argument and laid
//! over the style when the view draws. Opened on a style (from the View Style editor) it edits the style.
const VV_TABS = [["model", "Model Categories"], ["annotation", "Annotation (2D / Symbolic)"], ["filters", "Filters"], ["view", "View"], ["scheme", "Graphic Scheme"], ["pens", "Pens"]];
const VIEW_TYPES_VV = ["PlanView", "ElevationView", "SectionView", "View3D"];
const RES_UNIT = () => /'|ft|in/.test(fmtLen(1000)) ? { area: 92903.04, vol: 28316846.6, a: "ft²", v: "ft³" } : { area: 1e6, vol: 1e9, a: "m²", v: "m³" };
/** The parameters a filter can test: category, type and family, every shared parameter, and whatever
 *  the model measures of itself (Length, Area, Volume, …) with the kind it measures in. */
export function filterParams(doc) {
  const out = { Category: { kind: "Enum", values: Object.keys(doc.lib.categories) }, Type: { kind: "Text" }, Family: { kind: "Text" }, Name: { kind: "Text" } };
  for (const [k, sp] of Object.entries(doc.lib.paramSpecs)) out[k] = sp;
  for (const f of doc.elements()) { const d = doc.data(f); if (d && d.props) for (const [k, v] of Object.entries(d.props)) if (!out[k] && v && v.kind) out[k] = { kind: v.kind === "Integer" ? "Number" : v.kind }; }
  return out;
}
const OPS_OF = kind => OPERATORS[kind] || (kind === "Area" || kind === "Volume" || kind === "Angle" ? OPERATORS.Number : OPERATORS.Text);
const OP_LABEL = { is: "equals", not: "does not equal", gt: "is greater than", lt: "is less than", gte: "is ≥", lte: "is ≤", between: "is between", contains: "contains", beginsWith: "begins with", endsWith: "ends with", defined: "has a value", undefined: "has no value" };
/** A filter value as typed: lengths in any unit, areas and volumes in the project's, numbers as numbers. */
function readFilterValue(kind, text) {
  const U = RES_UNIT();
  if (kind === "Length") return parseLength(text);
  if (kind === "Area") return parseNumber(String(text).replace(/(m²|m2|ft²|ft2|sf|sq\s*ft)\s*$/i, "")) * U.area;
  if (kind === "Volume") return parseNumber(String(text).replace(/(m³|m3|ft³|ft3|cf)\s*$/i, "")) * U.vol;
  if (kind === "Number" || kind === "Integer" || kind === "Angle") return parseNumber(text);
  return text;
}
function showFilterValue(kind, v) {
  if (v === undefined || v === null || v === "") return "";
  if (kind === "Length" && typeof v === "number") return fmtLen(v);
  if (kind === "Area" && typeof v === "number") return fmtArea(v);
  if (kind === "Volume" && typeof v === "number") return fmtVolume(v);
  return String(v);
}
/** A rule's condition as a list: { all: [...] } or { any: [...] }, each item { param, <op>: value }. */
function conditionsOf(rule) {
  const w = rule.when || {};
  if (w.all) return { mode: "all", list: w.all };
  if (w.any) return { mode: "any", list: w.any };
  if (w.param) { rule.when = { all: [w] }; return { mode: "all", list: rule.when.all }; }
  rule.when = { all: [] }; return { mode: "all", list: rule.when.all };
}
const lockNote = (why, onEdit) => h("div", { class: "banner lock" }, h("span", {}, "🔒 ", why), onEdit ? h("button", { class: "btn small", onclick: onEdit }, "Edit style…") : null);

export function vvDialog(app, viewId, opts = {}) {
  const doc = app.doc, v = viewId ? doc.element(viewId) : null;
  const styleMode = !!opts.styleId;
  const styleId = opts.styleId || (v && F.refId(v, "style")) || null;
  const baseStyle = (styleId && doc.lib.viewStyles[styleId]) || {};
  const inc = styleMode ? {} : (baseStyle.include || {});
  const styleName = baseStyle.name || styleId || "";
  // what this dialog edits: the style itself, or this view's own overrides
  const target = styleMode ? clone(baseStyle) : clone((v && doc.argValue(v, "vg")) || {});
  target.byCategory = target.byCategory || {};
  const ownRules = styleMode ? (target.rules = target.rules || []) : (target.filters = target.filters || []);
  const touched = new Set();
  const editStyle = () => viewStyleEditor(app, styleId, viewId);
  const penNames = Object.keys((doc.lib.pens["PEN-ISO"] || {}).pens || {});
  const patNames = Object.keys(doc.lib.patterns || {});
  const vt = v ? doc.typeOf(v) : null;
  let tab = opts.tab || "model";

  const body = h("div", { class: "vv" });
  const tabsBar = h("div", { class: "vvtabs", role: "tablist" });
  const pane = h("div", { class: "vvpane" });
  const head = h("div", { class: "muted", style: { fontSize: "12px", marginBottom: "6px" } },
    styleMode ? `Editing the view style ${styleName}: every view using it changes.`
      : styleId ? h("span", {}, `View style: `, h("b", {}, styleName), Object.values(inc).some(Boolean) ? ` · greyed items are set by the style` : ` · nothing is locked by it`, " ", h("button", { class: "btn small ghost", onclick: editStyle }, "Edit style…"))
        : "No view style: everything here is this view's own.");
  const drawTabs = () => {
    clear(tabsBar);
    for (const [k, label] of VV_TABS) {
      const locked = !styleMode && ((k === "model" && inc.modelVG) || (k === "annotation" && inc.annotationVG) || (k === "filters" && inc.filters) || (k === "scheme" && inc.scheme));
      tabsBar.append(h("button", { role: "tab", class: "vvtab" + (k === tab ? " on" : ""), "aria-selected": String(k === tab), onclick: () => { tab = k; drawTabs(); drawPane(); } }, locked ? "🔒 " : "", label));
    }
  };
  // ---------------- categories
  const catRows = (annotation) => {
    const locked = !styleMode && (annotation ? inc.annotationVG : inc.modelVG);
    const wrap = h("div", {});
    if (locked) wrap.append(lockNote(`${annotation ? "Annotation" : "Model"} category overrides are set by the view style ${styleName}.`, editStyle));
    else if (!styleMode) wrap.append(h("div", { class: "muted small" }, "Blank cells follow the view style (", styleName || "defaults", "); a set cell overrides it in this view only. ✕ clears a row's overrides."));
    const base = cat => styleMode ? {} : ((baseStyle.byCategory || {})[cat] || {});
    const ov = cat => target.byCategory[cat] || (target.byCategory[cat] = {});
    const val = (cat, role, key) => { const o = target.byCategory[cat] || {}, b = base(cat); return role ? ((o[role] || {})[key] ?? (b[role] || {})[key]) : (o[key] ?? b[key]); };
    const own = (cat, role, key) => { const o = target.byCategory[cat] || {}; return role ? (o[role] || {})[key] !== undefined : o[key] !== undefined; };
    const put = (cat, role, key, x) => {
      const o = ov(cat);
      if (role) { o[role] = o[role] || {}; if (x === "" || x === undefined) delete o[role][key]; else o[role][key] = x; if (!Object.keys(o[role]).length) delete o[role]; }
      else if (x === "" || x === undefined) delete o[key]; else o[key] = x;
    };
    const dis = !!locked;
    const colourCell = (cat, role, key, label) => {
      const cur = val(cat, role, key), mine = own(cat, role, key);
      const inp = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(cur || "") ? cur : "#000000", disabled: dis, class: mine ? "set" : "inherit", title: `${label}${mine ? "" : " (from the style)"}`, "aria-label": `${cat} ${label}`, oninput: e => { put(cat, role, key, e.target.value); e.target.className = "set"; } });
      return inp;
    };
    const selCell = (cat, role, key, options, label) => {
      const cur = val(cat, role, key), mine = own(cat, role, key);
      return h("select", { disabled: dis, class: mine ? "set" : "inherit", "aria-label": `${cat} ${label}`, title: label, onchange: e => { put(cat, role, key, e.target.value); e.target.className = e.target.value ? "set" : "inherit"; } },
        h("option", { value: "" }, mine || cur === undefined ? "—" : `(${cur})`), options.map(o => h("option", { value: o, selected: mine && o === cur }, o)));
    };
    const tb = h("tbody");
    const cats = Object.entries(doc.lib.categories).filter(([k]) => isAnnotationCategory(k) === annotation);
    for (const [k, c] of cats) {
      const visible = val(k, null, "visible") !== false;
      tb.append(h("tr", { class: own(k, null, "visible") || Object.keys(target.byCategory[k] || {}).length ? "ovr" : "" },
        h("td", {}, h("input", { type: "checkbox", checked: visible, disabled: dis, "aria-label": `${c.name} visible`, onchange: e => put(k, null, "visible", e.target.checked ? (base(k).visible === false ? true : undefined) : false) })),
        h("td", { class: "catname" }, c.name, h("div", { class: "mono muted" }, k)),
        h("td", {}, h("div", { class: "cellrow" }, colourCell(k, "projection", "colour", "projection colour"), selCell(k, "projection", "pen", penNames, "projection pen"), selCell(k, "projection", "lineType", Object.keys(LINE_TYPES), "projection line type"))),
        annotation ? null : h("td", {}, h("div", { class: "cellrow" }, colourCell(k, "cut", "colour", "cut colour"), selCell(k, "cut", "pen", penNames, "cut pen"), selCell(k, "cut", "lineType", Object.keys(LINE_TYPES), "cut line type"))),
        annotation ? null : h("td", {}, h("div", { class: "cellrow" }, colourCell(k, "cut", "fill", "cut fill"), selCell(k, "cut", "pattern", ["solid", "none", ...patNames], "cut pattern"))),
        h("td", {}, h("input", { type: "checkbox", checked: !!val(k, null, "halftone"), disabled: dis, "aria-label": `${c.name} halftone`, onchange: e => put(k, null, "halftone", e.target.checked || (base(k).halftone ? false : undefined)) })),
        annotation ? null : h("td", {}, selCell(k, null, "detailLevel", ["By View", "Coarse", "Medium", "Fine"], "detail level")),
        annotation ? null : h("td", {}, (() => {
          // which wins where a component has a material: the material (default), this view's graphics, or neither
          const cur = val(k, null, "materialPriority"), mine = own(k, null, "materialPriority");
          const L = { material: "Material wins", view: "View wins", none: "Ignore materials" };
          return h("select", { disabled: dis, class: mine ? "set" : "inherit", "aria-label": `${c.name} material priority`, title: "Material wins: a component with a material draws as its material (then the view, then the category). View wins: the view's graphics beat the material. Ignore materials: only the view and category.",
            onchange: e => { put(k, null, "materialPriority", e.target.value); e.target.className = e.target.value ? "set" : "inherit"; } },
            h("option", { value: "" }, mine ? "—" : `(${L[cur || "material"]})`), Object.entries(L).map(([v2, l]) => h("option", { value: v2, selected: mine && v2 === cur }, l)));
        })()),
        h("td", {}, h("button", { class: "iconbtn", disabled: dis, title: "Clear this row's overrides", "aria-label": `Clear ${c.name} overrides`, onclick: () => { delete target.byCategory[k]; drawPane(); } }, "✕"))));
    }
    const heads = annotation ? ["Visible", "Category", "Lines (colour · pen · type)", "Halftone", ""] : ["Visible", "Category", "Projection / surface lines", "Cut lines", "Cut pattern (fill · hatch)", "Halftone", "Detail level", "Material priority", ""];
    wrap.append(h("div", { class: "tablewrap" }, h("table", { class: "vvtable" + (dis ? " locked" : "") }, h("thead", {}, h("tr", {}, heads.map(x => h("th", {}, x)))), tb)));
    if (!cats.length) wrap.append(h("div", { class: "muted" }, "No categories of this kind in the file."));
    return wrap;
  };
  // ---------------- filters
  const specs = filterParams(doc);
  const ruleCard = (rule, list, i, locked, from) => {
    const c = conditionsOf(rule);
    rule.then = rule.then || {};
    const t = rule.then; t.projection = t.projection || {}; t.cut = t.cut || {};
    const dis = !!locked;
    const card = h("div", { class: "rulecard" + (dis ? " locked" : "") + (rule.enabled === false ? " off" : "") });
    const condBox = h("div", { class: "conds" });
    c.list.forEach((w, j) => {
      const param = w.param || "Category", kind = (specs[param] || { kind: "Text" }).kind;
      const op = Object.keys(w).find(k => k !== "param") || "is";
      const needsVal = op !== "defined" && op !== "undefined";
      const pSel = h("select", { disabled: dis, "aria-label": "Parameter", onchange: e => { c.list[j] = { param: e.target.value, is: "" }; drawPane(); } }, Object.keys(specs).map(p => h("option", { selected: p === param }, p)));
      const oSel = h("select", { disabled: dis, "aria-label": "Operator", onchange: e => { const x = w[op]; delete w[op]; const n = e.target.value; w[n] = n === "between" ? [x ?? 0, x ?? 0] : n === "defined" || n === "undefined" ? true : (Array.isArray(x) ? x[0] : x ?? ""); drawPane(); } },
        OPS_OF(kind).map(o => h("option", { value: o, selected: o === op }, OP_LABEL[o] || o)));
      const valIn = (idx) => {
        const cur = idx === undefined ? w[op] : (w[op] || [])[idx];
        if (specs[param] && specs[param].values) return h("select", { disabled: dis, "aria-label": "Value", onchange: e => { w[op] = e.target.value; } }, h("option", { value: "" }, "—"), specs[param].values.map(x => h("option", { selected: String(x) === String(cur) }, x)));
        const inp = h("input", { type: "text", disabled: dis, value: showFilterValue(kind, cur), "aria-label": "Value", style: { width: "110px" } });
        inp.addEventListener("change", () => { let x; try { x = readFilterValue(kind, inp.value); inp.classList.remove("bad"); } catch (e) { inp.classList.add("bad"); inp.title = e.message; return; } if (idx === undefined) w[op] = x; else { w[op] = (w[op] || [0, 0]).slice(); w[op][idx] = x; } });
        return inp;
      };
      condBox.append(h("div", { class: "cellrow" }, j === 0 ? h("span", { class: "muted" }, "where") : h("span", { class: "muted" }, c.mode === "all" ? "and" : "or"), pSel, oSel,
        needsVal ? (op === "between" ? [valIn(0), h("span", { class: "muted" }, "and"), valIn(1)] : valIn()) : null,
        h("button", { class: "iconbtn", disabled: dis, "aria-label": "Remove condition", onclick: () => { c.list.splice(j, 1); drawPane(); } }, "✕")));
    });
    const gfx = (role, label) => h("div", { class: "cellrow" }, h("span", { class: "lbl" }, label),
      h("input", { type: "color", disabled: dis, class: t[role].colour ? "set" : "inherit", value: t[role].colour || "#000000", "aria-label": `${label} colour`, oninput: e => { t[role].colour = e.target.value; e.target.className = "set"; } }),
      h("select", { disabled: dis, "aria-label": `${label} pen`, onchange: e => { t[role].pen = e.target.value || undefined; } }, h("option", { value: "" }, "pen"), penNames.map(p => h("option", { selected: p === t[role].pen }, p))),
      h("select", { disabled: dis, "aria-label": `${label} line type`, onchange: e => { t[role].lineType = e.target.value || undefined; } }, h("option", { value: "" }, "line type"), Object.keys(LINE_TYPES).map(p => h("option", { selected: p === t[role].lineType }, p))),
      t[role].colour ? h("button", { class: "iconbtn", disabled: dis, title: "No colour override", "aria-label": `Clear ${label} colour`, onclick: () => { delete t[role].colour; drawPane(); } }, "✕") : null);
    card.append(
      h("div", { class: "cellrow" },
        h("input", { type: "checkbox", disabled: dis, checked: rule.enabled !== false, title: "Enable filter", "aria-label": "Enable filter", onchange: e => { rule.enabled = e.target.checked; card.classList.toggle("off", !e.target.checked); } }),
        h("input", { type: "text", disabled: dis, value: rule.name || rule.id || "Filter", class: "rulename", "aria-label": "Filter name", oninput: e => { rule.name = e.target.value; } }),
        from ? h("span", { class: "chip" }, from) : null,
        h("label", {}, h("input", { type: "checkbox", disabled: dis, checked: t.visible !== false, onchange: e => { t.visible = e.target.checked ? undefined : false; } }), " visible"),
        h("label", {}, h("input", { type: "checkbox", disabled: dis, checked: !!t.halftone, onchange: e => { t.halftone = e.target.checked || undefined; } }), " halftone"),
        h("label", { title: "Later filters are not tested for what this one catches" }, h("input", { type: "checkbox", disabled: dis, checked: !!rule.stop, onchange: e => { rule.stop = e.target.checked || undefined; } }), " stop"),
        h("span", { class: "grow" }),
        h("button", { class: "iconbtn", disabled: dis || i === 0, "aria-label": "Move filter up", title: "Higher priority", onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); drawPane(); } }, "↑"),
        h("button", { class: "iconbtn", disabled: dis, "aria-label": "Delete filter", onclick: () => { list.splice(i, 1); drawPane(); } }, "✕")),
      h("div", { class: "cellrow" }, h("span", { class: "muted" }, "Elements matching"),
        h("select", { disabled: dis, "aria-label": "Match all or any", onchange: e => { const l = c.list; rule.when = e.target.value === "all" ? { all: l } : { any: l }; drawPane(); } }, h("option", { value: "all", selected: c.mode === "all" }, "all (AND)"), h("option", { value: "any", selected: c.mode === "any" }, "any (OR)")),
        h("span", { class: "muted" }, "of:")),
      condBox,
      h("div", {}, h("button", { class: "btn small", disabled: dis, onclick: () => { c.list.push({ param: "Category", is: Object.keys(doc.lib.categories)[0] }); drawPane(); } }, "+ Condition")),
      h("div", { class: "gfx" }, gfx("projection", "Projection lines"), gfx("cut", "Cut lines"),
        h("div", { class: "cellrow" }, h("span", { class: "lbl" }, "Cut pattern"),
          h("input", { type: "color", disabled: dis, class: t.cut.fill ? "set" : "inherit", value: t.cut.fill || "#cccccc", "aria-label": "Cut fill colour", oninput: e => { t.cut.fill = e.target.value; t.fill = e.target.value; e.target.className = "set"; } }),
          h("select", { disabled: dis, "aria-label": "Cut hatch pattern", onchange: e => { t.cut.pattern = e.target.value || undefined; } }, h("option", { value: "" }, "hatch"), ["solid", "none", ...patNames].map(p => h("option", { selected: p === t.cut.pattern }, p))),
          t.cut.fill ? h("button", { class: "iconbtn", disabled: dis, "aria-label": "Clear cut fill", onclick: () => { delete t.cut.fill; delete t.fill; drawPane(); } }, "✕") : null)));
    return card;
  };
  const filtersPane = () => {
    const wrap = h("div", {});
    wrap.append(h("div", { class: "muted small" }, "A filter picks elements by their attributes (category, type, any parameter, what they measure) and changes how they draw. Filters are tested top to bottom; each adds its graphics over the last unless one is set to stop."));
    if (!styleMode && (baseStyle.rules || []).length) {
      wrap.append(h("h4", {}, `From the view style ${styleName}`));
      // the style's filters, one line each: they are the style's to change
      for (const r of baseStyle.rules) {
        const c = conditionsOf(clone(r)), t = r.then || {};
        const cond = c.list.map(w => { const op = Object.keys(w).find(k => k !== "param"); return `${w.param} ${OP_LABEL[op] || op}${op === "defined" || op === "undefined" ? "" : " " + showFilterValue((specs[w.param] || {}).kind, w[op])}`; }).join(c.mode === "all" ? " and " : " or ");
        const fx = [t.visible === false ? "hidden" : null, t.halftone ? "halftone" : null, ...["projection", "cut"].filter(k => t[k] && Object.keys(t[k]).length).map(k => `${k} ${Object.values(t[k]).join(" ")}`), t.fill ? `fill ${t.fill}` : null].filter(Boolean).join(", ");
        wrap.append(h("div", { class: "rulesum" + (r.enabled === false ? " off" : "") }, h("b", {}, r.name || r.id), h("span", {}, ` where ${cond || "anything"}`), h("span", { class: "muted" }, ` → ${fx || "no change"}`)));
      }
    }
    const locked = !styleMode && inc.filters;
    wrap.append(h("h4", {}, styleMode ? "The style's filters" : "This view's filters"));
    if (locked) wrap.append(lockNote(`Filters are set by the view style ${styleName}.`, editStyle));
    ownRules.forEach((r, i) => wrap.append(ruleCard(r, ownRules, i, locked, null)));
    if (!locked) {
      const add = (rule) => { ownRules.push(rule); drawPane(); };
      let n = ownRules.length + 1; while (ownRules.some(r => r.id === "FL-" + n)) n++;
      wrap.append(h("div", { class: "cellrow" },
        h("button", { class: "btn small", onclick: () => add({ id: "FL-" + n, name: "New filter", when: { all: [{ param: "Category", is: "IfcWall" }] }, then: { projection: {}, cut: {} } }) }, "+ Filter"),
        h("button", { class: "btn small ghost", onclick: () => add({ id: "FL-" + n, name: "Existing halftone", when: { all: [{ param: "Phase", is: "Existing" }] }, then: { halftone: true } }) }, "+ Halftone existing"),
        h("button", { class: "btn small ghost", onclick: () => add({ id: "FL-" + n, name: "Fire walls red", when: { all: [{ param: "Category", is: "IfcWall" }, { param: "FireRating", defined: true }] }, then: { cut: { colour: "#d0312d", pen: "heavy" }, projection: { colour: "#d0312d" } } }) }, "+ Fire rating"),
        h("button", { class: "btn small ghost", onclick: () => add({ id: "FL-" + n, name: "Short walls", when: { all: [{ param: "Category", is: "IfcWall" }, { param: "Length", lt: 2000 }] }, then: { cut: { colour: "#2f6fd6" }, projection: { colour: "#2f6fd6" } } }) }, "+ Length less than")));
    }
    return wrap;
  };
  // ---------------- view settings
  const viewPane = () => {
    const wrap = h("div", { class: "vsettings" });
    const row = (label, setting, ctl) => {
      const lk = !styleMode && v && setting && lockedBy(doc, v, setting);
      if (lk) [ctl, ...ctl.querySelectorAll("input,select,button")].forEach(x => { if ("disabled" in x) x.disabled = true; });
      wrap.append(h("div", { class: "prow" + (lk ? " locked" : "") }, h("label", {}, lk ? "🔒 " : "", label), h("div", { class: "val" }, ctl, lk ? h("div", { class: "under" }, `set by the view style ${lk}`) : null)));
    };
    if (styleMode) { wrap.append(h("div", { class: "muted small" }, "The style's view settings, and whether each is included (pushed to and locked in every view using it), are in the View Style editor."), h("button", { class: "btn small", onclick: editStyle }, "Open View Style editor…")); }
    if (!styleMode && v) {
      const setV = (key, value) => app.apply({ op: "set", id: viewId, key, value });
      row("View style", null, app.styleSelect ? app.styleSelect(viewId, "") : h("span", {}, styleName));
      row("View scale", "scale", h("select", { "aria-label": "View scale", onchange: e => setV("scale", Number(e.target.value)) }, [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 1250, 2500].map(sc => h("option", { value: sc, selected: F.int(v, "scale") === sc }, "1 : " + sc))));
      if (doc.declOf(v).args.some(a => a.key === "detailLevel")) row("Detail level", "detailLevel", h("select", { "aria-label": "Detail level", onchange: e => setV("detailLevel", e.target.value) }, ["Coarse", "Medium", "Fine"].map(d => h("option", { selected: F.choice(v, "detailLevel") === d }, d))));
      if (vt === "PlanView") {
        const vr = Object.assign({ top: 2300, cut: 1200, bottom: 0 }, doc.argValue(v, "viewRange") || {}); if (vr.depth === undefined) vr.depth = vr.bottom;
        const g = h("div", { class: "vrange", style: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 6px" } });
        for (const [k, lab] of [["top", "Top"], ["cut", "Cut plane"], ["bottom", "Bottom"], ["depth", "View depth"]]) {
          const inp = h("input", { type: "text", value: fmtLen(vr[k]), "aria-label": `View range ${lab}` });
          inp.addEventListener("change", () => { let x; try { x = parseLength(inp.value); } catch (e) { inp.classList.add("bad"); return; } const nx = Object.assign({}, vr, { [k]: x }); if (!(nx.top >= nx.cut && nx.cut >= nx.bottom && nx.bottom >= nx.depth)) { inp.classList.add("bad"); inp.title = "keep top ≥ cut ≥ bottom ≥ depth"; return; } setV("viewRange", nx); });
          g.append(h("span", { class: "muted" }, lab), inp);
        }
        row("View range", "viewRange", g);
      }
      if (vt === "ElevationView" || vt === "SectionView") {
        const inp = h("input", { type: "text", value: fmtLen(F.real(v, "depth")), "aria-label": "Far clip offset" });
        inp.addEventListener("change", () => { try { setV("depth", parseLength(inp.value)); } catch (e) { inp.classList.add("bad"); } });
        row("Far clip offset", "farClip", inp);
      }
      if (vt === "View3D") row("Visual style", "visualStyle", h("select", { "aria-label": "Visual style", onchange: e => setV("visualStyle", e.target.value) }, ["Wireframe", "Hidden Line", "Shaded", "Consistent Colors", "Sheet Line-work"].map(s => h("option", { selected: (F.choice(v, "visualStyle") || "Shaded") === s }, s))));
    }
    // display model and sketchy lines: the view's own (in vg) unless the style includes them
    const eff = key => target[key] !== undefined ? target[key] : baseStyle[key];
    const dm = h("select", { "aria-label": "Display model", onchange: e => { target.displayModel = e.target.value; touched.add("displayModel"); } }, ["Normal", "Halftone", "Do not display"].map(x => h("option", { selected: (eff("displayModel") || "Normal") === x }, x)));
    if (!styleMode && inc.displayModel) dm.disabled = true;
    wrap.append(h("div", { class: "prow" + (!styleMode && inc.displayModel ? " locked" : "") }, h("label", {}, !styleMode && inc.displayModel ? "🔒 " : "", "Display model"), h("div", { class: "val" }, dm, h("div", { class: "under" }, "Halftone: the model as an underlay, so what is drawn over it reads first"))));
    const sk = Object.assign({ extension: 0, jitter: 0 }, eff("sketchy") || {}), skLock = !styleMode && inc.sketchy;
    const skIn = (k, max, step) => h("input", { type: "range", min: 0, max, step, value: sk[k], disabled: skLock, "aria-label": `Sketchy ${k}`, oninput: e => { sk[k] = Number(e.target.value); target.sketchy = sk.extension || sk.jitter ? Object.assign({}, sk) : null; touched.add("sketchy"); e.target.nextSibling.textContent = `${sk[k]} mm`; } });
    wrap.append(h("div", { class: "prow" + (skLock ? " locked" : "") }, h("label", {}, skLock ? "🔒 " : "", "Sketchy lines"), h("div", { class: "val" },
      h("div", { class: "cellrow" }, h("span", { class: "lbl" }, "Extension"), skIn("extension", 4, 0.25), h("span", { class: "muted" }, `${sk.extension} mm`)),
      h("div", { class: "cellrow" }, h("span", { class: "lbl" }, "Jitter"), skIn("jitter", 1.5, 0.05), h("span", { class: "muted" }, `${sk.jitter} mm`)),
      h("div", { class: "under" }, "Hand-drawn line-work on screen, on sheets and in the PDF (paper mm)"))));
    return wrap;
  };
  // ---------------- graphic scheme
  const schemePane = () => {
    const locked = !styleMode && inc.scheme;
    const wrap = h("div", {});
    if (locked) wrap.append(lockNote(`The graphic scheme is set by the view style ${styleName}.`, editStyle));
    wrap.append(h("div", { class: "muted small" }, "A scheme sets a whole drawing's look at once, as a palette does in Illustrator or InDesign: the ink lines take, the poché of what is cut, the paper, how far halftone fades, a line-weight scale, and the accent colour filters pick things out in."));
    const cur = target.scheme !== undefined ? target.scheme : styleMode ? baseStyle.scheme : null;
    const inherited = !styleMode && target.scheme === undefined ? baseStyle.scheme : null;
    const shown = cur !== null && cur !== undefined ? cur : inherited;
    const curId = cur && typeof cur === "object" ? cur.base : cur;
    const effId = shown && typeof shown === "object" ? shown.base : shown;
    const choose = x => { if (locked) return; target.scheme = x; touched.add("scheme"); drawPane(); };
    const cards = h("div", { class: "schemes" });
    if (!styleMode) cards.append(h("button", { class: "scheme" + (target.scheme === undefined ? " on" : ""), disabled: locked, onclick: () => { delete target.scheme; touched.add("scheme"); drawPane(); } }, h("div", { class: "sw", style: { background: "repeating-linear-gradient(45deg,#eee 0 6px,#fff 6px 12px)" } }), h("b", {}, "By style"), h("span", { class: "muted" }, SCHEMES[inherited] ? SCHEMES[inherited].name : "Technical")));
    for (const [id, sc] of Object.entries(SCHEMES)) {
      const bg = sc.background || "#ffffff", ink = sc.ink || "#000000", po = sc.poche || "#000000", ac = sc.accent || ink;
      cards.append(h("button", { class: "scheme" + (curId === id ? " on" : ""), disabled: locked, onclick: () => choose(id), "aria-label": `Scheme ${sc.name}` },
        h("div", { class: "sw", style: { background: bg } },
          h("i", { style: { background: po, left: "10%", top: "22%", width: "44%", height: "18%" } }),
          h("i", { style: { background: ink, left: "10%", top: "58%", width: "80%", height: `${Math.max(1, 2 * (sc.weight || 1))}px` } }),
          h("i", { style: { background: mixColour(ink, bg, sc.halftone ?? 0.5), left: "10%", top: "72%", width: "60%", height: "1px" } }),
          h("i", { style: { background: ac, left: "64%", top: "22%", width: "26%", height: "18%", borderRadius: "50%" } })),
        h("b", {}, sc.name)));
    }
    wrap.append(cards);
    // customise: the preset becomes this style's (or view's) own palette
    const obj = cur && typeof cur === "object" ? cur : null, shownObj = shown && typeof shown === "object" ? shown : null;
    const eff = Object.assign({ background: "#ffffff", ink: "#000000", poche: "#000000", accent: "#000000", weight: 1, halftone: 0.5 }, SCHEMES[effId] || {}, shownObj || {});
    const tweak = (k, x) => { if (locked) return; const o = obj ? obj : Object.assign({ base: effId || "Technical" }, shownObj || {}); o[k] = x; target.scheme = o; touched.add("scheme"); };
    const col = (k, label) => h("label", { class: "cellrow" }, h("span", { class: "lbl" }, label), h("input", { type: "color", disabled: locked, value: eff[k], "aria-label": `Scheme ${label}`, oninput: e => tweak(k, e.target.value) }));
    const rng = (k, label, min, max, step) => h("label", { class: "cellrow" }, h("span", { class: "lbl" }, label), h("input", { type: "range", disabled: locked, min, max, step, value: eff[k], "aria-label": `Scheme ${label}`, oninput: e => { tweak(k, Number(e.target.value)); e.target.nextSibling.textContent = e.target.value; } }), h("span", { class: "muted" }, String(eff[k])));
    wrap.append(h("h4", {}, "Customise", obj ? h("span", { class: "chip" }, "custom") : ""),
      h("div", { class: "schemeedit" }, col("background", "Paper"), col("ink", "Ink"), col("poche", "Poché"), col("accent", "Accent"),
        rng("weight", "Line weight ×", 0.4, 1.8, 0.05), rng("halftone", "Halftone fade", 0.2, 0.9, 0.05)),
      obj ? h("button", { class: "btn small ghost", disabled: locked, onclick: () => choose(obj.base || "Technical") }, "Back to the preset") : "");
    return wrap;
  };
  // ---------------- pens
  const pens = clone(doc.lib.pens["PEN-ISO"]);
  let pensTouched = false;
  const pensPane = () => h("div", {}, h("div", { class: "muted small" }, "The pen set is the file's: a weight here changes every view. Colour carries no plotting meaning."),
    h("table", {}, h("tbody", {}, Object.entries(pens.pens).map(([n, p]) => h("tr", {}, h("td", {}, n), h("td", {}, h("input", { type: "number", step: "0.01", min: "0", value: p.weight, style: { width: "80px" }, "aria-label": `${n} weight`, oninput: e => { p.weight = Number(e.target.value); pensTouched = true; } })), h("td", { class: "muted" }, "mm on paper"))))));
  const drawPane = () => {
    clear(pane);
    pane.append(tab === "model" ? catRows(false) : tab === "annotation" ? catRows(true) : tab === "filters" ? filtersPane() : tab === "view" ? viewPane() : tab === "scheme" ? schemePane() : pensPane());
  };
  drawTabs(); drawPane();
  body.append(head, tabsBar, pane);
  // what goes back: the style (only the parts this dialog owns, over the style as it now is) or the view's vg
  const makeOps = () => {
    const ops = [];
    if (styleMode) {
      const fresh = clone(doc.lib.viewStyles[styleId] || {});
      fresh.byCategory = target.byCategory; fresh.rules = target.rules;
      for (const k of touched) { if (target[k] === undefined) delete fresh[k]; else fresh[k] = target[k]; }
      ops.push({ op: "style", id: styleId, value: fresh });
    } else if (v) ops.push({ op: "set", id: viewId, key: "vg", value: prune(target) });
    if (pensTouched) ops.push({ op: "type", lib: "pens", id: "PEN-ISO", value: pens });
    return ops;
  };
  const orig = styleMode ? [{ op: "style", id: styleId, value: clone(baseStyle) }] : v ? [{ op: "set", id: viewId, key: "vg", value: clone(doc.argValue(v, "vg") || {}) }] : [];
  orig.push({ op: "type", lib: "pens", id: "PEN-ISO", value: clone(doc.lib.pens["PEN-ISO"]) });
  const live = liveEdit(app, body, makeOps);
  body.prepend(live.status);
  const title = styleMode ? `Visibility/Graphics — style ${styleName}` : `Visibility/Graphics — ${v ? v.get("Name") : ""}`;
  const d = dialog(title, body, [
    { label: "Revert", run: () => { live.revert(orig); vvDialog(app, viewId, Object.assign({}, opts, { tab })); } },
    { label: "Close", primary: true, run: () => true }], { modeless: true });
  d.el.classList.add("wide");
  d.onClose = live.done;
  return d;
}
/** A view's vg without empty leftovers, so "no override" stays no override. */
function prune(vg) {
  const out = clone(vg);
  for (const [k, o] of Object.entries(out.byCategory || {})) { for (const r of ["projection", "cut"]) if (o[r] && !Object.keys(o[r]).length) delete o[r]; if (!Object.keys(o).length) delete out.byCategory[k]; }
  if (out.byCategory && !Object.keys(out.byCategory).length) delete out.byCategory;
  if (out.filters && !out.filters.length) delete out.filters;
  return out;
}
function mixColour(a, b, t) { try { return mix(a, b, t); } catch (e) { return a; } }

// ---------------------------------------------------------------- View Style editor (Revit's View Templates)
//! The file's styles on the left; on the right each setting a style can hold, its value, and Include:
//! an included setting is pushed to every view using the style and locked there. The V/G rows open
//! Visibility/Graphics on the style itself.
export function viewStyleEditor(app, styleId, viewId) {
  const doc = app.doc;
  let cur = styleId && doc.lib.viewStyles[styleId] ? styleId : Object.keys(doc.lib.viewStyles)[0];
  let patch = {};
  const body = h("div", { class: "vstyle" });
  const list = h("div", { class: "vslist", role: "listbox", "aria-label": "View styles" });
  const right = h("div", { class: "vsright" });
  const users = id => doc.elements().filter(f => doc.declOf(f) && doc.declOf(f).kind === "view" && F.refId(f, "style") === id);
  const newId = base => { let n = 1; while (doc.lib.viewStyles[base + "-" + n]) n++; return base + "-" + n; };
  const drawList = () => {
    clear(list);
    for (const [id, st] of Object.entries(doc.lib.viewStyles)) list.append(h("button", { role: "option", "aria-selected": String(id === cur), class: "vsitem" + (id === cur ? " on" : ""), onclick: () => { cur = id; patch = {}; drawList(); drawRight(); } }, st.name || id, h("span", { class: "muted" }, ` · ${users(id).length}`)));
    list.append(h("div", { class: "cellrow", style: { marginTop: "8px", flexWrap: "wrap" } },
      h("button", { class: "btn small", onclick: () => { const id = newId("VS"); app.apply({ op: "style", id, value: blankStyle("New style " + id.split("-").pop()) }); cur = id; patch = {}; drawList(); drawRight(); } }, "New"),
      h("button", { class: "btn small", onclick: () => { const src = clone(doc.lib.viewStyles[cur]); const id = newId(cur); src.name = (src.name || cur) + " copy"; app.apply({ op: "style", id, value: src }); cur = id; patch = {}; drawList(); drawRight(); } }, "Duplicate"),
      h("button", { class: "btn small", disabled: Object.keys(doc.lib.viewStyles).length < 2, onclick: e => {
        // two presses, no browser prompt: the first says what will happen
        const b = e.currentTarget, u = users(cur).length;
        if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = u ? `Delete? ${u} view(s) lose their style` : "Delete? press again"; b.classList.add("danger"); return; }
        app.apply({ op: "style", id: cur, remove: true }); cur = Object.keys(doc.lib.viewStyles)[0]; patch = {}; drawList(); drawRight(); } }, "Delete")));
  };
  const drawRight = () => {
    clear(right);
    const st = doc.lib.viewStyles[cur]; if (!st) return;
    const local = Object.assign(clone(st), clone(patch));
    local.include = local.include || {}; local.settings = Object.assign({ scale: 100, detailLevel: "Fine", viewRange: { top: 2300, cut: 1200, bottom: 0, depth: 0 }, visualStyle: "Shaded", farClip: 15000 }, local.settings || {});
    const set = (k, x) => { local[k] = x; patch[k] = clone(x); };
    const setS = (k, x) => { local.settings[k] = x; set("settings", local.settings); };
    const inc = (k) => h("input", { type: "checkbox", checked: !!local.include[k], "aria-label": `Include ${k}`, title: "Include: push this to every view using the style, and lock it there", onchange: e => { local.include[k] = e.target.checked; set("include", local.include); } });
    const tb = h("tbody");
    const row = (k, label, ctl) => tb.append(h("tr", { class: local.include[k] ? "incl" : "" }, h("td", {}, label), h("td", {}, ctl), h("td", { class: "c" }, inc(k))));
    const len = (val, cb, lab) => { const i = h("input", { type: "text", value: fmtLen(val), "aria-label": lab, style: { width: "92px" } }); i.addEventListener("change", () => { try { cb(parseLength(i.value)); i.classList.remove("bad"); } catch (e) { i.classList.add("bad"); } }); return i; };
    row("scale", "View scale", h("select", { "aria-label": "Style view scale", onchange: e => setS("scale", Number(e.target.value)) }, [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].map(s => h("option", { value: s, selected: local.settings.scale === s }, "1 : " + s))));
    row("detailLevel", "Detail level", h("select", { "aria-label": "Style detail level", onchange: e => setS("detailLevel", e.target.value) }, ["Coarse", "Medium", "Fine"].map(s => h("option", { selected: local.settings.detailLevel === s }, s))));
    const vr = Object.assign({ depth: 0 }, local.settings.viewRange);
    row("viewRange", "View range (plans)", h("div", { class: "vrange", style: { display: "grid", gridTemplateColumns: "auto auto", gap: "2px 6px" } },
      [["top", "Top"], ["cut", "Cut plane"], ["bottom", "Bottom"], ["depth", "View depth"]].flatMap(([k, lab]) => [h("span", { class: "muted" }, lab), len(vr[k], x => { vr[k] = x; setS("viewRange", Object.assign({}, vr)); }, `Style view range ${lab}`)])));
    row("farClip", "Far clipping (sections, elevations)", len(local.settings.farClip, x => setS("farClip", x), "Style far clip"));
    row("visualStyle", "Visual style (3D)", h("select", { "aria-label": "Style visual style", onchange: e => setS("visualStyle", e.target.value) }, ["Wireframe", "Hidden Line", "Shaded", "Consistent Colors", "Sheet Line-work"].map(s => h("option", { selected: local.settings.visualStyle === s }, s))));
    row("displayModel", "Display model", h("select", { "aria-label": "Style display model", onchange: e => set("displayModel", e.target.value) }, ["Normal", "Halftone", "Do not display"].map(s => h("option", { selected: (local.displayModel || "Normal") === s }, s))));
    const sk = Object.assign({ extension: 0, jitter: 0 }, local.sketchy || {});
    const skn = (k, max, step) => h("input", { type: "number", min: 0, max, step, value: sk[k], style: { width: "64px" }, "aria-label": `Style sketchy ${k}`, onchange: e => { sk[k] = Number(e.target.value) || 0; set("sketchy", sk.extension || sk.jitter ? Object.assign({}, sk) : null); } });
    row("sketchy", "Sketchy lines", h("div", { class: "cellrow" }, "ext", skn("extension", 4, 0.25), "jitter", skn("jitter", 1.5, 0.05), h("span", { class: "muted" }, "paper mm")));
    const openVV = t => () => { flush(); vvDialog(app, viewId, { styleId: cur, tab: t }); };
    row("modelVG", "V/G overrides: model", h("button", { class: "btn small", onclick: openVV("model") }, `Edit… (${Object.keys(local.byCategory || {}).filter(k => !isAnnotationCategory(k)).length})`));
    row("annotationVG", "V/G overrides: annotation", h("button", { class: "btn small", onclick: openVV("annotation") }, `Edit… (${Object.keys(local.byCategory || {}).filter(k => isAnnotationCategory(k)).length})`));
    row("filters", "V/G overrides: filters", h("button", { class: "btn small", onclick: openVV("filters") }, `Edit… (${(local.rules || []).length})`));
    const schId = local.scheme && typeof local.scheme === "object" ? local.scheme.base : local.scheme;
    row("scheme", "Graphic scheme", h("div", { class: "cellrow" }, h("select", { "aria-label": "Style graphic scheme", onchange: e => set("scheme", e.target.value) }, Object.entries(SCHEMES).map(([k, s]) => h("option", { value: k, selected: schId === k }, s.name + (k === schId && typeof local.scheme === "object" ? " (custom)" : "")))), h("button", { class: "btn small", onclick: openVV("scheme") }, "Edit…")));
    const u = users(cur);
    right.append(
      h("div", { class: "cellrow" }, h("input", { type: "text", class: "rulename", value: local.name || cur, "aria-label": "Style name", onchange: e => { set("name", e.target.value); } }), h("span", { class: "chip" }, cur)),
      h("div", { class: "muted small" }, u.length ? `Used by ${u.length} view${u.length === 1 ? "" : "s"}: ${u.map(f => f.get("Name")).join(", ")}` : "Not used by any view yet."),
      h("table", { class: "vstable" }, h("thead", {}, h("tr", {}, h("th", {}, "Parameter"), h("th", {}, "Value"), h("th", { class: "c" }, "Include"))), tb),
      h("div", { class: "muted small" }, "Included settings are pushed to every view using this style and locked there (Properties, the view bar and Visibility/Graphics). What is not included stays each view's own."),
      viewId && doc.element(viewId) ? h("div", { class: "cellrow" }, h("button", { class: "btn small", disabled: F.refId(doc.element(viewId), "style") === cur, onclick: () => { app.apply({ op: "set", id: viewId, key: "style", value: { ref: cur } }); drawList(); drawRight(); } }, `Assign to ${doc.element(viewId).get("Name")}`)) : null);
  };
  const makeOps = () => {
    if (!doc.lib.viewStyles[cur] || !Object.keys(patch).length) return [];
    const fresh = Object.assign(clone(doc.lib.viewStyles[cur]), clone(patch)); patch = {};
    return [{ op: "style", id: cur, value: fresh }];
  };
  const live = liveEdit(app, right, makeOps);
  const flush = () => { const ops = makeOps(); if (ops.length) app.apply(ops, { quiet: true }); };
  drawList(); drawRight();
  body.append(live.status, h("div", { class: "vsgrid" }, list, right));
  const d = dialog("View Styles", body, [{ label: "Close", primary: true, run: () => { flush(); return true; } }], { modeless: true });
  d.el.classList.add("wide");
  d.onClose = () => { live.done(); };
  return d;
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
      const ops = makeOps(); if (Array.isArray(ops) && !ops.length) return;
      const r = app.apply(ops, { quiet: true, coalesce: key });
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

/** An import's DXF layers: shown or hidden, and each one's colour - the layers the file came with. */
function importLayers(app, f) {
  const doc = app.doc, id = doc.idOf(f), d = JSON.parse(JSON.stringify(doc.argValue(f, "drawing") || {}));
  const count = {}; for (const e of d.elements || []) count[e.layer || "0"] = (count[e.layer || "0"] || 0) + 1;
  const set = () => app.apply({ op: "set", id, key: "drawing", value: d });
  const rows = (d.layers || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(L => h("tr", {},
    h("td", {}, h("input", { type: "checkbox", checked: L.on !== false, "aria-label": `Show layer ${L.name}`, onchange: e => { L.on = e.target.checked; set(); } })),
    h("td", {}, h("input", { type: "color", value: L.colour || "#000000", "aria-label": `Colour of layer ${L.name}`, onchange: e => { L.colour = e.target.value; set(); } })),
    h("td", { class: "mono" }, L.name), h("td", { class: "muted" }, String(count[L.name] || 0))));
  return h("section", { class: "pgrid-group" }, h("div", { class: "pgrid-head" }, "DXF layers"),
    h("table", { class: "layers", style: { width: "100%", fontSize: "12px" } }, h("tbody", {}, rows)));
}

// ---------------------------------------------------------------- Materials (Revit's Material Browser, the drawing side)
//! A material is what a layer is made of: its Mark (what a material tag or keynote shows), how it draws
//! where it is cut and where its surface is seen, and the colour it renders. Walls and floors take a
//! material per layer in Edit Type; columns and beams take one. Changes redraw every view.
export function materialsEditor(app, materialId) {
  const doc = app.doc;
  let cur = materialId && doc.lib.materials[materialId] ? materialId : Object.keys(doc.lib.materials)[0];
  let patch = null;
  const body = h("div", { class: "vstyle" }), list = h("div", { class: "vslist", role: "listbox", "aria-label": "Materials" }), right = h("div", { class: "vsright" });
  const usedBy = id => Object.entries(doc.lib.types).filter(([, t]) => t.material === id || (t.layers || []).some(L => L.material === id)).map(([k, t]) => t.name || k);
  const pens = Object.keys((doc.lib.pens["PEN-ISO"] || {}).pens || {}), pats = Object.entries(doc.lib.patterns || {});
  const newId = () => { let n = 1; while (doc.lib.materials["M-NEW" + n]) n++; return "M-NEW" + n; };
  const swatch = m => h("span", { class: "mswatch", style: { background: ((m.cut || {}).background) || "#fff", borderColor: ((m.cut || {}).lineColour) || "#333" } });
  const drawList = () => {
    clear(list);
    for (const [id, m] of Object.entries(doc.lib.materials)) list.append(h("button", { role: "option", "aria-selected": String(id === cur), class: "vsitem" + (id === cur ? " on" : ""), onclick: () => { flush(); cur = id; drawList(); drawRight(); } }, swatch(m), " ", m.name || id, h("span", { class: "muted mono" }, ` ${m.mark || ""}`)));
    list.append(h("div", { class: "cellrow", style: { marginTop: "8px" } },
      h("button", { class: "btn small", onclick: () => { flush(); const id = newId(); app.apply({ op: "type", lib: "materials", id, value: { name: "New material", mark: "", description: "", cut: { pen: "thin", lineColour: "#1b1f24", pattern: null, background: "#ffffff" }, projection: { pen: "thin", lineColour: "#1b1f24" }, shading: { colour: "#c8c8c8" } } }); cur = id; drawList(); drawRight(); } }, "New"),
      h("button", { class: "btn small", onclick: () => { flush(); const id = newId(), m = clone(doc.lib.materials[cur]); m.name = (m.name || cur) + " copy"; app.apply({ op: "type", lib: "materials", id, value: m }); cur = id; drawList(); drawRight(); } }, "Duplicate"),
      h("button", { class: "btn small", disabled: usedBy(cur).length > 0, title: usedBy(cur).length ? "In use by a type: take it off the layers first" : "Delete this material", onclick: () => { app.apply({ op: "type", lib: "materials", id: cur, remove: true }); cur = Object.keys(doc.lib.materials)[0]; drawList(); drawRight(); } }, "Delete")));
  };
  const preview = h("canvas", { class: "matprev", width: 220, height: 110, "aria-label": "Material preview: cut and surface" });
  const drawPreview = m => {
    const g = preview.getContext("2d"), W = 220, H = 110; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    const box = (x0, y0, x1, y1) => polyPathLocal([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    const prims = [];
    for (const [k, x0, label] of [["cut", 2, "Cut"], ["projection", 58, "Surface"]]) {
      const gg = m[k] || {}, path = box(x0, 6, x0 + 50, 50), pat = gg.pattern && doc.lib.patterns[gg.pattern];
      if (gg.background) prims.push({ t: "fill", path, colour: gg.background });
      if (pat) prims.push({ t: "hatch", path, pattern: Object.assign({ id: gg.pattern }, pat), scale: pat.kind === "model" ? 1 / 20 : 1, colour: gg.lineColour || "#333", weight: 0.13 });
      prims.push({ t: "stroke", path, weight: penWeight(doc, gg.pen || "thin", 20) || 0.2, colour: gg.lineColour || "#000" });
      prims.push({ t: "text", at: [x0, 1], text: label, height: 3, colour: "#555" });
    }
    drawScene(g, { prims }, { x: 0, y: 0, z: 2, W, H, dpr: 1 });
  };
  const drawRight = () => {
    clear(right);
    const m = clone(doc.lib.materials[cur]); if (!m) return;
    m.cut = m.cut || {}; m.projection = m.projection || {}; m.shading = m.shading || {};
    patch = m;
    const txt = (obj, k, label) => h("label", { class: "cellrow" }, h("span", { class: "lbl" }, label), h("input", { type: "text", value: obj[k] || "", "aria-label": `Material ${label}`, style: { flex: 1 }, oninput: e => { obj[k] = e.target.value; } }));
    const col = (obj, k, label) => h("label", { class: "cellrow" }, h("span", { class: "lbl" }, label), h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(obj[k] || "") ? obj[k] : "#ffffff", "aria-label": `Material ${label}`, oninput: e => { obj[k] = e.target.value; drawPreview(m); } }));
    const sel = (obj, k, label, opts) => h("label", { class: "cellrow" }, h("span", { class: "lbl" }, label), h("select", { "aria-label": `Material ${label}`, onchange: e => { obj[k] = e.target.value || null; drawPreview(m); } }, opts.map(([v, l]) => h("option", { value: v, selected: (obj[k] || "") === v }, l))));
    const patOpts = [["", "none"], ...pats.map(([id, p]) => [id, p.name || id])], penOpts = pens.map(p => [p, p]);
    const u = usedBy(cur);
    right.append(
      h("h4", {}, "Identity"), txt(m, "name", "Name"), txt(m, "mark", "Mark"), txt(m, "description", "Description"),
      h("div", { class: "muted small" }, "The Mark is what a material tag or keynote shows."),
      h("div", { class: "matgrid" },
        h("div", {}, h("h4", {}, "Cut (sections and plans)"), sel(m.cut, "pen", "Line pen", penOpts), col(m.cut, "lineColour", "Line colour"), sel(m.cut, "pattern", "Pattern", patOpts), col(m.cut, "background", "Background")),
        h("div", {}, h("h4", {}, "Surface (projection)"), sel(m.projection, "pen", "Line pen", penOpts), col(m.projection, "lineColour", "Line colour"), sel(m.projection, "pattern", "Pattern", patOpts), col(m.projection, "background", "Background")),
        h("div", {}, h("h4", {}, "Appearance (3D)"), col(m.shading, "colour", "Render colour"), preview)),
      h("div", { class: "muted small" }, u.length ? `Used by ${u.length} type${u.length === 1 ? "" : "s"}: ${u.join(", ")}` : "Not used by any type yet: set it on a layer in Edit Type."),
      h("div", { class: "muted small" }, "In Visibility/Graphics each category chooses whether a component's material wins over the view's graphics (the default), the view wins, or materials are ignored."));
    drawPreview(m);
  };
  const makeOps = () => patch && doc.lib.materials[cur] ? [{ op: "type", lib: "materials", id: cur, value: patch }] : [];
  const live = liveEdit(app, right, makeOps);
  const flush = () => { const ops = makeOps(); if (ops.length && JSON.stringify(ops[0].value) !== JSON.stringify(doc.lib.materials[cur])) app.apply(ops, { quiet: true }); };
  drawList(); drawRight();
  body.append(live.status, h("div", { class: "vsgrid" }, list, right));
  const d = dialog("Materials", body, [{ label: "Close", primary: true, run: () => { flush(); return true; } }], { modeless: true });
  d.el.classList.add("wide");
  d.onClose = () => { live.done(); drawList(); };
  return d;
}
function polyPathLocal(pts) { return pts.map((p, i) => ({ k: "L", a: p, b: pts[(i + 1) % pts.length] })); }

/** A site boundary's edges: each sketch element of the plot, its length, its setback and its zoning plane. */
function siteEdges(app, f) {
  const doc = app.doc, id = doc.idOf(f), sk = doc.argValue(f, "sketch") || { elements: [] }, edges = JSON.parse(JSON.stringify(doc.argValue(f, "edges") || {})), dflt = F.real(f, "setback") || 0;
  const set = () => app.apply({ op: "set", id, key: "edges", value: edges });
  const lenOf = el => el.type === "line" ? Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]) : el.type === "arc" ? Math.abs(el.a1 - el.a0) * el.r : null;
  const num = (el, k, label, isLen) => { const e = edges[el.id] || {}, v = e[k]; return h("input", { type: "text", value: v === undefined ? "" : isLen ? fmtLen(v) : String(v), placeholder: k === "setback" ? fmtLen(dflt) : k === "angle" ? "90" : "0", style: { width: "70px" }, "aria-label": `Edge ${el.id} ${label}`,
    onchange: ev => { const t = ev.target.value.trim(); edges[el.id] = Object.assign({}, edges[el.id]); if (!t) delete edges[el.id][k]; else { try { edges[el.id][k] = isLen ? parseLength(t) : parseNumber(t); } catch (er) { ev.target.value = ""; return; } } set(); } }); };
  const rows = sk.elements.map((el, i) => h("tr", {}, h("td", { class: "mono" }, `${i + 1}`), h("td", {}, el.type), h("td", { class: "muted" }, lenOf(el) ? fmtLen(Math.round(lenOf(el))) : "–"),
    h("td", {}, num(el, "setback", "setback", true)), h("td", {}, num(el, "height", "zoning height", true)), h("td", {}, num(el, "angle", "zoning angle", false))));
  return h("section", { class: "pgrid-group" }, h("div", { class: "pgrid-head" }, "Site edges - setback and zoning plane"),
    h("div", { class: "muted", style: { fontSize: "11.5px", padding: "4px 8px" } }, "Each edge is a vertical plane limiting the site. Setback: the buildable line. Zoning: a plane rising from the edge at a height, at an angle over the site (90° = vertical)."),
    h("table", { class: "layers", style: { width: "100%", fontSize: "12px" } }, h("thead", {}, h("tr", {}, ["#", "Edge", "Length", "Setback", "Zone h", "Angle°"].map(x => h("th", {}, x)))), h("tbody", {}, rows)));
}
