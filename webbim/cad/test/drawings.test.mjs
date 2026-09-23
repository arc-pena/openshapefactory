// Drawings: the projection, and the conventions round it.
//
// Two different things again, and both are needed. That it is a PACKAGE -
// declared before it runs, its nodes in the catalogue only once loaded, gone
// again when it is put away. And that what it DRAWS is right, which for a
// projection means checkable against answers anybody can derive: a box seen
// down an axis has four visible edges and four hidden ones, the same box seen
// down a body diagonal has nine and three, and a cylinder seen from the side
// has a silhouette that is not an edge of the solid at all.
//
// AND THE FAILURES THAT WOULD LOOK LIKE SUCCESS, which for a drawing are
// unusually easy to miss, because a wrong drawing is still a drawing:
//
//   the mirror      look ALONG the plane's normal instead of back down it and
//                   every drawing comes out mirrored. On a symmetrical
//                   building it looks perfect.
//   the bow tie     a cut face whose loop is in build order rather than in
//                   order is a bow tie. It fills, it looks like poche, and it
//                   has half the area.
//   drawing itself  two views in one document, neither wired to anything, each
//                   drawing the other's lines. It grows every rebuild and
//                   every single line on it looks correct.
//   the empty layer hidden lines switched off but still counted, so the layer
//                   list says Hidden 240 and the drawing shows none of them.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { PluginHost, availablePlugins, findPlugin } from "../src/plugin.js";
import { DRAWINGS, DRAWING_NODES } from "../src/drawings-plugin.js";
import { BEYOND, DRAW_CLASSES, DRAW_LAYERS, POINT_SYMBOLS, assembleDrawing,
         chainPolylines, countByLayer, elementsFromRuns, fromPlane, includedIn,
         layerForClass, layerPen, noteOf, noteStrokes, penRecord, readExclusions,
         simplify, symbolStrokes, toPlane, toggleExclusion, viewFrame,
         writeExclusions } from "../src/drawings.js";
import { typeSpec } from "../src/ocaf.js";
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
const K = kernel.toolkit();
const oc = K.oc;

const boxOf = (dx, dy, dz, at = [0, 0, 0]) =>
  new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(at[0], at[1], at[2]), dx, dy, dz).Shape();

const spanOf = runs => {
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const kind of Object.keys(runs)) for (const run of runs[kind]) for (const p of run) {
    lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
    hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
  }
  return { lo, hi, width: hi[0] - lo[0], height: hi[1] - lo[1] };
};

const areaOf = loop => Math.abs(loop.reduce((sum, p, i, all) => {
  const q = all[(i + 1) % all.length];
  return sum + (p[0] * q[1] - q[0] * p[1]);
}, 0) / 2);

console.log("1. hidden-line removal, against answers anybody can derive");
{
  const box = boxOf(200, 120, 80);

  // Straight down Z: you see the top face and nothing else, so four visible
  // edges. The bottom face is directly under it: four hidden. Nothing in
  // between is an edge at all.
  const plan = K.hybrid.projectHidden([box], [0, 0, 0], [0, 0, -1], [0, 1, 0]);
  check("a box seen down an axis has four visible edges",
    plan.sharp.length === 4, plan.sharp.length + " runs");
  check("and four hidden ones behind them",
    plan.sharpHidden.length === 4, plan.sharpHidden.length + " runs");
  check("no silhouettes, because nothing about a box is curved",
    plan.outline.length === 0 && plan.outlineHidden.length === 0);
  const size = spanOf({ a: plan.sharp });
  check("drawn at its true size - 200 by 120",
    near(size.width, 200, 1e-6) && near(size.height, 120, 1e-6),
    size.width.toFixed(3) + " x " + size.height.toFixed(3));

  // Down a body diagonal: the isometric cube everybody has drawn. Nine edges
  // visible - three round the near corner and the hexagonal outline - and the
  // three meeting at the far corner hidden.
  const iso = K.hybrid.projectHidden([box], [0, 0, 0],
    [-0.5774, -0.5774, -0.5774], [0, 0, 1]);
  check("seen down a body diagonal, nine are visible",
    iso.sharp.length === 9, iso.sharp.length + " runs");
  check("and exactly three are hidden - the ones at the far corner",
    iso.sharpHidden.length === 3, iso.sharpHidden.length + " runs");

  // A cylinder from the side has no vertical EDGE - its sides are one smooth
  // surface. What you see there is where the surface turns away, and calling
  // that an edge is the mistake that makes a drawing of a pipe look like a
  // drawing of a box.
  const cyl = new oc.BRepPrimAPI_MakeCylinder(
    new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1)), 30, 80).Shape();
  const side = K.hybrid.projectHidden([cyl], [0, 0, 0], [-1, 0, 0], [0, 0, 1]);
  check("a cylinder from the side has two silhouettes",
    side.outline.length === 2, side.outline.length + " outline runs");
  const tall = spanOf({ a: side.outline });
  check("and they are 60 apart and 80 long, which is the pipe",
    near(tall.width, 60, 0.5) && near(tall.height, 80, 0.5),
    tall.width.toFixed(2) + " x " + tall.height.toFixed(2));

  // Nothing to draw is not an error, it is an empty drawing.
  const none = K.hybrid.projectHidden([], [0, 0, 0], [0, 0, -1], [0, 1, 0]);
  check("nothing in gives an empty drawing rather than a throw",
    Object.keys(none).every(k => none[k].length === 0));
}

console.log("\n2. THE MIRROR - the failure a symmetrical building hides");
{
  // Asymmetric on purpose: the far corner of this box is at +200, +120 and
  // there is nothing at -200 or -120. Projected correctly, the drawing sits
  // entirely in the positive quadrant of u and v. Look ALONG the normal
  // instead of back down it and u flips sign - and every line is still there,
  // every length is still right, and the drawing is wrong.
  const box = boxOf(200, 120, 80, [0, 0, 0]);
  const down = K.hybrid.projectHidden([box], [0, 0, 0], [0, 0, -1], [0, 1, 0]);
  const here = spanOf({ a: down.sharp });
  check("looking DOWN at a box in the positive quadrant keeps it there",
    here.lo[0] > -1e-6 && here.lo[1] > -1e-6,
    "lo " + here.lo.map(v => v.toFixed(1)).join(","));
  const up = K.hybrid.projectHidden([box], [0, 0, 0], [0, 0, 1], [0, 1, 0]);
  const other = spanOf({ a: up.sharp });
  check("looking UP at the same box mirrors it, which is how you tell",
    other.hi[0] < 1e-6 && other.lo[0] < -1e-6,
    "lo " + other.lo.map(v => v.toFixed(1)).join(",")
      + " hi " + other.hi.map(v => v.toFixed(1)).join(","));
}

console.log("\n3. THE BOW TIE - a cut loop whose area is half of what it should be");
{
  const box = boxOf(200, 120, 80);
  const plane = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 40), new oc.gp_Dir(0, 0, 1));
  const kept = K.hybrid.trimAtPlane(box, plane, [0, 0, 0]);
  const loops = K.hybrid.cutLoops([kept], [0, 0, 40], [0, 0, 1], [0, 0, -1], [0, 1, 0], {});
  check("one cut region through a solid box", loops.length === 1, loops.length + " loops");
  // 200 x 120 = 24000. A bow tie is 12000, it fills, and it looks like poche.
  check("and its area is 24000, not the 12000 a bow tie would give",
    near(areaOf(loops[0]), 24000, 1), areaOf(loops[0]).toFixed(1));
  check("the loop closes on itself",
    Math.hypot(loops[0][0][0] - loops[0][loops[0].length - 1][0],
               loops[0][0][1] - loops[0][loops[0].length - 1][1]) < 1
      || loops[0].length === 4,
    loops[0].length + " points");

  // A box with a shaft through it: the shaft comes back as its own loop, not
  // filled in. An intersection curve could not tell the two apart.
  const shaft = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(60, 30, -10), 40, 40, 100).Shape();
  const cut = new oc.BRepAlgoAPI_Cut(box, shaft);
  cut.Build();
  const holed = K.hybrid.trimAtPlane(cut.Shape(), plane, [0, 0, 0]);
  const two = K.hybrid.cutLoops([holed], [0, 0, 40], [0, 0, 1], [0, 0, -1], [0, 1, 0], {});
  check("a void in the cut comes back as its own loop", two.length === 2,
    two.length + " loops");
  const areas = two.map(areaOf).sort((a, b) => b - a);
  check("the outside is 24000 and the void is 1600",
    near(areas[0], 24000, 1) && near(areas[1], 1600, 1),
    areas.map(a => a.toFixed(0)).join(" and "));
}

console.log("\n3b. THE QUARTER TURN - the cut out of register with the lines round it");
{
  // The cut face and the projected edges are drawn on the same sheet and must
  // agree about which way u runs. Derived separately they did not, and what
  // that looks like is poche a quarter turn out of register - invisible on a
  // square plan, obvious on anything else, and a rectangle is enough to tell.
  const box = boxOf(200, 120, 80);
  const plane = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 40), new oc.gp_Dir(0, 0, 1));
  const kept = K.hybrid.trimAtPlane(box, plane, [0, 0, 0]);
  // North up, so X runs across the sheet: the plan is 200 wide and 120 tall.
  const look = [0, 0, -1], up = [0, 1, 0];
  const lines = K.hybrid.projectHidden([kept], [0, 0, 40], look, up);
  const loops = K.hybrid.cutLoops([kept], [0, 0, 40], [0, 0, 1], look, up, {});
  const drawn = spanOf({ a: lines.sharp });
  const filled = spanOf({ a: loops });
  check("the cut face lands exactly under the lines drawn round it",
    near(filled.lo[0], drawn.lo[0], 1e-6) && near(filled.lo[1], drawn.lo[1], 1e-6)
      && near(filled.hi[0], drawn.hi[0], 1e-6) && near(filled.hi[1], drawn.hi[1], 1e-6),
    "cut " + filled.width.toFixed(1) + "x" + filled.height.toFixed(1)
      + "  lines " + drawn.width.toFixed(1) + "x" + drawn.height.toFixed(1));
  // And a rectangle is what tells a quarter turn from a shift: 200 x 120 the
  // right way up, 120 x 200 the wrong one.
  check("and it is 200 across by 120 up, not a quarter turn out",
    near(filled.width, 200, 1e-6) && near(filled.height, 120, 1e-6),
    filled.width.toFixed(1) + " x " + filled.height.toFixed(1));
}

console.log("\n4. the frame a drawing lives in");
{
  const down = viewFrame([0, 0, 0], [0, 0, -1], [0, 0, 1]);
  // Looking straight down, "up the sheet" cannot be world Z - that is the
  // direction of travel. It becomes world Y, which is what north-up means.
  check("looking down, up the sheet is world Y",
    near(Math.abs(down.y[1]), 1, 1e-9), JSON.stringify(down.y));
  for (const [a, b, name] of [[down.x, down.y, "x and y"], [down.y, down.z, "y and z"],
                              [down.z, down.x, "z and x"]])
    check(name + " are square to one another",
      near(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], 0, 1e-9));
  for (const [v, name] of [[down.x, "x"], [down.y, "y"], [down.z, "z"]])
    check("the " + name + " axis is a unit vector",
      near(Math.hypot(v[0], v[1], v[2]), 1, 1e-9));

  const side = viewFrame([10, 20, 30], [1, 0, 0], [0, 0, 1]);
  const p = [40, 70, 55];
  const back = fromPlane(toPlane(p, side), side);
  check("a point flattened and put back is where it started",
    p.every((v, i) => near(back[i], v, 1e-9)), JSON.stringify(back));
  // Measured towards the eye, so beyond the plane is negative. The point is
  // 30 further along the way you are looking, which is -30 from the sheet.
  check("and how far beyond the plane it is comes back with it",
    near(toPlane(p, side)[2], -30, 1e-9), String(toPlane(p, side)[2]));
  check("a point in FRONT of the plane is positive, so the two can be told apart",
    toPlane([-20, 70, 55], side)[2] > 0, String(toPlane([-20, 70, 55], side)[2]));
}

console.log("\n5. joining and thinning");
{
  // A square drawn as four separate segments, given in scrambled order and
  // with two of them pointing backwards - which is exactly what hidden-line
  // removal hands over.
  const square = [
    [[0, 0], [10, 0]],
    [[10, 10], [10, 0]],
    [[0, 10], [0, 0]],
    [[10, 10], [0, 10]],
  ];
  const runs = chainPolylines(square, 1e-6);
  check("four segments of a square chain into one run", runs.length === 1,
    runs.length + " runs");
  check("and it closes - five points, first the same as last",
    runs[0].length === 5
      && Math.hypot(runs[0][0][0] - runs[0][4][0], runs[0][0][1] - runs[0][4][1]) < 1e-9,
    runs[0].length + " points");

  const apart = chainPolylines([[[0, 0], [10, 0]], [[50, 50], [60, 50]]], 1e-6);
  check("two segments that do not touch stay two runs", apart.length === 2);

  const zero = chainPolylines([[[0, 0], [0, 0]]], 1e-6);
  check("a segment of no length is not a run", zero.length === 0);

  const straight = [];
  for (let i = 0; i <= 20; i++) straight.push([i * 5, 0]);
  check("twenty-one points in a line thin to two",
    simplify(straight, 1e-4).length === 2, simplify(straight, 1e-4).length + " left");
  const bent = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
  check("but a corner is kept", simplify(bent, 1e-4).length === 3,
    JSON.stringify(simplify(bent, 1e-4)));
  const arc = [];
  for (let i = 0; i <= 32; i++)
    arc.push([Math.cos(i / 32 * Math.PI) * 50, Math.sin(i / 32 * Math.PI) * 50]);
  const thinned = simplify(arc, 0.5);
  check("a curve is thinned but not straightened",
    thinned.length > 4 && thinned.length < arc.length,
    thinned.length + " of " + arc.length);
}

console.log("\n6. layers, pens and what lands on which");
{
  check("every class has a layer", DRAW_CLASSES.every(c => c.layer && c.hint));
  check("seen edges go to Edges", layerForClass("sharp") === "Edges");
  check("a silhouette is not an edge and does not go to that layer",
    layerForClass("outline") === "Silhouette");
  check("all three hidden kinds share one layer",
    ["sharpHidden", "outlineHidden", "smoothHidden"]
      .every(k => layerForClass(k) === "Hidden"));
  check("and a class nobody declared falls back rather than throwing",
    layerForClass("nonsense") === "Edges");

  const hidden = layerPen(DRAW_LAYERS.find(l => l.name === "Hidden"));
  check("the Hidden layer is dashed, because that is the convention",
    hidden.line === "dashed", hidden.line);
  const cut = layerPen({ name: "Cut" });
  check("the Cut layer is the heaviest pen on the sheet", cut.weight === 3, String(cut.weight));
  check("a layer that says nothing still gets the convention for its name",
    layerPen({ name: "Tangent" }).weight === 1);
  const mine = layerPen({ name: "Grid lines" });
  check("and a layer somebody made gets a plain fine pen",
    mine.weight === 1 && mine.line === "solid", mine.weight + " " + mine.line);
  const heavy = layerPen({ name: "Edges", weight: 4.5, line: "chain" });
  check("what a layer does say is what it is drawn with",
    heavy.weight === 4.5 && heavy.line === "chain");
  check("nonsense in a layer record does not become a nonsense pen",
    layerPen({ name: "Edges", weight: "banana", line: "squiggle" }).weight === 1.5
      && layerPen({ name: "Edges", weight: "banana", line: "squiggle" }).line === "solid");

  const same = penRecord({ name: "Hidden" }, { line: "dashed" });
  check("setting a layer to what it already was writes nothing down",
    same.line === undefined, JSON.stringify(same));
  const changed = penRecord({ name: "Hidden" }, { line: "dotted" });
  check("but a real change is written down", changed.line === "dotted");
}

console.log("\n7. point symbols");
{
  check("there are symbols to choose from, each with a name",
    POINT_SYMBOLS.length >= 6 && POINT_SYMBOLS.every(s => s.key && s.label));
  const plus = symbolStrokes("plus", [10, 20], 8);
  check("a plus is two strokes", plus.length === 2, plus.length + " strokes");
  const across = Math.hypot(plus[0][1][0] - plus[0][0][0], plus[0][1][1] - plus[0][0][1]);
  check("and it is as wide as the size it was asked for", near(across, 8, 1e-9),
    across.toFixed(3));
  check("it is centred where it was put",
    near((plus[0][0][0] + plus[0][1][0]) / 2, 10, 1e-9)
      && near((plus[1][0][1] + plus[1][1][1]) / 2, 20, 1e-9));
  const circle = symbolStrokes("circle", [0, 0], 10);
  check("a circle's strokes all sit on its radius",
    circle.every(([a]) => near(Math.hypot(a[0], a[1]), 5, 1e-9)),
    circle.length + " strokes");
  check("a symbol nobody declared draws something rather than nothing",
    symbolStrokes("nonsense", [0, 0], 4).length > 0);
}

console.log("\n8. annotation");
{
  const text = noteOf("text", "n1", [5, 5], { text: "GROUND FLOOR", size: 3 });
  check("text carries its words, its place and its size",
    text.text === "GROUND FLOOR" && text.size === 3 && text.at[0] === 5);
  check("and lands on the Notes layer unless told otherwise", text.layer === "Notes");
  check("text is not stroked here - the two readers draw it their own way",
    noteStrokes(text).length === 0);

  const leader = noteOf("leader", "n2", [0, 0], { via: [10, 10], to: [30, 10] });
  const strokes = noteStrokes(leader);
  check("a leader is its two legs plus an arrowhead", strokes.length === 4,
    strokes.length + " strokes");
  check("and the arrowhead is at the end that points at something",
    strokes.slice(2).every(([a]) => a[0] === 0 && a[1] === 0));

  const mark = noteOf("symbol", "n3", [1, 2], { symbol: "target", size: 6 });
  check("a symbol note strokes as its symbol",
    noteStrokes(mark).length === symbolStrokes("target", [1, 2], 6).length);
  let refused = "";
  try { noteOf("hologram", "n4", [0, 0]); } catch (e) { refused = e.message; }
  check("an annotation nobody has heard of is refused by name",
    /hologram/.test(refused), refused);
}

console.log("\n9. what is in a view, and the exclusion tree");
{
  // The model: a site with two blocks in it, and a storey in one of them.
  const parent = { SITE: null, A: "SITE", B: "SITE", A1: "A", A2: "A", W: "A1" };
  const kids = { SITE: ["A", "B"], A: ["A1", "A2"], A1: ["W"], A2: [], B: [] };
  const parentOf = id => parent[id] || null;
  const childrenOf = id => kids[id] || [];

  check("with nothing excluded, everything is in",
    Object.keys(parent).every(id => includedIn([], id, parentOf)));
  check("excluding one thing excludes that thing",
    !includedIn(["A2"], "A2", parentOf) && includedIn(["A2"], "A1", parentOf));
  check("excluding a set excludes what is inside it, however deep",
    !includedIn(["A"], "W", parentOf), "W is inside A1 inside A");
  check("and leaves its sibling alone", includedIn(["A"], "B", parentOf));

  // The one that matters: something NEW in the model is in the drawing until
  // somebody says otherwise. An inclusion list would have missed it.
  const fresh = "C";
  check("something added to the model after the view was made is IN it",
    includedIn(["A2"], fresh, () => "SITE"));

  const off = toggleExclusion([], "A", false, childrenOf);
  check("switching a set off names the set, not its hundred children",
    off.length === 1 && off[0] === "A", JSON.stringify(off));
  const back = toggleExclusion(["A", "A1"], "A", true, childrenOf);
  check("switching it back on clears the children that were only off with it",
    back.length === 0, JSON.stringify(back));

  check("exclusions survive being written and read",
    readExclusions(writeExclusions(["B", "A"])).join(",") === "A,B");
  check("and a ruined record reads as nothing excluded rather than throwing",
    readExclusions("{not json").length === 0);
}

console.log("\n10. the computed half and the authored half");
{
  const runs = {
    sharp: [[[0, 0], [10, 0]], [[10, 0], [10, 10]]],
    outline: [[[0, 0], [5, 5], [10, 0]]],
    sharpHidden: [[[0, 10], [10, 10]]],
  };
  const computed = elementsFromRuns(runs, { tolerance: 1e-6 });
  check("two points make a line, not a two-point spline",
    computed.some(el => el.type === "line"), JSON.stringify(computed.map(e => e.type)));
  check("three make a spline", computed.some(el => el.type === "spline"));
  check("seen edges land on Edges",
    computed.filter(el => el.layer === "Edges").length >= 1);
  check("the silhouette lands on Silhouette, not with the edges",
    computed.some(el => el.layer === "Silhouette"));
  check("and hidden lines on Hidden",
    computed.some(el => el.layer === "Hidden"));

  const authored = {
    layers: [{ name: "Levels", on: true, locked: false, weight: 2, line: "chain" },
             { name: "Hidden", line: "dotted" }],
    elements: [{ id: "mine1", type: "line", a: [0, 0], b: [1, 1], layer: "Levels" }],
    constraints: [{ type: "horizontal", of: ["mine1"] }],
    notes: [noteOf("text", "n1", [2, 2], { text: "FFL +3.600", layer: "Levels" })],
    current: "Levels",
  };
  const drawing = assembleDrawing(computed, authored, "projection");
  check("the computed lines are in it", drawing.computed === computed.length);
  check("and so is what the user drew",
    drawing.elements.some(el => el.id === "mine1"));
  check("their constraint came through with it",
    drawing.constraints.length === 1);
  check("and their note", drawing.notes.length === 1 && drawing.notes[0].text === "FFL +3.600");
  check("the layer they added is there", drawing.layers.some(l => l.name === "Levels"));
  check("with the pen they gave it",
    layerPen(drawing.layers.find(l => l.name === "Levels")).weight === 2);
  check("a pen they set on a STANDARD layer sticks too",
    layerPen(drawing.layers.find(l => l.name === "Hidden")).line === "dotted");

  // The rule that makes the split honest: you cannot edit what is about to be
  // regenerated, because the edit would go silently.
  const locked = drawing.layers.filter(l => l.locked).map(l => l.name);
  check("every computed layer is locked, so no edit is thrown away silently",
    ["Edges", "Silhouette", "Tangent", "Hidden"].every(n => locked.includes(n)),
    locked.join(","));
  check("and the annotation layer is not, because that half is yours",
    !drawing.layers.find(l => l.name === "Notes").locked);
  check("their own layer is theirs to edit too",
    !drawing.layers.find(l => l.name === "Levels").locked);

  // An id collision here would mean the user's line vanishing on rebuild.
  const again = assembleDrawing(elementsFromRuns(runs, { tolerance: 1e-6 }),
                                drawing, "projection");
  check("rebuilding does not pile the computed lines up",
    again.computed === drawing.computed,
    again.computed + " after, " + drawing.computed + " before");
  check("and does not eat the user's line",
    again.elements.filter(el => el.id === "mine1").length === 1);

  const counts = countByLayer(drawing);
  check("the layer counts include the annotation",
    counts.get("Levels") === 2, String(counts.get("Levels")));

  const cutKind = assembleDrawing([], {}, "cut");
  check("a cut view carries a Cut layer and a projection does not",
    cutKind.layers.some(l => l.name === "Cut")
      && !assembleDrawing([], {}, "projection").layers.some(l => l.name === "Cut"));
}

console.log("\n11. it is a package");
{
  check("it is on the shelf", !!findPlugin("drawings"));
  check("and says what it is for", DRAWINGS.summary.length > 60);
  check("it declares its nodes with the package OFF",
    DRAWING_NODES.length === 2 && DRAWING_NODES.every(n => n.type && n.guid && n.args.length));
  check("none of them is in the catalogue yet",
    DRAWING_NODES.every(n => typeSpec(n.type) === null),
    DRAWING_NODES.map(n => n.type + ":" + !!typeSpec(n.type)).join(" "));
  check("it declares an API, operation by operation",
    DRAWINGS.api.operations.length >= 6
      && DRAWINGS.api.operations.every(o => o.name && o.takes && o.gives && o.summary));
  check("the shelf lists it before anything is loaded",
    availablePlugins().some(p => p.id === "drawings"));
  check("its guids are its own",
    new Set(DRAWING_NODES.map(n => n.guid)).size === DRAWING_NODES.length);
  check("both views ask the same first questions, in the same order",
    DRAWING_NODES[0].args.slice(0, 9).map(a => a.key).join(",")
      === DRAWING_NODES[1].args.slice(0, 9).map(a => a.key).join(","));
  check("and the cut asks the extra ones AFTER them, never among them",
    DRAWING_NODES[1].args.length > DRAWING_NODES[0].args.length
      && DRAWING_NODES[1].args[9].key === "beyond");
  check("the ways of seeing behind a cut are all named",
    BEYOND.length === 3 && BEYOND.every(b => b.key && b.label && b.hint));
}

console.log("\n12. loading it, and drawing something in the real kernel");
{
  const host = new PluginHost({
    toolkit: () => kernel.toolkit(),
    installDrivers: (specs, builders) => kernel.installDrivers(specs, builders),
    removeDrivers: specs => kernel.removeDrivers(specs),
    typesInUse: types => kernel.typesInUse(types),
  });
  await host.load("drawings");
  check("loaded", host.isLoaded("drawings"));
  check("its nodes are catalogue types like any other",
    DRAWING_NODES.every(n => typeSpec(n.type) !== null));

  // A 200 x 120 x 80 block, a horizontal plane through it at 40, and one of
  // each view on that plane, wired to nothing - which is the gesture the whole
  // thing is for: pick a plane, press the button.
  await kernel.loadModel({
    format: "ocaf-parametric-model", version: 1, name: "D", units: "mm",
    features: [
      { id: "PT0", type: "Point", name: "Corner", args: { x: 0, y: 0, z: 0 } },
      { id: "PT1", type: "Point", name: "Level", args: { x: 0, y: 0, z: 40 } },
      { id: "VZ", type: "Vector", name: "Up",
        args: { kind: "Components", dx: 0, dy: 0, dz: 1 } },
      { id: "PL", type: "Plane", name: "At 40",
        args: { origin: { ref: "PT1" }, normal: { ref: "VZ" }, size: 400 } },
      { id: "BX", type: "Cube", name: "Block",
        args: { origin: { ref: "PT0" }, dx: 200, dy: 120, dz: 80 } },
    ],
  });

  const plan = (await kernel.addFeature("ProjectionView", { plane: "PL" })).id;
  let tree = (await kernel.tree()).tree;
  let entry = tree.features.find(f => f.id === plan);
  check("a projection view builds with nothing but a plane", !entry.error,
    entry.error || "");
  check("and says what it drew",
    typeof entry.data.preview === "string" && entry.data.preview.includes("1 body"),
    String(entry.data.preview));

  const cut = (await kernel.addFeature("CutView", { plane: "PL" })).id;
  tree = (await kernel.tree()).tree;
  entry = tree.features.find(f => f.id === cut);
  check("a cut view builds the same way", !entry.error, entry.error || "");
  check("and found the region the plane passed through",
    entry.data.preview.includes("1 cut region"),
    String(entry.data.preview));

  // DRAWING ITSELF: the plan is in the document by the time the cut builds. If
  // a view drew views, the cut would have the plan's lines in it as well as
  // the block's - and every one of those lines would look correct.
  const planAgain = (await kernel.addFeature("ProjectionView", { plane: "PL" })).id;
  tree = (await kernel.tree()).tree;
  const first = tree.features.find(f => f.id === plan);
  const second = tree.features.find(f => f.id === planAgain);
  check("a second view of the same thing draws the same amount",
    second.data.preview === first.data.preview,
    "[" + first.data.preview + "]  vs  [" + second.data.preview + "]");
  check("so a drawing does not draw the other drawings",
    second.data.preview.includes("1 body"));

  // THE EMPTY LAYER: hidden lines are off by default, so there must be none -
  // not a Hidden layer reporting a count of lines nobody can see.
  check("with hidden lines off, none are counted",
    !first.data.preview.includes("hidden"),
    first.data.preview);
  await kernel.setParameter(plan, "hidden", 0);
  tree = (await kernel.tree()).tree;
  const shown = tree.features.find(f => f.id === plan);
  check("and turning them on puts them there",
    shown.data.preview.includes("hidden"), shown.data.preview);

  // Leaving the only body out leaves nothing to draw, and it says so rather
  // than producing an empty drawing that looks like a working one.
  await kernel.setCode(plan, "exclude", writeExclusions(["BX"]));
  tree = (await kernel.tree()).tree;
  const empty = tree.features.find(f => f.id === plan);
  check("a view with everything excluded fails by name rather than drawing nothing",
    !!empty.error && /left out|nothing to draw/.test(empty.error), empty.error || "no error");
  await kernel.setCode(plan, "exclude", "");

  // PER-OBJECT AND PER-SET CUT STYLES, which is what makes a section read: a
  // body told not to hatch must not be hatched, and the count is how you know
  // - a fill that is quietly still there looks exactly like one that is not.
  const bare = tree.features.find(f => f.id === cut).data.preview;
  const hatched = Number((bare.match(/cut (\d+)/) || [])[1] || 0);
  check("a cut view hatches what it passed through", hatched > 1, String(hatched));
  await kernel.setAppearance("BX", { finish: "matte", cut: { pattern: "none" } });
  tree = (await kernel.tree()).tree;
  const plainer = tree.features.find(f => f.id === cut).data.preview;
  const left = Number((plainer.match(/cut (\d+)/) || [])[1] || 0);
  check("a body whose own style says no pattern is not hatched",
    left < hatched && left >= 1, hatched + " lines, then " + left);
  check("but its cut outline is still drawn, because it was still cut",
    plainer.includes("1 cut region"), plainer);
  await kernel.setAppearance("BX", null);
  tree = (await kernel.tree()).tree;
  check("and taking the style off puts the hatch back",
    Number((tree.features.find(f => f.id === cut).data.preview.match(/cut (\d+)/) || [])[1])
      === hatched);

  let refused = "";
  try { await host.unload("drawings"); } catch (e) { refused = e.message; }
  check("it will not unload while a view is in the model",
    /still in the model/.test(refused), refused);
  for (const id of [plan, planAgain, cut]) await kernel.deleteFeature(id);
  await host.unload("drawings");
  check("with the views gone it unloads", !host.isLoaded("drawings"));
  check("and its nodes leave the catalogue with it",
    DRAWING_NODES.every(n => typeSpec(n.type) === null));
  await host.load("drawings");
  check("and it loads again cleanly", host.isLoaded("drawings"));
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall checks passed");
process.exit(failures ? 1 : 0);
