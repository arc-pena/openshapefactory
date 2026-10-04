// =====================================================================
// Properties panel — generated from the node's declaration. Every number
// accepts expressions and Value names; the ring beside a field promotes it
// to an input port.
// =====================================================================
const propsBody = $('#propsBody');
function renderProps() {
  $('#tProps').classList.toggle('on', ui.propsTab === 'props'); $('#tLayers').classList.toggle('on', ui.propsTab === 'layers'); $('#tNodes').classList.toggle('on', ui.propsTab === 'nodes');
  const scroll = propsBody.scrollTop; propsBody.innerHTML = '';
  if (ui.propsTab === 'layers') { renderLayersView(); return; }
  if (ui.propsTab === 'nodes') { renderPalette(); return; }
  const g = currentGraph(), ids = [...ui.sel].filter(i => g.nodes[i]);
  if (ui.selWire) { const n = g.nodes[ui.selWire.node], s = n && n.inputs[ui.selWire.port];
    propsBody.append(h('div', { class: 'ph' }, h('b', null, 'Wire')), h('p', { class: 'hint' }, s ? `${(g.nodes[s.node] || {}).name || s.node} · ${s.port} → ${n.name || T(n.type).label} · ${ui.selWire.port}` : ''), h('button', { class: 'btn line small danger', onclick: deleteSelection }, 'Delete wire'));
    return; }
  if (!ids.length) { renderGraphProps(); propsBody.scrollTop = scroll; return; }
  if (ids.length > 1) {
    propsBody.append(h('div', { class: 'ph' }, h('b', { style: { fontSize: '15px' } }, `${ids.length} nodes selected`)),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
        h('button', { class: 'btn line small', onclick: groupSelection }, 'Group  (Ctrl G)'), h('button', { class: 'btn line small', onclick: toggleDisable }, 'Disable  (D)'),
        h('button', { class: 'btn line small', onclick: () => copySelection(false) }, 'Copy'), h('button', { class: 'btn line small danger', onclick: deleteSelection }, 'Delete')),
      h('p', { class: 'hint' }, 'Group turns these into one node whose definition is shared by reference; save it as a graphic standard to reuse across graphs.'));
    return;
  }
  const n = g.nodes[ids[0]], t = T(n.type);
  const head = h('div', { class: 'ph' }, h('span', { class: 'chip', style: { width: '10px', height: '10px', borderRadius: '3px', background: (FAMILIES[t.family] || FAMILIES.org).colour, flex: 'none' } }),
    h('input', { class: 'name', id: 'p-name', value: n.name || '', placeholder: t.label, oninput: e => { beginEdit(); n.name = e.target.value; renderGraph(); }, onchange: () => endEdit() }));
  if (!t.isBackdrop) head.append(h('label', { class: 'hint', style: { display: 'flex', gap: '5px', alignItems: 'center', margin: 0, whiteSpace: 'nowrap' }, title: 'Disabled nodes pass their input through (D)' },
    h('input', { type: 'checkbox', id: 'p-disabled', checked: !!n.disabled, onchange: e => mutate(() => { n.disabled = e.target.checked; }) }), 'Off'));
  propsBody.append(head, h('div', { class: 'ptype' }, h('b', null, t.label), ' · ', t.desc || ''));
  const st = getStatus(g, n.id);
  if (st && st.msg && (st.state === 'warn' || st.state === 'error')) propsBody.append(h('div', { class: 'nmsg ' + st.state, style: { margin: '0 0 10px' } }, st.msg));
  // type-specific actions
  if (n.type === 'viewport') propsBody.append(viewportExtras(n));
  if (n.type === 'modelSource') propsBody.append(modelExtras(n));
  if (n.type === 'group') propsBody.append(groupExtras(n));
  if (n.type === 'save') propsBody.append(saveExtras(n));
  if (n.type === 'extractCamera') { const r = cameraRes(currentGraph(), n.id), [w, h] = r ? outSize(r.mult, r) : outSize(); propsBody.append(h_res(r ? `Default ${r.w} × ${r.h} px${r.lock && r.frameLabel ? ' (' + r.frameLabel + ' from the modeller camera)' : ''} × ${outMult(r.mult)} = ${w} × ${h} px for every Save and export downstream, unless a Save sets its own scale.` : '')); }
  if (n.type === 'nanoBanana') propsBody.append(nanoExtras(n));
  if (n.type === 'reversePrompt') propsBody.append(geminiKeyField());
  const ex = exportExtras(n); if (ex) propsBody.append(ex);
  let section = null;
  const A = { ...Object.fromEntries(t.args.map(a => [a.n, a.d])), ...n.args };
  for (const a of t.args) {
    if (a.section && a.section !== section) { section = a.section; propsBody.append(h('div', { class: 'sect' }, section)); }
    if (a.show && !a.show(A)) continue;
    propsBody.append(field(n, a));
  }
  if (n.type === 'layerStack') propsBody.append(h('p', { class: 'hint' }, 'Tip: the Layers tab shows this stack top-first, like Photoshop, with drag to reorder.'));
  propsBody.scrollTop = scroll;
}
function field(n, a) {
  const promoted = (n.promoted || []).includes(a.n), canPromote = !!PROMOTE_KIND[a.t] && a.t !== 'bool';
  const id = `f-${n.id}-${a.n}`, raw = n.args[a.n] === undefined ? a.d : n.args[a.n];
  const set = (v, commit) => { beginEdit(); n.args[a.n] = v; docChanged(); if (commit) endEdit(); };
  let ctl;
  const wrap = (lbl, c, wide) => {
    const promo = canPromote ? h('button', { class: 'promote' + (promoted ? ' on' : ''), title: promoted ? 'Driven by an input port. Click to make it a plain field again.' : 'Promote to an input port', onclick: () => mutate(() => { n.promoted = promoted ? n.promoted.filter(x => x !== a.n) : [...(n.promoted || []), a.n]; if (promoted) delete n.inputs['$' + a.n]; }) }) : h('span');
    const f = h('div', { class: 'field' + (wide ? ' wide' : '') }, h('label', { for: id }, lbl), wide ? c : h('div', { class: 'ctl' }, c), wide ? null : promo);
    if (wide) f.append(h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '-4px' } }, canPromote ? promo : null));
    const box = h('div', null, f); if (a.hint) box.append(h('div', { class: 'hint', html: a.hint }));
    if (promoted) { const src = n.inputs['$' + a.n]; box.append(h('div', { class: 'hint' }, src ? `Driven by ${(currentGraph().nodes[src.node] || {}).name || T((currentGraph().nodes[src.node] || {}).type).label}.` : 'Promoted: connect a node to its ƒ port, or the field value is used.')); }
    return box;
  };
  const label = a.l + (a.unit ? ` (${a.unit})` : '');
  switch (a.t) {
    case 'number': case 'int': {
      const isExpr = typeof raw === 'string';
      const txt = h('input', { class: 'inp expr' + (isExpr ? ' linked' : ''), id, value: raw == null ? '' : String(raw), title: 'Numbers, units (10m, 500mm), maths (sqrt(2)*30), Value names', style: { width: a.min != null && a.max != null ? '74px' : '100%', flex: 'none' } });
      const commitTxt = (commit) => {
        const s = txt.value.trim(); if (s === '') return;
        try { const v = evalExpr(s, exprNames(makeCtx({ ...previewVars() }))); txt.classList.remove('err'); const literal = /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s); set(literal ? (a.t === 'int' ? Math.round(v) : v) : s, commit); txt.classList.toggle('linked', !literal); if (rng) rng.value = v; txt.title = literal ? '' : `= ${+v.toFixed(4)}`; }
        catch (e) { txt.classList.add('err'); txt.title = e.message; }
      };
      txt.oninput = () => commitTxt(false); txt.onchange = () => { commitTxt(true); endEdit(); };
      txt.onkeydown = e => { if (e.key === 'Enter') txt.blur(); };
      let rng = null;
      if (a.min != null && a.max != null) {
        let v0 = raw; if (typeof raw === 'string') { try { v0 = evalExpr(raw, exprNames(makeCtx())); } catch { v0 = a.d; } }
        rng = h('input', { type: 'range', min: a.min, max: a.max, step: a.step || (a.t === 'int' ? 1 : (a.max - a.min) / 200), value: v0, 'aria-label': a.l });
        rng.oninput = () => { const v = a.t === 'int' ? Math.round(+rng.value) : +(+rng.value).toFixed(4); txt.value = v; txt.classList.remove('linked', 'err'); set(v, false); };
        rng.onchange = () => endEdit();
        ctl = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', width: '100%' } }, rng, txt);
      } else ctl = txt;
      return wrap(label, ctl);
    }
    case 'string': case 'path': {
      const inp = h('input', { class: 'inp' + (a.t === 'path' ? ' expr' : ''), id, value: raw == null ? '' : raw, list: a.t === 'path' ? 'dl-' + id : null, oninput: e => set(e.target.value, false), onchange: () => endEdit(), onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } });
      if (a.t === 'path') {
        const m = getModel(n.args.model || 'sample'), dl = h('datalist', { id: 'dl-' + id });
        if (m) { const cams = m.cameras.map(c => c.name); for (const gs of m._index.geosets) dl.append(h('option', { value: n.type === 'viewport' ? `${gs} @ ${cams[0]} : arctic` : gs })); for (const tok of ['{option}', '{option}/entrances']) dl.append(h('option', { value: n.type === 'viewport' ? `${tok} @ {camera} : {style}` : tok })); }
        return wrap(label, h('div', { style: { width: '100%' } }, inp, dl), true);
      }
      return wrap(label, inp);
    }
    case 'text': return wrap(label, h('textarea', { class: 'inp', id, rows: 3, oninput: e => set(e.target.value, false), onchange: () => endEdit() }, raw || ''), true);
    case 'select': {
      const opts = typeof a.options === 'function' ? a.options(n) : a.options;
      const s = h('select', { class: 'inp', id, onchange: e => { set(e.target.value, true); renderProps(); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(raw) === String(v) }, l)));
      return wrap(label, s);
    }
    case 'bool': return wrap(label, h('input', { type: 'checkbox', id, checked: !!raw, onchange: e => { set(e.target.checked, true); renderProps(); } }));
    case 'colour': {
      const c = parseColour(raw);
      const pick = h('input', { type: 'color', id, value: colourHex(c), oninput: e => { const al = parseColour(txt.value)[3]; const v = al < 1 ? e.target.value + toHex2(al) : e.target.value; txt.value = v; set(v, false); }, onchange: () => endEdit() });
      const txt = h('input', { class: 'inp expr', value: raw, title: 'Hex with optional alpha, e.g. #ff8a3d80', oninput: e => { if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(e.target.value)) { pick.value = colourHex(e.target.value); set(e.target.value, false); } }, onchange: () => endEdit() });
      return wrap(label, h('div', { style: { display: 'flex', gap: '6px', width: '100%' } }, pick, txt));
    }
    case 'image': {
      const as = raw && doc.assets && doc.assets[raw];
      return wrap(label, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', width: '100%' } },
        as ? h('img', { src: as.data, style: { width: '48px', height: '36px', objectFit: 'contain', borderRadius: '5px', border: '1px solid var(--line)' }, alt: '' }) : null,
        h('button', { class: 'btn line small', id, onclick: () => { ui._imageTarget = n.id; $('#fileImage').click(); } }, as ? 'Replace…' : 'Choose image…'),
        h('button', { class: 'btn line small', title: 'Use the image on the clipboard (or press Ctrl V over the graph)', onclick: () => { ui.sel = new Set([n.id]); pasteImageFromClipboard(); } }, 'Paste'),
        as ? h('span', { class: 'hint', style: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, as.name) : null));
    }
    case 'button': return h('div', { class: 'field wide' }, h('button', { class: 'btn primary', id, onclick: async e => { e.target.disabled = true; try { await ACTIONS[a.action](n, currentGraph()); } finally { e.target.disabled = false; } } }, a.l));
    case 'rows': return rowsEditor(n);
  }
  return h('div');
}
function rowsEditor(n) {
  const rows = n.args.rows || [], box = h('div', { class: 'rows' });
  box.append(h('div', { class: 'sect' }, 'Layers (bottom first)'));
  rows.forEach((r, i) => {
    const src = n.inputs['L' + r.id], up = src && currentGraph().nodes[src.node];
    box.append(h('div', { class: 'rowcard' },
      h('div', { class: 'rh' }, h('input', { type: 'checkbox', title: 'Visible', checked: r.visible !== false, onchange: e => mutate(() => { r.visible = e.target.checked; }) }),
        h('input', { class: 'inp', style: { height: '24px' }, value: r.name || '', placeholder: up ? (up.name || T(up.type).label) : `Layer ${i + 1}`, oninput: e => { beginEdit(); r.name = e.target.value; renderGraph(); }, onchange: () => endEdit() }),
        h('button', { class: 'ibtn', title: 'Move down', onclick: () => mutate(() => { if (i > 0) [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; }) }, '↓'),
        h('button', { class: 'ibtn', title: 'Move up', onclick: () => mutate(() => { if (i < rows.length - 1) [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; }) }, '↑'),
        h('button', { class: 'ibtn', title: 'Remove layer', onclick: () => mutate(() => { rows.splice(i, 1); delete n.inputs['L' + r.id]; delete n.inputs['M' + r.id]; }) }, '×')),
      h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
        h('select', { class: 'inp', style: { height: '26px' }, onchange: e => mutate(() => { r.blend = e.target.value; }) }, BLEND_OPTS.map(([v, l]) => h('option', { value: v, selected: (r.blend || 'normal') === v }, l))),
        h('input', { class: 'inp', type: 'number', min: 0, max: 100, value: r.opacity == null ? 100 : r.opacity, style: { width: '64px', height: '26px' }, title: 'Opacity %', oninput: e => { beginEdit(); r.opacity = clamp(+e.target.value, 0, 100); docChanged(); }, onchange: () => endEdit() }))));
  });
  box.append(h('button', { class: 'btn line small', onclick: () => mutate(() => { n.args.rows = [...rows, newRow()]; }) }, 'Add layer'));
  return box;
}
function viewportExtras(n) {
  const m = getModel(n.args.model || 'sample'), box = h('div');
  const ctx = makeCtx({ ...previewVars() }), A = resolveArgs(n, ctx, []), lp = parseLayerPath(A.path, m);
  box.append(h('div', { class: 'hint' }, 'Resolved: ', h('span', { class: 'mono-inline' }, canonicalPath({ ...lp, camera: A.camera || lp.camera, style: A.style || lp.style || 'shaded' }))));
  box.append(h('div', { style: { display: 'flex', gap: '6px', margin: '8px 0' } }, h('button', { class: 'btn line small', onclick: () => open3D(n) }, 'Open viewport  (Enter)')));
  if (m) {
    const set = new Set(parseLayerPath(n.args.path, m).geosets);
    const tree = h('div', { class: 'tree' });
    for (const gs of m._index.geosets) {
      const depth = gs.split('/').length - 1;
      tree.append(h('label', { style: { paddingLeft: 4 + depth * 14 + 'px' } }, h('input', { type: 'checkbox', checked: set.has(gs), onchange: e => {
        const cur = parseLayerPath(n.args.path, m), list = cur.geosets.filter(x => x !== gs); if (e.target.checked) list.push(gs);
        mutate(() => { n.args.path = `${list.join(', ') || '*'} @ ${cur.camera || (m.cameras[0] || {}).name} : ${cur.style || 'shaded'}`; });
      } }), gs.split('/').pop(), depth ? null : h('span', { class: 'hint', style: { margin: '0 0 0 auto' } }, String(m.elements.filter(e => geosetMatch(gs, e.geoset)).length))));
    }
    box.append(h('div', { class: 'sect' }, 'Isolate geosets'), tree, h('p', { class: 'hint' }, 'Ticking a geoset writes it into the layer path. Tokens like {option} stay as typed.'));
  }
  return box;
}
function groupExtras(n) {
  const def = doc.defs[n.args.def], uses = countDefUses(n.args.def);
  if (!def) return h('div', { class: 'nmsg error' }, 'Definition missing.');
  return h('div', null,
    h('div', { class: 'field' }, h('label', null, 'Definition'), h('div', { class: 'ctl' }, h('input', { class: 'inp', value: def.name, oninput: e => { beginEdit(); def.name = e.target.value; }, onchange: () => endEdit() })), h('span')),
    h('p', { class: 'hint' }, `${Object.keys(def.nodes).length} nodes · used ${uses} time${uses > 1 ? 's' : ''} in this graph. Edits inside update every instance.`),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '6px 0 4px' } },
      h('button', { class: 'btn primary small', onclick: () => enterGroup(n) }, 'Edit inside'),
      h('button', { class: 'btn line small', onclick: () => saveStandard(n) }, def.libId ? 'Update standard' : 'Save as standard'),
      uses > 1 ? h('button', { class: 'btn line small', onclick: () => mutate(() => { const d = deepClone(def); d.id = uid('d'); d.name = def.name + ' (copy)'; delete d.libId; doc.defs[d.id] = d; n.args.def = d.id; }) }, 'Make unique') : null,
      h('button', { class: 'btn line small', onclick: () => ungroup(n) }, 'Ungroup')));
}
function h_res(t) { return h('p', { class: 'hint', style: { margin: '2px 0 8px' } }, t); }
function saveExtras(n) {
  const jobs = saveJobs().filter(j => j.node.id === n.id), box = h('div', { style: { margin: '0 0 6px' } });
  const tbl = h('div', { style: { maxHeight: '160px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '9px', background: 'var(--pane-solid)' } });
  for (const j of jobs) {
    const f = files.get(j.path); let pill = 'stale', txt = 'not written';
    if (j.dup) { pill = 'error'; txt = 'duplicate name'; } else if (j.missing.length) { pill = 'error'; txt = 'missing token'; } else if (f) { pill = 'ok'; txt = `written ×${f.writes}`; }
    tbl.append(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '5px 8px', borderBottom: '1px solid var(--line)' } }, h('span', { class: 'mono', style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } }, j.path), h('span', { class: 'pill ' + pill }, txt)));
  }
  const tok = jobs[0] && jobs[0].tokens || {}, keys = Object.keys(tok);
  const pri = ['camera', 'geoset', 'style', 'model', 'option'], ordered = [...pri.filter(k => k in tok), ...keys.filter(k => !pri.includes(k)).sort()];
  const chips = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '4px 0 8px' } });
  const chip = k => h('button', { class: 'btn line small mono', title: `Add {${k}} to the file name`, onclick: () => mutate(() => { n.args.pattern = (n.args.pattern || '') + (n.args.pattern ? '_' : '') + '{' + k + '}'; }) }, `{${k}} = ${tok[k]}`);
  const main = ordered.filter(k => pri.includes(k)), rest = ordered.filter(k => !pri.includes(k));
  main.forEach(k => chips.append(chip(k)));
  const more = rest.length ? h('details', null, h('summary', { class: 'hint', style: { cursor: 'pointer' } }, `${rest.length} more fields`), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '4px 0 8px' } }, ...rest.map(chip))) : null;
  box.append(h('div', { class: 'sect' }, 'From upstream nodes'), keys.length ? chips : h('p', { class: 'hint' }, 'Connect an image to see the tokens it carries.'), more);
  box.append(h('div', { class: 'sect' }, (() => { const c = fullCtx(doc, n.id, n.args.scale); return `Writes ${jobs.length} file${jobs.length === 1 ? '' : 's'} · ${c.w} × ${c.h} px`; })()), tbl,
    h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
      h('button', { class: 'btn primary small', onclick: async () => { writer.armed = true; let c = 0; const ran = await withNanoBatch(jobs, async () => { for (const j of jobs) { const r = await writeJob(j, { force: true, yield: sleep0, batchAI: true }); j.node._lastWrite = r; if (r.status !== 'error') c++; } }); if (ran) toast(`Wrote ${c} of ${jobs.length}`); renderProps(); ui.statusDirty = true; refreshStatusDom(); } }, 'Write now'),
      h('button', { class: 'btn line small', onclick: openFilesModal }, 'Open Files')),
    h('p', { class: 'hint' }, 'Same name overwrites in place. A changed name writes a new file and leaves the old one; Files lists orphans for clean-up.'));
  return box;
}
// The Gemini key lives in this browser's storage only - never in the graph, exports or images.
function geminiKeyField() {
  const cur = LS.get('dc.geminiKey', ''), masked = k => k ? k.slice(0, 4) + '…' + k.slice(-4) : '';
  const inp = h('input', { class: 'inp', type: 'password', id: 'nb-key', value: cur, placeholder: 'Paste a Gemini API key (AIza…)', autocomplete: 'off', spellcheck: 'false', style: { flex: 1, minWidth: 0 } });
  const status = h('p', { class: 'hint', id: 'nb-key-status', style: { margin: '4px 0 8px' } }, cur ? `Key in use: ${masked(cur)} · stored only in this browser, never in the graph or images.` : 'No key yet. Get one at aistudio.google.com/apikey and paste it here.');
  const save = () => { const v = inp.value.trim(); if (!v) return toast('Paste a key first, or use Remove.', 'error'); LS.set('dc.geminiKey', v); status.textContent = `Key in use: ${masked(v)} · stored only in this browser, never in the graph or images.`; toast('Gemini key saved in this browser.'); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const show = h('button', { class: 'btn line small', type: 'button', title: 'Show or hide the key', onclick: e => { inp.type = inp.type === 'password' ? 'text' : 'password'; e.target.textContent = inp.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
  return h('div', null, h('div', { class: 'sect' }, 'Gemini API key'),
    h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, inp, show),
    h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
      h('button', { class: 'btn primary small', type: 'button', onclick: save }, cur ? 'Change key' : 'Save key'),
      h('button', { class: 'btn line small', type: 'button', onclick: () => { LS.del('dc.geminiKey'); inp.value = ''; status.textContent = 'Key removed from this browser.'; toast('Gemini key removed.'); } }, 'Remove')),
    status);
}
function nanoExtras(n) {
  const has = n.args.result && doc.assets[n.args.result];
  const presets = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '0 0 8px' } },
    ...NANO_PRESETS.map(p => h('button', { class: 'btn line small', title: p, onclick: () => mutate(() => { n.args.prompt = p; }) }, p.split(',')[0].slice(0, 34))));
  return h('div', { style: { marginBottom: '6px' } },
    h('div', { class: 'sect' }, 'Prompt ideas'), presets,
    has ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('img', { src: doc.assets[n.args.result].data, alt: '', style: { width: '64px', height: '48px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--line)' } }),
      h('div', { class: 'hint', style: { margin: 0 } }, `Kept result · seed ${n.args.resultSeed} · “${String(n.args.resultPrompt || '').slice(0, 60)}”`)) : null,
    geminiKeyField(),
    (() => { const c = Object.keys(n.args.results || {}).length; return c ? h('p', { class: 'hint' }, `${c} result${c === 1 ? '' : 's'} kept, one per input (each camera or Permutation row). Tick this node in the Render all picker to make new ones.`) : null; })(),
    has ? h('button', { class: 'btn line small', onclick: () => mutate(() => { const ids = [n.args.result, ...Object.values(n.args.results || {}).map(r => r.asset)]; delete n.args.result; delete n.args.resultKey; delete n.args.results; delete n._runError; for (const a of ids) if (a && !assetInUse(a)) delete doc.assets[a]; }) }, 'Clear results') : null);
}
function renderGraphProps() {
  const s = doc.settings, box = propsBody;
  const num = (label, key, opts = {}) => h('div', { class: 'field' }, h('label', { for: 'g-' + key }, label), h('div', { class: 'ctl' }, h('input', { class: 'inp', id: 'g-' + key, type: 'number', value: s[key], min: opts.min, max: opts.max, step: opts.step || 1,
    oninput: e => { const v = +e.target.value; if (!isFinite(v) || v < (opts.min ?? -Infinity)) return; beginEdit(); s[key] = v; docChanged(); }, onchange: () => endEdit() })), h('span'));
  box.append(h('div', { class: 'ph' }, h('input', { class: 'name', id: 'g-name', value: doc.name, oninput: e => { beginEdit(); doc.name = e.target.value; renderCrumbs(); }, onchange: () => endEdit() })),
    h('div', { class: 'ptype' }, 'Graph settings. Select a node to edit it; press N over the canvas (or right-click) to add one.'),
    h('div', { class: 'field' }, h('label', { for: 'g-project' }, 'Project'), h('div', { class: 'ctl' }, h('input', { class: 'inp', id: 'g-project', value: s.project, oninput: e => { beginEdit(); s.project = e.target.value; docChanged(); }, onchange: () => endEdit() })), h('span')),
    h('div', { class: 'sect' }, 'Viewport resolution'), num('Width (px)', 'width', { min: 64, max: 8000 }), num('Height (px)', 'height', { min: 64, max: 8000 }),
    num('Output scale ×', 'mult', { min: 0.1, max: 16, step: 0.25 }),
    h('div', { class: 'hint' }, `Saves and exports render at ${outSize().join(' × ')} px: ${outMult()}× the viewport, like Rhino's capture scale. Line weights scale with it, so a 2× file looks the same with twice the pixels. A Save node can set its own scale.`),
    num('DPI', 'dpi', { min: 72, max: 1200 }),
    h('div', { class: 'hint' }, `${(outSize()[0] / s.dpi * 25.4).toFixed(0)} × ${(outSize()[1] / s.dpi * 25.4).toFixed(0)} mm at ${s.dpi} dpi. Every node renders at the same size so layers align pixel for pixel.`),
    num('Preview scale', 'preview', { min: 0.1, max: 1, step: 0.02 }),
    h('div', { class: 'hint' }, `Previews render at ${Math.round(s.width * s.preview)} × ${Math.round(s.height * s.preview)} px. Saves render at ${outSize().join(' × ')} px.`),
    h('div', { class: 'sect' }, 'Saving'),
    h('div', { class: 'field' }, h('label', { for: 'g-auto' }, 'Write on change'), h('div', { class: 'ctl' }, h('input', { type: 'checkbox', id: 'g-auto', checked: s.autosave !== false, onchange: e => mutate(() => { s.autosave = e.target.checked; }) })), h('span')),
    num('Debounce (s)', 'debounce', { min: 0.5, max: 30, step: 0.5 }));
  // model parameters
  for (const [key, ref] of Object.entries(doc.models)) {
    box.append(h('div', { class: 'sect' }, 'Model · ' + (ref.name || key)));
    if (ref.kind === 'builtin') {
      box.append(h('p', { class: 'hint' }, 'A parametric stand-in for a competition model. Changing a value regenerates the model; only Viewports that draw the changed elements re-render, and their saved files rewrite.'));
      for (const p of SAMPLE_PARAMS) {
        const v = ref.params && ref.params[p.key] != null ? ref.params[p.key] : p.def, id = 'mp-' + p.key;
        const out = h('span', { class: 'mono', style: { width: '46px', textAlign: 'right', flex: 'none' } }, v + (p.unit || ''));
        box.append(h('div', { class: 'field', style: { gridTemplateColumns: '1fr' } }, h('label', { for: id }, p.label),
          h('div', { class: 'ctl' }, h('input', { type: 'range', id, min: p.min, max: p.max, step: p.step || 1, value: v, oninput: e => { beginEdit(); ref.params = { ...(ref.params || {}), [p.key]: +e.target.value }; out.textContent = e.target.value + (p.unit || ''); docChanged(); }, onchange: () => endEdit() }), out)));
      }
    } else if (ref.kind === 'ocaf') {
      const m = ocafModel(key), c = ocafCache.get(key);
      box.append(h('dl', { class: 'kv' }, h('dt', null, 'Format'), h('dd', null, 'ocaf-parametric-model'), h('dt', null, 'Features'), h('dd', null, String((ref.json.features || []).length)),
        h('dt', null, 'Status'), h('dd', null, m ? `built · ${m.elements.length} elements · ${m.stats.triangles.toLocaleString()} triangles` : c && c.error ? 'failed: ' + c.error : 'building…'),
        h('dt', null, 'Sets'), h('dd', null, m ? String(m._index.geosets.length) : '—'), h('dt', null, 'Cameras'), h('dd', null, m ? m.cameras.map(x => x.name).join(', ') || 'none' : '—')),
        h('p', { class: 'hint' }, 'Edit it from a Model node: right-click › Open parametric modeller.'));
    } else {
      box.append(h('dl', { class: 'kv' }, h('dt', null, 'File'), h('dd', null, ref.path || '—'), h('dt', null, 'Hash'), h('dd', null, ref.hash || '—'), h('dt', null, 'Elements'), h('dd', null, String((ref.json.elements || []).length)), h('dt', null, 'Cameras'), h('dd', null, (ref.json.cameras || []).map(c => c.name).join(', '))),
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } }, h('button', { class: 'btn line small', onclick: () => $('#fileModel').click() }, 'Reload from file…'), h('button', { class: 'btn line small danger', onclick: () => mutate(() => { delete doc.models[key]; }) }, 'Remove')));
    }
    if ((ref.extraCameras || []).length) box.append(h('p', { class: 'hint' }, 'Captured cameras: ' + ref.extraCameras.map(c => c.name).join(', ')));
  }
  box.append(h('div', { style: { margin: '10px 0' } }, h('button', { class: 'btn line small', onclick: () => $('#fileModel').click() }, 'Load model JSON…')),
    h('div', { class: 'sect' }, 'Shortcuts'), shortcutList());
}
function shortcutList() {
  const rows = [['Tab', 'Node graph only / show panels'], ['N  or  Shift A', 'Add node at cursor'], ['V / P', 'Show or hide Viewer / Properties'], ['Drag pin → pin', 'Wire (refused if kinds differ)'], ['D', 'Disable (pass through)'], ['F', 'Frame selection'], ['1–4', 'Pin to viewer slot'], ['Ctrl Z / Shift Z', 'Undo / redo'],
    ['Ctrl C / V / D', 'Copy, paste, duplicate'], ['Ctrl G', 'Group (Shift to ungroup)'], ['Delete', 'Delete node or wire'], ['Double-click', 'Enter group / open viewport'], ['Esc', 'Close, leave group'], ['Wheel', 'Zoom at cursor'], ['Middle-drag', 'Pan'], ['Right-click node', 'Node menu (Model: open modeller)']];
  return h('div', { class: 'kbd-list' }, rows.flatMap(([k, d]) => [h('kbd', null, k), h('span', null, d)]));
}

// ---------------------------------------------------------------- Layers view (a second view of the same stack)
function layersTarget() {
  const g = currentGraph(), id = [...ui.sel][0], n = id && g.nodes[id];
  if (n && (n.type === 'layerStack' || n.type === 'merge')) return n;
  // follow downstream from the selection to the first stack
  if (n) for (const m of Object.values(g.nodes)) if (m.type === 'layerStack' && Object.values(m.inputs).some(s => s.node === n.id)) return m;
  return Object.values(g.nodes).find(m => m.type === 'layerStack') || null;
}
function renderLayersView() {
  const n = layersTarget(), g = currentGraph();
  if (!n) { propsBody.append(h('p', { class: 'empty-note' }, 'No Layer Stack in this graph. Add one with N › Layer Stack, or select a Merge to see its chain as layers.')); return; }
  propsBody.append(h('div', { class: 'ph' }, h('b', { style: { fontSize: '15px' } }, n.name || T(n.type).label)), h('div', { class: 'ptype' }, 'Top layer first, as in Photoshop. Changes here edit the same graph: no separate state.'));
  if (n.type === 'merge') {
    const chain = []; let cur = n; while (cur && cur.type === 'merge' && chain.length < 30) { chain.push(cur); const b = cur.inputs.b; cur = b && g.nodes[b.node]; }
    for (const m of chain) { const a = m.inputs.a, up = a && g.nodes[a.node];
      propsBody.append(h('div', { class: 'layer', style: { cursor: 'default' } }, h('span'), h('canvas', { width: 88, height: 66, 'data-src': a ? a.node + '|' + a.port : '' }),
        h('div', null, h('div', { class: 'ln' }, up ? (up.name || T(up.type).label) : '(empty A)'), h('div', { class: 'lc' },
          h('select', { class: 'inp', onchange: e => mutate(() => { m.args.mode = e.target.value; }) }, BLEND_OPTS.map(([v, l]) => h('option', { value: v, selected: (m.args.mode || 'normal') === v }, l))),
          h('input', { class: 'inp', type: 'number', min: 0, max: 100, value: m.args.opacity == null ? 100 : m.args.opacity, oninput: e => { beginEdit(); m.args.opacity = clamp(+e.target.value, 0, 100); docChanged(); }, onchange: () => endEdit() }))))); }
    if (cur) propsBody.append(h('div', { class: 'hint' }, 'Bottom: ' + (cur.name || T(cur.type).label)));
    renderLayerThumbs(); return;
  }
  const rows = n.args.rows || [];
  [...rows].reverse().forEach((r) => {
    const i = rows.indexOf(r), src = n.inputs['L' + r.id], up = src && g.nodes[src.node];
    const el = h('div', { class: 'layer', draggable: 'true', 'data-row': r.id },
      h('input', { type: 'checkbox', title: 'Visible', checked: r.visible !== false, onchange: e => mutate(() => { r.visible = e.target.checked; }) }),
      h('canvas', { width: 88, height: 66, 'data-src': src ? src.node + '|' + src.port : '' }),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'ln' }, r.name || (up ? up.name || T(up.type).label : `Empty layer ${i + 1}`)),
        h('div', { class: 'lc' }, h('select', { class: 'inp', onchange: e => mutate(() => { r.blend = e.target.value; }) }, BLEND_OPTS.map(([v, l]) => h('option', { value: v, selected: (r.blend || 'normal') === v }, l))),
          h('input', { class: 'inp', type: 'number', min: 0, max: 100, title: 'Opacity %', value: r.opacity == null ? 100 : r.opacity, oninput: e => { beginEdit(); r.opacity = clamp(+e.target.value, 0, 100); docChanged(); }, onchange: () => endEdit() }),
          n.inputs['M' + r.id] ? h('span', { class: 'pill', title: 'Has a mask' }, 'mask') : null)));
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('drag-over'); const from = e.dataTransfer.getData('text/plain'); if (from === r.id) return;
      mutate(() => { const a = rows.findIndex(x => x.id === from), item = rows.splice(a, 1)[0]; const b = rows.findIndex(x => x.id === r.id); rows.splice(b + 1, 0, item); }); });
    propsBody.append(el);
  });
  propsBody.append(h('div', { class: 'hint' }, 'Drag a row onto another to place it above that layer.'));
  renderLayerThumbs();
}
async function renderLayerThumbs() {
  const g = currentGraph(), ctx = makeCtx({ ...previewVars() }), scope = scopeForView();
  for (const cv of $$('.layer canvas', propsBody)) { const [id, port] = (cv.dataset.src || '|').split('|'); if (!id) continue; const v = await evalPort(g, id, port, ctx, scope); if (!v || !v.d) continue; const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); const k = Math.min(cv.width / v.w, cv.height / v.h); c.drawImage(cachedCanvas(v), (cv.width - v.w * k) / 2, (cv.height - v.h * k) / 2, v.w * k, v.h * k); }
}

// ---------------------------------------------------------------- modals
function openModal(title, content, opts = {}) {
  const layer = $('#modal-layer'); layer.innerHTML = ''; layer.hidden = false;
  const m = h('div', { class: 'modal pane' + (opts.narrow ? ' narrow' : ''), id: opts.id || null, role: 'dialog', 'aria-label': title },
    h('div', { class: 'pane-head' }, h('h2', null, title), ...(opts.actions || []), h('button', { class: 'ibtn', title: 'Close (Esc)', onclick: closeModal, html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>' })),
    opts.raw ? content : h('div', { class: 'pane-body' }, content));
  layer.append(m);
  layer.onclick = e => { if (e.target === layer && opts.id !== 'modellerModal') closeModal(); };
  return m;
}
function closeModal() { const l = $('#modal-layer'); l.hidden = true; l.innerHTML = ''; if (ui._v3d) { ui._v3d = null; } if (ui._onModalClose) ui._onModalClose(); }

async function openMatrixModal() {
  const jobs = saveJobs(), body = h('div');
  const tbl = h('table', { class: 'grid' }, h('tr', null, h('th', null, 'Preview'), h('th', null, 'Row'), h('th', null, 'File name'), h('th', null, 'Destination'), h('th', null, 'Status')));
  const cvs = [];
  const fullHash = j => { const s = j.node.inputs.image; if (!s) return null; const ctx = fullCtx(doc, j.node.id, j.A.scale, { vars: j.row, rowIndex: j.rowIndex }); return hashNode(doc, s.node, ctx, null) + ':' + s.port; };
  for (const j of jobs) {
    const f = files.get(j.path); let st = 'stale', label = 'not written';
    if (j.dup) { st = 'error'; label = 'duplicate name'; } else if (j.missing.length) { st = 'error'; label = 'missing ' + j.missing.join(', '); }
    else if (!j.node.inputs.image) { st = 'error'; label = 'no image'; }
    else if (f) { const cur = fullHash(j); if (cur === f.hash) { st = f.warn && f.warn.length ? 'warn' : 'ok'; label = f.warn && f.warn.length ? 'cached · warnings' : 'cached'; } else { st = 'stale'; label = 'stale'; } }
    const cv = h('canvas', { width: 144, height: 108 }); cvs.push([cv, j]);
    if (f) { const im = new Image(); im.onload = () => { const c = cv.getContext('2d'), k = Math.min(144 / im.width, 108 / im.height); c.drawImage(im, (144 - im.width * k) / 2, (108 - im.height * k) / 2, im.width * k, im.height * k); }; im.src = f.url || (f.url = URL.createObjectURL(f.blob)); }
    const tr = h('tr', { class: 'click', title: 'Inspect this row in the viewer' }, h('td', null, cv), h('td', { class: 'mono' }, `${j.rowIndex + 1}${Object.keys(j.row).length ? ' · ' + Object.values(j.row).join(' / ') : ''}`), h('td', { class: 'mono', style: { overflowWrap: 'anywhere' } }, j.path),
      h('td', { class: 'hint' }, 'Files' + (fsState.dir && j.A.folder ? ` + ${fsState.name}/` : '')), h('td', null, h('span', { class: 'pill ' + st }, label), j.node._lastWrite && j.node._lastWrite.msg ? h('div', { class: 'hint' }, j.node._lastWrite.msg) : null));
    tr.onclick = () => { const rows = rowsFor(null); const idx = rows.findIndex(r => stableJSON(r) === stableJSON(j.row)); if (idx >= 0) ui.previewRow = idx; view.path = []; ui.sel = new Set([j.node.id]); ui.slot = 0; closeModal(); render(); requestEval(); };
    tbl.append(tr);
  }
  const prevBtn = h('button', { class: 'btn line small', onclick: async () => {
    prevBtn.disabled = true;
    for (const [cv, j] of cvs) { const s = j.node.inputs.image; if (!s) continue; const ctx = makeCtx({ vars: j.row, rowIndex: j.rowIndex }); ctx.rowLog = []; const v = await evalPort(doc, s.node, s.port, ctx, null); if (!v || !v.d) continue; const c = cv.getContext('2d'); c.clearRect(0, 0, 144, 108); const k = Math.min(144 / v.w, 108 / v.h); c.drawImage(IMG.toCanvas(v), (144 - v.w * k) / 2, (108 - v.h * k) / 2, v.w * k, v.h * k); await sleep0(); }
    prevBtn.disabled = false; } }, 'Render previews');
  body.append(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' } },
    h('span', { class: 'empty-note' }, `${jobs.length} output${jobs.length === 1 ? '' : 's'} from ${new Set(jobs.map(j => j.node.id)).size} Save node${new Set(jobs.map(j => j.node.id)).size === 1 ? '' : 's'}. A failing row reports and is skipped; it never stops the others.`),
    h('span', { class: 'tb-spacer' }), prevBtn, h('button', { class: 'btn primary small', onclick: () => { closeModal(); renderAll(); } }, 'Render all')),
    h('div', { style: { overflow: 'auto', maxHeight: '560px' } }, tbl));
  openModal('Matrix', body);
}
function openFilesModal() { openModal('Files', h('div', { id: 'filesBody' })); renderFilesModal(); }
function renderFilesModal() {
  const body = $('#filesBody'); if (!body) return; body.innerHTML = '';
  const live = new Set(saveJobs().map(j => j.path)), list = [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), orphans = list.filter(f => !live.has(f.path));
  body.append(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' } },
    h('span', { class: 'empty-note' }, fsState.dir ? `Writing into folder “${fsState.name}” and keeping copies here.` : `${list.length} file${list.length === 1 ? '' : 's'} written this session. Connect a folder to overwrite files on disk in place.`),
    h('span', { class: 'tb-spacer' }),
    h('button', { class: 'btn line small', onclick: connectFolder }, fsState.dir ? 'Change folder…' : 'Connect folder…'),
    h('button', { class: 'btn line small', disabled: !list.length, onclick: async () => offerDownload(`${doc.settings.project || 'diagrams'}_diagrams.zip`, await makeZip(list)) }, 'Download all (.zip)'),
    h('button', { class: 'btn line small', disabled: !orphans.length, onclick: () => openOrphans(orphans) }, `Clean up orphans (${orphans.length})`)));
  if (!list.length) { body.append(h('p', { class: 'empty-note' }, 'Nothing written yet. Save nodes write when their image changes (after your first edit), or press ', h('b', null, 'Render all'), '.')); return; }
  const tbl = h('table', { class: 'grid' }, h('tr', null, h('th', null, ''), h('th', null, 'File'), h('th', null, 'Size'), h('th', null, 'Writes'), h('th', null, 'Last written'), h('th', null, '')));
  for (const f of list) {
    f.url = f.url || URL.createObjectURL(f.blob);
    const prov = h('div', { class: 'hint', hidden: true });
    tbl.append(h('tr', null, h('td', null, h('img', { src: f.url, alt: '' })),
      h('td', null, h('div', { class: 'mono', style: { overflowWrap: 'anywhere' } }, f.path), h('div', { class: 'hint' }, `${f.nodeName}${f.row && Object.keys(f.row).length ? ' · row ' + (f.rowIndex + 1) : ''}${live.has(f.path) ? '' : ' · orphan'}${f.folder ? ' · in folder' : ''}`), prov),
      h('td', { class: 'mono' }, `${f.w}×${f.h}`, h('div', { class: 'hint' }, (f.size / 1024 / 1024).toFixed(2) + ' MB')),
      h('td', { class: 'mono' }, '×' + f.writes), h('td', { class: 'mono' }, f.at.toLocaleTimeString()),
      h('td', null, h('div', { style: { display: 'flex', gap: '4px' } }, h('button', { class: 'btn line small', onclick: () => offerDownload(f.path.split('/').pop(), f.blob) }, 'Download'),
        /\.png$/.test(f.path) ? h('button', { class: 'btn small', onclick: async () => { const t = await readPngText(f.blob); prov.hidden = !prov.hidden; prov.textContent = t['diagram:provenance'] ? JSON.stringify(JSON.parse(t['diagram:provenance']), null, 1) : 'No provenance found.'; prov.style.whiteSpace = 'pre-wrap'; prov.style.fontFamily = 'var(--font-mono)'; } }, 'Provenance') : null))));
  }
  body.append(tbl);
}
function openOrphans(orphans) {
  const checks = orphans.map(f => h('input', { type: 'checkbox', checked: true, 'data-path': f.path }));
  openModal('Clean up orphans', h('div', null, h('p', { class: 'empty-note' }, 'These files were written under names no Save node produces any more. Nothing is deleted until you confirm.'),
    h('div', { class: 'tree', style: { maxHeight: '300px' } }, orphans.map((f, i) => h('label', null, checks[i], f.path))),
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
      h('button', { class: 'btn danger line', onclick: async () => { let c = 0; for (const cb of checks) if (cb.checked) { const p = cb.dataset.path; if (fsState.dir) { try { await fsState.dir.removeEntry(p); } catch { } } files.delete(p); c++; } toast(`Removed ${c} orphan${c === 1 ? '' : 's'}.`); openFilesModal(); } }, 'Remove selected'),
      h('button', { class: 'btn line', onclick: openFilesModal }, 'Cancel'))), { narrow: true });
}
function openSettingsModal() {
  const key = h('input', { class: 'inp', type: 'password', id: 's-key', value: LS.get('dc.geminiKey', ''), placeholder: 'AIza…', autocomplete: 'off' });
  const theme = h('select', { class: 'inp', id: 's-theme' }, [['', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: (LS.get('dc.theme', '') === v) }, l)));
  openModal('Settings', h('div', null,
    h('div', { class: 'sect' }, 'Gemini (Nano Banana)'),
    h('div', { class: 'field' }, h('label', { for: 's-key' }, 'API key'), h('div', { class: 'ctl' }, key), h('span')),
    h('p', { class: 'hint' }, 'Stored only in this browser. It is never written into graph files, exported images or PNG metadata, and is sent only to Google\'s endpoint. Inside the claude.ai viewer outside network calls are blocked, so Run works in the served build.'),
    h('div', { class: 'sect' }, 'OneDrive / SharePoint'),
    h('p', { class: 'hint' }, 'Writing to OneDrive needs a Microsoft app registration (MSAL sign-in with a delegated folder permission) and a served build. It is not available in this viewer; use Connect folder on a synced OneDrive folder, or Download all.'),
    h('div', { class: 'sect' }, 'Appearance'),
    h('div', { class: 'field' }, h('label', { for: 's-theme' }, 'Theme'), h('div', { class: 'ctl' }, theme), h('span')),
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: () => { LS.set('dc.geminiKey', key.value.trim()); LS.set('dc.theme', theme.value); applyTheme(); closeModal(); toast('Settings saved in this browser.'); renderProps(); } }, 'Save'), h('button', { class: 'btn line', onclick: () => { LS.del('dc.geminiKey'); key.value = ''; toast('Gemini key removed.'); } }, 'Forget key'))), { narrow: true });
}
function applyTheme() { const t = LS.get('dc.theme', ''); if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
function openHelpModal() {
  openModal('How it works', h('div', { style: { maxWidth: '760px' } },
    h('div', { class: 'sect' }, 'Model → Extract → Render'),
    h('p', { class: 'hint' }, 'The Model node holds an ocaf-parametric-model. Right-click it (or double-click) to open it in the Feature Modeller: import geometry, put it in a Geometrical Set, add Cameras, then Save to node. Extract Geoset and Extract Camera read their lists from the model. Render takes model, camera and geoset and returns the object only (other geometry held out), its mask, shadow, Object ID and the camera\'s safe frame, at the camera\'s own frame size.'),
    h('div', { class: 'sect' }, 'Canvas'),
    h('p', { class: 'hint' }, 'Scroll wheel zooms about the cursor. Hold the middle button and drag to pan. Right-click a node for its menu, or empty canvas to add a node. Tab hides every panel so only the node graph shows; Tab again brings them back. The × on the viewer closes it; V reopens it.'),
    h('p', { class: 'empty-note' }, 'A diagram is a recipe, not a file: which geometry, from which camera, in which render style, layered in which order, saved under which name. Change the model or the recipe and every affected image re-renders and overwrites itself.'),
    h('div', { class: 'sect' }, 'Layer paths'),
    h('p', { class: 'hint', html: '<code>context/buildings @ camera1 : arctic</code> · <code>option1/tower @ aerial-NE : hiddenline</code> · <code>context/* @ plan : shadows</code> · short form <code>buildings/camera1/arctic</code>. Styles: shaded, flat, shadows, hiddenline, arctic, objectid.' }),
    h('div', { class: 'sect' }, 'Port kinds'),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, KINDS.filter(k => k !== 'any').map(k => h('span', { class: 'pill', style: { background: 'transparent', border: `1.5px solid ${KCOL(k)}`, color: 'var(--fg)' } }, KIND_LABEL[k]))),
    h('p', { class: 'hint' }, 'Wires only join matching kinds. A wrong connection is refused, never coerced. Use Mask from Alpha or Fill Mask to cross between Image and Mask.'),
    h('div', { class: 'sect' }, 'Status dots'),
    h('p', { class: 'hint' }, 'Green: up to date or cached · blue: rendering · amber: rendered with a warning · red: error (the node returns what it can and says why) · grey: stale.'),
    h('div', { class: 'sect' }, 'Model file format (diagram-model/1)'),
    h('pre', { class: 'mono', style: { background: 'var(--accent-soft)', padding: '10px', borderRadius: '8px', overflow: 'auto', whiteSpace: 'pre' } }, `{
  "format": "diagram-model/1", "name": "My scheme", "units": "m",
  "elements": [
    { "id": "b1", "geoset": "option1/tower", "shape": "box",
      "size": [24, 24, 90], "at": [0, 0, 0], "rot": 0,
      "attrs": { "name": "Tower", "type": "tower", "levels": 26 } },
    { "id": "t1", "geoset": "context/trees", "shape": "sphere", "r": 3, "at": [10, 4, 5] }
  ],
  "points": [ { "id": "e1", "geoset": "option1/entrances", "at": [0, -12, 0], "dir": [0, -1, 0] } ],
  "cameras": [
    { "name": "camera1", "type": "ortho", "target": [0,0,10], "azimuth": 215, "elevation": 35, "span": 200 },
    { "name": "street", "type": "persp", "eye": [-80,-80,1.7], "target": [0,0,20], "fov": 50 }
  ]
}`),
    h('p', { class: 'hint' }, 'Shapes: box (size w,d,h from its base centre), cyl (r and size[2] height), sphere (r at centre). Z is up, metres. An exporter from the parametric modeller can write this directly.'),
    h('div', { class: 'sect' }, 'Shortcuts'), shortcutList()));
}

// ---------------------------------------------------------------- embedded viewport (orbit, pick, capture camera)
function open3D(n) {
  const m = getModel(n.args.model || 'sample'); if (!m) return toast('Model not loaded.', 'error');
  const ctx = makeCtx({ ...previewVars() }), A = resolveArgs(n, ctx, []), lp = parseLayerPath(A.path, m);
  const camDef0 = m.cameras.find(c => c.name === (A.camera || lp.camera)) || m.cameras[0];
  const cam = deepClone(camDef0); if (cam.eye) { const d = sub3(cam.eye, cam.target); cam.distance = len3(d); cam.azimuth = (Math.atan2(d[0], d[1]) * 180 / Math.PI + 360) % 360; cam.elevation = Math.asin(d[2] / cam.distance) * 180 / Math.PI; delete cam.eye; }
  const cv = h('canvas'), side = h('div', { class: 'side' }), info = h('div', { class: 'hint' });
  const body = h('div', { class: 'body3' }, h('div', { style: { position: 'relative', minHeight: 0 } }, cv, h('div', { class: 'hint', style: { position: 'absolute', left: '12px', bottom: '8px', margin: 0, background: 'var(--pane)', padding: '3px 8px', borderRadius: '6px' } }, 'Drag to orbit · Shift-drag to pan · wheel to zoom · click an element to isolate its geoset')), side);
  const modal = openModal(`Viewport · ${n.name || 'Viewport'}`, body, { raw: true, id: 'v3d' });
  ui._v3d = { n, cam };
  const nameIn = h('input', { class: 'inp', id: 'v3d-name', value: 'camera-' + (m.cameras.length + 1) });
  const camSel = h('select', { class: 'inp', id: 'v3d-cam', onchange: e => { const c = deepClone(m.cameras.find(x => x.name === e.target.value)); if (c.eye) { const d = sub3(c.eye, c.target); c.distance = len3(d); c.azimuth = (Math.atan2(d[0], d[1]) * 180 / Math.PI + 360) % 360; c.elevation = Math.asin(d[2] / c.distance) * 180 / Math.PI; delete c.eye; } Object.assign(cam, c); draw(); } }, m.cameras.map(c => h('option', { value: c.name, selected: c.name === camDef0.name }, c.name)));
  const typeSel = h('select', { class: 'inp', id: 'v3d-type', onchange: e => { cam.type = e.target.value; if (cam.type === 'ortho' && !cam.span) cam.span = 200; if (cam.type === 'persp' && !cam.distance) { cam.distance = 320; cam.fov = 35; } draw(); } }, [['ortho', 'Orthographic (axo)'], ['persp', 'Perspective']].map(([v, l]) => h('option', { value: v, selected: cam.type === v }, l)));
  const tree = h('div', { class: 'tree' });
  const resolved = () => parseLayerPath(fillTokens(n.args.path, ctx.vars), m);
  const refreshTree = () => { tree.innerHTML = ''; const cur = resolved().geosets; for (const gs of m._index.geosets) { const dpt = gs.split('/').length - 1; tree.append(h('label', { style: { paddingLeft: 4 + dpt * 14 + 'px' } }, h('input', { type: 'checkbox', checked: cur.includes(gs), onchange: e => toggleGs(gs, e.target.checked) }), gs.split('/').pop())); } };
  const toggleGs = (gs, on) => { const cur = resolved(), list = cur.geosets.filter(x => x !== gs); if (on) list.push(gs); mutate(() => { n.args.path = `${list.join(', ') || '*'} @ ${cur.camera || camDef0.name} : ${cur.style || 'shaded'}`; }); refreshTree(); draw(); };
  side.append(h('div', { class: 'sect', style: { marginTop: 0 } }, 'Camera'), h('div', { class: 'field' }, h('label', { for: 'v3d-cam' }, 'Start from'), h('div', { class: 'ctl' }, camSel), h('span')),
    h('div', { class: 'field' }, h('label', { for: 'v3d-type' }, 'Projection'), h('div', { class: 'ctl' }, typeSel), h('span')), info,
    h('div', { class: 'field' }, h('label', { for: 'v3d-name' }, 'New name'), h('div', { class: 'ctl' }, nameIn), h('span')),
    h('button', { class: 'btn primary small', onclick: () => {
      const name = nameIn.value.trim().replace(/[@:,]/g, '') || 'camera'; if (m.cameras.some(c => c.name === name)) return toast(`A camera named “${name}” exists.`, 'error');
      const def = { name, type: cam.type, target: cam.target.map(v => +v.toFixed(2)), azimuth: +cam.azimuth.toFixed(1), elevation: +cam.elevation.toFixed(1), ...(cam.type === 'ortho' ? { span: +cam.span.toFixed(1) } : { distance: +cam.distance.toFixed(1), fov: cam.fov || 35 }) };
      mutate(() => { const ref = doc.models[n.args.model || 'sample']; ref.extraCameras = [...(ref.extraCameras || []), def]; n.args.camera = name; });
      toast(`Captured “${name}” into the model and set it on this Viewport.`); closeModal();
    } }, 'Capture camera'),
    h('div', { class: 'sect' }, 'Isolated geosets'), tree);
  refreshTree();
  let rendering = false, pending = false;
  function draw() {
    if (rendering) { pending = true; return; } rendering = true;
    requestAnimationFrame(() => {
      try {
        const W = Math.max(64, cv.clientWidth), H = Math.max(64, cv.clientHeight); cv.width = W; cv.height = H;
        const cur = resolved();
        const r = renderModel({ model: m, camDef: cam, option: A.option, isolate: cur.geosets.length ? cur.geosets : ['*'], others: 'ghost', ghostOpacity: 0.35, colour: '#e2553b', style: 'shaded', ambient: 0.55, offsetZ: +A.offsetZ || 0, sun: sunDirection(A) }, 'image', W, H);
        const bg = IMG.solid(W, H, getComputedStyle(document.body).getPropertyValue('--check-a').trim() || '#ffffff');
        cv.getContext('2d').putImageData(IMG.toImageData(IMG.merge(r.img, bg, 'normal', 1)), 0, 0);
        info.textContent = `az ${cam.azimuth.toFixed(0)}° · el ${cam.elevation.toFixed(0)}° · ${cam.type === 'ortho' ? 'span ' + cam.span.toFixed(0) + ' m' : 'distance ' + cam.distance.toFixed(0) + ' m'}`;
      } catch (e) { info.textContent = e.message; }
      rendering = false; if (pending) { pending = false; draw(); }
    });
  }
  let d3 = null;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); d3 = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, pan: e.shiftKey || e.button === 1 }; });
  cv.addEventListener('pointermove', e => {
    if (!d3) return; const dx = e.clientX - d3.x, dy = e.clientY - d3.y; d3.x = e.clientX; d3.y = e.clientY;
    if (d3.pan) { const c = buildCamera(cam, cv.width, cv.height), V = c.V, right = [V[0], V[4], V[8]], up = [V[1], V[5], V[9]], s = cam.type === 'ortho' ? cam.span / cv.height : cam.distance * 0.0016; cam.target = add3(cam.target, add3(scale3(right, -dx * s), scale3(up, dy * s))); }
    else { cam.azimuth = (cam.azimuth - dx * 0.4 + 360) % 360; cam.elevation = clamp(cam.elevation + dy * 0.3, 2, 90); }
    draw();
  });
  cv.addEventListener('pointerup', e => {
    const moved = d3 && Math.hypot(e.clientX - d3.x0, e.clientY - d3.y0) > 3; d3 = null; if (moved) return;
    const r = cv.getBoundingClientRect(), W = cv.width, H = cv.height;
    const res = renderModel({ model: m, camDef: cam, option: A.option, isolate: ['*'], others: 'hide', idBy: 'object', offsetZ: 0 }, 'id', W, H);
    const p = IMG.sample(res.img, e.clientX - r.left, e.clientY - r.top); if (!p || p[3] < 0.5) return;
    const k = (Math.round(p[0] * 255) << 16) | (Math.round(p[1] * 255) << 8) | Math.round(p[2] * 255), hit = res.idMap.get(k); if (!hit) return;
    const el = m._index.byId.get(hit.ids[0]); if (!el) return;
    const cur = resolved().geosets; toggleGs(el.geoset, !cur.includes(el.geoset)); toast(`${el.attrs && el.attrs.name || el.id} · ${el.geoset}`);
  });
  cv.addEventListener('wheel', e => { e.preventDefault(); const k = Math.exp(e.deltaY * 0.0012); if (cam.type === 'ortho') cam.span = clamp(cam.span * k, 10, 2000); else cam.distance = clamp(cam.distance * k, 10, 3000); draw(); }, { passive: false });
  new ResizeObserver(() => draw()).observe(cv);
  void modal;
}


// ---------------------------------------------------------------- the Model node and the parametric modeller
function modelExtras(n) {
  const key = n.args.model, ref = doc.models[key], box = h('div');
  if (!ref) return h('div', { class: 'nmsg warn' }, 'No model selected. Load a model file or start a new one.');
  const c = ocafCache.get(key), m = ref.kind === 'ocaf' ? ocafModel(key) : getModel(key);
  if (ref.kind === 'ocaf' && !m) box.append(h('div', { class: 'nmsg ' + (c && c.error ? 'error' : 'warn'), style: { margin: '0 0 8px' } }, c && c.error ? 'The kernel could not build this model: ' + c.error : 'Building the model with the OpenCascade kernel…'));
  if (m) {
    box.append(h('dl', { class: 'kv' },
      h('dt', null, 'Format'), h('dd', null, ref.kind === 'ocaf' ? 'ocaf-parametric-model' : ref.kind === 'builtin' ? 'built-in sample (diagram-model)' : 'diagram-model/1'),
      h('dt', null, 'Elements'), h('dd', null, String(m.elements.length) + (m.stats ? ` · ${m.stats.triangles.toLocaleString()} triangles` : '')),
      c && c.ms ? h('dt', null, 'Kernel build') : null, c && c.ms ? h('dd', null, (c.ms / 1000).toFixed(1) + ' s' + (m.stats && m.stats.failed.length ? ` · ${m.stats.failed.length} failed` : '')) : null),
      h('div', { class: 'sect' }, `Geosets (${m._index.geosets.length})`),
      h('div', { class: 'tree' }, m._index.geosets.length ? m._index.geosets.map(g => h('label', { style: { paddingLeft: 4 + (g.split('/').length - 1) * 14 + 'px', cursor: 'default' } }, g.split('/').pop(), h('span', { class: 'hint', style: { margin: '0 0 0 auto' } }, String(m.elements.filter(e => geosetMatch(g, e.geoset)).length)))) : h('div', { class: 'hint' }, 'No sets yet. In the modeller, add a Geometrical Set and put geometry in it.')),
      h('div', { class: 'sect' }, `Cameras (${m.cameras.length})`),
      h('div', { class: 'tree' }, m.cameras.length ? m.cameras.map(cm => h('label', { style: { cursor: 'default' } }, cm.name, h('span', { class: 'hint', style: { margin: '0 0 0 auto' } }, cm.lens ? `${cm.lens} mm · ${cm.frameLabel}${cm.generated ? ' · generated' : ''}` : cm.type))) : h('div', { class: 'hint' }, 'No cameras. Add one in the modeller (Camera).')));
  }
  box.append(h('p', { class: 'hint' }, 'Wire this into Extract Geoset and Extract Camera; their lists come from this model. Right-click the node to open the modeller.'));
  return box;
}
Object.assign(ACTIONS, {
  loadModelInto(n) { ui._modelTarget = n.id; $('#fileModel').click(); },
  newModelInto(n, g) {
    let i = 1; while (doc.models['model-' + i]) i++;
    const key = 'model-' + i, json = { format: 'ocaf-parametric-model', version: 1, name: 'Model ' + i, units: 'mm', features: [] };
    mutate(() => { doc.models[key] = { kind: 'ocaf', name: json.name, hash: hashStr(JSON.stringify(json)), json }; n.args.model = key; });
    ACTIONS.openModeller(n, g);
  },
  openModeller(n) { openModeller(n); },
});
// The Feature Modeller runs in a frame beside the graph. A small bridge inside it
// (added when this page was built) answers two calls: load a model, hand back the model.
function openModeller(n) {
  let key = n.args.model, ref = doc.models[key];
  if (!ref || ref.kind !== 'ocaf') {
    toast(ref ? `“${ref.name || key}” is not an ocaf model, so it cannot be edited in the modeller. Starting a new model.` : 'Starting a new model.');
    return ACTIONS.newModelInto(n, currentGraph());
  }
  const frame = h('iframe', { src: 'modeller.html', title: 'Feature Modeller', style: { width: '100%', height: '100%', border: '0', display: 'block', background: 'var(--canvas)' } });
  const note = h('span', { class: 'hint', style: { margin: '0 8px 0 0' } }, 'Starting the modeller…');
  const save = h('button', { class: 'btn primary small', disabled: true }, 'Save to node');
  const saveClose = h('button', { class: 'btn line small', disabled: true }, 'Save and close');
  const body = h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } }, frame);
  const modal = openModal(`Parametric modeller · ${ref.name || key}`, body, { raw: true, id: 'modellerModal', actions: [note, save, saveClose] });
  modal.style.width = 'min(1500px, 100%)'; modal.style.height = 'min(940px, 100%)'; modal.style.maxHeight = 'none';
  const waiting = new Map(); let next = 1, ready = false;
  const call = (name, extra = {}) => new Promise((res, rej) => { const id = next++; waiting.set(id, { res, rej }); frame.contentWindow.postMessage({ dcBridge: 1, id, call: name, ...extra }, '*'); setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); rej(new Error('the modeller did not answer')); } }, 120000); });
  const onMsg = async e => {
    if (e.source !== frame.contentWindow) return; const m = e.data; if (!m || m.dcBridge !== 1) return;
    if (m.ready !== undefined) {
      if (!m.ready) { note.textContent = 'The modeller could not start: ' + (m.error || ''); return; }
      ready = true; note.textContent = 'Loading the model…';
      try { await call('load', { model: doc.models[key].json }); note.textContent = 'Import geometry, put it in a Geometrical Set, add Cameras, then Save to node.'; save.disabled = saveClose.disabled = false; }
      catch (err) { note.textContent = 'Could not load the model: ' + err.message; save.disabled = saveClose.disabled = false; }
      return;
    }
    const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id); m.ok ? w.res(m) : w.rej(new Error(m.error || 'refused'));
  };
  window.addEventListener('message', onMsg);
  const doSave = async (close) => {
    save.disabled = saveClose.disabled = true; note.textContent = 'Saving…';
    try {
      const r = await call('model'), json = r.model, txt = JSON.stringify(json);
      if (!json || json.format !== 'ocaf-parametric-model') throw new Error('the modeller returned no model');
      const changed = hashStr(txt) !== doc.models[key].hash;
      mutate(() => { doc.models[key] = { ...doc.models[key], name: json.name || doc.models[key].name, json, hash: hashStr(txt), saved: new Date().toISOString() }; });
      note.textContent = changed ? `Saved ${json.features.length} features. Rebuilding downstream…` : 'No changes since the last save.';
      if (changed) ensureModel(key).catch(err => toast('Model failed to build: ' + err.message, 'error'));
      if (close) closeModal();
    } catch (err) { note.textContent = 'Save failed: ' + err.message; }
    save.disabled = saveClose.disabled = false;
  };
  save.onclick = () => doSave(false); saveClose.onclick = () => doSave(true);
  const prevClose = ui._onModalClose; ui._onModalClose = () => { window.removeEventListener('message', onMsg); ui._onModalClose = prevClose; };
  setTimeout(() => { if (!ready && document.body.contains(frame)) note.textContent = 'Still starting… the modeller loads a 7 MB kernel the first time.'; }, 8000);
}


// ---------------------------------------------------------------- Nodes tab: every node, findable without knowing its name
function renderPalette() {
  const q = (ui.palQuery || '').toLowerCase();
  const search = h('input', { class: 'inp palette-search', id: 'palSearch', placeholder: 'Search nodes…', value: ui.palQuery || '', autocomplete: 'off',
    oninput: e => { ui.palQuery = e.target.value; const pos = e.target.selectionStart; renderProps(); const s = $('#palSearch'); s.focus(); s.setSelectionRange(pos, pos); } });
  propsBody.append(search, h('p', { class: 'hint' }, 'Click to add next to the selected node (wired to it when the kinds match), or drag onto the canvas.'));
  const order = ['source', 'image', 'mask', 'gen', 'points', 'ai', 'org', 'output'];
  const inDef = view.path.length > 0;
  for (const fam of order) {
    const list = Object.values(NODE_TYPES).filter(t => t.family === fam && t.type !== 'group' && (inDef || (t.type !== 'groupInput' && t.type !== 'groupOutput')) && (!q || (t.label + ' ' + (t.desc || '')).toLowerCase().includes(q)));
    if (!list.length) continue;
    // The Model chain first: it is where a diagram starts.
    const rank = t => { const i = ['modelSource', 'extractGeoset', 'extractCamera', 'render'].indexOf(t.type); return i < 0 ? 99 : i; };
    if (fam === 'source') list.sort((a, b) => rank(a) - rank(b));
    propsBody.append(h('div', { class: 'pal-grp' }, h('i', { style: { background: FAMILIES[fam].colour } }), FAMILIES[fam].label));
    for (const t of list) {
      const b = h('button', { class: 'pal-it', draggable: 'true', title: t.desc || t.label, onclick: () => paletteAdd(t.type) }, h('b', null, t.label), t.desc ? h('span', null, t.desc) : null);
      b.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-dc-node', t.type); e.dataTransfer.effectAllowed = 'copy'; });
      propsBody.append(b);
    }
  }
}
function paletteAdd(type) {
  const g = currentGraph(), sel = [...ui.sel].map(i => g.nodes[i]).find(n => n && n.type !== 'backdrop');
  let x, y;
  if (sel) { const el = nodeEls.get(sel.id); x = sel.x + (el ? el.offsetWidth : 190) + 70; y = sel.y; }
  else { const r = canvasEl.getBoundingClientRect(), p = toWorld(r.left + r.width / 2, r.top + r.height / 2); x = p.x - 90; y = p.y - 60; }
  const n = addNodeAt(type, x, y);
  ui.propsTab = 'props'; renderProps();
  toast(`Added ${T(type).label}${sel && Object.keys(n.inputs).length ? ' and wired it to ' + (sel.name || T(sel.type).label) : ''}.`);
}

// ---------------------------------------------------------------- export any node's image to a file
function exportPort(n) {
  const outs = nodeOutputs(n);
  if (!outs.length) return n.type === 'save' ? { input: 'image' } : null;
  const want = ui.viewPort[n.id], o = outs.find(p => p.n === want && (p.k === 'image' || p.k === 'mask')) || outs.find(p => p.k === 'image') || outs.find(p => p.k === 'mask');
  return o ? { port: o.n } : null;
}
async function exportNode(g, id, port, format = 'png', scope) {
  const n = g.nodes[id]; if (!n) return;
  const ep = port ? { port } : exportPort(n); if (!ep) return toast('This node has no image to export.', 'error');
  const pv = previewVars(), ctx = fullCtx(g, id, ui.exportMult, pv);
  if (scope === undefined) scope = g === currentGraph() ? scopeForView() : null;
  toast(`Rendering ${n.name || T(n.type).label} at ${ctx.w} × ${ctx.h} px…`);
  let v;
  if (ep.input) { const s = n.inputs[ep.input]; v = s ? await evalPort(g, s.node, s.port, ctx, scope) : null; }
  else v = await evalPort(g, id, ep.port, ctx, scope);
  if (!v || !v.d) return toast('Nothing to export: the node produced no image. Check its warnings.', 'error');
  if (v.kind === 'mask') v = IMG.merge(IMG.maskToImage(v, '#ffffff'), IMG.solid(v.w, v.h, '#000000'), 'normal', 1);
  const slug = s => String(s).trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');
  const rowBit = Object.values(pv.vars || {}).length ? '_' + Object.values(pv.vars).map(slug).join('_') : '';
  const name = `${slug(doc.settings.project || 'export')}_${slug(n.name || T(n.type).label)}${rowBit}.${format}`;
  const blob = await encodeImage(v, format, 0.92, { graph: doc.name, node: n.id, nodeName: n.name || T(n.type).label, row: pv.vars, exported: new Date().toISOString(), tool: 'Diagram Compositor' });
  const prev = files.get(name);
  if (prev && prev.url) URL.revokeObjectURL(prev.url);
  files.set(name, { path: name, blob, size: blob.size, w: v.w, h: v.h, hash: '', nodeId: n.id, nodeName: (n.name || T(n.type).label) + ' (export)', row: pv.vars, rowIndex: pv.rowIndex, writes: (prev ? prev.writes : 0) + 1, at: new Date(), first: prev ? prev.first : new Date(), warn: [], url: null, exported: true });
  ui.filesDirty = true;
  await offerDownload(name, blob);
}
function addSaveFor(n) {
  const g = currentGraph(), ep = exportPort(n); if (!ep || ep.input) return;
  const el = nodeEls.get(n.id), slug = String(n.name || T(n.type).label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram';
  const perm = Object.values(doc.nodes).find(x => x.type === 'permutation');
  let s;
  mutate(() => {
    s = createNode('save', n.x + (el ? el.offsetWidth : 190) + 70, n.y); s.name = 'Save ' + (n.name || T(n.type).label);
    s.args.diagram = slug; s.args.pattern = '{project}_{diagram}_v{version:02}';
    s.inputs.image = { node: n.id, port: ep.port }; g.nodes[s.id] = s; ui.sel = new Set([s.id]);
  });
  toast(`Save node added: writes ${saveName(s, {}, 0).path} whenever the image changes.${perm ? ' Wire the Permutation into its Rows input for one file per row.' : ''}`);
}
function expHint(n) { const r = n ? cameraRes(currentGraph(), n.id) : null, k = +ui.exportMult > 0 ? ui.exportMult : r && r.mult, [w, h] = outSize(k, r);
  return r ? `One file now, at ${w} × ${h} px: ${r.w} × ${r.h} from "${r.node.name || 'Extract Camera'}" (${r.camera}) × ${outMult(k)}. A Save node instead rewrites its file every time this image changes.`
    : `One file now, at ${w} × ${h} px canvas (${outMult(k)}× the ${doc.settings.width} × ${doc.settings.height} viewport). An Extract Camera upstream sizes it from the camera instead. A Save node instead rewrites its file every time this image changes.`; }
function exportExtras(n) {
  const ep = exportPort(n); if (!ep) return null;
  const fmt = ui.exportFormat || 'png';
  return h('div', null, h('div', { class: 'sect' }, 'Export'),
    h('div', { class: 'export-row' },
      h('select', { class: 'inp', id: 'exp-format', style: { width: '86px' }, onchange: e => { ui.exportFormat = e.target.value; } }, [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP']].map(([v, l]) => h('option', { value: v, selected: v === fmt }, l))),
      h('label', { class: 'hint', title: 'Multiplier of the viewport resolution', style: { display: 'flex', alignItems: 'center', gap: '4px' } }, '×', h('input', { class: 'inp', type: 'number', min: 0.1, max: 16, step: 0.25, value: +ui.exportMult > 0 ? ui.exportMult : (cameraRes(currentGraph(), n.id) || {}).mult || outMult(), style: { width: '58px' }, oninput: e => { const v = +e.target.value; if (v > 0) { ui.exportMult = v; const hn = $('#exp-size'); if (hn) hn.textContent = expHint(n); } } })),
      h('button', { class: 'btn primary small', onclick: () => exportNode(currentGraph(), n.id, null, ui.exportFormat || 'png') }, 'Export'),
      n.type !== 'save' ? h('button', { class: 'btn line small', onclick: () => addSaveFor(n) }, 'Add Save node') : null),
    h('p', { class: 'hint', id: 'exp-size' }, expHint(n)));
}
