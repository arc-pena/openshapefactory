// =====================================================================
// Nano Banana: one Gemini path for the Run button and for batches.
// Results are kept per input: the key is the prompt, seed, model and the recipe of the image
// feeding the node, so each Permutation row (each camera, option...) has its own result and
// Render all can fill in the ones that are missing.
// =====================================================================

// The input recipe at one fixed size, so a row's key is the same in the preview and at full
// resolution: the hash covers which nodes, which arguments, which row - not how many pixels.
function canonCtx(ctx) {
  if (!ctx._canon) { const c = makeCtx({ vars: ctx.vars }); ctx._canon = { ...ctx, w: c.w, h: c.h, scale: c.scale, full: false, _hm: new Map(), _canon: null }; ctx._canon._canon = ctx._canon; }
  return ctx._canon;
}
function nanoInputHash(g, node, pn, ctx, scope) { const s = node.inputs[pn]; return s ? hashNode(g, s.node, canonCtx(ctx), scope) + ':' + s.port : ''; }
function nanoKeyOf(A, imgH, promptH, refH) { return hashStr([A.prompt, A.seed, A.model, imgH, promptH, refH].join('|') + (refH && A.refMode && A.refMode !== 'style' ? '|' + A.refMode : '') + (A.negative ? '|neg:' + A.negative : '')); }
function nanoKeyFor(g, node, A, ctx, scope) { return nanoKeyOf(A, nanoInputHash(g, node, 'image', ctx, scope), nanoInputHash(g, node, 'prompt', ctx, scope), nanoRefPorts(node).map(p => nanoInputHash(g, node, p, ctx, scope)).filter(Boolean).join(',')); }
// A kept result for this key, if its image is still in the graph (an over-full browser save can drop images).
function nanoHit(node, key) { const r = node.args.results && node.args.results[key]; return r && doc.assets && doc.assets[r.asset] ? r : null; }

// One batch (Render all, or a Save's Write now): only the nodes ticked in the picker call Gemini -
// once per input, either always or only where no image was made yet. Unticked nodes cost nothing
// and show the images they already have.
let nanoBatch = null;
function nanoWantsRun(node, A, key, ctx) {
  if (ctx.batchAI) {
    if (!nanoBatch || !nanoBatch.run.has(node.id)) return false;
    return nanoBatch.onlyMissing ? !nanoHit(node, key) : !nanoBatch.done.has(node.id + ':' + key);
  }
  return !!A.auto && !nanoHit(node, key) && !ctx.full;
}
// Nano Banana nodes feeding these jobs, with how many of the files each one feeds. With all, every
// enabled Nano Banana in the graph is listed, including ones no Save is connected to yet.
function nanoNodesFor(jobs, all = false) {
  const found = new Map();
  for (const j of jobs) {
    const seen = new Set(), stack = [[doc, j.node.id]];
    while (stack.length) {
      const [g, id] = stack.pop(), n = g.nodes[id], key = (g === doc ? '' : 'd:') + id; if (!n || seen.has(key)) continue; seen.add(key);
      if (n.type === 'nanoBanana' && !n.disabled) { const f = found.get(n.id) || { node: n, files: 0, paths: [] }; f.files++; f.paths.push(j.path); found.set(n.id, f); }
      if (n.type === 'group' && doc.defs[n.args.def]) for (const inner of Object.values(doc.defs[n.args.def].nodes)) stack.push([doc.defs[n.args.def], inner.id]);
      for (const s of Object.values(n.inputs || {})) if (s && s.node) stack.push([g, s.node]);
    }
  }
  if (all) for (const n of Object.values(doc.nodes)) if (n.type === 'nanoBanana' && !n.disabled && !found.has(n.id)) found.set(n.id, { node: n, files: 0, paths: [] });
  return [...found.values()];
}
// The picker: which nodes run, remembered in the graph (and its saved file) for next time.
function pickNanoForBatch(list) {
  return new Promise(resolve => {
    const pick = doc.settings.nanoPick || {}, boxes = [];
    const only = h('input', { type: 'checkbox', checked: !!doc.settings.nanoOnlyMissing });
    const est = h('p', { class: 'hint', style: { margin: '8px 0 0' } });
    const update = () => { const n = list.reduce((s, it, i) => s + (boxes[i].checked ? Math.max(1, it.files) : 0), 0); est.textContent = n ? `Up to ${n} Gemini call${n === 1 ? '' : 's'}${only.checked ? ' (fewer: images already made are kept)' : ''}. Each call uses your Gemini credits.` : 'No Gemini calls: every Nano Banana node keeps the images it already has.'; };
    const rows = list.map(({ node, files, paths }, i) => {
      const cb = h('input', { type: 'checkbox', checked: !!pick[node.id], onchange: update }); boxes.push(cb);
      const kept = Object.keys(node.args.results || {}).length;
      return h('label', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', borderBottom: '1px solid var(--line)', cursor: 'pointer' } }, cb,
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontWeight: 600 } }, node.name || 'Nano Banana'),
          h('div', { class: 'hint', style: { margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, node.args.prompt ? '“' + String(node.args.prompt).slice(0, 90) + '”' : 'No prompt'),
          h('div', { class: 'hint', style: { margin: '2px 0 0', overflowWrap: 'anywhere' } }, `${files ? `Feeds ${files} file${files === 1 ? '' : 's'}: ${paths.slice(0, 4).join(', ')}${paths.length > 4 ? ` +${paths.length - 4} more` : ''}` : 'No Save connected: makes one image for the preview row'} · ${kept} image${kept === 1 ? '' : 's'} already made`)));
    });
    const finish = ok => {
      ui._onModalClose = null;
      if (ok) { const p = { ...(doc.settings.nanoPick || {}) }; list.forEach(({ node }, i) => { p[node.id] = boxes[i].checked; }); doc.settings.nanoPick = p; doc.settings.nanoOnlyMissing = only.checked; if (doc.settings.autosave !== false) scheduleAutoSave(); }
      closeModal(); resolve(ok ? { run: new Set(list.filter((_, i) => boxes[i].checked).map(it => it.node.id)), onlyMissing: only.checked } : null);
    };
    const all = v => { boxes.forEach(b => { b.checked = v; }); update(); };
    openModal('Which Nano Banana images to make?', [
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'Ticked nodes call Gemini for each file they feed. Unticked nodes keep the images they already made, so they cost nothing. Your choice is remembered and saved with the graph.'),
      h('div', { style: { display: 'flex', gap: '6px', margin: '0 0 8px' } }, h('button', { class: 'btn line small', onclick: () => all(true) }, 'All'), h('button', { class: 'btn line small', onclick: () => all(false) }, 'None')),
      h('div', { style: { maxHeight: '320px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '9px', background: 'var(--pane-solid)' } }, rows),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', cursor: 'pointer' } }, only, h('span', null, 'Only make missing images (keep any already made for the same inputs)')),
      est,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } }, h('button', { class: 'btn primary', id: 'nanoPickGo', onclick: () => finish(true) }, 'Render'), h('button', { class: 'btn line', onclick: () => finish(false) }, 'Cancel')),
    ], { narrow: true });
    only.onchange = update; update();
    ui._onModalClose = () => { ui._onModalClose = null; resolve(null); };
  });
}
// Run jobs as one batch: ask which nodes may call Gemini, then hold that choice for the whole run
// and record any new images as a single undo step. Returns false if the picker was cancelled.
async function withNanoBatch(jobs, fn, all = false) {
  const list = nanoNodesFor(jobs, all);
  const pick = list.length ? await pickNanoForBatch(list) : { run: new Set(), onlyMissing: true };
  if (!pick) return false;
  beginEdit(); nanoBatch = { id: uid('b'), done: new Set(), run: pick.run, onlyMissing: pick.onlyMissing };
  try {
    await fn(pick);
    // Ticked nodes no Save reaches still make their image, for the row in the preview.
    for (const { node, files } of list) if (!files && pick.run.has(node.id)) {
      const ctx = makeCtx({ track: false, ...previewVars() }); ctx.batchAI = true; ctx.rowLog = [];
      try { await evalPort(doc, node.id, 'image', ctx, null); } catch (e) { node._runError = nanoErrorText(e); }
    }
  }
  finally { const made = nanoBatch.done.size; nanoBatch = null; endEdit(); if (made) { docChanged(); toast(`Nano Banana made ${made} image${made === 1 ? '' : 's'} in this batch.`); } }
  return true;
}

const nanoInflight = new Map();
// Gemini needs to be told which picture is which: unlabelled, a diagram and a style reference get
// blended into one. Each image is introduced by a line naming its role, and the request says what to
// keep from each. The diagram's proportion is asked for so the result lines up with it.
const GEMINI_RATIOS = [[1, 1], [2, 3], [3, 2], [3, 4], [4, 3], [4, 5], [5, 4], [9, 16], [16, 9], [21, 9]];
function nearestRatio(w, h) { const r = w / h; let best = GEMINI_RATIOS[0]; for (const q of GEMINI_RATIOS) if (Math.abs(Math.log(q[0] / q[1] / r)) < Math.abs(Math.log(best[0] / best[1] / r))) best = q; return best.join(':'); }
function nanoParts(prompt, negative, b1, refs, refMode) {
  const img = data => ({ inline_data: { mime_type: 'image/png', data } });
  const avoid = negative ? ` Avoid: ${negative}.` : '';
  if (!refs.length) return [...(b1 ? [{ text: 'IMAGE 1 is the image to work on.' }, img(b1)] : []), { text: (prompt || 'Improve this image.') + avoid }];
  const refLabel = (i, n) => n > 1 ? `IMAGE ${i + 2} is style reference ${i + 1} of ${n}.` : 'IMAGE 2 is a style reference only.';
  if (!b1) return [...refs.flatMap((r, i) => [{ text: `IMAGE ${i + 1} is a style reference.` }, img(r)]), { text: (prompt || 'Make a new image in this style.') + avoid }];
  if (refMode === 'free') return [{ text: (prompt || '') + avoid }, img(b1), ...refs.map(img)];
  const n = refs.length, which = n > 1 ? `IMAGES 2 to ${n + 1}` : 'IMAGE 2', look = n > 1 ? 'the style these references share' : 'the visual style of IMAGE 2', their = n > 1 ? 'their' : 'its';
  const keep = 'Keep the composition, framing, viewpoint, geometry and the position of every line and shape of IMAGE 1 exactly; the result must line up with IMAGE 1 if laid over it.';
  const rule = refMode === 'elements'
    ? `Redraw IMAGE 1 in ${look} - colour palette, line quality, textures, lighting and rendering technique. You may add entourage in the manner of ${which} (people, planting, textures), but do not copy ${their} buildings, layout or composition.`
    : `Redraw IMAGE 1 in ${look} only - colour palette, line quality, textures, lighting and rendering technique. Use ${which} purely as style reference${n > 1 ? 's' : ''}: do not copy, merge or add any of ${their} objects, buildings, shapes or layout.`;
  return [{ text: 'IMAGE 1 is the diagram to transform.' }, img(b1), ...refs.flatMap((r, i) => [{ text: refLabel(i, n) }, img(r)]),
    { text: `${rule} ${keep} Output one image.${prompt ? ' Further instructions: ' + prompt : ''}${avoid}` }];
}
function geminiKey() {
  const key = LS.get('dc.geminiKey', '');
  if (!key) { const e = new Error('No Gemini API key. Paste one under Gemini API key in the node\'s properties.'); e.noKey = true; throw e; }
  return key;
}
async function imageB64(img, max = 1024) {
  if (!img) return null; const k = Math.min(1, max / Math.max(img.w, img.h));
  const cv = IMG.toCanvas(k < 1 ? IMG.resample(img, Math.round(img.w * k), Math.round(img.h * k)) : img);
  const buf = new Uint8Array(await (await canvasBlob(cv, 'image/png')).arrayBuffer()); let s = '';
  for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
  return btoa(s);
}
// One request to Gemini. The page's security policy (the claude.ai viewer's, for instance) can refuse
// it before it leaves; the browser reports that as a violation event, which tells it apart from being
// offline. A model without the aspect-ratio option refuses that field, so it is asked again without it.
async function geminiPost(model, parts, gen) {
  const key = geminiKey();
  let r, csp = false; const onCsp = ev => { if (/googleapis/.test(ev.blockedURI || '')) csp = true; };
  document.addEventListener('securitypolicyviolation', onCsp);
  const call = g => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ parts }], ...(g ? { generationConfig: g } : {}) }) });
  try {
    r = await call(gen);
    if (!r.ok && gen && gen.imageConfig) { const t = await r.clone().text(); if (/imageConfig|aspect/i.test(t)) { gen = { ...gen }; delete gen.imageConfig; r = await call(gen); } }
  } catch (err) { await new Promise(res => setTimeout(res, 60)); err.blocked = csp ? 'csp' : 'network'; throw err; }
  finally { setTimeout(() => document.removeEventListener('securitypolicyviolation', onCsp), 200); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `HTTP ${r.status}`);
  return (j.candidates || []).flatMap(c => (c.content && c.content.parts) || []);
}
async function geminiGenerate({ prompt, negative, im, refs = [], model, seed, refMode }) {
  geminiKey();
  const b1 = await imageB64(im), bRefs = []; for (const r of refs) bRefs.push(await imageB64(r));
  const parts = nanoParts(prompt, (negative || '').trim(), b1, bRefs.filter(Boolean), refMode || 'style');
  const gen = { responseModalities: ['IMAGE', 'TEXT'], seed };
  if (im) gen.imageConfig = { aspectRatio: nearestRatio(im.w, im.h) };
  const part = (await geminiPost(model, parts, gen)).find(p => p.inlineData || p.inline_data);
  if (!part) throw new Error('The response had no image (the model may have refused the prompt).');
  const d = part.inlineData || part.inline_data;
  return compactImageUrl(`data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`);
}
// Reverse prompt: Gemini reads an image and writes the prompt an image model would need to get that look.
const REVERSE_FOCUS = {
  style: 'Write a prompt that tells an image model to redraw ANOTHER image in the visual style of this one. Describe only the style: medium and technique, line quality and weight, colour palette (name the colours, with hex values for the main ones), lighting and shadow, shading, texture, level of detail, background treatment and mood. Do not describe the subject, objects or layout of this image.',
  styleContent: 'Write a prompt that tells an image model to redraw ANOTHER image in the style of this one and with the same kind of content treatment: describe the style (medium, line quality, palette with hex values, lighting, texture, detail) and how people, planting, materials and context are drawn, without asking it to copy this image\'s layout.',
  full: 'Write a detailed prompt that would let an image model recreate this image: subject, composition, viewpoint, materials, lighting, colour palette with hex values, rendering style and mood.',
};
async function geminiDescribe(im, { focus = 'style', extra = '', model = 'gemini-2.5-flash', words = 120 }) {
  geminiKey();
  if (!im) throw new Error('Connect an image to read.');
  const ask = `${REVERSE_FOCUS[focus] || REVERSE_FOCUS.style} Write it as direct instructions in one paragraph, at most ${words} words.${extra ? ' Also: ' + extra : ''} Output only the prompt, with no heading, quotes or commentary.`;
  const parts = await geminiPost(model, [{ inline_data: { mime_type: 'image/png', data: await imageB64(im) } }, { text: ask }], null);
  const text = parts.map(p => p.text || '').join('').trim().replace(/^["“]|["”]$/g, '');
  if (!text) throw new Error('Gemini returned no text for this image.');
  return text;
}
// Gemini sends PNG; WebP at high quality is several times smaller, so more results fit in the
// browser's save of the graph.
async function compactImageUrl(url) {
  try {
    const el = await loadImageEl(url), cv = IMG.canvasOf(el.naturalWidth, el.naturalHeight); cv.getContext('2d').drawImage(el, 0, 0);
    const b = await canvasBlob(cv, 'image/webp', 0.92); if (!b || !/webp/.test(b.type) || b.size * 1.37 >= url.length) return url;
    return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  } catch { return url; }
}
function nanoErrorText(e) {
  return e.blocked === 'csp' ? 'This page is not allowed to call Google here: the claude.ai viewer\'s security policy blocks outside requests. Open the compositor from its own address (GitHub Pages) and it works.'
    : e.blocked ? 'Could not reach Google (offline, or the request was refused before it left).'
    : e.noKey ? e.message
    : 'Gemini: ' + e.message + (/api key|permission|unauthori[sz]ed|API_KEY/i.test(e.message) ? ' Change the key under Gemini API key in this node\'s properties.' : '');
}
const NANO_KEEP = 64;
function storeNanoResult(node, key, url, prompt, seed) {
  const asset = addAsset(url, 'nano-banana-result'), res = node.args.results || (node.args.results = {});
  res[key] = { asset, prompt, seed, at: Date.now() };
  node.args.result = asset; node.args.resultKey = key; node.args.resultPrompt = prompt; node.args.resultSeed = seed;
  // Keep the newest results; an image no node refers to any more leaves the graph with it.
  const keys = Object.keys(res).sort((a, b) => res[b].at - res[a].at);
  for (const k of keys.slice(NANO_KEEP)) { const a = res[k].asset; delete res[k]; if (!assetInUse(a)) delete doc.assets[a]; }
  return asset;
}
function assetInUse(id) {
  const scan = nodes => Object.values(nodes).some(n => n.args && (n.args.asset === id || n.args.result === id || (n.args.results && Object.values(n.args.results).some(r => r.asset === id))));
  return scan(doc.nodes) || Object.values(doc.defs || {}).some(d => scan(d.nodes));
}
// Generate (once per key at a time, however many evaluations ask) and keep the result.
async function nanoGenerateAndKeep(node, key, args) {
  if (nanoInflight.has(key)) return nanoInflight.get(key);
  const p = (async () => {
    const url = await geminiGenerate(args);
    storeNanoResult(node, key, url, args.prompt, args.seed);
    if (nanoBatch) nanoBatch.done.add(node.id + ':' + key); else docChanged();
    delete node._runError;
    return node.args.results[key];
  })();
  nanoInflight.set(key, p);
  try { return await p; } finally { nanoInflight.delete(key); }
}
