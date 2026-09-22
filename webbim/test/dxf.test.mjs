// DXF writer/reader/zip (spec §12). Expected values are derived by hand in the
// comments before the call is made — the program is never asked what it expects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DXF_LWEIGHTS, dxfLineweight, writeDXF, readDXF, makeZip, zipCrc32 } from "../src/dxf.js";

const L = (a, b) => ({ k: "L", a, b });
const square = (x, y, s) => [L([x, y], [x + s, y]), L([x + s, y], [x + s, y + s]), L([x + s, y + s], [x, y + s]), L([x, y + s], [x, y])];
const pairsOf = text => { const ls = text.split(/\r?\n/); const out = []; for (let i = 0; i + 1 < ls.length; i += 2) out.push([parseInt(ls[i], 10), ls[i + 1].trim()]); return out; };
const headerVar = (pairs, name) => { const i = pairs.findIndex(p => p[0] === 9 && p[1] === name); return i < 0 ? null : pairs[i + 1]; };
/** All entity records in the ENTITIES section as [{type, g:[[code,val]]}]. */
const entitiesOf = text => {
  const p = pairsOf(text); const s = p.findIndex((x, i) => x[0] === 2 && x[1] === "ENTITIES" && p[i - 1][1] === "SECTION");
  const out = [];
  for (let i = s + 1; i < p.length && !(p[i][0] === 0 && p[i][1] === "ENDSEC"); i++) {
    if (p[i][0] === 0) out.push({ type: p[i][1], g: [] }); else out[out.length - 1].g.push(p[i]);
  }
  return out;
};
const val = (e, c) => { const x = e.g.find(q => q[0] === c); return x && x[1]; };
const seg = (...parts) => parts.flat().join("\n") + "\n";
const ents = (...bodies) => seg("0", "SECTION", "2", "ENTITIES", ...bodies, "0", "ENDSEC", "0", "EOF");
const hdr = code => seg("0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", String(code), "0", "ENDSEC");
const line = (x0, y0, x1, y1, layer = "0") => ["0", "LINE", "8", layer, "10", x0, "20", y0, "30", "0", "11", x1, "21", y1, "31", "0"].map(String);
const lengthOf = s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
const arcPt = (s, t) => [s.c[0] + s.r * Math.cos(s.a0 + (s.a1 - s.a0) * t), s.c[1] + s.r * Math.sin(s.a0 + (s.a1 - s.a0) * t)];
const close = (a, b, tol = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

test("10 mm square at 1.0 mm: header, 370 = 100, round-trip 10.000 wide", () => {
  const { text, report } = writeDXF({ size: [100, 100], prims: [{ t: "stroke", path: square(0, 0, 10), weight: 1.0, colour: "#000000", dash: null, layer: "A-WALL" }] });
  const p = pairsOf(text);
  assert.deepEqual(headerVar(p, "$INSUNITS"), [70, "4"]);
  assert.deepEqual(headerVar(p, "$LWDISPLAY"), [290, "1"]);
  assert.deepEqual(headerVar(p, "$ACADVER"), [1, "AC1015"]);
  assert.deepEqual(headerVar(p, "$MEASUREMENT"), [70, "1"]);
  assert.ok(headerVar(p, "$HANDSEED"));
  const e = entitiesOf(text);
  assert.equal(e.length, 1);                      // one closed LWPOLYLINE for the four lines
  assert.equal(e[0].type, "LWPOLYLINE");
  assert.equal(val(e[0], 370), "100");            // 1.0 mm × 100
  assert.equal(val(e[0], 70), "1");               // closed
  assert.equal(val(e[0], 8), "A-WALL");
  assert.deepEqual(report, []);                   // 1.00 is a legal rung
  // every handle unique
  const handles = p.filter(q => q[0] === 5 || q[0] === 105).map(q => q[1]);
  assert.equal(new Set(handles).size, handles.length);
  const r = readDXF(text);
  assert.equal(r.needsUnits, false);
  assert.equal(r.units, "mm");
  assert.equal(r.paths.length, 1);
  assert.equal(r.paths[0].layer, "A-WALL");
  assert.ok(Math.abs(r.bbox[2] - r.bbox[0] - 10) <= 0.001, `width ${r.bbox[2] - r.bbox[0]}`);
  assert.ok(Math.abs(r.bbox[3] - r.bbox[1] - 10) <= 0.001);
  assert.equal(r.paths[0].path.length, 4);
});

test("lineweight snapping to the DXF ladder", () => {
  assert.equal(DXF_LWEIGHTS.length, 24);
  // 42 lies between 40 and 50; |42−40| = 2 < 8 → 40, substituted
  assert.deepEqual(dxfLineweight(0.42), { code: 40, substituted: true, from: 0.42, to: 0.40 });
  assert.deepEqual(dxfLineweight(0.5), { code: 50, substituted: false, from: 0.5, to: 0.5 });
  assert.equal(dxfLineweight(0.18).code, 18); assert.equal(dxfLineweight(0.18).substituted, false);   // 0.18*100 = 18.000000000000004
  assert.equal(dxfLineweight(0.13).code, 13); assert.equal(dxfLineweight(0.13).substituted, false);
  assert.equal(dxfLineweight(0.05).code, 5); assert.equal(dxfLineweight(0.05).substituted, false);
  assert.equal(dxfLineweight(3).code, 211);       // off the top of the ladder
  const { text, report } = writeDXF({ size: [10, 10], prims: [
    { t: "stroke", path: [L([0, 0], [5, 0])], weight: 0.42, colour: "#000000", layer: "0" },
    { t: "stroke", path: [L([0, 1], [5, 1])], weight: 0.42, colour: "#000000", layer: "0" }] });
  assert.deepEqual(report, ["0.42 mm → 0.40 mm (DXF has no 0.42)"]);   // reported once, not per entity
  assert.deepEqual(entitiesOf(text).map(e => val(e, 370)), ["40", "40"]);
});

test("3000 mm line in model space round-trips to 3000 units", () => {
  const { text } = writeDXF({ size: [4000, 1000], prims: [{ t: "stroke", path: [L([0, 0], [3000, 0])], weight: 0.25, colour: "#112233", layer: "0" }] }, { space: "model" });
  const e = entitiesOf(text);
  assert.equal(e[0].type, "LINE");
  assert.equal(val(e[0], 11), "3000");
  assert.equal(val(e[0], 420), String(0x112233));   // 1122867
  const r = readDXF(text);
  assert.equal(lengthOf(r.paths[0].path[0]), 3000);
  // written in metres: file holds 3, $INSUNITS 6; reading scales once → 3000 mm again
  const m = writeDXF({ size: [4000, 1000], prims: [{ t: "stroke", path: [L([0, 0], [3000, 0])], weight: 0.25, colour: "#000", layer: "0" }] }, { units: "m" });
  assert.deepEqual(headerVar(pairsOf(m.text), "$INSUNITS"), [70, "6"]);
  assert.equal(val(entitiesOf(m.text)[0], 11), "3");
  assert.equal(lengthOf(readDXF(m.text).paths[0].path[0]), 3000);
});

test("$INSUNITS 1: a 10-inch line reads as 254 mm (scaled once)", () => {
  const r = readDXF(hdr(1) + ents(line(0, 0, 10, 0)));
  assert.equal(r.units, "in"); assert.equal(r.insunits, 1); assert.equal(r.needsUnits, false);
  assert.ok(Math.abs(lengthOf(r.paths[0].path[0]) - 254) < 1e-9);   // 10 × 25.4
  assert.deepEqual(r.bbox, [0, 0, 254, 0]);
});

test("no $INSUNITS: needsUnits, no scaling; askUnits 'cm' → ×10", () => {
  const dxf = ents(line(0, 0, 10, 0));
  const r = readDXF(dxf);
  assert.equal(r.needsUnits, true); assert.equal(r.units, null);
  assert.equal(lengthOf(r.paths[0].path[0]), 10);
  let asked = null;
  const r2 = readDXF(dxf, { askUnits: info => { asked = info; return "cm"; } });
  assert.equal(r2.needsUnits, false); assert.equal(r2.units, "cm");
  assert.equal(lengthOf(r2.paths[0].path[0]), 100);
  assert.deepEqual(asked.bbox, [0, 0, 10, 0]);   // asked with the unscaled extents
  // $INSUNITS 0 ("unitless") is treated the same as absent
  assert.equal(readDXF(hdr(0) + dxf).needsUnits, true);
});

test("arcs: CCW exact, clockwise same point set", () => {
  const ccw = { k: "A", c: [0, 0], r: 100, a0: 0, a1: Math.PI / 2 };
  const t1 = writeDXF({ size: [200, 200], prims: [{ t: "stroke", path: [ccw], weight: 0.35, colour: "#000", layer: "0" }] }).text;
  const e = entitiesOf(t1)[0];
  assert.equal(e.type, "ARC"); assert.equal(val(e, 50), "0"); assert.equal(val(e, 51), "90");
  const a = readDXF(t1).paths[0].path[0];
  assert.equal(a.k, "A"); assert.deepEqual(a.c, [0, 0]); assert.equal(a.r, 100);
  assert.ok(Math.abs(a.a0) < 1e-12 && Math.abs(a.a1 - Math.PI / 2) < 1e-12);

  const cw = { k: "A", c: [0, 0], r: 100, a0: Math.PI / 2, a1: 0 };
  const t2 = writeDXF({ size: [200, 200], prims: [{ t: "stroke", path: [cw], weight: 0.35, colour: "#000", layer: "0" }] }).text;
  const b = readDXF(t2).paths[0].path[0];
  // endpoints {(100,0),(0,100)} as a set and, discriminating minor from major arc, the midpoint (70.71, 70.71)
  const ends = [arcPt(b, 0), arcPt(b, 1)];
  assert.ok(ends.some(p => close(p, [100, 0], 1e-9)) && ends.some(p => close(p, [0, 100], 1e-9)));
  assert.ok(close(arcPt(b, 0.5), [100 * Math.SQRT1_2, 100 * Math.SQRT1_2], 1e-9));
  assert.ok(Math.abs(Math.abs(b.a1 - b.a0) - Math.PI / 2) < 1e-12);
});

test("Bézier → SPLINE → Bézier keeps its control points; fills → HATCH SOLID → fill", () => {
  const c = { k: "C", a: [0, 0], c1: [10, 20], c2: [30, 20], b: [40, 0] };
  const { text } = writeDXF({ size: [50, 50], prims: [
    { t: "stroke", path: [c], weight: 0.5, colour: "#000", layer: "S" },
    { t: "fill", path: square(0, 0, 20).concat(square(5, 5, 10)), colour: "#808080", layer: "F" }] });
  const es = entitiesOf(text);
  assert.deepEqual(es.map(e => e.type), ["SPLINE", "HATCH"]);
  assert.equal(val(es[1], 2), "SOLID"); assert.equal(val(es[1], 91), "2");
  const r = readDXF(text);
  const b = r.paths[0].path[0];
  for (const [p, q] of [[b.a, c.a], [b.c1, c.c1], [b.c2, c.c2], [b.b, c.b]]) assert.ok(close(p, q, 1e-9), `${p} vs ${q}`);
  assert.equal(r.fills.length, 1); assert.equal(r.fills[0].layer, "F");
  assert.equal(r.fills[0].path.length, 8);        // two 4-edge loops
  // curve bbox: y max at t=½ is 0.75·20 = 15
  assert.ok(Math.abs(r.bbox[3] - 20) < 1e-9);     // the fill reaches 20; spline peak 15 lies inside
});

test("text → MTEXT (height, rotation, attachment) → text", () => {
  const { text } = writeDXF({ size: [50, 50], prims: [{ t: "text", at: [5, 6], text: "Room {1}\nKitchen", height: 3.5, rot: 30, align: "centre", colour: "#000", layer: "T" }] });
  const e = entitiesOf(text)[0];
  assert.equal(e.type, "MTEXT"); assert.equal(val(e, 1), "Room \\{1\\}\\PKitchen");
  assert.equal(val(e, 40), "3.5"); assert.equal(val(e, 50), "30"); assert.equal(val(e, 71), "8");
  const t = readDXF(text).texts[0];
  assert.equal(t.text, "Room {1}\nKitchen"); assert.deepEqual(t.at, [5, 6]);
  assert.ok(Math.abs(t.height - 3.5) < 1e-12 && Math.abs(t.rot - 30) < 1e-9);
});

test("dashes → LTYPE; unreadable hatch pattern → ANSI31 with a report line", () => {
  const { text, report } = writeDXF({ size: [50, 50], prims: [
    { t: "stroke", path: [L([0, 0], [10, 0])], weight: 0.25, colour: "#000", dash: [3, 1.5], layer: "0" },
    { t: "hatch", path: square(0, 0, 10), pattern: { id: "weird", lines: ["?"] }, colour: "#000", weight: 0.18, layer: "H" }] });
  assert.ok(text.includes("DASH_3_1p5"));
  assert.equal(val(entitiesOf(text)[0], 6), "DASH_3_1p5");
  assert.equal(val(entitiesOf(text)[1], 2), "ANSI31");
  assert.ok(report.some(l => /substituted ANSI31/.test(l)));
});

test("INSERT of a 100×100 block at [50,50] scale 3 → bbox [50,50,350,350]; skipped entities in message", () => {
  const blocks = seg("0", "SECTION", "2", "BLOCKS",
    "0", "BLOCK", "8", "0", "2", "SQ", "70", "0", "10", "0", "20", "0", "30", "0",
    "0", "LWPOLYLINE", "8", "0", "90", "4", "70", "1", "10", "0", "20", "0", "10", "100", "20", "0", "10", "100", "20", "100", "10", "0", "20", "100",
    "0", "ENDBLK", "8", "0",
    "0", "ENDSEC");
  const dxf = hdr(4) + blocks + ents(
    ["0", "INSERT", "8", "FURN", "2", "SQ", "10", "50", "20", "50", "30", "0", "41", "3", "42", "3", "43", "3", "50", "0"],
    line(100, 100, 200, 200),
    ["0", "REGION", "8", "0"], ["0", "3DFACE", "8", "0"], ["0", "REGION", "8", "0"]);
  const r = readDXF(dxf);
  // block 0..100 × 3 = 0..300, + 50 → 50..350; the extra line (100..200) lies inside
  assert.deepEqual(r.bbox, [50, 50, 350, 350]);
  assert.equal(r.paths[0].layer, "FURN");           // layer-0 block content takes the INSERT's layer
  assert.deepEqual(r.manifest, { imported: 2, skipped: { REGION: 2, "3DFACE": 1 } });
  assert.equal(r.message, "imported 2 entities, skipped 3 (2 × REGION, 1 × 3DFACE)");
});

test("nested INSERT with rotation, LWPOLYLINE bulge, CIRCLE and mirrored OCS", () => {
  // Block IN: unit square 0..10. Block OUT: INSERT IN at (0,0) rot 90 → square x∈[-10,0], y∈[0,10].
  // Model: INSERT OUT at (100,0) scale 2 → x∈[80,100], y∈[0,20].
  const blocks = seg("0", "SECTION", "2", "BLOCKS",
    "0", "BLOCK", "2", "IN", "10", "0", "20", "0",
    "0", "LWPOLYLINE", "90", "4", "70", "1", "10", "0", "20", "0", "10", "10", "20", "0", "10", "10", "20", "10", "10", "0", "20", "10",
    "0", "ENDBLK",
    "0", "BLOCK", "2", "OUT", "10", "0", "20", "0",
    "0", "INSERT", "2", "IN", "10", "0", "20", "0", "50", "90",
    "0", "ENDBLK", "0", "ENDSEC");
  const r = readDXF(hdr(4) + blocks + ents(["0", "INSERT", "2", "OUT", "10", "100", "20", "0", "41", "2", "42", "2"]));
  r.bbox.forEach((v, i) => assert.ok(Math.abs(v - [80, 0, 100, 20][i]) < 1e-9, `bbox ${r.bbox}`));
  // bulge 1 = semicircle from (0,0) to (10,0), CCW → centre (5,0), dips to y = −5
  const b = readDXF(hdr(4) + ents(["0", "LWPOLYLINE", "90", "2", "70", "0", "10", "0", "20", "0", "42", "1", "10", "10", "20", "0"]));
  assert.ok(close(b.paths[0].path[0].c, [5, 0], 1e-12)); assert.ok(Math.abs(b.bbox[1] + 5) < 1e-9);
  // circle with extrusion (0,0,−1) centred at OCS (10,0) lies at world (−10,0)
  const c = readDXF(hdr(4) + ents(["0", "CIRCLE", "10", "10", "20", "0", "40", "1", "210", "0", "220", "0", "230", "-1"]));
  assert.ok(close(c.paths[0].path[0].c, [-10, 0], 1e-12));
});

test("makeZip: CRC32, local header, EOCD entry count", () => {
  assert.equal(zipCrc32("hello"), 0x3610a686);
  const z = makeZip([{ name: "a.dxf", data: "hello" }, { name: "b.txt", data: new Uint8Array([1, 2, 3]) }]);
  assert.deepEqual([...z.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(dv.getUint16(8, true), 0);            // STORE
  assert.equal(dv.getUint32(14, true), 0x3610a686);  // CRC in the first local header
  assert.equal(dv.getUint32(18, true), 5); assert.equal(dv.getUint32(22, true), 5);
  assert.equal(new TextDecoder().decode(z.slice(30, 35)), "a.dxf");
  assert.equal(new TextDecoder().decode(z.slice(35, 40)), "hello");
  const e = z.length - 22;
  assert.equal(dv.getUint32(e, true), 0x06054b50);
  assert.equal(dv.getUint16(e + 8, true), 2); assert.equal(dv.getUint16(e + 10, true), 2);
  const cdOff = dv.getUint32(e + 16, true), cdSize = dv.getUint32(e + 12, true);
  assert.equal(cdOff + cdSize, e);
  assert.equal(dv.getUint32(cdOff, true), 0x02014b50);
});
