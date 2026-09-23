//! The 2D view: canvas for the drawing, a DOM overlay for the few things that
//! benefit (handles, the heads-up readout, temporary dimensions, snap glyphs).
//! A handle never moves geometry: it computes a value for a named argument and
//! sends an ordinary edit (§10.1). In 2D that is pointer events and one affine
//! transform — no ray casting.

import { h, clear, fmtLen, icon } from "./ui_util.js";
import { parseLength, parseAngle, fmtArea } from "./units.js";
import { TOL, add, sub, mul, dot, dist, perp, normalise, lerp, intersectLines, lineThrough, projectPoint, pointInPoly, samplePath, polyArea, bboxOf } from "./geom2d.js";
import { deriveView, placements, dimensionGeometry } from "./scene.js";
import { drawScene, primsBBox } from "./render.js";
import { F, CATALOGUE } from "./ocaf.js";
import { uOf, pointAt } from "./walls.js";
import { listeningDimensions, dimensionMove, pickCandidates } from "./props.js";
import { resolveReference, measureRefs, sheetSize, viewExtent, orthoLine } from "./bim.js";
import { getPath, geomKey, wallEnds } from "./ops.js";
import { cropLoop, loopBBox, ANNOTATION_CROP } from "./crop.js";
import { shapeFromClicks, SHAPE_CLICKS, filletCorners, toCentreline, weld, offsetChain, outline } from "./bimsketch.js";

export const SNAP_PX = 8;
export const SNAP_KINDS = ["endpoint", "midpoint", "centre", "intersection", "perpendicular", "nearest", "grid", "angle"];
const SNAP_SHORT = { endpoint: "end", midpoint: "mid", centre: "cen", intersection: "int", perpendicular: "perp", nearest: "near", grid: "grid", angle: "ang" };
const TOOLS_NEED_PLAN = new Set(["section", "floor", "beam", "wall", "opening", "door", "window", "column", "grid", "text", "dim", "space", "elev", "sep", "move", "copy", "rotate", "mirror", "split"]);
export const MODIFY_TOOLS = new Set(["move", "copy", "rotate", "mirror"]);

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
    // a frame queued for a view the document no longer has (a new file was opened) draws nothing
    if (!this.view || this.doc !== this.app.doc || !this.doc.element(this.viewId)) return;
    const g = this.canvas.getContext("2d"), dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const sheet = this.kind === "Sheet";
    const sc = this.scene();
    g.fillStyle = sheet ? getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim() || "#dde1e7" : sc.background || "#ffffff";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
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
  // ---------------------------------------------------------------- levels in elevation and section
  viewZ0() { const lv = F.reference(this.view, "baseLevel"), d = lv && this.doc.data(lv); return d ? d.value || 0 : 0; }
  viewLineLength() { const c = F.json(this.view, "line"); return c ? dist(c.start, c.end) : 0; }
  /** Dimension tool in an elevation: click a level, then another; the dimension stands where the second click was. */
  levelDimClick(sx, sy) {
    const T = this.tool, hit = this.hitAt(sx, sy), f = hit && this.doc.element(hit.id);
    if (!f || this.doc.typeOf(f) !== "Level") return this.app.say("click a level line", "note");
    T.refs = (T.refs || []).concat([hit.id]);
    if (T.refs.length === 1) return this.app.say(`${F.text(f, "name")}: now click the other level`, "note");
    const [a, b] = T.refs; T.refs = [];
    if (a === b) return this.app.say("pick two different levels", "note");
    const p = this.toModel(sx, sy);
    const r = this.app.apply({ op: "add", element: { type: "Dimension", args: { of: [a + ":plane", b + ":plane"], offset: Math.round(p[0]), view: { ref: this.viewId }, locked: false } } });
    if (r.ok) { this.app.say("Dimension between levels: click its padlock to lock the height, or its value to change it", "ok"); this.app.select([r.id]); }
  }
  /** A selected level shows its height at its head, editable: type a height and the level moves there. */
  levelHeadEditor(f) {
    const id = this.doc.idOf(f), z = F.real(f, "elevation"), at = this.toScreen([this.viewLineLength() + 1500, z - this.viewZ0()]);
    const inp = h("input", { type: "text", value: fmtLen(z), class: "levelinput", "aria-label": `${F.text(f, "name")} elevation`, title: "Elevation: type it in any unit (3.3m, 10'-6\", 3300mm, L1+300) and press Enter", style: { left: (at[0] + 22) + "px", top: (at[1] - 30) + "px" } });
    inp.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key !== "Enter") return;
      const v = readLen(inp.value, this.app); if (v === null) return;
      const r = this.app.apply({ op: "set", id, key: "elevation", value: v });
      if (r.ok) this.app.say(`${F.text(f, "name")} at ${fmtLen(v)}`, "ok");
    });
    this.overlay.append(inp);
  }
  /** A dimension between levels: its value typed moves the second level; its padlock locks the height between them. */
  levelDimEditor(f) {
    const doc = this.doc, id = doc.idOf(f), m = measureRefs(doc, F.json(f, "of")), keys = F.json(f, "of");
    const [a, b] = keys.map(k => k.split(":")[0]), locked = F.bool(f, "locked");
    const sx = F.real(f, "offset"), mid = this.toScreen([sx, (m.a.z + m.b.z) / 2 - this.viewZ0()]);
    const box = h("div", { class: "tdim", style: { left: (mid[0] - 40) + "px", top: mid[1] + "px" } });
    const val = h("button", { title: "Click to type the height between these levels", "aria-label": `Height ${fmtLen(m.value)}` }, fmtLen(m.value));
    val.addEventListener("click", () => {
      const inp = h("input", { type: "text", value: String(Math.round(m.value)), "aria-label": "Height between levels in mm" });
      val.replaceWith(inp); inp.focus(); inp.select();
      inp.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Escape") return this.draw();
        if (e.key !== "Enter") return;
        const v = readLen(inp.value, this.app); if (v === null) return; if (!(v >= 0)) return this.app.say("a height is not negative", "error");
        const signed = Math.sign(m.signed || 1) * v, row = doc.constraints.find(c => c.kind === "levelGap" && JSON.stringify(c.of) === JSON.stringify(keys));
        const ops = [];
        if (row) ops.push({ op: "relate", store: "constraints", row: Object.assign({}, row, { value: signed }) });
        ops.push({ op: "set", id: b, key: "elevation", value: Math.round((m.a.z + signed) * 1000) / 1000 });
        const r = this.app.apply(ops); if (r.ok) this.app.say(`${F.text(doc.element(b), "name")} is ${fmtLen(v)} from ${F.text(doc.element(a), "name")}`, "ok");
      });
    });
    const lock = h("button", { class: "lock", title: locked ? "Unlock: the levels move independently again" : "Padlock: moving either level moves the other", "aria-label": locked ? "Unlock height" : "Lock height", "aria-pressed": String(locked) }, icon(locked ? "lock" : "unlock"));
    lock.addEventListener("click", () => {
      const row = doc.constraints.find(c => c.kind === "levelGap" && JSON.stringify(c.of) === JSON.stringify(keys));
      const ops = [{ op: "set", id, key: "locked", value: !locked },
        { op: "relate", store: "constraints", row: Object.assign(row ? {} : { kind: "levelGap", of: keys }, row || {}, { value: m.signed, locked: !locked }) }];
      const r = this.app.apply(ops); if (r.ok) this.app.say(locked ? "Levels unlocked" : `Locked: ${fmtLen(m.value)} between them`, "ok");
    });
    box.append(val, lock); this.overlay.append(box);
  }
  // ---------------------------------------------------------------- crop region: grips and the Edit Crop sketch
  clipOf() { return Object.assign({ rect: null, visible: false, active: false }, this.doc.argValue(this.view, "clip") || {}); }
  /** Two rectangles, as Revit draws them: the crop (model) and the annotation crop outside it, each with edge grips. */
  cropGrips() {
    const clip = this.clipOf(); if (!clip.visible || !clip.rect) return;
    const S = F.int(this.view, "scale") || 100, loop = cropLoop(clip), bb = loopBBox(loop), ann = clip.annotation || ANNOTATION_CROP;
    const shaped = !!(clip.shape && clip.shape.elements && clip.shape.elements.length);
    const annRect = [bb[0] - ann[0] * S, bb[1] - ann[1] * S, bb[2] + ann[2] * S, bb[3] + ann[3] * S];
    const edges = (r, kind) => [["left", [r[0], (r[1] + r[3]) / 2]], ["bottom", [(r[0] + r[2]) / 2, r[1]]], ["right", [r[2], (r[1] + r[3]) / 2]], ["top", [(r[0] + r[2]) / 2, r[3]]]].map(([side, at]) => ({ side, at, kind }));
    const grips = [...(shaped ? [] : edges(clip.rect, "crop")), ...edges(annRect, "annotation")];
    for (const gp of grips) {
      const sp = this.toScreen(gp.at);
      const el = h("div", { class: "handle crop " + gp.kind, title: gp.kind === "crop" ? `Crop region: drag the ${gp.side} edge` : `Annotation crop: drag the ${gp.side} edge`, "aria-label": `${gp.kind} crop ${gp.side}`, style: { left: sp[0] + "px", top: sp[1] + "px" } });
      el.addEventListener("pointerdown", e => this.dragCropEdge(e, gp));
      this.overlay.append(el);
    }
    if (shaped) { const c = this.toScreen([(bb[0] + bb[2]) / 2, bb[3]]); this.overlay.append(h("button", { class: "btn small cropedit", style: { left: c[0] + "px", top: (c[1] - 30) + "px" }, onclick: () => this.startCropSketch() }, "Edit Crop")); }
  }
  dragCropEdge(e, gp) {
    e.preventDefault(); e.stopPropagation();
    const clip0 = this.clipOf(), S = F.int(this.view, "scale") || 100, key = `crop:${this.viewId}:${e.timeStamp}`;
    const bb = loopBBox(cropLoop(clip0)), ann0 = (clip0.annotation || ANNOTATION_CROP).slice();
    const move = ev => {
      const p = this.quantise(this.toModel(...this.evPos(ev))), clip = JSON.parse(JSON.stringify(clip0));
      const i = { left: 0, bottom: 1, right: 2, top: 3 }[gp.side], axis = i % 2, lowSide = i < 2;
      if (gp.kind === "crop") {
        const r = clip.rect.slice(), min = 100 * S / 100;
        r[i] = lowSide ? Math.min(p[axis], r[i + 2] - min) : Math.max(p[axis], r[i - 2] + min);
        clip.rect = r;
      } else {
        const ann = ann0.slice(), edge = bb[i];
        ann[i] = Math.max(0, Math.round((lowSide ? edge - p[axis] : p[axis] - edge) / S * 10) / 10);
        clip.annotation = ann;
      }
      this.app.apply({ op: "set", id: this.viewId, key: "clip", value: clip }, { quiet: true, coalesce: key });
      this.showHud(...this.evPos(ev), gp.kind === "crop" ? `crop ${gp.side}` : `annotation crop ${gp.side}: ${clip.annotation[i]} mm on paper`);
    };
    const up = () => { window.removeEventListener("pointermove", move); this.app.editor.seal(); this.hideHud(); this.app.refresh({ keepMain: true }); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true });
  }
  /** Edit Crop: the crop's sketch mode - the same sketcher a floor's boundary uses. It opens with
   *  what is there: the sketch, or the rectangle as four lines. */
  startCropSketch() {
    const clip = this.clipOf();
    const els = clip.shape && clip.shape.elements && clip.shape.elements.length ? JSON.parse(JSON.stringify(clip.shape.elements))
      : clip.rect ? (([x0, y0, x1, y1]) => [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]].map(([a, b], i) => ({ id: "e" + (i + 1), type: "line", a, b })))(clip.rect)
      : [];
    els.forEach((el, i) => { if (!el.id) el.id = "e" + (i + 1); });
    this.app.startSketch(this, { kind: "crop", cropView: this }, { elements: els, constraints: [], dims: [] });
  }
  /** Swing a door's leaf open to its swing angle and back, drawn over the plan (nothing is edited). */
  animateDoor(id, ms = 2600) {
    const f = this.doc.element(id), d = f && this.doc.data(f); if (!d || !d.swing || this.kind !== "PlanView") return false;
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms), phase = k < 0.5 ? k * 2 : (1 - k) * 2, e = phase * phase * (3 - 2 * phase);
      this.doorAnim = k < 1 ? { swing: d.swing, e } : null; this.draw();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step); return true;
  }
  /** A selected (or hovered) elevation or section shows what it sees: its line swept to the far clip.
   *  The grips on it (see viewLineHandles) set the far clip and the width. */
  drawViewExtents(g) {
    if (this.kind !== "PlanView") return;
    const ids = new Set([...this.app.selection, this.hover].filter(Boolean));
    for (const id of ids) {
      const f = this.doc.element(id); if (!f || !["ElevationView", "SectionView"].includes(this.doc.typeOf(f))) continue;
      const ex = viewExtent(f), P = ex.corners.map(q => this.toScreen(q)), sel = this.app.selection.has(id);
      g.fillStyle = sel ? "rgba(29,111,216,.07)" : "rgba(29,111,216,.04)"; g.strokeStyle = "#1d6fd8"; g.lineWidth = sel ? 1.4 : 1; g.setLineDash([7, 4]);
      g.beginPath(); P.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); g.fill(); g.stroke(); g.setLineDash([]);
      if (!sel) continue;
      // the far clip labelled with its depth, like a temporary dimension
      // outside the far edge, so it never sits on the drawing
      const out = normalise(sub(lerp(P[2], P[3], 0.5), lerp(P[0], P[1], 0.5))), mid = add(lerp(P[2], P[3], 0.5), mul(out, 16)), a = Math.atan2(P[3][1] - P[2][1], P[3][0] - P[2][0]);
      g.save(); g.translate(mid[0], mid[1]); g.rotate(Math.abs(a) > Math.PI / 2 ? a + Math.PI : a); g.textBaseline = "middle";
      g.font = "11px system-ui, sans-serif"; g.textAlign = "center"; g.fillStyle = "#1d6fd8";
      g.fillText(`${this.doc.typeOf(f) === "SectionView" ? "far clip" : "depth"} ${fmtLen(ex.depth)} · width ${fmtLen(dist(ex.c.start, ex.c.end))}`, 0, 0); g.restore();
    }
  }
  drawTemp(g) {
    g.save(); g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const blue = "#1d6fd8";
    if (this.app.sketch && this.app.sketch.view === this) this.app.sketch.draw(g);
    if (this.doorAnim) {
      g.fillStyle = "rgba(232,89,26,.25)"; g.strokeStyle = "#e8591a"; g.lineWidth = 2;
      for (const sw of this.doorAnim.swing) {
        const deg = sw.openDeg + (sw.swingDeg - sw.openDeg) * this.doorAnim.e, r = deg * Math.PI / 180;
        const dv = [sw.closed[0] * Math.cos(r) + sw.open[0] * Math.sin(r), sw.closed[1] * Math.cos(r) + sw.open[1] * Math.sin(r)];
        const tv = [-sw.open[0] * Math.cos(r) + sw.closed[0] * Math.sin(r), -sw.open[1] * Math.cos(r) + sw.closed[1] * Math.sin(r)];
        const P = [sw.hinge, add(sw.hinge, mul(dv, sw.len)), add(add(sw.hinge, mul(dv, sw.len)), mul(tv, sw.lt)), add(sw.hinge, mul(tv, sw.lt))].map(q => this.toScreen(q));
        g.beginPath(); P.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); g.fill(); g.stroke();
      }
    }
    this.drawViewExtents(g);
    if (this.app.tool === "split" && this.tool.cursor) {
      // the cut, shown where it will fall
      const q = this.toScreen(this.tool.cursor); g.strokeStyle = "#d11f1f"; g.lineWidth = 2; g.beginPath(); g.moveTo(q[0] - 6, q[1] + 10); g.lineTo(q[0] + 6, q[1] - 10); g.stroke();
      g.fillStyle = "#d11f1f"; g.beginPath(); g.arc(q[0], q[1], 3, 0, 7); g.fill();
    }
    const T = this.tool, wShape = this.app.tool === "wall" ? (this.app.toolOpts.wallShape || "line") : null;
    if (wShape && wShape !== "line" && wShape !== "pick" && T.pts.length && T.cursor) {
      // the shape the next click completes, dashed, as the sketcher previews it
      const els = shapeFromClicks(wShape, [...T.pts, T.cursor], { sides: this.app.toolOpts.wallSides || 6 });
      g.strokeStyle = blue; g.lineWidth = 1.5; g.setLineDash([6, 4]);
      for (const el of els) { g.beginPath(); outline(el, 96).forEach((q, i) => { const s_ = this.toScreen(q); i ? g.lineTo(s_[0], s_[1]) : g.moveTo(s_[0], s_[1]); }); g.stroke(); }
      if (wShape === "bspline") { g.lineWidth = 1; g.beginPath(); [...T.pts, T.cursor].forEach((q, i) => { const s_ = this.toScreen(q); i ? g.lineTo(s_[0], s_[1]) : g.moveTo(s_[0], s_[1]); }); g.stroke(); }
      g.setLineDash([]);
      for (const p of T.pts) { const q = this.toScreen(p); g.fillStyle = blue; g.fillRect(q[0] - 3, q[1] - 3, 6, 6); }
    } else if (T.pts.length && T.cursor) {
      g.strokeStyle = blue; g.lineWidth = 1.5; g.setLineDash([6, 4]);
      g.beginPath(); const a = this.toScreen(T.pts[0]); g.moveTo(a[0], a[1]);
      for (const p of T.pts.slice(1).concat([T.cursor])) { const q = this.toScreen(p); g.lineTo(q[0], q[1]); }
      g.stroke(); g.setLineDash([]);
      for (const p of T.pts) { const q = this.toScreen(p); g.fillStyle = blue; g.fillRect(q[0] - 3, q[1] - 3, 6, 6); }
    }
    if (T.ghost) { g.strokeStyle = "#1d6fd8"; g.lineWidth = 1.2; g.setLineDash([4, 3]); for (const poly of T.ghost) { g.beginPath(); poly.forEach((p, i) => { const q = this.toScreen(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.stroke(); } g.setLineDash([]); }
    if (T.centre && this.app.tool === "rotate") { const q = this.toScreen(T.centre); g.strokeStyle = "#1d6fd8"; g.beginPath(); g.arc(q[0], q[1], 6, 0, 7); g.stroke(); if (T.cursor) { const c = this.toScreen(T.cursor); g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(c[0], c[1]); g.stroke(); } if (T.pts[0]) { const c = this.toScreen(T.pts[0]); g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(c[0], c[1]); g.stroke(); } }
    if (T.preview) { g.strokeStyle = blue; g.lineWidth = 2; g.beginPath(); T.preview.forEach((p, i) => { const q = this.toScreen(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); }
    for (const d of this.tdims || []) {
      g.strokeStyle = blue; g.lineWidth = 1; g.beginPath(); g.moveTo(d.sa[0], d.sa[1]); g.lineTo(d.sb[0], d.sb[1]); g.stroke();
      for (const p of [d.sa, d.sb]) { g.beginPath(); g.moveTo(p[0] - 4, p[1] + 4); g.lineTo(p[0] + 4, p[1] - 4); g.stroke(); }
    }
    if (this.box) {
      const [a, b] = this.box, crossing = b[0] < a[0];
      g.strokeStyle = "#1d6fd8"; g.fillStyle = crossing ? "rgba(46,125,50,.08)" : "rgba(29,111,216,.08)"; g.lineWidth = 1; g.setLineDash(crossing ? [5, 3] : []);
      g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g.setLineDash([]);
    }
    for (const gl of this.guides || []) { g.strokeStyle = "#e8591a"; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(gl[0][0], gl[0][1]); g.lineTo(gl[1][0], gl[1][1]); g.stroke(); g.setLineDash([]); }
    g.restore();
  }
  /** Handles and temporary dimensions: a few dozen DOM nodes, constant screen size. */
  layoutOverlay() {
    clear(this.overlay);
    this.tdims = [];
    const doc = this.doc, ids = [...this.app.selection];
    if (this.app.sketch && this.app.sketch.view === this) { this.app.sketch.overlay(this.overlay); return; }
    if (this.kind === "PlanView" && this.app.tool === "select") this.cropGrips();
    if ((this.kind === "ElevationView" || this.kind === "SectionView") && ids.length === 1 && this.app.tool === "select") {
      const f = doc.element(ids[0]);
      if (f && doc.typeOf(f) === "Level") return this.levelHeadEditor(f);
      if (f && doc.typeOf(f) === "Dimension" && measureRefs(doc, F.json(f, "of") || []).kind === "levels") return this.levelDimEditor(f);
    }
    if (this.kind !== "PlanView" || ids.length !== 1 || this.app.tool !== "select") return;
    const f = doc.element(ids[0]); if (!f) return;
    const decl = doc.declOf(f);
    // Revit's pin, beside what is selected: the pushpin when pinned, struck through in red when not
    if (decl && decl.args.some(x => x.key === "pinned")) {
      const hs = this.scene().hits.filter(x => x.id === ids[0]), pts = hs.flatMap(x => x.pts);
      if (pts.length) {
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), at = this.toScreen([Math.max(...xs), Math.max(...ys)]), pinned = F.bool(f, "pinned");
        this.overlay.append(h("button", { class: "pinbtn" + (pinned ? " on" : ""), title: pinned ? "Pinned: it cannot be moved. Click to unpin (UP)" : "Not pinned: click to pin it where it is (PN)", "aria-label": pinned ? "Unpin" : "Pin", "aria-pressed": String(pinned),
          style: { left: Math.min(this.W - 20, at[0] + 10) + "px", top: Math.max(4, at[1] - 26) + "px" }, onclick: () => this.app.apply({ op: "pin", id: ids[0], value: !pinned }) }, icon(pinned ? "pin" : "unpin", 18)));
      }
      if (F.bool(f, "pinned")) return;                 // pinned: no grips to drag it by
    }
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
    if (doc.typeOf(f) === "Dimension") this.dimensionEditor(f);
  }
  /** A placed dimension, as in Revit: drag the grip (or the dimension itself) to slide
   *  the line; click the value to type a new distance, which moves what it measures. */
  dimensionEditor(f) {
    const doc = this.doc, id = doc.idOf(f), g = dimensionGeometry(doc, f); if (!g) return;
    const mid = lerp(g.A, g.Bp, 0.5), sm = this.toScreen(mid);
    const grip = h("div", { class: "handle move", title: "Drag to move the dimension line", "aria-label": "Move dimension line", style: { left: sm[0] + "px", top: sm[1] + "px" } });
    grip.addEventListener("pointerdown", e => {
      e.preventDefault(); e.stopPropagation(); // the overlay re-renders while dragging, so listen on the window
      const r = this.canvas.getBoundingClientRect(), start = this.toModel(e.clientX - r.left, e.clientY - r.top), key = `dimoff:${id}:${e.timeStamp}`;
      const move = ev => { const p = this.toModel(ev.clientX - r.left, ev.clientY - r.top); this.slideDimension(id, g, start, p, key); this.showHud(ev.clientX - r.left, ev.clientY - r.top, `offset ${fmtLen(F.real(doc.element(id), "offset"))}`); };
      const up = () => { window.removeEventListener("pointermove", move); this.app.editor.seal(); this.hideHud(); this.app.refresh({ keepMain: true }); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true });
    });
    const at = this.toScreen(add(mid, mul(g.along, 6 * this.modelPerPx() * Math.sign(g.off || 1) + 0)));
    const box = h("div", { class: "tdim", style: { left: at[0] + "px", top: (at[1] - 18) + "px" } });
    const locked = F.bool(f, "locked");
    const val = h("button", { title: "Click to type a new distance: the measured element moves", "aria-label": `Dimension value ${fmtLen(g.value)}` }, fmtLen(g.value));
    val.addEventListener("click", () => {
      const inp = h("input", { type: "text", value: String(Math.round(g.value)), "aria-label": "New distance in mm" });
      val.replaceWith(inp); inp.focus(); inp.select();
      inp.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Escape") return this.draw();
        if (e.key !== "Enter") return;
        const v = readLen(inp.value, this.app); if (v === null) return; if (!(v >= 0)) return this.app.say("a distance is not negative", "error");
        const r = this.setDimensionValue(f, v);
        this.app.say(r.ok ? `Distance set to ${fmtLen(v)}; ${r.moved} moved` : r.error, r.ok ? "ok" : "error");
      });
    });
    const lock = h("button", { class: "lock", title: locked ? "Unlock this distance" : "Padlock: keep this distance", "aria-label": locked ? "Unlock dimension" : "Lock dimension", "aria-pressed": String(locked) }, icon(locked ? "lock" : "unlock"));
    lock.addEventListener("click", () => {
      const keys = F.json(f, "of"), row = doc.constraints.find(c => JSON.stringify(c.of) === JSON.stringify(keys));
      const ops = [{ op: "set", id, key: "locked", value: !locked },
        { op: "relate", store: "constraints", row: Object.assign(row ? {} : { kind: "distance", of: keys }, row || {}, { value: Math.round(g.value * 1000) / 1000, locked: !locked }) }];
      const r = this.app.apply(ops); if (r.ok) this.app.say(locked ? "Dimension unlocked: it follows the elements again" : `Padlocked at ${fmtLen(g.value)}`, "ok");
    });
    box.append(val, lock);
    this.overlay.append(grip, box);
  }
  slideDimension(id, g, start, p, key) {
    const off = Math.round((g.off + dot(sub(p, start), g.along)) / 10) * 10;
    this.app.apply({ op: "set", id, key: "offset", value: off }, { quiet: true, coalesce: key });
  }
  /** Change what a dimension measures: move the element of its second reference (else the first) along the measured direction. */
  setDimensionValue(f, value) {
    const doc = this.doc, g = dimensionGeometry(doc, f); if (!g) return { ok: false, error: "this dimension has lost a reference" };
    const keys = F.json(f, "of"), want = Math.sign(g.signed || 1) * value, delta = want - g.signed;
    const movable = k => { const e = doc.element(k.split(":")[0]); return e && geomKey(e, doc) ? doc.idOf(e) : null; };
    const second = movable(keys[1]), first = movable(keys[0]);
    const mover = second || first; if (!mover) return { ok: false, error: "neither referenced element can move" };
    const k = second ? delta : -delta, mv = [Math.round(g.dir[0] * k * 1000) / 1000, Math.round(g.dir[1] * k * 1000) / 1000];
    const ops = [];
    const row = doc.constraints.find(c => JSON.stringify(c.of) === JSON.stringify(keys));
    if (row) ops.push({ op: "relate", store: "constraints", row: Object.assign({}, row, { value }) });
    ops.push({ op: "transform", ids: [mover], move: mv });
    const r = this.app.apply(ops);
    return Object.assign({ moved: mover }, r);
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
          const v = readLen(inp.value, this.app); if (v === null) return;
          if (!(v >= 0)) { this.app.say("a distance is not negative", "error"); return; }
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
    // the overlay (and this handle) is rebuilt on every redraw, so the gesture listens on the window
    const id = this.doc.idOf(f), grab = this.quantise(this.toModel(...this.evPos(e)));
    const orig = JSON.parse(JSON.stringify(getPath(this.doc, f, hd.writes)));
    const key = `set:${id}:${hd.writes}`;
    let typed = "";
    const valueFor = (p) => {
      const c = hd.constraint;
      if (c && c.axis) { const t = dot(sub(p, c.origin), c.axis); if (hd.writes === "mountOffset") return -t; if (c.scalar) return Math.max(c.min || 0, Math.round(t)); return add(c.origin, mul(c.axis, t)); }
      if (c && c.onCurve) { const w = this.doc.plan(this.doc.element(c.onCurve)); return Math.max(0, Math.min(w.L, Math.round(uOf(w, p)))); }
      if (hd.key === "move" || (orig && typeof orig === "object" && !Array.isArray(orig))) { const d = sub(p, grab); return translateGeom(orig, d); }
      return p;
    };
    const readout = (v, snapped) => {
      const c = this.doc.argValue(f, "centreline");
      if (hd.readout === "length" && c) return `L ${fmtLen(dist(c.start, Array.isArray(v) ? v : c.end))}${snapped ? " · " + SNAP_SHORT[snapped.kind] : ""}`;
      if (typeof v === "number") return `${fmtLen(v)}`;
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
      if (!typeKey(ev.key, typed) && ev.key !== "Enter" && ev.key !== "Backspace") return;
      ev.preventDefault();
      if (ev.key === "Enter" && typed) {
        const n = readLen(typed, this.app); if (n === null) { typed = ""; return; } const c = this.doc.argValue(f, hd.writes.split(".")[0]);
        let v = null;
        if (hd.readout === "length" && c && c.start) { const d = normalise(sub(c.end, c.start)); v = add(c.start, mul(d, n)); }
        else if (hd.constraint && (hd.constraint.onCurve || hd.constraint.scalar)) v = Math.max(hd.constraint.min || 0, n);
        if (v !== null) { send(v); this.app.say(`${id}: exactly ${fmtLen(n)}`, "ok"); }
        finish(); return;
      }
      typed = ev.key === "Backspace" ? typed.slice(0, -1) : typed + ev.key;
      this.hudInput = true; this.hud.textContent = `type: ${typed || "…"} ⏎`;
    };
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("keydown", key_, true);
      // the end let go of a wall or landed on one: joins follow the geometry, in the same undo step
      if (this.doc.typeOf(f) === "Wall" && hd.writes.startsWith("centreline")) { const ends = hd.writes === "centreline" ? wallEnds(this.doc, [id]) : [{ id, end: hd.writes.split(".")[1] }]; this.app.apply({ op: "autojoin", ends }, { quiet: true, coalesce: key }); }
      this.app.editor.seal(); this.showSnap(null); this.hideHud(); this.app.refresh(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
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
    // Tab has chosen among what is under the cursor: that choice holds until the cursor moves away
    if (this.tabPick && Math.abs(sx - this.tabPick.sx) + Math.abs(sy - this.tabPick.sy) < 5) return this.tabPick.list[this.tabPick.index];
    return this.hitsAt(sx, sy)[0] || null;
  }
  /** Everything under the cursor, most specific first: the smallest region, the nearest line, datums last. */
  hitsAt(sx, sy) {
    const sc = this.scene(); const p = this.toModel(sx, sy), tol = 6 * this.modelPerPx();
    if (this.kind === "Sheet") return [];
    const byId = new Map();
    for (const ht of sc.hits) {
      if (!ht.id) continue;
      let hit = false, score = 0;
      if (ht.kind === "curve") { for (let i = 0; i < ht.pts.length - 1; i++) { const a = ht.pts[i], b = ht.pts[i + 1], d = distSeg(p, a, b); if (d < tol) { hit = true; score = d; } } score = score * 0.001;
        // a datum line running through a wall must not steal the click from the wall
        const f = this.doc.element(ht.id); if (f && ["Grid", "RoomSeparator", "ElevationView", "SectionView", "Level"].includes(this.doc.typeOf(f))) score += 1e12; }
      else if (ht.pts.length > 2 && pointInPoly(p, ht.pts)) { hit = true; score = Math.abs(polyArea(ht.pts)); }
      // in an elevation or section what is nearer the viewer comes first, whatever its size
      const depth = ht.depth || 0, datum = score >= 1e12 ? 1 : 0;
      const k = byId.get(ht.id);
      if (hit && (!k || depth < k.depth || (depth === k.depth && score < k.score))) byId.set(ht.id, { id: ht.id, score, depth, datum });
    }
    return [...byId.values()].sort((a, b) => a.datum - b.datum || a.depth - b.depth || a.score - b.score);
  }
  /** Revit's Tab: step through everything under the cursor; the click then takes the one highlighted. */
  tabCycle(back) {
    const [sx, sy] = this.lastMouse || [0, 0];
    const fresh = !this.tabPick || Math.abs(sx - this.tabPick.sx) + Math.abs(sy - this.tabPick.sy) >= 5;
    const list = fresh ? this.hitsAt(sx, sy) : this.tabPick.list;
    if (!list.length) return false;
    const index = fresh ? (list.length > 1 ? 1 : 0) : (this.tabPick.index + (back ? list.length - 1 : 1)) % list.length;
    this.tabPick = { sx, sy, list, index };
    this.hover = list[index].id; this.draw();
    const f = this.doc.element(this.hover);
    this.app.say(`Tab ${index + 1} of ${list.length}: ${f ? `${this.doc.typeOf(f)} ${this.hover}${f.get("Name") && f.get("Name") !== this.hover ? " · " + f.get("Name") : ""}` : this.hover} — click to select it, Tab for the next`, "note");
    return true;
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
    c.addEventListener("contextmenu", e => e.preventDefault());
    const sp = on => e => { if (e.code === "Space" && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) { this.space = on; this.canvas.style.cursor = on ? "grab" : "default"; } };
    window.addEventListener("keydown", sp(true)); window.addEventListener("keyup", sp(false));
    // Tab under the cursor cycles the candidates, whether or not the canvas has focus
    c.addEventListener("pointerenter", () => { this.mouseIn = true; }); c.addEventListener("pointerleave", () => { this.mouseIn = false; });
    this.onTab = e => { if (e.key !== "Tab" || !this.mouseIn || !this.canvas.isConnected || this.app.tool !== "select") return; if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || "")) return; if (this.tabCycle(e.shiftKey)) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener("keydown", this.onTab, true);
    c.addEventListener("dragover", e => { if (this.kind === "Sheet") e.preventDefault(); });
    c.addEventListener("drop", e => {
      const vid = e.dataTransfer.getData("text/x-webbim-view"); if (!vid || this.kind !== "Sheet") return;
      e.preventDefault(); const p = this.toModel(...this.evPos(e));
      const r = this.app.apply({ op: "place", sheet: this.viewId, view: vid, at: p.map(Math.round) });
      this.app.say(r.ok ? `Placed ${this.doc.element(vid).get("Name")} as ${r.id}, centred where you dropped it` : r.error, r.ok ? "ok" : "error");
      if (r.ok) this.app.select([`${this.viewId}:${r.id}`]);
    });
  }
  zoomAt(sx, sy, k) { const before = [sx / this.cam.z + this.cam.x, (this.H - sy) / this.cam.z + this.cam.y]; this.cam.z = Math.max(0.02, Math.min(400, this.cam.z * k)); this.cam.x = before[0] - sx / this.cam.z; this.cam.y = before[1] - (this.H - sy) / this.cam.z; this.draw(); }
  down(e) {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.evPos(e));
    if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = { d: dist(a, b), cam: Object.assign({}, this.cam), mid: lerp(a, b, 0.5) }; this.drag = null; return; }
    const [sx, sy] = this.evPos(e);
    // Revit's mouse: middle or right drag pans (as does Space+drag or one finger);
    // left drag on empty space draws a selection box; left drag on a selected element moves it.
    // middle-drag pans (as in a PDF viewer); so do Space+drag and a finger. A left drag is a normal drag.
    const pan = e.button === 1 || this.space || e.pointerType === "touch";
    if (e.button === 1) e.preventDefault();
    // sketch mode: Select drags elements (and boxes); the drawing tools take the click on release
    if (!pan && this.app.sketch && this.app.sketch.view === this && this.app.sketch.pointerDown(sx, sy, e)) { this.drag = null; return; }
    this.drag = { start: [sx, sy], cam: Object.assign({}, this.cam), moved: false, button: e.button, shift: e.shiftKey, pan };
    if (pan || e.button !== 0 || this.app.tool !== "select" || this.app.pickMode) return;
    const hit = this.hitAt(sx, sy);
    if (this.kind === "Sheet") {
      // press on a viewport and drag: it moves (selecting it first if it was not)
      if (hit) {
        const key = this.viewId + ":" + hit.id;
        if (!this.app.selection.has(key)) { this.app.selection.clear(); this.app.selection.add(key); this.pressSelected = true; }
        const vp = (this.doc.argValue(this.view, "viewports") || []).find(v => v.id === hit.id);
        if (vp) this.drag.viewport = { id: hit.id, at: vp.at.slice(), bb: hit.bb };
      }
      return;
    }
    if (hit && this.kind === "PlanView") {
      // pressing on something not yet selected selects it first, so one press-and-drag moves it
      if (!this.app.selection.has(hit.id) && !e.shiftKey) { this.app.selection.clear(); this.app.selection.add(hit.id); this.pressSelected = true; }
      const hf = this.doc.element(hit.id);
      if (hf && this.doc.typeOf(hf) === "Dimension") { const g = dimensionGeometry(this.doc, hf); if (g) this.drag.dim = { id: hit.id, g, grab: this.toModel(sx, sy) }; return; }
      const movable = [...this.app.selection].filter(id => this.doc.element(id) && geomKey(this.doc.element(id), this.doc));
      if (movable.length) this.drag.body = { ids: movable, grab: this.toModel(sx, sy) };
    } else if (!hit) this.drag.box = true;
    // in an elevation a level line drags up and down: everything bound to it follows
    if (hit && this.kind === "ElevationView") {
      const f = this.doc.element(hit.id);
      if (f && this.doc.typeOf(f) === "Level") {
        if (!this.app.selection.has(hit.id)) { this.app.selection.clear(); this.app.selection.add(hit.id); this.pressSelected = true; }
        this.drag.level = { id: hit.id, z0: F.real(f, "elevation"), grab: this.toModel(sx, sy) };
      }
    }
  }
  dragLevel(d, sx, sy) {
    const p = this.toModel(sx, sy), dz = Math.round((p[1] - d.level.grab[1]) / 10) * 10, z = d.level.z0 + dz;
    if (z !== d.level.last) {
      const r = this.app.apply({ op: "set", id: d.level.id, key: "elevation", value: z }, { quiet: true, coalesce: `level:${d.level.id}:${d.start.join(",")}` });
      if (r.ok) d.level.last = z;
    }
    this.showHud(sx, sy, `${F.text(this.doc.element(d.level.id), "name")}: ${z >= 0 ? "+" : ""}${fmtLen(z)}`);
  }
  move(e) {
    const [sx, sy] = this.evPos(e);
    this.lastMouse = [sx, sy];
    if (this.tabPick && Math.abs(sx - this.tabPick.sx) + Math.abs(sy - this.tabPick.sy) >= 5) this.tabPick = null;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [sx, sy]);
    if (this.pinch && this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; const k = dist(a, b) / this.pinch.d; this.cam = Object.assign({}, this.pinch.cam); this.zoomAt(this.pinch.mid[0], this.pinch.mid[1], k); return; }
    const d = this.drag;
    if (d) {
      if (Math.abs(sx - d.start[0]) + Math.abs(sy - d.start[1]) > 4) d.moved = true;
      if (d.viewport && d.moved) return this.dragViewport(d, sx, sy);
      if (d.pan && d.moved) { this.cam.x = d.cam.x - (sx - d.start[0]) / this.cam.z; this.cam.y = d.cam.y + (sy - d.start[1]) / this.cam.z; this.draw(); return; }
      if (d.body && d.moved) return this.dragBody(d, sx, sy, e);
      if (d.level && d.moved) return this.dragLevel(d, sx, sy);
      if (d.dim && d.moved) { this.slideDimension(d.dim.id, d.dim.g, d.dim.grab, this.toModel(sx, sy), `dimoff:${d.dim.id}:${d.start.join(",")}`); this.showHud(sx, sy, `offset ${fmtLen(F.real(this.doc.element(d.dim.id), "offset"))}`); return; }
      if (d.box && d.moved) { this.box = [d.start, [sx, sy]]; this.draw(); return; }
    }
    const p = this.toModel(sx, sy);
    if (this.app.sketch && this.app.sketch.view === this) { this.canvas.style.cursor = this.app.sketch.tool === "select" ? "default" : "crosshair"; this.app.sketch.hover(p, e); return; }
    if (this.app.tool !== "select" && this.kind === "PlanView") return this.toolHover(p, sx, sy, e);
    const hit = this.hitAt(sx, sy), hid = hit ? (this.kind === "Sheet" ? null : hit.id) : null;
    if (hid !== this.hover) { this.hover = hid; this.draw(); if (hid) this.app.hoverInfo(hid); }
    this.canvas.style.cursor = this.app.pickMode ? "crosshair" : hit ? (hid && this.app.selection.has(hid) ? "move" : "pointer") : "default";
  }
  up(e) {
    this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag; this.drag = null;
    const pressed = this.pressSelected; this.pressSelected = false;
    if (!d) return;
    if (d.viewport) { this.guides = []; this.app.editor.seal(); this.draw(); if (d.moved) { this.app.refresh({ keepMain: true }); return; } }
    if (d.body && d.moved) { const ends = wallEnds(this.doc, d.body.ids); if (ends.length) this.app.apply({ op: "autojoin", ends }, { quiet: true, coalesce: `move:${d.body.ids.join(",")}:${d.start.join(",")}` }); this.app.editor.seal(); this.showSnap(null); this.hideHud(); this.app.refresh({ keepMain: true }); return; }
    if (d.dim && d.moved) { this.app.editor.seal(); this.hideHud(); this.app.refresh({ keepMain: true }); return; }
    if (d.level && d.moved) { this.app.editor.seal(); this.hideHud(); this.app.refresh({ keepMain: true }); this.app.say("Level moved: walls, rooms and views bound to it followed", "ok"); return; }
    if (d.box && d.moved) return this.finishBox(d, e);
    if (d.moved) return;
    const [sx, sy] = this.evPos(e);
    if (e.button === 2) return this.app.contextMenu(e, "2d");
    if (this.app.pickMode) return this.pick(sx, sy);
    if (this.app.tool === "dim" && (this.kind === "ElevationView" || this.kind === "SectionView")) return this.levelDimClick(sx, sy);
    if (this.app.sketch && this.app.sketch.view === this) return this.app.sketch.click(this.toModel(sx, sy), e);
    if (this.app.tool !== "select" && this.kind === "PlanView") return this.toolClick(this.toModel(sx, sy), e);
    const hit = this.hitAt(sx, sy);
    if (this.kind === "Sheet") { this.app.select(hit ? [this.viewId + ":" + hit.id] : [], e.shiftKey, true); return; }
    if (pressed) { this.app.select([hit.id]); return; }
    this.app.select(hit ? [hit.id] : [], e.shiftKey || e.ctrlKey || e.metaKey);
  }
  /** Drag a selected element's body: a translation of its placement, snapped. */
  dragBody(d, sx, sy, e) {
    let p = this.toModel(sx, sy);
    const sn = this.snap(p, { exclude: d.body.ids[0], from: d.body.grab, shift: e.shiftKey });
    this.showSnap(sn);
    p = sn ? sn.point : this.quantise(p);
    const g = this.quantise(d.body.grab), dv = [p[0] - g[0], p[1] - g[1]];
    const done = d.body.done || [0, 0], step = [dv[0] - done[0], dv[1] - done[1]];
    if (step[0] || step[1]) {
      const r = this.app.apply({ op: "transform", ids: d.body.ids, move: step }, { quiet: true, coalesce: `move:${d.body.ids.join(",")}:${d.start.join(",")}` });
      if (r.ok) d.body.done = dv;
    }
    this.showHud(sx, sy, `move ${fmtLen(dv[0])}, ${fmtLen(dv[1])}${sn ? " · " + SNAP_SHORT[sn.kind] : ""}`);
  }
  /** Left→right: window (wholly inside). Right→left: crossing (any part inside). */
  finishBox(d, e) {
    this.box = null;
    const [a, b] = [d.start, this.evPos(e)];
    const A = this.toModel(Math.min(a[0], b[0]), Math.max(a[1], b[1])), B = this.toModel(Math.max(a[0], b[0]), Math.min(a[1], b[1]));
    const inside = p => p[0] >= A[0] && p[0] <= B[0] && p[1] >= A[1] && p[1] <= B[1];
    const crossing = b[0] < a[0];
    const ids = new Set();
    for (const ht of this.scene().hits) {
      if (!ht.id || !this.doc.element(ht.id)) continue;
      if (crossing ? ht.pts.some(inside) : ht.pts.every(inside)) ids.add(ht.id);
    }
    // a whole element must be inside for a window: drop ids that also have a hit outside
    if (!crossing) for (const ht of this.scene().hits) if (ids.has(ht.id) && !ht.pts.every(inside)) ids.delete(ht.id);
    this.app.select([...ids], e.shiftKey || e.ctrlKey);
    this.app.say(`${ids.size} selected (${crossing ? "crossing" : "window"} selection)`, "note");
    this.draw();
  }
  dbl(e) {
    const [sx, sy] = this.evPos(e);
    if (this.app.sketch) { if (this.app.sketch.view === this) this.app.sketch.enter(); return; }
    if (this.app.tool === "wall" && this.tool.pts.length >= 2) return this.finishWall(false);
    const hit = this.hitAt(sx, sy);
    if (!hit) return;
    // double-click is "step into": a viewport opens its view; anything else goes where it is edited
    if (this.kind === "Sheet") return this.app.openView(hit.view);
    this.app.stepInto(hit.id, this);
  }
  /** Viewports snap to the sheet's margins, the other viewports' edges and centres, with guides. */
  dragViewport(d, sx, sy) {
    const sh = this.view, [W, H] = sheetSize(sh);
    const dx = (sx - d.start[0]) / this.cam.z, dy = -(sy - d.start[1]) / this.cam.z;
    let at = [d.viewport.at[0] + dx, d.viewport.at[1] + dy];
    const half = [(d.viewport.bb[2] - d.viewport.bb[0]) / 2, (d.viewport.bb[3] - d.viewport.bb[1]) / 2];
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
  /** The splittable element under a model point: nearest of walls, beams, detail lines, separators. */
  splittableAt(p) {
    const [sx, sy] = this.toScreen(p), ok = new Set(["Wall", "Beam", "DetailLine", "RoomSeparator"]);
    const hit = this.hitsAt(sx, sy).find(x => { const f = this.doc.element(x.id); return f && ok.has(this.doc.typeOf(f)); });
    return hit ? hit.id : null;
  }
  toolHover(p, sx, sy, e) {
    const T = this.tool, tool = this.app.tool;
    if (MODIFY_TOOLS.has(tool)) return this.modifyHover(p, sx, sy, e);
    if (tool === "split") {
      const id = this.splittableAt(p), f = id && this.doc.element(id);
      const key = f && { Wall: "centreline", Beam: "axis", DetailLine: "curve", RoomSeparator: "line" }[this.doc.typeOf(f)], c = f && this.doc.argValue(f, key);
      T.cursor = null; this.hover = id;
      if (c && c.type === "line") { const d = normalise(sub(c.end, c.start)), t = Math.max(0, Math.min(dist(c.start, c.end), dot(sub(p, c.start), d))); T.cursor = add(c.start, mul(d, t)); this.showHud(sx, sy, `split ${id} at ${fmtLen(t)} · ${fmtLen(dist(c.start, c.end) - t)}`); }
      else if (c && c.type === "arc") { T.cursor = add(c.centre, mul(normalise(sub(p, c.centre)), c.radius)); this.showHud(sx, sy, `split ${id}`); }
      else this.showHud(sx, sy, id ? `${id} is not straight or an arc` : "hover a wall, beam or line");
      this.draw(); return;
    }
    const sn = this.snap(p, { from: T.pts[T.pts.length - 1], shift: e.shiftKey });
    this.showSnap(sn);
    const q = sn ? sn.point : this.quantise(p);
    T.cursor = tool === "grid" && T.pts.length === 1 && this.app.toolOpts.gridOrtho !== false ? orthoLine({ start: T.pts[0], end: q }).end : q; T.preview = null;
    if (["opening", "door", "window"].includes(tool)) {
      const hit = this.nearestWall(q);
      if (hit) { const o = this.app.toolOpts; const w = hit.w, u = uOf(w, q); const half = (o.width || 1000) / 2; T.preview = [pointAt(w, w.stack.s[0], u - half), pointAt(w, w.stack.s[0], u + half), pointAt(w, w.stack.s[w.stack.s.length - 1], u + half), pointAt(w, w.stack.s[w.stack.s.length - 1], u - half), pointAt(w, w.stack.s[0], u - half)]; this.showHud(sx, sy, `${hit.id} · u = ${fmtLen(u)}`); }
      else this.showHud(sx, sy, "hover a wall");
    } else if (T.pts.length) {
      const last = T.pts[T.pts.length - 1];
      this.showHud(sx, sy, this.hudInput ? this.hud.textContent : `${fmtLen(dist(last, q))} · ${Math.round(Math.atan2(q[1] - last[1], q[0] - last[0]) * 180 / Math.PI)}°`);
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
  finishFloor() {
    const T = this.tool, o = this.app.toolOpts, level = F.refId(this.view, "level");
    if (T.pts.length < 3) return this.app.say("a floor needs three points or more", "note");
    const boundary = T.pts.map(p => p.map(v => Math.round(v))); T.pts = [];
    const r = this.app.apply({ op: "add", element: { type: "Floor", args: { boundary, floorType: { ref: o.floorType }, level: level ? { ref: level } : null, heightOffset: o.floorOffset ?? 0 } } });
    this.app.say(r.ok ? `Floor ${r.id}: ${fmtArea(Math.abs(polyArea(boundary)))} m²` : r.error, r.ok ? "ok" : "error"); if (r.ok) this.app.select([r.id]);
  }
  toolClick(p, e) {
    const T = this.tool, tool = this.app.tool, o = this.app.toolOpts, doc = this.doc;
    if (MODIFY_TOOLS.has(tool)) return this.modifyClick();
    if (tool === "split") {
      // cut what is under the click, where it was clicked; the tool stays on for the next cut
      const hit = this.splittableAt(p); if (!hit) return this.app.say("click on a wall, beam, detail line or room separator", "note");
      const r = this.app.apply({ op: "split", id: hit, at: T.cursor || p }); if (r.ok) this.app.select(r.ids || []);
      return;
    }
    const q = T.cursor || p;
    const level = F.refId(this.view, "level");
    const addEl = (element, msg) => { const r = this.app.apply({ op: "add", element }); this.app.say(r.ok ? msg || `Added ${r.id}` : r.error, r.ok ? "ok" : "error"); if (r.ok) this.app.select([r.id]); return r; };
    if (tool === "wall") {
      // the wall tool draws with the sketcher's shapes; each shape becomes walls as soon as it is complete
      const shape = o.wallShape || "line";
      if (shape === "pick") return this.pickLineForWall(p);
      T.pts.push(q);
      const need = SHAPE_CLICKS[shape];
      if (need && T.pts.length >= need) return this.finishWall(false);
      if ((shape === "line" || shape === "spline" || shape === "bspline") && T.pts.length > 2 && dist(q, T.pts[0]) < 1) { T.pts.pop(); return this.finishWall(true); }
      if (shape === "line" && T.pts.length >= 2 && o.closeOnStart && dist(q, T.pts[0]) < 1) return this.finishWall(true);
      this.draw(); return;
    }
    if (tool === "floor") {
      // click the boundary; clicking the first point again (or Enter) closes it
      if (T.pts.length >= 3 && dist(q, T.pts[0]) < 12 * this.modelPerPx()) return this.finishFloor();
      T.pts.push(q); this.draw(); return;
    }
    if (tool === "beam") {
      T.pts.push(q); if (T.pts.length < 2) { this.draw(); return; }
      const [a, b] = T.pts; T.pts = [];
      return addEl({ type: "Beam", args: { axis: { type: "line", start: a, end: b }, beamType: { ref: o.beamType }, level: level ? { ref: level } : null, topOffset: o.beamTop ?? 3000 } }, `Beam ${fmtLen(dist(a, b))}`);
    }
    if (["grid", "elev", "sep", "section"].includes(tool)) {
      // a grid drawn with Orthogonal on (the default) runs straight across or straight up
      const q2 = tool === "grid" && T.pts.length === 1 && o.gridOrtho !== false ? orthoLine({ start: T.pts[0], end: q }).end : q;
      T.pts.push(q2);
      if (T.pts.length < 2) { this.draw(); return; }
      const [a, b] = T.pts; T.pts = [];
      if (tool === "grid") { const used = new Set(doc.elements().filter(f => doc.typeOf(f) === "Grid").map(f => F.text(f, "name"))); let n = 1; while (used.has(String(n))) n++; addEl({ type: "Grid", name: "Grid " + n, args: { name: String(n), line: { type: "line", start: a, end: b } } }); }
      if (tool === "elev") addEl({ type: "ElevationView", name: "Elevation " + (doc.elements().filter(f => doc.typeOf(f) === "ElevationView").length + 1), args: { line: { type: "line", start: a, end: b }, depth: 15000, scale: 100, baseLevel: level ? { ref: level } : null, top: 6000, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Coarse" } }, "Elevation added — its marker is its view line; drag it and the view follows");
      if (tool === "section") addEl({ type: "SectionView", name: "Section " + (doc.elements().filter(f => doc.typeOf(f) === "SectionView").length + 1), args: { line: { type: "line", start: a, end: b }, depth: 15000, scale: 50, baseLevel: level ? { ref: level } : null, top: 7000, style: { ref: "VS-CONSTRUCTION" }, detailLevel: "Fine" } }, "Section added: double-click its head to open it");
      if (tool === "sep") addEl({ type: "RoomSeparator", args: { line: { type: "line", start: a, end: b }, level: level ? { ref: level } : null } });
      return;
    }
    if (["opening", "door", "window"].includes(tool)) {
      const hit = this.nearestWall(q); if (!hit) { this.app.say("click on a wall", "note"); return; }
      const u = Math.round(uOf(hit.w, q));
      const r = this.app.placeOpening(tool, hit.id, u);
      if (r.ok && r.id) this.app.select([r.id]);
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
  // ---------------------------------------------------------------- Move · Copy · Rotate · Mirror
  selectionIds() { return [...this.app.selection].filter(id => this.doc.element(id)); }
  selectionCentre() {
    const pts = this.scene().hits.filter(ht => this.app.selection.has(ht.id)).flatMap(ht => ht.pts);
    if (!pts.length) return null; const bb = bboxOf(pts); return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
  }
  modifyOp(tool, T, target) {
    const ids = this.selectionIds(), o = this.app.toolOpts;
    if (tool === "move" || tool === "copy") return { op: "transform", ids, move: sub(target, T.pts[0]), copy: tool === "copy" || !!o.moveCopy };
    if (tool === "rotate") { const c = T.centre, a = Math.atan2(target[1] - c[1], target[0] - c[0]) - Math.atan2(T.pts[0][1] - c[1], T.pts[0][0] - c[0]); return { op: "transform", ids, rotate: { c, a }, copy: !!o.rotateCopy }; }
    if (tool === "mirror") return { op: "transform", ids, mirror: { p: T.pts[0], d: sub(target, T.pts[0]) }, copy: o.mirrorCopy !== false };
  }
  modifyHover(p, sx, sy, e) {
    const T = this.tool, tool = this.app.tool;
    if (!this.selectionIds().length) { this.showHud(sx, sy, "select elements first, then " + tool); return; }
    if (tool === "rotate" && !T.centre) T.centre = this.selectionCentre();
    const from = tool === "rotate" ? T.centre : T.pts[0];
    const sn = this.snap(p, { from, shift: e.shiftKey });
    this.showSnap(sn);
    const q = sn ? sn.point : this.quantise(p);
    T.cursor = q;
    // preview: the selection's outline where the edit would put it
    T.ghost = null;
    if (T.pts.length) {
      const op = this.modifyOp(tool, T, q), ghost = [];
      const P = op.move ? (x => add(x, op.move)) : op.rotate ? (x => { const c = op.rotate.c, cs = Math.cos(op.rotate.a), s_ = Math.sin(op.rotate.a), v = sub(x, c); return [c[0] + v[0] * cs - v[1] * s_, c[1] + v[0] * s_ + v[1] * cs]; })
        : (x => { const u = normalise(op.mirror.d), v = sub(x, op.mirror.p), t = dot(v, u); return add(op.mirror.p, sub(mul(u, 2 * t), v)); });
      for (const ht of this.scene().hits) if (this.app.selection.has(ht.id)) ghost.push(ht.pts.map(P));
      T.ghost = ghost;
      const text = op.move ? `${fmtLen(Math.hypot(...op.move))}` : op.rotate ? `${Math.round(op.rotate.a * 1800 / Math.PI) / 10}°` : "mirror axis";
      this.showHud(sx, sy, this.hudInput ? this.hud.textContent : text);
    } else this.showHud(sx, sy, tool === "rotate" ? "click the start of the angle" : tool === "mirror" ? "click the first point of the axis" : "click the base point");
    this.draw();
  }
  modifyClick() {
    const T = this.tool, tool = this.app.tool;
    if (!this.selectionIds().length) { this.app.say(`Select what to ${tool} first — box-select or click — then ${tool.toUpperCase()}`, "note"); return; }
    if (!T.cursor) return;
    if (!T.pts.length) { T.pts.push(T.cursor); this.draw(); return; }
    this.commitModify(T.cursor);
  }
  commitModify(target) {
    const T = this.tool, tool = this.app.tool, op = this.modifyOp(tool, T, target), key = `modify:${Date.now()}`;
    const r = this.app.apply(op, { coalesce: key });
    if (r.ok) { const ends = wallEnds(this.doc, r.copied || r.moved || []); if (ends.length) this.app.apply({ op: "autojoin", ends }, { quiet: true, coalesce: key }); this.app.editor.seal(); }
    T.pts = []; T.ghost = null; T.centre = null; this.hideHud();
    if (r.ok) { this.app.say(`${tool === "copy" || op.copy ? "Copied" : tool[0].toUpperCase() + tool.slice(1) + "d"} ${(r.copied || r.moved || []).length} element(s)`, "ok"); if (r.copied) this.app.select(r.copied); }
    this.app.setTool("select");
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
    const T = this.tool, o = this.app.toolOpts, shape = o.wallShape || "line";
    const pts = T.pts.slice(); T.pts = []; T.cursor = null;
    if (pts.length < 2) return;
    // a plain chain of lines keeps the chain-draw op (its joins are exact); every other shape, and a
    // chain with an offset or rounded corners, goes through the sketcher and then becomes walls
    if (shape !== "line" || o.wallRadiusOn || o.wallOffset) return this.wallsFromShape(shape, pts, closed);
    const r = this.app.apply({ op: "draw", points: pts, closed, wallType: o.wallType, level: F.refId(this.view, "level"), height: o.height || 3000, mounting: o.mounting || "Centred", tol: 1 });
    this.app.say(r.ok ? `${r.ids.length} wall${r.ids.length > 1 ? "s" : ""} drawn and joined` : r.error, r.ok ? "ok" : "error");
    if (r.ok) this.app.select(r.ids);
  }
  /** The sketcher's elements for a finished shape - rounded at the corners and offset as the options
   *  bar says - each become a wall, and their ends are joined as walls join. */
  wallsFromShape(shape, pts, closed) {
    const o = this.app.toolOpts, level = F.refId(this.view, "level");
    let d = weld({ elements: shapeFromClicks(shape, pts, { sides: o.wallSides || 6, closed }), constraints: [], dims: [] });
    if (o.wallRadiusOn && (o.wallRadius || 0) > 0) d = filletCorners(d, o.wallRadius);
    if (o.wallOffset) {
      // positive to the left of the way it was drawn, negative to the right
      const first = d.elements[0], pts2 = outline(first, 16), mid = pts2[Math.floor(pts2.length / 2)], nx = pts2[Math.min(pts2.length - 1, Math.floor(pts2.length / 2) + 1)];
      const dir = normalise(sub(nx, mid)), toward = add(mid, mul(perp(dir), Math.sign(o.wallOffset) * 10));
      d = offsetChain(d, first.id, toward, Math.abs(o.wallOffset), false).drawing;
    }
    const ops = [], ids = [];
    for (const el of d.elements) {
      const c = toCentreline(el); if (!c) continue;
      let k = 1; while (this.doc.element("W" + k) || ids.includes("W" + k)) k++; const id = "W" + k;
      ops.push({ op: "add", element: { id, type: "Wall", args: { centreline: c, mounting: o.mounting || "Centred", wallType: { ref: o.wallType }, baseLevel: level ? { ref: level } : null, height: o.height || 3000 } } }); ids.push(id);
    }
    if (!ops.length) return;
    const ends = [];
    for (const [i, el] of d.elements.entries()) if (el.type === "line" || el.type === "arc" || (el.type === "spline" && !el.closed) || el.type === "bspline") ends.push({ id: ids[i], end: "start" }, { id: ids[i], end: "end" });
    const r = this.app.apply(ends.length ? ops.concat([{ op: "autojoin", ends }]) : ops);
    this.app.say(r.ok ? `${ids.length} wall${ids.length > 1 ? "s" : ""} from the ${{ line: "chain", rect: "rectangle", polygon: "polygon", arc: "arc", circle: "circle", ellipse: "ellipse", spline: "spline", bspline: "spline" }[shape]}${o.wallRadiusOn ? `, corners R ${fmtLen(o.wallRadius)}` : ""}${o.wallOffset ? `, offset ${fmtLen(o.wallOffset)}` : ""}` : r.error, r.ok ? "ok" : "error");
    if (r.ok) this.app.select(ids);
  }
  /** Revit's Pick Lines for walls: a wall on a grid, a detail line, a room separator, a floor's edge
   *  or another wall's face - whichever straight line is nearest the click. */
  pickLineForWall(p) {
    const doc = this.doc, tol = 10 * this.modelPerPx(), cands = [];
    const seg = (a, b, what) => { const t = Math.max(0, Math.min(1, dot(sub(p, a), sub(b, a)) / Math.max(1e-9, dot(sub(b, a), sub(b, a))))), q = add(a, mul(sub(b, a), t)); cands.push({ a, b, what, d: dist(p, q) }); };
    for (const f of doc.elements()) {
      const t = doc.typeOf(f), id = doc.idOf(f);
      if (t === "Grid" || t === "RoomSeparator") { const c = F.json(f, "line"); seg(c.start, c.end, `${t === "Grid" ? "grid" : "separator"} ${F.text(f, "name") || id}`); }
      if (t === "DetailLine") { const c = F.json(f, "curve"); if (c && c.type === "line" && F.refId(f, "view") === this.viewId) seg(c.start, c.end, `detail line ${id}`); }
      if (t === "Floor") { const b = F.json(f, "boundary") || []; b.forEach((q, i) => seg(q, b[(i + 1) % b.length], `${id}'s edge`)); }
      if (t === "Wall") { const w = doc.plan(f); if (w && w.curve.type === "line") for (const s_ of [Math.max(...w.stack.s), Math.min(...w.stack.s)]) seg(add(w.curve.start, mul(perp(w.d), s_)), add(w.curve.end, mul(perp(w.d), s_)), `${id}'s face`); }
    }
    const best = cands.filter(c => c.d < tol).sort((x, y) => x.d - y.d)[0];
    if (!best) return this.app.say("Pick Lines: click a grid, a detail line, a room separator, a floor edge or a wall face", "note");
    const o = this.app.toolOpts, keep = o.wallShape; o.wallShape = "line";
    this.wallsFromShape("line", [best.a, best.b], false); o.wallShape = keep;
    this.app.say(`wall on ${best.what}`, "ok");
  }
  /** Keys while this view has focus: Enter/Esc/C for the chain, digits for length. */
  key(e) {
    if (this.app.sketch) return false;       // sketch mode's keys are the window's (it holds the session)
    const T = this.tool, tool = this.app.tool;
    if (MODIFY_TOOLS.has(tool) && T.pts.length && (typeKey(e.key, this.typed) || e.key === "Backspace" || (e.key === "Enter" && this.typed))) {
      if (e.key === "Enter") {
        const n = tool === "rotate" ? readAngle(this.typed, this.app) : readLen(this.typed, this.app); this.typed = ""; this.hudInput = null; if (n === null) return true;
        if (tool === "rotate") { const c = T.centre, a0 = Math.atan2(T.pts[0][1] - c[1], T.pts[0][0] - c[0]) + n * Math.PI / 180; this.commitModify(add(c, [Math.cos(a0) * 1000, Math.sin(a0) * 1000])); }
        else { const dir = normalise(sub(T.cursor || add(T.pts[0], [1, 0]), T.pts[0])); this.commitModify(add(T.pts[0], mul(dir, n))); }
        return true;
      }
      this.typed = e.key === "Backspace" ? (this.typed || "").slice(0, -1) : (this.typed || "") + e.key;
      this.hudInput = true; this.hud.hidden = false; this.hud.textContent = `${tool === "rotate" ? "angle" : "distance"} ${this.typed} ${tool === "rotate" ? "°" : ""} ⏎`;
      return true;
    }
    if (e.key === "Escape") { if (T.pts.length || T.refs || T.ghost) { T.pts = []; T.refs = []; T.ghost = null; T.centre = null; this.hideHud(); this.draw(); return true; } return false; }
    if (tool === "floor" && T.pts.length && e.key === "Enter") { this.finishFloor(); return true; }
    if (tool === "wall" && T.pts.length) {
      if (e.key === "Enter" && !this.typed) { this.finishWall(false); return true; }
      if (e.key.toLowerCase() === "c" && T.pts.length >= 3) { this.finishWall(true); return true; }
      if ((typeKey(e.key, this.typed) && (e.key !== "-" || this.typed)) || (e.key === "Backspace" && this.typed) || (e.key === "Enter" && this.typed)) {
        if (e.key === "Enter") {
          // walls are drawn by typing dimensions: the length along the current direction
          const last = T.pts[T.pts.length - 1], dir = normalise(sub(T.cursor || add(last, [1, 0]), last)), n = readLen(this.typed, this.app) || 0;
          if (n > 0) T.pts.push(add(last, mul(dir, n)));
          this.typed = ""; this.hudInput = null; this.draw(); return true;
        }
        this.typed = e.key === "Backspace" ? this.typed.slice(0, -1) : (this.typed || "") + e.key;
        this.hudInput = true; this.hud.hidden = false; this.hud.textContent = `length ${this.typed} ⏎`;
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


/** Keys that belong to a typed value: digits and maths, feet and inch marks; letters (units: m, cm,
 *  ft...) once a value has begun, so a bare letter is still a shortcut. */
function typeKey(k, typed) { return /^[0-9.\-'"\/]$/.test(k) || (!!typed && /^[a-z+*()]$/i.test(k)); }
/** What typed text is worth as a length, in mm (any unit, any maths), or null having said why. */
function readLen(text, app) { try { return parseLength(text, { lookup: n => { const f = app.doc.element(n); const d = f && app.doc.data(f); return d && d.kind ? { kind: d.kind, v: d.value } : undefined; } }); } catch (e) { app.say(`${String(text).trim()}: ${e.message}`, "error"); return null; } }
function readAngle(text, app) { try { return parseAngle(text); } catch (e) { app.say(`${String(text).trim()}: ${e.message}`, "error"); return null; } }
