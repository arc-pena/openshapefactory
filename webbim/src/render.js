//! The canvas backend for the 2D scene (§6.7). Same primitive list as the PDF,
//! same vocabulary (moveTo/lineTo/stroke/fill/setLineDash/clip). Screen and
//! paper have opposite clamping rules, deliberately: here widths are clamped to
//! one device pixel so fine line-work survives zoom-out; the PDF clamps nothing.

import { segStart, segEnd, samplePath, bboxOf } from "./geom2d.js";
import { emOf, textWidth } from "./scene.js";

export const FONT_FAMILY = "WebBIMSans";

/** view: { x, y (paper mm at the canvas's bottom-left), z (px per mm), W, H (css px), dpr }. */
export function drawScene(g, scene, view, opts = {}) {
  const { dpr = 1 } = view;
  g.save();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = x => (x - view.x) * view.z, Y = y => view.H - (y - view.y) * view.z;
  const minPx = opts.thinLines ? 1 / dpr : 1 / dpr;          // one device pixel
  const vis = [view.x, view.y, view.x + view.W / view.z, view.y + view.H / view.z];
  const trace = path => {
    g.beginPath(); let cur = null;
    for (const s of path) {
      const a = segStart(s);
      if (!cur || Math.abs(a[0] - cur[0]) > 1e-6 || Math.abs(a[1] - cur[1]) > 1e-6) g.moveTo(X(a[0]), Y(a[1]));
      if (s.k === "L") g.lineTo(X(s.b[0]), Y(s.b[1]));
      else if (s.k === "C") g.bezierCurveTo(X(s.c1[0]), Y(s.c1[1]), X(s.c2[0]), Y(s.c2[1]), X(s.b[0]), Y(s.b[1]));
      else g.arc(X(s.c[0]), Y(s.c[1]), s.r * view.z, -s.a0, -s.a1, s.a1 > s.a0);   // y flipped: angles negate
      cur = segEnd(s);
    }
  };
  const selected = opts.selected || new Set(), hover = opts.hover;
  const tint = (p, c) => selected.has(p.id) ? "#1d6fd8" : hover && p.id === hover ? "#4a8fe6" : c;
  const draw = (p) => {
    if (p.t === "group") {
      g.save();
      if (p.clip) { g.beginPath(); g.rect(X(p.clip[0]), Y(p.clip[3]), (p.clip[2] - p.clip[0]) * view.z, (p.clip[3] - p.clip[1]) * view.z); g.clip(); }
      p.prims.forEach(draw); g.restore();
      if (p.stale) { const bb = p.clip || primsBBox(p.prims); g.save(); g.fillStyle = "rgba(179,38,30,.9)"; g.font = `600 ${11}px system-ui, sans-serif`; g.fillText("updating hidden-line…", X(bb[0]) + 4, Y(bb[3]) + 14); g.restore(); }
      return;
    }
    if (!p._bb) p._bb = primBBox(p);
    const b = p._bb; if (b[2] < vis[0] || b[0] > vis[2] || b[3] < vis[1] || b[1] > vis[3]) return;
    if (p.t === "fill") { trace(p.path); g.fillStyle = selected.has(p.id) ? blend(p.colour) : p.colour; g.fill("evenodd"); }
    else if (p.t === "stroke") {
      trace(p.path);
      g.strokeStyle = tint(p, p.colour);
      const w = opts.thinLines ? minPx : Math.max(minPx, p.weight * view.z);
      g.lineWidth = selected.has(p.id) ? Math.max(w, 1.5) : w;
      g.setLineDash(p.dash ? p.dash.map(d => Math.max(1, d * view.z)) : []);
      g.lineCap = "round"; g.lineJoin = "round"; g.stroke();
    } else if (p.t === "hatch") {
      if (opts.noHatch) return;
      g.save(); trace(p.path); g.clip("evenodd");
      g.strokeStyle = p.colour; g.lineWidth = Math.max(minPx, p.weight * view.z);
      hatchLines(g, p, b, X, Y, view.z);
      g.restore();
    } else if (p.t === "text") {
      const em = emOf(p.height) * view.z; if (em < 1.5) return;
      g.save();
      g.translate(X(p.at[0]), Y(p.at[1])); g.rotate(-(p.rot || 0) * Math.PI / 180);
      g.fillStyle = tint(p, p.colour || "#000");
      g.font = `${em}px ${FONT_FAMILY}, "DejaVu Sans", Verdana, sans-serif`;
      const w = textWidth(p.text, p.height) * view.z;
      const dx = p.align === "centre" ? -w / 2 : p.align === "right" ? -w : 0;
      g.fillText(p.text, dx, p.valign === "middle" ? p.height * view.z / 2 : 0);
      g.restore();
    } else if (p.t === "raster" && p.img) {
      g.drawImage(p.img, X(p.rect[0]), Y(p.rect[1] + p.rect[3]), p.rect[2] * view.z, p.rect[3] * view.z);
    }
  };
  if (scene.clip) { g.beginPath(); g.rect(X(scene.clip[0]), Y(scene.clip[3]), (scene.clip[2] - scene.clip[0]) * view.z, (scene.clip[3] - scene.clip[1]) * view.z); g.clip(); }
  scene.prims.forEach(draw);
  g.restore();
}
function blend(c) { return c; }
function hatchLines(g, p, bb, X, Y, z) {
  const s = p.scale, o = p.origin || [0, 0];
  for (const L of p.pattern.lines || []) {
    const a = L.angle * Math.PI / 180, d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
    const across = L.delta[1] * s, along = L.delta[0] * s;
    if (across * z < 1.2) continue;                                 // denser than a pixel: leave the fill
    const orig = [o[0] + (L.origin || [0, 0])[0] * s, o[1] + (L.origin || [0, 0])[1] * s];
    const corners = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]];
    const ks = corners.map(c => ((c[0] - orig[0]) * n[0] + (c[1] - orig[1]) * n[1]) / across);
    const k0 = Math.floor(Math.min(...ks)), k1 = Math.ceil(Math.max(...ks));
    if (k1 - k0 > 4000) continue;
    const ts = corners.map(c => (c[0] - orig[0]) * d[0] + (c[1] - orig[1]) * d[1]);
    const t0 = Math.min(...ts) - Math.abs(along) * (k1 - k0) - 10, t1 = Math.max(...ts) + Math.abs(along) * (k1 - k0) + 10;
    const dashes = L.dashes && L.dashes.length ? L.dashes.map(x => x * s) : null;
    const period = dashes ? dashes.reduce((a, b) => a + Math.abs(b), 0) : 0;
    g.beginPath();
    for (let k = k0; k <= k1; k++) {
      const base = [orig[0] + n[0] * across * k + d[0] * along * k, orig[1] + n[1] * across * k + d[1] * along * k];
      if (!dashes) { const A = [base[0] + d[0] * t0, base[1] + d[1] * t0], B = [base[0] + d[0] * t1, base[1] + d[1] * t1]; g.moveTo(X(A[0]), Y(A[1])); g.lineTo(X(B[0]), Y(B[1])); continue; }
      let t = Math.floor(t0 / period) * period;
      let guard = 0;
      while (t < t1 && guard++ < 5000) for (const ds of dashes) {
        const l = Math.abs(ds) || 0.05 * s;
        if (ds >= 0) { const A = [base[0] + d[0] * t, base[1] + d[1] * t], B = [base[0] + d[0] * (t + l), base[1] + d[1] * (t + l)]; g.moveTo(X(A[0]), Y(A[1])); g.lineTo(X(B[0]), Y(B[1])); }
        t += l;
      }
    }
    g.stroke();
  }
}
export function primBBox(p) {
  if (p.path) return bboxOf(samplePath(p.path, 8));
  if (p.t === "text") { const w = textWidth(p.text, p.height); return [p.at[0] - w, p.at[1] - p.height, p.at[0] + w, p.at[1] + p.height * 2]; }
  if (p.rect) return [p.rect[0], p.rect[1], p.rect[0] + p.rect[2], p.rect[1] + p.rect[3]];
  return [-Infinity, -Infinity, Infinity, Infinity];
}
export function primsBBox(prims) { const bs = prims.map(p => p.t === "group" ? (p.clip || primsBBox(p.prims)) : primBBox(p)).filter(b => isFinite(b[0])); if (!bs.length) return [0, 0, 1, 1]; return [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))]; }
