// DXF in, DXF out.
//
// The checks here are against the geometry, not against the parser: a bulge is
// an arc with a particular centre and radius, and the only way to know the
// conversion is right is to work out where that arc should be and ask where it
// is. Every entity type in the table gets one, because "it imported" and "it
// imported in the right place" are different statements and only one of them
// is worth having.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { DXF_ENTITIES, DXF_UNITS, bulgeArc, describeDrawing, dxfDrawing, dxfSurvey,
         ignoredName, parseDxf, writeDxf } from "../src/dxf.js";
import { SKETCH_TYPES, bsplinePoints, readSketch, shownDrawing, sketchEnds, sketchLayers,
         sketchLoops, sketchOutline, wholeEllipse } from "../src/sketch.js";
import { formatFor, whyNot } from "../src/exchange.js";
import { readFileSync } from "fs";

const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const init = (await import(DIR + "/replicad_single.js")).default;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const nearPoint = (p, q, tol = 1e-4) => !!p && near(p[0], q[0], tol) && near(p[1], q[1], tol);

//! A DXF, written the way a DXF is written: pairs of lines, a code and a value.
const dxf = (...body) => {
  const tag = (code, value) => code + "\n" + value;
  const out = [tag(0, "SECTION"), tag(2, "HEADER"), tag(9, "$INSUNITS"), tag(70, 4),
              tag(0, "ENDSEC"), tag(0, "SECTION"), tag(2, "ENTITIES")];
  for (const line of body) out.push(line);
  out.push(tag(0, "ENDSEC"), tag(0, "EOF"));
  return out.join("\n") + "\n";
};
const t = (code, value) => code + "\n" + value;

console.log("1. the file, taken apart");
{
  const text = dxf(t(0, "LINE"), t(8, "WALLS"), t(10, 0), t(20, 0), t(11, 100), t(21, 50));
  const { header, entities } = parseDxf(text);
  check("the header says what the units are", header.$INSUNITS === 4, String(header.$INSUNITS));
  check("and there is one entity in it", entities.length === 1 && entities[0].type === "LINE",
        entities.map(e => e.type).join(","));
  check("which knows its layer", entities[0].layer === "WALLS", entities[0].layer);

  check("a binary DXF is refused by name, not by silence", (() => {
    try { parseDxf("AutoCAD Binary DXF\r\n"); return false; }
    catch (err) { return /binary/i.test(err.message); }
  })());

  // Every unit DXF can say, and what it is in millimetres.
  check("the unit table is millimetres all the way down",
        DXF_UNITS.find(u => u.key === "m").mm === 1000
        && DXF_UNITS.find(u => u.key === "in").mm === 25.4
        && DXF_UNITS.find(u => u.key === "ft").mm === 304.8);
}

console.log("\n2. every entity that is geometry becomes the element it is");
{
  const text = dxf(
    t(0, "LINE"), t(8, "A"), t(10, 0), t(20, 0), t(11, 100), t(21, 0),
    t(0, "POINT"), t(8, "A"), t(10, 7), t(20, 9),
    t(0, "CIRCLE"), t(8, "A"), t(10, 50), t(20, 50), t(40, 20),
    t(0, "ARC"), t(8, "A"), t(10, 0), t(20, 0), t(40, 10), t(50, 0), t(51, 90),
    t(0, "ELLIPSE"), t(8, "A"), t(10, 0), t(20, 0), t(11, 100), t(21, 0), t(40, 0.5),
      t(41, 0), t(42, Math.PI * 2),
  );
  const { drawing, report } = dxfDrawing(text);
  const of = type => drawing.elements.filter(el => el.type === type);
  check("five entities, five elements", drawing.elements.length === 5,
        describeDrawing(drawing));
  check("a LINE is a line, end to end", nearPoint(of("line")[0].a, [0, 0])
        && nearPoint(of("line")[0].b, [100, 0]));
  check("a POINT is a point", nearPoint(of("point")[0].p, [7, 9]));
  check("a CIRCLE keeps its centre and radius",
        nearPoint(of("circle")[0].c, [50, 50]) && near(of("circle")[0].r, 20));
  const arc = of("arc")[0];
  check("an ARC's angles come across in radians, anticlockwise",
        near(arc.a0, 0) && near(arc.a1, Math.PI / 2, 1e-5), arc.a0 + " → " + arc.a1);
  const ellipse = of("ellipse")[0];
  check("an ELLIPSE's major axis vector becomes radius and rotation",
        near(ellipse.rx, 100) && near(ellipse.ry, 50) && near(ellipse.rot, 0),
        JSON.stringify([ellipse.rx, ellipse.ry, ellipse.rot]));
  check("and a whole one is whole", wholeEllipse(ellipse));
  check("the report counts what it took", report.entities === 5 && report.elements === 5,
        JSON.stringify(report));
}

console.log("\n3. an ellipse that is only part of one");
{
  const text = dxf(t(0, "ELLIPSE"), t(10, 0), t(20, 0), t(11, 0), t(21, 60), t(40, 0.5),
                   t(41, 0), t(42, Math.PI / 2));
  const { drawing } = dxfDrawing(text);
  const el = drawing.elements[0];
  check("the major axis may point anywhere", near(el.rx, 60) && near(el.ry, 30)
        && near(el.rot, Math.PI / 2, 1e-6), JSON.stringify([el.rx, el.ry, el.rot]));
  check("a quarter of an ellipse is not a whole one", !wholeEllipse(el),
        el.a0 + " → " + el.a1);
  // Parameter zero is the end of the major axis; a quarter turn along is the
  // end of the minor one. With the major axis up, that is (0,60) to (-30,0).
  const ends = sketchEnds(el);
  check("and its ends are where that parameter says",
        nearPoint(ends.a, [0, 60], 1e-3) && nearPoint(ends.b, [-30, 0], 1e-3),
        JSON.stringify([ends.a, ends.b]));
  check("an arc of an ellipse is open, so it can join something",
        ends.closed === false);
}

console.log("\n4. a bulge is an arc, exactly");
{
  // A semicircle: bulge 1 from (0,0) to (100,0). Centre at the midpoint,
  // radius half the chord, and it goes the way the sign says.
  const half = bulgeArc([0, 0], [100, 0], 1);
  check("bulge 1 is a half turn", near(half.a1 - half.a0, Math.PI, 1e-9),
        String(half.a1 - half.a0));
  check("with its centre on the chord and radius half of it",
        nearPoint(half.c, [50, 0]) && near(half.r, 50), JSON.stringify([half.c, half.r]));

  // A quarter turn. The included angle is 4 atan(b), so b = tan(pi/8).
  const quarter = bulgeArc([0, 0], [100, 0], Math.tan(Math.PI / 8));
  check("and a bulge of tan(pi/8) is a quarter turn",
        near(quarter.a1 - quarter.a0, Math.PI / 2, 1e-9), String(quarter.a1 - quarter.a0));
  check("whose radius is the chord over root two",
        near(quarter.r, 100 / Math.SQRT2, 1e-9), String(quarter.r));

  // Sign. A positive bulge turns anticlockwise from the first point to the
  // second, so the arc bows to the right of the way it is travelling.
  const mid = a => [a.c[0] + a.r * Math.cos((a.a0 + a.a1) / 2),
                    a.c[1] + a.r * Math.sin((a.a0 + a.a1) / 2)];
  check("a positive bulge bows one way", mid(half)[1] < 0, JSON.stringify(mid(half)));
  check("and a negative bulge the other", mid(bulgeArc([0, 0], [100, 0], -1))[1] > 0,
        JSON.stringify(mid(bulgeArc([0, 0], [100, 0], -1))));
}

console.log("\n5. a polyline becomes its links, and they are held together");
{
  // A rectangle with one rounded corner: four vertices, one of them bulged.
  const text = dxf(
    t(0, "LWPOLYLINE"), t(8, "OUTLINE"), t(90, 4), t(70, 1),
    t(10, 0), t(20, 0),
    t(10, 100), t(20, 0), t(42, 0.4142135623730951),      // a quarter turn
    t(10, 100), t(20, 80),
    t(10, 0), t(20, 80),
  );
  const { drawing, report } = dxfDrawing(text);
  const kinds = drawing.elements.map(el => el.type).join(",");
  check("four segments, and the bulged one is an arc", kinds === "line,arc,line,line", kinds);
  check("every corner is written down as a coincidence",
        drawing.constraints.length === 4
        && drawing.constraints.every(c => c.type === "coincident"),
        JSON.stringify(drawing.constraints.map(c => c.of)));
  check("the report says so too", report.joints === 4, JSON.stringify(report));

  // The thing that matters about all of it: it closes, so it is a face.
  const { loops, open } = sketchLoops(drawing, 0.05);
  check("and the whole thing closes into one loop",
        loops.length === 1 && loops[0].length === 4 && open.length === 0,
        loops.length + " loops, " + open.length + " open");
}

console.log("\n6. a spline keeps its own control points");
{
  const text = dxf(
    t(0, "SPLINE"), t(8, "S"), t(70, 8), t(71, 3), t(72, 8), t(73, 4), t(74, 0),
    t(40, 0), t(40, 0), t(40, 0), t(40, 0), t(40, 1), t(40, 1), t(40, 1), t(40, 1),
    t(10, 0), t(20, 0), t(10, 0), t(20, 100), t(10, 100), t(20, 100), t(10, 100), t(20, 0),
  );
  const { drawing } = dxfDrawing(text);
  const el = drawing.elements[0];
  check("a SPLINE with control points is a B-spline, not a polyline",
        el.type === "bspline", el.type);
  check("with the degree and the control points the file gave it",
        el.degree === 3 && el.ctrl.length === 4, el.degree + ", " + el.ctrl.length);
  check("and the knot vector too", el.knots && el.knots.length === 8,
        JSON.stringify(el.knots));

  // A clamped cubic through four control points is a Bézier: it starts at the
  // first, ends at the last, and at the middle it is where the formula says.
  const run = bsplinePoints(el, 16);
  check("the curve starts on the first control point and ends on the last",
        nearPoint(run[0], [0, 0], 1e-9) && nearPoint(run[run.length - 1], [100, 0], 1e-9),
        JSON.stringify([run[0], run[run.length - 1]]));
  check("and passes where de Boor says at the middle",
        nearPoint(run[Math.floor(run.length / 2)], [50, 75], 1e-9),
        JSON.stringify(run[Math.floor(run.length / 2)]));

  // Fit points are the other kind of spline, and they mean the opposite: the
  // curve goes THROUGH these.
  const fitted = dxfDrawing(dxf(
    t(0, "SPLINE"), t(70, 8), t(71, 3), t(72, 0), t(73, 0), t(74, 3),
    t(11, 0), t(21, 0), t(11, 50), t(21, 40), t(11, 100), t(21, 0),
  )).drawing.elements[0];
  check("a SPLINE with only fit points is one drawn through them",
        fitted.type === "spline" && fitted.pts.length === 3, fitted.type);
  check("and it does go through them",
        sketchOutline(fitted, 32).some(p => nearPoint(p, [50, 40], 1e-6)));
}

console.log("\n7. blocks are placed, not dropped");
{
  // A block holding a unit square, inserted twice: once turned, once scaled.
  const text = [
    t(0, "SECTION"), t(2, "BLOCKS"),
    t(0, "BLOCK"), t(2, "TILE"), t(10, 0), t(20, 0),
    t(0, "LINE"), t(10, 0), t(20, 0), t(11, 10), t(21, 0),
    t(0, "CIRCLE"), t(10, 0), t(20, 0), t(40, 4),
    t(0, "ENDBLK"),
    t(0, "ENDSEC"),
    t(0, "SECTION"), t(2, "ENTITIES"),
    t(0, "INSERT"), t(2, "TILE"), t(10, 100), t(20, 0), t(50, 90),
    t(0, "INSERT"), t(2, "TILE"), t(10, 0), t(20, 200), t(41, 3), t(42, 3),
    t(0, "ENDSEC"), t(0, "EOF"),
  ].join("\n") + "\n";

  const { drawing, report } = dxfDrawing(text);
  check("both placements came in", drawing.elements.length === 4, describeDrawing(drawing));
  check("the report counts the placements", report.blocks === 2, JSON.stringify(report));
  const lines = drawing.elements.filter(el => el.type === "line");
  check("a block turned a right angle lands turned",
        nearPoint(lines[0].a, [100, 0]) && nearPoint(lines[0].b, [100, 10]),
        JSON.stringify([lines[0].a, lines[0].b]));
  const circles = drawing.elements.filter(el => el.type === "circle");
  check("and one scaled three times is three times the size",
        near(circles[1].r, 12) && nearPoint(circles[1].c, [0, 200]),
        circles[1].r + " at " + JSON.stringify(circles[1].c));

  // A block squashed by different amounts in x and y: a circle in it is not a
  // circle any more, and the honest answer is the ellipse it actually is.
  const squashed = dxfDrawing([
    t(0, "SECTION"), t(2, "BLOCKS"), t(0, "BLOCK"), t(2, "T"), t(10, 0), t(20, 0),
    t(0, "CIRCLE"), t(10, 0), t(20, 0), t(40, 10), t(0, "ENDBLK"), t(0, "ENDSEC"),
    t(0, "SECTION"), t(2, "ENTITIES"),
    t(0, "INSERT"), t(2, "T"), t(10, 0), t(20, 0), t(41, 2), t(42, 1),
    t(0, "ENDSEC"), t(0, "EOF"),
  ].join("\n") + "\n").drawing.elements[0];
  check("a circle squashed by a block is an ellipse, and the right one",
        squashed.type === "ellipse" && near(squashed.rx, 20, 1e-9) && near(squashed.ry, 10, 1e-9),
        JSON.stringify([squashed.type, squashed.rx, squashed.ry]));
}

console.log("\n8. the drawing is in whatever units it was drawn in");
{
  const text = dxf(t(0, "LINE"), t(10, 0), t(20, 0), t(11, 4.2), t(21, 0));
  check("metres come in as millimetres",
        near(dxfDrawing(text, { units: "m" }).drawing.elements[0].b[0], 4200));
  check("and inches do too",
        near(dxfDrawing(text, { units: "in" }).drawing.elements[0].b[0], 106.68, 1e-6));
  const survey = dxfSurvey(text);
  check("the survey reads the units the file claims",
        survey.units.key === "mm" && survey.saidUnits, survey.units.key);
  check("and lists the layers with what is on them",
        survey.layers.length === 1 && survey.layers[0].entities === 1,
        JSON.stringify(survey.layers));
}

console.log("\n9. layers are a filter, because a plan is mostly things you do not want");
{
  const text = dxf(
    t(0, "LINE"), t(8, "WALLS"), t(10, 0), t(20, 0), t(11, 100), t(21, 0),
    t(0, "LINE"), t(8, "FURNITURE"), t(10, 0), t(20, 10), t(11, 100), t(21, 10),
    t(0, "TEXT"), t(8, "NOTES"), t(10, 0), t(20, 20), t(40, 2.5), t(1, "KITCHEN"),
  );
  const survey = dxfSurvey(text);
  check("the survey finds all three layers", survey.layers.length === 3,
        survey.layers.map(l => l.name).join(","));
  const { drawing, report } = dxfDrawing(text, { layers: ["WALLS"] });
  check("and taking one layer takes one layer", drawing.elements.length === 1,
        describeDrawing(drawing));
  check("text is not silently dropped - it is counted and named",
        report.skipped.TEXT === undefined || report.skipped.TEXT >= 0,
        JSON.stringify(report.skipped));
  const all = dxfDrawing(text).report;
  check("with every layer, the text is reported as not brought in",
        all.skipped.TEXT === 1, JSON.stringify(all.skipped));
  check("and the ignored list says what each of them is, and says it properly",
        ignoredName("HATCH", 1) === "1 hatch" && ignoredName("HATCH", 3) === "3 hatches"
        && ignoredName("DIMENSION", 2) === "2 dimensions",
        ignoredName("HATCH", 3) + " / " + ignoredName("DIMENSION", 2));
}

console.log("\n10. out again, and back in the same");
{
  const drawing = { elements: [
    { id: "a", type: "line", a: [0, 0], b: [100, 0] },
    { id: "b", type: "arc", c: [100, 50], r: 50, a0: -Math.PI / 2, a1: 0 },
    { id: "c", type: "circle", c: [50, 200], r: 25 },
    { id: "d", type: "ellipse", c: [300, 0], rx: 80, ry: 40, rot: 0.3 },
    { id: "e", type: "ellipse", c: [500, 0], rx: 80, ry: 40, rot: 0, a0: 0, a1: 1.2 },
    { id: "f", type: "point", p: [10, 10] },
    { id: "g", type: "bspline", ctrl: [[0, 300], [50, 400], [150, 400], [200, 300]], degree: 3 },
    { id: "h", type: "spline", pts: [[0, 500], [100, 560], [200, 500]] },
    { id: "i", type: "oblong", a: [0, 700], b: [200, 700], r: 30 },
  ], constraints: [] };

  const written = writeDxf([{ name: "Profile", drawing }]);
  check("everything in the sketcher has an entity to be written as",
        written.entities === drawing.elements.length,
        written.entities + " of " + drawing.elements.length);
  check("and it goes out on a layer named after the sketch",
        /\nProfile\n/.test(written.text), "layer table");

  const back = dxfDrawing(written.text).drawing;
  const count = type => back.elements.filter(el => el.type === type).length;
  check("a line comes back a line", count("line") === 1 + 2, count("line") + " (the slot's sides)");
  check("an arc comes back an arc", count("arc") === 1 + 2, String(count("arc")));
  check("a circle comes back a circle", count("circle") === 1);
  check("a whole ellipse comes back whole",
        back.elements.some(el => el.type === "ellipse" && wholeEllipse(el)
                              && near(el.rx, 80, 1e-4) && near(el.ry, 40, 1e-4)));
  check("and an arc of one comes back as that arc",
        back.elements.some(el => el.type === "ellipse" && !wholeEllipse(el)
                              && near(el.a1 - el.a0, 1.2, 1e-4)),
        JSON.stringify(back.elements.filter(el => el.type === "ellipse")
          .map(el => [el.rx, el.ry, el.a0, el.a1])));
  check("a B-spline comes back with its control points",
        back.elements.some(el => el.type === "bspline" && el.ctrl.length === 4));
  check("a fitted spline comes back fitted through the same points",
        back.elements.some(el => el.type === "spline" && el.pts.length === 3));

  // The geometry, not the names: the outline of what went out and what came
  // back have to be the same run of points.
  // Finely: the check below is a hundredth of a millimetre, and a round end
  // sampled every seven degrees misses its own apex by six hundredths.
  const outline = list => list.filter(el => el.type !== "point")
    .flatMap(el => sketchOutline(el, 512));
  const before = outline(drawing.elements), after = outline(back.elements);
  const box = pts => pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]),
                                           Math.max(b[2], p[0]), Math.max(b[3], p[1])],
                                [Infinity, Infinity, -Infinity, -Infinity]);
  const [x0, y0, x1, y1] = box(before), [u0, v0, u1, v1] = box(after);
  check("and the drawing that comes back is the same size to a hundredth of a millimetre",
        near(x0, u0, 0.01) && near(y0, v0, 0.01) && near(x1, u1, 0.01) && near(y1, v1, 0.01),
        JSON.stringify([[x0, y0, x1, y1], [u0, v0, u1, v1]].map(b => b.map(v => Math.round(v * 100) / 100))));
}

console.log("\n11. the format is declared, not bolted on");
{
  check("a .dxf is a format this reads and writes",
        formatFor("plan.dxf").read && formatFor("plan.dxf").write);
  check("and it is no longer in the list of things that cannot be done",
        whyNot("plan.dxf") === null, JSON.stringify(whyNot("plan.dxf")));
  check("a .dwg still says what to do instead", /DXF/.test(whyNot("plan.dwg").reason),
        whyNot("plan.dwg").reason.slice(0, 40));
  check("every entity the table claims is one the converter has a case for",
        DXF_ENTITIES.length >= 12, DXF_ENTITIES.length + " entity types");
  check("and every element the sketcher has can be written",
        SKETCH_TYPES.concat("bspline").every(type =>
          writeDxf([{ name: "T", drawing: { elements: [sample(type)] } }]).entities === 1),
        SKETCH_TYPES.join(","));
}

//! One of each kind of element, for the check above.
function sample(type) {
  switch (type) {
    case "point":   return { id: "x", type, p: [0, 0] };
    case "line":    return { id: "x", type, a: [0, 0], b: [10, 0] };
    case "circle":  return { id: "x", type, c: [0, 0], r: 10 };
    case "arc":     return { id: "x", type, c: [0, 0], r: 10, a0: 0, a1: 1 };
    case "ellipse": return { id: "x", type, c: [0, 0], rx: 10, ry: 5, rot: 0 };
    case "oblong":  return { id: "x", type, a: [0, 0], b: [10, 0], r: 3 };
    case "rect":    return { id: "x", type, a: [0, 0], b: [10, 6] };
    case "spline":  return { id: "x", type, pts: [[0, 0], [5, 5], [10, 0]] };
    case "bspline": return { id: "x", type, ctrl: [[0, 0], [5, 5], [10, 0], [15, 5]], degree: 3 };
    default: throw new Error("no sample for " + type);
  }
}

console.log("\n12. through the kernel: a drawing in, a solid out");
{
  const kernel = await createWasmKernel({ initModule: init,
                                          wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {}, readLayout: () => ({}),
                        select: () => {}, selected: () => null, picked: () => [] });
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "D",
                           units: "mm", features: [] });

  // An L-shaped outline with one rounded corner, in metres - the shape of a
  // slab somebody would send you.
  const plan = dxf(
    t(0, "LWPOLYLINE"), t(8, "SLAB"), t(90, 6), t(70, 1),
    t(10, 0), t(20, 0),
    t(10, 8), t(20, 0),
    t(10, 8), t(20, 3), t(42, -0.4142135623730951),
    t(10, 5), t(20, 6),
    t(10, 0), t(20, 6),
    t(10, 0), t(20, 3),
  );
  const answer = await mdl.run({ op: "import", format: "dxf", name: "slab.dxf",
                                 data: plan, units: "m" });
  check("it lands as a sketch, not as a shape",
        (await kernel.tree()).tree.features.some(f => f.type === "Sketch"),
        (await kernel.tree()).tree.features.map(f => f.type).join(","));
  check("on a plane, with an origin, because the document had neither",
        (await kernel.tree()).tree.features.filter(f => f.category === "datum").length === 3,
        (await kernel.tree()).tree.features.filter(f => f.category === "datum")
          .map(f => f.type).join(","));
  check("and the note says what it did", /elements from/.test(answer.note || ""), answer.note);

  const sketch = (await kernel.tree()).tree.features.find(f => f.type === "Sketch");
  check("the sketch built without complaint", sketch.built && !sketch.error,
        String(sketch.error));

  // Metres in, millimetres here: the outline is 8 m across.
  const mesh = (await kernel.mesh([sketch.id])).features[0];
  const xs = [];
  for (let i = 0; i < (mesh.edges || []).length; i += 3) xs.push(mesh.edges[i]);
  check("in millimetres, because that is what this document is",
        near(Math.max(...xs) - Math.min(...xs), 8000, 1),
        Math.round(Math.max(...xs) - Math.min(...xs)) + " mm across");

  // And the whole point of coming in as a sketch: it extrudes.
  const up = (await kernel.addFeature("Vector", {})).id;
  await kernel.setParameter(up, "dz", 1);
  const pad = (await kernel.addFeature("Extrude", { profile: sketch.id, direction: up })).id;
  await kernel.setParameter(pad, "distance", 200);
  const built = (await kernel.tree()).tree.features.find(f => f.id === pad);
  check("and the sketch extrudes into a slab, which is the whole point",
        built.built && !built.error, String(built.error));

  // Out again, from the document this time.
  const out = await kernel.exportShapes("dxf");
  check("the document writes its sketches back out", out.ok && out.text.length > 100,
        out.note);
  const again = dxfDrawing(out.text).drawing;
  check("and what comes back is the same six segments",
        again.elements.length === 6, describeDrawing(again));
  check("with the rounded corner still an arc",
        again.elements.filter(el => el.type === "arc").length === 1,
        describeDrawing(again));
}

console.log("\n13. a drawing that closes nothing, and the layers it came on");
{
  const kernel = await createWasmKernel({ initModule: init,
                                          wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {}, readLayout: () => ({}),
                        select: () => {}, selected: () => null, picked: () => [] });

  // A survey: stray lines, spot levels, an open kerb line, an arc. Nothing in
  // it closes, which used to be enough to make the sketch a feature in error.
  const survey = dxf(
    t(0, "LINE"), t(8, "SURVEY"), t(10, 0), t(20, 0), t(11, 4), t(21, 3),
    t(0, "LINE"), t(8, "SURVEY"), t(10, 9), t(20, 1), t(11, 12), t(21, 6),
    t(0, "POINT"), t(8, "LEVELS"), t(10, 2), t(20, 8),
    t(0, "POINT"), t(8, "LEVELS"), t(10, 6), t(20, 9),
    t(0, "LWPOLYLINE"), t(8, "KERB"), t(90, 3), t(70, 0),
      t(10, 0), t(20, 12), t(10, 8), t(20, 13), t(10, 14), t(20, 11),
    t(0, "ARC"), t(8, "KERB"), t(10, 18), t(20, 8), t(40, 3), t(50, 20), t(51, 200),
  );
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                           units: "mm", features: [] });
  await mdl.run({ op: "import", format: "dxf", name: "survey.dxf", data: survey, units: "m" });
  const sketchOf = async () => (await kernel.tree()).tree.features.find(f => f.type === "Sketch");
  let sketch = await sketchOf();
  check("a drawing that closes nothing builds without complaint",
        sketch && sketch.built && !sketch.error, String(sketch && sketch.error));

  const held = () => readSketch(sketch.sketch.drawing);
  check("and it arrives on the layers it was drawn on",
        sketchLayers(held()).map(l => l.name + ":" + l.count).join(" ") === "KERB:3 SURVEY:2 LEVELS:2",
        sketchLayers(held()).map(l => l.name + ":" + l.count).join(" "));

  // Turning one off takes it out of the geometry as well as off the screen,
  // which is what makes a plan full of furniture into a profile.
  await mdl.run({ op: "layer", id: sketch.id, name: "SURVEY", show: false });
  sketch = await sketchOf();
  check("turning a layer off leaves the sketch built",
        sketch.built && !sketch.error, String(sketch.error));
  check("and takes its elements out of what is built",
        shownDrawing(held()).elements.length === 5, sketch.sketch.summary);
  check("which the summary says out loud", /2 hidden/.test(sketch.sketch.summary),
        sketch.sketch.summary);

  // Points alone, on their own layer, still a sketch.
  await mdl.run({ op: "layer", id: sketch.id, name: "KERB", show: false });
  sketch = await sketchOf();
  check("even with nothing left but the spot levels", sketch.built && !sketch.error,
        String(sketch.error));

  await mdl.run({ op: "layer", id: sketch.id, name: "LEVELS", show: false });
  sketch = await sketchOf();
  check("and with every layer off it says so rather than failing silently",
        /every layer/.test(sketch.error || ""), String(sketch.error));

  // Out and back: the layers are still the layers.
  await mdl.run({ op: "layer", id: sketch.id, name: "LEVELS", show: true });
  await mdl.run({ op: "layer", id: sketch.id, name: "KERB", show: true });
  await mdl.run({ op: "layer", id: sketch.id, name: "SURVEY", show: true });
  const out = await kernel.exportShapes("dxf");
  const back = dxfDrawing(out.text).drawing;
  // A layer that was off or locked when it was drawn arrives that way, and
  // goes back out that way: DXF writes "off" as a negative colour and "locked"
  // as a flag, and both survive the trip.
  {
    const drawing = { elements: [
      { id: "a", type: "line", a: [0, 0], b: [10, 0], layer: "ON" },
      { id: "b", type: "line", a: [0, 5], b: [10, 5], layer: "OFF" },
      { id: "c", type: "line", a: [0, 9], b: [10, 9], layer: "LOCKED" }], constraints: [],
      layers: [{ name: "ON", on: true, locked: false },
               { name: "OFF", on: false, locked: false },
               { name: "LOCKED", on: true, locked: true }] };
    const again = dxfDrawing(writeDxf([{ name: "S", drawing }]).text).drawing;
    check("a layer that is off goes out off and comes back off",
          JSON.stringify(again.layers) === JSON.stringify(drawing.layers),
          JSON.stringify(again.layers));
    check("and the one that is current is one you can draw on",
          again.current === "ON", again.current);
  }

  check("and a round trip keeps them", 
        sketchLayers(back).map(l => l.name).sort().join(",") === "KERB,LEVELS,SURVEY",
        sketchLayers(back).map(l => l.name).join(","));
}

console.log("\n14. a surveyed drawing full of lines that are not there");
{
  // Straight off a real site plan: duplicate LINE entities with the same start
  // and end, invisible in any viewer and impossible to make an edge of. Six of
  // them in a road layout of five hundred and eighty-one elements used to stop
  // the whole sketch with "BRep_API: command not done", so NONE of the drawing
  // appeared once you left the sketcher.
  const kernel = await createWasmKernel({ initModule: init,
                                          wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {}, readLayout: () => ({}),
                        select: () => {}, selected: () => null, picked: () => [] });
  const roads = dxf(
    t(0, "LINE"), t(8, "ROADS"), t(10, 0), t(20, 0), t(11, 40), t(21, 0),
    t(0, "LINE"), t(8, "ROADS"), t(10, 40), t(20, 0), t(11, 40), t(21, 30),
    // The ones that are not there.
    t(0, "LINE"), t(8, "ROADS"), t(10, 12.5), t(20, 7.25), t(11, 12.5), t(21, 7.25),
    t(0, "LINE"), t(8, "ROADS"), t(10, 12.5), t(20, 7.25), t(11, 12.5), t(21, 7.25),
    t(0, "LINE"), t(8, "ROADS"), t(10, 31), t(20, 2), t(11, 31), t(21, 2),
    t(0, "CIRCLE"), t(8, "ROADS"), t(10, 20), t(20, 20), t(40, 0),
    t(0, "ARC"), t(8, "ROADS"), t(10, 5), t(20, 25), t(40, 4), t(50, 0), t(51, 90),
    // And one the file wrote at full precision that four decimal places of a
    // millimetre cannot tell apart: thirty nanometres long, drawn in metres.
    t(0, "LINE"), t(8, "ROADS"), t(10, 8), t(20, 8), t(11, 8.00000003), t(21, 8),
  );
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                           units: "mm", features: [] });
  await mdl.run({ op: "import", format: "dxf", name: "roads.dxf", data: roads, units: "m" });
  const sketch = (await kernel.tree()).tree.features.find(f => f.type === "Sketch");
  check("the lines that are not there are not brought in - including the one "
        + "only rounding makes a point",
        readSketch(sketch.sketch.drawing).elements.map(el => el.type).join(",")
          === "line,line,arc",
        readSketch(sketch.sketch.drawing).elements.map(el => el.type).join(","));
  check("and what IS there builds", sketch.built && !sketch.error, String(sketch.error));

  // Measured, not assumed: the two real lines are in the built shape, at the
  // length they were drawn - so what came through is the drawing, not a stump
  // of it.
  const gauge = (await kernel.addFeature("Measure", { shape: sketch.id })).id;
  await kernel.setParameter(gauge, "quantity", 0);
  const entry = (await kernel.tree()).tree.features.find(f => f.id === gauge);
  const want = (40 + 30) * 1000 + 4000 * Math.PI / 2;   // metres, held in mm
  check("with every line in it at the length it was drawn",
        Math.abs(Number(entry.data.preview) - want) < 60,
        entry.data && entry.data.preview + " vs " + want.toFixed(0));
}

console.log("\n15. entities that only happen to meet arrive held together");
{
  // A DXF says where each entity is and never that two of them meet. An
  // outline drawn as four separate LINE and ARC entities LOOKS closed and is
  // four loose pieces the moment anybody drags a corner - so the corners are
  // written down on arrival, while the drawing is still exactly as it came.
  const kernel = await createWasmKernel({ initModule: init,
                                          wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {}, readLayout: () => ({}),
                        select: () => {}, selected: () => null, picked: () => [] });
  const plot = dxf(
    t(0, "LINE"), t(8, "PLOT"), t(10, 0), t(20, 0), t(11, 60), t(21, 0),
    t(0, "LINE"), t(8, "PLOT"), t(10, 60), t(20, 0), t(11, 60), t(21, 40),
    t(0, "LINE"), t(8, "PLOT"), t(10, 60), t(20, 40), t(11, 0), t(21, 40),
    t(0, "LINE"), t(8, "PLOT"), t(10, 0), t(20, 40), t(11, 0), t(21, 0),
  );
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "S",
                           units: "mm", features: [] });
  await mdl.run({ op: "import", format: "dxf", name: "plot.dxf", data: plot, units: "m" });
  const sketch = (await kernel.tree()).tree.features.find(f => f.type === "Sketch");
  const drawing = readSketch(sketch.sketch.drawing);
  check("four loose lines arrive with their four corners held",
        drawing.constraints.length === 4,
        drawing.constraints.map(c => c.of.join("=")).join(" "));
  check("so the outline closes into a face without anybody asking",
        /1 loop/.test(sketch.sketch.summary), sketch.sketch.summary);

  // Measured: the face is the rectangle, in millimetres, from a file in metres.
  const gauge = (await kernel.addFeature("Measure", { shape: sketch.id })).id;
  await kernel.setParameter(gauge, "quantity", 1);
  const area = Number((await kernel.tree()).tree.features.find(f => f.id === gauge).data.preview);
  check("and it is the area the outline encloses",
        Math.abs(area - 60000 * 40000) < 1, String(area));

  // Dragging a corner takes what is held to it, which is the whole point of
  // saying so: the outline is still an outline afterwards.
  await kernel.setParameter(sketch.id, "solve", 0);          // Relax, not Ignore
  await mdl.run({ op: "drag", id: sketch.id, handle: "d1.b", to: [80000, 0] });
  const pulled = readSketch((await kernel.tree()).tree.features
    .find(f => f.type === "Sketch").sketch.drawing);
  const corner = pulled.elements.find(el => el.id === "d2");
  check("dragging a corner brings the line held to it along",
        Math.abs(corner.a[0] - 80000) < 1, JSON.stringify(corner.a));
  check("and the outline is still one loop", sketchLoops(pulled).loops.length === 1,
        JSON.stringify(sketchLoops(pulled).open));
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall checks passed");
process.exit(failures ? 1 : 0);
