//! The PDF backend for the 2D scene (§12). One factor, one place: each page's
//! content stream starts with `2.834645669 0 0 2.834645669 0 0 cm` and is then
//! authored entirely in millimetres, so `0.5 w` is 0.5mm of ink. The view scale
//! was consumed when the scene was built; this writer never learns it, and so
//! can never scale a stroke. Nothing is clamped. `pen: none` never reaches here
//! as a stroke — fills are `f*` only, never `B`.

import { FONT_WIDTHS, FONT_METRICS, FONT_TTF_B64, FONT_NAME } from "./fontdata.js";
import { segStart, segEnd, TAU } from "./geom2d.js";
import { emOf, textWidth } from "./scene.js";

export const PT_PER_MM = 72 / 25.4;
const K = "2.834645669";
const n3 = x => { const s = (Math.round(x * 1000) / 1000).toFixed(3); return s === "-0.000" ? "0.000" : s; };
const n4 = x => { const r = Math.round(x * 10000) / 10000; return Number.isInteger(r) ? String(r) : r.toFixed(4).replace(/0+$/, ""); };
const rgb = hex => { const h = hex.replace("#", ""); const f = h.length === 3 ? h.split("").map(c => c + c).join("") : h; return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255); };
const col = (hex, op) => rgb(hex || "#000000").map(v => n4(v)).join(" ") + " " + op;

/** pages: [{ size:[w,h] (mm), prims, links, title }]; meta: {title, project, revision, issuedBy, issueDate}. */
export function writePDF(pages, meta = {}) {
  const objs = [];            // index → string | {stream, dict}
  const alloc = () => { objs.push(null); return objs.length; };
  const set = (id, v) => { objs[id - 1] = v; };
  const catalogId = alloc(), pagesId = alloc(), fontId = alloc(), fontDescId = alloc(), fontFileId = alloc(), outlinesId = alloc(), infoId = alloc();
  const pageIds = pages.map(() => alloc());
  const layerNames = [...new Set(pages.flatMap(p => collectLayers(p.prims)))].sort();
  const ocgIds = layerNames.map(() => alloc());
  const ocgOf = Object.fromEntries(layerNames.map((l, i) => [l, "oc" + (i + 1)]));
  const patterns = [];        // {id, key, dict, stream}
  const patKey = new Map();
  const images = [];
  const report = [];
  const pageRefIndex = new Map(pages.map((p, i) => [p.sheet, i]));

  pages.forEach((pg, pi) => {
    const [W, H] = pg.size;
    const out = [];
    out.push(`${K} 0 0 ${K} 0 0 cm`);             // mm from here on; stroke widths are mm
    out.push("1 J 1 j");
    const localPats = new Set(), localImgs = new Set(), localOC = new Set();
    const emit = (p) => {
      if (p.t === "group") { out.push("q"); if (p.clip) out.push(`${n3(p.clip[0])} ${n3(p.clip[1])} ${n3(p.clip[2] - p.clip[0])} ${n3(p.clip[3] - p.clip[1])} re W n`); p.prims.forEach(emit); out.push("Q"); return; }
      const oc = p.layer ? ocgOf[layerRoot(p.layer)] : null;
      if (oc) { out.push(`/OC /${oc} BDC`); localOC.add(oc); }
      if (p.t === "fill") { out.push(col(p.colour, "rg")); out.push(pathOps(p.path)); out.push("f*"); }
      else if (p.t === "stroke") {
        if (p.weight === "none" || p.weight == null) throw new Error("a stroke with no pen reached the PDF writer; `none` must be fill-only");
        out.push(col(p.colour, "RG")); out.push(`${n4(p.weight)} w`);
        out.push(p.dash && p.dash.length ? `[${p.dash.map(n4).join(" ")}] 0 d` : "[] 0 d");
        out.push(pathOps(p.path)); out.push("S");
      }
      else if (p.t === "hatch") {
        for (const fam of hatchFamilies(p)) {
          const key = JSON.stringify(fam.key);
          let id = patKey.get(key);
          if (!id) { id = "P" + (patterns.length + 1); patKey.set(key, id); patterns.push(Object.assign({ id, obj: alloc() }, fam)); }
          localPats.add(id);
          out.push(`/Pattern cs /${id} scn`); out.push(pathOps(p.path)); out.push("f*");
        }
      }
      else if (p.t === "text") {
        const em = emOf(p.height);
        const w = textWidth(p.text, p.height);
        const dx = p.align === "centre" ? -w / 2 : p.align === "right" ? -w : 0;
        const dy = p.valign === "middle" ? -p.height / 2 : 0;
        const a = (p.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const x = p.at[0] + dx * c - dy * s, y = p.at[1] + dx * s + dy * c;
        out.push(col(p.colour, "rg")); out.push("BT");
        out.push(`/F1 ${n4(em)} Tf`);
        out.push(`${n4(c)} ${n4(s)} ${n4(-s)} ${n4(c)} ${n3(x)} ${n3(y)} Tm`);
        out.push(`(${encodeText(p.text)}) Tj`); out.push("ET");
      }
      else if (p.t === "raster" && p.jpeg) {
        const id = "Im" + (images.length + 1); images.push({ id, obj: alloc(), jpeg: p.jpeg, w: p.pxW, h: p.pxH }); localImgs.add(id);
        out.push(`q ${n3(p.rect[2])} 0 0 ${n3(p.rect[3])} ${n3(p.rect[0])} ${n3(p.rect[1])} cm /${id} Do Q`);
      }
      if (oc) out.push("EMC");
    };
    pg.prims.forEach(emit);
    const content = out.join("\n");
    const contentId = alloc();
    set(contentId, { dict: "", stream: content });
    const pageRes = `/Font << /F1 ${fontId} 0 R >>` +
      (localPats.size ? ` /Pattern << ${[...localPats].map(id => `/${id} ${patterns.find(p => p.id === id).obj} 0 R`).join(" ")} >>` : "") +
      (localImgs.size ? ` /XObject << ${[...localImgs].map(id => `/${id} ${images.find(p => p.id === id).obj} 0 R`).join(" ")} >>` : "") +
      (localOC.size ? ` /Properties << ${[...localOC].map(oc => `/${oc} ${ocgIds[layerNames.findIndex(l => ocgOf[l] === oc)]} 0 R`).join(" ")} >>` : "");
    // Internal links: a marker links to the sheet it refers to (§12.1).
    const annots = [];
    for (const L of pg.links || []) {
      const target = pageRefIndex.get(L.sheet);
      if (target === undefined) { report.push(`link on page ${pi + 1} points at sheet ${L.sheet}, which is not in this set`); continue; }
      const aid = alloc();
      set(aid, `<< /Type /Annot /Subtype /Link /Rect [${[L.rect[0], L.rect[1], L.rect[0] + L.rect[2], L.rect[1] + L.rect[3]].map(v => n3(v * PT_PER_MM)).join(" ")}] /Border [0 0 0] /Dest [${pageIds[target]} 0 R /Fit] >>`);
      annots.push(aid);
    }
    const box = `[0 0 ${n3(W * PT_PER_MM)} ${n3(H * PT_PER_MM)}]`;
    set(pageIds[pi], `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox ${box} /TrimBox ${box} /Resources << ${pageRes} >> /Contents ${contentId} 0 R${annots.length ? ` /Annots [${annots.map(a => a + " 0 R").join(" ")}]` : ""} >>`);
  });

  // Tiling patterns: the cell defined once, the matrix does the rest (§12.3).
  for (const p of patterns) set(p.obj, { dict: `/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 ${n4(p.cellW)} ${n4(p.cellH)}] /XStep ${n4(p.cellW)} /YStep ${n4(p.cellH)} /Resources << >> /Matrix [${p.matrix.map(n4).join(" ")}]`, stream: p.stream });
  for (const im of images) set(im.obj, { dict: `/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, bin: im.jpeg });

  // The font: embedded, subset, one encoding (§12.3).
  const tag = "WBSUBS";
  const widths = []; for (let c = 32; c <= 255; c++) widths.push(FONT_WIDTHS[c] ?? 0);
  set(fontId, `<< /Type /Font /Subtype /TrueType /BaseFont /${tag}+${FONT_NAME} /FirstChar 32 /LastChar 255 /Widths [${widths.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor ${fontDescId} 0 R >>`);
  const m = FONT_METRICS;
  set(fontDescId, `<< /Type /FontDescriptor /FontName /${tag}+${FONT_NAME} /Flags 32 /FontBBox [${m.bbox.join(" ")}] /ItalicAngle 0 /Ascent ${m.ascent} /Descent ${m.descent} /CapHeight ${m.capHeight} /StemV 80 /FontFile2 ${fontFileId} 0 R >>`);
  const ttf = b64bytes(FONT_TTF_B64);
  set(fontFileId, { dict: `/Length1 ${ttf.length}`, bin: ttf });

  // Optional content groups from categories.
  layerNames.forEach((l, i) => set(ocgIds[i], `<< /Type /OCG /Name (${encodeText(l)}) >>`));
  const ocProps = layerNames.length ? ` /OCProperties << /OCGs [${ocgIds.map(i => i + " 0 R").join(" ")}] /D << /Order [${ocgIds.map(i => i + " 0 R").join(" ")}] /ON [${ocgIds.map(i => i + " 0 R").join(" ")}] >> >>` : "";
  // Bookmarks from sheet number and name.
  const itemIds = pages.map(() => alloc());
  pages.forEach((pg, i) => set(itemIds[i], `<< /Title (${encodeText(pg.title || "Page " + (i + 1))}) /Parent ${outlinesId} 0 R${i > 0 ? ` /Prev ${itemIds[i - 1]} 0 R` : ""}${i < pages.length - 1 ? ` /Next ${itemIds[i + 1]} 0 R` : ""} /Dest [${pageIds[i]} 0 R /Fit] >>`));
  set(outlinesId, pages.length ? `<< /Type /Outlines /First ${itemIds[0]} 0 R /Last ${itemIds[itemIds.length - 1]} 0 R /Count ${pages.length} >>` : "<< /Type /Outlines /Count 0 >>");
  set(pagesId, `<< /Type /Pages /Kids [${pageIds.map(i => i + " 0 R").join(" ")}] /Count ${pages.length} >>`);
  set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R /Outlines ${outlinesId} 0 R /PageMode /UseOutlines${ocProps} >>`);
  const date = meta.date || new Date();
  const pdfDate = "D:" + date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
  set(infoId, `<< /Title (${encodeText(meta.title || "Drawing set")}) /Producer (Web BIM) /CreationDate (${pdfDate}) /Project (${encodeText(meta.project || "")}) /Revision (${encodeText(meta.revision || "")}) /IssuedBy (${encodeText(meta.issuedBy || "")}) /IssueDate (${encodeText(meta.issueDate || "")}) >>`);

  // Serialise with a correct xref.
  const chunks = []; let offset = 0; const offsets = [];
  const push = s => { const b = typeof s === "string" ? latin1(s) : s; chunks.push(b); offset += b.length; };
  push("%PDF-1.6\n%\xE2\xE3\xCF\xD3\n");
  objs.forEach((o, i) => {
    offsets[i] = offset;
    if (o === null) { push(`${i + 1} 0 obj\nnull\nendobj\n`); return; }
    if (typeof o === "string") { push(`${i + 1} 0 obj\n${o}\nendobj\n`); return; }
    const body = o.bin ? o.bin : latin1(o.stream);
    push(`${i + 1} 0 obj\n<< ${o.dict} /Length ${body.length} >>\nstream\n`); push(body); push("\nendstream\nendobj\n");
  });
  const xref = offset;
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) x += String(o).padStart(10, "0") + " 00000 n \n";
  push(x);
  push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const total = new Uint8Array(offset); let at = 0; for (const c of chunks) { total.set(c, at); at += c.length; }
  return { bytes: total, report, layers: layerNames, patterns: patterns.length };
}

function layerRoot(l) { return String(l).split("-")[0]; }
function collectLayers(prims, out = []) { for (const p of prims) { if (p.t === "group") collectLayers(p.prims, out); else if (p.layer) out.push(layerRoot(p.layer)); } return out; }

/** Path segments → PDF path operators, in mm. Arcs become ≤90° cubic Béziers. */
export function pathOps(path) {
  const ops = []; let cur = null;
  for (const s of path) {
    const a = segStart(s);
    if (!cur || Math.hypot(a[0] - cur[0], a[1] - cur[1]) > 1e-6) ops.push(`${n4(a[0])} ${n4(a[1])} m`);
    if (s.k === "L") ops.push(`${n4(s.b[0])} ${n4(s.b[1])} l`);
    else if (s.k === "C") ops.push(`${n4(s.c1[0])} ${n4(s.c1[1])} ${n4(s.c2[0])} ${n4(s.c2[1])} ${n4(s.b[0])} ${n4(s.b[1])} c`);
    else {
      const sweep = s.a1 - s.a0, n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
      for (let i = 0; i < n; i++) {
        const t0 = s.a0 + sweep * i / n, t1 = s.a0 + sweep * (i + 1) / n, k = 4 / 3 * Math.tan((t1 - t0) / 4);
        const p0 = [s.c[0] + s.r * Math.cos(t0), s.c[1] + s.r * Math.sin(t0)], p3 = [s.c[0] + s.r * Math.cos(t1), s.c[1] + s.r * Math.sin(t1)];
        const p1 = [p0[0] - k * s.r * Math.sin(t0), p0[1] + k * s.r * Math.cos(t0)], p2 = [p3[0] + k * s.r * Math.sin(t1), p3[1] - k * s.r * Math.cos(t1)];
        ops.push(`${n4(p1[0])} ${n4(p1[1])} ${n4(p2[0])} ${n4(p2[1])} ${n4(p3[0])} ${n4(p3[1])} c`);
      }
    }
    cur = segEnd(s);
  }
  return ops.join(" ");
}

/** One tiling pattern per line family. In the family's own frame the lines are
 *  horizontal; rows repeat after k rows when the stagger comes back round. */
export function hatchFamilies(p) {
  const pat = p.pattern, s = p.scale, out = [];
  for (const L of pat.lines || []) {
    const across = L.delta[1], along = L.delta[0];
    const dashes = L.dashes && L.dashes.length ? L.dashes : null;
    const period = dashes ? dashes.reduce((a, b) => a + Math.abs(b), 0) : Math.max(across, 1);
    let rows = 1;
    if (dashes && along) { for (rows = 1; rows <= 16; rows++) { const r = (rows * along) % period; if (r < 1e-6 || period - r < 1e-6) break; } if (rows > 16) rows = 1; }
    const cellW = period, cellH = across * rows;
    const wPat = p.weight / s;                       // mm on paper ÷ pattern scale
    const lines = [`${col(p.colour, "RG")} ${n4(wPat)} w 0 J`];
    for (let r = 0; r < rows; r++) {
      const y = r * across + across / 2;
      if (!dashes) lines.push(`${n4(-cellW)} ${n4(y)} m ${n4(2 * cellW)} ${n4(y)} l S`);
      else {
        let x = (r * along) % period - period;
        while (x < 2 * cellW) { for (const dsh of dashes) { const l = Math.abs(dsh); if (dsh > 0) lines.push(`${n4(x)} ${n4(y)} m ${n4(x + l)} ${n4(y)} l S`); else if (dsh === 0) lines.push(`${n4(x)} ${n4(y)} m ${n4(x + 0.01)} ${n4(y)} l S`); x += l || 0.01; } }
      }
    }
    const a = L.angle * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    const o = [(p.origin || [0, 0])[0] + (L.origin || [0, 0])[0] * s, (p.origin || [0, 0])[1] + (L.origin || [0, 0])[1] * s];
    const k = PT_PER_MM;
    // pattern space → default page space (points): the pattern ignores the page CTM
    const matrix = [k * s * c, k * s * sn, -k * s * sn, k * s * c, k * o[0], k * o[1]];
    out.push({ key: [pat.id, L, s, p.colour, p.weight, p.origin || [0, 0]], cellW, cellH, matrix, stream: lines.join("\n") });
  }
  return out;
}

export function encodeText(t) {
  let s = "";
  for (const ch of String(t)) {
    const code = FONT_METRICS.unicodeToCode[ch.codePointAt(0)];
    const c = code ?? 63;
    const chr = String.fromCharCode(c);
    s += chr === "(" || chr === ")" || chr === "\\" ? "\\" + chr : c < 32 || c > 126 ? "\\" + c.toString(8).padStart(3, "0") : chr;
  }
  return s;
}
function latin1(str) { const b = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 255; return b; }
function b64bytes(b64) {
  if (typeof atob === "function") { const s = atob(b64); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  return new Uint8Array(Buffer.from(b64, "base64"));
}
