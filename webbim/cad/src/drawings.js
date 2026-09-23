// Drawings: what the model looks like, flattened onto a plane.
//
// A drawing is not a picture of the model. It is a SECOND description of it,
// made by a set of conventions every drawing office already knows: what the
// plane passed through is poche, what is behind it is thinner, what you cannot
// see is dashed, and what is only an edge of curvature is thinner still. Get
// those conventions wrong and the drawing is a rendering with the colour taken
// out; get them right and it reads at a glance.
//
// TWO HALVES, AND KEEPING THEM APART IS THE WHOLE DESIGN.
//
//   COMPUTED   the projected lines. Rebuilt from the model every time the
//              model changes, on named layers - Edges, Hidden, Cut and the
//              rest - so a drawing can never be out of date with what it is a
//              drawing of. Nobody edits these, because the next rebuild would
//              throw the edit away.
//
//   AUTHORED   the annotation. Text, leaders, symbols and any lines you draw
//              yourself, on layers you made, held in the node's own drawing
//              argument. This half is yours, it is saved, and no rebuild
//              touches it.
//
// Every drawing office in the world has lost a morning to a drawing that was
// edited after it was issued and then regenerated. The split is what makes
// that impossible here: the half that regenerates is the half nobody edits.
//
// WHY ANNOTATION IS NOT A SKETCH ELEMENT. A sketch element makes an edge -
// that is what the word means in this program, and the kernel, the solver and
// the DXF writer all rely on it. A piece of text makes no edge and a leader is
// not a profile, so they live in `notes` beside the elements rather than among
// them. They still carry a layer, so they take a pen and a colour like
// everything else, and they still go out to DXF. What they do not do is turn
// up in a pad.
//
// Nothing here knows about OpenCascade or the DOM. The projection itself -
// hidden-line removal - is geometry and belongs to the kernel's factories;
// what arrives here is a list of classified polylines in the view plane's own
// two coordinates, and everything below is arithmetic over them.

import { CUT_LINES, CUT_WEIGHTS } from "./section.js";
import { SKETCH_LAYER } from "./sketch.js";

/* ------------------------------------------------------- the edge classes

   HIDDEN-LINE REMOVAL DOES NOT GIVE YOU "LINES". It gives you lines sorted
   into kinds, and the kinds are the reason a drawing reads: a silhouette is
   not an edge, a smooth crease is not a corner, and something you cannot see
   is not something you can. Each kind lands on a layer of its own so that the
   pen can be set once and apply to every line of that kind in the drawing.  */

//! What the kernel hands back, and where each kind goes. The keys are the
//! kernel's own classification; the layers are the words a drawing office
//! uses. One table, so the kernel, the panel and the DXF writer cannot
//! disagree about which is which.
export const DRAW_CLASSES = [
  { key: "sharp",     layer: "Edges",
    hint: "a real edge of the solid, in plain view" },
  { key: "outline",   layer: "Silhouette",
    hint: "where a curved surface turns away - the edge of a cylinder, which "
        + "is not an edge of the solid at all" },
  { key: "smooth",    layer: "Tangent",
    hint: "a crease between two faces that meet smoothly - a fillet's ends" },
  { key: "sharpHidden",   layer: "Hidden", hidden: true,
    hint: "an edge something else is in front of" },
  { key: "outlineHidden", layer: "Hidden", hidden: true,
    hint: "a silhouette something else is in front of" },
  { key: "smoothHidden",  layer: "Hidden", hidden: true,
    hint: "a smooth crease something else is in front of" },
  { key: "cut",       layer: "Cut",
    hint: "where the cutting plane passed through solid material" },
  { key: "beyond",    layer: "Beyond",
    hint: "what is behind the cut, drawn lighter so the cut reads in front" },
];

export const layerForClass = key => {
  const one = DRAW_CLASSES.find(c => c.key === key);
  return one ? one.layer : "Edges";
};

/* -------------------------------------------------------------- the pens

   A LAYER CARRIES A PEN. The sketch has always had layers and they held three
   facts - the name, whether it shows, whether it is locked - because a sketch
   is a profile and a profile has no weight. A drawing does: the whole craft of
   drawing by hand was choosing which of four pens to pick up, and a drawing
   where every line is the same width says nothing about what matters.

   So a layer here carries three more: a weight, a line type and an ink. They
   are the SAME tables the section cut uses, deliberately - a cut line on a
   drawing and a cut line in the 3D view are the same convention and should not
   be two lists that drift apart.                                           */

export const PEN_WEIGHTS = CUT_WEIGHTS;
export const PEN_LINES = CUT_LINES.filter(one => one.key !== "inherit");

//! What each standard layer is for, and what it is drawn with. These are the
//! conventions, not preferences: a hidden line is dashed and a cut line is
//! heavy in every drawing office there has ever been, so that is what they
//! arrive as. All of it is then editable, because there is always a house
//! standard and it is always slightly different.
export const DRAW_LAYERS = [
  { name: "Cut",        weight: 3,   line: "solid",  ink: [0.10, 0.10, 0.12],
    hint: "what the plane passed through - the heaviest line on the sheet" },
  { name: "Edges",      weight: 1.5, line: "solid",  ink: [0.16, 0.17, 0.20],
    hint: "edges of the solid, seen" },
  { name: "Silhouette", weight: 1.5, line: "solid",  ink: [0.16, 0.17, 0.20],
    hint: "where curved surfaces turn away" },
  { name: "Tangent",    weight: 1,   line: "solid",  ink: [0.45, 0.47, 0.52],
    hint: "smooth creases, drawn fine so they do not read as corners" },
  { name: "Hidden",     weight: 1,   line: "dashed", ink: [0.45, 0.47, 0.52],
    hint: "what is behind something else" },
  { name: "Beyond",     weight: 1,   line: "solid",  ink: [0.58, 0.60, 0.65],
    hint: "behind the cut, drawn light" },
  { name: "Notes",      weight: 1,   line: "solid",  ink: [0.10, 0.10, 0.12],
    hint: "yours: text, leaders, dimensions, anything you add" },
];

//! The pen a layer is drawn with. A layer that says nothing takes the standard
//! layer's pen if it is one of those, and a plain fine continuous black if it
//! is one you made - which is what a new layer should be.
export const PEN_FALLBACK = { weight: 1, line: "solid", ink: [0.10, 0.10, 0.12],
                              symbol: "dot", size: 2.5 };

export function layerPen(layer) {
  const standard = DRAW_LAYERS.find(one => one.name === (layer && layer.name));
  const under = standard || PEN_FALLBACK;
  const said = layer || {};
  const pick = (value, fallback) =>
    (value === undefined || value === null || value === "inherit") ? fallback : value;
  const line = pick(said.line, under.line || PEN_FALLBACK.line);
  return {
    weight: Math.max(0.25, Math.min(12,
      Number(pick(said.weight, under.weight || PEN_FALLBACK.weight))
        || under.weight || PEN_FALLBACK.weight)),
    line: PEN_LINES.some(one => one.key === line) ? line : PEN_FALLBACK.line,
    ink: Array.isArray(said.ink) && said.ink.length === 3 ? said.ink
       : (under.ink || PEN_FALLBACK.ink),
    symbol: pointSymbol(pick(said.symbol, under.symbol || PEN_FALLBACK.symbol)).key,
    size: Math.max(0.2, Math.min(200,
      Number(pick(said.size, under.size || PEN_FALLBACK.size)) || PEN_FALLBACK.size)),
  };
}

//! Only what differs from the standard is written down, so a layer nobody has
//! touched carries a name and nothing else and follows the conventions above
//! even if those conventions are later changed.
export function penRecord(layer, changes) {
  const standard = DRAW_LAYERS.find(one => one.name === (layer && layer.name))
                || PEN_FALLBACK;
  const out = { ...(layer || {}), ...changes };
  for (const key of ["weight", "line", "ink", "symbol", "size"]) {
    const value = out[key];
    if (value === undefined || value === null || value === "inherit") { delete out[key]; continue; }
    const same = Array.isArray(value) && Array.isArray(standard[key])
      ? value.every((v, i) => Math.abs(v - standard[key][i]) < 1e-6)
      : value === standard[key];
    if (same) delete out[key];
  }
  return out;
}

/* ---------------------------------------------------------- point symbols

   A point on a drawing is not a dot unless you say so. Survey stations, grid
   intersections, setting-out points and levels each have their own mark, and
   the mark is how you tell them apart at 1:200. Held as strokes rather than as
   a font, so they scale with the drawing and go out to DXF as lines.        */

export const POINT_SYMBOLS = [
  { key: "dot",      label: "Dot" },
  { key: "cross",    label: "Cross" },
  { key: "plus",     label: "Plus" },
  { key: "square",   label: "Square" },
  { key: "circle",   label: "Circle" },
  { key: "triangle", label: "Triangle" },
  { key: "star",     label: "Star" },
  { key: "target",   label: "Target" },
];

export const pointSymbol = key =>
  POINT_SYMBOLS.find(one => one.key === key) || POINT_SYMBOLS[0];

//! One symbol, as segments in the drawing's own coordinates: [[a, b], …]. The
//! size is the symbol's full width, so two symbols at the same size read the
//! same size, which is not true if you measure them by their radius.
export function symbolStrokes(key, at, size) {
  const r = Math.max(1e-6, size) / 2;
  const [x, y] = at;
  const seg = (ax, ay, bx, by) => [[x + ax * r, y + ay * r], [x + bx * r, y + by * r]];
  const ring = (n, turn) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = turn + (i / n) * Math.PI * 2, b = turn + ((i + 1) / n) * Math.PI * 2;
      out.push(seg(Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)));
    }
    return out;
  };
  switch (pointSymbol(key).key) {
    //! A DOT IS STILL STROKES. Drawn as a small filled-looking rosette rather
    //! than as nothing, because a point you cannot see is a point you will
    //! move by accident.
    case "dot":    return ring(8, 0).map(([a, b]) =>
                     [[x + (a[0] - x) * 0.3, y + (a[1] - y) * 0.3],
                      [x + (b[0] - x) * 0.3, y + (b[1] - y) * 0.3]]);
    case "cross":  return [seg(-0.707, -0.707, 0.707, 0.707),
                           seg(-0.707, 0.707, 0.707, -0.707)];
    case "plus":   return [seg(-1, 0, 1, 0), seg(0, -1, 0, 1)];
    case "square": return [seg(-0.707, -0.707, 0.707, -0.707), seg(0.707, -0.707, 0.707, 0.707),
                           seg(0.707, 0.707, -0.707, 0.707), seg(-0.707, 0.707, -0.707, -0.707)];
    case "circle": return ring(16, 0);
    case "triangle": return ring(3, Math.PI / 2);
    case "star":   return [seg(-1, 0, 1, 0), seg(0, -1, 0, 1),
                           seg(-0.707, -0.707, 0.707, 0.707), seg(-0.707, 0.707, 0.707, -0.707)];
    case "target": return [...ring(16, 0), seg(-1, 0, 1, 0), seg(0, -1, 0, 1)];
    default:       return [];
  }
}

/* --------------------------------------------------------- the view frame

   A drawing lives on a plane and looks in a direction, and those are two
   different facts. A plan looks straight down at a horizontal plane; a section
   looks horizontally at a vertical one; an axonometric looks down a body
   diagonal at whichever plane you want the sheet to be. So the plane says
   where the drawing IS and the look says which way the eye is - and when the
   look is left unsaid it is the plane's own normal, which is the case nine
   times in ten.                                                            */

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                          a[0] * b[1] - a[1] * b[0]];
const unit3 = a => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l < 1e-12 ? null : [a[0] / l, a[1] / l, a[2] / l];
};

//! The frame a projection happens in: where the eye is looking FROM (so the
//! model is on the negative side of z), and the two directions that become the
//! sheet's u and v.
//!
//! \p up is a suggestion. Straight down, "up on the sheet" cannot be the world
//! Z because the world Z is the direction you are looking along - so a plan
//! takes world Y as up, which is what north-up means and what every plan does.
export function viewFrame(origin, look, up) {
  //! THE FRAME'S Z POINTS AT THE EYE, not away from it, and the sign is not a
  //! detail. A view frame is right-handed with u across and v up the sheet, and
  //! for that to hold, z has to be the direction OUT of the sheet - which is
  //! the opposite of the direction you are looking.
  //!
  //! Got the wrong way round, every drawing comes out mirrored: u runs west
  //! instead of east, the plan reads right to left, and a symmetrical building
  //! looks perfectly correct. That is what section 2 of the test is for.
  const gaze = unit3(look) || [0, 0, -1];
  const z = [-gaze[0], -gaze[1], -gaze[2]];
  let hint = unit3(up || [0, 0, 1]);
  if (!hint || Math.abs(dot3(hint, z)) > 0.999) hint = Math.abs(z[2]) > 0.999
    ? [0, 1, 0] : [0, 0, 1];
  const x = unit3(cross3(hint, z)) || [1, 0, 0];
  const y = cross3(z, x);
  return { o: origin || [0, 0, 0], x, y, z };
}

//! A world point, on the sheet. The third coordinate is how far TOWARDS THE
//! EYE it is, so a point beyond the plane is negative and one in front of it
//! is positive - the frame's z points at the eye, and this is measured along
//! it like the other two. Kept, because "behind the cut" and "in front of it"
//! is the one question a cut view has to answer about every line it is given.
export function toPlane(p, frame) {
  const d = sub3(p, frame.o);
  return [dot3(d, frame.x), dot3(d, frame.y), dot3(d, frame.z)];
}

//! And back, so a line picked on the sheet can be pointed at in the model.
export function fromPlane(uv, frame) {
  const [u, v, w = 0] = uv;
  return [frame.o[0] + frame.x[0] * u + frame.y[0] * v + frame.z[0] * w,
          frame.o[1] + frame.x[1] * u + frame.y[1] * v + frame.z[1] * w,
          frame.o[2] + frame.x[2] * u + frame.y[2] * v + frame.z[2] * w];
}

/* ------------------------------------------------------- what is in a view

   AN EXCLUSION LIST, NOT AN INCLUSION LIST, and the difference matters more
   than it sounds. A drawing that names what it contains is a drawing that
   silently misses the wing somebody added this morning - and missing something
   is the one failure a drawing must not have, because nothing about it looks
   wrong. A drawing that names what it LEAVES OUT shows the new wing the moment
   it exists, and somebody has to decide, once, to take it out.

   So the panel shows the model's tree with a tick against everything, and what
   is written down is only the ticks you cleared.                            */

//! The exclusions, read from whatever the argument holds. Anything unreadable
//! is an empty list rather than an error: a view that has lost its exclusions
//! draws too much, which somebody notices, rather than too little.
export function readExclusions(json) {
  if (!json) return [];
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    const list = Array.isArray(parsed) ? parsed : parsed && parsed.off;
    return Array.isArray(list) ? list.filter(id => typeof id === "string") : [];
  } catch (err) { return []; }
}

export const writeExclusions = ids =>
  JSON.stringify({ off: [...new Set(ids.filter(id => typeof id === "string"))].sort() });

//! Is this object in the view? It is not, if it is named - or if anything it
//! sits inside is named, because excluding a set is how you exclude the
//! hundred things in it without listing them.
//!
//! \p parentOf answers "what is this inside", and is asked until it runs out.
export function includedIn(exclusions, id, parentOf) {
  const off = exclusions instanceof Set ? exclusions : new Set(exclusions || []);
  if (!off.size) return true;
  let at = id, guard = 0;
  while (at && guard++ < 1000) {
    if (off.has(at)) return false;
    at = parentOf ? parentOf(at) : null;
  }
  return true;
}

//! Turning one tick on or off, with the list kept as short as it can be: a set
//! that is put back on stops excluding, and so do the things inside it that
//! were only off because it was.
export function toggleExclusion(exclusions, id, on, childrenOf) {
  const off = new Set(exclusions || []);
  if (on) {
    off.delete(id);
    //! Clearing the descendants too. Without this, switching a storey back on
    //! would leave every slab in it off with nothing on screen saying why -
    //! the tick would be set and the slab still missing.
    const walk = at => {
      for (const kid of (childrenOf ? childrenOf(at) : [])) { off.delete(kid); walk(kid); }
    };
    walk(id);
  } else {
    off.add(id);
    const walk = at => {
      for (const kid of (childrenOf ? childrenOf(at) : [])) { off.delete(kid); walk(kid); }
    };
    walk(id);
  }
  return [...off].sort();
}

/* ------------------------------------------------------------ view beyond

   WHAT IS BEHIND THE CUT is a question with three answers and every one of
   them is right somewhere. A plan of a stair core wants everything behind it.
   A structural section wants only the cut, so the steel reads. A site section
   wants the next fifty metres and nothing after, so the hill behind does not
   swallow the building.                                                     */

export const BEYOND = [
  { key: "none", label: "Nothing", hint: "only what the plane passed through" },
  { key: "all",  label: "Everything", hint: "the whole model behind the cut" },
  { key: "depth", label: "As far as", hint: "a depth behind the plane, and no further" },
];

export const beyondNamed = key => BEYOND.find(one => one.key === key) || BEYOND[1];

/* --------------------------------------------------------- joining lines

   HIDDEN-LINE REMOVAL RETURNS SEGMENTS, thousands of them, and each one drawn
   as its own element is a drawing that is slow to draw, impossible to select
   and enormous to save. A wall that reads as one line arrives as forty. So
   they are chained: end to end, while the ends agree, into polylines.

   The tolerance is a length rather than a fraction, because the whole drawing
   is in one unit and the gap that counts as "touching" is the same everywhere
   on the sheet.                                                             */

const keyOf = (p, tol) => Math.round(p[0] / tol) + "," + Math.round(p[1] / tol);

export function chainPolylines(segments, tol = 1e-4) {
  const runs = [];
  //! Every end, and the segments that reach it. A hash rather than a search,
  //! because a search is quadratic and a section of a building is a hundred
  //! thousand segments.
  const ends = new Map();
  const live = segments.filter(s => s && s.length >= 2
    && Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > tol);
  live.forEach((s, i) => {
    for (const p of [s[0], s[s.length - 1]]) {
      const k = keyOf(p, tol);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Array(live.length).fill(false);
  const nextFrom = (p, notThis) => {
    for (const i of (ends.get(keyOf(p, tol)) || [])) {
      if (used[i] || i === notThis) continue;
      return i;
    }
    return -1;
  };
  for (let i = 0; i < live.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const run = live[i].slice();
    //! Forwards, then backwards from the other end, which is what makes a
    //! closed loop come out as one run rather than two halves that meet.
    for (const forwards of [true, false]) {
      for (;;) {
        const tip = forwards ? run[run.length - 1] : run[0];
        const at = nextFrom(tip, -1);
        if (at < 0) break;
        used[at] = true;
        const seg = live[at];
        const same = keyOf(seg[0], tol) === keyOf(tip, tol);
        const add = same ? seg.slice(1) : seg.slice(0, -1).reverse();
        if (forwards) run.push(...add); else run.unshift(...add.reverse());
        if (keyOf(run[0], tol) === keyOf(run[run.length - 1], tol)) break;
      }
    }
    runs.push(run);
  }
  return runs;
}

//! Points in a line, thrown away. Hidden-line removal on a curved surface
//! gives back a hundred points where three would do, and every one of them is
//! a vertex somebody can drag and a number in the saved file.
export function simplify(points, tol = 1e-4) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1], b = points[i], c = points[i + 1];
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
    const span = Math.hypot(c[0] - a[0], c[1] - a[1]);
    //! The distance from the middle point to the chord, which is twice the
    //! area over the base. A chord of nothing means the run doubles back, and
    //! that middle point is the far end of it - never dropped.
    if (span < tol || area / span > tol) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/* ------------------------------------------------------- making a drawing */

//! Named for what it is rather than for its precision, because the sketch
//! already has a `round4` and one scope holds both in the single-file build.
const onSheet = p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];

//! The computed half of a drawing: classified polylines in, sketch elements
//! out, each on the layer its class belongs to.
//!
//! \p runs is { sharp: [[[u,v],…],…], hidden: […], … } - the kernel's
//! classification, already flattened onto the sheet.
export function elementsFromRuns(runs, options = {}) {
  const tol = options.tolerance || 1e-4;
  const elements = [];
  let n = 0;
  for (const kind of DRAW_CLASSES) {
    const given = runs[kind.key];
    if (!given || !given.length) continue;
    const layer = kind.layer;
    for (const run of chainPolylines(given, tol)) {
      const points = simplify(run, tol).map(onSheet);
      if (points.length < 2) continue;
      //! TWO POINTS IS A LINE, not a spline with two control points. It picks
      //! up every relation the sketch knows, it goes out to DXF as a LINE, and
      //! it is what somebody expects to select when they click a wall.
      elements.push(points.length === 2
        ? { id: "d" + (++n), type: "line", a: points[0], b: points[1], layer }
        : { id: "d" + (++n), type: "spline", pts: points, closed:
              Math.hypot(points[0][0] - points[points.length - 1][0],
                         points[0][1] - points[points.length - 1][1]) < tol,
            layer });
    }
  }
  return elements;
}

//! The layers a drawing of this kind arrives with. A projection has no cut, so
//! it does not carry a Cut layer nobody can put anything on.
export function standardLayers(kind = "projection") {
  const wanted = kind === "cut"
    ? ["Cut", "Beyond", "Edges", "Silhouette", "Tangent", "Hidden", "Notes"]
    : ["Edges", "Silhouette", "Tangent", "Hidden", "Notes"];
  return wanted.map(name => ({ name, on: true, locked: name !== "Notes" }));
}

//! THE COMPUTED HALF AND THE AUTHORED HALF, put together into the one drawing
//! everything downstream reads.
//!
//! The computed elements are LOCKED by their layers, because an edit to them
//! is an edit the next rebuild silently discards - and a program that lets you
//! do work it is going to throw away is a program that lies to you. The
//! authored half is untouched: its layers, its elements and its notes come
//! through exactly as they were written.
export function assembleDrawing(computed, authored, kind = "projection") {
  const mine = authored && typeof authored === "object" ? authored : {};
  const layers = standardLayers(kind);
  const at = new Map(layers.map(one => [one.name, one]));
  //! A layer the user has given a pen to keeps it. Standard or their own, the
  //! record they wrote is the record that survives - which is what makes the
  //! pen settings stick across a rebuild.
  for (const said of (Array.isArray(mine.layers) ? mine.layers : [])) {
    if (!said || typeof said.name !== "string" || !said.name) continue;
    const had = at.get(said.name);
    if (had) Object.assign(had, said, { locked: had.locked && said.locked !== false });
    else { const row = { on: true, locked: false, ...said }; layers.push(row); at.set(row.name, row); }
  }
  const notes = (Array.isArray(mine.notes) ? mine.notes : [])
    .filter(one => one && typeof one.type === "string");
  //! The user's own elements keep their ids; the computed ones are numbered
  //! from scratch every rebuild and prefixed, so the two can never collide
  //! however many times either is rebuilt.
  const ownElements = (Array.isArray(mine.elements) ? mine.elements : [])
    .filter(el => el && typeof el.id === "string" && !/^d[0-9]+$/.test(el.id));
  const ownIds = new Set(ownElements.map(el => el.id));
  const constraints = (Array.isArray(mine.constraints) ? mine.constraints : [])
    .filter(c => c && Array.isArray(c.of)
      && c.of.every(name => ownIds.has(String(name).split(".")[0])));
  return { elements: [...computed, ...ownElements], constraints, layers, notes,
           current: typeof mine.current === "string" ? mine.current : "Notes",
           computed: computed.length };
}

/* ------------------------------------------------------------ annotation */

export const NOTE_TYPES = [
  { key: "text",   label: "Text",   hint: "a word on the drawing" },
  { key: "leader", label: "Leader", hint: "a line from a note to the thing it is about" },
  { key: "symbol", label: "Symbol", hint: "a mark: a level, a station, a grid intersection" },
];

//! One note. Held with its own position in the drawing's coordinates, so it
//! moves with the plane the drawing lives on like everything else does.
export function noteOf(type, id, at, options = {}) {
  const layer = options.layer || "Notes";
  switch (type) {
    case "text":
      return { id, type, layer, at: onSheet(at), text: options.text || "Note",
               size: options.size || 2.5, angle: options.angle || 0 };
    case "leader":
      return { id, type, layer, at: onSheet(at),
               //! The elbow is a point, not an angle. A leader that computes
               //! its own elbow looks right until two of them cross, and then
               //! there is nothing to drag.
               via: options.via ? onSheet(options.via) : onSheet([at[0] + 8, at[1] + 8]),
               to: options.to ? onSheet(options.to) : onSheet([at[0] + 20, at[1] + 8]),
               text: options.text || "", size: options.size || 2.5 };
    case "symbol":
      return { id, type, layer, at: onSheet(at),
               symbol: pointSymbol(options.symbol).key, size: options.size || 2.5 };
    default: throw new Error('there is no annotation called "' + type + '"');
  }
}

//! A note, as segments on the sheet - what the viewport draws and what goes
//! out to DXF. Text is not stroked here: it is a string with a place and a
//! size, and the two readers draw it the way each of them draws text.
export function noteStrokes(note) {
  if (!note) return [];
  if (note.type === "symbol") return symbolStrokes(note.symbol, note.at, note.size || 2.5);
  if (note.type === "leader") {
    const out = [[note.at, note.via], [note.via, note.to]];
    //! The arrowhead, drawn rather than implied, because a leader without one
    //! is a line and reads as geometry.
    const span = Math.hypot(note.via[0] - note.at[0], note.via[1] - note.at[1]);
    if (span > 1e-6) {
      const ux = (note.via[0] - note.at[0]) / span, uy = (note.via[1] - note.at[1]) / span;
      const head = Math.min(span * 0.5, (note.size || 2.5) * 1.2);
      for (const side of [1, -1]) {
        const ax = ux * head + -uy * side * head * 0.3;
        const ay = uy * head + ux * side * head * 0.3;
        out.push([note.at, [note.at[0] + ax, note.at[1] + ay]]);
      }
    }
    return out;
  }
  return [];
}

/* --------------------------------------------------------------- the sheet

   A SCALE IS A RATIO, AND IT IS NOT A SIZE. The drawing is made at full size
   in the model's own units - a wall three metres long is three metres long on
   it - and the scale is how much of a sheet it would take when printed. Held
   because a drawing that does not know its scale cannot letter itself: text at
   2.5 mm on a 1:100 plan is 250 mm in the drawing, and getting that wrong is
   the difference between a title and a headline.                            */

export const SHEET_SCALES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];

//! What one millimetre on the printed sheet is, in the drawing's units. What
//! every piece of lettering and every symbol is sized by.
export const sheetUnit = scale => Math.max(1e-6, scale) ;

export function saysView(view) {
  const where = view.kind === "cut" ? "Cut" : "Projection";
  const bits = [where.toLowerCase()];
  if (view.scale && view.scale !== 1) bits.push("1:" + view.scale);
  if (view.excluded) bits.push(view.excluded + " left out");
  if (view.kind === "cut" && view.beyond)
    bits.push(view.beyond === "none" ? "cut only"
            : view.beyond === "depth" ? "seeing " + view.depth + " beyond" : "seeing beyond");
  return bits.join(" · ");
}

//! What the drawing amounts to, for the panel: how many lines on each layer.
export function countByLayer(drawing) {
  const out = new Map();
  for (const el of (drawing.elements || [])) {
    const name = (typeof el.layer === "string" && el.layer) || SKETCH_LAYER;
    out.set(name, (out.get(name) || 0) + 1);
  }
  for (const note of (drawing.notes || [])) {
    const name = (typeof note.layer === "string" && note.layer) || "Notes";
    out.set(name, (out.get(name) || 0) + 1);
  }
  return out;
}
