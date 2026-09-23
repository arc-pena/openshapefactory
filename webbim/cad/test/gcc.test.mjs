// Lines and circles from constraints, measured against the constraints.
//
// The whole point of this file is that an answer is CHECKED rather than
// eyeballed. A circle said to be tangent to two circles with radius 12 either
// has radius 12 and centre-distances that come to the sum or difference of the
// radii, or it does not - and that is arithmetic, not a picture. So every
// check below measures the answer against what was asked for.
//
// No kernel: this is the part of the modeller that is pure geometry, which is
// exactly why it was written here rather than fetched from a package the web
// build does not carry.
import { QUALIFIERS, bisector, cCircle, cLine, cPoint, circle2PointsRadius,
         circle2TanOn, circle2TanRadius, circle3Tan, circleTanCentre,
         circleTanOnRadius, circleThrough3, line2Tan, lineTanAngle,
         lineTanParallel, lineTanSquare, meetCircles, meetLineCircle, meetLines,
         nearestOn, saysCircle, signedFrom, standing } from "../src/gcc.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

//! ONE MEASUREMENT, USED EVERYWHERE: is this circle really tangent to that
//! element? Distance from the centre against the radius, the sum, or the
//! difference - the three ways two circles touch and the one way a line does.
function reallyTangent(element, one, tol = 1e-5) {
  const scale = Math.max(1, one.r, element.r || 0,
                         Math.abs(element.at[0]), Math.abs(element.at[1]));
  if (element.kind === "point") return near(dist(one.at, element.at), one.r, tol * scale);
  if (element.kind === "line")
    return near(Math.abs(signedFrom(element, one.at)), one.r, tol * scale);
  const d = dist(one.at, element.at);
  return near(d, element.r + one.r, tol * scale)
      || near(d, Math.abs(element.r - one.r), tol * scale);
}

console.log("1. the qualifiers, and what they are read off an answer");
{
  check("four of them, as the documentation lists them",
        QUALIFIERS.map(q => q.key).join() === "unqualified,outside,enclosed,enclosing");
  const c = cCircle([0, 0], 100);
  // A small circle touching the big one from outside.
  check("touching from outside is outside",
        standing(c, [130, 0], 30) === "outside", standing(c, [130, 0], 30));
  // A small circle inside the big one, touching.
  check("a small one inside a big one is enclosed by it",
        standing(c, [70, 0], 30) === "enclosed", standing(c, [70, 0], 30));
  // A big circle with the small one inside it.
  check("and a big one round a small one encloses it",
        standing(cCircle([0, 0], 30), [70, 0], 100) === "enclosing",
        standing(cCircle([0, 0], 30), [70, 0], 100));
  // The interior of a line is its left-hand side, says the documentation.
  const line = cLine([0, 0], [1, 0]);
  check("the left of a line is its inside", standing(line, [0, 40], 40) === "enclosing");
  check("and the right of it is outside", standing(line, [0, -40], 40) === "outside");
  check("something that does not touch at all is nothing",
        standing(c, [200, 0], 30) === null);
}

console.log("\n2. where two of them meet");
{
  check("two lines cross once",
        near(dist(meetLines(cLine([0, 0], [1, 0]), cLine([50, -20], [0, 1]))[0], [50, 0]), 0));
  check("parallel lines never do", meetLines(cLine([0, 0], [1, 0]),
                                             cLine([0, 40], [1, 0])).length === 0);
  const cut = meetLineCircle(cLine([0, 0], [1, 0]), cCircle([0, 0], 60));
  check("a line through a circle's middle cuts it twice", cut.length === 2
        && near(Math.abs(cut[0][0]), 60) && near(Math.abs(cut[1][0]), 60));
  check("a line that misses it cuts it not at all",
        meetLineCircle(cLine([0, 100], [1, 0]), cCircle([0, 0], 60)).length === 0);
  const pair = meetCircles(cCircle([0, 0], 50), cCircle([80, 0], 50));
  check("two overlapping circles meet twice, symmetrically", pair.length === 2
        && near(pair[0][0], 40) && near(pair[1][0], 40)
        && near(pair[0][1], -pair[1][1]), JSON.stringify(pair));
  check("and two that touch meet once",
        meetCircles(cCircle([0, 0], 50), cCircle([100, 0], 50)).length === 1);
}

console.log("\n3. the circumcircle, and two points with a radius");
{
  // A 3-4-5 triangle's circumcircle sits on the hypotenuse's middle, radius
  // 2.5 - Thales, and a number that can be written down rather than computed.
  const [one] = circleThrough3([0, 0], [3, 0], [0, 4]);
  check("through three points is the circumcircle",
        one && near(one.r, 2.5, 1e-9) && near(dist(one.at, [1.5, 2]), 0, 1e-9),
        one && saysCircle(one));
  check("three in a line have no circle", circleThrough3([0, 0], [1, 0], [2, 0]).length === 0);

  const two = circle2PointsRadius([0, 0], [80, 0], 50);
  check("two points and a radius gives two, one each side", two.length === 2);
  check("both really pass through both points",
        two.every(c => near(dist(c.at, [0, 0]), 50, 1e-9)
                    && near(dist(c.at, [80, 0]), 50, 1e-9)));
  check("and 30 either side of the chord, by Pythagoras",
        two.every(c => near(Math.abs(c.at[1]), 30, 1e-9)), JSON.stringify(two.map(c => c.at)));
  check("a radius too small to reach gives nothing",
        circle2PointsRadius([0, 0], [80, 0], 20).length === 0);
  check("and exactly half the span gives one",
        circle2PointsRadius([0, 0], [80, 0], 40).length === 1);
}

console.log("\n4. tangent to two elements, with a radius");
{
  // Two lines square to one another: a circle of radius 20 tangent to both
  // sits at (±20, ±20) - four answers, one in each quadrant.
  const x = cLine([0, 0], [1, 0]), y = cLine([0, 0], [0, 1]);
  const four = circle2TanRadius(x, y, 20);
  check("two square lines and a radius gives four", four.length === 4, "" + four.length);
  check("one in each quadrant, all 20 from both",
        four.every(c => near(Math.abs(c.at[0]), 20, 1e-9) && near(Math.abs(c.at[1]), 20, 1e-9)));
  check("and every one really touches both lines",
        four.every(c => reallyTangent(x, c) && reallyTangent(y, c)));

  // Two circles 140 apart, radius 50 each. A solution of radius 120 stands
  // either 170 or 70 from each of them, and every pairing of those reaches
  // across the 140 between - so the picture with several answers in it.
  const c1 = cCircle([0, 0], 50), c2 = cCircle([140, 0], 50);
  const all = circle2TanRadius(c1, c2, 120);
  check("two circles and a radius gives the documentation's several",
        all.length >= 4, "" + all.length);
  check("every answer is the radius it was asked for", all.every(c => near(c.r, 120, 1e-9)));
  check("and every one really touches both circles",
        all.every(c => reallyTangent(c1, c) && reallyTangent(c2, c)),
        all.map(c => Math.round(dist(c.at, c1.at)) + "/" + Math.round(dist(c.at, c2.at))).join(" "));

  // The qualifiers narrow it, which is the whole reason they exist.
  const outside = circle2TanRadius(c1, c2, 120, "outside", "outside");
  check("outside both leaves the two that sit clear of them",
        outside.length === 2 && outside.every(c =>
          near(dist(c.at, c1.at), 170, 1e-9) && near(dist(c.at, c2.at), 170, 1e-9)),
        "" + outside.length);
  check("and it is fewer than the unqualified set", outside.length < all.length,
        outside.length + " of " + all.length);
  check("every one of them reads back as outside both",
        outside.every(c => c.how[0] === "outside" && c.how[1] === "outside"));

  // A radius too small to bridge the gap has no answer at all, and saying so
  // is as much the job as finding one: 80 and 80 will not span 200.
  check("and a radius too small to bridge them finds nothing",
        circle2TanRadius(cCircle([0, 0], 50), cCircle([200, 0], 50), 30).length === 0);
}

console.log("\n5. tangent to one, centred on another, and centred at a point");
{
  const line = cLine([0, 0], [1, 0]);
  const on = cLine([0, 0], [0, 1]);               // the Y axis
  const found = circleTanOnRadius(line, on, 25);
  check("tangent to a line, centred on another, radius 25: two",
        found.length === 2, "" + found.length);
  check("both on the Y axis, 25 from the X axis",
        found.every(c => near(c.at[0], 0, 1e-9) && near(Math.abs(c.at[1]), 25, 1e-9)));

  const c = cCircle([0, 0], 100);
  const [one] = circleTanCentre(c, [250, 0]);
  check("centred at a point, tangent to a circle: the radius is the gap",
        one && near(one.r, 150, 1e-9), one && saysCircle(one));
  check("and it really touches", one && reallyTangent(c, one));
  const [two] = circleTanCentre(cLine([0, 0], [1, 0]), [0, 60]);
  check("the same against a line", two && near(two.r, 60, 1e-9));
}

console.log("\n6. tangent to three - the Apollonius problem the docs draw");
{
  // Three points: the answer is the circumcircle and nothing else.
  const p = circle3Tan(cPoint([0, 0]), cPoint([3, 0]), cPoint([0, 4]));
  check("three points give the circumcircle, once",
        p.length === 1 && near(p[0].r, 2.5, 1e-6), p.map(saysCircle).join(" | "));

  // Three lines forming a triangle: the incircle and three excircles - four,
  // the classic answer, and a number worth knowing before you look.
  const a = cLine([0, 0], [1, 0]);
  const b = cLine([0, 0], [0, 1]);
  const d = cLine([120, 0], [-120, 160]);
  const t = circle3Tan(a, b, d);
  check("three lines give the incircle and three excircles", t.length === 4, "" + t.length);
  check("and every one really touches all three",
        t.every(c => reallyTangent(a, c) && reallyTangent(b, c) && reallyTangent(d, c)),
        t.map(c => Math.round(c.r)).join(" "));
  // The 3-4-5 triangle scaled by 40: sides 120, 160, 200, so area 9600 and
  // semiperimeter 240 - an inradius of exactly 40, which is a number the
  // answer either is or is not.
  check("the incircle's radius is area over semiperimeter: 40",
        t.some(c => near(c.r, 40, 1e-4)), t.map(c => c.r.toFixed(3)).join(" "));

  // Three equal circles in a row of touching pairs: the classic Apollonius
  // picture, and it must produce circles that genuinely touch all three.
  const c1 = cCircle([0, 0], 50), c2 = cCircle([140, 0], 50), c3 = cCircle([70, 120], 50);
  const three = circle3Tan(c1, c2, c3);
  check("three circles give several answers", three.length >= 2, "" + three.length);
  check("and every one really touches all three",
        three.every(c => reallyTangent(c1, c) && reallyTangent(c2, c) && reallyTangent(c3, c)),
        three.map(c => c.r.toFixed(1)).join(" "));
  check("asking for outside all three narrows it",
        circle3Tan(c1, c2, c3, ["outside", "outside", "outside"]).length < three.length);
}

console.log("\n7. tangent to two, centred on a third");
{
  const on = cLine([0, 0], [0, 1]);                          // the Y axis
  const c1 = cCircle([-80, 0], 40), c2 = cCircle([100, 30], 25);
  const found = circle2TanOn(c1, c2, on);
  check("tangent to two circles, centred on a line", found.length >= 2, "" + found.length);
  check("every centre really is on the line",
        found.every(c => near(Math.abs(signedFrom(on, c.at)), 0, 1e-4)));
  check("and every one really touches both",
        found.every(c => reallyTangent(c1, c) && reallyTangent(c2, c)),
        found.map(c => c.r.toFixed(1)).join(" "));

  // TWO OF THE SAME SIZE, and a centre asked to sit on their line of symmetry:
  // every circle centred there that touches one touches the other, so there
  // are infinitely many. "None" would be the opposite of the truth, and the
  // answer says which it is rather than coming back empty and quiet.
  const family = circle2TanOn(cCircle([-80, 0], 40), cCircle([80, 0], 40), on);
  check("a symmetric arrangement says it is a family, not a list",
        family.length === 0 && family.family === true, JSON.stringify(family));

  const round = circle2TanOn(c1, c2, cCircle([0, 0], 150));
  check("and a centre asked to sit on a circle is walked round it",
        round.length >= 2, "" + round.length);
  check("every one of those touches both too",
        round.every(c => reallyTangent(c1, c, 1e-4) && reallyTangent(c2, c, 1e-4)),
        round.map(c => c.r.toFixed(2)).join(" "));
  check("and stands on the circle it was told to",
        round.every(c => near(dist(c.at, [0, 0]), 150, 1e-4)));
}

console.log("\n8. lines from constraints");
{
  // Two circles of the same size: the two outer tangents are parallel to the
  // line of centres, 50 either side, and the two crossed ones pass through the
  // middle. Four, as the documentation's five pictures say.
  const c1 = cCircle([0, 0], 50), c2 = cCircle([300, 0], 50);
  const four = line2Tan(c1, c2);
  check("two circles give four tangent lines", four.length === 4, "" + four.length);
  check("every one really touches both",
        four.every(l => {
          const line = cLine(l.at, l.way);
          return near(Math.abs(signedFrom(line, c1.at)), 50, 1e-6)
              && near(Math.abs(signedFrom(line, c2.at)), 50, 1e-6);
        }));
  check("two of them are horizontal, 50 up and 50 down",
        four.filter(l => near(Math.abs(l.way[1]), 0, 1e-9)).length === 2);
  check("qualifying it narrows the four down",
        line2Tan(c1, c2, "outside", "outside").length < 4,
        "" + line2Tan(c1, c2, "outside", "outside").length);

  const p = cPoint([0, 200]);
  check("a point and a circle give two", line2Tan(p, c1).length === 2,
        "" + line2Tan(p, c1).length);
  check("through two points, one line",
        line2Tan(cPoint([0, 0]), cPoint([10, 10])).length === 1);

  const along = cLine([0, 0], [1, 0]);
  const par = lineTanParallel(c1, along);
  check("tangent to a circle and parallel to a line: two",
        par.length === 2 && par.every(l => near(Math.abs(l.way[1]), 0, 1e-9)), "" + par.length);
  check("50 above and 50 below",
        par.map(l => Math.round(l.at[1])).sort((a, b) => a - b).join() === "-50,50",
        par.map(l => l.at[1].toFixed(2)).join(" "));
  const sq = lineTanSquare(c1, along);
  check("and square to it: two vertical ones, 50 left and right",
        sq.length === 2 && sq.map(l => Math.round(l.at[0])).sort((a, b) => a - b).join() === "-50,50",
        sq.map(l => l.at[0].toFixed(2)).join(" "));
  const angled = lineTanAngle(c1, along, Math.PI / 4);
  check("at forty-five degrees, two at forty-five degrees",
        angled.length === 2 && angled.every(l =>
          near(Math.abs(l.way[0]), Math.abs(l.way[1]), 1e-9)));
}

console.log("\n9. the bisectors");
{
  const twoPoints = bisector(cPoint([0, 0]), cPoint([100, 0]));
  check("between two points, a straight line", twoPoints.kind === "line");
  check("and it stands on the middle",
        twoPoints.points.every(p => near(p[0], 50, 1e-6)),
        JSON.stringify(twoPoints.points));

  const twoLines = bisector(cLine([0, 0], [1, 0]), cLine([0, 0], [0, 1]));
  check("between two lines, a line as well", twoLines.kind === "line");

  // A line and a point: a parabola, and every point on it is as far from the
  // point as from the line - which is the definition, so it is the check.
  const line = cLine([0, 0], [1, 0]), focus = cPoint([0, 100]);
  const parab = bisector(line, focus, { span: 400 });
  check("between a line and a point, a parabola", parab && parab.kind === "parabola",
        parab && parab.kind);
  check("with enough of it to draw", parab && parab.points.length > 30,
        parab && "" + parab.points.length);
  check("and every point equally far from both",
        parab && parab.points.every(p =>
          near(Math.abs(signedFrom(line, p)), dist(p, focus.at), 1e-4 * 400)),
        parab && parab.points.map(p =>
          (Math.abs(signedFrom(line, p)) - dist(p, focus.at)).toFixed(4)).slice(0, 4).join(" "));
  // The vertex of that parabola is halfway between: 50 up.
  check("and its nearest point is halfway between them",
        parab && near(Math.min(...parab.points.map(p => dist(p, [0, 50]))), 0, 1e-3));

  // A point inside a circle: an ellipse, with the sum of the distances to the
  // centre and the point equal to the radius - which is what an ellipse IS.
  const circle = cCircle([0, 0], 200), inside = cPoint([80, 0]);
  const el = bisector(circle, inside, { span: 400 });
  check("a point inside a circle gives an ellipse", el && el.kind === "ellipse", el && el.kind);
  check("and every point on it sums to the radius",
        el && el.points.every(p => near(dist(p, [0, 0]) + dist(p, inside.at), 200, 1e-3)),
        el && el.points.map(p =>
          (dist(p, [0, 0]) + dist(p, inside.at)).toFixed(3)).slice(0, 3).join(" "));

  const outside = cPoint([400, 0]);
  check("and a point outside it gives a hyperbola",
        (bisector(circle, outside, { span: 600 }) || {}).kind === "hyperbola");
}

console.log("\n10. the nearest place on a thing, which is where a tangency lands");
{
  check("on a point, the point itself",
        dist(nearestOn(cPoint([4, 5]), [100, 100]), [4, 5]) < 1e-12);
  check("on a line, the foot of the perpendicular",
        dist(nearestOn(cLine([0, 0], [1, 0]), [40, 90]), [40, 0]) < 1e-12);
  check("on a circle, out along the radius",
        dist(nearestOn(cCircle([0, 0], 50), [300, 0]), [50, 0]) < 1e-12);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
