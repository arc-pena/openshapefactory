// The IFC package: a building model, opened as a parametric tree.
//
// WHAT IT ADDS. One thing: the page learns to read .ifc. Drop one on the
// window, or open it from the menu, and what arrives is not a scene of
// triangles - it is the document. Project, site, building, storey, element,
// each a geometrical set in the tree with the building's own names on it; and
// inside each element the nodes that build it, which are the ordinary nodes
// off the rail. A wall is a Sketch and an Extrude whose thickness you can
// drag. A column is a Section that still knows it is a UC 305x305x97. A roof
// slab clipped at the pitch is a Trim at a plane.
//
// It brings NO nodes of its own. Everything the mapping needs is in the
// catalogue - Extrude, Revolve, Sweep, Boolean, Trim, Section, Sketch,
// MeshImported - which is the point: a model imported with this package on
// opens again with it off, because there is nothing package-shaped left in it.
// Revolve, Trim and Section went into the catalogue when this was written,
// because a revolution, a cut at a plane and a rolled section are things a
// modeller should have whether or not it reads IFC.
//
// WHERE THE MAPPING CAME FROM. IfcOpenShell's IfcGeom, which is the reference
// for how an IFC representation item becomes a modelling operation, and whose
// correspondence - extruded area solid to prism, revolved area solid to
// revolution, boolean clipping result to a cut at a half space - is what is
// ported here. Its code is not: it has no browser distribution, its WASM road
// is a Python runtime an order of magnitude larger than this whole page, and
// what it would be carried in FOR is its own OpenCascade, which is already
// here. ISO 10303-21 is text; reading it is two hundred lines, and they are in
// ifc.js with no kernel anywhere near them.

import { offerPlugin } from "./plugin.js";
import { ifcFeatures, ifcScale, readIfc } from "./ifc.js";

//! What a person is told after an import. Not a log: three sentences about a
//! building, and then the one thing that matters - what did NOT come through,
//! by name and by count, because an import that quietly dropped four hundred
//! bodies looks exactly like one that did not.
export function ifcSummary(report, name) {
  const lines = [];
  //! A NODE TYPE IS A NAME, not a noun to pluralise: "1045 AxisToAxis" reads
  //! as the node it is and "1045 AxisToAxiss" reads as a typo.
  const bits = Object.entries(report.made).sort((a, b) => b[1] - a[1])
    .map(([type, n]) => n + " " + type);
  lines.push(name + ": " + report.products + " element"
    + (report.products === 1 ? "" : "s") + ", " + report.built + " built as geometry"
    + (report.empty ? " and " + report.empty + " with no body" : ""));
  if (bits.length) lines.push("built from " + bits.slice(0, 9).join(", "));
  if (report.facets)
    lines.push(report.facets.toLocaleString() + " facets came in as meshes - those "
      + "elements were tessellated in the file and carry no shape to rebuild");
  const lost = Object.entries(report.missed).sort((a, b) => b[1] - a[1]);
  if (lost.length)
    lines.push("not read: " + lost.map(([type, n]) => n + " × " + type).join(", "));
  return lines;
}

export const IFC = offerPlugin({
  id: "ifc",
  name: "IFC",
  version: 1,
  summary: "Opens a building model. An IFC file comes in as the document - project, "
         + "site, building, storey, element, each a geometrical set - with every "
         + "element rebuilt from the nodes on the rail rather than tessellated. A "
         + "wall is a sketch and an extrude you can change; a column is a section "
         + "that still knows what section it is.",

  //! None. See the note at the top: an imported model must open again with
  //! this package switched off, so everything it needs is in the catalogue.
  nodes: [],

  api: {
    name: "IfcReader",
    summary: "ISO 10303-21 read as entities, and the IFC representation vocabulary "
           + "mapped onto the catalogue - the correspondence IfcOpenShell's IfcGeom "
           + "makes onto its own geometry, made here onto nodes. Pure arithmetic: a file "
           + "in, a model file out, and no geometry built to do it.",
    operations: [
      { name: "readIfc", takes: "text", gives: "{ schema, entities, byType }",
        summary: "The STEP physical file, parsed. Instances by number, attributes "
               + "positional, with the inverse relationships indexed so \"what is in "
               + "this storey\" is a lookup rather than a search." },
      { name: "ifcScale", takes: "model", gives: "mm per unit",
        summary: "What the numbers in the file mean. A metre-based model read as "
               + "millimetres is a building a thousand times too small, so this is "
               + "read rather than assumed - SI prefixes and the imperial "
               + "conversions both." },
      { name: "ifcStructure", takes: "model", gives: "the spatial tree",
        summary: "Project, site, building, storey and what each contains, following "
               + "both IfcRelAggregates and IfcRelContainedInSpatialStructure - "
               + "decomposition and containment are different relationships and both "
               + "have to be walked." },
      { name: "ifcProfile", takes: "model, profile, scale", gives: "a node or a drawing",
        summary: "An IfcProfileDef as whichever node says the most about it: a "
               + "rectangle stays a Rectangle, an I-section stays a Section, and an "
               + "arbitrary outline becomes a drawing you can open in the sketcher." },
      { name: "ifcFeatures", takes: "model, options", gives: "{ features, report }",
        summary: "The whole file as model-file features. The report says what was "
               + "built, what came in as triangles and what was not read at all." },
    ],
  },

  resources: [],

  async start(kit) {
    //! ONE HOOK: the page learns an extension. Everything else about opening a
    //! file - the drop veil, the size limit, the picker, the sniffing - is the
    //! page's and stays the page's.
    const drop = kit.addReader ? kit.addReader({
      key: "ifc",
      name: "IFC",
      extensions: [".ifc"],
      short: "a building model, as a parametric tree",
      summary: "IFC4 and IFC2X3, read as entities and rebuilt with the nodes on the "
             + "rail. It opens AS the document, because a building is a model and "
             + "not a shape to drop into one.",
      //! A file in, a model file out. Nothing here touches the document: the
      //! page opens what comes back the same way it opens any model file, so
      //! an IFC import is on the undo stack like anything else.
      open(text, name) {
        const model = readIfc(text);
        if (!model.entities.size)
          throw new Error("there are no entities in that file - it may not be IFC");
        const { features, report, scale, hidden } = ifcFeatures(model, {});
        if (!features.length)
          throw new Error("nothing in that file has geometry this can rebuild");
        return {
          model: { format: "ocaf-parametric-model", version: 1,
                   name: (name || "IFC").replace(/\.ifc$/i, ""), units: "mm",
                   features, hidden },
          say: ifcSummary(report, (name || "IFC")
            + (model.schema ? " \u00b7 " + model.schema : "")),
          report, scale,
        };
      },
    }) : null;

    return { dispose: () => { if (drop) drop(); } };
  },
});
