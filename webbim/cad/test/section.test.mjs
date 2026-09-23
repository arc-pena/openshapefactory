// Cutting the model open, and how the cut is drawn.
//
// A section is not a debugging aid - it is the drawing. A plan is a horizontal
// cut at a metre and a half; an elevation is what is left when everything in
// front of the wall is taken away. Two things decide whether it reads: which
// half is kept, and how the cut face is drawn.
//
// The fill is a stencil and belongs where the renderer is. Everything else -
// which half, how far the plane may travel, and the exact line the cut makes
// through the triangles - is arithmetic, and it is checked here.
import { CUT_LINES, CUT_PATTERNS, CUT_WEIGHTS, HATCH_MOTIFS, SECTION_AXES, SECTION_STYLES,
         acrossOf, activePlanes, cutLength, cutRecord, cutStyleOf, dashSegments, freshCuts,
         halfway, keeps, lineNamed, motifsOf, patternNamed, planeOf, refit, ribbonOf, saysCut,
         saysWhere, sectionEdges, styleAsCut, styleNamed, travelOf } from "../src/section.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;

console.log("1. which half is kept, which is the whole question");
{
  // "Level +1500" means a plan: you are standing IN the building, so what
  // stays is everything below. Kept the other way round it is a section of the
  // roof, and nobody pressing Level meant that.
  const plan = planeOf([0, 0, 1], 1500, false);
  check("the floor is kept", keeps(plan, [0, 0, 0]));
  check("and the roof is not", !keeps(plan, [0, 0, 4000]));
  check("the cut itself is on the boundary", keeps(plan, [0, 0, 1500]));
  const flipped = planeOf([0, 0, 1], 1500, true);
  check("flipped asks for the other half on purpose", !keeps(flipped, [0, 0, 0])
        && keeps(flipped, [0, 0, 4000]));
  // The same for a vertical cut: what is kept is what is on the low side.
  const wall = planeOf([1, 0, 0], 200, false);
  check("a cut along X keeps what is behind it",
        keeps(wall, [0, 0, 0]) && !keeps(wall, [500, 0, 0]));
}

console.log("\n2. how far a plane may travel, measured against the model");
{
  // A slider from -1000 to 1000 is no use on a building, so the ends are the
  // model's own extents - and a hair past them, so a plane parked at the limit
  // really is clear of the model rather than shaving a face off it.
  const low = [0, 0, 0], high = [400, 260, 240];
  const up = travelOf(low, high, [0, 0, 1]);
  check("the level runs the height of the model", up.from < 0 && up.to > 240,
        JSON.stringify([up.from, up.to]));
  check("with a margin at either end", up.from < -1 && up.to > 241,
        JSON.stringify([up.from, up.to]));
  check("and it starts in the middle", near(halfway(up), 120, 0.001), String(halfway(up)));
  // Along a negative normal the ends swap, and the travel is still a travel.
  const back = travelOf(low, high, [-1, 0, 0]);
  check("a normal pointing the other way still gives a range that runs the right way",
        back.from < back.to, JSON.stringify([back.from, back.to]));

  const cuts = freshCuts(low, high);
  check("every plane starts switched off", Object.values(cuts).every(c => !c.on));
  check("and parked in the middle of what it would cut",
        near(cuts.z.offset, 120, 0.001), String(cuts.z.offset));
  check("nothing is cut until one is switched on", activePlanes(cuts).length === 0);
  cuts.z.on = true;
  check("and then exactly one is", activePlanes(cuts).length === 1);
  cuts.x.on = true;
  check("two is two, in the order the axes are written",
        activePlanes(cuts).map(p => p.key).join() === "x,z",
        activePlanes(cuts).map(p => p.key).join());

  // The model grows a wing: the planes stay where they are, and the travel is
  // re-measured so the slider still reaches the new end.
  const wider = refit(cuts, [0, 0, 0], [400, 260, 900]);
  check("a plane holds its place when the model grows",
        near(wider.z.offset, 120, 0.001), String(wider.z.offset));
  check("but the travel grows with it", wider.z.travel.to > 900,
        String(wider.z.travel.to));
  check("and the switches survive", wider.z.on && wider.x.on);
  // And one that is now past the end of a model that SHRANK is brought back.
  const shorter = refit(wider, [0, 0, 0], [400, 260, 60]);
  check("a plane past the end of a shrunken model is brought back to it",
        shorter.z.offset <= shorter.z.travel.to, 
        shorter.z.offset + " of " + shorter.z.travel.to);
}

console.log("\n3. the line of the cut, worked out exactly");
{
  // A 400 x 260 box with a 320 x 180 hole through it, as two rings of
  // triangles - cut at any height, the line is the two perimeters, and it is
  // the two perimeters to the millimetre or the drawing is wrong.
  const box = (x0, y0, x1, y1, z0, z1) => {
    // Four walls, two triangles each. No lids: a wall is what a plane cuts.
    const p = [], idx = [];
    const corner = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let i = 0; i < 4; i++) {
      const a = corner[i], b = corner[(i + 1) % 4];
      const base = p.length / 3;
      p.push(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1, a[0], a[1], z1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { positions: p, index: idx };
  };
  const outer = box(0, 0, 400, 260, 0, 240);
  const inner = box(40, 40, 360, 220, 40, 200);
  const plane = { normal: [0, 0, -1], constant: 120 };   // a plan at +120
  const flat = [];
  sectionEdges(outer.positions, outer.index, plane, flat);
  sectionEdges(inner.positions, inner.index, plane, flat);
  const want = 2 * (400 + 260) + 2 * (320 + 180);
  check("the cut line is the outside and the hole, to the millimetre",
        near(cutLength(flat), want, 1e-6), cutLength(flat) + " vs " + want);
  check("as sixteen segments - two per wall face", flat.length / 6 === 16,
        String(flat.length / 6));

  // A plane clear of the model cuts nothing, and says so as a nought rather
  // than as a blank screen nobody can explain.
  const above = [];
  sectionEdges(outer.positions, outer.index, { normal: [0, 0, -1], constant: 9000 }, above);
  check("a plane past the end of the model cuts nothing", above.length === 0);
  // And a plane exactly on a face gives no line either: the face is in the
  // plane, and its neighbours drew the line already.
  const onTop = [];
  sectionEdges(outer.positions, outer.index, { normal: [0, 0, -1], constant: 240 }, onTop);
  check("a plane lying on a face does not draw it twice",
        cutLength(onTop) <= 2 * (400 + 260) + 1e-6, String(cutLength(onTop)));

  // A vertical cut through the same box: two segments per wall it crosses.
  const side = [];
  sectionEdges(outer.positions, outer.index, { normal: [-1, 0, 0], constant: 200 }, side);
  check("a vertical cut gives the two walls it crosses",
        near(cutLength(side), 2 * 240, 1e-6), String(cutLength(side)));
}

console.log("\n4. the styles, and the words for them");
{
  check("four of them", SECTION_STYLES.length === 4,
        SECTION_STYLES.map(s => s.key).join());
  check("open fills nothing", !styleNamed("open").caps && !styleNamed("open").edge);
  check("capped fills and draws the edge",
        styleNamed("capped").caps && styleNamed("capped").edge);
  check("poche fills, hatches and draws the edge",
        styleNamed("poche").caps && styleNamed("poche").hatch && styleNamed("poche").edge);
  check("outline draws the edge and nothing else",
        !styleNamed("outline").caps && styleNamed("outline").edge);
  check("a name nobody has heard of falls back to open",
        styleNamed("banana").key === "open");

  check("the three axes are named for what they cut",
        SECTION_AXES.map(a => a.label).join() === "Along X,Along Y,Level",
        SECTION_AXES.map(a => a.label).join());
  check("a level reads as a level", saysWhere("z", 3000) === "+3000 mm", saysWhere("z", 3000));
  check("and below ground reads as below ground",
        saysWhere("z", -1200) === "−1200 mm", saysWhere("z", -1200));
  check("and a cut along X says which axis it is on",
        saysWhere("x", 500) === "X 500 mm", saysWhere("x", 500));

  // The two directions a handle is drawn across have to be square to the
  // normal, or the frame would not lie in the plane it is a handle for.
  for (const axis of SECTION_AXES) {
    const [u, v] = acrossOf(axis.normal);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    check("the " + axis.key + " handle lies in its own plane",
          Math.abs(dot(u, axis.normal)) < 1e-9 && Math.abs(dot(v, axis.normal)) < 1e-9
          && Math.abs(dot(u, v)) < 1e-9);
  }
}

console.log("\n5. how ONE object is cut, which is where a section stops being a toy");
{
  // A drawing does not hatch everything the same. Concrete is one poche,
  // blockwork another, glass is not hatched at all - so the style belongs to
  // the object, and the window's setting is only what it falls back to.
  const plain = cutStyleOf(null, "poche");
  check("an object that says nothing takes the view's style",
        plain.pattern === "diagonal" && plain.line === "solid", JSON.stringify(plain));
  check("and says it is not its own", plain.own === false);
  const glass = cutStyleOf({ cut: { pattern: "none", line: "dotted" } }, "poche");
  check("one that says something overrides it",
        glass.pattern === "none" && glass.line === "dotted", JSON.stringify(glass));
  check("and says it IS its own", glass.own === true);
  const half = cutStyleOf({ cut: { line: "dashed" } }, "capped");
  check("what it does not say still comes from the view",
        half.pattern === "solid" && half.line === "dashed", JSON.stringify(half));
  check("and \"as the view\" said out loud means the same thing",
        cutStyleOf({ cut: { pattern: "inherit" } }, "poche").pattern === "diagonal");

  // THE MIDDLE LEVEL. A building is styled by trade, not object by object:
  // every wall in the blockwork set poched the same, said once on the set.
  const set = [{ cut: { pattern: "brick", weight: 3 } }];
  const wall = cutStyleOf(null, "poche", set);
  check("an object that says nothing takes the style of the set it is in",
        wall.pattern === "brick" && wall.weight === 3, JSON.stringify(wall));
  check("and says so, so the panel can name where it came from",
        wall.from === "set" && wall.own === false, wall.from);
  const glazed = cutStyleOf({ cut: { pattern: "none" } }, "poche", set);
  check("an object that says something beats the set it is in",
        glazed.pattern === "none" && glazed.from === "own", JSON.stringify(glazed));
  check("and what it does NOT say still comes from the set, not the view",
        glazed.weight === 3, String(glazed.weight));
  // Nearest first, which is what "use the parent" means.
  const nested = cutStyleOf(null, "poche", [{ cut: { weight: 1 } },
                                            { cut: { weight: 4.5, pattern: "brick" } }]);
  check("the nearest set that says anything wins",
        nested.weight === 1, String(nested.weight));
  check("but a field it is silent about falls through to the one above",
        nested.pattern === "brick", nested.pattern);
  check("with no sets at all, nothing changes",
        cutStyleOf(null, "poche", []).from === "view");
  check("and a set that has been given nothing is not a level",
        cutStyleOf(null, "poche", [{ cut: {} }, { cut: { weight: 3 } }]).weight === 3);

  check("the four buttons on the bar are cut styles too",
        styleAsCut("open").pattern === "none" && styleAsCut("capped").pattern === "solid"
        && styleAsCut("poche").pattern === "diagonal"
        && styleAsCut("outline").line === "solid");

  // A weight is in pixels and a scale is a multiple; neither may be nonsense.
  check("a weight is held to something a screen can draw",
        cutStyleOf({ cut: { weight: 900 } }, "capped").weight <= 12
        && cutStyleOf({ cut: { weight: -4 } }, "capped").weight >= 0.5);
  check("and a scale to something you can see",
        cutStyleOf({ cut: { scale: 0 } }, "capped").scale > 0);
  check("a colour that is not a colour is not a colour",
        cutStyleOf({ cut: { fill: "red" } }, "capped").fill === null);

  // What is WRITTEN is only what differs, so an object nobody has styled
  // carries nothing at all and follows the bar for ever after.
  check("nothing said is nothing written", cutRecord({ pattern: "inherit" }) === null);
  check("something said is written", cutRecord({ pattern: "dots" }).pattern === "dots");
  check("and it keeps what was already there",
        cutRecord({ weight: 3 }, { pattern: "dots" }).pattern === "dots");
  check("while a field set back to the view is taken out",
        cutRecord({ pattern: "inherit" }, { pattern: "dots", weight: 3 }).pattern === undefined,
        JSON.stringify(cutRecord({ pattern: "inherit" }, { pattern: "dots", weight: 3 })));

  check("twelve patterns and six kinds of line",
        CUT_PATTERNS.length === 12 && CUT_LINES.length === 6,
        CUT_PATTERNS.map(p => p.key).join());
  check("and the weights are the ones on a drawing board", CUT_WEIGHTS.length === 5);
  check("a pattern nobody has heard of falls back to the view",
        patternNamed("marzipan").key === "inherit");
  check("and so does a line", lineNamed("wiggly").key === "inherit");
  check("a style says what it is in one line",
        saysCut(cutStyleOf({ cut: { pattern: "dots", line: "dashed", weight: 2 } }, "capped"))
          === "dots \u00b7 dashed at 2",
        saysCut(cutStyleOf({ cut: { pattern: "dots", line: "dashed", weight: 2 } }, "capped")));

  // HOW MANY OF THE MOTIF ARE IN A TILE is one fact, and the reason it is one
  // fact is that a hatch nine pixels wide holding six lines is not a hatch -
  // it is a grey smear that looks the same whatever pattern it was.
  check("a line hatch has six in a tile", motifsOf("diagonal") === HATCH_MOTIFS);
  check("a brick bond has four courses", motifsOf("brick") === 4);
  check("and a picture of your own is one", motifsOf("image") === 1
        && motifsOf("solid") === 1);
}

console.log("\n6. dashes, chopped rather than shaded");
{
  // A dash is a shorter segment. Exact, no material to get wrong, and it works
  // with the screen-space width the line is drawn at.
  const line = [0, 0, 0, 100, 0, 0];
  const dashed = dashSegments(line, 10, 0.6);
  check("a hundred millimetres at ten becomes ten dashes",
        dashed.length / 6 === 10, String(dashed.length / 6));
  check("each one six millimetres long", near(cutLength(dashed), 60, 1e-9),
        String(cutLength(dashed)));
  check("the first starts where the line does", dashed[0] === 0 && dashed[3] === 6,
        dashed.slice(0, 6).join(","));
  const dotted = dashSegments(line, 4, 0.25);
  check("a shorter duty makes dots", near(cutLength(dotted), 25, 1e-9),
        String(cutLength(dotted)));
  check("no period at all leaves the line alone",
        dashSegments(line, 0).length === line.length);
  // A chain line is a long dash and a dot, which is what a centre line is.
  const chain = dashSegments(line, 20, 0.7, 3);
  check("a chain line has two marks per cycle",
        chain.length / 6 > 2 && cutLength(chain) < 100, String(cutLength(chain)));
  // A dash never runs past the end of the segment it is chopping.
  const stub = dashSegments([0, 0, 0, 7, 0, 0], 10, 1);
  check("and never runs off the end of what it is chopping",
        near(cutLength(stub), 7, 1e-9), String(cutLength(stub)));
}

console.log("\n7. a line with weight, which WebGL will not draw");
{
  // So it is a ribbon: a quad per segment, expanded sideways IN THE CUT PLANE
  // - because that is the plane the line lies in and a line drawn on a cut
  // face should stay on it.
  const flat = [0, 0, 0, 100, 0, 0, 100, 0, 0, 100, 100, 0];
  const ribbon = ribbonOf(flat, [0, 0, 1]);
  check("two segments make two quads", ribbon.index.length === 12,
        String(ribbon.index.length));
  check("four corners each", ribbon.position.length / 3 === 8);
  check("and a side of plus and minus one for every corner",
        ribbon.side.join() === "1,-1,1,-1,1,-1,1,-1", ribbon.side.join());
  // The first segment runs along X in the z = 0 plane, so it is expanded
  // along Y - never along Z, which would lift it off the cut.
  check("expanded square to the segment and square to the normal",
        near(Math.abs(ribbon.offset[1]), 1, 1e-9) && near(ribbon.offset[2], 0, 1e-9),
        ribbon.offset.slice(0, 3).join(","));
  check("and the second segment the other way",
        near(Math.abs(ribbon.offset[12]), 1, 1e-9), ribbon.offset.slice(12, 15).join(","));
  check("a segment of no length is left out",
        ribbonOf([5, 5, 5, 5, 5, 5], [0, 0, 1]).index.length === 0);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
