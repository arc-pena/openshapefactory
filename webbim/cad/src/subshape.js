// Picking an edge, or a face, and being able to say which one tomorrow.
//
// "Fillet this body" is a whole answer and a blunt one. What a person means is
// "round THESE four edges, and leave the rest" - and the moment an operation is
// about particular edges, the program has to be able to write down WHICH, in a
// file, in a way that still means the same edges after the box underneath has
// been made 200 mm wider.
//
// THE HARD PART, and it is the same hard part the mesh editor has. OpenCascade
// enumerates the edges of a shape in a deterministic order, so "edge 7" is a
// perfectly good name for one - until the shape is rebuilt with one more edge
// in it, and edge 7 is somewhere else. OCAF's own answer to this is TNaming,
// which tracks a sub-shape through the operations that made it; that is the
// right answer for a kernel and far too much machinery for a file that a person
// is supposed to be able to read.
//
// So a pick is written down TWICE: the index, which is exact and cheap and
// right nearly always, and where the thing WAS - its middle, which way it runs,
// and how big it is. When the index still lands on something at the same place,
// that is it. When it does not, the nearest thing of the same kind pointing the
// same way is taken. When there is nothing like that at all, the pick says so
// rather than quietly rounding a different edge.
//
//     { "of": "CB1", "kind": "edge", "at": 2,
//       "near": [40, 0, 40, 0, 1, 0, 40] }
//
// which reads, in the file, as: edge 2 of CB1, which was 80 mm long, running
// along Y, through (40, 0, 40). A person can check that against the model.
//
// Nothing here knows about OpenCascade. It is handed polylines and triangles -
// which is what the viewport is drawing anyway - and it answers in indices.
// That is what makes it testable, and it is why the tangent walk below is the
// same code whether it runs in the page or in the kernel.

/* ----------------------------------------------------------- arithmetic */

const sAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const sMul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const sDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                          a[0] * b[1] - a[1] * b[0]];
const sLen = a => Math.hypot(a[0], a[1], a[2]);
const sUnit = a => {
  const n = sLen(a);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
};

/* -------------------------------------------------------------- anchors */

//! WHERE AN EDGE IS, from the polyline the viewport draws it with.
//!
//! Its middle, the way it runs there, and half its length. Not its ends: an
//! edge that has been trimmed has different ends and the same middle, and the
//! middle is the part that stays put when a fillet upstream nibbles the corner
//! off it.
export function edgeAnchor(points) {
  if (!points || points.length < 2) return [0, 0, 0, 0, 0, 1, 0];
  let walked = 0;
  const steps = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const step = sLen(sSub(points[i + 1], points[i]));
    steps.push(step);
    walked += step;
  }
  // Half way ALONG it rather than half way through the list: a polyline is
  // finer where the curve bends, so the middle of the list is not the middle
  // of the edge.
  let half = walked / 2, at = 0;
  while (at < steps.length - 1 && half > steps[at]) { half -= steps[at]; at++; }
  const t = steps[at] > 1e-12 ? half / steps[at] : 0;
  const middle = sAdd(points[at], sMul(sSub(points[at + 1], points[at]), t));
  const way = sUnit(sSub(points[at + 1], points[at]));
  return [...middle, ...way, walked / 2];
}

//! AND WHERE A FACE IS: the middle of its triangles weighted by their area, the
//! way it faces there, and how far it reaches. Area-weighted because the middle
//! of the VERTICES of a face that is finely tessellated at one corner is over
//! at that corner, which is not where the face is.
export function faceAnchor(positions, index) {
  if (!positions || !index || !index.length) return [0, 0, 0, 0, 0, 1, 0];
  const at = i => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  let area = 0, middle = [0, 0, 0], normal = [0, 0, 0];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = at(index[t]), b = at(index[t + 1]), c = at(index[t + 2]);
    const cross = sCross(sSub(b, a), sSub(c, a));
    const size = sLen(cross) / 2;
    if (!(size > 0)) continue;
    area += size;
    middle = sAdd(middle, sMul(sMul(sAdd(sAdd(a, b), c), 1 / 3), size));
    normal = sAdd(normal, cross);
  }
  if (!(area > 0)) return [...at(index[0]), 0, 0, 1, 0];
  const centre = sMul(middle, 1 / area);
  let far = 0;
  for (let t = 0; t < index.length; t++) far = Math.max(far, sLen(sSub(at(index[t]), centre)));
  return [...centre, ...sUnit(normal), far];
}

/* ------------------------------------------------------------- the pick */

//! A pick, as it goes into the file. \p of is the feature whose shape it
//! belongs to, so a reference reads "edge 2 of CB1" and can be checked.
//! \p count is how many sub-shapes of this kind the body had when the pick was
//! taken. See matchPick: it is the difference between a pick that survives a
//! parametric change of any size and one that survives a small one.
export function pickOf(of, kind, at, near, count) {
  const made = { of: String(of), kind, at: Math.max(0, Math.round(at)),
                 near: (near || []).map(v => Math.round(v * 1e4) / 1e4) };
  if (Number.isInteger(count) && count > 0) made.count = count;
  return made;
}

//! The list, read out of the argument's text. Tolerant on purpose: a file
//! somebody has edited by hand should lose the line it got wrong rather than
//! the feature.
export function readPicks(text) {
  if (Array.isArray(text)) return text.filter(one => one && one.kind);
  const said = String(text == null ? "" : text).trim();
  if (!said || said === "[]") return [];
  let read;
  try { read = JSON.parse(said); } catch (error) { return []; }
  if (!Array.isArray(read)) return [];
  return read.filter(one => one && typeof one === "object" && one.kind
                     && Number.isFinite(Number(one.at)))
             .map(one => {
               const made = { of: one.of ? String(one.of) : "", kind: String(one.kind),
                              at: Math.max(0, Math.round(Number(one.at))),
                              near: Array.isArray(one.near) ? one.near.map(Number) : [] };
               //! Absent on every pick written before this existed, which is
               //! what makes it safe to add: no count, no claim, and the tests
               //! below it answer as they always did.
               if (Number.isInteger(Number(one.count)) && Number(one.count) > 0)
                 made.count = Number(one.count);
               return made;
             });
}

export const writePicks = picks => JSON.stringify((picks || []).map(p =>
  ({ of: p.of, kind: p.kind, at: p.at, near: p.near })));

//! What the panel and the tree say about a list. An empty list is not "none" -
//! it is the operation's own default, and on a fillet that is every edge.
export function describePicks(picks, kind = "edge", whole = "all of them") {
  const n = (picks || []).length;
  if (!n) return whole;
  return n + " " + kind + (n === 1 ? "" : kind.endsWith("s") ? "" : "s");
}

/* -------------------------------------------------- finding it again */

//! WHICH ONE IT IS NOW. \p anchors is the list the shape has today, in order.
//!
//! The index first, because it is exact and it is right nearly always. Then the
//! nearest thing of the same kind that is pointing the same way and is about
//! the same size - within a tenth of the shape, which is generous enough to
//! survive a box being resized and tight enough not to jump to the edge on the
//! other side of it. Then nothing, and saying nothing is the point: an
//! operation that has lost the edge it was about must not round a different one.
export function matchPick(anchors, pick, size = 0) {
  if (!anchors || !anchors.length) return -1;
  const want = pick && pick.near;
  const span = size > 0 ? size : spanOf(anchors);
  if (!want || want.length < 3) {
    return pick && pick.at < anchors.length ? pick.at : -1;
  }
  // EXACTLY WHERE IT WAS beats everything: the shape has not moved and this is
  // the same thing.
  const here = anchors[pick.at];
  if (here && agrees(here, want, span * 1e-3, 0.999)) return pick.at;

  // Then the nearest thing of the same character. Something HAS moved, and
  // whatever is closest and pointing the same way is the best evidence.
  let best = -1, far = span * 0.1;
  anchors.forEach((anchor, i) => {
    if (!agrees(anchor, want, Infinity, 0.86)) return;
    const d = sLen(sSub([anchor[0], anchor[1], anchor[2]], [want[0], want[1], want[2]]));
    if (d < far) { far = d; best = i; }
  });
  if (best >= 0) return best;

  //! AND THEN THE COUNT, which is the strongest evidence there is and was not
  //! being collected.
  //!
  //! OpenCascade enumerates the sub-shapes of a shape in a deterministic
  //! order. If a body has the same NUMBER of edges it had when the pick was
  //! made, the list is the same list and edge 2 is edge 2 - whatever has
  //! happened to its size or its position. A cylinder has three edges at
  //! r = 80 and three at r = 1400; nothing about the ordering has an opinion
  //! about radius.
  //!
  //! That is what a parametric model needs and the two tests below cannot
  //! give: they measure a stored position and a stored length against a shape
  //! that is SUPPOSED to change, so they fail whenever the change is large
  //! enough to matter. Measured on a cap whose cylinder is driven by a top
  //! level radius: at 900 the rim is 5.03 times the length it was picked at
  //! and the size test threw it away; at 200 the body had shrunk and the
  //! position test threw it away. The edge was index 2 of 3 every single time.
  //!
  //! Direction is still asked, because it costs nothing and it is the one
  //! property of an edge that does not care how big the thing is: a rim stays
  //! tangential however wide it gets, and a pick that now lands on the seam
  //! instead is a pick that should be refused.
  if (here && Number.isInteger(pick.count) && pick.count === anchors.length
      && agrees(here, want, Infinity, 0.86, false)) return pick.at;

  // AND THEN THE NUMBER, when it still lands on something of the same
  // character. A box stretched from 80 to 160 moves two of its four uprights
  // eighty millimetres - further than any proximity test should reach - and
  // does not renumber a single edge. The ordering is the only evidence left and
  // it is good evidence: the thing it points at is upright and it is in the
  // same place in the list. Refusing it here would mean a fillet that falls
  // off its own box the first time anybody resizes it.
  // ...but only when the pick is about THIS shape. An anchor nine metres away
  // from a hundred-millimetre block is not an edge that moved, it is a pick
  // from another model, and the ordering of a list it was never about says
  // nothing at all.
  //! MEASURED AGAINST THE BIGGER OF THE TWO SHAPES, not against this one. The
  //! reach used to be 1.5 spans of the shape as it is NOW, which shrinks when
  //! the model shrinks while the stored position does not move - so a cylinder
  //! driven down from 540 to 80 lost a pick that was 495 away from a limit of
  //! 362, and the same pick at the same distance was fine on the way up. The
  //! pick's own half-length says how big the shape was when it was taken; the
  //! reach is generous to whichever of the two is larger.
  //! AND NOT BY SIZE. An edge that grew nine times is what a parametric model
  //! IS - this rule exists for the case where the thing resized, so refusing
  //! it because the thing resized leaves the rule with nothing to do.
  const then = Math.max(span, (want[6] || 0) * 2);
  if (here && agrees(here, want, then * 1.5, 0.86, false)) return pick.at;
  return -1;
}

//! Two anchors describe the same thing when they are in the same place, facing
//! the same way, and about the same size. The direction test is two-sided: an
//! edge has no direction of its own, only a line, and which way round the
//! kernel walked it is not something a file should depend on.
//! \p sized asks the length test as well, which is right when the evidence is
//! PROXIMITY - two edges in the same place pointing the same way are told apart
//! by how long they are - and wrong when the evidence is the ORDERING, where a
//! change of size is the very thing being allowed for.
function agrees(anchor, want, within, along, sized = true) {
  if (sLen(sSub([anchor[0], anchor[1], anchor[2]], [want[0], want[1], want[2]])) > within)
    return false;
  const a = sUnit([anchor[3], anchor[4], anchor[5]]);
  const b = sUnit([want[3], want[4], want[5]]);
  if (sLen(a) && sLen(b) && Math.abs(sDot(a, b)) < along) return false;
  if (!sized) return true;
  const one = anchor[6] || 0, two = want[6] || 0;
  if (one > 0 && two > 0 && (one / two > 4 || two / one > 4)) return false;
  return true;
}

//! How big the thing being picked from is, so a tolerance can be a share of it
//! rather than a number somebody guessed in millimetres.
export function spanOf(anchors) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const a of anchors)
    for (let k = 0; k < 3; k++) {
      if (a[k] < lo[k]) lo[k] = a[k];
      if (a[k] > hi[k]) hi[k] = a[k];
    }
  return Number.isFinite(lo[0]) ? Math.max(1e-6, sLen(sSub(hi, lo))) : 1;
}

//! Every pick in a list, resolved. Says which were found and which were lost,
//! because a driver has to be able to say so rather than silently doing less.
export function resolvePicks(anchors, picks) {
  const found = [], lost = [];
  for (const pick of picks || []) {
    const at = matchPick(anchors, pick, 0);
    if (at < 0) lost.push(pick);
    else if (!found.includes(at)) found.push(at);
  }
  return { found, lost };
}

/* ------------------------------------------------- the tangent walk

   DOUBLE-CLICK AN EDGE AND GET THE WHOLE ARRIS. Every modeller has this,
   everybody uses it, and on a body of any size it is the difference between a
   fillet you can specify and one you give up on: the top of a rounded-corner
   slab is eight edges, and picking them one at a time is eight chances to miss
   one.

   Two edges continue each other when they MEET and their directions AGREE
   there. Both are asked of the polylines, so this works on a spline as well as
   on a line, and it works the same in the page as in the kernel.             */

//! THE ENDS OF A POLYLINE, and which way it points at each of them.
//!
//! Not the first chord. A curve drawn in sixteen segments turns five degrees
//! within its first one, so the chord at the end of an arc is five degrees off
//! the tangent there - which is exactly the size of the angle a tangency test
//! is made of, and it made every arc look like a corner. The second-order
//! estimate over the first two segments, (-3p0 + 4p1 - p2)/2, is the tangent of
//! the parabola through them and is right to within the tessellation.
export function endsOf(points) {
  if (!points || points.length < 2) return null;
  const tangentAt = (a, b, c) => {
    if (!c) return sUnit(sSub(b, a));
    const fitted = sSub(sMul(sSub(b, a), 4), sSub(c, a));
    const way = sUnit(fitted);
    return sLen(way) ? way : sUnit(sSub(b, a));
  };
  const n = points.length;
  return {
    at: [points[0], points[n - 1]],
    way: [tangentAt(points[0], points[1], points[2]),
          tangentAt(points[n - 1], points[n - 2], points[n - 3])],
  };
}

//! HOW A PICK SPREADS, and the reason a fillet survives its cylinder being
//! resized.
//!
//! A pick used to be a list of indices and nothing else. Double-clicking an
//! edge walked the arris at the time of the click and wrote down the eight
//! edges it found - so the SELECTION was stored and the REASON for it was not.
//! Make the cylinder taller and the eight are still eight; split one of them
//! and the fillet rounds seven and says nothing.
//!
//! What CATIA stores instead is the rule. "This edge, and everything tangent
//! to it" is a standing instruction, re-asked of whatever the shape is today,
//! so a face that arrives already belonging to the arris is taken and one that
//! leaves is not missed. The pick is the SEED; the mode is what grows from it.
//!
//!   one       exactly what was picked, which is what this always did
//!   touching  everything that shares a rim with it, whatever the angle
//!   tangent   everything that continues it smoothly, within `angle`
//!
//! Touching and tangent are the same two walks below at different angles -
//! 180 degrees accepts any join at all - which is worth knowing because it
//! means there is one implementation to be wrong in rather than two.
export const PICK_MODES = ["one", "touching", "tangent"];
export const PICK_MODE_LABELS = ["One by one", "Touching", "Tangent"];
export const PICK_ANGLE = 5;

//! The seeds grown by the rule, against the shape as it is NOW. \p parts is
//! the list of polylines for edges or of tessellated faces for faces, in the
//! shape's own order; \p seeds are indices into it.
export function growPicks(kind, parts, seeds, { mode = "one", angle = PICK_ANGLE } = {}) {
  const unique = [...new Set((seeds || []).filter(at => Number.isInteger(at) && at >= 0))];
  if (mode === "one" || !PICK_MODES.includes(mode) || !parts || !parts.length)
    return unique.sort((a, b) => a - b);
  //! 180 degrees is "any join at all", which is what touching means. One walk,
  //! two settings - see above.
  const open = mode === "touching" ? 180 : Math.max(0, angle);
  const grown = new Set(unique);
  for (const seed of unique)
    for (const at of (kind === "face" ? smoothPatch(parts, seed, { angle: open })
                                      : tangentChain(parts, seed, { angle: open })))
      grown.add(at);
  return [...grown].sort((a, b) => a - b);
}

//! Walk out from one edge along everything tangent to it.
//!
//! \p edges is a list of polylines, in the shape's own order. \p angle is how
//! far from straight two edges may be at their join and still count as one
//! arris - five degrees by default, which takes a real tangency and refuses a
//! corner.
export function tangentChain(edges, from, { angle = 5, weld = 0 } = {}) {
  // An edge that is not there takes nothing with it. An index nobody can
  // resolve is a pick that has been lost, and a lost pick selects nothing.
  if (!edges || !edges[from]) return [];
  const cos = Math.cos(Math.max(0, angle) * Math.PI / 180);
  const ends = edges.map(endsOf);
  const near = weld > 0 ? weld : spanOf(edges.map(edgeAnchor)) * 1e-4;
  const chain = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const here = queue.pop();
    const mine = ends[here];
    if (!mine) continue;
    for (let other = 0; other < edges.length; other++) {
      if (chain.has(other) || !ends[other]) continue;
      if (!continues(mine, ends[other], near, cos)) continue;
      chain.add(other);
      queue.push(other);
    }
  }
  return [...chain].sort((a, b) => a - b);
}

//! Do these two meet, and do they agree where they meet?
function continues(one, two, near, cos) {
  for (let a = 0; a < 2; a++)
    for (let b = 0; b < 2; b++) {
      if (sLen(sSub(one.at[a], two.at[b])) > near) continue;
      // The stored direction at an end points INTO the edge, so two edges that
      // continue each other point at each other there: the agreement is with
      // the second one reversed.
      if (-sDot(one.way[a], two.way[b]) >= cos) return true;
      if (sDot(one.way[a], two.way[b]) >= cos) return true;
    }
  return false;
}

//! And the same idea for faces: everything smoothly continuous with the one
//! picked. A cylinder's side is two faces in most kernels and one surface to
//! anybody looking at it, so a draft or a shell that takes only half of it is a
//! draft that has misunderstood the question.
export function smoothPatch(faces, from, { angle = 5 } = {}) {
  if (!faces || !faces[from]) return [];
  const cos = Math.cos(Math.max(0, angle) * Math.PI / 180);
  const patch = new Set([from]);
  const queue = [from];
  const touches = (a, b) => {
    // Sharing a rim: any corner of one within a whisker of a corner of the
    // other. Cheap, and on a tessellation it is exact - the two faces were
    // meshed off the same edge.
    const near = Math.max(a.near[6], b.near[6]) * 1e-3 + 1e-6;
    for (const p of a.rim) for (const q of b.rim)
      if (sLen(sSub(p, q)) <= near) return true;
    return false;
  };
  const rims = faces.map(face => ({
    near: face.near || faceAnchor(face.positions, face.index),
    rim: rimOf(face),
  }));
  while (queue.length) {
    const here = queue.pop();
    for (let other = 0; other < faces.length; other++) {
      if (patch.has(other)) continue;
      const a = rims[here].near, b = rims[other].near;
      if (Math.abs(sDot(sUnit([a[3], a[4], a[5]]), sUnit([b[3], b[4], b[5]]))) < cos
          && sDot(sUnit([a[3], a[4], a[5]]), sUnit([b[3], b[4], b[5]])) < cos) continue;
      if (!touches(rims[here], rims[other])) continue;
      patch.add(other);
      queue.push(other);
    }
  }
  return [...patch].sort((a, b) => a - b);
}

//! A few points off the edge of a face's tessellation - enough to tell whether
//! two faces are neighbours without walking every vertex of both.
function rimOf(face) {
  const out = [];
  const positions = face.positions || [];
  const step = Math.max(1, Math.floor(positions.length / 3 / 48));
  for (let i = 0; i * 3 + 2 < positions.length; i += step)
    out.push([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
  return out;
}
