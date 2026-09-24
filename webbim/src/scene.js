//! Phase 4 — DERIVE (§6). A view becomes a flat list of typed 2D primitives
//! with no reference back to the document, in PAPER MILLIMETRES: the view scale
//! is consumed here, when the scene is built, and never reaches a renderer or
//! the PDF writer (§12.3). Two renderers, one scene.
//!
//! prim: {t:"fill", path, colour} · {t:"hatch", path, pattern, scale, colour, weight}
//!       {t:"stroke", path, weight (mm | "none" never emitted), colour, dash}
//!       {t:"text", at, text, height, rot, align, valign, colour} · {t:"raster", rect, url}
//!       {t:"link", rect, sheet}   — all carry {layer, id} for OCGs and picking.

import { fmtLength, fmtArea } from "./units.js";
import { outline, elementSegs } from "./bimsketch.js";
import { buildableArea } from "./spacegraph.js";
import { plateAt, featureEdges, sliceMesh } from "./massing.js";
import {
  TOL, add, sub, mul, dot, dist, perp, normalise, lerp, samplePath, pathArea, polyPath, bboxOf, segStart, segEnd, segMinusConvex,
  ensureCCW, convexHull, TAU, pointInPoly, reversePath, polyArea,
} from "./geom2d.js";
import { F, propertyOf, evalParam, displayParam } from "./ocaf.js";
import { formatValue, parse, evaluate } from "./expr.js";
import { wallRegions, coarseMaterial, blocks, wallAt, leanInvolved } from "./joins.js";
import { pointAt, uOf, wallSurfaces, cutAtHeight, plane, LAYER_PRIORITY } from "./walls.js";
import { cropLoop, loopBBox, annotationRect, isAnnotationLayer } from "./crop.js";
import { resolveGraphics, categoryOf, penWeight, rulesFor, categoryVisible, mix, LINE_TYPES, matches, effectiveStyle } from "./styles.js";
import { measureRefs, resolveReference, sheetSize, regionAreas, importPlacer, importLayerMap, sketchPath } from "./bim.js";
import { FONT_WIDTHS, FONT_METRICS } from "./fontdata.js";
import { readDXF } from "./dxf.js";
import { sunOf, planShadows } from "./sun.js";
import { NORTH_DXF } from "./library.js";

// ---------------------------------------------------------------- text metrics
/** Text height is cap height in paper mm (the drafting convention); the em
 *  follows from the font's cap height, identically on canvas and in the PDF. */
export const emOf = h => h / (FONT_METRICS.capHeight / 1000);
export function textWidth(str, h) {
  let w = 0;
  for (const ch of String(str)) { const code = FONT_METRICS.unicodeToCode[ch.codePointAt(0)] ?? 63; w += FONT_WIDTHS[code] || 600; }
  return w / 1000 * emOf(h);
}
export function wrapText(str, h, width) {
  const out = [];
  for (const para of String(str).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? line + " " + word : word;
      if (width && textWidth(t, h) > width && line) { out.push(line); line = word; } else line = t;
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
    : t === "Sheet" ? sheetScene(doc, v, opts) : t === "View3D" ? view3dScene(doc, v, opts) : t === "Schedule" ? scheduleScene(doc, v, opts) : emptyScene();
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
  const els = doc.elements().filter(f => f.get("Integer") !== 0 && !doc.error(f) || doc.typeOf(f) === "Wall")
    .map((f, i) => [f, i]).sort((a, b) => (doc.typeOf(b[0]) === "Floor") - (doc.typeOf(a[0]) === "Floor") || a[1] - b[1]).map(([f]) => f);
  const vis = f => categoryVisible(ctx, categoryOf(doc, f)) && f.get("Integer") !== 0;
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
      if (d && d.props) B.text(add(B.P(c), [0, 0]), `SITE ${fmtArea(d.props["Site area"].v)}`, 3.5, { align: "centre", layer: "Site", id, colour: "#1b1f24" });
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
    if (t === "Generic" && vis(f)) {
      // a generic model reads like a column: poché where the cut crosses it, its outline below
      const p = doc.plan(f); if (!p) continue; const bnd = band(p.z0, p.z1);
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
    if (t === "DetailLine" && vis(f)) { const c = F.json(f, "curve"); const segs = curveSegs(c); B.stroke(segs, { weight: penWeight(doc, F.choice(f, "pen"), S), colour: F.text(f, "colour") || "#000000" }, "Detail", doc.idOf(f)); B.hit(doc.idOf(f), samplePath(segs), "curve"); }
    if (t === "FilledRegion" && vis(f)) { const rs = regionAreas(f), pts = rs[0] ? rs[0].outer : F.json(f, "boundary"), path = sketchPath(f) || rs.flatMap(rg => [...polyPath(rg.outer), ...rg.holes.flatMap(hh => polyPath(hh))]), pid = F.text(f, "pattern"); B.fill(path, "#ffffff", "Detail", doc.idOf(f)); B.hatch(path, doc.lib.patterns[pid], pid, "#000000", penWeight(doc, "hairline", S), "Detail", doc.idOf(f)); B.stroke(path, { weight: penWeight(doc, "thin", S), colour: "#000000" }, "Detail", doc.idOf(f)); B.hit(doc.idOf(f), pts); }
    if (t === "CADImport" && vis(f)) drawImport(doc, ctx, B, f);
    if (t === "Text" && categoryVisible(ctx, "Annotation")) drawText(doc, ctx, B, f);
    if (t === "SymbolInstance" && categoryVisible(ctx, "Annotation")) drawSymbol(doc, B, doc.lib.symbols[F.refId(f, "symbol")], B.P(F.point(f, "position")), F.real(f, "rotation"), "Annotation", doc.idOf(f));
    if (t === "RepeatingDetail" && vis(f)) drawRepeating(doc, ctx, B, f);
    if (t === "MaterialTag" && categoryVisible(ctx, "Annotation")) drawMaterialTag(doc, ctx, B, f);
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
  lines.forEach((ln, i) => B.later.push({ t: "text", at: [at[0], at[1] - i * label.height * 1.6], text: String(ln), height: label.height, rot: 0, align: "centre", valign: "baseline", colour: label.colour || "#000", layer: "IfcSpace-Label", id }));
  if (!plan || plan.status !== "ok") B.text([at[0], at[1] + label.height * 1.6], plan && plan.status === "redundant" ? "⚠ redundant" : "⚠ not enclosed", label.height * 0.8, { align: "centre", colour: "#b3261e", layer: "IfcSpace-Label", id });
  B.hit(id, [add(anchor, [-600, -600]), add(anchor, [600, -600]), add(anchor, [600, 600]), add(anchor, [-600, 600])]);
}
function ruleMatch(doc, f, rule) { try { return matches(doc, f, rule.when); } catch (e) { return false; } }
export function paramText(doc, f, k) {
  if (k === "Name") return f.get("Name");
  if (k === "Area") { const d = doc.data(f); return d && d.props && d.props.Area ? fmtArea(d.props.Area.v, (doc.meta && doc.meta.displayUnits) || "mm") : "—"; }
  const p = doc.getParam(f, k); if (p !== undefined) return displayParam(doc, f, p);
  const v = propertyOf(doc, f, k); return v && !v.error ? formatValue(v) : "";
}
const DEPT = ["#dce9f7", "#f8e3cf", "#dff1e2", "#f3dcec", "#fff2c4", "#e4e0f7", "#d8f0f0"];
export function departmentColour(v) { let h = 0; for (const c of v) h = (h * 31 + c.charCodeAt(0)) >>> 0; return DEPT[h % DEPT.length]; }

function drawGrid(doc, ctx, B, f) {
  const c = F.json(f, "line"), id = doc.idOf(f), S = ctx.scale;
  const g = resolveGraphics(doc, ctx, f, "projection");
  B.stroke([lineSeg(c.start, c.end)], Object.assign({}, g, { dash: LINE_TYPES.centre }), "IfcGrid", id);
  // Paper-space heads: the head size and text size are paper millimetres, the same on the sheet at every scale.
  const d = normalise(sub(c.end, c.start)), ends = F.choice(f, "ends") || "Both ends";
  for (const [p, sgn, which] of [[c.start, -1, "Start"], [c.end, 1, "End"]]) {
    if (ends === "None" || (ends !== "Both ends" && ends !== which)) continue;
    gridHead(doc, B, f, B.P(p), mul(d, sgn), g, id);
  }
  B.hit(id, [c.start, c.end], "curve");
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
  B.text([cp[0], cp[1] - ts * 0.36], F.text(f, "name"), ts, { align: "centre", layer: "IfcGrid", id });
}
/** A section line in plan: a chain line with a head at each end, the arrows pointing the way it looks. */
function drawSectionMarker(doc, ctx, B, f, place) {
  const c = F.json(f, "line"), id = doc.idOf(f), S = ctx.scale;
  const d = normalise(sub(c.end, c.start)), look = mul(perp(d), -1);
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
function drawElevationMarker(doc, ctx, B, f, place) {
  const c = F.json(f, "line"), id = doc.idOf(f), S = ctx.scale;
  const d = normalise(sub(c.end, c.start)), look = mul(perp(d), -1);
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
  const h = tt.height, lines = wrapText(content, h, F.real(f, "wrapWidth"));
  const at = B.P(F.point(f, "position")), lh = h * 1.6;
  const width = Math.max(...lines.map(l => textWidth(l, h)));
  lines.forEach((ln, i) => B.text([at[0], at[1] - i * lh], ln, h, { layer: "Annotation-Text", id, colour: tt.colour, rot: F.real(f, "rotation") }));
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
  const text = sym.source.dxf === "inline:NORTH_DXF" ? NORTH_DXF : sym.source.text || "";
  const r = readDXF(text);
  const bb = r.bbox, w = bb[2] - bb[0], h = bb[3] - bb[1];
  const sc = Math.min(sym.nominalSize.w / w, sym.nominalSize.h / h);
  const out = { r, scale: sc, bbox: bb, measured: { w, h }, manifest: r.message };
  SYMBOL_CACHE.set(k, out);
  return out;
}
export function drawSymbol(doc, B, sym, atPaper, rotDeg = 0, layer = "Annotation", id = null) {
  const geo = symbolGeometry(sym); if (!geo) return;
  const cx = (geo.bbox[0] + geo.bbox[2]) / 2, cy = (geo.bbox[1] + geo.bbox[3]) / 2, k = geo.scale, a = rotDeg * Math.PI / 180;
  const T = p => { const x = (p[0] - cx) * k, y = (p[1] - cy) * k; return [atPaper[0] + x * Math.cos(a) - y * Math.sin(a), atPaper[1] + x * Math.sin(a) + y * Math.cos(a)]; };
  const tp = path => path.map(s => s.k === "L" ? { k: "L", a: T(s.a), b: T(s.b) } : s.k === "A" ? { k: "A", c: T(s.c), r: s.r * k, a0: s.a0 + a, a1: s.a1 + a } : { k: "C", a: T(s.a), c1: T(s.c1), c2: T(s.c2), b: T(s.b) });
  for (const p of geo.r.fills) B.prims.push({ t: "fill", path: tp(p.path), colour: "#000000", layer, id });
  for (const p of geo.r.paths) B.prims.push({ t: "stroke", path: tp(p.path), weight: 0.25, colour: "#000000", layer, id });
  for (const t of geo.r.texts) B.prims.push({ t: "text", at: T(t.at), text: t.text, height: t.height * k, rot: rotDeg, align: "centre", valign: "baseline", colour: "#000", layer, id });
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
/** What a material tag says, from the material it rests on. */
export function materialTagText(doc, mat, show) {
  const m = mat && doc.lib.materials[mat]; if (!m) return "?";
  const mark = m.mark || mat;
  return { Mark: mark, Name: m.name || mat, "Mark · Name": `${mark} ${m.name || ""}`.trim(), Description: m.description || m.name || mat, "Mark · Description": `${mark} ${m.description || m.name || ""}`.trim() }[show || "Mark"] || mark;
}
function drawMaterialTag(doc, ctx, B, f) {
  const id = doc.idOf(f), tq = F.point(f, "target"), pq = F.point(f, "position");
  const found = materialAt(doc, B, tq), text = materialTagText(doc, found && found.material, F.choice(f, "show"));
  const ts = F.real(f, "textSize") || 2.5, frame = F.choice(f, "frame") || "Keynote box";
  const T = B.P(tq), P = B.P(pq), w = textWidth(text, ts), pad = ts * 0.45;
  const col = found ? "#000000" : "#b3261e", g = { weight: penWeight(doc, "hairline", ctx.scale), colour: col };
  const right = P[0] >= T[0];
  // the leader: from the point to the near side of the tag, a dot where it rests
  const box = [P[0] - w / 2 - pad, P[1] - ts / 2 - pad, P[0] + w / 2 + pad, P[1] + ts / 2 + pad];
  const end = frame === "Circle" ? add(P, mul(normalise(sub(T, P)), Math.max(w / 2, ts / 2) + pad)) : [right ? box[0] : box[2], P[1]];
  B.stroke([lineSeg(T, end)], g, "Annotation-Tag", id, true);
  B.fill(circlePath(T, 0.45), col, "Annotation-Tag", id, true);
  if (frame === "Keynote box") { B.fill(polyPath([[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]), "#ffffff", "Annotation-Tag", id, true); B.stroke(polyPath([[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]), g, "Annotation-Tag", id, true); }
  if (frame === "Circle") { const r = Math.max(w / 2, ts / 2) + pad; B.fill(circlePath(P, r), "#ffffff", "Annotation-Tag", id, true); B.stroke(circlePath(P, r), g, "Annotation-Tag", id, true); }
  B.text([P[0], P[1] - ts * 0.36], text, ts, { align: "centre", layer: "Annotation-Tag", id, colour: col });
  const S = ctx.scale; B.hit(id, [[box[0] * S, box[1] * S], [box[2] * S, box[1] * S], [box[2] * S, box[3] * S], [box[0] * S, box[3] * S]]);
  B.hit(id, [tq, pq], "curve");
}
/** View-owned annotation for views that are not plans (sections, elevations): material tags. */
function drawViewAnnotations(doc, ctx, B, v) {
  if (!categoryVisible(ctx, "Annotation")) return;
  for (const f of doc.elements()) if (doc.typeOf(f) === "MaterialTag" && F.refId(f, "view") === doc.idOf(v)) drawMaterialTag(doc, ctx, B, f);
}

/** Where a dimension sits: witness feet a, b; the measured direction; the dimension line A–Bp at its offset. */
export function dimensionGeometry(doc, f, m = measureRefs(doc, F.json(f, "of") || [])) {
  if (!m || m.lost || m.value == null || m.kind === "levels") return null;
  const off = F.real(f, "offset");
  let a, b, dir;
  if (m.kind === "parallel") { const L = m.a.geom; dir = perp(L.d); a = L.p; b = add(a, mul(dir, dot(sub(m.b.geom.p, a), dir))); }
  else { a = m.a.kind === "point" ? m.a.geom : m.a.geom.p; b = m.b.kind === "point" ? m.b.geom : m.b.geom.p; dir = normalise(sub(b, a)); }
  const along = perp(dir), shift = mul(along, off);
  return { a, b, dir, along, off, A: add(a, shift), Bp: add(b, shift), value: m.value, signed: dot(sub(b, a), dir) };
}
function drawDimension(doc, ctx, B, f) {
  const id = doc.idOf(f), keys = F.json(f, "of") || [];
  const m = measureRefs(doc, keys);
  const g = { weight: penWeight(doc, "hairline", ctx.scale), colour: "#000" };
  if (m.lost) {
    // Survives with a note naming the lost reference; never silently rebinds (test 30).
    const any = keys.map(k => resolveReference(doc, k)).find(Boolean);
    const p = any ? (any.kind === "point" ? any.geom : any.geom.p) : [0, 0];
    B.text(add(B.P(p), [2, 2]), `⚠ ${m.lost.length} reference${m.lost.length > 1 ? "s" : ""} lost: ${m.lost.join(", ")}`, 2, { colour: "#b3261e", layer: "Annotation-Dimension", id });
    return;
  }
  if (m.value == null) return;
  const { a, b, dir, along, off, A, Bp } = dimensionGeometry(doc, f, m);
  B.stroke([lineSeg(A, Bp)], g, "Annotation-Dimension", id);
  B.stroke([lineSeg(a, add(A, mul(along, 150 * Math.sign(off || 1)))), lineSeg(b, add(Bp, mul(along, 150 * Math.sign(off || 1))))], g, "Annotation-Dimension", id);
  for (const p of [A, Bp]) { const pp = B.P(p), t = mul(normalise(add(dir, along)), 1.2); B.stroke([lineSeg(sub(pp, t), add(pp, t))], { weight: penWeight(doc, "medium", ctx.scale), colour: "#000" }, "Annotation-Dimension", id, true); }
  const mid = B.P(lerp(A, Bp, 0.5)), ang = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
  const rot = ang > 90 || ang <= -90 ? ang + 180 : ang;
  const txt = dimText(doc, m.value);
  const up = [-Math.sin(rot * Math.PI / 180), Math.cos(rot * Math.PI / 180)];
  B.text(add(mid, mul(up, 0.8)), txt, 2.5, { align: "centre", rot, layer: "Annotation-Dimension", id });
  if (F.bool(f, "locked")) drawPadlock(B, add(mid, add(mul(up, 1), mul([Math.cos(rot * Math.PI / 180), Math.sin(rot * Math.PI / 180)], textWidth(txt, 2.5) / 2 + 2.5))), id);
  B.hit(id, [a, b, Bp, A]);
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
  return scene;
}
/** An elevation's or a section's line in plan, and the maps from plan to view coordinates. */
export function viewLineGeometry(doc, v) {
  const c = F.json(v, "line"), d = normalise(sub(c.end, c.start)), look = mul(perp(d), -1), Lv = dist(c.start, c.end);
  const depthMax = F.real(v, "depth");
  const lv = F.reference(v, "baseLevel"), Z0 = lv ? (doc.data(lv) || {}).value || 0 : 0, topZ = Z0 + F.real(v, "top");
  const sOf = p => dot(sub(p, c.start), d), depthOf = p => dot(sub(p, c.start), look);
  const V = (p, z) => [sOf(p), z - Z0];              // view coords, model mm
  return { c, d, look, Lv, depthMax, Z0, topZ, sOf, depthOf, V };
}
function gatherElevationItems(doc, ctx, G, skip = null) {
  const { V, sOf, depthOf, Z0 } = G;
  const items = [];
  for (const f of doc.elements()) {
    if (f.get("Integer") === 0 || doc.error(f)) continue;
    if (skip && skip.has(doc.idOf(f))) continue;
    // Visibility/Graphics is data: a category switched off in this view's style is not drawn, here as in plan
    if (!categoryVisible(ctx, categoryOf(doc, f))) continue;
    const t = doc.typeOf(f);
    if (t === "Wall") { const w = doc.plan(f); if (!w) continue; const it = elevWall(doc, f, w, V, sOf, depthOf, ctx); if (it) items.push(it); }
    if (t === "Generic" && doc.plan(f) && doc.plan(f).mesh) {
      // a body of its own shape: its feature edges, projected; hidden by what stands in front of it
      const p = doc.plan(f), P = p.mesh.positions, curves = [];
      let d0 = Infinity, d1 = -Infinity, s0 = Infinity, s1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < P.length; i += 3) { const q = [P[i], P[i + 1]], dd = depthOf(q), ss = sOf(q); d0 = Math.min(d0, dd); d1 = Math.max(d1, dd); s0 = Math.min(s0, ss); s1 = Math.max(s1, ss); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
      for (const [a, b] of meshEdges(doc, p.meshShape, p.mesh)) { const A = [P[a * 3], P[a * 3 + 1]], Bq = [P[b * 3], P[b * 3 + 1]]; curves.push([[sOf(A), P[a * 3 + 2] - Z0], [sOf(Bq), P[b * 3 + 2] - Z0]]); }
      items.push({ id: doc.idOf(f), f, depth: d0, depthMax: d1, s0, s1, curves, sil: [], fillerHits: [{ id: doc.idOf(f), poly: [[s0, z0 - Z0], [s1, z0 - Z0], [s1, z1 - Z0], [s0, z1 - Z0]] }], cat: categoryOf(doc, f) });
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
  const S = ctx.scale, { c, d, Lv, Z0, topZ } = G;
  const ext = [-1500, Lv + 1500];
  B.stroke([lineSeg([ext[0], 0], [ext[1], 0])], { weight: penWeight(doc, "bold", S), colour: "#000" }, "Ground", null);
  for (const f of doc.elements()) if (doc.typeOf(f) === "Level" && categoryVisible(ctx, "IfcBuildingStorey")) {
    const z = (doc.data(f) || {}).value - Z0; if (z + Z0 > topZ) continue;
    B.stroke([lineSeg([ext[0], z], [ext[1], z])], { weight: penWeight(doc, "hairline", S), colour: "#000", dash: LINE_TYPES.centre }, "IfcBuildingStorey", doc.idOf(f));
    const hp = B.P([ext[1], z]);
    B.stroke(polyPath([hp, add(hp, [2, 2]), add(hp, [4, 0]), add(hp, [2, -2])]), { weight: 0.25, colour: "#000" }, "IfcBuildingStorey", doc.idOf(f), true);
    B.text(add(hp, [5.5, 0.6]), F.text(f, "name"), 2.5, { layer: "IfcBuildingStorey", id: doc.idOf(f) });
    B.text(add(hp, [5.5, -3.2]), (z + Z0 >= 0 ? "+" : "") + ((z + Z0) / 1000).toFixed(3), 2.0, { layer: "IfcBuildingStorey", id: doc.idOf(f) });
    B.hit(doc.idOf(f), [[ext[0], z - 50], [ext[1], z - 50], [ext[1], z + 50], [ext[0], z + 50]]);
  }
  // dimensions between levels, drawn in the view they were placed in: a vertical string at their offset
  if (categoryVisible(ctx, "Annotation")) for (const f of doc.elements()) {
    if (doc.typeOf(f) !== "Dimension" || F.refId(f, "view") !== doc.idOf(v)) continue;
    const m = measureRefs(doc, F.json(f, "of") || []); if (m.kind !== "levels") continue;
    const sx = F.real(f, "offset"), za = m.a.z - Z0, zb = m.b.z - Z0, id = doc.idOf(f), g = { weight: penWeight(doc, "hairline", S), colour: "#000" };
    B.stroke([lineSeg([sx, za], [sx, zb])], g, "Annotation-Dimension", id);
    for (const z of [za, zb]) { const pp = B.P([sx, z]); B.stroke([lineSeg(add(pp, [-1.2, -1.2]), add(pp, [1.2, 1.2]))], { weight: penWeight(doc, "medium", S), colour: "#000" }, "Annotation-Dimension", id, true); B.stroke([lineSeg([sx - 250, z], [sx + 250, z])], g, "Annotation-Dimension", id); }
    const mid = B.P([sx, (za + zb) / 2]);
    B.text(add(mid, [-0.9, 0]), dimText(doc, m.value), 2.5, { align: "centre", rot: 90, layer: "Annotation-Dimension", id });
    if (F.bool(f, "locked")) drawPadlock(B, add(mid, [-2.2, textWidth(dimText(doc, m.value), 2.5) / 2 + 3]), id);
    B.hit(id, [[sx - 300, Math.min(za, zb)], [sx + 300, Math.min(za, zb)], [sx + 300, Math.max(za, zb)], [sx - 300, Math.max(za, zb)]]);
  }
  // other sections that cross this view: a line where their cut plane passes, with their name - picked and dragged here as in plan
  if (categoryVisible(ctx, "Annotation")) for (const f of doc.elements()) {
    if (doc.typeOf(f) !== "SectionView" || f === v) continue;
    const sl = F.json(f, "line"); if (!sl || sl.type !== "line") continue;
    const sd = normalise(sub(sl.end, sl.start)), den = d[0] * sd[1] - d[1] * sd[0]; if (Math.abs(den) < 1e-9) continue;
    const t = ((sl.start[0] - c.start[0]) * sd[1] - (sl.start[1] - c.start[1]) * sd[0]) / den;
    // it shows where its cut plane passes through what this view sees: its line must reach into this view's depth
    const da = G.depthOf(sl.start), db = G.depthOf(sl.end), dMax = G.depthMax || Infinity;
    if (t < 0 || t > Lv || Math.max(da, db) < 0 || Math.min(da, db) > dMax) continue;
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
    const t = ((gl.start[0] - c.start[0]) * gd[1] - (gl.start[1] - c.start[1]) * gd[0]) / den;
    if (t < 0 || t > Lv) continue;
    const top = F.real(v, "top") + 600;
    B.stroke([lineSeg([t, -300], [t, top])], { weight: penWeight(doc, "hairline", S), colour: "#000", dash: LINE_TYPES.centre }, "IfcGrid", doc.idOf(f));
    if ((F.choice(f, "ends") || "Both ends") !== "None") gridHead(doc, B, f, B.P([t, top]), [0, 1], { weight: penWeight(doc, "thin", S), colour: "#000" }, doc.idOf(f));
    // pickable along its line and by its bubble
    B.hit(doc.idOf(f), [[t, -300], [t, top]], "curve");
    const hr = (F.real(f, "headSize") || 8) / 2, R_ = hr * S, bc = [t, top + hr * S];
    B.hit(doc.idOf(f), [[bc[0] - R_, bc[1] - R_], [bc[0] + R_, bc[1] - R_], [bc[0] + R_, bc[1] + R_], [bc[0] - R_, bc[1] + R_]]);
  }
}
/** Items seen beyond the view plane, nearest first, each hidden by what is in front (and by the cut, in a section). */
function drawProjection(doc, ctx, B, vis, G, occluders) {
  const S = ctx.scale;
  for (const it of vis) {
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
  const { c, d, Lv } = G, n = perp(d), ts = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = dot(sub(a, c.start), n), db = dot(sub(b, c.start), n);
    if ((da > 0) === (db > 0) || da === db) continue;
    const t = da / (da - db), p = add(a, mul(sub(b, a), t));
    ts.push(dot(sub(p, c.start), d));
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
    if (f.get("Integer") === 0 || doc.error(f) || !categoryVisible(ctx, categoryOf(doc, f))) continue;
    const t = doc.typeOf(f), p = doc.plan(f); if (!p) continue;
    if (t === "Wall" && p.stack) {
      const regs = wallRegions(p, detail, -Infinity, []);
      for (const r of regs) {
        if (r.bevel) continue;
        const L = r.layer === null ? null : p.stack.layers[r.layer];
        for (const [s0, s1] of lineIntervals(samplePath(r.path, 24), G)) {
          // openings the line passes through take their height out of the wall
          const mid = add(G.c.start, mul(G.d, (s0 + s1) / 2)), u = uOf(p, mid);
          let spans = [[p.z0, p.z1]];
          for (const op of p.openings || []) if (u > op.u0 && u < op.u1) spans = spans.flatMap(([a, b]) => [[a, Math.min(b, p.z0 + op.sill)], [Math.max(a, p.z0 + op.sill + op.h), b]]).filter(([a, b]) => b - a > 1e-6);
          for (const [z0, z1] of spans) push(f, "wall", s0, s1, z0, z1, r.material, L ? L.priority : 1);
        }
      }
    }
    if (t === "Generic" && p.mesh) {
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
  const topAt = p => w.z1 + (w.topSlope ? Math.tan(w.topSlope) * uOf(w, p) : 0);
  const iMin = ss.indexOf(s0), iMax = ss.indexOf(s1);
  const zt0 = topAt(foot[iMin]), zt1 = topAt(foot[iMax]);
  const baseZ = V(foot[0], w.z0)[1], t0 = V(foot[0], zt0)[1], t1 = V(foot[0], zt1)[1];
  const curves = [[[s0, baseZ], [s1, baseZ]], [[s1, baseZ], [s1, t1]], [[s1, t1], [s0, t0]], [[s0, t0], [s0, baseZ]]];
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
    const za = V(foot[0], w.z0 + op.sill)[1], zb2 = V(foot[0], w.z0 + op.sill + op.h)[1];
    const na = sOf(pointAt(w, nearS, op.u0)), nb = sOf(pointAt(w, nearS, op.u1));
    const lo = Math.min(na, nb), hi = Math.max(na, nb);
    curves.push([[lo, za], [hi, za]], [[hi, za], [hi, zb2]], [[hi, zb2], [lo, zb2]], [[lo, zb2], [lo, za]]);
    if (!op.recess) { const sa = Math.max(Math.min(a1, b1), Math.min(a2, b2)), sb = Math.min(Math.max(a1, b1), Math.max(a2, b2)); if (sb - sa > 1) holes.push([sa, sb, za, zb2]); }
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
  const cuts = [...new Set([s0, s1, ...holes.flatMap(h => [h.s0 ?? h[0], h[1]])])].filter(x => x >= s0 && x <= s1).sort((a, b) => a - b);
  const topLine = s => t0 + (t1 - t0) * ((s - s0) / ((s1 - s0) || 1));
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
export function scheduleRows(doc, v) {
  const cat = F.choice(v, "of"), fields = F.json(v, "fields") || [];
  const rows = doc.elements().filter(f => categoryOf(doc, f) === cat && !doc.declOf(f)?.category?.startsWith("View")).map(f => ({ id: doc.idOf(f), f,
    cells: fields.map(k => k === "Id" ? doc.idOf(f) : k === "Name" ? f.get("Name") : paramText(doc, f, k)) }));
  return { fields, rows, cat };
}
export function scheduleScene(doc, v) {
  const B = new SceneBuilder(1), { fields, rows } = scheduleRows(doc, v);
  const h = 2.5, rowH = 6, colW = fields.map(k => Math.max(textWidth(k, h), ...rows.map(r => textWidth(r.cells[fields.indexOf(k)] || "", h))) + 4);
  const W = colW.reduce((a, b) => a + b, 0), H = (rows.length + 2) * rowH;
  B.text([0, H + 2], v.get("Name"), 3.5, {});
  let y = H;
  const line = (y) => B.prims.push({ t: "stroke", path: [lineSeg([0, y], [W, y])], weight: 0.18, colour: "#000", layer: "Schedule" });
  line(y);
  let x = 0; fields.forEach((k, i) => { B.text([x + 2, y - rowH + 2], k, h, {}); x += colW[i]; });
  y -= rowH; line(y);
  for (const r of rows) { x = 0; r.cells.forEach((c, i) => { B.text([x + 2, y - rowH + 2], c, h, {}); x += colW[i]; }); y -= rowH; line(y); }
  let xx = 0; for (const cw of [0, ...colW]) { xx += cw; B.prims.push({ t: "stroke", path: [lineSeg([xx, y], [xx, H])], weight: 0.18, colour: "#000", layer: "Schedule" }); }
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
    const ty = (clip ? clip[1] : bb[1] + off[1]) - 9, tx0 = (clip ? clip[0] : bb[0] + off[0]);
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
  for (const fl of d.fills || []) { if (!on(fl.layer)) continue; const pts = samplePath(fl.path).map(P); if (pts.length > 2) B.fill(polyPath(pts), col(fl.layer), "Detail", id); }
  for (const el of d.elements || []) {
    if (!on(el.layer)) continue;
    // exact: a similarity keeps an arc an arc and a Bézier a Bézier
    const rot = (F.real(f, "rotation") || 0) * Math.PI / 180;
    const segs = elementSegs(el).map(s => s.k === "L" ? { k: "L", a: P(s.a), b: P(s.b) } : s.k === "A" ? { k: "A", c: P(s.c), r: s.r * k, a0: s.a0 + rot, a1: s.a1 + rot } : { k: "C", a: P(s.a), c1: P(s.c1), c2: P(s.c2), b: P(s.b) });
    samplePath(segs, 4).forEach(grow);
    B.stroke(segs, { weight: penWeight(doc, "thin", S), colour: col(el.layer) }, "Detail", id);
  }
  for (const t of d.texts || []) { if (!on(t.layer)) continue; const at = P(t.at); grow(at); B.text(B.P(at), t.text, Math.max(0.5, t.height * k / S), { align: t.align === "centre" ? "centre" : t.align === "right" ? "right" : "left", rot: (t.rot || 0) + (F.real(f, "rotation") || 0), colour: col(t.layer), layer: "Detail", id }); }
  if (bb) B.hit(id, [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]]);
}
