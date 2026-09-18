import * as THREE from 'three';
import { createArtwork } from '../util/artwork.js';
import { createRng, saturate, sphericalToVector, TAU } from '../util/math.js';

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _spin = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _lookAt = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _origin = new THREE.Vector3(0, 0, 0);
const _color = new THREE.Color();

/**
 * One carousel item, living on the inner surface of the sphere.
 *
 * The artwork is not a texture on a quad — it is rebuilt as a grid of boxes
 * laid out on the sphere's surface, each one pushed towards the viewer by the
 * luminance of the pixel it stands for. A dim textured slice sits behind the
 * grid so the gaps between cubes read as depth rather than holes.
 */
export class ItemPanel extends THREE.Group {
  constructor({ item, index, angle, radius = 23, cols = 36, rows = 24, cell = 0.46 }) {
    super();

    this.item = item;
    this.index = index;
    this.angle = angle;
    this.radius = radius;
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;
    this.count = cols * rows;

    this.baseDepth = 0.5;
    this.relief = 1.9;

    // Angular footprint of the panel, derived from the cell size so cubes stay
    // square on the curved surface.
    this.thetaCenter = Math.PI * 0.475;
    this.phiLength = (cols * cell) / (radius * Math.sin(this.thetaCenter));
    this.thetaLength = (rows * cell) / radius;

    // A slice centred on -Z; the group is then yawed into place, which matches
    // the camera's own yaw convention (yaw = -position * step).
    this.phiStart = -Math.PI / 2 - this.phiLength / 2;
    this.thetaStart = this.thetaCenter - this.thetaLength / 2;
    this.rotation.y = -angle;

    this.focus = 0;
    this.open = 0;
    this._dirty = true;

    const { texture, cells } = createArtwork(item, cols, rows);
    this.texture = texture;
    this.cells = cells;

    this._buildMosaic();
    this._buildBacking();
    this._buildFrame();

    this.writeMatrices(0);
  }

  /* ------------------------------- build ------------------------------- */

  _buildMosaic() {
    const { cols, rows, count, cell } = this;
    const rng = createRng(this.item.palette.seed + 17);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.74,
      metalness: 0.12,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.2,
    });

    // three tints only the diffuse term with the per-instance colour, so a cube
    // sitting outside a lamp's reach goes black and the artwork falls apart.
    // Tinting the emissive term as well gives every cube a floor of its own
    // colour; the lights are then free to do nothing but shape the relief.
    //
    // `vColor` can't be reused for this: it is a vec4 and the fragment stage
    // only declares it for USE_COLOR, not for instanced colours, so the tint
    // travels on a varying of its own.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
        .replace(
          '#include <color_vertex>',
          `#include <color_vertex>
          #ifdef USE_INSTANCING_COLOR
            vTint = instanceColor.rgb;
          #else
            vTint = vec3( 1.0 );
          #endif`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vTint;'
        );
    };

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;

    this.dirs = new Float32Array(count * 3);
    this.quats = new Float32Array(count * 4);
    this.seeds = new Float32Array(count);
    this.uv = new Float32Array(count * 2);
    this.luma = new Float32Array(count);
    this.glowSlot = new Int16Array(count).fill(-1);

    const glowCells = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        // A sphere slice runs +u towards screen-left, so the artwork column is
        // read back to front to keep cubes and backing showing the same image.
        const src = row * cols + (cols - 1 - col);
        const u = (col + 0.5) / cols;
        const v = (row + 0.5) / rows;
        const phi = this.phiStart + u * this.phiLength;
        const theta = this.thetaStart + v * this.thetaLength;

        sphericalToVector(1, phi, theta, _dir);
        this.dirs[i * 3] = _dir.x;
        this.dirs[i * 3 + 1] = _dir.y;
        this.dirs[i * 3 + 2] = _dir.z;

        // Face the cube at the centre of the sphere (where the camera is).
        _pos.copy(_dir).multiplyScalar(this.radius);
        _lookAt.lookAt(_pos, _origin, _up);
        _quat.setFromRotationMatrix(_lookAt);
        this.quats[i * 4] = _quat.x;
        this.quats[i * 4 + 1] = _quat.y;
        this.quats[i * 4 + 2] = _quat.z;
        this.quats[i * 4 + 3] = _quat.w;

        this.seeds[i] = rng() * TAU;
        this.uv[i * 2] = u;
        this.uv[i * 2 + 1] = v;

        const c = this.cells.color;
        const jitter = 0.86 + rng() * 0.18;
        // Cells that sit deep in the grid get less of everything, the way a
        // recessed tile would; this is what actually sells the extrusion.
        const occlusion = 0.52 + 0.48 * Math.sqrt(this.cells.luma[src]);
        const k = jitter * occlusion;
        _color.setRGB(
          c[src * 3] * k,
          c[src * 3 + 1] * k,
          c[src * 3 + 2] * k,
          THREE.SRGBColorSpace
        );
        mesh.setColorAt(i, _color);
        this.luma[i] = this.cells.luma[src];

        if (this.luma[i] > 0.82 && glowCells.length < 180) {
          this.glowSlot[i] = glowCells.length;
          glowCells.push(i);
        }
      }
    }
    mesh.instanceColor.needsUpdate = true;

    this.mosaic = mesh;
    this.add(mesh);

    // Additive nubs on the brightest cells — these are what the bloom pass
    // latches onto, so the artwork's highlights bleed into the fog.
    const glowGeo = new THREE.BoxGeometry(1, 1, 1);
    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.item.palette.hot),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.InstancedMesh(glowGeo, glowMat, Math.max(1, glowCells.length));
    glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    glow.frustumCulled = false;
    glow.count = glowCells.length;
    this.glow = glow;
    this.glowCells = glowCells;
    this.add(glow);

    this.cellScale = cell * 0.88;
  }

  _buildBacking() {
    const geometry = new THREE.SphereGeometry(
      this.radius + 0.85,
      48,
      32,
      this.phiStart,
      this.phiLength,
      this.thetaStart,
      this.thetaLength
    );

    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: this.texture },
        uFocus: { value: 0 },
        uOpen: { value: 0 },
        uTime: { value: 0 },
        uTint: { value: new THREE.Color(this.item.palette.hot) },
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
        uniform sampler2D uMap;
        uniform float uFocus;
        uniform float uOpen;
        uniform float uTime;
        uniform vec3 uTint;

        void main() {
          // three's sphere slices run u across phi, which mirrors the artwork.
          vec2 uv = vec2(1.0 - vUv.x, 1.0 - vUv.y);
          vec3 art = texture2D(uMap, uv).rgb;

          // Behind the cubes this only needs to suggest the image.
          vec3 col = art * (0.07 + uFocus * 0.11);

          // Rim frame that tightens as the panel comes into focus.
          vec2 e = min(uv, 1.0 - uv);
          float edge = 1.0 - smoothstep(0.0, 0.035, min(e.x, e.y));
          col += uTint * edge * (0.04 + uFocus * 0.2);

          // Slow scanline sweep, stronger while the panel is open.
          float scan = smoothstep(0.96, 1.0, sin(uv.y * 90.0 - uTime * 1.4) * 0.5 + 0.5);
          col += uTint * scan * (0.02 + uOpen * 0.1);

          float alpha = 0.5 + uFocus * 0.4;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.backing = new THREE.Mesh(geometry, material);
    this.backing.frustumCulled = false;
    this.add(this.backing);
  }

  _buildFrame() {
    // Four arcs traced along the slice border, drawn just inside the cubes.
    const r = this.radius - this.relief - 0.25;
    const segs = 40;
    const pts = [];
    const push = (u, v) => {
      const phi = this.phiStart + u * this.phiLength;
      const theta = this.thetaStart + v * this.thetaLength;
      pts.push(sphericalToVector(r, phi, theta, new THREE.Vector3()));
    };
    for (let i = 0; i <= segs; i++) push(i / segs, 0);
    for (let i = 0; i <= segs; i++) push(1, i / segs);
    for (let i = segs; i >= 0; i--) push(i / segs, 1);
    for (let i = segs; i >= 0; i--) push(0, i / segs);

    const geometry = new THREE.BufferGeometry().setFromPoints(pts);
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color('#cfeeea'),
      transparent: true,
      opacity: 0,
    });
    this.frame = new THREE.Line(geometry, material);
    this.frame.frustumCulled = false;
    this.add(this.frame);
  }

  /* ------------------------------- update ------------------------------ */

  /**
   * Rewrites every instance matrix. Called every frame for the item in focus
   * and its neighbours, and exactly once for items parked out of sight.
   */
  writeMatrices(time) {
    const { count, dirs, quats, seeds, uv } = this;
    const focus = this.focus;
    const open = this.open;
    const flat = 0.4 + 0.6 * focus;
    const waveAmp = 0.1 + focus * 0.34 + open * 0.55;
    const spread = open * 0.55;
    const size = this.cellScale * (1 + focus * 0.06 + open * 0.05);

    for (let i = 0; i < count; i++) {
      const luma = this.luma[i];
      const u = uv[i * 2];
      const v = uv[i * 2 + 1];

      // Travelling ripple across the grid; the crest follows the artwork so
      // bright regions breathe hardest.
      const wave = Math.sin(time * 1.5 + u * 7.0 + v * 3.6 + seeds[i]);
      const push =
        luma * this.relief * flat * (1 + open * 0.9) + wave * waveAmp * (0.25 + luma * 0.9);
      const depth = this.baseDepth + luma * this.relief * flat;

      _dir.set(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
      _pos.copy(_dir).multiplyScalar(this.radius - push + depth * 0.5);

      _quat.set(quats[i * 4], quats[i * 4 + 1], quats[i * 4 + 2], quats[i * 4 + 3]);

      if (open > 0.001) {
        // Opening loosens the grid: cells drift apart just enough to show the
        // lit sides of every cube, and each one tilts a few degrees.
        _pos.x += (u - 0.5) * spread;
        _pos.y -= (v - 0.5) * spread * 0.6;
        _axis.set(Math.sin(seeds[i]), Math.cos(seeds[i] * 1.7), 0.35).normalize();
        _spin.setFromAxisAngle(_axis, open * 0.14 * (0.4 + seeds[i] * 0.1));
        _quat.multiply(_spin);
      }

      _scale.set(size, size, depth);
      _mat.compose(_pos, _quat, _scale);
      this.mosaic.setMatrixAt(i, _mat);

      const slot = this.glowSlot[i];
      if (slot >= 0) {
        // Sit the nub on the cube's front face.
        _pos.copy(_dir).multiplyScalar(this.radius - push - 0.04);
        _scale.set(size * 0.5, size * 0.5, 0.05);
        _mat.compose(_pos, _quat, _scale);
        this.glow.setMatrixAt(slot, _mat);
      }
    }

    this.mosaic.instanceMatrix.needsUpdate = true;
    if (this.glow.count > 0) this.glow.instanceMatrix.needsUpdate = true;
  }

  update(time, { focus, open, visible }) {
    this.visible = visible;
    if (!visible) return;

    this.focus = focus;
    this.open = open;

    const f = saturate(focus);
    this.mosaic.material.color.setScalar(0.34 + f * 0.66);
    this.mosaic.material.emissiveIntensity = 0.12 + f * 0.34 + open * 0.18;
    this.glow.material.opacity = 0.06 + focus * 0.34;
    this.frame.material.opacity = focus * 0.2 * (1 - open);

    const b = this.backing.material.uniforms;
    b.uFocus.value = focus;
    b.uOpen.value = open;
    b.uTime.value = time;

    // Out-of-focus panels freeze: no per-instance work for items behind you.
    const animating = focus > 0.02 || open > 0.001;
    if (animating || this._dirty) {
      this.writeMatrices(time);
      this._dirty = animating;
    }
  }

  dispose() {
    this.mosaic.geometry.dispose();
    this.mosaic.material.dispose();
    this.glow.geometry.dispose();
    this.glow.material.dispose();
    this.backing.geometry.dispose();
    this.backing.material.dispose();
    this.frame.geometry.dispose();
    this.frame.material.dispose();
    this.texture.dispose();
  }
}
