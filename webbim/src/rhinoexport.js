//! Provide Python: the project as a Python script for Rhino (7 or 8) that builds the same model there and keeps it
//! in step. The script carries the whole project as data; run it in a file once and it makes everything; run a newer
//! one in the same file and it changes only what changed:
//!
//!   layers      NAME › Levels › <level> › Slabs, Walls, Cells, Plane; Levels › Datums; Levels › Clipping planes;
//!               Vertical Transport, Structure, MEP, Voids (the cores by discipline); Mesh; Site; Sheets.
//!               Each layer carries a key, so a level renamed or moved renames its layers.
//!   objects     every slab, wall and core as a solid; the mesh's cells, and the cells each level uses at its
//!               height; a plane on each level the size of the site (to project curves onto); the site boundary;
//!               level datums (lines, heads, text) in each section's plane and along the south of the site.
//!               Each object carries the element's id (wb_id) and a hash of what it was made from (wb_hash): an
//!               unchanged one is left alone, a changed one is replaced in place (a slab moved up a level moves up
//!               and onto that level's layer; renamed, it is renamed), one the project no longer has is deleted.
//!   sheets      a layout per sheet at its paper size, the title block and view titles drawn in page space, a detail
//!               per placed view at the view's scale, centred on what the view shows.
//!   clipping    a clipping plane per plan, 1 m (the plan's cut height) above its floor and clipping only that plan's
//!               details; a section's plane along its line (and one at its far depth) clipping only its details. In
//!               each detail the other clipping planes' layers, the level planes and the other levels' cells are off.

import { F } from "./ocaf.js";
import { levelsByElevation, CORE_DISCIPLINE, cellShape, cellPolys } from "./meshgrid.js";
import { elementParts } from "./solids.js";
import { deriveView, sheetScene, viewLineGeometry } from "./scene.js";
import { sheetSize } from "./bim.js";

const RH_DISCIPLINES = ["Vertical Transport", "Structure", "MEP", "Voids"];
const RH_COLOURS = { slabs: "#8a8f99", walls: "#4a6f8a", cells: "#e0a020", plane: "#cfd8e3", datums: "#d0312d", clips: "#9aa0a6", mesh: "#e0262b", site: "#b3261e", sheets: "#000000",
  "Vertical Transport": "#3f7cc4", Structure: "#7d838b", MEP: "#d9822b", Voids: "#62b7d0" };
const rhRound = v => Math.round(v * 10) / 10;
/** A colour as #rrggbb (#333 spelled out; anything else black). */
const rhHex = c => { const s = String(c || ""); if (/^#[0-9a-f]{6}/i.test(s)) return s.slice(0, 7).toLowerCase(); const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s); return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase() : "#000000"; };
const rhPt = p => p.map(rhRound);
/** FNV-1a over a string, as 8 hex digits: what an object was made from, to tell a changed one from an unchanged one. */
export function rhHash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }
/** The project's name in Rhino: its first words, capitals (Nexus — layout reality check → NEXUS). */
export function rhinoRootName(doc) { return (String(doc.meta.name || "WEB BIM").split(/\s[—–-]\s/)[0].trim() || "WEB BIM").toUpperCase().replace(/[:\\/]+/g, " "); }
const rhElev = z => `${z > 0 ? "+" : z < 0 ? "-" : "±"}${(Math.abs(z) / 1000).toFixed(3)}`;

/** A path's segments as runs of points (paper or model): arcs and curves sampled, a jump starts a new run. */
export function rhPathRuns(path) {
  const runs = []; let cur = null, last = null;
  const near = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  for (const s of path || []) {
    let pts;
    if (s.k === "L") pts = [s.a, s.b];
    else if (s.k === "A") { const n = Math.max(6, Math.ceil(Math.abs(s.a1 - s.a0) / (Math.PI / 16))); pts = Array.from({ length: n + 1 }, (_, i) => { const t = s.a0 + (s.a1 - s.a0) * i / n; return [s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)]; }); }
    else { pts = Array.from({ length: 13 }, (_, i) => { const t = i / 12, u = 1 - t; return [0, 1].map(k => u * u * u * s.a[k] + 3 * u * u * t * s.c1[k] + 3 * u * t * t * s.c2[k] + t * t * t * s.b[k]); }); }
    if (!cur || !near(last, pts[0])) { cur = [pts[0]]; runs.push(cur); }
    for (let i = 1; i < pts.length; i++) cur.push(pts[i]);
    last = pts[pts.length - 1];
  }
  return runs.filter(r => r.length > 1);
}

/** Everything the script carries: layers, objects, clipping planes, sheets. Model mm, paper mm. */
export function rhinoPayload(doc) {
  doc.regenerate();
  const root = rhinoRootName(doc), proj = root.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "webbim";
  const lvs = levelsByElevation(doc), lvById = new Map(lvs.map(l => [l.id, l]));
  const layers = [], objects = [], clips = [], sheets = [];
  const layer = (key, parent, name, colour) => { layers.push({ key, parent, name, colour: colour || "#000000" }); return key; };
  const els = doc.elements(), typed = t => els.filter(f => doc.typeOf(f) === t && f.get("Integer") !== 0 && !doc.error(f));
  // ---- the layers
  layer("root", null, root);
  layer("levels", "root", "Levels");
  const lvName = l => `${l.name} ${rhElev(l.z)}`;
  for (const l of lvs) { layer(`lv:${l.id}`, "levels", lvName(l)); for (const k of ["Slabs", "Walls", "Cells", "Plane"]) layer(`lv:${l.id}:${k.toLowerCase()}`, `lv:${l.id}`, k, RH_COLOURS[k.toLowerCase()]); }
  layer("datums", "levels", "Datums", RH_COLOURS.datums);
  layer("clips", "levels", "Clipping planes", RH_COLOURS.clips);
  for (const d of RH_DISCIPLINES) layer(`disc:${d}`, "root", d, RH_COLOURS[d]);
  layer("mesh", "root", "Mesh", RH_COLOURS.mesh);
  layer("site", "root", "Site", RH_COLOURS.site);
  layer("sheets", "root", "Sheets", RH_COLOURS.sheets);
  const levelOf = (id, z) => (id && lvById.has(id) ? id : (lvs.slice().reverse().find(l => l.z <= z + 1) || lvs[0] || {}).id);
  const obj = (o) => { o.h = rhHash(JSON.stringify([o.kind, o.layer, o.name, o.geom, o.user || {}])); objects.push(o); };
  // ---- the extent of the site: the level planes, the clipping planes' size
  const sb = typed("SiteBoundary")[0], sbp = sb && doc.plan(sb);
  const ext = [Infinity, Infinity, -Infinity, -Infinity], grow = p => { ext[0] = Math.min(ext[0], p[0]); ext[1] = Math.min(ext[1], p[1]); ext[2] = Math.max(ext[2], p[0]); ext[3] = Math.max(ext[3], p[1]); };
  if (sbp && sbp.pts) sbp.pts.forEach(grow);
  for (const f of typed("Floor")) (doc.plan(f).foot || []).forEach(grow);
  if (!Number.isFinite(ext[0])) { ext[0] = ext[1] = 0; ext[2] = ext[3] = 100000; }
  const M = 50000, box = [ext[0] - M, ext[1] - M, ext[2] + M, ext[3] + M].map(Math.round), big = Math.max(box[2] - box[0], box[3] - box[1]);
  // ---- slabs, walls, cores
  for (const f of typed("Floor")) {
    const p = doc.plan(f), lid = levelOf(F.refId(f, "level"), p.z1), d = doc.data(f) || {};
    obj({ id: doc.idOf(f), kind: "solid", layer: `lv:${lid}:slabs`, name: f.get("Name"), geom: { pieces: p.regions.map(rg => ({ outer: rg.outer.map(rhPt), holes: rg.holes.map(h => h.map(rhPt)), z0: rhRound(p.z0), z1: rhRound(p.z1) })) },
      user: { type: "Floor", level: lid, area_m2: String(Math.round((d.value || 0) / 1e4) / 100), slab_type: F.refId(f, "floorType") || "" } });
  }
  for (const f of typed("Wall")) {
    const parts = elementParts(doc, f); if (!parts.length) continue;
    const lid = levelOf(F.refId(f, "baseLevel"), parts[0].z0);
    obj({ id: doc.idOf(f), kind: "solid", layer: `lv:${lid}:walls`, name: f.get("Name"), geom: { pieces: parts.map(pc => ({ outer: pc.foot.map(rhPt), holes: (pc.holes || []).map(h => h.map(rhPt)), z0: rhRound(pc.z0), z1: rhRound(pc.z1) })) },
      user: { type: "Wall", level: lid, wall_type: F.refId(f, "wallType") || "" } });
  }
  for (const f of typed("Core")) {
    const p = doc.plan(f);
    obj({ id: doc.idOf(f), kind: "solid", layer: `disc:${CORE_DISCIPLINE[p.use] || "Vertical Transport"}`, name: f.get("Name"), geom: { pieces: [{ outer: p.foot.map(rhPt), holes: [], z0: rhRound(p.z0), z1: rhRound(p.z1) }] },
      user: { type: "Core", use: p.use, base: F.refId(f, "baseLevel") || "", top: F.refId(f, "topLevel") || "", cars: String(p.cars || "") } });
  }
  for (const f of typed("Column")) {
    const p = doc.plan(f); if (!p || !p.foot || !p.foot.length) continue;
    obj({ id: doc.idOf(f), kind: "solid", layer: "disc:Structure", name: f.get("Name"), geom: { pieces: [{ outer: p.foot.map(rhPt), holes: [], z0: rhRound(p.z0), z1: rhRound(p.z1) }] }, user: { type: "Column" } });
  }
  // ---- the mesh: its cells at the ground, and the cells each level uses at that level's height
  for (const f of typed("MeshGrid")) {
    const id = doc.idOf(f), N = F.json(f, "nodes") || {}, C = F.json(f, "cells") || {}, U = F.json(f, "use") || {}, P = cellPolys(N, C);
    for (const [cid, pts] of Object.entries(P)) obj({ id: `${id}:${cid}`, kind: "curve", layer: "mesh", name: cid, geom: { pts: pts.map(q => [...rhPt(q), 0]), closed: true }, user: { type: "MeshCell", mesh: id } });
    for (const [lid, use] of Object.entries(U)) {
      const l = lvById.get(lid); if (!l) continue;
      for (const [cid, u] of Object.entries(use || {})) { if (!P[cid]) continue; obj({ id: `${id}:${lid}:${cid}`, kind: "curve", layer: `lv:${lid}:cells`, name: `${lid} ${cid}${Array.isArray(u) ? " (part)" : ""}`, geom: { pts: cellShape(P[cid], u).map(q => [...rhPt(q), rhRound(l.z)]), closed: true }, user: { type: "UsedCell", mesh: id, level: lid, scale: Array.isArray(u) ? String(u[0]) : "1" } }); }
    }
  }
  // ---- a plane on each level, the size of the site: the level's bounding plane, to project curves onto
  for (const l of lvs) obj({ id: `plane:${l.id}`, kind: "plane", layer: `lv:${l.id}:plane`, name: `${l.name} plane ${rhElev(l.z)}`, geom: { x0: box[0], y0: box[1], x1: box[2], y1: box[3], z: rhRound(l.z) }, user: { type: "LevelPlane", level: l.id } });
  if (sbp && sbp.pts) {
    obj({ id: doc.idOf(sb), kind: "curve", layer: "site", name: "Site boundary", geom: { pts: sbp.pts.map(q => [...rhPt(q), 0]), closed: true }, user: { type: "SiteBoundary" } });
    if (sbp.buildable && sbp.buildable.length > 2 && (sbp.setbacks || []).some(x => x > 0)) obj({ id: `${doc.idOf(sb)}:setback`, kind: "curve", layer: "site", name: "Setback line", geom: { pts: sbp.buildable.map(q => [...rhPt(q), 0]), closed: true }, user: { type: "Setback" } });
  }
  // ---- level datums: a line, a head and the name and height of each level, in a vertical plane
  const datumSet = (key, name, a, b, shift) => {
    // a, b: the ends in plan, left to right as the datums are read; shift: the plane moved off the cut
    layer(key, "datums", name, RH_COLOURS.datums);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const R = 2500, at = (p, s, z) => [rhRound(p[0] + u[0] * s + shift[0]), rhRound(p[1] + u[1] * s + shift[1]), rhRound(z)];
    for (const l of lvs) {
      obj({ id: `datum:${key}:${l.id}:line`, kind: "curve", layer: key, name: `${l.name} ${rhElev(l.z)}`, geom: { pts: [at(a, 0, l.z), at(a, len, l.z)], closed: false }, user: { type: "Datum", level: l.id } });
      obj({ id: `datum:${key}:${l.id}:head`, kind: "circle", layer: key, name: `${l.name} head`, geom: { c: at(a, len + R * 1.6, l.z), x: [u[0], u[1], 0], y: [0, 0, 1], r: R }, user: { type: "Datum", level: l.id } });
      obj({ id: `datum:${key}:${l.id}:text`, kind: "text", layer: key, name: `${l.name} text`, geom: { at: at(a, len + R * 3.6, l.z - 900), x: [u[0], u[1], 0], y: [0, 0, 1], h: 1800, text: `${l.name}  ${rhElev(l.z)}`, align: "left" }, user: { type: "Datum", level: l.id } });
    }
  };
  datumSet("datums:general", "Levels (south of the site)", [box[0], box[1] + 20000], [box[2] - 20000, box[1] + 20000], [0, 0]);
  // ---- the views' clipping planes, and the sections' datums
  const clipOf = (view, key, name, origin, x, y, du, dv) => clips.push({ id: key, view, layer: `clip:${view}`, name, origin: origin.map(rhRound), x, y, du: Math.round(du), dv: Math.round(dv) });
  for (const v of typed("PlanView")) {
    const vid = doc.idOf(v), lid = F.refId(v, "level"), l = lid && lvById.get(lid); if (!l) continue;
    const vr = Object.assign({ top: 2300, cut: 1200, bottom: 0 }, doc.argValue(v, "viewRange") || {}), depth = vr.depth ?? vr.bottom;
    const c = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    layer(`clip:${vid}`, "clips", `${v.get("Name")} cut ${rhElev(l.z + vr.cut)}`, RH_COLOURS.clips);
    // the cut: normal up, hiding what is above it (the arrow points at what is hidden)
    clipOf(vid, `clip:${vid}`, `${v.get("Name")} cut ${rhElev(l.z + vr.cut)}`, [c[0], c[1], l.z + vr.cut], [1, 0, 0], [0, 1, 0], big * 0.75, big * 0.75);
    // a plan that sees nothing below its own floor: a second plane under the slab, hiding what is below
    if (depth > -1000) clipOf(vid, `clip:${vid}:bottom`, `${v.get("Name")} bottom ${rhElev(l.z + depth - 600)}`, [c[0], c[1], l.z + depth - 600], [1, 0, 0], [0, -1, 0], big * 0.75, big * 0.75);
  }
  for (const v of [...typed("SectionView"), ...typed("ElevationView")]) {
    const vid = doc.idOf(v), G = viewLineGeometry(doc, v), sec = doc.typeOf(v) === "SectionView";
    const H = Math.max(1, G.topZ - G.Z0), mid = [(G.c.start[0] + G.c.end[0]) / 2, (G.c.start[1] + G.c.end[1]) / 2];
    // datums in the view's plane, 50 behind the cut (inside what the section shows), heads on the right as seen
    datumSet(`datums:${vid}`, v.get("Name"), G.c.end, G.c.start, [G.look[0] * 50, G.look[1] * 50]);
    if (!sec) continue;
    layer(`clip:${vid}`, "clips", v.get("Name"), RH_COLOURS.clips);
    // the cut: along the line, its normal toward the viewer (hiding the near side); the far plane at the view's depth
    clipOf(vid, `clip:${vid}`, `${v.get("Name")} cut`, [mid[0], mid[1], G.Z0 + H / 2], [-G.line[0], -G.line[1], 0], [0, 0, 1], G.Lv * 0.75 + 20000, H);
    if (G.depthMax > 0) clipOf(vid, `clip:${vid}:far`, `${v.get("Name")} far`, [mid[0] + G.look[0] * G.depthMax, mid[1] + G.look[1] * G.depthMax, G.Z0 + H / 2], [G.line[0], G.line[1], 0], [0, 0, 1], G.Lv * 0.75 + 20000, H);
  }
  // ---- sheets
  const keys = layers.map(l => l.key), planes = keys.filter(k => /^lv:.*:plane$/.test(k)), cellsK = keys.filter(k => /^lv:.*:cells$/.test(k)), clipK = keys.filter(k => k.startsWith("clip:")), datK = keys.filter(k => k.startsWith("datums:"));
  for (const sh of typed("Sheet")) {
    const sc = sheetScene(doc, sh), [W, Hh] = sheetSize(sh), prims = [], details = [];
    const addPrim = p => {
      if (p.t === "stroke") for (const run of rhPathRuns(p.path)) prims.push({ t: "pl", pts: run.map(rhPt), w: rhRound(p.weight || 0.18), c: rhHex(p.colour) });
      else if (p.t === "text" && String(p.text).trim()) prims.push({ t: "tx", at: rhPt(p.at), text: String(p.text), h: rhRound(p.height), align: p.align || "left", rot: p.rot || 0, c: rhHex(p.colour) });
    };
    const flat = ps => { for (const p of ps) { if (p.t === "group") flat(p.prims || []); else addPrim(p); } };
    for (const p of sc.prims) {
      if (p.t !== "group") { if (p.layer !== "Paper" && p.layer !== "Viewport") addPrim(p); continue; }
      const v = doc.element(p.view), t = v && doc.typeOf(v);
      if (!v || !["PlanView", "SectionView", "ElevationView", "View3D"].includes(t)) { flat(p.prims || []); continue; }
      const vp = (doc.argValue(sh, "viewports") || []).find(x => x.id === p.vp) || {}, vs = deriveView(doc, v), bb = vs.clip || vs.bbox, S = F.int(v, "scale") || 100;
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, off = [(vp.at || [0, 0])[0] - cx, (vp.at || [0, 0])[1] - cy];
      const rect = [bb[0] + off[0], bb[1] + off[1], bb[2] + off[0], bb[3] + off[1]].map(rhRound), vid = doc.idOf(v), d = { id: `${doc.idOf(sh)}:${p.vp}`, view: vid, title: v.get("Name"), rect, scale: S };
      if (t === "PlanView") {
        const lid = F.refId(v, "level"), l = lvById.get(lid) || { z: 0 };
        Object.assign(d, { kind: "plan", target: [rhRound(cx * S), rhRound(cy * S), rhRound(l.z)], dir: [0, 0, -1], up: [0, 1, 0], clips: clips.filter(c => c.view === vid).map(c => c.id),
          hide: [...planes, "mesh", ...clipK.filter(k => k !== `clip:${vid}`), ...cellsK.filter(k => k !== `lv:${lid}:cells`), ...datK] });
      } else if (t === "View3D") {
        const cam = doc.argValue(v, "camera") || {}, az = (cam.azimuth ?? 225) * Math.PI / 180, el = (cam.elevation ?? 30) * Math.PI / 180, tg = cam.target || [0, 0, 0];
        Object.assign(d, { kind: "3d", target: tg.map(rhRound), dir: [-Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), -Math.sin(el)].map(x => +x.toFixed(6)), up: [0, 0, 1], clips: [], hide: [...planes, "mesh", ...clipK, ...cellsK, ...datK] });
      } else {
        const G = viewLineGeometry(doc, v), s = cx * S, z = cy * S + G.Z0, q = [G.o[0] + G.d[0] * s, G.o[1] + G.d[1] * s];
        Object.assign(d, { kind: "section", target: [rhRound(q[0]), rhRound(q[1]), rhRound(z)], dir: [+G.look[0].toFixed(6), +G.look[1].toFixed(6), 0], up: [0, 0, 1], clips: clips.filter(c => c.view === vid).map(c => c.id),
          hide: [...planes, "mesh", ...clipK.filter(k => k !== `clip:${vid}`), ...cellsK, ...datK.filter(k => k !== `datums:${vid}`)] });
      }
      details.push(d);
    }
    sheets.push({ id: doc.idOf(sh), number: doc.argValue(sh, "number") || "", name: `${doc.argValue(sh, "number") || ""} ${doc.argValue(sh, "sheetName") || sh.get("Name")}`.trim(), size: [W, Hh], prims, details });
  }
  const stats = { levels: lvs.length, slabs: typed("Floor").length, walls: typed("Wall").length, cores: typed("Core").length, objects: objects.length, clips: clips.length, sheets: sheets.length, details: sheets.reduce((s, x) => s + x.details.length, 0), layers: layers.length };
  return { format: "webbim-rhino", version: 1, project: proj, root, name: doc.meta.name || "", exported: new Date().toISOString(), units: "mm", layers, objects, clips, sheets, stats };
}

/** Bytes deflated with a zlib header (what Python's zlib.decompress reads), or null where the browser has no
 *  CompressionStream. */
async function rhDeflate(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  const cs = new CompressionStream("deflate"), w = cs.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
export function rhBase64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }

/** The script's text from a payload and the payload's bytes as base64 (deflated, or not). */
export function rhinoScriptText(pl, b64, packed) {
  const lines = b64.match(/.{1,100}/g) || [], stamp = pl.exported.slice(0, 16).replace("T", " ");
  const fill = { __TITLE__: `${pl.root}: ${pl.name}`.replace(/"/g, "'"), __STAMP__: stamp, __PROJECT__: pl.project, __PACKED__: packed ? "True" : "False",
    __STATS__: `${pl.stats.levels} levels, ${pl.stats.slabs} slabs, ${pl.stats.walls} walls, ${pl.stats.cores} cores, ${pl.stats.sheets} sheets (${pl.stats.details} details), ${pl.stats.clips} clipping planes` };
  // the payload last: it is long, and nothing in it is a placeholder
  return RH_TEMPLATE.replace(/__(TITLE|STAMP|PROJECT|PACKED|STATS)__/g, m => fill[m]).replace("__PAYLOAD__", lines.join("\n"));
}
/** The script: { text, filename, stats }. */
export async function rhinoScript(doc) {
  const pl = rhinoPayload(doc), raw = new TextEncoder().encode(JSON.stringify(pl)), z = await rhDeflate(raw);
  const text = rhinoScriptText(pl, rhBase64(z || raw), !!z);
  const safe = String(pl.root).replace(/[^A-Za-z0-9]+/g, "_");
  return { text, filename: `${safe}_rhino_${pl.exported.slice(0, 10).replace(/-/g, "")}.py`, stats: pl.stats, payload: pl, bytes: raw.length, packed: z ? z.length : raw.length };
}

const RH_TEMPLATE = String.raw`# -*- coding: utf-8 -*-
"""__TITLE__ - Web BIM to Rhino, exported __STAMP__.

__STATS__.

Run it in Rhino 7 or 8: RunPythonScript (or the Script Editor in Rhino 8), with the file you want it in open.
Run it again - this file or a newer export of the same project - and it brings the Rhino model in step:
  * what is new is added; what changed is replaced in place (a slab moved up a level moves up and onto that
    level's layer; renamed, it is renamed); what the project no longer has is deleted;
  * layers are found by key, so a level renamed or moved renames its layers;
  * the layouts are found again and their title blocks, details and clipping planes made again.
Objects carry their Web BIM id in the user text wb_id (Properties > Attribute User Text).
Only objects and layers this script made are touched (user text wb_project = __PROJECT__).
"""
from __future__ import print_function
import json, base64, zlib
import System
import Rhino
import scriptcontext as sc
from System.Collections.Generic import List
from System.Drawing import Color
from Rhino.Geometry import Point3d, Point2d, Vector3d, Plane, PolylineCurve, LineCurve, Curve, Brep, PlaneSurface, Interval, Circle, ArcCurve, TextEntity
from Rhino.DocObjects import ObjectAttributes, Layer, ActiveSpace, ObjectEnumeratorSettings, ObjectColorSource, ObjectPlotWeightSource

PROJECT = "__PROJECT__"
# The plan clipping planes point up (they hide what is above the cut) and the section planes toward the viewer.
# If your Rhino shows the opposite side, set these to True and run the script again.
FLIP_PLAN_CUTS = False
FLIP_SECTION_CUTS = False
DETAIL_DISPLAY = "Technical"      # display mode of the details on the layouts: Wireframe, Shaded, Technical, ...
PACKED = __PACKED__
PAYLOAD = """
__PAYLOAD__
"""

class Report(object):
    def __init__(self):
        self.n = {}
        self.notes = []
    def add(self, k, v=1):
        self.n[k] = self.n.get(k, 0) + v
    def note(self, s):
        self.notes.append(s)
    def text(self):
        order = ["layers added", "layers renamed", "objects added", "objects updated", "objects unchanged", "objects deleted", "layouts added", "layouts updated", "details", "clipping planes"]
        parts = ["{0} {1}".format(self.n[k], k) for k in order if self.n.get(k)]
        return "\n".join(["Web BIM to Rhino: " + (", ".join(parts) or "nothing to do")] + self.notes[:30])

def load():
    raw = base64.b64decode("".join(PAYLOAD.split()))
    if PACKED:
        raw = zlib.decompress(raw)
    if not isinstance(raw, str):
        raw = raw.decode("utf-8")
    elif hasattr(raw, "decode"):
        try:
            raw = raw.decode("utf-8")
        except Exception:
            pass
    return json.loads(raw)

def V(v):
    return Vector3d(float(v[0]), float(v[1]), float(v[2]))

def colour(h):
    h = (h or "#000000").lstrip("#")
    return Color.FromArgb(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

def tagged(doc, page=None):
    """The objects this script made: {wb_id: [RhinoObject]}."""
    s = ObjectEnumeratorSettings()
    s.HiddenObjects = True
    s.LockedObjects = True
    s.IncludeLights = False
    s.IncludeGrips = False
    if page is not None:
        s.ViewportFilter = page
    out = {}
    for o in doc.Objects.GetObjectList(s):
        a = o.Attributes
        if a.GetUserString("wb_project") != PROJECT:
            continue
        k = a.GetUserString("wb_id") or ""
        out.setdefault(k, []).append(o)
    return out

# ------------------------------------------------------------------ layers
def commit_layer(doc, L):
    try:
        if L.CommitChanges():
            return
    except Exception:
        pass
    doc.Layers.Modify(L, L.Index, True)

def sync_layers(doc, data, rep):
    have = {}
    for L in doc.Layers:
        if L.IsDeleted:
            continue
        if L.GetUserString("wb_project") == PROJECT and L.GetUserString("wb_key"):
            have[L.GetUserString("wb_key")] = L.Index
    idx = {}
    for spec in data["layers"]:
        key, name = spec["key"], spec["name"]
        pid = doc.Layers[idx[spec["parent"]]].Id if spec.get("parent") else System.Guid.Empty
        if key in have:
            i = have[key]
            L = doc.Layers[i]
            if L.Name != name or L.ParentLayerId != pid:
                L.Name = name
                L.ParentLayerId = pid
                doc.Layers.Modify(L, i, True)
                rep.add("layers renamed")
            idx[key] = i
            continue
        L = Layer()
        L.Name = name
        L.ParentLayerId = pid
        L.Color = colour(spec.get("colour"))
        L.SetUserString("wb_project", PROJECT)
        L.SetUserString("wb_key", key)
        i = doc.Layers.Add(L)
        if i < 0:
            # a layer of that name is already there (made by hand): it is taken over
            for M in doc.Layers:
                if not M.IsDeleted and M.Name == name and M.ParentLayerId == pid:
                    i = M.Index
                    M.SetUserString("wb_project", PROJECT)
                    M.SetUserString("wb_key", key)
                    doc.Layers.Modify(M, i, True)
                    break
        if i < 0:
            rep.note("could not make layer " + name)
            continue
        idx[key] = i
        rep.add("layers added")
    return idx

def drop_layers(doc, data, rep):
    keep = set(s["key"] for s in data["layers"])
    gone = []
    for L in doc.Layers:
        if not L.IsDeleted and L.GetUserString("wb_project") == PROJECT and L.GetUserString("wb_key") not in keep:
            gone.append(L.Index)
    for i in sorted(gone, reverse=True):
        try:
            doc.Layers.Delete(i, True)
        except Exception:
            pass

# ------------------------------------------------------------------ geometry
def points(pts, K, z=None):
    out = List[Point3d]()
    for p in pts:
        out.Add(Point3d(p[0] * K, p[1] * K, (p[2] if z is None else z) * K))
    return out

def ring_curve(ring, z, K):
    pts = points([[p[0], p[1]] for p in ring] + [[ring[0][0], ring[0][1]]], K, z)
    return PolylineCurve(pts)

def solid(g, K, tol):
    out = None
    for pc in g["pieces"]:
        z0, z1 = pc["z0"], pc["z1"]
        if z1 - z0 < 0.5 or len(pc["outer"]) < 3:
            continue
        crvs = List[Curve]()
        crvs.Add(ring_curve(pc["outer"], z0, K))
        for h in pc.get("holes") or []:
            if len(h) >= 3:
                crvs.Add(ring_curve(h, z0, K))
        faces = Brep.CreatePlanarBreps(crvs, tol)
        if not faces:
            continue
        path = LineCurve(Point3d(0.0, 0.0, z0 * K), Point3d(0.0, 0.0, z1 * K))
        for f in faces:
            b = None
            try:
                b = f.Faces[0].CreateExtrusion(path, True)
            except Exception:
                b = None
            if b is None:
                try:
                    b = Rhino.Geometry.Extrusion.Create(ring_curve(pc["outer"], z0, K), (z1 - z0) * K, True).ToBrep()
                except Exception:
                    b = None
            if b is None:
                continue
            if out is None:
                out = b
            else:
                out.Append(b)
    return out

def make(o, K, tol, doc):
    g, k = o["geom"], o["kind"]
    if k == "solid":
        return solid(g, K, tol)
    if k == "curve":
        pts = [list(p) for p in g["pts"]]
        if g.get("closed"):
            pts.append(pts[0])
        return PolylineCurve(points(pts, K))
    if k == "plane":
        pl = Plane(Point3d(0.0, 0.0, g["z"] * K), Vector3d(1.0, 0.0, 0.0), Vector3d(0.0, 1.0, 0.0))
        return PlaneSurface(pl, Interval(g["x0"] * K, g["x1"] * K), Interval(g["y0"] * K, g["y1"] * K))
    if k == "circle":
        c = g["c"]
        pl = Plane(Point3d(c[0] * K, c[1] * K, c[2] * K), V(g["x"]), V(g["y"]))
        return ArcCurve(Circle(pl, g["r"] * K))
    if k == "text":
        a = g["at"]
        pl = Plane(Point3d(a[0] * K, a[1] * K, a[2] * K), V(g["x"]), V(g["y"]))
        return text_entity(doc, g["text"], pl, g["h"] * K, g.get("align", "left"))
    return None

def text_entity(doc, s, plane, h, align):
    te = TextEntity.Create(s, plane, doc.DimStyles.Current, False, 0, 0)
    te.TextHeight = h
    try:
        te.TextHorizontalAlignment = {"centre": Rhino.DocObjects.TextHorizontalAlignment.Center, "right": Rhino.DocObjects.TextHorizontalAlignment.Right}.get(align, Rhino.DocObjects.TextHorizontalAlignment.Left)
        te.TextVerticalAlignment = Rhino.DocObjects.TextVerticalAlignment.Bottom
    except Exception:
        pass
    return te

def add_geom(doc, geom, attr):
    if isinstance(geom, Brep):
        return doc.Objects.AddBrep(geom, attr)
    if isinstance(geom, TextEntity):
        return doc.Objects.AddText(geom, attr)
    if isinstance(geom, PlaneSurface):
        return doc.Objects.AddSurface(geom, attr)
    return doc.Objects.AddCurve(geom, attr)

def stamp(attr, o, K):
    attr.SetUserString("wb_project", PROJECT)
    attr.SetUserString("wb_id", o["id"])
    attr.SetUserString("wb_kind", o.get("kind", ""))
    attr.SetUserString("wb_hash", "{0}@{1}".format(o.get("h", ""), K))
    for k, v in (o.get("user") or {}).items():
        attr.SetUserString("wb_" + k, str(v))

# ------------------------------------------------------------------ the model
def sync_objects(doc, data, layers, K, tol, rep):
    have = tagged(doc)
    seen = set()
    for o in data["objects"]:
        seen.add(o["id"])
        li = layers.get(o["layer"], layers.get("root", 0))
        old = [x for x in have.get(o["id"], []) if x.Attributes.Space == ActiveSpace.ModelSpace]
        want = "{0}@{1}".format(o.get("h", ""), K)
        if old and old[0].Attributes.GetUserString("wb_hash") == want and old[0].Attributes.LayerIndex == li:
            rep.add("objects unchanged")
            for extra in old[1:]:
                doc.Objects.Delete(extra, True)
            continue
        geom = make(o, K, tol, doc)
        if geom is None:
            rep.note("could not build " + o["id"])
            continue
        if old:
            keep = old[0]
            done = False
            if not isinstance(geom, TextEntity):
                try:
                    done = doc.Objects.Replace(keep.Id, geom)
                except Exception:
                    done = False
            if done:
                a = keep.Attributes.Duplicate()
                a.LayerIndex = li
                a.Name = o.get("name") or ""
                stamp(a, o, K)
                doc.Objects.ModifyAttributes(keep.Id, a, True)
            else:
                doc.Objects.Delete(keep, True)
                a = ObjectAttributes()
                a.LayerIndex = li
                a.Name = o.get("name") or ""
                stamp(a, o, K)
                add_geom(doc, geom, a)
            for extra in old[1:]:
                doc.Objects.Delete(extra, True)
            rep.add("objects updated")
            continue
        a = ObjectAttributes()
        a.LayerIndex = li
        a.Name = o.get("name") or ""
        stamp(a, o, K)
        if add_geom(doc, geom, a) == System.Guid.Empty:
            rep.note("could not add " + o["id"])
        else:
            rep.add("objects added")
    managed = ("solid", "curve", "plane", "circle", "text")
    for k, objs in have.items():
        if k in seen:
            continue
        for x in objs:
            if x.Attributes.Space == ActiveSpace.ModelSpace and x.Attributes.GetUserString("wb_kind") in managed:
                doc.Objects.Delete(x, True)
                rep.add("objects deleted")

# ------------------------------------------------------------------ layouts
def find_page(doc, sid):
    key = "wb:{0}:sheet:{1}".format(PROJECT, sid)
    vid = doc.Strings.GetValue(key)
    if vid:
        for pv in doc.Views.GetPageViews():
            if str(pv.MainViewport.Id) == vid:
                return pv
    return None

def page_attr(layers, pv, sid, extra=None):
    a = ObjectAttributes()
    a.LayerIndex = layers.get("sheets", 0)
    a.ViewportId = pv.MainViewport.Id
    a.Space = ActiveSpace.PageSpace
    a.SetUserString("wb_project", PROJECT)
    a.SetUserString("wb_id", "sheet:" + sid)
    a.SetUserString("wb_kind", "sheet")
    return a

def sync_sheets(doc, data, layers, K, KP, rep):
    details = {}
    for sh in data["sheets"]:
        W, H = sh["size"]
        pv = find_page(doc, sh["id"])
        if pv is None:
            pv = doc.Views.AddPageView(sh["name"], W * KP, H * KP)
            if pv is None:
                rep.note("could not make the layout " + sh["name"])
                continue
            doc.Strings.SetString("wb:{0}:sheet:{1}".format(PROJECT, sh["id"]), str(pv.MainViewport.Id))
            rep.add("layouts added")
        else:
            if pv.PageName != sh["name"]:
                pv.PageName = sh["name"]
            try:
                pv.PageWidth = W * KP
                pv.PageHeight = H * KP
            except Exception:
                pass
            # what an earlier run put on this layout goes; what was added by hand stays
            for k, objs in tagged(doc, pv.MainViewport.Id).items():
                for x in objs:
                    doc.Objects.Delete(x, True)
            rep.add("layouts updated")
        for pr in sh["prims"]:
            a = page_attr(layers, pv, sh["id"])
            if pr.get("c") and pr["c"].lower() not in ("#000000", "#000", "#1b1f24"):
                a.ObjectColor = colour(pr["c"])
                a.ColorSource = ObjectColorSource.ColorFromObject
            if pr["t"] == "pl":
                a.PlotWeight = pr.get("w", 0.18)
                a.PlotWeightSource = ObjectPlotWeightSource.PlotWeightFromObject
                doc.Objects.AddCurve(PolylineCurve(points([[p[0], p[1], 0] for p in pr["pts"]], KP)), a)
            elif pr["t"] == "tx":
                pl = Plane(Point3d(pr["at"][0] * KP, pr["at"][1] * KP, 0.0), Vector3d(1.0, 0.0, 0.0), Vector3d(0.0, 1.0, 0.0))
                if pr.get("rot"):
                    pl.Rotate(pr["rot"] * 3.141592653589793 / 180.0, Vector3d(0.0, 0.0, 1.0))
                doc.Objects.AddText(text_entity(doc, pr["text"], pl, pr["h"] * KP, pr.get("align", "left")), a)
        for d in sh["details"]:
            x0, y0, x1, y1 = [v * KP for v in d["rect"]]
            det = pv.AddDetailView(d["title"], Point2d(x0, y0), Point2d(x1, y1), Rhino.Display.DefinedViewportProjection.Top)
            if det is None:
                rep.note("could not place " + d["title"] + " on " + sh["name"])
                continue
            vp = det.Viewport
            T = Point3d(d["target"][0] * K, d["target"][1] * K, d["target"][2] * K)
            D = V(d["dir"])
            D.Unitize()
            vp.ChangeToParallelProjection(True)
            vp.SetCameraLocations(T, T - D * (1000000.0 * K))
            vp.CameraUp = V(d["up"])
            try:
                dm = Rhino.Display.DisplayModeDescription.FindByName(DETAIL_DISPLAY if d["kind"] != "3d" else "Shaded")
                if dm is not None:
                    vp.DisplayMode = dm
            except Exception:
                pass
            det.CommitViewportChanges()
            det.DetailGeometry.SetScale(float(d["scale"]), Rhino.UnitSystem.Millimeters, 1.0, Rhino.UnitSystem.Millimeters)
            det.DetailGeometry.IsProjectionLocked = True
            det.CommitChanges()
            a = det.Attributes.Duplicate()
            a.LayerIndex = layers.get("sheets", 0)
            a.Name = d["title"]
            a.SetUserString("wb_project", PROJECT)
            a.SetUserString("wb_id", "detail:" + d["id"])
            a.SetUserString("wb_kind", "detail")
            a.SetUserString("wb_view", d["view"])
            doc.Objects.ModifyAttributes(det.Id, a, True)
            details[d["id"]] = {"vp": det.Viewport.Id, "hide": d["hide"], "clips": d["clips"], "title": d["title"]}
            rep.add("details")
        try:
            pv.SetPageAsActive()
            pv.Redraw()
        except Exception:
            pass
    return details

# ------------------------------------------------------------------ clipping planes
def sync_clips(doc, data, layers, details, K, rep):
    for k, objs in tagged(doc).items():
        for x in objs:
            if x.Attributes.GetUserString("wb_kind") == "clip":
                doc.Objects.Delete(x, True)
    for c in data["clips"]:
        vps = List[System.Guid]()
        for d in details.values():
            if c["id"] in d["clips"]:
                vps.Add(d["vp"])
        x = V(c["x"])
        y = V(c["y"])
        section = abs(c["y"][2]) > 0.5
        if (FLIP_SECTION_CUTS if section else FLIP_PLAN_CUTS):
            y = -y if not section else y
            x = -x if section else x
        pl = Plane(Point3d(c["origin"][0] * K, c["origin"][1] * K, c["origin"][2] * K), x, y)
        a = ObjectAttributes()
        a.LayerIndex = layers.get(c["layer"], layers.get("clips", 0))
        a.Name = c["name"]
        a.SetUserString("wb_project", PROJECT)
        a.SetUserString("wb_id", c["id"])
        a.SetUserString("wb_kind", "clip")
        gid = System.Guid.Empty
        try:
            gid = doc.Objects.AddClippingPlane(pl, c["du"] * K, c["dv"] * K, vps, a)
        except Exception:
            gid = doc.Objects.AddClippingPlane(pl, c["du"] * K, c["dv"] * K, vps)
            if gid != System.Guid.Empty:
                doc.Objects.ModifyAttributes(gid, a, True)
        if gid == System.Guid.Empty:
            rep.note("could not make the clipping plane " + c["name"])
        else:
            rep.add("clipping planes")

def hide_in_details(doc, layers, details):
    for d in details.values():
        for key in d["hide"]:
            i = layers.get(key)
            if i is None:
                continue
            L = doc.Layers[i]
            try:
                L.SetPerViewportVisible(d["vp"], False)
                commit_layer(doc, L)
            except Exception:
                pass

# ------------------------------------------------------------------ run
def main():
    doc = sc.doc
    data = load()
    rep = Report()
    K = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Millimeters, doc.ModelUnitSystem)
    KP = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Millimeters, doc.PageUnitSystem)
    tol = doc.ModelAbsoluteTolerance
    doc.Views.RedrawEnabled = False
    undo = doc.BeginUndoRecord("Web BIM to Rhino")
    try:
        layers = sync_layers(doc, data, rep)
        sync_objects(doc, data, layers, K, tol, rep)
        details = sync_sheets(doc, data, layers, K, KP, rep)
        sync_clips(doc, data, layers, details, K, rep)
        hide_in_details(doc, layers, details)
        drop_layers(doc, data, rep)
    finally:
        doc.EndUndoRecord(undo)
        doc.Views.RedrawEnabled = True
    try:
        doc.Views.ActiveView = [v for v in doc.Views.GetViewList(True, False)][0]
    except Exception:
        pass
    doc.Views.Redraw()
    msg = rep.text()
    for line in msg.split("\n"):
        Rhino.RhinoApp.WriteLine(line)
    print(msg)
    return rep

if __name__ == "__main__":
    main()
`;
