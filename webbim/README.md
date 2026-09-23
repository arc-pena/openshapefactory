# Web BIM

An application built from the *Web BIM — MVP Spec v0.2*: a browser BIM authoring tool on an OCAF-style parametric document. The drawing comes from each element's construction recipe, not from sectioning its solid. Relationships (joins, constraints) are held by the system, not by the elements.

Live artifact: https://claude.ai/artifact/EuWpSVPSYJtKFJB8GHDqfP

## Delivery contract

```
node build.mjs            # writes BOTH targets, and refuses on any of the checks below
node --test test/*.test.mjs   # 142 tests: the §15 acceptance suite, spaces, DXF, PDF raster measurement
```

1. **The Artifact**: republish `dist/web-bim-studio.html` (both interfaces) to the URL above so the link stays the same. Declare `capabilities: {downloads: true}`: file saves (PDF, zipped DXF, JSON) go through it. Publishing without the URL creates a second artifact.
2. **Served**: `index.html` loads `src/*.js` as native ES modules. Open it over http, for example with `npx serve webbim`.

Never publish one target without rebuilding the other.

The build refuses:
- a top-level name declared in two modules (in the single file the second would silently win)
- an import alias
- an import of a later module
- a call to another module's function without importing it (the served build would throw)
- a source file that is not listed in `MODULES`, or a listed module that is missing

`MODULES` in `build.mjs` is in dependency order, and that order is the concatenation order.

## Two interfaces, one building

The **Parametric CAD** button (top right, or `PC`) swaps the whole interface for the OpenCascade/OCAF parametric modeller, with an animated flip. Its **Revit style** button swaps back. It is not a second model. The BIM document stays the truth:

- **Into CAD:** `src/cadbridge.js` writes the building into the modeller as its own nodes. Each element becomes a folder named after it, holding:
  - its numeric parameters as Number nodes, and wall ends and column positions as Point nodes;
  - its body, from `src/solids.js`, as sketches extruded into solids and then joined.
- **Edits in CAD:** changing a building's parameter node in the modeller becomes an ordinary BIM op (set, drag, autojoin). The modeller is then shown what the building made of it, as the smallest set of `set`/`sketch` edits.
- **Your own CAD work:** anything you add in the modeller that is not the building's (ids not starting `B_`) is kept.
- **IFC:** the modeller's IFC package loads automatically.
- **IFC import (Insert ▸ Import IFC):** walls, slabs, roofs and footings, columns and members, beams, doors and windows, and proxies come in as Walls, Floors, Columns, Beams, Doors/Windows and Generic models. Bodies are read through mapped items (a Revit file's shared beams), boolean clips (taken whole, and reported), breps and face sets (read off their points). `IfcRelConnectsPathElements` becomes wall joins. Each storey gets its floor plan. Anything approximated is named in the import report.
- **Units (Manage ▸ Project Units, UN):** the model is millimetres, always. The project chooses how lengths are *shown*: mm, cm, m, feet and fractional inches, or inches. That covers Properties, temporary dimensions, schedules, tags and drawing dimensions (Revit style: `7000`, `7.000`, `22' - 11 9/16"`). Any length field takes any unit and any maths: `10m`, `3'-6"`, `3' 6 1/2"`, `2*1.2m + 300mm`, `W1.Height + 0.5`. A bare number is read in the display unit. A formula remembers the unit its bare numbers were typed in, so switching the display never changes a size.
- **Elements measure themselves, live:** walls (length, height, width, area, volume), floors (area, perimeter, thickness, volume, holes), beams (length, depth, volume), columns, openings, spaces and generic models. They show read-only in Properties ▸ Dimensions, in the project's units, and update mid-drag.
- **Show in 3D / Selection Box (BX) / Section Box:** right-click a selection in any view, or use Modify ▸ View. *Show in 3D* opens {3D} centred and framed on it. *Selection Box* also clips {3D} to a box around it. The section box is data on the 3D view (`sectionBox`), axis-aligned always. Its six blue arrows push or pull one face each along its own axis. View ▸ Section Box toggles it and keeps its size. Picking ignores what it cuts away, and the view's hidden-line drawing for sheets is clipped to it (and re-generated when it changes). The cut is not capped yet.
- **Walls draw like the sketcher (WA):** the Wall tool opens *Modify | Place Wall*, with Line, Rectangle, Polygon, Arc, Circle, Ellipse, Spline (control points), Spline (through points) and Pick Lines (a grid, a detail line, a room separator, a floor edge or a wall face). There is no Finish: each shape becomes walls when its last click lands, and the ends are joined. The options bar adds Offset (left of the drawing direction; negative is right), Radius (rounds a chain's corners into arc walls) and Sides.
- **Double-click steps in:** a view marker (section, elevation) or viewport opens its view; a floor or filled region opens its sketch; text, a grid, a level or a room gets its name or text to edit; a dimension opens its value; a door, window, wall, column or beam opens Edit Type. This works in 2D and 3D. *Filled Region* (Annotate, FR) goes straight into sketch mode: loops, holes and pattern.
- **Grids stay orthogonal:** each grid has an *Orthogonal* tick (on by default). While it's ticked, the grid's ends slide along it and the grid stays horizontal or vertical. Ticking it straightens a skewed grid. Untick it to drag the ends anywhere. New grids follow the tool's own Orthogonal option.
- **Import CAD (Insert ▸ Import CAD, IC):** a DXF comes into the active view as one element, origin to origin. Its drawing is a sketch in the parametric CAD's own format, and each element keeps its DXF layer. The layers table (on/off, colour) is in Properties. *X offset*, *Y offset*, *Scale* and *Rotation* (about the file's origin) place it. It is **pinned** by default (Revit's pushpin beside the selection; click it, or PN / UP): pinned elements refuse drags, Move, Rotate and Mirror, but Properties can still place them. *Explode* turns it into detail lines, each keeping its layer and colour; texts become notes, fills become regions, and layers that are switched off are left out. Grids and symbols can be pinned too.
- **No facets:** floors, filled regions and imported drawings draw from their curves, not from sampled polygons. Arcs stay arcs. Through-point splines, B-splines (by knot insertion) and ellipses become exact cubic Béziers, which screen and PDF draw natively. 3D tessellates finely, shades curved sides smooth, and draws upright edges only at real corners; hidden-line drawings do the same.
- **Split Element (SL):** Modify ▸ Split, beside Move/Rotate. Click anywhere on a wall, beam, detail line or room separator and it becomes two there. A wall's halves are joined. The far-end join, T-joins along the second half, and doors and windows past the cut move to the new wall, measured from its start. In sketches (Modify ▸ Split), lines and arcs split directly; B-splines split exactly by knot insertion; through-point splines become the exact B-spline they are first, so the curve never changes.
- **Fillet reaches splines:** in the sketcher, Fillet works between a line or arc and any spline (control-point or through-point). Radius 0 cuts both to where they cross; a radius solves an arc tangent to the true curves. The spline is trimmed as Rhino does: a new control-point spline that *is* the original curve (checked at the same parameter to 10⁻⁵ mm), not a trimmed reference to the old one.
- **Floors are sketches (SB, or Architecture/Structure ▸ Floor):** Revit's sketch mode. The model greys back, the sketch draws heavy dark red, and the ribbon becomes *Modify | Create Floor Boundary*. It has Finish ✓ / Cancel ✕, Draw (Line, Rectangle, Polygon, Arc, Circle, Ellipse, Spline by control points, Spline through points, Pick Walls), Modify (Select, Move, Copy, Rotate, Mirror, Scale, Scale 1D, Offset, Fillet) and Dimension. The options bar holds the offset distance (with Copy), the fillet radius (0 = trim/extend to a sharp corner, as AutoCAD's FILLET), and the polygon's sides.
  - The drawing is the parametric CAD's own sketch (`cad/src/sketch.js`, wrapped by the build as `src/cadsketch.js`). Its constraints are hidden and automatic: ends that land on each other are welded, and moving or dragging an element stretches its welded neighbours, so loops stay closed. Open ends are ringed.
  - Loops inside loops are holes. Dimensions (length, distance between parallel lines, angle, radius) show as temporary dimensions; type a value to drive it, padlock to hold it.
  - Double-click a floor, or *Edit Boundary*, to go back in. Edit Crop uses the same sketcher.
  - In the Parametric CAD interface the same floor is a Sketch node per layer with the same elements, coincidences and fillet tangencies, and an edit there comes back to the floor.
- **Floor plans:** one per level. View ▸ Floor Plan (also on Architecture ▸ Datum) lists only the levels that have no plan yet, so you can pick one or more.

`cad/` is a copy of the modeller from `arc-pena/OCAF_V1`, branch `claude/opencascade-ocaf-parametric-cad-fp589v`. That repository was only read. The copy adds three things, marked "Web BIM" in `cad/src/app.js`:

- a bridge object (`__webbimCad`) and a change hook;
- IFC loaded at start;
- the Revit-style button and no tour when embedded.

```
python3 cad/build.py --only artifact   # cad/parametric-cad.html (fetches the 22 MB OCCT kernel from npm, cached in cad/.kernel)
node build.mjs                         # dist/web-bim.html, index.html, and dist/web-bim-studio.html (≈14 MB, both interfaces)
```

The Artifact publishes `dist/web-bim-studio.html`. The CAD page rides in it as inert text and becomes the switch's iframe the first time it is used. The served `index.html` loads `cad/parametric-cad.html` instead. Built pages and the kernel cache are git-ignored.

## Architecture (spec section → module)

| Spec | Module |
|---|---|
| §1 labels, tags, catalogue, drivers, logbook, contained failure, JSON | `ocaf.js` |
| §1.8 op pipeline, coalesced undo · §10.5 propagation (no solver) | `ops.js` |
| §4.1 typed, unit-aware expressions, no `eval` | `expr.js` |
| §10.6 closed-form primitives, Curve2D, paths | `geom2d.js` |
| §3.1–3.3 surface set, Cramer corners, offsets, fast path | `walls.js` |
| §3.4 joins: mitre with miter limit, priority T-trim, n-wall nodes | `joins.js` |
| §3.6 planar face-finding, anchor identity | `spaces.js` |
| §4–§11 the catalogue: every element type is a declaration plus a driver | `bim.js` |
| §7 pens, 7-level resolution, predicates | `styles.js` |
| §6 derive: plan, elevation (2D occlusion), sheets, in paper mm | `scene.js` |
| §6.4 vector hidden-line removal for 3D on sheets | `hlr.js` |
| §12 PDF: mm CTM, tiling hatches, embedded subset font, OCGs, links, bookmarks | `pdf.js` |
| §12.4 / §8.2 DXF R2000 write/read, `$INSUNITS`, 370 ladder | `dxf.js` |
| §4.5 property model, pick-binding, node graph model, listening dimensions | `props.js` |
| §15 acceptance suite (shared by node and the in-app Diagnostics view) | `acceptance.js` |
| UI: canvas + DOM overlay, panel, schedules, node editor, three.js view, ViewCube | `canvas2d.js` `panel.js` `graph.js` `viewcube.js` `view3d.js` `app.js` |

`tools/make_font.py` regenerates `src/fontdata.js`. This is DejaVu Sans, subset to cp1252. The PDF embeds those same bytes and the canvas draws with them, so screen text and paper text use the same metrics.

## Using it (Revit conventions)

- **Layout:** Quick Access Toolbar, then the ribbon (File at the far left; a green *Modify | <Category>* tab appears when something is selected), then the options bar for the active tool. Properties sit above the Project Browser on the left. Document tabs and the view control bar surround the view.
- **Project Browser:** a single click selects a view and shows its properties. A double-click opens it. Drag a view onto an open sheet and the viewport is centred where you drop it.
- **3D:** there is always a `{3D}` view (**3D** or the house in the QAT). The ViewCube (top right) turns the view by face, edge or corner, and turns about z from the compass. Drag the cube to orbit; the house button goes home.
- **Mouse:**
  - Left-drag is a normal drag. On empty space it window-selects left→right and crossing-selects right→left, in plan and 3D. On an element it moves the element.
  - Middle-drag pans (Space+drag too). Shift+middle-drag orbits in 3D (Shift+right-drag too), about the selection or the point under the cursor, which stays put on screen, as in Revit. The wheel zooms about the cursor. Right-click opens the context menu.
- **Everything moves:**
  - Walls: move, drag ends (joined neighbours follow), and drag height, in plan and 3D.
  - Joins follow the geometry. Drop an end inside another wall's thickness and it snaps onto that wall's location line as a T. Drop it near another wall's end and it forms a corner. Pull it away and the join is released. The same applies when drawing, moving, rotating or mirroring walls.
  - Doors and windows slide along their host.
  - Levels drag up and down in elevations.
  - A wall-top grip on a wall whose height is `Top.elevation - Base.elevation` moves the level, so every wall bound to it follows.
  - Dimensions: select one, then drag its grip (or the dimension itself) to slide the line. Click its value to type a new distance: the measured element moves and joined walls follow. The padlock locks or unlocks it. The sample's dimensions start unlocked.
- **Dialogs never block the view:**
  - Visibility/Graphics and Edit Type float beside the view; drag them by the title.
  - Every edit applies live, and Ctrl+Z undoes the whole session. Revert restores the values from when the dialog opened.
  - All dialogs fit the window, and their content scrolls.
- **Hidden-line drawings are automatic:** a 3D view on a sheet recomputes its line-work shortly after the model changes while the sheet is open. Export computes any out-of-date viewport before writing the PDF, so there is no manual step and no refusal.
- **T-junctions blend:**
  - In plan, each joining layer stops at the first through-wall layer that outranks it, and the through wall's finish opens where it passes.
  - Where the materials are the same, no line is drawn between them. At Coarse detail, the joint is a single line or none.
  - Crossings are two T's, and T's onto curved walls resolve.
  - In section, a floor meeting a wall resolves by the same priority rule: a slab bears over a wall's structure. The outline is drawn only where the material changes.
- **Sections:** `SE` draws a section line. It cuts walls, floors, beams (I-sections) and columns layer by layer, and draws what lies beyond as an elevation hidden behind the cut.
- **View extents:** selecting (or hovering) an elevation or section in plan shows what it sees: the view line swept to the far clip, as a dashed rectangle. Its grips move the line's ends and the whole line, set the far clip (`depth`), and slide the sides to set the width. In an elevation or section, clicks take what is nearest the viewer; Tab steps back through the rest.
- **Two-letter shortcuts:** WA DR WN OP CL GR RM RS DI TX EL MV CO RO MM DE LL VV TL ZF 3D SA PP MD. Ctrl+Z / Ctrl+Y undo and redo; Esc cancels, then clears the selection.

## Known gaps (said, not hidden)

- **No OCCT in the browser build.**
  - **3D view on a sheet:** hidden-line removal is exact for the planar, convex pieces this model produces, and arc walls are chorded. It is not `HLRBRep_Algo`.
  - **Test 14:** compares the offset-curve fast path against an independent surface-set cut, not against `BRepAlgoAPI_Section`.
- **Walls with attached sloping tops (test 48)** are not built. Raking and leaning walls are built, through the §3.1 surface path.
- **L joins between different wall types** resolve as a shared mitre line. The priority trim applies to T/butt joins, which is what tests 6 and 7 cover.
- **Joins on ellipse and spline walls** are drawn as free ends, and the app reports this as a note.
- **Paper-space DXF export** is flattened at 1:1. It does not write `VIEWPORT` entities.
- **Canvas redraw** culls primitives by bounding box but redraws the whole scene, not dirty rectangles.
