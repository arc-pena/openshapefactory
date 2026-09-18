import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Final grade. Bloom lifts the emissive cube nubs and the horizon band, then a
 * single pass does the moody part: aberration and a directional smear that both
 * scale with travel speed, vignette, grain and a filmic contrast curve.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVelocity: { value: 0 },
    uFlash: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 0.0018 },
    uVignette: { value: 0.72 },
    uGrain: { value: 0.04 },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.14 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVelocity;
    uniform float uFlash;
    uniform vec2 uResolution;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uSaturation;
    uniform float uContrast;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centred = uv - 0.5;
      float radius = length(centred);
      float speed = min(abs(uVelocity), 4.0);

      // Radial chromatic split, widened by how fast the world is turning.
      float ab = uAberration * (1.0 + speed * 2.2) * (0.35 + radius);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + centred * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - centred * ab).b;

      // Horizontal smear in the direction of travel: cheap motion blur that
      // sells the weight of the sphere.
      // Symmetric taps, and a hard cap: this is a suggestion of motion, not a
      // streak machine. One item per second of travel ≈ 1px of blur.
      float smear = min(speed * 0.0016, 0.006) * (0.5 + radius);
      if (smear > 0.0004) {
        vec3 acc = col * 2.0;
        for (int i = 1; i <= 2; i++) {
          float t = float(i) / 2.0;
          acc += texture2D(tDiffuse, uv + vec2(smear * t, 0.0)).rgb;
          acc += texture2D(tDiffuse, uv - vec2(smear * t, 0.0)).rgb;
        }
        col = acc / 6.0;
      }

      // Grade.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col += uFlash * vec3(0.06, 0.09, 0.1);

      // Vignette and a cool shadow lift, so black never reads as pure black.
      col *= 1.0 - smoothstep(0.32, 0.98, radius) * uVignette;
      col += vec3(0.008, 0.012, 0.018) * (1.0 - radius);

      // Animated grain, quantised to the pixel grid.
      float grain = hash(floor(uv * uResolution) + vec2(uTime * 60.0));
      col += (grain - 0.5) * uGrain;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(size, 0.5, 0.7, 0.86);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.composer.addPass(new OutputPass());

    this.setSize(size.x, size.y);
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms.uResolution.value.set(width * pr, height * pr);
  }

  /** Dial the whole grade back for reduced-motion / low-power sessions. */
  setQuality({ bloom = 0.62, grain = 0.055, motion = 1 } = {}) {
    this.bloom.strength = bloom;
    this.grade.uniforms.uGrain.value = grain;
    this._motion = motion;
  }

  render(time, { velocity = 0, flash = 0 } = {}) {
    const u = this.grade.uniforms;
    u.uTime.value = time;
    u.uVelocity.value = velocity * (this._motion ?? 1);
    u.uFlash.value = flash;
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
  }
}
