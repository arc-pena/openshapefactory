//! The Space Graph workspace: the program as a table, the graph as a bubble diagram that relaxes as
//! you drag it, and the site with its setbacks, entry and packed plan beside it. Every edit is one op
//! on the SpaceGraph element (undoable), and - with Rebuild on change - one sgbuild after it, so the
//! walls, slab, rooms and doors in the model follow the graph.

import { h, clear, dialog, fmtLen } from "./ui_util.js";
import { parseLength } from "./units.js";
import { F } from "./ocaf.js";
import { planSpaceGraph, relaxBubbles, seedBubbles, programFromBrief, programFromWorkbook, programFromRows, readXlsx, readCsv, ccwPoly, SG_DEFAULTS, defaultLegend, legendColour, relWeight } from "./spacegraph.js";
import { effectiveSite, massingStoreys } from "./ops.js";
import { parseOBJ, parseSTL, meshFromKernel, packMesh, meshBox, levelsIn, placeMesh } from "./massing.js";
import { readDXF, dxfDrawing } from "./dxf.js";
import { weld, regionsOf } from "./bimsketch.js";
import { dist, sub, add, mul, dot, normalise, pointInPoly } from "./geom2d.js";

const SG_ZONES = ["Room", "Entry", "BOH", "Circulation", "Tower", "Parking", "Context"];
const SGST = { sg: null, bubbleView: null, layoutView: null, anim: 0, drag: null, entryMode: false, attractMode: false, sel: null, midTab: "bubbles", legend: [], level: undefined };
/** A node's colour, from the analysis's legend. */
const sgColour = nd => legendColour(SGST.legend, nd || {});
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
  SGST.legend = g.options.legend && g.options.legend.length ? g.options.legend : defaultLegend(g.nodes);
  const site = effectiveSite(doc, f), storeys = massingStoreys(doc, f);
  let plan = null; try { plan = planSpaceGraph(Object.assign({}, g, { site }), { relax: false, storeys }); } catch (e) { app.say(`planning: ${e.message}`, "error"); }
  const mode = plan ? plan.mode || (plan.massing ? "plates" : "rooms") : "—";
  const modeSel = h("select", { "aria-label": "Planning mode", title: "How the brief is planned", onchange: e => { const o = Object.assign({}, g.options, { mode: e.target.value }); sgCommit(app, f, { options: o }, { replan: true, say: `Planning as ${e.target.selectedOptions[0].textContent}` }); } },
    [["auto", "Auto"], ["blocks", "Blocks (massing study)"], ["rooms", "Rooms (corridor)"], ["plates", "Rooms on massing plates"]].map(([v, l]) => h("option", { value: v, selected: (g.options.mode || "auto") === v }, l)));
  bar.append(
    grp(h("b", { class: "sgtitle" }, "Site"), btn("Plot from DXF…", () => importSite(app), "The client's plot lines: the largest closed loop in a DXF becomes the Site Boundary"), btn("Rectangle…", () => sgSiteRect(app)), btn("Setbacks…", () => sgSetbacks(app, f)),
      h("button", { class: "btn small" + (SGST.entryMode ? " primary" : ""), title: "Click the plot edge where people arrive", onclick: () => { SGST.entryMode = !SGST.entryMode; SGST.attractMode = false; app.refresh(); } }, SGST.entryMode ? "Click the entry…" : "Entry"),
      h("button", { class: "btn small" + (SGST.attractMode ? " primary" : ""), title: "Click the plan where you want the selected space (Shift: its whole group); Alt-click removes the nearest point", onclick: () => { SGST.attractMode = !SGST.attractMode; SGST.entryMode = false; app.refresh(); } }, SGST.attractMode ? "Click to attract…" : "Attractor")),
    grp(h("b", { class: "sgtitle" }, "Massing"), btn("Import…", () => importMassing(app), "The envelope: OBJ, STL, or STEP (read by OpenCascade)"), btn("Levels…", () => levelsDialog(app), "Lay levels through the massing at an ideal floor-to-floor")),
    grp(h("b", { class: "sgtitle" }, "Plan"), modeSel, btn("Packing…", () => sgOptions(app, f)), btn("Replan", () => sgCommit(app, f, {}, { replan: true, build: true, say: "Replanned from the graph" }), "Re-plan from the bubble diagram (clears swaps)"),
      btn("Build", () => { const r = app.apply({ op: "sgbuild", id }); if (r.ok && r.said) app.say(r.said, "ok"); }, "Build or rebuild the model", true),
      h("label", { class: "cellrow", title: "Rebuild the model whenever the graph changes" }, h("input", { type: "checkbox", checked: F.bool(f, "auto") !== false, onchange: e => app.apply({ op: "set", id, key: "auto", value: e.target.checked }) }), " Auto"),
      btn("Plan view", () => { const lv = F.refId(f, "level"); const pv = doc.elements().find(v => doc.typeOf(v) === "PlanView" && F.refId(v, "level") === lv); if (pv) app.openView(doc.idOf(pv)); }), btn("3D", () => { const v3 = doc.elements().find(v => doc.typeOf(v) === "View3D"); if (v3) app.openView(doc.idOf(v3)); })));
  const table = sgProgramTable(app, f, g, plan), legend = sgLegendPanel(app, f, g);
  const mid = h("canvas", { class: "sgcanvas", "aria-label": SGST.midTab === "matrix" ? "Adjacency matrix" : "Bubble diagram" });
  const tabs = h("span", { class: "sgtabs" }, [["bubbles", "Bubbles"], ["matrix", "Adjacency matrix"]].map(([k, l]) => h("button", { class: "vvtab" + (SGST.midTab === k ? " on" : ""), onclick: () => { SGST.midTab = k; app.refresh(); } }, l)));
  const layout = h("canvas", { class: "sgcanvas", "aria-label": "Site and plan" });
  const metrics = sgMetrics(plan);
  const rep = h("div", { class: "sgreport" }, plan ? plan.report.slice(0, 40).map(r => h("div", {}, "⚠ " + r)) : null);
  const nProg = g.nodes.filter(n => n.area > 0 && n.zone !== "Context").length;
  root.append(h("div", { class: "sgws" }, bar, h("div", { class: "sggrid" },
    h("section", { class: "sgpane" }, h("header", {}, "Programme", h("span", { class: "muted" }, ` ${nProg} elements · ${Math.round(g.nodes.reduce((a, n) => a + (+n.area || 0), 0)).toLocaleString()} m² · ${g.edges.length} relationships`)), table, legend),
    h("section", { class: "sgpane" }, h("header", {}, tabs, h("span", { class: "muted" }, SGST.midTab === "matrix" ? " click a cell to cycle ADJ → CONN → SEP → none" : " drag · Shift-drag to link · click a link to cycle it · double-click to pin")), mid),
    h("section", { class: "sgpane" }, h("header", {}, `Plan · ${mode}`, h("span", { class: "muted" }, mode === "blocks" ? " drag a block to where you want it (it becomes an attractor)" : " drag a room onto another to swap them")), layout, metrics, rep))));
  requestAnimationFrame(() => {
    try { sgLayoutCanvas(app, f, layout, g, plan, site); } catch (e) { console.error(e); app.say(`site plan: ${e.message}`, "error"); }
    try { if (SGST.midTab === "matrix") sgMatrixCanvas(app, f, mid, g); else sgBubbleCanvas(app, f, mid, g); } catch (e) { console.error(e); app.say(`diagram: ${e.message}`, "error"); }
  });
}
/** The figures that say how the attempt performs. */
function sgMetrics(plan) {
  const box = h("div", { class: "sgmetrics" }); if (!plan || !plan.metrics && !plan.levels) return box;
  const M = plan.metrics || {}, k = (label, v, note) => box.append(h("div", { class: "sgm" }, h("b", {}, v), h("span", {}, label), note ? h("i", {}, note) : ""));
  const m2 = v => v == null ? "–" : `${Math.round(v).toLocaleString()} m²`, pc = v => v == null ? "–" : `${Math.round(v * 100)}%`;
  if (plan.mode === "blocks") {
    k("Programme GFA", m2(M.gfa)); k("Ground footprint", m2(M.ground)); k("Site", m2(M.site), M.developable ? `${m2(M.developable)} developable` : "");
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
  const box = h("div", { class: "sglegend" }), o = g.options;
  const legend = SGST.legend;
  const set = next => sgCommit(app, f, { options: Object.assign({}, o, { legend: next }) }, { build: true });
  box.append(h("div", { class: "cellrow" }, h("b", {}, "Legend"), h("span", { class: "grow" }), h("button", { class: "btn small ghost", title: "One colour per group, from the programme", onclick: () => set(defaultLegend(g.nodes)) }, "Reset")));
  const used = new Set(g.nodes.map(n => n.dept)); 
  for (const [i, e] of legend.entries()) box.append(h("label", { class: "legendchip" + (used.has(e.key) ? "" : " unused"), title: e.key },
    h("input", { type: "color", value: e.colour, "aria-label": `Colour of ${e.label}`, onchange: ev => { const n = legend.map(x => Object.assign({}, x)); n[i].colour = ev.target.value; set(n); } }), h("span", {}, e.label)));
  return box;
}

function sgProgramTable(app, f, g, plan) {
  const wrap = h("div", { class: "sgtable" }), tb = h("tbody"), doc = app.doc;
  const put = () => sgCommit(app, f, { nodes: g.nodes }, { replan: false });
  const placed = new Map(); if (plan) { for (const L of plan.levels || []) for (const r of L.rooms) placed.set(r.id, Object.assign({ levelName: L.name || L.key }, r)); for (const b of plan.blocks || []) placed.set(b.id, b); }
  const levels = doc.elements().filter(x => doc.typeOf(x) === "Level").sort((a, b) => F.real(a, "elevation") - F.real(b, "elevation"));
  const row = nd => {
    const r = placed.get(nd.id), warn = r && r.warn && r.warn.length, ctx = nd.zone === "Context" || !(nd.area > 0);
    const inp = (k, w, parse = x => x) => h("input", { type: "text", value: nd[k] ?? "", style: { width: w }, "aria-label": `${nd.name} ${k}`, onchange: e => { nd[k] = parse(e.target.value); put(); } });
    return h("tr", { class: (SGST.sel === nd.id ? "on " : "") + (warn ? "warn " : "") + (ctx ? "ctx" : ""), onclick: e => { if (e.target.tagName === "TD") { SGST.sel = nd.id; app.refresh({ keepMain: false }); } } },
      h("td", {}, h("span", { class: "mswatch", style: { background: sgColour(nd), borderColor: "#888" } })),
      h("td", { class: "mono muted" }, nd.id), h("td", {}, inp("name", "120px")), h("td", {}, ctx ? h("span", { class: "muted" }, nd.side || "–") : inp("area", "62px", v => Math.max(1, Number(String(v).replace(/,/g, "")) || 1))),
      h("td", {}, inp("dept", "56px")),
      h("td", {}, h("select", { "aria-label": `${nd.name} zone`, onchange: e => { nd.zone = e.target.value; put(); } }, SG_ZONES.map(z => h("option", { selected: z === nd.zone }, z)))),
      h("td", {}, ctx ? "" : inp("storeys", "30px", v => Math.max(1, Math.round(Number(v) || 1)))),
      h("td", {}, ctx ? "" : h("select", { "aria-label": `${nd.name} level`, onchange: e => { nd.level = e.target.value; put(); } }, h("option", { value: "" }, "auto"), levels.map(L => h("option", { value: doc.idOf(L), selected: nd.level === doc.idOf(L) || nd.level === F.text(L, "name") }, F.text(L, "name"))))),
      h("td", { title: "Lock to this level: it stays there whatever the solver does" }, ctx ? "" : h("input", { type: "checkbox", checked: !!nd.lockLevel, "aria-label": `${nd.name} locked to its level`, onchange: e => { nd.lockLevel = e.target.checked; put(); } })),
      h("td", { class: "muted mono", title: r ? (r.warn || []).join("; ") : "not packed" }, r && r.area ? Math.round(r.area).toLocaleString() : "–"),
      h("td", {}, h("button", { class: "iconbtn", "aria-label": `Delete ${nd.name}`, onclick: () => { g.nodes = g.nodes.filter(x => x !== nd); g.edges = g.edges.filter(e => e.a !== nd.id && e.b !== nd.id); sgCommit(app, f, { nodes: g.nodes, edges: g.edges }, { replan: true }); } }, "✕")));
  };
  for (const nd of g.nodes.filter(n => n.area > 0 && n.zone !== "Context")) tb.append(row(nd));
  const ctxRows = g.nodes.filter(n => !(n.area > 0) || n.zone === "Context");
  if (ctxRows.length) { tb.append(h("tr", {}, h("td", { colspan: 11, class: "sgsub" }, `Context and circulation (${ctxRows.length}) - outside the plot or not areas; placed on their side of the site`))); for (const nd of ctxRows) tb.append(row(nd)); }
  wrap.append(h("table", {}, h("thead", {}, h("tr", {}, ["", "Id", "Name", "m²", "Group", "Zone", "St.", "Level", "🔒", "Built", ""].map(x => h("th", {}, x)))), tb),
    h("div", { class: "cellrow", style: { marginTop: "6px" } }, h("button", { class: "btn small", onclick: () => { let n = 1; while (g.nodes.some(x => x.id === "N" + n)) n++; g.nodes.push({ id: "N" + n, name: "New space", area: 20, dept: "", zone: "Room", facade: true, ratio: null, level: "" }); seedBubbles(g.nodes); sgCommit(app, f, { nodes: g.nodes }, { replan: true }); } }, "+ Element")));
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
  { const ext = nodes.map(nd => [W / 2 + (nd.x - view.x) * view.s, H / 2 - (nd.y - view.y) * view.s]); if (ext.some(p => p[0] < -20 || p[0] > W + 20 || p[1] < -20 || p[1] > H + 20) && !SGST.drag) refit(); }
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
    if (!nd) { const ed = edgeAt(sx, sy); if (ed) { const i = CYCLE.findIndex(c => c && c[0] === ed.rel && c[1] === ed.s), next = CYCLE[(i + 1) % CYCLE.length]; if (!next) edges.splice(edges.indexOf(ed), 1); else Object.assign(ed, { rel: next[0], s: next[1], w: relWeight(next[0], next[1]) }); sgCommit(app, f, { edges }, { replan: true, say: next ? `${next[0]} ${next[1]}` : "Link removed" }); return; } SGST.drag = { pan: [sx, sy, view.x, view.y] }; cv.setPointerCapture(e.pointerId); return; }
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
  cv.onwheel = e => { e.preventDefault(); view.s *= e.deltaY < 0 ? 1.12 : 1 / 1.12; draw(); };
}
/** The adjacency matrix: every pair, its relation and strength; groups together, context last. */
function sgMatrixCanvas(app, f, cv, g) {
  const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect(); cv.width = rect.width * dpr; cv.height = rect.height * dpr;
  const ctx = cv.getContext("2d"), W = rect.width, H = rect.height;
  const isCtx = nd => nd.zone === "Context" || !(nd.area > 0);
  const ns = g.nodes.slice().sort((a, b) => isCtx(a) - isCtx(b) || String(a.dept).localeCompare(String(b.dept)) || String(a.id).localeCompare(String(b.id)));
  const idx = new Map(ns.map((n, i) => [n.id, i])), cell = new Map();
  for (const e of g.edges) { if (!idx.has(e.a) || !idx.has(e.b)) continue; cell.set(`${idx.get(e.a)},${idx.get(e.b)}`, e); cell.set(`${idx.get(e.b)},${idx.get(e.a)}`, e); }
  const lab = 118, n = ns.length, cs = Math.max(6, Math.min(22, Math.floor(Math.min(W - lab - 8, H - lab - 8) / Math.max(1, n))));
  const draw = (hi) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#fbfbfc"; ctx.fillRect(0, 0, W, H);
    ctx.font = `${Math.max(8, Math.min(11, cs - 2))}px system-ui`;
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
  const at = e => { const r = cv.getBoundingClientRect(), i = Math.floor((e.clientY - r.top - lab) / cs), j = Math.floor((e.clientX - r.left - lab) / cs); return i >= 0 && j >= 0 && i < n && j < n && i !== j ? [i, j] : null; };
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
        label(b.poly, b.name, `${b.storeys} st · ${Math.round(b.z1 / 1000)} m`);
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
    const hit = hitAt(sx, sy); if (hit) { drag = { hit, from: [sx, sy] }; SGST.sel = hit.id; cv.setPointerCapture(e.pointerId); } else drag = { pan: [sx, sy, view.x, view.y] };
  };
  cv.onpointermove = e => {
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (drag && drag.pan) { const [x0, y0, vx, vy] = drag.pan; view.x = vx - (sx - x0) / view.s; view.y = vy + (sy - y0) / view.s; draw(); return; }
    const over = hitAt(sx, sy); draw(over && over.id, drag && drag.hit ? [drag.from, [sx, sy]] : null);
    cv.title = over ? (over.storeys ? `${over.name} · ${Math.round(over.area).toLocaleString()} m² · ${over.storeys} storeys × ${(over.f2f / 1000).toFixed(1)} m · footprint ${Math.round(over.footprint).toLocaleString()} m²` : `${over.name} · ${over.area.toFixed(1)} m² (asked ${over.target})${over.warn && over.warn.length ? " · " + over.warn.join("; ") : ""}`) : "";
  };
  cv.onpointerup = e => {
    const d = drag; drag = null; if (!d || !d.hit) return;
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (plan && plan.mode === "blocks") {
      if (dist(d.from, [sx, sy]) < 4) { app.refresh({ keepMain: false }); return; }
      // a block dropped somewhere: that is where it is wanted - an attractor for it
      const p = M(sx, sy), list = (g.site.attractors || []).filter(a => a.node !== d.hit.id); list.push({ at: p.map(Math.round), node: d.hit.id, w: 1 });
      g.site.attractors = list; sgCommit(app, f, { site: g.site }, { replan: true, say: `${d.hit.name} wanted there: re-planned around it` }); return;
    }
    const to = hitAt(sx, sy);
    if (to && to.id !== d.hit.id) { const res = app.apply({ op: "sgswap", id: app.doc.idOf(f), a: d.hit.id, b: to.id }); if (res.ok) app.say(`${d.hit.name} ⇄ ${to.name}: each takes the other's slot, widths follow the areas`, "ok"); }
    else app.refresh();
  };
  cv.onwheel = e => { e.preventDefault(); const r = cv.getBoundingClientRect(), before = M(e.clientX - r.left, e.clientY - r.top); view.s *= e.deltaY < 0 ? 1.15 : 1 / 1.15; const after = M(e.clientX - r.left, e.clientY - r.top); view.x += before[0] - after[0]; view.y += before[1] - after[1]; draw(); };
}
