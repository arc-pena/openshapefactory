// The widget, and what a drag of it comes to.
//
// W moves, E turns, R resizes: three gestures everybody's fingers already
// know. What is under the hand is arrows, rings and boxes; what comes out is
// numbers on a node, because a shape shoved about by hand has to end up in the
// tree like everything else or the file stops being the model.
//
// The arithmetic is here and it is checked here, because a drag that is right
// on a screen and wrong in the file is worse than no widget at all.
import { DOLLY_GAIN, GIZMO_AXES, GIZMO_MODES, GIZMO_ORDER, GIZMO_PLANES, LENSES,
         TRANSFORM_KEYS, angleAbout, coversAt, dollyPull, dollyScale, fovFromLens,
         framedAt, handlesFor, landOn, lensFromFov, reachAlong, saysWhat, shortestTurn,
         sizeFrom, stepped, transformNow, transformTarget } from "../src/gizmo.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const deg = r => r * 180 / Math.PI;

console.log("1. what each mode puts on screen");
{
  check("three axes, in the order everything walks them",
        GIZMO_AXES.map(a => a.key).join() === "x,y,z");
  check("and three planes, each named for the axis it is square to",
        GIZMO_PLANES.map(p => p.key).join() === "xy,yz,zx");
  // A plane's two directions must be the two the axis is NOT - otherwise
  // dragging the XY square would move a thing up, which is the one thing a
  // plan move must never do.
  for (const plane of GIZMO_PLANES) {
    const along = plane.along;
    const straight = along.every(a =>
      Math.abs(a[0] * plane.normal[0] + a[1] * plane.normal[1] + a[2] * plane.normal[2]) < 1e-9);
    check("the " + plane.key.toUpperCase() + " square slides only in its own plane", straight,
          JSON.stringify(along));
  }
  const move = handlesFor("move");
  check("a move offers six handles", move.length === 6, String(move.length));
  check("three arrows and three squares",
        move.filter(h => h.kind === "axis").length === 3
        && move.filter(h => h.kind === "plane").length === 3);
  check("a turn offers three rings", handlesFor("rotate").length === 3
        && handlesFor("rotate").every(h => h.kind === "ring"));
  // One factor, and the widget says so: a gp_Trsf carries ONE scale, and
  // pretending otherwise would be pretending the kernel will squash a solid.
  check("a size writes one number", TRANSFORM_KEYS.scale.join() === "factor");
  check("and its hint says as much", /the same every way/.test(GIZMO_MODES.scale.hint),
        GIZMO_MODES.scale.hint);
  check("the three modes are the three keys",
        GIZMO_ORDER.map(k => GIZMO_MODES[k].hotkey).join() === "w,e,r");
}

console.log("\n2. a drag along an axis is a distance, in millimetres");
{
  // A ray straight down the -Z axis from high above, aimed at a point on the
  // X axis: where it comes nearest the X axis through the origin is that point.
  const at = [0, 0, 0];
  check("the ruler reads where the ray reaches",
        near(reachAlong([40, 0, 500], [0, 0, -1], at, [1, 0, 0]), 40), 
        String(reachAlong([40, 0, 500], [0, 0, -1], at, [1, 0, 0])));
  check("and the answer is in the model's units, not in the axis's length",
        near(reachAlong([40, 0, 500], [0, 0, -1], at, [9, 0, 0]), 40),
        String(reachAlong([40, 0, 500], [0, 0, -1], at, [9, 0, 0])));
  check("a ray along the axis has no answer to give, and says nothing rather than a number",
        reachAlong([0, 0, 0], [1, 0, 0], at, [1, 0, 0]) === 0);
}

console.log("\n3. a drag in a plane is a point on it");
{
  const on = landOn([30, 70, 400], [0, 0, -1], [0, 0, 12], [0, 0, 1]);
  check("straight down onto the plane at z = 12",
        near(on[0], 30) && near(on[1], 70) && near(on[2], 12), JSON.stringify(on));
  check("a ray running along the plane lands nowhere",
        landOn([0, 0, 50], [1, 0, 0], [0, 0, 0], [0, 0, 1]) === null);
}

console.log("\n4. a turn is an angle about a ring");
{
  const at = [0, 0, 0], axis = [0, 0, 1], from = [1, 0, 0];
  // Looking straight down, a ray through (100, 0) is at nought degrees from X
  // and one through (0, 100) is at ninety.
  check("nought degrees along the reference direction",
        near(deg(angleAbout([100, 0, 500], [0, 0, -1], at, axis, from)), 0, 1e-6));
  check("ninety a quarter turn round",
        near(deg(angleAbout([0, 100, 500], [0, 0, -1], at, axis, from)), 90, 1e-6));
  check("and minus ninety the other way",
        near(deg(angleAbout([0, -100, 500], [0, 0, -1], at, axis, from)), -90, 1e-6));
  // THE BACK OF THE RING. A hand crossing it goes from +179 to -179, and read
  // plainly that is nearly two whole turns in one frame - the model spinning
  // once for every time you crossed the far side.
  check("crossing the back of the ring is two degrees, not three hundred and fifty-eight",
        near(deg(shortestTurn(179 * Math.PI / 180, -179 * Math.PI / 180)), 2, 1e-9),
        deg(shortestTurn(179 * Math.PI / 180, -179 * Math.PI / 180)).toFixed(6));
  check("and the other way round too",
        near(deg(shortestTurn(-179 * Math.PI / 180, 179 * Math.PI / 180)), -2, 1e-9));
}

console.log("\n5. steps, so a tower lands on three thousand");
{
  check("ten millimetre steps", stepped(2987.4, 10) === 2990, String(stepped(2987.4, 10)));
  check("five degree steps", stepped(47.2, 5) === 45, String(stepped(47.2, 5)));
  check("and no step at all leaves it alone", stepped(47.2, 0) === 47.2);
  check("a size is a ratio, and never negative", sizeFrom(100, -50) === 0.01,
        String(sizeFrom(100, -50)));
  check("twice as far out is twice the size", near(sizeFrom(100, 200), 2));
}

console.log("\n5b. the dolly: Alt and the right button, the way Maya has always done it");
{
  // Forward is up the screen, which is a NEGATIVE dy, and right is a positive
  // dx. Either one takes you in, and a factor below one is closer.
  check("pushing the mouse forward goes in", dollyScale(0, -80) < 1,
        String(dollyScale(0, -80)));
  check("pulling it right goes in too", dollyScale(80, 0) < 1, String(dollyScale(80, 0)));
  check("back and left come out",
        dollyScale(0, 80) > 1 && dollyScale(-80, 0) > 1);
  check("and a hand that has not moved changes nothing", near(dollyScale(0, 0), 1));
  check("forward and right add up, so a diagonal is the sum of what it looks like",
        near(dollyPull(40, -40), 80), String(dollyPull(40, -40)));

  // EXPONENTIAL, NOT LINEAR. Eighty pixels has to mean the same THING at two
  // metres and at nine hundred, and the only way a distance means the same
  // thing at two scales is as a multiple - so two drags of forty are one drag
  // of eighty, exactly.
  check("two short drags are one long one",
        near(dollyScale(40, 0) * dollyScale(40, 0), dollyScale(80, 0), 1e-12),
        dollyScale(40, 0) * dollyScale(40, 0) + " vs " + dollyScale(80, 0));
  check("and going back out undoes going in",
        near(dollyScale(80, 0) * dollyScale(-80, 0), 1, 1e-12));
  check("it never reaches nought, so the camera can always come back",
        dollyScale(100000, 0) > 0, String(dollyScale(100000, 0)));
  // A hundred pixels is about half the distance at the gain it is set to -
  // brisk enough to cross a masterplan and slow enough to place a camera.
  check("a hundred pixels is about half the distance",
        dollyScale(100, 0) > 0.4 && dollyScale(100, 0) < 0.65,
        String(dollyScale(100, 0)));
  check("and a gain that can be turned down is a gain", dollyScale(80, 0, DOLLY_GAIN / 2)
        > dollyScale(80, 0, DOLLY_GAIN));
}

console.log("\n6. the lens, in millimetres, because nobody specifies a view in degrees");
{
  // 35 mm full frame is 24 mm tall, so the half-height is 12 and a 50 mm lens
  // sees 2*atan(12/50) vertically - 27.0 degrees, which is the number on every
  // lens chart there has ever been.
  check("a 50 mm lens is 27 degrees vertically", near(fovFromLens(50), 26.99, 0.01),
        fovFromLens(50).toFixed(3));
  check("a 24 mm lens is 53.1", near(fovFromLens(24), 53.13, 0.01), fovFromLens(24).toFixed(3));
  check("and it goes back the way it came",
        near(lensFromFov(fovFromLens(85)), 85, 1e-9), String(lensFromFov(fovFromLens(85))));
  check("the lenses offered are the ones in a camera bag",
        LENSES.includes(24) && LENSES.includes(35) && LENSES.includes(50) && LENSES.includes(85),
        LENSES.join(","));

  // THE DOLLY ZOOM, which is the only way to SEE what a lens does: the subject
  // stays the size it was and everything behind it rushes past. So a longer
  // lens has to walk the camera back by exactly the ratio of the two half
  // angles, and what it covers at the target must not change.
  const was = 500, fromFov = fovFromLens(24), toFov = fovFromLens(85);
  const now = framedAt(was, fromFov, toFov);
  check("a longer lens walks the camera back", now > was, was + " -> " + Math.round(now));
  check("and the subject stays the size it was",
        near(coversAt(was, fromFov, 1), coversAt(now, toFov, 1), 1e-6),
        coversAt(was, fromFov, 1).toFixed(4) + " vs " + coversAt(now, toFov, 1).toFixed(4));
  check("a shorter lens walks it in", framedAt(was, toFov, fromFov) < was);
  check("and the same lens does not move it at all",
        near(framedAt(was, fromFov, fromFov), was, 1e-9));
}

console.log("\n7. where the numbers go");
{
  // Dragging something that is ALREADY a transform drives that one. Pushing a
  // tower twice must leave ONE number in the tree, not two nodes each holding
  // half the answer.
  const already = transformTarget({ id: "TR1", type: "Transform" });
  check("a transform in hand is the one that is driven",
        already.id === "TR1" && already.make === false, JSON.stringify(already));
  const fresh = transformTarget({ id: "CB1", type: "Cube" });
  check("and anything else gets one made over the top of it",
        fresh.make === true && fresh.over === "CB1", JSON.stringify(fresh));
  check("nothing selected is nothing to drive", transformTarget(null) === null);

  const now = transformNow({ values: { dx: 40, dy: 0, dz: -12 } }, "move");
  check("a drag adds to what is already there",
        now.dx === 40 && now.dz === -12, JSON.stringify(now));
  check("a size with nothing set starts at one",
        transformNow(null, "scale").factor === 1);
  check("and a move with nothing set starts at nought",
        transformNow(null, "move").dx === 0);

  check("the bar says what the hand did", saysWhat("move", { dx: 3000, dy: 0, dz: 0 })
        === "X 3000  Y 0  Z 0", saysWhat("move", { dx: 3000, dy: 0, dz: 0 }));
  check("in degrees for a turn", /°/.test(saysWhat("rotate", { rx: 0, ry: 0, rz: 45 })),
        saysWhat("rotate", { rx: 0, ry: 0, rz: 45 }));
  check("and as a multiple for a size", saysWhat("scale", { factor: 2.5 }) === "× 2.5",
        saysWhat("scale", { factor: 2.5 }));
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
