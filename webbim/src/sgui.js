//! The Space Graph workspace: the program as a table, the graph as a bubble diagram that relaxes as
//! you drag it, and the site with its setbacks, entry and packed plan beside it. Every edit is one op
//! on the SpaceGraph element (undoable), and - with Rebuild on change - one sgbuild after it, so the
//! walls, slab, rooms and doors in the model follow the graph.

import { h, clear, dialog, fmtLen } from "./ui_util.js";
import { parseLength } from "./units.js";
import { F } from "./ocaf.js";
import { planSpaceGraph, relaxBubbles, seedBubbles, programFromBrief, programFromWorkbook, programFromRows, readXlsx, readCsv, ccwPoly, SG_DEFAULTS, defaultLegend, legendColour, relWeight, activeLegend, groupKey, SG_GROUPINGS, gfaOf, effOf, BASIS_EFF, parkingArea, PARKING_DEFAULTS } from "./spacegraph.js";
import { effectiveSite, massingStoreys } from "./ops.js";
import { diagramSheetLayout } from "./spacegraph.js";
import { parseOBJ, parseSTL, meshFromKernel, packMesh, meshBox, levelsIn, placeMesh } from "./massing.js";
import { readDXF, dxfDrawing } from "./dxf.js";
import { weld, regionsOf } from "./bimsketch.js";
import { dist, sub, add, mul, dot, normalise, pointInPoly } from "./geom2d.js";

const SG_ZONES = ["Room", "Entry", "BOH", "Circulation", "Tower", "Parking", "Context"];
const SGST = { sg: null, bubbleView: null, layoutView: null, anim: 0, drag: null, entryMode: false, attractMode: false, sel: null, midTab: "bubbles", legend: [], level: undefined, by: "dept", progTab: "programme", float: {}, paneZoom: {}, matrixZoom: 1 };
/** A node's colour, from the analysis's legend. */
const sgColour = nd => legendColour(SGST.legend, nd || {}, SGST.by);
const isParking = nd => nd.use === "parking" || nd.zone === "Parking" || !!nd.parking;
const m2k = v => v >= 10000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k m²` : `${Math.round(v).toLocaleString()} m²`;
const REL_STYLE = { ADJ: ["#2b3a4e", []], CONN: ["#2f6fd6", []], SERV: ["#8a5a2b", [2, 2]], STACK: ["#7d3fb5", [6, 2]], VIEW: ["#2e8b57", [1, 3]], SEP: ["#d0312d", [5, 4]] };
const sgOf = app => app.doc.elements().filter(f => app.doc.typeOf(f) === "SpaceGraph");
const sgCur = app => { const all = sgOf(app); let f = all.find(g => app.doc.idOf(g) === SGST.sg) || all[0]; SGST.sg = f ? app.doc.idOf(f) : null; return f; };
const sgRead = (app, f) => ({ nodes: JSON.parse(JSON.stringify(app.doc.argValue(f, "nodes") || [])), edges: JSON.parse(JSON.stringify(app.doc.argValue(f, "edges") || [])), site: JSON.parse(JSON.stringify(app.doc.argValue(f, "site") || {})), options: JSON.parse(JSON.stringify(app.doc.argValue(f, "options") || {})), order: app.doc.argValue(f, "order") });

/** Write keys of the graph, and rebuild when it is set to; `replan` reorders the rooms from the bubbles. */
function sgCommit(app, f, patch, { replan = false, build = null, say = null } = {}) {
  const id = app.doc.idOf(f), ops = Object.entries(patch).map(([key, value]) => ({ op: "set", id, key, value }));
  const auto = F.bool(f, "auto") !== false, opts = patch.options || app.doc.argValue(f, "options") || {};
  if (build ?? auto) ops.push({ op: "sgbuild", id, replan: replan && !opts.lockOrder });
  else if (replan && !opts.lockOrder) ops.push({ op: "set", id, key: "order", value: null });
  const r = app.apply(ops);
  if (r.ok && say) app.say(say, "ok");
  return r;
}
/** A new space graph from a program, on the active plan's level. */
function sgCreateFrom(app, prog, name) {
  const doc = app.doc, lv = (() => { const v = doc.element(app.lastPlan || ""); return v && F.refId(v, "level"); })() || (doc.elements().find(g => doc.typeOf(g) === "Level") ? doc.idOf(doc.elements().find(g => doc.typeOf(g) === "Level")) : null);
  const f0 = sgCur(app);
  seedBubbles(prog.nodes); relaxBubbles(prog.nodes, prog.edges, 400);
  const opts0 = f0 ? JSON.parse(JSON.stringify(doc.argValue(f0, "options") || {})) : {};
  if (prog.briefText) opts0.briefText = prog.briefText;
  if (prog.labels) opts0.labels = prog.labels;
  if (prog.legends) { if (prog.legends.dept && !(prog.legend && prog.legend.length)) prog.legend = prog.legends.dept; opts0.legends = Object.assign({}, opts0.legends || {}, Object.fromEntries(Object.entries(prog.legends).filter(([k]) => k !== "dept"))); }
  if (prog.legend && prog.legend.length) opts0.legend = prog.legend; else if (!opts0.legend || !opts0.legend.length || !f0) opts0.legend = defaultLegend(prog.nodes);
  if (f0) { const site = JSON.parse(JSON.stringify(doc.argValue(f0, "site") || {})); if (prog.site) Object.assign(site, { area: prog.site.area, developable: prog.site.developable }); sgCommit(app, f0, { nodes: prog.nodes, edges: prog.edges, order: null, options: opts0, site }, { replan: true, say: `${name}: ${prog.nodes.length} spaces, ${prog.edges.length} adjacencies` }); return; }
  const sb = doc.elements().find(g => doc.typeOf(g) === "SiteBoundary");
  const r = app.apply([{ op: "add", element: { type: "SpaceGraph", name, args: { nodes: prog.nodes, edges: prog.edges, site: Object.assign({ boundary: [], setbacks: [], entries: [], spine: null, attractors: [] }, prog.site || {}), options: opts0, order: null, level: lv ? { ref: lv } : null, auto: true, siteBoundary: sb ? { ref: doc.idOf(sb) } : null } } }]);
  if (r.ok) { SGST.sg = r.id; app.apply({ op: "sgbuild", id: r.id }); app.say(`${name}: ${prog.nodes.length} spaces, ${prog.edges.length} adjacencies - packed and built`, "ok"); }
}
function sgReport(title, lines) { if (lines && lines.length) dialog(title, h("div", { style: { display: "grid", gap: "4px" } }, lines.map(l => h("div", { class: "muted" }, l))), [{ label: "OK", primary: true, run: () => true }]); }

// ---------------------------------------------------------------- inputs
export function importProgram(app) {
  const inp = h("input", { type: "file", accept: ".xlsx,.csv,.tsv,.txt,.md,.json", hidden: true }); document.body.append(inp);
  inp.addEventListener("change", async () => {
    const file = inp.files[0]; inp.remove(); if (!file) return;
    try {
      const text = /\.xlsx$/i.test(file.name) ? null : await file.text();
      const prog = /\.xlsx$/i.test(file.name) ? programFromWorkbook(await readXlsx(await file.arrayBuffer())) : /\.(txt|md|json)$/i.test(file.name) ? programFromBrief(text) : programFromRows(readCsv(text));
      if (text && /\.(txt|md|json)$/i.test(file.name)) prog.briefText = text;
      if (!prog.nodes.length) return sgReport(`${file.name}: no spaces found`, prog.report);
      sgCreateFrom(app, prog, file.name.replace(/\.\w+$/, ""));
      sgReport(`${file.name}: ${prog.nodes.length} spaces, ${prog.edges.length} adjacencies`, prog.report);
    } catch (e) { app.say(`${file.name}: ${e.message}`, "error"); }
  });
  inp.click();
}
export function briefDialog(app) {
  const ta = h("textarea", { rows: 14, style: { width: "100%", font: "12.5px var(--mono)" }, "aria-label": "Project brief", placeholder: "One space per line, e.g.\nReception 40 m2, facade, adjacent to Lobby* and Waiting\n3 x Meeting room 18 m2 near Lobby\nPlant 25 sqm back of house, avoid Meeting room\nCorridor 120 m2 circulation\n\nA line ending in ':' starts a department." });
  const out = h("div", { class: "muted small" });
  ta.addEventListener("input", () => { const p = programFromBrief(ta.value); out.textContent = `${p.nodes.length} spaces · ${p.edges.length} adjacencies · ${p.nodes.reduce((a, n) => a + n.area, 0).toFixed(0)} m²${p.report.length ? " · " + p.report.join("; ") : ""}`; });
  dialog("Space Graph from a brief", h("div", { style: { display: "grid", gap: "8px" } }, h("div", { class: "muted small" }, "Areas in m² · \"3 x\" for copies · adjacent to / next to / near (a * makes it strong) · avoid / away from · facade or internal · back of house / circulation · level N"), ta, out),
    [{ label: "Cancel", run: () => true }, { label: "Build graph", primary: true, run: () => { const p = programFromBrief(ta.value); if (!p.nodes.length) { out.textContent = "no spaces with an area found"; return false; } sgCreateFrom(app, p, "Brief"); return true; } }]);
  setTimeout(() => ta.focus(), 30);
}
/** The site from a DXF: its largest closed loop becomes the project's Site Boundary (made, or replaced). */
export function importSite(app) {
  const inp = h("input", { type: "file", accept: ".dxf", hidden: true }); document.body.append(inp);
  inp.addEventListener("change", async () => {
    const file = inp.files[0]; inp.remove(); if (!file) return;
    const text = await file.text();
    const take = r => {
      const { drawing } = dxfDrawing(r), all = weld({ elements: drawing.elements.map(({ layer, ...e }) => e), constraints: [], dims: [] }), res = regionsOf(all);
      if (!(res.regions || []).length) return app.say(`${file.name}: no closed boundary in it${res.error ? " (" + res.error + ")" : ""}`, "error");
      sgSetSite(app, all, `${file.name}`);
    };
    const r = readDXF(text);
    if (r.needsUnits) take(readDXF(text, { askUnits: () => "m" })); else take(r);
  });
  inp.click();
}
/** The project's site boundary set to a sketch - made when there is none - and the space graph pointed at it. */
function sgSetSite(app, sketch, what) {
  const doc = app.doc, f = sgCur(app), sb = doc.elements().find(g => doc.typeOf(g) === "SiteBoundary"), lv = f && F.refId(f, "level");
  const ops = sb ? [{ op: "set", id: doc.idOf(sb), key: "sketch", value: sketch }] : [{ op: "add", element: { id: "SITE", type: "SiteBoundary", name: "Site boundary", args: { sketch, edges: {}, setback: 0, level: lv ? { ref: lv } : null } } }];
  const sid = sb ? doc.idOf(sb) : "SITE";
  if (f) { ops.push({ op: "set", id: doc.idOf(f), key: "siteBoundary", value: { ref: sid } }); const o = JSON.parse(JSON.stringify(doc.argValue(f, "options") || {})); o.footprint = null; ops.push({ op: "set", id: doc.idOf(f), key: "options", value: o }); if (F.bool(f, "auto") !== false) ops.push({ op: "sgbuild", id: doc.idOf(f), replan: true }); }
  const r = app.apply(ops);
  if (r.ok) { const d = doc.data(doc.element(sid)); app.say(`${what}: the site boundary is ${d && d.props ? Math.round(d.props["Site area"].v / 1e6).toLocaleString() : "?"} m² - set each edge's setback in Setbacks or the boundary's Properties`, "ok"); }
}
function sgSiteRect(app) {
  const w = h("input", { type: "text", value: "60 m", "aria-label": "Site width" }), d = h("input", { type: "text", value: "40 m", "aria-label": "Site depth" });
  dialog("Rectangular site", h("div", { class: "cellrow" }, "Width", w, "Depth", d), [{ label: "Cancel", run: () => true }, { label: "OK", primary: true, run: () => {
    const W = parseLength(w.value), D = parseLength(d.value), P = [[0, 0], [W, 0], [W, D], [0, D]];
    sgSetSite(app, weld({ elements: P.map((p, i) => ({ id: "e" + (i + 1), type: "line", a: p, b: P[(i + 1) % 4] })), constraints: [], dims: [] }), "Rectangular site"); return true; } }]);
}
/** Setbacks per edge of the site boundary, or by role (front / side / rear) from the entry. */
function sgSetbacks(app, f) {
  const doc = app.doc, sb = doc.elements().find(g => doc.typeOf(g) === "SiteBoundary");
  if (!sb) return app.say("set a site first (DXF or a rectangle)", "note");
  const sk = doc.argValue(sb, "sketch") || { elements: [] }, edges = JSON.parse(JSON.stringify(doc.argValue(sb, "edges") || {})), dflt = F.real(sb, "setback") || 0;
  const g = sgRead(app, f), entry = g.site.entries && g.site.entries[0] && g.site.entries[0].at;
  const mid = el => el.type === "line" ? [(el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2] : el.c ? [el.c[0] + el.r * Math.cos((el.a0 + el.a1) / 2), el.c[1] + el.r * Math.sin((el.a0 + el.a1) / 2)] : [0, 0];
  const dir = el => el.type === "line" ? (x => [x[0] / (Math.hypot(...x) || 1), x[1] / (Math.hypot(...x) || 1)])([el.b[0] - el.a[0], el.b[1] - el.a[1]]) : [1, 0];
  const inputs = sk.elements.map(el => h("input", { type: "text", value: fmtLen((edges[el.id] || {}).setback ?? dflt), style: { width: "90px" }, "aria-label": `Setback ${el.id}` }));
  const rows = sk.elements.map((el, i) => h("tr", {}, h("td", { class: "mono" }, `${i + 1}`), h("td", {}, el.type), h("td", { class: "muted" }, el.type === "line" ? fmtLen(Math.round(dist(el.a, el.b))) : el.type === "arc" ? fmtLen(Math.round(Math.abs(el.a1 - el.a0) * el.r)) : "–"), h("td", {}, inputs[i])));
  const fr = h("input", { type: "text", value: "10 m", style: { width: "64px" }, "aria-label": "Front setback" }), si = h("input", { type: "text", value: "6 m", style: { width: "64px" }, "aria-label": "Side setback" }), re = h("input", { type: "text", value: "6 m", style: { width: "64px" }, "aria-label": "Rear setback" });
  const byRole = () => {
    if (!entry) return app.say("place the entry first (Entry)", "note");
    let fi = 0, bd = Infinity; sk.elements.forEach((el, i) => { const d = dist(mid(el), entry); if (d < bd) { bd = d; fi = i; } });
    const fd = dir(sk.elements[fi]);
    sk.elements.forEach((el, i) => { const c = dot(dir(el), fd), v = i === fi ? fr.value : c < -0.7 ? re.value : si.value; inputs[i].value = v; });
  };
  dialog("Setbacks", h("div", { style: { display: "grid", gap: "8px" } },
    h("div", { class: "muted small" }, "Each edge of the site boundary is a plane limiting the site; its setback is where building may start. The zoning plane of each edge is in the boundary's Properties."),
    h("div", { class: "cellrow" }, "By role from the entry: front", fr, "side", si, "rear", re, h("button", { class: "btn small", onclick: byRole }, "Apply")),
    h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["#", "Edge", "Length", "Setback"].map(x => h("th", {}, x)))), h("tbody", {}, rows)))),
    [{ label: "Cancel", run: () => true }, { label: "OK", primary: true, run: () => {
      sk.elements.forEach((el, i) => { try { const v = parseLength(inputs[i].value); edges[el.id] = Object.assign({}, edges[el.id], { setback: v }); } catch (e) { /* keep */ } });
      const ops = [{ op: "set", id: doc.idOf(sb), key: "edges", value: edges }]; if (F.bool(f, "auto") !== false) ops.push({ op: "sgbuild", id: doc.idOf(f), replan: true });
      const r = app.apply(ops); if (r.ok) app.say("Setbacks set: the plan refits to the buildable line", "ok"); return true; } }]);
}
function sgOptions(app, f) {
  const g = sgRead(app, f), o = Object.assign({}, SG_DEFAULTS, g.options), fields = [["roomDepth", "Room depth (facade to corridor)"], ["corridor", "Corridor width"], ["module", "Planning module (walls snap to it)"], ["storey", "Storey height"], ["wallHeight", "Wall height"], ["coreMin", "Minimum core depth"], ["maxDepth", "Maximum building depth"]];
  const ins = fields.map(([k, l]) => [k, h("input", { type: "text", value: fmtLen(o[k]), "aria-label": l, style: { width: "100px" } }), l]);
  const doors = h("input", { type: "checkbox", checked: o.doors !== false }), lock = h("input", { type: "checkbox", checked: !!o.lockOrder });
  const types = (cat) => Object.entries(app.doc.lib.types).filter(([id]) => (app.doc.resolveType(id) || {}).category === cat);
  const sel = (key, cat, def) => h("select", { "aria-label": key }, types(cat).map(([id, t]) => h("option", { value: id, selected: (o[key] || def) === id }, t.name || id)));
  const ext = sel("exteriorType", "IfcWall", "T-EXTCAV300"), int = sel("interiorType", "IfcWall", "T-PART100"), flo = sel("floorType", "IfcSlab", "T-FLOOR250"), door = sel("doorType", "IfcDoor", "T-DOOR915");
  dialog("Packing", h("div", { style: { display: "grid", gap: "6px" } },
    ...ins.map(([k, i, l]) => h("label", { class: "cellrow" }, h("span", { class: "lbl", style: { minWidth: "240px" } }, l), i)),
    h("label", { class: "cellrow" }, h("span", { class: "lbl", style: { minWidth: "240px" } }, "Exterior walls"), ext), h("label", { class: "cellrow" }, h("span", { class: "lbl", style: { minWidth: "240px" } }, "Partitions"), int),
    h("label", { class: "cellrow" }, h("span", { class: "lbl", style: { minWidth: "240px" } }, "Slab"), flo), h("label", { class: "cellrow" }, h("span", { class: "lbl", style: { minWidth: "240px" } }, "Doors"), doors, door),
    h("label", { class: "cellrow" }, lock, " Lock the room order (bubble edits keep every room's slot; swap to move rooms)")),
    [{ label: "Cancel", run: () => true }, { label: "OK", primary: true, run: () => {
      const n = Object.assign({}, g.options); for (const [k, i] of ins) { try { n[k] = parseLength(i.value); } catch (e) { /* keep */ } }
      Object.assign(n, { doors: doors.checked, lockOrder: lock.checked, exteriorType: ext.value, interiorType: int.value, floorType: flo.value, doorType: door.value, footprint: null });
      sgCommit(app, f, { options: n }, { replan: true, say: "Packing options set" }); return true; } }]);
}

// ---------------------------------------------------------------- Claude, when the page may ask it
//! Two ways through every brief: the computed one (the parser, the relaxation, the packers - always
//! there, instant, and what re-plans on every change) and Claude's, which reads the brief the way a
//! person does - resolving its conflicts, naming its groups, suggesting its districts and its colour
//! key - and hands back the same graph. What Claude returns is checked and then planned by the same
//! computed system, so both are always shown the same way.
let SG_SAMPLE = null, SG_SAMPLE_ASKED = false;
async function sgSample() {
  if (!SG_SAMPLE_ASKED) { SG_SAMPLE_ASKED = true; try { SG_SAMPLE = window.claude && window.claude.use ? await window.claude.use("sample") : null; } catch (e) { SG_SAMPLE = null; } }
  return SG_SAMPLE;
}
const SG_AI_SHAPE = `{"nodes":[{"id":"R02","name":"Department Store","area_m2":18000,"use":"retail_anchor|retail|leisure|fnb|office|hotel|residential|parking|service|plant","group":"LIF","zone":"Room|Entry|BOH|Tower|Parking|Circulation|Context","storeys":2,"floor_to_floor_m":7,"facade":true,"on_pilotis":false,"side":"north|south|east|west|null (context nodes only)","level":"","notes":""}],
"edges":[{"a":"R02","b":"R03","rel":"ADJ|CONN|VIEW|SEP|STACK|SERV","strength":1-5,"note":""}],
"legend":[{"key":"LIF","label":"Lifestyle & Fashion","colour":"#d9538f"}],
"site":{"area_m2":0,"developable_m2":0},"districts":[{"name":"","group":"","nodes":["R08"]}],"conflicts":["…"],"assumptions":["…"]}`;
function sgFromAi(ans) {
  const nodes = [], edges = [], ids = new Set();
  for (const n of (ans && ans.nodes) || []) {
    if (!n || !n.name) continue; const id = String(n.id || n.name).replace(/\s+/g, "_").slice(0, 24); if (ids.has(id)) continue; ids.add(id);
    const area = Number(n.area_m2) || 0, zone = SG_ZONES.includes(n.zone) ? n.zone : area > 0 ? "Room" : "Context";
    nodes.push({ id, name: String(n.name), base: String(n.name), number: id, dept: n.group || (zone === "Context" ? "Context" : "Mixed"), use: String(n.use || "").toLowerCase(), zone, area, facade: n.facade !== false && zone !== "BOH" && zone !== "Parking",
      storeys: Number(n.storeys) || undefined, f2f: n.floor_to_floor_m ? n.floor_to_floor_m * 1000 : undefined, pilotis: !!n.on_pilotis, side: ["north", "south", "east", "west"].includes(n.side) ? n.side : null, level: n.level || "", note: n.notes || "" });
  }
  for (const e of (ans && ans.edges) || []) { const a = String(e.a || "").replace(/\s+/g, "_"), b = String(e.b || "").replace(/\s+/g, "_"); if (!ids.has(a) || !ids.has(b) || a === b) continue; const rel = String(e.rel || "ADJ").toUpperCase(); edges.push({ a, b, rel, s: Number(e.strength) || 3, w: relWeight(rel, Number(e.strength) || 3), note: e.note || "" }); }
  const legend = ((ans && ans.legend) || []).filter(x => x && x.key && /^#[0-9a-f]{6}$/i.test(x.colour || "")).map(x => ({ key: String(x.key), label: String(x.label || x.key), colour: x.colour }));
  return { nodes, edges, legend, site: ans && ans.site ? { area: Number(ans.site.area_m2) || undefined, developable: Number(ans.site.developable_m2) || undefined } : null,
    report: [...((ans && ans.conflicts) || []).map(c => "Conflict: " + c), ...((ans && ans.assumptions) || []).map(c => "Assumed: " + c), ...((ans && ans.districts) || []).map(d => `District ${d.name} (${d.group}): ${(d.nodes || []).join(", ")}`)] };
}
async function sgFileText(file) {
  if (/\.xlsx$/i.test(file.name)) { const wb = await readXlsx(await file.arrayBuffer()); return wb.sheets.map(sh => `## Sheet "${sh.name}"\n` + sh.rows.map(r => r.map(c => String(c ?? "")).join("\t")).join("\n")).join("\n\n"); }
  return await file.text();
}
/** The brief read by Claude: prompt, the project's own brief, pasted text and attached files. */
export async function aiBriefDialog(app) {
  const sample = await sgSample();
  if (!sample) return app.say("Claude is not available to this page here - open it in Claude with the AI capability allowed", "note");
  const f0 = sgCur(app), g0 = f0 ? sgRead(app, f0) : null, own = g0 && g0.options.briefText;
  const prompt = h("textarea", { rows: 3, style: { width: "100%" }, "aria-label": "What Claude should do", placeholder: "e.g. Read this masterplan brief. Resolve the conflicts by its own priority rule. Split the retail precincts into the 8–12 districts it recommends. Give each precinct a colour." });
  const useOwn = h("input", { type: "checkbox", checked: !!own }), ctxText = h("textarea", { rows: 6, style: { width: "100%", font: "12px var(--mono)" }, "aria-label": "Brief material", placeholder: "Paste more: meeting notes, what your Claude project knows about the brief, the client's comments…" });
  const fileIn = h("input", { type: "file", multiple: true, accept: ".xlsx,.csv,.tsv,.txt,.md,.json", "aria-label": "Attach brief files" });
  const status = h("div", { class: "muted small", role: "status" }), notes = h("div", { class: "muted small" });
  let ctl = null;
  const run = async () => {
    const parts = [];
    if (useOwn.checked && own) parts.push(`# The project's brief\n${own}`);
    for (const file of fileIn.files || []) { try { parts.push(`# File: ${file.name}\n${await sgFileText(file)}`); } catch (e) { parts.push(`# File: ${file.name} (unreadable)`); } }
    if (ctxText.value.trim()) parts.push(`# More material\n${ctxText.value}`);
    let material = parts.join("\n\n"); if (material.length > 52000) { material = material.slice(0, 52000); }
    if (!material.trim()) { status.textContent = "Give Claude a brief: the project's own, pasted text, or a file."; return; }
    const input = `You are an architect's briefing analyst. Turn the brief below into a spatial graph for a planning tool that packs it into massing blocks (large programmes) or rooms (small ones).
Rules: every programme element is a node with its NET area in m² (GLA/NLA/GFA as the brief gives; parking = bays × 31 m² unless stated), its use, its group (the brief's precinct/department), zone, storeys and floor-to-floor when stated or clearly implied; things outside the plot or not areas (stations, roads, promenades, spines, drop-offs) are Context/Circulation nodes with area 0 and, where the brief says, their side of the site; every relationship the brief states is an edge with its relation (ADJ adjacent, CONN walkable link, VIEW sightline, SEP keep apart, STACK vertical, SERV servicing) and strength 1-5, expanding groups ("all precincts", "H01/H02/H03") into edges to each member; resolve conflicts by the brief's own priority rule and list them; give a legend with one distinct, legible colour per group.
${prompt.value.trim() ? "The architect adds: " + prompt.value.trim() + "\n" : ""}Reply with only JSON of this shape: ${SG_AI_SHAPE}

BRIEF:
${material}`;
    ctl = new AbortController(); go.disabled = true; stop.hidden = false; status.textContent = "Thinking… (Claude reads the whole brief first; a long one can take a minute or two)";
    try {
      const ans = await sample.json(input, { signal: ctl.signal, modelTier: "complex", onText: ({ text }) => { status.textContent = `Writing the graph… ${text.length.toLocaleString()} characters`; } });
      const prog = sgFromAi(ans);
      if (!prog.nodes.length) { status.textContent = "Claude found no programme in that material."; return; }
      prog.briefText = own || material.slice(0, 40000);
      seedBubbles(prog.nodes);
      sgCreateFrom(app, prog, "Brief analysis (Claude)");
      status.textContent = `${prog.nodes.filter(n => n.area > 0).length} programme nodes, ${prog.nodes.filter(n => !(n.area > 0)).length} context, ${prog.edges.length} edges - in the graph, planned and built.`;
      clear(notes); for (const n of prog.report) notes.append(h("div", {}, "• " + n));
    } catch (e) {
      status.textContent = e.code === "cancelled" ? "Stopped." : e.code === "not_granted" || e.code === "sampling_disabled" ? "Claude is not allowed for this page." : e.code === "invalid_json" ? "Claude's answer was not a graph - try again, or send less at once." : e.code === "rate_limited" ? "Too many requests just now - try again in a while." : e.code === "prompt_too_large" ? "Too much material at once." : `Claude could not answer (${e.code || e.message}).`;
    } finally { go.disabled = false; stop.hidden = true; }
  };
  const go = h("button", { class: "btn primary small", onclick: run }, "Analyse with Claude"), stop = h("button", { class: "btn small", hidden: true, onclick: () => ctl && ctl.abort() }, "Stop");
  dialog("Brief analysis with Claude", h("div", { style: { display: "grid", gap: "8px" } },
    h("div", { class: "muted small" }, "The computed analysis is always on; this asks Claude to read the brief as a person would - conflicts resolved by the brief's own priority, groups expanded, districts and a colour key suggested - and plans the result the same way. It runs on your Claude account and asks before the first use."),
    own ? h("label", { class: "cellrow" }, useOwn, ` Send the project's brief (${Math.round(own.length / 1000)}k characters)`) : "",
    h("label", {}, "What Claude should do", prompt), h("label", {}, "More material", ctxText), h("div", { class: "cellrow" }, "Attach", fileIn),
    h("div", { class: "cellrow" }, go, stop), status, notes), [{ label: "Close", run: () => { if (ctl) ctl.abort(); return true; } }], { modeless: true });
}
/** A legend read from an image: the swatches and their labels, matched to the analysis's groups. */
export async function aiLegendDialog(app) {
  const sample = await sgSample();
  if (!sample) return app.say("Claude is not available to this page here - open it in Claude with the AI capability allowed", "note");
  const f = sgCur(app); if (!f) return;
  const g = sgRead(app, f), keys = [...new Set(g.nodes.flatMap(n => [n.dept, n.use, n.zone]).filter(Boolean))];
  let file = null; const status = h("div", { class: "muted small", role: "status" }), preview = h("div", { class: "legendlist" });
  const drop = h("div", { class: "dropzone", tabindex: 0 }, "Drop an image of the legend / colour scheme here, or click to choose one");
  const pick = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
  const take = fl => { if (!fl) return; file = fl; drop.textContent = `${fl.name} - ready`; const img = h("img", { src: URL.createObjectURL(fl), style: { maxWidth: "100%", maxHeight: "160px", display: "block", marginTop: "6px" } }); drop.append(img); };
  drop.onclick = () => pick.click(); pick.onchange = () => take(pick.files[0]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); }; drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); take(e.dataTransfer.files[0]); };
  let result = null;
  const run = async () => {
    if (!file) { status.textContent = "Choose an image first."; return; }
    const lim = await sample.limits().catch(() => null); if (!lim || !lim.images) { status.textContent = "This view cannot send images to Claude."; return; }
    status.textContent = "Reading the legend…";
    try {
      const ans = await sample.json(`The image is a colour legend (or a coloured plan with its key) from an architecture practice. Read every swatch: its label and its colour as a hex code (sample the swatch's fill). Then match each to the categories of this project where the meaning agrees: ${JSON.stringify(keys)}. Reply with only JSON: {"entries":[{"label":"Lifestyle & Fashion","colour":"#d9538f","matches":["LIF"]}]}`, { images: file, modelTier: "default" });
      result = ((ans && ans.entries) || []).filter(x => /^#[0-9a-f]{6}$/i.test(x.colour || ""));
      clear(preview);
      for (const e of result) preview.append(h("div", { class: "cellrow" }, h("span", { class: "mswatch", style: { background: e.colour, borderColor: "#666" } }), h("b", {}, e.label), h("span", { class: "muted" }, (e.matches || []).join(", ") || "no match - kept as its own key")));
      status.textContent = `${result.length} swatches read.`; apply.disabled = !result.length;
    } catch (e) { status.textContent = e.code === "image_rejected" ? "That image could not be read - try a PNG or JPEG." : e.code === "invalid_json" ? "Claude could not read a legend in that image." : `Claude could not answer (${e.code || e.message}).`; }
  };
  const apply = h("button", { class: "btn small primary", disabled: true, onclick: () => {
    const legend = []; for (const e of result || []) { const ms = (e.matches || []).length ? e.matches : [e.label]; for (const k of ms) legend.push({ key: k, label: e.label, colour: e.colour }); }
    const o = JSON.parse(JSON.stringify(app.doc.argValue(f, "options") || {})); o.legend = legend.concat((o.legend || []).filter(x => !legend.some(y => y.key === x.key)));
    sgCommit(app, f, { options: o }, { say: `Legend from ${file.name}: ${legend.length} colours` });
  } }, "Use this legend");
  dialog("Legend from an image", h("div", { style: { display: "grid", gap: "8px" } }, h("div", { class: "muted small" }, "Claude reads the swatches and labels and matches them to this brief's groups; the bubbles, the plan and the blocks in 3D take the colours."), drop, pick,
    h("div", { class: "cellrow" }, h("button", { class: "btn small", onclick: run }, "Read with Claude"), apply), status, preview), [{ label: "Close", run: () => true }], { modeless: true });
}

// ---------------------------------------------------------------- massing and levels
export function importMassing(app) {
  const inp = h("input", { type: "file", accept: ".obj,.stl,.step,.stp,.brep", hidden: true }); document.body.append(inp);
  inp.addEventListener("change", async () => {
    const file = inp.files[0]; inp.remove(); if (!file) return;
    try {
      let mesh;
      if (/\.(step|stp|brep)$/i.test(file.name)) {
        app.say(`${file.name}: reading with OpenCascade… (the kernel starts the first time)`, "note");
        mesh = meshFromKernel(await app.kernelMesh({ format: /\.brep$/i.test(file.name) ? "brep" : "step", name: file.name, data: await file.text() }));
      } else {
        const raw = /\.obj$/i.test(file.name) ? parseOBJ(await file.text(), 1) : parseSTL(await file.arrayBuffer(), 1), b = meshBox(raw);
        const ext = b ? Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) : 0;
        // OBJ and STL carry no units: a model under 5,000 across is taken as metres
        const k = ext && ext < 5000 ? 1000 : 1;
        mesh = k === 1 ? raw : { positions: raw.positions.map(v => v * k), index: raw.index };
        if (k !== 1) app.say(`${file.name}: no units in the file - read as metres (it is ${ext.toFixed(1)} across)`, "note");
      }
      if (!mesh.index.length) return app.say(`${file.name}: no triangles in it`, "error");
      const f = sgCur(app), doc = app.doc, old = doc.elements().find(g => doc.typeOf(g) === "Massing");
      const ops = [old ? { op: "set", id: doc.idOf(old), key: "mesh", value: packMesh(mesh) } : { op: "add", element: { id: "MASS", type: "Massing", name: file.name.replace(/\.\w+$/, ""), args: { mesh: packMesh(mesh), file: file.name, floorToFloor: 4500, minPlate: 50 } } }];
      const mid = old ? doc.idOf(old) : "MASS";
      if (f) ops.push({ op: "set", id: doc.idOf(f), key: "massing", value: { ref: mid } });
      const r = app.apply(ops); if (!r.ok) return;
      app.say(`${file.name}: ${mesh.index.length / 3} triangles${mesh.faces ? `, ${new Set(mesh.faces).size} faces` : ""} - set the floor-to-floor to lay levels through it`, "ok");
      levelsDialog(app);
    } catch (e) { app.say(`${file.name}: ${e.message}`, "error"); }
  });
  inp.click();
}
export function levelsDialog(app) {
  const doc = app.doc, m = doc.elements().find(g => doc.typeOf(g) === "Massing"); if (!m) return app.say("import a massing first", "note");
  const p = doc.plan(m); if (!p) return app.say(doc.error(m) || "the massing did not build", "error");
  const ftf = h("input", { type: "text", value: fmtLen(F.real(m, "floorToFloor")), style: { width: "90px" }, "aria-label": "Floor to floor" });
  const list = h("div", { class: "legendlist" });
  const show = () => { let hgt; try { hgt = parseLength(ftf.value); } catch (e) { return; } const lv = levelsIn(p.mesh, hgt, { minPlate: (F.real(m, "minPlate") || 0) * 1e6 }); clear(list); list.append(h("div", {}, h("b", {}, `${lv.length} storeys fit`), ` · ${Math.round(lv.reduce((a, l) => a + l.area, 0) / 1e6).toLocaleString()} m² of plate`)); for (const l of lv) list.append(h("div", { class: "muted" }, `Level ${l.index} at ${fmtLen(Math.round(l.z))} - plate ${Math.round(l.area / 1e6).toLocaleString()} m²`)); };
  ftf.addEventListener("input", show); show();
  dialog("Levels through the massing", h("div", { style: { display: "grid", gap: "8px" } }, h("div", { class: "muted small" }, "Storeys are counted where the envelope still has a plate. Made, they are ordinary levels: move, rename or delete them and the plates follow."), h("label", { class: "cellrow" }, "Ideal floor-to-floor", ftf), list),
    [{ label: "Cancel", run: () => true }, { label: "Make levels", primary: true, run: () => {
      let hgt; try { hgt = parseLength(ftf.value); } catch (e) { return false; }
      const f = sgCur(app), ops = [{ op: "masslevels", id: doc.idOf(m), height: hgt }];
      if (f) { const o = JSON.parse(JSON.stringify(doc.argValue(f, "options") || {})); o.mode = "plates"; ops.push({ op: "set", id: doc.idOf(f), key: "options", value: o }, { op: "set", id: doc.idOf(f), key: "massing", value: { ref: doc.idOf(m) } }, { op: "sgbuild", id: doc.idOf(f), replan: true }); }
      const r = app.apply(ops); if (r.ok) app.say(r.said || "Levels made", "ok"); return true; } }]);
}

// ---------------------------------------------------------------- the workspace: Brief Analysis
export function renderSpaceGraph(app, root) {
  cancelAnimationFrame(SGST.anim);
  const f = sgCur(app);
  const bar = h("div", { class: "sgbar" });
  const btn = (label, run, title, primary) => h("button", { class: "btn small" + (primary ? " primary" : ""), title: title || label, onclick: run }, label);
  const grp = (...kids) => h("span", { class: "sggrp" }, ...kids);
  const aiBtns = [btn("✦ Analyse with Claude…", () => aiBriefDialog(app), "Claude reads the brief as a person would: conflicts, groups, districts, a colour key - then the same computed planning"),
    btn("✦ Legend from image…", () => aiLegendDialog(app), "Drop an image of a legend or colour scheme: Claude reads the swatches and matches them to the brief's groups")];
  for (const b of aiBtns) b.hidden = !SG_SAMPLE;
  if (!SG_SAMPLE_ASKED) sgSample().then(x => { if (x) for (const b of aiBtns) b.hidden = false; });
  bar.append(grp(h("b", { class: "sgtitle" }, "Brief"), btn("Write / paste…", () => briefDialog(app), "Write or paste a brief - a list of spaces, or a structured brief with a node table and typed edges"),
    btn("Import…", () => importProgram(app), "A brief (.txt / .md / .json) or a programme (.xlsx / .csv)"), ...aiBtns));
  if (!f) {
    root.append(h("div", { class: "sgws" }, bar, h("div", { class: "empty", style: { maxWidth: "620px", margin: "40px auto" } }, h("h3", {}, "Brief Analysis"),
      "A brief read into a graph: spaces and programme elements with their areas, groups and needs; the relationships between them. The graph relaxes into a bubble diagram and an adjacency matrix; with no site it plans a first attempt at once - blocks for a masterplan, rooms for a building - and re-plans as the site boundary, setbacks, a massing and levels are added.")));
    return;
  }
  const doc = app.doc, id = doc.idOf(f), g = sgRead(app, f);
  SGST.by = g.options.colourBy || "dept"; SGST.legend = activeLegend(g.options, g.nodes);
  const site = effectiveSite(doc, f), storeys = massingStoreys(doc, f);
  let plan = null; try { plan = planSpaceGraph(Object.assign({}, g, { site }), { relax: false, storeys }); } catch (e) { app.say(`planning: ${e.message}`, "error"); }
  const mode = plan ? plan.mode || (plan.massing ? "plates" : "rooms") : "—";
  const modeSel = h("select", { "aria-label": "Planning mode", title: "How the brief is planned", onchange: e => { const o = Object.assign({}, g.options, { mode: e.target.value }); sgCommit(app, f, { options: o }, { replan: true, say: `Planning as ${e.target.selectedOptions[0].textContent}` }); } },
    [["auto", "Auto"], ["blocks", "Blocks (massing study)"], ["rooms", "Rooms (corridor)"], ["plates", "Rooms on massing plates"]].map(([v, l]) => h("option", { value: v, selected: (g.options.mode || "auto") === v }, l)));
  bar.append(
    grp(h("b", { class: "sgtitle" }, "Site"), btn("Plot from DXF…", () => importSite(app), "The client's plot lines: the largest closed loop in a DXF becomes the Site Boundary"), btn("Rectangle…", () => sgSiteRect(app)), btn("Setbacks…", () => sgSetbacks(app, f)),
      h("button", { class: "btn small" + (SGST.entryMode ? " primary" : ""), title: "Click the plot edge where people arrive", onclick: () => { SGST.entryMode = !SGST.entryMode; SGST.attractMode = false; app.refresh(); } }, SGST.entryMode ? "Click the entry…" : "Entry"),
      h("button", { class: "btn small" + (SGST.attractMode ? " primary" : ""), title: "Click the plan where you want the selected space (Shift: its whole group); Alt-click removes the nearest point", onclick: () => { SGST.attractMode = !SGST.attractMode; SGST.entryMode = false; app.refresh(); } }, SGST.attractMode ? "Click to attract…" : "Attractor")),
    grp(h("b", { class: "sgtitle" }, "View"), h("select", { "aria-label": "Colour and group by", title: "Colour, group and total the analysis by precinct, category or business unit - the bubbles, the plan, the blocks in 3D and the legend follow", onchange: e => sgCommit(app, f, { options: Object.assign({}, g.options, { colourBy: e.target.value }) }, { build: true, say: `Coloured by ${e.target.selectedOptions[0].textContent.toLowerCase()}` }) },
      SG_GROUPINGS.map(([k, l]) => h("option", { value: k, selected: SGST.by === k }, "By " + l.toLowerCase())))),
    grp(h("b", { class: "sgtitle" }, "Massing"), btn("Import…", () => importMassing(app), "The envelope: OBJ, STL, or STEP (read by OpenCascade)"), btn("Levels…", () => levelsDialog(app), "Lay levels through the massing at an ideal floor-to-floor")),
    grp(h("b", { class: "sgtitle" }, "Plan"), modeSel, btn("Packing…", () => sgOptions(app, f)), btn("Replan", () => sgCommit(app, f, {}, { replan: true, build: true, say: "Replanned from the graph" }), "Re-plan from the bubble diagram (clears swaps)"),
      btn("Build", () => { const r = app.apply({ op: "sgbuild", id }); if (r.ok && r.said) app.say(r.said, "ok"); }, "Build or rebuild the model", true),
      h("label", { class: "cellrow", title: "Rebuild the model whenever the graph changes" }, h("input", { type: "checkbox", checked: F.bool(f, "auto") !== false, onchange: e => app.apply({ op: "set", id, key: "auto", value: e.target.checked }) }), " Auto"),
      btn("Diagrams → A1 sheet", () => sgDiagramSheet(app, f), "Lay every diagram, the site analysis and the figures out on an A1 sheet (drawn live from the graph)"),
      btn("Plan view", () => { const lv = F.refId(f, "level"); const pv = doc.elements().find(v => doc.typeOf(v) === "PlanView" && F.refId(v, "level") === lv); if (pv) app.openView(doc.idOf(pv)); }), btn("3D", () => { const v3 = doc.elements().find(v => doc.typeOf(v) === "View3D"); if (v3) app.openView(doc.idOf(v3)); })));
  const table = SGST.progTab === "parking" ? sgParkingTable(app, f, g) : sgProgramTable(app, f, g, plan), legend = sgLegendPanel(app, f, g);
  if (SGST.paneZoom.program) table.style.zoom = SGST.paneZoom.program;
  const ptabs = h("span", { class: "sgtabs" }, [["programme", "Programme"], ["parking", "Parking"]].map(([k, l]) => h("button", { class: "vvtab" + (SGST.progTab === k ? " on" : ""), onclick: () => { SGST.progTab = k; app.refresh(); } }, l)));
  const metrics = sgMetrics(plan);
  const rep = h("div", { class: "sgreport" }, plan ? plan.report.slice(0, 40).map(r => h("div", {}, "⚠ " + r)) : null);
  const prog = g.nodes.filter(n => n.area > 0 && n.zone !== "Context" && !isParking(n)), park = g.nodes.filter(n => n.area > 0 && isParking(n));
  const sumTxt = SGST.progTab === "parking" ? ` ${park.length} car parks · ${park.reduce((a, n) => a + ((n.parking && n.parking.bays) || 0), 0).toLocaleString()} bays · ${m2k(park.reduce((a, n) => a + gfaOf(n), 0))}`
    : ` ${prog.length} elements · ${prog.reduce((a, n) => a + (n.units || 0), 0).toLocaleString() || "–"} units · ${m2k(prog.reduce((a, n) => a + (+n.area || 0), 0))} stated · ${m2k(prog.reduce((a, n) => a + gfaOf(n), 0))} GFA`;
  // the diagrams: each a tab of the middle panel, or popped off into a window of its own
  const docked = Object.keys(SG_VIEWS).filter(k => !SGST.float[k]); if (!docked.includes(SGST.midTab)) SGST.midTab = docked[0] || "bubbles";
  const tabs = h("span", { class: "sgtabs" }, docked.map(k => h("button", { class: "vvtab" + (SGST.midTab === k ? " on" : ""), onclick: () => { SGST.midTab = k; app.refresh(); } }, SG_VIEWS[k])));
  const headFor = kind => kind === "pies" ? [h("span", { class: "cellrow", style: { display: "inline-flex", gap: "6px", marginLeft: "6px" } },
      h("select", { "aria-label": "Measure the pies by", onchange: e => { SGST.pieMeasure = e.target.value; app.refresh(); } }, [["area", "Stated area (GLA / NLA / GFA)"], ["gfa", "GFA (built)"], ["units", "Units (stores)"], ["frontage", "Frontage"]].map(([v, l]) => h("option", { value: v, selected: (SGST.pieMeasure || "area") === v }, l))),
      h("label", { class: "cellrow", title: "Parking is counted in bays and dwarfs everything else - off by default" }, h("input", { type: "checkbox", checked: !!SGST.pieParking, onchange: e => { SGST.pieParking = e.target.checked; app.refresh(); } }), " parking"),
      h("label", { class: "cellrow" }, h("input", { type: "checkbox", checked: SGST.pieRetail !== false, onchange: e => { SGST.pieRetail = e.target.checked; app.refresh(); } }), " retail only"))]
    : [h("span", { class: "muted" }, kind === "matrix" ? " click a cell to cycle ADJ → CONN → SEP → none · wheel scrolls · Ctrl-wheel or ＋/－ zooms" : kind === "site" ? " the plot, its edges and what lies around it · drag to pan, wheel to zoom" : kind === "plan" ? (mode === "blocks" ? " drag a block to move it · drag its edge grips to reshape it (its area holds)" : " drag a room onto another to swap them") : " drag · Shift-drag to link · click a link to cycle it · double-click to pin")];
  // each panel docks in the grid or floats on its own (moved by its header, resized by its corner), and zooms
  const zoomPane = (key, k) => {
    if (key === "program") SGST.paneZoom.program = k ? Math.max(0.5, Math.min(2.5, (SGST.paneZoom.program || 1) * k)) : 1;
    else if (key === "pies") SGST.paneZoom.pies = k ? Math.max(0.6, Math.min(3, (SGST.paneZoom.pies || 1) * k)) : 1;
    else if (key === "matrix") { SGST.matrixZoom = k ? Math.max(0.3, Math.min(6, SGST.matrixZoom * k)) : 1; if (!k) SGST.matrixPan = [0, 0]; }
    else { const vk = key === "bubbles" ? "bubbleView" : key === "site" ? "siteView" : "layoutView", v = SGST[vk]; if (!k) SGST[vk] = null; else if (v) { v.s *= k; v.user = true; } }
    app.refresh();
  };
  const pane = (key, title, head, body, gridKey = key) => {
    const fl = SGST.float[key];
    const zb = (lab, k, tip) => h("button", { class: "iconbtn", title: tip, "aria-label": `${tip} (${title})`, onclick: () => zoomPane(key, k) }, lab);
    const sec = h("section", { class: "sgpane" + (fl ? " sgfloat" : ""), "data-pane": gridKey, style: fl ? { left: fl.x + "px", top: fl.y + "px", width: fl.w + "px", height: fl.h + "px" } : {} });
    const hdr = h("header", {}, ...(fl ? [h("b", {}, title + " ")] : []), ...head, h("span", { class: "sgpanebtns" }, zb("－", 1 / 1.25, "Zoom out"), zb("＋", 1.25, "Zoom in"), zb("⤢", 0, "Fit"),
      h("button", { class: "iconbtn", title: fl ? "Dock back into the workspace" : `Pop off: ${title} in a window of its own`, "aria-label": fl ? `Dock ${title}` : `Pop off ${title}`, onclick: () => { if (SGST.float[key]) delete SGST.float[key]; else { const r = sec.getBoundingClientRect(), n = Object.keys(SGST.float).length; SGST.float[key] = { x: Math.round(Math.min(window.innerWidth - 420, r.left + 40 + n * 28)), y: Math.round(Math.min(window.innerHeight - 340, r.top + 40 + n * 28)), w: Math.round(Math.max(420, r.width)), h: Math.round(Math.max(340, r.height)) }; } app.refresh(); } }, fl ? "⤓" : "⧉")));
    sec.append(hdr, ...body);
    if (fl) {
      hdr.style.cursor = "move"; sec.addEventListener("pointerdown", () => { for (const o of document.querySelectorAll(".sgfloat")) o.style.zIndex = 60; sec.style.zIndex = 61; });
      hdr.onpointerdown = e => { if (e.target.closest("button,select,input,label")) return; const x0 = e.clientX - fl.x, y0 = e.clientY - fl.y; hdr.setPointerCapture(e.pointerId);
        hdr.onpointermove = ev => { fl.x = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - x0)); fl.y = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - y0)); sec.style.left = fl.x + "px"; sec.style.top = fl.y + "px"; };
        hdr.onpointerup = () => { hdr.onpointermove = null; }; };
      // only a resize by hand redraws: the first size seen is the baseline, whatever the box model made of it
      let t = 0, base = null; const ro = new ResizeObserver(() => { if (!sec.isConnected) { ro.disconnect(); return; } const w = Math.round(sec.offsetWidth), hh = Math.round(sec.offsetHeight); if (!w || !hh) return; if (!base) { base = [w, hh]; return; } if (Math.abs(w - base[0]) < 4 && Math.abs(hh - base[1]) < 4) return; fl.w += w - base[0]; fl.h += hh - base[1]; base = [w, hh]; clearTimeout(t); t = setTimeout(() => { ro.disconnect(); app.refresh(); }, 250); });
      requestAnimationFrame(() => ro.observe(sec));
    }
    return sec;
  };
  const canvases = [], cvFor = kind => { const cv = h("canvas", { class: "sgcanvas", "aria-label": SG_VIEWS[kind] || "Site and plan" }); canvases.push([kind, cv]); return cv; };
  const panes = [pane("program", "Programme", [ptabs, h("span", { class: "muted" }, sumTxt)], [table, legend])];
  if (docked.length) panes.push(pane(SGST.midTab, SG_VIEWS[SGST.midTab], [tabs, ...headFor(SGST.midTab)], [cvFor(SGST.midTab)], "diagram"));
  panes.push(pane("plan", `Plan · ${mode}`, [`Plan · ${mode}`, ...headFor("plan")], [cvFor("plan"), metrics, rep]));
  for (const k of Object.keys(SG_VIEWS)) if (SGST.float[k]) panes.push(pane(k, SG_VIEWS[k], headFor(k), [cvFor(k)]));
  const dock = panes.filter(p => !p.classList.contains("sgfloat")), floats = panes.filter(p => p.classList.contains("sgfloat"));
  const cols = { program: "minmax(300px, 1.1fr)", diagram: "1fr", plan: "1.2fr" };
  const grid = h("div", { class: "sggrid", style: window.innerWidth > 1100 ? { gridTemplateColumns: dock.map(p => cols[p.dataset.pane] || "1fr").join(" ") || "1fr" } : {} }, ...dock);
  root.append(h("div", { class: "sgws" }, bar, grid), ...floats);
  requestAnimationFrame(() => { for (const [kind, cv] of canvases) try { sgDraw(app, f, kind, cv, g, plan, site); } catch (e) { console.error(e); app.say(`${SG_VIEWS[kind] || "plan"}: ${e.message}`, "error"); } });
}
const SG_VIEWS = { bubbles: "Bubbles", matrix: "Adjacency matrix", pies: "Pie charts", site: "Site analysis" };
function sgDraw(app, f, kind, cv, g, plan, site) {
  if (kind === "plan") return sgLayoutCanvas(app, f, cv, g, plan, site);
  if (kind === "matrix") return sgMatrixCanvas(app, f, cv, g);
  if (kind === "pies") return sgPieCanvas(app, f, cv, g);
  if (kind === "site") return sgSiteCanvas(app, f, cv, g, plan, site);
  return sgBubbleCanvas(app, f, cv, g);
}
/** The figures that say how the attempt performs. */
function sgMetrics(plan) {
  const box = h("div", { class: "sgmetrics" }); if (!plan || !plan.metrics && !plan.levels) return box;
  const M = plan.metrics || {}, k = (label, v, note) => box.append(h("div", { class: "sgm" }, h("b", {}, v), h("span", {}, label), note ? h("i", {}, note) : ""));
  const m2 = v => v == null ? "–" : `${Math.round(v).toLocaleString()} m²`, pc = v => v == null ? "–" : `${Math.round(v * 100)}%`;
  if (plan.mode === "blocks") {
    k("Programme GFA", m2(M.programGfa ?? M.gfa), "parking apart"); if (M.gla) k("Retail GLA", m2(M.gla), M.units ? `${M.units.toLocaleString()} units` : ""); if (M.frontage) k("Frontage", `${Math.round(M.frontage).toLocaleString()} m`);
    if (M.bays) k("Parking", `${M.bays.toLocaleString()} bays`, m2(M.parkingGfa)); k("Ground footprint", m2(M.ground)); k("Site", m2(M.site), M.developable ? `${m2(M.developable)} developable` : "");
    k("Site coverage", pc(M.coverage)); k("FAR", M.far ? M.far.toFixed(2) : "–"); k("Tallest", `${Math.round(M.maxHeight)} m`);
    k("Adjacencies met", pc(M.adjacency), "strong links within 1½ streets"); k("Keep-aparts met", pc(M.separation)); k("Extent", M.extent ? `${Math.round(M.extent[0])} × ${Math.round(M.extent[1])} m` : "–");
    const tot = Object.values(M.byDept || {}).reduce((a, b) => a + b, 0) || 1, bars = h("div", { class: "sgbars" });
    for (const [d, a] of Object.entries(M.byDept || {}).sort((x, y) => y[1] - x[1])) bars.append(h("div", { class: "sgbar1", title: `${d}: ${m2(a)}` }, h("span", { style: { background: sgColour({ dept: d }), width: `${(a / tot * 100).toFixed(1)}%` } }), h("em", {}, `${d} ${Math.round(a / tot * 100)}%`)));
    box.append(bars);
  } else if (plan.massing) {
    k("Programme", m2(M.program)); k("Gross plate (GIA)", m2(M.gia)); k("Usable capacity", m2(M.capacity)); k("Packed", m2(M.packed)); k("Efficiency", pc(M.efficiency)); k("Storeys needed", M.storeysNeeded ?? "–", `${M.storeys} in the massing`);
    if (M.far) k("FAR", M.far.toFixed(2));
    const t = h("table", { class: "sgtbl" }, h("thead", {}, h("tr", {}, ["Level", "GIA", "Capacity", "Assigned", "Packed", "Eff."].map(x => h("th", {}, x)))), h("tbody", {}, plan.levels.map(L => h("tr", {}, h("td", {}, L.name), h("td", {}, m2(L.metrics.gia)), h("td", {}, m2(L.metrics.capacity)), h("td", {}, m2(L.metrics.assigned)), h("td", {}, m2(L.metrics.packed)), h("td", {}, pc(L.metrics.gia ? L.metrics.packed / L.metrics.gia : 0))))));
    box.append(t);
  } else if (plan.footprint) {
    const rooms = plan.levels.flatMap(L => L.rooms);
    k("Rooms", rooms.length); k("Packed", m2(rooms.reduce((a, r) => a + r.area, 0))); k("Footprint", `${(plan.footprint.W / 1000).toFixed(1)} × ${(plan.footprint.D / 1000).toFixed(1)} m`); k("Levels", plan.levels.length);
  }
  return box;
}
function sgLegendPanel(app, f, g) {
  const box = h("div", { class: "sglegend" }), o = g.options, by = SGST.by, legend = SGST.legend;
  const set = next => { const n = Object.assign({}, o); if (by === "dept") n.legend = next; else n.legends = Object.assign({}, o.legends || {}, { [by]: next }); sgCommit(app, f, { options: n }, { build: true }); };
  const byName = (SG_GROUPINGS.find(x => x[0] === by) || [, "Group"])[1];
  box.append(h("div", { class: "cellrow" }, h("b", {}, `Legend · ${byName}`), h("span", { class: "grow" }), h("button", { class: "btn small ghost", title: "One colour per group, from the programme", onclick: () => set(defaultLegend(g.nodes, by, o.labels)) }, "Reset")));
  // each group's share: units, what the brief states (GLA/NLA) and what gets built (GFA)
  const tot = new Map(); for (const n of g.nodes) { if (!(n.area > 0) || n.zone === "Context") continue; const k = groupKey(n, by), t = tot.get(k) || { u: 0, a: 0, gfa: 0 }; t.u += n.units || 0; t.a += isParking(n) ? 0 : +n.area || 0; t.gfa += gfaOf(n); tot.set(k, t); }
  for (const [i, e] of legend.entries()) { const t = tot.get(e.key);
    box.append(h("label", { class: "legendchip" + (t ? "" : " unused"), title: t ? `${e.key}: ${t.u ? t.u + " units · " : ""}${Math.round(t.a).toLocaleString()} m² stated · ${Math.round(t.gfa).toLocaleString()} m² GFA` : e.key },
      h("input", { type: "color", value: e.colour, "aria-label": `Colour of ${e.label}`, onchange: ev => { const n = legend.map(x => Object.assign({}, x)); n[i].colour = ev.target.value; set(n); } }), h("span", {}, e.label), t ? h("span", { class: "muted" }, ` ${t.u ? t.u + " u · " : ""}${m2k(t.gfa)}`) : "")); }
  return box;
}

/** Whether an element takes part in the packing: unticked, it stays in the brief and its totals but is not placed. */
const packBox = (nd, put) => h("input", { type: "checkbox", checked: !nd.skip, "aria-label": `${nd.name} takes part in the packing`, onchange: e => { nd.skip = !e.target.checked || undefined; put(); } });
function sgProgramTable(app, f, g, plan) {
  const wrap = h("div", { class: "sgtable" }), tb = h("tbody"), doc = app.doc, by = SGST.by;
  const put = () => sgCommit(app, f, { nodes: g.nodes }, { replan: false });
  const placed = new Map(); if (plan) { for (const L of plan.levels || []) for (const r of L.rooms) placed.set(r.id, Object.assign({ levelName: L.name || L.key }, r)); for (const b of plan.blocks || []) placed.set(b.id, b); }
  const levels = doc.elements().filter(x => doc.typeOf(x) === "Level").sort((a, b) => F.real(a, "elevation") - F.real(b, "elevation"));
  const num = v => Math.max(0, Number(String(v).replace(/[, ]/g, "")) || 0);
  const row = nd => {
    const r = placed.get(nd.id), warn = r && r.warn && r.warn.length, ctx = nd.zone === "Context" || !(nd.area > 0);
    const inp = (k, w, parse = x => x) => h("input", { type: "text", value: nd[k] ?? "", style: { width: w }, "aria-label": `${nd.name} ${k}`, onchange: e => { nd[k] = parse(e.target.value); put(); } });
    const basis = nd.basis || "GFA", gfa = gfaOf(nd);
    return h("tr", { class: (SGST.sel === nd.id ? "on " : "") + (warn ? "warn " : "") + (ctx ? "ctx" : ""), onclick: e => { if (e.target.tagName === "TD") { SGST.sel = nd.id; app.refresh({ keepMain: false }); } } },
      h("td", {}, h("span", { class: "mswatch", style: { background: sgColour(nd), borderColor: "#888" } })),
      h("td", { title: "Pack: take part in the packing. Untick to leave it out of the plan (it stays in the brief and its totals)" }, ctx ? "" : packBox(nd, put)),
      h("td", { class: "mono muted" }, nd.id), h("td", {}, inp("name", "120px")),
      h("td", {}, ctx ? "" : h("select", { "aria-label": `${nd.name} area basis`, title: "What the stated area measures: GLA (lettable), NLA (net), or GFA (gross, built as stated)", onchange: e => { nd.basis = e.target.value; put(); } }, ["GLA", "NLA", "GFA"].map(b => h("option", { selected: b === basis }, b)))),
      h("td", {}, ctx ? h("span", { class: "muted" }, nd.side || "–") : inp("area", "62px", v => Math.max(1, num(v) || 1))),
      h("td", { title: basis === "GFA" ? "Given as GFA: built as stated" : `Efficiency: ${basis} ÷ GFA (default ${Math.round((BASIS_EFF[basis] || 1) * 100)}%)` }, ctx || basis === "GFA" ? h("span", { class: "muted" }, ctx ? "" : "100") :
        h("input", { type: "text", value: Math.round(effOf(nd) * 100), style: { width: "34px" }, "aria-label": `${nd.name} efficiency percent`, onchange: e => { const v = num(e.target.value); nd.eff = v > 0 ? Math.min(100, v) / 100 : undefined; put(); } })),
      h("td", { class: "mono", title: r && r.area ? `built ${Math.round(r.area).toLocaleString()} m² GFA` : "not packed" }, ctx ? "" : Math.round(gfa).toLocaleString()),
      h("td", { class: "mono muted", title: nd.mix ? nd.mix.map(x => `${x.units} × ${x.label} m²`).join(" · ") + (nd.frontage ? ` · ${nd.frontage} m frontage` : "") : "" }, nd.units ? nd.units.toLocaleString() : ""),
      h("td", {}, inp(by, "70px")),
      h("td", {}, h("select", { "aria-label": `${nd.name} zone`, onchange: e => { nd.zone = e.target.value; put(); } }, SG_ZONES.map(z => h("option", { selected: z === nd.zone }, z)))),
      h("td", {}, ctx ? "" : inp("storeys", "30px", v => Math.max(1, Math.round(Number(v) || 1)))),
      h("td", {}, ctx ? "" : h("select", { "aria-label": `${nd.name} level`, onchange: e => { nd.level = e.target.value; put(); } }, h("option", { value: "" }, "auto"), levels.map(L => h("option", { value: doc.idOf(L), selected: nd.level === doc.idOf(L) || nd.level === F.text(L, "name") }, F.text(L, "name"))))),
      h("td", { title: "Lock to this level: it stays there whatever the solver does" }, ctx ? "" : h("input", { type: "checkbox", checked: !!nd.lockLevel, "aria-label": `${nd.name} locked to its level`, onchange: e => { nd.lockLevel = e.target.checked; put(); } })),
      h("td", {}, h("button", { class: "iconbtn", "aria-label": `Delete ${nd.name}`, onclick: () => { g.nodes = g.nodes.filter(x => x !== nd); g.edges = g.edges.filter(e => e.a !== nd.id && e.b !== nd.id); sgCommit(app, f, { nodes: g.nodes, edges: g.edges }, { replan: true }); } }, "✕")));
  };
  const prog = g.nodes.filter(n => n.area > 0 && n.zone !== "Context" && !isParking(n));
  // grouped by the grouping in force, each group with its subtotal
  const groups = new Map(); for (const nd of prog) { const k = groupKey(nd, by); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(nd); }
  const labelOf = k => (SGST.legend.find(e => e.key === k) || {}).label || k;
  for (const [k, ns] of groups) {
    if (groups.size > 1) tb.append(h("tr", {}, h("td", { colspan: 15, class: "sgsub" }, h("span", { class: "mswatch", style: { background: sgColour(ns[0]), borderColor: "#888" } }), ` ${labelOf(k)} - ${ns.reduce((a, n) => a + (n.units || 0), 0) || ""}${ns.some(n => n.units) ? " units · " : ""}${Math.round(ns.reduce((a, n) => a + +n.area, 0)).toLocaleString()} m² stated · ${Math.round(ns.reduce((a, n) => a + gfaOf(n), 0)).toLocaleString()} m² GFA`)));
    for (const nd of ns) tb.append(row(nd));
  }
  const ctxRows = g.nodes.filter(n => !(n.area > 0) || n.zone === "Context");
  if (ctxRows.length) { tb.append(h("tr", {}, h("td", { colspan: 15, class: "sgsub" }, `Context and circulation (${ctxRows.length}) - outside the plot or not areas; placed on their side of the site`))); for (const nd of ctxRows) tb.append(row(nd)); }
  const byName = (SG_GROUPINGS.find(x => x[0] === by) || [, "Group"])[1];
  const tot = h("tr", { class: "sgtot" }, h("td", { colspan: 5 }, "Total (parking in its own tab)"), h("td", { class: "mono" }, Math.round(prog.reduce((a, n) => a + +n.area, 0)).toLocaleString()), h("td"), h("td", { class: "mono" }, Math.round(prog.reduce((a, n) => a + gfaOf(n), 0)).toLocaleString()), h("td", { class: "mono" }, prog.reduce((a, n) => a + (n.units || 0), 0).toLocaleString()), h("td", { colspan: 6 }));
  wrap.append(h("table", {}, h("thead", {}, h("tr", {}, ["", "Pack", "Id", "Name", "Basis", "Area m²", "Eff %", "GFA m²", "Units", byName, "Zone", "St.", "Level", "🔒", ""].map(x => h("th", {}, x)))), tb, h("tfoot", {}, tot)),
    h("div", { class: "cellrow", style: { marginTop: "6px" } }, h("button", { class: "btn small", onclick: () => { let n = 1; while (g.nodes.some(x => x.id === "N" + n)) n++; g.nodes.push({ id: "N" + n, name: "New space", area: 20, basis: "GFA", dept: "", zone: "Room", facade: true, ratio: null, level: "" }); seedBubbles(g.nodes); sgCommit(app, f, { nodes: g.nodes }, { replan: true }); } }, "+ Element")));
  return wrap;
}
/** Parking is its own beast: counted in bays, sized by m² per bay, stacked in decks, some to be released for other uses later. */
function sgParkingTable(app, f, g) {
  const wrap = h("div", { class: "sgtable" }), tb = h("tbody");
  const park = g.nodes.filter(n => n.area > 0 && isParking(n));
  const num = v => Math.max(0, Number(String(v).replace(/[, ]/g, "")) || 0);
  const put = () => sgCommit(app, f, { nodes: g.nodes }, { replan: true });
  const pk = nd => (nd.parking = nd.parking || { bays: Math.round(nd.area / PARKING_DEFAULTS.m2PerBay), m2PerBay: PARKING_DEFAULTS.m2PerBay });
  const cell = (nd, k, w, fmt = v => v ?? "") => h("input", { type: "text", value: fmt(pk(nd)[k]), style: { width: w }, "aria-label": `${nd.name} ${k}`, onchange: e => { pk(nd)[k] = e.target.value === "" ? null : num(e.target.value); nd.area = parkingArea(nd.parking); put(); } });
  for (const nd of park) {
    const p = pk(nd), fp = gfaOf(nd) / Math.max(1, nd.storeys || PARKING_DEFAULTS.storeys), rel = p.baysFuture != null && p.bays > p.baysFuture ? (p.bays - p.baysFuture) * (p.m2PerBay || 31) : 0;
    tb.append(h("tr", { class: SGST.sel === nd.id ? "on" : "", onclick: e => { if (e.target.tagName === "TD") { SGST.sel = nd.id; app.refresh({ keepMain: false }); } } },
      h("td", {}, h("span", { class: "mswatch", style: { background: sgColour(nd), borderColor: "#888" } })),
      h("td", { title: "Pack: take part in the packing. Untick to leave this car park out of the plan (its bays still count)" }, packBox(nd, put)), h("td", { class: "mono muted" }, nd.id),
      h("td", {}, h("input", { type: "text", value: nd.name, style: { width: "110px" }, "aria-label": `${nd.id} name`, onchange: e => { nd.name = e.target.value; put(); } })),
      h("td", {}, h("input", { type: "text", value: p.serves || "", style: { width: "60px" }, "aria-label": `${nd.name} serves`, onchange: e => { p.serves = e.target.value; put(); } })),
      h("td", {}, cell(nd, "bays", "52px")), h("td", {}, cell(nd, "baysFuture", "52px")), h("td", {}, cell(nd, "m2PerBay", "34px")),
      h("td", { class: "mono" }, Math.round(nd.area).toLocaleString()),
      h("td", {}, cell(nd, "ev", "40px")), h("td", {}, cell(nd, "evFuture", "40px")),
      h("td", {}, h("input", { type: "text", value: nd.storeys || PARKING_DEFAULTS.storeys, style: { width: "28px" }, "aria-label": `${nd.name} decks`, onchange: e => { nd.storeys = Math.max(1, Math.round(num(e.target.value)) || 1); put(); } })),
      h("td", {}, h("input", { type: "text", value: ((nd.f2f || PARKING_DEFAULTS.f2f) / 1000).toFixed(1), style: { width: "32px" }, "aria-label": `${nd.name} floor to floor in metres`, onchange: e => { nd.f2f = Math.round(num(e.target.value) * 1000) || PARKING_DEFAULTS.f2f; put(); } })),
      h("td", { class: "mono muted", title: "Footprint of one deck" }, Math.round(fp).toLocaleString()),
      h("td", { title: "Decks lifted on pilotis: the ground stays public" }, h("input", { type: "checkbox", checked: !!nd.pilotis, "aria-label": `${nd.name} on pilotis`, onchange: e => { nd.pilotis = e.target.checked; put(); } })),
      h("td", { title: rel ? `${Math.round(rel).toLocaleString()} m² released when the bays drop to ${p.baysFuture}` : "Decks built to convert to other uses (6 m floor-to-floor)" }, h("input", { type: "checkbox", checked: !!p.convertible, "aria-label": `${nd.name} convertible`, onchange: e => { p.convertible = e.target.checked; put(); } }), rel ? h("span", { class: "muted" }, ` ${m2k(rel)}`) : "")));
  }
  // the checks a car park is judged by
  const gla = g.nodes.filter(n => n.basis === "GLA" && n.area > 0).reduce((a, n) => a + +n.area, 0);
  const bays = park.reduce((a, n) => a + ((n.parking && n.parking.bays) || 0), 0), fut = park.reduce((a, n) => a + ((n.parking && (n.parking.baysFuture ?? n.parking.bays)) || 0), 0);
  const ret = park.filter(n => /retail/i.test((n.parking && n.parking.serves) || n.name)).reduce((a, n) => a + n.parking.bays, 0), retF = park.filter(n => /retail/i.test((n.parking && n.parking.serves) || n.name)).reduce((a, n) => a + (n.parking.baysFuture ?? n.parking.bays), 0);
  const ev = park.reduce((a, n) => a + ((n.parking && n.parking.ev) || 0), 0), gfa = park.reduce((a, n) => a + gfaOf(n), 0);
  const sum = h("div", { class: "sgmetrics" }, ...[["Bays day one", bays.toLocaleString()], ["Bays future", fut.toLocaleString()], ["Parking GFA", m2k(gfa)], ["Released later", m2k((bays - fut) * 31)],
    ["Retail ratio", gla ? `${(ret / gla * 100).toFixed(1)} / 100 m²` : "–", gla ? `→ ${(retF / gla * 100).toFixed(1)} future, on ${m2k(gla)} GLA` : ""], ["EV bays", ev ? `${ev.toLocaleString()} (${Math.round(ev / Math.max(1, bays) * 100)}%)` : "–"]].map(([l, v, n]) => h("div", { class: "sgm" }, h("b", {}, v), h("span", {}, l), n ? h("i", {}, n) : "")));
  wrap.append(h("table", {}, h("thead", {}, h("tr", {}, ["", "Pack", "Id", "Car park", "Serves", "Bays", "Future", "m²/bay", "GFA m²", "EV", "EV fut.", "Decks", "F2F m", "Deck m²", "Pilotis", "Convert"].map(x => h("th", {}, x)))), tb), sum,
    h("div", { class: "cellrow", style: { marginTop: "6px" } }, h("button", { class: "btn small", onclick: () => { let n = 1; while (g.nodes.some(x => x.id === "P-" + n)) n++; const parking = { bays: 500, baysFuture: 500, m2PerBay: PARKING_DEFAULTS.m2PerBay, serves: "" }; g.nodes.push({ id: "P-" + n, name: "New car park", use: "parking", basis: "GFA", dept: "Parking", category: "Parking", zone: "Parking", area: parkingArea(parking), parking, storeys: 3, f2f: 6000, facade: false, level: "" }); seedBubbles(g.nodes); sgCommit(app, f, { nodes: g.nodes }, { replan: true }); } }, "+ Car park")));
  return wrap;
}

// ---------------------------------------------------------------- bubble diagram
function sgFitView(pts, W, H, pad = 30) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); if (!xs.length) return { s: 1, x: 0, y: 0 };
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min(Math.max(20, W - 2 * pad) / Math.max(1e-6, x1 - x0), Math.max(20, H - 2 * pad) / Math.max(1e-6, y1 - y0));
  return { s: Math.max(1e-9, s), x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}
function sgEdgeStyle(e) { const [c, dash] = REL_STYLE[e.rel] || (e.w < 0 ? REL_STYLE.SEP : REL_STYLE.ADJ); return { c, dash, lw: e.w < 0 ? 1.4 : 0.6 + (e.s || Math.min(5, e.w * 2)) * 0.45 }; }
function sgBubbleCanvas(app, f, cv, g) {
  const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect(); cv.width = rect.width * dpr; cv.height = rect.height * dpr;
  const ctx = cv.getContext("2d"), W = rect.width, H = rect.height;
  const nodes = g.nodes, edges = g.edges; seedBubbles(nodes);
  const R = nd => Math.sqrt(Math.max(1, nd.area) / Math.PI);
  let view = SGST.bubbleView && SGST.bubbleView.sg === f && SGST.bubbleView.W === W && SGST.bubbleView.n === nodes.length ? SGST.bubbleView : null;
  const refit = () => { const pts = nodes.flatMap(nd => [[nd.x - R(nd), nd.y - R(nd)], [nd.x + R(nd), nd.y + R(nd)]]); view = Object.assign(sgFitView(pts, W, H), { sg: f, W, n: nodes.length }); if (W > 60) SGST.bubbleView = view; };
  if (!view) refit();
  { const ext = nodes.map(nd => [W / 2 + (nd.x - view.x) * view.s, H / 2 - (nd.y - view.y) * view.s]); if (!view.user && ext.some(p => p[0] < -20 || p[0] > W + 20 || p[1] < -20 || p[1] > H + 20) && !SGST.drag) refit(); }
  const X = p => [W / 2 + (p[0] - view.x) * view.s, H / 2 - (p[1] - view.y) * view.s], M = (sx, sy) => [view.x + (sx - W / 2) / view.s, view.y - (sy - H / 2) / view.s];
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  const isCtx = nd => nd.zone === "Context" || !(nd.area > 0);
  const draw = (link) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#fbfbfc"; ctx.fillRect(0, 0, W, H);
    for (const e of edges) {
      const a = byId.get(e.a), b = byId.get(e.b); if (!a || !b) continue; const A = X([a.x, a.y]), B = X([b.x, b.y]), st = sgEdgeStyle(e);
      ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.lineWidth = st.lw; ctx.strokeStyle = st.c; ctx.globalAlpha = 0.75; ctx.setLineDash(st.dash); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    for (const nd of nodes) {
      const c = X([nd.x, nd.y]);
      if (isCtx(nd)) {
        const r = 7; ctx.beginPath(); ctx.moveTo(c[0], c[1] - r); ctx.lineTo(c[0] + r, c[1]); ctx.lineTo(c[0], c[1] + r); ctx.lineTo(c[0] - r, c[1]); ctx.closePath();
        ctx.fillStyle = nd.zone === "Circulation" ? "#ffffff" : "#e3e6ea"; ctx.fill(); ctx.strokeStyle = SGST.sel === nd.id ? "#1d6fd8" : "#5a6474"; ctx.lineWidth = SGST.sel === nd.id ? 2.5 : 1.2; ctx.stroke();
        ctx.fillStyle = "#5a6474"; ctx.font = "italic 10px system-ui"; ctx.textAlign = "left"; ctx.fillText(nd.name + (nd.side ? ` (${nd.side})` : ""), c[0] + 9, c[1] + 3); continue;
      }
      const r = R(nd) * view.s;
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(0.5, r), 0, Math.PI * 2); ctx.fillStyle = sgColour(nd); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = SGST.sel === nd.id ? 3 : nd.facade ? 1.6 : 1; ctx.strokeStyle = SGST.sel === nd.id ? "#1d6fd8" : nd.facade ? "#2b3a4e" : "#8a94a6"; ctx.setLineDash(nd.facade ? [] : [3, 3]); ctx.stroke(); ctx.setLineDash([]);
      if (nd.pinned || nd.lockLevel) { ctx.fillStyle = "#b3261e"; ctx.beginPath(); ctx.arc(c[0] + r * 0.7, c[1] - r * 0.7, 3.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#1b1f24"; ctx.font = `${Math.max(9, Math.min(13, r * 0.4))}px system-ui, sans-serif`; ctx.textAlign = "center";
      ctx.fillText(nd.name.length > 20 ? nd.name.slice(0, 19) + "…" : nd.name, c[0], c[1] + 2); ctx.fillStyle = "#3b4350"; ctx.font = "10px system-ui"; ctx.fillText(`${Math.round(nd.area).toLocaleString()} m²`, c[0], c[1] + 14);
    }
    // key to the lines
    ctx.textAlign = "left"; ctx.font = "10px system-ui"; let y = H - 10;
    for (const [rel, [c, dash]] of Object.entries(REL_STYLE).reverse()) { if (!edges.some(e => (e.rel || (e.w < 0 ? "SEP" : "ADJ")) === rel)) continue; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(8, y - 3); ctx.lineTo(28, y - 3); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#3b4350"; ctx.fillText(rel, 32, y); y -= 13; }
    if (link) { ctx.beginPath(); ctx.moveTo(...link[0]); ctx.lineTo(...link[1]); ctx.strokeStyle = "#1d6fd8"; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); }
  };
  const nodeAt = (sx, sy) => { const p = M(sx, sy); let best = null; for (const nd of nodes) { const d = isCtx(nd) ? Math.hypot(...sub(X([nd.x, nd.y]), [sx, sy])) / view.s : Math.hypot(nd.x - p[0], nd.y - p[1]); const r = isCtx(nd) ? 9 / view.s : R(nd); if (d < r && (!best || d < best.d)) best = { nd, d }; } return best && best.nd; };
  const edgeAt = (sx, sy) => { for (const e of edges) { const a = byId.get(e.a), b = byId.get(e.b); if (!a || !b) continue; const A = X([a.x, a.y]), B = X([b.x, b.y]), d = sub(B, A), L2 = dot(d, d) || 1, t = Math.max(0, Math.min(1, dot(sub([sx, sy], A), d) / L2)); if (dist([sx, sy], add(A, mul(d, t))) < 5 && t > 0.1 && t < 0.9) return e; } return null; };
  let settle = 0, dirty = false;
  const loop = () => {
    const E = relaxBubbles(nodes, edges, 3);
    draw(SGST.drag && SGST.drag.link ? SGST.drag.link : null);
    if (SGST.drag || E > 1e-4 && settle++ < 240) SGST.anim = requestAnimationFrame(loop);
    else if (dirty) { dirty = false; for (const nd of nodes) if (nd.dragPin) { delete nd.dragPin; nd.pinned = false; } sgCommit(app, f, { nodes: nodes.map(nd => Object.assign({}, nd)) }, { replan: true, say: "Bubble diagram changed: re-planned" }); }
  };
  draw();
  const CYCLE = [["ADJ", 3], ["ADJ", 5], ["CONN", 3], ["SEP", 4], null];
  cv.onpointerdown = e => {
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, nd = nodeAt(sx, sy);
    if (!nd) { const ed = edgeAt(sx, sy); if (ed) { const i = CYCLE.findIndex(c => c && c[0] === ed.rel && c[1] === ed.s), next = CYCLE[(i + 1) % CYCLE.length]; if (!next) edges.splice(edges.indexOf(ed), 1); else Object.assign(ed, { rel: next[0], s: next[1], w: relWeight(next[0], next[1]) }); sgCommit(app, f, { edges }, { replan: true, say: next ? `${next[0]} ${next[1]}` : "Link removed" }); return; } SGST.drag = { pan: [sx, sy, view.x, view.y] }; view.user = true; cv.setPointerCapture(e.pointerId); return; }
    cv.setPointerCapture(e.pointerId); SGST.sel = nd.id;
    if (e.shiftKey) SGST.drag = { from: nd, link: [X([nd.x, nd.y]), [sx, sy]] };
    else { SGST.drag = { node: nd, wasPinned: nd.pinned }; nd.pinned = true; nd.dragPin = !SGST.drag.wasPinned; }
    settle = 0; cancelAnimationFrame(SGST.anim); SGST.anim = requestAnimationFrame(loop);
  };
  cv.onpointermove = e => {
    if (!SGST.drag) return; const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (SGST.drag.pan) { const [x0, y0, vx, vy] = SGST.drag.pan; view.x = vx - (sx - x0) / view.s; view.y = vy + (sy - y0) / view.s; draw(); return; }
    if (SGST.drag.node) { const p = M(sx, sy); SGST.drag.node.x = p[0]; SGST.drag.node.y = p[1]; dirty = true; }
    if (SGST.drag.from) SGST.drag.link[1] = [sx, sy];
  };
  cv.onpointerup = e => {
    const d = SGST.drag; SGST.drag = null; if (!d) return;
    if (d.from) { const r = cv.getBoundingClientRect(), to = nodeAt(e.clientX - r.left, e.clientY - r.top); if (to && to !== d.from && !edges.some(x => (x.a === d.from.id && x.b === to.id) || (x.b === d.from.id && x.a === to.id))) { edges.push({ a: d.from.id, b: to.id, rel: "ADJ", s: 3, w: relWeight("ADJ", 3) }); sgCommit(app, f, { edges }, { replan: true, say: `${d.from.name} ↔ ${to.name}: ADJ 3` }); } else draw(); return; }
    if (d.node) { if (!d.wasPinned) d.node.pinned = false; delete d.node.dragPin; settle = 0; }
  };
  cv.ondblclick = e => { const r = cv.getBoundingClientRect(), nd = nodeAt(e.clientX - r.left, e.clientY - r.top); if (nd) { nd.pinned = !nd.pinned; sgCommit(app, f, { nodes }, { build: false, say: nd.pinned ? `${nd.name} pinned` : `${nd.name} free` }); } };
  cv.onwheel = e => { e.preventDefault(); const r = cv.getBoundingClientRect(), before = M(e.clientX - r.left, e.clientY - r.top); view.s *= e.deltaY < 0 ? 1.12 : 1 / 1.12; const after = M(e.clientX - r.left, e.clientY - r.top); view.x += before[0] - after[0]; view.y += before[1] - after[1]; view.user = true; draw(); };
}
/** The programme as shares: one pie per grouping (precinct, retail category, functional adjacency,
 *  unit type, business unit), each in its own colour key, measured by area, GFA, units or frontage. */
function sgPieCanvas(app, f, cv, g) {
  const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect(); cv.width = rect.width * dpr; cv.height = rect.height * dpr;
  const ctx = cv.getContext("2d"), W = rect.width, H = rect.height, z = SGST.paneZoom.pies || 1;
  const measure = SGST.pieMeasure || "area", val = n => measure === "gfa" ? gfaOf(n) : measure === "units" ? n.units || 0 : measure === "frontage" ? n.frontage || 0 : +n.area || 0;
  const retail = n => /retail|leisure|fnb/.test(n.use || "") || n.basis === "GLA";
  const ns = g.nodes.filter(n => n.area > 0 && n.zone !== "Context" && (SGST.pieParking || !isParking(n)) && (SGST.pieRetail === false || retail(n)));
  const unit = measure === "units" ? "" : measure === "frontage" ? " m" : " m²";
  const charts = SG_GROUPINGS.map(([by, title]) => {
    const leg = activeLegend(g.options, g.nodes, by), m = new Map();
    for (const n of ns) { const k = groupKey(n, by), v = val(n); if (!v) continue; const e = m.get(k) || { k, v: 0, colour: legendColour(leg, n, by), label: (leg.find(x => x.key === k) || {}).label || k }; e.v += v; m.set(k, e); }
    return { by, title, parts: [...m.values()].sort((a, b) => b.v - a.v) };
  }).filter(c => c.parts.length > 1 || c.by === SGST.by);
  // as many columns as keep each pie readable in the panel's shape; zoom shows fewer, bigger ones
  const n0 = charts.length, fit = c => Math.min(W / c * 0.45, H / Math.ceil(n0 / c) - 50), best = [1, 2, 3].reduce((a, c) => fit(c) > fit(a) ? c : a, 1);
  const cols = Math.max(1, Math.round(best / z)), rows = Math.ceil(charts.length / cols), cw = W / cols, ch = H / rows;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#fbfbfc"; ctx.fillRect(0, 0, W, H);
  const hits = [];
  charts.forEach((c, i) => {
    const x0 = (i % cols) * cw, y0 = Math.floor(i / cols) * ch, tot = c.parts.reduce((a, p) => a + p.v, 0) || 1;
    const R = Math.max(18, Math.min(cw * 0.22, (ch - 52) / 2)), cx = x0 + 16 + R, cy = y0 + 30 + R;
    ctx.fillStyle = "#1b1f24"; ctx.font = `600 ${Math.round(12.5 * Math.min(1.4, z))}px system-ui`; ctx.textAlign = "left";
    ctx.fillText(`${c.title}${c.by === SGST.by ? "  ●" : ""}`, x0 + 12, y0 + 20);
    let a = -Math.PI / 2;
    for (const p of c.parts) {
      const da = p.v / tot * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a, a + da); ctx.closePath(); ctx.fillStyle = p.colour; ctx.fill(); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
      if (da > 0.35) { const m = a + da / 2; ctx.fillStyle = "#1b1f24"; ctx.font = "600 10.5px system-ui"; ctx.textAlign = "center"; ctx.fillText(`${Math.round(p.v / tot * 100)}%`, cx + Math.cos(m) * R * 0.66, cy + Math.sin(m) * R * 0.66 + 4); }
      hits.push({ cx, cy, R, a0: a, a1: a + da, text: `${c.title} · ${p.label}: ${Math.round(p.v).toLocaleString()}${unit} (${(p.v / tot * 100).toFixed(1)}%)` });
      a += da;
    }
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.strokeStyle = "#8a94a6"; ctx.lineWidth = 0.6; ctx.stroke();
    // the key: swatch, label, share, amount
    const lx = cx + R + 14, fs = Math.max(9.5, Math.min(11.5, (ch - 44) / Math.max(1, c.parts.length) - 3)); ctx.font = `${fs}px system-ui`; ctx.textAlign = "left";
    c.parts.forEach((p, k) => { const y = y0 + 34 + k * (fs + 4); if (y > y0 + ch - 6) return; ctx.fillStyle = p.colour; ctx.fillRect(lx, y - fs + 2, fs, fs); ctx.strokeStyle = "#8a94a6"; ctx.lineWidth = 0.6; ctx.strokeRect(lx, y - fs + 2, fs, fs);
      ctx.fillStyle = "#1b1f24"; const t = `${p.label} ${Math.round(p.v / tot * 100)}%`, room = x0 + cw - lx - fs - 12; let s = t; while (ctx.measureText(s).width > room && s.length > 4) s = s.slice(0, -2); ctx.fillText(s === t ? s : s + "…", lx + fs + 5, y); });
    ctx.fillStyle = "#5a6474"; ctx.font = "10.5px system-ui"; ctx.fillText(`total ${Math.round(tot).toLocaleString()}${unit}`, x0 + 12, Math.min(y0 + ch - 8, cy + R + 16));
  });
  cv.onpointermove = e => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; const hit = hits.find(q => { const d = Math.hypot(x - q.cx, y - q.cy); if (d > q.R) return false; let t = Math.atan2(y - q.cy, x - q.cx); while (t < q.a0) t += Math.PI * 2; return t <= q.a1; }); cv.title = hit ? hit.text : ""; };
  cv.onpointerdown = null; cv.onwheel = null;
}
/** The adjacency matrix: every pair, its relation and strength; groups together, context last. */
function sgMatrixCanvas(app, f, cv, g) {
  const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect(); cv.width = rect.width * dpr; cv.height = rect.height * dpr;
  const ctx = cv.getContext("2d"), W = rect.width, H = rect.height;
  const isCtx = nd => nd.zone === "Context" || !(nd.area > 0);
  const ns = g.nodes.slice().sort((a, b) => isCtx(a) - isCtx(b) || String(a.dept).localeCompare(String(b.dept)) || String(a.id).localeCompare(String(b.id)));
  const idx = new Map(ns.map((n, i) => [n.id, i])), cell = new Map();
  for (const e of g.edges) { if (!idx.has(e.a) || !idx.has(e.b)) continue; cell.set(`${idx.get(e.a)},${idx.get(e.b)}`, e); cell.set(`${idx.get(e.b)},${idx.get(e.a)}`, e); }
  const n = ns.length, z = SGST.matrixZoom || 1, cs = Math.max(4, Math.round(Math.max(6, Math.min(22, Math.floor(Math.min(W - 126, H - 126) / Math.max(1, n)))) * z)), lab = Math.round(118 * Math.min(1.6, Math.max(0.7, z)));
  const draw = (hi) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#fbfbfc"; ctx.fillRect(0, 0, W, H);
    ctx.font = `${Math.max(8, Math.min(11, cs - 2))}px system-ui`;
    const [ox, oy] = SGST.matrixPan || [0, 0]; ctx.translate(-ox, -oy);
    ns.forEach((nd, i) => {
      const y = lab + i * cs, x = lab + i * cs;
      ctx.fillStyle = sgColour(nd); ctx.fillRect(lab - 8, y + 1, 6, cs - 2); ctx.fillRect(x + 1, lab - 8, cs - 2, 6);
      ctx.fillStyle = hi && (hi[0] === i || hi[1] === i) ? "#1d6fd8" : isCtx(nd) ? "#7a828e" : "#1b1f24"; ctx.textAlign = "right"; ctx.fillText((nd.id + " " + nd.name).slice(0, 18), lab - 11, y + cs * 0.72);
      ctx.save(); ctx.translate(x + cs * 0.72, lab - 11); ctx.rotate(-Math.PI / 2); ctx.textAlign = "left"; ctx.fillText((nd.id + " " + nd.name).slice(0, 18), 0, 0); ctx.restore();
    });
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = lab + j * cs, y = lab + i * cs, e = cell.get(`${i},${j}`);
      ctx.fillStyle = i === j ? "#dfe3e8" : e ? (REL_STYLE[e.rel] || (e.w < 0 ? REL_STYLE.SEP : REL_STYLE.ADJ))[0] : (i + j) % 2 ? "#f4f5f7" : "#ffffff";
      ctx.globalAlpha = e ? 0.25 + 0.15 * (e.s || Math.min(5, Math.abs(e.w) * 2)) : 1; ctx.fillRect(x, y, cs - 1, cs - 1); ctx.globalAlpha = 1;
      if (e && cs >= 12) { ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.font = `600 ${Math.min(10, cs - 4)}px system-ui`; ctx.fillText(e.s || "", x + cs / 2, y + cs * 0.7); ctx.font = `${Math.max(8, Math.min(11, cs - 2))}px system-ui`; }
    }
    if (hi) { ctx.strokeStyle = "#1d6fd8"; ctx.lineWidth = 2; ctx.strokeRect(lab + hi[1] * cs, lab + hi[0] * cs, cs - 1, cs - 1); }
  };
  draw();
  cv.onwheel = e => { e.preventDefault(); if (e.ctrlKey || e.metaKey || e.altKey) { SGST.matrixZoom = Math.max(0.3, Math.min(6, (SGST.matrixZoom || 1) * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); app.refresh(); return; } const [ox, oy] = SGST.matrixPan || [0, 0], max = lab + n * cs; SGST.matrixPan = [Math.max(0, Math.min(max, ox + (e.shiftKey ? e.deltaY : e.deltaX))), Math.max(0, Math.min(max, oy + (e.shiftKey ? 0 : e.deltaY)))]; draw(); };
  const at = e => { const [ox, oy] = SGST.matrixPan || [0, 0], r = cv.getBoundingClientRect(), i = Math.floor((e.clientY - r.top + oy - lab) / cs), j = Math.floor((e.clientX - r.left + ox - lab) / cs); return i >= 0 && j >= 0 && i < n && j < n && i !== j ? [i, j] : null; };
  cv.onpointermove = e => { const p = at(e); draw(p); if (p) { const ed = cell.get(`${p[0]},${p[1]}`); cv.title = `${ns[p[0]].name} — ${ns[p[1]].name}: ${ed ? `${ed.rel || (ed.w < 0 ? "SEP" : "ADJ")} ${ed.s || ""}${ed.note ? " · " + ed.note : ""}` : "no relationship"}`; } else cv.title = ""; };
  const CYCLE = [["ADJ", 3], ["ADJ", 5], ["CONN", 3], ["SEP", 4], null];
  cv.onpointerdown = e => {
    const p = at(e); if (!p) return; const a = ns[p[0]].id, b = ns[p[1]].id, edges = g.edges;
    const ed = edges.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a)), i = ed ? CYCLE.findIndex(c => c && c[0] === ed.rel && c[1] === ed.s) : -1, next = CYCLE[(i + 1) % CYCLE.length];
    if (!next) edges.splice(edges.indexOf(ed), 1); else if (ed) Object.assign(ed, { rel: next[0], s: next[1], w: relWeight(next[0], next[1]) }); else edges.push({ a, b, rel: next[0], s: next[1], w: relWeight(next[0], next[1]) });
    sgCommit(app, f, { edges }, { replan: true, say: `${ns[p[0]].name} — ${ns[p[1]].name}: ${next ? next.join(" ") : "none"}` });
  };
}

// ---------------------------------------------------------------- site and plan
function sgLayoutCanvas(app, f, cv, g, plan, site) {
  const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect(); cv.width = rect.width * dpr; cv.height = rect.height * dpr;
  const ctx = cv.getContext("2d"), W = rect.width, H = rect.height;
  const boundary = site.boundary || [];
  const pts = [...boundary, ...(plan && plan.frame ? plan.frame.poly : []), ...(plan && plan.blocks ? plan.blocks.flatMap(b => b.poly) : []), ...(plan && plan.levels ? plan.levels.flatMap(L => L.plate || []) : [])];
  const key = [boundary.length, plan && (plan.mode || (plan.massing ? "plates" : "rooms")), plan && plan.levels ? plan.levels.length : 0, plan && plan.blocks ? plan.blocks.length : 0, W].join("|");
  let view = SGST.layoutView && SGST.layoutView.sg === f && SGST.layoutView.key === key ? SGST.layoutView : null;
  if (!view) { view = Object.assign(sgFitView(pts.length ? pts : [[0, 0], [10000, 10000]], W, H, 24), { sg: f, key }); if (W > 60) SGST.layoutView = view; }
  const X = p => [W / 2 + (p[0] - view.x) * view.s, H / 2 - (p[1] - view.y) * view.s], M = (sx, sy) => [view.x + (sx - W / 2) / view.s, view.y - (sy - H / 2) / view.s];
  const poly = (P, fill, stroke, lw = 1, dash = []) => { if (!P || P.length < 2) return; ctx.beginPath(); P.forEach((p, i) => { const q = X(p); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]); } };
  const byNode = new Map(g.nodes.map(n => [n.id, n]));
  const levelKeys = plan && plan.levels ? plan.levels.map(L => L.key) : [];
  const showLevel = SGST.level !== undefined && levelKeys.includes(SGST.level) ? SGST.level : levelKeys[0];
  const rooms = plan && plan.levels ? (plan.levels.find(L => L.key === showLevel) || { rooms: [] }).rooms : [];
  const attractors = (g.site.attractors || []);
  const label = (poly0, name, sub, fs = 10.5) => {
    const xs = poly0.map(X), c = [xs.reduce((a, p) => a + p[0], 0) / xs.length, xs.reduce((a, p) => a + p[1], 0) / xs.length];
    const w = Math.max(...xs.map(p => p[0])) - Math.min(...xs.map(p => p[0])), hh = Math.max(...xs.map(p => p[1])) - Math.min(...xs.map(p => p[1]));
    ctx.save(); ctx.fillStyle = "#1b1f24"; ctx.textAlign = "center"; ctx.font = `${fs}px system-ui`; const tw = ctx.measureText(name).width, turn = tw > w - 4 && hh > w;
    ctx.translate(c[0], c[1]); if (turn) ctx.rotate(-Math.PI / 2); const room = (turn ? hh : w) - 6;
    if (room > 14) { ctx.fillText(tw > room ? name.slice(0, Math.max(2, Math.floor(name.length * room / Math.max(1, tw)) - 1)) + "…" : name, 0, 0); if (sub) { ctx.fillStyle = "#3b4350"; ctx.font = "9.5px system-ui"; ctx.fillText(sub, 0, 11); } }
    ctx.restore();
  };
  const draw = (hover, dragLine) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#f3f4f0"; ctx.fillRect(0, 0, W, H);
    // attractors as heat: a soft pool of the colour of what they pull
    for (const a of attractors) { const c = X(a.at), r = Math.max(30, 60000 * view.s), nd = a.node ? byNode.get(a.node) : { dept: a.dept, zone: a.zone }, col = sgColour(nd || {}); const gr = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], r); gr.addColorStop(0, col + "aa"); gr.addColorStop(1, col + "00"); ctx.fillStyle = gr; ctx.fillRect(c[0] - r, c[1] - r, 2 * r, 2 * r); }
    poly(boundary, "#ffffffcc", "#1b1f24", 2, [10, 3, 2, 3]);
    if (plan && plan.buildable && site.setbacks && site.setbacks.some(x => x > 0)) poly(plan.buildable, null, "#d0312d", 1, [5, 4]);
    if (plan && plan.mode === "blocks") {
      for (const b of plan.blocks) {
        const col = sgColour(byNode.get(b.id) || b);
        poly(b.poly, b.z0 > 0 ? col + "88" : col, SGST.sel === b.id || hover === b.id ? "#1d6fd8" : "#2b3a4e", SGST.sel === b.id || hover === b.id ? 2.5 : 1, b.z0 > 0 ? [4, 3] : []);
        // the let/net area coloured, the ring out to the gross outline hatched: what efficiency costs
        if (b.core) { poly(b.poly, "#ffffff", null); ctx.save(); ctx.beginPath(); b.poly.forEach((p, i) => { const q = X(p); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.closePath(); ctx.clip(); ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; const q0 = X(b.poly[0]), q2 = X(b.poly[2]); for (let t = Math.min(q0[0], q2[0]) - Math.abs(q2[1] - q0[1]); t < Math.max(q0[0], q2[0]); t += 6) { ctx.beginPath(); ctx.moveTo(t, Math.max(q0[1], q2[1])); ctx.lineTo(t + Math.abs(q2[1] - q0[1]), Math.min(q0[1], q2[1])); ctx.stroke(); } ctx.restore(); poly(b.core, b.z0 > 0 ? col + "88" : col, null); poly(b.poly, null, SGST.sel === b.id || hover === b.id ? "#1d6fd8" : "#2b3a4e", SGST.sel === b.id || hover === b.id ? 2.5 : 1, b.z0 > 0 ? [4, 3] : []); }
        label(b.poly, b.name, `${b.storeys} st · ${Math.round(b.z1 / 1000)} m`);
        if (SGST.sel === b.id) for (const gp of blockGrips(b)) { const q = X(gp.at); ctx.fillStyle = "#1d6fd8"; ctx.fillRect(q[0] - 4, q[1] - 4, 8, 8); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(q[0] - 4, q[1] - 4, 8, 8); }
      }
      for (const c of plan.context || []) { const p = X(c.at); ctx.fillStyle = "#5a6474"; ctx.beginPath(); ctx.moveTo(p[0], p[1] - 6); ctx.lineTo(p[0] + 6, p[1]); ctx.lineTo(p[0], p[1] + 6); ctx.lineTo(p[0] - 6, p[1]); ctx.closePath(); ctx.fill(); ctx.font = "italic 10px system-ui"; ctx.textAlign = "left"; ctx.fillText(c.name || c.id, p[0] + 8, p[1] + 3); }
    } else if (plan && plan.massing) {
      const L = plan.levels.find(x => x.key === showLevel);
      if (L) { poly(L.plate, "#ffffff", "#1b1f24", 2); if (L.core) poly(L.core, "#eef0f3", "#5a6474", 1); poly(L.inner, null, "#8a94a6", 1, [3, 3]); for (const sp of L.spares) poly(sp.poly, "#fff4d6", "#c9a227", 1, [3, 3]); for (const r of L.rooms) { poly(r.poly, sgColour(byNode.get(r.id) || r), r.warn.length ? "#d0312d" : "#2b3a4e", r.warn.length ? 2 : 1); if (hover === r.id || SGST.sel === r.id) poly(r.poly, "rgba(29,111,216,.18)", "#1d6fd8", 2.5); label(r.poly, r.name, `${r.area.toFixed(0)} m²`); } }
    } else if (plan && plan.frame) {
      const L = plan.levels.find(x => x.key === showLevel);
      if (L) { for (const c of L.corridors) poly(c.poly, "#e8eaee", null); for (const sp of L.spares) poly(sp.poly, "#fff4d6", "#c9a227", 1, [3, 3]); for (const r of L.rooms) { poly(r.poly, sgColour(byNode.get(r.id) || r), r.warn.length ? "#d0312d" : "#2b3a4e", r.warn.length ? 2 : 1); if (hover === r.id || SGST.sel === r.id) poly(r.poly, "rgba(29,111,216,.18)", "#1d6fd8", 2.5); label(r.poly, r.name, `${r.area.toFixed(0)} m²`); } poly(plan.frame.poly, null, "#1b1f24", 2.5); }
    }
    for (const a of attractors) { const c = X(a.at); ctx.fillStyle = "#1b1f24"; ctx.beginPath(); ctx.arc(c[0], c[1], 4, 0, Math.PI * 2); ctx.fill(); ctx.font = "600 10px system-ui"; ctx.textAlign = "left"; const nd = a.node && byNode.get(a.node); ctx.fillText(`◎ ${nd ? nd.name : a.dept || a.zone}`, c[0] + 6, c[1] - 6); }
    for (const en of g.site.entries || []) { const p = X(en.at), d = normalise(en.dir || [0, 1]); ctx.fillStyle = "#1d6fd8"; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] - d[0] * 16 + d[1] * 7, p[1] + d[1] * 16 + d[0] * 7); ctx.lineTo(p[0] - d[0] * 16 - d[1] * 7, p[1] + d[1] * 16 - d[0] * 7); ctx.closePath(); ctx.fill(); ctx.font = "600 10px system-ui"; ctx.fillText("ENTRY", p[0] + 10, p[1] + 16); }
    if (dragLine) { ctx.strokeStyle = "#1d6fd8"; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(...dragLine[0]); ctx.lineTo(...dragLine[1]); ctx.stroke(); ctx.setLineDash([]); }
    // scale bar and north
    const m100 = [20, 100, 200, 500, 1000].find(m => m * 1000 * view.s > 60) || 1000; ctx.fillStyle = "#1b1f24"; ctx.fillRect(10, H - 14, m100 * 1000 * view.s, 3); ctx.font = "10px system-ui"; ctx.textAlign = "left"; ctx.fillText(`${m100} m`, 10, H - 18); ctx.fillText("N ↑", W - 28, 16);
    if (levelKeys.length > 1) { ctx.font = "600 11px system-ui"; ctx.fillText(`${(plan.levels.find(L => L.key === showLevel) || {}).name || "Level"} - click here for the next`, 8, 16); }
    if (SGST.entryMode || SGST.attractMode) { ctx.fillStyle = "#1d6fd8"; ctx.font = "600 12px system-ui"; ctx.fillText(SGST.entryMode ? "Click where people arrive" : `Click where you want ${SGST.sel && byNode.get(SGST.sel) ? byNode.get(SGST.sel).name : "the selected element (select it in the table first)"} · Shift: its group · Alt: remove`, 8, H - 30); }
  };
  // a selected block's edge grips: drag one and that side moves; the other side follows so the area holds
  const blockGrips = b => [{ at: [b.x + b.w / 2, b.y], ax: 0, s: 1 }, { at: [b.x - b.w / 2, b.y], ax: 0, s: -1 }, { at: [b.x, b.y + b.d / 2], ax: 1, s: 1 }, { at: [b.x, b.y - b.d / 2], ax: 1, s: -1 }];
  const gripAt = (sx, sy) => { const b = plan && plan.mode === "blocks" && plan.blocks.find(x => x.id === SGST.sel); if (!b) return null; const gp = blockGrips(b).find(q => { const c = X(q.at); return Math.abs(c[0] - sx) < 7 && Math.abs(c[1] - sy) < 7; }); return gp ? { b, gp } : null; };
  const hitAt = (sx, sy) => { const p = M(sx, sy); if (plan && plan.mode === "blocks") return plan.blocks.find(b => pointInPoly(p, b.poly)); return rooms.find(r => pointInPoly(p, r.poly)); };
  draw();
  let drag = null;
  cv.onpointerdown = e => {
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, p = M(sx, sy);
    if (levelKeys.length > 1 && sx < 280 && sy < 22) { const i = levelKeys.indexOf(showLevel); SGST.level = levelKeys[(i + 1) % levelKeys.length]; app.refresh(); return; }
    if (SGST.entryMode) {
      let at = p, dir = [0, 1]; const B = boundary;
      if (B.length >= 3) { let bd = Infinity; const P = ccwPoly(B); P.forEach((a, i) => { const b = P[(i + 1) % P.length], d = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), d) / dot(d, d))), q = add(a, mul(d, t)), dd = dist(p, q); if (dd < bd) { bd = dd; at = q; const u = normalise(d); dir = [-u[1], u[0]]; } }); }
      SGST.entryMode = false; g.site.entries = [{ at: at.map(Math.round), dir }]; sgCommit(app, f, { site: g.site, options: Object.assign({}, g.options, { footprint: null }) }, { replan: true, say: "Entry set: the plan turns to meet it" }); return;
    }
    if (SGST.attractMode) {
      const list = (g.site.attractors || []).slice();
      if (e.altKey) { if (list.length) { list.sort((a, b) => dist(a.at, p) - dist(b.at, p)); list.shift(); } g.site.attractors = list; sgCommit(app, f, { site: g.site }, { replan: true, say: "Attractor removed" }); return; }
      const nd = byNode.get(SGST.sel); if (!nd) return app.say("select an element in the programme table (or a bubble) first", "note");
      list.push(e.shiftKey ? { at: p.map(Math.round), dept: nd.dept, w: 1 } : { at: p.map(Math.round), node: nd.id, w: 1 });
      g.site.attractors = list; sgCommit(app, f, { site: g.site }, { replan: true, say: `${e.shiftKey ? `The ${nd.dept} group` : nd.name} pulled toward that point` }); return;
    }
    const grip = gripAt(sx, sy); if (grip) { drag = { grip, from: [sx, sy] }; cv.setPointerCapture(e.pointerId); return; }
    const hit = hitAt(sx, sy); if (hit) { drag = { hit, from: [sx, sy] }; SGST.sel = hit.id; cv.setPointerCapture(e.pointerId); } else drag = { pan: [sx, sy, view.x, view.y] };
  };
  cv.onpointermove = e => {
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (drag && drag.pan) { const [x0, y0, vx, vy] = drag.pan; view.x = vx - (sx - x0) / view.s; view.y = vy + (sy - y0) / view.s; draw(); return; }
    if (drag && drag.grip) { const { b, gp } = drag.grip, p = M(sx, sy), A = b.w * b.d, far = gp.ax === 0 ? b.x - gp.s * b.w / 2 : b.y - gp.s * b.d / 2, len = Math.max(4000, Math.abs((gp.ax === 0 ? p[0] : p[1]) - far)), other = A / len;
      drag.size = gp.ax === 0 ? [len, other] : [other, len]; const c = gp.ax === 0 ? [far + gp.s * len / 2, b.y] : [b.x, far + gp.s * len / 2], [w, d] = drag.size;
      draw(null); ctx.setLineDash([5, 3]); poly([[c[0] - w / 2, c[1] - d / 2], [c[0] + w / 2, c[1] - d / 2], [c[0] + w / 2, c[1] + d / 2], [c[0] - w / 2, c[1] + d / 2]], "#1d6fd822", "#1d6fd8", 2, [5, 3]); ctx.setLineDash([]);
      drag.at = c; cv.title = `${b.name}: ${(w / 1000).toFixed(1)} × ${(d / 1000).toFixed(1)} m - ${Math.round(A / 1e6).toLocaleString()} m² kept`; return; }
    const over = hitAt(sx, sy); draw(over && over.id, drag && drag.hit ? [drag.from, [sx, sy]] : null);
    cv.title = over ? (over.storeys ? `${over.name} · ${Math.round(over.area).toLocaleString()} m² · ${over.storeys} storeys × ${(over.f2f / 1000).toFixed(1)} m · footprint ${Math.round(over.footprint).toLocaleString()} m²` : `${over.name} · ${over.area.toFixed(1)} m² (asked ${over.target})${over.warn && over.warn.length ? " · " + over.warn.join("; ") : ""}`) : "";
  };
  cv.onpointerup = e => {
    const d = drag; drag = null;
    if (d && d.grip && d.size) { const nd = g.nodes.find(n => n.id === d.grip.b.id); if (nd) { nd.blockW = Math.round(d.size[0]); const list = (g.site.attractors || []).filter(a => a.node !== nd.id); list.push({ at: d.at.map(Math.round), node: nd.id, w: 1, exact: true }); g.site.attractors = list; sgCommit(app, f, { nodes: g.nodes, site: g.site }, { replan: true, say: `${nd.name} reshaped to ${(d.size[0] / 1000).toFixed(1)} × ${(d.size[1] / 1000).toFixed(1)} m - same area; the rest re-packed` }); } return; }
    if (!d || !d.hit) return;
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (plan && plan.mode === "blocks") {
      if (dist(d.from, [sx, sy]) < 4) { app.refresh({ keepMain: false }); return; }
      // a block dropped somewhere: that is where it is wanted - an attractor for it
      const p = M(sx, sy), list = (g.site.attractors || []).filter(a => a.node !== d.hit.id); list.push({ at: p.map(Math.round), node: d.hit.id, w: 1, exact: true, wd: [Math.round(d.hit.w), Math.round(d.hit.d)] });
      g.site.attractors = list; sgCommit(app, f, { site: g.site }, { replan: true, say: `${d.hit.name} put there: it stays, the rest re-packed around it (Alt-click its ◎ in Attractor mode to free it)` }); return;
    }
    const to = hitAt(sx, sy);
    if (to && to.id !== d.hit.id) { const res = app.apply({ op: "sgswap", id: app.doc.idOf(f), a: d.hit.id, b: to.id }); if (res.ok) app.say(`${d.hit.name} ⇄ ${to.name}: each takes the other's slot, widths follow the areas`, "ok"); }
    else app.refresh();
  };
  cv.onwheel = e => { e.preventDefault(); const r = cv.getBoundingClientRect(), before = M(e.clientX - r.left, e.clientY - r.top); view.s *= e.deltaY < 0 ? 1.15 : 1 / 1.15; const after = M(e.clientX - r.left, e.clientY - r.top); view.x += before[0] - after[0]; view.y += before[1] - after[1]; draw(); };
}

// ---------------------------------------------------------------- site analysis
//! A quick reading of the plot before any design: its edges and their lengths, its area against what
//! the brief asks to put on it, what lies around it (stations, promenades, the districts beyond) and
//! how far, walking radii from the stations, the sun's path at its latitude and the prevailing wind.
const SG_LATITUDE = 24.6; // Qiddiya
function sunPath(lat, decl) {
  const out = [], L = lat * Math.PI / 180, d = decl * Math.PI / 180;
  for (let hr = -12; hr <= 12; hr += 0.25) {
    const H = hr * 15 * Math.PI / 180, alt = Math.asin(Math.sin(L) * Math.sin(d) + Math.cos(L) * Math.cos(d) * Math.cos(H));
    if (alt < 0) continue;
    const az = Math.atan2(-Math.sin(H), Math.tan(d) * Math.cos(L) - Math.sin(L) * Math.cos(H));  // from south, +west
    out.push({ alt: alt * 180 / Math.PI, az: (az * 180 / Math.PI + 180) % 360 });                // from north, clockwise
  }
  return out;
}
function sgSiteCanvas(app, f, cv, g, plan, site) {
  const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect(); cv.width = rect.width * dpr; cv.height = rect.height * dpr;
  const ctx = cv.getContext("2d"), W = rect.width, H = rect.height;
  const B = site.boundary || [], ctxNodes = g.nodes.filter(n => n.side);
  const bb = B.length ? [Math.min(...B.map(p => p[0])), Math.min(...B.map(p => p[1])), Math.max(...B.map(p => p[0])), Math.max(...B.map(p => p[1]))] : [-150000, -150000, 150000, 150000];
  const C = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], span = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
  let view = SGST.siteView && SGST.siteView.sg === f && SGST.siteView.W === W && SGST.siteView.H === H ? SGST.siteView : null;
  if (!view) { const pad = span * 0.45; view = Object.assign(sgFitView([[bb[0] - pad, bb[1] - pad * 0.7], [bb[2] + pad, bb[3] + pad * 0.7]], W, H, 16), { sg: f, W, H }); if (W > 60) SGST.siteView = view; }
  const X = p => [W / 2 + (p[0] - view.x) * view.s, H / 2 - (p[1] - view.y) * view.s], M = (sx, sy) => [view.x + (sx - W / 2) / view.s, view.y - (sy - H / 2) / view.s];
  const fnLeg = activeLegend(g.options, g.nodes, "fn"), colOf = (key, dflt) => (fnLeg.find(e => e.key === key) || {}).colour || dflt;
  const box = (x, y, text, fill, stroke = "#2b3a4e") => { ctx.font = "600 11px system-ui"; const w = ctx.measureText(text).width + 12; ctx.fillStyle = fill; ctx.fillRect(x - w / 2, y - 10, w, 20); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, y - 10, w, 20); ctx.fillStyle = "#1b1f24"; ctx.textAlign = "center"; ctx.fillText(text, x, y + 4); };
  const arrow = (a, b, col, lw = 2) => { ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); const d = normalise(sub(b, a)), n = [-d[1], d[0]]; ctx.beginPath(); ctx.moveTo(...b); ctx.lineTo(...add(add(b, mul(d, -10)), mul(n, 5))); ctx.lineTo(...add(add(b, mul(d, -10)), mul(n, -5))); ctx.closePath(); ctx.fill(); };
  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#f6f5ef"; ctx.fillRect(0, 0, W, H);
    const dirs = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };
    const edgeOut = d => Math.max(...(B.length ? B : [[bb[0], bb[1]], [bb[2], bb[3]]]).map(p => (p[0] - C[0]) * d[0] + (p[1] - C[1]) * d[1]));
    // what is around: promenades as bands out to their length, stations and destinations as labelled boxes
    const placed = [];
    for (const n of ctxNodes) {
      const d = dirs[n.side]; if (!d) continue; const e = edgeOut(d), far = (n.far || 0) * 1000;
      if (/pulse|promenade|realm/i.test(n.name)) {
        const len = Math.max(far * 2, 650000), w = 30000, a = add(C, mul(d, e)), b = add(C, mul(d, e + len)), nrm = [-d[1], d[0]];
        const P = [add(a, mul(nrm, w / 2)), add(b, mul(nrm, w / 2)), add(b, mul(nrm, -w / 2)), add(a, mul(nrm, -w / 2))].map(X);
        ctx.beginPath(); P.forEach((q, i) => i ? ctx.lineTo(...q) : ctx.moveTo(...q)); ctx.closePath(); ctx.fillStyle = colOf("District Public Realm", "#c1e0ad"); ctx.fill(); ctx.strokeStyle = "#7da66a"; ctx.lineWidth = 1; ctx.stroke();
        const m = X(add(C, mul(d, e + Math.min(len, 260000) / 2))); ctx.fillStyle = "#2f5323"; ctx.font = "600 11px system-ui"; ctx.textAlign = "center"; ctx.fillText(`${n.name} · ${Math.round(len / 1000)} m`, m[0], m[1] - (d[1] ? 0 : 20)); continue;
      }
      const at = add(C, mul(d, e + (far || 45000))), q = X(at), cl = [Math.max(60, Math.min(W - 60, q[0])), Math.max(20, Math.min(H - 20, q[1]))];
      const off = placed.filter(p => Math.hypot(p[0] - cl[0], p[1] - cl[1]) < 26).length; cl[1] += off * 24; placed.push(cl);
      const clipped = cl[0] !== q[0] || cl[1] - off * 24 !== q[1];
      box(cl[0], cl[1], `${n.name}${far ? ` · ${Math.round(far / 1000)} m ${n.side}` : ""}${clipped ? " →" : ""}${n.locked ? " 🔒" : ""}`, /station|pua|sua/i.test(n.name) ? colOf("PUA / SUA", "#ffffff") : "#eef0f3");
      if (/station|pua|sua/i.test(n.id + n.name)) { const s = X(add(C, mul(d, e + 20000))); ctx.setLineDash([5, 4]); ctx.strokeStyle = "#1d6fd8"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(s[0], s[1], 400000 * view.s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#1d6fd8"; ctx.font = "10px system-ui"; ctx.textAlign = "left"; ctx.fillText("400 m · 5 min walk", s[0] + 400000 * view.s * 0.72, s[1] - 400000 * view.s * 0.72); arrow([cl[0], cl[1] - d[1] * 12 * -1 + (d[1] ? d[1] * 22 : 0)], X(add(C, mul(d, e))), "#1d6fd8"); }
    }
    // the plot: its edges measured
    if (B.length >= 3) {
      ctx.beginPath(); B.forEach((p, i) => { const q = X(p); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.closePath(); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#1b1f24"; ctx.lineWidth = 2; ctx.setLineDash([12, 3, 2, 3]); ctx.stroke(); ctx.setLineDash([]);
      if (plan && plan.buildable && (site.setbacks || []).some(x => x > 0)) { ctx.beginPath(); plan.buildable.forEach((p, i) => { const q = X(p); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.closePath(); ctx.strokeStyle = "#d0312d"; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]); }
      const P = ccwPoly(B); ctx.font = "10px system-ui"; ctx.fillStyle = "#3b4350";
      P.forEach((a, i) => { const b = P[(i + 1) % P.length], L = dist(a, b); if (L < 20000 || L * view.s < 40) return; const m = X(mul(add(a, b), 0.5)), d = normalise(sub(b, a)), o = [d[1], d[0]]; ctx.save(); ctx.translate(m[0] + o[0] * 12, m[1] + o[1] * 12); let ang = -Math.atan2(d[1], d[0]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI; ctx.rotate(ang); ctx.textAlign = "center"; ctx.fillText(`${(L / 1000).toFixed(1)} m`, 0, 3); ctx.restore(); });
    }
    for (const en of g.site.entries || []) { const p = X(en.at); ctx.fillStyle = "#1d6fd8"; ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.fill(); ctx.font = "600 10px system-ui"; ctx.textAlign = "left"; ctx.fillText("entry", p[0] + 7, p[1] + 4); }
    // the figures: the plot against what the brief puts on it
    const area = B.length >= 3 ? Math.abs(B.reduce((a, p, i) => { const q = B[(i + 1) % B.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2) / 1e6 : g.site.area || 0;
    const per = B.length >= 3 ? B.reduce((a, p, i) => a + dist(p, B[(i + 1) % B.length]), 0) / 1000 : 0;
    const prog = g.nodes.filter(n => n.area > 0 && n.zone !== "Context"), gfaP = prog.filter(n => !isParking(n)).reduce((a, n) => a + gfaOf(n), 0), gfaK = prog.filter(isParking).reduce((a, n) => a + gfaOf(n), 0);
    const gla = prog.filter(n => n.basis === "GLA").reduce((a, n) => a + +n.area, 0);
    const lines = [["Plot (from the client's lines)", `${Math.round(area).toLocaleString()} m²`], ["Perimeter", `${Math.round(per).toLocaleString()} m`], ["Developable (brief)", g.site.developable ? `${Math.round(g.site.developable).toLocaleString()} m²` : "–"],
      ["Retail GLA", `${Math.round(gla).toLocaleString()} m²`], ["Programme GFA", `${Math.round(gfaP).toLocaleString()} m²`], ["Parking GFA", `${Math.round(gfaK).toLocaleString()} m²`],
      ["FAR needed (with parking)", area ? ((gfaP + gfaK) / area).toFixed(2) : "–"], ["Coverage if 2 trading levels", area ? `${Math.round(gla / 0.85 / 2 / area * 100)}%` : "–"]];
    ctx.fillStyle = "#ffffffe6"; ctx.fillRect(8, 8, 238, 18 + lines.length * 15); ctx.strokeStyle = "#c8ccd2"; ctx.strokeRect(8, 8, 238, 18 + lines.length * 15);
    ctx.fillStyle = "#1b1f24"; ctx.font = "600 11.5px system-ui"; ctx.textAlign = "left"; ctx.fillText("Site analysis", 14, 22);
    lines.forEach(([k, v], i) => { ctx.font = "10.5px system-ui"; ctx.fillStyle = "#3b4350"; ctx.textAlign = "left"; ctx.fillText(k, 14, 38 + i * 15); ctx.fillStyle = "#1b1f24"; ctx.font = "600 10.5px system-ui"; ctx.textAlign = "right"; ctx.fillText(v, 240, 38 + i * 15); });
    // sun path at this latitude (stereographic-ish: centre = zenith), and the wind
    const R = Math.min(62, W * 0.1), sc = [W - R - 16, H - R - 30];
    ctx.strokeStyle = "#8a94a6"; ctx.lineWidth = 0.8; ctx.fillStyle = "#ffffffd9"; ctx.beginPath(); ctx.arc(sc[0], sc[1], R, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(sc[0], sc[1], R * 2 / 3, 0, Math.PI * 2); ctx.arc(sc[0], sc[1], R / 3, 0, Math.PI * 2); ctx.stroke();
    const sp = p => { const r = (90 - p.alt) / 90 * R, a = p.az * Math.PI / 180; return [sc[0] + Math.sin(a) * r, sc[1] - Math.cos(a) * r]; };
    for (const [decl, col, lab] of [[23.44, "#e8633b", "21 Jun"], [0, "#e8a23b", "equinox"], [-23.44, "#5b8fd6", "21 Dec"]]) { const pts = sunPath(SG_LATITUDE, decl).map(sp); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(...q) : ctx.moveTo(...q)); ctx.stroke(); const lo = pts[Math.floor(pts.length / 2)]; ctx.fillStyle = col; ctx.font = "9px system-ui"; ctx.textAlign = "center"; ctx.fillText(lab, lo[0], lo[1] + (decl < 0 ? 11 : -4)); }
    ctx.fillStyle = "#1b1f24"; ctx.font = "600 10px system-ui"; ctx.textAlign = "center"; ctx.fillText("N", sc[0], sc[1] - R - 4); ctx.fillText(`Sun path · ${SG_LATITUDE}° N`, sc[0], sc[1] + R + 14);
    const wd = normalise([1, -1]), ws = [sc[0] - R - 70, sc[1] - R + 4]; arrow(ws, add(ws, mul(wd, 44)), "#4fb3bf", 3); ctx.fillStyle = "#2a7f89"; ctx.font = "10px system-ui"; ctx.textAlign = "left"; ctx.fillText("Prevailing wind NW (shamal)", ws[0] - 30, ws[1] - 8); ctx.fillStyle = "#7a828e"; ctx.fillText("assumed - verify with site data", ws[0] - 30, ws[1] + 58);
    // north and scale
    ctx.fillStyle = "#1b1f24"; ctx.font = "600 12px system-ui"; ctx.textAlign = "center"; ctx.fillText("N ↑", W - 22, 20);
    const m100 = [50, 100, 200, 500, 1000].find(m => m * 1000 * view.s > 70) || 1000; ctx.fillRect(12, H - 14, m100 * 1000 * view.s, 3); ctx.font = "10px system-ui"; ctx.textAlign = "left"; ctx.fillText(`${m100} m`, 12, H - 18);
  };
  draw();
  let drag = null;
  cv.onpointerdown = e => { const r = cv.getBoundingClientRect(); drag = [e.clientX - r.left, e.clientY - r.top, view.x, view.y]; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = e => { if (!drag) return; const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top; view.x = drag[2] - (sx - drag[0]) / view.s; view.y = drag[3] + (sy - drag[1]) / view.s; view.user = true; draw(); };
  cv.onpointerup = () => { drag = null; };
  cv.onwheel = e => { e.preventDefault(); const r = cv.getBoundingClientRect(), before = M(e.clientX - r.left, e.clientY - r.top); view.s *= e.deltaY < 0 ? 1.15 : 1 / 1.15; const after = M(e.clientX - r.left, e.clientY - r.top); view.x += before[0] - after[0]; view.y += before[1] - after[1]; view.user = true; draw(); };
}

/** The figures and colour keys on one panel, for a sheet. */
function sgSummaryCanvas(app, f, cv, g, plan) {
  const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect(); cv.width = rect.width * dpr; cv.height = rect.height * dpr;
  const ctx = cv.getContext("2d"), W = rect.width, H = rect.height; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  const M = (plan && plan.metrics) || {}, m2 = v => v == null ? "–" : `${Math.round(v).toLocaleString()} m²`;
  const rows = [["Retail GLA", m2(M.gla)], ["Units", M.units ? M.units.toLocaleString() : "–"], ["Frontage", M.frontage ? `${Math.round(M.frontage).toLocaleString()} m` : "–"], ["Programme GFA", m2(M.programGfa)], ["Parking", M.bays ? `${M.bays.toLocaleString()} bays · ${m2(M.parkingGfa)}` : "–"], ["Site", m2(M.site)], ["FAR", M.far ? M.far.toFixed(2) : "–"], ["Coverage", M.coverage ? `${Math.round(M.coverage * 100)}%` : "–"], ["Adjacencies met", M.adjacency != null ? `${Math.round(M.adjacency * 100)}%` : "–"]];
  ctx.fillStyle = "#1b1f24"; ctx.font = "600 15px system-ui"; ctx.textAlign = "left"; ctx.fillText("Programme and first massing attempt", 16, 26);
  rows.forEach(([k, v], i) => { const y = 52 + i * 19; ctx.font = "12px system-ui"; ctx.fillStyle = "#3b4350"; ctx.textAlign = "left"; ctx.fillText(k, 16, y); ctx.font = "600 12px system-ui"; ctx.fillStyle = "#1b1f24"; ctx.textAlign = "right"; ctx.fillText(v, W * 0.46, y); });
  // the colour keys: the client's two schemes and the precincts
  let x = W * 0.52, y = 26;
  for (const [by, title] of [["fn", "Functional adjacencies"], ["category", "Retail categories"], ["dept", "Precincts"]]) {
    const leg = activeLegend(g.options, g.nodes, by); if (!leg.length) continue;
    if (y + 20 + leg.length * 15 > H) { x += W * 0.25; y = 26; }
    ctx.fillStyle = "#1b1f24"; ctx.font = "600 12px system-ui"; ctx.textAlign = "left"; ctx.fillText(title, x, y); y += 16;
    for (const e of leg) { ctx.fillStyle = e.colour; ctx.fillRect(x, y - 10, 18, 11); ctx.strokeStyle = "#8a94a6"; ctx.lineWidth = 0.6; ctx.strokeRect(x, y - 10, 18, 11); ctx.fillStyle = "#1b1f24"; ctx.font = "11px system-ui"; ctx.fillText(`${e.label}  #${e.colour.replace("#", "")}`, x + 24, y); y += 15; }
    y += 10;
  }
}

// ---------------------------------------------------------------- diagrams on sheets
//! A sheet can carry the analysis's diagrams: each drawn from the space graph as it is now, at its
//! size on paper, and drawn again whenever the graph changes - never a stale picture.
const SG_SHEET_CACHE = new Map();
export const SG_SHEET_KINDS = { bubbles: "Bubble diagram", matrix: "Adjacency matrix", pies: "Programme shares", site: "Site analysis", plan: "First massing attempt", summary: "Programme summary" };
export function sheetDiagramUrl(app, doc, im) {
  const d = im.diagram || {}, f = doc.element(d.sg || "") || sgOf(app)[0]; if (!f || typeof document === "undefined") return null;
  const g = sgRead(app, f), site = effectiveSite(doc, f), pxmm = 3.2, w = Math.round(im.rect[2] * pxmm), hh = Math.round(im.rect[3] * pxmm);
  const key = [d.kind, d.by || "", d.measure || "", w, hh, JSON.stringify([g.nodes, g.edges, g.options, site.boundary, site.setbacks, g.site])].join("|");
  let k2 = 0; for (let i = 0; i < key.length; i++) k2 = (k2 * 31 + key.charCodeAt(i)) | 0;
  if (SG_SHEET_CACHE.has(k2)) return SG_SHEET_CACHE.get(k2);
  const keep = { by: SGST.by, legend: SGST.legend, bubbleView: SGST.bubbleView, layoutView: SGST.layoutView, siteView: SGST.siteView, sel: SGST.sel, pieMeasure: SGST.pieMeasure, pieParking: SGST.pieParking, pieRetail: SGST.pieRetail, matrixZoom: SGST.matrixZoom, matrixPan: SGST.matrixPan, pz: SGST.paneZoom.pies, level: SGST.level, drag: SGST.drag, anim: SGST.anim };
  const holder = h("div", { style: { position: "fixed", left: "-20000px", top: "0", width: w + "px", height: hh + "px", display: "flex" } }), cv = h("canvas", { style: { width: w + "px", height: hh + "px", display: "block" } });
  holder.append(cv); document.body.append(holder);
  let url = null;
  try {
    Object.assign(SGST, { by: d.by || g.options.colourBy || "dept", bubbleView: null, layoutView: null, siteView: null, sel: null, pieMeasure: d.measure || "area", pieParking: false, pieRetail: true, matrixZoom: 1, matrixPan: [0, 0], level: undefined, drag: null }); SGST.paneZoom.pies = 1;
    SGST.legend = activeLegend(g.options, g.nodes, SGST.by);
    let plan = null; try { plan = planSpaceGraph(Object.assign({}, g, { site }), { relax: false, storeys: massingStoreys(doc, f) }); } catch (e) { /* drawn without */ }
    if (d.kind === "summary") sgSummaryCanvas(app, f, cv, g, plan); else sgDraw(app, f, d.kind, cv, g, plan, site);
    cancelAnimationFrame(SGST.anim);
    url = cv.toDataURL("image/jpeg", 0.9);
  } catch (e) { console.error(e); }
  finally { holder.remove(); Object.assign(SGST, keep); SGST.paneZoom.pies = keep.pz; }
  if (SG_SHEET_CACHE.size > 60) SG_SHEET_CACHE.clear();
  SG_SHEET_CACHE.set(k2, url); return url;
}

/** The A1 sheet of the analysis: made once, then kept - its diagrams redraw themselves as the graph changes. */
function sgDiagramSheet(app, f) {
  const doc = app.doc, id = doc.idOf(f), have = doc.elements().find(x => doc.typeOf(x) === "Sheet" && (doc.argValue(x, "diagrams") || []).some(d => d.diagram && d.diagram.sg === id));
  const diagrams = diagramSheetLayout().map(d => Object.assign(d, { diagram: Object.assign({ sg: id }, d.diagram) }));
  const r = have ? app.apply({ op: "set", id: doc.idOf(have), key: "diagrams", value: diagrams })
    : app.apply({ op: "add", element: { type: "Sheet", name: "A-001 Brief Analysis", args: { number: "A-001", sheetName: "Brief Analysis", size: "A1", orientation: "landscape", viewports: [], revision: "P01", diagrams } } });
  if (!r.ok) return app.say(r.error, "error");
  const sid = have ? doc.idOf(have) : r.id; app.openView(sid); app.say("A1 sheet: site analysis, bubbles, matrix, shares, the massing attempt and the figures - they redraw as the graph changes", "ok");
}
