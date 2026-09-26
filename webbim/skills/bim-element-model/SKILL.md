---
name: bim-element-model
description: How to model building elements in a browser BIM on top of an OCAF-style parametric document - walls, floors, beams, columns, doors, windows and openings as declared features; hosting on levels and walls; wall joins and mitres, including leaning walls that must meet in 3D; named references that dimensions, snaps and padlocks all bind to; and moves that keep wall planes. Use this whenever you add or change a BIM element type or its arguments, touch wall joins, T-junctions, mitres or inclined walls, add hosting (base/top level, offsets, a door in a wall), make something dimensionable or snappable, or change what moving or dragging a wall does to its neighbours. Also use when plan and 3D disagree about the same element.
---

# BIM elements on a parametric document

A BIM element is not a mesh with properties. It is a feature on the document:
a type name, declared arguments, and a builder that turns those arguments into
the plan geometry, the 3D solid and the named references. Every view, schedule
and export reads that single result.
(The document spine itself is covered by `ocaf-document-model`, and
`append-only-model` covers saved-format rules. This skill is the building layer
on top of them.)

Reference implementation: `webbim/src/bim.js` (catalogue, builders,
`elementRefs`), `joins.js` (walls meeting), `ops.js` (edits, `followJoins`,
`lift`), `solids.js` / `hlr.js` (3D and hidden-line).

## Hosting is what makes it BIM

Most elements hang off something else. Declare that relationship as arguments,
not as a position that happens to line up:

| Element | Host arguments |
|---|---|
| Wall | `baseLevel` + `baseOffset`, `topLevel` + `topOffset` (unconnected height only when no top level) |
| Floor | `level` + `heightOffset` |
| Beam | `level` + `topOffset` |
| Column | `baseLevel` + `baseOffset` |
| Generic | `level` + `baseOffset` |
| Door / Window / Opening | `fills` → an Opening whose `profile` holds `at` (distance along the host wall) and `sill` |

Why this matters: when a level moves, everything on it moves, with no code
path of its own. When an element is moved vertically (in an elevation, or with
Move), **re-host it**. If it lands on a level, take that level with a zero
offset. Otherwise keep the nearest level below plus an offset. Never bake the
absolute z into it, because the next level edit would silently strand it.

A filler (door, window) moves **along its host**:
`at += dot(move, hostDirection)`, `sill += dz`. It never moves in free x/y.
A copied filler needs its own new Opening. Copying a door that points at the
original's opening puts two doors in one hole.

## References: one list drives dimensions, snaps, locks and Tab

Users expect to dimension or snap to *anything that drives an element*: a
wall's centreline, its faces, its core faces and its ends; a beam's axis and
sides; a column's centre, axes and faces; a slab's edges and corners; a door's
jambs and centre. Build that list once per element type:

```js
elementRefs(doc, f) → [{ key: "core.exterior", kind: "line", geom, a, b }, { key: "end.start", kind: "point", geom }]
resolveReference(doc, "W1:core.exterior")   // what a dimension stores: id + stable key
```

- Keys are **names, not indices**, so a dimension survives every rebuild.
  Store `"W1:face.left"`, never "edge 3".
- Snapping, dimension picking, padlocks and Tab cycling all read this same
  list. A fifth copy for a new tool is how "I can dimension it but not snap to
  it" bugs happen.
- Give every type a fallback: an element with `data.refs` gets those. When a
  reference cannot be re-derived after an edit, translate the old one rather
  than dropping it. A dimension that silently disappears is worse than one
  that is slightly stale.

## Joins: walls meet where their lines cross

Wall ends within `JOIN_TOL` share a node. Joins are resolved per node:
L-joins mitre, T-joins stop the stem at the through-wall's face, and priority
decides which layers run through. Tests should cover every combination of
L, T and X with thick walls, thin walls and core layers.

### Leaning (inclined) walls must meet in 3D

A leaning wall is a plane at an angle, and two such planes meet along a line
in space, not at a point in plan. Things that broke and how they were fixed:

- **Solve the join at each height.** `wallAt(w, z)` returns a proxy of the
  wall's faces at height z, with every join re-solved there. The 3D solid is
  lofted from the footprint at the base to the footprint at the top
  (`foot` + `topFoot` → `loftMesh` in 3D, `prism(top)` in hidden-line). Plan
  cuts use `wallAt(w, cutHeight)`.
- **Match joins on the drawn ends.** At height z the ends have moved apart, so
  find partners by the ends as drawn, then place the node at `axesMeet`: the
  least-squares point nearest every wall axis at that height. A wall leaning
  about its centre moves its ends at both top and base. Matching on the moved
  ends drops the join entirely.
- `leanInvolved(w)` is true when this wall *or any wall it joins* leans. A
  plumb wall joined to a leaning one still needs per-height geometry.

### Moving a wall keeps its plane

What users expect (Revit-like), and what the code does:

- **Whole wall moved** (body drag, Move, Rotate): the wall keeps its angle.
  At each join, both walls stop where their *lines* cross, so neighbours only
  stretch or shrink along their own lines.
- **An end dragged**: only then does the outline bend. The neighbour's end
  follows the dragged point.
- Parallel lines have no crossing, and a crossing that would flip a wall's
  direction is refused. Both cases fall back to following the point.
- Only walls that actually touched *before* the edit are pulled along.

Do not implement "move connected walls with it". Users almost never want the
building to rubber-band.

A **Trim/Extend to Corner** tool (pick one wall, then the other; both ends go
to the crossing) is the user's answer to "these walls don't touch". Give it
early.

## Doors and windows in inclined walls

Offer a toggle:
- **Follow wall geometry**: the frame leans with the wall.
- **Plumb**: the unit stays vertical, and a shroud frame projects
  perpendicular to the unit until the wall trims it. The unit is anchored by
  its header or its sill on the wall face, or by an offset from the wall.

## Catalogue-as-data checklist for a new element type

1. Declare its arguments (append new ones at the end; OCAF overflow tags
   exist for types with more than 9 arguments).
2. Write the builder: plan outline, 3D parts (a part may be a loft), `refs`.
3. Add the `elementRefs` branch, or rely on `data.refs`.
4. Add `geomKeyOf(type)` so Move/Rotate/Mirror know which argument is its
   geometry. Add `transformExtras` if it carries paths or sketches.
5. Add hosting to the `lift` table if it sits on a level.
6. Write an acceptance test whose expected numbers are worked out by hand
   (see `measured-truth`).
