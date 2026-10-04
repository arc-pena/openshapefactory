// =====================================================================
// Image library. Images are premultiplied RGBA Float32 in [0,1], in
// sRGB-encoded values: blending in encoded space is what Photoshop does
// by default, so Multiply/Screen/Add/Overlay match it per channel.
// Masks are single-channel Float32.
// =====================================================================
const IMG = {};
IMG.image = (w, h) => ({ kind: 'image', w, h, d: new Float32Array(w * h * 4) });
IMG.mask = (w, h) => ({ kind: 'mask', w, h, d: new Float32Array(w * h) });
IMG.cloneImg = im => ({ kind: im.kind, w: im.w, h: im.h, d: new Float32Array(im.d) });

IMG.fromImageData = (id) => {
  const im = IMG.image(id.width, id.height), s = id.data, d = im.d;
  for (let i = 0; i < s.length; i += 4) { const a = s[i + 3] / 255; d[i] = s[i] / 255 * a; d[i + 1] = s[i + 1] / 255 * a; d[i + 2] = s[i + 2] / 255 * a; d[i + 3] = a; }
  return im;
};
IMG.fromCanvas = (cv) => IMG.fromImageData(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height));
IMG.toImageData = (im, opts = {}) => {
  const id = new ImageData(im.w, im.h), o = id.data, d = im.d;
  if (im.kind === 'mask') {
    for (let i = 0, j = 0; i < d.length; i++, j += 4) { const v = Math.round(clamp(d[i]) * 255); o[j] = o[j + 1] = o[j + 2] = v; o[j + 3] = 255; }
    return id;
  }
  if (opts.alpha) {
    for (let i = 0; i < d.length; i += 4) { const v = Math.round(clamp(d[i + 3]) * 255); o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255; }
    return id;
  }
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a <= 0) { o[i + 3] = 0; continue; }
    const ia = 1 / a;
    o[i] = Math.round(clamp(d[i] * ia) * 255); o[i + 1] = Math.round(clamp(d[i + 1] * ia) * 255); o[i + 2] = Math.round(clamp(d[i + 2] * ia) * 255); o[i + 3] = Math.round(clamp(a) * 255);
  }
  return id;
};
IMG.toCanvas = (im, opts) => { const cv = document.createElement('canvas'); cv.width = im.w; cv.height = im.h; cv.getContext('2d').putImageData(IMG.toImageData(im, opts), 0, 0); return cv; };
IMG.canvasOf = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };

// Bilinear resample (premultiplied, so edges do not fringe).
IMG.resample = (im, w, h) => {
  if (!im || (im.w === w && im.h === h)) return im;
  const ch = im.kind === 'mask' ? 1 : 4, out = im.kind === 'mask' ? IMG.mask(w, h) : IMG.image(w, h), s = im.d, d = out.d;
  const sx = im.w / w, sy = im.h / h;
  for (let y = 0; y < h; y++) {
    const fy = clamp((y + 0.5) * sy - 0.5, 0, im.h - 1), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, im.h - 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = clamp((x + 0.5) * sx - 0.5, 0, im.w - 1), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, im.w - 1), tx = fx - x0;
      const a = (y0 * im.w + x0) * ch, b = (y0 * im.w + x1) * ch, c = (y1 * im.w + x0) * ch, e = (y1 * im.w + x1) * ch, o = (y * w + x) * ch;
      for (let k = 0; k < ch; k++) d[o + k] = (s[a + k] * (1 - tx) + s[b + k] * tx) * (1 - ty) + (s[c + k] * (1 - tx) + s[e + k] * tx) * ty;
    }
  }
  return out;
};
IMG.fit = (im, w, h) => im ? IMG.resample(im, w, h) : null;
// Same shape: resample. Different shape (a 16:9 camera frame over a 4:3 sheet): place it centred at
// its own pixel size, so a camera-frame render keeps its proportions and stays registered.
IMG.conform = (im, w, h) => {
  if (!im || (im.w === w && im.h === h)) return im;
  if (Math.abs(im.w / im.h - w / h) < 0.01 * (w / h)) return IMG.resample(im, w, h);
  const ch = im.kind === 'mask' ? 1 : 4, out = im.kind === 'mask' ? IMG.mask(w, h) : IMG.image(w, h), ox = Math.round((w - im.w) / 2), oy = Math.round((h - im.h) / 2);
  for (let y = 0; y < im.h; y++) { const ty = y + oy; if (ty < 0 || ty >= h) continue; for (let x = 0; x < im.w; x++) { const tx = x + ox; if (tx < 0 || tx >= w) continue; const s = (y * im.w + x) * ch, d = (ty * w + tx) * ch; for (let k = 0; k < ch; k++) out.d[d + k] = im.d[s + k]; } }
  return out;
};

// ---------- blend modes ----------
const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'add', 'subtract', 'difference', 'darken', 'lighten', 'colour', 'luminosity',
  'over', 'under', 'in', 'out', 'atop', 'mask', 'stencil'];
const BLEND_LABEL = { normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', 'soft-light': 'Soft Light', 'hard-light': 'Hard Light', add: 'Add (Linear Dodge)',
  subtract: 'Subtract', difference: 'Difference', darken: 'Darken', lighten: 'Lighten', colour: 'Colour', luminosity: 'Luminosity',
  over: 'Over (Nuke)', under: 'Under (Nuke)', in: 'In (Nuke)', out: 'Out (Nuke)', atop: 'Atop (Nuke)', mask: 'Mask (Nuke)', stencil: 'Stencil (Nuke)' };
const NUKE_OPS = new Set(['over', 'under', 'in', 'out', 'atop', 'mask', 'stencil']);
const softD = c => c <= 0.25 ? ((16 * c - 12) * c + 4) * c : Math.sqrt(c);
function sepBlend(mode, cb, cs) {
  switch (mode) {
    case 'multiply': return cb * cs;
    case 'screen': return cb + cs - cb * cs;
    case 'overlay': return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case 'hard-light': return cs <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case 'soft-light': return cs <= 0.5 ? cb - (1 - 2 * cs) * cb * (1 - cb) : cb + (2 * cs - 1) * (softD(cb) - cb);
    case 'add': return Math.min(1, cb + cs);
    case 'subtract': return Math.max(0, cb - cs);
    case 'difference': return Math.abs(cb - cs);
    case 'darken': return Math.min(cb, cs);
    case 'lighten': return Math.max(cb, cs);
    default: return cs;
  }
}
const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
function clipColour(c) {
  const L = lum(c[0], c[1], c[2]), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  if (n < 0) for (let i = 0; i < 3; i++) c[i] = L + (c[i] - L) * L / (L - n || 1);
  if (x > 1) for (let i = 0; i < 3; i++) c[i] = L + (c[i] - L) * (1 - L) / (x - L || 1);
  return c;
}
function setLum(c, l) { const d = l - lum(c[0], c[1], c[2]); return clipColour([c[0] + d, c[1] + d, c[2] + d]); }

// Composite A (source) onto B (backdrop). Result has B's size; A is resampled to it.
IMG.merge = (A, B, mode = 'normal', opacity = 1, M = null, w, h) => {
  if (!B && !A) return IMG.image(w, h);
  if (!B) { B = IMG.image(A.w, A.h); }
  w = B.w; h = B.h;
  if (!A) return IMG.cloneImg(B);
  A = IMG.conform(A, w, h); if (M) M = IMG.conform(M, w, h);
  const out = IMG.image(w, h), a = A.d, b = B.d, o = out.d, m = M ? M.d : null, n = w * h;
  const nuke = NUKE_OPS.has(mode), cs = [0, 0, 0], cb = [0, 0, 0];
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const k = opacity * (m ? m[p] : 1);
    const Aa = a[i + 3], Ba = b[i + 3];
    if (nuke) {
      let r, g, bl, al;
      const ar = a[i], ag = a[i + 1], ab = a[i + 2], br = b[i], bg = b[i + 1], bb = b[i + 2];
      switch (mode) {
        case 'over': { const t = 1 - Aa; r = ar + br * t; g = ag + bg * t; bl = ab + bb * t; al = Aa + Ba * t; break; }
        case 'under': { const t = 1 - Ba; r = ar * t + br; g = ag * t + bg; bl = ab * t + bb; al = Aa * t + Ba; break; }
        case 'in': r = ar * Ba; g = ag * Ba; bl = ab * Ba; al = Aa * Ba; break;
        case 'out': { const t = 1 - Ba; r = ar * t; g = ag * t; bl = ab * t; al = Aa * t; break; }
        case 'atop': { const t = 1 - Aa; r = ar * Ba + br * t; g = ag * Ba + bg * t; bl = ab * Ba + bb * t; al = Ba; break; }
        case 'mask': r = br * Aa; g = bg * Aa; bl = bb * Aa; al = Ba * Aa; break;
        case 'stencil': { const t = 1 - Aa; r = br * t; g = bg * t; bl = bb * t; al = Ba * t; break; }
      }
      o[i] = lerp(br, r, k); o[i + 1] = lerp(bg, g, k); o[i + 2] = lerp(bb, bl, k); o[i + 3] = lerp(Ba, al, k);
      continue;
    }
    const as = Aa * k;
    if (as <= 0) { o[i] = b[i]; o[i + 1] = b[i + 1]; o[i + 2] = b[i + 2]; o[i + 3] = Ba; continue; }
    const ia = 1 / Aa; cs[0] = a[i] * ia; cs[1] = a[i + 1] * ia; cs[2] = a[i + 2] * ia;
    if (Ba > 0) { const ib = 1 / Ba; cb[0] = b[i] * ib; cb[1] = b[i + 1] * ib; cb[2] = b[i + 2] * ib; } else { cb[0] = cb[1] = cb[2] = 0; }
    let Bf;
    if (mode === 'colour') Bf = setLum([cs[0], cs[1], cs[2]], lum(cb[0], cb[1], cb[2]));
    else if (mode === 'luminosity') Bf = setLum([cb[0], cb[1], cb[2]], lum(cs[0], cs[1], cs[2]));
    else Bf = [sepBlend(mode, cb[0], cs[0]), sepBlend(mode, cb[1], cs[1]), sepBlend(mode, cb[2], cs[2])];
    const t1 = as * (1 - Ba), t2 = Ba * (1 - as), t3 = as * Ba;
    for (let c = 0; c < 3; c++) o[i + c] = cs[c] * t1 + cb[c] * t2 + Bf[c] * t3;
    o[i + 3] = as + Ba * (1 - as);
  }
  return out;
};

// ---------- per-pixel adjustments ----------
function mapUnpremult(im, fn) {
  const out = IMG.image(im.w, im.h), s = im.d, d = out.d, c = [0, 0, 0, 0];
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]; if (a <= 0) continue;
    c[0] = s[i] / a; c[1] = s[i + 1] / a; c[2] = s[i + 2] / a; c[3] = a;
    fn(c);
    const na = clamp(c[3]);
    d[i] = clamp(c[0]) * na; d[i + 1] = clamp(c[1]) * na; d[i + 2] = clamp(c[2]) * na; d[i + 3] = na;
  }
  return out;
}
IMG.opacity = (im, o) => { const out = IMG.image(im.w, im.h); for (let i = 0; i < im.d.length; i++) out.d[i] = im.d[i] * o; return out; };
IMG.overlayColour = (im, col, amt = 1) => { col = parseColour(col); return mapUnpremult(im, c => { c[0] = lerp(c[0], col[0], amt); c[1] = lerp(c[1], col[1], amt); c[2] = lerp(c[2], col[2], amt); c[3] *= lerp(1, col[3], amt); }); };
IMG.levels = (im, inB, inW, gamma, outB, outW) => {
  const g = 1 / Math.max(0.01, gamma), span = Math.max(1e-4, inW - inB);
  return mapUnpremult(im, c => { for (let k = 0; k < 3; k++) c[k] = outB + (outW - outB) * Math.pow(clamp((c[k] - inB) / span), g); });
};
function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let hh = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh /= 6; }
  return [hh, s, l];
}
function hue2rgb(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
function hsl2rgb(hh, s, l) { if (s === 0) return [l, l, l]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [hue2rgb(p, q, hh + 1 / 3), hue2rgb(p, q, hh), hue2rgb(p, q, hh - 1 / 3)]; }
IMG.hsl = (im, dh, ds, dl) => mapUnpremult(im, c => { const x = rgb2hsl(c[0], c[1], c[2]); const r = hsl2rgb(((x[0] + dh / 360) % 1 + 1) % 1, clamp(x[1] * (1 + ds)), clamp(x[2] + dl)); c[0] = r[0]; c[1] = r[1]; c[2] = r[2]; });
IMG.invert = im => mapUnpremult(im, c => { c[0] = 1 - c[0]; c[1] = 1 - c[1]; c[2] = 1 - c[2]; });
IMG.threshold = (im, t, lo, hi) => { lo = parseColour(lo); hi = parseColour(hi); return mapUnpremult(im, c => { const v = lum(c[0], c[1], c[2]) >= t ? hi : lo; c[0] = v[0]; c[1] = v[1]; c[2] = v[2]; }); };
IMG.posterize = (im, n) => { n = Math.max(2, Math.round(n)); return mapUnpremult(im, c => { for (let k = 0; k < 3; k++) c[k] = Math.round(c[k] * (n - 1)) / (n - 1); }); };

// ---------- blur: three box passes approximate a gaussian ----------
function boxPass(src, dst, w, h, ch, r, horiz) {
  const len = horiz ? w : h, lines = horiz ? h : w, inv = 1 / (2 * r + 1);
  const acc = new Float64Array(ch);
  for (let L = 0; L < lines; L++) {
    const idx = t => (horiz ? (L * w + clampI(t, 0, w - 1)) : (clampI(t, 0, h - 1) * w + L)) * ch;
    acc.fill(0);
    for (let t = -r; t <= r; t++) { const j = idx(t); for (let k = 0; k < ch; k++) acc[k] += src[j + k]; }
    for (let t = 0; t < len; t++) {
      const o = idx(t); for (let k = 0; k < ch; k++) dst[o + k] = acc[k] * inv;
      const add = idx(t + r + 1), sub = idx(t - r);
      for (let k = 0; k < ch; k++) acc[k] += src[add + k] - src[sub + k];
    }
  }
}
const clampI = (v, a, b) => v < a ? a : v > b ? b : v;
IMG.blur = (im, radius) => {
  const r = Math.max(0, radius); if (r < 0.5) return im.kind === 'mask' ? IMG.cloneImg(im) : IMG.cloneImg(im);
  const ch = im.kind === 'mask' ? 1 : 4, w = im.w, h = im.h;
  // Three passes of box radius rb give variance ~ r^2 when rb = r*sqrt(1/... ) ; keep it simple and visually even.
  const rb = Math.max(1, Math.round(r / 1.73));
  let a = new Float32Array(im.d), b = new Float32Array(im.d.length);
  for (let pass = 0; pass < 3; pass++) { boxPass(a, b, w, h, ch, rb, true); boxPass(b, a, w, h, ch, rb, false); }
  return { kind: im.kind, w, h, d: a };
};

// ---------- distance fields (Felzenszwalb exact EDT) ----------
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt(inside, w, h) { // distance from each pixel to the nearest "inside" pixel
  const INF = 1e20, g = new Float64Array(w * h), n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < w * h; i++) g[i] = inside[i] ? 0 : INF;
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]); }
  return g;
}
// Signed distance in px from a coverage channel: negative inside, positive outside, edge at 0.
IMG.sdf = (cov, w, h) => {
  const n = w * h, ins = new Uint8Array(n), outs = new Uint8Array(n);
  for (let i = 0; i < n; i++) { ins[i] = cov[i] >= 0.5 ? 1 : 0; outs[i] = 1 - ins[i]; }
  const dOut = edt(ins, w, h), dIn = edt(outs, w, h), sd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = cov[i];
    if (c > 0.02 && c < 0.98) sd[i] = 0.5 - c;
    else sd[i] = ins[i] ? -(dIn[i] - 0.5) : (dOut[i] - 0.5);
  }
  return sd;
};
IMG.alphaOf = im => { if (im.kind === 'mask') return im.d; const a = new Float32Array(im.w * im.h); for (let i = 0; i < a.length; i++) a[i] = im.d[i * 4 + 3]; return a; };
IMG.maskFromAlpha = im => ({ kind: 'mask', w: im.w, h: im.h, d: new Float32Array(IMG.alphaOf(im)) });

IMG.stroke = (src, width, colour, position = 'outside', opacity = 1, keepSource = true) => {
  const w = src.w, h = src.h, cov = IMG.alphaOf(src), sd = IMG.sdf(cov, w, h), col = parseColour(colour);
  const st = IMG.image(w, h), d = st.d;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const s = sd[p]; let a;
    if (position === 'outside') a = clamp(width - s + 0.5) * clamp(s + 0.5);
    else if (position === 'inside') a = clamp(width + s + 0.5) * clamp(0.5 - s);
    else a = clamp(width / 2 - Math.abs(s) + 0.5);
    a *= opacity * col[3];
    d[i] = col[0] * a; d[i + 1] = col[1] * a; d[i + 2] = col[2] * a; d[i + 3] = a;
  }
  if (!keepSource || src.kind === 'mask') return st;
  return position === 'outside' ? IMG.merge(src, st, 'normal', 1) : IMG.merge(st, src, 'normal', 1);
};
IMG.growShrink = (m, px) => { const sd = IMG.sdf(m.d, m.w, m.h), out = IMG.mask(m.w, m.h); for (let i = 0; i < sd.length; i++) out.d[i] = clamp(px - sd[i] + 0.5); return out; };
IMG.maskCombine = (A, B, op) => {
  if (!A && !B) return null; if (!A) return IMG.cloneImg(B); if (!B) return IMG.cloneImg(A);
  B = IMG.resample(B, A.w, A.h); const out = IMG.mask(A.w, A.h), a = A.d, b = B.d, o = out.d;
  for (let i = 0; i < o.length; i++) {
    switch (op) {
      case 'union': o[i] = Math.max(a[i], b[i]); break;
      case 'subtract': o[i] = a[i] * (1 - b[i]); break;
      case 'intersect': o[i] = Math.min(a[i], b[i]); break;
      case 'difference': o[i] = Math.abs(a[i] - b[i]); break;
      default: o[i] = clamp(a[i] + b[i]);
    }
  }
  return out;
};
IMG.lumaKey = (im, lo, hi, invert) => { const m = IMG.mask(im.w, im.h); for (let p = 0, i = 0; p < m.d.length; p++, i += 4) { const a = im.d[i + 3]; const L = a > 0 ? lum(im.d[i] / a, im.d[i + 1] / a, im.d[i + 2] / a) : 0; let v = clamp((L - lo) / Math.max(1e-4, hi - lo)) * a; m.d[p] = invert ? a - v : v; } return m; };
IMG.colourKey = (im, col, tol, soft) => {
  col = parseColour(col); const m = IMG.mask(im.w, im.h);
  for (let p = 0, i = 0; p < m.d.length; p++, i += 4) {
    const a = im.d[i + 3]; if (a <= 0) continue;
    const dr = im.d[i] / a - col[0], dg = im.d[i + 1] / a - col[1], db = im.d[i + 2] / a - col[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    m.d[p] = clamp(1 - (dist - tol) / Math.max(1e-4, soft)) * a;
  }
  return m;
};
IMG.setAlpha = (im, m, mode = 'multiply') => {
  m = IMG.resample(m, im.w, im.h); const out = IMG.image(im.w, im.h);
  for (let p = 0, i = 0; p < m.d.length; p++, i += 4) {
    const a = im.d[i + 3];
    if (mode === 'replace') { const k = a > 0 ? m.d[p] / a : 0; for (let c = 0; c < 3; c++) out.d[i + c] = im.d[i + c] * k; out.d[i + 3] = m.d[p]; if (a <= 0) out.d[i + 3] = 0; }
    else { const k = m.d[p]; for (let c = 0; c < 4; c++) out.d[i + c] = im.d[i + c] * k; }
  }
  return out;
};
IMG.invertMask = m => { const o = IMG.mask(m.w, m.h); for (let i = 0; i < o.d.length; i++) o.d[i] = 1 - m.d[i]; return o; };
IMG.maskToImage = (m, col) => { col = parseColour(col || '#ffffff'); const o = IMG.image(m.w, m.h); for (let p = 0, i = 0; p < m.d.length; p++, i += 4) { const a = m.d[p] * col[3]; o.d[i] = col[0] * a; o.d[i + 1] = col[1] * a; o.d[i + 2] = col[2] * a; o.d[i + 3] = a; } return o; };

// ---------- generators ----------
IMG.solid = (w, h, col) => { col = parseColour(col); const o = IMG.image(w, h), a = col[3]; for (let i = 0; i < o.d.length; i += 4) { o.d[i] = col[0] * a; o.d[i + 1] = col[1] * a; o.d[i + 2] = col[2] * a; o.d[i + 3] = a; } return o; };
IMG.gradient = (w, h, c1, c2, type, angle, cx = 0.5, cy = 0.5, radius = 0.7) => {
  c1 = parseColour(c1); c2 = parseColour(c2); const o = IMG.image(w, h), r = angle * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
  const half = (Math.abs(ux) * w + Math.abs(uy) * h) / 2, R = radius * Math.hypot(w, h) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t = type === 'radial' ? Math.hypot(x - cx * w, y - cy * h) / R : (((x - w / 2) * ux + (y - h / 2) * uy) / half + 1) / 2;
    t = clamp(t); const i = (y * w + x) * 4, a = lerp(c1[3], c2[3], t);
    o.d[i] = lerp(c1[0], c2[0], t) * a; o.d[i + 1] = lerp(c1[1], c2[1], t) * a; o.d[i + 2] = lerp(c1[2], c2[2], t) * a; o.d[i + 3] = a;
  }
  return o;
};
IMG.hatch = (m, angle, spacing, width, colour, pattern, bg) => {
  const col = parseColour(colour), bgc = bg ? parseColour(bg) : null, o = IMG.image(m.w, m.h);
  const r = angle * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r), sp = Math.max(1, spacing), hw = width / 2;
  const line = (x, y, cx, cy) => { const t = x * cx + y * cy; let f = ((t % sp) + sp) % sp; f = Math.min(f, sp - f); return clamp(hw - f + 0.5); };
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const p = y * m.w + x, cov = m.d[p]; if (cov <= 0) continue;
    let v;
    if (pattern === 'cross') v = Math.max(line(x, y, -uy, ux), line(x, y, ux, uy));
    else if (pattern === 'dots') { const a = x * ux + y * uy, b = -x * uy + y * ux; const fa = ((a % sp) + sp) % sp - sp / 2, fb = ((b % sp) + sp) % sp - sp / 2; v = clamp(hw - Math.hypot(fa, fb) + 0.5); }
    else v = line(x, y, -uy, ux);
    const i = p * 4;
    let rr = 0, gg = 0, bb = 0, aa = 0;
    if (bgc) { aa = bgc[3]; rr = bgc[0] * aa; gg = bgc[1] * aa; bb = bgc[2] * aa; }
    const la = v * col[3];
    rr = col[0] * la + rr * (1 - la); gg = col[1] * la + gg * (1 - la); bb = col[2] * la + bb * (1 - la); aa = la + aa * (1 - la);
    o.d[i] = rr * cov; o.d[i + 1] = gg * cov; o.d[i + 2] = bb * cov; o.d[i + 3] = aa * cov;
  }
  return o;
};
IMG.transform = (im, dx, dy, scale, rot, w, h) => {
  w = w || im.w; h = h || im.h;
  const ch = im.kind === 'mask' ? 1 : 4, out = im.kind === 'mask' ? IMG.mask(w, h) : IMG.image(w, h);
  const r = -rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), cx = w / 2, cy = h / 2, icx = im.w / 2, icy = im.h / 2, k = 1 / (scale || 1e-6);
  const src = im.d, d = out.d;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x + 0.5 - cx - dx, Y = y + 0.5 - cy - dy;
    const sx = (X * c - Y * s) * k + icx - 0.5, sy = (X * s + Y * c) * k + icy - 0.5;
    if (sx < -1 || sy < -1 || sx > im.w || sy > im.h) continue;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0, o = (y * w + x) * ch;
    for (let kk = 0; kk < ch; kk++) {
      const g = (xx, yy) => (xx < 0 || yy < 0 || xx >= im.w || yy >= im.h) ? 0 : src[(yy * im.w + xx) * ch + kk];
      d[o + kk] = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
    }
  }
  return out;
};
// Shift by integer px (exact; used by Explode in orthographic views).
IMG.shift = (im, dx, dy) => {
  dx = Math.round(dx); dy = Math.round(dy); const ch = im.kind === 'mask' ? 1 : 4, out = im.kind === 'mask' ? IMG.mask(im.w, im.h) : IMG.image(im.w, im.h);
  for (let y = 0; y < im.h; y++) { const sy = y - dy; if (sy < 0 || sy >= im.h) continue; for (let x = 0; x < im.w; x++) { const sx = x - dx; if (sx < 0 || sx >= im.w) continue; const o = (y * im.w + x) * ch, s = (sy * im.w + sx) * ch; for (let k = 0; k < ch; k++) out.d[o + k] = im.d[s + k]; } }
  return out;
};
IMG.bbox = im => { const a = IMG.alphaOf(im); let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1; for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (a[y * im.w + x] > 0.05) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x0, y0, x1, y1 }; };
// Draw with a 2D canvas, then bring the pixels back into the float pipeline.
IMG.draw = (w, h, fn) => { const cv = IMG.canvasOf(w, h), g = cv.getContext('2d'); fn(g, w, h); return IMG.fromCanvas(cv); };
IMG.sample = (im, x, y) => { x = Math.floor(x); y = Math.floor(y); if (!im || x < 0 || y < 0 || x >= im.w || y >= im.h) return null; if (im.kind === 'mask') return [im.d[y * im.w + x]]; const i = (y * im.w + x) * 4; return [im.d[i], im.d[i + 1], im.d[i + 2], im.d[i + 3]]; };
IMG.bytes = im => im.d.byteLength;
