//! The tower's building elements, read off its massing. The massing (a Massing with a `tower`) is the one place
//! the tower's shape is decided; what is drawn is made from it every time it changes:
//!   TowerSkin   - the glass envelope: its facets, the floor lines where each slab meets it, the folds and the
//!                 mullions; in plan the glass line cut at the plan's height;
//!   TowerFrame  - the diagrid on the facade (members along the diagonals, outside the glass) or the perimeter
//!                 columns (one per storey and station, raked where the plate moves);
//! and the floors (Floor with a `massing`), each the massing cut at its level. Elevations, sections, plans and the
//! hidden-line 3D read these through the helpers at the end of this file.

import { declare, BUILDERS, F, real, bool, text, choice, ref } from "./ocaf.js";
import { sliceMesh, featureEdges, meshBox } from "./massing.js";
import { towerRingAt, ringRuns, alongRun, columnStations, mullionStations } from "./towers.js";

const twLen = v => ({ kind: "Length", v }), twNum = v => ({ kind: "Number", v }), twText = v => ({ kind: "Text", v: String(v) });

/** The massing's tower as it was built: { kind, p, G, place, core } or null. Points in G are the tower's own; place
 *  puts them in the model (turn about the origin, then move). */
export function towerOf(doc, massing) {
  const pl = massing && doc.plan(massing);
  return pl && pl.tower ? pl.tower : null;
}
/** A tower point (x, y[, z]) in the model. */
export function placeTower(tw, q) {
  const a = (tw.place.rotation || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const out = [q[0] * c - q[1] * s + (tw.place.x || 0), q[0] * s + q[1] * c + (tw.place.y || 0)];
  return q.length > 2 ? [out[0], out[1], q[2] + (tw.place.z || 0)] : out;
}
const twRotN = (tw, n) => { const a = (tw.place.rotation || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [n[0] * c - n[1] * s, n[0] * s + n[1] * c]; };
const twUnit3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const twCross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const twSub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const twAdd3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const twMul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
/** The levels of the tower in the model: [{ index, z }] (z with the massing's own height offset). */
export function towerLevels(tw) { return tw.G.levels.map(l => ({ index: l.index, z: l.z + (tw.place.z || 0) })); }

// ---------------------------------------------------------------- the skin
declare({ type: "TowerSkin", guid: "wb-0910", category: "IfcCurtainWall", kind: "skin", idPrefix: "SK",
  summary: "A tower's glass envelope, taken from its massing: facets, floor lines, folds and mullions.",
  args: [ ref("massing", "Massing", ["massing"]),
          real("mullionDepth", "Mullion depth (drawn in plan)", 150, 0, 1000, 1, "mm", { group: "Graphics" }),
          bool("mullions", "Mullions drawn", true, { group: "Graphics" }), bool("floorLines", "Floor lines drawn", true, { group: "Graphics" }),
          text("material", "Material", "M-GLASS", { group: "Materials" }) ] });

/** A triangle's normal, and which way it faces in plan. */
function twTriNormal(P, a, b, c) {
  const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], B = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], C = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
  return twUnit3(twCross3(twSub3(B, A), twSub3(C, A)));
}
/** Where the plane z cuts each triangle: segments with the facet's normal (the floor lines on the facade). */
function twSliceSegs(m, z) {
  const P = m.positions, I = m.index, out = [];
  for (let i = 0; i < I.length; i += 3) {
    const v = [I[i], I[i + 1], I[i + 2]], zz = v.map(k => { const d = P[k * 3 + 2] - z; return Math.abs(d) < 1e-6 ? 1e-6 : d; });
    const pts = [];
    for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3], za = zz[e], zb = zz[(e + 1) % 3]; if ((za > 0) === (zb > 0)) continue; const t = za / (za - zb); pts.push([P[a * 3] + (P[b * 3] - P[a * 3]) * t, P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t, z]); }
    if (pts.length === 2) { const n = twTriNormal(P, v[0], v[1], v[2]); if (Math.abs(n[2]) < 0.999) out.push({ a: pts[0], b: pts[1], n }); }
  }
  return out;
}
BUILDERS.TowerSkin = {
  precondition: (f, doc) => (towerOf(doc, F.reference(f, "massing")) ? null : "the skin needs a tower massing"),
  build: (f, doc) => {
    const ms = F.reference(f, "massing"), tw = towerOf(doc, ms), mp = doc.plan(ms), m = mp.mesh, G = tw.G, p = tw.p, P = m.positions, I = m.index;
    // the facets, each with its normal; the podium's apart from the tower's (they are drawn as two depths)
    const podTop = G.podium ? G.podium.z1 + (tw.place.z || 0) : -Infinity;
    const facets = [];
    for (let i = 0; i < I.length; i += 3) {
      const n = twTriNormal(P, I[i], I[i + 1], I[i + 2]);
      const pts = [I[i], I[i + 1], I[i + 2]].map(k => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
      const zone = Math.max(...pts.map(q => q[2])) <= podTop + 1 ? "podium" : "tower";
      facets.push({ pts, n, zone });
    }
    const lines = [];
    // folds and outline: every crease of the envelope, with the two facets' normals
    const fe = featureEdges(m, 6), byEdge = new Map();
    for (let i = 0; i < I.length; i += 3) for (let e = 0; e < 3; e++) { const a = I[i + e], b = I[i + (e + 1) % 3], k = a < b ? a + "_" + b : b + "_" + a; if (!byEdge.has(k)) byEdge.set(k, []); byEdge.get(k).push(facets[i / 3].n); }
    for (const [a, b] of fe) {
      const ns = byEdge.get(a < b ? a + "_" + b : b + "_" + a) || [];
      const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], B = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]];
      lines.push({ a: A, b: B, n: ns[0] || [0, 0, 1], n2: ns[1] || ns[0] || [0, 0, 1], kind: "edge", zone: Math.max(A[2], B[2]) <= podTop + 1 ? "podium" : "tower" });
    }
    // floor lines: the envelope cut at every level above the ground
    const lv = towerLevels(tw);
    if (F.bool(f, "floorLines") !== false) for (const l of lv) { if (l.index === 0) continue; for (const s of twSliceSegs(m, l.z)) lines.push({ a: s.a, b: s.b, n: s.n, kind: "floor", zone: l.z <= podTop + 1 ? "podium" : "tower" }); }
    // mullions: per storey, at stations fixed along each face (or round the plate), from one floor's ring to the next
    if (F.bool(f, "mullions") !== false) {
      const st = mullionStations(G, p), z0 = G.z0;
      for (let s = 0; s < lv.length - 1; s++) {
        const za = G.levels[s].z, zb = G.levels[s + 1].z; if (zb <= z0 + 1) continue;
        const ra = ringRuns(G, towerRingAt(G, Math.max(za, z0))), rb = ringRuns(G, towerRingAt(G, zb));
        ra.forEach((run, r) => { for (const u of st[r]) { const A = alongRun(run.pts, u), B = alongRun(rb[r].pts, u);
          lines.push({ a: placeTower(tw, [A.at[0], A.at[1], Math.max(za, z0)]), b: placeTower(tw, [B.at[0], B.at[1], zb]), n: [...twRotN(tw, A.n), 0], kind: "mullion", zone: "tower" }); } });
        // the crown above the roof: the mullions run on to the top
      }
      const zr = G.levels[G.levels.length - 1].z, ra = ringRuns(G, towerRingAt(G, zr)), rt = ringRuns(G, towerRingAt(G, G.top));
      ra.forEach((run, r) => { for (const u of st[r]) { const A = alongRun(run.pts, u), B = alongRun(rt[r].pts, u); lines.push({ a: placeTower(tw, [A.at[0], A.at[1], zr]), b: placeTower(tw, [B.at[0], B.at[1], G.top]), n: [...twRotN(tw, A.n), 0], kind: "mullion", zone: "tower" }); } });
      // the podium's faces: a mullion every spacing, storey by storey
      if (G.podium) {
        const R = G.podium.ring;
        for (let e = 0; e < 4; e++) {
          const a = R[e], b = R[(e + 1) % 4], Lf = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(Lf / p.mullionSpacing)), d = [(b[0] - a[0]) / Lf, (b[1] - a[1]) / Lf], nOut = twRotN(tw, [d[1], -d[0]]);
          for (let s = 0; s < G.podiumLevel; s++) for (let i = 1; i < n; i++) {
            const q = [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n];
            lines.push({ a: placeTower(tw, [q[0], q[1], G.levels[s].z + 200]), b: placeTower(tw, [q[0], q[1], G.levels[s + 1].z]), n: [...nOut, 0], kind: "mullion", zone: "podium" });
          }
        }
      }
    }
    const box = meshBox(m);
    const area = facets.reduce((s, ft) => { if (Math.abs(ft.n[2]) > 0.999) return s; const [A, B, C] = ft.pts; return s + Math.hypot(...twCross3(twSub3(B, A), twSub3(C, A))) / 2; }, 0);
    return { plan: { mesh: m, facets, lines, z0: box[2], z1: box[5], box, mesh3d: [{ positions: m.positions, index: m.index, colour: "#a9c8de", opacity: 0.55 }] },
      data: { value: area, kind: "Area", props: { "Facade area": { kind: "Area", v: area }, Lines: twNum(lines.length), Massing: twText(doc.idOf(ms)) } } };
  },
};

// ---------------------------------------------------------------- the frame
declare({ type: "TowerFrame", guid: "wb-0911", category: "IfcMember", kind: "frame", idPrefix: "FR",
  summary: "A tower's structure taken from its massing: the diagrid on the facade, or the perimeter columns storey by storey.",
  args: [ ref("massing", "Massing", ["massing"]), choice("role", "Members", ["Diagrid", "Perimeter columns", "Podium columns"], 0),
          real("size", "Member size (0: the massing's)", 0, 0, 3000, 1, "mm"), real("depth", "Member depth (diagrid)", 600, 50, 3000, 1, "mm"),
          real("standOff", "Stand-off from the glass (diagrid)", 250, -2000, 3000, 1, "mm"),
          text("material", "Material", "M-STEEL", { group: "Materials" }) ] });
/** A box along a member: from a to b, `w` across (in the facet), `d` deep (along the outward normal n). */
function twMemberBox(a, b, n, w, d, standOff) {
  const u = twUnit3(twSub3(b, a)), v = twUnit3(twCross3(n, u)), nn = twUnit3(twCross3(u, v));
  const o = twMul3(nn, standOff), corners = [];
  for (const q of [a, b]) for (const [sv, sn] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) corners.push(twAdd3(twAdd3(q, o), twAdd3(twMul3(v, sv * w / 2), twMul3(nn, sn * d))));
  return corners;
}
function twRoundColumn(a, b, r, sides = 12) {
  const corners = [];
  for (const q of [a, b]) for (let i = 0; i < sides; i++) { const t = i / sides * 2 * Math.PI; corners.push([q[0] + r * Math.cos(t), q[1] + r * Math.sin(t), q[2]]); }
  return corners;
}
/** Prisms (bottom ring, top ring of equal count) as one triangle mesh. */
function twPrismsMesh(list) {
  const P = [], I = [];
  for (const c of list) {
    const n = c.length / 2, o = P.length / 3;
    for (const q of c) P.push(q[0], q[1], q[2]);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; I.push(o + i, o + j, o + n + j, o + i, o + n + j, o + n + i); }
    for (let i = 1; i + 1 < n; i++) I.push(o, o + i + 1, o + i, o + n, o + n + i, o + n + i + 1);
  }
  return { positions: P, index: I };
}
BUILDERS.TowerFrame = {
  precondition: (f, doc) => (towerOf(doc, F.reference(f, "massing")) ? null : "the frame needs a tower massing"),
  build: (f, doc) => {
    const ms = F.reference(f, "massing"), tw = towerOf(doc, ms), G = tw.G, p = tw.p, role = F.choice(f, "role") || "Diagrid";
    const members = [];
    if (role === "Diagrid") {
      if (G.kind !== "diagrid") return { plan: { members: [], mesh: { positions: [], index: [] }, z0: 0, z1: 0, role }, data: { value: 0, kind: "Number", props: { Members: twNum(0) } }, note: "a twisting tower has no diagrid: pick perimeter columns" };
      const w = F.real(f, "size") || p.diagridSize, d = F.real(f, "depth"), so = F.real(f, "standOff");
      // the tower's points, row by row; each member's outward normal the mean of the two facets it folds between
      const pts = []; for (const r of G.rows) for (const q of r.ring) pts.push(placeTower(tw, [q[0], q[1], r.z]));
      const fn = new Map();
      for (const fc of tw.faces) {
        const A = pts[fc[0]], B = pts[fc[1]], C = pts[fc[fc.length - 1]];
        let n = twCross3(twSub3(B, A), twSub3(C, A)); if (fc.length === 4) n = twAdd3(n, twCross3(twSub3(pts[fc[2]], B), twSub3(pts[fc[3]], B)));
        n = twUnit3(n);
        for (let i = 0; i < fc.length; i++) { const a = fc[i], b = fc[(i + 1) % fc.length], k = a < b ? a + "_" + b : b + "_" + a; if (!fn.has(k)) fn.set(k, []); fn.get(k).push(n); }
      }
      for (const nd of G.nodes) {
        const a = pts[nd.a], b = pts[nd.b], ns = fn.get(nd.a < nd.b ? nd.a + "_" + nd.b : nd.b + "_" + nd.a) || [[0, 0, 1]];
        const n = twUnit3(ns.reduce((s, x) => twAdd3(s, x), [0, 0, 0]));
        members.push({ a, b, n, w, d, so, corners: twMemberBox(a, b, n, w, d, so) });
      }
    } else if (role === "Podium columns") {
      // the podium's own grid: at the tower's column spacing, square on the tower's centre, kept off the podium's edge
      // and out of the tower's foot
      if (!G.podium) return { plan: { role, members: [], mesh: { positions: [], index: [] }, z0: 0, z1: 0, mesh3d: [] }, data: { value: 0, kind: "Number", props: { Members: twNum(0) } } };
      const r = (F.real(f, "size") || Math.min(800, p.columnSize)) / 2, sp = p.columnSpacing, R = G.podium.ring, foot = G.rows[0].ring;
      const fx0 = Math.min(...foot.map(q => q[0])) - 2500, fx1 = Math.max(...foot.map(q => q[0])) + 2500, fy0 = Math.min(...foot.map(q => q[1])) - 2500, fy1 = Math.max(...foot.map(q => q[1])) + 2500;
      for (let x = Math.ceil((R[0][0] + 1500) / sp) * sp; x <= R[1][0] - 1500; x += sp) for (let y = Math.ceil((R[0][1] + 1500) / sp) * sp; y <= R[2][1] - 1500; y += sp) {
        if (x > fx0 && x < fx1 && y > fy0 && y < fy1) continue;
        for (let s = 0; s < G.podiumLevel; s++) { const a = placeTower(tw, [x, y, G.levels[s].z]), b = placeTower(tw, [x, y, G.levels[s + 1].z]); members.push({ a, b, r, n: [0, -1, 0], storey: s, corners: twRoundColumn(a, b, r) }); }
      }
    } else {
      const r = (F.real(f, "size") || p.columnSize) / 2, st = columnStations(G, p);
      for (let s = 0; s < G.levels.length - 1; s++) {
        const za = G.levels[s].z, zb = G.levels[s + 1].z;
        const ra = ringRuns(G, towerRingAt(G, za)), rb = ringRuns(G, towerRingAt(G, zb));
        ra.forEach((run, k) => { for (const u of st[k]) {
          const A = alongRun(run.pts, u), B = alongRun(rb[k].pts, u);
          const a = placeTower(tw, [A.at[0] - A.n[0] * p.columnInset, A.at[1] - A.n[1] * p.columnInset, za]);
          const b = placeTower(tw, [B.at[0] - B.n[0] * p.columnInset, B.at[1] - B.n[1] * p.columnInset, zb]);
          members.push({ a, b, r, n: [...twRotN(tw, A.n), 0], storey: s, corners: twRoundColumn(a, b, r) });
        } });
      }
    }
    const mesh = twPrismsMesh(members.map(mb => mb.corners));
    const box = mesh.positions.length ? meshBox(mesh) : [0, 0, 0, 0, 0, 0];
    const len = members.reduce((s, mb) => s + Math.hypot(...twSub3(mb.b, mb.a)), 0);
    return { plan: { role, members: members.map(({ corners, ...rest }) => rest), mesh, z0: box[2], z1: box[5], mesh3d: [{ positions: mesh.positions, index: mesh.index, colour: role === "Diagrid" ? "#5d6670" : "#8d9399", opacity: 1 }] },
      data: { value: members.length, kind: "Number", props: { Members: twNum(members.length), "Total length": twLen(len), Role: twText(role) } } };
  },
};

// ---------------------------------------------------------------- drawing helpers (scene.js and hlr.js call these)
/** Hull of 2D points (monotone chain), counter-clockwise. */
function twHull(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop(); return lo.concat(up);
}
/** Elevation and section items for a skin or a frame, in the view's (along, up) coordinates. In an elevation the
 *  facets turned to the eye are drawn and hide what is behind them; in a section, the far side's inner face beyond
 *  the cut, and the line where the cut crosses the envelope. */
export function towerElevItems(doc, f, G, section) {
  const t = doc.typeOf(f), p = doc.plan(f); if (!p) return [];
  const toEye = [-G.look[0], -G.look[1]], facing = n => n[0] * toEye[0] + n[1] * toEye[1];
  const V = q => [G.sOf([q[0], q[1]]), q[2] - G.Z0], D = q => G.depthOf([q[0], q[1]]);
  const id = doc.idOf(f), items = [];
  const item = (curves, sil, depth, depthMax, extra = {}) => {
    if (!curves.length) return;
    let s0 = Infinity, s1 = -Infinity; for (const [a, b] of curves) { s0 = Math.min(s0, a[0], b[0]); s1 = Math.max(s1, a[0], b[0]); }
    items.push(Object.assign({ id, f, depth, depthMax, s0, s1, curves, sil, fillerHits: [] }, extra));
  };
  if (t === "TowerSkin") {
    for (const zone of ["podium", "tower"]) {
      // folds and the outline wherever a facet turns toward the eye; mullions and floor lines only on faces seen
      // square enough to read (on a face turned nearly edge-on they crowd into a black band)
      const lim = ln => (ln.kind === "edge" ? 0.02 : 0.3);
      const want = ln => ln.zone === zone && (section ? (facing(ln.n) < -lim(ln) || (ln.n2 && facing(ln.n2) < -lim(ln))) && D(ln.a) > 0 && D(ln.b) > 0
                                                       : facing(ln.n) > lim(ln) || (ln.n2 && facing(ln.n2) > lim(ln)));
      const curves = [];
      for (const ln of p.lines) if (want(ln)) curves.push([V(ln.a), V(ln.b)]);
      const fs = p.facets.filter(ft => ft.zone === zone && Math.abs(ft.n[2]) < 0.999 && (section ? facing(ft.n) < -0.02 && ft.pts.every(q => D(q) > 0) : facing(ft.n) > 0.02));
      if (!fs.length) continue;
      let d0 = Infinity, d1 = -Infinity; for (const ft of fs) for (const q of ft.pts) { const d = D(q); d0 = Math.min(d0, d); d1 = Math.max(d1, d); }
      // what the facets hide: the hull of each band between floors (a plate's notches are too small to see past)
      const bands = new Map();
      for (const ft of fs) { const zc = Math.min(...ft.pts.map(q => q[2])), k = Math.round(zc / 500); if (!bands.has(k)) bands.set(k, []); for (const q of ft.pts) bands.get(k).push(V(q)); }
      const sil = section ? [] : [...bands.values()].map(twHull).filter(h => h.length >= 3);
      // a section draws the far wall last, behind whatever stands inside
      item(curves, sil, section ? d1 - 1 : d0, d1, { cat: "IfcCurtainWall" });
    }
    if (section) {
      // the cut: where the plane through the view line crosses the envelope
      const cuts = [];
      for (const ft of p.facets) {
        if (Math.abs(ft.n[2]) > 0.999) continue;
        const d = ft.pts.map(D), pts = [];
        for (let e = 0; e < 3; e++) { const a = ft.pts[e], b = ft.pts[(e + 1) % 3], da = d[e], db = d[(e + 1) % 3]; if ((da > 0) === (db > 0) || da === db) continue; const tt = da / (da - db); pts.push(V([a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt, a[2] + (b[2] - a[2]) * tt])); }
        if (pts.length === 2) cuts.push(pts);
      }
      item(cuts, [], 0, 0, { cat: "IfcCurtainWall", cut: true });
    }
  } else if (t === "TowerFrame") {
    if (p.role !== "Diagrid") return [];
    // the diagrid sits on the glass: drawn just before it, hiding the mullions behind each member
    const curves = [], sil = []; let d0 = Infinity, d1 = -Infinity;
    for (const mb of p.members) {
      const fc = facing(mb.n);
      if (section ? !(fc < -0.02 && D(mb.a) > 0 && D(mb.b) > 0) : !(fc > 0.02)) continue;
      const u = twUnit3(twSub3(mb.b, mb.a)), v = twUnit3(twCross3(mb.n, u)), w = mb.w / 2;
      const o = twMul3(twUnit3(twCross3(u, v)), mb.so + mb.d);
      const q = [twAdd3(twAdd3(mb.a, o), twMul3(v, -w)), twAdd3(twAdd3(mb.b, o), twMul3(v, -w)), twAdd3(twAdd3(mb.b, o), twMul3(v, w)), twAdd3(twAdd3(mb.a, o), twMul3(v, w))].map(V);
      curves.push([q[0], q[1]], [q[3], q[2]]);
      const h = twHull(q); if (h.length >= 3) sil.push(h);
      for (const x of [mb.a, mb.b]) { const dd = D(x); d0 = Math.min(d0, dd); d1 = Math.max(d1, dd); }
    }
    // just in front of the skin's own near face, whatever the members' own depth
    const skin = doc.elements().find(g => doc.typeOf(g) === "TowerSkin" && F.refId(g, "massing") === F.refId(f, "massing"));
    let front = d0;
    if (skin && doc.plan(skin)) { for (const ft of doc.plan(skin).facets) if (ft.zone === "tower" && (section ? facing(ft.n) < -0.02 : facing(ft.n) > 0.02)) for (const q of ft.pts) front = Math.min(front, D(q)); }
    item(curves, section ? [] : sil, section ? d1 - 2 : Math.min(d0, front - 2), d1, { cat: "IfcMember" });
  }
  return items;
}
/** What a plan at height cutZ draws for a skin or a frame: fills and strokes in model coordinates. */
export function towerPlanPrims(doc, f, cutZ) {
  const t = doc.typeOf(f), p = doc.plan(f), out = { fills: [], strokes: [] }; if (!p || cutZ < p.z0 || cutZ > p.z1) return out;
  if (t === "TowerSkin") {
    // the glass line, and a second line inside it at the mullions' depth
    const loops = sliceMesh(p.mesh, cutZ).filter(l => l.closed && l.pts.length >= 3);
    const md = F.real(f, "mullionDepth");
    for (const l of loops) {
      const ring = l.pts, ccw = ring.reduce((a, q, i) => { const r = ring[(i + 1) % ring.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0) > 0;
      out.strokes.push({ pts: ring.concat([ring[0]]), pen: "medium" });
      if (md > 0) {
        const n = ring.length, inner = [];
        for (let i = 0; i < n; i++) {
          const a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n];
          const n1 = twNormal2(a, b, ccw), n2 = twNormal2(b, c, ccw), m = [n1[0] + n2[0], n1[1] + n2[1]], ml = Math.hypot(m[0], m[1]) || 1, cosh = (m[0] * n1[0] + m[1] * n1[1]) / ml;
          const k = md / Math.max(0.35, cosh);
          inner.push([b[0] - m[0] / ml * k, b[1] - m[1] / ml * k]);
        }
        out.strokes.push({ pts: inner.concat([inner[0]]), pen: "thin" });
      }
    }
    // mullions cut: a tick across the glass where each runs through the cut
    for (const ln of p.lines) if (ln.kind === "mullion" && (ln.a[2] - cutZ) * (ln.b[2] - cutZ) < 0) {
      const tt = (cutZ - ln.a[2]) / (ln.b[2] - ln.a[2]), q = [ln.a[0] + (ln.b[0] - ln.a[0]) * tt, ln.a[1] + (ln.b[1] - ln.a[1]) * tt];
      out.strokes.push({ pts: [q, [q[0] - ln.n[0] * md, q[1] - ln.n[1] * md]], pen: "thin" });
    }
  } else if (t === "TowerFrame") {
    // each member through the cut: its section, solid
    for (const mb of p.members) {
      if ((mb.a[2] - cutZ) * (mb.b[2] - cutZ) > 0) continue;
      const tt = (cutZ - mb.a[2]) / ((mb.b[2] - mb.a[2]) || 1), c = [mb.a[0] + (mb.b[0] - mb.a[0]) * tt, mb.a[1] + (mb.b[1] - mb.a[1]) * tt];
      if (p.role === "Diagrid") {
        const u = twUnit3(twSub3(mb.b, mb.a)), v = twUnit3(twCross3(mb.n, u)), nn = twUnit3(twCross3(u, v));
        // the box's corners where they cross the plane: the box cut obliquely
        const sec = [];
        for (const [sv, sn] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
          const off = twAdd3(twMul3(v, sv * mb.w / 2), twMul3(nn, mb.so + sn * mb.d)), a = twAdd3(mb.a, off), b = twAdd3(mb.b, off), k = (cutZ - a[2]) / ((b[2] - a[2]) || 1);
          sec.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
        }
        out.fills.push({ pts: sec, colour: "#2b2f33" });
      } else {
        const ring = []; for (let i = 0; i < 24; i++) { const a = i / 24 * 2 * Math.PI; ring.push([c[0] + mb.r * Math.cos(a), c[1] + mb.r * Math.sin(a)]); }
        out.fills.push({ pts: ring, colour: "#2b2f33" });
      }
    }
  }
  return out;
}
function twNormal2(a, b, ccw) { const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1; return ccw ? [d[1] / l, -d[0] / l] : [-d[1] / l, d[0] / l]; }
/** The hidden-line model's share: the skin's facets as faces that hide (each triangle convex), its lines as edges;
 *  a frame's member boxes as edges. */
export function towerHLR(doc, f) {
  const t = doc.typeOf(f), p = doc.plan(f), solids = [], edges = []; if (!p) return { solids, edges };
  if (t === "TowerSkin") {
    solids.push({ faces: p.facets.map(ft => ({ poly: ft.pts, n: ft.n })) });
    for (const ln of p.lines) if (ln.kind !== "mullion" || true) edges.push({ a: ln.a, b: ln.b, kind: "sharp" });
  } else if (t === "TowerFrame" && p.role === "Diagrid") {
    for (const mb of p.members) {
      const u = twUnit3(twSub3(mb.b, mb.a)), v = twUnit3(twCross3(mb.n, u)), nn = twUnit3(twCross3(u, v));
      for (const [sv, sn] of [[-1, 1], [1, 1]]) { const off = twAdd3(twMul3(v, sv * mb.w / 2), twMul3(nn, mb.so + sn * mb.d)); edges.push({ a: twAdd3(mb.a, off), b: twAdd3(mb.b, off), kind: "sharp" }); }
    }
  }
  return { solids, edges };
}
