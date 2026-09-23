// Picking an edge, and still meaning that edge tomorrow.
//
// "Fillet this body" is a blunt answer; what a person means is "round THESE
// four edges". The moment an operation is about particular edges, the program
// has to write down WHICH, in a file, in a way that survives the box
// underneath being made wider. Everything here is that claim, checked.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { describePicks, edgeAnchor, endsOf, faceAnchor, matchPick, pickOf,
         readPicks, resolvePicks, smoothPatch, spanOf, tangentChain,
         writePicks } from "../src/subshape.js";
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
const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                      select: () => {}, selected: () => null });
const tree = async () => (await kernel.tree()).tree.features;
const at = async id => (await tree()).find(f => f.id === id);
//! A document with the three datums a solid needs to stand on. Every test here
//! starts from one, because a Cube with nowhere to be is a Cube that does not
//! build and has no edges to pick.
const fresh = async () => {
  await mdl.run({ op: "model", model: { format: "ocaf-parametric-model",
    version: 1, name: "Picks", units: "mm", features: [] } });
  await mdl.run({ op: "add", type: "Point", id: "P0", name: "Origin" });
  await mdl.run({ op: "add", type: "Vector", id: "VZ", name: "Z" });
  await mdl.run({ op: "set", id: "VZ", key: "dz", value: 1 });
  await mdl.run({ op: "add", type: "Plane", id: "PL", name: "XY",
                  refs: { origin: "P0", normal: "VZ" } });
};
const block = async (id, name) => mdl.run({ op: "add", type: "Cube", id, name,
  refs: { origin: "P0", plane: "PL" } });

console.log("1. where a thing is, said in seven numbers");
{
  // An edge along Y, from (40,-40,40) to (40,40,40).
  const straight = [[40, -40, 40], [40, 0, 40], [40, 40, 40]];
  const anchor = edgeAnchor(straight);
  check("the anchor is the middle of the edge, not the middle of the list",
        near(anchor[0], 40, 1e-9) && near(anchor[1], 0, 1e-9) && near(anchor[2], 40, 1e-9),
        anchor.slice(0, 3).join(","));
  check("with the way it runs there", near(Math.abs(anchor[4]), 1, 1e-9), anchor.slice(3, 6).join(","));
  check("and half its length", near(anchor[6], 40, 1e-9), String(anchor[6]));

  // A polyline that is fine at one end and coarse at the other: the middle of
  // the LIST is nowhere near the middle of the edge.
  const uneven = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [100, 0, 0]];
  check("even on a polyline that is finer at one end",
        near(edgeAnchor(uneven)[0], 50, 1e-9), String(edgeAnchor(uneven)[0]));

  // A face: a square in the z = 0 plane, tessellated unevenly.
  const positions = [0, 0, 0, 100, 0, 0, 100, 100, 0, 0, 100, 0, 50, 50, 0];
  const index = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];
  const face = faceAnchor(positions, index);
  check("a face's middle is weighted by area rather than by vertex",
        near(face[0], 50, 1e-6) && near(face[1], 50, 1e-6), face.slice(0, 3).join(","));
  check("and it faces the way its triangles wind",
        near(face[5], 1, 1e-9), face.slice(3, 6).join(","));
  check("and reaches to its furthest corner", near(face[6], Math.hypot(50, 50), 1e-6),
        String(face[6]));
}

console.log("\n2. the pick, as text");
{
  const pick = pickOf("CB1", "edge", 2, [40, 0, 40, 0, 1, 0, 40]);
  const text = writePicks([pick]);
  check("it reads as what it is",
        /"of":"CB1"/.test(text) && /"kind":"edge"/.test(text) && /"at":2/.test(text), text);
  check("and comes back the same", JSON.stringify(readPicks(text)) === JSON.stringify([pick]));
  check("nothing picked is not an empty list of things, it is the whole thing",
        describePicks([], "edge", "every edge") === "every edge");
  check("and some picked says how many", describePicks([pick, pick], "edge") === "2 edges");
  check("a file somebody broke loses the line rather than the feature",
        readPicks("{ not json").length === 0 && readPicks('[{"at":1}]').length === 0
        && readPicks('[{"kind":"edge","at":1},"rubbish"]').length === 1);
}

console.log("\n3. finding it again after the body changes under it");
{
  // Twelve edges of a 80 mm cube, as anchors.
  const cube = size => {
    const out = [];
    for (const axis of [0, 1, 2])
      for (const a of [0, size])
        for (const b of [0, size]) {
          const mid = [0, 0, 0], way = [0, 0, 0];
          mid[axis] = size / 2;
          way[axis] = 1;
          mid[(axis + 1) % 3] = a;
          mid[(axis + 2) % 3] = b;
          out.push([...mid, ...way, size / 2]);
        }
    return out;
  };
  const was = cube(80);
  const pick = { of: "CB1", kind: "edge", at: 5, near: was[5] };
  check("the index is taken when it still lands on the same thing",
        matchPick(was, pick) === 5);

  // The body is made wider. Every edge has moved; the one that was picked is
  // still the nearest thing running the same way.
  const now = cube(90);
  const found = matchPick(now, pick);
  check("and when it has moved, the nearest one running the same way is it",
        found === 5, String(found));

  // An edge that has gone: the pick says so rather than rounding another one.
  const elsewhere = cube(80).map(a => [a[0] + 9000, a[1], a[2], a[3], a[4], a[5], a[6]]);
  check("an edge that is not there any more is lost, not swapped",
        matchPick(elsewhere, pick) === -1);
  const { found: kept, lost } = resolvePicks(elsewhere, [pick, pick]);
  check("and the list says which", kept.length === 0 && lost.length === 2);
  check("a span is measured off the shape rather than guessed",
        near(spanOf(was), Math.hypot(80, 80, 80), 1e-6), String(spanOf(was)));
}

console.log("\n4. the whole arris, from one edge of it");
{
  // A slab 200 x 100 whose two ends are half-round: the top rim is four edges,
  // two straight and two arcs, and they are all tangent to each other.
  const arc = (cx, cy, from, to, r) => {
    const out = [];
    for (let i = 0; i <= 16; i++) {
      const a = from + (to - from) * (i / 16);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 0]);
    }
    return out;
  };
  const rim = [
    [[0, -50, 0], [100, -50, 0]],                       // the straight front
    arc(100, 0, -Math.PI / 2, Math.PI / 2, 50),         // the round right end
    [[100, 50, 0], [0, 50, 0]],                         // the straight back
    arc(0, 0, Math.PI / 2, Math.PI * 1.5, 50),          // the round left end
    [[0, 0, 40], [100, 0, 40]],                         // and one nowhere near it
  ];
  const chain = tangentChain(rim, 0, { angle: 5 });
  check("double-clicking one edge of a tangent rim takes the whole rim",
        chain.join(",") === "0,1,2,3", chain.join(","));
  check("and leaves alone what it is not tangent to", !chain.includes(4));
  check("from any edge of it, the same rim", tangentChain(rim, 2).join(",") === "0,1,2,3");

  // A corner is not a tangency, however close the edges are.
  const corner = [[[0, 0, 0], [100, 0, 0]], [[100, 0, 0], [100, 100, 0]]];
  check("a right angle is a corner, not an arris",
        tangentChain(corner, 0, { angle: 5 }).join(",") === "0");
  check("but a wide enough angle takes it, if that is what you asked for",
        tangentChain(corner, 0, { angle: 95 }).join(",") === "0,1");
  check("an edge that is not there gives nothing rather than throwing",
        tangentChain(rim, 99).length === 0);
  check("the ends of a polyline point into it",
        endsOf([[0, 0, 0], [10, 0, 0]]).way[0][0] === 1
        && endsOf([[0, 0, 0], [10, 0, 0]]).way[1][0] === -1);
}

console.log("\n5. a real body: picking its edges and rounding only those");
{
  await fresh();
  await block("CB1", "Block");
  for (const key of ["dx", "dy", "dz"]) await mdl.run({ op: "set", id: "CB1", key, value: 80 });

  const list = await kernel.picks("CB1", "edge");
  check("a cube offers twelve edges, not twenty-four",
        list.items.length === 12, String(list.items.length));
  check("each with a polyline to draw it and an anchor to find it",
        list.items.every(one => one.points.length >= 2 && one.near.length === 7));
  check("and they are 80 mm long",
        list.items.every(one => near(one.near[6], 40, 0.01)),
        list.items.map(one => one.near[6].toFixed(1)).join(","));
  const faces = await kernel.picks("CB1", "face");
  check("and six faces", faces.items.length === 6, String(faces.items.length));
  check("each with its own triangles",
        faces.items.every(one => one.index.length >= 3 && one.near.length === 7));

  // Round four edges, not twelve.
  const upright = list.items.filter(one => Math.abs(one.near[5]) > 0.9);
  check("four of the twelve run up", upright.length === 4, String(upright.length));
  const fillet = await mdl.run({ op: "add", type: "Fillet", id: "FL1", refs: { body: "CB1" } });
  await mdl.run({ op: "set", id: "FL1", key: "radius", value: 10 });
  let entry = await at("FL1");
  check("with nothing picked it rounds the lot", !entry.error && entry.built, entry.error);
  const all = await countFaces("FL1");

  await mdl.run({ op: "pick", id: "FL1", key: "edges",
                  picks: upright.map(one => pickOf("CB1", "edge", one.at, one.near)) });
  entry = await at("FL1");
  check("with four picked it builds", !entry.error && entry.built, entry.error);
  check("and says so", /4 edges rounded/.test(entry.note || ""), entry.note);
  const four = await countFaces("FL1");
  check("four rounded edges is fewer faces than twelve",
        four < all && four === 10, four + " against " + all);

  // IT SURVIVES THE FILE.
  const text = await mdl.modelText();
  check("the picks are in the model file, readable",
        /"edges"/.test(text) && /"kind": "edge"/.test(text) && /"of": "CB1"/.test(text),
        (text.match(/"edges"[\s\S]{0,120}/) || [""])[0].replace(/\s+/g, " "));
  await fresh();
  await mdl.run({ op: "model", model: JSON.parse(text) });
  check("and come back out of it still rounding four",
        !(await at("FL1")).error && (await countFaces("FL1")) === 4 + 6,
        String(await countFaces("FL1")));

  // AND IT SURVIVES THE BODY CHANGING SHAPE.
  await mdl.run({ op: "set", id: "CB1", key: "dx", value: 160 });
  entry = await at("FL1");
  check("stretching the block does not lose the picked edges",
        !entry.error && /4 edges rounded/.test(entry.note || ""), entry.error || entry.note);
  check("and it is still ten faces", (await countFaces("FL1")) === 10,
        String(await countFaces("FL1")));

  // A pick that has genuinely gone says so rather than rounding something else.
  await mdl.run({ op: "pick", id: "FL1", key: "edges",
    picks: [pickOf("CB1", "edge", 0, [9000, 9000, 9000, 0, 0, 1, 40]),
            ...upright.slice(0, 2).map(one => pickOf("CB1", "edge", one.at, one.near))] });
  entry = await at("FL1");
  check("a pick whose edge has gone is counted and named, not guessed at",
        !entry.error && /no longer in this body/.test(entry.note || ""), entry.note);
  check("while the ones that are still there are still rounded",
        /2 edges rounded/.test(entry.note || ""), entry.note);
}

console.log("\n6. the arris, on a real body");
{
  // A slab with its four uprights rounded: the top is a square with round
  // corners, and its rim is four straight edges and four arcs, all tangent to
  // each other and none of them tangent to anything below. Which is the shape
  // this gesture exists for - eight edges nobody wants to pick one at a time.
  await fresh();
  await block("CB1", "Slab");
  for (const [key, value] of [["dx", 200], ["dy", 120], ["dz", 40]])
    await mdl.run({ op: "set", id: "CB1", key, value });
  const raw = await kernel.picks("CB1", "edge");
  const uprights = raw.items.filter(one => Math.abs(one.near[5]) > 0.9);
  await mdl.run({ op: "add", type: "Fillet", id: "FL1", refs: { body: "CB1" } });
  await mdl.run({ op: "set", id: "FL1", key: "radius", value: 15 });
  await mdl.run({ op: "pick", id: "FL1", key: "edges",
                  picks: uprights.map(one => pickOf("CB1", "edge", one.at, one.near)) });
  const entry = await at("FL1");
  check("the corners are rounded and the rest is left alone",
        !entry.error && /4 edges rounded/.test(entry.note || ""), entry.error || entry.note);

  const edges = await kernel.picks("FL1", "edge");
  const top = edges.items.filter(one => near(one.near[2], 40, 0.01));
  check("the top of it is eight edges - four straight and four round",
        top.length === 8, String(top.length));
  const straight = top.find(one => Math.abs(one.near[3]) > 0.99 || Math.abs(one.near[4]) > 0.99);
  const chain = (await kernel.tangentFrom("FL1", straight.at, 5)).chain;
  check("double-clicking one of them takes the whole rim, corners and all",
        chain.length === 8, chain.length + " taken");
  check("and it is exactly the top rim",
        chain.every(i => top.some(one => one.at === i)),
        chain.map(i => edges.items[i].near[2].toFixed(1)).join(","));
  check("the bottom rim is its own arris, and is not taken with it",
        (await kernel.tangentFrom("FL1", edges.items.findIndex(one =>
          near(one.near[2], 0, 0.01)), 5)).chain.every(i =>
            near(edges.items[i].near[2], 0, 0.01)));
  check("and a tighter angle refuses the corners",
        (await kernel.tangentFrom("FL1", straight.at, 0.01)).chain.length < 8,
        String((await kernel.tangentFrom("FL1", straight.at, 0.01)).chain.length));
}

console.log("\n7. a draft that hinges on a face of the body");
{
  await fresh();
  await block("CB1", "Block");
  for (const key of ["dx", "dy", "dz"]) await mdl.run({ op: "set", id: "CB1", key, value: 100 });
  const draft = await mdl.run({ op: "add", type: "Draft", id: "DR1", refs: { body: "CB1" } });
  let entry = await at("DR1");
  check("with no plane and no face it says what it needs",
        !!entry.error && /pick a face of the body/.test(entry.error), entry.error);

  const faces = await kernel.picks("CB1", "face");
  const bottom = faces.items.find(one => near(one.near[2], 0, 0.5) && one.near[5] < -0.9);
  check("the body has a bottom face to hinge on", !!bottom,
        faces.items.map(one => one.near.slice(3, 6).map(v => v.toFixed(0)).join("/")).join(" "));
  await mdl.run({ op: "pick", id: "DR1", key: "hinge",
                  picks: [pickOf("CB1", "face", bottom.at, bottom.near)] });
  await mdl.run({ op: "set", id: "DR1", key: "angle", value: 6 });
  entry = await at("DR1");
  check("picking it is enough - no datum plane needed", !entry.error && entry.built, entry.error);
  check("and it says it hinged on a picked face",
        /about a picked face/.test(entry.note || ""), entry.note);
}

console.log("\n8. what it refuses");
{
  let threw = "";
  try { await mdl.run({ op: "pick", id: "CB1", key: "edges", picks: [] }); }
  catch (error) { threw = error.message; }
  check("a feature with no picked argument refuses one, by name",
        /has no picked sub-shapes/.test(threw), threw);
  threw = "";
  try { await mdl.run({ op: "pick", id: "DR1", key: "hinge", picks: "not a list" }); }
  catch (error) { threw = error.message; }
  check("and a list that is not a list", /must be a list/.test(threw), threw);
  threw = "";
  try { await kernel.picks("nothing", "edge"); } catch (error) { threw = error.message; }
  check("picking off a feature that is not there says so", /no feature/.test(threw), threw);
  check("smoothPatch on nothing gives nothing rather than throwing",
        smoothPatch([], 0).length === 0);
}

async function countFaces(id) {
  const stream = (await kernel.mesh([id])).features[0];
  // Each face of a B-Rep is one flat region; count them off the picks instead,
  // which is the same enumeration the driver used.
  return (await kernel.picks(id, "face")).items.length;
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall checks passed");
process.exit(failures ? 1 : 0);
