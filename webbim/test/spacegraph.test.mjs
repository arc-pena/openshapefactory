// The .xlsx reader against a workbook built here byte by byte: a zip with one deflated part (the
// sheet, through the platform's CompressionStream) and the rest stored, a title row above the
// header, shared and inline strings, and an adjacency matrix on a second sheet.
import test from "node:test";
import assert from "node:assert/strict";
import { readXlsx, programFromWorkbook } from "../src/spacegraph.js";

const enc = new TextEncoder();
async function deflate(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()); }
async function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, text, compress] of files) {
    const raw = enc.encode(text), data = compress ? await deflate(raw) : raw, nm = enc.encode(name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, compress ? 8 : 0, true); lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, compress ? 8 : 0, true); ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; for (const b of all) { out.set(b, p); p += b.length; }
  return out.buffer;
}
const cell = (ref, v) => typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v.replace(/&/g, "&amp;")}</t></is></c>`;
const sheet = rows => `<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => v === "" ? "" : cell(String.fromCharCode(65 + j) + (i + 1), v)).join("")}</row>`).join("")}</sheetData></worksheet>`;

test("an .xlsx program: title row skipped, Qty expanded, shared strings, a matrix sheet read as adjacencies", async () => {
  const shared = ["Room name", "Area (m2)", "Qty", "Department", "Daylight", "Adjacent to"];
  const s1 = `<worksheet><sheetData><row r="1">${cell("A1", "Clinic - issue 2")}</row><row r="3">${shared.map((_, j) => `<c r="${String.fromCharCode(65 + j)}3" t="s"><v>${j}</v></c>`).join("")}</row>`
    + [["Reception", 25, 1, "Front", "Y", "Waiting*"], ["Waiting", 60, 1, "Front", "Y", ""], ["Consult room", 16, 3, "Clinical", "Y", "Waiting"], ["Plant & store", 20, 1, "Services", "N", ""], ["Total", 181, "", "", "", ""]]
      .map((r, i) => `<row r="${i + 4}">${r.map((v, j) => v === "" ? "" : cell(String.fromCharCode(65 + j) + (i + 4), v)).join("")}</row>`).join("") + `</sheetData></worksheet>`;
  const s2 = sheet([["", "Reception", "Waiting", "Plant & store"], ["Reception", "", 3, ""], ["Waiting", 3, "", "avoid"], ["Plant & store", "", "avoid", ""]]);
  const buf = await zip([
    ["xl/workbook.xml", `<workbook><sheets><sheet name="Schedule" sheetId="1" r:id="rId1"/><sheet name="Adjacency" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`],
    ["xl/sharedStrings.xml", `<sst>${shared.map(t => `<si><t>${t}</t></si>`).join("")}</sst>`],
    ["xl/worksheets/sheet1.xml", s1, true], ["xl/worksheets/sheet2.xml", s2],
  ]);
  const wb = await readXlsx(buf);
  assert.deepEqual(wb.sheets.map(s => s.name), ["Schedule", "Adjacency"]);
  const p = programFromWorkbook(wb), names = p.nodes.map(n => n.name);
  assert.deepEqual(names, ["Reception", "Waiting", "Consult room 1", "Consult room 2", "Consult room 3", "Plant & store"], "rows read, Total skipped, Qty expanded");
  const id = n => p.nodes.find(x => x.name === n).id, w = (a, b) => (p.edges.find(e => (e.a === id(a) && e.b === id(b)) || (e.a === id(b) && e.b === id(a))) || {}).w;
  assert.equal(w("Reception", "Waiting"), 3, "strong from the column (and the matrix)");
  assert.equal(w("Waiting", "Plant & store"), -1, "keep apart from the matrix");
  assert.equal(p.nodes.find(n => n.name === "Plant & store").facade, false);
  assert.equal(p.nodes.find(n => n.name === "Consult room 2").area, 16);
});
