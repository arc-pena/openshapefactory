//! A view's crop region: a rectangle, or a closed sketch that drives the boundary.
//!
//! The crop is data on the view (`clip`): `rect` in model mm, `active`, `visible`,
//! `annotation` (how far the annotation crop stands outside the crop, in paper mm:
//! left, bottom, right, top) and, after Edit Crop, `shape` - the sketch itself:
//! lines, arcs, circles, ellipses and splines. The sketch is kept as drawn so it
//! can be edited again; the boundary a view clips to is sampled from it here.

import { outline, regionsOf } from "./bimsketch.js";

export const ANNOTATION_CROP = [8, 8, 8, 8];          // paper mm, as Revit's default feels at 1:100
export const CLOSE_TOL = 2;                            // mm: sketch ends closer than this meet

/** Points along one sketch element, in drawing order: the CAD sketch kernel's own outline, so a
 *  crop drawn with any of the sketcher's elements (splines by control points too) clips the same. */
export function sampleCropElement(el, n = 48) { return outline(el, n); }
/** The sketch's elements as one closed loop: { pts } or { error }. A crop is a single loop. */
export function chainLoop(elements) {
  const els = (elements || []).filter(Boolean).map((e, i) => Object.assign({ id: "c" + (i + 1) }, e));
  const r = regionsOf({ elements: els, constraints: [] });
  if (r.error) return { error: r.error };
  if (r.regions.length !== 1 || r.regions[0].holes.length) return { error: "a crop is one closed loop, with no holes" };
  return { pts: r.regions[0].outer };
}
/** The loop a view clips to, in model mm: the sketch when there is one, else the rectangle. */
export function cropLoop(clip) {
  if (!clip) return null;
  if (clip.shape && clip.shape.elements && clip.shape.elements.length) { const r = chainLoop(clip.shape.elements); if (r.pts) return r.pts; }
  if (!clip.rect) return null;
  const [x0, y0, x1, y1] = clip.rect;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
export const loopBBox = pts => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
/** The annotation crop, in paper mm, around a crop bbox given in paper mm. */
export function annotationRect(clip, bbPaper) {
  const a = (clip && clip.annotation) || ANNOTATION_CROP;
  return [bbPaper[0] - a[0], bbPaper[1] - a[1], bbPaper[2] + a[2], bbPaper[3] + a[3]];
}
/** Layers that belong to the annotation crop rather than the model crop. */
export const isAnnotationLayer = layer => /^(Annotation|IfcGrid|Crop)/.test(layer || "");
