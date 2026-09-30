//! The project's conversation: the architect's prompts (text, images, the view and selection they were
//! written about) and Claude's answers, kept in the project file under meta.prompts so the next session -
//! Claude's or the architect's - picks the thread up where it was left. Entries form a tree through
//! `parent`: a root is a topic, replies and follow-ups nest under it. The architect's entries are the
//! project's record: they are never rewritten, only answered and marked.

export const PROMPT_STATUSES = ["open", "answered", "done"];

/** The project's prompt log, made on first use. */
export function promptLog(doc) {
  if (!doc.meta.prompts || !Array.isArray(doc.meta.prompts.entries)) doc.meta.prompts = { version: 1, entries: [] };
  return doc.meta.prompts;
}
/** Add an entry: { text, images, context, author, parent } -> the entry (with its id, time and status). */
export function addPrompt(doc, e) {
  const log = promptLog(doc), n = log.entries.reduce((m, x) => Math.max(m, +String(x.id).replace(/\D/g, "") || 0), 0) + 1;
  if (e.parent && !log.entries.some(x => x.id === e.parent)) throw new Error(`no prompt ${e.parent} to reply to`);
  const entry = { id: `P${n}`, parent: e.parent || null, at: e.at || new Date().toISOString(), author: e.author || "architect", text: String(e.text || "").trim(),
    status: e.status || (e.author === "claude" ? "answered" : "open") };
  if (e.images && e.images.length) entry.images = e.images;
  if (e.context && Object.keys(e.context).length) entry.context = e.context;
  if (!entry.text && !entry.images) throw new Error("a prompt needs words or an image");
  log.entries.push(entry);
  // an answer marks what it answers
  if (entry.author === "claude" && entry.parent) { const p = log.entries.find(x => x.id === entry.parent); if (p && p.status === "open") p.status = "answered"; }
  return entry;
}
export function setPromptStatus(doc, id, status) {
  if (!PROMPT_STATUSES.includes(status)) throw new Error(`status must be one of ${PROMPT_STATUSES.join(", ")}`);
  const e = promptLog(doc).entries.find(x => x.id === id); if (!e) throw new Error(`no prompt ${id}`); e.status = status; return e;
}
/** Remove an entry and everything under it. */
export function removePrompt(doc, id) {
  const log = promptLog(doc), gone = new Set([id]);
  let grew = true; while (grew) { grew = false; for (const x of log.entries) if (x.parent && gone.has(x.parent) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }
  log.entries = log.entries.filter(x => !gone.has(x.id)); return gone.size;
}
/** The log as a tree: roots newest first, each node's replies in the order they were written. */
export function promptTree(doc) {
  const es = promptLog(doc).entries, kids = new Map();
  for (const e of es) { const k = e.parent && es.some(x => x.id === e.parent) ? e.parent : null; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(e); }
  const node = e => ({ entry: e, replies: (kids.get(e.id) || []).map(node) });
  return (kids.get(null) || []).slice().reverse().map(node);
}
/** The open threads written out for Claude: each topic with its context, its words, its images by name and
 *  the replies so far - what to paste into a conversation (the images themselves travel in the file). */
export function promptBrief(doc, { all = false } = {}) {
  const lines = [`# ${doc.meta.name || "Project"}: prompts${all ? "" : " still open"}`, "",
    "The images are in the project file (meta.prompts, each entry's images). Answer each open entry by adding a reply with author \"claude\".", ""];
  const walk = (n, depth) => { const e = n.entry, pad = "  ".repeat(depth), c = e.context || {};
    const where = [c.sheet && `sheet ${c.sheet}`, c.view && `view ${c.view}`, c.selection && c.selection.length && `selected ${c.selection.join(", ")}`].filter(Boolean).join("; ");
    lines.push(`${pad}- **${e.id}** (${e.author}, ${e.status}, ${e.at.slice(0, 16).replace("T", " ")})${where ? ` [${where}]` : ""}`);
    for (const l of (e.text || "").split("\n")) lines.push(`${pad}  ${l}`);
    for (const im of e.images || []) lines.push(`${pad}  image: ${im.name} (${im.w}×${im.h})`);
    for (const r of n.replies) walk(r, depth + 1); };
  const open = n => n.entry.status === "open" || n.replies.some(open);
  for (const n of promptTree(doc)) if (all || open(n)) walk(n, 0);
  return lines.join("\n");
}
