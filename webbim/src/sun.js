//! The sun and the hard shadows it casts. One definition of where the sun is, read by the plan (vector
//! shadows swept onto the level's ground plane), the 3D view (a directional light with a shadow map)
//! and the sheets that place them. Azimuth is clockwise from north (+y), altitude above the horizon.

import { elementParts } from "./solids.js";
import { ensureCCW, polyArea } from "./geom2d.js";

export const SUN_DEFAULT = { on: false, azimuth: 135, altitude: 35, colour: "#23272e", opacity: 0.32, cast: "Below cut" };
export const sunOf = v => Object.assign({}, SUN_DEFAULT, v || {});

/** Unit vector from the ground toward the sun. */
export function sunDirection(sun) {
  const az = (sun.azimuth || 0) * Math.PI / 180, alt = Math.max(1, Math.min(89.9, sun.altitude || 35)) * Math.PI / 180;
  return [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
}

/** Every body as matched bottom and top rings in 3D: wall pieces (raking tops, leaning faces), columns, and the
 *  parts families build (doors, windows, floors, beams, generic models; lofts keep their own top). */
function bodies(doc, f) {
  const t = doc.typeOf(f), out = [];
  for (const pc of elementParts(doc, f)) {
    if (!pc.foot || pc.foot.length < 3 || !(pc.z1 > pc.z0)) continue;
    const k = pc.lean ? Math.tan(pc.lean) : 0, n2 = pc.n2 || [0, 0], zRef = pc.zRef ?? pc.z0;
    const shift = (p, z) => k ? [p[0] + n2[0] * k * (z - zRef), p[1] + n2[1] * k * (z - zRef)] : p;
    const bot = pc.foot.map(p => [...shift(p, pc.z0), pc.z0]);
    const topRing = pc.topFoot && pc.topFoot.length === pc.foot.length ? pc.topFoot : pc.foot;
    const top = topRing.map(p => { const z = pc.topAt ? pc.topAt(p) : pc.z1; return [...shift(p, z), z]; });
    out.push({ bot, top });
  }
  return out;
}

/** Shadow outlines on the plane z = ground, cast by what stands on it: each body's rings and the quads
 *  between them projected along the sun, all counter-clockwise so one non-zero fill unions them.
 *  `below` (a plan's cut height) keeps only what is below it: the plan's own cut throws the shadow. */
export function planShadows(doc, sun, ground, { below = null, visible = null } = {}) {
  const L = sunDirection(sun), t = Math.hypot(L[0], L[1]) / L[2], lx = L[0] / (Math.hypot(L[0], L[1]) || 1), ly = L[1] / (Math.hypot(L[0], L[1]) || 1);
  const P = p => [p[0] - lx * t * (p[2] - ground), p[1] - ly * t * (p[2] - ground)];
  const lerp3 = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  const rings = [];
  for (const f of doc.elements()) {
    if (f.get("Integer") === 0 || doc.error(f) || (visible && !visible(f))) continue;
    const ty = doc.typeOf(f); if (!["Wall", "Column", "Door", "Window", "Floor", "Beam", "Generic"].includes(ty)) continue;
    for (let { bot, top } of bodies(doc, f)) {
      const hi = Math.max(...top.map(p => p[2])), lo = Math.min(...bot.map(p => p[2]));
      if (hi <= ground + 0.5 || (below !== null && lo >= below)) continue;
      // standing on the ground: nothing below it casts; cut by the plan: nothing above the cut does
      if (lo < ground) { const b2 = bot.map((p, i) => lerp3(p, top[i], Math.max(0, Math.min(1, (ground - p[2]) / ((top[i][2] - p[2]) || 1))))); bot = b2; }
      if (below !== null && hi > below) { const t2 = top.map((p, i) => lerp3(bot[i], p, Math.max(0, Math.min(1, (below - bot[i][2]) / ((p[2] - bot[i][2]) || 1))))); top = t2; }
      const B = bot.map(P), T = top.map(P), n = B.length;
      for (const r of [B, T]) if (Math.abs(polyArea(r)) > 1) rings.push(ensureCCW(r));
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, q = [B[i], B[j], T[j], T[i]]; if (Math.abs(polyArea(q)) > 1) rings.push(ensureCCW(q)); }
    }
  }
  return rings;
}
