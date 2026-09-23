//! The Space Graph workspace: the program as a table, the graph as a bubble diagram that relaxes as
//! you drag it, and the site with its setbacks, entry and packed plan beside it. Every edit is one op
//! on the SpaceGraph element (undoable), and - with Rebuild on change - one sgbuild after it, so the
//! walls, slab, rooms and doors in the model follow the graph.

import { h, clear, dialog, fmtLen } from "./ui_util.js";
import { parseLength } from "./units.js";
import { F } from "./ocaf.js";
import { planSpaceGraph, relaxBubbles, seedBubbles, programFromBrief, programFromWorkbook, programFromRows, readXlsx, readCsv, setbacksByRole, ccwPoly, SG_DEFAULTS } from "./spacegraph.js";
import { readDXF, dxfDrawing } from "./dxf.js";
import { weld, regionsOf } from "./bimsketch.js";
import { dist, sub, add, mul, dot, normalise, pointInPoly } from "./geom2d.js";

const SG_ZONES = ["Room", "Entry", "BOH", "Circulation"];
const SG_PAL = ["#8ab6e8", "#f2b880", "#9fd39a", "#e8a3c9", "#f4dc7a", "#b9a9ec", "#88d5cf", "#e9a58f", "#c3cfda", "#d7c29b"];
const SGST = { sg: null, bubbleView: null, layoutView: null, anim: 0, drag: null, relaxing: false, pinDrag: false, entryMode: false, sel: null };
const sgDeptColour = (dept, zone) => { if (zone === "Circulation") return "#e3e6ea"; const k = dept || zone || ""; let hh = 0; for (const c of k) hh = (hh * 31 + c.charCodeAt(0)) >>> 0; return SG_PAL[hh % SG_PAL.length]; };
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
  if (f0) { sgCommit(app, f0, { nodes: prog.nodes, edges: prog.edges, order: null }, { replan: true, say: `${name}: ${prog.nodes.length} spaces, ${prog.edges.length} adjacencies` }); return; }
  const r = app.apply([{ op: "add", element: { type: "SpaceGraph", name, args: { nodes: prog.nodes, edges: prog.edges, site: { boundary: [], setbacks: [], entries: [], spine: null }, options: {}, order: null, level: lv ? { ref: lv } : null, auto: true } } }]);
  if (r.ok) { SGST.sg = r.id; app.apply({ op: "sgbuild", id: r.id }); app.say(`${name}: ${prog.nodes.length} spaces, ${prog.edges.length} adjacencies - packed and built`, "ok"); }
}
function sgReport(title, lines) { if (lines && lines.length) dialog(title, h("div", { style: { display: "grid", gap: "4px" } }, lines.map(l => h("div", { class: "muted" }, l))), [{ label: "OK", primary: true, run: () => true }]); }

// ---------------------------------------------------------------- inputs
export function importProgram(app) {
  const inp = h("input", { type: "file", accept: ".xlsx,.csv,.tsv,.txt", hidden: true }); document.body.append(inp);
  inp.addEventListener("change", async () => {
    const file = inp.files[0]; inp.remove(); if (!file) return;
    try {
      const prog = /\.xlsx$/i.test(file.name) ? programFromWorkbook(await readXlsx(await file.arrayBuffer())) : /\.txt$/i.test(file.name) ? programFromBrief(await file.text()) : programFromRows(readCsv(await file.text()));
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
/** The site from a DXF: its largest closed loop. */
export function importSite(app) {
  const f = sgCur(app); if (!f) return app.say("make a space graph first (import a program or write a brief)", "note");
  const inp = h("input", { type: "file", accept: ".dxf", hidden: true }); document.body.append(inp);
  inp.addEventListener("change", async () => {
    const file = inp.files[0]; inp.remove(); if (!file) return;
    const text = await file.text();
    const take = r => {
      const { drawing } = dxfDrawing(r), res = regionsOf(weld({ elements: drawing.elements, constraints: [], dims: [] }));
      const loops = (res.regions || []).map(x => x.outer).filter(l => l && l.length >= 3);
      if (!loops.length) return app.say(`${file.name}: no closed boundary in it${res.error ? " (" + res.error + ")" : ""}`, "error");
      const area = l => Math.abs(l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
      const boundary = ccwPoly(loops.sort((a, b) => area(b) - area(a))[0].map(p => p.map(v => Math.round(v))));
      const g = sgRead(app, f); g.site.boundary = boundary; g.site.setbacks = boundary.map(() => 3000); g.options.footprint = null;
      sgCommit(app, f, { site: g.site, options: g.options }, { replan: true, say: `${file.name}: site ${(area(boundary) / 1e6).toFixed(0)} m², ${boundary.length} edges, 3 m setbacks all round - set each in Setbacks` });
    };
    const r = readDXF(text);
    if (r.needsUnits) take(readDXF(text, { askUnits: () => "m" })); else take(r);
  });
  inp.click();
}
function sgSiteRect(app, f) {
  const g = sgRead(app, f), w = h("input", { type: "text", value: "60 m", "aria-label": "Site width" }), d = h("input", { type: "text", value: "40 m", "aria-label": "Site depth" });
  dialog("Rectangular site", h("div", { class: "cellrow" }, "Width", w, "Depth", d), [{ label: "Cancel", run: () => true }, { label: "OK", primary: true, run: () => {
    const W = parseLength(w.value), D = parseLength(d.value); g.site.boundary = [[0, 0], [W, 0], [W, D], [0, D]]; g.site.setbacks = [6000, 3000, 5000, 3000]; g.site.entries = g.site.entries && g.site.entries.length ? g.site.entries : [{ at: [W / 2, 0], dir: [0, 1] }];
    g.options.footprint = null; sgCommit(app, f, { site: g.site, options: g.options }, { replan: true, say: "Site set: front 6 m, sides 3 m, rear 5 m" }); return true; } }]);
}
function sgSetbacks(app, f) {
  const g = sgRead(app, f), P = g.site.boundary || []; if (P.length < 3) return app.say("set a site first (DXF or a rectangle)", "note");
  const sb = P.map((_, i) => g.site.setbacks[i] ?? 3000);
  const rows = h("tbody", {}, P.map((a, i) => { const b = P[(i + 1) % P.length]; return h("tr", {}, h("td", { class: "mono" }, `Edge ${i + 1}`), h("td", { class: "muted" }, fmtLen(Math.round(dist(a, b)))),
    h("td", {}, h("input", { type: "text", value: fmtLen(sb[i]), "aria-label": `Setback edge ${i + 1}`, style: { width: "90px" }, onchange: e => { try { sb[i] = parseLength(e.target.value); } catch (er) { /* keep */ } e.target.value = fmtLen(sb[i]); } }))); }));
  const fr = h("input", { type: "text", value: "6 m", style: { width: "64px" }, "aria-label": "Front setback" }), si = h("input", { type: "text", value: "3 m", style: { width: "64px" }, "aria-label": "Side setback" }), re = h("input", { type: "text", value: "5 m", style: { width: "64px" }, "aria-label": "Rear setback" });
  dialog("Setbacks", h("div", { style: { display: "grid", gap: "8px" } },
    h("div", { class: "cellrow" }, "By role from the entry: front", fr, "side", si, "rear", re, h("button", { class: "btn small", onclick: () => { const v = setbacksByRole(P, g.site.entries && g.site.entries[0] && g.site.entries[0].at, { front: parseLength(fr.value), side: parseLength(si.value), rear: parseLength(re.value) }); v.forEach((x, i) => { sb[i] = x; rows.children[i].querySelector("input").value = fmtLen(x); }); } }, "Apply")),
    h("table", {}, rows)), [{ label: "Cancel", run: () => true }, { label: "OK", primary: true, run: () => { g.site.setbacks = sb; g.options.footprint = null; sgCommit(app, f, { site: g.site, options: g.options }, { replan: true, say: "Setbacks set: the footprint refits" }); return true; } }]);
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

// ---------------------------------------------------------------- the brief, read by Claude
//! Claude reads what a program is made of when a spreadsheet or document does not say it the way the
//! parser expects: a prompt, pasted text, and attached files (text, Markdown, CSV, every sheet of an
//! .xlsx) go to the viewer's Claude through the page's `sample` capability, and the answer - a
//! structured program - becomes the same rows the parser reads. Absent that capability the button
//! does not show. Nothing leaves the page except to the viewer's own Claude, on their consent.
let SG_SAMPLE = null, SG_SAMPLE_ASKED = false;
async function sgSample() {
  if (!SG_SAMPLE_ASKED) { SG_SAMPLE_ASKED = true; try { SG_SAMPLE = window.claude && window.claude.use ? await window.claude.use("sample") : null; } catch (e) { SG_SAMPLE = null; } }
  return SG_SAMPLE;
}
const SG_AI_SHAPE = `{"spaces":[{"name":"Consult room","qty":6,"area_m2":16,"department":"Clinical","zone":"Room|Entry|BOH|Circulation","facade":true,"width_to_depth":[0.6,1.2] or null,"level":"Ground","adjacent":["Waiting"],"strongly_adjacent":["Treatment"],"avoid":["Plant"]}],"setbacks_m":{"front":6,"side":3,"rear":5} or null,"notes":["assumptions you made, conflicts you found"]}`;
function sgAiRows(ans) {
  const rows = [["Name", "Qty", "Area", "Department", "Facade", "Adjacent to", "Avoid", "Level", "W:D", "Zone"]];
  for (const sp of (ans && ans.spaces) || []) {
    if (!sp || !sp.name) continue;
    const adj = [...(sp.strongly_adjacent || []).map(x => x + "*"), ...(sp.adjacent || [])].join(", ");
    const r = Array.isArray(sp.width_to_depth) && sp.width_to_depth.length === 2 ? sp.width_to_depth.join("-") : "";
    rows.push([String(sp.name), sp.qty || 1, Number(sp.area_m2) || 0, sp.department || "", sp.facade === false ? "N" : sp.facade ? "Y" : "", adj, (sp.avoid || []).join(", "), sp.level || "", r, sp.zone === "BOH" ? "back of house" : sp.zone === "Circulation" ? "circulation" : sp.zone === "Entry" ? "entrance" : ""]);
  }
  return rows;
}
async function sgFileText(file) {
  if (/\.xlsx$/i.test(file.name)) { const wb = await readXlsx(await file.arrayBuffer()); return wb.sheets.map(sh => `## Sheet "${sh.name}"\n` + sh.rows.map(r => r.map(c => String(c ?? "")).join("\t")).join("\n")).join("\n\n"); }
  return await file.text();
}
export async function aiBriefDialog(app) {
  const sample = await sgSample();
  if (!sample) return app.say("Claude is not available to this page here - it needs to be opened in Claude with the AI capability allowed", "note");
  const f0 = sgCur(app), g0 = f0 ? sgRead(app, f0) : null;
  const prompt = h("textarea", { rows: 4, style: { width: "100%" }, "aria-label": "What Claude should do", placeholder: "e.g. This is the accommodation schedule for a GP surgery. Read every room, work out the adjacencies from the notes column and the clinical flow, mark what needs daylight, put staff on level 1." });
  const ctxText = h("textarea", { rows: 8, style: { width: "100%", font: "12px var(--mono)" }, "aria-label": "Brief material", placeholder: "Paste the brief here - from a document, an email, a Claude project's knowledge - as much as you have." });
  const fileIn = h("input", { type: "file", multiple: true, accept: ".xlsx,.csv,.tsv,.txt,.md,.json", "aria-label": "Attach brief files" });
  const refine = h("input", { type: "checkbox", checked: !!(g0 && g0.nodes.length) });
  const status = h("div", { class: "muted small", role: "status" }), notes = h("div", { class: "muted small" });
  let ctl = null;
  const run = async () => {
    const parts = [];
    for (const file of fileIn.files || []) { try { parts.push(`# File: ${file.name}\n${await sgFileText(file)}`); } catch (e) { parts.push(`# File: ${file.name} (unreadable: ${e.message})`); } }
    if (ctxText.value.trim()) parts.push(`# Pasted brief\n${ctxText.value}`);
    if (refine.checked && g0) parts.push(`# The program as it stands (refine it; keep names stable)\n` + JSON.stringify(g0.nodes.map(n => ({ name: n.name, area_m2: n.area, department: n.dept, zone: n.zone, facade: n.facade, level: n.level }))) + "\nAdjacencies: " + JSON.stringify(g0.edges.map(e => [g0.nodes.find(n => n.id === e.a)?.name, g0.nodes.find(n => n.id === e.b)?.name, e.w])));
    let material = parts.join("\n\n"); if (material.length > 52000) { material = material.slice(0, 52000); status.textContent = "The material was long: the first 52,000 characters were sent."; }
    if (!material.trim() && !prompt.value.trim()) { status.textContent = "Write a prompt or give Claude some brief material."; return; }
    const input = `You are an architect's briefing assistant. From the material below, produce the building's space program as data for a space-planning tool.
Rules: one entry per distinct space type, with qty for repeats; areas are NET areas in square metres (convert from sq ft if needed); zone is Entry for entrances/receptions/lobbies, BOH for back-of-house, plant, stores, WCs, kitchens, services, Circulation for corridors/stairs/lifts (give their area if stated), otherwise Room; facade true for spaces people occupy that need daylight or views; adjacent/strongly_adjacent/avoid name other spaces exactly as you named them; level as the brief names it (Ground, 1, 2, …) or "" if not stated; width_to_depth only if the brief gives proportions or it is essential (e.g. a gym, a classroom); setbacks_m only if the material states them.
${prompt.value.trim() ? "The architect adds: " + prompt.value.trim() + "\n" : ""}Reply with only JSON of this shape: ${SG_AI_SHAPE}

MATERIAL:
${material}`;
    ctl = new AbortController(); go.disabled = true; stop.hidden = false; status.textContent = "Thinking… (Claude reads the whole brief first; this can take a minute)";
    try {
      const ans = await sample.json(input, { signal: ctl.signal, modelTier: "default", onText: ({ text }) => { status.textContent = `Writing the program… ${text.length} characters`; } });
      const prog = programFromRows(sgAiRows(ans));
      if (!prog.nodes.length) { status.textContent = "Claude found no spaces with areas in that material."; return; }
      sgCreateFrom(app, prog, "AI brief");
      // setbacks by role, when the brief states them and there is a site
      const f = sgCur(app);
      if (f && ans.setbacks_m && ans.setbacks_m.front) { const g = sgRead(app, f); if ((g.site.boundary || []).length >= 3) { g.site.setbacks = setbacksByRole(g.site.boundary, g.site.entries && g.site.entries[0] && g.site.entries[0].at, { front: ans.setbacks_m.front * 1000, side: (ans.setbacks_m.side || 3) * 1000, rear: (ans.setbacks_m.rear || 5) * 1000 }); sgCommit(app, f, { site: g.site }, { replan: true }); } }
      status.textContent = `${prog.nodes.length} spaces, ${prog.edges.length} adjacencies, ${prog.nodes.reduce((a, n) => a + n.area, 0).toFixed(0)} m² - in the graph, packed and built.`;
      clear(notes); for (const n of [...(ans.notes || []), ...prog.report]) notes.append(h("div", {}, "• " + n));
    } catch (e) {
      status.textContent = e.code === "cancelled" ? "Stopped." : e.code === "not_granted" || e.code === "sampling_disabled" ? "Claude is not allowed for this page." : e.code === "invalid_json" ? "Claude's answer was not a program - try again, or give it less at once." : e.code === "rate_limited" ? "Too many requests just now - try again in a while." : e.code === "prompt_too_large" ? "Too much material at once - attach less." : `Claude could not answer (${e.code || e.message}).`;
    } finally { go.disabled = false; stop.hidden = true; }
  };
  const go = h("button", { class: "btn primary small", onclick: run }, "Ask Claude"), stop = h("button", { class: "btn small", hidden: true, onclick: () => ctl && ctl.abort() }, "Stop");
  dialog("Space program with Claude", h("div", { style: { display: "grid", gap: "8px" } },
    h("div", { class: "muted small" }, "Claude reads the brief - an accommodation schedule in any layout, a written brief, meeting notes, what your Claude project knows about it (paste or attach it) - and returns the spaces, their adjacencies, which need a facade, their levels and any setbacks. It runs on your Claude account and asks before the first use."),
    h("label", {}, "What Claude should do", prompt), h("label", {}, "Brief material", ctxText), h("div", { class: "cellrow" }, "Attach", fileIn),
    g0 && g0.nodes.length ? h("label", { class: "cellrow" }, refine, " Refine the current program (send it along; names kept)") : "",
    h("div", { class: "cellrow" }, go, stop), status, notes), [{ label: "Close", run: () => { if (ctl) ctl.abort(); return true; } }], { modeless: true });
}

// ---------------------------------------------------------------- the workspace
export function renderSpaceGraph(app, root) {
  cancelAnimationFrame(SGST.anim);
  const f = sgCur(app);
  const bar = h("div", { class: "sgbar" });
  const btn = (label, run, title, primary) => h("button", { class: "btn small" + (primary ? " primary" : ""), title: title || label, onclick: run }, label);
  bar.append(btn("Import program…", () => importProgram(app), "An Excel (.xlsx) or CSV program: Name, Qty, Area, Department, Facade, Adjacent to, Level… and an adjacency matrix sheet if there is one"),
    btn("Brief…", () => briefDialog(app), "Write or paste a brief: one space per line"));
  // Claude, when this page can ask it: the button appears once the capability answers
  const aiBtn = btn("✦ Brief with Claude…", () => aiBriefDialog(app), "Claude reads a brief or schedule in any form (paste it, attach Excel/CSV/text) and returns the program with adjacencies");
  aiBtn.hidden = !SG_SAMPLE; bar.append(aiBtn);
  if (!SG_SAMPLE_ASKED) sgSample().then(x => { if (x) aiBtn.hidden = false; });
  if (!f) {
    root.append(h("div", { class: "sgws" }, bar, h("div", { class: "empty", style: { maxWidth: "560px", margin: "40px auto" } }, h("h3", {}, "Space Graph"),
      "The building's interior as a graph: spaces with areas and needs, adjacencies between them. Import a program (Excel or CSV), or write a brief. The graph relaxes into a bubble diagram; with a site, setbacks and an entry it packs into a plan and builds the walls, slab, rooms and doors - and rebuilds them whenever the graph changes.")));
    return;
  }
  const doc = app.doc, id = doc.idOf(f), g = sgRead(app, f);
  const all = sgOf(app);
  if (all.length > 1) bar.prepend(h("select", { "aria-label": "Space graph", onchange: e => { SGST.sg = e.target.value; app.refresh(); } }, all.map(x => h("option", { value: doc.idOf(x), selected: doc.idOf(x) === id }, x.get("Name")))));
  bar.append(btn("Site from DXF…", () => importSite(app), "A site boundary: the largest closed loop in a DXF"), btn("Rectangular site…", () => sgSiteRect(app, f)), btn("Setbacks…", () => sgSetbacks(app, f)),
    h("button", { class: "btn small" + (SGST.entryMode ? " primary" : ""), title: "Click on the site plan where people come in", onclick: () => { SGST.entryMode = !SGST.entryMode; app.refresh(); } }, SGST.entryMode ? "Click the entry…" : "Entry"),
    btn("Packing…", () => sgOptions(app, f)),
    btn("Replan from graph", () => sgCommit(app, f, {}, { replan: true, build: true, say: "Replanned: rooms reordered from the bubble diagram" }), "Reorder every room from the bubble diagram (clears swaps)"),
    btn("Build model", () => { const r = app.apply({ op: "sgbuild", id }); if (r.ok && r.said) app.say(r.said, "ok"); }, "Build or rebuild the walls, slab, rooms and doors", true),
    h("label", { class: "cellrow", title: "Rebuild the model whenever the graph changes" }, h("input", { type: "checkbox", checked: F.bool(f, "auto") !== false, onchange: e => app.apply({ op: "set", id, key: "auto", value: e.target.checked }) }), " Auto"),
    btn("Open plan", () => { const lv = F.refId(f, "level"); const pv = doc.elements().find(v => doc.typeOf(v) === "PlanView" && F.refId(v, "level") === lv); if (pv) app.openView(doc.idOf(pv)); }));
  let plan = null; try { plan = planSpaceGraph(g, { relax: false }); } catch (e) { app.say(`planning: ${e.message}`, "error"); }
  const table = sgProgramTable(app, f, g, plan);
  const bubble = h("canvas", { class: "sgcanvas", "aria-label": "Bubble diagram: drag a bubble; Shift-drag from one bubble to another to link them; click a link to change it" });
  const layout = h("canvas", { class: "sgcanvas", "aria-label": "Site and packed plan: drag a room onto another to swap them" });
  const rep = h("div", { class: "sgreport" }, plan ? [h("b", {}, `${plan.levels.map(L => `${L.key ? "Level " + L.key + ": " : ""}${L.kind}, ${L.rooms.length} rooms`).join(" · ")} · footprint ${(plan.footprint.W / 1000).toFixed(1)} × ${(plan.footprint.D / 1000).toFixed(1)} m`),
    ...plan.report.map(r => h("div", {}, "⚠ " + r)), ...plan.levels.flatMap(L => L.rooms.filter(r => r.warn.length).map(r => h("div", { class: "muted" }, `${r.name}: ${r.warn.join("; ")}`)))] : null);
  root.append(h("div", { class: "sgws" }, bar, h("div", { class: "sggrid" },
    h("section", { class: "sgpane" }, h("header", {}, "Program", h("span", { class: "muted" }, ` ${g.nodes.length} spaces · ${g.nodes.reduce((a, n) => a + (+n.area || 0), 0).toFixed(0)} m²`)), table),
    h("section", { class: "sgpane" }, h("header", {}, "Bubble diagram", h("span", { class: "muted" }, " drag · Shift-drag to link · click a link to cycle it · double-click to pin")), bubble),
    h("section", { class: "sgpane" }, h("header", {}, "Site & plan", h("span", { class: "muted" }, " drag a room onto another to swap them")), layout, rep))));
  requestAnimationFrame(() => { try { sgLayoutCanvas(app, f, layout, g, plan); } catch (e) { app.say(`site plan: ${e.message}`, "error"); } try { sgBubbleCanvas(app, f, bubble, g); } catch (e) { app.say(`bubble diagram: ${e.message}`, "error"); } });
}

function sgProgramTable(app, f, g, plan) {
  const wrap = h("div", { class: "sgtable" }), tb = h("tbody");
  const put = (build = true) => sgCommit(app, f, { nodes: g.nodes }, { replan: false, build: build ? null : false });
  const placed = new Map(); if (plan) for (const L of plan.levels) for (const r of L.rooms) placed.set(r.id, r);
  for (const nd of g.nodes) {
    const r = placed.get(nd.id), warn = r && r.warn.length;
    const inp = (k, w, parse = x => x) => h("input", { type: "text", value: nd[k] ?? "", style: { width: w }, "aria-label": `${nd.name} ${k}`, onchange: e => { nd[k] = parse(e.target.value); put(); } });
    tb.append(h("tr", { class: (SGST.sel === nd.id ? "on " : "") + (warn ? "warn" : ""), onclick: e => { if (e.target.tagName === "TD") { SGST.sel = nd.id; app.refresh({ keepMain: false }); } } },
      h("td", {}, h("span", { class: "mswatch", style: { background: sgDeptColour(nd.dept, nd.zone), borderColor: "#888" } })),
      h("td", {}, inp("name", "112px")), h("td", {}, inp("area", "52px", v => Math.max(1, Number(v) || 1))),
      h("td", {}, inp("dept", "74px")),
      h("td", {}, h("select", { "aria-label": `${nd.name} zone`, onchange: e => { nd.zone = e.target.value; put(); } }, SG_ZONES.map(z => h("option", { selected: z === nd.zone }, z)))),
      h("td", { title: "Needs a facade (daylight)" }, h("input", { type: "checkbox", checked: !!nd.facade, "aria-label": `${nd.name} facade`, onchange: e => { nd.facade = e.target.checked; put(); } })),
      h("td", { title: "Width : depth range, e.g. 0.5-1.5" }, h("input", { type: "text", value: nd.ratio ? nd.ratio.join("-") : "", placeholder: "any", style: { width: "56px" }, "aria-label": `${nd.name} ratio`, onchange: e => { const m = e.target.value.match(/([\d.]+)\s*[-–:]\s*([\d.]+)/); nd.ratio = m ? [Number(m[1]), Number(m[2])].sort((a, b) => a - b) : null; put(); } })),
      h("td", {}, inp("level", "40px")),
      h("td", { class: "muted mono", title: r ? `${r.area.toFixed(1)} m² as packed · ${(r.u1 - r.u0) / 1000} × ${(r.v1 - r.v0) / 1000} m` : "not packed" }, r ? `${r.area.toFixed(0)}` : "–"),
      h("td", {}, h("button", { class: "iconbtn", "aria-label": `Delete ${nd.name}`, onclick: () => { g.nodes = g.nodes.filter(x => x !== nd); g.edges = g.edges.filter(e => e.a !== nd.id && e.b !== nd.id); sgCommit(app, f, { nodes: g.nodes, edges: g.edges }, { replan: true }); } }, "✕"))));
  }
  wrap.append(h("table", {}, h("thead", {}, h("tr", {}, ["", "Name", "m²", "Department", "Zone", "Fac.", "W:D", "Lvl", "Built", ""].map(x => h("th", {}, x)))), tb),
    h("div", { class: "cellrow", style: { marginTop: "6px" } }, h("button", { class: "btn small", onclick: () => { let n = 1; while (g.nodes.some(x => x.id === "N" + n)) n++; g.nodes.push({ id: "N" + n, name: "New space", area: 20, dept: "", zone: "Room", facade: true, ratio: null, level: g.nodes[0] ? g.nodes[0].level : "" }); seedBubbles(g.nodes); sgCommit(app, f, { nodes: g.nodes }, { replan: true }); } }, "+ Space")));
  return wrap;
}

// ---------------------------------------------------------------- bubble diagram
function sgFitView(pts, W, H, pad = 30) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); if (!xs.length) return { s: 1, x: 0, y: 0 };
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min(Math.max(20, W - 2 * pad) / Math.max(1e-6, x1 - x0), Math.max(20, H - 2 * pad) / Math.max(1e-6, y1 - y0));
  return { s: Math.max(1e-9, s), x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}
function sgBubbleCanvas(app, f, cv, g) {
  const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect(); cv.width = rect.width * dpr; cv.height = rect.height * dpr;
  const ctx = cv.getContext("2d"), W = rect.width, H = rect.height;
  const nodes = g.nodes, edges = g.edges; seedBubbles(nodes);
  const R = nd => Math.sqrt(Math.max(1, nd.area) / Math.PI);
  // the view is kept between redraws (so a pan or zoom stays), refitted when the diagram has left it
  let view = SGST.bubbleView && SGST.bubbleView.sg === f && SGST.bubbleView.W === W && SGST.bubbleView.n === nodes.length ? SGST.bubbleView : null;
  const refit = () => { const pts = nodes.flatMap(nd => [[nd.x - R(nd), nd.y - R(nd)], [nd.x + R(nd), nd.y + R(nd)]]); view = Object.assign(sgFitView(pts, W, H), { sg: f, W, n: nodes.length }); if (W > 60) SGST.bubbleView = view; };
  if (!view) refit();
  { const ext = nodes.map(nd => [W / 2 + (nd.x - view.x) * view.s, H / 2 - (nd.y - view.y) * view.s]); if (ext.some(p => p[0] < -20 || p[0] > W + 20 || p[1] < -20 || p[1] > H + 20) && !SGST.drag) refit(); }
  const X = p => [W / 2 + (p[0] - view.x) * view.s, H / 2 - (p[1] - view.y) * view.s], M = (sx, sy) => [view.x + (sx - W / 2) / view.s, view.y - (sy - H / 2) / view.s];
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  const draw = (link) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#fbfbfc"; ctx.fillRect(0, 0, W, H);
    for (const e of edges) {
      const a = byId.get(e.a), b = byId.get(e.b); if (!a || !b) continue; const A = X([a.x, a.y]), B = X([b.x, b.y]);
      ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.lineWidth = e.w > 0 ? 0.8 + e.w * 1.2 : 1.5; ctx.strokeStyle = e.w > 0 ? "#5a6474" : "#d0312d"; ctx.setLineDash(e.w > 0 ? [] : [5, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const nd of nodes) {
      const c = X([nd.x, nd.y]), r = R(nd) * view.s;
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(0.5, r), 0, Math.PI * 2); ctx.fillStyle = sgDeptColour(nd.dept, nd.zone); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = SGST.sel === nd.id ? 3 : nd.facade ? 1.6 : 1; ctx.strokeStyle = SGST.sel === nd.id ? "#1d6fd8" : nd.facade ? "#2b3a4e" : "#8a94a6"; ctx.setLineDash(nd.facade ? [] : [3, 3]); ctx.stroke(); ctx.setLineDash([]);
      if (nd.pinned) { ctx.fillStyle = "#b3261e"; ctx.beginPath(); ctx.arc(c[0] + r * 0.7, c[1] - r * 0.7, 3.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#1b1f24"; ctx.font = `${Math.max(9, Math.min(13, r * 0.45))}px system-ui, sans-serif`; ctx.textAlign = "center";
      ctx.fillText(nd.name.length > 18 ? nd.name.slice(0, 17) + "…" : nd.name, c[0], c[1] + 2); ctx.fillStyle = "#5a6474"; ctx.font = "10px system-ui"; ctx.fillText(`${nd.area} m²`, c[0], c[1] + 14);
    }
    if (link) { ctx.beginPath(); ctx.moveTo(...link[0]); ctx.lineTo(...link[1]); ctx.strokeStyle = "#1d6fd8"; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); }
  };
  const nodeAt = (sx, sy) => { const p = M(sx, sy); let best = null; for (const nd of nodes) { const d = Math.hypot(nd.x - p[0], nd.y - p[1]); if (d < R(nd) && (!best || d < best.d)) best = { nd, d }; } return best && best.nd; };
  const edgeAt = (sx, sy) => { for (const e of edges) { const a = byId.get(e.a), b = byId.get(e.b); if (!a || !b) continue; const A = X([a.x, a.y]), B = X([b.x, b.y]), d = sub(B, A), L2 = dot(d, d) || 1, t = Math.max(0, Math.min(1, dot(sub([sx, sy], A), d) / L2)); if (dist([sx, sy], add(A, mul(d, t))) < 5 && t > 0.1 && t < 0.9) return e; } return null; };
  // relax live: a few steps a frame until it settles, then write the positions back
  let settle = 0, dirty = false;
  const loop = () => {
    const E = relaxBubbles(nodes, edges, 3);
    draw(SGST.drag && SGST.drag.link ? SGST.drag.link : null);
    if (SGST.drag || E > 1e-4 && settle++ < 240) SGST.anim = requestAnimationFrame(loop);
    else if (dirty) { dirty = false; for (const nd of nodes) if (nd.dragPin) { delete nd.dragPin; nd.pinned = false; } sgCommit(app, f, { nodes: nodes.map(nd => Object.assign({}, nd)) }, { replan: true, say: "Bubble diagram changed: rooms replanned" }); }
  };
  draw();
  cv.onpointerdown = e => {
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, nd = nodeAt(sx, sy);
    if (!nd) { const ed = edgeAt(sx, sy); if (ed) { const i = edges.indexOf(ed); const next = { 1: 2, 2: 3, 3: -1, [-1]: 0 }[ed.w] ?? 0; if (next === 0) edges.splice(i, 1); else ed.w = next; sgCommit(app, f, { edges }, { replan: true, say: next === 0 ? "Link removed" : next < 0 ? "Keep apart" : `Adjacency weight ${next}` }); return; } SGST.drag = { pan: [sx, sy, view.x, view.y] }; cv.setPointerCapture(e.pointerId); return; }
    cv.setPointerCapture(e.pointerId);
    SGST.sel = nd.id;
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
    if (d.from) { const r = cv.getBoundingClientRect(), to = nodeAt(e.clientX - r.left, e.clientY - r.top); if (to && to !== d.from && !edges.some(x => (x.a === d.from.id && x.b === to.id) || (x.b === d.from.id && x.a === to.id))) { edges.push({ a: d.from.id, b: to.id, w: 2 }); sgCommit(app, f, { edges }, { replan: true, say: `${d.from.name} ↔ ${to.name}` }); } else draw(); return; }
    if (d.node) { if (!d.wasPinned) d.node.pinned = false; delete d.node.dragPin; settle = 0; }
  };
  cv.ondblclick = e => { const r = cv.getBoundingClientRect(), nd = nodeAt(e.clientX - r.left, e.clientY - r.top); if (nd) { nd.pinned = !nd.pinned; sgCommit(app, f, { nodes }, { build: false, say: nd.pinned ? `${nd.name} pinned` : `${nd.name} free` }); } };
  cv.onwheel = e => { e.preventDefault(); view.s *= e.deltaY < 0 ? 1.12 : 1 / 1.12; draw(); };
}

// ---------------------------------------------------------------- site and packed plan
function sgLayoutCanvas(app, f, cv, g, plan) {
  const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect(); cv.width = rect.width * dpr; cv.height = rect.height * dpr;
  const ctx = cv.getContext("2d"), W = rect.width, H = rect.height;
  const pts = [...(g.site.boundary || []), ...(plan ? plan.frame.poly : [])];
  const key = JSON.stringify(g.site.boundary || []) + W;
  let view = SGST.layoutView && SGST.layoutView.sg === f && SGST.layoutView.key === key ? SGST.layoutView : null;
  if (!view) { view = Object.assign(sgFitView(pts.length ? pts : [[0, 0], [10000, 10000]], W, H, 24), { sg: f, key }); if (W > 60) SGST.layoutView = view; }
  const X = p => [W / 2 + (p[0] - view.x) * view.s, H / 2 - (p[1] - view.y) * view.s], M = (sx, sy) => [view.x + (sx - W / 2) / view.s, view.y - (sy - H / 2) / view.s];
  const poly = (P, fill, stroke, lw = 1, dash = []) => { if (!P || P.length < 2) return; ctx.beginPath(); P.forEach((p, i) => { const q = X(p); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]); } };
  const rooms = plan ? plan.levels.flatMap(L => L.rooms.map(r => Object.assign({ level: L.key }, r))) : [];
  const levelKeys = plan ? plan.levels.map(L => L.key) : [];
  const showLevel = SGST.level !== undefined && levelKeys.includes(SGST.level) ? SGST.level : levelKeys[0];
  const draw = (hover, dragFrom) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#f6f7f4"; ctx.fillRect(0, 0, W, H);
    poly(g.site.boundary, "#ffffff", "#2b3a4e", 2, [10, 3, 2, 3]);
    if (plan && plan.buildable) poly(plan.buildable, null, "#d0312d", 1, [5, 4]);
    if (plan) {
      const L = plan.levels.find(x => x.key === showLevel);
      if (L) {
        for (const c of L.corridors) poly(c.poly, "#e8eaee", null);
        for (const sp of L.spares) poly(sp.poly, "#fff4d6", "#c9a227", 1, [3, 3]);
        for (const r of L.rooms) {
          poly(r.poly, sgDeptColour(r.dept, r.zone), r.warn.length ? "#d0312d" : "#2b3a4e", r.warn.length ? 2 : 1);
          if (hover === r.id || SGST.sel === r.id) poly(r.poly, "rgba(29,111,216,.18)", "#1d6fd8", 2.5);
          const c = X([(r.poly[0][0] + r.poly[2][0]) / 2, (r.poly[0][1] + r.poly[2][1]) / 2]), wpx = Math.abs(X(r.poly[1])[0] - X(r.poly[0])[0]) + Math.abs(X(r.poly[1])[1] - X(r.poly[0])[1]);
          // a narrow room is labelled along its depth, so names never run into the next room
          ctx.save(); ctx.fillStyle = "#1b1f24"; ctx.textAlign = "center"; ctx.font = "10.5px system-ui";
          const hpx = Math.hypot(...sub(X(r.poly[3]), X(r.poly[0]))), tw = ctx.measureText(r.name).width, turn = tw > wpx - 4 && hpx > wpx;
          ctx.translate(c[0], c[1]); if (turn) ctx.rotate(-Math.PI / 2);
          const room = (turn ? hpx : wpx) - 6, nm = ctx.measureText(r.name).width > room ? r.name.slice(0, Math.max(2, Math.floor(r.name.length * room / Math.max(1, tw)) - 1)) + "…" : r.name;
          ctx.fillText(nm, 0, turn ? -1 : 0); ctx.fillStyle = "#5a6474"; ctx.font = "9.5px system-ui"; ctx.fillText(`${r.area.toFixed(0)} m²`, 0, turn ? 10 : 11); ctx.restore();
        }
        poly(plan.frame.poly, null, "#1b1f24", 2.5);
      }
    }
    for (const en of g.site.entries || []) { const p = X(en.at), d = normalise(en.dir || [0, 1]); ctx.fillStyle = "#1d6fd8"; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] - d[0] * 16 + d[1] * 7, p[1] + d[1] * 16 + d[0] * 7); ctx.lineTo(p[0] - d[0] * 16 - d[1] * 7, p[1] + d[1] * 16 - d[0] * 7); ctx.closePath(); ctx.fill(); ctx.font = "600 10px system-ui"; ctx.fillText("ENTRY", p[0] + 10, p[1] + 16); }
    if (dragFrom) { ctx.strokeStyle = "#1d6fd8"; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(...dragFrom[0]); ctx.lineTo(...dragFrom[1]); ctx.stroke(); ctx.setLineDash([]); }
    if (levelKeys.length > 1) { ctx.fillStyle = "#1b1f24"; ctx.font = "600 11px system-ui"; ctx.textAlign = "left"; ctx.fillText(`Level ${showLevel || "(base)"} - click here for the next`, 8, 16); }
    if (SGST.entryMode) { ctx.fillStyle = "#1d6fd8"; ctx.font = "600 12px system-ui"; ctx.textAlign = "left"; ctx.fillText("Click where people come in", 8, H - 10); }
  };
  const roomAt = (sx, sy) => rooms.filter(r => r.level === showLevel).find(r => pointInPoly(M(sx, sy), r.poly));
  draw();
  let drag = null;
  cv.onpointerdown = e => {
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (levelKeys.length > 1 && sx < 260 && sy < 22) { const i = levelKeys.indexOf(showLevel); SGST.level = levelKeys[(i + 1) % levelKeys.length]; app.refresh(); return; }
    if (SGST.entryMode) {
      // the entry lands on the nearest site edge, pointing in
      const p = M(sx, sy), B = g.site.boundary || []; let at = p, dir = [0, 1];
      if (B.length >= 3) { let bd = Infinity; const P = ccwPoly(B); P.forEach((a, i) => { const b = P[(i + 1) % P.length], d = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), d) / dot(d, d))), q = add(a, mul(d, t)), dd = dist(p, q); if (dd < bd) { bd = dd; at = q; const u = normalise(d); dir = [-u[1], u[0]]; } }); }
      SGST.entryMode = false; g.site.entries = [{ at: at.map(Math.round), dir }]; sgCommit(app, f, { site: g.site, options: Object.assign({}, g.options, { footprint: null }) }, { replan: true, say: "Entry set: the plan turns to meet it" }); return;
    }
    const rm = roomAt(sx, sy); if (rm) { drag = { rm, from: [sx, sy] }; SGST.sel = rm.id; cv.setPointerCapture(e.pointerId); } else drag = { pan: [sx, sy, view.x, view.y] };
  };
  cv.onpointermove = e => {
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (drag && drag.pan) { const [x0, y0, vx, vy] = drag.pan; view.x = vx - (sx - x0) / view.s; view.y = vy + (sy - y0) / view.s; draw(); return; }
    const over = roomAt(sx, sy); draw(over && over.id, drag && drag.rm ? [drag.from, [sx, sy]] : null);
    cv.title = over ? `${over.name} · ${over.area.toFixed(1)} m² (asked ${over.target}) · ${((over.u1 - over.u0) / 1000).toFixed(1)} × ${((over.v1 - over.v0) / 1000).toFixed(1)} m · w:d ${over.ratio.toFixed(2)}${over.warn.length ? " · " + over.warn.join("; ") : ""}` : "";
  };
  cv.onpointerup = e => {
    const d = drag; drag = null; if (!d || !d.rm) return;
    const r = cv.getBoundingClientRect(), to = roomAt(e.clientX - r.left, e.clientY - r.top);
    if (to && to.id !== d.rm.id) { const res = app.apply({ op: "sgswap", id: app.doc.idOf(f), a: d.rm.id, b: to.id }); if (res.ok) app.say(`${d.rm.name} ⇄ ${to.name}: each takes the other's slot, widths follow the areas`, "ok"); }
    else { app.refresh(); }
  };
  cv.onwheel = e => { e.preventDefault(); view.s *= e.deltaY < 0 ? 1.12 : 1 / 1.12; draw(); };
}
