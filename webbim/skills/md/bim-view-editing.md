---
name: bim-view-editing
description: How editing should work in every view of a BIM or drafting application - plan, elevation, section, 3D and sheet - so users can select, drag, move, copy, paste, delete and place elements wherever they are looking, with Revit-grade conventions (Esc always exits, Delete works from any focus, Tab cycles what is under the cursor, clipboard paste starts a placement). Use this whenever you add a tool or command, make something draggable, add a view type, touch hit-testing or selection, or when a user reports "I can't move/copy/place X in the elevation/section/3D view", "Esc doesn't exit", or "Delete doesn't work".
---

# Editing in every view

Users do not think in terms of "the plan is the editor and the other views are
pictures". If they can see a slab in a section, they expect to select it, copy
it up a storey and paste it. If they can see a wall in an elevation, they
expect to click a window into it. Each view is another way to reach the same
document edits.

Reference: `webbim/src/canvas2d.js` (2D views), `view3d.js` (3D), `app.js`
(tools, keys, clipboard), `ops.js` (the op vocabulary).

## Map the gesture to a model op; never edit the picture

An elevation shows (along-the-view, z). A drag there is an ordinary model edit
that the view translates:

| Dragged in elevation/section | Becomes |
|---|---|
| Level line | elevation change (`lift` moves the level; its hosted elements follow) |
| Slab, beam, column, wall, generic (vertical part) | `lift` by dz, re-hosted onto the level it lands on |
| Horizontal part of that drag | a plan move along the view's right vector |
| Door / window / opening | `profile.at += dot(viewRight·Δ, hostDir)`, `sill += dz` |
| Grid / section marker | a slide perpendicular to itself |

**One gesture = one op.** The apply step merges each op's result with
`Object.assign`. So if a Move is split into a transform op followed by a lift
op, the second result overwrites the first's `copied`/`ids`, and the selection
after a copy lands on the wrong things. Build a single op that does the whole
gesture and returns `{copied, moved, ids}`.

For drags, coalesce edits under one key (`set:<id>:profile`) so a drag is one
undo step.

## Placing hosted elements in any view

Placing a door or window in an elevation: take the wall under the cursor,
intersect the view's look ray through the click with the wall's line, then
work out the distance along the wall and the sill from the click's z.

```js
X = intersectLines({ p: clickOnViewPlane, d: view.look }, lineThrough(wall.start, wall.end))
u = uOf(wall, X);  sill = z - wall.z0 - height / 2      // windows: centred on the click
app.placeOpening(tool, wallId, u, sill)                   // the SAME call the plan tool makes
```

One placement function serves plan, elevation, section and 3D. A tool is
allowed in a view only if the view can supply its inputs. Keep that as one
table (`canUseTool`), not as checks scattered across handlers. Elevation and
section: select, dim, tag, move, copy, door, window, opening. 3D: select,
wall, door, window, opening, column. Plan: everything.

## Hit-testing: nearest to the viewer, datums last

`hitsAt(x, y)` returns *everything* under the cursor, sorted:
1. elements before datums (levels, grids and section lines must never steal
   a click from a wall they run through),
2. then by depth (nearer to the viewer first),
3. then smallest area or nearest line.

Consequence: in a south elevation, a 1.5 m garden wall in front of the house
covers the bottom of the door behind it. That is correct, and Tab cycles
through the rest. When a browser test "can't hit the door", **probe the hit
list at that point before changing the code**. Twice in this project, the
fault was the test clicking a point where the element wasn't frontmost.

## Keys that must always work

- **Esc exits any command**, clears any half-finished state (base point, rubber
  band, sketch step) and returns to select. The user should never need to
  click Modify then the arrow cursor to get out of a tool. When Esc cleared
  something, the view handler returns false so the app doesn't also run
  another Esc action. `setTool` clears tool state on *every* view, not just
  the active one.
- **Delete works whatever has focus.** A focused dropdown, checkbox or button
  in the properties panel must not swallow Delete. Only a text field that is
  being edited keeps it.
- **Tab** cycles the hit list under the cursor and highlights the candidate. In
  a dimension tool, Tab cycles the element's *references* (centreline, face,
  core face, end) with an orange/blue highlight and a small HUD naming the
  reference.
- **Ctrl+C / Ctrl+V**: copy the selection to `app.clipboard`. Paste starts the
  Copy tool with its base at the selection's centre, so the next click places
  it. This works in every view that allows Copy, which is how "copy this slab
  and level up a floor" works in a section.
- Two-letter shortcuts (MV, CO, RO, MM, DE, TR, WN, DR) are typed into the
  view, not into a field.

## Things users will ask for (plan for them up front)

- Detail items (lines, regions, repeating details, tags) move with Move and
  drag like model elements. Their geometry lives in paths and sketches, so the
  transform must handle point arrays, arcs and sketch loops.
- Walls keep their planes when moved. See `bim-element-model`.
- Copying a level in elevation creates the level *and* a plan view for it.
  A level with no plan is useless.
- Everything draggable in 3D is draggable in 2D, and the reverse.

## Verify in the real app

Drive the built file in a browser. Select through the UI, type the shortcut,
click the model points (converted with `view.toScreen`), then assert on
document values: counts, `profile.at`, elevations. Check both the direction
and the size: a 60 px drag at 22.47 mm/px must move exactly 1348 mm, the right
way. See `webbim-dev-loop` for the harness.
