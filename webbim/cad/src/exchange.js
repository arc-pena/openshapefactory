// File exchange: what this modeller can read and write, and the arithmetic of
// the formats it handles itself.
//
// Two kinds of format meet here and they are not the same kind of thing.
//
//   B-Rep formats - STEP, BREP - carry surfaces. OpenCascade reads and writes
//   them, so this file only says which they are; the kernel does the work.
//
//   Mesh formats - OBJ, STL - carry triangles and nothing else. They are
//   parsed and written here, in plain arithmetic, because a polymesh in this
//   program is a list of points and a list of faces and that is exactly what
//   these files hold. No kernel is involved and none is needed.
//
// One rule holds the import side together: whatever arrives, it is converted
// once, on the way in, to the one form the document stores - a B-Rep string
// for solids, OBJ text for meshes. So a feature rebuilds through one reader
// rather than through whichever reader happened to create it, and the model
// file says what it holds in a form a person can read.

//! What can come in and go out. Declared rather than described: the interface
//! builds its menus from this table, the assistant is told what is in it, and
//! a format that is not here cannot be half-supported by accident.
//!
//! `structure` marks a format that carries more than one part. It is the only
//! thing that decides whether the import dialog offers to break a file into
//! sub-components - which is the whole of the rule that everything else comes
//! in as a single object.
export const FORMATS = [
  { key: "step", name: "STEP", extensions: [".step", ".stp"], carries: "solid",
    short: "solids and surfaces, for any CAD system",
    read: true, write: true, structure: true,
    summary: "ISO-10303, the exchange format every CAD system reads. Surfaces and "
           + "solids, with the parts of an assembly kept apart." },
  { key: "brep", name: "BREP", extensions: [".brep", ".brp"], carries: "solid",
    short: "this modeller's own, exact",
    read: true, write: true, structure: false,
    summary: "This modeller's own shape format. Exact, fast to read back, and "
           + "understood by nothing else." },
  { key: "obj", name: "OBJ", extensions: [".obj"], carries: "mesh",
    short: "meshes, with their faces kept",
    read: true, write: true, structure: true,
    summary: "Wavefront OBJ. Polygons of any number of sides, grouped by name - "
           + "which is what makes it the mesh format worth keeping groups from." },
  { key: "stl", name: "STL", extensions: [".stl"], carries: "mesh",
    short: "triangles, for printing",
    read: true, write: true, structure: false,
    summary: "Triangles, in ASCII or binary. One shape per file, no names, no "
           + "colour: what a printer takes." },
  { key: "dxf", name: "DXF", extensions: [".dxf"], carries: "drawing",
    short: "2D drawings, as a sketch",
    read: true, write: true, structure: false, layers: true,
    summary: "AutoCAD's drawing interchange format. It comes in as a SKETCH - lines, "
           + "arcs, ellipses and splines on a plane, with the corners of every "
           + "polyline written down as coincidences - so an outline somebody drew "
           + "elsewhere can be constrained, dimensioned and extruded here. Sketches "
           + "go back out the same way, one layer each." },
  { key: "model", name: "Model file", extensions: [".json", ".mdl"], carries: "model",
    short: "the parametric model itself",
    read: true, write: true, structure: false,
    summary: "This program's own file: the parametric model itself, every feature "
           + "and every argument. Opening one replaces the document." },
];

//! Formats a CAD user will reasonably expect and this build cannot do. Named,
//! with the reason, because "nothing happened" is the worst possible answer to
//! a file someone chose on purpose.
export const UNAVAILABLE = [
  { extensions: [".iges", ".igs"], name: "IGES",
    reason: "the IGES reader is not compiled into this build. Re-export it "
          + "as STEP, which every system that writes IGES can also write." },
  { extensions: [".3dm"], name: "Rhino 3DM",
    reason: "reading it needs Rhino's own library, and this page may not fetch one. "
          + "Export from Rhino as STEP for solids, or OBJ for meshes." },
  { extensions: [".sat", ".sab"], name: "ACIS SAT",
    reason: "ACIS is a licensed format and this modeller cannot read it. Export as STEP." },
  { extensions: [".ifc"], name: "IFC",
    reason: "IFC is a building model, not a shape file; it needs a reader this build "
          + "does not have. Export the geometry as STEP." },
  { extensions: [".dwg"], name: "DWG",
    reason: "DWG is AutoCAD's own binary format and nothing outside AutoCAD reads it "
          + "reliably. Save it as DXF - AutoCAD, BricsCAD, Rhino and QCAD all do - "
          + "and it comes in as a sketch." },
];

const dotted = name => {
  const at = String(name || "").lastIndexOf(".");
  return at < 0 ? "" : String(name).slice(at).toLowerCase();
};

//! Which format a filename is, or null. Extension only: sniffing the content
//! of a file whose name says .step and whose insides say otherwise helps
//! nobody.
export function formatFor(filename) {
  const ext = dotted(filename);
  return FORMATS.find(f => f.extensions.includes(ext)) || null;
}

//! Why a file cannot be opened, when the answer is something better than "no".
export function whyNot(filename) {
  const ext = dotted(filename);
  return UNAVAILABLE.find(f => f.extensions.includes(ext)) || null;
}

//! Everything the file picker should accept, as the attribute wants it.
export const acceptList = () =>
  FORMATS.filter(f => f.read).flatMap(f => f.extensions).join(",");

//! What a file is, read from the file itself. Asked ONLY when the name has
//! said nothing this build reads - a .step that says STEP is taken at its
//! word, because a name and its contents disagreeing is a rare and confusing
//! thing to go second-guessing. A file dropped on the page is the case this
//! exists for: a drawing that came out of a mail client as "attachment.dat",
//! or a model somebody saved without an extension, is still the file they
//! meant, and every one of these formats says what it is in its first lines.
export function sniffFormat(bytes) {
  if (!bytes || !bytes.length) return null;
  // Binary STL says its own length: eighty bytes of header, a triangle count,
  // and fifty bytes per triangle, exactly.
  if (bytes.length >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (84 + view.getUint32(80, true) * 50 === bytes.length) return "stl";
  }
  // Everything else declares itself in its first few thousand characters.
  const head = utf8(bytes.slice(0, 4096));
  const start = head.replace(/^[\uFEFF\s]+/, "");
  if (/ISO-10303|FILE_SCHEMA/.test(head)) return "step";
  if (/CASCADE Topology V|DBRep_DrawableShape/.test(head)) return "brep";
  if (/^solid\b/.test(start) && /facet\s+normal/.test(head)) return "stl";
  // A DXF is group codes: a line holding a number, then a line holding what it
  // means. The first pair of every DXF ever written is 0 / SECTION.
  if (/^0\s*[\r\n]+\s*SECTION\b/.test(start)) return "dxf";
  if (start.startsWith("{") && /"format"\s*:\s*"ocaf-parametric-model"/.test(head))
    return "model";
  if (/^v\s+-?[\d.]/m.test(head) && /^(f|vn|vt|g|o|usemtl)\s/m.test(head)) return "obj";
  return null;
}

/* ==========================================================================
   Wavefront OBJ.

   The whole format, as far as geometry goes: v for a vertex, f for a face,
   o and g for a name. Texture and normal indices are read past - they say
   nothing about shape - and so is everything else in the file.
   ========================================================================== */

//! One OBJ file, as parts. Vertices are shared across the whole file, so each
//! part is given its own compacted copy of the ones its faces actually use -
//! which is what makes a part something that can stand on its own as a feature.
export function parseObj(text) {
  const points = [];
  const parts = [];
  let current = null;
  //! Faces before the first o/g belong to a part with no name of its own.
  const part = () => {
    if (!current) { current = { name: "", faces: [] }; parts.push(current); }
    return current;
  };

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const space = line.indexOf(" ");
    if (space < 0) continue;
    const word = line.slice(0, space);
    const rest = line.slice(space + 1).trim();

    if (word === "v") {
      const n = rest.split(/\s+/);
      points.push([Number(n[0]) || 0, Number(n[1]) || 0, Number(n[2]) || 0]);
    } else if (word === "f") {
      const face = [];
      for (const vertex of rest.split(/\s+/)) {
        if (!vertex) continue;
        // v, v/vt, v//vn and v/vt/vn all start with the vertex index.
        const index = parseInt(vertex, 10);
        if (!Number.isFinite(index) || index === 0) continue;
        // A negative index counts back from the vertices seen so far, which is
        // what lets an OBJ be concatenated from parts.
        face.push(index > 0 ? index - 1 : points.length + index);
      }
      if (face.length >= 3) part().faces.push(face);
    } else if (word === "o" || word === "g") {
      current = { name: rest, faces: [] };
      parts.push(current);
    }
  }

  // A part is only a part if it has faces. An OBJ that names a group and then
  // puts nothing in it is common and means nothing.
  return parts.filter(p => p.faces.length).map(p => compactPart(p, points));
}

//! One part's faces, with only the vertices they use and the indices moved to
//! match. A file of forty groups sharing one vertex pool becomes forty meshes
//! that each stand alone.
function compactPart(part, points) {
  const moved = new Map();
  const kept = [];
  const faces = part.faces.map(face => face.map(index => {
    if (!moved.has(index)) {
      moved.set(index, kept.length);
      const p = points[index];
      kept.push(p ? p.slice() : [0, 0, 0]);
    }
    return moved.get(index);
  }));
  return { name: part.name, points: kept, faces };
}

//! Parts out as OBJ. One `g` per part, so what goes out in groups comes back
//! in groups - the round trip a mesh format is worth having at all.
export function writeObj(parts, note = "") {
  const out = [];
  if (note) out.push("# " + note);
  let base = 1;
  for (const part of parts) {
    out.push("g " + (part.name || "part"));
    for (const p of part.points)
      out.push("v " + num(p[0]) + " " + num(p[1]) + " " + num(p[2]));
    for (const face of part.faces)
      out.push("f " + face.map(i => i + base).join(" "));
    base += part.points.length;
  }
  out.push("");
  return out.join("\n");
}

//! Six figures is a micron on a building and a nanometre on a bracket, and it
//! keeps a file of a hundred thousand vertices readable.
const num = v => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
};

/* ==========================================================================
   STL.

   Triangles with no shared vertices, in two encodings of the same thing. Both
   are read; ASCII is written, because it is text and everything downstream of
   here - the save dialog, the copy box, the model file - is text.
   ========================================================================== */

//! ASCII or binary? The header is not proof: a binary file may begin with the
//! word "solid" as well. The size is proof - a binary STL is exactly 84 bytes
//! plus 50 per triangle - so that is what decides, and the header only speaks
//! when the size is inconclusive.
export function isBinaryStl(bytes) {
  if (!bytes || bytes.length < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  if (84 + triangles * 50 === bytes.length) return true;
  const head = String.fromCharCode(...bytes.slice(0, 5)).toLowerCase();
  return head !== "solid";
}

//! Triangles from either encoding. Vertices come back exactly as the file has
//! them - three per triangle, none shared - because welding them is a decision
//! about tolerance and belongs to whoever knows the size of the thing.
export function parseStl(input) {
  if (typeof input === "string") return asciiStl(input);
  return isBinaryStl(input) ? binaryStl(input) : asciiStl(utf8(input));
}

function binaryStl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const points = [], faces = [];
  for (let t = 0; t < count; t++) {
    const at = 84 + t * 50;
    if (at + 50 > bytes.length) break;          // truncated file: keep what is whole
    const face = [];
    for (let v = 0; v < 3; v++) {
      const p = at + 12 + v * 12;               // past the normal
      face.push(points.length);
      points.push([view.getFloat32(p, true), view.getFloat32(p + 4, true),
                   view.getFloat32(p + 8, true)]);
    }
    faces.push(face);
  }
  return { points, faces };
}

function asciiStl(text) {
  const points = [], faces = [];
  let face = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("vertex")) {
      const n = line.split(/\s+/);
      face.push(points.length);
      points.push([Number(n[1]) || 0, Number(n[2]) || 0, Number(n[3]) || 0]);
    } else if (line.startsWith("endloop")) {
      // A loop of more than three is not STL, but reading it as a fan costs
      // nothing and saves a file somebody's exporter got wrong.
      for (let i = 2; i < face.length; i++) faces.push([face[0], face[i - 1], face[i]]);
      face = [];
    } else if (line.startsWith("outer loop")) face = [];
  }
  return { points, faces };
}

//! Parts out as one ASCII STL. Faces of more than three sides are fanned into
//! triangles, because STL has nothing else.
export function writeStl(parts, name = "part") {
  const out = ["solid " + name];
  for (const part of parts)
    for (const face of part.faces)
      for (let i = 2; i < face.length; i++) {
        const a = part.points[face[0]], b = part.points[face[i - 1]], c = part.points[face[i]];
        if (!a || !b || !c) continue;
        const n = normalOf(a, b, c);
        out.push("  facet normal " + num(n[0]) + " " + num(n[1]) + " " + num(n[2]));
        out.push("    outer loop");
        for (const p of [a, b, c])
          out.push("      vertex " + num(p[0]) + " " + num(p[1]) + " " + num(p[2]));
        out.push("    endloop");
        out.push("  endfacet");
      }
  out.push("endsolid " + name, "");
  return out.join("\n");
}

function normalOf(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  return len > 1e-12 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 0, 0];
}

/* ==========================================================================
   STEP, read as text.

   Not a parser. OpenCascade transfers the geometry; what it will not hand back
   through these bindings is the name anybody gave the part, and the file says
   it in plain sight. So the names are read here and used only when there are
   exactly as many of them as there are parts - which is the only case where
   matching them up by position is a fact rather than a guess.
   ========================================================================== */

//! Every PRODUCT name in the file, in file order. A STEP entity may wrap over
//! several lines, so the newlines go before the match is tried.
export function productNames(text) {
  const flat = String(text).replace(/[\r\n]+/g, "");
  return [...flat.matchAll(/PRODUCT\s*\(\s*'((?:[^']|'')*)'/g)]
    .map(m => m[1].replace(/''/g, "'").trim())
    .filter(Boolean);
}

//! A name somebody gave the part, as opposed to one a translator made up on
//! the way out. OpenCascade's own writer numbers its products after itself, and
//! "Open CASCADE STEP translator 8.0 2" is not what to call a feature - a part
//! numbered by this program reads better than one numbered by that one.
const ANONYMOUS = /^(Open CASCADE STEP translator|Unknown|NONE|Product|Part)\b[\s\d.]*$/i;
export const realNames = text => {
  const names = productNames(text);
  return names.some(name => ANONYMOUS.test(name)) ? [] : names;
};

//! Does this file describe an assembly, in its own terms? A STEP assembly says
//! so with NEXT_ASSEMBLY_USAGE_OCCURRENCE, one per part in a parent.
export const isAssembly = text => /NEXT_ASSEMBLY_USAGE_OCCURRENCE/.test(String(text));

/* -------------------------------------------------------------- encodings */

//! Bytes as text, without assuming the platform has TextDecoder to hand.
export function utf8(bytes) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

//! Base64 to bytes and back, in chunks small enough not to blow the argument
//! limit on a file of a few megabytes.
export function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return typeof btoa === "function" ? btoa(binary)
    : Buffer.from(bytes).toString("base64");
}

export function fromBase64(text) {
  if (typeof atob === "function") {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(text, "base64"));
}

/* ------------------------------------------- geometry, packed for the file

   WHAT COSTS MEMORY IS NOT THE KERNEL. Measured on this build: 320 MB written
   into the kernel's own filesystem while its heap sat at 100 MB, so OpenCascade
   will happily read a file far larger than anything this program used to
   accept. What could not take it was the PAGE - the whole file read into one
   JavaScript string, base64'd a third bigger again, written into the document,
   and then copied into every step of the undo stack behind it.

   So the geometry is packed. BREP is ASCII and repetitive and gzips 7.8 times
   on measurement, which turns a 184.6 MB import into about 24 MB stored - and
   the document goes on standing on its own, which is the whole reason it is
   kept in there rather than beside it.                                      */

//! The mark a packed blob carries. Self-describing rather than a flag beside
//! it: a blob that says what it is cannot be read as the wrong thing, and a
//! file written before any of this existed has no mark and is plain BREP,
//! which is exactly what the reader should do with it.
export const PACKED_MARK = "GZ1:";

export const isPacked = text => typeof text === "string" && text.startsWith(PACKED_MARK);

//! Text in, packed base64 out. Left ALONE when packing would not pay: below a
//! few kilobytes the base64 of a gzip is bigger than the text was, and a small
//! import staying readable in the model file is worth more than the bytes.
export const PACK_FROM = 64 * 1024;

export async function packGeometry(text) {
  if (typeof text !== "string" || text.length < PACK_FROM) return text;
  if (typeof CompressionStream !== "function") return text;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  const out = PACKED_MARK + toBase64(packed);
  //! And only if it actually helped. A blob that has already been compressed
  //! by whatever wrote it comes out bigger, and keeping the bigger one would
  //! be paying for the idea rather than for the result.
  return out.length < text.length ? out : text;
}

export async function unpackGeometry(text) {
  if (!isPacked(text)) return text;
  if (typeof DecompressionStream !== "function")
    throw new Error("this geometry is packed and this browser cannot unpack it "
      + "(no DecompressionStream)");
  const bytes = fromBase64(text.slice(PACKED_MARK.length));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

//! What a file is read in, going into the kernel. Big enough that a 200 MB
//! import is twenty-five messages rather than twenty-five thousand, small
//! enough that no single copy of it is a problem on a phone.
//!
//! THERE IS NO CEILING ABOVE THIS, and that is deliberate. A file does not
//! arrive in the page as one string any more; it is read a slice at a time,
//! written into the kernel's filesystem a slice at a time, read out of there
//! by the reader that wants it, and stored packed. Nothing along that road
//! scales with the size of the file except the file itself, so there is no
//! honest number to refuse at.
export const IMPORT_CHUNK = 8 * 1024 * 1024;

//! How much of a file is enough to say what it is. The magic words of every
//! format here are in the first few lines of it.
export const SNIFF_BYTES = 64 * 1024;

/* ================================================== counting through a file

   The import dialog asks one question - is this one thing, or several? - and
   answering it used to mean having the whole file as a string, which is the
   very thing streaming exists to avoid. So it is counted through a window
   instead: a few megabytes at a time, out of wherever the file already is,
   with nothing bigger than a window ever held.

   `read(at, length)` is whatever can hand back that many CHARACTERS from that
   byte offset. One byte must be one character - latin1, not UTF-8 - or a
   multi-byte character split across a window boundary comes back as two
   broken ones. Everything counted here is ASCII, so latin1 reads it exactly
   and reads it boundary-proof.                                             */

export const SCAN_SLICE = 4 * 1024 * 1024;

//! A file as lines, a window at a time. The part after the last newline is
//! carried into the next window rather than counted, because it is half a
//! line - that carry is the whole of what makes this equal to splitting the
//! whole text at once.
export function scanLines(read, size, onLine, slice = SCAN_SLICE) {
  let tail = "";
  for (let at = 0; at < size; at += slice) {
    const chunk = read(at, Math.min(slice, size - at));
    if (!chunk) break;
    const lines = (tail + chunk).split(/\r?\n/);
    tail = lines.pop();
    for (const line of lines) onLine(line);
  }
  if (tail) onLine(tail);
}

//! How many parts an OBJ has, counted the way parseObj counts them: a group
//! is a part only once something is drawn in it, and faces before the first
//! group are a part of their own. A file that names forty layers and fills
//! three of them has three parts, and saying forty would offer to break it
//! into thirty-seven empty ones.
export function countObjParts(read, size, slice = SCAN_SLICE) {
  let parts = 0;
  let named = false;          // a group has been opened and has nothing in it yet
  let loose = false;          // faces arrived before any group did
  scanLines(read, size, raw => {
    const line = raw.trim();
    if (!line || line[0] === "#") return;
    const space = line.indexOf(" ");
    if (space < 0) return;
    const word = line.slice(0, space);
    if (word === "o" || word === "g") { named = true; return; }
    if (word !== "f") return;
    if (line.slice(space + 1).trim().split(/\s+/).filter(Boolean).length < 3) return;
    if (named) { parts++; named = false; }
    else if (!loose && parts === 0) { parts++; loose = true; }
  }, slice);
  return parts;
}

//! What a STEP file says about itself: how many products, and whether it calls
//! itself an assembly. Both are what productNames and isAssembly find in the
//! whole text - found here through the window instead.
//!
//! A STEP entity wraps over lines, so the newlines go before the match is
//! tried, exactly as productNames does it. The window is read with a tail
//! after it so an entity straddling the join is still whole; only matches that
//! START inside the window proper are counted, which is what keeps the ones in
//! the tail from being counted twice when the next window reaches them.
export const SCAN_OVERLAP = 8 * 1024;

export function scanStep(read, size, slice = SCAN_SLICE, overlap = SCAN_OVERLAP) {
  const flatten = text => String(text).replace(/[\r\n]+/g, "");
  let products = 0;
  let assembly = false;
  for (let at = 0; at < size; at += slice) {
    const head = flatten(read(at, Math.min(slice, size - at)));
    const over = at + slice < size
      ? flatten(read(at + slice, Math.min(overlap, size - at - slice))) : "";
    const window = head + over;
    for (const found of window.matchAll(/PRODUCT\s*\(\s*'(?:[^']|'')*'/g))
      if (found.index < head.length) products++;
    if (!assembly) {
      const where = window.indexOf("NEXT_ASSEMBLY_USAGE_OCCURRENCE");
      if (where >= 0 && where < head.length) assembly = true;
    }
  }
  return { products, assembly };
}

//! Bytes as characters, one for one. Not text - a decoding - but the only
//! reading of a byte range that is the same whether or not it lands on a
//! character boundary, which is what a window needs.
export function latin1(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  return out;
}

export const readable = bytes =>
  bytes < 1024 ? bytes + " B"
  : bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + " kB"
  : (bytes / 1024 / 1024).toFixed(1) + " MB";
