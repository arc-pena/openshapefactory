//! Hotels and office test fit, on the client's site drawing (Floor_Plan_Ali.dxf, metres): three hotel plates
//! and an office plate, each a typical floor laid out as a believable work-in-progress plan.
//!
//! The plates come straight from the drawing's Typical_Floor outlines. They are not rectangles: two sides are
//! arcs about the site's own centre (radius 620-870 m) and two are near-radial lines, so every layout here is
//! built in the plate's own (u, v) frame - u across the plate, v along its arcs - and mapped back on to the
//! curved outline. Lines of constant v come out straight; lines of constant u come out as arcs, drawn as arc walls.
//!
//! Hotels follow the scheme drawn in the file: keys about 8 m deep round the facade, a corridor ring, a central
//! atrium with its lifts at the ends; two stairs, aligned under the lifts, and corner suites are added. The office has
//! the drawing's two atria, a 12 m deep lettable ring, and a middle of corridor, two compact cores and rooms.
//! Everything else in the drawing that is not the site boundary is podium terracing, drawn as dashed lines.
//!
//! Coordinates in mm: x east, y north; the drawing's origin moved by HOTEL_DXF.origin.

import { newDocument } from "./bim.js";
import { VS_PRESENTATION } from "./library.js";
import { Editor } from "./ops.js";

const HOTEL_DXF = {"origin":[300000,500000],"boundary":[{"k":"A","c":[733837,217745],"r":1006197,"a0":-2.3942458,"a1":-3.2673205},{"k":"L","a":[-264417,343919],"b":[135242,324796]},{"k":"L","a":[135242,324796],"b":[117451,265081]},{"k":"L","a":[117451,265081],"b":[124863,212321]},{"k":"L","a":[124863,212321],"b":[114143,133296]},{"k":"L","a":[114143,133296],"b":[148629,48512]},{"k":"L","a":[148629,48512],"b":[191185,16106]},{"k":"L","a":[191185,16106],"b":[238227,-60339]},{"k":"L","a":[238227,-60339],"b":[247117,-141369]},{"k":"L","a":[247117,-141369],"b":[284965,-179554]},{"k":"L","a":[284965,-179554],"b":[-4203,-466162]}],"terraces":[{"k":"A","c":[732213,217680],"r":635807,"a0":3.0763357,"a1":3.1023297,"layer":"gh"},{"k":"A","c":[731544,217414],"r":640128,"a0":3.1022766,"a1":3.0761602,"layer":"gh"},{"k":"A","c":[789790,214371],"r":699947,"a0":3.1058086,"a1":3.0731644,"layer":"gh"},{"k":"A","c":[789323,214690],"r":691489,"a0":3.0728349,"a1":3.1053383,"layer":"gh"},{"k":"A","c":[731425,217420],"r":651008,"a0":3.1215401,"a1":3.0608156,"layer":"gh"},{"k":"L","a":[82539,269950],"b":[82647,271282],"layer":"gh"},{"k":"L","a":[82647,271282],"b":[109788,272207],"layer":"gh"},{"k":"L","a":[109788,272207],"b":[109645,270523],"layer":"gh"},{"k":"A","c":[732119,217685],"r":624712,"a0":3.0569109,"a1":3.1177446,"layer":"gh"},{"k":"L","a":[107584,232582],"b":[107552,231244],"layer":"gh"},{"k":"L","a":[107552,231244],"b":[80514,228799],"layer":"gh"},{"k":"L","a":[80514,228799],"b":[80548,230474],"layer":"gh"},{"k":"A","c":[731804,216981],"r":716680,"a0":-2.5775574,"a1":-2.5169418,"layer":"gh"},{"k":"A","c":[731363,216817],"r":730239,"a0":-2.5157413,"a1":-2.5763107,"layer":"gh"},{"k":"A","c":[731889,217039],"r":718783,"a0":-2.5634612,"a1":-2.5307349,"layer":"gh"},{"k":"A","c":[731457,216881],"r":728354,"a0":-2.5296439,"a1":-2.5627148,"layer":"gh"},{"k":"A","c":[733903,217776],"r":634270,"a0":-2.715053,"a1":-2.6854826,"layer":"gh"},{"k":"A","c":[733189,217508],"r":642547,"a0":-2.6841774,"a1":-2.7140371,"layer":"gh"},{"k":"A","c":[733203,217514],"r":640562,"a0":-2.6875715,"a1":-2.7111127,"layer":"gh"},{"k":"A","c":[733912,217780],"r":636280,"a0":-2.7116937,"a1":-2.6883716,"layer":"gh"},{"k":"L","a":[64067,-255750],"b":[65273,-257449],"layer":"Office_ground_lvl"},{"k":"L","a":[65273,-257449],"b":[22042,-291443],"layer":"Office_ground_lvl"},{"k":"A","c":[731037,216656],"r":872261,"a0":-2.5197813,"a1":-2.5616601,"layer":"Office_ground_lvl"},{"k":"L","a":[62276,-181582],"b":[76658,-171847],"layer":"Blue"},{"k":"A","c":[731107,219368],"r":762465,"a0":-2.6028085,"a1":-2.5261916,"layer":"Blue"},{"k":"L","a":[108522,-220793],"b":[22042,-288796],"layer":"Blue"},{"k":"L","a":[22042,-288796],"b":[17283,-282088],"layer":"Blue"},{"k":"L","a":[35263,-190709],"b":[58580,-175309],"layer":"Blue"},{"k":"A","c":[730990,216675],"r":778323,"a0":-2.6138004,"a1":-2.5371506,"layer":"Blue"},{"k":"L","a":[90571,-225648],"b":[68424,-242663],"layer":"Blue"},{"k":"A","c":[730576,216428],"r":805829,"a0":-2.5655088,"a1":-2.5353501,"layer":"Blue"},{"k":"L","a":[68350,-242720],"b":[16017,-282929],"layer":"Blue"},{"k":"A","c":[730825,216513],"r":872005,"a0":-2.5317342,"a1":-2.5617338,"layer":"Blue"},{"k":"L","a":[109694,-223238],"b":[108488,-224188],"layer":"Blue"},{"k":"A","c":[731103,216719],"r":762921,"a0":-2.5254154,"a1":-2.6020213,"layer":"Blue"},{"k":"L","a":[76571,-175245],"b":[122156,-144345],"layer":"Blue"},{"k":"L","a":[122156,-144345],"b":[123253,-146190],"layer":"Blue"},{"k":"A","c":[733745,217743],"r":626104,"a0":-3.1411783,"a1":-3.1098041,"layer":"Blue"},{"k":"L","a":[107957,197843],"b":[57312,190633],"layer":"Blue"},{"k":"A","c":[732474,217225],"r":675685,"a0":-3.1022261,"a1":-3.2081889,"layer":"Blue"},{"k":"L","a":[58287,262190],"b":[75123,262921],"layer":"Blue"},{"k":"L","a":[107818,232668],"b":[107696,226114],"layer":"Blue"},{"k":"A","c":[733559,217594],"r":625880,"a0":-2.6531286,"a1":-2.634276,"layer":"Blue"},{"k":"L","a":[186507,-86480],"b":[157121,-105663],"layer":"Blue"},{"k":"A","c":[732865,217380],"r":660180,"a0":-2.6302763,"a1":-2.6947626,"layer":"Blue"},{"k":"L","a":[137501,-67890],"b":[144869,-63682],"layer":"Blue"},{"k":"A","c":[733764,220392],"r":626124,"a0":3.1220051,"a1":3.1463269,"layer":"Red"},{"k":"L","a":[107647,217428],"b":[73783,213465],"layer":"Red"},{"k":"A","c":[732884,220029],"r":659134,"a0":-3.1316342,"a1":-3.2208212,"layer":"Red"},{"k":"L","a":[75818,272196],"b":[109884,273357],"layer":"Red"},{"k":"L","a":[109884,273357],"b":[109688,270987],"layer":"Red"},{"k":"L","a":[129518,-210652],"b":[111154,-225281],"layer":"Blue"},{"k":"A","c":[731104,219367],"r":762922,"a0":-2.5193946,"a1":-2.5959333,"layer":"Blue"},{"k":"L","a":[78970,-176575],"b":[124376,-145419],"layer":"Blue"},{"k":"A","c":[731815,219636],"r":708694,"a0":-2.6004577,"a1":-2.5235891,"layer":"Blue"},{"k":"L","a":[154204,-190988],"b":[153085,-191879],"layer":"Blue"},{"k":"L","a":[136187,-44935],"b":[160663,-31786],"layer":"Blue"},{"k":"A","c":[733837,220392],"r":626197,"a0":-2.7271134,"a1":-2.6495421,"layer":"Blue"},{"k":"L","a":[181929,-75445],"b":[158468,-90294],"layer":"Blue"},{"k":"A","c":[733062,220102],"r":653073,"a0":-2.6463039,"a1":-2.7237049,"layer":"Blue"}],"quads":{"OFFICE_IN":{"inner":{"c":[731018,216713],"r":818355,"a0":-2.62677159,"a1":-2.57945186},"outer":{"c":[731328,216839],"r":860604,"a0":-2.62485066,"a1":-2.57635904},"W":41977,"L":40228},"H1":{"inner":{"c":[732118,217685],"r":626211,"a0":3.0569108,"a1":3.11774465},"outer":{"c":[731426,217420],"r":649509,"a0":3.0608157,"a1":3.12154002},"W":24132,"L":38768},"H2":{"inner":{"c":[733847,217750],"r":626208,"a0":-2.72711292,"a1":-2.67534847},"outer":{"c":[733120,217475],"r":650470,"a0":-2.7240209,"a1":-2.67235739},"W":25107,"L":33010},"H3":{"inner":{"c":[731808,216984],"r":708685,"a0":-2.57821236,"a1":-2.51754803},"outer":{"c":[731359,216815],"r":738235,"a0":-2.5756955,"a1":-2.51517242},"W":30062,"L":43836},"OFFICE":{"inner":{"c":[730885,216634],"r":806200,"a0":-2.64228073,"a1":-2.5655032},"outer":{"c":[731156,216736],"r":872404,"a0":-2.63809527,"a1":-2.56172832},"W":66006,"L":64260}}};
// read off the hotel layouts drawn in the file, in each plate's (u, v) frame, mm
const HOTEL_SCHEMES = {
  H1: { name: "Hotel 1", D: 8050, vb: 9800, nb: 4, vE: 12800, ends: [-7800, -2500, 2500, 7800], atrium: { u: 2500, v0: -7800, v1: 7800 }, lifts: [{ u: 2500, v0: 7800, v1: 9800, face: 1 }, { u: 2500, v0: -9800, v1: -7800, face: -1 }] },
  H2: { name: "Hotel 2", D: 8020, vb: 7420, nb: 3, vE: 9500, ends: [-7830, -2530, 2530, 7830], atrium: { u: 2530, v0: -5500, v1: 7500 }, lifts: [{ u: 2530, v0: -7500, v1: -5500, face: -1 }] },
  H3: { name: "Hotel 3", D: 8010, vb: 9220, nb: 4, vE: 13900, ends: [-8310, -3010, 3010, 8310], atrium: { u: 5020, v0: -9900, v1: 9900 }, lifts: [{ u: 3010, v0: 9900, v1: 11900, face: 1 }, { u: 3010, v0: -11900, v1: -9900, face: -1 }] },
};
const HOTEL_BATH_D = 2400, HOTEL_BATH_W = 1900, HOTEL_CLEAR = 3200;
// a compact dog-leg stair enclosure: two 1,200 flights and a 100 well inside 215 block (IBC 1011.2: 44 in / 1,118 min
// clear width) - 2.8 m across; 5.6 m long holds two half-landings of 1,250 and nine 280 goings a flight at 3.2 m storeys
const HOTEL_STAIR_W = 2800, HOTEL_STAIR_L = 5600;

/** A plate's frame: (u, v) → plan point, on the drawing's two arcs. u across (-W/2 inner arc … +W/2 outer), v along. */
function plateFrame(q) {
  const arcPt = (a, s) => { const t = a.a0 + (a.a1 - a.a0) * s; return [a.c[0] + a.r * Math.cos(t), a.c[1] + a.r * Math.sin(t)]; };
  const P = (u, v) => { const s = v / q.L + 0.5, t = u / q.W + 0.5, I = arcPt(q.inner, s), O = arcPt(q.outer, s); return [I[0] + t * (O[0] - I[0]), I[1] + t * (O[1] - I[1])]; };
  const angAt = (u, v, along) => { const a = along ? P(u, v + 500) : P(u + 500, v), b = along ? P(u, v - 500) : P(u - 500, v); return Math.atan2(a[1] - b[1], a[0] - b[0]) * 180 / Math.PI; };
  return { P, angAt, W: q.W, L: q.L };
}
/** The circle through three points. */
function circle3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const s = p => p[0] * p[0] + p[1] * p[1];
  const x = (s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d, y = (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d;
  return { c: [x, y], r: Math.hypot(a[0] - x, a[1] - y) };
}
const hotelDeg = r => ((r * 180 / Math.PI) % 360 + 360) % 360;

export function buildHotelsSample() {
  const doc = newDocument("Hotels and Office Test Fit");
  const ed = new Editor(doc);
  const add = (element) => { const r = ed.apply({ op: "add", element }, { regenerate: false }); if (!r.ok) throw new Error(`${element.id || element.type}: ${r.error}`); return r.id; };
  const line = (a, b) => ({ type: "line", start: rnd(a), end: rnd(b) });
  const rnd = p => [Math.round(p[0]), Math.round(p[1])];
  const arcCurve = s => { const a0 = hotelDeg(Math.min(s.a0, s.a1)), sweep = Math.abs(s.a1 - s.a0) * 180 / Math.PI; return { type: "arc", centre: rnd(s.c), radius: Math.round(s.r), start: +a0.toFixed(5), end: +((a0 + sweep) % 360).toFixed(5), ccw: true }; };
  add({ id: "L1", type: "Level", name: "Typical Floor", args: { name: "Typical Floor", elevation: 0 } });
  doc.meta.name = "Hotels and Office Test Fit";
  // the plan graphics of a hotel brochure plan: black poché, warm grey keys, paler corridors, darker cores
  const VS_H = JSON.parse(JSON.stringify(VS_PRESENTATION));
  Object.assign(VS_H, { name: "Hotel test fit" });
  VS_H.byCategory.IfcWall = { materialPriority: "view", cut: { fill: "#161616", pattern: "solid", pen: "none", detailLevel: "Coarse" }, projection: { pen: "hairline", colour: "#9A968C" }, beyond: { pen: "gossamer", colour: "#C9C5BB", lineType: "dashed2" } };
  VS_H.byCategory.IfcDoor = { cut: { pen: "hairline", colour: "#3A3A3A" }, projection: { pen: "hairline", colour: "#3A3A3A" }, swing: { pen: "gossamer", colour: "#6E6A61" } };
  VS_H.byCategory.IfcSpace = { fill: "#FFFFFF", label: { height: 1.8, colour: "#2B2B2B", align: "centre", content: " " } };   // no room names on these plans
  VS_H.byCategory.Furniture = { projection: { pen: "gossamer", colour: "#7C776B", fill: "none" } };
  VS_H.byCategory.IfcColumn = { materialPriority: "view", cut: { fill: "#161616", pattern: "solid", pen: "none" } };
  VS_H.byCategory.Annotation = { visible: true };
  VS_H.byCategory.IfcSlab = { visible: false };
  VS_H.rules = [
    { id: "FL-HOTEL-PART", when: { param: "Function", is: "Interior" }, then: { cut: { fill: "#161616", pen: "none" } } },
    { id: "FL-HOTEL-KEYS", when: { param: "Department", is: "Guest room" }, then: { fill: "#C9C7B1" } },
    { id: "FL-HOTEL-WORK", when: { param: "Department", is: "Workspace" }, then: { fill: "#D8D6C6" } },
    { id: "FL-HOTEL-MEET", when: { param: "Department", is: "Meeting" }, then: { fill: "#C2C0A9" } },
    { id: "FL-HOTEL-CIRC", when: { param: "Department", is: "Circulation" }, then: { fill: "#F4F3E8" } },
    { id: "FL-HOTEL-CORE", when: { param: "Department", is: "Core" }, then: { fill: "#A9A794" } },
    { id: "FL-HOTEL-BATH", when: { param: "Department", is: "Bath" }, then: { fill: "#DEDCCD" } },
    { id: "FL-HOTEL-VOID", when: { param: "Department", is: "Atrium" }, then: { fill: "#FFFFFF" } },
  ];
  doc.lib.viewStyles["VS-HOTEL"] = VS_H;
  // the site plan at 1:2500: fills and walls, no room names or furniture
  const VS_S = JSON.parse(JSON.stringify(VS_H)); VS_S.name = "Hotel test fit - site";
  VS_S.byCategory.IfcSpace = { fill: "#FFFFFF", label: { height: 1.8, colour: "#2B2B2B", align: "centre", content: " " } };
  VS_S.byCategory.Furniture = { visible: false };
  doc.lib.viewStyles["VS-HOTEL-SITE"] = VS_S;
  const vr = (top, cut, bottom, depth) => ({ top, cut, bottom, depth });

  // ---------------------------------------------------------------- site: boundary and podium terraces
  const segCurve = s => s.k === "L" ? line(s.a, s.b) : arcCurve(s);
  const segPts = s => s.k === "L" ? [s.a, s.b] : [0, 0.5, 1].map(f => { const t = s.a0 + (s.a1 - s.a0) * f; return [s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)]; });
  const allB = HOTEL_DXF.boundary.flatMap(segPts), bx = allB.map(p => p[0]), by = allB.map(p => p[1]);
  const siteRect = [Math.min(...bx) - 20000, Math.min(...by) - 20000, Math.max(...bx) + 20000, Math.max(...by) + 20000].map(Math.round);
  add({ id: "V-SITE", type: "PlanView", name: "Site — Typical Floor Test Fit", args: { level: { ref: "L1" }, scale: 2500, viewRange: vr(2300, 1200, -500, -500), detailLevel: "Coarse", style: { ref: "VS-HOTEL-SITE" }, clip: { rect: siteRect, visible: false, active: true } } });
  let dl = 0;
  const context = (view, withBoundary) => {
    if (withBoundary) HOTEL_DXF.boundary.forEach(s => add({ id: `DL${++dl}`, type: "DetailLine", args: { curve: segCurve(s), pen: "medium", lineStyle: "Centre", view: { ref: view }, layer: "Site boundary", colour: "#C0272D" } }));
    HOTEL_DXF.terraces.forEach(s => add({ id: `DL${++dl}`, type: "DetailLine", args: { curve: segCurve(s), pen: "thin", lineStyle: "Hidden", view: { ref: view }, layer: "Podium terrace", colour: "#8A8577" } }));
  };
  context("V-SITE", true);
  const text = (id, content, at, view, tt = "TT-25", wrap = 60) => add({ id, type: "Text", args: { content, position: rnd(at), rotation: 0, textType: { ref: tt }, wrapWidth: wrap, leaders: [], view: { ref: view } } });
  text("TX-WIP", "WORK IN PROGRESS — TEST FIT, TYPICAL FLOOR. Dashed: podium terraces. Red: site boundary.", [siteRect[0] + 25000, siteRect[3] - 15000], "V-SITE", "TT-35", 90);

  const summary = [];
  // ---------------------------------------------------------------- per plate helpers
  function plate(key, label, scale, { quad = key, level = "L1", viewName = `${label} — Typical Floor (test fit)` } = {}) {
    const q = HOTEL_DXF.quads[quad], F = plateFrame(q), P = F.P;
    const corners = [P(-q.W / 2, -q.L / 2), P(q.W / 2, -q.L / 2), P(q.W / 2, q.L / 2), P(-q.W / 2, q.L / 2)];
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const view = `V-${key}`;
    add({ id: view, type: "PlanView", name: viewName, args: { level: { ref: level }, scale, viewRange: vr(2300, 1200, -500, -500), detailLevel: "Medium", style: { ref: "VS-HOTEL" }, clip: { rect: [Math.min(...xs) - 9000, Math.min(...ys) - 9000, Math.max(...xs) + 9000, Math.max(...ys) + 9000].map(Math.round), visible: false, active: true } } });
    context(view, false);
    let n = 0, op = 0, sp = 0, fu = 0;
    // walls are collected first and built at finish(): a wall along v (constant u) follows the plate's curve, so it
    // is cut into straight pieces at every point another wall meets it - the pieces are chords of the curve and
    // every junction lands exactly on one (a 5 m piece on a 640 m radius is off the arc by 5 mm)
    const specs = [], pending = [];
    const wall = (name, a, b, type, extra = {}) => { specs.push({ id: `S${specs.length}`, name, a, b, type, extra, alongV: Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) > 1 }); return `S${specs.length - 1}`; };
    const pieces = {};
    const finish = () => {
      const ends = specs.flatMap(w => [w.a, w.b]);
      for (const w of specs) {
        let pts = [w.a, w.b];
        if (w.alongV) {
          const lo = Math.min(w.a[1], w.b[1]), hi = Math.max(w.a[1], w.b[1]), sg = w.b[1] > w.a[1] ? 1 : -1;
          const vs = [...new Set(ends.filter(e => Math.abs(e[0] - w.a[0]) < 1 && e[1] > lo + 1 && e[1] < hi - 1).map(e => Math.round(e[1])))].sort((x, y) => sg * (x - y));
          pts = [w.a, ...vs.map(v => [w.a[0], v]), w.b];
        }
        pieces[w.id] = [];
        for (let i = 0; i + 1 < pts.length; i++) {
          const id = `${key}-W${++n}`, A = P(...pts[i]), B = P(...pts[i + 1]);
          add({ id, type: "Wall", name: w.name, args: Object.assign({ centreline: line(A, B), mounting: "Centred", wallType: { ref: w.type }, baseLevel: { ref: level }, baseOffset: 0, height: HOTEL_CLEAR, flipped: false }, w.extra), params: { Phase: "New", Comments: "Test fit - work in progress" } });
          pieces[w.id].push({ id, a: rnd(A), b: rnd(B), v0: Math.min(pts[i][1], pts[i + 1][1]), v1: Math.max(pts[i][1], pts[i + 1][1]), u0: Math.min(pts[i][0], pts[i + 1][0]), u1: Math.max(pts[i][0], pts[i + 1][0]) });
        }
      }
      for (const f of pending) f();
    };
    // the piece of a collected wall that holds (u, v), and the distance along it
    const hostAt = (spec, uv) => {
      const w = specs.find(x => x.id === spec), ps = pieces[spec];
      const pc = ps.find(x => w.alongV ? uv[1] >= x.v0 - 1 && uv[1] <= x.v1 + 1 : uv[0] >= x.u0 - 1 && uv[0] <= x.u1 + 1) || ps[0], p = P(...uv);
      const d = [pc.b[0] - pc.a[0], pc.b[1] - pc.a[1]], Lw = Math.hypot(...d);
      return { id: pc.id, at: ((p[0] - pc.a[0]) * d[0] + (p[1] - pc.a[1]) * d[1]) / Lw, L: Lw };
    };
    const door = (spec, uv, flip, w = 915) => pending.push(() => { if (typeof spec === "function") spec = spec(uv); const hst = hostAt(spec, uv), oid = `${key}-OP${++op}`, at = Math.max(w / 2 + 120, Math.min(hst.L - w / 2 - 120, hst.at));
      add({ id: oid, type: "Opening", args: { host: { ref: hst.id }, profile: { kind: "rect", at: Math.round(at), sill: 0, w, h: 2100 }, farProfile: null, depth: "through" } });
      add({ id: `${key}-D${op}`, type: "Door", args: { fills: { ref: oid }, doorType: { ref: w > 1000 ? "T-DOOR1015" : "T-DOOR915" }, flipHand: !!flip, flipFacing: true, clearance: "None" }, params: { Phase: "New" } }); });
    const hole = (spec, uv, w) => pending.push(() => { const hst = hostAt(spec, uv), at = Math.max(w / 2 + 50, Math.min(hst.L - w / 2 - 50, hst.at));
      add({ id: `${key}-OP${++op}`, type: "Opening", args: { host: { ref: hst.id }, profile: { kind: "rect", at: Math.round(at), sill: 0, w, h: 2200 }, farProfile: null, depth: "through" } }); });
    const space = (name, uv, dept, number, quiet) => add({ id: `${key}-SP${++sp}`, type: "Space", name, args: { level: { ref: level }, upperLimit: { mode: "offset", offset: HOTEL_CLEAR }, anchor: rnd(P(...uv)), boundaryAt: "finishFace" }, params: Object.assign({ Number: number || "", Department: dept, Occupancy: dept === "Guest room" ? 2 : 0 }, quiet ? { LabelFormat: " " } : {}) });
    const furn = (shape, uv, size, alongV) => add({ id: `${key}-FU${++fu}`, type: "Furniture", args: { position: rnd(P(...uv)), shape, size, rotation: Math.round(((F.angAt(uv[0], uv[1], alongV) % 360) + 360) % 360), level: { ref: level } } });
    const rect = (name, u0, u1, v0, v1, type, extra) => [wall(name, [u0, v0], [u1, v0], type, extra), wall(name, [u1, v0], [u1, v1], type, extra), wall(name, [u1, v1], [u0, v1], type, extra), wall(name, [u0, v1], [u0, v0], type, extra)];
    const stair = (u0, u1, v0, v1, alongV) => {
      const ln = (a, b) => add({ id: `${key}-DLS${++n}`, type: "DetailLine", args: { curve: line(P(...a), P(...b)), pen: "thin", lineStyle: "Solid", view: { ref: view }, layer: "Stair", colour: "#000000" } });
      const land = 1200;
      if (alongV) { const lo = Math.min(v0, v1) + land, hi = Math.max(v0, v1) - land, m = (u0 + u1) / 2; ln([m, lo], [m, hi]); for (let y = lo; y <= hi + 1; y += 280) ln([u0 + 150, y], [u1 - 150, y]); }
      else { const lo = Math.min(u0, u1) + land, hi = Math.max(u0, u1) - land, m = (v0 + v1) / 2; ln([lo, m], [hi, m]); for (let x = lo; x <= hi + 1; x += 280) ln([x, v0 + 150], [x, v1 - 150]); }
    };
    const slab = () => add({ id: `${key}-FL`, type: "Floor", name: `${label} slab`, args: { boundary: corners.map(rnd), floorType: { ref: "T-FLOOR250" }, level: { ref: level }, heightOffset: 0 } });
    return { q, F, P, view, wall, rect, door, hole, space, furn, stair, slab, finish, corners, xs, ys, level };
  }

  // ---------------------------------------------------------------- hotels
  for (const key of ["H1", "H2", "H3"]) {
    const H = HOTEL_SCHEMES[key], T = plate(key, H.name, 250), { q, wall, rect, door, hole, space, furn, stair } = T;
    const W = q.W, L = q.L, Wc = W - 2 * H.D, uc = Wc / 2, A = H.atrium;
    rect("Facade", -W / 2, W / 2, -L / 2, L / 2, "T-EXTCAV300");
    const ring = rect("Corridor wall", -uc, uc, -H.vE, H.vE, "T-BLOCK215");
    // ring walls: 0 at v = -vE (u -→+), 1 at u = +uc (v -→+), 2 at v = +vE (u +→-), 3 at u = -uc (v +→-)
    const ringSide = s => s > 0 ? ring[1] : ring[3], ringEnd = t => t > 0 ? ring[2] : ring[0];
    let keys = 0;
    const keyNo = () => `${key}-${String(++keys).padStart(2, "0")}`;
    // a key: corridor face at depth 0, facade at depth D; across it from a to b; uvOf(depth, across)
    const keyRoom = (uvOf, a, b, D, bathAtA, host, alongV) => {
      const sg = b > a ? 1 : -1, wB = bathAtA ? a : b, other = bathAtA ? b : a, dir = bathAtA ? sg : -sg, bx = wB + dir * HOTEL_BATH_W;
      wall("Bath", uvOf(HOTEL_BATH_D, wB), uvOf(HOTEL_BATH_D, bx), "T-PART100");
      wall("Bath side", uvOf(0, bx), uvOf(HOTEL_BATH_D, bx), "T-PART100");
      door(host, uvOf(0, (bx + other) / 2), !bathAtA);
      space("", uvOf(HOTEL_BATH_D / 2, (wB + bx) / 2), "Bath", "", true);
      furn("Desk", uvOf(HOTEL_BATH_D + (D - HOTEL_BATH_D) / 2, wB + dir * 1050), [1800, 2000], !alongV);
      furn("Desk", uvOf(D - 1300, other - dir * 330), [500, 1400], alongV);
      space("King room", uvOf(D * 0.62, (a + b) / 2), "Guest room", keyNo());
    };
    // long sides: bays between ±vb; the strip vb..vE becomes a key if it is wide enough, else part of the corner suite
    const extraKey = H.vE - H.vb >= 3800, endOuter = Math.max(...H.ends.map(Math.abs));
    for (const s of [-1, 1]) {
      const edges = []; for (let i = 0; i <= H.nb; i++) edges.push(-H.vb + i * 2 * H.vb / H.nb);
      if (extraKey) edges.unshift(-H.vE), edges.push(H.vE);
      for (const v of edges) wall("Demising", [s * uc, v], [s * W / 2, v], "T-PART100");
      for (let i = 0; i + 1 < edges.length; i++) keyRoom((d, x) => [s * (uc + d), x], edges[i], edges[i + 1], H.D, i % 2 === 0, ringSide(s), true);
    }
    // the end bands: corner suites, a stair, keys between
    for (const t of [-1, 1]) {
      const Dend = L / 2 - H.vE;
      const ext = {};
      if (endOuter > uc) for (const s of [-1, 1]) ext[s] = wall("Corridor wall", [s * uc, t * H.vE], [s * endOuter, t * H.vE], "T-BLOCK215");
      // the corridor's end: its own wall within the ring, the extensions beyond it
      const endHost = uv => Math.abs(uv[0]) > uc + 1 && ext[Math.sign(uv[0])] ? ext[Math.sign(uv[0])] : ringEnd(t);
      // the stair turns side-on along the corridor: it keeps 2.8 m off the corridor and gives the facade behind it to the
      // neighbouring room (the key next to it in a three-bay end, else the corner suite), so no facade is lost to a stair
      // the stair bay is the one on the plate's axis, under the lifts: stair and lifts stack as one core
      const si = H.ends.findIndex((u, i) => u < 0 && H.ends[i + 1] > 0), uJoin = H.ends[si + 1], sDepth = t * (H.vE + HOTEL_STAIR_W);
      for (const u of H.ends) wall("Demising", [u, t * H.vE], [u, u === uJoin ? sDepth : t * L / 2], u === uJoin ? "T-BLOCK215" : "T-PART100");
      for (const s of [-1, 1]) {
        // the corner suite: entered off the corridor's side (an L-shaped suite) or its end
        const anchorU = s * (endOuter + (W / 2 - endOuter) / 2), anchorV = t * (H.vE + Dend * 0.55);
        if (!extraKey) door(ringSide(s), [s * uc, t * (H.vb + H.vE) / 2], s * t > 0);
        else { const du = s * (Math.min(uc, endOuter) + Math.max(uc, endOuter)) / 2; door(endHost([du, 0]), [du, t * H.vE], s > 0); }
        furn("Desk", [s * (W / 2 - 2600), t * (H.vE + Dend / 2)], [1800, 2000], false);
        furn("Sofa", [anchorU - s * 600, t * (L / 2 - 1300)], [2400, 850], true);
        space("Corner suite", [anchorU, anchorV], "Guest room", keyNo());
      }
      // between the end partitions: a stair at the first, keys in the rest
      for (let i = 0; i + 1 < H.ends.length; i++) {
        const a = H.ends[i], b = H.ends[i + 1];
        if (i === si) {
          // flights run along the corridor (8 goings of 280 and two 1,200 landings fit 4.64 m); a strip left over is a closet
          const bw = Math.abs(b - a), dir = uJoin === b ? -1 : 1, Ls = bw - HOTEL_STAIR_L < 900 ? bw : HOTEL_STAIR_L, far = uJoin + dir * Ls, other = uJoin === b ? a : b;
          wall("Stair", [a, sDepth], [b, sDepth], "T-BLOCK215");
          if (Math.abs(other - far) > 300) wall("Stair", [far, t * H.vE], [far, sDepth], "T-BLOCK215");
          stair(Math.min(uJoin, far), Math.max(uJoin, far), t * H.vE, sDepth, false); space("Stair", [(uJoin + far) / 2, (t * H.vE + sDepth) / 2], "Core");
          door(ringEnd(t), [far - dir * 700, t * H.vE], dir * t > 0, 1015);           // a side approach, at the landing
          if (Math.abs(other - far) >= 900) { space("Closet", [(far + other) / 2, (t * H.vE + sDepth) / 2], "Core"); door(ringEnd(t), [(far + other) / 2, t * H.vE], false, Math.min(800, Math.abs(other - far) - 200)); }
        } else keyRoom((d, x) => [x, t * (H.vE + d)], a, b, Dend, a > 0, endHost, false);
      }
    }
    // the middle: the atrium behind a glass rail, its lifts at the ends opening on to the corridor
    rect("Atrium balustrade", -A.u, A.u, A.v0, A.v1, "T-GLASS30", { height: 1100 });
    space("Atrium", [0, (A.v0 + A.v1) / 2], "Atrium");
    for (const Lf of H.lifts) {
      const lw = rect("Lift shaft", -Lf.u, Lf.u, Lf.v0, Lf.v1, "T-BLOCK215");
      wall("Lift shaft", [0, Lf.v0], [0, Lf.v1], "T-BLOCK215");
      const face = Lf.face > 0 ? lw[2] : lw[0], fv = Lf.face > 0 ? Lf.v1 : Lf.v0;
      for (const s of [-1, 1]) { hole(face, [s * Lf.u / 2, fv], 1100); space("Lift", [s * Lf.u / 2, (Lf.v0 + Lf.v1) / 2], "Core"); }
    }
    space("Corridor", [(uc + A.u) / 2, 0], "Circulation");
    T.slab(); T.finish();
    const gia = W * L / 1e6 - 2 * A.u * (A.v1 - A.v0) / 1e6;
    summary.push({ name: H.name, keys, gia: Math.round(gia) });
    const top = T.P(0, -L / 2 - 6500);
    text(`TX-${key}`, `${H.name.toUpperCase()} — ${(W / 1000).toFixed(1)} × ${(L / 1000).toFixed(1)} m — ${keys} keys per floor — ${Math.round(gia)} m² GIA per floor`, [Math.min(...T.xs) - 3000, Math.max(...T.ys) + 6000], T.view, "TT-25", 70);
    text(`TX-S${key}`, `${H.name}: ${keys} keys / floor`, [Math.max(...T.xs) + 6000, (Math.min(...T.ys) + Math.max(...T.ys)) / 2], "V-SITE", "TT-25", 50);
  }

  // ---------------------------------------------------------------- office: one plate, two ways to let it
  // A multi-tenant speculative office. The middle (corridors, two cores, shared rooms, two atria) stays common on every
  // floor; the 12 m perimeter ring is what is let. Level 2 shows it split into four tenancies of about 650 m² NIA, each entered
  // from the common lift lobby, each fitted out the usual way: a support strip against the core (reception at the
  // entrance, meeting rooms, pantry, print, phone booths) and open-plan benching in the daylight zone, a corner
  // office or boardroom at each end. Level 3 shows the same plate run as a flexible workspace (coworking): private
  // offices along the facade, a corridor behind them, and meeting rooms, lounge and kitchen against the core.
  // A whole-floor single tenant is the multi-tenant floor with the demising walls left out.
  add({ id: "L2", type: "Level", name: "Office Level 2 (multi-tenant)", args: { name: "Office Level 2 (multi-tenant)", elevation: 4500 } });
  add({ id: "L3", type: "Level", name: "Office Level 3 (coworking)", args: { name: "Office Level 3 (coworking)", elevation: 9000 } });
  const officeFloor = (key, mode, level, title) => {
    const T = plate(key, "Office", 400, { quad: "OFFICE", level, viewName: title }), { q, wall, rect, door, hole, space, furn, stair, P, F } = T;
    const W = q.W, L = q.L, ui = 21000, vi = 20200, OK = key;
    let desks = 0, offices = 0;
    rect("Facade", -W / 2, W / 2, -L / 2, L / 2, "T-EXTCAV300");
    // the two atria, as drawn: full-height glass where a tenancy looks on to them, a rail where the common zone does
    const atria = [{ u0: -ui, u1: 7000, v0: 6600, v1: vi, full: ["N", "W"] }, { u0: 0, u1: ui, v0: -vi, v1: 0, full: ["S", "E"] }];
    atria.forEach((a, i) => {
      const sides = { S: [[a.u0, a.v0], [a.u1, a.v0]], E: [[a.u1, a.v0], [a.u1, a.v1]], N: [[a.u1, a.v1], [a.u0, a.v1]], W: [[a.u0, a.v1], [a.u0, a.v0]] };
      for (const [k, [p0, p1]] of Object.entries(sides)) wall(a.full.includes(k) ? "Atrium glazing" : "Atrium balustrade", p0, p1, "T-GLASS30", a.full.includes(k) ? {} : { height: 1100 });
      space(`Atrium ${i + 1}`, [(a.u0 + a.u1) / 2, (a.v0 + a.v1) / 2], "Atrium");
    });
    // the middle: a 2.4 m corridor along each atrium edge that faces in, meeting in one lift lobby where the atria
    // touch; each arm runs out to one tenancy's front door. The two blocks the corridors leave hold a compact core
    // each (point-symmetric about the lobby) and rooms off the corridor - nothing in the middle is left as spare lobby
    const corr = { C1: wall("Corridor wall", [-21000, 4200], [-2400, 4200], "T-BLOCK215"), C4: wall("Corridor wall", [9400, 2400], [21000, 2400], "T-BLOCK215"),
      C2a: wall("Corridor wall", [-2400, -20200], [-2400, -13400], "T-BLOCK215"), C2b: wall("Corridor wall", [-2400, -11600], [-2400, 4200], "T-BLOCK215"),
      C3: wall("Corridor wall", [9400, 2400], [9400, 20200], "T-BLOCK215") };
    wall("Inner zone", [-21000, -20200], [-2400, -20200], "T-BLOCK215"); wall("Inner zone", [-21000, -20200], [-21000, 4200], "T-BLOCK215");
    wall("Inner zone", [9400, 20200], [21000, 20200], "T-BLOCK215"); wall("Inner zone", [21000, 2400], [21000, 20200], "T-BLOCK215");
    const cw = mode === "cowork";
    const meet = (name, uv, size, dept = "Meeting") => { space(name, uv, dept); if (size) furn("Table", uv, size, true); };
    // a core, drawn in the frame of the one in the south-west block (lifts on to the west arm, stair side-on along the
    // south arm); R turns it half round about the lobby's centre for the north-east block. 11.6 × 8.4 m: three lifts,
    // a riser, two WCs off their own lobby, and a code-width stair with a side approach at its landing
    const core = (R, toLifts, toStair) => {
      const w = (name, a, b2, type = "T-BLOCK215") => wall(name, R(a), R(b2), type);
      w("Core", [-14000, -4200], [-2400, -4200]);
      w("Lift shafts", [-12200, 1500], [-2400, 1500]);
      const lob = w("WC lobby", [-12200, -4200], [-12200, 4200], "T-PART100");
      w("Riser", [-10200, 1500], [-10200, 4200]);
      for (const u of [-7600, -5000]) w("Lift shafts", [u, 1500], [u, 4200]);
      w("Stair", [-5200, -4200], [-5200, 1500]);
      w("WC", [-12200, -1350], [-5200, -1350], "T-PART100");
      for (const u of [-8900, -6300, -3700]) { hole(toLifts, R([u, 4200]), 1100); space("Lift", R([u, 2850]), "Core"); }
      door(toLifts, R([-13100, 4200]), false); space("WC lobby", R([-13100, 0]), "Core");
      door(lob, R([-12200, 2850]), false, 800); space("Riser", R([-11200, 2850]), "Core");
      for (const [v, nm] of [[75, "WC"], [-2775, "Accessible WC"]]) { door(lob, R([-12200, v]), v < 0); space(nm, R([-8700, v]), "Core"); }
      stair(...(() => { const p0 = R([-5200, -4200]), p1 = R([-2400, 1500]); return [Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1])]; })(), true);
      space("Stair", R([-3800, -1350]), "Core");
      door(toStair, R([-2400, 800]), false, 1015);
    };
    const id = uv => uv, half = ([u, v]) => [7000 - u, 6600 - v];
    core(id, corr.C1, corr.C2b); core(half, corr.C4, corr.C3);
    // south-west block, the rest: a short spur off the south arm (11.6 m, inside the dead-end limit) with rooms either side,
    // a large room at its end, and one more room off the west arm
    const spurS = wall("Spur", [-14000, -13400], [-2400, -13400], "T-PART100"), spurN = wall("Spur", [-14000, -11600], [-2400, -11600], "T-PART100");
    const endW = wall("Room", [-14000, -20200], [-14000, 4200], "T-BLOCK215");
    wall("Room", [-21000, -4200], [-14000, -4200], "T-PART100");
    wall("Room", [-8200, -11600], [-8200, -4200], "T-PART100"); wall("Room", [-8200, -20200], [-8200, -13400], "T-PART100");
    const nm = cw ? ["Phone booths", "Meeting room 8p", "Meeting room 8p", "Lockers", "Mail and print", "Event space", "Meeting room 10p", "Store and cleaner"]
      : ["Tenant lounge", "Conference room", "Meeting room 10p", "Showers and lockers", "Parcel room and store", "Training and events", "Meeting suite", "Cleaner and refuse"];
    door(corr.C1, [-17500, 4200], false); meet(nm[0], [-17500, 0], null);
    if (cw) for (const v of [-2400, 0, 2400]) furn("Desk", [-19800, v], [900, 700], false); else { furn("Sofa", [-17500, -2600], [2400, 850], true); furn("Table", [-17500, 1200], [2000, 900], true); }
    for (const [i, u] of [[1, -11100], [2, -5300]]) { door(spurN, [u, -11600], false); meet(nm[i], [u, -7900], [3600, 1200]); }
    for (const [i, u] of [[3, -11100], [4, -5300]]) { door(spurS, [u, -13400], true); space(nm[i], [u, -16800], "Core"); }
    door(endW, [-14000, -12500], false, 1015); meet(nm[5], [-17500, -12200], cw ? [2000, 6000] : [1600, 9000]);
    // north-east block, the rest: two rooms off the north arm
    wall("Room", [9400, 15500], [21000, 15500], "T-PART100");
    door(corr.C3, [9400, 13150], false); meet(nm[6], [15200, 13150], [4400, 1200]);
    door(corr.C3, [9400, 17850], true); space(nm[7], [15200, 17850], "Core");
    space(cw ? "Reception and community" : "Common lift lobby", [3500, 3300], "Circulation");
    // the four bands of the ring, each in its own frame: x along it, d in from the facade (0) to the inner line (Db)
    const bands = [
      { k: "S", Db: L / 2 - vi, half: ui, map: (x, d) => [x, -L / 2 + d], gap: [-2400, 0] },
      { k: "E", Db: W / 2 - ui, half: vi, map: (x, d) => [W / 2 - d, x], gap: [0, 2400] },
      { k: "N", Db: L / 2 - vi, half: ui, map: (x, d) => [-x, L / 2 - d], gap: [-9400, -7000] },
      { k: "W", Db: W / 2 - ui, half: vi, map: (x, d) => [-W / 2 + d, -x], gap: [-6600, -4200] },
    ];
    const colsX = [-1, -0.5, 0, 0.5, 1];
    for (const B of bands) {
      const M = B.map, w = (name, a, b, type, extra) => wall(name, M(...a), M(...b), type, extra), Db = B.Db, hx = B.half;
      const sp = (name, x, d, dept) => space(name, M(x, d), dept), fu = (shape, x, d, size, alongX) => furn(shape, M(x, d), size, (B.k === "E" || B.k === "W") ? alongX : !alongX);
      const xe = (B.gap[0] + B.gap[1]) / 2;
      // the line to the common zone, with the way in
      const gate = w(mode === "cowork" ? "Lobby screen" : "Tenancy entrance", [B.gap[0], Db], [B.gap[1], Db], mode === "cowork" ? "T-GLASS30" : "T-BLOCK215");
      if (mode === "cowork") hole(gate, M(xe, Db), Math.min(3000, B.gap[1] - B.gap[0] - 600)); else door(gate, M(xe, Db), false, Math.min(1015, B.gap[1] - B.gap[0] - 600));
      // the corner rooms: from the facade to the inner corner on each side
      for (const s of [-1, 1]) { const cw = w("Corner room", [s * hx, 0], [s * hx, Db], "T-GLASS30"); door(cw, M(s * hx, 2600), s > 0); }
      if (mode === "cowork") {
        // private offices along the facade, 3.6 m bays × 4.8 m, a corridor behind them, and the shared spaces against the core
        const dO = 4800, dC = 6600;
        const n = Math.floor(2 * hx / 3600), bay = 2 * hx / n;
        for (let i = 0; i <= n; i++) { const x = -hx + i * bay; if (i > 0 && i < n) w("Office", [x, 0], [x, dO], "T-PART100"); }
        for (let i = 0; i < n; i++) {
          const x0 = -hx + i * bay, x1 = x0 + bay, f = w("Office front", [x0, dO], [x1, dO], "T-GLASS30");
          door(f, M((x0 + x1) / 2 + (i % 2 ? 700 : -700), dO), i % 2 === 1);
          for (const o of [-1, 1]) { fu("Desk", (x0 + x1) / 2 + o * 800, 2100, [1600, 1400], false); fu("Chair", (x0 + x1) / 2 + o * 800, 3200, [550, 550], false); }
          desks += 2; offices++; sp("Private office", (x0 + x1) / 2, 1200, "Workspace");
        }
        // against the core: meeting rooms, phone booths, kitchen; the lounge in between stays open to the corridor
        const mods = [["Meeting room", 4800, "Meeting"], ["Phone booths", 2400, "Meeting"], ["Lounge", 8400, null], ["Meeting room", 3600, "Meeting"], ["Kitchen", 6000, null], ["Phone booths", 2400, "Meeting"], ["Meeting room", 4800, "Meeting"], ["Lounge", 8400, null]];
        let x = -hx, i = 0;
        while (x < hx - 1000) {
          const [name, len, dept] = mods[i++ % mods.length], x1 = Math.min(hx, x + len), last = hx - x1 < 2400 ? hx : x1;
          if (Math.abs(xe - (x + last) / 2) < 3000 && dept) { /* keep the way in open */ }
          if (last < hx) w("Core-side room", [last, dC], [last, Db], "T-PART100");
          if (dept) { const f = w(name, [x, dC], [last, dC], "T-GLASS30"); door(f, M((x + last) / 2, dC), false); sp(name, (x + last) / 2, (dC + Db) / 2, dept);
            if (name === "Meeting room") fu("Table", (x + last) / 2, (dC + Db) / 2, [Math.min(3000, last - x - 1400), 1100], true); }
          else if (name === "Lounge") { fu("Sofa", (x + last) / 2 - 1500, Db - 1200, [2200, 850], true); fu("Table", (x + last) / 2 + 1600, (dC + Db) / 2, [2400, 1000], true); }
          else { fu("Desk", (x + last) / 2, Db - 700, [Math.max(1800, last - x - 1200), 650], true); fu("Table", (x + last) / 2, dC + 1600, [2400, 1000], true); }
          x = last;
        }
        sp("Flexible workspace floor", -hx + 2000, (dO + dC) / 2, "Circulation");
      } else {
        // a tenancy: support strip against the core, a 1.8 m aisle, benching in the daylight zone
        const dS = Db - 3600, aisle = 1800;
        const before = [["Meeting 8p", 4800, "Meeting"], ["Phone booths", 2400, "Meeting"], ["Pantry", 6000, "Meeting"], ["Meeting 4p", 3600, "Meeting"], ["Print and store", 2400, "Core"]];
        const after = [["Meeting 6p", 4200, "Meeting"], ["Quiet room", 2400, "Meeting"], ["Comms", 1800, "Core"], ["Meeting 4p", 3600, "Meeting"], ["Phone booths", 2400, "Meeting"]];
        const r0 = Math.max(-hx, xe - 3600), r1 = Math.min(hx, xe + 3600);             // the reception, open to the floor, at the way in
        w("Reception", [r0, dS], [r0, Db], "T-PART100"); w("Reception", [r1, dS], [r1, Db], "T-PART100");
        fu("Desk", (r0 + r1) / 2, dS + 1500, [2400, 800], true); fu("Sofa", r0 + 1500, Db - 900, [1800, 800], true);
        const run = (list, from, to, dir) => {
          let x = from, i = 0;
          while (dir * (to - x) > 1500) {
            const [name, len, dept] = list[i++ % list.length]; let x1 = x + dir * len; if (dir * (to - x1) < 2000) x1 = to;
            if (Math.abs(x1 - to) > 1) w("Support", [x1, dS], [x1, Db], "T-PART100");
            const f = w(name, [x, dS], [x1, dS], name === "Pantry" || name.startsWith("Print") || name === "Comms" ? "T-PART100" : "T-GLASS30");
            door(f, M((x + x1) / 2, dS), dir < 0);
            sp(name, (x + x1) / 2, (dS + Db) / 2, dept);
            if (name.startsWith("Meeting")) fu("Table", (x + x1) / 2, (dS + Db) / 2, [Math.max(1200, Math.abs(x1 - x) - 1600), 1100], true);
            x = x1;
          }
        };
        run(before, r0, -hx, -1); run(after, r1, hx, 1);
        // benching: pairs of desks running in from the facade, 3.2 m apart, clear of the columns
        const cols = colsX.map(f => f * hx);
        for (let x = -hx + 2400; x <= hx - 2400; x += 3200) {
          if (cols.some(c => Math.abs(c - x) < 1500)) continue;
          for (let d = 1300; d + 800 <= dS - aisle; d += 1600) { fu("Desk", x, d + 800, [1600, 1600], false); for (const o of [-1, 1]) fu("Chair", x + o * 1150, d + 800, [550, 550], false); desks += 2; }
        }
        sp("Open-plan office", -hx + 1500, dS - aisle / 2, "Workspace");
      }
      // columns at 6 m in, on the band's grid
      for (const f of colsX) add({ id: `${OK}-C${B.k}${Math.round((f + 1) * 2)}`, type: "Column", args: { position: rnd(P(...M(f * hx, (B.k === "S" || B.k === "N") ? L / 2 - vi - 6000 : W / 2 - ui - 6000))), columnType: { ref: "T-COL400" }, baseLevel: { ref: level }, height: HOTEL_CLEAR, rotation: Math.round(F.angAt(...M(f * hx, 6000), true)) } });
    }
    // the corners: a boardroom or corner office in each (two per corner, one per band, split by the demising line);
    // on the coworking floor each corner is one team suite
    const cornersUV = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    cornersUV.forEach(([su, sv], i) => {
      const inner = [su * ui, sv * vi], outer = [su * W / 2, sv * L / 2];
      if (mode !== "cowork") {
        wall("Demising", inner, outer, "T-BLOCK215");
        space("Corner office", [su * (ui + 7500), sv * (vi + 3000)], "Workspace"); space("Boardroom", [su * (ui + 3000), sv * (vi + 7500)], "Meeting");
        furn("Desk", [su * (ui + 8200), sv * (vi + 2200)], [1800, 800], true); furn("Sofa", [su * (ui + 9800), sv * (vi + 5600)], [1800, 800], false);
        furn("Table", [su * (ui + 2600), sv * (vi + 7600)], [1200, 3600], true);
      } else {
        space("Team suite", [su * (ui + 6000), sv * (vi + 6000)], "Workspace");
        for (const [du, dv] of [[3500, 3500], [3500, 7300], [7300, 3500], [7300, 7300]]) { furn("Desk", [su * (ui + du), sv * (vi + dv)], [1600, 1600], true); for (const o of [-1, 1]) furn("Chair", [su * (ui + du + o * 1150), sv * (vi + dv)], [550, 550], true); }
      }
    });
    T.slab(); T.finish();
    const atriumA = atria.reduce((s2, a) => s2 + (a.u1 - a.u0) * (a.v1 - a.v0), 0) / 1e6, gia = W * L / 1e6 - atriumA;
    return { T, desks, offices, gia: Math.round(gia), W, L };
  };
  {
    const mt = officeFloor("OFFICE", "tenants", "L2", "Office Level 2 — four tenancies (test fit)");
    const cw = officeFloor("OFFICE-CW", "cowork", "L3", "Office Level 3 — flexible workspace (test fit)");
    summary.push({ name: "Office", desks: mt.desks, coworkDesks: cw.desks, privateOffices: cw.offices, gia: mt.gia });
    text("TX-OF", `OFFICE L2 — ${(mt.W / 1000).toFixed(1)} × ${(mt.L / 1000).toFixed(1)} m — four tenancies — ${mt.desks} desks — ${mt.gia} m² GIA per floor`, [Math.min(...mt.T.xs) - 3000, Math.max(...mt.T.ys) + 7000], mt.T.view, "TT-25", 80);
    text("TX-OFC", `OFFICE L3 — flexible workspace — ${cw.offices} private offices, ${cw.desks} desks in them, plus team suites and lounge`, [Math.min(...cw.T.xs) - 3000, Math.max(...cw.T.ys) + 7000], cw.T.view, "TT-25", 80);
    text("TX-SOF", `Office: four tenancies or flexible workspace`, [Math.min(...mt.T.xs) - 60000, (Math.min(...mt.T.ys) + Math.max(...mt.T.ys)) / 2], "V-SITE", "TT-25", 40);
  }
  add({ id: "V-3D", type: "View3D", name: "Test fit — 3D", args: { camera: { azimuth: 210, elevation: 40, target: [100000, 0, 0] }, scale: 1000, style: { ref: "VS-PRESENTATION" }, visualStyle: "Shaded" } });
  add({ id: "SC-ROOMS", type: "Schedule", name: "Room Schedule", args: { of: "IfcSpace", fields: ["Number", "Name", "Department", "Area"] } });
  add({ id: "SH-T100", type: "Sheet", name: "T-100 Test Fit", args: { number: "T-100", sheetName: "Hotels and Office Test Fit — Typical Floor (WIP)", size: "A1", orientation: "landscape", titleBlock: { ref: "SY-TB-A1" },
    viewports: [{ id: "VP1", view: { ref: "V-SITE" }, at: [110, 320], clipVisible: false }, { id: "VP2", view: { ref: "V-OFFICE" }, at: [340, 330], clipVisible: false },
      { id: "VP3", view: { ref: "V-H1" }, at: [530, 420], clipVisible: false }, { id: "VP4", view: { ref: "V-H2" }, at: [530, 190], clipVisible: false }, { id: "VP5", view: { ref: "V-H3" }, at: [710, 320], clipVisible: false }], revision: "P02" } });
  doc.meta.hotelSummary = summary;
  doc.graph.layout = {};
  doc.browser = { organisation: "by-discipline", expanded: ["Views", "Sheets"] };
  doc.regenerate();
  return doc;
}
