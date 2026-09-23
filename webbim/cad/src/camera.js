// The camera, as a thing rather than as a mood the window was in.
//
// Every view worth having gets lost. Somebody orbits, somebody opens the file
// tomorrow, and the shot that explained the scheme is gone - so the shot is a
// node: where it stands, what it looks at, what lens is on it, and what shape
// of frame it is going to be printed in. Then it can be typed into, wired to,
// moved with a widget, animated, and handed to somebody else in the file.
//
// What is here is the arithmetic of that. A camera is an eye, a target and a
// roll, and everything else - the frame it fills, the safe rectangles inside
// it, where the corners of the picture are in space - falls out of those.
// Nothing here knows about three.js or the DOM.

/* ------------------------------------------------------------- the frames */

//! THE SHAPES A DRAWING COMES OUT IN. A view is composed for something: a
//! slide, a sheet, a phone. Composing it in whatever shape the window happens
//! to be and printing it in another is how a scheme loses its own edges.
export const FRAMES = [
  { key: "16:9",  label: "16:9",  ratio: 16 / 9,  note: "a slide" },
  { key: "3:2",   label: "3:2",   ratio: 3 / 2,   note: "a photograph" },
  { key: "4:3",   label: "4:3",   ratio: 4 / 3,   note: "the old slide" },
  { key: "1:1",   label: "1:1",   ratio: 1,       note: "a square" },
  { key: "2:1",   label: "2:1",   ratio: 2,       note: "a panorama" },
  { key: "9:16",  label: "9:16",  ratio: 9 / 16,  note: "upright, for a phone" },
  { key: "a4",    label: "A4",    ratio: 297 / 210, note: "landscape" },
  { key: "a3",    label: "A3",    ratio: 420 / 297, note: "landscape" },
];

export const frameAt = i => FRAMES[Math.max(0, Math.min(FRAMES.length - 1, Math.round(i || 0)))];

//! WHAT IS ACTUALLY GOING TO BE SEEN. Broadcast has had these two rectangles
//! since television had rounded corners: ninety per cent for anything that
//! matters and eighty for anything with words in it. They are still the right
//! numbers for a slide, because a projector crops and a phone puts a notch in
//! the corner.
export const SAFE_MODES = [
  { key: "off",    label: "Off",    action: false, title: false, thirds: false },
  { key: "safe",   label: "Safe",   action: true,  title: true,  thirds: false },
  { key: "thirds", label: "Thirds", action: false, title: false, thirds: true },
  { key: "both",   label: "Both",   action: true,  title: true,  thirds: true },
];

export const safeAt = i => SAFE_MODES[Math.max(0, Math.min(SAFE_MODES.length - 1,
  Math.round(i || 0)))];

export const ACTION_SAFE = 0.9;
export const TITLE_SAFE = 0.8;

/* ------------------------------------------------------------- the frame it makes

   THE LETTERBOX. A camera has a shape and a window has another, so one of the
   two dimensions is the one that fits and the other is cropped. Worked out
   here rather than in CSS because the same numbers place the safe rectangles,
   and two ways of arriving at the same rectangle is one way of them
   disagreeing.                                                             */

export function letterbox(width, height, ratio) {
  const have = width / Math.max(1, height);
  const w = have > ratio ? height * ratio : width;
  const h = have > ratio ? height : width / ratio;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/* ------------------------------------------------------------- where it looks */

const cSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cMul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                          a[0] * b[1] - a[1] * b[0]];
const cLen = a => Math.hypot(a[0], a[1], a[2]);
const cUnit = a => { const n = cLen(a); return n > 1e-12 ? cMul(a, 1 / n) : null; };

//! A camera's own three directions. Z is up in this program, so a camera that
//! is not looking straight up or straight down has an up direction that falls
//! out of that - and one that IS gets any up at all rather than an error,
//! because a plan view is a view.
export function frameOf(eye, target, roll = 0) {
  const forward = cUnit(cSub(target, eye));
  if (!forward) return null;
  const world = Math.abs(forward[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  let right = cUnit(cCross(forward, world));
  if (!right) right = [1, 0, 0];
  let up = cCross(right, forward);
  if (roll) {
    const a = roll * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    const r = cAdd(cMul(right, cos), cMul(up, sin));
    up = cAdd(cMul(up, cos), cMul(right, -sin));
    right = r;
  }
  return { eye, target, forward, right, up, distance: cLen(cSub(target, eye)) };
}

//! The four corners of the picture, out in the world at the target's distance.
//! What the drawn camera's frustum is made of, and what makes a camera in the
//! model read as a camera rather than as a cone.
export function cornersOf(view, fovDeg, ratio, at = 1) {
  if (!view) return [];
  const reach = view.distance * at;
  const half = Math.tan(fovDeg * Math.PI / 360) * reach;
  const across = half * ratio;
  const middle = cAdd(view.eye, cMul(view.forward, reach));
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
    cAdd(middle, cAdd(cMul(view.right, u * across), cMul(view.up, v * half))));
}

/* ---------------------------------------------------- moving one about

   A CAMERA RIG, and the words are the words a camera crew uses because they
   are the right words: dolly is towards and away, truck is sideways, pedestal
   is up and down, and orbiting is what a camera on a crane does round the
   thing it is pointed at. Each of them is a different thing to do to a pair of
   points, and which one you meant is which button you were holding.        */

//! Towards what it is looking at, or away from it. The target stays; only the
//! eye moves, which is what makes it a dolly rather than a zoom - the
//! perspective changes, and that is the whole point of moving a camera at all.
export function dolly(view, by) {
  if (!view) return null;
  // Never through the target and out the other side: a camera that has passed
  // what it is looking at is looking the wrong way, and the fix is not obvious
  // from the picture.
  const reach = Math.max(view.distance * 0.02, view.distance - by);
  return { eye: cSub(view.target, cMul(view.forward, reach)), target: view.target };
}

//! Sideways and up, both points together, so the camera slides and the shot
//! keeps its angle. A truck and a pedestal at once, because a hand doing one
//! is usually doing a bit of the other.
export function truck(view, across, up) {
  if (!view) return null;
  const by = cAdd(cMul(view.right, across), cMul(view.up, up));
  return { eye: cAdd(view.eye, by), target: cAdd(view.target, by) };
}

//! Round what it is looking at. The target stays put and the eye goes round
//! it, which is the one move that looks like a camera on a crane rather than
//! like a model being spun.
export function orbitAbout(view, yaw, pitch) {
  if (!view) return null;
  const out = cSub(view.eye, view.target);
  const reach = cLen(out);
  if (reach < 1e-9) return null;
  // Measured in the world's own frame so the horizon stays where it is: a
  // yaw is about world Z whatever the camera is doing, or the model rolls.
  let level = Math.atan2(out[1], out[0]) + yaw;
  let height = Math.asin(Math.max(-1, Math.min(1, out[2] / reach))) + pitch;
  const limit = Math.PI / 2 - 0.02;
  height = Math.max(-limit, Math.min(limit, height));
  const flat = Math.cos(height) * reach;
  return { eye: cAdd(view.target, [Math.cos(level) * flat, Math.sin(level) * flat,
                                   Math.sin(height) * reach]),
           target: view.target };
}

//! And the other way about: the numbers a camera node should be holding for
//! the viewport to be looking the way it is looking now. What "set it from
//! what I am seeing" writes.
export function fromView(eye, target) {
  const round = v => Math.round(v * 100) / 100;
  return { x: round(eye[0]), y: round(eye[1]), z: round(eye[2]),
           tx: round(target[0]), ty: round(target[1]), tz: round(target[2]) };
}

//! One line about a camera, for the tree and the bar. The distance to what it
//! is looking at is in it because that is the number that tells you whether
//! the lens is doing what you think: 35 mm at four metres is a room, 35 mm at
//! four hundred is a masterplan.
export function saysShot(lens, frameKey, distance) {
  const away = distance >= 10000 ? (distance / 1000).toFixed(1) + " m"
             : Math.round(distance) + " mm";
  return Math.round(lens) + " mm · " + frameKey + " · " + away + " to target";
}

export { cAdd, cSub, cMul, cDot, cCross, cLen, cUnit };
