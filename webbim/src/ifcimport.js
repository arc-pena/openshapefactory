//! IFC classes read as Web BIM classes.
//!
//! The modeller's IFC package brings a building in as geometry nodes. This
//! brings it in as the building: an IfcWall becomes a Wall with a centreline
//! and a type whose thickness is the wall's, an IfcSlab a Floor (a wall laid
//! flat), an IfcColumn a Column, an IfcBeam a Beam (a profile swept along a
//! line), an IfcDoor or IfcWindow an Opening in its host wall with its filler,
//! an IfcBuildingStorey a Level. Types are matched by size or created. What is
//! not mapped is counted by class in the report, never dropped silently.

import { readIfc, ifcScale, ofType, follow, followAll, asText, asNumber, isRef, asList, pointingAt, ifcWorldFrame, ifcBodyItems, ifcProfile,
  ifcPlacementFrame, ifcCompose, ifcAt, ifcDirection, ifcName } from "./ifcread.js";

const WALLS = new Set(["IFCWALL", "IFCWALLSTANDARDCASE", "IFCWALLELEMENTEDCASE", "IFCCURTAINWALL"]);
const SLABS = new Set(["IFCSLAB", "IFCSLABSTANDARDCASE", "IFCSLABELEMENTEDCASE", "IFCROOF", "IFCCOVERING"]);
const COLUMNS = new Set(["IFCCOLUMN", "IFCCOLUMNSTANDARDCASE", "IFCMEMBER"]);
const BEAMS = new Set(["IFCBEAM", "IFCBEAMSTANDARDCASE"]);
const FILLERS = new Set(["IFCDOOR", "IFCDOORSTANDARDCASE", "IFCWINDOW", "IFCWINDOWSTANDARDCASE"]);
const PROXIES = new Set(["IFCBUILDINGELEMENTPROXY"]);
const IGNORED = new Set(["IFCOPENINGELEMENT", "IFCSPACE", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCPROJECT", "IFCANNOTATION", "IFCGRID"]);

const r1 = v => Math.round(v * 10) / 10;
/** The outline of a profile in its own 2D frame, as points. */
function profilePoints(profile) {
  if (!profile) return null;
  const at = profile.at || [0, 0], ang = profile.angle || 0, c = Math.cos(ang), s = Math.sin(ang);
  const put = ([x, y]) => [at[0] + x * c - y * s, at[1] + x * s + y * c];
  if (profile.kind === "rect") { const w = profile.values.width / 2, h = profile.values.height / 2; return [[-w, -h], [w, -h], [w, h], [-w, h]].map(put); }
  if (profile.kind === "circle") { const r = profile.values.radius, pts = []; for (let i = 0; i < 24; i++) pts.push(put([r * Math.cos(i / 24 * 2 * Math.PI), r * Math.sin(i / 24 * 2 * Math.PI)])); return pts; }
  if (profile.kind === "section") { const v = profile.values; const w = (v.width || 200) / 2, h = (v.depth || 200) / 2; return [[-w, -h], [w, -h], [w, h], [-w, h]].map(put); }
  if (profile.kind === "drawn") {
    const pts = [];
    for (const el of profile.outer || []) {
      if (el.type === "line") { if (!pts.length) pts.push(put(el.a)); pts.push(put(el.b)); }
      else if (el.c && el.r) { const a0 = el.a0 || 0, a1 = el.a1 === undefined ? a0 + 2 * Math.PI : el.a1, n = 12; for (let i = pts.length ? 1 : 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push(put([el.c[0] + el.r * Math.cos(a), el.c[1] + el.r * Math.sin(a)])); } }
    }
    if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
    return pts.length >= 3 ? pts : null;
  }
  return null;
}
/** Oriented extent of points: the long axis, its length, the short width, the centre. */
function orientedBox(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]];
    const us = pts.map(p => p[0] * d[0] + p[1] * d[1]), vs = pts.map(p => p[0] * n[0] + p[1] * n[1]);
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-6) best = { area, d, n, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { d, n, u0, u1, v0, v1 } = best, len = u1 - u0, wid = v1 - v0;
  const long = len >= wid ? d : n, L = Math.max(len, wid), W = Math.min(len, wid);
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, centre = [d[0] * cu + n[0] * cv, d[1] * cu + n[1] * cv];
  return { centre, dir: long, length: L, width: W };
}
/** Everything an element's body is made of, in world coordinates. Extrusions stay extrusions (their
 *  profile and direction are what makes a wall a wall and a beam a beam); a mapped item is followed
 *  through its map (a Revit file is mostly those: nine hundred beams sharing one shape); a boolean
 *  result is its first operand (a wall clipped under a roof is still the wall); and anything else -
 *  a brep, a face set, a swept disk - arrives as the points it is made of. */
function bodySolids(model, entity, scale) {
  const frame = ifcWorldFrame(model, entity.args[5], scale), out = [];
  let clipped = false;
  const turn = (f, v) => [f.x[0] * v[0] + f.y[0] * v[1] + f.z[0] * v[2], f.x[1] * v[0] + f.y[1] * v[1] + f.z[1] * v[2], f.x[2] * v[0] + f.y[2] * v[1] + f.z[2] * v[2]];
  const visit = (item, fr, depth) => {
    if (!item || depth > 8) return;
    const a = item.args || [];
    if (item.type === "IFCEXTRUDEDAREASOLID" || item.type === "IFCEXTRUDEDAREASOLIDTAPERED") {
      const place = ifcCompose(fr, ifcPlacementFrame(model, a[1], scale));
      const profile = ifcProfile(model, a[0], scale), local = profilePoints(profile);
      const dir = turn(place, ifcDirection(model, a[2], [0, 0, 1])), len = asNumber(a[3]) * scale;
      const world = local ? local.map(p => ifcAt(place, [p[0], p[1], 0])) : null;
      out.push({ kind: "extrusion", place, profile, local, world, dir, depth: len,
        points: world ? world.concat(world.map(p => [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len])) : [] });
    } else if (item.type === "IFCMAPPEDITEM") {
      const src = follow(model, a[0]), rep = src && follow(model, src.args[1]); if (!rep) return;
      const place = ifcCompose(ifcCompose(fr, ifcPlacementFrame(model, a[1], scale)), ifcPlacementFrame(model, src.args[0], scale));
      for (const it of followAll(model, rep.args[3])) visit(it, place, depth + 1);
    } else if (item.type === "IFCBOOLEANRESULT" || item.type === "IFCBOOLEANCLIPPINGRESULT") {
      clipped = true; visit(follow(model, a[1]), fr, depth + 1);
    } else if (item.type === "IFCCSGSOLID") {
      visit(follow(model, a[0]), fr, depth + 1);
    } else if (item.type === "IFCBLOCK") {
      const place = ifcCompose(fr, ifcPlacementFrame(model, a[0], scale)), [dx, dy, dz] = [1, 2, 3].map(i => asNumber(a[i]) * scale);
      const pts = []; for (const x of [0, dx]) for (const y of [0, dy]) for (const z of [0, dz]) pts.push(ifcAt(place, [x, y, z]));
      out.push({ kind: "points", points: pts });
    } else {
      const pts = collectPoints(model, item, scale);
      if (pts.length >= 3) out.push({ kind: "points", points: pts.map(p => ifcAt(fr, p)) });
    }
  };
  for (const it of ifcBodyItems(model, entity)) visit(it, frame, 0);
  const points = out.flatMap(x => x.points);
  return { frame, solids: out, points, clipped, extrusions: out.filter(x => x.kind === "extrusion") };
}
/** The points a brep or face set is made of: its cartesian points and point lists, and nothing that is
 *  only a placement or a direction. Each entity is read once however many faces share it. */
const PLACEMENTS = new Set(["IFCAXIS2PLACEMENT2D", "IFCAXIS2PLACEMENT3D", "IFCDIRECTION", "IFCSTYLEDITEM", "IFCPRESENTATIONLAYERASSIGNMENT", "IFCCARTESIANTRANSFORMATIONOPERATOR3D"]);
function collectPoints(model, item, scale) {
  const pts = [], seen = new Set(), LIMIT = 50000;
  const walk = (e, depth) => {
    if (!e || depth > 16 || seen.has(e.id) || pts.length > LIMIT) return; seen.add(e.id);
    if (PLACEMENTS.has(e.type)) return;
    if (e.type === "IFCCARTESIANPOINT") { const l = asList(e.args[0]).map(n => asNumber(n) * scale); pts.push([l[0] || 0, l[1] || 0, l[2] || 0]); return; }
    if (e.type === "IFCCARTESIANPOINTLIST3D") { for (const q of asList(e.args[0])) { const l = asList(q).map(n => asNumber(n) * scale); pts.push([l[0] || 0, l[1] || 0, l[2] || 0]); } return; }
    for (const v of e.args || []) for (const one of asList(v)) if (isRef(one)) walk(follow(model, one), depth + 1);
  };
  walk(item, 0);
  return pts;
}
/** Convex hull of plan points (monotone chain), counter-clockwise. */
function hull2(pts) {
  const P = pts.map(p => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-9) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 1e-9) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
/** The long axis of a cloud of points, by power iteration on its covariance: a beam's line. */
function principalAxis(pts) {
  const n = pts.length, c = [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / n);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
  let v = [1, 0.3, 0.1];
  for (let it = 0; it < 60; it++) { const w = [0, 1, 2].map(i => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]); const L = Math.hypot(...w); if (L < 1e-12) break; v = w.map(x => x / L); }
  return { centre: c, axis: v };
}
/** Width and depth of a profile: its stated sizes, or the extent of the outline it was drawn as. */
function profileSize(profile, local) {
  const v = profile.values || {};
  if (profile.kind === "circle") return { W: v.radius * 2, D: v.radius * 2, round: true };
  if (profile.kind === "rect") return { W: v.width, D: v.height };
  if (profile.kind === "ellipse") return { W: v.major * 2, D: v.minor * 2 };
  if (profile.kind === "section" && v.width && v.depth) return { W: v.width, D: v.depth };
  if (local && local.length) { const xs = local.map(p => p[0]), ys = local.map(p => p[1]); return { W: Math.max(...xs) - Math.min(...xs), D: Math.max(...ys) - Math.min(...ys) }; }
  return null;
}
/** The profile's centre in its own plane: its seat, or the middle of what was drawn. */
function profileCentre(profile, local) {
  if (profile.kind !== "drawn") return profile.at || [0, 0];
  const xs = local.map(p => p[0]), ys = local.map(p => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
const zRange = pts => [Math.min(...pts.map(p => p[2])), Math.max(...pts.map(p => p[2]))];

export function importIfc(doc, text) {
  const model = readIfc(text), scale = ifcScale(model);
  const report = { made: {}, missed: {}, notes: [] };
  const made = k => { report.made[k] = (report.made[k] || 0) + 1; };
  const missed = k => { report.missed[k] = (report.missed[k] || 0) + 1; };
  const ops = [], taken = new Set(doc.elements().map(f => doc.idOf(f)));
  const fresh = prefix => { let n = 1; while (taken.has(prefix + n)) n++; taken.add(prefix + n); return prefix + n; };
  const newTypes = new Map();
  const typeFor = (key, make) => {
    const found = Object.entries(doc.lib.types).find(([, t]) => t.ifcKey === key) || [...newTypes.entries()].find(([, t]) => t.ifcKey === key);
    if (found) return found[0];
    let n = 1; while (doc.lib.types["T-IFC" + n] || newTypes.has("T-IFC" + n)) n++;
    const id = "T-IFC" + n; newTypes.set(id, Object.assign(make(), { ifcKey: key })); return id;
  };
  // storeys → levels, matched by elevation
  const levelOf = new Map();
  const levels = doc.elements().filter(f => doc.typeOf(f) === "Level").map(f => ({ id: doc.idOf(f), z: (doc.data(f) || {}).value || 0 }));
  for (const st of ofType(model, "IFCBUILDINGSTOREY")) {
    const z = asNumber(st.args[9]) * scale, name = ifcName(st) || "Storey";
    let lv = levels.find(l => Math.abs(l.z - z) < 1);
    if (!lv) { const id = fresh("L"); ops.push({ op: "add", element: { id, type: "Level", name, args: { name, elevation: r1(z) } } }); lv = { id, z }; levels.push(lv); made("Level"); }
    levelOf.set(st.id, lv);
  }
  //! One floor plan per level: every storey the file brings in (and any level still without one)
  //! gets its plan, as Revit makes a plan with each level. A level that already has a plan keeps it.
  const planned = new Set(doc.elements().filter(f => doc.typeOf(f) === "PlanView").map(f => ((doc.argValue(f, "level") || {}).ref)));
  const style = doc.lib.viewStyles && doc.lib.viewStyles["VS-CONSTRUCTION"] ? { ref: "VS-CONSTRUCTION" } : null;
  for (const lv of new Set(levelOf.values())) {
    if (planned.has(lv.id)) continue; planned.add(lv.id);
    const name = (ops.find(o => o.element && o.element.id === lv.id) || {}).element?.name || (doc.element(lv.id) && doc.element(lv.id).get("Name")) || lv.id;
    ops.push({ op: "add", element: { id: fresh("V-P"), type: "PlanView", name: `${name} Plan`, args: { level: { ref: lv.id }, scale: 100, viewRange: { top: 2300, cut: 1200, bottom: 0 }, detailLevel: "Fine", style, filters: [], clip: { rect: null, visible: false, active: false }, overrides: {} } } });
    made("Floor plan");
  }
  const storeyOf = new Map();
  for (const rel of ofType(model, "IFCRELCONTAINEDINSPATIALSTRUCTURE")) {
    const st = follow(model, rel.args[5]); if (!st) continue;
    for (const e of followAll(model, rel.args[4])) storeyOf.set(e.id, st.id);
  }
  const fallback = levels.slice().sort((a, b) => a.z - b.z)[0] || null;
  const levelFor = e => levelOf.get(storeyOf.get(e.id)) || fallback;
  const wallOf = new Map();                                  // IFC wall id → { id, a, b, z0, len }
  const noteOnce = new Set(), note = (key, text) => { if (!noteOnce.has(key)) { noteOnce.add(key); report.notes.push(text); } };
  const products = model.entities ? [...model.entities.values()] : [];
  const addColumn = (e, lv, c, W, D, round, rot, z0, h) => {
    const typeId = typeFor(`col:${W}x${D}:${round}`, () => ({ family: "F-RCCOLUMN", name: round ? `IFC Ø${W}` : `IFC ${W}×${D}`, mark: "C", width: W, depth: D, round, material: "M-CONC" }));
    const id = fresh("C");
    ops.push({ op: "add", element: { id, type: "Column", name: ifcName(e) || id, args: { position: [r1(c[0]), r1(c[1])], columnType: { ref: typeId }, baseLevel: lv ? { ref: lv.id } : null, height: r1(h), rotation: r1(rot), baseOffset: r1(z0 - (lv ? lv.z : 0)) } } });
    made("Column");
  };
  const addBeam = (e, lv, c0, c1, W, D, I, v) => {
    const typeId = typeFor(`beam:${W}x${D}:${I}`, () => I ? { family: "F-STEELBEAM", name: `IFC I ${D}×${W}`, mark: "B", shape: "I", width: W, depth: D, flange: r1(v.flange || 12), web: r1(v.web || 8), material: "M-STEEL" } : { family: "F-RCBEAM", name: `IFC ${W}×${D}`, mark: "B", shape: "rect", width: W, depth: D, material: "M-CONC" });
    const id = fresh("B"), top = Math.max(c0[2], c1[2]) + D / 2;
    if (Math.abs(c1[2] - c0[2]) > 1) note("slope", "sloping beams come in level, at their higher end");
    ops.push({ op: "add", element: { id, type: "Beam", name: ifcName(e) || id, args: { axis: { type: "line", start: [r1(c0[0]), r1(c0[1])], end: [r1(c1[0]), r1(c1[1])] }, beamType: { ref: typeId }, level: lv ? { ref: lv.id } : null, topOffset: r1(top - (lv ? lv.z : 0)) } } });
    made("Beam");
  };
  //! A flat element: a slab, a roof, a footing. One vertical extrusion is exact; anything else keeps its
  //! plan outline (the hull of what it is made of) and its thickness, and says so.
  const addFlat = (e, T, body, lv) => {
    const x = body.extrusions.length === 1 && body.solids.length === 1 ? body.extrusions[0] : null;
    let boundary, top, thick;
    if (x && x.world && Math.abs(x.dir[2]) > 0.9) { boundary = x.world; const zb = Math.min(...x.world.map(p => p[2])); top = x.dir[2] > 0 ? zb + x.depth : zb; thick = x.depth; }
    else {
      if (body.points.length < 3) return false;
      boundary = hull2(body.points); if (boundary.length < 3) return false;
      const [z0, z1] = zRange(body.points); top = z1;
      thick = x && Math.abs(x.dir[2]) <= 0.9 ? x.depth : z1 - z0;
      note("hull:" + T, `${T === "IFCFOOTING" ? "footings" : "slabs"} that are not one upright extrusion come in as their plan outline and thickness (sloped roofs flat at their top)`);
    }
    thick = r1(Math.max(1, thick));
    const footing = T === "IFCFOOTING";
    const typeId = typeFor((footing ? "footing:" : "slab:") + thick, () => ({ family: "F-FLOOR", name: `IFC ${footing ? "footing" : "slab"} ${thick}`, mark: footing ? "FT" : "FL", layers: [{ function: "Structure", thickness: thick, material: "M-CONC" }], coreStart: 0, coreEnd: 1 }));
    const id = fresh(footing ? "FT" : "FL");
    ops.push({ op: "add", element: { id, type: "Floor", name: ifcName(e) || id, args: { boundary: boundary.map(p => [r1(p[0]), r1(p[1])]), floorType: { ref: typeId }, level: lv ? { ref: lv.id } : null, heightOffset: r1(top - (lv ? lv.z : 0)) } } });
    made(T === "IFCROOF" ? "Floor (roof)" : footing ? "Floor (footing)" : "Floor");
    return true;
  };
  for (const e of products) {
    const T = e.type;
    if (/^IFCREL/.test(T) || !e.args || !isRef(e.args[6])) continue;
    const isWall = WALLS.has(T), isSlab = SLABS.has(T) || T === "IFCFOOTING", isCol = COLUMNS.has(T), isBeam = BEAMS.has(T), isProxy = PROXIES.has(T);
    if (!(isWall || isSlab || isCol || isBeam || isProxy)) { if (!FILLERS.has(T) && /^IFC/.test(T) && e.args.length > 6 && isRef(e.args[5]) && !IGNORED.has(T)) missed(T); continue; }
    const body = bodySolids(model, e, scale), lv = levelFor(e);
    if (!body.points.length) { missed(T); continue; }
    const [zLo, zHi] = zRange(body.points);
    if (body.clipped) note("clip", "elements cut by a boolean in the file (a wall clipped under a roof) come in whole, before the cut");
    if (isWall) {
      //! A wall is its plan's long box: the centreline down its middle, the short side its thickness.
      //! That reads an upright extrusion exactly and a brep, a clipped wall or an elevation-profile
      //! extrusion (what Revit writes for a gable) by the space they fill.
      const box = orientedBox(hull2(body.points)); if (!box || box.length < 1) { missed(T); continue; }
      const t = r1(Math.max(1, box.width)), a = [box.centre[0] - box.dir[0] * box.length / 2, box.centre[1] - box.dir[1] * box.length / 2], b = [box.centre[0] + box.dir[0] * box.length / 2, box.centre[1] + box.dir[1] * box.length / 2];
      if (!(body.extrusions.length === 1 && body.solids.length === 1 && Math.abs(body.extrusions[0].dir[2]) > 0.9)) note("wallbox", "walls that are not one upright extrusion come in as the box they fill (a gable wall at its full height)");
      const typeId = typeFor("wall:" + t, () => ({ family: "F-BASICWALL", name: `IFC wall ${t}`, mark: "IW", layers: [{ function: "Structure", thickness: t, material: "M-BLOCK" }], coreStart: 0, coreEnd: 1 }));
      const id = fresh("W");
      ops.push({ op: "add", element: { id, type: "Wall", name: ifcName(e) || id, args: { centreline: { type: "line", start: a.map(r1), end: b.map(r1) }, mounting: "Centred", wallType: { ref: typeId }, baseLevel: lv ? { ref: lv.id } : null, baseOffset: r1(zLo - (lv ? lv.z : 0)), height: r1(zHi - zLo) } } });
      wallOf.set(e.id, { id, a, b, z0: zLo, len: box.length }); made("Wall");
    } else if (isSlab) {
      if (!addFlat(e, T, body, lv)) missed(T);
    } else if (isCol || isBeam) {
      const x = body.extrusions.length === 1 ? body.extrusions[0] : null, size = x && x.profile ? profileSize(x.profile, x.local || []) : null;
      if (x && size && size.W > 0 && size.D > 0) {
        const W = r1(size.W), D = r1(size.D), pc = profileCentre(x.profile, x.local || []);
        const c0 = ifcAt(x.place, [pc[0], pc[1], 0]), c1 = [c0[0] + x.dir[0] * x.depth, c0[1] + x.dir[1] * x.depth, c0[2] + x.dir[2] * x.depth];
        if (Math.abs(x.dir[2]) > 0.9) {
          if (isBeam) note("vbeam", "upright beams come in as columns");
          addColumn(e, lv, c0, W, D, !!size.round, Math.atan2(x.place.x[1], x.place.x[0]) * 180 / Math.PI, zLo, zHi - zLo);
        } else {
          const I = x.profile.kind === "section" && /^I/.test(x.profile.sectionKind || "");
          addBeam(e, lv, c0, c1, W, D, I, x.profile.values || {});
        }
        continue;
      }
      //! No single extrusion: read the member off its points. Its long axis says column or beam;
      //! across it, the extents are its section.
      const { centre, axis } = principalAxis(body.points);
      const up = Math.abs(axis[2]) > 0.9;
      if (up) {
        const box = orientedBox(hull2(body.points)); if (!box) { missed(T); continue; }
        addColumn(e, lv, box.centre, r1(Math.max(1, box.length)), r1(Math.max(1, box.width)), false, Math.atan2(box.dir[1], box.dir[0]) * 180 / Math.PI, zLo, zHi - zLo);
      } else {
        const hz = Math.hypot(axis[0], axis[1]), n = [-axis[1] / hz, axis[0] / hz, 0];
        const m = [n[1] * axis[2] - n[2] * axis[1], n[2] * axis[0] - n[0] * axis[2], n[0] * axis[1] - n[1] * axis[0]];
        const along = p => (p[0] - centre[0]) * axis[0] + (p[1] - centre[1]) * axis[1] + (p[2] - centre[2]) * axis[2];
        const across = (p, v) => (p[0] - centre[0]) * v[0] + (p[1] - centre[1]) * v[1] + (p[2] - centre[2]) * v[2];
        const us = body.points.map(along), ns = body.points.map(p => across(p, n)), ms = body.points.map(p => across(p, m));
        const u0 = Math.min(...us), u1 = Math.max(...us), nm = (Math.min(...ns) + Math.max(...ns)) / 2, mm = (Math.min(...ms) + Math.max(...ms)) / 2;
        const mid = [0, 1, 2].map(k => centre[k] + n[k] * nm + m[k] * mm);
        const c0 = [0, 1, 2].map(k => mid[k] + axis[k] * u0), c1 = [0, 1, 2].map(k => mid[k] + axis[k] * u1);
        const W = r1(Math.max(1, Math.max(...ns) - Math.min(...ns))), D = r1(Math.max(1, Math.max(...ms) - Math.min(...ms)));
        if (isCol) note("hcol", "horizontal members come in as beams");
        addBeam(e, lv, c0, c1, W, D, false, {});
        note("beampts", "members that are not one extrusion come in as the box around them");
      }
    } else if (isProxy) {
      //! A proxy is IFC's "something": kept as a Generic model, its plan outline pulled up through its height.
      const boundary = hull2(body.points); if (boundary.length < 3) { missed(T); continue; }
      const id = fresh("GM"), cls = T.replace(/^IFC/, "Ifc").replace(/BUILDINGELEMENTPROXY/, "BuildingElementProxy");
      ops.push({ op: "add", element: { id, type: "Generic", name: ifcName(e) || id, args: { boundary: boundary.map(p => [r1(p[0]), r1(p[1])]), level: lv ? { ref: lv.id } : null, baseOffset: r1(zLo - (lv ? lv.z : 0)), height: r1(Math.max(1, zHi - zLo)), ifcClass: cls } } });
      made("Generic model");
    }
  }
  //! Wall joins: IfcRelConnectsPathElements says two walls meet. Our centrelines are read off the
  //! geometry, so which of our ends is its ATSTART is not known; the end nearer the other wall is.
  //! The joins themselves are left to autojoin, which decides corner or T from the geometry.
  const joinEnds = new Map();
  const nearEnd = (w, o) => { const d = (p) => { const L = o.len || 1, t = Math.max(0, Math.min(1, ((p[0] - o.a[0]) * (o.b[0] - o.a[0]) + (p[1] - o.a[1]) * (o.b[1] - o.a[1])) / (L * L))); return Math.hypot(p[0] - (o.a[0] + (o.b[0] - o.a[0]) * t), p[1] - (o.a[1] + (o.b[1] - o.a[1]) * t)); }; return d(w.a) <= d(w.b) ? "start" : "end"; };
  let connections = 0;
  for (const rel of ofType(model, "IFCRELCONNECTSPATHELEMENTS")) {
    const A = wallOf.get((follow(model, rel.args[5]) || {}).id), B_ = wallOf.get((follow(model, rel.args[6]) || {}).id);
    if (!A || !B_) { missed("IFCRELCONNECTSPATHELEMENTS"); continue; }
    const kinds = [asText(rel.args[10], ""), asText(rel.args[9], "")];
    [[A, B_, kinds[0]], [B_, A, kinds[1]]].forEach(([w, o, k]) => { if (!/ATPATH/i.test(k)) { const end = nearEnd(w, o); joinEnds.set(w.id + ":" + end, { id: w.id, end }); } });
    connections++;
  }
  if (connections) { report.made["Wall join"] = connections; }
  // doors and windows: the opening that voids a wall, and the filler in it
  const hostOfOpening = new Map();
  for (const rel of ofType(model, "IFCRELVOIDSELEMENT")) { const w = follow(model, rel.args[4]), o = follow(model, rel.args[5]); if (w && o && wallOf.has(w.id)) hostOfOpening.set(o.id, w.id); }
  for (const rel of ofType(model, "IFCRELFILLSELEMENT")) {
    const o = follow(model, rel.args[4]), fill = follow(model, rel.args[5]); if (!o || !fill) continue;
    const host = wallOf.get(hostOfOpening.get(o.id)); if (!host) { missed(fill.type); continue; }
    const door = /DOOR/.test(fill.type);
    const hgt = asNumber(fill.args[8]) * scale, wid = asNumber(fill.args[9]) * scale;
    const ob = bodySolids(model, o, scale), x = ob.extrusions[0] || (ob.points.length ? { world: ob.points, depth: zRange(ob.points)[1] - zRange(ob.points)[0] } : null), fr = ob.frame;
    let centre = fr.o, bottom = fr.o[2], W = wid, H = hgt;
    if (x && x.world) { const xs = x.world; centre = [xs.reduce((s, p) => s + p[0], 0) / xs.length, xs.reduce((s, p) => s + p[1], 0) / xs.length, 0]; bottom = Math.min(...xs.map(p => p[2])); if (!W) { const bx = orientedBox(xs.map(p => [p[0], p[1]])); W = bx ? bx.length : 900; } if (!H) H = x.depth; }
    const d = [(host.b[0] - host.a[0]) / host.len, (host.b[1] - host.a[1]) / host.len];
    const u = (centre[0] - host.a[0]) * d[0] + (centre[1] - host.a[1]) * d[1];
    W = r1(W || 900); H = r1(H || 2100);
    const typeId = typeFor(`${door ? "door" : "win"}:${W}x${H}`, () => door ? { family: "F-SINGLEDOOR", name: `IFC door ${W}×${H}`, mark: "D", width: W, height: H, leafThickness: 44, frame: 40 } : { family: "F-CASEMENT", name: `IFC window ${W}×${H}`, mark: "W", width: W, height: H, frame: 60, mullions: W > 1600 ? 1 : 0 });
    const opId = fresh("OP"), fid = fresh(door ? "D" : "WN");
    ops.push({ op: "add", element: { id: opId, type: "Opening", args: { host: { ref: host.id }, profile: { kind: "rect", at: r1(u), sill: r1(Math.max(0, bottom - host.z0)), w: W, h: H }, farProfile: null, depth: "through" } } });
    ops.push({ op: "add", element: door ? { id: fid, type: "Door", name: ifcName(fill) || fid, args: { fills: { ref: opId }, doorType: { ref: typeId } } } : { id: fid, type: "Window", name: ifcName(fill) || fid, args: { fills: { ref: opId }, windowType: { ref: typeId } } } });
    made(door ? "Door" : "Window");
  }
  const typeOps = [...newTypes.entries()].map(([id, value]) => ({ op: "type", lib: "types", id, value }));
  if (joinEnds.size) ops.push({ op: "autojoin", ends: [...joinEnds.values()] });
  return { ops: typeOps.concat(ops), report, types: newTypes.size };
}
