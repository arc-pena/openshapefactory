//! Every edit goes through one pipeline with a JSON op vocabulary (§1.8):
//!   add · delete · set · connect · disconnect · rename · appearance · draw ·
//!   drag · relate · place · sheet · style · filter · import · model · type · undo · redo
//! A model file and an edit script are the same kind of thing, so a test
//! fixture, a sample and an assistant all use this path. Consecutive edits with
//! the same coalescing key collapse into one undo step.

import { bareFactor, LENGTH_UNITS, setLengthUnit } from "./units.js";
import { TOL, add, sub, mul, dot, dist, perp, normalise, lineThrough, signedDistance, offsetLine, rot, len, cross, intersectLines, samplePath } from "./geom2d.js";
import { parse, namesIn, evaluate, saysFormula, readValue, ExprError, formatValue } from "./expr.js";
import { CATALOGUE, F, clone, documentLookup, MODEL_LIBS } from "./ocaf.js";
import { resolveReference, orthoLine, importPlacer, importLayerMap } from "./bim.js";
import { outline } from "./bimsketch.js";

export class Editor {
  constructor(doc) {
    this.doc = doc; this.undoStack = []; this.redoStack = []; this.lastKey = null; this.listeners = [];
    this.lastResult = null;
  }
  on(fn) { this.listeners.push(fn); }
  emit(r) { for (const fn of this.listeners) fn(r); }

  /** Apply one op (or a list) as one step. Returns {ok, error?, conflicts?, ...}. */
  apply(op, { regenerate = true, coalesce = null } = {}) {
    const ops = Array.isArray(op) ? op : [op];
    const key = coalesce || (ops.length === 1 ? ops[0].coalesce || null : null);
    const snap = snapshot(this.doc);
    let result = { ok: true };
    try {
      for (const o of ops) {
        const h = HANDLERS[o.op];
        if (!h) throw new Error(`"${o.op}" is not an edit this document understands`);
        const r = h(this.doc, o, this);
        if (r && r.conflicts) { restore(this.doc, snap); this.doc.regenerate(); return this.finish({ ok: false, conflicts: r.conflicts, error: r.error }); }
        result = Object.assign(result, r || {});
      }
    } catch (err) {
      restore(this.doc, snap);
      if (regenerate) this.doc.regenerate();
      return this.finish({ ok: false, error: err.message, at: err.at });
    }
    if (!(key && key === this.lastKey)) { this.undoStack.push(snap); if (this.undoStack.length > 400) this.undoStack.shift(); }
    this.redoStack = [];
    this.lastKey = key;
    if (regenerate) this.doc.regenerate();
    return this.finish(result);
  }
  /** Ends a coalescing run (pointer-up): the next edit starts a new step. */
  seal() { this.lastKey = null; }
  undo() { if (!this.undoStack.length) return this.finish({ ok: false, error: "nothing to undo" }); const cur = snapshot(this.doc); restore(this.doc, this.undoStack.pop()); this.redoStack.push(cur); this.lastKey = null; this.doc.regenerate(); return this.finish({ ok: true, undo: true }); }
  redo() { if (!this.redoStack.length) return this.finish({ ok: false, error: "nothing to redo" }); const cur = snapshot(this.doc); restore(this.doc, this.redoStack.pop()); this.undoStack.push(cur); this.lastKey = null; this.doc.regenerate(); return this.finish({ ok: true, redo: true }); }
  finish(r) { this.lastResult = r; this.emit(r); return r; }
}

// ---------------------------------------------------------------- snapshots
export function snapshot(doc) {
  const els = new Map();
  for (const f of doc.elements()) els.set(doc.idOf(f), JSON.stringify(doc.elementJSON(f)));
  return { els, lib: JSON.stringify(doc.lib), libObj: null, joins: JSON.stringify(doc.joins), constraints: JSON.stringify(doc.constraints), graph: JSON.stringify(doc.graph), browser: JSON.stringify(doc.browser), name: doc.meta.name, units: doc.meta.displayUnits };
}
/** Restore by difference, so labels keep their tags and only what changed is touched. */
export function restore(doc, snap) {
  const cur = new Set(doc.elements().map(f => doc.idOf(f)));
  for (const id of cur) if (!snap.els.has(id)) doc.removeElement(id);
  for (const [id, s] of snap.els) {
    const rec = JSON.parse(s);
    const f = doc.element(id);
    if (!f) { doc.addElement(rec); continue; }
    if (JSON.stringify(doc.elementJSON(f)) === s) continue;
    const decl = doc.declOf(f);
    if (!decl || f.get("Type") !== rec.type) { doc.removeElement(id); doc.addElement(rec); continue; }
    for (const a of decl.args) { const v = rec.args[a.key]; if (JSON.stringify(doc.argValue(f, a.key)) !== JSON.stringify(v)) doc.setArg(f, a.key, v === undefined ? clone(a.def) : v); }
    f.set("Name", rec.name || id); f.set("Integer", rec.visible === false ? 0 : 1);
    const had = doc.params(f), want = rec.params || {};
    for (const k of new Set([...Object.keys(had), ...Object.keys(want)])) if (JSON.stringify(had[k]) !== JSON.stringify(want[k])) doc.setParam(f, k, want[k]);
    const ap = f.child(52); ap.set("Json", rec.appearance); ap.set("Overrides", rec.overrides);
    doc.log.touch(f);
  }
  const lib = JSON.parse(snap.lib);
  for (const k of Object.keys(lib)) {
    const a = doc.lib[k] || {}, b = lib[k];
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[id]) !== JSON.stringify(b[id])) doc.setDef(k, id, b[id]);
  }
  if (JSON.stringify(doc.joins) !== snap.joins || JSON.stringify(doc.constraints) !== snap.constraints) doc.relationRevision++;
  doc.joins = JSON.parse(snap.joins); doc.constraints = JSON.parse(snap.constraints);
  doc.graph = JSON.parse(snap.graph); doc.browser = JSON.parse(snap.browser); doc.meta.name = snap.name; if (snap.units === undefined) delete doc.meta.displayUnits; else doc.meta.displayUnits = snap.units; setLengthUnit(doc.meta.displayUnits || "mm");
  doc.bumpView();
}

// ---------------------------------------------------------------- value paths
/** "centreline.end" → deep set inside an argument's JSON value. */
function setPath(doc, f, key, value) {
  const [head, ...rest] = key.split(".");
  if (head === "params") { doc.setParam(f, rest.join("."), value); return; }
  if (head === "Name") { f.set("Name", String(value)); doc.bumpView(); doc.log.touch(f); return; }
  if (head === "visible") { f.set("Integer", value ? 1 : 0); doc.bumpView(); return; }
  if (!rest.length) { doc.setArg(f, head, value); return; }
  const v = clone(doc.argValue(f, head));
  let o = v; for (let i = 0; i < rest.length - 1; i++) { if (o[rest[i]] == null) o[rest[i]] = {}; o = o[rest[i]]; }
  o[rest[rest.length - 1]] = value;
  doc.setArg(f, head, v);
}
export function getPath(doc, f, key) {
  const [head, ...rest] = key.split(".");
  if (head === "params") return doc.getParam(f, rest.join("."));
  let o = doc.argValue(f, head); for (const k of rest) o = o == null ? undefined : o[k];
  return o;
}

/** What a person typed into a numeric field becomes: a literal, a literal that
 *  remembers its arithmetic, or — when it references something — an Expression
 *  element wired to the field (§4.1 promotion). Returns the stored value. */
export function valueFromText(doc, f, arg, textIn, editor) {
  const src = String(textIn).trim();
  const q = arg.quantity === "Integer" ? "Number" : arg.quantity;
  let tree;
  try { tree = parse(src); } catch (e) { throw e; }
  const names = namesIn(tree);
  if (!names.length) {
    const v = evaluate(tree, { into: q, bare: bareFactor(doc.meta.displayUnits || "mm") });
    if (q === "Length" && v.kind !== "Length" && v.kind !== "Number") throw new ExprError(`this field wants a length; that is ${v.kind === "Angle" ? "an angle" : "a " + v.kind.toLowerCase()}`);
    const num = arg.kind === "Integer" ? Math.round(v.v) : v.v;
    return saysFormula(src) ? { v: num, expr: src } : num;
  }
  // References something: check it evaluates now (and say which name is wrong if not) …
  const self = f;
  const bareUnit = doc.meta.displayUnits || "mm";
  evaluate(tree, { lookup: documentLookup(doc, self), into: q, bare: bareFactor(bareUnit) });
  // … and promote it. An existing expression with the same text is shared.
  const same = doc.elements().find(g => doc.typeOf(g) === "Expression" && doc.argValue(g, "formula") === src && doc.argValue(g, "quantity") === (q || "Number") && (doc.argValue(g, "bareUnit") || "mm") === bareUnit);
  if (same) return { ref: doc.idOf(same) };
  const id = doc.freshId("Expression");
  doc.addElement({ id, type: "Expression", name: `${doc.idOf(f)}.${arg.key}`, args: { formula: src, quantity: q === "Integer" ? "Number" : (q || "Number"), bareUnit } });
  return { ref: id };
}

// ---------------------------------------------------------------- handlers
const HANDLERS = {
  add(doc, o) {
    const rec = clone(o.element);
    if (!CATALOGUE.has(rec.type)) throw new Error(`there is no element type called ${rec.type}`);
    if (!rec.id) rec.id = doc.freshId(rec.type);
    doc.addElement(rec);
    return { id: rec.id };
  },
  delete(doc, o) {
    const ids = [].concat(o.id || o.ids);
    const gone = new Set();
    const cascade = id => {
      if (gone.has(id) || !doc.element(id)) return; gone.add(id);
      // hosted things go with their host: an opening in a deleted wall, a door in a deleted opening
      for (const g of doc.elements()) {
        const t = doc.typeOf(g);
        if ((t === "Opening" && F.refId(g, "host") === id) || ((t === "Door" || t === "Window") && F.refId(g, "fills") === id)) cascade(doc.idOf(g));
      }
      // …and a sheet's viewport of a deleted view
      for (const g of doc.elements()) if (doc.typeOf(g) === "Sheet") {
        const vps = doc.argValue(g, "viewports") || [];
        if (vps.some(v => v.view && v.view.ref === id)) doc.setArg(g, "viewports", vps.filter(v => !(v.view && v.view.ref === id)));
      }
    };
    ids.forEach(cascade);
    for (const id of gone) doc.removeElement(id);
    return { deleted: [...gone] };
  },
  set(doc, o, ed) {
    const ids = [].concat(o.ids || o.id);
    for (const id of ids) {
      const f = doc.element(id); if (!f) throw new Error(`there is no element ${id}`);
      let value = o.value;
      if (o.text !== undefined) {
        const decl = doc.declOf(f), arg = decl && decl.args.find(a => a.key === o.key);
        if (arg && (arg.kind === "Real" || arg.kind === "Integer")) value = valueFromText(doc, f, arg, o.text, ed);
        else value = o.text;
      }
      setPath(doc, f, o.key, value);
      // a door or window sizes its opening: changing its type resizes the hole to the new type
      if ((o.key === "doorType" || o.key === "windowType") && value && value.ref) sizeOpeningsToType(doc, [f]);
      // ticking a grid's Orthogonal straightens it onto the nearest axis, about its start
      if (doc.typeOf(f) === "Grid" && o.key === "orthogonal" && value) setPath(doc, f, "line", orthoLine(doc.argValue(f, "line")));
      // a level moved drags the levels padlocked to it, keeping each locked height
      if (doc.typeOf(f) === "Level" && o.key === "elevation") holdLevelGaps(doc, id);
    }
    return {};
  },
  unbind(doc, o) {
    const f = doc.element(o.id); const v = doc.argValue(f, o.key);
    if (!v || !v.ref) return { said: `${o.key} is not bound` };
    const ex = doc.element(v.ref), val = ex ? (doc.data(ex) || {}).value : undefined;
    const formula = ex ? doc.argValue(ex, "formula") : v.ref;
    doc.setArg(f, o.key, typeof val === "number" ? val : 0);
    return { said: `${o.key} was bound to ${v.ref} (${formula}); it is now the literal ${typeof val === "number" ? Math.round(val * 1000) / 1000 : 0}` };
  },
  /** Pin or unpin: a pinned element cannot be dragged, moved, rotated or mirrored. */
  pin(doc, o) {
    const ids = [].concat(o.ids || o.id), done = [];
    for (const id of ids) { const f = doc.element(id); if (!f) continue; const decl = doc.declOf(f); if (!decl || !decl.args.some(a => a.key === "pinned")) continue; doc.setArg(f, "pinned", !!o.value); done.push(id); }
    if (!done.length) throw new Error("nothing selected can be pinned");
    return { said: `${done.join(", ")} ${o.value ? "pinned" : "unpinned"}` };
  },
  /** Explode an import: its elements become detail lines in its view, each keeping its layer (and colour);
   *  texts become text notes, fills filled regions. The import itself goes. */
  explode(doc, o) {
    const f = doc.element(o.id); if (!f || doc.typeOf(f) !== "CADImport") throw new Error("explode works on an imported CAD drawing");
    const d = F.json(f, "drawing") || {}, ls = importLayerMap(f), P = importPlacer(f), view = F.refId(f, "view"), made = [];
    const add = (type, args, name) => { const id = doc.freshId(type); doc.addElement({ id, type, name, args }); made.push(id); };
    const deg = r => r * 180 / Math.PI;
    for (const el of d.elements || []) {
      if (ls[el.layer || "0"] && !ls[el.layer || "0"].on) continue;          // a layer switched off is not exploded into lines
      const layer = el.layer || "0", colour = (ls[layer] && ls[layer].colour) || "#000000", base = { view: view ? { ref: view } : null, layer, colour, pen: "thin" };
      let curve;
      if (el.type === "line") curve = { type: "line", start: P(el.a), end: P(el.b) };
      else if (el.type === "arc" || el.type === "circle") {
        const k = F.real(f, "scale") || 1, rot = F.real(f, "rotation") || 0, c = P(el.c), a0 = el.type === "arc" ? deg(el.a0) : 0, a1 = el.type === "arc" ? deg(el.a1) : 180;
        curve = { type: "arc", centre: c, radius: el.r * k, start: a0 + rot, end: a1 + rot, ccw: true };
        if (el.type === "circle") add("DetailLine", Object.assign({ curve: { type: "arc", centre: c, radius: el.r * k, start: 180 + rot, end: 360 + rot, ccw: true } }, base));
      } else { const pts = outline(el, 48).map(P); curve = { type: "spline", points: pts.filter((_, i, A) => i % 3 === 0 || i === A.length - 1) }; }
      add("DetailLine", Object.assign({ curve }, base));
    }
    for (const t of d.texts || []) add("Text", { content: t.text, position: P(t.at), rotation: (t.rot || 0) + (F.real(f, "rotation") || 0), view: view ? { ref: view } : null }, null);
    for (const fl of d.fills || []) { const pts = samplePath(fl.path).map(P); if (pts.length > 2) add("FilledRegion", { boundary: pts, pattern: doc.lib.patterns["P-SOLID"] ? "P-SOLID" : Object.keys(doc.lib.patterns)[0], view: view ? { ref: view } : null }, null); }
    doc.removeElement(o.id);
    return { ids: made, said: `${o.id} exploded into ${made.length} elements, layers kept` };
  },
  /** The project's display unit: how lengths are written, never what they are (the model is mm). */
  units(doc, o) {
    if (!LENGTH_UNITS[o.value]) throw new Error(`there is no unit setting "${o.value}" - try ${Object.keys(LENGTH_UNITS).join(", ")}`);
    doc.meta.displayUnits = o.value; setLengthUnit(o.value); doc.bumpView();
    return {};
  },
  rename(doc, o) {
    const f = doc.element(o.id); if (!f) throw new Error(`there is no element ${o.id}`);
    f.set("Name", o.name); doc.log.touch(f); doc.bumpView();
    // Expressions naming it by name re-evaluate (test 37j): touch them.
    for (const g of doc.elements()) if (doc.typeOf(g) === "Expression") doc.log.touch(g);
    return {};
  },
  connect(doc, o) { const f = doc.element(o.id); doc.setArg(f, o.key, { ref: o.to }); return {}; },
  disconnect(doc, o) { const f = doc.element(o.id); doc.setArg(f, o.key, null); return {}; },
  appearance(doc, o) { const f = doc.element(o.id); f.child(52).set("Json", o.value); doc.bumpView(); return {}; },
  /** Library edits: types and families rebuild geometry; the rest are drawing only. */
  type(doc, o) {
    const cur = clone(doc.lib[o.lib][o.id]);
    if (o.remove) { doc.setDef(o.lib, o.id, undefined); return {}; }
    if (o.path) { let x = cur; const ks = o.path.split("."); for (let i = 0; i < ks.length - 1; i++) x = x[ks[i]]; x[ks[ks.length - 1]] = o.value; doc.setDef(o.lib, o.id, cur); }
    else doc.setDef(o.lib, o.id, o.value);
    // a door or window type that changes size resizes every opening its instances fill
    if (o.lib === "types") sizeOpeningsToType(doc, doc.elements().filter(g => (doc.typeOf(g) === "Door" || doc.typeOf(g) === "Window") && (F.refId(g, "doorType") === o.id || F.refId(g, "windowType") === o.id)));
    return {};
  },
  style(doc, o) { return HANDLERS.type(doc, Object.assign({}, o, { lib: "viewStyles" })); },
  filter(doc, o) { return HANDLERS.type(doc, Object.assign({}, o, { lib: "viewStyles" })); },
  relate(doc, o) {
    // join and constraint rows: the two relationship stores (§1.5)
    const store = o.store === "joins" ? doc.joins : doc.constraints;
    if (o.remove) { const i = store.findIndex(r => r.id === o.remove); if (i >= 0) store.splice(i, 1); }
    else if (o.row) {
      const row = clone(o.row); if (!row.id) { let n = 1; const p = o.store === "joins" ? "J" : "C"; while (store.some(r => r.id === p + n)) n++; row.id = p + n; }
      const i = store.findIndex(r => r.id === row.id); if (i >= 0) store[i] = row; else store.push(row);
    }
    doc.relationRevision++;
    return {};
  },
  place(doc, o) {
    // a viewport onto a sheet. A model view sits on one sheet only (§11).
    const sh = doc.element(o.sheet);
    const view = doc.element(o.view);
    if (!sh || !view) throw new Error("place needs a sheet and a view");
    const kind = doc.typeOf(view);
    if (kind !== "Schedule") for (const g of doc.elements()) if (doc.typeOf(g) === "Sheet" && g !== sh && (doc.argValue(g, "viewports") || []).some(v => v.view.ref === o.view))
      throw new Error(`${view.get("Name")} is already on sheet ${doc.argValue(g, "number")}; a model view can be placed on one sheet only`);
    const vps = clone(doc.argValue(sh, "viewports") || []);
    let n = 1; while (vps.some(v => v.id === "VP" + n)) n++;
    vps.push({ id: "VP" + n, view: { ref: o.view }, at: o.at || [200, 200], clipVisible: false });
    doc.setArg(sh, "viewports", vps); doc.bumpView();
    return { id: "VP" + n };
  },
  sheet(doc, o) { const sh = doc.element(o.id); const vps = clone(doc.argValue(sh, "viewports")); const vp = vps.find(v => v.id === o.viewport); if (o.remove) vps.splice(vps.indexOf(vp), 1); else Object.assign(vp, o.value); doc.setArg(sh, "viewports", vps); doc.bumpView(); return {}; },
  model(doc, o) { throw new Error("replace the whole model through openDocument, not as an edit"); },
  /** Move · copy · rotate · mirror, for any element with a placement. One op
   *  for the plan, the 3D view, the keyboard and the tests. */
  transform(doc, o) {
    const ids = [].concat(o.ids || o.id).filter(id => doc.element(id));
    const T = transformer(o);
    if (!T) throw new Error("transform needs move, rotate or mirror");
    const skipped = [];
    if (o.copy) return copyElements(doc, ids, T);
    const before = new Map(), pinned = [];
    for (const id of ids) {
      const f = doc.element(id), k = geomKey(f, doc);
      // a pinned element stays where it is: Move, Rotate, Mirror and dragging all leave it
      if (isPinned(doc, f)) { pinned.push(id); continue; }
      if (doc.typeOf(f) === "CADImport") {
        // an import moves by its origin: the offset follows the transform, a rotation turns it too
        const o0 = [F.real(f, "offsetX") || 0, F.real(f, "offsetY") || 0], o1 = T.P(o0);
        doc.setArg(f, "offsetX", o1[0]); doc.setArg(f, "offsetY", o1[1]);
        if (o.rotate) doc.setArg(f, "rotation", (F.real(f, "rotation") || 0) + o.rotate.a * 180 / Math.PI);
        continue;
      }
      if (!k) { skipped.push(id); continue; }
      const g = doc.argValue(f, k);
      if (doc.typeOf(f) === "Wall") before.set(id, clone(g));
      doc.setArg(f, k, T.geom(g, doc.typeOf(f)));
      transformExtras(doc, f, T);
    }
    followJoins(doc, new Set(ids), before);
    // padlocked dimensions hold: what is locked to the moved elements comes along (§10.5)
    const movedIds = ids.filter(id => !skipped.includes(id) && !pinned.includes(id));
    if (movedIds.length) {
      const res = propagate(doc, movedIds);
      if (res.conflicts.length) return { conflicts: res.conflicts, error: res.conflicts.map(c => c.say).join("; ") };
      for (const [id, cl] of res.set) if (!movedIds.includes(id)) { const g = doc.element(id), bw = doc.typeOf(g) === "Wall" ? clone(doc.argValue(g, "centreline")) : null; doc.setArg(g, geomKey(g, doc), cl); if (bw) followJoins(doc, new Set([id]), new Map([[id, bw]])); movedIds.push(id); }
    }
    if (pinned.length && !movedIds.length && ids.every(id => pinned.includes(id) || skipped.includes(id))) throw new Error(`${pinned.join(", ")} ${pinned.length > 1 ? "are" : "is"} pinned - unpin ${pinned.length > 1 ? "them" : "it"} to move (UP, or the pin)`);
    return { moved: movedIds, said: pinned.length ? `${pinned.join(", ")} pinned: left where ${pinned.length > 1 ? "they are" : "it is"}` : skipped.length ? `${skipped.join(", ")} move with their host — drag their handle instead` : undefined };
  },
  /** Node positions ride in the file, so undo restores layout too. */
  layout(doc, o) { if (o.reset) doc.graph.layout = {}; else doc.graph.layout[o.id] = o.at; return {}; },
  /** A drag: the handle computes a value; constraints propagate from the
   *  pinned element; conflicts are named and nothing is applied (§10.5). */
  drag(doc, o) {
    const f = doc.element(o.id);
    if (isPinned(doc, f)) throw new Error(`${o.id} is pinned - unpin it to move it (UP, or click its pin)`);
    // Dragging a note moves the text and its elbows, never what it points at (§9.2).
    if (doc.typeOf(f) === "Text" && o.key === "position") {
      const was = doc.argValue(f, "position"), d = sub(o.value, was);
      const leaders = clone(doc.argValue(f, "leaders") || []).map(L => Object.assign(L, L.elbow ? { elbow: add(L.elbow, d) } : {}));
      doc.setArg(f, "leaders", leaders);
    }
    const before = clone(doc.argValue(f, "centreline"));
    setPath(doc, f, o.key, o.value);
    // Joined ends follow: drag a wall and the walls joined to it stretch with it.
    if (doc.typeOf(f) === "Wall" && before && o.follow !== false) followJoins(doc, new Set([o.id]), new Map([[o.id, before]]));
    const res = propagate(doc, o.id);
    if (res.conflicts.length) return { conflicts: res.conflicts, error: res.conflicts.map(c => c.say).join("; ") };
    for (const [id, cl] of res.set) if (id !== o.id) { const g = doc.element(id); doc.setArg(g, geomKey(g, doc), cl); }
    return { moved: [...res.set.keys()].filter(id => id !== o.id) };
  },
  /** Keep joins true to the geometry after an end moves (§10.9): release the join
   *  it left, and make the one it arrived at — a shared corner with a nearby end,
   *  or a T where it lands anywhere inside another wall's thickness. */
  autojoin(doc, o) {
    const made = [], released = [];
    for (const { id, end } of o.ends || []) {
      const f = doc.element(id); if (!f || doc.typeOf(f) !== "Wall") continue;
      const c = clone(doc.argValue(f, "centreline")); if (!c || c.type !== "line") continue;
      const here = r => r && r.of === id && r.end === end;
      const mine = doc.joins.filter(j => here(j.a) || here(j.b));
      // a disallowed or hand-set join is the user's decision: leave it alone
      if (mine.some(j => j.allowed === false || (j.kind && j.kind !== "auto"))) continue;
      const still = mine.filter(j => joinHolds(doc, j));
      for (const j of mine) if (!still.includes(j)) { doc.joins.splice(doc.joins.indexOf(j), 1); released.push(j.b.of === id ? j.a.of : j.b.of); }
      if (still.length) continue;
      const hit = findJoin(doc, id, end, c);
      if (!hit) continue;
      if (dist(hit.p, c[end]) > 1e-9) { c[end] = hit.p; doc.setArg(f, "centreline", c); }
      for (const m of hit.moveOther || []) { const g = doc.element(m.id), gc = clone(doc.argValue(g, "centreline")); gc[m.end] = hit.p; doc.setArg(g, "centreline", gc); }
      for (const row of hit.rows) HANDLERS.relate(doc, { store: "joins", row: Object.assign(row, { kind: "auto", order: 0, allowed: true }) });
      made.push(hit.what);
    }
    doc.relationRevision++;
    return { joined: made, released, said: made.length ? `Joined: ${made.join("; ")}` : released.length ? `Join released from ${[...new Set(released)].join(", ")}` : undefined };
  },
  draw(doc, o) {
    // Chain-draw walls: click, click, click (§10.9). Each vertex shares a node
    // with an existing end (L join), lands on a centreline (T join, never a
    // split), or is free.
    const pts = o.points; const ids = [];
    const snapNode = p => {
      for (const g of doc.elements()) if (doc.typeOf(g) === "Wall") { const c = doc.argValue(g, "centreline"); if (c.type !== "line") continue;
        if (dist(c.start, p) <= (o.tol || 1)) return { of: doc.idOf(g), end: "start" }; if (dist(c.end, p) <= (o.tol || 1)) return { of: doc.idOf(g), end: "end" }; }
      for (const g of doc.elements()) if (doc.typeOf(g) === "Wall") { const c = doc.argValue(g, "centreline"); if (c.type !== "line") continue;
        const L = lineThrough(c.start, c.end), t = dot(sub(p, c.start), L.d), l = dist(c.start, c.end);
        if (t > 1 && t < l - 1 && Math.abs(signedDistance(L, p)) <= (o.tol || 1)) return { of: doc.idOf(g), u: t }; }
      return null;
    };
    const n = o.closed ? pts.length : pts.length - 1;
    const first = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (dist(a, b) < TOL) continue;
      const at0 = snapNode(a), at1 = snapNode(b);
      const id = doc.freshId("Wall");
      doc.addElement({ id, type: "Wall", args: Object.assign({ centreline: { type: "line", start: a, end: b }, mounting: o.mounting || "Centred", wallType: { ref: o.wallType }, baseLevel: { ref: o.level }, height: o.height || 3000 }, o.args || {}) });
      ids.push(id);
      if (i === 0 && at0) first.push(at0.u !== undefined ? { a: { of: id, end: "start" }, b: at0 } : { a: { of: id, end: "start" }, b: at0 });
      if (at1 && !(o.closed && i === n - 1)) HANDLERS.relate(doc, { store: "joins", row: at1.u !== undefined ? { a: { of: id, end: "end" }, b: at1, kind: "auto", order: 0, allowed: true } : { a: { of: id, end: "end" }, b: at1, kind: "auto", order: 0, allowed: true } });
      if (i > 0) HANDLERS.relate(doc, { store: "joins", row: { a: { of: ids[ids.length - 2], end: "end" }, b: { of: id, end: "start" }, kind: "auto", order: 0, allowed: true } });
    }
    for (const r of first) HANDLERS.relate(doc, { store: "joins", row: Object.assign(r, { kind: "auto", order: 0, allowed: true }) });
    if (o.closed && ids.length > 1) HANDLERS.relate(doc, { store: "joins", row: { a: { of: ids[ids.length - 1], end: "end" }, b: { of: ids[0], end: "start" }, kind: "auto", order: 0, allowed: true } });
    // a chain that stops on a wall's face (not only on its location line) still joins it
    if (!o.closed && ids.length) HANDLERS.autojoin(doc, { ends: [{ id: ids[0], end: "start" }, { id: ids[ids.length - 1], end: "end" }] });
    return { ids };
  },
};
export { HANDLERS };

// ---------------------------------------------------------------- automatic joins
function lineWall(doc, g) {
  if (doc.typeOf(g) !== "Wall") return null;
  const c = doc.argValue(g, "centreline"); if (!c || c.type !== "line") return null;
  const L = dist(c.start, c.end); if (L < TOL) return null;
  const w = doc.plan(g), sv = w && w.stack && w.stack.s && w.stack.s.length ? w.stack.s : [-100, 100];
  return { id: doc.idOf(g), c, L, line: lineThrough(c.start, c.end), sMin: Math.min(...sv), sMax: Math.max(...sv), half: Math.max(...sv.map(Math.abs)) };
}
/** Does a join row still describe the geometry? */
function joinHolds(doc, j) {
  const A = doc.element(j.a.of), B = doc.element(j.b.of); if (!A || !B) return false;
  const ca = doc.argValue(A, "centreline"), cb = doc.argValue(B, "centreline"); if (!ca || !cb) return false;
  const pa = ca[j.a.end]; if (!pa) return false;
  if (j.b.end) return !!cb[j.b.end] && dist(pa, cb[j.b.end]) <= 1;
  if (cb.type !== "line") return true;                     // arcs: resolveJoins judges and notes
  const L = lineThrough(cb.start, cb.end), u = dot(sub(pa, L.p), L.d);
  return Math.abs(signedDistance(L, pa)) <= 1 && u > -1 && u < dist(cb.start, cb.end) + 1;
}
/** The join an end has arrived at, and the point it should sit on. Corners win over Ts;
 *  a T lands anywhere within the other wall's thickness and snaps onto its location line
 *  along the moving wall's own direction, so the wall never bends. */
function findJoin(doc, id, end, c) {
  const me = lineWall(doc, doc.element(id)); if (!me) return null;
  const p = c[end], q = end === "start" ? c.end : c.start, dir = normalise(sub(p, q));
  const walls = doc.elements().filter(g => doc.idOf(g) !== id).map(g => lineWall(doc, g)).filter(Boolean);
  // 1. a corner: another wall's end within the walls' half-thickness - unless that end is itself
  // T-joined into a wall this end also lands in: two walls meeting a third from either side are
  // two Ts (a crossing), not a corner with each other
  const inBand = (B, q) => { const s = signedDistance(B.line, q), u = dot(sub(q, B.line.p), B.line.d); return s >= B.sMin - 30 && s <= B.sMax + 30 && u > -1 && u < B.L + 1; };
  const tEndInto = (id2, end2) => doc.joins.filter(j => j.a.of === id2 && j.a.end === end2 && !j.b.end).map(j => j.b.of);
  let best = null;
  for (const B of walls) for (const e of ["start", "end"]) {
    if (tEndInto(B.id, e).some(host => { const H = walls.find(w => w.id === host); return H && inBand(H, p); })) continue;
    const d = dist(p, B.c[e]), tol = Math.max(me.half, B.half) + 1;
    if (d <= tol && (!best || d < best.d)) best = { d, B, e };
  }
  if (best) {
    const P = best.B.c[best.e];
    const rows = [{ a: { of: id, end }, b: { of: best.B.id, end: best.e } }];
    const node = new Set([best.B.id + ":" + best.e]);
    for (const B of walls) for (const e of ["start", "end"]) if (!node.has(B.id + ":" + e) && dist(B.c[e], P) <= 1) { node.add(B.id + ":" + e); rows.push({ a: { of: id, end }, b: { of: B.id, end: e } }); }
    return { p: P, rows, what: `${id} ${end} ⟷ ${best.B.id} ${best.e}` };
  }
  // 2. a T: the end is inside another wall's footprint (or within 30 mm of it)
  let T = null;
  for (const B of walls) {
    if (Math.abs(cross(dir, B.line.d)) < 0.3) continue;      // nearly parallel: no T
    const s = signedDistance(B.line, p), u = dot(sub(p, B.line.p), B.line.d);
    if (s < B.sMin - 30 || s > B.sMax + 30 || u < -me.half || u > B.L + me.half) continue;
    const X = intersectLines(lineThrough(q, p), B.line); if (!X) continue;
    const uX = dot(sub(X, B.line.p), B.line.d), d = Math.abs(s);
    if (T && T.d <= d) continue;
    // landing at the very end of B makes a corner: both walls meet at X
    if (uX < me.half + 1) { T = { d, p: X, rows: [{ a: { of: id, end }, b: { of: B.id, end: "start" } }], moveOther: [{ id: B.id, end: "start" }], what: `${id} ${end} ⟷ ${B.id} start (corner)` }; continue; }
    if (uX > B.L - me.half - 1) { T = { d, p: X, rows: [{ a: { of: id, end }, b: { of: B.id, end: "end" } }], moveOther: [{ id: B.id, end: "end" }], what: `${id} ${end} ⟷ ${B.id} end (corner)` }; continue; }
    T = { d, p: X, rows: [{ a: { of: id, end }, b: { of: B.id, u: uX } }], what: `${id} ${end} T onto ${B.id}` };
  }
  // 3. a T onto a curved wall: the end inside the arc's band snaps onto its location circle, along this wall's own line
  for (const g of doc.elements()) {
    if (doc.typeOf(g) !== "Wall" || doc.idOf(g) === id) continue;
    const c = doc.argValue(g, "centreline"), w = doc.plan(g);
    if (!c || (c.type !== "arc" && c.type !== "circle") || !w || !w.stack) continue;
    const R = c.radius, ctr = c.centre, r = dist(p, ctr), sv = w.stack.s, sMin = Math.min(...sv), sMax = Math.max(...sv);
    const s = c.ccw ? R - r : r - R;                         // the same side convention as walls.sideOf
    if (s < sMin - 30 || s > sMax + 30) continue;
    // the line q→p meets the circle: the root nearest p
    const f = sub(p, ctr), dq = dir, b = dot(f, dq), cc = dot(f, f) - R * R, disc = b * b - cc;
    if (disc < 0) continue;
    const roots = [-b + Math.sqrt(disc), -b - Math.sqrt(disc)].sort((x, y) => Math.abs(x) - Math.abs(y));
    const X = add(p, mul(dq, roots[0]));
    const uX = arcU(w, X); if (uX === null || uX < me.half + 1 || uX > w.L - me.half - 1) continue;
    const d = Math.abs(s);
    if (T && T.d <= d) continue;
    T = { d, p: X, rows: [{ a: { of: id, end }, b: { of: doc.idOf(g), u: uX } }], what: `${id} ${end} T onto ${doc.idOf(g)} (curved)` };
  }
  return T;
}
/** Arc length from an arc wall's start to the point on it nearest p, or null past its ends. */
function arcU(w, p) {
  const c = w.curve; if (!c || !c.centre) return null;
  const ang = Math.atan2(p[1] - c.centre[1], p[0] - c.centre[0]);
  const T = Math.PI * 2, a0 = c.a0 ?? 0, sweep = c.sweep ?? T;
  let da = sweep > 0 ? ((ang - a0) % T + T) % T : ((a0 - ang) % T + T) % T;
  if (da > Math.abs(sweep) + 1e-9) return null;
  return da * (c.radius ?? dist(p, c.centre));
}
/** Locked dimensions between levels (constraint rows of kind "levelGap", value = z(b) - z(a)) hold:
 *  from the level that moved, every level locked to it follows, breadth first. */
function holdLevelGaps(doc, moved) {
  const z = id => F.real(doc.element(id), "elevation"), seen = new Set([moved]), queue = [moved];
  while (queue.length) {
    const cur = queue.shift();
    for (const c of doc.constraints) {
      if (c.kind !== "levelGap" || c.locked === false) continue;
      const [a, b] = c.of.map(k => k.split(":")[0]);
      if (!doc.element(a) || !doc.element(b)) continue;
      const other = a === cur ? b : b === cur ? a : null; if (!other || seen.has(other)) continue;
      const want = a === cur ? z(a) + c.value : z(b) - c.value;
      doc.setArg(doc.element(other), "elevation", Math.round(want * 1000) / 1000);
      seen.add(other); queue.push(other);
    }
  }
}
/** The openings these fillers fill take their width and height from the filler's type. */
function sizeOpeningsToType(doc, fillers) {
  for (const f of fillers) {
    const key = doc.typeOf(f) === "Door" ? "doorType" : "windowType", t = F.type(f, key), op = F.reference(f, "fills");
    if (!t || !op || !(t.width > 0) || !(t.height > 0)) continue;
    const prof = clone(doc.argValue(op, "profile") || {});
    if (prof.w === t.width && prof.h === t.height) continue;
    prof.w = t.width; prof.h = t.height;
    doc.setArg(op, "profile", prof);
  }
}
/** Every end of these walls, for autojoin. */
export function wallEnds(doc, ids) { return ids.filter(id => { const f = doc.element(id); return f && doc.typeOf(f) === "Wall"; }).flatMap(id => [{ id, end: "start" }, { id, end: "end" }]); }

// ---------------------------------------------------------------- propagation (§10.5)
/** Which argument moves an element as a whole. */
export function geomKey(f, doc) { return geomKeyOf(doc.typeOf(f)); }
export function geomKeyOf(t) {
  return t === "Wall" ? "centreline" : t === "Grid" || t === "RoomSeparator" || t === "ElevationView" || t === "SectionView" ? "line"
    : t === "Column" || t === "Furniture" || t === "Text" || t === "SymbolInstance" ? "position" : t === "Space" ? "anchor"
    : t === "DetailLine" ? "curve" : t === "FilledRegion" ? "boundary" : t === "CADImport" ? "offsetX" : null;
}

// ---------------------------------------------------------------- transforms
/** A rigid transform as point, angle and geometry functions. Mirror reverses
 *  handedness, so a mirrored line swaps its ends to keep a wall's exterior out. */
export function transformer(o) {
  let P, A, mirror = false;
  if (o.move) { const d = o.move; P = p => [p[0] + d[0], p[1] + d[1]]; A = a => a; }
  else if (o.rotate) { const { c, a } = o.rotate, cs = Math.cos(a), sn = Math.sin(a); P = p => { const x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]; }; A = deg => deg + a * 180 / Math.PI; }
  else if (o.mirror) { const { p: m, d } = o.mirror, u = normalise(d); mirror = true; P = p => { const v = sub(p, m), t = dot(v, u); return add(m, sub(mul(u, 2 * t), v)); }; const th = Math.atan2(u[1], u[0]) * 180 / Math.PI; A = deg => 2 * th - deg; }
  else return null;
  const geom = (g) => {
    if (!g) return g;
    if (Array.isArray(g) && typeof g[0] === "number") return P(g);
    if (Array.isArray(g)) return g.map(p => P(p));
    const out = Object.assign({}, g);
    if (g.type === "line") { out.start = P(g.start); out.end = P(g.end); if (mirror) [out.start, out.end] = [out.end, out.start]; }
    else if (g.type === "arc") { out.centre = P(g.centre); if (mirror) { out.start = A(g.end); out.end = A(g.start); } else { out.start = A(g.start); out.end = A(g.end); } }
    else if (g.type === "circle" || g.type === "ellipse") { out.centre = P(g.centre); if (g.rotation !== undefined) out.rotation = A(g.rotation); }
    else if (g.type === "spline") { out.points = g.points.map(P); if (mirror) out.points.reverse(); }
    return out;
  };
  return { P, A, geom, mirror };
}
function transformExtras(doc, f, T) {
  const t = doc.typeOf(f);
  if ((t === "Column" || t === "Furniture" || t === "Text" || t === "SymbolInstance") && doc.argValue(f, "rotation") !== undefined)
    doc.setArg(f, "rotation", ((T.A(doc.argValue(f, "rotation") || 0) % 360) + 360) % 360);
  if (t === "Text") doc.setArg(f, "leaders", (doc.argValue(f, "leaders") || []).map(L => Object.assign({}, L, L.elbow ? { elbow: T.P(L.elbow) } : {}, { target: T.P(L.target) })));
}
/** Walls joined to a moved wall keep their joint: the shared end follows the
 *  moved end (an L stretches), and a T end slides onto the moved through-wall. */
export function followJoins(doc, movedIds, before) {
  const endOf = (id, e) => { const c = doc.argValue(doc.element(id), "centreline"); return c && c.type === "line" ? c[e] : null; };
  const setEnd = (id, e, p) => { const f = doc.element(id), c = clone(doc.argValue(f, "centreline")); c[e] = p; doc.setArg(f, "centreline", c); };
  for (const j of doc.joins) {
    if (j.allowed === false) continue;
    const A = j.a.of, B = j.b.of;
    if (!doc.element(A) || !doc.element(B)) continue;
    if (j.b.end) {
      for (const [m, me, o, oe] of [[A, j.a.end, B, j.b.end], [B, j.b.end, A, j.a.end]]) {
        if (!movedIds.has(m) || movedIds.has(o) || !before.has(m)) continue;
        const was = before.get(m); if (!was || was.type !== "line") continue;
        const oldEnd = was[me], otherEnd = endOf(o, oe);
        // only if they were actually together before this edit
        if (otherEnd && dist(oldEnd, otherEnd) < 1) setEnd(o, oe, endOf(m, me));
      }
    } else if (movedIds.has(B) && !movedIds.has(A)) {
      const c = doc.argValue(doc.element(B), "centreline"), e = endOf(A, j.a.end);
      if (c && c.type === "line" && e) { const L = lineThrough(c.start, c.end); setEnd(A, j.a.end, add(L.p, mul(L.d, dot(sub(e, L.p), L.d)))); }
    }
  }
}
/** Copies with fresh ids; hosted openings and their fillers come along, and
 *  joins among the copied walls are copied too (ids rewritten in one pass). */
function copyElements(doc, ids, T) {
  const map = new Map(), recs = [];
  const want = new Set(ids);
  for (const g of doc.elements()) { const t = doc.typeOf(g); if (t === "Opening" && want.has(F.refId(g, "host"))) want.add(doc.idOf(g)); }
  for (const g of doc.elements()) { const t = doc.typeOf(g); if ((t === "Door" || t === "Window") && want.has(F.refId(g, "fills"))) want.add(doc.idOf(g)); }
  for (const id of want) {
    const f = doc.element(id), rec = clone(doc.elementJSON(f));
    const taken = new Set(map.values());
    const base = (CATALOGUE.get(rec.type) || {}).idPrefix || rec.type.slice(0, 2).toUpperCase();
    let n = 1; while (doc.element(base + n) || taken.has(base + n)) n++;
    const nid = base + n; map.set(id, nid); rec.id = nid;
    if (rec.name === id || !rec.name) delete rec.name; else rec.name = rec.name + " (copy)";
    recs.push(rec);
  }
  for (const rec of recs) {
    const k = geomKeyOf(rec.type);
    if (rec.type === "CADImport") { const o1 = T.P([rec.args.offsetX || 0, rec.args.offsetY || 0]); rec.args.offsetX = o1[0]; rec.args.offsetY = o1[1]; rec.args.pinned = false; }
    else if (k && rec.args[k] !== undefined) rec.args[k] = T.geom(rec.args[k], rec.type);
    const rw = v => v && typeof v === "object" ? (Array.isArray(v) ? v.map(rw) : Object.fromEntries(Object.entries(v).map(([a, b]) => [a, a === "ref" && map.has(b) ? map.get(b) : rw(b)]))) : v;
    rec.args = rw(rec.args);
    doc.addElement(rec);
    const f = doc.element(rec.id); transformExtras(doc, f, T);
  }
  for (const j of clone(doc.joins)) if (map.has(j.a.of) && map.has(j.b.of)) { const row = clone(j); row.a.of = map.get(j.a.of); row.b.of = map.get(j.b.of); delete row.id; HANDLERS.relate(doc, { store: "joins", row }); }
  return { copied: [...map.values()], id: [...map.values()][0] };
}
/** The line of a reference key for an element in a hypothetical position. */
function refLine(doc, f, rk, geom) {
  const t = doc.typeOf(f);
  if (t === "Wall" && geom.type === "line") {
    const r = resolveReference(doc, doc.idOf(f) + ":" + rk);
    if (!r) return null;
    const base = lineThrough(geom.start, geom.end);
    if (rk === "end.start") return { point: geom.start };
    if (rk === "end.end") return { point: geom.end };
    return { line: offsetLine(base, r.s || 0) };
  }
  if (t === "Grid") return { line: lineThrough(geom.start, geom.end) };
  if (t === "Column") return { point: geom };
  return null;
}
const translate = (geom, d) => Array.isArray(geom) ? add(geom, d) : Object.assign({}, geom, geom.start ? { start: add(geom.start, d), end: add(geom.end, d) } : {}, geom.centre ? { centre: add(geom.centre, d) } : {}, geom.points ? { points: geom.points.map(p => add(p, d)) } : {});

/** Breadth-first from the pinned element; one closed-form computation per
 *  constraint edge. A revisit either agrees (a consistent cycle) or names
 *  exactly which constraint disagreed with which. No iteration, no solver state. */
export function propagate(doc, pinnedIds) {
  const ids = [].concat(pinnedIds), set = new Map(), pinned = new Set(ids), conflicts = [];
  for (const id of ids) { const pf = doc.element(id); set.set(id, clone(doc.argValue(pf, geomKey(pf, doc)))); }
  const queue = ids.slice(), cause = new Map();
  const on = id => doc.constraints.filter(c => c.locked !== false && c.enabled !== false && c.of.some(r => r.split(":")[0] === id));
  const geomOf = id => set.has(id) ? set.get(id) : clone(doc.argValue(doc.element(id), geomKey(doc.element(id), doc)));
  let steps = 0;
  while (queue.length) {
    const e = queue.shift();
    for (const C of on(e)) {
      if (++steps > 10000) break;
      const [ra, rb] = C.of, [ia, ka] = ra.split(":"), [ib, kb] = (rb || "").split(":");
      const unary = !rb || ia === ib;
      if (unary) { const bad = unaryViolation(doc, C, geomOf(ia)); if (bad) conflicts.push({ c: C.id, say: `${C.id} (${C.kind}) is not satisfied by this position${bad}` }); continue; }
      const [me, mk, other, ok] = ia === e ? [ia, ka, ib, kb] : [ib, kb, ia, ka];
      const fo = doc.element(other), fm = doc.element(me);
      if (!fo || !fm) continue;
      const v = solveFor(doc, C, fm, mk, geomOf(me), fo, ok, geomOf(other));
      if (v === null) continue;
      if (pinned.has(other) || set.has(other)) {
        const cur = geomOf(other);
        const diff = geomDiff(cur, v);
        if (diff > 1e-6) {
          const was = cause.get(other);
          conflicts.push({ c: C.id, with: was, say: `${C.id} wants ${other} ${describe(C)} here${was ? `, ${was} already placed it` : ""} — ${Math.round(diff * 1000) / 1000}mm apart. Relax which?` });
        }
        continue;
      }
      set.set(other, v); cause.set(other, C.id); queue.push(other);
    }
  }
  return { set, conflicts, steps };
}
function describe(C) { return C.kind === "distance" ? `at ${C.value}` : C.kind; }
function geomDiff(a, b) {
  if (Array.isArray(a)) return dist(a, b);
  let d = 0; for (const k of ["start", "end", "centre"]) if (a[k] && b[k]) d = Math.max(d, dist(a[k], b[k]));
  return d;
}
function unaryViolation(doc, C, geom) {
  if (!geom || !geom.start) return null;
  const d = sub(geom.end, geom.start);
  if (C.kind === "horizontal" && Math.abs(d[1]) > 1e-6) return ` (it rises ${Math.round(d[1])}mm)`;
  if (C.kind === "vertical" && Math.abs(d[0]) > 1e-6) return ` (it runs ${Math.round(d[0])}mm across)`;
  return null;
}
/** Closed-form placement of `fo` so the constraint holds, given `fm` fixed. */
function solveFor(doc, C, fm, mk, gm, fo, ok, go) {
  const A = refLine(doc, fm, mk, gm), B = refLine(doc, fo, ok, go);
  if (!A || !B) return null;
  switch (C.kind) {
    case "distance": case "aligned": {
      const want = C.kind === "aligned" ? 0 : C.value;
      if (A.line && B.line) {
        const n = perp(A.line.d);
        const cur = dot(sub(B.line.p, A.line.p), n);
        const sign = cur < 0 ? -1 : 1;
        return translate(go, mul(n, sign * want - cur));
      }
      if (A.point && B.point) { const d = sub(B.point, A.point), l = len(d) || 1; return translate(go, mul(d, want / l - 1)); }
      if (A.line && B.point) { const n = perp(A.line.d), cur = dot(sub(B.point, A.line.p), n); const sign = cur < 0 ? -1 : 1; return translate(go, mul(n, sign * want - cur)); }
      if (A.point && B.line) { const n = perp(B.line.d), cur = dot(sub(A.point, B.line.p), n); const sign = cur < 0 ? -1 : 1; return translate(go, mul(n, -(sign * want - cur))); }
      return null;
    }
    case "coincident": {
      if (!A.point || !B.point) return null;
      return translate(go, sub(A.point, B.point));
    }
    case "equal": {
      if (!gm.start || !go.start) return null;
      const L = dist(gm.start, gm.end), d = normalise(sub(go.end, go.start));
      return Object.assign({}, go, { end: add(go.start, mul(d, L)) });
    }
    case "parallel": case "perpendicular": {
      if (!gm.start || !go.start) return null;
      let d = normalise(sub(gm.end, gm.start)); if (C.kind === "perpendicular") d = perp(d);
      const cur = normalise(sub(go.end, go.start)); if (dot(d, cur) < 0) d = mul(d, -1);
      return Object.assign({}, go, { end: add(go.start, mul(d, dist(go.start, go.end))) });
    }
  }
  return null;
}

/** Is this element pinned? Only what declares a Pinned argument can be. */
export function isPinned(doc, f) { const decl = f && doc.declOf(f); return !!(decl && decl.args.some(a => a.key === "pinned") && F.bool(f, "pinned")); }
