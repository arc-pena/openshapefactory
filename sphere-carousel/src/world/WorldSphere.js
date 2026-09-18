import * as THREE from 'three';

/**
 * The world itself: one big sphere rendered from the inside (BackSide) with
 * the camera parked at its centre. Nothing here is lit — it is a painted
 * shell, so it stays cheap no matter how large it is.
 */
export class WorldSphere extends THREE.Mesh {
  constructor({ radius = 320 } = {}) {
    const geometry = new THREE.SphereGeometry(radius, 64, 40);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uHorizon: { value: new THREE.Color('#1b3a48') },
        uZenith: { value: new THREE.Color('#04060b') },
        uNadir: { value: new THREE.Color('#020306') },
        uGlow: { value: new THREE.Color('#5fb0b8') },
        uGlowStrength: { value: 0.34 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vDir;
        uniform float uTime;
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform vec3 uNadir;
        uniform vec3 uGlow;
        uniform float uGlowStrength;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z);
        }

        float fbm(vec3 p) {
          float sum = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 5; i++) {
            sum += amp * noise(p);
            p *= 2.02;
            amp *= 0.5;
          }
          return sum;
        }

        void main() {
          float h = vDir.y;

          // Base sky: three-stop vertical ramp through the horizon colour.
          vec3 col = mix(uNadir, uHorizon, smoothstep(-0.65, 0.02, h));
          col = mix(col, uZenith, smoothstep(0.03, 0.85, h));

          // Slow drifting cloud bank, squashed towards the horizon.
          vec3 q = vec3(vDir.x, vDir.y * 2.4, vDir.z) * 2.1;
          float clouds = fbm(q + vec3(uTime * 0.012, uTime * 0.004, 0.0));
          clouds = smoothstep(0.42, 0.95, clouds);
          col += clouds * 0.16 * uGlow * (0.35 + 0.65 * smoothstep(-0.2, 0.6, h));

          // Horizon band: the light source that makes the world feel weathered.
          float band = exp(-abs(h) * 9.0);
          col += uGlow * band * uGlowStrength;

          // Faint star field, only above the haze.
          float stars = step(0.9992, hash(floor(vDir * 900.0)));
          col += stars * smoothstep(0.05, 0.5, h) * 0.85;

          // Ordered-ish dither so the long gradients don't band on 8-bit output.
          float dither = (hash(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 255.0;
          gl_FragColor = vec4(col + dither, 1.0);
        }
      `,
    });

    super(geometry, material);
    this.frustumCulled = false;
    this.renderOrder = -1;
  }

  update(time) {
    this.material.uniforms.uTime.value = time;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
