'use strict';
/* =====================================================================
   Diagram Compositor — node-based image graph over a parametric model.
   One document is the single source of truth; the canvas, properties,
   layers view, matrix and files list are all views of it.
   ===================================================================== */

// ---------- small utilities ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const deepClone = o => JSON.parse(JSON.stringify(o));
const sleep0 = () => new Promise(r => setTimeout(r, 0));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
let _uidN = 0;
function uid(prefix = 'n') { _uidN++; return prefix + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6) + _uidN.toString(36); }

// FNV-1a 32-bit, run twice with different seeds for a 64-bit-ish key.
function fnv(str, seed = 0x811c9dc5) {
  let h1 = seed >>> 0;
  for (let i = 0; i < str.length; i++) { h1 ^= str.charCodeAt(i); h1 = Math.imul(h1, 0x01000193) >>> 0; }
  return h1;
}
function hashStr(str) { return fnv(str).toString(36) + fnv(str, 0x9747b28c).toString(36); }
function stableJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableJSON).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableJSON(v[k])).join(',') + '}';
}
const hashObj = o => hashStr(stableJSON(o));

// ---------- colour ----------
function parseColour(s) {
  if (Array.isArray(s)) return s.length === 3 ? [...s, 1] : s;
  s = String(s || '').trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let x = m[1];
    if (x.length === 3 || x.length === 4) x = x.split('').map(c => c + c).join('');
    const n = parseInt(x.slice(0, 6), 16), a = x.length === 8 ? parseInt(x.slice(6), 16) / 255 : 1;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, a];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(',').map(parseFloat); return [p[0] / 255, p[1] / 255, p[2] / 255, p[3] == null ? 1 : p[3]]; }
  return [0, 0, 0, 1];
}
const toHex2 = v => Math.round(clamp(v) * 255).toString(16).padStart(2, '0');
function colourHex(c) { c = parseColour(c); return '#' + toHex2(c[0]) + toHex2(c[1]) + toHex2(c[2]); }
function colourCss(c) { c = parseColour(c); return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`; }
const srgbToLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const linToSrgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

// ---------- parametric values: a safe expression parser (no eval) ----------
// Units convert to metres for lengths; px and % are passed through as plain numbers.
const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, px: 1, pt: 1, deg: 1, '%': 1 };
const FUNCS = { sqrt: Math.sqrt, sin: x => Math.sin(x * Math.PI / 180), cos: x => Math.cos(x * Math.PI / 180), tan: x => Math.tan(x * Math.PI / 180),
  abs: Math.abs, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, pow: Math.pow, clamp: (x, a, b) => clamp(x, a, b), log: Math.log, exp: Math.exp };
function tokenizeExpr(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
      if (!m) throw new Error(`Bad number near "${s.slice(i, i + 6)}"`);
      out.push({ t: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_$%]/.test(c)) { let j = i + 1; if (c !== '%') while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++; out.push({ t: 'id', v: s.slice(i, j) }); i = j; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}
function evalExpr(src, names = {}) {
  if (typeof src === 'number') return src;
  const toks = tokenizeExpr(String(src)); let p = 0;
  const peek = () => toks[p], take = t => { const k = toks[p]; if (!k || (t && k.t !== t)) throw new Error(`Expected ${t || 'value'}`); p++; return k; };
  function primary() {
    const k = peek(); if (!k) throw new Error('Incomplete expression');
    if (k.t === '-') { p++; return -power(); }
    if (k.t === '+') { p++; return power(); }
    if (k.t === '(') { p++; const v = expr(); take(')'); return unit(v); }
    if (k.t === 'n') { p++; return unit(k.v); }
    if (k.t === 'id') {
      p++;
      if (peek() && peek().t === '(') {
        const f = FUNCS[k.v]; if (!f) throw new Error(`Unknown function ${k.v}`);
        p++; const args = []; if (peek() && peek().t !== ')') { args.push(expr()); while (peek() && peek().t === ',') { p++; args.push(expr()); } }
        take(')'); return unit(f(...args));
      }
      if (k.v === 'pi') return Math.PI;
      if (k.v in names) return unit(+names[k.v]);
      throw new Error(`Unknown name "${k.v}"`);
    }
    throw new Error('Unexpected symbol');
  }
  function unit(v) { const k = peek(); if (k && k.t === 'id' && k.v in UNITS && !(k.v in names)) { p++; return v * UNITS[k.v]; } return v; }
  function power() { let v = primary(); while (peek() && peek().t === '^') { p++; v = Math.pow(v, primary()); } return v; }
  function term() { let v = power(); while (peek() && (peek().t === '*' || peek().t === '/')) { const o = toks[p++].t; const r = power(); v = o === '*' ? v * r : v / r; } return v; }
  function expr() { let v = term(); while (peek() && (peek().t === '+' || peek().t === '-')) { const o = toks[p++].t; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
  const v = expr(); if (p < toks.length) throw new Error('Unexpected trailing input');
  if (!isFinite(v)) throw new Error('Result is not a finite number');
  return v;
}

// ---------- token substitution for filenames, prompts, paths ----------
function fillTokens(str, vars, missing) {
  return String(str).replace(/\{([a-zA-Z_][\w]*)(?::(\d+))?\}/g, (m, k, pad) => {
    if (!(k in vars)) { if (missing) missing.add(k); return m; }
    let v = String(vars[k]);
    if (pad && /^\d+$/.test(v)) v = v.padStart(+pad, '0');
    return v;
  });
}

// ---------- the document ----------
// Format follows the OCAF-style rule: features keyed by stable id, inputs reference
// other features by id (never by array position), new fields only ever appended.
const DOC_FORMAT = 'diagram-compositor-graph/1';
let doc = null;          // the open document
let view = { path: [] }; // breadcrumb of group-instance ids we have stepped into

function newDoc() {
  return {
    format: DOC_FORMAT, name: 'Untitled graph',
    settings: { project: 'COMP', width: 2400, height: 1800, dpi: 300, preview: 0.34, mult: 1, autosave: true, debounce: 2 },
    nodes: {}, defs: {}, models: {}, previewRow: 0,
  };
}
// The graph being edited: the root, or a group definition we stepped into.
function currentGraph() {
  if (!view.path.length) return doc;
  const inst = view.path[view.path.length - 1];
  return doc.defs[inst.def];
}
function graphKey(g) { return g === doc ? 'root' : 'def:' + g.id; }
function scopeForView() {
  // Scope chain lets Group Input nodes inside a def resolve to the instance's wires.
  let scope = null, g = doc;
  for (const step of view.path) { scope = { graph: g, groupId: step.node, parent: scope }; g = doc.defs[step.def]; }
  return scope;
}

// ---------- undo: one step per user action ----------
const undo = { stack: [], redo: [], pending: null, limit: 120 };
const snapshot = () => JSON.stringify(doc);
function beginEdit() { if (undo.pending == null) undo.pending = snapshot(); }
function endEdit() {
  if (undo.pending == null) return;
  const before = undo.pending; undo.pending = null;
  if (before === snapshot()) return;
  undo.stack.push(before); if (undo.stack.length > undo.limit) undo.stack.shift();
  undo.redo.length = 0; docChanged();
}
function mutate(fn) { beginEdit(); fn(); endEdit(); }
function doUndo() {
  if (undo.pending != null) endEdit();
  const s = undo.stack.pop(); if (!s) return toast('Nothing to undo');
  undo.redo.push(snapshot()); restoreDoc(s);
}
function doRedo() {
  const s = undo.redo.pop(); if (!s) return toast('Nothing to redo');
  undo.stack.push(snapshot()); restoreDoc(s);
}
function restoreDoc(s) {
  doc = JSON.parse(s);
  view.path = view.path.filter(st => doc.defs[st.def]);
  for (const id of [...ui.sel]) if (!currentGraph().nodes[id]) ui.sel.delete(id);
  docChanged(true);
}

// ---------- toasts ----------
function toast(msg, kind) {
  const t = h('div', { class: kind || '' }, msg); $('#toast').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3200);
}

// ---------- local persistence (per-viewer convenience only) ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};
