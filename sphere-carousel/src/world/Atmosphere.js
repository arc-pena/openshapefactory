import * as THREE from 'three';
import { createRng, TAU } from '../util/math.js';

/**
 * Everything between the camera and the shell: floating dust, a ground grid
 * that gives the sphere a floor to stand on, and the two roaming accent lights
 * that rim the cubes. This is most of the "moody game level" feeling.
 */
export class Atmosphere extends THREE.Group {
  constructor({ radius = 26 } = {}) {
    super();
    this.radius = radius;

    this.dust = this._createDust();
    this.add(this.dust);

    this.ground = this._createGround();
    this.add(this.ground);

    this.lights = this._createLights();
  }

  _createDust() {
    const count = 2400;
    const rng = createRng(77);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const scales = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Uniform-ish points in a shell around the camera, biased low.
      const r = 5 + Math.pow(rng(), 0.6) * 46;
      const phi = rng() * TAU;
      const theta = Math.acos(1 - 2 * rng());
      const sinT = Math.sin(theta);
      positions[i * 3] = Math.cos(phi) * sinT * r;
      positions[i * 3 + 1] = Math.cos(theta) * r * 0.55 - 2;
      positions[i * 3 + 2] = Math.sin(phi) * sinT * r;
      seeds[i] = rng() * TAU;
      scales[i] = 0.4 + rng() * 1.6;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
        uColor: { value: new THREE.Color('#9fd8dd') },
        uOpacity: { value: 0.8 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute float aScale;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vTwinkle;

        void main() {
          vec3 p = position;
          // Lazy vertical convection plus a touch of lateral sway.
          p.y += sin(uTime * 0.22 + aSeed) * 1.4;
          p.x += cos(uTime * 0.17 + aSeed * 1.7) * 1.1;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vTwinkle = 0.35 + 0.65 * pow(abs(sin(uTime * 0.9 + aSeed * 3.1)), 2.0);
          gl_PointSize = aScale * 2.6 * uPixelRatio * (34.0 / -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vTwinkle;
        void main() {
          // Soft round sprite, no texture needed.
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vTwinkle * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  _createGround() {
    const geometry = new THREE.CircleGeometry(150, 96);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#6fc6cb') },
        uFade: { value: 62 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vLocal;
        uniform vec3 uColor;
        uniform float uFade;
        uniform float uTime;

        float gridLine(float coord, float spacing, float width) {
          float f = abs(fract(coord / spacing - 0.5) - 0.5) * spacing;
          return 1.0 - smoothstep(0.0, width, f);
        }

        void main() {
          float dist = length(vLocal.xz);
          // Cartesian grid, plus concentric rings that pulse outwards.
          float g = max(gridLine(vLocal.x, 4.0, 0.045), gridLine(vLocal.z, 4.0, 0.045));
          float rings = gridLine(dist - uTime * 0.6, 16.0, 0.12);
          float alpha = (g * 0.5 + rings * 0.32) * exp(-dist / uFade);
          alpha *= smoothstep(1.5, 9.0, dist); // keep the area under the camera clean
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -11;
    mesh.frustumCulled = false;
    return mesh;
  }

  _createLights() {
    const hemi = new THREE.HemisphereLight('#8fdedb', '#0d0b12', 0.42);
    const key = new THREE.DirectionalLight('#dff3ef', 0.85);
    key.position.set(-8, 14, 6);

    // A lamp riding with the camera at the centre of the sphere. Without it the
    // cube faces that point at the viewer get nothing but grazing light and the
    // artwork disappears into silhouette.
    const centre = new THREE.PointLight('#d8f4f0', 330, 80, 1.9);
    centre.position.set(0, 1, 0);

    const accentA = new THREE.PointLight('#63e0d8', 620, 70, 1.9);
    const accentB = new THREE.PointLight('#ff9a5c', 480, 60, 1.9);

    this.add(hemi, key, centre, accentA, accentB);
    return { hemi, key, centre, accentA, accentB };
  }

  update(time, dt, { yaw = 0, velocity = 0 } = {}) {
    this.dust.material.uniforms.uTime.value = time;
    this.ground.material.uniforms.uTime.value = time;

    // Counter-rotating the dust against the camera yaw buys cheap parallax:
    // near particles appear to slide faster than the painted shell.
    this.dust.rotation.y = -yaw * 0.18 + time * 0.004;

    const r = 16;
    this.lights.accentA.position.set(
      Math.cos(time * 0.24 - yaw * 0.6) * r,
      7 + Math.sin(time * 0.4) * 2.5,
      Math.sin(time * 0.24 - yaw * 0.6) * r
    );
    this.lights.accentB.position.set(
      Math.cos(time * 0.19 - yaw * 0.6 + Math.PI) * r,
      -3 + Math.cos(time * 0.33) * 2,
      Math.sin(time * 0.19 - yaw * 0.6 + Math.PI) * r
    );

    // Motion lifts the haze a little, so travelling feels energetic.
    const speed = Math.min(1, Math.abs(velocity) * 0.6);
    this.dust.material.uniforms.uOpacity.value = 0.55 + speed * 0.7;
  }

  dispose() {
    this.dust.geometry.dispose();
    this.dust.material.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
  }
}
