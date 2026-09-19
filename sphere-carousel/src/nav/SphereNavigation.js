import { clamp, damp, mod } from '../util/math.js';

/**
 * Carousel navigation for a camera sitting at the centre of a sphere.
 *
 * The whole interaction is one scalar: `position`, measured in items. Item 3
 * is centred in the viewport when position === 3, and because the panels are
 * spread evenly around a full revolution the value can run off in either
 * direction forever — that is what makes the carousel endless without any
 * wrap-around bookkeeping.
 *
 *   yaw = -position * (TAU / itemCount)
 *
 * `target` is what the input devices write to; `position` chases it with a
 * frame-rate independent exponential approach. Releasing a drag projects the
 * remaining pointer velocity forward (the flick) and then rounds, which gives
 * the snap that makes the next item settle dead centre.
 */
export class SphereNavigation {
  constructor({ element, count, onIndexChange, onActivate }) {
    this.el = element;
    this.count = count;
    this.onIndexChange = onIndexChange ?? (() => {});
    this.onActivate = onActivate ?? (() => {});

    this.position = 0;
    this.target = 0;
    this.velocity = 0; // items / second, smoothed — drives the post FX
    this.index = 0;

    // Pointer look-around: a little yaw/pitch offset that never snaps.
    this.pointer = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };

    this.locked = false;
    this.dragging = false;
    this.idle = 0;

    this._pointerId = null;
    this._lastX = 0;
    this._lastMoveTime = 0;
    this._pointerVelocity = 0; // px / second
    this._dragDistance = 0;
    this._wheelTimer = 0;
    this._prevPosition = 0;

    this._bind();
  }

  /* --------------------------- configuration --------------------------- */

  /** Items travelled per pixel of drag — one viewport width ≈ 1.35 items. */
  get dragScale() {
    return 1.35 / Math.max(480, window.innerWidth);
  }

  /* ------------------------------- input ------------------------------- */

  _bind() {
    const el = this.el;
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onHover = this._onHover.bind(this);

    el.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
    window.addEventListener('pointermove', this._onHover);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKey);
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    window.removeEventListener('pointermove', this._onHover);
    this.el.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKey);
  }

  _onHover(event) {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
  }

  _onDown(event) {
    if (this.locked || this._pointerId !== null) return;
    this._onHover(event);
    this._pointerId = event.pointerId;
    this.el.setPointerCapture?.(event.pointerId);
    this.dragging = true;
    this.idle = 0;
    this._lastX = event.clientX;
    this._lastMoveTime = performance.now();
    this._pointerVelocity = 0;
    this._dragDistance = 0;
    // Stop dead on grab: the world should feel physically held.
    this.target = this.position;
    this.el.classList.add('is-dragging');
  }

  _onMove(event) {
    if (!this.dragging || event.pointerId !== this._pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - this._lastMoveTime) / 1000;
    const dx = event.clientX - this._lastX;
    this._lastX = event.clientX;
    this._lastMoveTime = now;
    this._dragDistance += Math.abs(dx);

    // Smoothed pointer velocity so a jittery last frame can't ruin the flick.
    this._pointerVelocity = damp(this._pointerVelocity, dx / dt, 18, dt);

    // Drag right -> the previous item swings in from the left.
    this.target -= dx * this.dragScale;
  }

  _onUp(event) {
    if (!this.dragging || (event && event.pointerId !== this._pointerId)) return;
    this.dragging = false;
    this._pointerId = null;
    this.el.classList.remove('is-dragging');

    // Project the flick, then commit to whichever item that lands nearest.
    const flick = -this._pointerVelocity * this.dragScale * 0.26;
    this.target += clamp(flick, -2.4, 2.4);
    this.target = Math.round(this.target);

    // A tap (no travel) asks to open the centred panel. Where the tap landed
    // travels with it: the app only opens the item if the pointer was actually
    // over it, so a click on empty world doesn't fire a project open.
    if (this._dragDistance < 6) {
      this.onActivate(this.index, { x: this.pointer.x, y: -this.pointer.y });
    }
  }

  _onWheel(event) {
    if (this.locked) return;
    event.preventDefault();
    this.idle = 0;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    this.target += delta * 0.0022;
    // Snap once the gesture goes quiet, so trackpads stay continuous.
    clearTimeout(this._wheelTimer);
    this._wheelTimer = setTimeout(() => {
      this.target = Math.round(this.target);
    }, 170);
  }

  _onKey(event) {
    if (event.metaKey || event.ctrlKey) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'd':
        // Embedded in a frame, the arrows would otherwise scroll the host page.
        event.preventDefault();
        this.step(1);
        break;
      case 'ArrowLeft':
      case 'a':
        event.preventDefault();
        this.step(-1);
        break;
      case 'Enter':
      case ' ':
        if (!this.locked) {
          event.preventDefault();
          this.onActivate(this.index);
        }
        break;
      default:
        break;
    }
  }

  /* ------------------------------ commands ----------------------------- */

  step(direction) {
    if (this.locked) return;
    this.idle = 0;
    // Counted from `target`, not `position`: presses that arrive before the
    // world has caught up still queue up instead of all resolving to the
    // same neighbouring item.
    this.target = Math.round(this.target) + direction;
  }

  /** Travel to an absolute item index by the shortest way round the sphere. */
  goTo(index) {
    if (this.locked) return;
    this.idle = 0;
    const current = Math.round(this.position);
    const diff = mod(index - mod(current, this.count) + this.count / 2, this.count) - this.count / 2;
    this.target = current + diff;
  }

  lock(value) {
    this.locked = value;
    if (value) {
      this.dragging = false;
      this._pointerId = null;
      this.el.classList.remove('is-dragging');
      this.target = Math.round(this.position);
    }
  }

  /* ------------------------------- update ------------------------------ */

  update(dt) {
    // Held pointers track tightly; released ones glide out on a slower curve.
    const lambda = this.dragging ? 16 : 5.2;
    this.position = damp(this.position, this.target, lambda, dt);

    const instant = (this.position - this._prevPosition) / Math.max(dt, 1e-4);
    this._prevPosition = this.position;
    this.velocity = damp(this.velocity, instant, 10, dt);

    this.look.x = damp(this.look.x, this.pointer.x, 3, dt);
    this.look.y = damp(this.look.y, this.pointer.y, 3, dt);

    if (Math.abs(this.velocity) < 0.05 && !this.dragging) this.idle += dt;
    else this.idle = 0;

    const index = mod(Math.round(this.position), this.count);
    if (index !== this.index) {
      this.index = index;
      this.onIndexChange(index);
    }
  }

  /** How settled the centred item is: 1 = locked on, 0 = mid-flight. */
  get focus() {
    const off = Math.abs(this.position - Math.round(this.position));
    return 1 - Math.min(1, off * 2.4);
  }
}
