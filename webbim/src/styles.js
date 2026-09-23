//! Graphics resolution (§7). Every object knows which pen it draws with; colour
//! carries no plotting meaning. Seven levels, lowest first, each overriding the
//! last: category default → subcategory pen → material graphics → category
//! style → family style (up the extends chain) → filter rules → element
//! override in this view. Nothing anywhere derives a weight from a colour.

import { F, propertyOf, evalParam } from "./ocaf.js";

export const LINE_TYPES = {
  solid: null,
  dashed1: [2.0, 1.0],          // paper mm
  dashed2: [1.0, 0.8],
  dotted: [0.2, 0.6],
  centre: [6, 1, 1, 1],
  hidden: [1.5, 0.75],
};
const HALFTONE = 0.5;

/** A pen name → a physical width in paper mm at a view scale. "none" stays
 *  "none": it is not a zero-width pen and must never become one (§12.3). */
export function penWeight(doc, pen, scale) {
  if (pen === "none" || pen == null) return pen === "none" ? "none" : null;
  if (typeof pen === "number") return pen;                 // a literal: only legal as a view override
  const set = doc.lib.pens["PEN-ISO"] || Object.values(doc.lib.pens)[0];
  const ps = set.perScale && set.perScale["1:" + scale];
  if (ps && ps[pen] !== undefined) return ps[pen];
  const p = set.pens[pen];
  return p ? p.weight : null;
}

/** The category an element is filed under — the IFC class at its family root. */
export function categoryOf(doc, f) {
  const decl = doc.declOf(f);
  for (const k of ["wallType", "doorType", "windowType", "columnType", "floorType", "beamType"]) {
    const id = F.refId(f, k); if (id) { const t = doc.resolveType(id); if (t && t.category) return t.category; }
  }
  return decl ? decl.category : "Unknown";
}
export function familyChainOf(doc, f) {
  for (const k of ["wallType", "doorType", "windowType", "columnType", "floorType", "beamType"]) {
    const id = F.refId(f, k); if (id) { const t = doc.resolveType(id); if (t) return t.chain.map(c => c.id); }
  }
  return [];
}

// ---------------------------------------------------------------- predicates (§4.4)
/** Parameter value as a filter sees it: Category, instance, type, computed. */
export function paramForFilter(doc, f, name) {
  if (name === "Category") return categoryOf(doc, f);
  if (name === "Type") { const t = ["wallType", "doorType", "windowType", "columnType"].map(k => F.refId(f, k)).find(Boolean); return t || null; }
  if (name === "Family") return familyChainOf(doc, f)[0] || null;
  const p = doc.getParam(f, name);
  if (p !== undefined) { const v = evalParam(doc, f, p); return v && !v.error ? v.v : undefined; }
  const v = propertyOf(doc, f, name);
  if (v && !v.error) return v.v;
  const spec = doc.lib.paramSpecs[name];
  if (spec && spec.binding === "instance" && spec.default !== undefined) return spec.default;
  return undefined;
}
const CATEGORY_ALIASES = { Walls: "IfcWall", Doors: "IfcDoor", Windows: "IfcWindow", Columns: "IfcColumn", Spaces: "IfcSpace", Openings: "IfcOpeningElement" };
export function matches(doc, f, pred) {
  if (!pred) return true;
  if (pred.all) return pred.all.every(p => matches(doc, f, p));
  if (pred.any) return pred.any.some(p => matches(doc, f, p));
  if (pred.none) return !pred.none.some(p => matches(doc, f, p));
  let v = paramForFilter(doc, f, pred.param);
  const cmp = x => { const n = Number(x); return Number.isFinite(n) && x !== "" && x !== null ? n : x; };
  const norm = x => pred.param === "Category" ? (CATEGORY_ALIASES[x] || x) : x;
  if ("is" in pred) return String(v) === String(norm(pred.is));
  if ("not" in pred) return String(v) !== String(norm(pred.not));
  if ("gt" in pred) return cmp(v) > cmp(pred.gt);
  if ("lt" in pred) return cmp(v) < cmp(pred.lt);
  if ("gte" in pred) return cmp(v) >= cmp(pred.gte);
  if ("lte" in pred) return cmp(v) <= cmp(pred.lte);
  if ("between" in pred) return cmp(v) >= cmp(pred.between[0]) && cmp(v) <= cmp(pred.between[1]);
  if ("contains" in pred) return String(v ?? "").toLowerCase().includes(String(pred.contains).toLowerCase());
  if ("beginsWith" in pred) return String(v ?? "").startsWith(pred.beginsWith);
  if ("endsWith" in pred) return String(v ?? "").endsWith(pred.endsWith);
  if ("defined" in pred) return v !== undefined && v !== null && v !== "";
  if ("undefined" in pred) return v === undefined || v === null || v === "";
  return false;
}
/** Operators offered per parameter kind — the predicate editor is generated from this. */
export const OPERATORS = {
  Enum: ["is", "not", "defined", "undefined"], Text: ["is", "not", "contains", "beginsWith", "endsWith", "defined", "undefined"],
  Length: ["is", "gt", "lt", "gte", "lte", "between"], Number: ["is", "gt", "lt", "gte", "lte", "between"], Integer: ["is", "gt", "lt", "gte", "lte", "between"],
  Boolean: ["is"], Material: ["is", "not"], Level: ["is", "not"],
};

// ---------------------------------------------------------------- resolution
/** Resolve one graphic role for an element in a view.
 *  role: cut · cutPattern · projection · surfacePattern · beyond · hidden · symbolic · swing
 *  sub:  the subcategory (Panel, Swing, Frame, Layer, …); material: for cut regions. */
export function resolveGraphics(doc, ctx, f, role, sub = "Common", material = null) {
  const style = ctx.style || {};
  const cat = categoryOf(doc, f);
  const g = { pen: null, colour: "#000000", lineType: "solid", fill: undefined, pattern: null, patternColour: null, halftone: false, visible: true, trace: [] };
  const apply = (src, from) => { if (!src) return; for (const [k, v] of Object.entries(src)) if (v !== undefined && typeof v !== "object") g[k] = v; g.trace.push(from); };
  // 7. category default
  apply({ pen: role === "cut" ? "heavy" : role === "beyond" || role === "hidden" ? "hairline" : "thin" }, "category default");
  // 6. subcategory pen assignment
  const subs = (doc.lib.categories[cat] || {}).subcategories || {};
  const sc = subs[sub] || subs.Common || {};
  const sp = sc[role === "cutPattern" ? "cut" : role] ?? (role === "swing" ? sc.projection : undefined);
  if (sp) apply({ pen: sp }, `subcategory ${sub}`);
  // 5. material graphics
  if (material && doc.lib.materials[material]) {
    const m = doc.lib.materials[material];
    const mg = role === "cut" || role === "cutPattern" ? m.cut : m.projection;
    if (mg) apply({ pen: role === "cutPattern" ? "hairline" : mg.pen, colour: mg.lineColour, pattern: role === "cut" || role === "cutPattern" ? mg.pattern : undefined, fill: mg.background }, `material ${material}`);
  }
  // 4. category style
  const cs = style.byCategory && style.byCategory[cat];
  if (cs) { if (cs.visible === false) g.visible = false; apply(cs[role === "cutPattern" ? "cut" : role], `style ${cat}`); if (role === "fill") apply({ fill: cs.fill }, `style ${cat}`); }
  // 3. family style, root first so the nearest ancestor wins
  const chain = familyChainOf(doc, f).slice().reverse();
  for (const fam of chain) { const fs = style.byFamily && style.byFamily[fam]; if (fs) apply(fs[role === "cutPattern" ? "cut" : role], `family ${fam}`); }
  // 2. filter rules, in order: first match wins with stop, otherwise accumulate
  // The style's own rules, then any filters the view adds by id (from any style's rule list).
  for (const rule of ctx.rules || style.rules || []) {
    if (!matches(doc, f, rule.when)) continue;
    const t = rule.then || {};
    apply(t[role === "cutPattern" ? "cut" : role], `rule ${rule.id}`);
    if (role === "fill" && t.fill) apply({ fill: t.fill }, `rule ${rule.id}`);
    if (t.halftone) g.halftone = true;
    if (t.visible === false) g.visible = false;
    if (rule.stop) break;
  }
  // 1. element override in this view
  const ov = ctx.overrides && ctx.overrides[doc.idOf(f)];
  if (ov) { apply(ov[role === "cutPattern" ? "cut" : role] || (role === "any" ? ov : null), "view override"); if (ov.visible === false) g.visible = false; if (ov.halftone) g.halftone = true; }
  // The cut-pattern role draws the hatch lines, never the outline weight.
  if (role === "cutPattern" && g.pen === "heavy") g.pen = "hairline";
  const weight = penWeight(doc, g.pen, ctx.scale);
  return {
    weight, colour: g.halftone ? mix(g.colour, "#ffffff", HALFTONE) : g.colour,
    dash: LINE_TYPES[g.lineType] || null, fill: g.fill === "none" ? null : (g.halftone && g.fill ? mix(g.fill, "#ffffff", HALFTONE) : g.fill ?? null),
    fillNone: g.fill === "none",
    pattern: g.pattern === "none" || g.pattern === "solid" ? (g.pattern === "solid" ? "solid" : null) : g.pattern, visible: g.visible,
    detailLevel: g.detailLevel, pen: g.pen, trace: g.trace, halftone: g.halftone,
  };
}
export function mix(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.length === 4 ? h[Math.ceil(i / 2)] + h[Math.ceil(i / 2)] : h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
/** Is a category visible in a view (VV)? */
export function categoryVisible(ctx, cat) {
  const cs = ctx.style && ctx.style.byCategory && ctx.style.byCategory[cat];
  if (ctx.hidden && ctx.hidden.includes(cat)) return false;
  return !(cs && cs.visible === false);
}

/** The rule list a view applies: its style's rules plus the view's own filters. */
export function rulesFor(doc, style, filterIds = []) {
  const out = (style && style.rules ? style.rules.slice() : []);
  const all = Object.values(doc.lib.viewStyles).flatMap(s => s.rules || []);
  for (const id of filterIds || []) if (!out.some(r => r.id === id)) { const r = all.find(x => x.id === id); if (r) out.push(r); }
  return out;
}
