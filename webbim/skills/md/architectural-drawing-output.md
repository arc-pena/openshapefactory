---
name: architectural-drawing-output
description: How to produce architectural drawings from a BIM model that designers will actually present - plans, elevations and sections as vector scenes, sheets with viewports and a clean title block, per-viewport display styles (hidden line, shaded, rendered), and true hard sun shadows in plans, 3D views and axonometrics (Neil Denari-style), exported to PDF and SVG. Use this whenever you touch sheets, title blocks, viewports, display or render styles, shadows or sun settings, raster snapshots of 3D views, PDF/SVG export, transparency, or line weights; or when a user says a drawing "doesn't look like a real drawing" or shadows/shading are missing from a sheet.
---

# Architectural drawing output

A drawing is a list of primitives (lines, polygons, text, images, groups),
derived from the document on demand, with no state of its own. The screen,
PDF, SVG and DXF all walk the same list. Presentation settings (display style,
sun, crop) are arguments on the view or viewport, so they save, undo and show
up in the properties panel like everything else.

Reference: `webbim/src/scene.js` (plan, elevation, section, sheet scenes),
`hlr.js` (hidden-line), `sun.js`, `view3d.js`, `pdf.js`, `render.js`.

## Sheets and viewports

- A viewport is a placed view with its own scale, crop and **display style**.
  Keep the styles as one table. `SHEET_DISPLAYS` has hidden line (with
  optional dashed hidden edges), shaded, shaded with edges, consistent
  colours, rendered with sun (with or without edges), and white model with
  hard shadows. Each entry declares `lines`, `raster` and `sun`, and
  `sheetDisplayOf(render)` reads it, mapping older files' settings onto an
  entry. The "add view to sheet" flow asks for the
  style, and the viewport panel has a Display dropdown.
- Rasterised styles are cached snapshots. Key the cache on the *look*
  (`rasterLook(d)`: raster mode plus sun), not on the display name, or two
  names for the same look re-render forever and a changed sun never
  invalidates.
- **Snapshot with the main renderer into a `WebGLRenderTarget`.** A second
  WebGL context has no shadow maps, loses resources, and browsers cap the
  number of contexts.
- Title block: designers asked for *simple*. A 5 mm margin, a thin border, and
  a single bottom band with project, drawing title, number, scale, date and
  revision. Avoid a heavy right-hand column eating 20% of the sheet.

## Schedules

A schedule is settings on an element: category, fields, filters, sorting and
grouping, formatting, appearance and calculated values. One function
(`scheduleTable`) turns those settings into rows: items, group headers and
footers, blank lines and grand totals. The schedule view, the drawing on a
sheet and the CSV export all read it, so a filter or total can't differ
between screen and print.

Revit behaviours architects rely on:
- **Filters.** Revit's operators, AND or OR, and a filter field doesn't have
  to be shown. Numbers compare as numbers: lengths as typed ("3 m"), areas and
  volumes in the units displayed.
- **Sorting and grouping.** Up to four levels, each with header, footer
  (title, count, totals) and blank-line options, plus grand totals.
- **Itemize every instance off.** Rows with the same sort values merge. They
  show the count, the totals of totalled columns, and a value only where every
  element agrees. Editing a merged row edits every element in it.
- **Formatting.** Heading, group header, alignment, hidden field, totals
  (sum, min, max, min–max) and conditional shading.
- **Other schedule types.** Multi-category, material takeoff (one row per
  element and layer), sheet list and view list.

Store settings as named fields, never column indices, so a reordered field
list can't re-target a filter.

## Hard sun shadows

Designers want shadows as hard, flat, graphic shapes, not soft render
shadows.

**Plans (vector):** project every body's top and bottom rings and its side
quads onto the ground plane along the sun direction, and union-fill them as
one semi-transparent polygon set (`planShadows`). Clip bodies at the ground
(nothing below it casts) and at the cut plane (nothing above the cut casts, so
the roof doesn't blacken the plan). The result is vector: it scales, prints
and exports to PDF exactly.

**3D and axonometric (three.js r128):**
- r128 pairs the n-th shadow map with the n-th directional light. **Add the
  sun light first**, before any key or fill lights, or the shadow map is
  sampled for the wrong light and nothing shows.
- Toggling `receiveShadow` or `castShadow` needs `material.needsUpdate = true`
  to recompile the shader.
- Watch for name clashes on the view class: a field called `this.key` (the key
  light) overwrote a `key()` method and silently broke shadows. Name lights
  explicitly (`keyLight`, `sunLight`).
- When testing, put the probe point where the shadow must fall. Under the roof
  everything is in shadow, and with the sun behind the camera the shadow is
  hidden behind the objects casting it.

Sun settings are data on the view: `{on, azimuth, altitude, colour, opacity,
cast}` with defaults in `SUN_DEFAULT`. The same values drive the plan vector
shadows and the 3D light, so they cannot disagree.

## PDF and SVG

- Transparency in PDF needs an ExtGState per opacity (`/GA32 << /ca 0.32 >>`
  for fills; add `/CA` if strokes are ever translucent).
  Without it, 30% shadows print solid black.
- Use the nonzero fill rule for unions of overlapping shadow rings.
  Even-odd punches holes where two shadows overlap.
- Line weights are in paper millimetres and scale-independent. Cut lines are
  heavier than projection lines, and projection lines heavier than hidden or
  beyond lines. Drive the weights from the view style's category table, not
  from per-element constants.

## Elevations and sections

- Everything a hit-test needs comes out of the same scene: each primitive
  carries its element id and its depth from the view plane. Editing in these
  views depends on that (see `bim-view-editing`).
- Levels are drawn as datums with heads that can be edited (height and name)
  in place. Grids and section markers are datums too.
- Leaning walls: the section cut uses the wall's faces at the cut position.
  The elevation shows the true outline of the lofted solid, not the plan
  outline extruded straight up.

## Dimensions and tags

- A dimension's look belongs to its type, AutoCAD's DIMSTYLE, not to the instance.
  That covers extension-line offset and extension, dimension-line extension past
  the ticks, terminators (tick, oblique, arrows, dots, boxes, datum, none) and
  their size, text font/height/colour/width factor/fill/frame and placement
  (above, centred with a break, below; aligned, horizontal or ISO), and the fit
  rules. It also covers units, precision, rounding, zero suppression,
  alternate units and tolerances. Every size is paper mm. Changing the type
  restyles every dimension of that type.
- Instances keep only Revit's overrides: a value with `<>` standing for the
  measurement, a prefix, a suffix, and text above and below the value.
- **Bind to the plane that drives the line, never to the line.** In a section
  or elevation, every drawn line is a plane:
  - horizontal: a level, a slab's top, its underside, or a layer interface; a
    wall's base or top; a beam's top or soffit; a sill or a head;
  - upright, seen edge-on: a wall face, a column face or its centre axis, a
    grid, a jamb.

  Two horizontal planes give a height. Two upright planes square to the view
  give a width. A slab made thicker moves its dimension with it.
- Where lines coincide (a wall's base on a slab's top), offer what the section
  cuts, or what stands nearest, first. Put datums after elements. Tab reaches
  the rest.
- Columns, and generic bodies imported as columns, carry a centre axis, so
  centre-to-centre works in any projection.
- Material tags read what lies beneath them: at the leader's point, or under
  the tag itself with the leader off. Re-read on every move and show `?` over
  nothing. They can show the element's Mark or its type's Mark instead of the
  material's. The frame is an oblong by default.

## Rebuilding a drawing set as a model

- Read the PDF's vectors, not its picture. Grid bubbles, wall fills and the
  outlines of cut walls give positions to the millimetre at the set's scale
  (1:100 → one paper mm = 100 mm). Check the bays against the set's own
  dimension strings.
- Every page of the set becomes a sheet with the same number, name, size and
  scale. Its title block is copied from the set: fonts, sizes (converted to
  cap height), positions and the fields it reads from Project Information.
- Elevations and sections read as the eye sees them. Looking north, west is on
  the left. Test that the handedness is right (grid 1 left of grid 5 on a view
  looking east).
- Take the set's 2D entourage (people, cars, trees) as model-space symbols at
  true size, filtered by stroke colour so the render stipple behind them stays
  out. Place them in elevations and sections by view coordinates.
- Existing and new work are phases. A view style's rules hide the other phase,
  and every kind of element must obey the rule, not only walls.

## Check it looks right, then measure it

Render the sheet in a real browser and look at the screenshot. Then assert
numbers the eye can't check: that a shadow polygon's offset equals
`height / tan(altitude)` along the sun azimuth, that the PDF contains the
ExtGState, and that a viewport's raster was regenerated after a sun change.
