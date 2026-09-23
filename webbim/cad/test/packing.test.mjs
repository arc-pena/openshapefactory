// Fitting a brief into an envelope.
//
// Two different claims, checked differently. The geometry - volume, section,
// area, does this rectangle fit - is exact, so it is checked against numbers a
// reader can work out on the back of an envelope: a 10 m cube holds 1000 m³, a
// pyramid holds a third of its box, a section halfway up a cone is half as
// wide. The packing is a heuristic, so it is checked against INVARIANTS that
// would break if it were wrong in the ways it is most likely to be wrong -
// rooms overlapping, rooms outside the plate, rooms standing where there is no
// headroom, rooms quietly disappearing.
//
// And the failure that would look like success. A packer that drops what does
// not fit reports a tidy plan and a happy number; the brief is just shorter
// than the one you gave it. So the count going in and the count coming out are
// checked on every run, and there is a test whose whole job is to catch a room
// that went missing.
import { MIN_HEADROOM, STRATEGIES, bandsOf, inRings, meshBounds, meshVolume, packAll,
         parkOf, placeIn, randomFrom, readBrief, rectInRings, reflow, ringArea,
         ringsArea, sampleBrief, sectionAt, segmentHitsBox, shapesFor, stillFits,
         summarise, usableArea, writeBrief } from "../src/packing.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const m2 = mm2 => mm2 / 1e6;

/* Meshes, written out by hand so the numbers in the tests are numbers anybody
   can check rather than numbers this file produced. */
const mesh = (points, faces) => {
  const positions = [], index = [];
  for (const p of points) positions.push(...p);
  for (const f of faces) index.push(...f);
  return { positions, index };
};
//! A box, closed, from one corner to the other.
const boxMesh = (lo, hi) => mesh(
  [[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [lo[0], hi[1], lo[2]],
   [lo[0], lo[1], hi[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]],
  [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
   [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]);
//! A square pyramid on the ground: the sloped-ceiling case the headroom inset
//! exists for.
const pyramid = (half, height) => mesh(
  [[-half, -half, 0], [half, -half, 0], [half, half, 0], [-half, half, 0], [0, 0, height]],
  [[0, 2, 1], [0, 3, 2], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]);

console.log("1. the envelope, measured");
{
  const cube = boxMesh([0, 0, 0], [10000, 10000, 10000]);
  check("a 10 m cube holds 1000 m³", near(meshVolume(cube) / 1e9, 1000, 0.001),
        (meshVolume(cube) / 1e9).toFixed(3) + " m³");
  const tall = boxMesh([0, 0, 0], [20000, 10000, 30000]);
  check("and a 20 by 10 by 30 holds 6000", near(meshVolume(tall) / 1e9, 6000, 0.001));
  // A pyramid is a third of its box, which is the number to check a signed
  // tetrahedron sum against: it is the one an area-only mistake gets wrong.
  const spire = pyramid(5000, 12000);
  check("a pyramid is a third of the box it stands in",
        near(meshVolume(spire) / 1e9, (10 * 10 * 12) / 3, 0.001),
        (meshVolume(spire) / 1e9).toFixed(2) + " m³");
  check("its box is its box", (() => { const b = meshBounds(spire);
    return b.lo[0] === -5000 && b.hi[2] === 12000; })());
  check("nothing has no volume", meshVolume({ positions: [], index: [] }) === 0
        && meshBounds({ positions: [] }) === null);
}

console.log("\n2. the section, cut where it was asked for");
{
  const cube = boxMesh([0, 0, 0], [10000, 8000, 6000]);
  const half = sectionAt(cube, 3000);
  check("a box cuts to one ring", half.length === 1, String(half.length));
  check("and the ring is the footprint", near(m2(ringsArea(half)), 80, 0.01),
        m2(ringsArea(half)).toFixed(2) + " m²");
  check("with the right area either way round", near(Math.abs(ringArea(half[0])) / 1e6, 80, 0.01));

  // Halfway up a pyramid the section is half as wide, so a quarter the area.
  const spire = pyramid(6000, 10000);
  check("halfway up a pyramid the plate is a quarter",
        near(m2(ringsArea(sectionAt(spire, 5000))), (12 * 12) / 4, 0.4),
        m2(ringsArea(sectionAt(spire, 5000))).toFixed(2) + " m² of 144");
  check("and near the top it is nearly nothing",
        m2(ringsArea(sectionAt(spire, 9500))) < 1.2);
  check("above it there is nothing at all", sectionAt(spire, 11000).length === 0);

  // A courtyard is a ring inside a ring, and has to take itself off.
  const donut = { positions: [], index: [] };
  const outer = boxMesh([0, 0, 0], [20000, 20000, 5000]);
  const inner = boxMesh([5000, 5000, -1000], [15000, 15000, 6000]);
  donut.positions = [...outer.positions, ...inner.positions];
  donut.index = [...outer.index, ...inner.index.map(i => i + outer.positions.length / 3)];
  const court = sectionAt(donut, 2500);
  check("a courtyard cuts to two rings", court.length === 2, String(court.length));
  check("and the hole comes off the area", near(m2(ringsArea(court)), 400 - 100, 0.01),
        m2(ringsArea(court)).toFixed(1) + " m² of 400 less 100");
  check("a point in the courtyard is not on the plate", !inRings(court, [10000, 10000]));
  check("a point on the plate is", inRings(court, [2000, 2000]));
}

console.log("\n3. a rectangle is inside, or it is not");
{
  const plate = sectionAt(boxMesh([0, 0, 0], [10000, 10000, 3000]), 1500);
  check("well inside is inside", rectInRings(plate, { x: 1000, y: 1000, w: 2000, h: 2000 }));
  check("hanging over the edge is not",
        !rectInRings(plate, { x: 9000, y: 1000, w: 2000, h: 2000 }));
  check("entirely outside is not",
        !rectInRings(plate, { x: 20000, y: 0, w: 1000, h: 1000 }));
  check("and one that swallows the whole plate is not either",
        !rectInRings(plate, { x: -5000, y: -5000, w: 20000, h: 20000 }),
        "its middle is inside, which is why the edge test is needed as well");

  // The case the middle-only test gets wrong: a room in a courtyard.
  const court = [[[0, 0], [30000, 0], [30000, 30000], [0, 30000]],
                 [[10000, 10000], [20000, 10000], [20000, 20000], [10000, 20000]]];
  check("a room in the middle of a courtyard is not on the plate",
        !rectInRings(court, { x: 13000, y: 13000, w: 4000, h: 4000 }));
  check("a room beside the courtyard is", rectInRings(court, { x: 2000, y: 2000, w: 5000, h: 5000 }));
  check("a room straddling its edge is not",
        !rectInRings(court, { x: 8000, y: 13000, w: 5000, h: 4000 }));

  check("a segment across a box is caught", segmentHitsBox([-5, 5], [15, 5], 0, 0, 10, 10));
  check("one that misses is not", !segmentHitsBox([-5, 50], [15, 50], 0, 0, 10, 10));
  check("one that stops short is not", !segmentHitsBox([-50, 5], [-20, 5], 0, 0, 10, 10));
}

console.log("\n4. storeys, and the headroom that makes a sloped one smaller");
{
  const block = boxMesh([0, 0, 0], [30000, 20000, 11000]);
  const bands = bandsOf(block, { storey: 3500 });
  check("a 11 m block is three storeys at 3.5", bands.length === 3, String(bands.length));
  check("stacked from the bottom", bands[0].z === 0 && near(bands[1].z, 3500, 1)
        && near(bands[2].z, 7000, 1));
  check("each with the whole footprint", near(m2(bands[0].plate), 600, 0.1),
        m2(bands[0].plate).toFixed(1) + " m²");
  check("and on a box the headroom takes nothing off",
        near(m2(bands[0].usable), 600, 6), m2(bands[0].usable).toFixed(1) + " m²");

  // The pyramid is the case. At 1.5 m of headroom the usable part of a storey
  // is the section 1.5 m above its floor, which on a 1:1 slope is inset by
  // 1.5 m all round - a real number, and much smaller than the plate.
  const roof = pyramid(10000, 20000);
  const sloped = bandsOf(roof, { storey: 5000, minHeadroom: 1500 });
  check("a pyramid has storeys too", sloped.length >= 3, String(sloped.length));
  const top = sloped[sloped.length - 1];
  check("the top storey's plate is smaller than the bottom's",
        top.plate < sloped[0].plate * 0.5,
        m2(top.plate).toFixed(1) + " vs " + m2(sloped[0].plate).toFixed(1) + " m²");
  for (const band of sloped)
    check("storey at " + (band.z / 1000) + " m: what you can stand up in is less than the plate",
          band.usable < band.plate,
          m2(band.usable).toFixed(1) + " usable of " + m2(band.plate).toFixed(1) + " m²");
  // And by the amount the slope says. The pyramid is 20 m across and 20 m
  // tall, so its face rises 2 for every 1 it runs in: standing up 1.5 m costs
  // 0.75 m of plate on every side, and the usable square is 18.5 m a side.
  const ground = sloped[0];
  const inset = 1.5 * (10 / 20);
  const guess = (20 - 2 * inset) ** 2;
  check("and by exactly what the slope says",
        near(m2(ground.usable), guess, guess * 0.03),
        m2(ground.usable).toFixed(1) + " m², the slope says " + guess.toFixed(2));
}

console.log("\n5. the brief, read and written");
{
  const rows = readBrief([
    "# a comment", "name, area, height, aspect, priority",
    "Office, 120, 3.0, 1.5, 2", "Store, 20, 2.4, 1, 1", "", "rubbish",
    "Meeting; 35; 3.0; 1.2; 3",
  ].join("\n"));
  check("three rooms, and the header and the rubbish left out", rows.length === 3,
        rows.map(r => r.name).join(", "));
  check("areas come in as square metres and are kept in millimetres",
        rows[0].area === 120e6, String(rows[0].area));
  check("heights too", rows[0].height === 3000);
  check("semicolons work as well as commas", rows[2].name === "Meeting");
  check("what it writes it can read back",
        readBrief(writeBrief(rows)).length === 3
        && near(readBrief(writeBrief(rows))[0].area, 120e6, 1e5));
}

console.log("\n6. packing, and the invariants that say it worked");
{
  const block = boxMesh([0, 0, 0], [30000, 20000, 7500]);
  const bands = bandsOf(block, { storey: 3500 });
  const rows = readBrief(Array.from({ length: 12 },
    (_, i) => "R" + i + ", 40, 3.0, 1.4, 1").join("\n"));
  for (const strategy of STRATEGIES) {
    const out = packAll(bands, rows, { gap: 300, strategy });
    check(strategy + ": nothing is lost", out.placed.length + out.unplaced.length === rows.length,
          out.placed.length + " placed, " + out.unplaced.length + " not, of " + rows.length);
    let bad = 0;
    for (let b = 0; b < bands.length; b++) {
      const here = out.placed.filter(r => r.band === b);
      for (const room of here) {
        if (!rectInRings(bands[b].floor, room)) bad++;
        for (const other of here)
          if (other !== room && room.x < other.x + other.w && other.x < room.x + room.w
              && room.y < other.y + other.h && other.y < room.y + room.h) bad++;
      }
    }
    check(strategy + ": every room is on its plate and no two overlap", bad === 0, String(bad));
    const got = out.placed.reduce((s, r) => s + r.w * r.h, 0);
    check(strategy + ": the area placed is the area asked for, room by room",
          out.placed.every(r => near(r.w * r.h, r.area, r.area * 0.001)),
          m2(got).toFixed(0) + " m² placed");
  }

  // Twelve 40 m² rooms is 480 m² into 600 m² a storey - they should all go in,
  // and mostly on the ground floor.
  const out = packAll(bands, rows, { gap: 300, strategy: "corner" });
  check("twelve 40 m² rooms go into a 600 m² plate", out.unplaced.length === 0,
        out.unplaced.length + " left over");
  check("and the lower storeys fill first",
        out.placed.filter(r => r.band === 0).length >= out.placed.filter(r => r.band === 1).length);

  // The failure that looks like success: ask for more than there is and the
  // ones that do not fit have to come back, not disappear.
  const toomany = readBrief(Array.from({ length: 60 },
    (_, i) => "X" + i + ", 90, 3.0, 1, 1").join("\n"));
  const over = packAll(bands, toomany, { gap: 300 });
  check("asking for more than there is leaves a backlog, not a shorter brief",
        over.placed.length + over.unplaced.length === 60 && over.unplaced.length > 0,
        over.placed.length + " in, " + over.unplaced.length + " out");
  const said = summarise(over, toomany);
  check("and the report counts the same rooms the boxes do",
        said.rooms === 60 && said.placed === over.placed.length
        && said.unplaced === over.unplaced.length);
  check("with the area it got against the area it was asked for",
        said.share > 0 && said.share < 1,
        (said.share * 100).toFixed(0) + "% of " + m2(said.areaAsked).toFixed(0) + " m² asked");

  check("priority goes first", (() => {
    const mixed = readBrief(["Low, 300, 3, 1, 1", "High, 300, 3, 1, 9",
                             "Mid, 300, 3, 1, 5"].join("\n"));
    const small = bandsOf(boxMesh([0, 0, 0], [20000, 20000, 3600]), { storey: 3500 });
    const run = packAll(small, mixed, { gap: 300 });
    return run.placed.length && run.placed[0].name === "High";
  })());

  // A room taller than the storey does not go in the storey.
  const tall = readBrief("Hall, 60, 9.0, 1, 1");
  check("a room too tall for a storey does not squeeze into one",
        packAll(bands, tall, {}).unplaced.length === 1,
        "3.5 m storeys, a 9 m room");
}

console.log("\n7. no headroom, no room - on a shape that has some and not others");
{
  // A pyramid: plenty of floor, almost none of it with 3 m over it near the
  // edge. A packer that ignored the ceiling would fill the whole plate.
  const roof = pyramid(12000, 14000);
  const bands = bandsOf(roof, { storey: 6000, minHeadroom: 1500 });
  const rows = readBrief(Array.from({ length: 8 },
    (_, i) => "Attic" + i + ", 30, 4.5, 1, 1").join("\n"));
  const out = packAll(bands, rows, { gap: 200 });
  let low = 0;
  for (const room of out.placed) {
    const band = bands[room.band];
    // Every placed room must be inside the section at its own head height.
    if (!rectInRings(band.cut(room.height), room)) low++;
  }
  check("not one placed room is under a ceiling lower than it is", low === 0, String(low));
  check("and something did have to be left out on a pointed roof",
        out.placed.length + out.unplaced.length === 8,
        out.placed.length + " placed of 8");
}

console.log("\n8. the sample, which is a demo and says so");
{
  const block = boxMesh([0, 0, 0], [40000, 30000, 12000]);
  const brief = sampleBrief(block, { seed: 7 });
  check("it makes a brief out of an envelope", brief.length > 3, brief.length + " rooms");
  check("named in order", brief[0].name === "Room_01" && brief[1].name === "Room_02");
  check("each room a sensible share of the plate",
        brief.every(r => r.area > 0.01 * 1200e6 && r.area < 0.2 * 1200e6),
        m2(Math.min(...brief.map(r => r.area))).toFixed(0) + " to "
        + m2(Math.max(...brief.map(r => r.area))).toFixed(0) + " m² of a 1200 m² plate");
  check("and a height that fits in a storey",
        brief.every(r => r.height >= MIN_HEADROOM && r.height < 3500));
  check("aspects vary", new Set(brief.map(r => r.aspect)).size > 2);
  check("the same seed gives the same brief",
        JSON.stringify(sampleBrief(block, { seed: 7 })) === JSON.stringify(brief));
  check("a different seed does not",
        JSON.stringify(sampleBrief(block, { seed: 8 })) !== JSON.stringify(brief));

  // Bigger envelope, more rooms - the count falls out of the space.
  const bigger = sampleBrief(boxMesh([0, 0, 0], [80000, 60000, 12000]), { seed: 7 });
  check("a bigger envelope asks for more rooms", bigger.length > brief.length,
        bigger.length + " vs " + brief.length);
  check("nothing at all makes no brief", sampleBrief({ positions: [], index: [] }, {}).length === 0);

  // And it has to actually pack - a sample that does not is a demo that shows
  // an empty building.
  const run = packAll(bandsOf(block, { storey: 3500 }), brief, { gap: 300 });
  check("and the sample it made really does mostly go in",
        run.placed.length > brief.length * 0.5,
        run.placed.length + " of " + brief.length + " placed");
}

console.log("\n9. the reflow, which is the point of it being parametric");
{
  const small = boxMesh([0, 0, 0], [20000, 12000, 7200]);
  const rows = readBrief(Array.from({ length: 10 },
    (_, i) => "R" + i + ", 55, 3.0, 1.3, 1").join("\n"));
  const first = packAll(bandsOf(small, { storey: 3500 }), rows, { gap: 400 });
  check("some of the brief does not fit in the small envelope", first.unplaced.length > 0,
        first.placed.length + " in, " + first.unplaced.length + " out");

  // The architect pulls the envelope wider. What was placed must not move.
  const grown = boxMesh([0, 0, 0], [40000, 24000, 7200]);
  const after = reflow(first, bandsOf(grown, { storey: 3500 }), { gap: 400 });
  check("nothing is lost across a reflow",
        after.placed.length + after.unplaced.length === 10,
        after.placed.length + " in, " + after.unplaced.length + " out");
  check("the backlog goes in when the envelope grows",
        after.unplaced.length < first.unplaced.length,
        first.unplaced.length + " outstanding before, " + after.unplaced.length + " after");
  const same = first.placed.every(before => {
    const now = after.placed.find(r => r.name === before.name);
    return now && now.x === before.x && now.y === before.y && now.band === before.band;
  });
  check("and NOT ONE of the rooms that was already placed moved", same,
        "a study that rearranges itself on every edit cannot be steered");
  check("what moved is said out loud",
        after.moved.length === first.unplaced.length - after.unplaced.length
        && after.moved.every(m => m.from === "unplaced" && m.to === "placed"),
        JSON.stringify(after.moved.map(m => m.name)));

  // And the other way: the envelope shrinks under rooms that were placed.
  const shrunk = boxMesh([0, 0, 0], [12000, 8000, 7200]);
  const back = reflow(after, bandsOf(shrunk, { storey: 3500 }), { gap: 400 });
  check("nothing is lost when it shrinks either",
        back.placed.length + back.unplaced.length === 10);
  check("rooms the envelope no longer covers are evicted rather than left hanging",
        back.unplaced.length > after.unplaced.length,
        after.unplaced.length + " before, " + back.unplaced.length + " after shrinking");
  check("and every room still placed is really still on its plate", (() => {
    const bands = bandsOf(shrunk, { storey: 3500 });
    return back.placed.every(r => bands[r.band]
      && rectInRings(bands[r.band].floor, r) && rectInRings(bands[r.band].cut(r.height), r));
  })());
  check("the evictions are reported too",
        back.moved.some(m => m.from === "placed" && m.to === "unplaced"),
        JSON.stringify(back.moved));

  // A ceiling coming down is an eviction too, and it is the one a plan-only
  // packer never notices.
  const squat = boxMesh([0, 0, 0], [40000, 24000, 2000]);
  const low = reflow(after, bandsOf(squat, { storey: 3500 }), { gap: 400 });
  check("a ceiling dropped under a 3 m room evicts it",
        low.placed.length === 0 && low.unplaced.length === 10,
        low.placed.length + " still placed under a 2 m envelope");
}

console.log("\n10. the ones that did not fit, parked where they can be seen");
{
  const bounds = meshBounds(boxMesh([0, 0, 0], [20000, 20000, 10000]));
  const left = readBrief(["A, 40, 3, 1, 1", "B, 60, 3, 1, 1", "C, 30, 3, 1, 1"].join("\n"));
  const park = parkOf(bounds, left, { gap: 2000 });
  check("every one of them gets a place to stand", park.length === 3);
  check("beside the envelope, not in it", park.every(p => p.x > bounds.hi[0]),
        "x from " + Math.round(Math.min(...park.map(p => p.x))));
  check("and on the ground", park.every(p => p.z === bounds.lo[2]));
  check("not on top of each other", (() => {
    for (let i = 0; i < park.length; i++)
      for (let j = i + 1; j < park.length; j++) {
        const a = park[i], b = park[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return false;
      }
    return true;
  })());
  check("each keeps its own area", park.every(p => near(p.w * p.h, p.area, p.area * 0.001)));
  check("nothing to park is nothing drawn", parkOf(bounds, [], {}).length === 0);
}

console.log("\n11. rough while it moves, right when it stops - and never for ever");
{
  const block = boxMesh([0, 0, 0], [40000, 28000, 14000]);
  const rows = readBrief(Array.from({ length: 60 },
    (_, i) => "R" + i + ", 55, 3.0, 1.3, 1").join("\n"));

  // The coarse pass is the same pack with a wider net. It has to be FASTER and
  // it has to give an answer of the same kind - not a different building.
  const fine = packAll(bandsOf(block, { storey: 3500 }), rows, { gap: 300 });
  const rough = packAll(bandsOf(block, { storey: 3500, quick: true }), rows,
                        { gap: 300, quick: true });
  check("the rough pass places about as much as the fine one",
        Math.abs(rough.placed.length - fine.placed.length) <= fine.placed.length * 0.25,
        rough.placed.length + " rough vs " + fine.placed.length + " fine");
  check("and it is still a real answer - nothing overlaps, nothing is off the plate",
        (() => {
          const bands = bandsOf(block, { storey: 3500 });
          for (let b = 0; b < bands.length; b++) {
            const here = rough.placed.filter(r => r.band === b);
            for (const room of here) {
              if (!rectInRings(bands[b].floor, room)) return false;
              for (const other of here)
                if (other !== room && room.x < other.x + other.w && other.x < room.x + room.w
                    && room.y < other.y + other.h && other.y < room.y + room.h) return false;
            }
          }
          return true;
        })());
  check("and nothing is lost either way",
        rough.placed.length + rough.unplaced.length === 60
        && fine.placed.length + fine.unplaced.length === 60);

  // The budget. A brief that cannot be packed must not be able to take the
  // page with it: every room gets a bounded number of tries and then joins the
  // backlog, which is where it was going anyway.
  const hopeless = readBrief(Array.from({ length: 300 },
    (_, i) => "X" + i + ", 900, 3.0, 1, 1").join("\n"));
  const started = Date.now();
  const out = packAll(bandsOf(block, { storey: 3500 }), hopeless, { gap: 300 });
  const took = Date.now() - started;
  check("three hundred rooms that cannot fit still comes back, quickly", took < 3000,
        took + " ms");
  check("and says so rather than placing them", out.unplaced.length > 250,
        out.placed.length + " placed, " + out.unplaced.length + " not");
  check("nothing lost even then", out.placed.length + out.unplaced.length === 300);

  // A budget of one is the extreme case: it must still be honest.
  const starved = packAll(bandsOf(block, { storey: 3500 }), rows, { gap: 300, budget: 1 });
  check("a budget of one tries one place and admits it could not",
        starved.placed.length + starved.unplaced.length === 60
        && starved.unplaced.length > 0,
        starved.placed.length + " placed on a budget of one try");
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
