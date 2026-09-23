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
  ifcPlacementFrame, ifcCompose, ifcAt, ifcDirection, ifcName, ifcPoint, ifcTransformScale, ifcProfileElements } from "./ifcread.js";
import { triangulate } from "./geom2d.js";
import { bridgeHoles } from "./bimsketch.js";
import { weldTriangles, clipMeshPlane, frameMesh, packMesh } from "./massing.js";
import { genericCategory } from "./styles.js";

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
  frame.o = [frame.o[0], frame.o[1], frame.o[2] - ((model.zShift && model.zShift.get(entity.id)) || 0)];
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
// ---------------------------------------------------------------- bodies as meshes
//! What a drawing cannot take as a wall, a slab or a beam still has a shape, and that shape is kept:
//! every body item tessellated into one welded mesh. A shape a file repeats (Revit writes each family
//! type once, as an IfcRepresentationMap, and places it hundreds of times) is tessellated once and
//! shared: the element keeps only the frame that places it.
const TAU_ = 2 * Math.PI;
/** A run of profile elements (lines, arcs, circles) as one chain of points, each element turned to
 *  follow on from the last. */
function runPoints(run, seg = 12) {
  const out = [];
  for (const el of run || []) {
    let pts;
    if (el.type === "line") pts = [el.a, el.b];
    else if (el.type === "circle" || (el.c && el.r && el.a0 === undefined)) { pts = []; const n = Math.max(12, seg * 2); for (let i = 0; i < n; i++) pts.push([el.c[0] + el.r * Math.cos(i / n * TAU_), el.c[1] + el.r * Math.sin(i / n * TAU_)]); }
    else if (el.c && el.r) { let sw = ((el.a1 - el.a0) % TAU_ + TAU_) % TAU_; if (sw < 1e-9) sw = TAU_; const n = Math.max(2, Math.ceil(sw / (TAU_ / 24))); pts = []; for (let i = 0; i <= n; i++) { const a = el.a0 + sw * i / n; pts.push([el.c[0] + el.r * Math.cos(a), el.c[1] + el.r * Math.sin(a)]); } }
    else if (el.rx && el.ry && el.c) { pts = []; const n = 24, r = el.rot || 0; for (let i = 0; i < n; i++) { const a = i / n * TAU_, x = el.rx * Math.cos(a), y = el.ry * Math.sin(a); pts.push([el.c[0] + x * Math.cos(r) - y * Math.sin(r), el.c[1] + x * Math.sin(r) + y * Math.cos(r)]); } }
    else if (el.a && el.b) pts = [el.a, el.b];
    else continue;
    if (out.length) { const L = out[out.length - 1], d0 = Math.hypot(pts[0][0] - L[0], pts[0][1] - L[1]), d1 = Math.hypot(pts[pts.length - 1][0] - L[0], pts[pts.length - 1][1] - L[1]); if (d1 < d0) pts = pts.slice().reverse(); if (Math.min(d0, d1) < 1e-6) pts = pts.slice(1); }
    out.push(...pts);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out;
}
const areaOf = pts => { let A = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; A += a[0] * b[1] - b[0] * a[1]; } return A / 2; };
/** A flat polygon (outer ring, holes) as triangles, in its own 2D coordinates: [[p, q, r] …] of points. */
function flatTriangles(outer, holes) {
  const o = areaOf(outer) < 0 ? outer.slice().reverse() : outer;
  const hs = (holes || []).filter(hh => hh.length >= 3).map(hh => areaOf(hh) > 0 ? hh.slice().reverse() : hh);
  const poly = hs.length ? bridgeHoles(o, hs) : o;
  return triangulate(poly).map(([a, b, c]) => [poly[a], poly[b], poly[c]]);
}
/** A planar 3D face (outer loop, inner loops) as triangles: projected on its own plane, triangulated, lifted back. */
function faceTriangles(outer3, inner3, push) {
  if (outer3.length < 3) return;
  const n = [0, 0, 0];
  for (let i = 0; i < outer3.length; i++) { const a = outer3[i], b = outer3[(i + 1) % outer3.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); }
  const L = Math.hypot(...n); if (L < 1e-12) return;
  const z = n.map(v => v / L), x0 = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const xa = [x0[1] * z[2] - x0[2] * z[1], x0[2] * z[0] - x0[0] * z[2], x0[0] * z[1] - x0[1] * z[0]], xl = Math.hypot(...xa), x = xa.map(v => v / xl);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const lift = new Map(), to2 = p => { const q = [p[0] * x[0] + p[1] * x[1] + p[2] * x[2], p[0] * y[0] + p[1] * y[1] + p[2] * y[2]]; lift.set(q, p); return q; };
  if (outer3.length === 3 && !(inner3 || []).length) { push(outer3[0], outer3[1], outer3[2]); return; }
  const o2 = outer3.map(to2), h2 = (inner3 || []).map(r => r.map(to2));
  // the outer ring counter-clockwise seen along the face normal: then the triangles face out too
  for (const [a, b, c] of flatTriangles(o2, h2)) push(lift.get(a), lift.get(b), lift.get(c));
}
/** A 3D curve as points: polylines, indexed poly curves, composite and trimmed curves (their basis's points). */
function curvePoints3(model, value, scale, depth = 0) {
  const e = follow(model, value); if (!e || depth > 12) return [];
  if (e.type === "IFCPOLYLINE") return followAll(model, e.args[0]).map(p => ifcPoint(model, { ref: p.id }, scale));
  if (e.type === "IFCINDEXEDPOLYCURVE") { const h = follow(model, e.args[0]); return h ? asList(h.args[0]).map(q => { const l = asList(q).map(n => asNumber(n) * scale); return [l[0] || 0, l[1] || 0, l[2] || 0]; }) : []; }
  if (e.type === "IFCCOMPOSITECURVE") { const out = []; for (const sg of followAll(model, e.args[0])) { const pts = curvePoints3(model, sg.args[2], scale, depth + 1); if (out.length && pts.length && Math.hypot(...[0, 1, 2].map(k => pts[0][k] - out[out.length - 1][k])) > Math.hypot(...[0, 1, 2].map(k => pts[pts.length - 1][k] - out[out.length - 1][k]))) pts.reverse(); out.push(...pts); } return out; }
  if (e.type === "IFCTRIMMEDCURVE") return curvePoints3(model, e.args[0], scale, depth + 1);
  return [];
}
/** Everything that makes a mesh, in the coordinates of `fr` (item-local → shape space). */
function meshItems(model, items, fr, scale, notes) {
  const tri = [];
  const push = (a, b, c) => tri.push(...ifcAt(fr, a), ...ifcAt(fr, b), ...ifcAt(fr, c));
  const sub = (item, f2) => { const m = meshItems(model, [item], f2, scale, notes); for (let i = 0; i < m.length; i++) tri.push(m[i]); };
  for (const item of items) {
    if (!item) continue;
    const a = item.args || [];
    switch (item.type) {
      case "IFCEXTRUDEDAREASOLID": case "IFCEXTRUDEDAREASOLIDTAPERED": {
        const place = ifcPlacementFrame(model, a[1], scale), profile = ifcProfile(model, a[0], scale); if (!profile) { notes.add("a profile this reader does not know"); break; }
        const els = ifcProfileElements(profile), outer = runPoints(els.outer), holes = (els.inner || []).map(r => runPoints(r)).filter(r => r.length >= 3);
        if (outer.length < 3) break;
        const d = ifcDirection(model, a[2], [0, 0, 1]), depth = asNumber(a[3]) * scale, dv = [d[0] * depth, d[1] * depth, d[2] * depth];
        const P0 = p => ifcAt(place, [p[0], p[1], 0]), P1 = p => ifcAt(place, [p[0] + dv[0], p[1] + dv[1], dv[2]]);
        const up = dv[2] >= 0;
        for (const [p, q, r] of flatTriangles(outer, holes)) { if (up) { push(P0(p), P0(r), P0(q)); push(P1(p), P1(q), P1(r)); } else { push(P0(p), P0(q), P0(r)); push(P1(p), P1(r), P1(q)); } }
        const ringSides = (ring, flip) => { const cw = (areaOf(ring) < 0) !== flip !== !up; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; if (cw) { push(P0(p), P1(q), P0(q)); push(P0(p), P1(p), P1(q)); } else { push(P0(p), P0(q), P1(q)); push(P0(p), P1(q), P1(p)); } } };
        ringSides(outer, false); for (const hh of holes) ringSides(hh, true);
        if (item.type === "IFCEXTRUDEDAREASOLIDTAPERED") notes.add("tapered extrusions come in with their start profile");
        break;
      }
      case "IFCREVOLVEDAREASOLID": {
        const place = ifcPlacementFrame(model, a[1], scale), profile = ifcProfile(model, a[0], scale), ax = follow(model, a[2]); if (!profile || !ax) break;
        const ring = runPoints(ifcProfileElements(profile).outer); if (ring.length < 2) break;
        const o = ifcPoint(model, ax.args[0], scale), dz = ifcDirection(model, ax.args[1], [0, 1, 0]);
        let ang = asNumber(a[3]); if (ang > TAU_ + 0.01) ang = ang * Math.PI / 180;
        const n = Math.max(3, Math.ceil(ang / (TAU_ / 24))), rot = (p, t) => { // Rodrigues about the axis through o along dz, in the profile's plane (z = 0)
          const v = [p[0] - o[0], p[1] - o[1], 0 - (o[2] || 0)], k = dz, c = Math.cos(t), sn = Math.sin(t), kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
          const cr = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
          return ifcAt(place, [0, 1, 2].map(i => (o[i] || 0) + v[i] * c + cr[i] * sn + k[i] * kv * (1 - c))); };
        for (let s = 0; s < n; s++) for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length], t0 = ang * s / n, t1 = ang * (s + 1) / n; push(rot(p, t0), rot(q, t0), rot(q, t1)); push(rot(p, t0), rot(q, t1), rot(p, t1)); }
        break;
      }
      case "IFCMAPPEDITEM": {
        const src = follow(model, a[0]), rep = src && follow(model, src.args[1]); if (!rep) break;
        const k = ifcTransformScale(model, a[1]), t = ifcPlacementFrame(model, a[1], scale), sc = f => ({ o: f.o, x: f.x.map(v => v * k), y: f.y.map(v => v * k), z: f.z.map(v => v * k) });
        const f2 = ifcCompose(sc(t), ifcPlacementFrame(model, src.args[0], scale));
        for (const it of followAll(model, rep.args[3])) sub(it, f2);
        break;
      }
      case "IFCBOOLEANRESULT": case "IFCBOOLEANCLIPPINGRESULT": {
        const op = asText(a[0], "").replace(/\./g, "").toUpperCase(), first = follow(model, a[1]), second = follow(model, a[2]);
        const m1 = meshItems(model, [first], { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, scale, notes);
        let mesh = weldTriangles(m1, 0.05);
        if (op === "DIFFERENCE" && second && /HALFSPACESOLID/.test(second.type)) {
          const surf = follow(model, second.args[0]), pl = surf && ifcPlacementFrame(model, surf.args[0], scale), agree = /T/.test(asText(second.args[1], ".T."));
          if (pl) {
            // the solid half space lies against the normal when AgreementFlag is true; the difference keeps the other side
            const nrm = agree ? pl.z.map(v => -v) : pl.z, d = nrm[0] * pl.o[0] + nrm[1] * pl.o[1] + nrm[2] * pl.o[2];
            mesh = clipMeshPlane(mesh, nrm, d);
            if (second.type === "IFCPOLYGONALBOUNDEDHALFSPACE") notes.add("bounded half-space cuts are applied as unbounded planes");
          }
        } else if (op === "UNION" && second) { const m2 = weldTriangles(meshItems(model, [second], { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, scale, notes), 0.05); const off = mesh.positions.length / 3; mesh = { positions: mesh.positions.concat(m2.positions), index: mesh.index.concat(m2.index.map(i => i + off)) }; }
        else if (second) notes.add("solid-by-solid boolean cuts are shown uncut");
        for (let i = 0; i < mesh.index.length; i += 3) push(...[0, 1, 2].map(e => { const k = mesh.index[i + e] * 3; return [mesh.positions[k], mesh.positions[k + 1], mesh.positions[k + 2]]; }));
        break;
      }
      case "IFCCSGSOLID": sub(follow(model, a[0]), { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }); break;
      case "IFCFACETEDBREP": case "IFCFACETEDBREPWITHVOIDS": case "IFCADVANCEDBREP": case "IFCADVANCEDBREPWITHVOIDS":
        facesOf(model, followAll(model, (follow(model, a[0]) || { args: [] }).args[0]), scale, push, notes); break;
      case "IFCSHELLBASEDSURFACEMODEL": for (const sh of followAll(model, a[0])) facesOf(model, followAll(model, sh.args[0]), scale, push, notes); break;
      case "IFCFACEBASEDSURFACEMODEL": for (const cf of followAll(model, a[0])) facesOf(model, followAll(model, cf.args[0]), scale, push, notes); break;
      case "IFCCLOSEDSHELL": case "IFCOPENSHELL": facesOf(model, followAll(model, a[0]), scale, push, notes); break;
      case "IFCTRIANGULATEDFACESET": case "IFCTRIANGULATEDIRREGULARNETWORK": {
        const C = coordList(model, a[0], scale), idx = asList(a[3]).map(t => asList(t).map(n => Math.round(asNumber(n)))), pn = a[4] ? asList(a[4]).map(n => Math.round(asNumber(n))) : null;
        const at = i => C[(pn ? pn[i - 1] : i) - 1];
        for (const t of idx) { const [p, q, r] = t.map(at); if (p && q && r) push(p, q, r); }
        break;
      }
      case "IFCPOLYGONALFACESET": {
        const C = coordList(model, a[0], scale), pn = a[3] ? asList(a[3]).map(n => Math.round(asNumber(n))) : null, at = i => C[(pn ? pn[i - 1] : Math.round(i)) - 1];
        for (const fc of followAll(model, a[2])) {
          const outer = asList(fc.args[0]).map(n => at(asNumber(n))).filter(Boolean);
          const inner = fc.type === "IFCINDEXEDPOLYGONALFACEWITHVOIDS" ? asList(fc.args[1]).map(r => asList(r).map(n => at(asNumber(n))).filter(Boolean)) : [];
          faceTriangles(outer, inner, push);
        }
        break;
      }
      case "IFCSWEPTDISKSOLID": case "IFCSWEPTDISKSOLIDPOLYGONAL": {
        const path = curvePoints3(model, a[0], scale).filter((p, i, arr) => !i || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1], p[2] - arr[i - 1][2]) > 1e-6);
        const r = asNumber(a[1]) * scale; if (path.length < 2 || !(r > 0)) { notes.add("swept disks whose path this reader cannot follow"); break; }
        tube(path, r, push); break;
      }
      case "IFCBLOCK": { const pl = ifcPlacementFrame(model, a[0], scale), [dx, dy, dz] = [1, 2, 3].map(i => asNumber(a[i]) * scale); box(pl, [0, 0, 0], [dx, dy, dz], push); break; }
      case "IFCRIGHTCIRCULARCYLINDER": { const pl = ifcPlacementFrame(model, a[0], scale), h = asNumber(a[1]) * scale, r = asNumber(a[2]) * scale, ring = []; for (let i = 0; i < 24; i++) ring.push([r * Math.cos(i / 24 * TAU_), r * Math.sin(i / 24 * TAU_)]);
        for (const [p, q, t] of flatTriangles(ring, [])) { push(ifcAt(pl, [p[0], p[1], 0]), ifcAt(pl, [t[0], t[1], 0]), ifcAt(pl, [q[0], q[1], 0])); push(ifcAt(pl, [p[0], p[1], h]), ifcAt(pl, [q[0], q[1], h]), ifcAt(pl, [t[0], t[1], h])); }
        for (let i = 0; i < 24; i++) { const p = ring[i], q = ring[(i + 1) % 24]; push(ifcAt(pl, [p[0], p[1], 0]), ifcAt(pl, [q[0], q[1], 0]), ifcAt(pl, [q[0], q[1], h])); push(ifcAt(pl, [p[0], p[1], 0]), ifcAt(pl, [q[0], q[1], h]), ifcAt(pl, [p[0], p[1], h])); }
        break; }
      default: notes.add(`${item.type.replace(/^IFC/, "Ifc").toLowerCase()} bodies (not read)`);
    }
  }
  return tri;
}
function coordList(model, value, scale) { const h = follow(model, value); return h ? asList(h.args[0]).map(q => { const l = asList(q).map(n => asNumber(n) * scale); return [l[0] || 0, l[1] || 0, l[2] || 0]; }) : []; }
/** Faces of a shell: each face's outer bound and its inner bounds (poly loops, or edge loops read by their vertices). */
function facesOf(model, faces, scale, push, notes) {
  const loopPts = lp => {
    if (!lp) return [];
    if (lp.type === "IFCPOLYLOOP") return followAll(model, lp.args[0]).map(p => ifcPoint(model, { ref: p.id }, scale));
    if (lp.type === "IFCEDGELOOP") { notes.add("curved edges of advanced breps come in as chords"); return followAll(model, lp.args[0]).map(oe => { const edge = follow(model, oe.args[2]), fwd = !/F/.test(asText(oe.args[3], ".T.")); const v = follow(model, fwd ? edge.args[0] : edge.args[1]); return v ? ifcPoint(model, v.args[0], scale) : null; }).filter(Boolean); }
    return [];
  };
  for (const fc of faces) {
    const bounds = followAll(model, fc.args[0]); if (!bounds.length) continue;
    const ob = bounds.find(b => b.type === "IFCFACEOUTERBOUND") || bounds[0];
    const orient = b => { const pts = loopPts(follow(model, b.args[0])); return /F/.test(asText(b.args[1], ".T.")) ? pts.reverse() : pts; };
    faceTriangles(orient(ob), bounds.filter(b => b !== ob).map(orient), push);
  }
}
/** A round bar along a path (a railing's handrail): eight sides, the frame carried along the path. */
function tube(path, r, push) {
  const N = 8; let prevN = null; const rings = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)], t0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], tl = Math.hypot(...t0) || 1, t = t0.map(v => v / tl);
    let n = prevN ? prevN.slice() : (Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
    const k = n[0] * t[0] + n[1] * t[1] + n[2] * t[2]; n = [n[0] - k * t[0], n[1] - k * t[1], n[2] - k * t[2]]; const nl = Math.hypot(...n) || 1; n = n.map(v => v / nl); prevN = n;
    const bn = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
    const ring = []; for (let j = 0; j < N; j++) { const c = Math.cos(j / N * TAU_) * r, s = Math.sin(j / N * TAU_) * r; ring.push([0, 1, 2].map(q => path[i][q] + n[q] * c + bn[q] * s)); }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j < N; j++) { const A = rings[i][j], B = rings[i][(j + 1) % N], C = rings[i + 1][(j + 1) % N], D = rings[i + 1][j]; push(A, B, C); push(A, C, D); }
  for (const [ring, rev] of [[rings[0], true], [rings[rings.length - 1], false]]) for (let j = 1; j + 1 < N; j++) rev ? push(ring[0], ring[j + 1], ring[j]) : push(ring[0], ring[j], ring[j + 1]);
}
function box(pl, a, b, push) {
  const P = (x, y, z) => ifcAt(pl, [x ? b[0] : a[0], y ? b[1] : a[1], z ? b[2] : a[2]]);
  const q = (p1, p2, p3, p4) => { push(p1, p2, p3); push(p1, p3, p4); };
  q(P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0)); q(P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1));
  q(P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)); q(P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1));
  q(P(1, 1, 0), P(0, 1, 0), P(0, 1, 1), P(1, 1, 1)); q(P(0, 1, 0), P(0, 0, 0), P(0, 0, 1), P(0, 1, 1));
}
const ID3 = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
/** An element's body as a shape and the frame that places it. A body that is one mapped item is keyed
 *  by its representation map (and scale) so every instance shares one mesh; anything else is its own. */
export function elementShape(model, e, scale) {
  const world = ifcWorldFrame(model, e.args[5], scale), items = ifcBodyItems(model, e), notes = new Set();
  world.o = [world.o[0], world.o[1], world.o[2] - ((model.zShift && model.zShift.get(e.id)) || 0)];
  if (!items.length) return null;
  if (items.length === 1 && items[0].type === "IFCMAPPEDITEM") {
    const a = items[0].args, src = follow(model, a[0]), rep = src && follow(model, src.args[1]);
    if (rep) {
      const k = ifcTransformScale(model, a[1]), frame = ifcCompose(world, ifcCompose(ifcPlacementFrame(model, a[1], scale), ifcPlacementFrame(model, src.args[0], scale)));
      const key = `map${src.id}${k !== 1 ? "x" + k : ""}`;
      return { key, frame, build: () => { const t = meshItems(model, followAll(model, rep.args[3]), { o: [0, 0, 0], x: [k, 0, 0], y: [0, k, 0], z: [0, 0, k] }, scale, notes); return t.length ? weldTriangles(t, 0.05) : null; }, notes };
    }
  }
  return { key: `el${e.id}`, frame: world, build: () => { const t = meshItems(model, items, ID3, scale, notes); return t.length ? weldTriangles(t, 0.05) : null; }, notes };
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

//! What each kind of mesh-bodied element is counted as, and drawn in.
const MESH_KIND = { IfcStair: ["Stair", "M-CONC"], IfcRamp: ["Ramp", "M-CONC"], IfcRailing: ["Railing", "M-STEEL"], IfcPlate: ["Curtain panel", "M-GLASS"], Furniture: ["Furniture item", "M-TIMBER"],
  IfcFlowTerminal: ["Fixture", "M-TILE"], IfcTransportElement: ["Lift or escalator", "M-STEEL"], IfcWall: ["Wall (exact shape)", "M-BLOCK"], IfcSlab: ["Floor (exact shape)", "M-CONC"],
  IfcBeam: ["Beam (exact shape)", "M-STEEL"], IfcColumn: ["Column (exact shape)", "M-CONC"] };
/** @param opts.everything bring in every other product with a body (stairs, railings, plates, furniture, fixtures…) with its own shape
 *  @param opts.exact walls, slabs and members that are not one plain extrusion (clipped, sloped, breps) keep their exact shape */
export function importIfc(doc, text, { everything = true, exact = true } = {}) {
  const model = readIfc(text), scale = ifcScale(model);
  const report = { made: {}, missed: {}, notes: [] };
  const made = k => { report.made[k] = (report.made[k] || 0) + 1; };
  report.why = {};
  //! Every element kept out says why, once per class and reason: "1 × IFCSLAB" alone is not something anybody can act on.
  const missed = (k, why) => { report.missed[k] = (report.missed[k] || 0) + 1; if (why) { const w = (report.why[k] = report.why[k] || {}); w[why] = (w[why] || 0) + 1; } };
  const noteOnce = new Set(), note = (key, text) => { if (!noteOnce.has(key)) { noteOnce.add(key); report.notes.push(text); } };
  const ops = [], taken = new Set(doc.elements().map(f => doc.idOf(f)));
  const fresh = prefix => { let n = 1; while (taken.has(prefix + n)) n++; taken.add(prefix + n); return prefix + n; };
  const newTypes = new Map();
  const typeFor = (key, make) => {
    const found = Object.entries(doc.lib.types).find(([, t]) => t.ifcKey === key) || [...newTypes.entries()].find(([, t]) => t.ifcKey === key);
    if (found) return found[0];
    let n = 1; while (doc.lib.types["T-IFC" + n] || newTypes.has("T-IFC" + n)) n++;
    const id = "T-IFC" + n; newTypes.set(id, Object.assign(make(), { ifcKey: key })); return id;
  };
  // storeys → levels, matched by elevation. A storey's height is where the file's geometry puts it: its
  // placement, when that carries a height (elements are placed relative to it); its Elevation attribute
  // when the placement sits at zero (elements then carry absolute heights).
  const levelOf = new Map(), storeyZ = new Map();
  const levels = doc.elements().filter(f => doc.typeOf(f) === "Level").map(f => ({ id: doc.idOf(f), z: Number(doc.argValue(f, "elevation")) || (doc.data(f) || {}).value || 0 }));
  for (const st of ofType(model, "IFCBUILDINGSTOREY")) {
    const zAttr = asNumber(st.args[9]) * scale, zWorld = ifcWorldFrame(model, st.args[5], scale).o[2];
    const z = Math.abs(zWorld - zAttr) < 1 || Math.abs(zWorld) < 1 || !isFinite(zWorld) ? zAttr : zWorld;
    if (Math.abs(zWorld - zAttr) >= 1 && Math.abs(zWorld) >= 1) note("storeyz", "storey heights are taken from their placements, where these differ from the storeys' Elevation attributes (the elements are placed relative to them)");
    storeyZ.set(st.id, z);
    const name = ifcName(st) || "Storey";
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
  //! Parts of an assembly (a stair's flights, a curtain wall's panels and mullions, a railing's pieces)
  //! are not contained in a storey themselves: they take their assembly's.
  const parentOf = new Map();
  for (const rel of ofType(model, "IFCRELAGGREGATES")) { const whole = follow(model, rel.args[4]); if (whole) for (const part of followAll(model, rel.args[5])) parentOf.set(part.id, whole.id); }
  const storeyFor = id => { for (let k = 0, x = id; k < 12 && x; k++, x = parentOf.get(x)) if (storeyOf.has(x)) return storeyOf.get(x); return null; };
  //! A storey height counted twice: elements placed relative to a storey placement that carries the
  //! height, with the height written into their own placement again. Seen as every element of a storey
  //! sitting at twice its height; corrected per storey, and said.
  model.zShift = new Map();
  const byStorey = new Map();
  for (const e of model.entities ? model.entities.values() : []) {
    if (!e.args || /^IFCREL/.test(e.type) || !isRef(e.args[6]) || e.type === "IFCBUILDINGSTOREY") continue;
    const st = storeyFor(e.id); if (!st) continue;
    if (!byStorey.has(st)) byStorey.set(st, []);
    byStorey.get(st).push(e);
  }
  for (const [st, els] of byStorey) {
    const E = storeyZ.get(st) || 0; if (Math.abs(E) < 500 || els.length < 3) continue;
    const zs = els.map(e => ifcWorldFrame(model, e.args[5], scale).o[2]).sort((a, b) => a - b), med = zs[Math.floor(zs.length / 2)];
    if (Math.abs(med - 2 * E) < Math.max(50, Math.abs(E) * 0.02)) {
      for (const e of els) model.zShift.set(e.id, E);
      note("doublez", "some storeys' elements carried their storey's height twice (in their own placement as well as the storey's): brought down onto their levels");
    }
  }
  // what a shifted element voids and what fills it come down with it
  for (const rel of ofType(model, "IFCRELVOIDSELEMENT")) { const w = follow(model, rel.args[4]), o = follow(model, rel.args[5]); if (w && o && model.zShift.has(w.id)) model.zShift.set(o.id, model.zShift.get(w.id)); }
  for (const rel of ofType(model, "IFCRELFILLSELEMENT")) { const o = follow(model, rel.args[4]), fl = follow(model, rel.args[5]); if (o && fl && model.zShift.has(o.id) && !model.zShift.has(fl.id)) model.zShift.set(fl.id, model.zShift.get(o.id)); }
  //! An element's level: its storey (or its assembly's); with none, the level at or below its base, as
  //! Revit hosts a free element - never the lowest level with the whole height put into its offset.
  const sortedLv = () => levels.slice().sort((a, b) => a.z - b.z);
  const levelAt = z => { const L = sortedLv(); let best = L[0] || null; for (const l of L) if (l.z <= z + 1) best = l; return best; };
  const levelFor = (e, zBase = null) => levelOf.get(storeyFor(e.id)) || (zBase != null && isFinite(zBase) ? levelAt(zBase) : sortedLv()[0] || null);
  const wallOf = new Map();                                  // IFC wall id → { id, a, b, z0, len }
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
  //! A body kept as it is: tessellated once per shape, placed by its frame, filed by its class.
  const shapes = new Map(), meshWalls = new Set(), locals = new Map();
  const cls = T => T.replace(/^IFC/, "Ifc").toLowerCase().replace(/^ifc(.)/, (_, c) => "Ifc" + c.toUpperCase());
  const IFC_CLASS = T => { const known = { IFCSTAIRFLIGHT: "IfcStairFlight", IFCSTAIR: "IfcStair", IFCRAMPFLIGHT: "IfcRampFlight", IFCRAMP: "IfcRamp", IFCRAILING: "IfcRailing", IFCPLATE: "IfcPlate", IFCFURNISHINGELEMENT: "IfcFurnishingElement", IFCFURNITURE: "IfcFurniture", IFCFLOWTERMINAL: "IfcFlowTerminal", IFCSANITARYTERMINAL: "IfcSanitaryTerminal", IFCTRANSPORTELEMENT: "IfcTransportElement", IFCWALL: "IfcWall", IFCWALLSTANDARDCASE: "IfcWall", IFCCURTAINWALL: "IfcCurtainWall", IFCSLAB: "IfcSlab", IFCROOF: "IfcRoof", IFCCOVERING: "IfcCovering", IFCFOOTING: "IfcFooting", IFCBEAM: "IfcBeam", IFCMEMBER: "IfcMember", IFCCOLUMN: "IfcColumn", IFCBUILDINGELEMENTPROXY: "IfcBuildingElementProxy", IFCDOOR: "IfcDoor", IFCWINDOW: "IfcWindow" }; return known[T] || cls(T); };
  const addMesh = (e, T, lv) => {
    const sh = elementShape(model, e, scale); if (!sh) return false;
    let shapeId = shapes.get(sh.key);
    if (shapeId === undefined) {
      let local = null; try { local = sh.build(); } catch (err) { local = null; }
      for (const n of sh.notes) note("mesh:" + n, n);
      if (!local || !local.index.length) { shapes.set(sh.key, null); return false; }
      let n = locals.size + 1; while (doc.lib.meshes && doc.lib.meshes["MS-" + n] || locals.has("MS-" + n)) n++;
      shapeId = "MS-" + n; shapes.set(sh.key, shapeId); locals.set(shapeId, local); ops.push({ op: "type", lib: "meshes", id: shapeId, value: packMesh(local) });
    }
    if (!shapeId) return false;
    const local = locals.get(shapeId), world = frameMesh(local, sh.frame);
    const zs = []; for (let i = 2; i < world.positions.length; i += 3) zs.push(world.positions[i]);
    const zLo = Math.min(...zs), zHi = Math.max(...zs), xy = []; for (let i = 0; i < world.positions.length; i += 3) xy.push([world.positions[i], world.positions[i + 1]]);
    const boundary = hull2(xy); if (boundary.length < 3) return false;
    lv = levelOf.get(storeyFor(e.id)) || levelAt(zLo) || lv;
    const ic = IFC_CLASS(T), cat = genericCategory(ic), [label, material] = MESH_KIND[cat] || ["Generic models (exact shape)", "M-CONC"];
    const r6 = v => Math.round(v * 1e6) / 1e6, fr = { o: [r1(sh.frame.o[0]), r1(sh.frame.o[1]), r1(sh.frame.o[2] - zLo)], x: sh.frame.x.map(r6), y: sh.frame.y.map(r6), z: sh.frame.z.map(r6) };
    const id = fresh("GM");
    ops.push({ op: "add", element: { id, type: "Generic", name: ifcName(e) || id, args: { boundary: boundary.map(p => [r1(p[0]), r1(p[1])]), level: lv ? { ref: lv.id } : null, baseOffset: r1(zLo - (lv ? lv.z : 0)), height: r1(Math.max(1, zHi - zLo)), ifcClass: ic, material, colour: "", mesh: { shape: shapeId, frame: fr } } } });
    made(label); return true;
  };
  //! "Exact" for a wall, slab or member: a body that is not one plain extrusion (or is clipped) keeps its shape.
  //! A wall with openings stays a wall (its doors and windows need a host); the clipped top is noted instead.
  const voided = new Set(ofType(model, "IFCRELVOIDSELEMENT").map(rel => (follow(model, rel.args[4]) || {}).id));
  const plainUpright = body => body.extrusions.length === 1 && body.solids.length === 1 && Math.abs(body.extrusions[0].dir[2]) > 0.9 && !body.clipped;
  for (const e of products) {
    const T = e.type;
    if (/^IFCREL/.test(T) || !e.args || !isRef(e.args[6])) continue;
    const isWall = WALLS.has(T), isSlab = SLABS.has(T) || T === "IFCFOOTING", isCol = COLUMNS.has(T), isBeam = BEAMS.has(T), isProxy = PROXIES.has(T);
    if (!(isWall || isSlab || isCol || isBeam || isProxy)) {
      if (!FILLERS.has(T) && /^IFC/.test(T) && e.args.length > 6 && isRef(e.args[5]) && !IGNORED.has(T)) {
        if (everything && ifcBodyItems(model, e).length && addMesh(e, T, levelFor(e))) continue;
        missed(T, everything ? (ifcBodyItems(model, e).length ? "its body could not be tessellated" : "no Body representation") : "not brought in (Import everything else is off)");
      }
      continue;
    }
    const body = bodySolids(model, e, scale), lv = levelFor(e, body.points.length ? zRange(body.points)[0] : null);
    // a proxy is always its own shape; a wall, slab or member that is not a plain upright extrusion keeps its shape when asked
    if (isProxy && addMesh(e, T, lv)) continue;
    if (exact && body.points.length) {
      const single = body.extrusions.length === 1 && body.solids.length === 1, dz = single ? Math.abs(body.extrusions[0].dir[2]) : 0;
      // a wall or slab is exact unless it is one plain upright extrusion (a wall with openings stays a wall, to host them);
      // a member is exact when it is not one extrusion, is clipped, or slopes (neither level nor upright)
      const want = (isWall || isSlab) ? !plainUpright(body) && !(isWall && voided.has(e.id)) : (!single || body.clipped || (dz > 0.02 && dz < 0.98));
      if (want && addMesh(e, T, lv)) { if (isWall) meshWalls.add(e.id); continue; }
    }
    if (!body.points.length) {
      const reps = (follow(model, e.args[6]) || { args: [] }).args[2], kinds = followAll(model, reps).map(r => asText(r.args[1], "?") + "/" + asText(r.args[2], "?"));
      const items = ifcBodyItems(model, e).map(i => i.type);
      missed(T, items.length ? `its body (${[...new Set(items)].join(", ")}) has no points this reader understands` : `no Body representation${kinds.length ? " (it has " + kinds.join(", ") + ")" : ""}`);
      continue;
    }
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
      if (!addFlat(e, T, body, lv)) missed(T, "its outline has less than three distinct corners in plan (a vertical or degenerate slab)");
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
    if (!A || !B_) { const ids = [(follow(model, rel.args[5]) || {}).id, (follow(model, rel.args[6]) || {}).id]; if (!ids.some(x => meshWalls.has(x))) missed("IFCRELCONNECTSPATHELEMENTS", "a wall it joins was not brought in as a wall"); continue; }
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
    const host = wallOf.get(hostOfOpening.get(o.id));
    if (!host) { if (!(everything && addMesh(fill, fill.type, levelFor(fill)))) missed(fill.type, "its host is not a wall here"); continue; }
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
  // the meshes go first (an element reads its shape as it builds), without their working copies
  const meshOps = ops.filter(o => o.lib === "meshes"), rest = ops.filter(o => o.lib !== "meshes");
  const nShapes = meshOps.length, nMeshEls = rest.filter(o => o.element && o.element.args && o.element.args.mesh).length;
  if (nShapes) report.notes.unshift(`${nMeshEls} elements keep their own shape, from ${nShapes} distinct shape${nShapes === 1 ? "" : "s"} (repeated family types are stored once)`);
  return { ops: meshOps.concat(typeOps, rest), report, types: newTypes.size, shapes: nShapes };
}
