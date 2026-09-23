# The interface

A CAD front-end for the OCAF parametric model: a specification tree, a 3D view,
and a definition panel where a feature's OCAF arguments sit on sliders.

Published as an Artifact, and served by the native kernel at `/` when you run
`ocafcad serve --ui docs/parametric-cad.html`.

## It owns no geometry

A kernel holds the document — the label tree, the parameters, the B-Rep — and
this page mirrors that tree and draws the triangles it is handed. Editing a
parameter re-executes only the functions downstream of the edit; each rebuilt
feature's revision moves, and the page re-fetches the triangle stream for those
shapes and no others.

Two kernels answer exactly the same calls, and nothing above `kernel` in the
code learns which one it got:

| | |
|---|---|
| **the page kernel** | OpenCascade compiled to WebAssembly, running in the browser. Real B-Rep — a filleted box has twelve cylindrical faces and eight spherical corners — with the OCAF document model (labels, attributes, drivers, logbook, solver) in JavaScript. Needs nothing installed. |
| **a native kernel** | `ocafcad serve` or `python -m ocafpy serve` over HTTP. A real `TDocStd_Document`: OCAF attributes, `TFunction` drivers, `TNaming` results, `.cbf` persistence, STEP and OBJ export. |

The two catalogues have drifted: the written features and everything under
**Numbers are features too** below are page-kernel features, and `ocaf/`'s
`Schema.cxx` still carries only the original ten. A model using the rest is
browser-only until that catches up.

The Kernel chip in the toolbar switches between them and carries the part
across.

## A feature you write

`Script` is a feature whose body is code. The source lives on the feature as a
`TDataStd_AsciiString`; the script declares its own parameters, and each one
gets a label of its own carrying a `TDataStd_Real`, exactly as a catalogue
argument would. So a script's parameters are edited, regenerated, undone and
saved like any other feature's — the panel draws a slider per declaration and
the solver re-runs the feature when one moves.

```js
({
  params: [{ key: "size", label: "Size", def: 60, min: 10, max: 200, step: 1 }],
  build(p, k) { return k.fillet(k.box(p.size, p.size, p.size), p.size / 8); }
})
```

`k` is a small surface over the kernel.

| | |
|---|---|
| solids | `box`, `cylinder` (a pie slice when given an angle), `sphere`, `sector` |
| curves | `helix`, `ellipse`, `circle`, `rectangle`, `polyline`, `face` |
| sweeping | `sweep`, `loft`, `prism` |
| placing | `move`, `rotate` |
| combining | `cut`, `fuse`, `common`, `fillet`, `compound` |
| chained | `beam`, `tube` |

`move` and `rotate` go through `TopoDS_Shape::Moved`, so repeating a shape costs
a location rather than a rebuild.

`helix` builds its spine the way OpenCascade does: a straight line in the *(u,v)*
parameter space of a `Geom_CylindricalSurface`, which maps to a helix in space,
then `BRepLib::BuildCurve3d` to give the edge a 3D curve. `sweep` runs
`BRepOffsetAPI_MakePipeShell` with a **constant binormal** rather than a Frenet
frame — a handrail does not roll over as it turns — and `loft` is
`BRepOffsetAPI_ThruSections`, the operation behind the neck thread of the
OpenCascade bottle.

Anything with a constant section is swept, not chained: the stair's handrail is
one elliptical solid and its stringer one rectangular solid, each swept along
its own helix. That is 13,836 triangles for the whole stair against 54,104 when
the same two runs were built from segments.

Two buttons give you the same feature from two different starting points, so you
can reach for either without one replacing the other:

| | |
|---|---|
| **Script** | a spiral stair — centre pole, treads, risers, stringer and handrail |
| **Ribbon** | a lofted shell taken in bands, after Heydar Aliyev |
| **Center** | the Heydar Aliyev Center: roof and glazed facade |

A declared parameter that names its alternatives becomes a switch rather than a
slider, and the panel draws it as a segmented control:

```js
{ key: "direction", label: "Ribbon direction", options: ["U", "V"], def: 0 }
```

The value stored is still a number — the index — so storage, regeneration, the
model file and undo are untouched; only the panel knows the difference.

`Center` is the most literal. Its roof is one loft through section curves laid
the way the building draws them: up into a rolled lip that sits *lower than the
mid-point*, down the long slope into a valley that touches the ground, then a
rise through a 45-degree tangent to the peak and a steep drop behind it. Those
three marked points are parameters; the rest of the control polygon follows from
them. How the section changes across the width — settling, rippling into lobes,
the ends drawing back — is what makes a roofscape rather than an extrusion. The
steep face behind the peak is not shell but a grid of mullions, each member
following the surface so the grid leans and stretches with it.

It is an interpretation, not a reconstruction: the section rules come from a
sketch and the massing from photographs, with no plan drawing to work from.

`Ribbon` is the more instructive of the other two. The driver surface is never built:
it is defined as a loft through CV curves — a section control polygon carried
along the length by Catmull-Rom through height, width and drift — and because a
band is only a strip of that definition, the strips are read straight off it
rather than slicing a surface that would be thrown away. Each band is a run of
closed sections, the strip's width across the surface given thickness along the
surface normal, lofted along the run: every band a solid, and the whole thing
exportable as STEP. A ribbon is constant in one surface parameter and runs the
length of the other, so which is which is the only thing the **U / V** switch
changes — along the building, or wrapped over it.

A new Script feature starts as a **spiral stair** — centre pole, treads,
risers, stringer and handrail as separate solids, thirteen parameters on
sliders. The treads and risers are modelled once and instanced up the helix.
Edit the code and the feature becomes something else; the parameters follow
what the new code declares, keeping the values of any that survive.

Compiling is part of the precondition, so a script that will not compile never
reaches the kernel, and a syntax error reads as one rather than as a modelling
failure. `Script` is a page-kernel feature: the native kernels hold a real OCAF
document but cannot run JavaScript, so a model containing one is browser-only.

## One way in, two ways to look

Everything the interface can do to the document is one JSON edit, and there is
no second path. A toolbar button is a literal, `{"op":"add","type":"Cube"}`. A
slider is a literal, `{"op":"set","id":"CB1","key":"dx","value":92}`. A wire
dragged in the node graph is `{"op":"connect","id":"FI1","key":"body",
"from":"CB1"}`. A line drawn in the sketcher is `{"op":"draw","id":"SK1",
"type":"line","at":[[0,0],[120,0]]}`. `src/mdl.js` holds the nineteen of them
and the channel they all go through; nothing else may touch the kernel.

| | |
|---|---|
| `add` `delete` `rename` | features |
| `vertex` | one vertex of a mesh, moved by an offset — what a handle writes |
| `set` | one number — a catalogue argument, or a parameter a script declared |
| `connect` `disconnect` | one reference: one wire |
| `code` | the source of a written feature |
| `sketch` | a whole drawing at once |
| `draw` `erase` `relate` `drag` | one element of a drawing, one relation over it, or one end moved — what a click and a drag in the sketcher write |
| `undo` `redo` | walk the stack of documents. Edits like any other, so they are recorded and can be sent from outside |
| `unrelate` | take a relation off a sketch — what deleting its mark in the sketcher writes |
| `layer` `unlayer` | one layer of a drawing: made by naming it, shown, locked, renamed, made current — or deleted with everything on it |
| `relayer` `nudge` | elements of a sketch moved onto another layer, or moved bodily — what a window selection is dragged out for |
| `weld` | hold every pair of ends that lie on top of one another together, with a coincidence each |
| `construct` | mark elements construction geometry, or make them output again |
| `appearance` | a finish; redraws, does not rebuild |
| `model` | the whole document at once — every one above is a small edit of the text this one writes wholesale |
| `move` `select` | view state, through the same channel, recorded and marked as not rebuilding anything |

`add` without `refs` wires its inputs the way pressing the button does — the
selected body for an operation, the first datum of the right type for the rest
— so `{"op":"add","type":"Fillet"}` typed into a console does what the toolbar
does.

## Asking Claude to build it

The **AI** button opens a bar along the bottom. Type what you want and watch it
appear: nodes arrive one at a time, wires land, numbers get set. Stop halts it
mid-sentence and leaves what has been built; one undo takes back everything a
request did.

**There was almost nothing to build.** Everything that edits this model already
does it by writing one line of the model description language and sending it
down one channel. So the assistant is handed the same three things a person
would be given — the op table, the catalogue, and the document — and its edits
go through `mdl.run` exactly as a dragged wire does. There is no second path
into the model, no privileged call, nothing it can do that could not have been
typed into the node editor's console. That is also why watching it work is
watching the graph build itself rather than a part arriving from nowhere.

It gets two tools, and both are that same channel:

| | |
|---|---|
| `run_edits` | a list of edits, applied in order, live. Carries on past a refusal and reports the message, so a mistake is something to correct rather than a dead end. One tool call is **one** step to undo. |
| `look` | the model file as it stands, and any errors on it — for checking what a stage actually produced before building on it. |

`add` gained an optional `id`, so it can name what it creates and wire to it in
the same breath rather than waiting to be told what it was called:

```json
{"op": "add", "type": "Cube", "id": "BASE", "name": "Base block"}
{"op": "set", "id": "BASE", "key": "dx", "value": 240}
```

The asking is the page's own `sample` capability: in the published Artifact the
**viewer's** Claude answers, on their account, and the page never sees a key.
Opened from a file or served by a local kernel there is nobody to ask, and the
bar says so rather than pretending — the one thing in this program that does
not work everywhere the rest of it does.

## Four things about the viewport

All four came out of trying to build a shopping centre — 32 metres of
millimetres — and finding that it could not be done.

**A slider's range is how far the handle travels, not a cap on the value.** A
cube's runs to 4000 mm and a point's to ±2000, which is right for dragging and
wrong for a building: setting `dx` to 9000 silently stored 4000, and the only
sign was a model that came out the wrong size. A *wired* number was never
clamped, so it was inconsistent as well. Values now go in as given — the
drivers guard themselves, which is what preconditions are for — and the slider
track stretches to hold whatever it is showing, rounded to a number a person
would have picked. A choice is still bounded, because there really is no fifth
option out of four.

**Fit frames what you can see, not the canvas.** The panels float *over* the
model rather than beside it, so fitting to the whole canvas puts a third of the
part under the tree and the definition panel — which is what "fit doesn't fit"
looked like. It now measures the clear rectangle between whatever panels are
open and frames into that, aiming off-centre by however far off-centre that
rectangle is. Measured on a 32 × 22 × 22 m section: entirely inside the free
rectangle, filling 78% of it.

The distance itself is now arithmetic rather than a fudge. A bounding *sphere*
(so the framing does not change as the model is turned) and the narrower of the
two half-angles the free rectangle subtends:

```
distance = radius / sin(min(halfV, halfH)) × 1.06
```

The old one multiplied the box diagonal by 1.9. And the clipping planes and the
wheel's reach are now multiples of how big the scene is rather than fixed
numbers — `far` was 40 000 mm and the wheel stopped at 8 000, so a building was
pushed straight through the far plane and one turn of the wheel put the camera
back inside it.

**Panning grabs the model.** It was moving the camera with the drag, so the
model went the other way. It now moves the camera *against* the drag, by
exactly what one pixel is worth at the distance being looked at — so the point
under the cursor stays under the cursor. Dragging 200 px right and 100 px down
moves the model 226 px and 115 px, the residual being the parallax of a corner
nearer than the pivot.

**The AI panel follows what it builds, and folds away.** While a request is
running the view re-fits after every edit, because the first thing it adds is
usually nowhere near where the camera happens to be pointing. The working
folds down to the prompt alone — a long log covers the middle of the viewport,
which is the whole reason — and says how many lines are behind it.

## Undo, and what it is a stack of

Every edit already goes through one channel, and the document is already one
JSON file. So undo is not a log of inverse operations that has to be kept
honest against what the edits actually did — it is **a stack of documents**.
Before an edit that changes anything, `src/mdl.js` takes the model file as it
stands; undo loads the one underneath. Nothing on the stack understands what an
edit *does*, which is exactly why it cannot drift from what edits do.

- **Ctrl+Z / Ctrl+Shift+Z**, or the two arrows in the corner chip, which say
  what they would take back (`Undo drag`) rather than just being arrows.
- `{"op":"undo"}` and `{"op":"redo"}` are edits like any other, so they go
  through the same channel, appear in the console, and can be sent from
  outside.
- **View edits are not on it.** Moving a node on the graph canvas or selecting
  something changes nothing to undo, which is what `view: true` in the op table
  already meant.
- **A refused edit has nothing to undo**, because it changed nothing — the
  snapshot is taken before and kept only if the edit succeeds.
- **A drag is one step.** Consecutive edits on the same thing within 900 ms
  collapse into one entry, so dragging a slider through 21 values leaves one
  step behind it, not 21. That is what `coalesceKey` decides, and it is the
  only place the stack knows anything about particular ops.
- The graph's canvas layout rides along, so undoing a load puts the nodes back
  where they were.

Depth is 60 documents. For a part this size that is about what one mesh costs.

## Numbers are features too

Half the catalogue builds no geometry. It computes, and what it computes is
wired into the sliders of the features that do build — which is the other half
of what makes this a graph rather than a tree.

**Every numeric input takes a wire.** `F.real` resolves it, so a slider driven
from somewhere else reports what is arriving and the literal underneath is kept
but not read; pull the wire off and the old value comes back. No driver in the
kernel knows this is happening.

| | |
|---|---|
| **numbers** | `Number` one on a slider of its own · `Series` start, step, count · `Range` evenly between two bounds · `Math` two inputs and an operation · `Expression` a formula over `a`, `b`, `c`, with `i` and `n` bound to the position in a list · `Panel` shows what is wired into it |
| **curves** | `Circle` on a plane · `Polyline` through a list of points · `Interpolate` a smooth curve through them |
| **analysis** | `EvaluateCurve` the point at a parameter, tangent drawn · `DivideCurve` equal lengths, as points · `EvaluateSurface` the point at (u, v), normal drawn · `Measure` length, area, volume or bounding size, back out as a number |
| **operations** | `Extrude` a profile along a direction · `Loft` a skin through sections, in the order they are wired · `Boolean` union, difference, intersection · `Project` a curve pulled onto a surface |

Inputs say what a source may **produce** — `number`, `point`, `vector`,
`curve`, `plane`, `solid`, `text` — not which feature types they accept, so a
component added later is taken by every input its output makes sense for
without any of them being told about it.

### Lists

A `Series` wired into a coordinate of a `Point` makes a row of points; an
`Interpolate` through those points is one curve; a `DivideCurve` of that curve
is a list of points again. Where two lists meet, the shorter repeats its last
item until the longer is exhausted, which is Grasshopper's longest-list rule.

Lists travel through the data components and the components that take points.
Everything else — `Cube`, `Sphere`, `Fillet` — reads the first item and says so
on the slider. Making a hundred cubes from a hundred numbers wants a data tree,
and this is not one.

### Two honest approximations

`Interpolate` is a Catmull–Rom spline sampled into a fine run of segments.
OpenCascade's B-spline fitter needs a `TColgp_Array1OfPnt`, which this
WebAssembly build does not export; the curve is drawn, lofted and divided as
what it is.

`Project` samples the curve, pulls each sample to the nearest point on the
target's surfaces, and re-fits. An exact projected curve wants
`BRepProj_Projection`, which this kernel does not carry either. The nearest
point is exact at every sample, and the sample count is a parameter.

## Samples

The **Samples** button loads a worked example whole. It takes two clicks — the
list, then the entry — because it replaces what is open, and the list says so.

### Hillside town

A landform with six villas terraced across it: pool decks, balustrades, glazed
faces with mullions, hipped roofs. **47 nodes and not one script**, ~150 ms to
build, and the whole document is 5.9 kB.

The chain reads left to right in the graph:

| | |
|---|---|
| **the hill** | `MeshGrid` → `MeshDisplace`, one formula in one node, → `Subdivide`. Its width, depth and height are `Number` features wired into those sliders, so the hill is a fixed surface whose size and height you drive from three places. |
| **the plan** | a `Numbers` list — `-1450, 0, 1450` — into the `x` of a `Point`, with `y` a plain slider. Two of those are the two terrace rows. Flat, two-dimensional, and it never mentions z. |
| **the projection** | `Drape` drops each plan point straight down onto the hill and hands back where it landed. That is the whole of "project the plan onto the mountain", in one wire. |
| **the villa** | after Zaha Hadid Architects' **Rock**, below. Twenty-nine nodes, built once. |
| **the town** | `PlaceAt` puts that one villa at every draped site, turned by an angle from a second `Numbers` list. Retype `0, 16, -12` and three nodes rebuild, not forty-seven. |

Individual control is the two typed lists: bay positions in plan, and a turn
per villa. Everything else is a slider.

### The villa, after ZHA's "Rock"

Reverse-engineered from the published drawings of the Dubrovnik golf and spa
resort prototype — which the practice describes as inspired by Croatian karst,
"a rock, partly sunken into the ground". Four moves, and every one of them is
the same lens resized:

| | |
|---|---|
| **a plan** | a lens pointed at both ends — six numbers in `Lens x`, six in `Lens y`. Nothing else in the villa holds a plan. |
| **a batter** | `Math` multiplies that lens by `Batter` and a `Point` drops it below grade, so the walls lean in as they go down and the mass sits into the slope. One `Loft` between the two is the whole body. |
| **a lid** | `Math` multiplies the lens by `Roof oversail`, twice, a plate thickness apart. A second `Loft` is a thin roof that oversails the wall on a crisp edge. |
| **a sinkhole** | a four-sided wedge `Loft`ed from the terrace up through the sky, cut out of both, leaving the terrace and the lap pool in the hole. |

Retype the twelve numbers of the lens and the body, the lid and the batter all
follow, because they are all that lens.

**One thing that bit, worth knowing.** The mass and the lid were first gathered
by `Join` and cut once. That silently did nothing: a boolean argument that is a
compound of two solids which touch is self-intersecting, and OpenCascade
answers by handing back what it was given — no error, no cut, and the volume
identical to the input. Each solid is now cut on its own. If a `Boolean` ever
appears to do nothing, measure it.

### Sketcher

The second sample, and the one to open if you want to know how a sketch is
used. Three of them build the whole part and nothing else does:

| | |
|---|---|
| **Plate outline** | four elements chained into an outline, held square by `horizontal`, `vertical` and `parallel`. Three more loops drawn inside it — two circles and a slot — come out as holes, because they are inside it rather than because anyone said so. |
| **Rib section** | the same node on a plane standing on its side, where the drawing's **u** and **v** are the world's Z and X. Nothing in the drawing knows that; re-point its plane and it goes somewhere else unchanged. |
| **Open chain** | a line and an arc that do not close, extruded on **Surface** rather than Solid — the other half of that toggle, next to the plate that used the first half. |

Then one `Boolean` fuses the rib to the plate and one `Fillet` breaks the
edges, so the sketches are feeding ordinary modelling rather than living in a
corner of their own. Double-click any of the three to draw on it.

Every number in it can be read off the drawing, which is the point of a sample
you are meant to learn from:

| | |
|---|---|
| the plate outline | 1143.81 mm — 210 + π·50 + 210 + 100 for the four outer elements, plus two bolt circles and the slot |
| the fin | 6513.27 mm², which is the chain's 162.83 mm swept 40 |
| the fuse | removes 39 788 mm³, the trapezoid of rib standing in the plate's 14 mm, 14 mm thick, exactly |

**One thing that bit, and the reason those numbers are in the test.** The fin
first measured 288.50 mm where the drawing says 162.83. The chain walker joins
elements end to end whichever way round they were drawn, so about half of them
are built in reverse — and an arc was being reversed by writing `a0 = a1,
a1 = a0 + 2π`. That is a real arc, and it is a three-quarter turn the other way
round. It looked plausible in the viewport. An arc's own numbers say which arc
it is and the welded ends say which way along it, so nothing needs reversing at
all; only a spline, whose interior points have an order.

### The saved ones

Everything else on the Samples list is a model somebody **built in the program
and saved**, which is the point of it being there: it is a file, not a fixture,
and opening one is the same thing as opening your own.

| | |
|---|---|
| **polyline** | eight points, a polyline through them, and one offset held a distance from it the whole way. The smallest thing that shows what a parallel curve is — drag the distance and watch the corners run on until they meet, round, or carry the tangent. |
| **parallelcurveseries** | the same polyline with a `Series` wired into the offset distance, so the one node builds once per number and hands them all on together. A setback drawing, or the contours of a bund. |
| **sample_slab_for_flow** | an origin, three planes, a sketch and a pad. What the shape of a document looks like with nothing else in the way. |
| **Sample_Cap** | two caps driven by top-level named numbers, with a fillet on every arris. Change the radius and both follow — including the fillets, which is the part that used to give up at large radii. |
| **samplecap_onecaponly** | one of those caps with a `Generator` in it: the same part written as a plan that emits its own nodes, beside the hand-built one. |
| **3dspline, fillsurface, Columns on a curve, wideflange** | the curve and surface work, and the two that show a set being instanced. |

## A building is not a part

Seven and a half thousand features, 1,665 sets, 655,339 triangles — an IFC
import — and nearly everything in the interface was written for a part with
forty nodes in it. Three things had to change, and all three are the same
mistake: **asking a question about the whole document to answer a question
about one row.**

### The tree

| | was | is |
|---|---|---|
| fold one branch | 3,754 ms | 11 ms |
| click a body in the viewport | 3,754 ms | 0 ms |
| fold every set | — | 3 ms |
| rows in the DOM when it opens | 9,227 | 1,340 |

What was wrong, in order of cost:

- **"What is in this set" was a filter over every feature in the document**,
  asked twice for every folder drawn and once more for its eye. Indexed once
  per document instead — the tree is replaced rather than mutated on every
  edit, so the index cannot go stale.
- **A folded branch built every row inside it and then hid them.** Folding
  saved a scroll and not one millisecond. Shut now means *not built*, which is
  what makes folding worth doing and what makes ⊟ in the header the answer to
  a big model rather than a tidier way of paying the same cost.
- **Selecting anything rebuilt the whole tree** to move three class names.
  It repaints instead.
- **A set that is big when it is first seen opens folded.** Decided once per
  set; fold it or open it after that and it stays as you left it.

⊟ and ⊞ in the tree header fold and open everything; a set's own menu has
**Fold it all away** and **Open it all up** for one branch and all the way down
it.

### From the model to the tree, and back

Right-click anything in the viewport: **Show in tree** scrolls to its row,
opening whatever is folded over it, and flashes it. **Centre on it** is the way
back, and has always been on the tree's menu. The set it is filed in is on the
menu too — in a building the thing you want to put away is usually the storey,
not the one beam you happened to hit.

### The viewport

Three questions, asked per feature per frame, in the order they cost:

| | |
|---|---|
| **is it on screen** | the frustum, against a sphere worked out once when the shape landed — never from the triangles |
| **is it worth drawing** | how many pixels across it comes to. Under two and a half there is no drawing of it that differs from not drawing it |
| **is it worth this frame** | over a 350,000-triangle budget the rest is drawn as bounding boxes — **worst value first**, the most triangles for the fewest pixels, stopping the moment the bill is under |

The boxes are **one geometry**, rebuilt when the set of them changes rather
than every frame: a thousand boxes drawn separately is a thousand draw calls,
which is the cost being got away from. Whatever is selected or under the
pointer is always itself.

None of it is on for a part. Below a few hundred shapes there is nothing to
gain and a box where a fillet was is a lie, so it switches itself on by the
size of the model and says in the log what it is doing: how many it is holding,
how many it is drawing whole, how many as boxes, how many are off screen.

**What this is not.** An occlusion query — deciding that a beam is behind a
slab — needs the depth buffer read back, which costs a stall per frame and is
worse than drawing the beam. At this scale the honest version of "a cheap
representation for what you cannot make out" is the box.

**One thing that bit.** `group.visible` came to mean two different things —
what the document says, and what this frame's culling decided — and `fitView`
asks how big the model is by reading it. That is circular: the camera is where
it is *because* of the fit that has not happened yet. A building set out on
survey coordinates framed its three origin planes and left the building four
hundred kilometres off screen. The two facts are written down separately now.

## Four primitives, so a graph can compose

Before these, a definition of any size fell back to a written feature — and a
written feature takes no inputs, so it stops being part of the graph at all.
These four are what a node editor needs to stand on its own:

| | |
|---|---|
| `Numbers` | a list you type. Where `Series` gives an even run, this gives the ones you meant. |
| `Join` | several shapes as one, compounded rather than fused — the group of a node editor. |
| `Drape` | points dropped straight down onto a surface, a solid or a mesh. The highest hit wins, so a point over an overhang lands on top of it. |
| `PlaceAt` | one shape at every point in a list, turned by an angle from another. The shape is built once and each copy is the same `TopoDS_Shape` under a different `TopLoc_Location` — the instancing `Array` uses, so the hundredth copy costs a matrix rather than a rebuild. |

`Numbers` introduced a `text` argument kind: one line, a `TDataStd_AsciiString`
like code, with a field rather than an editor. It shows on the node itself,
because a list of numbers is short enough to read and change without opening
anything.

## The sketch

Every CAD modeller has one, and it is the same idea in all of them: a drawing
in two dimensions, and a plane to put it on. Nothing in the drawing knows where
that plane is. `{"id":"e1","type":"line","a":[0,0],"b":[100,0]}` is a hundred
millimetres along the sketch's own **u**, and that is all it is. Point the
sketch at a different plane, or wire a different point into its origin, and
every line, arc and spline in it goes with it — while the JSON does not change
by one character. That is not a convenience; it is what a sketch *is*, and the
test that matters says exactly that:

```
ok   the drawing does not change when the plane does
ok   but the geometry does
```

`src/sketch.js` is the drawing's semantics and nothing else — no OpenCascade,
no DOM. The kernel reads it to build edges; the viewport reads the same
functions to draw what you are drawing and to decide what your cursor is
snapping to. One definition, two readers.

| | |
|---|---|
| elements | `point` `line` `arc` `circle` `ellipse` `oblong` `spline` |
| relations | `coincident` `horizontal` `vertical` `parallel` `perpendicular` `tangent` |
| arguments | a plane, an origin, the drawing, and whether closed loops become faces |

### Drawing is an edit like any other

Double-click a sketch — in the tree, in the viewport, or on its node — and the
viewport becomes a drawing board: the camera goes square on to the plane and
stops orbiting, and the tool rail steps aside for the seven things a drawing is
made of. A click is then no longer a click on a solid. It is a point on the
plane, in the plane's own two numbers, and when enough of them have been
collected the element they make is written as one line of the model description
language:

```json
{ "op": "draw", "id": "SK1", "type": "line", "at": [[0, 0], [120, 0]] }
```

which goes down the same road a slider and a wire go down. Drawing a line in
the viewport and typing that line into the model file are the same edit,
because there is only one of them. `draw`, `erase`, `relate` and `sketch` are
the four ops; the first three read the drawing, change one thing and write it
back, because the drawing is one string on one label.

A click that lands on the end of something already drawn snaps to it and writes
a `coincident` relation as well, so the corner stays a corner when either side
of it moves.

### Adding the sketcher moved two other things

`Extrude` gained the loops rule below, and the page gained a `<meta
charset="utf-8">`. The Artifact wrapper supplies one, so the middle dots and
en-dashes read correctly there; the same file opened from disk or served by
`ocafcad serve --ui` had none and showed them as mojibake.

### Shift means "and this one too", everywhere

One modifier, one meaning, in all four places it can be held:

| | |
|---|---|
| the tree, and the 3D view | shift-click builds a set of features. Add a `Loft` or a `Join` with several picked and it is born wired to all of them, in the order they were picked — which is the answer to "which sections", and the only reason guessing one was ever wrong |
| the node editor | a wire dropped on an input **is** the input; shift-drop adds one more. The port shows a ring rather than a dot while shift is down. `Polyline`, `Interpolate`, `Drape` and `PlaceAt` now take as many point sources as you give them |
| mesh editing | shift-click picks several vertices; the handle goes on the last one and moves all of them, each from where it already was, so a pushed run keeps its shape. One drag is one step to undo, and the file still says exactly which vertices moved |
| the sketcher | shift-click picks several elements or ends, and a relation applies to what is picked |

### Relations are things you can see, and take off

Every relation is drawn beside what it holds — a small glyph, with a thread
back to the corner or the line it governs, fanned out when several hold the
same point. Click one and it is in hand; **Delete**, or the button that
appears, takes it off, and what it was holding comes apart again.

### Dragging a held corner moves the corner

This is the one place the solver is run with an anchor. A coincidence normally
meets in the middle, which is right when both ends are free and quite wrong
when one of them is under the cursor: dragging a corner would move it half as
far as the pointer and leave the drawing behind. So `drag` solves with the
dragged handle **pinned** — everything held to it follows all the way — and
writes the result back. It is the only edit that writes a solved drawing;
everywhere else the drawing keeps what was drawn and the relations are what
they come to.

```
ok   the dragged end went exactly where it was put  — [140,-30]
ok   and the other end came with it, all the way  — [140,-30]
ok   while the far ends stayed put
```

### A window takes several, and several move together

Drag a window out on empty paper and it picks what is in it. Which *what* is the
direction: **left to right takes only what is wholly inside**, **right to left
takes anything it crosses** — the distinction every CAD package has drawn since
AutoCAD, and drawn the same way round. The window says which it is while you
drag: a solid outline for one, dashed for the other.

Then press on any of what is picked and drag, and the whole selection moves
together — one `nudge` edit, one step to undo. An arc and a circle move by their
centre, so a drag of six elements redraws none of them. Delete takes all of it.

Measuring what is under the cursor is done to the *element*, not to the points
it happened to be sampled at. A line's outline is its two ends and nothing in
between, so measuring to the samples meant the middle of a long line — most of
a line, and exactly where you take hold of one — was never under the cursor at
all.

### Layers are a place to put things, not just a switch

Every layer row will select everything on it, and right-clicking one opens the
rest: select, **move the selection here**, turn off, lock, draw on it, delete.
Below the rows the panel lists the drawing's elements — what is picked when
anything is, the first hundred and twenty otherwise — each with the layer it is
on as a dropdown and a dashed-line button that makes it construction. So a
window round twelve lines and one dropdown moves twelve lines to a new layer.

### Select first, then draw

A sketch opens in **Select**, not armed with a tool — the first thing anyone
does to a drawing is look at it and push something. In select you drag an end
to move it (an arc's endpoint is an angle and a radius, so it turns and resizes
the arc rather than tearing it), and click to pick elements or ends. Relations
apply to what is picked, the way every parametric sketcher works.

A drag is shown as it happens but written once, at the end: one `drag` edit,
one step to undo, however far the cursor travelled.

### The line tool is a polyline, and the arc leaves it smoothly

Keep clicking and the line tool keeps going, corner after corner, each segment
joined to the last by a `coincident` relation so the corner stays a corner when
either side of it moves. Reach for the **arc** while a chain is live and the
next click is all it needs: the arc starts where the chain stopped and leaves
in the direction the chain was travelling, tangent to it — the move a CAD
sketcher is built around. A **Tangent** switch appears while that is on offer,
so it can be turned off.

Tangency is *said*, not computed in the viewport and smuggled into the model:

```json
{ "op": "draw", "id": "SK1", "type": "arc", "at": [[200, 100]], "from": "e1.b" }
```

`from` names the end to leave. The op works out the arc — the one circle
through the start point tangent to that direction and through the end point,
which is a two-line derivation with exactly one answer:

```
|from + r·N − to| = |r|,  N ⟂ tangent    ⟹    r = −(D·D) / (2 N·D),  D = from − to
```

So the line in the console is the whole of what happened, and replaying it
draws the same arc. When the three points are in a line there is no arc — the
circle is infinite — and a line is drawn instead, which is what that case
actually is.

### The constraints are a relaxation, not a solver

Every relation knows how to move the handles it governs the shortest way to
satisfy itself, and they are run in turn until nothing moves. That converges on
the sketches people draw, it fights itself when a sketch is over-constrained,
and — the part that matters — it reports how far off it finished rather than
pretending. It is not a degree-of-freedom solver and does not claim to be. The
drawing on the label is what you drew; what the relations make of it is
computed at build time and never written back, so nothing drifts by being
rebuilt twice.

### A loop inside a loop is a hole

A loop drawn inside another is a hole in it, and a loop drawn inside that hole
is solid again. Nothing declares this: the loops' own 2D outlines are counted —
a loop with an odd number of loops around it is a hole in the innermost of them
— and the hole wire is added to the face **reversed**, because OpenCascade
otherwise reads it as a second outline and hands back a face that is bigger
rather than smaller. A 200 mm square with two 18 mm circles in it padded 40 mm
measures 1 518 570 mm³, which is the square less the two circles, times the
thickness, to four significant figures.

### The same point, at any scale

Two ends are the same point below some distance, and that distance cannot be a
fixed number of millimetres, because the drawings are not all the same size. A
site boundary seven hundred metres across, drawn in millimetres on survey
coordinates, arrives with corners that miss each other by four tenths of a
millimetre — **six parts in ten million**, which is nothing on a survey and was
more than enough to stop the outline closing against a flat 0.05 mm.

So the loop walker takes the larger of the tolerance it was given and a
millionth of the drawing's own diagonal. On a hundred-millimetre bracket that
is a fraction of a micron and changes nothing; on a site plan it is two thirds
of a millimetre, and the outline closes. It only ever loosens, and only where a
number of millimetres has stopped meaning anything.

### A DXF says where things are, never that they meet

A DXF is a heap of separate `LINE` and `ARC` entities. An outline drawn as
eight of them *looks* closed and is eight loose pieces the moment anybody drags
a corner. So on arrival every pair of ends lying on top of one another is
written down as a `coincident` relation — once, while the drawing is still
exactly as it came, so nothing moves. Three ends meeting at one corner is one
corner and gets two relations, not three; the two ends of one element are never
joined to each other, because an arc that nearly closes on itself is an arc.

After that the corners are real: turn the solver on, drag one, and what is held
to it comes along — and the outline is still an outline. A drawing that arrived
before this did can be given the same treatment from its panel, or with
`{"op":"weld","id":"SK1"}`.

And a coincidence outranks the geometry: two ends a relation holds together
**are** one point, however far apart the numbers still say they are. The loop
walker asks the relations as well as the distances, so a drawing that has been
told its corners meet does not have to be moved before it will close.

### A closed loop is a face

The chain walker takes the elements that have ends and walks them end to end
until a walk comes back where it started; circles, ellipses and slots are
already a loop on their own. Every loop that closes becomes a planar face —
`BRepBuilderAPI_MakeFace(wire, true)` — and everything left over stays a wire.
So a sketch is pad-ready the moment it closes, without anyone asking for a
surface.

Two millimetre-scale details make that work rather than nearly work. A drawing
made by clicking is full of hundredth-of-a-millimetre gaps and **a wire will
not close over one**: `BRepBuilderAPI_MakeWire` simply returns `IsDone() ==
false`. So the ends of a chain are welded first — the meeting point is the
middle of the two ends and both sides are given that exact point — and every
edge is then built *through the points the walk hands over* rather than from
each element's own arithmetic. An arc is built with `GC_MakeArcOfCircle`
through three of its own points, which means its ends are exactly the welded
ones whatever that did to its radius, and it is still a real arc rather than a
run of segments.

### Layers, and construction geometry

Two different ways of saying "not this", because they are two different things.

A **layer** is where an element came from. A DXF arrives on the layers it was
drawn on and they travel in the drawing, so a site plan is a site plan and not
a soup. Turning one off takes it off the screen *and* out of what is built —
that is how a plan full of furniture becomes a profile — and the relations
drawn beside anything on it go off with it, because half a coincidence is not
a mark anybody can read. Locking leaves a layer drawn and built but deaf to the
cursor, which is what you want of a survey you are drawing over.

**Construction geometry** is a fact about one element rather than about where
it came from: `construction: true`, drawn dashed, and never built. The dashed
button beside **Done** turns it on and off for whatever is picked, and reads the
selection: all of it construction already means it makes all of it real again. It is the
centreline two kerbs were struck from, the diagonal that holds a rectangle
square, the circle three holes sit on. It is picked, constrained and solved
exactly like anything else — it is the *reason* the real geometry is where it
is — and the only thing it never does is leave the sketch. It does not go into
the solid and it does not go into an exported DXF. What you see dashed is what
does not come out, which is how CATIA has always drawn it.

`shownDrawing` drops what is on a layer that is off; `builtDrawing` drops the
construction geometry as well, and the relations that only held it. The kernel
builds the second one, the sketcher draws the first.

### One bad element is one element

A surveyed DXF is full of lines that are not there: duplicates laid over a
corner, three hundredths of a micron long, invisible in any viewer. Each one is
an edge `BRepBuilderAPI_MakeEdge` answers with `BRep_API: command not done` —
and that raise used to come up through the whole `Sketch` build, so a road
layout of five hundred and eighty-one elements showed **none** of them once you
left the sketcher.

Two answers, because it needed both. The DXF reader rounds to a tenth of a
micron and then looks again, so an element rounding has collapsed never reaches
the document. And the builder refuses to let one element speak for the rest:
every element's edges are made inside a `try`, a chain that will not become a
wire is a chain missing rather than a sketch failed, and a drawing that cannot
build anything at all says so in words instead of raising OpenCascade's.

### Solid or surface is a real choice

`Extrude` used to take the first face it found. It now sweeps **every** face
the profile offers, so a sketch of six closed loops pads into six bodies rather
than one; on `Surface` it sweeps the wires instead, taking them back off the
faces when the profile arrived as faces. A sketch of a square 100 mm on a side,
padded 40 mm, measures 400 000 mm³ and 36 000 mm² as a solid and 16 000 mm² as
a surface — the two ends, present or absent. That is the whole difference
between a body and a skin, and it is worth measuring rather than assuming.

## Polymesh

A different kind of geometry from everything above. A B-Rep has a surface under
every face and OpenCascade owns it; a polymesh is a list of points and a list of
faces of any number of sides, and nothing owns it but `wasm-kernel.js`. That is
what makes it something you can shove a vertex around in, and what makes
Catmull–Clark possible at all.

A mesh is a **data** result, not a shape: a flat `TDataStd_RealArray` of
vertices beside a `TDataStd_IntegerArray` packed `[sides, i, j, …]`. So it
travels in the model file, it has no B-Rep behind it, and it is drawn from its
own polygons — n-gons fanned into triangles for display only, with every
polygon edge sent as a line so the cage reads as the cage.

| | |
|---|---|
| `MeshBox` `MeshGrid` | cages to start from, divided as finely as you like |
| `MeshFromShape` | tessellates a solid and welds it, so anything the B-Rep side builds crosses over |
| `EditMesh` | the mesh with vertices moved by hand |
| `Subdivide` | Catmull–Clark, 1–4 levels, on or off, boundary sharp or smooth |
| `Weld` | merges vertices closer than a distance and drops what collapses |
| `FillHoles` | chains the open edges into loops and closes each one |
| `MeshMerge` | amalgamates two cages: removes the faces where they meet and bridges the openings |
| `MeshTransform` `MeshDisplace` | move, turn, scale; or push every vertex along a direction by a formula over its own position |

### Editing by hand is still parametric

Select an `EditMesh`, click a cage vertex, drag an axis. What that writes is
not a position — it is an **offset** from wherever the mesh upstream put that
vertex:

```json
{ "op": "vertex", "id": "ED1", "index": 12, "x": 4, "y": 0, "z": -2 }
```

and it lands in the model file under `moves`. So the edit survives a change
upstream, reads as text, can be typed into the panel or the graph console
instead of dragged, and is undone by setting it back to zero. The handles show
the cage even when the cage is consumed and only the subdivided result is
visible — which is the whole point of a cage.

While a mesh is being edited by hand the viewport belongs to its handles: a
click that misses one drops the vertex rather than walking off to whatever
solid was behind it. Esc leaves.

### Merging two cages is not a boolean

`MeshMerge` is the operation a subdivision workflow actually wants when two
cages meet, and it is deliberately not CSG. A boolean would cut the two against
each other exactly and hand back a seam of triangles — right for a solid,
useless as a cage, because Catmull–Clark wants quads and a triangle fan round
the join pinches under it. So `MeshMerge` does what a modeller does by hand:

1. finds the faces that are in the way — either **inside the other** mesh (a
   ray cast from each face's middle, odd crossings means inside) or **facing it
   within a distance** (nearest point on the other surface, and the face's
   normal pointing at it);
2. removes them, leaving an opening in each cage;
3. walks the open edges into loops, pairs each opening on A with the nearest
   one left on B, rotates one until the two line up, and **bridges** them.

Equal loops give quads all the way round. Unequal ones walk both loops in step
and drop in a triangle wherever one side has to catch up — eight against four
is four quads and four triangles, and one level of subdivision turns them all
into quads anyway. `Twist` steps the pairing round by hand and `Bridge
direction` reverses it, because a bridge between two loops is never quite
automatic.

The bridge is wound *against* the loops it joins, not with them: a boundary
loop follows the free directed edges of the faces around it, so a bridge that
runs the same way leaves each edge free a second time and the rim silently
stays open. The test for that is the one that matters — filling the holes of
the merged mesh must add nothing at all.

It is refused before it starts if the two cages together are more than about
6,000 faces: every face is compared against the whole of the other mesh, which
is nothing for two cages and a different algorithm entirely for two
tessellations. Merge the cages, then subdivide.

**If you want a true boolean**, do it on the B-Rep side and come back:
`Boolean` → `MeshFromShape` → `Weld`. That gives the exact solid and a
tessellation of it — a good mesh to look at, and a poor one to subdivide.

### Catmull–Clark

Written out rather than linked in — OpenSubdiv is not in this WebAssembly build
and would not fit beside it. The standard rules, for faces of any number of
sides: a face point is the average of its vertices; an edge point the average
of its two ends and the two face points beside it, or the midpoint on an open
edge; a vertex moves to `(F + 2R + (n−3)V) / n`, or `(E₁ + 6V + E₂) / 8` on the
boundary. Every face becomes one quad per corner, so a cube at level 1 is 24
quads and 26 vertices, and level 2 is 96.

`Subdivide` is refused before it starts if the level asked for would come out
past about 150k faces — the same rule the fillet radius follows: judge it
against the geometry rather than find out afterwards. `Weld` is refused the
same way if the distance is more than a quarter of the mesh.

## The node graph

**Nodes** opens the same document as a graph. The specification tree reads it
top to bottom, in the order the solver executes; the canvas reads it left to
right, along the references that put it in that order. One acyclic graph, two
drawings of it. A slider on a node and the same slider in the definition panel
are the same edit arriving by two routes, and each redraws the other.

It opens in a window of its own where the browser allows one, so it can sit on a
second screen. Inside a sandboxed frame — an Artifact — `window.open` gives back
nothing to write into, and it becomes a floating panel instead: dragged by its
bar, resized from the corner, rolled up to the bar alone, and able to try for a
real window again.

* drag an output port onto an input to wire it; drag a wired input into empty
  space to clear it
* drag a node by its header — where it lands is a `move` edit, and the layout
  travels in the model file under `"layout"`, so a part opens laid out the way
  it was left
* **Tidy** re-columns by rank and reports every move as an edit
* double-click a node to open it in the definition panel, which is where a
  written feature's code is edited
* the console below is not a transcript, it is the way in: it shows every edit
  as it happens and takes one — or an array of them — typed straight in. The
  **Model file** tab shows the document as text, updating as you drag.

That console is the surface an external driver would speak to. It already takes
the whole language; what is missing is only the transport.

## Two small things in the way

Neither is interesting, both were wrong for a while, and both are the kind of
thing only a measurement finds.

**The tool rail was cropping its own buttons.** Forty-three tools in two
columns do not fit a laptop window, so the rail scrolls — and `overflow-y:
auto` forces `overflow-x` to `auto` as well, by the rules. Anything drawn
*beside* a button inside it is therefore clipped away. The rail now runs three
wide (its width is a variable, because the tree stands next to it and has to
know), which fits all forty-three without scrolling at all.

**Every tool had a hover label, and none of them were visible** — for the same
reason. They were `::after` on each button, positioned outside the rail's
padding box, and the rail clipped every one. There is now one `#tip` element
fixed to the window, placed beside whatever the cursor is on and flipped to the
other side when there is no room. Anything carrying `data-label` gets one, so
the sketcher's rail and anything added later are covered without being told.

## Files in and files out

The first button in the toolbar is the document menu, and everything to do with
the document as a file is in it.

| | in | out | |
|---|---|---|---|
| **STEP** | ✓ | ✓ | solids and surfaces, for any CAD system. Carries several parts |
| **BREP** | ✓ | ✓ | OpenCascade's own format: exact, fast, and understood by nothing else |
| **OBJ** | ✓ | ✓ | polygon meshes, grouped by name. Carries several parts |
| **STL** | ✓ | ✓ | triangles, ASCII or binary in, ASCII out |
| **DXF** | ✓ | ✓ | 2D drawings — in as a *sketch*, out one layer per sketch |
| **Model file** | ✓ | ✓ | the parametric model itself — opening one replaces the document |

| **IFC** | ✓ | | a *building model* — with the IFC package loaded. It opens as the document |

IGES, 3DM and SAT are named too, and refused with the reason: the IGES reader
is not in this OCCT build, Rhino's reader is a library the page may not fetch,
and ACIS is a format OpenCascade does not read at all. A file that is picked on
purpose gets an answer, not silence. IFC is on that list too until its package
is switched on, and then it is not.

### IFC, which is a model and not a shape

An IFC file opened in a viewer is triangles: you can look at the wall, you
cannot change its thickness. But a wall in an IFC file is almost never
triangles — it is an `IfcExtrudedAreaSolid` over a profile, which is to say a
closed outline and a depth, which is to say the **Extrude** node that is already
on the rail. The geometry vocabulary of a building is small and nearly all of it
is in the catalogue already.

So the import does not tessellate. It reads the entities and writes the model
language, and what arrives is a parametric tree with the building's own
structure in it — project, site, building, storey, element, each a geometrical
set with the file's own names on it, and inside each element the ordinary nodes:

| in the file | in the tree |
|---|---|
| `IfcExtrudedAreaSolid` | a `Rectangle`, `Circle`, `Section` or `Sketch`, and an `Extrude` |
| `IfcRevolvedAreaSolid` | the same profile, and a `Revolve` |
| `IfcSweptDiskSolid`, `IfcSurfaceCurveSweptAreaSolid` | a `Circle` or profile, and a `Sweep` |
| `IfcBooleanResult`, `IfcBooleanClippingResult` | a `Boolean` — or a `Trim`, when it clips at a plane |
| `IfcHalfSpaceSolid`, `IfcPolygonalBoundedHalfSpace` | a `Trim`; a plane is infinite, which is the point of it |
| `IfcRelVoidsElement` | a `Boolean` difference — a wall less its windows |
| `IfcMappedItem` | the family built **once**, and an `AxisToAxis` per instance |
| `IfcIShapeProfileDef` and the five beside it | a `Section`, which still knows it is a UC 305×305×97 |
| `IfcFacetedBrep` and the face sets | `MeshImported` — the one road that is not parametric, taken only when there is nothing parametric to take |

**On IfcOpenShell.** What is ported is its *mapping* — `IfcGeom`'s
correspondence between a representation item and a modelling operation. Its code
is not: it has no browser distribution, its WASM road is a Python runtime an
order of magnitude larger than this whole page, and what it would be carried in
**for** is its own OpenCascade, which is already here. ISO 10303-21 is text, and
reading it is two hundred lines with no kernel anywhere near them.

**What it says afterwards.** How many elements came in, what they were built
from, how many facets arrived as meshes because the file had tessellated them,
and — by name and count — what was **not** read. An import that quietly dropped
four hundred bodies looks exactly like one that did not, so it says.

### Or just drop it on the page

Drag a file anywhere onto the window and let go. It goes through exactly the
same reader the menu uses, so a model file **opens** as the document and
everything else **imports** as features — and a DXF still asks its two
questions, because units and layers are things only you know.

The name is asked first: a file called `.step` is read as STEP whatever is
inside it, because a name and its contents disagreeing is a rare thing to go
second-guessing. Only when the name says nothing this build reads is the file
itself asked, and every format here answers in its first few lines — `ISO-10303`
for STEP, `CASCADE Topology` for BREP, group code `0`/`SECTION` for DXF,
`"format": "ocaf-parametric-model"` for a model, `solid` *and* a facet for an
ASCII STL, and a binary STL by being exactly `84 + 50n` bytes long. So a drawing
that arrived from a mail client as `attachment.dat` still opens.

Several files at once go in order, with one rule: a model file **is** the
document, so it goes first and only one of them goes at all — opening a second
would throw away the first along with whatever had just been imported into it.
A file that stops to ask something holds up the rest, because there is one
dialog and it can only be answered once.

### One rule about structure

A format that carries several parts may be broken into several features; every
other format comes in as one object. That is not a preference — it is what the
file itself does or does not say — so the question is only asked of a file with
an answer to it. A STEP file that names three products, or an OBJ with three
groups, opens the import dialog; a BREP or an STL does not.

Imported as sub-components, each part becomes its own feature and they are filed
together in one set — a `Body` for solids, a `GeometricalSet` for meshes — so the
tree shows the file as one thing that opens rather than as forty loose features.
Part names come from the file, and only when the count matches exactly; a name
OpenCascade's own writer made up (`Open CASCADE STEP translator 8.0 2`) is not a
name anybody gave, so those are numbered instead.

What the STEP reader cannot give through these bindings is the nesting below the
top level: `TopoDS_Iterator` is not in this build, so a sub-assembly arrives as a
compound and is exploded to its solids. The import says one part per solid rather
than implying a tree it cannot see.

### A mesh keeps its faces

A quad stays a quad, an n-gon stays an n-gon — through the import, through the
document, and back out again. A low-poly model from Blender or Max is a *cage*,
and a cage triangulated on the way in is a cage you can no longer subdivide. So a
quad box from Blender opens here as six quads, `Subdivide` turns each into four,
and the OBJ that goes back out is quads again.

Triangles appear in exactly two places and both are forced: STL, which has
nothing else, and the tessellation of a B-Rep, which never had faces to keep.

### What an import is

`Imported` and `MeshImported` are features like any other, with one difference:
there is no recipe under them. What they hold *is* the geometry — a B-Rep string,
or OBJ text — so rebuilding means reading it back, and the panel offers nothing
to turn. Everything downstream works exactly as it does on anything else: an
imported solid can be moved, cut, filleted and measured.

Whatever arrives is converted **once**, on the way in, to the one form the
document stores. So every import rebuilds through one reader rather than through
whichever reader first read it, and the model file says what it holds in a form
a person can still read.

That geometry travels in the model file, which is what makes a document with an
import in it stand on its own — and what makes it big. A document carrying a few
megabytes of B-Rep shows those as a note of their size in the model text box, and
Rebuild stands down rather than quietly rebuilding without them. The assistant is
briefed with the same shortened copy: nobody reads a megabyte of B-Rep, and in a
prompt it is a megabyte of nothing.

### Saving

Each export is offered to the viewer through the `downloads` capability. The
viewer's save allowlist has no `.step` or `.brep` in it, so the page asks for the
real extension first and, if that comes back `rejected_extension`, sends the same
text under one it does accept to be renamed. Where there is no save surface at
all — served by a local kernel, or opened as a file — it hands over the text to
copy instead. A connected native kernel writes a real file straight to disk,
either from `/api/save` or from the `ocafcad build --step` command line.

## Handling OpenCascade's failures

`IsDone()` is not a reliable gate. On an 80 mm cube OpenCascade accepts a 39.9 mm
fillet, rejects 40, then accepts 40.6 and 60 again. So every driver is guarded
three times: a **precondition** checked against the geometry before the kernel is
called at all (a radius must clear half the body's smallest extent), a
**try/catch** around the call, and a **check of the result** — `IsDone()`, a
non-null shape, and faces on it.

A `Standard_Failure` raised inside WebAssembly arrives as a
`WebAssembly.Exception`; it is unwrapped so the panel shows what OpenCascade
actually said. A feature that fails keeps its last good shape and records the
message, so one bad radius never takes the model down.

## Building

```sh
python3 docs/build.py              # both builds; fetches the kernel from npm on first run
python3 docs/build.py --only site  # just the served site
```

It builds twice, for two places that want opposite things.

| | | |
|---|---|---|
| `docs/parametric-cad.html` | **one file**, ~11 MB | published as an Artifact |
| `docs/index.html` + `app/` + `kernel/` | a folder of files, ~25 MB | served by GitHub Pages |

An Artifact may load scripts from a few CDNs but may not fetch anything at run
time, and the WebAssembly module is a runtime fetch. So for that build the
kernel travels inside the page — 22 MB of wasm gzipped to ~9 MB of text, which
the browser inflates and stream-compiles on load — and so do the showroom engine
and every package's data.

A web server has no such rule, and fetching is what a browser is good at. So the
site build leaves those three as files beside the page: streamed, compiled while
they arrive, and cached by the browser between visits instead of re-parsed out of
the HTML on every load. The source modules go across as they are and the browser
resolves the imports itself — nothing is concatenated, so the file it fetches is
the file in `src/` and a stack trace points at a real line.

The site is **this folder**, because GitHub Pages, serving straight from a
branch, offers the repository root and `docs/` and nothing else. So the served
page sits beside the source it is built from:

```
docs/
  index.html            the same shell, with a doctype and one module script
  app/*.js              src/, copied — plus occt-glue.js, emscripten's own module
  kernel/               replicad_single.wasm, playcanvas.min.js
  data/cities.json      the Climate package's site table, served where it lives
  .nojekyll             Pages runs Jekyll over what it serves unless told not to
  src/ test/ build.py   the source, which is served too and does no harm
```

`index.html`, `app/` and `kernel/` are generated: the build wipes those two
folders and rewrites all three, so a module deleted from `src/` stops being
served. Nothing else in `docs/` is touched.

Point Pages at it once: **Settings → Pages → Source: Deploy from a branch**,
this branch, folder **`/docs`**. It serves what is committed, so
`python3 docs/build.py` and a commit are what publish a change.

Pages will serve either `/docs` or the repository root, and nothing in the
repository can tell which was chosen, so the build makes both work. The root
gets an `index.html` that goes straight into `docs/` — otherwise Jekyll, finding
no index there, renders the README as the site, which is what "the page shows
the documentation" always means — and a `.nojekyll` beside it, as `docs/` has.

`src/payload.js` is what makes one source tree serve both: every big piece is
asked for by name, and it is unpacked from a payload element in the page when
there is one and fetched from beside the page when there is not. Nothing above
it knows which build it is in.

Two consequences worth knowing. Every module must stand on its own imports — in
the single file they share one scope and a missing import goes unnoticed, and
served as modules it is a `ReferenceError` on load. And the site is committed
while `docs/parametric-cad.html` is not: Pages serves what is in the repository,
so what is served is what was reviewed.

| | |
|---|---|
| `src/index.html` | markup and stylesheet |
| `src/ocaf.js` | the OCAF document: labels, attributes, drivers, logbook, solver, catalogue |
| `src/wasm-kernel.js` | OpenCascade in the page — geometry drivers, preconditions, meshing |
| `src/http-kernel.js` | the same interface over HTTP |
| `src/mdl.js` | the model description language: every edit, and the one channel they go through |
| `src/graph.js` | the node editor — its own window, or a floating one |
| `test/components.test.mjs` | the data half of the catalogue against a real kernel |
| `test/mesh.test.mjs` | polymesh, subdivision, welding, filling, and the hand edits |
| `test/samples.test.mjs` | the four composition primitives, and the worked example end to end |
| `src/showroom.js` | the PlayCanvas stage: finishes, environments, procedural lighting |
| `src/app.js` | tree, viewport, definition panel, regeneration log |
| `src/payload.js` | where the kernel, the engine and a package's data come from — inside the page, or beside it |
| `src/exchange.js` | the file formats this reads and writes, and the OBJ and STL arithmetic |
| `build.py` | assembles the single file, and the served folder |
| `test/exchange.test.mjs` | every round trip: STEP, BREP, OBJ, STL, and the quads that have to survive one |
| `test/kernel.test.mjs` | drives the page kernel headlessly under node |
| `test/mdl.test.mjs` | every edit against a real kernel, the refusals, the round trip through the file |

```sh
node docs/test/kernel.test.mjs
node docs/test/mdl.test.mjs
node docs/test/components.test.mjs
node docs/test/mesh.test.mjs
node docs/test/samples.test.mjs
```

The first builds the model, edits it, checks that only the downstream functions
re-run, and walks through every way a fillet can fail. The second runs every
edit in the language against a real kernel, checks that the refusals are refused
and recorded rather than swallowed, and that the file the graph writes rebuilds
the part and its layout. The third builds a definition out of the data
components — a series into a point into a spline into divisions into a panel —
and checks the arithmetic, the measurements, the list rule, and that only the
functions downstream of an edit re-run. The fourth checks Catmull–Clark against
its known answers, that a hand edit is an offset that survives the file, and
that welding and filling do what they say.
