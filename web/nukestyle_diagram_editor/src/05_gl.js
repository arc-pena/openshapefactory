// =====================================================================
// Viewport renderer: a small WebGL2 bridge that draws model elements
// offscreen at canvas resolution. Every render style is drawn from the
// same camera matrices, so all outputs align to the pixel.
// =====================================================================
const M4 = {
  mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy * Math.PI / 360), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; },
  ortho(l, r, b, t, n, f) { const o = new Float32Array(16); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o; },
  lookAt(e, t, u) {
    let z = norm3(sub3(e, t)), x = norm3(cross3(u, z)); if (!isFinite(x[0]) || len3(cross3(u, z)) < 1e-6) x = norm3(cross3([0, 1, 0], z)); const y = cross3(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot3(x, e), -dot3(y, e), -dot3(z, e), 1]);
  },
  xf(m, v) { const x = v[0], y = v[1], z = v[2], w = v[3] == null ? 1 : v[3]; return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w]; },
};
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = a => Math.hypot(a[0], a[1], a[2]), norm3 = a => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------- camera from a model camera definition ----------
function buildCamera(def, w, h, overrides = {}) {
  const asp = w / h;
  let eye, target = def.target || [0, 0, 0];
  const az = (def.azimuth || 0) * Math.PI / 180, el = (def.elevation == null ? 30 : def.elevation) * Math.PI / 180;
  const dirFrom = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  if (def.type === 'ortho') {
    eye = add3(target, scale3(dirFrom, 1500));
    const up = def.elevation >= 89.5 ? [Math.sin(az), Math.cos(az), 0] : [0, 0, 1];
    const V = M4.lookAt(eye, target, up), hs = (def.span || 200) / 2, ws = hs * asp;
    const P = M4.ortho(-ws, ws, -hs, hs, 10, 3200);
    return { def, ortho: true, V, P, VP: M4.mul(P, V), eye, target, near: 10, far: 3200, w, h, viewDir: norm3(sub3(target, eye)), mPerPx: (def.span || 200) / h };
  }
  eye = def.eye || add3(target, scale3(dirFrom, def.distance || 300));
  // The modeller's camera: vertical fov from the lens (24 mm tall frame), then roll about the view axis.
  const fov0 = def.fov || (def.lens ? fovFromLens(def.lens) : 40);
  const fov = overrides.vScale ? Math.atan(Math.tan(fov0 * Math.PI / 360) * overrides.vScale) * 360 / Math.PI : fov0;
  // Oriented exactly as the modeller's camera (three.js lookAt with Z up): world Z stays up however
  // steeply it looks down, so a near-vertical plan camera keeps the orientation it has there. Only a
  // camera looking exactly straight up or down is nudged, the same 1e-4 along X three.js uses.
  const fwd = norm3(sub3(target, eye)), world = [0, 0, 1];
  let back = scale3(fwd, -1); if (len3(cross3(world, back)) < 1e-9) back = norm3(add3(back, [1e-4, 0, 0]));
  let right = norm3(cross3(world, back)), up = cross3(back, right);
  if (def.roll) { const t = -def.roll * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); up = add3(scale3(up, c), scale3(right, -s)); }
  // Clip planes follow the model's size: a 0.9 m bracket and a 300 m site both keep depth precision.
  let near = 0.5, far = 4000;
  if (overrides.extent) { const d = len3(sub3(eye, overrides.extent.c)), r = overrides.extent.r; far = d + r * 2 + 1; near = clamp((d - r) * 0.5, Math.max(1e-4, far * 2e-6), 0.5); }
  const V = M4.lookAt(eye, target, up), P = M4.persp(fov, asp, near, far);
  return { def, ortho: false, V, P, VP: M4.mul(P, V), eye, target, near, far, w, h, viewDir: fwd, fov };
}
// World point -> pixel at the camera's w,h; depth is linear view distance.
function projectPoint(cam, p) {
  const c = M4.xf(cam.VP, p); if (c[3] <= 1e-6) return null;
  const v = M4.xf(cam.V, p);
  return { x: (c[0] / c[3] + 1) / 2 * cam.w, y: (1 - c[1] / c[3]) / 2 * cam.h, depth: -v[2], ndcz: c[2] / c[3] };
}
function pxPerMetre(cam, p) {
  if (cam.ortho) return cam.h / (cam.def.span || 200);
  const v = M4.xf(cam.V, p), z = Math.max(0.5, -v[2]);
  return cam.h / (2 * z * Math.tan(cam.fov * Math.PI / 360));
}

// ---------- tessellation (Z up, metres) ----------
function tessellate(e) {
  const tris = []; // [p0,p1,p2] each [x,y,z]; smooth normals in parallel array
  const nrm = [];
  const rot = (e.rot || 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot);
  const at = e.at || [0, 0, 0];
  const T = q => [at[0] + q[0] * cr - q[1] * sr, at[1] + q[0] * sr + q[1] * cr, at[2] + q[2]];
  const quad = (a, b, c, d, n) => { tris.push([a, b, c], [a, c, d]); nrm.push([n, n, n], [n, n, n]); };
  if (e.shape === 'mesh') {
    const P = e.mesh.pos, N = e.mesh.nrm, I = e.mesh.idx;
    const v = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], n = i => N ? [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]] : null;
    for (let t = 0; t + 2 < I.length; t += 3) {
      const a = v(I[t]), b = v(I[t + 1]), c = v(I[t + 2]); tris.push([a, b, c]);
      const fn = norm3(cross3(sub3(b, a), sub3(c, a)));
      nrm.push([n(I[t]) || fn, n(I[t + 1]) || fn, n(I[t + 2]) || fn]);
    }
    return { tris, nrm };
  }
  if (e.shape === 'box') {
    const [w, d, hh] = e.size, x = w / 2, y = d / 2;
    const v = [[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0], [-x, -y, hh], [x, -y, hh], [x, y, hh], [-x, y, hh]].map(T);
    const N = q => norm3([q[0] * cr - q[1] * sr, q[0] * sr + q[1] * cr, q[2]]);
    quad(v[0], v[3], v[2], v[1], N([0, 0, -1])); quad(v[4], v[5], v[6], v[7], N([0, 0, 1]));
    quad(v[0], v[1], v[5], v[4], N([0, -1, 0])); quad(v[1], v[2], v[6], v[5], N([1, 0, 0]));
    quad(v[2], v[3], v[7], v[6], N([0, 1, 0])); quad(v[3], v[0], v[4], v[7], N([-1, 0, 0]));
  } else if (e.shape === 'cyl') {
    const r = e.r, hh = e.size ? e.size[2] : e.h, seg = 16;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p0 = [Math.cos(a0) * r, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, Math.sin(a1) * r];
      const b0 = T([p0[0], p0[1], 0]), b1 = T([p1[0], p1[1], 0]), t0 = T([p0[0], p0[1], hh]), t1 = T([p1[0], p1[1], hh]);
      const n0 = [Math.cos(a0), Math.sin(a0), 0], n1 = [Math.cos(a1), Math.sin(a1), 0];
      tris.push([b0, b1, t1], [b0, t1, t0]); nrm.push([n0, n1, n1], [n0, n1, n0]);
      const ct = T([0, 0, hh]), cb = T([0, 0, 0]);
      tris.push([ct, t0, t1]); nrm.push([[0, 0, 1], [0, 0, 1], [0, 0, 1]]);
      tris.push([cb, b1, b0]); nrm.push([[0, 0, -1], [0, 0, -1], [0, 0, -1]]);
    }
  } else if (e.shape === 'sphere') {
    const r = e.r, us = 14, vs = 9;
    const P = (i, j) => { const th = i / us * Math.PI * 2, ph = j / vs * Math.PI; return [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)]; };
    for (let i = 0; i < us; i++) for (let j = 0; j < vs; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1), W = q => add3(at, scale3(q, r));
      if (j > 0) { tris.push([W(a), W(c), W(b)]); nrm.push([a, c, b]); }
      if (j < vs - 1) { tris.push([W(a), W(d), W(c)]); nrm.push([a, d, c]); }
    }
  }
  return { tris, nrm };
}
// Edges with their adjacent face normals: drawn when creased or on the silhouette.
function buildEdges(tris) {
  const key = p => p.map(v => Math.round(v * 1e5)).join(',');
  const map = new Map(), fn = tris.map(t => norm3(cross3(sub3(t[1], t[0]), sub3(t[2], t[0]))));
  tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3], ka = key(a), kb = key(b), kk = ka < kb ? ka + '|' + kb : kb + '|' + ka; const e = map.get(kk); if (e) e.n2 = fn[i]; else map.set(kk, { a, b, n1: fn[i], n2: null, c: scale3(add3(a, b), 0.5) }); } });
  return [...map.values()];
}

// ---------- GL context and programs ----------
const GL = { gl: null, ok: null, err: '' };
const VS_MESH = `#version 300 es
in vec3 aPos; in vec3 aNrm;
uniform mat4 uVP; uniform mat4 uV; uniform mat4 uSunVP; uniform vec3 uOffset;
out vec3 vN; out vec3 vW; out vec4 vSun; out float vDepth;
void main(){ vec3 w = aPos + uOffset; vW = w; vN = aNrm; vSun = uSunVP * vec4(w,1.0); vDepth = -(uV * vec4(w,1.0)).z; gl_Position = uVP * vec4(w,1.0); }`;
const FS_MESH = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vN; in vec3 vW; in vec4 vSun; in float vDepth;
uniform int uMode; uniform vec4 uColour; uniform vec3 uSunDir; uniform float uSunI; uniform float uAmb;
uniform vec3 uSky; uniform vec3 uGround; uniform int uShadow; uniform sampler2DShadow uShadowMap; uniform float uShadowRadius; uniform float uShadowTexel;
uniform vec3 uEye; uniform int uOrtho; uniform vec3 uViewDir; uniform float uNear; uniform float uFar; uniform float uBias;
out vec4 frag;
float shadowF(){ vec3 p = vSun.xyz / vSun.w * 0.5 + 0.5; if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0; for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) s += texture(uShadowMap, vec3(p.xy + vec2(float(i), float(j)) * uShadowTexel * uShadowRadius, p.z - uBias));
  return s / 25.0; }
vec3 toSrgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main(){
  if (uMode == 0) { frag = vec4(uColour.rgb * uColour.a, uColour.a); return; }
  if (uMode == 4) { float t = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0); vec3 enc = fract(t * vec3(1.0, 255.0, 65025.0)); enc -= enc.yzz * vec3(1.0/255.0, 1.0/255.0, 0.0); frag = vec4(enc, 1.0); return; }
  vec3 n = normalize(uMode == 2 ? cross(dFdx(vW), dFdy(vW)) : vN);
  vec3 V = uOrtho == 1 ? -uViewDir : normalize(uEye - vW);
  if (dot(n, V) < 0.0) n = -n;
  float sh = uShadow == 1 ? shadowF() : 1.0;
  if (uMode == 3) { float a = (1.0 - sh) * uColour.a; frag = vec4(0.0, 0.0, 0.0, a); return; }
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 hemi = mix(uGround, uSky, n.z * 0.5 + 0.5);
  vec3 lit = uColour.rgb * (hemi * uAmb + uSunI * ndl * sh);
  frag = vec4(toSrgb(clamp(lit, 0.0, 1.0)) * uColour.a, uColour.a);
}`;
const VS_LINE = `#version 300 es
in vec3 aA; in vec3 aB; in float aSide; in float aEnd;
uniform mat4 uVP; uniform vec2 uRes; uniform float uWidth; uniform float uZBias;
out float vLen;
void main(){
  vec4 ca = uVP * vec4(aA,1.0), cb = uVP * vec4(aB,1.0);
  vec2 sa = ca.xy / ca.w * uRes * 0.5, sb = cb.xy / cb.w * uRes * 0.5;
  vec2 d = sb - sa; float L = length(d); vec2 dir = L > 1e-6 ? d / L : vec2(1.0, 0.0); vec2 nr = vec2(-dir.y, dir.x);
  vec4 c = aEnd < 0.5 ? ca : cb;
  vec2 off = nr * aSide * uWidth * 0.5 + dir * (aEnd < 0.5 ? -1.0 : 1.0) * uWidth * 0.5;
  c.xy += off / (uRes * 0.5) * c.w; c.z -= uZBias * c.w;
  vLen = aEnd < 0.5 ? -uWidth * 0.5 : L + uWidth * 0.5;
  gl_Position = c; }`;
const FS_LINE = `#version 300 es
precision highp float; in float vLen; uniform vec4 uColour; uniform float uDash; out vec4 frag;
void main(){ if (uDash > 0.0 && mod(vLen, uDash * 2.0) > uDash) discard; frag = vec4(uColour.rgb * uColour.a, uColour.a); }`;
const VS_SHADOW = `#version 300 es
in vec3 aPos; uniform mat4 uSunVP; uniform vec3 uOffset; void main(){ gl_Position = uSunVP * vec4(aPos + uOffset, 1.0); }`;
const FS_SHADOW = `#version 300 es
precision mediump float; out vec4 frag; void main(){ frag = vec4(1.0); }`;

function glInit() {
  if (GL.ok != null) return GL.ok;
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 4;
    const gl = cv.getContext('webgl2', { antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false, alpha: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    const mk = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); gl.attachShader(p, s); }
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
      const a = {}, na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); for (let i = 0; i < na; i++) { const info = gl.getActiveAttrib(p, i); a[info.name] = gl.getAttribLocation(p, info.name); }
      return { p, u, a };
    };
    GL.gl = gl; GL.canvas = cv;
    GL.mesh = mk(VS_MESH, FS_MESH); GL.line = mk(VS_LINE, FS_LINE); GL.shadow = mk(VS_SHADOW, FS_SHADOW);
    GL.maxRB = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE); GL.maxSamples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    GL.lineBuf = gl.createBuffer(); GL.lineVAO = gl.createVertexArray();
    // shadow map
    GL.shadowSize = 2048;
    GL.shadowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, GL.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, GL.shadowSize, GL.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    GL.shadowFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, GL.shadowFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, GL.shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    GL.ok = true;
  } catch (e) { GL.ok = false; GL.err = e.message || String(e); console.error(e); }
  return GL.ok;
}
function glTargets(w, h) {
  const gl = GL.gl;
  if (GL.tw === w && GL.th === h) return;
  for (const k of ['msFB', 'rsFB']) if (GL[k]) gl.deleteFramebuffer(GL[k]);
  for (const k of ['msCol', 'msDep', 'rsCol', 'rsDep']) if (GL[k]) gl.deleteRenderbuffer(GL[k]);
  const rb = (fmt, samples) => { const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); if (samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h); else gl.renderbufferStorage(gl.RENDERBUFFER, fmt, w, h); return r; };
  const s = GL.maxSamples;
  GL.msCol = rb(gl.RGBA8, s); GL.msDep = rb(gl.DEPTH_COMPONENT24, s);
  GL.msFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, GL.msFB);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, GL.msCol); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, GL.msDep);
  GL.rsCol = rb(gl.RGBA8, 0); GL.rsDep = rb(gl.DEPTH_COMPONENT24, 0);
  GL.rsFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, GL.rsFB);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, GL.rsCol); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, GL.rsDep);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  GL.tw = w; GL.th = h;
}
// Upload a model's tessellation once per model content.
const meshCache = new Map();
function glModel(model) {
  const gl = GL.gl, sig = model._key + ':' + hashStr(model.elements.map(e => e._h).join(''));
  const hit = meshCache.get(model._key);
  if (hit && hit.sig === sig) return hit;
  if (hit) { gl.deleteBuffer(hit.vbo); gl.deleteVertexArray(hit.vao); gl.deleteVertexArray(hit.svao); }
  const parts = [], data = [];
  let first = 0;
  for (const e of model.elements) {
    const { tris, nrm } = tessellate(e);
    for (let i = 0; i < tris.length; i++) for (let k = 0; k < 3; k++) data.push(...tris[i][k], ...nrm[i][k]);
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) if (Number.isFinite(p[k])) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
    let brep = null;
    if (e.edges) { brep = []; for (let i = 0; i + 5 < e.edges.length; i += 6) brep.push([[e.edges[i], e.edges[i + 1], e.edges[i + 2]], [e.edges[i + 3], e.edges[i + 4], e.edges[i + 5]]]); }
    if (brep) for (const seg of brep) for (const p of seg) for (let k = 0; k < 3; k++) if (Number.isFinite(p[k])) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
    parts.push({ e, first, count: tris.length * 3, tris, mn, mx, brep, _edges: null });
    first += tris.length * 3;
  }
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(GL.mesh.a.aPos); gl.vertexAttribPointer(GL.mesh.a.aPos, 3, gl.FLOAT, false, 24, 0);
  if (GL.mesh.a.aNrm >= 0) { gl.enableVertexAttribArray(GL.mesh.a.aNrm); gl.vertexAttribPointer(GL.mesh.a.aNrm, 3, gl.FLOAT, false, 24, 12); }
  const svao = gl.createVertexArray(); gl.bindVertexArray(svao);
  gl.enableVertexAttribArray(GL.shadow.a.aPos); gl.vertexAttribPointer(GL.shadow.a.aPos, 3, gl.FLOAT, false, 24, 0);
  gl.bindVertexArray(null);
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of parts) if (p.mx[0] >= p.mn[0]) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.mn[k]); mx[k] = Math.max(mx[k], p.mx[k]); }
  const extent = parts.length ? { c: scale3(add3(mn, mx), 0.5), r: Math.max(0.01, len3(sub3(mx, mn)) / 2) } : { c: [0, 0, 0], r: 100 };
  const rec = { sig, vbo, vao, svao, parts, extent, byId: new Map(parts.map(p => [p.e.id, p])) };
  meshCache.set(model._key, rec);
  return rec;
}
const edgesOf = part => part._edges || (part._edges = buildEdges(part.tris));

// Design options: elements under another option's top-level geoset do not exist for this render.
function optionExcluded(model, option, geoset) {
  if (!option || !model.options || !model.options.length) return false;
  const top = geoset.split('/')[0]; return model.options.includes(top) && top !== option;
}
// Object ID colours come from a hash of the stable id, so they never change across renders.
function idColour(key) {
  const x = fnv('id:' + key); let r = x & 255, g = (x >> 8) & 255, b = (x >> 16) & 255;
  if (r + g + b < 60) r = 255 - r;
  return [r, g, b];
}
const idInt = c => (c[0] << 16) | (c[1] << 8) | c[2];

// ---------- the render call ----------
// opts: { model, camDef, isolate[], others, ghostOpacity, colour, offsetZ, style, lineWeight, lineColour,
//         crease, hiddenDashed, fillFaces, ambient, tones, sun{dir}, shadowSoft, aoRadius, aoStrength, idBy }
function renderModel(opts, pass, w, h) {
  if (!glInit()) throw new Error('3D rendering unavailable: ' + GL.err);
  const gl = GL.gl, warn = [];
  let W = w, H = h;
  if (Math.max(W, H) > GL.maxRB) { const k = GL.maxRB / Math.max(W, H); W = Math.floor(W * k); H = Math.floor(H * k); warn.push(`Rendered at ${W}×${H} (GPU limit ${GL.maxRB}px) and upscaled.`); }
  glTargets(W, H);
  const rec = glModel(opts.model);
  const cam = buildCamera(opts.camDef, W, H, { vScale: opts.vScale, extent: rec.extent });
  const iso = opts.isolate.length ? opts.isolate : ['*'];
  const S = [], O = [];
  for (const p of rec.parts) { if (optionExcluded(opts.model, opts.option, p.e.geoset)) continue; (matchAny(iso, p.e.geoset) ? S : O).push(p); }
  if (!S.length) warn.push(`No elements match "${iso.join(', ')}".`);
  const others = pass === 'depthAll' ? 'holdout' : opts.others;
  const off = [0, 0, +opts.offsetZ || 0];
  const sun = opts.sun || { dir: norm3([0.4, -0.6, 0.7]) };

  // shadow map: every drawn element casts
  const wantShadow = pass === 'shadow' || (pass === 'image' && (opts.style === 'shadows' || opts.style === 'arctic'));
  let sunVP = new Float32Array(16);
  if (wantShadow) {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of [...S, ...(others === 'hide' ? [] : O)]) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.mn[k] + (S.includes(p) ? off[k] : 0)); mx[k] = Math.max(mx[k], p.mx[k] + (S.includes(p) ? off[k] : 0)); }
    const c = scale3(add3(mn, mx), 0.5), R = Math.max(10, len3(sub3(mx, mn)) / 2);
    const V = M4.lookAt(add3(c, scale3(sun.dir, R * 2)), c, Math.abs(sun.dir[2]) > 0.99 ? [0, 1, 0] : [0, 0, 1]);
    sunVP = M4.mul(M4.ortho(-R, R, -R, R, 0.1, R * 4), V);
    gl.bindFramebuffer(gl.FRAMEBUFFER, GL.shadowFB); gl.viewport(0, 0, GL.shadowSize, GL.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    gl.useProgram(GL.shadow.p); gl.bindVertexArray(rec.svao); gl.uniformMatrix4fv(GL.shadow.u.uSunVP, false, sunVP);
    for (const p of S) { gl.uniform3fv(GL.shadow.u.uOffset, off); gl.drawArrays(gl.TRIANGLES, p.first, p.count); }
    if (others !== 'hide') for (const p of O) { gl.uniform3fv(GL.shadow.u.uOffset, [0, 0, 0]); gl.drawArrays(gl.TRIANGLES, p.first, p.count); }
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  const aa = pass !== 'id' && pass !== 'depth' && pass !== 'depthAll';
  gl.bindFramebuffer(gl.FRAMEBUFFER, aa && GL.maxSamples ? GL.msFB : GL.rsFB);
  gl.viewport(0, 0, W, H);
  const bg = pass === 'depth' || pass === 'depthAll' ? [1, 1, 1, 1] : [0, 0, 0, 0];
  gl.clearColor(...bg); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const M = GL.mesh; gl.useProgram(M.p); gl.bindVertexArray(rec.vao);
  gl.uniformMatrix4fv(M.u.uVP, false, cam.VP); gl.uniformMatrix4fv(M.u.uV, false, cam.V); gl.uniformMatrix4fv(M.u.uSunVP, false, sunVP);
  gl.uniform3fv(M.u.uSunDir, sun.dir); gl.uniform3fv(M.u.uEye, cam.eye); gl.uniform1i(M.u.uOrtho, cam.ortho ? 1 : 0); gl.uniform3fv(M.u.uViewDir, cam.viewDir);
  gl.uniform1f(M.u.uNear, cam.near); gl.uniform1f(M.u.uFar, cam.far);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, GL.shadowTex); gl.uniform1i(M.u.uShadowMap, 0);
  gl.uniform1f(M.u.uShadowTexel, 1 / GL.shadowSize); gl.uniform1f(M.u.uShadowRadius, Math.max(0.6, +opts.shadowSoft || 1)); gl.uniform1f(M.u.uBias, 0.0008);
  gl.uniform1i(M.u.uShadow, 0);
  const lin = c => { c = parseColour(c); return [srgbToLin(c[0]), srgbToLin(c[1]), srgbToLin(c[2]), c[3]]; };
  const draw = (p, o) => { gl.uniform3fv(M.u.uOffset, o); gl.drawArrays(gl.TRIANGLES, p.first, p.count); };
  const style = opts.style;
  // Others first: holdouts write depth only, so isolated geometry behind them stays hidden.
  const drawOthers = (mode) => {
    if (others === 'hide' || !O.length) return;
    if (others === 'holdout' || pass === 'mask' || pass === 'id' || mode === 'depthonly') {
      gl.colorMask(false, false, false, false); gl.uniform1i(M.u.uMode, 0); gl.uniform4fv(M.u.uColour, [0, 0, 0, 0]);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 2);
      for (const p of O) draw(p, [0, 0, 0]);
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.colorMask(true, true, true, true);
    }
  };
  const drawGhosts = () => {
    if (others !== 'ghost' || pass !== 'image' || style === 'objectid') return;
    gl.depthMask(false); gl.uniform1i(M.u.uMode, 1); gl.uniform1i(M.u.uShadow, 0);
    gl.uniform3fv(M.u.uSky, [1, 1, 1]); gl.uniform3fv(M.u.uGround, [0.6, 0.62, 0.66]); gl.uniform1f(M.u.uAmb, 0.85); gl.uniform1f(M.u.uSunI, 0.25);
    gl.uniform4fv(M.u.uColour, [...lin('#c4c8cf').slice(0, 3), clamp(+opts.ghostOpacity)]);
    for (const p of O) draw(p, [0, 0, 0]);
    gl.depthMask(true);
  };
  const idMap = new Map();
  if (pass === 'depth' || pass === 'depthAll') {
    gl.disable(gl.BLEND); gl.uniform1i(M.u.uMode, 4);
    for (const p of S) draw(p, off);
    if (others !== 'hide') for (const p of O) draw(p, [0, 0, 0]);
  } else if (pass === 'mask') {
    drawOthers(); gl.uniform1i(M.u.uMode, 0); gl.uniform4fv(M.u.uColour, [1, 1, 1, 1]); for (const p of S) draw(p, off);
  } else if (pass === 'id') {
    gl.disable(gl.BLEND); drawOthers(); gl.uniform1i(M.u.uMode, 0);
    for (const p of S) {
      const key = opts.idBy === 'geoset' ? p.e.geoset : opts.idBy === 'type' ? (p.e.attrs && p.e.attrs.type || 'none') : p.e.id;
      const c = idColour(key), k = idInt(c);
      if (!idMap.has(k)) idMap.set(k, { key, ids: [] }); idMap.get(k).ids.push(p.e.id);
      gl.uniform4fv(M.u.uColour, [c[0] / 255, c[1] / 255, c[2] / 255, 1]); draw(p, off);
    }
  } else if (pass === 'shadow') {
    drawOthers('depthonly'); gl.uniform1i(M.u.uMode, 3); gl.uniform1i(M.u.uShadow, 1); gl.uniform4fv(M.u.uColour, [0, 0, 0, 1]);
    for (const p of S) draw(p, off);
  } else if (style === 'hiddenline') {
    drawOthers('depthonly');
    // Faces: depth (and optionally a white fill) pushed back so coincident edges win.
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 2);
    if (opts.fillFaces) { gl.uniform1i(M.u.uMode, 0); gl.uniform4fv(M.u.uColour, parseColour(opts.fillColour || '#ffffff')); }
    else { gl.colorMask(false, false, false, false); gl.uniform1i(M.u.uMode, 0); }
    for (const p of S) draw(p, off);
    gl.colorMask(true, true, true, true); gl.disable(gl.POLYGON_OFFSET_FILL);
    drawEdges(S, off, cam, opts, W, H, false);
    if (opts.hiddenDashed) drawEdges(S, off, cam, opts, W, H, true);
  } else {
    drawOthers();
    drawGhosts();
    const col = lin(opts.colour || '#d9dce1');
    gl.uniform3fv(M.u.uSky, [1, 1, 1]); gl.uniform3fv(M.u.uGround, [0.55, 0.57, 0.62]);
    if (style === 'flat') { gl.uniform1i(M.u.uMode, 2); gl.uniform1f(M.u.uAmb, +opts.ambient || 0.45); gl.uniform1f(M.u.uSunI, 0.75); }
    else if (style === 'shadows') { gl.uniform1i(M.u.uMode, 1); gl.uniform1i(M.u.uShadow, 1); gl.uniform1f(M.u.uAmb, +opts.ambient || 0.45); gl.uniform1f(M.u.uSunI, 0.8); }
    else if (style === 'arctic') { gl.uniform1i(M.u.uMode, 1); gl.uniform1i(M.u.uShadow, opts.arcticSun ? 1 : 0); gl.uniform3fv(M.u.uGround, [0.8, 0.82, 0.86]); gl.uniform1f(M.u.uAmb, 0.92); gl.uniform1f(M.u.uSunI, opts.arcticSun ? 0.22 : 0.08); }
    else if (style === 'objectid') { gl.uniform1i(M.u.uMode, 0); }
    else { gl.uniform1i(M.u.uMode, 1); gl.uniform1f(M.u.uAmb, +opts.ambient || 0.5); gl.uniform1f(M.u.uSunI, 0.75); }
    // "From the model": each element's own colour, and the neutral default where it has none (an
    // imported STEP usually has none). The single colour applies only when "One colour" is chosen.
    const own = opts.colourBy === 'model' && style !== 'arctic' && style !== 'objectid', neutral = lin('#d9dce1');
    gl.uniform4fv(M.u.uColour, style === 'arctic' ? [1, 1, 1, 1] : own ? neutral : col);
    for (const p of S) { if (own) gl.uniform4fv(M.u.uColour, p.e.attrs && p.e.attrs.colour ? lin(p.e.attrs.colour) : neutral); draw(p, off); }
  }
  gl.bindVertexArray(null);
  // resolve MSAA and read back
  if (aa && GL.maxSamples) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, GL.msFB); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, GL.rsFB);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, GL.rsFB);
  const buf = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const flip = (fn) => { for (let y = 0; y < H; y++) { const sy = H - 1 - y; for (let x = 0; x < W; x++) fn((sy * W + x) * 4, y * W + x); } };
  if (pass === 'depth' || pass === 'depthAll') {
    const depth = new Float32Array(W * H);
    flip((s, d) => { const t = buf[s] / 255 + buf[s + 1] / 65025 + buf[s + 2] / 16581375; depth[d] = buf[s] === 255 && buf[s + 1] === 255 && buf[s + 2] === 255 ? Infinity : cam.near + t * (cam.far - cam.near); });
    return { depth, w: W, h: H, cam, warn };
  }
  let im = IMG.image(W, H);
  flip((s, d) => { const o = d * 4; im.d[o] = buf[s] / 255; im.d[o + 1] = buf[s + 1] / 255; im.d[o + 2] = buf[s + 2] / 255; im.d[o + 3] = buf[s + 3] / 255; });
  if (pass === 'image' && style === 'arctic' && +opts.aoStrength > 0) {
    const dp = renderModel({ ...opts, others: opts.others === 'hide' ? 'hide' : 'holdout' }, 'depthAll', W, H);
    applyAO(im, dp.depth, cam, +opts.aoRadius > 0 ? +opts.aoRadius : rec.extent.r * 0.04, +opts.aoStrength);
  }
  if (pass === 'image' && style === 'flat' && +opts.tones > 1) im = IMG.posterize(im, +opts.tones);
  if (W !== w || H !== h) im = IMG.resample(im, w, h);
  if (pass === 'mask' || pass === 'shadow') { const m = IMG.maskFromAlpha(im); return { img: m, cam, warn }; }
  return { img: im, cam, warn, idMap };
}

function drawEdges(parts, off, cam, opts, W, H, hidden) {
  const gl = GL.gl, thr = Math.cos((+opts.crease || 30) * Math.PI / 180), data = [];
  const eyeDir = (pt) => cam.ortho ? scale3(cam.viewDir, -1) : norm3(sub3(cam.eye, pt));
  const push = (a, b) => { for (const [side, end] of [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]]) data.push(...a, ...b, side, end); };
  const clipNear = (a, b) => { // keep segments in front of the near plane (perspective)
    if (cam.ortho) return [a, b];
    const za = -M4.xf(cam.V, a)[2], zb = -M4.xf(cam.V, b)[2], n = cam.near * 1.5;
    if (za < n && zb < n) return null; if (za >= n && zb >= n) return [a, b];
    const t = (n - za) / (zb - za), m = add3(a, scale3(sub3(b, a), t)); return za < n ? [m, b] : [a, m];
  };
  for (const p of parts) {
    if (p.brep) for (const [a, b] of p.brep) { const s = clipNear(add3(a, off), add3(b, off)); if (s) push(s[0], s[1]); }
    for (const e of edgesOf(p)) {
    let show;
    if (!e.n2) show = true;
    else {
      const crease = dot3(e.n1, e.n2) < thr;
      const v = eyeDir(add3(e.c, off)), f1 = dot3(e.n1, v), f2 = dot3(e.n2, v);
      // A part with B-rep edges already drew its creases; only silhouettes of smooth faces remain.
      show = p.brep ? (!crease && (f1 > 0) !== (f2 > 0)) : (crease || (f1 > 0) !== (f2 > 0));
    }
    if (!show) continue;
    const s = clipNear(add3(e.a, off), add3(e.b, off)); if (s) push(s[0], s[1]);
  } }
  if (!data.length) return;
  const L = GL.line; gl.useProgram(L.p); gl.bindVertexArray(GL.lineVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, GL.lineBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
  const st = 32;
  gl.enableVertexAttribArray(L.a.aA); gl.vertexAttribPointer(L.a.aA, 3, gl.FLOAT, false, st, 0);
  gl.enableVertexAttribArray(L.a.aB); gl.vertexAttribPointer(L.a.aB, 3, gl.FLOAT, false, st, 12);
  gl.enableVertexAttribArray(L.a.aSide); gl.vertexAttribPointer(L.a.aSide, 1, gl.FLOAT, false, st, 24);
  gl.enableVertexAttribArray(L.a.aEnd); gl.vertexAttribPointer(L.a.aEnd, 1, gl.FLOAT, false, st, 28);
  gl.uniformMatrix4fv(L.u.uVP, false, cam.VP); gl.uniform2f(L.u.uRes, W, H);
  const weight = Math.max(0.6, +opts.lineWeight || 1);
  gl.uniform1f(L.u.uWidth, hidden ? Math.max(0.6, weight * 0.6) : weight);
  gl.uniform1f(L.u.uZBias, cam.ortho ? 0.00015 : 0.00004);
  const c = parseColour(hidden ? (opts.hiddenColour || '#9aa0aa') : (opts.lineColour || '#1c2026'));
  gl.uniform4fv(L.u.uColour, c); gl.uniform1f(L.u.uDash, hidden ? Math.max(3, weight * 3) : 0);
  gl.depthFunc(hidden ? gl.GREATER : gl.LEQUAL); gl.depthMask(false);
  gl.drawArrays(gl.TRIANGLES, 0, data.length / 8);
  gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.bindVertexArray(null);
}

// Screen-space ambient occlusion from the depth pass (horizon-style, CPU).
function applyAO(im, depth, cam, radiusM, strength) {
  const W = im.w, H = im.h, ao = new Float32Array(W * H), K = 12;
  const dirs = []; for (let k = 0; k < K; k++) { const a = k / K * Math.PI * 2 + 0.3; dirs.push([Math.cos(a), Math.sin(a), (k % 3 + 1) / 3]); }
  const tanH = cam.ortho ? 0 : Math.tan(cam.fov * Math.PI / 360);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, z = depth[i]; if (!isFinite(z)) { ao[i] = 1; continue; }
    const mpp = cam.ortho ? (cam.def.span || 200) / H : 2 * z * tanH / H;
    const rpx = Math.min(64, radiusM / mpp);
    let occ = 0;
    for (const d of dirs) {
      const sx = Math.round(x + d[0] * rpx * d[2]), sy = Math.round(y + d[1] * rpx * d[2]);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const dz = z - depth[sy * W + sx];
      if (dz > 0.05 * radiusM && dz < radiusM * 2.5) occ += 1 - dz / (radiusM * 2.5);
    }
    ao[i] = 1 - strength * occ / K;
  }
  const bl = IMG.blur({ kind: 'mask', w: W, h: H, d: ao }, 2).d;
  for (let i = 0, j = 0; i < bl.length; i++, j += 4) { const k = clamp(bl[i]); im.d[j] *= k; im.d[j + 1] *= k; im.d[j + 2] *= k; }
}
