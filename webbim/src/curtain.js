//! Revit's curtain wall: a wall type whose body is a grid instead of layers. Vertical grid lines along the
//! wall and horizontal ones up it - at a fixed distance (from the start, the end or centred), a fixed number,
//! or listed one by one - divide its face into panels (glass, or an opaque cladding panel: the same system
//! draws a storefront and a rainscreen's joints), and a mullion runs on every grid line and round the border.
//! The grid is cut by the wall's own outline: under a gable or a roof the wall is attached to, the top border
//! follows the rake as its top chord, the vertical mullions stop against it and each transom is trimmed where
//! it meets it; openings in the wall take their panels out.
//!
//! Type: `curtain: { vertical, horizontal, mullion: { width, depth, material }, border, panel: { material, thickness } }`
//! with each direction `{ layout: "Fixed distance" | "Fixed number" | "None", spacing, number, justify:
//! "Beginning" | "Centre" | "End", positions: [mm from the start / the base] }`. A wall can override its type's
//! grid with its own `curtainGrid` (Revit's instance grid).

import { profileAt, pointAt } from "./walls.js";

/** The wall's curtain system, its type's merged with the instance's own grid; null for an ordinary wall. */
export function curtainOf(type, inst) {
  const c = type && type.curtain; if (!c) return null;
  const o = inst || {};
  // panels swapped one by one (Revit's panel type per cell): { "i,j": material | "none" }, i along the wall, j up it
  return Object.assign({}, c, { vertical: Object.assign({}, c.vertical, o.vertical), horizontal: Object.assign({}, c.horizontal, o.horizontal), panels: Object.assign({}, c.panels, o.panels) });
}
/** Grid positions strictly inside (0, L) for one direction. */
function cwPositions(spec, L) {
  if (!spec) return [];
  if (Array.isArray(spec.positions)) return spec.positions.filter(x => x > 1 && x < L - 1).sort((a, b) => a - b);
  const lay = spec.layout || (spec.number ? "Fixed number" : spec.spacing ? "Fixed distance" : "None");
  if (lay === "Fixed number") { const n = Math.max(1, spec.number | 0); return Array.from({ length: n - 1 }, (_, i) => L * (i + 1) / n); }
  if (lay === "Maximum spacing") { const n = Math.max(1, Math.ceil(L / (spec.spacing || L) - 1e-9)); return Array.from({ length: n - 1 }, (_, i) => L * (i + 1) / n); }
  if (lay !== "Fixed distance" || !(spec.spacing > 1)) return [];
  const sp = spec.spacing, off = spec.offset || 0, out = [];
  const j = spec.justify || "Beginning";
  const start = j === "End" ? (L - off) % sp : j === "Centre" ? (L / 2 + off) % sp : off % sp;
  for (let x = start; x < L - 1; x += sp) if (x > 1) out.push(x);
  return out;
}
/** The wall's top above its base at u (a profile, a raking top, or flat). */
export function topAbove(w, u) {
  if (w.profile) return profileAt(w.profile, u, 0);
  return w.height + (w.topSlope ? Math.tan(w.topSlope) * u : 0);
}
/** Where the top changes slope along the wall, with both ends. */
function cwTopBreaks(w) { return [...new Set([0, w.L, ...(w.profile ? w.profile.map(q => q[0]) : [])])].sort((a, b) => a - b); }
/** The stretches of [0, L] where f(u) = top(u) - drop stays above z: a transom's extent under a gable. */
function cwAbove(w, z, drop) {
  const U = cwTopBreaks(w), f = u => topAbove(w, u) - drop - z, out = [];
  let cur = f(0) > 1e-6 ? 0 : null;
  for (let i = 1; i < U.length; i++) {
    const a = U[i - 1], b = U[i], fa = f(a + 1e-9), fb = f(b - 1e-9);
    if ((fa > 0) !== (fb > 0) && Math.abs(fb - fa) > 1e-9) { const x = a + (b - a) * fa / (fa - fb); if (fa > 0) { if (cur !== null) out.push([cur, x]); cur = null; } else cur = x; }
    else if (fa <= 0 && fb > 0 && cur === null) cur = a;
  }
  if (cur !== null) out.push([cur, w.L]);
  return out.filter(([a, b]) => b - a > 1);
}
/** The grid: vertical lines' u, horizontal lines' z (above the base), and the system's sizes. */
export function curtainGrid(w) {
  const c = w.curtain, L = w.L, H = Math.max(...cwTopBreaks(w).map(u => topAbove(w, u)));
  const mw = (c.mullion && c.mullion.width) || 50, md = (c.mullion && c.mullion.depth) || 150;
  return { us: cwPositions(c.vertical, L), zs: cwPositions(c.horizontal, H), mw, md, border: c.border !== false, L, H };
}
/** Panels as polygons in (u, z above the base): each grid cell inset by half a mullion, clipped under the
 *  top (less half a mullion - the top chord), and less the openings the wall hosts. */
export function curtainPanels(w) {
  const g = curtainGrid(w), m = g.mw / 2, b = g.border ? g.mw : m;
  const U = [0, ...g.us, g.L], Z = [0, ...g.zs, g.H], out = [];
  for (let i = 0; i + 1 < U.length; i++) for (let j = 0; j + 1 < Z.length; j++) {
    const ua = U[i] + (i === 0 ? b : m), ub = U[i + 1] - (i + 1 === U.length - 1 ? b : m), za = Z[j] + (j === 0 ? b : m), zt = Z[j + 1] - m;
    if (ub - ua < 1 || zt - za < 1) continue;
    const drop = b;
    // the cell's top: under its own grid line, and under the wall's top wherever that comes lower
    const f = u => Math.min(zt, topAbove(w, u) - drop);
    const bp = new Set([ua, ub]);
    for (const u of cwTopBreaks(w)) if (u > ua && u < ub) bp.add(u);
    const us0 = [...bp].sort((x, y) => x - y);
    for (let k = 1; k < us0.length; k++) { const a = us0[k - 1], c2 = us0[k], ta = topAbove(w, a + 1e-9) - drop, tb = topAbove(w, c2 - 1e-9) - drop;
      for (const lev of [zt, za]) if ((ta - lev) * (tb - lev) < 0) bp.add(a + (c2 - a) * (ta - lev) / (ta - tb)); }
    const us = [...bp].sort((x, y) => x - y);
    let run = [];
    const flush = () => { if (run.length >= 2) { const poly = [[run[0], za], [run[run.length - 1], za], ...run.slice().reverse().map(u => [u, f(u)])]
      const clean = poly.filter((q, k) => { const r = poly[(k + poly.length - 1) % poly.length]; return Math.abs(q[0] - r[0]) > 1e-6 || Math.abs(q[1] - r[1]) > 1e-6; });
      if (clean.length >= 3) out.push({ i, j, poly: clean }); } run = []; };
    let last = null;
    for (const u of us) { if (f(u) > za + 1e-6) { if (!run.length && last !== null) run.push(last); run.push(u); } else { if (run.length) { run.push(u); flush(); } last = u; } }
    flush();
  }
  // openings take their panels out (a door or a storefront set in the grid)
  const ops = w.openings || [];
  if (!ops.length) return withMaterial(w, out);
  const res = [];
  for (const p of out) {
    let pieces = [p.poly];
    for (const op of ops) pieces = pieces.flatMap(poly => { const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const ox0 = op.u0, ox1 = op.u1, oy0 = op.sill, oy1 = op.sill + op.h;
      if (ox1 <= x0 || ox0 >= x1 || oy1 <= y0 || oy0 >= y1) return [poly];
      if (poly.length !== 4) return ox0 <= x0 && ox1 >= x1 && oy0 <= y0 && oy1 >= y1 ? [] : [poly];
      const r = []; const R = (a, b2, c, d) => { if (b2 - a > 1 && d - c > 1) r.push([[a, c], [b2, c], [b2, d], [a, d]]); };
      R(x0, Math.max(x0, ox0), y0, y1); R(Math.min(x1, ox1), x1, y0, y1); R(Math.max(x0, ox0), Math.min(x1, ox1), y0, Math.max(y0, oy0)); R(Math.max(x0, ox0), Math.min(x1, ox1), Math.min(y1, oy1), y1);
      return r; });
    for (const poly of pieces) res.push({ i: p.i, j: p.j, poly });
  }
  return withMaterial(w, res);
}
/** Each panel's material: its own (swapped), else the system's; a panel swapped to "none" is left open. */
function withMaterial(w, list) {
  const c = w.curtain, dflt = (c.panel && c.panel.material) || "M-GLASS", sw = c.panels || {};
  // a cell's entry is a material, or { m: material, swing: "L" | "R" | "T" | "B" | "D" } for an operable sash or a door
  return list.map(p => { const v = sw[`${p.i},${p.j}`] || sw[`*,${p.j}`] || sw[`${p.i},*`] || dflt; return Object.assign(p, typeof v === "object" ? { material: v.m || dflt, swing: v.swing || null } : { material: v }); }).filter(p => p.material !== "none");
}
/** The mullions as centre lines in (u, z above the base): the border (its top along the rake), every vertical
 *  up to the top, every horizontal across the stretches the top leaves it. */
export function curtainMullions(w) {
  const g = curtainGrid(w), out = [], ops = w.openings || [];
  const cutV = (u, z0, z1) => { let spans = [[z0, z1]]; for (const op of ops) if (u > op.u0 && u < op.u1) spans = spans.flatMap(([a, b]) => [[a, Math.min(b, op.sill)], [Math.max(a, op.sill + op.h), b]]).filter(([a, b]) => b - a > 1); return spans; };
  const cutH = (z, u0, u1) => { let spans = [[u0, u1]]; for (const op of ops) if (z > op.sill && z < op.sill + op.h) spans = spans.flatMap(([a, b]) => [[a, Math.min(b, op.u0)], [Math.max(a, op.u1), b]]).filter(([a, b]) => b - a > 1); return spans; };
  for (const u of g.us) for (const [a, b] of cutV(u, 0, topAbove(w, u))) out.push({ kind: "v", a: [u, a], b: [u, b] });
  for (const z of g.zs) for (const [ua, ub] of cwAbove(w, z, g.border ? g.mw : 0)) for (const [a, b] of cutH(z, ua, ub)) out.push({ kind: "h", a: [a, z], b: [b, z] });
  if (g.border) {
    for (const u of [0, g.L]) out.push({ kind: "v", a: [u, 0], b: [u, topAbove(w, u)], border: true });
    for (const [a, b] of cutH(0, 0, g.L)) out.push({ kind: "h", a: [a, 0], b: [b, 0], border: true });
    const U = cwTopBreaks(w);
    for (let i = 1; i < U.length; i++) out.push({ kind: "top", a: [U[i - 1], topAbove(w, U[i - 1] + 1e-9)], b: [U[i], topAbove(w, U[i] - 1e-9)], border: true });
  }
  return out;
}
/** 3D pieces: a thin panel per cell and a prism per mullion, on the wall's centre (straight walls). */
export function curtainPieces(w, doc) {
  const g = curtainGrid(w), c = w.curtain, n = w.stack.s.length - 1, sc = (w.stack.s[0] + w.stack.s[n]) / 2;
  const pc = (c.panel && c.panel.thickness) || 25, pm = (c.panel && c.panel.material) || "M-GLASS", mm = (c.mullion && c.mullion.material) || "M-ALUM";
  const colourOf = m => (((doc && doc.lib.materials[m]) || {}).shading || {}).colour;
  const isGlass = m => /GLASS|GLAZ/i.test(m);
  const box = (u0, u1, s0, s1) => [pointAt(w, s0, u0), pointAt(w, s0, u1), pointAt(w, s1, u1), pointAt(w, s1, u0)];
  const out = [];
  for (const p of curtainPanels(w)) {
    const xs = p.poly.map(q => q[0]), u0 = Math.min(...xs), u1 = Math.max(...xs), zb = Math.min(...p.poly.map(q => q[1]));
    const zt = Math.max(...p.poly.map(q => q[1])), flat = p.poly.length === 4 && p.poly.every(q => Math.abs(q[1] - zb) < 1e-6 || Math.abs(q[1] - zt) < 1e-6);
    // a clipped panel's top: the polygon's upper chain, as a height at a plan point
    const top = flat ? null : (() => { const up = p.poly.filter(q => q[1] > zb + 1e-6).sort((a, b) => a[0] - b[0]); return pt => { const u = Math.max(u0, Math.min(u1, cwUAlong(w, pt))); for (let k = 1; k < up.length; k++) if (u <= up[k][0] + 1e-9) { const a = up[k - 1], b = up[k]; return w.z0 + (b[0] - a[0] < 1e-9 ? b[1] : a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0])); } return w.z0 + (up.length ? up[up.length - 1][1] : zt); }; })();
    const g = isGlass(p.material);
    out.push({ foot: box(u0, u1, sc - pc / 2, sc + pc / 2), z0: w.z0 + zb, z1: w.z0 + zt, topAt: top, sub: g ? "Glass" : "Panel", colour: g ? undefined : colourOf(p.material), zRef: w.z0 });
  }
  const m2 = g.mw / 2, d2 = g.md / 2;
  for (const mu of curtainMullions(w)) {
    if (mu.kind === "v") { const u0 = Math.max(0, mu.a[0] - m2), u1 = Math.min(w.L, mu.a[0] + m2), uc = mu.a[0];
      const reachesTop = Math.abs(mu.b[1] - topAbove(w, uc)) < 1;
      out.push({ foot: box(u0, u1, sc - d2, sc + d2), z0: w.z0 + mu.a[1], z1: w.z0 + mu.b[1], topAt: reachesTop && (w.profile || w.topSlope) ? (pt => w.z0 + topAbove(w, Math.max(0, Math.min(w.L, cwUAlong(w, pt))))) : null, sub: "Mullion", colour: colourOf(mm), zRef: w.z0 }); }
    else if (mu.kind === "h") out.push({ foot: box(mu.a[0], mu.b[0], sc - d2, sc + d2), z0: w.z0 + Math.max(0, mu.a[1] - m2), z1: w.z0 + mu.a[1] + m2, topAt: null, sub: "Mullion", colour: colourOf(mm), zRef: w.z0 });
    else { const ua = mu.a[0], ub = mu.b[0];
      out.push({ foot: box(ua, ub, sc - d2, sc + d2), z0: w.z0 + Math.min(mu.a[1], mu.b[1]) - g.mw, z1: w.z0 + Math.max(mu.a[1], mu.b[1]), topAt: pt => w.z0 + topAbove(w, Math.max(0, Math.min(w.L, cwUAlong(w, pt)))), sub: "Mullion", colour: colourOf(mm), zRef: w.z0 }); }
  }
  return out;
}
function cwUAlong(w, p) { return (p[0] - w.a[0]) * w.d[0] + (p[1] - w.a[1]) * w.d[1]; }
