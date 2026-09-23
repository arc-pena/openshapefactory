//! Copied from the OCAF modeller (cad/src/sections.js): rolled-section outlines, for the IFC reader.
// Structural sections: the shapes a steelwork schedule is written in.
//
// An I-beam is not a modelling operation, it is a NAME plus six numbers, and
// every building model in the world is full of them. Drawn by hand as a closed
// outline it is twelve lines and four fillets that stop being an I-beam the
// moment the web thickness changes; declared as a section it stays one.
//
// So this is the arithmetic for the outlines, on its own, with no kernel and
// no IFC anywhere near it: parameters in, a drawing out. Two things use it -
// the Section node in the catalogue, and the IFC reader, which meets
// IfcIShapeProfileDef and the five beside it in every file a structural
// engineer sends. One piece of arithmetic rather than two, because a beam that
// came in from IFC and a beam somebody typed have to be the same beam.
//
// THE CORNERS ARE ARCS, not a polygon fine enough to look like one. A rolled
// section's root radius is a real dimension - a fabricator reads it and a
// fillet weld sits in it - and a section drawn without it is the wrong
// section.

const gap = (a, b) => [a[0] - b[0], a[1] - b[1]];
const plus = (a, b) => [a[0] + b[0], a[1] + b[1]];
const times = (a, k) => [a[0] * k, a[1] * k];
const sizeOf = a => Math.hypot(a[0], a[1]);
const toUnit = a => { const l = sizeOf(a); return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l]; };
const turnOf = (a, b) => a[0] * b[1] - a[1] * b[0];

//! THE CORNERS OF A RING, EACH WITH THE RADIUS TO ROUND IT BY, as sketch
//! elements. The generic step, because every section below is a closed run of
//! straight sides with some of its corners rounded - and doing it once is the
//! difference between six pieces of trigonometry and one.
//!
//! A radius too big for the corner it sits in is trimmed to what fits rather
//! than refused: a section table with a root radius larger than the flange it
//! meets is a typo in the table, and it should still draw.
export function roundedRing(points, radii = [], name = "s") {
  const n = points.length;
  if (n < 3) return [];
  let mark = 0;
  const id = () => name + (++mark);

  //! Each corner, worked out on its own: how far back along each side the arc
  //! starts, where its centre is, and which way it turns.
  const corners = points.map((q, i) => {
    const asked = Math.max(0, radii[i] || 0);
    const before = points[(i + n - 1) % n], after = points[(i + 1) % n];
    const u = toUnit(gap(before, q)), v = toUnit(gap(after, q));
    const cosine = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]));
    const half = Math.acos(cosine) / 2;
    if (!asked || !(half > 1e-6) || half > Math.PI / 2 - 1e-6) return { r: 0 };
    let back = asked / Math.tan(half);
    const room = Math.min(sizeOf(gap(before, q)), sizeOf(gap(after, q))) / 2;
    let r = asked;
    if (back > room) { back = room; r = back * Math.tan(half); }
    return {
      r, back,
      centre: plus(q, times(toUnit(plus(u, v)), r / Math.sin(half))),
      start: plus(q, times(u, back)),          // where the side coming IN stops
      stop: plus(q, times(v, back)),           // where the side going OUT starts
      //! Left turn or right. A flange tip turns one way and the root of a web
      //! turns the other, and an arc drawn the long way round at the root
      //! fills the web in.
      ccw: turnOf(times(u, -1), v) > 0,
    };
  });

  const out = [];
  for (let i = 0; i < n; i++) {
    const here = corners[i], next = corners[(i + 1) % n];
    const from = here.r ? here.stop : points[i];
    const to = next.r ? next.start : points[(i + 1) % n];
    if (sizeOf(gap(to, from)) > 1e-9)
      out.push({ id: id(), type: "line", a: from, b: to });
    if (!next.r) continue;
    const angle = p => Math.atan2(p[1] - next.centre[1], p[0] - next.centre[0]);
    let a0 = angle(next.start), a1 = angle(next.stop);
    if (next.ccw) { while (a1 <= a0) a1 += Math.PI * 2; }
    else { const was = a0; a0 = a1; a1 = was; while (a1 <= a0) a1 += Math.PI * 2; }
    out.push({ id: id(), type: "arc", c: next.centre, r: next.r, a0, a1 });
  }
  return out;
}

//! What a section is asked for by. The order is the order of the choice on the
//! node, so it is append-only like every other choice in the catalogue.
export const SECTION_KINDS = ["I or H", "L angle", "U channel", "T", "C purlin",
                              "Z purlin", "Rectangular hollow", "Circular hollow",
                              "Trapezium"];

//! A section outline as sketch elements, on its own profile plane.
//!
//! Centred on the middle of its bounding box, which is where IFC puts every
//! parameterised profile and where a column wants it. \p p holds whatever the
//! kind needs; everything is in the drawing's units and nothing here scales
//! anything.
export function sectionOutline(kind, p = {}) {
  const depth = Math.abs(p.depth || 0), width = Math.abs(p.width || 0);
  const web = Math.abs(p.web || 0), flange = Math.abs(p.flange || 0);
  const root = Math.max(0, p.root || 0), toe = Math.max(0, p.toe || 0);
  const h = depth / 2, b = width / 2, t = web / 2;
  const ring = (points, radii) => ({ outer: roundedRing(points, radii), inner: [] });

  switch (String(kind || "")) {
    case "I or H":
      return ring([
        [-b, -h], [b, -h], [b, -h + flange], [t, -h + flange], [t, h - flange],
        [b, h - flange], [b, h], [-b, h], [-b, h - flange], [-t, h - flange],
        [-t, -h + flange], [-b, -h + flange],
      ], [0, 0, toe, root, root, toe, 0, 0, toe, root, root, toe]);

    case "L angle":
      //! An angle's origin is the middle of its bounding box, not its heel.
      return ring([[-b, -h], [b, -h], [b, -h + web], [-b + web, -h + web],
                   [-b + web, h], [-b, h]],
                  [0, toe, toe, root, toe, 0]);

    case "U channel":
      return ring([
        [-b, -h], [b, -h], [b, -h + flange], [-b + web, -h + flange],
        [-b + web, h - flange], [b, h - flange], [b, h], [-b, h],
      ], [0, toe, toe, root, root, toe, toe, 0]);

    case "T":
      return ring([
        [-t, -h], [t, -h], [t, h - flange], [b, h - flange], [b, h], [-b, h],
        [-b, h - flange], [-t, h - flange],
      ], [toe, toe, root, toe, 0, 0, toe, root]);

    case "C purlin": {
      //! A cold-rolled C: a channel whose flange tips are turned back in by
      //! the girth, which is the lip that keeps it from folding.
      const girth = Math.max(0, p.lip || 0);
      const wall = web || flange;
      const outerR = root + wall;
      return ring([
        [-b, -h], [b, -h], [b, -h + girth], [b - wall, -h + girth],
        [b - wall, -h + wall], [-b + wall, -h + wall], [-b + wall, h - wall],
        [b - wall, h - wall], [b - wall, h - girth], [b, h - girth], [b, h], [-b, h],
      ], [0, outerR, 0, 0, root, root, root, root, 0, 0, outerR, 0]);
    }

    case "Z purlin":
      //! Two flanges off one web, pointing opposite ways.
      return ring([
        [-t, -h], [b, -h], [b, -h + flange], [t, -h + flange],
        [t, h], [-b, h], [-b, h - flange], [-t, h - flange],
      ], [root, toe, toe, root, root, toe, toe, root]);

    case "Rectangular hollow": {
      const wall = Math.max(0, p.wall || 0);
      const outerR = Math.max(0, p.outerRadius || 0);
      const innerR = Math.max(0, p.innerRadius || 0);
      const outer = roundedRing([[-b, -h], [b, -h], [b, h], [-b, h]],
                                [outerR, outerR, outerR, outerR], "o");
      if (!wall || wall >= Math.min(b, h)) return { outer, inner: [] };
      const ib = b - wall, ih = h - wall;
      return { outer, inner: [roundedRing([[-ib, -ih], [ib, -ih], [ib, ih], [-ib, ih]],
                                          [innerR, innerR, innerR, innerR], "h")] };
    }

    case "Circular hollow": {
      const wall = Math.max(0, p.wall || 0);
      const outer = [{ id: "o1", type: "circle", c: [0, 0], r: width / 2 }];
      if (!wall || wall >= width / 2) return { outer, inner: [] };
      return { outer, inner: [[{ id: "h1", type: "circle", c: [0, 0], r: width / 2 - wall }]] };
    }

    case "Trapezium": {
      //! IFC states a trapezium by its two widths, its depth, and how far the
      //! top is set over - measured, unlike every other profile here, from the
      //! bottom left.
      const top = Math.abs(p.top || 0), offset = p.offset || 0;
      return ring([[-b, -h], [b, -h], [-b + offset + top, h], [-b + offset, h]],
                  [root, root, root, root]);
    }

    default: return { outer: [], inner: [] };
  }
}

//! THE AREA A SECTION OUTLINE ENCLOSES, worked out on paper - used to check a
//! section against its own table, and by the tests here for the same reason.
//!
//! Arcs are integrated exactly rather than sampled: the root radii on a UB are
//! a percent of its area, and a sampled answer cannot tell a right section
//! from a nearly right one.
//!
//! WHICH WAY AN ARC IS TRAVERSED is not in the element - a sketch arc is
//! always stored anticlockwise, whichever way the outline runs through it -
//! so it is recovered by chaining: the end the previous element finished at is
//! the end this one starts from. That matters because the root fillet of an
//! I-beam is traversed the other way from the fillet at its flange tip, and an
//! area that took them both the same way is out by twice the fillets.
export function sectionArea(elements) {
  const on = (el, which) => [el.c[0] + el.r * Math.cos(which),
                             el.c[1] + el.r * Math.sin(which)];
  const ends = el => el.type === "line" ? [el.a, el.b]
    : el.type === "arc" ? [on(el, el.a0), on(el, el.a1)] : null;
  let twice = 0, here = null;
  for (const el of elements) {
    if (el.type === "circle") { twice += 2 * Math.PI * el.r * el.r; continue; }
    const pair = ends(el);
    if (!pair) continue;
    const forward = !here || sizeOf(gap(pair[0], here)) <= sizeOf(gap(pair[1], here));
    const from = forward ? pair[0] : pair[1], to = forward ? pair[1] : pair[0];
    twice += from[0] * to[1] - to[0] * from[1];
    if (el.type === "arc") {
      // The chord above, plus the circular segment standing on it - added when
      // the arc bulges to the left of the path, taken off when it bulges right.
      const span = el.a1 - el.a0;
      twice += (forward ? 1 : -1) * el.r * el.r * (span - Math.sin(span));
    }
    here = to;
  }
  return twice / 2;
}
