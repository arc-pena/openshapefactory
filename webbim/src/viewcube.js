//! An Autodesk-style ViewCube: faces, edges and corners are hot spots that turn
//! the camera to that direction; the compass ring turns it about z; dragging
//! the cube orbits; the house returns home. It is drawn with its own small
//! three.js scene and always shows the main camera's orientation.

import { h } from "./ui_util.js";

/** A pick on the unit cube → the view direction it names (toward the camera). */
export function cubeDirection(p) {
  const d = p.map(v => Math.abs(v) > 0.62 ? Math.sign(v) : 0);
  if (!d.some(Boolean)) return null;
  return d;
}
/** A direction toward the camera → azimuth/elevation in degrees (the camera model hlr.js uses). */
export function dirToCamera(d) {
  const l = Math.hypot(d[0], d[1], d[2]);
  const el = Math.asin(d[2] / l) * 180 / Math.PI;
  // straight up/down keeps a north-up plan: azimuth 270 looks north
  const az = Math.abs(d[0]) + Math.abs(d[1]) < 1e-9 ? 270 : Math.atan2(d[1], d[0]) * 180 / Math.PI;
  return { azimuth: (az + 360) % 360, elevation: Math.max(-89.5, Math.min(89.5, el)) };
}
const FACES = [ // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  ["RIGHT", 0], ["LEFT", 0], ["BACK", 0], ["FRONT", 0], ["TOP", 0], ["BOTTOM", 0],
];

export class ViewCube {
  constructor(parent, { onTurn, onHome, onOrbit }) {
    this.T = window.THREE; this.onTurn = onTurn; this.onHome = onHome; this.onOrbit = onOrbit;
    this.el = h("div", { class: "viewcube", "aria-label": "ViewCube" });
    this.home = h("button", { class: "vc-home", title: "Home view", "aria-label": "Home view", onclick: () => onHome() }, h("span", { html: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 10l7-6 7 6M5 9v7h4v-4h2v4h4V9"/></svg>' }));
    parent.append(this.el); this.el.append(this.home);
    if (!this.T) return;
    const T = this.T, S = 116;
    this.r = new T.WebGLRenderer({ antialias: true, alpha: true });
    this.r.setPixelRatio(window.devicePixelRatio || 1); this.r.setSize(S, S);
    this.el.append(this.r.domElement);
    this.scene = new T.Scene();
    this.cam = new T.OrthographicCamera(-2.1, 2.1, 2.1, -2.1, -10, 10);
    const mats = FACES.map(([label]) => new T.MeshBasicMaterial({ map: this.faceTexture(label, false) }));
    this.mats = mats;
    this.cube = new T.Mesh(new T.BoxGeometry(2, 2, 2), mats);
    this.scene.add(this.cube);
    this.cube.add(new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(2, 2, 2)), new T.LineBasicMaterial({ color: 0x8a939f })));
    // compass ring on the ground, N toward +y
    const ring = new T.Mesh(new T.RingGeometry(1.55, 1.85, 64), new T.MeshBasicMaterial({ color: 0xc9ced6, side: T.DoubleSide, transparent: true, opacity: .85 }));
    ring.position.z = -1.05; this.scene.add(ring); this.ring = ring;
    for (const [t, x, y] of [["N", 0, 1.7], ["E", 1.7, 0], ["S", 0, -1.7], ["W", -1.7, 0]]) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: this.letter(t) }));
      sp.position.set(x, y, -1.05); sp.scale.set(.42, .42, 1); sp.userData.compass = t; this.scene.add(sp);
    }
    this.ray = new T.Raycaster();
    this.hover = -1;
    const cv = this.r.domElement;
    let drag = null;
    cv.addEventListener("pointermove", e => {
      if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true; if (drag.moved) { this.onOrbit(dx, dy); drag.x = e.clientX; drag.y = e.clientY; } return; }
      const hit = this.pick(e); this.setHover(hit ? hit.face : -1); cv.style.cursor = hit ? "pointer" : "grab";
    });
    cv.addEventListener("pointerleave", () => this.setHover(-1));
    cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: false }; });
    cv.addEventListener("pointerup", e => {
      const d = drag; drag = null; if (!d || d.moved) return;
      const hit = this.pick(e);
      if (hit && hit.dir) this.onTurn(dirToCamera(hit.dir));
      else if (hit && hit.compass) this.onTurn({ azimuth: { N: 90, E: 0, S: 270, W: 180 }[hit.compass], keepElevation: true });
    });
  }
  faceTexture(label, hot) {
    const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
    g.fillStyle = hot ? "#9cc3f5" : "#eef0f3"; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "#aab2bd"; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 125, 125);
    g.fillStyle = "#3b4350"; g.font = "600 24px Segoe UI, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, 64, 66);
    const t = new this.T.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  letter(t) {
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    g.fillStyle = t === "N" ? "#b3261e" : "#4a5361"; g.font = "700 40px Segoe UI, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, 32, 34);
    return new this.T.CanvasTexture(c);
  }
  setHover(i) {
    if (i === this.hover || !this.T) return;
    if (this.hover >= 0) this.mats[this.hover].map = this.faceTexture(FACES[this.hover][0], false);
    if (i >= 0) this.mats[i].map = this.faceTexture(FACES[i][0], true);
    this.hover = i; this.draw();
  }
  pick(e) {
    const r = this.r.domElement.getBoundingClientRect();
    const ndc = new this.T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.cam);
    const hits = this.ray.intersectObjects(this.scene.children, true);
    for (const it of hits) {
      if (it.object === this.cube) { const p = it.point; return { dir: cubeDirection([p.x, p.y, p.z]), face: it.face.materialIndex }; }
      if (it.object.userData.compass) return { compass: it.object.userData.compass };
    }
    return null;
  }
  /** Follow the main camera: same direction, same up. */
  sync(basis) {
    if (!this.T) return;
    this.cam.position.set(basis.D[0] * 5, basis.D[1] * 5, basis.D[2] * 5);
    this.cam.up.set(...basis.up); this.cam.lookAt(0, 0, 0);
    this.draw();
  }
  draw() { if (this.r) this.r.render(this.scene, this.cam); }
}
