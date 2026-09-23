// Taking a shape apart by its faces, and putting a panel back together.
//
// Everything downstream of a surface is about ONE face of it. Before there was
// a node that could say which, every sampler, panel and thickness silently
// meant "whichever face the explorer reached first" - an accident of how the
// shape was built, not a thing anybody chose. And a panel made from four
// corners of a curved skin could not be built at all, because the flat
// face-maker refuses anything out of plane and four samples off a loft are
// never coplanar.
//
// Two nodes answer those: Face, which hands back the faces picked off a shape,
// and Fill, which makes the face a boundary bounds whether or not it is flat.
// Measure learned to count, because you cannot ask for face 5 of a skin until
// you know there are nine. Checked against a real kernel.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
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
const why = f => (f && (f.error || f.note)) || "";
//! What a feature computed, read off the summary the tree carries: a number
//! on its own, and the first point of a list of points.
const num = f => Number((f && f.data && f.data.preview) || NaN);
const xyz = f => {
  const preview = f && f.data && f.data.preview;
  const first = preview && preview.match(/\(([^)]*)\)/);
  return first ? first[1].split(",").map(Number) : [];
};
const away = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
//! Add wires refs and nothing else, so every number is a set of its own.
const make = async (type, id, name, refs, args = {}) => {
  await mdl.run({ op: "add", type, id, name, refs });
  for (const [key, value] of Object.entries(args))
    await mdl.run({ op: "set", id, key, value });
  return at(id);
};

await mdl.run({ op: "model", model: { format: "ocaf-parametric-model",
  version: 1, name: "Faces", units: "mm", features: [] } });
await mdl.run({ op: "add", type: "Point", id: "P0", name: "Origin" });
await mdl.run({ op: "add", type: "Vector", id: "VZ", name: "Z" });
await mdl.run({ op: "set", id: "VZ", key: "dz", value: 1 });
await mdl.run({ op: "add", type: "Plane", id: "PL", name: "XY",
                refs: { origin: "P0", normal: "VZ" } });
await mdl.run({ op: "add", type: "Cube", id: "CB", name: "Block",
                refs: { origin: "P0", plane: "PL" } });
for (const [key, value] of [["dx", 200], ["dy", 120], ["dz", 80]])
  await mdl.run({ op: "set", id: "CB", key, value });

console.log("1. how many, which is what you need before you can ask for one");
{
  check("the block built", !(await at("CB")).error, why(await at("CB")));
  const counts = async (quantity, id) => {
    const f = await make("Measure", id, id, { shape: "CB" }, { quantity });
    return f.error ? f.error : num(f);
  };
  const faces = await counts(7, "MF"), edges = await counts(8, "ME");
  const marks = await counts(9, "MV");
  check("faces", faces === 6, String(faces));
  check("edges", edges === 12, String(edges));
  check("vertices", marks === 8, String(marks));
  // The old quantities have not moved: an index IS its meaning, and a model
  // file written last week says 1 for area and 2 for volume.
  const area = await counts(1, "MA"), volume = await counts(2, "MC");
  check("area is still quantity 1",
        near(area, 2 * (200 * 120 + 200 * 80 + 120 * 80), 1), String(area));
  check("and volume still 2", near(volume, 200 * 120 * 80, 1), String(volume));
}

console.log("\n2. one face of it, as a shape of its own");
{
  await mdl.run({ op: "add", type: "Face", id: "FC", name: "A face",
                  refs: { of: "CB" } });
  const all = await at("FC");
  check("with nothing picked it is every face", !all.error && /every face · 6/.test(all.note || ""),
        why(all));

  // "face 2 of the block", written the way a model file writes it - an ordinal
  // and nothing else, which is all an assistant editing the file has to go on.
  await mdl.run({ op: "pick", id: "FC", key: "faces",
                  picks: [{ of: "CB", kind: "face", at: 2 }] });
  const one = await at("FC");
  check("a bare ordinal picks that face", !one.error && /1 face of 6/.test(one.note || ""),
        why(one));
  await make("Measure", "MN", "On it", { shape: "FC" }, { quantity: 7 });
  check("and what comes out has exactly one face on it",
        num(await at("MN")) === 1, String(num(await at("MN"))));
  await make("Measure", "MS", "Its area", { shape: "FC" }, { quantity: 1 });
  const area = num(await at("MS"));
  check("with the area of one side of the block, not the whole skin",
        [200 * 120, 200 * 80, 120 * 80].some(v => near(area, v, 1)), String(area));

  await mdl.run({ op: "pick", id: "FC", key: "faces",
                  picks: [{ of: "CB", kind: "face", at: 1 }, { of: "CB", kind: "face", at: 5 }] });
  check("two picks give two faces", /2 faces of 6/.test(why(await at("FC"))), why(await at("FC")));
  check("and the shape carries both", num(await at("MN")) === 2,
        String(num(await at("MN"))));

  // A pick nobody can honour is SAID to be lost, not quietly done less of.
  await mdl.run({ op: "pick", id: "FC", key: "faces",
                  picks: [{ of: "CB", kind: "face", at: 99 }] });
  const gone = await at("FC");
  check("a pick off the end is refused rather than rounded down",
        !!gone.error && /any more/.test(gone.error), why(gone));

  // And a pick survives the body changing shape underneath it.
  await mdl.run({ op: "pick", id: "FC", key: "faces",
                  picks: [{ of: "CB", kind: "face", at: 2 }] });
  const held = num(await at("MS"));
  await mdl.run({ op: "set", id: "CB", key: "dx", value: 400 });
  const after = await at("FC");
  check("and a pick holds when the block is stretched",
        !after.error && /1 face of 6/.test(after.note || ""), why(after));
  check("on a face that grew with it", num(await at("MS")) !== held,
        held + " -> " + num(await at("MS")));
  await mdl.run({ op: "set", id: "CB", key: "dx", value: 200 });
}

console.log("\n3. sampling THAT face, rather than whichever came first");
{
  await make("EvaluateSurface", "EV", "Middle", { surface: "CB" }, { u: 0.5, v: 0.5, normal: 0 });
  const first = await at("EV");
  check("with nothing picked it samples the first face, and says which",
        !first.error && /face 1 of 6/.test(first.note || ""), why(first));
  const one = xyz(first);

  await mdl.run({ op: "pick", id: "EV", key: "face",
                  picks: [{ of: "CB", kind: "face", at: 3 }] });
  const picked = await at("EV");
  check("picking a face samples that one", !picked.error && /face 4 of 6/.test(picked.note || ""),
        why(picked));
  check("and lands somewhere else on the block", away(one, xyz(picked)) > 1,
        one.join(",") + " -> " + xyz(picked).join(","));

  // Every face of the block, sampled at its middle: six faces, six places.
  const seen = [];
  for (let i = 0; i < 6; i++) {
    await mdl.run({ op: "pick", id: "EV", key: "face",
                    picks: [{ of: "CB", kind: "face", at: i }] });
    seen.push(xyz(await at("EV")));
  }
  const apart = seen.every((a, i) => seen.every((b, j) => i === j || away(a, b) > 1));
  check("all six faces are six different places", apart,
        seen.map(p => p.map(Math.round).join("/")).join("  "));
  // They are the six face centres of a 200 x 120 x 80 block standing on the
  // origin: each is the centre in two axes and flat against a face in the third.
  const centre = [100, 60, 40];
  const onAFace = seen.every(p => p.some((v, k) => near(v, 0, 1e-6)
    || near(v, centre[k] * 2, 1e-6)));
  check("each one is the middle of a side", onAFace,
        seen.map(p => p.map(Math.round).join("/")).join("  "));

  // And a pick that has gone says so rather than falling back to face one,
  // which would be the old silent defect wearing an argument.
  await mdl.run({ op: "pick", id: "EV", key: "face",
                  picks: [{ of: "CB", kind: "face", at: 42 }] });
  check("a lost pick is an error, not a quiet fallback",
        /not in that shape any more/.test(why(await at("EV"))), why(await at("EV")));
  await mdl.run({ op: "pick", id: "EV", key: "face", picks: [] });
}

console.log("\n4. a face from a boundary - flat when it is flat");
{
  const corner = async (id, x, y, z) => {
    await mdl.run({ op: "add", type: "Point", id, name: id });
    for (const [key, value] of [["x", x], ["y", y], ["z", z]])
      await mdl.run({ op: "set", id, key, value });
  };
  await corner("A", 0, 0, 0); await corner("B", 100, 0, 0);
  await corner("C", 100, 100, 0); await corner("D", 0, 100, 0);
  await make("Polyline", "SQ", "Square", { points: ["A", "B", "C", "D"] }, { closed: 1 });
  await mdl.run({ op: "add", type: "Fill", id: "F1", name: "Flat panel",
                  refs: { boundary: "SQ" } });
  const flat = await at("F1");
  check("a flat boundary gives a planar face", !flat.error && flat.note === "planar", why(flat));
  await make("Measure", "MP", "Panel area", { shape: "F1" }, { quantity: 1 });
  check("and it is the area the square encloses",
        near(num(await at("MP")), 10000, 1), String(num(await at("MP"))));

  console.log("\n5. and patched when it is not");
  // One corner lifted 40 mm: no plane passes through these four points, so the
  // flat face-maker has no answer at all. This is exactly the shape four
  // samples off a curved skin come out as.
  await mdl.run({ op: "set", id: "C", key: "z", value: 40 });
  const warped = await at("F1");
  check("a warped boundary still gives a face", !warped.error, why(warped));
  check("and it says it had to patch it", /patched/.test(warped.note || ""), why(warped));
  const area = num(await at("MP"));
  // Bigger than the 100 x 100 it would be if flat, and not wildly so: the patch
  // is the surface through those four edges, not a bubble over them.
  check("with an area a warped 100 x 100 panel would have",
        area > 10000 && area < 11500, String(Math.round(area)));

  await mdl.run({ op: "set", id: "F1", key: "surface", value: 1 });
  check("Planar only says no rather than guessing", !!(await at("F1")).error, why(await at("F1")));
  await mdl.run({ op: "set", id: "F1", key: "surface", value: 2 });
  check("and Patch is always a patch", (await at("F1")).note === "patched", why(await at("F1")));
  await mdl.run({ op: "set", id: "C", key: "z", value: 0 });
  check("a patch through a flat boundary is still a face",
        !(await at("F1")).error, why(await at("F1")));
  await mdl.run({ op: "set", id: "F1", key: "surface", value: 0 });
}

console.log("\n6. the panel a real skin makes: four samples, filled, thickened");
{
  // What the assistant was trying to build. A skin with more than one face on
  // it: a ruled loft through three circles, left open as a surface.
  await make("Vector", "VX", "X", {}, { dx: 1, dz: 0 });
  await make("Plane", "PMF", "Waist level", { from: "PL" }, { kind: 2, offset: 150 });
  // TILTED, so the skin is doubly curved and a panel on it is genuinely
  // warped. A cone is not: four corners of one strip of a cone lie in a plane,
  // and Fill would rightly hand back a planar face.
  await make("Plane", "PM", "Waist", { turn: "PMF", axis: "VX" }, { kind: 4, angle: 22 });
  await make("Plane", "PT", "Top", { from: "PL" }, { kind: 2, offset: 300 });
  await make("Circle", "C1", "Foot", { plane: "PL" }, { radius: 120 });
  await make("Circle", "C2", "Waist", { plane: "PM" }, { radius: 60 });
  await make("Circle", "C3", "Head", { plane: "PT" }, { radius: 100 });
  await make("Loft", "SKIN", "Skin", { sections: ["C1", "C2", "C3"] }, { cap: 1, ruled: 1 });
  const skin = await at("SKIN");
  check("the skin built", !skin.error, why(skin));
  await make("Measure", "MK", "Strips", { shape: "SKIN" }, { quantity: 7 });
  const strips = num(await at("MK"));
  check("and it has more than one face, which is the whole difficulty", strips > 1,
        String(strips));

  // Four corners of ONE strip of it, each its own node, each a live UV sample.
  const grid = [[0, 0], [0.25, 0], [0.25, 1], [0, 1]];
  for (let i = 0; i < 4; i++) {
    const id = "UV" + i;
    await make("EvaluateSurface", id, id, { surface: "SKIN" },
               { u: grid[i][0], v: grid[i][1], normal: 0 });
    await mdl.run({ op: "pick", id, key: "face",
                    picks: [{ of: "SKIN", kind: "face", at: 0 }] });
  }
  const corners = [];
  let broke = "";
  for (const id of ["UV0", "UV1", "UV2", "UV3"]) {
    const f = await at(id);
    if (f.error) broke = id + ": " + f.error;
    corners.push(xyz(f));
  }
  check("four corners off the picked strip", !broke, broke);
  check("all four are different places",
        corners.every((a, i) => corners.every((b, j) => i === j || away(a, b) > 1)),
        corners.map(p => p.map(Math.round).join("/")).join("  "));

  await make("Polyline", "RIM", "Panel edge", { points: ["UV0", "UV1", "UV2", "UV3"] }, { closed: 1 });
  check("closed into a boundary", !(await at("RIM")).error, why(await at("RIM")));
  await mdl.run({ op: "add", type: "Fill", id: "PANEL", name: "Panel",
                  refs: { boundary: "RIM" } });
  const panel = await at("PANEL");
  check("and filled, whatever shape the skin is", !panel.error, why(panel));
  check("and on a doubly curved skin that is a patch, because those four corners are not coplanar",
        /patched/.test(panel.note || ""), why(panel));
  await make("ThickSurface", "SLAB", "Glass", { surface: "PANEL" }, { thickness: 12 });
  check("a panel you can give a thickness to", !(await at("SLAB")).error, why(await at("SLAB")));

  // And it is LIVE: change the skin and the panel follows, because every
  // corner is a sample rather than a number somebody wrote down.
  const before = xyz(await at("UV2"));
  await mdl.run({ op: "set", id: "C2", key: "radius", value: 30 });
  check("moving the skin moves the corners", away(before, xyz(await at("UV2"))) > 1,
        before.map(Math.round).join("/") + " -> " + xyz(await at("UV2")).map(Math.round).join("/"));
  check("with the panel still built", !(await at("PANEL")).error, why(await at("PANEL")));
  check("and the slab still built", !(await at("SLAB")).error, why(await at("SLAB")));
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
