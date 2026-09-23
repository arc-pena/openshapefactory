//! Every element's 3D body as prisms: a plan footprint pulled between two heights.
//!
//! One list, three readers: the 3D view builds its meshes from it, hidden-line
//! removal builds its faces from it, and the CAD bridge writes each prism as a
//! sketch and an extrusion. Families decide what their parts are (bim.js); this
//! only gathers them, so a door that gains a handle gains it everywhere at once.

import { samplePath } from "./geom2d.js";

/** [{foot, z0, z1, sub, leaf?, pivot?, topAt?}] for one element; [] when it has no body. */
export function elementParts(doc, f) {
  const t = doc.typeOf(f), p = doc.plan(f);
  if (!p) return [];
  if (t === "Wall") return (p.pieces || []).map(pc => Object.assign({ sub: "Wall" }, pc));
  if (t === "Column") return [{ foot: p.foot.length ? p.foot : samplePath(p.path).slice(0, -1), z0: p.z0, z1: p.z1, sub: "Column", smooth: p.foot.length === 16 }];
  if (t === "Door" || t === "Window" || t === "Floor" || t === "Beam") { const d = doc.data(f); return (d && d.parts) || (p.parts || []); }
  return [];
}
