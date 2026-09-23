// Lines and circles from constraints.
//
// OpenCascade has a whole package for this - GccAna, GccEnt, Geom2dGcc - and
// it is the part of CATIA every drawing office lives in: not "a circle at
// 40,60 of radius 12" but "the circle of radius 12 that touches that arc and
// that line, on the outside of both". A drawing is a web of relations and the
// numbers fall out of it; typing coordinates is what you do when the relation
// has already been worked out on paper.
//
// THE BUILD SHIPPED HERE DOES NOT CARRY THAT PACKAGE. GccAna, GccEnt and
// Geom2dGcc are not compiled into the WebAssembly kernel this page loads, and
// neither is gp_Parab or gp_Hypr - it was cut down to fit in a web page. So
// the constraints are solved HERE, which for lines and circles is exactly what
// GccAna does anyway: the doc calls them "analytic algorithms, where solutions
// are obtained by the resolution of an equation", and the equations are two
// pages of school geometry. The kernel is then handed a centre and a radius,
// which it has always been able to make a circle out of.
//
// That has a second effect worth having: none of this needs a kernel to be
// checked. Every answer here can be measured against the constraints it was
// asked for - the distance from the qSolution's centre to the argument, against
// the sum or difference of the radii - and a test that measures the answer is
// a test that cannot agree with a wrong one.
//
// Everything in here is FLAT: two numbers, in a plane's own u-v. Putting the
// plane back on is the caller's, and is one axis system away.

/* ------------------------------------------------------------- the bestiary

   Three things a constraint can be about, which is all GccAna is about too:
   a point, a straight line, a circle. Each carries an ORIENTATION, because
   the qualifiers below are all about which side of a thing you are on.       */

export const cPoint = at => ({ kind: "point", at: [at[0], at[1]] });

//! A line through a point, running a way. The direction is unitised on the way
//! in so every "distance" below really is one.
export function cLine(at, way) {
  const n = Math.hypot(way[0], way[1]);
  if (!(n > 1e-12)) return null;
  return { kind: "line", at: [at[0], at[1]], way: [way[0] / n, way[1] / n] };
}

export const cCircle = (at, r) =>
  r > 1e-12 ? { kind: "circle", at: [at[0], at[1]], r } : null;

/* --------------------------------------------------------- the qualifiers

   Straight from the documentation, and they are the whole reason this is
   worth having: tangency to two circles has eight qAnswers and nobody wants
   eight. Saying "outside that one, inside this one" is how a person picks,
   and it is how they would say it out loud.

     enclosing  - the qSolution encloses the argument
     enclosed   - the qSolution is enclosed by the argument
     outside    - the two are external to one another
     unqualified- any of the above

   For a line there is no inside, so the doc extends the words the obvious way:
   the INTERIOR of a line is the qLeft-hand side along its direction. A qSolution
   that sits on the qLeft is "enclosing" it, one on the right is "outside" it.  */

export const QUALIFIERS = [
  { key: "unqualified", label: "Either side", hint: "every answer, however it sits" },
  { key: "outside",     label: "Outside it",
    hint: "the answer and the argument are external to one another" },
  { key: "enclosed",    label: "Inside it",  hint: "the answer sits within the argument" },
  { key: "enclosing",   label: "Around it",  hint: "the answer wraps around the argument" },
];

export const qualifierNamed = key =>
  QUALIFIERS.find(q => q.key === key) || QUALIFIERS[0];

/* ------------------------------------------------------------------ maths */

const qSub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const qAdd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const qMul = (a, k) => [a[0] * k, a[1] * k];
const qDot = (a, b) => a[0] * b[0] + a[1] * b[1];
const qLen = a => Math.hypot(a[0], a[1]);
const qCross = (a, b) => a[0] * b[1] - a[1] * b[0];
//! The qLeft of a direction, which is the interior side of a line.
const qLeft = a => [-a[1], a[0]];
const qNear = (a, b, tol = 1e-7) => Math.abs(a - b) <= tol;

export const TOL = 1e-7;

//! How far a point is from an element, SIGNED where a sign means something:
//! negative inside a circle, negative on the right of a line. The one function
//! every constraint below is written in terms of.
export function signedFrom(element, at) {
  if (!element) return NaN;
  if (element.kind === "point") return qLen(qSub(at, element.at));
  if (element.kind === "line") return qDot(qSub(at, element.at), qLeft(element.way));
  return qLen(qSub(at, element.at)) - element.r;
}

//! The nearest place on an element to a point - what a tangency touches.
export function nearestOn(element, at) {
  if (!element) return null;
  if (element.kind === "point") return element.at.slice();
  if (element.kind === "line")
    return qAdd(element.at, qMul(element.way, qDot(qSub(at, element.at), element.way)));
  const out = qSub(at, element.at);
  const n = qLen(out);
  return n > 1e-12 ? qAdd(element.at, qMul(out, element.r / n))
                   : [element.at[0] + element.r, element.at[1]];
}

/* ----------------------------------------------------- where a centre may be

   THE TRICK THE WHOLE FILE TURNS ON. A circle of radius r tangent to a thing
   has its centre on a LOCUS that is itself a line or a circle: r away from a
   point is a circle; r away from a line is one of two parallel lines; r away
   from a circle is one of two concentric circles. So "tangent to two things
   with a given radius" is "where do two lines-or-circles meet", which is
   school geometry, and every pair of loci carries with it how the answer sits
   against each argument - which is the qualifier, worked out rather than
   guessed at.                                                               */

//! Every locus a centre could be on, each tagged with how a qSolution found
//! there stands in relation to the argument.
export function centreLoci(element, r) {
  if (!element || !(r > 1e-12)) return [];
  if (element.kind === "point")
    // A circle through a point: the point is ON it, which is neither inside
    // nor outside, so it qAnswers to any qualifier that is asked for.
    return [{ locus: cCircle(element.at, r), how: "unqualified" }];
  if (element.kind === "line") {
    const n = qLeft(element.way);
    return [{ locus: cLine(qAdd(element.at, qMul(n, r)), element.way), how: "enclosing" },
            { locus: cLine(qSub(element.at, qMul(n, r)), element.way), how: "outside" }];
  }
  const out = [{ locus: cCircle(element.at, element.r + r), how: "outside" }];
  //! Touching from the inside. Which of the two is inside the other depends on
  //! which is bigger, and the difference of the radii is the qSame number
  //! either way - so one locus, two readings of it.
  const gap = Math.abs(element.r - r);
  if (gap > 1e-12)
    out.push({ locus: cCircle(element.at, gap),
               how: r > element.r ? "enclosing" : "enclosed" });
  else
    // Equal radii: the answer is the argument itself, which is not a qSolution
    // anybody wanted. Left out on purpose.
    ;
  return out;
}

export const allows = (asked, how) =>
  !asked || asked === "unqualified" || how === "unqualified" || asked === how;

/* ------------------------------------------------------------ intersections */

//! Two straight lines. Null when they never meet or are the qSame line, because
//! "everywhere" is not a list of qAnswers.
export function meetLines(a, b) {
  const d = qCross(a.way, b.way);
  if (Math.abs(d) < 1e-12) return [];
  const w = qSub(b.at, a.at);
  return [qAdd(a.at, qMul(a.way, qCross(w, b.way) / d))];
}

//! A line and a circle: none, one or two.
export function meetLineCircle(line, circle) {
  const w = qSub(circle.at, line.at);
  const along = qDot(w, line.way);
  const foot = qAdd(line.at, qMul(line.way, along));
  const off = qLen(qSub(circle.at, foot));
  if (off > circle.r + TOL) return [];
  const half = Math.sqrt(Math.max(0, circle.r * circle.r - off * off));
  if (half < TOL) return [foot];
  return [qAdd(foot, qMul(line.way, half)), qSub(foot, qMul(line.way, half))];
}

//! Two circles, the standard way: along the line of centres to the radical
//! point, then off it by the half-chord.
export function meetCircles(a, b) {
  const w = qSub(b.at, a.at);
  const d = qLen(w);
  if (d < 1e-12) return [];
  if (d > a.r + b.r + TOL || d < Math.abs(a.r - b.r) - TOL) return [];
  const along = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const half2 = a.r * a.r - along * along;
  const unit = qMul(w, 1 / d);
  const foot = qAdd(a.at, qMul(unit, along));
  if (half2 <= TOL * TOL) return [foot];
  const half = Math.sqrt(half2);
  const side = qLeft(unit);
  return [qAdd(foot, qMul(side, half)), qSub(foot, qMul(side, half))];
}

export function meet(a, b) {
  if (!a || !b) return [];
  if (a.kind === "line" && b.kind === "line") return meetLines(a, b);
  if (a.kind === "line") return meetLineCircle(a, b);
  if (b.kind === "line") return meetLineCircle(b, a);
  return meetCircles(a, b);
}

/* ------------------------------------------------- tangency, after the fact

   Every answer is checked against what was asked for rather than trusted
   because of how it was built. The loci above say what a qSolution SHOULD be;
   this says what it IS, read off the answer - so a bug in the construction
   shows up as a qSolution that fails its own qualifier rather than as a wrong
   circle drawn confidently.                                                  */

//! How a circle stands against an element it touches, or null when it does not
//! touch it at all.
export function standing(element, at, r, tol = 1e-6) {
  if (!element) return null;
  if (element.kind === "point")
    return qNear(qLen(qSub(at, element.at)), r, tol * Math.max(1, r)) ? "unqualified" : null;
  if (element.kind === "line") {
    const off = signedFrom(element, at);
    if (!qNear(Math.abs(off), r, tol * Math.max(1, r))) return null;
    return off > 0 ? "enclosing" : "outside";
  }
  const d = qLen(qSub(at, element.at));
  const scale = tol * Math.max(1, r, element.r);
  if (qNear(d, element.r + r, scale)) return "outside";
  if (qNear(d, Math.abs(element.r - r), scale))
    return r > element.r ? "enclosing" : "enclosed";
  return null;
}

//! One answer, dressed: where it is, how big, where it touches what, and how
//! it stands against each - which is what a panel shows so a person can pick
//! between eight of them without counting on their fingers.
function qSolution(at, r, elements) {
  return {
    at: [at[0], at[1]], r,
    touches: elements.map(one => nearestOn(one, at)),
    how: elements.map(one => standing(one, at, r)),
  };
}

const qSame = (a, b, scale) =>
  Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) < 1e-6 * scale
  && Math.abs(a.r - b.r) < 1e-6 * scale;

//! A LIST, AND WHETHER IT IS THE WHOLE STORY. An empty list usually means
//! "there is no such circle", and once in a while means "there are infinitely
//! many" - which is a different thing to tell somebody, so the list says
//! which. A plain list everywhere else, because that is what it is.
function qAnswers(list, family) {
  if (family) list.family = true;
  return list;
}

function qDistinct(list, scale = 1) {
  const out = [];
  for (const one of list)
    if (Number.isFinite(one.r) && one.r > 1e-9 && !out.some(had => qSame(had, one, scale)))
      out.push(one);
  return out;
}

//! The size of the problem, for tolerances that mean the qSame thing on a
//! bracket and on a masterplan.
function qScaleOf(elements) {
  let s = 1;
  for (const one of elements) {
    if (!one) continue;
    s = Math.max(s, Math.abs(one.at[0]), Math.abs(one.at[1]), one.r || 0);
  }
  return s;
}

/* ================================================================= circles */

//! CIRCLE TANGENT TO TWO ELEMENTS, WITH A RADIUS. GccAna_Circ2d2TanRad, and
//! the one the documentation draws eight pictures of.
export function circle2TanRadius(a, b, r, askA = "unqualified", askB = "unqualified") {
  if (!a || !b || !(r > 1e-12)) return [];
  const out = [];
  for (const one of centreLoci(a, r)) {
    if (!allows(askA, one.how)) continue;
    for (const two of centreLoci(b, r)) {
      if (!allows(askB, two.how)) continue;
      for (const at of meet(one.locus, two.locus)) {
        if (!standing(a, at, r) || !standing(b, at, r)) continue;
        if (!allows(askA, standing(a, at, r)) || !allows(askB, standing(b, at, r))) continue;
        out.push(qSolution(at, r, [a, b]));
      }
    }
  }
  return qDistinct(out, qScaleOf([a, b]));
}

//! TANGENT TO ONE ELEMENT, CENTRED ON ANOTHER, WITH A RADIUS.
//! GccAna_Circ2dTanOnRad.
export function circleTanOnRadius(a, on, r, askA = "unqualified") {
  if (!a || !on || !(r > 1e-12)) return [];
  const centre = on.kind === "point" ? null : on;
  const out = [];
  for (const one of centreLoci(a, r)) {
    if (!allows(askA, one.how)) continue;
    const places = centre ? meet(one.locus, centre)
                          : (qNear(signedFrom(one.locus, on.at), 0, 1e-6) ? [on.at] : []);
    for (const at of places) {
      if (!allows(askA, standing(a, at, r))) continue;
      out.push(qSolution(at, r, [a]));
    }
  }
  return qDistinct(out, qScaleOf([a, on]));
}

//! TANGENT TO ONE ELEMENT, CENTRED AT A POINT. The radius is not asked for -
//! it is the distance, which is the whole of the construction.
export function circleTanCentre(a, at) {
  if (!a || !at) return [];
  const r = Math.abs(signedFrom(a, at));
  if (!(r > 1e-12)) return [];
  return [qSolution(at, r, [a])];
}

//! THROUGH THREE POINTS: the circumcircle, and the one everybody wants first.
export function circleThrough3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return [];        // three in a line have no circle
  const sa = a[0] * a[0] + a[1] * a[1], sb = b[0] * b[0] + b[1] * b[1],
        sc = c[0] * c[0] + c[1] * c[1];
  const at = [(sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1])) / d,
              (sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])) / d];
  return [qSolution(at, qLen(qSub(a, at)), [cPoint(a), cPoint(b), cPoint(c)])];
}

//! THROUGH TWO POINTS WITH A RADIUS: two qAnswers, one either side of the
//! chord, and none at all when the radius is too small to reach.
export function circle2PointsRadius(a, b, r) {
  const half = qLen(qSub(b, a)) / 2;
  if (half < 1e-12 || r < half - TOL) return [];
  const mid = qMul(qAdd(a, b), 0.5);
  const off = Math.sqrt(Math.max(0, r * r - half * half));
  const side = qLeft(qMul(qSub(b, a), 1 / (half * 2)));
  const list = off < TOL ? [mid] : [qAdd(mid, qMul(side, off)), qSub(mid, qMul(side, off))];
  return list.map(at => qSolution(at, r, [cPoint(a), cPoint(b)]));
}

/* ------------------------------------------------------- tangent to three

   THE APOLLONIUS PROBLEM, which is the one the documentation's eight-qSolution
   picture is of. The loci trick above wants a radius and here the radius is
   the unknown, so it is solved instead as three equations in three unknowns -
   the centre and the radius - one equation per element:

     a point:  |c - p|            = r
     a line:   (c - a)·qLeft(way)  = ±r
     a circle: |c - o|            = R ± r

   The sign in each is a CHOICE, and the eight solutions are the eight ways of
   choosing. Each choice is one well-behaved system, solved by Newton from a
   sensible start; a choice with no answer simply fails to converge and is
   dropped, which is what "there is no such circle" looks like from in here.  */

//! ONE EQUATION PER ELEMENT, AND THEY ARE ALL LINEAR. The trick is an old
//! one and it is what makes Apollonius exact rather than iterative. Write the
//! tangency to a circle out in full:
//!
//!   (x - xi)^2 + (y - yi)^2 = (Ri + s*r)^2
//!
//! expand it, and collect the squares of the unknowns into one name,
//! K = x^2 + y^2 - r^2. What is qLeft is straight:
//!
//!   K - 2*xi*x - 2*yi*y - 2*s*Ri*r  =  Ri^2 - xi^2 - yi^2
//!
//! A line is already straight and has no K in it at all. So three elements are
//! three linear equations in four unknowns - x, y, r and K - which leaves a
//! line of possibilities, and the definition of K closes it with a quadratic.
//! Two roots, eight sign choices, and the eight circles of the picture in the
//! documentation fall out with no iteration anywhere.
//!
//! A point is a circle of radius nought, so it needs no case of its own.
function tangencyRow(element, sign) {
  if (element.kind === "line") {
    const n = qLeft(element.way);
    return { row: [n[0], n[1], -sign, 0], rhs: qDot(n, element.at) };
  }
  const R = element.kind === "circle" ? element.r : 0;
  return { row: [-2 * element.at[0], -2 * element.at[1], -2 * sign * R, 1],
           rhs: R * R - element.at[0] * element.at[0] - element.at[1] * element.at[1] };
}

//! A row that says "the centre is ON this", which has no radius in it - what
//! turns the third tangency into a third PLACE.
function onRow(element) {
  if (element.kind === "line") {
    const n = qLeft(element.way);
    return { row: [n[0], n[1], 0, 0], rhs: qDot(n, element.at) };
  }
  return null;              // a centre on a circle is not linear; see below
}

//! Solve a 3x4 system for one qSolution and the one direction it is free in.
//! Gauss-Jordan with partial pivoting; null when the rows do not pin down
//! three of the four, which is a degenerate arrangement rather than an answer.
function freeLine(rows, rhs) {
  const a = rows.map((row, i) => [...row, rhs[i]]);
  const where = [-1, -1, -1, -1];
  let pivot = 0;
  for (let col = 0; col < 4 && pivot < 3; col++) {
    let best = pivot;
    for (let row = pivot + 1; row < 3; row++)
      if (Math.abs(a[row][col]) > Math.abs(a[best][col])) best = row;
    if (Math.abs(a[best][col]) < 1e-12) continue;
    [a[pivot], a[best]] = [a[best], a[pivot]];
    const k = a[pivot][col];
    for (let j = col; j < 5; j++) a[pivot][j] /= k;
    for (let row = 0; row < 3; row++) {
      if (row === pivot) continue;
      const f = a[row][col];
      if (!f) continue;
      for (let j = col; j < 5; j++) a[row][j] -= f * a[pivot][j];
    }
    where[col] = pivot;
    pivot++;
  }
  if (pivot < 3) {
    // NOT ENOUGH TO PIN IT DOWN. Either the rows contradict one another - in
    // which case there is no such circle at all - or they agree and leave a
    // whole family of them. Two circles of the qSame size with a centre asked
    // to sit on their line of symmetry is the everyday case: EVERY circle
    // centred there that touches one touches the other, and there are
    // infinitely many. Worth saying out loud rather than answering "none",
    // because the two mean opposite things to whoever is drawing.
    for (let row = pivot; row < 3; row++)
      if (a[row].slice(0, 4).every(v => Math.abs(v) < 1e-12)
          && Math.abs(a[row][4]) > 1e-9) return null;
    return "family";
  }
  const free = where.indexOf(-1);
  if (free < 0) {
    // Four pinned by three rows cannot happen; a fully determined system means
    // one of the columns never had a pivot, which the search above would have
    // found. Guard anyway rather than return a wrong answer confidently.
    return null;
  }
  const at = [0, 0, 0, 0], way = [0, 0, 0, 0];
  at[free] = 0; way[free] = 1;
  for (let col = 0; col < 4; col++) {
    if (col === free) continue;
    const row = where[col];
    at[col] = a[row][4];
    way[col] = -a[row][free];
  }
  return { at, way };
}

//! And the quadratic that closes it: K = x^2 + y^2 - r^2, written along the
//! free line. Both roots, because both are circles somebody asked for.
function closeOn(line) {
  const [px, py, pr, pk] = line.at, [dx, dy, dr, dk] = line.way;
  const A = -dx * dx - dy * dy + dr * dr;
  const B = dk - 2 * px * dx - 2 * py * dy + 2 * pr * dr;
  const C = pk - px * px - py * py + pr * pr;
  const out = [];
  if (Math.abs(A) < 1e-14) {
    if (Math.abs(B) > 1e-14) out.push(-C / B);
  } else {
    const disc = B * B - 4 * A * C;
    if (disc < 0) return [];
    const root = Math.sqrt(disc);
    out.push((-B + root) / (2 * A), (-B - root) / (2 * A));
  }
  return out.map(t => ({ at: [px + t * dx, py + t * dy], r: pr + t * dr }))
            .filter(one => one.r > 1e-9 && one.at.every(Number.isFinite));
}

//! TANGENT TO THREE ELEMENTS. Points, lines and circles in any mixture -
//! GccAna_Circ2d3Tan, the Apollonius problem, and the reason the qualifiers
//! exist at all. Eight sign choices, two roots each, and whatever survives
//! being measured against what it was asked for.
export function circle3Tan(a, b, c, asks = []) {
  const elements = [a, b, c];
  if (elements.some(one => !one)) return [];
  const scale = qScaleOf(elements);
  const found = [];
  let family = false;
  for (let bits = 0; bits < 8; bits++) {
    const signs = [0, 1, 2].map(i => ((bits >> i) & 1 ? -1 : 1));
    const rows = elements.map((one, i) => tangencyRow(one, signs[i]));
    const line = freeLine(rows.map(r => r.row), rows.map(r => r.rhs));
    if (line === "family") { family = true; continue; }
    if (!line) continue;
    for (const got of closeOn(line)) {
      const how = elements.map(one => standing(one, got.at, got.r, 1e-6));
      if (how.some(one => one === null)) continue;
      if (how.some((one, i) => !allows(asks[i], one))) continue;
      found.push(qSolution(got.at, got.r, elements));
    }
  }
  return qAnswers(qDistinct(found, scale), family);
}

/* ------------------------------------------- tangent to two, centred on one

   A CENTRE ON A LINE is one more linear row, so it goes through the qSame
   machinery with the third equation saying "here" rather than "touching".

   A CENTRE ON A CIRCLE is not linear - the K trick needs the r-squared to
   cancel and here it does not - so that one is walked instead: slide the
   centre round the circle and watch the two radii the two tangencies ask for.
   Where they agree there is a qSolution, and crossing is what agreeing looks
   like from outside. One dimension, so it can be sampled and then pinched
   down to machine precision, which is exactly as exact as the algebra.      */

//! The radius a tangency to \p element would need, for a centre at \p at with
//! a given sign. NaN when the sign asks for something impossible.
function radiusFor(element, sign, at) {
  if (element.kind === "line") return signedFrom(element, at) / sign;
  const R = element.kind === "circle" ? element.r : 0;
  return (qLen(qSub(at, element.at)) - R) / sign;
}

const walkOn = (on, t) => on.kind === "line"
  ? qAdd(on.at, qMul(on.way, t))
  : qAdd(on.at, [on.r * Math.cos(t), on.r * Math.sin(t)]);

export function circle2TanOn(a, b, on, asks = []) {
  if (!a || !b || !on) return [];
  const scale = qScaleOf([a, b, on]);
  const found = [];

  if (on.kind === "line") {
    const row3 = onRow(on);
    let family = false;
    for (let bits = 0; bits < 4; bits++) {
      const signs = [(bits & 1) ? -1 : 1, (bits & 2) ? -1 : 1];
      const rows = [tangencyRow(a, signs[0]), tangencyRow(b, signs[1]), row3];
      const line = freeLine(rows.map(r => r.row), rows.map(r => r.rhs));
      if (line === "family") { family = true; continue; }
      if (!line) continue;
      for (const got of closeOn(line)) {
        if (Math.abs(signedFrom(on, got.at)) > 1e-6 * scale) continue;
        const how = [standing(a, got.at, got.r, 1e-6), standing(b, got.at, got.r, 1e-6)];
        if (how.some(one => one === null)) continue;
        if (how.some((one, i) => !allows(asks[i], one))) continue;
        found.push(qSolution(got.at, got.r, [a, b]));
      }
    }
    return qAnswers(qDistinct(found, scale), family && !found.length);
  }

  if (on.kind === "point") {
    // Nothing to slide along: the centre is where it is, and the two
    // tangencies either ask for the qSame radius or there is no such circle.
    const ra = Math.abs(signedFrom(a, on.at)), rb = Math.abs(signedFrom(b, on.at));
    return Math.abs(ra - rb) < 1e-6 * scale && ra > 1e-9
      ? [qSolution(on.at, (ra + rb) / 2, [a, b])] : [];
  }

  const steps = 2880;
  for (const signs of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const gap = t => {
      const at = walkOn(on, t);
      const ra = radiusFor(a, signs[0], at), rb = radiusFor(b, signs[1], at);
      return Number.isFinite(ra) && Number.isFinite(rb) ? ra - rb : NaN;
    };
    let was = gap(0), wasAt = 0;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const now = gap(t);
      if (Number.isFinite(was) && Number.isFinite(now) && was !== 0
          && Math.sign(now) !== Math.sign(was)) {
        // Pinched down by halving - twenty times over is a part in a million
        // of a step, which is below anything measured downstream.
        let lo = wasAt, hi = t, flo = was;
        for (let k = 0; k < 60; k++) {
          const mid = (lo + hi) / 2, f = gap(mid);
          if (!Number.isFinite(f)) break;
          if (Math.sign(f) === Math.sign(flo)) { lo = mid; flo = f; } else hi = mid;
        }
        const at = walkOn(on, (lo + hi) / 2);
        const r = radiusFor(a, signs[0], at);
        if (r > 1e-9) {
          const how = [standing(a, at, r, 1e-5), standing(b, at, r, 1e-5)];
          if (!how.some(one => one === null)
              && !how.some((one, i) => !allows(asks[i], one)))
            found.push(qSolution(at, r, [a, b]));
        }
      }
      was = now; wasAt = t;
    }
  }
  return qDistinct(found, scale);
}

/* =================================================================== lines

   A line here is a point and a direction, and the direction MATTERS: the
   documentation is careful about it because a tangency qualifier is about
   which side you are on, and which side is only a question once there is a
   way round. "This sense will be from first to second argument."             */

//! TANGENT TO TWO ELEMENTS. Points and circles: through two points is one
//! line, point and circle is two, circle and circle is up to four - the two
//! outer tangents and the two that cross between them.
export function line2Tan(a, b, askA = "unqualified", askB = "unqualified") {
  if (!a || !b || a.kind === "line" || b.kind === "line") return [];
  const ra = a.kind === "circle" ? a.r : 0, rb = b.kind === "circle" ? b.r : 0;
  const w = qSub(b.at, a.at);
  const d = qLen(w);
  if (d < 1e-12) return [];
  const out = [];
  for (const sa of ra > 0 ? [1, -1] : [1])
    for (const sb of rb > 0 ? [1, -1] : [1]) {
      // The line is at signed distance sa*ra from a and sb*rb from b, on its
      // own qLeft. Two such conditions fix the direction: across the line of
      // centres the offsets differ by d times the cosine between them, so the
      // difference IS the cosine once it is divided by the span - and it is
      // the difference the RIGHT way round, second minus first, because that
      // is the way the normal points.
      const gap = sb * rb - sa * ra;
      if (Math.abs(gap) > d + TOL) continue;
      const cos = gap / d;
      const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
      const unit = qMul(w, 1 / d);
      // The normal of the line, turned off the line of centres by that angle.
      for (const turn of sin < TOL ? [0] : [1, -1]) {
        const n = [unit[0] * cos - unit[1] * sin * turn, unit[1] * cos + unit[0] * sin * turn];
        // qLeft(way) = n, so way = -qLeft(n) ... which is (n[1], -n[0]).
        const line = cLine(qAdd(a.at, qMul(n, -sa * ra)), [n[1], -n[0]]);
        if (!line) continue;
        if (!touching(a, line) || !touching(b, line)) continue;
        if (!allows(askA, sideOf(a, line)) || !allows(askB, sideOf(b, line))) continue;
        out.push(lineAnswer(line, [a, b]));
      }
    }
  return distinctLines(out, qScaleOf([a, b]));
}

//! Whether a line really touches an element, read off the answer.
function touching(element, line, tol = 1e-6) {
  const scale = Math.max(1, Math.abs(element.at[0]), Math.abs(element.at[1]), element.r || 0);
  if (element.kind === "point") return Math.abs(signedFrom(line, element.at)) < tol * scale;
  return Math.abs(Math.abs(signedFrom(line, element.at)) - element.r) < tol * scale;
}

//! And which side of the line it ended up on, in the qualifiers' own words:
//! an element on the line's qLeft is enclosed by it, one on its right is
//! outside it, and a point it runs through is neither.
function sideOf(element, line) {
  const off = signedFrom(line, element.at);
  if (element.kind === "point") return "unqualified";
  return off > 0 ? "enclosed" : "outside";
}

const lineAnswer = (line, elements) => ({
  at: line.at.slice(), way: line.way.slice(),
  touches: elements.map(one => nearestOn(one, qAdd(line.at,
    qMul(line.way, qDot(qSub(one.at, line.at), line.way))))),
  how: elements.map(one => sideOf(one, line)),
});

function distinctLines(list, scale = 1) {
  const out = [];
  for (const one of list) {
    if (!one.at.every(Number.isFinite) || !one.way.every(Number.isFinite)) continue;
    const had = out.some(was =>
      Math.abs(qCross(was.way, one.way)) < 1e-7
      && Math.abs(qCross(was.way, qSub(one.at, was.at))) < 1e-6 * scale);
    if (!had) out.push(one);
  }
  return out;
}

//! TANGENT TO ONE ELEMENT AND AT AN ANGLE TO A LINE. Parallel is nought,
//! square on is a right angle, and everything between is the qSame arithmetic -
//! which is why the documentation's three entries are one function here.
export function lineTanAngle(a, reference, radians) {
  if (!a || !reference) return [];
  const turn = Number(radians) || 0;
  const way = [reference.way[0] * Math.cos(turn) - reference.way[1] * Math.sin(turn),
               reference.way[0] * Math.sin(turn) + reference.way[1] * Math.cos(turn)];
  const unit = cLine([0, 0], way);
  if (!unit) return [];
  const n = qLeft(unit.way);
  const r = a.kind === "circle" ? a.r : 0;
  const out = [];
  for (const side of r > 0 ? [1, -1] : [0]) {
    const line = cLine(qAdd(a.at, qMul(n, -side * r)), unit.way);
    if (line) out.push(lineAnswer(line, [a]));
  }
  return distinctLines(out, qScaleOf([a, reference]));
}

export const lineTanParallel = (a, reference) => lineTanAngle(a, reference, 0);
export const lineTanSquare = (a, reference) => lineTanAngle(a, reference, Math.PI / 2);

/* =============================================================== bisectors

   THE LOCUS OF EQUAL DISTANCE, which the documentation lists six of. Two of
   them are straight lines and the rest are conics - a parabola between a line
   and a point, an ellipse or a hyperbola between two circles - and this build
   carries no gp_Parab or gp_Hypr to hand them back as. So they come back as a
   run of points, densely enough sampled to draw, loft and measure against,
   and each says what it really is so the panel can say so too.               */

export const BISECTOR_KINDS = ["line", "parabola", "ellipse", "hyperbola", "circle"];

//! Every point equally far from two elements, as a run of points along the
//! locus, plus what sort of curve that run is.
export function bisector(a, b, { span = 0, steps = 96 } = {}) {
  if (!a || !b) return null;
  const scale = qScaleOf([a, b]);
  const reach = span > 0 ? span : scale * 3;

  if (a.kind === "point" && b.kind === "point") {
    const mid = qMul(qAdd(a.at, b.at), 0.5);
    const w = qSub(b.at, a.at);
    const n = qLen(w);
    if (n < 1e-12) return null;
    const way = qLeft(qMul(w, 1 / n));
    return { kind: "line", line: cLine(mid, way),
             points: [qSub(mid, qMul(way, reach)), qAdd(mid, qMul(way, reach))] };
  }

  if (a.kind === "line" && b.kind === "line") {
    const hit = meetLines(a, b);
    if (!hit.length) {
      // Parallel: the line halfway between them, which is still a bisector.
      const mid = qMul(qAdd(a.at, qAdd(b.at, qMul(qLeft(a.way),
        -signedFrom(a, b.at)))), 0.5);
      const line = cLine(mid, a.way);
      return line ? { kind: "line", line,
                      points: [qSub(mid, qMul(a.way, reach)), qAdd(mid, qMul(a.way, reach))] }
                  : null;
    }
    const at = hit[0];
    const out = [];
    for (const sign of [1, -1]) {
      const way = cLine([0, 0], qAdd(a.way, qMul(b.way, sign)));
      if (way) out.push({ kind: "line", line: cLine(at, way.way),
                          points: [qSub(at, qMul(way.way, reach)), qAdd(at, qMul(way.way, reach))] });
    }
    return out.length === 1 ? out[0] : { kind: "line", several: out, ...out[0] };
  }

  // Everything else is sampled: walk the locus by marching the point that is
  // equally far from both, which is one Newton step per sample and needs no
  // case analysis at all.
  const line = a.kind === "line" ? a : (b.kind === "line" ? b : null);
  const kind = conicBetween(a, b);
  const points = marchBisector(a, b, reach, steps);
  return points.length >= 2 ? { kind, points } : null;
}

//! What the locus IS, by the book: a parabola when one side is straight, an
//! ellipse when a circle contains the other thing, a hyperbola when it does
//! not. Said rather than computed, because it is what the panel prints.
function conicBetween(a, b) {
  const kinds = [a.kind, b.kind].sort().join("-");
  if (kinds === "line-point" || kinds === "circle-line") return "parabola";
  if (kinds === "circle-point") {
    const circle = a.kind === "circle" ? a : b;
    const point = a.kind === "circle" ? b : a;
    return qLen(qSub(point.at, circle.at)) < circle.r ? "ellipse" : "hyperbola";
  }
  if (kinds === "circle-circle") {
    const d = qLen(qSub(b.at, a.at));
    if (d < Math.abs(a.r - b.r)) return "ellipse";
    if (Math.abs(a.r - b.r) < 1e-9) return "line";
    return "hyperbola";
  }
  return "line";
}

//! MARCHING THE LOCUS. Start from a point known to be on it, then step along
//! the tangent - which is square to the gradient of the difference of the two
//! distances - and pull back onto the locus with one Newton step. Both ways
//! from the start, so the branch comes out whole.
function marchBisector(a, b, reach, steps) {
  const gap = at => Math.abs(signedFrom(a, at)) - Math.abs(signedFrom(b, at));
  const grad = at => {
    const h = Math.max(1e-6, reach * 1e-6);
    return [(gap([at[0] + h, at[1]]) - gap([at[0] - h, at[1]])) / (2 * h),
            (gap([at[0], at[1] + h]) - gap([at[0], at[1] - h])) / (2 * h)];
  };
  const pull = at => {
    let p = at.slice();
    for (let i = 0; i < 40; i++) {
      const f = gap(p);
      if (Math.abs(f) < 1e-10 * Math.max(1, reach)) break;
      const g = grad(p);
      const n2 = qDot(g, g);
      if (n2 < 1e-18) return null;
      p = qSub(p, qMul(g, f / n2));
      if (!p.every(Number.isFinite)) return null;
    }
    return Math.abs(gap(p)) < 1e-6 * Math.max(1, reach) ? p : null;
  };
  // Start on the segment between the two, where the locus always crosses.
  const seed = pull(qMul(qAdd(nearestOn(a, b.at), nearestOn(b, a.at)), 0.5))
            || pull(qMul(qAdd(a.at, b.at), 0.5));
  if (!seed) return [];
  const step = (reach * 2) / steps;
  const walk = way => {
    const out = [];
    let p = seed.slice();
    for (let i = 0; i < steps; i++) {
      const g = grad(p);
      const n = qLen(g);
      if (!(n > 1e-12)) break;
      const along = qMul(qLeft(qMul(g, 1 / n)), step * way);
      const next = pull(qAdd(p, along));
      if (!next) break;
      if (qLen(qSub(next, p)) < step * 1e-3) break;
      p = next;
      out.push(p.slice());
      if (qLen(qSub(p, seed)) > reach * 2.5) break;
    }
    return out;
  };
  return [...walk(-1).reverse(), seed.slice(), ...walk(1)];
}

/* --------------------------------------------------------------- the words

   One line about an answer, for the panel and the tree. A construction with
   eight solutions is unusable unless each one can be told apart at a glance,
   and "outside · around" is how a person would tell them apart out loud.     */

export const saysHow = how =>
  (how || []).map(one => qualifierNamed(one || "unqualified").label.toLowerCase()).join(" · ");

export function saysCircle(one, at = 0, of = 1) {
  if (!one) return "no circle qAnswers that";
  return "centre " + qTrim(one.at[0]) + ", " + qTrim(one.at[1])
       + " · r " + qTrim(one.r)
       + (of > 1 ? " · " + (at + 1) + " of " + of : "")
       + (one.how && one.how.length ? " · " + saysHow(one.how) : "");
}

export function saysLine(one, at = 0, of = 1) {
  if (!one) return "no line qAnswers that";
  return "through " + qTrim(one.at[0]) + ", " + qTrim(one.at[1])
       + " · " + qTrim(Math.atan2(one.way[1], one.way[0]) * 180 / Math.PI) + "°"
       + (of > 1 ? " · " + (at + 1) + " of " + of : "");
}

const qTrim = v => (Math.round(v * 100) / 100).toString();

