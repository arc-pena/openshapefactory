// =====================================================================
// Worked example from the brief: a site plan built from Viewport layers,
// graphic treatments, a layer stack, entrance decals and a Save that
// writes one file per design option.
// =====================================================================
function sampleDoc() {
  const d = newDoc(); d.name = 'Site plan'; d.models = { samplecap: ocafSampleRef('samplecap', 'Cap'), wideflange: ocafSampleRef('wideflange', 'Wide flange columns'), sample: { kind: 'builtin', name: 'Competition sample', params: {} } };
  d.settings.width = 2000; d.settings.height = 1500; d.settings.preview = 0.4;
  const prevDoc = doc; doc = d; // createNode reads catalogue defaults only; groupPorts reads doc
  const add = (type, x, y, name, args = {}, extra = {}) => { if (type === 'viewport') args = { option: '{option}', ...args }; const n = createNode(type, x, y, { args, ...extra }); n.name = name; d.nodes[n.id] = n; return n; };
  const wire = (from, port, to, inPort) => { to.inputs[inPort] = { node: from.id, port }; };
  // Model -> Extract -> Render, from an ocaf parametric model
  add('backdrop', -40, -1260, '', { label: 'Model → Render (ocaf parametric model)', colour: '#1f3fa8' }, { w: 1240, h: 1110 });
  const mdl = add('modelSource', 0, -1180, 'Model', { model: 'samplecap' });
  const exG = add('extractGeoset', 340, -1180, 'Geoset', { geoset: 'cap' }); wire(mdl, 'model', exG, 'model');
  const exC = add('extractCamera', 340, -900, 'Camera', { camera: 'Aerial' }); wire(mdl, 'model', exC, 'model');
  const rnd = add('render', 620, -1180, 'Render', { style: 'shaded', colourBy: 'model', ambient: 0.55 }); wire(mdl, 'model', rnd, 'model'); wire(exC, 'camera', rnd, 'camera'); wire(exG, 'geoset', rnd, 'geoset');
  const rndL = add('render', 620, -700, 'Render · linework', { style: 'hiddenline', lineWeight: 1.6, crease: 40 }); wire(mdl, 'model', rndL, 'model'); wire(exC, 'camera', rndL, 'camera');
  const bg = add('solid', 900, -1180, 'Paper', { colour: '#f6f4ef' });
  const m1 = add('merge', 900, -940, 'Object over paper', {}); wire(rnd, 'image', m1, 'a'); wire(bg, 'image', m1, 'b');
  const m2 = add('merge', 900, -700, 'Linework', { mode: 'multiply' }); wire(rndL, 'image', m2, 'a'); wire(m1, 'image', m2, 'b');
  const m3 = add('merge', 900, -460, 'Safe frame', { opacity: 70 }); wire(rnd, 'guides', m3, 'a'); wire(m2, 'image', m3, 'b');
  // backdrops
  add('backdrop', -40, -70, '', { label: 'Context', colour: '#6b7280' }, { w: 560, h: 830 });
  add('backdrop', -40, 800, '', { label: 'Proposal · {option}', colour: '#cf3f3f' }, { w: 560, h: 830 });
  add('backdrop', -40, 1670, '', { label: 'Annotation', colour: '#dd6f2e' }, { w: 1080, h: 330 });
  add('backdrop', 1290, 300, '', { label: 'Output', colour: '#2b9a62' }, { w: 560, h: 640 });
  // context
  const vpG = add('viewport', 0, 0, 'Ground & roads', { path: 'context/ground, context/roads, site/parcel @ camera1 : arctic', aoStrength: 0.9 });
  const vpS = add('viewport', 0, 270, 'Sun shadows', { path: 'context/ground, context/roads, site/parcel @ camera1 : shadows', sunAzimuth: 200, sunAltitude: 34 });
  const vpA = add('viewport', 0, 530, 'Context buildings', { path: 'context/buildings, context/trees @ camera1 : arctic' });
  const fillS = add('fillMask', 280, 270, 'Shadow tone', { colour: '#2d3442' }); wire(vpS, 'shadow', fillS, 'mask');
  // group definition: Existing context – grey (a reusable graphic standard)
  const def = { id: 'd_context_grey', name: 'Existing context – grey', nodes: {} };
  const gi = createNode('groupInput', 0, 0); gi.args = { name: 'Image', kind: 'image' };
  const gco = createNode('colourOverlay', 240, 0); gco.args.colour = '#c3c7ce'; gco.args.amount = 65; gco.name = 'Grey';
  const gop = createNode('opacity', 480, 0); gop.args.opacity = 92; gop.name = 'Opacity';
  const go = createNode('groupOutput', 720, 0); go.args = { name: 'Image' };
  gco.inputs.image = { node: gi.id, port: 'out' }; gop.inputs.image = { node: gco.id, port: 'image' }; go.inputs.in = { node: gop.id, port: 'image' };
  for (const n of [gi, gco, gop, go]) def.nodes[n.id] = n;
  d.defs[def.id] = def;
  const grp = add('group', 280, 530, 'Existing context – grey', { def: def.id }); grp.inputs['i_' + gi.id] = { node: vpA.id, port: 'image' };
  // proposal
  const vpB = add('viewport', 0, 870, 'Proposal massing', { path: '{option} @ camera1 : flat', colour: '#e2553b', tones: 0, ambient: 0.55 });
  const vpL = add('viewport', 0, 1140, 'Linework', { path: '{option}, context/buildings @ camera1 : hiddenline', lineWeight: 1.6, lineColour: '#2a2f38' });
  const vpLand = add('viewport', 0, 1400, 'Landscape mask', { path: '{option}/landscape @ camera1 : shaded' });
  const stroke = add('stroke', 280, 870, 'Outline', { width: 2.5, colour: '#1c2026' }); wire(vpB, 'image', stroke, 'image');
  const hatch = add('hatch', 280, 1400, 'Planting hatch', { colour: '#3f8a4e', spacing: 9, width: 1.6, angle: 45, bg: '#d9ead3' }); wire(vpLand, 'mask', hatch, 'mask');
  // annotation
  const pp = add('pointProject', 0, 1730, 'Entrances', { geoset: '{option}/entrances' }); wire(vpB, 'camera', pp, 'camera');
  const att = add('attractor', 270, 1730, 'Main entrance emphasis', { pick: 'main', radius: 30, outMin: 0.8, outMax: 1.35 }); wire(pp, 'points', att, 'points');
  const dec = add('decalScatter', 540, 1730, 'Entrance icons', { size: 54, colour: '#cf3f3f', labelSize: 22 }); wire(pp, 'points', dec, 'points'); wire(att, 'field', dec, 'field');
  const north = add('northPoint', 810, 1730, 'North & scale', { x: 0.92, y: 0.84, size: 84, barLength: 50 }); wire(vpA, 'camera', north, 'camera');
  const title = add('text', 810, 1450, 'Title', { text: '{project} · Site plan\n{option}', size: 58, x: 0.045, y: 0.06 });
  // stack
  const rows = [
    newRow({ id: 'paper', name: 'Paper' }), newRow({ id: 'ground', name: 'Ground', blend: 'normal' }), newRow({ id: 'shadow', name: 'Shadows', blend: 'multiply', opacity: 32 }),
    newRow({ id: 'plant', name: 'Planting', blend: 'multiply' }), newRow({ id: 'ctx', name: 'Context' }), newRow({ id: 'prop', name: 'Proposal' }),
    newRow({ id: 'line', name: 'Linework', blend: 'multiply', opacity: 70 }), newRow({ id: 'ent', name: 'Entrances' }), newRow({ id: 'north', name: 'North & scale' }), newRow({ id: 'title', name: 'Title' }),
  ];
  const paper = add('solid', 810, 1190, 'Paper', { colour: '#f6f4ef' });
  const stack = add('layerStack', 1040, 330, 'Site plan stack', { rows });
  wire(paper, 'image', stack, 'Lpaper'); wire(vpG, 'image', stack, 'Lground'); wire(fillS, 'image', stack, 'Lshadow'); wire(hatch, 'image', stack, 'Lplant');
  wire(grp, 'o_' + go.id, stack, 'Lctx'); wire(stroke, 'image', stack, 'Lprop'); wire(vpL, 'image', stack, 'Lline'); wire(dec, 'image', stack, 'Lent');
  wire(north, 'image', stack, 'Lnorth'); wire(title, 'image', stack, 'Ltitle');
  // output
  const nb = add('nanoBanana', 1330, 370, 'Watercolour wash (AI)', { prompt: 'soft watercolour wash on the ground plane only, keep all linework and buildings untouched' }); nb.disabled = true;
  wire(stack, 'image', nb, 'image'); wire(vpG, 'mask', nb, 'mask');
  const perm = add('permutation', 1330, 900, 'Options', { lists: 'option = option1, option2, option3, option4\ncamera = camera1' });
  const save = add('save', 1590, 370, 'Save site plan', { diagram: 'site-plan', pattern: '{project}_{option}_{diagram}_{camera}_v{version:02}', version: 1 });
  wire(nb, 'image', save, 'image'); wire(perm, 'rows', save, 'rows');
  doc = prevDoc;
  d._sample = { save: save.id, stack: stack.id, render: m3.id, model: mdl.id };
  return d;
}
function setupSampleView() {
  ui.pins = [null, { graph: 'root', id: doc._sample && doc._sample.render ? doc._sample.render : null }, { graph: 'root', id: doc._sample ? doc._sample.save : null }, null, null];
  ui.slot = 0; ui.sel = new Set(doc._sample && doc.nodes[doc._sample.render] ? [doc._sample.render] : []); ui.previewRow = 0; ui.vview.fit = true;
  render(); requestAnimationFrame(() => frameNodes());
}

// ---------------------------------------------------------------- boot
(function boot() {
  applyTheme();
  const w = LS.get('dc.viewerW', 0); if (w) document.documentElement.style.setProperty('--viewer-w', w + 'px');
  const saved = LS.get('dc.doc.v2', null);
  if (saved && saved.format === DOC_FORMAT && Object.keys(saved.nodes || {}).length) { doc = migrateDoc(saved); }
  else doc = sampleDoc();
  if (!doc.models.sample) doc.models.sample = { kind: 'builtin', name: 'Competition sample', params: {} };
  if (doc._sample && doc.nodes[doc._sample.save]) setupSampleView();
  else { render(); requestAnimationFrame(() => frameNodes()); }
  requestEval();
  if (!glInit()) toast('3D rendering is unavailable in this browser: ' + GL.err, 'error');
  setInterval(() => { refreshStatusDom(); if (ui.filesDirty && $('#filesBody')) { ui.filesDirty = false; renderFilesModal(); } }, 400);
  window.addEventListener('resize', () => { layoutPorts(); drawWires(); });
})();
