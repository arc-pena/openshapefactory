//! Sketch mode: drawing a floor's boundary (or a view's crop) the way Revit and ArchiCAD do.
//!
//! One session at a time, bound to the plan view it was started in. The drawing is a BIM sketch
//! (bimsketch.js: the CAD kernel's format, welded automatically). Everything else in the view is
//! greyed back and the sketch is drawn heavy and dark red; the ribbon becomes the sketch's own tab
//! (Draw, Modify, Measure, and Mode's Finish / Cancel), and the options bar carries the numbers the
//! current tool needs - the offset distance, the fillet radius - as Revit's does.
//!
//! Nothing is written to the document until Finish: the session keeps its own undo, and Cancel
//! leaves the model as it was.

import { h, fmtLen, icon } from "./ui_util.js";
import { parseLength, parseAngle, fmtArea } from "./units.js";
import { F } from "./ocaf.js";
import { add, sub, mul, dot, dist, perp, normalise, lerp } from "./geom2d.js";
import { elementSegs, weld, sketchOf, regionsOf, outline, distanceTo, endsOf, addElements, remove, transform, scale1d, dragHandle, offsetChain,
  fillet, splitElement, arcThrough3, tempDimsFor, measureDim, setDimValue, toggleLock, addDim, handlesOf, newId, solve } from "./bimsketch.js";

const RED = "#8f0000", BLUE = "#1d6fd8";
export const SKETCH_DRAW = [
  ["line", "Line", "skline", "click points; each click continues the chain; click the start (or an end) to close; type a length + Enter"],
  ["rect", "Rectangle", "skrect", "two opposite corners"],
  ["polygon", "Polygon", "skpoly", "centre, then a corner; sides in the options bar"],
  ["arc", "Arc", "skarc", "start, end, then a point it passes through"],
  ["circle", "Circle", "skcircle", "centre, then radius"],
  ["ellipse", "Ellipse", "skellipse", "centre, end of the long axis, then the short"],
  ["bspline", "Spline (control points)", "skbspline", "click the control polygon; Enter ends, clicking the first point closes it"],
  ["spline", "Spline (through points)", "skspline", "click points the curve passes through; Enter ends, clicking the first closes it"],
  ["pickwalls", "Pick Walls", "wall", "click walls: a line along the face you click near; corners trim to meet"],
];
export const SKETCH_MODIFY = [
  ["select", "Select", "select", "click or box elements; drag them or their grips; Delete removes"],
  ["move", "Move", "move", "base point, then destination (the selection, or pick first)"],
  ["copy", "Copy", "copy", "base point, then destination: a copy"],
  ["rotate", "Rotate", "rotate", "centre, a direction, then the new direction"],
  ["mirror", "Mirror", "mirror", "two points on the mirror line"],
  ["scale", "Scale", "skscale", "centre, a reference point, then where it goes"],
  ["scale1d", "Scale 1D", "skscale1d", "base point, a reference point (sets the direction), then where it goes: stretched along that one direction"],
  ["offset", "Offset", "skoffset", "set the distance in the options bar; click an element on the side to offset toward (its whole chain goes)"],
  ["fillet", "Fillet", "skfillet", "set the radius in the options bar (0 = sharp corner); click two elements on the parts to keep"],
  ["split", "Split", "split", "click anywhere on a line, arc or spline: it becomes two, welded where you clicked (splines stay exactly the same curve)"],
  ["dim", "Dimension", "dim", "click a line (length) or an arc (radius); click two lines for the distance or angle between them"],
];

export class SketchSession {
  constructor(app, view, target, drawing) {
    this.app = app; this.view = view; this.target = target;
    this.d = weld(sketchOf(drawing));
    this.tool = "line"; this.pts = []; this.sel = new Set(); this.cursor = null; this.snapNow = null; this.pending = null;
    this.opts = Object.assign({ offset: 500, copy: true, radius: 0, sides: 6 }, app.sketchOpts || {});
    app.sketchOpts = this.opts;
    this.undoStack = []; this.redoStack = []; this.typed = "";
  }
  get title() { return this.target.kind === "crop" ? "Edit Crop" : this.target.id ? "Edit Boundary" : this.target.kind === "region" ? "Create Filled Region Boundary" : "Create Floor Boundary"; }
  say(msg, kind = "note") { this.app.say(msg, kind); }
  commit(next, msg) { this.undoStack.push(this.d); this.redoStack = []; this.d = next; if (msg) this.say(msg, "ok"); this.refresh(); }
  refresh() { this.view.draw(); this.app.renderOptions && this.app.renderOptions(); }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(this.d); this.d = this.undoStack.pop(); this.sel.clear(); this.refresh(); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this.d); this.d = this.redoStack.pop(); this.refresh(); }
  setTool(t) {
    this.tool = t; this.pts = []; this.pending = null; this.typed = "";
    const row = [...SKETCH_DRAW, ...SKETCH_MODIFY].find(r => r[0] === t); if (row) this.say(`${row[1]}: ${row[3]}`);
    this.app.refresh({ keepMain: true });
  }
  el(id) { return this.d.elements.find(e => e.id === id); }
  /** A typed length (any unit, any maths) in mm, or null having said why. */
  len(text) { try { return parseLength(text); } catch (e) { this.say(`${String(text).trim()}: ${e.message}`, "error"); return null; } }
  ang(text) { try { return parseAngle(text); } catch (e) { this.say(`${String(text).trim()}: ${e.message}`, "error"); return null; } }
  tol() { return 8 * this.view.modelPerPx(); }
  /** The element under a model point, nearest first. */
  hitEl(p) {
    let best = null, bd = this.tol();
    for (const e of this.d.elements) { const dd = distanceTo(e, p); if (dd < bd) { bd = dd; best = e.id; } }
    return best;
  }

  // ------------------------------------------------------------ where a click lands
  /** The sketch's own ends, midpoints and centres first (a boundary must close); then the model's
   *  snaps (wall faces, ends, intersections); then 15° steps from the last point; then the grid. */
  point(p, e) {
    const tol = 10 * this.view.modelPerPx(), from = this.pts.length ? this.pts[this.pts.length - 1] : null;
    let best = null;
    const offer = (kind, q, rank) => { const dd = dist(q, p); if (dd < tol && (!best || rank < best.rank || (rank === best.rank && dd < best.d))) best = { kind, point: q, rank, d: dd }; };
    for (const end of endsOf(this.d)) offer("endpoint", end.p, 0);
    if (this.tool !== "line" || this.pts.length !== 0) { const first = this.pts[0]; if (first && this.pts.length > 1) offer("endpoint", first, 0); }
    for (const x of this.d.elements) {
      if (x.type === "line") offer("midpoint", lerp(x.a, x.b, 0.5), 1);
      if (x.c && (x.type === "circle" || x.type === "arc" || x.type === "ellipse")) offer("centre", x.c, 1);
    }
    if (!best) { const sn = this.view.snap(p, { from, shift: e && e.shiftKey }); if (sn) best = { kind: sn.kind, point: sn.point }; }
    if (!best) { const q = this.view.quantise(p); this.snapNow = null; return q; }
    this.snapNow = best; return best.point.slice();
  }
  hover(p, e) {
    this.cursorRaw = p; this.cursor = this.point(p, e);
    this.view.showSnap(this.snapNow ? { kind: this.snapNow.kind, point: this.snapNow.point, of: "sketch" } : null);
    this.hoverEl = ["select", "offset", "fillet", "split", "dim", "move", "copy", "rotate", "mirror", "scale", "scale1d"].includes(this.tool) ? this.hitEl(p) : null;
    this.hoverWall = this.tool === "pickwalls" ? this.wallNear(p) : null;
    this.view.draw();
  }

  // ------------------------------------------------------------ clicks
  click(p, e) {
    const t = this.tool, raw = p;
    if (["select"].includes(t)) return this.selectClick(raw, e);
    const q = this.point(raw, e);
    if (t === "offset") return this.offsetClick(raw);
    if (t === "fillet") return this.filletClick(raw);
    if (t === "split") { const id = this.hitEl(raw); if (!id) return this.say("click on an element to split it"); try { this.commit(splitElement(this.d, id, raw), `${id} split in two`); } catch (err) { this.say(err.message, "error"); } return; }
    if (t === "dim") return this.dimClick(raw);
    if (t === "pickwalls") return this.pickWall(raw);
    if (["move", "copy", "rotate", "mirror", "scale", "scale1d"].includes(t)) return this.modifyClick(q, raw, e);
    this.pts.push(q); const P = this.pts, n = P.length;
    const put = (els, msg) => { this.commit(addElements(this.d, els), msg); };
    if (t === "line") {
      if (n >= 2) {
        const a = P[n - 2], b = P[n - 1]; if (dist(a, b) < 1) { P.pop(); return; }
        put([{ type: "line", a, b }]);
        // landing on the chain's start, or on another end, closes the chain
        if ((n > 2 && dist(b, P[0]) < 1) || (this.snapNow && this.snapNow.kind === "endpoint" && n > 1 && endsOf(this.d).filter(x => dist(x.p, b) < 1).length > 1)) { this.pts = []; this.say(this.closedMsg()); }
      }
    } else if (t === "rect" && n === 2) {
      const [a, b] = P, c = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; this.pts = [];
      put([0, 1, 2, 3].map(k => ({ type: "line", a: c[k], b: c[(k + 1) % 4] })), "Rectangle: 4 lines, welded at the corners");
    } else if (t === "polygon" && n === 2) {
      const [c, v] = P, N = Math.max(3, Math.round(this.opts.sides) || 6), r = dist(c, v), a0 = Math.atan2(v[1] - c[1], v[0] - c[0]); this.pts = [];
      const cs = Array.from({ length: N }, (_, k) => add(c, [r * Math.cos(a0 + k * 2 * Math.PI / N), r * Math.sin(a0 + k * 2 * Math.PI / N)]));
      put(cs.map((pp, k) => ({ type: "line", a: pp, b: cs[(k + 1) % N] })), `Polygon: ${N} sides`);
    } else if (t === "arc" && n === 3) { const el = arcThrough3(P[0], P[1], P[2]); this.pts = []; if (el) put([el]); }
    else if (t === "circle" && n === 2) { this.pts = []; put([{ type: "circle", c: P[0], r: Math.max(1, dist(P[0], P[1])) }]); }
    else if (t === "ellipse" && n === 3) {
      const rx = dist(P[0], P[1]), rot = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]), v = sub(P[2], P[0]), ry = Math.abs(-Math.sin(rot) * v[0] + Math.cos(rot) * v[1]); this.pts = [];
      put([{ type: "ellipse", c: P[0], rx: Math.max(1, rx), ry: Math.max(1, Math.min(ry, rx * 0.999 + 1e-6)), rot }]);
    } else if ((t === "spline" || t === "bspline") && n > 2 && dist(q, P[0]) < 1) {
      const pts = P.slice(0, -1); this.pts = [];
      put([t === "spline" ? { type: "spline", pts, closed: true } : { type: "bspline", ctrl: pts, degree: 3, closed: true }], "Closed spline");
    }
    this.view.draw();
  }
  closedMsg() { const r = regionsOf(this.d); return r.error ? "Chain closed. " + r.error : `Closed: ${r.regions.length} area${r.regions.length > 1 ? "s" : ""}${r.regions.some(x => x.holes.length) ? ", with holes" : ""} - Finish ✓ when done`; }
  /** Enter: end a chain (and a spline there). */
  enter() {
    if (this.typed && this.tool === "line" && this.pts.length) {
      const last = this.pts[this.pts.length - 1], dir = normalise(sub(this.cursor || add(last, [1, 0]), last)), n = this.len(this.typed); this.typed = "";
      if (n > 0) { this.pts.push(add(last, mul(dir, n))); this.commit(addElements(this.d, [{ type: "line", a: last, b: this.pts[this.pts.length - 1] }])); }
      return true;
    }
    if ((this.tool === "spline" || this.tool === "bspline") && this.pts.length >= 2) {
      const pts = this.pts.slice(); this.pts = [];
      this.commit(addElements(this.d, [this.tool === "spline" ? { type: "spline", pts, closed: false } : { type: "bspline", ctrl: pts, degree: 3, closed: false }]));
      return true;
    }
    if (this.tool === "dim" && this.pending) { this.commit(addDim(this.d, { type: this.el(this.pending.id).type === "line" ? "length" : "radius", of: [this.pending.id] })); this.pending = null; return true; }
    if (this.pts.length) { this.pts = []; this.view.draw(); return true; }
    return false;
  }
  escape() {
    if (this.pts.length || this.pending || this.typed) { this.pts = []; this.pending = null; this.typed = ""; this.view.hideHud(); this.view.draw(); return; }
    if (this.tool !== "select") { this.setTool("select"); return; }
    if (this.sel.size) { this.sel.clear(); this.refresh(); return; }
    this.say("Sketch mode: Finish ✓ or Cancel ✕ on the ribbon ends it", "note");
  }
  key(e) {
    if (this.tool === "line" && this.pts.length && (/^[0-9.'"\/]$/.test(e.key) || (this.typed && /^[a-z+*()\-]$/i.test(e.key)) || (e.key === "Backspace" && this.typed))) {
      this.typed = e.key === "Backspace" ? this.typed.slice(0, -1) : this.typed + e.key;
      const s = this.view.toScreen(this.cursor || this.pts[this.pts.length - 1]); this.view.hudInput = true; this.view.hud.hidden = false; this.view.hud.style.left = s[0] + "px"; this.view.hud.style.top = s[1] + "px"; this.view.hud.textContent = `length ${this.typed} ⏎`;
      return true;
    }
    if (e.key === "Enter") { this.view.hudInput = null; this.view.hideHud(); return this.enter(); }
    if ((e.key === "Delete" || e.key === "Backspace") && this.sel.size) { this.commit(remove(this.d, [...this.sel]), `${this.sel.size} deleted`); this.sel.clear(); this.refresh(); return true; }
    return false;
  }

  // ------------------------------------------------------------ select, grips, drag
  selectClick(p, e) {
    const id = this.hitEl(p);
    if (!id) { if (!e.shiftKey) this.sel.clear(); }
    else if (e.shiftKey && this.sel.has(id)) this.sel.delete(id);
    else { if (!e.shiftKey) this.sel.clear(); this.sel.add(id); }
    this.refresh();
  }
  /** Pressing on an element in Select drags it (selecting it first); its welded neighbours stretch. */
  pointerDown(sx, sy, e) {
    if (this.tool !== "select" || e.button !== 0) return false;
    const p = this.view.toModel(sx, sy), id = this.hitEl(p);
    if (!id) { this.boxStart = [sx, sy]; return this.startBox(e); }
    if (!this.sel.has(id)) { if (!e.shiftKey) this.sel.clear(); this.sel.add(id); }
    const d0 = this.d, ids = [...this.sel], grab = this.point(p, e);
    let moved = false, last = d0;
    const move = ev => {
      const [x, y] = this.view.evPos(ev); if (!moved && Math.abs(x - sx) + Math.abs(y - sy) < 4) return; moved = true;
      const q = this.point(this.view.toModel(x, y), ev), dv = sub(q, grab);
      last = transform(d0, ids, pt => add(pt, dv)); this.d = last; this.view.showHud(x, y, `move ${fmtLen(dv[0])}, ${fmtLen(dv[1])}`); this.view.draw();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); this.view.hideHud(); this.view.showSnap(null);
      if (moved) { this.d = d0; this.commit(weld(last)); } else this.refresh(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return true;
  }
  startBox(e) {
    const [sx, sy] = this.boxStart;
    const move = ev => { const [x, y] = this.view.evPos(ev); this.view.box = [[sx, sy], [x, y]]; this.view.draw(); };
    const up = ev => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const b = this.view.box; this.view.box = null; if (!b) { if (!e.shiftKey) this.sel.clear(); this.refresh(); return; }
      const A = this.view.toModel(Math.min(b[0][0], b[1][0]), Math.max(b[0][1], b[1][1])), B = this.view.toModel(Math.max(b[0][0], b[1][0]), Math.min(b[0][1], b[1][1]));
      const inside = q => q[0] >= A[0] && q[0] <= B[0] && q[1] >= A[1] && q[1] <= B[1], crossing = b[1][0] < b[0][0];
      if (!e.shiftKey) this.sel.clear();
      for (const x of this.d.elements) { const pts = outline(x, 24); if (crossing ? pts.some(inside) : pts.every(inside)) this.sel.add(x.id); }
      this.refresh();
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return true;
  }
  /** Grips on what is selected: ends, centres, spline points - and a radius grip on circles and arcs. */
  grips() {
    const out = []; if (this.tool !== "select") return out;       // in the other tools a click is a point, never a grab
    for (const id of this.sel) {
      const x = this.el(id); if (!x) continue;
      for (const [key, at] of handlesOf(x)) out.push({ ref: id + "." + key, at, key });
      if (x.type === "circle") out.push({ ref: id + ".radius", at: add(x.c, [x.r, 0]), key: "radius", radius: true });
    }
    return out;
  }
  dragGrip(e, gp) {
    e.preventDefault(); e.stopPropagation();
    const d0 = this.d; let last = d0, moved = false;
    const move = ev => {
      moved = true; const [x, y] = this.view.evPos(ev), q = this.point(this.view.toModel(x, y), ev);
      if (gp.radius) { const w = JSON.parse(JSON.stringify(d0)), c = w.elements.find(el => el.id === gp.ref.split(".")[0]); c.r = Math.max(1, dist(c.c, q)); last = solve(w); this.view.showHud(x, y, `R ${fmtLen(c.r)}`); }
      else { last = dragHandle(d0, gp.ref, q); this.view.showHud(x, y, `${fmtLen(q[0])}, ${fmtLen(q[1])}`); }
      this.d = last; this.view.draw();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); this.view.hideHud(); this.view.showSnap(null); if (moved) { this.d = d0; this.commit(weld(last)); } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  // ------------------------------------------------------------ modify tools
  targets(raw) {
    if (this.sel.size) return [...this.sel];
    const id = this.hitEl(raw); if (id) { this.sel.add(id); this.view.draw(); }
    return [];
  }
  modifyClick(q, raw) {
    const t = this.tool;
    if (!this.sel.size) { this.targets(raw); if (this.sel.size) this.say(`${t}: now the ${t === "rotate" || t === "scale" || t === "scale1d" ? "centre" : t === "mirror" ? "first point of the mirror line" : "base point"}`); else this.say("pick what to " + t + " first"); return; }
    this.pts.push(q); const P = this.pts, n = P.length, ids = [...this.sel];
    const done = (next, msg) => { this.pts = []; this.commit(weld(next), msg); };
    if ((t === "move" || t === "copy") && n === 2) {
      const dv = sub(P[1], P[0]);
      if (t === "move") done(transform(this.d, ids, pt => add(pt, dv)), `moved ${fmtLen(Math.hypot(dv[0], dv[1]))}`);
      else { const copies = ids.map(id => JSON.parse(JSON.stringify(this.el(id)))).map(x => { const w = { elements: [x] }; const moved = transform(Object.assign({ constraints: [], dims: [] }, w), [x.id], pt => add(pt, dv)).elements[0]; delete moved.id; return moved; }); done(addElements(this.d, copies), `${copies.length} copied`); }
    } else if (t === "rotate" && n === 3) {
      const c = P[0], a = Math.atan2(P[2][1] - c[1], P[2][0] - c[0]) - Math.atan2(P[1][1] - c[1], P[1][0] - c[0]);
      done(transform(this.d, ids, pt => { const v = sub(pt, c); return add(c, [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]); }, 1, a), `rotated ${Math.round(a * 1800 / Math.PI) / 10}°`);
    } else if (t === "mirror" && n === 2) {
      const a = P[0], u = normalise(sub(P[1], P[0]));
      const f = pt => { const v = sub(pt, a), along = mul(u, dot(v, u)); return add(a, sub(mul(along, 2), v)); };
      // a mirrored arc runs the other way round; the kernel's arcs are rebuilt from three points on them
      const w = JSON.parse(JSON.stringify(this.d));
      for (const x of w.elements) if (this.sel.has(x.id)) {
        if (x.type === "arc") { const pts = outline(x, 8), m = arcThrough3(f(pts[0]), f(pts[pts.length - 1]), f(pts[4])); Object.assign(x, m); }
        else if (x.type === "ellipse") { x.c = f(x.c); x.rot = 2 * Math.atan2(u[1], u[0]) - (x.rot || 0); }
        else { const tr = transform({ elements: [x], constraints: [], dims: [] }, [x.id], f).elements[0]; Object.assign(x, tr); }
      }
      done(w, "mirrored");
    } else if (t === "scale" && n === 3) {
      const c = P[0], k = dist(c, P[2]) / Math.max(1e-6, dist(c, P[1]));
      done(transform(this.d, ids, pt => add(c, mul(sub(pt, c), k)), k, 0), `scaled × ${Math.round(k * 1000) / 1000}`);
    } else if (t === "scale1d" && n === 3) {
      const c = P[0], u = normalise(sub(P[1], c)), k = dot(sub(P[2], c), u) / Math.max(1e-6, dist(c, P[1]));
      done(scale1d(this.d, ids, c, u, k), `stretched × ${Math.round(k * 1000) / 1000} along ${Math.round(Math.atan2(u[1], u[0]) * 180 / Math.PI)}°`);
    }
    this.view.draw();
  }
  offsetClick(raw) {
    const id = this.hitEl(raw); if (!id) return this.say("click an element, on the side to offset toward");
    const v = this.opts.offset; if (!(v > 0)) return this.say("type an offset distance in the options bar", "error");
    const r = offsetChain(this.d, id, raw, v, !!this.opts.copy);
    this.commit(r.drawing, `offset ${fmtLen(v)}${this.opts.copy ? " (a copy)" : ""}`);
  }
  offsetPreview() {
    if (this.tool !== "offset" || !this.hoverEl || !this.cursor) return null;
    try { const r = offsetChain(this.d, this.hoverEl, this.cursorRaw || this.cursor, this.opts.offset || 0, true); return r.made.map(id => r.drawing.elements.find(x => x.id === id)); } catch (e) { return null; }
  }
  filletClick(raw) {
    const id = this.hitEl(raw); if (!id) return this.say("click an element: the part you click is kept");
    if (!this.pending) { this.pending = { id, at: raw }; this.sel.clear(); this.sel.add(id); this.say(`Fillet R ${fmtLen(this.opts.radius || 0)}: now the second element`); this.view.draw(); return; }
    try {
      const next = fillet(this.d, this.pending.id, this.pending.at, id, raw, this.opts.radius || 0);
      this.pending = null; this.sel.clear(); this.commit(next, this.opts.radius > 0 ? `rounded, R ${fmtLen(this.opts.radius)}` : "corner made: trimmed/extended to meet");
    } catch (err) { this.pending = null; this.sel.clear(); this.say(err.message, "error"); this.view.draw(); }
  }
  dimClick(raw) {
    const id = this.hitEl(raw); if (!id) return;
    const x = this.el(id);
    if (!this.pending) {
      if (x.type !== "line") { this.commit(addDim(this.d, { type: "radius", of: [id] }), "radius dimension - click its value to change it, its padlock to hold it"); return; }
      this.pending = { id }; this.sel.clear(); this.sel.add(id); this.say("click another line for the distance or angle between them, or the same line (or Enter) for its length"); this.view.draw(); return;
    }
    const first = this.pending.id; this.pending = null; this.sel.clear();
    if (first === id) { this.commit(addDim(this.d, { type: "length", of: [id] }), "length dimension - click its value to change it, its padlock to hold it"); return; }
    const td = tempDimsFor(this.d, [first, id]).find(z => z.of.length === 2);
    if (td) this.commit(addDim(this.d, td), `${td.type} dimension`);
  }
  /** The straight wall under (or within a few pixels of) a point. */
  wallNear(p) {
    const doc = this.app.doc, lv = F.refId(this.view.view, "level"), tol = 12 * this.view.modelPerPx();
    let best = null, bd = Infinity;
    for (const f of doc.elements()) {
      if (doc.typeOf(f) !== "Wall" || (lv && F.refId(f, "baseLevel") !== lv)) continue;
      const w = doc.plan(f); if (!w || w.curve.type !== "line") continue;
      const c = w.curve, L = dist(c.start, c.end), t = Math.max(0, Math.min(L, dot(sub(p, c.start), w.d)));
      const across = Math.abs(dot(sub(p, c.start), perp(w.d))), along = dist(add(c.start, mul(w.d, t)), p) - across;
      const half = Math.max(...w.stack.s.map(Math.abs)), dd = Math.max(0, across - half) + Math.max(0, along);
      if (dd < tol && dd < bd) { bd = dd; best = { id: doc.idOf(f) }; }
    }
    return best;
  }
  /** Revit's Pick Walls: a line along the face of the wall nearest the click; its ends then meet
   *  the lines already there (trimmed or extended), so picking the walls round a room closes it. */
  pickWall(raw) {
    const doc = this.app.doc, hit = this.wallNear(raw), f = hit && doc.element(hit.id);
    if (!f || doc.typeOf(f) !== "Wall") return this.say("click a wall (or just beside the face you want)");
    const w = doc.plan(f); if (!w || w.curve.type !== "line") return this.say("Pick Walls takes straight walls; draw curved edges with Arc");
    const c = w.curve, n = perp(w.d), side = dot(sub(raw, c.start), n), s = side >= 0 ? Math.max(...w.stack.s) : Math.min(...w.stack.s);
    const a = add(c.start, mul(n, s)), b = add(c.end, mul(n, s));
    let next = addElements(this.d, [{ type: "line", a, b, wall: hit.id }]);
    const mine = next.elements[next.elements.length - 1].id, reach = Math.max(1500, 3 * Math.abs(s) + 400);
    // meet the nearest line at each end (trim/extend), as picked walls meet in Revit
    for (const end of ["a", "b"]) {
      const me = next.elements.find(x => x.id === mine), p = me[end];
      if (endsOf(next).filter(z => dist(z.p, p) < 1).length > 1) continue;
      let best = null, bd = reach;
      for (const o of next.elements) if (o.id !== mine && o.type === "line") { const q = [o.a, o.b].reduce((u, v) => (dist(v, p) < dist(u, p) ? v : u)); const dd = dist(q, p); if (dd < bd) { bd = dd; best = o; } }
      if (best) { try { next = fillet(next, mine, lerp(me.a, me.b, 0.5), best.id, lerp(best.a, best.b, 0.5), 0); } catch (e) { /* parallel: leave it */ } }
    }
    this.commit(next, `line on ${hit.id}'s ${side >= 0 ? "left" : "right"} face`);
  }

  // ------------------------------------------------------------ finishing
  finish() {
    const doc = this.app.doc, r = regionsOf(this.d);
    if (r.error) { this.say(`${this.title}: ${r.error}`, "error"); this.flashOpen = true; this.view.draw(); return false; }
    if (!r.regions.length) { this.say(`${this.title}: draw a closed boundary`, "error"); return false; }
    const main = r.regions.reduce((b, x) => (Math.abs(skArea(x.outer)) > Math.abs(skArea(b.outer)) ? x : b), r.regions[0]);
    const boundary = main.outer.map(p => p.map(v => Math.round(v * 10) / 10));
    const sketch = weld(this.d);
    if (this.target.kind === "crop") {
      if (r.regions.length > 1 || main.holes.length) { this.say("Edit Crop: a crop is one closed loop, with no holes", "error"); return false; }
      const cv = this.target.cropView, clip = cv.clipOf(), xs = boundary.map(p => p[0]), ys = boundary.map(p => p[1]);
      const onlyRect = sketch.elements.length === 4 && sketch.elements.every(x => x.type === "line" && (Math.abs(x.a[0] - x.b[0]) < 1e-6 || Math.abs(x.a[1] - x.b[1]) < 1e-6));
      Object.assign(clip, { rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round), active: true, visible: true, shape: onlyRect ? null : { elements: sketch.elements } });
      this.app.endSketch();
      const res = this.app.apply({ op: "set", id: cv.viewId, key: "clip", value: clip });
      if (res.ok) this.say(onlyRect ? "Crop region set" : `Crop region follows the sketch: ${sketch.elements.length} elements`, "ok");
      return true;
    }
    if (this.target.kind === "region") {
      // a filled region: the same loops and holes, in this view only, hatched with its pattern
      const pattern = this.target.pattern || this.app.toolOpts.regionPattern || "P-DIAG";
      const res2 = this.target.id
        ? this.app.apply([{ op: "set", id: this.target.id, key: "sketch", value: sketch }, { op: "set", id: this.target.id, key: "boundary", value: boundary }])
        : this.app.apply({ op: "add", element: { type: "FilledRegion", args: { boundary, pattern, view: { ref: this.view.viewId }, sketch } } });
      if (!res2.ok) { this.say(res2.error, "error"); return false; }
      const rid = this.target.id || res2.id; this.app.endSketch(); this.app.select([rid]);
      this.say(`Filled region ${rid}${r.regions.some(x => x.holes.length) ? ", with holes" : ""}`, "ok");
      return true;
    }
    const areaM2 = r.regions.reduce((s, x) => s + Math.abs(skArea(x.outer)) - x.holes.reduce((a2, hh) => a2 + Math.abs(skArea(hh)), 0), 0) / 1e6;
    const holes = r.regions.reduce((s, x) => s + x.holes.length, 0);
    let res;
    if (this.target.id) {
      res = this.app.apply([{ op: "set", id: this.target.id, key: "sketch", value: sketch }, { op: "set", id: this.target.id, key: "boundary", value: boundary }]);
    } else {
      const o = this.app.toolOpts, level = F.refId(this.view.view, "level");
      res = this.app.apply({ op: "add", element: { type: "Floor", args: { boundary, floorType: { ref: o.floorType }, level: level ? { ref: level } : null, heightOffset: o.floorOffset ?? 0, sketch } } });
    }
    if (!res.ok) { this.say(res.error, "error"); return false; }
    const id = this.target.id || res.id;
    this.app.endSketch();
    this.app.select([id]);
    this.say(`Floor ${id}: ${fmtArea(areaM2 * 1e6)}${r.regions.length > 1 ? ` in ${r.regions.length} areas` : ""}${holes ? `, ${holes} hole${holes > 1 ? "s" : ""}` : ""}`, "ok");
    return true;
  }
  cancel() { this.app.endSketch(); this.say(`${this.title} cancelled - nothing changed`, "note"); }

  // ------------------------------------------------------------ drawing
  /** Everything else greyed back; the sketch heavy and dark red; previews dashed; open ends ringed. */
  draw(g) {
    const V = this.view, S = p => V.toScreen(p);
    g.fillStyle = "rgba(255,255,255,0.62)"; g.fillRect(0, 0, V.W, V.H);
    const heavy = Math.max(2, Math.min(4, V.cam.z * 0.9));
    // an element traced as what it is - arcs as arcs, splines as Béziers - so zooming in shows no facets
    const exact = el => { g.beginPath(); let cur = null; for (const sg of elementSegs(el)) {
      const a = sg.k === "A" ? [sg.c[0] + sg.r * Math.cos(sg.a0), sg.c[1] + sg.r * Math.sin(sg.a0)] : sg.a, A = S(a);
      if (!cur || Math.hypot(A[0] - cur[0], A[1] - cur[1]) > 0.01) g.moveTo(A[0], A[1]);
      if (sg.k === "L") { const B_ = S(sg.b); g.lineTo(B_[0], B_[1]); cur = B_; }
      else if (sg.k === "A") { const C = S(sg.c); g.arc(C[0], C[1], sg.r * V.cam.z / V.S, -sg.a0, -sg.a1, sg.a1 > sg.a0); cur = S([sg.c[0] + sg.r * Math.cos(sg.a1), sg.c[1] + sg.r * Math.sin(sg.a1)]); }
      else { const c1 = S(sg.c1), c2 = S(sg.c2), B_ = S(sg.b); g.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], B_[0], B_[1]); cur = B_; }
    } g.stroke(); };
    const path = (pts, close) => { g.beginPath(); pts.forEach((p, i) => { const q = S(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (close) g.closePath(); g.stroke(); };
    // the areas it makes, faintly
    const r = regionsOf(this.d);
    if (!r.error) { g.fillStyle = "rgba(143,0,0,0.06)"; g.beginPath(); for (const rg of r.regions) for (const ring of [rg.outer, ...rg.holes]) ring.forEach((p, i) => { const q = S(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); if (i === ring.length - 1) g.closePath(); }); g.fill("evenodd"); }
    for (const x of this.d.elements) {
      const on = this.sel.has(x.id), hov = this.hoverEl === x.id;
      g.strokeStyle = on ? BLUE : hov ? "#d23b3b" : RED; g.lineWidth = on ? heavy + 1 : heavy; exact(x);
      if (x.type === "bspline" && (on || hov)) { g.strokeStyle = "rgba(29,111,216,.6)"; g.lineWidth = 1; g.setLineDash([4, 3]); path(x.ctrl, x.closed); g.setLineDash([]); }
    }
    if (this.hoverWall) { const w = this.app.doc.plan(this.app.doc.element(this.hoverWall.id)); if (w && w.curve.type === "line") { const n = perp(w.d), c = w.curve; g.strokeStyle = BLUE; g.lineWidth = 2; for (const s_ of [Math.max(...w.stack.s), Math.min(...w.stack.s)]) path([add(c.start, mul(n, s_)), add(c.end, mul(n, s_))]); } }
    // ends that meet nothing: where the loop is open
    const ends = endsOf(this.d);
    for (const e of ends) if (ends.filter(o => dist(o.p, e.p) < 1).length < 2) { const q = S(e.p); g.strokeStyle = this.flashOpen ? "#ff3b00" : "#d9480f"; g.lineWidth = 2; g.beginPath(); g.arc(q[0], q[1], this.flashOpen ? 9 : 6, 0, 7); g.stroke(); }
    // previews
    const c = this.cursor, P = this.pts, t = this.tool;
    g.strokeStyle = RED; g.lineWidth = 1.5; g.setLineDash([6, 4]);
    if (c && P.length) {
      if (t === "line") path([P[P.length - 1], c]);
      if (t === "rect") path([P[0], [c[0], P[0][1]], c, [P[0][0], c[1]]], true);
      if (t === "polygon") { const N = Math.max(3, Math.round(this.opts.sides) || 6), rr = dist(P[0], c), a0 = Math.atan2(c[1] - P[0][1], c[0] - P[0][0]); path(Array.from({ length: N }, (_, k) => add(P[0], [rr * Math.cos(a0 + k * 2 * Math.PI / N), rr * Math.sin(a0 + k * 2 * Math.PI / N)])), true); }
      if (t === "circle") path(outline({ type: "circle", c: P[0], r: dist(P[0], c) }, 96));
      if (t === "arc" && P.length === 1) path([P[0], c]);
      if (t === "arc" && P.length === 2) { const el = arcThrough3(P[0], P[1], c); if (el) path(outline(el, 64)); }
      if (t === "ellipse") { const ax = P.length > 1 ? P[1] : c, rx = dist(P[0], ax), rot = Math.atan2(ax[1] - P[0][1], ax[0] - P[0][0]), v = sub(c, P[0]), ry = P.length > 1 ? Math.abs(-Math.sin(rot) * v[0] + Math.cos(rot) * v[1]) : rx / 2; path(outline({ type: "ellipse", c: P[0], rx: Math.max(1, rx), ry: Math.max(1, ry), rot }, 96)); }
      if (t === "spline") path(outline({ type: "spline", pts: [...P, c], closed: false }, 64));
      if (t === "bspline") { path(outline({ type: "bspline", ctrl: [...P, c], degree: 3, closed: false }, 64)); g.strokeStyle = "rgba(29,111,216,.6)"; g.lineWidth = 1; path([...P, c]); }
      if (["move", "copy", "rotate", "mirror", "scale", "scale1d"].includes(t)) { g.strokeStyle = BLUE; path([P[P.length - 1], c]); if (P.length === 2 && t !== "move" && t !== "copy") path([P[0], P[1]]); }
    }
    g.setLineDash([]);
    const prev = this.offsetPreview(); if (prev) { g.strokeStyle = BLUE; g.lineWidth = 1.5; g.setLineDash([5, 4]); for (const x of prev) if (x) path(outline(x, 64)); g.setLineDash([]); }
    // dimensions: kept ones always, temporary ones for the selection
    for (const dm of this.dimsShown()) this.drawDim(g, dm);
  }
  dimsShown() {
    const kept = (this.d.dims || []).map(x => Object.assign({ kept: true }, x));
    const temp = this.tool === "select" ? tempDimsFor(this.d, [...this.sel]).filter(x => !kept.some(k => k.type === x.type && JSON.stringify(k.of) === JSON.stringify(x.of))) : [];
    return [...kept, ...temp].map(x => ({ dim: x, m: measureDim(this.d, x) })).filter(x => x.m);
  }
  dimPlace(m, dim) {
    const V = this.view, S = p => V.toScreen(p);
    if (dim.type === "angle") { const q = S(m.corner); return { at: [q[0] + 28, q[1] - 28], line: null }; }
    const a = S(m.a), b = S(m.b), dir = normalise(sub(b, a)), n = [-dir[1], dir[0]], off = dim.type === "length" ? 16 : 0;
    const A = add(a, mul(n, off)), B = add(b, mul(n, off));
    return { at: lerp(A, B, 0.5), line: [A, B], ticks: dim.type !== "radius" };
  }
  drawDim(g, { dim, m }) {
    const pl = this.dimPlace(m, dim);
    g.strokeStyle = dim.locked ? "#0a57c2" : BLUE; g.lineWidth = 1; g.setLineDash(dim.kept ? [] : [4, 3]);
    if (pl.line) { const [A, B] = pl.line; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); if (pl.ticks) for (const p of [A, B]) { g.beginPath(); g.moveTo(p[0] - 4, p[1] + 4); g.lineTo(p[0] + 4, p[1] - 4); g.stroke(); } }
    if (dim.type === "angle") { const q = this.view.toScreen(m.corner); g.beginPath(); const a0 = Math.atan2(-m.ua[1], m.ua[0]), a1 = Math.atan2(-m.ub[1], m.ub[0]); g.arc(q[0], q[1], 22, Math.min(a0, a1), Math.max(a0, a1)); g.stroke(); }
    g.setLineDash([]);
  }
  /** The overlay: grips, and a value box with a padlock on each dimension (click the value to type). */
  overlay(root) {
    for (const gp of this.grips()) {
      const s = this.view.toScreen(gp.at);
      const el = h("div", { class: "handle", title: gp.radius ? "drag: radius" : `drag ${gp.ref}: what is welded to it follows`, "aria-label": `Sketch grip ${gp.ref}`, style: { left: s[0] + "px", top: s[1] + "px" } });
      el.addEventListener("pointerdown", e => this.dragGrip(e, gp)); root.append(el);
    }
    for (const { dim, m } of this.dimsShown()) {
      const pl = this.dimPlace(m, dim), txt = dim.type === "angle" ? `${Math.round(m.value * 10) / 10}°` : (dim.type === "radius" ? "R " : "") + fmtLen(m.value);
      const box = h("div", { class: "tdim", style: { left: pl.at[0] + "px", top: pl.at[1] + "px" } });
      const val = h("button", { title: "Click to type: what it measures moves to it", "aria-label": `Sketch dimension ${txt}` }, txt);
      val.addEventListener("click", () => {
        const inp = h("input", { type: "text", value: dim.type === "angle" ? String(Math.round(m.value * 100) / 100) : fmtLen(m.value), "aria-label": "New value" }); val.replaceWith(inp); inp.focus(); inp.select();
        inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") return this.refresh(); if (e.key !== "Enter") return;
          const v = dim.type === "angle" ? this.ang(inp.value) : this.len(inp.value); if (v === null) return; if (!(v > 0)) return this.say("type a positive value", "error");
          this.commit(setDimValue(this.d, dim, v), `${dim.type} ${dim.type === "angle" ? v + "°" : fmtLen(v)}`); });
      });
      const lock = h("button", { class: "lock", title: dim.locked ? "Unlock: stop holding this value" : "Padlock: hold this value while you edit", "aria-pressed": String(!!dim.locked), "aria-label": dim.locked ? "Unlock sketch dimension" : "Lock sketch dimension" }, icon(dim.locked ? "lock" : "unlock"));
      lock.addEventListener("click", () => this.commit(toggleLock(this.d, dim), dim.locked ? "unlocked" : "locked: it holds while you edit"));
      box.append(val, lock);
      if (dim.kept) box.append(h("button", { class: "lock", title: "Remove this dimension", "aria-label": "Remove sketch dimension", onclick: () => { const w = JSON.parse(JSON.stringify(this.d)); w.dims = w.dims.filter(x => !(x.type === dim.type && JSON.stringify(x.of) === JSON.stringify(dim.of))); this.commit(w); } }, "×"));
      root.append(box);
    }
  }

  // ------------------------------------------------------------ ribbon and options bar
  ribbonPanels() {
    const b = ([id, label, ic, hint], size) => ({ label, icon: ic, hint, size, on: this.tool === id, run: () => this.setTool(id) });
    const draw = SKETCH_DRAW.filter(r => r[0] !== "pickwalls" || this.target.kind !== "crop");
    return [
      { title: "Mode", items: [{ label: "Finish", icon: "skfinish", hint: "Finish Edit Mode: the sketch becomes the " + ({ crop: "crop", region: "filled region" }[this.target.kind] || "floor"), size: "big", run: () => this.finish(), finish: true }, { label: "Cancel", icon: "close", hint: "Cancel Edit Mode: nothing changes", size: "big", run: () => this.cancel() }] },
      { title: "Draw", items: draw.map((r, i) => b(r, i < 5 || r[0] === "pickwalls" ? "big" : "small")) },
      { title: "Modify", items: SKETCH_MODIFY.filter(r => r[0] !== "dim").map((r, i) => b(r, i < 1 ? "big" : "small")) },
      { title: "Measure", items: [b(SKETCH_MODIFY.find(r => r[0] === "dim"), "big")] },
    ];
  }
  optionsBar(bar) {
    // lengths in the options bar take any unit and any maths, shown back in the project's unit
    const o = this.opts, num = (key, label, width = 72, count = false) => h("label", {}, label + " ", h("input", { type: "text", value: count ? o[key] : fmtLen(o[key]), "aria-label": label, style: { width: width + "px" }, onchange: e => { const v = count ? Math.round(Number(e.target.value)) : this.len(e.target.value); if (v !== null && Number.isFinite(v)) o[key] = v; e.target.value = count ? o[key] : fmtLen(o[key]); this.view.draw(); }, onkeydown: e => e.stopPropagation() }));
    const kids = [h("span", { class: "otitle" }, `Modify | ${this.title}`)];
    const t = this.tool;
    if (t === "offset") kids.push(num("offset", "Offset"), h("label", {}, h("input", { type: "checkbox", checked: !!o.copy, onchange: e => { o.copy = e.target.checked; } }), " Copy"));
    if (t === "fillet") kids.push(num("radius", "Radius"), h("span", { class: "muted" }, "0 = a sharp corner (trim / extend)"));
    if (t === "polygon") kids.push(num("sides", "Sides", 40, true));
    if (this.target.kind === "region") {
      const pats = Object.entries(this.app.doc.lib.patterns || {});
      const cur = this.target.pattern || this.app.toolOpts.regionPattern || "P-DIAG";
      kids.push(h("label", {}, "Pattern ", h("select", { onchange: e => { this.target.pattern = this.app.toolOpts.regionPattern = e.target.value; if (this.target.id) this.app.apply({ op: "set", id: this.target.id, key: "pattern", value: e.target.value }, { quiet: true }); } }, pats.map(([id, pt]) => h("option", { value: id, selected: id === cur }, pt.name || id)))));
    }
    if (this.target.kind === "floor" && !this.target.id) {
      const doc = this.app.doc, ts = Object.entries(doc.lib.types).filter(([id]) => (doc.resolveType(id) || {}).category === "IfcSlab");
      kids.push(h("label", {}, "Type ", h("select", { onchange: e => { this.app.toolOpts.floorType = e.target.value; } }, ts.map(([id, ty]) => h("option", { value: id, selected: this.app.toolOpts.floorType === id }, ty.name)))),
        h("label", {}, "Height offset ", h("input", { type: "text", value: fmtLen(this.app.toolOpts.floorOffset ?? 0), style: { width: "72px" }, onchange: e => { const v = this.len(e.target.value); if (v !== null) this.app.toolOpts.floorOffset = v; e.target.value = fmtLen(this.app.toolOpts.floorOffset ?? 0); }, onkeydown: e => e.stopPropagation() })));
    }
    const r = regionsOf(this.d);
    kids.push(h("span", { class: "grow" }), h("span", { class: r.error ? "muted warn" : "muted" }, r.error ? (this.d.elements.length ? "open: " + r.error.replace(/^the boundary is /, "") : "draw a closed boundary") : `${r.regions.length} closed area${r.regions.length > 1 ? "s" : ""}${r.regions.some(x => x.holes.length) ? " with holes" : ""}`),
      h("button", { class: "btn small", title: "Undo in the sketch (Ctrl+Z)", disabled: !this.undoStack.length, onclick: () => this.undo() }, "↶"),
      h("button", { class: "btn small primary", onclick: () => this.finish() }, "✓ Finish"), h("button", { class: "btn small", onclick: () => this.cancel() }, "✕ Cancel"));
    bar.append(...kids);
  }
}
const skArea = r => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
