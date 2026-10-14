//! Towers: a tower massing held as numbers - its height, its storeys, its podium, the size and turn of its
//! plates, its diagrid, its corners, its columns and its core - and the one function that turns those numbers
//! into the faces of a closed solid.
//!
//! The same function runs in two places. Here it gives the Massing element its body, which Web BIM cuts at every
//! level for the slab edges. In the parametric CAD it is carried inside a Script feature (its own source, written
//! out by towerScript) and gives the B-Rep: the faces handed to the kernel are the faces listed here, so the solid
//! the CAD shows and the mesh the building is cut from are one set of faces. That is why `towerGeometry` uses
//! nothing from outside its own body: it has to survive being turned back into text.
//!
//! Two kinds:
//!   diagrid - a plate of four faces with chamfered corners, the faces folded along the diagonals of a diagrid
//!             (one diamond across a face reads as a giant X; four or more as a Hearst-style lattice), the
//!             corner chamfer pushed in (a bird's mouth) or out at each node row, the plate swelling and
//!             narrowing up the height;
//!   twist   - a rounded four-sided plate with two notched corners, rotated storey by storey about a fixed core,
//!             flared at the base and narrowed at the top.
//!
//! Millimetres, degrees, z up. A plate is counter-clockwise seen from above.

import { triangulate } from "./geom2d.js";
import { bridgeHoles } from "./bimsketch.js";

// ---------------------------------------------------------------- parameters
const SHARED = {
  head: [
    { key: "towerHeight", label: "Tower height (to top of crown)", def: 265000, min: 60000, max: 600000, step: 500, unit: "mm" },
    { key: "crownHeight", label: "Crown above the roof level", def: 12000, min: 0, max: 60000, step: 500, unit: "mm" },
    { key: "groundFloorHeight", label: "Ground floor height", def: 9000, min: 3000, max: 20000, step: 100, unit: "mm" },
    { key: "floorToFloor", label: "Floor to floor", def: 4200, min: 3000, max: 7000, step: 50, unit: "mm" },
    { key: "podiumHeight", label: "Podium height (0 = none)", def: 22000, min: 0, max: 80000, step: 100, unit: "mm" },
    { key: "podiumWidth", label: "Podium width (x)", def: 110000, min: 20000, max: 400000, step: 500, unit: "mm" },
    { key: "podiumDepth", label: "Podium depth (y)", def: 72000, min: 20000, max: 400000, step: 500, unit: "mm" },
    { key: "podiumOffsetX", label: "Podium offset x", def: 0, min: -150000, max: 150000, step: 500, unit: "mm" },
    { key: "podiumOffsetY", label: "Podium offset y", def: 0, min: -150000, max: 150000, step: 500, unit: "mm" },
    { key: "plateWidth", label: "Plate width (x) at the base", def: 46000, min: 15000, max: 120000, step: 100, unit: "mm" },
    { key: "plateDepth", label: "Plate depth (y) at the base", def: 46000, min: 15000, max: 120000, step: 100, unit: "mm" },
  ],
  tail: [
    { key: "planRotation", label: "Plan rotation", def: 0, min: -180, max: 180, step: 0.5, unit: "°" },
    { key: "columnSpacing", label: "Perimeter column spacing", def: 9000, min: 3000, max: 18000, step: 100, unit: "mm" },
    { key: "columnSize", label: "Perimeter column diameter", def: 900, min: 300, max: 2000, step: 50, unit: "mm" },
    { key: "columnInset", label: "Column centre in from the facade", def: 1300, min: 400, max: 5000, step: 50, unit: "mm" },
    { key: "coreWidth", label: "Core width (x)", def: 30000, min: 10000, max: 60000, step: 100, unit: "mm" },
    { key: "coreDepth", label: "Core depth (y)", def: 11600, min: 9000, max: 40000, step: 100, unit: "mm" },
    { key: "slabEdgeInset", label: "Slab edge in from the glass line", def: 150, min: -600, max: 1500, step: 10, unit: "mm" },
    { key: "mullionSpacing", label: "Mullion spacing", def: 1500, min: 600, max: 4500, step: 50, unit: "mm" },
  ],
};
const KIND_PARAMS = {
  diagrid: [
    { key: "bellyScale", label: "Plate scale at the widest point", def: 1.06, min: 0.5, max: 1.6, step: 0.01, unit: "" },
    { key: "bellyAt", label: "Widest point (fraction of height)", def: 0.62, min: 0.1, max: 0.9, step: 0.01, unit: "" },
    { key: "topScale", label: "Plate scale at the top", def: 0.86, min: 0.4, max: 1.6, step: 0.01, unit: "" },
    { key: "bulge", label: "Face bulge at the diagrid nodes (+ out)", def: 1200, min: -6000, max: 6000, step: 50, unit: "mm" },
    { key: "diagridBays", label: "Diagrid diamonds across a face", def: 1, min: 1, max: 8, step: 1, unit: "" },
    { key: "diagridStoreys", label: "Storeys between diagrid node rows", def: 13, min: 2, max: 30, step: 1, unit: "" },
    { key: "diagridStart", label: "First node row", options: ["Corner nodes", "Mid-face nodes"], def: 1 },
    { key: "diagridSize", label: "Diagrid member width", def: 900, min: 200, max: 2500, step: 50, unit: "mm" },
    { key: "cornerChamfer", label: "Corner chamfer (each leg)", def: 3500, min: 0, max: 12000, step: 50, unit: "mm" },
    { key: "birdMouth", label: "Bird's mouth: chamfer moved in (+) or out (-)", def: 1600, min: -8000, max: 8000, step: 50, unit: "mm" },
    { key: "birdMouthMode", label: "Bird's mouth at the node rows", options: ["The same at every row", "In and out at alternate rows"], def: 0 },
    { key: "twist", label: "Twist over the height", def: 0, min: -180, max: 180, step: 0.5, unit: "°" },
  ],
  twist: [
    { key: "taper", label: "Narrow side as a share of the wide side", def: 0.82, min: 0.4, max: 1, step: 0.01, unit: "" },
    { key: "sideBow", label: "Sides bowed out by", def: 2600, min: -4000, max: 9000, step: 50, unit: "mm" },
    { key: "cornerRadius", label: "Corner radius", def: 5200, min: 500, max: 15000, step: 50, unit: "mm" },
    { key: "notchWidth", label: "Corner notch opening", def: 5200, min: 0, max: 15000, step: 50, unit: "mm" },
    { key: "notchDepth", label: "Corner notch depth", def: 2600, min: 0, max: 10000, step: 50, unit: "mm" },
    { key: "twist", label: "Twist over the height", def: 52, min: -180, max: 180, step: 0.5, unit: "°" },
    { key: "twistEase", label: "Twist taken low (1 = even)", def: 1.7, min: 0.3, max: 4, step: 0.05, unit: "" },
    { key: "baseFlare", label: "Base flare (extra scale at the foot)", def: 0.2, min: 0, max: 1, step: 0.01, unit: "" },
    { key: "flareHeight", label: "Flare dies out by (fraction of height)", def: 0.22, min: 0.02, max: 0.9, step: 0.01, unit: "" },
    { key: "topScale", label: "Plate scale at the top", def: 0.9, min: 0.4, max: 1.6, step: 0.01, unit: "" },
  ],
};
// the shared parameters' starting values where a kind starts elsewhere (a twisting office tower is lower and finer)
const KIND_DEFAULTS = {
  diagrid: {},
  twist: { towerHeight: 177000, crownHeight: 7000, groundFloorHeight: 6800, floorToFloor: 3900, podiumHeight: 14000, podiumWidth: 124000,
    podiumDepth: 66000, podiumOffsetX: 36000, plateWidth: 46000, plateDepth: 42000, columnSpacing: 8400, columnSize: 800, columnInset: 1500,
    coreWidth: 26000, coreDepth: 11600 },
};
/** The parameters a tower of this kind declares, as the CAD's Script declares them (sliders and switches). */
export function towerSpecs(kind) {
  if (!KIND_PARAMS[kind]) throw new Error(`there is no tower kind "${kind}"`);
  const over = KIND_DEFAULTS[kind] || {};
  return [...SHARED.head, ...KIND_PARAMS[kind], ...SHARED.tail].map(s => (s.key in over ? Object.assign({}, s, { def: over[s.key] }) : s));
}
/** A tower's parameters, every one present and inside its range (defaults for the missing). */
export function towerParams(tower) {
  const specs = towerSpecs(tower.kind), given = tower.params || {}, out = {};
  for (const s of specs) {
    let v = Number.isFinite(given[s.key]) ? given[s.key] : s.def;
    if (s.options) v = Math.max(0, Math.min(s.options.length - 1, Math.round(v)));
    else v = Math.max(s.min, Math.min(s.max, v));
    out[s.key] = v;
  }
  return out;
}

// ---------------------------------------------------------------- the geometry (self-contained: it is also CAD script source)
/** The tower's levels, rows and faces. `kind` and complete parameters `p` (see towerParams). Returns
 *  { levels, roof, podiumLevel, top, rows: [{ z, ring, faces? }], ringFaces, tower: { points, faces },
 *    stub: { points, faces }, podium: { ring, z1 } | null, nodes } - `tower` a closed solid from the first row up
 *  (its bottom cap at the first row), `stub` the same with a prism carried down into the podium (for fusing). */
export function towerGeometry(kind, p) {
  const PI = Math.PI, sin = Math.sin, cos = Math.cos, hyp = Math.hypot;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = u => (1 - cos(PI * clamp(u, 0, 1))) / 2;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
  const unit = v => { const L = hyp(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; };
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const rot = (q, th) => [q[0] * cos(th) - q[1] * sin(th), q[0] * sin(th) + q[1] * cos(th)];

  // ---- storeys: level 0 at the ground, level 1 a ground floor up, then floor to floor; the roof the last level
  // that leaves the crown above it
  const H = p.towerHeight, f2f = p.floorToFloor, g0 = p.groundFloorHeight;
  const levelZ = s => (s === 0 ? 0 : g0 + (s - 1) * f2f);
  let roof = 1; while (levelZ(roof + 1) <= H - p.crownHeight + 1) roof++;
  if (levelZ(roof) > H - 1000) roof = Math.max(1, roof - 1);
  const levels = []; for (let s = 0; s <= roof; s++) levels.push({ index: s, z: levelZ(s) });
  let podiumLevel = 0;
  if (p.podiumHeight > 0 && roof > 2) {
    podiumLevel = 1;
    for (let s = 1; s < roof - 1; s++) if (Math.abs(levelZ(s) - p.podiumHeight) < Math.abs(levelZ(podiumLevel) - p.podiumHeight)) podiumLevel = s;
  }
  const z0 = levelZ(podiumLevel), span = H - z0;

  // ---- rows: where the plate is defined. A diagrid's node rows (every n storeys, the last at the top); a twisting
  // tower's every level
  const rows = [];
  if (kind === "diagrid") {
    const n = Math.max(1, Math.round(p.diagridStoreys));
    for (let s = podiumLevel; levelZ(s) < H - 0.5 * n * f2f; s += n) rows.push({ z: levelZ(s), storey: s });
    rows.push({ z: H, storey: null });
  } else {
    for (let s = podiumLevel; s <= roof; s++) rows.push({ z: levelZ(s), storey: s });
    rows.push({ z: H, storey: null });
  }
  const K = rows.length - 1;

  // ---- the plate at each row
  let ringFaces = [];               // [{ from, to }] vertex-index runs of the faces (diagrid); one closed run (twist)
  let N = 0;
  const base = rows.map(r => (r.z - z0) / span);
  if (kind === "diagrid") {
    const B = Math.max(1, Math.round(p.diagridBays)), J = 2 * B, startOdd = Math.round(p.diagridStart) === 1 ? 1 : 0;
    const chamfered = p.cornerChamfer >= 50;
    const m = chamfered ? J + 2 : J;                         // points per face block
    N = 4 * m;
    const node = (k, j) => (k + j + startOdd) % 2 === 0;
    const scaleAt = t => (t <= p.bellyAt ? 1 + (p.bellyScale - 1) * ease(t / p.bellyAt) : p.bellyScale + (p.topScale - p.bellyScale) * ease((t - p.bellyAt) / (1 - p.bellyAt)));
    for (let k = 0; k <= K; k++) {
      const t = base[k], s = scaleAt(t), hx = p.plateWidth / 2 * s, hy = p.plateDepth / 2 * s;
      const th = (p.planRotation + p.twist * t) * PI / 180;
      const c = chamfered ? Math.min(p.cornerChamfer, 0.4 * Math.min(hx, hy)) : 0;
      const C = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
      const ring = new Array(N);
      const dk = p.birdMouth * (Math.round(p.birdMouthMode) === 1 && k % 2 === 1 ? -1 : 1);
      for (let f = 0; f < 4; f++) {
        const a = C[f], b = C[(f + 1) % 4], d = unit(sub(b, a)), nOut = [d[1], -d[0]];
        const S = add(a, mul(d, c)), E = sub(b, mul(d, c));
        const pts = [];
        for (let j = 0; j <= J; j++) {
          const q = lerp2(S, E, j / J);
          pts.push(node(k, j) ? add(q, mul(nOut, p.bulge * sin(PI * j / J))) : q);
        }
        // between two nodes the face is straight: a big triangle of the diagrid is one flat facet
        for (let j = 1; j < J; j++) if (!node(k, j)) pts[j] = lerp2(pts[j - 1], pts[j + 1], 0.5);
        const take = chamfered ? J + 1 : J;
        for (let j = 0; j < take; j++) ring[f * m + j] = pts[j];
        if (chamfered) {
          // the corner: the chamfer's middle moved along the corner's inward bisector
          const b2 = C[(f + 2) % 4], d2 = unit(sub(b2, b)), n2 = [d2[1], -d2[0]];
          const S2 = add(b, mul(d2, c)), mid = lerp2(E, S2, 0.5), inward = unit([-(nOut[0] + n2[0]), -(nOut[1] + n2[1])]);
          ring[f * m + J + 1] = add(mid, mul(inward, dk));
        }
      }
      rows[k].ring = ring.map(q => rot(q, th));
    }
    for (let f = 0; f < 4; f++) ringFaces.push({ from: f * m, to: f * m + J, wrap: !chamfered });
    rows.meta = { B, J, m, chamfered, startOdd };
  } else {
    // a rounded four-sided plate: the side toward -y narrowed by the taper, the sides bowed out, corners rounded,
    // two opposite corners (+x -y and -x +y) cut by a notch
    const nC = 7, nS = 8;
    N = 4 * (nC + nS);
    const plate = (w, d) => {
      const C = [[-w / 2 * p.taper, -d / 2], [w / 2 * p.taper, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
      const sideAt = (f, u) => {          // a point on side f at u (0..1), bowed out at the middle
        const a = C[f], b = C[(f + 1) % 4], dd = unit(sub(b, a)), nOut = [dd[1], -dd[0]];
        return add(lerp2(a, b, u), mul(nOut, p.sideBow * 4 * u * (1 - u)));
      };
      const out = [];
      for (let f = 0; f < 4; f++) {
        const a = C[f], b = C[(f + 1) % 4], L = hyp(b[0] - a[0], b[1] - a[1]);
        const r = clamp(p.cornerRadius, 1, 0.3 * L) / L;
        // the corner at the start of side f: from the end of side f-1 to the start of side f
        const pf = (f + 3) % 4, Lp = hyp(C[f][0] - C[pf][0], C[f][1] - C[pf][1]), rp = clamp(p.cornerRadius, 1, 0.3 * Lp) / Lp;
        const P0 = sideAt(pf, 1 - rp), P1 = sideAt(f, r), Q = C[f];
        const notched = (f === 1 || f === 3) && p.notchDepth > 1 && p.notchWidth > 1;
        if (notched) {
          // the notch: a slot cut into the corner along its bisector, opening notchWidth wide, notchDepth deep
          const inward = unit(sub([0, 0], Q)), across = [-inward[1], inward[0]];
          const mouth = add(lerp2(P0, P1, 0.5), mul(inward, 0));
          const half = Math.min(p.notchWidth / 2, 0.45 * hyp(P1[0] - P0[0], P1[1] - P0[1]));
          const m0 = add(mouth, mul(across, half)), m1 = add(mouth, mul(across, -half));
          const [ma, mb] = hyp(m0[0] - P0[0], m0[1] - P0[1]) < hyp(m1[0] - P0[0], m1[1] - P0[1]) ? [m0, m1] : [m1, m0];
          const poly = [P0, ma, add(ma, mul(inward, p.notchDepth)), add(mb, mul(inward, p.notchDepth)), mb, P1];
          const lens = []; let tot = 0; for (let i = 0; i < poly.length - 1; i++) { const l = hyp(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]); lens.push(l); tot += l; }
          // nC points: the polyline's own corners first, then the longest pieces halved, so the slot keeps its square corners
          const pts = poly.slice(0, 5);
          while (pts.length < nC) {
            let bi = 0, bl = -1; for (let i = 0; i < pts.length; i++) { const q = i + 1 < pts.length ? pts[i + 1] : P1, l = hyp(q[0] - pts[i][0], q[1] - pts[i][1]); if (l > bl) { bl = l; bi = i; } }
            const q = bi + 1 < pts.length ? pts[bi + 1] : P1; pts.splice(bi + 1, 0, lerp2(pts[bi], q, 0.5));
          }
          out.push(...pts.slice(0, nC));
        } else {
          for (let i = 0; i < nC; i++) { const u = i / nC; out.push(add(add(mul(P0, (1 - u) * (1 - u)), mul(Q, 2 * u * (1 - u))), mul(P1, u * u))); }
        }
        // the side's own points from the end of the rounding to the start of the next corner's
        const pn = (f + 1) % 4, Ln = hyp(C[(f + 2) % 4][0] - C[pn][0], C[(f + 2) % 4][1] - C[pn][1]), rn = clamp(p.cornerRadius, 1, 0.3 * L) / L;
        void Ln;
        for (let i = 0; i < nS; i++) out.push(sideAt(f, r + (1 - rn - r) * i / nS));
      }
      return out;
    };
    const scaleAt = t => (1 + (t < p.flareHeight ? p.baseFlare * Math.pow(1 - t / p.flareHeight, 2) : 0)) * (1 + (p.topScale - 1) * t);
    const turnAt = t => p.twist * (1 - Math.pow(1 - clamp(t, 0, 1), p.twistEase));
    for (let k = 0; k <= K; k++) {
      const t = base[k], s = scaleAt(t), th = (p.planRotation + turnAt(t)) * PI / 180;
      rows[k].ring = plate(p.plateWidth * s, p.plateDepth * s).map(q => rot(q, th));
    }
    ringFaces = [{ from: 0, to: N, closed: true }];
  }

  // ---- faces: indices into points (row k, vertex i at k * N + i); each face a counter-clockwise ring seen from outside
  const points = [];
  for (const r of rows) for (const q of r.ring) points.push([q[0], q[1], r.z]);
  const I = (k, i) => k * N + ((i % N) + N) % N;
  const faces = [];
  const nodes = [];                                   // the diagrid's members: [k, faceIndex, j] to [k + 1, faceIndex, j']
  if (kind === "diagrid") {
    const { J, m, chamfered, startOdd } = rows.meta;
    const node = (k, j) => (k + j + startOdd) % 2 === 0;
    for (let k = 0; k < K; k++) for (let f = 0; f < 4; f++) {
      const V = (kk, j) => I(kk, f * m + j);           // j = J on an unchamfered face wraps to the next face's first point
      for (let j = 0; j + 2 <= J; j++) {
        if (node(k, j)) faces.push([V(k, j), V(k, j + 1), V(k, j + 2), V(k + 1, j + 1)]);
        if (node(k + 1, j)) faces.push([V(k + 1, j + 2), V(k + 1, j + 1), V(k + 1, j), V(k, j + 1)]);
      }
      if (node(k, 0)) faces.push([V(k, 0), V(k + 1, 1), V(k + 1, 0)]); else faces.push([V(k, 0), V(k, 1), V(k + 1, 0)]);
      if (node(k, J)) faces.push([V(k, J), V(k + 1, J), V(k + 1, J - 1)]); else faces.push([V(k, J - 1), V(k, J), V(k + 1, J)]);
      if (chamfered) {
        const A = j => V(j, J), Vc = j => V(j, J + 1), Bn = j => I(j, ((f + 1) % 4) * m);
        faces.push([A(k), Vc(k), Vc(k + 1)], [A(k), Vc(k + 1), A(k + 1)], [Vc(k), Bn(k), Bn(k + 1)], [Vc(k), Bn(k + 1), Vc(k + 1)]);
      }
      for (let j = 0; j <= J; j++) if (node(k, j)) for (const dj of [-1, 1]) if (j + dj >= 0 && j + dj <= J) nodes.push({ a: V(k, j), b: V(k + 1, j + dj), face: f });
    }
  } else {
    for (let k = 0; k < K; k++) for (let i = 0; i < N; i++) faces.push([I(k, i), I(k, i + 1), I(k + 1, i + 1)], [I(k, i), I(k + 1, i + 1), I(k + 1, i)]);
  }
  const top = []; for (let i = 0; i < N; i++) top.push(I(K, i));
  const bottom = []; for (let i = N - 1; i >= 0; i--) bottom.push(I(0, i));
  const tower = { points, faces: faces.concat([top, bottom]) };

  // ---- the podium: a block the tower stands in; kept round the tower's foot with 3 m to spare
  let podium = null;
  if (podiumLevel > 0) {
    let x0 = p.podiumOffsetX - p.podiumWidth / 2, x1 = p.podiumOffsetX + p.podiumWidth / 2, y0 = p.podiumOffsetY - p.podiumDepth / 2, y1 = p.podiumOffsetY + p.podiumDepth / 2;
    for (const q of rows[0].ring) { x0 = Math.min(x0, q[0] - 3000); x1 = Math.max(x1, q[0] + 3000); y0 = Math.min(y0, q[1] - 3000); y1 = Math.max(y1, q[1] + 3000); }
    podium = { ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z1: z0 };
  }
  // ---- the same tower carried down into the podium as a prism, so the two fuse into one solid without touching faces
  let stub = tower;
  if (podium) {
    const zs = z0 / 2, extra = rows[0].ring.map(q => [q[0], q[1], zs]), off = points.length;
    const sp = points.concat(extra), sf = faces.concat([top]);
    for (let i = 0; i < N; i++) sf.push([off + i, off + (i + 1) % N, I(0, i + 1), I(0, i)]);
    const sb = []; for (let i = N - 1; i >= 0; i--) sb.push(off + i);
    sf.push(sb);
    stub = { points: sp, faces: sf };
  }
  return { kind, levels, roof, podiumLevel, top: H, z0, rows: rows.map(r => ({ z: r.z, storey: r.storey, ring: r.ring })), N, ringFaces, tower, stub, podium, nodes };
}

// ---------------------------------------------------------------- the body Web BIM cuts
/** The tower and podium as one closed triangle mesh { positions, index }: the tower's faces fanned (they are flat, or
 *  triangles already), the podium a block whose top is holed where the tower stands. */
export function towerMesh(G) {
  const P = [], I = [];
  const put = q => { P.push(q[0], q[1], q[2]); return P.length / 3 - 1; };
  const T = G.tower, base = T.points.map(put);
  const bottomFace = T.faces[T.faces.length - 1];
  for (const fc of T.faces) {
    if (G.podium && fc === bottomFace) continue;
    const idx = fc.map(i => base[i]);
    if (idx.length === 3) { I.push(idx[0], idx[1], idx[2]); continue; }
    // flat faces with a collinear point (a diagrid facet) fan cleanly from that point's neighbour; caps are clipped
    if (idx.length === 4) { I.push(idx[0], idx[1], idx[3], idx[1], idx[2], idx[3]); continue; }
    const ring = fc.map(i => [T.points[i][0], T.points[i][1]]);
    for (const [a, b, c] of triangulate(ring)) {
      const A = idx[a], B = idx[b], C = idx[c];
      // keep the face's own winding (a cap seen from below runs clockwise in plan)
      const area = (ring[b][0] - ring[a][0]) * (ring[c][1] - ring[a][1]) - (ring[b][1] - ring[a][1]) * (ring[c][0] - ring[a][0]);
      // the clipper hands triangles back counter-clockwise; a collinear point's sliver keeps that order, so it closes
      const want = fc === bottomFace ? -1 : 1, sign = Math.abs(area) < 1e-3 ? 1 : Math.sign(area);
      if (sign === want) I.push(A, B, C); else I.push(A, C, B);
    }
  }
  if (G.podium) {
    const r = G.podium.ring, z1 = G.podium.z1, lo = r.map(q => put([q[0], q[1], 0])), hi = r.map(q => put([q[0], q[1], z1]));
    I.push(lo[0], lo[2], lo[1], lo[0], lo[3], lo[2]);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; I.push(lo[i], lo[j], hi[j], lo[i], hi[j], hi[i]); }
    // the podium roof: the block's top with the tower's foot taken out, joined to the tower's first row
    const foot = G.rows[0].ring, footIdx = foot.map((q, i) => base[i]);
    const hole = foot.slice().reverse(), holeIdx = footIdx.slice().reverse();
    const poly = bridgeHoles(r.slice(), [hole]);
    const key = q => Math.round(q[0] * 10) + "," + Math.round(q[1] * 10);
    const lookup = new Map(); r.forEach((q, i) => lookup.set(key(q), hi[i])); hole.forEach((q, i) => lookup.set(key(q), holeIdx[i]));
    for (const [a, b, c] of triangulate(poly)) {
      const A = lookup.get(key(poly[a])), B = lookup.get(key(poly[b])), C = lookup.get(key(poly[c]));
      if (A === B || B === C || A === C) continue;
      // slivers on the tower's collinear points are kept in the clipper's order: they close the roof against the facets
      const area = (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
      if (area < -1e-3) I.push(A, C, B); else I.push(A, B, C);
    }
  }
  return { positions: P, index: I };
}

// ---------------------------------------------------------------- the CAD's copy
/** The Script feature's source: the parameters as sliders and switches, and a build that hands the kernel the faces
 *  of towerGeometry (carried in as text) and fuses the podium on. `place` puts it where the Massing stands. */
export function towerScript(kind, place = {}) {
  const specs = towerSpecs(kind).map(s => Object.assign({}, s));
  const at = { x: place.x || 0, y: place.y || 0, z: place.z || 0, rotation: place.rotation || 0 };
  return `({
  // ${kind === "diagrid" ? "A diagrid tower: four faces folded on the diagonals, corners chamfered into a bird's mouth" : "A twisting tower: a rounded, notched plate turned storey by storey about a fixed core"}.
  // One closed solid. Web BIM cuts the same faces at every level for the slab edges.
  params: ${JSON.stringify(specs)},
  build(p, k) {
    const G = (${towerGeometry.toString()})(${JSON.stringify(kind)}, p);
    let solid = k.polyhedron(G.stub.points, G.stub.faces);
    if (G.podium) {
      const r = G.podium.ring;
      solid = k.fuse(solid, k.prism(k.face(k.polyline(r.map(q => [q[0], q[1], 0]), { closed: true })), [0, 0, G.podium.z1]));
    }
    const at = ${JSON.stringify(at)};
    if (at.rotation) solid = k.rotate(solid, at.rotation);
    if (at.x || at.y || at.z) solid = k.move(solid, [at.x, at.y, at.z]);
    return solid;
  }
})`;
}

// ---------------------------------------------------------------- reading the tower back
/** The plate ring at height z, vertex for vertex (rows interpolated): the setting-out line for columns and mullions. */
export function towerRingAt(G, z) {
  const R = G.rows; if (z <= R[0].z) return R[0].ring.map(q => q.slice());
  for (let k = 0; k < R.length - 1; k++) if (z <= R[k + 1].z) {
    const t = (z - R[k].z) / (R[k + 1].z - R[k].z || 1);
    return R[k].ring.map((q, i) => [q[0] + (R[k + 1].ring[i][0] - q[0]) * t, q[1] + (R[k + 1].ring[i][1] - q[1]) * t]);
  }
  return R[R.length - 1].ring.map(q => q.slice());
}
/** Runs of a ring as polylines: each face of a diagrid plate (its chamfer points at the ends), or the whole twisting plate closed. */
export function ringRuns(G, ring) {
  return G.ringFaces.map(rf => {
    if (rf.closed) return { pts: ring.concat([ring[0]]), closed: true };
    const pts = []; for (let i = rf.from; i <= rf.to; i++) pts.push(ring[i % ring.length]);
    return { pts, closed: false };
  });
}
const runLen = pts => pts.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
/** The point at arc-length fraction u along a polyline, and the run's outward normal there (counter-clockwise ring). */
export function alongRun(pts, u) {
  const L = runLen(pts); let need = Math.max(0, Math.min(1, u)) * L;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (need <= l || i === pts.length - 1) { const t = l > 0 ? Math.min(1, need / l) : 0, d = l > 0 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [1, 0]; return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], n: [d[1], -d[0]] }; }
    need -= l;
  }
  return { at: pts[0].slice(), n: [0, -1] };
}
/** Where the perimeter columns stand on a ring: per face, the count fixed by the first row's face length, so a
 *  column keeps its place in the run from storey to storey. */
export function columnStations(G, p) {
  const runs0 = ringRuns(G, G.rows[0].ring);
  return runs0.map(r => { const L = runLen(r.pts); const n = Math.max(1, Math.round(L / p.columnSpacing)); return Array.from({ length: n }, (_, i) => (r.closed ? i / n : (i + 0.5) / n)); });
}
/** Mullion stations on each run: one every mullionSpacing at the first row, held as fractions up the height. */
export function mullionStations(G, p) {
  const runs0 = ringRuns(G, G.rows[0].ring);
  return runs0.map(r => { const L = runLen(r.pts), n = Math.max(1, Math.round(L / p.mullionSpacing)); return Array.from({ length: r.closed ? n : n + 1 }, (_, i) => i / n); });
}

// ---------------------------------------------------------------- the core
/** The core: a lobby spine across it, a bank of lifts each side, a stair and a WC block at each end. Walls as
 *  centrelines with thickness, door positions on them, and the shafts the floors leave open. Plan coordinates of
 *  the tower (before the Massing's own placement), turned by the plan rotation only: the core does not twist. */
export function towerCore(p) {
  const W = p.coreWidth, D = p.coreDepth, to = 500, ti = 250, x0 = -W / 2, x1 = W / 2, y0 = -D / 2, y1 = D / 2;
  const spine = 1800;                                           // half the lobby's clear width, near enough
  const ez = Math.min(7500, Math.max(5000, W * 0.24));           // end zones: stair and WCs
  const xa = x0 + ez, xb = x1 - ez;
  const lifts = Math.max(2, Math.floor((xb - xa) / 2600));
  const lw = (xb - xa) / lifts;
  const walls = [], doors = [], shafts = [], rooms = [], stairs = [];
  const W_ = (a, b, t, role) => { walls.push({ a, b, t, role }); return walls.length - 1; };
  // the outer walls on the core's outline, inside it by half their thickness
  const ox0 = x0 + to / 2, ox1 = x1 - to / 2, oy0 = y0 + to / 2, oy1 = y1 - to / 2;
  const S = W_([ox0, oy0], [ox1, oy0], to, "core"), E = W_([ox1, oy0], [ox1, oy1], to, "core"), Nn = W_([ox1, oy1], [ox0, oy1], to, "core"), Wst = W_([ox0, oy1], [ox0, oy0], to, "core");
  void S; void Nn;
  // the spine walls: the lobby between them runs the core's width and opens at both ends
  const sN = W_([ox0, spine + ti / 2], [ox1, spine + ti / 2], ti, "spine"), sS = W_([ox0, -spine - ti / 2], [ox1, -spine - ti / 2], ti, "spine");
  // the lift shafts: dividers across each band, the end-zone walls at xa and xb
  for (const [band, y, ye] of [["N", spine + ti, oy1 - to / 2], ["S", -spine - ti, oy0 + to / 2]]) {
    for (const x of [xa, xb]) W_([x, y], [x, ye], ti, "shaft");
    for (let i = 1; i < lifts; i++) W_([xa + i * lw, y], [xa + i * lw, ye], ti, "shaft");
    for (let i = 0; i < lifts; i++) {
      const cx = xa + (i + 0.5) * lw, lo = Math.min(y, ye), hi = Math.max(y, ye);
      shafts.push({ kind: "Lift", ring: [[xa + i * lw + ti / 2, lo], [xa + (i + 1) * lw - ti / 2, lo], [xa + (i + 1) * lw - ti / 2, hi], [xa + i * lw + ti / 2, hi]] });
      doors.push({ wall: band === "N" ? sN : sS, u: cx - ox0, w: 1100, h: 2400, kind: "Lift", into: band });
      rooms.push({ name: "Lift", number: `L${band === "N" ? i + 1 : lifts + i + 1}`, at: [cx, (lo + hi) / 2], kind: "Lift" });
    }
  }
  // the end zones: a stair north-west and south-east, WCs south-west and north-east; each opens off the spine
  const zones = [
    { x0: ox0 + to / 2, x1: xa - ti / 2, band: "N", kind: "Stair", name: "Stair 1" },
    { x0: ox0 + to / 2, x1: xa - ti / 2, band: "S", kind: "WC", name: "WC (women)" },
    { x0: xb + ti / 2, x1: ox1 - to / 2, band: "N", kind: "WC", name: "WC (men)" },
    { x0: xb + ti / 2, x1: ox1 - to / 2, band: "S", kind: "Stair", name: "Stair 2" },
  ];
  for (const z of zones) {
    const lo = z.band === "N" ? spine + ti : oy0 + to / 2, hi = z.band === "N" ? oy1 - to / 2 : -spine - ti, cx = (z.x0 + z.x1) / 2;
    if (z.kind === "Stair") {
      shafts.push({ kind: "Stair", ring: [[z.x0, lo], [z.x1, lo], [z.x1, hi], [z.x0, hi]] });
      // a dog-leg: up along the spine side, a half landing at the far end, back along the outer wall; the floor's
      // landing at the door's end. Flights 1400 wide with the well between them
      const W = Math.min(1400, (Math.abs(hi - lo) - 200) / 2), nearSpine = z.band === "N" ? lo : hi, far = z.band === "N" ? hi : lo, sg = z.band === "N" ? 1 : -1;
      stairs.push({ name: z.name, x0: z.x0 + 1500, xEnd: z.x1 - W - 100, yUp: nearSpine + sg * (W / 2 + 50), yDown: far - sg * (W / 2 + 50), width: W });
    }
    doors.push({ wall: z.band === "N" ? sN : sS, u: (z.kind === "Stair" ? z.x0 + 1100 : z.x1 - 1100) - ox0, w: 1000, h: 2200, kind: z.kind, into: z.band });
    rooms.push({ name: z.kind === "WC" ? "WC" : z.name, number: z.kind === "WC" ? (z.name.includes("women") ? "W1" : "W2") : `S${z.name.slice(-1)}`, at: [cx, (lo + hi) / 2], kind: z.kind });
  }
  rooms.push({ name: "Lobby", number: "01", at: [(xa + lw * Math.min(1.5, lifts / 2)) / 2, 0], kind: "Lobby" });
  // the spine's ends open onto the floor plate
  doors.push({ wall: Wst, u: oy1, w: 2 * spine - 400, h: 2700, kind: "Lobby entrance" }, { wall: E, u: -oy0, w: 2 * spine - 400, h: 2700, kind: "Lobby entrance" });
  const th = p.planRotation * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const R = q => [q[0] * c - q[1] * s, q[0] * s + q[1] * c];
  return { W, D, spine, lifts, lw, xa, xb,
    walls: walls.map(w => ({ a: R(w.a), b: R(w.b), t: w.t, role: w.role })),
    doors, shafts: shafts.map(sh => ({ kind: sh.kind, ring: sh.ring.map(R) })), rooms: rooms.map(r => Object.assign({}, r, { at: R(r.at) })),
    stairs: stairs.map(st => Object.assign({}, st, { up: [R([st.x0, st.yUp]), R([st.xEnd, st.yUp])], down: [R([st.xEnd, st.yDown]), R([st.x0, st.yDown])] })),
    outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(R), rotate: R };
}
