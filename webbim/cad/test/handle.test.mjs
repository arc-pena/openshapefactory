// The number under the hand.
//
// Two claims are being made and both can be checked without a browser. The
// first is arithmetic: a ruler dragged along an axis reads millimetres in the
// model, a point dropped on a curve lands ON the curve, a face says which way
// it looks. The second is the table - which argument each feature leads with -
// and that one is checked against the real catalogue, because a row naming an
// argument that does not exist is a slider that comes up empty under somebody's
// cursor.
import { LEADS, RULERS, faceWay, leadFor, lineWay, middleOf, nearestOnEdges,
         onPlane, rulerAt, vUnit } from "../src/handle.js";
import { CATALOGUE } from "../src/ocaf.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const close = (a, b, tol = 1e-6) => Array.isArray(a) && a.length === b.length
  && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const spec = type => CATALOGUE.find(t => t.type === type);

console.log("1. a ruler reads millimetres in the model, not pixels on the screen");
{
  // Looking down -Z from above at a vertical axis through the origin. A ray
  // aimed at a point 40 mm up the axis reads 40 mm, whatever else is true.
  const up = [0, 0, 1];
  check("a ray straight at a point on the axis reads where that point is",
        near(rulerAt([300, 0, 40], [-1, 0, 0], [0, 0, 0], up), 40),
        String(rulerAt([300, 0, 40], [-1, 0, 0], [0, 0, 0], up)));
  check("and further up reads further up",
        near(rulerAt([300, 0, 125], [-1, 0, 0], [0, 0, 0], up), 125));
  check("below the anchor it goes negative",
        near(rulerAt([300, 0, -60], [-1, 0, 0], [0, 0, 0], up), -60));
  check("it is measured from the anchor, not from the world",
        near(rulerAt([300, 0, 40], [-1, 0, 0], [0, 0, 100], up), -60),
        "40 mm up, from an anchor at 100, is 60 below it");
  // A skew ray still has one nearest point, which is what makes a drag smooth
  // rather than jumping about as the cursor crosses the axis.
  check("a skew ray reads its own closest approach",
        near(rulerAt([300, 200, 70], [-1, -0.5, 0], [0, 0, 0], up), 70, 1e-6));
  check("a ray ALONG the axis invents nothing",
        rulerAt([0, 0, 500], [0, 0, -1], [0, 0, 0], up) === 0);
  check("a longer axis vector does not change the answer",
        near(rulerAt([300, 0, 40], [-1, 0, 0], [0, 0, 0], [0, 0, 9]), 40),
        "the ruler is in model units, not in multiples of the direction");
}

console.log("\n2. a ray meets a plane where it meets it");
{
  check("straight down onto the ground", close(onPlane([10, 20, 500], [0, 0, -1],
        [0, 0, 0], [0, 0, 1]), [10, 20, 0]));
  check("at an angle, further across", close(onPlane([0, 0, 100], [1, 0, -1],
        [0, 0, 0], [0, 0, 1]), [100, 0, 0]));
  check("onto a plane that is not through the origin",
        close(onPlane([10, 20, 500], [0, 0, -1], [0, 0, 60], [0, 0, 1]), [10, 20, 60]));
  check("and nothing at all when it runs along the plane",
        onPlane([0, 0, 50], [1, 0, 0], [0, 0, 0], [0, 0, 1]) === null);
}

console.log("\n3. a point dropped on a curve lands on the curve");
{
  // A polyline up the X axis, as the viewport draws one: pairs of ends.
  const edges = [0, 0, 0, 100, 0, 0, 100, 0, 0, 200, 0, 0, 200, 0, 0, 300, 0, 0];
  const found = nearestOnEdges(edges, [150, 200, 0], [0, -1, 0]);
  check("it lands where the ray crosses it", close(found.at, [150, 0, 0], 1e-6),
        JSON.stringify(found.at));
  check("and says how far along the whole run that is", near(found.t, 0.5, 1e-6),
        String(found.t));
  check("and how near the ray passed", near(found.gap, 0, 1e-6));

  const start = nearestOnEdges(edges, [-90, 200, 0], [0, -1, 0]);
  check("a drag past the start stops at the start",
        close(start.at, [0, 0, 0], 1e-6) && near(start.t, 0, 1e-9),
        JSON.stringify(start.at) + " t=" + start.t);
  const end = nearestOnEdges(edges, [900, 200, 0], [0, -1, 0]);
  check("and past the end, at the end",
        close(end.at, [300, 0, 0], 1e-6) && near(end.t, 1, 1e-9));

  const off = nearestOnEdges(edges, [150, 200, 70], [0, -1, 0]);
  check("a ray that misses says how far it missed by", near(off.gap, 70, 1e-6),
        String(off.gap));
  check("nothing to land on is nothing", nearestOnEdges([], [0, 0, 0], [0, 0, -1]) === null);

  // Length along the run, not along one segment: a bent curve still reads a
  // half as a half.
  const bent = [0, 0, 0, 0, 100, 0, 0, 100, 0, 100, 100, 0];
  check("a bent run measures the whole of itself",
        near(nearestOnEdges(bent, [0, 100, 500], [0, 0, -1]).t, 0.5, 1e-6),
        String(nearestOnEdges(bent, [0, 100, 500], [0, 0, -1]).t));
}

console.log("\n4. a drawn thing says where it is and which way it looks");
{
  const square = { positions: [0, 0, 5, 100, 0, 5, 100, 100, 5, 0, 100, 5],
                   index: [0, 1, 2, 0, 2, 3] };
  check("a flat face points out of itself",
        close(faceWay(square.positions, square.index), [0, 0, 1], 1e-9),
        JSON.stringify(faceWay(square.positions, square.index)));
  check("and the middle of it is its middle",
        close(middleOf(square.positions), [50, 50, 5], 1e-9));
  // Weighted by area, so a big face decides and a sliver does not.
  const mostly = { positions: [...square.positions, 0, 0, 5, 1, 0, 6, 0, 1, 6],
                   index: [...square.index, 4, 5, 6] };
  check("a sliver does not out-vote the face it is on",
        near(faceWay(mostly.positions, mostly.index)[2], 1, 0.01));
  check("a drawn line says which way it runs",
        close(lineWay([10, 0, 0, 10, 0, 40]), [0, 0, 1], 1e-9));
  check("nothing drawn says nothing", faceWay(null, null) === null
        && lineWay([]) === null && middleOf([]) === null && vUnit([0, 0, 0]) === null);
}

console.log("\n5. every feature leads with an argument it really has");
{
  const wrong = [];
  for (const [type, rows] of Object.entries(LEADS)) {
    const found = spec(type);
    if (!found) { wrong.push(type + ": no such node"); continue; }
    for (const row of rows) {
      if (row.when) {
        const choice = (found.args || []).find(a => a.key === row.when.key
          && a.kind === "choice");
        if (!choice) wrong.push(type + ": has no setting called " + row.when.key);
        else if (!choice.options[row.when.is])
          wrong.push(type + "." + row.when.key + ": no option " + row.when.is);
      }
      for (const key of row.keys || [row.key]) {
        const arg = (found.args || []).find(a => a.key === key && a.kind === "real");
        if (!arg) { wrong.push(type + "." + key + ": not a number on it"); continue; }
        // An argument that only applies for one setting has to be claimed with
        // that setting, or the row is a slider that never appears.
        if (arg.showWhen && !(row.when && arg.showWhen.key === row.when.key
                              && arg.showWhen.equals === row.when.is))
          wrong.push(type + "." + key + " needs " + arg.showWhen.key + " = "
                     + arg.showWhen.equals + ", which the row does not say");
      }
    }
  }
  check("every row of the table is true of the catalogue", wrong.length === 0,
        wrong.join(" | "));

  const rulers = Object.entries(RULERS).flatMap(([type, said]) => {
    const found = spec(type);
    if (!found) return [type + ": no such node"];
    return [...(said.at || []), ...(said.dir || [])].filter(key =>
      !(found.args || []).some(a => a.key === key && (a.kind === "ref" || a.kind === "refs")))
      .map(key => type + "." + key + ": not an input on it");
  });
  check("and every ruler is anchored on an input that exists", rulers.length === 0,
        rulers.join(" | "));
}

console.log("\n6. and the lead is the one you would reach for");
{
  const lead = (type, values) => leadFor({ type, name: type + ".1", values }, spec(type));
  check("a fillet is its radius", lead("Fillet", { radius: 5 }).key === "radius");
  check("and it is dragged like a radius", lead("Fillet", { radius: 5 }).drag === "radius");
  check("a pad is how far it goes",
        lead("Extrude", { limit: 0, distance: 40 }).key === "distance");
  check("and it is dragged along an axis, which is what a ruler is",
        lead("Extrude", { limit: 0, distance: 40 }).drag === "axis");
  check("a cube standing on a plane is its height", lead("Cube", { dz: 80 }).key === "dz");
  check("a point by coordinates is three numbers and a place to put them",
        lead("Point", { kind: 0, x: 0, y: 0, z: 0 }).drag === "place"
        && lead("Point", { kind: 0 }).keys.join() === "x,y,z");
  check("a point on a curve is where along it",
        lead("Point", { kind: 1, at: 0.5 }).key === "at"
        && lead("Point", { kind: 1, at: 0.5 }).drag === "curve");
  check("an offset plane is its offset",
        lead("Plane", { kind: 2, offset: 100 }).key === "offset");
  check("a plane square across a curve is where along it",
        lead("Plane", { kind: 1, at: 0.5 }).drag === "curve");
  check("a plane by origin and normal leads with nothing - there is no one number",
        lead("Plane", { kind: 0 }) === null);
  check("a draft is its angle, and there is nothing to drag it against",
        lead("Draft", { angle: 3 }).key === "angle" && !lead("Draft", { angle: 3 }).drag);
  check("the lead carries what a slider needs",
        (() => { const l = lead("Fillet", { radius: 5 });
                 return l.label === "Radius" && l.unit === "mm"
                        && Number.isFinite(l.min) && Number.isFinite(l.max)
                        && Number.isFinite(l.step) && l.value === 5; })(),
        JSON.stringify(lead("Fillet", { radius: 5 })));
  check("a node with no number to lead with says so",
        leadFor({ type: "Boolean", values: {} }, spec("Boolean")) === null
        && leadFor({ type: "Sketch", values: {} }, spec("Sketch")) === null);
  check("and so does nothing at all", leadFor(null, null) === null);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
