//! Phase 4 — DERIVE (§6). A view becomes a flat list of typed 2D primitives
//! with no reference back to the document, in PAPER MILLIMETRES: the view scale
//! is consumed here, when the scene is built, and never reaches a renderer or
//! the PDF writer (§12.3). Two renderers, one scene.
//!
//! prim: {t:"fill", path, colour} · {t:"hatch", path, pattern, scale, colour, weight}
//!       {t:"stroke", path, weight (mm | "none" never emitted), colour, dash}
//!       {t:"text", at, text, height, rot, align, valign, colour} · {t:"raster", rect, url}
//!       {t:"link", rect, sheet}   — all carry {layer, id} for OCGs and picking.

import {
  TOL, add, sub, mul, dot, dist, perp, normalise, lerp, samplePath, pathArea, polyPath, bboxOf, segStart, segEnd, segMinusConvex,
  ensureCCW, convexHull, TAU, pointInPoly, reversePath,
} from "./geom2d.js";
import { F, propertyOf, evalParam, displayParam } from "./ocaf.js";
import { formatValue, parse, evaluate } from "./expr.js";
import { wallRegions, coarseMaterial } from "./joins.js";
import { pointAt, uOf, wallSurfaces, cutAtHeight, plane } from "./walls.js";
import { resolveGraphics, categoryOf, penWeight, rulesFor, categoryVisible, mix, LINE_TYPES, matches } from "./styles.js";
import { measureRefs, resolveReference, sheetSize } from "./bim.js";
import { FONT_WIDTHS, FONT_METRICS } from "./fontdata.js";
import { readDXF } from "./dxf.js";
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
  constructor(scale) { this.S = scale; this.prims = []; this.hits = []; this.links = []; this.later = []; }
  P(p) { return [p[0] / this.S, p[1] / this.S]; }
  path(model) {
    const S = this.S;
    return model.map(s => s.k === "L" ? { k: "L", a: [s.a[0] / S, s.a[1] / S], b: [s.b[0] / S, s.b[1] / S] }
      : s.k === "A" ? { k: "A", c: [s.c[0] / S, s.c[1] / S], r: s.r / S, a0: s.a0, a1: s.a1 }
      : { k: "C", a: [s.a[0] / S, s.a[1] / S], c1: [s.c1[0] / S, s.c1[1] / S], c2: [s.c2[0] / S, s.c2[1] / S], b: [s.b[0] / S, s.b[1] / S] });
  }
  fill(model, colour, layer, id, paper = false) { if (colour) this.prims.push({ t: "fill", path: paper ? model : this.path(model), colour, layer, id }); }
  hatch(model, pat, patId, colour, weight, layer, id) {
    if (!pat || weight === "none" || weight == null) return;
    this.prims.push({ t: "hatch", path: this.path(model), pattern: Object.assign({ id: patId }, pat), scale: pat.kind === "model" ? 1 / this.S : 1, colour, weight, layer, id });
  }
  stroke(model, g, layer, id, paper = false) {
    if (!g || g.weight === "none" || g.weight == null || !g.visible && g.visible !== undefined) return;
    this.prims.push({ t: "stroke", path: paper ? model : this.path(model), weight: g.weight, colour: g.colour || "#000000", dash: g.dash || null, layer, id });
  }
  text(atPaper, text, height, opts = {}) {
    this.prims.push(Object.assign({ t: "text", at: atPaper, text: String(text), height, rot: 0, align: "left", valign: "baseline", colour: "#000000" }, opts));
  }
  hit(id, modelPts, kind = "region") { this.hits.push({ id, pts: modelPts, kind }); }
}
const lineSeg = (a, b) => ({ k: "L", a, b });
const circlePath = (c, r) => [{ k: "A", c, r, a0: 0, a1: TAU }];
const rectPath = (x0, y0, x1, y1) => polyPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);

// ---------------------------------------------------------------- context
export function viewContext(doc, v) {
  const type = doc.typeOf(v);
  const styleId = F.refId(v, "style") || (type === "View3D" ? "VS-CONSTRUCTION" : "VS-CONSTRUCTION");
  const style = doc.lib.viewStyles[styleId] || Object.values(doc.lib.viewStyles)[0] || {};
  const scale = F.int(v, "scale") || 100;
  const filters = doc.argValue(v, "filters") || [];
  const detailArg = doc.argValue(v, "detailLevel");
  return { view: v, style, styleId, scale, overrides: doc.argValue(v, "overrides") || {}, rules: rulesFor(doc, style, filters),
    detail: detailArg || style.detailLevel || "Fine", hidden: [] };
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
  const scene = t === "PlanView" ? planScene(doc, v, opts) : t === "ElevationView" ? elevationScene(doc, v, opts)
    : t === "Sheet" ? sheetScene(doc, v, opts) : t === "View3D" ? view3dScene(doc, v, opts) : t === "Schedule" ? scheduleScene(doc, v, opts) : emptyScene();
  scene.watermark = doc.modelRevision;
  c.set(doc.idOf(v), { key, scene });
  return scene;
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
  const vr = doc.argValue(v, "viewRange") || { top: 2300, cut: 1200, bottom: 0 };
  const cutZ = E + vr.cut, topZ = E + vr.top, botZ = E + vr.bottom;
  const band = (z0, z1) => z0 > topZ + TOL ? "above" : z1 < botZ - TOL ? "below" : (z0 <= cutZ + TOL && z1 >= cutZ - TOL) ? "cut" : z1 < cutZ ? "projection" : "beyond";
  const els = doc.elements().filter(f => f.get("Integer") !== 0 && !doc.error(f) || doc.typeOf(f) === "Wall");
  const vis = f => categoryVisible(ctx, categoryOf(doc, f)) && f.get("Integer") !== 0;
  const onlyHere = f => { const r = F.refId(f, "view"); return !r || r === doc.idOf(v); };
  const place = placements(doc);
  const stat = { walls: 0, offsetsBefore: doc.stats.offsets };

  // 1. spaces first: fills sit under everything
  for (const f of els) if (doc.typeOf(f) === "Space" && vis(f) && F.refId(f, "level") === (lv && doc.idOf(lv))) drawSpace(doc, ctx, B, f);
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
    if (t === "Column") { const p = doc.plan(f); if (!p) continue; const bnd = band(p.z0, p.z1); if (bnd === "above" || bnd === "below") continue;
      const g = resolveGraphics(doc, ctx, f, bnd === "cut" ? "cut" : "projection", "Common", p.material);
      if (bnd === "cut") { if (g.pattern === "solid") B.fill(p.path, g.fill || "#000", "IfcColumn", doc.idOf(f)); else { B.fill(p.path, g.fill, "IfcColumn", doc.idOf(f)); if (g.pattern) B.hatch(p.path, doc.lib.patterns[g.pattern], g.pattern, g.colour, penWeight(doc, "hairline", S), "IfcColumn", doc.idOf(f)); } }
      B.stroke(p.path, g, "IfcColumn", doc.idOf(f)); B.hit(doc.idOf(f), p.foot.length ? p.foot : samplePath(p.path));
    }
    if (t === "Door" || t === "Window") {
      const d = doc.data(f), fr = d && d.frame; const host = fr && doc.element(fr.host), w = host && doc.plan(host);
      if (!w || !doc.plan(f)) continue;
      const cutsHere = fr.sill + w.z0 < cutZ && fr.sill + fr.h + w.z0 > cutZ && band(w.z0, w.z1) === "cut";
      if (!cutsHere) continue;       // below or above the cut: the wall reads solid (§5.1)
      for (const piece of doc.plan(f)) {
        // ADA maneuvering clearance: red dashed, whatever the style says about the door itself
        if (piece.role === "clearance") { B.stroke(piece.path, { weight: penWeight(doc, "thin", S), colour: "#d0021b", dash: LINE_TYPES.dashed1 }, categoryOf(doc, f) + "-Clearance", doc.idOf(f)); continue; }
        const role = piece.role === "swing" ? "swing" : piece.role === "projection" ? "projection" : "cut";
        const g = resolveGraphics(doc, ctx, f, role, piece.sub);
        B.stroke(piece.path, g, categoryOf(doc, f) + "-" + piece.sub, doc.idOf(f));
      }
      B.hit(doc.idOf(f), [pointAt(w, w.stack.s[0], fr.u0), pointAt(w, w.stack.s[0], fr.u1), pointAt(w, w.stack.s[w.stack.s.length - 1], fr.u1), pointAt(w, w.stack.s[w.stack.s.length - 1], fr.u0)]);
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
    if (t === "RoomSeparator" && F.refId(f, "level") === (lv && doc.idOf(lv))) { const c = F.json(f, "line"); B.stroke([lineSeg(c.start, c.end)], { weight: penWeight(doc, "hairline", S), colour: "#6b7684", dash: LINE_TYPES.dashed2 }, "IfcSpace-Separator", doc.idOf(f)); B.hit(doc.idOf(f), [c.start, c.end], "curve"); }
  }
  // 4. detail and annotation belonging to this view
  for (const f of els) {
    const t = doc.typeOf(f); if (!onlyHere(f)) continue;
    if (t === "DetailLine" && vis(f)) { const c = F.json(f, "curve"); const segs = curveSegs(c); B.stroke(segs, { weight: penWeight(doc, F.choice(f, "pen"), S), colour: "#000000" }, "Detail", doc.idOf(f)); B.hit(doc.idOf(f), samplePath(segs), "curve"); }
    if (t === "FilledRegion" && vis(f)) { const pts = F.json(f, "boundary"), path = polyPath(pts), pid = F.text(f, "pattern"); B.fill(path, "#ffffff", "Detail", doc.idOf(f)); B.hatch(path, doc.lib.patterns[pid], pid, "#000000", penWeight(doc, "hairline", S), "Detail", doc.idOf(f)); B.stroke(path, { weight: penWeight(doc, "thin", S), colour: "#000000" }, "Detail", doc.idOf(f)); B.hit(doc.idOf(f), pts); }
    if (t === "Text" && categoryVisible(ctx, "Annotation")) drawText(doc, ctx, B, f);
    if (t === "SymbolInstance" && categoryVisible(ctx, "Annotation")) drawSymbol(doc, B, doc.lib.symbols[F.refId(f, "symbol")], B.P(F.point(f, "position")), F.real(f, "rotation"), "Annotation", doc.idOf(f));
    if (t === "Dimension" && categoryVisible(ctx, "Annotation")) drawDimension(doc, ctx, B, f);
  }
  if (categoryVisible(ctx, "Annotation")) drawConstraintGlyphs(doc, ctx, B);
  B.prims.push(...B.later);          // labels sit on top of fills and furniture
  const clip = doc.argValue(v, "clip");
  const scene = { prims: B.prims, hits: B.hits, links: B.links, scale: S, kind: "plan",
    stats: { walls: stat.walls, offsets: doc.stats.offsets - stat.offsetsBefore } };
  if (clip && clip.active && clip.rect) scene.clip = [clip.rect[0] / S, clip.rect[1] / S, clip.rect[2] / S, clip.rect[3] / S];
  if (clip && clip.visible && clip.rect) B.prims.push({ t: "stroke", path: rectPath(...scene.clip || clip.rect.map(x => x / S)), weight: 0.25, colour: "#1d6fd8", dash: [3, 1.5], layer: "Crop", id: doc.idOf(v) });
  scene.bbox = scene.clip || sceneBBox(B.prims);
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
  let regions;
  if (!w.fast && w.curve.type === "line") {
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
    doc.stats.fastPath++;
    try { regions = wallRegions(w, detail, cutZ, w.openings || []); }
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
        if (pat.batt && r.layer !== null) battLine(doc, B, w, r, gp, id);
        else B.hatch(r.path, pat, g.pattern, gp.colour, gp.weight, "IfcWall-Pattern", id);
      }
    }
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
  if (k === "Area") { const d = doc.data(f); return d && d.props && d.props.Area ? (d.props.Area.v / 1e6).toFixed(1) + " m²" : "—"; }
  const p = doc.getParam(f, k); if (p !== undefined) return displayParam(doc, f, p);
  const v = propertyOf(doc, f, k); return v && !v.error ? formatValue(v) : "";
}
const DEPT = ["#dce9f7", "#f8e3cf", "#dff1e2", "#f3dcec", "#fff2c4", "#e4e0f7", "#d8f0f0"];
export function departmentColour(v) { let h = 0; for (const c of v) h = (h * 31 + c.charCodeAt(0)) >>> 0; return DEPT[h % DEPT.length]; }

function drawGrid(doc, ctx, B, f) {
  const c = F.json(f, "line"), id = doc.idOf(f), S = ctx.scale;
  const g = resolveGraphics(doc, ctx, f, "projection");
  B.stroke([lineSeg(c.start, c.end)], Object.assign({}, g, { dash: LINE_TYPES.centre }), "IfcGrid", id);
  // Paper-space bubbles: 8mm on the sheet at every scale.
  const d = normalise(sub(c.end, c.start));
  for (const [p, sgn] of [[c.start, -1], [c.end, 1]]) {
    const cp = add(B.P(p), mul(d, sgn * 4));
    B.stroke(circlePath(cp, 4), { weight: g.weight, colour: g.colour }, "IfcGrid", id, true);
    B.text([cp[0], cp[1] - 1.25], F.text(f, "name"), 3.5 * 0.72, { align: "centre", layer: "IfcGrid", id });
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

/** Where a dimension sits: witness feet a, b; the measured direction; the dimension line A–Bp at its offset. */
export function dimensionGeometry(doc, f, m = measureRefs(doc, F.json(f, "of") || [])) {
  if (!m || m.lost || m.value == null) return null;
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
  const txt = String(Math.round(m.value * 10) / 10);
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
  const c = F.json(v, "line"), d = normalise(sub(c.end, c.start)), look = mul(perp(d), -1), Lv = dist(c.start, c.end);
  const depthMax = F.real(v, "depth");
  const lv = F.reference(v, "baseLevel"), Z0 = lv ? (doc.data(lv) || {}).value || 0 : 0, topZ = Z0 + F.real(v, "top");
  const sOf = p => dot(sub(p, c.start), d), depthOf = p => dot(sub(p, c.start), look);
  const V = (p, z) => [sOf(p), z - Z0];              // view coords, model mm
  const items = [];
  for (const f of doc.elements()) {
    if (f.get("Integer") === 0 || doc.error(f)) continue;
    // Visibility/Graphics is data: a category switched off in this view's style is not drawn, here as in plan
    if (!categoryVisible(ctx, categoryOf(doc, f))) continue;
    const t = doc.typeOf(f);
    if (t === "Wall") { const w = doc.plan(f); if (!w) continue; const it = elevWall(doc, f, w, V, sOf, depthOf, ctx); if (it) items.push(it); }
    if (t === "Column") { const p = doc.plan(f); if (!p) continue; const pts = p.foot.length ? p.foot : samplePath(p.path); const ss = pts.map(sOf), dd = pts.map(depthOf);
      const s0 = Math.min(...ss), s1 = Math.max(...ss); const sil = [[s0, p.z0 - Z0], [s1, p.z0 - Z0], [s1, p.z1 - Z0], [s0, p.z1 - Z0]];
      items.push({ id: doc.idOf(f), f, depth: Math.min(...dd), depthMax: Math.max(...dd), s0, s1, curves: polyPath(sil).map(x => [x.a, x.b]), sil: [sil], cat: "IfcColumn" }); }
  }
  const inView = it => it.depthMax >= -TOL && it.depth <= depthMax && it.s1 >= 0 && it.s0 <= Lv;
  const vis = items.filter(inView).sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1));   // deterministic ties (test 40)
  // Datum lines first (never occluded), so the building draws over them.
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
  // Grids crossing the view line: vertical datum lines.
  for (const f of doc.elements()) if (doc.typeOf(f) === "Grid" && categoryVisible(ctx, "IfcGrid")) {
    const gl = F.json(f, "line"), gd = normalise(sub(gl.end, gl.start));
    const den = d[0] * gd[1] - d[1] * gd[0]; if (Math.abs(den) < 1e-9) continue;
    const t = ((gl.start[0] - c.start[0]) * gd[1] - (gl.start[1] - c.start[1]) * gd[0]) / den;
    if (t < 0 || t > Lv) continue;
    const top = F.real(v, "top") + 600;
    B.stroke([lineSeg([t, -300], [t, top])], { weight: penWeight(doc, "hairline", S), colour: "#000", dash: LINE_TYPES.centre }, "IfcGrid", doc.idOf(f));
    const bp = add(B.P([t, top]), [0, 4]);
    B.stroke(circlePath(bp, 4), { weight: penWeight(doc, "thin", S), colour: "#000" }, "IfcGrid", doc.idOf(f), true);
    B.text([bp[0], bp[1] - 1.25], F.text(f, "name"), 2.5, { align: "centre", layer: "IfcGrid", id: doc.idOf(f) });
  }
  const occluders = [];
  for (const it of vis) {
    const bandIdx = Math.min(2, Math.floor(Math.max(0, it.depth) / (depthMax / 3 + 1e-9)));
    const pen = ["medium", "thin", "hairline"][bandIdx];
    const g = resolveGraphics(doc, ctx, it.f, "projection");
    const gw = { weight: g.weight === "none" ? "none" : penWeight(doc, pen, S), colour: g.colour, dash: g.dash };
    for (const [a, b] of it.curves) {
      let pieces = [[a, b]];
      for (const occ of occluders) { const next = []; for (const [p, q] of pieces) next.push(...segMinusConvex(p, q, occ, 1e-3)); pieces = next; if (!pieces.length) break; }
      for (const [p, q] of pieces) B.stroke([lineSeg(p, q)], gw, it.cat, it.id);
    }
    for (const s of it.sil) occluders.push(ensureCCW(s));
    B.hit(it.id, it.sil[0]);
  }
  const scene = { prims: B.prims, hits: B.hits, links: [], scale: S, kind: "elevation", stats: { items: vis.length } };
  scene.bbox = sceneBBox(B.prims);
  return scene;
}

/** A wall's elevation rep and silhouette, from its construction — not from a solid. */
function elevWall(doc, f, w, V, sOf, depthOf, ctx) {
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
  return { id: w.id, f, depth: Math.max(0, Math.min(...dd)), depthMax: Math.max(...dd), s0, s1, curves, sil: sil.length ? sil : [[[s0, baseZ], [s1, baseZ], [s1, t1], [s0, t0]]], cat: "IfcWall" };
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
export function view3dScene(doc, v, opts = {}) {
  const ctx = viewContext(doc, v), S = ctx.scale, B = new SceneBuilder(S);
  const cache = doc._hlrCache && doc._hlrCache[doc.idOf(v)];
  const cam = JSON.stringify(doc.argValue(v, "camera"));
  const scene = { prims: B.prims, hits: [], links: [], scale: S, kind: "3d" };
  if (cache && cache.camera === cam && (cache.vis || "") !== visibilityKey(doc, v)) scene.stale = "Visibility/Graphics changed since generation";
  if (!cache || cache.camera !== cam) { scene.stale = "never generated"; B.text([0, 0], "Hidden-line view not generated yet", 3, {}); scene.bbox = [-5, -5, 120, 10]; return scene; }
  if (cache.revision !== doc.modelRevision) scene.stale = `model changed since generation (rev ${cache.revision} → ${doc.modelRevision})`;
  const render = doc.argValue(v, "render") || {};
  const style = ctx.style.byCategory && ctx.style.byCategory.View3D || {};
  const slots = { visible: { pen: "medium", on: true }, outlineV: { pen: "medium", on: true }, smoothV: { pen: "hairline", on: false }, hidden: { pen: "hairline", on: !!render.hidden, dash: LINE_TYPES.hidden }, outlineH: { pen: "hairline", on: !!render.hidden, dash: LINE_TYPES.hidden } };
  if (cache.raster && render.mode === "linesOverShaded") B.prims.push({ t: "raster", rect: [cache.bbox[0] / S, cache.bbox[1] / S, (cache.bbox[2] - cache.bbox[0]) / S, (cache.bbox[3] - cache.bbox[1]) / S], url: cache.raster, dpi: cache.rasterDPI, layer: "Shaded" });
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
export function sheetScene(doc, sh, opts = {}) {
  const size = sheetSize(sh), [W, H] = size;
  const prims = [], links = [];
  const border = 10;
  const g = (w) => ({ weight: w, colour: "#000" });
  const put = (path, w) => prims.push({ t: "stroke", path, weight: w, colour: "#000000", layer: "TitleBlock" });
  const txt = (at, text, h, o = {}) => prims.push(Object.assign({ t: "text", at, text: String(text), height: h, rot: 0, align: "left", valign: "baseline", colour: "#000", layer: "TitleBlock" }, o));
  prims.push({ t: "fill", path: rectPath(0, 0, W, H), colour: "#ffffff", layer: "Paper" });
  put(rectPath(border, border, W - border, H - border), 0.7);
  // Title block: a strip down the right-hand side, scaled to the sheet.
  const tbw = Math.min(180, W * 0.22), tx = W - border - tbw;
  put([lineSeg([tx, border], [tx, H - border])], 0.5);
  const fields = [["Project", doc.meta.name], ["Sheet", doc.argValue(sh, "sheetName")], ["Number", doc.argValue(sh, "number")], ["Revision", doc.argValue(sh, "revision")], ["Scale", viewportScales(doc, sh)], ["Size", `${doc.argValue(sh, "size")} ${doc.argValue(sh, "orientation")}`]];
  let y = border + 8;
  for (let i = fields.length - 1; i >= 0; i--) {
    const [k, v] = fields[i], big = k === "Number" || k === "Sheet";
    const rowH = big ? 16 : 11;
    put([lineSeg([tx, y + rowH], [W - border, y + rowH])], 0.25);
    txt([tx + 3, y + rowH - 4], k.toUpperCase(), 1.8, { colour: "#555" });
    // shrink a long value to fit the title block rather than let it run off the sheet
    const hh = Math.min(big ? 5 : 3, (tbw - 6) / Math.max(1, textWidth(String(v), 1)));
    txt([tx + 3, y + 3], v, hh, {});
    y += rowH;
  }
  txt([tx + 3, H - border - 8], "WEB BIM", 5, {});
  txt([tx + 3, H - border - 13], "Drawn from the model. Line weights in paper mm.", 1.8, { colour: "#555" });
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
    prims.push({ t: "group", clip, prims: sc.prims.map(p => translatePrim(p, off)), layer: "Viewport", vp: vp.id, view: vp.view.ref, stale: sc.stale || null });
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
  return { prims, links, hits: [], size, bbox: [0, 0, W, H], kind: "sheet" };
}
function viewportScales(doc, sh) {
  const s = [...new Set((doc.argValue(sh, "viewports") || []).map(vp => doc.element(vp.view.ref)).filter(v => v && doc.typeOf(v) !== "Schedule").map(v => "1:" + (F.int(v, "scale") || 100)))];
  return s.join(", ") || "—";
}
export function translatePrim(p, o) {
  const T = q => [q[0] + o[0], q[1] + o[1]];
  const tp = path => path.map(s => s.k === "L" ? { k: "L", a: T(s.a), b: T(s.b) } : s.k === "A" ? Object.assign({}, s, { c: T(s.c) }) : { k: "C", a: T(s.a), c1: T(s.c1), c2: T(s.c2), b: T(s.b) });
  const q = Object.assign({}, p);
  if (p.path) q.path = tp(p.path);
  if (p.at) q.at = T(p.at);
  if (p.rect) q.rect = [p.rect[0] + o[0], p.rect[1] + o[1], p.rect[2], p.rect[3]];
  if (p.t === "group") { q.prims = p.prims.map(x => translatePrim(x, o)); if (p.clip) q.clip = [p.clip[0] + o[0], p.clip[1] + o[1], p.clip[2] + o[0], p.clip[3] + o[1]]; }
  if (p.t === "hatch") q.origin = T(p.origin || [0, 0]);
  return q;
}
