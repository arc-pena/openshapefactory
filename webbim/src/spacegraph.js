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
export function planSpaceGraph(sg, { relax = true } = {}) {
  const o = Object.assign({}, SG_DEFAULTS, sg.options || {});
  // the room depth, unless set: the depth that best keeps the facade rooms' own proportions - each
  // room's preferred depth is sqrt(area / its width:depth), the middle of its range (0.8 when it has none)
  if (!(sg.options && sg.options.roomDepth)) {
    const pref = (sg.nodes || []).filter(nd => nd.facade && nd.zone !== "Circulation" && nd.area > 0).map(nd => { const r = nd.ratio ? (nd.ratio[0] + nd.ratio[1]) / 2 : 0.8; return Math.max(4000, Math.min(9000, Math.sqrt(nd.area * 1e6 / r))); }).sort((a, b) => a - b);
    if (pref.length) o.roomDepth = Math.round(pref[Math.floor(pref.length / 2)] / (o.module || 1)) * (o.module || 1);
  }
  const nodes = (sg.nodes || []).map(nd => Object.assign({}, nd)), edges = sg.edges || [], report = [];
  if (relax && nodes.length) relaxBubbles(nodes, edges, 250);
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
/**
 * The ops that make a plan real, replacing whatever this space graph built before: per level, the
 * perimeter walls, the corridor walls, a cross wall between neighbouring rooms, a floor slab, a
 * Space per room (named, numbered, its department) and per corridor, and a door from each room onto
 * the corridor. Everything carries SpaceGraph = the graph's id and ProgramId = its node, so a
 * rebuild finds and replaces it, and a room's walls are known as the room's.
 */
export function buildOpsFor(doc, sgId, plan, { levelFor, types = {} } = {}) {
  const ops = [], tag = pid => ({ SpaceGraph: sgId, ProgramId: pid });
  const old = doc.elements().filter(f => doc.getParam && doc.getParam(f, "SpaceGraph") !== undefined && (doc.getParam(f, "SpaceGraph") === sgId || (doc.getParam(f, "SpaceGraph") || {}).v === sgId));
  if (old.length) ops.push({ op: "delete", ids: old.map(f => doc.idOf(f)) });
  const fr = plan.frame, o = plan.options, ends = [];
  // ids are reused across rebuilds: what this graph built before is deleted first, in the same step
  const oldIds = new Set(old.map(f => doc.idOf(f)));
  let wn = 0; const wid = () => { let id; do { id = `${sgId}-W${++wn}`; } while (doc.element(id) && !oldIds.has(id)); return id; };
  const line = (a, b) => ({ type: "line", start: a.map(v => Math.round(v * 10) / 10), end: b.map(v => Math.round(v * 10) / 10) });
  for (const L of plan.levels) {
    const lv = levelFor(L.key); if (!lv) continue;
    const wall = (a, b, type, pid) => { const id = wid(); ops.push({ op: "add", element: { id, type: "Wall", name: id, args: { centreline: line(a, b), mounting: "Centred", wallType: { ref: type }, baseLevel: { ref: lv }, baseOffset: 0, height: o.wallHeight, flipped: false }, params: Object.assign({ Phase: "New" }, tag(pid)) } }); ends.push({ id, end: "start" }, { id, end: "end" }); return id; };
    const P = fr.poly;
    for (let i = 0; i < 4; i++) wall(P[i], P[(i + 1) % 4], types.exterior || "T-EXTCAV300", "perimeter");
    // corridor walls: every long edge between a strip and a corridor
    const corridorWalls = [];
    for (const st of L.strips) {
      if (st.key === "C") { const c = [fr.at(st.u0, st.v0), fr.at(st.u1, st.v0), fr.at(st.u1, st.v1), fr.at(st.u0, st.v1)]; for (let i = 0; i < 4; i++) corridorWalls.push({ id: wall(c[i], c[(i + 1) % 4], types.interior || "T-PART100", "core"), strip: "C", side: i, a: c[i], b: c[(i + 1) % 4] }); continue; }
      const v = st.v0 > 0 ? st.v0 : st.v1; if (v <= 0 || v >= fr.D) continue;
      corridorWalls.push({ id: wall(fr.at(0, v), fr.at(fr.W, v), types.interior || "T-PART100", "corridor"), strip: st.key, v });
    }
    // cross walls: between neighbouring rooms of a strip, facade (or core edge) to corridor
    for (const st of L.strips) {
      const rs = L.rooms.filter(r => r.strip === st.key).sort((a, b) => a.u0 - b.u0);
      const cuts = rs.slice(0, -1).map(r => r.u1).concat(L.spares.filter(sp => sp.strip === st.key).map(sp => sp.u0));
      for (const u of cuts) if (u > st.u0 + 1 && u < st.u1 - 1) wall(fr.at(u, st.v0), fr.at(u, st.v1), types.interior || "T-PART100", rs.find(r => Math.abs(r.u1 - u) < 1) ? rs.find(r => Math.abs(r.u1 - u) < 1).id : "spare");
    }
    // the slab
    ops.push({ op: "add", element: { type: "Floor", name: `${sgId} slab ${L.key || ""}`.trim(), args: { boundary: P.map(p => p.map(v => Math.round(v))), floorType: { ref: types.floor || "T-FLOOR250" }, level: { ref: lv }, heightOffset: 0 }, params: tag("slab") } });
    // rooms, corridors and spare slots as Spaces, anchored at their middles
    const upper = { mode: "offset", offset: o.wallHeight };
    for (const r of L.rooms) {
      const c = fr.at((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
      ops.push({ op: "add", element: { type: "Space", name: r.name, args: { level: { ref: lv }, upperLimit: upper, anchor: c.map(Math.round), boundaryAt: "wallCentre" }, params: Object.assign({ Number: r.number || r.id, Department: r.dept || r.zone }, tag(r.id)) } });
    }
    L.corridors.forEach((c, i) => { const m = fr.at((c.u0 + c.u1) / 2, (c.v0 + c.v1) / 2); ops.push({ op: "add", element: { type: "Space", name: "Circulation", args: { level: { ref: lv }, upperLimit: upper, anchor: m.map(Math.round), boundaryAt: "wallCentre" }, params: Object.assign({ Number: `C${i + 1}`, Department: "Circulation" }, tag("corridor")) } }); });
    L.spares.forEach((sp, i) => { const m = fr.at((sp.u0 + sp.u1) / 2, (sp.v0 + sp.v1) / 2); ops.push({ op: "add", element: { type: "Space", name: "Spare", args: { level: { ref: lv }, upperLimit: upper, anchor: m.map(Math.round), boundaryAt: "wallCentre" }, params: Object.assign({ Number: `S${i + 1}`, Department: "Unassigned" }, tag("spare")) } }); });
    // doors: each room onto the corridor wall it faces, at its middle
    if (o.doors !== false && types.door) for (const r of L.rooms) {
      const cw = r.strip === "C" ? null : corridorWalls.find(w => w.strip === r.strip); if (!cw) continue;
      const u = (r.u0 + r.u1) / 2; if (r.u1 - r.u0 < 1500) continue;
      let opId = `${sgId}-O-${r.id}`.replace(/[^A-Za-z0-9-]/g, ""); while (doc.element(opId) && !oldIds.has(opId)) opId += "x";
      ops.push({ op: "add", element: { id: opId, type: "Opening", args: { host: { ref: cw.id }, profile: { kind: "rect", at: Math.round(u), sill: 0, w: types.doorWidth || 915, h: types.doorHeight || 2100 }, farProfile: null, depth: "through" }, params: tag(r.id) } });
      ops.push({ op: "add", element: { type: "Door", args: { fills: { ref: opId }, doorType: { ref: types.door } }, params: Object.assign({ Phase: "New" }, tag(r.id)) } });
    }
  }
  if (ends.length) ops.push({ op: "autojoin", ends });
  return ops;
}
