//! The document: an OCAF-style label tree with typed attributes, a catalogue
//! declared as data, drivers as pure functions, a logbook solver, and JSON
//! read/write (spec §1, §2, §13). Nothing in here knows what a wall is.
//!
//! Tree layout:
//!   0:1  elements        one label per element, tag = creation sequence
//!   0:2  definitions     types, families, materials, styles … one label each
//! Under an element label (tags are on disk; never renumber):
//!   1..9 arguments in declared order · 10–49 user parameters · 51 their specs
//!   52 appearance · 53 frame · 54 parent container
//!   100 result · 101 error · 102 revision · 103 data · 104 note · 105 plan rep · 106 elevation rep

import { evaluate, parse, namesIn, ExprError, formatValue } from "./expr.js";

export const FIRST_ARG_TAG = 1;
export const RESULT_TAG = 100;
export const ERROR_TAG = 101;
export const REVISION_TAG = 102;
export const DATA_TAG = 103;
export const NOTE_TAG = 104;
export const PLAN_TAG = 105;          // the 2D plan derivation (v0.2)
export const ELEV_TAG = 106;          // the 2D elevation derivation (v0.2)
export const PARAM_TAG0 = 10;
export const PARAM_TAG_END = 49;
export const PARAM_SPEC_TAG = 51;
export const APPEARANCE_TAG = 52;
export const FRAME_TAG = 53;
export const PARENT_TAG = 54;
const MAX_ARGS = PARAM_TAG0 - FIRST_ARG_TAG;   // 9: tag 10 is where parameters start

// ---------------------------------------------------------------- labels
export class Label {
  constructor(tag, parent = null) { this.tag = tag; this.parent = parent; this.attrs = Object.create(null); this.kids = new Map(); }
  child(tag, create = true) {
    let c = this.kids.get(tag);
    if (!c && create) { c = new Label(tag, this); this.kids.set(tag, c); }
    return c || null;
  }
  get(attr) { return this.attrs[attr]; }
  set(attr, v) { if (v === undefined) delete this.attrs[attr]; else this.attrs[attr] = v; return this; }
  /** "0:1:12:4" — shown under every panel field so bug reports are precise. */
  entry() { const t = []; for (let l = this; l; l = l.parent) t.unshift(l.tag); return t.join(":"); }
  forget(tag) { this.kids.delete(tag); }
}

// ---------------------------------------------------------------- catalogue helpers
//! One `args` entry drives the property panel, the node editor's ports, the
//! graph's wiring validation and the save format. Four consumers, one declaration.
const argOf = (kind, key, label, extra, opts = {}) => Object.assign({ kind, key, label, group: "Constraints" }, extra, opts);
export const real = (key, label, def, min, max, step, unit = "mm", opts = {}) =>
  argOf("Real", key, label, { def, min, max, step, unit, quantity: unit === "mm" ? "Length" : unit === "°" ? "Angle" : "Number" }, opts);
export const integer = (key, label, def, min, max, opts = {}) => argOf("Integer", key, label, { def, min, max, quantity: "Integer" }, opts);
export const bool = (key, label, def = false, opts = {}) => argOf("Boolean", key, label, { def }, opts);
export const text = (key, label, def = "", opts = {}) => argOf("Text", key, label, { def }, opts);
export const choice = (key, label, options, defIndex = 0, opts = {}) => argOf("Choice", key, label, { options, def: options[defIndex] }, opts);
/** A reference. `kinds` drive what the panel offers and what a wire may connect.
 *  `view: true` marks an annotation/appearance link that must NOT enter the model graph (§1.4). */
export const ref = (key, label, kinds, opts = {}) => argOf("Reference", key, label, { kinds, def: null }, opts);
export const curve2d = (key, label, types, def, opts = {}) => argOf("Curve2D", key, label, { types, def }, opts);
export const point2d = (key, label, def = [0, 0], opts = {}) => argOf("Point2D", key, label, { def }, opts);
export const json = (key, label, def, opts = {}) => argOf("Json", key, label, { def }, opts);
export const when = (arg, key, value) => Object.assign({}, arg, { when: { key, value } });

/** Geometric driver arguments: never attributes, never a text box (§4.1, §4.5). */
export const GEOMETRIC_KINDS = new Set(["Curve2D", "Point2D", "Json"]);
/** The closed attribute kind set (§4.1). A parameter spec outside it is refused at load. */
export const ATTRIBUTE_KINDS = ["Length", "Angle", "Number", "Integer", "Boolean", "Text", "MultiText", "Enum", "Colour", "URL",
  "Material", "Symbol", "WallType", "DoorType", "WindowType", "ColumnType", "Level", "Phase", "Host", "Space"];

export const CATALOGUE = new Map();   // type → declaration
export const BUILDERS = Object.create(null);
export function declare(entry) {
  if (entry.args.length > MAX_ARGS) throw new Error(`${entry.type} declares ${entry.args.length} arguments; tags ${FIRST_ARG_TAG}–${MAX_ARGS} are all there is before the parameter range`);
  CATALOGUE.set(entry.type, entry);
  return entry;
}

// ---------------------------------------------------------------- logbook
export class Logbook {
  constructor() { this.touched = new Set(); this.impacted = new Set(); }
  touch(label) { this.touched.add(label); }
  impact(label) { this.impacted.add(label); }
  isModified(label) { return this.touched.has(label) || this.impacted.has(label); }
  clear() { this.touched.clear(); this.impacted.clear(); }
  get empty() { return this.touched.size === 0 && this.impacted.size === 0; }
}

/** Libraries that drive geometry (edits bump the model revision) versus
 *  libraries that only drive drawing (edits bump the view revision) — §1.4. */
export const MODEL_LIBS = ["families", "types"];
export const VIEW_LIBS = ["categories", "paramSpecs", "patterns", "materials", "symbols", "viewStyles", "pens", "textTypes"];
const LIB_ORDER = ["categories", "paramSpecs", "pens", "patterns", "materials", "symbols", "families", "types", "textTypes", "viewStyles", "meshes"];

// ---------------------------------------------------------------- the document
export class Document {
  constructor() {
    this.root = new Label(0);
    this.elementsLabel = this.root.child(1);
    this.defsLabel = this.root.child(2);
    this.byId = new Map();          // stable id → element label
    this.defs = new Map();          // "types:T-EXTCAV300" → definition label
    this.lib = {}; for (const k of LIB_ORDER) this.lib[k] = {};
    this.joins = []; this.constraints = [];
    this.graph = { layout: {} }; this.browser = {};
    this.meta = { format: "web-bim-document", version: 1, units: "mm", name: "Untitled" };
    this.log = new Logbook();
    this.modelRevision = 0; this.viewRevision = 0; this.relationRevision = 0;
    this.nextTag = 1; this.nextDefTag = 1;
    this.stats = newStats();
    this.systemPasses = [];          // phase 3: (doc, rebuilt:Set<Label>) => void
    this.loadReport = [];
    this.extra = {};                 // unknown top-level keys, written back untouched
  }

  // -------- elements
  elements() { return [...this.elementsLabel.kids.values()]; }
  element(id) { return this.byId.get(id) || null; }
  idOf(f) { return f.get("AsciiString"); }
  typeOf(f) { return f.get("Type"); }
  declOf(f) { return CATALOGUE.get(f.get("Type")) || null; }

  /** Create an element label from its JSON record. References stay as ids
   *  until `wire()` — forward references are normal (§2.3). */
  addElement(rec, { touch = true } = {}) {
    const decl = CATALOGUE.get(rec.type);
    let id = rec.id;
    if (!id) id = this.freshId(rec.type);
    if (this.byId.has(id)) throw new Error(`an element called ${id} already exists`);
    const f = this.elementsLabel.child(this.nextTag++);
    f.set("AsciiString", id).set("Type", rec.type).set("Name", rec.name || id)
     .set("Integer", rec.visible === false ? 0 : 1);
    if (!decl) {
      f.set("Placeholder", rec.raw || rec).set("Function", null);
      f.child(ERROR_TAG).set("Text", `unknown element type "${rec.type}" — kept as it was read so a save does not lose it`);
      this.byId.set(id, f);
      return f;
    }
    f.set("Function", decl.guid);
    const args = rec.args || {};
    decl.args.forEach((a, i) => {
      const lab = f.child(FIRST_ARG_TAG + i);
      lab.set("Key", a.key).set("Kind", a.kind);
      lab.set("Value", args[a.key] !== undefined ? clone(args[a.key]) : clone(a.def));
    });
    // Arguments this build does not know (a newer file) survive a save.
    const known = new Set(decl.args.map(a => a.key));
    const unknown = Object.keys(args).filter(k => !known.has(k));
    if (unknown.length) f.set("ExtraArgs", Object.fromEntries(unknown.map(k => [k, args[k]])));
    if (rec.params) Object.entries(rec.params).forEach(([k, v]) => this.setParam(f, k, v, false));
    if (rec.parent) f.child(PARENT_TAG).set("Reference", rec.parent);
    if (rec.appearance) f.child(APPEARANCE_TAG).set("Json", clone(rec.appearance));
    if (rec.overrides) f.child(APPEARANCE_TAG).set("Overrides", clone(rec.overrides));
    this.byId.set(id, f);
    if (touch) this.log.touch(f);
    return f;
  }
  freshId(type) {
    const base = (CATALOGUE.get(type) && CATALOGUE.get(type).idPrefix) || type.slice(0, 2).toUpperCase();
    let n = 1; while (this.byId.has(base + n)) n++;
    return base + n;
  }
  removeElement(id) {
    const f = this.byId.get(id); if (!f) return false;
    this.elementsLabel.forget(f.tag); this.byId.delete(id);
    // Deleting is local: relationship rows go with it; no element held a pointer (§1.5).
    const before = this.joins.length + this.constraints.length;
    this.joins = this.joins.filter(j => j.a.of !== id && j.b.of !== id);
    this.constraints = this.constraints.filter(c => !c.of.some(r => r.split(":")[0] === id));
    if (this.joins.length + this.constraints.length !== before) this.relationRevision++;
    // Whoever referenced it must rebuild and will say what went missing.
    for (const g of this.elements()) if (this.argumentIds(g).includes(id)) this.log.touch(g);
    return true;
  }

  // -------- arguments
  argLabel(f, key) {
    const decl = this.declOf(f); if (!decl) return null;
    const i = decl.args.findIndex(a => a.key === key);
    return i < 0 ? null : f.child(FIRST_ARG_TAG + i, false);
  }
  argValue(f, key) { const l = this.argLabel(f, key); return l ? l.get("Value") : undefined; }
  setArg(f, key, value) {
    const l = this.argLabel(f, key);
    if (!l) throw new Error(`${this.idOf(f)} has no argument called "${key}"`);
    l.set("Value", clone(value));
    this.log.touch(l); this.log.touch(f);
  }

  // -------- user parameters (tags 10–49)
  paramLabels(f) { const out = []; for (let t = PARAM_TAG0; t <= PARAM_TAG_END; t++) { const l = f.child(t, false); if (l) out.push(l); } return out; }
  getParam(f, name) { const l = this.paramLabels(f).find(l => l.get("Name") === name); return l ? l.get("Value") : undefined; }
  setParam(f, name, value, touchView = true) {
    let l = this.paramLabels(f).find(l => l.get("Name") === name);
    if (!l) {
      let t = PARAM_TAG0; while (f.child(t, false)) t++;
      if (t > PARAM_TAG_END) throw new Error(`${this.idOf(f)} already carries ${PARAM_TAG_END - PARAM_TAG0 + 1} parameters`);
      l = f.child(t).set("Name", name);
    }
    if (value === undefined) { f.forget(l.tag); } else l.set("Value", clone(value));
    // Parameters drive filters and tags, not geometry: a view change (§1.4).
    if (touchView) this.viewRevision++;
  }
  params(f) { const o = {}; for (const l of this.paramLabels(f)) o[l.get("Name")] = l.get("Value"); return o; }

  // -------- references and the graph
  /** Element ids a label's arguments depend on. View-side refs and the parent
   *  are deliberately not here (§1.4): a folder, a tag or a line weight must not
   *  order the graph. Bound numeric fields ({ref}) are dependencies. */
  argumentIds(f) {
    const decl = this.declOf(f); if (!decl) return [];
    const out = [];
    decl.args.forEach((a, i) => {
      if (a.view) return;
      const v = f.child(FIRST_ARG_TAG + i, false)?.get("Value");
      collectRefs(v, out);
    });
    const extra = decl.dependsOn ? decl.dependsOn(f, this) : [];
    return out.concat(extra).filter(id => this.byId.has(id));
  }
  /** Definition labels (types/families) an element's arguments read. */
  argumentDefs(f) {
    const decl = this.declOf(f); if (!decl) return [];
    const out = [];
    decl.args.forEach((a, i) => {
      if (a.kind !== "Reference" || a.view) return;
      const v = f.child(FIRST_ARG_TAG + i, false)?.get("Value");
      const id = v && v.ref;
      for (const lib of MODEL_LIBS) if (this.lib[lib][id]) out.push(this.defLabel(lib, id));
    });
    return out;
  }
  dependents(id) { return this.elements().filter(g => this.argumentIds(g).includes(id)).map(g => this.idOf(g)); }

  /** Dependency order. A cycle is refused by naming it, not by looping. */
  topoOrder() {
    const els = this.elements(), state = new Map(), order = [], cycles = [];
    const visit = (f, stack) => {
      const s = state.get(f);
      if (s === 2) return; if (s === 1) { cycles.push(stack.map(x => this.idOf(x)).concat(this.idOf(f))); return; }
      state.set(f, 1);
      for (const id of this.argumentIds(f)) visit(this.byId.get(id), stack.concat(f));
      state.set(f, 2); order.push(f);
    };
    for (const f of els) visit(f, []);
    return { order, cycles };
  }

  // -------- definitions (types, families, materials, styles …)
  defLabel(lib, id) {
    const k = lib + ":" + id;
    let l = this.defs.get(k);
    if (!l) { l = this.defsLabel.child(this.nextDefTag++).set("AsciiString", k); this.defs.set(k, l); }
    return l;
  }
  setDef(lib, id, data) {
    if (data === undefined) delete this.lib[lib][id]; else this.lib[lib][id] = clone(data);
    if (MODEL_LIBS.includes(lib)) {
      this.log.touch(this.defLabel(lib, id));
      // A family edit reaches every type below it, however deep (§5).
      if (lib === "families") for (const [tid, t] of Object.entries(this.lib.types)) if (this.familyChain(t.family).some(fam => fam.id === id)) this.log.touch(this.defLabel("types", tid));
    } else this.viewRevision++;
  }
  /** The extends chain, root last. Cycles are refused at load (§5). */
  familyChain(famId) {
    const out = [], seen = new Set();
    for (let id = famId; id; ) {
      if (seen.has(id)) throw new Error(`family ${id} extends itself through ${[...seen].join(" → ")}`);
      seen.add(id);
      const fam = this.lib.families[id]; if (!fam) break;
      out.push(Object.assign({ id }, fam)); id = fam.extends;
    }
    return out;
  }
  /** A type with its family chain resolved: child overrides parent. Each value
   *  says where it came from, which the panel shows (§5). */
  resolveType(typeId) {
    const t = this.lib.types[typeId]; if (!t) return null;
    const chain = this.familyChain(t.family);
    const params = {}, origin = {}, specs = {};
    for (let i = chain.length - 1; i >= 0; i--) {
      const fam = chain[i];
      Object.assign(specs, fam.paramSpecs || {});
      for (const [k, v] of Object.entries(fam.paramDefaults || {})) { params[k] = v; origin[k] = fam.name || fam.id; }
    }
    for (const [k, v] of Object.entries(t.params || {})) { params[k] = v; origin[k] = t.name || typeId; }
    const root = chain[chain.length - 1];
    return Object.assign({}, t, { id: typeId, params, origin, specs, chain,
      category: root ? root.category : t.category, system: root ? root.system : null });
  }

  // -------- results
  result(f) { return f.child(RESULT_TAG, false)?.get("Shape") ?? null; }
  data(f) { return f.child(DATA_TAG, false)?.get("Json") ?? null; }
  plan(f) { return f.child(PLAN_TAG, false)?.get("Json") ?? null; }
  elev(f) { return f.child(ELEV_TAG, false)?.get("Json") ?? null; }
  error(f) { return f.child(ERROR_TAG, false)?.get("Text") ?? null; }
  note(f) { return f.child(NOTE_TAG, false)?.get("Text") ?? null; }
  revision(f) { return f.child(REVISION_TAG, false)?.get("Integer") ?? 0; }

  // -------- the solver (phase 2) and system passes (phase 3)
  /** mustExecute: its own label, one of its argument labels, or anything it
   *  references was modified in this cycle (§1.6). */
  mustExecute(f) {
    const log = this.log;
    if (log.isModified(f)) return true;
    for (const l of f.kids.values()) if (l.tag < PARAM_TAG0 && log.isModified(l)) return true;
    for (const id of this.argumentIds(f)) if (log.isModified(this.byId.get(id))) return true;
    for (const d of this.argumentDefs(f)) if (log.isModified(d)) return true;
    return false;
  }
  regenerate() {
    const t0 = now();
    const { order, cycles } = this.topoOrder();
    const cyc = new Set(cycles.flat());
    const rebuilt = new Set();
    for (const f of order) {
      if (!this.mustExecute(f)) continue;
      if (cyc.has(this.idOf(f))) { this.setError(f, `depends on itself: ${cycles.find(c => c.includes(this.idOf(f))).join(" → ")}`); this.log.impact(f); continue; }
      this.execute(f);
      this.log.impact(f);
      rebuilt.add(f);
    }
    // Phase 3 — joins, openings into hosts, spaces. Reads unjoined reps, writes resolved ones.
    for (const pass of this.systemPasses) pass(this, rebuilt);
    this.log.clear();
    this.stats.lastRegen = { ms: now() - t0, rebuilt: [...rebuilt].map(f => this.idOf(f)) };
    return rebuilt;
  }
  /** Contained failure (§1.7): a precondition is a sentence; an exception is
   *  caught here, once, and the last good representation is kept. */
  execute(f) {
    const type = f.get("Type"), B = BUILDERS[type];
    this.stats.builds[type] = (this.stats.builds[type] || 0) + 1;
    f.forget(ERROR_TAG); f.forget(NOTE_TAG);
    if (!B) { this.setError(f, `no driver for ${type}`); return 1; }
    const objection = B.precondition ? B.precondition(f, this) : null;
    if (objection) { this.setError(f, objection); return 1; }
    let built;
    try { built = B.build(f, this) || {}; }
    catch (err) { this.setError(f, describeError(err)); return 1; }
    const set = (tag, attr, v) => { if (v === undefined) return; f.child(tag).set(attr, v); };
    set(RESULT_TAG, "Shape", built.shape === undefined ? null : built.shape);
    set(DATA_TAG, "Json", built.data || {});
    set(PLAN_TAG, "Json", built.plan === undefined ? null : built.plan);
    set(ELEV_TAG, "Json", built.elev === undefined ? null : built.elev);
    if (built.note) f.child(NOTE_TAG).set("Text", built.note);
    f.child(REVISION_TAG).set("Integer", ++this.modelRevision);
    return 0;
  }
  setError(f, msg) { f.child(ERROR_TAG).set("Text", msg); f.child(REVISION_TAG).set("Integer", ++this.modelRevision); }
  setNote(f, msg) { if (msg) f.child(NOTE_TAG).set("Text", msg); else f.forget(NOTE_TAG); }
  bumpView() { this.viewRevision++; }

  // ---------------------------------------------------------------- JSON
  toJSON() {
    const out = Object.assign({}, this.meta);
    for (const k of LIB_ORDER) out[k] = this.lib[k];
    out.elements = this.elements().map(f => this.elementJSON(f));
    out.joins = this.joins; out.constraints = this.constraints;
    out.graph = this.graph; out.browser = this.browser;
    Object.assign(out, this.extra);
    return out;
  }
  /** Arguments by key, in declared order; choices by label; parent on the child. */
  elementJSON(f) {
    const ph = f.get("Placeholder");
    if (ph) return ph;
    const decl = this.declOf(f);
    const rec = { id: this.idOf(f), type: f.get("Type") };
    const name = f.get("Name"); if (name && name !== rec.id) rec.name = name;
    if (f.get("Integer") === 0) rec.visible = false;
    const args = {};
    decl.args.forEach((a, i) => { const v = f.child(FIRST_ARG_TAG + i, false)?.get("Value"); if (v !== undefined) args[a.key] = v; });
    Object.assign(args, f.get("ExtraArgs") || {});
    rec.args = args;
    const params = this.params(f); if (Object.keys(params).length) rec.params = params;
    const parent = f.child(PARENT_TAG, false)?.get("Reference"); if (parent) rec.parent = parent;
    const ap = f.child(APPEARANCE_TAG, false);
    if (ap?.get("Json")) rec.appearance = ap.get("Json");
    if (ap?.get("Overrides")) rec.overrides = ap.get("Overrides");
    return rec;
  }
  serialise() { return JSON.stringify(this.toJSON(), null, 2) + "\n"; }
}

export function loadDocument(input) {
  const src = typeof input === "string" ? JSON.parse(input) : input;
  const doc = new Document();
  const report = doc.loadReport;
  if (src.format && src.format !== "web-bim-document") report.push(`format "${src.format}" read as web-bim-document`);
  for (const k of ["format", "version", "units", "name", "displayUnits"]) if (src[k] !== undefined) doc.meta[k] = src[k];
  let factor = 1;
  if (doc.meta.units && doc.meta.units !== "mm") {
    factor = { m: 1000, cm: 10, in: 25.4, ft: 304.8 }[doc.meta.units];
    if (!factor) throw new Error(`the file says its units are "${doc.meta.units}", which is not mm, cm, m, in or ft`);
  }
  for (const k of LIB_ORDER) doc.lib[k] = clone(src[k] || {});
  // Parameter specs are attributes: the kind set is closed (§4.1, test 37f).
  const checkSpecs = (specs, where) => { for (const [n, s] of Object.entries(specs || {})) if (!ATTRIBUTE_KINDS.includes(s.kind)) throw new Error(`${where} declares parameter "${n}" as ${s.kind}; a parameter's kind is one of ${ATTRIBUTE_KINDS.join(", ")} — geometry belongs in driver arguments`); };
  checkSpecs(doc.lib.paramSpecs, "the document");
  for (const [id, fam] of Object.entries(doc.lib.families)) { checkSpecs(fam.paramSpecs, `family ${id}`); doc.familyChain(id); }
  for (const k of MODEL_LIBS) for (const id of Object.keys(doc.lib[k])) doc.log.touch(doc.defLabel(k, id));
  // Load every label first …
  let bad = 0;
  for (const raw of src.elements || []) {
    try {
      if (!raw || typeof raw !== "object" || typeof raw.type !== "string" || typeof raw.id !== "string" || (raw.args && typeof raw.args !== "object")) throw new Error("not an element record (it needs an id, a type and an args object)");
      const rec = factor === 1 ? raw : convertUnits(raw, factor);
      doc.addElement(rec);
    } catch (err) {
      // One bad entity must not lose the file (§2.4): a placeholder carrying its raw JSON.
      bad++;
      const id = (raw && typeof raw.id === "string" && !doc.byId.has(raw.id)) ? raw.id : `BAD${bad}`;
      const f = doc.addElement({ id, type: "__placeholder__", raw });
      f.child(ERROR_TAG).set("Text", `could not be read: ${err.message}`);
    }
  }
  if (bad) report.push(`${bad} element${bad > 1 ? "s" : ""} could not be read`);
  if (factor !== 1) { report.push(`converted from ${doc.meta.units} to mm once, on read (×${factor})`); doc.meta.units = "mm"; }
  // … wire second. Dangling references become notes on the holder (§2.3).
  doc.joins = clone(src.joins || []); doc.constraints = clone(src.constraints || []);
  doc.graph = clone(src.graph || { layout: {} }); doc.browser = clone(src.browser || {});
  const knownTop = new Set(["format", "version", "units", "name", "elements", "joins", "constraints", "graph", "browser", ...LIB_ORDER]);
  for (const [k, v] of Object.entries(src)) if (!knownTop.has(k)) doc.extra[k] = clone(v);
  return doc;
}

/** Names of references that do not resolve — for the load note (§2.3). */
export function danglingRefs(doc, f) {
  const decl = doc.declOf(f); if (!decl) return [];
  const out = [];
  decl.args.forEach((a, i) => {
    const v = f.child(FIRST_ARG_TAG + i, false)?.get("Value");
    const ids = []; collectRefs(v, ids);
    for (const id of ids) {
      const found = doc.byId.has(id) || Object.values(doc.lib).some(lib => lib[id]);
      if (!found) out.push(`${a.label} → ${id}`);
    }
  });
  return out;
}

// ---------------------------------------------------------------- accessors
//! Drivers read arguments only through these (§1.3 rule 1).
export const F = {
  doc: null,
  raw: (f, key) => F.doc.argValue(f, key),
  real(f, key) {
    const v = F.doc.argValue(f, key);
    if (v && typeof v === "object") {
      if (v.ref) {
        const g = F.doc.element(v.ref);
        const d = g && F.doc.data(g);
        if (!g) throw new Error(`${key} is bound to ${v.ref}, which is not in the document`);
        if (F.doc.error(g)) throw new Error(`${key} is bound to ${v.ref}, which has an error`);
        return d ? d.value : NaN;
      }
      if (typeof v.v === "number") return v.v;
    }
    return typeof v === "number" ? v : Number(v);
  },
  int: (f, key) => Math.round(F.real(f, key)),
  bool: (f, key) => !!F.doc.argValue(f, key),
  text: (f, key) => { const v = F.doc.argValue(f, key); return v == null ? "" : String(v); },
  choice: (f, key) => F.doc.argValue(f, key),
  refId: (f, key) => { const v = F.doc.argValue(f, key); return v && v.ref ? v.ref : null; },
  reference: (f, key) => { const id = F.refId(f, key); return id ? F.doc.element(id) : null; },
  json: (f, key) => F.doc.argValue(f, key),
  point: (f, key) => F.doc.argValue(f, key),
  type: (f, key) => { const id = F.refId(f, key); return id ? F.doc.resolveType(id) : null; },
};

// ---------------------------------------------------------------- expressions over the document
/** Resolve a name as an expression sees it: an element by id or name, a
 *  dotted property (`W1.Length`, `L0.elevation`, `Level.Name` from `self`). */
export function documentLookup(doc, self = null) {
  return name => {
    const parts = name.split(".");
    let target = null, rest = parts;
    if (parts[0] === "Level" && self) { const lv = F.reference(self, "baseLevel") || F.reference(self, "level"); if (lv) { target = lv; rest = parts.slice(1); } }
    if (!target) {
      const byId = doc.element(parts[0]) || doc.elements().find(g => g.get("Name") === parts[0]);
      if (byId) { target = byId; rest = parts.slice(1); }
    }
    if (!target && self) { const own = propertyOf(doc, self, name); if (own !== undefined) return own; }
    if (!target) return undefined;
    if (!rest.length) {
      if (doc.error(target)) return { error: doc.error(target) };
      const d = doc.data(target); return d && d.value !== undefined ? valueFrom(d) : undefined;
    }
    return propertyOf(doc, target, rest.join("."));
  };
}
const valueFrom = d => typeof d.value === "string" ? { kind: "Text", v: d.value } : { kind: d.kind || "Number", v: d.value };
/** One element property by name: computed data, then arguments, then parameters, then type parameters. */
export function propertyOf(doc, f, key) {
  if (key === "Name") return { kind: "Text", v: f.get("Name") };
  if (key === "Id") return { kind: "Text", v: doc.idOf(f) };
  const d = doc.data(f);
  if (d && d.props && d.props[key] !== undefined) return d.props[key];
  const decl = doc.declOf(f);
  const a = decl && decl.args.find(x => x.key === key);
  if (a && (a.kind === "Real" || a.kind === "Integer")) { try { return { kind: a.quantity === "Integer" ? "Number" : a.quantity, v: (F.doc = doc, F.real(f, key)) }; } catch (e) { return { error: e.message }; } }
  if (a && (a.kind === "Text" || a.kind === "Choice")) return { kind: "Text", v: String(doc.argValue(f, key)) };
  const p = doc.getParam(f, key);
  if (p !== undefined) return evalParam(doc, f, p);
  for (const tk of ["wallType", "doorType", "windowType", "columnType", "floorType", "beamType"]) {
    const id = a ? null : (decl && decl.args.some(x => x.key === tk) ? (doc.argValue(f, tk) || {}).ref : null);
    if (id) { const t = doc.resolveType(id); if (t && t.params[key] !== undefined) return evalParam(doc, f, t.params[key]); if (key === "TypeMark" && t) return { kind: "Text", v: t.mark || t.name || id }; }
  }
  return undefined;
}
/** A parameter value may itself be a text/number expression: {expr:"…"}. */
export function evalParam(doc, f, p) {
  if (p && typeof p === "object" && typeof p.expr === "string") {
    try { return evaluate(parse(p.expr), { lookup: documentLookup(doc, f), into: p.kind || "Text" }); }
    catch (e) { return { error: e.message }; }
  }
  if (typeof p === "number") return { kind: "Number", v: p };
  if (typeof p === "boolean") return { kind: "Boolean", v: p };
  return { kind: "Text", v: String(p) };
}
export function displayParam(doc, f, p) { const v = evalParam(doc, f, p); return v && v.error ? `⚠ ${v.error}` : formatValue(v); }

// ---------------------------------------------------------------- helpers
export function collectRefs(v, out) {
  if (!v || typeof v !== "object") return out;
  if (Array.isArray(v)) { v.forEach(x => collectRefs(x, out)); return out; }
  if (typeof v.ref === "string") out.push(v.ref);
  for (const [k, x] of Object.entries(v)) if (k !== "ref" && x && typeof x === "object") collectRefs(x, out);
  return out;
}
export function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
export function describeError(err) {
  if (err instanceof ExprError) return err.message;
  const m = err && err.message ? err.message : String(err);
  return m.charAt(0).toLowerCase() + m.slice(1);
}
function convertUnits(rec, k) {
  const out = clone(rec), decl = CATALOGUE.get(rec.type);
  if (!decl || !out.args) return out;
  const scalePts = v => Array.isArray(v) ? (typeof v[0] === "number" ? v.map(x => x * k) : v.map(scalePts)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, ["start", "end", "centre", "points", "at", "anchor", "position", "target", "elbow"].includes(a) ? scalePts(b) : a === "radius" || a === "rx" || a === "ry" ? b * k : b])) : v;
  for (const a of decl.args) {
    const v = out.args[a.key]; if (v === undefined) continue;
    if (a.kind === "Real" && a.quantity === "Length" && typeof v === "number") out.args[a.key] = v * k;
    else if (a.kind === "Curve2D" || a.kind === "Point2D") out.args[a.key] = scalePts(v);
  }
  return out;
}
function newStats() { return { builds: {}, offsets: 0, cuts: 0, sections: 0, surfacePath: 0, fastPath: 0, derives: 0, lastRegen: null }; }
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
