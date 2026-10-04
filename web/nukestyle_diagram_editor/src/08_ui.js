// =====================================================================
// Interface. Every pane is a view of the document; edits go through
// mutate()/beginEdit()/endEdit() so each user action is one undo step.
// =====================================================================
const ui = {
  sel: new Set(), selWire: null, pan: { x: 60, y: 120 }, zoom: 0.8, mouse: { x: 400, y: 300 }, mouseWorld: { x: 0, y: 0 },
  slot: 0, pins: [null, null, null, null, null], viewPort: {}, wipe: false, wipeX: 0.5, alpha: false, fullRes: false, previewRow: 0, propsTab: 'props',
  statusDirty: false, filesDirty: false, portPos: new Map(), clipboard: null, vview: { zoom: 1, ox: 0, oy: 0, fit: true }, mshow: null,
};
const world = $('#world'), canvasEl = $('#canvas'), nodesEl = $('#nodes'), wiresEl = $('#wires'), backdropsEl = $('#backdrops');
const KCOL = k => `var(--k-${k || 'any'})`;

// ---------------------------------------------------------------- doc change plumbing
let _renderQueued = false, _lsTimer = null;
function docChanged(structural) {
  ui.statusDirty = true;
  if (!_renderQueued) { _renderQueued = true; requestAnimationFrame(() => { _renderQueued = false; render(); }); }
  requestEval();
  if (doc.settings.autosave !== false) scheduleAutoSave();
  clearTimeout(_lsTimer); _lsTimer = setTimeout(() => { if (!LS.set('dc.doc.v2', doc)) LS.set('dc.doc.v2', { ...doc, assets: {} }); }, 600);
}
function render() {
  renderGraph(); renderCrumbs(); renderRowPicker();
  const pf = document.activeElement && $('#props').contains(document.activeElement) && document.activeElement.matches('input,textarea,select');
  if (!pf) renderProps();
  renderSlots();
}

// ---------------------------------------------------------------- graph canvas
function applyTransform() {
  world.style.transform = `translate(${ui.pan.x}px,${ui.pan.y}px) scale(${ui.zoom})`;
  canvasEl.style.backgroundSize = `${22 * ui.zoom}px ${22 * ui.zoom}px`;
  canvasEl.style.backgroundPosition = `${ui.pan.x}px ${ui.pan.y}px`;
}
const toWorld = (cx, cy) => { const r = canvasEl.getBoundingClientRect(); return { x: (cx - r.left - ui.pan.x) / ui.zoom, y: (cy - r.top - ui.pan.y) / ui.zoom }; };
const nodeEls = new Map();
function nodeSummary(n) {
  const a = n.args || {};
  switch (n.type) {
    case 'viewport': { const m = getModel(a.model); const lp = parseLayerPath(a.path, m); return canonicalPath({ ...lp, camera: a.camera || lp.camera, style: a.style || lp.style || 'shaded' }); }
    case 'merge': return BLEND_LABEL[a.mode || 'normal'] + ' · ' + (a.opacity == null ? 100 : a.opacity) + '%';
    case 'colourOverlay': return colourHex(a.colour || '#c9ccd1') + ' · ' + (a.amount == null ? 100 : a.amount) + '%';
    case 'opacity': return (a.opacity == null ? 60 : a.opacity) + '%';
    case 'save': { try { const rows = rowsFor(n); return saveName(n, rows[clampI(ui.previewRow, 0, rows.length - 1)] || {}, ui.previewRow).path; } catch { return ''; } }
    case 'permutation': { try { return permRows(resolveArgs(n, makeCtx(), [])).rows.length + ' rows'; } catch { return ''; } }
    case 'group': { const d = doc.defs[a.def]; return d ? `${Object.keys(d.nodes).length} nodes · shared ×${countDefUses(a.def)}` : 'missing definition'; }
    case 'pointProject': return a.geoset || '';
    case 'modelSource': { const r = doc.models[a.model], m = r && (r.kind === 'ocaf' ? ocafModel(a.model) : getModel(a.model)); const c = ocafCache.get(a.model); if (!r) return 'no model'; if (r.kind === 'ocaf' && !m) return c && c.error ? 'failed: ' + c.error : 'building…'; return `${r.name || a.model} · ${m._index ? m._index.geosets.length : 0} sets · ${m.cameras.length} cameras`; }
    case 'extractGeoset': return a.geoset || 'Everything';
    case 'extractCamera': return a.camera || 'first camera';
    case 'extractPoints': return (a.geoset || 'Everything') + ' · ' + ({ auto: 'points + vectors', points: 'points', vectors: 'vectors', vectorTips: 'vector tips', both: 'points and vectors', elements: 'object centres' }[a.source || 'auto'] || '');
    case 'render': return (STYLE_LABEL[a.style] || 'Shaded') + (a.sizeMode === 'canvas' ? ' · canvas' : ' · camera frame');
    case 'text': return String(a.text || '').split('\n')[0];
    case 'stroke': return `${a.width == null ? 2 : a.width}px ${a.position || 'outside'}`;
    case 'value': return `${a.name || ''} = ${a.value == null ? 60 : a.value}`;
    case 'nanoBanana': return a.result ? 'result kept · seed ' + (a.resultSeed == null ? '' : a.resultSeed) : 'not run';
    default: return '';
  }
}
function countDefUses(defId) { let c = 0; const walk = g => { for (const n of Object.values(g.nodes)) if (n.type === 'group' && n.args.def === defId) c++; }; walk(doc); for (const d of Object.values(doc.defs)) walk(d); return c; }
function thumbPort(n) {
  if (n.type === 'save') return { input: 'image' };
  const o = nodeOutputs(n).find(p => p.k === 'image' || p.k === 'mask');
  if (o) return { port: ui.viewPort[n.id] && nodeOutputs(n).some(p => p.n === ui.viewPort[n.id] && (p.k === 'image' || p.k === 'mask')) ? ui.viewPort[n.id] : o.n };
  const any = nodeOutputs(n).find(p => p.k === 'any'); if (any) return { port: any.n };
  return null;
}
// Prompt and Run right on the Nano Banana node. Events stop here so typing, scrolling and clicking
// in the box never drag the node, zoom the canvas or fire graph shortcuts.
function nanoWidget(n) {
  const stop = e => e.stopPropagation();
  const ta = h('textarea', { class: 'inp nano-prompt', rows: 3, placeholder: 'What should it do with the image? e.g. add people and trees, keep the linework', value: n.args.prompt || '',
    'data-nano': n.id, oninput: e => { beginEdit(); n.args.prompt = e.target.value; ui.statusDirty = true; requestEval(); if (doc.settings.autosave !== false) scheduleAutoSave(); }, onchange: () => { endEdit(); renderProps(); } });
  ta.value = n.args.prompt || '';
  const neg = h('textarea', { class: 'inp nano-prompt nano-neg', rows: 2, placeholder: 'Avoid… e.g. no people, no text, keep linework unchanged', 'data-nano': n.id + ':neg',
    oninput: e => { beginEdit(); n.args.negative = e.target.value; ui.statusDirty = true; requestEval(); if (doc.settings.autosave !== false) scheduleAutoSave(); }, onchange: () => { endEdit(); renderProps(); } });
  neg.value = n.args.negative || '';
  const run = h('button', { class: 'btn primary small', onclick: async e => { e.target.disabled = true; try { await ACTIONS.runNanoBanana(n, currentGraph()); } finally { e.target.disabled = false; } } }, n.args.result ? 'Run again' : 'Run');
  const box = h('div', { class: 'nano-box' }, ta, neg, h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, run, h('span', { class: 'hint', style: { margin: 0 } }, n.args.result ? 'result kept' : 'not run yet')));
  for (const ev of ['pointerdown', 'mousedown', 'dblclick', 'wheel', 'keydown', 'contextmenu']) box.addEventListener(ev, stop);
  return box;
}
function reverseWidget(n) {
  const stop = e => e.stopPropagation();
  const ta = h('textarea', { class: 'inp nano-prompt', rows: 5, placeholder: 'Press Run: Gemini reads the image and writes the prompt here. You can edit it.', 'data-nano': n.id + ':rev',
    oninput: e => { beginEdit(); n.args.text = e.target.value; ui.statusDirty = true; requestEval(); if (doc.settings.autosave !== false) scheduleAutoSave(); }, onchange: () => { endEdit(); renderProps(); } });
  ta.value = n.args.text || '';
  const run = h('button', { class: 'btn primary small', onclick: async e => { e.target.disabled = true; try { await ACTIONS.runReversePrompt(n, currentGraph()); } finally { e.target.disabled = false; } } }, n.args.text ? 'Run again' : 'Run');
  const copy = h('button', { class: 'btn line small', onclick: async () => { try { await navigator.clipboard.writeText(n.args.text || ''); toast('Prompt copied.'); } catch { toast('Could not copy here.', 'error'); } } }, 'Copy');
  const box = h('div', { class: 'nano-box' }, ta, h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, run, copy));
  for (const ev of ['pointerdown', 'mousedown', 'dblclick', 'wheel', 'keydown', 'contextmenu']) box.addEventListener(ev, stop);
  return box;
}
function renderGraph() {
  const g = currentGraph(), af = document.activeElement, keep = af && af.dataset && af.dataset.nano ? { id: af.dataset.nano, a: af.selectionStart, b: af.selectionEnd } : null;
  queueMicrotask(() => { if (!keep) return; const t = nodesEl.querySelector(`textarea[data-nano="${keep.id}"]`); if (t && document.activeElement !== t) { t.focus(); try { t.setSelectionRange(keep.a, keep.b); } catch { } } });
  nodesEl.innerHTML = ''; backdropsEl.innerHTML = ''; nodeEls.clear();
  for (const n of Object.values(g.nodes)) {
    if (n.type === 'backdrop') { backdropsEl.append(renderBackdrop(n)); continue; }
    const t = T(n.type), fam = FAMILIES[t.family] || FAMILIES.org;
    const el = h('div', { class: 'node' + (t.wide ? ' wide' : '') + (ui.sel.has(n.id) ? ' selected' : '') + (n.disabled ? ' disabled' : ''), 'data-id': n.id, style: { left: n.x + 'px', top: n.y + 'px', width: t.compact ? '90px' : null } });
    const head = h('div', { class: 'nh' }, h('span', { class: 'chip', style: { background: fam.colour } }), h('span', { class: 'nt', title: t.label }, n.name || t.label));
    if (n.type === 'save' || n.type === 'permutation') { const r = n.type === 'save' ? rowsFor(n).length : (() => { try { return permRows(resolveArgs(n, makeCtx(), [])).rows.length; } catch { return 0; } })(); if (r > 1) head.append(h('span', { class: 'badge', title: 'Rows' }, '×' + r)); }
    head.append(h('span', { class: 'dot', title: 'Status' }));
    el.append(head);
    const sum = nodeSummary(n); if (sum && !t.compact) el.append(h('div', { class: 'nsub', title: sum }, sum));
    if (thumbPort(n) && !t.compact) el.append(t.wide ? h('canvas', { class: 'thumb', width: 504, height: 320 }) : h('canvas', { class: 'thumb', width: 164, height: 123 }));
    if (n.type === 'nanoBanana' && !t.compact) el.append(nanoWidget(n));
    if (n.type === 'reversePrompt' && !t.compact) el.append(reverseWidget(n));
    el.append(h('div', { class: 'nmsg', hidden: true }));
    const ins = nodeInputs(n), outs = nodeOutputs(n);
    const pIn = h('div', { class: 'pcol in' }), pOut = h('div', { class: 'pcol out' });
    for (const p of ins) {
      const k = p.k === 'any' ? (resolveKindIn(g, n.id, p.n) || 'any') : p.k;
      pIn.append(h('div', { class: 'port' + (p.promoted ? ' promoted' : ''), 'data-port': p.n, title: `${p.l || p.n} · ${KIND_LABEL[k]}` }, h('span', { class: 'pin', 'data-node': n.id, 'data-port': p.n, 'data-dir': 'in', 'data-kind': k, style: { background: n.inputs[p.n] ? KCOL(k) : 'var(--node)', boxShadow: `0 0 0 1.5px ${KCOL(k)}` } }), h('span', { class: 'lbl' }, t.compact ? '' : (p.l || p.n))));
    }
    for (const p of outs) {
      const k = p.k === 'any' ? (resolveKindOut(g, n.id, p.n) || 'any') : p.k;
      const viewing = (ui.viewPort[n.id] || (outs[0] && outs[0].n)) === p.n && outs.length > 1;
      pOut.append(h('div', { class: 'port' + (viewing ? ' viewing' : ''), 'data-port': p.n, title: `${p.l || p.n} · ${KIND_LABEL[k]} — click to view` }, h('span', { class: 'lbl' }, t.compact ? '' : (p.l || p.n)), h('span', { class: 'pin', 'data-node': n.id, 'data-port': p.n, 'data-dir': 'out', 'data-kind': k, style: { background: KCOL(k) } })));
    }
    if (ins.length || outs.length) el.append(h('div', { class: 'ports', style: t.compact ? { padding: '6px 0' } : null }, pIn, pOut));
    nodesEl.append(el); nodeEls.set(n.id, el);
  }
  applyTransform();
  refreshStatusDom(true);
  for (const [id] of nodeEls) if (thumbs.has(id)) drawThumb(id, thumbs.get(id));
  layoutPorts(); drawWires();
}
function renderBackdrop(n) {
  const c = parseColour(n.args.colour || '#3554d1');
  const el = h('div', { class: 'backdrop' + (ui.sel.has(n.id) ? ' selected' : ''), 'data-id': n.id, style: { left: n.x + 'px', top: n.y + 'px', width: (n.w || 400) + 'px', height: (n.h || 300) + 'px',
    background: `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},.07)`, borderColor: `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},.35)` } },
    h('div', { class: 'bl', style: { color: colourHex(c) } }, n.args.label || 'Backdrop'), h('div', { class: 'rs' }));
  return el;
}
function layoutPorts() {
  ui.portPos.clear();
  const wr = world.getBoundingClientRect();
  for (const pin of $$('.pin', nodesEl)) {
    const r = pin.getBoundingClientRect();
    ui.portPos.set(`${pin.dataset.node}|${pin.dataset.dir}|${pin.dataset.port}`, { x: (r.left + r.width / 2 - wr.left) / ui.zoom, y: (r.top + r.height / 2 - wr.top) / ui.zoom, kind: pin.dataset.kind });
  }
}
const wirePath = (a, b) => { const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
function drawWires(tmp) {
  const g = currentGraph(); let s = '';
  for (const n of Object.values(g.nodes)) for (const p in n.inputs || {}) {
    const src = n.inputs[p], a = ui.portPos.get(`${src.node}|out|${src.port}`), b = ui.portPos.get(`${n.id}|in|${p}`); if (!a || !b) continue;
    const sel = ui.selWire && ui.selWire.node === n.id && ui.selWire.port === p, d = wirePath(a, b);
    const dis = g.nodes[src.node] && g.nodes[src.node].disabled;
    s += `<path class="hit" d="${d}" data-node="${n.id}" data-port="${esc(p)}"/><path class="w${sel ? ' sel' : ''}" d="${d}" stroke="${KCOL(b.kind !== 'any' ? b.kind : a.kind)}" ${dis ? 'stroke-dasharray="6 5"' : ''} opacity="${sel ? 1 : 0.85}" data-node="${n.id}" data-port="${esc(p)}"/>`;
  }
  if (tmp) s += `<path class="tmp${tmp.bad ? ' bad' : ''}" d="${wirePath(tmp.a, tmp.b)}" stroke="${KCOL(tmp.kind)}"/>`;
  wiresEl.innerHTML = s;
}
function refreshStatusDom(force) {
  if (!ui.statusDirty && !force) return; ui.statusDirty = false;
  const g = currentGraph();
  for (const [id, el] of nodeEls) {
    const st = getStatus(g, id), dot = $('.dot', el), msg = $('.nmsg', el), n = g.nodes[id];
    let state = st ? st.state : 'stale', text = st ? st.msg : '';
    if (n && n.type === 'save' && n._lastWrite && !text) { const r = n._lastWrite; if (r.status === 'error') { state = 'error'; text = r.msg; } }
    if (n && n.type === 'save') { const jobs = saveJobs().filter(j => j.node.id === id); const dup = jobs.find(j => j.dup); if (dup) { state = 'error'; text = `Two Save nodes write ${dup.path}: ${dup.dup.join(', ')}.`; } }
    dot.className = 'dot ' + (state === 'cached' ? 'cached' : state);
    dot.title = { cached: 'Cached', ok: 'Up to date', rendering: 'Rendering', warn: 'Rendered with warnings', error: 'Error', stale: 'Stale' }[state] + (st && st.ms ? ` · ${st.ms.toFixed(0)} ms` : '');
    if (text && (state === 'warn' || state === 'error')) { msg.hidden = false; msg.className = 'nmsg ' + state; msg.textContent = text.length > 140 ? text.slice(0, 137) + '…' : text; msg.title = text; }
    else msg.hidden = true;
  }
}
const thumbs = new Map(); // last value shown per node, so a redraw of the canvas keeps its thumbnails
function drawThumb(id, v) {
  thumbs.set(id, v);
  const el = nodeEls.get(id); if (!el) return; const cv = $('canvas.thumb', el); if (!cv) return;
  const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  if (!v || !v.d) return;
  const src = v.kind === 'mask' || v.kind === 'image' ? cachedCanvas(v) : null; if (!src) return;
  const k = Math.min(cv.width / v.w, cv.height / v.h), w = v.w * k, hh = v.h * k;
  g.imageSmoothingQuality = 'high'; g.drawImage(src, (cv.width - w) / 2, (cv.height - hh) / 2, w, hh);
}
const _cvCache = new WeakMap();
function cachedCanvas(v, alpha) { const key = alpha ? 'a' : 'c'; let e = _cvCache.get(v); if (!e) { e = {}; _cvCache.set(v, e); } if (!e[key]) e[key] = IMG.toCanvas(v, { alpha }); return e[key]; }

// ---------------------------------------------------------------- preview pass
let evalTimer = null, evalGen = 0;
function requestEval() { clearTimeout(evalTimer); evalTimer = setTimeout(runPreviewPass, 30); }
async function runPreviewPass() {
  const gen = ++evalGen, g = currentGraph(), scope = scopeForView();
  const ctx = makeCtx({ track: true, gen, ...previewVars() });
  ctx.yield = async () => { refreshStatusDom(); await sleep0(); };
  await updateViewer(gen);
  const list = Object.values(g.nodes).filter(n => n.type !== 'backdrop').sort((a, b) => a.x - b.x || a.y - b.y);
  for (const n of list) {
    if (gen !== evalGen) return;
    const tp = thumbPort(n); let v = null;
    if (tp && tp.input) { const s = n.inputs[tp.input]; v = s ? await evalPort(g, s.node, s.port, ctx, scope) : null; await evalPort(g, n.id, '__status', ctx, scope); }
    else if (tp) v = await evalPort(g, n.id, tp.port, ctx, scope);
    else { const o = nodeOutputs(n)[0]; await evalPort(g, n.id, o ? o.n : '__status', ctx, scope); }
    if (gen !== evalGen) return;
    drawThumb(n.id, v); refreshStatusDom();
    await sleep0();
  }
  refreshStatusDom(); if (ui.propsTab === 'layers') renderLayerThumbs();
}

// ---------------------------------------------------------------- viewer
const vstage = $('#vstage'), vcanvas = $('#vcanvas');
function viewerTarget(slot = ui.slot) {
  const g = currentGraph();
  if (slot === 0) { const id = [...ui.sel].find(i => g.nodes[i] && g.nodes[i].type !== 'backdrop'); return id ? { g, id, scope: scopeForView() } : null; }
  const p = ui.pins[slot]; if (!p) return null;
  const pg = p.graph === 'root' ? doc : doc.defs[p.graph.replace('def:', '')]; if (!pg || !pg.nodes[p.id]) return null;
  return { g: pg, id: p.id, scope: pg === currentGraph() ? scopeForView() : null };
}
// The viewer shows a node at the size it will be saved: an Extract Camera's resolution upstream sets
// the shape, and the preview keeps about the graph preview's pixel count so it stays quick.
function viewCtx(g, id, o = {}) {
  const r = cameraRes(g, id), full = fullCtx(g, id, 0, o); ui._vFull = [full.w, full.h];
  if (o.full) return full;
  return r ? makeCtx({ ...o, base: r, scale: doc.settings.preview * doc.settings.width / r.w }) : makeCtx(o);
}
async function valueFor(t, gen) {
  if (!t) return null;
  const n = t.g.nodes[t.id]; if (!n) return null;
  const ctx = viewCtx(t.g, t.id, { track: !ui.fullRes, full: ui.fullRes, ...previewVars() }); ctx.yield = async () => { refreshStatusDom(); await sleep0(); };
  const outs = nodeOutputs(n);
  if (!outs.length) { const inp = nodeInputs(n).find(p => p.k === 'image') || nodeInputs(n)[0]; const s = inp && n.inputs[inp.n]; return s ? evalPort(t.g, s.node, s.port, ctx, t.scope) : null; }
  const port = ui.viewPort[n.id] && outs.some(o => o.n === ui.viewPort[n.id]) ? ui.viewPort[n.id] : outs[0].n;
  return evalPort(t.g, t.id, port, ctx, t.scope);
}
let _vA = null, _vB = null;
async function updateViewer(gen) {
  if ($('#viewer').hidden || document.body.classList.contains('graph-only')) return; // closed: nothing to draw
  const t = viewerTarget();
  const name = t ? (t.g.nodes[t.id].name || T(t.g.nodes[t.id].type).label) : '—';
  $('#vName').textContent = name + (ui.fullRes ? ' · full res' : '');
  if (ui.wipe) { const [a, b] = await Promise.all([valueFor(viewerTarget(1)), valueFor(viewerTarget(2))]); _vA = a; _vB = b; }
  else { _vA = await valueFor(t); _vB = null; }
  if (gen != null && gen !== evalGen) return;
  drawViewer();
}
function drawViewer() {
  const v = _vA, sw = vstage.clientWidth, sh = vstage.clientHeight, vt = $('#vtext'), wipeEl = $('#vwipe');
  vcanvas.width = Math.max(1, sw * devicePixelRatio); vcanvas.height = Math.max(1, sh * devicePixelRatio); vcanvas.style.width = sw + 'px'; vcanvas.style.height = sh + 'px';
  const g = vcanvas.getContext('2d'); g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); g.clearRect(0, 0, sw, sh);
  wipeEl.hidden = !ui.wipe;
  const isPix = x => x && (x.kind === 'image' || x.kind === 'mask');
  const sizeEl = $('#vSize');
  if (!v && !(ui.wipe && _vB)) { vt.hidden = false; vt.textContent = ui.wipe ? 'Pin nodes to slots 1 and 2 to compare (select a node, press 1 or 2).' : (viewerTarget() ? 'No output yet.' : 'Select a node to view its output. Press 1–4 to pin it to a slot.'); sizeEl.textContent = ''; return; }
  if (v && !isPix(v) && v.kind !== 'points') {
    vt.hidden = false; sizeEl.textContent = '';
    if (v.kind === 'perm') vt.textContent = `${v.rows.length} rows\n\n` + v.rows.map((r, i) => `${String(i + 1).padStart(3)}  ${Object.entries(r).map(([k, x]) => `${k}=${x}`).join('  ')}`).join('\n');
    else if (v.kind === 'model') { const m = v.model; vt.textContent = `Model ${m.name}\n${m.elements.length} elements · ${m.cameras.length} cameras${m.stats ? ' · ' + m.stats.triangles + ' triangles' : ''}\n\nGeosets\n${m._index.geosets.map(g => '  ' + g).join('\n')}\n\nCameras\n${m.cameras.map(c => '  ' + c.name + (c.lens ? ` · ${c.lens} mm · ${c.frameLabel}` : '')).join('\n')}`; }
    else if (v.kind === 'geoset') vt.textContent = `Geoset ${v.path}\n${v.count} element${v.count === 1 ? '' : 's'}`;
    else if (v.kind === 'field') vt.textContent = 'Field\n\n' + v.values.map((x, i) => `${(v.ids && v.ids[i]) || i}  ${(+x).toFixed(3)}`).join('\n');
    else if (v.kind === 'camera') { const c = v.cam; vt.textContent = `Camera ${v.name}\n${c.ortho ? 'Orthographic' : 'Perspective'} · ${c.w}×${c.h}px\n${c.ortho ? `${(c.def.span / c.h * 1000).toFixed(1)} mm per px · span ${c.def.span} m` : `fov ${(+c.fov).toFixed(1)}°${c.def && c.def.lens ? ' · lens ' + c.def.lens + ' mm' : ''}${c.def && c.def.frameLabel ? ' · frame ' + c.def.frameLabel : ''}`}\neye ${c.eye.map(x => x.toFixed(1)).join(', ')}\ntarget ${c.target.map(x => x.toFixed(1)).join(', ')}`; }
    else vt.textContent = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    return;
  }
  vt.hidden = true;
  const base = v || _vB, W = base.w, H = base.h, VV = ui.vview;
  if (VV.fit) { VV.zoom = Math.min((sw - 24) / W, (sh - 24) / H); VV.ox = (sw - W * VV.zoom) / 2; VV.oy = (sh - H * VV.zoom) / 2; }
  const drawOne = (x, clipL, clipR) => {
    if (!x) return; g.save(); g.beginPath(); g.rect(clipL, 0, clipR - clipL, sh); g.clip();
    g.imageSmoothingEnabled = VV.zoom < 2; g.imageSmoothingQuality = 'high';
    if (x.kind === 'points') drawPointsOverlay(g, x, VV); else g.drawImage(cachedCanvas(x, ui.alpha && x.kind === 'image'), VV.ox, VV.oy, x.w * VV.zoom, x.h * VV.zoom);
    g.restore();
  };
  if (ui.wipe) { const wx = ui.wipeX * sw; drawOne(_vA, 0, wx); drawOne(_vB, wx, sw); wipeEl.style.left = (wx - 1) + 'px'; }
  else drawOne(v, 0, sw);
  g.strokeStyle = 'rgba(128,128,128,.5)'; g.lineWidth = 1; g.strokeRect(VV.ox - 0.5, VV.oy - 0.5, W * VV.zoom + 1, H * VV.zoom + 1);
  const full = Math.round(W / (ui.fullRes ? 1 : doc.settings.preview) ) ;
  sizeEl.textContent = `${W}×${H}px${ui.fullRes ? '' : ` preview of ${(ui._vFull || outSize()).join('×')}`} · ${doc.settings.dpi} dpi · ${(VV.zoom * 100).toFixed(0)}%`;
  void full;
}
function drawPointsOverlay(g, P, VV) {
  g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(VV.ox, VV.oy, P.w * VV.zoom, P.h * VV.zoom);
  g.font = '600 11px Figtree, sans-serif';
  for (const p of P.pts) {
    const x = VV.ox + p.x * VV.zoom, y = VV.oy + p.y * VV.zoom;
    g.fillStyle = p.visible ? '#dd6f2e' : 'rgba(120,120,130,.6)'; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    if (p.dir) { g.strokeStyle = g.fillStyle; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); const L = Math.hypot(p.dir[0], p.dir[1]) || 1; g.lineTo(x + p.dir[0] / L * 18, y + p.dir[1] / L * 18); g.stroke(); }
    g.fillStyle = '#1a1e26'; g.fillText(`${p.id}${p.visible ? '' : ' (hidden)'}`, x + 8, y - 6);
  }
}
function viewerPixel(e) {
  const r = vstage.getBoundingClientRect(), VV = ui.vview, v = _vA; if (!v || !v.w) return null;
  return { x: (e.clientX - r.left - VV.ox) / VV.zoom, y: (e.clientY - r.top - VV.oy) / VV.zoom, v };
}
vstage.addEventListener('pointermove', e => {
  if (ui._vdrag) { const d = ui._vdrag; if (d.wipe) { const r = vstage.getBoundingClientRect(); ui.wipeX = clamp((e.clientX - r.left) / r.width, 0.02, 0.98); drawViewer(); return; } ui.vview.ox = d.ox + e.clientX - d.x; ui.vview.oy = d.oy + e.clientY - d.y; ui.vview.fit = false; drawViewer(); return; }
  const p = viewerPixel(e), el = $('#vPix'); if (!p || !p.v.d) { el.textContent = ''; return; }
  const s = IMG.sample(p.v, p.x, p.y); if (!s) { el.textContent = ''; return; }
  const scale = ui.fullRes ? 1 : doc.settings.preview;
  if (s.length === 1) el.innerHTML = `x ${Math.floor(p.x / scale)} y ${Math.floor(p.y / scale)} · mask ${s[0].toFixed(3)}`;
  else { const a = s[3], c = a > 0 ? [s[0] / a, s[1] / a, s[2] / a] : [0, 0, 0]; el.innerHTML = `x ${Math.floor(p.x / scale)} y ${Math.floor(p.y / scale)} · <span class="sw" style="background:${colourCss([...c, a])}"></span> ${c.map(x => Math.round(x * 255)).join(' ')} α ${a.toFixed(2)}`; }
});
vstage.addEventListener('pointerdown', async e => {
  vstage.setPointerCapture(e.pointerId);
  if (ui.wipe && Math.abs(e.clientX - $('#vwipe').getBoundingClientRect().left) < 12) { ui._vdrag = { wipe: true }; return; }
  const sel = [...ui.sel].map(id => currentGraph().nodes[id]).find(n => n && n.type === 'colourSelect');
  if (sel && e.button === 0 && !e.altKey) { await pickObject(sel, e); return; }
  ui._vdrag = { x: e.clientX, y: e.clientY, ox: ui.vview.ox, oy: ui.vview.oy };
});
vstage.addEventListener('pointerup', () => { ui._vdrag = null; });
vstage.addEventListener('wheel', e => {
  e.preventDefault(); const r = vstage.getBoundingClientRect(), VV = ui.vview, mx = e.clientX - r.left, my = e.clientY - r.top;
  const k = Math.exp(-e.deltaY * 0.0015), nz = clamp(VV.zoom * k, 0.02, 32);
  VV.ox = mx - (mx - VV.ox) * nz / VV.zoom; VV.oy = my - (my - VV.oy) * nz / VV.zoom; VV.zoom = nz; VV.fit = false; drawViewer();
}, { passive: false });
async function pickObject(node, e) {
  const g = currentGraph(), s = node.inputs.id; if (!s) return toast('Connect an Object ID output first.', 'error');
  const ctx = viewCtx(g, node.id, { ...previewVars() }), id = await evalPort(g, s.node, s.port, ctx, scopeForView());
  const r = vstage.getBoundingClientRect(), VV = ui.vview; if (!id || !id.idMap || !_vA) return;
  const x = (e.clientX - r.left - VV.ox) / VV.zoom * id.w / _vA.w, y = (e.clientY - r.top - VV.oy) / VV.zoom * id.h / _vA.h, px_ = IMG.sample(id, x, y);
  if (!px_ || px_[3] < 0.5) return toast('Nothing there. Click an object.');
  const k = (Math.round(px_[0] * 255) << 16) | (Math.round(px_[1] * 255) << 8) | Math.round(px_[2] * 255), hit = id.idMap.map.get(k);
  if (!hit) return toast('That colour is not in the object map.');
  const name = hit.ids.length === 1 ? hit.ids[0] : hit.key;
  const names = String(node.args.names || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean);
  mutate(() => { node.args.names = names.includes(name) ? names.filter(x => x !== name).join('\n') : [...names, name].join('\n'); });
  toast(names.includes(name) ? `Removed ${name}` : `Added ${name}`);
}
new ResizeObserver(() => drawViewer()).observe(vstage);
function renderSlots() {
  for (const b of $$('.slot')) {
    const i = +b.dataset.slot, t = i ? viewerTarget(i) : null;
    b.classList.toggle('on', ui.slot === i); b.classList.toggle('filled', !!t || i === 0);
    b.textContent = i === 0 ? 'Sel' : t ? `${i} ${t.g.nodes[t.id].name || T(t.g.nodes[t.id].type).label}` : String(i);
  }
  $('#vWipeBtn').classList.toggle('on', ui.wipe); $('#vAlphaBtn').classList.toggle('on', ui.alpha); $('#vFullBtn').classList.toggle('on', ui.fullRes);
}
$$('.slot').forEach(b => b.addEventListener('click', () => { ui.slot = +b.dataset.slot; ui.vview.fit = true; renderSlots(); updateViewer(); }));
$('#vWipeBtn').onclick = () => { ui.wipe = !ui.wipe; renderSlots(); updateViewer(); };
$('#vAlphaBtn').onclick = () => { ui.alpha = !ui.alpha; renderSlots(); drawViewer(); };
$('#vFullBtn').onclick = () => { ui.fullRes = !ui.fullRes; renderSlots(); toast(ui.fullRes ? 'Viewer renders at full resolution.' : 'Viewer back to preview resolution.'); updateViewer(); };
$('#vFitBtn').onclick = () => { ui.vview.fit = true; drawViewer(); };
// Panels: the viewer and properties can be closed; Tab hides everything but the graph.
const panes = LS.get('dc.panes', { viewer: true, props: true });
function applyPanes() {
  $('#viewer').hidden = !panes.viewer; $('#props').hidden = !panes.props;
  $('#bViewerT').classList.toggle('on', panes.viewer); $('#bPropsT').classList.toggle('on', panes.props);
  const only = document.body.classList.contains('graph-only'); $('#focusHint').hidden = !only; $('#bFocus').classList.toggle('on', only);
  requestAnimationFrame(() => { layoutPorts(); drawWires(); });
}
function togglePane(which, on) {
  if (document.body.classList.contains('graph-only')) document.body.classList.remove('graph-only');
  panes[which] = on == null ? !panes[which] : on; LS.set('dc.panes', panes); applyPanes();
  if (which === 'viewer' && panes.viewer) { ui.vview.fit = true; updateViewer(); }
  if (which === 'props' && panes.props) renderProps();
}
function toggleGraphOnly() {
  hideTabMenu(); closeMenus();
  document.body.classList.toggle('graph-only'); applyPanes();
  if (!document.body.classList.contains('graph-only')) { ui.vview.fit = true; updateViewer(); renderProps(); }
}
$('#vCloseBtn').onclick = () => togglePane('viewer', false);
$('#bViewerT').onclick = () => togglePane('viewer'); $('#bPropsT').onclick = () => togglePane('props');
$('#bFocus').onclick = toggleGraphOnly; $('#focusHint').onclick = toggleGraphOnly;
applyPanes();
$('#vExportBtn').onclick = () => { const t = viewerTarget(); if (!t) return toast('Select a node to export what it shows.'); exportNode(t.g, t.id, null, ui.exportFormat || 'png', t.scope); };
// Drop from the Nodes tab onto the canvas places the node there.
canvasEl.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('application/x-dc-node') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
canvasEl.addEventListener('drop', e => {
  const files = [...(e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); addImagesToGraph(files, toWorld(e.clientX, e.clientY), { fresh: true }); return; }
  const type = e.dataTransfer.getData('application/x-dc-node'); if (!type) return; e.preventDefault(); const p = toWorld(e.clientX, e.clientY); addNodeAt(type, p.x - 90, p.y - 20, { noAuto: true }); });
// Selecting a node shows it, Nuke-style. Pinned slots stay one click (or 1-4) away; wipe keeps its pins.
function followSelection() {
  if (ui.wipe) return;
  const g = currentGraph(), id = [...ui.sel].find(i => g.nodes[i] && g.nodes[i].type !== 'backdrop');
  if (!id) return;
  ui.slot = 0; ui.vview.fit = true; renderSlots(); updateViewer();
}
function pinSlot(i) {
  const id = [...ui.sel].find(x => currentGraph().nodes[x] && currentGraph().nodes[x].type !== 'backdrop');
  if (id) { ui.pins[i] = { graph: graphKey(currentGraph()), id }; ui.slot = i; toast(`Pinned to slot ${i}`); }
  else ui.slot = i;
  ui.vview.fit = true; renderSlots(); updateViewer();
}
// viewer resize handle
$('#vResize').addEventListener('pointerdown', e => {
  const x0 = e.clientX, w0 = $('#viewer').offsetWidth; e.target.setPointerCapture(e.pointerId);
  const mv = ev => { const w = clamp(w0 + x0 - ev.clientX, 280, window.innerWidth - 420); document.documentElement.style.setProperty('--viewer-w', w + 'px'); };
  const up = () => { e.target.removeEventListener('pointermove', mv); e.target.removeEventListener('pointerup', up); LS.set('dc.viewerW', $('#viewer').offsetWidth); };
  e.target.addEventListener('pointermove', mv); e.target.addEventListener('pointerup', up);
});

// ---------------------------------------------------------------- canvas interaction
let drag = null, spaceDown = false;
canvasEl.addEventListener('pointerdown', e => {
  hideTabMenu(); closeMenus();
  const pin = e.target.closest('.pin'), nodeEl = e.target.closest('.node'), bd = e.target.closest('.backdrop'), wire = e.target.closest('path.hit,path.w');
  const g = currentGraph();
  // Right button: remember what was pressed and leave the event alone; capturing it would
  // retarget the context menu event to the canvas.
  if (e.button === 2) { ui._ctxNode = nodeEl ? nodeEl.dataset.id : null; return; }
  // DOUBLE PRESS, told apart here rather than by the browser's dblclick: the first press selects the
  // node and the graph is redrawn, so the element under the pointer is replaced between the two
  // presses and the browser never fires dblclick (nor click) at all.
  if (e.button === 0 && !pin && !spaceDown && !e.altKey) {
    const now = performance.now(), id = nodeEl ? nodeEl.dataset.id : bd ? null : '', last = ui._lastPress;
    ui._lastPress = { id, t: now, x: e.clientX, y: e.clientY };
    if (last && id !== null && last.id === id && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8) {
      ui._lastPress = null; e.preventDefault();
      if (id) openOnDouble(g.nodes[id]); else showTabMenu(e.clientX, e.clientY);
      return;
    }
  }
  canvasEl.setPointerCapture(e.pointerId);
  if (e.button === 1 || (e.button === 0 && (spaceDown || e.altKey)) || (e.pointerType === 'touch' && !nodeEl && !pin && !bd)) { drag = { type: 'pan', x: e.clientX, y: e.clientY, px: ui.pan.x, py: ui.pan.y }; canvasEl.classList.add('panning'); return; }
  if (e.button === 2) return;
  if (pin) {
    const { node, port, dir, kind } = pin.dataset;
    if (dir === 'in' && g.nodes[node].inputs[port]) {
      const src = g.nodes[node].inputs[port]; beginEdit(); delete g.nodes[node].inputs[port];
      drag = { type: 'wire', from: { node: src.node, port: src.port, dir: 'out', kind: ui.portPos.get(`${src.node}|out|${src.port}`)?.kind || kind }, detached: true };
      renderGraph();
    } else drag = { type: 'wire', from: { node, port, dir, kind } };
    return;
  }
  if (wire) { ui.selWire = { node: wire.dataset.node, port: wire.dataset.port }; ui.sel.clear(); renderGraph(); renderProps(); return; }
  ui.selWire = null;
  if (nodeEl || (bd && (e.target.closest('.bl') || e.target.closest('.rs')))) {
    const id = (nodeEl || bd).dataset.id;
    if (e.target.closest('.pcol.out .port') && !e.target.closest('.pin')) { const port = e.target.closest('.port').dataset.port; ui.viewPort[id] = port; if (!ui.sel.has(id)) { ui.sel.clear(); ui.sel.add(id); } renderGraph(); renderProps(); followSelection(); requestEval(); return; }
    if (e.shiftKey || e.metaKey || e.ctrlKey) { ui.sel.has(id) ? ui.sel.delete(id) : ui.sel.add(id); }
    else if (!ui.sel.has(id)) { ui.sel.clear(); ui.sel.add(id); }
    beginEdit();
    if (bd && e.target.closest('.rs')) { const n = g.nodes[id]; drag = { type: 'resize', id, x: e.clientX, y: e.clientY, w: n.w, h: n.h }; return; }
    const moving = new Set(ui.sel);
    for (const sid of ui.sel) { const s = g.nodes[sid]; if (s && s.type === 'backdrop') for (const n of Object.values(g.nodes)) if (n.type !== 'backdrop' && n.x >= s.x && n.y >= s.y && n.x + 150 <= s.x + s.w && n.y + 60 <= s.y + s.h) moving.add(n.id); }
    drag = { type: 'move', x: e.clientX, y: e.clientY, start: [...moving].map(i => [i, g.nodes[i].x, g.nodes[i].y]), moved: false };
    renderSelectionClasses(); renderProps(); followSelection();
    return;
  }
  // empty canvas: box select
  if (!e.shiftKey) ui.sel.clear();
  const w0 = toWorld(e.clientX, e.clientY);
  drag = { type: 'box', x0: w0.x, y0: w0.y, add: e.shiftKey, base: new Set(ui.sel) };
  renderSelectionClasses(); renderProps(); if (ui.slot === 0) updateViewer();
});
canvasEl.addEventListener('pointermove', e => {
  ui.mouse = { x: e.clientX, y: e.clientY }; ui.mouseWorld = toWorld(e.clientX, e.clientY);
  if (!drag) return;
  const g = currentGraph();
  if (drag.type === 'pan') { ui.pan.x = drag.px + e.clientX - drag.x; ui.pan.y = drag.py + e.clientY - drag.y; applyTransform(); return; }
  if (drag.type === 'move') {
    const dx = (e.clientX - drag.x) / ui.zoom, dy = (e.clientY - drag.y) / ui.zoom; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    for (const [id, x, y] of drag.start) { const n = g.nodes[id]; n.x = Math.round(x + dx); n.y = Math.round(y + dy); const el = nodeEls.get(id) || backdropsEl.querySelector(`[data-id="${id}"]`); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; } }
    layoutPorts(); drawWires(); return;
  }
  if (drag.type === 'resize') { const n = g.nodes[drag.id]; n.w = Math.max(160, Math.round(drag.w + (e.clientX - drag.x) / ui.zoom)); n.h = Math.max(100, Math.round(drag.h + (e.clientY - drag.y) / ui.zoom)); const el = backdropsEl.querySelector(`[data-id="${drag.id}"]`); el.style.width = n.w + 'px'; el.style.height = n.h + 'px'; return; }
  if (drag.type === 'box') {
    const p = toWorld(e.clientX, e.clientY), x = Math.min(drag.x0, p.x), y = Math.min(drag.y0, p.y), w = Math.abs(p.x - drag.x0), hh = Math.abs(p.y - drag.y0);
    let box = $('#selbox'); if (!box) { box = h('div', { id: 'selbox' }); world.append(box); }
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    ui.sel = new Set(drag.base);
    for (const [id, el] of nodeEls) { const n = g.nodes[id]; if (n.x < x + w && n.x + el.offsetWidth > x && n.y < y + hh && n.y + el.offsetHeight > y) ui.sel.add(id); }
    renderSelectionClasses(); return;
  }
  if (drag.type === 'wire') {
    const pos = ui.portPos.get(`${drag.from.node}|${drag.from.dir}|${drag.from.port}`), m = toWorld(e.clientX, e.clientY);
    const over = document.elementFromPoint(e.clientX, e.clientY), pin = over && over.closest && over.closest('.pin');
    let bad = false; if (pin && pin.dataset.dir !== drag.from.dir) bad = !kindsCompatible(drag.from.dir === 'out' ? drag.from.kind : pin.dataset.kind, drag.from.dir === 'out' ? pin.dataset.kind : drag.from.kind);
    $$('.pin.hot').forEach(p => p.classList.remove('hot')); if (pin && !bad && pin.dataset.dir !== drag.from.dir) pin.classList.add('hot');
    if (pos) drawWires(drag.from.dir === 'out' ? { a: pos, b: m, kind: drag.from.kind, bad } : { a: m, b: pos, kind: drag.from.kind, bad });
  }
});
canvasEl.addEventListener('pointerup', e => {
  canvasEl.classList.remove('panning');
  const d = drag; drag = null; if (!d) return;
  const g = currentGraph();
  if (d.type === 'move' || d.type === 'resize') { endEdit(); if (d.type === 'move' && !d.moved) renderGraph(); return; }
  if (d.type === 'box') { const b = $('#selbox'); if (b) b.remove(); renderProps(); if (ui.sel.size) followSelection(); return; }
  if (d.type === 'wire') {
    $$('.pin.hot').forEach(p => p.classList.remove('hot'));
    const over = document.elementFromPoint(e.clientX, e.clientY), pin = over && over.closest && over.closest('.pin');
    if (pin && pin.dataset.dir !== d.from.dir) {
      const out = d.from.dir === 'out' ? d.from : pin.dataset, inp = d.from.dir === 'out' ? pin.dataset : d.from;
      if (!d.detached) beginEdit();
      if (connect(g, out.node, out.port, inp.node, inp.port)) endEdit(); else { endEdit(); renderGraph(); }
    } else if (d.detached) { endEdit(); }
    else if (!pin) { ui.pendingWire = d.from; showTabMenu(e.clientX, e.clientY); drawWires(); }
    else drawWires();
  }
});
// What a double press on a node opens. Double presses are detected in the pointerdown handler.
function openOnDouble(n) {
  if (!n) return;
  if (n.type === 'group') enterGroup(n); else if (n.type === 'viewport') open3D(n); else if (n.type === 'modelSource') ACTIONS.openModeller(n, currentGraph());
}
canvasEl.addEventListener('contextmenu', e => {
  e.preventDefault();
  const nodeEl = e.target.closest('.node'), id = nodeEl ? nodeEl.dataset.id : ui._ctxNode; ui._ctxNode = null;
  const g = currentGraph(), n = id && g.nodes[id]; if (!n || n.type === 'backdrop') { showTabMenu(e.clientX, e.clientY); return; }
  if (!ui.sel.has(n.id)) { ui.sel = new Set([n.id]); renderSelectionClasses(); renderProps(); followSelection(); }
  const items = [];
  if (n.type === 'modelSource') items.push({ label: 'Open parametric modeller', kbd: 'dbl-click', fn: () => ACTIONS.openModeller(n, g) }, { label: 'Load model file…', fn: () => ACTIONS.loadModelInto(n, g) }, { label: 'New empty model', fn: () => ACTIONS.newModelInto(n, g) }, '-');
  if (n.type === 'group') items.push({ label: 'Edit inside', kbd: 'dbl-click', fn: () => enterGroup(n) }, '-');
  if (n.type === 'viewport') items.push({ label: 'Open viewport', kbd: 'dbl-click', fn: () => open3D(n) }, '-');
  if (exportPort(n)) items.push({ label: 'Export PNG (full resolution)', fn: () => exportNode(g, n.id, null, 'png') }, { label: 'Export JPG', fn: () => exportNode(g, n.id, null, 'jpg') }, { label: 'Add Save node', fn: () => addSaveFor(n) }, '-');
  items.push({ label: 'View in slot 1', kbd: '1', fn: () => pinSlot(1) }, { label: n.disabled ? 'Enable' : 'Disable', kbd: 'D', fn: toggleDisable },
    { label: 'Duplicate', kbd: 'Ctrl D', fn: () => { copySelection(false); pasteNodes(ui.clipboard, { x: n.x + 40, y: n.y + 40 }); } }, { label: 'Delete', kbd: 'Del', fn: deleteSelection });
  popMenuAt(e.clientX, e.clientY, items);
});
// Middle button is pan, never the browser's autoscroll.
for (const el of [canvasEl, vstage]) { el.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); }); el.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); }); }
canvasEl.addEventListener('wheel', e => {
  e.preventDefault();
  // The wheel always zooms about the cursor; pan is middle-drag. One hand on the mouse does both.
  const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  const r = canvasEl.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const nz = clamp(ui.zoom * Math.exp(-clamp(dy, -200, 200) * (e.ctrlKey ? 0.01 : 0.0016)), 0.08, 3);
  ui.pan.x = mx - (mx - ui.pan.x) * nz / ui.zoom; ui.pan.y = my - (my - ui.pan.y) * nz / ui.zoom; ui.zoom = nz;
  applyTransform();
}, { passive: false });
function renderSelectionClasses() {
  for (const [id, el] of nodeEls) el.classList.toggle('selected', ui.sel.has(id));
  for (const el of $$('.backdrop', backdropsEl)) el.classList.toggle('selected', ui.sel.has(el.dataset.id));
}
function connect(g, outNode, outPort, inNode, inPort) {
  if (outNode === inNode) { toast('A node cannot feed itself.', 'error'); return false; }
  const ok = resolveKindOut(g, outNode, outPort), ik = (nodeInputs(g.nodes[inNode]).find(p => p.n === inPort) || {}).k;
  const ik2 = ik === 'any' ? null : ik;
  if (!kindsCompatible(ok, ik2)) { toast(`${KIND_LABEL[ok]} cannot connect to a ${KIND_LABEL[ik2]} input.`, 'error'); return false; }
  if (dependsOn(g, outNode, inNode)) { toast('That wire would make a loop.', 'error'); return false; }
  g.nodes[inNode].inputs[inPort] = { node: outNode, port: outPort };
  return true;
}
function dependsOn(g, a, b, seen = new Set()) { // does a depend on b?
  if (a === b) return true; if (seen.has(a)) return false; seen.add(a);
  const n = g.nodes[a]; if (!n) return false;
  return Object.values(n.inputs || {}).some(s => dependsOn(g, s.node, b, seen));
}
function frameNodes(ids) {
  const g = currentGraph(); ids = (ids && ids.length ? ids : Object.keys(g.nodes)).filter(i => g.nodes[i]);
  if (!ids.length) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const id of ids) { const n = g.nodes[id], el = nodeEls.get(id); const w = n.type === 'backdrop' ? n.w : el ? el.offsetWidth : 184, hh = n.type === 'backdrop' ? n.h : el ? el.offsetHeight : 200; x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + hh); }
  const r = canvasEl.getBoundingClientRect(), narrow = window.innerWidth <= 860;
  const shown = id => { const el = $(id); return el.offsetParent !== null && !el.hidden; };
  const left = narrow || !shown('#props') ? 16 : $('#props').offsetWidth + 30, right = narrow || !shown('#viewer') ? 16 : $('#viewer').offsetWidth + 30, top = shown('#topbar') ? $('#topbar').offsetHeight + 30 : 16, bottom = narrow ? 70 : 20;
  const aw = r.width - left - right, ah = r.height - top - bottom;
  ui.zoom = clamp(Math.min(aw / (x1 - x0), ah / (y1 - y0)), 0.15, 1.2);
  ui.pan.x = left + (aw - (x1 - x0) * ui.zoom) / 2 - x0 * ui.zoom; ui.pan.y = top + (ah - (y1 - y0) * ui.zoom) / 2 - y0 * ui.zoom;
  applyTransform(); requestAnimationFrame(() => { layoutPorts(); drawWires(); });
}

// ---------------------------------------------------------------- node creation, delete, copy, group
function createNode(type, x, y, extra = {}) {
  const t = T(type), args = {};
  for (const a of t.args) if (a.d !== undefined && a.d !== null) args[a.n] = deepClone(a.d);
  Object.assign(args, t.defaults ? t.defaults() : {}, extra.args || {});
  const n = { id: uid(), type, name: extra.name || '', x: Math.round(x), y: Math.round(y), args, inputs: {}, promoted: [] };
  if (t.isBackdrop) { n.w = extra.w || 520; n.h = extra.h || 360; }
  return n;
}
function addNodeAt(type, wx, wy, opts = {}) {
  const g = currentGraph(); let n;
  mutate(() => {
    if (opts.standard) n = instantiateStandard(opts.standard, wx, wy);
    else { n = createNode(type, wx, wy); g.nodes[n.id] = n; }
    const ins = nodeInputs(n), outs = nodeOutputs(n);
    if (ui.pendingWire) {
      const pw = ui.pendingWire;
      if (pw.dir === 'out') { const p = ins.find(i => kindsCompatible(pw.kind, i.k)); if (p) connect(g, pw.node, pw.port, n.id, p.n); }
      else { const p = outs.find(o => kindsCompatible(o.k, pw.kind)); if (p) connect(g, n.id, p.n, pw.node, pw.port); }
    } else if (ui.sel.size === 1 && !opts.noAuto) {
      const s = g.nodes[[...ui.sel][0]];
      if (s && s.type !== 'backdrop') { const so = nodeOutputs(s).find(o => ins.some(i => i.k === resolveKindOut(g, s.id, o.n) || i.k === 'any')); if (so) { const ip = ins.find(i => i.k === resolveKindOut(g, s.id, so.n) || i.k === 'any'); connect(g, s.id, so.n, n.id, ip.n); } }
    }
    ui.pendingWire = null; ui.sel = new Set([n.id]);
  });
  followSelection();
  return n;
}
function deleteSelection() {
  const g = currentGraph();
  if (ui.selWire) { mutate(() => { const n = g.nodes[ui.selWire.node]; if (n) delete n.inputs[ui.selWire.port]; }); ui.selWire = null; return; }
  if (!ui.sel.size) return;
  mutate(() => {
    for (const id of ui.sel) delete g.nodes[id];
    for (const n of Object.values(g.nodes)) for (const p in n.inputs) if (ui.sel.has(n.inputs[p].node)) delete n.inputs[p];
  });
  ui.sel.clear();
}
function toggleDisable() { const g = currentGraph(); if (!ui.sel.size) return; mutate(() => { for (const id of ui.sel) { const n = g.nodes[id]; if (n && n.type !== 'backdrop') n.disabled = !n.disabled; } }); }
function copySelection(cut) {
  const g = currentGraph(), ids = [...ui.sel].filter(i => g.nodes[i]); if (!ids.length) return;
  const nodes = ids.map(i => deepClone(g.nodes[i])), defs = {}, assets = {};
  const collect = list => { for (const n of list) { if (n.type === 'group' && doc.defs[n.args.def] && !defs[n.args.def]) { defs[n.args.def] = deepClone(doc.defs[n.args.def]); collect(Object.values(defs[n.args.def].nodes)); } for (const a of [n.args.asset, n.args.result, ...Object.values(n.args.results || {}).map(r => r.asset)]) if (a && doc.assets && doc.assets[a]) assets[a] = doc.assets[a]; } };
  collect(nodes);
  ui.clipboard = { format: 'dc-nodes/1', nodes, defs, assets };
  try { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(ui.clipboard)).catch(() => { }); } catch { }
  toast(`${cut ? 'Cut' : 'Copied'} ${ids.length} node${ids.length > 1 ? 's' : ''}`);
  if (cut) deleteSelection();
}
function pasteNodes(clip, at) {
  if (!clip || clip.format !== 'dc-nodes/1') return;
  const g = currentGraph(), map = {};
  let x0 = Math.min(...clip.nodes.map(n => n.x)), y0 = Math.min(...clip.nodes.map(n => n.y));
  mutate(() => {
    doc.assets = doc.assets || {}; Object.assign(doc.assets, clip.assets || {});
    for (const id in clip.defs || {}) if (!doc.defs[id]) doc.defs[id] = deepClone(clip.defs[id]);
    for (const n of clip.nodes) map[n.id] = uid();
    ui.sel.clear();
    for (const src of clip.nodes) {
      const n = deepClone(src); n.id = map[src.id]; n.x = Math.round(at.x + src.x - x0); n.y = Math.round(at.y + src.y - y0);
      // Inputs between copied nodes go to the copies; inputs from parents that were not copied
      // stay wired to those same parents, so a copy is fed exactly like its original.
      for (const p in n.inputs) { const src = n.inputs[p], m = map[src.node]; if (m) src.node = m; else if (!g.nodes[src.node] || g.nodes[src.node].type === 'backdrop') delete n.inputs[p]; }
      g.nodes[n.id] = n; ui.sel.add(n.id);
    }
  });
}
function groupSelection() {
  const g = currentGraph(), ids = [...ui.sel].filter(i => g.nodes[i] && !['backdrop', 'groupInput', 'groupOutput'].includes(g.nodes[i].type));
  if (!ids.length) return toast('Select nodes to group.');
  const S = new Set(ids);
  mutate(() => {
    const def = { id: uid('d'), name: 'Group', nodes: {} };
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, cy = 0;
    for (const id of ids) { const n = g.nodes[id]; x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + 184); cy += n.y; def.nodes[id] = n; delete g.nodes[id]; }
    cy /= ids.length;
    const gnode = createNode('group', (x0 + x1) / 2 - 92, cy); gnode.name = 'Group'; gnode.args.def = def.id;
    const inMap = new Map(), outMap = new Map(); let ii = 0, oi = 0;
    for (const id of ids) { const n = def.nodes[id];
      for (const p in n.inputs) { const s = n.inputs[p]; if (S.has(s.node)) continue;
        const key = s.node + '|' + s.port; let gi = inMap.get(key);
        if (!gi) { gi = createNode('groupInput', x0 - 240, y0 + ii++ * 120); gi.args.kind = resolveKindOut(g, s.node, s.port) || 'image'; gi.args.name = (g.nodes[s.node] && (g.nodes[s.node].name || T(g.nodes[s.node].type).label)) || 'In'; def.nodes[gi.id] = gi; inMap.set(key, gi); gnode.inputs['i_' + gi.id] = { ...s }; }
        n.inputs[p] = { node: gi.id, port: 'out' }; } }
    for (const n of Object.values(g.nodes)) for (const p in n.inputs) { const s = n.inputs[p]; if (!S.has(s.node)) continue;
      const key = s.node + '|' + s.port; let go = outMap.get(key);
      if (!go) { go = createNode('groupOutput', x1 + 60, y0 + oi++ * 120); go.args.name = (def.nodes[s.node].name || T(def.nodes[s.node].type).label); go.inputs.in = { ...s }; def.nodes[go.id] = go; outMap.set(key, go); }
      n.inputs[p] = { node: gnode.id, port: 'o_' + go.id }; }
    if (!outMap.size) { const last = ids.map(i => def.nodes[i]).sort((a, b) => b.x - a.x)[0], o = nodeOutputs(last)[0]; if (o) { const go = createNode('groupOutput', x1 + 60, y0); go.args.name = 'Out'; go.inputs.in = { node: last.id, port: o.n }; def.nodes[go.id] = go; } }
    doc.defs[def.id] = def; g.nodes[gnode.id] = gnode; ui.sel = new Set([gnode.id]);
    for (let i = 1; i < 5; i++) if (ui.pins[i] && S.has(ui.pins[i].id)) ui.pins[i] = null;
  });
  toast('Grouped. Double-click the group to edit it.');
}
function ungroup(n) {
  const g = currentGraph(), def = doc.defs[n.args.def]; if (!def) return;
  mutate(() => {
    const map = {}, inner = Object.values(def.nodes).filter(x => x.type !== 'groupInput' && x.type !== 'groupOutput');
    for (const x of inner) map[x.id] = uid();
    const resolve = s => { const src = def.nodes[s.node]; if (src && src.type === 'groupInput') return n.inputs['i_' + src.id] ? { ...n.inputs['i_' + src.id] } : null; return map[s.node] ? { node: map[s.node], port: s.port } : null; };
    const gi = Object.values(def.nodes).filter(x => x.type === 'groupInput'); let minx = Math.min(...inner.map(x => x.x));
    for (const x of inner) { const c = deepClone(x); c.id = map[x.id]; c.x = n.x + (x.x - minx); c.y = n.y + (x.y - inner[0].y); for (const p in c.inputs) { const r = resolve(x.inputs[p]); if (r) c.inputs[p] = r; else delete c.inputs[p]; } g.nodes[c.id] = c; }
    for (const o of Object.values(g.nodes)) for (const p in o.inputs) { const s = o.inputs[p]; if (s.node !== n.id) continue; const go = def.nodes[s.port.replace(/^o_/, '')]; const r = go && go.inputs.in ? resolve(go.inputs.in) : null; if (r) o.inputs[p] = r; else delete o.inputs[p]; }
    delete g.nodes[n.id]; ui.sel = new Set(Object.values(map)); void gi;
  });
}
function enterGroup(n) { if (!doc.defs[n.args.def]) return toast('Group definition is missing.', 'error'); view.path.push({ node: n.id, def: n.args.def }); ui.sel.clear(); render(); requestAnimationFrame(() => frameNodes()); requestEval(); }
function exitGroup() { if (!view.path.length) return false; const step = view.path.pop(); ui.sel = new Set([step.node]); render(); requestAnimationFrame(() => frameNodes()); requestEval(); return true; }
function renderCrumbs() {
  const c = $('#crumbs'); c.innerHTML = '';
  c.append(h('a', { onclick: () => { view.path = []; ui.sel.clear(); render(); frameNodes(); requestEval(); } }, doc.name || 'Graph'));
  view.path.forEach((st, i) => { const d = doc.defs[st.def]; c.append(' › ', i === view.path.length - 1 ? h('span', null, d ? d.name : '?') : h('a', { onclick: () => { view.path = view.path.slice(0, i + 1); render(); frameNodes(); requestEval(); } }, d ? d.name : '?')); });
  if (view.path.length) c.append(h('span', { class: 'hint', style: { margin: '0 0 0 6px' } }, '· shared by reference · Esc to leave'));
  $('#graphName').textContent = doc.name || '';
}
function renderRowPicker() {
  const rows = rowsFor(null), wrap = $('#rowpick'), sel = $('#rowSel');
  wrap.hidden = rows.length <= 1; if (rows.length <= 1) return;
  ui.previewRow = clampI(ui.previewRow, 0, rows.length - 1);
  sel.innerHTML = ''; rows.forEach((r, i) => sel.append(h('option', { value: i, selected: i === ui.previewRow }, `${i + 1} · ${Object.values(r).join(' / ')}`)));
}
$('#rowSel').onchange = e => { ui.previewRow = +e.target.value; render(); requestEval(); };

// ---------------------------------------------------------------- standards library (groups saved for reuse)
const libGet = () => LS.get('dc.library', {});
function saveStandard(n) {
  const def = doc.defs[n.args.def]; if (!def) return;
  const lib = libGet(), id = def.libId || uid('s'), assets = {};
  for (const x of Object.values(def.nodes)) if (x.args.asset && doc.assets[x.args.asset]) assets[x.args.asset] = doc.assets[x.args.asset];
  lib[id] = { id, name: def.name, nodes: deepClone(def.nodes), assets, saved: new Date().toISOString() };
  if (!LS.set('dc.library', lib)) return toast('Could not store the standard in this browser.', 'error');
  mutate(() => { def.libId = id; });
  toast(`Saved “${def.name}” to your standards library.`);
}
function instantiateStandard(libId, x, y) {
  const lib = libGet(), s = lib[libId], g = currentGraph();
  let def = Object.values(doc.defs).find(d => d.libId === libId);
  if (!def) { def = { id: uid('d'), name: s.name, libId, nodes: deepClone(s.nodes) }; doc.defs[def.id] = def; doc.assets = { ...(doc.assets || {}), ...(s.assets || {}) }; }
  const n = createNode('group', x, y); n.name = def.name; n.args.def = def.id; g.nodes[n.id] = n; return n;
}

// ---------------------------------------------------------------- Tab menu
let tabState = null;
function menuItems() {
  const inDef = view.path.length > 0, items = [];
  for (const t of Object.values(NODE_TYPES)) { if (!inDef && (t.type === 'groupInput' || t.type === 'groupOutput')) continue; if (t.type === 'group') continue; items.push({ type: t.type, label: t.label, family: t.family, desc: t.desc }); }
  const lib = libGet(); for (const s of Object.values(lib)) items.push({ standard: s.id, label: s.name, family: 'standards', desc: 'Graphic standard' });
  for (const d of Object.values(doc.defs)) if (!d.libId) items.push({ def: d.id, label: d.name, family: 'standards', desc: 'Group in this graph' });
  return items;
}
function showTabMenu(cx, cy) {
  const m = $('#tabmenu'), r = $('#app').getBoundingClientRect();
  m.hidden = false; m.style.left = clamp(cx - r.left, 8, r.width - 310) + 'px'; m.style.top = clamp(cy - r.top, 8, r.height - 430) + 'px';
  tabState = { at: toWorld(cx, cy), idx: 0 };
  $('#tabSearch').value = ''; renderTabList(); $('#tabSearch').focus();
}
function hideTabMenu() { $('#tabmenu').hidden = true; tabState = null; }
function renderTabList() {
  const q = $('#tabSearch').value.trim().toLowerCase(), list = $('#tabList'); list.innerHTML = '';
  let items = menuItems().filter(i => !q || (i.label + ' ' + (i.desc || '') + ' ' + i.family).toLowerCase().includes(q));
  if (ui.pendingWire) { const pw = ui.pendingWire; items = items.filter(i => { if (!i.type) return true; const fake = createNode(i.type, 0, 0); const ports = pw.dir === 'out' ? nodeInputs(fake) : nodeOutputs(fake); return ports.some(p => kindsCompatible(pw.dir === 'out' ? pw.kind : p.k, pw.dir === 'out' ? p.k : pw.kind) && (p.k !== 'any' || true)); }); }
  tabState.items = items; tabState.idx = clampI(tabState.idx, 0, Math.max(0, items.length - 1));
  let fam = null;
  items.forEach((it, i) => {
    if (!q && it.family !== fam) { fam = it.family; list.append(h('div', { class: 'grp' }, (FAMILIES[fam] || { label: 'Standards' }).label)); }
    list.append(h('div', { class: 'it' + (i === tabState.idx ? ' on' : ''), onmousedown: ev => { ev.preventDefault(); pickTab(i); } },
      h('span', { class: 'chip', style: { width: '8px', height: '8px', borderRadius: '2px', background: (FAMILIES[it.family] || { colour: '#8a64dc' }).colour, flex: 'none' } }), it.label, h('span', { class: 'd' }, it.desc || '')));
  });
  if (!items.length) list.append(h('div', { class: 'hint', style: { padding: '8px' } }, 'No matching nodes.'));
  const on = $('.it.on', list); if (on) on.scrollIntoView({ block: 'nearest' });
}
function pickTab(i) {
  const it = tabState.items[i], at = tabState.at; hideTabMenu(); if (!it) return;
  if (it.standard) addNodeAt(null, at.x, at.y, { standard: it.standard });
  else if (it.def) { mutate(() => { const n = createNode('group', at.x, at.y); n.name = doc.defs[it.def].name; n.args.def = it.def; currentGraph().nodes[n.id] = n; ui.sel = new Set([n.id]); }); }
  else addNodeAt(it.type, at.x, at.y);
}
$('#tabSearch').addEventListener('input', () => { tabState.idx = 0; renderTabList(); });
$('#tabSearch').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { tabState.idx++; renderTabList(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { tabState.idx--; renderTabList(); e.preventDefault(); }
  else if (e.key === 'Enter') { pickTab(tabState.idx); e.preventDefault(); }
  else if (e.key === 'Escape' || e.key === 'Tab') { ui.pendingWire = null; hideTabMenu(); drawWires(); e.preventDefault(); }
});
$('#tabSearch').addEventListener('blur', () => setTimeout(() => { if (tabState && document.activeElement !== $('#tabSearch')) { ui.pendingWire = null; hideTabMenu(); drawWires(); } }, 150));

// ---------------------------------------------------------------- keyboard
const typing = () => { const a = document.activeElement; return a && (a.matches('input,textarea,select') || a.isContentEditable); };
document.addEventListener('keydown', e => {
  writer.armed = true;
  if (e.key === ' ' && !typing()) spaceDown = true;
  if (e.key === 'Escape') {
    if (!$('#modal-layer').hidden) { closeModal(); return; }
    if (!$('#tabmenu').hidden) { hideTabMenu(); return; }
    if (closeMenus()) return;
    if (typing()) { document.activeElement.blur(); return; }
    if (exitGroup()) return;
    ui.sel.clear(); ui.selWire = null; render(); updateViewer(); return;
  }
  if (typing() || !$('#modal-layer').hidden) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
  else if (mod && k === 'c') { e.preventDefault(); copySelection(false); }
  else if (mod && k === 'x') { e.preventDefault(); copySelection(true); }
  else if (mod && k === 'v') { /* handled by the paste event so system clipboard text works too */ if (!navigator.clipboard || !window.isSecureContext) { e.preventDefault(); pasteNodes(ui.clipboard, ui.mouseWorld); } }
  else if (mod && k === 'd') { e.preventDefault(); copySelection(false); pasteNodes(ui.clipboard, { x: ui.mouseWorld.x + 30, y: ui.mouseWorld.y + 30 }); }
  else if (mod && k === 'g' && e.shiftKey) { e.preventDefault(); const n = currentGraph().nodes[[...ui.sel][0]]; if (n && n.type === 'group') ungroup(n); }
  else if (mod && k === 'g') { e.preventDefault(); groupSelection(); }
  else if (mod && k === 's') { e.preventDefault(); saveGraphFile(); }
  else if (e.key === 'Tab') { e.preventDefault(); toggleGraphOnly(); }
  else if ((k === 'n' && !mod) || (e.key === 'A' && e.shiftKey && !mod)) { e.preventDefault(); const r = canvasEl.getBoundingClientRect(); const inside = ui.mouse.x > r.left && ui.mouse.y > r.top; showTabMenu(inside ? ui.mouse.x : r.left + r.width / 2, inside ? ui.mouse.y : r.top + r.height / 2); }
  else if (k === 'v' && !mod) togglePane('viewer');
  else if (k === 'p' && !mod) togglePane('props');
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
  else if (k === 'd' && !mod) toggleDisable();
  else if (k === 'f' && !mod) { const vr = $('#viewer').getBoundingClientRect(); if (ui.mouse.x > vr.left && ui.mouse.x < vr.right && ui.mouse.y > vr.top && ui.mouse.y < vr.bottom) { ui.vview.fit = true; drawViewer(); } else frameNodes([...ui.sel]); }
  else if (/^[1-4]$/.test(e.key) && !mod) pinSlot(+e.key);
  else if (e.key === '0' || e.key === '`') { ui.slot = 0; renderSlots(); updateViewer(); }
  else if (e.key === 'Enter') { const n = currentGraph().nodes[[...ui.sel][0]]; if (n && n.type === 'group') enterGroup(n); else if (n && n.type === 'viewport') open3D(n); }
});
document.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });
document.addEventListener('pointerdown', () => { writer.armed = true; }, { capture: true });
document.addEventListener('paste', e => {
  if (typing()) return;
  // An image on the clipboard (a screenshot, a copied picture) becomes an Image Load node.
  const imgs = [...(e.clipboardData && e.clipboardData.items || [])].filter(it => it.kind === 'file' && /^image\//.test(it.type)).map(it => it.getAsFile()).filter(Boolean);
  if (imgs.length) { e.preventDefault(); addImagesToGraph(imgs, ui.mouseWorld); return; }
  const txt = e.clipboardData && e.clipboardData.getData('text');
  let clip = null; try { clip = JSON.parse(txt); } catch { }
  e.preventDefault();
  pasteNodes(clip && clip.format === 'dc-nodes/1' ? clip : ui.clipboard, ui.mouseWorld);
});

// ---------------------------------------------------------------- toolbar, menus
function closeMenus() { const m = $$('.menu'); m.forEach(x => x.remove()); return m.length > 0; }
function popMenuAt(cx, cy, items) {
  closeMenus(); const ar = $('#app').getBoundingClientRect();
  const m = h('div', { class: 'menu pane' });
  for (const it of items) { if (it === '-') { m.append(h('hr')); continue; } m.append(h('button', { onclick: () => { closeMenus(); it.fn(); } }, it.label, it.kbd ? h('kbd', null, it.kbd) : null)); }
  $('#app').append(m);
  m.style.left = clamp(cx - ar.left, 6, ar.width - m.offsetWidth - 6) + 'px'; m.style.top = clamp(cy - ar.top, 6, ar.height - m.offsetHeight - 6) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
}
function popMenu(anchor, items) {
  closeMenus(); const r = anchor.getBoundingClientRect(), ar = $('#app').getBoundingClientRect();
  const m = h('div', { class: 'menu pane', style: { left: (r.left - ar.left) + 'px', top: (r.bottom - ar.top + 6) + 'px' } });
  for (const it of items) { if (it === '-') { m.append(h('hr')); continue; } m.append(h('button', { onclick: () => { closeMenus(); it.fn(); } }, it.label, it.kbd ? h('kbd', null, it.kbd) : null)); }
  $('#app').append(m);
  setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
}
$('#bFile').onclick = e => popMenu(e.currentTarget, [
  { label: 'New graph', fn: () => { mutate(() => { const keepModels = doc.models; doc = newDoc(); doc.models = keepModels; }); view.path = []; ui.sel.clear(); ui.pins = [null, null, null, null, null]; render(); } },
  { label: 'Open graph…', fn: () => $('#fileOpen').click() },
  { label: 'Open image…', fn: () => { ui._imageTarget = null; $('#fileImage').click(); } },
  { label: 'Paste image', kbd: 'Ctrl V', fn: pasteImageFromClipboard },
  { label: 'Save graph', kbd: 'Ctrl S', fn: saveGraphFile },
  { label: 'Copy graph JSON', fn: () => { const t = JSON.stringify(doc, null, 1); navigator.clipboard ? navigator.clipboard.writeText(t).then(() => toast('Graph JSON copied.'), () => toast('Clipboard refused here.', 'error')) : toast('Clipboard unavailable.', 'error'); } },
  { label: 'Load sample graph', fn: () => { mutate(() => { doc = sampleDoc(); }); view.path = []; ui.sel.clear(); setupSampleView(); } },
  '-',
  { label: 'Load model JSON…', fn: () => $('#fileModel').click() },
  { label: 'Model format and help', fn: openHelpModal },
  '-',
  { label: 'Settings (Gemini key, theme)', fn: openSettingsModal },
]);
$('#bAdd').onclick = () => { const r = canvasEl.getBoundingClientRect(); showTabMenu(r.left + r.width / 2 - 150, r.top + 140); };
$('#mAdd').onclick = $('#bAdd').onclick;
$('#bUndo').onclick = doUndo; $('#bRedo').onclick = doRedo;
$('#bMatrix').onclick = openMatrixModal; $('#bFiles').onclick = openFilesModal; $('#bRenderAll').onclick = renderAll; $('#bHelp').onclick = openHelpModal;
$('#tProps').onclick = () => { ui.propsTab = 'props'; renderProps(); }; $('#tLayers').onclick = () => { ui.propsTab = 'layers'; renderProps(); }; $('#tNodes').onclick = () => { ui.propsTab = 'nodes'; renderProps(); };
for (const [b, p] of [['#mProps', '#props'], ['#mViewer', '#viewer']]) $(b).onclick = () => { const on = !$(p).classList.contains('mshow'); $$('#props,#viewer').forEach(x => x.classList.remove('mshow')); if (on) $(p).classList.add('mshow'); drawViewer(); };
function saveGraphFile() { offerDownload((doc.name || 'graph').replace(/[^\w-]+/g, '_') + '.json', JSON.stringify(doc, null, 1)); }
$('#fileOpen').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const j = JSON.parse(await f.text()); if (j.format !== DOC_FORMAT) throw new Error('Not a Diagram Compositor graph (format ' + (j.format || 'missing') + ').');
    mutate(() => { doc = migrateDoc(j); }); view.path = []; ui.sel.clear(); ui.pins = [null, null, null, null, null]; render(); frameNodes(); toast(`Opened ${f.name}`); }
  catch (err) { toast('Could not open: ' + err.message, 'error'); }
};
$('#fileModel').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const txt = await f.text(), j = JSON.parse(txt), target = ui._modelTarget; ui._modelTarget = null;
    if (j.format === 'ocaf-parametric-model') {
      let key = (j.name || f.name.replace(/\.json$/i, '')).replace(/[^\w-]+/g, '_').toLowerCase() || 'model';
      if (doc.models[key] && doc.models[key].kind !== 'ocaf') key += '_ocaf';
      mutate(() => { doc.models[key] = { kind: 'ocaf', name: j.name || f.name, path: f.name, hash: hashStr(txt), json: j }; const n = target && currentGraph().nodes[target]; if (n) n.args.model = key; });
      toast(`Model “${j.name || f.name}” loaded. Building it with the kernel…`); ensureModel(key).catch(e => toast('Model failed to build: ' + e.message, 'error'));
      return;
    }
    if (!Array.isArray(j.elements) || !Array.isArray(j.cameras)) throw new Error('Expected an ocaf-parametric-model, or "elements" and "cameras" arrays (format diagram-model/1).');
    const key = (j.name || f.name.replace(/\.json$/i, '')).replace(/[^\w-]+/g, '_').toLowerCase();
    mutate(() => { doc.models[key] = { kind: 'json', name: j.name || f.name, path: f.name, hash: hashStr(txt), json: j }; const n = target && currentGraph().nodes[target]; if (n) n.args.model = key; });
    toast(`Model “${j.name || f.name}” loaded as "${key}". Pick it in a Viewport's Model field.`);
  } catch (err) { toast('Model not loaded: ' + err.message, 'error'); }
};
$('#fileImage').onchange = async e => {
  const fs = [...e.target.files]; const target = ui._imageTarget; ui._imageTarget = null; e.target.value = ''; if (!fs.length) return;
  if (!target) return addImagesToGraph(fs, viewCentreWorld(), { fresh: true });
  const f = fs[0], url = await readDataUrl(f);
  mutate(() => { const n = currentGraph().nodes[target]; if (!n) return; const id = addAsset(url, f.name); n.args.asset = id; if (!n.name) n.name = f.name.replace(/\.\w+$/, ''); });
};
const readDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
function viewCentreWorld() { const r = canvasEl.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }
// Images into the graph. The picture is stored in the graph's assets, so it travels with Save graph
// (the JSON file) and with copy/paste between graphs. With one Image Load node selected (and not a
// drop or an Open), the first image replaces that node's picture instead of adding a node.
async function addImagesToGraph(files, at, opts = {}) {
  const g = currentGraph(), sel = [...ui.sel].map(id => g.nodes[id]).filter(Boolean);
  const urls = []; for (const f of files) { try { urls.push([await readDataUrl(f), f.name && f.name !== 'image.png' ? f.name : 'pasted-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.' + ((f.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')]); } catch { } }
  if (!urls.length) return toast('Could not read that image.', 'error');
  const target = !opts.fresh && sel.length === 1 && sel[0].type === 'imageLoad' ? sel[0] : null;
  const made = [];
  mutate(() => {
    urls.forEach(([url, name], i) => {
      const id = addAsset(url, name);
      if (i === 0 && target) { target.args.asset = id; return; }
      const p = at || viewCentreWorld(), n = createNode('imageLoad', Math.round(p.x - 90 + i * 30), Math.round(p.y - 40 + i * 30));
      n.args.asset = id; n.name = name.replace(/\.\w+$/, ''); g.nodes[n.id] = n; made.push(n.id);
    });
    if (made.length) ui.sel = new Set(made);
  });
  toast(target && !made.length ? `Image replaced in “${target.name || 'Image Load'}”. It is saved in the graph file.` : `${made.length} image${made.length === 1 ? '' : 's'} added as Image Load node${made.length === 1 ? '' : 's'}. Saved in the graph file.`);
}
async function pasteImageFromClipboard() {
  try {
    const items = await navigator.clipboard.read(), blobs = [];
    for (const it of items) { const t = it.types.find(x => /^image\//.test(x)); if (t) blobs.push(new File([await it.getType(t)], 'image.' + t.split('/')[1], { type: t })); }
    if (!blobs.length) return toast('No image on the clipboard. Copy a picture or take a screenshot first.', 'error');
    addImagesToGraph(blobs, ui.mouseWorld || viewCentreWorld());
  } catch { toast('The browser would not hand over the clipboard here: press Ctrl V (⌘ V on a Mac) over the graph instead.', 'error'); }
}
function migrateDoc(j) {
  const d = newDoc();
  const out = { ...d, ...j, settings: { ...d.settings, ...(j.settings || {}) }, nodes: j.nodes || {}, defs: j.defs || {}, models: j.models || {}, assets: j.assets || {} };
  if (!out.models.sample) out.models.sample = { kind: 'builtin', name: 'Competition sample', params: {} };
  for (const [k, nm] of [['samplecap', 'Cap'], ['wideflange', 'Wide flange columns']]) if (!out.models[k]) out.models[k] = ocafSampleRef(k, nm);
  for (const g of [out, ...Object.values(out.defs)]) for (const n of Object.values(g.nodes)) { n.inputs = n.inputs || {}; n.args = n.args || {}; n.promoted = n.promoted || []; }
  return out;
}
