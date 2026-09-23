// The widget you take hold of, and what a drag of it comes to.
//
// A modeller has three gestures and everybody's fingers already know them: W
// moves, E turns, R resizes. What is under the hand is arrows, rings and
// boxes; what comes out is numbers on a node, because a shape that has been
// shoved about by hand has to end up in the tree like everything else or the
// file stops being the model.
//
// Nothing here knows about three.js, the DOM or the kernel. The shapes of the
// handles are a table and the arithmetic of a drag is arithmetic, so both can
// be checked without a browser - and the viewport builds its arrows from the
// same table the drag is measured against, which is what stops the picture and
// the number disagreeing.

import { onPlane, rulerAt, vUnit } from "./handle.js";

/* ------------------------------------------------------------------ maths */

const gSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const gAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const gMul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const gDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const gLen = a => Math.hypot(a[0], a[1], a[2]);

/* ------------------------------------------------------------ the handles */

//! The three axes, in the order everything here walks them, with the colours
//! every modeller uses: X red, Y green, Z blue. Said once, so the arrow that
//! is drawn and the number that comes out of dragging it cannot be about
//! different axes.
export const GIZMO_AXES = [
  { key: "x", dir: [1, 0, 0], colour: 0xd6484a, label: "X" },
  { key: "y", dir: [0, 1, 0], colour: 0x3f9a4e, label: "Y" },
  { key: "z", dir: [0, 0, 1], colour: 0x3b74c4, label: "Z" },
];

//! And the three planes, each named for the axis it is SQUARE TO, because that
//! is the one it does not move along. Dragging the Z plane slides a thing
//! about at the height it is at, which is what a plan move is.
export const GIZMO_PLANES = [
  { key: "xy", normal: [0, 0, 1], along: [[1, 0, 0], [0, 1, 0]], colour: 0x3b74c4, label: "XY" },
  { key: "yz", normal: [1, 0, 0], along: [[0, 1, 0], [0, 0, 1]], colour: 0xd6484a, label: "YZ" },
  { key: "zx", normal: [0, 1, 0], along: [[0, 0, 1], [1, 0, 0]], colour: 0x3f9a4e, label: "ZX" },
];

//! WHAT EACH MODE OFFERS. A move has arrows and planes; a turn has rings and
//! nothing else, because there is no such thing as turning in two axes at once
//! with one hand; a size has one box in the middle and three on the axes, and
//! all four drive the same number - see below.
export const GIZMO_MODES = {
  move:   { key: "move", label: "Move", hotkey: "w",
            hint: "drag an arrow along one axis, or a square to slide in a plane" },
  rotate: { key: "rotate", label: "Turn", hotkey: "e",
            hint: "drag a ring to turn about that axis · hold Ctrl for 5° steps" },
  //! ONE FACTOR, AND THE WIDGET SAYS SO. A B-Rep here is moved by a gp_Trsf and
  //! a gp_Trsf carries ONE scale factor: ask it to squash along a single
  //! direction and it quietly returns the uniform scale of the same volume
  //! instead. So the three axis boxes drive the same number as the middle one
  //! rather than pretending to do something the kernel will not do. Squashing
  //! along one direction is a mesh operation - Mesh from shape, then Mesh
  //! transform, which takes a factor per axis.
  scale:  { key: "scale", label: "Size", hotkey: "r",
            hint: "drag any box to resize · one factor, the same every way" },
};

export const GIZMO_ORDER = ["move", "rotate", "scale"];

//! Every handle a mode puts on screen, in one list, so the viewport can build
//! them in a loop and the hit test can walk the same list.
export function handlesFor(mode) {
  if (mode === "move")
    return [...GIZMO_AXES.map(a => ({ ...a, kind: "axis" })),
            ...GIZMO_PLANES.map(p => ({ ...p, kind: "plane" }))];
  if (mode === "rotate") return GIZMO_AXES.map(a => ({ ...a, kind: "ring" }));
  if (mode === "scale")
    return [...GIZMO_AXES.map(a => ({ ...a, kind: "grip" })),
            { key: "all", kind: "uniform", dir: [0, 0, 1], colour: 0x8a8f98, label: "all" }];
  return [];
}

/* --------------------------------------------------------------- the drags

   Each one is the same shape of question: where was the pointer when the
   handle was taken hold of, where is it now, and what number is the difference
   between those two IN THE MODEL'S OWN UNITS. Never in pixels: a drag of forty
   millimetres is forty millimetres whatever the zoom, which is the whole
   reason a widget is better than a slider.                                 */

//! How far along an axis a ray reaches. The ruler in handle.js, named for what
//! it is used for here.
export const reachAlong = (from, way, at, axis) => rulerAt(from, way, at, axis);

//! Where a ray lands on the plane through \p at square to \p normal, or null
//! when it runs along the plane and there is no answer to give.
export const landOn = (from, way, at, normal) => onPlane(from, way, at, normal);

//! The angle a ray makes about an axis through a point, measured in the plane
//! the axis is square to and from a reference direction in that plane. In
//! radians, and it may be anything from -pi to pi - the unwrapping is the
//! caller's, because only the caller knows how far round the hand has been.
export function angleAbout(from, way, at, axis, reference) {
  const n = vUnit(axis);
  if (!n) return null;
  const hit = onPlane(from, way, at, n);
  if (!hit) return null;
  const out = gSub(hit, at);
  const flat = gSub(out, gMul(n, gDot(out, n)));
  if (gLen(flat) < 1e-9) return null;
  const x = vUnit(gSub(reference, gMul(n, gDot(reference, n))));
  if (!x) return null;
  const y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  return Math.atan2(gDot(flat, y), gDot(flat, x));
}

//! A turn, taken the short way round. A hand that crosses the back of a ring
//! goes from +179 degrees to -179, and read plainly that is a jump of nearly
//! two turns in one frame; read as the short way it is two degrees, which is
//! what the hand did.
export function shortestTurn(was, now) {
  let by = now - was;
  while (by > Math.PI) by -= Math.PI * 2;
  while (by < -Math.PI) by += Math.PI * 2;
  return by;
}

//! Rounded to a step, or left alone when there is no step. What Ctrl does.
export const stepped = (value, step) =>
  step > 0 ? Math.round(value / step) * step : value;

//! A size drag: how far out the hand has pulled, as a multiple. Measured from
//! the middle rather than from where the handle started, so pulling twice as
//! far out is twice the size and pushing back through the middle stops at the
//! smallest the kernel will take rather than turning the shape inside out.
export function sizeFrom(was, now, floor = 0.01) {
  if (!(Math.abs(was) > 1e-9)) return 1;
  return Math.max(floor, now / was);
}

/* ------------------------------------------------------------ the dolly

   ALT AND THE RIGHT BUTTON, which is how every 3D package has zoomed since
   Maya: Alt with the left button tumbles, with the middle tracks, and with the
   right dollies. Push the mouse forward or pull it right and you go in.

   Forward AND right, both, because which of the two a hand reaches for is a
   matter of how the mouse is sitting and nobody should have to think about it.
   The two are added, so a diagonal drag is the sum of what it looks like.

   Exponential, not linear: a drag of eighty pixels has to mean the same THING
   whether you are two metres from a bracket or nine hundred from a masterplan,
   and the only way a distance means the same thing at two scales is as a
   multiple.                                                                 */

export const DOLLY_GAIN = 0.006;

//! How far in the hand has asked to go, in pixels: right and forward are in.
export const dollyPull = (dx, dy) => dx - dy;

//! And what that does to the distance. Never negative, never nothing: a factor
//! is a multiple and a multiple of nought would put the camera inside what it
//! is looking at with no way back out.
export const dollyScale = (dx, dy, gain = DOLLY_GAIN) =>
  Math.exp(-dollyPull(dx, dy) * gain);

/* --------------------------------------------------- the lens, and framing

   A camera has a focal length and it is the thing an architect argues about:
   28 mm makes a courtyard look like a canyon and 85 mm flattens a street into
   an elevation. three.js thinks in a vertical field of view, which nobody has
   ever specified a view in, so the widget says millimetres and converts.

   35 mm full frame, 24 mm tall, so the half-height is 12.                  */

export const lensFromFov = fov => 12 / Math.tan(Math.max(1e-4, fov) * Math.PI / 360);
export const fovFromLens = mm => Math.atan(12 / Math.max(1e-4, mm)) * 360 / Math.PI;

//! The lenses worth having a button for. The ones a camera bag has in it.
export const LENSES = [14, 20, 24, 28, 35, 50, 85, 135, 200];

//! WHERE THE CAMERA HAS TO STAND so that changing the lens changes the
//! PERSPECTIVE rather than the size of what is in front of it. That is the
//! dolly zoom, and it is the only way to see what a lens actually does: the
//! subject stays the size it was and everything behind it rushes towards you
//! or away.
export const framedAt = (distance, fromFov, toFov) =>
  distance * Math.tan(fromFov * Math.PI / 360) / Math.tan(Math.max(1e-4, toFov) * Math.PI / 360);

//! How wide the view is, on the ground, at the target - the number that tells
//! you whether a courtyard fits in the shot.
export const coversAt = (distance, fov, aspect) =>
  2 * distance * Math.tan(fov * Math.PI / 360) * Math.max(0.01, aspect);

/* ------------------------------------------------- what a drag is written to

   A widget does not move a shape. It writes numbers onto a node, and the node
   moves the shape - which is what makes the move undoable, typeable, wireable
   and still there when the file is opened tomorrow.

   Dragging something that is ALREADY a transform drives that one rather than
   stacking a second on top of it: pushing a tower twice should leave one
   number in the tree, not two nodes each holding half the answer.          */

export const TRANSFORM_KEYS = {
  move: ["dx", "dy", "dz"],
  rotate: ["rx", "ry", "rz"],
  scale: ["factor"],
};

//! Which feature a drag should write to, given what is selected. Either the
//! selection itself - it is a Transform already - or a new one to be made over
//! the top of it.
export function transformTarget(entry) {
  if (!entry) return null;
  if (entry.type === "Transform") return { id: entry.id, make: false };
  return { id: null, over: entry.id, make: true };
}

//! What a mode's numbers are on a feature right now, so a drag adds to them
//! rather than starting again from nothing.
export function transformNow(entry, mode) {
  const values = (entry && entry.values) || {};
  const keys = TRANSFORM_KEYS[mode] || [];
  const out = {};
  for (const key of keys) out[key] = Number(values[key]) || (key === "factor" ? 1 : 0);
  return out;
}

//! One line saying what the hand has done, for the bar. Short on purpose: it
//! is read out of the corner of an eye while the other hand is still dragging.
export function saysWhat(mode, numbers) {
  const trim = v => (Math.round(v * 100) / 100).toString();
  if (mode === "move")
    return ["dx", "dy", "dz"].map(k => k[1].toUpperCase() + " " + trim(numbers[k] || 0)).join("  ");
  if (mode === "rotate")
    return ["rx", "ry", "rz"].map(k => k[1].toUpperCase() + " " + trim(numbers[k] || 0)
      + "°").join("  ");
  return "× " + trim(numbers.factor === undefined ? 1 : numbers.factor);
}

export { gAdd, gSub, gMul, gDot, gLen };
