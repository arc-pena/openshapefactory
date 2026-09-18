import { mod } from '../util/math.js';

const pad = (n) => String(n + 1).padStart(2, '0');

/**
 * Thin DOM layer. It knows nothing about the 3D scene: the app pushes the
 * active index at it and it plays the masked line swap that makes the caption
 * feel bolted to the world's rotation.
 */
export class Interface {
  constructor({ items, onTick, onOpen, onClose }) {
    this.items = items;
    this.onTick = onTick;
    this.onOpen = onOpen;
    this.onClose = onClose;

    this.root = document.getElementById('ui');
    this.preloader = document.getElementById('preloader');
    this.preloaderFill = document.getElementById('preloader-fill');
    this.preloaderPct = document.getElementById('preloader-pct');
    this.counterIndex = document.getElementById('counter-index');
    this.counterTotal = document.getElementById('counter-total');
    this.titleEl = document.getElementById('item-title');
    this.categoryEl = document.getElementById('item-category');
    this.yearEl = document.getElementById('item-year');
    this.hint = document.getElementById('hint');
    this.ticksEl = document.getElementById('ticks');
    this.openBtn = document.getElementById('open-btn');

    this.detail = document.getElementById('detail');
    this.detailIndex = document.getElementById('detail-index');
    this.detailTitle = document.getElementById('detail-title');
    this.detailBody = document.getElementById('detail-body');
    this.detailTags = document.getElementById('detail-tags');
    this.detailClose = document.getElementById('detail-close');

    this.counterTotal.textContent = pad(items.length - 1);
    this.index = -1;
    this.detailOpen = false;

    this._buildTicks();
    this._bind();
    this.setIndex(0, { immediate: true });
  }

  _buildTicks() {
    this.ticks = this.items.map((item, i) => {
      const button = document.createElement('button');
      button.className = 'ui__tick';
      button.type = 'button';
      button.setAttribute('aria-label', `Go to ${item.title}`);
      button.addEventListener('click', () => this.onTick?.(i));
      this.ticksEl.appendChild(button);
      return button;
    });
  }

  _bind() {
    this.openBtn.addEventListener('click', () => this.onOpen?.(this.index));
    this.detailClose.addEventListener('click', () => this.onClose?.());
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.detailOpen) this.onClose?.();
    });
  }

  /* ----------------------------- preloader ----------------------------- */

  setProgress(value) {
    const pct = Math.round(value * 100);
    this.preloaderFill.style.width = `${pct}%`;
    this.preloaderPct.textContent = String(pct);
  }

  ready() {
    this.preloader.classList.add('is-done');
    this.root.classList.add('is-ready');
    setTimeout(() => this.preloader.remove(), 1100);
  }

  dismissHint() {
    this.hint?.classList.add('is-hidden');
  }

  /* ------------------------------ caption ------------------------------ */

  setIndex(index, { immediate = false } = {}) {
    const i = mod(index, this.items.length);
    if (i === this.index) return;
    this.index = i;
    const item = this.items[i];

    this.counterIndex.textContent = pad(i);
    this.categoryEl.textContent = item.category;
    this.yearEl.textContent = item.year;
    this.ticks.forEach((tick, t) => tick.classList.toggle('is-active', t === i));

    const line = document.createElement('span');
    line.className = 'ui__title-line';
    line.textContent = item.title;

    if (immediate) {
      this.titleEl.replaceChildren(line);
      return;
    }

    // Old line rides up out of the mask while the new one rises into it.
    const previous = this.titleEl.querySelector('.ui__title-line');
    line.classList.add('is-in');
    this.titleEl.appendChild(line);
    requestAnimationFrame(() => {
      previous?.classList.add('is-out');
      line.classList.add('is-settled');
    });
    setTimeout(() => previous?.remove(), 820);
  }

  /* ------------------------------- detail ------------------------------ */

  showDetail(index) {
    const item = this.items[mod(index, this.items.length)];
    this.detailIndex.textContent = pad(mod(index, this.items.length));
    this.detailTitle.textContent = item.title;
    this.detailBody.textContent = item.body;
    this.detailTags.replaceChildren(
      ...item.tags.map((tag) => {
        const li = document.createElement('li');
        li.textContent = tag;
        return li;
      })
    );
    this.detail.classList.add('is-open');
    this.detail.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-detail');
    this.detailOpen = true;
  }

  hideDetail() {
    this.detail.classList.remove('is-open');
    this.detail.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-detail');
    this.detailOpen = false;
  }
}
