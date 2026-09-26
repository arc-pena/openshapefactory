//! The schedule view and Revit's Schedule Properties dialog (Fields, Filter, Sorting/Grouping, Formatting,
//! Appearance), and the New Schedule dialog. Everything shown comes from scheduleTable(); everything
//! changed is an ordinary edit of the Schedule element's arguments - one undo step per OK.

import { h, clear, dialog, saveFile } from "./ui_util.js";
import { F, clone } from "./ocaf.js";
import { specsFor } from "./props.js";
import { SCHEDULE_CATEGORIES, SCHEDULE_KINDS, categoryName } from "./bim.js";
import { scheduleTable, scheduleCSV, scheduleSettings, availableFields, prettyField, findInSchedule, failText, defaultFields, scheduledElements, fieldValue,
  FILTER_OPS, FOOTER_MODES, TOTAL_MODES, CALC_KINDS, APPEARANCE_DEFAULT } from "./schedules.js";

const TABS = ["Fields", "Filter", "Sorting/Grouping", "Formatting", "Appearance"];

// ---------------------------------------------------------------- the view
export function renderSchedule(app, root, v) {
  clear(root);
  const doc = app.doc, id = doc.idOf(v), T = scheduleTable(doc, v), S = T.settings, A = S.appearance;
  const pane = h("div", { class: "sheetpane" }), card = h("div", { class: "doccard" });
  const tabBtn = (t, extra) => h("button", { class: "btn small", onclick: () => scheduleProperties(app, id, t) }, t + (extra ? ` (${extra})` : ""));
  const nSort = S.sort.filter(s => s && s.field).length, nFilt = S.filters.filter(r => r && r.field).length;
  card.append(h("header", {},
    h("h2", {}, v.get("Name")),
    h("span", { class: "muted" }, `${categoryName(S.cat)} · ${S.kind} · ${T.excluded.size ? `${T.total - T.excluded.size} of ${T.total}` : T.total} ${T.total === 1 ? "element" : "elements"}${S.itemize ? "" : ` in ${T.rows.filter(r => r.kind === "merged").length} rows`} · editing a cell edits the model`),
    S.cat === "IfcSpace" ? h("span", { class: "chip" }, "areas to the boundary each space states") : null));
  card.append(h("div", { class: "schedbar", role: "toolbar", "aria-label": "Schedule tools" },
    h("span", { class: "muted small" }, "Properties:"), tabBtn("Fields", String(S.fields.length)), tabBtn("Filter", nFilt ? String(nFilt) : ""), tabBtn("Sorting/Grouping", nSort ? String(nSort) : ""), tabBtn("Formatting"), tabBtn("Appearance"),
    h("span", { class: "sep" }),
    h("button", { class: "btn small", title: "Select the elements of the chosen rows in a model view", onclick: () => highlightInModel(app) }, "Highlight in Model"),
    h("button", { class: "btn small", onclick: () => exportCSV(app, T) }, "Export CSV"),
    h("button", { class: "btn small", onclick: () => duplicateSchedule(app, id) }, "Duplicate")));
  if (nFilt || nSort) card.append(h("div", { class: "schedchips" },
    S.filters.filter(r => r && r.field).map((r, i) => h("button", { class: "chip", title: "Edit the filter", onclick: () => scheduleProperties(app, id, "Filter") }, `${i ? (S.filterAny ? "or " : "and ") : "where "}${prettyField(r.field)} ${r.op}${/value/.test(r.op) ? "" : " " + (r.value ?? "")}`)),
    S.sort.filter(s => s && s.field).map((s, i) => h("button", { class: "chip", title: "Edit sorting and grouping", onclick: () => scheduleProperties(app, id, "Sorting/Grouping") }, `${i ? "then" : "sort by"} ${prettyField(s.field)} ${s.desc ? "↓" : "↑"}${s.header || s.footer ? " · grouped" : ""}`))));
  for (const n of T.notes) card.append(h("div", { class: "under err" }, n));
  // what the filter leaves out is said, never silent: how many, and for a selected element, which rule
  if (T.excluded.size) {
    const clearF = () => app.apply({ op: "set", id, key: "filters", value: [] });
    card.append(h("div", { class: "schednote" }, `${T.excluded.size} ${T.excluded.size === 1 ? "element is" : "elements are"} left out by the filter.`,
      h("button", { class: "btn small", onclick: () => scheduleProperties(app, id, "Filter") }, "Edit filter"), h("button", { class: "btn small", onclick: clearF }, "Show all (clear filter)")));
    for (const sid of [...app.selection].filter(x => T.excluded.has(x)).slice(0, 3)) {
      const x = T.excluded.get(sid);
      card.append(h("div", { class: "schednote warn" }, `Selected ${sid} “${x.name}” is not listed: ${x.fails.map(failText).join("; ")}.`,
        ...x.fails.map(fl => h("button", { class: "btn small", onclick: () => { const fs = clone(S.filters); fs.splice(fl.rule, 1); app.apply({ op: "set", id, key: "filters", value: fs }); } }, `Remove the ${prettyField(fl.field)} rule`))));
    }
  }
  // material fields only have values in a material takeoff: say so rather than show empty columns
  if (S.kind !== "Material Takeoff" && S.fields.some(k => /^Material: /.test(k))) card.append(h("div", { class: "schednote warn" },
    `The Material columns are empty: this schedule's type is ${S.kind}, and material rows exist only in a Material Takeoff.`,
    h("button", { class: "btn small", onclick: () => app.apply({ op: "set", id, key: "kind", value: "Material Takeoff" }) }, "Make it a Material Takeoff")));
  // find any element: where it is in this schedule, or why it is not
  const found = h("div", { class: "schedfind", "aria-live": "polite" });
  const find = h("input", { type: "search", placeholder: "Find an element (name, mark or id)…", "aria-label": "Find an element in this schedule", value: app.schedFind || "",
    oninput: e => { app.schedFind = e.target.value; showFound(); } });
  const showFound = () => {
    clear(found);
    for (const r of findInSchedule(doc, T, find.value)) found.append(h("div", { class: "schednote" + (r.status === "shown" ? "" : " warn") },
      r.status === "shown" ? `${r.id} “${r.name}” is listed.` : r.status === "filtered" ? `${r.id} “${r.name}” is left out by the filter: ${r.fails.map(failText).join("; ")}.`
        : r.status === "other" ? `${r.id} “${r.name}” is a ${r.category.replace(/s$/, "").toLowerCase()}, not in ${categoryName(S.cat)}.` : `${r.id} “${r.name}” is not listed.`,
      r.status === "shown" ? h("button", { class: "btn small", onclick: () => { app.select([r.id]); const tr = root.querySelector(`tr[data-ids~="${r.id}"]`); if (tr) tr.scrollIntoView({ block: "center" }); } }, "Select row") : null,
      r.status === "filtered" ? r.fails.map(fl => h("button", { class: "btn small", onclick: () => { const fs = clone(S.filters); fs.splice(fl.rule, 1); app.apply({ op: "set", id, key: "filters", value: fs }); } }, `Remove the ${prettyField(fl.field)} rule`)) : null));
    if (find.value.trim() && !found.childNodes.length) found.append(h("div", { class: "schednote warn" }, `Nothing in the model is called “${find.value.trim()}”.`));
  };
  card.append(h("div", { class: "schedbar" }, find), found); showFound();
  const cols = T.visible.map(i => T.columns[i]);
  const table = h("table", { class: "sched" + (A.gridlines ? " grid" : "") + (A.stripes ? " stripes" : "") + (A.outline ? " outline" : "") });
  if (A.headers) {
    const thead = h("thead");
    if (cols.some(c => c.group)) {
      const tr = h("tr", { class: "grouphdr" });
      for (let i = 0; i < cols.length;) { let j = i; while (j + 1 < cols.length && cols[j + 1].group === cols[i].group) j++; tr.append(h("th", { colspan: j - i + 1, class: cols[i].group ? "g" : "" }, cols[i].group || "")); i = j + 1; }
      thead.append(tr);
    }
    const lead = S.sort.find(s => s && s.field);
    thead.append(h("tr", {}, cols.map(c => h("th", { class: c.align ? "a-" + c.align : "", title: `${c.key} - click to sort, right-click for more`,
      onclick: () => quickSort(app, id, c.key), oncontextmenu: e => { e.preventDefault(); headerMenu(app, id, c, e); } },
      c.heading, lead && lead.field === c.key ? h("span", { class: "sortmark" }, lead.desc ? " ▼" : " ▲") : null))));
    table.append(thead);
  }
  const tb = h("tbody");
  if (A.blankRow) tb.append(h("tr", { class: "blank" }, h("td", { colspan: cols.length || 1 })));
  for (const r of T.rows) {
    if (r.kind === "blank") { tb.append(h("tr", { class: "blank" }, h("td", { colspan: cols.length || 1 }))); continue; }
    if (r.kind === "header") { tb.append(h("tr", { class: "grouphead d" + r.depth, onclick: e => app.select(r.ids, e.shiftKey) }, h("td", { colspan: cols.length || 1 }, r.text))); continue; }
    const sel = r.ids && r.ids.length && r.ids.every(x => app.selection.has(x));
    const tr = h("tr", { class: [r.kind, sel ? "sel" : ""].join(" "), "data-ids": (r.ids || []).join(" "), onclick: e => { if (!/INPUT|SELECT|OPTION/.test(e.target.tagName)) app.select(r.ids || [], e.shiftKey || e.ctrlKey || e.metaKey); } });
    T.visible.forEach((i, n) => {
      const c = r.cells[i], col = T.columns[i];
      const td = (r.kind === "item" || r.kind === "merged") ? cellEditor(app, r, col, c) : h("td", {}, n === 0 && r.text && !c.text ? r.text : c.text || "");
      if (col.align) td.classList.add("a-" + col.align); else if (c.num != null) td.classList.add("a-right");
      if (c.fill) td.style.background = c.fill;
      tr.append(td);
    });
    tb.append(tr);
  }
  if (!T.rows.length) tb.append(h("tr", {}, h("td", { colspan: cols.length || 1, class: "muted" }, S.filters.length ? "No element passes the filter." : `No ${categoryName(S.cat).toLowerCase()} in the model yet.`)));
  table.append(tb);
  card.append(h("div", { class: "tablewrap" }, table));
  pane.append(card);
  root.append(pane);
}

/** A cell that edits the model: an instance value of one element - or of every element a grouped row stands
 *  for, as Revit does when "Itemize every instance" is off. Quantities, type values and calculated values read only. */
function cellEditor(app, r, col, c) {
  const doc = app.doc, f = r.f, ids = r.ids, key = col.key;
  const decl = doc.declOf(f), arg = decl && decl.args.find(a => a.key === key), spec = specsFor(doc, f)[key], d = doc.data(f);
  const shown = c.varies ? "" : c.text || "", ph = c.varies ? "<varies>" : "";
  const label = `${ids.length > 1 ? ids.length + " elements" : ids[0]} ${col.heading}`;
  const all = mk => { const r2 = app.apply(ids.map(mk)); if (!r2.ok) app.say(r2.error, "error"); };
  if (col.calc || /^Material: /.test(key) || ["Count", "Id", "Category", "Family", "Type", "Family and Type", "Level", "Sheet Number", "Sheet Name", "View Type", "Views on sheet"].includes(key) && !(key === "Name")) return h("td", { class: key === "Id" ? "id" : "" }, c.text || "");
  if (key === "Name") return h("td", {}, h("input", { type: "text", value: shown, placeholder: ph, "aria-label": label, onchange: e => all(x => ({ op: "rename", id: x, name: e.target.value })) }));
  if (arg && !(d && d.props && d.props[key] !== undefined)) {
    if ((arg.kind === "Real" || arg.kind === "Integer") && !(doc.argValue(f, key) && doc.argValue(f, key).ref)) return h("td", {}, h("input", { type: "text", value: shown, placeholder: ph, "aria-label": label, onchange: e => all(x => ({ op: "set", id: x, key, text: e.target.value })) }));
    if (arg.kind === "Choice") return h("td", {}, h("select", { "aria-label": label, onchange: e => all(x => ({ op: "set", id: x, key, value: e.target.value })) }, (c.varies ? [h("option", { value: "", selected: true, disabled: true }, "<varies>")] : []).concat(arg.options.map(o => h("option", { selected: !c.varies && o === c.text }, o)))));
    if (arg.kind === "Boolean") return h("td", {}, h("input", { type: "checkbox", checked: c.text === "Yes", "aria-label": label, onchange: e => all(x => ({ op: "set", id: x, key, value: e.target.checked })) }));
    if (arg.kind === "Text") return h("td", {}, h("input", { type: "text", value: shown, placeholder: ph, "aria-label": label, onchange: e => all(x => ({ op: "set", id: x, key, value: e.target.value })) }));
  }
  if (spec && spec.binding !== "type" && spec.kind === "Enum") return h("td", {}, h("select", { "aria-label": label, onchange: e => all(x => ({ op: "set", id: x, key: "params." + key, value: e.target.value })) },
    (c.varies ? [h("option", { value: "", selected: true, disabled: true }, "<varies>")] : []).concat(spec.values.map(o => h("option", { selected: !c.varies && String(o) === c.text }, o)))));
  if (spec && spec.binding !== "type" && spec.kind !== "Material") return h("td", {}, h("input", { type: "text", value: shown, placeholder: ph, "aria-label": label,
    onchange: e => { const t = e.target.value; all(x => ({ op: "set", id: x, key: "params." + key, value: spec.kind === "Length" || spec.kind === "Number" || spec.kind === "Integer" ? (t.trim() === "" ? "" : { expr: t, kind: spec.kind }) : t })); } }));
  return h("td", {}, c.text || "");
}

function quickSort(app, id, key) {
  const v = app.doc.element(id), sort = clone(scheduleSettings(app.doc, v).sort || []).filter(s => s && s.field);
  if (sort[0] && sort[0].field === key) sort[0].desc = !sort[0].desc; else sort.unshift({ field: key, desc: false });
  app.apply({ op: "set", id, key: "sort", value: sort.filter((s, i) => i === 0 || s.field !== key).slice(0, 4) });
}
function headerMenu(app, id, col, e) {
  document.querySelectorAll(".schedmenu").forEach(m => m.remove());
  const v = app.doc.element(id), S = scheduleSettings(app.doc, v);
  const setFmt = patch => { const fm = clone(S.format); fm[col.key] = Object.assign({}, fm[col.key] || {}, patch); app.apply({ op: "set", id, key: "format", value: fm }); };
  const items = [
    ["Sort ascending", () => app.apply({ op: "set", id, key: "sort", value: [{ field: col.key, desc: false }, ...S.sort.filter(s => s && s.field && s.field !== col.key)].slice(0, 4) })],
    ["Sort descending", () => app.apply({ op: "set", id, key: "sort", value: [{ field: col.key, desc: true }, ...S.sort.filter(s => s && s.field && s.field !== col.key)].slice(0, 4) })],
    ["Group by this (header + footer)", () => app.apply({ op: "set", id, key: "sort", value: [{ field: col.key, desc: false, header: true, footer: true, footerMode: FOOTER_MODES[0], blank: true }, ...S.sort.filter(s => s && s.field && s.field !== col.key)].slice(0, 4) })],
    ["Filter by this…", () => scheduleProperties(app, id, "Filter", { addFilter: col.key })],
    [col.total === "Calculate totals" ? "Stop totalling" : "Calculate totals", () => setFmt({ total: col.total === "Calculate totals" ? "None" : "Calculate totals" })],
    ["Hide column", () => setFmt({ hidden: true })],
    ["Unhide all columns", () => { const fm = clone(S.format); for (const k of Object.keys(fm)) if (fm[k]) fm[k].hidden = false; app.apply({ op: "set", id, key: "format", value: fm }); }],
    ["Remove field", () => app.apply({ op: "set", id, key: "fields", value: S.fields.filter(k => k !== col.key) })],
    ["Formatting…", () => scheduleProperties(app, id, "Formatting", { field: col.key })],
  ];
  const m = h("div", { class: "schedmenu", role: "menu", style: { left: e.clientX + "px", top: e.clientY + "px" } }, items.map(([t, run]) => h("button", { role: "menuitem", onclick: () => { m.remove(); run(); } }, t)));
  document.body.append(m);
  const off = ev => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("pointerdown", off, true); } };
  setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
  m.addEventListener("keydown", ev => { if (ev.key === "Escape") m.remove(); });
  m.querySelector("button").focus();
}
function highlightInModel(app) {
  const ids = [...app.selection].filter(x => app.doc.element(x));
  if (!ids.length) return app.say("click rows of the schedule first, then Highlight in Model", "note");
  app.revealInView(ids[0]); app.select(ids);
  app.say(`${ids.length} element${ids.length > 1 ? "s" : ""} highlighted`, "ok");
}
async function exportCSV(app, T) {
  const r = await saveFile(`${T.title.replace(/[^\w\- ]+/g, "_")}.csv`, scheduleCSV(T), "text/csv");
  app.say(r.ok ? `${T.title}.csv saved` : r.error, r.ok ? "ok" : "error");
}
function duplicateSchedule(app, id) {
  const doc = app.doc, src = doc.element(id), rec = clone(doc.elementJSON(src));
  let n = 1; while (doc.elements().some(f => f.get("Name") === `${src.get("Name")} Copy ${n}`)) n++;
  delete rec.id; rec.name = `${src.get("Name")} Copy ${n}`;
  const r = app.apply({ op: "add", element: rec }); if (r.ok) app.openView(r.id);
}

// ---------------------------------------------------------------- New Schedule
export function newScheduleDialog(app) {
  const doc = app.doc;
  const count = c => scheduledElements(doc, c).length;
  const search = h("input", { type: "search", placeholder: "filter categories", "aria-label": "Filter categories" });
  const list = h("select", { size: 14, "aria-label": "Category", style: { width: "100%" } });
  const fill = () => { const q = search.value.trim().toLowerCase(); const cur = list.value; clear(list);
    for (const c of SCHEDULE_CATEGORIES) { const nm = categoryName(c); if (q && !nm.toLowerCase().includes(q)) continue; list.append(h("option", { value: c, selected: c === (cur || "IfcWall") }, `${nm}${c === "Multi-Category" ? "" : `  (${count(c)})`}`)); } };
  fill(); search.addEventListener("input", fill);
  const name = h("input", { type: "text", "aria-label": "Name", value: "Walls Schedule" });
  let named = false; name.addEventListener("input", () => { named = true; });
  const kind = h("select", { "aria-label": "Schedule type" }, SCHEDULE_KINDS.map(k => h("option", {}, k)));
  const rename = () => { if (!named) name.value = `${categoryName(list.value).replace(/ \(.*\)$/, "")} ${kind.value === "Material Takeoff" ? "Material Takeoff" : list.value === "Sheet" ? "" : list.value === "View" ? "" : "Schedule"}`.replace(/\s+$/, "") + (list.value === "Sheet" ? "Sheet List" : list.value === "View" ? "View List" : ""); };
  list.addEventListener("change", rename); kind.addEventListener("change", rename); list.addEventListener("dblclick", () => { go(); dlg.close(); });
  const body = h("div", { class: "newsched" },
    h("label", {}, "Category"), h("div", {}, search, list),
    h("label", {}, "Name"), name,
    h("label", {}, "Type"), kind,
    h("div", { class: "muted small", style: { gridColumn: "1 / -1" } }, "Multi-Category lists every building element; Sheets and Views make a sheet list and a view list. The fields, filters and grouping come next."));
  const go = () => {
    const cat = list.value || "IfcWall", k = kind.value;
    const avail = new Set(availableFields(doc, cat, k).map(a => a.key)), fields = defaultFields(cat, k).filter(f => avail.has(f) || !count(cat));
    const r = app.apply({ op: "add", element: { type: "Schedule", name: name.value.trim() || categoryName(cat) + " Schedule", args: { of: cat, kind: k, fields } } });
    if (!r.ok) { app.say(r.error, "error"); return false; }
    app.openView(r.id); setTimeout(() => scheduleProperties(app, r.id, "Fields"), 0);
  };
  const dlg = dialog("New Schedule", body, [{ label: "Cancel", run: () => {} }, { label: "OK", primary: true, run: go }]);
  list.focus();
  return dlg;
}

// ---------------------------------------------------------------- Schedule Properties
export function scheduleProperties(app, id, tab = "Fields", opts = {}) {
  const doc = app.doc, v = doc.element(id); if (!v) return;
  const W = clone(scheduleSettings(doc, v));        // the working copy: nothing reaches the model until OK
  W.sort = [0, 1, 2, 3].map(i => Object.assign({ field: "", desc: false, header: false, footer: false, footerMode: FOOTER_MODES[0], blank: false }, W.sort[i] || {}));
  if (opts.addFilter) W.filters.push({ field: opts.addFilter, op: "equals", value: "" });
  let current = tab, selField = opts.field || W.fields[0] || "";
  const body = h("div", { class: "schedprops" }), tabs = h("div", { class: "vvtabs", role: "tablist" }), pane = h("div", { class: "tabpane" });
  const avail = () => availableFields(doc, W.cat, W.kind, W.calculated);
  const label = k => { const a = avail().find(x => x.key === k); return a ? a.label : prettyField(k); };
  const fieldSelect = (value, onch, { none = false, aria = "Field" } = {}) => h("select", { "aria-label": aria, onchange: e => onch(e.target.value) },
    (none ? [h("option", { value: "" }, "(none)")] : []).concat(W.fields.concat(avail().map(a => a.key).filter(k => !W.fields.includes(k))).map(k => h("option", { value: k, selected: k === value }, label(k) + (W.fields.includes(k) ? "" : "  (not in schedule)")))));
  const draw = () => {
    clear(tabs); clear(pane);
    TABS.forEach(t => tabs.append(h("button", { role: "tab", "aria-selected": String(t === current), class: "vvtab" + (t === current ? " on" : ""), onclick: () => { current = t; draw(); } }, t)));
    ({ Fields: fieldsTab, Filter: filterTab, "Sorting/Grouping": sortTab, Formatting: formatTab, Appearance: appearanceTab })[current]();
  };
  // ---- Fields
  function fieldsTab() {
    const cat = h("select", { "aria-label": "Category", onchange: e => { W.cat = e.target.value; draw(); } }, SCHEDULE_CATEGORIES.map(c => h("option", { value: c, selected: c === W.cat }, categoryName(c))));
    const kind = h("select", { "aria-label": "Schedule type", onchange: e => { W.kind = e.target.value; draw(); } }, SCHEDULE_KINDS.map(k => h("option", { selected: k === W.kind }, k)));
    const q = h("input", { type: "search", placeholder: "search fields", "aria-label": "Search available fields" });
    const left = h("select", { size: 16, multiple: true, "aria-label": "Available fields" }), right = h("select", { size: 16, multiple: true, "aria-label": "Scheduled fields (in order)" });
    const fillLeft = () => { clear(left); const s = q.value.trim().toLowerCase(), groups = new Map();
      for (const a of avail()) if (!W.fields.includes(a.key) && (!s || a.label.toLowerCase().includes(s) || a.key.toLowerCase().includes(s))) { if (!groups.has(a.group)) groups.set(a.group, []); groups.get(a.group).push(a); }
      for (const [g, as] of groups) left.append(h("optgroup", { label: g }, as.map(a => h("option", { value: a.key }, a.label)))); };
    const fillRight = () => { clear(right); W.fields.forEach(k => right.append(h("option", { value: k }, label(k) + (W.format[k] && W.format[k].hidden ? "  (hidden)" : "")))); };
    const picked = s => [...s.selectedOptions].map(o => o.value);
    const addF = () => { W.fields.push(...picked(left).filter(k => !W.fields.includes(k))); fillLeft(); fillRight(); };
    const remF = () => { const p = new Set(picked(right)); W.fields = W.fields.filter(k => !p.has(k)); fillLeft(); fillRight(); };
    const moveF = d => { const p = picked(right); if (p.length !== 1) return; const i = W.fields.indexOf(p[0]), j = i + d; if (j < 0 || j >= W.fields.length) return; [W.fields[i], W.fields[j]] = [W.fields[j], W.fields[i]]; fillRight(); right.value = p[0]; };
    q.addEventListener("input", fillLeft); left.addEventListener("dblclick", addF); right.addEventListener("dblclick", remF);
    fillLeft(); fillRight();
    // calculated values: a formula over other fields, or a percentage of one
    const cName = h("input", { type: "text", placeholder: "Name, e.g. Area per door", "aria-label": "Calculated value name" });
    const cType = h("select", { "aria-label": "Calculated value type" }, h("option", { value: "formula" }, "Formula"), h("option", { value: "percentage" }, "Percentage"));
    const cKind = h("select", { "aria-label": "Discipline type" }, CALC_KINDS.map(k => h("option", {}, k)));
    const cFormula = h("input", { type: "text", placeholder: "e.g. Length * Height or Width / 2", "aria-label": "Formula" });
    const cOf = h("select", { "aria-label": "Percentage of" }, avail().filter(a => a.group === "Quantities" || a.key === "Count").map(a => h("option", { value: a.key }, a.label)));
    const cBy = h("select", { "aria-label": "Percentage by" }, h("option", { value: "grand" }, "Grand total"), h("option", { value: "group" }, "First grouping"));
    const syncC = () => { cFormula.hidden = cKind.hidden = cType.value !== "formula"; cOf.hidden = cBy.hidden = cType.value === "formula"; };
    cType.addEventListener("change", syncC); syncC();
    const calcList = h("ul", { class: "calclist" });
    const fillCalc = () => { clear(calcList); for (const c of W.calculated) calcList.append(h("li", {}, h("b", {}, c.name), " = ", c.type === "percentage" ? `% of ${label(c.of)} by ${c.by === "group" ? "group" : "grand total"}` : `${c.formula} (${c.kind})`, " ",
      h("button", { class: "iconbtn", "aria-label": `Delete ${c.name}`, onclick: () => { W.calculated = W.calculated.filter(x => x !== c); W.fields = W.fields.filter(k => k !== c.name); fillCalc(); fillLeft(); fillRight(); } }, "✕"))); };
    fillCalc();
    const addCalc = () => { const n = cName.value.trim(); if (!n) return app.say("give the calculated value a name", "note"); if (avail().some(a => a.key === n && a.group !== "Calculated")) return app.say(`${n} is already a field`, "error");
      W.calculated = W.calculated.filter(c => c.name !== n).concat([cType.value === "formula" ? { name: n, type: "formula", formula: cFormula.value.trim() || "0", kind: cKind.value } : { name: n, type: "percentage", of: cOf.value, by: cBy.value }]);
      if (!W.fields.includes(n)) W.fields.push(n); cName.value = ""; cFormula.value = ""; fillCalc(); fillLeft(); fillRight(); };
    pane.append(
      h("div", { class: "row2" }, h("label", {}, "Category ", cat), h("label", {}, "Schedule type ", kind)),
      h("div", { class: "fieldpick" },
        h("div", {}, h("div", { class: "cap" }, "Available fields"), q, left),
        h("div", { class: "mid" }, h("button", { class: "btn small", onclick: addF, "aria-label": "Add field" }, "Add →"), h("button", { class: "btn small", onclick: remF, "aria-label": "Remove field" }, "← Remove")),
        h("div", {}, h("div", { class: "cap" }, "Scheduled fields (in order)"), right,
          h("div", { class: "row2" }, h("button", { class: "btn small", onclick: () => moveF(-1) }, "Move up"), h("button", { class: "btn small", onclick: () => moveF(1) }, "Move down")))),
      h("fieldset", {}, h("legend", {}, "Calculated value"), h("div", { class: "row2 wrap" }, cName, cType, cKind, cFormula, cOf, cBy, h("button", { class: "btn small", onclick: addCalc }, "Add")),
        h("div", { class: "muted small" }, "Formulas use field names without spaces (Length, Height, Area, Width…) and units: Area / (1 m * 1 m) gives square metres as a plain number."), calcList));
  }
  // ---- Filter
  function filterTab() {
    const rows = h("div", { class: "filterrows" });
    const fillRows = () => { clear(rows);
      W.filters.forEach((r, i) => {
        const valIn = h("input", { type: "text", value: r.value ?? "", "aria-label": `Filter ${i + 1} value`, list: `fv-${i}`, disabled: /value$/.test(r.op), oninput: e => { r.value = e.target.value; } });
        const dl = h("datalist", { id: `fv-${i}` }, [...new Set(scheduledElements(doc, W.cat).slice(0, 400).map(f => fieldValue(doc, { f }, r.field).text).filter(Boolean))].slice(0, 60).map(s => h("option", { value: s })));
        rows.append(h("div", { class: "frow" }, h("span", { class: "muted" }, i ? (W.filterAny ? "Or" : "And") : "Filter by"),
          fieldSelect(r.field, k => { r.field = k; fillRows(); }, { aria: `Filter ${i + 1} field` }),
          h("select", { "aria-label": `Filter ${i + 1} operator`, onchange: e => { r.op = e.target.value; fillRows(); } }, FILTER_OPS.map(o => h("option", { selected: o === r.op }, o))),
          valIn, dl, h("button", { class: "iconbtn", "aria-label": `Remove filter ${i + 1}`, onclick: () => { W.filters.splice(i, 1); fillRows(); } }, "✕")));
      });
      if (!W.filters.length) rows.append(h("div", { class: "muted" }, "No filter: every element of the category is listed."));
    };
    fillRows();
    pane.append(h("div", { class: "row2" }, h("label", {}, h("input", { type: "radio", name: "fany", checked: !W.filterAny, onchange: () => { W.filterAny = false; fillRows(); } }), " All rules (And)"),
      h("label", {}, h("input", { type: "radio", name: "fany", checked: W.filterAny, onchange: () => { W.filterAny = true; fillRows(); } }), " Any rule (Or)")),
      rows, h("button", { class: "btn small", disabled: W.filters.length >= 8, onclick: () => { W.filters.push({ field: W.fields[0] || "Count", op: "equals", value: "" }); fillRows(); } }, "+ Add filter"),
      h("div", { class: "muted small" }, "Numbers compare as numbers: lengths as typed (3 m, 3000), areas and volumes in the units the schedule shows. Text ignores case. Up to eight rules; a field need not be in the schedule."));
  }
  // ---- Sorting/Grouping
  function sortTab() {
    W.sort.forEach((s, i) => {
      const on = !!s.field;
      pane.append(h("fieldset", { class: "sortlevel" }, h("legend", {}, i ? "Then by" : "Sort by"),
        h("div", { class: "row2 wrap" }, fieldSelect(s.field, k => { s.field = k; draw(); }, { none: true, aria: `${i ? "Then by" : "Sort by"} field` }),
          h("label", {}, h("input", { type: "radio", name: "sd" + i, checked: !s.desc, disabled: !on, onchange: () => { s.desc = false; } }), " Ascending"),
          h("label", {}, h("input", { type: "radio", name: "sd" + i, checked: !!s.desc, disabled: !on, onchange: () => { s.desc = true; } }), " Descending")),
        h("div", { class: "row2 wrap" },
          h("label", {}, h("input", { type: "checkbox", checked: !!s.header, disabled: !on, onchange: e => { s.header = e.target.checked; } }), " Header"),
          h("label", {}, h("input", { type: "checkbox", checked: !!s.footer, disabled: !on, onchange: e => { s.footer = e.target.checked; } }), " Footer:"),
          h("select", { disabled: !on, "aria-label": "Footer contents", onchange: e => { s.footerMode = e.target.value; } }, FOOTER_MODES.map(m => h("option", { selected: m === s.footerMode }, m))),
          h("label", {}, h("input", { type: "checkbox", checked: !!s.blank, disabled: !on, onchange: e => { s.blank = e.target.checked; } }), " Blank line"))));
    });
    const G = W.grandTotals;
    pane.append(h("fieldset", {}, h("legend", {}, "Totals"),
      h("div", { class: "row2 wrap" }, h("label", {}, h("input", { type: "checkbox", checked: !!G.on, onchange: e => { G.on = e.target.checked; } }), " Grand totals:"),
        h("select", { "aria-label": "Grand totals contents", onchange: e => { G.mode = e.target.value; } }, FOOTER_MODES.map(m => h("option", { selected: m === G.mode }, m))),
        h("label", {}, "Custom grand total title ", h("input", { type: "text", value: G.title || "Grand total", "aria-label": "Grand total title", oninput: e => { G.title = e.target.value; } }))),
      h("label", {}, h("input", { type: "checkbox", checked: W.itemize, onchange: e => { W.itemize = e.target.checked; } }), " Itemize every instance"),
      h("div", { class: "muted small" }, "Off: elements with the same sort values share one row, with a count; totalled fields add up, others show where every element agrees.")));
  }
  // ---- Formatting
  function formatTab() {
    if (!W.fields.includes(selField)) selField = W.fields[0] || "";
    const list = h("select", { size: 14, "aria-label": "Fields", onchange: e => { selField = e.target.value; draw(); } }, W.fields.map(k => h("option", { value: k, selected: k === selField }, label(k))));
    const fm = W.format[selField] = Object.assign({}, W.format[selField] || {});
    const cond = h("div", {});
    const fillCond = () => { clear(cond); (fm.conditional = fm.conditional || []).forEach((r, i) => cond.append(h("div", { class: "frow" },
      h("select", { "aria-label": `Rule ${i + 1} operator`, onchange: e => { r.op = e.target.value; } }, FILTER_OPS.map(o => h("option", { selected: o === r.op }, o))),
      h("input", { type: "text", value: r.value ?? "", "aria-label": `Rule ${i + 1} value`, oninput: e => { r.value = e.target.value; } }),
      h("input", { type: "color", value: r.fill || "#fff3b0", "aria-label": `Rule ${i + 1} colour`, oninput: e => { r.fill = e.target.value; } }),
      h("button", { class: "iconbtn", "aria-label": `Remove rule ${i + 1}`, onclick: () => { fm.conditional.splice(i, 1); fillCond(); } }, "✕")))); };
    fillCond();
    pane.append(h("div", { class: "fmtgrid" }, h("div", {}, h("div", { class: "cap" }, "Fields"), list),
      selField ? h("div", { class: "fmtform" },
        h("label", {}, "Heading ", h("input", { type: "text", value: fm.heading || prettyField(selField), "aria-label": "Heading", oninput: e => { fm.heading = e.target.value; } })),
        h("label", {}, "Group header ", h("input", { type: "text", value: fm.group || "", placeholder: "shared by neighbouring columns", "aria-label": "Group header", oninput: e => { fm.group = e.target.value; } })),
        h("label", {}, "Alignment ", h("select", { "aria-label": "Alignment", onchange: e => { fm.align = e.target.value; } }, [["", "Automatic"], ["left", "Left"], ["center", "Center"], ["right", "Right"]].map(([v2, t]) => h("option", { value: v2, selected: (fm.align || "") === v2 }, t)))),
        h("label", {}, h("input", { type: "checkbox", checked: !!fm.hidden, onchange: e => { fm.hidden = e.target.checked; } }), " Hidden field"),
        h("label", {}, "Totals ", h("select", { "aria-label": "Totals", onchange: e => { fm.total = e.target.value; } }, TOTAL_MODES.map(m => h("option", { selected: m === (fm.total || (selField === "Count" ? "Calculate totals" : "None")) }, m)))),
        h("fieldset", {}, h("legend", {}, "Conditional formatting"), cond, h("button", { class: "btn small", onclick: () => { fm.conditional.push({ op: "is greater than", value: "", fill: "#fff3b0" }); fillCond(); } }, "+ Add rule"),
          h("div", { class: "muted small" }, "The first rule a cell passes shades it - in the view, on sheets and in print."))) : h("div", { class: "muted" }, "Add fields first.")));
  }
  // ---- Appearance
  function appearanceTab() {
    const A = W.appearance = Object.assign({}, APPEARANCE_DEFAULT, W.appearance);
    const cb = (k, t) => h("label", { class: "blk" }, h("input", { type: "checkbox", checked: !!A[k], onchange: e => { A[k] = e.target.checked; } }), " " + t);
    pane.append(h("fieldset", {}, h("legend", {}, "Graphics"), cb("gridlines", "Grid lines"), cb("outline", "Outline"), cb("stripes", "Stripe rows"), cb("blankRow", "Blank row before data")),
      h("fieldset", {}, h("legend", {}, "Text"), cb("title", "Show title"), cb("headers", "Show headers")));
  }
  body.append(tabs, pane);
  draw();
  const ok = () => {
    const S0 = scheduleSettings(doc, v), sort = W.sort.filter(s => s.field);
    const next = { of: W.cat, kind: W.kind, fields: W.fields, filters: W.filters.filter(r => r.field), filterAny: W.filterAny, sort, itemize: W.itemize, grandTotals: W.grandTotals, format: W.format, appearance: W.appearance, calculated: W.calculated };
    const prev = { of: S0.cat, kind: S0.kind, fields: S0.fields, filters: S0.filters, filterAny: S0.filterAny, sort: S0.sort, itemize: S0.itemize, grandTotals: S0.grandTotals, format: S0.format, appearance: S0.appearance, calculated: S0.calculated };
    const ops = Object.keys(next).filter(k => JSON.stringify(next[k]) !== JSON.stringify(prev[k])).map(k => ({ op: "set", id, key: k, value: next[k] }));
    if (!ops.length) return;
    const r = app.apply(ops); if (!r.ok) { app.say(r.error, "error"); return false; }
    app.say(`Schedule updated: ${ops.map(o => o.key).join(", ")}`, "ok");
  };
  return dialog(`Schedule Properties - ${v.get("Name")}`, body, [{ label: "Cancel", run: () => {} }, { label: "OK", primary: true, run: ok }]);
}
