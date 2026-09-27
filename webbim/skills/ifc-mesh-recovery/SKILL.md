---
name: ifc-mesh-recovery
description: How to import IFC models written as triangles or breps (SketchUp, reference-view exports, coordination models, buildingSMART certification datasets) into a BIM as real parametric elements - walls with gables, bevels and openings, floors with holes, rolled beams, roof planes, ducts and pipes, rooms, terrain and planting - by recognising what each mesh is and proving it by volume. Use this whenever an IFC "won't load", loads as nothing but generic meshes, or loads without walls, slabs or rooms; whenever a user brings architecture, structural, MEP/HVAC or landscape IFC files; whenever an uploaded .ifc might not be IFC at all (a GitHub page); and when adding a new IFC element mapping or recogniser.
---

# Reading IFC meshes back into a model

Most IFC files people actually have don't describe a wall as "an extrusion of
this profile". SketchUp, IFC4 reference-view exports and many coordination
exports write every element as triangles (IfcTriangulatedFaceSet) or breps
(IfcFacetedBrep). An importer that only maps extrusions brings them all in
as dumb generic meshes. That is technically "loaded", but it isn't a model.

Reference: `webbim/src/ifcrecover.js` (recognisers), `ifcimport.js` (mapping,
joins, categories, colours), `ifcread.js` (`ifcTextOf`).

## First: is it an IFC at all?

Check the first bytes. A real file starts with `ISO-10303-21`. A file saved
from GitHub's "view file" page is HTML. When GitHub could show the file, its
lines are embedded as `"rawLines":[...]`, and you can read the IFC straight out
of that. When the file is too large, the page carries no lines, and the
honest answer is an error naming the `rawBlobUrl` to download. Never report an
HTML page as "an IFC with nothing in it".

## Recognise, prove by volume, or keep exactly

Each recogniser reads a candidate element off the world-space mesh, then
checks it: the element it would build must hold the mesh's volume within
2–3% (divergence theorem over the triangles). If the check fails, return
null and keep the exact shape. A wrong wall is worse than an honest mesh.

| Mesh | Test | Element |
|---|---|---|
| Wall | every vertex on two parallel upright planes | Wall: centreline, thickness, top profile, bevel across, openings |
| Flat plate | every vertex at the top or bottom z; top face loops | Floor, with holes as a sketch (footings too) |
| Tilted plate | every vertex on two parallel sloping planes | Roof plane: mid-plane footprint, pitch, direction, thickness, rafter cut |
| Bar | principal axis; section's own oriented box | Beam (with cross-section rotation) or Column |
| Tube | circles about one axis, one or two radii | Duct or Pipe: path, diameter, wall |
| Prism (IfcSpace) | as a flat plate | Room: name from LongName, number from Name, outline kept |

### Traps that cost hours

- **T-junctions.** Exporters split one triangle's edge with another's vertex,
  so "edge used by one triangle = boundary" breaks. Split every edge at
  vertices lying on it before counting.
- **Walls: read envelopes, don't trace outlines.** Sample the face's top and
  bottom either side of every vertex's u. The top gives the profile (a gable,
  steps). A raised bottom gives door notches. Missing samples mean
  full-height gaps. Rectangular inner loops are windows.
- **Bevels.** A wall cut under a roof has faces of different heights, but the
  difference is constant. Store it as a slope across the thickness. Take the
  median difference, because a beam pocket in one face would skew the mean.
  Fill single-face pockets from the other face; the volume check bounds the
  error.
- **Rolled sections.** A 100 × 200 rafter turned 45° measures 212 × 212 in
  world axes. Take the section's own minimum box end-on, and keep the turn
  as a cross-section rotation.
- **Tubes.** Cap-centre vertices sit on the axis: ignore them. A 1 mm wall is
  hollow; don't use the general tolerance to decide that.
- **Roof edges.** They are cut plumb or square to the slope. Tell which from
  the eave and ridge faces only (rake edges are upright either way). A
  square cut shifts the top face downhill and the underside uphill by
  t/2 · sin(pitch).

## After recognition

- **Join recovered walls.** Butt-jointed meshes overlap at corners. Move
  each end that lies inside another wall onto the crossing of the
  centrelines (both ends at a corner, one at a T). Shift the top profile
  and openings by however far the start moved, then record the joins. Do
  this across files, so a structural wall joins an architectural one.
- **Products only.** An owner history has a placement-shaped argument too.
  Require a GlobalId string.
- **Zones aren't built.** IfcSpatialZone, IfcZone, and 2x3 proxies whose
  ObjectType is "gross volume": leave them out and say so.
- **Site models have no storey.** Make a "Site" level at 0 with a plan.
- **Categories.** Use the IFC class first; for a generic IFC2x3 "flow" element,
  the type object's class (an IfcFlowTerminal typed IfcAirTerminalType is an
  air terminal); for proxies, ObjectType and name (terrain, vegetation, flue,
  shoe). Slabs aggregated in an IfcRoof are roof, but other members of the
  roof are not.
- **Colours per item.** A tree is a brown trunk and green foliage. Keep
  colour groups on the mesh and draw one 3D mesh per group.
- **Site drawing.** In plan, draw topography as contours (only the uppermost
  of overlapping strata) and planting as a canopy. Don't show either as a
  cut.

## Test it as a round trip

Build each element parametrically, mesh it the way an exporter would (a
welded, closed body), read it back, and compare the numbers. Then wrap those
meshes into a small IFC (triangulated face sets, styled items, a roof
aggregate, a system group) and import it end to end. Include a fake GitHub
page, both the kind that carries the lines and the kind that doesn't. Finally,
import the user's real files in the browser, as separate disciplines and
combined into one model, and look at plan, 3D, elevation and section.
