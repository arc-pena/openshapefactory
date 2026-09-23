// A camera, as a thing rather than as a mood the window was in.
//
// Every view worth having gets lost: somebody orbits, somebody opens the file
// tomorrow, and the shot that explained the scheme is gone. So a shot is a
// node - where it stands, what it looks at, what lens is on it and what shape
// it will be printed in - and standing behind it is a mode.
//
// What is checked here is the arithmetic: which way it faces, what a dolly is
// as against a zoom, where the letterbox falls, and the exact frustum the
// model draws for it.
import { ACTION_SAFE, FRAMES, SAFE_MODES, TITLE_SAFE, cornersOf, dolly, frameAt,
         frameOf, fromView, letterbox, orbitAbout, safeAt, saysShot,
         truck } from "../src/camera.js";
import { fovFromLens } from "../src/gizmo.js";
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { readFileSync } from "fs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const away = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

console.log("1. which way it faces");
{
  // Standing south of the origin at eye height, looking at the middle of a
  // building. Z is up in this program, so "up" falls out of that.
  const view = frameOf([0, -10000, 1700], [0, 0, 1700]);
  check("it looks the way it is pointed",
        near(view.forward[1], 1) && near(view.forward[0], 0), JSON.stringify(view.forward));
  check("up is up", near(view.up[2], 1, 1e-9), JSON.stringify(view.up));
  check("and right is to the right", near(view.right[0], 1, 1e-9), JSON.stringify(view.right));
  check("the three are square to each other",
        near(dot(view.forward, view.up), 0, 1e-9) && near(dot(view.forward, view.right), 0, 1e-9)
        && near(dot(view.up, view.right), 0, 1e-9));
  check("and it knows how far away what it is looking at is",
        near(view.distance, 10000, 1e-9), String(view.distance));

  // Straight down is the one that has no up of its own - and a plan is a view,
  // so it gets one rather than an error.
  const plan = frameOf([0, 0, 40000], [0, 0, 0]);
  check("a camera looking straight down still has a frame", !!plan
        && near(Math.abs(plan.forward[2]), 1, 1e-9), plan && JSON.stringify(plan.forward));
  check("standing on what it is looking at has no answer at all",
        frameOf([5, 5, 5], [5, 5, 5]) === null);

  // Roll turns the frame about the way it is looking, and nothing else.
  const rolled = frameOf([0, -10000, 1700], [0, 0, 1700], 90);
  check("roll turns the frame about its own axis",
        near(dot(rolled.forward, view.forward), 1, 1e-9));
  check("and takes up round with it", near(Math.abs(rolled.right[2]), 1, 1e-6),
        JSON.stringify(rolled.right));
}

console.log("\n2. a dolly is not a zoom");
{
  const view = frameOf([0, -10000, 1700], [0, 0, 1700]);
  const closer = dolly(view, 4000);
  check("the camera walks in", near(away(closer.eye, closer.target), 6000, 1e-6),
        String(away(closer.eye, closer.target)));
  check("and what it is looking at does not move",
        near(away(closer.target, [0, 0, 1700]), 0, 1e-9));
  // It never walks through the target and out the other side: a camera past
  // what it is looking at is pointing the wrong way, and the picture does not
  // say why.
  const past = dolly(view, 99999);
  check("and it never walks out the other side", away(past.eye, past.target) > 0,
        String(away(past.eye, past.target)));
  check("stopping just short of it", away(past.eye, past.target) < 1000,
        String(away(past.eye, past.target)));

  const slid = truck(view, 3000, 500);
  check("a truck moves both points together",
        near(away(slid.eye, slid.target), 10000, 1e-6), String(away(slid.eye, slid.target)));
  check("so the shot keeps its angle",
        near(dot(frameOf(slid.eye, slid.target).forward, view.forward), 1, 1e-9));
  check("sideways is sideways", near(slid.target[0], 3000, 1e-6), String(slid.target[0]));
  check("and up is up", near(slid.target[2], 2200, 1e-6), String(slid.target[2]));

  // AN ORBIT IS ABOUT THE TARGET, and about world up - a yaw that used the
  // camera's own up would roll the horizon over as soon as the camera tilted.
  const round = orbitAbout(view, Math.PI / 2, 0);
  check("an orbit keeps its distance", near(away(round.eye, round.target), 10000, 1e-6),
        String(away(round.eye, round.target)));
  check("and its target", near(away(round.target, [0, 0, 1700]), 0, 1e-9));
  check("a quarter turn puts it round the side",
        near(round.eye[0], 10000, 1e-6) && near(round.eye[1], 0, 1e-6),
        JSON.stringify(round.eye.map(v => Math.round(v))));
  const over = orbitAbout(view, 0, 9);
  check("and it never goes over the top", Math.abs(over.eye[2] - 1700) < 10000,
        String(over.eye[2]));
}

console.log("\n3. the letterbox, and what falls inside it");
{
  // A 16:9 shot in a window that is wider than it: the height fits and the
  // sides are cropped.
  const wide = letterbox(1600, 600, 16 / 9);
  check("in a wide window the height is what fits", near(wide.height, 600),
        JSON.stringify(wide));
  check("and it is centred", near(wide.x, (1600 - 600 * 16 / 9) / 2), String(wide.x));
  const tall = letterbox(800, 900, 16 / 9);
  check("in a tall one the width is", near(tall.width, 800), JSON.stringify(tall));
  check("and the ratio is the ratio either way",
        near(wide.width / wide.height, 16 / 9, 1e-9)
        && near(tall.width / tall.height, 16 / 9, 1e-9));
  check("a square in a square is the whole of it",
        near(letterbox(500, 500, 1).width, 500));

  check("eight frames to choose from", FRAMES.length === 8,
        FRAMES.map(f => f.key).join());
  check("and A4 is A4", near(frameAt(6).ratio, 297 / 210, 1e-9), String(frameAt(6).ratio));
  check("a number past the end is the last one", frameAt(99).key === "a3");
  check("four safe modes", SAFE_MODES.length === 4);
  check("and the two rectangles broadcast has always used",
        ACTION_SAFE === 0.9 && TITLE_SAFE === 0.8);
  check("off means off", !safeAt(0).action && !safeAt(0).thirds);
  check("and both means both", safeAt(3).action && safeAt(3).title && safeAt(3).thirds);

  check("the shot is said in one line",
        saysShot(35, "16:9", 26900) === "35 mm · 16:9 · 26.9 m to target",
        saysShot(35, "16:9", 26900));
  check("in millimetres when it is close", /mm to target/.test(saysShot(50, "3:2", 800)),
        saysShot(50, "3:2", 800));

  // The corners of the picture, out in the world. What the drawn camera is
  // made of, and what answers "will the tower be in shot".
  const view = frameOf([0, -10000, 0], [0, 0, 0]);
  const corners = cornersOf(view, fovFromLens(35), 16 / 9);
  check("four corners", corners.length === 4);
  const half = Math.tan(fovFromLens(35) * Math.PI / 360) * 10000;
  check("as tall as the lens says", near(Math.abs(corners[0][2]), half, 1e-6),
        Math.abs(corners[0][2]) + " vs " + half);
  check("and as wide as the frame says",
        near(Math.abs(corners[0][0]), half * 16 / 9, 1e-6), String(Math.abs(corners[0][0])));
  check("all of them at the target's distance",
        corners.every(c => near(c[1], 0, 1e-6)), JSON.stringify(corners.map(c => Math.round(c[1]))));

  const wrote = fromView([1234.567, -2, 3], [0, 0, 0]);
  check("what is written back is rounded to something readable",
        wrote.x === 1234.57 && wrote.tx === 0, JSON.stringify(wrote));
}

console.log("\n4. and it is a node, in the tree, like anything else");
{
  const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
  const init = (await import(DIR + "/replicad_single.js")).default;
  const kernel = await createWasmKernel({ initModule: init,
                                          wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
  const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                        select: () => {}, selected: () => null });
  const at = async id => (await kernel.tree()).tree.features.find(f => f.id === id);
  await mdl.run({ op: "model", model: { format: "ocaf-parametric-model",
    version: 1, name: "Shot", units: "mm", features: [] } });
  await mdl.run({ op: "add", type: "Point", id: "P0", name: "Origin" });
  await mdl.run({ op: "add", type: "Camera", id: "CAM", name: "Street view" });
  const born = await at("CAM");
  check("it builds with nothing wired in", !born.error, born.error || "");
  // A CAMERA'S POINTS ARE NEVER GUESSED AT. Wired to the first point in the
  // document, both of them would be the same point, the eye would be standing
  // on its own target and it would refuse to build - which is exactly what
  // happened before there was a way to say "leave this one alone".
  check("and its position was not wired to whatever point was lying about",
        !(born.refs && (born.refs.at || born.refs.look)), JSON.stringify(born.refs));
  check("it says what shot it is", /mm · 16:9 ·/.test(born.note || ""), born.note);
  check("and it hands out a frame, so anything that takes one takes it",
        born.data && born.data.kind === "axis", JSON.stringify(born.data));

  for (const [key, value] of [["x", 0], ["y", -10000], ["z", 1700],
                              ["tx", 0], ["ty", 0], ["tz", 1700]])
    await mdl.run({ op: "set", id: "CAM", key, value });
  check("ten metres away reads as ten metres",
        /10\.0 m to target/.test((await at("CAM")).note || ""), (await at("CAM")).note);
  await mdl.run({ op: "set", id: "CAM", key: "lens", value: 85 });
  check("and the lens is the lens", /^85 mm/.test((await at("CAM")).note || ""),
        (await at("CAM")).note);

  // Wired to a point, it follows the point.
  await mdl.run({ op: "connect", id: "CAM", key: "look", from: "P0" });
  await mdl.run({ op: "set", id: "P0", key: "z", value: 5000 });
  const followed = await at("CAM");
  check("wired to a point, it looks where the point is", !followed.error, followed.error || "");
  check("and the distance follows it too",
        !/^85 mm · 16:9 · 10 m/.test(followed.note || ""), followed.note);

  await mdl.run({ op: "set", id: "CAM", key: "tx", value: 0 });
  await mdl.run({ op: "disconnect", id: "CAM", key: "look" });
  await mdl.run({ op: "set", id: "CAM", key: "ty", value: -10000 });
  check("standing on its own target is refused, and says which to move",
        /standing on what it is looking at/.test((await at("CAM")).error || ""),
        (await at("CAM")).error);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
