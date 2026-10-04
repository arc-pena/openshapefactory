// =====================================================================
// Models. A model is plain JSON (format "diagram-model/1"): elements with a
// stable id, a geoset path and attributes; named points; named cameras.
// The built-in competition sample is regenerated from its parameters so a
// parameter edit behaves like a model file changing on disk.
// =====================================================================
const MODEL_FORMAT = 'diagram-model/1';
const SAMPLE_PARAMS = [
  { key: 'o1_tower_h', label: 'Option 1 · tower height', def: 96, min: 30, max: 180, unit: 'm' },
  { key: 'o1_podium_h', label: 'Option 1 · podium height', def: 14, min: 4, max: 30, unit: 'm' },
  { key: 'o2_slab_h', label: 'Option 2 · slab height', def: 48, min: 12, max: 90, unit: 'm' },
  { key: 'o2_gap', label: 'Option 2 · slab gap', def: 18, min: 8, max: 34, unit: 'm' },
  { key: 'o3_court_h', label: 'Option 3 · courtyard height', def: 26, min: 9, max: 60, unit: 'm' },
  { key: 'o3_court_w', label: 'Option 3 · courtyard width', def: 66, min: 40, max: 80, unit: 'm' },
  { key: 'o4_tiers', label: 'Option 4 · terrace tiers', def: 5, min: 2, max: 8, unit: '', step: 1 },
  { key: 'o4_step', label: 'Option 4 · tier height', def: 7, min: 3, max: 14, unit: 'm' },
  { key: 'ctx_seed', label: 'Context · variation seed', def: 7, min: 1, max: 99, unit: '', step: 1 },
];
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

function buildSampleModel(p) {
  const P = {}; for (const d of SAMPLE_PARAMS) P[d.key] = p && p[d.key] != null ? +p[d.key] : d.def;
  const els = [], pts = [];
  const box = (id, geoset, w, d, hh, x, y, z = 0, attrs = {}, rot = 0) => els.push({ id, geoset, shape: 'box', size: [w, d, hh], at: [x, y, z], rot, attrs: { name: attrs.name || id, type: attrs.type || 'mass', area: Math.round(w * d * Math.max(1, Math.round(hh / 3.5))), height: hh, ...attrs } });
  const R = rng(P.ctx_seed * 7919);
  // ground, roads, parcel
  box('ground', 'context/ground', 300, 240, 0.4, 0, 0, -0.4, { type: 'ground', name: 'Ground plane' });
  box('road-ew', 'context/roads', 300, 12, 0.06, 0, -46, 0, { type: 'road', name: 'Harbour Road' });
  box('road-ns', 'context/roads', 12, 240, 0.06, -58, 0, 0, { type: 'road', name: 'Quay Street' });
  box('road-ew2', 'context/roads', 300, 9, 0.06, 0, 48, 0, { type: 'road', name: 'Mill Lane' });
  box('road-ns2', 'context/roads', 9, 240, 0.06, 60, 0, 0, { type: 'road', name: 'Station Walk' });
  box('parcel', 'site/parcel', 96, 76, 0.1, 0, 0, 0, { type: 'site', name: 'Competition parcel' });
  // context buildings on a block grid around the parcel
  let n = 0;
  const blocksX = [[-148, -66], [-50, 54], [68, 148]], blocksY = [[-118, -54], [-38, 42], [55, 118]];
  for (const [x0, x1] of blocksX) for (const [y0, y1] of blocksY) {
    if (x0 === -50 && y0 === -38) continue; // the parcel block
    const cols = Math.max(1, Math.round((x1 - x0) / 30)), rows = Math.max(1, Math.round((y1 - y0) / 30));
    const cw = (x1 - x0) / cols, rh = (y1 - y0) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (R() < 0.12) continue;
      const w = cw * (0.55 + R() * 0.32), d = rh * (0.55 + R() * 0.32);
      const cx = x0 + cw * (i + 0.5) + (R() - 0.5) * (cw - w) * 0.8, cy = y0 + rh * (j + 0.5) + (R() - 0.5) * (rh - d) * 0.8;
      const near = Math.hypot(cx, cy) < 110;
      const hh = Math.round((8 + R() * (near ? 26 : 38) + (cx + cy > 120 ? 14 : 0)) / 3.5) * 3.5;
      n++; box('ctx-b' + String(n).padStart(2, '0'), 'context/buildings', +w.toFixed(1), +d.toFixed(1), hh, +cx.toFixed(1), +cy.toFixed(1), 0, { type: 'building', name: 'Context ' + n, levels: Math.round(hh / 3.5) });
    }
  }
  // street trees
  let t = 0;
  for (let x = -140; x <= 140; x += 17) for (const y of [-55, -37]) { if (Math.abs(x + 58) < 10 || Math.abs(x - 60) < 10) continue; t++; const s = 0.8 + R() * 0.45;
    els.push({ id: 'tree-' + t, geoset: 'context/trees', shape: 'sphere', r: 3.2 * s, at: [x, y, 5.2 * s], attrs: { type: 'tree', name: 'Street tree ' + t } });
    els.push({ id: 'trunk-' + t, geoset: 'context/trees', shape: 'cyl', r: 0.3, size: [0, 0, 3.4 * s], at: [x, y, 0], attrs: { type: 'tree', name: 'Trunk ' + t } }); }
  // options on the parcel
  const opt = (k, id, ...a) => box(`${k}-${id}`, ...a);
  // Option 1 — tower and podium
  opt('o1', 'podium', 'option1/podium', 70, 50, P.o1_podium_h, -6, -4, 0, { type: 'podium', name: 'Podium' });
  opt('o1', 'tower', 'option1/tower', 26, 26, P.o1_tower_h, 16, 8, P.o1_podium_h, { type: 'tower', name: 'Tower' });
  opt('o1', 'crown', 'option1/tower', 18, 18, 6, 16, 8, P.o1_podium_h + P.o1_tower_h, { type: 'tower', name: 'Crown' });
  opt('o1', 'land', 'option1/landscape', 30, 20, 0.3, -30, 26, 0, { type: 'landscape', name: 'Pocket park' });
  pts.push({ id: 'o1-e1', geoset: 'option1/entrances', at: [-20, -29, 0], dir: [0, -1, 0], attrs: { name: 'Main entrance', main: 1 } });
  pts.push({ id: 'o1-e2', geoset: 'option1/entrances', at: [-41, 4, 0], dir: [-1, 0, 0], attrs: { name: 'Quay entrance' } });
  pts.push({ id: 'o1-e3', geoset: 'option1/entrances', at: [29, -29, 0], dir: [0, -1, 0], attrs: { name: 'Tower lobby' } });
  // Option 2 — twin slabs
  const g = P.o2_gap;
  opt('o2', 'slab-a', 'option2/slabs', 16, 62, P.o2_slab_h, -(g / 2 + 8), 0, 0, { type: 'slab', name: 'Slab A' });
  opt('o2', 'slab-b', 'option2/slabs', 16, 62, Math.round(P.o2_slab_h * 0.72), g / 2 + 8, 0, 0, { type: 'slab', name: 'Slab B' });
  opt('o2', 'bridge', 'option2/slabs', g, 10, 4, 0, 6, Math.round(P.o2_slab_h * 0.4), { type: 'bridge', name: 'Sky bridge' });
  opt('o2', 'land', 'option2/landscape', g - 4, 56, 0.3, 0, 0, 0, { type: 'landscape', name: 'Garden street' });
  pts.push({ id: 'o2-e1', geoset: 'option2/entrances', at: [0, -31, 0], dir: [0, -1, 0], attrs: { name: 'Garden gate', main: 1 } });
  pts.push({ id: 'o2-e2', geoset: 'option2/entrances', at: [-(g / 2 + 16), -10, 0], dir: [-1, 0, 0], attrs: { name: 'Slab A lobby' } });
  pts.push({ id: 'o2-e3', geoset: 'option2/entrances', at: [g / 2 + 16, 10, 0], dir: [1, 0, 0], attrs: { name: 'Slab B lobby' } });
  // Option 3 — courtyard block
  const cw = P.o3_court_w, cd = cw * 0.74, bw = 12, ch = P.o3_court_h;
  opt('o3', 'n', 'option3/block', cw, bw, ch, 0, cd / 2 - bw / 2, 0, { type: 'block', name: 'North wing' });
  opt('o3', 's', 'option3/block', cw, bw, ch * 0.75, 0, -cd / 2 + bw / 2, 0, { type: 'block', name: 'South wing' });
  opt('o3', 'e', 'option3/block', bw, cd - 2 * bw, ch, cw / 2 - bw / 2, 0, 0, { type: 'block', name: 'East wing' });
  opt('o3', 'w', 'option3/block', bw, cd - 2 * bw, ch * 1.25, -cw / 2 + bw / 2, 0, 0, { type: 'block', name: 'West wing' });
  opt('o3', 'land', 'option3/landscape', cw - 2 * bw - 2, cd - 2 * bw - 2, 0.3, 0, 0, 0, { type: 'landscape', name: 'Courtyard' });
  pts.push({ id: 'o3-e1', geoset: 'option3/entrances', at: [0, -cd / 2, 0], dir: [0, -1, 0], attrs: { name: 'Courtyard arch', main: 1 } });
  pts.push({ id: 'o3-e2', geoset: 'option3/entrances', at: [-cw / 2, 8, 0], dir: [-1, 0, 0], attrs: { name: 'West lobby' } });
  pts.push({ id: 'o3-e3', geoset: 'option3/entrances', at: [cw / 2, -8, 0], dir: [1, 0, 0], attrs: { name: 'East lobby' } });
  // Option 4 — stepped terraces
  const tiers = Math.max(1, Math.round(P.o4_tiers));
  for (let i = 0; i < tiers; i++) { const k = 1 - i / (tiers + 1.5);
    opt('o4', 'tier' + (i + 1), 'option4/terraces', 78 * k, 58 * k, P.o4_step, -8 * (1 - k) * 2, 6 * (1 - k) * 2, i * P.o4_step, { type: 'terrace', name: 'Tier ' + (i + 1) }); }
  opt('o4', 'land', 'option4/landscape', 22, 14, 0.3, 30, -26, 0, { type: 'landscape', name: 'Forecourt' });
  pts.push({ id: 'o4-e1', geoset: 'option4/entrances', at: [-8, -29, 0], dir: [0, -1, 0], attrs: { name: 'Forecourt entrance', main: 1 } });
  pts.push({ id: 'o4-e2', geoset: 'option4/entrances', at: [-47, 2, 0], dir: [-1, 0, 0], attrs: { name: 'Quay terrace' } });
  pts.push({ id: 'o4-e3', geoset: 'option4/entrances', at: [31, 10, 0], dir: [1, 0, 0], attrs: { name: 'Station steps' } });
  // Every option element gets a level attribute for Attribute Field.
  for (const e of els) if (/^option/.test(e.geoset) && e.size) e.attrs.levels = Math.max(1, Math.round(e.size[2] / 3.5));
  return {
    format: MODEL_FORMAT, name: 'Competition sample', units: 'm',
    options: ['option1', 'option2', 'option3', 'option4'],
    elements: els, points: pts,
    cameras: [
      { name: 'camera1', type: 'ortho', target: [0, 0, 12], azimuth: 215, elevation: 35, span: 205 },
      { name: 'plan', type: 'ortho', target: [0, 0, 0], azimuth: 0, elevation: 90, span: 200 },
      { name: 'aerial-NE', type: 'persp', target: [0, 0, 18], azimuth: 40, elevation: 28, distance: 330, fov: 34 },
      { name: 'street', type: 'persp', eye: [-78, -78, 1.7], target: [0, 0, 22], fov: 52 },
    ],
  };
}

// Resolve a model reference in the document to model JSON (memoised by content).
const modelCache = new Map();
function getModel(key) {
  key = key || 'sample';
  const ref = doc.models[key];
  if (!ref) return null;
  if (ref.kind === 'ocaf') {
    const m = ocafModel(key);
    if (!m) { ensureModel(key).catch(() => { }); return null; }
    if (!m._index) { m._key = key; m._index = indexModel(m); }
    return m;
  }
  const sig = ref.kind === 'builtin' ? 'b:' + stableJSON(ref.params || {}) + stableJSON(ref.extraCameras || []) : 'j:' + (ref.hash || '');
  const c = modelCache.get(key);
  if (c && c.sig === sig) return c.model;
  let model = ref.kind === 'builtin' ? buildSampleModel(ref.params) : ref.json;
  if (!model) return null;
  model = { ...model, cameras: [...(model.cameras || []), ...(ref.extraCameras || [])] };
  for (const e of model.elements) e._h = e._h || hashObj(e);
  model._key = key; model._index = indexModel(model);
  modelCache.set(key, { sig, model });
  return model;
}
function indexModel(m) {
  const geosets = new Set(m.sets || []);
  for (const e of [...m.elements, ...(m.points || []), ...(m.vectors || [])]) { const parts = e.geoset.split('/'); for (let i = 1; i <= parts.length; i++) geosets.add(parts.slice(0, i).join('/')); }
  return { geosets: [...geosets].sort(), byId: new Map(m.elements.map(e => [e.id, e])) };
}
// Geoset pattern matching: exact path, any descendant, and "*" wildcards per segment.
function geosetMatch(pattern, path) {
  pattern = pattern.trim(); if (!pattern) return false;
  if (pattern[0] === '=') return path === pattern.slice(1);
  if (pattern === '*' || pattern === path) return true;
  if (!pattern.includes('*')) return path.startsWith(pattern + '/');
  const re = new RegExp('^' + pattern.split('/').map(s => s === '*' ? '[^/]+' : s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('/') + '(/.*)?$');
  return re.test(path);
}
const matchAny = (patterns, path) => patterns.some(p => geosetMatch(p, path));

// Layer path grammar: "<geoset>[,<geoset>] @ <camera> : <style>", plus the short slash form.
const RENDER_STYLES = ['shaded', 'flat', 'shadows', 'hiddenline', 'arctic', 'objectid'];
const STYLE_LABEL = { shaded: 'Shaded', flat: 'Flat shaded', shadows: 'Sun shadows', hiddenline: 'Hidden line', arctic: 'Arctic', objectid: 'Object ID' };
function parseLayerPath(str, model) {
  str = String(str || '').trim(); const out = { geosets: [], camera: null, style: null, warn: [] };
  if (!str) return out;
  let m = str.match(/^(.*?)\s*@\s*([^:]+?)\s*(?::\s*(.+))?$/);
  if (m) { out.geosets = m[1].split(',').map(s => s.trim()).filter(Boolean); out.camera = m[2].trim(); out.style = m[3] ? m[3].trim().replace(/[\s-]/g, '').toLowerCase() : null; }
  else if (str.includes('/') && model) {
    // short form: geoset/.../camera/style — parsed against known names
    const seg = str.split('/'); let style = null;
    const last = seg[seg.length - 1].replace(/[\s-]/g, '').toLowerCase();
    if (RENDER_STYLES.includes(last)) { style = last; seg.pop(); }
    const camNames = model.cameras.map(c => c.name);
    let cam = null;
    for (let k = 1; k <= Math.min(2, seg.length - 1) && !cam; k++) { const cand = seg.slice(-k).join('/'); const alt = seg.slice(-k).join(''); if (camNames.includes(cand)) cam = cand; else if (camNames.includes(alt)) cam = alt; if (cam) seg.splice(seg.length - k, k); }
    out.geosets = [seg.join('/')]; out.camera = cam; out.style = style;
    if (!cam) out.warn.push('No camera found in short path; using the node\'s camera setting.');
  } else out.geosets = str.split(',').map(s => s.trim()).filter(Boolean);
  if (out.style && !RENDER_STYLES.includes(out.style)) { out.warn.push(`Unknown style "${out.style}".`); out.style = null; }
  return out;
}
function canonicalPath(p) { return `${p.geosets.join(', ')} @ ${p.camera || '?'}${p.style ? ' : ' + p.style : ''}`; }

// ---------- sun position ----------
function sunDirection(a) {
  let az = +a.sunAzimuth, alt = +a.sunAltitude;
  if (a.sunMode === 'place') {
    const lat = (+a.latitude) * Math.PI / 180, N = dayOfYear(a.date || '2026-06-21');
    const decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + N) / 365);
    const H = (parseTime(a.time || '15:00') - 12) * 15 * Math.PI / 180;
    const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    alt = Math.asin(clamp(sinAlt, -1, 1)) * 180 / Math.PI;
    az = (Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) * 180 / Math.PI + 180 + 360) % 360;
  }
  const r = az * Math.PI / 180, e = Math.max(0.5, alt) * Math.PI / 180;
  return { dir: [Math.sin(r) * Math.cos(e), Math.cos(r) * Math.cos(e), Math.sin(e)], az, alt };
}
function dayOfYear(s) { const d = new Date(s + 'T12:00:00Z'); if (isNaN(d)) return 172; return Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5); }
function parseTime(s) { const m = String(s).match(/(\d+)(?::(\d+))?/); return m ? +m[1] + (+m[2] || 0) / 60 : 15; }
