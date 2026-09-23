// The sketch: two dimensions, on a plane.
//
// A sketch is a drawing in its own coordinates - u across, v up - and a plane
// it lives on. Nothing in the drawing knows where that plane is. Move the
// plane, or point the sketch at a different one, and every line, arc and
// spline in it goes with it, because none of them was ever written in world
// coordinates. That is the whole idea, and it is why the plane and the origin
// are references rather than numbers.
//
// This file is the drawing's semantics and nothing else: no OpenCascade, no
// DOM. The kernel reads it to build edges on the plane; the viewport reads the
// same functions to draw the sketch you are still drawing and to decide what
// your cursor is snapping to. One definition, two readers.

/* ------------------------------------------------------------- the format */

//! What a drawing is:
//!
//!   { elements:    [ { id, type, … } ],
//!     constraints: [ { type, … } ] }
//!
//! Every element carries its own geometry in 2D. Nothing is implicit and
//! nothing is derived at rest, so the JSON is the drawing.
export const SKETCH_TYPES = ["point", "line", "rect", "arc", "circle", "ellipse", "oblong",
                             "spline", "bspline"];

//! An ellipse with no a0/a1 is the whole of one; with them it is the arc of
//! one between those two parameters. Said here because four different files
//! ask the question and none of them should guess.
export const wholeEllipse = el =>
  el.a0 === undefined || el.a1 === undefined || Math.abs((el.a1 - el.a0) - Math.PI * 2) < 1e-9;

//! The relations the solver knows. Each one is a projection: it moves the
//! handles it governs the shortest way to satisfy itself, and the solver runs
//! them all in turn until they stop moving.
export const SKETCH_RELATIONS = [
  { key: "coincident",    label: "Coincident",    takes: 2, of: "handle",
    hint: "two ends meet" },
  { key: "horizontal",    label: "Horizontal",    takes: 1, of: "line",
    hint: "a line lies along u" },
  { key: "vertical",      label: "Vertical",      takes: 1, of: "line",
    hint: "a line lies along v" },
  { key: "parallel",      label: "Parallel",      takes: 2, of: "line",
    hint: "two lines run the same way" },
  { key: "perpendicular", label: "Perpendicular", takes: 2, of: "line",
    hint: "two lines meet at a right angle" },
  { key: "tangent",       label: "Tangent",       takes: 2, of: "any",
    hint: "a line touches a circle, or two circles touch" },
  //! Three, and they are not the same kind of thing: the point first, then the
  //! two curves it sits on. Every other relation here moves what it names to
  //! satisfy itself; this one moves only the point, because a crossing is a
  //! fact about the two curves rather than something to be negotiated with.
  { key: "intersect",     label: "Intersection",  takes: 3, of: "point and two",
    hint: "a point sits where two curves cross" },
];

export const EMPTY_SKETCH = { elements: [], constraints: [] };

/* ------------------------------------------------------------------ maths */

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = a => Math.hypot(a[0], a[1]);
const norm = a => { const l = len(a); return l < 1e-12 ? null : [a[0] / l, a[1] / l]; };
const perp = a => [-a[1], a[0]];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const sketchRound = p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];

/* --------------------------------------------------------------- elements */

//! A fresh element of each kind, given the clicks that made it. The viewport
//! collects the points; this decides what they mean.
export function sketchElement(type, id, clicks) {
  const p = i => clicks[i] || [0, 0];
  switch (type) {
    case "point":  return { id, type, p: sketchRound(p(0)) };
    case "line":   return { id, type, a: sketchRound(p(0)), b: sketchRound(p(1)) };
    case "circle": return { id, type, c: sketchRound(p(0)), r: round1(len(sub(p(1), p(0)))) };
    case "arc": {
      // Centre, then start, then a point that says how far round to go.
      const c = p(0), r = len(sub(p(1), c));
      const a0 = Math.atan2(p(1)[1] - c[1], p(1)[0] - c[0]);
      let a1 = Math.atan2(p(2)[1] - c[1], p(2)[0] - c[0]);
      // Always the short way round unless the third click says otherwise.
      while (a1 < a0) a1 += Math.PI * 2;
      return { id, type, c: sketchRound(c), r: round1(r), a0: round4(a0), a1: round4(a1) };
    }
    case "ellipse": {
      const c = p(0);
      const major = sub(p(1), c);
      const rx = len(major) || 1;
      const ry = Math.max(0.1, Math.abs(dot(sub(p(2), c), perp(norm(major) || [0, 1]))));
      return { id, type, c: sketchRound(c), rx: round1(rx), ry: round1(Math.min(ry, rx * 0.999)),
               rot: round4(Math.atan2(major[1], major[0])) };
    }
    case "oblong": {
      const a = p(0), b = p(1);
      const along = norm(sub(b, a)) || [1, 0];
      const r = Math.max(0.1, Math.abs(dot(sub(p(2), b), perp(along))));
      return { id, type, a: sketchRound(a), b: sketchRound(b), r: round1(r) };
    }
    //! TWO OPPOSITE CORNERS, square to the sheet. The one profile a drawing
    //! board is asked for more than any other, and it was the one shape you
    //! had to build out of four lines and four coincidences. Square to u and
    //! v because that is what a rectangle on a sheet of paper is; a rectangle
    //! at an angle is this one on a plane that is at that angle, which is how
    //! a modeller would rather say it anyway.
    case "rect":   return { id, type, a: sketchRound(p(0)), b: sketchRound(p(1)) };
    case "spline": return { id, type, pts: clicks.map(sketchRound), closed: false };
    // Drawn, a B-spline is its control points - the polygon you pull on, not
    // a run of points the curve goes through. Imported, it is whatever the
    // file said: a degree, a knot vector and, if it is rational, weights.
    case "bspline": return { id, type, ctrl: clicks.map(sketchRound), degree: 3, closed: false };
    default: throw new Error('there is no sketch element called "' + type + '"');
  }
}

//! A relation over what is selected. \p of is the elements or the handles,
//! in the order they were picked, and how many there must be is in
//! SKETCH_RELATIONS - so a panel offering relations and a solver running them
//! never disagree about what one is.
export function sketchRelation(type, of) {
  const spec = SKETCH_RELATIONS.find(r => r.key === type);
  if (!spec) throw new Error('there is no sketch relation called "' + type + '"');
  const list = (of || []).slice(0, spec.takes);
  if (list.length !== spec.takes)
    throw new Error(spec.label + " takes " + spec.takes
      + (spec.of === "handle" ? " ends" : " " + spec.of === "any" ? " elements" : " lines"));
  return { type, of: list };
}

const round1 = v => Math.round(v * 1e4) / 1e4;
const round4 = v => Math.round(v * 1e6) / 1e6;

//! How many clicks each kind wants before it is a thing. A spline is however
//! many you give it.
export const SKETCH_CLICKS = { point: 1, line: 2, rect: 2, circle: 2, arc: 3, ellipse: 3,
                               oblong: 3, spline: 0, bspline: 0 };

//! The points on an element that can be taken hold of - by the solver, by a
//! coincidence, or by a cursor. Named, because a constraint says "e1.b".
export function sketchHandles(el) {
  switch (el.type) {
    case "point":   return [["p", el.p]];
    case "line":    return [["a", el.a], ["b", el.b]];
    case "circle":  return [["c", el.c]];
    case "arc":     return [["c", el.c], ["start", arcEnd(el, el.a0)], ["end", arcEnd(el, el.a1)]];
    case "ellipse": return wholeEllipse(el) ? [["c", el.c]]
      : [["c", el.c], ["start", ellipseAt(el, el.a0)], ["end", ellipseAt(el, el.a1)]];
    case "oblong":  return [["a", el.a], ["b", el.b]];
    // All four, because a rectangle is dragged by whichever corner is nearest
    // the hand. The two that are not stored are named for the coordinates they
    // take from each end, so "r1.ab" is a's u and b's v.
    case "rect":    return [["a", el.a], ["b", el.b],
                            ["ab", [el.a[0], el.b[1]]], ["ba", [el.b[0], el.a[1]]]];
    case "spline":  return el.pts.map((p, i) => ["p" + i, p]);
    case "bspline": return (el.ctrl || []).map((p, i) => ["p" + i, p]);
    default: return [];
  }
}

const arcEnd = (el, angle) =>
  [el.c[0] + el.r * Math.cos(angle), el.c[1] + el.r * Math.sin(angle)];

//! Where an ellipse is at a parameter. Not an angle: the parameter of an
//! ellipse runs round the circle it is a squashed copy of, which is why the
//! two are only the same at the axes.
export const ellipseAt = (el, t) => {
  const cos = Math.cos(el.rot || 0), sin = Math.sin(el.rot || 0);
  const x = el.rx * Math.cos(t), y = el.ry * Math.sin(t);
  return [el.c[0] + x * cos - y * sin, el.c[1] + x * sin + y * cos];
};

//! Moving a handle. An arc's endpoint is not a free point - it is an angle and
//! a radius - so moving it turns and resizes the arc instead of tearing it.
export function sketchMoveHandle(el, key, to) {
  const p = sketchRound(to);
  switch (el.type) {
    case "point":   el.p = p; return;
    case "line":    if (key === "a") el.a = p; else el.b = p; return;
    case "circle":  el.c = p; return;
    case "ellipse":
      if (key === "c" || wholeEllipse(el)) { el.c = p; return; }
      {
        // The end of an elliptical arc is a parameter, not a point: it is
        // moved to wherever on the ellipse is nearest what was asked for.
        const cos = Math.cos(el.rot || 0), sin = Math.sin(el.rot || 0);
        const dx = to[0] - el.c[0], dy = to[1] - el.c[1];
        const u = (dx * cos + dy * sin) / (el.rx || 1);
        const v = (-dx * sin + dy * cos) / (el.ry || 1);
        const t = Math.atan2(v, u);
        if (key === "start") el.a0 = round4(t);
        else { let a1 = t; while (a1 <= el.a0) a1 += Math.PI * 2; el.a1 = round4(a1); }
      }
      return;
    case "oblong":  if (key === "a") el.a = p; else el.b = p; return;
    case "rect":
      // Dragging a corner moves the two edges that meet at it and leaves the
      // opposite corner where it is, which is what a rectangle handle does.
      if (key === "a") el.a = p;
      else if (key === "b") el.b = p;
      else if (key === "ab") { el.a = sketchRound([p[0], el.a[1]]); el.b = sketchRound([el.b[0], p[1]]); }
      else { el.b = sketchRound([p[0], el.b[1]]); el.a = sketchRound([el.a[0], p[1]]); }
      return;
    case "arc":
      if (key === "c") { el.c = p; return; }
      {
        const away = sub(to, el.c);
        const r = len(away);
        if (r > 1e-9) {
          el.r = round1(r);
          const angle = Math.atan2(away[1], away[0]);
          if (key === "start") el.a0 = round4(angle);
          else { let a1 = angle; while (a1 < el.a0) a1 += Math.PI * 2; el.a1 = round4(a1); }
        }
      }
      return;
    case "spline": {
      const at = Number(key.slice(1));
      if (Number.isInteger(at) && el.pts[at]) el.pts[at] = p;
      return;
    }
    case "bspline": {
      const at = Number(key.slice(1));
      if (Number.isInteger(at) && el.ctrl && el.ctrl[at]) el.ctrl[at] = p;
      return;
    }
  }
}

const byId = drawing => new Map((drawing.elements || []).map(el => [el.id, el]));

//! "e3.b" - the element and the handle on it.
export function sketchHandleAt(drawing, reference) {
  const [id, key] = String(reference || "").split(".");
  const el = byId(drawing).get(id);
  if (!el) return null;
  const found = sketchHandles(el).find(([k]) => k === key);
  return found ? { el, key, p: found[1] } : null;
}

/* ----------------------------------------------------------- the outlines */

//! An element as a run of 2D points - what the viewport draws, and what the
//! chain walker measures. \p quality is points per full turn on anything round.
export function sketchOutline(el, quality = 64) {
  const round = (from, to, radius, centre) => {
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) / (Math.PI * 2) * quality));
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = from + (to - from) * (i / steps);
      out.push([centre[0] + radius * Math.cos(t), centre[1] + radius * Math.sin(t)]);
    }
    return out;
  };
  switch (el.type) {
    case "point":  return [el.p];
    case "line":   return [el.a, el.b];
    case "circle": return round(0, Math.PI * 2, el.r, el.c);
    case "arc":    return round(el.a0, el.a1, el.r, el.c);
    case "ellipse": {
      const whole = wholeEllipse(el);
      const from = whole ? 0 : el.a0, to = whole ? Math.PI * 2 : el.a1;
      const steps = Math.max(2, Math.ceil(Math.abs(to - from) / (Math.PI * 2) * quality));
      const out = [];
      for (let i = 0; i <= steps; i++) out.push(ellipseAt(el, from + (to - from) * (i / steps)));
      return out;
    }
    case "oblong": {
      const along = norm(sub(el.b, el.a)) || [1, 0];
      const across = perp(along);
      const angle = Math.atan2(along[1], along[0]);
      return [
        ...round(angle - Math.PI / 2, angle + Math.PI / 2, el.r, el.b),
        ...round(angle + Math.PI / 2, angle + Math.PI * 1.5, el.r, el.a),
        add(el.b, mul(across, -el.r)),
      ];
    }
    case "rect": {
      const [u0, v0] = el.a, [u1, v1] = el.b;
      return [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]];
    }
    case "spline": return splinePoints(el, Math.max(8, quality / 4));
    case "bspline": return bsplinePoints(el, Math.max(8, quality / 4));
    default: return [];
  }
}

//! Catmull-Rom through the points, parameterised by index so the curve may
//! double back - the same spline the written features use.
export function splinePoints(el, perSpan = 12) {
  const pts = el.pts || [];
  if (pts.length < 2) return pts.slice();
  if (pts.length === 2) return pts.slice();
  const closed = !!el.closed;
  const n = pts.length;
  const at = i => pts[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
  const spans = closed ? n : n - 1;
  const out = [];
  for (let s = 0; s < spans; s++) {
    const [a, b, c, d] = [at(s - 1), at(s), at(s + 1), at(s + 2)];
    for (let j = 0; j < perSpan; j++) {
      const u = j / perSpan;
      out.push([0, 1].map(k => 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * u
        + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u * u
        + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u * u * u)));
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

//! A B-spline, evaluated where it actually is.
//!
//! De Boor's algorithm, which is the one that answers "where is this curve" by
//! repeatedly cutting corners off the control polygon rather than by summing
//! basis functions - the same answer, without ever evaluating a basis. Weights
//! are carried in the fourth coordinate and divided out at the end, which is
//! the whole of what makes a curve rational: a circle written as a B-spline is
//! a rational one, and dropping the weights would turn it into a rounded
//! square.
export function bsplinePoints(el, perSpan = 16) {
  const given = el.ctrl || [];
  if (given.length < 2) return given.slice();
  const wrap = el.closed ? Math.min(el.degree || 3, given.length) : 0;
  const ctrl = el.closed ? given.concat(given.slice(0, wrap)) : given;
  const degree = Math.max(1, Math.min(el.degree || 3, ctrl.length - 1));
  if (ctrl.length === 2) return ctrl.slice();

  const weights = el.weights && el.weights.length === given.length
    ? (el.closed ? el.weights.concat(el.weights.slice(0, wrap)) : el.weights) : null;
  const knots = el.knots && el.knots.length === ctrl.length + degree + 1
    ? el.knots : uniformKnots(ctrl.length, degree, el.closed);

  const n = ctrl.length;
  const point = t => {
    // Which span t is in. The curve is only defined between knot[degree] and
    // knot[n], which is why both ends are clamped to that range.
    let k = degree;
    while (k < n - 1 && t >= knots[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= degree; j++) {
      const i = k - degree + j;
      const w = weights ? weights[i] : 1;
      d[j] = [ctrl[i][0] * w, ctrl[i][1] * w, w];
    }
    for (let r = 1; r <= degree; r++)
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j;
        const span = knots[i + degree - r + 1] - knots[i];
        const a = span > 1e-12 ? (t - knots[i]) / span : 0;
        d[j] = [d[j - 1][0] + (d[j][0] - d[j - 1][0]) * a,
                d[j - 1][1] + (d[j][1] - d[j - 1][1]) * a,
                d[j - 1][2] + (d[j][2] - d[j - 1][2]) * a];
      }
    const [x, y, w] = d[degree];
    return w > 1e-12 ? [x / w, y / w] : [x, y];
  };

  const from = knots[degree], to = knots[n];
  const steps = Math.max(2, Math.round(perSpan * (n - degree)));
  const out = [];
  for (let i = 0; i <= steps; i++) out.push(point(from + (to - from) * (i / steps)));
  return out;
}

//! The knot vector a spline gets when it arrived without one: clamped at both
//! ends so the curve starts at the first control point and finishes at the
//! last, or evenly spaced when it is periodic and does neither.
export function uniformKnots(count, degree, periodic = false) {
  const knots = [];
  if (periodic) {
    for (let i = 0; i < count + degree + 1; i++) knots.push(i - degree);
    return knots;
  }
  for (let i = 0; i < count + degree + 1; i++)
    knots.push(i <= degree ? 0 : i >= count ? count - degree : i - degree);
  return knots;
}

//! The same curve, walked the other way. A B-spline reversed is its control
//! points reversed AND its knots turned inside out - reverse the points alone
//! and a curve with an uneven knot vector comes back a different shape.
export function reversedBspline(el) {
  const ctrl = (el.ctrl || []).slice().reverse();
  const out = { ctrl };
  if (el.weights) out.weights = el.weights.slice().reverse();
  if (el.knots && el.knots.length) {
    const first = el.knots[0], last = el.knots[el.knots.length - 1];
    out.knots = el.knots.map(k => first + last - k).reverse();
  }
  return out;
}

//! Where an element starts and ends, and whether it closes on itself. A point
//! is neither, so it never joins a loop.
export function sketchEnds(el) {
  switch (el.type) {
    case "point":  return null;
    case "line":   return { a: el.a, b: el.b, closed: false };
    case "arc":    return { a: arcEnd(el, el.a0), b: arcEnd(el, el.a1), closed: false };
    case "circle":
    case "rect":
    case "oblong": return { a: null, b: null, closed: true };
    case "ellipse": return wholeEllipse(el) ? { a: null, b: null, closed: true }
      : { a: ellipseAt(el, el.a0), b: ellipseAt(el, el.a1), closed: false };
    case "spline": {
      const pts = el.pts || [];
      if (pts.length < 2) return null;
      return el.closed ? { a: null, b: null, closed: true }
                       : { a: pts[0], b: pts[pts.length - 1], closed: false };
    }
    case "bspline": {
      const run = bsplinePoints(el, 8);
      if (run.length < 2) return null;
      return el.closed ? { a: null, b: null, closed: true }
                       : { a: run[0], b: run[run.length - 1], closed: false };
    }
    default: return null;
  }
}

/* ---------------------------------------------------------------- the loops

   A face needs a closed run of edges. Circles, ellipses and slots are already
   one; the rest have to be walked, end to end, until the walk comes back to
   where it started. Anything left over stays a wire.                        */

//! Which handle of an element is the end the walk calls a, and which is b.
//! sketchEnds answers where they are; this answers what they are CALLED, which
//! is what a coincidence has to name.
export function sketchEndKeys(el) {
  switch (el.type) {
    case "line":    return { a: "a", b: "b" };
    case "arc":
    case "ellipse": return { a: "start", b: "end" };
    case "spline":  return { a: "p0", b: "p" + Math.max(0, (el.pts || []).length - 1) };
    case "bspline": return { a: "p0", b: "p" + Math.max(0, (el.ctrl || []).length - 1) };
    default:        return null;
  }
}

//! The size of the drawing, corner to corner - of what is DRAWN, which is not
//! the same as where its numbers are. A shallow arc a kilometre in radius has
//! its centre a kilometre off the paper, and a drawing measured to that is
//! five times the size of the drawing.
export function sketchExtent(drawing) {
  let box = null;
  for (const el of (drawing.elements || []))
    for (const p of sketchOutline(el, 8)) {
      if (!box) box = [p[0], p[1], p[0], p[1]];
      else {
        box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]);
        box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]);
      }
    }
  return box ? Math.hypot(box[2] - box[0], box[3] - box[1]) : 0;
}

//! Below what distance two points in THIS drawing are the same point.
//!
//! It has to be a fraction of the drawing rather than a number of millimetres,
//! because the drawings are not all the same size. A site plan seven hundred
//! metres across, drawn in millimetres, arrives with corners that miss each
//! other by four tenths of a millimetre - six parts in ten million, which is
//! nothing at all on a survey and was more than enough to stop the outline
//! closing. On a bracket a hundred millimetres across the same fraction is a
//! tenth of a micron, and the flat tolerance the caller asked for wins.
export const sketchGrain = drawing => Math.max(1e-4, sketchExtent(drawing) * 1e-6);

//! The coincidences a drawing already holds, as a set of unordered pairs.
function heldTogether(drawing) {
  const held = new Set();
  for (const c of (drawing.constraints || []))
    if (c.type === "coincident" && (c.of || []).length === 2)
      held.add([c.of[0], c.of[1]].sort().join("|"));
  return held;
}

export function sketchLoops(drawing, tolerance = 0.05) {
  const elements = (drawing.elements || []).filter(el => sketchEnds(el));
  const loops = [], open = [];
  const spare = [];

  for (const el of elements) {
    const ends = sketchEnds(el);
    if (ends.closed) loops.push([{ id: el.id, reversed: false }]);
    else spare.push(el);
  }

  const reach = Math.max(tolerance, sketchGrain(drawing));

  // Everything the walk asks about an element, worked out once. The walk is a
  // pass over every element for every element it grows by, so anything done
  // per comparison is done a quarter of a million times on a road layout -
  // including, if you are careless, building two strings and sorting them.
  const at = new Map();
  for (const el of spare) {
    const ends = sketchEnds(el);
    const keys = sketchEndKeys(el);
    at.set(el.id, { a: ends.a, b: ends.b,
                    refA: keys ? el.id + "." + keys.a : null,
                    refB: keys ? el.id + "." + keys.b : null });
  }
  // Two ends a coincidence holds together ARE one point, however far apart the
  // numbers still say they are. Said once and honoured everywhere: a drawing
  // that has been told its corners meet does not have to be moved before it
  // will close.
  const held = new Map();
  for (const c of (drawing.constraints || [])) {
    if (c.type !== "coincident" || (c.of || []).length !== 2) continue;
    for (const [one, two] of [[c.of[0], c.of[1]], [c.of[1], c.of[0]]]) {
      if (!held.has(one)) held.set(one, new Set());
      held.get(one).add(two);
    }
  }
  const refKey = which => (which === "a" ? "refA" : "refB");
  const meets = (from, to) => {
    const p = at.get(from.id)[from.which], q = at.get(to.id)[to.which];
    if (p && q && Math.hypot(p[0] - q[0], p[1] - q[1]) <= reach) return true;
    if (!held.size) return false;
    const one = at.get(from.id)[refKey(from.which)], two = at.get(to.id)[refKey(to.which)];
    return !!(one && two && held.has(one) && held.get(one).has(two));
  };

  // Where the ends are, on a grid a tolerance wide, and which end each named
  // handle belongs to. Both so that growing a chain asks about the handful of
  // ends NEAR the one in hand rather than about all six hundred: the walk is a
  // pass over everything for every element it grows by, and a road layout
  // grows five hundred times.
  const cell = Math.max(reach, 1e-9);
  const grid = new Map();
  const byRef = new Map();
  for (const el of spare) for (const which of ["a", "b"]) {
    const end = at.get(el.id)[which];
    if (end) {
      const key = Math.floor(end[0] / cell) + "," + Math.floor(end[1] / cell);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push({ id: el.id, which });
    }
    const ref = at.get(el.id)[refKey(which)];
    if (ref) byRef.set(ref, { id: el.id, which });
  }
  const around = end => {
    const out = [];
    const p = at.get(end.id)[end.which];
    if (p) {
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
        for (const one of (grid.get((cx + dx) + "," + (cy + dy)) || [])) out.push(one);
    }
    // And whatever a coincidence says meets it, wherever that happens to be.
    const ref = at.get(end.id)[refKey(end.which)];
    for (const other of (held.get(ref) || [])) {
      const found = byRef.get(other);
      if (found) out.push(found);
    }
    return out;
  };

  const used = new Set();
  for (const seed of spare) {
    if (used.has(seed.id)) continue;
    const chain = [{ id: seed.id, reversed: false }];
    used.add(seed.id);
    let head = { id: seed.id, which: "a" }, tail = { id: seed.id, which: "b" };

    let grew = true;
    while (grew) {
      grew = false;
      for (const next of around(tail)) {
        if (used.has(next.id) || !meets(tail, next)) continue;
        chain.push({ id: next.id, reversed: next.which === "b" });
        tail = { id: next.id, which: next.which === "a" ? "b" : "a" };
        used.add(next.id);
        grew = true;
        break;
      }
      if (grew) continue;
      for (const next of around(head)) {
        if (used.has(next.id) || !meets(head, next)) continue;
        chain.unshift({ id: next.id, reversed: next.which === "a" });
        head = { id: next.id, which: next.which === "a" ? "b" : "a" };
        used.add(next.id);
        grew = true;
        break;
      }
    }
    if (chain.length >= 2 && meets(head, tail)) loops.push(chain);
    else open.push(chain);
  }
  return { loops, open };
}

//! Every pair of ends that lie on top of one another, as the coincidences they
//! ought to be. A DXF is a heap of separate LINE and ARC entities that happen
//! to meet; nothing in the file says they meet, and after the first drag they
//! no longer do. Saying it - once, on arrival - is what turns a heap of
//! entities into a profile you can pull about.
//!
//! Pairs already held are not offered again, and the two ends of one element
//! are never joined to each other: an arc that nearly closes on itself is an
//! arc, not a mistake.
export function sketchOverlaps(drawing, tolerance) {
  const reach = tolerance === undefined ? sketchGrain(drawing) : tolerance;
  const ends = [];
  for (const el of (drawing.elements || [])) {
    const found = sketchEnds(el);
    const keys = sketchEndKeys(el);
    if (!found || found.closed || !keys) continue;
    if (found.a) ends.push({ id: el.id, ref: el.id + "." + keys.a, p: found.a });
    if (found.b) ends.push({ id: el.id, ref: el.id + "." + keys.b, p: found.b });
  }
  // Grouped rather than paired: three ends meeting at a corner is one corner,
  // and wants two relations holding it, not three.
  const cell = Math.max(reach, 1e-9);
  const grid = new Map();
  ends.forEach((end, at) => {
    const key = Math.floor(end.p[0] / cell) + "," + Math.floor(end.p[1] / cell);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(at);
  });
  const parent = ends.map((_, i) => i);
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < ends.length; i++) {
    const cx = Math.floor(ends[i].p[0] / cell), cy = Math.floor(ends[i].p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const j of (grid.get((cx + dx) + "," + (cy + dy)) || [])) {
        if (j <= i || ends[i].id === ends[j].id) continue;
        if (Math.hypot(ends[i].p[0] - ends[j].p[0], ends[i].p[1] - ends[j].p[1]) > reach) continue;
        const a = root(i), b = root(j);
        if (a !== b) parent[a] = b;
      }
  }
  const groups = new Map();
  for (let i = 0; i < ends.length; i++) {
    const at = root(i);
    if (!groups.has(at)) groups.set(at, []);
    groups.get(at).push(i);
  }
  const held = heldTogether(drawing);
  const out = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i + 1 < group.length; i++) {
      const of = [ends[group[i]].ref, ends[group[i + 1]].ref];
      const key = of.slice().sort().join("|");
      if (held.has(key)) continue;
      held.add(key);
      out.push({ type: "coincident", of });
    }
  }
  return out;
}

//! Where each relation should be drawn, and what it is holding. A relation is
//! not geometry, so it has no position of its own - it is put beside the thing
//! it governs, which is the only place it means anything.
//!
//! Returns one entry per constraint, in the order they are stored, so the
//! index is what an edit uses to name one.
export function sketchRelationMarks(drawing) {
  const map = byId(drawing);
  // A relation is drawn beside what it holds, so it goes off with it: turning
  // a layer off used to leave its coincidences hanging in the air over nothing.
  // A relation that reaches onto a layer that is off goes too - half a
  // coincidence is not a mark anybody can read.
  const off = new Set(sketchLayers(drawing).filter(l => !l.on).map(l => l.name));
  const hiddenRef = name => {
    const el = map.get(String(name || "").split(".")[0]);
    return !!el && off.has(layerName(el));
  };
  const spot = name => {
    const [id, key] = String(name || "").split(".");
    const el = map.get(id);
    if (!el) return null;
    if (key) {
      const found = sketchHandles(el).find(([k]) => k === key);
      return found ? found[1] : null;
    }
    // A whole element is marked halfway along its own outline - the midpoint of
    // a line, the far side of a circle - not at one of its ends, where it would
    // sit on top of whatever holds that end.
    const line = sketchOutline(el, 24);
    if (!line.length) return null;
    if (line.length === 1) return line[0];
    const half = (line.length - 1) / 2;
    const lo = line[Math.floor(half)], hi = line[Math.ceil(half)];
    return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
  };
  return (drawing.constraints || []).map((c, at) => {
    if (off.size && (c.of || []).some(hiddenRef)) return null;
    const points = (c.of || []).map(spot).filter(Boolean);
    if (!points.length) return null;
    // Most marks sit between what they govern. An intersection sits ON its
    // point: that IS the constraint, and averaging it with the middles of two
    // long curves would put the mark somewhere neither of them goes.
    const p = c.type === "intersect" ? points[0]
      : points.reduce((sum, q) => [sum[0] + q[0], sum[1] + q[1]], [0, 0])
              .map(v => v / points.length);
    return { at, type: c.type, of: c.of, p, on: points };
  }).filter(Boolean);
}

//! Which way an element is heading when it arrives at one of its ends. What a
//! CAD sketcher continues when you carry on drawing: the next arc leaves the
//! corner going the same way the last line came in, so the two meet smoothly
//! instead of at a kink.
export function sketchDirectionAt(el, key) {
  if (!el) return null;
  if (el.type === "line") return key === "a" ? norm(sub(el.a, el.b)) : norm(sub(el.b, el.a));
  if (el.type === "arc") {
    // An arc drawn from a0 to a1 runs anticlockwise, so the way it is going at
    // any angle is the radius turned a quarter turn the same way.
    const at = key === "start" ? el.a0 : el.a1;
    const out = [-Math.sin(at), Math.cos(at)];
    return key === "start" ? [-out[0], -out[1]] : out;
  }
  if (el.type === "spline") {
    const pts = el.pts || [];
    if (pts.length < 2) return null;
    const at = Number(String(key).slice(1));
    if (at === 0) return norm(sub(pts[0], pts[1]));
    if (at === pts.length - 1) return norm(sub(pts[at], pts[at - 1]));
    return norm(sub(pts[at + 1], pts[at - 1]));
  }
  return null;
}

//! The arc that leaves \p from in the direction \p tangent and arrives at
//! \p to. There is exactly one, and this is the whole of what a tangent-arc
//! tool does: the centre is somewhere on the line through \p from at right
//! angles to the tangent, and the radius is whatever puts \p to on the circle.
//!
//!   |from + r*N - to| = |r|,  N perpendicular to the tangent
//!     =>  r = -(D.D) / (2 N.D)   with D = from - to
//!
//! Returns null when the three are in a line and no arc exists - draw the line
//! instead, which is what that degenerate case actually is.
export function sketchTangentArc(from, tangent, to, id) {
  const t = norm(tangent);
  if (!t) return null;
  const N = perp(t);
  const D = sub(from, to);
  const below = 2 * dot(N, D);
  if (Math.abs(below) < 1e-9 || dot(D, D) < 1e-12) return null;
  const r = -dot(D, D) / below;
  const c = add(from, mul(N, r));
  const radius = Math.abs(r);
  if (!(radius > 1e-9) || !Number.isFinite(radius)) return null;

  const angleOf = p => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const a = angleOf(from), b = angleOf(to);
  const turn = x => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  // An arc is stored as a sweep that only ever increases, so if the tangent
  // says it leaves `from` clockwise it is written the other way round - the
  // same arc, walked from `to`. Which end is which never mattered to a chain.
  const anticlockwise = dot([-Math.sin(a), Math.cos(a)], t) > 0;
  const a0 = anticlockwise ? a : b;
  const a1 = a0 + turn(anticlockwise ? b - a : a - b);
  return { id, type: "arc", c: sketchRound(c), r: round1(radius),
           a0: round4(a0), a1: round4(a1) };
}

/* ------------------------------------------------------------ the fillet

   ROUNDING A DRAWN CORNER. Two lines meeting at a corner and an arc of a given
   radius tangent to both: the oldest tool on a drawing board and the one that
   was missing here, so every rounded profile had to be drawn as an arc by hand
   and then held on with two tangencies that may or may not have solved.

   The whole of it is finding the CENTRE. An arc of radius r tangent to a line
   has its centre on one of the two lines parallel to it at r; tangent to a
   circle of radius R, on one of the two circles about the same centre at R + r
   and R - r. So the centre of a fillet between any two of those is where one
   of the first pair crosses one of the second - four candidates, and the right
   one is the one nearest the corner being rounded. That is exact for lines and
   arcs alike, which is the point of doing it this way rather than by walking
   back along a tangent.

   The two tangency points come free once the centre is known: the foot of the
   perpendicular on a line, and the crossing of the centre line on a circle.
   Both curves are then trimmed to them and the arc is put in between, held
   with a coincidence at either end so the drawing still says why it is a
   corner.                                                                   */

//! What the two offset paths of an element are. A line gives two lines, an arc
//! or a circle two circles. Anything else gives nothing, which is how this
//! refuses a spline rather than guessing at one.
function offsetsOf(el, r) {
  if (el.type === "line") {
    const along = norm(sub(el.b, el.a));
    if (!along) return [];
    const side = perp(along);
    return [{ line: true, at: add(el.a, mul(side, r)), along },
            { line: true, at: add(el.a, mul(side, -r)), along }];
  }
  if (el.type === "arc" || el.type === "circle") {
    const out = [{ line: false, c: el.c, r: el.r + r }];
    if (el.r - r > 1e-9) out.push({ line: false, c: el.c, r: el.r - r });
    return out;
  }
  return [];
}

//! Where two offset paths cross. Two lines give one point, a line and a circle
//! up to two, two circles up to two.
function offsetCross(one, two) {
  if (one.line && two.line) {
    const bottom = one.along[0] * two.along[1] - one.along[1] * two.along[0];
    if (Math.abs(bottom) < 1e-12) return [];
    const d = sub(two.at, one.at);
    const t = (d[0] * two.along[1] - d[1] * two.along[0]) / bottom;
    return [add(one.at, mul(one.along, t))];
  }
  if (one.line !== two.line) {
    const line = one.line ? one : two, circle = one.line ? two : one;
    const d = sub(circle.c, line.at);
    const along = line.along;
    const foot = add(line.at, mul(along, dot(d, along)));
    const off = len(sub(circle.c, foot));
    if (off > circle.r + 1e-9) return [];
    const half = Math.sqrt(Math.max(0, circle.r * circle.r - off * off));
    return [add(foot, mul(along, half)), add(foot, mul(along, -half))];
  }
  const between = sub(two.c, one.c);
  const span = len(between);
  if (span < 1e-12 || span > one.r + two.r + 1e-9
      || span < Math.abs(one.r - two.r) - 1e-9) return [];
  const along = mul(between, 1 / span);
  const a = (one.r * one.r - two.r * two.r + span * span) / (2 * span);
  const half = Math.sqrt(Math.max(0, one.r * one.r - a * a));
  const foot = add(one.c, mul(along, a));
  const side = perp(along);
  return [add(foot, mul(side, half)), add(foot, mul(side, -half))];
}

//! Where a point touches an element - the foot of the perpendicular on a line,
//! the crossing of the centre line on a circle.
function touchOn(el, at) {
  if (el.type === "line") {
    const along = norm(sub(el.b, el.a));
    if (!along) return null;
    return add(el.a, mul(along, dot(sub(at, el.a), along)));
  }
  const away = norm(sub(at, el.c));
  return away ? add(el.c, mul(away, el.r)) : null;
}

//! The corner two elements make: whichever of their ends are nearest each
//! other. Not their crossing - two lines that stop short of each other still
//! have a corner, and it is the one you can see.
function cornerBetween(one, two) {
  const ends = el => {
    const e = sketchEnds(el);
    if (!e) return [];
    return [e.a, e.b].filter(Boolean);
  };
  let best = null, far = Infinity;
  for (const p of ends(one)) for (const q of ends(two)) {
    const d = len(sub(p, q));
    if (d < far) { far = d; best = mid(p, q); }
  }
  if (best) return best;
  return null;
}

//! Move whichever end of an element is nearest \p was to the point \p to, and
//! say which end that was so the arc can be held on to it.
function trimTo(el, was, to) {
  if (el.type === "line") {
    const key = len(sub(el.a, was)) <= len(sub(el.b, was)) ? "a" : "b";
    if (key === "a") el.a = sketchRound(to); else el.b = sketchRound(to);
    return key;
  }
  if (el.type === "arc") {
    const angle = Math.atan2(to[1] - el.c[1], to[0] - el.c[0]);
    const start = arcEnd(el, el.a0), end = arcEnd(el, el.a1);
    const turn = x => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (len(sub(start, was)) <= len(sub(end, was))) {
      // The start moves forward: keep the sweep pointing the same way round.
      let a0 = el.a1 - turn(el.a1 - angle);
      el.a0 = round4(a0);
      return "start";
    }
    let a1 = el.a0 + turn(angle - el.a0);
    el.a1 = round4(a1);
    return "end";
  }
  // A circle has no end to trim; rounding INTO one turns it into an arc, and
  // that is a different tool.
  return null;
}

//! ROUND THE CORNER BETWEEN TWO ELEMENTS. Hands back a new drawing with both
//! trimmed and an arc between them, held on at either end. Throws with a
//! sentence rather than returning nothing, because every refusal here is
//! something the person can act on: pick a different pair, or a smaller radius.
export function sketchFillet(drawing, firstRef, secondRef, radius, id = "f1") {
  const work = JSON.parse(JSON.stringify(drawing || EMPTY_SKETCH));
  const map = byId(work);
  const nameOf = ref => String(ref || "").split(".")[0];
  const one = map.get(nameOf(firstRef)), two = map.get(nameOf(secondRef));
  if (!one || !two) throw new Error("pick two elements of the drawing to round between");
  if (one.id === two.id) throw new Error("a corner takes two different elements");
  const roundable = new Set(["line", "arc", "circle"]);
  for (const el of [one, two])
    if (!roundable.has(el.type))
      throw new Error("a fillet rounds between lines, arcs and circles - "
        + el.id + " is a " + el.type);
  const r = Number(radius);
  if (!(r > 0)) throw new Error("the fillet radius must be greater than zero");

  const corner = cornerBetween(one, two);
  if (!corner) throw new Error("those two have no corner between them");

  // IS THERE A CORNER AT ALL? Two runs that arrive at the same place going the
  // same way make a smooth join, and a fillet between them is an arc of no
  // sweep - which is not a small fillet, it is nothing, and putting it in the
  // drawing would break the chain it was put into. Asked here rather than of
  // the answer, so the sentence names the reason instead of the symptom.
  const wayAt = (el, p) => {
    if (el.type === "line") return norm(sub(el.b, el.a));
    const away = norm(sub(p, el.c));
    return away ? perp(away) : null;
  };
  const w1 = wayAt(one, corner), w2 = wayAt(two, corner);
  if (w1 && w2 && Math.abs(w1[0] * w2[1] - w1[1] * w2[0]) < 1e-9)
    throw new Error(one.id + " and " + two.id + " already meet smoothly - "
      + "there is no corner there to round");

  //! WHICH OF THE FOUR IS THE FILLET, and the old answer was "whichever the
  //! loops reached first".
  //!
  //! An arc of radius r tangent to two lines has FOUR centres, one in each of
  //! the four quadrants the lines cut the plane into, and every one of them is
  //! exactly r/sin(theta/2) from where the lines cross. The rule here was
  //! "nearest the corner", which between two straight lines is a four-way tie
  //! decided by iteration order - so an L whose material lay in +x+y was
  //! rounded with an arc centred at (-20,-20), and both lines came back LONGER
  //! than they were drawn, run on past the corner to reach it. Three of the
  //! four candidates are not fillets of that corner at all; they are fillets
  //! of the three other corners the same two infinite lines make.
  //!
  //! What tells them apart is not distance, it is WHICH SIDE the arc touches
  //! down on. A fillet trims the corner off: both of its tangency points lie
  //! on the part of each element that survives, between the corner and the far
  //! end. A candidate that touches down on the far side of the corner is
  //! asking for the element to be EXTENDED through the corner to meet it, and
  //! that is the answer to a different question.
  //!
  //! This also settles the concave-against-convex case, which has no tie to
  //! break but two real candidates: a line running into an arc can be rounded
  //! on the inside or the outside, and only one of the two leaves both curves
  //! shorter. The other runs the arc the wrong way round and joins with a
  //! reversal rather than a tangent.
  const turnFull = x => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const keeps = (el, at) => {
    if (el.type === "circle") return true;          // no ends, nothing to keep
    if (el.type === "line") {
      const far2 = len(sub(el.a, corner)) >= len(sub(el.b, corner)) ? el.a : el.b;
      const along = norm(sub(far2, corner));
      if (!along) return false;
      const how = dot(sub(at, corner), along);
      return how > -1e-7 && how <= len(sub(far2, corner)) + 1e-7;
    }
    if (el.type === "arc") {
      //! Inside the sweep it was drawn with, and no further. The sweep may run
      //! either way round, so it is measured in the direction it was given.
      const sweep = el.a1 - el.a0;
      if (Math.abs(sweep) < 1e-9) return false;
      const went = turnFull((Math.atan2(at[1] - el.c[1], at[0] - el.c[0]) - el.a0)
                            * Math.sign(sweep));
      return went <= Math.abs(sweep) + 1e-7;
    }
    return false;
  };
  let best = null, far = Infinity;
  for (const a of offsetsOf(one, r)) for (const b of offsetsOf(two, r)) {
    for (const at of offsetCross(a, b)) {
      const t1 = touchOn(one, at), t2 = touchOn(two, at);
      if (!t1 || !t2) continue;
      if (!keeps(one, t1) || !keeps(two, t2)) continue;
      //! Among what is left - and between two lines there is now exactly one -
      //! the nearest centre, which is the one that takes the least off.
      const d = len(sub(at, corner));
      if (d < far) { far = d; best = { at, t1, t2 }; }
    }
  }
  if (!best)
    throw new Error("no arc of " + r + " fits that corner - it is wider than what "
      + one.id + " and " + two.id + " leave room for. Try a smaller radius");

  // The arc: from one tangency point to the other, the short way round, which
  // is the only one that is a fillet rather than the rest of the circle.
  const angleOf = p => Math.atan2(p[1] - best.at[1], p[0] - best.at[0]);
  const turn = x => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const s1 = angleOf(best.t1), s2 = angleOf(best.t2);
  const forward = turn(s2 - s1);
  // A fillet's sweep is a right angle at a right-angled corner and nothing at
  // all where the two already run into each other smoothly. Nothing at all is
  // not a small fillet, it is the absence of a corner, and putting a
  // zero-length arc into the drawing would only break the chain.
  const sweep = Math.min(forward, Math.PI * 2 - forward);
  if (sweep < 0.009)
    throw new Error(one.id + " and " + two.id + " already meet smoothly - "
      + "there is no corner there to round");
  const arc = forward <= Math.PI
    ? { id, type: "arc", c: sketchRound(best.at), r: round1(r),
        a0: round4(s1), a1: round4(s1 + forward) }
    : { id, type: "arc", c: sketchRound(best.at), r: round1(r),
        a0: round4(s2), a1: round4(s2 + turn(s1 - s2)) };

  const k1 = trimTo(one, corner, best.t1);
  const k2 = trimTo(two, corner, best.t2);
  if (!k1 || !k2)
    throw new Error("a circle has no end to trim - round between two arcs or lines");

  // The coincidence that held the old corner is about a corner that is no
  // longer there. It goes, and two new ones take its place.
  const held = new Set([one.id + "." + k1, two.id + "." + k2]);
  work.constraints = (work.constraints || []).filter(c =>
    !(c.type === "coincident" && (c.of || []).every(ref => held.has(ref))));
  work.elements.push(arc);
  const arcStart = len(sub(arcEnd(arc, arc.a0), best.t1))
                 <= len(sub(arcEnd(arc, arc.a0), best.t2)) ? "start" : "end";
  const arcEndKey = arcStart === "start" ? "end" : "start";
  work.constraints.push({ type: "coincident", of: [one.id + "." + k1, arc.id + "." + arcStart] });
  work.constraints.push({ type: "coincident", of: [two.id + "." + k2, arc.id + "." + arcEndKey] });
  //! AND THE TANGENCIES, WHICH ARE THE WHOLE POINT OF A FILLET.
  //!
  //! Two coincidences say the three curves MEET. They say nothing about how,
  //! and a corner that meets is still a corner: move either line afterwards
  //! and the coincidences drag the arc's ends along while the arc keeps the
  //! centre and radius it was born with, so the join goes from smooth to a
  //! kink and the drawing no longer says anything is wrong.
  //!
  //! A fillet is tangent by construction and has to stay tangent under the
  //! solver, which means the drawing has to CARRY the tangency - the same two
  //! relations a person would add by hand, written down where they can be seen
  //! in the relations list, removed if they are not wanted, and used by every
  //! later solve.
  work.constraints.push({ type: "tangent", of: [one.id, arc.id] });
  work.constraints.push({ type: "tangent", of: [two.id, arc.id] });
  return { drawing: work, arc: arc.id, radius: r };
}

//! One chain's elements with their ends welded shut. Two elements that a
//! chain says meet are, in a drawing, a hundredth of a millimetre apart; a
//! wire will not close over that. So the meeting point is taken as the middle
//! of the two ends and both sides are given that exact point, and whoever
//! builds the edges builds them through the points given here rather than
//! through the element's own arithmetic.
//!
//! \p chain is a run out of sketchLoops(). Elements it names in reverse are
//! reported the way the chain walks them, not the way they were drawn.
export function sketchChainEnds(drawing, chain, closed = false) {
  const map = byId(drawing);
  const run = [];
  for (const step of chain || []) {
    const el = map.get(step.id);
    const ends = el && sketchEnds(el);
    if (!ends) continue;
    run.push({ el, reversed: !!step.reversed, closed: ends.closed,
               a: step.reversed ? ends.b : ends.a,
               b: step.reversed ? ends.a : ends.b });
  }
  const middle = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  for (let i = 0; i + 1 < run.length; i++) {
    if (!run[i].b || !run[i + 1].a) continue;
    const joint = middle(run[i].b, run[i + 1].a);
    run[i].b = joint;
    run[i + 1].a = joint;
  }
  if (closed && run.length > 1) {
    const last = run[run.length - 1];
    if (last.b && run[0].a) {
      const joint = middle(last.b, run[0].a);
      last.b = joint;
      run[0].a = joint;
    }
  }
  return run;
}

//! Where an arc is at an angle. Exported because the kernel builds its arcs
//! through three points on them rather than from a centre and two angles.
export function sketchArcPoint(el, angle) { return arcEnd(el, angle); }

//! A whole loop as one 2D polygon, walked the way the chain walks it. What
//! decides whether one loop is inside another - and so whether it is a hole.
export function sketchLoopOutline(drawing, chain, quality = 48) {
  const map = byId(drawing);
  const out = [];
  for (const step of chain || []) {
    const el = map.get(step.id);
    if (!el) continue;
    const line = sketchOutline(el, quality);
    for (const p of step.reversed ? line.slice().reverse() : line) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) out.push(p);
    }
  }
  return out;
}

//! Is this point inside that polygon? A ray cast east, counting crossings -
//! enough for loops that do not cross themselves, which is what a sketch draws.
export function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
        p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

//! Which loops are holes in which. A loop with an odd number of loops around it
//! is a hole in the innermost of them; a loop with an even number is an outline
//! in its own right. So a plate with two bolt holes is one face with two holes,
//! and an island drawn inside a hole is solid again - which is how every CAD
//! sketcher reads a drawing, and it falls straight out of counting.
export function sketchNesting(drawing, loops, quality = 48) {
  const rings = loops.map(chain => sketchLoopOutline(drawing, chain, quality));
  const inside = (a, b) => a !== b && rings[a].length && rings[b].length
    && pointInPolygon(rings[a][0], rings[b]);
  return loops.map((chain, i) => {
    const around = loops.map((_, j) => j).filter(j => inside(i, j));
    // The innermost thing around it is the one it is a hole in.
    const parent = around.length
      ? around.reduce((best, j) => (inside(j, best) ? j : best), around[0]) : -1;
    return { chain, ring: rings[i], depth: around.length,
             hole: around.length % 2 === 1, parent };
  });
}

/* --------------------------------------------------------------- the solver

   Not a degree-of-freedom solver: a relaxation. Every relation knows how to
   move the handles it governs the shortest way to satisfy itself, and they are
   run in turn until nothing moves. That converges on the sketches people draw,
   fights itself when a sketch is over-constrained, and says how far off it
   finished rather than pretending.                                          */

//! \p pinned names handles that must not move - the one under the cursor while
//! it is being dragged. Everything held to a pinned handle follows it all the
//! way rather than meeting it in the middle, which is the difference between
//! dragging a corner and pulling a drawing apart.
export function solveSketch(drawing, passes = 24, pinned = []) {
  const work = JSON.parse(JSON.stringify(drawing || EMPTY_SKETCH));
  const relations = work.constraints || [];
  if (!relations.length) return { drawing: work, passes: 0, residual: 0 };

  const held = new Set(pinned || []);
  const index = byId(work);
  const handle = reference => {
    const [id, key] = String(reference || "").split(".");
    const el = index.get(id);
    if (!el) return null;
    const found = sketchHandles(el).find(([k]) => k === key);
    return found ? { el, key, p: found[1], ref: reference, held: held.has(reference) } : null;
  };
  //! AN ARC THAT IS SOMEBODY'S FILLET HAS A RADIUS, and dragging the line it
  //! blends must not change it.
  //!
  //! An arc's endpoint is an angle AND a radius, so moving that handle turns
  //! and resizes the arc - which is right for an arc somebody drew and wrong
  //! for one that was put there to round a corner at a stated size. Measured:
  //! an L filleted at 20, one line then dragged and the drawing re-solved, and
  //! the fillet came back at r141 - a legitimate answer to the relations as
  //! written, since nothing in them said 20, and not the one anybody wanted.
  //!
  //! What says 20 is the tangency. An arc named in a tangent relation is an
  //! arc that exists to meet something smoothly, so its endpoints TURN to
  //! where they are wanted rather than stretching to reach, and the tangency
  //! is then satisfied by moving the centre - which is what a fillet does when
  //! the corner it sits in opens or closes.
  const rigid = new Set();
  for (const relation of relations) {
    if (relation.type !== "tangent") continue;
    for (const ref of (relation.of || [])) {
      const el = index.get(String(ref || "").split(".")[0]);
      if (el && el.type === "arc") rigid.add(el.id);
    }
  }
  const moveTo = (h, p) => {
    if (h.held) return;
    if (h.el.type === "arc" && h.key !== "c" && rigid.has(h.el.id)) {
      const away = sub(p, h.el.c);
      const reach = len(away);
      if (reach < 1e-9) return;
      sketchMoveHandle(h.el, h.key, add(h.el.c, mul(away, h.el.r / reach)));
      return;
    }
    sketchMoveHandle(h.el, h.key, p);
  };

  let residual = 0, ran = 0;
  for (let pass = 0; pass < Math.max(1, passes); pass++) {
    residual = 0;
    ran = pass + 1;
    for (const relation of relations) {
      residual += applyRelation(relation, index, handle, moveTo, held);
    }
    if (residual < 1e-7) break;
  }
  return { drawing: work, passes: ran, residual: Math.sqrt(Math.max(0, residual)) };
}

//! Everything held to this handle by coincidence, however many hops away. A
//! polyline's corner is two handles; a fan of five lines meeting at a point is
//! five, and dragging any of them has to take the rest.
export function coincidentGroup(drawing, ref) {
  const links = new Map();
  for (const c of (drawing.constraints || [])) {
    if (c.type !== "coincident") continue;
    const [a, b] = c.of || [];
    if (!a || !b) continue;
    if (!links.has(a)) links.set(a, new Set());
    if (!links.has(b)) links.set(b, new Set());
    links.get(a).add(b);
    links.get(b).add(a);
  }
  const seen = new Set([ref]);
  const queue = [ref];
  while (queue.length) {
    for (const next of links.get(queue.pop()) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  seen.delete(ref);
  return [...seen];
}

function applyRelation(relation, index, handle, moveTo, held = new Set()) {
  // A relation names what it governs in one place, however many things that
  // is: {"type":"parallel","of":["e1","e2"]}. SKETCH_RELATIONS says how many
  // each takes, so the panel that offers them and the solver that runs them
  // read one description.
  const of = Array.isArray(relation.of) ? relation.of : [relation.of];
  const line = id => {
    const el = index.get(id);
    return el && el.type === "line" ? el : null;
  };
  switch (relation.type) {
    case "coincident": {
      const a = handle(of[0]), b = handle(of[1]);
      if (!a || !b) return 0;
      const gap = sub(b.p, a.p);
      // Meeting in the middle is only fair when both are free. One of them held
      // is the whole point of a drag: the other goes to it.
      const target = a.held ? a.p : b.held ? b.p : mid(a.p, b.p);
      moveTo(a, target);
      moveTo(b, target);
      return dot(gap, gap);
    }
    case "horizontal":
    case "vertical": {
      const el = line(of[0]);
      if (!el) return 0;
      const axis = relation.type === "horizontal" ? 1 : 0;
      // An end being dragged is the one that says where the line lies; only
      // with both free does it level about its own middle.
      const holdA = held.has(of[0] + ".a"), holdB = held.has(of[0] + ".b");
      const centre = holdA && !holdB ? el.a[axis]
                   : holdB && !holdA ? el.b[axis]
                   : (el.a[axis] + el.b[axis]) / 2;
      const off = el.a[axis] - el.b[axis];
      el.a = el.a.slice(); el.b = el.b.slice();
      el.a[axis] = centre; el.b[axis] = centre;
      return off * off;
    }
    case "parallel":
    case "perpendicular": {
      const first = line(of[0]), second = line(of[1]);
      if (!first || !second) return 0;
      const want = norm(sub(first.b, first.a));
      if (!want) return 0;
      const aim = relation.type === "parallel" ? want : perp(want);
      const have = sub(second.b, second.a);
      const half = len(have) / 2;
      const centre = mid(second.a, second.b);
      // Turn the second line about its own middle rather than dragging an end,
      // so a relation never walks the sketch across the plane.
      const sign = dot(have, aim) < 0 ? -1 : 1;
      const wanted = mul(aim, half * sign);
      const before = sub(have, mul(wanted, 2));
      second.a = sketchRound(sub(centre, wanted));
      second.b = sketchRound(add(centre, wanted));
      return dot(before, before);
    }
    //! AN ARC IS ROUND. This read `type === "circle"` and nothing else, so a
    //! tangency naming an ARC found no round element, returned zero and did
    //! nothing whatever - which is why a filleted corner came apart the moment
    //! anything near it moved, and why writing the tangencies a fillet needs
    //! had to wait for this.
    case "tangent": {
      const a = index.get(of[0]), b = index.get(of[1]);
      if (!a || !b) return 0;
      const isRound = el => el && (el.type === "circle" || el.type === "arc");
      const round = isRound(a) ? a : isRound(b) ? b : null;
      const other = round === a ? b : a;
      if (!round || !(round.r > 0)) return 0;
      if (other.type === "line") {
        const along = norm(sub(other.b, other.a));
        if (!along) return 0;
        const away = sub(round.c, other.a);
        const across = dot(away, perp(along));
        const off = Math.abs(across) - round.r;
        //! Slid along the line's normal, and along the SIDE IT IS ALREADY ON.
        //! Sign(across) is what keeps a fillet sitting in the corner it was put
        //! in rather than flipping through the line to the other one.
        round.c = sketchRound(sub(round.c, mul(perp(along), Math.sign(across) * off)));
        return off * off;
      }
      if (isRound(other)) {
        const between = sub(other.c, round.c);
        const distance = len(between);
        if (distance < 1e-9) return 0;
        //! INSIDE OR OUTSIDE, WHICHEVER IT ALREADY IS, and this is the concave
        //! against convex case. Two circles are tangent when their centres are
        //! r1+r2 apart - each outside the other - OR |r1-r2| apart, one held
        //! within the other. Both are a smooth join; they are different joins.
        //! This took r1+r2 always, so a fillet blending INTO a curve - the
        //! small arc riding inside the big one, which is what rounding a
        //! concave corner is - was pushed out of the corner until it sat
        //! against the outside of the curve it was meant to blend into, tangent
        //! in the arithmetic and reversed in the drawing.
        //!
        //! So the sense is read off the drawing rather than assumed: whichever
        //! of the two the centres are nearer to now is the one they are held
        //! to. A fillet built tangent stays the tangency it was built as.
        const apart = round.r + other.r, within = Math.abs(round.r - other.r);
        const want = Math.abs(distance - within) < Math.abs(distance - apart)
                   ? within : apart;
        const off = distance - want;
        //! An arc that is somebody's fillet takes the whole correction; only
        //! two free circles meet in the middle. Moving a fillet's neighbour is
        //! how a drag of one line used to drift the curve at the far end of it.
        const share = (round.type === "arc") !== (other.type === "arc") ? 1 : 0.5;
        round.c = sketchRound(add(round.c, mul(norm(between), off * share)));
        if (share < 1)
          other.c = sketchRound(sub(other.c, mul(norm(between), off * share)));
        return off * off;
      }
      return 0;
    }
    //! The point goes to the crossing. Two curves may cross more than once - a
    //! line through a circle crosses it twice - so it goes to the crossing
    //! NEAREST where it already is, which is the one you pointed at when you
    //! asked for it and the one it stays on as the curves move.
    case "intersect": {
      const point = handle(of[0]);
      const a = index.get(of[1]), b = index.get(of[2]);
      if (!point || !a || !b) return 0;
      const at = crossings(a, b);
      if (!at.length) return 0;
      let best = at[0], reach = Infinity;
      for (const p of at) {
        const away = sub(p, point.p);
        const d = dot(away, away);
        if (d < reach) { reach = d; best = p; }
      }
      moveTo(point, sketchRound(best));
      return reach;
    }
    default: return 0;
  }
}

//! Where two elements of a drawing cross, by id. The viewport asks so it can
//! put a point at one before handing it to the solver; the solver asks the
//! same question of the same code, which is why the point it draws and the
//! point it settles on are the same point.
export function sketchCrossings(drawing, a, b) {
  const index = byId(drawing);
  const one = index.get(a), two = index.get(b);
  return one && two ? crossings(one, two).map(sketchRound) : [];
}

//! Every place two elements cross, found on the polylines they are drawn as.
//! Sampled rather than solved - a circle is 128 chords here - which puts a
//! crossing within a fraction of a millimetre at any scale a sketch is drawn
//! at, and works the same for an arc, a spline and an oblong as for a line.
function crossings(a, b) {
  const one = sketchOutline(a, 128), two = sketchOutline(b, 128);
  const out = [];
  for (let i = 0; i + 1 < one.length; i++)
    for (let j = 0; j + 1 < two.length; j++) {
      const hit = segmentsMeet(one[i], one[i + 1], two[j], two[j + 1]);
      if (hit) out.push(hit);
    }
  return out;
}

//! Where two segments cross, or null. Parallel is null, and so is a crossing
//! that would be off the end of either.
function segmentsMeet(p1, p2, p3, p4) {
  const r = sub(p2, p1), s = sub(p4, p3);
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denominator) < 1e-12) return null;
  const away = sub(p3, p1);
  const t = (away[0] * s[1] - away[1] * s[0]) / denominator;
  const u = (away[0] * r[1] - away[1] * r[0]) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return add(p1, mul(r, t));
}

/* ------------------------------------------------------------------ layers

   A drawing is a drawing, and drawings have layers. They arrive with a DXF and
   they are worth having on one drawn here: the outline on one, the setting-out
   on another, the survey nobody wants in the geometry on a third.

   Three facts about a layer and no more. Its name, whether it is SHOWN, and
   whether it is LOCKED. Shown is not a decoration: an element on a layer that
   is off is not drawn AND not built, which is what makes turning a layer off
   the way to get a profile out of a plan full of furniture. Locked is the
   other way round - it builds and it draws, it just cannot be picked up, which
   is what you want of a survey you are drawing over.                         */

//! What a drawing with nothing said about layers is on. DXF's own name for it,
//! because half of these drawings come from DXF and the other half will go
//! back out as one.
export const SKETCH_LAYER = "0";

const layerName = el => (el && typeof el.layer === "string" && el.layer) || SKETCH_LAYER;

//! Every layer in a drawing: the ones it declares, then any an element names
//! that nobody declared, with how many things are on each. A drawing that has
//! never heard of layers has one, and everything is on it.
export function sketchLayers(drawing) {
  const out = [];
  const at = new Map();
  const add = one => {
    const name = String(one.name);
    if (at.has(name)) return at.get(name);
    const row = { name, on: one.on !== false, locked: !!one.locked, count: 0 };
    at.set(name, row);
    out.push(row);
    return row;
  };
  for (const one of (Array.isArray(drawing.layers) ? drawing.layers : []))
    if (one && typeof one.name === "string" && one.name) add(one);
  for (const el of (drawing.elements || [])) add({ name: layerName(el) }).count++;
  if (!out.length) add({ name: SKETCH_LAYER });
  return out;
}

//! The layer new elements go on. Whatever the drawing says, as long as it is a
//! layer that exists and is not locked; otherwise the first one that will take
//! them.
export function currentLayer(drawing) {
  const layers = sketchLayers(drawing);
  const said = layers.find(l => l.name === drawing.current);
  if (said && !said.locked && said.on) return said.name;
  const free = layers.find(l => !l.locked && l.on);
  return (free || layers[0]).name;
}

//! Is this element on a layer that is showing? Everything else in the program
//! asks this rather than reading el.layer, so a drawing with no layers at all
//! answers yes to all of it.
export function elementShown(drawing, el) {
  const layers = sketchLayers(drawing);
  const on = layers.find(l => l.name === layerName(el));
  return !on || on.on;
}

export function elementLocked(drawing, el) {
  const layers = sketchLayers(drawing);
  const on = layers.find(l => l.name === layerName(el));
  return !!on && on.locked;
}

//! The drawing as it is showing: the elements on layers that are on, and the
//! relations that still have both ends. What gets BUILT, so that turning a
//! layer off takes its geometry out of the solid as well as off the screen.
export function shownDrawing(drawing) {
  const layers = sketchLayers(drawing);
  const hidden = new Set(layers.filter(l => !l.on).map(l => l.name));
  if (!hidden.size) return drawing;
  const elements = (drawing.elements || []).filter(el => !hidden.has(layerName(el)));
  const kept = new Set(elements.map(el => el.id));
  const constraints = (drawing.constraints || [])
    .filter(c => c.of.every(name => kept.has(String(name).split(".")[0])));
  return { ...drawing, elements, constraints };
}

/* ---------------------------------------------------------- picking in bulk

   Two gestures every drawing board has, and they are the same question asked
   about a rectangle: what is inside it, and what does it touch. Dragging a
   window left to right takes only what is wholly inside - that is a WINDOW;
   dragging it right to left takes anything it crosses - a CROSSING. Every CAD
   package since AutoCAD has drawn that distinction and drawn it the same way
   round, so this one does too.                                              */

const insideBox = (p, box) =>
  p[0] >= box.x0 && p[0] <= box.x1 && p[1] >= box.y0 && p[1] <= box.y1;

//! Do two segments cross? Orientation of each end about the other segment; a
//! pair that straddle each other cross. Touching at an end counts, which is
//! what a >= 0 does here - a line that just reaches the window is in it.
function segmentsCross(a, b, c, d) {
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const s1 = side(a, b, c), s2 = side(a, b, d), s3 = side(c, d, a), s4 = side(c, d, b);
  return ((s1 >= 0) !== (s2 >= 0)) && ((s3 >= 0) !== (s4 >= 0));
}

function segmentMeetsBox(a, b, box) {
  if (insideBox(a, box) || insideBox(b, box)) return true;
  const corner = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];
  for (let i = 0; i < 4; i++)
    if (segmentsCross(a, b, corner[i], corner[(i + 1) % 4])) return true;
  return false;
}

//! How far \p p is from a segment - to the segment, not to its ends.
function awayFromSegment(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const square = vx * vx + vy * vy;
  const t = square < 1e-18 ? 0
    : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / square));
  return Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
}

//! How far a point is from an element - measured to the element, not to the
//! points it happens to have been sampled at. A line's outline is its two ends
//! and nothing in between, so a cursor halfway along a two-metre line used to
//! be a metre from the nearest sample and therefore nowhere near the line.
export function sketchDistanceTo(el, p, quality = 48) {
  const line = sketchOutline(el, quality);
  if (!line.length) return Infinity;
  if (line.length === 1) return Math.hypot(line[0][0] - p[0], line[0][1] - p[1]);
  let away = Infinity;
  for (let i = 0; i + 1 < line.length; i++)
    away = Math.min(away, awayFromSegment(p, line[i], line[i + 1]));
  return away;
}

//! The box two corners make, whichever way round they were given.
export const sketchBox = (from, to) => ({
  x0: Math.min(from[0], to[0]), x1: Math.max(from[0], to[0]),
  y0: Math.min(from[1], to[1]), y1: Math.max(from[1], to[1]),
});

//! What a window takes. Nothing on a layer that is off or locked is ever in
//! it, for the same reason nothing on one is ever under the cursor.
export function sketchInBox(drawing, box, { crossing = false, quality = 32 } = {}) {
  const out = [];
  for (const el of (drawing.elements || [])) {
    if (!elementShown(drawing, el) || elementLocked(drawing, el)) continue;
    const line = sketchOutline(el, quality);
    if (!line.length) continue;
    if (!crossing) { if (line.every(p => insideBox(p, box))) out.push(el.id); continue; }
    let hit = line.some(p => insideBox(p, box));
    for (let i = 0; i + 1 < line.length && !hit; i++)
      hit = segmentMeetsBox(line[i], line[i + 1], box);
    if (hit) out.push(el.id);
  }
  return out;
}

//! Every element on one layer, by id. What "select everything on this layer"
//! means - and it counts the ones that are on it by saying nothing, because
//! that is what being on the drawing's own layer is.
export const sketchOnLayer = (drawing, name) =>
  (drawing.elements || []).filter(el => layerName(el) === name).map(el => el.id);

//! An element moved bodily, every point of it by the same amount. An arc and a
//! circle move by their centre, which leaves the radius and the sweep exactly
//! as drawn - moving each end of an arc separately would turn it into a
//! different arc, and a drag of six elements must not redraw any of them.
export function sketchMoveElement(el, by) {
  const to = p => sketchRound([p[0] + by[0], p[1] + by[1]]);
  switch (el.type) {
    case "point":   el.p = to(el.p); return;
    case "line":    el.a = to(el.a); el.b = to(el.b); return;
    case "circle":
    case "arc":
    case "ellipse": el.c = to(el.c); return;
    case "oblong":
    case "rect":    el.a = to(el.a); el.b = to(el.b); return;
    case "spline":  el.pts = (el.pts || []).map(to); return;
    case "bspline": el.ctrl = (el.ctrl || []).map(to); return;
  }
}

/* ------------------------------------------------------------ construction */

/* Construction geometry is the second half of a sketcher, and the half that
   makes it a drawing board rather than a profile editor. A centreline two arcs
   are tangent to, a diagonal that holds a rectangle square, a circle three
   holes sit on: every one of them is the REASON the real geometry is where it
   is, and none of them is part of what gets built. CATIA draws them dashed and
   builds only the rest; so does this.

   It is one flag on the element - construction: true - because that is all it
   is. It is drawn, it is picked, it is constrained and it is solved exactly
   like anything else. The only thing it never does is come out of the sketch. */

//! Is this element scaffolding rather than output?
export const isConstruction = el => !!(el && el.construction);

//! The drawing as it will be BUILT: what is showing, less the construction
//! geometry, less the relations that only held construction geometry. Relations
//! are dropped rather than kept because a relation naming an element that is
//! not there is not a relation - and by this point the solver has already run,
//! so everything they had to say has been said.
export function builtDrawing(drawing) {
  const shown = shownDrawing(drawing);
  const elements = (shown.elements || []).filter(el => !isConstruction(el));
  if (elements.length === (shown.elements || []).length) return shown;
  const kept = new Set(elements.map(el => el.id));
  const constraints = (shown.constraints || [])
    .filter(c => c.of.every(name => kept.has(String(name).split(".")[0])));
  return { ...shown, elements, constraints };
}

/* ------------------------------------------------------------- housekeeping */

//! Reads a drawing out of whatever was stored, dropping anything malformed
//! rather than failing the feature. A sketch half-typed into the model file is
//! still most of a sketch.
export function readSketch(source) {
  const raw = typeof source === "string"
    ? (() => { try { return JSON.parse(source); } catch (e) { return null; } })()
    : source;
  if (!raw || typeof raw !== "object") return { elements: [], constraints: [] };
  const seen = new Set();
  const elements = (Array.isArray(raw.elements) ? raw.elements : []).filter(el => {
    if (!el || !SKETCH_TYPES.includes(el.type) || typeof el.id !== "string") return false;
    if (seen.has(el.id)) return false;
    seen.add(el.id);
    return sketchHandles(el).every(([, p]) => Array.isArray(p) && p.every(Number.isFinite));
  }).map(el => el.construction ? { ...el, construction: true } : el);
  const known = new Set(SKETCH_RELATIONS.map(r => r.key));
  const constraints = (Array.isArray(raw.constraints) ? raw.constraints : [])
    .filter(c => {
      if (!c || !known.has(c.type)) return false;
      const takes = SKETCH_RELATIONS.find(r => r.key === c.type).takes;
      return Array.isArray(c.of) && c.of.length === takes
        && c.of.every(name => typeof name === "string" && name);
    })
    .map(c => ({ type: c.type, of: c.of.slice() }));

  // Layers travel with the drawing. Only the three facts about one are kept,
  // and a layer nobody declared but something is drawn on is not written down
  // here - sketchLayers finds those, so an element carrying a layer name is
  // never a layer that does not exist.
  const layers = (Array.isArray(raw.layers) ? raw.layers : [])
    .filter(one => one && typeof one.name === "string" && one.name)
    .map(one => ({ name: one.name, on: one.on !== false, locked: !!one.locked }));
  const out = { elements, constraints };
  if (layers.length) out.layers = layers;
  if (typeof raw.current === "string" && raw.current) out.current = raw.current;
  return out;
}

//! The next free id, so two elements never collide however the drawing was
//! edited - by clicking, or by typing into the model file.
export function nextSketchId(drawing, prefix = "e") {
  const used = new Set((drawing.elements || []).map(el => el.id));
  for (let i = 1; ; i++) if (!used.has(prefix + i)) return prefix + i;
}

//! One line describing a drawing, for the tree and the node.
export function sketchSummary(drawing) {
  const n = (drawing.elements || []).length;
  const c = (drawing.constraints || []).length;
  if (!n) return "empty";
  // The loops are counted over what is SHOWING, because that is what will be
  // built - a summary that promises three loops while one of them is on a
  // layer that is off is a summary of a different drawing.
  const shown = shownDrawing(drawing);
  const built = builtDrawing(drawing);
  const { loops } = sketchLoops(built);
  const hidden = n - shown.elements.length;
  const drawn = shown.elements.length - built.elements.length;
  return n + (n === 1 ? " element" : " elements")
       + (hidden ? " · " + hidden + " hidden" : "")
       + (drawn ? " · " + drawn + " construction" : "")
       + (c ? " · " + c + (c === 1 ? " relation" : " relations") : "")
       + (loops.length ? " · " + loops.length + (loops.length === 1 ? " loop" : " loops") : "");
}
