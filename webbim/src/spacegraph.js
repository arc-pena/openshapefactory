//! Space Graph: a building's interior as a graph first and geometry second. Nodes are the spaces a
//! brief asks for (name, area, department, whether they need a facade, their width-to-depth range,
//! their level); edges are the adjacencies between them, weighted, or marked "keep apart". The graph
//! is relaxed as a bubble diagram; the bubbles' arrangement orders the spaces along a circulation
//! spine inside a footprint set back from the site; the packed layout becomes walls, floor, rooms and
//! doors in the document - generated, and regenerated whenever the graph changes.
//!
//! Identity lives in the graph, not the geometry: a packed layout is a sequence of slots per strip,
//! and a node owns a slot. Swapping two nodes swaps their slots; every slot's width then follows its
//! new node's area and the strip shifts to fit - "rename the room, update its width, move the rest".

import { add, sub, mul, dot, dist, normalise, perp, lerp, polyArea, pointInPoly } from "./geom2d.js";
import { simplifyLoop, offsetLoop, clipStrip } from "./massing.js";

// ---------------------------------------------------------------- program in
/** Header words a program sheet uses for each field, lower case. */
const SG_HEADERS = {
  name: ["name", "room", "space", "room name", "space name", "description", "function", "use"],
  number: ["number", "no", "no.", "room no", "room number", "ref", "id", "code"],
  area: ["area", "area m2", "area (m2)", "area m²", "area (m²)", "nia", "gia", "nfa", "size", "net area", "m2", "m²", "sqm"],
  qty: ["qty", "quantity", "count", "no. of", "number of", "nr", "units"],
  dept: ["department", "dept", "zone", "group", "category", "type", "block", "cluster"],
  facade: ["facade", "façade", "daylight", "window", "natural light", "external", "perimeter", "view"],
  adj: ["adjacent", "adjacent to", "adjacency", "adjacencies", "near", "next to", "connect", "connects to", "relationships"],
  avoid: ["avoid", "separate from", "away from", "not adjacent", "keep apart"],
  minWidth: ["min width", "minimum width", "width min", "min w"],
  ratio: ["ratio", "proportion", "aspect", "w:d", "width:depth", "facade ratio", "facade to depth"],
  level: ["level", "floor", "storey", "story"],
  zone: ["circulation", "kind", "class", "space type"],
};
const SG_YES = /^(y|yes|true|x|✓|✔|●|1|required|req|must)$/i;
const sgNum = v => { if (typeof v === "number") return v; const m = String(v ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : NaN; };
/** Which column holds which field, from the header row. */
export function programColumns(header) {
  const cols = {}, norm = header.map(h0 => String(h0 ?? "").trim().toLowerCase().replace(/\s+/g, " "));
  for (const [field, words] of Object.entries(SG_HEADERS)) {
    let at = norm.findIndex(h0 => words.includes(h0));
    if (at < 0) at = norm.findIndex(h0 => words.some(w => w.length > 3 && h0.includes(w)));
    if (at >= 0 && !Object.values(cols).includes(at)) cols[field] = at;
  }
  return cols;
}
/** The kind of space a row is, from its zone column or its name. */
function sgZoneOf(name, dept, zone) {
  const s = `${zone || ""} ${dept || ""} ${name || ""}`.toLowerCase();
  if (/corridor|circulation|lift lobby|stair|landing|hallway|passage/.test(s)) return "Circulation";
  if (/entr|lobby|reception|foyer|arrival/.test(s)) return "Entry";
  if (/back of house|boh|plant|store|storage|service|kitchen|loading|refuse|bin|cleaner|wc|toilet|shower|changing|server|riser|comms/.test(s)) return "BOH";
  return "Room";
}
/** Spaces needing a facade by default: rooms people stay in. Back of house and circulation do not. */
const sgFacadeDefault = zone => zone === "Room" || zone === "Entry";
/**
 * Rows (first row the header) → { nodes, edges, report }. A Qty column makes that many numbered
 * copies; an "Adjacent to" column names other rows (comma, semicolon or slash separated); an
 * adjacency matrix sheet (names across and down) can be passed as `matrix`.
 */
export function programFromRows(rows, matrix = null) {
  const report = [];
  const hi = rows.findIndex(r => r && r.filter(c => String(c ?? "").trim()).length >= 2);
  if (hi < 0) return { nodes: [], edges: [], report: ["no header row found"] };
  const cols = programColumns(rows[hi]);
  if (cols.name === undefined) { cols.name = 0; report.push("no Name column: the first column is taken as the room name"); }
  if (cols.area === undefined) report.push("no Area column: every space is given 20 m²");
  const nodes = [], pending = [];
  let n = 0;
  for (const r of rows.slice(hi + 1)) {
    if (!r) continue;
    const name = String(r[cols.name] ?? "").trim(); if (!name) continue;
    if (/^(total|sub-?total|sum)\b/i.test(name)) continue;
    const area = cols.area !== undefined ? sgNum(r[cols.area]) : 20;
    if (!(area > 0)) { report.push(`${name}: no area, skipped`); continue; }
    const qty = cols.qty !== undefined ? Math.max(1, Math.round(sgNum(r[cols.qty]) || 1)) : 1;
    const dept = cols.dept !== undefined ? String(r[cols.dept] ?? "").trim() : "";
    const zone = sgZoneOf(name, dept, cols.zone !== undefined ? r[cols.zone] : "");
    const facadeCell = cols.facade !== undefined ? String(r[cols.facade] ?? "").trim() : "";
    const facade = facadeCell ? SG_YES.test(facadeCell) : sgFacadeDefault(zone);
    const ratioCell = cols.ratio !== undefined ? String(r[cols.ratio] ?? "") : "";
    const rm = ratioCell.match(/(\d+(?:\.\d+)?)\s*[-–to:]+\s*(\d+(?:\.\d+)?)/);
    const ratio = rm ? [Number(rm[1]), Number(rm[2])].sort((a, b) => a - b) : sgNum(ratioCell) > 0 ? [sgNum(ratioCell) * 0.8, sgNum(ratioCell) * 1.25] : null;
    const minWidth = cols.minWidth !== undefined && sgNum(r[cols.minWidth]) > 0 ? sgNum(r[cols.minWidth]) * (sgNum(r[cols.minWidth]) < 50 ? 1000 : 1) : null;
    const level = cols.level !== undefined ? String(r[cols.level] ?? "").trim() : "";
    const number = cols.number !== undefined ? String(r[cols.number] ?? "").trim() : "";
    const ids = [];
    for (let k = 0; k < qty; k++) {
      const id = "N" + (++n);
      nodes.push({ id, name: qty > 1 ? `${name} ${k + 1}` : name, base: name, number: number ? (qty > 1 ? `${number}.${k + 1}` : number) : "", dept, zone, area, facade, ratio, minWidth, level });
      ids.push(id);
    }
    pending.push({ ids, name, adj: cols.adj !== undefined ? String(r[cols.adj] ?? "") : "", avoid: cols.avoid !== undefined ? String(r[cols.avoid] ?? "") : "" });
  }
  const byName = new Map(); for (const nd of nodes) { const k = nd.base.toLowerCase(); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(nd.id); byName.set(nd.name.toLowerCase(), [nd.id]); }
  const edges = [], seen = new Set();
  const link = (a, b, w) => { if (a === b) return; const k = [a, b].sort().join("|"); if (seen.has(k)) return; seen.add(k); edges.push({ a, b, w }); };
  const resolve = txt => txt.split(/[,;/\n]| and /i).map(s => s.trim()).filter(Boolean).map(s => {
    const strong = /\*|!|\(strong\)|essential|must/i.test(s), key = s.replace(/\*|!|\((strong|weak)\)|essential|must/gi, "").trim().toLowerCase();
    return { ids: byName.get(key) || byName.get(key.replace(/s$/, "")) || [...byName.entries()].find(([k]) => k.startsWith(key) || key.startsWith(k))?.[1] || null, w: strong ? 3 : 2, s };
  });
  for (const p of pending) {
    for (const t of resolve(p.adj)) { if (!t.ids) { report.push(`${p.name}: "${t.s}" is not in the program`); continue; } for (const a of p.ids) link(a, t.ids[0], t.w); }
    for (const t of resolve(p.avoid)) { if (t.ids) for (const a of p.ids) link(a, t.ids[0], -1); }
    // numbered copies of one room sit together
    for (let i = 1; i < p.ids.length; i++) link(p.ids[i - 1], p.ids[i], 1);
  }
  if (matrix) for (const e of adjacencyFromMatrix(matrix, byName)) link(e.a, e.b, e.w);
  return { nodes, edges, report };
}
/** An adjacency matrix: names across the top and down the side; a number (0–3), X/●, or "avoid"/-1. */
export function adjacencyFromMatrix(rows, byName) {
  const out = []; if (!rows || rows.length < 2) return out;
  const top = rows[0].map(c => String(c ?? "").trim().toLowerCase());
  for (const r of rows.slice(1)) {
    const a = byName.get(String(r[0] ?? "").trim().toLowerCase()); if (!a) continue;
    for (let j = 1; j < r.length; j++) {
      const b = byName.get(top[j]); if (!b) continue;
      const c = String(r[j] ?? "").trim(); if (!c) continue;
      const w = /avoid|^-/.test(c.toLowerCase()) ? -1 : SG_YES.test(c) ? 2 : Math.max(-1, Math.min(3, sgNum(c)));
      if (w) out.push({ a: a[0], b: b[0], w });
    }
  }
  return out;
}
/** Is this sheet an adjacency matrix: a square of names across and down? */
export function looksLikeMatrix(rows) {
  if (!rows || rows.length < 3) return false;
  const top = rows[0].slice(1).map(c => String(c ?? "").trim().toLowerCase()).filter(Boolean), side = rows.slice(1).map(r => String((r || [])[0] ?? "").trim().toLowerCase()).filter(Boolean);
  const common = top.filter(t => side.includes(t)).length;
  return common >= Math.min(top.length, side.length) * 0.6 && common >= 2;
}

/**
 * A written brief → the same graph. One space per line, as people write them:
 *   "Reception 40 m2, facade, adjacent to Lobby and Waiting"
 *   "3 x Meeting room 18m²  near Office*; avoid Plant"
 *   "Plant 25 sqm back of house"
 * Area in m² (or sqm, m2); "3 x" or "x3" for copies; "adjacent to / next to / near / connects to"
 * for adjacencies (a * marks a strong one); "avoid / away from" for keep-apart; "facade / daylight" or
 * "internal / no daylight"; "back of house" or "circulation" for the zone; "level 1" / "ground floor".
 */
export function programFromBrief(text) {
  if (looksStructured(String(text || ""))) return programFromStructuredBrief(String(text));
  const rows = [["Name", "Qty", "Area", "Department", "Facade", "Adjacent to", "Avoid", "Level"]];
  let dept = "";
  for (const raw of String(text || "").split(/\n|•|;(?=\s*\d*\s*x?\s*[A-Z])/)) {
    let s = raw.replace(/^[\s\-*–•]+/, "").replace(/^\d+[.)]\s+/, "").trim(); if (!s) continue;
    // a heading line ("Back of house:", "## Offices") sets the department for what follows
    if (/^#+\s*|:$/.test(s) && !/\d\s*(m2|m²|sqm|sq m)/i.test(s)) { dept = s.replace(/^#+\s*|:$/g, "").trim(); continue; }
    const area = s.match(/(\d+(?:\.\d+)?)\s*(m2|m²|sqm|sq\.?\s*m|square metres?)/i); if (!area) continue;
    const qm = s.match(/^(\d+)\s*[x×]\s*/i) || s.match(/\s[x×]\s*(\d+)\b/i);
    const name = s.replace(/^(\d+)\s*[x×]\s*/i, "").split(/\s*[,(]|\s+\d+(\.\d+)?\s*(m2|m²|sqm|sq)/i)[0].replace(/\s[x×]\s*\d+.*$/i, "").trim();
    const grab = re => { const m = s.match(re); return m ? m[1].replace(/\.$/, "").trim() : ""; };
    const adj = grab(/(?:adjacent to|next to|near|close to|connects? to|beside|off|with access to)\s+([^;.]*?)(?=\s*(?:;|\.|avoid|away from|keep apart|facade|daylight|internal|level|floor|$))/i);
    const avoid = grab(/(?:avoid|away from|keep apart from|separate from)\s+([^;.]*?)(?=\s*(?:;|\.|facade|daylight|internal|level|$))/i);
    const facade = /no daylight|internal|no window|interior only/i.test(s) ? "N" : /facade|façade|daylight|window|view|external wall/i.test(s) ? "Y" : "";
    const zoneWord = /back of house|\bboh\b|service/i.test(s) ? "Back of house" : /circulation|corridor/i.test(s) ? "Circulation" : "";
    const level = grab(/\b(?:level|floor)\s+([\w-]+)/i) || (/ground floor/i.test(s) ? "Ground" : "");
    rows.push([name, qm ? qm[1] : 1, area[1], zoneWord || dept, facade, adj, avoid, level]);
  }
  return programFromRows(rows);
}

// ---------------------------------------------------------------- spreadsheets
/** CSV (or tab separated) → rows, quotes honoured. */
export function readCsv(text) {
  const src = String(text || ""), sep = (src.split("\n")[0].match(/\t/g) || []).length > (src.split("\n")[0].match(/,/g) || []).length ? "\t" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
/** An .xlsx workbook → { sheets: [{ name, rows }] }. The zip is read by hand and its deflated parts
 *  inflated with the platform's DecompressionStream: no library, nothing leaves the page. */
export async function readXlsx(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not an .xlsx (no zip directory found)");
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = new Map(), td = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    files.set(name, { method, csize, off });
    p += 46 + nlen + xlen + clen;
  }
  const read = async name => {
    const f = files.get(name); if (!f) return null;
    const lnl = dv.getUint16(f.off + 26, true), lxl = dv.getUint16(f.off + 28, true), start = f.off + 30 + lnl + lxl, data = u8.subarray(start, start + f.csize);
    if (f.method === 0) return td.decode(data);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  };
  const xmlText = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
  const shared = [], ss = await read("xl/sharedStrings.xml");
  if (ss) for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(xmlText((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, "")).join("")));
  const wb = await read("xl/workbook.xml") || "", rels = await read("xl/_rels/workbook.xml.rels") || "";
  const relTarget = new Map((rels.match(/<Relationship\b[^>]*>/g) || []).map(r => [(r.match(/Id="([^"]+)"/) || [])[1], (r.match(/Target="([^"]+)"/) || [])[1]]));
  const sheets = [];
  for (const sh of wb.match(/<sheet\b[^>]*>/g) || []) {
    const name = xmlText((sh.match(/name="([^"]*)"/) || [])[1] || ""), rid = (sh.match(/r:id="([^"]+)"/) || [])[1];
    let target = relTarget.get(rid) || ""; target = target.replace(/^\/?xl\//, ""); const xml = await read("xl/" + target); if (!xml) continue;
    const rows = [];
    for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
      const ri = Number((rowXml.match(/\br="(\d+)"/) || [])[1]) - 1, row = [];
      for (const c of rowXml.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const ref = (c.match(/\br="([A-Z]+)\d+"/) || [])[1] || ""; let col = 0; for (const ch of ref) col = col * 26 + ch.charCodeAt(0) - 64; col -= 1;
        const t = (c.match(/\bt="(\w+)"/) || [])[1], v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1], is = (c.match(/<is>([\s\S]*?)<\/is>/) || [])[1];
        let val = t === "s" ? shared[Number(v)] : t === "inlineStr" ? xmlText((is || "").replace(/<[^>]+>/g, "")) : t === "str" || t === "e" ? xmlText(v || "") : v !== undefined ? Number(v) : "";
        if (typeof val === "number" && !Number.isFinite(val)) val = "";
        row[col >= 0 ? col : row.length] = val;
      }
      rows[ri >= 0 ? ri : rows.length] = Array.from(row, x => x ?? "");
    }
    sheets.push({ name, rows: Array.from(rows, r => r || []) });
  }
  return { sheets };
}
/** A workbook → the program: the sheet that reads as a program, and a matrix sheet if there is one. */
export function programFromWorkbook(wb) {
  const matrix = wb.sheets.find(s => looksLikeMatrix(s.rows));
  const cands = wb.sheets.filter(s => s !== matrix).map(s => { const hi = s.rows.findIndex(r => r && r.filter(c => String(c ?? "").trim()).length >= 2); const cols = hi >= 0 ? programColumns(s.rows[hi]) : {}; return { s, score: (cols.name !== undefined) * 2 + (cols.area !== undefined) * 3 + Object.keys(cols).length * 0.1 }; }).sort((a, b) => b.score - a.score);
  if (!cands.length) return { nodes: [], edges: [], report: ["no sheet reads as a program"] };
  const out = programFromRows(cands[0].s.rows, matrix ? matrix.rows : null);
  out.report.unshift(`program from sheet "${cands[0].s.name}"${matrix ? `, adjacencies also from the matrix "${matrix.name}"` : ""}`);
  return out;
}

// ---------------------------------------------------------------- the bubble diagram
const sgRadius = nd => Math.sqrt(Math.max(1, nd.area) / Math.PI);          // metres
/** Place nodes that have no position yet: on a ring, in program order. */
export function seedBubbles(nodes) {
  const free = nodes.filter(nd => !(Number.isFinite(nd.x) && Number.isFinite(nd.y)));
  const R = Math.max(8, Math.sqrt(nodes.reduce((s, nd) => s + nd.area, 0)) * 0.9);
  free.forEach((nd, i) => { const a = i / Math.max(1, free.length) * Math.PI * 2; nd.x = R * Math.cos(a); nd.y = R * Math.sin(a); });
  return nodes;
}
/**
 * Relax the bubble diagram: adjacent bubbles pull until they touch (harder the stronger the
 * adjacency), keep-apart pairs push to a clear distance, no two bubbles overlap, and a weak pull to
 * the middle keeps the diagram together. Pinned nodes hold still. Mutates x, y; returns the energy.
 */
export function relaxBubbles(nodes, edges, steps = 200, opts = {}) {
  seedBubbles(nodes);
  const byId = new Map(nodes.map(nd => [nd.id, nd])), dt = opts.dt || 0.35;
  let energy = 0;
  for (let it = 0; it < steps; it++) {
    const F = new Map(nodes.map(nd => [nd.id, [0, 0]]));
    const cx = nodes.reduce((s, nd) => s + nd.x, 0) / nodes.length, cy = nodes.reduce((s, nd) => s + nd.y, 0) / nodes.length;
    for (const e of edges) {
      const a = byId.get(e.a), b = byId.get(e.b); if (!a || !b) continue;
      const d = [b.x - a.x, b.y - a.y], L = Math.hypot(d[0], d[1]) || 1e-6, ra = sgRadius(a), rb = sgRadius(b);
      let f = 0;
      if (e.w > 0) f = 0.12 * e.w * (L - (ra + rb) * 1.02);
      else if (L < (ra + rb) * 2.6) f = -0.25 * ((ra + rb) * 2.6 - L);
      const fx = f * d[0] / L, fy = f * d[1] / L;
      F.get(a.id)[0] += fx; F.get(a.id)[1] += fy; F.get(b.id)[0] -= fx; F.get(b.id)[1] -= fy;
    }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], d = [b.x - a.x, b.y - a.y], L = Math.hypot(d[0], d[1]) || 1e-3, min = sgRadius(a) + sgRadius(b) + 0.3;
      if (L >= min) continue;
      const f = 0.5 * (min - L), fx = f * (d[0] || Math.random() - 0.5) / L, fy = f * (d[1] || Math.random() - 0.5) / L;
      F.get(a.id)[0] -= fx; F.get(a.id)[1] -= fy; F.get(b.id)[0] += fx; F.get(b.id)[1] += fy;
    }
    energy = 0;
    for (const nd of nodes) {
      const f = F.get(nd.id); f[0] += (cx - nd.x) * 0.004; f[1] += (cy - nd.y) * 0.004;
      if (nd.pinned) continue;
      const mx = Math.max(-2, Math.min(2, f[0] * dt)), my = Math.max(-2, Math.min(2, f[1] * dt));
      nd.x += mx; nd.y += my; energy += mx * mx + my * my;
    }
  }
  return energy;
}

// ---------------------------------------------------------------- site, setbacks, footprint
/** The site polygon counter-clockwise. */
export function ccwPoly(poly) { return polyArea(poly) < 0 ? poly.slice().reverse() : poly.slice(); }
/** What may be built on: each site edge moved in by its own setback, consecutive edges met. */
export function buildableArea(site, setbacks = []) {
  const P = ccwPoly(site), n = P.length; if (n < 3) return [];
  const lines = P.map((a, i) => { const b = P[(i + 1) % n], d = normalise(sub(b, a)), nrm = [-d[1], d[0]], s = setbacks[i] ?? setbacks[0] ?? 0; return { p: add(a, mul(nrm, s)), d }; });
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i + n - 1) % n], L2 = lines[i], den = L1.d[0] * L2.d[1] - L1.d[1] * L2.d[0];
    if (Math.abs(den) < 1e-9) { out.push(L2.p); continue; }
    const t = ((L2.p[0] - L1.p[0]) * L2.d[1] - (L2.p[1] - L1.p[1]) * L2.d[0]) / den;
    out.push(add(L1.p, mul(L1.d, t)));
  }
  return out;
}
/** If the site's edges map to setbacks by orientation (front/rear/side), the edge nearest the entry is the front. */
export function setbacksByRole(site, entry, { front = 6000, side = 3000, rear = 5000 } = {}) {
  const P = ccwPoly(site), n = P.length, mids = P.map((a, i) => lerp(a, P[(i + 1) % n], 0.5));
  let fi = 0; if (entry) { let bd = Infinity; mids.forEach((m, i) => { const d = dist(m, entry); if (d < bd) { bd = d; fi = i; } }); }
  const fd = normalise(sub(P[(fi + 1) % n], P[fi]));
  return P.map((a, i) => { if (i === fi) return front; const d = normalise(sub(P[(i + 1) % n], a)), c = dot(d, fd); return c < -0.7 ? rear : side; });
}
/** The frame a footprint rectangle lives in: origin, along (u), across (v), length W, depth D. */
export function footprintFrame(fp) {
  const a = (fp.angle || 0) * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
  const corner = (s, t) => add(fp.o, add(mul(u, s), mul(v, t)));
  return { o: fp.o, u, v, W: fp.W, D: fp.D, at: corner, poly: [corner(0, 0), corner(fp.W, 0), corner(fp.W, fp.D), corner(0, fp.D)] };
}
/**
 * The largest rectangle inside the buildable area, its long side along `angle` (the longest buildable
 * edge by default), no deeper than maxDepth - searched on a grid across the depth.
 */
export function fitFootprint(buildable, { angle = null, maxDepth = 24000, maxLength = Infinity } = {}) {
  const P = ccwPoly(buildable); if (P.length < 3) return null;
  if (angle === null) { let best = -1; P.forEach((a, i) => { const b = P[(i + 1) % P.length], L = dist(a, b); if (L > best) { best = L; angle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; } }); }
  const ar = angle * Math.PI / 180, u = [Math.cos(ar), Math.sin(ar)], v = [-u[1], u[0]];
  const Q = P.map(p => [dot(p, u), dot(p, v)]);
  const ys = Q.map(q => q[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = y => { const xs = []; for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); } xs.sort((m, k) => m - k); return xs.length >= 2 ? [xs[0], xs[xs.length - 1]] : null; };
  const N = 48; let best = null;
  for (let i = 0; i < N; i++) for (let j = i + 1; j <= N; j++) {
    const ya = y0 + (y1 - y0) * i / N, yb = y0 + (y1 - y0) * j / N; if (yb - ya > maxDepth + 1e-6) break;
    let lo = -Infinity, hi = Infinity;
    for (let k = 0; k <= 8; k++) { const s = span(ya + (yb - ya) * k / 8 + (k === 0 ? 1e-6 : k === 8 ? -1e-6 : 0)); if (!s) { lo = Infinity; break; } lo = Math.max(lo, s[0]); hi = Math.min(hi, s[1]); }
    let W = hi - lo; if (!(W > 0)) continue; if (W > maxLength) { const c = (lo + hi) / 2; lo = c - maxLength / 2; W = maxLength; }
    const A = W * (yb - ya); if (!best || A > best.A) best = { A, lo, ya, W, D: yb - ya };
  }
  if (!best) return null;
  return { o: add(mul(u, best.lo), mul(v, best.ya)), angle, W: Math.round(best.W), D: Math.round(best.D) };
}

// ---------------------------------------------------------------- packing
export const SG_DEFAULTS = { roomDepth: 6000, corridor: 1800, module: 300, storey: 3500, wallHeight: 3000, coreMin: 3000, maxDepth: 24000, doors: true };
/** Nodes grouped by level, in the order levels first appear. */
function sgLevels(nodes) { const m = new Map(); for (const nd of nodes) { const k = nd.level || ""; if (!m.has(k)) m.set(k, []); m.get(k).push(nd); } return m; }
/** The principal axis of a set of weighted points. */
function sgPCA(pts) {
  const W = pts.reduce((s, p) => s + p.w, 0) || 1, c = [pts.reduce((s, p) => s + p.x * p.w, 0) / W, pts.reduce((s, p) => s + p.y * p.w, 0) / W];
  let xx = 0, xy = 0, yy = 0; for (const p of pts) { const dx = p.x - c[0], dy = p.y - c[1]; xx += dx * dx * p.w; xy += dx * dy * p.w; yy += dy * dy * p.w; }
  const a = 0.5 * Math.atan2(2 * xy, xx - yy); return { c, a1: [Math.cos(a), Math.sin(a)], a2: [-Math.sin(a), Math.cos(a)] };
}
/**
 * The strips a footprint divides into, across its depth D (v from the facade at v = 0):
 * double-loaded (rooms | corridor | rooms), racetrack (rooms | corridor | core | corridor | rooms) when
 * deep enough and something needs no daylight, or single-loaded when shallow.
 */
export function stripsFor(D, W, o, needCore) {
  const c = o.corridor, rd = o.roomDepth;
  if (needCore && D >= 2 * rd + 2 * c + o.coreMin) return { kind: "racetrack", strips: [
    { key: "A", v0: 0, v1: rd, u0: 0, u1: W, facade: true }, { key: "C", v0: rd + c, v1: D - rd - c, u0: c, u1: W - c, facade: false }, { key: "B", v0: D - rd, v1: D, u0: 0, u1: W, facade: true }],
    corridors: [{ u0: 0, u1: W, v0: rd, v1: rd + c }, { u0: 0, u1: W, v0: D - rd - c, v1: D - rd }, { u0: 0, u1: c, v0: rd + c, v1: D - rd - c }, { u0: W - c, u1: W, v0: rd + c, v1: D - rd - c }] };
  if (D >= c + 2 * 2400) { const a = (D - c) / 2; return { kind: "double-loaded", strips: [{ key: "A", v0: 0, v1: a, u0: 0, u1: W, facade: true }, { key: "B", v0: a + c, v1: D, u0: 0, u1: W, facade: true }], corridors: [{ u0: 0, u1: W, v0: a, v1: a + c }] }; }
  return { kind: "single-loaded", strips: [{ key: "A", v0: 0, v1: Math.max(1, D - c), u0: 0, u1: W, facade: true }], corridors: [{ u0: 0, u1: W, v0: Math.max(1, D - c), v1: D }] };
}
/**
 * Widths along a strip for its rooms in order: each room's area over the strip's depth, then all of
 * them scaled together to fill the strip - within each room's width-to-depth range and minimum width -
 * and the boundaries snapped to the module. Returns boundaries, and what did not fit.
 */
export function fitWidths(rooms, L, depth, module) {
  const want = rooms.map(r => r.area * 1e6 / depth);
  const lo = rooms.map(r => Math.max(r.minWidth || 0, r.ratio ? r.ratio[0] * depth : 0, 900));
  // a room grows at most 15% past its area to fill a strip (or to its ratio's limit); the rest is a spare slot
  const hi = rooms.map((r, i) => Math.max(lo[i], r.ratio ? r.ratio[1] * depth : want[i] * 1.15));
  let w = want.slice();
  for (let it = 0; it < 12; it++) {
    const sum = w.reduce((a, b) => a + b, 0), free = w.map((x, i) => (x > lo[i] + 1e-6 && x < hi[i] - 1e-6) || (sum < L ? x < hi[i] - 1e-6 : x > lo[i] + 1e-6));
    const fs = w.reduce((a, x, i) => a + (free[i] ? x : 0), 0); if (Math.abs(sum - L) < 1 || fs <= 0) break;
    const k = (fs + L - sum) / fs; w = w.map((x, i) => free[i] ? Math.min(hi[i], Math.max(lo[i], x * k)) : x);
  }
  let sum = w.reduce((a, b) => a + b, 0), spare = 0, squeezed = false;
  if (sum > L + 1) { squeezed = true; w = w.map(x => x * L / sum); sum = L; }            // it does not fit: everything gives
  if (sum < L - 1) spare = L - sum;
  const bounds = [0]; let acc = 0;
  for (let i = 0; i < w.length; i++) { acc += w[i]; let b = module > 0 ? Math.round(acc / module) * module : acc; b = Math.max(bounds[i] + (module || 1), Math.min(L, b)); bounds.push(b); }
  if (!spare) bounds[bounds.length - 1] = L;
  return { bounds, spare: spare ? L - bounds[bounds.length - 1] : 0, squeezed, want };
}
/** The along-strip position (0..W) of the entry, and which facade it is on. */
function sgEntryOn(frame, entries) {
  const e = entries && entries[0]; if (!e) return null;
  const q = sub(e.at, frame.o), s = dot(q, frame.u), t = dot(q, frame.v);
  return { s: Math.max(0, Math.min(frame.W, s)), side: t > frame.D / 2 ? "B" : "A" };
}
/**
 * Plan a space graph: relax (unless told not to), fit the footprint, and pack each level.
 * Returns everything drawn and built: the buildable area, footprint, strips, corridors and rooms
 * with their slots, and a report of what did not work out and why.
 */
export function planSpaceGraph(sg, { relax = true, storeys = null } = {}) {
  const o = Object.assign({}, SG_DEFAULTS, SG_PLATE_DEFAULTS, sg.options || {});
  // the room depth, unless set: the depth that best keeps the facade rooms' own proportions - each
  // room's preferred depth is sqrt(area / its width:depth), the middle of its range (0.8 when it has none)
  if (!(sg.options && sg.options.roomDepth)) {
    const pref = (sg.nodes || []).filter(nd => nd.facade && nd.zone !== "Circulation" && nd.area > 0).map(nd => { const r = nd.ratio ? (nd.ratio[0] + nd.ratio[1]) / 2 : 0.8; return Math.max(4000, Math.min(9000, Math.sqrt(nd.area * 1e6 / r))); }).sort((a, b) => a - b);
    if (pref.length) o.roomDepth = Math.round(pref[Math.floor(pref.length / 2)] / (o.module || 1)) * (o.module || 1);
  }
  const nodes = (sg.nodes || []).map(nd => Object.assign({}, nd)), edges = sg.edges || [], report = [];
  if (relax && nodes.length) relaxBubbles(nodes, edges, 250);
  // masterplan scale (towers, parking, or more programme than a building of rooms) plans as blocks first
  const big = nodes.some(nd => nd.zone === "Tower" || nd.zone === "Parking") || nodes.reduce((a, nd) => a + (nd.area || 0), 0) > 20000;
  const mode = o.mode && o.mode !== "auto" ? o.mode : storeys && storeys.length ? "plates" : big ? "blocks" : "rooms";
  if (mode === "blocks") { const pl = planBlocks(sg, nodes, edges, o, report); pl.bubbles = nodes.map(nd => ({ id: nd.id, x: nd.x, y: nd.y })); return pl; }
  if (storeys && storeys.length) { const pl = planOnMassing(sg, nodes, edges, o, storeys, report); pl.bubbles = nodes.map(nd => ({ id: nd.id, x: nd.x, y: nd.y })); pl.site = sg.site && sg.site.boundary && sg.site.boundary.length >= 3 ? sg.site.boundary : null; return pl; }
  const site = sg.site && sg.site.boundary && sg.site.boundary.length >= 3 ? sg.site.boundary : null;
  const buildable = site ? buildableArea(site, sg.site.setbacks || []) : null;
  const packable = nodes.filter(nd => nd.zone !== "Circulation");
  const levels = sgLevels(packable);
  // an internal core is worth its two corridors only when enough of the program does without daylight
  const coreWorth = ns => { const inside = ns.filter(nd => !nd.facade).reduce((a, nd) => a + nd.area, 0), all = ns.reduce((a, nd) => a + nd.area, 0); return inside >= 40 && inside >= 0.12 * all; };
  const needCore = coreWorth(packable);
  // the footprint: given; else sized to the program and placed in the largest rectangle the setbacks
  // allow, flush to the entry's facade with the entry's rooms at the entry; else sized at the origin
  const given = sg.options && sg.options.footprint ? Object.assign({}, sg.options.footprint) : null;
  let avail = null;
  if (!given && buildable) {
    const spine = sg.site && sg.site.spine;
    const angle = spine ? Math.atan2(spine.b[1] - spine.a[1], spine.b[0] - spine.a[0]) * 180 / Math.PI : null;
    avail = fitFootprint(buildable, { angle, maxDepth: o.maxDepth });
    if (!avail) report.push("the setbacks leave nothing to build on");
  }
  let W, D;
  if (given) ({ W, D } = given);
  else {
    const rd = o.roomDepth, c = o.corridor, maxD = avail ? avail.D : o.maxDepth;
    W = 0; D = 0;
    for (const ns of levels.values()) {
      const F = ns.filter(nd => nd.facade).reduce((a, nd) => a + nd.area, 0) * 1e6, C = ns.filter(nd => !nd.facade).reduce((a, nd) => a + nd.area, 0) * 1e6;
      let w, d;
      if (C > 0 && coreWorth(ns) && maxD >= 2 * rd + 2 * c + o.coreMin) {
        const wf = F / (2 * rd), coreD = Math.min(maxD - 2 * rd - 2 * c, Math.max(o.coreMin, wf > 2 * c ? C / (wf - 2 * c) : o.coreMin));
        w = Math.max(wf, C / coreD + 2 * c); d = 2 * rd + 2 * c + coreD;
      } else { d = Math.min(maxD, 2 * rd + c); w = (F + C) / (2 * ((d - c) / 2)); }
      W = Math.max(W, w); D = Math.max(D, d);
    }
    const m = o.module || 1; W = Math.ceil(W * 1.03 / m) * m; D = Math.ceil(D / m) * m;
    if (avail && W > avail.W) { report.push(`the program needs ${(W / 1000).toFixed(1)} m of building, the setbacks allow ${(avail.W / 1000).toFixed(1)} m: rooms are squeezed - add a level, or deepen the plan`); W = Math.floor(avail.W / m) * m; }
    if (avail && D > avail.D) D = Math.floor(avail.D / m) * m;
  }
  // the entry, seen along the length the footprint can slide in
  const availFrame = avail ? footprintFrame(avail) : null;
  const entryAvail = availFrame ? sgEntryOn(availFrame, sg.site && sg.site.entries) : null;
  let fp = given || { o: [0, 0], angle: avail ? avail.angle : 0, W, D };
  if (!given && !avail) report.push("no site yet: the footprint is sized to the program");
  let frame = footprintFrame(fp);
  const entry = given ? sgEntryOn(frame, sg.site && sg.site.entries) : entryAvail ? { s: entryAvail.s * W / avail.W, side: entryAvail.side } : null;
  const out = { buildable, site, footprint: fp, frame, levels: [], report, options: o, order: {} };
  for (const [lk, ns] of levels) {
    const layout = stripsFor(frame.D, frame.W, o, coreWorth(ns));
    // the bubbles' long axis becomes the building's; the entry's rooms go to the entry's end and side
    const pca = sgPCA(ns.map(nd => ({ x: nd.x || 0, y: nd.y || 0, w: nd.area })));
    let t = new Map(ns.map(nd => [nd.id, dot([nd.x - pca.c[0], nd.y - pca.c[1]], pca.a1)])), s = new Map(ns.map(nd => [nd.id, dot([nd.x - pca.c[0], nd.y - pca.c[1]], pca.a2)]));
    const ents = ns.filter(nd => nd.zone === "Entry");
    if (entry && ents.length) {
      const tE = ents.reduce((a, nd) => a + t.get(nd.id), 0) / ents.length, ts = [...t.values()], tmin = Math.min(...ts), tmax = Math.max(...ts);
      if ((tE - tmin) / ((tmax - tmin) || 1) < 0.5 !== entry.s / frame.W < 0.5) t = new Map([...t].map(([k, v]) => [k, -v]));
      const sE = ents.reduce((a, nd) => a + s.get(nd.id), 0) / ents.length;
      if ((sE < 0) !== (entry.side === "A")) s = new Map([...s].map(([k, v]) => [k, -v]));
    }
    // slots: a saved order wins (identity lives in it); new nodes join the strip their bubble says
    const saved = sg.order && sg.order[lk];
    const byKey = new Map(layout.strips.map(st => [st.key, []]));
    const placed = new Set();
    if (saved) for (const st of layout.strips) for (const id of saved[st.key] || []) { const nd = ns.find(x => x.id === id); if (nd && !placed.has(id)) { byKey.get(st.key).push(nd); placed.add(id); } }
    const fresh = ns.filter(nd => !placed.has(nd.id));
    const core = layout.strips.find(st => st.key === "C"), A = layout.strips.find(st => st.key === "A"), B = layout.strips.find(st => st.key === "B");
    for (const nd of fresh) {
      const key = core && !nd.facade ? "C" : !B ? "A" : s.get(nd.id) < 0 ? "A" : "B";
      byKey.get(key).push(nd);
    }
    // balance the facade strips when one side is asked for more than it holds
    if (A && B && !saved) {
      const len = st => st.u1 - st.u0, need = arr => arr.reduce((a, nd) => a + nd.area * 1e6, 0) / (A.v1 - A.v0);
      for (let guard = 0; guard < ns.length; guard++) {
        const a = byKey.get("A"), b = byKey.get("B"), oa = need(a) - len(A), ob = need(b) - len(B);
        if (oa > 0 && ob < 0 && a.length > 1) { a.sort((x, y) => Math.abs(s.get(x.id)) - Math.abs(s.get(y.id))); b.push(a.shift()); }
        else if (ob > 0 && oa < 0 && b.length > 1) { b.sort((x, y) => Math.abs(s.get(x.id)) - Math.abs(s.get(y.id))); a.push(b.shift()); }
        else break;
      }
    }
    if (!saved) for (const arr of byKey.values()) arr.sort((x, y) => t.get(x.id) - t.get(y.id));
    else for (const [k, arr] of byKey) { const keep = (saved[k] || []).filter(id => arr.some(nd => nd.id === id)); const extra = arr.filter(nd => !keep.includes(nd.id)).sort((x, y) => t.get(x.id) - t.get(y.id)); byKey.set(k, keep.map(id => arr.find(nd => nd.id === id)).concat(extra)); }
    out.order[lk] = Object.fromEntries([...byKey].map(([k, arr]) => [k, arr.map(nd => nd.id)]));
    const rooms = [], spares = [];
    for (const st of layout.strips) {
      const arr = byKey.get(st.key); if (!arr.length) continue;
      const depth = st.v1 - st.v0, L = st.u1 - st.u0, fit = fitWidths(arr, L, depth, o.module);
      if (fit.squeezed) report.push(`${lk || "level"} strip ${st.key}: the rooms ask for ${(fit.want.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} m of facade, ${(L / 1000).toFixed(1)} m is there - every room gives a little`);
      arr.forEach((nd, i) => {
        const u0 = st.u0 + fit.bounds[i], u1 = st.u0 + fit.bounds[i + 1], w = u1 - u0, area = w * depth / 1e6, ratio = w / depth;
        const warn = [];
        if (nd.facade && !st.facade) warn.push("wants a facade, is in the core");
        if (nd.ratio && (ratio < nd.ratio[0] - 0.02 || ratio > nd.ratio[1] + 0.02)) warn.push(`width:depth ${ratio.toFixed(2)} outside ${nd.ratio[0]}–${nd.ratio[1]}`);
        if (Math.abs(area - nd.area) / nd.area > 0.15) warn.push(`${area.toFixed(1)} m² for ${nd.area} m²`);
        rooms.push({ id: nd.id, name: nd.name, number: nd.number, dept: nd.dept, zone: nd.zone, strip: st.key, slot: i, u0, u1, v0: st.v0, v1: st.v1, area, target: nd.area, ratio, facade: st.facade, warn,
          poly: [frame.at(u0, st.v0), frame.at(u1, st.v0), frame.at(u1, st.v1), frame.at(u0, st.v1)] });
      });
      if (fit.spare > (o.module || 300)) spares.push({ strip: st.key, u0: st.u0 + fit.bounds[fit.bounds.length - 1], u1: st.u1, v0: st.v0, v1: st.v1 });
    }
    // the entry: which room holds it, and how far the entry's own space sits from it
    let entryNote = null;
    if (entry) {
      const at = rooms.find(r => r.strip === entry.side && r.u0 <= entry.s && r.u1 >= entry.s);
      const lobby = rooms.find(r => r.zone === "Entry");
      entryNote = { room: at ? at.id : null, lobby: lobby ? lobby.id : null, off: lobby && lobby.strip === entry.side ? Math.max(0, lobby.u0 - entry.s, entry.s - lobby.u1) : null };

    }
    const circ = ns.length ? (sg.nodes || []).filter(nd => nd.zone === "Circulation" && (nd.level || "") === lk).reduce((a, nd) => a + nd.area, 0) : 0;
    const corrArea = layout.corridors.reduce((a, c) => a + (c.u1 - c.u0) * (c.v1 - c.v0), 0) / 1e6;
    if (circ && Math.abs(circ - corrArea) / circ > 0.25) report.push(`${lk || "level"}: circulation asked ${circ.toFixed(0)} m², the corridors give ${corrArea.toFixed(0)} m²`);
    out.levels.push({ key: lk, kind: layout.kind, strips: layout.strips, corridors: layout.corridors.map(c => Object.assign({}, c, { poly: [frame.at(c.u0, c.v0), frame.at(c.u1, c.v0), frame.at(c.u1, c.v1), frame.at(c.u0, c.v1)] })), rooms, spares, entry: entryNote });
  }
  // slide the footprint along what the setbacks allow so the entry's own space meets the entry
  if (avail) {
    const lobby = out.levels.flatMap(L => L.rooms).find(r => r.zone === "Entry" && entryAvail && r.strip === entryAvail.side);
    const want = entryAvail ? entryAvail.s - (lobby ? (lobby.u0 + lobby.u1) / 2 : W / 2) : (avail.W - W) / 2;
    const offU = Math.max(0, Math.min(avail.W - W, want)), offV = entryAvail && entryAvail.side === "B" ? avail.D - D : 0;
    fp = { o: availFrame.at(offU, offV), angle: avail.angle, W, D }; frame = footprintFrame(fp);
    out.footprint = fp; out.frame = frame;
    if (entryAvail) for (const L of out.levels) if (L.entry && L.entry.lobby) {
      const lb = L.rooms.find(r => r.id === L.entry.lobby); L.entry.off = lb && lb.strip === entryAvail.side ? Math.max(0, lb.u0 + offU - entryAvail.s, entryAvail.s - lb.u1 - offU) : null;
      if (L.entry.off > 0) report.push(`${L.key || "level"}: ${lb.name} is ${(L.entry.off / 1000).toFixed(1)} m from the entry - the building cannot slide further; drag ${lb.name}'s bubble toward that end, or swap it into the slot at the entry`);
      else if (L.entry.off === null && lb) report.push(`${L.key || "level"}: ${lb.name} is on the far side from the entry - drag its bubble to the entry side`);
    }
  }
  if (buildable && !frame.poly.every(p => pointInPoly(p, buildable) || Math.min(...buildable.map((b, i) => distToEdge(p, b, buildable[(i + 1) % buildable.length]))) < 1)) report.push("the footprint crosses a setback line");
  const at = (u, v) => frame.at(u, v), rect = x => [at(x.u0, x.v0), at(x.u1, x.v0), at(x.u1, x.v1), at(x.u0, x.v1)];
  for (const L of out.levels) { for (const r of L.rooms) r.poly = rect(r); for (const c of L.corridors) c.poly = rect(c); for (const sp of L.spares) sp.poly = rect(sp); }
  out.bubbles = nodes.map(nd => ({ id: nd.id, x: nd.x, y: nd.y }));
  return out;
}
function distToEdge(p, a, b) { const d = sub(b, a), L2 = dot(d, d) || 1, t = Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)); return dist(p, add(a, mul(d, t))); }
/** Swap two nodes' slots in a saved order (whichever strips and levels they are in). */
export function swapInOrder(order, a, b) {
  const out = JSON.parse(JSON.stringify(order || {}));
  let pa = null, pb = null;
  for (const [lk, strips] of Object.entries(out)) for (const [k, arr] of Object.entries(strips)) arr.forEach((id, i) => { if (id === a) pa = [lk, k, i]; if (id === b) pb = [lk, k, i]; });
  if (!pa || !pb) return out;
  out[pa[0]][pa[1]][pa[2]] = b; out[pb[0]][pb[1]][pb[2]] = a;
  return out;
}

// ---------------------------------------------------------------- the model it builds
/** A strip level (rectangular footprint) as the builder's generic model: slab, walls, spaces, doors. */
export function stripModel(L, fr, o) {
  const walls = [], spaces = [], doors = [];
  const P = fr.poly;
  for (let i = 0; i < 4; i++) walls.push({ a: P[i], b: P[(i + 1) % 4], kind: "exterior", pid: "perimeter" });
  const corridorWall = {};
  for (const st of L.strips) {
    if (st.key === "C") { const c = [fr.at(st.u0, st.v0), fr.at(st.u1, st.v0), fr.at(st.u1, st.v1), fr.at(st.u0, st.v1)]; for (let i = 0; i < 4; i++) walls.push({ a: c[i], b: c[(i + 1) % 4], kind: "core", pid: "core" }); continue; }
    const v = st.v0 > 0 ? st.v0 : st.v1; if (v <= 0 || v >= fr.D) continue;
    corridorWall[st.key] = walls.length; walls.push({ a: fr.at(0, v), b: fr.at(fr.W, v), kind: "corridor", pid: "corridor" });
  }
  for (const st of L.strips) {
    const rs = L.rooms.filter(r => r.strip === st.key).sort((a, b) => a.u0 - b.u0);
    const cuts = rs.slice(0, -1).map(r => r.u1).concat(L.spares.filter(sp => sp.strip === st.key).map(sp => sp.u0));
    for (const u of cuts) if (u > st.u0 + 1 && u < st.u1 - 1) { const r = rs.find(x => Math.abs(x.u1 - u) < 1); walls.push({ a: fr.at(u, st.v0), b: fr.at(u, st.v1), kind: "cross", pid: r ? r.id : "spare" }); }
  }
  for (const r of L.rooms) {
    spaces.push({ name: r.name, number: r.number || r.id, dept: r.dept || r.zone, at: fr.at((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2), pid: r.id });
    const wi = corridorWall[r.strip]; if (wi !== undefined && r.u1 - r.u0 >= 1500) doors.push({ wall: wi, at: (r.u0 + r.u1) / 2, pid: r.id });
  }
  L.corridors.forEach((c, i) => spaces.push({ name: "Circulation", number: `C${i + 1}`, dept: "Circulation", at: fr.at((c.u0 + c.u1) / 2, (c.v0 + c.v1) / 2), pid: "corridor" }));
  L.spares.forEach((sp, i) => spaces.push({ name: "Spare", number: `S${i + 1}`, dept: "Unassigned", at: fr.at((sp.u0 + sp.u1) / 2, (sp.v0 + sp.v1) / 2), pid: "spare" }));
  return { slab: P, walls, spaces, doors };
}
/**
 * The ops that make a plan real, replacing whatever this space graph built before: per level, its
 * slab, walls, a Space per room (named, numbered, its department) and per corridor, and a door from
 * each room onto the corridor. Everything carries SpaceGraph = the graph's id and ProgramId = its
 * node, so a rebuild finds and replaces it, and a room's walls are known as the room's.
 */
export function buildOpsFor(doc, sgId, plan, { levelFor, types = {} } = {}) {
  const ops = [], tag = pid => ({ SpaceGraph: sgId, ProgramId: pid });
  const old = doc.elements().filter(f => doc.getParam(f, "SpaceGraph") === sgId);
  if (old.length) ops.push({ op: "delete", ids: old.map(f => doc.idOf(f)) });
  // ids are reused across rebuilds: what this graph built before is deleted first, in the same step
  const oldIds = new Set(old.map(f => doc.idOf(f)));
  const o = plan.options, ends = [];
  if (plan.mode === "blocks") {
    // a massing study: one generic mass per block, coloured by the legend, on the base level
    const lv = levelFor(""); if (!lv) return ops;
    for (const b of plan.blocks) b.colour = b.colour || legendColour(o.legend, b);
    for (const b of plan.blocks) ops.push({ op: "add", element: { type: "Generic", name: b.name, args: { boundary: b.poly.map(p => p.map(v => Math.round(v))), level: { ref: lv }, baseOffset: Math.round(b.z0), height: Math.round(b.z1 - b.z0), ifcClass: b.zone === "Parking" ? "IfcBuildingElementProxy" : "IfcBuildingElementProxy", material: "M-CONC", colour: b.colour || "" }, params: Object.assign({ Comments: `${b.storeys} storeys × ${(b.f2f / 1000).toFixed(1)} m · ${Math.round(b.area).toLocaleString()} m²` }, tag(b.id)) } });
    return ops;
  }
  let wn = 0; const wid = () => { let id; do { id = `${sgId}-W${++wn}`; } while (doc.element(id) && !oldIds.has(id)); return id; };
  const r1 = v => Math.round(v * 10) / 10, line = (a, b) => ({ type: "line", start: a.map(r1), end: b.map(r1) });
  for (const L of plan.levels) {
    const lv = levelFor(L.key); if (!lv) continue;
    const M = L.model || stripModel(L, plan.frame, o);
    const wallIds = M.walls.map(w => {
      if (dist(w.a, w.b) < 50) return null;
      const id = wid(), type = w.kind === "exterior" ? (types.exterior || "T-EXTCAV300") : (types.interior || "T-PART100");
      ops.push({ op: "add", element: { id, type: "Wall", name: id, args: { centreline: line(w.a, w.b), mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: lv }, baseOffset: 0, height: o.wallHeight, flipped: false }, params: Object.assign({ Phase: "New" }, tag(w.pid)) } });
      ends.push({ id, end: "start" }, { id, end: "end" }); return id;
    });
    if (M.slab && M.slab.length >= 3) ops.push({ op: "add", element: { type: "Floor", name: `${sgId} slab ${L.name || L.key || ""}`.trim(), args: { boundary: M.slab.map(p => p.map(v => Math.round(v))), floorType: { ref: types.floor || "T-FLOOR250" }, level: { ref: lv }, heightOffset: 0 }, params: tag("slab") } });
    const upper = { mode: "offset", offset: o.wallHeight };
    for (const sp of M.spaces) ops.push({ op: "add", element: { type: "Space", name: sp.name, args: { level: { ref: lv }, upperLimit: upper, anchor: sp.at.map(Math.round), boundaryAt: "wallCentre" }, params: Object.assign({ Number: sp.number, Department: sp.dept }, tag(sp.pid)) } });
    if (o.doors !== false && types.door) for (const d of M.doors) {
      const host = wallIds[d.wall]; if (!host) continue;
      let opId = `${sgId}-O-${d.pid}`.replace(/[^A-Za-z0-9-]/g, ""); while (doc.element(opId) && !oldIds.has(opId)) opId += "x";
      ops.push({ op: "add", element: { id: opId, type: "Opening", args: { host: { ref: host }, profile: { kind: "rect", at: Math.round(d.at), sill: 0, w: types.doorWidth || 915, h: types.doorHeight || 2100 }, farProfile: null, depth: "through" }, params: tag(d.pid) } });
      ops.push({ op: "add", element: { type: "Door", args: { fills: { ref: opId }, doorType: { ref: types.door } }, params: Object.assign({ Phase: "New" }, tag(d.pid)) } });
    }
  }
  if (ends.length) ops.push({ op: "autojoin", ends });
  return ops;
}

// ---------------------------------------------------------------- packing floor plates of any shape
//! On a massing, each storey's plate is whatever the envelope cuts - curved, faceted, leaning. The
//! rooms that need daylight ring its edge, so a room's outer side IS the facade however it runs; a
//! corridor rings inside them; what needs no daylight fills the core. Rooms take their place on the
//! ring from where their bubbles sit, pulled toward any attractor (an anchor like a station to the
//! south, or a point you want a department at), and the order is improved by swaps while it gets closer.
export const SG_PLATE_DEFAULTS = { efficiency: 0.75 };
const circDist = (a, b, L) => { const d = Math.abs(a - b) % L; return Math.min(d, L - d); };
/** The ring of a plate: facade loop, the loop a room depth in, the loop a corridor further in (the core). */
export function plateRing(outer, rd, c, simplifyTol = 60) {
  let P = simplifyLoop(outer, simplifyTol); if (polyArea(P) < 0) P = P.slice().reverse();
  // an offset is usable when it kept its turn and its size went down, and it sits (almost all) inside
  const ok = (Q, R) => Q.length >= 3 && polyArea(Q) > 1e6 && polyArea(Q) < polyArea(R) && Q.filter(q => pointInPoly(q, R)).length >= Q.length * 0.9;
  const inner = offsetLoop(P, rd), mid = offsetLoop(P, rd / 2);
  if (!ok(inner, P)) return { P, inner: null };
  const core = offsetLoop(inner, c);
  const cum = [0]; for (let i = 0; i < mid.length; i++) cum.push(cum[i] + dist(mid[i], mid[(i + 1) % mid.length]));
  const L = cum[cum.length - 1];
  return { P, inner, mid, cum, L, core: ok(core, inner) ? core : null };
}
/** The facade, corridor and mid points of the ring at parameter u (length along the mid loop). */
export function ringAt(R, u) {
  const n = R.P.length; u = ((u % R.L) + R.L) % R.L;
  let k = 0; while (k < n - 1 && R.cum[k + 1] <= u) k++;
  const t = (u - R.cum[k]) / ((R.cum[k + 1] - R.cum[k]) || 1), k1 = (k + 1) % n;
  return { o: lerp(R.P[k], R.P[k1], t), i: lerp(R.inner[k], R.inner[k1], t), m: lerp(R.mid[k], R.mid[k1], t), edge: k, t };
}
/** The room between parameters u0 and u1 (u1 > u0, may run past the ring's start): facade side then corridor side. */
export function ringRoom(R, u0, u1) {
  const n = R.P.length, outer = [ringAt(R, u0).o], inner = [ringAt(R, u0).i];
  for (let lap = 0; lap <= 1; lap++) for (let k = 0; k < n; k++) { const uk = R.cum[k] + lap * R.L; if (uk > u0 + 1e-6 && uk < u1 - 1e-6) { outer.push(R.P[k]); inner.push(R.inner[k]); } }
  outer.push(ringAt(R, u1).o); inner.push(ringAt(R, u1).i);
  return outer.concat(inner.reverse());
}
/** The parameter u1 at which the room from u0 has `area` (mm²), by bisection. */
function ringSolve(R, u0, area, uMax) {
  let lo = u0, hi = Math.min(uMax, u0 + R.L);
  if (Math.abs(polyArea(ringRoom(R, u0, hi))) <= area) return hi;
  for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (Math.abs(polyArea(ringRoom(R, u0, mid))) < area) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
/** The ring parameter nearest a point. */
function ringParamOf(R, p) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < R.mid.length; k++) { const a = R.mid[k], b = R.mid[(k + 1) % R.mid.length], d = sub(b, a), L2 = dot(d, d) || 1, t = Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)), q = add(a, mul(d, t)), dd = dist(p, q); if (dd < bd) { bd = dd; best = R.cum[k] + t * Math.sqrt(L2); } }
  return best;
}
/** Attractors that pull a node: its own, its department's, its zone's, and the anchors that pull everything of a kind. */
export function attractorsFor(nd, attractors) {
  return (attractors || []).filter(a => (a.node && a.node === nd.id) || (a.dept && a.dept === nd.dept) || (a.zone && a.zone === nd.zone));
}
/** Put each space on a storey: locks first, the entry's on the ground, then along the graph from the entry, filling storeys by capacity. */
export function assignLevels(nodes, edges, storeys, o, report) {
  // what each storey holds: the facade ring for rooms that need daylight, the core for the rest -
  // no more, together, than the efficiency target allows of the plate
  const buckets = storeys.map(s => {
    const pl = s.plates.slice().sort((a, b) => Math.abs(polyArea(b.outer)) - Math.abs(polyArea(a.outer)))[0], R = pl ? plateRing(pl.outer, o.roomDepth, o.corridor) : { inner: null };
    const gia = (pl ? Math.abs(polyArea(pl.outer)) : 0) / 1e6, ring = R.inner ? gia - Math.abs(polyArea(R.inner)) / 1e6 : gia * 0.6, core = R.core ? Math.abs(polyArea(R.core)) / 1e6 : 0;
    const k = Math.min(1, gia * (o.efficiency || 0.75) / Math.max(1e-6, ring + core));
    return { ring: ring * k, core: core >= 4 ? core * k : 0 };
  });
  const cap = buckets.map(b => b.ring + b.core), used = storeys.map(() => 0), usedR = storeys.map(() => 0), usedC = storeys.map(() => 0), at = new Map();
  const fits = (nd, i) => nd.facade || !buckets[i].core ? usedR[i] + nd.area <= buckets[i].ring * 1.02 : usedC[i] + nd.area <= buckets[i].core * 1.02;
  const find = key => { if (!key) return -1; const k = String(key).toLowerCase(); let i = storeys.findIndex(s => s.key.toLowerCase() === k || String(s.name || "").toLowerCase() === k || String(s.name || "").toLowerCase() === "level " + k); if (i < 0 && /^-?\d+$/.test(k)) i = Number(k) < storeys.length ? Number(k) : -1; if (i < 0 && /^(g|gf|ground)$/.test(k)) i = 0; return i; };
  const put = (nd, i) => { at.set(nd.id, i); used[i] += nd.area; if (nd.facade || !buckets[i].core) usedR[i] += nd.area; else usedC[i] += nd.area; };
  for (const nd of nodes) if (nd.lockLevel && find(nd.level) >= 0) put(nd, find(nd.level));
  for (const nd of nodes) if (!at.has(nd.id) && nd.zone === "Entry") put(nd, 0);
  // along the graph from what is already placed, strongest links first
  const adj = new Map(nodes.map(nd => [nd.id, []])); for (const e of edges) if (e.w > 0 && adj.has(e.a) && adj.has(e.b)) { adj.get(e.a).push([e.b, e.w]); adj.get(e.b).push([e.a, e.w]); }
  const rest = nodes.filter(nd => !at.has(nd.id));
  const pickFor = nd => {
    const pref = find(nd.level); if (pref >= 0 && fits(nd, pref)) return pref;
    // where its placed neighbours are, weighted, if there is room there
    const votes = storeys.map(() => 0); for (const [b, w] of adj.get(nd.id)) if (at.has(b)) votes[at.get(b)] += w;
    const byVote = votes.map((v, i) => [v, i]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0]);
    for (const [, i] of byVote) if (fits(nd, i)) return i;
    for (let i = 0; i < storeys.length; i++) if (fits(nd, i)) return i;
    return used.map((u, i) => [u / (cap[i] || 1), i]).sort((a, b) => a[0] - b[0])[0][1];
  };
  // breadth first from the placed ones, bigger spaces first among equals
  const queue = []; const seen = new Set(at.keys());
  for (const id of at.keys()) for (const [b] of adj.get(id) || []) if (!seen.has(b)) { seen.add(b); queue.push(b); }
  while (queue.length || rest.some(nd => !at.has(nd.id))) {
    let id = queue.shift();
    if (id === undefined) { const nd = rest.filter(x => !at.has(x.id)).sort((a, b) => b.area - a.area)[0]; id = nd.id; seen.add(id); }
    const nd = nodes.find(x => x.id === id); if (!nd || at.has(id)) continue;
    put(nd, pickFor(nd));
    for (const [b] of adj.get(id).sort((x, y) => y[1] - x[1])) if (!seen.has(b)) { seen.add(b); queue.push(b); }
  }
  used.forEach((u, i) => { if (u > cap[i] * 1.02) report.push(`${storeys[i].name || storeys[i].key}: ${u.toFixed(0)} m² placed on ${cap[i].toFixed(0)} m² of usable plate (${Math.round((o.efficiency || 0.75) * 100)}% of ${(storeys[i].area / 1e6).toFixed(0)} m²)`); });
  return { at, cap, used };
}
/** One storey's plate packed: ring rooms (ordered by bubbles and attractors, improved by swaps), core rooms, walls, spaces, doors. */
export function packPlate(st, ns, sg, o, report, saved) {
  const plate = st.plates.slice().sort((a, b) => Math.abs(polyArea(b.outer)) - Math.abs(polyArea(a.outer)))[0];
  if (!plate) return null;
  if (st.plates.length > 1) report.push(`${st.name}: the envelope cuts ${st.plates.length} separate plates here - the largest is planned`);
  if (plate.holes.length) report.push(`${st.name}: the plate has ${plate.holes.length} opening(s) (atria) - rooms are not yet kept clear of them`);
  const R = plateRing(plate.outer, o.roomDepth, o.corridor);
  const walls = [], spaces = [], doors = [], rooms = [], spares = [];
  if (!R.inner) { report.push(`${st.name}: the plate is too small for a ${(o.roomDepth / 1000).toFixed(1)} m ring of rooms - lower the room depth`); return { plate: R.P, rooms, spares, model: { slab: R.P, walls: R.P.map((a, i) => ({ a, b: R.P[(i + 1) % R.P.length], kind: "exterior", pid: "perimeter" })), spaces, doors } }; }
  const coreArea = R.core ? Math.abs(polyArea(R.core)) : 0;
  const inRing = ns.filter(nd => nd.facade || !R.core || coreArea < 4e6), inCore = ns.filter(nd => !inRing.includes(nd));
  // where each ring room wants to be: an attractor's nearest ring point, else its bubble's bearing
  const cp = R.P.reduce((a, p) => add(a, p), [0, 0]).map(v => v / R.P.length);
  const bc = ns.length ? [ns.reduce((a, nd) => a + (nd.x || 0), 0) / ns.length, ns.reduce((a, nd) => a + (nd.y || 0), 0) / ns.length] : [0, 0];
  const bearingParam = th => { let best = 0, bd = Infinity; for (let s = 0; s < 180; s++) { const u = R.L * s / 180, p = ringAt(R, u).m, a = Math.atan2(p[1] - cp[1], p[0] - cp[0]), d = Math.abs(Math.atan2(Math.sin(a - th), Math.cos(a - th))); if (d < bd) { bd = d; best = u; } } return best; };
  const want = new Map(), weight = new Map();
  const attr = (sg.site && sg.site.attractors) || [];
  const pulled = inRing.filter(nd => attractorsFor(nd, attr).length);
  for (const nd of pulled) { const as = attractorsFor(nd, attr), W = as.reduce((a, x) => a + (x.w || 1), 0), p = as.reduce((a, x) => add(a, mul(x.at, (x.w || 1) / W)), [0, 0]); want.set(nd.id, ringParamOf(R, p)); weight.set(nd.id, 4 * W); }
  // the bubbles turned to agree with the pulled rooms (or with the entry), then read as bearings
  const ang = nd => Math.atan2((nd.y || 0) - bc[1], (nd.x || 0) - bc[0]);
  let rot = 0;
  const entry = sg.site && sg.site.entries && sg.site.entries[0], ents = inRing.filter(nd => nd.zone === "Entry");
  const refs = pulled.length ? pulled.map(nd => [ang(nd), Math.atan2(ringAt(R, want.get(nd.id)).m[1] - cp[1], ringAt(R, want.get(nd.id)).m[0] - cp[0])]) : entry && ents.length ? ents.map(nd => [ang(nd), Math.atan2(entry.at[1] - cp[1], entry.at[0] - cp[0])]) : [];
  if (refs.length) { let bestE = Infinity; for (let s = 0; s < 72; s++) { const r = s * Math.PI / 36, E = refs.reduce((a, [b, t]) => a + Math.abs(Math.atan2(Math.sin(b + r - t), Math.cos(b + r - t))), 0); if (E < bestE) { bestE = E; rot = r; } } }
  if (entry && ents.length && !ents.some(nd => want.has(nd.id))) for (const nd of ents) { want.set(nd.id, ringParamOf(R, entry.at)); weight.set(nd.id, 6); }
  for (const nd of inRing) if (!want.has(nd.id)) { want.set(nd.id, bearingParam(ang(nd) + rot)); weight.set(nd.id, 1); }
  // the order: a saved one (identity) or by wanted place; then the start that best meets the wants, and swaps that help
  const ringArea = Math.abs(polyArea(R.P)) - Math.abs(polyArea(R.inner)), demand = inRing.reduce((a, nd) => a + nd.area * 1e6, 0);
  const grow = demand > 0 ? Math.min(1.15, ringArea / demand) : 1;
  if (grow < 0.98) report.push(`${st.name}: the facade ring holds ${(ringArea / 1e6).toFixed(0)} m², the rooms on it ask ${(demand / 1e6).toFixed(0)} m² - every room gives ${Math.round((1 - grow) * 100)}%`);
  const widthOf = nd => nd.area * 1e6 * grow / o.roomDepth;
  let order = saved && saved.R ? saved.R.map(id => inRing.find(nd => nd.id === id)).filter(Boolean) : [];
  order = order.concat(inRing.filter(nd => !order.includes(nd)).sort((a, b) => want.get(a.id) - want.get(b.id)));
  const cost = (ord, s0) => { let u = s0, c = 0; for (const nd of ord) { const w = widthOf(nd); c += weight.get(nd.id) * circDist(u + w / 2, want.get(nd.id), R.L); u += w; } return c; };
  const bestStart = ord => { let b = 0, bc2 = Infinity; for (let s = 0; s < 144; s++) { const s0 = R.L * s / 144, c = cost(ord, s0); if (c < bc2) { bc2 = c; b = s0; } } return [b, bc2]; };
  let [s0, cur] = bestStart(order);
  if (!(saved && saved.R)) for (let pass = 0; pass < 4; pass++) { let better = false; for (let i = 0; i + 1 < order.length; i++) { const t = order.slice(); [t[i], t[i + 1]] = [t[i + 1], t[i]]; const [s1, c1] = bestStart(t); if (c1 < cur - 1) { order = t; s0 = s1; cur = c1; better = true; } } if (!better) break; }
  // exact rooms: each from where the last ended, to its area, the last closing the ring or leaving a spare
  let u = s0; const end = s0 + R.L;
  order.forEach((nd, i) => {
    const target = nd.area * 1e6 * grow, u1 = ringSolve(R, u, target, end);
    const poly = ringRoom(R, u, u1), area = Math.abs(polyArea(poly)) / 1e6, w = dist(ringAt(R, u).m, ringAt(R, u1).m);
    const warn = []; if (Math.abs(area - nd.area) / nd.area > 0.15) warn.push(`${area.toFixed(1)} m² for ${nd.area} m²`);
    if (nd.ratio) { const r = (u1 - u) / o.roomDepth; if (r < nd.ratio[0] - 0.02 || r > nd.ratio[1] + 0.02) warn.push(`width:depth ${r.toFixed(2)} outside ${nd.ratio[0]}–${nd.ratio[1]}`); }
    const off = circDist((u + u1) / 2, want.get(nd.id), R.L); if (weight.get(nd.id) > 1 && off > 3000) warn.push(`${(off / 1000).toFixed(1)} m from where it is pulled`);
    rooms.push({ id: nd.id, name: nd.name, number: nd.number, dept: nd.dept, zone: nd.zone, strip: "R", slot: i, u0: u, u1, poly, area, target: nd.area, ratio: (u1 - u) / o.roomDepth, facade: true, warn, pull: weight.get(nd.id) > 1 ? off : null });
    u = u1;
  });
  if (end - u > 1500) spares.push({ strip: "R", u0: u, u1: end, poly: ringRoom(R, u, end) });
  // the core: sliced across its long axis, each room to its area
  const coreRooms = [];
  if (R.core && inCore.length) {
    const pts = R.core, c0 = pts.reduce((a, p) => add(a, p), [0, 0]).map(v => v / pts.length);
    let xx = 0, xy = 0, yy = 0; for (const p of pts) { const dx = p[0] - c0[0], dy = p[1] - c0[1]; xx += dx * dx; xy += dx * dy; yy += dy * dy; }
    const a = 0.5 * Math.atan2(2 * xy, xx - yy), ax = [Math.cos(a), Math.sin(a)], xs = pts.map(p => dot(p, ax)), lo0 = Math.min(...xs), hi0 = Math.max(...xs);
    const cdemand = inCore.reduce((s, nd) => s + nd.area * 1e6, 0), cgrow = Math.min(1.15, coreArea / cdemand);
    if (cgrow < 0.98) report.push(`${st.name}: the core holds ${(coreArea / 1e6).toFixed(0)} m², the spaces in it ask ${(cdemand / 1e6).toFixed(0)} m²`);
    const order2 = saved && saved.C ? saved.C.map(id => inCore.find(nd => nd.id === id)).filter(Boolean).concat(inCore.filter(nd => !(saved.C || []).includes(nd.id))) : inCore.slice().sort((p, q) => dot([(p.x || 0), (p.y || 0)], ax) - dot([(q.x || 0), (q.y || 0)], ax));
    let x = lo0;
    for (const nd of order2) {
      const target = nd.area * 1e6 * cgrow; let lo = x, hi = hi0;
      for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (Math.abs(polyArea(clipStrip(pts, ax, x, m))) < target) lo = m; else hi = m; }
      const x1 = (lo + hi) / 2, poly = clipStrip(pts, ax, x, x1), area = Math.abs(polyArea(poly)) / 1e6;
      coreRooms.push({ id: nd.id, name: nd.name, number: nd.number, dept: nd.dept, zone: nd.zone, strip: "C", x0: x, x1, poly, area, target: nd.area, facade: false, warn: Math.abs(area - nd.area) / nd.area > 0.15 ? [`${area.toFixed(1)} m² for ${nd.area} m²`] : [] });
      x = x1;
    }
    if (hi0 - x > 1500) spares.push({ strip: "C", x0: x, x1: hi0, poly: clipStrip(pts, ax, x, hi0) });
    // cut walls across the core, and the core's doors on its edge nearest each room
    for (const r of coreRooms.slice(0, -1)) { const cut = chordAt(pts, ax, r.x1); if (cut) walls.push({ a: cut[0], b: cut[1], kind: "cross", pid: r.id }); }
    for (const sp of spares.filter(s => s.strip === "C")) { const cut = chordAt(pts, ax, sp.x0); if (cut) walls.push({ a: cut[0], b: cut[1], kind: "cross", pid: "spare" }); }
    coreRooms.forEach(r => { r.ax = ax; });
  }
  // walls: the facade, the corridor side of the rooms, the core, and a cross wall at every room boundary
  R.P.forEach((a, i) => walls.push({ a, b: R.P[(i + 1) % R.P.length], kind: "exterior", pid: "perimeter" }));
  const innerStart = walls.length; R.inner.forEach((a, i) => walls.push({ a, b: R.inner[(i + 1) % R.inner.length], kind: "corridor", pid: "corridor" }));
  const coreStart = walls.length; if (R.core) R.core.forEach((a, i) => walls.push({ a, b: R.core[(i + 1) % R.core.length], kind: "core", pid: "core" }));
  for (const r of rooms) { const p = ringAt(R, r.u1); if (Math.abs(r.u1 - (s0 + R.L)) > 1 || spares.some(s => s.strip === "R")) walls.push({ a: p.o, b: p.i, kind: "cross", pid: r.id }); }
  if (rooms.length) { const p = ringAt(R, s0); walls.push({ a: p.o, b: p.i, kind: "cross", pid: rooms[0].id }); }
  for (const r of rooms) {
    const um = (r.u0 + r.u1) / 2, p = ringAt(R, um);
    spaces.push({ name: r.name, number: r.number || r.id, dept: r.dept || r.zone, at: lerp(p.o, p.i, 0.5), pid: r.id });
    if (dist(ringAt(R, r.u0).i, ringAt(R, r.u1).i) >= 1500) { const k = p.edge; doors.push({ wall: innerStart + k, at: dist(R.inner[k], p.i), pid: r.id }); }
  }
  for (const r of coreRooms) {
    const c = r.poly.reduce((a, q) => add(a, q), [0, 0]).map(v => v / r.poly.length);
    spaces.push({ name: r.name, number: r.number || r.id, dept: r.dept || r.zone, at: c, pid: r.id });
    // the door: on the core edge nearest the room's middle, where it touches the room
    let best = null, bd = Infinity; R.core.forEach((a, k) => { const b = R.core[(k + 1) % R.core.length], d = sub(b, a), L2 = dot(d, d) || 1, t = Math.max(0.05, Math.min(0.95, dot(sub(c, a), d) / L2)), q = add(a, mul(d, t)), dd = dist(c, q); if (dd < bd && pointInPoly(lerp(q, c, 0.02), r.poly.length > 2 ? r.poly : [q, q, q])) { bd = dd; best = { k, at: t * Math.sqrt(L2), len: Math.sqrt(L2) }; } });
    if (best && best.len > 1500) doors.push({ wall: coreStart + best.k, at: Math.max(600, Math.min(best.len - 600, best.at)), pid: r.id });
  }
  const corr = ringAt(R, s0), cin = R.core ? lerp(corr.i, R.core[corr.edge], 0.5) : lerp(corr.i, cp, 0.1);
  spaces.push({ name: "Circulation", number: "C1", dept: "Circulation", at: lerp(corr.i, cin, 0.5), pid: "corridor" });
  spares.forEach((sp, i) => { const c = sp.poly.reduce((a, q) => add(a, q), [0, 0]).map(v => v / sp.poly.length); spaces.push({ name: "Spare", number: `S${i + 1}`, dept: "Unassigned", at: c, pid: "spare" }); });
  const ringA = ringArea / 1e6, coreA = coreArea / 1e6, gia = Math.abs(polyArea(R.P)) / 1e6;
  return { plate: R.P, inner: R.inner, core: R.core, rooms: rooms.concat(coreRooms), spares, s0,
    metrics: { gia, ring: ringA, corridor: gia - ringA - coreA, core: coreA, packed: rooms.concat(coreRooms).reduce((a, r) => a + r.area, 0) },
    model: { slab: R.P, walls, spaces, doors }, order: { R: order.map(nd => nd.id), C: coreRooms.map(r => r.id) } };
}
/** Where the line dot(p, ax) = x crosses a polygon: its two outermost crossings. */
function chordAt(poly, ax, x) {
  const hits = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], da = dot(a, ax) - x, db = dot(b, ax) - x; if ((da > 0) !== (db > 0)) hits.push(lerp(a, b, da / (da - db))); }
  if (hits.length < 2) return null; const n = [-ax[1], ax[0]]; hits.sort((p, q) => dot(p, n) - dot(q, n)); return [hits[0], hits[hits.length - 1]];
}
/** A space graph planned on a massing's storeys: levels assigned, each plate packed, and the metrics. */
export function planOnMassing(sg, nodes, edges, o, storeys, report) {
  const packable = nodes.filter(nd => nd.zone !== "Circulation");
  const assign = assignLevels(packable, edges, storeys, o, report);
  const out = { massing: true, levels: [], report, options: o, order: {}, storeys };
  storeys.forEach((st, i) => {
    const ns = packable.filter(nd => assign.at.get(nd.id) === i);
    const saved = sg.order && sg.order[st.key];
    const pk = packPlate(st, ns, sg, o, report, saved);
    if (!pk) return;
    out.order[st.key] = pk.order || {};
    out.levels.push({ key: st.key, name: st.name, z: st.z, kind: pk.core ? "facade ring + core" : "facade ring", rooms: pk.rooms, spares: pk.spares, corridors: [], plate: pk.plate, inner: pk.inner, core: pk.core, model: pk.model,
      metrics: Object.assign({ capacity: assign.cap[i], assigned: assign.used[i] }, pk.metrics || {}) });
  });
  const T = k => out.levels.reduce((a, L) => a + ((L.metrics || {})[k] || 0), 0);
  const program = packable.reduce((a, nd) => a + nd.area, 0) + nodes.filter(nd => nd.zone === "Circulation").reduce((a, nd) => a + nd.area, 0);
  const site = sg.site && sg.site.boundary && sg.site.boundary.length >= 3 ? Math.abs(polyArea(sg.site.boundary)) / 1e6 : null;
  const perStorey = out.levels.length ? T("capacity") / out.levels.length : 0;
  out.metrics = { program, gia: T("gia"), capacity: T("capacity"), packed: T("packed"), storeys: out.levels.length,
    storeysNeeded: perStorey ? Math.ceil(program / perStorey) : null, efficiency: T("gia") ? T("packed") / T("gia") : 0,
    far: site ? T("gia") / site : null, coverage: site && out.levels[0] ? out.levels[0].metrics.gia / site : null, site };
  return out;
}

// ---------------------------------------------------------------- structured briefs
//! Briefs written for machines as well as people - like a masterplan brief with a node table in JSON,
//! typed edges ("A -> B | ADJ | 5 | note") and external nodes (a station, a boulevard). Read without
//! AI: the JSON nodes (and table rows the JSON left out), every edge with its relation and strength,
//! groups named in an edge ("LIF precinct", "H01/H02/H03", "P-*", "all precincts"), and context nodes
//! (outside the plot) placed on the side of the site the brief says.
const SG_REL = { ADJ: 1, CONN: 0.7, SERV: 0.8, STACK: 0.9, VIEW: 0.35 };
/** An edge's pull in the relaxation from its relation and strength (1 weak … 5 must); SEP pushes apart. */
export const relWeight = (rel, s5) => rel === "SEP" ? -1 : Math.round((SG_REL[rel] || 0.7) * (s5 || 3) * 0.6 * 100) / 100;
const USE_DEFAULTS = {
  retail_anchor: { zone: "Room", storeys: 1, f2f: 7000, facade: true }, retail: { zone: "Room", storeys: 2, f2f: 6500, facade: true },
  leisure: { zone: "Room", storeys: 1, f2f: 8000, facade: true }, fnb: { zone: "Room", storeys: 2, f2f: 6500, facade: true },
  office: { zone: "Tower", storeys: 25, f2f: 4100, facade: true }, hotel: { zone: "Tower", storeys: 17, f2f: 3500, facade: true },
  residential: { zone: "Tower", storeys: 12, f2f: 3200, facade: true }, parking: { zone: "Parking", storeys: 3, f2f: 6000, facade: false },
  service: { zone: "BOH", storeys: 1, f2f: 6000, facade: false }, plant: { zone: "BOH", storeys: 1, f2f: 6000, facade: false },
};
const rangeMid = v => { if (typeof v === "number") return v; const m = String(v ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/); return m ? (m[2] ? (Number(m[1]) + Number(m[2])) / 2 : Number(m[1])) : NaN; };
/** Is this text a structured brief (a JSON node table, or typed edges)? */
export function looksStructured(text) { return /"nodes"\s*:\s*\[/.test(text) || /^\s*[\w\/ .&,*-]+->\s*[^|]+\|\s*[A-Z]{3,5}\s*\|\s*\d/m.test(text); }
/** The first balanced JSON object in the text that has a "nodes" array. */
function jsonWithNodes(text) {
  const at = text.search(/\{\s*"(site|nodes)"/); if (at < 0) return null;
  let depth = 0, inStr = false;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) { try { const j = JSON.parse(text.slice(at, i + 1)); return j.nodes ? j : null; } catch (e) { return null; } }
  }
  return null;
}
export function programFromStructuredBrief(text) {
  const report = [], nodes = [], edges = [], byId = new Map();
  const add = nd => { nodes.push(nd); byId.set(nd.id, nd); return nd; };
  const j = jsonWithNodes(text);
  const USE_DEPT = { office: "Office", hotel: "Hotel", residential: "Residential", parking: "Parking", service: "Service", plant: "Service" };
  const precinctOf = (p, use) => { const s = String(p || "").trim(); return !s ? (USE_DEPT[use] || "Mixed") : /^all$/i.test(s) ? "Mixed" : s.split("/")[0].trim(); };
  for (const n of (j && j.nodes) || []) {
    const use = String(n.use || "").toLowerCase(), d = USE_DEFAULTS[use] || USE_DEFAULTS.retail;
    let area = rangeMid(n.gla ?? n.gfa ?? n.nla ?? n.area ?? n.area_m2 ?? n.footprint_m2);
    let note = "";
    if (!(area > 0) && n.bays_day1) { area = rangeMid(n.bays_day1) * 31; note = `${n.bays_day1} bays × 31 m²`; }
    if (!(area > 0) && n.keys) { area = rangeMid(n.keys) * 70; note = `${n.keys} keys × 70 m²`; }
    if (!(area > 0) && use === "service") { area = 1500; note = "assumed 1,500 m²"; }
    if (!(area > 0)) { report.push(`${n.id} ${n.name}: no area - kept as context`); add({ id: n.id, name: n.name, zone: "Context", area: 0, facade: false, dept: precinctOf(n.precinct, use), use }); continue; }
    let storeys = Number(n.levels) > 0 ? Number(n.levels) : Number(n.room_floors) > 0 ? Number(n.room_floors) + 1 : d.storeys;
    if (n.height_m && !(Number(n.levels) > 0)) storeys = 1;
    const f2f = n.f2f_m ? n.f2f_m * 1000 : n.height_m && storeys === 1 ? n.height_m * 1000 : d.f2f;
    const plate = n.plate_gfa ? Number(n.plate_gfa) : n.footprint_m2 ? rangeMid(n.footprint_m2) : null;
    if (n.plate_gfa && !(Number(n.levels) > 0)) storeys = Math.max(1, Math.round(area / n.plate_gfa));
    add({ id: n.id, name: n.name, base: n.name, number: n.id, dept: precinctOf(n.precinct, use), use, zone: d.zone, area, facade: d.facade, storeys, f2f, plate, pilotis: !!n.on_pilotis, note, level: "" });
  }
  // a decision stated once for a kind ("parking decks elevated on pilotis") holds for every node of that kind
  if (/pilotis/i.test(text) && nodes.some(n => n.pilotis)) for (const n of nodes) if (n.use === "parking") n.pilotis = true;
  // rows of the written tables the JSON did not carry: "  S04  Waste / compactor room 230 m², …"
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s{1,4}([A-Z]\d{2}|[A-Z]-[A-Z]{3})\s{2,}([A-Za-z][^|]*?)(?:\s{2,}|$)(.*)$/); if (!m || byId.has(m[1])) continue;
    const name = m[2].replace(/\s+\d[\d,]*.*$/, "").replace(/\s*[\[(,].*$/, "").trim(); if (!name || name.length > 60) continue;
    const am = (m[2] + " " + m[3]).match(/(\d[\d,]*(?:\s*[-–]\s*\d[\d,]*)?)\s*m²/);
    const area = am ? rangeMid(am[1]) : 0;
    const svc = /^S\d/.test(m[1]);
    add({ id: m[1], name, base: name, number: m[1], dept: svc ? "Service" : "Mixed", use: svc ? "service" : "", zone: area > 0 ? (svc ? "BOH" : "Room") : /ring|corridor|core/i.test(name) ? "Circulation" : "Context", area, facade: !svc, storeys: 1, f2f: 6000, level: "" });
  }
  // where the context nodes are: the site section's compass words
  // the site section: from its numbered heading to the next numbered heading
  const sAt = text.search(/^\s*\d+\.\s+SITE\b/m), rest = sAt >= 0 ? text.slice(sAt + 10) : "", nx = rest.search(/^\s*\d+\.\s+[A-Z]/m);
  const siteText = sAt >= 0 ? rest.slice(0, nx > 0 ? nx : undefined) : text;
  // the line that names it (near its start) says which side: "PUA light-rail … SOUTH edge", "Grand Central Station (GCS) WEST"
  const sideOf = key => { const words = key.toLowerCase().split(/[_\s]+/).filter(w => w.length > 2 && !/station|head|edge|retail|the|own/.test(w)); if (!words.length) return null; for (const line of siteText.split("\n")) { const l = line.trim().toLowerCase(), lead = l.slice(0, 40); if (!/^!!/.test(l) && words.some(w => lead.includes(w))) { const d = l.match(/\b(north|south|east|west)\b/); if (d) return d[1]; } } return null; };
  const context = key => {
    const id = key.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, ""); if (byId.has(id)) return byId.get(id);
    const nm = key.replace(/_/g, " ").split(/\s+/).map(w => w.length <= 4 && w === w.toUpperCase() && /[A-Z]/.test(w) && !/^(THE|AND|HEAD|OWN|OF|TO)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    const circ = /spine|street|pulse|ring|loop/i.test(key);
    return add({ id, name: nm, zone: circ ? "Circulation" : "Context", area: 0, facade: false, dept: "Context", side: circ ? null : sideOf(key), level: "" });
  };
  // a reference in an edge → the nodes it means
  const retailish = () => nodes.filter(n => n.zone === "Room" && /retail|leisure|fnb/.test(n.use || "retail"));
  const resolve = raw => {
    let s = raw.replace(/\(.*?\)/g, "").trim(); if (!s) return [];
    if (/^(all precincts|every retail unit|every shopfront|all retail)$/i.test(s)) return retailish();
    const pm = s.match(/^(\w+)\s+precinct$/i); if (pm) { const g = nodes.filter(n => String(n.dept).toUpperCase() === pm[1].toUpperCase()); return g.length ? g : [context(s)]; }
    const star = s.match(/^([A-Z]+-)\*$/); if (star) return nodes.filter(n => n.id.startsWith(star[1]));
    // lists: "R04, R05, R06", "H01/H02/H03"; a leading id names the node ("R01 ULO", "S01 docks")
    const parts = s.split(/\s*[,\/]\s*/).map(x => x.trim()).filter(Boolean);
    const ids = parts.map(p => (p.match(/^([A-Z]\d{2}|[A-Z]-[A-Z]{3})\b/) || [])[1]).filter(Boolean);
    if (ids.length && ids.every(id => byId.has(id))) return ids.map(id => byId.get(id));
    const lead = s.match(/^([A-Z]\d{2}|[A-Z]-[A-Z]{3})\b/); if (lead && byId.has(lead[1])) return [byId.get(lead[1])];
    const named = nodes.find(n => n.name && n.name.toLowerCase() === s.toLowerCase()); if (named) return [named];
    return [context(parts[0])];
  };
  const seen = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(.+?)\s*->\s*(.+?)\s*\|\s*([A-Z]{3,5})\s*\|\s*(\d)\s*\|?\s*(.*)$/); if (!m) continue;
    const rel = m[3], s5 = Number(m[4]), A = resolve(m[1]), B = resolve(m[2]);
    for (const a of A) for (const b of B) {
      if (a === b) continue; const k = [a.id, b.id].sort().join("|") + rel;
      if (seen.has(k)) continue; seen.set(k, true);
      const w = relWeight(rel, s5);
      edges.push({ a: a.id, b: b.id, w, rel, s: s5, note: m[5].trim() });
    }
  }
  // the site, as the brief states it
  const site = {};
  if (j && j.site) { if (j.site.area_total_m2) site.area = j.site.area_total_m2; if (j.site.area_developable_m2) site.developable = j.site.area_developable_m2; }
  const kinds = {}; for (const e of edges) kinds[e.rel] = (kinds[e.rel] || 0) + 1;
  report.unshift(`${nodes.filter(n => n.area > 0).length} programme nodes, ${nodes.filter(n => !(n.area > 0)).length} context nodes, ${edges.length} edges (${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(", ")})`);
  return { nodes, edges, report, site, structured: true };
}

// ---------------------------------------------------------------- block massing (a first attempt, no site needed)
//! At masterplan scale the first attempt is not rooms but volumes: each programme element a block
//! whose footprint is its area over its storeys, as tall as its storeys times its floor-to-floor,
//! placed where the relaxed graph puts it (context nodes held on their side of the site), pushed
//! apart by a street, and - when there is a site - held inside what the setbacks allow.
const SG_ASPECT = { retail_anchor: 1.5, leisure: 1.3, retail: 2.2, fnb: 2.2, office: 1.2, hotel: 1.8, residential: 2.5, parking: 2.6, service: 1.8, plant: 1.6 };
export function blockOf(nd) {
  const d = USE_DEFAULTS[nd.use] || (nd.zone === "Tower" ? USE_DEFAULTS.office : nd.zone === "Parking" ? USE_DEFAULTS.parking : nd.zone === "BOH" ? USE_DEFAULTS.service : USE_DEFAULTS.retail);
  let storeys = Math.max(1, Math.round(nd.storeys || d.storeys)), fp = nd.plate ? nd.plate : nd.area / storeys;
  if (nd.plate) storeys = Math.max(1, Math.ceil(nd.area / nd.plate));
  const asp = SG_ASPECT[nd.use] || (nd.zone === "Tower" ? 1.3 : 1.8), w = Math.sqrt(fp * asp) * 1000, dd = Math.sqrt(fp / asp) * 1000;
  const f2f = nd.f2f || d.f2f, z0 = nd.pilotis ? 6000 : 0;
  return { id: nd.id, name: nd.name, dept: nd.dept, use: nd.use, zone: nd.zone, area: nd.area, storeys, footprint: fp, w, d: dd, f2f, z0, z1: z0 + storeys * f2f };
}
export function planBlocks(sg, nodes, edges, o, report) {
  const prog = nodes.filter(n => n.area > 0 && n.zone !== "Context" && n.zone !== "Circulation");
  const blocks = prog.map(blockOf), byId = new Map(blocks.map(b => [b.id, b]));
  const totalFp = blocks.reduce((a, b) => a + b.footprint, 0), totalA = prog.reduce((a, n) => a + n.area, 0) || 1;
  // the bubble diagram, scaled from programme area to footprint, relaxed again at that scale
  const k = Math.sqrt(totalFp / totalA);
  const dirs = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };
  // the frame: the site's middle (metres), and how far each compass side is - or a circle round the programme
  const buildable = sg.site && sg.site.boundary && sg.site.boundary.length >= 3 ? buildableArea(sg.site.boundary, sg.site.setbacks || []) : null;
  const B0 = sg.site && sg.site.boundary && sg.site.boundary.length >= 3 ? sg.site.boundary : null;
  const C = B0 ? B0.reduce((a, p) => add(a, p), [0, 0]).map(v => v / B0.length / 1000) : [0, 0];
  const reach = d => B0 ? Math.max(...B0.map(p => (p[0] / 1000 - C[0]) * d[0] + (p[1] / 1000 - C[1]) * d[1])) + 30 : Math.sqrt(totalFp / Math.PI) * 1.3;
  // an attractor (a point where you want a thing - a department store here, the station there) holds its block at that point
  const attr = (sg.site && sg.site.attractors) || [];
  const phys = nodes.filter(n => byId.has(n.id) || n.zone === "Context" || n.zone === "Circulation").map(n => {
    const b = byId.get(n.id), side = dirs[n.side], as = b ? attractorsFor(n, attr) : [];
    if (as.length) { const W = as.reduce((a, x) => a + (x.w || 1), 0), p = as.reduce((a, x) => add(a, mul(x.at, (x.w || 1) / W / 1000)), [0, 0]); return { id: n.id, area: b.footprint, x: p[0], y: p[1], pinned: true, held: true }; }
    return { id: n.id, area: b ? b.footprint : 1, x: C[0] + (side ? side[0] * reach(side) : (n.x || 0) * k), y: C[1] + (side ? side[1] * reach(side) : (n.y || 0) * k), pinned: !!side };
  });
  relaxBubbles(phys, edges, 400);
  // the programme's middle back on the site's middle (the relaxation drifts), context with it unless pinned
  const pm = phys.filter(p => byId.has(p.id)), mx = pm.reduce((a, p) => a + p.x, 0) / Math.max(1, pm.length) - C[0], my = pm.reduce((a, p) => a + p.y, 0) / Math.max(1, pm.length) - C[1];
  if (!phys.some(p => p.held)) for (const p of phys) if (!p.pinned) { p.x -= mx; p.y -= my; }
  // blocks at those points, then pushed apart until a street runs between every two
  const gap = o.street || 12000, pos = new Map(phys.map(p => [p.id, [p.x * 1000, p.y * 1000]]));
  for (const b of blocks) { const p = pos.get(b.id); b.x = p[0]; b.y = p[1]; }
  const attract = edges.filter(e => e.w >= 1.5 && byId.has(e.a) && byId.has(e.b));
  // held inside the buildable line: a corner outside moves the block in by exactly how far it is out
  const bc = buildable ? buildable.reduce((a, p) => add(a, p), [0, 0]).map(v => v / buildable.length) : null;
  const outBy = (p) => { if (pointInPoly(p, buildable)) return null; let best = null, bd = Infinity; for (let i = 0; i < buildable.length; i++) { const a = buildable[i], b = buildable[(i + 1) % buildable.length], d = sub(b, a), L2 = dot(d, d) || 1, t = Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)), q = add(a, mul(d, t)), dd = dist(p, q); if (dd < bd) { bd = dd; best = q; } } return sub(best, p); };
  const contain = b => { let mv = false; for (let k = 0; k < 4; k++) { const cs = [[b.x - b.w / 2, b.y - b.d / 2], [b.x + b.w / 2, b.y - b.d / 2], [b.x + b.w / 2, b.y + b.d / 2], [b.x - b.w / 2, b.y + b.d / 2]]; let worst = null, wl = 0; for (const c of cs) { const v = outBy(c); if (v && Math.hypot(...v) > wl) { wl = Math.hypot(...v); worst = v; } } if (!worst) break; const n = normalise(worst), push = add(worst, mul(n, 500)); b.x += push[0]; b.y += push[1]; mv = true; } return mv; };
  // greedy placement: attracted blocks first, then the biggest; each at the free spot nearest where the
  // graph wants it - inside the buildable line, a street clear of every block already placed, turned
  // 90° when that fits better. A block with no legal spot left keeps its wanted place and is reported.
  const target = new Map(blocks.map(b => [b.id, [b.x, b.y]])), held = new Set(phys.filter(p => p.held).map(p => p.id));
  const placed = [], cornersOf = (x, y, w, d) => [[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]];
  const inside = (x, y, w, d) => !buildable || cornersOf(x, y, w, d).every(c => pointInPoly(c, buildable)) && [[x, y - d / 2], [x + w / 2, y], [x, y + d / 2], [x - w / 2, y]].every(c => pointInPoly(c, buildable));
  // decks on pilotis are their own layer: they keep clear of each other, not of what stands under them
  let layer = false;
  const clear = (x, y, w, d) => placed.every(q => (q.z0 > 0) !== layer || Math.abs(x - q.x) >= (w + q.w) / 2 + gap - 1 || Math.abs(y - q.y) >= (d + q.d) / 2 + gap - 1);
  const ext = buildable ? (() => { const xs = buildable.map(p => p[0]), ys = buildable.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })() : null;
  // grow along the graph: next is the block most strongly tied to what is placed (held ones and the
  // biggest start it), aimed between its placed neighbours and where the bubbles put it
  const tie = new Map(blocks.map(b => [b.id, []])); for (const e of edges) if (e.w > 0 && tie.has(e.a) && tie.has(e.b)) { tie.get(e.a).push([e.b, e.w]); tie.get(e.b).push([e.a, e.w]); }
  const seq = [], left = new Set(blocks.map(b => b.id)), isPlaced = new Set();
  for (const lay of [false, true]) {
    for (;;) {
      const cand = blocks.filter(b => left.has(b.id) && (b.z0 > 0) === lay); if (!cand.length) break;
      const score = b => held.has(b.id) ? 1e9 : tie.get(b.id).reduce((a, [o, w]) => a + (isPlaced.has(o) ? w : 0), 0) * 1e6 + b.footprint;
      const next = cand.sort((a, b) => score(b) - score(a))[0]; seq.push(next); left.delete(next.id); isPlaced.add(next.id);
    }
  }
  const byIdPlaced = new Map();
  for (const b of seq) {
    layer = b.z0 > 0;
    const nb = tie.get(b.id).filter(([o]) => byIdPlaced.has(o)), W = nb.reduce((a, [, w]) => a + w, 0);
    if (W > 0 && !held.has(b.id)) { const m = nb.reduce((a, [o, w]) => add(a, mul([byIdPlaced.get(o).x, byIdPlaced.get(o).y], w / W)), [0, 0]), t = target.get(b.id); target.set(b.id, lerp(t, m, 0.75)); }
    const [tx, ty] = target.get(b.id), step = Math.max(3000, Math.min(gap, 8000));
    const maxR = ext ? Math.max(ext[2] - ext[0], ext[3] - ext[1]) : Math.sqrt(totalFp) * 1000 * 3;
    let best = null;
    for (let r = 0; r <= maxR && !best; r += step) {
      const cands = [];
      if (r === 0) cands.push([tx, ty]); else for (let t = -r; t < r; t += step) cands.push([tx + t, ty - r], [tx + r, ty + t], [tx - t, ty + r], [tx - r, ty - t]);
      cands.sort((p, q) => dist(p, [tx, ty]) - dist(q, [tx, ty]));
      // a keep-apart partner already placed: at least five streets away (the brief's dumbbell anchors want more; say so)
      const apart = edges.filter(e => e.w < 0 && (e.a === b.id || e.b === b.id)).map(e => byIdPlaced.get(e.a === b.id ? e.b : e.a)).filter(Boolean);
      const far = (x, y, w, d) => apart.every(q => Math.max(Math.abs(x - q.x) - (w + q.w) / 2, Math.abs(y - q.y) - (d + q.d) / 2) >= gap * 5);
      for (const [x, y] of cands) { for (const [w, d] of [[b.w, b.d], [b.d, b.w]]) if (inside(x, y, w, d) && clear(x, y, w, d) && far(x, y, w, d)) { best = { x, y, w, d }; break; } if (best) break; }
    }
    if (best) Object.assign(b, best); else { b.x = tx; b.y = ty; }
    placed.push(b); byIdPlaced.set(b.id, b);
  }
  // a deck over low-rise stands on its roof: it starts where the tallest thing it crosses ends
  for (const b of blocks) if (b.z0 > 0) {
    const under = blocks.filter(q => q.z0 === 0 && q.storeys <= 3 && Math.abs(b.x - q.x) < (b.w + q.w) / 2 && Math.abs(b.y - q.y) < (b.d + q.d) / 2);
    const z0 = Math.max(b.z0, ...under.map(q => q.z1)); b.z1 = z0 + (b.z1 - b.z0); b.z0 = z0; b.over = under.map(q => q.name);
  }
  // what could not be resolved is said, not hidden
  let overlaps = 0; for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) { const a = blocks[i], b = blocks[j]; if ((a.z0 > 0) === (b.z0 > 0) && Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1 && Math.abs(a.y - b.y) < (a.d + b.d) / 2 - 1) overlaps++; }
  const outside = buildable ? blocks.filter(b => [[b.x - b.w / 2, b.y - b.d / 2], [b.x + b.w / 2, b.y - b.d / 2], [b.x + b.w / 2, b.y + b.d / 2], [b.x - b.w / 2, b.y + b.d / 2]].some(p => outBy(p) && Math.hypot(...outBy(p)) > 1000)) : [];
  if (overlaps) report.unshift(`${overlaps} pair${overlaps === 1 ? "" : "s"} of blocks still overlap: the programme does not fit this plot at these storey counts with ${Math.round(gap / 1000)} m streets - add storeys, narrow the streets, or deck over`);
  if (outside.length) report.unshift(`${outside.map(b => b.name).join(", ")} ${outside.length === 1 ? "sits" : "sit"} over the buildable line`);
  if (!buildable && blocks.length) { const m = blocks.reduce((a, b) => add(a, [b.x, b.y]), [0, 0]).map(v => v / blocks.length); for (const b of blocks) { b.x -= m[0]; b.y -= m[1]; } for (const p of phys) if (!p.pinned) { p.x -= m[0] / 1000; p.y -= m[1] / 1000; } }
  for (const b of blocks) b.poly = [[b.x - b.w / 2, b.y - b.d / 2], [b.x + b.w / 2, b.y - b.d / 2], [b.x + b.w / 2, b.y + b.d / 2], [b.x - b.w / 2, b.y + b.d / 2]];
  // how the graph was met: adjacencies within a street and a half, keep-aparts at least three streets
  const gapOf = (a, b) => Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, Math.abs(a.y - b.y) - (a.d + b.d) / 2);
  const adj = edges.filter(e => e.w >= 2 && byId.has(e.a) && byId.has(e.b)), sep = edges.filter(e => e.w < 0 && byId.has(e.a) && byId.has(e.b));
  const adjMet = adj.filter(e => gapOf(byId.get(e.a), byId.get(e.b)) <= gap * 1.5), sepMet = sep.filter(e => gapOf(byId.get(e.a), byId.get(e.b)) >= gap * 3);
  for (const e of adj.filter(x => !adjMet.includes(x))) report.push(`${byId.get(e.a).name} — ${byId.get(e.b).name}: ${e.rel || "adjacent"} ${e.s || ""} asked, ${(gapOf(byId.get(e.a), byId.get(e.b)) / 1000).toFixed(0)} m apart`);
  for (const e of sep.filter(x => !sepMet.includes(x))) report.push(`${byId.get(e.a).name} — ${byId.get(e.b).name}: kept apart asked, only ${(gapOf(byId.get(e.a), byId.get(e.b)) / 1000).toFixed(0)} m`);
  const site = buildable ? Math.abs(polyArea(sg.site.boundary)) / 1e6 : (sg.site && sg.site.area) || null, dev = buildable ? Math.abs(polyArea(buildable)) / 1e6 : (sg.site && sg.site.developable) || null;
  const ground = blocks.filter(b => b.z0 < 1).reduce((a, b) => a + b.footprint, 0), gfa = blocks.reduce((a, b) => a + b.area, 0);
  const byDept = {}; for (const b of blocks) byDept[b.dept || "—"] = (byDept[b.dept || "—"] || 0) + b.area;
  if (dev && ground > dev) report.push(`the ground footprint is ${Math.round(ground).toLocaleString()} m², more than the ${Math.round(dev).toLocaleString()} m² developable - stack higher or deck over`);
  const xs = blocks.flatMap(b => [b.x - b.w / 2, b.x + b.w / 2]), ys = blocks.flatMap(b => [b.y - b.d / 2, b.y + b.d / 2]);
  return { mode: "blocks", blocks, levels: [], report, options: o, order: {}, buildable, site: buildable ? sg.site.boundary : null,
    context: phys.filter(p => !byId.has(p.id)).map(p => ({ id: p.id, name: (nodes.find(n => n.id === p.id) || {}).name, at: [p.x * 1000, p.y * 1000] })),
    metrics: { overlaps, outside: outside.length, gfa, ground, footprint: blocks.reduce((a, b) => a + b.footprint, 0), blocks: blocks.length, maxHeight: Math.max(0, ...blocks.map(b => b.z1)) / 1000,
      site, developable: dev, far: site ? gfa / site : null, coverage: site ? ground / site : null, byDept,
      adjacency: adj.length ? adjMet.length / adj.length : null, separation: sep.length ? sepMet.length / sep.length : null,
      extent: xs.length ? [(Math.max(...xs) - Math.min(...xs)) / 1000, (Math.max(...ys) - Math.min(...ys)) / 1000] : null } };
}

// ---------------------------------------------------------------- the legend
//! One colour key for the whole analysis - bubbles, plan, blocks in 3D: an entry per department (or use,
//! or zone), each with its colour and label. Made from the programme when there is none; read from an
//! image of a legend by Claude when you drop one; edited by hand.
export const SG_PALETTE = ["#e8a23b", "#d9534f", "#5b8fd6", "#62b27a", "#a77fd3", "#e07fb0", "#4fb3bf", "#c2a15e", "#8c9aa8", "#f0cf5a", "#7d6bb5", "#e3836b"];
const KNOWN_COLOURS = { ent: "#e8633b", lif: "#d9538f", day: "#62b27a", mixed: "#e8a23b", office: "#5b8fd6", hotel: "#a77fd3", residential: "#c2a15e", parking: "#9aa3ad", service: "#6b7280", context: "#cfd6de", circulation: "#e3e6ea", boh: "#8c9aa8" };
export function defaultLegend(nodes) {
  const keys = [...new Set(nodes.filter(n => n.zone !== "Context").map(n => n.dept || n.zone || "—"))];
  return keys.map((k, i) => ({ key: k, label: k, colour: KNOWN_COLOURS[String(k).toLowerCase()] || SG_PALETTE[i % SG_PALETTE.length] }));
}
/** A node's colour: its department's entry, then its use's, its zone's, its name's; else a stable palette colour. */
export function legendColour(legend, nd) {
  const L = legend || [], k = s => String(s || "").toLowerCase();
  for (const f of [nd.dept, nd.use, nd.zone, nd.name, nd.base]) { const e = L.find(x => k(x.key) === k(f) && f); if (e) return e.colour; }
  if (nd.zone === "Context") return KNOWN_COLOURS.context; if (nd.zone === "Circulation") return KNOWN_COLOURS.circulation;
  const key = k(nd.dept || nd.zone); if (KNOWN_COLOURS[key]) return KNOWN_COLOURS[key];
  let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SG_PALETTE[h % SG_PALETTE.length];
}
