// Materials, and the styles that show them.
//
// Two things are checked and they are different. That a material is ONE fact -
// resolved the same way for both renderers, written down as a name rather than
// as four numbers, and still there after the document has been saved and read
// back. And that the styles are a table rather than a pile of special cases:
// what each one turns on is a row, and adding a fourth style is adding a row.
//
// The arctic pass itself is not here. It is four passes of GLSL and the only
// honest test of it is a picture, which is taken in a browser.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { ARCTIC_LOOK, ARCTIC_OVERLAY, FINISHES, VIEW_STYLES, appearanceOf, edgeRibbon,
         findFinish, findStyle, hexOf, materialOf, rgbOf } from "../src/styles.js";
import { readFileSync } from "fs";

const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const init = (await import(DIR + "/replicad_single.js")).default;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;

console.log("1. what an object is made of");
{
  const bare = materialOf(null);
  check("an object nobody has painted is not chrome", bare.finish === "default",
        bare.finish + " · " + bare.label);
  check("and it is not a mirror either", bare.metalness < 0.2 && bare.gloss < 0.6,
        "metal " + bare.metalness + ", gloss " + bare.gloss);

  const brass = materialOf({ finish: "brass" });
  check("a name is enough to be a material", brass.metalness === 1 && near(brass.gloss, 0.8),
        JSON.stringify([brass.metalness, brass.gloss]));
  check("gloss and roughness are the same number said two ways",
        near(brass.roughness, 1 - brass.gloss), brass.roughness + " vs " + brass.gloss);

  // The samples in this document ask for a finish by name. Every name they use
  // has to be a real one, or they quietly come out as something else.
  for (const key of ["aluminium", "glass"])
    check("the samples' \"" + key + "\" is a real finish", findFinish(key).key === key,
          findFinish(key).key);
  check("and a name nobody has ever written is the default, not a crash",
        findFinish("unobtanium").key === "default", findFinish("unobtanium").key);

  const painted = materialOf({ finish: "brass", color: [0.1, 0.2, 0.3], gloss: 0.2 });
  check("what the object says for itself wins",
        painted.color[0] === 0.1 && near(painted.gloss, 0.2), JSON.stringify(painted.color));
  check("and what it does not say comes from the finish", painted.metalness === 1,
        String(painted.metalness));

  const silly = materialOf({ finish: "matte", gloss: 40, opacity: -3 });
  check("numbers out of range are brought back in",
        silly.gloss === 1 && silly.opacity > 0, JSON.stringify([silly.gloss, silly.opacity]));

  const glass = materialOf({ finish: "glass" });
  check("glass is see-through without anybody saying so", glass.opacity < 0.5,
        String(glass.opacity));
}

console.log("\n2. what is written down");
{
  const plain = appearanceOf("brass");
  check("a finish is written as its name", plain.finish === "brass", JSON.stringify(plain));
  check("and nothing else is invented",
        !("gloss" in plain) && !("metalness" in plain), JSON.stringify(plain));

  const same = appearanceOf("brass", { gloss: findFinish("brass").gloss });
  check("a slider left where the finish put it is not an override",
        !("gloss" in same), JSON.stringify(same));

  const moved = appearanceOf("brass", { gloss: 0.3, opacity: 0.5 });
  check("a slider that was moved is", near(moved.gloss, 0.3) && near(moved.opacity, 0.5),
        JSON.stringify(moved));
  check("and the name is still there, so the finish still means something",
        moved.finish === "brass", JSON.stringify(moved));

  check("hex out and back is the same colour",
        hexOf(rgbOf("#3f7ac4")) === "#3f7ac4", hexOf(rgbOf("#3f7ac4")));
  check("and a colour that is not one comes back as something drawable",
        rgbOf("nonsense").every(v => v >= 0 && v <= 1), JSON.stringify(rgbOf("nonsense")));
}

console.log("\n3. the styles are a table");
{
  const keys = VIEW_STYLES.map(s => s.key);
  check("three of them, each with its own name", new Set(keys).size === keys.length,
        keys.join(", "));
  check("every one says what it is for",
        VIEW_STYLES.every(s => s.label && s.summary && s.summary.length > 40));
  check("shaded is the one that draws tangent edges",
        findStyle("shaded").edges && !findStyle("rendered").edges
        && !findStyle("arctic").edges);
  check("rendered is the only one that obeys materials",
        VIEW_STYLES.filter(s => s.materials).map(s => s.key).join() === "rendered",
        VIEW_STYLES.filter(s => s.materials).map(s => s.key).join());
  check("arctic is the only one that paints everything the same clay",
        VIEW_STYLES.filter(s => s.clay).map(s => s.key).join() === "arctic");
  check("and it is a pale clay, not white - white has nowhere left to go",
        findStyle("arctic").clay.every(v => v > 0.8 && v < 0.95),
        JSON.stringify(findStyle("arctic").clay));
  check("a style nobody has heard of is the modelling one",
        findStyle("wireframe").key === "shaded", findStyle("wireframe").key);
  check("every finish in the library has a colour and a name",
        FINISHES.every(f => f.key && f.label && f.color.length === 3
                         && typeof f.metalness === "number" && typeof f.gloss === "number"),
        FINISHES.length + " finishes");
}

console.log("\n4. it is a property of the object, so it survives the document");
{
  const kernel = await createWasmKernel({ initModule: init,
                                          wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
  const mdl = new Mdl({ kernel, apply: () => {}, setNode: () => {}, readLayout: () => ({}),
                        select: () => {}, selected: () => null, picked: () => [] });
  await kernel.loadModel({ format: "ocaf-parametric-model", version: 1, name: "M",
                           units: "mm", features: [] });
  await mdl.run({ op: "add", type: "Point", id: "O", name: "Origin" });
  await mdl.run({ op: "add", type: "Cube", id: "CU", name: "Block", refs: { origin: "O" } });

  const wear = appearanceOf("brass", { gloss: 0.31 });
  await mdl.run({ op: "appearance", id: "CU", appearance: wear });
  const at = async id => ((await kernel.tree()).tree.features.find(f => f.id === id) || {});
  check("the feature wears it", JSON.stringify((await at("CU")).appearance) === JSON.stringify(wear),
        JSON.stringify((await at("CU")).appearance));

  const file = await kernel.model();
  const written = file.features.find(f => f.id === "CU");
  check("and the model file carries it", written.appearance.finish === "brass",
        JSON.stringify(written.appearance));

  const back = await kernel.loadModel(file);
  check("the file reads back with nothing failed", back.report.failed.length === 0,
        JSON.stringify(back.report.failed.map(f => f.message)));
  const after = await at("CU");
  check("and the material is still on it", after.appearance
        && after.appearance.finish === "brass" && near(after.appearance.gloss, 0.31),
        JSON.stringify(after.appearance));
  check("which resolves to the same material either side of the file",
        materialOf(after.appearance).roughness === materialOf(wear).roughness,
        String(materialOf(after.appearance).roughness));

  // Changing a material must not rebuild geometry: it is paint, not shape.
  const was = (await at("CU")).revision;
  await mdl.run({ op: "appearance", id: "CU", appearance: appearanceOf("concrete") });
  check("painting a body does not rebuild it", (await at("CU")).revision === was,
        was + " -> " + (await at("CU")).revision);
}

/* ------------------------------------------- the overlay's own geometry

   WHAT CAN BE CHECKED ON PAPER. The shader cannot - it is a projection, and
   the honest test of it is a screenshot - but the quads it is handed can: how
   many there are, which way round they go, and the one that decides whether
   the thing draws as a line or as a row of bow ties.                        */

console.log("\nan edge, as a ribbon");
{
  //! A stand-in for the two BufferAttribute shapes three.js makes, so this
  //! runs in node with no WebGL anywhere near it. What is being checked is the
  //! arithmetic, and the arithmetic does not know what a GPU is.
  const FakeTHREE = {
    BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; } },
    BufferGeometry: class {
      constructor() { this.attributes = {}; this.index = null; }
      setAttribute(name, attribute) { this.attributes[name] = attribute; }
      setIndex(attribute) { this.index = attribute; }
      computeBoundingSphere() { this.bounded = true; }
    },
  };

  // One segment along X, from (0,0,0) to (10,0,0).
  const one = edgeRibbon(FakeTHREE, [0, 0, 0, 10, 0, 0]);
  check("a segment becomes four vertices", one.attributes.position.count === 4,
        one.attributes.position.count + " vertices");
  check("and two triangles", one.index.count === 6, one.index.count / 3 + " triangles");
  check("with the bounds worked out, or nothing is ever culled", one.bounded === true);

  const point = one.attributes.position.array, other = one.attributes.other.array;
  const side = one.attributes.side.array;
  // Two vertices sit at each end, and each carries the OTHER end as the
  // direction to be pushed square to.
  check("two vertices at each end of the segment",
        point[0] === 0 && point[3] === 0 && point[6] === 10 && point[9] === 10,
        [point[0], point[3], point[6], point[9]].join(","));
  check("and each one carries the far end with it",
        other[0] === 10 && other[3] === 10 && other[6] === 0 && other[9] === 0,
        [other[0], other[3], other[6], other[9]].join(","));

  //! THE ONE THAT MATTERS. The shader works the perpendicular out from "this
  //! end towards the other end", and that direction REVERSES at the far end -
  //! so +1 at b is the opposite side of the ribbon from +1 at a. Unflipped,
  //! every quad is a bow tie: it still draws, it is still black, and at one
  //! pixel wide nobody can see that it is wrong - until the weight slider is
  //! turned up and every line becomes a row of hourglasses.
  check("the side flips at the far end, so the quad is not a bow tie",
        side[0] === 1 && side[1] === -1 && side[2] === -1 && side[3] === 1,
        [...side].join(","));

  // The winding has to be consistent or half the ribbon vanishes under
  // back-face culling. 0,1,2 then 0,2,3 is one quad, wound one way.
  check("the two triangles share an edge and wind together",
        [...one.index.array].join(",") === "0,1,2,0,2,3",
        [...one.index.array].join(","));

  const many = edgeRibbon(FakeTHREE, new Array(6 * 5).fill(0).map((_, i) => i));
  check("five segments make five quads", many.index.count === 30,
        many.index.count / 6 + " quads");
  check("nothing at all from nothing", edgeRibbon(FakeTHREE, []) === null);
  //! A trailing half-segment is dropped rather than read past the end of the
  //! array, which is how a buffer with an odd point count used to crash.
  check("a segment with one end is not a segment",
        edgeRibbon(FakeTHREE, [0, 0, 0, 1, 1]) === null);

  check("the overlay has a layer of its own, and it is not the one everything "
        + "else draws on", ARCTIC_OVERLAY > 0, String(ARCTIC_OVERLAY));
  check("and the tick starts off, because an overlay is an opinion",
        ARCTIC_LOOK.edges === false);
  check("arctic still draws no tangent edges of its own - the overlay is the "
        + "whole of that answer", findStyle("arctic").edges === false);
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall checks passed");
process.exit(failures ? 1 : 0);
