// The cage, and what every operation on it is supposed to do.
//
// A mesh editor is easy to make look like it works: the viewport draws
// something, the something has faces, and nobody counts them. So the checks
// here count. Euler's formula is the backbone of most of them - V - E + F = 2
// for a closed surface, and an operation that breaks it has torn the mesh
// whatever the picture says - and the rest are quantities a reader can work
// out on paper: the area of a bevelled square, the volume of an extruded face,
// the number of quads a loop cut adds.
import { MESH_OPS, MESH_LEVELS, TEMPLATE_NAMES, anchorsOf, applyOp, applyOps,
         bevelEdges, bisect, borderLoops, boxMesh, bridgeLoops, catmullClark,
         checker, collapse, connectVerts, cylinderMesh, deleteAt, discMesh,
         dissolveEdges, dissolveFaces, dissolveVerts, dropLoose, duplicateFaces,
         edgeEnds, edgeKey, edgeLoop, edgeRing, edgesIn, extrudeFaces, faceArea,
         faceCentre, faceLoop, faceNormal, facesOf, fillLoop, flipFaces,
         gridFill, growSelection, hexagonMesh, honeycombMesh, insetFaces,
         invertSelection, lShapeMesh, linkedFrom, loopCut, mergeAt,
         mergeByDistance, mirrorMesh, moveVerts, openEdges, planeMesh,
         pmAdd, pmLen, pmSub, pokeFaces, quadrangulate, recalculateNormals,
         rebindTo, ripVerts, setCorner, setCrease, shellsOf, shrinkFatten,
         shrinkSelection, similarTo, smoothVerts, solidify, sphereMesh, spin,
         splitFaces, subdivideEdges, symmetrize, tallyOf, templateMesh,
         topologyOf, torusMesh, toSphere, transformVerts, triangulate,
         tubeMesh, unSubdivide, vertexNormals, vertsOf, wireframe,
         byTrait, boundsOf, crossMesh } from "../src/polymesh.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

//! V - E + F for a mesh. Two for anything that closes; less when it has holes
//! or handles. The one number that says whether an operation tore the mesh.
const euler = mesh => {
  const topo = topologyOf(mesh);
  return mesh.points.length - topo.edges.size + mesh.faces.length;
};
const area = mesh => mesh.faces.reduce((sum, f) => sum + faceArea(mesh, f), 0);
const volume = mesh => {
  let v = 0;
  for (const face of mesh.faces)
    for (let i = 1; i + 1 < face.length; i++) {
      const [a, b, c] = [mesh.points[face[0]], mesh.points[face[i]], mesh.points[face[i + 1]]];
      v += (a[0] * (b[1] * c[2] - b[2] * c[1])
          - a[1] * (b[0] * c[2] - b[2] * c[0])
          + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  return v;
};

console.log("1. a cage knows what is next to what");
{
  const box = boxMesh({ dx: 100, dy: 100, dz: 100 });
  check("a box is eight points and six quads",
        box.points.length === 8 && box.faces.length === 6
        && box.faces.every(f => f.length === 4), box.points.length + " / " + box.faces.length);
  const topo = topologyOf(box);
  check("twelve edges, two faces on each",
        topo.edges.size === 12 && [...topo.edges.values()].every(e => e.faces.length === 2),
        String(topo.edges.size));
  check("V - E + F is 2", euler(box) === 2, String(euler(box)));
  check("three faces and three edges at every corner",
        topo.vertFaces.every(f => f.length === 3) && topo.vertEdges.every(e => e.length === 3));
  check("nothing is open", openEdges(box).length === 0);
  check("it is one element", shellsOf(box).length === 1);
  check("the faces point outwards",
        box.faces.every(f => {
          const n = faceNormal(box, f), c = faceCentre(box, f);
          return n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > 0;
        }));
  check("a 100 mm box has 60 000 mm² of face", near(area(box), 60000, 1), area(box).toFixed(0));
  check("and a million cubic millimetres in it", near(volume(box), 1e6, 1), volume(box).toFixed(0));
  check("every template builds", TEMPLATE_NAMES.every(name => {
    const mesh = templateMesh(name, {});
    return mesh.points.length > 2 && mesh.faces.length > 0;
  }), TEMPLATE_NAMES.map(n => templateMesh(n, {}).faces.length).join(", "));
}

console.log("\n2. two boxes are two elements until they are welded");
{
  const one = boxMesh({ dx: 100, dy: 100, dz: 100 });
  const two = boxMesh({ dx: 100, dy: 100, dz: 100 });
  const both = {
    points: [...one.points, ...two.points.map(p => [p[0] + 100, p[1], p[2]])],
    faces: [...one.faces, ...two.faces.map(f => f.map(v => v + one.points.length))],
    creases: {}, corners: {},
  };
  check("two boxes side by side are two elements", shellsOf(both).length === 2,
        String(shellsOf(both).length));
  // They touch: the right face of one is exactly the left face of the other.
  const welded = mergeByDistance(both, 0.01);
  check("welded, they are one", shellsOf(welded).length === 1,
        shellsOf(welded).length + " elements, " + welded.points.length + " points");
  check("and four vertices went", welded.points.length === 12, String(welded.points.length));
  check("the wall between them is still there, so it is two rooms not one box",
        welded.faces.length === 12, String(welded.faces.length));
  check("the shared wall now has two faces on it",
        [...topologyOf(welded).edges.values()].filter(e => e.faces.length > 2).length === 4,
        "four edges with three faces, which is what a party wall looks like");
}

console.log("\n3. loops and rings, which is how anybody selects anything");
{
  const box = boxMesh({ dx: 100, dy: 100, dz: 100, segX: 4, segY: 4, segZ: 4 });
  const topo = topologyOf(box);
  check("a divided box is still closed", euler(box) === 2, String(euler(box)));
  // An edge running round the box the short way.
  const vertical = [...topo.edges.keys()].find(key => {
    const [a, b] = edgeEnds(key);
    return Math.abs(box.points[a][2] - box.points[b][2]) > 1
        && Math.abs(box.points[a][0] - box.points[b][0]) < 1e-9
        && Math.abs(box.points[a][0] + 50) < 1e-9;
  });
  // A LOOP goes the way the edge points - up the column of four. A RING steps
  // sideways across the quads - all the way round the box, sixteen of them.
  // They are different selections and mixing them up is the commonest mistake
  // anybody makes in a mesh editor, so they are checked against each other.
  const loop = edgeLoop(box, vertical, topo);
  check("the loop off a vertical edge runs up the column, four of them",
        loop.length === 4, String(loop.length));
  const ring = edgeRing(box, vertical, topo);
  check("and the ring across it goes right round the box, sixteen",
        ring.length === 16, String(ring.length));
  check("a face loop is the faces the ring runs through",
        faceLoop(box, vertical, topo).length === 16,
        String(faceLoop(box, vertical, topo).length));
  check("growing one vertex gives the five round it",
        growSelection(box, "vertex", [0], topo).length === 4,
        String(growSelection(box, "vertex", [0], topo).length));
  check("inverting a face selection leaves the rest",
        invertSelection(box, "face", [0, 1], topo).length === box.faces.length - 2);
  check("linked from one face is the whole box",
        linkedFrom(box, "face", [0], topo).length === box.faces.length);
  check("every quad is similar to every other quad",
        similarTo(box, "face", [0], "sides", 0.02, topo).length === box.faces.length);
  check("a checker of a face loop takes every other one",
        checker(faceLoop(box, vertical, topo), 1, 1).length === 8,
        String(checker(faceLoop(box, vertical, topo), 1, 1).length));
}

console.log("\n4. extrude: the operation everything else is built on");
{
  const box = boxMesh({ dx: 100, dy: 100, dz: 100 });
  const top = box.faces.findIndex(f => faceCentre(box, f)[2] > 49);
  const out = extrudeFaces(box, [top], { distance: 50 });
  check("still closed after an extrude", euler(out) === 2, String(euler(out)));
  check("four points added", out.points.length === 12, String(out.points.length));
  check("and four walls, the old top gone", out.faces.length === 10, String(out.faces.length));
  check("the volume went up by the block that was added",
        near(volume(out), 1e6 + 100 * 100 * 50, 1), volume(out).toFixed(0));
  check("what is selected afterwards is the new cap", out.picked.length === 1 && out.level === "face");
  check("and the cap is where the extrude put it",
        near(faceCentre(out, out.faces[out.picked[0]])[2], 100, 1e-6),
        String(faceCentre(out, out.faces[out.picked[0]])[2]));

  // A region of faces comes up as one block with one wall round it.
  const grid = planeMesh({ width: 300, depth: 300, cols: 3, rows: 3 });
  const region = extrudeFaces(grid, [0, 1, 3, 4], { distance: 100 });
  check("a 2 x 2 region extrudes as one block",
        region.faces.length === 5 + 4 + 8, region.faces.length + " faces");
  check("with one wall round the region, not four towers",
        region.picked.length === 4, region.picked.length + " caps");

  const each = extrudeFaces(grid, [0, 1, 3, 4], { distance: 100, individual: true });
  check("individually, it is four towers",
        each.faces.length === 5 + 4 * 5, each.faces.length + " faces");
  // Still standing ON the sheet: each tower keeps the base it grew out of, so
  // the whole thing is one piece. Four loose boxes would be four elements, and
  // would also be four boxes hovering over a hole.
  check("and they are standing on the sheet, not floating over holes in it",
        shellsOf(each).length === 1, String(shellsOf(each).length));
}

console.log("\n5. inset and bevel");
{
  const plane = planeMesh({ width: 100, depth: 100 });
  const inset = insetFaces(plane, [0], { thickness: 20 });
  check("an inset leaves the rim plus the middle",
        inset.faces.length === 5, String(inset.faces.length));
  check("it covers the same ground", near(area(inset), 10000, 1), area(inset).toFixed(1));
  check("the middle is 60 x 60", near(faceArea(inset, inset.faces[inset.picked[0]]), 3600, 1),
        faceArea(inset, inset.faces[inset.picked[0]]).toFixed(0));
  const window = insetFaces(plane, [0], { thickness: 20, depth: -10 });
  check("with a depth it is a reveal, pushed back",
        near(faceCentre(window, window.faces[window.picked[0]])[2], -10, 1e-9));

  const box = boxMesh({ dx: 100, dy: 100, dz: 100 });
  const topo = topologyOf(box);
  const vertical = [...topo.edges.keys()].filter(key => {
    const [a, b] = edgeEnds(key);
    return Math.abs(box.points[a][2] - box.points[b][2]) > 1;
  });
  check("a box has four vertical edges", vertical.length === 4, String(vertical.length));
  const bevelled = bevelEdges(box, vertical, { width: 10 });
  check("bevelling them keeps it closed", euler(bevelled) === 2, String(euler(bevelled)));
  check("and makes an octagonal prism: 8 sides, 2 caps",
        bevelled.faces.length === 10, bevelled.faces.length + " faces, " + tallyOf(bevelled));
  check("the top is now an octagon",
        bevelled.faces.some(f => f.length === 8), tallyOf(bevelled));
  check("it lost the corners it cut off", volume(bevelled) < 1e6 && volume(bevelled) > 0.9e6,
        volume(bevelled).toFixed(0));
  const segmented = bevelEdges(box, vertical, { width: 10, segments: 3 });
  check("three segments give three strips per edge",
        segmented.faces.length === 2 + 4 + 4 * 3, String(segmented.faces.length));
}

console.log("\n6. cutting: subdivide, loop cut, bisect");
{
  const plane = planeMesh({ width: 100, depth: 100 });
  const quartered = subdivideEdges(plane, [...topologyOf(plane).edges.keys()], 1);
  check("a quad with every edge cut becomes a 2 x 2 grid",
        quartered.faces.length === 4 && quartered.points.length === 9,
        quartered.faces.length + " faces, " + quartered.points.length + " points");
  check("and it still covers 100 x 100", near(area(quartered), 10000, 1e-6));

  const box = boxMesh({ dx: 100, dy: 100, dz: 100, segZ: 2 });
  const topo = topologyOf(box);
  const round = [...topo.edges.keys()].find(key => {
    const [a, b] = edgeEnds(key);
    return Math.abs(box.points[a][2] - box.points[b][2]) > 1;
  });
  const cut = loopCut(box, round, { cuts: 1 });
  check("a loop cut keeps the box closed", euler(cut) === 2, String(euler(cut)));
  check("it adds a ring of points", cut.points.length > box.points.length,
        box.points.length + " -> " + cut.points.length);
  check("and the box is the same size", near(volume(cut), 1e6, 1), volume(cut).toFixed(0));

  const half = bisect(boxMesh({ dx: 100, dy: 100, dz: 100 }),
                      { origin: [0, 0, 0], normal: [1, 0, 0], clear: -1 });
  check("bisecting and clearing one side halves the area",
        near(area(half), 60000 / 2 + 0, 10000), area(half).toFixed(0));
  check("and nothing is left on the cleared side",
        half.points.every(p => p[0] >= -1e-6), "lowest x " +
        Math.min(...half.points.map(p => p[0])).toFixed(3));
}

console.log("\n7. taking things away, and the difference between the two ways");
{
  const grid = planeMesh({ width: 300, depth: 300, cols: 3, rows: 3 });
  const gone = deleteAt(grid, "face", [4]);
  check("deleting the middle face leaves a hole",
        gone.faces.length === 8, String(gone.faces.length));
  check("and the hole has a rim of four edges",
        borderLoops(gone).length === 2, borderLoops(gone).map(l => l.length).join(" and "));

  const merged = dissolveFaces(grid, [0, 1, 3, 4]);
  check("dissolving a 2 x 2 block makes one face of it",
        merged.faces.length === 6, String(merged.faces.length));
  check("and the surface is still whole", near(area(merged), 90000, 1), area(merged).toFixed(0));

  const box = boxMesh({ dx: 100, dy: 100, dz: 100, segX: 2 });
  const topo = topologyOf(box);
  const middle = [...topo.edges.keys()].filter(key => {
    const [a, b] = edgeEnds(key);
    return Math.abs(box.points[a][0]) < 1e-9 && Math.abs(box.points[b][0]) < 1e-9;
  });
  const flat = dissolveEdges(box, middle, topo);
  check("dissolving the edges of a split box gives the box back",
        flat.faces.length === 6 && flat.points.length === 12,
        flat.faces.length + " faces, " + flat.points.length + " points");
  const tidy = dropLoose(flat);
  check("and nothing was left loose - the midpoints are still on the top and bottom",
        tidy.points.length === 12 && euler(tidy) === 2,
        tidy.points.length + " points, euler " + euler(tidy));
}

console.log("\n8. welding, ripping, splitting");
{
  const grid = planeMesh({ width: 200, depth: 200, cols: 2, rows: 2 });
  const middle = grid.points.findIndex(p => Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9);
  const ripped = ripVerts(grid, [middle]);
  check("ripping the middle vertex gives each face its own copy",
        ripped.points.length === grid.points.length + 3, String(ripped.points.length));
  check("each face now has its own copy of the middle, so the seam is open",
        [...new Set(ripped.faces.map(f => f.length))].join() === "4"
        && ripped.faces.length === 4, tallyOf(ripped));
  check("and the sheet is still one piece, joined along the edge midpoints",
        shellsOf(ripped).length === 1, String(shellsOf(ripped).length));
  const back = mergeByDistance(ripped, 0.001);
  check("welding puts it back together", shellsOf(back).length === 1
        && back.points.length === grid.points.length, String(back.points.length));

  const apart = splitFaces(grid, [0]);
  check("splitting a face off makes two elements", shellsOf(apart).length === 2,
        String(shellsOf(apart).length));
  const collapsed = collapse(grid, "vertex", [0, 1]);
  check("collapsing two neighbours makes one of them",
        collapsed.points.length === grid.points.length - 1, String(collapsed.points.length));
  const at = mergeAt(grid, [0, 2], "centre");
  check("merging at the centre joins them too",
        at.points.length === grid.points.length - 1, String(at.points.length));
}

console.log("\n9. normals, thickness and copies");
{
  const box = boxMesh({ dx: 100, dy: 100, dz: 100 });
  const wrong = flipFaces(box, [0, 2]);
  check("flipping two faces breaks the winding",
        volume(wrong) !== volume(box), volume(wrong).toFixed(0));
  const fixed = recalculateNormals(wrong);
  check("recalculating puts the whole mesh right",
        near(volume(fixed), 1e6, 1), volume(fixed).toFixed(0));
  check("and outward is outward, not inward",
        fixed.faces.every(f => {
          const n = faceNormal(fixed, f), c = faceCentre(fixed, f);
          return n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > 0;
        }));

  const sheet = planeMesh({ width: 100, depth: 100 });
  const thick = solidify(sheet, 10);
  check("solidifying a sheet closes it", euler(thick) === 2, String(euler(thick)));
  check("and it holds 100 x 100 x 10", near(Math.abs(volume(thick)), 100000, 1),
        Math.abs(volume(thick)).toFixed(0));

  const bars = wireframe(sheet, 5);
  check("a wireframe of one quad is four bars", bars.faces.length === 24,
        String(bars.faces.length));
  const twice = duplicateFaces(sheet, [0], [0, 0, 50]);
  check("duplicating gives two faces", twice.faces.length === 2);
  check("and they are not joined", shellsOf(twice).length === 2);
}

console.log("\n10. mirror, spin, bridge and fill");
{
  const half = planeMesh({ width: 100, depth: 100 });
  const both = mirrorMesh(half, { origin: [50, 0, 0], normal: [1, 0, 0], weld: 0.01 });
  check("mirroring about an edge doubles the area and welds the seam",
        near(area(both), 20000, 1) && both.points.length === 6,
        area(both).toFixed(0) + " mm², " + both.points.length + " points");

  const ring = cylinderMesh({ radius: 50, height: 100, sides: 8, caps: false });
  check("an uncapped cylinder is open at both ends",
        borderLoops(ring).length === 2, String(borderLoops(ring).length));
  const capped = fillLoop(ring, openEdges(ring), {});
  check("filling both openings closes it", euler(capped) === 2, String(euler(capped)));
  check("and it holds what a prism of that size holds",
        near(Math.abs(volume(capped)), 8 * 0.5 * 50 * 50 * Math.sin(Math.PI / 4) * 100, 1),
        Math.abs(volume(capped)).toFixed(0));

  const grid = gridFill(cylinderMesh({ radius: 50, height: 10, sides: 8, caps: false }),
                        openEdges(cylinderMesh({ radius: 50, height: 10, sides: 8, caps: false })),
                        {});
  check("a grid fill uses quads rather than one n-gon",
        grid.faces.filter(f => f.length === 4).length > 8, tallyOf(grid));

  const two = {
    points: [...ring.points], faces: [...ring.faces], creases: {}, corners: {},
  };
  const swept = spin(planeMesh({ width: 20, depth: 20 }),
                     [...topologyOf(planeMesh({ width: 20, depth: 20 })).edges.keys()].slice(0, 1),
                     { axis: [0, 0, 1], centre: [200, 0, 0], angle: 360, steps: 8 });
  check("spinning an edge right round gives a closed band",
        swept.faces.length === 1 + 8, String(swept.faces.length));
}

console.log("\n11. Catmull-Clark, and the creases that make it useful");
{
  const box = boxMesh({ dx: 100, dy: 100, dz: 100 });
  const once = catmullClark(box);
  check("one level of a box is 24 quads", once.faces.length === 24
        && once.faces.every(f => f.length === 4), String(once.faces.length));
  check("V - E + F is still 2", euler(once) === 2, String(euler(once)));
  const twice = catmullClark(once);
  check("two levels is 96", twice.faces.length === 96, String(twice.faces.length));
  const limit = catmullClark(catmullClark(twice));
  const further = catmullClark(limit);
  check("it pulls in towards the surface the cage means, and settles there",
        Math.abs(volume(limit)) < 1e6 && Math.abs(volume(limit)) > 1e6 * 0.3
        && Math.abs(Math.abs(volume(further)) - Math.abs(volume(limit))) < 1e6 * 0.002,
        (Math.abs(volume(limit)) / 1e6).toFixed(4) + " then "
        + (Math.abs(volume(further)) / 1e6).toFixed(4) + " of the cage");
  check("and it stays inside the cage it came from",
        limit.points.every(p => p.every(v => Math.abs(v) <= 50 + 1e-9)),
        "furthest " + Math.max(...limit.points.map(p => Math.max(...p.map(Math.abs)))).toFixed(2));

  // Every edge creased hard: the box should stay a box.
  const topo = topologyOf(box);
  const hard = setCrease(box, [...topo.edges.keys()], 1);
  let held = hard;
  for (let i = 0; i < 3; i++) held = catmullClark(held);
  check("with every edge creased it keeps its shape",
        near(Math.abs(volume(held)), 1e6, 1e6 * 0.02),
        (Math.abs(volume(held)) / 1e6).toFixed(3) + " of the cage");
  check("and it has the corners back",
        held.points.some(p => Math.abs(p[0]) > 49.5 && Math.abs(p[1]) > 49.5
                           && Math.abs(p[2]) > 49.5),
        "furthest corner " + Math.max(...held.points.map(p => Math.max(...p.map(Math.abs)))).toFixed(1));

  // Half a crease should land between the two.
  const soft = setCrease(box, [...topo.edges.keys()], 0.5);
  let middle = soft;
  for (let i = 0; i < 3; i++) middle = catmullClark(middle);
  const round = Math.abs(volume(limit)), square = Math.abs(volume(held));
  check("half a crease lands between smooth and sharp",
        Math.abs(volume(middle)) > round && Math.abs(volume(middle)) < square,
        [round, Math.abs(volume(middle)), square].map(v => (v / 1e6).toFixed(3)).join(" < "));

  // A crease on one loop only: the box holds that fold and rounds the rest.
  const vertical = [...topo.edges.keys()].filter(key => {
    const [a, b] = edgeEnds(key);
    return Math.abs(box.points[a][2] - box.points[b][2]) > 1;
  });
  let ribbed = setCrease(box, vertical, 1);
  for (let i = 0; i < 3; i++) ribbed = catmullClark(ribbed);
  const wide = Math.max(...ribbed.points.map(p => Math.hypot(p[0], p[1])));
  const tall = Math.max(...ribbed.points.map(p => Math.abs(p[2])));
  const plain = Math.max(...limit.points.map(p => Math.hypot(p[0], p[1])));
  // The four uprights held and nothing else: the plan keeps its corners while
  // the top and bottom still round off. That is the move a tower with a sharp
  // plan and a soft cap is made of, and it is what creases are for.
  check("creasing just the uprights keeps the plan's corners",
        wide > plain * 1.2, wide.toFixed(1) + " mm across the corner against "
        + plain.toFixed(1) + " uncreased");
  check("while the section still rounds off", tall < 48,
        "half-height " + tall.toFixed(1) + " mm of 50");

  const pinned = setCorner(box, [0], 1);
  let heldPoint = pinned;
  for (let i = 0; i < 3; i++) heldPoint = catmullClark(heldPoint);
  check("a corner tag holds one point exactly where it was",
        heldPoint.points.some(p => near(pmLen(pmSub(p, box.points[0])), 0, 1e-6)),
        "the cage corner is still in the surface");
  check("an open sheet keeps its boundary by default",
        near(area(catmullClark(planeMesh({ width: 100, depth: 100, cols: 2, rows: 2 }))),
             10000, 1),
        area(catmullClark(planeMesh({ width: 100, depth: 100, cols: 2, rows: 2 }))).toFixed(1));
}

console.log("\n12. the operation list, replayed");
{
  const box = boxMesh({ dx: 100, dy: 100, dz: 100 });
  const top = box.faces.findIndex(f => faceCentre(box, f)[2] > 49);
  const ops = [
    { op: "extrude", level: "face", at: [top], near: anchorsOf(box, "face", [top]),
      args: { distance: 100 } },
  ];
  const first = applyOps(box, ops);
  check("one extrude in a list does what the operation does",
        near(volume(first.mesh), 2e6, 1), volume(first.mesh).toFixed(0));
  check("and it reports nothing wrong", first.notes.length === 0, first.notes.join("; "));

  // THE WHOLE POINT: the same list over a cage that has changed upstream.
  const finer = boxMesh({ dx: 100, dy: 100, dz: 100, segX: 2, segY: 2 });
  const again = applyOps(finer, ops);
  check("the same list over a re-divided box still extrudes the top",
        again.notes.length === 0 && volume(again.mesh) > 1.2e6,
        volume(again.mesh).toFixed(0) + " mm³, notes: " + (again.notes.join("; ") || "none"));
  check("it found the face by where it was, not by its number",
        Math.max(...again.mesh.points.map(p => p[2])) > 140,
        "top at " + Math.max(...again.mesh.points.map(p => p[2])).toFixed(0));

  // A box that is a different size: the anchor is nowhere near, so the
  // operation says it lost what it was about rather than extruding something
  // else.
  const elsewhere = boxMesh({ dx: 100, dy: 100, dz: 100 });
  elsewhere.points = elsewhere.points.map(p => [p[0] + 5000, p[1], p[2]]);
  const lost = applyOps(elsewhere, ops);
  check("and when it cannot find it, it says so rather than guessing",
        lost.notes.length === 1 && /no longer in the mesh/.test(lost.notes[0]),
        lost.notes.join("; "));

  // A list of several, in order.
  const built = applyOps(box, [
    { op: "extrude", level: "face", at: [top], near: anchorsOf(box, "face", [top]),
      args: { distance: 100 } },
    { op: "inset", level: "face", at: [first.picked[0]],
      near: anchorsOf(first.mesh, "face", first.picked), args: { thickness: 20 } },
  ]);
  check("a list runs in order, each over what the one before left",
        built.notes.length === 0 && built.mesh.faces.length > first.mesh.faces.length,
        built.mesh.faces.length + " faces");
  check("an operation that throws does not stop the list",
        applyOps(box, [{ op: "loopcut", level: "edge", at: [], args: {} },
                       { op: "extrude", level: "face", at: [top],
                         near: anchorsOf(box, "face", [top]), args: { distance: 50 } }])
          .mesh.faces.length === 10);
  check("an operation nobody has heard of is a note, not a crash",
        applyOps(box, [{ op: "nonsense", at: [] }]).notes.length === 1,
        applyOps(box, [{ op: "nonsense", at: [] }]).notes.join(""));
  check("every operation in the table has a level and a label",
        Object.entries(MESH_OPS).every(([key, spec]) =>
          spec.label && spec.levels.length && spec.levels.every(l => MESH_LEVELS.includes(l))));
  check("and every one of them runs on a box without throwing",
        Object.keys(MESH_OPS).every(op => {
          const level = MESH_OPS[op].levels[0];
          const at = level === "vertex" ? [0, 1]
            : level === "edge" ? [...topologyOf(box).edges.keys()].slice(0, 2)
            : level === "element" ? [0] : [0, 1];
          const done = applyOps(box, [{ op, level, at, args: {} }]);
          return done.notes.every(n => !/did not run/.test(n));
        }), Object.keys(MESH_OPS).filter(op => {
          const level = MESH_OPS[op].levels[0];
          const at = level === "vertex" ? [0, 1]
            : level === "edge" ? [...topologyOf(box).edges.keys()].slice(0, 2)
            : level === "element" ? [0] : [0, 1];
          return applyOps(box, [{ op, level, at, args: {} }]).notes.some(n => /did not run/.test(n));
        }).join(", ") || "all of them");
}

console.log("\n13. the starting meshes are meshes you can start from");
{
  const hex = hexagonMesh({ radius: 600, rings: 2 });
  check("a hexagon is all quads", hex.faces.every(f => f.length === 4), tallyOf(hex));
  check("twelve of them at two rings", hex.faces.length === 12, String(hex.faces.length));
  check("and it is one piece with one rim",
        shellsOf(hex).length === 1 && borderLoops(hex).length === 1,
        shellsOf(hex).length + " elements, " + borderLoops(hex).length + " rims");
  check("its rim is the hexagon it says it is",
        near(Math.max(...hex.points.map(p => pmLen(p))), 600, 1e-6),
        Math.max(...hex.points.map(p => pmLen(p))).toFixed(1));

  const comb = honeycombMesh({ size: 100, rings: 1 });
  check("a honeycomb is hexagonal faces", comb.faces.every(f => f.length === 6), tallyOf(comb));
  check("one ring is seven cells", comb.faces.length === 7, String(comb.faces.length));
  check("and they share their edges rather than sitting loose",
        shellsOf(comb).length === 1, String(shellsOf(comb).length));

  const ell = lShapeMesh({ width: 1200, depth: 1200, arm: 600, leg: 600, grid: 300 });
  check("an L is all quads and one piece",
        ell.faces.every(f => f.length === 4) && shellsOf(ell).length === 1, tallyOf(ell));
  check("and it is three quarters of the rectangle",
        near(area(ell), 1200 * 1200 * 0.75, 1), area(ell).toFixed(0));
  check("with the inside corner on a vertex",
        ell.points.some(p => near(p[0], 0, 1e-6) && near(p[1], 0, 1e-6)));

  const plus = crossMesh({ width: 1200, depth: 1200, arm: 400, leg: 400, grid: 200 });
  check("a cross is one piece with a hole-free plan",
        shellsOf(plus).length === 1 && borderLoops(plus).length === 1, tallyOf(plus));

  const tube = tubeMesh({ inner: 250, outer: 500, height: 600, sides: 12 });
  check("a tube closes, and it is a doughnut so V - E + F is 0",
        openEdges(tube).length === 0 && euler(tube) === 0,
        "euler " + euler(tube) + ", open " + openEdges(tube).length);
  const ring = torusMesh({});
  check("a torus closes too, and is also 0",
        openEdges(ring).length === 0 && euler(ring) === 0, String(euler(ring)));
  const ball = sphereMesh({ radius: 100, sides: 8, rows: 6 });
  check("a sphere closes", openEdges(ball).length === 0 && euler(ball) === 2, String(euler(ball)));
  const disc = discMesh({ radius: 500, rings: 2, sides: 4 });
  check("a quad disc has no pole in the middle",
        disc.faces.every(f => f.length === 4)
        && topologyOf(disc).vertEdges.every(e => e.length <= 4), tallyOf(disc));
}

console.log("\n14. what it refuses, and what it does instead");
{
  const box = boxMesh({ dx: 100, dy: 100, dz: 100 });
  check("extruding nothing changes nothing",
        extrudeFaces(box, [], { distance: 50 }).faces.length === 6);
  check("bevelling an edge that is not there changes nothing",
        bevelEdges(box, ["99,100"], { width: 5 }).faces.length === 6);
  check("a zero-tolerance weld welds nothing",
        mergeByDistance(box, 0).points.length === 8);
  check("dissolving an open edge is refused rather than tearing the mesh",
        dissolveEdges(planeMesh({}), ["0,1"]).faces.length === 1);
  check("triangulating a triangle leaves it alone",
        triangulate(pokeFaces(planeMesh({}), [0], 0), [0]).faces.length === 4);
  const tris = triangulate(planeMesh({ width: 100, depth: 100, cols: 2, rows: 2 }), [0, 1, 2, 3]);
  check("and quads come back out of triangles",
        quadrangulate(tris, tris.faces.map((f, i) => i)).faces.filter(f => f.length === 4).length === 4,
        tallyOf(quadrangulate(tris, tris.faces.map((f, i) => i))));
  check("an empty mesh does not crash the topology",
        topologyOf({ points: [], faces: [] }).edges.size === 0);
  check("nor the tally", tallyOf({ points: [], faces: [] }) === "nothing");
  check("a mesh with no faces has bounds of nothing rather than infinity",
        Number.isFinite(boundsOf({ points: [], faces: [] }).lo[0]));
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall checks passed");
process.exit(failures ? 1 : 0);
