import * as THREE from 'three';
import { ItemPanel } from './ItemPanel.js';
import { ringDelta, smoothstep, TAU } from '../util/math.js';

/**
 * Distributes the items evenly around the inside of the sphere and decides,
 * every frame, how much attention each one gets from its angular distance to
 * the view centre.
 */
export class Carousel extends THREE.Group {
  constructor({ items, radius = 23 }) {
    super();
    this.items = items;
    this.count = items.length;
    this.step = TAU / this.count;
    this.radius = radius;

    // Panels are added one at a time by the boot sequence so the main thread
    // can breathe (and the loading bar can mean something).
    this.panels = [];
  }

  buildPanel(index) {
    const panel = new ItemPanel({
      item: this.items[index],
      index,
      angle: index * this.step,
      radius: this.radius,
    });
    this.panels.push(panel);
    this.add(panel);
    return panel;
  }

  buildAll() {
    for (let i = 0; i < this.count; i++) this.buildPanel(i);
  }

  /** Yaw that centres `position` (in items) on the camera's -Z axis. */
  yawFor(position) {
    return -position * this.step;
  }

  update(time, { position, activeIndex, open }) {
    for (const panel of this.panels) {
      const delta = Math.abs(ringDelta(position, panel.index, this.count));
      panel.update(time, {
        focus: 1 - smoothstep(0.0, 1.3, delta),
        open: panel.index === activeIndex ? open : 0,
        visible: delta < 2.2,
      });
    }
  }

  dispose() {
    for (const panel of this.panels) panel.dispose();
  }
}
