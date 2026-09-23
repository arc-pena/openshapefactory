//! The 3D view. You can work in it, not just look: click selects (the same
//! selection the plan and the Properties palette use); grips on a selected
//! wall drag its ends and its height and move it; the wall, door, window,
//! opening and column tools place things on the level plane or on the wall
//! you click. Every gesture computes a value and sends an ordinary edit (§10.1).
//! The ViewCube sits top-right; "Generate for sheet" runs hidden-line in slices.

import { h, clear, icon } from "./ui_util.js";
import { buildHLRModel, hlrSteps, cameraBasis } from "./hlr.js";
import { F } from "./ocaf.js";
import { add, sub, mul, dot, dist, normalise, lerp } from "./geom2d.js";
import { rasterPixels } from "./acceptance.js";
import { uOf, pointAt } from "./walls.js";
import { ViewCube } from "./viewcube.js";

export const VISUAL_STYLES = ["Wireframe", "Hidden Line", "Shaded", "Consistent Colors"];
const GRIP_PX = 9;

/** Sheet line-work for a 3D view, computed off screen from its saved camera:
 *  the hidden-line pass export and sheets need, with nobody asking for it. */
export async function hiddenLineFor(app, viewId, onProgress) {
  const root = h("div", { style: { position: "fixed", left: "-10000px", top: "0", width: "800px", height: "600px" }, "aria-hidden": "true" });
  document.body.append(root);
  const zoom = Object.assign({}, app.zoom3d); // the off-screen view must not reset the on-screen one's zoom
  const v = new View3D(app, root, viewId);
  try { return await v.generate(onProgress, { keepCamera: true }); }
  finally { v.dispose(); root.remove(); app.zoom3d = zoom; }
}
/** A height bound to "A.elevation - B.elevation" between two levels is driven by level A. */
function levelDriver(doc, exprId) {
  const ex = doc.element(exprId); if (!ex || doc.typeOf(ex) !== "Expression") return null;
  const m = /^\s*([\w-]+)\.elevation\s*-\s*([\w-]+)\.elevation\s*$/.exec(F.text(ex, "formula") || ""); if (!m) return null;
  const a = doc.element(m[1]), b = doc.element(m[2]);
  if (!a || !b || doc.typeOf(a) !== "Level" || doc.typeOf(b) !== "Level") return null;
  return { level: m[1], baseZ: F.real(b, "elevation") };
}
export class View3D {
  constructor(app, root, viewId) {
    this.app = app; this.root = root; this.viewId = viewId;
    this.wrap = h("div", { class: "three" });
    this.hud = h("div", { class: "hud", hidden: true });
    root.append(this.wrap, this.hud);
    const T = window.THREE;
    this.tool = { pts: [] };
    if (!T) { this.wrap.append(h("div", { class: "empty" }, h("h3", {}, "3D needs three.js"), "The renderer could not be loaded in this view. Sheet line-work (hidden-line) still works from the view control bar.")); return; }
    this.T = T;
    this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.wrap.append(this.renderer.domElement);
    this.scene = new T.Scene();
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6);
    this.scene.add(new T.AmbientLight(0xffffff, 0.58));
    const key = new T.DirectionalLight(0xffffff, 0.72); key.position.set(-0.6, -0.8, 1.2); this.scene.add(key);
    const fill = new T.DirectionalLight(0xffffff, 0.28); fill.position.set(0.8, 0.4, 0.5); this.scene.add(fill);
    this.overlayScene = new T.Scene();         // grips and rubber bands, drawn over everything
    this.meshes = []; this.groups = new Map();
    this.cam = Object.assign({ azimuth: 225, elevation: 30, target: [6000, 4000, 1500] }, F.json(app.doc.element(viewId), "camera"));
    this.zoom = app.zoom3d && app.zoom3d[viewId] || 1;
    this.cube = new ViewCube(root, {
      onTurn: c => this.turnTo(c.azimuth, c.keepElevation ? this.cam.elevation : c.elevation),
      onHome: () => { const c = F.json(this.doc.element(this.viewId), "camera"); this.turnTo(c.azimuth, c.elevation, c.target); },
      onOrbit: (dx, dy) => { this.cam.azimuth -= dx * 0.6; this.cam.elevation = Math.max(-89, Math.min(89, this.cam.elevation + dy * 0.45)); this.render(); },
    });
    root.append(h("div", { class: "navbar" },
      h("button", { title: "Zoom to fit (ZF)", "aria-label": "Zoom to fit", onclick: () => this.fit() }, icon("fit")),
      h("button", { title: "Zoom in", "aria-label": "Zoom in", onclick: () => { this.zoom *= 1.25; this.render(); } }, "+"),
      h("button", { title: "Zoom out", "aria-label": "Zoom out", onclick: () => { this.zoom /= 1.25; this.render(); } }, "−")));
    this.ray = new T.Raycaster();
    this.bind();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(root);
    this.resize(); this.refresh();
    if (!app.zoom3d || !app.zoom3d[viewId]) this.fit();
  }
  get doc() { return this.app.doc; }
  get style() { return this.app.visualStyle3d[this.viewId] || "Shaded"; }
  resize() { if (!this.renderer) return; const r = this.root.getBoundingClientRect(); this.W = r.width; this.H = r.height; this.renderer.setSize(r.width, r.height); this.render(); }

  // ---------------------------------------------------------------- model → scene (one group per element)
  refresh() {
    if (!this.T) return;
    const T = this.T, doc = this.doc, style = this.style;
    const key = doc.modelRevision + "|" + style;
    if (this.builtKey === key) { this.render(); return; }
    this.builtKey = key;
    for (const g of this.groups.values()) { this.scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); }); }
    this.groups.clear(); this.meshes = [];
    const one = (f, p, t) => buildHLRModel({ elements: () => [f], typeOf: () => t, plan: () => p, error: () => null });
    for (const f of doc.elements()) {
      if (f.get("Integer") === 0 || doc.error(f)) continue;
      const t = doc.typeOf(f), p = doc.plan(f);
      if (!p || (t !== "Wall" && t !== "Column")) continue;
      const id = doc.idOf(f);
      const m = one(f, p, t);
      const colour = style === "Hidden Line" ? "#ffffff" : style === "Consistent Colors" ? flat(doc, t, p) : shade(doc, t, p);
      const g = new T.Group(); g.userData.id = id;
      const pos = [];
      for (const s of m.solids) for (const fc of s.faces) for (let i = 1; i < fc.poly.length - 1; i++) pos.push(...fc.poly[0], ...fc.poly[i], ...fc.poly[i + 1]);
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
      const mat = style === "Consistent Colors" || style === "Hidden Line" ? new T.MeshBasicMaterial({ color: new T.Color(colour), side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
        : new T.MeshLambertMaterial({ color: new T.Color(colour), side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      if (style === "Wireframe") { mat.transparent = true; mat.opacity = 0.06; mat.depthWrite = false; }
      const mesh = new T.Mesh(geo, mat); mesh.userData.id = id; g.add(mesh); this.meshes.push(mesh);
      // edges from the construction, not EdgesGeometry
      const ep = []; for (const e of m.edges) if (e.kind === "sharp") ep.push(...e.a, ...e.b);
      const eg = new T.BufferGeometry(); eg.setAttribute("position", new T.Float32BufferAttribute(ep, 3));
      const line = new T.LineSegments(eg, new T.LineBasicMaterial({ color: 0x1b2230 })); line.userData.edges = true; g.add(line);
      this.groups.set(id, g); this.scene.add(g);
    }
    this.render();
  }
  basis() { return cameraBasis(this.cam); }
  span() { return 22000 / this.zoom; }
  render() {
    if (!this.renderer || !this.W) return;
    const T = this.T, B = this.basis();
    this.scene.background = new T.Color(this.style === "Hidden Line" || this.style === "Wireframe" ? 0xffffff : 0xf3f5f8);
    const t = new T.Vector3(...this.cam.target), D = new T.Vector3(...B.D);
    this.camera.position.copy(t.clone().add(D.multiplyScalar(60000)));
    this.camera.up.set(...B.up); this.camera.lookAt(t);
    const span = this.span(), asp = this.W / this.H;
    Object.assign(this.camera, { left: -span * asp / 2, right: span * asp / 2, top: span / 2, bottom: -span / 2 });
    this.camera.updateProjectionMatrix();
    for (const [id, g] of this.groups) {
      const sel = this.app.selection.has(id), hov = this.hoverId === id;
      for (const o of g.children) {
        if (o.userData.edges) o.material.color.set(sel ? 0x1d6fd8 : 0x1b2230);
        else if (o.material.emissive) o.material.emissive.set(sel ? 0x1d4f9c : hov ? 0x223a5c : 0x000000);
        else o.material.color.set(sel ? 0x9cc3f5 : hov ? 0xdbe8fa : new T.Color(this.style === "Hidden Line" ? "#ffffff" : flat(this.doc, this.doc.typeOf(this.doc.element(id)), this.doc.plan(this.doc.element(id)))));
      }
    }
    this.buildOverlay();
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false; this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, this.camera);
    if (this.cube) this.cube.sync(B);
    this.app.zoom3d = Object.assign(this.app.zoom3d || {}, { [this.viewId]: this.zoom });
  }
  fit() {
    const pts = [];
    for (const g of this.groups.values()) g.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push([x, y, z]); } });
    if (!pts.length) { this.render(); return; }
    const c = [0, 1, 2].map(i => (Math.min(...pts.map(p => p[i])) + Math.max(...pts.map(p => p[i]))) / 2);
    this.cam.target = c;
    const B = this.basis();
    const xs = pts.map(p => vdot3(v3sub3(p, c), B.right)), ys = pts.map(p => vdot3(v3sub3(p, c), B.up));
    const need = Math.max((Math.max(...ys) - Math.min(...ys)) * 1.15, (Math.max(...xs) - Math.min(...xs)) * 1.15 / (this.W / this.H || 1));
    this.zoom = 22000 / Math.max(need, 1000);
    this.render();
  }
  /** Turn to a direction with a short animation — the ViewCube's job. */
  turnTo(az, el, target) {
    const a0 = this.cam.azimuth, e0 = this.cam.elevation, t0 = this.cam.target.slice();
    let da = ((az - a0) % 360 + 540) % 360 - 180;
    const start = performance.now(), dur = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320;
    const step = now => {
      const k = dur ? Math.min(1, (now - start) / dur) : 1, s = k * k * (3 - 2 * k);
      this.cam.azimuth = a0 + da * s; this.cam.elevation = e0 + (el - e0) * s;
      if (target) this.cam.target = t0.map((v, i) => v + (target[i] - v) * s);
      this.render(); if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- rays
  rayAt(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new this.T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.ray;
  }
  onPlane(e, z) { const p = new this.T.Vector3(); return this.rayAt(e).intersectPlane(new this.T.Plane(new this.T.Vector3(0, 0, 1), -z), p) ? [p.x, p.y] : null; }
  pickElement(e) { this.rayAt(e); const hit = this.ray.intersectObjects(this.meshes, false)[0]; return hit ? { id: hit.object.userData.id, point: [hit.point.x, hit.point.y, hit.point.z] } : null; }
  screenOf(p3) { const v = new this.T.Vector3(...p3).project(this.camera); return [(v.x + 1) / 2 * this.W, (1 - v.y) / 2 * this.H]; }
  /** z where the ray passes closest to the vertical line through `at`. */
  onVertical(e, at) {
    const R = this.rayAt(e), o = [R.origin.x, R.origin.y, R.origin.z], d = [R.direction.x, R.direction.y, R.direction.z];
    const w0 = v3sub3(o, [at[0], at[1], 0]), b = d[2], dd = vdot3(d, d), dw = vdot3(d, w0);
    const den = dd - b * b; if (Math.abs(den) < 1e-9) return null;
    const s = (dd * w0[2] - b * dw) / den;        // parameter along z
    return s;
  }
  levelZ() { const lv = this.doc.elements().find(f => this.doc.typeOf(f) === "Level"); const id = this.app.workLevel || (lv && this.doc.idOf(lv)); const f = id && this.doc.element(id); return { id, z: f ? (this.doc.data(f) || {}).value || 0 : 0 }; }

  // ---------------------------------------------------------------- grips (declared per element, drawn here in 3D)
  grips() {
    const ids = [...this.app.selection].filter(id => this.doc.element(id));
    if (ids.length !== 1 || this.app.tool !== "select") return [];
    const f = this.doc.element(ids[0]), t = this.doc.typeOf(f), p = this.doc.plan(f);
    if (t === "Wall" && p && p.curve.type === "line") {
      const c = F.json(f, "centreline"), mid = lerp(c.start, c.end, 0.5);
      return [
        { key: "start", at: [...c.start, p.z0], kind: "end", writes: "centreline.start" },
        { key: "end", at: [...c.end, p.z0], kind: "end", writes: "centreline.end" },
        { key: "move", at: [...mid, p.z0], kind: "move", writes: "centreline" },
        { key: "height", at: [...mid, p.z1], kind: "height", writes: "height" },
      ];
    }
    if (t === "Column" && p) { const c = F.point(f, "position"); return [{ key: "move", at: [...c, p.z0], kind: "move", writes: "position" }]; }
    if ((t === "Door" || t === "Window")) { const d = this.doc.data(f), fr = d && d.frame, host = fr && this.doc.element(fr.host), w = host && this.doc.plan(host); if (w) return [{ key: "along", at: [...pointAt(w, 0, fr.at), w.z0 + fr.sill + fr.h + 150], kind: "along", host: fr.host, opening: F.refId(f, "fills") }]; }
    return [];
  }
  buildOverlay() {
    const T = this.T; clear3(this.overlayScene);
    const k = this.span() / this.H;          // model mm per screen px: grips keep their screen size
    for (const g of this.grips()) {
      const col = g.kind === "height" ? 0x2e7d32 : g.kind === "move" ? 0x1d6fd8 : 0xffffff;
      const geo = g.kind === "height" ? new T.ConeGeometry(GRIP_PX * k, GRIP_PX * 2.2 * k, 16) : g.kind === "move" ? new T.OctahedronGeometry(GRIP_PX * 1.1 * k) : new T.SphereGeometry(GRIP_PX * 0.8 * k, 16, 12);
      const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: this.hoverGrip === g.key ? 0xe8591a : col, depthTest: false }));
      if (g.kind === "height") m.rotation.x = Math.PI / 2;
      m.position.set(...g.at); m.renderOrder = 10; m.userData.grip = g;
      this.overlayScene.add(m);
      if (g.kind === "end") { const ring = new T.Mesh(new T.RingGeometry(GRIP_PX * 0.8 * k, GRIP_PX * 1.1 * k, 20), new T.MeshBasicMaterial({ color: 0x1d6fd8, depthTest: false, side: T.DoubleSide })); ring.position.set(...g.at); ring.lookAt(this.camera.position); ring.renderOrder = 11; this.overlayScene.add(ring); }
    }
    // rubber band for the wall tool
    const pts = this.tool.pts.concat(this.tool.cursor ? [this.tool.cursor] : []);
    if (pts.length >= 2) {
      const z = this.levelZ().z, arr = pts.flatMap(p => [p[0], p[1], z + 5]);
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(arr, 3));
      const ln = new T.Line(geo, new T.LineDashedMaterial({ color: 0x1d6fd8, dashSize: 12 * k, gapSize: 8 * k, depthTest: false })); ln.computeLineDistances(); ln.renderOrder = 12;
      this.overlayScene.add(ln);
    }
    if (this.tool.cursor && this.app.tool !== "select") {
      const z = this.levelZ().z, m = new T.Mesh(new T.RingGeometry(4 * k, 7 * k, 20), new T.MeshBasicMaterial({ color: this.tool.snapped ? 0xe8591a : 0x1d6fd8, depthTest: false }));
      m.position.set(this.tool.cursor[0], this.tool.cursor[1], z + 5); m.renderOrder = 12; this.overlayScene.add(m);
    }
  }
  pickGrip(e) {
    const r = this.renderer.domElement.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    let best = null;
    for (const g of this.grips()) { const s = this.screenOf(g.at), d = Math.hypot(s[0] - sx, s[1] - sy); if (d < GRIP_PX + 6 && (!best || d < best.d)) best = { g, d }; }
    return best && best.g;
  }
  /** Snap a plane point to wall ends within 12 px, else quantise to 10 mm. */
  snap(p, exclude) {
    const z = this.levelZ().z, s0 = this.screenOf([p[0], p[1], z]);
    for (const f of this.doc.elements()) if (this.doc.typeOf(f) === "Wall" && this.doc.idOf(f) !== exclude) {
      const c = F.json(f, "centreline"); if (!c || c.type !== "line") continue;
      for (const q of [c.start, c.end]) { const s = this.screenOf([q[0], q[1], z]); if (Math.hypot(s[0] - s0[0], s[1] - s0[1]) < 12) return { p: q.slice(), snapped: true }; }
    }
    return { p: [Math.round(p[0] / 10) * 10, Math.round(p[1] / 10) * 10], snapped: false };
  }

  // ---------------------------------------------------------------- pointer
  bind() {
    const el = this.renderer.domElement; el.style.touchAction = "none"; el.tabIndex = 0;
    let d = null;
    el.addEventListener("pointerdown", e => {
      el.focus({ preventScroll: true }); el.setPointerCapture(e.pointerId);
      const grip = e.button === 0 && this.app.tool === "select" ? this.pickGrip(e) : null;
      if (grip) { d = this.startGrip(e, grip); return; }
      // Revit/PDF navigation: middle-drag pans, Shift+middle-drag orbits (so does the ViewCube);
      // a left drag is a normal drag: a selection window. One finger on a touch screen orbits.
      const touch = e.pointerType === "touch";
      const nav = e.button === 1 ? (e.shiftKey ? "orbit" : "pan") : touch && e.button === 0 && this.app.tool === "select" ? "orbit" : e.button === 0 && this.app.tool === "select" ? "box" : null;
      d = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, cam: JSON.parse(JSON.stringify(this.cam)), nav, moved: false, button: e.button };
      if (e.button === 1) e.preventDefault();
    });
    el.addEventListener("pointermove", e => {
      if (d && d.grip) { d.move(e); return; }
      if (d) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
        if (d.moved) {
          if (d.nav === "pan") { const B = this.basis(), k = this.span() / this.H; this.cam.target = this.cam.target.map((v, i) => v - B.right[i] * dx * k + B.up[i] * dy * k); }
          else if (d.nav === "orbit") { this.cam.azimuth -= dx * 0.4; this.cam.elevation = Math.max(-89, Math.min(89, this.cam.elevation + dy * 0.3)); }
          else if (d.nav === "box") { this.showBox(d, e); return; }
          d.x = e.clientX; d.y = e.clientY; this.render();
        }
        return;
      }
      this.hover(e);
    });
    el.addEventListener("pointerup", e => {
      const g = d; d = null;
      if (!g) return;
      if (g.grip) { g.end(); return; }
      if (g.moved) { if (g.nav === "box") this.finishBox(g, e); return; }
      if (g.button === 1) return;
      if (g.button === 2) return this.app.contextMenu(e, "3d");
      this.click(e);
    });
    el.addEventListener("dblclick", () => { if (this.app.tool === "wall" && this.tool.pts.length >= 2) this.finishWall(false); });
    el.addEventListener("contextmenu", e => e.preventDefault());
    el.addEventListener("auxclick", e => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener("wheel", e => {
      e.preventDefault();
      // zoom about the cursor: keep the point under it fixed on screen
      const r = el.getBoundingClientRect(), mx = (e.clientX - r.left) - this.W / 2, my = (e.clientY - r.top) - this.H / 2, B = this.basis();
      const k0 = this.span() / this.H; this.zoom *= Math.exp(-e.deltaY * 0.0015); const k1 = this.span() / this.H;
      this.cam.target = this.cam.target.map((v, i) => v + B.right[i] * mx * (k0 - k1) - B.up[i] * my * (k0 - k1));
      this.render();
    }, { passive: false });
    el.addEventListener("keydown", e => { if (this.key(e)) { e.preventDefault(); e.stopPropagation(); } });
  }
  /** Left→right encloses (window), right→left touches (crossing), as in plan. */
  showBox(d, e) {
    const r = this.root.getBoundingClientRect();
    if (!this.boxEl) { this.boxEl = h("div", { class: "selbox" }); this.root.append(this.boxEl); }
    const x0 = Math.min(d.sx, e.clientX) - r.left, y0 = Math.min(d.sy, e.clientY) - r.top;
    Object.assign(this.boxEl.style, { left: x0 + "px", top: y0 + "px", width: Math.abs(e.clientX - d.sx) + "px", height: Math.abs(e.clientY - d.sy) + "px" });
    this.boxEl.classList.toggle("crossing", e.clientX < d.sx); this.boxEl.hidden = false;
  }
  finishBox(d, e) {
    if (this.boxEl) this.boxEl.hidden = true;
    const r = this.root.getBoundingClientRect(), crossing = e.clientX < d.sx;
    const bx = [Math.min(d.sx, e.clientX) - r.left, Math.min(d.sy, e.clientY) - r.top, Math.max(d.sx, e.clientX) - r.left, Math.max(d.sy, e.clientY) - r.top];
    const boxes = new Map();
    for (const m of this.meshes) {
      m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      const id = m.userData.id, cur = boxes.get(id); if (cur) cur.union(b); else boxes.set(id, b);
    }
    const ids = [];
    for (const [id, b] of boxes) {
      const pts = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(this.screenOf([x, y, z]));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const sb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const inside = sb[0] >= bx[0] && sb[1] >= bx[1] && sb[2] <= bx[2] && sb[3] <= bx[3];
      const touches = sb[0] <= bx[2] && sb[2] >= bx[0] && sb[1] <= bx[3] && sb[3] >= bx[1];
      if (crossing ? touches : inside) ids.push(id);
    }
    this.app.select(ids, e.shiftKey || e.ctrlKey || e.metaKey);
    this.app.say(`${ids.length} selected (${crossing ? "crossing" : "window"} selection)`, "note");
  }
  hover(e) {
    const tool = this.app.tool;
    if (tool === "select") {
      const g = this.pickGrip(e); const gk = g ? g.key : null;
      const hit = g ? null : this.pickElement(e); const hid = hit ? hit.id : null;
      if (gk !== this.hoverGrip || hid !== this.hoverId) { this.hoverGrip = gk; this.hoverId = hid; this.renderer.domElement.style.cursor = g ? "grab" : hid ? "pointer" : "default"; this.render(); if (hid) this.app.hoverInfo(hid); }
      return;
    }
    const z = this.levelZ().z;
    if (["wall", "column"].includes(tool)) { const p = this.onPlane(e, z); if (!p) return; const s = this.snap(p); this.tool.cursor = s.p; this.tool.snapped = s.snapped; const last = this.tool.pts[this.tool.pts.length - 1]; this.showHud(e, last ? `${Math.round(dist(last, s.p))} mm` : `${s.p.map(Math.round).join(", ")}`); this.render(); }
    if (["door", "window", "opening"].includes(tool)) { const hit = this.pickElement(e); const ok = hit && this.doc.typeOf(this.doc.element(hit.id)) === "Wall"; this.renderer.domElement.style.cursor = ok ? "copy" : "not-allowed"; this.showHud(e, ok ? `${hit.id} · click to place` : "hover a wall"); }
  }
  showHud(e, text) { const r = this.root.getBoundingClientRect(); this.hud.hidden = false; this.hud.style.left = (e.clientX - r.left) + "px"; this.hud.style.top = (e.clientY - r.top) + "px"; this.hud.textContent = text; }
  click(e) {
    const tool = this.app.tool, z = this.levelZ();
    if (tool === "select") { const hit = this.pickElement(e); this.app.select(hit ? [hit.id] : [], e.shiftKey || e.ctrlKey || e.metaKey); return; }
    if (tool === "wall") { const p = this.tool.cursor || this.onPlane(e, z.z); if (!p) return; this.tool.pts.push(p); if (this.tool.pts.length > 2 && dist(p, this.tool.pts[0]) < 1) return this.finishWall(true); this.render(); return; }
    if (tool === "column") { const p = this.tool.cursor || this.onPlane(e, z.z); if (!p) return; this.app.place({ type: "Column", args: { position: p, columnType: { ref: this.app.toolOpts.columnType }, baseLevel: { ref: z.id }, height: 3000, rotation: 0 } }); return; }
    if (["door", "window", "opening"].includes(tool)) {
      const hit = this.pickElement(e); if (!hit || this.doc.typeOf(this.doc.element(hit.id)) !== "Wall") { this.app.say("click on a wall", "note"); return; }
      const w = this.doc.plan(this.doc.element(hit.id));
      this.app.placeOpening(tool, hit.id, Math.round(uOf(w, [hit.point[0], hit.point[1]])));
    }
  }
  startGrip(e, g) {
    const doc = this.doc, id = [...this.app.selection][0], f = doc.element(id);
    const z0 = g.at[2], grab = this.onPlane(e, g.kind === "height" ? g.at[2] : z0);
    const orig = JSON.parse(JSON.stringify(g.writes ? (g.writes.includes(".") ? F.json(f, g.writes.split(".")[0])[g.writes.split(".")[1]] : doc.argValue(f, g.writes)) : null));
    const key = `grip3d:${id}:${g.key}`;
    const wasBound = g.kind === "height" && orig && typeof orig === "object" && orig.ref;
    const plan = doc.plan(f);
    const drv = wasBound ? levelDriver(doc, orig.ref) : null;
    const send = (op) => this.app.apply(Object.assign(op, { coalesce: key }), { quiet: true });
    return {
      grip: true,
      move: ev => {
        if (g.kind === "height") {
          const zz = this.onVertical(ev, g.at); if (zz === null) return;
          const hgt = Math.max(100, Math.round((zz - plan.z0) / 10) * 10);
          // bound to "Top.elevation - Base.elevation": drive the top level, so every wall bound to it follows
          if (drv) { const z = drv.baseZ + hgt; send({ op: "set", id: drv.level, key: "elevation", value: z }); this.showHud(ev, `${F.text(doc.element(drv.level), "name")} → ${z} mm (height ${hgt})`); this.refresh(); return; }
          send({ op: "set", id, key: "height", value: hgt }); this.showHud(ev, `height ${hgt} mm`); return;
        }
        if (g.kind === "along") {
          const w = doc.plan(doc.element(g.host)), p = this.onPlane(ev, w.z0); if (!p) return;
          const u = Math.max(0, Math.min(w.L, Math.round(uOf(w, p) / 10) * 10));
          send({ op: "drag", id: g.opening, key: "profile.at", value: u }); this.showHud(ev, `along ${g.host}: ${u} mm`); return;
        }
        const p = this.onPlane(ev, z0); if (!p) return;
        if (g.kind === "end") { const s = this.snap(p, id); send({ op: "drag", id, key: g.writes, value: s.p }); const c = F.json(doc.element(id), "centreline"); this.showHud(ev, `length ${Math.round(dist(c.start, c.end))} mm${s.snapped ? " · end" : ""}`); }
        if (g.kind === "move" && grab) {
          const dxy = [Math.round((p[0] - grab[0]) / 10) * 10, Math.round((p[1] - grab[1]) / 10) * 10];
          const value = Array.isArray(orig) ? add(orig, dxy) : Object.assign({}, orig, { start: add(orig.start, dxy), end: add(orig.end, dxy) });
          send({ op: "drag", id, key: g.writes, value }); this.showHud(ev, `move ${dxy.join(", ")} mm`);
        }
        this.refresh();
      },
      end: () => { this.app.editor.seal(); this.hud.hidden = true; this.app.refresh({ keepMain: true }); this.refresh(); if (drv) this.app.say(`Moved level ${drv.level}: every wall bound to it followed`, "ok"); else if (wasBound) this.app.say(`height was bound to ${orig.ref}; the grip set it to a literal — undo to restore the binding`, "note"); },
    };
  }
  finishWall(closed) {
    const pts = this.tool.pts.slice(); this.tool.pts = []; this.tool.cursor = null;
    if (pts.length < 2) return;
    const o = this.app.toolOpts, z = this.levelZ();
    const r = this.app.apply({ op: "draw", points: pts, closed, wallType: o.wallType, level: z.id, height: o.height || 3000, mounting: o.mounting || "Centred", tol: 1 });
    if (r.ok) { this.app.say(`${r.ids.length} wall${r.ids.length > 1 ? "s" : ""} drawn and joined`, "ok"); this.app.select(r.ids); }
    this.refresh();
  }
  key(e) {
    if (e.key === "Escape" && this.tool.pts.length) { this.tool.pts = []; this.tool.cursor = null; this.render(); return true; }
    if (this.app.tool === "wall" && this.tool.pts.length) {
      if (e.key === "Enter") { this.finishWall(false); return true; }
      if (e.key.toLowerCase() === "c" && this.tool.pts.length >= 3) { this.finishWall(true); return true; }
    }
    return false;
  }

  // ---------------------------------------------------------------- sheet line-work
  /** Exact HLR in slices — minutes with a progress bar is a feature (§6.4). */
  async generate(onProgress, { keepCamera = false } = {}) {
    const doc = this.doc, v = doc.element(this.viewId);
    if (this.T && !keepCamera) this.app.apply({ op: "set", id: this.viewId, key: "camera", value: roundCam(this.cam) }, { quiet: true });
    const cam = F.json(v, "camera");
    const model = buildHLRModel(doc);
    const it = hlrSteps(model, cam); let r; const t0 = performance.now(); let last = t0;
    for (;;) { r = it.next(); if (r.done) break; if (onProgress) onProgress(r.value.done / r.value.total); if (performance.now() - last > 12) { await new Promise(res => setTimeout(res, 0)); last = performance.now(); } }
    const out = r.value;
    const entry = { camera: JSON.stringify(cam), revision: doc.modelRevision, lines: out.lines, bbox: out.bbox, counts: out.counts };
    const render = F.json(v, "render") || {};
    if (render.mode === "linesOverShaded" && this.renderer) {
      const S = F.int(v, "scale") || 200, wmm = (out.bbox[2] - out.bbox[0]) / S, hmm = (out.bbox[3] - out.bbox[1]) / S;
      const pxW = rasterPixels(wmm, render.rasterDPI || 300), pxH = rasterPixels(hmm, render.rasterDPI || 300);
      entry.raster = this.snapshot(pxW, pxH, cam, out.bbox); entry.rasterDPI = render.rasterDPI || 300; entry.rasterPx = [pxW, pxH];
    }
    doc._hlrCache = Object.assign({}, doc._hlrCache, { [this.viewId]: entry });
    doc.bumpView();
    return { out, ms: performance.now() - t0 };
  }
  /** Free the GPU contexts: browsers allow only a handful at a time. */
  dispose() {
    if (this.ro) this.ro.disconnect();
    for (const r of [this.renderer, this.cube && this.cube.r]) if (r) { r.dispose(); if (r.forceContextLoss) r.forceContextLoss(); }
    this.renderer = null;
  }
  saveCamera() { this.app.apply({ op: "set", id: this.viewId, key: "camera", value: roundCam(this.cam) }); }
  snapshot(pxW, pxH, cam, bbox) {
    const T = this.T, B = cameraBasis(cam), r = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(pxW, pxH);
    const c = new T.OrthographicCamera(bbox[0], bbox[2], bbox[3], bbox[1], -1e6, 1e6);
    const t = new T.Vector3(...cam.target); c.position.copy(t.clone().add(new T.Vector3(...B.D).multiplyScalar(60000))); c.up.set(...B.up); c.lookAt(t);
    const bg = this.scene.background; this.scene.background = new T.Color(0xffffff);
    for (const g of this.groups.values()) g.children.forEach(o => { if (o.userData.edges) o.visible = false; });
    r.render(this.scene, c);
    const url = r.domElement.toDataURL("image/jpeg", 0.9);
    this.scene.background = bg; for (const g of this.groups.values()) g.children.forEach(o => { o.visible = true; }); r.dispose();
    return url;
  }
}
function clear3(scene) { for (const o of scene.children.slice()) { scene.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); } }
const vdot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function shade(doc, t, p) {
  if (t === "Column") return ((doc.lib.materials[p.material] || {}).shading || {}).colour || "#aaaaaa";
  const m = doc.lib.materials[p.stack.layers[0].material] || {}; return (m.shading || {}).colour || "#bbbbbb";
}
function flat(doc, t, p) { return t === "Column" ? "#b9bec6" : shade(doc, t, p); }
const roundCam = c => ({ azimuth: Math.round(((c.azimuth % 360) + 360) % 360 * 10) / 10, elevation: Math.round(c.elevation * 10) / 10, target: c.target.map(v => Math.round(v)) });
