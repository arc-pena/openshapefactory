# Web BIM

An application built from the *Web BIM — MVP Spec v0.2*: a browser BIM authoring tool on an OCAF-style parametric document. The drawing comes from each element's construction recipe, not from sectioning its solid. Relationships (joins, constraints) are held by the system, not by the elements.

Live artifact: https://claude.ai/artifact/EuWpSVPSYJtKFJB8GHDqfP

## Delivery contract

```
node build.mjs            # writes BOTH targets, and refuses on any of the checks below
node --test test/*.test.mjs   # 128 tests: the §15 acceptance suite, spaces, DXF, PDF raster measurement
```

1. **The Artifact**: republish `dist/web-bim.html` to the URL above so the link stays the same. Declare `capabilities: {downloads: true}`: file saves (PDF, zipped DXF, JSON) go through it. Publishing without the URL creates a second artifact.
2. **Served**: `index.html` loads `src/*.js` as native ES modules. Open it over http, for example with `npx serve webbim`.

Never publish one target without rebuilding the other.

The build refuses:
- a top-level name declared in two modules (in the single file the second would silently win)
- an import alias
- an import of a later module
- a call to another module's function without importing it (the served build would throw)
- a source file that is not listed in `MODULES`, or a listed module that is missing

`MODULES` in `build.mjs` is in dependency order, and that order is the concatenation order.

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
  - Middle-drag pans (Space+drag too). Shift+middle-drag orbits in 3D. The wheel zooms about the cursor. Right-click opens the context menu.
- **Everything moves:**
  - Walls: move, drag ends (joined neighbours follow), and drag height, in plan and 3D.
  - Doors and windows slide along their host.
  - Levels drag up and down in elevations.
  - A wall-top grip on a wall whose height is `Top.elevation - Base.elevation` moves the level, so every wall bound to it follows.
  - The sample's dimensions start unlocked; the padlock locks them.
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
