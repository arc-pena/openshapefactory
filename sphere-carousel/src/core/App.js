import * as THREE from 'three';
import { ITEMS } from '../data/items.js';
import { Carousel } from '../world/Carousel.js';
import { WorldSphere } from '../world/WorldSphere.js';
import { Atmosphere } from '../world/Atmosphere.js';
import { SphereNavigation } from '../nav/SphereNavigation.js';
import { PostFX } from '../post/PostFX.js';
import { Interface } from '../ui/Interface.js';
import { clamp, damp } from '../util/math.js';

const RADIUS = 23;

/**
 * Wide viewports get a cinematic 52°; narrow ones open up, otherwise a phone
 * sees nothing but the panel it is pointed at and the carousel stops reading
 * as a world you are standing inside.
 */
function fovForAspect(aspect) {
  return clamp(52 + (1.4 - aspect) * 26, 52, 78);
}
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

export class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.lastFrame = 0;
    this.open = 0;
    this.openTarget = 0;
    this.running = false;
    this.frameTimes = [];
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._forward = new THREE.Vector3();

    this._buildRenderer();
    this._buildScene();
  }

  /* ------------------------------- setup ------------------------------- */

  _buildRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // the grade pass hides edges; bloom + DPR do the rest
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _buildScene() {
    this.scene = new THREE.Scene();
    // Fog pulls the far side of the carousel into the murk, which is what makes
    // a 23-unit sphere read as a whole world.
    this.scene.fog = new THREE.FogExp2('#060a10', 0.023);

    const aspect = window.innerWidth / window.innerHeight;
    this.baseFov = fovForAspect(aspect);
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.1, 600);
    this.camera.rotation.order = 'YXZ';
    // The camera never leaves the centre of the sphere — it only rotates.
    this.camera.position.set(0, 0, 0);

    this.world = new WorldSphere({ radius: 320 });
    this.scene.add(this.world);

    this.atmosphere = new Atmosphere({ radius: RADIUS });
    this.scene.add(this.atmosphere);
  }

  /* ----------------------------- boot flow ----------------------------- */

  async init() {
    this.ui = new Interface({
      items: ITEMS,
      onTick: (index) => {
        this.ui.dismissHint();
        this.nav.goTo(index);
      },
      onOpen: (index) => this.openItem(index),
      onClose: () => this.closeItem(),
    });
    this.ui.setProgress(0.08);
    await nextFrame();

    // Panels are built one per frame so the progress bar actually reflects
    // work done and the main thread never blocks for the whole build.
    this.carousel = new Carousel({ items: ITEMS, radius: RADIUS });
    this.scene.add(this.carousel);
    for (let i = 0; i < ITEMS.length; i++) {
      this.carousel.buildPanel(i);
      this.ui.setProgress(0.08 + ((i + 1) / ITEMS.length) * 0.78);
      await nextFrame();
    }

    this.post = new PostFX(this.renderer, this.scene, this.camera);
    if (this.reducedMotion) this.post.setQuality({ bloom: 0.4, grain: 0.02, motion: 0.15 });

    this.nav = new SphereNavigation({
      element: this.canvas,
      count: ITEMS.length,
      onIndexChange: (index) => {
        this.ui.setIndex(index);
        this.ui.dismissHint();
      },
      onActivate: (index) => this.toggleItem(index),
    });

    // Warm the shader cache so the first drag isn't a stutter.
    if (this.renderer.compileAsync) {
      await this.renderer.compileAsync(this.scene, this.camera);
    }
    this.ui.setProgress(1);
    await nextFrame();

    this._bindWindow();
    this.ui.ready();
    this.start();
  }

  _bindWindow() {
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.start();
    });
    // Keyboard travel only works once the document has focus, which it does
    // not when the page is first painted inside a frame.
    this.canvas.addEventListener('pointerdown', () => window.focus());

    // Belt and braces: the canvas swallows wheel/gesture scrolling.
    window.addEventListener('contextmenu', (e) => {
      if (e.target === this.canvas) e.preventDefault();
    });
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.baseFov = fovForAspect(this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }

  /* ------------------------------ commands ----------------------------- */

  toggleItem(index) {
    if (this.openTarget > 0.5) this.closeItem();
    else this.openItem(index);
  }

  openItem(index) {
    if (this.openTarget > 0.5) return;
    this.openTarget = 1;
    this.nav.lock(true);
    this.ui.showDetail(index);
  }

  closeItem() {
    if (this.openTarget < 0.5) return;
    this.openTarget = 0;
    this.nav.lock(false);
    this.ui.hideDetail();
  }

  /* -------------------------------- loop ------------------------------- */

  start() {
    if (this.running || !this.post) return;
    this.running = true;
    this.lastFrame = performance.now();
    this._tick = this._tick.bind(this);
    this.renderer.setAnimationLoop(this._tick);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  _tick() {
    const now = performance.now();
    // Clamped so a backgrounded tab doesn't resume with one enormous step.
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.time += dt;
    const time = this.time;

    // Attract mode: after a long pause the world keeps drifting on its own.
    if (!this.reducedMotion && this.nav.idle > 7 && this.openTarget < 0.5) {
      this.nav.target += dt * 0.055;
    }

    this.nav.update(dt);
    this.open = damp(this.open, this.openTarget, 4.2, dt);

    this._updateCamera(dt, time);

    this.world.update(time);
    this.atmosphere.update(time, dt, {
      yaw: this.camera.rotation.y,
      velocity: this.nav.velocity,
    });
    this.carousel.update(time, {
      position: this.nav.position,
      activeIndex: this.nav.index,
      open: this.open,
    });

    const flash = clamp(Math.abs(this.openTarget - this.open) * 1.6, 0, 1);
    this.post.render(time, { velocity: this.nav.velocity, flash });

    this._trackPerformance(dt);
  }

  _updateCamera(dt, time) {
    const nav = this.nav;
    const yaw = this.carousel.yawFor(nav.position);
    const breathe = this.reducedMotion ? 0 : 1;

    // Yaw is the navigation; everything else is there to stop the rig feeling
    // like a turntable — pointer look, idle sway, and roll into the turn.
    const look = 1 - this.open * 0.8;
    this.camera.rotation.y =
      yaw + nav.look.x * 0.055 * look + Math.sin(time * 0.21) * 0.01 * breathe;
    this.camera.rotation.x =
      -nav.look.y * 0.045 * look + Math.sin(time * 0.17 + 1.3) * 0.008 * breathe + this.open * 0.02;
    this.camera.rotation.z = damp(
      this.camera.rotation.z,
      clamp(-nav.velocity * 0.012, -0.05, 0.05) * breathe,
      6,
      dt
    );

    // Opening dollies the rig towards the panel it is looking at.
    this.camera.updateMatrixWorld();
    this.camera.getWorldDirection(this._forward);
    this.camera.position.copy(this._forward).multiplyScalar(this.open * 5.4);

    const fov = this.baseFov - this.open * 6;
    if (Math.abs(fov - this.camera.fov) > 0.001) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Cheap adaptive resolution: sustained slow frames walk the pixel ratio down
   * rather than letting the whole experience turn to slideshow.
   */
  _trackPerformance(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 0.024 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.post.setSize(window.innerWidth, window.innerHeight);
    }
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.nav?.dispose();
    this.carousel?.dispose();
    this.atmosphere.dispose();
    this.world.dispose();
    this.post?.dispose();
    this.renderer.dispose();
  }
}
