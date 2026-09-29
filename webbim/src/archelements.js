//! Architecture elements drawn from their construction, not from lines: a stair (flights and landings whose
//! risers are counted from the storey height, numbered in plan), a roof by footprint (each edge sloped or not,
//! the ridges, hips and valleys found where the planes meet) and a toposurface (contour lines at their heights,
//! triangulated into the ground). Each builds a closed body, so plans, elevations, sections and 3D all read the
//! same geometry; plans add what a draughtsman adds to it (a stair's numbers and arrow, the ground's contours).

import { add, sub, mul, dot, normalise, perp, polyArea, pointInPoly, polyPath, triangulate } from "./geom2d.js";
import { declare, BUILDERS, F, real, integer, bool, text, choice, ref, json } from "./ocaf.js";
import { weldTriangles } from "./massing.js";

const LEN = v => ({ kind: "Length", v }), NUM = v => ({ kind: "Number", v }), AREA = v => ({ kind: "Area", v });
const levelZ = (doc, f, key) => { const lv = F.reference(f, key); const d = lv && doc.data(lv); return d ? d.value : 0; };
const ccwOf = pts => (polyArea(pts) >= 0 ? pts : pts.slice().reverse());

/** A closed body from triangles: welded so that a section plane slices it into closed outlines. */
function bodyOf(tris) { const soup = []; for (const t of tris) for (const p of t) soup.push(p[0], p[1], p[2]); return weldTriangles(soup, 0.01); }
/** A prism's triangles: a plan polygon between a lower and an upper height function. */
function prismTris(poly, zLo, zHi, tris) {
  const O = ccwOf(poly), tri = triangulate(O);
  for (const [i, j, k] of tri) { tris.push([[...O[i], zHi(O[i])], [...O[j], zHi(O[j])], [...O[k], zHi(O[k])]]); tris.push([[...O[i], zLo(O[i])], [...O[k], zLo(O[k])], [...O[j], zLo(O[j])]]); }
  for (let i = 0; i < O.length; i++) { const a = O[i], b = O[(i + 1) % O.length]; tris.push([[...a, zLo(a)], [...b, zLo(b)], [...b, zHi(b)]], [[...a, zLo(a)], [...b, zHi(b)], [...a, zHi(a)]]); }
}

// ================================================================ stair
//! Revit's stair by component: flights (a walking line from its first riser to its last), landings made where one
//! flight hands over to the next, the risers counted from the height between its base and top level (no riser
//! over the maximum), spread over the flights by their length. The plan numbers every riser, draws the walking
//! line with its arrow and UP, and breaks the flight where the view's cut plane passes through it.
declare({ type: "Stair", guid: "wb-0410", category: "IfcStair", kind: "stair", idPrefix: "ST",
  summary: "A stair: flights and landings between two levels; its risers counted from the height and numbered in plan.",
  args: [ ref("baseLevel", "Base level", ["level"], { group: "Constraints" }), real("baseOffset", "Base offset", 0, -100000, 100000, 1, "mm", { group: "Constraints" }),
          ref("topLevel", "Top level", ["level"], { group: "Constraints" }), real("topOffset", "Top offset", 0, -100000, 100000, 1, "mm", { group: "Constraints" }),
          real("height", "Height (no top level)", 3000, 100, 100000, 1, "mm", { group: "Constraints" }),
          json("flights", "Flights (walking line, first riser to last)", [{ from: [0, 0], to: [3000, 0] }]),
          real("width", "Width", 1000, 300, 10000, 1, "mm", { group: "Dimensions" }),
          real("maxRiser", "Maximum riser", 180, 50, 300, 1, "mm", { group: "Dimensions" }), integer("risers", "Risers (0: counted)", 0, 0, 400, { group: "Dimensions" }),
          real("waist", "Waist (structure under the steps)", 150, 20, 1000, 1, "mm", { group: "Construction" }),
          choice("railings", "Railings", ["Both", "Left", "Right", "None"], 0, { group: "Construction" }), real("railHeight", "Railing height", 900, 300, 2000, 1, "mm", { group: "Construction" }),
          bool("numbers", "Number the risers in plan", true, { group: "Graphics" }), text("material", "Material", "M-CONC", { group: "Materials" }) ] });
export function stairLayout(doc, f) {
  const z0 = levelZ(doc, f, "baseLevel") + F.real(f, "baseOffset");
  const top = F.reference(f, "topLevel"), z1 = top ? levelZ(doc, f, "topLevel") + F.real(f, "topOffset") : z0 + F.real(f, "height");
  const H = Math.max(1, z1 - z0), W = F.real(f, "width");
  const fl = (F.json(f, "flights") || []).filter(q => q && q.from && q.to).map(q => { const d = sub(q.to, q.from), L = Math.hypot(d[0], d[1]); return { from: q.from, to: q.to, L, d: L ? mul(d, 1 / L) : [1, 0], risers: q.risers | 0 }; }).filter(q => q.L > 1);
  const R = F.int(f, "risers") || Math.max(2, Math.ceil(H / F.real(f, "maxRiser") - 1e-9)), h = H / R;
  // each flight takes risers in proportion to its run (one riser more than its treads); a flight's own count wins
  const fixed = fl.reduce((s, q) => s + (q.risers || 0), 0), free = fl.filter(q => !q.risers), Lfree = free.reduce((s, q) => s + q.L, 0);
  let left = R - fixed;
  free.forEach((q, i) => { q.risers = i === free.length - 1 ? left : Math.max(2, Math.round((R - fixed) * q.L / (Lfree || 1))); left -= q.risers; });
  let z = z0, n = 0;
  for (const q of fl) {
    q.z0 = z; q.g = q.risers > 1 ? q.L / (q.risers - 1) : q.L; q.n = perp(q.d);   // left of the walking line
    q.steps = []; for (let i = 0; i < q.risers; i++) q.steps.push({ s: i * q.g, z: z + (i + 1) * h, no: ++n });
    z += q.risers * h; q.z1 = z;
  }
  const edge = (c, q) => [add(c, mul(q.n, W / 2)), add(c, mul(q.n, -W / 2))];
  const landings = [];
  for (let k = 0; k + 1 < fl.length; k++) {
    const a = fl[k], b = fl[k + 1], e1 = edge(a.to, a), e2 = edge(b.from, b);
    const pts = [...e1, ...e1.map(p => add(p, mul(a.d, W))), ...e2, ...e2.map(p => sub(p, mul(b.d, W)))];
    landings.push({ poly: hull(pts), z: a.z1 });
  }
  return { z0, z1, H, R, h, W, flights: fl, landings, waist: F.real(f, "waist") };
}
function hull(pts) {
  const P = pts.map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-6) lo.pop(); lo.push(p); }
  for (const p of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 1e-6) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
BUILDERS.Stair = {
  precondition: f => ((F.json(f, "flights") || []).length ? null : "a stair needs a flight"),
  build: (f, doc) => {
    const S = stairLayout(doc, f), tris = [], rails = [], wv = S.waist / Math.cos(Math.atan2(S.h, S.flights[0] ? S.flights[0].g : 250));
    for (const q of S.flights) {
      // the flight's profile in (along, height): the steps on top, the waist parallel to the pitch under them
      const prof = [[0, q.z0]];
      q.steps.forEach((st, i) => { prof.push([st.s, st.z]); prof.push([i + 1 < q.steps.length ? q.steps[i + 1].s : st.s, st.z]); });
      prof.pop();
      const sEnd = q.steps[q.steps.length - 1].s, m = S.h / q.g, zb = q.z1 - wv, sHit = sEnd - (zb - q.z0) / m;
      prof.push([sEnd, zb]);
      if (sHit > 0) prof.push([sHit, q.z0]); else prof.push([0, zb - m * sEnd]);
      const P = (s, z, side) => [...add(q.from, add(mul(q.d, s), mul(q.n, side * S.W / 2))), z];
      const loop = polyArea(prof) >= 0 ? prof : prof.slice().reverse(), tri = triangulate(loop);
      for (const [i, j, k] of tri) { tris.push([P(...loop[i], 1), P(...loop[k], 1), P(...loop[j], 1)]); tris.push([P(...loop[i], -1), P(...loop[j], -1), P(...loop[k], -1)]); }
      for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; tris.push([P(...a, -1), P(...b, -1), P(...b, 1)], [P(...a, -1), P(...b, 1), P(...a, 1)]); }
      // railings: a bar at the railing height above the nosings, each side asked for
      const sides = { Both: [1, -1], Left: [1], Right: [-1], None: [] }[F.choice(f, "railings")] || [];
      for (const sd of sides) {
        const off = sd * (S.W / 2 - 25), a = add(q.from, mul(q.n, off)), b = add(q.to, mul(q.n, off)), rh = F.real(f, "railHeight");
        const foot = [add(a, mul(q.n, 20)), add(b, mul(q.n, 20)), add(b, mul(q.n, -20)), add(a, mul(q.n, -20))];
        const zAt = p => q.z0 + S.h + (dot(sub(p, q.from), q.d) / (q.L || 1)) * (q.z1 - q.z0 - S.h);
        prismTris(foot, p => zAt(p) + rh - 50, p => zAt(p) + rh, rails);
      }
    }
    for (const l of S.landings) prismTris(l.poly, () => l.z - S.waist, () => l.z, tris);
    const body = bodyOf(tris), all = tris.concat(rails), mesh3 = bodyOf(all);
    const footAll = hull(S.flights.flatMap(q => [add(q.from, mul(q.n, S.W / 2)), add(q.from, mul(q.n, -S.W / 2)), add(q.to, mul(q.n, S.W / 2)), add(q.to, mul(q.n, -S.W / 2))]).concat(S.landings.flatMap(l => l.poly)));
    const mat = F.text(f, "material") || "M-CONC", colour = ((doc.lib.materials[mat] || {}).shading || {}).colour || "#c8c4bc";
    const tread = S.flights[0] ? S.flights[0].g : 0;
    return { plan: { path: polyPath(footAll), foot: footAll, z0: S.z0 - S.waist, z1: S.z1, material: mat, parts: [], mesh: body, mesh3d: [{ positions: body.positions, index: body.index, colour }, ...(rails.length ? [{ ...bodyOf(rails), colour: "#6d7178" }] : [])], stair: S },
      data: { value: S.R, kind: "Number", props: { Risers: NUM(S.R), "Riser height": LEN(S.h), "Tread depth": LEN(tread), Width: LEN(S.W), Height: LEN(S.H), Flights: NUM(S.flights.length), Landings: NUM(S.landings.length) } } };
  },
};

// ================================================================ roof by footprint
//! Revit's footprint roof: a boundary, and for each of its edges whether it defines a slope (and at what pitch).
//! Every sloped edge raises a plane from the eave; the roof is where the lowest of them lies - so the ridges, hips
//! and valleys are found, not drawn. An edge that does not slope is a gable: the planes run out over it. Asked
//! for a ridge height instead of a pitch, the pitch is found that brings the highest point to it.
export function roofPlanes(outer, edges, z0, ridgeHeight) {
  const O = ccwOf(outer), n = O.length, flip = polyArea(outer) < 0;
  const dirOf = i => normalise(sub(O[(i + 1) % n], O[i])), inwOf = d => [-d[1], d[0]];
  // at a reflex corner the two edges' planes each reach only as far as the corner's bisector (the valley runs
  // up it): an edge's plane counts where the point lies inward of the edge and on its own side of those bisectors
  const reflex = i => { const d0 = dirOf((i - 1 + n) % n), d1 = dirOf(i); return d0[0] * d1[1] - d0[1] * d1[0] < -1e-9; };
  const bis = i => normalise(add(inwOf(dirOf((i - 1 + n) % n)), inwOf(dirOf(i))));
  const E = [];
  for (let i = 0; i < n; i++) {
    const a = O[i], b = O[(i + 1) % n], srcIdx = flip ? (n - 2 - i + n) % n : i, spec = (edges || [])[srcIdx];
    const slope = spec === undefined ? 30 : spec === null ? null : typeof spec === "number" ? spec : spec.slope;
    if (slope == null || slope === false) continue;
    const d = dirOf(i), inw = inwOf(d), W = [p => dot(sub(p, a), inw)];
    for (const [v, other] of [[i, b], [(i + 1) % n, a]]) if (reflex(v)) { const c = O[v], bv = bis(v), sg = Math.sign((bv[0] * (other[1] - c[1]) - bv[1] * (other[0] - c[0]))) || 1;
      W.push(p => sg * (bv[0] * (p[1] - c[1]) - bv[1] * (p[0] - c[0]))); }
    E.push({ a, inw, W, t: Math.tan(slope * Math.PI / 180), z: z0 + ((spec && spec.offset) || 0) });
  }
  const at = (e, p) => e.z + e.t * dot(sub(p, e.a), e.inw);
  const tidy = poly => poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.5; });
  const ok = poly => poly.length >= 3 && Math.abs(polyArea(poly)) > 1;
  const regionsNow = () => {
    const out = [];
    for (const e of E) {
      // where e reaches, and there lower than every other plane that reaches there too
      let pieces = [e.W.reduce((poly, w) => (poly.length ? tidy(roofClipHalf(poly, w)) : poly), O)].filter(ok);
      for (const g of E) {
        if (g === e) continue;
        const next = [];
        for (const P of pieces) {
          // where g does not reach: outside the first of its limits, or inside it and outside the next, ...; where
          // it does, only the part under it
          let rest = P;
          for (const w of g.W) { const outside = tidy(roofClipHalf(rest, p => -w(p))); if (ok(outside)) next.push(outside); rest = tidy(roofClipHalf(rest, w)); if (!ok(rest)) break; }
          if (ok(rest)) { const lower = tidy(roofClipHalf(rest, p => at(g, p) - at(e, p))); if (ok(lower)) next.push(lower); }
        }
        pieces = next;
      }
      for (const poly of pieces) out.push({ e, poly });
    }
    return out;
  };
  let regions = regionsNow();
  if (ridgeHeight > 0 && E.length) {
    let top = -Infinity; for (const r of regions) for (const p of r.poly) top = Math.max(top, at(r.e, p) - r.e.z);
    const k = top > 1e-6 ? ridgeHeight / top : 1; for (const e of E) e.t *= k;
  }
  if (!E.length) regions = [{ e: { a: O[0], inw: [0, 0], t: 0, z: z0 }, poly: O }];
  // the surface's height anywhere: the lowest plane that reaches there
  const height = p => { let h = Infinity; for (const e of E) if (e.W.every(w => w(p) >= -1e-6)) h = Math.min(h, at(e, p)); return Number.isFinite(h) ? h : z0; };
  return { O, regions, at, height };
}
function roofClipHalf(poly, g) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], gp = g(p), gq = g(q);
    if (gp >= -1e-7) out.push(p);
    if ((gp >= -1e-7) !== (gq >= -1e-7)) { const t = gp / (gp - gq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
export function footprintRoofBody(outer, edges, z0, ridgeHeight, thickness) {
  const { O, regions, at, height } = roofPlanes(outer, edges, z0, ridgeHeight), tris = [], ridges = [], seenR = new Set();
  const onBoundary = (p, q) => O.some((a, i) => { const b = O[(i + 1) % O.length], d = sub(b, a), L = Math.hypot(d[0], d[1]); if (!L) return false; const nn = [-d[1] / L, d[0] / L];
    return Math.abs(dot(sub(p, a), nn)) < 0.5 && Math.abs(dot(sub(q, a), nn)) < 0.5; });
  for (const r of regions) {
    const tv = thickness * Math.sqrt(1 + r.e.t * r.e.t), top = p => at(r.e, p), bot = p => at(r.e, p) - tv, P = ccwOf(r.poly);
    for (const [i, j, k] of triangulate(P)) { tris.push([[...P[i], top(P[i])], [...P[j], top(P[j])], [...P[k], top(P[k])]]); tris.push([[...P[i], bot(P[i])], [...P[k], bot(P[k])], [...P[j], bot(P[j])]]); }
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) continue;
      if (onBoundary(a, b)) tris.push([[...a, bot(a)], [...b, bot(b)], [...b, top(b)]], [[...a, bot(a)], [...b, top(b)], [...a, top(a)]]);
      else {
        // a ridge, hip or valley where the surface folds; a seam between two pieces of one plane is not drawn
        const k = [a, b].map(q => Math.round(q[0]) + "," + Math.round(q[1])).sort().join("|"), m = mul(add(a, b), 0.5), dd = normalise(sub(b, a)), nn = [-dd[1] * 20, dd[0] * 20];
        const kink = Math.abs(height(add(m, nn)) + height(sub(m, nn)) - 2 * height(m)) > 0.5;
        if (kink && !seenR.has(k)) { seenR.add(k); ridges.push([[...a, top(a)], [...b, top(b)]]); }
      }
    }
  }
  return { tris, ridges, regions, at };
}

// ================================================================ toposurface
//! Revit's toposurface from contours: each contour line carries its height; the points along them (and any spot
//! heights) are triangulated (Delaunay) into the ground's surface, closed down to a base so a section cuts it into
//! earth. The plan draws it as AutoCAD does a survey: contour lines at an interval, every nth heavier and labelled.
declare({ type: "Toposurface", guid: "wb-0411", category: "Topography", kind: "topo", idPrefix: "TS",
  summary: "A topographic surface from contour lines at their heights (and spot points), triangulated; contours in plan.",
  args: [ json("contours", "Contours [{ z, points: [[x, y], ...] }]", []), json("points", "Spot points [[x, y, z], ...]", []),
          json("boundary", "Boundary (blank: the points' hull)", []),
          real("base", "Base elevation (bottom of the earth)", -3000, -1e6, 1e6, 1, "mm", { group: "Constraints" }),
          real("interval", "Contour interval", 500, 10, 100000, 1, "mm", { group: "Graphics" }), integer("major", "Every nth contour heavier", 5, 1, 100, { group: "Graphics" }),
          bool("labels", "Label the heavier contours", true, { group: "Graphics" }), text("material", "Material", "M-SOIL", { group: "Materials" }) ] });
function delaunay(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), mx = Math.min(...xs), Mx = Math.max(...xs), my = Math.min(...ys), My = Math.max(...ys), D = Math.max(Mx - mx, My - my) * 20 || 1;
  const V = pts.map(p => [p[0], p[1]]); const s0 = V.length; V.push([mx - D, my - D], [mx + 2 * D, my - D], [mx - D, my + 2 * D]);
  let T = [[s0, s0 + 1, s0 + 2]];
  const circ = t => { const [a, b, c] = t.map(i => V[i]); const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (Math.abs(d) < 1e-12) return [0, 0, Infinity];
    const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2, ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
    return [ux, uy, (a[0] - ux) ** 2 + (a[1] - uy) ** 2]; };
  let C = T.map(circ);
  for (let i = 0; i < s0; i++) {
    const p = V[i], bad = [], keep = [], keepC = [];
    T.forEach((t, k) => { const c = C[k]; if ((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 < c[2]) bad.push(t); else { keep.push(t); keepC.push(c); } });
    const cnt = new Map(); for (const t of bad) for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3], k = a < b ? a + "," + b : b + "," + a; cnt.set(k, (cnt.get(k) || 0) + 1); }
    T = keep; C = keepC;
    for (const t of bad) for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3], k = a < b ? a + "," + b : b + "," + a; if (cnt.get(k) === 1) { const nt = [a, b, i]; T.push(nt); C.push(circ(nt)); } }
  }
  return T.filter(t => t.every(i => i < s0));
}
export function topoSurface(doc, f) {
  const pts = [];
  const lines = (F.json(f, "contours") || []).filter(c => c && Array.isArray(c.points) && c.points.length);
  for (const c of lines) {
    // each contour sampled along its length, so long straight runs do not make long thin triangles
    for (let i = 0; i < c.points.length; i++) {
      const a = c.points[i], b = c.points[i + 1]; pts.push([a[0], a[1], c.z]);
      if (b) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(L / 3000); for (let k = 1; k <= n; k++) pts.push([a[0] + (b[0] - a[0]) * k / (n + 1), a[1] + (b[1] - a[1]) * k / (n + 1), c.z]); }
    }
  }
  for (const p of F.json(f, "points") || []) if (Array.isArray(p) && p.length >= 3) pts.push(p.slice(0, 3));
  // the boundary: heights where it lies found from the nearest surveyed points (inverse distance)
  const bnd = (F.json(f, "boundary") || []).filter(p => Array.isArray(p));
  const idw = q => { const near = pts.map(p => [Math.hypot(p[0] - q[0], p[1] - q[1]), p[2]]).sort((a, b) => a[0] - b[0]).slice(0, 6); if (near[0] && near[0][0] < 1) return near[0][1]; let s = 0, w = 0; for (const [d, z] of near) { s += z / (d * d); w += 1 / (d * d); } return w ? s / w : 0; };
  if (bnd.length >= 3) {
    const B = ccwOf(bnd);
    for (let i = 0; i < B.length; i++) { const a = B[i], b = B[(i + 1) % B.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 3000)); for (let k = 0; k < n; k++) { const q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; pts.push([q[0], q[1], idw(q)]); } }
    for (let i = pts.length - 1; i >= 0; i--) if (!pointInPoly(pts[i], B) && !B.some((a, j) => { const b = B[(j + 1) % B.length], d = sub(b, a), L = Math.hypot(d[0], d[1]); return L && Math.abs((pts[i][0] - a[0]) * d[1] - (pts[i][1] - a[1]) * d[0]) / L < 1 && dot(sub(pts[i], a), d) >= -1 && dot(sub(pts[i], a), d) <= L * L + 1; })) pts.splice(i, 1);
  }
  // one point per place: two contours meeting leave the lower
  const seen = new Map(); const P = []; for (const p of pts) { const k = Math.round(p[0]) + "," + Math.round(p[1]); if (!seen.has(k)) { seen.set(k, P.length); P.push(p); } }
  const T = P.length >= 3 ? delaunay(P) : [];
  return { P, T };
}
BUILDERS.Toposurface = {
  precondition: f => (((F.json(f, "contours") || []).length || (F.json(f, "points") || []).length >= 3) ? null : "a toposurface needs contours or three points"),
  build: (f, doc) => {
    const { P, T } = topoSurface(doc, f), base = F.real(f, "base"), tris = [];
    for (const t of T) { const [a, b, c] = t.map(i => P[i]); const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0; tris.push(ccw ? [a, b, c] : [a, c, b]); }
    // its edge: triangle sides used once, walked into the outline; skirted down to the base and closed there
    const use = new Map(); for (const t of T) for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3], k = a < b ? a + "," + b : b + "," + a; use.set(k, (use.get(k) || 0) + 1); }
    const nxt = new Map();
    for (const t of T) { const [a, b, c] = t, ccw = (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]) > 0, o = ccw ? [a, b, c] : [a, c, b];
      for (let e = 0; e < 3; e++) { const x = o[e], y = o[(e + 1) % 3], k = x < y ? x + "," + y : y + "," + x; if (use.get(k) === 1) nxt.set(x, y); } }
    const loop = []; if (nxt.size) { const s = nxt.keys().next().value; let c = s, g = 0; do { loop.push(c); c = nxt.get(c); } while (c !== undefined && c !== s && ++g < 100000); }
    const edge = loop.map(i => P[i]);
    for (let i = 0; i < edge.length; i++) { const a = edge[i], b = edge[(i + 1) % edge.length]; tris.push([a, [a[0], a[1], base], [b[0], b[1], base]], [a, [b[0], b[1], base], b]); }
    if (edge.length >= 3) { const foot = edge.map(p => [p[0], p[1]]), ft = triangulate(ccwOf(foot)), F2 = ccwOf(foot); for (const [i, j, k] of ft) tris.push([[...F2[i], base], [...F2[k], base], [...F2[j], base]]); }
    const body = bodyOf(tris), foot = edge.map(p => [p[0], p[1]]), zs = P.map(p => p[2]);
    const mat = F.text(f, "material") || "M-SOIL", colour = ((doc.lib.materials[mat] || {}).shading || {}).colour || "#9c8b6e";
    const area = Math.abs(polyArea(foot));
    return { plan: { path: polyPath(foot), foot, z0: base, z1: Math.max(...zs), zTop: Math.max(...zs), material: mat, parts: [], mesh: body, mesh3d: [{ positions: body.positions, index: body.index, colour }], topo: true },
      data: { value: area, kind: "Area", props: { "Projected area": AREA(area), Points: NUM(P.length), "Lowest point": LEN(Math.min(...zs)), "Highest point": LEN(Math.max(...zs)) } } };
  },
};

/** A survey's contour lines from an ASCII DXF: every polyline (LWPOLYLINE at its elevation, POLYLINE and its
 *  vertices, 3D polylines at their vertices' heights) and LINE, at the height it is drawn at, scaled to mm by the
 *  drawing's $INSUNITS (unitless is read as `unitless`). Lines drawn at no height are left out and counted. */
export function contoursFromDXF(text, unitless = "mm") {
  const L = String(text || "").split(/\r?\n/), pairs = [];
  for (let i = 0; i + 1 < L.length; i += 2) pairs.push([parseInt(L[i], 10), L[i + 1].trim()]);
  const UNITS = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }, UNITLESS = { mm: 1, m: 1000, ft: 304.8, in: 25.4 };
  let k = UNITLESS[unitless] || 1;
  for (let i = 0; i + 1 < pairs.length; i++) if (pairs[i][0] === 9 && pairs[i][1] === "$INSUNITS" && UNITS[parseInt(pairs[i + 1][1], 10)]) k = UNITS[parseInt(pairs[i + 1][1], 10)];
  const ents = []; let cur = null;
  for (const [c, v] of pairs) { if (c === 0) { cur = { type: v, g: [] }; ents.push(cur); } else if (cur) cur.g.push([c, v]); }
  const num = (e, code, def = 0) => { const q = e.g.find(x => x[0] === code); return q ? parseFloat(q[1]) : def; };
  const out = []; let flat = 0;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.type === "LWPOLYLINE") {
      const pts = []; for (const [c, v] of e.g) { if (c === 10) pts.push([parseFloat(v) * k, 0]); else if (c === 20 && pts.length) pts[pts.length - 1][1] = parseFloat(v) * k; }
      const z = num(e, 38) * k; if (num(e, 70) & 1) pts.push(pts[0]);
      if (pts.length >= 2) { if (z === 0) flat++; out.push({ z, points: pts }); }
    } else if (e.type === "POLYLINE") {
      const vs = []; let j = i + 1; for (; j < ents.length && ents[j].type === "VERTEX"; j++) vs.push(ents[j]);
      const pts = vs.map(v => [num(v, 10) * k, num(v, 20) * k, num(v, 30) * k]), z0 = num(e, 30) * k;
      if (pts.length >= 2) {
        const zs = pts.map(p => p[2]), same = Math.max(...zs) - Math.min(...zs) < 1;
        const z = same ? (zs[0] || z0) : null;
        if (z !== null) { if (!z) flat++; out.push({ z, points: pts.map(p => [p[0], p[1]]) }); }
        else out.push(...pts.map(p => ({ z: p[2], points: [[p[0], p[1]]] })));      // a 3D breakline: its points at their heights
      }
      i = j;
    } else if (e.type === "LINE") {
      const a = [num(e, 10) * k, num(e, 20) * k, num(e, 30) * k], b = [num(e, 11) * k, num(e, 21) * k, num(e, 31) * k];
      if (Math.abs(a[2] - b[2]) < 1) { if (!a[2]) flat++; out.push({ z: a[2], points: [[a[0], a[1]], [b[0], b[1]]] }); }
    }
  }
  return { contours: out, flat };
}

/** A roof's underside as a height anywhere under it, and the lines where it folds (so a wall attached to it can
 *  put a corner of its top exactly there): the footprint roof's planes each less its thickness along the slope,
 *  or the single plane. null outside the roof's footprint. */
export function roofUnderside(doc, rf) {
  const outer = F.json(rf, "boundary"); if (!Array.isArray(outer) || outer.length < 3) return null;
  const z0 = levelZ(doc, rf, "level") + F.real(rf, "heightOffset"), th = F.real(rf, "thickness"), es = F.json(rf, "edgeSlopes") || [];
  const O = ccwOf(outer);
  if (es.length) {
    const { regions, at } = roofPlanes(outer, es, z0, F.real(rf, "ridgeHeight"));
    const under = p => { for (const r of regions) if (pointInPoly(p, r.poly)) return at(r.e, p) - th * Math.sqrt(1 + r.e.t * r.e.t); return null; };
    return { under, polys: regions.map(r => r.poly), inside: p => pointInPoly(p, O) };
  }
  const pv = F.point(rf, "pivot"), a = F.real(rf, "pitch") * Math.PI / 180, dA = F.real(rf, "direction") * Math.PI / 180, d = [Math.cos(dA), Math.sin(dA)], k = Math.tan(a), tv = th / Math.cos(a);
  return { under: p => (pointInPoly(p, O) ? z0 + k * ((p[0] - pv[0]) * d[0] + (p[1] - pv[1]) * d[1]) - tv : null), polys: [O], inside: p => pointInPoly(p, O) };
}
/** A wall's top profile under a roof: [distance along the wall, height above its base] at its ends and wherever
 *  the roof folds over it; where the wall runs out from under the roof it keeps `fallback`. */
export function attachedProfile(doc, rf, a, b, z0, fallback) {
  const R = roofUnderside(doc, rf); if (!R) return null;
  const d = sub(b, a), L = Math.hypot(d[0], d[1]); if (!L) return null;
  const ts = new Set([0, 1]);
  for (const poly of R.polys) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], e = sub(q, p), den = d[0] * e[1] - d[1] * e[0]; if (Math.abs(den) < 1e-9) continue;
    const w = sub(p, a), t = (w[0] * e[1] - w[1] * e[0]) / den, s = (w[0] * d[1] - w[1] * d[0]) / den;
    if (t > 1e-6 && t < 1 - 1e-6 && s >= -1e-6 && s <= 1 + 1e-6) ts.add(Math.round(t * 1e6) / 1e6);
  }
  const prof = [...ts].sort((x, y) => x - y).map(t => { const p = [a[0] + d[0] * t, a[1] + d[1] * t], z = R.under(p) ?? R.under([p[0] + (t < 0.5 ? 1 : -1) * d[0] * 1e-4, p[1] + (t < 0.5 ? 1 : -1) * d[1] * 1e-4]);
    return [Math.round(t * L * 10) / 10, z == null ? fallback : Math.max(1, Math.round((z - z0) * 10) / 10)]; });
  return prof;
}
