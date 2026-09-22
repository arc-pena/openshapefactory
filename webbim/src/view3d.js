//! The 3D view: for coordination and for looking (§10.1 — minimal handles here
//! is a decision). One scene group per element, refreshed by revision; the
//! solids are the same convex pieces the hidden-line pass uses, so what you
//! orbit is what goes on the sheet. "Generate for sheet" runs HLR in slices
//! with a progress bar and caches it on (camera, model revision).

import { h, clear } from "./ui_util.js";
import { buildHLRModel, hlrSteps, cameraBasis } from "./hlr.js";
import { F } from "./ocaf.js";
import { rasterPixels } from "./acceptance.js";
import { categoryOf } from "./styles.js";

export class View3D {
  constructor(app, root, viewId) {
    this.app = app; this.root = root; this.viewId = viewId;
    this.wrap = h("div", { class: "three" });
    root.append(this.wrap);
    this.status = h("div", { class: "viewbar" });
    root.append(this.status);
    const T = window.THREE;
    if (!T) { this.wrap.append(h("div", { class: "empty" }, h("h3", {}, "3D needs three.js"), "The renderer could not be loaded from cdnjs in this view. Hidden-line line-work for sheets still works: use Generate below.")); this.bar(); return; }
    this.T = T;
    this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.wrap.append(this.renderer.domElement);
    this.scene = new T.Scene(); this.scene.background = new T.Color(0xf4f5f7);
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6);
    this.scene.add(new T.AmbientLight(0xffffff, 0.55));
    const key = new T.DirectionalLight(0xffffff, 0.75); key.position.set(-0.6, -0.8, 1.2); this.scene.add(key);
    const fill = new T.DirectionalLight(0xffffff, 0.3); fill.position.set(0.8, 0.4, 0.5); this.scene.add(fill);
    this.groups = new Map();
    this.cam = Object.assign({}, F.json(app.doc.element(viewId), "camera"));
    this.zoom = 1;
    this.bindOrbit();
    new ResizeObserver(() => this.resize()).observe(root);
    this.resize(); this.refresh(); this.bar();
  }
  get doc() { return this.app.doc; }
  resize() { if (!this.renderer) return; const r = this.root.getBoundingClientRect(); this.W = r.width; this.H = r.height; this.renderer.setSize(r.width, r.height); this.render(); }
  /** Rebuild only groups whose element revision moved (refresh by revision). */
  refresh() {
    if (!this.T) return;
    const T = this.T, doc = this.doc;
    const model = buildHLRModel(doc);
    // group solids by element: rebuild from the model — cheap at this size; the revision
    // check below keeps materials and geometry from churning when nothing changed.
    const rev = doc.modelRevision;
    if (this.builtRev === rev) { this.render(); return; }
    this.builtRev = rev;
    for (const g of this.groups.values()) { this.scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); }); }
    this.groups.clear();
    const perElement = new Map();
    for (const f of doc.elements()) {
      if (f.get("Integer") === 0 || doc.error(f)) continue;
      const t = doc.typeOf(f), p = doc.plan(f);
      if (!p || (t !== "Wall" && t !== "Column")) continue;
      const colour = t === "Wall" ? shadeOf(doc, p) : ((doc.lib.materials[p.material] || {}).shading || {}).colour || "#aaaaaa";
      const g = new T.Group(); g.userData.id = doc.idOf(f);
      const pos = [];
      const solids = t === "Wall" ? buildHLRModel({ elements: () => [f], typeOf: () => "Wall", plan: () => p, error: () => null }).solids : buildHLRModel({ elements: () => [f], typeOf: () => "Column", plan: () => p, error: () => null }).solids;
      for (const s of solids) for (const fc of s.faces) for (let i = 1; i < fc.poly.length - 1; i++) pos.push(...fc.poly[0], ...fc.poly[i], ...fc.poly[i + 1]);
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
      const mat = new T.MeshLambertMaterial({ color: new T.Color(colour), side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      g.add(new T.Mesh(geo, mat));
      perElement.set(doc.idOf(f), g); this.scene.add(g);
    }
    // edges from the construction (not EdgesGeometry): one LineSegments for everything
    const ep = []; for (const e of model.edges) if (e.kind === "sharp") ep.push(...e.a, ...e.b);
    const eg = new T.BufferGeometry(); eg.setAttribute("position", new T.Float32BufferAttribute(ep, 3));
    const lines = new T.LineSegments(eg, new T.LineBasicMaterial({ color: 0x1b2230 })); const lg = new T.Group(); lg.add(lines);
    perElement.set("__edges", lg); this.scene.add(lg);
    this.groups = perElement;
    this.render();
  }
  render() {
    if (!this.renderer || !this.W) return;
    const B = cameraBasis(this.cam), T = this.T;
    const t = new T.Vector3(...this.cam.target), D = new T.Vector3(...B.D);
    this.camera.position.copy(t.clone().add(D.clone().multiplyScalar(60000)));
    this.camera.up.set(...B.up); this.camera.lookAt(t);
    const span = 22000 / this.zoom, asp = this.W / this.H;
    Object.assign(this.camera, { left: -span * asp / 2, right: span * asp / 2, top: span / 2, bottom: -span / 2, near: -1e6, far: 1e6 });
    this.camera.updateProjectionMatrix();
    for (const [id, g] of this.groups) g.children.forEach(o => { if (o.material && o.material.emissive) o.material.emissive.set(this.app.selection.has(id) ? 0x1d4f9c : 0x000000); });
    this.renderer.render(this.scene, this.camera);
  }
  bindOrbit() {
    const el = this.renderer.domElement; let d = null;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", e => { el.setPointerCapture(e.pointerId); d = { x: e.clientX, y: e.clientY, cam: JSON.parse(JSON.stringify(this.cam)), pan: e.shiftKey || e.button === 1 || e.button === 2 }; });
    el.addEventListener("pointermove", e => {
      if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (d.pan) { const B = cameraBasis(d.cam), k = 22000 / this.zoom / this.H; this.cam.target = d.cam.target.map((v, i) => v - B.right[i] * dx * k + B.up[i] * dy * k); }
      else { this.cam.azimuth = d.cam.azimuth - dx * 0.4; this.cam.elevation = Math.max(-5, Math.min(89, d.cam.elevation + dy * 0.3)); }
      this.render();
    });
    el.addEventListener("pointerup", () => { d = null; });
    el.addEventListener("contextmenu", e => e.preventDefault());
    el.addEventListener("wheel", e => { e.preventDefault(); this.zoom *= Math.exp(-e.deltaY * 0.0015); this.render(); }, { passive: false });
  }
  bar() {
    clear(this.status);
    const doc = this.doc, v = doc.element(this.viewId);
    const cache = doc._hlrCache && doc._hlrCache[this.viewId];
    const stale = cache && (cache.revision !== doc.modelRevision || cache.camera !== JSON.stringify(doc.argValue(v, "camera")));
    const prog = h("div", { class: "progress", hidden: true }, h("i"));
    this.status.append(h("div", { class: "card" },
      h("span", { class: "muted" }, "drag orbits · shift-drag pans · wheel zooms"),
      this.T ? h("button", { class: "btn small", onclick: () => { this.app.apply({ op: "set", id: this.viewId, key: "camera", value: roundCam(this.cam) }); this.bar(); this.app.say("Camera saved to the view", "ok"); } }, "Save camera to view") : null,
      h("button", { class: "btn small primary", onclick: () => this.generate(prog) }, cache ? "Regenerate hidden-line" : "Generate hidden-line for sheet"),
      prog,
      cache ? h("span", { class: "chip", style: stale ? { background: "var(--error-bg)", color: "var(--error)" } : {} }, stale ? "sheet line-work stale" : `current · ${cache.counts.visible + cache.counts.outlineV} visible edges`) : null));
  }
  /** Exact HLR in slices — minutes with a progress bar is a feature (§6.4). */
  async generate(prog) {
    const doc = this.doc, v = doc.element(this.viewId);
    if (this.T) this.app.apply({ op: "set", id: this.viewId, key: "camera", value: roundCam(this.cam) });
    const cam = F.json(v, "camera");
    // Feed it the smallest correct model: visible categories only.
    const model = buildHLRModel(doc);
    prog.hidden = false; const bar = prog.firstChild;
    const it = hlrSteps(model, cam); let r;
    const t0 = performance.now();
    for (;;) { r = it.next(); if (r.done) break; bar.style.width = (100 * r.value.done / r.value.total) + "%"; if (performance.now() - t0 > 12) { await new Promise(res => setTimeout(res, 0)); } }
    const out = r.value;
    const entry = { camera: JSON.stringify(cam), revision: doc.modelRevision, lines: out.lines, bbox: out.bbox, counts: out.counts };
    // linesOverShaded: raster at the viewport's paper size and print resolution, not the screen's
    const render = F.json(v, "render") || {};
    if (render.mode === "linesOverShaded" && this.renderer) {
      const S = F.int(v, "scale") || 200, wmm = (out.bbox[2] - out.bbox[0]) / S, hmm = (out.bbox[3] - out.bbox[1]) / S;
      const pxW = rasterPixels(wmm, render.rasterDPI || 300), pxH = rasterPixels(hmm, render.rasterDPI || 300);
      entry.raster = this.snapshot(pxW, pxH, cam, out.bbox); entry.rasterDPI = render.rasterDPI || 300; entry.rasterPx = [pxW, pxH];
    }
    doc._hlrCache = Object.assign({}, doc._hlrCache, { [this.viewId]: entry });
    doc.bumpView();
    prog.hidden = true;
    this.app.say(`Hidden-line: ${out.edges} edges against ${out.faces} faces in ${Math.round(performance.now() - t0)} ms — ${JSON.stringify(out.counts)}`, "ok");
    this.bar(); this.app.refresh();
  }
  snapshot(pxW, pxH, cam, bbox) {
    const T = this.T, B = cameraBasis(cam), r = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(pxW, pxH);
    const c = new T.OrthographicCamera(bbox[0], bbox[2], bbox[3], bbox[1], -1e6, 1e6);
    const t = new T.Vector3(...cam.target); c.position.copy(t.clone().add(new T.Vector3(...B.D).multiplyScalar(60000))); c.up.set(...B.up); c.lookAt(t);
    const bg = this.scene.background; this.scene.background = new T.Color(0xffffff);
    const edges = this.groups.get("__edges"); if (edges) edges.visible = false;
    r.render(this.scene, c);
    const url = r.domElement.toDataURL("image/jpeg", 0.9);
    this.scene.background = bg; if (edges) edges.visible = true; r.dispose();
    return url;
  }
}
function shadeOf(doc, w) { const core = w.stack.layers.find(l => l.function === "Structure") || w.stack.layers[0]; const m = doc.lib.materials[w.stack.layers[0].material] || doc.lib.materials[core.material] || {}; return (m.shading || {}).colour || "#bbbbbb"; }
const roundCam = c => ({ azimuth: Math.round(c.azimuth * 10) / 10, elevation: Math.round(c.elevation * 10) / 10, target: c.target.map(v => Math.round(v)) });
