// IFC, read as a model rather than as a picture.
//
// An IFC file opened in a viewer is triangles: you can look at the wall, you
// cannot change its thickness. But a wall in an IFC file is almost never
// triangles - it is an IfcExtrudedAreaSolid over a profile, which is to say a
// closed outline and a depth, which is to say the Extrude node that is
// already on the rail. So the import does not tessellate. It reads the
// entities and writes the model language, and what arrives is a parametric
// tree with the building's own structure in it.
//
// Everything in sections 1 to 5 is arithmetic over text - a file in, a list
// of features out - with no kernel anywhere near it. Section 6 builds what
// came out and measures it against numbers worked out on paper, because a
// mapping that produces plausible-looking nodes and the wrong solid is the
// failure this is really guarding against.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { ifcAngleScale, ifcArcThrough, ifcBodyItems, ifcCurveElements, ifcFeatures,
         ifcLabel, ifcProfile, ifcScale, ifcStructure, ifcWorldFrame, objOf, ofType,
         readIfc } from "../src/ifc.js";
import { SECTION_KINDS, sectionArea, sectionOutline } from "../src/sections.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const init = (await import(DIR + "/replicad_single.js")).default;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, within) => Math.abs(a - b) <= within;

/* ----------------------------------------------------- 1. the file format */

console.log("1. ISO 10303-21, which is what an IFC file is");
{
  //! Every spelling the format has, in one file: a reference, a null, a
  //! derived attribute, an enumeration, a list, a nested list, a quoted
  //! string with a doubled quote in it, ISO 10646 in \\X2\\, a defined type
  //! wrapping a measure, a number in exponent form, and a comment.
  const text = [
    "ISO-10303-21;", "HEADER;",
    "FILE_DESCRIPTION((''),'2;1');",
    "FILE_SCHEMA(('IFC4'));", "ENDSEC;", "DATA;",
    "/* a comment, which is not an entity */",
    "#1= IFCCARTESIANPOINT((1.,-2.5,3.0E2));",
    "#2= IFCDIRECTION((0.,0.,1.));",
    "#3= IFCAXIS2PLACEMENT3D(#1,#2,$);",
    "#4= IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);",
    "#5= IFCPROPERTYSINGLEVALUE('It''s wide',$,IFCLENGTHMEASURE(1200.),$);",
    "#6= IFCPROPERTYSINGLEVALUE('\\X2\\00C4\\X0\\ussen',$,IFCTEXT('x'),$);",
    "#7= IFCPOLYLINE((#1,#1));",
    "ENDSEC;", "END-ISO-10303-21;",
  ].join("\n");
  const m = readIfc(text);
  check("the schema is read off the header", m.schema === "IFC4", m.schema);
  check("seven entities and no comment among them", m.entities.size === 7,
        String(m.entities.size));
  const point = m.entities.get(1);
  check("a point's coordinates are numbers",
        point.args[0][0] === 1 && point.args[0][1] === -2.5 && point.args[0][2] === 300,
        JSON.stringify(point.args[0]));
  const place = m.entities.get(3);
  check("a reference is a reference", place.args[0].ref === 1, JSON.stringify(place.args[0]));
  check("  and a null attribute is null", place.args[2] === null, String(place.args[2]));
  const unit = m.entities.get(4);
  check("a derived attribute is not a null", unit.args[0] === undefined, String(unit.args[0]));
  check("an enumeration is kept apart from a string",
        unit.args[1] && unit.args[1].enum === "LENGTHUNIT", JSON.stringify(unit.args[1]));
  const wide = m.entities.get(5);
  check("a doubled quote is one quote", wide.args[0] === "It's wide", wide.args[0]);
  check("a defined type keeps its name and its value",
        wide.args[2].type === "IFCLENGTHMEASURE" && wide.args[2].value === 1200,
        JSON.stringify(wide.args[2]));
  const umlaut = m.entities.get(6);
  check("ISO 10646 comes back as the letter it is",
        umlaut.args[0] === "Äussen", umlaut.args[0]);
  check("the inverse index says who points at a point",
        (m.pointingAt.get(1) || []).includes(3) && (m.pointingAt.get(1) || []).includes(7),
        JSON.stringify(m.pointingAt.get(1)));
  check("and IFCBUILDINGSTOREY is not a word anybody should read",
        ifcLabel("IFCBUILDINGSTOREY") === "Building storey", ifcLabel("IFCBUILDINGSTOREY"));
}

console.log("\n2. what the numbers mean, which is never a thing to guess");
{
  //! A metre-based model read as millimetres is a building a thousand times
  //! too small, which on screen looks exactly like nothing at all.
  const said = (unit, extra = "") => readIfc([
    "ISO-10303-21;", "HEADER;", "FILE_SCHEMA(('IFC4'));", "ENDSEC;", "DATA;",
    unit, extra, "#9= IFCUNITASSIGNMENT((#1" + (extra ? ",#2" : "") + "));",
    "ENDSEC;", "END-ISO-10303-21;"].join("\n"));
  check("millimetres are millimetres",
        ifcScale(said("#1= IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);")) === 1);
  check("metres are a thousand of them",
        ifcScale(said("#1= IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);")) === 1000);
  check("centimetres are ten",
        ifcScale(said("#1= IFCSIUNIT(*,.LENGTHUNIT.,.CENTI.,.METRE.);")) === 10);
  //! A US file states the foot as a conversion onto the metre, and the
  //! conversion is the only thing that says which foot it is.
  const feet = said("#1= IFCCONVERSIONBASEDUNIT(#8,.LENGTHUNIT.,'FOOT',#7);",
    ["#7= IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.3048),#2);",
     "#2= IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);"].join("\n"));
  check("a foot is 304.8 mm, read from the conversion rather than from its name",
        near(ifcScale(feet), 304.8, 1e-9), String(ifcScale(feet)));
  check("radians are the SI angle, so degrees come out of them",
        near(ifcAngleScale(said("#1= IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);")),
             180 / Math.PI, 1e-12));
}

/* --------------------------------------------- 3. the building's own tree */

const text = readFileSync(join(HERE, "files/small.ifc"), "utf8");
const model = readIfc(text);

console.log("\n3. project, site, building, storey - and what is in each");
{
  const tree = ifcStructure(model);
  check("one project at the root", tree.roots.length === 1, String(tree.roots.length));
  const project = tree.roots[0];
  const site = project.children[0];
  const building = site && site.children[0];
  const storey = building && building.children[0];
  check("  aggregating a site, a building and a storey",
        !!(site && building && storey)
        && site.type === "IFCSITE" && building.type === "IFCBUILDING"
        && storey.type === "IFCBUILDINGSTOREY");
  check("  named as the file names them", storey && storey.name === "Level 1",
        storey && storey.name);
  //! Decomposition and containment are DIFFERENT relationships in IFC and
  //! both have to be walked: aggregation gets you to the storey, containment
  //! gets you the walls in it.
  check("  with four elements contained in it", storey && storey.parts.length === 4,
        storey && String(storey.parts.length));
  //! An opening belongs to no storey by design - the wall carries it - so
  //! collecting it as an orphan would put every window reveal in the model in
  //! a set of its own AND subtract it from its wall.
  check("and the opening is not loose, because it is not an orphan",
        !tree.loose.some(one => one.type === "IFCOPENINGELEMENT"),
        tree.loose.map(one => one.type).join(",") || "nothing loose");
}

console.log("\n4. placements, which chain all the way to the world");
{
  const wall = ofType(model, "IFCWALLSTANDARDCASE")[0];
  const frame = ifcWorldFrame(model, wall.args[5], 1);
  check("a wall on a storey on a building on a site lands at the origin",
        frame.o.every(v => Math.abs(v) < 1e-9), JSON.stringify(frame.o));
  const slab = ofType(model, "IFCSLAB")[0];
  const up = ifcWorldFrame(model, slab.args[5], 1);
  check("and a slab three metres up lands three metres up",
        near(up.o[2], 3000, 1e-9), String(up.o[2]));
  check("the wall carries one body item", ifcBodyItems(model, wall).length === 1,
        String(ifcBodyItems(model, wall).length));
}

console.log("\n5. profiles - the parameterised ones stay parameterised");
{
  const wall = ofType(model, "IFCWALLSTANDARDCASE")[0];
  const solid = ifcBodyItems(model, wall)[0];
  const rect = ifcProfile(model, solid.args[0], 1);
  check("a rectangle profile comes back as a Rectangle, not as four lines",
        rect.kind === "rect" && rect.node === "Rectangle", rect && rect.kind);
  check("  5000 by 200", rect.values.width === 5000 && rect.values.height === 200,
        JSON.stringify(rect.values));

  const column = ofType(model, "IFCCOLUMN")[0];
  const iShape = ifcProfile(model, ifcBodyItems(model, column)[0].args[0], 1);
  check("an I-section comes back as a Section, and keeps its name",
        iShape.kind === "section" && iShape.sectionKind === "I or H"
        && iShape.label === "UC305x305x97", iShape && iShape.label);
  //! Against the published table for a UC 305x305x97: 123 cm2. The root radii
  //! are a percent of that, so a section drawn without them reads low - which
  //! is why they are arcs here and not a polygon fine enough to look like one.
  const area = sectionArea(sectionOutline("I or H", iShape.values).outer);
  check("  and it measures what the section table says it does",
        near(area, 12300, 60), area.toFixed(0) + " against 12300");

  const slab = ofType(model, "IFCSLAB")[0];
  const holed = ifcProfile(model, ifcBodyItems(model, slab)[0].args[0], 1);
  check("an arbitrary profile with a void comes back as a drawing",
        holed.kind === "drawn", holed && holed.kind);
  check("  with its outline and one hole in it",
        holed.outer.length === 4 && holed.inner.length === 1
        && holed.inner[0].length === 4,
        holed.outer.length + " and " + holed.inner.length);

  //! An IfcArcIndex states an arc by three points and there is exactly one
  //! arc through them; which way it goes is decided by the middle one.
  const arc = ifcArcThrough([100, 0], [0, 100], [-100, 0]);
  check("an arc through three points is found, not fitted",
        near(arc.r, 100, 1e-9) && near(arc.c[0], 0, 1e-9) && near(arc.c[1], 0, 1e-9)
        && arc.ccw, JSON.stringify(arc));
  const back = ifcArcThrough([100, 0], [0, -100], [-100, 0]);
  check("  and the other way round when the middle point is the other way",
        !back.ccw && near(back.r, 100, 1e-9), String(back.ccw));
  check("three points in a line have no arc", ifcArcThrough([0, 0], [1, 0], [2, 0]) === null);

  //! Every section this offers has to draw, whatever numbers it is handed -
  //! including the ones where the root radius will not fit the corner it is
  //! in, which is a typo in somebody's table and should still draw.
  for (const kind of SECTION_KINDS) {
    const made = sectionOutline(kind, { depth: 200, width: 100, web: 8, flange: 12,
      root: 400, toe: 400, lip: 20, wall: 6, top: 60, offset: 20,
      outerRadius: 400, innerRadius: 400 });
    check("  " + kind + " draws even with an impossible radius",
          made.outer.length > 0 && sectionArea(made.outer) > 0,
          String(made.outer.length));
  }
}

/* --------------------------------------------------- 6. and it has to build */

console.log("\n6. through the kernel, against numbers worked out on paper");
const kernel = await createWasmKernel({ initModule: init,
                                        wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                      select: () => {}, selected: () => null });
{
  const { features, report } = ifcFeatures(model, {});
  check("every entity in the file was read", !Object.keys(report.missed).length,
        JSON.stringify(report.missed));
  check("four elements, all of them built",
        report.products === 4 && report.built === 4 && report.empty === 0,
        report.products + "/" + report.built);
  check("built from the nodes on the rail and nothing else",
        Object.keys(report.made).every(type =>
          ["Rectangle", "Circle", "Ellipse", "Section", "Sketch", "Extrude", "Revolve",
           "Sweep", "Boolean", "Trim", "Join", "Cube", "Sphere", "AxisToAxis",
           "MeshImported", "MeshToShape"].includes(type)),
        JSON.stringify(report.made));

  await mdl.run({ op: "model", model: { format: "ocaf-parametric-model", version: 1,
                                        name: "Small", units: "mm", features } });
  const tree = (await kernel.tree()).tree;
  const broken = tree.features.filter(f => f.error);
  check("and the whole of it rebuilds with nothing in error", broken.length === 0,
        broken.slice(0, 3).map(f => f.name + ": " + f.error).join(" · "));

  const named = want => tree.features.filter(f => f.name === want);
  const volume = async id => {
    const M = (await mdl.run({ op: "add", type: "Measure", refs: { shape: id } })).id;
    await mdl.run({ op: "set", id: M, key: "quantity", value: 2 });
    const f = (await kernel.tree()).tree.features.find(x => x.id === M);
    return f.error ? NaN : Number(f.data.preview);
  };

  //! THE WALL LESS ITS WINDOW. 5000 x 200 x 3000 is 3.0e9; the opening is
  //! 1000 wide and 2100 high and goes right through the 200, which is 4.2e8.
  const wall = named("Basic Wall:Generic 200").filter(f => f.type === "Boolean")[0];
  check("a wall is a wall less its opening",
        near(await volume(wall.id), 3e9 - 4.2e8, 1),
        (await volume(wall.id)).toExponential(4) + " against " + (3e9 - 4.2e8).toExponential(4));

  //! THE COLUMN. Its own section table area times four metres.
  const column = named("UC305x305x97").filter(f => f.type === "Extrude")[0];
  check("a column is its section times its length",
        near(await volume(column.id), 12343 * 4000, 12343 * 4000 * 0.002),
        (await volume(column.id)).toExponential(4));

  //! THE SLAB. 8000 x 6000 less a 2000 square, 250 thick - which only comes
  //! out right if the void in the profile really became a hole in the face.
  const slab = named("Floor 250").filter(f => f.type === "Extrude")[0];
  check("a slab with a void is a slab with a hole in it",
        near(await volume(slab.id), (8000 * 6000 - 2000 * 2000) * 250, 1),
        (await volume(slab.id)).toExponential(6));

  //! THE REVOLUTION. A 100 x 40 section at a radius of 250, turned a quarter
  //! turn: Pappus says 2 pi r A / 4.
  const ring = named("Turned ring").filter(f => f.type === "Revolve")[0];
  check("a revolved area solid is a revolution",
        near(await volume(ring.id), 2 * Math.PI * 250 * 4000 / 4, 1),
        (await volume(ring.id)).toFixed(1));
}

console.log("\n7. an outline that came in is an outline you can open");
{
  //! The point of not tessellating. A slab that arrived as a drawing has a
  //! drawing in it, with the elements the file drew - so the sketcher opens
  //! it, the constraint solver can be put on it, and the thing is editable
  //! rather than just visible.
  const tree = (await kernel.tree()).tree;
  const sketch = tree.features.find(f => f.type === "Sketch" && f.name === "Floor 250");
  check("the slab's profile is a sketch in the document", !!sketch);
  check("  holding eight elements - the outline and the void",
        sketch && /8 elements/.test(sketch.sketch.summary), sketch && sketch.sketch.summary);
  check("  which the kernel reads as two loops",
        sketch && /2 loops/.test(sketch.sketch.summary), sketch && sketch.sketch.summary);

  //! And a curve that arrived as an arc is an arc, not forty short lines.
  const m = readIfc([
    "ISO-10303-21;", "HEADER;", "FILE_SCHEMA(('IFC4'));", "ENDSEC;", "DATA;",
    "#1= IFCCARTESIANPOINT((0.,0.));",
    "#2= IFCAXIS2PLACEMENT2D(#1,$);",
    "#3= IFCCIRCLE(#2,100.);",
    "#4= IFCCARTESIANPOINT((100.,0.));",
    "#5= IFCCARTESIANPOINT((0.,100.));",
    "#6= IFCTRIMMEDCURVE(#3,(#4),(#5),.T.,.CARTESIAN.);",
    "ENDSEC;", "END-ISO-10303-21;"].join("\n"));
  const drawn = ifcCurveElements(m, { ref: 6 }, 1);
  check("a trimmed circle comes in as one arc", drawn.length === 1 && drawn[0].type === "arc",
        JSON.stringify(drawn.map(e => e.type)));
  check("  a quarter of a circle of radius 100",
        near(drawn[0].r, 100, 1e-9) && near(drawn[0].a1 - drawn[0].a0, Math.PI / 2, 1e-9),
        drawn[0].r + " over " + ((drawn[0].a1 - drawn[0].a0) * 180 / Math.PI).toFixed(1) + "deg");
}

console.log("\nIFC4 writes its meshes as triangulated face sets");
{
  const IDENTITY = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  //! The whole of IFC4 came in empty because of this one attribute. A
  //! triangulated face set is Coordinates, Normals, Closed, CoordIndex,
  //! PnIndex - and the triangles were read from the third, which is `Closed`,
  //! a boolean. Across the buildingSMART certification scenes that was every
  //! IFC4 and IFC4.3 file in the set: 31% of products built before, 98% after,
  //! and nothing else in any of them was unreadable.
  const tetra = (extra = "") => readIfc([
    "ISO-10303-21;", "HEADER;", "FILE_SCHEMA(('IFC4'));", "ENDSEC;", "DATA;",
    "#1= IFCCARTESIANPOINTLIST3D(((0.,0.,0.),(10.,0.,0.),(0.,10.,0.),(0.,0.,10.)));",
    "#2= IFCTRIANGULATEDFACESET(#1,$,.T.,((1,2,3),(1,2,4),(2,3,4),(1,3,4)),"
      + (extra || "$") + ");",
    "ENDSEC;", "END-ISO-10303-21;"].join("\n"));

  const drawn = objOf(tetra(), [tetra().entities.get(2)], IDENTITY, 1);
  check("a tetrahedron comes out with four faces", drawn.faces === 4, String(drawn.faces));
  check("  and four corners", (drawn.text.match(/^v /gm) || []).length === 4);
  check("  the first face is the first three corners",
        /^f 1 2 3$/m.test(drawn.text), drawn.text.split("\n").find(l => l.startsWith("f ")));

  //! PnIndex: the triangles address the points through a second list, which is
  //! how an exporter shares one point list between several sets.
  const through = tetra("(4,3,2,1)");
  const mapped = objOf(through, [through.entities.get(2)], IDENTITY, 1);
  check("PnIndex is followed when there is one",
        /^f 4 3 2$/m.test(mapped.text),
        mapped.text.split("\n").find(l => l.startsWith("f ")));
}

console.log("\nA colour per trade, so a model you did not build can be read");
{
  const model = readIfc(readFileSync(new URL("./files/small.ifc", import.meta.url), "utf8"));
  const { features } = ifcFeatures(model, {});
  const worn = type => {
    const f = features.filter(one => one.type === type && one.appearance)[0];
    return f ? f.appearance.color : null;
  };
  //! By the names the file gives them - a column in an IFC is called what the
  //! engineer called it, "UC305x305x97", not "column".
  const SOLID = ["Extrude", "Revolve", "Sweep", "Boolean", "Trim", "Join", "MeshImported"];
  const named = name => {
    const f = features.find(one => one.appearance && one.name === name
                                && SOLID.includes(one.type));
    return f ? f.appearance.color : null;
  };
  const column = named("UC305x305x97");
  const slab = named("Floor 250");
  check("a column is green", !!column && column[1] > column[0] && column[1] > column[2],
        JSON.stringify(column));
  check("a slab is grey", !!slab && Math.abs(slab[0] - slab[2]) < 0.05
                               && Math.abs(slab[0] - slab[1]) < 0.05, JSON.stringify(slab));
  //! The setting-out, which is most of what an IFC import makes, reads as one
  //! thing rather than as the same green every curve in the program wears.
  const plane = worn("Plane"), point = worn("Point");
  check("the planes it sets out on are blue", !!plane && plane[2] > plane[0] + 0.3,
        JSON.stringify(plane));
  check("and so are the points", !!point && point[2] > point[0] + 0.3, JSON.stringify(point));
  //! A body nobody has classified keeps the neutral grey it has always had.
  const proxy = features.find(f => f.type === "Extrude" && !f.appearance);
  check("and a solid gets no colour it was not given", !!proxy);
}

/* ---------------------------------------------------- corners are shared

   THE FAILURE THAT LOOKED PERFECT. A faceted B-rep names every corner of every
   facet separately, and written out one corner at a time a box becomes
   twenty-four vertices and twelve triangles in which every edge has exactly
   one face on it. On screen that is indistinguishable from a solid box. It is
   a triangle SOUP: it cannot be subdivided, it cannot be sewn, and a section
   through it finds no closed region - so a whole IFC building sections to an
   empty sheet and nothing about the model looks wrong.

   What tells the two apart is the topology, and the number to check it against
   is Euler's: a closed box is 8 vertices, and every edge of a closed surface
   has exactly two faces on it.                                               */

console.log("\nA facet shares its corners with its neighbours, or it is not a surface");
{
  // Two triangulated boxes: a wall written as an IfcTriangulatedFaceSet with
  // its corners repeated per face, which is what exporters write.
  const box = [[0, 0, 0], [200, 0, 0], [200, 100, 0], [0, 100, 0],
               [0, 0, 60], [200, 0, 60], [200, 100, 60], [0, 100, 60]];
  const faces = [[1, 3, 2], [1, 4, 3], [5, 6, 7], [5, 7, 8], [1, 2, 6], [1, 6, 5],
                 [2, 3, 7], [2, 7, 6], [3, 4, 8], [3, 8, 7], [4, 1, 5], [4, 5, 8]];
  // Written the way an exporter does: the coordinate list repeats a corner
  // once per face that touches it.
  const spread = [];
  const spreadFaces = faces.map(f => f.map(i => { spread.push(box[i - 1]); return spread.length; }));
  const text = "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n"
    + "#1=IFCCARTESIANPOINTLIST3D((" + spread.map(p => "(" + p.join(",") + ")").join(",") + "));\n"
    + "#2=IFCTRIANGULATEDFACESET(#1,$,.T.,("
    + spreadFaces.map(f => "(" + f.join(",") + ")").join(",") + "),$);\n"
    + "ENDSEC;\nEND-ISO-10303-21;\n";
  const model = readIfc(text);
  const obj = objOf(model, [model.entities.get(2)],
                    { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, 1);
  const points = obj.text.split("\n").filter(line => line.startsWith("v ")).length;
  check("thirty-six repeated corners come in as the eight a box has",
        points === 8, points + " vertices");
  check("and all twelve triangles are still there", obj.faces === 12, obj.faces + " faces");

  // The topology is the point: every edge with two faces on it is a closed
  // surface, and a closed surface is something a section can fill.
  const rings = obj.text.split("\n").filter(line => line.startsWith("f "))
    .map(line => line.slice(2).split(" ").map(Number));
  const edges = new Map();
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const key = Math.min(a, b) + ":" + Math.max(a, b);
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  const rim = [...edges.values()].filter(n => n === 1).length;
  check("every edge has two faces on it, so the surface closes",
        rim === 0, rim + " edges with only one face");
  check("and a box has eighteen edges when its quads are split into triangles",
        edges.size === 18, edges.size + " edges");

  // AND THE INDICES STILL MEAN WHAT THEY SAID. Sharing corners renumbers the
  // vertices, and a face set addresses its COORD LIST rather than the vertices
  // written so far - so an import that shared corners without remapping drew
  // its faces through whichever vertices happened to sit at those positions.
  // That is a shape. It is not this shape, and it looks like a shape.
  const corners = obj.text.split("\n").filter(l => l.startsWith("v "))
    .map(l => l.slice(2).split(" ").map(Number));
  const sameSet = one => [...new Set(one.map(p => p.join(",")))].sort().join(" | ");
  check("and the eight corners are the box's own eight",
        sameSet(corners) === sameSet(box), sameSet(corners));
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall good");
process.exit(failures ? 1 : 0);
