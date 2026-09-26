//! Schedules - Revit's Schedule/Quantities, Material Takeoff, Sheet List and View List - as one engine.
//! A Schedule element holds only settings (category, fields, filters, sorting/grouping, formatting,
//! appearance, calculated values); scheduleTable() turns them into rows. The schedule view, the drawing
//! placed on a sheet and the CSV export all read that one table, so what is filtered, grouped or totalled
//! in one can never disagree with another.

import { F, propertyOf, displayParam } from "./ocaf.js";
import { formatValue, parse, evaluate } from "./expr.js";
import { fmtArea, parseLength } from "./units.js";
import { categoryOf } from "./styles.js";
import { specsFor, TYPE_KEYS } from "./props.js";
import { categoryName } from "./bim.js";

/** A parameter's text as the panel shows it. */
export function paramText(doc, f, k) {
  if (k === "Name") return f.get("Name");
  if (k === "Area") { const d = doc.data(f); return d && d.props && d.props.Area ? fmtArea(d.props.Area.v, (doc.meta && doc.meta.displayUnits) || "mm") : "—"; }
  const p = doc.getParam(f, k); if (p !== undefined) return displayParam(doc, f, p);
  const v = propertyOf(doc, f, k); return v && !v.error ? formatValue(v) : "";
}

// ---------------------------------------------------------------- what can be scheduled
/** Categories a Multi-Category schedule leaves out: views, sheets, datums and annotation are not building. */
const NOT_BUILDING = new Set(["View", "Sheet", "Annotation", "Parameter", "IfcGrid", "IfcBuildingStorey", "Detail", "Site", "Unknown"]);

/** Revit's filter operators, by name (stored as written, so a saved filter reads the same everywhere). */
export const FILTER_OPS = ["equals", "does not equal", "is greater than", "is greater than or equal to", "is less than", "is less than or equal to",
  "contains", "does not contain", "begins with", "does not begin with", "ends with", "does not end with", "has a value", "has no value"];
export const FOOTER_MODES = ["Title, count, and totals", "Title and totals", "Count and totals", "Totals only"];
export const TOTAL_MODES = ["None", "Calculate totals", "Calculate minimum", "Calculate maximum", "Calculate minimum and maximum"];
export const CALC_KINDS = ["Number", "Length", "Area", "Volume", "Angle", "Text"];
export const APPEARANCE_DEFAULT = { title: true, headers: true, gridlines: true, outline: true, stripes: false, blankRow: false };

/** Fields a new schedule of a category starts with - what an architect asks of that schedule first. */
export function defaultFields(cat, kind = "Schedule/Quantities") {
  if (kind === "Material Takeoff") return ["Family and Type", "Material: Name", "Material: Area", "Material: Volume"];
  return ({
    IfcWall: ["Family and Type", "TypeMark", "Level", "Length", "Height", "Area", "Volume", "FireRating"],
    IfcDoor: ["Mark", "Level", "Family and Type", "Width", "Height", "FireRating", "Swing"],
    IfcWindow: ["Mark", "Level", "Family and Type", "Width", "Height", "Sill height"],
    IfcSpace: ["Number", "Name", "Level", "Department", "Area", "Perimeter"],
    IfcSlab: ["Family and Type", "Level", "Area", "Thickness", "Volume"],
    IfcColumn: ["Family and Type", "Level", "Height", "Volume", "Count"],
    IfcBeam: ["Family and Type", "Level", "Length", "Volume", "Count"],
    "Multi-Category": ["Category", "Family and Type", "Level", "Count"],
    Sheet: ["Sheet Number", "Sheet Name", "Current Revision", "Sheet Size"],
    View: ["Name", "View Type", "Scale", "Sheet Number", "Sheet Name"],
  })[cat] || ["Family and Type", "Level", "Count"];
}

/** The elements a category schedules (Multi-Category: every building element). */
export function scheduledElements(doc, cat) {
  return doc.elements().filter(f => {
    const t = doc.typeOf(f), c = categoryOf(doc, f);
    if (cat === "Sheet") return t === "Sheet";
    if (cat === "View") return ["PlanView", "ElevationView", "SectionView", "View3D", "Schedule"].includes(t);
    if (cat === "Multi-Category") return !NOT_BUILDING.has(c) && !(doc.declOf(f) || {}).category?.startsWith("View");
    return c === cat && !(doc.declOf(f) || {}).category?.startsWith("View");
  });
}

const SPECIAL = {
  element: ["Count", "Category", "Family", "Type", "Family and Type", "Level", "Id", "Name"],
  Sheet: ["Sheet Number", "Sheet Name", "Current Revision", "Sheet Size", "Views on sheet"],
  View: ["View Type", "Scale", "Detail Level", "Sheet Number", "Sheet Name", "Associated Level"],
  material: ["Material: Name", "Material: Mark", "Material: Function", "Material: Thickness", "Material: Area", "Material: Volume"],
};
const SCALAR = new Set(["Real", "Integer", "Text", "Choice", "Boolean", "Reference"]);
/** "FireRating" → "Fire Rating", "Sill height" stays. */
export const prettyField = k => String(k).replace(/([a-z])([A-Z])/g, "$1 $2");

/** Every field a category can schedule: Revit's "Available fields" - the element's own, its type's, its
 *  quantities, and the schedule's calculated values - each { key, label, group }. */
export function availableFields(doc, cat, kind = "Schedule/Quantities", calculated = []) {
  F.doc = doc;
  const out = new Map(), add = (key, group, label) => { if (!out.has(key)) out.set(key, { key, group, label: label || prettyField(key) }); };
  if (cat === "Sheet") { SPECIAL.Sheet.forEach(k => add(k, "Sheet")); add("Name", "Sheet"); }
  else if (cat === "View") { add("Name", "View"); SPECIAL.View.forEach(k => add(k, "View")); }
  else SPECIAL.element.forEach(k => add(k, "Element"));
  if (kind === "Material Takeoff") SPECIAL.material.forEach(k => add(k, "Material"));
  const els = scheduledElements(doc, cat);
  for (const f of els) {
    const d = doc.data(f);
    for (const k of Object.keys((d && d.props) || {})) add(k, "Quantities");
    for (const [k, s] of Object.entries(specsFor(doc, f))) add(k, s.binding === "type" ? "Type" : (s.group || "Identity Data"));
    const decl = doc.declOf(f);
    for (const a of (decl && decl.args) || []) if (SCALAR.has(a.kind) && !TYPE_KEYS.includes(a.key) && !["pinned", "view", "style"].includes(a.key)) add(a.key, "Instance", a.label);
    if (TYPE_KEYS.some(k => F.refId(f, k))) add("TypeMark", "Type", "Type Mark");
  }
  if (!els.length) for (const [k, s] of Object.entries(doc.lib.paramSpecs || {})) if (s.categories && (s.categories.includes("*") || s.categories.includes(cat))) add(k, s.binding === "type" ? "Type" : (s.group || "Identity Data"));
  for (const c of calculated || []) add(c.name, "Calculated");
  return [...out.values()];
}

// ---------------------------------------------------------------- a cell's value
const typeOfEl = (doc, f) => { for (const k of TYPE_KEYS) { const id = F.refId(f, k); if (id) return doc.resolveType(id); } return null; };
const levelOf = (doc, f) => { for (const k of ["level", "baseLevel"]) { const id = F.refId(f, k), g = id && doc.element(id); if (g) return g.get("Name"); } return ""; };
const txt = s => ({ text: s == null ? "" : String(s), num: null, kind: "Text" });
const qty = p => p && !p.error ? { text: formatValue(p), num: typeof p.v === "number" ? p.v : null, kind: p.kind } : txt("");
function sheetsOf(doc, viewId) {
  return doc.elements().filter(s => doc.typeOf(s) === "Sheet" && (doc.argValue(s, "viewports") || []).some(vp => vp.view && vp.view.ref === viewId));
}
/** One field of one scheduled item: { text, num (in document units, or null), kind }. */
export function fieldValue(doc, item, key) {
  const f = item.f, t = doc.typeOf(f);
  switch (key) {
    case "Count": return { text: "1", num: 1, kind: "Number" };
    case "Id": return txt(doc.idOf(f));
    case "Name": return txt(f.get("Name"));
    case "Category": return txt(categoryName(categoryOf(doc, f)));
    case "Level": return txt(levelOf(doc, f));
    case "Family": { const ty = typeOfEl(doc, f); return txt(ty ? (ty.chain[0] && ty.chain[0].name) || "" : t); }
    case "Type": { const ty = typeOfEl(doc, f); return txt(ty ? ty.name || ty.id : ""); }
    case "Family and Type": { const ty = typeOfEl(doc, f); return txt(ty ? `${(ty.chain[0] && ty.chain[0].name) || t}: ${ty.name || ty.id}` : t); }
    case "Sheet Number": return txt(t === "Sheet" ? F.text(f, "number") : sheetsOf(doc, doc.idOf(f)).map(s => F.text(s, "number")).join(", "));
    case "Sheet Name": return txt(t === "Sheet" ? F.text(f, "sheetName") : sheetsOf(doc, doc.idOf(f)).map(s => F.text(s, "sheetName")).join(", "));
    case "Current Revision": return txt(F.text(f, "revision"));
    case "Sheet Size": return txt(doc.argValue(f, "size"));
    case "Views on sheet": { const n = (doc.argValue(f, "viewports") || []).length; return { text: String(n), num: n, kind: "Number" }; }
    case "View Type": return txt({ PlanView: "Floor Plan", ElevationView: "Elevation", SectionView: "Section", View3D: "3D View", Schedule: "Schedule" }[t] || t);
    case "Scale": { const s = doc.declOf(f).args.some(a => a.key === "scale") ? F.int(f, "scale") : null; return s ? { text: "1 : " + s, num: s, kind: "Number" } : txt(""); }
    case "Detail Level": return txt(doc.declOf(f).args.some(a => a.key === "detailLevel") ? doc.argValue(f, "detailLevel") : "");
    case "Associated Level": return txt(levelOf(doc, f));
  }
  if (key.startsWith("Material: ")) {
    const m = item.mat; if (!m) return txt("");
    const k = key.slice(10);
    if (k === "Name") return txt(m.name); if (k === "Mark") return txt(m.mark); if (k === "Function") return txt(m.function);
    if (k === "Thickness") return qty({ kind: "Length", v: m.thickness }); if (k === "Area") return qty({ kind: "Area", v: m.area }); if (k === "Volume") return qty({ kind: "Volume", v: m.volume });
  }
  const decl = doc.declOf(f), a = decl && decl.args.find(x => x.key === key), d = doc.data(f);
  if (a && !(d && d.props && d.props[key] !== undefined)) {
    if (a.kind === "Reference") { const v = doc.argValue(f, key), g = v && v.ref && doc.element(v.ref); return txt(g ? g.get("Name") : v && v.ref ? v.ref : ""); }
    if (a.kind === "Boolean") return txt(F.bool(f, key) ? "Yes" : "No");
  }
  const p = propertyOf(doc, f, key);
  if (p && !p.error && typeof p.v === "number") return { text: paramText(doc, f, key), num: p.v, kind: p.kind };
  const s = paramText(doc, f, key);
  return { text: s === "—" ? "" : s, num: null, kind: (p && p.kind) || "Text" };
}

// ---------------------------------------------------------------- the rows before filtering: elements, or element × material
function materialItems(doc, f) {
  const ty = typeOfEl(doc, f), d = doc.data(f), props = (d && d.props) || {}, lib = doc.lib.materials || {};
  const mat = (key, extra) => { const m = lib[key] || {}; return Object.assign({ name: m.name || key || "<By Category>", mark: m.mark || "" }, extra); };
  const area = props.Area ? props.Area.v : 0, vol = props.Volume ? props.Volume.v : 0;
  if (ty && Array.isArray(ty.layers) && ty.layers.length) {
    const total = ty.layers.reduce((s, L) => s + (L.thickness || 0), 0) || 1;
    // a layer's share of the element: its area (each face of a wall or floor) and its thickness' share of the volume
    return ty.layers.filter(L => L.thickness > 0).map(L => ({ f, mat: mat(L.material, { function: L.function || "", thickness: L.thickness, area, volume: vol ? vol * L.thickness / total : area * L.thickness }) }));
  }
  const key = (ty && ty.material) || ((doc.declOf(f) || { args: [] }).args.some(a => a.key === "material") ? doc.argValue(f, "material") : null) || null;
  return [{ f, mat: mat(key, { function: "", thickness: 0, area, volume: vol }) }];
}

// ---------------------------------------------------------------- settings
/** A Schedule's settings, with every default filled in (older files have only `of` and `fields`). */
export function scheduleSettings(doc, v) {
  const arg = (k, def) => { const x = (doc.declOf(v).args.some(a => a.key === k)) ? doc.argValue(v, k) : undefined; return x == null ? def : x; };
  return {
    cat: arg("of", "IfcWall"), kind: arg("kind", "Schedule/Quantities"), fields: arg("fields", []) || [],
    filters: arg("filters", []) || [], filterAny: !!arg("filterAny", false),
    sort: arg("sort", []) || [], itemize: arg("itemize", true) !== false,
    grandTotals: Object.assign({ on: false, mode: "Title, count, and totals", title: "Grand total" }, arg("grandTotals", {}) || {}),
    format: arg("format", {}) || {}, appearance: Object.assign({}, APPEARANCE_DEFAULT, arg("appearance", {}) || {}),
    calculated: arg("calculated", []) || [],
  };
}

// ---------------------------------------------------------------- filtering
const numOf = s => { const m = /-?\d+(?:\.\d+)?(?:e-?\d+)?/i.exec(String(s).replace(/,/g, "")); return m ? Number(m[0]) : null; };
/** Does a cell pass one filter rule? Numbers compare as numbers (a length typed as "3 m" or "3000"; areas and
 *  volumes in the units the schedule shows them); text compares without regard to case. */
export function passes(cell, op, value) {
  const t = String(cell.text || "").trim(), low = t.toLowerCase(), v = String(value ?? "").trim(), vl = v.toLowerCase();
  if (op === "has a value") return t !== "";
  if (op === "has no value") return t === "";
  let a = null, b = null;
  if (cell.kind === "Length" && cell.num != null) { try { b = parseLength(v); a = cell.num; } catch (e) { /* not a length: compare as text */ } }
  if (a === null) { a = cell.num != null ? numOf(t) : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; b = numOf(v); if (!/\d/.test(v)) b = null; }
  const numeric = a !== null && b !== null;
  const eq = numeric ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) : low === vl;
  switch (op) {
    case "equals": return eq;
    case "does not equal": return !eq;
    case "is greater than": return numeric ? a > b + 1e-9 : low > vl;
    case "is greater than or equal to": return numeric ? a >= b - 1e-9 : low >= vl;
    case "is less than": return numeric ? a < b - 1e-9 : low < vl;
    case "is less than or equal to": return numeric ? a <= b + 1e-9 : low <= vl;
    case "contains": return low.includes(vl);
    case "does not contain": return !low.includes(vl);
    case "begins with": return low.startsWith(vl);
    case "does not begin with": return !low.startsWith(vl);
    case "ends with": return low.endsWith(vl);
    case "does not end with": return !low.endsWith(vl);
  }
  return true;
}

// ---------------------------------------------------------------- the table
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const cmpCells = (x, y) => x.num != null && y.num != null ? x.num - y.num : collator.compare(x.text || "", y.text || "");
function aggregate(cells, mode) {
  const nums = cells.map(c => c.num).filter(n => n != null), kind = (cells.find(c => c.num != null) || {}).kind || "Number";
  if (!nums.length) return null;
  const f = v => ({ text: formatValue({ kind, v }), num: v, kind });
  if (mode === "Calculate totals") return f(nums.reduce((s, n) => s + n, 0));
  if (mode === "Calculate minimum") return f(Math.min(...nums));
  if (mode === "Calculate maximum") return f(Math.max(...nums));
  if (mode === "Calculate minimum and maximum") { const lo = f(Math.min(...nums)), hi = f(Math.max(...nums)); return { text: `${lo.text} – ${hi.text}`, num: null, kind }; }
  return null;
}

/** The whole schedule: its columns and its rows (items, group headers and footers, blank lines, grand
 *  totals), ready for the view, the sheet and the CSV. Settings that name a missing field are skipped
 *  and reported in `notes`, never fatal. */
export function scheduleTable(doc, v) {
  F.doc = doc;
  const S = scheduleSettings(doc, v), notes = [];
  const calcs = new Map((S.calculated || []).filter(c => c && c.name).map(c => [c.name, c]));
  const fmt = k => S.format[k] || {};
  const columns = S.fields.map(key => ({ key, heading: fmt(key).heading || prettyField(key), align: fmt(key).align || "", hidden: !!fmt(key).hidden,
    total: fmt(key).total || (key === "Count" ? "Calculate totals" : "None"), group: fmt(key).group || "", conditional: fmt(key).conditional || [], calc: calcs.get(key) || null }));
  // items: one per element, or per element and material layer
  const els = scheduledElements(doc, S.cat);
  let items = S.kind === "Material Takeoff" ? els.flatMap(f => materialItems(doc, f)) : els.map(f => ({ f }));
  items.forEach((it, i) => { it.id = doc.idOf(it.f); it.order = i; it.vals = new Map(); });
  // a value, computed once per item and field; calculated values see the other fields by key or heading
  const val = (it, key) => {
    if (it.vals.has(key)) return it.vals.get(key);
    it.vals.set(key, { text: "", num: null, kind: "Text" });           // a formula naming itself reads blank, not forever
    const c = calcs.get(key); let out;
    if (c && c.type !== "percentage") {
      try {
        const lookup = name => { const k = S.fields.find(x => x === name || prettyField(x).replace(/\s+/g, "") === name || (fmt(x).heading || "").replace(/\s+/g, "") === name) || name;
          const r = val(it, k); return r.num != null ? { kind: r.kind === "Text" ? "Number" : r.kind, v: r.num } : r.text !== "" ? { kind: "Text", v: r.text } : undefined; };
        const r = evaluate(parse(c.formula || "0"), { lookup, into: c.kind || "Number" });
        out = { text: formatValue(r), num: typeof r.v === "number" ? r.v : null, kind: r.kind };
      } catch (e) { out = { text: "⚠ " + e.message, num: null, kind: "Text" }; }
    } else if (c) out = { text: "", num: null, kind: "Number" };      // percentages are filled in once the groups are known
    else out = fieldValue(doc, it, key);
    it.vals.set(key, out); return out;
  };
  // filters (all must pass, or any with "Or")
  const rules = S.filters.filter(r => r && r.field && r.op), total = new Set(items.map(it => it.id)).size;
  // what the filter leaves out is remembered with the rules it failed, so the view can say why an element is missing
  const excluded = new Map();
  if (rules.length) items = items.filter(it => {
    const ok = rules.map(r => passes(val(it, r.field), r.op, r.value)), keep = S.filterAny ? ok.some(Boolean) : ok.every(Boolean);
    if (!keep && !excluded.has(it.id)) excluded.set(it.id, { id: it.id, name: it.f.get("Name"), fails: rules.map((r, i) => ok[i] ? null : { rule: S.filters.indexOf(r), field: r.field, op: r.op, value: r.value, text: val(it, r.field).text }).filter(Boolean) });
    return keep;
  });
  for (const it of items) excluded.delete(it.id);        // a material row kept keeps its element
  // sorting: each level in turn, the element order last so a schedule never reshuffles between rebuilds
  const levels = S.sort.filter(s => s && s.field);
  items.sort((x, y) => { for (const L of levels) { const c = cmpCells(val(x, L.field), val(y, L.field)); if (c) return L.desc ? -c : c; } return x.order - y.order; });
  // percentage calculated values: of their field's total, over everything or within the first grouping
  for (const [name, c] of calcs) if (c.type === "percentage" && c.of) {
    const within = c.by === "group" && levels[0] ? it => val(it, levels[0].field).text : () => "";
    const sums = new Map(); for (const it of items) { const k = within(it); sums.set(k, (sums.get(k) || 0) + (val(it, c.of).num || 0)); }
    for (const it of items) { const s = sums.get(within(it)) || 0, n = s ? (val(it, c.of).num || 0) / s * 100 : 0; it.vals.set(name, { text: `${n.toFixed(1)} %`, num: n, kind: "Number" }); }
  }
  const cellsOf = it => columns.map(col => { const c = Object.assign({}, val(it, col.key)); const rule = col.conditional.find(r => r && r.op && passes(c, r.op, r.value)); if (rule) c.fill = rule.fill || "#fff3b0"; return c; });
  const rows = [];
  const emitLeaf = group => {
    if (S.itemize) { for (const it of group) rows.push({ kind: "item", ids: [it.id], f: it.f, cells: cellsOf(it) }); return; }
    // one row for the group: a value all share, the total of what is totalled, the count; blank where they differ
    const cells = columns.map(col => {
      const all = group.map(it => val(it, col.key));
      if (col.key === "Count") return { text: String(group.length), num: group.length, kind: "Number" };
      if (col.total !== "None") { const a = aggregate(all, col.total); if (a) return a; }
      return all.every(c => c.text === all[0].text) ? Object.assign({}, all[0]) : { text: "", num: null, kind: all[0] ? all[0].kind : "Text", varies: true };
    });
    columns.forEach((col, i) => { const rule = col.conditional.find(r => r && r.op && passes(cells[i], r.op, r.value)); if (rule) cells[i].fill = rule.fill || "#fff3b0"; });
    rows.push({ kind: "merged", ids: group.map(it => it.id), f: group[0] && group[0].f, cells, count: group.length });
  };
  const summary = (group, mode, title, kind, depth) => {
    const withTitle = /Title/.test(mode), withCount = /Count|count/.test(mode);
    const cells = columns.map(col => {
      if (col.key === "Count") return { text: String(group.length), num: group.length, kind: "Number" };
      return col.total !== "None" ? (aggregate(group.map(it => val(it, col.key)), col.total) || { text: "", num: null }) : { text: "", num: null };
    });
    const label = [withTitle ? title : "", withCount ? String(group.length) : ""].filter(Boolean).join(": ");
    return { kind, depth, ids: group.map(it => it.id), text: label, cells };
  };
  const build = (group, depth) => {
    if (depth >= levels.length) { emitLeaf(group); return; }
    const L = levels[depth];
    for (let i = 0; i < group.length;) {
      const key = val(group[i], L.field).text; let j = i; while (j < group.length && val(group[j], L.field).text === key) j++;
      const sub = group.slice(i, j), title = key || `<no ${prettyField(L.field).toLowerCase()}>`;
      if (L.header) rows.push({ kind: "header", depth, text: title, ids: sub.map(it => it.id) });
      build(sub, depth + 1);
      if (L.footer) rows.push(summary(sub, L.footerMode || FOOTER_MODES[0], title, "footer", depth));
      if (L.blank) rows.push({ kind: "blank", depth });
      i = j;
    }
  };
  build(items, 0);
  if (S.grandTotals.on) rows.push(summary(items, S.grandTotals.mode || FOOTER_MODES[0], S.grandTotals.title || "Grand total", "grand", 0));
  for (const r of S.filters) if (r && r.field && !availableFields(doc, S.cat, S.kind, S.calculated).some(a => a.key === r.field)) notes.push(`filter on ${r.field}: no ${S.cat} has that field`);
  const visible = columns.map((c, i) => c.hidden ? -1 : i).filter(i => i >= 0);
  return { settings: S, columns, visible, rows, count: items.length, total, excluded, title: v.get("Name"), notes };
}

/** Why a failed rule dropped an element, in words: "Length 7250.5 mm is not less than 2921 mm". */
export const failText = x => `${prettyField(x.field)} ${x.text === "" ? "(no value)" : x.text} ${x.op === "has a value" ? "has no value" : x.op === "has no value" ? "has a value" : "does not satisfy “" + x.op + " " + (x.value ?? "") + "”"}`;
/** Where is an element in a schedule? Looks up by name, mark, id or type: shown, left out by the filter
 *  (with the rules it fails), filed under another category, or not in the model. */
export function findInSchedule(doc, table, query) {
  const q = String(query || "").trim().toLowerCase(); if (!q) return [];
  const S = table.settings, shown = new Set(table.rows.flatMap(r => r.kind === "item" || r.kind === "merged" ? r.ids : []));
  const inCat = new Set(scheduledElements(doc, S.cat).map(f => doc.idOf(f)));
  // exact id, mark or name first, then names that contain what was typed
  const rank = f => { const id = doc.idOf(f).toLowerCase(), n = (f.get("Name") || "").toLowerCase(), m = doc.getParam(f, "Mark"), mk = m != null ? String(m).toLowerCase() : null;
    return id === q || mk === q || n === q ? 0 : n.includes(q) ? 1 : -1; };
  const hits = doc.elements().map(f => [f, rank(f)]).filter(x => x[1] >= 0).sort((x, y) => x[1] - y[1]).map(x => x[0]).slice(0, 12);
  return hits.map(f => {
    const id = doc.idOf(f), name = f.get("Name") || id;
    if (shown.has(id)) return { id, name, status: "shown" };
    if (table.excluded.has(id)) return { id, name, status: "filtered", fails: table.excluded.get(id).fails };
    if (!inCat.has(id)) return { id, name, status: "other", category: categoryName(categoryOf(doc, f)) };
    return { id, name, status: "missing" };
  });
}

/** The table as CSV (what Revit's Export › Reports › Schedule writes): visible columns, header rows as
 *  a line of their own, totals rows included. */
export function scheduleCSV(table) {
  const q = s => /[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const vis = table.visible, out = [];
  if (table.settings.appearance.title) out.push(q(table.title));
  if (table.settings.appearance.headers) out.push(vis.map(i => q(table.columns[i].heading)).join(","));
  for (const r of table.rows) {
    if (r.kind === "blank") out.push("");
    else if (r.kind === "header") out.push(q(r.text));
    else out.push(vis.map((i, n) => q(n === 0 && r.text && !r.cells[i].text ? r.text : r.cells[i].text || "")).join(","));
  }
  return out.join("\n") + "\n";
}

/** Legacy shape (fields + one text row per element), for callers that only list. */
export function scheduleRows(doc, v) {
  const t = scheduleTable(doc, v);
  return { fields: t.columns.map(c => c.key), cat: t.settings.cat, rows: t.rows.filter(r => r.kind === "item" || r.kind === "merged").map(r => ({ id: r.ids[0], ids: r.ids, f: r.f, cells: r.cells.map(c => c.text) })) };
}
