//! Studio Atlas: what goes into a project and what comes out of it, logged as steps in the team's library (a Google
//! Sheet, the files in Google Drive). Provide Python, Save and Open each write a step: the file goes to the library's
//! files folder (up to 16 MB) and a row to its steps tab, under a stream named after the project, so the history of
//! what went in and out stays in one place with the prompt-to-output record of everything else.
//!
//! The page asks the viewer's Google Sheets and Drive connectors (the mcp capability). Without them - outside
//! claude.ai, or not allowed - nothing is logged and nothing breaks: the caller is told why.

const ATLAS_LIB = { sheet: "1cgGrEitA2-LMNknsb6ssuYXs8f3qxRtMMfIovf6V-l4", files: "17xjlstw2CW5rVlPLebvwrW3qzOEc7dUQ" };
const ATLAS_SHEETS = "Google Sheets", ATLAS_DRIVE = "Google Drive";
let atlasMcpNs, atlasFileArgs = null, atlasQueue = Promise.resolve();
/** Whether logging is on for this viewer (a setting kept in the browser; on unless turned off). */
export function atlasEnabled() { try { return localStorage.getItem("webbim-atlas") !== "off"; } catch (e) { return true; } }
export function setAtlasEnabled(on) { try { localStorage.setItem("webbim-atlas", on ? "on" : "off"); } catch (e) { /* the setting lasts this visit only */ } }
async function atlasMcp() {
  if (atlasMcpNs !== undefined) return atlasMcpNs;
  try { atlasMcpNs = window.claude && window.claude.use ? await window.claude.use("mcp") : null; } catch (e) { atlasMcpNs = null; }
  return atlasMcpNs;
}
async function atlasCall(server, tool, input) {
  const m = await atlasMcp(); if (!m) throw new Error("the Google connectors are not available in this view");
  for (let i = 0; ; i++) {
    try {
      const r = await m.callTool(server, tool, input, { cache: false });
      let p = r && r.payload !== undefined ? r.payload : r;
      if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { /* plain text */ } }
      return p;
    } catch (e) {
      if (e && e.retryable && i < 2) { await new Promise(res => setTimeout(res, e.retryAfterMs || 1500 * (i + 1))); continue; }
      throw new Error(e && e.message ? e.message : String(e && e.code || e));
    }
  }
}
const atlasCell = v => { if (v == null) return ""; const s = typeof v === "string" ? v : JSON.stringify(v); return s ? "'" + s : ""; };
const atlasSlug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function atlasB64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }

/** One step in the library: { stream, category, title?, prompt, vars, inputs: [{ label }], outputs: [{ name, mime,
 *  data (string or bytes), role }], note }. Steps are written one at a time, in the order asked.
 *  Resolves { ok, id, label, stream, uploaded } or { ok: false, error }. */
export function atlasLog(step) {
  const run = atlasQueue.then(() => atlasWrite(step), () => atlasWrite(step));
  atlasQueue = run.catch(() => null);
  return run;
}
async function atlasWrite(step) {
  try {
    if (!atlasEnabled()) return { ok: false, error: "Studio Atlas logging is off" };
    const m = await atlasMcp(); if (!m) return { ok: false, error: "the Google connectors are not available in this view" };
    // the first call alone: it is the one that asks the viewer's consent
    const sv = ((await atlasCall(ATLAS_SHEETS, "get_values", { spreadsheetId: ATLAS_LIB.sheet, range: "streams!A1:C" })) || {}).values || [];
    const now = new Date().toISOString(), want = step.stream.trim().toLowerCase();
    const hit = sv.slice(1).find(r => (r[1] || "").trim().toLowerCase() === want);
    let streamId = hit && hit[0];
    if (!streamId) {
      streamId = "x-" + atlasSlug(step.stream).slice(0, 40) + "-" + Math.random().toString(36).slice(2, 5);
      await atlasCall(ATLAS_SHEETS, "append_values", { spreadsheetId: ATLAS_LIB.sheet, range: "streams!A1", values: [[streamId, step.stream.trim(), step.category || "data", "", now, "", "Web BIM project: what went in and what came out", "", now].map(atlasCell)] });
    }
    const rows = (((await atlasCall(ATLAS_SHEETS, "get_values", { spreadsheetId: ATLAS_LIB.sheet, range: "steps!A1:F" })) || {}).values || []).slice(1).filter(r => r[2] === streamId && r[4] !== "hidden");
    rows.sort((a, b) => (Date.parse(a[5]) || 0) - (Date.parse(b[5]) || 0));
    const parent = rows.length ? rows[rows.length - 1][0] : "";
    const revs = rows.map(r => /^[R](\d+)$/.exec(r[3] || "")).filter(Boolean).map(x => +x[1]);
    const label = step.title || "R" + String((revs.length ? Math.max(...revs) : 0) + 1).padStart(2, "0");
    if (atlasFileArgs === null) { try { const t = await m.listTools(); atlasFileArgs = !!(t && t.fileArgs); } catch (e) { atlasFileArgs = false; } }
    const outputs = [];
    for (const o of step.outputs || []) {
      const bytes = typeof o.data === "string" ? new TextEncoder().encode(o.data) : o.data, name = o.name;
      if (!atlasFileArgs && bytes.length > 700000) { outputs.push({ name: o.name, ext: o.name.split(".").pop(), mime: o.mime, size: bytes.length, role: o.role || "main", at: "claude-outputs" }); continue; }
      const content = atlasFileArgs ? { $file: { data: new Blob([bytes], { type: o.mime }), name, type: o.mime } } : atlasB64(bytes);
      const p = await atlasCall(ATLAS_DRIVE, "create_file", { title: name, parentId: ATLAS_LIB.files, base64Content: content, contentMimeType: o.mime, disableConversionToGoogleType: true });
      outputs.push({ name, ext: o.name.split(".").pop(), mime: o.mime, size: bytes.length, role: o.role || "main", at: p && p.id ? "drive" : "claude-outputs", id: p && p.id });
    }
    const id = "st-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const row = [id, parent, streamId, label, "done", now, "", "run", step.prompt, step.vars || {}, "web-bim", "", step.inputs || [], outputs, "", step.note || "", "", label, now, ""].map(atlasCell);
    await atlasCall(ATLAS_SHEETS, "append_values", { spreadsheetId: ATLAS_LIB.sheet, range: "steps!A1", values: [row] });
    return { ok: true, id, label, stream: step.stream.trim(), uploaded: outputs.filter(o => o.at === "drive").length };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}
