// =====================================================================
// Curves as strokes: the Render node's "Curves" style. Picks the curves of a geoset (lines, splines,
// sketches, and the free wires inside an imported STEP compound), projects them through the camera
// and draws them like Illustrator strokes - weight, width profile, dashes, caps and arrowheads.
// =====================================================================
const CURVE_PROFILES = [['uniform', 'Uniform'], ['swell', 'Thin – fat – thin'], ['brush', 'Brush (soft ends)'], ['taperEnd', 'Fat → thin'], ['taperStart', 'Thin → fat'], ['pinch', 'Fat – thin – fat']];
const CURVE_DASHES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['long', 'Long dash'], ['dotted', 'Dotted'], ['dashdot', 'Dash dot']];
const ARROWS = [['none', 'None'], ['triangle', 'Triangle'], ['stealth', 'Stealth'], ['open', 'Open (V)'], ['circle', 'Dot'], ['square', 'Square'], ['diamond', 'Diamond'], ['bar', 'Bar']];
// Dash patterns in stroke widths: on, off, on, off...
const DASH_PATTERN = { dashed: [3, 2], long: [8, 3], dashdot: [5, 2, 0, 2], dotted: [0, 2] };

// Edge segments of an element joined into polylines. "loose" keeps only curves that are not the
// boundary of a face: an imported compound gives faces and free wires in one edge list, and a face
// boundary is recognisable because its points are vertices of the face mesh (both come from the
// same triangulation, scaled the same way, so they match exactly).
function curveChains(e, mode) {
  const cache = e._cc || (e._cc = {}); if (cache[mode]) return cache[mode];
  const E = e.edges; if (!E || !E.length) return (cache[mode] = []);
  const q = (x, y, z) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
  let onMesh = null;
  if (mode === 'loose' && !(e.attrs && e.attrs.curve) && e.mesh && e.mesh.pos.length) { onMesh = new Set(); const P = e.mesh.pos; for (let i = 0; i + 2 < P.length; i += 3) onMesh.add(q(P[i], P[i + 1], P[i + 2])); }
  const segs = [];
  for (let i = 0; i + 5 < E.length; i += 6) {
    const a = [E[i], E[i + 1], E[i + 2]], b = [E[i + 3], E[i + 4], E[i + 5]], ka = q(...a), kb = q(...b);
    if (ka === kb || (onMesh && onMesh.has(ka) && onMesh.has(kb))) continue;
    segs.push({ a, b, ka, kb });
  }
  const adj = new Map(), link = (k, i) => { let l = adj.get(k); if (!l) adj.set(k, l = []); l.push(i); };
  segs.forEach((s, i) => { link(s.ka, i); link(s.kb, i); });
  const used = new Uint8Array(segs.length), chains = [];
  // Walk from a point while exactly two segments meet there; a branch or a free end stops the chain.
  const walk = (key, last, add) => {
    for (;;) {
      const l = adj.get(key); if (!l || l.length !== 2) return;
      const j = l[0] === last ? l[1] : l[0]; if (used[j]) return; used[j] = 1;
      const s = segs[j]; if (s.ka === key) { add(s.b); key = s.kb; } else { add(s.a); key = s.ka; } last = j;
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = 1;
    const s = segs[i], fwd = [s.a, s.b], back = [];
    walk(s.kb, i, p => fwd.push(p)); walk(s.ka, i, p => back.push(p));
    chains.push(back.reverse().concat(fwd));
  }
  return (cache[mode] = chains);
}

function profileWidth(kind, t, min) {
  const s = Math.sin(Math.PI * clamp(t, 0, 1));
  switch (kind) {
    case 'swell': return min + (1 - min) * s;
    case 'brush': return min + (1 - min) * Math.pow(s, 0.45);
    case 'taperEnd': return 1 - (1 - min) * t;
    case 'taperStart': return min + (1 - min) * t;
    case 'pinch': return 1 - (1 - min) * s;
    default: return 1;
  }
}

function renderCurves(ctx, L, A) {
  const { model, camDef, w, h, vScale } = L, iso = L.isolate && L.isolate.length ? L.isolate : ['*'];
  const cam = buildCamera(camDef, w, h, { vScale, extent: glExtent(model) }), off = [0, 0, +A.offsetZ || 0];
  let depth = null;
  if (A.occlude !== 'over') {
    try { const r = renderModel({ model, camDef, isolate: iso, others: 'holdout', offsetZ: A.offsetZ, option: L.option, vScale, style: 'shaded' }, 'depthAll', w, h); if (r.depth && r.depth.length === w * h) depth = r.depth; } catch { }
  }
  const visible = p => {
    if (!depth) return true;
    const x = Math.round(p.x), y = Math.round(p.y); if (x < 0 || y < 0 || x >= w || y >= h) return true;
    let mn = Infinity; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mn = Math.min(mn, depth[clampI(y + dy, 0, h - 1) * w + clampI(x + dx, 0, w - 1)]);
    return p.depth <= mn + Math.max(0.02, p.depth * 0.004);
  };
  const baseW = Math.max(0.25, (+A.strokeWidth || 1) * ctx.scale), step = Math.max(1, 1.5 * ctx.scale), minLen = (+A.minLength || 0) * ctx.scale;
  // Every chain becomes runs of densely sampled screen points; a point behind the camera splits a run.
  const runs = [];
  for (const e of model.elements) {
    if (optionExcluded(model, L.option, e.geoset) || !matchAny(iso, e.geoset)) continue;
    const shift = matchAny(iso, e.geoset) ? off : [0, 0, 0];
    for (const chain of curveChains(e, A.curveSource || 'loose')) {
      let run = [];
      const flush = () => { if (run.length > 1) runs.push(run); run = []; };
      for (let i = 0; i < chain.length; i++) {
        const p3 = add3(chain[i], shift), pr = projectPoint(cam, p3);
        if (!pr || pr.depth <= cam.near) { flush(); continue; }
        if (run.length) {
          const prev = run[run.length - 1], n = Math.min(400, Math.ceil(Math.hypot(pr.x - prev.x, pr.y - prev.y) / step));
          for (let k = 1; k < n; k++) { const q = projectPoint(cam, add3(add3(chain[i - 1], shift), scale3(sub3(chain[i], chain[i - 1]), k / n))); if (q) run.push(q); }
        }
        run.push(pr);
      }
      flush();
    }
  }
  let count = 0;
  const img = IMG.draw(w, h, g => {
    const col = colourCss(A.strokeColour || '#1c2026'); g.fillStyle = col; g.strokeStyle = col; g.lineJoin = 'round';
    for (let P of runs) {
      if (A.reverse) P = P.slice().reverse();
      const s = [0]; for (let i = 1; i < P.length; i++) s.push(s[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
      const total = s[s.length - 1]; if (total < Math.max(0.5, minLen)) continue;
      count++;
      drawStrokeRun(g, P, s, total, A, baseW, visible);
    }
  });
  return { image: img, count, runs: runs.length };
}

function drawStrokeRun(g, P, s, total, A, baseW, visible) {
  const vis = P.map(visible), minW = clamp((+A.minWidth || 0) / 100, 0, 1), prof = A.profile || 'uniform';
  const widthAt = d => baseW * profileWidth(prof, d / total, minW);
  // Point and direction at arc length d.
  const at = d => {
    d = clamp(d, 0, total); let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= d) lo = m; else hi = m; }
    const t = s[hi] > s[lo] ? (d - s[lo]) / (s[hi] - s[lo]) : 0, a = P[lo], b = P[hi];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: a.x + dx * t, y: a.y + dy * t, tx: dx / l, ty: dy / l, i: lo };
  };
  const visAt = d => { const p = at(d); return vis[p.i] && vis[Math.min(vis.length - 1, p.i + 1)]; };
  const arrowLen = Math.max(2, (+A.arrowSize || 4) * baseW);
  const inset = kind => ({ triangle: 0.85, stealth: 0.62 }[kind] || 0) * arrowLen + (kind === 'open' ? baseW * 0.5 : 0);
  const aS = A.arrowStart || 'none', aE = A.arrowEnd || 'none';
  const s0 = Math.min(total / 2, aS === 'none' ? 0 : inset(aS)), s1 = Math.max(total / 2, total - (aE === 'none' ? 0 : inset(aE)));
  // Intervals to draw: the dash pattern, cut where geometry hides the curve.
  let dash = [[s0, s1]], dots = null;
  const pat = DASH_PATTERN[A.dash];
  if (pat) {
    const k = baseW * Math.max(0.1, +A.dashScale || 1), seq = pat.map(v => v * k); dash = []; dots = A.dash === 'dotted' ? [] : null;
    let d = s0, i = 0;
    while (d < s1 && i < 1e5) {
      const on = seq[i % seq.length], gap = seq[(i + 1) % seq.length];
      if (on === 0) { if (dots) dots.push(d); else dash.push([d, d]); } else dash.push([d, Math.min(s1, d + on)]);
      d += on + gap; i += 2;
    }
  }
  const visRuns = []; let start = null;
  for (let i = 0; i < P.length; i++) { const v = vis[i]; if (v && start === null) start = s[i]; if (!v && start !== null) { visRuns.push([start, s[i]]); start = null; } }
  if (start !== null) visRuns.push([start, total]);
  const cap = A.cap || 'round';
  if (dots) { for (const d of dots) if (visAt(d)) { const p = at(d); g.beginPath(); g.arc(p.x, p.y, widthAt(d) / 2, 0, Math.PI * 2); g.fill(); } }
  else for (const [a0, b0] of dash) for (const [va, vb] of visRuns) {
    const a = Math.max(a0, va), b = Math.min(b0, vb);
    if (b < a || (b === a && a0 !== b0)) continue;
    if (b === a) { const p = at(a); g.beginPath(); g.arc(p.x, p.y, widthAt(a) / 2, 0, Math.PI * 2); g.fill(); continue; }
    fillSpan(g, at, a, b, widthAt, s, cap);
  }
  if (aS !== 'none' && vis[0]) { const p = at(0), q = at(Math.min(total, arrowLen * 0.6)); drawArrow(g, aS, p.x, p.y, p.x - q.x, p.y - q.y, arrowLen, baseW); }
  if (aE !== 'none' && vis[vis.length - 1]) { const p = at(total), q = at(Math.max(0, total - arrowLen * 0.6)); drawArrow(g, aE, p.x, p.y, p.x - q.x, p.y - q.y, arrowLen, baseW); }
}

// A variable-width span from arc length a to b, filled as one outline: offsets either side of the
// centre line, with joins mitred up to twice the width so corners keep their weight.
function fillSpan(g, at, a, b, widthAt, s, cap) {
  const ds = [a]; for (let i = 0; i < s.length; i++) if (s[i] > a && s[i] < b) ds.push(s[i]); ds.push(b);
  const pts = ds.map(at), L = [], R = [];
  const dir = (p, q) => { const x = q.x - p.x, y = q.y - p.y, l = Math.hypot(x, y); return l > 1e-9 ? [x / l, y / l] : null; };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], din = i > 0 ? dir(pts[i - 1], p) : null, dout = i < pts.length - 1 ? dir(p, pts[i + 1]) : null;
    let t = din && dout ? [din[0] + dout[0], din[1] + dout[1]] : din || dout || [p.tx, p.ty], k = 1;
    const tl = Math.hypot(t[0], t[1]) || 1; t = [t[0] / tl, t[1] / tl];
    if (din && dout) k = Math.min(2, 1 / Math.max(0.5, t[0] * din[0] + t[1] * din[1]));
    const hw = widthAt(ds[i]) / 2 * k;
    L.push([p.x - t[1] * hw, p.y + t[0] * hw]); R.push([p.x + t[1] * hw, p.y - t[0] * hw]);
  }
  g.beginPath(); g.moveTo(L[0][0], L[0][1]); for (const q of L) g.lineTo(q[0], q[1]); for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]); g.closePath(); g.fill();
  if (cap === 'round') for (const [d, p] of [[a, pts[0]], [b, pts[pts.length - 1]]]) { g.beginPath(); g.arc(p.x, p.y, widthAt(d) / 2, 0, Math.PI * 2); g.fill(); }
  if (cap === 'square') for (const [d, p, sg] of [[a, pts[0], -1], [b, pts[pts.length - 1], 1]]) {
    const hw = widthAt(d) / 2, ex = p.tx * hw * sg, ey = p.ty * hw * sg, nx = -p.ty * hw, ny = p.tx * hw;
    g.beginPath(); g.moveTo(p.x + nx, p.y + ny); g.lineTo(p.x + nx + ex, p.y + ny + ey); g.lineTo(p.x - nx + ex, p.y - ny + ey); g.lineTo(p.x - nx, p.y - ny); g.closePath(); g.fill();
  }
}

// An arrowhead with its tip at (x, y), pointing along (dx, dy).
function drawArrow(g, kind, x, y, dx, dy, len, lw) {
  const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, hw = len * 0.45;
  const T = (u, v) => [x + ux * u - uy * v, y + uy * u + ux * v];
  const poly = pts => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.fill(); };
  if (kind === 'triangle') poly([T(0, 0), T(-len, hw), T(-len, -hw)]);
  else if (kind === 'stealth') poly([T(0, 0), T(-len, hw * 1.1), T(-len * 0.62, 0), T(-len, -hw * 1.1)]);
  else if (kind === 'diamond') poly([T(len * 0.5, 0), T(0, hw * 0.75), T(-len * 0.5, 0), T(0, -hw * 0.75)]);
  else if (kind === 'square') { const r = len * 0.32; poly([T(r, r), T(-r, r), T(-r, -r), T(r, -r)]); }
  else if (kind === 'circle') { g.beginPath(); g.arc(x, y, len * 0.34, 0, Math.PI * 2); g.fill(); }
  else if (kind === 'open' || kind === 'bar') {
    g.save(); g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
    if (kind === 'open') { g.moveTo(...T(-len * 0.9, hw)); g.lineTo(...T(0, 0)); g.lineTo(...T(-len * 0.9, -hw)); }
    else { g.moveTo(...T(0, hw)); g.lineTo(...T(0, -hw)); }
    g.stroke(); g.restore();
  }
}
