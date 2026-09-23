// Fitting a brief into a massing envelope.
//
// The oldest question in the first week of a project: here is a shape the site
// and the planners will allow, and here is a list of rooms with areas against
// them - does it go in, and if it does, what is left over? Answering it by
// hand is an afternoon of section-cutting and arithmetic, and the answer
// changes the moment somebody pulls a face.
//
// So this does the afternoon, and it does it again every time the envelope
// moves.
//
//   1. CUT the envelope into storeys and take the horizontal section at each
//      floor. That section is the shape of the floor plate, holes and all.
//   2. INSET it for headroom. A sloped or curved envelope has floor you cannot
//      stand up in: the usable part of a storey is where the section at your
//      feet and the section at your head both agree there is space. That is
//      what makes a room in the top of a pitched roof smaller than the plate it
//      sits on, and it is the difference between a massing study and a drawing.
//   3. PACK the brief into what is left, room by room, largest and highest
//      priority first, without overlaps and with a gap between.
//
// WHAT KIND OF NUMBER EACH OF THESE IS, which is the only thing that matters
// when somebody quotes one in a meeting:
//
//   COMPUTED. The volume of the envelope, the section at any height, the area
//   of any floor plate, whether a rectangle fits inside one, whether two rooms
//   overlap. These are geometry on the model's own triangles and they are
//   exact to the tessellation.
//
//   A HEURISTIC, and a stated one. WHERE each room goes. Packing rectangles
//   into an arbitrary polygon optimally is NP-hard and nobody does it exactly;
//   what is here is bottom-left, shelf and centre-out placement, which are the
//   three that architects draw by hand, and they are offered as options rather
//   than as an answer because which one is right is a question about the
//   building. A run says how much it placed, not that no better run exists.
//
//   NOT MEASURED, because there is nothing to measure. No cost, no structure,
//   no code compliance. A room that fits here fits geometrically and says
//   nothing about whether it may be built.
//
// Nothing in this file knows about OpenCascade, three.js or the DOM. It takes
// triangles and a list of rooms and gives back where they went, so every number
// in it can be checked without a browser.

/* ------------------------------------------------------------ the envelope */

//! How much space is inside a closed mesh, by the divergence theorem: every
//! triangle with the origin makes a tetrahedron, and the signed volumes of
//! them all cancel to what is enclosed. Exact for a closed surface, and for an
//! open one it is the volume of the cone the surface makes with the origin -
//! which is why what it is handed matters and the sign is kept rather than
//! taken away.
export function meshVolume(mesh) {
  const p = mesh && mesh.positions, ix = mesh && mesh.index;
  if (!p || !ix) return 0;
  let six = 0;
  for (let t = 0; t + 2 < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    six += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
         - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
         + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return Math.abs(six) / 6;
}

//! The box it lives in.
export function meshBounds(mesh) {
  const p = mesh && mesh.positions;
  if (!p || p.length < 3) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < p.length; i += 3)
    for (let a = 0; a < 3; a++) {
      if (p[i + a] < lo[a]) lo[a] = p[i + a];
      if (p[i + a] > hi[a]) hi[a] = p[i + a];
    }
  return Number.isFinite(lo[0]) ? { lo, hi } : null;
}

//! The horizontal section of a mesh at a height: the outline of the floor
//! plate there, and the outlines of any holes in it.
//!
//! Every triangle that straddles the plane crosses it in one segment. Collect
//! the segments and chain them end to end and the rings fall out - no winding
//! rules, no orientation to get wrong, because what is inside is decided
//! afterwards by counting crossings rather than by which way a ring was drawn.
//! A lightwell comes out as a ring inside a ring and is a hole for exactly that
//! reason.
export function sectionAt(mesh, z, weld = 0.5) {
  const p = mesh && mesh.positions, ix = mesh && mesh.index;
  if (!p || !ix) return [];
  const at = i => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const cut = (a, b) => {
    const t = (z - a[2]) / (b[2] - a[2]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const segments = [];
  for (let t = 0; t + 2 < ix.length; t += 3) {
    const v = [at(ix[t]), at(ix[t + 1]), at(ix[t + 2])];
    const hits = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      // Strictly straddling. A vertex sitting exactly on the plane would
      // otherwise be found twice, once from each edge that meets there, and
      // chain into a spur that goes nowhere.
      if ((a[2] < z && b[2] >= z) || (b[2] < z && a[2] >= z)) hits.push(cut(a, b));
    }
    if (hits.length === 2 && (hits[0][0] !== hits[1][0] || hits[0][1] !== hits[1][1]))
      segments.push(hits);
  }
  return chainRings(segments, weld);
}

//! Segments into rings. Ends that land within \p weld of each other are the
//! same end - a tessellation writes the same corner twice with the last bit of
//! a float between them, and a wire will not close over that.
export function chainRings(segments, weld = 0.5) {
  const key = p => Math.round(p[0] / weld) + "," + Math.round(p[1] / weld);
  const ends = new Map();
  const add = (k, i) => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); };
  segments.forEach((seg, i) => { add(key(seg[0]), i); add(key(seg[1]), i); });

  const used = new Uint8Array(segments.length);
  const rings = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const ring = [segments[start][0], segments[start][1]];
    // Forward from the loose end until it comes back, or runs out.
    for (;;) {
      const here = key(ring[ring.length - 1]);
      const next = (ends.get(here) || []).find(i => !used[i]);
      if (next === undefined) break;
      used[next] = 1;
      const seg = segments[next];
      ring.push(key(seg[0]) === here ? seg[1] : seg[0]);
      if (key(ring[ring.length - 1]) === key(ring[0])) break;
    }
    // Two points are a line, not a ring. Three that are the same point are not
    // a ring either, and both come out of a section that grazes a corner.
    if (ring.length > 3 && Math.abs(ringArea(ring)) > weld * weld) rings.push(ring);
  }
  return rings;
}

//! Twice the signed area of a ring, halved - the shoelace. Signed, because the
//! sign is what tells a ring drawn one way from one drawn the other, even
//! though nothing here needs it to decide what is inside.
export function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

//! The area a set of rings encloses: the outlines less the holes. Even-odd, so
//! a courtyard inside a plate takes itself off however the rings were wound.
export function ringsArea(rings) {
  // Each ring counts positive when it is inside an even number of others (an
  // outline) and negative when it is inside an odd number (a hole).
  let total = 0;
  for (let i = 0; i < rings.length; i++) {
    let depth = 0;
    const probe = rings[i][0];
    for (let j = 0; j < rings.length; j++)
      if (j !== i && inRing(rings[j], probe)) depth++;
    total += (depth % 2 ? -1 : 1) * Math.abs(ringArea(rings[i]));
  }
  return Math.max(0, total);
}

//! Is a point inside one ring? The ray-crossing test, counted to the right.
export function inRing(ring, p) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1])
        && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

//! And inside a floor plate, which is a set of rings: inside an odd number of
//! them. A ring inside a ring is a hole, and a ring inside that is an island in
//! the hole, and this counts all of it without being told which is which.
export function inRings(rings, p) {
  let count = 0;
  for (const ring of rings) if (inRing(ring, p)) count++;
  return (count & 1) === 1;
}

//! Is a whole rectangle inside the plate? Two questions, and both are needed:
//! its middle has to be in, and no edge of the plate may cross it. The first
//! alone would put a room half out over a balcony; the second alone would be
//! happy with a room in the middle of a courtyard, which has no edges over it
//! at all.
export function rectInRings(rings, rect, nip = 1) {
  // A millimetre off every side before the edges are asked about. A room
  // against the outside wall IS the outside wall - it is the commonest thing
  // in a plan - and without this the section's own edge counts as crossing it
  // and nothing can ever be put against a wall. A millimetre in a model in
  // millimetres is below the tessellation; what it buys is that flush works.
  const x0 = rect.x + nip, y0 = rect.y + nip;
  const x1 = rect.x + rect.w - nip, y1 = rect.y + rect.h - nip;
  if (x1 <= x0 || y1 <= y0) return false;
  if (!inRings(rings, [(x0 + x1) / 2, (y0 + y1) / 2])) return false;
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++)
      if (segmentHitsBox(ring[i], ring[(i + 1) % ring.length], x0, y0, x1, y1)) return false;
  return true;
}

//! Does a segment touch a box? Liang-Barsky: clip the segment against the four
//! slabs and see whether anything is left.
export function segmentHitsBox(a, b, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const clip = (p, q) => {
    if (p === 0) return q >= 0;                 // parallel: in or out, no cut
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, a[0] - x0) && clip(dx, x1 - a[0])
      && clip(-dy, a[1] - y0) && clip(dy, y1 - a[1]);
}

/* ------------------------------------------------------------- the storeys */

//! How low a ceiling may be before the floor under it stops being floor.
//! 1.5 m is the usual line in a roof space - the point below which an area is
//! commonly not counted at all - and it is a SETTING rather than a rule,
//! because which line applies is a question about where you are building.
export const MIN_HEADROOM = 1500;

//! The envelope cut into storeys, each with the shape of its floor plate.
//!
//! The section is taken a hair ABOVE the floor level, never on it. A box cut
//! exactly across its own base is cut through the triangles of that base, and
//! what comes back is either nothing or a ring of noise - the one case that
//! looks like an empty building rather than like a bug.
export function bandsOf(mesh, { storey = 3500, minHeadroom = MIN_HEADROOM, base = null,
                                weld = 0.5, quick = false } = {}) {
  const box = meshBounds(mesh);
  if (!box || !(storey > 0)) return [];
  const bottom = base === null ? box.lo[2] : base;
  const top = box.hi[2];
  const lift = Math.max(1, (top - bottom) * 1e-4);
  const bands = [];
  for (let z = bottom; z + minHeadroom < top; z += storey) {
    const floor = sectionAt(mesh, z + lift, weld);
    if (!floor.length) continue;
    //! The section at any height above this floor, worked out when something
    //! asks and kept - a brief has three or four distinct room heights in it,
    //! not three hundred, so this is a handful of cuts rather than one per
    //! candidate position.
    const cuts = new Map();
    const band = {
      z, top: Math.min(z + storey, top), storey, minHeadroom, floor, quick,
      plate: ringsArea(floor),
      cut(height) {
        const at = Math.round(Math.max(minHeadroom, height));
        if (!cuts.has(at)) cuts.set(at, sectionAt(mesh, z + lift + at, weld));
        return cuts.get(at);
      },
    };
    // The headroom inset, which is the whole reason a sloped envelope is
    // harder than a box: the part of this plate you can stand up in.
    band.head = band.cut(minHeadroom);
    band.usable = usableArea(band);
    bands.push(band);
  }
  return bands;
}

//! How much of a plate you could actually stand on, sampled. There is no
//! closed form for the intersection of two arbitrary polygons without a
//! clipper, and a clipper is a large thing to get subtly wrong; a grid of
//! probes is approximate in a way that is easy to state - the answer is within
//! a cell of the truth - and it is only ever used to SAY how much room there
//! is, never to decide whether something fits. That decision is exact.
export function usableArea(band, samples = 120) {
  if (band.quick) samples = 40;
  const box = ringsBounds(band.floor);
  if (!box) return 0;
  const w = box.hi[0] - box.lo[0], h = box.hi[1] - box.lo[1];
  const step = Math.max(w, h) / samples;
  if (!(step > 0)) return 0;
  let inside = 0, total = 0;
  for (let y = box.lo[1] + step / 2; y < box.hi[1]; y += step)
    for (let x = box.lo[0] + step / 2; x < box.hi[0]; x += step) {
      total++;
      if (inRings(band.floor, [x, y]) && inRings(band.head, [x, y])) inside++;
    }
  return total ? (inside / total) * w * h : 0;
}

export function ringsBounds(rings) {
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const ring of rings)
    for (const p of ring) {
      if (p[0] < lo[0]) lo[0] = p[0];
      if (p[1] < lo[1]) lo[1] = p[1];
      if (p[0] > hi[0]) hi[0] = p[0];
      if (p[1] > hi[1]) hi[1] = p[1];
    }
  return Number.isFinite(lo[0]) ? { lo, hi } : null;
}

/* --------------------------------------------------------------- the brief */

//! A room, as a brief writes one. Area in square millimetres because the whole
//! model is in millimetres and a second unit in one program is a bug waiting
//! for somebody to be tired.
export function readBrief(text) {
  const rows = [];
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const said = line.trim();
    if (!said || said.startsWith("#")) continue;
    const parts = said.split(/\s*[,;\t]\s*/);
    // A header line names its columns; it is not a room.
    if (/^(name|room|space)$/i.test(parts[0])) continue;
    const name = parts[0];
    const area = Number(parts[1]);
    if (!name || !Number.isFinite(area) || area <= 0) continue;
    const height = Number(parts[2]);
    const aspect = Number(parts[3]);
    const priority = Number(parts[4]);
    rows.push({
      name,
      area: area * 1e6,                                  // m² in the file, mm² here
      height: Number.isFinite(height) && height > 0 ? height * 1000 : 0,
      aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1.4,
      priority: Number.isFinite(priority) ? priority : 1,
    });
  }
  return rows;
}

//! And back out again, so what the Sample button made can be read, edited and
//! kept like anything anybody typed.
export function writeBrief(rows) {
  return ["# name, area m2, height m, aspect, priority",
          ...rows.map(r => [r.name, (r.area / 1e6).toFixed(1), (r.height / 1000).toFixed(2),
                            r.aspect.toFixed(2), r.priority].join(", "))].join("\n");
}

//! A repeatable little random. Seeded on purpose: a Sample you cannot get back
//! is a demo you cannot show twice and a test you cannot write.
export function randomFrom(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

//! A brief invented to fit the envelope in front of you.
//!
//! Not a real brief and it does not pretend to be one: it is a scatter of
//! rooms sized against the plate so the packing can be seen working on
//! whatever shape somebody has just pulled, without them first having to write
//! a schedule of accommodation. The count falls out of the space rather than
//! being asked for - a bigger envelope gets more rooms, which is the behaviour
//! that makes it useful on an odd shape.
export function sampleBrief(mesh, { seed = 1, storey = 3500, minHeadroom = MIN_HEADROOM,
                                    fill = 0.55, smallest = 0.05, biggest = 0.18,
                                    least = 20e6, most = 400e6 } = {}) {
  const bands = bandsOf(mesh, { storey, minHeadroom });
  if (!bands.length) return [];
  const random = randomFrom(seed);
  const between = (lo, hi) => lo + random() * (hi - lo);
  // What there is to fill: every storey's usable plate, less a little, because
  // a brief that exactly equals the space available always packs badly and
  // tells you nothing.
  const room = bands.reduce((sum, band) => sum + band.usable, 0) * fill;
  const plate = bands[0].usable || bands[0].plate;
  const headroom = Math.min(storey - 300, Math.max(minHeadroom, storey * 0.75));
  const rows = [];
  let asked = 0;
  while (asked < room && rows.length < 400) {
    // A share of the plate, but still a ROOM. Without the second clamp a site
    // twice the size asks for rooms twice the size and the same number of
    // them, which is not a bigger brief, it is the same brief in a bigger
    // typeface - and the whole use of this is to see how the count behaves as
    // the envelope grows.
    const area = Math.max(least, Math.min(most, plate * between(smallest, biggest)));
    if (area < 4e6) break;                               // under 4 m² is a cupboard
    rows.push({
      name: "Room_" + String(rows.length + 1).padStart(2, "0"),
      area,
      height: Math.round(between(minHeadroom * 1.4, headroom) / 100) * 100,
      aspect: Math.round(between(0.6, 2.4) * 100) / 100,
      priority: 1 + Math.floor(random() * 3),
    });
    asked += area;
  }
  return rows;
}

/* ------------------------------------------------------------- the packing */

//! Where the rooms go.
//!
//! Three strategies, because there is no right one and the three are the three
//! an architect draws by hand:
//!
//!   corner   bottom-left. Every room goes as far into the corner as it will
//!            go, against what is already there. Densest on an irregular
//!            plate, and what you would do with a floor of cellular offices.
//!   rows     shelf. A row across, then the next row above it. Loses area on a
//!            curved edge and gains a circulation grain that reads as a plan.
//!   centre   out from the middle. Keeps a compact core and leaves the ragged
//!            edge of the plate as the leftover, which is what a tower wants.
//!
//! None of them is optimal and none of them can be: packing rectangles into a
//! polygon is NP-hard. What a run says is how much IT placed.
export const STRATEGIES = ["corner", "rows", "centre"];

//! The shape of a room on the plan, from its area and how square it is asked
//! to be. Both ways round, because a room that will not go across will often
//! go up - and which of the two is tried first is the orientation setting.
export function shapesFor(row, { orientation = "either" } = {}) {
  const w = Math.sqrt(row.area * row.aspect), h = row.area / w;
  const wide = { w, h }, tall = { w: h, h: w };
  if (orientation === "wide") return [wide];
  if (orientation === "tall") return [tall];
  return Math.abs(w - h) < 1 ? [wide] : [wide, tall];
}

const overlaps = (a, b, gap) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap
  && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

//! Somewhere on this plate a rectangle of this size will go, or nothing.
//!
//! The candidate positions are what makes the three strategies differ; the
//! test at each of them is the same and it is exact - inside the floor, inside
//! the section at the room's own head height, and clear of everything already
//! placed by at least the gap.
function findSpot(band, size, taken, { gap = 0, grain = 0, strategy = "corner",
                                       height = 0, quick = false, budget = 20000 } = {}) {
  const box = ringsBounds(band.floor);
  if (!box) return null;
  const ceiling = band.cut(height || band.minHeadroom);
  // How finely the plate is walked. Half a room while a hand is still moving,
  // a quarter of one when it has stopped: the coarse pass is for watching the
  // massing change and the fine one is for the answer.
  const part = quick ? 2 : 4;
  const step = grain > 0 ? grain : Math.max(250, Math.min(size.w, size.h) / part);
  let tried = 0;
  const fits = (x, y) => {
    // A budget, so a brief nobody could pack cannot take the page with it. A
    // room that runs out of tries goes to the backlog, which is where a room
    // that does not fit goes anyway - so the worst this can do is be pessimistic,
    // never wrong about a room it did place.
    if (++tried > budget) return false;
    const rect = { x, y, w: size.w, h: size.h };
    if (near.hits(rect, gap)) return false;
    if (!rectInRings(band.floor, rect)) return false;
    if (!rectInRings(ceiling, rect)) return false;
    return true;
  };
  //! What is already on this storey, on a grid, so "does this overlap anything"
  //! is a look at the few squares under it rather than a walk of everything
  //! placed so far. Two hundred rooms is forty thousand comparisons a candidate
  //! position without it, and that is where a slow pack goes.
  const near = neighbourhood(taken, box, Math.max(step * 2, 2000));

  const xs = new Set(), ys = new Set();
  for (let x = box.lo[0]; x <= box.hi[0] - size.w + step; x += step) xs.add(x);
  for (let y = box.lo[1]; y <= box.hi[1] - size.h + step; y += step) ys.add(y);
  if (!xs.size || !ys.size) return null;
  // Against what is already there as well as against the grid: a room sitting
  // exactly beside its neighbour is the whole of what bottom-left is for, and
  // a grid alone would leave a gap of up to one step between every pair.
  if (strategy !== "rows")
    for (const other of taken) {
      xs.add(other.x + other.w + gap); xs.add(other.x - size.w - gap);
      ys.add(other.y + other.h + gap); ys.add(other.y - size.h - gap);
    }
  const useX = [...xs].filter(v => v >= box.lo[0] - step && v <= box.hi[0] + step)
    .sort((a, b) => a - b);
  const useY = [...ys].filter(v => v >= box.lo[1] - step && v <= box.hi[1] + step)
    .sort((a, b) => a - b);

  if (strategy === "centre") {
    // The nearest to the middle, found by walking rather than by sorting every
    // pair of coordinates into a list first.
    const mid = [(box.lo[0] + box.hi[0]) / 2, (box.lo[1] + box.hi[1]) / 2];
    let best = null, nearest = Infinity;
    for (const y of useY) for (const x of useX) {
      const away = Math.hypot(x + size.w / 2 - mid[0], y + size.h / 2 - mid[1]);
      if (away >= nearest) continue;
      if (!fits(x, y)) continue;
      nearest = away; best = { x, y };
    }
    return best;
  }
  // corner and rows: lowest, then leftmost. Sorted ONCE, by walking the two
  // axes in order - which is the same answer the old cross-product-and-sort
  // gave for a great deal less work.
  for (const y of useY) for (const x of useX) if (fits(x, y)) return { x, y };
  return null;
}

//! A uniform grid over what is already placed. Only ever asked one question -
//! is anything within \p gap of this rectangle - and only ever looks in the
//! squares the rectangle actually touches.
function neighbourhood(taken, box, cell) {
  const wide = Math.max(1, Math.ceil((box.hi[0] - box.lo[0]) / cell) + 2);
  const deep = Math.max(1, Math.ceil((box.hi[1] - box.lo[1]) / cell) + 2);
  const cells = new Map();
  const key = (i, j) => i * 100000 + j;
  const at = (x, y) => [Math.floor((x - box.lo[0]) / cell) + 1,
                        Math.floor((y - box.lo[1]) / cell) + 1];
  const clamp = (v, hi) => Math.max(0, Math.min(hi - 1, v));
  const span = (rect, pad) => {
    const [i0, j0] = at(rect.x - pad, rect.y - pad);
    const [i1, j1] = at(rect.x + rect.w + pad, rect.y + rect.h + pad);
    return [clamp(i0, wide), clamp(j0, deep), clamp(i1, wide), clamp(j1, deep)];
  };
  for (const room of taken) {
    const [i0, j0, i1, j1] = span(room, 0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = key(i, j);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(room);
    }
  }
  return {
    hits(rect, gap) {
      const [i0, j0, i1, j1] = span(rect, gap);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const here = cells.get(key(i, j));
        if (!here) continue;
        for (const other of here) if (overlaps(rect, other, gap)) return true;
      }
      return false;
    },
  };
}

//! One room into one storey, or a plain no.
//!
//! \p beaten is what has already been proved not to fit on this storey, and it
//! is the difference between a pack that takes a fifth of a second and one
//! that takes two. Proving a room does not fit is the expensive case - every
//! candidate position on the plate has to be tried and rejected - and a room
//! no smaller than one that has already failed, in BOTH directions, cannot fit
//! either: the storey only ever gets fuller. So it is not tried.
export function placeIn(band, row, taken, options = {}, beaten = null) {
  const height = row.height || band.minHeadroom;
  // A room taller than the storey does not go in the storey. Saying so is
  // better than quietly squashing it, which is what an area-only packer does.
  if (height > band.top - band.z + 1) return null;
  for (const size of shapesFor(row, options)) {
    if (beaten && beaten.some(was => size.w >= was.w - 1 && size.h >= was.h - 1
                                     && height >= was.height - 1)) continue;
    const spot = findSpot(band, size, taken, { ...options, height });
    if (spot) return { x: spot.x, y: spot.y, w: size.w, h: size.h, z: band.z, height };
    if (beaten) beaten.push({ ...size, height });
  }
  return null;
}

//! The whole brief into the whole envelope.
//!
//! Highest priority first, and within a priority the biggest first, because a
//! big room left to last never goes in anywhere - which is the one thing every
//! hand-packing rule agrees on. Lower storeys before higher ones, because that
//! is how a building fills.
export function packAll(bands, rows, options = {}) {
  const order = rows.map((row, at) => ({ ...row, at })).sort(
    (a, b) => (b.priority - a.priority) || (b.area - a.area) || (a.at - b.at));
  const taken = bands.map(() => []);
  const beaten = bands.map(() => []);
  const placed = [], unplaced = [];
  for (const row of order) {
    let landed = null;
    for (let b = 0; b < bands.length; b++) {
      const spot = placeIn(bands[b], row, taken[b], options, beaten[b]);
      if (!spot) continue;
      taken[b].push(spot);
      landed = { ...row, status: "placed", band: b, ...spot };
      break;
    }
    if (landed) placed.push(landed);
    else unplaced.push({ ...row, status: "unplaced", band: -1 });
  }
  return { placed, unplaced, taken };
}

/* -------------------------------------------------------------- the reflow */

//! Is a room that was placed still placed, now the envelope has moved?
export function stillFits(band, room, others, options = {}) {
  if (!band) return false;
  const height = room.height || band.minHeadroom;
  if (height > band.top - band.z + 1) return false;
  const rect = { x: room.x, y: room.y, w: room.w, h: room.h };
  if (!rectInRings(band.floor, rect)) return false;
  if (!rectInRings(band.cut(height), rect)) return false;
  const gap = options.gap || 0;
  for (const other of others) if (other !== room && overlaps(rect, other, gap)) return false;
  return true;
}

//! The envelope changed. Pack again - but not from nothing.
//!
//! A massing study that rearranged itself every time somebody nudged a face
//! would be unusable: you would never be able to tell what your edit did,
//! because everything moved. So what was placed and is STILL valid stays
//! exactly where it is, and only two kinds of room are packed:
//!
//!   the backlog   what never fitted. Tried FIRST, and against the space that
//!                 has just appeared - the common edit is "make it bigger
//!                 because that did not fit", and the reward for it should be
//!                 the thing that did not fit going in.
//!   the evicted   what was placed and no longer is, because the envelope
//!                 shrank under it, or the ceiling came down, or a face moved
//!                 through it. Those go back to the ground with the backlog
//!                 and queue with it.
export function reflow(before, bands, options = {}) {
  const was = [...(before.placed || []), ...(before.unplaced || [])];
  const taken = bands.map(() => []);
  const kept = [], backlog = [], evicted = [];

  // Keep first, in the order they were placed, so an earlier room never loses
  // its spot to a later one on a re-pack.
  for (const room of before.placed || []) {
    const band = bands[room.band];
    if (band && stillFits(band, room, taken[room.band], options)) {
      taken[room.band].push(room);
      kept.push(room);
    } else evicted.push({ ...room, status: "unplaced", band: -1, was: room.band });
  }

  // The backlog, unplaced first and then the evicted, biggest first inside
  // each so the hard ones get the new space rather than the easy ones.
  const bySize = (a, b) => (b.priority - a.priority) || (b.area - a.area);
  const queue = [...(before.unplaced || []).map(r => ({ ...r })).sort(bySize),
                 ...evicted.sort(bySize)];
  const placed = [...kept], unplaced = [];
  const beaten = bands.map(() => []);
  const moved = [];
  for (const row of queue) {
    let landed = null;
    for (let b = 0; b < bands.length; b++) {
      const spot = placeIn(bands[b], row, taken[b], options, beaten[b]);
      if (!spot) continue;
      taken[b].push(spot);
      landed = { ...row, status: "placed", band: b, ...spot };
      break;
    }
    if (landed) { placed.push(landed); moved.push({ name: row.name, from: "unplaced", to: "placed" }); }
    else {
      unplaced.push({ ...row, status: "unplaced", band: -1 });
      if (row.was !== undefined) moved.push({ name: row.name, from: "placed", to: "unplaced" });
    }
  }
  return { placed, unplaced, taken, moved, was: was.length };
}

/* ------------------------------------------------- what came of it, and where */

//! The rooms that did not go in, parked on the ground beside the envelope.
//!
//! NOT thrown away and not hidden. A brief that half fits is the normal answer
//! and the half that did not is the finding: it is what the next edit is for.
//! So they are laid out in rows off the side of the footprint, on the ground,
//! where they are obviously not part of the massing and obviously still there.
export function parkOf(bounds, rows, { gap = 2000 } = {}) {
  if (!bounds) return [];
  const startX = bounds.hi[0] + gap * 2;
  const depth = Math.max(bounds.hi[1] - bounds.lo[1], 1);
  const out = [];
  let x = startX, y = bounds.lo[1], run = 0;
  for (const row of rows) {
    const w = Math.sqrt(row.area * (row.aspect || 1)), h = row.area / Math.max(w, 1);
    if (y > bounds.lo[1] && y + h > bounds.lo[1] + depth) { y = bounds.lo[1]; x += run + gap; run = 0; }
    out.push({ ...row, x, y, w, h, z: bounds.lo[2], height: row.height || 0, parked: true });
    y += h + gap;
    run = Math.max(run, w);
  }
  return out;
}

//! The report, read off the same list the boxes are drawn from - so the number
//! on the panel and the grey box on the ground can never disagree.
export function summarise(result, rows) {
  const placed = result.placed || [], unplaced = result.unplaced || [];
  const got = placed.reduce((sum, r) => sum + r.w * r.h, 0);
  const asked = (rows || [...placed, ...unplaced]).reduce((sum, r) => sum + r.area, 0);
  return {
    rooms: placed.length + unplaced.length,
    placed: placed.length,
    unplaced: unplaced.length,
    areaPlaced: got,
    areaAsked: asked,
    share: asked > 0 ? got / asked : 0,
  };
}
