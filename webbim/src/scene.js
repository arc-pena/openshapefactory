//! Phase 4 — DERIVE (§6). A view becomes a flat list of typed 2D primitives
//! with no reference back to the document, in PAPER MILLIMETRES: the view scale
//! is consumed here, when the scene is built, and never reaches a renderer or
//! the PDF writer (§12.3). Two renderers, one scene.
//!
//! prim: {t:"fill", path, colour} · {t:"hatch", path, pattern, scale, colour, weight}
//!       {t:"stroke", path, weight (mm | "none" never emitted), colour, dash}
//!       {t:"text", at, text, height, rot, align, valign, colour} · {t:"raster", rect, url}
//!       {t:"link", rect, sheet}   — all carry {layer, id} for OCGs and picking.

import { fmtLength, fmtArea, isImperial } from "./units.js";
import { outline, elementSegs, bridgeHoles } from "./bimsketch.js";
import { buildableArea } from "./spacegraph.js";
import { plateAt, featureEdges, sliceMesh } from "./massing.js";
import {
  TOL, add, sub, mul, dot, dist, perp, normalise, lerp, samplePath, pathArea, polyPath, bboxOf, segStart, segEnd, segMinusConvex,
  ensureCCW, convexHull, TAU, pointInPoly, reversePath, polyArea, triangulate,
} from "./geom2d.js";
import { F, propertyOf, evalParam, displayParam } from "./ocaf.js";
import { formatValue, parse, evaluate } from "./expr.js";
import { wallRegions, coarseMaterial, blocks, wallAt, leanInvolved } from "./joins.js";
import { pointAt, uOf, wallSurfaces, cutAtHeight, plane, LAYER_PRIORITY, wallTop, topBreaks } from "./walls.js";
import { cropLoop, loopBBox, annotationRect, isAnnotationLayer } from "./crop.js";
import { resolveGraphics, categoryOf, penWeight, rulesFor, categoryVisible, mix, LINE_TYPES, matches, effectiveStyle, hiddenByRule } from "./styles.js";
import { measureRefs, resolveReference, elementRefs, sheetSize, regionAreas, importPlacer, importLayerMap, sketchPath } from "./bim.js";
import { FONT_WIDTHS, FONT_METRICS } from "./fontdata.js";
import { dimStyleOf, formatDimension } from "./dimstyles.js";
import { paramText, scheduleTable } from "./schedules.js";
import { readDXF } from "./dxf.js";
import { sunOf, planShadows } from "./sun.js";
import { NORTH_DXF } from "./library.js";

// ---------------------------------------------------------------- text metrics
/** Text height is cap height in paper mm (the drafting convention); the em
 *  follows from the font's cap height, identically on canvas and in the PDF. */
/** The fonts text can be set in. Sans is the embedded DejaVu; the others are the PDF standard fonts (no
 *  embedding needed) and their screen equivalents. Text height is cap height in every font, as in CAD:
 *  `cap` is each font's cap height per em, `k` scales DejaVu's widths to its own, a mono font is 0.6 em. */
export const TEXT_FONTS = {
  Sans:  { label: "Sans (DejaVu)", css: null, cap: null, k: 1, pdf: "F1" },
  Arial: { label: "Arial / Helvetica", css: 'Arial, Helvetica, "Liberation Sans", sans-serif', cap: 0.716, k: 0.88, pdf: "F2" },
  ArialBold: { label: "Arial Bold / Helvetica Bold", css: 'Arial, Helvetica, "Liberation Sans", sans-serif', weight: "bold", cap: 0.716, k: 0.94, pdf: "F5" },
  // Frank Harmon's sets are lettered in Futura: set on screen in Futura where the machine has it (else a
  // geometric sans), in the PDF as Helvetica; its cap height and widths are close enough to place text by
  Futura: { label: "Futura (geometric sans)", css: 'Futura, "Futura PT", "Futura Std", "Century Gothic", "Avenir Next", Jost, "Helvetica Neue", Arial, sans-serif', cap: 0.7, k: 0.9, pdf: "F2" },
  Serif: { label: "Serif (Times)", css: '"Times New Roman", Times, "Liberation Serif", serif', cap: 0.662, k: 0.82, pdf: "F3" },
  Mono:  { label: "Mono (Courier)", css: '"Courier New", Courier, "Liberation Mono", monospace', cap: 0.571, mono: 0.6, pdf: "F4" },
};
// Helvetica's advance widths (Arial's are the same), WinAnsi 32-255: the PDF writer sets Arial as Helvetica, so
// text placed by its width (right-aligned, centred) lands where it is drawn
const HELV_WIDTHS = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,556,222,556,333,1000,556,556,333,1000,667,333,1000,556,611,556,556,222,222,333,333,350,556,1000,333,1000,500,333,944,556,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const HELV_BOLD_WIDTHS = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,556,556,278,556,500,1000,556,556,333,1000,667,333,1000,556,611,556,556,278,278,500,500,350,556,1000,333,1000,556,333,944,556,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
TEXT_FONTS.Arial.widths = HELV_WIDTHS; TEXT_FONTS.ArialBold.widths = HELV_BOLD_WIDTHS; TEXT_FONTS.Futura.widths = HELV_WIDTHS;
const fontOf = name => TEXT_FONTS[name] || TEXT_FONTS.Sans;
export const emOf = (h, font) => { const F0 = fontOf(font); return h / (F0.cap || FONT_METRICS.capHeight / 1000); };
export function textWidth(str, h, font, widthFactor = 1) {
  const F0 = fontOf(font), em = emOf(h, font);
  if (F0.mono) return [...String(str)].length * F0.mono * em * widthFactor;
  if (F0.widths) { let w = 0; for (const ch of String(str)) { const code = FONT_METRICS.unicodeToCode[ch.codePointAt(0)] ?? 63; w += F0.widths[code - 32] ?? 556; } return w / 1000 * em * widthFactor; }
  let w = 0;
  for (const ch of String(str)) { const code = FONT_METRICS.unicodeToCode[ch.codePointAt(0)] ?? 63; w += FONT_WIDTHS[code] || 600; }
  return w / 1000 * em * F0.k * widthFactor;
}
export function wrapText(str, h, width, font) {
  const out = [];
  for (const para of String(str).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? line + " " + word : word;
      if (width && textWidth(t, h, font) > width && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------- scene builder
class SceneBuilder {
  constructor(scale) { this.S = scale; this.prims = []; this.hits = []; this.links = []; this.later = []; this.mat = []; }
  P(p) { return [p[0] / this.S, p[1] / this.S]; }
  path(model) {
    const S = this.S;
    return model.map(s => s.k === "L" ? { k: "L", a: [s.a[0] / S, s.a[1] / S], b: [s.b[0] / S, s.b[1] / S] }
      : s.k === "A" ? { k: "A", c: [s.c[0] / S, s.c[1] / S], r: s.r / S, a0: s.a0, a1: s.a1 }
      : { k: "C", a: [s.a[0] / S, s.a[1] / S], c1: [s.c1[0] / S, s.c1[1] / S], c2: [s.c2[0] / S, s.c2[1] / S], b: [s.b[0] / S, s.b[1] / S] });
  }
  fill(model, colour, layer, id, paper = false) { if (colour) this.prims.push({ t: "fill", path: paper ? model : this.path(model), colour, layer, id }); }
  hatch(model, pat, patId, colour, weight, layer, id, paper = false) {
    if (!pat || weight === "none" || weight == null) return;
    this.prims.push({ t: "hatch", path: paper ? model : this.path(model), pattern: Object.assign({ id: patId }, pat), scale: pat.kind === "model" ? 1 / this.S : 1, colour, weight, layer, id });
  }
  stroke(model, g, layer, id, paper = false) {
    if (!g || g.weight === "none" || g.weight == null || !g.visible && g.visible !== undefined) return;
    this.prims.push({ t: "stroke", path: paper ? model : this.path(model), weight: g.weight, colour: g.colour || "#000000", dash: g.dash || null, layer, id });
  }
  text(atPaper, text, height, opts = {}) {
    this.prims.push(Object.assign({ t: "text", at: atPaper, text: String(text), height, rot: 0, align: "left", valign: "baseline", colour: "#000000" }, opts));
  }
  hit(id, modelPts, kind = "region", depth) { this.hits.push(depth === undefined ? { id, pts: modelPts, kind } : { id, pts: modelPts, kind, depth }); }
}
const lineSeg = (a, b) => ({ k: "L", a, b });
const circlePath = (c, r) => [{ k: "A", c, r, a0: 0, a1: TAU }];
const rectPath = (x0, y0, x1, y1) => polyPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
/** The crop region, as data: the model is clipped to the crop (a rectangle or a sketched
 *  loop), annotation to the annotation crop around it. The prims stay one list; the scene
 *  carries clip / clipPath / annoClip and every renderer splits by layer the same way. */
function applyCrop(doc, v, clip, scene, S) {
  const loop = clip && cropLoop(clip);
  if (!loop) { scene.bbox = sceneBBox(scene.prims); return; }
  const paper = loop.map(p => [p[0] / S, p[1] / S]), bb = loopBBox(paper), ann = annotationRect(clip, bb);
  const shaped = !!(clip.shape && clip.shape.elements && clip.shape.elements.length);
  const outline = [];
  if (clip.visible) {
    outline.push({ t: "stroke", path: polyPath(paper), weight: 0.25, colour: "#1d6fd8", dash: [3, 1.5], layer: "Crop", id: doc.idOf(v) });
    outline.push({ t: "stroke", path: rectPath(...ann), weight: 0.18, colour: "#7fa6d9", dash: [1.2, 1.2], layer: "Crop", id: doc.idOf(v) });
  }
  scene.prims.push(...outline);
  if (clip.active) { scene.clip = bb; scene.clipPath = shaped ? paper : null; scene.annoClip = ann; }
  scene.bbox = clip.active ? ann : sceneBBox(scene.prims);
}

// ---------------------------------------------------------------- context
export function viewContext(doc, v) {
  const type = doc.typeOf(v);
  const styleId = F.refId(v, "style") || (type === "View3D" ? "VS-CONSTRUCTION" : "VS-CONSTRUCTION");
  const base = doc.lib.viewStyles[styleId] || Object.values(doc.lib.viewStyles)[0] || {};
  // the style as this view draws it: the view's own V/G overrides and filters over what the style leaves open
  const style = effectiveStyle(doc, base, v);
  const scale = F.int(v, "scale") || 100;
  const filters = doc.argValue(v, "filters") || [];
  const detailArg = doc.argValue(v, "detailLevel");
  return { view: v, style, styleId, scale, overrides: doc.argValue(v, "overrides") || {}, rules: rulesFor(doc, style, filters),
    detail: detailArg || style.detailLevel || "Fine", hidden: [], scheme: style.schemeObj };
}

/** Where every view sits: sheet number and viewport number, for markers (§11). */
export function placements(doc) {
  const out = new Map();
  for (const sh of doc.elements()) if (doc.typeOf(sh) === "Sheet") (doc.argValue(sh, "viewports") || []).forEach((vp, i) =>
    out.set(vp.view.ref, { sheet: doc.idOf(sh), number: doc.argValue(sh, "number"), vp: i + 1 }));
  return out;
}

// ---------------------------------------------------------------- caching by watermark (§6.5)
const CACHE = new WeakMap();
export function deriveView(doc, v, opts = {}) {
  let c = CACHE.get(doc); if (!c) { c = new Map(); CACHE.set(doc, c); }
  const key = [doc.modelRevision, doc.viewRevision, doc.revision(v), JSON.stringify(doc.elementJSON(v)), JSON.stringify(opts)].join("|");
  const hit = c.get(doc.idOf(v));
  if (hit && hit.key === key) return hit.scene;
  doc.stats.derives++;
  const t = doc.typeOf(v);
  const scene = t === "PlanView" ? planScene(doc, v, opts) : t === "ElevationView" ? elevationScene(doc, v, opts) : t === "SectionView" ? sectionScene(doc, v, opts)
    : t === "Sheet" ? sheetScene(doc, v, opts) : t === "View3D" ? view3dScene(doc, v, opts) : t === "Schedule" ? scheduleScene(doc, v, opts)
    : t === "DraftingView" ? draftingScene(doc, v, opts) : emptyScene();
  scene.watermark = doc.modelRevision;
  // the graphic scheme's paper: Blueprint and Night draw on their own ground, on screen, on sheets, in the PDF
  if (["PlanView", "ElevationView", "SectionView", "View3D"].includes(t)) {
    const sch = viewContext(doc, v).scheme || {};
    scene.background = sch.background || null;
    // what is drawn in plain black (tags, dimensions, text) takes the scheme's ink; paper-white masks take its paper
    if (sch.ink || sch.background) inkScene(scene.prims, sch.ink || "#000000", sch.background || "#ffffff");
    const sk = viewContext(doc, v).style.sketchy;
    if (sk && (sk.extension > 0 || sk.jitter > 0)) sketchScene(scene.prims, sk);
  }
  c.set(doc.idOf(v), { key, scene });
  return scene;
}
const BLACK = /^#(000|000000)$/i, WHITE = /^#(fff|ffffff)$/i;
function inkScene(prims, ink, paper) {
  for (const p of prims) {
    if (p.t === "group") { inkScene(p.prims, ink, paper); continue; }
    if (!p.colour || p.colour === undefined) { if (p.t === "text" || p.t === "stroke") p.colour = ink; continue; }
    if (BLACK.test(p.colour)) p.colour = ink;
    else if (p.t === "fill" && WHITE.test(p.colour)) p.colour = paper;
  }
}
/** Revit's Sketchy Lines, as a hand would draw them: every straight stroke overshoots its ends by the
 *  extension and bows by up to the jitter (paper mm) - the same bow each time, so a redraw never shimmers. */
function sketchScene(prims, sk) {
  const ext = sk.extension || 0, jit = sk.jitter || 0;
  const hash = (a, b) => { const x = Math.sin(a[0] * 12.9898 + a[1] * 78.233 + b[0] * 37.719 + b[1] * 4.581) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  for (const p of prims) {
    if (p.t === "group") { sketchScene(p.prims, sk); continue; }
    if (p.t !== "stroke" || !p.path) continue;
    const out = [];
    for (const g of p.path) {
      if (g.k !== "L") { out.push(g); continue; }
      const d = sub(g.b, g.a), L = Math.hypot(d[0], d[1]); if (L < 1e-6) continue;
      const u = [d[0] / L, d[1] / L], n = [-u[1], u[0]], e = Math.min(ext, L * 0.5);
      const a = [g.a[0] - u[0] * e, g.a[1] - u[1] * e], b = [g.b[0] + u[0] * e, g.b[1] + u[1] * e];
      const w1 = hash(g.a, g.b) * jit, w2 = hash(g.b, g.a) * jit;
      out.push(jit ? { k: "C", a, c1: [a[0] + d[0] / 3 + n[0] * w1, a[1] + d[1] / 3 + n[1] * w1], c2: [a[0] + d[0] * 2 / 3 + n[0] * w2, a[1] + d[1] * 2 / 3 + n[1] * w2], b } : { k: "L", a, b });
    }
    p.path = out;
  }
}
const emptyScene = () => ({ prims: [], hits: [], links: [], bbox: [0, 0, 100, 100] });
export function sceneBBox(prims) {
  const pts = [];
  for (const p of prims) {
    if (p.path) pts.push(...samplePath(p.path, 8));
    else if (p.t === "text") { pts.push(p.at); pts.push(add(p.at, [textWidth(p.text, p.height) * (p.align === "centre" ? 0.5 : 1), p.height])); pts.push(sub(p.at, [p.align === "centre" ? textWidth(p.text, p.height) / 2 : p.align === "right" ? textWidth(p.text, p.height) : 0, p.height * 0.3])); }
    else if (p.rect) { pts.push([p.rect[0], p.rect[1]]); pts.push([p.rect[0] + p.rect[2], p.rect[1] + p.rect[3]]); }
  }
  return pts.length ? bboxOf(pts) : [0, 0, 100, 100];
}

// ---------------------------------------------------------------- plan (§6.2)
export function planScene(doc, v, opts = {}) {
  const ctx = viewContext(doc, v);
  const S = ctx.scale, B = new SceneBuilder(S);
  const lv = F.reference(v, "level"), E = lv ? (doc.data(lv) || {}).value || 0 : 0;
  // Revit's View Range: Top, Cut plane and Bottom from the level, and View Depth below the bottom.
  // What lies between the bottom and the depth is seen beyond (lighter); deeper than that, nothing.
  const vr = Object.assign({ top: 2300, cut: 1200, bottom: 0 }, doc.argValue(v, "viewRange") || {});
  const cutZ = E + vr.cut, topZ = E + vr.top, botZ = E + vr.bottom, depthZ = E + (vr.depth ?? vr.bottom);
  const band = (z0, z1) => z0 > topZ + TOL ? "above" : z1 < botZ - TOL ? (z1 >= depthZ - TOL ? "beyond" : "below") : (z0 <= cutZ + TOL && z1 >= cutZ - TOL) ? "cut" : z1 < cutZ ? "projection" : "beyond";
  // floors first: a floor meeting a wall disappears under the wall's cut, as it does on paper
  const els = doc.elements().filter(f => (f.get("Integer") !== 0 && !doc.error(f) || doc.typeOf(f) === "Wall") && !hiddenByRule(doc, ctx, f))
    .map((f, i) => [f, i]).sort((a, b) => (doc.typeOf(b[0]) === "Floor") - (doc.typeOf(a[0]) === "Floor") || a[1] - b[1]).map(([f]) => f);
  // Revit's Hide in View: an element the view's overrides mark invisible is left out here only
  const hov = doc.argValue(v, "overrides") || {};
  const vis = f => categoryVisible(ctx, categoryOf(doc, f)) && f.get("Integer") !== 0 && (hov[doc.idOf(f)] || {}).visible !== false;
  const onlyHere = f => { const r = F.refId(f, "view"); return !r || r === doc.idOf(v); };
  const place = placements(doc);
  const stat = { walls: 0, offsetsBefore: doc.stats.offsets };

  // 1. spaces first: fills sit under everything
  for (const f of els) if (doc.typeOf(f) === "Space" && vis(f) && F.refId(f, "level") === (lv && doc.idOf(lv))) drawSpace(doc, ctx, B, f);
  // hard shadows go here, over the room fills and under everything drawn from the model (filled in at the end)
  const shadowAt = B.prims.length;
  // 2. walls
  for (const f of els) if (doc.typeOf(f) === "Wall" && vis(f)) {
    const w = doc.plan(f); if (!w) continue;
    if (F.refId(f, "baseLevel") && lv && F.refId(f, "baseLevel") !== doc.idOf(lv) && !(w.z0 <= cutZ && (w.zHi ?? w.z1) >= cutZ)) continue;
    const bnd = band(w.zLo ?? w.z0, w.zHi ?? w.z1); if (bnd === "above" || bnd === "below") continue;
    stat.walls++;
    drawWall(doc, ctx, B, f, w, bnd, cutZ);
  }
  // 3. columns, fillers, furniture
  for (const f of els) {
    const t = doc.typeOf(f); if (!vis(f)) continue;
    if (t === "Floor" && vis(f)) {
      // a floor reads in plan as its edge; cut, it is poché like any cut element
      const p = doc.plan(f); if (!p) continue; const bnd = band(p.z0, p.z1);
      if (bnd === "above" || bnd === "below") continue;
      const g = resolveGraphics(doc, ctx, f, bnd === "cut" ? "cut" : bnd === "beyond" ? "beyond" : "projection");
      if (bnd === "cut") B.fill(p.path, g.fill || ((doc.lib.materials[p.material] || {}).cut || {}).background || "#e9eaec", "IfcSlab", doc.idOf(f));
      B.stroke(p.path, g, "IfcSlab", doc.idOf(f)); B.hit(doc.idOf(f), p.foot);
      // seen from above, a floor is its top layer
      const top = (p.parts || []).reduce((a, x) => (!a || x.z1 > a.z1 ? x : a), null);
      B.mat.push({ id: doc.idOf(f), material: (top && top.material) || p.material, poly: p.foot, floor: true });
    }
    if (t === "SiteBoundary" && vis(f)) {
      // the plot lines: a heavy property-line chain; the setback line dashed inside it; the area written in
      const p = doc.plan(f); if (!p) continue; const id = doc.idOf(f);
      B.stroke(polyPath(p.pts), { weight: penWeight(doc, "bold", S), colour: "#1b1f24", dash: [9, 1.5, 1.2, 1.5, 1.2, 1.5] }, "Site", id);
      if (p.setbacks.some(x => x > 0)) B.stroke(polyPath(p.buildable), { weight: penWeight(doc, "thin", S), colour: "#d0312d", dash: LINE_TYPES.dashed1 }, "Site", id);
      const c = p.pts.reduce((a, q) => add(a, q), [0, 0]).map(v => v / p.pts.length), d = doc.data(f);
      if (d && d.props && F.bool(f, "label") !== false) B.text(add(B.P(c), [0, 0]), `SITE ${fmtArea(d.props["Site area"].v)}`, 3.5, { align: "centre", layer: "Site", id, colour: "#1b1f24" });
      B.hit(id, p.pts, "curve");
    }
    if (t === "Massing" && vis(f)) {
      // the envelope where the plan cuts it: a pale fill and a chain outline, as Revit draws a mass
      const p = doc.plan(f); if (!p || cutZ < p.z0 || cutZ > p.z1) continue;
      const g = resolveGraphics(doc, ctx, f, "cut");
      for (const pl of plateAt(p.mesh, cutZ).plates) {
        const path = [...polyPath(pl.outer), ...pl.holes.flatMap(hh => polyPath(hh))];
        B.fill(path, g.halftone ? "#eef3f9" : "#e3ecf7", "Mass", doc.idOf(f));
        B.stroke(path, { weight: g.weight === "none" ? penWeight(doc, "thin", S) : g.weight, colour: g.colour === "#000000" ? "#3b6fb0" : g.colour, dash: LINE_TYPES.centre }, "Mass", doc.idOf(f));
        B.hit(doc.idOf(f), pl.outer);
      }
    }
    if (t === "Lattice" && vis(f)) {
      // cut: the bricks of the course the cut plane passes through, each its own rectangle; below the cut, the outline
      const p = doc.plan(f); if (!p) continue;
      const bnd = band(p.z0, p.z1); if (bnd === "above" || bnd === "below") continue;
      const id = doc.idOf(f), cat = categoryOf(doc, f), fr = p.frame;
      const P = (u, sd) => add(fr.start, add(mul(fr.d, u), mul(fr.n, sd)));
      const rect = (u0, u1) => polyPath([P(u0, -fr.bt / 2), P(u1, -fr.bt / 2), P(u1, fr.bt / 2), P(u0, fr.bt / 2)]);
      if (bnd === "cut") {
        const g = resolveGraphics(doc, ctx, f, "cut", "Common", p.material);
        const course = p.bricks.filter(b => b.z0 <= cutZ && b.z1 >= cutZ);
        const row = course.length ? course : p.bricks.filter(b => Math.abs(b.z0 - p.bricks[0].z0) < 1);
        for (const b of row) { if (g.fill) B.fill(rect(b.u0, b.u1), g.fill, cat, id); B.stroke(rect(b.u0, b.u1), g, cat, id); }
      } else B.stroke(p.path, resolveGraphics(doc, ctx, f, "projection"), cat, id);
      B.hit(id, p.foot);
      continue;
    }
    if ((t === "Duct" || t === "Pipe") && vis(f)) {
      // MEP runs as MEP drawings show them: each run two lines and a dashed centreline, a riser its section crossed
      // drawn whatever the cut: services above it are what a services plan is for
      const p = doc.plan(f); if (!p) continue;
      const id = doc.idOf(f), cat = categoryOf(doc, f), g = resolveGraphics(doc, ctx, f, "projection");
      for (const r of p.runs || []) {
        if (r.riser) {
          const c = r.c, h = p.W / 2;
          if (p.round) { const ring = []; for (let i = 0; i <= 32; i++) { const a = i / 32 * 2 * Math.PI; ring.push([c[0] + Math.cos(a) * h, c[1] + Math.sin(a) * h]); } B.stroke(ring.slice(0, -1).map((q, i) => lineSeg(q, ring[i + 1])), g, cat, id); }
          else B.stroke(polyPath([[c[0] - h, c[1] - p.H / 2], [c[0] + h, c[1] - p.H / 2], [c[0] + h, c[1] + p.H / 2], [c[0] - h, c[1] + p.H / 2]]), g, cat, id);
          const k = h * 0.7071; B.stroke([lineSeg([c[0] - k, c[1] - k], [c[0] + k, c[1] + k]), lineSeg([c[0] - k, c[1] + k], [c[0] + k, c[1] - k])], g, cat, id);
          B.hit(id, [[c[0] - h, c[1] - h], [c[0] + h, c[1] - h], [c[0] + h, c[1] + h], [c[0] - h, c[1] + h]]);
        } else {
          B.stroke([lineSeg(r.foot[0], r.foot[1]), lineSeg(r.foot[2], r.foot[3]), lineSeg(r.foot[1], r.foot[2]), lineSeg(r.foot[3], r.foot[0])], g, cat, id);
          B.stroke([lineSeg(r.a, r.b)], Object.assign({}, g, { dash: LINE_TYPES.centre, weight: penWeight(doc, "hairline", S) }), cat, id);
          B.hit(id, r.foot);
        }
      }
      continue;
    }
    if (t === "Stair" && vis(f)) { const p = doc.plan(f); if (p && p.stair) drawStairPlan(doc, ctx, B, f, p, { cutZ, topZ, botZ, E }); continue; }
    if (t === "Toposurface" && vis(f)) { const p = doc.plan(f); if (p && p.mesh) drawTopoPlan(doc, ctx, B, f, p); continue; }
    if (t === "Railing" && vis(f)) { const p = doc.plan(f); if (p && p.railing && p.z0 <= topZ + TOL) drawRailingPlan(doc, ctx, B, f, p); continue; }
    if (t === "Ramp" && vis(f)) { const p = doc.plan(f); if (p && p.ramp && p.z0 <= topZ + TOL) drawRampPlan(doc, ctx, B, f, p); continue; }
    if (t === "Planting" && vis(f)) { const p = doc.plan(f); if (p && p.planting) drawPlantingPlan(doc, ctx, B, f, p); continue; }
    if ((t === "Generic" || t === "Roof") && vis(f)) {
      const p = doc.plan(f); if (!p) continue;
      const catG = categoryOf(doc, f);
      // the ground is not cut in plan: it is drawn as its contours (every 0.5 m, every 2.5 m heavier) within its edge
      if (catG === "Topography" && p.mesh) {
        const id = doc.idOf(f), gp = resolveGraphics(doc, ctx, f, "projection"), minor = [], major = [];
        // strata lie under the ground surface: only the uppermost of overlapping surfaces draws contours
        const bb = q => { const xs = q.foot.map(a => a[0]), ys = q.foot.map(a => a[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }, mb = bb(p);
        const under = doc.elements().some(g => { if (g === f || doc.typeOf(g) !== "Generic" || categoryOf(doc, g) !== "Topography") return false; const q = doc.plan(g); if (!q || !q.mesh || q.z1 <= p.z1) return false;
          const o = bb(q), ix = Math.max(0, Math.min(o[2], mb[2]) - Math.max(o[0], mb[0])), iy = Math.max(0, Math.min(o[3], mb[3]) - Math.max(o[1], mb[1])); return ix * iy > 0.5 * (mb[2] - mb[0]) * (mb[3] - mb[1]); });
        if (under) { B.hit(id, p.foot); continue; }
        const P = p.mesh.positions, I = p.mesh.index;
        for (let k = 0; k < I.length; k += 3) {
          const A = I[k] * 3, Bi = I[k + 1] * 3, C = I[k + 2] * 3;
          const q = [[P[A], P[A + 1], P[A + 2]], [P[Bi], P[Bi + 1], P[Bi + 2]], [P[C], P[C + 1], P[C + 2]]];
          const nz = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]);
          if (nz <= 1e-6) continue;                                   // the ground's upper surface only
          const zl = Math.min(q[0][2], q[1][2], q[2][2]), zh = Math.max(q[0][2], q[1][2], q[2][2]);
          for (let z = Math.ceil(zl / 500) * 500; z <= zh; z += 500) {
            const pts = [];
            for (let i = 0; i < 3; i++) { const a = q[i], b = q[(i + 1) % 3]; if ((a[2] - z) * (b[2] - z) < 0) { const t = (z - a[2]) / (b[2] - a[2]); pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } }
            if (pts.length === 2) (Math.round(z) % 2500 === 0 ? major : minor).push(lineSeg(pts[0], pts[1]));
          }
        }
        if (minor.length) B.stroke(minor, Object.assign({}, gp, { weight: penWeight(doc, "hairline", S), colour: "#8a7a62" }), catG, id);
        if (major.length) B.stroke(major, Object.assign({}, gp, { weight: penWeight(doc, "thin", S), colour: "#6b5a40" }), catG, id);
        B.stroke(p.path, Object.assign({}, gp, { dash: LINE_TYPES.dashed2 }), catG, id); B.hit(id, p.foot);
        continue;
      }
      // a tree or shrub: its canopy seen from above, whatever the cut
      if (catG === "Planting") {
        const id = doc.idOf(f), gp = resolveGraphics(doc, ctx, f, "projection"), c = p.foot.reduce((a, q) => [a[0] + q[0] / p.foot.length, a[1] + q[1] / p.foot.length], [0, 0]);
        const rr = Math.max(...p.foot.map(q => Math.hypot(q[0] - c[0], q[1] - c[1]))) * 0.12;
        B.fill(p.path, "#e1eed7", catG, id);
        B.stroke([...p.path, lineSeg([c[0] - rr, c[1]], [c[0] + rr, c[1]]), lineSeg([c[0], c[1] - rr], [c[0], c[1] + rr])], gp, catG, id); B.hit(id, p.foot);
        continue;
      }
      // a generic model reads like a column: poché where the cut crosses it, its outline below
      const bnd = band(p.z0, p.z1);
      if (bnd === "above" || bnd === "below") continue;
      if (p.mesh) {
        // a body of its own shape (an imported stair, railing, basin): cut where the plane crosses it,
        // and below the cut its feature edges, as the draughtsman sees them from above
        const id = doc.idOf(f);
        if (bnd === "cut") {
          const g = resolveGraphics(doc, ctx, f, "cut"), mc = (doc.lib.materials[p.material] || {}).cut || {};
          for (const pl of meshPlates(doc, p, cutZ)) {
            const path = [...polyPath(pl.outer), ...pl.holes.flatMap(hh => polyPath(hh))];
            B.fill(path, g.pattern === "solid" ? g.fill || "#000" : g.fill || mc.background || "#e9eaec", categoryOf(doc, f), id);
            B.stroke(path, g, categoryOf(doc, f), id); B.hit(id, pl.outer);
          }
        }
        const gp = resolveGraphics(doc, ctx, f, bnd === "beyond" ? "beyond" : "projection"), P = p.mesh.positions, segs = [], lo = bnd === "beyond" ? -Infinity : depthZ, hi = cutZ;
        for (const [a, b] of meshEdges(doc, p.meshShape, p.mesh)) {
          let za = P[a * 3 + 2], zb = P[b * 3 + 2]; if ((za > hi && zb > hi) || (za < lo && zb < lo)) continue;
          let A = [P[a * 3], P[a * 3 + 1]], Bq = [P[b * 3], P[b * 3 + 1]];
          if (za > hi || zb > hi) { const t = (hi - za) / (zb - za), m = [A[0] + (Bq[0] - A[0]) * t, A[1] + (Bq[1] - A[1]) * t]; if (za > hi) A = m; else Bq = m; }
          if (Math.hypot(Bq[0] - A[0], Bq[1] - A[1]) > 0.5) segs.push(lineSeg(A, Bq));
        }
        if (segs.length) B.stroke(segs, gp, categoryOf(doc, f), id);
        B.hit(id, p.foot);
        continue;
      }
      const g = resolveGraphics(doc, ctx, f, bnd === "cut" ? "cut" : "projection");
      // a coloured mass (a block of programme) keeps its colour: solid where cut, paler seen from above
      if (bnd === "cut") B.fill(p.path, p.colour || g.fill || ((doc.lib.materials[p.material] || {}).cut || {}).background || "#e9eaec", "IfcBuildingElementProxy", doc.idOf(f));
      else if (p.colour) B.fill(p.path, mix(p.colour, "#ffffff", 0.45), "IfcBuildingElementProxy", doc.idOf(f));
      B.stroke(p.path, p.colour && bnd !== "cut" ? Object.assign({}, g, { dash: LINE_TYPES.dashed2 }) : g, "IfcBuildingElementProxy", doc.idOf(f)); B.hit(doc.idOf(f), p.foot);
      // a coloured mass is a block of programme: it says what it is
      if (p.colour) { const c = p.foot.reduce((a, q) => add(a, q), [0, 0]).map(v => v / p.foot.length); B.text(B.P(c), f.get("Name"), 2.2, { align: "centre", layer: "IfcBuildingElementProxy", id: doc.idOf(f), colour: "#1b1f24" }); }
    }
    if (t === "Beam" && vis(f)) {
      // a beam above the cut is drawn dashed, as it is seen from below; cut, it is a section
      const p = doc.plan(f); if (!p) continue; const bnd = band(p.z0, p.z1);
      if (bnd === "below") continue;
      const g = bnd === "cut" ? resolveGraphics(doc, ctx, f, "cut") : Object.assign({}, resolveGraphics(doc, ctx, f, "projection"), { dash: LINE_TYPES.dashed1 });
      B.stroke(p.path, g, "IfcBeam", doc.idOf(f));
      B.stroke([{ k: "L", a: p.axis.start, b: p.axis.end }], { weight: penWeight(doc, "hairline", S), colour: g.colour || "#000", dash: LINE_TYPES.centre }, "IfcBeam", doc.idOf(f));
      B.hit(doc.idOf(f), p.foot);
    }
    if (t === "Column") { const p = doc.plan(f); if (!p) continue; const bnd = band(p.z0, p.z1); if (bnd === "above" || bnd === "below") continue;
      const g = resolveGraphics(doc, ctx, f, bnd === "cut" ? "cut" : "projection", "Common", p.material);
      if (bnd === "cut") { if (g.pattern === "solid") B.fill(p.path, g.fill || "#000", "IfcColumn", doc.idOf(f)); else { B.fill(p.path, g.fill, "IfcColumn", doc.idOf(f)); if (g.pattern) B.hatch(p.path, doc.lib.patterns[g.pattern], g.pattern, g.colour, penWeight(doc, "hairline", S), "IfcColumn", doc.idOf(f)); } }
      B.stroke(p.path, g, "IfcColumn", doc.idOf(f)); B.hit(doc.idOf(f), p.foot.length ? p.foot : samplePath(p.path));
      if (p.material) B.mat.push({ id: doc.idOf(f), material: p.material, poly: p.foot.length ? p.foot : samplePath(p.path) });
    }
    if (t === "Door" || t === "Window") {
      const d = doc.data(f), fr = d && d.frame; const host = fr && doc.element(fr.host), w = host && doc.plan(host);
      if (!w || !doc.plan(f)) continue;
      const cutsHere = fr.sill + w.z0 < cutZ && fr.sill + fr.h + w.z0 > cutZ && band(w.z0, w.z1) === "cut";
      if (!cutsHere) continue;       // below or above the cut: the wall reads solid (§5.1)
      // in a leaning wall the door is drawn where the cut finds it (leaning with the wall, or plumb with its shroud)
      const pieces = d.incline ? d.incline.planAt(cutZ) : doc.plan(f);
      for (const piece of pieces) {
        // ADA maneuvering clearance: red dashed, whatever the style says about the door itself
        if (piece.role === "clearance") { B.stroke(piece.path, { weight: penWeight(doc, "thin", S), colour: "#d0021b", dash: LINE_TYPES.dashed1 }, categoryOf(doc, f) + "-Clearance", doc.idOf(f)); continue; }
        const role = piece.role === "swing" ? "swing" : piece.role === "projection" ? "projection" : "cut";
        const g = resolveGraphics(doc, ctx, f, role, piece.sub);
        B.stroke(piece.path, g, categoryOf(doc, f) + "-" + piece.sub, doc.idOf(f));
      }
      { const wz = leanInvolved(w) ? wallAt(w, Math.max(w.z0, Math.min(w.z1, cutZ))) : w, n_ = wz.stack.s.length - 1;
        B.hit(doc.idOf(f), [pointAt(wz, wz.stack.s[0], fr.u0), pointAt(wz, wz.stack.s[0], fr.u1), pointAt(wz, wz.stack.s[n_], fr.u1), pointAt(wz, wz.stack.s[n_], fr.u0)]); }
    }
    // a bare opening (nothing fills it) is picked by the gap it leaves where the plan cuts it; a filled one
    // is picked through its door or window
    if (t === "Opening") {
      const d = doc.data(f), fr = d && d.frame, host = fr && doc.element(fr.host), w = host && doc.plan(host);
      if (!w || !w.stack || fr.flagged) continue;
      if (doc.elements().some(g => (doc.typeOf(g) === "Door" || doc.typeOf(g) === "Window") && F.refId(g, "fills") === doc.idOf(f))) continue;
      if (!(fr.sill + w.z0 < cutZ && fr.sill + fr.h + w.z0 > cutZ && band(w.z0, w.z1) === "cut")) continue;
      const wz = leanInvolved(w) ? wallAt(w, Math.max(w.z0, Math.min(w.z1, cutZ))) : w, n_ = wz.stack.s.length - 1;
      B.hit(doc.idOf(f), [pointAt(wz, wz.stack.s[0], fr.u0), pointAt(wz, wz.stack.s[0], fr.u1), pointAt(wz, wz.stack.s[n_], fr.u1), pointAt(wz, wz.stack.s[n_], fr.u0)]);
    }
    if (t === "Furniture") {
      const p = doc.plan(f); if (!p) continue; const bnd = band(p.z0, p.z1); if (bnd !== "projection" && bnd !== "cut") continue;
      const g = resolveGraphics(doc, ctx, f, "projection");
      // The family defines a fill; a style may say none (test 26d).
      for (const path of p.paths) { if (!g.fillNone) B.fill(path, g.fill || p.fill, "Furniture", doc.idOf(f)); B.stroke(path, g, "Furniture", doc.idOf(f)); }
      B.hit(doc.idOf(f), samplePath(p.paths[0]));
    }
    if (t === "Grid" && vis(f)) drawGrid(doc, ctx, B, f);
    if (t === "ElevationView" && categoryVisible(ctx, "Annotation")) drawElevationMarker(doc, ctx, B, f, place);
    if (t === "SectionView" && categoryVisible(ctx, "Annotation")) drawSectionMarker(doc, ctx, B, f, place);
    if (t === "RoomSeparator" && F.refId(f, "level") === (lv && doc.idOf(lv))) { const c = F.json(f, "line"); B.stroke([lineSeg(c.start, c.end)], { weight: penWeight(doc, "hairline", S), colour: "#6b7684", dash: LINE_TYPES.dashed2 }, "IfcSpace-Separator", doc.idOf(f)); B.hit(doc.idOf(f), [c.start, c.end], "curve"); }
  }
  // 4. detail and annotation belonging to this view
  for (const f of els) {
    const t = doc.typeOf(f); if (!onlyHere(f)) continue;
    if (t === "DetailLine" && vis(f)) { const c = F.json(f, "curve"); const segs = curveSegs(c); B.stroke(segs, { weight: penWeight(doc, F.choice(f, "pen"), S), colour: F.text(f, "colour") || "#000000", dash: detailDash(f) }, "Detail", doc.idOf(f)); B.hit(doc.idOf(f), samplePath(segs), "curve"); }
    if (t === "FilledRegion" && vis(f)) drawFilledRegion(doc, ctx, B, f);
    if (t === "CADImport" && vis(f)) drawImport(doc, ctx, B, f);
    if (t === "Text" && categoryVisible(ctx, "Annotation")) drawText(doc, ctx, B, f);
    if (t === "SymbolInstance" && categoryVisible(ctx, "Annotation")) drawSymbolInstance(doc, B, f);
    if (t === "RepeatingDetail" && vis(f)) drawRepeating(doc, ctx, B, f);
    if (t === "MaterialTag" && categoryVisible(ctx, "Annotation")) drawMaterialTag(doc, ctx, B, f);
    if (t === "SpotElevation" && categoryVisible(ctx, "Annotation")) drawSpotElevation(doc, ctx, B, f, cutZ);
    if (t === "Dimension" && categoryVisible(ctx, "Annotation") && measureRefs(doc, F.json(f, "of") || []).kind !== "levels") drawDimension(doc, ctx, B, f);
  }
  // a space graph's site on its base level: the boundary (chain), what the setbacks leave (dashed) and the entry
  if (categoryVisible(ctx, "Annotation")) for (const f of doc.elements()) if (doc.typeOf(f) === "SpaceGraph" && lv && F.refId(f, "level") === doc.idOf(lv)) {
    const site = doc.argValue(f, "site") || {}, P = site.boundary || []; if (P.length < 3) continue;
    const id = doc.idOf(f), g = { weight: penWeight(doc, "medium", S), colour: "#2b3a4e", dash: LINE_TYPES.centre };
    B.stroke(polyPath(P), g, "Annotation-Site", id);
    const bA = buildableArea(P, site.setbacks || []); if (bA.length >= 3) B.stroke(polyPath(bA), { weight: penWeight(doc, "thin", S), colour: "#d0312d", dash: LINE_TYPES.dashed1 }, "Annotation-Site", id);
    for (const en of site.entries || []) { const p0 = B.P(en.at), d = normalise(en.dir || [0, 1]), n = [-d[1], d[0]]; B.fill(polyPath([p0, add(p0, add(mul(d, -5), mul(n, 2.2))), add(p0, add(mul(d, -5), mul(n, -2.2)))]), "#1d6fd8", "Annotation-Site", id, true); B.text(add(p0, add(mul(d, -8), [2, 0])), "ENTRY", 2, { layer: "Annotation-Site", id, colour: "#1d6fd8" }); }
    B.hit(id, P, "curve");
  }
  if (categoryVisible(ctx, "Annotation")) drawConstraintGlyphs(doc, ctx, B);
  B.prims.push(...B.later);          // labels sit on top of fills and furniture
  // the sun's hard shadows on this level's ground: one non-zero fill, so overlaps stay one tone
  const sun = sunOf(doc.argValue(v, "sun"));
  if (sun.on) {
    const rings = planShadows(doc, sun, E, { below: sun.cast === "Whole model" ? null : cutZ, visible: vis });
    if (rings.length) B.prims.splice(shadowAt, 0, { t: "fill", path: B.path(rings.flatMap(r => polyPath(r))), colour: sun.colour, opacity: sun.opacity, nonzero: true, layer: "Shadow" });
  }
  const clip = doc.argValue(v, "clip");
  const scene = { prims: B.prims, hits: B.hits, links: B.links, scale: S, kind: "plan", mat: B.mat,
    stats: { walls: stat.walls, offsets: doc.stats.offsets - stat.offsetsBefore } };
  applyCrop(doc, v, clip, scene, S);
  return scene;
}
function curveSegs(c) {
  if (c.type === "line") return [lineSeg(c.start, c.end)];
  if (c.type === "arc") { const a0 = c.start * Math.PI / 180, a1 = c.end * Math.PI / 180; let sw = c.ccw === false ? -(((a0 - a1) % TAU + TAU) % TAU) : (((a1 - a0) % TAU + TAU) % TAU); return [{ k: "A", c: c.centre, r: c.radius, a0, a1: a0 + sw }]; }
  const pts = c.points || []; return pts.slice(1).map((p, i) => lineSeg(pts[i], p));
}

function drawWall(doc, ctx, B, f, w, bnd, cutZ) {
  const id = doc.idOf(f), S = ctx.scale;
  const gc = resolveGraphics(doc, ctx, f, "cut", "Cut");
  if (!gc.visible) return;
  const detail = gc.detailLevel || (ctx.detail === "Medium" ? "Coarse" : ctx.detail);
  if (bnd !== "cut") {
    // projection / beyond: the joined outline, no poché
    const g = resolveGraphics(doc, ctx, f, bnd === "projection" ? "projection" : "beyond", "Common");
    for (const r of wallRegions(w, "Coarse", -Infinity, [])) { for (const e of r.edges) if (e.role !== "weld" && e.role !== "hidden") B.stroke([e.seg], g, "IfcWall", id); B.hit(id, samplePath(r.path)); }
    return;
  }
  let regions, wz = w;
  if (!w.fast && w.curve.type === "line" && w.topSlope) {
    // The general surface path (§3.1): sloped tops and leaning faces cut at the real height.
    regions = [];
    for (const piece of w.pieces || []) {
      const S3 = wallSurfaces(w, w.stack.s[0], w.stack.s[w.stack.s.length - 1],
        plane([...perp(sub(piece.foot[3], piece.foot[0])).map(x => -x), 0], [...piece.foot[0], 0]),
        plane([...perp(sub(piece.foot[2], piece.foot[1])), 0], [...piece.foot[1], 0]));
      if (piece.z0 > cutZ) continue;
      const poly = cutAtHeight(S3, cutZ, doc.stats);
      if (poly.length >= 3) regions.push({ path: polyPath(poly), edges: polyPath(poly).map(seg => ({ seg, role: "face" })), material: coarseMaterial(w), layer: null });
    }
  } else {
    if (w.fast) doc.stats.fastPath++; else doc.stats.surfacePath++;
    // a leaning wall (or one joined to it) is drawn as it is at the cut: its faces moved across, its joins re-solved there
    wz = leanInvolved(w) && Number.isFinite(cutZ) ? wallAt(w, Math.max(w.z0, Math.min(w.z1, cutZ))) : w;
    try { regions = wallRegions(wz, detail, cutZ, w.openings || []); }
    catch (e) { doc.setNote(f, (doc.note(f) ? doc.note(f) + "; " : "") + e.message); regions = []; }
  }
  const gLayer = resolveGraphics(doc, ctx, f, "cut", "Layer");
  for (const r of regions) {
    const g = resolveGraphics(doc, ctx, f, "cut", "Cut", r.material);
    if (g.pattern === "solid") B.fill(r.path, g.fill || "#000000", "IfcWall", id);
    else {
      if (g.fill) B.fill(r.path, g.fill, "IfcWall", id);
      const pat = g.pattern && doc.lib.patterns[g.pattern];
      if (pat) {
        const gp = resolveGraphics(doc, ctx, f, "cutPattern", "Cut", r.material);
        if (pat.batt && r.layer !== null) battLine(doc, B, wz, r, gp, id);
        else B.hatch(r.path, pat, g.pattern, gp.colour, gp.weight, "IfcWall-Pattern", id);
      }
    }
    if (r.material) B.mat.push({ id, material: r.material, poly: samplePath(r.path, 16) });
    for (const e of r.edges) {
      if (e.role === "weld" || e.role === "hidden") continue;
      B.stroke([e.seg], e.role === "layer" ? Object.assign({}, g, { weight: gLayer.weight === "none" ? "none" : gLayer.weight }) : g, "IfcWall", id);
    }
    B.hit(id, samplePath(r.path, 16));
  }
}
/** Batt insulation is a drafting symbol drawn along the layer, sized to it. */
function battLine(doc, B, w, r, g, id) {
  const sA = w.stack.s[r.lo], sB = w.stack.s[r.hi], t = Math.abs(sB - sA), mid = (sA + sB) / 2;
  const pts = samplePath(r.path, 8);
  const us = pts.map(p => uOf(w, p)), u0 = Math.min(...us), u1 = Math.max(...us);
  const path = [], step = t / 2;
  let prev = null;
  for (let u = u0, k = 0; u <= u1 + 1e-6; u += step / 4, k++) {
    const phase = (k % 8) / 8 * TAU;
    const p = pointAt(w, mid + Math.sin(phase) * t * 0.45, Math.min(u, u1));
    if (prev) path.push(lineSeg(prev, p)); prev = p;
  }
  B.stroke(path, { weight: g.weight === "none" ? "none" : penWeight(doc, "hairline", B.S), colour: g.colour }, "IfcWall-Pattern", id);
}

function drawSpace(doc, ctx, B, f) {
  const plan = doc.plan(f), id = doc.idOf(f);
  const cs = (ctx.style.byCategory || {}).IfcSpace || {};
  let fill = cs.fill && cs.fill !== "none" ? cs.fill : null;
  for (const rule of ctx.rules) { if (rule.then && rule.then.fill && ruleMatch(doc, f, rule)) { fill = rule.then.fill; if (rule.stop) break; } }
  const colourBy = ctx.view && doc.argValue(ctx.view, "overrides") && doc.argValue(ctx.view, "overrides").__colourFill;
  if (colourBy) { const v = String(paramText(doc, f, colourBy) || ""); if (v) fill = departmentColour(v); }
  const anchor = F.point(f, "anchor");
  if (plan && plan.loop) {
    const path = polyPath(plan.loop.pts).concat(...(plan.loop.holes || []).map(h => polyPath(h)));
    if (fill) B.fill(path, fill, "IfcSpace", id);
    B.hit(id, plan.loop.pts);
  }
  const label = cs.label || { height: 2.5, colour: "#000000", content: "{Name}\n{Area}" };
  const lines = label.content.split("\n").map(line => line.replace(/\{(\w+)\}/g, (_, k) => paramText(doc, f, k)));
  const at = B.P(anchor);
  lines.forEach((ln, i) => B.later.push(Object.assign({ t: "text", at: [at[0], at[1] - i * label.height * 1.6], text: label.upper ? String(ln).toUpperCase() : String(ln), height: label.height, rot: 0, align: "centre", valign: "baseline", colour: label.colour || "#000", layer: "IfcSpace-Label", id }, label.font ? { font: label.font } : {})));
  if (!plan || plan.status !== "ok") B.text([at[0], at[1] + label.height * 1.6], plan && plan.status === "redundant" ? "⚠ redundant" : "⚠ not enclosed", label.height * 0.8, { align: "centre", colour: "#b3261e", layer: "IfcSpace-Label", id });
  B.hit(id, [add(anchor, [-600, -600]), add(anchor, [600, -600]), add(anchor, [600, 600]), add(anchor, [-600, 600])]);
}
/** A detail line's line style: solid, or Revit's hidden (short dashes) or centre line. */
const detailDash = f => ({ Hidden: LINE_TYPES.hidden, Centre: LINE_TYPES.centre })[F.choice(f, "lineStyle")] || null;
/** A stair in plan, as Revit draws it: its treads and sides up to the cut, a break line where the cut crosses a
 *  flight and what lies above it dashed; the walking line with its arrow and UP (DN in a plan above it), and each
 *  riser numbered. In a plan wholly above the stair it is all seen, thin. */
function drawStairPlan(doc, ctx, B, f, p, V) {
  const S = p.stair, id = doc.idOf(f), cat = "IfcStair";
  if (S.z0 > V.topZ + 1 || S.z1 < V.E - 4000) return;
  const below = S.z1 <= V.cutZ + 1, gCut = resolveGraphics(doc, ctx, f, "projection"), gT = { weight: penWeight(doc, "thin", ctx.scale), colour: gCut.colour || "#000" };
  const gH = Object.assign({}, gT, { dash: LINE_TYPES.hidden }), num = F.bool(f, "numbers") !== false;
  const at = (q, s, side) => add(add(q.from, mul(q.d, s)), mul(q.n, side * S.W / 2));
  let broke = false;
  for (const q of S.flights) {
    // where the cut plane passes through this flight: a riser whose step rises past it
    let kCut = below ? Infinity : q.steps.findIndex(st => st.z > V.cutZ + 1); if (kCut < 0) kCut = Infinity;
    const sCut = kCut === Infinity ? Infinity : q.steps[kCut].s - (kCut > 0 ? 0 : 0);
    const solid = [], dashed = [];
    q.steps.forEach((st, i) => (i < kCut ? solid : dashed).push(lineSeg(at(q, st.s, 1), at(q, st.s, -1))));
    const sEnd = q.steps[q.steps.length - 1].s;
    for (const side of [1, -1]) {
      if (sCut === Infinity) solid.push(lineSeg(at(q, 0, side), at(q, sEnd, side)));
      else { if (sCut > 0) solid.push(lineSeg(at(q, 0, side), at(q, sCut, side))); dashed.push(lineSeg(at(q, sCut, side), at(q, sEnd, side))); }
    }
    B.stroke(solid, gT, cat, id); if (dashed.length) B.stroke(dashed, gH, cat, id);
    if (sCut !== Infinity && !broke) {
      // the break line: across the flight on a slant with a zig at its middle, a little before the cut riser
      const s0 = Math.max(0, sCut - q.g * 0.5), a = at(q, s0 - q.g * 0.4, 1), b = at(q, s0 + q.g * 0.4, -1), m = add(mul(add(a, b), 0.5), [0, 0]), z = mul(q.d, q.g * 0.3);
      B.stroke([lineSeg(a, add(m, z)), lineSeg(add(m, z), sub(m, z)), lineSeg(sub(m, z), b)], { weight: penWeight(doc, "medium", ctx.scale), colour: "#000" }, cat, id); broke = true;
    }
    if (num) q.steps.forEach((st, i) => { if (i === q.steps.length - 1) return; const c = add(q.from, mul(q.d, (st.s + q.steps[i + 1].s) / 2)), off = add(c, mul(q.n, -S.W * 0.28));
      B.text(B.P(off), String(st.no), 1.8, { align: "centre", valign: "middle", layer: "Annotation-Text", id, rot: 0 }); });
  }
  for (const l of S.landings) B.stroke(polyPath(l.poly), below || l.z <= V.cutZ ? gT : gH, cat, id);
  // the walking line, from the first riser to the last, its arrow at the top
  const up = S.z0 >= V.E - 1, pts = [];
  S.flights.forEach(q => { pts.push(q.from); pts.push(q.to); });
  const path = up ? pts : pts.slice().reverse();
  const segs = []; for (let i = 0; i + 1 < path.length; i++) if (Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]) > 1) segs.push(lineSeg(path[i], path[i + 1]));
  B.stroke(segs, gT, cat, id);
  const e = path[path.length - 1], e0 = path[path.length - 2] || path[0], d = normalise(sub(e, e0)), n = perp(d), hs = 2 * ctx.scale;
  B.stroke(polyPath([e, add(sub(e, mul(d, hs)), mul(n, hs * 0.45)), add(sub(e, mul(d, hs)), mul(n, -hs * 0.45))]), gT, cat, id);
  B.fill(polyPath([e, add(sub(e, mul(d, hs)), mul(n, hs * 0.45)), add(sub(e, mul(d, hs)), mul(n, -hs * 0.45))]), "#000", cat, id);
  const s0 = path[0], d0 = normalise(sub(path[1] || e, s0));
  B.text(B.P(sub(s0, mul(d0, 1.5 * ctx.scale))), up ? "UP" : "DN", 2.2, { align: "centre", valign: "middle", layer: "Annotation-Text", id });
  B.hit(id, p.foot);
}
/** The ground in plan, as a survey draws it: contour lines at the surface's interval, every nth heavier and
 *  labelled with its height, the surface's edge dashed. */
function drawTopoPlan(doc, ctx, B, f, p) {
  const id = doc.idOf(f), gp = resolveGraphics(doc, ctx, f, "projection"), iv = Math.max(10, F.real(f, "interval") || 500), mj = Math.max(1, F.int(f, "major") || 5);
  const P = p.mesh.positions, I = p.mesh.index, minor = [], major = [], majSegs = new Map();
  // the grade runs under the building: contours stop at the floors' footprints, as a site plan draws them
  const bld = [];
  for (const g of doc.elements()) if (doc.typeOf(g) === "Floor") { const q = doc.plan(g); if (q && Array.isArray(q.foot) && q.foot.length > 2 && Array.isArray(q.foot[0])) bld.push(q.foot); }
  const under = (a, b) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return bld.some(poly => pointInPoly(m, poly)); };
  for (let k = 0; k < I.length; k += 3) {
    const q = [0, 1, 2].map(e => { const a = I[k + e] * 3; return [P[a], P[a + 1], P[a + 2]]; });
    const nz = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]);
    if (nz <= 1e-6 || Math.min(q[0][2], q[1][2], q[2][2]) <= p.z0 + 1) continue;
    const zl = Math.min(q[0][2], q[1][2], q[2][2]), zh = Math.max(q[0][2], q[1][2], q[2][2]);
    for (let z = Math.ceil((zl - 1e-6) / iv) * iv; z <= zh + 1e-6; z += iv) {
      const pts = [];
      for (let i = 0; i < 3; i++) { const a = q[i], b = q[(i + 1) % 3], da = a[2] - z, db = b[2] - z; if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) { const t = da / (da - db); pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } }
      if (pts.length !== 2 || under(pts[0], pts[1])) continue;
      const isMaj = Math.round(z / iv) % mj === 0;
      (isMaj ? major : minor).push(lineSeg(pts[0], pts[1]));
      if (isMaj) { const key = Math.round(z); if (!majSegs.has(key)) majSegs.set(key, []); majSegs.get(key).push(pts); }
    }
  }
  const col = gp.colour && gp.colour !== "#000000" ? gp.colour : "#000";
  if (minor.length) B.stroke(minor, { weight: penWeight(doc, "hairline", ctx.scale), colour: col }, "Topography", id);
  if (major.length) B.stroke(major, { weight: penWeight(doc, "thin", ctx.scale), colour: col }, "Topography", id);
  if (F.bool(f, "labels") !== false) for (const [z, segs] of majSegs) {
    // the label on the longest piece of the contour, turned to read along it
    const s = segs.reduce((m, q) => (Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) > Math.hypot(m[1][0] - m[0][0], m[1][1] - m[0][1]) ? q : m), segs[0]);
    let a = Math.atan2(s[1][1] - s[0][1], s[1][0] - s[0][0]) * 180 / Math.PI; if (a > 90) a -= 180; if (a < -90) a += 180;
    B.text(B.P(mul(add(s[0], s[1]), 0.5)), fmtLevel(doc, z), 1.8, { align: "centre", valign: "middle", rot: a, layer: "Annotation-Text", id, colour: col });
  }
  B.stroke(p.path, { weight: penWeight(doc, "thin", ctx.scale), colour: col, dash: LINE_TYPES.dashed2 }, "Topography", id); B.hit(id, p.foot);
}
/** A railing in plan: its rail as two lines the post's width apart, the posts as small squares. */
function drawRailingPlan(doc, ctx, B, f, p) {
  const id = doc.idOf(f), S = ctx.scale, g = resolveGraphics(doc, ctx, f, "projection"), col = g.colour && g.colour !== "#000000" ? g.colour : "#000";
  const { pts, postSize: ps, postSpacing: sp } = p.railing, segs = [], posts = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], d = sub(b, a), L = Math.hypot(d[0], d[1]); if (L < 1) continue; const n = mul(perp(mul(d, 1 / L)), ps * 0.3);
    segs.push(lineSeg(add(a, n), add(b, n)), lineSeg(sub(a, n), sub(b, n)));
    const m = Math.max(1, Math.round(L / sp)); for (let k = i ? 1 : 0; k <= m; k++) { const c = add(a, mul(d, k / m)), h = ps / 2; posts.push(polyPath([[c[0] - h, c[1] - h], [c[0] + h, c[1] - h], [c[0] + h, c[1] + h], [c[0] - h, c[1] + h]])); }
  }
  B.stroke(segs, { weight: penWeight(doc, "thin", S), colour: col }, "IfcRailing", id);
  B.stroke(posts.flat(), { weight: penWeight(doc, "hairline", S), colour: col }, "IfcRailing", id);
  for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], d = sub(b, a), L = Math.hypot(d[0], d[1]); if (L < 1) continue; const n = mul(perp(mul(d, 1 / L)), Math.max(ps, 150)); B.hit(id, [add(a, n), add(b, n), sub(b, n), sub(a, n)]); }
}
/** A ramp in plan: its edges, the landings, the walking line with its arrow to the head, UP at the foot and the slope. */
function drawRampPlan(doc, ctx, B, f, p) {
  const id = doc.idOf(f), S = ctx.scale, R = p.ramp, g = resolveGraphics(doc, ctx, f, "projection"), col = g.colour && g.colour !== "#000000" ? g.colour : "#000", w = penWeight(doc, "thin", S);
  const up = R.z1 >= R.z0, font = annotationStyle(doc).font || undefined;
  for (const q of R.runs) {
    const e = s => [add(q.from, mul(q.n, s * R.W / 2)), add(q.to, mul(q.n, s * R.W / 2))];
    B.stroke([lineSeg(...e(1)), lineSeg(...e(-1)), lineSeg(e(1)[0], e(-1)[0]), lineSeg(e(1)[1], e(-1)[1])], { weight: w, colour: col }, "IfcRamp", id);
  }
  for (const l of R.landings) B.stroke(polyPath(l.poly), { weight: w, colour: col }, "IfcRamp", id);
  // the walking line through the runs, its arrow at the head; UP (or DN) at the foot and the slope at the middle
  const wl = R.runs.flatMap((q, i) => [lineSeg(q.from, q.to), ...(i + 1 < R.runs.length ? [lineSeg(q.to, R.runs[i + 1].from)] : [])]);
  B.stroke(wl, { weight: penWeight(doc, "hairline", S), colour: col }, "IfcRamp", id);
  const last = R.runs[R.runs.length - 1], tip = last.to, ah = 2.2 * S, bk = sub(tip, mul(last.d, ah));
  B.fill(polyPath([tip, add(bk, mul(last.n, ah * 0.35)), sub(bk, mul(last.n, ah * 0.35))]), col, "IfcRamp", id);
  const q0 = R.runs[0], lab = sub(q0.from, mul(q0.d, 2.5 * S)), ang = a => { let r = Math.atan2(a[1], a[0]) * 180 / Math.PI; if (r > 90) r -= 180; if (r < -90) r += 180; return r; };
  B.text(B.P(lab), up ? "UP" : "DN", 1.8, { align: "centre", valign: "middle", layer: "Annotation-Text", id, font, colour: col });
  if (R.slope > 1e-6) { const m = add(q0.from, mul(q0.d, q0.L / 2)); B.text(B.P(add(m, mul(q0.n, 1.6 * S))), `1:${Math.round(1 / R.slope)}`, 1.8, { align: "centre", valign: "middle", rot: ang(q0.d), layer: "Annotation-Text", id, font, colour: col }); }
  B.hit(id, p.foot);
}
/** A tree in plan as a landscape drawing has it: the canopy's outline, branches out from the trunk, the trunk
 *  (a conifer's canopy a star of needles, a shrub's a scalloped cloud). Seeded by its id so it never flickers. */
function drawPlantingPlan(doc, ctx, B, f, p) {
  const id = doc.idOf(f), { c, R, rt, form } = p.planting, S = ctx.scale, g = resolveGraphics(doc, ctx, f, "projection");
  const col = g.colour && g.colour !== "#000000" ? g.colour : "#000", thin = penWeight(doc, "thin", S), hair = penWeight(doc, "hairline", S);
  let seed = 0; for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const at = (r, a) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], N = 48, rim = [];
  if (form === "Conifer") for (let i = 0; i < 40; i++) rim.push(at(R * (i % 2 ? 0.94 : 1), i / 40 * TAU));
  else if (form === "Shrub") for (let i = 0; i < N; i++) rim.push(at(R * (0.9 + 0.1 * Math.abs(Math.sin(i / N * TAU * 5))), i / N * TAU));
  else for (let i = 0; i < N; i++) rim.push(at(R, i / N * TAU));
  B.stroke(polyPath(rim), { weight: thin, colour: col }, "Planting", id);
  if (form !== "Shrub") {
    const br = [], nb = form === "Conifer" ? 16 : 7 + Math.floor(rnd() * 3);
    for (let i = 0; i < nb; i++) { const a = (i + rnd() * 0.5) / nb * TAU, r1 = R * (form === "Conifer" ? 0.8 : 0.55 + 0.4 * rnd()); br.push(lineSeg(at(rt, a), at(r1, a)));
      if (form !== "Conifer") { const m = at(r1 * 0.55, a), k = a + (rnd() > 0.5 ? 0.5 : -0.5); br.push(lineSeg(m, [m[0] + r1 * 0.3 * Math.cos(k), m[1] + r1 * 0.3 * Math.sin(k)])); } }
    B.stroke(br, { weight: hair, colour: col }, "Planting", id);
    const tk = []; for (let i = 0; i < 16; i++) tk.push(at(Math.max(rt, 40 * S / 50), i / 16 * TAU));
    B.fill(polyPath(tk), col, "Planting", id);
  }
  B.hit(id, rim);
}
/** A height as the project writes it: millimetres, or feet and inches in an imperial project. */
function fmtLevel(doc, z) {
  // on the survey's datum when the project has one (the height of the model's zero): metres, or feet
  const u = doc.meta && doc.meta.displayUnits, sd = doc.meta && doc.meta.surveyElevation;
  if (sd != null) { const a = z + sd; return isImperial(u) ? `${Math.round(a / 304.8 * 10) / 10}'` : (a / 1000).toFixed(2); }
  return isImperial(u) ? fmtLength(z, { unit: u }) : String(Math.round(z));
}
function ruleMatch(doc, f, rule) { try { return matches(doc, f, rule.when); } catch (e) { return false; } }
const DEPT = ["#dce9f7", "#f8e3cf", "#dff1e2", "#f3dcec", "#fff2c4", "#e4e0f7", "#d8f0f0"];
export function departmentColour(v) { let h = 0; for (const c of v) h = (h * 31 + c.charCodeAt(0)) >>> 0; return DEPT[h % DEPT.length]; }

function drawGrid(doc, ctx, B, f) {
  const c = F.json(f, "line"), id = doc.idOf(f), S = ctx.scale;
  const g = resolveGraphics(doc, ctx, f, "projection"), AS = annotationStyle(doc);
  const endL = AS.gridEnd * S, Lg = dist(c.start, c.end);
  if (endL > 0 && Lg > 2 * endL) {
    // Revit's grid: solid at each end (where the heads are read), the middle dashed in its own colour
    const dd = normalise(sub(c.end, c.start)), e0 = add(c.start, mul(dd, endL)), e1 = sub(c.end, mul(dd, endL));
    B.stroke([lineSeg(c.start, e0), lineSeg(e1, c.end)], Object.assign({}, g, { dash: null }), "IfcGrid", id);
    B.stroke([lineSeg(e0, e1)], Object.assign({}, g, { dash: LINE_TYPES.centre, colour: AS.gridCentreColour || g.colour }), "IfcGrid", id);
  } else B.stroke([lineSeg(c.start, c.end)], Object.assign({}, g, { dash: LINE_TYPES.centre }), "IfcGrid", id);
  // Paper-space heads: the head size and text size are paper millimetres, the same on the sheet at every scale.
  const d = normalise(sub(c.end, c.start)), ends = F.choice(f, "ends") || "Both ends";
  for (const [p, sgn, which] of [[c.start, -1, "Start"], [c.end, 1, "End"]]) {
    if (ends === "None" || (ends !== "Both ends" && ends !== which)) continue;
    gridHead(doc, B, f, B.P(p), mul(d, sgn), g, id);
  }
  B.hit(id, [c.start, c.end], "curve");
}
/** The project's annotation style: how its datums and markers are drawn - the drafting office's standard.
 *  "classic" is this app's own; "revit" draws as Revit's defaults do (flag heads on sections and elevations,
 *  a section's head at one end and a tail at the other, level heads at the left with a hollow triangle and
 *  the height in mm, grid lines solid at their ends and coloured between). Sizes are paper mm, text sizes
 *  cap heights; `font` is any text font. */
export function annotationStyle(doc) {
  return Object.assign({ kind: "classic", font: null, gridHead: 8, gridText: 2.5, gridEnd: 0, gridCentreColour: null,
    markerRadius: 4.5, markerText: 2.0, markerSheetText: 1.6, levelText: 2.5, levelValueText: 2.0, levelHeads: "Right", segmentedSections: false },
    (doc.meta && doc.meta.annotation) || {});
}
/** A grid's head at the end of its line (`at`, paper), pushed out along `out`: its shape or loaded symbol, its label. */
export function gridHead(doc, B, f, at, out, g, id) {
  const size = F.real(f, "headSize") || 8, r = size / 2, ts = F.real(f, "textSize") || 2.5, shape = F.choice(f, "head") || "Circle";
  const cp = add(at, mul(out, r)), st = { weight: g.weight, colour: g.colour };
  const poly = (n, rot) => polyPath(Array.from({ length: n }, (_, i) => { const a = rot + i * 2 * Math.PI / n; return [cp[0] + r * Math.cos(a), cp[1] + r * Math.sin(a)]; }));
  if (shape === "Circle") B.stroke(circlePath(cp, r), st, "IfcGrid", id, true);
  else if (shape === "Double circle") { B.stroke(circlePath(cp, r), st, "IfcGrid", id, true); B.stroke(circlePath(cp, r * 0.82), st, "IfcGrid", id, true); }
  else if (shape === "Hexagon") B.stroke(poly(6, 0), st, "IfcGrid", id, true);
  else if (shape === "Square") B.stroke(poly(4, Math.PI / 4), st, "IfcGrid", id, true);
  else if (shape === "Diamond") B.stroke(poly(4, 0), st, "IfcGrid", id, true);
  else if (shape === "Triangle") B.stroke(poly(3, Math.atan2(out[1], out[0])), st, "IfcGrid", id, true);
  else if (shape === "Symbol") {
    const sym = doc.lib.symbols[F.refId(f, "headSymbol")];
    if (sym && sym.source) drawSymbol(doc, B, Object.assign({}, sym, { nominalSize: { w: size, h: size } }), cp, 0, "IfcGrid", id);
    else B.stroke(circlePath(cp, r), st, "IfcGrid", id, true);
  }
  B.text([cp[0], cp[1] - ts / 2], F.text(f, "name"), ts, { align: "centre", layer: "IfcGrid", id, font: annotationStyle(doc).font || undefined });
}
/** A section line in plan: a chain line with a head at each end, the arrows pointing the way it looks. */
function drawSectionMarker(doc, ctx, B, f, place) {
  const id = doc.idOf(f), S = ctx.scale;
  // a view may draw the marker's ends elsewhere along the line (Revit's per-view section extents)
  const ov = ctx.overrides && ctx.overrides[id], c = (ov && ov.markerLine) || F.json(f, "line");
  const d = normalise(sub(c.end, c.start)), look = mul(perp(d), -1);
  const AS = annotationStyle(doc);
  if (AS.kind === "revit") return drawSectionFlag(doc, ctx, B, f, place, c, d, look, AS);
  B.stroke([lineSeg(c.start, c.end)], { weight: penWeight(doc, "medium", S), colour: "#000000", dash: LINE_TYPES.centre }, "Annotation-Marker", id);
  const pl = place.get(id), r = 4.5;
  for (const [end, sgn] of [[c.start, -1], [c.end, 1]]) {
    const p = add(B.P(end), mul(d, sgn * r)), tip = add(p, mul(look, r * 1.7));
    B.stroke(circlePath(p, r), { weight: penWeight(doc, "medium", S), colour: "#000" }, "Annotation-Marker", id, true);
    B.fill(polyPath([add(p, mul(d, -r)), tip, add(p, mul(d, r))]), "#000000", "Annotation-Marker", id, true);
    B.stroke([lineSeg(add(p, [-r * 0.8, 0]), add(p, [r * 0.8, 0]))], { weight: penWeight(doc, "thin", S), colour: "#000" }, "Annotation-Marker", id, true);
    B.text([p[0], p[1] + 0.9], pl ? String(pl.vp) : "—", 2.0, { align: "centre", layer: "Annotation-Marker", id });
    B.text([p[0], p[1] - 2.9], pl ? pl.number : "", 1.6, { align: "centre", layer: "Annotation-Marker", id });
  }
  B.hit(id, [c.start, c.end], "curve");
}
/** Revit's flag head: a circle with the view's number over its sheet's, and a black flag on the side the
 *  view looks to. A section shows its head at one end (or both) and a heavy tail at the other; between them
 *  the line is left out where it crosses the drawing, only a short stub runs from each end. */
function flagHead(B, at, look, AS, top, bottom, id, withNumberOutside = null) {
  const R = AS.markerRadius, up = perp(look), K = 1.41 * R, font = AS.font || undefined;
  B.fill(polyPath([add(at, mul(up, K)), add(at, mul(look, K)), add(at, mul(up, -K))]), "#000000", "Annotation-Marker", id, true);
  B.fill(circlePath(at, R), "#ffffff", "Annotation-Marker", id, true);
  B.stroke(circlePath(at, R), { weight: 0.085, colour: "#000" }, "Annotation-Marker", id, true);
  const h = AS.markerText;
  if (bottom != null && top != null) {
    B.text([at[0], at[1] + 0.35], top, h, { align: "centre", layer: "Annotation-Marker", id, font, marker: "top" });
    B.text([at[0], at[1] - h - 0.55], bottom, h, { align: "centre", layer: "Annotation-Marker", id, font, marker: "bottom" });
  } else B.text([at[0], at[1] - h / 2], top ?? bottom ?? "", h, { align: "centre", layer: "Annotation-Marker", id, font });
  if (withNumberOutside != null) B.text(add(at, add(mul(look, K + 1.4), [0, -h / 2])), withNumberOutside, h, { align: "left", layer: "Annotation-Marker", id, font });
}
function drawSectionFlag(doc, ctx, B, f, place, c, d, look, AS) {
  const id = doc.idOf(f), pl = place.get(id), heads = F.choice(f, "heads") || "Both ends";
  const vpNo = pl ? String(pl.vp) : "—", sheetNo = pl ? pl.number : "";
  const g = { weight: 0.085, colour: "#000" }, stub = 5.6, R = AS.markerRadius;
  for (const [end, sgn, which] of [[c.start, -1, "Start"], [c.end, 1, "End"]]) {
    const P = B.P(end), head = heads === "Both ends" || heads === which;
    if (head) {
      // the head beyond the line's end; a stub back from the circle toward the building
      const at = add(P, mul(d, sgn * R));
      B.stroke([lineSeg(P, add(P, mul(d, -sgn * stub)))], g, "Annotation-Marker", id, true);
      flagHead(B, at, look, AS, vpNo, sheetNo, id);
      if (pl) B.links.push({ t: "link", rect: [at[0] - R, at[1] - R, 2 * R, 2 * R], sheet: pl.sheet, layer: "Annotation-Marker", id });
    } else {
      // the tail: a filled bar (9 x 2) from the line's end toward the side the section looks at, and the stub
      // back toward the building from its edge
      const a0 = add(P, mul(d, -1)), a1 = add(P, mul(d, 1));
      B.fill(polyPath([a0, a1, add(a1, mul(look, 9)), add(a0, mul(look, 9))]), "#000000", "Annotation-Marker", id, true);
      const e = add(P, mul(d, -sgn * 1));
      B.stroke([lineSeg(e, add(e, mul(d, -sgn * stub)))], g, "Annotation-Marker", id, true);
    }
  }
  B.hit(id, [c.start, c.end], "curve");
}
function drawElevationMarker(doc, ctx, B, f, place) {
  const c = F.json(f, "line"), id = doc.idOf(f), S = ctx.scale;
  const d = normalise(sub(c.end, c.start)), look = mul(perp(d), -1);
  const AS = annotationStyle(doc);
  if (AS.kind === "revit") {
    // Revit's elevation tag: the sheet in the circle, the flag toward the building, the view's number beyond it
    const pl = place.get(id), at = B.P(lerp(c.start, c.end, 0.5));
    flagHead(B, at, look, AS, pl ? pl.number : "—", null, id, pl ? String(pl.vp) : "");
    if (pl) B.links.push({ t: "link", rect: [at[0] - AS.markerRadius, at[1] - AS.markerRadius, 2 * AS.markerRadius, 2 * AS.markerRadius], sheet: pl.sheet, layer: "Annotation-Marker", id });
    B.hit(id, [c.start, c.end], "curve");
    return;
  }
  const g = { weight: penWeight(doc, "medium", S), colour: "#000000" };
  B.stroke([lineSeg(c.start, c.end)], { weight: penWeight(doc, "hairline", S), colour: "#000000", dash: LINE_TYPES.dashed2 }, "Annotation-Marker", id);
  const m = B.P(lerp(c.start, c.end, 0.5)), r = 5;
  const bubble = add(m, mul(look, -r * 0.3));
  B.stroke(circlePath(bubble, r), g, "Annotation-Marker", id, true);
  const tip = add(bubble, mul(look, r * 1.9)), l1 = add(bubble, mul(d, r * 0.95)), l2 = add(bubble, mul(d, -r * 0.95));
  B.fill(polyPath([l1, tip, l2]), "#000000", "Annotation-Marker", id, true);
  const pl = place.get(id);
  const labelTop = pl ? String(pl.vp) : "—", labelBot = pl ? pl.number : "";
  B.stroke([lineSeg(add(bubble, [-r * 0.8, 0]), add(bubble, [r * 0.8, 0]))], { weight: penWeight(doc, "thin", S), colour: "#000" }, "Annotation-Marker", id, true);
  B.text([bubble[0], bubble[1] + 1.1], labelTop, 2.2, { align: "centre", layer: "Annotation-Marker", id, marker: "top" });
  B.text([bubble[0], bubble[1] - 3.1], labelBot, 1.8, { align: "centre", layer: "Annotation-Marker", id, marker: "bottom" });
  if (pl) B.links.push({ t: "link", rect: [bubble[0] - r, bubble[1] - r, 2 * r, 2 * r], sheet: pl.sheet, layer: "Annotation-Marker", id });
  B.hit(id, [c.start, c.end], "curve");
}
function drawText(doc, ctx, B, f) {
  const id = doc.idOf(f), tt = doc.lib.textTypes[F.refId(f, "textType")] || { height: 2.5, colour: "#000", pen: "thin" };
  let content = F.text(f, "content");
  if (content.startsWith("=")) { try { const v = evaluate(parse(content.slice(1)), { lookup: textLookup(doc, f), into: "Text" }); content = formatValue(v); } catch (e) { content = "⚠ " + e.message; } }
  const h = tt.height, font = tt.font && tt.font !== "Sans" ? tt.font : undefined, wf = tt.widthFactor || 1;
  const lines = wrapText(content, h, F.real(f, "wrapWidth"), font);
  const at = B.P(F.point(f, "position")), lh = h * (tt.lineSpacing || 1.6), rot = F.real(f, "rotation") || 0, rr = rot * Math.PI / 180;
  const width = Math.max(...lines.map(l => textWidth(l, h, font, wf)));
  // Revit's opaque background: the paper white behind the words, masking what is drawn under them
  if (tt.background === "opaque") {
    const al = F.choice(f, "align") || "left", x0 = al === "centre" ? -width / 2 : al === "right" ? -width : 0, pad = h * 0.25;
    const q = [[x0 - pad, -h * 0.3 - (lines.length - 1) * lh], [x0 + width + pad, -h * 0.3 - (lines.length - 1) * lh], [x0 + width + pad, h * 1.3], [x0 - pad, h * 1.3]];
    const c = Math.cos(rr), sn = Math.sin(rr);
    B.fill(polyPath(q.map(([x, y]) => [at[0] + x * c - y * sn, at[1] + x * sn + y * c])), "#ffffff", "Annotation-Text", id, true);
  }
  // lines step down across the text's own direction, so rotated text stays a paragraph
  lines.forEach((ln, i) => B.text([at[0] + Math.sin(rr) * i * lh, at[1] - Math.cos(rr) * i * lh], ln, h, { layer: "Annotation-Text", id, colour: tt.colour, rot, font, widthFactor: wf !== 1 ? wf : undefined, align: F.choice(f, "align") || "left" }));
  const midY = at[1] - (lines.length - 1) * lh / 2 + h / 2;
  const g = { weight: penWeight(doc, "hairline", ctx.scale), colour: "#000" };
  for (const L of F.json(f, "leaders") || []) {
    const anchor = L.side === "right" ? [at[0] + width + 1, midY] : [at[0] - 1, midY];
    const pts = [anchor]; if (L.elbow) pts.push(B.P(L.elbow)); pts.push(B.P(L.target));
    B.stroke(polyPath(pts, false), g, "Annotation-Leader", id, true);
    B.fill(circlePath(pts[pts.length - 1], 0.6), "#000000", "Annotation-Leader", id, true);
  }
  const m = F.point(f, "position");
  B.hit(id, [add(m, [0, -lines.length * lh * ctx.scale + h * ctx.scale]), add(m, [width * ctx.scale, -lines.length * lh * ctx.scale + h * ctx.scale]), add(m, [width * ctx.scale, h * ctx.scale]), add(m, [0, h * ctx.scale])]);
}
function textLookup(doc, f) { return name => { const g = doc.element(name.split(".")[0]); if (g && name.includes(".")) return propertyOf(doc, g, name.split(".").slice(1).join(".")); return undefined; }; }

/** Symbols: a paper symbol keeps its nominal size on the sheet; its DXF is read
 *  through the ordinary importer and scaled nominal / measured (§8.2). */
const SYMBOL_CACHE = new Map();
export function symbolGeometry(sym) {
  if (!sym || !sym.source) return null;
  const k = JSON.stringify(sym);
  if (SYMBOL_CACHE.has(k)) return SYMBOL_CACHE.get(k);
  // a symbol drawn as polylines (entourage lifted from a drawing: people, cars, trees), in its own units -
  // model mm for a model symbol - with its insertion point at (0, 0): the feet of a person, the wheels of a car
  if (sym.source.polylines) {
    const P = sym.source.polylines, xs = P.flat().map(q => q[0]), ys = P.flat().map(q => q[1]);
    const closed = pl => pl.length > 3 && Math.hypot(pl[0][0] - pl[pl.length - 1][0], pl[0][1] - pl[pl.length - 1][1]) < 1e-6;
    const r = { paths: P.map(pl => ({ path: pl.slice(1).map((q, i) => ({ k: "L", a: pl[i], b: q })), closed: closed(pl) })), fills: [], texts: [], bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    const out = { r, scale: 1, bbox: r.bbox, origin: [0, 0], measured: { w: r.bbox[2] - r.bbox[0], h: r.bbox[3] - r.bbox[1] } };
    SYMBOL_CACHE.set(k, out);
    return out;
  }
  const text = sym.source.dxf === "inline:NORTH_DXF" ? NORTH_DXF : sym.source.text || "";
  const r = readDXF(text);
  const bb = r.bbox, w = bb[2] - bb[0], h = bb[3] - bb[1];
  const sc = Math.min(sym.nominalSize.w / w, sym.nominalSize.h / h);
  const out = { r, scale: sc, bbox: bb, measured: { w, h }, manifest: r.message };
  SYMBOL_CACHE.set(k, out);
  return out;
}
/** A symbol at a paper point. A paper symbol keeps its size on the sheet; a model symbol (entourage: a
 *  person 1.7 m tall) is sized in model mm and scales with the view. Returns its outline on paper. */
export function drawSymbol(doc, B, sym, atPaper, rotDeg = 0, layer = "Annotation", id = null) {
  const geo = symbolGeometry(sym); if (!geo) return null;
  const model = sym.space === "model", o = geo.origin;
  const cx = o ? o[0] : (geo.bbox[0] + geo.bbox[2]) / 2, cy = o ? o[1] : (geo.bbox[1] + geo.bbox[3]) / 2, k = geo.scale * (model ? 1 / (B.S || 1) : 1), a = rotDeg * Math.PI / 180;
  const T = p => { const x = (p[0] - cx) * k, y = (p[1] - cy) * k; return [atPaper[0] + x * Math.cos(a) - y * Math.sin(a), atPaper[1] + x * Math.sin(a) + y * Math.cos(a)]; };
  const tp = path => path.map(s => s.k === "L" ? { k: "L", a: T(s.a), b: T(s.b) } : s.k === "A" ? { k: "A", c: T(s.c), r: s.r * k, a0: s.a0 + a, a1: s.a1 + a } : { k: "C", a: T(s.a), c1: T(s.c1), c2: T(s.c2), b: T(s.b) });
  for (const p of geo.r.fills) B.prims.push({ t: "fill", path: tp(p.path), colour: "#000000", layer, id });
  // a silhouette is white inside, so it stands in front of the facade behind it
  if (sym.fill) for (const p of geo.r.paths) if (p.closed) B.prims.push({ t: "fill", path: tp(p.path), colour: sym.fill, layer, id });
  const weight = sym.weight || 0.25, colour = sym.colour || "#000000";
  for (const p of geo.r.paths) B.prims.push({ t: "stroke", path: tp(p.path), weight, colour, layer, id });
  for (const t of geo.r.texts) B.prims.push({ t: "text", at: T(t.at), text: t.text, height: t.height * k, rot: rotDeg, align: "centre", valign: "baseline", colour: "#000", layer, id });
  const bb = geo.bbox; return [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(T);
}
/** A placed symbol, in a plan or an elevation or a section: drawn, and picked by its outline. */
function drawSymbolInstance(doc, B, f) {
  const sym = doc.lib.symbols[F.refId(f, "symbol")]; if (!sym) return;
  const box = drawSymbol(doc, B, sym, B.P(F.point(f, "position")), F.real(f, "rotation"), sym.space === "model" ? "Entourage" : "Annotation", doc.idOf(f));
  if (box) B.hit(doc.idOf(f), box.map(q => [q[0] * B.S, q[1] * B.S]));
}

// ---------------------------------------------------------------- repeating detail
/** A sketch's elements as continuous runs: each a dense polyline, chained end to end where they meet. */
export function pathRuns(sketch) {
  const polys = [];
  for (const el of (sketch && sketch.elements) || []) {
    const segs = elementSegs(el); if (!segs || !segs.length) continue;
    const pts = [];
    for (const g of segs) {
      const n = g.k === "L" ? 1 : g.k === "A" ? Math.max(8, Math.ceil(Math.abs(g.a1 - g.a0) / TAU * 96)) : 32;
      for (let i = pts.length ? 1 : 0; i <= n; i++) {
        const t = i / n;
        pts.push(g.k === "L" ? lerp(g.a, g.b, t) : g.k === "A" ? [g.c[0] + g.r * Math.cos(g.a0 + (g.a1 - g.a0) * t), g.c[1] + g.r * Math.sin(g.a0 + (g.a1 - g.a0) * t)] : bezPt(g, t));
      }
    }
    polys.push(pts);
  }
  // chain: join polylines whose ends meet (within 1 mm), reversing as needed
  const runs = [], used = new Set(), near = (a, b) => dist(a, b) < 1;
  for (let i = 0; i < polys.length; i++) {
    if (used.has(i)) continue; used.add(i); let run = polys[i].slice(), grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < polys.length; j++) {
        if (used.has(j)) continue; const q = polys[j];
        if (near(run[run.length - 1], q[0])) run = run.concat(q.slice(1));
        else if (near(run[run.length - 1], q[q.length - 1])) run = run.concat(q.slice(0, -1).reverse());
        else if (near(run[0], q[q.length - 1])) run = q.slice(0, -1).concat(run);
        else if (near(run[0], q[0])) run = q.slice(1).reverse().concat(run);
        else continue;
        used.add(j); grew = true;
      }
    }
    runs.push(run);
  }
  return runs;
}
const bezPt = (g, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * g.a[k] + 3 * u * u * t * g.c1[k] + 3 * u * t * t * g.c2[k] + t * t * t * g.b[k]); };
/** A run's frame: the point and unit tangent at arc length s, and the run's length. */
function runFrame(pts) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const L = cum[cum.length - 1];
  const at = s => {
    s = Math.max(0, Math.min(L, s));
    let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / seg, d = normalise(sub(pts[hi], pts[lo]));
    return { p: lerp(pts[lo], pts[hi], t), d, n: [-d[1], d[0]] };
  };
  return { L, at };
}
/** Stations along a run: n equal steps for Fill available / Maximum spacing, a fixed step otherwise. */
function stations(L, step, layout) {
  if (!(step > 0) || !(L > 0)) return { step: L || 1, n: 1 };
  if (layout === "Fixed distance") return { step, n: Math.max(1, Math.floor(L / step + 1e-6)) };
  const n = layout === "Maximum spacing" ? Math.max(1, Math.ceil(L / step - 1e-6)) : Math.max(1, Math.round(L / step));
  return { step: L / n, n };
}
function drawRepeating(doc, ctx, B, f) {
  const id = doc.idOf(f), comp = F.choice(f, "component") || "Batt insulation", w = Math.max(1, F.real(f, "width") || 100);
  const just = F.choice(f, "justify") || "Centre", off = just === "Left" ? w / 2 : just === "Right" ? -w / 2 : 0, h = w / 2;
  const layout = F.choice(f, "layout") || "Fill available", sp = F.real(f, "spacing") || 0;
  const g = resolveGraphics(doc, ctx, f, "projection"); const gs = { weight: g.weight === "none" ? penWeight(doc, "thin", ctx.scale) : g.weight, colour: g.colour };
  for (const run of pathRuns(doc.argValue(f, "path"))) {
    if (run.length < 2) continue;
    const { L, at } = runFrame(run);
    const W = (a, b) => { const fr = at(a); return add(fr.p, mul(fr.n, b + off)); };
    const poly = (list) => { const out = []; for (let i = 1; i < list.length; i++) out.push(lineSeg(list[i - 1], list[i])); return out; };
    const edge = b => { const n = Math.max(2, Math.ceil(L / Math.max(w / 4, 20))); return Array.from({ length: n + 1 }, (_, i) => W(L * i / n, b)); };
    if (comp === "Batt insulation") {
      // the batt: a meander of loops touching both faces, `step` per full loop
      const { step, n } = stations(L, sp || w, layout === "Fixed distance" ? "Fill available" : layout), r = step / 4, pts = [];
      const arc = (ca, cb, a0, a1) => { for (let i = 0; i <= 10; i++) { const t = a0 + (a1 - a0) * i / 10; pts.push(W(ca + r * Math.cos(t), cb + r * Math.sin(t))); } };
      for (let k = 0; k < n; k++) { const a0 = k * step; arc(a0 + r, h - r, Math.PI, 0); arc(a0 + 3 * r, -h + r, Math.PI, 2 * Math.PI); }
      B.stroke(poly(pts), gs, "Detail", id);
    } else if (comp === "Rigid insulation" || comp === "Brick coursing") {
      B.stroke(poly(edge(-h)), gs, "Detail", id); B.stroke(poly(edge(h)), gs, "Detail", id);
      const { step, n } = stations(L, sp || (comp === "Rigid insulation" ? w : 225), layout);
      for (let k = 0; k <= n; k++) { const a = Math.min(L, k * step); B.stroke([lineSeg(W(a, -h), W(a, h))], gs, "Detail", id); if (comp === "Rigid insulation" && k < n) B.stroke([lineSeg(W(a, -h), W(Math.min(L, a + step), h))], gs, "Detail", id); }
    } else if (comp === "Blocking") {
      const { step, n } = stations(L, sp || w * 1.5, layout);
      for (let k = 0; k < n; k++) { const a = k * step + step * 0.08, b = (k + 1) * step - step * 0.08; B.stroke(poly([W(a, -h), W(b, -h), W(b, h), W(a, h), W(a, -h)]), gs, "Detail", id); B.stroke([lineSeg(W(a, -h), W(b, h))], gs, "Detail", id); B.stroke([lineSeg(W(a, h), W(b, -h))], gs, "Detail", id); }
    } else {
      const sym = doc.lib.symbols[F.refId(f, "symbol")];
      const { step, n } = stations(L, sp || w, layout);
      for (let k = 0; k < n; k++) {
        const a = (k + 0.5) * step, fr = at(a), c = add(fr.p, mul(fr.n, off));
        const rot = Math.atan2(fr.d[1], fr.d[0]) * 180 / Math.PI + (F.real(f, "rotation") || 0);
        if (sym && sym.source) drawSymbol(doc, B, Object.assign({}, sym, { nominalSize: { w: 1e9, h: w / ctx.scale } }), B.P(c), rot, "Detail", id);
        else B.stroke(circlePath(B.P(c), w / ctx.scale / 3), gs, "Detail", id, true);
      }
    }
    B.hit(id, run, "curve");
  }
}

/** The material at a point of a view: the smallest cut or seen region there that has one (a wall's
 *  layer before the floor it stands on), else the material of whatever element is there. */
export function materialAt(doc, B, q) {
  let best = null, ba = Infinity;
  for (const m of B.mat) if (m.material && pointInPoly(q, m.poly)) { const a = Math.abs(polyArea(m.poly)) * (m.floor ? 1e6 : 1); if (a < ba) { ba = a; best = m; } }
  if (best) return best;
  for (const hh of B.hits) if (hh.pts && hh.pts.length > 2 && pointInPoly(q, hh.pts)) { const f = doc.element(hh.id), m = f && elementMaterial(doc, f); if (m) return { id: hh.id, material: m }; }
  return null;
}
/** An element's own material: its Material parameter, its type's, or its type's first (exterior / top) layer's. */
export function elementMaterial(doc, f) {
  const p = paramValue(doc, f, "Material"); if (p && doc.lib.materials[p]) return p;
  for (const k of ["wallType", "floorType", "columnType", "beamType", "doorType", "windowType"]) {
    const id = F.refId(f, k); if (!id) continue; const t = doc.resolveType(id); if (!t) continue;
    if (t.material) return t.material;
    if (t.layers && t.layers.length) return t.layers[0].material;
  }
  const pl = doc.plan(f); return pl && pl.material || null;
}
function paramValue(doc, f, k) { try { const v = propertyOf(doc, f, k); return v && !v.error ? v.v : null; } catch (e) { return null; } }
/** The model element at a point of a view: the smallest cut or seen region there, else the smallest
 *  hit region of a model element (never an annotation, a view or a datum). */
export function elementUnder(doc, B, q) {
  const found = materialAt(doc, B, q); if (found && found.id && doc.element(found.id)) return found.id;
  let best = null, ba = Infinity;
  for (const hh of B.hits) {
    if (!hh.pts || hh.pts.length < 3 || hh.kind === "curve" || !pointInPoly(q, hh.pts)) continue;
    const f = doc.element(hh.id), d = f && doc.declOf(f); if (!d || ["annotation", "view", "datum", "detail", "dimension"].includes(d.kind) || d.category === "Annotation") continue;
    const a = Math.abs(polyArea(hh.pts)); if (a < ba) { ba = a; best = hh.id; }
  }
  return best;
}
/** An element's Mark (its own, an instance parameter) and its type's Mark. */
function elementMarks(doc, id) {
  const f = id && doc.element(id); if (!f) return { mark: "", typeMark: "" };
  const own = paramValue(doc, f, "Mark");
  const tk = ["wallType", "floorType", "columnType", "beamType", "doorType", "windowType"].find(k => F.refId(f, k)), t = tk && doc.resolveType(F.refId(f, tk));
  return { mark: own != null && own !== "" ? String(own) : "", typeMark: t ? String(t.mark || (t.params && t.params.TypeMark) || "") : "" };
}
/** What a material tag says, from the material it rests on (and the element, for the element's marks). */
export function materialTagText(doc, mat, show, elementId) {
  if (show === "Element Mark" || show === "Type Mark" || show === "Element Mark · Material Mark") {
    const em = elementMarks(doc, elementId), m = mat && doc.lib.materials[mat];
    if (show === "Type Mark") return em.typeMark || "?";
    if (show === "Element Mark") return em.mark || em.typeMark || "?";
    const a = em.mark || em.typeMark, b = m ? m.mark || mat : "";
    return a || b ? [a || "?", b || "?"].join(" · ") : "?";
  }
  const m = mat && doc.lib.materials[mat]; if (!m) return "?";
  const mark = m.mark || mat;
  return { Mark: mark, Name: m.name || mat, "Mark · Name": `${mark} ${m.name || ""}`.trim(), Description: m.description || m.name || mat, "Mark · Description": `${mark} ${m.description || m.name || ""}`.trim() }[show || "Mark"] || mark;
}
/** A rounded rectangle whose ends are half circles (an oblong, a stadium), in paper mm. */
function oblongPath(x0, y0, x1, y1) {
  const r = (y1 - y0) / 2, cy = (y0 + y1) / 2, a = x0 + r, b = Math.max(a, x1 - r);
  return [lineSeg([a, y0], [b, y0]), { k: "A", c: [b, cy], r, a0: -Math.PI / 2, a1: Math.PI / 2 }, lineSeg([b, y1], [a, y1]), { k: "A", c: [a, cy], r, a0: Math.PI / 2, a1: 3 * Math.PI / 2 }];
}
function drawMaterialTag(doc, ctx, B, f) {
  const id = doc.idOf(f), pq = F.point(f, "position"), leader = doc.argValue(f, "leader") !== false;
  // what it reads: at its leader's point, or - leader off - under the tag itself
  const tq = leader ? F.point(f, "target") : pq, show = F.choice(f, "show");
  const found = materialAt(doc, B, tq), elId = /Element|Type/.test(show || "") ? elementUnder(doc, B, tq) : null;
  const text = materialTagText(doc, found && found.material, show, elId || (found && found.id));
  const ts = F.real(f, "textSize") || 2.5, frame = F.choice(f, "frame") || "Keynote box";
  const T = B.P(tq), P = B.P(pq), w = textWidth(text, ts), pad = ts * 0.45;
  const col = text !== "?" && !/\?/.test(text.split(" · ").join("")) ? "#000000" : "#b3261e", g = { weight: penWeight(doc, "hairline", ctx.scale), colour: col };
  const right = P[0] >= T[0];
  const box = [P[0] - w / 2 - pad, P[1] - ts / 2 - pad, P[0] + w / 2 + pad, P[1] + ts / 2 + pad];
  if (frame === "Oblong") { const r = (box[3] - box[1]) / 2; box[0] -= r * 0.5; box[2] += r * 0.5; }
  // the leader: from the point to the near side of the tag, a dot where it rests
  if (leader && dist(T, P) > 1e-6) {
    const end = frame === "Circle" ? add(P, mul(normalise(sub(T, P)), Math.max(w / 2, ts / 2) + pad)) : [right ? box[0] : box[2], P[1]];
    B.stroke([lineSeg(T, end)], g, "Annotation-Tag", id, true);
    B.fill(circlePath(T, 0.45), col, "Annotation-Tag", id, true);
  }
  const rect = polyPath([[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]);
  if (frame === "Keynote box") { B.fill(rect, "#ffffff", "Annotation-Tag", id, true); B.stroke(rect, g, "Annotation-Tag", id, true); }
  if (frame === "Oblong") { const ob = oblongPath(...box); B.fill(ob, "#ffffff", "Annotation-Tag", id, true); B.stroke(ob, g, "Annotation-Tag", id, true); }
  if (frame === "Circle") { const r = Math.max(w / 2, ts / 2) + pad; B.fill(circlePath(P, r), "#ffffff", "Annotation-Tag", id, true); B.stroke(circlePath(P, r), g, "Annotation-Tag", id, true); }
  B.text([P[0], P[1] - ts * 0.36], text, ts, { align: "centre", layer: "Annotation-Tag", id, colour: col });
  const S = ctx.scale; B.hit(id, [[box[0] * S, box[1] * S], [box[2] * S, box[1] * S], [box[2] * S, box[3] * S], [box[0] * S, box[3] * S]]);
  if (leader) B.hit(id, [tq, pq], "curve");
}
/** A spot elevation: the floor's top at its point - the highest floor there at or under the plan's cut -
 *  written over a crosshair ("NPT -0.170"). With no floor under it, it says so. */
export function spotElevationValue(doc, q, below) {
  let best = null;
  for (const g of doc.elements()) {
    if (doc.typeOf(g) !== "Floor" || doc.error(g)) continue;
    const p = doc.plan(g); if (!p || !(p.z1 <= below + 1)) continue;
    const regs = p.regions || [{ outer: p.foot, holes: [] }];
    if (!regs.some(r => pointInPoly(q, r.outer) && !(r.holes || []).some(h => pointInPoly(q, h)))) continue;
    if (best === null || p.z1 > best) best = p.z1;
  }
  return best;
}
function drawSpotElevation(doc, ctx, B, f, cutZ) {
  const id = doc.idOf(f), q = F.point(f, "position"), P = B.P(q), h = F.real(f, "textSize") || 1.0, font = annotationStyle(doc).font || undefined;
  const z = spotElevationValue(doc, q, cutZ), mm = F.choice(f, "units") === "mm";
  const val = z == null ? "?" : mm ? String(Math.round(z)) : (z < 0 ? "-" : "") + (Math.abs(z) / 1000).toFixed(3);
  // Revit's spot elevation symbol: a crosshair circle 2.5 across, the value over it
  const r = 1.25, g = { weight: 0.085, colour: z == null ? "#b3261e" : "#000" };
  B.stroke(circlePath(P, r), g, "Annotation-Spot", id, true);
  B.stroke([lineSeg(add(P, [-1.6, 0]), add(P, [1.6, 0])), lineSeg(add(P, [0, -1.6]), add(P, [0, 1.6]))], g, "Annotation-Spot", id, true);
  B.text(add(P, [0, 2.12]), (F.text(f, "prefix") || "") + val, h, { align: "centre", layer: "Annotation-Spot", id, font, colour: g.colour });
  const S = ctx.scale; B.hit(id, [[q[0] - 4 * S, q[1] - 2 * S], [q[0] + 4 * S, q[1] - 2 * S], [q[0] + 4 * S, q[1] + 4 * S], [q[0] - 4 * S, q[1] + 4 * S]]);
}
/** A drafting view (Revit's): 2D only - no model, just what was drawn or imported in it: detail lines,
 *  filled regions, text, symbols, repeating details, CAD imports and dimensions between them. A set's
 *  hand-drawn survey of the existing building lives here, as lines, not as a model. */
export function draftingScene(doc, v) {
  const ctx = viewContext(doc, v), S = ctx.scale, B = new SceneBuilder(S), id = doc.idOf(v);
  for (const f of doc.elements()) {
    if (F.refId(f, "view") !== id || f.get("Integer") === 0 || doc.error(f) || hiddenByRule(doc, ctx, f)) continue;
    const t = doc.typeOf(f);
    if (t === "DetailLine") { const c = F.json(f, "curve"), segs = curveSegs(c); B.stroke(segs, { weight: penWeight(doc, F.choice(f, "pen"), S), colour: F.text(f, "colour") || "#000000", dash: detailDash(f) }, "Detail", doc.idOf(f)); B.hit(doc.idOf(f), samplePath(segs), "curve"); }
    if (t === "FilledRegion") drawFilledRegion(doc, ctx, B, f);
    if (t === "CADImport") drawImport(doc, ctx, B, f);
    if (t === "Text") drawText(doc, ctx, B, f);
    if (t === "SymbolInstance") drawSymbolInstance(doc, B, f);
    if (t === "RepeatingDetail") drawRepeating(doc, ctx, B, f);
    if (t === "Dimension" && measureRefs(doc, F.json(f, "of") || []).kind !== "levels") drawDimension(doc, ctx, B, f);
  }
  const scene = { prims: B.prims, hits: B.hits, links: [], scale: S, kind: "drafting" };
  scene.bbox = sceneBBox(B.prims);
  applyCrop(doc, v, doc.argValue(v, "clip"), scene, S);
  return scene;
}
function drawFilledRegion(doc, ctx, B, f) {
  const S = ctx.scale, rs = regionAreas(f), pts = rs[0] ? rs[0].outer : F.json(f, "boundary"), path = sketchPath(f) || rs.flatMap(rg => [...polyPath(rg.outer), ...rg.holes.flatMap(hh => polyPath(hh))]), pid = F.text(f, "pattern");
  const bg = F.text(f, "background"), line = F.text(f, "lineColour"), pc = F.text(f, "patternColour");
  if (bg !== "none") B.fill(path, bg || "#ffffff", "Detail", doc.idOf(f));
  if (pid && doc.lib.patterns[pid]) B.hatch(path, doc.lib.patterns[pid], pid, pc || "#000000", penWeight(doc, "hairline", S), "Detail", doc.idOf(f));
  if (line !== "none") B.stroke(path, { weight: penWeight(doc, "thin", S), colour: line || "#000000" }, "Detail", doc.idOf(f));
  B.hit(doc.idOf(f), pts);
}
/** View-owned annotation for views that are not plans (sections, elevations): material tags. */
function drawViewAnnotations(doc, ctx, B, v) {
  if (!categoryVisible(ctx, "Annotation")) return;
  for (const f of doc.elements()) if (F.refId(f, "view") === doc.idOf(v) && !doc.error(f) && f.get("Integer") !== 0) {
    const t = doc.typeOf(f);
    if (t === "MaterialTag") drawMaterialTag(doc, ctx, B, f);
    if (t === "SymbolInstance") drawSymbolInstance(doc, B, f);
    // what is drawn in this view alone, in its own (along, height) coordinates: the ground's poché, a note,
    // a line, an imported drawing
    if (t === "FilledRegion") drawFilledRegion(doc, ctx, B, f);
    if (t === "Text") drawText(doc, ctx, B, f);
    if (t === "CADImport") drawImport(doc, ctx, B, f);
    if (t === "DetailLine") { const segs = curveSegs(F.json(f, "curve")); B.stroke(segs, { weight: penWeight(doc, F.choice(f, "pen"), ctx.scale), colour: F.text(f, "colour") || "#000000", dash: detailDash(f) }, "Detail", doc.idOf(f)); B.hit(doc.idOf(f), samplePath(segs), "curve"); }
  }
}

/** Where a dimension sits: witness feet a, b; the measured direction; the dimension line A–Bp at its offset. */
export function dimensionGeometry(doc, f, m = measureRefs(doc, F.json(f, "of") || [])) {
  if (!m || m.lost || m.value == null || m.kind === "levels") return null;
  const off = F.real(f, "offset");
  const { a, b, dir } = dimAxis(m);
  const along = perp(dir), shift = mul(along, off);
  return { a, b, dir, along, off, A: add(a, shift), Bp: add(b, shift), value: m.value, signed: dot(sub(b, a), dir) };
}
/** Where a measurement runs: from a to b along dir (before its offset). */
export function dimAxis(m) {
  let a, b, dir;
  if (m.kind === "parallel") { const L = m.a.geom; dir = perp(L.d); a = L.p; b = add(a, mul(dir, dot(sub(m.b.geom.p, a), dir))); }
  // a point to a line is measured square to the line, from the point to its foot
  else if (m.kind === "pointLine") { const P = m.a.kind === "point" ? m.a.geom : m.b.geom, L = m.a.kind === "line" ? m.a.geom : m.b.geom, Q = add(L.p, mul(L.d, dot(sub(P, L.p), L.d))); [a, b] = m.a.kind === "point" ? [P, Q] : [Q, P]; dir = normalise(sub(b, a)); if (!Number.isFinite(dir[0])) dir = perp(L.d); }
  else { a = m.a.kind === "point" ? m.a.geom : m.a.geom.p; b = m.b.kind === "point" ? m.b.geom : m.b.geom.p; dir = normalise(sub(b, a)); }
  return { a, b, dir };
}
function drawDimension(doc, ctx, B, f) {
  const id = doc.idOf(f), keys = F.json(f, "of") || [];
  const m = measureRefs(doc, keys);
  if (m.lost) return drawLostDimension(doc, B, f, keys, m);
  if (m.value == null) return;
  const { a, b, A, Bp } = dimensionGeometry(doc, f, m);
  drawStyledDim(doc, B, f, m.value, { a, b, A, Bp });
  B.hit(id, [a, b, Bp, A]);
}
/** Survives with a note naming the lost reference; never silently rebinds (test 30). */
function drawLostDimension(doc, B, f, keys, m, at) {
  const any = keys.map(k => resolveReference(doc, k)).find(r => r && r.kind !== "plane");
  const p = at || (any ? (any.kind === "point" ? any.geom : any.geom.p) : [0, 0]);
  B.text(add(B.P(p), [2, 2]), `⚠ ${m.lost.length} reference${m.lost.length > 1 ? "s" : ""} lost: ${m.lost.join(", ")}`, 2, { colour: "#b3261e", layer: "Annotation-Dimension", id: doc.idOf(f) });
}
/** A dimension drawn as its type says (AutoCAD's DIMSTYLE): extension lines with their offset from the
 *  object and their extension past the dimension line, the dimension line and its extension past the
 *  ticks, the terminators (ticks, arrows, dots…), and the text - font, height, colour, width factor,
 *  placement above, centred in or below the line, aligned or horizontal - with the fit rules deciding what
 *  goes inside when the space is tight, alternate units and tolerances. Sizes are paper mm. g gives the
 *  feet a, b (on what is measured) and the dimension line's ends A, Bp, in model (or view) coordinates. */
export function drawStyledDim(doc, B, f, valueMm, g, opt = {}) {
  const arg = k => f ? (k === "locked" ? F.bool(f, k) : F.text(f, k)) : (opt.inst || {})[k] || "";
  const id = f ? doc.idOf(f) : opt.id || null, st = opt.style || dimStyleOf(doc, f ? F.refId(f, "dimType") : null);
  const over = { value: arg("valueOverride"), prefix: arg("prefix"), suffix: arg("suffix") };
  const fmt = formatDimension(doc, st, valueMm, over), k = st.overallScale || 1, layer = "Annotation-Dimension";
  const pa = B.P(g.a), pb = B.P(g.b), pA = B.P(g.A), pB = B.P(g.Bp);
  let u = normalise(sub(pB, pA)); if (!Number.isFinite(u[0])) u = [1, 0];
  const nrm = perp(u), side = v => { const w = sub(v.A, v.a); return Math.hypot(w[0], w[1]) > 1e-9 ? normalise(w) : nrm; };
  const n1 = side({ a: pa, A: pA }), n2 = side({ a: pb, A: pB });
  const gl = { weight: st.lineWeight, colour: st.lineColour }, ge = { weight: st.extWeight, colour: st.extColour };
  // extension lines: from the object (less the offset) - or a fixed length back from the dimension line - to past it
  const ext = (foot, at, n, sup) => {
    if (sup) return;
    const reach = dot(sub(at, foot), n), from = st.extFixed > 0 ? Math.max(0, reach - st.extFixed * k) : Math.min(reach, st.extOffset * k);
    if (reach + st.extBeyond * k - from < 1e-6) return;
    B.stroke([lineSeg(add(foot, mul(n, from)), add(at, mul(n, st.extBeyond * k)))], ge, layer, id, true);
  };
  ext(pa, pA, n1, st.suppressExt1); ext(pb, pB, n2, st.suppressExt2);
  // the text: what it says, and how wide it runs
  const h = st.textHeight * k, font = st.font, wf = st.widthFactor || 1, gap = st.textGap * k;
  let main = fmt.main;
  if (fmt.tol && fmt.tol.kind === "sym") main += " " + fmt.tol.up;
  if (fmt.alt && !fmt.altBelow) main += ` [${fmt.alt}]`;
  const th = h * (st.tolHeight || 0.7), stacked = fmt.tol && (fmt.tol.kind === "dev" || fmt.tol.kind === "lim");
  const stackW = stacked ? Math.max(textWidth(fmt.tol.up || "", th, font, wf), textWidth(fmt.tol.low || "", th, font, wf)) + h * 0.3 : 0;
  const mainW = textWidth(main, h, font, wf), tw = mainW + stackW;
  // fit: the arrows and the text inside the extension lines when there is room, else as the type says
  const L = dist(pA, pB), as = st.arrowSize * k, need = st.arrow1 === "None" && st.arrow2 === "None" ? 0 : 2 * as;
  let textIn = true, arrowsIn = true;
  if (st.fit !== "Keep inside" && L < tw + need + 2 * gap) {
    if (st.fit === "Text outside") { textIn = false; arrowsIn = L >= need; }
    else if (st.fit === "Arrows outside") { arrowsIn = false; textIn = L >= tw + 2 * gap; }
    else { arrowsIn = L >= need + gap; textIn = L >= tw + 2 * gap + (arrowsIn ? need : 0); if (!textIn && L >= tw + 2 * gap) { textIn = true; arrowsIn = false; } }
  }
  // where the text stands along the line, and its angle
  const readable = ang => (ang > 90 + 1e-6 || ang <= -90 + 1e-6 ? ang + 180 : ang);
  const lineAng = readable(Math.atan2(u[1], u[0]) * 180 / Math.PI);
  const horizontal = st.textAlign === "Horizontal" || (st.textAlign === "ISO standard" && !textIn);
  const rot = horizontal ? 0 : lineAng, rr = rot * Math.PI / 180, tx = [Math.cos(rr), Math.sin(rr)], ty = [-Math.sin(rr), Math.cos(rr)];
  // "up" is the side the extension lines stand out to, so text above sits away from the object
  // (Revit's way: "Readable" - always over the line as it reads, whichever side the object is)
  const upN = st.textSide === "Readable" ? 1 : dot(n1, ty) >= 0 ? 1 : -1;
  let along;
  if (!textIn) along = L + (arrowsIn ? 0 : 2 * as) + gap + tw / 2;
  else if (st.textHorizontal === "At extension line 1") along = (arrowsIn ? as : 0) + gap + tw / 2;
  else if (st.textHorizontal === "At extension line 2") along = L - (arrowsIn ? as : 0) - gap - tw / 2;
  else along = L / 2;
  const onLine = add(pA, mul(u, along));
  // the dimension line: past the extension lines by dimExtend, out beyond them when the arrows are outside,
  // out to the text when the text is, broken round centred text
  const e0 = add(pA, mul(u, -(arrowsIn ? st.dimExtend * k : 2 * as))), e1 = add(pB, mul(u, arrowsIn ? st.dimExtend * k : 2 * as));
  const tEnd = !textIn ? add(pA, mul(u, along + tw / 2)) : null;
  const segs = [];
  const brk = st.textVertical === "Centred" && !horizontal ? [along - tw / 2 - gap, along + tw / 2 + gap] : null;
  const pushLine = (p, q) => { if (dist(p, q) > 1e-6) segs.push(lineSeg(p, q)); };
  const lo = dot(sub(e0, pA), u), hi = dot(sub(tEnd && dot(sub(tEnd, pA), u) > dot(sub(e1, pA), u) ? tEnd : e1, pA), u);
  const from = st.suppressDim1 ? L / 2 : lo, to = st.suppressDim2 ? L / 2 : hi;
  if (brk && textIn) { pushLine(add(pA, mul(u, from)), add(pA, mul(u, Math.min(to, brk[0])))); pushLine(add(pA, mul(u, Math.max(from, brk[1]))), add(pA, mul(u, to))); }
  else pushLine(add(pA, mul(u, from)), add(pA, mul(u, to)));
  B.stroke(segs, gl, layer, id, true);
  // terminators: pointing out to the extension lines, or in from outside them
  if (!st.suppressDim1) drawDimArrow(B, st.arrow1, pA, arrowsIn ? u : mul(u, -1), as, st, id);
  if (!st.suppressDim2) drawDimArrow(B, st.arrow2, pB, arrowsIn ? mul(u, -1) : u, as, st, id);
  // the text, placed above, centred on or below the line
  const vOff = st.textVertical === "Centred" || (horizontal && textIn && st.textAlign !== "Horizontal") ? 0 : st.textVertical === "Below" ? -(gap + h) : gap;
  let at = horizontal && !textIn ? add(onLine, mul(ty, gap)) : add(onLine, mul(ty, upN * vOff + (st.textVertical === "Centred" ? 0 : 0)));
  if (st.textVertical === "Below" && upN < 0) at = add(onLine, mul(ty, gap));
  if (st.textVertical === "Above" && upN < 0) at = add(onLine, mul(ty, -(gap + h)));
  const valign = st.textVertical === "Centred" ? "middle" : "baseline";
  const mid0 = add(at, mul(tx, -tw / 2)), yb = valign === "middle" ? -h / 2 : 0;
  const box = (x0, x1, y0, y1) => [add(add(mid0, mul(tx, x0)), mul(ty, yb + y0)), add(add(mid0, mul(tx, x1)), mul(ty, yb + y0)), add(add(mid0, mul(tx, x1)), mul(ty, yb + y1)), add(add(mid0, mul(tx, x0)), mul(ty, yb + y1))];
  const pad = gap * 0.8, frame = box(-pad, tw + pad, -pad, h + pad);
  if (st.textFill) B.fill(polyPath(frame), st.textFill, layer, id, true);
  if (st.textFrame || (fmt.tol && fmt.tol.kind === "basic")) B.stroke(polyPath(frame), { weight: st.lineWeight, colour: st.textColour }, layer, id, true);
  const T = (p, str, hh, extra = {}) => B.text(p, str, hh, Object.assign({ align: "left", valign, rot, colour: st.textColour, layer, id, font, widthFactor: wf }, extra));
  T(mid0, main, h);
  if (stacked) {
    const sx = add(mid0, mul(tx, mainW + h * 0.3));
    if (fmt.tol.kind === "lim") { T(add(mid0, mul(ty, h * 0.6)), main, h * 0.7); }
    T(add(sx, mul(ty, h * 0.55)), fmt.tol.up || main, th, { valign });
    T(add(sx, mul(ty, -h * 0.25)), fmt.tol.low || "", th, { valign });
  }
  // Revit's text above and below the value, and alternate units under the line
  const aboveT = arg("above"), belowT = arg("below"), lineBelow = [fmt.altBelow && fmt.alt ? `[${fmt.alt}]` : "", belowT].filter(Boolean);
  const cx = add(at, mul(ty, 0));
  if (aboveT) B.text(add(cx, mul(ty, upN * (h * 1.5))), aboveT, h * 0.8, { align: "centre", valign, rot, colour: st.textColour, layer, id, font, widthFactor: wf });
  lineBelow.forEach((str, i) => B.text(add(onLine, mul(ty, -upN * (gap + h * (1 + 1.4 * i)) + (upN < 0 ? h : 0))), str, h * 0.9, { align: "centre", valign: "baseline", rot, colour: st.textColour, layer, id, font, widthFactor: wf }));
  if (arg("locked")) drawPadlock(B, add(at, add(mul(tx, tw / 2 + 2.5 * k), mul(ty, h * 0.2))), id);
  return { text: main, at, rot, textIn, arrowsIn, width: tw };
}
/** A dimension type drawn on its own, as AutoCAD's style dialog previews it: a plate with a long width, a
 *  tight one and a height (paper mm, at 1:100). */
export function dimStylePreview(doc, st) {
  const B = new SceneBuilder(1), obj = { weight: 0.25, colour: "#8a8f98" }, S = 100;
  B.stroke(polyPath([[0, 0], [60, 0], [60, 30], [66, 30], [66, 0], [70, 0], [70, 40], [0, 40]]), obj, "Preview", null, true);
  drawStyledDim(doc, B, null, 60 * S, { a: [0, 40], b: [60, 40], A: [0, 48], Bp: [60, 48] }, { style: st, inst: {} });
  drawStyledDim(doc, B, null, 6 * S, { a: [60, 30], b: [66, 30], A: [60, 36], Bp: [66, 36] }, { style: st, inst: {} });
  drawStyledDim(doc, B, null, 40 * S, { a: [70, 0], b: [70, 40], A: [80, 0], Bp: [80, 40] }, { style: st, inst: {} });
  drawStyledDim(doc, B, null, Math.hypot(60, 30) * S, { a: [0, 0], b: [60, 30], A: [-3.6, 7.2], Bp: [56.4, 37.2] }, { style: st, inst: {} });
  const scene = { prims: B.prims, hits: [], links: [], scale: 1, kind: "preview" };
  scene.bbox = sceneBBox(B.prims);
  return scene;
}
/** One terminator at `tip`, its body running along `into` (a unit vector along the dimension line). */
export function drawDimArrow(B, kind, tip, into, s, st, id) {
  if (!kind || kind === "None") return;
  const layer = "Annotation-Dimension", c = st.lineColour, n = perp(into), g = { weight: st.lineWeight, colour: c };
  const P = (x, y) => add(tip, add(mul(into, x), mul(n, y)));
  const tri = w => [tip, P(s, w), P(s, -w)];
  if (kind === "Architectural tick" || kind === "Oblique") {
    // a 45° stroke through the tip, leaning the same way at both ends (as a drawn tick does)
    const c0 = Math.abs(into[0]) > 1e-9 ? mul(into, Math.sign(into[0])) : [0, Math.abs(into[1])], d = normalise(add(c0, perp(c0)));
    const t = mul(d, s / 2);
    B.stroke([lineSeg(sub(tip, t), add(tip, t))], { weight: kind === "Architectural tick" ? st.tickWeight : st.lineWeight, colour: c }, layer, id, true);
    return;
  }
  if (kind === "Closed filled") { B.fill(polyPath(tri(s / 6)), c, layer, id, true); return; }
  if (kind === "Closed blank") { B.fill(polyPath(tri(s / 6)), "#ffffff", layer, id, true); B.stroke(polyPath(tri(s / 6)), g, layer, id, true); return; }
  if (kind === "Closed") { B.stroke(polyPath(tri(s / 6)), g, layer, id, true); return; }
  if (kind === "Open") { B.stroke([lineSeg(P(s, s / 6), tip), lineSeg(tip, P(s, -s / 6))], g, layer, id, true); return; }
  if (kind === "Open 30") { const w = s * Math.tan(15 * Math.PI / 180); B.stroke([lineSeg(P(s, w), tip), lineSeg(tip, P(s, -w))], g, layer, id, true); return; }
  if (kind === "Right angle") { B.stroke([lineSeg(P(s / 2, s / 2), tip), lineSeg(tip, P(s / 2, -s / 2))], g, layer, id, true); return; }
  if (kind === "Dot") { B.fill(circlePath(tip, s / 4), c, layer, id, true); return; }
  if (kind === "Dot small") { B.fill(circlePath(tip, s / 8), c, layer, id, true); return; }
  if (kind === "Dot blank") { B.fill(circlePath(tip, s / 4), "#ffffff", layer, id, true); B.stroke(circlePath(tip, s / 4), g, layer, id, true); return; }
  if (kind === "Origin indicator") { B.stroke(circlePath(tip, s / 2), g, layer, id, true); return; }
  if (kind === "Box filled" || kind === "Box blank") {
    const q = [P(-s / 4, -s / 4), P(s / 4, -s / 4), P(s / 4, s / 4), P(-s / 4, s / 4)];
    B.fill(polyPath(q), kind === "Box filled" ? c : "#ffffff", layer, id, true); if (kind === "Box blank") B.stroke(polyPath(q), g, layer, id, true); return;
  }
  if (kind === "Datum triangle filled") { B.fill(polyPath([P(0, s / 2), P(0, -s / 2), P(s * 0.87, 0)]), c, layer, id, true); return; }
}
export function drawPadlock(B, p, id, colour = "#1d6fd8") {
  B.fill(rectPath(p[0] - 1, p[1] - 0.2, p[0] + 1, p[1] + 1.3), colour, "Annotation-Constraint", id);
  B.prims.push({ t: "stroke", path: [{ k: "A", c: [p[0], p[1] + 1.3], r: 0.7, a0: 0, a1: Math.PI }], weight: 0.25, colour, layer: "Annotation-Constraint", id });
}
/** One glyph pass over the constraint rows: drawn, always (§10.5). */
function drawConstraintGlyphs(doc, ctx, B) {
  for (const C of doc.constraints) {
    if (doc.elements().some(f => doc.typeOf(f) === "Dimension" && F.bool(f, "locked") && JSON.stringify(F.json(f, "of")) === JSON.stringify(C.of))) continue;
    const R = C.of.map(k => resolveReference(doc, k)).filter(Boolean);
    if (!R.length) continue;
    const pts = R.map(r => r.kind === "point" ? r.geom : r.kind === "line" ? r.geom.p : null).filter(Boolean);
    if (!pts.length) continue;
    const at = B.P(pts.reduce((a, b) => add(a, b)).map(x => x / pts.length));
    const glyph = { distance: "", equal: "EQ", aligned: "AL", parallel: "∥", perpendicular: "⊥", horizontal: "H", vertical: "V", coincident: "●" }[C.kind] ?? "?";
    if (C.kind === "distance") drawPadlock(B, at, C.id); else B.text(at, glyph, 2, { align: "centre", colour: "#1d6fd8", layer: "Annotation-Constraint", id: C.id });
  }
}

// ---------------------------------------------------------------- elevation (§6.3)
/** What a dimension placed in an elevation or a section measures. Every line there is a plane in the model:
 *  a horizontal one (a level, a slab's top or underside, a layer between, a wall's base or top, a beam's
 *  soffit, a sill or a head) or an upright one seen edge-on (a wall face, a column face, a grid, a jamb).
 *  Two horizontal planes give a height ("levels"); two upright ones square to the view give a width
 *  ("across") - measured from the planes themselves, so a thicker slab or wall carries its dimension. */
export function viewMeasure(doc, v, keys) {
  const R = keys.map(k => resolveReference(doc, k)), lost = keys.filter((k, i) => !R[i]);
  if (lost.length) return { lost };
  const [a, b] = R;
  if (a.kind === "plane" && b.kind === "plane") return { value: Math.abs(b.z - a.z), signed: b.z - a.z, a, b, kind: "levels" };
  const G = viewLineGeometry(doc, v), sa = sAcross(G, a), sb = sAcross(G, b);
  if (sa != null && sb != null) return { value: Math.abs(sb - sa), signed: sb - sa, a, b, sa, sb, kind: "across" };
  return { value: null, why: a.kind === "plane" || b.kind === "plane" ? "a height needs two horizontal planes" : "these planes are not square to this view" };
}
/** Where an upright plane (a plan line square to the view) or edge (a plan point) stands along the view. */
function sAcross(G, r) {
  if (r.kind === "point") return G.sOf(r.geom);
  if (r.kind === "line" && Math.abs(dot(r.geom.d, G.d)) < 1e-3) return G.sOf(r.geom.p);
  return null;
}
/** Every plane an elevation or a section shows as a line, in view coordinates: horizontal ones
 *  { dir: "h", z, s0, s1 } and upright ones { dir: "v", s, z0, z1 } - what its dimension tool snaps to. */
export function viewReferences(doc, v) {
  const G = viewLineGeometry(doc, v), ctx = viewContext(doc, v), out = [], Z0 = G.Z0, far = G.depthMax || Infinity;
  // how far behind the view plane a thing starts (0 when the section cuts it): nearer wins a tie, as the drawing shows it
  const nearest = pts => pts && pts.length ? Math.max(0, Math.min(...pts.map(G.depthOf))) : Infinity;
  const inDepth = pts => { if (!pts || !pts.length) return true; const ds = pts.map(G.depthOf); return Math.max(...ds) >= -1 && Math.min(...ds) <= far + 1; };
  for (const f of doc.elements()) {
    if (f.get("Integer") === 0 || doc.error(f)) continue;
    const t = doc.typeOf(f), id = doc.idOf(f);
    if (t === "Level") { if (!categoryVisible(ctx, "IfcBuildingStorey")) continue; const z = ((doc.data(f) || {}).value || 0) - Z0; out.push({ key: id + ":plane", of: id, name: "level", dir: "h", z, s0: -1500, s1: G.Lv + 1500 }); continue; }
    if (!doc.plan(f) && t !== "Grid") continue;
    if (t !== "Grid" && !categoryVisible(ctx, categoryOf(doc, f))) continue;
    let refs; try { refs = elementRefs(doc, f); } catch (e) { continue; }
    for (const r of refs) {
      if (r.kind === "plane") {
        const pts = r.foot && r.foot.length ? r.foot : null; if (!pts || !inDepth(pts)) continue;
        const ss = pts.map(G.sOf); out.push({ key: id + ":" + r.key, of: id, name: r.key, dir: "h", z: r.z - Z0, s0: Math.min(...ss), s1: Math.max(...ss), depth: nearest(pts) });
        continue;
      }
      const s = sAcross(G, r); if (s == null) continue;
      if (!inDepth(r.kind === "point" ? [r.geom] : [r.a, r.b].filter(Boolean))) continue;
      const z0 = r.z0 != null ? r.z0 - Z0 : -300, z1 = r.z1 != null ? r.z1 - Z0 : G.topZ - Z0;
      out.push({ key: id + ":" + r.key, of: id, name: r.key, dir: "v", s, z0, z1, depth: nearest(r.kind === "point" ? [r.geom] : [r.a, r.b].filter(Boolean)) });
    }
  }
  return out;
}

/** Occlusion is a 2D problem: front to back, each element's curves minus the
 *  union of silhouettes in front of it; depth banding grades the weight. */
export function elevationScene(doc, v, opts = {}) {
  const ctx = viewContext(doc, v);
  const S = ctx.scale, B = new SceneBuilder(S);
  const G = viewLineGeometry(doc, v);
  const items = gatherElevationItems(doc, ctx, G);
  const inView = it => it.depthMax >= -TOL && it.depth <= G.depthMax && it.s1 >= 0 && it.s0 <= G.Lv;
  const vis = items.filter(inView).sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1));   // deterministic ties (test 40)
  drawDatums(doc, ctx, B, v, G);
  drawProjection(doc, ctx, B, vis, G, []);
  drawViewAnnotations(doc, ctx, B, v);
  const scene = { prims: B.prims, hits: B.hits, links: [], scale: S, kind: "elevation", stats: { items: vis.length } };
  scene.bbox = sceneBBox(B.prims);
  applyCrop(doc, v, doc.argValue(v, "clip"), scene, S);
  return scene;
}
/** An elevation's or a section's line in plan, and the maps from plan to view coordinates. */
export function viewLineGeometry(doc, v) {
  const c = F.json(v, "line"), d = normalise(sub(c.end, c.start)), look = mul(perp(d), -1), Lv = dist(c.start, c.end);
  const depthMax = F.real(v, "depth");
  const lv = F.reference(v, "baseLevel"), Z0 = lv ? (doc.data(lv) || {}).value || 0 : 0, topZ = Z0 + F.real(v, "top");
  // across the drawing, left to right, as the eye sees it: looking to the line's right-hand side, its END is
  // on the left. So s runs from the line's end back towards its start (o is where s = 0, d the way s grows)
  const o = c.end, sd = mul(d, -1);
  const sOf = p => dot(sub(p, o), sd), depthOf = p => dot(sub(p, c.start), look);
  const V = (p, z) => [sOf(p), z - Z0];              // view coords, model mm
  return { c, o, d: sd, line: d, look, Lv, depthMax, Z0, topZ, sOf, depthOf, V };
}
function gatherElevationItems(doc, ctx, G, skip = null) {
  const { V, sOf, depthOf, Z0 } = G;
  const items = [];
  for (const f of doc.elements()) {
    if (f.get("Integer") === 0 || doc.error(f)) continue;
    if (skip && skip.has(doc.idOf(f))) continue;
    // Visibility/Graphics is data: a category switched off in this view's style is not drawn, here as in plan
    if (!categoryVisible(ctx, categoryOf(doc, f)) || hiddenByRule(doc, ctx, f)) continue;
    const t = doc.typeOf(f);
    if (t === "Wall") { const w = doc.plan(f); if (!w) continue; const it = elevWall(doc, f, w, V, sOf, depthOf, ctx); if (it) items.push(it); }
    if ((t === "Generic" || t === "Duct" || t === "Pipe" || t === "Roof" || t === "Lattice" || t === "Stair" || t === "Toposurface" || t === "Planting" || t === "Railing" || t === "Ramp") && doc.plan(f) && doc.plan(f).mesh) {
      // a body of its own shape: its feature edges, projected; hidden by what stands in front of it
      const p = doc.plan(f), P = p.mesh.positions, curves = [];
      let d0 = Infinity, d1 = -Infinity, s0 = Infinity, s1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < P.length; i += 3) { const q = [P[i], P[i + 1]], dd = depthOf(q), ss = sOf(q); d0 = Math.min(d0, dd); d1 = Math.max(d1, dd); s0 = Math.min(s0, ss); s1 = Math.max(s1, ss); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
      // a body drawn in a work plane (a moulding) shows its own profile; any other body its feature edges
      if (p.face) for (const l of p.face) for (let i = 0; i < l.length; i++) { const A = l[i], Bq = l[(i + 1) % l.length]; curves.push([[sOf(A), A[2] - Z0], [sOf(Bq), Bq[2] - Z0]]); }
      else for (const [a, b] of meshEdges(doc, p.meshShape, p.mesh)) { const A = [P[a * 3], P[a * 3 + 1]], Bq = [P[b * 3], P[b * 3 + 1]]; curves.push([[sOf(A), P[a * 3 + 2] - Z0], [sOf(Bq), P[b * 3 + 2] - Z0]]); }
      // its face toward the eye, for the surface fill: its box (a moulding, a frame), or brick by brick (a screen)
      const box = [[s0, z0 - Z0], [s1, z0 - Z0], [s1, z1 - Z0], [s0, z1 - Z0]];
      let bricks = null;
      if (t === "Lattice" && p.bricks && p.frame) {
        const at = u => sOf(add(p.frame.start, mul(p.frame.d, u)));
        bricks = p.bricks.map(b => { const a = at(b.u0), c = at(b.u1); return [[Math.min(a, c), b.z0 - Z0], [Math.max(a, c), b.z0 - Z0], [Math.max(a, c), b.z1 - Z0], [Math.min(a, c), b.z1 - Z0]]; }).filter(q => q[1][0] - q[0][0] > 1);
      }
      const face = p.face ? p.face.map(l => l.map(q => [sOf(q), q[2] - Z0])) : null;
      items.push({ id: doc.idOf(f), f, depth: d0, depthMax: d1, s0, s1, curves, sil: [], box, bricks, face, fillerHits: [{ id: doc.idOf(f), poly: box }], cat: categoryOf(doc, f) });
      continue;
    }
    if (t === "Floor" || t === "Beam" || t === "Generic") {
      const p = doc.plan(f); if (!p || !p.parts) continue;
      for (const part of p.parts) {
        const ss = part.foot.map(sOf), dd = part.foot.map(depthOf), s0 = Math.min(...ss), s1 = Math.max(...ss);
        const sil = [[s0, part.z0 - Z0], [s1, part.z0 - Z0], [s1, part.z1 - Z0], [s0, part.z1 - Z0]];
        items.push({ id: doc.idOf(f), f, depth: Math.min(...dd), depthMax: Math.max(...dd), s0, s1, curves: polyPath(sil).map(x => [x.a, x.b]), sil: [sil], cat: t === "Floor" ? "IfcSlab" : t === "Generic" ? "IfcBuildingElementProxy" : "IfcBeam" });
      }
    }
    if (t === "Column") { const p = doc.plan(f); if (!p) continue; const pts = p.foot.length ? p.foot : samplePath(p.path); const ss = pts.map(sOf), dd = pts.map(depthOf);
      const s0 = Math.min(...ss), s1 = Math.max(...ss); const sil = [[s0, p.z0 - Z0], [s1, p.z0 - Z0], [s1, p.z1 - Z0], [s0, p.z1 - Z0]];
      items.push({ id: doc.idOf(f), f, depth: Math.min(...dd), depthMax: Math.max(...dd), s0, s1, curves: polyPath(sil).map(x => [x.a, x.b]), sil: [sil], cat: "IfcColumn" }); }
  }
  return items;
}
/** Ground line, level lines with heads, and grids crossing the view line. */
function drawDatums(doc, ctx, B, v, G) {
  const S = ctx.scale, { c, o, d, Lv, Z0, topZ } = G, AS = annotationStyle(doc);
  const le = doc.argValue(v, "levelExtent"), ext = Array.isArray(le) && le.length === 2 ? le : [-1500, Lv + 1500];
  if (doc.argValue(v, "groundLine") !== false) B.stroke([lineSeg([ext[0], 0], [ext[1], 0])], { weight: penWeight(doc, "bold", S), colour: "#000" }, "Ground", null);
  const vov = doc.argValue(v, "overrides") || {};
  for (const f of doc.elements()) if (doc.typeOf(f) === "Level" && categoryVisible(ctx, "IfcBuildingStorey")) {
    // a level hidden in this view (Revit's Hide in View) draws no line and no head here
    if ((vov[doc.idOf(f)] || {}).visible === false) continue;
    const z = (doc.data(f) || {}).value - Z0; if (z + Z0 > topZ) continue;
    if (AS.levelHeads === "Left") {
      // Revit's level head at the left: the name, a heavy V with its point on the level, the height in mm; the
      // line solid under the height, then dashed across the view
      const id = doc.idOf(f), hp = B.P([ext[0], z]), font = AS.font || undefined, th = AS.levelText, hv = 0.47;
      B.stroke([lineSeg(add(hp, [-2.29, 3.3]), hp), lineSeg(hp, add(hp, [2.33, 3.3]))], { weight: hv, colour: "#000" }, "IfcBuildingStorey", id, true);
      B.stroke([lineSeg(add(hp, [-2.96, 0]), add(hp, [3.01, 0])), lineSeg(add(hp, [4.02, 0]), add(hp, [15.2, 0]))], { weight: 0.085, colour: "#000" }, "IfcBuildingStorey", id, true);
      const x1 = B.P([ext[1], z])[0];
      if (x1 > hp[0] + 15.2) B.stroke([lineSeg(add(hp, [15.2, 0]), [x1, hp[1]])], { weight: 0.085, colour: "#000", dash: LINE_TYPES.dashed2 }, "IfcBuildingStorey", id, true);
      B.text(add(hp, [4.02, 1.5]), String(Math.round(z + Z0)), th, { layer: "IfcBuildingStorey", id, font });
      // the name wraps as Revit's label does (29.5 wide): a block of left-aligned lines ending at the head
      const lines = String(F.text(f, "name")).split("\n").flatMap(p => wrapText(p, th, 29.5, font)), bw = Math.max(...lines.map(l => textWidth(l, th, font)));
      lines.forEach((ln, i) => B.text(add(hp, [-4.55 - bw, 1.58 + (lines.length - 1 - i) * th * 1.6]), ln, th, { layer: "IfcBuildingStorey", id, font }));
      B.hit(id, [[ext[0], z - 50], [ext[1], z - 50], [ext[1], z + 50], [ext[0], z + 50]]);
      continue;
    }
    B.stroke([lineSeg([ext[0], z], [ext[1], z])], { weight: penWeight(doc, "hairline", S), colour: "#000", dash: LINE_TYPES.centre }, "IfcBuildingStorey", doc.idOf(f));
    const hp = B.P([ext[1], z]);
    B.stroke(polyPath([hp, add(hp, [2, 2]), add(hp, [4, 0]), add(hp, [2, -2])]), { weight: 0.25, colour: "#000" }, "IfcBuildingStorey", doc.idOf(f), true);
    B.text(add(hp, [5.5, 0.6]), F.text(f, "name"), 2.5, { layer: "IfcBuildingStorey", id: doc.idOf(f) });
    // the height from the project's zero, or on the survey's datum when the project has one
    const sd = (doc.meta && doc.meta.surveyElevation) || 0, zz = z + Z0 + sd, im = sd && isImperial(doc.meta.displayUnits);
    B.text(add(hp, [5.5, -3.2]), im ? `${Math.round(zz / 304.8 * 10) / 10}'` : (zz >= 0 ? "+" : "") + (zz / 1000).toFixed(3), 2.0, { layer: "IfcBuildingStorey", id: doc.idOf(f) });
    B.hit(doc.idOf(f), [[ext[0], z - 50], [ext[1], z - 50], [ext[1], z + 50], [ext[0], z + 50]]);
  }
  // dimensions placed in this view: heights between horizontal planes (levels, a slab's faces, a sill…) as a
  // vertical string at their offset along the view, widths between upright planes (wall faces, grids…) as a
  // horizontal one at their offset height. Each extension line runs from the plane's own extent in this view
  if (categoryVisible(ctx, "Annotation")) {
    let spans = null;
    const span = key => { if (!spans) { spans = new Map(); for (const r of viewReferences(doc, v)) spans.set(r.key, r); } return spans.get(key); };
    const clamp = (x, lo, hi) => Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), x));
    for (const f of doc.elements()) {
      if (doc.typeOf(f) !== "Dimension" || F.refId(f, "view") !== doc.idOf(v)) continue;
      const keys = F.json(f, "of") || [], m = viewMeasure(doc, v, keys), id = doc.idOf(f), off = F.real(f, "offset");
      if (m.lost) { drawLostDimension(doc, B, f, keys, m, [off, 0]); continue; }
      if (m.value == null) continue;
      let g;
      if (m.kind === "levels") {
        const za = m.a.z - Z0, zb = m.b.z - Z0, ra = span(keys[0]), rb = span(keys[1]);
        g = { a: [ra ? clamp(off, ra.s0, ra.s1) : off, za], b: [rb ? clamp(off, rb.s0, rb.s1) : off, zb], A: [off, za], Bp: [off, zb] };
      } else {
        const ra = span(keys[0]), rb = span(keys[1]);
        g = { a: [m.sa, ra ? clamp(off, ra.z0, ra.z1) : off], b: [m.sb, rb ? clamp(off, rb.z0, rb.z1) : off], A: [m.sa, off], Bp: [m.sb, off] };
      }
      drawStyledDim(doc, B, f, m.value, g);
      const xs = [g.A[0], g.Bp[0]], ys = [g.A[1], g.Bp[1]], pad = 300;
      B.hit(id, [[Math.min(...xs) - pad, Math.min(...ys) - pad], [Math.max(...xs) + pad, Math.min(...ys) - pad], [Math.max(...xs) + pad, Math.max(...ys) + pad], [Math.min(...xs) - pad, Math.max(...ys) + pad]]);
    }
  }
  // other sections that cross this view: a line where their cut plane passes, with their name - picked and dragged here as in plan
  if (categoryVisible(ctx, "Annotation")) for (const f of doc.elements()) {
    if (doc.typeOf(f) !== "SectionView" || f === v) continue;
    const sl = F.json(f, "line"); if (!sl || sl.type !== "line") continue;
    const sd = normalise(sub(sl.end, sl.start)), den = d[0] * sd[1] - d[1] * sd[0]; if (Math.abs(den) < 1e-9) continue;
    const t = ((sl.start[0] - o[0]) * sd[1] - (sl.start[1] - o[1]) * sd[0]) / den;
    // it shows where its cut plane passes through what this view sees: its line must reach into this view's depth
    const da = G.depthOf(sl.start), db = G.depthOf(sl.end), dMax = G.depthMax || Infinity;
    if (t < 0 || t > Lv || Math.max(da, db) < 0 || Math.min(da, db) > dMax) continue;
    if (AS.kind === "revit") {
      const place = placements(doc);
      // Revit's: the flag head up top (its flag toward the side the section looks), a stub under it, and down at
      // the ground the tail - a bar toward the look side and a stub up from it; where is the view's to set
      const id = doc.idOf(f), ov = (doc.argValue(v, "overrides") || {})[id] || {}, R = AS.markerRadius;
      const lookSec = mul(perp(sd), -1), side = Math.sign(dot(lookSec, d)) || 1;
      const [tailZ, headZ] = ov.markerZ || [-1917, F.real(v, "top") - 700], [tailStub, headStub] = ov.stubs || [9, 5.6];
      const pl = place.get(id), hp = B.P([t, headZ]), tp = B.P([t, tailZ]), g0 = { weight: 0.085, colour: "#000" };
      flagHead(B, hp, [side, 0], AS, pl ? String(pl.vp) : "—", pl ? pl.number : "", id);
      if (pl) B.links.push({ t: "link", rect: [hp[0] - R, hp[1] - R, 2 * R, 2 * R], sheet: pl.sheet, layer: "Annotation-Marker", id });
      B.stroke([lineSeg(add(hp, [0, -R]), add(hp, [0, -R - headStub]))], g0, "Annotation-Marker", id, true);
      B.fill(polyPath([add(tp, [0, -1]), add(tp, [9 * side, -1]), add(tp, [9 * side, 1]), add(tp, [0, 1])]), "#000000", "Annotation-Marker", id, true);
      B.stroke([lineSeg(add(tp, [0, 1]), add(tp, [0, 1 + tailStub]))], g0, "Annotation-Marker", id, true);
      B.hit(id, [[t, tailZ], [t, headZ]], "curve");
      continue;
    }
    // its head sits below the grid bubbles (they stand 600 above the view's top)
    const top = F.real(v, "top") - 700, id = doc.idOf(f), g = { weight: penWeight(doc, "thin", S), colour: "#000", dash: LINE_TYPES.dashed1 };
    B.stroke([lineSeg([t, -300], [t, top])], g, "Annotation-Marker", id);
    const hp = B.P([t, top]);
    B.stroke(polyPath([hp, add(hp, [1.6, 3]), add(hp, [-1.6, 3])]), { weight: penWeight(doc, "thin", S), colour: "#000" }, "Annotation-Marker", id, true);
    B.text(add(hp, [0, 4.4]), f.get("Name") || id, 2.2, { align: "centre", layer: "Annotation-Marker", id });
    B.hit(id, [[t, -300], [t, top]], "curve");
    B.hit(id, [[t - 3 * S, top], [t + 3 * S, top], [t + 3 * S, top + 7 * S], [t - 3 * S, top + 7 * S]]);
  }
  for (const f of doc.elements()) if (doc.typeOf(f) === "Grid" && categoryVisible(ctx, "IfcGrid")) {
    const gl = F.json(f, "line"), gd = normalise(sub(gl.end, gl.start));
    const den = d[0] * gd[1] - d[1] * gd[0]; if (Math.abs(den) < 1e-9) continue;
    const t = ((gl.start[0] - o[0]) * gd[1] - (gl.start[1] - o[1]) * gd[0]) / den;
    if (t < 0 || t > Lv) continue;
    const OV = doc.argValue(v, "overrides") || {}, gt = OV.__gridTop, top = gt != null ? gt : F.real(v, "top") + 600, bot = OV.__gridBottom != null ? OV.__gridBottom : -300;
    // over the drawing (annotation): Revit's solid end under the head and its centre segment dashed, in its own colour
    const AS = annotationStyle(doc), endL = AS.gridEnd * S, gw = penWeight(doc, "hairline", S);
    if (endL > 0 && top - bot > 2 * endL) {
      B.stroke([lineSeg([t, top - endL], [t, top])], { weight: gw, colour: "#000" }, "IfcGrid", doc.idOf(f));
      B.stroke([lineSeg([t, bot], [t, top - endL])], { weight: gw, colour: AS.gridCentreColour || "#000", dash: LINE_TYPES.centre }, "IfcGrid", doc.idOf(f));
    } else B.stroke([lineSeg([t, bot], [t, top])], { weight: gw, colour: "#000", dash: LINE_TYPES.centre }, "IfcGrid", doc.idOf(f));
    if ((F.choice(f, "ends") || "Both ends") !== "None") gridHead(doc, B, f, B.P([t, top]), [0, 1], { weight: penWeight(doc, "thin", S), colour: "#000" }, doc.idOf(f));
    // pickable along its line and by its bubble
    B.hit(doc.idOf(f), [[t, bot], [t, top]], "curve");
    const hr = (F.real(f, "headSize") || 8) / 2, R_ = hr * S, bc = [t, top + hr * S];
    B.hit(doc.idOf(f), [[bc[0] - R_, bc[1] - R_], [bc[0] + R_, bc[1] - R_], [bc[0] + R_, bc[1] + R_], [bc[0] - R_, bc[1] + R_]]);
  }
}
/** Items seen beyond the view plane, nearest first, each hidden by what is in front (and by the cut, in a section). */
/** A body's face toward the viewer, filled as its material's surface: the render's colour and pattern (a lime
 *  render's stipple, a brick's courses) under the lines, farthest first so nearer faces cover it. Only
 *  materials that give their surface a background or a pattern are filled; the rest stay line drawings. */
function surfaceOf(doc, it) {
  const f = it.f, t = doc.typeOf(f);
  let m = null;
  if (t === "Wall") { const w = doc.plan(f); if (w && w.stack && w.stack.layers.length) { const L = w.stack.layers; m = L.length === 1 ? L[0].material : (it.nearMaterial || L[0].material); } }
  else if (t === "Generic" || t === "Lattice") m = F.text(f, "material");
  else if (t === "Floor" && it.cat === "IfcSlab") m = null;
  const mp = m && (doc.lib.materials[m] || {}).projection;
  return mp && (mp.background || mp.pattern) ? { m, bg: mp.background || null, pat: mp.pattern || null, colour: mp.patternColour || mp.lineColour || "#a6a6a6" } : null;
}
function drawSurfaces(doc, ctx, B, vis) {
  const out = [], S = ctx.scale;
  // only worth it where some surface is coloured: then every nearer face covers it (a white wall too)
  if (!vis.some(it => surfaceOf(doc, it)) && !(ctx.style && ctx.style.surfaceShade)) return out;
  for (const it of vis.slice().reverse()) {
    // a face with no colour of its own is paper white - or the style's shade (a shaded view's walls in shadow)
    // a rule may give an element its own face colour (a shaded view's sunlit parapets, white)
    const lit = (ctx.rules || (ctx.style && ctx.style.rules) || []).find(r => r.enabled !== false && r.then && r.then.surface && ruleMatch(doc, it.f, r));
    const shade = lit ? lit.then.surface : (ctx.style && ctx.style.surfaceShade) || "#ffffff";
    const sf = (lit ? { bg: shade, pat: null } : null) || surfaceOf(doc, it) || (it.cat === "IfcWall" || it.cat === "IfcSlab" || it.cat === "IfcColumn" || it.face ? { bg: it.cat === "IfcWall" ? shade : "#ffffff", pat: null } : null); if (!sf) continue;
    let polys = it.sil && it.sil.length ? it.sil : null;
    if (doc.typeOf(it.f) === "Lattice") polys = it.bricks || null;
    else if (!polys && it.face) polys = it.face;
    else if (!polys && it.box) polys = [it.box];
    if (!polys) continue;
    const path = polys.flatMap(q => polyPath(q.map(p => B.P(p))));
    if (sf.bg) out.push({ t: "fill", path, colour: sf.bg, layer: it.cat + "-Surface", id: it.id });
    const pat = sf.pat && doc.lib.patterns[sf.pat];
    if (pat) out.push({ t: "hatch", path, pattern: Object.assign({ id: sf.pat }, pat), scale: pat.kind === "model" ? 1 / S : 1, colour: sf.colour, weight: penWeight(doc, "hairline", S), layer: it.cat + "-Surface", id: it.id });
  }
  return out;
}
/** Walls whose faces toward the eye run on flush (a facade turning its rounded corner, a party wall's end in
 *  the facade line) read as one surface: an upright edge of one lying on or in another, at the same depth,
 *  is not drawn where the other stands. */
function flushCut(it, vis) {
  if (it.cat !== "IfcWall") return it.curves;
  const others = vis.filter(o => o !== it && o.cat === "IfcWall" && Math.abs(o.depth - it.depth) < 5);
  if (!others.length) return it.curves;
  const out = [];
  for (const [a, b] of it.curves) {
    if (Math.abs(a[0] - b[0]) > 0.5) { out.push([a, b]); continue; }
    // the edge goes only where the flush faces stand on both its sides (inside the one surface they read as);
    // where nothing flush stands on one side it is the surface's own outline (a turning corner) and stays
    const x = a[0], lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    const spans = (walls, side) => { const o = []; for (const w of walls) for (const q of w.sil || []) { const qs = q.map(p => p[0]), zs = q.map(p => p[1]);
      if (x + side * 3 >= Math.min(...qs) - 0.5 && x + side * 3 <= Math.max(...qs) + 0.5 && (side < 0 ? Math.min(...qs) < x - 0.5 : Math.max(...qs) > x + 0.5)) o.push([Math.min(...zs), Math.max(...zs)]); } return o; };
    const near = others.filter(o => x >= o.s0 - 2 && x <= o.s1 + 2);
    const L = spans([it, ...near], -1), R = spans([it, ...near], 1), O = [...spans(near, -1), ...spans(near, 1)];
    const cover = (zs, z) => zs.some(([z0, z1]) => z >= z0 - 0.5 && z <= z1 + 0.5);
    const cuts = [...new Set([lo, hi, ...[...L, ...R, ...O].flat().filter(z => z > lo && z < hi)])].sort((p, q) => p - q);
    let pieces = [];
    for (let k = 0; k < cuts.length - 1; k++) { const m = (cuts[k] + cuts[k + 1]) / 2;
      if (cover(L, m) && cover(R, m) && cover(O, m)) continue;
      const last = pieces[pieces.length - 1]; if (last && Math.abs(last[1] - cuts[k]) < 1e-6) last[1] = cuts[k + 1]; else pieces.push([cuts[k], cuts[k + 1]]); }
    pieces = pieces.filter(([p0, p1]) => p1 - p0 > 1);
    for (const [p0, p1] of pieces) out.push([[x, p0], [x, p1]]);
  }
  return out;
}
function drawProjection(doc, ctx, B, vis, G, occluders) {
  const S = ctx.scale;
  // the faces first, under everything drawn so far (the level lines read across a facade)
  B.prims.unshift(...drawSurfaces(doc, ctx, B, vis));
  for (const it0 of vis) {
    const it = it0.cat === "IfcWall" ? Object.assign({}, it0, { curves: flushCut(it0, vis) }) : it0;
    const bandIdx = Math.min(2, Math.floor(Math.max(0, it.depth) / (G.depthMax / 3 + 1e-9)));
    const pen = ["medium", "thin", "hairline"][bandIdx];
    const g = resolveGraphics(doc, ctx, it.f, "projection");
    const gw = { weight: g.weight === "none" ? "none" : penWeight(doc, pen, S), colour: g.colour, dash: g.dash };
    for (const [a, b] of it.curves) {
      let pieces = [[a, b]];
      for (const occ of occluders) { const next = []; for (const [p, q] of pieces) next.push(...segMinusConvex(p, q, occ, 1e-3)); pieces = next; if (!pieces.length) break; }
      for (const [p, q] of pieces) B.stroke([lineSeg(p, q)], gw, it.cat, it.id);
    }
    for (const s of it.sil) occluders.push(ensureCCW(s));
    // a profile standing on a work plane (a moulding, a surround, a shutter) hides what is behind its face:
    // the face, holes and all, as triangles (the occluders are convex)
    if (it.face && it.face.length && it.cat !== "IfcWall") {
      const loops = it.face.filter(l => l.length >= 3 && Math.abs(polyArea(l)) > 1);
      if (loops.length) {
        const byArea = loops.slice().sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
        const outer = ensureCCW(byArea[0]), holes = byArea.slice(1).map(l => ensureCCW(l).slice().reverse());
        const cap = holes.length ? bridgeHoles(outer, holes) : outer;
        for (const [i, j, k] of triangulate(cap)) { const t = [cap[i], cap[j], cap[k]]; if (Math.abs(polyArea(t)) > 1) occluders.push(ensureCCW(t)); }
      }
    }
    // hits carry depth, so a click takes what is in front; a door or window sits just before its wall
    const dep = Math.max(0, it.depth) + 1;
    for (const s of it.sil) B.hit(it.id, s, "region", dep);
    for (const fh of it.fillerHits || []) B.hit(fh.id, fh.poly, "region", dep - 0.5);
  }
}

// ---------------------------------------------------------------- sections: the cut, blended
//! A section cuts every wall, floor, beam and column the line crosses into rectangles of
//! material in (along, height). Where a floor meets a wall the two overlap; the layer
//! priority that trims walls at a T in plan decides here which one stops. The outline is
//! then read off a grid of the rectangles' edges: a line is drawn only where the material
//! changes, so a slab running into a wall of the same concrete is one piece of poché.
/** Where the view line crosses a plan polygon: [s0, s1] intervals along the line. */
function lineIntervals(poly, G) {
  const { o, d, Lv } = G, n = perp(d), ts = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = dot(sub(a, o), n), db = dot(sub(b, o), n);
    if ((da > 0) === (db > 0) || da === db) continue;
    const t = da / (da - db), p = add(a, mul(sub(b, a), t));
    ts.push(dot(sub(p, o), d));
  }
  ts.sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i += 2) { const s0 = Math.max(0, ts[i]), s1 = Math.min(Lv, ts[i + 1]); if (s1 - s0 > 0.5) out.push([s0, s1]); }
  return out;
}
const rectMinus = (r, k) => {
  if (k.s1 <= r.s0 || k.s0 >= r.s1 || k.z1 <= r.z0 || k.z0 >= r.z1) return [r];
  const out = [], mk = (s0, s1, z0, z1) => { if (s1 - s0 > 1e-6 && z1 - z0 > 1e-6) out.push(Object.assign({}, r, { s0, s1, z0, z1 })); };
  mk(r.s0, k.s0, r.z0, r.z1); mk(k.s1, r.s1, r.z0, r.z1);
  const s0 = Math.max(r.s0, k.s0), s1 = Math.min(r.s1, k.s1);
  mk(s0, s1, r.z0, k.z0); mk(s0, s1, k.z1, r.z1);
  return out;
};
/** The cut: material rectangles, their conflicts resolved by priority. */
/** Where a plan cuts a mesh body. Upright instances of one shared shape cut at the same height share
 *  one slice (a building's hundred basins are sliced once), placed by each instance's frame. */
const MESH_SLICES = new Map();
function meshPlates(doc, p, cutZ) {
  const fr = p.meshFrame, shape = p.meshShape && doc.lib.meshes && doc.lib.meshes[p.meshShape];
  if (!fr || !shape || Math.abs(fr.z[2] - 1) > 1e-6 || Math.abs(fr.x[2]) > 1e-6 || Math.abs(fr.y[2]) > 1e-6) return plateAt(p.mesh, cutZ).plates;
  const h = Math.round((cutZ - fr.o[2]) * 10) / 10;
  let byH = MESH_SLICES.get(shape); if (!byH) { if (MESH_SLICES.size > 4000) MESH_SLICES.clear(); byH = new Map(); MESH_SLICES.set(shape, byH); }
  let local = byH.get(h); if (!local) { local = plateAt(shape, h).plates; byH.set(h, local); }
  const put = q => [fr.o[0] + fr.x[0] * q[0] + fr.y[0] * q[1], fr.o[1] + fr.x[1] * q[0] + fr.y[1] * q[1]];
  return local.map(pl => ({ outer: pl.outer.map(put), holes: pl.holes.map(hh => hh.map(put)) }));
}
/** A mesh body's feature edges, worked out once per shared shape (every instance has the same indices). */
const MESH_EDGES = new Map();
function meshEdges(doc, shapeId, mesh) {
  const shape = shapeId && doc.lib.meshes && doc.lib.meshes[shapeId]; const key = shape || mesh;
  let e = MESH_EDGES.get(key); if (!e) { e = featureEdges(shape || mesh); if (MESH_EDGES.size > 4000) MESH_EDGES.clear(); MESH_EDGES.set(key, e); }
  return e;
}
export function sectionCut(doc, v) {
  const ctx = viewContext(doc, v), G = viewLineGeometry(doc, v);
  const rects = [], cutIds = new Set(), polys = [];
  const push = (f, kind, s0, s1, z0, z1, material, priority) => { rects.push({ id: doc.idOf(f), kind, s0, s1, z0: z0 - G.Z0, z1: z1 - G.Z0, material, priority }); cutIds.add(doc.idOf(f)); };
  const detail = ctx.detail === "Coarse" ? "Coarse" : "Fine";
  for (const f of doc.elements()) {
    if (f.get("Integer") === 0 || doc.error(f) || !categoryVisible(ctx, categoryOf(doc, f)) || hiddenByRule(doc, ctx, f)) continue;
    const t = doc.typeOf(f), p = doc.plan(f); if (!p) continue;
    if (t === "Wall" && p.stack) {
      const regs = wallRegions(p, detail, -Infinity, []);
      for (const r of regs) {
        if (r.bevel) continue;
        const L = r.layer === null ? null : p.stack.layers[r.layer];
        for (const [s0, s1] of lineIntervals(samplePath(r.path, 24), G)) {
          // openings the line passes through take their height out of the wall
          const mid = add(G.o, mul(G.d, (s0 + s1) / 2)), u = uOf(p, mid);
          let spans = [[p.z0, p.z1]];
          for (const op of p.openings || []) if (u > op.u0 && u < op.u1) spans = spans.flatMap(([a, b]) => [[a, Math.min(b, p.z0 + op.sill)], [Math.max(a, p.z0 + op.sill + op.h), b]]).filter(([a, b]) => b - a > 1e-6);
          for (const [z0, z1] of spans) push(f, "wall", s0, s1, z0, z1, r.material, L ? L.priority : 1);
        }
      }
    }
    if ((t === "Generic" || t === "Duct" || t === "Pipe" || t === "Roof" || t === "Lattice" || t === "Stair" || t === "Toposurface" || t === "Planting" || t === "Railing" || t === "Ramp") && p.mesh) {
      // a body of its own shape, cut by the section plane: turned into (along, up, depth) and sliced at depth 0
      const P = p.mesh.positions, Q = new Array(P.length); let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < P.length; i += 3) { const q = [P[i], P[i + 1]], dd = G.depthOf(q); Q[i] = G.sOf(q); Q[i + 1] = P[i + 2] - G.Z0; Q[i + 2] = dd; lo = Math.min(lo, dd); hi = Math.max(hi, dd); }
      if (lo < 0 && hi > 0) {
        const loops = sliceMesh({ positions: Q, index: p.mesh.index }, 0).filter(l => l.closed && l.pts.length >= 3).map(l => l.pts);
        if (loops.length) { polys.push({ id: doc.idOf(f), material: p.material, loops, cat: categoryOf(doc, f) }); cutIds.add(doc.idOf(f)); }
      }
      continue;
    }
    if ((t === "Floor" || t === "Beam" || t === "Generic") && p.parts) for (const part of p.parts) {
      const pr = LAYER_PRIORITY[part.sub] ?? (t === "Beam" ? 1 : 4);
      // a floor's holes take their stretch out of the cut
      const holesAlong = (part.holes || []).flatMap(hh => lineIntervals(hh, G));
      for (const [a0, a1] of lineIntervals(part.foot, G)) for (const [s0, s1] of holesAlong.reduce((acc, [h0, h1]) => acc.flatMap(([x0, x1]) => [[x0, Math.min(x1, h0)], [Math.max(x0, h1), x1]].filter(([u, v]) => v - u > 0.5)), [[a0, a1]]))
        push(f, t === "Floor" ? "floor" : t === "Generic" ? "generic" : "beam", s0, s1, part.z0, part.z1, part.material, pr);
    }
    if (t === "Column") { const foot = p.foot.length ? p.foot : samplePath(p.path); for (const [s0, s1] of lineIntervals(foot, G)) push(f, "column", s0, s1, p.z0, p.z1, p.material, 1); }
  }
  // conflicts: where a floor layer and a wall (or column) layer overlap, the stronger layer runs
  // through and the other gives way - a wall layer wins only when it strictly outranks the floor's,
  // so a slab bears over a wall's structure and a screed runs to a wall's plaster
  const floors = rects.filter(r => r.kind === "floor"), others = rects.filter(r => r.kind !== "floor");
  const upright = w => w.kind === "wall" || w.kind === "column";
  const fl = floors.flatMap(r => others.filter(w => upright(w) && w.priority < r.priority).reduce((acc, w) => acc.flatMap(x => rectMinus(x, w)), [r]));
  const ot = others.flatMap(w => !upright(w) ? [w] : floors.filter(r => !(w.priority < r.priority)).reduce((acc, r) => acc.flatMap(x => rectMinus(x, r)), [w]));
  return { rects: fl.concat(ot), cutIds, G, ctx, polys };
}
export function sectionScene(doc, v, opts = {}) {
  const { rects, cutIds, G, ctx, polys } = sectionCut(doc, v);
  const S = ctx.scale, B = new SceneBuilder(S);
  drawDatums(doc, ctx, B, v, G);
  // beyond the cut: as an elevation, hidden behind the cut itself
  const items = gatherElevationItems(doc, ctx, G, cutIds).filter(it => it.depthMax >= -TOL && it.depth >= -TOL && it.depth <= G.depthMax && it.s1 >= 0 && it.s0 <= G.Lv)
    .sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1));
  const occ = rects.map(r => [[r.s0, r.z0], [r.s1, r.z0], [r.s1, r.z1], [r.s0, r.z1]]);
  // a cut mesh body hides what is behind it by its box (a convex stand-in for its outline)
  for (const pg of polys) for (const l of pg.loops) { const xs = l.map(q => q[0]), zs = l.map(q => q[1]); occ.push([[Math.min(...xs), Math.min(...zs)], [Math.max(...xs), Math.min(...zs)], [Math.max(...xs), Math.max(...zs)], [Math.min(...xs), Math.max(...zs)]]); }
  drawProjection(doc, ctx, B, items, G, occ.slice());
  // the cut: fills and hatches per rectangle, then the outline off the grid
  const matOf = m => doc.lib.materials[m] || {};
  for (const r of rects) {
    const path = polyPath([[r.s0, r.z0], [r.s1, r.z0], [r.s1, r.z1], [r.s0, r.z1]].map(q => B.P(q)));
    const cat = { wall: "IfcWall", floor: "IfcSlab", beam: "IfcBeam", column: "IfcColumn" }[r.kind];
    // each layer draws as its material, through the same resolution as the plan: V/G, filters and the
    // category's material priority all apply to what a section cuts
    const el = doc.element(r.id), g = el ? resolveGraphics(doc, ctx, el, "cut", "Layer", r.material) : null;
    if (g && !g.visible) continue;
    const mc = matOf(r.material).cut || {};
    const fill = g ? (g.pattern === "solid" ? g.fill || "#000000" : g.fillNone ? null : g.fill || mc.background || "#e9eaec") : mc.background || "#e9eaec";
    if (fill) B.fill(path, fill, cat, r.id, true);
    const pat = g ? (g.pattern === "solid" ? null : g.pattern) : mc.pattern;
    if (pat && doc.lib.patterns[pat]) { const gp = el ? resolveGraphics(doc, ctx, el, "cutPattern", "Layer", r.material) : { colour: mc.lineColour || "#000" }; B.hatch(path, doc.lib.patterns[pat], pat, gp.colour || "#000", penWeight(doc, "hairline", S), cat, r.id, true); }
    B.mat.push({ id: r.id, material: r.material, poly: [[r.s0, r.z0], [r.s1, r.z0], [r.s1, r.z1], [r.s0, r.z1]] });
    B.hit(r.id, [[r.s0, r.z0], [r.s1, r.z0], [r.s1, r.z1], [r.s0, r.z1]]);
  }
  for (const pg of polys) {
    const el = doc.element(pg.id), g = el ? resolveGraphics(doc, ctx, el, "cut") : null; if (g && !g.visible) continue;
    const mc = (doc.lib.materials[pg.material] || {}).cut || {}, path = pg.loops.flatMap(l => polyPath(l.map(q => B.P(q))));
    B.fill(path, g && g.pattern === "solid" ? g.fill || "#000" : (g && g.fill) || mc.background || "#e9eaec", pg.cat, pg.id, true);
    B.stroke(pg.loops.flatMap(l => polyPath(l)), { weight: penWeight(doc, "heavy", S), colour: "#000" }, "Section-Cut", pg.id);
    for (const l of pg.loops) B.hit(pg.id, l);
  }
  for (const e of cutOutline(rects)) B.stroke([lineSeg(e.a, e.b)], { weight: penWeight(doc, e.outer ? "heavy" : "thin", S), colour: "#000" }, "Section-Cut", e.id);
  drawViewAnnotations(doc, ctx, B, v);
  const scene = { prims: B.prims, hits: B.hits, links: [], scale: S, kind: "section", mat: B.mat, stats: { cut: rects.length, beyond: items.length } };
  applyCrop(doc, v, doc.argValue(v, "clip"), scene, S);
  return scene;
}
/** Edges between cells of different material on the grid of all rectangle edges; outer when one side is empty. */
export function cutOutline(rects) {
  if (!rects.length) return [];
  const xs = [...new Set(rects.flatMap(r => [r.s0, r.s1]).map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap(r => [r.z0, r.z1]).map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const nx = xs.length - 1, nz = zs.length - 1, cell = new Array(nx * nz).fill(null), owner = new Array(nx * nz).fill(null);
  const ix = v => xs.findIndex(x => Math.abs(x - v) < 1e-3), iz = v => zs.findIndex(z => Math.abs(z - v) < 1e-3);
  for (const r of rects) {
    const i0 = ix(Math.round(r.s0 * 1000) / 1000), i1 = ix(Math.round(r.s1 * 1000) / 1000), j0 = iz(Math.round(r.z0 * 1000) / 1000), j1 = iz(Math.round(r.z1 * 1000) / 1000);
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) { cell[j * nx + i] = r.material || "?"; owner[j * nx + i] = r.id; }
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz) ? null : cell[j * nx + i];
  const edges = [];
  const add_ = (a, b, outer, id) => { const last = edges[edges.length - 1]; if (last && last.outer === outer && Math.abs(last.b[0] - a[0]) < 1e-6 && Math.abs(last.b[1] - a[1]) < 1e-6 && ((last.a[0] === last.b[0]) === (a[0] === b[0]))) { last.b = b; return; } edges.push({ a, b, outer, id }); };
  for (let i = 0; i <= nx; i++) for (let j = 0; j < nz; j++) { const L = at(i - 1, j), R = at(i, j); if (L !== R) add_([xs[i], zs[j]], [xs[i], zs[j + 1]], L === null || R === null, owner[j * nx + Math.min(i, nx - 1)] || owner[j * nx + Math.max(0, i - 1)]); }
  for (let j = 0; j <= nz; j++) for (let i = 0; i < nx; i++) { const D = at(i, j - 1), U = at(i, j); if (D !== U) add_([xs[i], zs[j]], [xs[i + 1], zs[j]], D === null || U === null, owner[Math.min(j, nz - 1) * nx + i] || owner[Math.max(0, j - 1) * nx + i]); }
  return edges;
}

/** A wall's elevation rep and silhouette, from its construction — not from a solid. */
function elevWall(doc, f, w, V, sOf, depthOf, ctx) {
  const fillerHits = [];
  const regs = wallRegions(w, "Coarse", -Infinity, []);
  if (!regs.length) return null;
  const foot = samplePath(regs[0].path, 24);
  const ss = foot.map(sOf), dd = foot.map(depthOf);
  const s0 = Math.min(...ss), s1 = Math.max(...ss);
  const topAt = p => wallTop(w, p);
  const iMin = ss.indexOf(s0), iMax = ss.indexOf(s1);
  const zt0 = topAt(foot[iMin]), zt1 = topAt(foot[iMax]);
  const baseZ = V(foot[0], w.z0)[1], t0 = V(foot[0], zt0)[1], t1 = V(foot[0], zt1)[1];
  const curves = [[[s0, baseZ], [s1, baseZ]], [[s1, baseZ], [s1, t1]], [[s0, t0], [s0, baseZ]]];
  let profileLine = null;
  // the top: straight, or through every corner of a profiled top (a gable, steps) along the face nearer the eye
  if (w.profile && w.curve.type === "line") {
    const n0 = w.stack.s.length - 1, sNear = depthOf(pointAt(w, w.stack.s[0], w.L / 2)) <= depthOf(pointAt(w, w.stack.s[n0], w.L / 2)) ? w.stack.s[0] : w.stack.s[n0];
    const top = [];
    for (const [u] of w.profile) for (const side of [-1, 1]) { const p = pointAt(w, sNear, u); top.push([sOf(p), V(p, wallTop(w, p, side))[1]]); }
    const line = top.filter((q, i) => i === 0 || Math.abs(q[0] - top[i - 1][0]) > 1e-6 || Math.abs(q[1] - top[i - 1][1]) > 1e-6);
    for (let i = 0; i < line.length - 1; i++) curves.push([line[i], line[i + 1]]);
    profileLine = line[0][0] <= line[line.length - 1][0] ? line : line.slice().reverse();
  } else curves.push([[s1, t1], [s0, t0]]);
  // Vertical edges at footprint corners that face the viewer.
  const n = w.stack.s.length - 1;
  const corners = regs[0].edges.map(e => segStart(e.seg));
  for (const p of corners) {
    const sp = sOf(p); if (sp <= s0 + 1 || sp >= s1 - 1) continue;
    const front = frontDepth(foot, sOf, depthOf, sp);
    if (depthOf(p) <= front + 2) curves.push([[sp, baseZ], [sp, V(p, topAt(p))[1]]]);
  }
  // Openings: near-face rectangle, and the see-through hole cut from the silhouette.
  const holes = [];
  const nearS = (() => { const a = depthOf(pointAt(w, w.stack.s[0], w.L / 2)), b = depthOf(pointAt(w, w.stack.s[n], w.L / 2)); return a <= b ? w.stack.s[0] : w.stack.s[n]; })();
  for (const op of w.openings || []) {
    const a1 = sOf(pointAt(w, w.stack.s[0], op.u0)), b1 = sOf(pointAt(w, w.stack.s[0], op.u1));
    const a2 = sOf(pointAt(w, w.stack.s[n], op.u0)), b2 = sOf(pointAt(w, w.stack.s[n], op.u1));
    const za = V(foot[0], w.z0 + op.sill)[1], zb2 = V(foot[0], Math.min(w.z0 + op.sill + op.h, w.zHi ?? w.z1))[1];
    const na = sOf(pointAt(w, nearS, op.u0)), nb = sOf(pointAt(w, nearS, op.u1));
    const lo = Math.min(na, nb), hi = Math.max(na, nb);
    curves.push([[lo, za], [hi, za]], [[hi, za], [hi, zb2]], [[hi, zb2], [lo, zb2]], [[lo, zb2], [lo, za]]);
    // a hole to see through, unless a door or window drawn here fills it (its leaf or glass stands in front)
    const filled = ctx && doc.elements().some(g => (doc.typeOf(g) === "Door" || doc.typeOf(g) === "Window") && F.refId(g, "fills") === op.id && categoryVisible(ctx, categoryOf(doc, g)));
    if (!op.recess && !filled) { const sa = Math.max(Math.min(a1, b1), Math.min(a2, b2)), sb = Math.min(Math.max(a1, b1), Math.max(a2, b2)); if (sb - sa > 1) holes.push([sa, sb, za, zb2]); }
    // a bare opening is picked by its own outline here (a filled one through its door or window, below)
    if (op.id && !doc.elements().some(g => (doc.typeOf(g) === "Door" || doc.typeOf(g) === "Window") && F.refId(g, "fills") === op.id)) fillerHits.push({ id: op.id, poly: [[lo, za], [hi, za], [hi, zb2], [lo, zb2]] });
    // the filler's own elevation rep, mapped from host (u, z)
    for (const g of doc.elements()) if ((doc.typeOf(g) === "Door" || doc.typeOf(g) === "Window") && (!ctx || categoryVisible(ctx, categoryOf(doc, g))) && doc.data(g) && doc.data(g).frame && doc.data(g).frame.u0 === op.u0 && doc.data(g).host === w.id) {
      const er = doc.elev(g); if (!er) continue;
      const mapU = u => sOf(pointAt(w, nearS, u)), mapZ = z => V(foot[0], w.z0 + z)[1];
      for (const r of er.rects || []) { const x0 = mapU(r.u0), x1 = mapU(r.u1), y0 = mapZ(r.z0), y1 = mapZ(r.z1); curves.push([[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]); }
      // a door or window is picked by its own outline, not its host wall's
      if ((er.rects || []).length) { const r = er.rects[0], x0 = mapU(r.u0), x1 = mapU(r.u1), y0 = mapZ(r.z0), y1 = mapZ(r.z1); fillerHits.push({ id: doc.idOf(g), poly: [[Math.min(x0, x1), y0], [Math.max(x0, x1), y0], [Math.max(x0, x1), y1], [Math.min(x0, x1), y1]] }); }
      for (const l of er.lines || []) curves.push([[mapU(l.u0), mapZ(l.z0)], [mapU(l.u1), mapZ(l.z1)]]);
    }
  }
  // Silhouette minus see-through holes, as convex slabs (for the occluder list).
  const sil = [];
  const cuts = [...new Set([s0, s1, ...holes.flatMap(h => [h.s0 ?? h[0], h[1]]), ...(profileLine ? profileLine.map(q => q[0]) : [])])].filter(x => x >= s0 && x <= s1).sort((a, b) => a - b);
  const topLine = s => {
    if (!profileLine) return t0 + (t1 - t0) * ((s - s0) / ((s1 - s0) || 1));
    for (let k = 1; k < profileLine.length; k++) { const a = profileLine[k - 1], b = profileLine[k]; if (s <= b[0] + 1e-9) return b[0] - a[0] < 1e-9 ? Math.min(a[1], b[1]) : a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]); }
    return profileLine[profileLine.length - 1][1];
  };
  for (let i = 0; i < cuts.length - 1; i++) {
    const sa = cuts[i], sb = cuts[i + 1]; if (sb - sa < TOL) continue;
    const m = (sa + sb) / 2;
    const zs = holes.filter(h => h[0] <= m && h[1] >= m).map(h => [h[2], h[3]]).sort((a, b) => a[0] - b[0]);
    let z = baseZ;
    for (const [ha, hb] of zs) { if (ha > z) sil.push([[sa, z], [sb, z], [sb, ha], [sa, ha]]); z = Math.max(z, hb); }
    sil.push([[sa, z], [sb, z], [sb, topLine(sb)], [sa, topLine(sa)]]);
  }
  return { id: w.id, f, fillerHits, depth: Math.max(0, Math.min(...dd)), depthMax: Math.max(...dd), s0, s1, curves, sil: sil.length ? sil : [[[s0, baseZ], [s1, baseZ], [s1, t1], [s0, t0]]], cat: "IfcWall" };
}
function frontDepth(foot, sOf, depthOf, s) {
  let best = Infinity;
  for (let i = 0; i < foot.length - 1; i++) {
    const a = foot[i], b = foot[i + 1], sa = sOf(a), sb = sOf(b);
    if ((sa - s) * (sb - s) > 0 || Math.abs(sb - sa) < 1e-9) continue;
    const t = (s - sa) / (sb - sa); best = Math.min(best, depthOf(a) + (depthOf(b) - depthOf(a)) * t);
  }
  return best;
}

// ---------------------------------------------------------------- 3D (§6.4)
let HLR = null;
export function setHLR(h) { HLR = h; }
/** A 3D view on a sheet shows cached line-work; it is never interactive. The
 *  cache key is (camera, model revision, visible set); stale is shown as stale. */
/** What this view's Visibility/Graphics leaves out, as one comparable string: part of the 3D cache key. */
export function visibilityKey(doc, v) {
  const ctx = viewContext(doc, v);
  return Object.keys(doc.lib.categories).filter(c => !categoryVisible(ctx, c)).sort().join(",");
}
/** Does this view show this element? Hidden elements and categories switched off in its style are out. */
export function shownInView(doc, v, f) {
  if (f.get("Integer") === 0) return false;
  return categoryVisible(viewContext(doc, v), categoryOf(doc, f));
}
/** How a 3D view is drawn on a sheet: its vector hidden-line work, a raster of the model under it, or both.
 *  raster names the look the snapshot is taken in (a visual style, or "White": every face white); sun puts
 *  the view's sun (or a default one) in it, hard shadows and all. */
export const SHEET_DISPLAYS = [
  { key: "hidden", label: "Hidden line", lines: true },
  { key: "hiddenDashed", label: "Hidden line, hidden edges dashed", lines: true, hidden: true },
  { key: "shadedEdges", label: "Shaded with edges", lines: true, raster: "Shaded" },
  { key: "shaded", label: "Shaded", raster: "Shaded" },
  { key: "consistentEdges", label: "Consistent colours with edges", lines: true, raster: "Consistent Colors" },
  { key: "rendered", label: "Rendered - sun and shadows", raster: "Shaded", sun: true },
  { key: "renderedEdges", label: "Rendered with edges", lines: true, raster: "Shaded", sun: true },
  { key: "whiteShadows", label: "White model, hard shadows, edges", lines: true, raster: "White", sun: true },
];
/** The display a view's render settings ask for (older files: mode lines / linesOverShaded, hidden on or off). */
export const rasterLook = d => d.raster ? d.raster + (d.sun ? "+sun" : "") : "";
export function sheetDisplayOf(render = {}) {
  const d = SHEET_DISPLAYS.find(x => x.key === render.display);
  if (d) return d;
  if (render.mode === "linesOverShaded") return SHEET_DISPLAYS.find(x => x.key === "shadedEdges");
  return SHEET_DISPLAYS.find(x => x.key === (render.hidden ? "hiddenDashed" : "hidden"));
}
export function view3dScene(doc, v, opts = {}) {
  const ctx = viewContext(doc, v), S = ctx.scale, B = new SceneBuilder(S);
  const cache = doc._hlrCache && doc._hlrCache[doc.idOf(v)];
  const cam = JSON.stringify(doc.argValue(v, "camera"));
  const scene = { prims: B.prims, hits: [], links: [], scale: S, kind: "3d" };
  if (cache && cache.camera === cam && (cache.vis || "") !== visibilityKey(doc, v)) scene.stale = "Visibility/Graphics changed since generation";
  if (cache && cache.camera === cam && (cache.box || "") !== sectionBoxKey(doc, v)) scene.stale = "the section box changed since generation";
  if (!cache || cache.camera !== cam) { scene.stale = "never generated"; B.text([0, 0], "Hidden-line view not generated yet", 3, {}); scene.bbox = [-5, -5, 120, 10]; return scene; }
  if (cache.revision !== doc.modelRevision) scene.stale = `model changed since generation (rev ${cache.revision} → ${doc.modelRevision})`;
  const render = doc.argValue(v, "render") || {}, disp = sheetDisplayOf(render);
  const style = ctx.style.byCategory && ctx.style.byCategory.View3D || {};
  const slots = { visible: { pen: "medium", on: !!disp.lines }, outlineV: { pen: "medium", on: !!disp.lines }, smoothV: { pen: "hairline", on: false }, hidden: { pen: "hairline", on: !!disp.hidden, dash: LINE_TYPES.hidden }, outlineH: { pen: "hairline", on: !!disp.hidden, dash: LINE_TYPES.hidden } };
  // the raster must be the one this display asks for: another (or none) is regenerated
  // the image must be taken in this display's look (the same image serves with or without the edges)
  if (disp.raster && (!cache.raster || rasterLook(SHEET_DISPLAYS.find(x => x.key === cache.rasterDisplay) || SHEET_DISPLAYS[2]) !== rasterLook(disp))) scene.stale = scene.stale || `display changed to ${disp.label}`;
  if (cache.raster && disp.raster) B.prims.push({ t: "raster", rect: [cache.bbox[0] / S, cache.bbox[1] / S, (cache.bbox[2] - cache.bbox[0]) / S, (cache.bbox[3] - cache.bbox[1]) / S], url: cache.raster, dpi: cache.rasterDPI, layer: "Shaded" });
  for (const [cat, segs] of Object.entries(cache.lines)) {
    const sl = slots[cat]; if (!sl || !sl.on) continue;
    const w = cat === "outlineV" && render.silhouetteWeight ? render.silhouetteWeight : penWeight(doc, sl.pen, S);
    for (const [a, b] of segs) B.stroke([lineSeg(a, b)], { weight: w, colour: "#000", dash: sl.dash || null }, "HLR-" + cat, null);
  }
  scene.bbox = cache.bbox.map(x => x / S);
  return scene;
}

// ---------------------------------------------------------------- schedules
/** A schedule as a drawing (on a sheet): the same table the schedule view shows - title, grouped column
 *  headings, group headers and footers, totals, hidden columns left out, cells aligned and shaded as
 *  formatted. Paper millimetres. */
export function scheduleScene(doc, v) {
  const B = new SceneBuilder(1), T = scheduleTable(doc, v), A = T.settings.appearance, cols = T.visible.map(i => T.columns[i]);
  const h = 2.5, rowH = 6, pad = 2;
  const shown = r => r.kind === "header" || r.kind === "blank" ? [] : T.visible.map(i => r.cells[i].text || "");
  const colW = cols.map((c, n) => Math.max(textWidth(c.heading, h), ...T.rows.map(r => textWidth(shown(r)[n] || (n === 0 && r.text ? r.text : ""), h)), 6) + 2 * pad);
  const W = colW.reduce((a, b) => a + b, 0), xs = colW.reduce((acc, w) => (acc.push(acc[acc.length - 1] + w), acc), [0]);
  const groups = cols.some(c => c.group);
  const nRows = T.rows.length + (A.headers ? 1 : 0) + (A.headers && groups ? 1 : 0) + (A.blankRow ? 1 : 0);
  const H = nRows * rowH;
  const stroke = (a, b, w = 0.18) => B.prims.push({ t: "stroke", path: [lineSeg(a, b)], weight: w, colour: "#000", layer: "Schedule" });
  const fill = (x0, y0, x1, y1, colour) => B.prims.push({ t: "fill", path: rectPath(x0, y0, x1, y1), colour, layer: "Schedule" });
  const put = (x0, w, y, s, align, opts = {}) => { const tw = textWidth(s, opts.h || h), x = align === "right" ? x0 + w - pad - tw : align === "center" ? x0 + (w - tw) / 2 : x0 + pad; B.text([x, y + 2], s, opts.h || h, opts); };
  if (A.title) put(0, W, H + 1, T.title, "center", { h: 3.5 });
  let y = H;
  if (A.headers && groups) {
    y -= rowH;
    for (let i = 0; i < cols.length;) { let j = i; while (j + 1 < cols.length && cols[j + 1].group === cols[i].group) j++; if (cols[i].group) { put(xs[i], xs[j + 1] - xs[i], y, cols[i].group, "center"); stroke([xs[i], y], [xs[j + 1], y]); } i = j + 1; }
  }
  if (A.headers) { y -= rowH; cols.forEach((c, n) => put(xs[n], colW[n], y, c.heading, c.align || "center")); stroke([0, y], [W, y], 0.35); }
  if (A.blankRow) y -= rowH;
  T.rows.forEach((r, k) => {
    y -= rowH;
    if (r.kind === "blank") return;
    if (r.kind === "header") { put(0, W, y, r.text, "left"); if (A.gridlines) stroke([0, y], [W, y]); return; }
    if (A.stripes && k % 2) fill(0, y, W, y + rowH, "#f2f2f2");
    T.visible.forEach((i, n) => { const c = r.cells[i]; if (c.fill) fill(xs[n], y, xs[n + 1], y + rowH, c.fill); const s = n === 0 && r.text && !c.text ? r.text : c.text || ""; if (s) put(xs[n], colW[n], y, s, T.columns[i].align || (c.num != null ? "right" : "left")); });
    if (r.kind === "footer" || r.kind === "grand") stroke([0, y + rowH], [W, y + rowH], 0.25);
    if (A.gridlines) stroke([0, y], [W, y]);
  });
  if (A.gridlines) for (const x of xs.slice(1, -1)) stroke([x, y], [x, H - (A.headers && groups ? rowH : 0)]);
  if (A.outline) { stroke([0, y], [W, y], 0.35); stroke([0, H], [W, H], 0.35); stroke([0, y], [0, H], 0.35); stroke([W, y], [W, H], 0.35); }
  const scene = { prims: B.prims, hits: [], links: [], scale: 1, kind: "schedule" };
  scene.bbox = sceneBBox(B.prims);
  return scene;
}

// ---------------------------------------------------------------- sheets (§11)
/** How a sheet's diagrams become pictures: set by the page (the brief analysis draws them); absent in node. */
export const SHEET_DIAGRAMS = { url: null };
export function sheetScene(doc, sh, opts = {}) {
  const size = sheetSize(sh), [W, H] = size;
  const prims = [], links = [];
  // A quiet title block: a 5 mm margin, one fine border, and a slim band along the foot of the sheet -
  // project, drawing, scale, revision - closed on the right by the sheet number, set large.
  const border = 5, ink = "#1b1f24", grey = "#7a828c";
  const put = (path, w, colour = ink) => prims.push({ t: "stroke", path, weight: w, colour, layer: "TitleBlock" });
  const txt = (at, text, h, o = {}) => prims.push(Object.assign({ t: "text", at, text: String(text ?? ""), height: h, rot: 0, align: "left", valign: "baseline", colour: ink, layer: "TitleBlock" }, o));
  prims.push({ t: "fill", path: rectPath(0, 0, W, H), colour: "#ffffff", layer: "Paper" });
  const tb = doc.lib.symbols[F.refId(sh, "titleBlock")] || {};
  const band = tb.generated === "titleBand" || tb.generated === "fhaStrip";
  if (tb.generated === "titleBand") titleBand(doc, sh, W, H, put, txt);
  else if (tb.generated === "fhaStrip") fhaStrip(doc, sh, W, H, put, txt);
  else {
  put(rectPath(border, border, W - border, H - border), 0.35);
  const bh = Math.max(14, Math.min(24, H * 0.04)), y0 = border, y1 = border + bh, k = bh / 22;   // band height, and a text scale that follows it
  put([lineSeg([border, y1], [W - border, y1])], 0.35);
  const fit = (v, h, room) => Math.min(h, room / Math.max(1, textWidth(String(v ?? ""), 1)));
  // cells, right to left: number | revision & date | scale & size | drawing | project (takes the rest)
  const numW = Math.max(36, 70 * k), revW = 42 * k + 8, scW = 48 * k + 8, dwgW = Math.min(150, (W - 2 * border) * 0.3);
  const xs = [W - border - numW, W - border - numW - revW, W - border - numW - revW - scW, W - border - numW - revW - scW - dwgW];
  for (const x of xs) put([lineSeg([x, y0 + 2 * k], [x, y1 - 2 * k])], 0.13, "#9aa1a9");
  const label = (x, t) => txt([x + 3 * k, y1 - 4.2 * k], t.toUpperCase(), 1.6 * Math.max(1, k), { colour: grey });
  const value = (x, v, h, room) => txt([x + 3 * k, y0 + 5 * k], v, fit(v, h * k, room - 6 * k));
  const px = border;
  label(px, "Project"); value(px, doc.meta.name || "Untitled", 7, xs[3] - px);
  label(xs[3], "Drawing"); value(xs[3], doc.argValue(sh, "sheetName"), 5, dwgW);
  label(xs[2], "Scale"); txt([xs[2] + 3 * k, y0 + 9 * k], viewportScales(doc, sh) || "-", fit(viewportScales(doc, sh) || "-", 3.2 * k, scW - 6 * k));
  txt([xs[2] + 3 * k, y0 + 4 * k], `${doc.argValue(sh, "size")} ${doc.argValue(sh, "orientation") || ""}`, 2.2 * k, { colour: grey });
  label(xs[1], "Revision"); txt([xs[1] + 3 * k, y0 + 9 * k], doc.argValue(sh, "revision") || "-", 3.2 * k);
  txt([xs[1] + 3 * k, y0 + 4 * k], new Date().toISOString().slice(0, 10), 2.2 * k, { colour: grey });
  // the sheet number: the one thing read from across the room
  const num = doc.argValue(sh, "number") || "";
  txt([W - border - 3 * k, y1 - 4.2 * k], "SHEET", 1.6 * Math.max(1, k), { colour: grey, align: "right" });
  txt([W - border - 3 * k, y0 + 4 * k], num, fit(num, 11 * k, numW - 6 * k), { align: "right" });
  // a short dark rule over the number: the one accent
  prims.push({ t: "fill", path: rectPath(xs[0], y1 - 0.9 * k, W - border, y1), colour: ink, layer: "TitleBlock" });
  }
  // Viewports: a frame holding a view, positioned in paper mm (§11).
  const vps = doc.argValue(sh, "viewports") || [];
  vps.forEach((vp, i) => {
    const view = doc.element(vp.view.ref);
    if (!view) { txt(vp.at, `⚠ viewport ${vp.id}: view ${vp.view.ref} is missing`, 3, { colour: "#b3261e" }); return; }
    const sc = deriveView(doc, view, opts);
    const bb = sc.clip || sc.bbox;
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const off = [vp.at[0] - cx, vp.at[1] - cy];
    const clip = sc.clip ? [sc.clip[0] + off[0], sc.clip[1] + off[1], sc.clip[2] + off[0], sc.clip[3] + off[1]] : null;
    // with an annotation crop, the model is clipped to the crop (or its sketched loop) and annotation to the annotation crop
    const moved = sc.prims.map(p => translatePrim(p, off));
    const inner = sc.annoClip ? [
      { t: "group", clip, clipPath: sc.clipPath ? sc.clipPath.map(c => [c[0] + off[0], c[1] + off[1]]) : null, prims: moved.filter(p => !isAnnotationLayer(p.layer)) },
      { t: "group", clip: [sc.annoClip[0] + off[0], sc.annoClip[1] + off[1], sc.annoClip[2] + off[0], sc.annoClip[3] + off[1]], prims: moved.filter(p => isAnnotationLayer(p.layer)) }] : moved;
    if (sc.background) { const r = clip || [bb[0] + off[0] - 3, bb[1] + off[1] - 3, bb[2] + off[0] + 3, bb[3] + off[1] + 3]; prims.push({ t: "fill", path: rectPath(...r), colour: sc.background, layer: "Viewport" }); }
    prims.push({ t: "group", clip: sc.annoClip ? null : clip, prims: inner, layer: "Viewport", vp: vp.id, view: vp.view.ref, stale: sc.stale || null });
    for (const l of sc.links || []) links.push(translatePrim(l, off));
    if (vp.clipVisible && clip) put(rectPath(...clip), 0.18);
    // viewport title
    if (vp.noTitle) return;
    const ty = (clip ? clip[1] : bb[1] + off[1]) - 9, tx0 = (clip ? clip[0] : bb[0] + off[0]);
    if (band) {
      // as the drawing set has it: a split circle (the view's number over the sheet it is on), the name large
      // in Arial on a rule, the scale small beneath
      // (Revit's view title: the circle 9 across, the number 3.5 over the sheet 2.0, the name 5.0 on a rule
      // whose length the viewport sets, the scale 2.0 under it; placed where the viewport says)
      const A = { font: "Arial" }, name = view.get("Name") || "", nw = textWidth(name, 5.07, "Arial");
      const [cx, cy] = vp.titleAt || [tx0 + 5, ty + 1.5], R0 = 4.49;
      put(circlePath([cx, cy], R0), 0.085);
      txt([cx, cy + 0.17], String(i + 1), 3.55, Object.assign({ align: "centre" }, A));
      txt([cx, cy - 2.68], doc.argValue(sh, "number") || "", 2.04, Object.assign({ align: "centre" }, A));
      txt([cx + 5.04, cy + 0.76], name, 5.07, A);
      put([lineSeg([cx + 4.57, cy], [cx + (vp.titleLength || 5.04 + nw + 1), cy])], 0.085);
      if (doc.typeOf(view) !== "Schedule" && doc.typeOf(view) !== "View3D") txt([cx + 6.35, cy - 2.84], "1 : " + (F.int(view, "scale") || 100), 2.04, A);
      return;
    }
    put(circlePath([tx0 + 4.5, ty + 1.5], 4.5), 0.35);
    txt([tx0 + 4.5, ty], String(i + 1), 3, { align: "centre" });
    txt([tx0 + 11, ty + 0.5], view.get("Name"), 3.5, {});
    txt([tx0 + 11, ty - 4], doc.typeOf(view) === "Schedule" ? "" : "1:" + (F.int(view, "scale") || 100), 2.2, { colour: "#333" });
    put([lineSeg([tx0 + 10, ty - 1.2], [tx0 + 11 + Math.max(40, textWidth(view.get("Name"), 3.5) + 2), ty - 1.2])], 0.5);
    if (sc.stale) txt([tx0 + 11, ty - 8], `⚠ stale: ${sc.stale}`, 2.2, { colour: "#b3261e" });
    if (doc.typeOf(view) === "PlanView" && doc.lib.symbols["SY-NORTH"]) {
      const B2 = new SceneBuilder(1);
      const right = clip ? clip[2] : bb[2] + off[0];
      drawSymbol(doc, B2, doc.lib.symbols["SY-NORTH"], [right - 10, ty + 2], 0, "Annotation");
      prims.push(...B2.prims);
    }
  });
  // pictures laid on the sheet (a hand sketch over the drawing multiplies: its paper vanishes, its ink stays)
  for (const im of doc.argValue(sh, "images") || []) if (im && im.url && im.rect) {
    const p = { t: "raster", rect: im.rect.slice(), url: im.url, blend: im.blend || null, layer: "Viewport" };
    if (im.url.startsWith("data:image/jpeg") && typeof atob === "function") { const bin = atob(im.url.split(",")[1]), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); Object.assign(p, { jpeg: bytes, pxW: im.w, pxH: im.h }); }
    prims.push(p);
  }
  // diagrams of the brief analysis: drawn by the page from the space graph as it is now (see SHEET_DIAGRAMS)
  (doc.argValue(sh, "diagrams") || []).forEach((im, i) => {
    const [x, y, w, hh] = im.rect, url = im.url || (SHEET_DIAGRAMS.url ? SHEET_DIAGRAMS.url(doc, im) : null);
    if (url) prims.push({ t: "raster", rect: [x, y, w, hh], url, layer: "Viewport" });
    else { prims.push({ t: "fill", path: rectPath(x, y, x + w, y + hh), colour: "#f3f4f6", layer: "Viewport" }); txt([x + w / 2, y + hh / 2], `${im.title || im.diagram && im.diagram.kind || "diagram"} - drawn when the sheet is opened in the app`, 3, { align: "centre", colour: "#666" }); }
    put(rectPath(x, y, x + w, y + hh), 0.18);
    const n = vps.length + i + 1, ty = y - 7;
    put(circlePath([x + 4.5, ty + 1.5], 4.5), 0.35); txt([x + 4.5, ty], String(n), 3, { align: "centre" });
    txt([x + 11, ty + 0.5], im.title || "Diagram", 3.5, {}); put([lineSeg([x + 10, ty - 1.2], [x + 11 + Math.max(40, textWidth(im.title || "Diagram", 3.5) + 2), ty - 1.2])], 0.5);
  });
  return { prims, links, hits: [], size, bbox: [0, 0, W, H], kind: "sheet" };
}
/** The title block of the Casa Mazatlan set (and any office that works like it): no border, one heavy rule
 *  above a band along the foot of the sheet. On the left, the standing notes and the author's copyright; in
 *  the middle, the project - its name large, then number, address and client under bold labels; then print
 *  size, drafted, checked and issue date; a north circle; and on the right the drawing's name over its
 *  number, set very large. The scale sits over the rule at the right. Arial and Arial Bold throughout, at
 *  the sizes of the original (cap heights in mm, measured from it). Laid out for A3, it holds its left side
 *  to the left edge and everything else to the right edge on any other size. */
function titleBand(doc, sh, W, H, put, txt) {
  const P = Object.assign({ number: "", address: "", client: "", author: "", drafted: "", checked: "", issued: "", notes: "", revisions: "" }, doc.meta.project || {});
  const R = x => W - (420 - x);             // a position measured on A3 from the left, held to the right edge
  const A = { font: "Arial" }, AB = { font: "ArialBold" };
  put([lineSeg([10, 30.9], [W - 10, 30.9])], 0.47);
  // the standing notes, and who holds the copyright
  const notes = (P.notes || "NO TOMAR COTAS DEL DIBUJO.\nCONTRATISTA COMPROBAR\nDIMENSIONES EN OBRA.").split("\n");
  notes.slice(0, 3).forEach((l, i) => txt([9.9, 26.4 - 2.1 * i], l.toUpperCase(), 1.28, A));
  if (P.author) [P.author, "RETIENE DERECHOS DE AUTOR", "SOBRE ESTE DIBUJO."].forEach((l, i) => txt([9.9, 16.2 - 2.15 * i], l.toUpperCase(), 1.28, A));
  if (P.revisions) txt([44.1, 26.4], P.revisions.toUpperCase(), 1.28, A);
  // the project
  txt([R(259.9), 24.6], (doc.meta.name || "").toUpperCase(), 4.03, A);
  const label = (x, y, t) => txt([R(x), y], t, 1.52, Object.assign({ align: "right" }, AB));
  const value = (x, y, t) => txt([R(x), y], t, 1.52, A);
  label(274.57, 20.78, "PROJECT NO"); value(277.2, 20.55, P.number);
  label(274.57, 17.65, "DIRECCION"); P.address.split("\n").slice(0, 3).forEach((l, i) => value(277.2, 17.65 - 2.35 * i, l.toUpperCase()));
  label(274.57, 7.4, "CLIENTE"); value(277.2, 7.25, P.client.toUpperCase());
  label(330.15, 17.56, "PRINT SIZE"); txt([R(332.19), 17.39], doc.argValue(sh, "size") || "", 1.52, AB);
  label(330.15, 14.22, "DRAFTED"); value(332.0, 14.15, P.drafted);
  label(330.15, 10.79, "CHECKED"); value(332.0, 10.65, P.checked);
  label(330.15, 7.45, "ORIG. ISSUE"); value(332.1, 7.25, P.issued);
  // north
  put(circlePath([R(352.1), 15.05], 7.5), 0.21);
  txt([R(352.2), 4.82], "NORTE", 1.52, Object.assign({ align: "centre" }, AB));
  // the drawing: its name, and its number large
  txt([R(408.41), 24.38], String(doc.argValue(sh, "sheetName") || "").toUpperCase(), 4.03, Object.assign({ align: "right" }, A));
  txt([R(388.57), 8.13], doc.argValue(sh, "number") || "", 9.47, Object.assign({ align: "centre" }, A));
  // the scale over the rule: one scale, or "As indicated" when the views differ
  const sc = viewportScales(doc, sh), scales = sc && sc !== "—" ? sc.split(", ") : [];
  const scaleText = doc.argValue(sh, "scaleLabel") ? doc.argValue(sh, "scaleLabel") : scales.length === 1 ? scales[0].replace(":", " : ") : scales.length ? "As indicated" : "";
  if (scaleText) txt([R(398.76), 35.05], scaleText, 5.07, Object.assign({ align: "centre" }, A));
}
/** A scale as the project writes it: 1:50 in a metric project; in an imperial one the architect's scale nearest it. */
const ARCH_SCALES = [[12, '1" = 1\'-0"'], [16, '3/4" = 1\'-0"'], [24, '1/2" = 1\'-0"'], [32, '3/8" = 1\'-0"'], [48, '1/4" = 1\'-0"'], [64, '3/16" = 1\'-0"'], [96, '1/8" = 1\'-0"'], [192, '1/16" = 1\'-0"'], [384, '1/32" = 1\'-0"']];
export function scaleName(doc, n) {
  if (!isImperial(doc.meta && doc.meta.displayUnits)) return "1:" + n;
  return ARCH_SCALES.reduce((b, a) => (Math.abs(Math.log(a[0] / n)) < Math.abs(Math.log(b[0] / n)) ? a : b))[1];
}
/** Frank Harmon Architect's title strip: along the right edge of the sheet, read upward - the project and its
 *  place, the firm and its address, job / date / scale, drawn / checked, the drawing's name and the sheet number
 *  - and the issue (PERMIT SET and its date) set large over the bottom right corner. Held to the right edge. */
function fhaStrip(doc, sh, W, H, put, txt) {
  const P = Object.assign({ number: "", drawn: "", checked: "", issued: "", issue: "", issueDate: "", place: "", firm: "FRANK HARMON ARCHITECT", firmAddress: "", phone: "", fax: "" }, doc.meta.project || {});
  const X = x => W - (914 - x), up = { rot: 90, font: "Futura" }, cap = pt => pt * 25.4 / 72 * 0.7;
  const t = (x, y, text, pt, o = {}) => txt([X(x), y], text, cap(pt), Object.assign({}, up, o));
  put([lineSeg([X(884.7), 17.4], [X(884.7), H - 14.9])], 0.19);
  const box = (y0, y1, cuts) => { put(rectPath(X(876.9), y0, X(892.5), y1), 0.19); for (const c of cuts) put([lineSeg([X(876.9), c], [X(892.5), c])], 0.19); };
  box(198.2, 274.4, [223.6, 249.0]); box(410.2, 461.0, [435.6]); box(563.0, H - 14.9, []);
  const name = (doc.meta.name || "").toUpperCase().split("\n");
  t(881.2, 28.6, name[0] || "", 24); t(891.3, 29.0, (name[1] || P.place || "").toUpperCase(), 24);
  t(881.3, 278.3, P.firm, 24);
  String(P.firmAddress || "").split("\n").slice(0, 2).forEach((l, i) => t(888.4 + 3.9 * i, 278.9, l, 9));
  if (P.phone) t(888.4, 388.5, P.phone, 9); if (P.fax) t(892.3, 375.5, "facsimile " + P.fax, 9);
  t(881.2, 200.7, "Job No.", 10); t(881.2, 226.1, "Date", 10); t(881.2, 251.5, "Scale", 10); t(881.2, 413.5, "Drawn", 10); t(881.2, 438.9, "Checked", 10); t(881.2, H - 37.7, "Sheet", 10);
  const sc = viewportScales(doc, sh), scales = sc && sc !== "—" ? sc.split(", ") : [];
  const scaleText = doc.argValue(sh, "scaleLabel") || (scales.length === 1 ? scaleName(doc, +scales[0].split(":")[1]) : scales.length ? "AS NOTED" : "");
  t(889.1, 200.7, P.number, 9); t(889.7, 225.5, P.issued, 9); t(889.4, 251.2, scaleText.trim(), 10); t(888.9, 417.9, P.drawn, 9); t(888.6, 443.9, P.checked || "-", 9);
  t(882.7, 465.4, String(doc.argValue(sh, "sheetName") || "").toUpperCase(), 20);
  t(892.5, H - 38.8, doc.argValue(sh, "number") || "", 20);
  if (P.issue) { txt([X(802), 40.6], P.issue.toUpperCase(), cap(30), { font: "Futura" }); if (P.issueDate) txt([X(802), 27.4], P.issueDate, cap(30), { font: "Futura" }); }
}
function viewportScales(doc, sh) {
  const s = [...new Set((doc.argValue(sh, "viewports") || []).map(vp => doc.element(vp.view.ref)).filter(v => v && doc.typeOf(v) !== "Schedule").map(v => "1:" + (F.int(v, "scale") || 100)))];
  return s.join(", ") || "—";
}
export function translatePrim(p, o) {
  const T = q => [q[0] + o[0], q[1] + o[1]];
  const tp = path => path.map(s => s.k === "L" ? { k: "L", a: T(s.a), b: T(s.b) } : s.k === "A" ? Object.assign({}, s, { c: T(s.c) }) : { k: "C", a: T(s.a), c1: T(s.c1), c2: T(s.c2), b: T(s.b) });
  const q = Object.assign({}, p); delete q._bb;           // anything cached on the original is in its coordinates, not these
  if (p.path) q.path = tp(p.path);
  if (p.at) q.at = T(p.at);
  if (p.rect) q.rect = [p.rect[0] + o[0], p.rect[1] + o[1], p.rect[2], p.rect[3]];
  if (p.t === "group") { q.prims = p.prims.map(x => translatePrim(x, o)); if (p.clip) q.clip = [p.clip[0] + o[0], p.clip[1] + o[1], p.clip[2] + o[0], p.clip[3] + o[1]]; if (p.clipPath) q.clipPath = p.clipPath.map(c => [c[0] + o[0], c[1] + o[1]]); }
  if (p.t === "hatch") q.origin = T(p.origin || [0, 0]);
  return q;
}

/** A dimension's string in the project's units, as Revit writes it: metric bare (7000, 7.000),
 *  imperial with its marks (22' - 11 9/16"). */
export function dimText(doc, v) { const u = (doc.meta && doc.meta.displayUnits) || "mm"; return fmtLength(v, { unit: u, suffix: false, fixed: u === "m" || u === "cm" }); }

/** A 3D view's section box as a cache key: "" when it is off. */
export function sectionBoxKey(doc, v) { const b = doc.typeOf(v) === "View3D" && doc.argValue(v, "sectionBox"); return b && b.on && b.min && b.max ? JSON.stringify([b.min, b.max]) : ""; }

/** An imported DXF, placed: each visible layer in its colour, its texts and fills; pickable as one. */
function drawImport(doc, ctx, B, f) {
  const id = doc.idOf(f), d = F.json(f, "drawing") || {}, ls = importLayerMap(f), P = importPlacer(f), S = ctx.scale, k = F.real(f, "scale") || 1;
  const on = l => !ls[l] || ls[l].on, col = l => (ls[l] && ls[l].colour) || "#000000";
  let bb = null; const grow = q => { bb = bb ? [Math.min(bb[0], q[0]), Math.min(bb[1], q[1]), Math.max(bb[2], q[0]), Math.max(bb[3], q[1])] : [q[0], q[1], q[0], q[1]]; };
  for (const fl of d.fills || []) {
    if (!on(fl.layer)) continue;
    const pts = (fl.pts ? fl.pts : samplePath(fl.path)).map(P);
    if (pts.length > 2) B.fill(polyPath(pts), fl.colour || col(fl.layer), "Detail", id);
  }
  // strokes batched by how they are drawn (weight, colour): one primitive per pen, however many lines
  const rot = (F.real(f, "rotation") || 0) * Math.PI / 180, pens = new Map();
  const pen = (w, c) => { const key = w + "|" + c; if (!pens.has(key)) pens.set(key, { w, c, segs: [] }); return pens.get(key).segs; };
  for (const el of d.elements || []) {
    if (!on(el.layer)) continue;
    let segs;
    if (el.type === "path") {
      // a compact path lifted from a PDF: polylines as flat [x0, y0, x1, y1, ...], and segments ["L", x0, y0, x1, y1]
      // and ["C", x0, y0, c1x, c1y, c2x, c2y, x1, y1]
      segs = (el.s || []).map(q => q[0] === "L" ? { k: "L", a: P([q[1], q[2]]), b: P([q[3], q[4]]) } : { k: "C", a: P([q[1], q[2]]), c1: P([q[3], q[4]]), c2: P([q[5], q[6]]), b: P([q[7], q[8]]) });
      for (const pl of el.p || []) { let a = P([pl[0], pl[1]]); for (let i = 2; i + 1 < pl.length; i += 2) { const b = P([pl[i], pl[i + 1]]); segs.push({ k: "L", a, b }); a = b; } }
    } else segs = elementSegs(el).map(s => s.k === "L" ? { k: "L", a: P(s.a), b: P(s.b) } : s.k === "A" ? { k: "A", c: P(s.c), r: s.r * k, a0: s.a0 + rot, a1: s.a1 + rot } : { k: "C", a: P(s.a), c1: P(s.c1), c2: P(s.c2), b: P(s.b) });
    for (const sg of segs) { grow(sg.a || sg.c); if (sg.b) grow(sg.b); }
    pen(el.w != null ? el.w : penWeight(doc, "thin", S), el.c || col(el.layer)).push(...segs);
  }
  for (const p of pens.values()) B.stroke(p.segs, { weight: p.w, colour: p.c }, "Detail", id);
  for (const t of d.texts || []) {
    if (!on(t.layer)) continue; const at = P(t.at); grow(at);
    B.text(B.P(at), t.text, Math.max(0.3, t.height * k / S), Object.assign({ align: t.align === "centre" ? "centre" : t.align === "right" ? "right" : "left", rot: (t.rot || 0) + (F.real(f, "rotation") || 0), layer: "Detail", id, colour: t.colour || col(t.layer) }, t.font ? { font: t.font } : {}));
  }
  if (bb) B.hit(id, [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]]);
}
