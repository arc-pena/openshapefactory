// The story: a model that explains itself.
//
// A scheme is not communicated by a model. It is communicated by a SEQUENCE -
// here is the site, here is the move, here is what that move buys you - and
// the model is only the thing the sequence is about. Every office in the world
// rebuilds that sequence by hand in a slide deck, with screenshots that go
// stale the moment the model changes.
//
// So the sequence lives in the model file, as a list of beats. A beat is:
// where the camera is, what is showing, what the numbers are set to, and one
// or two sentences about why. Play it and the camera flies, the massing grows,
// the section slides through - and it is all still live, because there is no
// screenshot anywhere in it.
//
// Nothing here knows about three.js, the kernel or the DOM. A beat is a record
// and playing one is arithmetic over the clock, so both can be checked without
// a browser.

/* ------------------------------------------------------------- the format */

//! WHAT A BEAT IS.
//!
//!   { name:    "The move",
//!     text:    "Two bars, pulled apart, and the gap is the street.",
//!     camera:  "CAM2",            the shot it flies to
//!     seconds: 3,                 how long the flight takes
//!     hold:    4,                 how long it sits there afterwards
//!     ease:    "smooth",
//!     show:    ["BL1"],           what comes on as the flight starts
//!     hide:    ["CB2"],           and what goes off
//!     set:     { "TR1.dz": 3000 } numbers, tweened across the flight
//!     section: { axis: "z", at: 1500, style: "poche" } }
//!
//! Every field but the name is optional, because a beat that only says a
//! sentence is a beat - a title card is a beat - and a beat that only moves
//! the camera is one too.
export const BEAT_FIELDS = ["name", "text", "camera", "seconds", "hold", "ease",
                            "show", "hide", "set", "section"];

export const EASES = [
  { key: "smooth", label: "Smooth", hint: "slow at both ends - a camera on a crane" },
  { key: "in",     label: "Ease in", hint: "slow to start, arrives at speed" },
  { key: "out",    label: "Ease out", hint: "leaves at speed, settles" },
  { key: "linear", label: "Even", hint: "the same speed throughout - a diagram, not a shot" },
  { key: "cut",    label: "Cut", hint: "no flight at all: it is simply there" },
];

//! The curves themselves. Named rather than numbered because "smooth" is what
//! somebody means and a pair of Bezier handles is not.
export function easeAt(key, t) {
  const x = Math.max(0, Math.min(1, t));
  switch (key) {
    case "linear": return x;
    case "in":     return x * x;
    case "out":    return 1 - (1 - x) * (1 - x);
    case "cut":    return x >= 1 ? 1 : 0;
    default:       return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  }
}

export const DEFAULT_SECONDS = 3;
export const DEFAULT_HOLD = 4;

//! Read out of the node's text. Tolerant on purpose: a story somebody has
//! edited by hand should lose the beat it got wrong rather than the whole
//! sequence, because a presentation that will not open ten minutes before a
//! meeting is worse than one with a gap in it.
export function readStory(text) {
  if (Array.isArray(text)) return text.map(cleanBeat).filter(Boolean);
  const said = String(text == null ? "" : text).trim();
  if (!said || said === "[]") return [];
  let read;
  try { read = JSON.parse(said); } catch (error) { return []; }
  const list = Array.isArray(read) ? read : (read && Array.isArray(read.beats) ? read.beats : []);
  return list.map(cleanBeat).filter(Boolean);
}

function cleanBeat(one, at) {
  if (!one || typeof one !== "object") return null;
  const list = v => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const numbers = v => {
    if (!v || typeof v !== "object") return {};
    const out = {};
    for (const [key, value] of Object.entries(v))
      if (Number.isFinite(Number(value)) && /^[^.]+\.[^.]+$/.test(key)) out[key] = Number(value);
    return out;
  };
  return {
    name: String(one.name || ("Beat " + ((at || 0) + 1))),
    text: String(one.text || ""),
    camera: one.camera ? String(one.camera) : "",
    seconds: Number.isFinite(Number(one.seconds)) ? Math.max(0, Number(one.seconds))
                                                  : DEFAULT_SECONDS,
    hold: Number.isFinite(Number(one.hold)) ? Math.max(0, Number(one.hold)) : DEFAULT_HOLD,
    ease: EASES.some(e => e.key === one.ease) ? one.ease : "smooth",
    show: list(one.show),
    hide: list(one.hide),
    set: numbers(one.set),
    section: cleanSection(one.section),
  };
}

function cleanSection(one) {
  if (!one || typeof one !== "object") return null;
  const axis = ["x", "y", "z"].includes(one.axis) ? one.axis : null;
  if (!axis) return null;
  return { axis, at: Number(one.at) || 0,
           style: String(one.style || "capped"),
           flipped: !!one.flipped };
}

export const writeStory = beats => JSON.stringify(beats || [], null, 2);

/* --------------------------------------------------------------- the clock

   A STORY IS A LINE, not a list. Each beat has a flight into it and a hold
   afterwards, so where you are at eleven seconds is a beat and a fraction of
   the way into its flight - and everything the player does follows from that
   one answer.                                                              */

//! Where each beat starts and ends on the line, and how long the whole thing
//! runs. The first beat has no flight: you are already there when it starts.
export function timeline(beats) {
  const rows = [];
  let at = 0;
  (beats || []).forEach((beat, i) => {
    const flight = i === 0 ? 0 : beat.seconds;
    rows.push({ at: i, from: at, flyUntil: at + flight, until: at + flight + beat.hold,
                flight, hold: beat.hold });
    at += flight + beat.hold;
  });
  return { rows, seconds: at };
}

//! WHERE YOU ARE AT A MOMENT: which beat, whether it is still flying, and how
//! far through the flight - already eased, because everything downstream wants
//! the eased number and working it out twice is working it out two ways.
export function momentAt(beats, seconds) {
  const line = timeline(beats);
  if (!line.rows.length) return null;
  const clock = Math.max(0, Math.min(line.seconds, seconds));
  let row = line.rows[line.rows.length - 1];
  for (const one of line.rows) if (clock < one.until) { row = one; break; }
  const beat = beats[row.at];
  const flying = row.flight > 0 && clock < row.flyUntil;
  const raw = row.flight > 0 ? Math.min(1, (clock - row.from) / row.flight) : 1;
  return { at: row.at, beat, from: row.at > 0 ? beats[row.at - 1] : null,
           flying, t: easeAt(beat.ease, raw), raw, clock, seconds: line.seconds };
}

//! And the other way about: the moment a beat begins, so pressing a row in the
//! list goes there.
export function startOf(beats, at) {
  const line = timeline(beats);
  const row = line.rows[Math.max(0, Math.min(line.rows.length - 1, at))];
  return row ? row.flyUntil : 0;
}

/* ------------------------------------------------------- what to do about it

   TWO KINDS OF CHANGE, and the difference matters because one of them costs
   nothing and the other costs a rebuild.

   A camera move is free: nothing is remade, the view simply is somewhere else
   next frame. So it is tweened every frame and it is smooth.

   A NUMBER is not free. Setting a parameter rebuilds the feature and
   everything downstream of it, which on a real model is tens of milliseconds
   at best. So the clock keeps running and the value is whatever the clock says
   WHEN THE LAST REBUILD LANDED - the tween plays as fast as the kernel can go
   rather than dropping frames trying to hit a frame rate it cannot hit. A
   massing that grows in eleven steps instead of a hundred and eighty still
   reads as a massing that grows.                                           */

//! Everything a beat changes, gathered from the start of the story up to and
//! including this one - so jumping into the middle arrives at the right state
//! rather than at whatever the last person left behind.
export function stateAt(beats, at) {
  const shown = new Set(), hidden = new Set();
  const values = {};
  let camera = "", section = null;
  for (let i = 0; i <= Math.min(at, (beats || []).length - 1); i++) {
    const beat = beats[i];
    for (const id of beat.show) { shown.add(id); hidden.delete(id); }
    for (const id of beat.hide) { hidden.add(id); shown.delete(id); }
    Object.assign(values, beat.set);
    if (beat.camera) camera = beat.camera;
    if (beat.section) section = beat.section;
  }
  return { shown: [...shown], hidden: [...hidden], values, camera, section };
}

//! The numbers partway through a flight: every key either beat mentions, read
//! from where it was and where it is going. A key the beat before never
//! mentioned starts from whatever \p now says it is, which is the live model -
//! so a tween into a number always starts from the truth.
export function valuesBetween(beats, at, t, now = {}) {
  const beat = beats[at];
  if (!beat) return {};
  const was = stateAt(beats, at - 1).values;
  const out = {};
  for (const [key, to] of Object.entries(beat.set)) {
    const from = Number.isFinite(was[key]) ? was[key]
               : Number.isFinite(now[key]) ? now[key] : to;
    out[key] = from + (to - from) * t;
  }
  return out;
}

//! One line about a story, for the node and the tree.
export function saysStory(beats) {
  const n = (beats || []).length;
  if (!n) return "empty";
  const line = timeline(beats);
  const mins = Math.floor(line.seconds / 60), secs = Math.round(line.seconds % 60);
  return n + (n === 1 ? " beat · " : " beats · ")
       + (mins ? mins + " min " : "") + secs + " s";
}

//! A beat made from where the view is now. What "add one here" writes.
export function beatFromHere(name, camera, text = "") {
  return { name, text, camera: camera || "", seconds: DEFAULT_SECONDS,
           hold: DEFAULT_HOLD, ease: "smooth", show: [], hide: [], set: {}, section: null };
}

//! Moving a beat up or down the list, which is most of what editing a
//! sequence is.
export function moveBeat(beats, at, by) {
  const list = (beats || []).slice();
  const to = at + by;
  if (at < 0 || at >= list.length || to < 0 || to >= list.length) return list;
  const [one] = list.splice(at, 1);
  list.splice(to, 0, one);
  return list;
}
