// Cutting the model open, and how the cut is drawn.
//
// A section is not a debugging aid. It is the drawing: a plan is a horizontal
// section at a metre and a half, an elevation is what is left when everything
// in front of the wall is taken away, and the difference between a section
// that reads and one that does not is entirely in how the cut face is drawn.
// So there is a plane you drag, and there is a STYLE - and the style is the
// half that matters.
//
// Four of them, and they are the four an architect already knows:
//
//   open      the cut is hollow. You see inside, and the walls are paper.
//   capped    the cut face is filled. The building reads as solid.
//   poche     filled, and hatched. The oldest convention there is: what the
//             plane passed through is poche, what is beyond it is not.
//   outline   hollow, with the cut edge drawn heavy. The line drawing.
//
// Nothing here knows about three.js or the DOM. Which way a plane faces, where
// its handle sits and how far it may travel are arithmetic; the stencil work
// that fills a cut face is not, and lives where the renderer does.

/* -------------------------------------------------------------- the planes */

//! The three a building is cut on, and the words for them. A plan is a cut on
//! Z; a section through a street is a cut on X or Y; and calling them that
//! rather than "clip plane 1" is the difference between a tool and a control
//! panel.
export const SECTION_AXES = [
  { key: "x", normal: [1, 0, 0], label: "Along X", cut: "looking east" },
  { key: "y", normal: [0, 1, 0], label: "Along Y", cut: "looking north" },
  { key: "z", normal: [0, 0, 1], label: "Level", cut: "a plan" },
];

export const SECTION_STYLES = [
  { key: "open", label: "Open",
    hint: "the cut is hollow - you see inside, and the walls are paper thin",
    caps: false, hatch: false, edge: false },
  { key: "capped", label: "Capped",
    hint: "the cut face is filled, so the building reads as solid",
    caps: true, hatch: false, edge: true },
  { key: "poche", label: "Poché",
    hint: "filled and hatched - what the plane passed through, the way a plan says it",
    caps: true, hatch: true, edge: true },
  { key: "outline", label: "Outline",
    hint: "hollow, with the cut edge drawn heavy - the line drawing",
    caps: false, hatch: false, edge: true },
];

export const styleNamed = key =>
  SECTION_STYLES.find(one => one.key === key) || SECTION_STYLES[0];

/* ------------------------------------------------------------ where it sits

   A CUT IS A PLACE, NOT A FRACTION. "Halfway through" means nothing the moment
   the model grows a wing; "at +3000" is a level somebody can build to. So the
   offset is kept in millimetres and the slider is only a way of reaching it -
   which is also why the slider's ends have to be the model's own extents
   rather than a pair of numbers somebody guessed.                          */

//! How far along a normal the two ends of a box reach. The travel a section
//! plane has, in the model's own units.
export function travelOf(low, high, normal) {
  if (!low || !high) return { from: -1000, to: 1000 };
  let from = 0, to = 0;
  for (let i = 0; i < 3; i++) {
    const a = low[i] * normal[i], b = high[i] * normal[i];
    from += Math.min(a, b);
    to += Math.max(a, b);
  }
  // A hair past either end, so a plane parked at the limit really is clear of
  // the model rather than shaving a face off it.
  const margin = Math.max(1, (to - from) * 0.02);
  return { from: from - margin, to: to + margin };
}

//! Where a plane starts life: the middle of what it is cutting, because a
//! section that opens on nothing looks like a section that does not work.
export const halfway = travel => (travel.from + travel.to) / 2;

//! The plane, as a normal and a constant, the way a renderer wants it.
//!
//! WHICH HALF IS KEPT is not a detail. "Level +1500" means a plan: everything
//! BELOW that height stays and everything above it is taken away, because that
//! is what you are standing in when you read a plan. Kept the other way round
//! it is still a section, but it is a section of the roof, and nobody pressing
//! "Level" meant that. Flipped asks for the other half on purpose.
//!
//! A renderer keeps what satisfies normal.p + constant >= 0, so keeping the
//! low side means pointing the plane's normal DOWN the axis.
export function planeOf(normal, offset, flipped) {
  const way = flipped ? normal : normal.map(v => -v);
  return { normal: way, constant: flipped ? -offset : offset };
}

//! Is a point on the kept side? What a handle uses to decide which way its
//! arrow points, and what a test uses to say the cut is really cutting.
export function keeps(plane, at) {
  return plane.normal[0] * at[0] + plane.normal[1] * at[1] + plane.normal[2] * at[2]
       + plane.constant >= 0;
}

//! Two directions across a plane, for drawing its outline and its handle. Any
//! pair will do as long as they are square to the normal and to each other.
export function acrossOf(normal) {
  const other = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(other, normal)) || [1, 0, 0];
  return [u, unit(cross(normal, u)) || [0, 1, 0]];
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];
const unit = a => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : null;
};

//! One line saying where a cut is, for the bar. A level reads as a level,
//! because that is what people call it on site.
export function saysWhere(axis, offset) {
  const mm = Math.round(offset);
  if (axis === "z") return (mm >= 0 ? "+" : "−") + Math.abs(mm) + " mm";
  return axis.toUpperCase() + " " + mm + " mm";
}

//! Every plane that is switched on, ready for a renderer. Returned in a fixed
//! order so what is drawn does not shuffle when one is turned off.
export function activePlanes(cuts) {
  const out = [];
  for (const axis of SECTION_AXES) {
    const cut = cuts && cuts[axis.key];
    if (!cut || !cut.on) continue;
    out.push({ key: axis.key, ...planeOf(axis.normal, cut.offset, cut.flipped) });
  }
  return out;
}

//! A fresh set of cuts, parked in the middle of the model and all switched
//! off. What "no section" looks like before anybody has asked for one.
export function freshCuts(low, high) {
  const cuts = {};
  for (const axis of SECTION_AXES) {
    const travel = travelOf(low, high, axis.normal);
    cuts[axis.key] = { on: false, flipped: false, offset: halfway(travel), travel };
  }
  return cuts;
}

//! The travel re-measured against a model that has changed size, keeping each
//! plane where it is unless it now sits outside what there is to cut.
export function refit(cuts, low, high) {
  const out = {};
  for (const axis of SECTION_AXES) {
    const travel = travelOf(low, high, axis.normal);
    const was = (cuts && cuts[axis.key]) || {};
    const offset = Number.isFinite(was.offset)
      ? Math.max(travel.from, Math.min(travel.to, was.offset))
      : halfway(travel);
    out[axis.key] = { on: !!was.on, flipped: !!was.flipped, offset, travel };
  }
  return out;
}

/* ------------------------------------------------------- the line of the cut

   WHERE THE PLANE MEETS THE MODEL, exactly: the segments a plane makes through
   a triangle soup. A stencil fills the cut face, which is what makes a section
   read as solid - but a fill has no edge, and the edge is the drawing. This is
   the edge.

   One triangle at a time, which is the whole algorithm: work out which side of
   the plane each corner is on, and where the plane crosses the two edges that
   have a corner on either side. Two crossings, one segment. A triangle wholly
   on one side gives none, and one lying IN the plane gives none either - its
   neighbours already drew the line.                                        */

export function sectionEdges(positions, index, plane, into = []) {
  if (!positions || !index) return into;
  const [nx, ny, nz] = plane.normal;
  const d = plane.constant;
  const side = i => positions[i * 3] * nx + positions[i * 3 + 1] * ny
                  + positions[i * 3 + 2] * nz + d;
  const at = (a, b, t) => [
    positions[a * 3] + (positions[b * 3] - positions[a * 3]) * t,
    positions[a * 3 + 1] + (positions[b * 3 + 1] - positions[a * 3 + 1]) * t,
    positions[a * 3 + 2] + (positions[b * 3 + 2] - positions[a * 3 + 2]) * t];

  for (let i = 0; i + 2 < index.length; i += 3) {
    const c = [index[i], index[i + 1], index[i + 2]];
    const s = c.map(side);
    // Wholly on one side, or lying in the plane: nothing to draw here.
    if ((s[0] > 0 && s[1] > 0 && s[2] > 0) || (s[0] < 0 && s[1] < 0 && s[2] < 0)) continue;
    if (s[0] === 0 && s[1] === 0 && s[2] === 0) continue;
    const hits = [];
    for (let k = 0; k < 3; k++) {
      const a = k, b = (k + 1) % 3;
      if ((s[a] > 0) === (s[b] > 0)) continue;
      const span = s[a] - s[b];
      if (Math.abs(span) < 1e-12) continue;
      hits.push(at(c[a], c[b], s[a] / span));
    }
    if (hits.length !== 2) continue;
    into.push(hits[0][0], hits[0][1], hits[0][2], hits[1][0], hits[1][1], hits[1][2]);
  }
  return into;
}

//! How long the cut line is, all told. A number worth having: a section that
//! reads as empty because the plane is past the end of the model says so as a
//! zero rather than as a blank screen nobody can explain.
export function cutLength(flat) {
  let total = 0;
  for (let i = 0; i + 5 < flat.length; i += 6)
    total += Math.hypot(flat[i + 3] - flat[i], flat[i + 4] - flat[i + 1],
                        flat[i + 5] - flat[i + 2]);
  return total;
}

/* ======================================================================
   HOW ONE OBJECT IS CUT.

   A drawing does not hatch everything the same. Concrete is one poche,
   blockwork another, insulation is a zigzag, glass is not hatched at all and
   is drawn with a fine line; structure is drawn heavy and furniture light.
   That is not decoration - it is how a section is READ, and it has been for a
   hundred and fifty years.

   So the style belongs to the OBJECT, not to the window. The bar's four styles
   are the default every object inherits; an object that says something for
   itself overrides it, and what it says travels in the model file with
   everything else it says about itself.
   ====================================================================== */

//! The patterns. Drawn rather than shipped: each one is a few lines of canvas
//! and a tile size, so they cost nothing, scale with the model and take the
//! object's own colours.
export const CUT_PATTERNS = [
  { key: "inherit",    label: "As the view", hint: "whatever the section bar says" },
  { key: "none",       label: "None",        hint: "the cut is left hollow" },
  { key: "solid",      label: "Solid",       hint: "filled flat" },
  { key: "diagonal",   label: "Diagonal",    hint: "45° lines - the usual poche" },
  { key: "backslash",  label: "Reverse",     hint: "45° the other way" },
  { key: "cross",      label: "Cross",       hint: "hatched both ways - masonry" },
  { key: "grid",       label: "Grid",        hint: "square, for tile and paving" },
  { key: "dots",       label: "Dots",        hint: "stipple - fill, earth, screed" },
  { key: "horizontal", label: "Horizontal",  hint: "straight lines across" },
  { key: "vertical",   label: "Vertical",    hint: "straight lines up" },
  { key: "brick",      label: "Brick",       hint: "a running bond" },
  { key: "image",      label: "An image",    hint: "a picture of your own, tiled" },
];

export const patternNamed = key =>
  CUT_PATTERNS.find(one => one.key === key) || CUT_PATTERNS[0];

//! HOW MANY OF THE MOTIF ARE IN ONE TILE. Said here because two things need
//! it and they must not disagree: the canvas that draws the tile, and the
//! viewport working out how big the tile has to be ON SCREEN for the lines to
//! be the right distance apart. Read off the texture it was drawn on, it was
//! quietly lost the first time the texture was cloned - and a hatch nine
//! pixels wide holding six lines is not a hatch, it is a grey smear that looks
//! the same whatever pattern it was.
export const HATCH_MOTIFS = 6;
export const motifsOf = pattern =>
  pattern === "image" || pattern === "solid" ? 1
  : pattern === "brick" ? 4 : HATCH_MOTIFS;

//! And the lines. Weight is in PIXELS, because a line weight in a 3D view is
//! about how heavy it reads on the screen you are reading it on - a width in
//! millimetres would vanish on a masterplan and swamp a bracket.
export const CUT_LINES = [
  { key: "inherit", label: "As the view", hint: "whatever the section bar says" },
  { key: "none",    label: "None",        hint: "no line round the cut" },
  { key: "solid",   label: "Continuous",  dash: 0, gap: 0 },
  { key: "dashed",  label: "Dashed",      dash: 14, gap: 8 },
  { key: "dotted",  label: "Dotted",      dash: 2.5, gap: 6 },
  { key: "chain",   label: "Chain",       dash: 22, gap: 6, second: 2.5 },
];

export const lineNamed = key =>
  CUT_LINES.find(one => one.key === key) || CUT_LINES[0];

//! Pen weights, the ones on a drawing board and in every standard since: the
//! root-two series. Offered as buttons because "0.35" means something to an
//! architect and "2.7 pixels" does not.
export const CUT_WEIGHTS = [
  { key: 1, label: "Hairline" }, { key: 1.5, label: "Fine" },
  { key: 2, label: "Medium" },   { key: 3, label: "Heavy" },
  { key: 4.5, label: "Very heavy" },
];

//! WHAT THE FOUR BUTTONS ON THE BAR MEAN, said as a cut style - so the window's
//! setting and an object's own setting are the same kind of thing and one can
//! stand in for the other.
export function styleAsCut(key) {
  const style = styleNamed(key);
  return { pattern: style.hatch ? "diagonal" : style.caps ? "solid" : "none",
           line: style.edge ? "solid" : "none", weight: 1.5, scale: 1, angle: 0,
           fill: null, ink: null, tile: "" };
}

//! AN OBJECT'S CUT STYLE, resolved down THREE levels: what the object says
//! for itself, then what the sets it sits in say, then the window's own
//! setting. One answer, in one shape, so the fill, the line and the panel
//! cannot disagree about what is meant.
//!
//! THE MIDDLE LEVEL IS THE ONE THAT MAKES IT USABLE. A building is not styled
//! object by object - it is styled by trade. Every wall in the blockwork set
//! is poched the same, every slab in the structure set is heavier, and saying
//! so once on the set is the difference between a drawing standard and six
//! hundred right-clicks. An object that says nothing takes its set's answer;
//! a set that says nothing takes ITS set's; and what nobody claims is the
//! view's.
//!
//! \p above is the sets the object sits in, NEAREST FIRST - which is the order
//! "use the parent" means, and the order the walk up the tree produces.
export function cutStyleOf(appearance, viewStyle = "capped", above = []) {
  const own = (appearance && appearance.cut) || {};
  //! Each set's own cut record, in the same shape, read once here so the
  //! lookup below is a list of plain objects rather than a walk per field.
  const inherited = (Array.isArray(above) ? above : [])
    .map(one => (one && one.cut) || (one && one.appearance && one.appearance.cut) || {})
    .filter(one => one && Object.keys(one).length);
  const under = styleAsCut(viewStyle);
  const said = value => !(value === undefined || value === null || value === "inherit");
  //! "USE PARENT" IS THE ABSENCE OF AN ANSWER, not a fourth value to store. An
  //! object that has been given nothing follows its set; one that has been
  //! given something follows itself; and "back to the parent" is done by
  //! deleting the field rather than by writing a word meaning "ask upstairs" -
  //! which is what keeps a file that has never been styled empty.
  const pick = (key, fallback) => {
    if (said(own[key])) return own[key];
    for (const level of inherited) if (said(level[key])) return level[key];
    return fallback;
  };
  const pattern = pick("pattern", under.pattern);
  const line = pick("line", under.line);
  //! Where the answer came from, so the panel can say "as the structure set"
  //! rather than leaving somebody to guess why a wall they never touched is
  //! hatched. Own beats set beats view, and it is the same order as above.
  const from = Object.keys(own).length ? "own"
             : inherited.length ? "set" : "view";
  return {
    from,
    pattern: patternNamed(pattern).key === "inherit" ? under.pattern : pattern,
    line: lineNamed(line).key === "inherit" ? under.line : line,
    weight: Math.max(0.5, Math.min(12, Number(pick("weight", under.weight)) || under.weight)),
    scale: Math.max(0.05, Math.min(20, Number(pick("scale", 1)) || 1)),
    angle: Number(pick("angle", 0)) || 0,
    // Nothing said means "the colour the view uses", which the viewport knows
    // and this does not - so it says nothing rather than guessing at a colour.
    fill: (v => Array.isArray(v) && v.length === 3 ? v : null)(pick("fill", null)),
    ink: (v => Array.isArray(v) && v.length === 3 ? v : null)(pick("ink", null)),
    tile: (v => typeof v === "string" ? v : "")(pick("tile", "")),
    own: Object.keys(own).length > 0,
  };
}

//! The record that is written into the document: only what differs from "as
//! the view", so an object that has not been given a style of its own carries
//! nothing at all and follows the bar.
export function cutRecord(changes, was = {}) {
  const out = { ...was, ...changes };
  for (const [key, value] of Object.entries(out))
    if (value === "inherit" || value === undefined || value === null) delete out[key];
  return Object.keys(out).length ? out : null;
}

//! One line about a cut style, for the panel.
export function saysCut(cut) {
  const pattern = CUT_PATTERNS.find(one => one.key === cut.pattern);
  const line = CUT_LINES.find(one => one.key === cut.line);
  return (pattern ? pattern.label : cut.pattern).toLowerCase()
       + (line && line.key !== "none" ? " · " + line.label.toLowerCase()
           + " at " + cut.weight : " · no line");
}

/* ------------------------------------------------------------ dashed lines

   CHOPPED HERE RATHER THAN IN A SHADER. The segments are already known and the
   cut is already being rebuilt whenever it moves, so a dash is a shorter
   segment: exact, no material to get wrong, and it works with the screen-space
   width the ribbon is drawn at.

   The period is a share of the model rather than a number of millimetres, so
   the same dash reads the same on a bracket and on a masterplan.           */

export function dashSegments(flat, period, duty = 0.6, second = 0) {
  if (!(period > 0)) return flat;
  const out = [];
  const cycle = second > 0 ? period + second + period * (1 - duty) : period;
  for (let i = 0; i + 5 < flat.length; i += 6) {
    const a = [flat[i], flat[i + 1], flat[i + 2]];
    const b = [flat[i + 3], flat[i + 4], flat[i + 5]];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (span < 1e-9) continue;
    const at = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
                     a[2] + (b[2] - a[2]) * t];
    for (let start = 0; start < span; start += cycle) {
      const marks = second > 0
        ? [[start, start + period * duty],
           [start + period, start + period + second]]
        : [[start, start + period * duty]];
      for (const [from, to] of marks) {
        const one = Math.min(to, span);
        if (from >= span || one - from < 1e-9) continue;
        const p = at(from / span), q = at(one / span);
        out.push(p[0], p[1], p[2], q[0], q[1], q[2]);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------- a line with weight

   WebGL will not draw a line thicker than one pixel, whatever the material
   says - so a line with weight is not a line, it is a ribbon: a quad per
   segment, expanded sideways.

   Expanded IN THE CUT PLANE, because that is the plane the line lies in and a
   line drawn on a cut face should stay on it. The direction to expand along is
   worked out here, per vertex; how FAR is the shader's, so a ribbon never has
   to be rebuilt when the camera moves.                                     */

export function ribbonOf(flat, normal) {
  const position = [], offset = [], side = [], index = [];
  const n = normal || [0, 0, 1];
  for (let i = 0; i + 5 < flat.length; i += 6) {
    const a = [flat[i], flat[i + 1], flat[i + 2]];
    const b = [flat[i + 3], flat[i + 4], flat[i + 5]];
    const along = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const span = Math.hypot(along[0], along[1], along[2]);
    if (span < 1e-9) continue;
    // Square to the segment and lying in the plane: the cross of the two.
    let out = [n[1] * along[2] - n[2] * along[1], n[2] * along[0] - n[0] * along[2],
               n[0] * along[1] - n[1] * along[0]];
    const long = Math.hypot(out[0], out[1], out[2]);
    if (long < 1e-12) continue;
    out = [out[0] / long, out[1] / long, out[2] / long];
    const base = position.length / 3;
    for (const p of [a, a, b, b]) position.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) offset.push(out[0], out[1], out[2]);
    side.push(1, -1, 1, -1);
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return { position, offset, side, index };
}
