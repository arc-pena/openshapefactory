//! Phase 3 of the cycle (§1.6): joins are rows of user intent, read by a system
//! pass after every wall has built its own unjoined surfaces. The wall driver
//! never knows what it is joined to. Read in the terms of §3.1, all of this is
//! choosing an END SURFACE per layer — the geometry after is one intersection.

import {
  TOL, MITER_LIMIT, sub, add, mul, dot, cross, dist, perp, normalise, intersectLines, intersectLineCircle, intersectCircles,
  projectPoint, angleOf, TAU, wrap,
} from "./geom2d.js";
import { boundary, termPoint, uOf, sideOf, pointAt, layerRegion, faceLine } from "./walls.js";

export const JOIN_TOL = 1.0;   // mm: ends closer than this share a node

/** Blocking rule for a butt/T: does a layer of priority pB (the other wall)
 *  stop a layer of priority pA arriving? Lower number wins. Equal priorities
 *  pass, except structure, which meets structure: that is what makes a
 *  partition's plasterboard run to the blockwork face (test 6) while its
 *  studs stop at the blockwork (test 7). */
export const blocks = (pB, pA) => pB < pA || (pB === pA && pA === 1);

// ---------------------------------------------------------------- boundary geometry
/** A boundary as analytic geometry: a line or a circle (null for fitted curves). */
export function boundaryGeom(w, s) {
  if (w.curve.type === "line") return { line: faceLine(w, s) };
  if (w.curve.type === "arc" || w.curve.type === "circle") return { c: w.curve.centre, r: w.curve.ccw ? w.curve.radius - s : w.curve.radius + s };
  return null;
}
function meet(g1, g2, guess) {
  let pts = [];
  if (!g1 || !g2) return null;
  if (g1.line && g2.line) { const p = intersectLines(g1.line, g2.line); pts = p ? [p] : []; }
  else if (g1.line) pts = intersectLineCircle(g1.line, g2.c, g2.r);
  else if (g2.line) pts = intersectLineCircle(g2.line, g1.c, g1.r);
  else pts = intersectCircles(g1.c, g1.r, g2.c, g2.r);
  let best = null, bd = Infinity; for (const p of pts) { const d = dist(p, guess); if (d < bd) { bd = d; best = p; } }
  return best;
}
/** termPoint, extended with the "another wall's boundary" terminator. */
export function termAt(w, s, term, nearU) {
  if (term.k !== "wall") return termPoint(w, s, term, nearU);
  const guess = pointAt(w, s, nearU);
  return meet(boundaryGeom(w, s), boundaryGeom(term.w, term.s), guess) || guess;
}

// ---------------------------------------------------------------- the pass
/** Resolve every join row against the current wall records.
 *  Writes w.ends = {start, end} and w.cuts = [...] and returns notes by wall id. */
export function resolveJoins(walls, rows) {
  const notes = new Map();
  const say = (id, msg) => { if (!notes.has(id)) notes.set(id, []); notes.get(id).push(msg); };
  for (const w of walls.values()) { w.ends = { start: { k: "free" }, end: { k: "free" } }; w.cuts = []; w.joinedTo = new Set(); }

  // End-to-end rows form nodes; union-find over wall ends.
  const parent = new Map();
  const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const unite = (a, b) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(find(a), find(b)); };
  const kindOf = new Map();
  for (const j of rows) {
    const A = walls.get(j.a.of), B = walls.get(j.b.of);
    if (!A || !B) continue;
    if (j.allowed === false || j.kind === "square") continue;           // both ends squared off
    if (j.b.end) { const ka = j.a.of + ":" + j.a.end, kb = j.b.of + ":" + j.b.end; unite(ka, kb); kindOf.set(ka, j); kindOf.set(kb, j); }
  }
  const clusters = new Map();
  for (const k of parent.keys()) { const r = find(k); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(k); }

  for (const keys of clusters.values()) {
    if (keys.length < 2) continue;
    const ends = keys.map(k => { const [id, e] = k.split(":"); const w = walls.get(id); return { id, e, w, p: e === "start" ? w.curve.start : w.curve.end }; });
    const P0 = ends[0].p;
    const far = ends.find(x => dist(x.p, P0) > JOIN_TOL);
    if (far) { ends.forEach(x => say(x.id, `join at ${x.e} not resolved: the ends are ${Math.round(dist(far.p, P0))}mm apart, drawn as free ends`)); continue; }
    const fitted = ends.find(x => !boundaryGeom(x.w, 0));
    if (fitted) { ends.forEach(x => say(x.id, `joins on a ${fitted.w.curve.type} centreline are drawn as free ends`)); continue; }
    resolveNode(ends, kindOf.get(keys[0]), say);
    for (const a of ends) for (const b of ends) if (a !== b) a.w.joinedTo.add(b.id);
  }

  // End-on-middle rows are T joins: the through wall is never split (§10.9).
  for (const j of rows) {
    if (j.b.end || j.allowed === false || j.kind === "square") continue;
    const A = walls.get(j.a.of), B = walls.get(j.b.of);
    if (!A || !B) continue;
    const p = j.a.end === "start" ? A.curve.start : A.curve.end;
    const u = uOf(B, p), off = Math.abs(sideOf(B, p));
    if (off > JOIN_TOL || u < -JOIN_TOL || u > B.L + JOIN_TOL) { say(A.id, `T join onto ${B.id} not resolved: the end is ${Math.round(off)}mm off its centreline`); continue; }
    if (!boundaryGeom(A, 0) || !boundaryGeom(B, 0)) { say(A.id, `T joins on fitted curves are drawn as free ends`); continue; }
    // Which side of B does A arrive from? Probe one wall-thickness back into A.
    const back = j.a.end === "start" ? Math.min(A.L, A.stack.T + 1) : Math.max(0, A.L - A.stack.T - 1);
    const side = Math.sign(sideOf(B, pointAt(A, 0, back))) || 1;
    A.ends[j.a.end] = { k: "T", through: B, side, u };
    B.cuts.push({ from: A, end: j.a.end, side, u });
    A.joinedTo.add(B.id); B.joinedTo.add(A.id);
  }
  return notes;
}

function resolveNode(ends, row, say) {
  const P = ends.map(x => x.p).reduce((a, b) => add(a, b)).map(v => v / ends.length);
  for (const x of ends) {
    const t = x.e === "start" ? 0 : 1;
    const tan = x.w.curve.tangentAt(t);
    x.dir = x.e === "start" ? tan : mul(tan, -1);         // pointing from the node into the wall
    const sMax = Math.max(...x.w.stack.s), sMin = Math.min(...x.w.stack.s);
    // Faces relative to x.dir: left of dir is +s at a start, −s at an end.
    const lineAt = s => ({ p: add(x.p, mul(x.w.curve.normalAt(t), s)), d: tan });
    x.left = x.e === "start" ? lineAt(sMax) : lineAt(sMin);
    x.right = x.e === "start" ? lineAt(sMin) : lineAt(sMax);
    x.half = Math.max(Math.abs(sMax), Math.abs(sMin));
    x.ang = Math.atan2(x.dir[1], x.dir[0]);
  }
  ends.sort((a, b) => a.ang - b.ang);
  const n = ends.length;
  const leftCorner = new Array(n), rightCorner = new Array(n), bevels = [];
  for (let k = 0; k < n; k++) {
    const E = ends[k], G = ends[(k + 1) % n];
    let phi = wrap(G.ang - E.ang); if (phi < 1e-9) phi = TAU;
    let C = intersectLines(E.left, G.right);
    if (!C) C = projectPoint(E.left, P);             // collinear continuation
    const limit = MITER_LIMIT * Math.max(E.half, G.half);
    if (phi > Math.PI + 1e-9 && dist(C, P) > limit) {
      // Past the miter limit: bevel. Same rule as stroke rendering (§3.4, test 5).
      const Bl = projectPoint(E.left, P), Br = projectPoint(G.right, P);
      leftCorner[k] = Bl; rightCorner[(k + 1) % n] = Br;
      bevels.push({ pts: [P, Bl, Br], of: E.id, e: E.e });
      say(E.id, `mitre at ${Math.round(phi * 180 / Math.PI) - 180}° past the limit — bevelled`);
    } else { leftCorner[k] = C; rightCorner[(k + 1) % n] = C; }
  }
  const sameType = n === 2 && ends[0].w.type.id === ends[1].w.type.id && ends[0].e !== ends[1].e && ends[0].w.stack.flipped === ends[1].w.stack.flipped;
  for (let k = 0; k < n; k++) {
    const E = ends[k];
    const pts = n === 2 && !bevels.length ? [rightCorner[k], leftCorner[k]] : [rightCorner[k], P, leftCorner[k]];
    const forced = row && row.kind === "miter";
    E.w.ends[E.e] = { k: "node", term: { k: "poly", pts }, weld: sameType || false, forced, bevel: bevels.filter(b => b.of === E.id && b.e === E.e) };
  }
}

// ---------------------------------------------------------------- spans per detail level
/** Terminators for a wall end at a given detail level. T ends are the only
 *  detail-dependent kind: per layer at Fine, whole-wall at Coarse. */
function endTerms(w, which, detail, groups) {
  const end = w.ends[which], u = which === "start" ? 0 : w.L;
  const free = { k: "normal", u, role: "cap" };
  if (end.k === "free") return groups.map(() => free);
  if (end.k === "node") return groups.map(() => Object.assign({}, end.term, { nearU: u, role: end.weld ? "weld" : "join" }));
  // T: each group stops at the near face of the other wall's band of layers
  // that block it; nothing blocks → it passes through to the far face.
  const B = end.through, side = end.side, sB = B.stack.s, nB = sB.length - 1;
  const nearFace = idxs => idxs.reduce((best, i) => (side > 0 ? sB[i] > sB[best] : sB[i] < sB[best]) ? i : best, idxs[0]);
  const farFace = side > 0 ? (sB[0] < sB[nB] ? 0 : nB) : (sB[0] > sB[nB] ? 0 : nB);
  return groups.map(g => {
    let bIdx;
    if (detail === "Coarse") bIdx = nearFace([0, nB]);
    else {
      const pA = w.stack.layers[g[0]].priority;
      const K = B.stack.layers.map((l, j) => j).filter(j => blocks(B.stack.layers[j].priority, pA) && B.stack.layers[j].thickness > 0);
      bIdx = K.length ? nearFace(K.flatMap(j => [j, j + 1])) : farFace;
    }
    // the same material on both sides of the stop is one material: no line between them (a weld)
    const mA = detail === "Coarse" ? coarseMaterial(w) : w.stack.layers[g[0]].material;
    const mB = detail === "Coarse" ? coarseMaterial(B) : beyondMaterial(B, bIdx, side);
    return { k: "wall", w: B, s: sB[bIdx], bIdx, nearU: u, role: mA && mA === mB ? "weld" : "join" };
  });
}
/** The material of the through wall's layer just past boundary bIdx, seen from the side a T arrives on. */
function beyondMaterial(B, bIdx, side) {
  const sB = B.stack.s;
  for (const j of [bIdx, bIdx - 1]) {
    if (j < 0 || j >= B.stack.layers.length) continue;
    const mid = (sB[j] + sB[j + 1]) / 2;
    if ((mid - sB[bIdx]) * side < 0 && B.stack.layers[j].thickness > 0) return B.stack.layers[j].material;
  }
  return null;
}
/** A T join blends into its through wall: over the width of each joining layer, the through
 *  wall's line along the boundary that layer stops at is hidden when the materials are the same -
 *  and always at Coarse, where the joining wall's end is the one line that separates them. */
function blendT(w, out, detail) {
  for (const cut of w.cuts) {
    const A = cut.from, nA = A.stack.s.length - 1;
    const groups = detail === "Coarse" ? [[0, nA]] : A.stack.layers.map((l, i) => [i, i + 1]).filter(g => A.stack.layers[g[0]].thickness > 0);
    const terms = endTerms(A, cut.end, detail, groups);
    groups.forEach(([lo, hi], gi) => {
      const t = terms[gi]; if (t.k !== "wall" || t.w !== w) return;
      if (detail !== "Coarse" && t.role !== "weld") return;
      const pa = termAt(w, t.s, { k: "wall", w: A, s: A.stack.s[lo] }, cut.u), pb = termAt(w, t.s, { k: "wall", w: A, s: A.stack.s[hi] }, cut.u);
      const u0 = Math.min(uOf(w, pa), uOf(w, pb)), u1 = Math.max(uOf(w, pa), uOf(w, pb));
      hideAlong(w, out, t.s, u0, u1);
    });
  }
}
/** Hide the part of every straight region edge lying on boundary s of w between u0 and u1. */
function hideAlong(w, out, s, u0, u1) {
  if (w.curve.type !== "line") return;
  for (const reg of out) {
    const next = [];
    for (const e of reg.edges || []) {
      const g = e.seg;
      if (g.k !== "L" || e.role === "hidden" || Math.abs(sideOf(w, g.a) - s) > 0.5 || Math.abs(sideOf(w, g.b) - s) > 0.5) { next.push(e); continue; }
      const ua = uOf(w, g.a), ub = uOf(w, g.b), lo = Math.min(ua, ub), hiU = Math.max(ua, ub);
      const c0 = Math.max(lo, u0), c1 = Math.min(hiU, u1);
      if (c1 - c0 <= TOL) { next.push(e); continue; }
      const at = u => pointAt(w, s, u), fwd = ub >= ua;
      const pieces = [[lo, c0, e.role], [c0, c1, "hidden"], [c1, hiU, e.role]].filter(([x, y]) => y - x > TOL);
      for (const [x, y, role] of (fwd ? pieces : pieces.reverse())) next.push({ seg: { k: "L", a: at(fwd ? x : y), b: at(fwd ? y : x) }, role });
    }
    reg.edges = next;
  }
}

/** Gaps in a through wall where incoming walls pass (Fine only), and openings. */
function gapsFor(w, detail, layerIdx, openings, cutH) {
  const gaps = [];
  if (detail !== "Coarse") for (const cut of w.cuts) {
    const A = cut.from;
    const groupsA = A.stack.layers.map((l, i) => [i, i + 1]);
    const termsA = endTerms(A, cut.end, "Fine", groupsA);
    const sW = w.stack.s;
    // A layer of A passes through layer layerIdx of w when its stop is beyond it.
    const [a, b] = [sW[layerIdx], sW[layerIdx + 1]];
    const crossing = [];
    groupsA.forEach((g, i) => {
      const stop = termsA[i].s;
      const beyond = cut.side > 0 ? Math.min(a, b) >= stop - TOL : Math.max(a, b) <= stop + TOL;
      if (beyond && A.stack.layers[i].thickness > 0) crossing.push(i);
    });
    if (!crossing.length) continue;
    const sA = A.stack.s;
    const lo = Math.min(...crossing), hi = Math.max(...crossing) + 1;
    const g0 = { k: "wall", w: A, s: sA[lo] }, g1 = { k: "wall", w: A, s: sA[hi] };
    const mid = w.stack.s[layerIdx];
    const u0 = uOf(w, termAt(w, mid, g0, cut.u)), u1 = uOf(w, termAt(w, mid, g1, cut.u));
    gaps.push(u0 <= u1 ? { t0: Object.assign(g0, { nearU: u0, role: "hidden" }), t1: Object.assign(g1, { nearU: u1, role: "hidden" }), u0, u1 }
                        : { t0: Object.assign(g1, { nearU: u1, role: "hidden" }), t1: Object.assign(g0, { nearU: u0, role: "hidden" }), u0: u1, u1: u0 });
  }
  for (const op of openings) {
    if (!op.cuts(cutH)) continue;
    if (op.recess && !op.recess.layers.includes(layerIdx)) continue;
    gaps.push({ t0: { k: "normal", u: op.u0, role: "cap" }, t1: { k: "normal", u: op.u1, role: "cap" }, u0: op.u0, u1: op.u1, opening: op.id });
  }
  return gaps.sort((x, y) => x.u0 - y.u0);
}

/** The drawing of a wall at a detail level and cut height: closed layer regions
 *  with edge roles. Coarse builds boundaries 0 and n only (test 13, 26b). */
export function wallRegions(w, detail, cutH, openings = []) {
  const n = w.stack.s.length - 1;
  const groups = detail === "Coarse" ? [[0, n]] : w.stack.layers.map((l, i) => [i, i + 1]).filter(g => w.stack.layers[g[0]].thickness > 0);
  const starts = endTerms(w, "start", detail, groups), ends = endTerms(w, "end", detail, groups);
  const out = [];
  groups.forEach(([lo, hi], gi) => {
    const layerIdx = detail === "Coarse" ? null : lo;
    const gaps = layerIdx === null ? gapsFor(w, "Coarse", 0, openings, cutH) : gapsFor(w, detail, layerIdx, openings, cutH);
    // walk spans between gaps
    let t0 = starts[gi];
    const spans = [];
    for (const g of gaps) { spans.push([t0, g.t0]); t0 = g.t1; }
    spans.push([t0, ends[gi]]);
    boundary(w, lo); boundary(w, hi);   // the offsets this detail level needs, counted
    for (const [a, b] of spans) {
      const roles = { lo: lo === 0 ? "face" : "layer", hi: hi === n ? "face" : "layer", start: a.role, end: b.role };
      const reg = regionWithWallTerms(w, lo, hi, a, b, roles);
      if (reg) out.push(Object.assign(reg, { lo, hi, layer: layerIdx, material: layerIdx === null ? coarseMaterial(w) : w.stack.layers[layerIdx].material }));
    }
  });
  blendT(w, out, detail);
  // Bevel wedges past the miter limit, in the outer material.
  for (const e of ["start", "end"]) for (const b of (w.ends[e].bevel || [])) {
    out.push({ path: [{ k: "L", a: b.pts[0], b: b.pts[1] }, { k: "L", a: b.pts[1], b: b.pts[2] }, { k: "L", a: b.pts[2], b: b.pts[0] }],
      edges: [{ seg: { k: "L", a: b.pts[1], b: b.pts[2] }, role: "face" }], material: coarseMaterial(w), bevel: true, layer: null });
  }
  return out;
}
export function coarseMaterial(w) {
  const L = w.stack.layers;
  const core = L.slice(w.stack.cs, w.stack.ce).find(l => l.function === "Structure") || L.find(l => l.function === "Structure") || L[0];
  return w.type.coarseMaterial || (core && core.material);
}

/** layerRegion, with "wall" terminators resolved through termAt. */
function regionWithWallTerms(w, lo, hi, t0, t1, roles) {
  const fix = t => {
    if (t.k !== "wall") return t;
    // Turn a wall-boundary terminator into a straight line through its hits on
    // lo and hi. Exact for a straight host; for an arc host the cap is the chord.
    const u = t.nearU ?? 0;
    const a = termAt(w, w.stack.s[lo], t, u), b = termAt(w, w.stack.s[hi], t, u);
    if (dist(a, b) < TOL) return { k: "normal", u, role: t.role };
    return { k: "poly", pts: [a, b], nearU: u, role: t.role };
  };
  return layerRegion(w, lo, hi, fix(t0), fix(t1), roles);
}

/** u-spans of the coarse solid for the 3D view: ends + opening splits, each
 *  opening split fused into ONE cut per wall (§5.1 batch rule, test 19h). */
export function solidSpans(w, openings, stats) {
  const n = w.stack.s.length - 1;
  const [st] = endTerms(w, "start", "Coarse", [[0, n]]);
  const [en] = endTerms(w, "end", "Coarse", [[0, n]]);
  const fix = t => t.k === "wall" ? { k: "poly", pts: [termAt(w, w.stack.s[0], t, t.nearU), termAt(w, w.stack.s[n], t, t.nearU)], nearU: t.nearU } : t;
  const S = fix(st), E = fix(en);
  if (!openings.length) return [{ t0: S, t1: E, u0: 0, u1: w.L }];
  if (stats) stats.cuts++;    // one fused tool per wall, however many openings
  const ops = openings.slice().sort((a, b) => a.u0 - b.u0);
  const spans = [];
  let t0 = S, u0 = 0;
  for (const op of ops) {
    spans.push({ t0, t1: { k: "normal", u: op.u0 }, u0, u1: op.u0 });
    // below the sill and above the head, the wall continues across the opening
    if (op.sill > 0) spans.push({ t0: { k: "normal", u: op.u0 }, t1: { k: "normal", u: op.u1 }, u0: op.u0, u1: op.u1, zb: w.z0, zt: w.z0 + op.sill, openingSide: "sill" });
    if (op.sill + op.h < w.height) spans.push({ t0: { k: "normal", u: op.u0 }, t1: { k: "normal", u: op.u1 }, u0: op.u0, u1: op.u1, zb: w.z0 + op.sill + op.h, zt: w.z1, openingSide: "head" });
    if (op.recess) {
      // behind a recess the wall continues: from depth d off the exterior face to the other face
      const s0 = w.stack.s[0], sN = w.stack.s[w.stack.s.length - 1], dir = Math.sign(sN - s0) || 1;
      spans.push({ t0: { k: "normal", u: op.u0 }, t1: { k: "normal", u: op.u1 }, u0: op.u0, u1: op.u1, zb: w.z0 + op.sill, zt: w.z0 + op.sill + op.h, recess: op.recess, sRange: [s0 + dir * op.recess.depth, sN] });
    }
    t0 = { k: "normal", u: op.u1 }; u0 = op.u1;
  }
  spans.push({ t0, t1: E, u0, u1: w.L });
  return spans.filter(s => s.u1 - s.u0 > TOL || s.t0.k !== "normal");
}
