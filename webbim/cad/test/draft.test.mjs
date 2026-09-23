// A section computed twice, by two different roads.
//
// The file this was written for extrudes twenty-three offset curves and
// intersects a solid with them, and it took four and a half seconds. Not
// because the WASM is slow: OpenCascade has an analytic intersector for a
// plane against a cylinder and none at all for either of them against a
// surface of extrusion over a B-spline, so every one of a hundred and sixty
// face pairs went to the general numeric intersector at about thirty
// milliseconds each. Turning the approximation off, sectioning the parts one
// at a time and a bounding-box prefilter were all tried and all changed
// nothing, because none of them changes which intersector gets called.
//
// So while a hand is on a slider the section is taken on the triangles - the
// ones the viewer was going to be given anyway - and the moment it comes off
// it is taken properly. Two things have to be true for that to be honest, and
// they are what this file checks:
//
//   the cheap answer is the same answer, to the accuracy of the triangles;
//   the cheap answer never survives the hand coming off the slider.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { chainSegments, meshCross, meshSlice, thin } from "../src/draft.js";
import { readFileSync } from "fs";

const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const init = (await import(DIR + "/replicad_single.js")).default;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, within) => Math.abs(a - b) <= within;

/* ------------------------------------------------------ 1. the arithmetic */

//! A box as twelve triangles, written out by hand so the answers below can be
//! worked out on paper.
function boxMesh(lo, hi) {
  const positions = [];
  for (const z of [lo[2], hi[2]])
    for (const y of [lo[1], hi[1]])
      for (const x of [lo[0], hi[0]]) positions.push(x, y, z);
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1],
                 [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const index = [];
  for (const [a, b, c, d] of quads) index.push(a, b, c, a, c, d);
  return { positions, index };
}
const runLength = run => run.reduce((sum, p, i) => i
  ? sum + Math.hypot(p[0] - run[i - 1][0], p[1] - run[i - 1][1], p[2] - run[i - 1][2])
  : 0, 0);
const totalLength = runs => runs.reduce((sum, run) => sum + runLength(run), 0);

console.log("1. triangles against a plane, and triangles against triangles");
{
  const cube = boxMesh([0, 0, 0], [100, 100, 100]);
  const flat = chainSegments(meshSlice(cube, [0, 0, 50], [0, 0, 1]));
  check("a 100 cube cut halfway up gives one loop", flat.length === 1, String(flat.length));
  check("  1000 mm round, which is 4 x 100", near(totalLength(flat), 400, 1e-9),
        String(totalLength(flat)));
  const thinned = flat.map(run => thin(run, 0.01));
  check("  thinned to its corners and no more", thinned[0].length === 5,
        String(thinned[0].length));
  check("  without losing a millimetre of it", near(totalLength(thinned), 400, 1e-9),
        String(totalLength(thinned)));

  //! A plane that misses is not an empty loop, it is no loop.
  check("a plane that misses gives nothing",
        chainSegments(meshSlice(cube, [0, 0, 500], [0, 0, 1])).length === 0);

  //! Two boxes overlapping in a 50 x 50 x 100 corner. Where their SKINS meet
  //! is a closed loop: 100 up the x=100 face, 100 up the y=0 face, and 50 + 50
  //! across each of the z=0 and z=100 faces. 400 again, for a different reason.
  const other = boxMesh([50, -50, -50], [150, 50, 150]);
  const cross = chainSegments(meshCross(cube, other));
  check("two boxes overlapping in a corner meet in one loop",
        cross.length === 1, String(cross.length));
  check("  400 mm of it", near(totalLength(cross), 400, 1e-9), String(totalLength(cross)));

  //! The grid is built over whichever mesh is larger, so the walk is over the
  //! smaller - and the answer may not depend on which was handed in first.
  const swapped = chainSegments(meshCross(other, cube));
  check("  and the same either way round",
        near(totalLength(swapped), totalLength(cross), 1e-9), String(totalLength(swapped)));

  check("two boxes that do not touch meet nowhere",
        meshCross(cube, boxMesh([500, 500, 500], [600, 600, 600])).length === 0);
}

/* --------------------------------------------------- 2. against the kernel */

const kernel = await createWasmKernel({ initModule: init,
                                        wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                      select: () => {}, selected: () => null });
await mdl.run({ op: "model", model: { format: "ocaf-parametric-model", version: 1,
                                      name: "Draft", units: "mm", features: [] } });
const add = async (type, more = {}) => (await mdl.run({ op: "add", type, ...more })).id;
const set = (id, key, value) => mdl.run({ op: "set", id, key, value });
const at = async id => (await kernel.tree()).tree.features.find(f => f.id === id);
//! How long the section is, off the edges themselves. A section is the one
//! thing in the catalogue whose whole content is its length, so the length is
//! the only fair way to ask whether two roads to it agree.
const sectionLength = async id => {
  const items = (await kernel.picks(id, "edge")).items || [];
  return items.reduce((sum, edge) => sum + runLength(edge.points), 0);
};

const PT = await add("Point");
const VZ = await add("Vector"); await set(VZ, "dx", 0); await set(VZ, "dz", 1);
const PL = await add("Plane", { refs: { origin: PT, normal: VZ } });
await set(PL, "offset", 0);

const CB = await add("Cube");
for (const [k, v] of [["dx", 200], ["dy", 200], ["dz", 200]]) await set(CB, k, v);

console.log("\n2. a cube sectioned by a plane, exactly and cheaply");
{
  //! A cube 200 on a side, centred on the origin, cut by the XY plane: a
  //! 200-square loop, 800 mm round. Both roads have to say 800.
  const IN = await add("Intersect", { refs: { a: CB, b: PL } });
  const exact = await sectionLength(IN);
  check("the exact section is 800 mm round", near(exact, 800, 1e-6), String(exact));

  await mdl.draft(true, false);
  await set(CB, "dx", 240);
  const drafted = await sectionLength(IN);
  //! Flat against flat is the one case the two roads agree on exactly: a
  //! square cut off a box is four straight lines whether it was worked out
  //! from surfaces or from triangles, because the triangles ARE the surfaces.
  check("a wider cube drafted gives 880", near(drafted, 880, 1e-6), String(drafted));
  check("  and the node is still built and silent", !(await at(IN)).error,
        (await at(IN)).error || "");

  //! The whole of the guarantee: a draft is a picture held while a number is
  //! moving, and nothing else. Letting go rebuilds it.
  await mdl.draft(false, true);
  const settled = await sectionLength(IN);
  check("letting go rebuilds it exactly", near(settled, 880, 1e-6), String(settled));

  //! An exact section of a flat cut is four edges. A drafted one is four
  //! polylines of two points, which is also four edges - the check that means
  //! something is that the exact road left no polylines behind, and the length
  //! agreeing to a micron is that check.
  await mdl.run({ op: "delete", id: IN });
}

console.log("\n3. a cylinder sectioned by a solid, where the accuracy is the triangles'");
{
  //! A section no plane can stand in for: a round cylinder crossed by a box,
  //! straight through, so the answer is two circles of radius 100 and nothing
  //! else - 1256.637 mm of arc, which is the number to beat.
  //!
  //! Both roads are READ as polylines, because that is what picks hands back,
  //! so neither of them reads 1256.637 exactly. What matters is that they read
  //! the same, and that the exact one is the one still standing at the end.
  const PL2 = await add("Plane", { refs: { from: PL } });
  await set(PL2, "kind", 2); await set(PL2, "offset", -50);
  const C = await add("Point");
  await set(C, "x", 200); await set(C, "y", 200); await set(C, "z", -50);
  const CI = await add("Circle", { refs: { plane: PL2, centre: C } });
  await set(CI, "radius", 100);
  const EX = await add("Extrude", { refs: { profile: CI } });
  await set(EX, "distance", 300);
  const CUT = await add("Cube");
  for (const [k, v] of [["dx", 400], ["dy", 400], ["dz", 100]]) await set(CUT, k, v);
  const IN = await add("Intersect", { refs: { a: EX, b: CUT } });

  const exact = await sectionLength(IN);
  check("the exact section is two circles of radius 100",
        near(exact, 4 * Math.PI * 100, 4), exact.toFixed(3));

  await mdl.draft(true, false);
  await set(CUT, "dz", 100.0001);            // a nudge, so something rebuilds
  const drafted = await sectionLength(IN);
  check("the drafted section is the same curve, within the tessellation",
        near(drafted, exact, exact * 0.005), drafted.toFixed(3) + " against " + exact.toFixed(3));

  //! And the guarantee. The switch itself answers with a rebuilt document
  //! when there was a draft to replace, which is what the interface waits on -
  //! the accurate answer arrives as an ordinary redraw a frame after the hand
  //! comes off, and nothing has to remember to ask for it.
  const settling = await mdl.draft(false, true);
  check("letting go rebuilds by itself, without another edit", !!(settling && settling.tree));
  const settled = await sectionLength(IN);
  check("and puts the arcs back", near(settled, exact, 1e-6), settled.toFixed(3));

  //! Nothing to replace, nothing to rebuild. A model with no hand on it never
  //! pays for this.
  await mdl.draft(true, false);
  check("a draft nobody built anything under costs nothing to leave",
        (await mdl.draft(false, true)) === null);
}

console.log("\n4. a model that is fast enough does not want any of this");
{
  //! Said here because it is the whole reason the switch is measured rather
  //! than declared: the cheap road is a slightly coarser curve, and paying
  //! that for a rebuild nobody was waiting on would be a straight loss. The
  //! interface times its last ACCURATE rebuild and only drafts above a
  //! threshold - see drainParameters in app.js - so the switch below is what
  //! a fast model sees, which is nothing at all.
  check("the kernel offers the switch", typeof kernel.setDraft === "function");
  check("and turning it on answers with nothing to redraw",
        (await kernel.setDraft(true)) === null);
  await kernel.setDraft(false);
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall good");
process.exit(failures ? 1 : 0);
