//! Hotels test fit: three hotel plates on the site lines they were drawn against, each with a typical guest
//! floor laid out the classical way - rooms ringing the facade 7 m deep, a corridor inside them, and the core
//! (or, in the largest plate, an atrium) in the middle. Work in progress: enough to read as a believable
//! key count and plan, not a design.
//!
//! The plates are the client's own outlines, read off their site drawing: Hotel 1 24 × 39 m, Hotel 2 25 × 32 m,
//! Hotel 3 30 × 43 m, each with its inner ring (the corridor line) and innermost rectangle (core; atrium in
//! Hotel 3). Positions and angles come from that drawing at 2.75 px per metre, so they are good to about
//! half a metre; the sizes are the dimensioned ones.
//!
//! Coordinates in mm: x east, y north, origin moved near the plates.

import { newDocument } from "./bim.js";
import { VS_PRESENTATION } from "./library.js";
import { Editor } from "./ops.js";

const HOTEL_ORIGIN = [200000, -300000];          // subtracted from the drawing's coordinates
const HOTEL_PLATES = [
  // name, centre (drawing mm), long-axis angle (deg, from east), outer W × L, corridor ring Wc × Lc, inner Wk × Lk, centre use
  { key: "H1", name: "Hotel 1", centre: [177637, -53616], angle: 86.8, W: 24000, L: 39000, Wc: 10000, Lc: 25000, Wk: 4000, Lk: 18000, middle: "core" },
  { key: "H2", name: "Hotel 2", centre: [236145, -351564], angle: 115.5, W: 25000, L: 32000, Wc: 11000, Lc: 18000, Wk: 5000, Lk: 13000, middle: "core" },
  { key: "H3", name: "Hotel 3", centre: [212617, -481317], angle: 124.3, W: 30000, L: 43000, Wc: 16000, Lc: 29000, Wk: 10000, Lk: 23500, middle: "atrium" },
];
// the two red site lines of the drawing (px → mm at 2.75 px/m, y down → north up)
const HOTEL_SITE_LINES = [
  [[578, 0], [546, 108], [565, 250], [537, 462], [628, 688], [742, 775], [868, 980], [891, 1197], [992, 1300], [848, 1448]],
  [[610, 0], [578, 112], [597, 248], [570, 458], [655, 668], [768, 753], [900, 968], [921, 1183], [1038, 1300], [893, 1448]],
];
const HOTEL_BAY = 4000, HOTEL_BATH_D = 2300, HOTEL_BATH_W = 1800, HOTEL_SUITE_STRIP = 1200, HOTEL_CLEAR = 3200;

export function buildHotelsSample() {
  const doc = newDocument("Hotels Test Fit");
  const ed = new Editor(doc);
  const add = (element) => { const r = ed.apply({ op: "add", element }, { regenerate: false }); if (!r.ok) throw new Error(`${element.id || element.type}: ${r.error}`); return r.id; };
  const line = (a, b) => ({ type: "line", start: a, end: b });
  const rnd = p => [Math.round(p[0]), Math.round(p[1])];
  add({ id: "L1", type: "Level", name: "Typical Guest Floor", args: { name: "Typical Guest Floor", elevation: 0 } });
  doc.meta.name = "Hotels Test Fit";
  // the plan graphics of a hotel brochure plan: black poché, warm grey keys, paler corridors, darker cores
  const VS_H = JSON.parse(JSON.stringify(VS_PRESENTATION));
  Object.assign(VS_H, { name: "Hotel test fit" });
  VS_H.byCategory.IfcWall = { materialPriority: "view", cut: { fill: "#161616", pattern: "solid", pen: "none", detailLevel: "Coarse" }, projection: { pen: "hairline", colour: "#9A968C" }, beyond: { pen: "gossamer", colour: "#C9C5BB", lineType: "dashed2" } };
  VS_H.byCategory.IfcDoor = { cut: { pen: "hairline", colour: "#3A3A3A" }, projection: { pen: "hairline", colour: "#3A3A3A" }, swing: { pen: "gossamer", colour: "#6E6A61" } };
  VS_H.byCategory.IfcSpace = { fill: "#FFFFFF", label: { height: 1.8, colour: "#2B2B2B", align: "centre", content: "{Name}" } };
  VS_H.byCategory.Furniture = { projection: { pen: "gossamer", colour: "#7C776B", fill: "none" } };
  VS_H.byCategory.Annotation = { visible: true };
  VS_H.byCategory.IfcSlab = { visible: false };
  VS_H.rules = [
    { id: "FL-HOTEL-PART", when: { param: "Function", is: "Interior" }, then: { cut: { fill: "#161616", pen: "none" } } },
    { id: "FL-HOTEL-KEYS", when: { param: "Department", is: "Guest room" }, then: { fill: "#C9C7B1" } },
    { id: "FL-HOTEL-CIRC", when: { param: "Department", is: "Circulation" }, then: { fill: "#F4F3E8" } },
    { id: "FL-HOTEL-CORE", when: { param: "Department", is: "Core" }, then: { fill: "#A9A794" } },
    { id: "FL-HOTEL-BATH", when: { param: "Department", is: "Bath" }, then: { fill: "#DEDCCD" } },
    { id: "FL-HOTEL-VOID", when: { param: "Department", is: "Atrium" }, then: { fill: "#FFFFFF" } },
  ];
  doc.lib.viewStyles["VS-HOTEL"] = VS_H;

  const vr = (top, cut, bottom, depth) => ({ top, cut, bottom, depth });
  const sitePx = HOTEL_SITE_LINES.flat().map(([x, y]) => [x * 1000 / 2.75 - HOTEL_ORIGIN[0], -y * 1000 / 2.75 - HOTEL_ORIGIN[1]]);
  const xs = sitePx.map(p => p[0]), ys = sitePx.map(p => p[1]);
  const siteRect = [Math.min(...xs) - 45000, Math.min(...ys) - 15000, Math.max(...xs) + 70000, Math.max(...ys) + 35000].map(Math.round);
  add({ id: "V-SITE", type: "PlanView", name: "Site — Hotels Test Fit", args: { level: { ref: "L1" }, scale: 1500, viewRange: vr(2300, 1200, -500, -500), detailLevel: "Coarse", style: { ref: "VS-HOTEL" }, clip: { rect: siteRect, visible: false, active: true } } });
  HOTEL_SITE_LINES.forEach((pts, i) => {
    const q = pts.map(([x, y]) => rnd([x * 1000 / 2.75 - HOTEL_ORIGIN[0], -y * 1000 / 2.75 - HOTEL_ORIGIN[1]]));
    for (let k = 0; k + 1 < q.length; k++) add({ id: `DL-SITE${i + 1}-${k + 1}`, type: "DetailLine", args: { curve: line(q[k], q[k + 1]), pen: "medium", lineStyle: "Hidden", view: { ref: "V-SITE" }, layer: "Site line", colour: "#E8222B" } });
  });
  const text = (id, content, at, view, tt = "TT-25", wrap = 60) => add({ id, type: "Text", args: { content, position: rnd(at), rotation: 0, textType: { ref: tt }, wrapWidth: wrap, leaders: [], view: { ref: view } } });
  text("TX-WIP", "WORK IN PROGRESS — HOTEL TEST FIT, TYPICAL GUEST FLOOR", [siteRect[0] + 5000, siteRect[3] - 8000], "V-SITE", "TT-35", 70);

  const summary = [];
  for (const H of HOTEL_PLATES) {
    const k = H.key, th = H.angle * Math.PI / 180, C = [H.centre[0] - HOTEL_ORIGIN[0], H.centre[1] - HOTEL_ORIGIN[1]];
    const ev = [Math.cos(th), Math.sin(th)], eu = [Math.sin(th), -Math.cos(th)];
    const P = (u, v) => rnd([C[0] + u * eu[0] + v * ev[0], C[1] + u * eu[1] + v * ev[1]]);
    const { W, L, Wc, Lc, Wk, Lk } = H;
    const view = `V-${k}`;
    const corners = [P(-W / 2, -L / 2), P(W / 2, -L / 2), P(W / 2, L / 2), P(-W / 2, L / 2)];
    const bx = corners.map(p => p[0]), by = corners.map(p => p[1]);
    add({ id: view, type: "PlanView", name: `${H.name} — Typical Guest Floor (test fit)`, args: { level: { ref: "L1" }, scale: 250, viewRange: vr(2300, 1200, -500, -500), detailLevel: "Medium", style: { ref: "VS-HOTEL" }, clip: { rect: [Math.min(...bx) - 6000, Math.min(...by) - 6000, Math.max(...bx) + 6000, Math.max(...by) + 6000], visible: false, active: true } } });
    let n = 0;
    const wall = (name, a, b, type, extra = {}) => add({ id: `${k}-W${++n}`, type: "Wall", name, args: Object.assign({ centreline: line(P(...a), P(...b)), mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: "L1" }, baseOffset: 0, height: HOTEL_CLEAR, flipped: false }, extra), params: { Phase: "New", Comments: "Test fit - work in progress" } });
    const rect = (name, w, l, type, extra) => [wall(`${name} 1`, [-w / 2, -l / 2], [w / 2, -l / 2], type, extra), wall(`${name} 2`, [w / 2, -l / 2], [w / 2, l / 2], type, extra), wall(`${name} 3`, [w / 2, l / 2], [-w / 2, l / 2], type, extra), wall(`${name} 4`, [-w / 2, l / 2], [-w / 2, -l / 2], type, extra)];
    const facade = rect("Facade", W, L, "T-EXTCAV300");
    const ring = rect("Corridor wall", Wc, Lc, "T-BLOCK215");
    // ring walls run: 0 along v=-Lc/2 (u -→+), 1 along u=+Wc/2 (v -→+), 2 along v=+Lc/2 (u +→-), 3 along u=-Wc/2 (v +→-)
    const ringAt = (side, s) => side === "u" ? (s > 0 ? [ring[1], v => v + Lc / 2] : [ring[3], v => Lc / 2 - v]) : (s > 0 ? [ring[2], u => Wc / 2 - u] : [ring[0], u => u + Wc / 2]);
    let op = 0, keys = 0;
    const door = (host, at, flip) => { const oid = `${k}-OP${++op}`; add({ id: oid, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at: Math.round(at), sill: 0, w: 915, h: 2100 }, farProfile: null, depth: "through" } }); add({ id: `${k}-D${op}`, type: "Door", args: { fills: { ref: oid }, doorType: { ref: "T-DOOR915" }, flipHand: !!flip, flipFacing: true, clearance: "None" }, params: { Phase: "New" } }); };
    let sp = 0;
    const space = (name, uv, dept, number) => add({ id: `${k}-SP${++sp}`, type: "Space", name: name || "Bath", args: { level: { ref: "L1" }, upperLimit: { mode: "offset", offset: HOTEL_CLEAR }, anchor: P(...uv), boundaryAt: "finishFace" }, params: Object.assign({ Number: number || "", Department: dept, Occupancy: dept === "Guest room" ? 2 : 0 }, name ? {} : { LabelFormat: " " }) });
    let fu = 0;
    const furn = (shape, uv, size, along) => add({ id: `${k}-FU${++fu}`, type: "Furniture", args: { position: P(...uv), shape, size, rotation: Math.round(((along ? H.angle : H.angle - 90) + 360) % 360), level: { ref: "L1" } } });
    // a standard key: the corridor face at depth 0, the facade at depth D; across it from a to b. `uvOf(depth, across)`.
    const keyRoom = (uvOf, a, b, D, bathAtA, hostRing, ringPos, alongIsV, label) => {
      const sgn = b > a ? 1 : -1, wB = bathAtA ? a : b, other = bathAtA ? b : a, dir = bathAtA ? sgn : -sgn, bx = wB + dir * HOTEL_BATH_W;
      wall(`${label} bath`, uvOf(HOTEL_BATH_D, wB), uvOf(HOTEL_BATH_D, bx), "T-PART100");
      wall(`${label} bath side`, uvOf(0, bx), uvOf(HOTEL_BATH_D, bx), "T-PART100");
      door(hostRing, ringPos((bx + other) / 2), !bathAtA);
      space("", uvOf(HOTEL_BATH_D / 2, (wB + bx) / 2), "Bath");
      // the bed's headboard on the bathroom's demising wall, beyond the bath; a desk on the far wall
      furn("Desk", uvOf(HOTEL_BATH_D + (D - HOTEL_BATH_D) / 2, wB + dir * 1050), [1800, 2000].map(x => x), !alongIsV);
      furn("Desk", uvOf(D - 1100, other - dir * 330), [500, 1400], alongIsV);
      keys++; space("King room", uvOf(D * 0.62, (a + b) / 2), "Guest room", `${k}-${String(keys).padStart(2, "0")}`);
    };
    // the two long bands: bays along v between the corridor ring's ends
    const nb = Math.max(1, Math.round(Lc / HOTEL_BAY)), bay = Lc / nb;
    for (const s of [-1, 1]) {
      for (let i = 0; i <= nb; i++) { const v = -Lc / 2 + i * bay; wall("Demising", [s * Wc / 2, v], [s * W / 2, v], "T-PART100"); }
      const [host, pos] = ringAt("u", s);
      for (let i = 0; i < nb; i++) {
        const v0 = -Lc / 2 + i * bay, v1 = v0 + bay;
        keyRoom((d, x) => [s * (Wc / 2 + d), x], v0, v1, (W - Wc) / 2, i % 2 === 0, host, pos, true, "Key");
      }
    }
    // the end bands: a corner suite each side (reaching 1.2 m in to meet the corridor) and keys - or a core - between
    const middleW = Wc - 2 * HOTEL_SUITE_STRIP, D = (L - Lc) / 2;
    for (const t of [-1, 1]) {
      const [host, pos] = ringAt("v", t);
      for (const s of [-1, 1]) {
        wall("Suite", [s * middleW / 2, t * Lc / 2], [s * middleW / 2, t * L / 2], "T-PART100");
        door(host, pos(s * (Wc / 2 - HOTEL_SUITE_STRIP / 2)), s > 0);
        furn("Desk", [s * (W / 2 - 2500), t * (Lc / 2 + D / 2)], [1800, 2000], false);
        furn("Sofa", [s * (W / 2 - 2400), t * (L / 2 - 1300)], [2200, 800], true);
        keys++; space("Corner suite", [s * (middleW / 2 + 2500), t * (Lc / 2 + D * 0.55)], "Guest room", `${k}-${String(keys).padStart(2, "0")}`);
      }
      if (H.middle === "atrium") {
        // the atrium plate puts its cores in the end bands: a stair and lifts at one end, a stair and back-of-house at the other
        const u0 = -middleW / 2, stairW = 5000, liftW = t > 0 ? 4800 : 0;
        wall("Core", [u0 + stairW, t * Lc / 2], [u0 + stairW, t * L / 2], "T-BLOCK215");
        stair([u0, u0 + stairW], [t * Lc / 2, t * L / 2], "u");
        space("Stair", [u0 + stairW / 2, t * (Lc / 2 + D / 2)], "Core");
        if (liftW) {
          wall("Core", [u0 + stairW + liftW, t * Lc / 2], [u0 + stairW + liftW, t * L / 2], "T-BLOCK215");
          wall("Lift shafts", [u0 + stairW, t * (Lc / 2 + 2600)], [u0 + stairW + liftW, t * (Lc / 2 + 2600)], "T-BLOCK215");
          wall("Lift shafts", [u0 + stairW + liftW / 2, t * (Lc / 2 + 2600)], [u0 + stairW + liftW / 2, t * L / 2], "T-BLOCK215");
          space("Lifts", [u0 + stairW + liftW / 4, t * (Lc / 2 + 4800)], "Core"); space("Lifts", [u0 + stairW + 3 * liftW / 4, t * (Lc / 2 + 4800)], "Core");
          space("Lift lobby", [u0 + stairW + liftW / 2, t * (Lc / 2 + 1300)], "Circulation");
        }
        door(host, pos(u0 + stairW / 2), false);
        space(t > 0 ? "Linen and riser" : "Back of house", [(u0 + stairW + liftW + middleW / 2) / 2, t * (Lc / 2 + D / 2)], "Core");
        door(host, pos((u0 + stairW + liftW + middleW / 2) / 2), true);
      } else {
        const m = Math.max(1, Math.round(middleW / HOTEL_BAY)), w = middleW / m;
        for (let i = 1; i < m; i++) wall("Demising", [-middleW / 2 + i * w, t * Lc / 2], [-middleW / 2 + i * w, t * L / 2], "T-PART100");
        for (let i = 0; i < m; i++) {
          const a = -middleW / 2 + i * w, b = a + w;
          keyRoom((d, x) => [x, t * (Lc / 2 + d)], a, b, D, i % 2 === 0, host, pos, false, "Key");
        }
      }
    }
    // the middle: a core of two stairs, lifts and a riser - or, in the atrium plate, the void with a glass balustrade
    if (H.middle === "core") {
      // two stairs at the ends, a bank of lifts opening onto one side of the corridor, a riser and linen room between
      const core = rect("Core", Wk, Lk, "T-BLOCK215");
      const sL = Math.min(5000, (Lk - 3000) / 2), mid = Lk - 2 * sL, liftW = 2500, nl = Math.max(1, Math.min(3, Math.floor((mid - 1500) / liftW)));
      for (const t of [-1, 1]) {
        wall("Core", [-Wk / 2, t * (Lk / 2 - sL)], [Wk / 2, t * (Lk / 2 - sL)], "T-BLOCK215");
        stair([-Wk / 2, Wk / 2], [t * (Lk / 2 - sL), t * Lk / 2], "v"); space("Stair", [0, t * (Lk / 2 - sL / 2)], "Core");
        door(core[t > 0 ? 2 : 0], Wk / 2, false);                 // into each stair from the corridor end
      }
      const v0 = -Lk / 2 + sL, uL = Wk / 2 - 2400;
      wall("Lift shafts", [uL, v0], [uL, v0 + nl * liftW], "T-BLOCK215");
      for (let i = 1; i <= nl; i++) wall("Lift shafts", [uL, v0 + i * liftW], [Wk / 2, v0 + i * liftW], "T-BLOCK215");
      for (let i = 0; i < nl; i++) {
        space("Lift", [(uL + Wk / 2) / 2, v0 + (i + 0.5) * liftW], "Core");
        add({ id: `${k}-OPL${i + 1}`, type: "Opening", args: { host: { ref: core[1] }, profile: { kind: "rect", at: Math.round(v0 + (i + 0.5) * liftW + Lk / 2), sill: 0, w: 1100, h: 2200 }, farProfile: null, depth: "through" } });
      }
      space("Riser, linen and housekeeping", [(-Wk / 2 + uL) / 2, v0 + 600], "Core");
      door(core[3], Lk / 2 - (v0 + Lk / 2 - sL) / 2, true);
    } else {
      rect("Atrium balustrade", Wk, Lk, "T-GLASS30", { height: 1100 });
      space("Atrium (open to sky / roof light)", [0, 0], "Atrium");
    }
    space("Corridor", [(Wc / 2 + (H.middle === "core" ? Wk / 2 : Wk / 2)) / 2, 0], "Circulation");
    // stair treads, drawn in the hotel's own plan: two flights and the landing
    function stair([a0, a1], [b0, b1], runAlong) {
      const lo = Math.min(b0, b1), hi = Math.max(b0, b1), land = 1400, mid = (a0 + a1) / 2;
      const ln = (p, q) => add({ id: `${k}-DLS${++n}`, type: "DetailLine", args: { curve: line(P(...p), P(...q)), pen: "thin", lineStyle: "Solid", view: { ref: view }, layer: "Stair", colour: "#000000" } });
      const uvS = (x, y) => runAlong === "v" ? [x, y] : [y, x];
      if (runAlong === "v") {
        ln(uvS(mid, lo + land), uvS(mid, hi - land));
        for (let y = lo + land; y <= hi - land + 1; y += 280) ln(uvS(a0 + 150, y), uvS(a1 - 150, y));
      } else {
        // runs across u: flights along u between a0..a1, landings at the corridor and facade ends
        ln([a0 + land, (lo + hi) / 2], [a1 - land, (lo + hi) / 2].map(x => x));
        for (let x = a0 + land; x <= a1 - land + 1; x += 280) ln([x, lo + 150], [x, hi - 150]);
      }
    }
    // slab: whole plate, or a ring around the atrium
    if (H.middle === "core") add({ id: `${k}-FL`, type: "Floor", name: `${H.name} slab`, args: { boundary: corners, floorType: { ref: "T-FLOOR250" }, level: { ref: "L1" }, heightOffset: 0 } });
    else {
      const ringSlab = [[[-W / 2, -L / 2], [W / 2, -L / 2], [W / 2, -Lk / 2], [-W / 2, -Lk / 2]], [[-W / 2, Lk / 2], [W / 2, Lk / 2], [W / 2, L / 2], [-W / 2, L / 2]],
        [[-W / 2, -Lk / 2], [-Wk / 2, -Lk / 2], [-Wk / 2, Lk / 2], [-W / 2, Lk / 2]], [[Wk / 2, -Lk / 2], [W / 2, -Lk / 2], [W / 2, Lk / 2], [Wk / 2, Lk / 2]]];
      ringSlab.forEach((b, i) => add({ id: `${k}-FL${i + 1}`, type: "Floor", name: `${H.name} slab ${i + 1}`, args: { boundary: b.map(p => P(...p)), floorType: { ref: "T-FLOOR250" }, level: { ref: "L1" }, heightOffset: 0 } }));
    }
    const gia = W * L / 1e6 - (H.middle === "atrium" ? Wk * Lk / 1e6 : 0);
    summary.push({ H, keys, gia });
    const lab = `${H.name.toUpperCase()} — ${W / 1000} × ${L / 1000} m — ${keys} keys per floor — ${Math.round(gia)} m² GIA per floor${H.middle === "atrium" ? " — central atrium" : ""}`;
    text(`TX-${k}`, lab, [Math.min(...bx) - 2000, Math.max(...by) + 4000], view, "TT-25", 60);
    text(`TX-S${k}`, `${H.name}: ${keys} keys / floor`, [Math.max(...bx) + 8000, (Math.min(...by) + Math.max(...by)) / 2], "V-SITE", "TT-35", 60);
  }
  add({ id: "V-3D", type: "View3D", name: "Hotels — 3D", args: { camera: { azimuth: 210, elevation: 40, target: [0, -150000, 0] }, scale: 1000, style: { ref: "VS-PRESENTATION" }, visualStyle: "Shaded" } });
  add({ id: "SC-ROOMS", type: "Schedule", name: "Key Schedule", args: { of: "IfcSpace", fields: ["Number", "Name", "Department", "Area"] } });
  add({ id: "SH-T100", type: "Sheet", name: "T-100 Hotels Test Fit", args: { number: "T-100", sheetName: "Hotels Test Fit — Typical Guest Floor (WIP)", size: "A1", orientation: "landscape", titleBlock: { ref: "SY-TB-A1" }, viewports: [{ id: "VP1", view: { ref: "V-SITE" }, at: [115, 320], clipVisible: false }, { id: "VP2", view: { ref: "V-H1" }, at: [300, 330], clipVisible: false }, { id: "VP3", view: { ref: "V-H2" }, at: [475, 330], clipVisible: false }, { id: "VP4", view: { ref: "V-H3" }, at: [690, 330], clipVisible: false }], revision: "P01" } });
  doc.meta.hotelSummary = summary.map(x => ({ hotel: x.H.name, keys: x.keys, gia: Math.round(x.gia) }));
  doc.graph.layout = {};
  doc.browser = { organisation: "by-discipline", expanded: ["Views", "Sheets"] };
  doc.regenerate();
  return doc;
}
