// =====================================================================
// Node catalogue. Each type declares its ports and arguments as data.
// The properties panel, node ports, saving and undo all read these.
// Arg types: number int string text select bool colour path image rows button
// `px: true` marks a size in full-resolution pixels (scaled for previews).
// =====================================================================
const KINDS = ['model', 'geoset', 'image', 'mask', 'camera', 'string', 'number', 'colour', 'points', 'field', 'perm', 'any'];
const KIND_LABEL = { model: 'Model', geoset: 'Geoset', image: 'Image', mask: 'Mask', camera: 'Camera', string: 'String', number: 'Number', colour: 'Colour', points: 'Points2D', field: 'Field', perm: 'Permutation', any: 'Any' };
const FAMILIES = {
  source: { label: '3D source', colour: '#3554d1' }, image: { label: 'Image operations', colour: '#d99a2b' }, mask: { label: 'Masks', colour: '#8f99a6' },
  gen: { label: 'Generate', colour: '#22a093' }, points: { label: 'Points, decals & gradients', colour: '#dd6f2e' }, ai: { label: 'AI', colour: '#8a64dc' },
  org: { label: 'Organisation', colour: '#6b7280' }, output: { label: 'Output', colour: '#2b9a62' },
};
const BLEND_OPTS = BLEND_MODES.map(m => [m, BLEND_LABEL[m]]);
const A_ = (n, l, t, d, o = {}) => ({ n, l, t, d, ...o });
const px = (v, ctx) => v * ctx.scale;
const blank = ctx => IMG.image(ctx.w, ctx.h);

const NODE_TYPES = {};
function defNode(type, spec) { NODE_TYPES[type] = { type, inputs: [], outputs: [], args: [], ...spec }; }

// ---------------------------------------------------------------- 3D source
defNode('viewport', {
  label: 'Viewport', family: 'source', desc: 'Renders the parametric model from a named camera in one render style. All outputs align to the pixel.',
  outputs: [{ n: 'image', k: 'image', l: 'Image' }, { n: 'mask', k: 'mask', l: 'Mask' }, { n: 'shadow', k: 'mask', l: 'Shadow' }, { n: 'id', k: 'image', l: 'Object ID' }, { n: 'camera', k: 'camera', l: 'Camera' }],
  args: [
    A_('path', 'Layer path', 'path', 'option1 @ camera1 : arctic', { hint: '<code>geoset @ camera : style</code>. Tokens like <code>{option}</code> come from the Permutation row. Short form <code>buildings/camera1/arctic</code> also works.' }),
    A_('model', 'Model', 'select', 'sample', { options: () => Object.keys(doc.models).map(k => [k, doc.models[k].name || k]) }),
    A_('option', 'Design option', 'string', '', { hint: 'Only this option\'s geometry exists in the render; other options are removed, not held out. Blank shows every option.' }),
    A_('camera', 'Camera', 'select', '', { options: (n) => [['', 'From path'], ...cameraNames(n).map(c => [c, c])] }),
    A_('style', 'Render style', 'select', '', { options: [['', 'From path'], ...RENDER_STYLES.map(s => [s, STYLE_LABEL[s]])] }),
    A_('others', 'Other geometry', 'select', 'holdout', { options: [['holdout', 'Holdout (occludes, invisible)'], ['hide', 'Hide'], ['ghost', 'Ghost']], section: 'Isolation' }),
    A_('ghostOpacity', 'Ghost opacity', 'number', 0.25, { min: 0, max: 1, step: 0.01, show: a => a.others === 'ghost' }),
    A_('offsetZ', 'Offset Z', 'number', 0, { unit: 'm', hint: 'Moves the isolated geoset in 3D (true explode in perspective views).' }),
    A_('colour', 'Colour', 'colour', '#d9dce1', { section: 'Look', show: a => !['arctic', 'objectid', 'hiddenline'].includes(viewportStyle(a)) }),
    A_('ambient', 'Ambient', 'number', 0.5, { min: 0, max: 1, step: 0.01, show: a => ['shaded', 'flat', 'shadows'].includes(viewportStyle(a)) }),
    A_('tones', 'Tone steps', 'int', 0, { min: 0, max: 12, show: a => viewportStyle(a) === 'flat', hint: '0 keeps continuous shading.' }),
    A_('lineWeight', 'Line weight', 'number', 2, { min: 0.5, max: 12, step: 0.1, px: true, unit: 'px', show: a => viewportStyle(a) === 'hiddenline' }),
    A_('lineColour', 'Line colour', 'colour', '#1c2026', { show: a => viewportStyle(a) === 'hiddenline' }),
    A_('crease', 'Crease angle', 'number', 30, { min: 1, max: 89, unit: '°', show: a => viewportStyle(a) === 'hiddenline' }),
    A_('hiddenDashed', 'Dashed hidden edges', 'bool', false, { show: a => viewportStyle(a) === 'hiddenline' }),
    A_('hiddenColour', 'Hidden colour', 'colour', '#9aa0aa', { show: a => viewportStyle(a) === 'hiddenline' && a.hiddenDashed }),
    A_('fillFaces', 'Fill faces', 'bool', false, { show: a => viewportStyle(a) === 'hiddenline' }),
    A_('aoRadius', 'AO radius', 'number', 3, { min: 0.5, max: 12, step: 0.1, unit: 'm', show: a => viewportStyle(a) === 'arctic' }),
    A_('aoStrength', 'AO strength', 'number', 0.7, { min: 0, max: 1.5, step: 0.01, show: a => viewportStyle(a) === 'arctic' }),
    A_('arcticSun', 'Soft sun', 'bool', true, { show: a => viewportStyle(a) === 'arctic' }),
    A_('idBy', 'ID by', 'select', 'object', { options: [['object', 'Object'], ['geoset', 'Geoset'], ['type', 'Element type']], hint: 'Applies to the Object ID output.' }),
    A_('sunMode', 'Sun', 'select', 'angles', { options: [['angles', 'Azimuth and altitude'], ['place', 'Location, date and time']], section: 'Sun & shadows' }),
    A_('sunAzimuth', 'Azimuth', 'number', 205, { min: 0, max: 360, unit: '°', show: a => a.sunMode !== 'place' }),
    A_('sunAltitude', 'Altitude', 'number', 38, { min: 1, max: 90, unit: '°', show: a => a.sunMode !== 'place' }),
    A_('latitude', 'Latitude', 'number', 51.5, { min: -66, max: 66, unit: '°', show: a => a.sunMode === 'place' }),
    A_('date', 'Date', 'string', '2026-03-21', { show: a => a.sunMode === 'place' }),
    A_('time', 'Solar time', 'string', '14:00', { show: a => a.sunMode === 'place' }),
    A_('shadowSoft', 'Softness', 'number', 1.2, { min: 0.6, max: 6, step: 0.1 }),
    A_('background', 'Background', 'select', 'transparent', { options: [['transparent', 'Transparent'], ['white', 'White'], ['colour', 'Colour']], section: 'Output' }),
    A_('bgColour', 'Background colour', 'colour', '#f2efe8', { show: a => a.background === 'colour' }),
    A_('resW', 'Width override', 'int', 0, { min: 0, max: 8000, unit: 'px', hint: '0 inherits the graph canvas. Merges resample to their background.' }),
    A_('resH', 'Height override', 'int', 0, { min: 0, max: 8000, unit: 'px' }),
  ],
  async run(ctx, I, A, node, want) {
    const model = getModel(A.model);
    if (!model) throw new Error(`Model "${A.model}" is not loaded.`);
    const lp = parseLayerPath(A.path, model); lp.warn.forEach(w => ctx.warn(w));
    const camName = A.camera || lp.camera, style = A.style || lp.style || 'shaded';
    const w = A.resW > 0 ? Math.max(8, Math.round(A.resW * ctx.scale)) : ctx.w, h = A.resH > 0 ? Math.max(8, Math.round(A.resH * ctx.scale)) : ctx.h;
    const camDef = model.cameras.find(c => c.name === camName);
    if (!camDef) { ctx.warn(`Camera "${camName || '(none)'}" not found. Known: ${model.cameras.map(c => c.name).join(', ')}.`); ctx.fail = true; return { image: IMG.image(w, h), mask: IMG.mask(w, h), shadow: IMG.mask(w, h), id: IMG.image(w, h), camera: null }; }
    const known = model._index.geosets;
    for (const g of lp.geosets) if (!known.some(k => geosetMatch(g, k))) ctx.warn(`Geoset "${g}" is not in the model.`);
    return renderLayer(ctx, { model, camDef, isolate: lp.geosets, option: A.option, style, w, h, name: camName }, A, want);
  },
});
function viewportStyle(a) { if (a.style) return a.style; const p = parseLayerPath(a.path, null); return p.style || 'shaded'; }
// One render path for the Viewport and the Render node: same camera, same passes, aligned outputs.
function renderLayer(ctx, L, A, want) {
  const { model, camDef, style, w, h } = L;
  const opts = { model, camDef, option: L.option, isolate: L.isolate, others: A.others, ghostOpacity: A.ghostOpacity, colour: A.colour, colourBy: A.colourBy, offsetZ: A.offsetZ, style, vScale: L.vScale,
    lineWeight: A.lineWeight * ctx.scale, lineColour: A.lineColour, crease: A.crease, hiddenDashed: A.hiddenDashed, hiddenColour: A.hiddenColour, fillFaces: A.fillFaces,
    ambient: A.ambient, tones: A.tones, sun: sunDirection(A), shadowSoft: A.shadowSoft, aoRadius: A.aoRadius, aoStrength: A.aoStrength, arcticSun: A.arcticSun, idBy: A.idBy };
  const out = {};
  const pass = p => { const r = renderModel(opts, p, w, h); r.warn.forEach(x => ctx.warn(x)); return r; };
  if (want === 'image') {
    const r = pass(style === 'objectid' ? 'id' : 'image'); let img = r.img;
    if (style === 'objectid') img.idMap = { map: r.idMap, model };
    if (A.background && A.background !== 'transparent') img = IMG.merge(img, IMG.solid(w, h, A.background === 'white' ? '#ffffff' : A.bgColour), 'normal', 1);
    if (A.guidesOnImage) img = IMG.merge(safeGuides(w, h, camDef, A, ctx), img, 'normal', 1);
    out.image = img;
  } else if (want === 'mask') out.mask = pass('mask').img;
  else if (want === 'shadow') out.shadow = pass('shadow').img;
  else if (want === 'id') { const r = pass('id'); r.img.idMap = { map: r.idMap, model }; out.id = r.img; }
  else if (want === 'guides') out.guides = safeGuides(w, h, camDef, A, ctx);
  else if (want === 'camera') out.camera = cameraValue(model, camDef, w, h, L.vScale, L.isolate, +A.offsetZ || 0, opts);
  return out;
}
function cameraValue(model, camDef, w, h, vScale, isolate, offsetZ, opts) {
  const ext = model ? glExtent(model) : null, cam = buildCamera(camDef, w, h, { vScale, extent: ext }); let depth = null;
  return { kind: 'camera', cam, def: camDef, model, isolate: isolate || ['*'], offsetZ: offsetZ || 0, name: camDef.name, vScale,
    depth() { if (!depth) depth = renderModel({ model, camDef, isolate: isolate || ['*'], others: opts && opts.others === 'hide' ? 'hide' : 'holdout', offsetZ, option: opts && opts.option, vScale, style: 'shaded' }, 'depthAll', w, h).depth; return depth; } };
}
function glExtent(model) { try { return glInit() ? glModel(model).extent : null; } catch { return null; } }
// The camera's frame: border, action safe (90%), title safe (80%) and thirds, as the modeller draws them.
function safeGuides(w, h, camDef, A, ctx) {
  const safe = camDef && camDef.safe || { action: true, thirds: true }, box = A._box || { x: 0, y: 0, width: w, height: h };
  return IMG.draw(w, h, g => {
    const lw = Math.max(1, 2 * ctx.scale); g.strokeStyle = colourCss(A.guideColour || '#3554d1'); g.lineWidth = lw;
    const rect = k => { const ww = box.width * k, hh = box.height * k; g.strokeRect(box.x + (box.width - ww) / 2, box.y + (box.height - hh) / 2, ww, hh); };
    rect(1);
    if (safe.action) { g.setLineDash([lw * 6, lw * 4]); rect(0.9); rect(0.8); g.setLineDash([]); }
    if (safe.thirds) { g.globalAlpha = 0.6; for (const t of [1 / 3, 2 / 3]) { g.beginPath(); g.moveTo(box.x + box.width * t, box.y); g.lineTo(box.x + box.width * t, box.y + box.height); g.moveTo(box.x, box.y + box.height * t); g.lineTo(box.x + box.width, box.y + box.height * t); g.stroke(); } g.globalAlpha = 1; }
    g.fillStyle = g.strokeStyle; g.font = `600 ${Math.max(10, 22 * ctx.scale)}px ${FONT_STACK.sans}`; g.textBaseline = 'top';
    g.fillText(`${camDef ? camDef.name : ''}${camDef && camDef.lens ? ' · ' + camDef.lens + ' mm' : ''}${camDef && camDef.frameLabel ? ' · ' + camDef.frameLabel : ''}`, box.x + box.width * 0.1 + lw * 3, box.y + box.height * 0.1 + lw * 3);
  });
}

// ---------------------------------------------------------------- Model → Extract → Render
// The upstream model of a node, followed through Dots.
function upstreamModelKey(g, node, port = 'model', depth = 0) {
  const s = node && node.inputs && node.inputs[port]; if (!s || depth > 20) return null;
  const up = g.nodes[s.node]; if (!up) return null;
  if (up.type === 'modelSource') return up.args.model || null;
  if (up.type === 'dot') return upstreamModelKey(g, up, 'in', depth + 1);
  return null;
}
// The model behind a Camera input: through an Extract Camera, Render or Extract Points (their Model
// input) or a Viewport (its Model field).
function cameraInputModel(node, g = currentGraph(), depth = 0) {
  const s = node && node.inputs && node.inputs.camera, up = s && g.nodes[s.node]; if (!up || depth > 20) return null;
  if (up.type === 'dot') return cameraInputModel({ inputs: { camera: up.inputs.in } }, g, depth + 1);
  if (up.type === 'viewport') return getModel(up.args.model || 'sample');
  const key = upstreamModelKey(g, up, 'model'); return key ? getModel(key) : null;
}
function upstreamModel(node) { const key = upstreamModelKey(currentGraph(), node); return key ? getModel(key) : null; }
const modelOptions = () => Object.keys(doc.models).map(k => [k, `${doc.models[k].name || k}${doc.models[k].kind === 'ocaf' ? '' : ' (built-in format)'}`]);

defNode('modelSource', {
  label: 'Model', family: 'source', wide: true,
  desc: 'Holds the ocaf parametric model: its geometry, its sets and its cameras. Right-click or double-click to open it in the parametric modeller.',
  outputs: [{ n: 'model', k: 'model', l: 'Model' }, { n: 'preview', k: 'image', l: 'Preview' }],
  args: [A_('model', 'Model', 'select', 'samplecap', { options: modelOptions }),
    A_('open', 'Open parametric modeller', 'button', null, { action: 'openModeller' }),
    A_('load', 'Load model file…', 'button', null, { action: 'loadModelInto' }),
    A_('blank', 'New empty model', 'button', null, { action: 'newModelInto' })],
  async run(ctx, I, A, node, want) {
    const ref = doc.models[A.model]; if (!ref) throw new Error(`No model "${A.model}". Load a model file or start a new one.`);
    const model = await ensureModel(A.model);
    if (!model) throw new Error(ocafCache.get(A.model) && ocafCache.get(A.model).error || 'The model could not be built.');
    if (model.warn) model.warn.slice(0, 3).forEach(w => ctx.warn(w));
    if (model.stats && model.stats.failed && model.stats.failed.length) ctx.warn(`${model.stats.failed.length} feature(s) failed to build.`);
    const out = { model: { kind: 'model', key: A.model, model } };
    if (want === 'preview') {
      const cam = model.cameras.find(c => c.generated) || model.cameras[0]; if (!cam) { ctx.warn('The model has no geometry to show.'); out.preview = IMG.image(ctx.w, ctx.h); }
      else { const w = ctx.w, h = cam.frame ? Math.round(ctx.w / cam.frame) : ctx.h; out.preview = renderLayer(ctx, { model, camDef: cam, isolate: ['*'], style: 'shaded', w, h }, { others: 'hide', colourBy: 'model', colour: '#c9ced4', ambient: 0.55, lineWeight: 1, sunAzimuth: 205, sunAltitude: 40, background: 'white' }, 'image').image; }
    }
    return out;
  },
});
defNode('extractGeoset', {
  label: 'Extract Geoset', family: 'source', desc: 'Picks one set from the model. The list is read from the model\'s Geometrical Sets and Bodies.',
  inputs: [{ n: 'model', k: 'model', l: 'Model' }], outputs: [{ n: 'geoset', k: 'geoset', l: 'Geoset' }],
  args: [A_('geoset', 'Geoset', 'select', '', { options: n => { const m = upstreamModel(n); return [['', m ? 'Everything' : 'Connect a Model first'], ...(m ? m._index.geosets.map(g => [g, g]) : [])]; } }),
    A_('children', 'Include sub-sets', 'bool', true)],
  async run(ctx, I, A) {
    const mv = await I('model'); if (!mv) { ctx.warn('Connect a Model.'); return { geoset: null }; }
    const m = mv.model, path = A.geoset;
    if (path && !m._index.geosets.includes(path)) ctx.warn(`"${path}" is not a set in ${m.name}.`);
    if (!path) ctx.warn('No set picked: passing everything.');
    const patterns = path ? (A.children ? [path] : ['=' + path]) : ['*'];
    return { geoset: { kind: 'geoset', key: mv.key, path: path || '*', patterns, count: m.elements.filter(e => matchAny(patterns, e.geoset)).length } };
  },
});
defNode('extractCamera', {
  label: 'Extract Camera', family: 'source', desc: 'Picks one of the model\'s cameras. Its lens, roll, frame and safe frames come with it.',
  inputs: [{ n: 'model', k: 'model', l: 'Model' }], outputs: [{ n: 'camera', k: 'camera', l: 'Camera' }],
  args: [A_('camera', 'Camera', 'select', '', { options: n => { const m = upstreamModel(n); return m ? [...m.cameras.map(c => [c.name, `${c.name}${c.lens ? ' · ' + c.lens + ' mm' : ''}${c.frameLabel ? ' · ' + c.frameLabel : ''}`]), ['{camera}', '{camera} · from the Permutation row']] : [['', 'Connect a Model first']]; } }),
    A_('lock', 'Lock proportion', 'bool', true, { section: 'Resolution', hint: 'Takes the proportion from the camera\'s Frame in the modeller (16:9, A3 landscape…), so only the width is set.' }),
    A_('resW', 'Width', 'int', 0, { min: 0, max: 16000, step: 10, unit: 'px', hint: 'The default resolution for everything downstream of this camera. 0 uses the graph viewport width.' }),
    A_('resH', 'Height', 'int', 0, { min: 0, max: 16000, step: 10, unit: 'px', show: a => !a.lock, hint: '0 uses the graph viewport height.' }),
    A_('scale', 'Scale ×', 'number', 0, { min: 0, max: 16, step: 0.25, hint: 'Multiple of the default resolution, like Rhino\'s capture scale: 2 or 3 writes 2× or 3× the pixels with the same look. 0 uses the graph\'s Output scale.' })],
  async run(ctx, I, A) {
    const mv = await I('model'); if (!mv) { ctx.warn('Connect a Model.'); return { camera: null }; }
    const m = mv.model; if (!m.cameras.length) { ctx.warn('The model has no cameras. Add a Camera in the modeller.'); ctx.fail = true; return { camera: null }; }
    let def = m.cameras.find(c => c.name === A.camera);
    if (!def) { if (A.camera) ctx.warn(`Camera "${A.camera}" is not in the model; using ${m.cameras[0].name}.`); def = m.cameras[0]; }
    const w = ctx.w, h = def.frame ? Math.round(ctx.w / def.frame) : ctx.h;
    const cam = cameraValue(m, def, w, h, null, ['*'], 0, null); cam.lock = A.lock !== false; return { camera: cam };
  },
});
const isCurves = a => a.style === 'curves';
const CURVE_ARGS = [
  A_('curveSource', 'Curves', 'select', 'loose', { section: 'Curves', show: isCurves, options: [['loose', 'Curves and wires only'], ['all', 'Every edge, faces included']], hint: 'Curves and wires leaves out the edges of faces, so an imported STEP gives just its lines.' }),
  A_('strokeWidth', 'Weight', 'number', 3, { min: 0.25, max: 80, step: 0.25, unit: 'px', show: isCurves }),
  A_('strokeColour', 'Colour', 'colour', '#1c2026', { show: isCurves }),
  A_('profile', 'Width profile', 'select', 'uniform', { show: isCurves, options: CURVE_PROFILES }),
  A_('minWidth', 'Thinnest', 'number', 15, { min: 0, max: 100, unit: '%', show: a => isCurves(a) && a.profile !== 'uniform', hint: 'The narrow part of the profile, as a share of the weight.' }),
  A_('dash', 'Line type', 'select', 'solid', { show: isCurves, options: CURVE_DASHES }),
  A_('dashScale', 'Dash scale', 'number', 1, { min: 0.1, max: 20, step: 0.1, show: a => isCurves(a) && a.dash !== 'solid' }),
  A_('cap', 'Caps', 'select', 'round', { show: isCurves, options: [['round', 'Round'], ['butt', 'Butt'], ['square', 'Projecting']] }),
  A_('arrowStart', 'Start arrow', 'select', 'none', { show: isCurves, options: ARROWS }),
  A_('arrowEnd', 'End arrow', 'select', 'none', { show: isCurves, options: ARROWS }),
  A_('arrowSize', 'Arrow size', 'number', 4, { min: 1, max: 20, step: 0.25, unit: '× weight', show: a => isCurves(a) && (a.arrowStart !== 'none' || a.arrowEnd !== 'none') }),
  A_('reverse', 'Reverse direction', 'bool', false, { show: isCurves, hint: 'Swaps which end is the start, for arrows and tapers.' }),
  A_('occlude', 'Behind geometry', 'select', 'hidden', { show: isCurves, options: [['hidden', 'Hidden'], ['over', 'Drawn over']] }),
  A_('minLength', 'Skip shorter than', 'number', 0, { min: 0, max: 500, unit: 'px', show: isCurves }),
];
// Model -> Extract Points (pick a set) -> Decal Scatter. Points and vectors of a set, projected
// through the camera into Points2D; a vector turns the decal on it (or the point nearest it).
defNode('extractPoints', {
  label: 'Extract Points', family: 'source', desc: 'Takes the Points and Vectors of one set of the model and places them in the camera\'s picture, ready for Decal Scatter. A vector gives its decal a direction.',
  inputs: [{ n: 'model', k: 'model', l: 'Model' }, { n: 'camera', k: 'camera', l: 'Camera' }, { n: 'geoset', k: 'geoset', l: 'Geoset' }], outputs: [{ n: 'points', k: 'points', l: 'Points2D' }],
  args: [
    A_('geoset', 'Set', 'select', '', { options: n => { const m = upstreamModel(n); return m ? [['', 'Everything'], ...m._index.geosets.map(g => [g, g])] : [['', 'Connect a Model first']]; }, hint: 'A Geoset wired in takes over from this list.' }),
    A_('children', 'Include sub-sets', 'bool', true),
    A_('source', 'Use', 'select', 'auto', { options: [['auto', 'Points, aimed by the set\'s vectors'], ['points', 'Points only'], ['vectors', 'Vectors, at their start'], ['vectorTips', 'Vectors, at their tip'], ['both', 'Points and vectors'], ['elements', 'Centres of the set\'s objects']] }),
    A_('lift', 'Lift', 'number', 0, { unit: 'm', hint: 'Raises the points before the hidden test, so a point on a surface is not hidden by it.' }),
    A_('hideOccluded', 'Drop points hidden behind geometry', 'bool', true, { hint: 'Points outside the camera\'s frame or behind it are always left out.' }),
  ],
  async run(ctx, I, A, node) {
    const [mv, cv0, gv] = await Promise.all([I('model'), I('camera'), I('geoset')]);
    const m = mv ? mv.model : cv0 ? cv0.model : null, none = { points: { kind: 'points', w: ctx.w, h: ctx.h, pts: [] } };
    if (!m) { ctx.warn('Connect a Model.'); return none; }
    let cv = cv0;
    if (!cv) { const def = m.cameras[0]; if (!def) { ctx.warn('The model has no cameras.'); return none; } ctx.warn(`No camera connected; using ${def.name}.`); cv = cameraValue(m, def, ctx.w, def.frame ? Math.round(ctx.w / def.frame) : ctx.h, null, ['*'], 0, null); }
    const path = gv ? null : A.geoset, pat = gv ? gv.patterns : !path ? ['*'] : A.children ? [path] : ['=' + path];
    if (path && path !== '*' && !m._index.geosets.includes(path)) ctx.warn(`"${path}" is not a set in ${m.name}.`);
    const P = (m.points || []).filter(p => matchAny(pat, p.geoset)), V = (m.vectors || []).filter(v => matchAny(pat, v.geoset));
    // Which vector turns which point: a vector that has a place (a tangent at a point) turns the point
    // nearest it; a typed direction has no place, so one turns every point and several pair up with
    // the points in the order they sit in the tree.
    const located = V.filter(v => v.located), typed = V.filter(v => !v.located);
    const aimFor = (at, i) => { if (located.length) { let best = null, bd = Infinity; for (const v of located) { const d = len3(sub3(v.at, at)); if (d < bd) { bd = d; best = v; } } return best.dir; } return typed.length ? typed[typed.length === 1 ? 0 : i % typed.length].dir : null; };
    const src = [];
    if (A.source === 'auto' || A.source === 'points' || A.source === 'both') P.forEach((p, i) => src.push({ id: p.id, p3: p.at, dir: A.source === 'auto' ? aimFor(p.at, i) : null, attrs: p.attrs, geoset: p.geoset }));
    if ((A.source === 'vectors' || A.source === 'vectorTips') && V.length && !located.length) ctx.warn('These vectors are typed directions with no position of their own (they start at the origin). Use "Points, aimed by the set\'s vectors", or make them tangents at a point.');
    if (A.source === 'vectors' || A.source === 'vectorTips' || A.source === 'both') for (const v of (A.source === 'both' ? located : V)) src.push({ id: v.id, p3: A.source === 'vectorTips' ? add3(v.at, scale3(v.dir, v.len)) : v.at, dir: v.dir, attrs: v.attrs, geoset: v.geoset });
    if (A.source === 'elements') for (const e of m.elements) if (matchAny(pat, e.geoset)) { const b = elementBounds(e); if (b && b.mn.every(Number.isFinite)) src.push({ id: e.id, p3: scale3(add3(b.mn, b.mx), 0.5), dir: null, attrs: e.attrs || {}, geoset: e.geoset }); }
    if (!src.length) { ctx.warn(`No ${A.source === 'elements' ? 'objects' : A.source.startsWith('vector') ? 'vectors' : 'points'} in "${path || (gv && gv.path) || 'the model'}". Add Points or Vectors to that set in the modeller.`); return { points: { kind: 'points', w: cv.cam.w, h: cv.cam.h, pts: [], cam: cv.cam } }; }
    const depth = cv.depth(), cam = cv.cam, pts = []; let offFrame = 0, hidden = 0;
    for (const s of src) {
      let p3 = s.p3; if (matchAny(cv.isolate, s.geoset)) p3 = add3(p3, [0, 0, cv.offsetZ]);
      const pr = projectPoint(cam, p3), pt = projectPoint(cam, add3(p3, [0, 0, +A.lift || 0])); if (!pr || !pt) { offFrame++; continue; }
      // Only what the camera sees is listed: in front of it and inside its frame, and (by default)
      // not hidden behind geometry.
      if (pr.depth <= cam.near || pr.x < 0 || pr.y < 0 || pr.x >= cam.w || pr.y >= cam.h) { offFrame++; continue; }
      let vis = true; const bx = Math.round(pt.x), by = Math.round(pt.y);
      if (bx >= 0 && by >= 0 && bx < cam.w && by < cam.h) { let mn = Infinity; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mn = Math.min(mn, depth[clampI(by + dy, 0, cam.h - 1) * cam.w + clampI(bx + dx, 0, cam.w - 1)]); vis = pt.depth <= mn + 0.6 + pt.depth * 0.004; }
      if (A.hideOccluded && !vis) { hidden++; continue; }
      let angle = null, dir2 = null;
      // The direction on screen: a short step along the vector, sized to the scene so it projects cleanly.
      if (s.dir) { const step = Math.max(0.5, pr.depth * 0.02), q = projectPoint(cam, add3(p3, scale3(s.dir, step))); if (q) { dir2 = [q.x - pr.x, q.y - pr.y]; angle = Math.atan2(dir2[1], dir2[0]) * 180 / Math.PI; } }
      pts.push({ id: s.id, x: pr.x, y: pr.y, depth: pr.depth, visible: vis, p3, dir: dir2, angle, attrs: s.attrs });
    }
    if (offFrame || hidden) ctx.warn(`${pts.length} of ${src.length} listed: ${[offFrame ? offFrame + ' outside the camera\'s view' : '', hidden ? hidden + ' hidden behind geometry' : ''].filter(Boolean).join(', ')}.`);
    return { points: { kind: 'points', w: cam.w, h: cam.h, pts, cam } };
  },
});
const RENDER_SKIP = new Set(['path', 'model', 'option', 'camera', 'style', 'resW', 'resH', 'offsetZ']);
defNode('render', {
  label: 'Render', family: 'source', desc: 'Renders the geoset from the camera. Other geometry is a holdout, so the image and mask are just the object, correctly occluded. The size is the camera\'s own frame, so overlays line up.',
  inputs: [{ n: 'model', k: 'model', l: 'Model' }, { n: 'camera', k: 'camera', l: 'Camera' }, { n: 'geoset', k: 'geoset', l: 'Geoset' }],
  outputs: [{ n: 'image', k: 'image', l: 'Image' }, { n: 'mask', k: 'mask', l: 'Mask' }, { n: 'shadow', k: 'mask', l: 'Shadow' }, { n: 'id', k: 'image', l: 'Object ID' }, { n: 'guides', k: 'image', l: 'Safe frame' }, { n: 'camera', k: 'camera', l: 'Camera' }],
  get args() { delete this.args; return (this.args = [
    A_('style', 'Render style', 'select', 'shaded', { options: [...RENDER_STYLES.map(s => [s, STYLE_LABEL[s]]), ['curves', 'Curves (strokes)']] }),
    ...CURVE_ARGS,
    A_('colourBy', 'Colours', 'select', 'model', { options: [['model', 'From the model'], ['single', 'One colour']], show: a => !['arctic', 'objectid', 'hiddenline', 'curves'].includes(a.style) }),
    ...NODE_TYPES.viewport.args.filter(x => !RENDER_SKIP.has(x.n)).map(x => x.n === 'aoRadius' ? { ...x, d: 0, min: 0, hint: '0 sizes it from the model.' } : x.n === 'colour' ? { ...x, show: a => !['arctic', 'objectid', 'hiddenline'].includes(a.style) && a.colourBy === 'single' } : x).map(x => ({ ...x, show: a => !isCurves(a) && (!x.show || x.show(a)) })),
    A_('offsetZ', 'Offset Z', 'number', 0, { unit: 'm', section: 'Frame', hint: 'Moves the geoset in 3D (true explode).' }),
    A_('sizeMode', 'Image size', 'select', 'frame', { options: [['frame', 'Camera frame at canvas width'], ['canvas', 'Graph canvas, frame letterboxed']] }),
    A_('guidesOnImage', 'Draw safe frame on image', 'bool', false),
    A_('guideColour', 'Guide colour', 'colour', '#3554d1'),
  ]); },
  async run(ctx, I, A, node, want) {
    const [mv, cv, gv] = await Promise.all([I('model'), I('camera'), I('geoset')]);
    const model = mv ? mv.model : cv ? cv.model : null;
    if (!model) { ctx.warn('Connect a Model.'); ctx.fail = true; return { image: blank(ctx), mask: IMG.mask(ctx.w, ctx.h) }; }
    let camDef = cv && cv.def;
    if (!camDef) { camDef = model.cameras[0]; if (camDef) ctx.warn(`No camera connected; using ${camDef.name}.`); }
    if (!camDef) { ctx.warn('The model has no cameras.'); ctx.fail = true; return { image: blank(ctx), mask: IMG.mask(ctx.w, ctx.h) }; }
    if (gv && mv && gv.key !== mv.key) ctx.warn('The geoset comes from a different model.');
    const isolate = gv ? gv.patterns : ['*'];
    const ratio = camDef.frame || ctx.w / ctx.h;
    let w = ctx.w, h = Math.round(ctx.w / ratio), vScale = null, box = null;
    if (A.sizeMode === 'canvas' || (cv && cv.lock === false)) { w = ctx.w; h = ctx.h; const have = w / h, bw = have > ratio ? h * ratio : w, bh = have > ratio ? h : w / ratio; box = { x: (w - bw) / 2, y: (h - bh) / 2, width: bw, height: bh }; vScale = h / bh; }
    let out;
    if (A.style === 'curves' && ['image', 'mask', 'shadow', 'id'].includes(want)) {
      if (want === 'shadow' || want === 'id') return { [want]: want === 'id' ? IMG.image(w, h) : IMG.mask(w, h) };
      const r = renderCurves(ctx, { model, camDef, isolate, option: null, w, h, vScale }, A);
      if (!r.count) ctx.warn(r.runs ? 'Every curve is shorter than "Skip shorter than".' : `No curves${gv && gv.path !== '*' ? ' in "' + gv.path + '"' : ''} in view of "${camDef.name}". Curves and wires leaves out face edges; try "Every edge".`);
      let img = r.image;
      if (A.guidesOnImage) img = IMG.merge(safeGuides(w, h, camDef, { ...A, _box: box }, ctx), img, 'normal', 1);
      if (A.background && A.background !== 'transparent') img = IMG.merge(img, IMG.solid(w, h, A.background === 'white' ? '#ffffff' : A.bgColour), 'normal', 1);
      return want === 'mask' ? { mask: IMG.maskFromAlpha(r.image) } : { image: img };
    }
    out = renderLayer(ctx, { model, camDef, isolate, style: A.style, w, h, vScale }, { ...A, _box: box }, want);
    if (want === 'image' && out.image && out.image.d && A.background === 'transparent') {
      let any = false; const d = out.image.d; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { any = true; break; }
      if (!any) ctx.warn(`Nothing${gv && gv.path !== '*' ? ' from "' + gv.path + '"' : ''} is in view of camera "${camDef.name}". Try the "${(model.cameras.find(c => c.generated) || {}).name || 'Fit all'}" camera to find it.`);
    }
    return out;
  },
});
function cameraNames(node) { const m = getModel(node && node.args && node.args.model || 'sample'); return m ? m.cameras.map(c => c.name) : []; }

defNode('pointProject', {
  label: 'Point Project', family: 'points', desc: 'Projects 3D points of a geoset through a Viewport camera into pixel space, with an occlusion test.',
  inputs: [{ n: 'camera', k: 'camera', l: 'Camera' }], outputs: [{ n: 'points', k: 'points', l: 'Points2D' }],
  args: [
    A_('geoset', 'Set', 'select', '', { options: n => { const m = cameraInputModel(n), v = n.args.geoset;
      const list = m ? [['', 'Everything'], ...m._index.geosets.map(g => [g, g])] : [['', 'Connect a camera first']];
      // A value typed in an older graph (a pattern or a token) stays selectable rather than vanishing.
      if (v && !list.some(o => o[0] === v)) list.push([v, v]); return list; } }),
    A_('source', 'Point source', 'select', 'auto', { options: [['auto', 'Named points, else element tops'], ['named', 'Named points'], ['top', 'Element top centre'], ['centroid', 'Element centroid'], ['base', 'Element base centre']] }),
    A_('lift', 'Lift', 'number', 1.2, { unit: 'm', hint: 'Raises points off the ground before the occlusion test.' }),
    A_('hideOccluded', 'Drop hidden points', 'bool', false),
  ],
  run(ctx, I, A) {
    return I('camera').then(cv => {
      if (!cv) { ctx.warn('Connect a Viewport camera output.'); return { points: { kind: 'points', w: ctx.w, h: ctx.h, pts: [] } }; }
      const m = cv.model, pat = A.geoset ? A.geoset.split(',').map(s => s.trim()).filter(Boolean) : ['*'];
      const src = [];
      const named = (m.points || []).filter(p => matchAny(pat, p.geoset));
      if ((A.source === 'auto' && named.length) || A.source === 'named') for (const p of named) src.push({ id: p.id, p3: p.at, dir: p.dir || null, attrs: p.attrs || {}, geoset: p.geoset });
      else for (const e of m.elements) if (matchAny(pat, e.geoset)) {
        const b = elementBounds(e), c = scale3(add3(b.mn, b.mx), 0.5);
        const p3 = A.source === 'centroid' ? c : A.source === 'base' ? [c[0], c[1], b.mn[2]] : [c[0], c[1], b.mx[2]];
        src.push({ id: e.id, p3, dir: null, attrs: e.attrs || {}, geoset: e.geoset });
      }
      if (!src.length) ctx.warn(`No points found in "${A.geoset || 'the model'}".`);
      const depth = cv.depth(), cam = cv.cam, pts = [];
      for (const s of src) {
        let p3 = s.p3; if (matchAny(cv.isolate, s.geoset)) p3 = add3(p3, [0, 0, cv.offsetZ]);
        const test = add3(add3(p3, [0, 0, A.lift]), s.dir ? scale3(s.dir, 0.8) : [0, 0, 0]);
        const pr = projectPoint(cam, p3), pt = projectPoint(cam, test); if (!pr || !pt) continue;
        let vis = true, bx = Math.round(pt.x), by = Math.round(pt.y);
        if (bx >= 0 && by >= 0 && bx < cam.w && by < cam.h) { let mn = Infinity; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = clampI(bx + dx, 0, cam.w - 1), yy = clampI(by + dy, 0, cam.h - 1); mn = Math.min(mn, depth[yy * cam.w + xx]); } vis = pt.depth <= mn + 0.6 + pt.depth * 0.004; }
        else vis = false;
        if (A.hideOccluded && !vis) continue;
        let angle = null, dir2 = null;
        if (s.dir) { const q = projectPoint(cam, add3(p3, scale3(s.dir, 4))); if (q) { dir2 = [q.x - pr.x, q.y - pr.y]; angle = Math.atan2(dir2[1], dir2[0]) * 180 / Math.PI; } }
        pts.push({ id: s.id, x: pr.x, y: pr.y, depth: pr.depth, visible: vis, p3, dir: dir2, angle, attrs: s.attrs });
      }
      return { points: { kind: 'points', w: cam.w, h: cam.h, pts, cam } };
    });
  },
});
function elementBounds(e) {
  if (e.shape === 'mesh') {
    // Model meshes (and curves): the box of their finite vertices, worked out once.
    if (!e._bb) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const A of [e.mesh && e.mesh.pos, e.edges]) if (A) for (let i = 0; i + 2 < A.length; i += 3) { if (!Number.isFinite(A[i]) || !Number.isFinite(A[i + 1]) || !Number.isFinite(A[i + 2])) continue; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], A[i + k]); mx[k] = Math.max(mx[k], A[i + k]); } }
      e._bb = mx[0] >= mn[0] ? { mn, mx } : { mn: [NaN, NaN, NaN], mx: [NaN, NaN, NaN] }; }
    return e._bb;
  }
  if (e.shape === 'sphere') return { mn: sub3(e.at, [e.r, e.r, e.r]), mx: add3(e.at, [e.r, e.r, e.r]) };
  if (e.shape === 'cyl') { const hh = e.size ? e.size[2] : e.h; return { mn: [e.at[0] - e.r, e.at[1] - e.r, e.at[2]], mx: [e.at[0] + e.r, e.at[1] + e.r, e.at[2] + hh] }; }
  const [w, d, hh] = e.size, r = Math.hypot(w, d) / 2, rot = e.rot || 0, x = rot ? r : w / 2, y = rot ? r : d / 2;
  return { mn: [e.at[0] - x, e.at[1] - y, e.at[2]], mx: [e.at[0] + x, e.at[1] + y, e.at[2] + hh] };
}

defNode('colourSelect', {
  label: 'Colour Select', family: 'source', desc: 'Turns objects in an Object ID render into a mask. Pick by id or geoset name, or click objects in the Viewer.',
  inputs: [{ n: 'id', k: 'image', l: 'Object ID' }], outputs: [{ n: 'mask', k: 'mask', l: 'Mask' }],
  args: [A_('names', 'Objects', 'text', 'option1', { hint: 'Element ids or geoset paths, one per line or comma separated. With this node selected, click an object in the Viewer to add it.' })],
  async run(ctx, I, A) {
    const id = await I('id'); if (!id) { ctx.warn('Connect a Viewport Object ID output.'); return { mask: IMG.mask(ctx.w, ctx.h) }; }
    if (!id.idMap) { ctx.warn('Input carries no object map. Connect the Object ID output of a Viewport.'); return { mask: IMG.mask(id.w, id.h) }; }
    const names = A.names.split(/[\n,]/).map(s => s.trim()).filter(Boolean), keep = new Set(), byId = id.idMap.model._index.byId;
    for (const [k, v] of id.idMap.map) if (v.ids.some(eid => names.includes(eid) || (byId.get(eid) && matchAny(names, byId.get(eid).geoset)) || names.includes(v.key))) keep.add(k);
    if (!keep.size) ctx.warn('No objects in view match these names.');
    const m = IMG.mask(id.w, id.h);
    for (let p = 0, i = 0; p < m.d.length; p++, i += 4) { if (id.d[i + 3] < 0.5) continue; const k = (Math.round(id.d[i] * 255) << 16) | (Math.round(id.d[i + 1] * 255) << 8) | Math.round(id.d[i + 2] * 255); if (keep.has(k)) m.d[p] = 1; }
    return { mask: m };
  },
});

// ---------------------------------------------------------------- image operations
const IN_IMG = { n: 'image', k: 'image', l: 'Image' }, OUT_IMG = { n: 'image', k: 'image', l: 'Image' };
const simple = (type, label, desc, args, fn, family = 'image') => defNode(type, { label, family, desc, inputs: [IN_IMG], outputs: [OUT_IMG], args,
  async run(ctx, I, A) { const im = await I('image'); if (!im) { ctx.warn('No input image.'); return { image: blank(ctx) }; } return { image: fn(im, A, ctx) }; } });

defNode('merge', {
  label: 'Merge', family: 'image', desc: 'Composites A onto B with a blend mode, opacity and optional mask. The result takes B\'s size.',
  inputs: [{ n: 'a', k: 'image', l: 'A (top)' }, { n: 'b', k: 'image', l: 'B (bottom)' }, { n: 'mask', k: 'mask', l: 'Mask' }], outputs: [OUT_IMG],
  args: [A_('mode', 'Blend mode', 'select', 'normal', { options: BLEND_OPTS }), A_('opacity', 'Opacity', 'number', 100, { min: 0, max: 100, unit: '%' })],
  async run(ctx, I, A) { const [a, b, m] = await Promise.all([I('a'), I('b'), I('mask')]); if (!a && !b) ctx.warn('Nothing connected.'); return { image: IMG.merge(a, b || blank(ctx), A.mode, A.opacity / 100, m, ctx.w, ctx.h) }; },
});
defNode('layerStack', {
  label: 'Layer Stack', family: 'image', desc: 'A Photoshop-style ordered stack: first row is the bottom layer. Each row has a blend mode, opacity, visibility and optional mask.',
  inputs: n => { const rows = (n.args.rows || []); const out = []; rows.forEach((r, i) => { out.push({ n: 'L' + r.id, k: 'image', l: r.name || `Layer ${i + 1}` }); out.push({ n: 'M' + r.id, k: 'mask', l: '↳ mask' }); }); return out; },
  outputs: [OUT_IMG],
  args: [A_('rows', 'Layers', 'rows', null, { rowFields: [['name', 'string', ''], ['blend', 'select', 'normal'], ['opacity', 'number', 100], ['visible', 'bool', true]] })],
  defaults: () => ({ rows: [newRow(), newRow(), newRow()] }),
  async run(ctx, I, A, node) {
    let acc = blank(ctx); const rows = node.args.rows || [];
    for (const r of rows) {
      if (r.visible === false) continue;
      const [im, m] = await Promise.all([I('L' + r.id), I('M' + r.id)]); if (!im) continue;
      acc = IMG.merge(im, acc, r.blend || 'normal', (r.opacity == null ? 100 : +r.opacity) / 100, m);
    }
    return { image: acc };
  },
});
function newRow(p = {}) { return { id: Math.random().toString(36).slice(2, 7), name: '', blend: 'normal', opacity: 100, visible: true, ...p }; }

simple('opacity', 'Opacity', 'Multiplies alpha.', [A_('opacity', 'Opacity', 'number', 60, { min: 0, max: 100, unit: '%' })], (im, A) => IMG.opacity(im, A.opacity / 100));
simple('colourOverlay', 'Colour Overlay', 'Flattens an image to one colour while keeping its alpha. The main tool for graphic standards.',
  [A_('colour', 'Colour', 'colour', '#c9ccd1'), A_('amount', 'Amount', 'number', 100, { min: 0, max: 100, unit: '%' })], (im, A) => IMG.overlayColour(im, A.colour, A.amount / 100));
simple('levels', 'Levels', 'Input black/white points, gamma and output range.',
  [A_('inB', 'Input black', 'number', 0, { min: 0, max: 1, step: 0.01 }), A_('inW', 'Input white', 'number', 1, { min: 0, max: 1, step: 0.01 }), A_('gamma', 'Gamma', 'number', 1, { min: 0.1, max: 4, step: 0.01 }),
   A_('outB', 'Output black', 'number', 0, { min: 0, max: 1, step: 0.01 }), A_('outW', 'Output white', 'number', 1, { min: 0, max: 1, step: 0.01 })], (im, A) => IMG.levels(im, A.inB, A.inW, A.gamma, A.outB, A.outW));
simple('hsl', 'Hue / Saturation', 'Shifts hue, scales saturation and lifts lightness.',
  [A_('hue', 'Hue', 'number', 0, { min: -180, max: 180, unit: '°' }), A_('sat', 'Saturation', 'number', 0, { min: -1, max: 1, step: 0.01 }), A_('light', 'Lightness', 'number', 0, { min: -1, max: 1, step: 0.01 })], (im, A) => IMG.hsl(im, A.hue, A.sat, A.light));
simple('invert', 'Invert', 'Inverts colour, keeps alpha.', [], im => IMG.invert(im));
simple('threshold', 'Threshold', 'Two-tone by luminance.', [A_('t', 'Threshold', 'number', 0.5, { min: 0, max: 1, step: 0.01 }), A_('dark', 'Dark', 'colour', '#1c2026'), A_('light', 'Light', 'colour', '#ffffff')], (im, A) => IMG.threshold(im, A.t, A.dark, A.light));
simple('posterize', 'Posterize', 'Reduces each channel to N levels.', [A_('levels', 'Levels', 'int', 4, { min: 2, max: 16 })], (im, A) => IMG.posterize(im, A.levels));
simple('blur', 'Blur', 'Gaussian-like blur.', [A_('radius', 'Radius', 'number', 6, { min: 0, max: 120, px: true, unit: 'px' })], (im, A, ctx) => IMG.blur(im, px(A.radius, ctx)));
simple('glow', 'Glow', 'Adds a blurred halo with Screen.', [A_('radius', 'Radius', 'number', 14, { min: 1, max: 160, px: true, unit: 'px' }), A_('intensity', 'Intensity', 'number', 0.8, { min: 0, max: 3, step: 0.01 }), A_('colour', 'Tint', 'colour', '#ffffff'), A_('tint', 'Tint amount', 'number', 0, { min: 0, max: 100, unit: '%' })],
  (im, A, ctx) => { let g = IMG.blur(im, px(A.radius, ctx)); if (A.tint > 0) g = IMG.overlayColour(g, A.colour, A.tint / 100); return IMG.merge(IMG.opacity(g, A.intensity > 1 ? 1 : A.intensity), im, 'screen', Math.min(1, A.intensity)); });
simple('dropShadow', 'Drop Shadow', 'Offset, blurred shadow from alpha, placed under the image.',
  [A_('dx', 'Offset X', 'number', 10, { px: true, unit: 'px' }), A_('dy', 'Offset Y', 'number', 10, { px: true, unit: 'px' }), A_('radius', 'Blur', 'number', 12, { min: 0, max: 120, px: true, unit: 'px' }), A_('colour', 'Colour', 'colour', '#1c2026'), A_('opacity', 'Opacity', 'number', 45, { min: 0, max: 100, unit: '%' })],
  (im, A, ctx) => { let s = IMG.maskToImage(IMG.maskFromAlpha(im), A.colour); s = IMG.shift(s, px(A.dx, ctx), px(A.dy, ctx)); s = IMG.blur(s, px(A.radius, ctx)); return IMG.merge(im, IMG.opacity(s, A.opacity / 100), 'normal', 1); });
defNode('stroke', {
  label: 'Stroke', family: 'image', desc: 'Draws an outline around the image alpha, or around a mask when one is connected.',
  inputs: [IN_IMG, { n: 'mask', k: 'mask', l: 'Shape mask' }], outputs: [OUT_IMG],
  args: [A_('width', 'Width', 'number', 2, { min: 0.25, max: 60, step: 0.25, px: true, unit: 'px' }), A_('colour', 'Colour', 'colour', '#1c2026'),
    A_('position', 'Position', 'select', 'outside', { options: [['outside', 'Outside'], ['centre', 'Centre'], ['inside', 'Inside']] }), A_('opacity', 'Opacity', 'number', 100, { min: 0, max: 100, unit: '%' }), A_('keep', 'Keep source', 'bool', true)],
  async run(ctx, I, A) {
    const [im, m] = await Promise.all([I('image'), I('mask')]); const shape = m || im;
    if (!shape) { ctx.warn('Connect an image or a mask.'); return { image: blank(ctx) }; }
    const st = IMG.stroke(shape, px(A.width, ctx), A.colour, A.position, A.opacity / 100, false);
    if (!A.keep || !im) return { image: st };
    return { image: A.position === 'outside' ? IMG.merge(im, st, 'normal', 1) : IMG.merge(st, im, 'normal', 1) };
  },
});
simple('transform', 'Transform', 'Move, scale and rotate about the canvas centre.',
  [A_('dx', 'Move X', 'number', 0, { px: true, unit: 'px' }), A_('dy', 'Move Y', 'number', 0, { px: true, unit: 'px' }), A_('scale', 'Scale', 'number', 1, { min: 0.05, max: 8, step: 0.01 }), A_('rotate', 'Rotate', 'number', 0, { min: -180, max: 180, unit: '°' })],
  (im, A, ctx) => IMG.transform(im, px(A.dx, ctx), px(A.dy, ctx), A.scale, A.rotate));
defNode('setAlpha', {
  label: 'Apply Mask', family: 'mask', desc: 'Multiplies (or replaces) an image\'s alpha by a mask.',
  inputs: [IN_IMG, { n: 'mask', k: 'mask', l: 'Mask' }], outputs: [OUT_IMG],
  args: [A_('mode', 'Mode', 'select', 'multiply', { options: [['multiply', 'Multiply alpha'], ['replace', 'Replace alpha']] })],
  async run(ctx, I, A) { const [im, m] = await Promise.all([I('image'), I('mask')]); if (!im) { ctx.warn('No input image.'); return { image: blank(ctx) }; } if (!m) { ctx.warn('No mask connected; passing the image through.'); return { image: im }; } return { image: IMG.setAlpha(im, m, A.mode) }; },
});

defNode('explode', {
  label: 'Explode', family: 'image', desc: 'Offsets stacked layers into an exploded axonometric while keeping them registered. Exact in orthographic views.',
  inputs: n => { const c = Math.max(1, Math.round(+n.args.count || 3)); const a = []; for (let i = 0; i < c; i++) a.push({ n: 'L' + i, k: 'image', l: `Layer ${i + 1}${i === 0 ? ' (bottom)' : ''}` }); a.push({ n: 'camera', k: 'camera', l: 'Camera' }, { n: 'points', k: 'points', l: 'Points2D' }); return a; },
  outputs: [OUT_IMG, { n: 'points', k: 'points', l: 'Points2D' }],
  args: [
    A_('count', 'Layers', 'int', 3, { min: 1, max: 16 }),
    A_('units', 'Offset in', 'select', 'model', { options: [['model', 'Model units along +Z'], ['pixels', 'Pixels']] }),
    A_('dz', 'Step', 'number', 18, { unit: 'm', show: a => a.units === 'model' }),
    A_('dx', 'Step X', 'number', 0, { px: true, unit: 'px', show: a => a.units === 'pixels' }),
    A_('dy', 'Step Y', 'number', -120, { px: true, unit: 'px', show: a => a.units === 'pixels' }),
    A_('stepMode', 'Step mode', 'select', 'cumulative', { options: [['cumulative', 'Cumulative (layer n moves n × step)'], ['list', 'Per-layer list']] }),
    A_('list', 'Per-layer multiples', 'string', '0, 1, 2', { show: a => a.stepMode === 'list', hint: 'One multiple of the step per layer, bottom first.' }),
    A_('order', 'On top', 'select', 'last', { options: [['last', 'Upper layers on top'], ['first', 'Lower layers on top']] }),
    A_('leaders', 'Leader lines', 'bool', true, { section: 'Leaders' }),
    A_('leaderColour', 'Leader colour', 'colour', '#3d4450', { show: a => a.leaders }),
    A_('leaderWeight', 'Leader weight', 'number', 1.5, { px: true, unit: 'px', min: 0.5, max: 8, step: 0.1, show: a => a.leaders }),
    A_('pointsLayer', 'Points follow layer', 'int', 1, { min: 1, max: 16, section: 'Points', hint: 'Points2D on this layer move with it, so icons stay on their floor.' }),
  ],
  async run(ctx, I, A) {
    const n = Math.max(1, Math.round(A.count)), layers = []; for (let i = 0; i < n; i++) layers.push(await I('L' + i));
    const cv = await I('camera');
    let vec = [px(A.dx, ctx), px(A.dy, ctx)];
    if (A.units === 'model') {
      if (!cv) { ctx.warn('Model-unit offsets need a Camera input; using 0.'); vec = [0, 0]; }
      else {
        const c = cv.cam, t = c.target, a = projectPoint(c, t), b = projectPoint(c, add3(t, [0, 0, A.dz]));
        vec = a && b ? [(b.x - a.x) * ctx.w / c.w, (b.y - a.y) * ctx.h / c.h] : [0, 0];
        if (!c.ortho) ctx.warn('Perspective camera: a pixel shift is not a true 3D offset. Set Offset Z on each Viewport for an exact perspective explode.');
      }
    }
    const mult = A.stepMode === 'list' ? A.list.split(',').map(s => parseFloat(s) || 0) : null;
    const offs = layers.map((_, i) => { const k = mult ? (mult[i] || 0) : i; return [vec[0] * k, vec[1] * k]; });
    const shifted = layers.map((im, i) => im ? IMG.shift(IMG.fit(im, ctx.w, ctx.h), offs[i][0], offs[i][1]) : null);
    let acc = blank(ctx);
    const order = A.order === 'first' ? [...shifted.keys()].reverse() : [...shifted.keys()];
    for (const i of order) if (shifted[i]) acc = IMG.merge(shifted[i], acc, 'normal', 1);
    if (A.leaders && n > 1) {
      const boxes = layers.map(im => im ? IMG.bbox(IMG.fit(im, ctx.w, ctx.h)) : null), lw = px(A.leaderWeight, ctx);
      const lines = IMG.draw(ctx.w, ctx.h, g => {
        g.strokeStyle = colourCss(A.leaderColour); g.lineWidth = lw; g.setLineDash([lw * 4, lw * 3]);
        for (let i = 0; i < n - 1; i++) { const b0 = boxes[i], b1 = boxes[i + 1]; if (!b0 || !b1) continue;
          for (const [cx, cy] of [['x0', 'y0'], ['x1', 'y0'], ['x0', 'y1'], ['x1', 'y1']]) { g.beginPath(); g.moveTo(b0[cx] + offs[i][0], b0[cy] + offs[i][1]); g.lineTo(b1[cx] + offs[i + 1][0], b1[cy] + offs[i + 1][1]); g.stroke(); } }
      });
      acc = IMG.merge(lines, acc, 'normal', 1);
    }
    const pin = await I('points'); let pts = null;
    if (pin) { const k = clampI(Math.round(A.pointsLayer) - 1, 0, n - 1), sx = ctx.w / pin.w, sy = ctx.h / pin.h; pts = { ...pin, pts: pin.pts.map(p => ({ ...p, x: p.x + offs[k][0] / sx, y: p.y + offs[k][1] / sy })) }; }
    return { image: acc, points: pts };
  },
});

// ---------------------------------------------------------------- masks
const IN_MASK = { n: 'mask', k: 'mask', l: 'Mask' }, OUT_MASK = { n: 'mask', k: 'mask', l: 'Mask' };
const maskOp = (type, label, desc, args, fn) => defNode(type, { label, family: 'mask', desc, inputs: [IN_MASK], outputs: [OUT_MASK], args,
  async run(ctx, I, A) { const m = await I('mask'); if (!m) { ctx.warn('No input mask.'); return { mask: IMG.mask(ctx.w, ctx.h) }; } return { mask: fn(m, A, ctx) }; } });
defNode('maskFromAlpha', { label: 'Mask from Alpha', family: 'mask', desc: 'Takes an image\'s alpha as a mask.', inputs: [IN_IMG], outputs: [OUT_MASK],
  async run(ctx, I) { const im = await I('image'); if (!im) { ctx.warn('No input image.'); return { mask: IMG.mask(ctx.w, ctx.h) }; } return { mask: IMG.maskFromAlpha(im) }; } });
defNode('lumaKey', { label: 'Luma Key', family: 'mask', desc: 'Mask from luminance between two levels.', inputs: [IN_IMG], outputs: [OUT_MASK],
  args: [A_('lo', 'Low', 'number', 0.2, { min: 0, max: 1, step: 0.01 }), A_('hi', 'High', 'number', 0.8, { min: 0, max: 1, step: 0.01 }), A_('invert', 'Invert', 'bool', false)],
  async run(ctx, I, A) { const im = await I('image'); if (!im) { ctx.warn('No input image.'); return { mask: IMG.mask(ctx.w, ctx.h) }; } return { mask: IMG.lumaKey(im, A.lo, A.hi, A.invert) }; } });
defNode('colourKey', { label: 'Colour Key', family: 'mask', desc: 'Mask from pixels near a colour.', inputs: [IN_IMG], outputs: [OUT_MASK],
  args: [A_('colour', 'Key colour', 'colour', '#ffffff'), A_('tol', 'Tolerance', 'number', 0.1, { min: 0, max: 1.5, step: 0.01 }), A_('soft', 'Softness', 'number', 0.1, { min: 0.001, max: 1, step: 0.01 })],
  async run(ctx, I, A) { const im = await I('image'); if (!im) { ctx.warn('No input image.'); return { mask: IMG.mask(ctx.w, ctx.h) }; } return { mask: IMG.colourKey(im, A.colour, A.tol, A.soft) }; } });
maskOp('growShrink', 'Grow / Shrink', 'Dilates (positive) or erodes (negative) a mask by a distance.', [A_('px', 'Distance', 'number', 4, { min: -80, max: 80, px: true, unit: 'px' })], (m, A, ctx) => IMG.growShrink(m, px(A.px, ctx)));
maskOp('feather', 'Feather', 'Softens mask edges.', [A_('radius', 'Radius', 'number', 6, { min: 0, max: 120, px: true, unit: 'px' })], (m, A, ctx) => IMG.blur(m, px(A.radius, ctx)));
maskOp('invertMask', 'Invert Mask', 'One minus the mask.', [], m => IMG.invertMask(m));
defNode('maskCombine', { label: 'Mask Combine', family: 'mask', desc: 'Union, subtract, intersect or difference of two masks.', inputs: [{ n: 'a', k: 'mask', l: 'A' }, { n: 'b', k: 'mask', l: 'B' }], outputs: [OUT_MASK],
  args: [A_('op', 'Operation', 'select', 'union', { options: [['union', 'Union'], ['subtract', 'Subtract B from A'], ['intersect', 'Intersect'], ['difference', 'Difference'], ['add', 'Add']] })],
  async run(ctx, I, A) { const [a, b] = await Promise.all([I('a'), I('b')]); const r = IMG.maskCombine(a, b, A.op); if (!r) ctx.warn('Nothing connected.'); return { mask: r || IMG.mask(ctx.w, ctx.h) }; } });
defNode('fillMask', { label: 'Fill Mask', family: 'mask', desc: 'Fills a mask with a flat colour.', inputs: [IN_MASK], outputs: [OUT_IMG], args: [A_('colour', 'Colour', 'colour', '#3554d1')],
  async run(ctx, I, A) { const m = await I('mask'); if (!m) { ctx.warn('No input mask.'); return { image: blank(ctx) }; } return { image: IMG.maskToImage(m, A.colour) }; } });
defNode('hatch', { label: 'Hatch / Pattern Fill', family: 'mask', desc: 'Fills a mask with line hatch, cross hatch or dots.', inputs: [IN_MASK], outputs: [OUT_IMG],
  args: [A_('pattern', 'Pattern', 'select', 'lines', { options: [['lines', 'Lines'], ['cross', 'Cross hatch'], ['dots', 'Dots']] }), A_('angle', 'Angle', 'number', 45, { min: -180, max: 180, unit: '°' }),
    A_('spacing', 'Spacing', 'number', 12, { min: 2, max: 200, px: true, unit: 'px' }), A_('width', 'Line width', 'number', 1.5, { min: 0.25, max: 40, step: 0.25, px: true, unit: 'px' }),
    A_('colour', 'Colour', 'colour', '#6b7280'), A_('bg', 'Background', 'colour', '#ffffff00')],
  async run(ctx, I, A) { const m = await I('mask'); if (!m) { ctx.warn('No input mask.'); return { image: blank(ctx) }; } return { image: IMG.hatch(m, A.angle, px(A.spacing, ctx), px(A.width, ctx), A.colour, A.pattern, parseColour(A.bg)[3] > 0 ? A.bg : null) }; } });

// ---------------------------------------------------------------- generate
defNode('solid', { label: 'Solid', family: 'gen', desc: 'A flat background at canvas size.', outputs: [OUT_IMG], args: [A_('colour', 'Colour', 'colour', '#ffffff')],
  run(ctx, I, A) { return { image: IMG.solid(ctx.w, ctx.h, A.colour) }; } });
defNode('gradient', { label: 'Gradient', family: 'gen', desc: 'Linear or radial two-colour gradient.', outputs: [OUT_IMG],
  args: [A_('type', 'Type', 'select', 'linear', { options: [['linear', 'Linear'], ['radial', 'Radial']] }), A_('c1', 'Start', 'colour', '#f5f2ec'), A_('c2', 'End', 'colour', '#dfe5ec'),
    A_('angle', 'Angle', 'number', 90, { min: -180, max: 180, unit: '°', show: a => a.type === 'linear' }), A_('radius', 'Radius', 'number', 0.8, { min: 0.05, max: 2, step: 0.01, show: a => a.type === 'radial' })],
  run(ctx, I, A) { return { image: IMG.gradient(ctx.w, ctx.h, A.c1, A.c2, A.type, A.angle, 0.5, 0.5, A.radius) }; } });
defNode('imageLoad', { label: 'Image Load', family: 'gen', desc: 'Brings in a PNG, JPG, WebP or SVG (site photo, logo, title block).', outputs: [OUT_IMG, { n: 'mask', k: 'mask', l: 'Alpha' }],
  args: [A_('asset', 'Image', 'image', ''), A_('fit', 'Fit', 'select', 'fit', { options: [['fit', 'Fit inside canvas'], ['fill', 'Fill canvas'], ['stretch', 'Stretch'], ['original', 'Original size, centred']] }),
    A_('scale', 'Scale', 'number', 1, { min: 0.05, max: 4, step: 0.01 }), A_('dx', 'Move X', 'number', 0, { px: true, unit: 'px' }), A_('dy', 'Move Y', 'number', 0, { px: true, unit: 'px' })],
  async run(ctx, I, A) {
    if (!A.asset || !doc.assets || !doc.assets[A.asset]) { ctx.warn('Choose an image file.'); return { image: blank(ctx), mask: IMG.mask(ctx.w, ctx.h) }; }
    const img = await loadImageEl(doc.assets[A.asset].data);
    const im = IMG.draw(ctx.w, ctx.h, (g, w, h) => {
      let iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k;
      if (A.fit === 'stretch') { g.drawImage(img, px(A.dx, ctx), px(A.dy, ctx), w, h); return; }
      k = A.fit === 'fill' ? Math.max(w / iw, h / ih) : A.fit === 'fit' ? Math.min(w / iw, h / ih) : ctx.scale;
      k *= A.scale; const dw = iw * k, dh = ih * k;
      g.drawImage(img, (w - dw) / 2 + px(A.dx, ctx), (h - dh) / 2 + px(A.dy, ctx), dw, dh);
    });
    return { image: im, mask: IMG.maskFromAlpha(im) };
  } });
const imgElCache = new Map();
function loadImageEl(src) { if (imgElCache.has(src)) return imgElCache.get(src); const p = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not decode the image.')); i.src = src; }); imgElCache.set(src, p); return p; }
const FONT_STACK = { sans: '"Figtree", "Segoe UI", system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"JetBrains Mono", ui-monospace, monospace' };
defNode('text', { label: 'Text / Label', family: 'gen', desc: 'Rasterises text. Content can come from a String port and use tokens like {option}.', outputs: [OUT_IMG],
  args: [A_('text', 'Text', 'text', 'Site plan — {option}'), A_('font', 'Font', 'select', 'sans', { options: [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']] }),
    A_('size', 'Size', 'number', 64, { min: 4, max: 600, px: true, unit: 'px' }), A_('weight', 'Weight', 'select', '600', { options: [['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold']] }),
    A_('colour', 'Colour', 'colour', '#1c2026'), A_('x', 'X', 'number', 0.05, { min: 0, max: 1, step: 0.005, hint: 'Position as a fraction of the canvas.' }), A_('y', 'Y', 'number', 0.07, { min: 0, max: 1, step: 0.005 }),
    A_('align', 'Align', 'select', 'left', { options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] }), A_('tracking', 'Letter spacing', 'number', 0, { min: -0.1, max: 0.5, step: 0.005, unit: 'em' })],
  run(ctx, I, A) {
    return { image: IMG.draw(ctx.w, ctx.h, (g, w, h) => {
      const size = px(A.size, ctx); g.font = `${A.weight} ${size}px ${FONT_STACK[A.font] || FONT_STACK.sans}`; g.fillStyle = colourCss(A.colour); g.textAlign = A.align; g.textBaseline = 'top';
      if ('letterSpacing' in g) g.letterSpacing = (A.tracking * size) + 'px';
      String(A.text).split('\n').forEach((line, i) => g.fillText(line, A.x * w, A.y * h + i * size * 1.22));
    }) };
  } });
defNode('northPoint', { label: 'North Point & Scale', family: 'gen', desc: 'North arrow and a true scale bar measured through the Viewport camera.', inputs: [{ n: 'camera', k: 'camera', l: 'Camera' }], outputs: [OUT_IMG],
  args: [A_('x', 'X', 'number', 0.92, { min: 0, max: 1, step: 0.005 }), A_('y', 'Y', 'number', 0.86, { min: 0, max: 1, step: 0.005 }), A_('size', 'Size', 'number', 90, { min: 10, max: 600, px: true, unit: 'px' }),
    A_('colour', 'Colour', 'colour', '#1c2026'), A_('north', 'North rotation', 'number', 0, { min: -180, max: 180, unit: '°', hint: 'Added to the camera\'s own rotation when a camera is connected.' }),
    A_('bar', 'Scale bar', 'bool', true), A_('barLength', 'Bar length', 'number', 50, { unit: 'm', show: a => a.bar })],
  async run(ctx, I, A) {
    const cv = await I('camera'); let rot = A.north, ppm = null;
    if (cv) {
      const c = cv.cam, t = c.target, a = projectPoint(c, t), b = projectPoint(c, add3(t, [0, 10, 0]));
      if (a && b) rot += Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI;
      if (c.ortho) { const e = projectPoint(c, add3(t, [10, 0, 0])); ppm = e ? Math.hypot(e.x - a.x, e.y - a.y) / 10 * ctx.w / c.w : null; }
      else if (A.bar) ctx.warn('Scale bar hidden: perspective views have no single scale.');
    } else if (A.bar) ctx.warn('Connect a Camera for a true scale bar.');
    return { image: IMG.draw(ctx.w, ctx.h, (g, w, h) => {
      const s = px(A.size, ctx), x = A.x * w, y = A.y * h; g.fillStyle = g.strokeStyle = colourCss(A.colour); g.lineWidth = Math.max(1, s / 40);
      g.save(); g.translate(x, y); g.rotate(rot * Math.PI / 180);
      g.beginPath(); g.arc(0, 0, s * 0.42, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(0, -s * 0.5); g.lineTo(s * 0.17, s * 0.22); g.lineTo(0, s * 0.1); g.lineTo(-s * 0.17, s * 0.22); g.closePath(); g.fill();
      g.font = `700 ${s * 0.24}px ${FONT_STACK.sans}`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText('N', 0, -s * 0.52);
      g.restore();
      if (A.bar && ppm) {
        const L = A.barLength * ppm, bx = clamp(x - L / 2, s * 0.3, w - L - s * 0.5), by = y + s * 0.8, bh = Math.max(2, s / 14);
        for (let i = 0; i < 4; i++) { g.globalAlpha = i % 2 ? 0.25 : 1; g.fillRect(bx + i * L / 4, by, L / 4, bh); }
        g.globalAlpha = 1; g.lineWidth = Math.max(1, s / 60); g.strokeRect(bx, by, L, bh);
        g.font = `500 ${s * 0.16}px ${FONT_STACK.sans}`; g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillText('0', bx, by + bh * 1.6); g.fillText(`${+A.barLength.toFixed(1)} m`, bx + L, by + bh * 1.6);
      }
    }) };
  } });

// ---------------------------------------------------------------- points, decals, gradients
defNode('attractor', { label: 'Attractor', family: 'points', desc: 'A Field from distance to attractor points, in pixels or true 3D metres, remapped to an output range.',
  inputs: [{ n: 'points', k: 'points', l: 'Points2D' }, { n: 'attractors', k: 'points', l: 'Attractors' }], outputs: [{ n: 'field', k: 'field', l: 'Field' }],
  args: [A_('pick', 'Attractor points', 'string', 'main', { hint: 'Used when no Attractors input: point ids, or an attribute name that is truthy (e.g. <code>main</code>).' }),
    A_('units', 'Distance in', 'select', 'm', { options: [['m', 'Model metres (3D)'], ['px', 'Pixels']] }), A_('radius', 'Radius', 'number', 60, { min: 0.1 }),
    A_('falloff', 'Falloff', 'select', 'smooth', { options: [['linear', 'Linear'], ['smooth', 'Smooth'], ['exp', 'Exponential']] }),
    A_('outMin', 'Far value', 'number', 0.6, { step: 0.01 }), A_('outMax', 'Near value', 'number', 1.6, { step: 0.01 }),
    A_('combine', 'Combine', 'select', 'nearest', { options: [['nearest', 'Nearest'], ['max', 'Max'], ['sum', 'Sum']] })],
  async run(ctx, I, A) {
    const [P, Q] = await Promise.all([I('points'), I('attractors')]); if (!P) { ctx.warn('Connect Points2D.'); return { field: { kind: 'field', values: [] } }; }
    const keys = A.pick.split(',').map(s => s.trim()).filter(Boolean);
    const att = Q ? Q.pts : P.pts.filter(p => keys.includes(p.id) || keys.some(k => p.attrs && p.attrs[k]));
    if (!att.length) ctx.warn('No attractor points found.');
    const fall = t => A.falloff === 'linear' ? t : A.falloff === 'exp' ? Math.exp(-3 * (1 - t)) * t : t * t * (3 - 2 * t);
    const values = P.pts.map(p => {
      let f = A.combine === 'nearest' ? null : 0;
      for (const q of att) {
        const d = A.units === 'm' && p.p3 && q.p3 ? len3(sub3(p.p3, q.p3)) : Math.hypot(p.x - q.x, p.y - q.y) / ctx.scale;
        const v = fall(clamp(1 - d / A.radius));
        if (A.combine === 'nearest') { if (f == null || d < f.d) f = { d, v }; } else if (A.combine === 'max') f = Math.max(f, v); else f += v;
      }
      const t = A.combine === 'nearest' ? (f ? f.v : 0) : A.combine === 'sum' ? clamp(f) : f;
      return lerp(A.outMin, A.outMax, t);
    });
    return { field: { kind: 'field', values, ids: P.pts.map(p => p.id) } };
  } });
defNode('attributeField', { label: 'Attribute Field', family: 'points', desc: 'Turns a point attribute (area, height, levels) into a Field.',
  inputs: [{ n: 'points', k: 'points', l: 'Points2D' }], outputs: [{ n: 'field', k: 'field', l: 'Field' }],
  args: [A_('attr', 'Attribute', 'string', 'levels'), A_('outMin', 'Lowest maps to', 'number', 0.7, { step: 0.01 }), A_('outMax', 'Highest maps to', 'number', 1.5, { step: 0.01 })],
  async run(ctx, I, A) {
    const P = await I('points'); if (!P) { ctx.warn('Connect Points2D.'); return { field: { kind: 'field', values: [] } }; }
    const raw = P.pts.map(p => +(p.attrs || {})[A.attr]); const ok = raw.filter(isFinite);
    if (!ok.length) ctx.warn(`No points carry "${A.attr}".`);
    const mn = Math.min(...ok), mx = Math.max(...ok);
    return { field: { kind: 'field', values: raw.map(v => isFinite(v) ? lerp(A.outMin, A.outMax, mx > mn ? (v - mn) / (mx - mn) : 0.5) : A.outMin), ids: P.pts.map(p => p.id) } };
  } });
defNode('decalScatter', { label: 'Decal Scatter', family: 'points', desc: 'Places an icon at every point: scaled by a Field or depth, rotated by projected vectors.',
  inputs: [{ n: 'points', k: 'points', l: 'Points2D' }, { n: 'icon', k: 'image', l: 'Icon' }, { n: 'field', k: 'field', l: 'Scale field' }], outputs: [OUT_IMG, OUT_MASK],
  args: [A_('size', 'Size', 'number', 64, { min: 4, max: 800, px: true, unit: 'px' }), A_('scaleBy', 'Scale by', 'select', 'field', { options: [['constant', 'Constant'], ['field', 'Field (when connected)'], ['depth', 'Depth (perspective)']] }),
    A_('rotateBy', 'Rotation', 'select', 'vector', { options: [['upright', 'Upright'], ['vector', 'Projected direction'], ['constant', 'Constant']] }), A_('rotation', 'Angle', 'number', 0, { min: -180, max: 180, unit: '°' }),
    A_('anchor', 'Anchor', 'select', 'centre', { options: [['centre', 'Centre'], ['bottom', 'Bottom']] }), A_('hideOccluded', 'Hide occluded', 'bool', true),
    A_('spacing', 'Min spacing', 'number', 0, { min: 0, max: 400, px: true, unit: 'px' }), A_('colour', 'Marker colour', 'colour', '#cf3f3f'), A_('tint', 'Tint icon', 'number', 0, { min: 0, max: 100, unit: '%' }),
    A_('opacity', 'Opacity', 'number', 100, { min: 0, max: 100, unit: '%' }), A_('labels', 'Label with point names', 'bool', true, { section: 'Labels', hint: 'Each decal is labelled with the name its point has in the 3D model.' }),
    A_('labelText', 'Label text', 'string', '{name}', { noTokens: true, show: a => a.labels, hint: '<code>{name}</code> is the point\'s name, <code>{n}</code> its number. E.g. <code>Entrance {n}: {name}</code>.' }),
    A_('labelSize', 'Text size', 'number', 24, { px: true, unit: 'px', show: a => a.labels }),
    A_('labelScale', 'Text scale', 'number', 1, { min: 0.1, max: 10, step: 0.05, unit: '×', show: a => a.labels }),
    A_('labelScaleWithDecal', 'Scale text with the decal', 'bool', false, { show: a => a.labels, hint: 'Follows the Field or depth scaling of each decal.' }),
    A_('labelDx', 'Offset X', 'number', 0, { px: true, unit: 'px', show: a => a.labels, hint: 'From the decal\'s centre.' }),
    A_('labelDy', 'Offset Y', 'number', 40, { px: true, unit: 'px', show: a => a.labels, hint: 'From the decal\'s centre; positive is down.' }),
    A_('labelRotation', 'Text rotation', 'number', 0, { min: -180, max: 180, unit: '°', show: a => a.labels }),
    A_('labelFollow', 'Turn with the decal', 'bool', false, { show: a => a.labels, hint: 'The offset and the text turn with each decal\'s rotation.' }),
    A_('labelAlign', 'Align', 'select', 'center', { show: a => a.labels, options: [['center', 'Centred on the offset'], ['left', 'Starting at the offset'], ['right', 'Ending at the offset']] }),
    A_('labelHalo', 'White halo', 'bool', true, { show: a => a.labels })],
  async run(ctx, I, A) {
    const [P, icon, F] = await Promise.all([I('points'), I('icon'), I('field')]);
    if (!P) { ctx.warn('Connect Points2D.'); return { image: blank(ctx), mask: IMG.mask(ctx.w, ctx.h) }; }
    let iconCv = null; if (icon) { let ic = icon; if (A.tint > 0) ic = IMG.overlayColour(ic, A.colour, A.tint / 100); iconCv = IMG.toCanvas(ic); }
    const sx = ctx.w / P.w, sy = ctx.h / P.h, depths = P.pts.map(p => p.depth).sort((a, b) => a - b), ref = depths[Math.floor(depths.length / 2)] || 1;
    const placed = [];
    const im = IMG.draw(ctx.w, ctx.h, g => {
      g.globalAlpha = A.opacity / 100;
      P.pts.forEach((p, i) => {
        if (A.hideOccluded && !p.visible) return;
        const x = p.x * sx, y = p.y * sy;
        if (A.spacing > 0 && placed.some(q => Math.hypot(q[0] - x, q[1] - y) < px(A.spacing, ctx))) return;
        placed.push([x, y]);
        let k = 1; if (A.scaleBy === 'field' && F && F.values[i] != null) k = F.values[i]; else if (A.scaleBy === 'depth') k = ref / Math.max(1e-3, p.depth);
        const s = px(A.size, ctx) * k;
        let rot = A.rotateBy === 'constant' ? A.rotation : A.rotateBy === 'vector' && p.angle != null ? p.angle + 90 + A.rotation : 0;
        g.save(); g.translate(x, y); g.rotate(rot * Math.PI / 180);
        const oy = A.anchor === 'bottom' ? -s / 2 : 0;
        if (iconCv) { const ar = iconCv.width / iconCv.height; g.drawImage(iconCv, -s * ar / 2, -s / 2 + oy, s * ar, s); }
        else { // built-in entrance marker: disc with an inward arrow
          g.fillStyle = colourCss(A.colour); g.beginPath(); g.arc(0, oy, s * 0.36, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(0, oy - s * 0.2); g.lineTo(s * 0.16, oy + s * 0.06); g.lineTo(s * 0.06, oy + s * 0.06); g.lineTo(s * 0.06, oy + s * 0.2); g.lineTo(-s * 0.06, oy + s * 0.2); g.lineTo(-s * 0.06, oy + s * 0.06); g.lineTo(-s * 0.16, oy + s * 0.06); g.closePath(); g.fill();
        }
        g.restore();
        const name = p.attrs && p.attrs.name;
        if (A.labels && name) {
          const text = String(A.labelText == null ? '{name}' : A.labelText).replace(/\{name\}/g, name).replace(/\{n\}/g, String(i + 1)).replace(/\{id\}/g, p.id || '');
          const fs = px(A.labelSize, ctx) * (+A.labelScale || 1) * (A.labelScaleWithDecal ? k : 1);
          if (text && fs > 0.5) {
            g.save(); g.translate(x, y); if (A.labelFollow) g.rotate(rot * Math.PI / 180);
            g.translate(px(A.labelDx || 0, ctx), px(A.labelDy == null ? 40 : A.labelDy, ctx)); g.rotate((+A.labelRotation || 0) * Math.PI / 180);
            g.font = `600 ${fs}px ${FONT_STACK.sans}`; g.textAlign = A.labelAlign || 'center'; g.textBaseline = 'middle';
            if (A.labelHalo !== false) { g.lineWidth = fs / 4; g.lineJoin = 'round'; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(text, 0, 0); }
            g.fillStyle = colourCss(A.colour); g.fillText(text, 0, 0); g.restore();
          }
        }
      });
    });
    return { image: im, mask: IMG.maskFromAlpha(im) };
  } });
defNode('pointGradient', { label: 'Point Gradient', family: 'points', desc: 'Radial gradients from points. In metres with a Camera it measures true 3D distance from the depth pass, so fades spread correctly in perspective.',
  inputs: [{ n: 'points', k: 'points', l: 'Points2D' }, { n: 'camera', k: 'camera', l: 'Camera' }, { n: 'field', k: 'field', l: 'Radius field' }], outputs: [OUT_IMG, OUT_MASK],
  args: [A_('units', 'Fall-off in', 'select', 'm', { options: [['m', 'Model metres (3D, needs Camera)'], ['px', 'Pixels']] }), A_('radius', 'Fall-off', 'number', 20, { min: 0.1 }),
    A_('inner', 'Inner colour', 'colour', '#ff8a3d'), A_('outer', 'Outer colour', 'colour', '#ff8a3d00'),
    A_('curve', 'Curve', 'select', 'smooth', { options: [['linear', 'Linear'], ['smooth', 'Smooth'], ['exp', 'Exponential']] }), A_('onlyVisible', 'Visible points only', 'bool', false)],
  async run(ctx, I, A) {
    const [P, cv, F] = await Promise.all([I('points'), I('camera'), I('field')]); const W = ctx.w, H = ctx.h;
    const im = IMG.image(W, H), mask = IMG.mask(W, H);
    if (!P) { ctx.warn('Connect Points2D.'); return { image: im, mask }; }
    const pts = P.pts.filter(p => !A.onlyVisible || p.visible), ci = parseColour(A.inner), co = parseColour(A.outer);
    const curve = t => A.curve === 'linear' ? t : A.curve === 'exp' ? (Math.exp(3 * t) - 1) / (Math.exp(3) - 1) : t * t * (3 - 2 * t);
    const R = i => A.radius * (F && F.values[i] != null ? F.values[i] : 1);
    let world = null;
    if (A.units === 'm') {
      if (!cv) ctx.warn('Metre fall-off needs a Camera input; using pixels.');
      else world = worldFromDepth(cv, W, H);
    }
    const sx = W / P.w, sy = H / P.h;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x; let best = 0;
      if (world) { const wx = world[p * 3]; if (!isFinite(wx)) continue; const wy = world[p * 3 + 1], wz = world[p * 3 + 2];
        pts.forEach((q, i) => { const d = Math.hypot(wx - q.p3[0], wy - q.p3[1], wz - q.p3[2]); best = Math.max(best, clamp(1 - d / R(i))); }); }
      else pts.forEach((q, i) => { const d = Math.hypot(x - q.x * sx, y - q.y * sy) / ctx.scale; best = Math.max(best, clamp(1 - d / R(i))); });
      if (best <= 0) continue;
      const t = curve(best); mask.d[p] = t;
      const a = lerp(co[3], ci[3], t), o = p * 4;
      im.d[o] = lerp(co[0], ci[0], t) * a; im.d[o + 1] = lerp(co[1], ci[1], t) * a; im.d[o + 2] = lerp(co[2], ci[2], t) * a; im.d[o + 3] = a;
    }
    return { image: im, mask };
  } });
// World position pass reconstructed from linear depth.
function worldFromDepth(cv, W, H) {
  const c = cv.cam, depth = cv.depth(), out = new Float32Array(W * H * 3).fill(NaN);
  const V = c.V, right = [V[0], V[4], V[8]], up = [V[1], V[5], V[9]], fwd = scale3([V[2], V[6], V[10]], -1);
  const sx = c.w / W, sy = c.h / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = Math.min(c.w - 1, Math.floor((x + 0.5) * sx)), Y = Math.min(c.h - 1, Math.floor((y + 0.5) * sy)), z = depth[Y * c.w + X];
    if (!isFinite(z)) continue;
    const nx = ((x + 0.5) / W) * 2 - 1, ny = 1 - ((y + 0.5) / H) * 2; let p;
    if (c.ortho) { const hs = (c.def.span || 200) / 2, ws = hs * c.w / c.h; p = add3(add3(add3(c.eye, scale3(right, nx * ws)), scale3(up, ny * hs)), scale3(fwd, z)); }
    else { const t = Math.tan(c.fov * Math.PI / 360), a = c.w / c.h; const dir = add3(add3(fwd, scale3(right, nx * t * a)), scale3(up, ny * t)); p = add3(c.eye, scale3(dir, z)); }
    const o = (y * W + x) * 3; out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2];
  }
  return out;
}
defNode('pointsExport', { label: 'Points Export', family: 'points', desc: 'Writes Points2D as CSV or JSON for Illustrator or InDesign.', inputs: [{ n: 'points', k: 'points', l: 'Points2D' }], outputs: [{ n: 'points', k: 'points', l: 'Points2D' }],
  args: [A_('format', 'Format', 'select', 'csv', { options: [['csv', 'CSV'], ['json', 'JSON']] }), A_('filename', 'File name', 'string', '{project}_{option}_points'), A_('export', 'Export now', 'button', null, { action: 'exportPoints' })],
  async run(ctx, I) { const P = await I('points'); if (!P) ctx.warn('Connect Points2D.'); return { points: P }; } });

// ---------------------------------------------------------------- AI
const NANO_PRESETS = ['Turn this into a soft watercolour illustration, keep every line and building outline exactly where it is',
  'Add people walking and street trees, keep the buildings and linework unchanged',
  'Make it a warm late-afternoon photoreal render with long shadows, same camera and composition',
  'Redraw as a clean architectural ink drawing on white paper',
  'Add lush planting and grass on the ground plane only'];
function nanoRefPorts(n) { const c = clampI(Math.round(+(n && n.args && n.args.refCount) || 1), 1, 6); return Array.from({ length: c }, (_, i) => i ? 'ref' + (i + 1) : 'ref'); }
defNode('nanoBanana', { label: 'Nano Banana', family: 'ai', desc: 'Gemini image model: give it an image, type what you want done to it, press Run. Wire a picture into Style ref to restyle the image in that picture\'s look (no prompt needed). The result is kept with the graph and only re-runs when you ask.',
  // Style refs: the first keeps its old port name ('ref') so saved graphs stay wired.
  inputs: n => [{ n: 'image', k: 'image', l: 'Image' }, ...nanoRefPorts(n).map((p, i, all) => ({ n: p, k: 'image', l: all.length > 1 ? 'Style ref ' + (i + 1) : 'Style ref' })), { n: 'mask', k: 'mask', l: 'Mask' }, { n: 'prompt', k: 'string', l: 'Prompt' }], outputs: [OUT_IMG],
  args: [A_('prompt', 'Prompt', 'text', '', { hint: 'What you want, in plain words. Type it here or on the node. A Text Value wired into the Prompt input is added in front. Optional when Style refs are connected.' }),
    A_('negative', 'Avoid (negative prompt)', 'text', '', { hint: 'What Gemini must not do or add, e.g. no people, no text, no change to the linework.' }),
    A_('refCount', 'Style refs', 'int', 1, { min: 1, max: 6, hint: 'How many Style ref inputs the node has. Several references are read as one shared style.' }), A_('refMode', 'Style ref use', 'select', 'style', { options: [['style', 'Style only: redraw the image in its look'], ['elements', 'Style and elements: may borrow textures, people, planting'], ['free', 'Just send both images']], hint: 'How the image on the Style ref input is used. Style only keeps the Image input\'s composition and copies nothing from the reference\'s content.' }),
    A_('model', 'Model', 'string', 'gemini-2.5-flash-image'),
    A_('seed', 'Seed', 'int', 1, { min: 0, max: 999999 }),
    A_('auto', 'Auto-run on change', 'bool', false, { hint: 'Also generate in the preview whenever the inputs change. Off by default: each run costs money.' }),
    A_('run', 'Run', 'button', null, { action: 'runNanoBanana' })],
  async run(ctx, I, A, node, want, g) {
    const [im, m] = await Promise.all([I('image'), I('mask')]);
    const base = im ? IMG.fit(im, ctx.w, ctx.h) : blank(ctx);
    const key = nanoKeyFor(g, node, A, ctx, ctx._scope);
    let hit = nanoHit(node, key);
    if (nanoWantsRun(node, A, key, ctx)) {
      const [refs, pin] = await Promise.all([Promise.all(nanoRefPorts(node).map(p => I(p))).then(a => a.filter(Boolean)), I('prompt')]);
      const prompt = [pin, A.prompt].map(x => (x == null ? '' : String(x)).trim()).filter(Boolean).join('\n');
      if (!prompt && !(im && refs.length && A.refMode !== 'free')) ctx.warn('No prompt: type what Gemini should do with the image, or connect a Style ref.');
      else {
        try { hit = await nanoGenerateAndKeep(node, key, { prompt, negative: A.negative, im, refs, model: A.model, seed: A.seed, refMode: A.refMode }); }
        catch (e) { const msg = nanoErrorText(e); node._runError = msg; ctx.warn(msg); ctx.fail = true; }
      }
    } else if (node._runError && !hit) { ctx.warn(node._runError); ctx.fail = true; }
    let asset = hit ? hit.asset : null;
    if (!asset) {
      const last = node.args.result && doc.assets && doc.assets[node.args.result] ? node.args.result : null;
      if (!last) { if (!ctx.fail) ctx.warn('Not run yet. Press Run, or Render all to generate one result per file; the input passes through until then.'); return { image: base }; }
      ctx.warn('No result for these inputs yet: showing the last one. Render all (or Run) generates it.'); asset = last;
    }
    const el = await loadImageEl(doc.assets[asset].data);
    // Keep the result's own proportion: cover the frame rather than stretch it.
    let out = IMG.draw(ctx.w, ctx.h, (gg, w, h) => { const k = Math.max(w / el.naturalWidth, h / el.naturalHeight), dw = el.naturalWidth * k, dh = el.naturalHeight * k; gg.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh); });
    if (m) out = IMG.merge(IMG.setAlpha(out, m), base, 'normal', 1);
    return { image: out };
  } });

defNode('reversePrompt', { label: 'Reverse Prompt', family: 'ai', desc: 'Gemini reads an image and writes the prompt for it. Wire the Prompt output into a Nano Banana\'s Prompt input to give another image that look. Runs when you press Run; the text is kept and you can edit it.',
  inputs: [{ n: 'image', k: 'image', l: 'Image' }], outputs: [{ n: 'prompt', k: 'string', l: 'Prompt' }],
  args: [A_('focus', 'Describe', 'select', 'style', { options: [['style', 'Style only (for restyling another image)'], ['styleContent', 'Style and how things are drawn'], ['full', 'Everything (to recreate this image)']] }),
    A_('words', 'Length', 'int', 120, { min: 30, max: 400, step: 10, unit: 'words' }),
    A_('extra', 'Also ask', 'text', '', { noTokens: true, hint: 'Optional, e.g. "mention it is an architectural axonometric".' }),
    A_('model', 'Model', 'string', 'gemini-2.5-flash'),
    A_('text', 'Prompt', 'text', '', { noTokens: true, hint: 'Written by Run. Edit it freely; Run again replaces it.' }),
    A_('run', 'Run', 'button', null, { action: 'runReversePrompt' })],
  run(ctx, I, A, node, want, g) {
    if (node._runError) ctx.warn(node._runError);
    if (!A.text) { ctx.warn('Press Run to have Gemini write a prompt from the image.'); return { prompt: '' }; }
    if (node.inputs.image && node.args.textKey && node.args.textKey !== nanoInputHash(g, node, 'image', ctx, ctx._scope)) ctx.warn('The image changed since this prompt was written. Run again to update it.');
    return { prompt: A.text };
  } });

// ---------------------------------------------------------------- organisation
defNode('switch', { label: 'Switch', family: 'org', desc: 'Chooses one input by index (0-based) or by the name of the upstream node.',
  inputs: n => { const c = Math.max(2, Math.round(+n.args.count || 3)); const a = []; for (let i = 0; i < c; i++) a.push({ n: 'in' + i, k: 'image', l: 'Input ' + i }); return a; }, outputs: [OUT_IMG],
  args: [A_('count', 'Inputs', 'int', 3, { min: 2, max: 12 }), A_('which', 'Choose', 'string', '0', { hint: 'An index, or a token such as <code>{option}</code> matched against upstream node names.' })],
  async run(ctx, I, A, node, want, g) {
    const c = Math.max(2, Math.round(A.count)); let idx = parseInt(A.which, 10);
    if (!isFinite(idx)) { idx = -1; for (let i = 0; i < c; i++) { const s = node.inputs['in' + i]; const up = s && g.nodes[s.node]; if (up && (up.name || '').toLowerCase().includes(String(A.which).toLowerCase())) { idx = i; break; } } }
    if (idx < 0 || idx >= c) { ctx.warn(`No input matches "${A.which}".`); return { image: blank(ctx) }; }
    const im = await I('in' + idx); if (!im) ctx.warn(`Input ${idx} is empty.`); return { image: im || blank(ctx) };
  } });
defNode('dot', { label: 'Dot', family: 'org', desc: 'Reroutes a wire.', inputs: [{ n: 'in', k: 'any', l: '' }], outputs: [{ n: 'out', k: 'any', l: '' }], compact: true,
  async run(ctx, I) { return { out: await I('in') }; } });
defNode('value', { label: 'Value', family: 'org', desc: 'A number that can drive many nodes. Other fields can use its name in expressions.', outputs: [{ n: 'out', k: 'number', l: 'Number' }],
  args: [A_('name', 'Name', 'string', 'opacity_base', { noTokens: true }), A_('value', 'Value', 'number', 60)], run(ctx, I, A) { return { out: A.value }; } });
defNode('string', { label: 'Text Value', family: 'org', desc: 'A string for prompts and file names; tokens are filled per row.', outputs: [{ n: 'out', k: 'string', l: 'String' }],
  args: [A_('text', 'Text', 'text', '{option}')], run(ctx, I, A) { return { out: A.text }; } });
defNode('colourValue', { label: 'Colour', family: 'org', desc: 'A colour constant shared across nodes.', outputs: [{ n: 'out', k: 'colour', l: 'Colour' }],
  args: [A_('colour', 'Colour', 'colour', '#e2553b')], run(ctx, I, A) { return { out: A.colour }; } });
defNode('permutation', { label: 'Permutation', family: 'org', desc: 'Every combination of lists (options × cameras × styles…). Downstream tokens like {option} take each row\'s values.',
  outputs: [{ n: 'rows', k: 'perm', l: 'Rows' }],
  args: [A_('lists', 'Lists', 'text', 'option = option1, option2, option3, option4\ncamera = camera1', { noTokens: true, hint: 'One list per line: <code>name = a, b, c</code>. Sets like <code>{option1,option2}</code> also work.' }),
    A_('pick', 'Rows to keep', 'string', '', { noTokens: true, hint: 'Blank keeps all. Otherwise 1-based rows, e.g. <code>1,3-4</code>.' })],
  run(ctx, I, A) { return { rows: permRows(A) }; } });
function permRows(A) {
  const lists = [];
  for (const line of String(A.lists).split('\n')) { const m = line.match(/^\s*([a-zA-Z_]\w*)\s*=\s*(.+)$/); if (!m) continue; const vals = m[2].replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(Boolean); if (vals.length) lists.push([m[1], vals]); }
  let rows = [{}];
  for (const [k, vals] of lists) { const next = []; for (const r of rows) for (const v of vals) next.push({ ...r, [k]: v }); rows = next; }
  if (String(A.pick || '').trim()) { const keep = new Set(); for (const part of String(A.pick).split(',')) { const m = part.trim().match(/^(\d+)(?:-(\d+))?$/); if (m) for (let i = +m[1]; i <= +(m[2] || m[1]); i++) keep.add(i - 1); } rows = rows.filter((_, i) => keep.has(i)); }
  return { kind: 'perm', keys: lists.map(l => l[0]), rows };
}
defNode('group', { label: 'Group', family: 'org', desc: 'A sub-graph shown as one node. Its definition is shared by reference: edit it once and every instance updates.',
  inputs: n => groupPorts(n).inputs, outputs: n => groupPorts(n).outputs, args: [],
  run() { return {}; } });
defNode('groupInput', { label: 'Group Input', family: 'org', desc: 'Exposes an input on the group node.', outputs: [{ n: 'out', k: 'any', l: 'Value' }],
  args: [A_('name', 'Name', 'string', 'Image', { noTokens: true }), A_('kind', 'Kind', 'select', 'image', { options: KINDS.filter(k => k !== 'any').map(k => [k, KIND_LABEL[k]]) })], run() { return {}; } });
defNode('groupOutput', { label: 'Group Output', family: 'org', desc: 'Exposes an output on the group node.', inputs: [{ n: 'in', k: 'any', l: 'Value' }],
  args: [A_('name', 'Name', 'string', 'Image', { noTokens: true })], run() { return {}; } });
defNode('backdrop', { label: 'Backdrop', family: 'org', desc: 'A coloured, labelled frame. No effect on output.', args: [A_('label', 'Label', 'string', 'Notes', { noTokens: true }), A_('colour', 'Colour', 'colour', '#3554d1')], isBackdrop: true });
function groupPorts(n) {
  const def = doc && doc.defs[n.args.def]; if (!def) return { inputs: [], outputs: [] };
  const list = t => Object.values(def.nodes).filter(x => x.type === t).sort((a, b) => a.y - b.y || a.x - b.x);
  return { inputs: list('groupInput').map(x => ({ n: 'i_' + x.id, k: x.args.kind || 'image', l: x.args.name || 'In' })),
    outputs: list('groupOutput').map(x => ({ n: 'o_' + x.id, k: resolveKindIn(def, x.id, 'in') || 'any', l: x.args.name || 'Out' })) };
}

// ---------------------------------------------------------------- output
defNode('save', { label: 'Save', family: 'output', desc: 'A live link to a file: whenever its image changes it is written again under the same name.',
  inputs: [IN_IMG, { n: 'rows', k: 'perm', l: 'Rows' }], outputs: [],
  args: [A_('diagram', 'Diagram', 'string', 'site-plan', { noTokens: true }), A_('pattern', 'File name', 'string', '{project}_{option}_{diagram}_{camera}_{style}_v{version:02}', { noTokens: true, hint: 'Tokens: <code>{project} {diagram} {camera} {geoset} {style} {model} {version:02} {date} {row}</code>, any Permutation list name, and any field of an upstream node by its name. <code>{camera}</code> is the camera picked in the Extract Camera feeding this image.' }),
    A_('version', 'Version', 'int', 1, { min: 0, max: 999 }), A_('format', 'Format', 'select', 'png', { options: [['png', 'PNG (alpha)'], ['jpg', 'JPG'], ['webp', 'WebP']] }),
    A_('scale', 'Scale ×', 'number', 0, { min: 0, max: 16, step: 0.25, hint: 'Multiplier of the resolution, like Rhino\'s capture scale. 0 uses the Extract Camera\'s scale, else the graph\'s Output scale.' }),
    A_('quality', 'Quality', 'number', 0.92, { min: 0.3, max: 1, step: 0.01, show: a => a.format !== 'png' }), A_('auto', 'Write on change', 'bool', true),
    A_('folder', 'Also write to folder', 'bool', true, { hint: 'When a local folder is connected in Files.' })],
  async run(ctx, I) { const im = await I('image'); if (!im) ctx.warn('Nothing to save: connect an image.'); return {}; } });
