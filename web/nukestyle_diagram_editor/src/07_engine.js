// =====================================================================
// Evaluation engine: pull-based dataflow. Every node output is keyed by a
// hash of its type, resolved arguments and its inputs' hashes; the same
// hash returns the cached result with no work. Only what is downstream
// of an edit re-runs.
// =====================================================================
const T = t => NODE_TYPES[t] || NODE_TYPES.dot;
const declOf = (list, node) => typeof list === 'function' ? list(node) : list;
const PROMOTE_KIND = { number: 'number', int: 'number', bool: 'number', string: 'string', text: 'string', path: 'string', select: 'string', colour: 'colour' };
function nodeInputs(node) {
  const t = T(node.type), base = declOf(t.inputs, node) || [];
  const prom = (node.promoted || []).map(name => { const a = t.args.find(x => x.n === name); return a ? { n: '$' + name, k: PROMOTE_KIND[a.t] || 'string', l: a.l, promoted: true } : null; }).filter(Boolean);
  return [...base, ...prom];
}
const nodeOutputs = node => declOf(T(node.type).outputs, node) || [];
function nodeArgs(node) { return T(node.type).args || []; }
function argDefault(a) { return a.d; }

// Resolve an "any" kind by walking upstream (Dot, Group Output, Group Input).
function resolveKindIn(g, id, port) {
  const node = g.nodes[id]; if (!node) return null;
  const src = node.inputs && node.inputs[port]; if (!src) return null;
  return resolveKindOut(g, src.node, src.port);
}
function resolveKindOut(g, id, port, depth = 0) {
  const node = g.nodes[id]; if (!node || depth > 40) return null;
  if (node.type === 'groupInput') return node.args.kind || 'image';
  const o = nodeOutputs(node).find(p => p.n === port); if (!o) return null;
  if (o.k !== 'any') return o.k;
  const ins = nodeInputs(node); if (!ins.length) return null;
  const src = node.inputs[ins[0].n]; return src ? resolveKindOut(g, src.node, src.port, depth + 1) : null;
}
function kindsCompatible(outK, inK) { return !outK || !inK || outK === 'any' || inK === 'any' || outK === inK; }

// Graph-level names usable in expressions (Value nodes) plus numeric row values.
function exprNames(ctx) {
  const names = {};
  for (const n of Object.values(doc.nodes)) if (n.type === 'value' && n.args.name) { try { names[n.args.name] = evalExpr(n.args.value == null ? 0 : n.args.value, {}); } catch { } }
  for (const k in ctx.vars) if (isFinite(+ctx.vars[k])) names[k] = +ctx.vars[k];
  return names;
}
// Resolve arguments: tokens in strings, expressions in numbers. Errors are reported, not thrown.
function resolveArgs(node, ctx, warnings) {
  const out = {}, missing = new Set(), names = ctx._names || (ctx._names = exprNames(ctx));
  for (const a of nodeArgs(node)) {
    if (a.t === 'button') continue;
    let v = node.args[a.n]; if (v === undefined) v = argDefault(a);
    if (a.t === 'number' || a.t === 'int') {
      if (typeof v === 'string') { try { v = evalExpr(v, names); } catch (e) { warnings.push(`${a.l}: ${e.message}`); v = a.d; } }
      v = +v; if (a.t === 'int') v = Math.round(v);
    } else if ((a.t === 'string' || a.t === 'text' || a.t === 'path') && !a.noTokens && typeof v === 'string') v = fillTokens(v, ctx.vars, missing);
    else if (a.t === 'select' && typeof v === 'string' && v.includes('{')) v = fillTokens(v, ctx.vars, missing); // a choice taken from the Permutation row
    else if (a.t === 'bool') v = !!v;
    out[a.n] = v;
  }
  if (missing.size) warnings.push(`No value for ${[...missing].map(k => '{' + k + '}').join(', ')} in this row.`);
  return out;
}

// ---------- hashing ----------
const _assetHash = new Map();
function hashNode(g, id, ctx, scope) {
  const memo = ctx._hm || (ctx._hm = new Map()), key = graphKey(g) + '|' + id + '|' + scopeKey(scope);
  if (memo.has(key)) return memo.get(key);
  memo.set(key, 'cycle');
  const node = g.nodes[id]; let hsh;
  if (!node) hsh = 'missing';
  else if (node.type === 'groupInput') {
    const parent = scope && scope.graph.nodes[scope.groupId], src = parent && parent.inputs['i_' + id];
    hsh = src ? hashNode(scope.graph, src.node, ctx, scope.parent) + ':' + src.port : 'unbound';
  } else {
    const warns = [], parts = { t: node.type, a: resolveArgs(node, ctx, warns), d: !!node.disabled, s: ctx.scale, w: ctx.w, h: ctx.h, i: {} };
    if (node.type === 'layerStack') parts.rows = node.args.rows;
    for (const p of nodeInputs(node)) { const s = node.inputs[p.n]; if (s) parts.i[p.n] = hashNode(g, s.node, ctx, scope) + ':' + s.port; }
    if (node.type === 'group') { const def = doc.defs[node.args.def]; parts.def = def ? hashObj(def.nodes) : 'nodef'; }
    if (node.type === 'viewport') parts.m = viewportModelHash(parts.a);
    if (node.type === 'modelSource') { const r = doc.models[parts.a.model]; parts.m = !r ? 'none' : r.kind === 'ocaf' ? r.hash + (ocafReady(parts.a.model) ? ':ready' : ':pending') : stableJSON(r.params || {}) + stableJSON(r.extraCameras || []) + (r.hash || ''); }
    if (node.type === 'imageLoad') parts.asset = node.args.asset || '';
    if (node.type === 'nanoBanana') {
      // This row's own kept result; a batch that will generate one hashes as pending so it runs.
      const k = nanoKeyFor(g, node, parts.a, ctx, scope), hit = nanoHit(node, k);
      parts.r = [hit ? hit.asset : 'last:' + (node.args.result || ''), nanoWantsRun(node, parts.a, k, ctx) ? 'run:' + (nanoBatch ? nanoBatch.id : 'auto') : '', node._runError ? 'err' : ''];
    }
    hsh = hashObj(parts);
  }
  memo.set(key, hsh);
  return hsh;
}
const scopeKey = s => s ? s.groupId + '<' + scopeKey(s.parent) : '';
// A viewport depends only on the elements it actually draws (isolated + holdouts/ghosts).
function viewportModelHash(a) {
  const m = getModel(a.model); if (!m) return 'nomodel';
  const lp = parseLayerPath(a.path, m), iso = lp.geosets.length ? lp.geosets : ['*'];
  const cam = m.cameras.find(c => c.name === (a.camera || lp.camera));
  const parts = [stableJSON(cam || null), a.option || ''];
  for (const e of m.elements) { if (optionExcluded(m, a.option, e.geoset)) continue; const inS = matchAny(iso, e.geoset); if (inS || a.others !== 'hide') parts.push((inS ? 'S' : 'O') + e._h); }
  if (a.style === 'objectid' || lp.style === 'objectid' || true) parts.push(m.elements.length); // id maps are content-addressed already
  return hashStr(parts.join('|'));
}

// ---------- cache ----------
const cache = new Map(); let cacheBytes = 0; const CACHE_LIMIT = 700 * 1024 * 1024;
const valueBytes = v => v && v.d && v.d.byteLength ? v.d.byteLength : 64;
function cachePut(hsh, port, val) {
  let e = cache.get(hsh); if (!e) { e = { outs: {}, bytes: 0 }; cache.set(hsh, e); }
  if (!(port in e.outs)) { const b = valueBytes(val); e.bytes += b; cacheBytes += b; }
  e.outs[port] = val; e.t = performance.now();
  if (cacheBytes > CACHE_LIMIT) {
    const order = [...cache.entries()].sort((a, b) => a[1].t - b[1].t);
    for (const [k, v] of order) { if (cacheBytes <= CACHE_LIMIT * 0.7) break; if (k === hsh) continue; cache.delete(k); cacheBytes -= v.bytes; }
  }
}

// ---------- status (for the visible graph only) ----------
const status = new Map(); // `${graphKey}|${id}` -> {state, msg, ms}
const setStatus = (g, id, s) => { status.set(graphKey(g) + '|' + id, s); ui.statusDirty = true; };
const getStatus = (g, id) => status.get(graphKey(g) + '|' + id);

// ---------- evaluate one output port ----------
const inflight = new Map();
function outMult(m) { const v = +m > 0 ? +m : +doc.settings.mult > 0 ? +doc.settings.mult : 1; return Math.min(16, v); }
function outSize(m, base) { const k = outMult(m), b = base || { w: doc.settings.width, h: doc.settings.height }; return [Math.round(b.w * k), Math.round(b.h * k)]; }
// The resolution an Extract Camera sets for everything downstream of it: the nearest one upstream
// with a width wins. Its height follows the camera's frame, so a 16:9 camera gives 16:9 files.
function cameraRes(g, id) {
  const seen = new Set(), queue = [id];
  while (queue.length) {
    const n = g.nodes[queue.shift()]; if (!n || seen.has(n.id)) continue; seen.add(n.id);
    if (n.type === 'extractCamera') {
      const A = resolveArgs(n, makeCtx(), []), key = upstreamModelKey(g, n), m = key ? getModel(key) : null, s = doc.settings;
      const def = m && (m.cameras.find(c => c.name === A.camera) || m.cameras[0]);
      const lock = A.lock !== false, ratio = def && def.frame || s.width / s.height, w = Math.round(+A.resW > 0 ? +A.resW : s.width);
      const hh = lock ? w / ratio : +A.resH > 0 ? +A.resH : s.height;
      return { w, h: Math.max(8, Math.round(hh)), mult: +A.scale > 0 ? +A.scale : 0, node: n, camera: def ? def.name : A.camera, lock, frameLabel: def && def.frameLabel };
    }
    for (const p of nodeInputs(n)) { const s = n.inputs[p.n]; if (s) queue.push(s.node); }
  }
  return null;
}
// Full-size context for a node's output: camera resolution if one is upstream, then the node's own
// scale, else the camera's, else the graph's Output scale.
function fullCtx(g, id, mult, o = {}) { const r = cameraRes(g, id); return makeCtx({ ...o, full: true, base: r, mult: +mult > 0 ? +mult : r && r.mult }); }
function makeCtx(o = {}) {
  // Width/height are the viewport resolution. Full renders multiply it (like Rhino's capture scale):
  // more pixels, same look, because line weights and radii follow ctx.scale.
  const s = doc.settings, full = !!o.full, scale = full ? outMult(o.mult) : (o.scale || s.preview), b = o.base || { w: s.width, h: s.height };
  const w = Math.max(8, Math.round(b.w * scale)), h = Math.max(8, Math.round(b.h * scale));
  const vars = { project: s.project, date: new Date().toISOString().slice(0, 10), row: String((o.rowIndex || 0) + 1), ...(o.vars || {}) };
  return { w, h, scale, full, vars, track: !!o.track, gen: o.gen };
}
async function evalPort(g, id, port, ctx, scope = null) {
  const node = g.nodes[id]; if (!node) return null;
  if (node.type === 'groupInput') {
    const parent = scope && scope.graph.nodes[scope.groupId], src = parent && parent.inputs['i_' + id];
    if (ctx.track && graphIsViewed(g)) setStatus(g, id, { state: src ? 'ok' : 'warn', msg: src ? '' : 'Not connected on the group node.' });
    return src ? evalPort(scope.graph, src.node, src.port, ctx, scope.parent) : null;
  }
  if (node.type === 'groupOutput') { const s = node.inputs.in; if (ctx.track && graphIsViewed(g)) setStatus(g, id, { state: s ? 'ok' : 'warn', msg: s ? '' : 'Connect what this group should output.' }); return s ? evalPort(g, s.node, s.port, ctx, scope) : null; }
  const hsh = hashNode(g, id, ctx, scope), ent = cache.get(hsh);
  if (ent && port in ent.outs) { ent.t = performance.now(); if (ctx.track && graphIsViewed(g)) { const st = getStatus(g, id); if (!st || st.hash !== hsh) setStatus(g, id, { state: 'cached', msg: ent.msg || '', warn: ent.warn, hash: hsh, ms: ent.ms }); } return ent.outs[port]; }
  const fk = hsh + '#' + port;
  if (inflight.has(fk)) return inflight.get(fk);
  const p = (async () => {
    const track = ctx.track && graphIsViewed(g);
    if (track) { setStatus(g, id, { state: 'rendering', msg: '' }); if (ctx.yield) await ctx.yield(); }
    const warns = [], t0 = performance.now();
    const nctx = { ...ctx, warn: m => warns.push(m), fail: false, _scope: scope };
    let outs = {};
    try {
      const A = resolveArgs(node, nctx, warns);
      const I = name => { const s = node.inputs[name]; return s ? evalPort(g, s.node, s.port, ctx, scope) : Promise.resolve(null); };
      for (const pn of node.promoted || []) { const v = await I('$' + pn); if (v != null) { const a = nodeArgs(node).find(x => x.n === pn); A[pn] = a && (a.t === 'number' || a.t === 'int') ? +v : a && a.t === 'bool' ? !!v : (typeof v === 'string' && !(a && a.noTokens) ? fillTokens(v, ctx.vars) : v); } }
      if (node.disabled) {
        // Disabled: pass the first input of a matching kind straight through.
        for (const o of nodeOutputs(node)) { const inp = nodeInputs(node).find(i => i.k === o.k || i.k === 'any' || o.k === 'any'); outs[o.n] = inp ? await I(inp.n) : null; }
      } else if (node.type === 'group') {
        const def = doc.defs[node.args.def]; if (!def) throw new Error('Group definition is missing.');
        const gid = port.replace(/^o_/, ''), out = def.nodes[gid];
        outs[port] = out && out.inputs.in ? await evalPort(def, out.inputs.in.node, out.inputs.in.port, ctx, { graph: g, groupId: id, parent: scope }) : null;
        if (!out || !out.inputs.in) warns.push('Group output is not connected inside the group.');
      } else {
        outs = (await T(node.type).run(nctx, I, A, node, port, g)) || {};
      }
      const ms = performance.now() - t0;
      for (const k in outs) if (outs[k] != null) cachePut(hsh, k, outs[k]);
      if (!(port in outs)) cachePut(hsh, port, null);
      const e = cache.get(hsh); if (e) { e.warn = warns.slice(); e.ms = ms; e.msg = warns.join(' '); }
      if (track) setStatus(g, id, { state: nctx.fail ? 'error' : warns.length ? 'warn' : 'ok', msg: warns.join(' '), hash: hsh, ms });
      if (ctx.rowLog) for (const w of warns) ctx.rowLog.push(`${node.name || T(node.type).label}: ${w}`);
      if (nctx.fail && ctx.rowLog) ctx.rowFailed = true;
      return outs[port] == null ? null : outs[port];
    } catch (e) {
      console.error(e);
      if (track) setStatus(g, id, { state: 'error', msg: e.message || String(e) });
      if (ctx.rowLog) { ctx.rowLog.push(`${node.name || T(node.type).label}: ${e.message || e}`); ctx.rowFailed = true; }
      return null;
    } finally { inflight.delete(fk); }
  })();
  inflight.set(fk, p);
  return p;
}
function graphIsViewed(g) { return g === currentGraph(); }

// Rows for previews and saves come from a Permutation (if any).
function rowsFor(saveNode) {
  if (saveNode && saveNode.inputs.rows) { const src = doc.nodes[saveNode.inputs.rows.node]; if (src && src.type === 'permutation') return permRows(resolveArgs(src, makeCtx(), [])).rows; }
  if (saveNode) return [{}];
  const p = Object.values(doc.nodes).find(n => n.type === 'permutation');
  return p ? permRows(resolveArgs(p, makeCtx(), [])).rows : [{}];
}
function previewVars() { const rows = rowsFor(null); const i = clampI(ui.previewRow || 0, 0, rows.length - 1); return { vars: rows[i] || {}, rowIndex: i }; }

// ---------- Save: names, files, writing ----------
// Upstream Viewport info fills {camera} {style} {geoset} {option} when the row does not.
function upstreamViewport(g, id, seen = new Set()) {
  const node = g.nodes[id]; if (!node || seen.has(id)) return null; seen.add(id);
  if (node.type === 'viewport') return node;
  for (const p of nodeInputs(node)) { const s = node.inputs[p.n]; if (s) { const r = upstreamViewport(g, s.node, seen); if (r) return r; } }
  return null;
}
// Tokens a Save can use without a Permutation: walk upstream, nearest node first, and take what each
// node picked - the camera of an Extract Camera, the set of an Extract Geoset, a Render's style, the
// model's name - then every other plain field by its own name ({lens}, {opacity}...). Values already
// set (Permutation rows, diagram, version) win, and so does the nearest node.
const TOKEN_SKIP_T = new Set(['rows', 'text', 'button', 'asset', 'code']), TOKEN_SKIP_N = new Set(['def', 'pattern', 'diagram', 'version', 'format', 'folder', 'path']);
function upstreamTokens(g, node, ctx) {
  const vars = {}, put = (k, v) => { if (v == null || v === '' || typeof v === 'object' || k in vars) return; vars[k] = String(v); };
  const seen = new Set([node.id]), queue = [];
  const enqueue = n => { for (const p of nodeInputs(n)) { const s = n.inputs[p.n]; if (s && g.nodes[s.node] && !seen.has(s.node)) { seen.add(s.node); queue.push(g.nodes[s.node]); } } };
  enqueue(node);
  while (queue.length) {
    const up = queue.shift(), A = resolveArgs(up, ctx, []);
    const mkey = up.type === 'modelSource' ? A.model : upstreamModelKey(g, up), m = mkey ? getModel(mkey) : null;
    if (up.type === 'extractCamera') put('camera', m && m.cameras.some(c => c.name === A.camera) ? A.camera : m && m.cameras[0] ? m.cameras[0].name : A.camera);
    else if (up.type === 'extractGeoset') put('geoset', A.geoset ? A.geoset.replace(/\//g, '-') : 'all');
    else if (up.type === 'render') { put('style', A.style); if (!up.inputs.camera && m && m.cameras[0]) put('camera', m.cameras[0].name); }
    else if (up.type === 'modelSource') put('model', doc.models[A.model] ? doc.models[A.model].name || A.model : A.model);
    else if (up.type === 'viewport') {
      const vm = getModel(A.model), lp = parseLayerPath(A.path, vm);
      put('camera', A.camera || lp.camera || 'cam'); put('style', A.style || lp.style || 'shaded');
      put('geoset', (lp.geosets[0] || 'all').replace(/\//g, '-'));
      put('option', (lp.geosets.find(gs => /^option/.test(gs)) || lp.geosets[0] || 'all').split('/')[0]);
    }
    for (const a of nodeArgs(up)) if (!TOKEN_SKIP_T.has(a.t) && !TOKEN_SKIP_N.has(a.n)) put(a.n, A[a.n]);
    enqueue(up);
  }
  return vars;
}
function saveName(node, row, rowIndex) {
  const ctx = makeCtx({ vars: row, rowIndex }), warns = [], A = resolveArgs(node, ctx, warns);
  const vars = { ...ctx.vars, diagram: A.diagram, version: String(A.version) };
  const up = upstreamTokens(doc, node, ctx);
  for (const k in up) if (!(k in vars)) vars[k] = up[k];
  const missing = new Set();
  let name = fillTokens(A.pattern, vars, missing).replace(/[\\:*?"<>|]+/g, '-').replace(/\s+/g, '_');
  return { path: name + '.' + A.format, missing: [...missing], A, tokens: up };
}
// All (save, row) jobs with their resolved paths; duplicates are an error on both nodes.
function saveJobs() {
  const jobs = [];
  for (const n of Object.values(doc.nodes)) if (n.type === 'save') {
    rowsFor(n).forEach((row, i) => { const nm = saveName(n, row, i); jobs.push({ node: n, row, rowIndex: i, ...nm }); });
  }
  const byPath = new Map(); for (const j of jobs) { if (!byPath.has(j.path)) byPath.set(j.path, []); byPath.get(j.path).push(j); }
  for (const [p, list] of byPath) if (list.length > 1) for (const j of list) j.dup = list.filter(x => x !== j).map(x => (x.node.name || 'Save') + (x.row && Object.keys(x.row).length ? ` row ${x.rowIndex + 1}` : ''));
  return jobs;
}

const files = new Map(); // path -> record
const fsState = { dir: null, name: '' };
async function writeJob(job, opts = {}) {
  const n = job.node, A = job.A;
  if (job.dup) return { status: 'error', msg: `Same file name as ${job.dup.join(', ')}.` };
  if (job.missing.length) return { status: 'error', msg: `File name has no value for ${job.missing.map(k => '{' + k + '}').join(', ')}.` };
  const src = n.inputs.image; if (!src) return { status: 'skipped', msg: 'No image connected.' };
  const ctx = fullCtx(doc, n.id, A.scale, { vars: job.row, rowIndex: job.rowIndex }); ctx.rowLog = []; ctx.yield = opts.yield; ctx.batchAI = !!opts.batchAI;
  const hsh = hashNode(doc, src.node, ctx, null) + ':' + src.port;
  const prev = files.get(job.path);
  if (!opts.force && prev && prev.hash === hsh) return { status: 'unchanged' };
  const im = await evalPort(doc, src.node, src.port, ctx, null);
  if (!im || im.kind !== 'image') return { status: 'error', msg: ctx.rowLog.join(' ') || 'Input produced no image.' };
  const blob = await encodeImage(im, A.format, A.quality, provenance(n, job, ctx));
  const rec = { path: job.path, blob, size: blob.size, w: im.w, h: im.h, hash: hsh, nodeId: n.id, nodeName: n.name || 'Save', row: job.row, rowIndex: job.rowIndex,
    writes: (prev ? prev.writes : 0) + 1, at: new Date(), first: prev ? prev.first : new Date(), warn: ctx.rowLog.slice(), url: null };
  if (prev && prev.url) URL.revokeObjectURL(prev.url);
  files.set(job.path, rec);
  let folderMsg = '';
  if (fsState.dir && A.folder) { try { await writeToFolder(job.path, blob); rec.folder = true; } catch (e) { folderMsg = ' Folder write failed: ' + e.message; } }
  ui.filesDirty = true;
  return { status: prev ? 'overwritten' : 'written', msg: (ctx.rowLog.join(' ') + folderMsg).trim(), failed: ctx.rowFailed };
}
function provenance(n, job, ctx) {
  const vp = upstreamViewport(doc, n.id), va = vp ? resolveArgs(vp, ctx, []) : null, m = va ? getModel(va.model) : null;
  const nb = Object.values(doc.nodes).filter(x => x.type === 'nanoBanana' && !x.disabled && x.args.result);
  // Secrets are never part of provenance: no API keys or tokens are stored on the document.
  return { graph: doc.name, node: n.id, file: job.path, row: job.row, model: m ? { name: m.name, hash: hashStr(m.elements.map(e => e._h).join('')) } : null,
    camera: va ? (va.camera || parseLayerPath(va.path, m).camera) : null, style: va ? (va.style || parseLayerPath(va.path, m).style) : null,
    ai: nb.map(x => ({ node: x.id, prompt: x.args.resultPrompt, seed: x.args.resultSeed, model: x.args.model })), written: new Date().toISOString(), tool: 'Diagram Compositor' };
}
async function encodeImage(im, format, quality, meta) {
  const cv = IMG.toCanvas(im);
  if (format === 'jpg') { const g = IMG.canvasOf(im.w, im.h), c = g.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, im.w, im.h); c.drawImage(cv, 0, 0); return canvasBlob(g, 'image/jpeg', quality); }
  if (format === 'webp') return canvasBlob(cv, 'image/webp', quality);
  const blob = await canvasBlob(cv, 'image/png');
  return meta ? pngAddText(blob, { 'Software': 'Diagram Compositor', 'diagram:provenance': JSON.stringify(meta) }) : blob;
}
const canvasBlob = (cv, type, q) => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Encoding failed')), type, q));

// PNG tEXt chunks carry provenance (ASCII; non-ASCII is \u-escaped).
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes, crc = 0xffffffff) { for (let i = 0; i < bytes.length; i++) crc = CRC_T[(crc ^ bytes[i]) & 255] ^ (crc >>> 8); return crc; }
async function pngAddText(blob, kv) {
  const src = new Uint8Array(await blob.arrayBuffer()), chunks = [];
  for (const k in kv) {
    const txt = String(kv[k]).replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    const data = new TextEncoder().encode(k + '\0' + txt), c = new Uint8Array(12 + data.length), dv = new DataView(c.buffer);
    dv.setUint32(0, data.length); c.set([116, 69, 88, 116], 4); c.set(data, 8);
    dv.setUint32(8 + data.length, (crc32(c.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0); chunks.push(c);
  }
  const ihdrEnd = 8 + 25; const parts = [src.subarray(0, ihdrEnd), ...chunks, src.subarray(ihdrEnd)];
  return new Blob(parts, { type: 'image/png' });
}
async function readPngText(blob) {
  const b = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(b.buffer), out = {}; let p = 8;
  while (p < b.length) { const len = dv.getUint32(p), type = String.fromCharCode(...b.subarray(p + 4, p + 8)); if (type === 'tEXt') { const s = new TextDecoder('latin1').decode(b.subarray(p + 8, p + 8 + len)); const z = s.indexOf('\0'); out[s.slice(0, z)] = s.slice(z + 1); } if (type === 'IEND') break; p += 12 + len; }
  return out;
}
// Minimal store-only ZIP for "download all".
async function makeZip(entries) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  for (const e of entries) {
    const data = new Uint8Array(await e.blob.arrayBuffer()), name = enc.encode(e.path), crc = (crc32(data) ^ 0xffffffff) >>> 0;
    const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 0, true); dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, name.length, true); lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
    parts.push(lh, data); central.push(ch); offset += lh.length + data.length;
  }
  const csize = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, csize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
async function writeToFolder(path, blob) {
  let dir = fsState.dir; const segs = path.split('/'); const fname = segs.pop();
  for (const s of segs) if (s) dir = await dir.getDirectoryHandle(s, { create: true });
  const fh = await dir.getFileHandle(fname, { create: true }), w = await fh.createWritable(); await w.write(blob); await w.close();
}
async function connectFolder() {
  if (!window.showDirectoryPicker) return toast('This browser has no folder access. Use Download all, or the served build in Chrome or Edge.', 'error');
  try { fsState.dir = await window.showDirectoryPicker({ mode: 'readwrite' }); fsState.name = fsState.dir.name; toast(`Writing into folder “${fsState.name}”.`); ui.filesDirty = true; renderFilesModal(); scheduleAutoSave(true); }
  catch (e) { if (e.name !== 'AbortError') toast('Folder access was refused here (' + (e.message || e.name) + '). Use Download all, or the served build.', 'error'); }
}
// Downloads go through the viewer's save prompt when available.
let _downloads;
async function offerDownload(filename, data) {
  try { if (_downloads === undefined) _downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch { _downloads = null; }
  if (_downloads) {
    try { await _downloads.save({ filename, data }); toast(`Saved ${filename}`); return true; }
    catch (e) { if (e && e.code === 'declined') return false; toast(`Could not save ${filename}: ${e && e.message || e}`, 'error'); return false; }
  }
  try { const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])); const a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); return true; }
  catch (e) { toast('Downloads are not available in this view.', 'error'); return false; }
}

// ---------- auto-save: write on change, debounced ----------
const writer = { timer: null, gen: 0, running: false, armed: false, last: '' };
function scheduleAutoSave(now) {
  if (!writer.armed && !now) return;
  clearTimeout(writer.timer);
  writer.timer = setTimeout(runAutoSave, now ? 50 : (doc.settings.debounce || 2) * 1000);
}
async function runAutoSave() {
  if (writer.running) { writer.again = true; return; }
  writer.running = true; const gen = ++writer.gen;
  try {
    const jobs = saveJobs().filter(j => j.node.args.auto !== false);
    let done = 0, wrote = 0;
    for (const j of jobs) {
      if (gen !== writer.gen) break;
      setWriteChip(`Checking ${done + 1} of ${jobs.length}…`);
      const r = await writeJob(j, { yield: sleep0 }); done++;
      if (r.status === 'written' || r.status === 'overwritten') { wrote++; setWriteChip(`Wrote ${j.path}`); }
      j.node._lastWrite = r; await sleep0();
    }
    setWriteChip(wrote ? `${wrote} file${wrote > 1 ? 's' : ''} written · ${files.size} in Files` : (files.size ? `${files.size} files up to date` : ''));
    ui.statusDirty = true; ui.filesDirty = true;
  } finally { writer.running = false; if (writer.again) { writer.again = false; scheduleAutoSave(true); } }
}
function setWriteChip(t) { const el = $('#writeChip'); if (el) el.textContent = t; }

async function renderAll() {
  writer.armed = true;
  const jobs = saveJobs();
  await withNanoBatch(jobs, async pick => {
    const body = h('div', null), bar = h('i'), log = h('div', { class: 'hint' });
    openModal('Render all', [h('p', { class: 'empty-note' }, `Writing ${jobs.length} file${jobs.length === 1 ? '' : 's'} at full resolution (${outSize().join(' × ')} px, ${outMult()}× the viewport; Extract Cameras and Save nodes with their own size use it).${pick.run.size ? ` Nano Banana runs for ${pick.run.size} node${pick.run.size === 1 ? '' : 's'}.` : ''}`), h('div', { class: 'progress' }, bar), log, body], { narrow: true });
    const res = { written: 0, overwritten: 0, skipped: 0, error: 0 }, rows = [];
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i]; log.textContent = `${i + 1} / ${jobs.length} · ${j.path}`; await sleep0();
      let r; try { r = await writeJob(j, { force: true, yield: sleep0, batchAI: true }); } catch (e) { r = { status: 'error', msg: e.message }; }
      const st = r.status === 'unchanged' ? 'overwritten' : r.status; res[st] = (res[st] || 0) + 1; j.node._lastWrite = r;
      rows.push(h('tr', null, h('td', { class: 'mono' }, j.path), h('td', null, h('span', { class: 'pill ' + (st === 'error' ? 'error' : st === 'skipped' ? 'stale' : r.failed ? 'warn' : 'ok') }, st)), h('td', { class: 'hint' }, r.msg || '')));
      bar.style.width = ((i + 1) / jobs.length * 100) + '%';
    }
    log.textContent = `Done: ${res.written} new, ${res.overwritten} overwritten, ${res.skipped} skipped, ${res.error} failed.`;
    body.append(h('div', { style: { maxHeight: '320px', overflow: 'auto' } }, h('table', { class: 'grid' }, h('tr', null, h('th', null, 'File'), h('th', null, 'Result'), h('th', null, 'Notes')), rows)),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => { closeModal(); openFilesModal(); } }, 'Open Files'), h('button', { class: 'btn line', onclick: closeModal }, 'Close')));
    ui.filesDirty = true; ui.statusDirty = true; setWriteChip(`${files.size} files in Files`);
  }, true);
}

// ---------- node actions ----------
const ACTIONS = {
  async exportPoints(node) {
    const ctx = makeCtx({ track: false, ...previewVars() }), P = await evalPort(currentGraph(), node.id, 'points', ctx, scopeForView());
    if (!P || !P.pts.length) return toast('No points to export.', 'error');
    const A = resolveArgs(node, ctx, []), full = outSize()[0] / P.w;
    const pts = P.pts.map(p => ({ id: p.id, name: p.attrs && p.attrs.name || '', x: +(p.x * full).toFixed(2), y: +(p.y * full).toFixed(2), depth: +p.depth.toFixed(3), visible: p.visible, x3: p.p3[0], y3: p.p3[1], z3: p.p3[2] }));
    const name = A.filename + '.' + A.format;
    const data = A.format === 'json' ? JSON.stringify({ canvas: [doc.settings.width, doc.settings.height], points: pts }, null, 2)
      : 'id,name,x,y,depth,visible,x3,y3,z3\n' + pts.map(p => [p.id, '"' + p.name.replace(/"/g, '""') + '"', p.x, p.y, p.depth, p.visible, p.x3, p.y3, p.z3].join(',')).join('\n');
    offerDownload(name, data);
  },
  async runReversePrompt(node, g) {
    const { ctx, scope, A } = nanoContext(node, g), s = node.inputs.image;
    if (!s) return toast('Connect an image to the Reverse Prompt node first.', 'error');
    setStatus(g, node.id, { state: 'rendering', msg: 'Gemini is reading the image…' }); ui.statusDirty = true; refreshStatusDom();
    try {
      const im = await evalPort(g, s.node, s.port, ctx, scope);
      const text = await geminiDescribe(im, { focus: A.focus, extra: A.extra, model: A.model, words: A.words });
      delete node._runError;
      mutate(() => { node.args.text = text; node.args.textKey = nanoInputHash(g, node, 'image', ctx, scope); });
      toast('Prompt written. Wire its Prompt output into a Nano Banana.');
    } catch (e) { const msg = nanoErrorText(e); node._runError = msg; setStatus(g, node.id, { state: 'error', msg }); ui.statusDirty = true; render(); }
  },
  async runNanoBanana(node, g) {
    if (!LS.get('dc.geminiKey', '')) { ui.sel = new Set([node.id]); renderProps(); setTimeout(() => { const k = document.getElementById('nb-key'); if (k) k.focus(); }, 50); return toast('Paste your Gemini API key in the node\'s properties first. It stays in this browser only.', 'error'); }
    const { ctx, scope, A } = nanoContext(node, g);
    const I = name => { const s = node.inputs[name]; return s ? evalPort(g, s.node, s.port, ctx, scope) : null; };
    const [im, refs, pin] = await Promise.all([I('image'), Promise.all(nanoRefPorts(node).map(p => I(p))).then(a => a.filter(Boolean)), I('prompt')]);
    const prompt = [pin, A.prompt].map(x => (x == null ? '' : String(x)).trim()).filter(Boolean).join('\n');
    if (!prompt && !(im && refs.length && A.refMode !== 'free')) return toast('Type a prompt first (or connect a Style ref): what should Gemini do with the image?', 'error');
    if (!im) toast('No image connected: Gemini will make one from the prompt alone.');
    setStatus(g, node.id, { state: 'rendering', msg: 'Calling Gemini…' }); ui.statusDirty = true;
    beginEdit();
    try {
      // Run always asks again for the image in view (this preview row), even if one is kept.
      await nanoGenerateAndKeep(node, nanoKeyFor(g, node, A, ctx, scope), { prompt, negative: A.negative, im, refs, model: A.model, seed: A.seed, refMode: A.refMode });
      toast('Gemini result kept with the graph.');
    } catch (e) {
      const msg = nanoErrorText(e); node._runError = msg; setStatus(g, node.id, { state: 'error', msg }); ui.statusDirty = true; render();
    } finally { endEdit(); }
  },
};
function nanoContext(node, g) {
  const ctx = makeCtx({ track: false, ...previewVars() }), scope = scopeForView();
  return { ctx, scope, A: resolveArgs(node, ctx, []) };
}
function addAsset(dataUrl, name) {
  doc.assets = doc.assets || {};
  const id = 'a' + hashStr(dataUrl);
  if (!doc.assets[id]) doc.assets[id] = { name, data: dataUrl };
  return id;
}
