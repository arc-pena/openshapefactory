//! Title blocks as families (Revit's title block family): lines, rectangles, circles, fills, fixed text,
//! labels - smart fields that write the sheet's or the project's values (Sheet Name, Sheet Number, Scale,
//! Drawn By… or any field the family names) - and symbols (a north arrow, a logo). Each item can be tied to
//! a Yes/No visibility parameter, which every sheet shows as a check box, and each sheet keeps its own values
//! for the family's own fields. Items are laid out on the family's design sheet in paper mm and held to its
//! left or right edge (and to its foot or head), so one family serves any sheet size.
//!
//! Family: `{ family: "titleblock", name, space: "paper", design: [W, H], viewTitles: "band" | "plain",
//! scaleStyle: "imperial" | "band" | "list", fields: [{ name, default }], visibility: [{ name, default }], items }`
//! Item: `{ k: "line" | "rect" | "circle" | "fill" | "text" | "label" | "symbol", …, hold?: "left" | "right",
//! holdY?: "bottom" | "top", vis?: "<visibility parameter>" }`.


/** The fields every title block can write, and where each one's value comes from. */
export const TB_FIELDS = [
  ["Sheet Number", "sheet"], ["Sheet Name", "sheet"], ["Scale", "sheet"], ["Print Size", "sheet"], ["Orientation", "sheet"], ["Revision", "sheet"], ["Today", "sheet"],
  ["Project Name", "project"], ["Project Number", "number"], ["Drawn By", "drawn"], ["Checked By", "checked"], ["Issue Date", "issued"], ["Issue", "issue"], ["Issue Set Date", "issueDate"],
  ["Place", "place"], ["County", "county"], ["Firm", "firm"], ["Firm Address", "firmAddress"], ["Phone", "phone"], ["Fax", "fax"], ["Address", "address"], ["Client", "client"],
  ["Author", "author"], ["Drafted", "drafted"], ["Notes", "notes"], ["Revisions", "revisions"],
];
const PROJECT_KEY = Object.fromEntries(TB_FIELDS.filter(([, s]) => s !== "sheet" && s !== "project").map(([n, k]) => [n, k]));

/** Is this symbol a title block family (items to draw) rather than a generated one? */
export const isTitleFamily = s => !!(s && Array.isArray(s.items));

/** A field's value on a sheet: the sheet's own value, else the sheet's or the project's, else the family's default. */
export function tbFieldValue(doc, sh, name, tb, scales) {
  const own = (doc.argValue(sh, "tbFields") || {})[name];
  if (own != null && own !== "") return String(own);
  const P = (doc.meta && doc.meta.project) || {};
  switch (name) {
    case "Sheet Number": return String(doc.argValue(sh, "number") || "");
    case "Sheet Name": return String(doc.argValue(sh, "sheetName") || "");
    case "Print Size": return String(doc.argValue(sh, "size") || "");
    case "Orientation": return String(doc.argValue(sh, "orientation") || "");
    case "Revision": return String(doc.argValue(sh, "revision") || "");
    case "Today": return new Date().toISOString().slice(0, 10);
    case "Project Name": return String(doc.meta.name || "");
    case "Scale": return scaleText(doc, sh, tb, scales);
  }
  const k = PROJECT_KEY[name] || name;
  if (P[k] != null && P[k] !== "") return String(P[k]);
  const f = (tb.fields || []).find(x => x.name === name);
  return f && f.default != null ? String(f.default) : "";
}
function scaleText(doc, sh, tb, scales) {
  const lab = doc.argValue(sh, "scaleLabel"); if (lab) return lab;
  const list = scales || [];
  if (tb.scaleStyle === "imperial" || tb.scaleStyle === "imperialCompact") { const nm = list.length === 1 ? list[0].name : ""; return nm ? (tb.scaleStyle === "imperialCompact" ? nm.replace(/ = /g, "=") : nm) : list.length ? (tb.asNoted || "AS NOTED") : ""; }
  if (tb.scaleStyle === "band") return list.length === 1 ? `1 : ${list[0].n}` : list.length ? "As indicated" : "";
  return list.map(s => "1:" + s.n).join(", ") || "—";
}
/** Is an item shown on this sheet (its visibility parameter, the sheet's check box over the family's default)? */
export function tbVisible(doc, sh, tb, item) {
  if (!item.vis) return true;
  const own = (doc.argValue(sh, "tbVisibility") || {})[item.vis];
  if (own != null) return !!own;
  const p = (tb.visibility || []).find(v => v.name === item.vis);
  return p ? p.default !== false : true;
}
/** Draw a title block family on a sheet W×H: `put(path, weight, colour)`, `txt(at, text, h, o)`, `fill(path, colour)`,
 *  `sym(symbolId, at, rot, scale)`; `segs` makes a path from points, `circ` a circle path. */
export function drawTitleFamily(doc, sh, W, H, tb, io) {
  const [DW, DH] = tb.design || [W, H];
  // held to the left or the right edge (to the foot or the head); "stretch": each point to its nearer edge
  const X = (x, it) => { const h = it.hold || tb.hold; return h === "right" || (h === "stretch" && x > DW / 2) ? W - (DW - x) : x; };
  const Y = (y, it) => { const h = it.holdY || tb.holdY; return h === "top" || (h === "stretch" && y > DH / 2) ? H - (DH - y) : y; };
  const P = (q, it) => [X(q[0], it), Y(q[1], it)];
  for (const it of tb.items) {
    if (!tbVisible(doc, sh, tb, it)) continue;
    const w = it.w ?? 0.19, colour = it.colour || "#1b1f24";
    if (it.k === "line") io.put(io.segs(it.pts.map(q => P(q, it)), false), w, colour);
    else if (it.k === "rect") { const a = P(it.a, it), b = P(it.b, it); io.put(io.segs([a, [b[0], a[1]], b, [a[0], b[1]]], true), w, colour); }
    else if (it.k === "circle") io.put(io.circ(P(it.c, it), it.r), w, colour);
    else if (it.k === "fill") io.fill(io.segs(it.pts.map(q => P(q, it)), true), it.colour || "#1b1f24");
    else if (it.k === "symbol") io.sym(it.symbol, P(it.at, it), it.rot || 0, it.scale || 1);
    else if (it.k === "text" || it.k === "label") {
      let s = it.k === "text" ? String(it.text ?? "") : tbFieldValue(doc, sh, it.field, tb, io.scales);
      if (it.k === "label" && it.line != null) s = s.split("\n")[it.line] || "";
      if (it.k === "label" && it.line == null && it.lines) { s.split("\n").slice(0, it.lines).forEach((l, i) => drawText(it, l, [it.at[0] + (it.step ? it.step[0] * i : 0), it.at[1] + (it.step ? it.step[1] * i : 0)])); continue; }
      drawText(it, s, it.at);
    }
  }
  function drawText(it, s0, at) {
    let s = (it.prefix || "") + s0 + (it.suffix || ""); if (it.upper) s = s.toUpperCase();
    if (!s) return;
    let h = it.h || 2.5;
    const wf = it.widthFactor || 1;
    if (it.room && io.tw) { const tw = io.tw(s, h, it.font) * wf; if (tw > it.room) h *= it.room / tw; }
    io.txt(P(at, it), s, h, Object.assign({ rot: it.rot || 0, align: it.align || "left" }, it.font ? { font: it.font } : {}, it.colour ? { colour: it.colour } : {}, wf !== 1 ? { widthFactor: wf } : {}));
  }
}

// ---------------------------------------------------------------- the office families
const cap = pt => pt * 25.4 / 72 * 0.7;          // a point size's cap height, as Futura is set on the sets

/** Frank Harmon Architect's title strip along the right edge of an ARCH D sheet, read upward. */
function fhaStripFamily() {
  const F = "Futura", up = (x, y, pt, o) => Object.assign({ at: [x, y], h: cap(pt), rot: 90, font: F, hold: "right" }, o);
  const T = (x, y, text, pt, o = {}) => Object.assign({ k: "text", text }, up(x, y, pt, o));
  const Lb = (x, y, field, pt, o = {}) => Object.assign({ k: "label", field }, up(x, y, pt, o));
  const items = [{ k: "line", pts: [[884.7, 17.4], [884.7, 595.1]], hold: "right", holdY: "stretch" }];
  const box = (y0, y1, cuts, top) => { items.push({ k: "rect", a: [876.9, y0], b: [892.5, y1], hold: "right", holdY: top ? "top" : undefined }); for (const c of cuts) items.push({ k: "line", pts: [[876.9, c], [892.5, c]], hold: "right" }); };
  box(198.2, 274.4, [223.6, 249.0]); box(410.2, 461.0, [435.6]); box(563.0, 595.1, [], true);
  items.push(Lb(881.2, 28.6, "Project Name", 24, { line: 0, upper: true, room: 166 }), Lb(891.3, 29.0, "Place", 24, { upper: true, room: 166 }),
    Lb(881.3, 278.3, "Firm", 24, { room: 128 }), Lb(888.4, 278.9, "Firm Address", 9, { lines: 2, step: [3.9, 0] }),
    Lb(888.4, 388.5, "Phone", 9), Lb(892.3, 375.5, "Fax", 9, { prefix: "facsimile " }),
    T(881.2, 200.7, "Job No.", 10), T(881.2, 226.1, "Date", 10), T(881.2, 251.5, "Scale", 10), T(881.2, 413.5, "Drawn", 10), T(881.2, 438.9, "Checked", 10), T(881.2, 572.3, "Sheet", 10, { holdY: "top" }),
    Lb(889.1, 200.7, "Project Number", 9), Lb(889.7, 225.5, "Issue Date", 9), Lb(889.4, 251.2, "Scale", 10), Lb(888.9, 417.9, "Drawn By", 9), Lb(888.6, 443.9, "Checked By", 9),
    Lb(882.7, 465.4, "Sheet Name", 20, { upper: true, room: 92.6 }), Lb(892.5, 571.2, "Sheet Number", 20, { holdY: "top" }),
    { k: "label", field: "Issue", at: [802, 40.6], h: cap(30), font: F, upper: true, hold: "right", vis: "Issue stamp" },
    { k: "label", field: "Issue Set Date", at: [802, 27.4], h: cap(30), font: F, hold: "right", vis: "Issue stamp" });
  return { family: "titleblock", name: "Title strip (Frank Harmon Architect: Futura, along the right edge)", space: "paper", design: [914, 610], viewTitles: "band", scaleStyle: "imperial",
    fields: [], visibility: [{ name: "Issue stamp", default: true }], items };
}
/** Frank Harmon's band along the foot of an upright sheet (610 wide). */
function fhaBandFamily() {
  const F = "Futura", items = [];
  const T = (x, y, text, pt, o = {}) => items.push(Object.assign({ k: "text", text, at: [x, y], h: cap(pt), font: F }, o));
  const Lb = (x, y, field, pt, o = {}) => items.push(Object.assign({ k: "label", field, at: [x, y], h: cap(pt), font: F }, o));
  for (const [a, b, r] of [[195.6, 221.0], [221.0, 246.4], [246.4, 271.8], [408.4, 433.8, 1], [433.8, 459.2, 1], [567.1, 592.5, 1]]) items.push({ k: "rect", a: [a, 21.3], b: [b, 37.0], hold: r ? "right" : "left" });
  items.push({ k: "line", pts: [[246.4, 29.2], [592.5, 29.2]], hold: "stretch" }, { k: "line", pts: [[195.6, 29.2], [246.4, 29.2]] });
  Lb(26.1, 31.4, "Project Name", 24, { line: 0, room: 100 }); Lb(26.1, 21.1, "Project Name", 24, { line: 1, room: 150 });
  Lb(130.1, 31.4, "County", 24, { line: 0, room: 60 }); Lb(178.7, 22.0, "County", 24, { line: 1 });
  T(197.9, 32.0, "Job No.", 10); T(223.3, 32.0, "Date", 10); T(248.7, 32.0, "Scale", 10);
  Lb(197.8, 24.0, "Project Number", 9); Lb(223.2, 24.0, "Issue Date", 9); Lb(248.6, 24.0, "Scale", 9, { room: 22 });
  Lb(275.8, 31.4, "Firm", 24, { room: 129 }); Lb(276.2, 24.6, "Firm Address", 9, { lines: 2, step: [0, -3.5] });
  Lb(404, 24.6, "Phone", 9, { align: "right", hold: "right" }); Lb(404, 21.1, "Fax", 9, { align: "right", hold: "right", prefix: "facsimile " });
  T(410.7, 32.0, "Drawn", 10, { hold: "right" }); T(436.1, 32.0, "Checked", 10, { hold: "right" }); Lb(409.1, 24.0, "Drawn By", 9, { hold: "right" }); Lb(436.0, 24.0, "Checked By", 9, { hold: "right" });
  Lb(460.3, 31.4, "Sheet Name", 24, { upper: true, room: 104.7, hold: "right" });
  T(569.5, 32.0, "Sheet", 10, { hold: "right" }); Lb(573.0, 22.2, "Sheet Number", 21, { room: 18, hold: "right" });
  return { family: "titleblock", name: "Title band (Frank Harmon Architect: Futura, along the foot of an upright sheet)", space: "paper", design: [610, 914], viewTitles: "band", scaleStyle: "imperial",
    fields: [], visibility: [], items };
}
/** The Casa Mazatlan band: no border, one heavy rule above a band along the foot, laid out on A3 and held right. */
function titleBandFamily() {
  const A = "Arial", AB = "ArialBold", items = [];
  const T = (x, y, text, h, o = {}) => items.push(Object.assign({ k: "text", text, at: [x, y], h, font: A, hold: "right" }, o));
  const Lb = (x, y, field, h, o = {}) => items.push(Object.assign({ k: "label", field, at: [x, y], h, font: A, hold: "right" }, o));
  items.push({ k: "line", pts: [[10, 30.9], [410, 30.9]], w: 0.47, hold: "stretch" });
  Lb(9.9, 26.4, "Notes", 1.28, { hold: "left", upper: true, lines: 3, step: [0, -2.1] });
  Lb(9.9, 16.2, "Author", 1.28, { hold: "left", upper: true, vis: "Copyright" });
  T(9.9, 14.05, "RETIENE DERECHOS DE AUTOR", 1.28, { hold: "left", vis: "Copyright" }); T(9.9, 11.9, "SOBRE ESTE DIBUJO.", 1.28, { hold: "left", vis: "Copyright" });
  Lb(44.1, 26.4, "Revisions", 1.28, { hold: "left", upper: true });
  Lb(259.9, 24.6, "Project Name", 4.03, { upper: true });
  const lab = (x, y, t) => T(x, y, t, 1.52, { align: "right", font: AB });
  lab(274.57, 20.78, "PROJECT NO"); Lb(277.2, 20.55, "Project Number", 1.52);
  lab(274.57, 17.65, "DIRECCION"); Lb(277.2, 17.65, "Address", 1.52, { upper: true, lines: 3, step: [0, -2.35] });
  lab(274.57, 7.4, "CLIENTE"); Lb(277.2, 7.25, "Client", 1.52, { upper: true });
  lab(330.15, 17.56, "PRINT SIZE"); Lb(332.19, 17.39, "Print Size", 1.52, { font: AB });
  lab(330.15, 14.22, "DRAFTED"); Lb(332.0, 14.15, "Drafted", 1.52);
  lab(330.15, 10.79, "CHECKED"); Lb(332.0, 10.65, "Checked By", 1.52);
  lab(330.15, 7.45, "ORIG. ISSUE"); Lb(332.1, 7.25, "Issue Date", 1.52);
  items.push({ k: "circle", c: [352.1, 15.05], r: 7.5, w: 0.21, hold: "right", vis: "North" });
  T(352.2, 4.82, "NORTE", 1.52, { align: "centre", font: AB, vis: "North" });
  Lb(408.41, 24.38, "Sheet Name", 4.03, { align: "right", upper: true });
  Lb(388.57, 8.13, "Sheet Number", 9.47, { align: "centre" });
  Lb(398.76, 35.05, "Scale", 5.07, { align: "centre" });
  return { family: "titleblock", name: "Title band (Arial, notes and north)", space: "paper", design: [420, 297], viewTitles: "band", scaleStyle: "band",
    fields: [{ name: "Notes", default: "NO TOMAR COTAS DEL DIBUJO.\nCONTRATISTA COMPROBAR\nDIMENSIONES EN OBRA." }], visibility: [{ name: "North", default: true }, { name: "Copyright", default: true }], items };
}
/** The quiet default: a 5 mm border and a band along the foot - project, drawing, scale, revision, the number large. Laid out on A1. */
function defaultFamily() {
  const W = 841, H = 594, b = 5, bh = 23.76, k = bh / 22, y0 = b, y1 = b + bh, grey = "#7a828c";
  const numW = 70 * k, revW = 42 * k + 8, scW = 48 * k + 8, dwgW = 150;
  const xs = [W - b - numW, W - b - numW - revW, W - b - numW - revW - scW, W - b - numW - revW - scW - dwgW];
  const items = [{ k: "rect", a: [b, b], b: [W - b, H - b], w: 0.35, hold: "stretch", holdY: "stretch" }, { k: "line", pts: [[b, y1], [W - b, y1]], w: 0.35, hold: "stretch" }];
  for (const x of xs) items.push({ k: "line", pts: [[x, y0 + 2 * k], [x, y1 - 2 * k]], w: 0.13, colour: "#9aa1a9", hold: "right" });
  const label = (x, t, hold = "right") => items.push({ k: "text", text: t.toUpperCase(), at: [x + 3 * k, y1 - 4.2 * k], h: 1.6 * k, colour: grey, hold });
  label(b, "Project", "left"); items.push({ k: "label", field: "Project Name", at: [b + 3 * k, y0 + 5 * k], h: 7 * k, room: xs[3] - b - 6 * k, hold: "left" });
  label(xs[3], "Drawing"); items.push({ k: "label", field: "Sheet Name", at: [xs[3] + 3 * k, y0 + 5 * k], h: 5 * k, room: dwgW - 6 * k, hold: "right" });
  label(xs[2], "Scale"); items.push({ k: "label", field: "Scale", at: [xs[2] + 3 * k, y0 + 9 * k], h: 3.2 * k, room: scW - 6 * k, hold: "right" });
  items.push({ k: "label", field: "Print Size", at: [xs[2] + 3 * k, y0 + 4 * k], h: 2.2 * k, colour: grey, hold: "right" });
  label(xs[1], "Revision"); items.push({ k: "label", field: "Revision", at: [xs[1] + 3 * k, y0 + 9 * k], h: 3.2 * k, hold: "right" }, { k: "label", field: "Today", at: [xs[1] + 3 * k, y0 + 4 * k], h: 2.2 * k, colour: grey, hold: "right" });
  items.push({ k: "text", text: "SHEET", at: [W - b - 3 * k, y1 - 4.2 * k], h: 1.6 * k, colour: grey, align: "right", hold: "right" },
    { k: "label", field: "Sheet Number", at: [W - b - 3 * k, y0 + 4 * k], h: 11 * k, room: numW - 6 * k, align: "right", hold: "right" },
    { k: "fill", pts: [[xs[0], y1 - 0.9 * k], [W - b, y1 - 0.9 * k], [W - b, y1], [xs[0], y1]], hold: "right" });
  return { family: "titleblock", name: "Title block", space: "paper", design: [W, H], viewTitles: "plain", scaleStyle: "list", fields: [], visibility: [], items };
}
/** The families the library starts with (replacing the generated title blocks of earlier files). */
export function titleBlockFamilies() {
  return { "SY-TB-A1": defaultFamily(), "SY-TB-BAND": titleBandFamily(), "SY-TB-FHA": fhaStripFamily(), "SY-TB-FHAB": fhaBandFamily() };
}
