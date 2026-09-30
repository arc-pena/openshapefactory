//! Claude acting on a prompt: the architect's words and images, the model as it is now, and a handful of page
//! tools - find, read, describe, edit, open - so Claude changes the model itself instead of only reading the
//! request. Every edit goes through the one edit path (app.apply), is checked by the document as any edit
//! is, and a prompt's edits undo as one step each. The answer is written back into the prompt log as
//! Claude's reply, with the edits it made, so the thread in the file is the record of what was asked and done.

import { CATALOGUE } from "./ocaf.js";
import { promptLog, addPrompt } from "./prompts.js";

const PA_EDIT_OPS = new Set(["add", "delete", "set", "transform", "rename", "type", "autojoin", "corner", "split", "place", "sheet"]);
const paRound = v => typeof v === "number" ? Math.round(v * 10) / 10 : Array.isArray(v) ? v.map(paRound) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, paRound(x)])) : v;
const paClip = (o, n) => { const s = JSON.stringify(o); return s.length <= n ? o : JSON.parse(JSON.stringify(s.slice(0, n) + "…(cut)")); };

/** The model as Claude needs it to start: levels, grids, types, what there is, the views and sheets, what the
 *  architect has selected and is looking at. Kept to a few thousand characters. */
export function modelSummary(doc, { activeView = null, selection = [] } = {}) {
  const els = doc.elements(), of = t => els.filter(f => doc.typeOf(f) === t);
  const counts = {}; for (const f of els) { const t = doc.typeOf(f); counts[t] = (counts[t] || 0) + 1; }
  const types = {}; for (const [id, t] of Object.entries(doc.lib.types || {})) { const fam = t.family || "?"; (types[fam] = types[fam] || []).push(`${id} "${t.name}"${t.layers ? ` ${t.layers.reduce((a, l) => a + (l.thickness || 0), 0)}mm` : ""}${t.width ? ` ${t.width}x${t.height || t.depth || ""}` : ""}`); }
  const sel = selection.filter(id => doc.element(id)).slice(0, 12).map(id => elementBrief(doc, doc.element(id)));
  const v = activeView && doc.element(activeView);
  return {
    project: doc.meta.name, units: "model coordinates and lengths in mm; plan x east, y north; z up from the levels' datum",
    levels: of("Level").map(f => ({ id: doc.idOf(f), name: doc.argValue(f, "name"), elevation: Math.round(doc.argValue(f, "elevation") || 0) })),
    grids: of("Grid").map(f => { const c = doc.argValue(f, "line"); return { id: doc.idOf(f), name: doc.argValue(f, "name"), from: paRound(c.start), to: paRound(c.end) }; }),
    counts, types,
    views: els.filter(f => (CATALOGUE.get(doc.typeOf(f)) || {}).kind === "view" || doc.typeOf(f) === "Sheet").slice(0, 80).map(f => `${doc.idOf(f)} ${doc.typeOf(f)} "${f.get("Name") || ""}"${doc.typeOf(f) === "Sheet" ? ` #${doc.argValue(f, "number")}` : ""}`),
    looking_at: v ? `${activeView} (${doc.typeOf(v)} "${v.get("Name") || ""}")` : null,
    selected: sel,
  };
}
/** One element in a line or two: what it is, where, and its main arguments. */
export function elementBrief(doc, f) {
  const id = doc.idOf(f), t = doc.typeOf(f), a = {}, decl = CATALOGUE.get(t) || { args: [] };
  for (const arg of decl.args) { const v = doc.argValue(f, arg.key); if (v === undefined || v === null || v === "") continue;
    if (["line", "centreline", "axis", "position", "boundary", "baseLevel", "topLevel", "level", "wallType", "floorType", "doorType", "windowType", "columnType", "beamType", "height", "baseOffset", "topOffset", "host", "view", "scale", "name", "number", "content", "profile"].includes(arg.key)) a[arg.key] = paRound(v); }
  const err = doc.error(f);
  return paClip(Object.assign({ id, type: t, name: f.get("Name") || id }, a, err ? { error: err } : {}), 900);
}

/** The page tools Claude may call while it works on a prompt. `app` is the running app (doc, apply, openView). */
export function agentTools(app, log) {
  const doc = () => app.doc;
  return [
    { name: "find_elements", description: "Find model elements. Filter by type (Wall, Door, Window, Floor, Roof, Column, Beam, Level, Grid, Space, Stair, Opening, Text, Dimension, PlanView, SectionView, ElevationView, Sheet...), by level id, by text in id or name, or by nearness to a plan point (mm). Returns up to `limit` (default 25) brief records.",
      inputSchema: { type: "object", properties: { type: { type: "string" }, level: { type: "string" }, text: { type: "string" }, near: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, r: { type: "number" } } }, limit: { type: "number" } } },
      execute(i) {
        const d = doc(), lim = Math.min(60, Number(i.limit) || 25), txt = i.text ? String(i.text).toLowerCase() : null, out = [];
        for (const f of d.elements()) {
          const t = d.typeOf(f); if (i.type && t !== String(i.type)) continue;
          if (i.level) { const lv = ["baseLevel", "level"].map(k => (d.argValue(f, k) || {}).ref).find(Boolean); if (lv !== String(i.level)) continue; }
          if (txt && !(d.idOf(f).toLowerCase().includes(txt) || String(f.get("Name") || "").toLowerCase().includes(txt))) continue;
          if (i.near) { const p = d.plan(f), c = p && p.curve ? [(p.curve.start[0] + p.curve.end[0]) / 2, (p.curve.start[1] + p.curve.end[1]) / 2] : d.argValue(f, "position"); if (!c) continue;
            if (Math.hypot(c[0] - Number(i.near.x), c[1] - Number(i.near.y)) > (Number(i.near.r) || 3000)) continue; }
          out.push(elementBrief(d, f)); if (out.length >= lim) break;
        }
        return { found: out.length, elements: out };
      } },
    { name: "get_element", description: "Read one element in full: its type, every argument and parameter (JSON). Use before changing an element you have not read.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      execute(i) { const d = doc(), f = d.element(String(i.id)); if (!f) throw new Error(`there is no element ${i.id}`); return paClip(paRound(Object.assign(d.elementJSON(f), d.error(f) ? { error: d.error(f) } : {})), 12000); } },
    { name: "describe_element_type", description: "The arguments an element type takes (key, kind, default, choices) - read this before adding an element of a type you have not added yet. Also lists the library's types of a family when given family (e.g. F-BASICWALL, F-FLOOR, F-SINGLEDOOR).",
      inputSchema: { type: "object", properties: { type: { type: "string" }, family: { type: "string" } } },
      execute(i) {
        if (i.family) return Object.entries(doc().lib.types || {}).filter(([, t]) => t.family === String(i.family)).map(([id, t]) => paClip(Object.assign({ id }, t), 1500));
        const decl = CATALOGUE.get(String(i.type)); if (!decl) throw new Error(`no element type ${i.type}; types: ${[...CATALOGUE.keys()].join(", ")}`);
        return { type: i.type, summary: decl.summary, args: decl.args.map(a => paClip({ key: a.key, kind: a.kind, default: a.default, choices: a.choices, ref: a.kinds }, 300)) };
      } },
    { name: "apply_edits", description: "Change the model: a list of ops applied together as ONE undoable step. Ops: {op:'add', element:{type, id?, name?, args:{...}}}; {op:'set', id, key, value} (key may be a dotted path; a Real can be given as text with units: {op:'set', id, key, text:\"10'-6\\\"\"}); {op:'delete', id}; {op:'transform', ids, move:[dx,dy]} or rotate:{c:[x,y],a:radians} or mirror:{p,d}, copy:true to copy; {op:'rename', id, name}; {op:'type', lib:'types', id, value} to add or change a type; {op:'autojoin', ends:[{id,end:'start'|'end'}]}. References are {ref:id}; lines {type:'line', start:[x,y], end:[x,y]} in mm. Returns ok, the new ids, and any element now in error.",
      inputSchema: { type: "object", properties: { ops: { type: "array", items: { type: "object" } }, reason: { type: "string" } }, required: ["ops"] },
      execute(i) {
        const ops = Array.isArray(i.ops) ? i.ops : []; if (!ops.length) throw new Error("no ops");
        for (const o of ops) if (!o || !PA_EDIT_OPS.has(o.op)) throw new Error(`op "${o && o.op}" is not allowed here; use one of ${[...PA_EDIT_OPS].join(", ")}`);
        const before = new Set(doc().elements().filter(f => doc().error(f)).map(f => doc().idOf(f))), had = new Set(doc().elements().map(f => doc().idOf(f)));
        const r = app.apply(ops.length === 1 ? ops[0] : ops, { quiet: true });
        if (!r.ok) throw new Error(r.error || (r.conflicts || []).map(c => c.say).join("; ") || "the edit was refused");
        log.steps++; log.ops.push(...ops.map(o => ({ op: o.op, id: o.id || (o.element && o.element.id) || o.ids, key: o.key })));
        if (app.refresh) app.refresh();
        const now = doc().elements().filter(f => doc().error(f) && !before.has(doc().idOf(f))).map(f => ({ id: doc().idOf(f), error: doc().error(f) }));
        const added = doc().elements().map(f => doc().idOf(f)).filter(id => !had.has(id)), removed = [...had].filter(id => !doc().element(id));
        return { ok: true, added: added.slice(0, 50), removed: removed.slice(0, 50), new_errors: now.slice(0, 10), note: r.said || null };
      } },
    { name: "open_view", description: "Open a view or sheet for the architect (by id), e.g. to show the result of a change.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      execute(i) { const id = String(i.id); if (!doc().element(id)) throw new Error(`there is no view ${id}`); app.openView(id); log.opened = id; return { opened: id }; } },
  ];
}

/** The standing instructions: who Claude is here, how to work the model, and how to answer. */
export const PA_RULES = `You are the production architect inside a BIM app, working on the architect's model while they design and curate the drawing set. The architect wrote the prompt below about this project, possibly with images (sketches, markups, screenshots). Act on it by editing the model with the tools; do not just describe what could be done.

How to work:
- Read before you write: find_elements / get_element for what you change; describe_element_type before adding a type of element you have not added.
- Keep the model's system: snap to its grids and levels, use its existing wall, floor and door types, keep walls joined (autojoin the ends of walls you add). Units are mm.
- Change only what was asked. Never delete what the prompt does not ask to remove. Prefer changing an element (set) to deleting and re-adding it.
- A sketch or markup is design intent: regularise it to the grid and module; do not trace pixels.
- If the prompt is ambiguous in a way that changes the design, make the most sensible reading, say which, and list what the architect should confirm.
- Group related edits into one apply_edits call where you can.

When done, reply in a few short lines for the architect: what you changed (element ids), what you assumed, anything you could not do and why. Plain text, no markdown headings.`;

/** The prompt, its thread and the model, as one input for Claude. */
export function agentInput(doc, entry, ctx) {
  const log = promptLog(doc).entries, chain = []; let e = entry;
  while (e && e.parent) { e = log.find(x => x.id === e.parent); if (e) chain.unshift(e); }
  const thread = chain.map(x => `${x.author === "claude" ? "Claude" : "Architect"} (${x.id}): ${x.text}`).join("\n");
  const c = entry.context || {};
  return `${PA_RULES}

THE MODEL NOW:
${JSON.stringify(modelSummary(doc, ctx)).slice(0, 30000)}
${thread ? `\nEARLIER IN THIS THREAD:\n${thread}\n` : ""}
THE PROMPT (${entry.id}${c.sheet ? `, written on sheet ${c.sheet}` : c.view ? `, written in view ${c.viewName || c.view}` : ""}${c.selection ? `, with ${c.selection.join(", ")} selected` : ""}${entry.images ? `, ${entry.images.length} image(s) attached: ${entry.images.map(i => i.name).join(", ")}` : ""}):
${entry.text || "(no words: see the images)"}`;
}

const paBlob = im => { const b = atob(im.data.slice(im.data.indexOf(",") + 1)), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Blob([u], { type: im.type }); };

/** Ask Claude to act on a prompt entry. `sample` is claude.use("sample")'s function. Resolves with Claude's
 *  reply entry (added to the log); on failure, rejects with the sample error after logging what was done. */
export async function runPromptAgent(app, sample, entry, { onText, signal, onTool } = {}) {
  const log = { steps: 0, ops: [], opened: null };
  const tools = agentTools(app, log).map(t => Object.assign({}, t, { execute: (i, c) => { if (onTool) onTool(t.name, i); return t.execute(i, c); } }));
  const opts = { tools, signal, onText, modelTier: "default" };
  if (entry.images && entry.images.length) {
    const lim = await sample.limits().catch(() => null);
    if (lim && lim.images) opts.images = entry.images.slice(0, lim.images.maxCount).map(paBlob);
  }
  let text = "", failure = null;
  try { text = (await sample(agentInput(app.doc, entry, { activeView: app.activeView, selection: [...app.selection] }), opts)).text; }
  catch (e) { failure = e; text = e.text || ""; }
  const done = log.steps ? `\n\n[${log.steps} change${log.steps > 1 ? "s" : ""} to the model: ${log.ops.map(o => `${o.op} ${[].concat(o.id || "").join(",")}${o.key ? "." + o.key : ""}`).join("; ")}]` : "";
  const why = failure && failure.code !== "cancelled" ? `\n\n(Stopped: ${failure.message || failure.code})` : failure ? "\n\n(Stopped by the architect.)" : "";
  const reply = addPrompt(app.doc, { author: "claude", parent: entry.id, text: (text.trim() || (log.steps ? "Done." : "No change made.")) + done + why });
  if (log.steps) reply.edits = { steps: log.steps, ops: log.ops };
  if (failure && !log.steps) entry.status = "open";           // nothing was done: the prompt is still to do
  if (failure && failure.code !== "cancelled" && !log.steps) { const err = new Error(failure.message || failure.code); err.code = failure.code; err.reply = reply; throw err; }
  return reply;
}
