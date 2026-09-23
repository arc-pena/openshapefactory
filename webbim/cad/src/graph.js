// The same document, drawn as a graph.
//
// The specification tree and this canvas are one acyclic graph seen from two
// sides. The tree reads it top to bottom, in the order the solver executes; the
// graph reads it left to right, along the references that put it in that order.
// Neither owns anything. Both send the edits in mdl.js and redraw from what
// comes back, so a slider dragged here and the same slider dragged in the
// definition panel are the same line of JSON arriving by two routes.
//
// It opens in a window of its own, inside the page: moved, resized, minimised
// to its title bar, closed. Inside, because a real browser window is not
// reliably a window - a sandboxed frame refuses to give one at all, and a
// browser set to open popups as tabs gives a whole tab with the model hidden
// behind it. The button in its bar asks for a real one when that is what you
// want, which is what to do with a second screen.

import { MDL_OPS, parseEdits } from "./mdl.js";
import { acceptsFrom, sliderSpan } from "./ocaf.js";
import { membersOf, reachesOut, setInputGroups } from "./reuse.js";

const GRAPH_CSS = `
:root {
  --g-ground: #eef1f4; --g-dot: rgba(20,40,60,.16);
  --g-panel: #f7f9fb; --g-node: #ffffff; --g-line: rgba(20,40,60,.15);
  --g-line-soft: rgba(20,40,60,.08);
  --g-ink: #15212b; --g-ink-2: #4a5b69; --g-ink-3: #7d8d99;
  --g-accent: #0a6cb0; --g-accent-soft: rgba(10,108,176,.13); --g-accent-ink: #fff;
  --g-datum: #b07408; --g-good: #1c7a52; --g-bad: #bb3a2c; --g-bad-soft: rgba(187,58,44,.13);
  --g-wire: #8ea0ad; --g-num: #7a56c4; --g-crv: #1c7a52; --g-msh: #b06a13;
  --g-shadow: 0 1px 2px rgba(16,28,38,.10), 0 8px 26px rgba(16,28,38,.13);
  --g-sans: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --g-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
.g-dark {
  --g-ground: #0b1116; --g-dot: rgba(255,255,255,.10);
  --g-panel: #161e26; --g-node: #1b242d; --g-line: rgba(255,255,255,.12);
  --g-line-soft: rgba(255,255,255,.06);
  --g-ink: #e6eef4; --g-ink-2: #a6b6c2; --g-ink-3: #74858f;
  --g-accent: #4aa8ea; --g-accent-soft: rgba(74,168,234,.20); --g-accent-ink: #06131d;
  --g-datum: #e0a33c; --g-good: #4fb98a; --g-bad: #e2705f; --g-bad-soft: rgba(226,112,95,.17);
  --g-wire: #4d616f; --g-num: #a98cf0; --g-crv: #4fb98a; --g-msh: #e0a33c;
  --g-shadow: 0 1px 2px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.45);
}
.g-root, .g-root * { box-sizing: border-box; }
.g-root {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  font-family: var(--g-sans); font-size: 12px; color: var(--g-ink);
  background: var(--g-ground); overflow: hidden; -webkit-font-smoothing: antialiased;
}
.g-root button, .g-root input, .g-root select, .g-root textarea {
  font: inherit; color: inherit;
}

/* --------------------------------------------------------------- toolbar */
.g-bar {
  display: flex; align-items: center; gap: 6px; padding: 7px 10px;
  background: var(--g-panel); border-bottom: 1px solid var(--g-line); flex: none;
}
.g-bar .g-sep { width: 1px; height: 17px; background: var(--g-line); margin: 0 3px; }
.g-bar .g-spacer { flex: 1; }
.g-btn {
  display: inline-flex; align-items: center; gap: 5px; height: 25px; padding: 0 9px;
  border: 1px solid var(--g-line); border-radius: 6px; background: transparent;
  cursor: pointer; white-space: nowrap; font-size: 11.5px;
}
.g-btn:hover { background: var(--g-accent-soft); border-color: var(--g-accent); }
.g-btn.on { background: var(--g-accent); border-color: var(--g-accent); color: var(--g-accent-ink); }
.g-btn svg { width: 14px; height: 14px; }
.g-title { font-weight: 600; letter-spacing: .01em; margin-right: 2px; }
.g-sub { font-family: var(--g-mono); font-size: 10px; color: var(--g-ink-3); }

/* ---------------------------------------------------------------- canvas */
.g-canvas:focus { outline: none; }
.g-canvas {
  position: relative; flex: 1; overflow: hidden; cursor: grab;
  background-image: radial-gradient(var(--g-dot) 1px, transparent 1px);
  touch-action: none;
}
.g-canvas.panning { cursor: grabbing; }
.g-wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.g-wires path { fill: none; stroke: var(--g-wire); stroke-width: 1.8; }
.g-wires path.lit { stroke: var(--g-accent); stroke-width: 2.4; }
.g-wires path.dashed { stroke-dasharray: 5 4; opacity: .8; }
.g-wires circle { fill: var(--g-wire); }
.g-layer { position: absolute; top: 0; left: 0; transform-origin: 0 0; }

/* ----------------------------------------------------------------- nodes */
.g-node {
  position: absolute; width: 216px; background: var(--g-node);
  border: 1px solid var(--g-line); border-radius: 9px; box-shadow: var(--g-shadow);
  user-select: none;
}
.g-node.sel { border-color: var(--g-accent); box-shadow: 0 0 0 2px var(--g-accent-soft), var(--g-shadow); }
.g-node.bad { border-color: var(--g-bad); }
.g-node.datum { width: 190px; }
.g-node.off { opacity: .62; }
/* A SET, COLLAPSED. Marked out from the nodes it swallowed: a heavier edge and
   a tint, so a screen of nodes reads as "these four, and that folder". */
.g-node.g-set {
  width: 232px; border-width: 2px;
  border-color: color-mix(in srgb, var(--g-accent) 45%, var(--g-line));
  background: linear-gradient(var(--g-node), color-mix(in srgb, var(--g-accent) 5%, var(--g-node)));
}
.g-node.g-set > .g-head { font-weight: 600; }
.g-node.g-set .g-id { opacity: .75; }
.g-row.g-gives { flex-direction: row-reverse; text-align: right; }
.g-code.g-open { cursor: pointer; }
.g-code.g-open:hover { color: var(--g-accent); }
/* What feeds a set, standing at the left of its own graph. Small, because it
   is a signpost rather than a thing you edit. */
.g-node.g-inlet {
  width: 176px; border-style: dashed;
  background: color-mix(in srgb, var(--g-accent) 6%, var(--g-node));
}
.g-node.g-inlet .g-head { cursor: default; }
.g-port.out.slack { opacity: .45; }
.g-crumb {
  font-size: 10.5px; color: var(--g-ink-2); white-space: nowrap;
  max-width: 260px; overflow: hidden; text-overflow: ellipsis;
}
.g-btn.g-up[hidden] { display: none; }
.g-head {
  position: relative; display: flex; align-items: center; gap: 6px; padding: 7px 9px;
  cursor: move; border-bottom: 1px solid var(--g-line-soft); border-radius: 8px 8px 0 0;
}
.g-node.sel .g-head { background: var(--g-accent-soft); }
.g-head svg { width: 14px; height: 14px; flex: none; color: var(--g-ink-2); }
.g-node.datum .g-head svg { color: var(--g-datum); }
.g-nm {
  flex: 1; min-width: 0; font-weight: 600; font-size: 11.5px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.g-id { font-family: var(--g-mono); font-size: 9px; color: var(--g-ink-3); flex: none; }
.g-body { padding: 5px 9px 8px; }
.g-row { display: flex; align-items: center; gap: 6px; position: relative; min-height: 20px; }
.g-row + .g-row { margin-top: 3px; }
.g-row.wired-row { padding-left: 16px; }
.g-lab {
  font-size: 10.5px; color: var(--g-ink-2); flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.g-num {
  width: 58px; flex: none; text-align: right; height: 19px; padding: 0 4px;
  border: 1px solid var(--g-line); border-radius: 4px; background: transparent;
  font-family: var(--g-mono); font-size: 10px;
}
.g-num:focus { outline: none; border-color: var(--g-accent); }
.g-rng {
  -webkit-appearance: none; appearance: none; width: 100%; height: 12px;
  background: transparent; margin: 1px 0 0; cursor: ew-resize;
}
.g-rng::-webkit-slider-runnable-track { height: 3px; border-radius: 2px; background: var(--g-line); }
.g-rng::-moz-range-track { height: 3px; border-radius: 2px; background: var(--g-line); }
.g-rng::-webkit-slider-thumb {
  -webkit-appearance: none; width: 10px; height: 10px; border-radius: 50%;
  background: var(--g-accent); margin-top: -3.5px;
}
.g-rng::-moz-range-thumb { width: 10px; height: 10px; border: 0; border-radius: 50%; background: var(--g-accent); }
.g-seg { display: flex; gap: 2px; }
.g-seg button {
  flex: 1; height: 18px; padding: 0 5px; border: 1px solid var(--g-line);
  background: transparent; border-radius: 4px; font-size: 10px; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.g-seg button[aria-pressed="true"] { background: var(--g-accent); border-color: var(--g-accent); color: var(--g-accent-ink); }
.g-pick, .g-line {
  width: 100%; height: 20px; padding: 0 5px; border: 1px solid var(--g-line);
  border-radius: 4px; background: var(--g-node); font-size: 10.5px;
}
.g-line { font-family: var(--g-mono); font-size: 10px; }
.g-line:focus { outline: none; border-color: var(--g-accent); }
.g-pick:focus { outline: none; border-color: var(--g-accent); }
.g-params { max-height: 216px; overflow-y: auto; margin: 0 -3px; padding: 0 3px; }
.g-params::-webkit-scrollbar { width: 6px; }
.g-params::-webkit-scrollbar-thumb { background: var(--g-line); border-radius: 3px; }
.g-sect {
  font-family: var(--g-mono); font-size: 8.5px; letter-spacing: .09em;
  text-transform: uppercase; color: var(--g-ink-3); margin: 7px 0 3px;
}
.g-err {
  margin: 0 9px 8px; padding: 4px 6px; border-radius: 5px; font-size: 10px;
  background: var(--g-bad-soft); color: var(--g-bad); line-height: 1.35;
}
.g-data {
  margin: 5px 9px 8px; padding: 4px 7px; border-radius: 5px; font-family: var(--g-mono);
  font-size: 9.5px; line-height: 1.5; color: var(--g-ink-2); background: var(--g-line-soft);
  max-height: 58px; overflow: auto; word-break: break-word;
}
.g-node.panel { width: 250px; }
.g-node.panel .g-data { max-height: 128px; font-size: 10px; }
.g-data .g-count { color: var(--g-ink-3); }
.g-code {
  margin: 0 0 3px; padding: 3px 6px; border-radius: 5px; font-family: var(--g-mono);
  font-size: 9.5px; color: var(--g-ink-3); background: var(--g-line-soft);
  cursor: pointer; display: flex; justify-content: space-between; gap: 6px;
}
.g-code:hover { color: var(--g-accent); }

/* ----------------------------------------------------------------- ports */
.g-port {
  position: absolute; width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid var(--g-node); background: var(--g-wire); cursor: crosshair;
  z-index: 2;
}
.g-port.in { left: -7px; top: 50%; margin-top: -5.5px; }
.g-port.out { right: -6px; top: 50%; margin-top: -5.5px; }
.g-port.wired { background: var(--g-accent); }
/* A port is coloured by what goes through it, so a graph reads at a glance:
   numbers, points and curves each have their own. */
.g-port[data-kind="number"] { background: var(--g-num); }
.g-port[data-kind="point"], .g-port[data-kind="vector"] { background: var(--g-datum); }
.g-port[data-kind="curve"] { background: var(--g-crv); }
.g-port[data-kind="mesh"] { background: var(--g-msh); }
.g-port[data-kind="text"] { background: var(--g-ink-3); }
.g-port.slack { background: transparent; border-color: var(--g-wire); }
.g-wires path.number { stroke: var(--g-num); }
.g-wires path.point, .g-wires path.vector { stroke: var(--g-datum); }
.g-wires path.curve { stroke: var(--g-crv); }
.g-wires path.mesh { stroke: var(--g-msh); }
.g-port.hot { background: var(--g-good); transform: scale(1.35); }
/* Holding shift while a wire is over a port says it will join what is already
   there rather than replace it, so the port shows a ring rather than a dot. */
.g-port.adding { box-shadow: 0 0 0 3px var(--g-good); transform: scale(1.5); }
.g-port:hover { background: var(--g-accent); }
.g-node .g-head .g-port.out { right: -7px; }

/* --------------------------------------------------------------- console */
.g-console {
  flex: none; height: 190px; display: flex; flex-direction: column;
  background: var(--g-panel); border-top: 1px solid var(--g-line);
}
.g-console.shut { height: 30px; }
.g-console.shut .g-cbody, .g-console.shut .g-centry { display: none; }
.g-chead {
  display: flex; align-items: center; gap: 6px; padding: 0 10px; height: 30px; flex: none;
  border-bottom: 1px solid var(--g-line-soft);
}
.g-tab {
  height: 20px; padding: 0 8px; border: 0; background: transparent; cursor: pointer;
  border-radius: 5px; font-size: 11px; color: var(--g-ink-3);
}
.g-tab.on { background: var(--g-accent-soft); color: var(--g-accent); font-weight: 600; }
.g-cbody { flex: 1; overflow: auto; padding: 6px 10px; font-family: var(--g-mono); font-size: 10.5px; }
.g-line { display: flex; gap: 8px; padding: 1.5px 0; line-height: 1.45; }
.g-line .g-n { color: var(--g-ink-3); flex: none; width: 34px; text-align: right; }
.g-line .g-j { flex: 1; white-space: pre-wrap; word-break: break-word; }
.g-line.view .g-j { color: var(--g-ink-3); }
.g-line.bad .g-j { color: var(--g-bad); }
.g-line .g-ms { color: var(--g-ink-3); flex: none; }
.g-cbody textarea {
  width: 100%; height: 100%; border: 0; background: transparent; resize: none;
  font: inherit; line-height: 1.5; outline: none;
}
.g-centry { display: flex; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--g-line-soft); flex: none; }
.g-centry input {
  flex: 1; height: 24px; padding: 0 8px; border: 1px solid var(--g-line); border-radius: 6px;
  background: var(--g-node); font-family: var(--g-mono); font-size: 10.5px;
}
.g-centry input:focus { outline: none; border-color: var(--g-accent); }

/* ----------------------------------------------------------------- menus */
.g-menu {
  position: absolute; z-index: 40; min-width: 178px; padding: 5px;
  background: var(--g-panel); border: 1px solid var(--g-line); border-radius: 9px;
  box-shadow: var(--g-shadow); max-height: 70%; overflow: auto;
}
.g-menu button {
  display: flex; align-items: center; gap: 7px; width: 100%; height: 25px; padding: 0 7px;
  border: 0; background: transparent; border-radius: 5px; cursor: pointer; text-align: left;
  font-size: 11.5px;
}
.g-menu button:hover { background: var(--g-accent-soft); }
.g-menu button svg { width: 14px; height: 14px; color: var(--g-ink-2); }
.g-menu .g-sect { padding: 0 7px; }

/* ---------------------------------------------------------------- floater */
.g-float {
  position: fixed; z-index: 60; display: flex; flex-direction: column;
  border: 1px solid var(--g-line); border-radius: 11px; overflow: hidden;
  background: var(--g-ground); box-shadow: 0 20px 70px rgba(6,14,22,.34);
}
.g-float.rolled { height: 34px !important; resize: none; }
/* On a phone it is not a window over the model, it is the screen: there is no
   room to be beside anything, and nothing to drag it with. It still minimises
   to its bar, which is how you get the model back. */
.g-float.g-phone {
  left: 0 !important; right: 0 !important; top: auto !important;
  bottom: var(--dock-h, 62px) !important;
  width: auto !important; height: 74vh !important;
  border-radius: 14px 14px 0 0; border-left: 0; border-right: 0; border-bottom: 0;
}
.g-float.g-phone.rolled { height: 34px !important; }
.g-float.g-phone .g-grip { display: none; }
.g-float.rolled .g-frame { display: none; }
.g-bar-w {
  display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px 0 11px;
  background: var(--g-panel); border-bottom: 1px solid var(--g-line); cursor: move; flex: none;
}
.g-bar-w .g-title { font-size: 11.5px; }
.g-frame { position: relative; flex: 1; }
.g-grip {
  position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
  z-index: 50;
  background: linear-gradient(135deg, transparent 50%, var(--g-line) 50%, var(--g-line) 62%,
              transparent 62%, transparent 76%, var(--g-line) 76%, var(--g-line) 88%, transparent 88%);
}

/* ----------------------------------------------------------------- creed */
.g-creed {
  position: absolute; z-index: 45; right: 14px; top: 14px; width: 320px; padding: 13px 15px;
  background: var(--g-panel); border: 1px solid var(--g-line); border-radius: 10px;
  box-shadow: var(--g-shadow); line-height: 1.5; font-size: 11.5px; color: var(--g-ink-2);
}
.g-creed h4 { margin: 0 0 8px; font-size: 11px; letter-spacing: .09em; text-transform: uppercase;
  color: var(--g-ink-3); font-family: var(--g-mono); font-weight: 500; }
.g-creed ol { margin: 0; padding-left: 17px; }
.g-creed li { margin-bottom: 7px; }
.g-creed li b { color: var(--g-ink); }
.g-creed code { font-family: var(--g-mono); font-size: 10.5px; color: var(--g-accent); }
`;

const GRAPH_GLYPH = {
  //! Four nodes gathered into one box: what Group does.
  group: '<rect x="1.8" y="2.4" width="4.4" height="4.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>'
    + '<rect x="1.8" y="9.2" width="4.4" height="4.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>'
    + '<rect x="8.6" y="4.6" width="5.6" height="6.8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    + '<path d="M6.2 4.6h2.4M6.2 11.4h2.4" stroke="currentColor" stroke-width="1.1"/>',
  //! An arrow turning back and up: out of the set you are in.
  up: '<path d="M6.5 3.5L3 7l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M3 7h5.5a3.5 3.5 0 0 1 3.5 3.5v2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  add: '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  tidy: '<rect x="1.5" y="2.5" width="4.5" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>'
      + '<rect x="10" y="6" width="4.5" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>'
      + '<rect x="1.5" y="9.5" width="4.5" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>'
      + '<path d="M6 4.5h2.2a1 1 0 011 1V7M6 11.5h2.2a1 1 0 001-1V9" fill="none" stroke="currentColor" stroke-width="1.1"/>',
  fit: '<path d="M2 5.5V2.5h3M14 5.5V2.5h-3M2 10.5v3h3M14 10.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  pop: '<path d="M6.5 2.5h7v7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
     + '<path d="M13.5 2.5L7 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
     + '<path d="M11 12.5v1h-9v-9h1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  help: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.2"/>'
      + '<path d="M6.4 6.2a1.6 1.6 0 113.1.6c-.3.9-1.5 1-1.5 2.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
      + '<circle cx="8" cy="11.4" r=".8" fill="currentColor"/>',
  roll: '<path d="M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  shut: '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};

//! The window's own state, per browser.
const GRAPH_WINDOW = "ocafcad/graph-window";

const readWindowState = () => {
  try { return JSON.parse(localStorage.getItem(GRAPH_WINDOW) || "{}") || {}; }
  catch (e) { return {}; }
};

//! A remembered measurement, if it is one and it still fits the screen this
//! time. A window put on a second monitor and reopened on a laptop has to come
//! back somewhere it can be seen.
const clampSize = (value, fallback, low, high) =>
  Number.isFinite(value) && value >= low && value <= high ? Math.round(value) : Math.round(fallback);

const gsvg = body => '<svg viewBox="0 0 16 16" aria-hidden="true">' + body + "</svg>";
const gesc = s => String(s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const gnum = v => Math.round(v * 1e6) / 1e6;

//! What a node shows it computed. A mesh already counts itself in its preview,
//! so it is not counted twice.
//! kB or MB, for a size that is only ever read.
const gsize = n => n < 1024 ? n + " B"
  : n < 1024 * 1024 ? (n / 1024).toFixed(1) + " kB" : (n / 1024 / 1024).toFixed(1) + " MB";

const gDataLine = data => data.kind === "mesh"
  ? gesc(data.preview)
  : '<span class="g-count">' + data.count + " " + gesc(data.kind) +
    (data.count === 1 ? "" : "s") + " · </span>" + gesc(data.preview);

const NODE_W = 216, NODE_W_DATUM = 190, COL_GAP = 92, ROW_GAP = 22;

//! Ranks every feature by the longest path of references reaching it, which is
//! the same order the solver runs them in - so the columns read left to right as
//! the regeneration does top to bottom.
//! Everything a feature reads from: reference arguments, sliders being driven,
//! and each wire into an input that takes several.
export function wiresInto(entry) {
  if (!entry) return [];
  const out = Object.values(entry.refs || {}).filter(Boolean);
  for (const value of Object.values(entry.lists || {}))
    if (Array.isArray(value)) out.push(...value.filter(Boolean));
  return out;
}

export function graphRanks(features) {
  const byId = new Map(features.map(f => [f.id, f]));
  const rank = new Map();
  const walk = (id, seen) => {
    if (rank.has(id)) return rank.get(id);
    if (seen.has(id)) return 0;                       // a cycle cannot exist, but never hang
    seen.add(id);
    const entry = byId.get(id);
    let depth = 0;
    for (const target of wiresInto(entry))
      if (byId.has(target)) depth = Math.max(depth, walk(target, seen) + 1);
    seen.delete(id);
    rank.set(id, depth);
    return depth;
  };
  for (const f of features) walk(f.id, new Set());
  return rank;
}

export class GraphEditor {
  constructor(options) {
    this.mdl = options.mdl;
    this.read = options.read;                  // () -> { tree, schema, selected }
    this.icons = options.icons || {};
    this.openDefinition = options.openDefinition || (() => {});
    this.onOpen = options.onOpen || (() => {});
    // Pressing Draw on a sketch node opens the sketcher in the main window -
    // the graph may be on another screen, and the drawing is not.
    this.onSketch = options.onSketch || (() => {});
    this.onClose = options.onClose || (() => {});
    // Whether this is a phone, asked rather than worked out: the rule is one
    // rule and it lives where the layout does, so a narrow window with a
    // mouse in it does not get a phone's window here and a desktop's
    // everywhere else.
    this.onPhone = options.onPhone || (() => false);

    this.layout = new Map();                   // feature id -> { x, y }
    this.view = { x: 40, y: 30, z: 1 };
    this.nodes = new Map();                    // feature id -> { el, ports, out, entry }
    this.doc = null; this.host = null; this.win = null; this.floater = null;
    this.signature = "";
    this.tab = "commands";
    this.consoleShut = false;
    this.dragging = null;
    this.linking = null;
    //! WHICH GRAPH YOU ARE LOOKING AT. Null is the model itself; the id of a
    //! set means you are inside that set, looking at what it holds. A set is
    //! a node with a graph inside it - Grasshopper's cluster, ComfyUI's
    //! group - and the whole point of one is that the wires that made a
    //! thicket at the top level are inside, where they belong.
    this.inside = null;
    this.inlets = new Map();                   // synthetic id -> { el, out, entry }
    this.holding = null;                       // an input being edited; do not overwrite it
    this.unwatch = null;
    this.pollTimer = 0;
  }

  get showing() { return !!this.doc; }

  /* ------------------------------------------------------------ layout as text */

  //! An id that starts with a control character belongs to a node this editor
  //! drew for itself - the inlets that stand for what reaches into a set -
  //! rather than to anything in the document. They keep their places while
  //! the window is open and go no further: a model file with "\u0001in:GS:0"
  //! in its layout would be a model file carrying a note about a window.
  static synthetic(id) { return String(id).charCodeAt(0) === 1; }

  layoutJson() {
    const out = {};
    for (const [id, at] of this.layout)
      if (!GraphEditor.synthetic(id)) out[id] = [Math.round(at.x), Math.round(at.y)];
    return out;
  }

  readLayout(block) {
    this.layout.clear();
    for (const [id, at] of Object.entries(block || {}))
      if (Array.isArray(at) && at.length === 2 && at.every(Number.isFinite))
        this.layout.set(id, { x: at[0], y: at[1] });
    if (this.showing) this.rebuild();
  }

  setNode(id, x, y) {
    this.layout.set(id, { x, y });
    const node = this.nodes.get(id);
    if (node) { node.el.style.left = x + "px"; node.el.style.top = y + "px"; this.drawWires(); }
  }

  /* ---------------------------------------------------------------- the window */

  toggle() { return this.showing ? this.close() : this.open(); }

  //! A window inside the page, always - it opens where you can see it, moves,
  //! resizes, minimises to its own title bar and closes, and it cannot end up
  //! as a browser tab of its own that hides the model behind it. A real second
  //! window is worth having on a second screen, so the button in the bar still
  //! asks for one; it is a thing you choose rather than a thing that happens.
  open(separate = false) {
    if (this.showing) return this.focus();
    const win = separate ? this.tryPopup() : null;
    if (win) this.mountPopup(win); else this.mountFloater();
    this.onOpen();
  }

  focus() {
    if (this.win) { try { this.win.focus(); } catch (e) { /* the user closed it */ } }
    else if (this.floater) this.floater.style.zIndex = String(++GraphEditor.top);
  }

  //! A window of its own if the browser will give us one we can write into. In a
  //! sandboxed frame it will not, and there is no error to catch on the way in -
  //! only the first touch of the document tells us.
  tryPopup() {
    let win = null;
    try {
      const w = Math.min(1320, Math.max(880, Math.round(screen.availWidth * 0.62)));
      const h = Math.min(900, Math.max(560, Math.round(screen.availHeight * 0.78)));
      win = window.open("", "ocaf-node-graph",
        "popup=yes,width=" + w + ",height=" + h + ",left=" +
        Math.max(0, screen.availWidth - w - 40) + ",top=60");
    } catch (e) { return null; }
    if (!win) return null;
    try {
      win.document.title = "Node graph — the model as JSON";
      if (!win.document.body) return null;
      return win;
    } catch (e) {
      try { win.close(); } catch (_) { /* not ours to close either */ }
      return null;
    }
  }

  mountPopup(win) {
    const doc = win.document;
    doc.head.innerHTML =
      '<meta charset="utf-8">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600' +
      '&family=IBM+Plex+Sans:wght@400;500;600&display=swap">' +
      "<style>html,body{margin:0;height:100%;overflow:hidden}" + GRAPH_CSS + "</style>";
    doc.title = "Node graph — the model as JSON";
    doc.body.innerHTML = "";
    doc.body.className = this.dark() ? "g-dark" : "";
    this.win = win;
    this.build(doc, doc.body, false);
    // A popup that goes away without telling us leaves a dead editor behind.
    this.pollTimer = setInterval(() => { if (win.closed) this.close(); }, 700);
    window.addEventListener("beforeunload", this.shutPopup = () => { try { win.close(); } catch (e) {} });
  }

  //! A window inside the page: dragged by its bar, resized from the corner,
  //! minimised to the bar alone, closed. This is what opening the graph does,
  //! because a real browser window is not reliably a window - ask for one in a
  //! sandboxed frame and you get nothing, ask in a browser set to open popups
  //! as tabs and you get a whole tab with the model hidden behind it. The
  //! button in the bar asks for a real one when that is what you want.
  mountFloater() {
    const doc = document;
    const floater = doc.createElement("div");
    floater.className = "g-float" + (this.dark() ? " g-dark" : "");

    // Where it was left, if it has been moved before. Otherwise about two
    // thirds of the viewport, off to the right, with the model still visible
    // beside it - a window over the work, not instead of it.
    // A phone has no second place to put a window, so it does not get one: the
    // graph fills the width, sits on the dock, and the only thing worth
    // remembering about it is nothing.
    const phone = this.onPhone();
    if (phone) floater.classList.add("g-phone");
    const kept = phone ? {} : readWindowState();
    const w = Math.round(Math.min(1040, Math.max(560, innerWidth * 0.62), innerWidth - 80));
    const h = Math.round(Math.min(680, Math.max(320, innerHeight * 0.68), innerHeight - 110));
    const box = {
      width: clampSize(kept.width, w, 520, innerWidth - 40),
      height: clampSize(kept.height, h, 220, innerHeight - 60),
    };
    box.left = clampSize(kept.left, Math.max(20, innerWidth - box.width - 30),
                         0, Math.max(0, innerWidth - 140));
    box.top = clampSize(kept.top, 56, 0, Math.max(0, innerHeight - 44));
    floater.style.cssText = "left:" + box.left + "px;top:" + box.top + "px;width:" +
      box.width + "px;height:" + box.height + "px;z-index:" + (++GraphEditor.top);
    if (kept.rolled) floater.classList.add("rolled");

    const bar = doc.createElement("div");
    bar.className = "g-bar-w";
    bar.innerHTML = '<span class="g-title">Node graph</span>' +
      '<span class="g-sub">the model as JSON</span><span class="g-spacer" style="flex:1"></span>';

    // Minimise leaves the title bar, which is how you get the model back
    // without losing where the window was or what was open in it.
    const roll = () => {
      const rolled = floater.classList.toggle("rolled");
      minimise.title = rolled ? "Restore" : "Minimise";
      minimise.setAttribute("aria-label", minimise.title);
      this.rememberWindow(floater);
    };
    const chrome = [
      // A "separate window" on a phone is another tab with the model hidden
      // behind it, which is the thing this is here to avoid.
      ...(phone ? [] : [["pop", "Open in a separate window",
                         () => { this.close(); this.open(true); }]]),
      ["roll", floater.classList.contains("rolled") ? "Restore" : "Minimise", roll],
      ["shut", "Close (G)", () => this.close()],
    ];
    let minimise = null;
    for (const [glyph, title, action] of chrome) {
      const button = doc.createElement("button");
      button.className = "g-btn";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.innerHTML = gsvg(GRAPH_GLYPH[glyph]);
      button.addEventListener("click", action);
      bar.appendChild(button);
      if (glyph === "roll") minimise = button;
    }
    // Double-clicking the bar minimises, the way a title bar has always done.
    bar.addEventListener("dblclick", event => {
      if (event.target.closest(".g-btn")) return;
      roll();
    });
    floater.appendChild(bar);

    const frame = doc.createElement("div");
    frame.className = "g-frame";
    floater.appendChild(frame);

    const grip = doc.createElement("div");
    grip.className = "g-grip";
    floater.appendChild(grip);
    doc.body.appendChild(floater);
    this.floater = floater;

    floater.addEventListener("pointerdown", () => { floater.style.zIndex = String(++GraphEditor.top); }, true);
    if (phone) { this.build(doc, frame, true); return; }
    this.drag(bar, (dx, dy, start) => {
      floater.style.left = Math.max(0, Math.min(innerWidth - 120, start.left + dx)) + "px";
      floater.style.top = Math.max(0, Math.min(innerHeight - 40, start.top + dy)) + "px";
    }, () => ({ left: floater.offsetLeft, top: floater.offsetTop }),
       () => this.rememberWindow(floater));
    this.drag(grip, (dx, dy, start) => {
      floater.style.width = Math.max(520, start.w + dx) + "px";
      floater.style.height = Math.max(220, start.h + dy) + "px";
      this.drawWires();
    }, () => ({ w: floater.offsetWidth, h: floater.offsetHeight }),
       () => this.rememberWindow(floater));

    this.build(doc, frame, true);
  }

  //! Pointer drag with a starting measurement, used by the window chrome and by
  //! the nodes themselves.
  drag(handle, move, measure, done) {
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest(".g-btn")) return;
      event.preventDefault();
      const start = measure();
      const x0 = event.clientX, y0 = event.clientY;
      const doc = handle.ownerDocument;
      const onMove = e => move(e.clientX - x0, e.clientY - y0, start);
      const onUp = e => {
        doc.removeEventListener("pointermove", onMove);
        doc.removeEventListener("pointerup", onUp);
        move(e.clientX - x0, e.clientY - y0, start, true);
        if (done) done();
      };
      doc.addEventListener("pointermove", onMove);
      doc.addEventListener("pointerup", onUp);
    });
  }

  //! Where the window was left. Kept per browser, not in the model - it is
  //! nothing to do with the part, and a model file that carried somebody's
  //! window position would be a model file that changed when nothing did.
  rememberWindow(floater) {
    try {
      localStorage.setItem(GRAPH_WINDOW, JSON.stringify({
        left: floater.offsetLeft, top: floater.offsetTop,
        width: floater.offsetWidth,
        // Rolled up, the height IS the title bar; the height worth keeping is
        // the one it will be restored to.
        height: floater.classList.contains("rolled")
          ? readWindowState().height : floater.offsetHeight,
        rolled: floater.classList.contains("rolled"),
      }));
    } catch (e) { /* a private window remembers nothing, which is fair */ }
  }

  dark() {
    const theme = document.documentElement.getAttribute("data-theme");
    if (theme) return theme === "dark";
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  close() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = 0; }
    if (this.shutPopup) { window.removeEventListener("beforeunload", this.shutPopup); this.shutPopup = null; }
    if (this.unwatch) { this.unwatch(); this.unwatch = null; }
    if (this.win) { try { this.win.close(); } catch (e) { /* already gone */ } this.win = null; }
    if (this.floater) { this.floater.remove(); this.floater = null; }
    this.doc = null; this.host = null; this.nodes.clear(); this.signature = "";
    this.onClose();
  }

  /* -------------------------------------------------------------- the surface */

  build(doc, host, inline) {
    this.doc = doc; this.host = host;
    if (inline) {
      // The floater lives in the main document, which has its own stylesheet;
      // this one is added once and scoped to .g-root and its own classes.
      if (!doc.getElementById("graph-css")) {
        const style = doc.createElement("style");
        style.id = "graph-css";
        style.textContent = GRAPH_CSS;
        doc.head.appendChild(style);
      }
    }
    const root = doc.createElement("div");
    root.className = "g-root" + (inline && this.dark() ? " g-dark" : "");
    root.innerHTML =
      '<div class="g-bar">' +
        (inline ? "" : '<span class="g-title">Node graph</span><div class="g-sep"></div>') +
        '<button class="g-btn" data-do="add">' + gsvg(GRAPH_GLYPH.add) + "<span>Add</span></button>" +
        '<button class="g-btn" data-do="group">' + gsvg(GRAPH_GLYPH.group) +
          "<span>Group</span></button>" +
        '<button class="g-btn" data-do="tidy">' + gsvg(GRAPH_GLYPH.tidy) + "<span>Tidy</span></button>" +
        '<button class="g-btn" data-do="fit">' + gsvg(GRAPH_GLYPH.fit) + "<span>Fit</span></button>" +
        '<div class="g-sep"></div>' +
        '<button class="g-btn g-up" data-do="up" hidden>' + gsvg(GRAPH_GLYPH.up) +
          "<span>Back</span></button>" +
        '<span class="g-crumb" data-slot="crumb" hidden></span>' +
        '<span class="g-sub" data-slot="count"></span>' +
        '<span class="g-spacer"></span>' +
        '<span class="g-sub" data-slot="hint">drag a port to wire · shift to add a second · double-click a node to open it</span>' +
        '<div class="g-sep"></div>' +
        '<button class="g-btn" data-do="creed">' + gsvg(GRAPH_GLYPH.help) + "</button>" +
      "</div>" +
      '<div class="g-canvas" tabindex="0" data-slot="canvas">' +
        '<svg class="g-wires"><g data-slot="wires"></g></svg>' +
        '<div class="g-layer" data-slot="layer"></div>' +
      "</div>" +
      '<div class="g-console">' +
        '<div class="g-chead">' +
          '<button class="g-tab on" data-tab="commands">Commands</button>' +
          '<button class="g-tab" data-tab="model">Model file</button>' +
          '<span class="g-spacer" style="flex:1"></span>' +
          '<span class="g-sub" data-slot="creedline">every surface writes the same JSON</span>' +
          '<button class="g-btn" data-do="console">' + gsvg(GRAPH_GLYPH.roll) + "</button>" +
        "</div>" +
        '<div class="g-cbody" data-slot="log"></div>' +
        '<div class="g-cbody" data-slot="model" hidden><textarea spellcheck="false"></textarea></div>' +
        '<div class="g-centry">' +
          '<input data-slot="entry" spellcheck="false" placeholder=' +
            '\'{ "op": "set", "id": "CB1", "key": "dx", "value": 92 }\'>' +
          '<button class="g-btn" data-do="run">Run</button>' +
        "</div>" +
      "</div>";
    host.appendChild(root);
    this.root = root;
    this.el = {};
    for (const node of root.querySelectorAll("[data-slot]")) this.el[node.dataset.slot] = node;

    for (const button of root.querySelectorAll("[data-do]"))
      button.addEventListener("click", event => this.command(button.dataset.do, event));
    for (const tab of root.querySelectorAll("[data-tab]"))
      tab.addEventListener("click", () => this.showTab(tab.dataset.tab));

    this.el.entry.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); this.command("run"); }
    });

    this.wireCanvas();
    doc.addEventListener("keydown", event => this.key(event));

    // Everything that happens to the model, in the language it happened in.
    this.unwatch = this.mdl.watch(record => this.logRecord(record));
    for (const record of this.mdl.history.slice(-60)) this.logRecord(record);

    this.rebuild();
    this.frame();
  }

  showTab(name) {
    this.tab = name;
    for (const tab of this.root.querySelectorAll("[data-tab]"))
      tab.classList.toggle("on", tab.dataset.tab === name);
    this.el.log.hidden = name !== "commands";
    this.el.model.hidden = name !== "model";
    if (name === "model") this.refreshModelText();
  }

  async refreshModelText() {
    if (!this.showing || this.tab !== "model") return;
    const area = this.el.model.querySelector("textarea");
    if (this.doc.activeElement === area) return;      // it is being read, or edited
    try { area.value = await this.mdl.modelText(); }
    catch (err) { area.value = "// " + err.message; }
  }

  command(name, event) {
    if (name === "up") this.leaveSet();
    else if (name === "group") this.groupSelection();
    else if (name === "add") this.addMenu(event);
    else if (name === "tidy") this.tidy();
    else if (name === "fit") this.frame();
    else if (name === "creed") this.creed();
    else if (name === "console") {
      this.consoleShut = !this.consoleShut;
      this.root.querySelector(".g-console").classList.toggle("shut", this.consoleShut);
      this.drawWires();
    } else if (name === "run") {
      const text = this.el.entry.value.trim();
      if (!text) return;
      this.run(text).then(ok => { if (ok) this.el.entry.value = ""; });
    }
  }

  //! The console is not a transcript of the session, it is the way in. Anything
  //! that can put text here can model - which is all an outside driver needs.
  async run(text) {
    try {
      const edits = parseEdits(text);
      if (!edits.length) return false;
      await this.mdl.runAll(edits);
      return true;
    } catch (err) {
      this.logRecord({ n: "—", at: Date.now(), edit: { text }, ok: false,
                       error: err.message, ms: 0, view: false });
      return false;
    }
  }

  logRecord(record) {
    if (!this.showing) return;
    const line = this.doc.createElement("div");
    line.className = "g-line" + (record.ok ? (record.view ? " view" : "") : " bad");
    const json = record.edit && record.edit.op
      ? JSON.stringify(record.edit, (k, v) =>
          typeof v === "string" && v.length > 90 ? v.slice(0, 88) + "…" : v)
      : String((record.edit && record.edit.text) || "");
    line.innerHTML =
      '<span class="g-n">' + gesc(record.n) + "</span>" +
      '<span class="g-j">' + gesc(record.ok ? json : json + "  ✗ " + record.error) + "</span>" +
      '<span class="g-ms">' + (record.ms ? record.ms + "ms" : "") + "</span>";
    this.el.log.appendChild(line);
    while (this.el.log.childElementCount > 300) this.el.log.firstElementChild.remove();
    this.el.log.scrollTop = this.el.log.scrollHeight;
    if (this.tab === "model" && !record.view) this.refreshModelText();
  }

  creed() {
    const open = this.root.querySelector(".g-creed");
    if (open) return open.remove();
    const panel = this.doc.createElement("div");
    panel.className = "g-creed";
    panel.innerHTML =
      "<h4>Three rules</h4><ol>" +
      "<li><b>The JSON is the model.</b> Not a save format - the thing itself. " +
      "A button is a literal, <code>{\"op\":\"add\",\"type\":\"Cube\"}</code>; a slider is a " +
      "literal, <code>{\"op\":\"set\",…}</code>. Geometry is what is made of the text.</li>" +
      "<li><b>Tree and graph are one graph.</b> The tree reads it in the order the solver " +
      "runs; the canvas reads it along the references that fix that order. Edit either one " +
      "and the other has already changed.</li>" +
      "<li><b>There is one way in.</b> Every surface - and anything driving this page from " +
      "outside - sends the edits below. Nothing else can touch the document.</li>" +
      "</ol><div class=\"g-sub\" style=\"margin-top:9px\">" +
      MDL_OPS.map(spec => spec.op).join(" · ") + "</div>";
    this.el.canvas.appendChild(panel);
    panel.addEventListener("click", () => panel.remove());
  }

  addMenu(event) {
    const doc = this.doc;
    const existing = this.root.querySelector(".g-menu");
    if (existing) existing.remove();
    const { schema } = this.read();
    if (!schema) return;

    const menu = doc.createElement("div");
    menu.className = "g-menu";
    const anchor = event && event.currentTarget && event.currentTarget.getBoundingClientRect
      ? event.currentTarget.getBoundingClientRect() : null;
    const frame = this.el.canvas.getBoundingClientRect();
    menu.style.left = (anchor ? anchor.left - frame.left : 40) + "px";
    menu.style.top = (anchor ? anchor.bottom - frame.top + 6 : 40) + "px";

    const groups = schema.categories
      || [{ key: "datum", label: "datums" }, { key: "body", label: "solids" },
          { key: "operation", label: "operations" }];
    for (const group of groups) {
      // Hidden types are the ones something else makes - an import - so they
      // are not offered here either.
      const types = schema.types.filter(t => t.category === group.key && !t.hidden);
      if (!types.length) continue;
      const head = doc.createElement("div");
      head.className = "g-sect";
      head.textContent = group.label || group.key;
      menu.appendChild(head);
      for (const spec of types) {
        const button = doc.createElement("button");
        button.innerHTML = gsvg(this.icons[spec.type] || this.icons.part || "") +
          "<span>" + gesc(spec.type) + "</span>";
        button.title = spec.summary;
        button.addEventListener("click", async () => {
          menu.remove();
          // Where it lands is part of the edit, so adding a node is two lines of
          // the same language: one that makes it, one that puts it down.
          const at = this.toGraph(frame.width / 2, 120);
          try {
            const payload = await this.mdl.run({ op: "add", type: spec.type });
            if (payload && payload.id) await this.mdl.run({ op: "move", id: payload.id, x: at.x, y: at.y });
          } catch (e) { /* recorded in the console */ }
        });
        menu.appendChild(button);
      }
    }
    this.el.canvas.appendChild(menu);
    const shut = e => { if (!menu.contains(e.target)) { menu.remove(); doc.removeEventListener("pointerdown", shut, true); } };
    setTimeout(() => doc.addEventListener("pointerdown", shut, true), 0);
  }

  //! In a window of its own every key is the graph's. Floating inside the
  //! modelling page it takes only the keys pressed over it, and takes them from
  //! the page rather than doing both things at once.
  key(event) {
    // Escape steps out of a set before it does anything else, which is the
    // gesture every nested editor has.
    if (event.key === "Escape" && this.inside !== null
        && !(event.target && /INPUT|TEXTAREA/.test(event.target.tagName))) {
      event.preventDefault();
      this.leaveSet();
      return;
    }
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (this.floater && !(target && this.root.contains(target))) return;
    const { selected } = this.read();
    if ((event.key === "Delete" || event.key === "Backspace") && selected) {
      event.preventDefault(); event.stopPropagation();
      this.mdl.run({ op: "delete", id: selected }).catch(() => {});
    }
    if (event.key === "f" || event.key === "F") { event.stopPropagation(); this.frame(); }
    if (event.key === "t" || event.key === "T") { event.stopPropagation(); this.tidy(); }
  }

  /* ------------------------------------------------------------------ the graph */

  //! Rebuilt when the shape of the document changes; otherwise updated in place,
  //! so a slider being dragged is not pulled out from under the pointer.
  sync() {
    if (!this.showing) return;
    const { tree } = this.read();
    if (!tree) return;
    const signature = this.shapeOf(tree);
    if (signature !== this.signature) this.rebuild();
    else this.update();
    this.refreshModelText();
  }

  /* --------------------------------------------- a set is a node with a graph

     SWALLOWED, NOT HIDDEN. A geometrical set holding nine things is drawn as
     ONE node: the nine are inside it, and what shows on the outside is what
     the nine need from the rest of the model and what the rest of the model
     takes from them. That is the whole reason a set exists - it is the answer
     to a screen full of crossing wires - and a set that drew all nine and all
     their wires anyway would be a folder that folds nothing.

     Double-click to go in; the Back button, or Escape, to come out.        */

  //! Whether a feature is a folder rather than an operation.
  isSet(entry) {
    const spec = this.spec(entry.type);
    return !!spec && spec.category === "container";
  }

  //! What is drawn right now: whatever is filed directly in the graph you are
  //! looking at. A set among them is drawn collapsed, contents and all.
  onStage(features) {
    return features.filter(one => (one.parent || null) === this.inside);
  }

  //! Everything inside a set, at any depth - what it swallowed.
  within(features, setId) {
    return membersOf(features, setId);
  }

  //! WHICH NODE ON STAGE STANDS FOR A FEATURE. Itself when it is on stage; the
  //! set that swallowed it when it is inside one; the inlet that carries it
  //! when you are inside a set and it is outside. Null when it is somewhere
  //! this graph cannot show, which is a wire that is simply not drawn here.
  standsFor(features, id) {
    if (this.nodes.has(id)) return this.nodes.get(id);
    for (const [setId, node] of this.nodes)
      if (node.swallowed && node.swallowed.has(id)) return node;
    for (const inlet of this.inlets.values())
      if (inlet.carries === id) return inlet;
    return null;
  }

  //! PUT THESE IN A SET, from the graph. Grasshopper's cluster, ComfyUI's
  //! group: take what is selected and make it one node. The set is born in
  //! the graph you are looking at, so grouping inside a set nests.
  //!
  //! The moment it exists the graph redraws and the chosen nodes are gone -
  //! swallowed - which is the whole point and is why this is one button
  //! rather than a dialogue.
  async groupSelection() {
    const { tree, selected, picked } = this.read();
    if (!tree) return;
    const stage = new Set(this.onStage(tree.features).map(one => one.id));
    const want = (picked && picked.length ? picked : [selected])
      .filter(id => id && stage.has(id) && !this.isSet(tree.features.find(o => o.id === id) || {}));
    if (!want.length) {
      this.note("pick the nodes to group first - click one, shift-click more");
      return;
    }
    const names = want.map(id => (tree.features.find(one => one.id === id) || {}).name);
    const id = "GS" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const edits = [{ op: "add", type: "GeometricalSet", id,
                     name: names.length === 1 ? names[0] + " set"
                                              : names.length + " nodes" }];
    if (this.inside) edits.push({ op: "group", id, into: this.inside });
    for (const one of want) edits.push({ op: "group", id: one, into: id });
    edits.push({ op: "select", id });
    try { await this.mdl.runAll(edits); }
    catch (err) { /* the console has it */ }
  }

  //! A line in the hint slot, for the things that are not errors and are not
  //! worth a dialogue.
  note(said) {
    if (this.el && this.el.hint) this.el.hint.textContent = said;
  }

  enterSet(id) {
    const { tree } = this.read();
    if (!tree || !tree.features.some(one => one.id === id)) return;
    this.inside = id;
    this.rebuild();
    this.frame();
  }

  leaveSet() {
    if (this.inside === null) return;
    const { tree } = this.read();
    const holder = tree && tree.features.find(one => one.id === this.inside);
    this.inside = (holder && holder.parent) || null;
    this.rebuild();
    this.frame();
  }

  //! The line along the top that says where you are, and the way back.
  refreshCrumb(features) {
    const path = [];
    for (let id = this.inside; id; ) {
      const one = features.find(f => f.id === id);
      if (!one) break;
      path.unshift(one);
      id = one.parent || null;
    }
    const up = this.root.querySelector('[data-do="up"]');
    if (up) up.hidden = !path.length;
    this.el.crumb.hidden = !path.length;
    this.el.crumb.textContent = path.length
      ? "the model \u203a " + path.map(one => one.name).join(" \u203a ") : "";
    this.el.crumb.title = path.length
      ? "Inside " + path[path.length - 1].name + " \u00b7 Back, or Escape, to come out" : "";
  }

  rebuild() {
    if (!this.showing) return;
    const { tree } = this.read();
    if (!tree) return;
    // A set that has been deleted while you were inside it leaves you nowhere;
    // step back out rather than drawing an empty graph with no way home.
    if (this.inside && !tree.features.some(one => one.id === this.inside)) this.inside = null;
    this.nodes.clear();
    this.inlets.clear();
    this.el.layer.textContent = "";
    const stage = this.onStage(tree.features);
    const fresh = stage.filter(f => !this.layout.has(f.id)).map(f => f.id);
    this.place(stage);
    for (const entry of stage) this.el.layer.appendChild(this.node(entry, tree.features));
    // Inside a set, what reaches in from outside is drawn as a node of its
    // own on the left - so the sub-graph shows where the outside plugs in
    // rather than leaving wires running off the edge of the world.
    if (this.inside) this.buildInlets(tree.features);
    // Node heights are not known until they are on the page, so anything placed
    // by guesswork just now is packed again against what it actually measures.
    if (fresh.length) this.pack(stage, new Set(fresh));
    this.signature = this.shapeOf(tree);
    const swallowed = stage.reduce((n, one) =>
      n + (this.isSet(one) ? this.within(tree.features, one.id).length : 0), 0);
    this.el.count.textContent = stage.length + " nodes"
      + (swallowed ? " \u00b7 " + swallowed + " inside them" : "") + " \u00b7 "
      + stage.reduce((n, f) => n + wiresInto(f).length, 0) + " wires";
    this.refreshCrumb(tree.features);
    this.update();
    this.applyView();
  }

  //! One small node per input the set takes, standing at the left of its own
  //! graph. Its output is the thing OUTSIDE that feeds it, so dragging from
  //! one wires another member to the same source - which is what an input
  //! means, said as a gesture.
  buildInlets(features) {
    const groups = this.inputsOf(features, this.inside);
    const doc = this.doc;
    let y = 30;
    groups.forEach((group, at) => {
      const id = "\u0001in:" + this.inside + ":" + at;
      const el = doc.createElement("div");
      el.className = "g-node g-inlet";
      const seat = this.layout.get(id) || { x: -230, y };
      this.layout.set(id, seat);
      el.style.left = seat.x + "px";
      el.style.top = seat.y + "px";
      el.dataset.id = id;
      const name = group.name || group.rows[0].arg.label;
      const kind = group.rows[0].arg.accepts || "";
      el.innerHTML = '<div class="g-head"><span class="g-nm">' + gesc(name) + "</span>"
        + '<span class="g-id">in</span></div>'
        + '<div class="g-body"><div class="g-row"><span class="g-lab">'
        + gesc(group.rows.map(one => one.child.name).join(", "))
        + '</span><span class="g-sub" style="font-size:9.5px">'
        + gesc(group.to ? "from outside" : "not supplied") + "</span></div></div>";
      const out = doc.createElement("div");
      out.className = "g-port out" + (group.to ? "" : " slack");
      out.dataset.kind = (kind.split(",")[0] || "").trim();
      out.dataset.out = group.to || "";
      out.title = group.to ? "what feeds this input, from outside the set"
                           : "nothing is supplying this input yet";
      el.querySelector(".g-head").appendChild(out);
      this.el.layer.appendChild(el);
      const record = { el, out, ports: new Map(), carries: group.to || null,
                       entry: { id, name, produces: (kind.split(",")[0] || "").trim() },
                       inlet: true };
      this.inlets.set(id, record);
      if (group.to) {
        out.addEventListener("pointerdown",
          event => this.startLink(event, group.to, null));
      }
      y = seat.y + 84;
    });
  }

  //! What a set asks for, worked out where the definition panel works it out,
  //! so the two windows cannot come to different answers.
  inputsOf(features, setId) {
    const holder = features.find(one => one.id === setId);
    return setInputGroups(features, setId, {
      spec: type => this.spec(type),
      applies: (entry, arg) => this.applies(entry, arg),
      declaredText: (holder && holder.texts && holder.texts.inputs) || "",
      nameOf: id => (features.find(one => one.id === id) || {}).name || id,
    });
  }

  //! What the graph is drawn from, as a string. When this changes the nodes are
  //! rebuilt; when only the numbers move they are updated where they stand.
  shapeOf(tree) {
    // The scope is part of the shape: stepping into a set redraws everything.
    return "@" + (this.inside || "") + "|" + tree.features.map(f =>
      (f.parent || "") + ">" +
      f.id + ":" + f.type + ":" + Object.keys(f.values).join(",") +
      ":" + Object.entries(f.refs).map(([k, v]) => k + ">" + v).join(",") +
      ":" + Object.keys(f.texts || {}).join(",") +
      ":" + Object.entries(f.lists || {}).map(([k, v]) =>
        k + "*" + (Array.isArray(v) ? v.join("+") : v)).join(",") +
      ":" + (f.params ? f.params.map(p => p.key).join(",") : "")).join("|");
  }

  //! Anything without a place gets one, in the columns the references imply.
  place(features) {
    const missing = features.filter(f => !this.layout.has(f.id));
    if (!missing.length) return;
    const rank = graphRanks(features);
    const columns = new Map();
    for (const f of features) {
      const column = rank.get(f.id) || 0;
      if (!columns.has(column)) columns.set(column, []);
      columns.get(column).push(f);
    }
    for (const [column, members] of columns) {
      let y = 30;
      for (const f of members) {
        const height = 46 + this.rowCount(f) * 23 + (f.error ? 26 : 0);
        if (!this.layout.has(f.id))
          this.layout.set(f.id, { x: 30 + column * (NODE_W + COL_GAP), y });
        y = Math.max(y, (this.layout.get(f.id).y || y) + height + ROW_GAP);
      }
    }
  }

  //! Columns by rank, rows by measured height. Only the nodes in \p movable are
  //! touched, so nothing the user has put somewhere is taken back off them.
  pack(features, movable) {
    const rank = graphRanks(features);
    const columns = new Map();
    for (const f of features) {
      const column = rank.get(f.id) || 0;
      if (!columns.has(column)) columns.set(column, []);
      columns.get(column).push(f);
    }
    for (const [column, members] of columns) {
      let y = 30;
      for (const f of members) {
        const node = this.nodes.get(f.id);
        const height = node ? node.el.offsetHeight : 96;
        const at = this.layout.get(f.id);
        if (movable.has(f.id) || !at) {
          const x = 30 + column * (NODE_W + COL_GAP);
          this.layout.set(f.id, { x, y });
          if (node) { node.el.style.left = x + "px"; node.el.style.top = y + "px"; }
          y += height + ROW_GAP;
        } else {
          y = Math.max(y, at.y + height + ROW_GAP);
        }
      }
    }
    this.drawWires();
  }

  rowCount(entry) {
    const spec = this.spec(entry.type);
    if (!spec) return 0;
    let rows = 0;
    for (const arg of spec.args) {
      if (arg.kind === "code" || !this.applies(entry, arg)) continue;
      rows += arg.kind === "refs" ? (entry.lists[arg.key] || []).length + 1
            : arg.kind === "real" ? 2 : 1;
      if (arg.kind === "edits" || arg.kind === "text") rows += 1;
      // A drawing needs three: the label, the summary - which wraps once a
      // sketch has relations as well as loops - and the button.
      if (arg.kind === "sketch") rows += 3;
    }
    return rows + (entry.params ? Math.min(entry.params.length, 7) + 1 : 0)
         + (entry.code !== undefined ? 1 : 0) + (entry.data ? 2 : 0);
  }

  spec(type) {
    const { schema } = this.read();
    return schema ? schema.types.find(t => t.type === type) || null : null;
  }
  applies(entry, arg) {
    if (!arg.showWhen) return true;
    const now = entry.values[arg.showWhen.key];
    return arg.showWhen.any ? arg.showWhen.any.includes(now) : now === arg.showWhen.equals;
  }

  //! One feature, as a node. Every control on it sends one line of JSON.
  node(entry, features) {
    if (features && this.isSet(entry)) return this.setNode(entry, features);
    const doc = this.doc;
    const spec = this.spec(entry.type);
    const at = this.layout.get(entry.id) || { x: 30, y: 30 };
    const el = doc.createElement("div");
    el.className = "g-node" + (entry.category === "datum" ? " datum" : "");
    el.style.left = at.x + "px";
    el.style.top = at.y + "px";
    el.dataset.id = entry.id;

    const head = doc.createElement("div");
    head.className = "g-head";
    head.innerHTML = gsvg(this.icons[entry.type] || this.icons.part || "") +
      '<span class="g-nm">' + gesc(entry.name) + "</span>" +
      '<span class="g-id">' + gesc(entry.id) + "</span>";
    const out = doc.createElement("div");
    out.className = "g-port out";
    out.dataset.kind = entry.produces || "solid";
    out.title = "what this feature gives: " + (entry.produces || "a shape");
    out.dataset.out = entry.id;
    head.appendChild(out);
    el.appendChild(head);

    const body = doc.createElement("div");
    body.className = "g-body";
    el.appendChild(body);

    const ports = new Map();
    const record = { el, head, out, ports, entry };

    for (const arg of (spec ? spec.args : [])) {
      if (arg.kind === "code" || !this.applies(entry, arg)) continue;
      if (arg.kind === "ref" || arg.kind === "refs")
        body.appendChild(this.refRow(entry, arg, ports));
      else if (arg.kind === "text") body.appendChild(this.textRow(entry, arg));
      else if (arg.kind === "sketch") body.appendChild(this.sketchRow(entry, arg));
      else if (arg.kind === "choice") body.appendChild(this.choiceRow(entry, arg));
      else if (arg.kind === "blob") body.appendChild(this.blobRow(entry, arg));
      else body.appendChild(this.realRow(entry, arg, arg.key, entry.values[arg.key], ports));
    }

    // Hand edits are a store, not a control: the node says how many there are
    // and sends you to the viewport, where the handles live.
    for (const arg of (spec ? spec.args : [])) {
      if (arg.kind !== "edits") continue;
      const moves = (entry.lists && entry.lists[arg.key]) || {};
      const count = Object.keys(moves).length;
      const strip = doc.createElement("div");
      strip.className = "g-code";
      strip.dataset.edits = arg.key;
      strip.innerHTML = "<span>" + gesc(arg.label.toLowerCase()) + " · " +
        (count || "none") + "</span><span>open ›</span>";
      strip.title = "Open it in the viewport to drag a handle";
      strip.addEventListener("click", () => this.openDefinition(entry.id));
      body.appendChild(strip);
    }

    if (entry.code !== undefined) {
      const strip = doc.createElement("div");
      strip.className = "g-code";
      strip.innerHTML = "<span>source · " + (entry.code.length > 999
        ? (entry.code.length / 1024).toFixed(1) + " kB" : entry.code.length + " chars") +
        "</span><span>open ›</span>";
      strip.title = "Edit the code in the definition panel";
      strip.addEventListener("click", () => this.openDefinition(entry.id));
      body.appendChild(strip);
    }

    if (entry.params && entry.params.length) {
      const head2 = doc.createElement("div");
      head2.className = "g-sect";
      head2.textContent = "declared by the script · " + entry.params.length;
      body.appendChild(head2);
      // Scrolled rather than stretched: a node that is 900 px tall shrinks every
      // other node in the graph when the canvas is framed.
      const scroller = doc.createElement("div");
      scroller.className = "g-params";
      scroller.addEventListener("pointerdown", event => event.stopPropagation());
      for (const param of entry.params)
        scroller.appendChild(param.options
          ? this.choiceRow(entry, { key: param.key, label: param.label, options: param.options },
                           Math.round(param.value))
          : this.realRow(entry, param, param.key, param.value, null));
      body.appendChild(scroller);
    }

    // What it computed, under everything it takes. A Panel is nothing else.
    if (entry.type === "Panel") el.classList.add("panel");
    const readout = doc.createElement("div");
    readout.className = "g-data";
    readout.hidden = !entry.data;
    if (entry.data) readout.innerHTML = gDataLine(entry.data);
    readout.addEventListener("pointerdown", event => event.stopPropagation());
    el.appendChild(readout);
    record.readout = readout;

    const error = doc.createElement("div");
    error.className = "g-err";
    error.hidden = true;
    el.appendChild(error);
    record.error = error;

    this.nodes.set(entry.id, record);
    this.wireNode(record, el, entry);
    head.addEventListener("dblclick", () => this.openDefinition(entry.id));
    out.addEventListener("pointerdown", event => this.startLink(event, entry.id, null));
    return el;
  }

  //! The two things every node does whatever is drawn on it: it drags, and
  //! pressing it selects. One place, so a set behaves like a node because it
  //! IS wired up like one rather than because two blocks of code agree.
  wireNode(record, el, entry) {
    this.drag(record.head, (dx, dy, start, done) => {
      const z = this.view.z;
      const x = start.x + dx / z, y = start.y + dy / z;
      el.style.left = x + "px"; el.style.top = y + "px";
      this.layout.set(entry.id, { x, y });
      this.drawWires();
      if (done) this.mdl.run({ op: "move", id: entry.id,
                               x: Math.round(x), y: Math.round(y) }).catch(() => {});
    }, () => {
      const now = this.layout.get(entry.id) || { x: 30, y: 30 };
      return { x: now.x, y: now.y };
    });
    el.addEventListener("pointerdown", () => {
      const { selected } = this.read();
      if (selected !== entry.id) this.mdl.run({ op: "select", id: entry.id }).catch(() => {});
    });
  }

  //! A number, with the port that may be driving it. Wired, the slider shows
  //! what is arriving and stops taking input.
  //! A SET, COLLAPSED. The head says what it is and how much it swallowed;
  //! the body is one row per input it takes and one per result something
  //! outside reads from it. The rows are ports, so the set is wired like any
  //! other node - which is the point: from out here it IS any other node.
  setNode(entry, features) {
    const doc = this.doc;
    const at = this.layout.get(entry.id) || { x: 30, y: 30 };
    const held = this.within(features, entry.id);
    const el = doc.createElement("div");
    el.className = "g-node g-set";
    el.style.left = at.x + "px";
    el.style.top = at.y + "px";
    el.dataset.id = entry.id;

    const head = doc.createElement("div");
    head.className = "g-head";
    head.innerHTML = gsvg(this.icons[entry.type] || this.icons.part || "")
      + '<span class="g-nm">' + gesc(entry.name) + "</span>"
      + '<span class="g-id">' + (held.length ? held.length + " in" : "empty") + "</span>";
    el.appendChild(head);

    const body = doc.createElement("div");
    body.className = "g-body";
    el.appendChild(body);

    const ports = new Map();
    //! THE INPUTS, GATHERED. Two things inside reading the same thing outside
    //! are ONE port here, for the same reason they are one row in the panel:
    //! they are one input asked for twice, and two ports would be two wires
    //! from one source to one node.
    const groups = this.inputsOf(features, entry.id);
    groups.forEach((group, at2) => {
      const row = doc.createElement("div");
      row.className = "g-row wired-row";
      const reads = group.rows.map(one => one.child.name + " \u00b7 " + one.arg.label);
      row.innerHTML = '<span class="g-lab">'
        + gesc(group.name || group.rows[0].arg.label) + "</span>"
        + '<span class="g-sub" style="font-size:9.5px">'
        + gesc(group.rows.length > 1 ? group.rows.length + " read it"
                                     : group.rows[0].arg.accepts) + "</span>";
      const port = doc.createElement("div");
      const first = group.rows[0];
      port.className = "g-port in" + (group.to ? " wired" : " slack");
      port.dataset.in = first.child.id;
      port.dataset.key = first.arg.key;
      port.dataset.kind = (first.arg.accepts || "").split(",")[0];
      //! The other arguments that share this input travel on the port, so a
      //! wire dropped here sets every one of them. Without this the visible
      //! one is repointed and the rest are quietly left behind.
      if (group.rows.length > 1)
        port.dataset.also = JSON.stringify(group.rows.slice(1)
          .map(one => ({ id: one.child.id, key: one.arg.key })));
      port.title = reads.join(", ")
        + (group.rows.length > 1 ? " \u2014 one input, and this sets all of them" : "");
      port.addEventListener("pointerdown", event => this.startLink(event, group.to || null, {
        id: first.child.id, key: first.arg.key, had: group.to || null,
        many: first.arg.kind === "refs",
        also: group.rows.slice(1).map(one => ({ id: one.child.id, key: one.arg.key })),
      }));
      row.appendChild(port);
      ports.set("in#" + at2, port);
      body.appendChild(row);
    });

    //! AND WHAT COMES OUT. Anything inside that something outside reads is a
    //! result of the set, and gets a port of its own - because from out here
    //! "the extrude in that set" is not a thing you can point at any more.
    const results = reachesOut(features, entry.id, {
      spec: type => this.spec(type),
      applies: (one, arg) => this.applies(one, arg),
    });
    const outs = new Map();
    for (const result of results) {
      const made = features.find(one => one.id === result.id);
      if (!made) continue;
      const row = doc.createElement("div");
      row.className = "g-row wired-row g-gives";
      row.innerHTML = '<span class="g-lab">' + gesc(made.name) + "</span>"
        + '<span class="g-sub" style="font-size:9.5px">'
        + gesc(made.produces || "shape") + "</span>";
      const port = doc.createElement("div");
      port.className = "g-port out";
      port.dataset.kind = made.produces || "solid";
      port.dataset.out = made.id;
      port.title = made.name + " \u2014 inside " + entry.name + ", and read outside it";
      port.addEventListener("pointerdown", event => this.startLink(event, made.id, null));
      row.appendChild(port);
      outs.set(made.id, port);
      body.appendChild(row);
    }

    if (!groups.length && !results.length) {
      const row = doc.createElement("div");
      row.className = "g-row";
      row.innerHTML = '<span class="g-lab">nothing in or out</span>'
        + '<span class="g-sub" style="font-size:9.5px">'
        + (held.length ? "it stands on its own" : "empty") + "</span>";
      body.appendChild(row);
    }

    const open = doc.createElement("div");
    open.className = "g-code g-open";
    open.innerHTML = "<span>" + (held.length ? "look inside" : "it is empty")
      + "</span><span>open \u203a</span>";
    open.title = "Double-click the node, or press this, to work on what is in it";
    open.addEventListener("click", event => { event.stopPropagation(); this.enterSet(entry.id); });
    body.appendChild(open);

    //! The set's own output port, kept on the head like every other node's, so
    //! a set can be wired somewhere as a set - into another set, say.
    const out = doc.createElement("div");
    out.className = "g-port out";
    out.dataset.kind = entry.produces || "text";
    out.dataset.out = entry.id;
    out.title = entry.name;
    head.appendChild(out);

    const error = doc.createElement("div");
    error.className = "g-err";
    error.hidden = true;
    el.appendChild(error);

    const record = { el, head, out, ports, outs, entry, error,
                     swallowed: new Set(held.map(one => one.id)), set: true };
    this.nodes.set(entry.id, record);
    this.wireNode(record, el, entry);
    el.addEventListener("dblclick", event => {
      event.stopPropagation();
      this.enterSet(entry.id);
    });
    return el;
  }

  realRow(entry, arg, key, value, ports) {
    const doc = this.doc;
    const from = entry.driven ? entry.driven[key] : null;
    const count = entry.lists ? entry.lists[key] : null;
    const row = doc.createElement("div");
    row.className = "g-row wired-row";
    row.style.display = "block";
    // The declared range is how far the track travels, not a cap on the value.
    const span = sliderSpan(arg, value);
    row.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px">' +
        '<span class="g-lab">' + gesc(arg.label || key) + "</span>" +
        (count > 1 ? '<span class="g-sub" style="font-size:9px">×' + count + "</span>" : "") +
        '<input class="g-num" type="number" step="' + arg.step + '" value="'
        + gnum(value) + '"' + (from ? " disabled" : "") +
        "></div>" +
      '<input class="g-rng" type="range" min="' + span.min + '" max="' + span.max +
      '" step="' + arg.step + '" value="' + value + '"' + (from ? " disabled" : "") + ">";

    if (ports) {
      const port = doc.createElement("div");
      port.className = "g-port in" + (from ? " wired" : " slack");
      port.dataset.in = entry.id;
      port.dataset.key = key;
      port.dataset.kind = "number";
      port.title = (arg.label || key) + " — takes a number";
      port.style.top = "11px";
      port.style.marginTop = "0";
      port.addEventListener("pointerdown", event => this.startLink(event, from || null, {
        id: entry.id, key, had: from || null,
      }));
      row.appendChild(port);
      ports.set(key, port);
    }
    const slider = row.querySelector(".g-rng"), number = row.querySelector(".g-num");
    slider.dataset.key = number.dataset.key = key;
    const send = raw => {
      const v = Number(raw);
      if (!Number.isFinite(v)) return;
      slider.value = v; number.value = gnum(v);
      this.push(entry.id, key, v);
    };
    for (const input of [slider, number]) {
      input.addEventListener("focus", () => { this.holding = input; });
      input.addEventListener("blur", () => { if (this.holding === input) this.holding = null; });
      input.addEventListener("pointerdown", event => event.stopPropagation());
    }
    slider.addEventListener("input", () => send(slider.value));
    number.addEventListener("change", () => send(number.value));
    return row;
  }

  choiceRow(entry, arg, current) {
    const doc = this.doc;
    const value = current === undefined ? entry.values[arg.key] : current;
    const row = doc.createElement("div");
    row.className = "g-row";
    row.style.display = "block";
    row.innerHTML = '<span class="g-lab" style="display:block;margin-bottom:2px">' +
      gesc(arg.label || arg.key) + "</span>";
    // A node is 216 px wide; eight alternatives do not fit across it.
    if (arg.options.length > 3) {
      const pick = doc.createElement("select");
      pick.className = "g-pick";
      pick.dataset.key = arg.key;
      pick.innerHTML = arg.options.map((option, index) =>
        '<option value="' + index + '"' + (index === value ? " selected" : "") + ">" +
        gesc(option) + "</option>").join("");
      pick.addEventListener("pointerdown", event => event.stopPropagation());
      pick.addEventListener("change", () => this.push(entry.id, arg.key, Number(pick.value)));
      row.appendChild(pick);
      return row;
    }
    const group = doc.createElement("div");
    group.className = "g-seg";
    group.dataset.key = arg.key;
    arg.options.forEach((option, index) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = option;
      button.setAttribute("aria-pressed", index === value ? "true" : "false");
      button.addEventListener("pointerdown", event => event.stopPropagation());
      button.addEventListener("click", () => this.push(entry.id, arg.key, index));
      group.appendChild(button);
    });
    row.appendChild(group);
    return row;
  }

  //! One wire, or several in order. A multi-wire input draws a row per wire and
  //! one empty row under them, which is where the next one lands.
  //! A line of text on the node itself - a list of numbers is short enough to
  //! read and to change without opening anything.
  textRow(entry, arg) {
    const doc = this.doc;
    const row = doc.createElement("div");
    row.className = "g-row";
    row.style.display = "block";
    row.innerHTML = '<span class="g-lab" style="display:block;margin-bottom:2px">' +
      gesc(arg.label) + "</span>";
    const input = doc.createElement("input");
    input.className = "g-line";
    input.type = "text";
    input.spellcheck = false;
    input.dataset.textKey = arg.key;
    input.value = (entry.texts && entry.texts[arg.key]) || "";
    input.addEventListener("pointerdown", event => event.stopPropagation());
    input.addEventListener("focus", () => { this.holding = input; });
    input.addEventListener("blur", () => { if (this.holding === input) this.holding = null; });
    input.addEventListener("change", () =>
      this.mdl.run({ op: "code", id: entry.id, key: arg.key, text: input.value },
                   { keepPanel: true }).catch(() => {}));
    row.appendChild(input);
    return row;
  }

  //! A drawing on a node. The node shows what is in it and opens the sketcher;
  //! the drawing itself is JSON on the same label the model file carries, so
  //! the node, the tree and the file are three windows onto one string.
  sketchRow(entry, arg) {
    const doc = this.doc;
    const row = doc.createElement("div");
    row.className = "g-row";
    row.style.display = "block";
    const summary = (entry.sketch && entry.sketch.summary) || "empty";
    row.innerHTML = '<span class="g-lab" style="display:block;margin-bottom:2px">' +
      gesc(arg.label) + '</span><span class="g-val" style="display:block;margin-bottom:3px">' +
      gesc(summary) + "</span>";
    const draw = doc.createElement("button");
    draw.className = "g-line";
    draw.type = "button";
    draw.textContent = "Draw…";
    draw.style.cursor = "pointer";
    draw.addEventListener("pointerdown", event => event.stopPropagation());
    draw.addEventListener("click", () => {
      this.mdl.run({ op: "select", id: entry.id }, { keepPanel: true }).catch(() => {});
      this.onSketch(entry.id);
    });
    row.appendChild(draw);
    return row;
  }

  //! Imported geometry, as a line that says how much of it there is. There is
  //! no control here because there is nothing to turn: an import is what it
  //! is, and what it holds is the shape itself.
  blobRow(entry, arg) {
    const size = (entry.sizes && entry.sizes[arg.key]) || 0;
    const row = this.doc.createElement("div");
    row.className = "g-code";
    row.innerHTML = "<span>" + gesc((arg.carries || arg.label).toLowerCase()) + "</span><span>"
      + gesc(size ? gsize(size) : "empty") + "</span>";
    row.title = "Read from a file. Nothing to turn - it is the geometry itself.";
    return row;
  }

  refRow(entry, arg, ports) {
    const doc = this.doc;
    const many = arg.kind === "refs";
    const wired = many ? (entry.lists[arg.key] || []) : [entry.refs[arg.key]].filter(Boolean);
    const accepts = arg.accepts.split(",");
    const box = doc.createElement("div");

    const draw = (target, index) => {
      const row = doc.createElement("div");
      row.className = "g-row wired-row";
      row.innerHTML = '<span class="g-lab">' +
        gesc(many ? (index === wired.length ? "add a " + accepts[0] : arg.label + " " + (index + 1))
                  : arg.label) + "</span>" +
        '<span class="g-sub" style="font-size:9.5px">' +
        gesc(target || accepts.join("/")) + "</span>";
      const port = doc.createElement("div");
      port.className = "g-port in" + (target ? " wired" : " slack");
      port.dataset.in = entry.id;
      port.dataset.key = arg.key;
      port.dataset.kind = accepts.length === 1 ? accepts[0] : "";
      port.title = arg.label + " — takes " + accepts.join(" or ") +
        (arg.consumes ? ", and consumes it" : "") + (many ? "; drag another in to add it" : "");
      port.addEventListener("pointerdown", event => this.startLink(event, target || null, {
        id: entry.id, key: arg.key, had: target || null, many,
      }));
      row.appendChild(port);
      ports.set(arg.key + (many ? "#" + index : ""), port);
      box.appendChild(row);
    };

    wired.forEach(draw);
    if (many || !wired.length) draw(null, wired.length);
    return box;
  }

  //! Values, names and failures, without rebuilding anything - the graph must
  //! survive a slider being dragged across it.
  update() {
    const { tree, selected } = this.read();
    if (!tree) return;
    for (const entry of tree.features) {
      const node = this.nodes.get(entry.id);
      if (!node) continue;
      node.entry = entry;
      node.el.classList.toggle("sel", entry.id === selected);
      node.el.classList.toggle("bad", !!entry.error);
      node.el.classList.toggle("off", !entry.visible);
      node.el.querySelector(".g-nm").textContent = entry.name;
      node.error.hidden = !entry.error;
      if (entry.error) node.error.textContent = entry.error;

      const values = { ...entry.values };
      for (const param of entry.params || []) values[param.key] = param.value;
      for (const input of node.el.querySelectorAll("[data-key]")) {
        const key = input.dataset.key;
        if (!(key in values)) continue;
        if (input.classList.contains("g-pick")) {
          if (input !== this.holding) input.value = String(Math.round(values[key]));
        } else if (input.classList.contains("g-seg")) {
          const at = Math.round(values[key]);
          [...input.children].forEach((button, index) =>
            button.setAttribute("aria-pressed", index === at ? "true" : "false"));
        } else if (input !== this.holding) {
          input.value = input.classList.contains("g-num") ? gnum(values[key]) : values[key];
        }
      }
      //! A COLLAPSED SET'S PORTS BELONG TO ITS MEMBERS. The port says whose
      //! argument it is - it has to, or a wire dropped on it would go
      //! nowhere - so whether it is wired is read off THAT feature, not off
      //! the set, which has no references of its own and so made every port
      //! on every set look permanently empty.
      for (const [slot, port] of node.ports) {
        const holder = node.set
          ? tree.features.find(one => one.id === port.dataset.in) : entry;
        if (!holder) continue;
        const key = node.set ? port.dataset.key : slot.split("#")[0];
        const list = holder.lists && Array.isArray(holder.lists[key]) ? holder.lists[key] : null;
        const target = list && !node.set ? list[Number(slot.split("#")[1])]
                     : list ? list[0]
                     : (holder.refs || {})[key] || (holder.driven || {})[key];
        port.classList.toggle("wired", !!target);
        port.classList.toggle("slack", !target);
      }
      for (const input of node.el.querySelectorAll("[data-text-key]")) {
        const value = (entry.texts && entry.texts[input.dataset.textKey]) || "";
        if (input !== this.holding && input.value !== value) input.value = value;
      }
      for (const strip of node.el.querySelectorAll("[data-edits]")) {
        const moves = (entry.lists && entry.lists[strip.dataset.edits]) || {};
        const count = Object.keys(moves).length;
        strip.firstElementChild.textContent =
          strip.firstElementChild.textContent.split(" · ")[0] + " · " + (count || "none");
      }
      if (node.readout) {
        node.readout.hidden = !entry.data;
        if (entry.data) node.readout.innerHTML = gDataLine(entry.data);
      }
    }
    this.drawWires();
  }

  /* ------------------------------------------------------------------- wires */

  drawWires() {
    // The window can go while a redraw is in flight - a popup closed, a panel
    // taken out of the page - and a detached node has no geometry to measure.
    if (!this.showing || !this.root || !this.root.isConnected) return;
    const { tree } = this.read();
    if (!tree) return;
    const { x, y, z } = this.view;
    this.el.wires.setAttribute("transform", "translate(" + x + "," + y + ") scale(" + z + ")");
    const parts = [];
    const drawn = new Set();
    const link = (source, node, port, kind, bad) => {
      if (!source || !node || source === node) return;
      // A set swallows its own plumbing: two of its members wired to one
      // outside source is ONE wire into the set, not two on top of each other.
      const once = source.entry.id + ">" + node.entry.id + ":" + port.dataset.key;
      if (drawn.has(once)) return;
      drawn.add(once);
      const a = this.portAt(source, source.out), b = this.portAt(node, port);
      parts.push('<path class="' + (kind || "") + (bad ? " dashed" : "") +
        '" d="' + this.curve(a, b) + '"/>');
    };
    for (const node of this.nodes.values()) {
      const entry = node.entry;
      for (const [slot, port] of node.ports) {
        // A collapsed set's ports name the member that holds the wire, not
        // the set - so the source is read off the port rather than off the
        // node whose body it happens to sit in.
        const holder = node.set ? tree.features.find(one => one.id === port.dataset.in) : entry;
        if (!holder) continue;
        const key = node.set ? port.dataset.key : slot.split("#")[0];
        const list = holder.lists && Array.isArray(holder.lists[key]) ? holder.lists[key] : null;
        const from = list && !node.set ? list[Number(slot.split("#")[1])]
                   : list ? list[0]
                   : (holder.refs || {})[key] || (holder.driven || {})[key];
        const source = from ? this.standsFor(tree.features, from) : null;
        if (!source) continue;
        link(source, node, port, source.entry.produces, holder.error);
      }
    }
    if (this.linking && this.linking.to) {
      const a = this.linking.from, b = this.linking.to;
      parts.push('<path class="lit dashed" d="' + this.curve(a, b) + '"/>');
    }
    this.el.wires.innerHTML = parts.join("");
  }

  //! Where a port sits in graph coordinates. Ports live at three depths - on the
  //! header, on a row, on a row inside a group of them - so the offsets are
  //! walked up to the node rather than assumed.
  portAt(node, port) {
    const at = this.layout.get(node.entry.id) || { x: 0, y: 0 };
    let x = port.offsetLeft + port.offsetWidth / 2;
    let y = port.offsetTop + port.offsetHeight / 2;
    let parent = port.offsetParent;
    while (parent && parent !== node.el) {
      x += parent.offsetLeft;
      y += parent.offsetTop;
      parent = parent.offsetParent;
    }
    return { x: at.x + x, y: at.y + y };
  }

  curve(a, b) {
    const reach = Math.max(38, Math.abs(b.x - a.x) * 0.45);
    return "M" + a.x + " " + a.y + "C" + (a.x + reach) + " " + a.y + "," +
      (b.x - reach) + " " + b.y + "," + b.x + " " + b.y;
  }

  //! Dragging from a port. From an output it makes a wire; from a wired input it
  //! picks the wire up, and dropping it nowhere is a disconnect.
  startLink(event, sourceId, input) {
    event.preventDefault();
    event.stopPropagation();
    if (input && !input.had && !sourceId) return;
    const doc = this.doc;
    const source = sourceId ? this.nodes.get(sourceId) : null;
    if (!source) return;
    const from = this.portAt(source, source.out);
    this.linking = { sourceId, input, from, to: from };

    const move = e => {
      this.linking.to = this.toGraph(e.clientX, e.clientY, true);
      this.drawWires();
      const over = doc.elementFromPoint(e.clientX, e.clientY);
      for (const port of this.root.querySelectorAll(".g-port.hot, .g-port.adding"))
        port.classList.remove("hot", "adding");
      if (over && over.dataset && over.dataset.in) {
        over.classList.add("hot");
        // Holding shift says this wire joins the ones already there, so the
        // port says so before the button is let go.
        if (e.shiftKey) over.classList.add("adding");
      }
    };
    const up = async e => {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      for (const port of this.root.querySelectorAll(".g-port.hot, .g-port.adding"))
        port.classList.remove("hot", "adding");
      const over = doc.elementFromPoint(e.clientX, e.clientY);
      const landed = over && over.dataset && over.dataset.in
        ? { id: over.dataset.in, key: over.dataset.key,
            also: over.dataset.also ? JSON.parse(over.dataset.also) : [] } : null;
      this.linking = null;
      this.drawWires();
      try {
        if (input && !landed && input.had) {
          // Dropped in empty space: the wire comes off. An input holding several
          // loses only the one that was picked up - and an input that several
          // arguments share comes off all of them, because it is one input.
          await this.mdl.runAll([{ id: input.id, key: input.key },
                                 ...(input.also || [])]
            .map(at => input.many
              ? { op: "disconnect", id: at.id, key: at.key, from: input.had }
              : { op: "disconnect", id: at.id, key: at.key }));
        } else if (landed) {
          // Standard node grammar: a wire dropped on an input is the input;
          // shift adds one more. On an input that only ever holds one wire it
          // makes no difference, which is why shift is safe to hold anywhere.
          //
          // AND A PORT MAY STAND FOR SEVERAL ARGUMENTS. A collapsed set shows
          // one port for an input that two of its members read, so the wire
          // dropped on it has to reach both - otherwise the one you can see
          // is repointed and the one you cannot is quietly left behind.
          const also = landed.also || [];
          await this.mdl.runAll([{ id: landed.id, key: landed.key }, ...also]
            .map(at => ({ op: "connect", id: at.id, key: at.key,
                          from: sourceId, mode: e.shiftKey ? undefined : "only" })));
        }
      } catch (err) { /* the console has it */ }
    };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up);
  }

  /* ------------------------------------------------------------- pan and zoom */

  wireCanvas() {
    const canvas = this.el.canvas;
    canvas.addEventListener("pointerdown", event => {
      canvas.focus({ preventScroll: true });
      if (event.button === 1 || (event.button === 0 && event.target === canvas)) {
        if (event.target === canvas) this.mdl.run({ op: "select", id: null }).catch(() => {});
        canvas.classList.add("panning");
        const x0 = event.clientX - this.view.x, y0 = event.clientY - this.view.y;
        const move = e => { this.view.x = e.clientX - x0; this.view.y = e.clientY - y0; this.applyView(); };
        const up = () => {
          canvas.classList.remove("panning");
          this.doc.removeEventListener("pointermove", move);
          this.doc.removeEventListener("pointerup", up);
        };
        this.doc.addEventListener("pointermove", move);
        this.doc.addEventListener("pointerup", up);
      }
    });
    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left, py = event.clientY - rect.top;
      const step = Math.exp(-event.deltaY * 0.0016);
      const z = Math.max(0.28, Math.min(2.2, this.view.z * step));
      const ratio = z / this.view.z;
      this.view.x = px - (px - this.view.x) * ratio;
      this.view.y = py - (py - this.view.y) * ratio;
      this.view.z = z;
      this.applyView();
    }, { passive: false });
  }

  applyView() {
    const { x, y, z } = this.view;
    this.el.layer.style.transform = "translate(" + x + "px," + y + "px) scale(" + z + ")";
    this.drawWires();
  }

  //! Canvas pixels to graph coordinates.
  toGraph(clientX, clientY, absolute) {
    const rect = this.el.canvas.getBoundingClientRect();
    const px = absolute ? clientX - rect.left : clientX;
    const py = absolute ? clientY - rect.top : clientY;
    return { x: (px - this.view.x) / this.view.z, y: (py - this.view.y) / this.view.z };
  }

  frame() {
    if (!this.showing || !this.nodes.size) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [id, node] of this.nodes) {
      const at = this.layout.get(id) || { x: 0, y: 0 };
      minX = Math.min(minX, at.x); minY = Math.min(minY, at.y);
      maxX = Math.max(maxX, at.x + node.el.offsetWidth);
      maxY = Math.max(maxY, at.y + node.el.offsetHeight);
    }
    const rect = this.el.canvas.getBoundingClientRect();
    const z = Math.max(0.28, Math.min(1.15,
      Math.min((rect.width - 60) / (maxX - minX || 1), (rect.height - 60) / (maxY - minY || 1))));
    this.view.z = z;
    this.view.x = (rect.width - (maxX - minX) * z) / 2 - minX * z;
    this.view.y = (rect.height - (maxY - minY) * z) / 2 - minY * z;
    this.applyView();
  }

  //! Re-columns the graph, as one batch of move edits - so tidying up is
  //! recorded in the same language as everything else and travels in the file.
  async tidy() {
    const { tree } = this.read();
    if (!tree) return;
    this.pack(tree.features, new Set(tree.features.map(f => f.id)));
    await this.mdl.runAll(tree.features.map(f => {
      const at = this.layout.get(f.id);
      return { op: "move", id: f.id, x: Math.round(at.x), y: Math.round(at.y) };
    }));
    this.frame();
  }

  push(id, key, value) {
    // Coalesced the same way the definition panel coalesces: a dragged slider
    // is one edit per frame the kernel can keep up with, not one per pixel.
    this.pending = { id, key, value };
    if (this.inFlight) return;
    this.inFlight = true;
    (async () => {
      while (this.pending) {
        const next = this.pending;
        this.pending = null;
        try { await this.mdl.run({ op: "set", ...next }, { keepPanel: true }); }
        catch (e) { /* the console has it */ }
      }
      this.inFlight = false;
    })();
  }
}

GraphEditor.top = 60;
