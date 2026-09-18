export const TAU = Math.PI * 2;

export const lerp = (a, b, t) => a + (b - a) * t;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const saturate = (v) => clamp(v, 0, 1);

/**
 * Frame-rate independent exponential approach. `lambda` is "how fast", in
 * units of 1/second, so the motion is identical at 60 and 144 Hz.
 */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const smoothstep = (edge0, edge1, x) => {
  const t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const mod = (n, m) => ((n % m) + m) % m;

/** Signed shortest distance from `a` to `b` on a ring of `size` steps. */
export function ringDelta(a, b, size) {
  const d = mod(b - a, size);
  return d > size / 2 ? d - size : d;
}

/** Deterministic PRNG so every reload builds the exact same world. */
export function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spherical -> cartesian using the exact same convention as three's
 * SphereGeometry, so hand-placed instances line up with sliced sphere meshes.
 *   phi   : longitude, 0..TAU
 *   theta : polar angle, 0 at +Y pole .. PI at -Y pole
 */
export function sphericalToVector(radius, phi, theta, target) {
  const sinTheta = Math.sin(theta);
  target.x = -radius * Math.cos(phi) * sinTheta;
  target.y = radius * Math.cos(theta);
  target.z = radius * Math.sin(phi) * sinTheta;
  return target;
}
