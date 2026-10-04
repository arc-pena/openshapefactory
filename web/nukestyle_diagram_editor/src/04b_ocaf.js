// =====================================================================
// ocaf-parametric-model support. The Feature Modeller's own OpenCascade
// kernel (kernel/*.gz, copied byte for byte from the modeller) builds the
// document and tessellates it; the result becomes the same model shape the
// renderer draws: elements in geosets, named points and cameras.
//   GeometricalSet / Body folders  -> geoset paths ("Columns/Column one")
//   Camera features                -> cameras (eye, target, lens, roll, frame, safe)
//   Point features                 -> named points (for Point Project)
// Units: the modeller works in mm; everything here is converted to metres.
// =====================================================================
const KERNEL = { promise: null, k: null, state: 'idle', note: '' };
async function kernelFetch(url, type) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('could not load ' + url + ' (' + r.status + ')');
  const bytes = new Uint8Array(await r.arrayBuffer());
  const headers = type ? { headers: { 'Content-Type': type } } : undefined;
  // Some hosts unpack a .gz on the way; look at the bytes rather than the name.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new Response(bytes, headers);
  if (typeof DecompressionStream !== 'function') throw new Error('this browser cannot unpack the kernel (no DecompressionStream)');
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), headers);
}
function startKernel() {
  if (KERNEL.promise) return KERNEL.promise;
  KERNEL.state = 'starting'; setKernelChip('Starting the modelling kernel…');
  KERNEL.promise = (async () => {
    const [wasm, source] = await Promise.all([
      kernelFetch('kernel/replicad_single.wasm.gz', 'application/wasm').then(r => r.arrayBuffer()),
      kernelFetch('kernel/kernel-worker.js.gz', 'text/javascript').then(r => r.text()),
    ]);
    // A module worker: the bundle keeps emscripten's import.meta.
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' });
    const waiting = new Map(); let next = 1, broken = null;
    worker.onmessage = ev => {
      const { id, ok, value, error, progress, build } = ev.data || {};
      if (progress !== undefined) { setKernelChip('Kernel: ' + progress); return; }
      if (build !== undefined) { if (build.total) setKernelChip(`Building model ${build.done}/${build.total}`); return; }
      const w = waiting.get(id); if (!w) return; waiting.delete(id);
      ok ? w.resolve(value) : w.reject(new Error(error || 'the kernel refused'));
    };
    worker.onerror = ev => { broken = new Error((ev && ev.message) || 'the kernel stopped'); for (const [, w] of waiting) w.reject(broken); waiting.clear(); };
    const call = (name, args, transfer) => new Promise((resolve, reject) => { if (broken) return reject(broken); const id = next++; waiting.set(id, { resolve, reject }); worker.postMessage({ id, call: name, args }, transfer || []); });
    const started = await call('start', [{ wasmBinary: wasm }], [wasm]);
    const k = {}; for (const name of started.calls) k[name] = (...a) => call(name, a);
    KERNEL.k = k; KERNEL.state = 'ready'; setKernelChip('');
    return k;
  })().catch(e => { KERNEL.state = 'failed'; KERNEL.note = e.message; KERNEL.promise = null; setKernelChip(''); throw e; });
  return KERNEL.promise;
}
function setKernelChip(t) { const el = document.getElementById('writeChip'); if (el && t) el.textContent = t; else if (el && !t && /^(Kernel|Starting|Building)/.test(el.textContent)) el.textContent = ''; }

// One document lives in the kernel at a time, so builds queue.
let kernelQueue = Promise.resolve();
const ocafCache = new Map(); // key -> { hash, promise, model, error, ms }
function ocafReady(key) { const ref = doc.models[key], c = ocafCache.get(key); return !!(ref && c && c.hash === ref.hash && c.model); }
function ocafModel(key) { return ocafReady(key) ? ocafCache.get(key).model : null; }
function ensureModel(key) {
  const ref = doc.models[key];
  if (!ref) return Promise.resolve(null);
  if (ref.kind !== 'ocaf') return Promise.resolve(getModel(key));
  let c = ocafCache.get(key);
  if (c && c.hash === ref.hash) return c.promise;
  c = { hash: ref.hash };
  const json = ref.json, name = ref.name || key;
  c.promise = kernelQueue = kernelQueue.catch(() => { }).then(async () => {
    const t0 = performance.now(), k = await startKernel();
    setKernelChip(`Building ${name}…`);
    const r = await k.loadModel(json);
    const m = await k.mesh();
    const model = convertOcaf(json, m, r && r.report, key);
    model._key = key; model._index = indexModel(model);
    c.ms = performance.now() - t0; c.model = model; c.report = r && r.report;
    setKernelChip(''); modelCache.delete(key);
    // Dropdowns and every node downstream pick the new geometry up.
    ui.statusDirty = true; render(); requestEval(); if (doc.settings.autosave !== false) scheduleAutoSave();
    return model;
  }).catch(e => { c.error = e.message; setKernelChip(''); render(); throw e; });
  ocafCache.set(key, c);
  return c.promise;
}

const OCAF_FRAMES = { '16:9': 16 / 9, '3:2': 3 / 2, '4:3': 4 / 3, '1:1': 1, '2:1': 2, '9:16': 9 / 16, '9:16 upright': 9 / 16, 'a4': 297 / 210, 'A4 landscape': 297 / 210, 'a3': 420 / 297, 'A3 landscape': 420 / 297 };
const OCAF_FRAME_LIST = ['16:9', '3:2', '4:3', '1:1', '2:1', '9:16', 'a4', 'a3'];
const OCAF_SAFE = ['Off', 'Action and title', 'Thirds', 'Both'];
const fovFromLens = mm => Math.atan(12 / Math.max(1e-4, mm)) * 360 / Math.PI; // 24 mm tall full frame, as the modeller
const NOT_GEOMETRY = new Set(['Point', 'Vector', 'Plane', 'Camera', 'AxisSystem', 'Sketch', 'Number', 'Expression', 'GeometricalSet', 'Body']);
function frameRatio(v) {
  if (typeof v === 'number') return OCAF_FRAMES[OCAF_FRAME_LIST[clampI(Math.round(v), 0, OCAF_FRAME_LIST.length - 1)]];
  return OCAF_FRAMES[v] || OCAF_FRAMES[String(v || '').toLowerCase()] || 16 / 9;
}
function safeMode(v) { const s = typeof v === 'number' ? OCAF_SAFE[clampI(v, 0, 3)] : String(v || 'Both'); return { action: /action|both|safe/i.test(s), thirds: /thirds|both/i.test(s) }; }

// Edge polylines as segment pairs; the kernel can return NaN points for degenerate edges of
// imported (STEP) shapes, so segments with any non-finite coordinate are dropped.
function cleanEdges(src, k, f, warn) {
  const out = new Float32Array(src.length - src.length % 6); let n = 0, bad = 0;
  for (let i = 0; i + 5 < src.length; i += 6) {
    let ok = true; for (let j = 0; j < 6; j++) if (!Number.isFinite(src[i + j])) { ok = false; break; }
    if (!ok) { bad++; continue; }
    for (let j = 0; j < 6; j++) out[n++] = src[i + j] * k;
  }
  if (bad) console.info(`${f.name || f.id}: dropped ${bad} degenerate edge segment(s).`);
  return n === out.length ? out : out.slice(0, n);
}
function convertOcaf(json, mesh, report, key) {
  const k = String(json.units || 'mm') === 'm' ? 1 : String(json.units) === 'cm' ? 0.01 : 0.001;
  const feats = json.features || [], byId = new Map(feats.map(f => [f.id, f]));
  const parents = new Set(feats.map(f => f.parent).filter(Boolean));
  const clean = s => String(s || '').replace(/\//g, '-').trim() || '?';
  const pathOf = id => { const out = []; let f = byId.get(id), guard = 0; while (f && guard++ < 64) { out.unshift(clean(f.name || f.id)); f = f.parent ? byId.get(f.parent) : null; } return out.join('/'); };
  const hidden = new Set(json.hidden || []);
  const isHidden = id => { let f = byId.get(id), guard = 0; while (f && guard++ < 64) { if (hidden.has(f.id)) return true; f = f.parent ? byId.get(f.parent) : null; } return false; };
  const meshBy = new Map((mesh && mesh.features || []).map(m => [m.id, m]));
  const elements = [], points = [], vectors = [], cameras = [], warn = [];
  for (const f of feats) {
    const m = meshBy.get(f.id);
    const geoset = f.parent ? pathOf(f.parent) : 'root';
    // Points and vectors are kept whether or not they are shown in the modeller: they are usually
    // hidden scaffolding, and still exactly what decals are placed on and turned by.
    if (f.type === 'Point' && m && m.point) {
      const P = m.points && m.points.length > 3 ? m.points : m.point, n = Math.floor(P.length / 3);
      for (let i = 0; i < n; i++) { const at = [P[i * 3] * k, P[i * 3 + 1] * k, P[i * 3 + 2] * k]; if (at.every(Number.isFinite)) points.push({ id: n > 1 ? f.id + '#' + (i + 1) : f.id, feature: f.id, geoset, at, dir: null, attrs: { name: n > 1 ? `${f.name || f.id} ${i + 1}` : f.name || f.id } }); }
      continue;
    }
    // A vector is drawn as a segment from where it starts along its direction.
    if (f.type === 'Vector' && m && m.edges && m.edges.length >= 6) {
      const E = m.edges, a = [E[0] * k, E[1] * k, E[2] * k], b = [E[3] * k, E[4] * k, E[5] * k], d = sub3(b, a), l = len3(d);
      if (l > 0 && a.every(Number.isFinite) && b.every(Number.isFinite)) vectors.push({ id: f.id, geoset, at: a, dir: scale3(d, 1 / l), len: l, located: /tangent/i.test(String((f.args || {}).kind)) || (f.args || {}).kind === 1, attrs: { name: f.name || f.id } });
      continue;
    }
    if (f.type === 'Camera') {
      const a = f.args || {};
      const at = a.at && a.at.ref && meshBy.get(a.at.ref) && meshBy.get(a.at.ref).point, look = a.look && a.look.ref && meshBy.get(a.look.ref) && meshBy.get(a.look.ref).point;
      const num = (v, d) => typeof v === 'object' && v ? +(v.value ?? d) : (v == null ? d : +v);
      const eye = at || [num(a.x, 6000), num(a.y, -9000), num(a.z, 1700)], tgt = look || [num(a.tx, 0), num(a.ty, 0), num(a.tz, 1700)];
      const lens = num(a.lens, 35);
      cameras.push({ name: f.name || f.id, id: f.id, type: 'persp', eye: eye.map(v => v * k), target: tgt.map(v => v * k), lens, fov: fovFromLens(lens), roll: num(a.roll, 0), frame: frameRatio(a.frame), frameLabel: String(a.frame ?? '16:9'), safe: safeMode(a.safe) });
      continue;
    }
    if (parents.has(f.id) || NOT_GEOMETRY.has(f.type)) continue;
    if (isHidden(f.id) || !m || m.visible === false) continue;
    if (!m.triangles) {
      // Curves and wires: no faces, but real edges - drawn by Hidden line renders.
      if (m.edges && m.edges.length) elements.push({ id: f.id, geoset, shape: 'mesh', mesh: { pos: new Float32Array(0), nrm: null, idx: new Uint32Array(0) }, edges: cleanEdges(m.edges, k, f, warn), attrs: { name: f.name || f.id, type: f.type, curve: true }, _h: f.id + ':' + (m.revision ?? '') + ':c' });
      continue;
    }
    if (m.meshError) warn.push(`${f.name || f.id}: ${m.meshError}`);
    const pos = new Float32Array(m.positions.length); for (let i = 0; i < pos.length; i++) pos[i] = m.positions[i] * k;
    const edges = m.edges ? cleanEdges(m.edges, k, f, warn) : null;
    const ap = f.appearance || {};
    elements.push({ id: f.id, geoset, shape: 'mesh', mesh: { pos, nrm: m.normals, idx: m.index }, edges,
      attrs: { name: f.name || f.id, type: f.type, colour: ap.color ? colourHex([...ap.color, 1]) : null, opacity: ap.opacity == null ? 1 : ap.opacity },
      _h: f.id + ':' + (m.revision ?? '') + ':' + m.triangles });
  }
  {
    // A camera fitted to everything that was built, so geometry far from the model's own cameras
    // (an imported STEP file in site coordinates, say) is always one pick away. Non-finite values
    // are skipped so one bad vertex can't send the view to NaN.
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const grow = (A, i) => { const x = A[i], y = A[i + 1], z = A[i + 2]; if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return; mn[0] = Math.min(mn[0], x); mn[1] = Math.min(mn[1], y); mn[2] = Math.min(mn[2], z); mx[0] = Math.max(mx[0], x); mx[1] = Math.max(mx[1], y); mx[2] = Math.max(mx[2], z); };
    for (const e of elements) { for (let i = 0; i + 2 < e.mesh.pos.length; i += 3) grow(e.mesh.pos, i); if (e.edges) for (let i = 0; i + 2 < e.edges.length; i += 3) grow(e.edges, i); }
    if (mx[0] >= mn[0]) {
      const c = scale3(add3(mn, mx), 0.5), r = Math.max(0.1, len3(sub3(mx, mn)) / 2), fov = fovFromLens(35), d = r / Math.sin(fov * Math.PI / 360) * 1.05;
      cameras.push({ name: cameras.length ? 'Fit all' : 'Default view', id: '__fit', type: 'persp', target: c, eye: add3(c, scale3(norm3([0.55, -0.72, 0.42]), d)), lens: 35, fov, roll: 0, frame: 16 / 9, frameLabel: '16:9', safe: { action: true, thirds: false }, generated: true });
    }
  }
  const sets = feats.filter(f => parents.has(f.id) || f.type === 'GeometricalSet' || f.type === 'Body').map(f => pathOf(f.id));
  return { format: 'ocaf-parametric-model', name: json.name || key, units: 'm', unitScale: k, options: [], elements, points, vectors, cameras, warn, sets,
    stats: { features: feats.length, built: report ? (report.executed || []).length : null, failed: report ? (report.failed || []) : [], triangles: elements.reduce((s, e) => s + e.mesh.idx.length / 3, 0) } };
}
