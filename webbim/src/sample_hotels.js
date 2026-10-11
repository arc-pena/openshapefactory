//! Hotels and office test fit, on the client's site drawing (Floor_Plan_Ali.dxf, metres): three hotel plates
//! and an office plate, each a typical floor laid out as a believable work-in-progress plan.
//!
//! The plates come straight from the drawing's Typical_Floor outlines. They are not rectangles: two sides are
//! arcs about the site's own centre (radius 620-870 m) and two are near-radial lines, so every layout here is
//! built in the plate's own (u, v) frame - u across the plate, v along its arcs - and mapped back on to the
//! curved outline. Lines of constant v come out straight; lines of constant u come out as arcs, drawn as arc walls.
//!
//! Hotels follow the scheme drawn in the file: keys about 8 m deep round the facade, a corridor ring, a central
//! atrium with its lifts at the ends; two stairs and corner suites are added. The office has the drawing's two
//! atria, a 12 m deep open-plan ring, two cores in the inner zone, meeting rooms and benching.
//! Everything else in the drawing that is not the site boundary is podium terracing, drawn as dashed lines.
//!
//! Coordinates in mm: x east, y north; the drawing's origin moved by HOTEL_DXF.origin.

import { newDocument } from "./bim.js";
import { VS_PRESENTATION } from "./library.js";
import { Editor } from "./ops.js";

const HOTEL_DXF = {"origin":[300000,500000],"boundary":[{"k":"A","c":[733837,217745],"r":1006197,"a0":-2.3942458,"a1":-3.2673205},{"k":"L","a":[-264417,343919],"b":[135242,324796]},{"k":"L","a":[135242,324796],"b":[117451,265081]},{"k":"L","a":[117451,265081],"b":[124863,212321]},{"k":"L","a":[124863,212321],"b":[114143,133296]},{"k":"L","a":[114143,133296],"b":[148629,48512]},{"k":"L","a":[148629,48512],"b":[191185,16106]},{"k":"L","a":[191185,16106],"b":[238227,-60339]},{"k":"L","a":[238227,-60339],"b":[247117,-141369]},{"k":"L","a":[247117,-141369],"b":[284965,-179554]},{"k":"L","a":[284965,-179554],"b":[-4203,-466162]}],"terraces":[{"k":"A","c":[732213,217680],"r":635807,"a0":3.0763357,"a1":3.1023297,"layer":"gh"},{"k":"A","c":[731544,217414],"r":640128,"a0":3.1022766,"a1":3.0761602,"layer":"gh"},{"k":"A","c":[789790,214371],"r":699947,"a0":3.1058086,"a1":3.0731644,"layer":"gh"},{"k":"A","c":[789323,214690],"r":691489,"a0":3.0728349,"a1":3.1053383,"layer":"gh"},{"k":"A","c":[731425,217420],"r":651008,"a0":3.1215401,"a1":3.0608156,"layer":"gh"},{"k":"L","a":[82539,269950],"b":[82647,271282],"layer":"gh"},{"k":"L","a":[82647,271282],"b":[109788,272207],"layer":"gh"},{"k":"L","a":[109788,272207],"b":[109645,270523],"layer":"gh"},{"k":"A","c":[732119,217685],"r":624712,"a0":3.0569109,"a1":3.1177446,"layer":"gh"},{"k":"L","a":[107584,232582],"b":[107552,231244],"layer":"gh"},{"k":"L","a":[107552,231244],"b":[80514,228799],"layer":"gh"},{"k":"L","a":[80514,228799],"b":[80548,230474],"layer":"gh"},{"k":"A","c":[731804,216981],"r":716680,"a0":-2.5775574,"a1":-2.5169418,"layer":"gh"},{"k":"A","c":[731363,216817],"r":730239,"a0":-2.5157413,"a1":-2.5763107,"layer":"gh"},{"k":"A","c":[731889,217039],"r":718783,"a0":-2.5634612,"a1":-2.5307349,"layer":"gh"},{"k":"A","c":[731457,216881],"r":728354,"a0":-2.5296439,"a1":-2.5627148,"layer":"gh"},{"k":"A","c":[733903,217776],"r":634270,"a0":-2.715053,"a1":-2.6854826,"layer":"gh"},{"k":"A","c":[733189,217508],"r":642547,"a0":-2.6841774,"a1":-2.7140371,"layer":"gh"},{"k":"A","c":[733203,217514],"r":640562,"a0":-2.6875715,"a1":-2.7111127,"layer":"gh"},{"k":"A","c":[733912,217780],"r":636280,"a0":-2.7116937,"a1":-2.6883716,"layer":"gh"},{"k":"L","a":[64067,-255750],"b":[65273,-257449],"layer":"Office_ground_lvl"},{"k":"L","a":[65273,-257449],"b":[22042,-291443],"layer":"Office_ground_lvl"},{"k":"A","c":[731037,216656],"r":872261,"a0":-2.5197813,"a1":-2.5616601,"layer":"Office_ground_lvl"},{"k":"L","a":[62276,-181582],"b":[76658,-171847],"layer":"Blue"},{"k":"A","c":[731107,219368],"r":762465,"a0":-2.6028085,"a1":-2.5261916,"layer":"Blue"},{"k":"L","a":[108522,-220793],"b":[22042,-288796],"layer":"Blue"},{"k":"L","a":[22042,-288796],"b":[17283,-282088],"layer":"Blue"},{"k":"L","a":[35263,-190709],"b":[58580,-175309],"layer":"Blue"},{"k":"A","c":[730990,216675],"r":778323,"a0":-2.6138004,"a1":-2.5371506,"layer":"Blue"},{"k":"L","a":[90571,-225648],"b":[68424,-242663],"layer":"Blue"},{"k":"A","c":[730576,216428],"r":805829,"a0":-2.5655088,"a1":-2.5353501,"layer":"Blue"},{"k":"L","a":[68350,-242720],"b":[16017,-282929],"layer":"Blue"},{"k":"A","c":[730825,216513],"r":872005,"a0":-2.5317342,"a1":-2.5617338,"layer":"Blue"},{"k":"L","a":[109694,-223238],"b":[108488,-224188],"layer":"Blue"},{"k":"A","c":[731103,216719],"r":762921,"a0":-2.5254154,"a1":-2.6020213,"layer":"Blue"},{"k":"L","a":[76571,-175245],"b":[122156,-144345],"layer":"Blue"},{"k":"L","a":[122156,-144345],"b":[123253,-146190],"layer":"Blue"},{"k":"A","c":[733745,217743],"r":626104,"a0":-3.1411783,"a1":-3.1098041,"layer":"Blue"},{"k":"L","a":[107957,197843],"b":[57312,190633],"layer":"Blue"},{"k":"A","c":[732474,217225],"r":675685,"a0":-3.1022261,"a1":-3.2081889,"layer":"Blue"},{"k":"L","a":[58287,262190],"b":[75123,262921],"layer":"Blue"},{"k":"L","a":[107818,232668],"b":[107696,226114],"layer":"Blue"},{"k":"A","c":[733559,217594],"r":625880,"a0":-2.6531286,"a1":-2.634276,"layer":"Blue"},{"k":"L","a":[186507,-86480],"b":[157121,-105663],"layer":"Blue"},{"k":"A","c":[732865,217380],"r":660180,"a0":-2.6302763,"a1":-2.6947626,"layer":"Blue"},{"k":"L","a":[137501,-67890],"b":[144869,-63682],"layer":"Blue"},{"k":"A","c":[733764,220392],"r":626124,"a0":3.1220051,"a1":3.1463269,"layer":"Red"},{"k":"L","a":[107647,217428],"b":[73783,213465],"layer":"Red"},{"k":"A","c":[732884,220029],"r":659134,"a0":-3.1316342,"a1":-3.2208212,"layer":"Red"},{"k":"L","a":[75818,272196],"b":[109884,273357],"layer":"Red"},{"k":"L","a":[109884,273357],"b":[109688,270987],"layer":"Red"},{"k":"L","a":[129518,-210652],"b":[111154,-225281],"layer":"Blue"},{"k":"A","c":[731104,219367],"r":762922,"a0":-2.5193946,"a1":-2.5959333,"layer":"Blue"},{"k":"L","a":[78970,-176575],"b":[124376,-145419],"layer":"Blue"},{"k":"A","c":[731815,219636],"r":708694,"a0":-2.6004577,"a1":-2.5235891,"layer":"Blue"},{"k":"L","a":[154204,-190988],"b":[153085,-191879],"layer":"Blue"},{"k":"L","a":[136187,-44935],"b":[160663,-31786],"layer":"Blue"},{"k":"A","c":[733837,220392],"r":626197,"a0":-2.7271134,"a1":-2.6495421,"layer":"Blue"},{"k":"L","a":[181929,-75445],"b":[158468,-90294],"layer":"Blue"},{"k":"A","c":[733062,220102],"r":653073,"a0":-2.6463039,"a1":-2.7237049,"layer":"Blue"}],"quads":{"OFFICE_IN":{"inner":{"c":[731018,216713],"r":818355,"a0":-2.62677159,"a1":-2.57945186},"outer":{"c":[731328,216839],"r":860604,"a0":-2.62485066,"a1":-2.57635904},"W":41977,"L":40228},"H1":{"inner":{"c":[732118,217685],"r":626211,"a0":3.0569108,"a1":3.11774465},"outer":{"c":[731426,217420],"r":649509,"a0":3.0608157,"a1":3.12154002},"W":24132,"L":38768},"H2":{"inner":{"c":[733847,217750],"r":626208,"a0":-2.72711292,"a1":-2.67534847},"outer":{"c":[733120,217475],"r":650470,"a0":-2.7240209,"a1":-2.67235739},"W":25107,"L":33010},"H3":{"inner":{"c":[731808,216984],"r":708685,"a0":-2.57821236,"a1":-2.51754803},"outer":{"c":[731359,216815],"r":738235,"a0":-2.5756955,"a1":-2.51517242},"W":30062,"L":43836},"OFFICE":{"inner":{"c":[730885,216634],"r":806200,"a0":-2.64228073,"a1":-2.5655032},"outer":{"c":[731156,216736],"r":872404,"a0":-2.63809527,"a1":-2.56172832},"W":66006,"L":64260}}};
// read off the hotel layouts drawn in the file, in each plate's (u, v) frame, mm
const HOTEL_SCHEMES = {
  H1: { name: "Hotel 1", D: 8050, vb: 9800, nb: 4, vE: 12800, ends: [-5270, 0, 5270], atrium: { u: 2500, v0: -7800, v1: 7800 }, lifts: [{ u: 2500, v0: 7800, v1: 9800, face: 1 }, { u: 2500, v0: -9800, v1: -7800, face: -1 }] },
  H2: { name: "Hotel 2", D: 8020, vb: 7420, nb: 3, vE: 9500, ends: [-5530, 0, 5530], atrium: { u: 2530, v0: -5500, v1: 7500 }, lifts: [{ u: 2530, v0: -7500, v1: -5500, face: -1 }] },
  H3: { name: "Hotel 3", D: 8010, vb: 9220, nb: 4, vE: 13900, ends: [-2340, 2340], atrium: { u: 5020, v0: -9900, v1: 9900 }, lifts: [{ u: 3010, v0: 9900, v1: 11900, face: 1 }, { u: 3010, v0: -11900, v1: -9900, face: -1 }] },
};
const HOTEL_BATH_D = 2400, HOTEL_BATH_W = 1900, HOTEL_CLEAR = 3200;

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
  function plate(key, label, scale) {
    const q = HOTEL_DXF.quads[key], F = plateFrame(q), P = F.P;
    const corners = [P(-q.W / 2, -q.L / 2), P(q.W / 2, -q.L / 2), P(q.W / 2, q.L / 2), P(-q.W / 2, q.L / 2)];
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const view = `V-${key}`;
    add({ id: view, type: "PlanView", name: `${label} — Typical Floor (test fit)`, args: { level: { ref: "L1" }, scale, viewRange: vr(2300, 1200, -500, -500), detailLevel: "Medium", style: { ref: "VS-HOTEL" }, clip: { rect: [Math.min(...xs) - 9000, Math.min(...ys) - 9000, Math.max(...xs) + 9000, Math.max(...ys) + 9000].map(Math.round), visible: false, active: true } } });
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
          add({ id, type: "Wall", name: w.name, args: Object.assign({ centreline: line(A, B), mounting: "Centred", wallType: { ref: w.type }, baseLevel: { ref: "L1" }, baseOffset: 0, height: HOTEL_CLEAR, flipped: false }, w.extra), params: { Phase: "New", Comments: "Test fit - work in progress" } });
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
    const door = (spec, uv, flip, w = 915) => pending.push(() => { const hst = hostAt(spec, uv), oid = `${key}-OP${++op}`, at = Math.max(w / 2 + 120, Math.min(hst.L - w / 2 - 120, hst.at));
      add({ id: oid, type: "Opening", args: { host: { ref: hst.id }, profile: { kind: "rect", at: Math.round(at), sill: 0, w, h: 2100 }, farProfile: null, depth: "through" } });
      add({ id: `${key}-D${op}`, type: "Door", args: { fills: { ref: oid }, doorType: { ref: w > 1000 ? "T-DOOR1015" : "T-DOOR915" }, flipHand: !!flip, flipFacing: true, clearance: "None" }, params: { Phase: "New" } }); });
    const hole = (spec, uv, w) => pending.push(() => { const hst = hostAt(spec, uv), at = Math.max(w / 2 + 50, Math.min(hst.L - w / 2 - 50, hst.at));
      add({ id: `${key}-OP${++op}`, type: "Opening", args: { host: { ref: hst.id }, profile: { kind: "rect", at: Math.round(at), sill: 0, w, h: 2200 }, farProfile: null, depth: "through" } }); });
    const space = (name, uv, dept, number, quiet) => add({ id: `${key}-SP${++sp}`, type: "Space", name, args: { level: { ref: "L1" }, upperLimit: { mode: "offset", offset: HOTEL_CLEAR }, anchor: rnd(P(...uv)), boundaryAt: "finishFace" }, params: Object.assign({ Number: number || "", Department: dept, Occupancy: dept === "Guest room" ? 2 : 0 }, quiet ? { LabelFormat: " " } : {}) });
    const furn = (shape, uv, size, alongV) => add({ id: `${key}-FU${++fu}`, type: "Furniture", args: { position: rnd(P(...uv)), shape, size, rotation: Math.round(((F.angAt(uv[0], uv[1], alongV) % 360) + 360) % 360), level: { ref: "L1" } } });
    const rect = (name, u0, u1, v0, v1, type, extra) => [wall(name, [u0, v0], [u1, v0], type, extra), wall(name, [u1, v0], [u1, v1], type, extra), wall(name, [u1, v1], [u0, v1], type, extra), wall(name, [u0, v1], [u0, v0], type, extra)];
    const stair = (u0, u1, v0, v1, alongV) => {
      const ln = (a, b) => add({ id: `${key}-DLS${++n}`, type: "DetailLine", args: { curve: line(P(...a), P(...b)), pen: "thin", lineStyle: "Solid", view: { ref: view }, layer: "Stair", colour: "#000000" } });
      const land = 1500;
      if (alongV) { const lo = Math.min(v0, v1) + land, hi = Math.max(v0, v1) - land, m = (u0 + u1) / 2; ln([m, lo], [m, hi]); for (let y = lo; y <= hi + 1; y += 280) ln([u0 + 150, y], [u1 - 150, y]); }
      else { const lo = Math.min(u0, u1) + land, hi = Math.max(u0, u1) - land, m = (v0 + v1) / 2; ln([lo, m], [hi, m]); for (let x = lo; x <= hi + 1; x += 280) ln([x, v0 + 150], [x, v1 - 150]); }
    };
    const slab = () => add({ id: `${key}-FL`, type: "Floor", name: `${label} slab`, args: { boundary: corners.map(rnd), floorType: { ref: "T-FLOOR250" }, level: { ref: "L1" }, heightOffset: 0 } });
    return { q, F, P, view, wall, rect, door, hole, space, furn, stair, slab, finish, corners, xs, ys };
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
      if (endOuter > uc) for (const s of [-1, 1]) wall("Corridor wall", [s * uc, t * H.vE], [s * endOuter, t * H.vE], "T-BLOCK215");
      for (const u of H.ends) wall("Demising", [u, t * H.vE], [u, t * L / 2], "T-PART100");
      for (const s of [-1, 1]) {
        // the corner suite: entered off the corridor's side (an L-shaped suite) or its end
        const anchorU = s * (endOuter + (W / 2 - endOuter) / 2), anchorV = t * (H.vE + Dend * 0.55);
        if (!extraKey) door(ringSide(s), [s * uc, t * (H.vb + H.vE) / 2], s * t > 0);
        else door(ringEnd(t), [s * (Math.min(uc, endOuter) + Math.max(uc, endOuter)) / 2, t * H.vE], s > 0);
        furn("Desk", [s * (W / 2 - 2600), t * (H.vE + Dend / 2)], [1800, 2000], false);
        furn("Sofa", [anchorU - s * 600, t * (L / 2 - 1300)], [2400, 850], true);
        space("Corner suite", [anchorU, anchorV], "Guest room", keyNo());
      }
      // between the end partitions: a stair at the first, keys in the rest
      for (let i = 0; i + 1 < H.ends.length; i++) {
        const a = H.ends[i], b = H.ends[i + 1];
        if (i === 0) {
          stair(a, b, t * H.vE, t * L / 2, true); space("Stair", [(a + b) / 2, t * (H.vE + Dend / 2)], "Core");
          door(ringEnd(t), [(a + b) / 2, t * H.vE], t > 0, 1015);
        } else keyRoom((d, x) => [x, t * (H.vE + d)], a, b, Dend, (i % 2) === 1, ringEnd(t), false);
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

  // ---------------------------------------------------------------- office
  {
    const T = plate("OFFICE", "Office", 400), { q, wall, rect, door, hole, space, furn, stair, P, F } = T;
    const W = q.W, L = q.L, ui = 21000, vi = 20200;                 // the inner zone (the drawing's inner outline)
    rect("Facade", -W / 2, W / 2, -L / 2, L / 2, "T-EXTCAV300");
    // the two atria, as drawn
    const atria = [{ u0: -ui, u1: 7000, v0: 6600, v1: vi }, { u0: 0, u1: ui, v0: -vi, v1: 0 }];
    atria.forEach((a, i) => { rect("Atrium balustrade", a.u0, a.u1, a.v0, a.v1, "T-GLASS30", { height: 1100 }); space(`Atrium ${i + 1}`, [(a.u0 + a.u1) / 2, (a.v0 + a.v1) / 2], "Atrium"); });
    // two cores in the quadrants the atria leave: stair, three lifts, WCs; the lift lobby opens to the floor
    const core = (u0, u1, v0, v1, mirror, tag) => {
      const sgn = mirror ? -1 : 1, U = x => mirror ? u1 - (x - u0) : x, V = y => mirror ? v1 - (y - v0) : y;
      const w = rect(`Core ${tag}`, Math.min(U(u0), U(u1)), Math.max(U(u0), U(u1)), Math.min(V(v0), V(v1)), Math.max(V(v0), V(v1)), "T-BLOCK215");
      const sU = u0 + 5200, lV = v0 + 2600, wcV = v0 + 7000;
      wall("Stair", [U(sU), V(v0)], [U(sU), V(v1)], "T-BLOCK215");
      wall("Stair", [U(u0), V(wcV)], [U(sU), V(wcV)], "T-BLOCK215");
      stair(Math.min(U(u0), U(sU)), Math.max(U(u0), U(sU)), Math.min(V(v0), V(wcV)), Math.max(V(v0), V(wcV)), true);
      space("Stair", [U((u0 + sU) / 2), V((v0 + wcV) / 2)], "Core");
      wall("WC", [U(u0), V((wcV + v1) / 2)], [U(sU), V((wcV + v1) / 2)], "T-PART100");
      space("WC", [U((u0 + sU) / 2), V((wcV + (wcV + v1) / 2) / 2)], "Core"); space("WC", [U((u0 + sU) / 2), V(((wcV + v1) / 2 + v1) / 2)], "Core");
      wall("Lift shafts", [U(sU), V(lV)], [U(u1), V(lV)], "T-BLOCK215");
      const lw = (u1 - sU) / 3; for (let i = 1; i < 3; i++) wall("Lift shafts", [U(sU + i * lw), V(v0)], [U(sU + i * lw), V(lV)], "T-BLOCK215");
      for (let i = 0; i < 3; i++) space("Lift", [U(sU + (i + 0.5) * lw), V((v0 + lV) / 2)], "Core");
      space("Lift lobby", [U((sU + u1) / 2), V((lV + v1) / 2)], "Circulation");
      return w;
    };
    const c1 = core(-ui, -9000, -vi, -6000, false, "1"), c2 = core(9000, ui, 6600, vi, true, "2");
    // the lobby side of each core is open to the floor: openings in its fourth wall, the stair and WCs entered from the lobby
    hole(c1[1], [-9000, -9000], 3000); hole(c2[3], [9000, 13400], 3000);
    // the line between the open-plan ring and the inner floor: room separators, so each reads as its own space
    const seps = [[[-ui, -vi], [ui, -vi]], [[ui, -vi], [ui, vi]], [[ui, vi], [-ui, vi]], [[-ui, vi], [-ui, -vi]]];
    seps.forEach(([a, b], i) => add({ id: `OF-RS${i + 1}`, type: "RoomSeparator", args: { line: line(P(...a), P(...b)), level: { ref: "L1" } } }));
    space("Floor plate circulation", [-4000, -3000], "Circulation");
    // meeting rooms in two corners (glass), breakout in the other two
    const corner = (su, sv, kind) => {
      wall("Meeting", [su * ui, sv * vi], [su * W / 2, sv * vi], "T-GLASS30");
      wall("Meeting", [su * ui, sv * vi], [su * ui, sv * L / 2], "T-GLASS30");
      const cu = su * (ui + W / 2) / 2, cv = sv * (vi + L / 2) / 2;
      if (kind === "meeting") { furn("Table", [cu, cv], [4200, 1400], true); space("Meeting room", [cu + su * 3500, cv], "Meeting"); }
      else { furn("Sofa", [cu - su * 2500, cv + sv * 2500], [2400, 850], true); furn("Table", [cu + su * 1500, cv - sv * 1500], [1200, 1200], true); space("Breakout", [cu, cv], "Meeting"); }
    };
    corner(1, 1, "meeting"); corner(-1, -1, "meeting"); corner(1, -1, "breakout"); corner(-1, 1, "breakout");
    // doors into the corner rooms off the open plan (meeting) - holes for breakout
    // benching: banks of desks running from the inner line to the facade, 3.6 m apart
    let desks = 0;
    const bank = (fixedUV, sideSign, alongU) => {
      // 4 pairs from 2.0 m off the inner line towards the facade, chairs either side
      for (let k = 0; k < 4; k++) {
        const d = 2400 + k * 1700;
        const uv = alongU ? [sideSign * (ui + d), fixedUV] : [fixedUV, sideSign * (vi + d)];
        furn("Desk", uv, [1600, 1600], !alongU); desks += 2;
        for (const o of [-1, 1]) furn("Chair", alongU ? [uv[0], uv[1] + o * 1200] : [uv[0] + o * 1200, uv[1]], [550, 550], !alongU);
      }
    };
    for (const s of [-1, 1]) for (let v = -vi + 1800; v <= vi - 1800; v += 3600) bank(v, s, true);
    for (const s of [-1, 1]) for (let u = -ui + 1800; u <= ui - 1800; u += 3600) bank(u, s, false);
    for (const s of [-1, 1]) { space("Open-plan office", [s * (ui + 6000), 1800], "Workspace"); space("Open-plan office", [1800, s * (vi + 6000)], "Workspace"); }
    // columns on a 9 m grid in the office ring
    let col = 0;
    for (const s of [-1, 1]) for (let v = -vi; v <= vi + 1; v += vi / 2) add({ id: `OF-C${++col}`, type: "Column", args: { position: rnd(P(s * (ui + 6000), v)), columnType: { ref: "T-COL400" }, baseLevel: { ref: "L1" }, height: HOTEL_CLEAR, rotation: Math.round(F.angAt(s * (ui + 6000), v, true)) } });
    for (const s of [-1, 1]) for (let u = -ui; u <= ui + 1; u += ui / 2) add({ id: `OF-C${++col}`, type: "Column", args: { position: rnd(P(u, s * (vi + 6000))), columnType: { ref: "T-COL400" }, baseLevel: { ref: "L1" }, height: HOTEL_CLEAR, rotation: Math.round(F.angAt(u, s * (vi + 6000), true)) } });
    T.slab(); T.finish();
    const atriumA = atria.reduce((s, a) => s + (a.u1 - a.u0) * (a.v1 - a.v0), 0) / 1e6, gia = W * L / 1e6 - atriumA;
    summary.push({ name: "Office", desks, gia: Math.round(gia) });
    text("TX-OF", `OFFICE — ${(W / 1000).toFixed(1)} × ${(L / 1000).toFixed(1)} m — two atria — ${desks} desks — ${Math.round(gia)} m² GIA per floor`, [Math.min(...T.xs) - 3000, Math.max(...T.ys) + 7000], T.view, "TT-25", 80);
    text("TX-SOF", `Office: ${desks} desks / floor`, [Math.min(...T.xs) - 60000, (Math.min(...T.ys) + Math.max(...T.ys)) / 2], "V-SITE", "TT-25", 40);
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
