//! Fit-out: the furniture and sanitary blocks of a hotel brochure plan, the fitters that lay them out in a built
//! model's rooms, and the checker that says whether people can use the result.
//!
//! A block is a fixture type in doc.lib.types, drawn in fine lines about its insertion point: x across it, y from its
//! back (0, against a wall) to its front (+y, the side a person uses). Each carries `fit`: its solid footprint and
//! its clearance zones in that same frame. The fitter that places a block and the checker that judges it read the
//! one definition, so a layout the fitter accepts is the layout the checker passes.
//!
//! The fitters work on the regenerated model - room outlines from the spaces, doors through their openings to the
//! host walls - so they fit whatever the plan is, rectangular or not: every candidate is put against a wall run of
//! the room in that run's own frame and kept only if it clears walls, columns, door swings, other furniture and
//! every clearance zone; a room's layout is then kept only if an 800 mm wide walker can reach every use zone from
//! its door(s). Clearances (mm): double bed 600 each side, 700 at the foot; desk chair zone 750; 900 behind a
//! seated chair on a route; wardrobe 600; WC 400 from its centreline to anything beside it and 600 × 800 in front;
//! basin 700; shower entry 700; bath 700 alongside; armchair 450; meeting and dining chairs 750 pull-out; kitchen
//! counter 1200; open plan 1200 primary routes; lifts 1500 in front (3000 between facing lifts).

import { add, sub, mul, dot, cross, len, dist, normalise, perp, polyArea, pointInPoly } from "./geom2d.js";
import { pointAt } from "./walls.js";
import { Editor } from "./ops.js";

// ---------------------------------------------------------------- drawing helpers (mm, in a block's frame)
const fxPt = (x, y) => [Math.round(x), Math.round(y)];
const fxBox = (x0, y0, x1, y1) => [fxPt(x0, y0), fxPt(x1, y0), fxPt(x1, y1), fxPt(x0, y1), fxPt(x0, y0)];
const fxSeg = (x0, y0, x1, y1) => [fxPt(x0, y0), fxPt(x1, y1)];
function fxArc(cx, cy, rx, ry, a0, a1, n) { const o = []; for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; o.push(fxPt(cx + rx * Math.cos(a), cy + ry * Math.sin(a))); } return o; }
const fxRing = (cx, cy, rx, ry = rx, n = 24) => fxArc(cx, cy, rx, ry, 0, 360, n);
function fxRbox(x0, y0, x1, y1, r) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const p = [...fxArc(x1 - r, y0 + r, r, r, -90, 0, 3), ...fxArc(x1 - r, y1 - r, r, r, 0, 90, 3), ...fxArc(x0 + r, y1 - r, r, r, 90, 180, 3), ...fxArc(x0 + r, y0 + r, r, r, 180, 270, 3)];
  p.push(p[0]); return p;
}
/** Polylines moved and turned: a sub-block (a chair round a table) drawn facing +y, put down facing `face` degrees. */
const fxMove = (pls, cx, cy, face) => { const a = (face - 90) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return pls.map(pl => pl.map(([x, y]) => fxPt(cx + x * c - y * s, cy + x * s + y * c))); };
/** A chair seen from above, facing +y about its seat centre: seat, a curved back, arms on a task chair. */
function fxChair(arms) {
  const back = [...fxArc(0, -40, 235, 235, 200, 340, 8), ...fxArc(0, -40, 205, 200, 340, 200, 8)]; back.push(back[0]);
  const L = [fxRbox(-215, -175, 215, 215, 70), back];
  if (arms) L.push(fxRbox(-262, -150, -222, 150, 15), fxRbox(222, -150, 262, 150, 15));
  return L;
}
/** A wall-hung WC about the middle of its back: carrier box, pan, seat opening. 690 from the wall. */
function fxPan() {
  const pan = [fxPt(-180, 160)]; for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16, c = Math.cos(a), s = Math.sin(a); pan.push(fxPt(-180 * Math.sign(c) * Math.abs(c) ** 0.75, 160 + 530 * s ** 0.85)); }
  pan[pan.length - 1] = fxPt(180, 160); pan.reverse();
  return [fxBox(-250, 0, 250, 160), pan, fxRing(0, 450, 125, 185, 20), fxSeg(-150, 205, 150, 205)];
}

// ---------------------------------------------------------------- the block library
// zone fields: use (what it is for), r (rect in the block frame), route (a use zone the walker must reach),
// allow (kinds that may stand in it: a desk's own chair), clearOf (zone uses it must not overlap: chair backs)
const fxZone = (use, r, o = {}) => Object.assign({ use, r: r.map(Math.round) }, o);
function fxDef(name, family, kind, foot, lines, zones, height, material) {
  const [x0, y0, x1, y1] = foot;
  return { family, name, mark: "", lines, body: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], height, material: material || "M-TIMBER", fit: { kind, foot: foot.map(Math.round), zones: zones || [] } };
}
const FX_SAN = "F-SANITARY", FX_FIX = "F-FIXTURE", FX_CASE = "F-CASEWORK";
const FX_BLOCKS = {
  // beds: headboard, mattress, two pillows, the duvet's edge with a corner turned down, a runner across the foot
  bed: ({ w }) => {
    const x = w / 2, h = 70, L = 2000, top = h + 640;
    const lines = [fxBox(-x - 40, 0, x + 40, h), fxRbox(-x, h, x, h + L, 45), fxRbox(-x + 60, h + 70, -45, h + 450, 80), fxRbox(45, h + 70, x - 60, h + 450, 80),
      fxSeg(-x, top, x, top), [fxPt(x - 480, top), fxPt(x, top + 480)], fxSeg(-x, h + L - 560, x, h + L - 560), fxSeg(-x, h + L - 300, x, h + L - 300)];
    return fxDef(`${w >= 1800 ? "King" : w >= 1500 ? "Queen" : "Single"} bed ${w} × ${L}`, FX_FIX, "bed", [-x - 40, 0, x + 40, h + L], lines,
      [fxZone("bed side", [-x - 600, 450, -x, h + L], { route: true }), fxZone("bed side", [x, 450, x + 600, h + L], { route: true }), fxZone("bed foot", [-x, h + L, x, h + L + 700], { route: true })], 550);
  },
  nightstand: ({ w = 500 } = {}) => fxDef(`Nightstand ${w} × 420 with lamp`, FX_FIX, "nightstand", [-w / 2, 0, w / 2, 420], [fxBox(-w / 2, 0, w / 2, 420), fxRing(0, 210, w * 0.23), fxRing(0, 210, 35, 35, 12)], [], 550),
  desk: ({ w }) => fxDef(`Writing desk ${w} × 550`, FX_FIX, "desk", [-w / 2, 0, w / 2, 550],
    [fxBox(-w / 2, 0, w / 2, 550), fxBox(-w / 2 + 25, 0, w / 2 - 25, 25), fxRing(-w / 2 + 140, 150, 90), fxRing(-w / 2 + 140, 150, 30, 30, 12), fxRbox(-170, 160, 230, 440, 20)],
    [fxZone("desk chair", [-w / 2, 550, w / 2, 1300], { route: true, allow: ["chair"] })], 750),
  chair: () => fxDef("Desk chair", FX_FIX, "chair", [-262, -275, 262, 215], fxChair(true), [], 900),
  armchair: () => fxDef("Armchair 780 × 800", FX_FIX, "armchair", [-390, 0, 390, 800],
    [fxRbox(-390, 0, 390, 800, 70), fxSeg(-235, 190, 235, 190), fxSeg(-235, 190, -235, 800), fxSeg(235, 190, 235, 800), fxRbox(-222, 215, 222, 770, 50)],
    [fxZone("armchair front", [-390, 800, 390, 1250], { route: true })], 800),
  sidetable: () => fxDef("Side table Ø500", FX_FIX, "sidetable", [-250, 0, 250, 500], [fxRing(0, 250, 250, 250, 28), fxRing(0, 250, 228, 228, 28), fxRing(0, 250, 70, 70, 12)], [], 550),
  // a wardrobe: carcass, hanging rail, hangers on it, two sliding doors
  wardrobe: ({ w }) => {
    const lines = [fxBox(-w / 2, 0, w / 2, 600), fxSeg(-w / 2 + 50, 300, w / 2 - 50, 300), fxSeg(-w / 2, 560, 40, 560), fxSeg(-40, 585, w / 2, 585)];
    for (let x = -w / 2 + 90; x <= w / 2 - 80; x += 105) lines.push(fxSeg(x - 30, 110, x + 30, 490));
    return fxDef(`Wardrobe ${w} × 600`, FX_CASE, "wardrobe", [-w / 2, 0, w / 2, 600], lines, [fxZone("wardrobe front", [-w / 2, 600, w / 2, 1200], { route: true })], 2300);
  },
  luggage: () => fxDef("Luggage bench 1000 × 450", FX_FIX, "luggage", [-500, 0, 500, 450], [fxBox(-500, 0, 500, 450), fxSeg(-470, 110, 470, 110), fxSeg(-470, 225, 470, 225), fxSeg(-470, 340, 470, 340)],
    [fxZone("luggage front", [-500, 450, 500, 900])], 450),
  tv: ({ w }) => fxDef(`TV sideboard ${w} × 450`, FX_CASE, "tv", [-w / 2, 0, w / 2, 450],
    [fxBox(-w / 2, 0, w / 2, 450), fxBox(-560, 35, 560, 80), fxBox(-140, 80, 140, 150), fxSeg(-w / 6, 450, -w / 6, 200), fxSeg(w / 6, 450, w / 6, 200)],
    [fxZone("sideboard front", [-w / 2, 450, w / 2, 950])], 750),
  // a sofa: arms, back, seat cushions split
  sofa: ({ w }) => {
    const x = w / 2, n = w >= 2000 ? 3 : 2, lines = [fxRbox(-x, 0, x, 900, 80), fxSeg(-x + 190, 200, x - 190, 200), fxSeg(-x + 190, 120, -x + 190, 900), fxSeg(x - 190, 120, x - 190, 900), fxSeg(-x + 190, 860, x - 190, 860)];
    for (let i = 1; i < n; i++) { const xi = -x + 190 + (w - 380) * i / n; lines.push(fxSeg(xi, 200, xi, 860), fxSeg(xi, 30, xi, 200)); }
    return fxDef(`Sofa ${w} × 900`, FX_FIX, "sofa", [-x, 0, x, 900], lines, [fxZone("sofa front", [-x + 190, 900, x - 190, 1300], { route: true })], 800);
  },
  coffee: ({ w, d }) => fxDef(`Coffee table ${w} × ${d}`, FX_FIX, "table", [-w / 2, 0, w / 2, d], [fxRbox(-w / 2, 0, w / 2, d, 40), fxRbox(-w / 2 + 45, 45, w / 2 - 45, d - 45, 25)], [], 400),
  // a round table with its chairs, about its centre: dining (750 pull-out) or a café table
  roundset: ({ d, n }) => {
    const r = d / 2, lines = [fxRing(0, 0, r, r, 32), fxRing(0, 0, r - 25, r - 25, 32)];
    for (let i = 0; i < n; i++) { const a = 90 + 360 * i / n, rc = r + 130; lines.push(...fxMove(fxChair(false), rc * Math.cos(a * Math.PI / 180), rc * Math.sin(a * Math.PI / 180), a + 180)); }
    return fxDef(`Round table Ø${d} with ${n} chairs`, FX_FIX, "dining", [-r, -r, r, r], lines,
      [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([u, v]) => fxZone("chair pull-out", u ? [u > 0 ? r : -r - 750, -r, u > 0 ? r + 750 : -r, r] : [-r, v > 0 ? r : -r - 750, r, v > 0 ? r + 750 : -r], { route: true })), 750);
  },
  // a meeting table with chairs round it, about its centre: nl chairs down each long side, ne at each end
  meeting: ({ l, w, nl, ne }) => {
    const x = l / 2, y = w / 2, lines = [fxRbox(-x, -y, x, y, Math.min(120, y)), fxRbox(-x + 40, -y + 40, x - 40, y - 40, Math.min(90, y - 40))];
    for (let i = 0; i < nl; i++) { const cx = -x + l * (i + 0.5) / nl; lines.push(...fxMove(fxChair(false), cx, y + 130, 270), ...fxMove(fxChair(false), cx, -y - 130, 90)); }
    for (let j = 0; j < ne; j++) { const cy = -y + w * (j + 0.5) / ne; lines.push(...fxMove(fxChair(false), x + 130, cy, 180), ...fxMove(fxChair(false), -x - 130, cy, 0)); }
    const zones = [fxZone("chair pull-out", [-x, y, x, y + 750], { route: true }), fxZone("chair pull-out", [-x, -y - 750, x, -y], { route: true })];
    if (ne) zones.push(fxZone("chair pull-out", [x, -y, x + 750, y], { route: true }), fxZone("chair pull-out", [-x - 750, -y, -x, y], { route: true }));
    return fxDef(`Meeting table ${l} × ${w}, ${2 * nl + 2 * ne} chairs`, FX_FIX, "meeting", [-x, -y, x, y], lines, zones, 750);
  },
  // sanitary ware
  wc: () => fxDef("WC, wall hung", FX_SAN, "wc", [-250, 0, 250, 690], fxPan(),
    [fxZone("WC side", [-400, 0, 400, 690]), fxZone("WC front", [-400, 690, 400, 1290], { route: true })], 400, "M-TILE"),
  wcacc: () => fxDef("WC, accessible, with grab rails", FX_SAN, "wc", [-250, 0, 250, 690],
    [...fxPan(), fxRbox(-475, 180, -445, 900, 15), fxRbox(330, 160, 360, 860, 15), fxRing(345, 860, 30, 30, 12)],
    [fxZone("WC side", [-450, 0, 400, 690]), fxZone("WC transfer", [250, 0, 1150, 800]), fxZone("WC front", [-450, 690, 1050, 2190], { route: true })], 400, "M-TILE"),
  basin: ({ w }) => fxDef(`Vanity basin ${w} × 500`, FX_SAN, "basin", [-w / 2, 0, w / 2, 500],
    [fxBox(-w / 2, 0, w / 2, 500), fxRing(0, 280, 215, 165, 28), fxRing(0, 285, 188, 138, 28), fxRing(0, 300, 18, 18, 10), fxRing(0, 95, 24, 24, 10), fxSeg(0, 119, 0, 175)],
    [fxZone("basin front", [-Math.max(w / 2, 350), 500, Math.max(w / 2, 350), 1200], { route: true })], 850, "M-TILE"),
  // a shower tray drawn with its X, a glass screen along part of its front and the way in beside it
  shower: ({ w, d, open }) => {
    const x = w / 2, lines = [fxBox(-x, 0, x, d), fxBox(-x + 40, 40, x - 40, d - 40), fxSeg(-x + 40, 40, x - 40, d - 40), fxSeg(-x + 40, d - 40, x - 40, 40), fxRing(0, d / 2, 45, 45, 12)];
    if (open < w) lines.push(fxBox(-x, d - 10, x - open, d + 10));
    return fxDef(`Shower tray ${w} × ${d}`, FX_SAN, "shower", [-x, 0, x, d], lines, [fxZone("shower entry", [x - Math.max(open, 600), d, x, d + 700], { route: true })], 60, "M-TILE");
  },
  bath: ({ w }) => fxDef(`Bath ${w} × 750`, FX_SAN, "bath", [-w / 2, 0, w / 2, 750],
    [fxBox(-w / 2, 0, w / 2, 750), fxRbox(-w / 2 + 60, 60, w / 2 - 60, 690, 230), fxRing(-w / 2 + 170, 375, 28, 28, 10), fxBox(-w / 2 + 10, 340, -w / 2 + 50, 410)],
    [fxZone("bath side", [-w / 2, 750, w / 2, 1450], { route: true })], 550, "M-TILE"),
  // office
  workstation: () => fxDef("Workstation desk 1600 × 800", FX_FIX, "workstation", [-800, 0, 800, 800],
    [fxBox(-800, 0, 800, 800), fxBox(-800, 0, 800, 25), fxBox(-260, 110, 260, 145), fxBox(-60, 145, 60, 185), fxRbox(-230, 360, 230, 500, 15), fxRing(330, 430, 30, 40, 12)],
    [fxZone("desk chair", [-800, 800, 800, 1550], { route: true, allow: ["chair"] }), fxZone("behind chair", [-800, 1550, 800, 2450], { clearOf: ["desk chair"] })], 750),
  counter: ({ w }) => {
    const x = w / 2, lines = [fxBox(-x, 0, x, 600), fxRbox(-x + 160, 90, -x + 640, 470, 40), fxRing(-x + 400, 120, 22, 22, 10)];
    for (let i = 0; i < 5; i++) lines.push(fxSeg(-x + 700 + i * 70, 110, -x + 700 + i * 70, 470));
    lines.push(fxBox(x - 650, 0, x, 650), fxSeg(x - 650, 0, x, 650));          // a tall fridge unit
    if (w >= 2400) for (const [cx, cy, r] of [[-60, 180, 90], [190, 180, 70], [-60, 430, 70], [190, 430, 90]]) lines.push(fxRing(cx, cy, r, r, 16));
    return fxDef(`Kitchen counter ${w} with sink`, FX_CASE, "counter", [-x, 0, x, 650], lines, [fxZone("counter front", [-x, 650, x, 1850], { route: true })], 900);
  },
  // a WC cubicle in a row: partitions, a door opening in (clear of the pan), 1100 to move in front (BS 6465 activity space)
  cubicle: () => fxDef("WC cubicle 900 × 1450", FX_SAN, "cubicle", [-450, 0, 450, 1450],
    [fxBox(-450, 0, -425, 1450), fxBox(425, 0, 450, 1450), fxBox(-450, 1425, -340, 1450), fxBox(340, 1425, 450, 1450), ...fxPan(),
      fxSeg(340, 1450, 340, 770), fxArc(340, 1450, 680, 680, 270, 180, 10)],
    [fxZone("cubicle front", [-450, 1450, 450, 2550], { route: true })], 2000, "M-TILE"),
  basins: ({ n }) => {
    const w = n * 650 + 100, x = w / 2, lines = [fxBox(-x, 0, x, 550)];
    for (let i = 0; i < n; i++) { const cx = -x + 50 + 650 * (i + 0.5); lines.push(fxRing(cx, 300, 200, 150, 24), fxRing(cx, 305, 175, 125, 24), fxRing(cx, 95, 22, 22, 10), fxSeg(cx, 117, cx, 170)); }
    return fxDef(`Basin counter, ${n} basins`, FX_SAN, "basin", [-x, 0, x, 550], lines, [fxZone("basin front", [-x, 550, x, 1250], { route: true })], 850, "M-TILE");
  },
  lockers: ({ n }) => {
    const w = n * 400, x = w / 2, lines = [fxBox(-x, 0, x, 500)];
    for (let i = 1; i < n; i++) lines.push(fxSeg(-x + 400 * i, 0, -x + 400 * i, 500));
    for (let i = 0; i < n; i++) lines.push(fxSeg(-x + 400 * i + 320, 470, -x + 400 * i + 320, 420));
    return fxDef(`Lockers, ${n} × 400`, FX_CASE, "lockers", [-x, 0, x, 500], lines, [fxZone("locker front", [-x, 500, x, 1300], { route: true })], 1800);
  },
  copier: () => fxDef("Printer and copier", FX_FIX, "copier", [-650, 0, 650, 700],
    [fxBox(-500, 0, 400, 700), fxBox(400, 180, 650, 520), fxBox(-650, 220, -500, 480), fxBox(-420, 520, -120, 660), fxSeg(-500, 120, 400, 120)],
    [fxZone("copier front", [-650, 700, 650, 1600], { route: true })], 1200),
  pod: () => fxDef("Phone booth 1100 × 1100", FX_FIX, "pod", [-550, 0, 550, 1100],
    [fxBox(-550, 0, 550, 1100), fxBox(-500, 50, 500, 1050), fxBox(-500, 50, 500, 380), fxRing(0, 690, 175, 175, 20), fxSeg(-330, 1100, 330, 1100), fxSeg(-330, 1080, 330, 1080)],
    [fxZone("booth entry", [-450, 1100, 450, 1800], { route: true })], 2300),
  // a wall-hung comms cabinet: a tenant's comms room is 1.8 m across, room for 600 deep and 900 to work in front
  rack: () => fxDef("Comms cabinet 600 × 600", FX_CASE, "rack", [-300, 0, 300, 600], [fxBox(-300, 0, 300, 600), fxBox(-260, 40, 260, 560), fxSeg(-260, 40, 260, 560), fxSeg(-260, 560, 260, 40)],
    [fxZone("rack front", [-300, 600, 300, 1500], { route: true })], 2000),
  shelving: ({ w }) => {
    const x = w / 2, lines = [fxBox(-x, 0, x, 450), fxSeg(-x, 420, x, 420)];
    for (let xi = -x + 900; xi < x - 100; xi += 900) lines.push(fxSeg(xi, 0, xi, 450));
    return fxDef(`Shelving ${w} × 450`, FX_CASE, "shelving", [-x, 0, x, 450], lines, [fxZone("shelving front", [-x, 450, x, 1350], { route: true })], 2000);
  },
  cleaner: () => fxDef("Cleaner's sink", FX_SAN, "basin", [-300, 0, 300, 500], [fxBox(-300, 0, 300, 500), fxRbox(-240, 60, 240, 440, 40), fxRing(0, 260, 30, 30, 10), fxRing(0, 90, 22, 22, 10)],
    [fxZone("basin front", [-350, 500, 350, 1200], { route: true })], 600, "M-TILE"),
  reception: ({ w }) => {
    const x = w / 2, lines = [fxBox(-x, 750, x, 1500), fxBox(-x, 1300, x, 1500), fxBox(-x + 300, 850, -x + 820, 1150), ...fxMove(fxChair(true), 0, 450, 90)];
    return fxDef(`Reception desk ${w}`, FX_FIX, "reception", [-x, 750, x, 1500], lines,
      [fxZone("reception staff", [-x, 0, x, 750], { allow: ["chair"] }), fxZone("reception front", [-x, 1500, x, 2700], { route: true })], 1100);
  },
  bench: ({ w }) => fxDef(`Bench ${w} × 400`, FX_FIX, "bench", [-w / 2, 0, w / 2, 400], [fxBox(-w / 2, 0, w / 2, 400), fxSeg(-w / 2 + 30, 200, w / 2 - 30, 200)], [fxZone("bench front", [-w / 2, 400, w / 2, 900])], 450),
  training: () => fxDef("Training table 1600 × 600 with 2 chairs", FX_FIX, "training", [-800, 0, 800, 600],
    [fxBox(-800, 0, 800, 600), ...fxMove(fxChair(false), -400, 730, 270), ...fxMove(fxChair(false), 400, 730, 270)],
    [fxZone("chair pull-out", [-800, 600, 800, 1350], { route: true })], 750),
  // a lift car in its shaft, about the shaft's centre, its door to +y: car, the X of the void, the car door
  lift: ({ w, d }) => fxDef(`Lift car ${w} × ${d}`, FX_FIX, "lift", [-w / 2, -d / 2, w / 2, d / 2],
    [fxBox(-w / 2, -d / 2, w / 2, d / 2), fxSeg(-w / 2, -d / 2, w / 2, d / 2), fxSeg(-w / 2, d / 2, w / 2, -d / 2), fxBox(-w / 2 + 120, d / 2 - 40, w / 2 - 120, d / 2), fxBox(-w / 2, -d / 2 - 220, -w / 2 + 500, -d / 2 - 80)], [], 2400, "M-STEEL"),
};
/** The type id a block and its sizes get, and the type itself added to the document the first time it is used. */
export function fixtureType(doc, key, p = {}) {
  const vals = Object.values(p), id = `T-FX-${key.toUpperCase()}${vals.length ? "-" + vals.join("x") : ""}`;
  if (!(id in doc.lib.types)) { const def = FX_BLOCKS[key](p); def.mark = `FF${String(Object.keys(doc.lib.types).filter(k => k.startsWith("T-FX-")).length + 1).padStart(2, "0")}`; doc.setDef("types", id, def); }
  return id;
}

// ---------------------------------------------------------------- placing a block: its footprint and zones in the plan
const fxRect = (r, tr, inset = 0) => [tr([r[0] + inset, r[1] + inset]), tr([r[2] - inset, r[1] + inset]), tr([r[2] - inset, r[3] - inset]), tr([r[0] + inset, r[3] - inset])];
/** A block put down: its frame mapped as the Fixture builder maps it (mirror x, then turn, then move). */
export function fxPlace(doc, typeId, pos, rot, mirror = false, room = null) {
  const def = doc.lib.types[typeId], c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180), m = mirror ? -1 : 1;
  const tr = ([x, y]) => [pos[0] + m * x * c - y * s, pos[1] + m * x * s + y * c];
  return { typeId, def, kind: def.fit.kind, pos, rot, mirror, room, foot: fxRect(def.fit.foot, tr), footIn: fxRect(def.fit.foot, tr, 12),
    zones: def.fit.zones.map(z => Object.assign({}, z, { q: fxRect(z.r, tr), qIn: fxRect(z.r, tr, 12) })) };
}

// ---------------------------------------------------------------- 2D tests
/** Two convex polygons overlap by more than tol (touching is not overlapping). Boxes first: most pairs are far apart. */
function fxOverlap(A, B, tol = 5) {
  const ab = A.bb || (A.bb = fxBB(A)), bb = B.bb || (B.bb = fxBB(B));
  if (ab[2] - bb[0] <= tol || bb[2] - ab[0] <= tol || ab[3] - bb[1] <= tol || bb[3] - ab[1] <= tol) return false;
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], nx = a[1] - b[1], ny = b[0] - a[0], l = Math.hypot(nx, ny); if (l < 1e-9) continue;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const d = (p[0] * nx + p[1] * ny) / l; if (d < a0) a0 = d; if (d > a1) a1 = d; }
    for (const p of B) { const d = (p[0] * nx + p[1] * ny) / l; if (d < b0) b0 = d; if (d > b1) b1 = d; }
    if (a1 - b0 <= tol || b1 - a0 <= tol) return false;
  }
  return true;
}
function fxSegCross(p, q, a, b) {
  const d1 = cross(sub(q, p), sub(a, p)), d2 = cross(sub(q, p), sub(b, p)), d3 = cross(sub(b, a), sub(p, a)), d4 = cross(sub(b, a), sub(q, a));
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
const fxBB = P => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of P) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } return [x0, y0, x1, y1]; };
const fxBBHit = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
/** A convex polygon lies inside the room: corners in the outline and out of its holes, no wall face across it, no column in it. */
function fxInside(Q, R) {
  for (const p of Q) { if (!pointInPoly(p, R.poly)) return false; for (const h of R.holes) if (pointInPoly(p, h)) return false; }
  const bb = fxBB(Q);
  for (const e of R.edges) { if (!fxBBHit(bb, e.bb)) continue; for (let i = 0; i < Q.length; i++) if (fxSegCross(Q[i], Q[(i + 1) % Q.length], e.a, e.b)) return false; }
  for (const o of R.obstacles) if (fxBBHit(bb, o.bb) && fxOverlap(Q, o.poly, 2)) return false;
  return true;
}
const fxCentroid = P => mul(P.reduce((s, p) => add(s, p), [0, 0]), 1 / P.length);

// ---------------------------------------------------------------- the model as the fitter sees it
const FX_DEPT_CIRC = /corridor|lobby|reception|circulation|hub|concourse|landing/i;
const fxIsCirc = r => r.dept === "Circulation" || FX_DEPT_CIRC.test(r.name);
const fxIsVoid = r => r.dept === "Atrium" || /atrium|void/i.test(r.name);
/** Rooms, walls, doors, openings and separators of a level, read off the regenerated model. */
export function fitModel(doc, levelId) {
  const M = { doc, levelId, rooms: [], walls: [], doors: [], holes: [], seps: [], columns: [], fixtures: [], byId: new Map() };
  const onLevel = (f, k) => { const r = doc.argValue(f, k); return r && r.ref === levelId; };
  for (const f of doc.elements()) {
    const t = doc.typeOf(f), id = doc.idOf(f);
    if (t === "Space" && onLevel(f, "level")) {
      const p = doc.plan(f); if (!p || p.status !== "ok" || !p.loop) continue;
      let poly = p.loop.pts.map(q => [q[0], q[1]]); if (polyArea(poly) < 0) poly.reverse();
      const dept = doc.getParam(f, "Department") || "", r = { id, f, name: f.get("Name") || dept || id, dept, poly, holes: (p.loop.holes || []).map(h => h.map(q => [q[0], q[1]])), area: Math.abs(polyArea(poly)) / 1e6 };
      r.bb = fxBB(poly); r.edges = [...[poly, ...r.holes].flatMap(P => P.map((a, i) => { const b = P[(i + 1) % P.length]; return { a, b, bb: fxBB([a, b]) }; }))]; r.obstacles = [];
      M.rooms.push(r); M.byId.set(id, r);
    } else if (t === "Wall" && onLevel(f, "baseLevel")) {
      const w = doc.plan(f); if (!w || !w.curve || w.curve.type !== "line") continue;
      const s = w.stack.s, ty = doc.argValue(f, "wallType"), tid = ty && ty.ref, tt = doc.lib.types[tid] || {};
      M.walls.push({ id, f, w, a: w.curve.start, b: w.curve.end, d: w.d, L: w.L, T: w.stack.T, s0: Math.min(s[0], s[s.length - 1]), s1: Math.max(s[0], s[s.length - 1]), name: f.get("Name") || "", typeId: tid,
        facade: /^F-EXTCAV/.test(tt.family || "") || /facade/i.test(f.get("Name") || ""), glass: /GLASS/i.test(tid || ""), bb: fxBB([w.curve.start, w.curve.end]) });
    } else if (t === "RoomSeparator" && onLevel(f, "level")) { const c = doc.argValue(f, "line"); M.seps.push({ id, a: c.start, b: c.end }); }
    else if (t === "Column" && onLevel(f, "baseLevel")) { const p = doc.plan(f); if (p && p.foot) M.columns.push({ id, poly: p.foot.map(q => [q[0], q[1]]), bb: fxBB(p.foot) }); }
    else if (t === "Fixture" && onLevel(f, "level")) M.fixtures.push(f);
  }
  M.wallById = new Map(M.walls.map(w => [w.id, w]));
  const wallOf = id => M.wallById.get(id);
  for (const f of doc.elements()) {
    const t = doc.typeOf(f); if (t !== "Opening") continue;
    const fr = (doc.data(f) || {}).frame, w = fr && wallOf(fr.host); if (!w || fr.flagged) continue;
    M.holes.push({ id: doc.idOf(f), wall: w, at: fr.at, w: fr.w, C: pointAt(w.w, 0, fr.at) });
  }
  const byOpening = new Map(M.holes.map(h => [h.id, h]));
  for (const f of doc.elements()) {
    if (doc.typeOf(f) !== "Door") continue;
    const ref = doc.argValue(f, "fills"), h = ref && byOpening.get(ref.ref); if (!h) continue;
    h.door = { id: doc.idOf(f), swing: ((doc.data(f) || {}).swing || []).map(fxSwingPoly) };
  }
  for (const r of M.rooms) for (const c of M.columns) if (fxBBHit(r.bb, c.bb) && pointInPoly(fxCentroid(c.poly), r.poly)) r.obstacles.push(c);
  fxJoins(M);
  return M;
}
/** The sector a door leaf sweeps, as the Door builder draws it: from closed to open about the hinge. */
function fxSwingPoly(sw) {
  const P = [sw.hinge]; for (let i = 0; i <= 8; i++) { const a = sw.swingDeg * i / 8 * Math.PI / 180; P.push(add(sw.hinge, mul(add(mul(sw.closed, Math.cos(a)), mul(sw.open, Math.sin(a))), sw.len))); }
  return P;
}
export function fxRoomAt(M, p) {
  for (const r of M.rooms) if (p[0] >= r.bb[0] && p[0] <= r.bb[2] && p[1] >= r.bb[1] && p[1] <= r.bb[3] && pointInPoly(p, r.poly) && !r.holes.some(h => pointInPoly(p, h))) return r;
  return null;
}
/** Which rooms each door, opening and separator joins; each room's doors with the point on its face, its way in, and the swings on its side. */
function fxJoins(M) {
  M.links = [];
  for (const r of M.rooms) { r.doors = []; r.swings = []; }
  for (const h of M.holes) {
    const w = h.wall, n = perp(w.d), far = Math.max(Math.abs(w.s0), Math.abs(w.s1));
    const sides = [1, -1].map(sg => ({ sg, room: fxRoomAt(M, add(h.C, mul(n, sg * (far + 150)))) }));
    for (const { sg, room } of sides) {
      if (!room) continue;
      const other = sides.find(x => x.sg !== sg).room, face = add(h.C, mul(n, sg * (sg > 0 ? w.s1 : -w.s0)));
      room.doors.push({ id: h.door ? h.door.id : h.id, hole: h, to: other ? other.id : null, Q: face, n: mul(n, sg), dir: w.d, w: h.w });
    }
    if (h.door) for (const P of h.door.swing) { const r = fxRoomAt(M, fxCentroid(P)); if (r) r.swings.push({ door: h.door.id, poly: P }); }
    if (sides[0].room && sides[1].room && sides[0].room !== sides[1].room) M.links.push({ a: sides[0].room.id, b: sides[1].room.id, via: h.door ? "door" : "opening", id: h.door ? h.door.id : h.id });
  }
  for (const s of M.seps) {
    const d = normalise(sub(s.b, s.a)), n = perp(d), L = dist(s.a, s.b);
    // an open side is a way in its whole length: a door as wide as the separator, for the walker and for the way kept clear
    const m0 = add(s.a, mul(d, L / 2));
    for (const sg of [1, -1]) { const r = fxRoomAt(M, add(m0, mul(n, sg * 150))); if (r) r.doors.push({ id: s.id, sep: true, Q: m0, n: mul(n, sg), dir: d, w: L - 200, to: (fxRoomAt(M, add(m0, mul(n, -sg * 150))) || {}).id || null }); }
    for (const f of [0.25, 0.5, 0.75]) {
      const m = add(s.a, mul(d, L * f)), A = fxRoomAt(M, add(m, mul(n, 150))), B = fxRoomAt(M, add(m, mul(n, -150)));
      if (A && B && A !== B && !M.links.some(k => k.via === "separator" && ((k.a === A.id && k.b === B.id) || (k.a === B.id && k.b === A.id)))) M.links.push({ a: A.id, b: B.id, via: "separator", id: s.id });
    }
  }
}

// ---------------------------------------------------------------- access: every room from circulation, through nothing but its own parent
const FX_UNIT_CHILD = /bath|wc|toilet|shower|closet|dressing|wardrobe/i;
const fxParentOk = (parent, child) => {
  if (parent.dept === "Guest room") return child.dept === "Bath" || FX_UNIT_CHILD.test(child.name);
  // an office tenancy's open-plan floor serves the rooms let with it, its own WCs among them; a stair is never one
  if (/open-plan|^tenancy|team suite/i.test(parent.name)) return child.dept !== "Bath" && !fxIsCirc(child) && !/^(stair|lift)/i.test(child.name);
  // back of house nests: a riser or a store opening off the linen room or the service room is how a hotel runs
  if (/back of house|linen|service/i.test(parent.name)) return /riser|plant|store|linen/i.test(child.name);
  // a riser's access door opens off the store or plant room it rises through
  if (/store|plant/i.test(parent.name)) return /^riser$/i.test(child.name);
  return false;
};
/** Each room's way in: from circulation directly, or through one parent it may be reached through. */
export function fxAccess(M) {
  const adj = new Map(M.rooms.map(r => [r.id, []]));
  for (const k of M.links) { adj.get(k.a).push({ to: k.b, via: k.via }); adj.get(k.b).push({ to: k.a, via: k.via }); }
  // the floor is entered by its stairs and lifts: circulation joined to them, and all circulation joined to that
  const reach = new Set(), q = [];
  for (const r of M.rooms) if (fxIsCirc(r) && adj.get(r.id).some(e => /^(stair|lift)/i.test(M.byId.get(e.to).name))) { reach.add(r.id); q.push(r.id); }
  if (!q.length) for (const r of M.rooms) if (fxIsCirc(r)) { reach.add(r.id); q.push(r.id); }
  // a zone marked off by a room separator, or open to the floor through a doorless gap (a lounge, a kitchen off the lobby),
  // is part of the open floor, not a room passed through; a lift or a stair never is
  const open = (e, r) => fxIsCirc(r) || e.via === "separator" || (e.via === "opening" && r.dept !== "Core" && !/^(lift|stair)/i.test(r.name));
  while (q.length) { const id = q.pop(); for (const e of adj.get(id)) { const r = M.byId.get(e.to); if (open(e, r) && !reach.has(r.id)) { reach.add(r.id); q.push(r.id); } } }
  const out = new Map(), nbs = r => adj.get(r.id).map(e => M.byId.get(e.to));
  for (const r of M.rooms) {
    if (fxIsVoid(r)) out.set(r.id, { ok: true, how: "void" });
    else if (reach.has(r.id)) out.set(r.id, { ok: true, how: "circulation" });
    else if (nbs(r).some(x => reach.has(x.id))) out.set(r.id, { ok: true, how: "direct" });
  }
  // then through a parent that is reached itself: a bathroom through its key, a riser through the store off the back of house
  for (let more = true; more;) {
    more = false;
    for (const r of M.rooms) {
      if (out.has(r.id)) continue;
      const parent = nbs(r).find(x => out.has(x.id) && out.get(x.id).how !== "void" && fxParentOk(x, r));
      if (parent) { out.set(r.id, { ok: true, how: "through", parent: parent.id }); more = true; }
    }
  }
  for (const r of M.rooms) if (!out.has(r.id)) { const nb = nbs(r); out.set(r.id, { ok: false, how: nb.length ? "only through " + [...new Set(nb.map(x => x.name))].join(", ") : "no door" }); }
  return out;
}

// ---------------------------------------------------------------- a room's walls, merged into runs
/** The room's outline as wall runs: what each is (facade, glass, wall, open), who is beyond it, its doors. */
function fxRuns(M, R) {
  if (R.runs) return R.runs;
  const P = R.poly, n = P.length, E = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], L = dist(a, b); if (L < 1) continue;
    const d = mul(sub(b, a), 1 / L), nIn = perp(d), m = mul(add(a, b), 0.5);
    let wall = null;
    for (const w of M.walls) {
      if (!fxBBHit([m[0] - 400, m[1] - 400, m[0] + 400, m[1] + 400], w.bb) || Math.abs(cross(w.d, d)) > 0.08) continue;
      const t = dot(sub(m, w.a), w.d); if (t < -50 || t > w.L + 50) continue;
      const off = cross(w.d, sub(m, w.a)), side = off > 0 ? w.s1 : -w.s0;
      if (Math.abs(Math.abs(off) - Math.abs(side)) < 30) { wall = w; break; }
    }
    // no wall under an edge: a room separator, or a gap - open either way
    const T = wall ? Math.max(Math.abs(wall.s0), Math.abs(wall.s1)) * 2 : 0, nb = fxRoomAt(M, add(m, mul(nIn, -(T + 150))));
    const kind = wall ? (wall.facade ? "facade" : wall.glass ? "glass" : "wall") : "open";
    E.push({ a, b, d, L, nIn, kind, wall, nb: nb && nb !== R ? nb.id : null });
  }
  // merge neighbours of one kind and one room beyond that turn by little (a curved facade drawn as chords); the end caps
  // between wall pieces drawn as a polyline (edges of 50-110 mm with no wall) glue the pieces either side into one run
  const same = (e, f) => e.kind === f.kind && e.nb === f.nb && dot(e.d, f.d) > Math.cos(14 * Math.PI / 180);
  const cap = e => e.kind === "open" && e.L < 150;
  let start = E.findIndex((e, i) => !cap(e) && !same(E[(i - 1 + E.length) % E.length], e)); if (start < 0) start = 0;
  // ...as long as the chord stays within 250 of every vertex: a 47 m curved facade merged by angle alone sat 2.9 m inside
  // the glass at its middle, and benching laid off the chord missed the window
  const bows = (cur, e) => { const a = cur.edges[0].a, d = normalise(sub(e.b, a)); return cur.edges.some(x => Math.abs(cross(d, sub(x.b, a))) > 250); };
  const runs = [];
  for (let k = 0; k < E.length; k++) {
    const e = E[(start + k) % E.length], cur = runs[runs.length - 1], last = cur && cur.edges.filter(x => !cap(x)).pop();
    if (cur && (cap(e) || (last && same(last, e) && dot(cur.edges[0].d, e.d) > Math.cos(28 * Math.PI / 180) && !bows(cur, e)))) cur.edges.push(e); else runs.push({ edges: [e] });
  }
  for (const r of runs) { while (r.edges.length > 1 && cap(r.edges[r.edges.length - 1])) r.edges.pop(); }
  for (const r of runs) {
    r.a = r.edges[0].a; r.b = r.edges[r.edges.length - 1].b; r.len = dist(r.a, r.b); r.d = normalise(sub(r.b, r.a)); r.nIn = perp(r.d);
    r.kind = r.edges[0].kind; r.nb = r.edges[0].nb; r.walls = [...new Set(r.edges.map(e => e.wall).filter(Boolean))];
    // a run that bows into the room keeps furniture off its chord by how far it bows
    r.inset = Math.max(0, ...r.edges.map(e => dot(sub(e.b, r.a), r.nIn)));
    r.doors = R.doors.filter(dr => Math.abs(dot(sub(dr.Q, r.a), r.nIn)) < 200 + r.inset && dot(sub(dr.Q, r.a), r.d) > -50 && dot(sub(dr.Q, r.a), r.d) < r.len + 50 && dot(dr.n, r.nIn) > 0.7)
      .map(dr => ({ door: dr, t: dot(sub(dr.Q, r.a), r.d) }));
  }
  R.runs = runs.filter(r => r.len > 1);
  // what furniture stands against: one straight wall is one line, whoever is behind each part of it (a key's demising
  // wall half backed by the neighbour's bath still takes a bed across both halves)
  const lines = [];
  for (const r of R.runs) {
    const cur = lines[lines.length - 1];
    if (cur && cur.kind === r.kind && dot(cur.d, r.d) > Math.cos(2 * Math.PI / 180) && Math.abs(cross(cur.d, sub(r.a, cur.a))) < 30 && dist(cur.b, r.a) < 150) {
      cur.parts.push(r); cur.b = r.b; cur.len = dist(cur.a, cur.b); cur.doors = cur.doors.concat(r.doors.map(x => ({ door: x.door, t: x.t + dot(sub(r.a, cur.a), cur.d) }))); cur.inset = Math.max(cur.inset, r.inset);
    } else lines.push(Object.assign({}, r, { parts: [r] }));
  }
  if (lines.length > 1) { const f = lines[0], l = lines[lines.length - 1];
    if (f.kind === l.kind && dot(f.d, l.d) > Math.cos(2 * Math.PI / 180) && Math.abs(cross(l.d, sub(f.a, l.a))) < 30 && dist(l.b, f.a) < 150) {
      l.parts.push(...f.parts); l.b = f.b; l.len = dist(l.a, l.b); l.doors = l.doors.concat(f.doors.map(x => ({ door: x.door, t: x.t + dot(sub(f.a, l.a), l.d) }))); l.inset = Math.max(l.inset, f.inset); lines.shift(); } }
  R.lines = lines;
  return R.runs;
}

// ---------------------------------------------------------------- the checker
/** Footprint and clearance problems of one placed block against the room and the others (one test for fitter and checker). */
function fxClash(R, it, others, extra = [], tol = 5) {
  const alone = fxAlone(R, it, tol); if (alone) return alone;
  for (const o of others) { if (o === it) continue; const p = fxPair(it, o, tol); if (p) return p; }
  for (const z of extra) if (fxOverlap(it.foot, z.q, tol)) return `${it.def.name} blocks ${z.use}`;
  return null;
}
/** What a block gets wrong with the room alone - the walls, the columns, a door's swing, its own clearances inside -
 *  cached per room and pose, since a fitter tries the same pose against many layouts. */
function fxAlone(R, it, tol) {
  const key = tol === 1 ? `${it.typeId}|${Math.round(it.pos[0])}|${Math.round(it.pos[1])}|${Math.round(it.rot * 10)}|${+it.mirror}` : null;
  const cache = R.alone || (R.alone = new Map());
  if (key && cache.has(key)) return cache.get(key);
  const name = it.def.name;
  let r = !fxInside(it.footIn, R) ? `${name} runs into a wall` : null;
  if (!r) for (const s of R.swings) if (fxOverlap(it.foot, s.poly, tol)) { r = `${name} is in the swing of door ${s.door}`; break; }
  if (!r) for (const z of it.zones) if (!fxInside(z.qIn, R)) { r = `${z.use} clearance of ${name} runs into a wall`; break; }
  if (key) cache.set(key, r);
  return r;
}
/** What a block gets wrong with one other: overlapping it, standing in its clearances, its clearances blocked by it. */
function fxPair(it, o, tol) {
  const name = it.def.name;
  if (fxOverlap(it.foot, o.foot, tol)) return `${name} overlaps ${o.def.name}`;
  for (const z of o.zones) if (!(z.allow || []).includes(it.kind) && !z.clearOf && fxOverlap(it.foot, z.q, tol)) return `${name} stands in the ${z.use} clearance of ${o.def.name}`;
  for (const z of it.zones) {
    if (!(z.allow || []).includes(o.kind) && fxOverlap(z.q, o.foot, tol)) return `${z.use} clearance of ${name} is blocked by ${o.def.name}`;
    if (z.clearOf) for (const oz of o.zones) if (z.clearOf.includes(oz.use) && fxOverlap(z.q, oz.q, tol + 15)) return `less than 900 behind the chairs of ${name}`;
  }
  return null;
}
/** The room on a grid in the frame of its first edge: outside, holes and columns blocked. Kept per room and step. */
function fxRoomGrid(R, step) {
  const key = "g" + step; if (R[key]) return R[key];
  const ux = normalise(sub(R.poly[1], R.poly[0])), uy = perp(ux), o = R.poly[0];
  const toF = p => [dot(sub(p, o), ux), dot(sub(p, o), uy)];
  const F = R.poly.map(toF), bb = fxBB(F), x0 = bb[0], y0 = bb[1], nx = Math.ceil((bb[2] - x0) / step) + 1, ny = Math.ceil((bb[3] - y0) / step) + 1;
  const G = { toF, x0, y0, nx, ny, N: nx * ny, step };
  if (G.N > 3e6) return (R[key] = G);
  const base = G.base = new Uint8Array(G.N).fill(1);
  // the room's cells: scanlines of the outline and its holes (even-odd)
  const loops = [F, ...R.holes.map(h => h.map(toF))];
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * step, xs = [];
    for (const L of loops) for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil((xs[k] - x0) / step - 0.5)); i < nx && x0 + (i + 0.5) * step <= xs[k + 1]; i++) base[j * nx + i] = 0;
  }
  for (const ob of R.obstacles) fxCells(G, ob.poly, k => { base[k] = 1; });
  return (R[key] = G);
}
/** The grid cells whose centres lie in a convex polygon. */
function fxCells(G, Q, fn) {
  const { x0, y0, nx, ny, step } = G, q = Q.map(G.toF), b = fxBB(q);
  for (let j = Math.max(0, Math.floor((b[1] - y0) / step)); j < ny && y0 + j * step <= b[3]; j++) {
    const y = y0 + (j + 0.5) * step; let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < q.length; i++) { const a = q[i], c = q[(i + 1) % q.length]; if ((a[1] > y) !== (c[1] > y)) { const x = a[0] + (y - a[1]) * (c[0] - a[0]) / (c[1] - a[1]); if (x < lo) lo = x; if (x > hi) hi = x; } }
    for (let i = Math.max(0, Math.ceil((lo - x0) / step - 0.5)); i < nx && x0 + (i + 0.5) * step <= hi; i++) fn(j * nx + i);
  }
}
/** Can an 800 mm wide walker (or 1200 on an open-plan floor) get from the room's doors to each use zone? Rasterised at 50 mm. */
function fxRoute(R, items, uses, half = 400, step = 50) {
  const G = fxRoomGrid(R, step); if (!G.base) return { unreached: [] };
  const { toF, x0, y0, nx, ny, N } = G, blocked = G.base.slice();
  const cellsOf = (Q, fn) => fxCells(G, Q, fn);
  for (const it of items) cellsOf(it.foot, k => { blocked[k] = 1; });
  const D = fxEdt(blocked, nx, ny, step), walk = new Uint8Array(N);
  // a cell's distance is to the centre of the nearest blocked cell, half a cell past the obstacle's edge: a 750 gap would
  // pass as 800 without the half cell
  const need = (half + step / 2) ** 2;
  for (let k = 0; k < N; k++) walk[k] = D[k] >= need ? 1 : 0;
  // seeds: the walker steps in through each door; the first cell clear for it within a stride of the door
  const reach = new Uint8Array(N), stack = [];
  for (const dr of R.doors) {
    const p = toF(add(dr.Q, mul(dr.n, half + 60))), ci = Math.floor((p[0] - x0) / step), cj = Math.floor((p[1] - y0) / step);
    let best = -1, bd = Infinity; const rr = Math.ceil((half + 150) / step);
    for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) { if (i < 0 || j < 0 || i >= nx || j >= ny || !walk[j * nx + i]) continue; const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = j * nx + i; } }
    if (best >= 0 && !reach[best]) { reach[best] = 1; stack.push(best); }
  }
  const go = kk => { if (walk[kk] && !reach[kk]) { reach[kk] = 1; stack.push(kk); } };
  while (stack.length) { const k = stack.pop(), i = k % nx; if (i > 0) go(k - 1); if (i < nx - 1) go(k + 1); if (k >= nx) go(k - nx); if (k < N - nx) go(k + nx); }
  // what the walker's body sweeps: every cell within half a route of where its centre can go - a zone the walker stands
  // in is reached outright; only the others need that sweep worked out
  const lim = (half + step) ** 2, unreached = [];
  let D2 = null;
  for (const u of uses) {
    let inside = 0; cellsOf(u.q, k => { if (reach[k]) inside++; });
    if (inside >= 2) continue;
    if (!D2) D2 = fxEdt(reach, nx, ny, step);
    let hit = 0; cellsOf(u.q, k => { if (!blocked[k] && D2[k] <= lim) hit++; }); if (hit < 2) unreached.push(u);
  }
  return { unreached, grid: { nx, ny, reach, blocked, walk } };
}
/** Squared distance (mm²) from each cell to the nearest source cell (src = 1): Felzenszwalb's two passes. */
// scratch for the transform, grown as rooms need: the fitters call it thousands of times and fresh arrays were a third of
// the time in garbage. The result is valid until the next call.
const FX_EDT = { f: new Float64Array(0), g: new Float64Array(0), v: new Int32Array(0), z: new Float64Array(0), d: new Float64Array(0) };
function fxEdt(src, nx, ny, step) {
  const INF = 1e20, N = nx * ny, n = Math.max(nx, ny);
  if (FX_EDT.f.length < N) FX_EDT.f = new Float64Array(N);
  if (FX_EDT.g.length < n) { FX_EDT.g = new Float64Array(n); FX_EDT.v = new Int32Array(n); FX_EDT.z = new Float64Array(n + 1); FX_EDT.d = new Float64Array(n); }
  const { f, g, v, z, d } = FX_EDT;
  for (let k = 0; k < N; k++) f[k] = src[k] ? 0 : INF;
  // one 1D pass over g[0..m) into d; a line with no source stays out of reach
  const pass = m => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < m; q++) {
      let s; do { const p = v[k]; s = ((g[q] + q * q) - (g[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k]) k--; else break; } while (k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0; for (let q = 0; q < m; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + g[p]; }
  };
  for (let j = 0, o = 0; j < ny; j++, o += nx) {
    let any = false; for (let i = 0; i < nx; i++) { g[i] = f[o + i]; if (g[i] === 0) any = true; }
    if (!any) continue;
    pass(nx); for (let i = 0; i < nx; i++) f[o + i] = d[i];
  }
  for (let i = 0; i < nx; i++) {
    let any = false; for (let j = 0, k = i; j < ny; j++, k += nx) { g[j] = f[k]; if (g[j] < INF) any = true; }
    if (!any) continue;
    pass(ny); for (let j = 0, k = i; j < ny; j++, k += nx) f[k] = d[j];
  }
  const s2 = step * step; for (let k = 0; k < N; k++) f[k] *= s2;
  return f;
}
/** The approach to each door the room must keep clear: its width and 900 deep, on this side. */
const fxDoorZones = R => R.doors.map(dr => { const t = perp(dr.n), w = Math.max(dr.w, 800) / 2 + 50; return { use: `the way to door ${dr.id}`, door: dr, q: [add(dr.Q, mul(t, -w)), add(dr.Q, mul(t, w)), add(add(dr.Q, mul(t, w)), mul(dr.n, 900)), add(add(dr.Q, mul(t, -w)), mul(dr.n, 900))] }; });
/** The window: a strip 600 deep along the room's longest facade run - reached if the walker gets to it anywhere. */
function fxWindowZone(M, R) {
  const f = fxRuns(M, R).filter(r => r.kind === "facade" && r.len > 900).sort((a, b) => b.len - a.len)[0]; if (!f) return null;
  const m = add(f.a, mul(f.d, f.len / 2)), t = f.d, n = f.nIn, h = f.len / 2 - 100, o = f.inset + 20;
  return { use: "the window", q: [add(add(m, mul(t, -h)), mul(n, o)), add(add(m, mul(t, h)), mul(n, o)), add(add(m, mul(t, h)), mul(n, o + 600)), add(add(m, mul(t, -h)), mul(n, o + 600))] };
}
const FX_NEEDS = {
  key: [["bed", 1], ["nightstand", 2], ["desk", 1], ["chair", 1], ["wardrobe", 1]],
  bath: [["wc", 1], ["basin", 1], ["shower|bath", 1]],
};
/** Everything that is wrong with a level's fit-out: access, clearances, routes, programme. Rooms with no problems pass. */
export function checkFitout(doc, levelId) {
  const M = fitModel(doc, levelId), acc = fxAccess(M), rooms = [];
  const items = M.fixtures.map(f => { const t = doc.argValue(f, "fixtureType"); if (!t || !doc.lib.types[t.ref] || !doc.lib.types[t.ref].fit) return null;
    return fxPlace(doc, t.ref, doc.argValue(f, "position"), doc.argValue(f, "rotation") || 0, !!doc.argValue(f, "mirror"), null); }).filter(Boolean);
  for (const it of items) it.roomRef = fxRoomAt(M, fxCentroid(it.foot));
  for (const R of M.rooms) {
    const problems = [], a = acc.get(R.id);
    if (!a.ok) problems.push(`no way in from circulation: ${a.how}`);
    const mine = items.filter(it => it.roomRef === R);
    for (const it of mine) { const p = fxClash(R, it, mine); if (p) problems.push(p); }
    const kind = fxKind(R);
    if (FX_NEEDS[kind === "suite" ? "key" : kind]) for (const [k, n] of FX_NEEDS[kind === "suite" ? "key" : kind]) { const c = mine.filter(it => new RegExp("^(" + k + ")$").test(it.kind)).length; if (c < n) problems.push(`needs ${n} ${k.replace("|", " or ")}, has ${c}`); }
    if (mine.length && R.doors.length && !fxIsVoid(R)) for (const u of fxUnreached(M, R, mine)) problems.push(`cannot reach ${/clearance|door|window/.test(u.use) ? u.use : "the " + u.use + " zone"}`);
    for (const p of fxLiftProblems(M, R, mine)) problems.push(p);
    rooms.push({ id: R.id, name: R.name, number: R.f ? doc.getParam(R.f, "Number") || "" : "", at: fxCentroid(R.poly).map(Math.round), ok: problems.length === 0, problems: [...new Set(problems)] });
  }
  const failed = rooms.filter(r => !r.ok);
  return { rooms, summary: { rooms: rooms.length, passed: rooms.length - failed.length, failed: failed.length, fixtures: items.length } };
}
/** The use zones a walker cannot reach: every block's, every door's when there is more than one, a key's window. An
 *  open-plan floor's doors must also be reached by its 1200 primary route; everything else by an 800 one. */
function fxUnreached(M, R, items, extra = []) {
  const uses = [...items.flatMap(it => it.zones.filter(z => z.route)), ...fxDoorZones(R).filter(() => R.doors.length > 1), ...extra];
  const win = fxWindowZone(M, R); if (win && fxIsGuest(R)) uses.push(win);
  const out = fxRoute(R, items, uses, 400).unreached;
  if (/open-plan|^tenancy/i.test(R.name)) out.push(...fxRoute(R, items, uses.filter(u => u.door), 600).unreached.filter(u => !out.includes(u)));
  return out;
}
/** Take out, last placed first, the groups whose use zones cannot be reached, until everything left can be. A door or a
 *  window out of reach with the room empty is the plan's to answer, not the furniture's: it is left to the checker. */
function fxPrune(X) {
  const given = new Set(fxUnreached(X.M, X.R, [], X.uses || []).map(u => u.use + (u.door ? u.door.id : "")));
  for (let k = 0; k < 40; k++) {
    const un = fxUnreached(X.M, X.R, X.items, X.uses || []).filter(u => !given.has(u.use + (u.door ? u.door.id : ""))); if (!un.length) return;
    const owners = new Set(X.items.filter(it => it.zones.some(z => un.includes(z))).map(it => it.gid));
    const gid = Math.max(...(owners.size ? owners : new Set(X.items.map(it => it.gid))));
    if (!Number.isFinite(gid)) return;
    X.items = X.items.filter(it => it.gid !== gid);
  }
}
/** Lift landings: 1500 clear in front of each lift door - of walls and of furniture - and 3000 between lifts that face each other. */
function fxLiftProblems(M, R, items = []) {
  const out = [], lifts = R.doors.filter(dr => dr.to && /^lift/i.test(M.byId.get(dr.to).name));
  for (const dr of lifts) {
    const t = perp(dr.n), h = dr.w / 2, q = [add(dr.Q, mul(t, -h)), add(dr.Q, mul(t, h)), add(add(dr.Q, mul(t, h)), mul(dr.n, 1500)), add(add(dr.Q, mul(t, -h)), mul(dr.n, 1500))];
    if (!fxInside(q.map((p, i) => add(p, mul(add(mul(dr.n, i < 2 ? 12 : -12), mul(t, i === 0 || i === 3 ? 12 : -12)), 1))), R)) out.push(`less than 1500 clear in front of the lift from ${dr.id}`);
    for (const it of items) if (fxOverlap(it.foot, q)) out.push(`${it.def.name} stands in the landing of the lift from ${dr.id}`);
    for (const o of lifts) { const gap = dot(sub(o.Q, dr.Q), dr.n); if (o !== dr && dot(o.n, dr.n) < -0.95 && Math.abs(dot(sub(o.Q, dr.Q), t)) < h + o.w / 2 && gap > 0 && gap < 3000 - 5) out.push(`facing lifts ${dr.id} and ${o.id} are less than 3000 apart`); }
  }
  return out;
}

// ---------------------------------------------------------------- the fitters
const fxIsGuest = R => R.dept === "Guest room";
function fxKind(R) {
  const n = R.name;
  if (R.dept === "Bath") return "bath";
  if (R.dept === "Guest room") return /suite/i.test(n) ? "suite" : "key";
  if (/^lift/i.test(n)) return "lift";
  if (/open-plan|^tenancy/i.test(n)) return "openplan";
  if (/team suite/i.test(n)) return "team";
  if (/private office/i.test(n)) return "private";
  if (/corner office/i.test(n)) return "corneroffice";
  if (/boardroom|conference|meeting/i.test(n)) return "meeting";
  if (/phone/i.test(n)) return "phone";
  if (/pantry|kitchen/i.test(n)) return "pantry";
  if (/quiet/i.test(n)) return "quiet";
  if (/^comms/i.test(n)) return "comms";
  if (/print|mail/i.test(n)) return "print";
  if (/^accessible wc/i.test(n)) return "accwc";
  if (/^wc$/i.test(n)) return "wc";
  if (/locker|shower/i.test(n)) return "lockers";
  if (/lounge/i.test(n)) return "lounge";
  if (/event|training/i.test(n)) return "training";
  if (/store|linen|parcel|cleaner|back of house/i.test(n)) return "store";
  return null;
}
/** A fitting session for one room: what is placed, what must stay clear, and the candidates along its walls. */
function fxCtx(M, R, routed = true) {
  fxRuns(M, R);
  return { M, R, doc: M.doc, items: [], reserved: fxDoorZones(R), score: 0, routed, uses: R.doors.length > 1 ? fxDoorZones(R) : [] };
}
const fxRot = d => Math.atan2(d[1], d[0]) * 180 / Math.PI;
/** Members of a group, each [typeId, dx, dy, drot, mirror] in the group's frame, put down at a pose. */
function fxGroup(doc, members, pos, rot) {
  const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180);
  return members.map(([tid, dx, dy, dr, mir]) => fxPlace(doc, tid, [pos[0] + dx * c - dy * s, pos[1] + dx * s + dy * c], rot + (dr || 0), !!mir));
}
/** Try a group: every member must clear the room, the others placed and the reserved approaches. */
function fxTry(X, group) {
  const all = X.items.concat(group);
  // 1 mm here against the checker's 5: positions are saved to 0.1 mm and turns to 0.01°, which moves an edge by up to 0.2 mm
  for (const it of group) if (fxClash(X.R, it, all, X.reserved, 1)) return false;
  return true;
}
/** Poses along the room's wall runs for a group w wide: the back on the run's face, facing into the room. */
function* fxAlong(X, w, { kinds = ["wall"], step = 100, filter = null, margin = 0 } = {}) {
  for (const run of X.R.lines) {
    if (!kinds.includes(run.kind) || run.len < w + 2 * margin || (filter && !filter(run))) continue;
    const n = Math.max(1, Math.floor((run.len - w - 2 * margin) / step));
    for (let i = 0; i <= n; i++) {
      const t = w / 2 + margin + (run.len - w - 2 * margin) * (n ? i / n : 0.5);
      for (const off of run.inset > 5 ? [run.inset + 2, run.inset + 60] : [2]) yield { run, t, pos: add(add(run.a, mul(run.d, t)), mul(run.nIn, off)), rot: fxRot(run.d) };
    }
  }
}
/** The best-scoring group that fits, put in the room; null when none does. */
let fxGid = 0;
function fxBest(X, cands, make, score) {
  const g = fxRank(X, cands, make, score, 1)[0];
  if (g) { const gid = ++fxGid; for (const it of g) it.gid = gid; X.items.push(...g); X.score += g.score; }
  return g || null;
}
/** The n best-scoring groups that fit, best first, each remembering the wall run it stands on. In a routed session a group
 *  that cuts the walker off from anything already placed (or from a door, the window) is refused there and then: a
 *  wardrobe in the neck between a suite's gallery and its bedroom passed every clearance and blocked the room. */
function fxRank(X, cands, make, score, n, per = Infinity) {
  const scored = cands.map(c => ({ c, s: score(c) })).sort((a, b) => b.s - a.s), out = [], perRun = new Map();
  let tries = 0;
  for (const { c, s } of scored) {
    if ((perRun.get(c.run) || 0) >= per) continue;
    const g = make(c); if (!g || !fxTry(X, g)) continue;
    perRun.set(c.run, (perRun.get(c.run) || 0) + 1);
    if (X.routed && n === 1) {
      const all = X.items.concat(g), uses = all.flatMap(it => it.zones.filter(z => z.route)).concat(X.uses || []);
      // a 100 mm grid while placing (a quarter of the cells); the prune and the checker judge at 50
      if (fxRoute(X.R, all, uses, X.half || 400, 100).unreached.length) { if (++tries > 12) break; continue; }
    }
    for (const it of g) it.runRef = c.run; g.score = s; out.push(g);
    if (out.length >= n) break;
  }
  return out;
}
const fxDistToRuns = (p, runs) => Math.min(Infinity, ...runs.map(r => { const t = Math.max(0, Math.min(r.len, dot(sub(p, r.a), r.d))); return dist(p, add(r.a, mul(r.d, t))); }));
const fxFacades = X => X.R.runs.filter(r => r.kind === "facade");

/** Candidate groups that clear the room on their own, each remembering its candidate (and the wall line it stands on). */
function fxPool(R, cands, make) {
  return cands.map(c => { const g = make(c); if (!g || g.some(it => fxAlone(R, it, 1))) return null; for (const it of g) it.runRef = c.run; g.c = c; return g; }).filter(Boolean);
}
/** The n best pooled groups that clear what is placed and what is kept clear, at most `per` from one wall line; a route
 *  test (when given) must pass too, and a dozen failures end the search. */
function fxPick(items, reserved, groups, score, n, per = Infinity, routeOk = null, maxFails = 12) {
  const out = [], count = new Map(); let fails = 0;
  for (const g of groups.map(g => [g, score(g)]).sort((a, b) => b[1] - a[1]).map(x => (x[0].s = x[1], x[0]))) {
    if ((count.get(g.c.run) || 0) >= per) continue;
    if (g.some(it => reserved.some(z => fxOverlap(it.foot, z.q, 1)) || items.some(o => fxPair(it, o, 1) || fxPair(o, it, 1)))) continue;
    if (routeOk && !routeOk(g)) { if (++fails > maxFails) break; continue; }
    count.set(g.c.run, (count.get(g.c.run) || 0) + 1); out.push(g); if (out.length >= n) break;
  }
  return out;
}
/** A guest bathroom: a door off the key, then a shower (or bath), WC and basin round it. Returns the door it needs. */
function fxFitBath(M, B, K, entry, opts) {
  const doc = M.doc, suite = opts.suite, have = B.doors.find(d => d.to === K.id);
  const entryZone = entry && fxDoorZones(K).find(z => z.door === entry);
  // where the door can go: on a wall shared with the key, its leaf opening out into the key - inside the key, clear of
  // the entry door's swing and of the way in at the entry; of the two hands, the one whose leaf ends further from the entry
  const doors = have ? [{ existing: have }] : [];
  if (!have) for (const run of B.runs.filter(r => r.nb === K.id && r.kind === "wall" && r.len >= 1000)) for (let t = 500; t <= run.len - 500; t += 100) {
    const ok = [0, 1].map(h => fxNewDoor(M, B, K, run, t, 800, h)).filter(d => d && fxInside(fxShrink(d.swing, 15), K) && !K.swings.some(s => fxOverlap(d.swing, s.poly, 2)) && !(entryZone && fxOverlap(d.swing, entryZone.q, 2)));
    if (!ok.length) continue;
    if (entry) ok.sort((a, b) => dist(fxCentroid(b.swing), entry.Q) - dist(fxCentroid(a.swing), entry.Q));
    doors.push({ run, door: ok[0] });
  }
  // nearest the entry first: the first door position that takes a full bathroom is the one kept
  if (entry) doors.sort((a, b) => (a.door ? dist(a.door.mid, entry.Q) : 0) - (b.door ? dist(b.door.mid, entry.Q) : 0));
  // the wet zone: a walk-in shower across a short end, its X tray the width of the room (the rooms are often
  // parallelograms - a curved plate's frame skews them 5-7° - so the widest tray that clears the angled side wins;
  // 900 deep where it fits, else 800: a 2.4 × 1.9 bath is 2.24 m long inside, and tray, WC zone 800 and a 500 basin on
  // one wall need 2.2 m at 900); in a suite a bath first, with a separate shower if there is room
  // every placement below is tested against the room once (walls, swings, its own clearances inside); a door position
  // and the fixtures already chosen then only add the pairwise tests - the room tests were 9 in 10 of the work
  const Y0 = { R: B }, pool = (cands, make) => fxPool(B, cands, make);
  const pick = (items, reserved, groups, score, n, run, per) => fxPick(items, reserved, groups.filter(g => !(run && (g.c.run === run || (g.c.run.parts || []).includes(run)))), score, n, per);
  const longest = Math.max(...B.runs.map(r => r.len)), tid = {};
  const T = (k, p) => tid[k + Object.values(p).join("x")] || (tid[k + Object.values(p).join("x")] = fixtureType(doc, k, p));
  const showerPool = pool(B.runs.filter(r => r.kind === "wall" && r.len >= 810 && r.len <= (suite ? 2800 : 2100)).flatMap(run => {
    const out = [];
    for (const d of [900, 800]) for (let w = Math.min(1800, Math.floor((run.len - 10) / 50) * 50); w >= (d === 800 ? 800 : 900); w -= 100) for (let t = w / 2 + 5; t <= run.len - w / 2 - 5; t += 50) for (const mir of [false, true]) out.push({ run, w, d, mir, pos: add(add(run.a, mul(run.d, t)), mul(run.nIn, run.inset + 2)), rot: fxRot(run.d) });
    return out; }), p => [fxPlace(doc, T("shower", { w: p.w, d: p.d, open: p.w >= 1500 ? 700 : p.w }), p.pos, p.rot, p.mir)]);
  const bathPool = suite ? pool([...fxAlong(Y0, 1700, { step: 50 })], p => [fxPlace(doc, T("bath", { w: 1700 }), p.pos, p.rot)]) : [];
  const cornerPool = suite ? pool([...fxAlong(Y0, 900, { step: 50 })].flatMap(p => [false, true].map(mir => Object.assign({ mir }, p))), p => [fxPlace(doc, T("shower", { w: 900, d: 900, open: 900 }), p.pos, p.rot, p.mir)]) : [];
  const wcPool = pool([...fxAlong(Y0, 800, { step: 50 })], p => [fxPlace(doc, T("wc", {}), p.pos, p.rot)]);
  const basinPool = pool([...fxAlong(Y0, 450, { step: 50 })].flatMap(p => [600, 500, 450].map(w => Object.assign({ w }, p))), p => [fxPlace(doc, T("basin", { w: p.w }), p.pos, p.rot)]);
  let best = null, partial = null;
  for (const c of doors) {
    const door = c.door || null, doorRun = c.run || null, doorN = door ? door.asRoomDoor.n : c.existing.n;
    const reserved = door ? [door.inside] : fxDoorZones(B);
    const Bd = door ? Object.assign({}, B, { doors: B.doors.concat([door.asRoomDoor]) }) : B;
    const wets = [];
    for (const g of pick([], reserved, bathPool, g => -dot(g.c.run.nIn, doorN) * 100, 3, doorRun)) {
      const sh = pick(g, reserved, cornerPool, () => 0, 1, doorRun)[0];
      if (sh) wets.push(g.concat(sh));
      wets.push(g);
    }
    // a shower across an end of the room rather than along a side (the longest wall is a side), four per wall at most
    wets.push(...pick([], reserved, showerPool, g => g.c.w + g.c.d * 0.2 - (g.c.run.len > 0.95 * longest ? 1500 : 0), 12, doorRun, 4));
    // and the smallest trays, for a room the wide ones fill (a wedge of a bath at a curved facade's corner)
    wets.push(...pick([], reserved, showerPool.filter(g => g.c.w <= 1000), g => -g.c.w - g.c.d * 0.2 - (g.c.run.len > 0.95 * longest ? 1500 : 0), 8, doorRun, 2));
    if (!wets.length) wets.push([]);        // too small for a tray: the WC and basin still go in, and the check says so
    // then the WC and the basin, side by side on the wall facing the door where they fit
    let found = null;
    const facing = r => dot(r.nIn, doorN) < -0.9 ? 1000 : 0;
    for (const wet of wets) {
      for (const wc of pick(wet, reserved, wcPool, g => facing(g.c.run) - (wet.length ? Math.min(...wet.map(w => dist(g[0].pos, fxCentroid(w.foot)))) : 0) * 0.2, 5)) {
        const basin = pick(wet.concat(wc), reserved, basinPool, g => g.c.w + facing(g.c.run) + (g.c.run === wc.c.run ? 500 : 0) - dist(g[0].pos, wc[0].pos) * 0.3, 1)[0];
        const items = wet.concat(wc, basin || []);
        const reachable = !fxRoute(Bd, items, items.flatMap(it => it.zones.filter(z => z.route))).unreached.length;
        if (!basin || !reachable) { if (reachable && (!partial || partial.items.length < items.length)) partial = { items, door }; continue; }
        found = { items }; break;
      }
      if (found) break;
    }
    if (!found) continue;
    // the door near the key's entry, off the passage
    const s = found.items.length * 2000 + (found.items.some(i => i.kind === "bath") ? 3000 : 0) - (door && entry ? dist(door.mid, entry.Q) * 0.5 : 0);
    if (!best || s > best.s) best = { s, items: found.items, door };
    if (found.items.length >= (suite ? 4 : 3)) break;                // shower, WC, basin - and a bath in a suite
  }
  // nothing complete: the most that fits, with its door, so the room is drawn and the check says what is missing
  return best || (partial && { s: -Infinity, items: partial.items, door: partial.door });
}
const fxShrink = (P, d) => { const c = fxCentroid(P); return P.map(p => { const v = sub(c, p), l = len(v); return l > d ? add(p, mul(v, d / l)) : c; }); };
/** A door to add: an opening in the wall under a run of room A at t, swinging out into room B. */
function fxNewDoor(M, A, B, run, t, width, hinge) {
  const P = add(run.a, mul(run.d, t));
  const w = run.walls.find(x => Math.abs(dot(sub(P, x.a), perp(x.d))) < Math.max(Math.abs(x.s0), Math.abs(x.s1)) + 30 && dot(sub(P, x.a), x.d) > width / 2 + 60 && dot(sub(P, x.a), x.d) < x.L - width / 2 - 60);
  if (!w) return null;
  const at = dot(sub(P, w.a), w.d), n = perp(w.d), C = add(w.a, mul(w.d, at));
  if (M.holes.some(h => h.wall === w && Math.abs(h.at - at) < (h.w + width) / 2 + 100)) return null;
  // the side the leaf swings to is room B's: +s (the wall's left) or -s
  const far = Math.max(Math.abs(w.s0), Math.abs(w.s1)) + 150, sg = fxRoomAt(M, add(C, mul(n, far))) === B ? 1 : fxRoomAt(M, add(C, mul(n, -far))) === B ? -1 : 0;
  if (!sg) return null;
  const sFace = sg > 0 ? w.s1 : w.s0, sInt = w.w.stack.s[w.w.stack.s.length - 1], sExt = w.w.stack.s[0];
  const flipFacing = Math.sign(sInt - sExt) !== sg, frame = 40, leaf = width - 2 * frame;
  const uh = hinge ? at + width / 2 - frame : at - width / 2 + frame, H = add(add(w.a, mul(w.d, uh)), mul(n, sFace));
  const closed = mul(w.d, hinge ? -1 : 1), open = mul(n, sg);
  const swing = fxSwingPoly({ hinge: H, closed, open, len: leaf, swingDeg: 90 });
  const faceA = add(C, mul(n, -sg * Math.abs(sg > 0 ? w.s0 : w.s1))), nA = mul(n, -sg), tt = w.d, hw = width / 2 + 50;
  const inside = { use: "the way in", q: [add(faceA, mul(tt, -hw)), add(faceA, mul(tt, hw)), add(add(faceA, mul(tt, hw)), mul(nA, 600)), add(add(faceA, mul(tt, -hw)), mul(nA, 600))] };
  const faceB = add(C, mul(n, sFace));
  return { wall: w, at: Math.round(at), width, flipFacing, flipHand: !!hinge, swing, mid: faceB, inside,
    asRoomDoor: { id: "new", Q: faceA, n: nA, dir: w.d, w: width, to: B.id }, keyDoor: { id: "new", Q: faceB, n: mul(n, sg), dir: w.d, w: width, to: A.id } };
}

/** A door into a room with no way in, from the circulation beside it: on the longest wall it shares with a corridor or
 *  lobby, as near the middle as the wall's other openings allow, swinging into the room (into a stair, the way out).
 *  With no circulation beside it, from a room off circulation it may open off (a store off the back of house). */
function fxAccessDoor(M, R, acc) {
  const width = /^stair/i.test(R.name) ? 1015 : 915, circ = r => fxIsCirc(M.byId.get(r.nb)) ? 1 : 0;
  const runs = fxRuns(M, R).filter(r => r.nb && (r.kind === "wall" || r.kind === "glass") && r.len >= width + 400 && acc.get(r.nb).ok
    && (circ(r) || (["circulation", "direct"].includes(acc.get(r.nb).how) && fxParentOk(M.byId.get(r.nb), R)))).sort((a, b) => circ(b) - circ(a) || b.len - a.len);
  for (const run of runs) {
    const ts = []; for (let t = width / 2 + 200; t <= run.len - width / 2 - 200; t += 100) ts.push(t);
    ts.sort((a, b) => Math.abs(a - run.len / 2) - Math.abs(b - run.len / 2));
    for (const t of ts) for (const h of [0, 1]) { const d = fxNewDoor(M, M.byId.get(run.nb), R, run, t, width, h); if (d && fxInside(fxShrink(d.swing, 15), R)) return d; }
  }
  // a curved corridor wall drawn as pieces of 0.2-1.0 m holds no door: two or three neighbouring pieces with no opening
  // become one straight wall between their outer ends (over 1.6 m of a 15 m radius the chord is 20 mm off the arc)
  for (const run of runs) {
    const ws = run.walls, cands = [];
    for (let i = 0; i < ws.length; i++) for (let k = 2; k <= 3 && i + k <= ws.length; k++) {
      const ch = ws.slice(i, i + k);
      if (ch.some(w => w.typeId !== ch[0].typeId || M.holes.some(h => h.wall === w))) continue;
      const ends = ch.map(w => [w.a, w.b]); let ok = true;
      for (let j = 0; j + 1 < k; j++) if (Math.min(...ends[j].flatMap(p => ends[j + 1].map(q => dist(p, q)))) > 250) ok = false;
      if (!ok) continue;
      const far = (j, other) => ends[j].slice().sort((p, q) => Math.min(...ends[other].map(e => dist(q, e))) - Math.min(...ends[other].map(e => dist(p, e))))[0];
      let a = far(0, 1), b = far(k - 1, k - 2);
      if (dot(sub(b, a), ch[0].d) < 0) [a, b] = [b, a];
      const L = dist(a, b); if (L < width + 300) continue;
      cands.push({ ch, a, b, L, mid: Math.abs(dot(sub(mul(add(a, b), 0.5), run.a), run.d) - run.len / 2) });
    }
    cands.sort((x, y) => x.mid - y.mid);
    for (const c of cands) {
      const w0 = c.ch[0], d = normalise(sub(c.b, c.a)), n = perp(d), at = c.L / 2, C = add(c.a, mul(d, at)), far = Math.max(Math.abs(w0.s0), Math.abs(w0.s1)) + 150;
      const sg = fxRoomAt(M, add(C, mul(n, far))) === R ? 1 : fxRoomAt(M, add(C, mul(n, -far))) === R ? -1 : 0; if (!sg) continue;
      const s = w0.w.stack.s, sFace = sg > 0 ? w0.s1 : w0.s0, H = add(add(c.a, mul(d, at - width / 2 + 40)), mul(n, sFace));
      // tested against today's outline, which bows past the chord by the sagitta: the leaf's sweep, less 80 at its edges
      const swing = fxSwingPoly({ hinge: H, closed: d, open: mul(n, sg), len: width - 80, swingDeg: 90 });
      if (!fxInside(fxShrink(swing, 80), R)) continue;
      return { merge: c.ch.map(w => w.id), from: w0.id, line: { type: "line", start: c.a.map(Math.round), end: c.b.map(Math.round) }, at: Math.round(at), width, flipFacing: Math.sign(s[s.length - 1] - s[0]) !== sg, flipHand: false };
    }
  }
  return null;
}
/** A hotel key or suite: bed between nightstands on a wall, TV facing it, desk and chair, armchair by the window, wardrobe off the entry. */
function fxFitKey(M, K, opts) {
  const doc = M.doc, suite = opts.suite, entry = K.doors.find(d => d.to && fxIsCirc(M.byId.get(d.to))) || K.doors[0];
  if (!entry) return null;
  const facades = () => K.runs.filter(r => r.kind === "facade");
  const depth = p => dot(sub(p, entry.Q), entry.n);
  const dFac = Math.max(...K.poly.map(depth));
  const T = {
    ns: fixtureType(doc, "nightstand"), chair: fixtureType(doc, "chair"), arm: fixtureType(doc, "armchair"), side: fixtureType(doc, "sidetable"), lug: fixtureType(doc, "luggage"),
  };
  const bedCands = [];
  // king between 500 nightstands; queen; queen between 400s; a 1400 double between 400s for the smallest wedge keys
  for (const [bw, nw, pen] of [[1800, 500, 0], [1600, 500, 400], [1600, 400, 700], [1400, 400, 1200]]) {
    const bed = fixtureType(doc, "bed", { w: bw }), ns = nw === 500 ? T.ns : fixtureType(doc, "nightstand", { w: nw }), gw = bw + 80 + 2 * (nw + 20);
    for (const p of fxAlong({ R: K }, gw, { step: 100, kinds: ["wall"], filter: r => !r.doors.some(d => d.door === entry) })) {
      const g = fxGroup(doc, [[bed, 0, 0], [ns, -(bw / 2 + 60 + nw / 2), 0], [ns, bw / 2 + 60 + nw / 2, 0]], p.pos, p.rot);
      const c = fxCentroid(g[0].foot), side = Math.abs(dot(p.run.d, entry.n)) > 0.7;
      // the bed in the room's sleeping half, its head on a side wall, short of the window zone; a suite's bed as far
      // from its front door as it goes, so the gallery by the door is the sitting room
      const s = (side ? 2000 : 0) + (suite ? dist(c, entry.Q) : -Math.abs(depth(c) - dFac * 0.55)) - pen;
      bedCands.push({ g, s, bw: bw + "/" + nw, run: p.run });
    }
  }
  bedCands.sort((a, b) => b.s - a.s);
  const win = fxWindowZone(M, K), keyUses = fxDoorZones(K).filter(z => z.door !== entry).concat(opts.reserved || [], win ? [win] : []);
  // furnish around a dozen beds that fit and leave the room passable - no more than three from one wall and size, so a
  // wall whose beds all crowd the window is not all that gets tried - out of up to 80 looked at
  let best = null, tried = 0, looked = 0;
  const perRun = new Map();
  // the rest of the furniture, tried against the room once and then against each bed's layout pairwise
  const Y0 = { R: K }, pools = {}, fac = facades();
  const lazy = (k, f) => pools[k] || (pools[k] = f());
  const along = (w, kinds, widths, make) => fxPool(K, [...fxAlong(Y0, w, { step: 50, kinds })].flatMap(p => widths.map(x => Object.assign({ x }, p))), make);
  const free = (tid, size, rots = [0]) => { const bb = K.bb, run = K.runs.slice().sort((a, b) => b.len - a.len)[0], base = fxRot(run.d), cands = [];
    for (let x = bb[0] + size / 2; x <= bb[2] - size / 2; x += 150) for (let y = bb[1] + size / 2; y <= bb[3] - size / 2; y += 150) if (pointInPoly([x, y], K.poly)) for (const r of rots) cands.push({ pos: [x, y], rot: base + r, run: null });
    return fxPool(K, cands, p => [fxPlace(doc, tid, p.pos, p.rot)]); };
  // the desk in a corner suite's bedroom: its first 12 places by the window all cut the walker off from the bed's side
  const put = (X, groups, score, maxFails = 12) => {
    const g = fxPick(X.items, X.reserved, groups, score, 1, Infinity, g => { const all = X.items.concat(g); return !fxRoute(K, all, all.flatMap(it => it.zones.filter(z => z.route)).concat(keyUses), 400, 100).unreached.length; }, maxFails)[0];
    if (g) { const gid = ++fxGid; for (const it of g) it.gid = gid; X.items.push(...g); X.score += g.s; }
    return g;
  };
  for (const bc of bedCands) {
    const X = { M, R: K, doc, items: [], reserved: fxDoorZones(K).concat(opts.reserved || []), score: bc.s, routed: true, uses: keyUses };
    const rk = K.lines.indexOf(bc.run) + "/" + bc.bw; if ((perRun.get(rk) || 0) >= 3) continue;
    if (!fxTry(X, bc.g)) continue;
    if (++looked > 80) break;
    const gid = ++fxGid; for (const it of bc.g) it.gid = gid;
    X.items.push(...bc.g);
    const un = fxRoute(K, X.items, X.items.flatMap(it => it.zones.filter(z => z.route)).concat(keyUses), 400, 100).unreached;
    if (un.length) continue;
    perRun.set(rk, (perRun.get(rk) || 0) + 1);
    if (++tried > 12) break;
    const bed = bc.g[0], bedDir = [-Math.sin(bed.rot * Math.PI / 180), Math.cos(bed.rot * Math.PI / 180)], bc0 = fxCentroid(bed.foot);
    const footPt = add(bc0, mul(bedDir, 1040));
    // the TV on the wall the bed faces, on its axis
    put(X, lazy("tv", () => along(1200, ["wall"], [1600, 1200], p => [fxPlace(doc, fixtureType(doc, "tv", { w: p.x }), p.pos, p.rot)])).filter(g => dot(g.c.run.nIn, bedDir) < -0.8),
      g => -Math.abs(dot(sub(g[0].pos, bc0), perp(bedDir))) - dist(g[0].pos, footPt) * 0.2 + g.c.x * 0.2);
    // the wardrobe off the entry passage, the longest that fits
    put(X, lazy("wd", () => along(1000, ["wall"], [1500, 1200, 1000], p => [fxPlace(doc, fixtureType(doc, "wardrobe", { w: p.x }), p.pos, p.rot)])),
      g => -dist(g[0].pos, entry.Q) + g.c.x * 0.6 - (depth(g[0].pos) > dFac * 0.5 ? 3000 : 0));
    // the desk with its chair, by the window
    put(X, lazy("desk", () => along(1000, ["wall", "facade"], [1200, 1000], p => fxGroup(doc, [[fixtureType(doc, "desk", { w: p.x }), 0, 0], [T.chair, 0, 860, 180]], p.pos, p.rot))),
      g => -fxDistToRuns(g[0].pos, fac) * 1.2 + g.c.x * 0.3, 60);
    // an armchair and a side table in the window
    put(X, lazy("arm", () => along(1300, ["wall", "facade"], [false, true], p => fxGroup(doc, [[T.arm, p.x ? 260 : -260, 0], [T.side, p.x ? -400 : 400, 0]], p.pos, p.rot))),
      g => -fxDistToRuns(g[0].pos, fac) * 1.5);
    if (suite) {
      // the sitting area: a sofa and its coffee table 400 clear in front, toward the window and away from the bed (armchairs
      // at the table's ends took the sofa's legroom off the route: one sits in an armchair by the window instead); then a
      // dining table for two to four
      const sofa = fixtureType(doc, "sofa", { w: 2000 }), cof = fixtureType(doc, "coffee", { w: 1100, d: 550 });
      put(X, lazy("sofa", () => fxPool(K, [...fxAlong(Y0, 2000, { step: 100 })], p => fxGroup(doc, [[sofa, 0, 0], [cof, 0, 1300]], p.pos, p.rot))), g => -fxDistToRuns(g[0].pos, fac) + dist(g[0].pos, bc0) * 0.3);
      put(X, lazy("dine4", () => free(fixtureType(doc, "roundset", { d: 900, n: 4 }), 900)), g => -fxDistToRuns(g[0].pos, fac))
        || put(X, lazy("dine2", () => free(fixtureType(doc, "roundset", { d: 700, n: 2 }), 700)), g => -fxDistToRuns(g[0].pos, fac));
    }
    // a luggage bench near the wardrobe, if there is wall for it
    const wd = X.items.find(i => i.kind === "wardrobe");
    put(X, lazy("lug", () => along(1000, ["wall"], [0], p => [fxPlace(doc, T.lug, p.pos, p.rot)])), g => -(wd ? dist(g[0].pos, wd.pos) : dist(g[0].pos, entry.Q)));
    fxPrune(X);
    const have = k => X.items.filter(i => i.kind === k).length;
    const complete = have("bed") && have("nightstand") === 2 && have("desk") && have("chair") && have("wardrobe") && (!suite || have("sofa"));
    const s = X.score + (complete ? 20000 : 0) + X.items.length * 500 + (have("tv") ? 3000 : 0) + (have("armchair") ? 2000 : 0);
    if (!best || s > best.s) best = { s, items: X.items, complete };
    if (complete && have("tv") && have("armchair")) break;
  }
  return best;
}
/** A free-standing set (a dining table, a meeting table) on a grid of points in the room, in the frame of its longest run. */
function fxFreeSet(X, typeId, size, score, rots) {
  const R = X.R, bb = R.bb, run = R.runs.slice().sort((a, b) => b.len - a.len)[0], base = fxRot(run.d), cands = [];
  for (let x = bb[0] + size / 2; x <= bb[2] - size / 2; x += 150) for (let y = bb[1] + size / 2; y <= bb[3] - size / 2; y += 150) if (pointInPoly([x, y], R.poly)) for (const r of rots || [0]) cands.push({ pos: [x, y], rot: base + r });
  return fxBest(X, cands, p => [fxPlace(X.doc, typeId, p.pos, p.rot)], p => score(p.pos, p));
}

// ---------------------------------------------------------------- office rooms
/** The largest rectangle inside the room square to one of its runs: [frame origin, x axis, x0, y0, x1, y1]. */
function fxInscribed(R, d, step = 100) {
  const n = perp(d), o = R.poly[0], F = R.poly.map(p => [dot(sub(p, o), d), dot(sub(p, o), n)]), bb = fxBB(F);
  const nx = Math.ceil((bb[2] - bb[0]) / step), ny = Math.ceil((bb[3] - bb[1]) / step); if (nx * ny > 400000) return null;
  const inside = (i, j) => { const p = add(add(o, mul(d, bb[0] + (i + 0.5) * step)), mul(n, bb[1] + (j + 0.5) * step)); return pointInPoly(p, R.poly) && !R.holes.some(h => pointInPoly(p, h)); };
  const h = new Int32Array(nx); let best = null, ba = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) h[i] = inside(i, j) ? h[i] + 1 : 0;
    const st = [];
    for (let i = 0; i <= nx; i++) {
      const hi = i < nx ? h[i] : 0; let s = i;
      while (st.length && st[st.length - 1][1] >= hi) { const [si, sh] = st.pop(); const a = sh * (i - si); if (a > ba) { ba = a; best = [si, j - sh + 1, i, j + 1]; } s = si; }
      st.push([s, hi]);
    }
  }
  if (!best) return null;
  return { o, d, n, x0: bb[0] + best[0] * step, y0: bb[1] + best[1] * step, x1: bb[0] + best[2] * step, y1: bb[1] + best[3] * step };
}
/** Meeting tables by seats: length, width, chairs down each side, chairs at each end. */
const FX_TABLES = [[5400, 1500, 8, 1], [4800, 1400, 7, 1], [4200, 1400, 6, 1], [3600, 1200, 5, 1], [3000, 1200, 4, 1], [2400, 1100, 3, 1], [2000, 1000, 3, 0], [1600, 900, 2, 1], [1200, 900, 2, 0], [800, 800, 1, 0]];
function fxFitMeeting(M, R) {
  const X = fxCtx(M, R), want = (/(\d+)p/.exec(R.name) || [])[1] | 0;
  const runs = R.runs.slice().sort((a, b) => b.len - a.len).slice(0, 3), cands = [];
  let best = null;
  for (const run of runs) {
    const ir = fxInscribed(R, run.d); if (!ir) continue;
    for (const [l, w, nl, ne] of FX_TABLES) for (const [L, W, rot] of [[l, w, 0], [l, w, 90]]) {
      const ax = rot ? ir.y1 - ir.y0 : ir.x1 - ir.x0, ay = rot ? ir.x1 - ir.x0 : ir.y1 - ir.y0;
      if (L + (ne ? 1500 : 900) > ax || W + 1500 > ay) continue;
      const seats = 2 * nl + 2 * ne;
      const tid = fixtureType(M.doc, "meeting", { l: L, w: W, nl, ne });
      const c = add(add(ir.o, mul(ir.d, (ir.x0 + ir.x1) / 2)), mul(ir.n, (ir.y0 + ir.y1) / 2));
      for (const sh of [0, -200, 200, -400, 400]) {
        const pos = add(c, mul(rot ? ir.d : ir.n, sh)), it = fxPlace(M.doc, tid, pos, fxRot(run.d) + rot);
        if (!fxTry(X, [it])) continue;
        // the seats asked for (the room's name says how many), with 1200 behind the chairs where the room allows
        const roomy = Math.min(ay - W, ax - L) >= 2400 ? 1000 : 0;
        cands.push({ s: (want ? -Math.abs(seats - want) * 400 : seats * 300) + roomy + seats - Math.abs(sh) * 0.1, it });
      }
    }
  }
  cands.sort((a, b) => b.s - a.s);
  for (const c of cands) if (!fxRoute(R, [c.it], c.it.zones.filter(z => z.route).concat(X.uses)).unreached.length) { best = c; break; }
  if (!best) return [];
  best.it.gid = ++fxGid; X.items.push(best.it);
  // a screen on the wall at the table's end
  fxBest(X, [...fxAlong(X, 1600, { step: 100 })], p => [fxPlace(M.doc, fixtureType(M.doc, "tv", { w: 1600 }), p.pos, p.rot)], p => -Math.abs(dot(sub(p.pos, best.it.pos), [Math.cos(best.it.rot * Math.PI / 180 + Math.PI / 2), Math.sin(best.it.rot * Math.PI / 180 + Math.PI / 2)])));
  fxPrune(X);
  return X.items;
}
/** Things along the walls, as many as fit: booths, lockers, cubicles, racks, shelving. */
function fxRow(X, typeId, w, { kinds = ["wall"], max = 99, score = () => 0, step = 50 } = {}) {
  // a row runs down a long wall (cubicles across the far end of a WC left the long wall bare), the walls without a door
  // first; each next one as near the last as it fits
  const lines = X.R.lines.filter(l => kinds.includes(l.kind)), longest = Math.max(0, ...lines.map(l => l.len));
  const rank = p => (p.run.len >= 0.6 * longest ? 4000 : 0) + (p.run.doors.length ? 0 : 2000);
  let n = 0, last = null;
  while (n < max) {
    const g = fxBest(X, [...fxAlong(X, w, { kinds, step })], p => [fxPlace(X.doc, typeId, p.pos, p.rot)], p => rank(p) + (last ? -dist(p.pos, last.pos) : score(p)));
    if (!g) break; last = g[0]; n++;
  }
  return n;
}
/** Benching square to the glass: pods of desks back to back running in from each facade run, 4.0 m apart (a 1.6 m pod,
 *  two 750 chair zones and 900 between chair backs), stopping 1200 short of whatever is behind them for the main route. */
function fxBenching(X, { depth = 12000, minPairs = 2 } = {}) {
  const doc = X.doc, ws = fixtureType(doc, "workstation"), ch = fixtureType(doc, "chair");
  let desks = 0;
  const runs = X.R.runs.filter(r => r.kind === "facade" && r.len >= 4000).sort((a, b) => b.len - a.len);
  for (const run of runs) {
    for (let x = 2450; x <= run.len - 2450; x += 100) {
      // a pod at x: pairs of desks from 600 off the glass inwards, as many as fit
      let pod = null;
      for (let k = Math.floor(depth / 1600); k >= minPairs; k--) {
        const g = [];
        for (let i = 0; i < k; i++) {
          const y = run.inset + 600 + 800 + i * 1600, P = add(add(run.a, mul(run.d, x)), mul(run.nIn, y));
          // a desk each side of the pod's spine, its back on the spine, facing along the facade; its chair in front
          for (const sg of [1, -1]) { const dd = mul(run.d, sg), dRot = fxRot(dd) - 90; g.push(fxPlace(doc, ws, P, dRot), fxPlace(doc, ch, add(P, mul(dd, 1130)), dRot + 180)); }
        }
        const endZone = { use: "main route", q: (() => { const y1 = run.inset + 600 + k * 1600, a0 = add(add(run.a, mul(run.d, x - 2400)), mul(run.nIn, y1)); return [a0, add(a0, mul(run.d, 4800)), add(add(a0, mul(run.d, 4800)), mul(run.nIn, 1200)), add(a0, mul(run.nIn, 1200))]; })() };
        if (!fxInside(endZone.q.map((p, i) => add(p, mul(sub(fxCentroid(endZone.q), p), 0.01))), X.R)) continue;
        if (X.items.some(o => fxOverlap(endZone.q, o.foot))) continue;
        if (fxTry(X, g)) { pod = { g, endZone }; break; }
      }
      if (!pod) continue;
      const gid = ++fxGid; for (const it of pod.g) it.gid = gid;
      X.items.push(...pod.g); X.reserved.push(pod.endZone); desks += pod.g.length / 2; x += 3900;      // the next pod 4.0 m on
    }
  }
  return desks;
}
/** A training room set out as a classroom: rows of tables facing the end away from the door, 1500 left in front for
 *  whoever presents; two-seat tables either side of a 1200 aisle, as many a row as the width takes, rows 1350 apart
 *  (a 600 table and its chairs' 750 pull-out); a screen on the front wall. */
function fxClassroom(X, entry) {
  const R = X.R, doc = X.doc, tid = fixtureType(doc, "training"), run = R.runs.slice().sort((a, b) => b.len - a.len)[0], ir = fxInscribed(R, run.d);
  if (!ir) return;
  const at = (x, y) => add(add(ir.o, mul(ir.d, x)), mul(ir.n, y)), cx = (ir.x0 + ir.x1) / 2, cy = (ir.y0 + ir.y1) / 2;
  // the front: the end of the long axis further from the door; the rows run back from it (b points into the room)
  const atX0 = !entry || dist(at(ir.x0, cy), entry.Q) > dist(at(ir.x1, cy), entry.Q), sg = atX0 ? 1 : -1, b = mul(ir.d, sg);
  const rot = Math.atan2(-b[0], b[1]) * 180 / Math.PI, front = atX0 ? ir.x0 : ir.x1, W = ir.y1 - ir.y0;
  const per = Math.max(1, Math.floor((W - 1200) / 2 / 1600)), ys = [];
  for (let i = 0; i < per; i++) ys.push(cy - 600 - 800 - i * 1600, cy + 600 + 800 + i * 1600);
  for (let x = 1500; x + 1350 + 900 <= ir.x1 - ir.x0; x += 1350) for (const y of ys) {
    const it = fxPlace(doc, tid, at(front + sg * x, y), rot);
    if (fxTry(X, [it])) { it.gid = ++fxGid; X.items.push(it); }
  }
  fxBest(X, [...fxAlong(X, 1600, { step: 100 })], p => [fxPlace(doc, fixtureType(doc, "tv", { w: 1600 }), p.pos, p.rot)], p => -dist(p.pos, at(front, cy)));
}
function fxFitOffice(M, R, kind) {
  // benching is checked once laid (a route check per pod on a 1,100 m² floor costs seconds); every other room as it goes
  const X = fxCtx(M, R, kind !== "openplan" && kind !== "team"), doc = M.doc, T = k => fixtureType(doc, k);
  const entry = R.doors.find(d => d.to && fxIsCirc(M.byId.get(d.to))) || R.doors[0];
  const far = p => entry ? dist(p, entry.Q) : 0;
  if (kind === "openplan" || kind === "team") {
    fxBenching(X, { depth: kind === "team" ? 6400 : 11200 });
    if (entry && kind === "openplan") fxBest(X, [...fxAlong(X, 2400, { step: 100 })], p => [fxPlace(doc, fixtureType(doc, "reception", { w: 2400 }), p.pos, p.rot)], p => -far(p.pos) + dot(sub(entry.Q, p.pos), mul(perp(normalise([Math.cos(p.rot * Math.PI / 180), Math.sin(p.rot * Math.PI / 180)])), 1)) * 0.5);
    if (kind === "team") fxFreeSet(X, fixtureType(doc, "meeting", { l: 2400, w: 1100, nl: 3, ne: 1 }), 2400, p => -far(p), [0, 90]);
  } else if (kind === "private") {
    const fac = fxFacades(X);
    for (let i = 0; i < 2; i++) fxBest(X, [...fxAlong(X, 1600, { kinds: ["facade"], step: 50 })], p => fxGroup(doc, [[T("workstation"), 0, 0], [T("chair"), 0, 1130, 180]], p.pos, p.rot), p => -Math.abs(p.t - p.run.len / 2) * 0.1);
    fxBest(X, [...fxAlong(X, 1200, { step: 50 })], p => [fxPlace(doc, fixtureType(doc, "shelving", { w: 1200 }), p.pos, p.rot)], p => fxDistToRuns(p.pos, fac) * 0.2);
    fxBest(X, [...fxAlong(X, 800, { step: 50 })], p => [fxPlace(doc, T("chair"), add(p.pos, mul(perp([Math.cos(p.rot * Math.PI / 180), Math.sin(p.rot * Math.PI / 180)]), 300)), p.rot)], p => -far(p.pos) * 0.1);
  } else if (kind === "corneroffice") {
    const fac = fxFacades(X);
    fxBest(X, [...fxAlong(X, 1800, { step: 100, kinds: ["wall", "glass", "facade"] })], p => fxGroup(doc, [[fixtureType(doc, "desk", { w: 1800 }), 0, 0], [T("chair"), 0, 860, 180]], p.pos, p.rot), p => -fxDistToRuns(p.pos, fac));
    fxFreeSet(X, fixtureType(doc, "roundset", { d: 1000, n: 4 }), 1000, p => far(p) * 0.5);
    fxBest(X, [...fxAlong(X, 2000, { step: 100, kinds: ["wall", "glass"] })], p => fxGroup(doc, [[fixtureType(doc, "sofa", { w: 2000 }), 0, 0], [fixtureType(doc, "coffee", { w: 1100, d: 550 }), 0, 1300]], p.pos, p.rot), p => -far(p.pos) * 0.2);
  } else if (kind === "meeting") return fxFitMeeting(M, R);
  else if (kind === "phone") fxRow(X, T("pod"), 1100, { kinds: ["wall", "glass"], score: p => far(p.pos) });
  else if (kind === "pantry") {
    fxBest(X, [...fxAlong(X, 1800, { step: 50 })].flatMap(p => [3600, 3000, 2400, 1800].map(w => Object.assign({ w }, p))), p => [fxPlace(doc, fixtureType(doc, "counter", { w: p.w }), p.pos, p.rot)], p => p.w + far(p.pos) * 0.1);
    fxFreeSet(X, fixtureType(doc, "roundset", { d: 900, n: 4 }), 900, p => far(p) * 0.1);
  } else if (kind === "quiet") {
    fxBest(X, [...fxAlong(X, 1300, { step: 50, kinds: ["wall", "glass", "facade"] })], p => fxGroup(doc, [[T("armchair"), -260, 0], [T("sidetable"), 400, 0]], p.pos, p.rot), p => far(p.pos));
    fxBest(X, [...fxAlong(X, 800, { step: 50, kinds: ["wall", "glass", "facade"] })], p => [fxPlace(doc, T("armchair"), p.pos, p.rot)], p => far(p.pos));
  } else if (kind === "comms") fxRow(X, T("rack"), 600, { max: 3, score: p => far(p.pos) });
  else if (kind === "print") {
    fxBest(X, [...fxAlong(X, 1300, { step: 50 })], p => [fxPlace(doc, T("copier"), p.pos, p.rot)], p => far(p.pos));
    fxRow(X, fixtureType(doc, "shelving", { w: 1800 }), 1800, { max: 3, score: p => far(p.pos) });
  } else if (kind === "wc") {
    // cubicles in a row down the long wall from the far end, leaving the door's approach and 1.4 m for two basins
    const longest = Math.max(...R.lines.map(l => l.len));
    fxRow(X, T("cubicle"), 900, { max: Math.max(2, Math.floor((longest - 2300) / 900)), score: p => far(p.pos) * 2 });
    for (const k of [3, 2, 1]) if (fxBest(X, [...fxAlong(X, k * 650 + 100, { step: 50 })], p => [fxPlace(doc, fixtureType(doc, "basins", { n: k }), p.pos, p.rot)], p => -far(p.pos) + k * 1000)) break;
  } else if (kind === "accwc") {
    fxBest(X, [...fxAlong(X, 1700, { step: 50 })], p => [fxPlace(doc, T("wcacc"), p.pos, p.rot)], p => far(p.pos));
    fxBest(X, [...fxAlong(X, 700, { step: 50 })], p => [fxPlace(doc, fixtureType(doc, "basin", { w: 600 }), p.pos, p.rot)], p => far(p.pos) * 0.5);
    fxBest(X, [...fxAlong(X, 1200, { step: 50 })], p => [fxPlace(doc, fixtureType(doc, "shower", { w: 1200, d: 1200, open: 1200 }), p.pos, p.rot)], p => far(p.pos) * 0.3);
  } else if (kind === "lockers") {
    if (/shower/i.test(R.name)) fxRow(X, fixtureType(doc, "shower", { w: 1000, d: 1000, open: 1000 }), 1000, { max: 3, score: p => far(p.pos) });
    fxRow(X, fixtureType(doc, "lockers", { n: 6 }), 2400, { max: 6, score: p => -far(p.pos) * 0.1 });
    fxRow(X, fixtureType(doc, "bench", { w: 1600 }), 1600, { max: 1, score: p => far(p.pos) * 0.1 });
  } else if (kind === "lounge") {
    // sofas face to face across a coffee table, 400 legroom each side: the seats' ends stand clear of the table, so the
    // way past the table's end reaches both
    const sofa = fixtureType(doc, "sofa", { w: 2200 }), cof = fixtureType(doc, "coffee", { w: 1100, d: 550 });
    for (let i = 0; i < 4; i++) if (!fxBest(X, [...fxAlong(X, 2200, { step: 100, kinds: ["wall", "facade", "glass"] })], p => fxGroup(doc, [[sofa, 0, 0], [cof, 0, 1300], [sofa, 0, 3150, 180]], p.pos, p.rot), p => far(p.pos) * 0.1)) break;
    for (let i = 0; i < 3; i++) if (!fxFreeSet(X, fixtureType(doc, "roundset", { d: 900, n: 4 }), 900, p => far(p) * 0.1)) break;
  } else if (kind === "training") fxClassroom(X, entry);
  else if (kind === "store") {
    if (/cleaner/i.test(R.name)) fxBest(X, [...fxAlong(X, 600, { step: 50 })], p => [fxPlace(doc, T("cleaner"), p.pos, p.rot)], p => far(p.pos));
    fxRow(X, fixtureType(doc, "shelving", { w: 1800 }), 1800, { max: 4, score: p => far(p.pos) });
  }
  fxPrune(X);
  return X.items;
}
/** A lift car in each lift shaft, its door toward the landing. */
function fxFitLift(M, R) {
  const dr = R.doors[0]; if (!dr) return [];
  const t = perp(dr.n), P = R.poly, ws = P.map(p => dot(sub(p, dr.Q), t)), ds = P.map(p => dot(sub(p, dr.Q), dr.n));
  const c = add(add(dr.Q, mul(t, (Math.max(...ws) + Math.min(...ws)) / 2)), mul(dr.n, (Math.max(...ds) + Math.min(...ds)) / 2 + 50));
  // the car 150 clear of the shaft each side and 250 at the back for the counterweight; a skewed shaft takes a smaller car
  for (let k = 0; k < 8; k++) {
    const w = Math.round((Math.max(...ws) - Math.min(...ws) - 300 - k * 100) / 50) * 50, d = Math.round((Math.max(...ds) - Math.min(...ds) - 500 - k * 50) / 50) * 50;
    if (w < 900 || d < 900) return [];
    const it = fxPlace(M.doc, fixtureType(M.doc, "lift", { w, d }), c, fxRot(t));
    if (fxInside(it.footIn, R)) return [it];
  }
  return [];
}

// ---------------------------------------------------------------- the whole level
/** Fit out every room of a level that has none yet: bathrooms (and their doors), keys and suites, offices, cores.
 *  Adds the fixtures, openings and doors to the document; the caller regenerates and then checks. */
export function fitOut(doc, levelId, opts = {}) {
  const ed = new Editor(doc);
  const add_ = element => { const r = ed.apply({ op: "add", element }, { regenerate: false, undoable: false }); if (!r.ok) throw new Error(`${element.id}: ${r.error}`); return r.id; };
  if (!doc.lib.types["T-DOOR800"]) doc.setDef("types", "T-DOOR800", { family: "F-SINGLEDOOR", name: "Single 800×2100", mark: "D5", width: 800, height: 2100, leafThickness: 44, frame: 40 });
  const report = { rooms: 0, fixtures: 0, doors: 0, desks: 0, unfitted: [], accessDoors: [] };
  // first, a door from circulation into every room that has none or is reached only through another room (bathrooms
  // excepted: their doors come with their layout); then the fit-out reads the model again with those doors in it
  {
    const M0 = fitModel(doc, levelId), acc = fxAccess(M0);
    for (const R of M0.rooms) {
      const a = acc.get(R.id); if (a.ok || R.dept === "Bath") continue;
      const d = fxAccessDoor(M0, R, acc); if (!d) continue;
      const oid = `${R.id}-OPA`;
      let host = d.wall && d.wall.id;
      if (d.merge) {
        const rec = doc.elementJSON(doc.element(d.from));
        for (const id of d.merge) { const r = ed.apply({ op: "delete", id }, { regenerate: false, undoable: false }); if (!r.ok) throw new Error(`${id}: ${r.error}`); }
        host = add_(Object.assign({}, rec, { id: `${d.from}-M`, args: Object.assign({}, rec.args, { centreline: d.line }) }));
        M0.walls = M0.walls.filter(w => !d.merge.includes(w.id));
      }
      add_({ id: oid, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at: d.at, sill: 0, w: d.width, h: 2100 }, farProfile: null, depth: "through" } });
      add_({ id: `${R.id}-DA`, type: "Door", name: "Door added for access", args: { fills: { ref: oid }, doorType: { ref: d.width > 1000 ? "T-DOOR1015" : "T-DOOR915" }, flipHand: d.flipHand, flipFacing: d.flipFacing, clearance: "None" }, params: { Phase: "New" } });
      if (d.wall) M0.holes.push({ id: oid, wall: d.wall, at: d.at, w: d.width });
      report.doors++; report.accessDoors.push(R.id);
    }
    if (report.accessDoors.length) doc.regenerate();
  }
  const M = fitModel(doc, levelId);
  const place = (R, items) => { let n = 0; for (const it of items) { add_({ id: `${R.id}-FX${++n}`, type: "Fixture", name: it.def.name, args: { position: it.pos.map(v => Math.round(v * 10) / 10), rotation: Math.round(it.rot * 100) / 100, mirror: !!it.mirror, fixtureType: { ref: it.typeId }, level: { ref: levelId }, baseOffset: 0 } }); } report.fixtures += n; if (n) report.rooms++; report.desks += items.filter(i => i.kind === "workstation").length; };
  const done = new Set(M.fixtures.map(f => { const r = fxRoomAt(M, doc.argValue(f, "position")); return r && r.id; }));
  // keys first, each with its bathroom: the bath's door and fixtures decide what the key keeps clear
  // each bathroom belongs to the guest room it shares the most wall with (an end key's bath also touches the suite next door)
  const bathOf = new Map();
  for (const b of M.rooms.filter(r => r.dept === "Bath")) {
    const share = new Map(); for (const r of fxRuns(M, b)) if (r.nb && fxIsGuest(M.byId.get(r.nb))) share.set(r.nb, (share.get(r.nb) || 0) + r.len);
    const own = [...share.entries()].sort((x, y) => y[1] - x[1])[0]; if (own && !bathOf.has(own[0])) bathOf.set(own[0], b);
  }
  for (const K of M.rooms.filter(r => fxIsGuest(r) && !done.has(r.id))) {
    fxRuns(M, K);
    const suite = /suite/i.test(K.name), entry = K.doors.find(d => d.to && fxIsCirc(M.byId.get(d.to)));
    const B = bathOf.get(K.id);
    let reserved = [];
    if (B && !done.has(B.id)) {
      fxRuns(M, B);
      const fb = fxFitBath(M, B, K, entry, { suite });
      if (!fb) report.unfitted.push(B.id);
      else {
        place(B, fb.items);
        if (fb.door) {
          const oid = `${B.id}-OP1`;
          add_({ id: oid, type: "Opening", args: { host: { ref: fb.door.wall.id }, profile: { kind: "rect", at: fb.door.at, sill: 0, w: fb.door.width, h: 2100 }, farProfile: null, depth: "through" } });
          add_({ id: `${B.id}-D1`, type: "Door", name: "Bathroom door", args: { fills: { ref: oid }, doorType: { ref: "T-DOOR800" }, flipHand: fb.door.flipHand, flipFacing: fb.door.flipFacing, clearance: "None" }, params: { Phase: "New" } });
          report.doors++;
          K.swings.push({ door: `${B.id}-D1`, poly: fb.door.swing });
          K.doors.push(Object.assign({}, fb.door.keyDoor, { id: `${B.id}-D1` }));
          const kd = fb.door.keyDoor, tt = perp(kd.n), hw = kd.w / 2 + 50;
          reserved = [{ use: "the way to the bathroom", q: [add(kd.Q, mul(tt, -hw)), add(kd.Q, mul(tt, hw)), add(add(kd.Q, mul(tt, hw)), mul(kd.n, 900)), add(add(kd.Q, mul(tt, -hw)), mul(kd.n, 900))] }];
          K.runs = null; fxRuns(M, K);
        }
      }
      done.add(B.id);
    }
    const fk = fxFitKey(M, K, { suite, reserved });
    if (fk) place(K, fk.items); else report.unfitted.push(K.id);
    done.add(K.id);
  }
  for (const R of M.rooms) {
    if (done.has(R.id)) continue;
    const kind = fxKind(R); if (!kind || kind === "bath") continue;
    fxRuns(M, R);
    const items = kind === "lift" ? fxFitLift(M, R) : fxFitOffice(M, R, kind);
    if (items && items.length) place(R, items); else if (kind !== "lift") report.unfitted.push(R.id);
  }
  return report;
}
/** What the check still finds, as a note on each plan that shows the rooms concerned. Nothing is added when all passes. */
export function fitNotes(doc, levelId, res) {
  const bad = res.rooms.filter(r => !r.ok); if (!bad.length) return 0;
  const ed = new Editor(doc);
  for (const v of doc.elements().filter(f => doc.typeOf(f) === "PlanView" && (doc.argValue(f, "level") || {}).ref === levelId && (doc.argValue(f, "scale") || 0) <= 500)) {
    const clip = doc.argValue(v, "clip"); if (!clip || !clip.rect) continue;
    const [x0, y0, x1, y1] = clip.rect, mine = bad.filter(r => r.at[0] > x0 && r.at[0] < x1 && r.at[1] > y0 && r.at[1] < y1); if (!mine.length) continue;
    const txt = `TO RESOLVE (${mine.length}): ` + mine.map(r => `${r.number ? r.number + " " : ""}${r.name} - ${r.problems.join("; ")}`).join(". ");
    ed.apply({ op: "add", element: { id: `${doc.idOf(v)}-TX-FIT`, type: "Text", args: { content: txt, position: [Math.round(x0 + 1500), Math.round(y0 + 1500)], rotation: 0, textType: { ref: "TT-25" }, wrapWidth: 90, leaders: [], view: { ref: doc.idOf(v) } } } }, { regenerate: false, undoable: false });
  }
  return bad.length;
}
/** A sheet of enlarged plans: one plan per entry, framed on the rooms it names with a margin, packed in rows from the top. */
export function fitDetailSheet(doc, { id, number, name, revision = "P03", scale = 50, views }) {
  const ed = new Editor(doc), add_ = element => { const r = ed.apply({ op: "add", element }, { regenerate: false, undoable: false }); if (!r.ok) throw new Error(`${element.id}: ${r.error}`); };
  const vps = [];
  let x = 30, top = 572, rowH = 0;
  views.forEach((v, i) => {
    // framed on the rooms with a margin, or (frame: [w, h]) a window that size centred on them - a slice of an open floor
    const pts = v.rooms.flatMap(r => doc.plan(doc.element(r)).loop.pts), m = v.margin ?? 900, b = fxBB(pts), sc = v.scale || scale;
    const c = v.centre || [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    const rect = (v.frame ? [c[0] - v.frame[0] / 2, c[1] - v.frame[1] / 2, c[0] + v.frame[0] / 2, c[1] + v.frame[1] / 2] : [b[0] - m, b[1] - m, b[2] + m, b[3] + m]).map(Math.round);
    const w = (rect[2] - rect[0]) / sc, h = (rect[3] - rect[1]) / sc;
    const level = doc.argValue(doc.element(v.rooms[0]), "level").ref;
    add_({ id: v.id, type: "PlanView", name: v.name, args: { level: { ref: level }, scale: sc, viewRange: { top: 2300, cut: 1200, bottom: -500, depth: -500 }, detailLevel: "Medium", style: { ref: "VS-HOTEL" }, clip: { rect, visible: false, active: true } } });
    // the stair treads are drafted in the floor plan's own view: the ones inside the frame are drafted again in this one
    const inRect = p => p[0] > rect[0] && p[0] < rect[2] && p[1] > rect[1] && p[1] < rect[3];
    const planOf = new Set(doc.elements().filter(f => doc.typeOf(f) === "PlanView" && (doc.argValue(f, "level") || {}).ref === level).map(f => doc.idOf(f)));
    let n = 0; const seen = new Set();
    for (const f of doc.elements().filter(f => doc.typeOf(f) === "DetailLine" && planOf.has((doc.argValue(f, "view") || {}).ref) && doc.argValue(f, "layer") === "Stair")) {
      const c = doc.argValue(f, "curve"), k = c && JSON.stringify([c.start, c.end]);
      if (!c || c.type !== "line" || !inRect(c.start) || !inRect(c.end) || seen.has(k)) continue;
      seen.add(k);
      add_(Object.assign({}, doc.elementJSON(f), { id: `${v.id}-DLS${++n}`, args: Object.assign({}, doc.elementJSON(f).args, { view: { ref: v.id } }) }));
    }
    // rows of plans across 841 mm of paper, a 22 mm gap under each for its title, the title block's band left clear
    if (x + w > 815 && x > 30) { x = 30; top -= rowH + 24; rowH = 0; }
    vps.push({ id: `VP${i + 1}`, view: { ref: v.id }, at: [Math.round(x + w / 2), Math.round(top - h / 2)], clipVisible: false });
    x += w + 20; rowH = Math.max(rowH, h);
  });
  add_({ id, type: "Sheet", name: `${number} ${name}`, args: { number, sheetName: name, size: "A1", orientation: "landscape", titleBlock: { ref: "SY-TB-A1" }, viewports: vps, revision } });
  return id;
}
