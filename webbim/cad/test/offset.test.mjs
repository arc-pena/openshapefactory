// Parallel curves, measured.
//
// An offset is the easiest thing in this program to check on paper and one of
// the easiest to get subtly wrong, because "which side is positive" has no
// natural answer for an open curve and OpenCascade does not use one convention
// for both cases. So the numbers here are all derivable first:
//
//   a circle of r offset by d is a circle of r+d          2*pi*(r+d)
//   ANY simple closed curve offset outward by d gains     2*pi*d
//   a rectangle w x h offset by d with ROUND corners      2(w+h) + 2*pi*d
//   the same with SHARP corners                           2(w+h) + 8d
//   an L of a+b offset outward by d, round corner         a + b + 2*pi*d/4
//   the same, sharp                                       a + b + 2d
//
// and the one that started this: an arc of a circle has to move the same way
// the whole circle does. It did not - r100 offset by +25 came back at r75
// while the circle came back at r125 - and a setback that grows one curve and
// shrinks the next is not usable.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { readFileSync } from "fs";

const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const init = (await import(DIR + "/replicad_single.js")).default;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

const kernel = await createWasmKernel({ initModule: init,
                                        wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                      select: () => {}, selected: () => null });
await mdl.run({ op: "model", model: { format: "ocaf-parametric-model", version: 1,
                                      name: "Offsets", units: "mm", features: [] } });
const at = async id => (await kernel.tree()).tree.features.find(f => f.id === id);
const add = async (type, more = {}) => (await mdl.run({ op: "add", type, ...more })).id;
const set = (id, key, value) => mdl.run({ op: "set", id, key, value });

const PT = await add("Point");
const VZ = await add("Vector"); await set(VZ, "dx", 0); await set(VZ, "dz", 1);
const PL = await add("Plane", { refs: { origin: PT, normal: VZ } });
const RULE = await add("Measure"); await set(RULE, "quantity", 0);
const lengthOf = async id => {
  await kernel.setReference(RULE, "shape", id, false, true);
  const e = await at(RULE);
  return e && e.data ? Number(e.data.preview) : NaN;
};
const drawn = async (name, elements) => {
  const id = await add("Sketch", { refs: { plane: PL }, name });
  await kernel.setSketch(id, "drawing", { elements, constraints: [] });
  return id;
};
//! One offset node per case rather than one reused: a case that fails should
//! not leave the next one reading its error.
//! `join` defaults to null and not to 0, because 0 IS a setting - Rounded -
//! and `if (join)` skipped it. Every case that asked for rounded corners got
//! whatever the catalogue's default was, which for a long time happened to be
//! rounded, and the day the default became Sharp five checks went red at once
//! having been checking nothing.
const offset = async (curve, distance, { join = null, support = null } = {}) => {
  const id = await add("ParallelCurve",
                       { refs: { curve, ...(support ? { support } : {}) } });
  await set(id, "distance", distance);
  if (join != null) await set(id, "join", join);
  const entry = await at(id);
  return { id, error: entry.error || null, note: entry.note || "",
           length: entry.error ? NaN : await lengthOf(id) };
};

//! HOW FAR THE OFFSET ACTUALLY IS FROM ITS SOURCE, everywhere along it.
//!
//! The length identities below are exact for a circle, a rectangle and an
//! ellipse, and they are NOT exact for a spline: the offset of a B-spline is
//! not a B-spline, so OpenCascade approximates it, and a closed spline offset
//! by 20 gains 119.5 where the turning says 125.7 - five per cent out on the
//! gain, which is one per cent of the length. SetApprox(true) does not change
//! it; that is simply the kernel's accuracy here.
//!
//! So for every curve that has no closed-form answer, this is the check
//! instead, and it is the better one anyway: an offset is supposed to be a
//! given distance away from what it came from, and that is measurable directly
//! whatever the curve is. Measured off the drawn polylines, whose own sag on
//! these sizes is under a thousandth of a millimetre.
const polylineOf = async id => {
  const picks = await kernel.picks(id, "edge");
  const runs = [];
  for (const item of (picks.items || [])) {
    const run = [];
    for (let i = 0; i + 2 < (item.lines || []).length; i += 3)
      run.push([item.lines[i], item.lines[i + 1], item.lines[i + 2]]);
    if (run.length > 1) runs.push(run);
  }
  return runs;
};
const toSegment = (p, a, b) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = len2 > 0
    ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2)) : 0;
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
};
const strayed = async (offsetId, sourceId, want) => {
  const from = await polylineOf(sourceId), to = await polylineOf(offsetId);
  if (!from.length || !to.length) return { worst: NaN, points: 0 };
  let worst = 0, points = 0;
  for (const run of to) {
    //! The very ends of an open offset sit off the ends of the source, where
    //! the nearest point is round a corner - so one point at each end is left
    //! out WHEN there are points to spare. A curve that draws as two points
    //! has none to spare, and dropping both left nothing to judge at all,
    //! which read as a pass with no measurement behind it.
    const trim = run.length > 4 ? 1 : 0;
    for (let i = trim; i < run.length - trim; i++) {
      let near = Infinity;
      for (const other of from)
        for (let j = 0; j + 1 < other.length; j++)
          near = Math.min(near, toSegment(run[i], other[j], other[j + 1]));
      worst = Math.max(worst, Math.abs(near - Math.abs(want)));
      points++;
    }
  }
  return { worst, points };
};

const TWO_PI = 2 * Math.PI;

console.log("1. a circle, both ways");
{
  const c = await add("Circle", { refs: { plane: PL } });
  await set(c, "radius", 100);
  const out = await offset(c, 50), inn = await offset(c, -50);
  check("+50 makes r150", near(out.length, TWO_PI * 150, 0.01), String(out.length));
  check("-50 makes r50", near(inn.length, TWO_PI * 50, 0.01), String(inn.length));
}

console.log("\n2. corners, which is the setting this was missing");
{
  const rect = await drawn("Rect", [{ id: "r1", type: "rect", a: [-100, -60], b: [100, 60] }]);
  const round = await offset(rect, 30, { join: 0 });
  const sharp = await offset(rect, 30, { join: 1 });
  check("rounded adds a full circle of the distance",
        near(round.length, 640 + TWO_PI * 30, 0.01), String(round.length));
  check("sharp runs the sides on until they meet",
        near(sharp.length, 640 + 8 * 30, 0.01), String(sharp.length));
  check("and they are different answers", Math.abs(round.length - sharp.length) > 50,
        round.length + " vs " + sharp.length);
  check("the note says which was used", /sharp corners/.test(sharp.note), sharp.note);

  //! An INSIDE corner has nothing to round: the two offset sides already meet.
  //! Both settings have to agree there, and a setting that changed the answer
  //! would be rounding something that is not a corner.
  const inward = await offset(rect, -30, { join: 0 });
  const inSharp = await offset(rect, -30, { join: 1 });
  check("inside corners measure the same either way",
        near(inward.length, 400, 0.01) && near(inSharp.length, 400, 0.01),
        inward.length + " / " + inSharp.length);
}

console.log("\n3. an arc has to move the way its circle moves");
{
  const arc = await drawn("Arc", [{ id: "a1", type: "arc", c: [0, 0], r: 100,
                                    a0: 0, a1: Math.PI / 2 }]);
  const out = await offset(arc, 25), inn = await offset(arc, -25);
  check("+25 on a quarter of r100 gives r125",
        near(out.length, (Math.PI / 2) * 125, 0.01), String(out.length));
  check("-25 gives r75", near(inn.length, (Math.PI / 2) * 75, 0.01), String(inn.length));
}

console.log("\n4. any closed curve gains exactly 2*pi*d");
{
  const blob = await drawn("Blob", [{ id: "s1", type: "spline", closed: true,
                                      pts: [[0, 0], [150, -40], [220, 80], [60, 140]] }]);
  const got = await offset(blob, 20);
  const off = await strayed(got.id, blob, 20);
  check("a closed spline offsets, and stays 20 from its source all the way round",
        off.points >= 3 && off.worst < 0.6,
        off.points + " points, worst " + off.worst.toFixed(4) + " mm off 20");

  const ring = await drawn("Ring", [{ id: "e1", type: "ellipse", c: [0, 0], rx: 150, ry: 90,
                                      rot: 0, a0: 0, a1: TWO_PI }]);
  const wasE = await lengthOf(ring);
  const gotE = await offset(ring, 20);
  check("and so does an ellipse", near(gotE.length - wasE, TWO_PI * 20, 1.5),
        (gotE.length - wasE).toFixed(3));
}

console.log("\n5. an open chain");
{
  const ids = [];
  for (const [x, y] of [[0, 0], [200, 0], [200, 150]]) {
    const p = await add("Point");
    await set(p, "x", x); await set(p, "y", y); await set(p, "z", 0);
    ids.push(p);
  }
  const ell = await add("Polyline");
  for (const p of ids) await kernel.setReference(ell, "points", p);
  const round = await offset(ell, 20, { join: 0 });
  const sharp = await offset(ell, 20, { join: 1 });
  check("an L, rounded, adds a quarter circle",
        near(round.length, 350 + TWO_PI * 20 / 4, 0.01), String(round.length));
  check("an L, sharp, adds the two run-ons",
        near(sharp.length, 350 + 2 * 20, 0.01), String(sharp.length));
  check("the note says it is open", /open/.test(round.note), round.note);
}

console.log("\n6. a straight run needs to be told which way is sideways");
{
  const a = await add("Point"); await set(a, "x", 0); await set(a, "y", 0); await set(a, "z", 0);
  const b = await add("Point"); await set(b, "x", 300); await set(b, "y", 0); await set(b, "z", 0);
  const line = await add("Line", { refs: { from: a, to: b } });
  await set(line, "kind", 1);
  const alone = await offset(line, 40);
  check("on its own it is refused, in words",
        !!alone.error && /every plane through it/.test(alone.error), alone.error || "(built)");
  //! The support used to make no difference at all here: the only road to a
  //! normal was a sketch's own frame, and a Line has none - so wiring the
  //! plane, which is the documented fix, changed nothing.
  const held = await offset(line, 40, { support: PL });
  check("with a plane wired in it offsets, and keeps its length",
        !held.error && near(held.length, 300, 0.01), held.error || String(held.length));
}

console.log("\n7. every kind of curve, and more than one run at a time");
{
  const cases = [
    ["a rounded rectangle node", async () => {
      const r = await add("Rectangle", { refs: { plane: PL } });
      await set(r, "width", 200); await set(r, "height", 120); await set(r, "radius", 20);
      return r;
      //! Offset by 20, like the rest of this list: the straights are unchanged
      //! and the r20 corners become r40.
    }, 2 * 160 + 2 * 80 + TWO_PI * 40],
    ["an open spline", () => drawn("Open", [{ id: "s1", type: "spline", closed: false,
       pts: [[0, 0], [80, 60], [180, 20], [260, 90]] }]), null],
    ["a line and an arc chained", () => drawn("Chain",
       [{ id: "l1", type: "line", a: [-150, 0], b: [0, 0] },
        { id: "a1", type: "arc", c: [0, 80], r: 80, a0: -Math.PI / 2, a1: 0 }]), null],
    ["an interpolated curve", async () => {
      //! Gently curved on purpose. The four points this used to use put a
      //! 0.09 mm radius of curvature into the fitted curve - a near cusp -
      //! and NO offset of more than 0.09 mm can stay a constant distance from
      //! that. The offset was right; the test case was not.
      const ids = [];
      for (const [x, y] of [[0, 0], [140, 60], [300, 70], [420, 20]]) {
        const p = await add("Point");
        await set(p, "x", x); await set(p, "y", y); await set(p, "z", 0);
        ids.push(p);
      }
      const it = await add("Interpolate");
      for (const p of ids) await kernel.setReference(it, "points", p);
      return it;
    }, null],
    ["two separate runs in one sketch", () => drawn("Two",
       [{ id: "r1", type: "rect", a: [-200, -60], b: [-60, 60] },
        { id: "c1", type: "circle", c: [150, 0], r: 60 }]), null],
  ];
  for (const [label, make, want] of cases) {
    const src = await make();
    //! ROUNDED ON PURPOSE, because the check below is that every part of the
    //! answer is 20 from its source, and only a rounded corner has that
    //! property. A mitred corner is meant to leave the constant distance -
    //! the mitre on a right angle stands 20*sqrt(2) - 20 = 8.2843 mm further
    //! out than the arc would, and measuring that as error is measuring the
    //! setting rather than the offset. Sharp has its own section, and its own
    //! identity: two run-ons per corner.
    const got = await offset(src, 20, { join: 0 });
    //! Either it offsets well or it says why not. What is NOT allowed is the
    //! third thing: a curve that came back nowhere near the distance asked for
    //! with a note saying all was well.
    check(label + " offsets", !got.error, got.error || got.note);
    if (got.error) continue;
    if (want != null)
      check("  and measures what it should", near(got.length, want, 0.05),
            got.length + " vs " + want);
    //! TWO MEASURES, AND THE NODE'S OWN IS THE PRECISE ONE. It measures
    //! against the real curve; this one measures between two DRAWN polylines,
    //! whose chords cut the corners, so on a curve that draws as sixteen
    //! points it over-reports by most of a millimetre. So where the node has
    //! reported a number, that is what is held to account - a hundredth of the
    //! distance - and the polyline measure is the coarse guard behind it.
    const said = /([\d.]+) mm off the distance asked for/.exec(got.note);
    if (said)
      check("  and it says how far off it is, which is within a hundredth",
            Number(said[1]) < 20 * 0.01, said[1] + " mm off 20");
    const off = await strayed(got.id, src, 20);
    check("  and every part of it is about 20 from the source",
          off.points >= 3 && off.worst < 1.0,
          off.points + " drawn points, worst " + off.worst.toFixed(4) + " mm off");
  }
  const both = await offset(await drawn("Pair",
    [{ id: "r1", type: "rect", a: [-200, -60], b: [-60, 60] },
     { id: "c1", type: "circle", c: [150, 0], r: 60 }]), 20);
  check("both runs come back, not one", /2 runs/.test(both.note), both.note);
}

console.log("\n8. a plane that is not the XY plane");
{
  const vx = await add("Vector"); await set(vx, "dx", 1); await set(vx, "dz", 0);
  const side = await add("Plane", { refs: { origin: PT, normal: vx } });
  const id = await add("Sketch", { refs: { plane: side }, name: "OnEdge" });
  await kernel.setSketch(id, "drawing", { elements: [
    { id: "r1", type: "rect", a: [-100, -60], b: [100, 60] }], constraints: [] });
  const got = await offset(id, 30, { join: 0 });
  check("a sketch on a side plane offsets in its own plane",
        near(got.length, 640 + TWO_PI * 30, 0.01), got.error || String(got.length));
}

console.log("\n9. within a surface, which is what a support is for");
{
  //! BRepOffsetAPI_MakeOffset's face constructor TRAPS in this build - every
  //! form of it, probed - so this goes the sampled-and-projected road instead.
  //! The check is that the answer is on the surface and the right distance
  //! along it, measured off the built curve rather than taken on trust.
  const profile = await drawn("HalfRound", [{ id: "a1", type: "arc", c: [0, 0], r: 200,
                                              a0: 0, a1: Math.PI }]);
  const wall = await add("Extrude", { refs: { profile, direction: VZ } });
  await set(wall, "distance", 300); await set(wall, "cap", 1);
  check("the wall builds", !(await at(wall)).error, (await at(wall)).error);

  const got = await offset(profile, 60, { support: wall });
  check("the arc offsets within the wall", !got.error, got.error || got.note);
  check("and keeps its length, because it only moved up a cylinder",
        near(got.length, Math.PI * 200, 0.5), String(got.length));
  check("the note says it used the support",
        /within its support/.test(got.note), got.note);

  const picks = await kernel.picks(got.id, "edge");
  const pts = [];
  for (const item of (picks.items || []))
    for (let i = 0; i + 2 < (item.lines || []).length; i += 3)
      pts.push([item.lines[i], item.lines[i + 1], item.lines[i + 2]]);
  check("it is drawn at all", pts.length > 8, String(pts.length));
  let offSurface = 0, offAlong = 0;
  for (const [x, y, z] of pts) {
    offSurface = Math.max(offSurface, Math.abs(Math.hypot(x, y) - 200));
    offAlong = Math.max(offAlong, Math.abs(z - 60));
  }
  //! 0.01 mm on a 200 mm radius is the tessellation's own chord, not the curve.
  check("every point of it is on the cylinder", offSurface < 0.01, offSurface.toFixed(6));
  check("and 60 along it, which is the distance asked for",
        offAlong < 0.01, offAlong.toFixed(6));

  //! A curve that is nowhere near its support cannot be offset within it, and
  //! saying which is wrong beats "cannot be offset".
  const loose = await drawn("Elsewhere", [{ id: "c1", type: "circle",
                                            c: [4000, 4000], r: 50 }]);
  const away = await offset(loose, 20, { support: wall });
  check("a curve off its support is refused, and told how far off it is",
        !!away.error && /not on its support/.test(away.error),
        away.error || ("built: " + away.note));
}

console.log("\n10. a curve that cannot hold the distance says so");
{
  //! WHETHER A CURVE CAN BE OFFSET IS A QUESTION ABOUT ITS CURVATURE, and
  //! nothing else. An offset at distance d exists wherever the radius of
  //! curvature is bigger than d; where it dips below, the two sides of the
  //! bend cross and there is no curve that stays d away.
  //!
  //! This section used to assert a refusal for a curve whose minimum radius,
  //! measured, is 37.831 mm - offset by 20. That is not a curve that cannot
  //! hold the distance; it is a curve that holds it comfortably. What was
  //! being refused was the old sampled road's knot, caught by the length
  //! bound, on a curve the kernel offsets exactly. So the case moved to one
  //! where the premise is true and the number is on the page.
  const made = async pts => {
    const ids = [];
    for (const [x, y] of pts) {
      const p = await add("Point");
      await set(p, "x", x); await set(p, "y", y); await set(p, "z", 0);
      ids.push(p);
    }
    const it = await add("Interpolate");
    //! CLEARED FIRST. Adding the node auto-wires a guess into Points, and the
    //! four this case means to interpolate then go in AFTER it - so the curve
    //! ran through five points, the first of them twice, and a repeated point
    //! is a CUSP. No offset of any distance exists at a cusp, which is what
    //! "the worst point is 19.0453 mm off 20" was telling us for a long time
    //! before anybody read it as the curve's fault rather than the offset's.
    await kernel.setReference(it, "points", null, true);
    for (const p of ids) await kernel.setReference(it, "points", p);
    return it;
  };
  //! An S through four points. Minimum radius of curvature 37.831 mm, at 0.33
  //! along - so an offset of 20 exists everywhere, and because the S turns as
  //! far one way as the other its total turning is nil and the offset comes
  //! back the SAME LENGTH as the source. Both are checked, because a length
  //! that matches for the wrong reason is the kind of thing that hides here.
  const ess = await made([[0, 0], [120, 90], [260, 20], [380, 110]]);
  const esLen = await lengthOf(ess);
  const easy = await offset(ess, 20);
  check("a curve whose tightest bend is wider than the distance offsets",
        !easy.error, easy.error || easy.note);
  check("  and an S, turning as far back as forward, keeps its length",
        near(easy.length, esLen, 0.05), easy.length + " vs " + esLen);
  check("  and says nothing about straying, because it does not",
        !/off the distance asked for/.test(easy.note), easy.note);
  //! A HAIRPIN: out 100, across 8, back 100. Minimum radius 0.936 mm at the
  //! turn. Offset INTO the hairpin by 20 and there is nothing to find - the
  //! two sides are 8 apart and the turn is a millimetre wide - and the kernel
  //! says so by handing back nothing, which is the refusal this section is
  //! about.
  const pin = await made([[0, 0], [100, 0], [100, 8], [0, 8]]);
  const tight = await offset(pin, -20);
  check("a curve that cannot hold the distance is refused rather than faked",
        !!tight.error, tight.error || ("built: " + tight.note));
  //! And it says WHICH side, because the hairpin has plenty of room on the
  //! outside - it is only the inside, eight millimetres across, that has none.
  //! A refusal that says "try a smaller distance" when the answer is "try the
  //! other side" sends somebody looking for a number that does not exist.
  check("  and the refusal says which side, and what to type instead",
        /THAT side/.test(tight.error || "") && /try 20\b/.test(tight.error || ""),
        tight.error || "");
  //! And a distance it CAN hold comes back normally.
  const small = await offset(pin, 0.5);
  check("a distance inside the tightest bend still offsets",
        !small.error, small.error || small.note);
}

console.log("\n11. against a drawing somebody else made");
{
  //! THE ONE CHECK IN THIS FILE THAT DID NOT COME FROM THIS PROGRAM.
  //!
  //! A centreline and its offsets, drawn in other software and handed over as
  //! two DXFs: one open six-vertex polyline, and seven offsets of it at
  //! +/-100, +/-200, +/-300 and +400. Every offset has SIX vertices, the same
  //! as the source, which says what kind of corner was asked for - a mitred
  //! one, each pair of offset runs carried on until they meet. That is the
  //! Sharp setting here.
  //!
  //! It is worth more than every identity above it put together, because
  //! those are all checks of this program against arithmetic this program
  //! also wrote. This one is a check against a drawing made somewhere else by
  //! somebody who was not thinking about any of it.
  const CENTRE = [[-7283.2690, -3179.0102], [-6377.3663, -2755.5244],
                  [-5154.8934, -3125.4871], [-4594.1617, -2604.6280],
                  [-4722.9162, -2216.6743], [-5330.4564, -2121.6567]];
  const REFERENCE = {
    "400": [[-7113.8746, -3541.3713], [-6346.6794, -3182.7276], [-5050.9352, -3574.8648],
            [-4133.5254, -2722.6903], [-4420.1116, -1859.1697], [-5268.6488, -1726.4607]],
    "300": [[-7156.2232, -3450.7811], [-6354.3511, -3075.9268], [-5076.9248, -3462.5204],
            [-4248.6845, -2693.1747], [-4495.8127, -1948.5458], [-5284.1007, -1825.2597]],
    "200": [[-7198.5718, -3360.1908], [-6362.0228, -2969.1260], [-5102.9143, -3350.1760],
            [-4363.8435, -2663.6591], [-4571.5139, -2037.9220], [-5299.5526, -1924.0587]],
    "100": [[-7240.9204, -3269.6005], [-6369.6945, -2862.3252], [-5128.9039, -3237.8316],
            [-4479.0026, -2634.1436], [-4647.2150, -2127.2981], [-5315.0045, -2022.8577]],
    "-100": [[-7325.6175, -3088.4200], [-6385.0380, -2648.7236], [-5180.8830, -3013.1427],
             [-4709.3208, -2575.1124], [-4798.6174, -2306.0505], [-5345.9083, -2220.4556]],
    "-200": [[-7367.9661, -2997.8297], [-6392.7097, -2541.9228], [-5206.8725, -2900.7983],
             [-4824.4799, -2545.5969], [-4874.3185, -2395.4266], [-5361.3602, -2319.2546]],
    "-300": [[-7410.3147, -2907.2394], [-6400.3814, -2435.1220], [-5232.8621, -2788.4539],
             [-4939.6389, -2516.0813], [-4950.0197, -2484.8028], [-5376.8121, -2418.0536]],
  };
  //! Drawn as five lines end to end, which is what a polyline IS in the
  //! sketcher and what the DXF holds. The ends are given exactly, so the
  //! chain welds without a gap.
  const line = await drawn("Centreline", CENTRE.slice(0, -1).map((a, i) =>
    ({ id: "c" + i, type: "line", a, b: CENTRE[i + 1] })));
  let worstAnywhere = 0, built = 0;
  for (const [said, reference] of Object.entries(REFERENCE)) {
    const distance = Number(said);
    //! join 1 is Sharp - see JOINS in the factory.
    const got = await offset(line, distance, { join: 1 });
    if (got.error) { check("offset at " + said + " builds", false, got.error); continue; }
    built++;
    const drawnRuns = (await polylineOf(got.id)).flat();
    let worst = 0;
    for (const want of reference) {
      let nearest = Infinity;
      for (const p of drawnRuns)
        nearest = Math.min(nearest, Math.hypot(p[0] - want[0], p[1] - want[1]));
      worst = Math.max(worst, nearest);
    }
    worstAnywhere = Math.max(worstAnywhere, worst);
    //! A hundredth of a millimetre on a drawing 3100 mm across, and the
    //! vertices are only written to four decimal places in the file. What it
    //! actually measures is zero.
    check("the offset at " + said + " lands on the drawn one",
          worst < 0.01, "worst vertex " + worst.toFixed(6) + " mm out");
  }
  check("all seven offsets built", built === 7, built + " of 7");
  check("and the worst vertex across all seven is under a hundredth",
        worstAnywhere < 0.01, worstAnywhere.toFixed(6) + " mm");
}

console.log("\n12. the two sides run out at different distances");
{
  //! AWAY FROM A CURVE THERE IS NO LIMIT. INTO IT THERE IS, and they are not
  //! the same number - so "this distance is too big" is never a fact about a
  //! curve, only about a curve AND a side.
  //!
  //! Offsetting outward, every bend opens: the answer gains d times the total
  //! turning and that is the whole of it, at any d you like. Offsetting
  //! inward, the bends close, and the moment the inside of a turn is nearer
  //! than d the two sides of it cross and there is no such curve.
  //!
  //! This open four-segment polyline is the one that came in as a bug report.
  //! Which way OpenCascade calls positive on it happens to be the INWARD
  //! side, and inward it runs out past about 400. The program asked for that
  //! side first, got nothing, and reported "it turns tighter than 831
  //! somewhere along it" - true of the side nobody asked for. Outward, 831
  //! was sitting right there.
  const RUN = [[0, 0], [69, -433], [-551.5, -497], [-733, 564.5], [261.5, 712.5]];
  const ids = [];
  for (const [x, y] of RUN) {
    const p = await add("Point");
    await set(p, "x", x); await set(p, "y", y); await set(p, "z", 0);
    ids.push(p);
  }
  const run = await add("Polyline");
  await kernel.setReference(run, "points", null, true);
  for (const p of ids) await kernel.setReference(run, "points", p);
  const RUN_LENGTH = await lengthOf(run);
  check("the polyline is as long as it is drawn",
        near(RUN_LENGTH, 3144.612, 0.01), String(RUN_LENGTH));
  //! The identity: an OPEN curve offset outward by d gains d times its total
  //! turning, which for a polyline is the sum of the angles it turns through.
  //! Nothing approximate about it, and it holds at every distance.
  let turning = 0;
  for (let i = 1; i + 1 < RUN.length; i++) {
    const a = [RUN[i][0] - RUN[i - 1][0], RUN[i][1] - RUN[i - 1][1]];
    const b = [RUN[i + 1][0] - RUN[i][0], RUN[i + 1][1] - RUN[i][1]];
    turning += Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
  }
  check("and turns through what the arithmetic says",
        near(turning, 4.722679, 1e-5), turning.toFixed(6) + " rad");
  //! 831 is the number from the report. 2000 is there because "no limit"
  //! means no limit, and a bound that only shows up at three times the
  //! reported distance is still a bound.
  for (const d of [200, 400, 831, 2000]) {
    const got = await offset(run, d, { join: 0 });
    check("outward by " + d + " builds", !got.error, got.error || got.note);
    if (got.error) continue;
    check("  and gains exactly " + d + " times the turning",
          near(got.length, RUN_LENGTH + d * turning, 0.05),
          got.length + " vs " + (RUN_LENGTH + d * turning).toFixed(3));
  }
  //! And the other side really does run out, so the refusal is not just
  //! switched off. It has to say WHICH side, and what to type instead.
  const inward = await offset(run, -831, { join: 0 });
  check("inward by 831 is refused, because that side has no offset",
        !!inward.error, inward.error || ("built: " + inward.note));
  check("  and the refusal names the side and the distance that works",
        /THAT side/.test(inward.error || "") && /try 831/.test(inward.error || ""),
        inward.error || "");
  //! Inward still works where there IS room, which is the check that the
  //! refusal is about the geometry and not about the sign.
  const close = await offset(run, -200, { join: 0 });
  check("inward by 200 builds, because there is room for it",
        !close.error, close.error || close.note);
  check("  and loses length rather than gaining it",
        close.length < RUN_LENGTH, close.length + " vs " + RUN_LENGTH);
}

console.log("\n13. nothing asked for, nothing done");
{
  const c = await add("Circle", { refs: { plane: PL } });
  await set(c, "radius", 100);
  const got = await offset(c, 0);
  check("a zero offset hands the curve back rather than failing",
        !got.error && near(got.length, TWO_PI * 100, 0.01), got.error || String(got.length));
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
