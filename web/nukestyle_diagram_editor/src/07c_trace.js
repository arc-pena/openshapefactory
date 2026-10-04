// =====================================================================
// Path tracing, through the Feature Modeller's own renderer.
// A hidden copy of the modeller (modeller.html, the same file the Model node opens) traces the picture
// with its RenderEngine and rasterises the passes from the same scene and camera, so the compositor
// renders exactly what the modeller renders - materials, environments, bounces - and every pass
// lines up with the traced picture pixel for pixel. Traces are kept by what they were asked for.
// =====================================================================
const PT_ENVIRONMENTS = [['warm', 'Warm'], ['studio', 'Studio'], ['noir', 'Noir']];
const PT_QUALITIES = [['draft', 'Draft · 3 bounces'], ['good', 'Good · 5 bounces'], ['final', 'Final · 10 bounces']];
const PT_PASSES = [['beauty', 'Beauty (path traced)'], ['light', 'Light (clay: light and shadow, no materials)'], ['shadow', 'Shadows on the ground'],
  ['lighting', 'Lighting (beauty ÷ albedo)'], ['depth', 'Depth from the camera'], ['normal', 'Normals'], ['albedo', 'Albedo (unlit colour)'],
  ['objectId', 'Object ID'], ['materialId', 'Material ID'], ['coverage', 'Coverage (alpha)'], ['layer', 'Material layer'], ['layerMask', 'Material mask']];
let ptGeneration = 0; // bumped whenever a trace lands, so nodes showing a placeholder re-evaluate

const tracer = { ready: null, frame: null, loaded: '', queue: Promise.resolve(), pending: new Map() };
function tracerFrame() {
  if (tracer.ready) return tracer.ready;
  tracer.ready = new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.src = 'modeller.html'; f.title = 'Path tracer'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    // Kept in the window (a frame that is not rendered may not get animation frames), but invisible.
    Object.assign(f.style, { position: 'fixed', left: '0', top: '0', width: '8px', height: '8px', opacity: '0', pointerEvents: 'none', border: '0', zIndex: '-1' });
    const timer = setTimeout(() => reject(new Error('the renderer page did not start')), 240000);
    addEventListener('message', e => {
      if (e.source !== f.contentWindow || !e.data || !e.data.dcBridge) return;
      if (e.data.id === undefined && e.data.ready !== undefined) { clearTimeout(timer); e.data.ready ? resolve(f) : reject(new Error(e.data.error || 'the renderer page failed')); return; }
      const p = tracer.pending.get(e.data.id); if (!p) return;
      if (e.data.progress) { if (p.onProgress) p.onProgress(e.data.progress); return; }
      tracer.pending.delete(e.data.id); e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error || 'the renderer failed'));
    });
    document.body.append(f); tracer.frame = f;
  });
  tracer.ready.catch(() => { tracer.ready = null; if (tracer.frame) tracer.frame.remove(); tracer.frame = null; });
  return tracer.ready;
}
function tracerCall(msg, onProgress) {
  return tracerFrame().then(f => new Promise((resolve, reject) => { const id = uid('t'); tracer.pending.set(id, { resolve, reject, onProgress }); f.contentWindow.postMessage({ dcBridge: 1, id, ...msg }, '*'); }));
}

// ---- the kept traces
const ptCache = new Map(); // key -> { status, progress, result, error, promise, decoded }
const PT_KEEP = 8;
function ptTrace(modelKey, params, onProgress) {
  const ref = doc.models[modelKey]; if (!ref || ref.kind !== 'ocaf') return Promise.reject(new Error('Path tracing needs an ocaf parametric model.'));
  const key = hashStr(modelKey + '|' + ref.hash + '|' + stableJSON(params));
  let ent = ptCache.get(key);
  if (ent && ent.status !== 'error') { if (onProgress) ent.listeners.push(onProgress); return ent.promise; }
  ent = { key, status: 'running', progress: 0, decoded: new Map(), listeners: onProgress ? [onProgress] : [], params };
  ptCache.set(key, ent);
  ent.promise = (tracer.queue = tracer.queue.catch(() => { }).then(async () => {
    const model = modelKey + ':' + ref.hash;
    if (tracer.loaded !== model) { await tracerCall({ call: 'load', model: ref.json }); tracer.loaded = model; }
    const r = await tracerCall({ call: 'trace', ...params }, p => { ent.progress = p.done; ent.what = p.what; for (const l of ent.listeners) l(p); });
    ent.result = r; ent.status = 'done'; ptGeneration++;
    // Keep the newest few; a full-size trace with its passes is tens of megabytes once decoded.
    const done = [...ptCache.values()].filter(x => x.status === 'done');
    for (const old of done.slice(0, Math.max(0, done.length - PT_KEEP))) ptCache.delete(old.key);
    ui.statusDirty = true; requestEval();
    return ent;
  })).catch(e => { ent.status = 'error'; ent.error = e.message; ptGeneration++; ui.statusDirty = true; requestEval(); throw e; });
  return ent.promise;
}
function ptPeek(modelKey, params) {
  const ref = doc.models[modelKey]; if (!ref) return null;
  return ptCache.get(hashStr(modelKey + '|' + ref.hash + '|' + stableJSON(params))) || null;
}

// ---- decoding the passes (each decoded once per trace, on demand)
function ptDecoded(ent, name, make) { if (!ent.decoded.has(name)) ent.decoded.set(name, make()); return ent.decoded.get(name); }
async function ptPixels(blob) {
  const bm = await createImageBitmap(blob), c = IMG.canvasOf(bm.width, bm.height), g = c.getContext('2d');
  g.drawImage(bm, 0, 0); if (bm.close) bm.close();
  return { c, w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
}
// A pass rendered at twice the size, box-filtered back down: a mask with soft edges.
function ptHalve(px, w, h) {
  const m = IMG.mask(w, h), sw = px.w, sx = sw / w, sy = px.h / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) { s += px.d[(yy * sw + xx) * 4]; n++; }
    m.d[y * w + x] = n ? s / n / 255 : 0;
  }
  return m;
}
const ptCoverage = ent => ptDecoded(ent, 'coverage', async () => ptHalve(await ptPixels(ent.result.coverage), ent.result.width, ent.result.height));
const ptMaterialMask = (ent, key) => ptDecoded(ent, 'mask:' + key, async () => { const b = ent.result.materialMasks && ent.result.materialMasks[key]; return b ? ptHalve(await ptPixels(b), ent.result.width, ent.result.height) : IMG.mask(ent.result.width, ent.result.height); });
// An opaque pass, with the coverage as its alpha so it sits on nothing outside the model.
const ptOpaque = (ent, name) => ptDecoded(ent, name, async () => {
  const blob = ent.result[name]; if (!blob) return null;
  const im = IMG.fromCanvas((await ptPixels(blob)).c); if (name === 'beauty' || name === 'clay') return im;
  return IMG.setAlpha(im, await ptCoverage(ent));
});
// Straight-line distance from the eye, in metres; Infinity where there is no model.
const ptDepth = (ent, unitScale) => ptDecoded(ent, 'depthM', async () => {
  const px = await ptPixels(ent.result.depth), cov = await ptCoverage(ent), [lo, hi] = ent.result.depthRange, out = new Float32Array(px.w * px.h);
  for (let i = 0; i < out.length; i++) {
    if (cov.d[i] < 0.02) { out[i] = Infinity; continue; }
    const t = px.d[i * 4] / 255 + px.d[i * 4 + 1] / 65025 + px.d[i * 4 + 2] / 16581375;
    out[i] = (lo + t * (hi - lo)) * unitScale;
  }
  return out;
});
// Shadows on the ground, from the clay pass: how much darker each bit of ground is than open ground.
const ptShadow = ent => ptDecoded(ent, 'shadow', async () => {
  const clay = await ptOpaque(ent, 'clay') || await ptOpaque(ent, 'beauty'), cov = await ptCoverage(ent), m = IMG.mask(clay.w, clay.h), lum = new Float32Array(m.d.length), ground = [];
  for (let i = 0; i < lum.length; i++) { lum[i] = 0.2126 * clay.d[i * 4] + 0.7152 * clay.d[i * 4 + 1] + 0.0722 * clay.d[i * 4 + 2]; if (cov.d[i] < 0.01) ground.push(lum[i]); }
  ground.sort((a, b) => a - b); const open = ground.length ? ground[Math.floor(ground.length * 0.95)] : 1;
  for (let i = 0; i < lum.length; i++) m.d[i] = clamp(1 - lum[i] / Math.max(1e-4, open)) * (1 - cov.d[i]);
  return m;
});
// Lighting: the beauty divided by the albedo - how much light each surface received.
const ptLighting = ent => ptDecoded(ent, 'lighting', async () => {
  const b = await ptOpaque(ent, 'beauty'), a = await ptOpaque(ent, 'albedo'), cov = await ptCoverage(ent), out = IMG.image(b.w, b.h);
  for (let p = 0, i = 0; p < cov.d.length; p++, i += 4) {
    const al = a.d[i + 3] > 0 ? 1 / a.d[i + 3] : 0;
    for (let c = 0; c < 3; c++) out.d[i + c] = clamp(b.d[i + c] / Math.max(0.03, a.d[i + c] * al)) * cov.d[p];
    out.d[i + 3] = cov.d[p];
  }
  return out;
});
function ptDepthImage(depth, w, h, opts = {}) {
  let lo = opts.near, hi = opts.far;
  if (!(hi > lo)) { lo = Infinity; hi = -Infinity; for (const d of depth) if (d !== Infinity) { if (d < lo) lo = d; if (d > hi) hi = d; } if (!(hi > lo)) { lo = 0; hi = 1; } }
  const im = IMG.image(w, h);
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] === Infinity) continue;
    let v = clamp((depth[i] - lo) / (hi - lo)); if (!opts.farWhite) v = 1 - v;
    im.d[i * 4] = im.d[i * 4 + 1] = im.d[i * 4 + 2] = v; im.d[i * 4 + 3] = 1;
  }
  return im;
}
// A material's layer: a pass (the beauty by default) cut to where that material shows.
async function ptLayer(ent, key, from = 'beauty') {
  const src = from === 'lighting' ? await ptLighting(ent) : from === 'light' ? (await ptOpaque(ent, 'clay') || await ptOpaque(ent, 'beauty')) : await ptOpaque(ent, from);
  return IMG.setAlpha(src, await ptMaterialMask(ent, key));
}
// What a passes port carries: the trace, and how to read it.
function ptPassesValue(ent, model, w, h) {
  return { kind: 'passes', key: ent.key, w, h, legend: ent.result.legend, unitScale: model.unitScale || 0.001, ent };
}
async function ptPass(pv, pass, o = {}) {
  const ent = pv.ent, W = ent.result.width, H = ent.result.height;
  switch (pass) {
    case 'beauty': return { image: await ptOpaque(ent, 'beauty'), mask: await ptCoverage(ent) };
    case 'light': return { image: await ptOpaque(ent, 'clay') || await ptOpaque(ent, 'beauty'), mask: await ptCoverage(ent) };
    case 'shadow': { const m = await ptShadow(ent); return { image: IMG.maskToImage(m, o.colour || '#000000'), mask: m }; }
    case 'lighting': return { image: await ptLighting(ent), mask: await ptCoverage(ent) };
    case 'depth': { const d = await ptDepth(ent, pv.unitScale); return { image: ptDepthImage(d, W, H, o), mask: await ptCoverage(ent), depth: d }; }
    case 'normal': case 'albedo': case 'objectId': case 'materialId': return { image: await ptOpaque(ent, pass), mask: await ptCoverage(ent) };
    case 'coverage': { const m = await ptCoverage(ent); return { image: IMG.maskToImage(m, '#ffffff'), mask: m }; }
    case 'layer': case 'layerMask': {
      const m = await ptMaterialMask(ent, o.material);
      return pass === 'layerMask' ? { image: IMG.maskToImage(m, '#ffffff'), mask: m } : { image: await ptLayer(ent, o.material, o.from), mask: m };
    }
  }
  return { image: IMG.image(W, H), mask: IMG.mask(W, H) };
}

// ---- the Render node's Path traced style
async function ptRender(ctx, L, A, node, want) {
  const { model, camDef, isolate, w, h, vScale } = L, k = model.unitScale || 0.001, key = model._key;
  if (!key || !doc.models[key] || doc.models[key].kind !== 'ocaf') { ctx.warn('Path tracing needs an ocaf parametric model.'); ctx.fail = true; return { [want]: want === 'mask' || want === 'shadow' ? IMG.mask(w, h) : IMG.image(w, h) }; }
  const cam = buildCamera(camDef, w, h, { vScale });
  const params = { width: w, height: h, samples: ctx.full ? A.ptSamples : A.ptPreview, environment: A.ptEnv, quality: A.ptQuality, exposure: A.ptExposure, ground: !!A.ptGround,
    passes: A.ptClay ? ['clay'] : [], camera: { eye: camDef.eye.map(v => v / k), target: camDef.target.map(v => v / k), fov: cam.fov, roll: camDef.roll || 0 } };
  let ent = ptPeek(key, params);
  const g = currentGraph(), show = p => { if (ctx.track) { setStatus(g, node.id, { state: 'rendering', msg: `Path tracing ${p.what === 'clay' ? 'the light pass ' : p.what === 'passes' ? 'the passes ' : ''}${Math.round(p.done * 100)}%` }); refreshStatusDom(); } };
  if (!ent || ent.status !== 'done') {
    const job = ptTrace(key, params, show);
    if (ctx.full) { try { ent = await job; } catch (e) { ctx.warn('Path tracing failed: ' + e.message); ctx.fail = true; } }
    else {
      job.catch(() => { });
      ent = ptPeek(key, params);
      if (ent && ent.status === 'error') { ctx.warn('Path tracing failed: ' + ent.error); ctx.fail = true; }
      else ctx.warn(`Path tracing at ${w} × ${h}, ${params.samples} samples… showing the shaded render meanwhile.`);
      ent = null;
    }
    if (!ent) { // the shaded render stands in until the trace lands
      if (['image', 'mask', 'shadow', 'id'].includes(want)) return renderLayer(ctx, { model, camDef, isolate, style: 'shaded', w, h, vScale }, { ...A, others: 'holdout', colourBy: 'model', background: 'transparent', _box: L.box }, want);
      return { [want]: want === 'passes' ? null : IMG.image(w, h) };
    }
  }
  node._ptLegend = ent.result.legend;
  const pv = ptPassesValue(ent, model, w, h);
  // Isolating a geoset cuts every pass to that geoset's objects.
  const cut = async im => {
    if (!im || isolate.includes('*')) return im;
    const ids = new Set(model.elements.filter(e => matchAny(isolate, e.geoset)).map(e => e.id)), objs = ent.result.legend.objects.filter(o => ids.has(o.id));
    const px = await ptPixels(ent.result.objectId), cov = await ptCoverage(ent), m = IMG.mask(w, h), cols = new Set(objs.map(o => (o.colour[0] << 16) | (o.colour[1] << 8) | o.colour[2]));
    for (let i = 0; i < m.d.length; i++) if (cols.has((px.d[i * 4] << 16) | (px.d[i * 4 + 1] << 8) | px.d[i * 4 + 2])) m.d[i] = cov.d[i];
    return im.kind === 'mask' ? { ...m, d: m.d.map((v, i) => Math.min(v, im.d[i])) } : IMG.setAlpha(im, m);
  };
  const guides = img => A.guidesOnImage ? IMG.merge(safeGuides(w, h, camDef, { ...A, _box: L.box }, ctx), img, 'normal', 1) : img;
  switch (want) {
    case 'image': {
      let img = await ptOpaque(ent, 'beauty');
      if (!A.ptKeepBack || !isolate.includes('*')) img = await cut(IMG.setAlpha(img, await ptCoverage(ent)));
      return { image: guides(img) };
    }
    case 'mask': return { mask: await cut(await ptCoverage(ent)) };
    case 'shadow': return { shadow: await ptShadow(ent) };
    case 'id': return { id: await cut(await ptOpaque(ent, 'objectId')) };
    case 'depth': return { depth: await cut((await ptPass(pv, 'depth')).image) };
    case 'normal': return { normal: await cut(await ptOpaque(ent, 'normal')) };
    case 'albedo': return { albedo: await cut(await ptOpaque(ent, 'albedo')) };
    case 'light': return { light: await ptOpaque(ent, 'clay') || await ptOpaque(ent, 'beauty') };
    case 'materialId': return { materialId: await cut(await ptOpaque(ent, 'materialId')) };
    case 'passes': return { passes: pv };
  }
  return {};
}
