//! The 2D view: canvas for the drawing, a DOM overlay for the few things that
//! benefit (handles, the heads-up readout, temporary dimensions, snap glyphs).
//! A handle never moves geometry: it computes a value for a named argument and
//! sends an ordinary edit (§10.1). In 2D that is pointer events and one affine
//! transform — no ray casting.

import { h, clear, fmtLen, icon } from "./ui_util.js";
import { TOL, add, sub, mul, dot, dist, perp, normalise, lerp, intersectLines, lineThrough, projectPoint, pointInPoly, samplePath, polyArea, bboxOf } from "./geom2d.js";
import { deriveView, placements } from "./scene.js";
import { drawScene, primsBBox } from "./render.js";
import { F, CATALOGUE } from "./ocaf.js";
import { uOf, pointAt } from "./walls.js";
import { listeningDimensions, dimensionMove, pickCandidates } from "./props.js";
import { resolveReference, measureRefs, sheetSize } from "./bim.js";
import { getPath } from "./ops.js";

export const SNAP_PX = 8;
export const SNAP_KINDS = ["endpoint", "midpoint", "centre", "intersection", "perpendicular", "nearest", "grid", "angle"];
const SNAP_SHORT = { endpoint: "end", midpoint: "mid", centre: "cen", intersection: "int", perpendicular: "perp", nearest: "near", grid: "grid", angle: "ang" };
const TOOLS_NEED_PLAN = new Set(["wall", "opening", "door", "window", "column", "grid", "text", "dim", "space", "elev", "sep"]);

export class View2D {
  constructor(app, root, viewId) {
    this.app = app; this.root = root; this.viewId = viewId;
    this.cam = null; this.dpr = window.devicePixelRatio || 1;
    this.canvas = h("canvas", { class: "canvas2d", tabindex: 0, "aria-label": "Drawing" });
    this.overlay = h("div", { class: "overlay" });
    this.hud = h("div", { class: "hud", hidden: true });
    this.glyph = h("div", { class: "snapglyph", hidden: true }); this.glyphLabel = h("div", { class: "snaplabel", hidden: true });
    this.scalebar = h("div", { style: { position: "absolute", left: "12px", bottom: "12px", zIndex: 4, font: "11px var(--mono)", color: "#333", pointerEvents: "none" } });
    root.append(this.canvas, this.overlay, this.glyph, this.glyphLabel, this.hud, this.scalebar);
    this.tool = { pts: [] };
    this.pointers = new Map();
    this.bind();
    this.resize();
    new ResizeObserver(() => { this.resize(); this.draw(); }).observe(root);
  }
  get doc() { return this.app.doc; }
  get view() { return this.doc.element(this.viewId); }
  get kind() { return this.doc.typeOf(this.view); }
  get S() { const v = this.view; return this.kind === "Sheet" ? 1 : (F.int(v, "scale") || 100); }
  resize() {
    const r = this.root.getBoundingClientRect(); this.W = r.width; this.H = r.height; this.dpr = window.devicePixelRatio || 1;
    // cssPx × devicePixelRatio, and the context scaled to match (§6.7)
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr)); this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.style.width = r.width + "px"; this.canvas.style.height = r.height + "px";
  }
  scene() { return deriveView(this.doc, this.view); }
  fit() {
    const sc = this.scene();
    const bb = this.kind === "Sheet" ? [0, 0, sc.size[0], sc.size[1]] : (sc.clip || sc.bbox);
    const w = bb[2] - bb[0] || 1, hh = bb[3] - bb[1] || 1;
    const z = Math.min((this.W - 80) / w, (this.H - 80) / hh);
    this.cam = { z, x: (bb[0] + bb[2]) / 2 - this.W / 2 / z, y: (bb[1] + bb[3]) / 2 - this.H / 2 / z };
    this.draw();
  }
  // ---- transforms: model ↔ paper ↔ screen
  toScreen(pModel) { const S = this.S, c = this.cam; return [(pModel[0] / S - c.x) * c.z, this.H - (pModel[1] / S - c.y) * c.z]; }
  toModel(sx, sy) { const S = this.S, c = this.cam; return [(sx / c.z + c.x) * S, ((this.H - sy) / c.z + c.y) * S]; }
  modelPerPx() { return this.S / this.cam.z; }
  evPos(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  // ---------------------------------------------------------------- drawing
  draw() {
    if (!this.cam) { this.fit(); return; }
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this.drawNow());
  }
  drawNow() {
    const g = this.canvas.getContext("2d"), dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const sheet = this.kind === "Sheet";
    g.fillStyle = sheet ? getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim() || "#dde1e7" : "#ffffff";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const sc = this.scene();
    const view = { x: this.cam.x, y: this.cam.y, z: this.cam.z, W: this.W, H: this.H, dpr };
    if (sheet) {
      const [w, hh] = sc.size; g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.shadowColor = "rgba(0,0,0,.25)"; g.shadowBlur = 16; g.fillStyle = "#fff";
      g.fillRect((0 - view.x) * view.z, this.H - (hh - view.y) * view.z, w * view.z, hh * view.z); g.restore();
    }
    const sel = new Set(this.app.selection);
    drawScene(g, sc, view, { selected: sel, hover: this.hover, thinLines: this.app.thinLines });
    this.drawTemp(g, sc);
    this.layoutOverlay();
    this.drawScaleBar();
  }
  drawScaleBar() {
    if (this.kind === "Sheet") { this.scalebar.textContent = ""; return; }
    const mPerPx = this.modelPerPx() / 1000;
    const nice = [0.5, 1, 2, 5, 10, 20, 50, 100].find(x => x / mPerPx > 70) || 100;
    const px = nice / mPerPx;
    this.scalebar.innerHTML = `<div style="width:${px}px;height:5px;border:1px solid #333;border-top:0"></div><div>${nice} m · 1:${this.S}</div>`;
  }
  /** Transient things drawn in screen space: the rubber band, listening dimensions. */
  drawTemp(g) {
    g.save(); g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const blue = "#1d6fd8";
    const T = this.tool;
    if (T.pts.length && T.cursor) {
      g.strokeStyle = blue; g.lineWidth = 1.5; g.setLineDash([6, 4]);
      g.beginPath(); const a = this.toScreen(T.pts[0]); g.moveTo(a[0], a[1]);
      for (const p of T.pts.slice(1).concat([T.cursor])) { const q = this.toScreen(p); g.lineTo(q[0], q[1]); }
      g.stroke(); g.setLineDash([]);
      for (const p of T.pts) { const q = this.toScreen(p); g.fillStyle = blue; g.fillRect(q[0] - 3, q[1] - 3, 6, 6); }
    }
    if (T.preview) { g.strokeStyle = blue; g.lineWidth = 2; g.beginPath(); T.preview.forEach((p, i) => { const q = this.toScreen(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); }
    for (const d of this.tdims || []) {
      g.strokeStyle = blue; g.lineWidth = 1; g.beginPath(); g.moveTo(d.sa[0], d.sa[1]); g.lineTo(d.sb[0], d.sb[1]); g.stroke();
      for (const p of [d.sa, d.sb]) { g.beginPath(); g.moveTo(p[0] - 4, p[1] + 4); g.lineTo(p[0] + 4, p[1] - 4); g.stroke(); }
    }
    for (const gl of this.guides || []) { g.strokeStyle = "#e8591a"; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(gl[0][0], gl[0][1]); g.lineTo(gl[1][0], gl[1][1]); g.stroke(); g.setLineDash([]); }
    g.restore();
  }
  /** Handles and temporary dimensions: a few dozen DOM nodes, constant screen size. */
  layoutOverlay() {
    clear(this.overlay);
    this.tdims = [];
    const doc = this.doc, ids = [...this.app.selection];
    if (this.kind !== "PlanView" || ids.length !== 1 || this.app.tool !== "select") return;
    const f = doc.element(ids[0]); if (!f) return;
    const decl = doc.declOf(f);
    if (decl && decl.handles && !doc.error(f)) {
      let hs = []; try { hs = decl.handles(f, doc); } catch (e) { hs = []; }
      for (const hd of hs) {
        const p = this.toScreen(hd.at);
        if (p[0] < -20 || p[1] < -20 || p[0] > this.W + 20 || p[1] > this.H + 20) continue;
        const el = h("div", { class: "handle" + (hd.key === "move" ? " move" : hd.constraint && hd.constraint.axis ? " axis" : ""), title: `${hd.key} → ${hd.writes}`, style: { left: p[0] + "px", top: p[1] + "px" }, "aria-label": `Handle ${hd.key}` });
        el.addEventListener("pointerdown", e => this.startHandle(e, f, hd, el));
        this.overlay.append(el);
      }
    }
    if (doc.typeOf(f) === "Wall" && doc.plan(f) && doc.plan(f).curve.type === "line") this.listening(f);
  }
  /** Listening dimensions (§10.3): editable in place, padlockable. */
  listening(f) {
    const doc = this.doc, id = doc.idOf(f);
    const dims = listeningDimensions(doc, id, { radius: Math.max(6000, 300 * this.modelPerPx()) });
    const w = doc.plan(f), n = perp(w.d);
    dims.forEach((d, i) => {
      const other = resolveReference(doc, d.to);
      const along = w.L * (0.3 + 0.12 * i);
      const a = pointAt(w, 0, along), b = projectPoint(other.geom, a);
      const sa = this.toScreen(a), sb = this.toScreen(b);
      this.tdims.push({ sa, sb });
      const mid = lerp(sa, sb, 0.5);
      const box = h("div", { class: "tdim", style: { left: mid[0] + "px", top: mid[1] + "px" } });
      const val = h("button", { title: `to ${d.to} — click to type a distance`, "aria-label": `Distance to ${d.to}: ${fmtLen(d.value)}` }, fmtLen(d.value));
      val.addEventListener("click", () => {
        const inp = h("input", { type: "text", value: fmtLen(d.value), "aria-label": `Distance to ${d.to}` });
        val.replaceWith(inp); inp.focus(); inp.select();
        inp.addEventListener("keydown", e => {
          if (e.key === "Escape") this.draw();
          if (e.key !== "Enter") return;
          const v = Number(inp.value);
          if (!(v >= 0)) { this.app.say("type a distance in mm", "error"); return; }
          const geom = dimensionMove(doc, d, v);
          const r = this.app.apply({ op: "drag", id, key: "centreline", value: geom });
          if (r.ok) this.app.say(`${id} moved: ${d.to} now ${fmtLen(v)} away`, "ok");
        });
      });
      const lock = h("button", { class: "lock", title: "Padlock: keep this distance", "aria-label": `Padlock distance to ${d.to}` }, icon("unlock"));
      lock.addEventListener("click", () => {
        // A temporary dimension, promoted to a permanent constraint element (§10.4).
        const dimId = doc.freshId("Dimension");
        const r = this.app.apply([
          { op: "add", element: { id: dimId, type: "Dimension", args: { of: [d.from, d.to], offset: 0, view: { ref: this.viewId }, locked: true } } },
          { op: "relate", store: "constraints", row: { kind: "distance", of: [d.from, d.to], value: Math.round(d.value * 1000) / 1000, locked: true } }]);
        if (r.ok) this.app.say(`Padlocked ${fmtLen(d.value)} between ${d.from} and ${d.to}`, "ok");
      });
      box.append(val, lock);
      this.overlay.append(box);
    });
  }

  // ---------------------------------------------------------------- snapping (§10.8)
  snap(p, { exclude = null, from = null, shift = false } = {}) {
    const doc = this.doc, tol = SNAP_PX * this.modelPerPx(), on = this.app.snaps;
    const cands = [];
    const lines = [], points = [];
    for (const f of doc.elements()) {
      const id = doc.idOf(f); if (id === exclude) continue;
      const t = doc.typeOf(f);
      if (t === "Wall") { const w = doc.plan(f); if (!w) continue;
        const c = w.curve;
        if (dist(c.start, p) > w.L + 2000 && dist(c.end, p) > w.L + 2000) continue;
        points.push(["endpoint", c.start, id], ["endpoint", c.end, id]);
        if (c.type === "line") { points.push(["midpoint", c.at(0.5), id]); lines.push([lineThrough(c.start, c.end), id, c.start, c.end]); for (const s of [w.stack.s[0], w.stack.s[w.stack.s.length - 1]]) { const L = { p: add(c.start, mul(perp(w.d), s)), d: w.d }; lines.push([L, id, add(c.start, mul(perp(w.d), s)), add(c.end, mul(perp(w.d), s))]); } }
        if (c.type === "arc") points.push(["centre", c.centre, id]);
      }
      if (t === "Grid") { const c = F.json(f, "line"); lines.push([lineThrough(c.start, c.end), id, c.start, c.end, "grid"]); points.push(["endpoint", c.start, id], ["endpoint", c.end, id]); }
      if (t === "Column") points.push(["centre", F.point(f, "position"), id]);
    }
    for (const [k, q, id] of points) if (on[k] && dist(q, p) < tol) cands.push({ kind: k, point: q, of: id, d: dist(q, p) });
    if (on.intersection) for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
      if (lines[i][1] === lines[j][1]) continue;
      const q = intersectLines(lines[i][0], lines[j][0]); if (q && dist(q, p) < tol) cands.push({ kind: "intersection", point: q, of: lines[i][1] + "×" + lines[j][1], d: dist(q, p) });
    }
    if (on.perpendicular && from) for (const [L, id] of lines) { const q = projectPoint(L, from); if (dist(q, p) < tol) cands.push({ kind: "perpendicular", point: q, of: id, d: dist(q, p) }); }
    for (const [L, id, a, b, kind] of lines) {
      const q = projectPoint(L, p), t = dot(sub(q, a), L.d);
      if (t < -tol || t > dist(a, b) + tol || dist(q, p) >= tol) continue;
      if (kind === "grid" ? on.grid : on.nearest) cands.push({ kind: kind === "grid" ? "grid" : "nearest", point: q, of: id, d: dist(q, p) });
    }
    const order = k => SNAP_KINDS.indexOf(k);
    cands.sort((a, b) => order(a.kind) - order(b.kind) || a.d - b.d);
    let best = cands[0] || null;
    if (!best && from && (shift || on.angle)) {
      // angle snap at 15° (with Shift always)
      const v = sub(p, from), L = Math.hypot(v[0], v[1]); const a = Math.atan2(v[1], v[0]);
      const step = Math.PI / 12, q = Math.round(a / step) * step;
      if (shift || Math.abs(a - q) < 0.035) best = { kind: "angle", point: add(from, [Math.cos(q) * L, Math.sin(q) * L]), of: `${Math.round(q * 180 / Math.PI)}°`, d: 0 };
    }
    return best;
  }
  showSnap(s) {
    if (!s) { this.glyph.hidden = true; this.glyphLabel.hidden = true; return; }
    const q = this.toScreen(s.point);
    this.glyph.hidden = false; this.glyphLabel.hidden = false;
    this.glyph.className = "snapglyph " + SNAP_SHORT[s.kind];
    for (const el of [this.glyph, this.glyphLabel]) { el.style.left = q[0] + "px"; el.style.top = q[1] + "px"; }
    this.glyphLabel.textContent = SNAP_SHORT[s.kind];
  }
  /** A step, not a rounding afterwards: a nudged wall lands on the grid. */
  quantise(p) { const px = this.modelPerPx(); const step = [1, 5, 10, 25, 50, 100, 250, 500].find(s => s / px >= 4) || 1000; return [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step]; }
  showHud(sx, sy, text) { this.hud.hidden = false; this.hud.style.left = sx + "px"; this.hud.style.top = sy + "px"; if (!this.hudInput) this.hud.textContent = text; }
  hideHud() { this.hud.hidden = true; this.hudInput = null; clear(this.hud); }

  // ---------------------------------------------------------------- handles (§10.7)
  startHandle(e, f, hd, el) {
    e.preventDefault(); e.stopPropagation();
    el.setPointerCapture(e.pointerId);        // a fast drag that leaves the element keeps the gesture
    const id = this.doc.idOf(f), grab = this.quantise(this.toModel(...this.evPos(e)));
    const orig = JSON.parse(JSON.stringify(getPath(this.doc, f, hd.writes)));
    const key = `set:${id}:${hd.writes}`;
    let typed = "";
    const valueFor = (p) => {
      const c = hd.constraint;
      if (c && c.axis) { const t = dot(sub(p, c.origin), c.axis); if (hd.writes === "mountOffset") return -t; return add(c.origin, mul(c.axis, t)); }
      if (c && c.onCurve) { const w = this.doc.plan(this.doc.element(c.onCurve)); return Math.max(0, Math.min(w.L, Math.round(uOf(w, p)))); }
      if (hd.key === "move" || (orig && typeof orig === "object" && !Array.isArray(orig))) { const d = sub(p, grab); return translateGeom(orig, d); }
      return p;
    };
    const readout = (v, snapped) => {
      const c = this.doc.argValue(f, "centreline");
      if (hd.readout === "length" && c) return `L ${fmtLen(dist(c.start, Array.isArray(v) ? v : c.end))} mm${snapped ? " · " + SNAP_SHORT[snapped.kind] : ""}`;
      if (typeof v === "number") return `${fmtLen(v)} mm`;
      if (Array.isArray(v)) return `${fmtLen(v[0])}, ${fmtLen(v[1])}${snapped ? " · " + SNAP_SHORT[snapped.kind] : ""}`;
      return hd.key;
    };
    const send = (v) => { const r = this.app.apply({ op: "drag", id, key: hd.writes, value: v, coalesce: key }, { quiet: true }); if (!r.ok) this.app.say(r.error, "error"); };
    const move = ev => {
      const sp = this.evPos(ev); let p = this.toModel(...sp);
      const from = hd.writes.endsWith(".end") ? (this.doc.argValue(f, hd.writes.split(".")[0]) || {}).start : hd.writes.endsWith(".start") ? (this.doc.argValue(f, hd.writes.split(".")[0]) || {}).end : null;
      const sn = hd.constraint === "free2d" ? this.snap(p, { exclude: id, from, shift: ev.shiftKey }) : null;
      this.showSnap(sn);
      p = sn ? sn.point : this.quantise(p);
      const v = valueFor(p);
      send(v); this.showHud(sp[0], sp[1], readout(v, sn));
    };
    // Numeric entry mid-drag: typing 3600 commits exactly 3600 (test 18).
    const key_ = ev => {
      if (!/^[0-9.\-]$/.test(ev.key) && ev.key !== "Enter" && ev.key !== "Backspace") return;
      ev.preventDefault();
      if (ev.key === "Enter" && typed) {
        const n = Number(typed); const c = this.doc.argValue(f, hd.writes.split(".")[0]);
        let v = null;
        if (hd.readout === "length" && c && c.start) { const d = normalise(sub(c.end, c.start)); v = add(c.start, mul(d, n)); }
        else if (hd.constraint && hd.constraint.onCurve) v = n;
        if (v !== null) { send(v); this.app.say(`${id}: exactly ${fmtLen(n)} mm`, "ok"); }
        finish(); return;
      }
      typed = ev.key === "Backspace" ? typed.slice(0, -1) : typed + ev.key;
      this.hudInput = true; this.hud.textContent = `type: ${typed || "…"} mm ⏎`;
    };
    const finish = () => { el.removeEventListener("pointermove", move); window.removeEventListener("keydown", key_, true); this.app.editor.seal(); this.showSnap(null); this.hideHud(); this.app.refresh(); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", finish, { once: true });
    el.addEventListener("pointercancel", finish, { once: true });
    window.addEventListener("keydown", key_, true);
  }

  // ---------------------------------------------------------------- picking
  hitAt(sx, sy) {
    const sc = this.scene(); const p = this.toModel(sx, sy), tol = 6 * this.modelPerPx();
    if (this.kind === "Sheet") {
      const hits = [];
      for (const g of sc.prims.filter(x => x.t === "group")) { const bb = g.clip || primsBBox(g.prims); if (p[0] >= bb[0] && p[0] <= bb[2] && p[1] >= bb[1] && p[1] <= bb[3]) hits.push({ id: g.vp, view: g.view, area: (bb[2] - bb[0]) * (bb[3] - bb[1]), bb }); }
      hits.sort((a, b) => a.area - b.area); return hits[0] || null;
    }
    let best = null;
    for (const ht of sc.hits) {
      if (!ht.id) continue;
      let hit = false, score = 0;
      if (ht.kind === "curve") { for (let i = 0; i < ht.pts.length - 1; i++) { const a = ht.pts[i], b = ht.pts[i + 1], d = distSeg(p, a, b); if (d < tol) { hit = true; score = d; } } score = score * 0.001; }
      else if (ht.pts.length > 2 && pointInPoly(p, ht.pts)) { hit = true; score = Math.abs(polyArea(ht.pts)); }
      if (hit && (!best || score < best.score)) best = { id: ht.id, score };
    }
    return best;
  }

  // ---------------------------------------------------------------- events
  bind() {
    const c = this.canvas;
    c.addEventListener("wheel", e => { e.preventDefault(); const [sx, sy] = this.evPos(e); this.zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    c.addEventListener("pointerdown", e => this.down(e));
    c.addEventListener("pointermove", e => this.move(e));
    c.addEventListener("pointerup", e => this.up(e));
    c.addEventListener("pointercancel", e => { this.pointers.delete(e.pointerId); this.drag = null; });
    c.addEventListener("dblclick", e => this.dbl(e));
    c.addEventListener("dragover", e => { if (this.kind === "Sheet") e.preventDefault(); });
    c.addEventListener("drop", e => {
      const vid = e.dataTransfer.getData("text/x-webbim-view"); if (!vid || this.kind !== "Sheet") return;
      e.preventDefault(); const p = this.toModel(...this.evPos(e));
      const r = this.app.apply({ op: "place", sheet: this.viewId, view: vid, at: p.map(Math.round) });
      this.app.say(r.ok ? `Placed ${this.doc.element(vid).get("Name")} as ${r.id}` : r.error, r.ok ? "ok" : "error");
    });
  }
  zoomAt(sx, sy, k) { const before = [sx / this.cam.z + this.cam.x, (this.H - sy) / this.cam.z + this.cam.y]; this.cam.z = Math.max(0.02, Math.min(400, this.cam.z * k)); this.cam.x = before[0] - sx / this.cam.z; this.cam.y = before[1] - (this.H - sy) / this.cam.z; this.draw(); }
  down(e) {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.evPos(e));
    if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = { d: dist(a, b), cam: Object.assign({}, this.cam), mid: lerp(a, b, 0.5) }; this.drag = null; return; }
    const [sx, sy] = this.evPos(e);
    this.drag = { start: [sx, sy], cam: Object.assign({}, this.cam), moved: false, button: e.button, shift: e.shiftKey };
    if (this.kind === "Sheet" && e.button === 0 && this.app.tool === "select") {
      const hit = this.hitAt(sx, sy);
      if (hit && this.app.selection.has(this.viewId + ":" + hit.id)) { const vp = (this.doc.argValue(this.view, "viewports") || []).find(v => v.id === hit.id); this.drag.viewport = { id: hit.id, at: vp.at.slice(), bb: hit.bb }; }
    }
  }
  move(e) {
    const [sx, sy] = this.evPos(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [sx, sy]);
    if (this.pinch && this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; const k = dist(a, b) / this.pinch.d; this.cam = Object.assign({}, this.pinch.cam); this.zoomAt(this.pinch.mid[0], this.pinch.mid[1], k); return; }
    const d = this.drag;
    if (d) {
      if (Math.abs(sx - d.start[0]) + Math.abs(sy - d.start[1]) > 3) d.moved = true;
      if (d.viewport && d.moved) return this.dragViewport(d, sx, sy);
      const tooling = TOOLS_NEED_PLAN.has(this.app.tool) && d.button === 0;
      if (d.moved && (!tooling || d.button === 1)) { this.cam.x = d.cam.x - (sx - d.start[0]) / this.cam.z; this.cam.y = d.cam.y + (sy - d.start[1]) / this.cam.z; this.draw(); return; }
    }
    const p = this.toModel(sx, sy);
    if (this.app.tool !== "select" && this.kind === "PlanView") return this.toolHover(p, sx, sy, e);
    const hit = this.hitAt(sx, sy), hid = hit ? (this.kind === "Sheet" ? null : hit.id) : null;
    if (hid !== this.hover) { this.hover = hid; this.draw(); }
    this.canvas.style.cursor = this.app.pickMode ? "crosshair" : hit ? "pointer" : "default";
  }
  up(e) {
    this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag; this.drag = null;
    if (!d) return;
    if (d.viewport) { this.guides = []; this.app.editor.seal(); this.draw(); if (d.moved) return; }
    if (d.moved) return;
    const [sx, sy] = this.evPos(e);
    if (this.app.pickMode) return this.pick(sx, sy);
    if (this.app.tool !== "select" && this.kind === "PlanView") return this.toolClick(this.toModel(sx, sy), e);
    const hit = this.hitAt(sx, sy);
    if (this.kind === "Sheet") { this.app.select(hit ? [this.viewId + ":" + hit.id] : [], e.shiftKey, true); return; }
    this.app.select(hit ? [hit.id] : [], e.shiftKey || e.ctrlKey || e.metaKey);
  }
  dbl(e) {
    const [sx, sy] = this.evPos(e);
    if (this.app.tool === "wall" && this.tool.pts.length >= 2) return this.finishWall(false);
    const hit = this.hitAt(sx, sy);
    if (!hit) return;
    // double-click is "step into": a viewport opens its view, a view marker opens its view
    if (this.kind === "Sheet") return this.app.openView(hit.view);
    const f = this.doc.element(hit.id);
    if (f && ["ElevationView", "PlanView", "View3D"].includes(this.doc.typeOf(f))) this.app.openView(hit.id);
  }
  /** Viewports snap to the sheet's margins, the other viewports' edges and centres, with guides. */
  dragViewport(d, sx, sy) {
    const sh = this.view, [W, H] = sheetSize(sh);
    const dx = (sx - d.start[0]) / this.cam.z, dy = -(sy - d.start[1]) / this.cam.z;
    let at = [d.at[0] + dx, d.at[1] + dy];
    const half = [(d.bb[2] - d.bb[0]) / 2, (d.bb[3] - d.bb[1]) / 2];
    const others = (this.doc.argValue(sh, "viewports") || []).filter(v => v.id !== d.viewport.id).map(v => v.at);
    const xs = [W / 2, 10 + half[0], W - 10 - half[0], ...others.map(o => o[0])], ys = [H / 2, 10 + half[1], H - 10 - half[1], ...others.map(o => o[1])];
    const tol = 8 / this.cam.z; this.guides = [];
    for (const x of xs) if (Math.abs(at[0] - x) < tol) { at[0] = x; this.guides.push([[(x - this.cam.x) * this.cam.z, 0], [(x - this.cam.x) * this.cam.z, this.H]]); break; }
    for (const y of ys) if (Math.abs(at[1] - y) < tol) { at[1] = y; const Y = this.H - (y - this.cam.y) * this.cam.z; this.guides.push([[0, Y], [this.W, Y]]); break; }
    this.app.apply({ op: "sheet", id: this.viewId, viewport: d.viewport.id, value: { at: at.map(v => Math.round(v * 10) / 10) }, coalesce: `sheet:${this.viewId}:${d.viewport.id}` }, { quiet: true });
    this.draw();
  }

  // ---------------------------------------------------------------- pick-binding (§4.2)
  pick(sx, sy) {
    const pm = this.app.pickMode, hit = this.hitAt(sx, sy);
    if (!hit) { this.app.say(`Nothing there. Pick an element for ${pm.label}, or Esc`, "note"); return; }
    const cands = pickCandidates(this.doc, hit.id, pm.kind);
    if (!cands.length) { this.app.say(`${hit.id} has no ${pm.kind} to offer ${pm.label}`, "note"); return; }
    const pop = h("div", { class: "popover", style: { left: Math.min(sx, this.W - 240) + "px", top: Math.min(sy, this.H - 200) + "px" } },
      h("h4", {}, `${pm.label} ← ${hit.id} (${pm.kind} only)`),
      cands.map(c => h("button", { onclick: () => {
        const r = pm.param ? this.app.apply({ op: "set", ids: pm.ids, key: pm.key, value: c.text }) : this.app.apply({ op: "set", ids: pm.ids, key: pm.key, text: c.text });
        this.app.endPick(); pop.remove(); this.app.say(r.ok ? `${pm.label} = ${c.text}` : r.error, r.ok ? "ok" : "error");
      } }, h("div", { class: "mono" }, c.text), h("div", { class: "muted", style: { fontSize: "11.5px" } }, c.label))));
    this.root.append(pop);
    setTimeout(() => window.addEventListener("pointerdown", ev => { if (!pop.contains(ev.target)) pop.remove(); }, { once: true }), 0);
  }

  // ---------------------------------------------------------------- tools
  toolHover(p, sx, sy, e) {
    const T = this.tool, tool = this.app.tool;
    const sn = this.snap(p, { from: T.pts[T.pts.length - 1], shift: e.shiftKey });
    this.showSnap(sn);
    const q = sn ? sn.point : this.quantise(p);
    T.cursor = q; T.preview = null;
    if (["opening", "door", "window"].includes(tool)) {
      const hit = this.nearestWall(q);
      if (hit) { const o = this.app.toolOpts; const w = hit.w, u = uOf(w, q); const half = (o.width || 1000) / 2; T.preview = [pointAt(w, w.stack.s[0], u - half), pointAt(w, w.stack.s[0], u + half), pointAt(w, w.stack.s[w.stack.s.length - 1], u + half), pointAt(w, w.stack.s[w.stack.s.length - 1], u - half), pointAt(w, w.stack.s[0], u - half)]; this.showHud(sx, sy, `${hit.id} · u = ${fmtLen(u)}`); }
      else this.showHud(sx, sy, "hover a wall");
    } else if (T.pts.length) {
      const last = T.pts[T.pts.length - 1];
      this.showHud(sx, sy, this.hudInput ? this.hud.textContent : `${fmtLen(dist(last, q))} mm · ${Math.round(Math.atan2(q[1] - last[1], q[0] - last[0]) * 180 / Math.PI)}°`);
    } else this.showHud(sx, sy, `${fmtLen(q[0])}, ${fmtLen(q[1])}`);
    this.draw();
  }
  nearestWall(p) {
    let best = null;
    for (const f of this.doc.elements()) if (this.doc.typeOf(f) === "Wall") {
      const w = this.doc.plan(f); if (!w) continue;
      const u = uOf(w, p); if (u < 0 || u > w.L) continue;
      const d = dist(pointAt(w, 0, u), p);
      if (d < Math.max(w.stack.T, 12 * this.modelPerPx()) && (!best || d < best.d)) best = { id: this.doc.idOf(f), w, d };
    }
    return best;
  }
  toolClick(p, e) {
    const T = this.tool, tool = this.app.tool, o = this.app.toolOpts, doc = this.doc;
    const q = T.cursor || p;
    const level = F.refId(this.view, "level");
    const addEl = (element, msg) => { const r = this.app.apply({ op: "add", element }); this.app.say(r.ok ? msg || `Added ${r.id}` : r.error, r.ok ? "ok" : "error"); if (r.ok) this.app.select([r.id]); return r; };
    if (tool === "wall") { T.pts.push(q); if (T.pts.length >= 2 && o.closeOnStart && dist(q, T.pts[0]) < 1) return this.finishWall(true); this.draw(); return; }
    if (["grid", "elev", "sep"].includes(tool)) {
      T.pts.push(q);
      if (T.pts.length < 2) { this.draw(); return; }
      const [a, b] = T.pts; T.pts = [];
      if (tool === "grid") { const used = new Set(doc.elements().filter(f => doc.typeOf(f) === "Grid").map(f => F.text(f, "name"))); let n = 1; while (used.has(String(n))) n++; addEl({ type: "Grid", name: "Grid " + n, args: { name: String(n), line: { type: "line", start: a, end: b } } }); }
      if (tool === "elev") addEl({ type: "ElevationView", name: "Elevation " + (doc.elements().filter(f => doc.typeOf(f) === "ElevationView").length + 1), args: { line: { type: "line", start: a, end: b }, depth: 15000, scale: 100, baseLevel: level ? { ref: level } : null, top: 6000, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Coarse" } }, "Elevation added — its marker is its view line; drag it and the view follows");
      if (tool === "sep") addEl({ type: "RoomSeparator", args: { line: { type: "line", start: a, end: b }, level: level ? { ref: level } : null } });
      return;
    }
    if (["opening", "door", "window"].includes(tool)) {
      const hit = this.nearestWall(q); if (!hit) { this.app.say("click on a wall", "note"); return; }
      const u = Math.round(uOf(hit.w, q));
      const t = tool === "door" ? doc.lib.types[o.doorType] : tool === "window" ? doc.lib.types[o.windowType] : null;
      const w = t ? t.width : o.width, hh = t ? t.height : o.height_;
      const sill = tool === "door" ? 0 : tool === "window" ? (o.sill ?? 900) : (o.openSill ?? 0);
      const opId = doc.freshId("Opening");
      const ops = [{ op: "add", element: { id: opId, type: "Opening", args: { host: { ref: hit.id }, profile: { kind: "rect", at: u, sill, w, h: hh }, farProfile: null, depth: "through" } } }];
      if (tool === "door") ops.push({ op: "add", element: { type: "Door", args: { fills: { ref: opId }, doorType: { ref: o.doorType } }, params: { Phase: "New" } } });
      if (tool === "window") ops.push({ op: "add", element: { type: "Window", args: { fills: { ref: opId }, windowType: { ref: o.windowType } } } });
      const r = this.app.apply(ops);
      this.app.say(r.ok ? `${tool === "opening" ? "Opening" : tool[0].toUpperCase() + tool.slice(1)} in ${hit.id} at u = ${u}` : r.error, r.ok ? "ok" : "error");
      if (r.ok) this.app.select([r.id || opId]);
      return;
    }
    if (tool === "column") return addEl({ type: "Column", args: { position: q, columnType: { ref: o.columnType }, baseLevel: level ? { ref: level } : null, height: 3000, rotation: 0 } });
    if (tool === "space") return addEl({ type: "Space", name: o.spaceName || "Room", args: { level: level ? { ref: level } : null, upperLimit: { mode: "offset", offset: 3000 }, anchor: q, boundaryAt: o.boundaryAt || "finishFace" }, params: { Number: "", Department: "" } }, "Space placed: it keeps its name by this anchor");
    if (tool === "text") {
      const sp = this.toScreen(q);
      const inp = h("input", { type: "text", placeholder: "Note text ⏎", style: { position: "absolute", left: sp[0] + "px", top: sp[1] - 14 + "px", zIndex: 9, width: "240px", height: "28px", border: "1px solid #1d6fd8", borderRadius: "4px", padding: "0 6px" } });
      this.root.append(inp); inp.focus();
      inp.addEventListener("keydown", ev => { if (ev.key === "Enter" && inp.value.trim()) { addEl({ type: "Text", args: { content: inp.value, position: q, rotation: 0, textType: { ref: "TT-25" }, wrapWidth: 60, leaders: [], view: { ref: this.viewId } } }); inp.remove(); } if (ev.key === "Escape") inp.remove(); });
      return;
    }
    if (tool === "dim") {
      const r = this.nearestRef(q); if (!r) { this.app.say("click near a wall face, centreline or grid", "note"); return; }
      T.refs = (T.refs || []).concat([r]);
      if (T.refs.length === 1) { this.app.say(`First reference ${r.key}; now a parallel one`, "note"); return; }
      const [a, b] = T.refs; T.refs = [];
      const m = measureRefs(doc, [a.key, b.key]);
      if (m.value == null) { this.app.say(m.why || "cannot dimension those", "error"); return; }
      const off = Math.round(dot(sub(q, a.geom.p), a.geom.d));
      addEl({ type: "Dimension", args: { of: [a.key, b.key], offset: off, view: { ref: this.viewId }, locked: false } }, `Dimension ${fmtLen(m.value)} bound to ${a.key} and ${b.key}`);
    }
  }
  nearestRef(p) {
    let best = null; const tol = 10 * this.modelPerPx();
    for (const f of this.doc.elements()) {
      const d = this.doc.data(f); if (!d || !d.refs) continue;
      for (const r of d.refs) if (r.kind === "line") { const q = projectPoint(r.geom, p), dd = dist(p, q); if (dd < tol && (!best || dd < best.d)) best = { key: this.doc.idOf(f) + ":" + r.key, geom: r.geom, d: dd }; }
    }
    return best;
  }
  finishWall(closed) {
    const T = this.tool, o = this.app.toolOpts;
    const pts = T.pts.slice(); T.pts = []; T.cursor = null;
    if (pts.length < 2) return;
    const r = this.app.apply({ op: "draw", points: pts, closed, wallType: o.wallType, level: F.refId(this.view, "level"), height: o.height || 3000, mounting: o.mounting || "Centred", tol: 1 });
    this.app.say(r.ok ? `${r.ids.length} wall${r.ids.length > 1 ? "s" : ""} drawn and joined` : r.error, r.ok ? "ok" : "error");
    if (r.ok) this.app.select(r.ids);
  }
  /** Keys while this view has focus: Enter/Esc/C for the chain, digits for length. */
  key(e) {
    const T = this.tool, tool = this.app.tool;
    if (e.key === "Escape") { if (T.pts.length || T.refs) { T.pts = []; T.refs = []; this.hideHud(); this.draw(); return true; } return false; }
    if (tool === "wall" && T.pts.length) {
      if (e.key === "Enter" && !this.typed) { this.finishWall(false); return true; }
      if (e.key.toLowerCase() === "c" && T.pts.length >= 3) { this.finishWall(true); return true; }
      if (/^[0-9.]$/.test(e.key) || (e.key === "Backspace" && this.typed) || (e.key === "Enter" && this.typed)) {
        if (e.key === "Enter") {
          // walls are drawn by typing dimensions: the length along the current direction
          const last = T.pts[T.pts.length - 1], dir = normalise(sub(T.cursor || add(last, [1, 0]), last)), n = Number(this.typed);
          if (n > 0) T.pts.push(add(last, mul(dir, n)));
          this.typed = ""; this.hudInput = null; this.draw(); return true;
        }
        this.typed = e.key === "Backspace" ? this.typed.slice(0, -1) : (this.typed || "") + e.key;
        this.hudInput = true; this.hud.hidden = false; this.hud.textContent = `length ${this.typed} mm ⏎`;
        return true;
      }
    }
    return false;
  }
}
function distSeg(p, a, b) { const d = sub(b, a), L2 = dot(d, d); const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)); return dist(p, add(a, mul(d, t))); }
export function translateGeom(g, d) {
  if (Array.isArray(g)) return add(g, d);
  const o = Object.assign({}, g);
  for (const k of ["start", "end", "centre"]) if (Array.isArray(g[k])) o[k] = add(g[k], d);
  if (g.points) o.points = g.points.map(p => add(p, d));
  return o;
}
