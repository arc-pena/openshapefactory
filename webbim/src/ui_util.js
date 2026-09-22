//! Small DOM vocabulary shared by the interface modules. The interface only
//! mirrors the document: nothing here owns model state.

import { FONT_TTF_B64 } from "./fontdata.js";

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const svgNS = "http://www.w3.org/2000/svg";
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === undefined || v === null) continue; if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v); else el.setAttribute(k, v); }
  for (const k of kids.flat()) if (k) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** Tool icons, drawn at 18px on a 20-unit grid: a plan-view vocabulary. */
const P = d => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICONS = {
  select: P('<path d="M4 3l11 6-5 1.5L8 16z"/>'),
  wall: P('<path d="M2 7h16M2 12h16"/><path d="M2 7v5M18 7v5" opacity=".5"/><path d="M6 7l-2 5M10 7l-2 5M14 7l-2 5M18 7l-2 5" stroke-width="1"/>'),
  opening: P('<path d="M2 8h5M13 8h5M2 12h5M13 12h5M7 8v4M13 8v4"/>'),
  door: P('<path d="M2 14h4M14 14h4M6 14V4"/><path d="M6 4a10 10 0 0 1 8 10" stroke-dasharray="2 1.6"/>'),
  window: P('<path d="M2 8h16M2 12h16M5 8v4M15 8v4M5 10h10" />'),
  column: P('<rect x="6" y="6" width="8" height="8"/><path d="M6 6l8 8M14 6l-8 8" stroke-width="1"/>'),
  grid: P('<circle cx="10" cy="4" r="2.5"/><path d="M10 6.5V18" stroke-dasharray="3 1.5 1 1.5"/>'),
  text: P('<path d="M4 5h12M10 5v11M7 16h6"/>'),
  dim: P('<path d="M3 6v8M17 6v8M3 10h14"/><path d="M5 8l-2 2 2 2M15 8l2 2-2 2"/>'),
  space: P('<rect x="3" y="4" width="14" height="12" stroke-dasharray="2 1.5"/><path d="M7 9h6M8 12h4" stroke-width="1.2"/>'),
  elev: P('<circle cx="10" cy="10" r="4"/><path d="M10 2l3 4H7zM2 10h4M14 10h4"/>'),
  sep: P('<path d="M3 16L17 4" stroke-dasharray="3 2"/>'),
  undo: P('<path d="M7 5L3 9l4 4"/><path d="M3 9h9a5 5 0 0 1 0 10h-2"/>'),
  redo: P('<path d="M13 5l4 4-4 4"/><path d="M17 9H8a5 5 0 0 0 0 10h2"/>'),
  menu: P('<path d="M3 6h14M3 10h14M3 14h14"/>'),
  props: P('<path d="M4 5h12M4 10h12M4 15h8"/><circle cx="14" cy="15" r="1.5"/>'),
  pick: P('<circle cx="10" cy="10" r="6"/><path d="M10 2v4M10 14v4M2 10h4M14 10h4"/>'),
  lock: P('<rect x="5" y="9" width="10" height="8" rx="1"/><path d="M7 9V6a3 3 0 0 1 6 0v3"/>'),
  unlock: P('<rect x="5" y="9" width="10" height="8" rx="1"/><path d="M7 9V6a3 3 0 0 1 6 0"/>'),
  graph: P('<rect x="2" y="3" width="6" height="5" rx="1"/><rect x="12" y="12" width="6" height="5" rx="1"/><path d="M8 5.5c4 0 0 9 4 9"/>'),
  fit: P('<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/><rect x="7" y="7" width="6" height="6"/>'),
  move: P('<path d="M10 2v16M2 10h16M10 2l-2.5 2.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5"/>'),
  copy: P('<rect x="3" y="3" width="10" height="10"/><rect x="7" y="7" width="10" height="10" fill="currentColor" fill-opacity=".12"/>'),
  rotate: P('<path d="M15.5 6.5A7 7 0 1 0 17 11"/><path d="M16 2v5h-5"/><circle cx="10" cy="10" r="1.2"/>'),
  mirror: P('<path d="M10 2v16" stroke-dasharray="2 1.5"/><path d="M8 5L3 15h5zM12 5l5 10h-5z"/>'),
  del: P('<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11M9 9v6M11 9v6"/>'),
  level: P('<path d="M2 8h12" stroke-dasharray="3 1.5 1 1.5"/><path d="M14 8l2-2 2 2-2 2z"/><path d="M2 15h12" stroke-dasharray="3 1.5 1 1.5"/><path d="M14 15l2-2 2 2-2 2z"/>'),
  room: P('<path d="M3 4h14v12H3z"/><path d="M7 9h6M8 12h4" stroke-width="1.2"/><path d="M3 4l3 3M17 4l-3 3" stroke-width="1"/>'),
  plan: P('<path d="M3 3h14v14H3z"/><path d="M3 10h7v7M10 3v4" /><path d="M12 12h3"/>'),
  view3d: P('<path d="M10 2l7 4v8l-7 4-7-4V6z"/><path d="M10 10l7-4M10 10v8M10 10L3 6"/>'),
  house: P('<path d="M10 2l7 4v8l-7 4-7-4V6z" fill="currentColor" fill-opacity=".1"/><path d="M10 10l7-4M10 10v8M10 10L3 6"/>'),
  sheet: P('<rect x="3" y="2" width="14" height="16"/><path d="M11 13h6M11 13v5M6 5h6v5H6z"/>'),
  schedule: P('<rect x="3" y="3" width="14" height="14"/><path d="M3 7h14M3 11h14M3 15h14M8 3v14"/>'),
  vv: P('<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.5"/>'),
  thin: P('<path d="M3 5h14" stroke-width="3"/><path d="M3 11h14" stroke-width="1.6"/><path d="M3 16h14" stroke-width=".7"/>'),
  open: P('<path d="M2 5h6l2 2h8v9H2z"/>'),
  save: P('<path d="M3 3h11l3 3v11H3z"/><path d="M6 3v5h7V3M6 17v-6h8v6"/>'),
  edittype: P('<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M6 7h8M6 10h8M6 13h5"/><path d="M13 16l4-4" stroke-width="2"/>'),
  tree: P('<path d="M4 3v14M4 6h4M4 11h4M4 16h4"/><rect x="9" y="4" width="8" height="4"/><rect x="9" y="9" width="8" height="4"/><rect x="9" y="14" width="8" height="3"/>'),
  importI: P('<path d="M10 2v10M6 8l4 4 4-4"/><path d="M3 13v4h14v-4"/>'),
  exportI: P('<path d="M10 12V2M6 6l4-4 4 4"/><path d="M3 13v4h14v-4"/>'),
  tests: P('<path d="M4 10l4 4 8-8"/><rect x="2" y="2" width="16" height="16" rx="2"/>'),
  pens: P('<path d="M4 16l9-9 3 3-9 9H4z"/><path d="M12 4l4 4" /><path d="M2 5h5M2 8h3" stroke-width="1"/>'),
  info: P('<circle cx="10" cy="10" r="8"/><path d="M10 9v5M10 6v.5"/>'),
  elevview: P('<circle cx="10" cy="11" r="4"/><path d="M10 3l3 4H7z" fill="currentColor"/>'),
  symbol: P('<circle cx="10" cy="10" r="7"/><path d="M10 4l3 11-3-2-3 2z"/>'),
  close: P('<path d="M5 5l10 10M15 5L5 15"/>'),
  sepline: P('<path d="M3 17L17 3" stroke-dasharray="3 2"/><path d="M3 3h5M3 3v5" stroke-width="1"/>'),
};
export const icon = (name, size = 18) => h("span", { class: "ic", html: ICONS[name] || "", style: { display: "inline-grid", width: size + "px", height: size + "px" }, "aria-hidden": "true" });

// ---------------------------------------------------------------- storage (per-viewer conveniences only)
export function store(key, value) { try { if (value === undefined) return JSON.parse(localStorage.getItem("webbim:" + key)); localStorage.setItem("webbim:" + key, JSON.stringify(value)); } catch (e) { return undefined; } }
export function forget(key) { try { localStorage.removeItem("webbim:" + key); } catch (e) { /* storage may be blocked */ } }

// ---------------------------------------------------------------- saving files
/** The artifact frame blocks page-started downloads; the platform's
 *  `downloads` capability asks the viewer instead. Served on its own, the page
 *  falls back to an ordinary download link. */
let DL = null;
export async function downloadsCapability() {
  if (DL !== null) return DL;
  try { DL = window.claude && window.claude.use ? await window.claude.use("downloads") : false; } catch (e) { DL = false; }
  return DL || false;
}
export async function saveFile(filename, data, mime = "application/octet-stream") {
  const cap = await downloadsCapability();
  if (cap) {
    try { await cap.save({ filename, data: data instanceof Uint8Array ? data.slice(0) : data }); return { ok: true, via: "viewer" }; }
    catch (e) { return { ok: false, error: e && e.code === "declined" ? "the save was declined" : `the viewer could not save it (${e && e.code || e})` }; }
  }
  if (window.claude) return { ok: false, error: "saving files is not available in this view" };
  const blob = new Blob([data], { type: mime });
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  return { ok: true, via: "browser" };
}

// ---------------------------------------------------------------- the one font
/** Register the embedded DejaVu subset for canvas text: the same bytes the PDF
 *  embeds, so screen and paper measure text identically. */
export async function loadDrawingFont() {
  try {
    const bin = atob(FONT_TTF_B64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const face = new FontFace("WebBIMSans", bytes.buffer);
    await face.load(); document.fonts.add(face); return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- dialogs
export function dialog(title, body, actions = []) {
  const back = h("div", { class: "dialog-back", role: "presentation" });
  const close = () => back.remove();
  const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("header", {}, h("h2", {}, title), h("button", { class: "btn ghost small", onclick: close, "aria-label": "Close" }, "✕")),
    h("div", { class: "body" }, body),
    actions.length ? h("footer", {}, actions.map(a => h("button", { class: "btn" + (a.primary ? " primary" : ""), onclick: () => { if (a.run() !== false) close(); } }, a.label))) : null);
  back.append(dlg);
  back.addEventListener("pointerdown", e => { if (e.target === back) close(); });
  back.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  document.body.append(back);
  const first = dlg.querySelector("input, select, button.primary"); if (first) first.focus();
  return { close, el: dlg };
}
export const fmtLen = v => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(1));
