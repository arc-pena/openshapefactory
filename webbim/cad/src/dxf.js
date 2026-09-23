// DXF: a drawing in, a drawing out.
//
// DXF is a tagged list. Every value in the file is two lines - a group code
// saying what the next line means, then the line itself - and everything else
// about the format is a convention about which codes appear together. So the
// parser here is twelve lines, and all the work is in the conventions.
//
// What comes in is a SKETCH, not a shape. That is the whole point of the
// exercise: a DXF that lands as a sketch can be constrained, dimensioned,
// dragged and extruded, and the profile of a slab can be an outline somebody
// else drew in AutoCAD. A DXF that landed as a dumb mesh could be none of
// those things.
//
// The mapping has three rules.
//
//   Everything that is a curve becomes the element that IS that curve. An arc
//   stays an arc, not a run of chords. An ellipse stays an ellipse. A spline
//   keeps its control points, its knots and its degree, so the curve in the
//   sketcher is the curve in the file rather than a picture of it.
//
//   Everything that is a chain becomes its links. A polyline is lines and
//   arcs - a bulge IS an arc, exactly - joined by coincidences, because that
//   is what makes a corner draggable afterwards.
//
//   Everything else is counted and named. A drawing is full of things a
//   sketch has no meaning for - text, dimensions, hatches, viewports - and
//   the one unacceptable answer is to drop them silently.

import { SKETCH_TYPES, isConstruction, sketchOutline, sketchOverlaps,
         sketchRound } from "./sketch.js";

/* ------------------------------------------------------------------ units */

//! $INSUNITS, which is the only thing in a DXF that says how big it is. Most
//! files say 0 - "unitless" - and then the number 4200 means whatever the
//! person who drew it meant. That is a question for the person importing it,
//! which is why this table is exported rather than applied.
export const DXF_UNITS = [
  { code: 0,  key: "none",   label: "Unitless", mm: 1 },
  { code: 1,  key: "in",     label: "Inches",   mm: 25.4 },
  { code: 2,  key: "ft",     label: "Feet",     mm: 304.8 },
  { code: 4,  key: "mm",     label: "Millimetres", mm: 1 },
  { code: 5,  key: "cm",     label: "Centimetres", mm: 10 },
  { code: 6,  key: "m",      label: "Metres",   mm: 1000 },
  { code: 9,  key: "um",     label: "Microns",  mm: 0.001 },
  { code: 10, key: "yd",     label: "Yards",    mm: 914.4 },
  { code: 11, key: "ang",    label: "Angstroms", mm: 1e-7 },
  { code: 14, key: "dm",     label: "Decimetres", mm: 100 },
];

export const unitsOf = code => DXF_UNITS.find(u => u.code === code) || DXF_UNITS[0];
export const unitsNamed = key => DXF_UNITS.find(u => u.key === key) || DXF_UNITS[0];

//! How many elements a sketch will take from one file. A floor plan exported
//! whole is a hundred thousand entities of furniture, text and hatching, and
//! putting that in a sketch makes a document nobody can open. The limit is
//! said out loud with the count, so the answer is "turn those layers off",
//! not "it did not work".
export const DXF_LIMIT = 20000;

/* ----------------------------------------------------------- the tag list */

const NUMBER = code =>
  (code >= 10 && code <= 59) || (code >= 110 && code <= 149) || (code >= 210 && code <= 239)
  || (code >= 460 && code <= 469) || (code >= 1010 && code <= 1059);
const INTEGER = code =>
  (code >= 60 && code <= 79) || (code >= 90 && code <= 99) || (code >= 160 && code <= 179)
  || (code >= 270 && code <= 289) || (code >= 370 && code <= 389) || (code >= 400 && code <= 409);

//! The file as a flat run of [code, value]. Binary DXF is not read here - it
//! begins with a sentinel this refuses by name rather than by producing
//! nothing.
export function dxfTags(text) {
  if (String(text).startsWith("AutoCAD Binary DXF"))
    throw new Error("this is a binary DXF; save it as ASCII DXF and try again");
  const lines = String(text).split(/\r\n|\r|\n/);
  const tags = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) continue;
    const raw = lines[i + 1];
    if (code === 999) continue;                          // a comment
    tags.push([code, NUMBER(code) ? Number(raw) : INTEGER(code) ? parseInt(raw, 10) : raw.trim()]);
  }
  return tags;
}

//! One entity: its type, and its tags in the order they were written. The
//! order matters and this is why the tags are kept rather than folded into an
//! object - a LWPOLYLINE's vertices are 10, 20 and sometimes 42, repeated,
//! and which bulge belongs to which vertex is the order and nothing else.
const entity = (type, tags) => ({
  type, tags,
  first(code, fallback = undefined) {
    for (const [c, v] of tags) if (c === code) return v;
    return fallback;
  },
  all(code) {
    const out = [];
    for (const [c, v] of tags) if (c === code) out.push(v);
    return out;
  },
  get layer() { return this.first(8, "0"); },
});

//! The file, taken apart: the header values worth having, the blocks by name,
//! and the entities of the drawing itself.
export function parseDxf(text) {
  const tags = dxfTags(text);
  const header = {};
  const blocks = new Map();
  const entities = [];
  const table = new Map();                // the layer table: name -> what it says

  let section = "";
  let holder = entities;                  // where entities are being collected
  let block = null;
  let current = null;
  let variable = "";

  const close = () => {
    if (!current) return;
    // A POLYLINE owns the VERTEXes that follow it, up to SEQEND. They are
    // written as separate entities and they are not separate things.
    if (current.type === "LAYER" && section === "TABLES") {
      const name = current.first(2, "");
      if (name) table.set(name, { name,
        on: current.first(62, 7) >= 0 && !(current.first(70, 0) & 1),
        locked: !!(current.first(70, 0) & 4) });
      current = null;
      return;
    }
    const last = holder.length ? holder[holder.length - 1] : null;
    if (current.type === "VERTEX" && last && last.type === "POLYLINE") last.vertices.push(current);
    else if (current.type === "SEQEND") { /* nothing: the run has ended */ }
    else {
      if (current.type === "POLYLINE") current.vertices = [];
      holder.push(current);
    }
    current = null;
  };

  for (const [code, value] of tags) {
    if (code === 0) {
      close();
      if (value === "SECTION") { section = ""; continue; }
      if (value === "ENDSEC") { section = ""; holder = entities; continue; }
      if (value === "EOF") break;
      if (section === "BLOCKS" && value === "BLOCK") {
        block = { name: "", base: [0, 0], entities: [] };
        holder = block.entities;
        continue;
      }
      if (section === "BLOCKS" && value === "ENDBLK") {
        if (block && block.name) blocks.set(block.name, block);
        block = null;
        holder = entities;
        continue;
      }
      if (section === "ENTITIES" || section === "BLOCKS") current = entity(value, []);
      // A LAYER row of the table says whether the layer is off (its colour is
      // written negative) and whether it is frozen or locked. That is the
      // state a drawing carries, and it is worth keeping.
      if (section === "TABLES" && value === "LAYER") current = entity("LAYER", []);
      continue;
    }

    if (!section) {
      // The name of the section just opened, or a header variable's name.
      if (code === 2) section = value;
      continue;
    }
    if (section === "HEADER") {
      if (code === 9) { variable = value; continue; }
      if (variable && header[variable] === undefined) header[variable] = value;
      continue;
    }
    if (block && !current) {
      if (code === 2) block.name = value;
      else if (code === 10) block.base[0] = value;
      else if (code === 20) block.base[1] = value;
      continue;
    }
    if (current) current.tags.push([code, value]);
  }
  close();

  return { header, blocks, entities, table };
}

/* ------------------------------------------------------------- the survey

   What is in the file, before anybody decides what to do with it: which
   layers, how many entities on each, what the header says the units are.
   The import dialog is built from this, which is why it is separate from the
   conversion - you cannot choose the layers after they have been brought in. */

//! Which layer an entity is really on. Inside a block, layer 0 means the
//! layer the block was put on - which is the whole reason a door on the DOORS
//! layer is drawn with lines that say they are on layer 0.
const layerOf = (e, inherited) => {
  const own = e.layer || "0";
  return own === "0" && inherited ? inherited : own;
};

export function dxfSurvey(text) {
  const { header, blocks, entities } = parseDxf(text);
  const layers = new Map();
  const kinds = new Map();
  let inserts = 0;

  // An entity inside a block is nearly always drawn on layer 0, and what that
  // means in DXF is "whichever layer the block was inserted on". So the count
  // is attributed the way the filter will read it, or the numbers beside the
  // layers would not be the numbers that come in.
  const count = (list, depth, inherited) => {
    for (const e of list) {
      kinds.set(e.type, (kinds.get(e.type) || 0) + 1);
      const layer = layerOf(e, inherited);
      layers.set(layer, (layers.get(layer) || 0) + 1);
      if ((e.type === "INSERT" || e.type === "MINSERT") && depth < 8) {
        inserts++;
        const block = blocks.get(e.first(2, ""));
        if (block) count(block.entities, depth + 1, layer);
      }
    }
  };
  count(entities, 0, "0");

  return {
    units: unitsOf(header.$INSUNITS || 0),
    saidUnits: header.$INSUNITS !== undefined,
    layers: [...layers.entries()].map(([name, n]) => ({ name, entities: n }))
      .sort((a, b) => b.entities - a.entities),
    kinds: [...kinds.entries()].map(([type, n]) => ({ type, entities: n }))
      .sort((a, b) => b.entities - a.entities),
    entities: entities.length,
    blocks: blocks.size,
    inserts,
  };
}

/* --------------------------------------------------------------- geometry */

const TAU = Math.PI * 2;
const degrees = v => (v * Math.PI) / 180;

//! A 2D affine, as [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
//! Blocks nest, so these compose.
const IDENTITY = [1, 0, 0, 1, 0, 0];
const compose = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const linear = (m, p) => [m[0] * p[0] + m[2] * p[1], m[1] * p[0] + m[3] * p[1]];
const determinant = m => m[0] * m[3] - m[1] * m[2];

//! Is this map a rotation, a scale by one number, a mirror, or some of each?
//! If it is, a circle stays a circle and an arc stays an arc. If it is not,
//! both become ellipses - exactly, not approximately.
function similarity(m) {
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
  const square = Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-9 * Math.max(1, sx * sy);
  return square && Math.abs(sx - sy) < 1e-9 * Math.max(1, sx) ? sx : null;
}

//! The axes of the ellipse that \p m turns the unit circle into, and the
//! rotation that carries them. This is the singular value decomposition of a
//! two by two matrix, which has a closed form: the shape a circle becomes
//! under any linear map is an ellipse, and these are its radii and its angle.
function ellipseOf(m) {
  const [a, b, c, d] = m;
  const E = (a + d) / 2, F = (a - d) / 2, G = (b + c) / 2, H = (b - c) / 2;
  const q = Math.hypot(E, H), r = Math.hypot(F, G);
  const rx = q + r, ry = Math.abs(q - r);
  const a1 = Math.atan2(G, F), a2 = Math.atan2(H, E);
  const rot = (a2 + a1) / 2;
  return { rx, ry, rot, flipped: determinant(m) < 0 };
}

//! Where a bulge goes. In DXF a segment of a polyline carries one number for
//! its curvature: the tangent of a quarter of the angle the arc sweeps,
//! negative for clockwise. Everything about the arc follows from it.
export function bulgeArc(from, to, bulge) {
  const swept = 4 * Math.atan(bulge);
  const away = [to[0] - from[0], to[1] - from[1]];
  const chord = Math.hypot(away[0], away[1]);
  if (chord < 1e-12 || Math.abs(swept) < 1e-9) return null;
  const half = swept / 2;
  const radius = Math.abs(chord / (2 * Math.sin(half)));
  // The centre is on the perpendicular bisector, and which side it is on is
  // the sign of the angle: going round a centre on your left is anticlockwise.
  const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const left = [-away[1] / chord, away[0] / chord];
  const off = (chord / 2) / Math.tan(half);
  const centre = [mid[0] + left[0] * off, mid[1] + left[1] * off];
  // Our arcs only ever sweep anticlockwise from a0 to a1, so a clockwise
  // bulge is the same arc walked the other way: start at the other end.
  const start = swept > 0 ? from : to;
  const a0 = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
  return { c: centre, r: radius, a0, a1: a0 + Math.abs(swept) };
}

/* ---------------------------------------------------- entities to elements */

//! Everything a DXF can hold that this understands, and what each one becomes.
//! Read as a table rather than as prose: the report an import prints is built
//! from the same list, so what it says it did is what it did.
export const DXF_ENTITIES = [
  { type: "LINE", becomes: "line" },
  { type: "POINT", becomes: "point" },
  { type: "CIRCLE", becomes: "circle" },
  { type: "ARC", becomes: "arc" },
  { type: "ELLIPSE", becomes: "ellipse, whole or an arc of one" },
  { type: "LWPOLYLINE", becomes: "lines and arcs, joined" },
  { type: "POLYLINE", becomes: "lines and arcs, joined" },
  { type: "SPLINE", becomes: "a spline, with its own control points and knots" },
  { type: "SOLID", becomes: "the four sides of it, as lines" },
  { type: "TRACE", becomes: "the four sides of it, as lines" },
  { type: "INSERT", becomes: "whatever the block holds, placed" },
  { type: "MINSERT", becomes: "whatever the block holds, placed, in a grid" },
];

//! And what a drawing holds that a sketch has no meaning for. Named with the
//! reason, because these are the things a person will look for afterwards.
export const DXF_IGNORED = {
  TEXT: ["line of text", "lines of text"], MTEXT: ["paragraph", "paragraphs"],
  ATTRIB: ["attribute", "attributes"], ATTDEF: ["attribute", "attributes"],
  DIMENSION: ["dimension", "dimensions"], LEADER: ["leader", "leaders"],
  MLEADER: ["leader", "leaders"], TOLERANCE: ["tolerance frame", "tolerance frames"],
  HATCH: ["hatch", "hatches"], SOLID3D: ["3D solid", "3D solids"],
  "3DSOLID": ["3D solid", "3D solids"], "3DFACE": ["3D face", "3D faces"],
  MESH: ["mesh", "meshes"], REGION: ["region", "regions"], BODY: ["body", "bodies"],
  VIEWPORT: ["layout viewport", "layout viewports"], IMAGE: ["image", "images"],
  WIPEOUT: ["wipeout", "wipeouts"], RAY: ["ray", "rays"],
  XLINE: ["infinite line", "infinite lines"], HELIX: ["helix", "helices"],
};

//! "3 hatches", "1 dimension" - said properly, because this sentence is the
//! one a person reads to find out what happened to their drawing.
export const ignoredName = (type, count = 1) => {
  const pair = DXF_IGNORED[type];
  if (!pair) return count + " " + type;
  return count + " " + (count === 1 ? pair[0] : pair[1]);
};

//! One entity, as sketch elements. \p place is where the block that holds it
//! has been put; \p scale is the file's units in millimetres.
function elementsOf(e, place, next, note, layer) {
  const out = [];
  const at = (x, y) => apply(place, [x, y]);
  const same = similarity(place);
  const make = el => { out.push({ id: next(), ...el, ...(layer ? { layer } : {}) });
                       return out[out.length - 1]; };

  // Out of plane. An entity whose extrusion is not the Z axis was drawn in
  // some other coordinate system, and only two of those can be read flat: the
  // usual one, and the one that is the usual one seen from behind.
  const extrusion = [e.first(210, 0), e.first(220, 0), e.first(230, 1)];
  const flat = Math.abs(extrusion[0]) < 1e-9 && Math.abs(extrusion[1]) < 1e-9;
  if (!flat) { note.tilted++; return out; }
  // A mirrored object coordinate system: x runs the other way, and so does
  // every angle measured in it.
  const back = extrusion[2] < 0;
  const ocs = back ? compose(place, [-1, 0, 0, 1, 0, 0]) : place;
  const put = (x, y) => apply(ocs, [x, y]);
  const turn = angle => {
    const way = linear(ocs, [Math.cos(angle), Math.sin(angle)]);
    return Math.atan2(way[1], way[0]);
  };
  const sweep = (a0, a1) => {
    // A mirror turns an anticlockwise sweep into a clockwise one, so the arc
    // is the same arc walked from the other end.
    const mirrored = determinant(ocs) < 0;
    const [s, t] = mirrored ? [turn(a1), turn(a0)] : [turn(a0), turn(a1)];
    let end = t;
    while (end <= s + 1e-12) end += TAU;
    return [s, end];
  };
  const radius = r => {
    const grown = similarity(ocs);
    return Math.abs((grown === null ? Math.hypot(ocs[0], ocs[1]) : grown) * r);
  };

  switch (e.type) {
    case "LINE": {
      const a = put(e.first(10, 0), e.first(20, 0));
      const b = put(e.first(11, 0), e.first(21, 0));
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) make({ type: "line", a, b });
      return out;
    }
    case "POINT":
      make({ type: "point", p: put(e.first(10, 0), e.first(20, 0)) });
      return out;
    case "CIRCLE": {
      const c = put(e.first(10, 0), e.first(20, 0));
      const r = e.first(40, 0);
      if (r <= 0) return out;
      if (same !== null) make({ type: "circle", c, r: radius(r) });
      else {
        // Squashed by the block it is in, a circle is an ellipse - and this is
        // exactly which ellipse, not a guess at one.
        const shape = ellipseOf([ocs[0] * r, ocs[1] * r, ocs[2] * r, ocs[3] * r, 0, 0]);
        make({ type: "ellipse", c, rx: shape.rx, ry: shape.ry, rot: shape.rot });
      }
      return out;
    }
    case "ARC": {
      const c = put(e.first(10, 0), e.first(20, 0));
      const r = e.first(40, 0);
      if (r <= 0) return out;
      const [a0, a1] = sweep(degrees(e.first(50, 0)), degrees(e.first(51, 0)));
      if (same !== null) make({ type: "arc", c, r: radius(r), a0, a1 });
      else {
        const shape = ellipseOf([ocs[0] * r, ocs[1] * r, ocs[2] * r, ocs[3] * r, 0, 0]);
        make({ type: "ellipse", c, rx: shape.rx, ry: shape.ry, rot: shape.rot,
               a0: a0 - shape.rot, a1: a1 - shape.rot });
      }
      return out;
    }
    case "ELLIPSE": {
      const c = put(e.first(10, 0), e.first(20, 0));
      // The major axis is written as a vector from the centre, so it carries
      // the rotation and the size together.
      const major = linear(ocs, [e.first(11, 0), e.first(21, 0)]);
      const ratio = e.first(40, 1);
      const rx = Math.hypot(major[0], major[1]);
      if (rx < 1e-12) return out;
      const rot = Math.atan2(major[1], major[0]);
      const whole = [e.first(41, 0), e.first(42, TAU)];
      const part = Math.abs((whole[1] - whole[0]) - TAU) > 1e-6;
      // Under a squash the axes move, so the ellipse is worked out from the
      // map rather than from the numbers in the file.
      const frame = [major[0], major[1], -major[1] * ratio, major[0] * ratio, 0, 0];
      const shape = same !== null ? { rx, ry: rx * ratio, rot } : ellipseOf(frame);
      const el = { type: "ellipse", c, rx: shape.rx, ry: shape.ry, rot: shape.rot };
      if (part) {
        // The parameter on the new ellipse that lands where the old one did.
        const carried = t => {
          const p = linear(frame, [Math.cos(t), Math.sin(t)]);
          const cos = Math.cos(shape.rot), sin = Math.sin(shape.rot);
          const u = (p[0] * cos + p[1] * sin) / (shape.rx || 1);
          const v = (-p[0] * sin + p[1] * cos) / (shape.ry || 1);
          return Math.atan2(v, u);
        };
        const mirrored = determinant(ocs) < 0;
        let a0 = carried(mirrored ? whole[1] : whole[0]);
        let a1 = carried(mirrored ? whole[0] : whole[1]);
        while (a1 <= a0 + 1e-12) a1 += TAU;
        el.a0 = a0;
        el.a1 = a1;
      }
      make(el);
      return out;
    }
    case "LWPOLYLINE": {
      const run = [];
      let point = null;
      for (const [code, value] of e.tags) {
        if (code === 10) { if (point) run.push(point); point = { x: value, y: 0, bulge: 0 }; }
        else if (code === 20 && point) point.y = value;
        else if (code === 42 && point) point.bulge = value;
      }
      if (point) run.push(point);
      return polyline(run, (e.first(70, 0) & 1) === 1, put, make, note);
    }
    case "POLYLINE": {
      const flags = e.first(70, 0);
      if (flags & 16 || flags & 64) { note.skipped.MESH = (note.skipped.MESH || 0) + 1; return out; }
      const run = (e.vertices || []).map(v => ({
        x: v.first(10, 0), y: v.first(20, 0), bulge: v.first(42, 0),
      }));
      return polyline(run, (flags & 1) === 1, put, make, note);
    }
    case "SOLID":
    case "TRACE": {
      // Four corners, and the third and fourth are the other way round - the
      // one place in DXF where the order is not the order.
      const corners = [[e.first(10, 0), e.first(20, 0)], [e.first(11, 0), e.first(21, 0)],
                       [e.first(13, e.first(12, 0)), e.first(23, e.first(22, 0))],
                       [e.first(12, 0), e.first(22, 0)]];
      const run = corners.map(([x, y]) => ({ x, y, bulge: 0 }));
      return polyline(run, true, put, make, note);
    }
    case "SPLINE": {
      const control = [];
      const fit = [];
      let cp = null, fp = null;
      for (const [code, value] of e.tags) {
        if (code === 10) { if (cp) control.push(cp); cp = [value, 0]; }
        else if (code === 20 && cp) cp[1] = value;
        else if (code === 11) { if (fp) fit.push(fp); fp = [value, 0]; }
        else if (code === 21 && fp) fp[1] = value;
      }
      if (cp) control.push(cp);
      if (fp) fit.push(fp);
      const flags = e.first(70, 0);
      const closed = (flags & 1) === 1;
      const degree = Math.max(1, e.first(71, 3));
      const knots = e.all(40);
      const weights = e.all(41);

      if (control.length > degree) {
        const el = { type: "bspline", ctrl: control.map(p => put(p[0], p[1])), degree, closed };
        if (knots.length === control.length + degree + 1) el.knots = knots;
        if (weights.length === control.length && weights.some(w => Math.abs(w - 1) > 1e-9))
          el.weights = weights;
        make(el);
      } else if (fit.length >= 2) {
        // No control points, only points it was fitted through - which is the
        // other kind of spline this holds, and the one it is named for.
        make({ type: "spline", pts: fit.map(p => put(p[0], p[1])), closed });
      }
      return out;
    }
    default:
      return out;
  }
}

//! A run of vertices, with their bulges, as lines and arcs. The joints are
//! written down as coincidences: that is what makes the corner of an imported
//! outline something you can drag, rather than two ends that happen to be in
//! the same place until one of them moves.
function polyline(run, closed, put, make, note) {
  const made = [];
  const points = run.map(v => put(v.x, v.y));
  const last = points.length - 1;
  const links = closed ? points.length : last;
  for (let i = 0; i < links; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const bulge = run[i].bulge || 0;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) continue;
    if (Math.abs(bulge) > 1e-9) {
      const arc = bulgeArc(a, b, bulge);
      if (arc) { made.push(make({ type: "arc", ...arc })); continue; }
    }
    made.push(make({ type: "line", a, b }));
  }
  // Which handle meets which is decided by where the ends are, because a
  // bulge may have turned the segment round.
  for (let i = 0; i + 1 < made.length; i++) note.joints.push([made[i], made[i + 1]]);
  if (closed && made.length > 2) note.joints.push([made[made.length - 1], made[0]]);
  return made;
}

/* --------------------------------------------------------- the conversion */

//! A DXF file as a drawing this sketcher holds.
//!
//! \p units is the key of a DXF_UNITS row - what one unit in the file means -
//! and \p layers, when it is given, is the only layers to take.
export function dxfDrawing(text, { units = "mm", layers = null, limit = DXF_LIMIT } = {}) {
  const { blocks, entities, table } = parseDxf(text);
  const scale = unitsNamed(units).mm;
  const wanted = layers ? new Set(layers) : null;

  const note = { joints: [], skipped: {}, tilted: 0, taken: 0, blocks: 0, deep: 0 };
  const elements = [];
  let serial = 0;
  const next = () => "d" + (++serial);

  const walk = (list, place, depth, inherited) => {
    for (const e of list) {
      if (elements.length >= limit) return;
      const layer = layerOf(e, inherited);
      if (wanted && !wanted.has(layer)) continue;

      if (e.type === "INSERT" || e.type === "MINSERT") {
        const block = blocks.get(e.first(2, ""));
        if (!block) { note.skipped.INSERT = (note.skipped.INSERT || 0) + 1; continue; }
        if (depth >= 8) { note.deep++; continue; }
        const sx = e.first(41, 1) || 1, sy = e.first(42, 1) || 1;
        const angle = degrees(e.first(50, 0));
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const columns = Math.max(1, e.first(70, 1) || 1), rows = Math.max(1, e.first(71, 1) || 1);
        const dx = e.first(44, 0), dy = e.first(45, 0);
        for (let cx = 0; cx < columns; cx++) for (let ry = 0; ry < rows; ry++) {
          const at = [e.first(10, 0) + cx * dx, e.first(20, 0) + ry * dy];
          // Place, then turn, then scale, then take the block's own base point
          // off - the order AutoCAD writes it and the only order that lands a
          // door in the doorway.
          const put = compose([1, 0, 0, 1, at[0], at[1]],
                      compose([cos, sin, -sin, cos, 0, 0],
                      compose([sx, 0, 0, sy, 0, 0],
                              [1, 0, 0, 1, -block.base[0], -block.base[1]])));
          note.blocks++;
          walk(block.entities, compose(place, put), depth + 1, layer);
        }
        continue;
      }

      if (DXF_IGNORED[e.type]) {
        note.skipped[e.type] = (note.skipped[e.type] || 0) + 1;
        continue;
      }
      if (!DXF_ENTITIES.some(row => row.type === e.type)) {
        if (e.type !== "SEQEND" && e.type !== "VERTEX")
          note.skipped[e.type] = (note.skipped[e.type] || 0) + 1;
        continue;
      }
      const made = elementsOf(e, place, next, note, layer);
      if (made.length) note.taken++;
      elements.push(...made);
    }
  };

  walk(entities, [scale, 0, 0, scale, 0, 0], 0, "0");

  // Rounded once, at the end: every element is written into the document as
  // text and four decimal places of a millimetre is a tenth of a micron.
  for (const el of elements) {
    if (el.c) el.c = sketchRound(el.c);
    if (el.a) el.a = sketchRound(el.a);
    if (el.b) el.b = sketchRound(el.b);
    if (el.p) el.p = sketchRound(el.p);
    if (el.pts) el.pts = el.pts.map(sketchRound);
    if (el.ctrl) el.ctrl = el.ctrl.map(sketchRound);
    for (const key of ["r", "rx", "ry", "rot", "a0", "a1"])
      if (typeof el[key] === "number") el[key] = Math.round(el[key] * 1e6) / 1e6;
  }

  // And then read again, because rounding can make an element vanish. A line
  // eight microns long is a line until it is written to a tenth of a micron,
  // and after that it is one point drawn twice. A surveyed road layout is full
  // of them - duplicates laid over a corner that nobody has ever seen - and
  // every one of them is an edge OpenCascade will not make, so they are taken
  // out here rather than left for the kernel to trip over.
  const vanished = new Set();
  for (const el of elements) if (collapsed(el)) vanished.add(el);
  const drawn = elements.filter(el => !vanished.has(el));
  elements.length = 0;
  elements.push(...drawn);

  const constraints = note.joints
    .filter(([one, two]) => !vanished.has(one) && !vanished.has(two))
    .map(([one, two]) => joint(one, two))
    .filter(Boolean);

  // And then every other pair of ends that lie on top of one another. A DXF is
  // a heap of separate LINE and ARC entities: the file says where each one is
  // and never that two of them meet, so an outline that LOOKS closed is eight
  // loose pieces the moment anybody drags a corner. The corners are written
  // down here instead, once, while the drawing is still exactly as it arrived.
  const welded = sketchOverlaps({ elements, constraints });
  constraints.push(...welded);

  // The layers come across with the drawing, in the order they were busiest,
  // all of them showing. A plan arrives as the plan it was drawn as, and what
  // to do about the furniture is then a switch rather than a re-export.
  const tally = new Map();
  for (const el of elements) tally.set(el.layer, (tally.get(el.layer) || 0) + 1);
  const order = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const drawing = { elements, constraints };
  if (order.length) {
    // On unless the file says otherwise: a layer that was off or locked in
    // AutoCAD arrives off or locked here, because that state is part of the
    // drawing and not an accident of how it was exported.
    drawing.layers = order.map(name => {
      const said = table.get(name);
      return { name, on: said ? said.on : true, locked: said ? said.locked : false };
    });
    drawing.current = (drawing.layers.find(l => l.on && !l.locked) || drawing.layers[0]).name;
  }

  return {
    drawing,
    report: {
      elements: elements.length,
      layers: order.length,
      entities: note.taken,
      blocks: note.blocks,
      joints: constraints.length,
      welded: welded.length,
      tilted: note.tilted,
      collapsed: vanished.size,
      deep: note.deep,
      skipped: note.skipped,
      full: elements.length >= limit,
      limit,
    },
  };
}

//! Has rounding left nothing here? Asked of an element that has already been
//! rounded, so what it measures is what the document will hold - not what the
//! file said.
function collapsed(el) {
  const nothing = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9;
  switch (el.type) {
    case "point":   return false;
    case "line":    return nothing(el.a, el.b);
    case "oblong":  return !(el.r > 0) || nothing(el.a, el.b);
    case "rect":    return Math.abs(el.b[0] - el.a[0]) < 1e-9
                        || Math.abs(el.b[1] - el.a[1]) < 1e-9;
    case "circle":  return !(el.r > 0);
    case "arc":     return !(el.r > 0) || Math.abs(el.a1 - el.a0) < 1e-9;
    case "ellipse": return !(el.rx > 0) || !(el.ry > 0);
    case "spline":  return (el.pts || []).every(p => nothing(p, (el.pts || [])[0]));
    case "bspline": return (el.ctrl || []).every(p => nothing(p, (el.ctrl || [])[0]));
    default:        return false;
  }
}

//! Which end of one element meets which end of the next. A bulge may have
//! turned a segment round, so this is decided by measuring rather than by the
//! order they were written in.
function joint(one, two) {
  const ends = el => {
    if (el.type === "line") return [["a", el.a], ["b", el.b]];
    if (el.type === "arc") return [["start", [el.c[0] + el.r * Math.cos(el.a0),
                                              el.c[1] + el.r * Math.sin(el.a0)]],
                                   ["end", [el.c[0] + el.r * Math.cos(el.a1),
                                            el.c[1] + el.r * Math.sin(el.a1)]]];
    return [];
  };
  let best = null;
  for (const [ak, ap] of ends(one))
    for (const [bk, bp] of ends(two)) {
      const gap = Math.hypot(ap[0] - bp[0], ap[1] - bp[1]);
      if (!best || gap < best.gap) best = { gap, of: [one.id + "." + ak, two.id + "." + bk] };
    }
  return best && best.gap < 0.01 ? { type: "coincident", of: best.of } : null;
}

/* ------------------------------------------------------------- the writing

   Out is easier than in: every element here has one entity that IS it, and
   the only decision is how much of the file to write. This writes the minimum
   a reader needs - a header saying the units, a layer table, and the
   entities - because everything else in a DXF is about a drawing sheet and a
   sketch does not have one.                                                 */

const tag = (code, value) => code + "\n" + value + "\n";

//! One sketch element as DXF entities. A sketch's own units are millimetres,
//! so what goes out is millimetres and the header says so.
function entitiesOf(el, layer) {
  const head = type => tag(0, type) + tag(8, layer) + tag(100, "AcDbEntity");
  const deg = v => (v * 180) / Math.PI;
  switch (el.type) {
    case "point":
      return head("POINT") + tag(100, "AcDbPoint") + tag(10, el.p[0]) + tag(20, el.p[1]) + tag(30, 0);
    case "line":
      return head("LINE") + tag(100, "AcDbLine")
           + tag(10, el.a[0]) + tag(20, el.a[1]) + tag(30, 0)
           + tag(11, el.b[0]) + tag(21, el.b[1]) + tag(31, 0);
    case "circle":
      return head("CIRCLE") + tag(100, "AcDbCircle")
           + tag(10, el.c[0]) + tag(20, el.c[1]) + tag(30, 0) + tag(40, el.r);
    case "arc":
      return head("ARC") + tag(100, "AcDbCircle")
           + tag(10, el.c[0]) + tag(20, el.c[1]) + tag(30, 0) + tag(40, el.r)
           + tag(100, "AcDbArc") + tag(50, deg(el.a0)) + tag(51, deg(el.a1));
    case "ellipse": {
      const major = [el.rx * Math.cos(el.rot || 0), el.rx * Math.sin(el.rot || 0)];
      const whole = el.a0 === undefined || el.a1 === undefined;
      return head("ELLIPSE") + tag(100, "AcDbEllipse")
           + tag(10, el.c[0]) + tag(20, el.c[1]) + tag(30, 0)
           + tag(11, major[0]) + tag(21, major[1]) + tag(31, 0)
           + tag(210, 0) + tag(220, 0) + tag(230, 1)
           + tag(40, (el.ry || 0) / (el.rx || 1))
           + tag(41, whole ? 0 : el.a0) + tag(42, whole ? TAU : el.a1);
    }
    case "rect": {
      // A closed polyline of four corners, which is what a rectangle is in
      // DXF too - there is no rectangle entity, only LWPOLYLINE with the
      // closed flag set.
      const [u0, v0] = el.a, [u1, v1] = el.b;
      const run = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      let text = head("LWPOLYLINE") + tag(100, "AcDbPolyline") + tag(90, 4) + tag(70, 1);
      for (const p of run) text += tag(10, p[0]) + tag(20, p[1]);
      return text;
    }
    case "oblong": {
      // A slot is two straights and two half turns, and DXF has no word for
      // it - so it goes out as the polyline it would be drawn as, bulges and
      // all, which is exactly the same shape.
      const along = [el.b[0] - el.a[0], el.b[1] - el.a[1]];
      const span = Math.hypot(along[0], along[1]) || 1;
      const side = [-along[1] / span * el.r, along[0] / span * el.r];
      const corner = (c, k) => [c[0] + side[0] * k, c[1] + side[1] * k];
      // The bulge is negative at both ends because a positive one bows to the
      // RIGHT of the way the segment is travelling, and at the end of a slot
      // that is inwards - which would draw a shape with two bites out of it.
      const run = [[corner(el.a, 1), 0], [corner(el.b, 1), -1],
                   [corner(el.b, -1), 0], [corner(el.a, -1), -1]];
      let text = head("LWPOLYLINE") + tag(100, "AcDbPolyline") + tag(90, run.length) + tag(70, 1);
      for (const [p, bulge] of run) {
        text += tag(10, p[0]) + tag(20, p[1]);
        if (bulge) text += tag(42, bulge);
      }
      return text;
    }
    case "bspline": {
      const ctrl = el.ctrl || [];
      const degree = el.degree || 3;
      const knots = el.knots || openKnots(ctrl.length, degree);
      let text = head("SPLINE") + tag(100, "AcDbSpline")
               + tag(70, (el.closed ? 1 : 0) | 8 | (el.weights ? 4 : 0))
               + tag(71, degree) + tag(72, knots.length) + tag(73, ctrl.length) + tag(74, 0);
      for (const k of knots) text += tag(40, k);
      if (el.weights) for (const w of el.weights) text += tag(41, w);
      for (const p of ctrl) text += tag(10, p[0]) + tag(20, p[1]) + tag(30, 0);
      return text;
    }
    case "spline": {
      // Fitted through its points, which is what it is - and written that way
      // so it comes back as the same thing rather than as a polyline.
      const pts = el.pts || [];
      if (pts.length < 2) return "";
      let text = head("SPLINE") + tag(100, "AcDbSpline")
               + tag(70, (el.closed ? 1 : 0) | 8 | 1024) + tag(71, 3)
               + tag(72, 0) + tag(73, 0) + tag(74, pts.length);
      for (const p of pts) text += tag(11, p[0]) + tag(21, p[1]) + tag(31, 0);
      return text;
    }
    default:
      return "";
  }
}

//! A uniform open knot vector - what a DXF spline needs when the sketch is
//! holding one that never had one.
export function openKnots(count, degree) {
  const knots = [];
  const spans = count - degree;
  for (let i = 0; i < count + degree + 1; i++) {
    if (i <= degree) knots.push(0);
    else if (i >= count) knots.push(spans);
    else knots.push(i - degree);
  }
  return knots;
}

//! Sketches out, as one DXF. Each drawing goes on its own layer, named after
//! the sketch, because that is how a drawing office expects to find them.
export function writeDxf(drawings, { units = "mm", name = "sketch",
                                     construction = false } = {}) {
  const unit = unitsNamed(units);
  // Construction geometry is scaffolding, and a DXF is what came off the
  // drawing board. The centreline two kerbs were struck from is the reason
  // they are where they are and it is not a kerb, so it does not go - the same
  // rule the solid is built by, kept by the file that leaves the program.
  let held = 0;
  const list = (Array.isArray(drawings) ? drawings : [drawings])
    .map((d, i) => {
      const all = (d.drawing || d).elements || [];
      const elements = construction ? all : all.filter(el => !isConstruction(el));
      held += all.length - elements.length;
      return { name: (d.name || "SKETCH" + (i + 1)).replace(/[<>/\\":;?*|=`,]/g, "_"),
               elements, layers: (d.drawing || d).layers || [] };
    })
    .filter(d => d.elements.length);
  if (!list.length) throw new Error(held
    ? "there is nothing in those sketches but construction geometry, and that is not "
      + "drawing - it is what the drawing was struck from"
    : "there is nothing in those sketches to write");

  // An element that came from a DXF remembers which layer it was on, and goes
  // back out on it. Everything drawn here goes out on the sketch's own name,
  // which is the only sensible layer for a drawing that never had any.
  const named = new Map();
  for (const one of list) {
    const said = new Map((one.layers || []).map(l => [l.name, l]));
    for (const el of one.elements) {
      const name = el.layer || one.name;
      if (!named.has(name)) named.set(name, said.get(name) || { name, on: true, locked: false });
    }
  }

  let text = tag(0, "SECTION") + tag(2, "HEADER")
           + tag(9, "$ACADVER") + tag(1, "AC1015")
           + tag(9, "$INSUNITS") + tag(70, unit.code || 4)
           + tag(9, "$MEASUREMENT") + tag(70, unit.key === "in" || unit.key === "ft" ? 0 : 1)
           + tag(0, "ENDSEC");

  text += tag(0, "SECTION") + tag(2, "TABLES")
        + tag(0, "TABLE") + tag(2, "LAYER") + tag(70, named.size);
  for (const [name, state] of named)
    text += tag(0, "LAYER") + tag(100, "AcDbSymbolTableRecord") + tag(100, "AcDbLayerTableRecord")
          + tag(2, name) + tag(70, state.locked ? 4 : 0)
          // A layer that is off is written as a negative colour, which is how
          // DXF has always said it.
          + tag(62, state.on === false ? -7 : 7) + tag(6, "CONTINUOUS");
  text += tag(0, "ENDTAB") + tag(0, "ENDSEC");

  text += tag(0, "SECTION") + tag(2, "ENTITIES");
  let written = 0;
  for (const one of list)
    for (const el of one.elements) {
      const entity = entitiesOf(el, el.layer || one.name);
      if (entity) { text += entity; written++; }
    }
  text += tag(0, "ENDSEC") + tag(0, "EOF");

  return { text, entities: written, layers: named.size, units: unit, construction: held };
}

//! What a sketch is, said in one line - for the note an export prints.
export function describeDrawing(drawing) {
  const counts = new Map();
  let held = 0;
  for (const el of (drawing.elements || [])) {
    if (isConstruction(el)) { held++; continue; }
    counts.set(el.type, (counts.get(el.type) || 0) + 1);
  }
  const said = [...counts.entries()]
    .map(([type, n]) => n + " " + type + (n === 1 ? "" : "s")).join(", ") || "nothing";
  return held ? said + " (" + held + " construction held back)" : said;
}

//! Everything the sketcher can hold that DXF has a word for. Exported so the
//! test can say so out loud rather than a reader having to trust it.
export const DXF_WRITES = SKETCH_TYPES.concat(["bspline"]);

//! A last resort, and the reason it exists: a reader that cannot be given an
//! element is given the shape of it instead. Nothing in this file uses it for
//! anything but a check that every element type really can be written.
export const outlineOf = el => sketchOutline(el, 64);
