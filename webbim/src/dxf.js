//! DXF exchange (spec §12). Writes AutoCAD 2000 (AC1015) ASCII DXF — the oldest
//! version that honours group 370 (per-entity lineweight in 1/100 mm) and 420
//! (true colour) — and reads the common 2D entity set back into the app's path
//! format. Units are decided exactly once: the reader converts every coordinate
//! to millimetres in a single pass at the end (dxScaleAll), so an inch file can
//! never be multiplied by 25.4 twice. `makeZip` exists because the host page may
//! only download .zip, so a .dxf is shipped inside a STORE-method archive.

import { TAU, near, segStart, segEnd, bez } from "./geom2d.js";

// ---------------------------------------------------------------- lineweights (§12.4)

/** The only lineweights DXF can carry (group 370, hundredths of a millimetre). */
export const DXF_LWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

/** Snap a pen width in mm to the nearest legal rung. Ties go to the heavier rung
 *  (a line should never print thinner than drawn). `substituted` is true when the
 *  rung differs from the request by more than float noise (0.18*100 = 18.000000000000004). */
export function dxfLineweight(mm) {
  const want = Math.max(0, Number(mm) || 0) * 100;
  let best = DXF_LWEIGHTS[0], bd = Infinity;
  for (const w of DXF_LWEIGHTS) {
    const d = Math.abs(w - want);
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && w > best)) { bd = d; best = w; }
  }
  return { code: best, substituted: Math.abs(best - want) > 1e-6, from: mm, to: best / 100 };
}

// ---------------------------------------------------------------- shared tables

// $INSUNITS code ↔ unit name ↔ millimetres per unit.
const dxUnitCodes = { 1: ["in", 25.4], 2: ["ft", 304.8], 3: ["mi", 1609344], 4: ["mm", 1], 5: ["cm", 10], 6: ["m", 1000],
  7: ["km", 1e6], 8: ["uin", 25.4e-6], 9: ["mil", 0.0254], 10: ["yd", 914.4], 14: ["dm", 100] };
const dxUnitByName = Object.fromEntries(Object.entries(dxUnitCodes).map(([c, [n, f]]) => [n, { code: +c, f }]));

const dxRad = d => d * Math.PI / 180;
const dxDeg = r => r * 180 / Math.PI;

/** Format a float without exponent notation, trimmed of trailing zeros. */
function dxNum(x) {
  if (!Number.isFinite(x)) x = 0;
  let s = Math.abs(x) >= 1e15 ? x.toFixed(0) : x.toFixed(9);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}
/** "0.42" / "0.50" / "0.425" for report lines. */
function dxMm(mm) { const s = String(Number(Number(mm).toFixed(4))); return /\.\d\d/.test(s) ? s : Number(mm).toFixed(2); }

/** Layer / linetype / pattern names: keep to the conservative DXF-legal set. */
function dxSymName(s, dflt) {
  const t = String(s ?? "").replace(/[^A-Za-z0-9_\-$ ]/g, "_").trim().slice(0, 255);
  return t || dflt;
}
/** Non-ASCII → \U+XXXX (AC1015 files are ANSI_1252; AutoCAD decodes the escape). */
function dxUni(s) {
  let o = "";
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o += c > 126 || c < 32 ? "\\U+" + c.toString(16).toUpperCase().padStart(4, "0") : s[i]; }
  return o;
}
function dxColour(hex) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map(c => c + c).join("") : m[1];
  return parseInt(h, 16);
}

/** Split a path into subpaths where a segment does not start at the previous end. */
function dxSubpaths(path) {
  const out = [];
  for (const s of path || []) {
    const cur = out[out.length - 1];
    if (cur && near(segStart(s), segEnd(cur[cur.length - 1]), 1e-6)) cur.push(s); else out.push([s]);
  }
  return out;
}

// ---------------------------------------------------------------- writer

/** Scene → AC1015 DXF text plus a human-readable report of every compromise. */
export function writeDXF(scene, { units = "mm", space = "model", name = "" } = {}) {
  const report = [];
  const U = dxUnitByName[units] || (report.push(`unknown units "${units}", wrote millimetres`), dxUnitByName.mm);
  const k = 1 / U.f;                               // scene mm → file units
  const P = p => [p[0] * k, p[1] * k];
  const paper = space === "paper";
  const prims = (scene && scene.prims) || [];

  let hs = 0x20;
  const H = () => (hs++).toString(16).toUpperCase();
  const tagger = () => { const a = []; return { a, t(c, v) { a.push(String(c).padStart(3), String(v)); } }; };

  // ---- pre-pass: layers, linetypes, lineweight substitutions
  const layers = new Map([["0", "0"]]);             // original → sanitised
  const used = new Set(["0"]);
  const layerOf = l => {
    const key = l == null || l === "" ? "0" : String(l);
    if (layers.has(key)) return layers.get(key);
    let n = dxSymName(key, "0"), i = 2;
    while (used.has(n.toUpperCase())) n = `${dxSymName(key, "0")}_${i++}`;
    used.add(n.toUpperCase()); layers.set(key, n); return n;
  };
  const ltypes = new Map();                         // name → dash elements in file units
  const ltypeOf = dash => {
    if (!Array.isArray(dash) || !dash.length || !dash.some(d => d > 0)) return "CONTINUOUS";
    const d = dash.length % 2 ? dash.concat(dash) : dash.slice();
    const n = "DASH_" + d.map(x => dxNum(+x).replace(".", "p")).join("_");
    if (!ltypes.has(n)) ltypes.set(n, d.map((x, i) => (i % 2 ? -1 : 1) * Math.abs(x) * k));
    return n;
  };
  const lwSeen = new Set();
  const lwOf = mm => {
    if (mm == null) return -1;                      // ByLayer: prim carries no pen
    const r = dxfLineweight(mm);
    if (r.substituted && !lwSeen.has(r.from)) { lwSeen.add(r.from); report.push(`${dxMm(r.from)} mm → ${r.to.toFixed(2)} mm (DXF has no ${dxMm(r.from)})`); }
    return r.code;
  };

  // ---- fixed handles
  const h = {}; for (const n of ["vportT", "ltypeT", "layerT", "styleT", "viewT", "ucsT", "appidT", "dimT", "brT",
    "vport", "ltByBlock", "ltByLayer", "ltCont", "style", "appid", "dim", "brModel", "brPaper",
    "blkModel", "endModel", "blkPaper", "endPaper", "dictRoot", "dictGroup"]) h[n] = H();
  const owner = paper ? h.brPaper : h.brModel;

  // ---- entities
  const E = tagger();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = p => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
  const head = (type, prim, lw, lt) => {
    E.t(0, type); E.t(5, H()); E.t(330, owner); E.t(100, "AcDbEntity");
    if (paper) E.t(67, 1);
    E.t(8, layerOf(prim.layer));
    if (lt) E.t(6, lt);
    E.t(370, lw);
    const c = dxColour(prim.colour); if (c !== null) E.t(420, c);
  };
  const skipped = {};
  const skip = why => { skipped[why] = (skipped[why] || 0) + 1; };

  const writeSeg = (s, prim, lw, lt) => {
    if (s.k === "L") {
      if (near(s.a, s.b, 1e-9)) return;
      const a = P(s.a), b = P(s.b); grow(a); grow(b);
      head("LINE", prim, lw, lt); E.t(100, "AcDbLine");
      E.t(10, dxNum(a[0])); E.t(20, dxNum(a[1])); E.t(30, 0); E.t(11, dxNum(b[0])); E.t(21, dxNum(b[1])); E.t(31, 0);
    } else if (s.k === "A") {
      const c = P(s.c), r = s.r * k; grow([c[0] - r, c[1] - r]); grow([c[0] + r, c[1] + r]);
      if (Math.abs(s.a1 - s.a0) >= TAU - 1e-9) {
        head("CIRCLE", prim, lw, lt); E.t(100, "AcDbCircle");
        E.t(10, dxNum(c[0])); E.t(20, dxNum(c[1])); E.t(30, 0); E.t(40, dxNum(r));
      } else {
        // DXF arcs always run CCW from 50 to 51; a clockwise arc is the CCW arc a1→a0.
        const lo = Math.min(s.a0, s.a1), hi = Math.max(s.a0, s.a1);
        const wrapDeg = d => { d %= 360; return d < 0 ? d + 360 : d; };
        head("ARC", prim, lw, lt); E.t(100, "AcDbCircle");
        E.t(10, dxNum(c[0])); E.t(20, dxNum(c[1])); E.t(30, 0); E.t(40, dxNum(r));
        E.t(100, "AcDbArc"); E.t(50, dxNum(wrapDeg(dxDeg(lo)))); E.t(51, dxNum(wrapDeg(dxDeg(hi))));
      }
    } else if (s.k === "C") {
      const pts = [s.a, s.c1, s.c2, s.b].map(P); pts.forEach(grow);
      head("SPLINE", prim, lw, lt); E.t(100, "AcDbSpline");
      E.t(210, 0); E.t(220, 0); E.t(230, 1);
      E.t(70, 8); E.t(71, 3); E.t(72, 8); E.t(73, 4); E.t(74, 0); E.t(42, "0.0000000001"); E.t(43, "0.0000000001");
      for (const u of [0, 0, 0, 0, 1, 1, 1, 1]) E.t(40, u);
      for (const p of pts) { E.t(10, dxNum(p[0])); E.t(20, dxNum(p[1])); E.t(30, 0); }
    } else skip(`segment kind "${s.k}"`);
  };

  const writeStroke = prim => {
    const lw = lwOf(prim.weight ?? 0), lt = ltypeOf(prim.dash);
    for (const sp of dxSubpaths(prim.path)) {
      if (sp.length >= 2 && sp.every(s => s.k === "L")) {
        const closed = near(segEnd(sp[sp.length - 1]), segStart(sp[0]), 1e-6);
        const pts = sp.map(s => P(s.a)); if (!closed) pts.push(P(sp[sp.length - 1].b));
        pts.forEach(grow);
        head("LWPOLYLINE", prim, lw, lt); E.t(100, "AcDbPolyline");
        E.t(90, pts.length); E.t(70, (closed ? 1 : 0) | (lt !== "CONTINUOUS" ? 128 : 0));
        for (const p of pts) { E.t(10, dxNum(p[0])); E.t(20, dxNum(p[1])); }
      } else for (const s of sp) writeSeg(s, prim, lw, lt);
    }
  };

  // HATCH boundary loops: all-line loops as polyline loops, others as edge loops.
  const writeLoops = (path, wasClosed) => {
    const loops = dxSubpaths(path).filter(sp => sp.length);
    E.t(91, loops.length);
    loops.forEach((sp, li) => {
      if (!near(segEnd(sp[sp.length - 1]), segStart(sp[0]), 1e-6)) {
        sp = sp.concat([{ k: "L", a: segEnd(sp[sp.length - 1]), b: segStart(sp[0]) }]); wasClosed.v = true;
      }
      const ext = li === 0 ? 1 : 0;
      if (sp.every(s => s.k === "L")) {
        E.t(92, 2 | ext); E.t(72, 0); E.t(73, 1); E.t(93, sp.length);
        for (const s of sp) { const a = P(s.a); grow(a); E.t(10, dxNum(a[0])); E.t(20, dxNum(a[1])); }
      } else {
        E.t(92, ext); E.t(93, sp.length);
        for (const s of sp) {
          if (s.k === "L") { const a = P(s.a), b = P(s.b); grow(a); grow(b); E.t(72, 1); E.t(10, dxNum(a[0])); E.t(20, dxNum(a[1])); E.t(11, dxNum(b[0])); E.t(21, dxNum(b[1])); }
          else if (s.k === "A") {
            const c = P(s.c), r = s.r * k; grow([c[0] - r, c[1] - r]); grow([c[0] + r, c[1] + r]);
            const ccw = s.a1 >= s.a0;
            // Clockwise hatch arcs store complementary angles (360 − a), as AutoCAD and ezdxf do.
            const st = ccw ? dxDeg(s.a0) : 360 - dxDeg(s.a0), en = ccw ? dxDeg(s.a1) : 360 - dxDeg(s.a1);
            E.t(72, 2); E.t(10, dxNum(c[0])); E.t(20, dxNum(c[1])); E.t(40, dxNum(r)); E.t(50, dxNum(st)); E.t(51, dxNum(en)); E.t(73, ccw ? 1 : 0);
          } else {
            const pts = [s.a, s.c1, s.c2, s.b].map(P); pts.forEach(grow);
            E.t(72, 4); E.t(94, 3); E.t(73, 0); E.t(74, 0); E.t(95, 8); E.t(96, 4);
            for (const u of [0, 0, 0, 0, 1, 1, 1, 1]) E.t(40, u);
            for (const p of pts) { E.t(10, dxNum(p[0])); E.t(20, dxNum(p[1])); }
          }
        }
      }
      E.t(97, 0);
    });
  };

  // Pattern lines are read PAT-style: {angle(deg), origin:[x,y], delta:[along, across], dash:[...]}
  // (aliases: ang, base, offset, dashes). Anything unreadable falls back to ANSI31.
  const patLines = pat => {
    const ls = pat && Array.isArray(pat.lines) ? pat.lines : [];
    const out = [];
    for (const l of ls) {
      if (!l || typeof l !== "object") return null;
      const ang = +(l.angle ?? l.ang ?? 0);
      const o = l.origin ?? l.base ?? [0, 0];
      const d = l.delta ?? l.offset ?? (l.spacing != null ? [0, l.spacing] : null);
      if (!Number.isFinite(ang) || !Array.isArray(o) || !Array.isArray(d) || Math.hypot(d[0], d[1]) < 1e-9) return null;
      const ca = Math.cos(dxRad(ang)), sa = Math.sin(dxRad(ang));
      out.push({ ang, o: [o[0] * k, o[1] * k], d: [(d[0] * ca - d[1] * sa) * k, (d[0] * sa + d[1] * ca) * k],
        dash: (l.dash ?? l.dashes ?? []).map(x => x * k) });
    }
    return out.length ? out : null;
  };

  const writeHatch = (prim, solid) => {
    const closedFix = { v: false };
    let pname = "SOLID", lines = null;
    if (!solid) {
      lines = patLines(prim.pattern);
      if (lines) pname = dxSymName(prim.pattern && prim.pattern.id, "CUSTOM");
      else {
        pname = "ANSI31"; lines = [{ ang: 45, o: [0, 0], d: [-3.175 * Math.SQRT1_2 * k, 3.175 * Math.SQRT1_2 * k], dash: [] }];
        report.push(`hatch pattern "${prim.pattern && prim.pattern.id}" could not be expressed as DXF pattern lines; substituted ANSI31`);
      }
    }
    head("HATCH", prim, solid ? -1 : lwOf(prim.weight ?? null), null);
    E.t(100, "AcDbHatch"); E.t(10, 0); E.t(20, 0); E.t(30, 0); E.t(210, 0); E.t(220, 0); E.t(230, 1);
    E.t(2, pname); E.t(70, solid ? 1 : 0); E.t(71, 0);
    writeLoops(prim.path, closedFix);
    E.t(75, 0);                                  // odd parity = the app's even-odd fill
    E.t(76, solid ? 1 : pname === "ANSI31" ? 1 : 2);
    if (!solid) {
      E.t(52, 0); E.t(41, 1); E.t(77, 0); E.t(78, lines.length);
      for (const l of lines) {
        E.t(53, dxNum(l.ang)); E.t(43, dxNum(l.o[0])); E.t(44, dxNum(l.o[1])); E.t(45, dxNum(l.d[0])); E.t(46, dxNum(l.d[1]));
        E.t(79, l.dash.length); for (const d of l.dash) E.t(49, dxNum(d));
      }
    }
    E.t(98, 0);
    if (closedFix.v) report.push(`an open ${solid ? "fill" : "hatch"} boundary on layer "${prim.layer ?? "0"}" was closed with a straight edge`);
  };

  const writeText = prim => {
    const at = P(prim.at || [0, 0]); grow(at);
    head("MTEXT", prim, -1, null); E.t(100, "AcDbMText");
    E.t(10, dxNum(at[0])); E.t(20, dxNum(at[1])); E.t(30, 0);
    E.t(40, dxNum((prim.height || 2.5) * k)); E.t(41, 0);
    E.t(71, prim.align === "centre" || prim.align === "center" ? 8 : prim.align === "right" ? 9 : 7); E.t(72, 1);
    // Escape, then split into 250-char chunks without cutting an escape sequence.
    const atoms = [];
    for (const ch of String(prim.text ?? "")) {
      if (ch === "\n") atoms.push("\\P"); else if (ch === "\r") continue;
      else if (ch === "\\" || ch === "{" || ch === "}") atoms.push("\\" + ch);
      else atoms.push(dxUni(ch));
    }
    const chunks = [""];
    for (const a of atoms) { if (chunks[chunks.length - 1].length + a.length > 249) chunks.push(""); chunks[chunks.length - 1] += a; }
    for (let i = 0; i < chunks.length - 1; i++) E.t(3, chunks[i]);
    E.t(1, chunks[chunks.length - 1]);
    E.t(7, "Standard"); E.t(50, dxNum(+prim.rot || 0));
  };

  for (const prim of prims) {
    if (!prim) continue;
    if (prim.t === "stroke") writeStroke(prim);
    else if (prim.t === "fill") writeHatch(prim, true);
    else if (prim.t === "hatch") writeHatch(prim, false);
    else if (prim.t === "text") writeText(prim);
    else skip(`primitive "${prim.t}"`);
  }
  for (const [why, n] of Object.entries(skipped)) report.push(`not exported: ${n} × ${why}`);

  // ---- tables
  const T = tagger();
  const table = (name, handle, count, sub) => {
    T.t(0, "TABLE"); T.t(2, name); T.t(5, handle); T.t(330, 0); T.t(100, "AcDbSymbolTable"); T.t(70, count);
    if (sub) T.t(100, sub);
  };
  const rec = (type, handle, tableHandle, sub, nm, hcode = 5) => {
    T.t(0, type); T.t(hcode, handle); T.t(330, tableHandle); T.t(100, "AcDbSymbolTableRecord"); T.t(100, sub); T.t(2, nm); T.t(70, 0);
  };
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = ((scene && scene.size && scene.size[0]) || 420) * k; y1 = ((scene && scene.size && scene.size[1]) || 297) * k; }
  const vw = Math.max(x1 - x0, 1e-6), vh = Math.max(y1 - y0, 1e-6);

  table("VPORT", h.vportT, 1);
  rec("VPORT", h.vport, h.vportT, "AcDbViewportTableRecord", "*ACTIVE");
  for (const [c, v] of [[10, 0], [20, 0], [11, 1], [21, 1], [12, dxNum((x0 + x1) / 2)], [22, dxNum((y0 + y1) / 2)], [13, 0], [23, 0],
    [14, 10], [24, 10], [15, 10], [25, 10], [16, 0], [26, 0], [36, 1], [17, 0], [27, 0], [37, 0],
    [40, dxNum(vh * 1.1)], [41, dxNum(Math.min(Math.max(vw / vh, 0.1), 10))], [42, 50], [43, 0], [44, 0], [50, 0], [51, 0],
    [71, 0], [72, 1000], [73, 1], [74, 3], [75, 0], [76, 0], [77, 0], [78, 0]]) T.t(c, v);
  T.t(0, "ENDTAB");

  table("LTYPE", h.ltypeT, 3 + ltypes.size);
  for (const [hh, nm] of [[h.ltByBlock, "ByBlock"], [h.ltByLayer, "ByLayer"], [h.ltCont, "CONTINUOUS"]]) {
    rec("LTYPE", hh, h.ltypeT, "AcDbLinetypeTableRecord", nm);
    T.t(3, nm === "CONTINUOUS" ? "Solid line" : ""); T.t(72, 65); T.t(73, 0); T.t(40, 0);
  }
  for (const [nm, els] of ltypes) {
    rec("LTYPE", H(), h.ltypeT, "AcDbLinetypeTableRecord", nm);
    T.t(3, "dash " + els.map(e => dxNum(Math.abs(e))).join(" ")); T.t(72, 65); T.t(73, els.length);
    T.t(40, dxNum(els.reduce((s, e) => s + Math.abs(e), 0)));
    for (const e of els) { T.t(49, dxNum(e)); T.t(74, 0); }
  }
  T.t(0, "ENDTAB");

  table("LAYER", h.layerT, layers.size);
  for (const nm of layers.values()) {
    rec("LAYER", H(), h.layerT, "AcDbLayerTableRecord", nm);
    T.t(62, 7); T.t(6, "CONTINUOUS"); T.t(370, -3);
  }
  T.t(0, "ENDTAB");

  table("STYLE", h.styleT, 1);
  rec("STYLE", h.style, h.styleT, "AcDbTextStyleTableRecord", "Standard");
  T.t(40, 0); T.t(41, 1); T.t(50, 0); T.t(71, 0); T.t(42, 2.5); T.t(3, "txt"); T.t(4, "");
  T.t(0, "ENDTAB");

  table("VIEW", h.viewT, 0); T.t(0, "ENDTAB");
  table("UCS", h.ucsT, 0); T.t(0, "ENDTAB");

  table("APPID", h.appidT, 1);
  rec("APPID", h.appid, h.appidT, "AcDbRegAppTableRecord", "ACAD");
  T.t(0, "ENDTAB");

  table("DIMSTYLE", h.dimT, 1, "AcDbDimStyleTable");
  rec("DIMSTYLE", h.dim, h.dimT, "AcDbDimStyleTableRecord", "Standard", 105);
  T.t(340, h.style);
  T.t(0, "ENDTAB");

  table("BLOCK_RECORD", h.brT, 2);
  rec("BLOCK_RECORD", h.brModel, h.brT, "AcDbBlockTableRecord", "*Model_Space"); T.a.splice(T.a.length - 2, 2);
  rec("BLOCK_RECORD", h.brPaper, h.brT, "AcDbBlockTableRecord", "*Paper_Space"); T.a.splice(T.a.length - 2, 2);
  T.t(0, "ENDTAB");

  // ---- blocks
  const B = tagger();
  for (const [nm, bh, eh, br, ps] of [["*Model_Space", h.blkModel, h.endModel, h.brModel, false], ["*Paper_Space", h.blkPaper, h.endPaper, h.brPaper, true]]) {
    B.t(0, "BLOCK"); B.t(5, bh); B.t(330, br); B.t(100, "AcDbEntity"); if (ps) B.t(67, 1); B.t(8, "0");
    B.t(100, "AcDbBlockBegin"); B.t(2, nm); B.t(70, 0); B.t(10, 0); B.t(20, 0); B.t(30, 0); B.t(3, nm); B.t(1, "");
    B.t(0, "ENDBLK"); B.t(5, eh); B.t(330, br); B.t(100, "AcDbEntity"); if (ps) B.t(67, 1); B.t(8, "0"); B.t(100, "AcDbBlockEnd");
  }

  // ---- header (last, so $HANDSEED is past every handle issued)
  const HD = tagger();
  const hv = (n, ...cv) => { HD.t(9, n); for (let i = 0; i < cv.length; i += 2) HD.t(cv[i], cv[i + 1]); };
  hv("$ACADVER", 1, "AC1015");
  hv("$DWGCODEPAGE", 3, "ANSI_1252");
  hv("$INSBASE", 10, 0, 20, 0, 30, 0);
  hv("$EXTMIN", 10, dxNum(x0), 20, dxNum(y0), 30, 0);
  hv("$EXTMAX", 10, dxNum(x1), 20, dxNum(y1), 30, 0);
  hv("$LIMMIN", 10, 0, 20, 0);
  hv("$LIMMAX", 10, dxNum(((scene && scene.size && scene.size[0]) || 420) * k), 20, dxNum(((scene && scene.size && scene.size[1]) || 297) * k));
  hv("$LTSCALE", 40, 1);
  hv("$CELWEIGHT", 370, -1);
  hv("$LWDISPLAY", 290, 1);
  hv("$INSUNITS", 70, U.code);
  hv("$MEASUREMENT", 70, U.code === 1 || U.code === 2 ? 0 : 1);
  if (name) hv("$PROJECTNAME", 1, dxUni(String(name)).slice(0, 250));
  const dictRoot = h.dictRoot, dictGroup = h.dictGroup;
  hv("$HANDSEED", 5, hs.toString(16).toUpperCase());

  const out = [];
  const section = (nm, body) => { out.push("  0", "SECTION", "  2", nm, ...body, "  0", "ENDSEC"); };
  section("HEADER", HD.a);
  section("CLASSES", []);
  section("TABLES", T.a);
  section("BLOCKS", B.a);
  section("ENTITIES", E.a);
  section("OBJECTS", ["  0", "DICTIONARY", "  5", dictRoot, "330", "0", "100", "AcDbDictionary", "281", "1", "  3", "ACAD_GROUP", "350", dictGroup,
    "  0", "DICTIONARY", "  5", dictGroup, "330", dictRoot, "100", "AcDbDictionary", "281", "1"]);
  out.push("  0", "EOF");
  return { text: out.join("\r\n") + "\r\n", report };
}

// ---------------------------------------------------------------- reader: low level

function dxRecords(pairs) {                        // split a section's pairs at every code 0
  const recs = [];
  for (const [c, v] of pairs) {
    if (c === 0) recs.push({ type: v.trim().toUpperCase(), g: [] });
    else if (recs.length) recs[recs.length - 1].g.push([c, v]);
  }
  return recs;
}
const dxGet = (r, c) => { for (const x of r.g) if (x[0] === c) return x[1]; return undefined; };
const dxF = (r, c, d = 0) => { const v = dxGet(r, c); const n = v === undefined ? NaN : parseFloat(v); return Number.isFinite(n) ? n : d; };
const dxI = (r, c, d = 0) => { const v = dxGet(r, c); const n = v === undefined ? NaN : parseInt(v, 10); return Number.isFinite(n) ? n : d; };

/** Attach VERTEX…SEQEND to POLYLINE and ATTRIB…SEQEND to INSERT. */
function dxNest(recs) {
  const out = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === "POLYLINE" || r.type === "INSERT") {
      r.subs = [];
      while (i + 1 < recs.length && (recs[i + 1].type === "VERTEX" || recs[i + 1].type === "ATTRIB")) r.subs.push(recs[++i]);
      if (i + 1 < recs.length && recs[i + 1].type === "SEQEND") i++;
    } else if (r.type === "SEQEND" || r.type === "VERTEX") continue;
    out.push(r);
  }
  return out;
}

// affine 2D: [a,b,c,d,e,f] → x' = a x + c y + e, y' = b x + d y + f
const dxId = [1, 0, 0, 1, 0, 0];
const dxAp = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const dxLin = (m, p) => [m[0] * p[0] + m[2] * p[1], m[1] * p[0] + m[3] * p[1]];
const dxMul = (A, Bm) => [A[0] * Bm[0] + A[2] * Bm[1], A[1] * Bm[0] + A[3] * Bm[1], A[0] * Bm[2] + A[2] * Bm[3], A[1] * Bm[2] + A[3] * Bm[3],
  A[0] * Bm[4] + A[2] * Bm[5] + A[4], A[1] * Bm[4] + A[3] * Bm[5] + A[5]];

function dxExtrusion(r) { return [dxF(r, 210, 0), dxF(r, 220, 0), dxF(r, 230, 1)]; }
const dxCross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dxNorm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** OCS → WCS (projected onto the XY plane) by the arbitrary-axis algorithm; `elev` is the OCS z. */
function dxOcs(N, elev = 0) {
  N = dxNorm3(N);
  if (Math.abs(N[0]) < 1e-12 && Math.abs(N[1]) < 1e-12 && N[2] > 0 && !elev) return dxId;
  const Ax = dxNorm3(Math.abs(N[0]) < 1 / 64 && Math.abs(N[1]) < 1 / 64 ? dxCross3([0, 1, 0], N) : dxCross3([0, 0, 1], N));
  const Ay = dxNorm3(dxCross3(N, Ax));
  return [Ax[0], Ax[1], Ay[0], Ay[1], N[0] * elev, N[1] * elev];
}

/** Circular arc as cubic Béziers (≤ 90° per piece). */
function dxArcBez(c, r, a0, a1) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9)), out = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n, q = 4 / 3 * Math.tan((t1 - t0) / 4);
    const p0 = [Math.cos(t0), Math.sin(t0)], p3 = [Math.cos(t1), Math.sin(t1)];
    const u = [p0, [p0[0] - q * p0[1], p0[1] + q * p0[0]], [p3[0] + q * p3[1], p3[1] - q * p3[0]], p3].map(p => [c[0] + r * p[0], c[1] + r * p[1]]);
    out.push({ k: "C", a: u[0], c1: u[1], c2: u[2], b: u[3] });
  }
  return out;
}
/** Ellipse c + cos t·M + sin t·m for t0→t1 as Béziers (exact affine image of the circle fit). */
function dxEllBez(c, M, m, t0, t1) {
  return dxArcBez([0, 0], 1, t0, t1).map(s => {
    const f = p => [c[0] + p[0] * M[0] + p[1] * m[0], c[1] + p[0] * M[1] + p[1] * m[1]];
    return { k: "C", a: f(s.a), c1: f(s.c1), c2: f(s.c2), b: f(s.b) };
  });
}
/** Transform one segment by an affine map. Arcs stay arcs under similarities (mirrors flip the sweep). */
function dxTSeg(m, s) {
  if (s.k === "L") return [{ k: "L", a: dxAp(m, s.a), b: dxAp(m, s.b) }];
  if (s.k === "C") return [{ k: "C", a: dxAp(m, s.a), c1: dxAp(m, s.c1), c2: dxAp(m, s.c2), b: dxAp(m, s.b) }];
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]), det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(sx - sy) <= 1e-9 * Math.max(sx, sy) && Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-9 * sx * sy && sx > 0) {
    const d = dxLin(m, [Math.cos(s.a0), Math.sin(s.a0)]), a0 = Math.atan2(d[1], d[0]);
    return [{ k: "A", c: dxAp(m, s.c), r: s.r * sx, a0, a1: a0 + (s.a1 - s.a0) * Math.sign(det) }];
  }
  return dxArcBez(s.c, s.r, s.a0, s.a1).map(b => dxTSeg(m, b)[0]);
}
const dxTPath = (m, path) => path.flatMap(s => dxTSeg(m, s));

/** Vertices with bulges → segments (bulge = tan(θ/4), positive CCW). */
function dxBulgePath(pts, bulges, closed) {
  const out = [], n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n], bu = bulges[i] || 0;
    if (near(a, b, 1e-12)) continue;
    if (Math.abs(bu) < 1e-12) { out.push({ k: "L", a, b }); continue; }
    const dx = b[0] - a[0], dy = b[1] - a[1], f = (1 - bu * bu) / (4 * bu);
    const c = [(a[0] + b[0]) / 2 - dy * f, (a[1] + b[1]) / 2 + dx * f];
    const r = Math.hypot(a[0] - c[0], a[1] - c[1]), a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    out.push({ k: "A", c, r, a0, a1: a0 + 4 * Math.atan(bu) });
  }
  return out;
}

/** NURBS → path. Each knot span is converted separately: degree ≤ 3 polynomial spans
 *  exactly (cubic through 4 evaluated points), rational / higher degree in 4 sub-pieces. */
function dxSplinePath(p, U, P, W) {
  const n = P.length;
  if (n < 2) return [];
  if (!(p >= 1)) p = Math.min(3, n - 1);
  if (U.length !== n + p + 1) {                    // missing/invalid knots → clamped uniform
    U = []; for (let i = 0; i <= n + p; i++) U.push(i <= p ? 0 : i >= n ? n - p : i - p);
  }
  const rational = W && W.length === n && W.some(w => Math.abs(w - 1) > 1e-12);
  const ev = (kspan, t) => {
    const d = [];
    for (let j = 0; j <= p; j++) { const q = P[j + kspan - p], w = rational ? W[j + kspan - p] : 1; d.push([q[0] * w, q[1] * w, w]); }
    for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
      const i = j + kspan - p, den = U[i + p - r + 1] - U[i], al = den === 0 ? 0 : (t - U[i]) / den;
      d[j] = [d[j - 1][0] * (1 - al) + d[j][0] * al, d[j - 1][1] * (1 - al) + d[j][1] * al, d[j - 1][2] * (1 - al) + d[j][2] * al];
    }
    return [d[p][0] / d[p][2], d[p][1] / d[p][2]];
  };
  const out = [];
  if (p === 1 && !rational) { for (let i = 0; i < n - 1; i++) if (!near(P[i], P[i + 1], 1e-12)) out.push({ k: "L", a: P[i], b: P[i + 1] }); return out; }
  const sub = rational || p > 3 ? 4 : 1;
  for (let ks = p; ks < n; ks++) {
    const u0 = U[ks], u1 = U[ks + 1];
    if (!(u1 > u0)) continue;
    for (let q = 0; q < sub; q++) {
      const t0 = u0 + (u1 - u0) * q / sub, t1 = u0 + (u1 - u0) * (q + 1) / sub;
      const B0 = ev(ks, t0), B3 = ev(ks, t1), Q1 = ev(ks, t0 + (t1 - t0) / 3), Q2 = ev(ks, t0 + 2 * (t1 - t0) / 3);
      const u = [27 * Q1[0] - 8 * B0[0] - B3[0], 27 * Q1[1] - 8 * B0[1] - B3[1]];
      const w = [27 * Q2[0] - B0[0] - 8 * B3[0], 27 * Q2[1] - B0[1] - 8 * B3[1]];
      out.push({ k: "C", a: B0, c1: [(2 * u[0] - w[0]) / 18, (2 * u[1] - w[1]) / 18], c2: [(2 * w[0] - u[0]) / 18, (2 * w[1] - u[1]) / 18], b: B3 });
    }
  }
  return out;
}

/** TEXT/ATTRIB control codes (%%d, %%c, %%p, %%u) and \U+XXXX. */
function dxPlainText(s) {
  return String(s ?? "").replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%([dcpDCPuUoO%])/g, (_, c) => ({ d: "°", c: "Ø", p: "±", "%": "%" })[c.toLowerCase()] ?? "");
}
/** MTEXT inline formatting stripped to plain text (\P → newline, stacks → a/b). */
function dxMText(s) {
  let o = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      const n = s[i + 1];
      if (n === "P" || n === "n") { o += "\n"; i++; }
      else if (n === "~") { o += " "; i++; }
      else if (n === "\\" || n === "{" || n === "}") { o += n; i++; }
      else if (n === "U" && s[i + 2] === "+") { o += String.fromCharCode(parseInt(s.substr(i + 3, 4), 16)); i += 6; }
      else if (n && "LlOoKk".includes(n)) i++;
      else if (n === "S") { const e = s.indexOf(";", i); o += s.slice(i + 2, e < 0 ? s.length : e).replace(/[\^#]/, "/"); i = e < 0 ? s.length : e; }
      else { const e = s.indexOf(";", i); i = e < 0 ? s.length : e; }
    } else if (ch !== "{" && ch !== "}") o += ch;
  }
  return dxPlainText(o);
}

/** HATCH boundary loops (OCS) → one path of closed subpaths. */
function dxHatchLoops(r) {
  const g = r.g;
  let i = g.findIndex(x => x[0] === 91);
  if (i < 0) return [];
  const num = () => parseFloat(g[i++][1]);
  const take = c => (i < g.length && g[i][0] === c ? parseFloat(g[i++][1]) : undefined);
  const nLoops = num() | 0, path = [];
  for (let L = 0; L < nLoops && i < g.length; L++) {
    const flags = take(92) | 0, loop = [];
    if (flags & 2) {
      const hasB = take(72) | 0, closed = take(73), nv = take(93) | 0, pts = [], bs = [];
      for (let v = 0; v < nv; v++) { const x = take(10), y = take(20); const b = take(42); pts.push([x, y]); bs.push(hasB ? b || 0 : 0); }
      void closed; loop.push(...dxBulgePath(pts, bs, true));   // hatch loops are closed whatever 73 says
    } else {
      const ne = take(93) | 0;
      for (let e = 0; e < ne; e++) {
        const t = take(72) | 0;
        if (t === 1) { const a = [take(10), take(20)], b = [take(11), take(21)]; loop.push({ k: "L", a, b }); }
        else if (t === 2 || t === 3) {
          const c = [take(10), take(20)];
          const M = t === 3 ? [take(11), take(21)] : null;
          const rr = take(40), s = take(50), en = take(51), ccw = take(73);
          let a0, a1;
          if (ccw === 0) { a0 = -dxRad(s); a1 = -dxRad(en); if (a1 >= a0) a1 -= TAU; }
          else { a0 = dxRad(s); a1 = dxRad(en); if (a1 <= a0) a1 += TAU; }
          if (t === 2) loop.push({ k: "A", c, r: rr, a0, a1 });
          else loop.push(...dxEllBez(c, M, [-M[1] * rr, M[0] * rr], a0, a1));
        } else if (t === 4) {
          const deg = take(94) | 0, rat = take(73) | 0; take(74);
          const nk = take(95) | 0, nc = take(96) | 0, K = [], C = [], W = [];
          for (let q = 0; q < nk; q++) K.push(take(40));
          for (let q = 0; q < nc; q++) { C.push([take(10), take(20)]); if (rat) W.push(take(42) ?? 1); }
          // R2010+ fit data: 97 n + 11/21… + 12/22 13/23. A trailing 97 on the last edge
          // with no fit points after it is the loop's source-object count, not fit data.
          if (i < g.length && g[i][0] === 97 && (e < ne - 1 || (g[i + 1] && (g[i + 1][0] === 11 || g[i + 1][0] === 97)))) {
            const nf = take(97) | 0; for (let q = 0; q < nf; q++) { take(11); take(21); }
            if (take(12) !== undefined) take(22); if (take(13) !== undefined) take(23);
          }
          loop.push(...dxSplinePath(deg, K, C, rat ? W : null));
        } else break;
      }
    }
    const ns = take(97) | 0; for (let q = 0; q < ns; q++) take(330);
    if (loop.length) {
      const e0 = segEnd(loop[loop.length - 1]), s0 = segStart(loop[0]);
      if (!near(e0, s0, 1e-9)) loop.push({ k: "L", a: e0, b: s0 });
      path.push(...loop);
    }
  }
  return path;
}

// ---------------------------------------------------------------- reader

/** DXF text → paths / texts / fills in millimetres, plus a manifest of what was skipped. */
export function readDXF(text, { askUnits } = {}) {
  const res = { units: null, insunits: null, needsUnits: false, paths: [], texts: [], fills: [], bbox: null,
    manifest: { imported: 0, skipped: {} }, message: "" };
  const src = String(text ?? "");
  if (src.startsWith("AutoCAD Binary DXF")) { res.message = "binary DXF is not supported; save as ASCII DXF"; return res; }

  const lines = src.split(/\r\n|\r|\n/), pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(c)) { i--; continue; }        // resynchronise on a stray blank line
    pairs.push([c, lines[i + 1].replace(/\s+$/, "")]);
  }
  const sections = {};
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1].trim() === "SECTION" && pairs[i + 1] && pairs[i + 1][0] === 2) {
      const nm = pairs[i + 1][1].trim().toUpperCase(), body = [];
      for (i += 2; i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1].trim() === "ENDSEC"); i++) body.push(pairs[i]);
      sections[nm] = body;
    }
  }

  // header: only $INSUNITS matters here
  const hdr = {};
  let cur = null;
  for (const [c, v] of sections.HEADER || []) { if (c === 9) { cur = v.trim(); hdr[cur] = []; } else if (cur) hdr[cur].push([c, v]); }
  const iu = hdr.$INSUNITS && hdr.$INSUNITS.length ? parseInt(hdr.$INSUNITS[0][1], 10) : null;
  res.insunits = Number.isFinite(iu) ? iu : null;

  // blocks
  const blocks = new Map();
  let blk = null;
  for (const r of dxRecords(sections.BLOCKS || [])) {
    if (r.type === "BLOCK") { blk = { base: [dxF(r, 10), dxF(r, 20)], recs: [] }; blocks.set(String(dxGet(r, 2) ?? "").trim().toUpperCase(), blk); }
    else if (r.type === "ENDBLK") blk = null;
    else if (blk) blk.recs.push(r);
  }
  for (const b of blocks.values()) b.ents = dxNest(b.recs);

  const skipped = res.manifest.skipped;
  const skip = t => { skipped[t] = (skipped[t] || 0) + 1; };
  const layerOf = (r, inherit) => { const l = String(dxGet(r, 8) ?? "0").trim() || "0"; return l === "0" && inherit ? inherit : l; };

  const addPath = (path, layer) => { if (path.length) { res.paths.push({ path, layer }); return true; } return false; };
  const addText = (r, m, at, text, height, rotDeg, layer, align) => {
    const w = dxAp(m, at), d = dxLin(m, [Math.cos(dxRad(rotDeg)), Math.sin(dxRad(rotDeg))]);
    const up = dxLin(m, [-Math.sin(dxRad(rotDeg)), Math.cos(dxRad(rotDeg))]), dl = Math.hypot(d[0], d[1]) || 1;
    const hs = Math.abs(d[0] * up[1] - d[1] * up[0]) / dl;
    res.texts.push({ at: w, text, height: height * hs, rot: dxDeg(Math.atan2(d[1], d[0])), layer, align });
    return true;
  };

  const emit = (r, m, inherit, stack) => {
    const layer = layerOf(r, inherit);
    let ok = false;
    switch (r.type) {
      case "LINE":
        ok = addPath(dxTPath(m, [{ k: "L", a: [dxF(r, 10), dxF(r, 20)], b: [dxF(r, 11), dxF(r, 21)] }]), layer); break;
      case "CIRCLE": case "ARC": {
        const mm = dxMul(m, dxOcs(dxExtrusion(r), dxF(r, 30)));
        let a0 = 0, a1 = TAU;
        if (r.type === "ARC") { a0 = dxRad(dxF(r, 50)); a1 = dxRad(dxF(r, 51)); while (a1 <= a0) a1 += TAU; }
        ok = addPath(dxTPath(mm, [{ k: "A", c: [dxF(r, 10), dxF(r, 20)], r: dxF(r, 40), a0, a1 }]), layer); break;
      }
      case "LWPOLYLINE": {
        const pts = [], bs = [];
        for (const [c, v] of r.g) {
          if (c === 10) { pts.push([parseFloat(v), 0]); bs.push(0); }
          else if (c === 20 && pts.length) pts[pts.length - 1][1] = parseFloat(v);
          else if (c === 42 && pts.length) bs[bs.length - 1] = parseFloat(v);
        }
        const mm = dxMul(m, dxOcs(dxExtrusion(r), dxF(r, 38)));
        ok = addPath(dxTPath(mm, dxBulgePath(pts, bs, (dxI(r, 70) & 1) === 1)), layer); break;
      }
      case "POLYLINE": {
        const fl = dxI(r, 70);
        if (fl & (16 | 64)) { skip("POLYLINE (mesh)"); return; }
        const vs = (r.subs || []).filter(v => v.type === "VERTEX" && !(dxI(v, 70) & 16));
        const mm = fl & 8 ? m : dxMul(m, dxOcs(dxExtrusion(r), dxF(r, 30)));
        ok = addPath(dxTPath(mm, dxBulgePath(vs.map(v => [dxF(v, 10), dxF(v, 20)]), vs.map(v => dxF(v, 42)), (fl & 1) === 1)), layer); break;
      }
      case "ELLIPSE": {
        const N = dxExtrusion(r), c = [dxF(r, 10), dxF(r, 20)], M3 = [dxF(r, 11), dxF(r, 21), dxF(r, 31)], ratio = dxF(r, 40, 1);
        const m3 = dxCross3(dxNorm3(N), M3), M = [M3[0], M3[1]], mi = [m3[0] * ratio, m3[1] * ratio];
        let t0 = dxF(r, 41, 0), t1 = dxF(r, 42, TAU); while (t1 <= t0 + 1e-12) t1 += TAU;
        const nz = dxNorm3(N)[2];
        let seg;
        if (Math.abs(ratio - 1) < 1e-9 && Math.abs(Math.abs(nz) - 1) < 1e-9) {
          const phi = Math.atan2(M[1], M[0]), sg = Math.sign(nz);
          seg = [{ k: "A", c, r: Math.hypot(M[0], M[1]), a0: phi + sg * t0, a1: phi + sg * t1 }];
        } else seg = dxEllBez(c, M, mi, t0, t1);
        ok = addPath(dxTPath(m, seg), layer); break;
      }
      case "SPLINE": {
        const C = [], F = [], K = [], W = [];
        for (const [c, v] of r.g) {
          if (c === 10) C.push([parseFloat(v), 0]); else if (c === 20 && C.length) C[C.length - 1][1] = parseFloat(v);
          else if (c === 11) F.push([parseFloat(v), 0]); else if (c === 21 && F.length) F[F.length - 1][1] = parseFloat(v);
          else if (c === 40) K.push(parseFloat(v)); else if (c === 41) W.push(parseFloat(v));
        }
        let seg;
        if (C.length >= 2) seg = dxSplinePath(dxI(r, 71, 3), K, C, W.length ? W : null);
        else { seg = []; for (let i = 0; i + 1 < F.length; i++) seg.push({ k: "L", a: F[i], b: F[i + 1] }); }
        ok = addPath(dxTPath(m, seg), layer); break;
      }
      case "TEXT": case "ATTRIB": {
        if (r.type === "ATTRIB" && (dxI(r, 70) & 1)) return;
        const mm = dxMul(m, dxOcs(dxExtrusion(r), dxF(r, 30)));
        const h72 = dxI(r, 72), v73 = dxI(r, 74 - (r.type === "ATTRIB" ? 0 : 1));
        const useSecond = (h72 || v73) && dxGet(r, 11) !== undefined;
        const at = useSecond ? [dxF(r, 11), dxF(r, 21)] : [dxF(r, 10), dxF(r, 20)];
        ok = addText(r, mm, at, dxPlainText(dxGet(r, 1)), dxF(r, 40, 2.5), dxF(r, 50), layer,
          h72 === 1 || h72 === 4 ? "centre" : h72 === 2 ? "right" : "left"); break;
      }
      case "MTEXT": {
        let body = ""; for (const [c, v] of r.g) if (c === 3) body += v; body += dxGet(r, 1) ?? "";
        let rot = dxF(r, 50);
        if (dxGet(r, 11) !== undefined) rot = dxDeg(Math.atan2(dxF(r, 21), dxF(r, 11)));
        const at71 = dxI(r, 71, 1), col = (at71 - 1) % 3;
        ok = addText(r, m, [dxF(r, 10), dxF(r, 20)], dxMText(body), dxF(r, 40, 2.5), rot, layer, col === 1 ? "centre" : col === 2 ? "right" : "left"); break;
      }
      case "HATCH": {
        let elev = 0; const i10 = r.g.findIndex(x => x[0] === 30); if (i10 >= 0) elev = parseFloat(r.g[i10][1]) || 0;
        const mm = dxMul(m, dxOcs(dxExtrusion(r), elev));
        const path = dxTPath(mm, dxHatchLoops(r));
        if (path.length) { res.fills.push({ path, layer }); ok = true; } break;
      }
      case "SOLID": case "TRACE": {
        const mm = dxMul(m, dxOcs(dxExtrusion(r), dxF(r, 30)));
        const q = [10, 11, 12, 13].map(c => [dxF(r, c), dxF(r, c + 10)]);
        const pts = near(q[2], q[3], 1e-12) ? [q[0], q[1], q[2]] : [q[0], q[1], q[3], q[2]];
        const path = dxTPath(mm, dxBulgePath(pts, [], true));
        if (path.length) { res.fills.push({ path, layer }); ok = true; } break;
      }
      case "INSERT": case "DIMENSION": {
        const nm = String(dxGet(r, 2) ?? "").trim().toUpperCase(), b = blocks.get(nm);
        if (!b || stack.includes(nm) || stack.length > 32) { skip(r.type + (b ? " (recursive)" : " (missing block)")); return; }
        if (r.type === "DIMENSION") { for (const e of b.ents) emit(e, m, layer, stack.concat(nm)); return; }
        const mo = dxMul(m, dxOcs(dxExtrusion(r), dxF(r, 30)));
        const sx = dxF(r, 41, 1), sy = dxF(r, 42, 1), rot = dxRad(dxF(r, 50)), cs = Math.cos(rot), sn = Math.sin(rot);
        const cols = Math.max(1, dxI(r, 70, 1)), rows = Math.max(1, dxI(r, 71, 1)), dc = dxF(r, 44), dr = dxF(r, 45);
        const ins = [dxF(r, 10), dxF(r, 20)];
        for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
          const off = [ci * dc * cs - ri * dr * sn, ci * dc * sn + ri * dr * cs];
          const local = [cs * sx, sn * sx, -sn * sy, cs * sy, 0, 0];
          const t0 = dxAp(local, b.base);
          local[4] = ins[0] + off[0] - t0[0]; local[5] = ins[1] + off[1] - t0[1];
          const mm = dxMul(mo, local);
          for (const e of b.ents) emit(e, mm, layer, stack.concat(nm));
        }
        for (const a of r.subs || []) emit(a, m, inherit, stack);
        return;
      }
      default: skip(r.type); return;
    }
    if (ok) res.manifest.imported++;
  };

  const ents = dxNest(dxRecords(sections.ENTITIES || []));
  const model = ents.filter(r => dxI(r, 67) !== 1), paperEnts = ents.filter(r => dxI(r, 67) === 1);
  const useModel = model.length > 0;
  for (const r of useModel ? model : paperEnts) emit(r, dxId, null, []);
  if (useModel) for (const r of paperEnts) skip(r.type + " (paper space)");

  // ---- units: decided once, applied once
  let f = 1;
  if (res.insunits && dxUnitCodes[res.insunits]) { res.units = dxUnitCodes[res.insunits][0]; f = dxUnitCodes[res.insunits][1]; }
  else {
    const ans = typeof askUnits === "function" ? askUnits({ insunits: res.insunits, bbox: dxBBox(res) }) : null;
    if (ans && dxUnitByName[ans]) { res.units = ans; f = dxUnitByName[ans].f; }
    else res.needsUnits = true;
  }
  if (f !== 1) dxScaleAll(res, f);
  res.bbox = dxBBox(res);

  const n = res.manifest.imported, sk = Object.entries(skipped).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const ns = sk.reduce((s, e) => s + e[1], 0);
  res.message = `imported ${n} ${n === 1 ? "entity" : "entities"}, skipped ${ns}` + (ns ? ` (${sk.map(([t, c]) => `${c} × ${t}`).join(", ")})` : "")
    + (res.needsUnits ? "; drawing units unknown ($INSUNITS missing) — coordinates not scaled" : "");
  return res;
}

function dxScaleAll(res, f) {
  const sp = p => [p[0] * f, p[1] * f];
  const ss = s => s.k === "L" ? { k: "L", a: sp(s.a), b: sp(s.b) } : s.k === "A" ? { k: "A", c: sp(s.c), r: s.r * f, a0: s.a0, a1: s.a1 }
    : { k: "C", a: sp(s.a), c1: sp(s.c1), c2: sp(s.c2), b: sp(s.b) };
  for (const p of res.paths) p.path = p.path.map(ss);
  for (const p of res.fills) p.path = p.path.map(ss);
  for (const t of res.texts) { t.at = sp(t.at); t.height *= f; }
}

/** Exact bounds: arc extremes at cardinal angles, Bézier extremes at derivative roots. */
function dxBBox(res) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const g = p => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
  const seg = s => {
    g(segStart(s)); g(segEnd(s));
    if (s.k === "A") {
      const lo = Math.min(s.a0, s.a1), hi = Math.max(s.a0, s.a1);
      for (let q = Math.ceil(lo / (Math.PI / 2)); q * Math.PI / 2 <= hi; q++) g([s.c[0] + s.r * Math.cos(q * Math.PI / 2), s.c[1] + s.r * Math.sin(q * Math.PI / 2)]);
    } else if (s.k === "C") {
      for (const ax of [0, 1]) {
        const p0 = s.a[ax], p1 = s.c1[ax], p2 = s.c2[ax], p3 = s.b[ax];
        const A = -p0 + 3 * p1 - 3 * p2 + p3, B = 2 * (p0 - 2 * p1 + p2), C = p1 - p0;
        const roots = Math.abs(A) < 1e-12 ? (Math.abs(B) < 1e-12 ? [] : [-C / B]) : (() => {
          const D = B * B - 4 * A * C; if (D < 0) return []; const q = Math.sqrt(D); return [(-B + q) / (2 * A), (-B - q) / (2 * A)];
        })();
        for (const t of roots) if (t > 0 && t < 1) g(bez(s.a, s.c1, s.c2, s.b, t));
      }
    }
  };
  for (const p of res.paths) p.path.forEach(seg);
  for (const p of res.fills) p.path.forEach(seg);
  for (const t of res.texts) g(t.at);
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

// ---------------------------------------------------------------- zip (STORE)

const dxCrcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let q = 0; q < 8; q++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
/** CRC-32 (IEEE, as used by zip) of bytes or a UTF-8 string. */
export function zipCrc32(data) {
  const b = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = dxCrcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** [{name, data}] → a .zip (no compression) as Uint8Array. */
export function makeZip(files) {
  const enc = new TextEncoder(), now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const items = files.map(f => {
    const name = enc.encode(String(f.name)), data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    return { name, data, crc: zipCrc32(data), utf8: /[^\x20-\x7e]/.test(String(f.name)) };
  });
  const size = items.reduce((s, it) => s + 30 + it.name.length + it.data.length + 46 + it.name.length, 22);
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  let o = 0;
  const u16 = v => { dv.setUint16(o, v, true); o += 2; }, u32 = v => { dv.setUint32(o, v >>> 0, true); o += 4; };
  for (const it of items) {
    it.off = o;
    u32(0x04034b50); u16(20); u16(it.utf8 ? 0x0800 : 0); u16(0); u16(dosTime); u16(dosDate);
    u32(it.crc); u32(it.data.length); u32(it.data.length); u16(it.name.length); u16(0);
    out.set(it.name, o); o += it.name.length; out.set(it.data, o); o += it.data.length;
  }
  const cd = o;
  for (const it of items) {
    u32(0x02014b50); u16(20); u16(20); u16(it.utf8 ? 0x0800 : 0); u16(0); u16(dosTime); u16(dosDate);
    u32(it.crc); u32(it.data.length); u32(it.data.length); u16(it.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(it.off);
    out.set(it.name, o); o += it.name.length;
  }
  const cdSize = o - cd;
  u32(0x06054b50); u16(0); u16(0); u16(items.length); u16(items.length); u32(cdSize); u32(cd); u16(0);
  return out;
}
