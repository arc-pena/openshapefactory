//! Copied from the OCAF modeller (cad/src/ifc.js): the ISO 10303-21 reader and IFC geometry
//! helpers. The mapping onto Web BIM classes is ifcimport.js; ifcFeatures here maps onto CAD nodes.
// IFC, read as a model rather than as a picture.
//
// WHAT THIS IS FOR. An IFC file opened in a viewer is triangles: you can look
// at the wall, you cannot change its thickness. But a wall in an IFC file is
// almost never triangles - it is an IfcExtrudedAreaSolid over an
// IfcArbitraryClosedProfileDef, which is to say a closed outline and a depth,
// which is to say exactly the Extrude node this program already has. The
// geometry in a building model is a small vocabulary used over and over, and
// nearly all of it is already in the catalogue.
//
// So the import does not tessellate. It reads the entities, and writes the
// model language - the same edits a hand makes - so what arrives is a
// parametric tree with the building's own structure in it: project, site,
// building, storey, element, each a geometrical set, and inside each element
// the nodes that build it. Change the depth and the slab gets thicker.
//
// ON IFCOPENSHELL. What is ported here is its MAPPING - the correspondence in
// IfcGeom's mapping/ between an IFC representation item and a modelling
// operation - which is the part of it that matters when the geometry is going
// to be rebuilt by somebody else's kernel. Its code is not: IfcOpenShell has
// no browser distribution, its WASM road is a Python runtime an order of
// magnitude larger than this whole page, and what it would be carried in for
// is its own OpenCascade, which is already here. The file format it reads is
// ISO 10303-21, which is text, and reading it is the first two hundred lines
// below.
//
// WHAT IS IN HERE AND WHAT IS NOT. Everything in this file is arithmetic over
// text: it takes an IFC file and gives back a list of edits. It knows nothing
// about OpenCascade, nothing about the document, and nothing about the page,
// which is what makes the mapping testable on its own - every check in
// ifc.test.mjs is a small IFC file in, a list of edits out, with no kernel
// anywhere near it.

import { roundedRing, sectionOutline } from "./ifcsections.js";

/* ============================================================ ISO 10303-21

   The STEP physical file, which is what an IFC file is. Instances numbered
   with a hash, attributes positional, references by number:

       #42= IFCEXTRUDEDAREASOLID(#38,#41,#12,3000.);

   That is the whole format, plus the spellings for null ($), derived (*),
   enumerations (.TRUE.), lists ((1.,0.,0.)) and defined types wrapping a
   value (IFCPOSITIVELENGTHMEASURE(200.)).                                   */

//! A value that was written as an enumeration rather than as a string, kept
//! apart from one because IFC uses both and they mean different things: an
//! IfcBooleanOperator is .DIFFERENCE. and a name is 'Difference'.
export const ifcEnum = name => ({ enum: name });
//! A value wrapped in the name of a defined type - IFCLENGTHMEASURE(200.) -
//! which is how IFC carries units of measure through property sets.
export const ifcTyped = (type, value) => ({ type, value });

const IFC_DIGIT = /[0-9]/;

//! Reads one IFC file. The whole text, one pass, no regular expressions over
//! the body: a building model is tens of megabytes and a backtracking match
//! over it is not a thing anybody should wait for.
export function readIfc(text) {
  const source = String(text || "");
  let i = 0;
  const end = source.length;

  const skip = () => {
    for (;;) {
      while (i < end) {
        const c = source.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break;
      }
      if (source.charCodeAt(i) === 47 && source.charCodeAt(i + 1) === 42) {   // comment
        const shut = source.indexOf("*/", i + 2);
        i = shut < 0 ? end : shut + 2;
        continue;
      }
      return;
    }
  };

  //! A quoted string, with the two escapes anybody actually meets: a doubled
  //! quote, and ISO 10646 in \X2\....\X0\, which is how every non-ASCII name
  //! written by a European authoring tool arrives.
  const readString = () => {
    i++;                                        // the opening quote
    let out = "";
    while (i < end) {
      const c = source[i];
      if (c === "'") {
        if (source[i + 1] === "'") { out += "'"; i += 2; continue; }
        i++; return out;
      }
      if (c === "\\") {
        const tag = source.slice(i, i + 4).toUpperCase();
        if (tag === "\\X2\\" || tag === "\\X4\\") {
          const wide = tag === "\\X4\\" ? 8 : 4;
          let j = i + 4, run = "";
          while (j + wide <= end && /^[0-9A-Fa-f]+$/.test(source.slice(j, j + wide))) {
            run += String.fromCodePoint(parseInt(source.slice(j, j + wide), 16));
            j += wide;
          }
          const shut = source.slice(j, j + 4).toUpperCase();
          out += run;
          i = shut === "\\X0\\" ? j + 4 : j;
          continue;
        }
        if (source.slice(i, i + 3).toUpperCase() === "\\X\\") {
          out += String.fromCharCode(parseInt(source.slice(i + 3, i + 5), 16));
          i += 5; continue;
        }
        if (source.slice(i, i + 3).toUpperCase() === "\\S\\") {
          out += String.fromCharCode(source.charCodeAt(i + 3) + 128);
          i += 4; continue;
        }
        out += c; i++; continue;
      }
      out += c; i++;
    }
    return out;
  };

  //! One attribute. Recursive, because a list holds values and a defined type
  //! wraps one.
  const readValue = () => {
    skip();
    const c = source[i];
    if (c === undefined) return null;
    if (c === "$") { i++; return null; }
    if (c === "*") { i++; return undefined; }              // derived in a subtype
    if (c === "'") return readString();
    if (c === "#") {
      i++;
      let n = "";
      while (i < end && IFC_DIGIT.test(source[i])) n += source[i++];
      return { ref: Number(n) };
    }
    if (c === ".") {
      const shut = source.indexOf(".", i + 1);
      const name = source.slice(i + 1, shut < 0 ? end : shut);
      i = shut < 0 ? end : shut + 1;
      return ifcEnum(name);
    }
    if (c === "(") {
      i++;
      const list = [];
      for (;;) {
        skip();
        if (source[i] === ")") { i++; return list; }
        if (source[i] === ",") { i++; continue; }
        if (i >= end) return list;
        list.push(readValue());
      }
    }
    if (c === '"') {                                        // binary, kept as text
      const shut = source.indexOf('"', i + 1);
      const raw = source.slice(i + 1, shut < 0 ? end : shut);
      i = shut < 0 ? end : shut + 1;
      return { binary: raw };
    }
    if (c === "-" || c === "+" || c === "." || IFC_DIGIT.test(c)) {
      let n = "";
      while (i < end && /[0-9+\-.eE]/.test(source[i])) n += source[i++];
      return Number(n);
    }
    // A keyword: either a defined type wrapping a value, or a bare token.
    let word = "";
    while (i < end && /[A-Za-z0-9_]/.test(source[i])) word += source[i++];
    skip();
    if (source[i] === "(") {
      i++;
      const list = [];
      for (;;) {
        skip();
        if (source[i] === ")") { i++; break; }
        if (source[i] === ",") { i++; continue; }
        if (i >= end) break;
        list.push(readValue());
      }
      return ifcTyped(word.toUpperCase(), list.length === 1 ? list[0] : list);
    }
    return word;
  };

  const header = {};
  const entities = new Map();
  const byType = new Map();
  const file = (type, id, args) => {
    const entity = { id, type, args };
    entities.set(id, entity);
    const list = byType.get(type);
    if (list) list.push(id); else byType.set(type, [id]);
    return entity;
  };

  let section = "";
  while (i < end) {
    skip();
    if (i >= end) break;
    if (source[i] === "#") {
      i++;
      let n = "";
      while (i < end && IFC_DIGIT.test(source[i])) n += source[i++];
      skip();
      if (source[i] === "=") i++;
      skip();
      let word = "";
      while (i < end && /[A-Za-z0-9_]/.test(source[i])) word += source[i++];
      skip();
      const args = source[i] === "(" ? readValue() : [];
      //! A COMPLEX INSTANCE - #5=(IFCA(..)IFCB(..)) - is several partial
      //! entities at one number. Rare, and never load-bearing for geometry, so
      //! the first of them is kept and the rest passed over rather than
      //! refusing the file for it.
      if (!word && Array.isArray(args)) {
        while (i < end && source[i] !== ";") i++;
        i++;
        continue;
      }
      file(word.toUpperCase(), Number(n), Array.isArray(args) ? args : [args]);
      while (i < end && source[i] !== ";") i++;
      i++;
      continue;
    }
    // A bare keyword: a section marker, or a header entry.
    let word = "";
    while (i < end && /[A-Za-z0-9_\-]/.test(source[i])) word += source[i++];
    const key = word.toUpperCase();
    if (key === "HEADER" || key === "DATA") { section = key; i++; continue; }
    if (key === "ENDSEC") { section = ""; i++; continue; }
    if (key === "ISO" || key === "END" || !key) { i++; continue; }
    skip();
    if (source[i] === "(") {
      const args = readValue();
      if (section === "HEADER") header[key] = args;
    }
    while (i < end && source[i] !== ";") i++;
    i++;
  }

  const said = header.FILE_SCHEMA && header.FILE_SCHEMA[0];
  const schema = Array.isArray(said) ? String(said[0] || "") : String(said || "");
  return { schema: schema.toUpperCase(), header, entities, byType,
           //! The inverse attributes IFC leaves to the reader to build. Every
           //! relationship in the file points from the relationship to its
           //! ends, so "what is in this storey" is a search unless it is
           //! indexed once - and on a real model it is asked for thousands of
           //! times.
           pointingAt: ifcInverseIndex(entities) };
}

//! id -> [ids of entities that name it], which is how IfcRelAggregates and
//! IfcRelContainedInSpatialStructure are followed backwards.
function ifcInverseIndex(entities) {
  const index = new Map();
  const note = (to, from) => {
    const list = index.get(to);
    if (list) { if (!list.includes(from)) list.push(from); } else index.set(to, [from]);
  };
  const walk = (value, from) => {
    if (!value) return;
    if (Array.isArray(value)) { for (const one of value) walk(one, from); return; }
    if (typeof value === "object") {
      if (typeof value.ref === "number") { note(value.ref, from); return; }
      if (value.value !== undefined) walk(value.value, from);
    }
  };
  for (const [id, entity] of entities) walk(entity.args, id);
  return index;
}

/* ------------------------------------------------------- reading it back out

   Small accessors, because an IFC attribute is positional and every mapping
   below would otherwise be full of args[3][1].value.                        */

export const isRef = v => !!v && typeof v === "object" && typeof v.ref === "number";
//! A number, whether it was written bare or wrapped in a measure type.
export function asNumber(value, fallback = 0) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && value.value !== undefined)
    return asNumber(value.value, fallback);
  return fallback;
}
export function asText(value, fallback = "") {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.enum === "string") return value.enum;
    if (value.value !== undefined) return asText(value.value, fallback);
  }
  return fallback;
}
export const asList = value => Array.isArray(value) ? value : value == null ? [] : [value];

//! The entity a reference points at, or nothing.
export const follow = (model, value) =>
  isRef(value) ? model.entities.get(value.ref) || null : null;
export const followAll = (model, value) =>
  asList(value).map(one => follow(model, one)).filter(Boolean);

//! Every entity of a type, as entities rather than as numbers.
export const ofType = (model, type) =>
  (model.byType.get(String(type).toUpperCase()) || [])
    .map(id => model.entities.get(id));

//! Everything that names this one - the inverse attributes, filtered by type.
export function pointingAt(model, entity, type) {
  const want = type ? String(type).toUpperCase() : null;
  return (model.pointingAt.get(entity && entity.id) || [])
    .map(id => model.entities.get(id))
    .filter(one => one && (!want || one.type === want));
}

/* --------------------------------------------------------------- the units

   IFC says what its numbers mean, and a file that does not say millimetres is
   not a file to guess about: a metre-based model read as millimetres is a
   building a thousand times too small, which looks exactly like nothing at
   all.                                                                      */

const IFC_SI = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2,
  DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9,
  PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
};
//! The imperial ones IFC allows, in metres, because a US file states them as
//! a conversion onto an SI unit and the conversion is the only thing that
//! says which.
const IFC_IMPERIAL = { INCH: 0.0254, FOOT: 0.3048, YARD: 0.9144, MILE: 1609.344 };

//! How many millimetres one length in this file is. Millimetres because that
//! is what the document works in.
export function ifcScale(model) {
  for (const assignment of ofType(model, "IFCUNITASSIGNMENT"))
    for (const unit of followAll(model, assignment.args[0])) {
      //! IfcSIUnit is Dimensions, UnitType, Prefix, Name - so the type is the
      //! SECOND attribute and the prefix the third. Read one along, every
      //! file in the world says nothing about its units and every model comes
      //! in at 1:1, which for a metre-based file is a building a thousand
      //! times too small and for a millimetre-based one is right by luck.
      if (unit.type === "IFCSIUNIT" && asText(unit.args[1]) === "LENGTHUNIT") {
        const prefix = IFC_SI[asText(unit.args[2]).toUpperCase()] || 1;
        return prefix * 1000;                       // metres are the SI length
      }
      if (unit.type === "IFCCONVERSIONBASEDUNIT" && asText(unit.args[1]) === "LENGTHUNIT") {
        const named = asText(unit.args[2]).toUpperCase().replace(/[^A-Z]/g, "");
        const measure = follow(model, unit.args[3]);
        const factor = measure ? asNumber(measure.args[0], 0) : 0;
        if (factor) {
          //! The conversion is onto the SI unit named beside it, which for a
          //! length is nearly always the metre - so the factor is in metres
          //! and a thousand of them are a millimetre's worth.
          const onto = follow(model, measure.args[1]);
          const prefix = onto && onto.type === "IFCSIUNIT"
            ? (IFC_SI[asText(onto.args[3]).toUpperCase()] || 1) : 1;
          return factor * prefix * 1000;
        }
        for (const [name, metres] of Object.entries(IFC_IMPERIAL))
          if (named.startsWith(name)) return metres * 1000;
      }
    }
  return 1;                                          // said nothing: take it as mm
}

//! And the same question for angles, which IFC states in radians or in
//! degrees and which every mapping below wants in degrees.
export function ifcAngleScale(model) {
  for (const assignment of ofType(model, "IFCUNITASSIGNMENT"))
    for (const unit of followAll(model, assignment.args[0])) {
      if (unit.type === "IFCSIUNIT" && asText(unit.args[1]) === "PLANEANGLEUNIT")
        return 180 / Math.PI;                        // radians, which SI means
      if (unit.type === "IFCCONVERSIONBASEDUNIT" && asText(unit.args[1]) === "PLANEANGLEUNIT")
        return 1;                                    // stated in degrees already
    }
  return 180 / Math.PI;
}

/* =========================================================== where things are

   IFC places everything by a chain: an element's IfcLocalPlacement is stated
   relative to its parent's, which is stated relative to the storey's, which is
   stated relative to the building's. Nothing is in world coordinates until the
   chain has been walked, and the chain is the reason a wall drawn at the
   origin of its own storey ends up eleven floors up.                        */

export const IFC_IDENTITY = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

const ifcAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const ifcSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const ifcScaleV = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const ifcDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ifcCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                          a[0] * b[1] - a[1] * b[0]];
const ifcLen = a => a ? Math.hypot(a[0] || 0, a[1] || 0, a[2] || 0) : 0;
//! Nothing in, nothing out. Every attribute in IFC that could be a direction
//! is optional, and a placement written as IFCAXIS2PLACEMENT3D(#3,$,$) - which
//! Revit writes by the thousand - is exactly that twice over.
const ifcUnit = a => { const l = ifcLen(a); return l < 1e-12 ? null : ifcScaleV(a, 1 / l); };

//! A frame from a direction pair, squared up and right-handed. IFC states an
//! axis and a reference direction that are only APPROXIMATELY perpendicular -
//! the schema says the reference direction is projected - so squaring up here
//! is the specified behaviour rather than a kindness.
export function ifcFrame(origin, zAxis, xAxis) {
  const z = ifcUnit(zAxis) || [0, 0, 1];
  let x = ifcUnit(xAxis) || (Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  x = ifcUnit([x[0] - z[0] * ifcDot(x, z), x[1] - z[1] * ifcDot(x, z), x[2] - z[2] * ifcDot(x, z)])
      || (Math.abs(z[0]) < 0.9 ? ifcUnit(ifcCross([1, 0, 0], z)) : ifcUnit(ifcCross([0, 1, 0], z)));
  return { o: origin || [0, 0, 0], x, y: ifcCross(z, x), z };
}

//! Child stated in parent's axes, read in the world's.
export function ifcCompose(parent, child) {
  const put = v => ifcAdd(ifcAdd(ifcScaleV(parent.x, v[0]), ifcScaleV(parent.y, v[1])),
                        ifcScaleV(parent.z, v[2]));
  return { o: ifcAdd(parent.o, put(child.o)), x: put(child.x), y: put(child.y), z: put(child.z) };
}
//! A point stated in a frame's axes, read in the world's.
export const ifcAt = (frame, p) =>
  ifcAdd(frame.o, ifcAdd(ifcAdd(ifcScaleV(frame.x, p[0]), ifcScaleV(frame.y, p[1])),
                     ifcScaleV(frame.z, p[2] || 0)));

export function ifcPoint(model, value, scale = 1) {
  const e = follow(model, value) || (value && value.type ? value : null);
  if (!e || !e.args) return [0, 0, 0];
  const list = asList(e.args[0]).map(n => asNumber(n) * scale);
  return [list[0] || 0, list[1] || 0, list[2] || 0];
}
export function ifcDirection(model, value, fallback = null) {
  const e = follow(model, value);
  if (!e || !e.args) return fallback;
  const list = asList(e.args[0]).map(n => asNumber(n));
  if (!list.length) return fallback;
  return ifcUnit([list[0] || 0, list[1] || 0, list[2] || 0]) || fallback;
}

//! IfcAxis2Placement3D, IfcAxis2Placement2D, or nothing - all three arrive at
//! the same place, which is why every caller below can ignore the difference.
export function ifcPlacementFrame(model, value, scale = 1) {
  const e = follow(model, value);
  if (!e) return IFC_IDENTITY;
  if (e.type === "IFCAXIS2PLACEMENT2D")
    return ifcFrame(ifcPoint(model, e.args[0], scale), [0, 0, 1],
                    ifcDirection(model, e.args[1], [1, 0, 0]));
  if (e.type === "IFCAXIS2PLACEMENT3D")
    return ifcFrame(ifcPoint(model, e.args[0], scale),
                    ifcDirection(model, e.args[1], [0, 0, 1]),
                    ifcDirection(model, e.args[2], null));
  if (e.type === "IFCCARTESIANTRANSFORMATIONOPERATOR3D"
   || e.type === "IFCCARTESIANTRANSFORMATIONOPERATOR2D") {
    //! A mapped item's transform. The scale factor is read but not applied to
    //! the axes: a frame carries placement, and a scaled instance is handed on
    //! separately - see ifcTransformScale.
    const x = ifcDirection(model, e.args[0], [1, 0, 0]);
    const y = ifcDirection(model, e.args[1], [0, 1, 0]);
    const origin = ifcPoint(model, e.args[2], scale);
    const z = e.args[4] !== undefined ? ifcDirection(model, e.args[4], null) : null;
    return ifcFrame(origin, z || ifcCross(x, y), x);
  }
  return IFC_IDENTITY;
}

//! How much bigger, for the one operator that says so.
export function ifcTransformScale(model, value) {
  const e = follow(model, value);
  if (!e) return 1;
  const said = asNumber(e.args[3], 1);
  return said > 0 ? said : 1;
}

//! The whole chain, walked to the world. IfcLocalPlacement is the only one
//! that recurses; a grid placement is a virtual placement on an IfcGrid and is
//! taken as the identity rather than guessed at.
export function ifcWorldFrame(model, value, scale = 1, depth = 0) {
  const e = follow(model, value);
  if (!e || depth > 64) return IFC_IDENTITY;
  if (e.type !== "IFCLOCALPLACEMENT") return ifcPlacementFrame(model, value, scale);
  const mine = ifcPlacementFrame(model, e.args[1], scale);
  if (!isRef(e.args[0])) return mine;
  return ifcCompose(ifcWorldFrame(model, e.args[0], scale, depth + 1), mine);
}

/* ================================================= the building's own structure

   IfcProject aggregates IfcSite aggregates IfcBuilding aggregates
   IfcBuildingStorey, by IfcRelAggregates; and a storey CONTAINS its walls and
   slabs, by IfcRelContainedInSpatialStructure. Two different relationships
   because IFC distinguishes decomposition from containment, and both have to
   be followed or the model arrives as a flat list of eleven thousand things.

   That structure is the whole reason to import this way. It is what the tree
   is for.                                                                   */

//! WHAT IS A PLACE RATHER THAN A THING.
//!
//! A spatial element is read as a folder: it holds what is in it and builds
//! nothing itself. IFC4.3 brought a facility for every kind of infrastructure
//! - a bridge, a road, a railway, a marine facility - and a Part of each, and
//! they are places in exactly the same sense a storey is. Left off this list
//! they were read as PRODUCTS with no geometry, which is not wrong so much as
//! upside down: it made a road an empty object rather than the place its
//! carriageways are in.
//!
//! An assembly is on it for the same reason. IfcElementAssembly is a truss or
//! a stair or a curtain wall: it aggregates the parts that ARE the geometry
//! and has none of its own. In the certification scenes it is 122 of them,
//! every one counted as a product that failed to build.
const IFC_SPATIAL = new Set(["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY",
                         "IFCSPACE", "IFCSPATIALZONE", "IFCEXTERNALSPATIALELEMENT",
                         // IFC4.3: the facilities, and the parts of each
                         "IFCFACILITY", "IFCFACILITYPART", "IFCBRIDGE", "IFCBRIDGEPART",
                         "IFCROAD", "IFCROADPART", "IFCRAILWAY", "IFCRAILWAYPART",
                         "IFCMARINEFACILITY", "IFCMARINEPART",
                         // aggregates: the parts are the building, not this
                         "IFCELEMENTASSEMBLY"]);

export function ifcStructure(model) {
  const seen = new Set();
  const node = (entity, depth) => {
    if (!entity || seen.has(entity.id) || depth > 32) return null;
    seen.add(entity.id);
    const children = [], parts = [];
    for (const rel of pointingAt(model, entity, "IFCRELAGGREGATES"))
      if (isRef(rel.args[4]) && rel.args[4].ref === entity.id)
        for (const child of followAll(model, rel.args[5])) {
          const made = node(child, depth + 1);
          if (made) (IFC_SPATIAL.has(child.type) ? children : parts).push(made);
        }
    for (const rel of pointingAt(model, entity, "IFCRELCONTAINEDINSPATIALSTRUCTURE"))
      if (isRef(rel.args[5]) && rel.args[5].ref === entity.id)
        for (const child of followAll(model, rel.args[4])) {
          const made = node(child, depth + 1);
          if (made) parts.push(made);
        }
    return { entity, type: entity.type, spatial: IFC_SPATIAL.has(entity.type),
             name: ifcName(entity), children, parts };
  };
  const roots = ofType(model, "IFCPROJECT").map(p => node(p, 0)).filter(Boolean);
  //! A file with no project, or with products hanging off nothing, still opens.
  //! Orphans are collected rather than dropped: a model that arrives missing
  //! half its walls because a relationship was not written is worse than one
  //! with a set called "Not in any storey".
  //! An opening is not an orphan. It belongs to no storey by design - it is
  //! the hole in a wall, and the wall is what carries it - so collecting it
  //! here would put every window reveal in the building in a set of its own
  //! AND subtract it from its wall, which is the same geometry twice.
  const consumed = new Set();
  for (const rel of ofType(model, "IFCRELVOIDSELEMENT"))
    if (isRef(rel.args[5])) consumed.add(rel.args[5].ref);
  for (const rel of ofType(model, "IFCRELPROJECTSELEMENT"))
    if (isRef(rel.args[5])) consumed.add(rel.args[5].ref);
  const loose = [];
  for (const type of model.byType.keys()) {
    if (!/^IFC/.test(type)) continue;
    for (const entity of ofType(model, type)) {
      if (seen.has(entity.id) || consumed.has(entity.id)) continue;
      if (!hasShape(model, entity)) continue;
      const made = node(entity, 1);
      if (made) loose.push(made);
    }
  }
  return { roots, loose };
}

//! IfcRoot is GlobalId, OwnerHistory, Name, Description - so a name is always
//! the third attribute, whatever the entity is.
export function ifcName(entity) {
  const said = entity && asText(entity.args && entity.args[2], "");
  return said || "";
}
export const ifcGlobalId = entity => (entity && asText(entity.args && entity.args[0], "")) || "";

//! Does this product carry geometry at all? Asked before an orphan is taken
//! seriously, and before a set is made for something that will be empty.
export function hasShape(model, entity) {
  if (!entity || !entity.args) return false;
  const shape = entity.args[6];                    // IfcProduct.Representation
  const found = follow(model, shape);
  return !!(found && (found.type === "IFCPRODUCTDEFINITIONSHAPE"
                   || found.type === "IFCPRODUCTREPRESENTATION"));
}

//! The representation worth building. IFC carries several - a box, an axis, a
//! footprint, the body - and only one of them is the thing itself.
export function ifcBodyItems(model, entity) {
  const shape = follow(model, entity && entity.args && entity.args[6]);
  if (!shape) return [];
  const wanted = ["BODY", "FACETATION", "MODELVIEW"];
  const reps = followAll(model, shape.args[2]);
  const rank = rep => {
    const id = asText(rep.args[1], "").toUpperCase();
    const at = wanted.indexOf(id);
    return at < 0 ? wanted.length : at;
  };
  const body = reps.filter(r => r.type === "IFCSHAPEREPRESENTATION")
                   .sort((a, b) => rank(a) - rank(b))[0];
  if (!body || rank(body) === wanted.length) return [];
  return followAll(model, body.args[3]);
}

/* ==================================================== curves, as a drawing

   Everything swept in IFC is swept from a profile, and a profile is a closed
   curve on a plane. Read here as SKETCH ELEMENTS rather than as points,
   because a sketch is what the import puts on the plane: an arc that arrived
   as an arc stays an arc, and what comes out the other end is a drawing
   somebody can open and change rather than a polygon they cannot.           */

let markCount = 0;
const ifcMarkId = () => "i" + (++markCount);
//! Restarted per drawing, so the ids in a file do not depend on how many
//! sketches were read before it - which is what makes the tests readable.
export const ifcResetIds = () => { markCount = 0; };

const ifcRound2 = p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
const ifcSame2 = (a, b, tol = 1e-7) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

//! The circle through three points, which is what IfcArcIndex states an arc
//! as and what the middle point of a trimmed arc has to be read back into.
export function ifcArcThrough(a, b, c) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;                 // three points in a line
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const centre = [ux, uy];
  const r = Math.hypot(ax - ux, ay - uy);
  const angle = p => Math.atan2(p[1] - uy, p[0] - ux);
  let a0 = angle(a), a1 = angle(c);
  //! WHICH WAY ROUND. The middle point decides it: the arc is the one that
  //! passes through the point that was given, and there is exactly one.
  const turns = d > 0;
  if (turns && a1 < a0) a1 += Math.PI * 2;
  if (!turns && a1 > a0) a0 += Math.PI * 2;
  return { c: centre, r, a0, a1, ccw: turns };
}

const ifcLineEl = (a, b) => ifcSame2(a, b) ? null
  : { id: ifcMarkId(), type: "line", a: ifcRound2(a), b: ifcRound2(b) };

function ifcArcEl(a, mid, b) {
  const found = ifcArcThrough(a, mid, b);
  if (!found) return ifcLineEl(a, b);
  return { id: ifcMarkId(), type: "arc", c: ifcRound2(found.c), r: found.r,
           a0: found.ccw ? found.a0 : found.a1, a1: found.ccw ? found.a1 : found.a0 };
}

//! A run of points as straight segments. \p closed joins the last to the first
//! when the file did not repeat it, which most do and some do not.
function ifcRunElements(points, closed) {
  const out = [];
  const run = points.slice();
  if (run.length > 1 && ifcSame2(run[0], run[run.length - 1])) run.pop();
  for (let i = 0; i + 1 < run.length; i++) {
    const made = ifcLineEl(run[i], run[i + 1]);
    if (made) out.push(made);
  }
  if (closed && run.length > 2) {
    const made = ifcLineEl(run[run.length - 1], run[0]);
    if (made) out.push(made);
  }
  return out;
}

const IFC_SAMPLES = 48;

//! One curve, as sketch elements on the profile's own plane. Everything in the
//! IFC curve vocabulary that a building actually contains; anything else comes
//! back empty and is reported rather than guessed at.
export function ifcCurveElements(model, value, scale, depth = 0) {
  const e = follow(model, value);
  if (!e || depth > 16) return [];
  const pts = list => followAll(model, list)
    .map(p => { const at = ifcPoint(model, { ref: p.id }, scale); return [at[0], at[1]]; });

  switch (e.type) {
    case "IFCPOLYLINE": {
      const points = pts(e.args[0]);
      return ifcRunElements(points, points.length > 2
        && !ifcSame2(points[0], points[points.length - 1]));
    }
    case "IFCINDEXEDPOLYCURVE": {
      const holder = follow(model, e.args[0]);
      const coords = holder ? asList(holder.args[0]).map(pair => {
        const xy = asList(pair).map(n => asNumber(n) * scale);
        return [xy[0] || 0, xy[1] || 0];
      }) : [];
      const at = n => coords[Math.round(asNumber(n)) - 1] || [0, 0];
      const segments = asList(e.args[1]);
      if (!segments.length) return ifcRunElements(coords, true);
      const out = [];
      for (const segment of segments) {
        if (!segment || !segment.type) continue;
        const index = asList(segment.value);
        if (segment.type === "IFCARCINDEX" && index.length >= 3) {
          out.push(ifcArcEl(at(index[0]), at(index[1]), at(index[2])));
        } else {
          for (let i = 0; i + 1 < index.length; i++) {
            const made = ifcLineEl(at(index[i]), at(index[i + 1]));
            if (made) out.push(made);
          }
        }
      }
      return out.filter(Boolean);
    }
    case "IFCCOMPOSITECURVE":
    case "IFCCOMPOSITECURVEONSURFACE": {
      const out = [];
      for (const segment of followAll(model, e.args[0])) {
        const parent = segment.args ? segment.args[2] : null;
        const sense = asText(segment.args && segment.args[1], "T") !== "F";
        const made = ifcCurveElements(model, parent, scale, depth + 1);
        out.push(...(sense ? made : made.slice().reverse()));
      }
      return out;
    }
    case "IFCCIRCLE": {
      const here = ifcPlacementFrame(model, e.args[0], scale);
      return [{ id: ifcMarkId(), type: "circle", c: ifcRound2([here.o[0], here.o[1]]),
                r: asNumber(e.args[1]) * scale }];
    }
    case "IFCELLIPSE": {
      const here = ifcPlacementFrame(model, e.args[0], scale);
      const a = asNumber(e.args[1]) * scale, b = asNumber(e.args[2]) * scale;
      const turn = Math.atan2(here.x[1], here.x[0]);
      const run = [];
      for (let i = 0; i < IFC_SAMPLES; i++) {
        const t = (i / IFC_SAMPLES) * Math.PI * 2;
        const u = a * Math.cos(t), v = b * Math.sin(t);
        run.push([here.o[0] + u * Math.cos(turn) - v * Math.sin(turn),
                  here.o[1] + u * Math.sin(turn) + v * Math.cos(turn)]);
      }
      return ifcRunElements(run, true);
    }
    case "IFCTRIMMEDCURVE": return ifcTrimmedElements(model, e, scale, depth);
    case "IFCBSPLINECURVEWITHKNOTS":
    case "IFCRATIONALBSPLINECURVEWITHKNOTS": {
      //! Sampled as its control polygon rather than evaluated. A B-spline in a
      //! building is a curtain-wall sweep or a road, it is never a wall, and
      //! the control polygon is within the tessellation of the curve at the
      //! sizes those are drawn at. Said in the report, so it is not a secret.
      return ifcRunElements(pts(e.args[1]), false);
    }
    default: return [];
  }
}

//! An arc or a segment of a line, which is how IFC states both: a basis curve
//! and two trims, each of which may be a parameter OR a point, with a flag
//! saying which to believe.
function ifcTrimmedElements(model, e, scale, depth) {
  const basis = follow(model, e.args[0]);
  if (!basis) return [];
  const agrees = asText(e.args[3], "T") !== "F";
  const readTrim = value => {
    let point = null, parameter = null;
    for (const one of asList(value)) {
      const found = follow(model, one);
      if (found && found.type === "IFCCARTESIANPOINT") {
        const at = ifcPoint(model, { ref: found.id }, scale);
        point = [at[0], at[1]];
      } else parameter = asNumber(one, null);
    }
    return { point, parameter };
  };
  const first = readTrim(e.args[1]), second = readTrim(e.args[2]);

  if (basis.type === "IFCLINE") {
    const from = first.point, to = second.point;
    if (from && to) return [ifcLineEl(from, to)].filter(Boolean);
    const start = ifcPoint(model, basis.args[0], scale);
    const vector = follow(model, basis.args[1]);
    const way = vector ? ifcDirection(model, vector.args[0], [1, 0, 0]) : [1, 0, 0];
    const size = vector ? asNumber(vector.args[1], 1) * scale : scale;
    const at = t => [start[0] + way[0] * size * t, start[1] + way[1] * size * t];
    return [ifcLineEl(at(first.parameter || 0), at(second.parameter || 1))].filter(Boolean);
  }

  if (basis.type === "IFCCIRCLE") {
    const here = ifcPlacementFrame(model, basis.args[0], scale);
    const r = asNumber(basis.args[1]) * scale;
    const centre = [here.o[0], here.o[1]];
    const turn = Math.atan2(here.x[1], here.x[0]);
    //! A parameter on a circle is an angle FROM ITS OWN X AXIS, so the
    //! placement's rotation is part of it. Read off a point instead when one
    //! was given, because a point is unambiguous and a parameter's units are
    //! whatever the file said its angles were.
    const angleOf = trim => trim.point
      ? Math.atan2(trim.point[1] - centre[1], trim.point[0] - centre[0])
      : turn + (trim.parameter || 0) * (Math.abs(trim.parameter || 0) > Math.PI * 2
          ? Math.PI / 180 : 1);
    let a0 = angleOf(first), a1 = angleOf(second);
    if (!agrees) { const was = a0; a0 = a1; a1 = was; }
    while (a1 <= a0) a1 += Math.PI * 2;
    if (a1 - a0 >= Math.PI * 2 - 1e-9)
      return [{ id: ifcMarkId(), type: "circle", c: ifcRound2(centre), r }];
    return [{ id: ifcMarkId(), type: "arc", c: ifcRound2(centre), r, a0, a1 }];
  }

  //! Anything else trimmed - an ellipse, a spline - is sampled from its own
  //! reading and the trim is taken as the whole of it, which is what a profile
  //! nearly always means by it.
  return ifcCurveElements(model, e.args[0], scale, depth + 1);
}

/* ================================================================== profiles

   Everything swept in a building model is swept from an IfcProfileDef, and
   the schema has two kinds of them: the PARAMETERISED ones, which are a name
   and some numbers - a rectangle, a circle, an I - and the arbitrary ones,
   which are a closed curve and possibly some holes in it.

   Both have a home in the catalogue already, and the distinction is worth
   keeping rather than flattening. A rectangular column read as four lines is
   four lines; read as a Rectangle it still has a width you can change. So a
   parameterised profile comes back as the node it IS, and an arbitrary one
   comes back as a drawing - which is also editable, in the sketcher, which is
   where an arbitrary outline belongs.

   The attribute numbers below are positions in the entity, which is how STEP
   carries them. They are written out in full because an off-by-one here is a
   wall of the wrong thickness rather than an error.                        */

//! IfcProfileDef: ProfileType(0), ProfileName(1). IfcParameterizedProfileDef
//! adds Position(2), and everything below counts from there.
export function ifcProfile(model, value, scale, depth = 0) {
  const e = follow(model, value);
  if (!e || depth > 8) return null;
  const a = e.args || [];
  const size = i => asNumber(a[i], 0) * scale;
  const label = asText(a[1], "");
  const here = ifcPlacementFrame(model, a[2], scale);
  const seat = { at: [here.o[0], here.o[1]], angle: Math.atan2(here.x[1], here.x[0]) };
  const section = (kind, values) => ({
    kind: "section", node: "Section", sectionKind: kind, values, label, ...seat,
  });

  switch (e.type) {
    case "IFCRECTANGLEPROFILEDEF":
      return { kind: "rect", node: "Rectangle", label, ...seat,
               values: { width: size(3), height: size(4), radius: 0 } };
    case "IFCROUNDEDRECTANGLEPROFILEDEF":
      return { kind: "rect", node: "Rectangle", label, ...seat,
               values: { width: size(3), height: size(4), radius: size(5) } };
    case "IFCRECTANGLEHOLLOWPROFILEDEF":
      return section("Rectangular hollow", { depth: size(4), width: size(3),
        wall: size(5), innerRadius: size(6), outerRadius: size(7) });
    case "IFCCIRCLEPROFILEDEF":
      return { kind: "circle", node: "Circle", label, ...seat,
               values: { radius: size(3) } };
    case "IFCCIRCLEHOLLOWPROFILEDEF":
      return section("Circular hollow", { width: size(3) * 2, wall: size(4) });
    case "IFCELLIPSEPROFILEDEF":
      return { kind: "ellipse", node: "Ellipse", label, ...seat,
               values: { major: size(3), minor: size(4) } };

    //! The rolled sections. IFC states an I by its OVERALL width and depth and
    //! the two thicknesses, which is exactly what a section table states, and
    //! exactly what sections.js takes.
    case "IFCISHAPEPROFILEDEF":
      return section("I or H", { width: size(3), depth: size(4), web: size(5),
        flange: size(6), root: size(7), toe: size(8) });
    case "IFCLSHAPEPROFILEDEF":
      return section("L angle", { depth: size(3), width: size(4), web: size(5),
        root: size(6), toe: size(7) });
    case "IFCUSHAPEPROFILEDEF":
      return section("U channel", { depth: size(3), width: size(4), web: size(5),
        flange: size(6), root: size(7), toe: size(8) });
    case "IFCTSHAPEPROFILEDEF":
      return section("T", { depth: size(3), width: size(4), web: size(5),
        flange: size(6), root: size(7), toe: size(8) });
    case "IFCCSHAPEPROFILEDEF":
      return section("C purlin", { depth: size(3), width: size(4), web: size(5),
        flange: size(5), lip: size(6), root: size(7) });
    case "IFCZSHAPEPROFILEDEF":
      return section("Z purlin", { depth: size(3), width: size(4), web: size(5),
        flange: size(6), root: size(7), toe: size(8) });
    case "IFCTRAPEZIUMPROFILEDEF":
      return section("Trapezium", { width: size(3), top: size(4), depth: size(5),
        offset: size(6) });

    case "IFCARBITRARYCLOSEDPROFILEDEF":
      return { kind: "drawn", label, at: [0, 0], angle: 0,
               outer: shutRun(ifcCurveElements(model, a[2], scale)), inner: [], closed: true };
    case "IFCARBITRARYPROFILEDEFWITHVOIDS":
      return { kind: "drawn", label, at: [0, 0], angle: 0,
               outer: shutRun(ifcCurveElements(model, a[2], scale)),
               inner: asList(a[3]).map(one => shutRun(ifcCurveElements(model, one, scale)))
                                  .filter(run => run.length),
               closed: true };
    case "IFCARBITRARYOPENPROFILEDEF":
    case "IFCCENTERLINEPROFILEDEF":
      return { kind: "drawn", label, at: [0, 0], angle: 0,
               outer: ifcCurveElements(model, a[2], scale), inner: [], closed: false };

    case "IFCCOMPOSITEPROFILEDEF": {
      //! Several profiles built as one - a lattice column, a pair of channels
      //! back to back. Drawn together, because the loops are what they are and
      //! only one of them can be the parametric one.
      const parts = asList(a[2]).map(one => ifcProfile(model, one, scale, depth + 1))
                                .filter(Boolean);
      const outer = [], inner = [];
      for (const part of parts) {
        const drawn = ifcProfileElements(part);
        outer.push(...drawn.outer);
        inner.push(...drawn.inner);
      }
      return { kind: "drawn", label, at: [0, 0], angle: 0, outer, inner, closed: true };
    }

    case "IFCDERIVEDPROFILEDEF": {
      //! A profile plus a transform: the same section moved, turned or
      //! mirrored. Read as a drawing of the parent with the transform already
      //! in it, because a Rectangle node cannot be handed a shear.
      const parent = ifcProfile(model, a[2], scale, depth + 1);
      if (!parent) return null;
      const drawn = ifcProfileElements(parent);
      const move = ifcPlacementFrame(model,
        follow(model, a[3]) ? { ref: follow(model, a[3]).id } : null, scale);
      const factor = ifcTransformScale(model, a[3]);
      const put = ([x, y]) => [move.o[0] + (x * move.x[0] + y * move.y[0]) * factor,
                               move.o[1] + (x * move.x[1] + y * move.y[1]) * factor];
      const turned = run => run.map(el => el.type === "line"
        ? { ...el, a: put(el.a), b: put(el.b) }
        : { ...el, c: put(el.c), r: el.r * factor,
            a0: (el.a0 || 0) + Math.atan2(move.x[1], move.x[0]),
            a1: (el.a1 === undefined ? undefined : el.a1 + Math.atan2(move.x[1], move.x[0])) });
      return { kind: "drawn", label: label || parent.label, at: [0, 0], angle: 0,
               outer: turned(drawn.outer), inner: drawn.inner.map(turned), closed: true };
    }
    default: return null;
  }
}

//! WHERE A RUN OF ELEMENTS STARTS AND STOPS, whatever it is made of.
function runEnds(run) {
  const at = el => el.type === "line" ? [el.a, el.b]
    : el.type === "arc" ? [[el.c[0] + el.r * Math.cos(el.a0), el.c[1] + el.r * Math.sin(el.a0)],
                           [el.c[0] + el.r * Math.cos(el.a1), el.c[1] + el.r * Math.sin(el.a1)]]
    : null;
  const first = at(run[0]), last = at(run[run.length - 1]);
  return first && last ? { from: first[0], to: last[1] } : null;
}

//! A PROFILE HAS TO CLOSE, and half the exporters in the world leave it to the
//! reader. IfcArbitraryClosedProfileDef says in the schema that its curve is
//! closed; what is written is often a polyline of four points that does not
//! repeat the first, which read literally is three sides of a rectangle - and
//! three sides of a rectangle pad into a surface rather than a slab. So the
//! last point is joined to the first when they are not already the same. A
//! run that is one circle needs nothing and gets nothing.
function shutRun(run) {
  if (!run || run.length < 2) return run || [];
  const ends = runEnds(run);
  if (!ends || ifcSame2(ends.from, ends.to, 1e-6)) return run;
  const made = ifcLineEl(ends.to, ends.from);
  return made ? [...run, made] : run;
}

//! A profile as a DRAWING, whichever kind it is. The parametric ones are
//! turned into their own outlines here so that anything that has to have
//! elements - a composite profile, a derived one, the fallback when a section
//! will not build - can get them without a second table of shapes.
export function ifcProfileElements(profile) {
  if (!profile) return { outer: [], inner: [] };
  if (profile.kind === "drawn") return { outer: profile.outer, inner: profile.inner };
  const turn = ([x, y]) => {
    const c = Math.cos(profile.angle || 0), s = Math.sin(profile.angle || 0);
    return [(profile.at ? profile.at[0] : 0) + x * c - y * s,
            (profile.at ? profile.at[1] : 0) + x * s + y * c];
  };
  const place = run => run.map(el => el.type === "line"
    ? { ...el, a: turn(el.a), b: turn(el.b) }
    : { ...el, c: turn(el.c),
        a0: el.a0 === undefined ? undefined : el.a0 + (profile.angle || 0),
        a1: el.a1 === undefined ? undefined : el.a1 + (profile.angle || 0) });
  if (profile.kind === "section") {
    const made = sectionOutline(profile.sectionKind, profile.values);
    return { outer: place(made.outer), inner: made.inner.map(place) };
  }
  if (profile.kind === "rect") {
    const w = profile.values.width / 2, h = profile.values.height / 2;
    const r = Math.max(0, profile.values.radius || 0);
    return { outer: place(roundedRing([[-w, -h], [w, -h], [w, h], [-w, h]],
                                      [r, r, r, r], "p")), inner: [] };
  }
  if (profile.kind === "circle")
    return { outer: [{ id: "p1", type: "circle", c: turn([0, 0]),
                       r: profile.values.radius }], inner: [] };
  if (profile.kind === "ellipse") {
    const run = [];
    for (let i = 0; i < IFC_SAMPLES; i++) {
      const t = (i / IFC_SAMPLES) * Math.PI * 2;
      run.push(turn([profile.values.major * Math.cos(t), profile.values.minor * Math.sin(t)]));
    }
    return { outer: ifcRunElements(run, true), inner: [] };
  }
  return { outer: [], inner: [] };
}

/* ============================================ an IFC file as a parametric tree

   THE OUTPUT IS THE MODEL FILE. Not a scene, not a mesh, not an internal
   structure this program keeps somewhere else: the same JSON a hand builds by
   pressing buttons, which is the only form in this program that anything is
   ever really in. So an imported wall is a Sketch and an Extrude with a
   thickness you can drag, an imported column is a Section node that still
   knows it is a 305x305 UC, and the tree it all sits in is the building's own
   - project, site, building, storey, element.

   What each IFC item becomes, which is the mapping IfcOpenShell's IfcGeom
   makes onto OpenCascade and this one makes onto the catalogue:

     IfcExtrudedAreaSolid        Sketch or Rectangle/Circle/Section, + Extrude
     IfcRevolvedAreaSolid        the same profile, + Revolve
     IfcSweptDiskSolid           Circle + Sweep along the directrix
     IfcSurfaceCurveSweptAreaSolid  profile + Sweep
     IfcBooleanResult            Boolean
     IfcBooleanClippingResult    Boolean, or Trim when it clips at a plane
     IfcHalfSpaceSolid           Trim - the plane is infinite, which is the point
     IfcPolygonalBoundedHalfSpace   Extrude of the boundary, then Trim
     IfcMappedItem               the mapped items, placed
     IfcCsgSolid, IfcBlock,      Cube, Extrude, Sphere, Revolve
       IfcRightCircularCylinder,
       IfcRightCircularCone, IfcSphere
     IfcBoundingBox              Cube
     IfcFacetedBrep and the      MeshImported, then MeshToShape - the one road
       face sets and shell         that is not parametric, taken only when
       models                      there is nothing parametric to take
     IfcRelVoidsElement          Boolean difference: a wall less its openings

   Anything not in that list is counted in the report rather than passed over
   in silence, so a file that came in half-built says which entity it was.  */

const IFC_PLACE = { x: 1e-4, angle: 1e-6 };

//! Fresh ids that do not collide with a document already open.
function ifcIdMaker(taken) {
  const used = new Set(taken || []);
  const counts = new Map();
  return prefix => {
    let n = counts.get(prefix) || 0;
    let id;
    do { id = prefix + (++n); } while (used.has(id));
    counts.set(prefix, n);
    used.add(id);
    return id;
  };
}

//! What an IFC type is called in a tree somebody has to read. IFCBUILDINGSTOREY
//! is not a word.
export function ifcLabel(type) {
  const bare = String(type || "").replace(/^IFC/, "").toLowerCase();
  const spaced = bare.replace(/(element|type|storey|structure)$/, m => " " + m);
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function ifcFeatures(model, options = {}) {
  const scale = options.scale === undefined ? ifcScale(model) : options.scale;
  const fresh = ifcIdMaker(options.taken);
  const features = [];
  const report = { products: 0, built: 0, empty: 0, nodes: 0, facets: 0,
                   made: {}, missed: {}, notes: [] };
  const missed = type => { report.missed[type] = (report.missed[type] || 0) + 1; };
  const made = type => { report.made[type] = (report.made[type] || 0) + 1; };

  const byId = new Map();
  const put = (type, name, args, parent) => {
    const id = fresh(IFC_PREFIX[type] || "IF");
    const made = { id, type, name, parent, args };
    //! THE WIREFRAME IS BLUE. Every datum this reader makes - the placement
    //! planes, the profile points, the sketches the extrusions are pulled
    //! from - is setting-out rather than building, and setting-out reads as
    //! one colour or it does not read at all.
    if (IFC_WIRE.has(type)) made.appearance = { finish: "matte", color: IFC_BLUE };
    features.push(made);
    byId.set(id, made);
    report.nodes++;
    return id;
  };
  //! What a product is made of, put on the node that IS the product - the
  //! last one, after the openings have been cut out of it, because that is
  //! the one anybody sees.
  const paint = (id, colour) => {
    const one = byId.get(id);
    if (one && colour) one.appearance = { finish: "matte", color: colour };
    return id;
  };

  //! DATUMS ARE SHARED. A storey of two hundred slabs is two hundred planes
  //! with the same origin and the same normal, and made one at a time that is
  //! six hundred datum nodes nobody will ever look at. Keyed on the rounded
  //! numbers, so two placements that agree to a tenth of a micron are one.
  const datums = new Map();
  const keyed = (key, build) => {
    const had = datums.get(key);
    if (had) return had;
    const id = build();
    datums.set(key, id);
    return id;
  };
  let datumSet = null;
  const datumHome = () => datumSet || (datumSet = put("GeometricalSet", "Placements",
    { inputs: "", shell: "Open" }, null));

  const round = (v, step) => Math.round(v / step) * step;
  const pointNode = p => keyed("p:" + p.map(v => round(v, IFC_PLACE.x)).join(","),
    () => put("Point", "Point", { kind: "Coordinates", x: p[0], y: p[1], z: p[2] },
              datumHome()));
  const vectorNode = v => keyed("v:" + v.map(n => round(n, 1e-7)).join(","),
    () => put("Vector", "Direction", { kind: "Components", dx: v[0], dy: v[1], dz: v[2] },
              datumHome()));
  const planeNode = frame => keyed("pl:" + [...frame.o.map(v => round(v, IFC_PLACE.x)),
                                            ...frame.z, ...frame.x].join(","), () =>
    put("Plane", "Plane", { kind: "Origin and normal",
                            origin: { ref: pointNode(frame.o) },
                            normal: { ref: vectorNode(frame.z) },
                            xdir: { ref: vectorNode(frame.x) }, size: 1000 },
        datumHome()));

  /* ------------------------------------------------------- a profile, placed */

  //! The profile of a sweep, as whichever node says the most about it. A
  //! rectangle stays a Rectangle - with a width somebody can drag - and an
  //! outline that was drawn becomes a drawing, which is editable in the one
  //! place an outline should be.
  function profileNode(profile, frame, into, name) {
    if (!profile) return null;
    const plane = planeNode(frame);
    const seat = profile.at && (Math.abs(profile.at[0]) > 1e-9 || Math.abs(profile.at[1]) > 1e-9)
      ? pointNode(ifcAt(frame, [profile.at[0], profile.at[1], 0])) : null;
    const turn = (profile.angle || 0) * 180 / Math.PI;

    if (profile.kind === "rect" && profile.values.width > 0 && profile.values.height > 0) {
      made("Rectangle");
      return put("Rectangle", name, { plane: { ref: plane },
        ...(seat ? { at: { ref: seat } } : {}),
        onPlane: "Is what it lies on", anchor: "Its middle", angle: turn,
        width: profile.values.width, height: profile.values.height,
        radius: profile.values.radius || 0 }, into);
    }
    if (profile.kind === "circle" && profile.values.radius > 0) {
      made("Circle");
      return put("Circle", name, { plane: { ref: plane },
        ...(seat ? { centre: { ref: seat } } : {}),
        onPlane: "Is what it lies on", kind: "A radius",
        radius: profile.values.radius }, into);
    }
    if (profile.kind === "ellipse" && profile.values.major > 0) {
      made("Ellipse");
      return put("Ellipse", name, { plane: { ref: plane },
        ...(seat ? { centre: { ref: seat } } : {}),
        onPlane: "Is what it lies on", trim: "The whole ellipse", angle: turn,
        major: profile.values.major, minor: profile.values.minor }, into);
    }
    if (profile.kind === "section") {
      made("Section");
      const v = profile.values;
      return put("Section", profile.label || name, { plane: { ref: plane },
        ...(seat ? { centre: { ref: seat } } : {}),
        kind: profile.sectionKind,
        depth: v.depth || 0, width: v.width || 0, web: v.web || v.wall || 0,
        flange: v.flange || 0, root: v.root || v.outerRadius || 0,
        toe: v.toe || v.innerRadius || 0, lip: v.lip || 0,
        top: v.top || 0, offset: v.offset || 0 }, into);
    }

    const drawn = ifcProfileElements(profile);
    if (!drawn.outer.length) return null;
    made("Sketch");
    const elements = [];
    let mark = 0;
    for (const run of [drawn.outer, ...drawn.inner])
      for (const el of run) elements.push({ ...el, id: "e" + (++mark) });
    return put("Sketch", name, { plane: { ref: plane },
      ...(seat ? { origin: { ref: seat } } : {}),
      faces: profile.closed === false ? "Leave as wires" : "Make faces",
      solve: "Ignore", passes: 0,
      drawing: { elements, constraints: [] } }, into);
  }

  //! EVERYTHING ONE THING IS MADE OF, as a single node.
  //!
  //! A product or a family is a LIST of representation items, and how they
  //! come together depends on what they are. Shapes join. Triangles do not -
  //! Join takes solids and curves, and handed a pile of meshes it ends up
  //! wired to nothing and fails with a message about a bar joist that is
  //! really a message about a list. So a thing made entirely of face sets
  //! becomes ONE mesh, which is also what it is: eleven face sets that belong
  //! together are one joist, not eleven.
  function bodyOf(items, frame, into, name) {
    if (!items.length) return null;
    if (items.every(one => IFC_MESHY.has(one.type)))
      return meshNode(items, frame, into, name);
    const built = items.map((one, i) =>
      itemNode({ ref: one.id }, frame, into,
               items.length > 1 ? name + " " + (i + 1) : name, 1)).filter(Boolean);
    if (!built.length) return null;
    if (built.length === 1) return built[0];
    made("Join");
    return put("Join", name, { parts: built.map(ref => ({ ref })) }, into);
  }

  //! An axis system, for the one node that places an instance by saying where
  //! its frame went. Shared like every other datum.
  function axisNode(frame) {
    return keyed("ax:" + [...frame.o.map(v => round(v, IFC_PLACE.x)),
                          ...frame.x, ...frame.y].join(","), () =>
      put("AxisSystem", "Placement", { kind: "Origin and directions",
        origin: { ref: pointNode(frame.o) }, xdir: { ref: vectorNode(frame.x) },
        ydir: { ref: vectorNode(frame.y) }, size: 500 }, datumHome()));
  }

  const sameFrame = (a, b) => {
    for (let i = 0; i < 3; i++) {
      if (Math.abs(a.o[i] - b.o[i]) > IFC_PLACE.x) return false;
      if (Math.abs(a.x[i] - b.x[i]) > 1e-7 || Math.abs(a.z[i] - b.z[i]) > 1e-7) return false;
    }
    return true;
  };

  //! THE SHAPE A MAPPED ITEM POINTS AT, built once and kept. Everything it
  //! makes goes in one set per family, so the tree reads as a library of
  //! components with the building assembled out of them - which is what the
  //! file says and what Revit's own browser shows.
  const families = new Map();
  let familyHome = null;
  function familyNode(source, name) {
    const had = families.get(source.id);
    if (had !== undefined) return had;
    families.set(source.id, null);                  // guard against a cycle
    if (!familyHome)
      familyHome = put("GeometricalSet", "Families", { inputs: "", shell: "Open" }, null);
    const shape = follow(model, source.args[1]);
    const items = shape ? followAll(model, shape.args[3]) : [];
    const set = put("GeometricalSet", name, { inputs: "", shell: "Open" }, familyHome);
    const id = bodyOf(items, IFC_IDENTITY, set, name);
    families.set(source.id, id);
    return id;
  }

  /* ----------------------------------------------------- the items themselves */

  //! The boundary of a polygonal half space, swept along its own Z: the fence
  //! the half space is cut out of.
  function fence(seat, reach, boundary, into, name) {
    const drawn = put("Sketch", name + " bound", { plane: { ref: planeNode(seat) },
      faces: "Make faces", solve: "Ignore", passes: 0,
      drawing: { elements: boundary.map((el, i) => ({ ...el, id: "b" + (i + 1) })),
                 constraints: [] } }, into);
    return put("Extrude", name + " fence", { profile: { ref: drawn },
      limit: "Distance", distance: reach, cap: "Solid",
      way: "Normal to the profile" }, into);
  }

  //! One representation item, as the id of the node that builds it - or null,
  //! with the reason counted in the report. \p frame is where the item's own
  //! coordinates sit in the world.
  function itemNode(value, frame, into, name, depth = 0) {
    const e = follow(model, value);
    if (!e || depth > 24) return null;
    const a = e.args || [];
    switch (e.type) {

      case "IFCEXTRUDEDAREASOLID": {
        const place = ifcCompose(frame, ifcPlacementFrame(model, a[1], scale));
        const profile = ifcProfile(model, a[0], scale);
        const section = profileNode(profile, place, into, name);
        if (!section) { missed(e.type); return null; }
        const along = ifcDirection(model, a[2], [0, 0, 1]);
        const depthOf = asNumber(a[3], 0) * scale;
        if (!(Math.abs(depthOf) > 1e-9)) { missed(e.type); return null; }
        made("Extrude");
        //! STRAIGHT UP OFF THE PROFILE is what a wall, a slab and a column all
        //! are, and it is the one case that needs no direction node at all.
        //! A sheared extrusion - rarer, and real - gets one.
        const square = Math.abs(along[0]) < 1e-9 && Math.abs(along[1]) < 1e-9 && along[2] > 0;
        const world = [place.x[0] * along[0] + place.y[0] * along[1] + place.z[0] * along[2],
                       place.x[1] * along[0] + place.y[1] * along[1] + place.z[1] * along[2],
                       place.x[2] * along[0] + place.y[2] * along[1] + place.z[2] * along[2]];
        return put("Extrude", name, { profile: { ref: section },
          limit: "Distance", distance: depthOf, cap: "Solid",
          ...(square ? { way: "Normal to the profile" }
                     : { way: "A direction", direction: { ref: vectorNode(world) } }) }, into);
      }

      case "IFCREVOLVEDAREASOLID": {
        const place = ifcCompose(frame, ifcPlacementFrame(model, a[1], scale));
        const profile = ifcProfile(model, a[0], scale);
        const section = profileNode(profile, place, into, name);
        if (!section) { missed(e.type); return null; }
        const axis = follow(model, a[2]);
        const at = axis ? ifcAt(place, ifcPoint(model, axis.args[0], scale)) : place.o;
        const local = axis ? ifcDirection(model, axis.args[1], [0, 0, 1]) : [0, 0, 1];
        const way = [place.x[0] * local[0] + place.y[0] * local[1] + place.z[0] * local[2],
                     place.x[1] * local[0] + place.y[1] * local[1] + place.z[1] * local[2],
                     place.x[2] * local[0] + place.y[2] * local[1] + place.z[2] * local[2]];
        made("Revolve");
        return put("Revolve", name, { profile: { ref: section },
          axis: { ref: vectorNode(way) }, through: { ref: pointNode(at) },
          angle: asNumber(a[3], Math.PI * 2) * ifcAngleScale(model), cap: "Solid" }, into);
      }

      case "IFCSWEPTDISKSOLID": {
        const rail = curveNode(a[0], frame, into, name + " path");
        if (!rail) { missed(e.type); return null; }
        const r = asNumber(a[1], 0) * scale;
        const start = railStart(model, a[0], frame, scale);
        const ring = put("Circle", name + " section",
          { plane: { ref: planeNode(ifcFrame(start.at, start.along, null)) },
            onPlane: "Is what it lies on", kind: "A radius", radius: r }, into);
        made("Sweep");
        return put("Sweep", name, { profile: { ref: ring }, spine: { ref: rail },
                                    cap: "Solid" }, into);
      }

      case "IFCSURFACECURVESWEPTAREASOLID":
      case "IFCFIXEDREFERENCESWEPTAREASOLID": {
        const place = ifcCompose(frame, ifcPlacementFrame(model, a[1], scale));
        const profile = ifcProfile(model, a[0], scale);
        const section = profileNode(profile, place, into, name + " section");
        const rail = curveNode(a[2], frame, into, name + " path");
        if (!section || !rail) { missed(e.type); return null; }
        made("Sweep");
        return put("Sweep", name, { profile: { ref: section }, spine: { ref: rail },
                                    cap: "Solid" }, into);
      }

      case "IFCBOOLEANRESULT":
      case "IFCBOOLEANCLIPPINGRESULT": {
        const how = asText(a[0], "DIFFERENCE").toUpperCase();
        const first = itemNode(a[1], frame, into, name, depth + 1);
        if (!first) { missed(e.type); return null; }
        const second = follow(model, a[2]);
        //! A HALF-SPACE IS NOT A SOLID, it is a side of a plane, and a boolean
        //! against one is a trim. Done as a Trim rather than as a Boolean with
        //! a very large box, because a plane is infinite and a box is a guess
        //! about how big the building is.
        if (second && (second.type === "IFCHALFSPACESOLID")) {
          const cut = halfSpaceTrim(first, second, frame, into, name, how);
          if (cut) return cut;
        }
        const other = itemNode(a[2], frame, into, name + " cut", depth + 1);
        //! NOTHING TAKEN AWAY IS THE FIRST OPERAND, not a failure. A clip that
        //! does not reach the thing it clips is a real thing for a file to
        //! say, and the answer to it is the body unchanged - not an element
        //! missing from the building.
        if (!other) {
          if (how === "INTERSECTION") { missed(e.type); return null; }
          return first;
        }
        made("Boolean");
        return put("Boolean", name, { a: { ref: first }, b: { ref: other },
          op: how === "UNION" ? "Union" : how === "INTERSECTION" ? "Intersection"
                                                                 : "Difference" }, into);
      }

      case "IFCPOLYGONALBOUNDEDHALFSPACE": {
        //! The half-space, fenced in by a polygon swept along the placement's
        //! own Z. Built as the prism and then trimmed at the plane, which is
        //! what it is.
        const place = ifcCompose(frame, ifcPlacementFrame(model, a[2], scale));
        //! CLOSED, whatever the file wrote. The polygonal boundary is a closed
        //! curve by the schema and is routinely written as a polyline that
        //! does not repeat its first point - read literally that is three
        //! sides of a rectangle, which pads into a SURFACE, and a surface
        //! trimmed at a plane has no volume for the boolean above it to take
        //! away. Measured: four of the eighteen clipped elements in a Revit
        //! model came out empty for exactly this.
        const boundary = shutRun(ifcCurveElements(model, a[3], scale));
        if (!boundary.length) { missed(e.type); return null; }
        //! HOW FAR THE FENCE HAS TO RUN, worked out rather than assumed.
        //!
        //! The schema's prism is INFINITE along the placement's own Z and is
        //! bounded only by the base surface, so any finite stand-in has to at
        //! least cross that surface - and a fixed hundred metres does not when
        //! the surface is further away than that, which in a model set out on
        //! survey coordinates it can easily be. Six of the eighteen clipped
        //! elements in a Revit model came back empty for exactly that: the
        //! trim was cutting at a plane the prism never reached.
        //!
        //! So the prism is centred ON the plane and made long enough to hold
        //! the boundary several times over, which is the only length here that
        //! has anything to do with the geometry.
        const surface = follow(model, a[0]);
        const cutAt = ifcCompose(frame, ifcPlacementFrame(model,
          surface ? surface.args[0] : null, scale));
        //! HOW FAR ALONG THE PRISM'S OWN AXIS THE PLANE IS, which is not the
        //! same as how far the plane's ORIGIN is when the plane is tilted: the
        //! parameter is the distance to the plane divided by how steeply the
        //! axis runs into it. Read the short way, a clipping plane at an angle
        //! put the prism somewhere it never met the plane - which is how six
        //! clipped elements in a Revit model came out empty.
        const steepness = ifcDot(place.z, cutAt.z);
        const gap = Math.abs(steepness) < 1e-12 ? Infinity
          : ifcDot(ifcSub(cutAt.o, place.o), cutAt.z) / steepness;
        let across = 0;
        for (const el of boundary) {
          const ends = el.type === "line" ? [el.a, el.b] : [[el.c[0] - el.r, el.c[1] - el.r],
                                                            [el.c[0] + el.r, el.c[1] + el.r]];
          for (const p of ends) across = Math.max(across, Math.abs(p[0]), Math.abs(p[1]));
        }
        const reach = options.reach || Math.max(20000, across * 8);

        //! WHEN THE FENCE NEVER MEETS THE PLANE AT ALL, which is decidable
        //! here and nowhere downstream.
        //!
        //! The prism runs along the placement's Z. If the base surface is not
        //! parallel to that, the prism crosses it - the prism is infinite in
        //! the schema and centred on the crossing here, so it always does. If
        //! it IS parallel, the prism lies wholly on one side, and which side
        //! is decided by the boundary's own corners. Either the bounded half
        //! space is the whole prism, or it is EMPTY - and an empty one is a
        //! clip that takes nothing away, which is a thing files really say.
        //! Six of eighteen in a Revit model, and each of them failed a family
        //! that was placed a hundred times over.
        const agreesWith = asText(a[1], "T") !== "F";
        //! ...OR SO NEARLY PARALLEL THAT IT MIGHT AS WELL BE. A prism running
        //! a thousandth off parallel to its own base surface meets it five
        //! kilometres away, which is outside the building and outside any
        //! finite stand-in for an infinite prism. The test is not the angle,
        //! it is WHERE the crossing falls: past this and the prism is on one
        //! side of the plane everywhere anybody is looking.
        const tooFar = Math.max(across * 50, 100000);
        if (!Number.isFinite(gap) || Math.abs(gap) > tooFar) {
          let lowest = Infinity, highest = -Infinity;
          for (const el of boundary) {
            const ends = el.type === "line" ? [el.a, el.b]
              : [[el.c[0] - el.r, el.c[1]], [el.c[0] + el.r, el.c[1]],
                 [el.c[0], el.c[1] - el.r], [el.c[0], el.c[1] + el.r]];
            for (const p of ends) {
              const at = ifcDot(ifcSub(ifcAt(place, [p[0], p[1], 0]), cutAt.o), cutAt.z);
              lowest = Math.min(lowest, at); highest = Math.max(highest, at);
            }
          }
          //! The material is on the side the agreement flag names - see
          //! halfSpaceTrim, where the same rule is read the other way round.
          const inside = agreesWith ? highest <= 1e-6 : lowest >= -1e-6;
          const outside = agreesWith ? lowest >= -1e-6 : highest <= 1e-6;
          if (outside) { report.notes.push(name + ": a clip that takes nothing away"); return null; }
          if (!inside) { /* the boundary straddles it: fall through and trim */ }
          else return fence(ifcFrame(ifcAt(place, [0, 0, gap - reach / 2]), place.z, place.x),
                            reach, boundary, into, name);
        }
        const seat = ifcFrame(ifcAt(place, [0, 0, gap - reach / 2]), place.z, place.x);
        return trimAt(fence(seat, reach, boundary, into, name), surface, frame,
                      into, name, agreesWith);
      }

      case "IFCHALFSPACESOLID":
        //! On its own it is unbounded, so there is nothing to build. Only ever
        //! meaningful as the second operand of a boolean, which is handled
        //! above; reaching here means a file stated one as a body in itself.
        missed(e.type);
        return null;

      //! AN INSTANCE, AND ONLY ONE OF THE THING. IfcRepresentationMap is how
      //! IFC says "another one of those", and a file from Revit is mostly made
      //! of them: nine hundred beams sharing one shape, each with a placement.
      //!
      //! Built inline, that is nine hundred copies of the same nodes - the
      //! first attempt at this file made 16,318 mesh nodes out of 1,358 face
      //! sets, for exactly that reason. So the map is built ONCE, into a set
      //! of its own, and every instance is an Axis to axis onto it. That is
      //! also what the file MEANS, and what anybody editing the result wants:
      //! change the family, change nine hundred beams.
      case "IFCMAPPEDITEM": {
        const source = follow(model, a[0]);
        if (!source) { missed(e.type); return null; }
        const master = familyNode(source, name);
        if (!master) { missed(e.type); return null; }
        const target = ifcPlacementFrame(model, a[1], scale);
        const place = ifcCompose(ifcCompose(frame, target),
                                 ifcPlacementFrame(model, source.args[0], scale));
        if (sameFrame(place, IFC_IDENTITY)) return master;
        made("AxisToAxis");
        return put("AxisToAxis", name, { shape: { ref: master },
          from: { ref: axisNode(IFC_IDENTITY) }, to: { ref: axisNode(place) } }, into);
      }

      case "IFCCSGSOLID": return itemNode(a[0], frame, into, name, depth + 1);

      case "IFCBLOCK": {
        const place = ifcCompose(frame, ifcPlacementFrame(model, a[0], scale));
        made("Cube");
        return put("Cube", name, { origin: { ref: pointNode(place.o) },
          plane: { ref: planeNode(place) },
          dx: asNumber(a[1], 0) * scale, dy: asNumber(a[2], 0) * scale,
          dz: asNumber(a[3], 0) * scale }, into);
      }
      case "IFCSPHERE": {
        const place = ifcCompose(frame, ifcPlacementFrame(model, a[0], scale));
        made("Sphere");
        return put("Sphere", name, { center: { ref: pointNode(place.o) },
          radius: asNumber(a[1], 0) * scale }, into);
      }
      case "IFCRIGHTCIRCULARCYLINDER": {
        const place = ifcCompose(frame, ifcPlacementFrame(model, a[0], scale));
        const ring = put("Circle", name + " section", { plane: { ref: planeNode(place) },
          onPlane: "Is what it lies on", kind: "A radius",
          radius: asNumber(a[2], 0) * scale }, into);
        made("Extrude");
        return put("Extrude", name, { profile: { ref: ring }, limit: "Distance",
          distance: asNumber(a[1], 0) * scale, cap: "Solid",
          way: "Normal to the profile" }, into);
      }
      case "IFCBOUNDINGBOX": {
        const corner = ifcAt(frame, ifcPoint(model, a[0], scale));
        made("Cube");
        return put("Cube", name, { origin: { ref: pointNode(corner) },
          plane: { ref: planeNode(frame) },
          dx: asNumber(a[1], 0) * scale, dy: asNumber(a[2], 0) * scale,
          dz: asNumber(a[3], 0) * scale }, into);
      }

      case "IFCFACETEDBREP":
      case "IFCADVANCEDBREP":
      case "IFCFACEBASEDSURFACEMODEL":
      case "IFCSHELLBASEDSURFACEMODEL":
      case "IFCPOLYGONALFACESET":
      case "IFCTRIANGULATEDFACESET":
        return meshNode([e], frame, into, name);

      default:
        missed(e.type);
        return null;
    }
  }

  //! A curve in the world, as a node. Sweeps need one; so does a directrix.
  function curveNode(value, frame, into, name) {
    const elements = ifcCurveElements(model, value, scale);
    if (!elements.length) return null;
    made("Sketch");
    return put("Sketch", name, { plane: { ref: planeNode(frame) },
      faces: "Leave as wires", solve: "Ignore", passes: 0,
      drawing: { elements: elements.map((el, i) => ({ ...el, id: "r" + (i + 1) })),
                 constraints: [] } }, into);
  }

  //! Where a rail starts and which way it sets off - all a round section needs
  //! in order to stand square to it.
  function railStart(model_, value, frame) {
    const elements = ifcCurveElements(model_, value, scale);
    const first = elements[0];
    if (!first) return { at: frame.o, along: frame.z };
    const a = first.type === "line" ? first.a
      : [first.c[0] + first.r * Math.cos(first.a0 || 0),
         first.c[1] + first.r * Math.sin(first.a0 || 0)];
    const b = first.type === "line" ? first.b
      : [first.c[0] + first.r * Math.cos((first.a0 || 0) + 0.01),
         first.c[1] + first.r * Math.sin((first.a0 || 0) + 0.01)];
    const way = [b[0] - a[0], b[1] - a[1]];
    const size = Math.hypot(way[0], way[1]) || 1;
    return { at: ifcAt(frame, [a[0], a[1], 0]),
             along: [(way[0] / size) * frame.x[0] + (way[1] / size) * frame.y[0],
                     (way[0] / size) * frame.x[1] + (way[1] / size) * frame.y[1],
                     (way[0] / size) * frame.x[2] + (way[1] / size) * frame.y[2]] };
  }

  //! A body cut at the plane of a half-space. \p agrees is IFC's agreement
  //! flag: true when the surface normal points AWAY from the material, which
  //! is to say the solid is behind the plane.
  //! \p surface is the IfcPlane itself, already resolved - not the half space
  //! that names it. Handed the half space by mistake, this followed its FIRST
  //! attribute one step too far and cut at a plane through the base surface's
  //! own location point instead, which put the cut metres away from where the
  //! file said and left six clipped walls with nothing on the kept side.
  function trimAt(body, surface, frame, into, name, agrees) {
    if (!body || !surface) return null;
    const place = ifcCompose(frame, ifcPlacementFrame(model,
      surface.args ? surface.args[0] : null, scale));
    made("Trim");
    return put("Trim", name, { body: { ref: body }, by: { ref: planeNode(place) },
      side: agrees ? "Behind the plane" : "In front of it" }, into);
  }

  function halfSpaceTrim(body, half, frame, into, name, how) {
    const surface = follow(model, half.args[0]);
    if (!surface) return null;
    const agrees = asText(half.args[1], "T") !== "F";
    //! Cutting a half-space AWAY leaves the other side; intersecting with it
    //! leaves that side. Both are the same trim with the sense turned over.
    const keepBehind = how === "INTERSECTION" ? agrees : !agrees;
    return trimAt(body, surface, frame, into, name, keepBehind);
  }

  /* ----------------------------------------------------------- the last road

     TRIANGLES, when there is nothing parametric to be had. An IfcFacetedBrep
     is already a decision somebody's exporter made to stop describing the
     shape and start describing its surface, and there is nothing to recover
     from it - so it comes in as a mesh, and the report says how many did.  */

  function meshNode(list, frame, into, name) {
    const all = asList(list);
    const e = all[0];
    if (!e) return null;
    if (options.meshes === "skip") { missed(e.type); return null; }
    const obj = objOf(model, all, frame, scale);
    if (!obj || !obj.faces) { missed(e.type); return null; }
    made("MeshImported");
    report.facets += obj.faces;
    //! LEFT AS A MESH, not sewn into a solid. Sewing 1,358 face sets is
    //! minutes of OpenCascade for a result nobody asked for: a mesh draws, it
    //! measures, it exports, and the one thing it cannot do is have a fillet
    //! put on it - which is not a thing anybody does to an imported handrail
    //! bracket. Mesh to shape is one node away for the cases that want it, and
    //! "as solids" asks for it up front.
    const mesh = put("MeshImported", name,
      { obj: obj.text, source: ifcLabel(e.type), smooth: "Faceted" }, into);
    if (options.meshes !== "solids") return mesh;
    made("MeshToShape");
    return put("MeshToShape", name + " solid", { mesh: { ref: mesh }, levels: 0,
      boundary: "Keep sharp", tolerance: 0.1, solid: "A solid if it closes" }, into);
  }
  return finish();

  /* ------------------------------------------------------------ the walk */

  function finish() {
    const structure = ifcStructure(model);
    const top = [];
    for (const root of structure.roots) top.push(walk(root, null));
    if (structure.loose.length) {
      const home = put("GeometricalSet", "Not in any storey",
                       { inputs: "", shell: "Open" }, null);
      for (const one of structure.loose) walk(one, home);
    }
    void top;
    //! THE SCAFFOLDING IS PUT AWAY, not deleted. Every placement in the file
    //! is a point, two directions and a plane, and a building has thousands -
    //! drawn, they are a fog of orange marks over the thing you came to look
    //! at, and they are most of what the picker has to test a click against.
    //! They are still in the tree and still what the geometry stands on; they
    //! are just not drawn until somebody asks for them.
    const away = [];
    for (const home of [datumSet, familyHome]) {
      if (!home) continue;
      away.push(home);
      const walk = at => {
        for (const f of features) if (f.parent === at) { away.push(f.id); walk(f.id); }
      };
      walk(home);
    }
    return { features, report, scale, hidden: away };
  }

  //! The tail of a GlobalId, which is what tells two walls of the same type
  //! apart in a tree - and what a person pastes back into the authoring tool
  //! to find the thing this came from.
  function tag(entity) {
    const id = ifcGlobalId(entity);
    return id ? " [" + id.slice(-6) + "]" : "";
  }

  //! One node of the building's structure: a set, and inside it either more
  //! sets or the nodes that build the thing.
  function walk(node, parent) {
    const naming = node.name || ifcLabel(node.type);
    const set = put("GeometricalSet",
      node.spatial ? naming : naming + tag(node.entity),
      { inputs: "", shell: "Open" }, parent);
    if (!node.spatial) {
      report.products++;
      if (!build(node.entity, set)) report.empty++;
      else report.built++;
    }
    for (const child of node.children) walk(child, set);
    for (const part of node.parts) walk(part, set);
    return set;
  }

  //! Everything one product builds: its own items, joined, less its openings.
  function build(entity, set) {
    const frame = ifcWorldFrame(model, entity.args[5], scale);
    const items = ifcBodyItems(model, entity);
    if (!items.length) return null;
    const name = entity.name || ifcName(entity) || ifcLabel(entity.type);
    let body = bodyOf(items, frame, set, name);
    if (!body) return null;

    //! A WALL IS A WALL LESS ITS WINDOWS. IfcRelVoidsElement is how a file
    //! says so, and an import that skipped it would give solid walls with
    //! openings drawn on them somewhere else in the tree.
    for (const rel of pointingAt(model, entity, "IFCRELVOIDSELEMENT")) {
      if (!isRef(rel.args[4]) || rel.args[4].ref !== entity.id) continue;
      const hole = follow(model, rel.args[5]);
      if (!hole) continue;
      const cutFrame = ifcWorldFrame(model, hole.args[5], scale);
      const holes = ifcBodyItems(model, hole).map((item, i) =>
        itemNode({ ref: item.id }, cutFrame, set, "Opening " + (i + 1))).filter(Boolean);
      for (const one of holes) {
        made("Boolean");
        body = put("Boolean", name, { a: { ref: body }, b: { ref: one },
                                      op: "Difference" }, set);
      }
    }
    return paint(body, IFC_COLOURS[entity.type] || null);
  }
}

/* --------------------------------------------------- what a building is made of

   A COLOUR PER TRADE, which is how anybody reads a model they did not build.

   An IFC file names what every product IS - a beam, a column, a slab - and
   that naming is the most useful thing in the file after the geometry. Drawn
   all in one grey it is six thousand extrusions; drawn by class it is a frame
   with a floor on it, and you can see at a glance that somebody has modelled
   a column as a wall.

   These are the four the eye needs and no more: everything else keeps the
   neutral grey a body has when nobody has said anything about it, so the
   colours that ARE here mean something.                                    */

const IFC_BLUE = [0.16, 0.42, 0.78];
const IFC_ORANGE = [0.90, 0.49, 0.13];
const IFC_GREEN = [0.29, 0.62, 0.32];
const IFC_GREY = [0.62, 0.63, 0.64];

const IFC_COLOURS = {
  IFCBEAM: IFC_ORANGE, IFCBEAMSTANDARDCASE: IFC_ORANGE,
  IFCCOLUMN: IFC_GREEN, IFCCOLUMNSTANDARDCASE: IFC_GREEN,
  IFCSLAB: IFC_GREY, IFCSLABSTANDARDCASE: IFC_GREY,
  IFCSLABELEMENTEDCASE: IFC_GREY, IFCROOF: IFC_GREY,
};

//! The node types this reader makes that are setting-out rather than
//! building. A Sketch is on the list because a sketch IS a wireframe, whether
//! or not something has been pulled out of it.
const IFC_WIRE = new Set(["Point", "Vector", "Plane", "Sketch", "Rectangle",
                          "Circle", "Ellipse", "Section"]);

//! What each node type's ids are prefixed with, matching the document's own
//! habit - the reader has to be able to tell a sketch from a solid at a glance
//! in a tree eleven thousand nodes long.
const IFC_PREFIX = {
  Point: "PO", Vector: "VE", Plane: "PL", Sketch: "SK", Rectangle: "RE",
  Circle: "CI", Ellipse: "EL", Section: "SC", Extrude: "EX", Revolve: "RV",
  Sweep: "SW", Boolean: "BO", Trim: "TM", Join: "JN", Cube: "CU", Sphere: "SP",
  MeshImported: "MI", MeshToShape: "MS", GeometricalSet: "GS",
};

/* ---------------------------------------------------------- triangles, as OBJ

   The one road out of here that is not parametric. Written as OBJ because
   that is what the MeshImported node reads, and because an IFC face set and
   an OBJ are the same thing said twice.                                     */

export function objOf(model, entities, frame, scale) {
  const lines = [];
  let vertices = 0, faces = 0;
  //! CORNERS ARE SHARED, and they have to be or the mesh is not a mesh.
  //!
  //! A faceted B-rep names every corner of every facet separately - the file
  //! says so, and an exporter has no reason not to. Written out one corner at
  //! a time, a box becomes twenty-four vertices and twelve triangles in which
  //! every single edge has exactly one face on it. That is a triangle SOUP,
  //! not a surface: it shades faceted, it cannot be subdivided, it cannot be
  //! sewn into a solid, and a section through it finds no closed region to
  //! poche - a whole IFC building sections to an empty sheet, which is the
  //! failure that looks most like "it has not finished building yet".
  //!
  //! So identical corners are one corner. Keyed on the coordinate written
  //! rather than on a tolerance, because two corners a file says are in the
  //! same place are the same corner and two it says are a micron apart are a
  //! micron apart - guessing which is which is how a shape loses a feature.
  const shared = new Map();
  const say = p => {
    const at = ifcAt(frame, p);
    const key = at[0] + "," + at[1] + "," + at[2];
    const had = shared.get(key);
    if (had) return had;
    lines.push("v " + at[0] + " " + at[1] + " " + at[2]);
    shared.set(key, ++vertices);
    return vertices;
  };
  const ring = run => {
    if (run.length < 3) return;
    lines.push("f " + run.join(" "));
    faces++;
  };

  //! Everything that is not an indexed face set is faces of bounds of
  //! polyloops, however it is wrapped: a faceted B-rep, a shell model, a
  //! face-based surface model. Walked rather than addressed, because the
  //! wrapping differs and the polyloops do not.
  const walkFaces = value => {
    for (const part of followAll(model, value)) {
      if (part.type === "IFCFACE") {
        for (const bound of followAll(model, part.args[0])) {
          const loop = follow(model, bound.args[0]);
          if (!loop || loop.type !== "IFCPOLYLOOP") continue;
          //! An inner bound is a hole in the facet, and OBJ has no word for
          //! one. An exporter that wrote one had a hole it could have written
          //! as a boolean.
          if (bound.type === "IFCFACEBOUND" && asText(bound.args[1], "T") === "F") continue;
          ring(followAll(model, loop.args[0])
            .map(p => say(ifcPoint(model, { ref: p.id }, scale))));
        }
        continue;
      }
      if (part.args) for (const arg of part.args)
        if (isRef(arg) || Array.isArray(arg)) walkFaces(arg);
    }
  };

  const one = e => {
    if (e.type === "IFCTRIANGULATEDFACESET" || e.type === "IFCPOLYGONALFACESET") {
      const holder = follow(model, e.args[0]);
      const coords = holder ? asList(holder.args[0]).map(row => {
        const xyz = asList(row).map(n => asNumber(n) * scale);
        return [xyz[0] || 0, xyz[1] || 0, xyz[2] || 0];
      }) : [];
      const base = vertices;
      //! WHERE EACH COORDINATE LANDED, kept rather than assumed. The indices
      //! in a face set address the COORD LIST; the numbers a mesh uses address
      //! the vertices written so far, and the two stopped being the same
      //! offset apart the moment identical corners started sharing one vertex.
      //! Assumed, a welded box drew its faces through whichever vertices
      //! happened to be at those positions - which is a shape, and is not this
      //! shape.
      const placed = coords.map(p => say(p));
      //! PnIndex, WHEN THERE IS ONE. A tessellated face set may address its
      //! points through a second list - which is how an exporter shares one
      //! point list between several sets, or writes the same corner once and
      //! refers to it from four faces. Absent, an index means what it says.
      const through = asList(e.type === "IFCTRIANGULATEDFACESET" ? e.args[4] : e.args[3])
        .map(n => Math.round(asNumber(n)));
      const at = n => {
        const one = Math.round(asNumber(n));
        const which = through.length ? (through[one - 1] || one) : one;
        return placed[which - 1] || (base + which);
      };
      if (e.type === "IFCTRIANGULATEDFACESET") {
        //! THE TRIANGLES ARE ATTRIBUTE THREE, not two.
        //!
        //! IfcTriangulatedFaceSet is Coordinates, Normals, Closed, CoordIndex,
        //! PnIndex - and this read the third, which is `Closed`, a boolean. So
        //! every triangulated face set in every file came out with no
        //! triangles in it, and a product whose whole body was one came out
        //! empty. That is IFC4's default way of writing a mesh: across the
        //! buildingSMART certification scenes it was 833 face sets, every
        //! IFC4 and IFC4.3 file in the set, and nothing else was missing.
        for (const row of asList(e.args[3])) ring(asList(row).map(at));
      } else {
        //! IfcPolygonalFaceSet is Coordinates, Closed, Faces, PnIndex, so the
        //! faces really are attribute two. Each is an IfcIndexedPolygonalFace
        //! whose first attribute is the loop; a face with voids in it states
        //! them separately and OBJ has no word for one, so they are left to
        //! the boolean the exporter could have written.
        for (const face of followAll(model, e.args[2]))
          ring(asList(face.args[0]).map(at));
      }
      return;
    }
    const was = faces;
    walkFaces(e.args[0]);
    if (faces === was && e.args[1]) walkFaces(e.args[1]);
  };
  //! SEVERAL AT ONCE, because a family of triangles is one mesh and not
  //! eleven: an imported joist is a dozen face sets that belong together, and
  //! placed two hundred times they have to be ONE thing to place.
  for (const entity of asList(entities)) if (entity) one(entity);
  return { text: lines.join("\n"), faces };
}

//! The representation items that carry triangles rather than a shape.
export const IFC_MESHY = new Set(["IFCFACETEDBREP", "IFCADVANCEDBREP",
  "IFCFACEBASEDSURFACEMODEL", "IFCSHELLBASEDSURFACEMODEL", "IFCPOLYGONALFACESET",
  "IFCTRIANGULATEDFACESET"]);
