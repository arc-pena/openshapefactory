//! IFC classes read as Web BIM classes.
//!
//! The modeller's IFC package brings a building in as geometry nodes. This
//! brings it in as the building: an IfcWall becomes a Wall with a centreline
//! and a type whose thickness is the wall's, an IfcSlab a Floor (a wall laid
//! flat), an IfcColumn a Column, an IfcBeam a Beam (a profile swept along a
//! line), an IfcDoor or IfcWindow an Opening in its host wall with its filler,
//! an IfcBuildingStorey a Level. Types are matched by size or created. What is
//! not mapped is counted by class in the report, never dropped silently.

import { readIfc, ifcScale, ofType, follow, followAll, asText, asNumber, isRef, pointingAt, ifcWorldFrame, ifcBodyItems, ifcProfile,
  ifcPlacementFrame, ifcCompose, ifcAt, ifcDirection, ifcName } from "./ifcread.js";

const WALLS = new Set(["IFCWALL", "IFCWALLSTANDARDCASE", "IFCWALLELEMENTEDCASE", "IFCCURTAINWALL"]);
const SLABS = new Set(["IFCSLAB", "IFCSLABSTANDARDCASE", "IFCSLABELEMENTEDCASE", "IFCROOF", "IFCCOVERING"]);
const COLUMNS = new Set(["IFCCOLUMN", "IFCCOLUMNSTANDARDCASE", "IFCMEMBER"]);
const BEAMS = new Set(["IFCBEAM", "IFCBEAMSTANDARDCASE"]);
const FILLERS = new Set(["IFCDOOR", "IFCDOORSTANDARDCASE", "IFCWINDOW", "IFCWINDOWSTANDARDCASE"]);
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
/** One extruded body in world coordinates: its footprint (for vertical extrusions), height range, and the frame. */
function extrusion(model, entity, scale) {
  const frame = ifcWorldFrame(model, entity.args[5], scale);
  for (const item of ifcBodyItems(model, entity)) {
    if (item.type !== "IFCEXTRUDEDAREASOLID") continue;
    const a = item.args, place = ifcCompose(frame, ifcPlacementFrame(model, a[1], scale));
    const profile = ifcProfile(model, a[0], scale), local = profilePoints(profile);
    const dl = ifcDirection(model, a[2], [0, 0, 1]), depth = asNumber(a[3]) * scale;
    const dw = [place.x[0] * dl[0] + place.y[0] * dl[1] + place.z[0] * dl[2], place.x[1] * dl[0] + place.y[1] * dl[1] + place.z[1] * dl[2], place.x[2] * dl[0] + place.y[2] * dl[1] + place.z[2] * dl[2]];
    const world = local ? local.map(p => ifcAt(place, [p[0], p[1], 0])) : null;
    return { frame, place, profile, local, world, dir: dw, depth };
  }
  return null;
}

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
  const storeyOf = new Map();
  for (const rel of ofType(model, "IFCRELCONTAINEDINSPATIALSTRUCTURE")) {
    const st = follow(model, rel.args[5]); if (!st) continue;
    for (const e of followAll(model, rel.args[4])) storeyOf.set(e.id, st.id);
  }
  const fallback = levels.slice().sort((a, b) => a.z - b.z)[0] || null;
  const levelFor = e => levelOf.get(storeyOf.get(e.id)) || fallback;
  const wallOf = new Map();                                  // IFC wall id → { id, a, b, z0, len }
  const products = model.entities ? [...model.entities.values()] : [];
  for (const e of products) {
    const T = e.type;
    if (WALLS.has(T)) {
      const x = extrusion(model, e, scale);
      if (!x || !x.world || Math.abs(x.dir[2]) < 0.9) { missed(T); continue; }
      const box = orientedBox(x.world.map(p => [p[0], p[1]])); if (!box) { missed(T); continue; }
      const lv = levelFor(e), z0 = Math.min(...x.world.map(p => p[2])), h = x.depth * Math.abs(x.dir[2]);
      const t = r1(box.width), a = [box.centre[0] - box.dir[0] * box.length / 2, box.centre[1] - box.dir[1] * box.length / 2], b = [box.centre[0] + box.dir[0] * box.length / 2, box.centre[1] + box.dir[1] * box.length / 2];
      const typeId = typeFor("wall:" + t, () => ({ family: "F-BASICWALL", name: `IFC wall ${t}`, mark: "IW", layers: [{ function: "Structure", thickness: t, material: "M-BLOCK" }], coreStart: 0, coreEnd: 1 }));
      const id = fresh("W");
      ops.push({ op: "add", element: { id, type: "Wall", name: ifcName(e) || id, args: { centreline: { type: "line", start: a.map(r1), end: b.map(r1) }, mounting: "Centred", wallType: { ref: typeId }, baseLevel: lv ? { ref: lv.id } : null, baseOffset: r1(z0 - (lv ? lv.z : 0)), height: r1(h) } } });
      wallOf.set(e.id, { id, a, b, z0, len: box.length }); made("Wall");
    } else if (SLABS.has(T)) {
      const x = extrusion(model, e, scale);
      if (!x || !x.world || Math.abs(x.dir[2]) < 0.9) { missed(T); continue; }
      const lv = levelFor(e), zs = x.world.map(p => p[2]), zb = Math.min(...zs), top = x.dir[2] > 0 ? zb + x.depth : zb, thick = r1(x.depth);
      const typeId = typeFor("slab:" + thick, () => ({ family: "F-FLOOR", name: `IFC slab ${thick}`, mark: "FL", layers: [{ function: "Structure", thickness: thick, material: "M-CONC" }], coreStart: 0, coreEnd: 1 }));
      const id = fresh("FL");
      ops.push({ op: "add", element: { id, type: "Floor", name: ifcName(e) || id, args: { boundary: x.world.map(p => [r1(p[0]), r1(p[1])]), floorType: { ref: typeId }, level: lv ? { ref: lv.id } : null, heightOffset: r1(top - (lv ? lv.z : 0)) } } });
      made(T === "IFCROOF" ? "Floor (roof)" : "Floor");
    } else if (COLUMNS.has(T) || BEAMS.has(T)) {
      const x = extrusion(model, e, scale); if (!x || !x.profile) { missed(T); continue; }
      const lv = levelFor(e);
      const v = x.profile.values || {}, round = x.profile.kind === "circle";
      const W = r1(round ? v.radius * 2 : x.profile.kind === "section" ? v.width : v.width || 200), D = r1(round ? v.radius * 2 : x.profile.kind === "section" ? v.depth : v.height || 200);
      const vertical = Math.abs(x.dir[2]) > 0.9;
      if (vertical && !BEAMS.has(T)) {
        const c = ifcAt(x.place, [x.profile.at ? x.profile.at[0] : 0, x.profile.at ? x.profile.at[1] : 0, 0]);
        const typeId = typeFor(`col:${W}x${D}:${round}`, () => ({ family: "F-RCCOLUMN", name: round ? `IFC Ø${W}` : `IFC ${W}×${D}`, mark: "C", width: W, depth: D, round, material: "M-CONC" }));
        const id = fresh("C");
        ops.push({ op: "add", element: { id, type: "Column", name: ifcName(e) || id, args: { position: [r1(c[0]), r1(c[1])], columnType: { ref: typeId }, baseLevel: lv ? { ref: lv.id } : null, height: r1(x.depth), rotation: r1(Math.atan2(x.place.x[1], x.place.x[0]) * 180 / Math.PI) } } });
        made("Column");
      } else if (!vertical) {
        // a beam: the profile's centre swept along the extrusion direction
        const c0 = ifcAt(x.place, [x.profile.at ? x.profile.at[0] : 0, x.profile.at ? x.profile.at[1] : 0, 0]);
        const c1 = [c0[0] + x.dir[0] * x.depth, c0[1] + x.dir[1] * x.depth, c0[2] + x.dir[2] * x.depth];
        const I = x.profile.kind === "section" && /^I/.test(x.profile.sectionKind || "");
        const typeId = typeFor(`beam:${W}x${D}:${I}`, () => I ? { family: "F-STEELBEAM", name: `IFC I ${D}×${W}`, mark: "B", shape: "I", width: W, depth: D, flange: r1(v.flange || 12), web: r1(v.web || 8), material: "M-STEEL" } : { family: "F-RCBEAM", name: `IFC ${W}×${D}`, mark: "B", shape: "rect", width: W, depth: D, material: "M-CONC" });
        const id = fresh("B"), top = Math.max(c0[2], c1[2]) + D / 2;
        if (Math.abs(c1[2] - c0[2]) > 1) report.notes.push(`${id}: a sloping beam comes in level, at its higher end`);
        ops.push({ op: "add", element: { id, type: "Beam", name: ifcName(e) || id, args: { axis: { type: "line", start: [r1(c0[0]), r1(c0[1])], end: [r1(c1[0]), r1(c1[1])] }, beamType: { ref: typeId }, level: lv ? { ref: lv.id } : null, topOffset: r1(top - (lv ? lv.z : 0)) } } });
        made("Beam");
      } else missed(T);
    } else if (!FILLERS.has(T) && /^IFC/.test(T) && e.args && e.args.length > 6 && isRef(e.args[5]) && isRef(e.args[6]) && !IGNORED.has(T)) missed(T);
  }
  // doors and windows: the opening that voids a wall, and the filler in it
  const hostOfOpening = new Map();
  for (const rel of ofType(model, "IFCRELVOIDSELEMENT")) { const w = follow(model, rel.args[4]), o = follow(model, rel.args[5]); if (w && o && wallOf.has(w.id)) hostOfOpening.set(o.id, w.id); }
  for (const rel of ofType(model, "IFCRELFILLSELEMENT")) {
    const o = follow(model, rel.args[4]), fill = follow(model, rel.args[5]); if (!o || !fill) continue;
    const host = wallOf.get(hostOfOpening.get(o.id)); if (!host) { missed(fill.type); continue; }
    const door = /DOOR/.test(fill.type);
    const hgt = asNumber(fill.args[8]) * scale, wid = asNumber(fill.args[9]) * scale;
    const x = extrusion(model, o, scale), fr = ifcWorldFrame(model, o.args[5], scale);
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
  return { ops: typeOps.concat(ops), report, types: newTypes.size };
}
