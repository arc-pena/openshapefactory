import * as THREE from 'three';
import { createRng, TAU, lerp } from './math.js';

const W = 512;
const H = 352;

/** #rrggbb -> [r, g, b] in 0..255 */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return `rgb(${Math.round(lerp(ca[0], cb[0], t))},${Math.round(lerp(ca[1], cb[1], t))},${Math.round(
    lerp(ca[2], cb[2], t)
  )})`;
}

/* ------------------------------------------------------------------ *
 * Per-mood painters. Everything is drawn on a 2D canvas so the build
 * ships without a single image file, and every panel still reads as a
 * distinct piece of artwork once it is rebuilt out of cubes.
 * ------------------------------------------------------------------ */

const PAINTERS = {
  waves(ctx, p, rng) {
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) {
        const y =
          H * (0.28 + t * 0.62) +
          Math.sin(x * 0.012 + i * 0.7) * 22 * (1 - t) +
          Math.sin(x * 0.031 + i * 1.9) * 9;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = mixHex(p.mid, p.base, t * 0.95);
      ctx.globalAlpha = 0.9;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.hot;
    ctx.beginPath();
    ctx.arc(W * 0.7, H * 0.24, 34, 0, TAU);
    ctx.fill();
  },

  blobs(ctx, p, rng) {
    for (let i = 0; i < 40; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const r = 14 + rng() * 78;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, mixHex(p.hot, p.mid, rng() * 0.7));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  },

  bars(ctx, p, rng) {
    const n = 22;
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      const h = H * (0.12 + Math.pow(rng(), 1.6) * 0.82);
      ctx.fillStyle = mixHex(p.mid, p.hot, i / n);
      ctx.fillRect(i * bw + 2, H - h, bw - 4, h);
    }
    ctx.strokeStyle = p.hot;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.32);
    ctx.lineTo(W, H * 0.32);
    ctx.stroke();
  },

  contours(ctx, p, rng) {
    const cx = W * 0.44;
    const cy = H * 0.52;
    for (let i = 16; i > 0; i--) {
      ctx.beginPath();
      for (let a = 0; a <= TAU + 0.1; a += 0.09) {
        const wobble = 1 + Math.sin(a * 3 + i * 0.6) * 0.14 + Math.sin(a * 7 - i) * 0.05;
        const r = i * 12 * wobble;
        const x = cx + Math.cos(a) * r * 1.5;
        const y = cy + Math.sin(a) * r;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = mixHex(p.base, p.mid, 1 - i / 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = p.hot;
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, TAU);
    ctx.fill();
  },

  folds(ctx, p, rng) {
    const step = 46;
    for (let y = -H; y < H * 2; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y - H * 0.45);
      ctx.lineTo(W, y - H * 0.45 + step * 0.6);
      ctx.lineTo(0, y + step * 0.6);
      ctx.closePath();
      ctx.fillStyle = mixHex(p.base, p.mid, 0.25 + rng() * 0.6);
      ctx.fill();
    }
    ctx.strokeStyle = p.hot;
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const y = H * (0.18 + i * 0.17);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y - H * 0.4);
      ctx.stroke();
    }
  },

  halo(ctx, p, rng) {
    const cx = W * 0.5;
    const cy = H * 0.48;
    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, W * 0.55);
    g.addColorStop(0, p.hot);
    g.addColorStop(0.35, p.mid);
    g.addColorStop(1, p.base);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) {
      ctx.lineWidth = 6 + i * 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(cx, cy, 52 + i * 26, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = 'rgba(255,255,255,' + rng() * 0.5 + ')';
      ctx.fillRect(rng() * W, rng() * H, 2, 2);
    }
  },
};

/**
 * Paints one item's artwork and returns both a GPU texture (for the glass
 * backing plane) and the low-res cell samples used to colour the cube mosaic.
 */
export function createArtwork(item, cols, rows) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const p = item.palette;
  const rng = createRng(p.seed);

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, W, H);
  (PAINTERS[item.mood] ?? PAINTERS.blobs)(ctx, p, rng);

  // Unifying grade: darken the rim so panels sink into the world's fog.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, W * 0.78);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // Lift: the mosaic is lit, not emissive, so the source art has to carry
  // enough value for the cubes to read at all once shading multiplies in.
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  autoLevels(ctx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  return { texture, cells: sampleCells(canvas, cols, rows) };
}

/**
 * Stretches each piece to a known value range. The palettes are deliberately
 * low-key, and a mosaic built from a flat dark image reads as a black wall —
 * the relief only shows once the artwork itself has darks *and* highlights.
 * Percentile clipping keeps a stray bright pixel from eating the whole range.
 */
function autoLevels(ctx, low = 0.04, high = 0.95) {
  const image = ctx.getImageData(0, 0, W, H);
  const d = image.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
  }

  const total = d.length / 4;
  const at = (fraction) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= total * fraction) return v;
    }
    return 255;
  };

  const lo = at(0.02);
  const hi = at(0.98);
  if (hi - lo < 8) return; // near-flat art: leave it alone rather than amplify noise

  const scale = ((high - low) * 255) / (hi - lo);
  const offset = low * 255 - lo * scale;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clampByte(d[i] * scale + offset);
    d[i + 1] = clampByte(d[i + 1] * scale + offset);
    d[i + 2] = clampByte(d[i + 2] * scale + offset);
  }
  ctx.putImageData(image, 0, 0);
}

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Box-filters the artwork down to one sample per mosaic cell by letting the
 * browser do the resampling, then returns colours + luminance per cell.
 */
function sampleCells(source, cols, rows) {
  const small = document.createElement('canvas');
  small.width = cols;
  small.height = rows;
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(source, 0, 0, cols, rows);
  const { data } = sctx.getImageData(0, 0, cols, rows);

  const color = new Float32Array(cols * rows * 3);
  const luma = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    color[i * 3] = r;
    color[i * 3 + 1] = g;
    color[i * 3 + 2] = b;
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return { cols, rows, color, luma };
}
