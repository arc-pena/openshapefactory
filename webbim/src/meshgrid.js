//! A 2D mesh that drives a project's slabs and walls, and the vertical elements that cut through them.
//!
//!   MeshGrid       - nodes (points) and cells (loops of nodes), and for each level the cells it uses: a cell used
//!                    whole (1), or a part of it ([s, dx, dy]: the cell scaled by s about its centroid and moved by
//!                    dx, dy, so the part follows the cell when the mesh is edited). The meshsync op makes the
//!                    level's slabs from the cells it uses - touching cells become one slab, a cell left out inside
//!                    them a hole - and its walls along their edges.
//!   Core           - a lift, stair, escalator, riser, shaft, structural core or atrium from a base level to a top
//!                    level: a rectangle, a drawn outline, or a mesh cell (inset). It cuts the slabs above its base.
//!   PlanReference  - a level's plan as it was drawn (zones, plate outlines, labels), traced from the drawings and
//!                    kept in plan to check the mesh against.
//!
//! Everything the mesh makes has an id starting with the mesh's: MG1-L06-S-C012 (the slab of level L06 whose
//! lowest cell is C012), MG1-L06-W-N101-N102 (the wall on the edge from node N101 to N102). Ids hold while the
//! mesh is edited, so the Rhino export can follow every element one to one.

import { declare, BUILDERS, F, real, integer, bool, text, choice, ref, json, point2d } from "./ocaf.js";
import { polyArea, pointInPoly, polyPath, bboxOf, ensureCCW, dist } from "./geom2d.js";
import { fromLoops } from "./bimsketch.js";
import { offsetLoop } from "./massing.js";

export const CORE_USES = ["Lift", "Stair", "Escalator", "Riser", "Shaft", "Structural core", "Atrium"];
/** The discipline each use is filed under (the Rhino layers follow it). */
export const CORE_DISCIPLINE = { Lift: "Vertical Transport", Stair: "Vertical Transport", Escalator: "Vertical Transport", Riser: "MEP", Shaft: "MEP", "Structural core": "Structure", Atrium: "Voids" };
export const CORE_COLOUR = { Lift: "#3f7cc4", Stair: "#3a9a5b", Escalator: "#7a5cc4", Riser: "#d9822b", Shaft: "#b5651d", "Structural core": "#7d838b", Atrium: "#62b7d0" };
const mgNum = v => ({ kind: "Number", v }), mgLen = v => ({ kind: "Length", v }), mgText = v => ({ kind: "Text", v: String(v) }), mgArea = v => ({ kind: "Area", v });

// ---------------------------------------------------------------- geometry of cells
/** The area-weighted centroid of a polygon. */
export function polyCentroid(P) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], k = p[0] * q[1] - q[0] * p[1]; a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k; }
  if (Math.abs(a) < 1e-9) return [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length];
  return [cx / (3 * a), cy / (3 * a)];
}
/** A cell's polygon as its use says: the whole cell (1), or scaled about its centroid and moved ([s, dx, dy]). */
export function cellShape(pts, u) {
  if (!Array.isArray(u)) return pts.map(p => p.slice());
  const [s, dx, dy] = [u[0] ?? 1, u[1] || 0, u[2] || 0], c = polyCentroid(pts);
  return pts.map(p => [c[0] + dx + s * (p[0] - c[0]), c[1] + dy + s * (p[1] - c[1])]);
}
/** The cells' polygons from node positions: { cell id: [[x, y], …] }, counter-clockwise. Throws on a missing node. */
export function cellPolys(nodes, cells) {
  const out = {};
  for (const [cid, loop] of Object.entries(cells || {})) {
    const pts = loop.map(n => { const p = nodes[n]; if (!p) throw new Error(`cell ${cid} names node ${n}, which is not in the mesh`); return p; });
    out[cid] = polyArea(pts) < 0 ? pts.slice().reverse() : pts;
  }
  return out;
}
/** A cell's node ids in counter-clockwise order. */
export function cellLoopCCW(nodes, loop) { const pts = loop.map(n => nodes[n]); return polyArea(pts) < 0 ? loop.slice().reverse() : loop.slice(); }
/** Every edge of the mesh once: [a, b, the cells either side]. */
export function meshGridEdges(cells) {
  const m = new Map();
  for (const [cid, loop] of Object.entries(cells || {})) loop.forEach((a, i) => { const b = loop[(i + 1) % loop.length]; if (a === b) return; const k = a < b ? a + "|" + b : b + "|" + a; if (!m.has(k)) m.set(k, [a < b ? a : b, a < b ? b : a, []]); m.get(k)[2].push(cid); });
  return [...m.values()];
}

/** A level's slabs from the cells it uses. Whole cells that touch are one region: their shared edges cancel and what
 *  is left is traced into loops (counter-clockwise outlines, clockwise holes - a cell left out inside the region).
 *  Where two regions meet at a single node, the trace turns as far left as it can, so they stay two regions. A cell
 *  used in part is a region of its own. Returns [{ key, outer, ids, holes: [{ pts, ids }], cells, part }]. */
export function levelRegions(nodes, cells, use) {
  const dir = new Map(), interior = [], parts = [];
  const full = Object.keys(use || {}).filter(c => cells[c]).sort();
  for (const cid of full) {
    if (Array.isArray(use[cid])) { parts.push(cid); continue; }
    const ids = cellLoopCCW(nodes, cells[cid]);
    ids.forEach((a, i) => {
      const b = ids[(i + 1) % ids.length]; if (a === b) return;
      const rev = b + ">" + a;
      if (dir.has(rev)) { dir.delete(rev); interior.push([b, a]); } else dir.set(a + ">" + b, { a, b, cell: cid });
    });
  }
  const from = new Map();
  for (const e of dir.values()) { if (!from.has(e.a)) from.set(e.a, []); from.get(e.a).push(e); }
  const used = new Set(), loops = [];
  const ang = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
  for (const e0 of dir.values()) {
    if (used.has(e0)) continue;
    const loop = []; let e = e0, closed = false;
    for (let guard = 0; guard < 100000; guard++) {
      used.add(e); loop.push(e);
      const cands = (from.get(e.b) || []).filter(x => !used.has(x) || x === e0);
      if (!cands.length) break;
      let nx = cands[0];
      if (cands.length > 1) {
        // the most counter-clockwise turn from the way we came in: the region on the left stays one region
        const back = ang(nodes[e.b], nodes[e.a]); let best = -1;
        for (const c of cands) { let t = ang(nodes[c.a], nodes[c.b]) - back; while (t <= 1e-12) t += 2 * Math.PI; while (t > 2 * Math.PI) t -= 2 * Math.PI; if (t > best) { best = t; nx = c; } }
      }
      if (nx === e0) { closed = true; break; }
      e = nx;
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  const outers = [], holes = [];
  for (const lp of loops) {
    const ids = lp.map(e => e.a), pts = ids.map(n => nodes[n].slice()), A = polyArea(pts);
    const rec = { ids, pts, area: A, cells: [...new Set(lp.map(e => e.cell))].sort() };
    (A > 0 ? outers : holes).push(rec);
  }
  const regions = outers.map(o => ({ key: o.cells[0], outer: o.pts, ids: o.ids, holes: [], cells: o.cells, part: false, area: o.area }));
  for (const hl of holes) {
    // the solid is on the left of every traced edge: a point just left of a hole's edge is in the region round it
    const a = hl.pts[0], b = hl.pts[1], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, m = [(a[0] + b[0]) / 2 - (b[1] - a[1]) / d, (a[1] + b[1]) / 2 + (b[0] - a[0]) / d];
    const owner = regions.filter(r => pointInPoly(m, r.outer)).sort((x, y) => x.area - y.area)[0];
    if (owner) { owner.holes.push({ pts: hl.pts, ids: hl.ids }); for (const c of hl.cells) if (!owner.cells.includes(c)) owner.cells.push(c); }
  }
  for (const r of regions) { r.cells.sort(); r.key = r.cells[0]; }
  for (const cid of parts) { const pts = cellShape(cellPolys(nodes, { [cid]: cells[cid] })[cid], use[cid]); regions.push({ key: "P" + cid, outer: pts, ids: null, holes: [], cells: [cid], part: true, area: polyArea(pts) }); }
  return { regions, interior };
}

// ---------------------------------------------------------------- the mesh element
declare({ type: "MeshGrid", guid: "wb-0950", category: "Mesh", kind: "meshgrid", idPrefix: "MG",
  summary: "A 2D mesh of nodes and cells that drives the slabs and walls: each level uses some of its cells.",
  args: [ json("nodes", "Nodes", {}), json("cells", "Cells", {}), json("use", "Cells used, by level", {}),
          ref("slabType", "Slab type", ["floorType"]), ref("wallType", "Wall type", ["wallType"]),
          choice("walls", "Walls", ["Perimeter", "Perimeter and cell edges", "None"], 0),
          real("topHeight", "Wall height on the top level", 4000, 0, 50000, 1),
          bool("showMesh", "Mesh drawn", true, { group: "Graphics" }), bool("showIds", "Node and cell ids drawn", false, { group: "Graphics" }),
          bool("showUse", "Cells used shaded in plan", true, { group: "Graphics" }) ],
  handles: () => [] });
BUILDERS.MeshGrid = {
  precondition: (f) => {
    const N = F.json(f, "nodes") || {}, C = F.json(f, "cells") || {};
    for (const [cid, loop] of Object.entries(C)) { if (!Array.isArray(loop) || loop.length < 3) return `cell ${cid} needs three nodes or more`; for (const n of loop) if (!N[n]) return `cell ${cid} names node ${n}, which is not in the mesh`; }
    return null;
  },
  build: (f, doc) => {
    const N = F.json(f, "nodes") || {}, C = F.json(f, "cells") || {}, U = F.json(f, "use") || {};
    const polys = cellPolys(N, C), edges = meshGridEdges(C), pts = Object.values(N);
    const centroids = {}; let area = 0;
    for (const [cid, P] of Object.entries(polys)) { centroids[cid] = polyCentroid(P); area += Math.abs(polyArea(P)); }
    const levels = Object.keys(U).filter(l => Object.keys(U[l] || {}).length);
    return { plan: { nodes: N, polys, edges, centroids, bbox: pts.length ? bboxOf(pts) : [0, 0, 0, 0], z0: 0, z1: 0 },
      data: { value: Object.keys(C).length, kind: "Number", props: { Nodes: mgNum(Object.keys(N).length), Cells: mgNum(Object.keys(C).length), Edges: mgNum(edges.length), "Mesh area": mgArea(area), "Levels using it": mgNum(levels.length) } } };
  },
};

// ---------------------------------------------------------------- editing the mesh (pure: each returns a new { nodes, cells, use })
const mgClone = o => JSON.parse(JSON.stringify(o));
/** The next free id with a prefix: N778, C320… */
export function meshNextId(map, prefix) { let n = 0; for (const k of Object.keys(map)) { const m = new RegExp(`^${prefix}(\\d+)$`).exec(k); if (m) n = Math.max(n, +m[1]); } return prefix + String(n + 1).padStart(3, "0"); }
/** How many distinct neighbours a node has. */
export function meshNodeDegree(cells, nid) { const nb = new Set(); for (const loop of Object.values(cells)) loop.forEach((a, i) => { const b = loop[(i + 1) % loop.length]; if (a === nid) nb.add(b); if (b === nid) nb.add(a); }); return nb.size; }
export function meshMoveNode(m, nid, p) { const o = mgClone(m); if (!o.nodes[nid]) throw new Error(`there is no node ${nid}`); o.nodes[nid] = [Math.round(p[0]), Math.round(p[1])]; return o; }
/** A node on the edge a-b at p (projected onto the edge): every cell with that edge gets it. */
export function meshAddNodeOnEdge(m, a, b, p) {
  const o = mgClone(m), A = o.nodes[a], B = o.nodes[b]; if (!A || !B) throw new Error("that edge is not in the mesh");
  const d = [B[0] - A[0], B[1] - A[1]], L2 = d[0] * d[0] + d[1] * d[1] || 1, t = Math.max(0.02, Math.min(0.98, ((p[0] - A[0]) * d[0] + (p[1] - A[1]) * d[1]) / L2));
  const id = meshNextId(o.nodes, "N"); o.nodes[id] = [Math.round(A[0] + d[0] * t), Math.round(A[1] + d[1] * t)];
  let hit = 0;
  for (const [cid, loop] of Object.entries(o.cells)) {
    for (let i = 0; i < loop.length; i++) { const x = loop[i], y = loop[(i + 1) % loop.length]; if ((x === a && y === b) || (x === b && y === a)) { loop.splice(i + 1, 0, id); hit++; break; } }
    o.cells[cid] = loop;
  }
  if (!hit) throw new Error(`no cell has the edge ${a}-${b}`);
  return { mesh: o, id };
}
/** A node taken out: only where two edges meet (on a cell's side, or a corner of the mesh's outline) - a node where
 *  three or more meet holds cells together; merge them first. Cells left with fewer than three nodes go. */
export function meshDeleteNode(m, nid) {
  const o = mgClone(m); if (!o.nodes[nid]) throw new Error(`there is no node ${nid}`);
  if (meshNodeDegree(o.cells, nid) > 2) throw new Error(`${nid} is where ${meshNodeDegree(o.cells, nid)} edges meet: merge the cells round it first, or move it`);
  for (const cid of Object.keys(o.cells)) { o.cells[cid] = o.cells[cid].filter(n => n !== nid); if (o.cells[cid].length < 3) meshDropCell(o, cid); }
  delete o.nodes[nid];
  return o;
}
function meshDropCell(o, cid) { delete o.cells[cid]; for (const l of Object.keys(o.use || {})) if (o.use[l]) delete o.use[l][cid]; }
export function meshDeleteCell(m, cid) {
  const o = mgClone(m); if (!o.cells[cid]) throw new Error(`there is no cell ${cid}`); meshDropCell(o, cid);
  // nodes no cell uses any more go with it
  const left = new Set(Object.values(o.cells).flat()); for (const n of Object.keys(o.nodes)) if (!left.has(n)) delete o.nodes[n];
  return o;
}
/** A cell split along the chord between two of its nodes (not neighbours): the part keeping the cell's first node
 *  keeps its id; each level that used the cell uses both parts. */
export function meshSplitCell(m, cid, na, nb) {
  const o = mgClone(m), loop = o.cells[cid]; if (!loop) throw new Error(`there is no cell ${cid}`);
  const i = loop.indexOf(na), j = loop.indexOf(nb); if (i < 0 || j < 0) throw new Error(`${na} and ${nb} are not both corners of ${cid}`);
  const n = loop.length; if (i === j || (i + 1) % n === j || (j + 1) % n === i) throw new Error("pick two corners that are not already joined by an edge");
  const [p, q] = i < j ? [i, j] : [j, i], A = loop.slice(p, q + 1), B = [...loop.slice(q), ...loop.slice(0, p + 1)];
  const keep = A.includes(loop[0]) && !B.includes(loop[0]) ? A : B.includes(loop[0]) && !A.includes(loop[0]) ? B : A, other = keep === A ? B : A;
  const nid = meshNextId(o.cells, "C"); o.cells[cid] = keep; o.cells[nid] = other;
  for (const l of Object.keys(o.use || {})) if (o.use[l] && o.use[l][cid] != null) o.use[l][nid] = mgClone(o.use[l][cid]);
  return { mesh: o, id: nid };
}
/** Two cells that share an edge made one: their common edges go; the first cell's id stays. A level using either
 *  uses the merged cell (whole if either was used whole). */
export function meshMergeCells(m, c1, c2) {
  const o = mgClone(m); if (!o.cells[c1] || !o.cells[c2]) throw new Error("pick two cells");
  if (c1 === c2) throw new Error("pick two different cells");
  const r = levelRegions(o.nodes, { [c1]: o.cells[c1], [c2]: o.cells[c2] }, { [c1]: 1, [c2]: 1 }).regions;
  if (r.length !== 1 || r[0].holes.length) throw new Error(`${c1} and ${c2} do not share an edge`);
  const keep = c1, gone = c2;
  o.cells[keep] = r[0].ids.slice(); delete o.cells[gone];
  for (const l of Object.keys(o.use || {})) {
    const u = o.use[l]; if (!u) continue;
    const a = u[keep], b = u[gone]; delete u[gone];
    if (a == null && b == null) continue;
    u[keep] = a === 1 || b === 1 ? 1 : (a || b);
  }
  return { mesh: o, id: keep };
}
/** A new cell through points: each lands on a node near it, or on an edge (a node is added there, in the cells either
 *  side), or is a new node. */
export function meshAddCell(m, pts, tol) {
  let o = mgClone(m); const ids = [];
  for (const p of pts) {
    let best = null, bd = tol;
    for (const [nid, q] of Object.entries(o.nodes)) { const d = dist(p, q); if (d < bd) { bd = d; best = nid; } }
    if (best) { ids.push(best); continue; }
    const e = meshEdgeNear(o, p, tol);
    if (e) { const r = meshAddNodeOnEdge(o, e[0], e[1], p); o = r.mesh; ids.push(r.id); continue; }
    const id = meshNextId(o.nodes, "N"); o.nodes[id] = [Math.round(p[0]), Math.round(p[1])]; ids.push(id);
  }
  const loop = ids.filter((n, i) => n !== ids[(i + 1) % ids.length]);
  if (new Set(loop).size < 3) throw new Error("a cell needs three corners or more");
  const cid = meshNextId(o.cells, "C"); o.cells[cid] = cellLoopCCW(o.nodes, loop);
  return { mesh: o, id: cid };
}
/** The mesh edge nearest a point, within tol: [a, b, distance]. */
export function meshEdgeNear(m, p, tol) {
  let best = null;
  for (const [a, b] of meshGridEdges(m.cells)) {
    const A = m.nodes[a], B = m.nodes[b], d = [B[0] - A[0], B[1] - A[1]], L2 = d[0] * d[0] + d[1] * d[1] || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * d[0] + (p[1] - A[1]) * d[1]) / L2)), q = [A[0] + d[0] * t, A[1] + d[1] * t], dd = dist(p, q);
    if (dd < tol && (!best || dd < best[2])) best = [a, b, dd];
  }
  return best;
}
/** The cell under a point (the smallest, where cells overlap). */
export function meshCellAt(m, p) {
  let best = null, ba = Infinity;
  for (const [cid, loop] of Object.entries(m.cells)) { const P = loop.map(n => m.nodes[n]); if (P.some(q => !q)) continue; if (pointInPoly(p, P)) { const A = Math.abs(polyArea(P)); if (A < ba) { ba = A; best = cid; } } }
  return best;
}
/** A level's use set from another level's (Copy from the level below / above). */
export function meshCopyUse(m, fromLevel, toLevel) { const o = mgClone(m); o.use = o.use || {}; o.use[toLevel] = mgClone((o.use || {})[fromLevel] || {}); return o; }

// ---------------------------------------------------------------- vertical elements
declare({ type: "Core", guid: "wb-0951", category: "IfcTransportElement", kind: "core", idPrefix: "VC",
  summary: "A lift, stair, escalator, riser, shaft, structural core or atrium from a base level to a top level, cutting the slabs above its base.",
  args: [ choice("use", "Use", CORE_USES, 0), point2d("at", "Centre", [0, 0]),
          real("width", "Width", 6000, 300, 500000, 1), real("depth", "Depth", 3000, 300, 500000, 1), real("rotation", "Rotation", 0, -360, 360, 0.1, "°"),
          json("outline", "Outline (from the centre), instead of the rectangle", null),
          ref("mesh", "Mesh", ["meshgrid"]), text("cell", "Mesh cell (the outline follows it)", ""), real("inset", "Inset from the cell's edge", 0, -20000, 100000, 1),
          ref("baseLevel", "Base level", ["level"]), ref("topLevel", "Top level", ["level"]), real("topOffset", "Top offset", 0, -50000, 50000, 1),
          integer("cars", "Lift cars", 1, 0, 60), bool("cutsSlabs", "Cuts the slabs it passes through", true), text("label", "Label", "") ] });
const mgElev = (doc, f, key) => { const lv = F.reference(f, key); const d = lv && doc.data(lv); return d ? d.value : null; };
/** A core's footprint: the mesh cell (inset), its outline, or its rectangle - counter-clockwise. */
export function coreFootprint(doc, f) {
  const cell = F.text(f, "cell"), ms = F.reference(f, "mesh");
  if (cell && ms) {
    const mp = doc.plan(ms), P = mp && mp.polys && mp.polys[cell];
    if (!P) throw new Error(`the mesh has no cell ${cell}`);
    const ins = F.real(f, "inset") || 0;
    return ins ? ensureCCW(offsetLoop(ensureCCW(P), ins)) : ensureCCW(P.map(p => p.slice()));
  }
  const at = F.json(f, "at") || [0, 0], a = (F.real(f, "rotation") || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const ol = F.json(f, "outline");
  const local = Array.isArray(ol) && ol.length >= 3 ? ol : (() => { const w = F.real(f, "width") / 2, d = F.real(f, "depth") / 2; return [[-w, -d], [w, -d], [w, d], [-w, d]]; })();
  return ensureCCW(local.map(q => [Math.round(at[0] + q[0] * c - q[1] * s), Math.round(at[1] + q[0] * s + q[1] * c)]));
}
function mgPrism(foot, z0, z1) {
  const P = [], I = [], n = foot.length;
  for (const z of [z0, z1]) for (const q of foot) P.push(q[0], q[1], z);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; I.push(i, j, n + j, i, n + j, n + i); }
  // caps by fan (the footprints are drawn convex or near it; an atrium's concave court reads well enough)
  for (let i = 1; i + 1 < n; i++) I.push(0, i + 1, i, n, n + i, n + i + 1);
  return { positions: P, index: I };
}
/** A core's symbol in plan, as segments: each lift car crossed, a stair's treads, an escalator's run, a shaft or
 *  void crossed corner to corner. */
function coreSymbol(f, use, foot) {
  const segs = [], n = foot.length, X = () => { if (n >= 4) segs.push([foot[0], foot[Math.floor(n / 2)]], [foot[Math.floor(n / 4)], foot[Math.floor(3 * n / 4)]]); };
  const rect = !(F.text(f, "cell") && F.refId(f, "mesh")) && !(Array.isArray(F.json(f, "outline")) && F.json(f, "outline").length >= 3);
  if (!rect) { if (use !== "Structural core") X(); return segs; }
  const at = F.json(f, "at") || [0, 0], a = (F.real(f, "rotation") || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const W = F.real(f, "width"), D = F.real(f, "depth"), P = (u, v) => [at[0] + u * c - v * s, at[1] + u * s + v * c];
  const long = W >= D, L = long ? W : D, S = long ? D : W, Q = (u, v) => (long ? P(u, v) : P(v, u));
  if (use === "Lift") {
    const k = Math.max(1, F.int(f, "cars") || 1), rows = k > 2 && S >= 0.45 * L ? 2 : 1, cols = Math.ceil(k / rows);
    for (let r = 0; r < rows; r++) for (let i = 0; i < cols && r * cols + i < k; i++) {
      const u0 = -L / 2 + L * i / cols, u1 = -L / 2 + L * (i + 1) / cols, v0 = -S / 2 + S * r / rows, v1 = -S / 2 + S * (r + 1) / rows;
      segs.push([Q(u0, v0), Q(u1, v1)], [Q(u0, v1), Q(u1, v0)]);
      if (i > 0) segs.push([Q(u0, v0), Q(u0, v1)]);
      if (r > 0 && i === 0) segs.push([Q(-L / 2, v0), Q(L / 2, v0)]);
    }
  } else if (use === "Stair") {
    const k = Math.max(4, Math.min(16, Math.round(L / 300)));
    for (let i = 1; i < k; i++) { const u = -L / 2 + L * i / k; segs.push([Q(u, -S / 2), Q(u, 0)]); }
    segs.push([Q(-L / 2, 0), Q(L / 2, 0)], [Q(L / 2 - S * 0.4, S * 0.2), Q(L / 2, 0)], [Q(L / 2 - S * 0.4, -S * 0.2), Q(L / 2, 0)]);
  } else if (use === "Escalator") {
    segs.push([Q(-L / 2, 0), Q(L / 2, 0)], [Q(L / 2 - S * 0.5, S * 0.3), Q(L / 2, 0)], [Q(L / 2 - S * 0.5, -S * 0.3), Q(L / 2, 0)]);
  } else if (use !== "Structural core") X();
  return segs;
}
BUILDERS.Core = {
  precondition: (f) => (F.refId(f, "baseLevel") ? null : "a core needs a base level"),
  build: (f, doc) => {
    const use = F.choice(f, "use") || "Lift", foot = coreFootprint(doc, f);
    const z0 = mgElev(doc, f, "baseLevel") || 0, zt = mgElev(doc, f, "topLevel"), z1 = (zt == null ? z0 + 6000 : zt) + (F.real(f, "topOffset") || 0);
    if (z1 <= z0) throw new Error("the top is not above the base");
    const colour = CORE_COLOUR[use] || "#888888", m = mgPrism(foot, z0, z1), area = Math.abs(polyArea(foot));
    return { plan: { path: polyPath(foot), foot, z0, z1, use, label: F.text(f, "label") || use, cars: F.int(f, "cars") || 0, colour, discipline: CORE_DISCIPLINE[use], parts: [], symbol: coreSymbol(f, use, foot),
        mesh: m, mesh3d: [{ positions: m.positions, index: m.index, colour, opacity: use === "Atrium" ? 0.25 : 0.85 }] },
      data: { value: area, kind: "Area", props: { Use: mgText(use), Area: mgArea(area), Height: mgLen(z1 - z0), "Base elevation": mgLen(z0), "Top elevation": mgLen(z1), Discipline: mgText(CORE_DISCIPLINE[use]) } } };
  },
};

// ---------------------------------------------------------------- the drawings, traced
declare({ type: "PlanReference", guid: "wb-0952", category: "Reference", kind: "reference", idPrefix: "PR",
  summary: "A level's plan as it was drawn - zones, plate outlines, labels - traced from the drawings, to check the mesh against.",
  args: [ ref("level", "Level", ["level"]), text("source", "Traced from", ""), json("zones", "Zones", []), json("outlines", "Outlines", []), json("labels", "Labels", []) ],
  handles: () => [] });
BUILDERS.PlanReference = {
  build: (f) => {
    const z = F.json(f, "zones") || [], o = F.json(f, "outlines") || [], l = F.json(f, "labels") || [];
    const pts = [...z.flatMap(x => x.p), ...o.flatMap(x => x.p)];
    return { plan: { zones: z, outlines: o, labels: l, bbox: pts.length ? bboxOf(pts) : null, z0: 0, z1: 0 },
      data: { value: z.length + o.length, kind: "Number", props: { Zones: mgNum(z.length), Outlines: mgNum(o.length), Labels: mgNum(l.length), Source: mgText(F.text(f, "source")) } } };
  },
};

// ---------------------------------------------------------------- what a mesh makes
/** The project's levels, lowest first: [{ id, name, z }]. */
export function levelsByElevation(doc) {
  return doc.elements().filter(g => doc.typeOf(g) === "Level").map(g => ({ id: doc.idOf(g), name: F.text(g, "name") || g.get("Name"), z: (doc.data(g) || {}).value ?? F.real(g, "elevation") }))
    .sort((a, b) => a.z - b.z);
}
const mgRound = p => [Math.round(p[0]), Math.round(p[1])];
/** Every slab and wall the mesh makes, and the cores each slab is cut by:
 *  { floors: [{ id, level, key, outer, holes, cores }], walls: [{ id, level, a, b, top, height }], joins, notCut, levels }. */
export function meshSyncPlan(doc, M) {
  const f = doc.element(M); if (!f || doc.typeOf(f) !== "MeshGrid") throw new Error(`${M} is not a mesh`);
  const N = F.json(f, "nodes") || {}, C = F.json(f, "cells") || {}, U = F.json(f, "use") || {}, mode = F.choice(f, "walls") || "Perimeter";
  const lvs = levelsByElevation(doc), at = new Map(lvs.map((l, i) => [l.id, i]));
  // the cores that cut slabs, with the elevations they span
  const cores = doc.elements().filter(g => doc.typeOf(g) === "Core" && !doc.error(g) && F.bool(g, "cutsSlabs") !== false).map(g => ({ id: doc.idOf(g), p: doc.plan(g) })).filter(c => c.p);
  const floors = [], walls = [], joins = [], notCut = [], missing = [];
  for (const [lid, u] of Object.entries(U)) {
    if (!u || !Object.keys(u).length) continue;
    if (!at.has(lid)) { missing.push(lid); continue; }
    const li = at.get(lid), lv = lvs[li], next = lvs[li + 1] || null;
    const { regions, interior } = levelRegions(N, C, u);
    const wallArgs = { top: next ? next.id : null, height: next ? next.z - lv.z : (F.real(f, "topHeight") || 4000) };
    for (const rg of regions) {
      const cut = [];
      for (const c of cores) {
        if (!(c.p.z0 < lv.z - 1 && c.p.z1 >= lv.z - 1)) continue;
        const ft = c.p.foot;
        if (!ft.every(q => pointInPoly(q, rg.outer))) { if (ft.some(q => pointInPoly(q, rg.outer))) notCut.push({ core: c.id, level: lid }); continue; }
        if (rg.holes.some(h => ft.some(q => pointInPoly(q, h.pts)) || h.pts.some(q => pointInPoly(q, ft)))) { notCut.push({ core: c.id, level: lid }); continue; }
        if (cut.some(h => ft.some(q => pointInPoly(q, h)) || h.some(q => pointInPoly(q, ft)))) { notCut.push({ core: c.id, level: lid }); continue; }
        cut.push(ft.map(mgRound));
      }
      floors.push({ id: `${M}-${lid}-S-${rg.key}`, level: lid, key: rg.key, outer: rg.outer.map(mgRound), holes: [...rg.holes.map(h => h.pts.map(mgRound)), ...cut], cores: cut.length, part: rg.part, cells: rg.cells });
      if (mode === "None") continue;
      // walls along the region's outline and round the cells left out inside it, each joined to the next
      const loops = [{ pts: rg.outer, ids: rg.ids, tag: rg.key }, ...rg.holes.map((h, k) => ({ pts: h.pts, ids: h.ids, tag: rg.key + "-H" + k }))];
      for (const lp of loops) {
        const ids = [];
        lp.pts.forEach((a, i) => {
          const b = lp.pts[(i + 1) % lp.pts.length]; if (dist(a, b) < 10) return;
          const id = lp.ids ? `${M}-${lid}-W-${lp.ids[i]}-${lp.ids[(i + 1) % lp.ids.length]}` : `${M}-${lid}-W-${lp.tag}-${String(i).padStart(2, "0")}`;
          walls.push(Object.assign({ id, level: lid, a: mgRound(a), b: mgRound(b) }, wallArgs)); ids.push(id);
        });
        for (let i = 0; i < ids.length && ids.length > 1; i++) joins.push({ id: `MJ:${ids[i]}>${ids[(i + 1) % ids.length]}`, a: { of: ids[i], end: "end" }, b: { of: ids[(i + 1) % ids.length], end: "start" }, kind: "auto", order: 0, allowed: true });
      }
    }
    if (mode === "Perimeter and cell edges") for (const [a, b] of interior) { const [x, y] = a < b ? [a, b] : [b, a]; walls.push(Object.assign({ id: `${M}-${lid}-WI-${x}-${y}`, level: lid, a: mgRound(N[x]), b: mgRound(N[y]) }, wallArgs)); }
  }
  return { floors, walls, joins, notCut, missing, levels: lvs };
}
/** Bring the mesh's slabs and walls up to date (the meshsync op calls this): what changed is changed, what is new is
 *  added, what the mesh no longer makes is removed. A slab or wall keeps the name it was given. */
export function applyMeshSync(doc, M, add, remove) {
  const f = doc.element(M), plan = meshSyncPlan(doc, M);
  const slabType = F.refId(f, "slabType") || "T-SLAB300", wallType = F.refId(f, "wallType") || null;
  const want = new Set();
  const put = (id, type, name, args) => {
    want.add(id);
    const g = doc.element(id);
    if (g && doc.typeOf(g) === type) { for (const [k, v] of Object.entries(args)) if (JSON.stringify(doc.argValue(g, k) ?? null) !== JSON.stringify(v ?? null)) doc.setArg(g, k, v); return; }
    if (g) remove([id]);
    add({ id, type, name, args });
  };
  const lname = new Map(plan.levels.map(l => [l.id, l.name]));
  for (const s of plan.floors) {
    const args = { boundary: s.outer, floorType: { ref: slabType }, level: { ref: s.level }, heightOffset: 0, sketch: s.holes.length ? fromLoops([s.outer, ...s.holes]) : null };
    put(s.id, "Floor", `${lname.get(s.level)} slab ${s.key}`, args);
  }
  if (wallType) for (const w of plan.walls) {
    put(w.id, "Wall", `${lname.get(w.level)} wall`, { centreline: { type: "line", start: w.a, end: w.b }, mounting: "Centred", wallType: { ref: wallType }, baseLevel: { ref: w.level }, baseOffset: 0,
      topLevel: w.top ? { ref: w.top } : null, topOffset: 0, height: w.height });
  }
  const pre = `${M}-`, gone = doc.elements().map(g => doc.idOf(g)).filter(id => id.startsWith(pre) && !want.has(id) && ["Floor", "Wall"].includes(doc.typeOf(doc.element(id))));
  if (gone.length) remove(gone);
  // the mesh's joins, made again from the loops
  doc.joins = doc.joins.filter(j => !((j.a && String(j.a.of).startsWith(pre)) || (j.b && String(j.b.of).startsWith(pre))));
  if (wallType) for (const j of plan.joins) doc.joins.push(j);
  doc.relationRevision++;
  return plan;
}
