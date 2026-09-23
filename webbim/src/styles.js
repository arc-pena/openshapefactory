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
  // 5. material graphics. Where they sit is the category's choice in V/G (materialPriority):
  //    "material" (the default) - a component with a material draws as its material, over the view's
  //    category graphics; "view" - the view's category graphics win over the material; "none" - ignored.
  const cs = style.byCategory && style.byCategory[cat];
  const prio = (cs && cs.materialPriority) || "material";
  const applyMaterial = () => {
    if (!material || !doc.lib.materials[material] || prio === "none") return;
    const m = doc.lib.materials[material];
    const mg = role === "cut" || role === "cutPattern" ? m.cut : m.projection;
    if (mg) apply({ pen: role === "cutPattern" ? "hairline" : mg.pen, colour: mg.lineColour, pattern: role === "cut" || role === "cutPattern" ? mg.pattern : undefined, fill: mg.background }, `material ${material}`);
  };
  if (prio === "view") applyMaterial();
  // 4. category style
  if (cs) { if (cs.visible === false) g.visible = false; if (cs.halftone) g.halftone = true; if (cs.detailLevel && cs.detailLevel !== "By View") g.detailLevel = cs.detailLevel; apply(cs[role === "cutPattern" ? "cut" : role], `style ${cat}`); if (role === "fill") apply({ fill: cs.fill }, `style ${cat}`); }
  // Revit's Display Model: the whole model halftone (an underlay for a drawing of other things), or not drawn
  if (style.displayModel === "Halftone" && !isAnnotationCategory(cat)) g.halftone = true;
  if (style.displayModel === "Do not display" && !isAnnotationCategory(cat)) g.visible = false;
  // 3. family style, root first so the nearest ancestor wins
  const chain = familyChainOf(doc, f).slice().reverse();
  for (const fam of chain) { const fs = style.byFamily && style.byFamily[fam]; if (fs) apply(fs[role === "cutPattern" ? "cut" : role], `family ${fam}`); }
  if (prio === "material") applyMaterial();
  // 2. filter rules, in order: first match wins with stop, otherwise accumulate
  // The style's own rules, then any filters the view adds by id (from any style's rule list).
  for (const rule of ctx.rules || style.rules || []) {
    if (rule.enabled === false || !matches(doc, f, rule.when)) continue;
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
  // 0. the graphic scheme: a whole drawing's ink, poché, weight and halftone, as a designer sets a palette
  const sch = ctx.scheme || null, paper = (sch && sch.background) || "#ffffff", ht = sch && sch.halftone !== undefined ? sch.halftone : HALFTONE;
  if (sch) {
    if (sch.ink && (!g.colour || g.colour.toLowerCase() === "#000000")) g.colour = sch.ink;
    if (sch.poche && role === "cut" && g.fill && g.fill !== "none" && !/^#(fff|ffffff)$/i.test(g.fill)) g.fill = sch.poche;
    if (sch.accent && g.halftone === false && g.trace.some(t => t.startsWith("rule "))) g.colour = sch.accent;
  }
  const pw = penWeight(doc, g.pen, ctx.scale), weight = typeof pw === "number" && sch && sch.weight ? pw * sch.weight : pw;   // "none" stays "none"
  return {
    weight, colour: g.halftone ? mix(g.colour, paper, ht) : g.colour,
    dash: LINE_TYPES[g.lineType] || null, fill: g.fill === "none" ? null : (g.halftone && g.fill ? mix(g.fill, paper, ht) : g.fill ?? null),
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

// ---------------------------------------------------------------- view styles as Revit's view templates
//! A view style is a view template: it holds graphics, and it can hold a view's settings too. Each
//! setting it INCLUDES is the style's to say - pushed to every view using the style and locked there, in
//! Properties and in Visibility/Graphics. What it does not include stays each view's own.
export const STYLE_SETTINGS = [
  ["scale", "View scale"], ["detailLevel", "Detail level"], ["viewRange", "View range (plans)"], ["visualStyle", "Visual style (3D)"],
  ["modelVG", "V/G overrides: model categories"], ["annotationVG", "V/G overrides: annotation categories"], ["filters", "V/G overrides: filters"],
  ["displayModel", "Display model"], ["farClip", "Far clipping (sections, elevations)"], ["sketchy", "Sketchy lines"], ["scheme", "Graphic scheme"],
];
/** Categories that are drawing rather than building: Revit's annotation (2D / symbolic) categories. */
export const isAnnotationCategory = cat => /^(Annotation|Detail|IfcGrid|IfcBuildingStorey)/.test(cat);
/** The style a view's `setting` is locked by, or null when the view owns it. */
export function lockedBy(doc, v, setting) {
  const id = F.refId(v, "style"), st = id && doc.lib.viewStyles[id];
  return st && st.include && st.include[setting] ? (st.name || id) : null;
}
/** Graphic schemes: a whole drawing's palette in one choice, as a designer would set it in Illustrator
 *  or InDesign - the ink lines take, poché for what is cut, line-weight scale, how far halftone fades,
 *  the paper, and an accent for what filters pick out. */
export const SCHEMES = {
  "Technical": { name: "Technical (black on white)" },
  "Blueprint": { name: "Blueprint", background: "#16345f", ink: "#e8f0ff", poche: "#9fb8e0", halftone: 0.55, weight: 0.9, accent: "#ffd166" },
  "Warm Presentation": { name: "Warm presentation", background: "#faf6ef", ink: "#3b3027", poche: "#3b3027", halftone: 0.6, weight: 0.8, accent: "#c0573e" },
  "Illustrator Fine": { name: "Illustrator fine line", ink: "#1f1f1f", poche: "#2b2b2b", weight: 0.6, halftone: 0.65, accent: "#e4572e" },
  "InDesign Grey": { name: "InDesign cool grey", ink: "#4a4f57", poche: "#c9ced6", weight: 0.7, halftone: 0.6, accent: "#2f6fd6" },
  "Graphite Sketch": { name: "Graphite sketch", background: "#f4f3ef", ink: "#555555", poche: "#8a8a8a", weight: 1.15, halftone: 0.5 },
  "Night": { name: "Night (dark paper)", background: "#1b1d22", ink: "#d6dbe3", poche: "#586070", halftone: 0.55, weight: 0.85, accent: "#7cc4ff" },
};
/** The style a view actually draws with: the style's graphics, with the view's own V/G overrides laid
 *  over whatever the style does not include; the view's own filters after the style's when filters are
 *  the view's; and the scheme the style or the view chose. */
export function effectiveStyle(doc, style, v) {
  const inc = style.include || {}, vg = (v && doc.argValue(v, "vg")) || {};
  const out = Object.assign({}, style, { byCategory: Object.assign({}, style.byCategory || {}) });
  for (const [cat, over] of Object.entries(vg.byCategory || {})) {
    if ((isAnnotationCategory(cat) ? inc.annotationVG : inc.modelVG)) continue;          // locked by the style
    const base = out.byCategory[cat] || {}, merged = Object.assign({}, base);
    for (const [k, val] of Object.entries(over)) merged[k] = val && typeof val === "object" && !Array.isArray(val) ? Object.assign({}, base[k] || {}, val) : val;
    out.byCategory[cat] = merged;
  }
  out.rules = (style.rules || []).slice();
  if (!inc.filters) for (const fl of vg.filters || []) if (fl.enabled !== false) out.rules.push(Object.assign({}, fl, { then: Object.assign({}, fl.then || {}, fl.visible === false ? { visible: false } : {}) }));
  const sc = inc.scheme ? style.scheme : (vg.scheme || style.scheme);
  // a scheme is a preset's name, or a preset customised in place (the object carries its own colours)
  out.schemeObj = sc && typeof sc === "object" ? Object.assign({}, SCHEMES[sc.base] || {}, sc) : sc && SCHEMES[sc] ? SCHEMES[sc] : null;
  for (const k of ["displayModel", "sketchy"]) out[k] = inc[k] ? style[k] : (vg[k] !== undefined ? vg[k] : style[k]);
  return out;
}
/** The view settings a style can carry, and the view argument each one is. */
export const STYLE_VIEW_KEYS = { scale: "scale", detailLevel: "detailLevel", viewRange: "viewRange", visualStyle: "visualStyle", farClip: "depth" };
/** Is the view argument `key` held by the view's style? Its name when it is. */
export function lockedKey(doc, v, key) {
  const setting = Object.keys(STYLE_VIEW_KEYS).find(s => STYLE_VIEW_KEYS[s] === key);
  return setting ? lockedBy(doc, v, setting) : null;
}
/** Push what a style includes into a view that uses it: the view then shows the style's values,
 *  as Revit applies a template's included parameters. Returns the keys it changed. */
export function pushStyleSettings(doc, v) {
  const id = F.refId(v, "style"), st = id && doc.lib.viewStyles[id], changed = [];
  if (!st || !st.include) return changed;
  const decl = doc.declOf(v), has = k => decl && decl.args.some(a => a.key === k);
  for (const [setting, key] of Object.entries(STYLE_VIEW_KEYS)) {
    if (!st.include[setting] || !st.settings || st.settings[setting] === undefined || !has(key)) continue;
    const val = st.settings[setting];
    if (JSON.stringify(doc.argValue(v, key)) === JSON.stringify(val)) continue;
    doc.setArg(v, key, typeof val === "object" ? JSON.parse(JSON.stringify(val)) : val); changed.push(key);
  }
  return changed;
}
/** A new, empty style: graphics as the construction default, nothing included. */
export function blankStyle(name) {
  return { name, byCategory: {}, byFamily: {}, rules: [], include: {}, settings: { scale: 100, detailLevel: "Fine", viewRange: { top: 2300, cut: 1200, bottom: 0, depth: 0 }, visualStyle: "Shaded", farClip: 15000 }, scheme: "Technical", displayModel: "Normal", sketchy: null };
}
