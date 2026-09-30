---
name: construction-document-sets
description: How to produce a complete, consistent architectural drawing set (construction documents) from a parametric model in the Web BIM app, with minimal guidance from the architect - a description, a sketch or two, basic detailing intent. Covers what a drawing set is for (a navigation system for the contractor), the standards it sits in (CSI MasterFormat, US National CAD Standard / UDS, IBC/IRC, ASTM, AISC, ACI), the model-first order of work, the office CAD standard as data, details built from assemblies and parametric detail components, CSI-keyed keynotes, cross-references, dimensioning conventions, the quality checks a set must pass, and the project's prompt history kept in the file. Use this whenever you are asked to make, extend or check a drawing set, plans/elevations/sections/details at CD quality, a wall section or detail, keynotes or a legend, a title block or office standard, or when an architect gives you a sketch or a written brief and expects drawings back. Also use it when turning a PDF drawing set into a model, and when reading or answering the prompts saved in a project file.
---

# Construction document sets

A drawing set is a **navigation system for the people who build**. Every mark
exists so a contractor, an estimator or a trade can find an answer quickly and
without ambiguity:

| Mark | Answers |
|---|---|
| Grid | Where, in plan |
| Level head, spot elevation | How high |
| Section and elevation flags, detail bubbles, callout boxes | Where to look next (4/A501) |
| Keynote, note with leader | What it is, and which spec section governs it |
| Dimension string | How much, and measured from what |
| Tags (room, door, window, wall type) | Which row of which schedule |
| Title block | Which drawing this is, what issue, who is responsible |

The more systematic the set, the less time is lost finding things, and the
freer the design can be: the system carries the routine. Drawings and
specifications complement each other. **Drawings** show quantity, location,
size and relationship. **Specs** set quality, materials, products and
execution. Nothing is said in both places, and nothing contradicts.

## Roles: the architect curates, Claude produces

Architects do not want views and sheets for their own sake. They want design
information to reach contractors, cost planners and clients. The architect's
job is the design and the **plan of the set**; producing the set is Claude's.
Think of the architect as curator of the set, the way an art director works
with a designer in Illustrator or InDesign.

**The architect:**

- designs, by sketch, description, model edits and markup;
- sets the plan of the set: which sheets, what each must communicate, and at
  what scale;
- supervises and corrects through the Prompt panel.

**Claude, without being asked:**

- makes and maintains every view the set needs: plans per level, elevations
  per façade, sections through what matters, callouts where the assemblies
  change, and schedules;
- makes and keeps the sheets:
  - places the views;
  - numbers views and sheets;
  - keeps every cross-reference current;
  - adds and removes views as the design changes;
- keeps the set graphically consistent.

The architect never has to make a view, place a viewport, number a detail or
fix a bubble. If they have to, the system has failed. When the design changes,
Claude reports the impact in terms of the set, e.g. "3 details and 2 sheets
changed; 1 new callout", not in terms of files.

### The set as graphic design (page composition, like InDesign)

- **Sheet grid.** Each sheet is laid out on a grid. Viewports align to it, and
  titles align to one baseline across the whole set. Plans of different levels
  sit in the same place on their sheets, so flipping between sheets does not
  make the building jump.
- **Line hierarchy.** Cut lines are heaviest; beyond, projection, then hidden
  and annotation get lighter. Poché and hatch are chosen so the drawing reads
  at arm's length before it is read up close.
- **Type hierarchy.** Sheet title, then view title, then notes, then
  dimensions. One family, few sizes, used the same way everywhere.
- **Composition and white space.** Notes are stacked and aligned in columns
  beside the drawing. Leaders do not cross each other or the drawing's main
  lines. Keynote legends sit in the same place on every sheet. There are no
  crowded corners and no empty sheets.
- **Colour** is used deliberately, only when the office uses it (e.g. a
  presentation set or phasing). The same colour means the same thing on every
  sheet.
- **Set-wide consistency.** One standard applies to every view and sheet, and
  Claude audits it across the whole set, not sheet by sheet.

## The brief (what the architect expects)

The architect gives:

- a description;
- a sketch or two;
- the basic detailing intent in plain words, e.g. "metal stud, rigid outboard,
  standing seam", "slab on metal deck", "storefront in the inner half of the
  siding";
- corrections as the work goes.

Claude produces:

- a parametric model;
- the full set drawn from that model, at the scale and quality of the office's
  sample sets;
- the office's branded CAD standard applied throughout, on top of industry
  conventions.

Where the brief is silent, Claude chooses the industry default, lists it as an
assumption, and does not stop to ask unless the decision changes the design.

## The standards stack

- **CSI MasterFormat** governs the spec sections and their numbers. Keynotes
  carry the section number and use its terms, e.g. 07 21 00 Thermal
  Insulation, 07 41 13 Metal Roof Panels, 08 41 13 Aluminum-Framed Entrances
  and Storefronts, 09 29 00 Gypsum Board. Every note leads to a spec section.
- **US National CAD Standard** (AIA CAD Layer Guidelines, Uniform Drawing
  System, Plotting Guidelines) governs:
  - sheet identification and order, e.g. G-001, A-101, A-201, A-301, A-501,
    A-601;
  - drawing types per series;
  - layers, symbols, line weights and text.

  The office brand is laid over NCS; it does not replace it.
- **Codes** (IBC or IRC, ANSI A117.1) govern code plans, egress, rated
  assemblies (UL numbers on wall types) and accessibility clearances.
- **ASTM, AISC, ACI and the other material standards** govern references and
  designations, e.g. W14x22, HSS 10x10x1/2, ASTM A992, 4 1/2" concrete on
  1 1/2" metal deck. Architectural sheets name them correctly and defer to the
  structural drawings ("SEE STRUCTURAL").

### UDS set structure and customary scales (imperial; metric in brackets)

| Series | Contents | Scale |
|---|---|---|
| G-0xx | Cover, sheet index, abbreviations, symbols legend, general notes | – |
| C-/L- | Site and landscape, by others or coordinated | 1" = 20'-0" (1:200) |
| A-0xx | Site plan, code plan | 1" = 20'-0" or 1/16" (1:200, 1:100) |
| A-1xx | Floor plans, roof plan, reflected ceiling plans | 1/8" (1:100) or 1/4" (1:50) |
| A-2xx | Exterior elevations | 1/8" (1:100) |
| A-3xx | Building sections | 1/8" or 1/4" (1:100, 1:50) |
| A-4xx | Enlarged plans, stairs, toilets, wall sections | 1/4" to 1/2" (1:50, 1:20) |
| A-5xx | Details | 1 1/2" or 3" (1:10, 1:5); 1" (1:10) for vertical details |
| A-6xx | Schedules: door, window, finish, wall types | – |

A given office numbers sheets its own way (the Frank Harmon sets put plans on
A2xx and elevations on A3xx). Read the office profile first. Its numbering
wins, but it must still be one consistent system.

## Order of work: model first, then views, then annotation

1. **Project set-up.** Load the office profile (see below). Set units, the
   survey datum, levels, and grids with names.
2. **Assemblies as types**, read from the detailing intent. Wall, floor, roof
   and ceiling types are layered, each layer with its material, thickness and
   function (Finish, Thermal/Air, Substrate, Structure). Each material carries
   its CSI section and its keynote. The details are the specification of the
   assemblies, so write the types from them.
3. **The model.** Build walls from a base level to a top level (or attached to
   the roof), then floors with openings, roofs by footprint, structure,
   openings with families, curtain walls with real grids (mullions and
   transoms, trimmed by gables), stairs counted from levels, and ground from
   contours. Joins must mitre. One model answers every sheet, so a
   contradiction between sheets cannot happen.
4. **Views.** Create plans with view ranges, elevations, building sections,
   wall sections, and details as **callouts** of the sections. Each view gets
   its scale, view style and crop, from the profile's view templates.
5. **Sheets.** Place views on the title-block family by the series table.
   Viewports align across sheets (plans stack on the same grid).
6. **Annotation.** Add grids and levels (these come from the model), then
   dimensions, keynotes and notes, tags, spot elevations and callouts.
   Annotation sizes come from the profile at paper size. It is never scaled
   per view by hand.
7. **Schedules.** Doors, windows, room finishes and wall types, read from
   parameters.
8. **Checks** (below), then a visual review of every sheet, then hand-over
   with the list of assumptions.

## The office profile is data

One object per office, swappable. It holds:

- **Title-block family**: lines, text, smart fields, show/hide parameters.
- **View-title family**: number in a circle, name on a rule, scale below.
- **Fonts and text types**: cap heights at paper size, e.g. 3/32" (2.4 mm)
  notes and 1/8" (3.2 mm) titles.
- **Pen table**: line weights by category and by cut versus projection.
- **Dimension type**: arrow or tick, text height, units such as ft-in to 1/16"
  or mm.
- **Level, grid, section and callout symbol styles.**
- **Sheet numbering and naming.**
- **View templates**: plan, elevation, section, detail and site; what each
  shows and how cut materials are drawn (outline, poché, hatch).
- **Keynote library**: CSI number, short text, full text.
- **Detail-component library.**
- **Standard notes and abbreviations.**

In this code base, `fhaProject()` (`src/sample_fha.js`) is the Frank Harmon
profile, and `src/titleblocks.js` holds the title-block families. Put new
offices in the same shape; never scatter one office's standard through the
drawing code.

## Details are model cuts plus detail components

A detail is a callout of a section at 1" = 1'-0" or larger. What the model
cuts, the model draws: wall layers, slab and deck, beams, curtain-wall
mullions, roof, soffit, ceiling. Everything else is a **parametric detail
component bound to the assembly it sits on**:

- **Insulation**: batt or rigid runs drawn with the insulation tool at the
  cavity width, never loops drafted by hand.
- **Profiles**: flashings, sills, heads, jamb trim, angles (e.g. L4x3x1/4),
  blocking, nailers, gutters, copings and closures. Each is a family placed on
  an assembly edge (sill of an opening, top of a wall, slab edge), so it moves
  and resizes with that assembly.
- **Hatches**: material hatches by material, e.g. concrete aggregate, earth,
  gravel, rigid insulation.
- **Structure beyond**: columns and joists seen past the cut are the model's
  projection, not lines.

Reusing a detail in a new project must place the same components on that
project's assemblies. Traced linework does not transfer. Use it only as a
stop-gap, and say so.

## Keynotes and notes

- **Keynote from the material.** A material or assembly layer carries its CSI
  number and keynote text. A keynote tag reads it and never types it. A legend
  on the sheet lists only the keynotes used on that sheet.
- **Industry language**:
  - "5/8" GYP BD ON 1 1/2" METAL HAT CHANNELS @ 24" O.C.";
  - "SEE STRUCTURAL";
  - "BY OWNER";
  - "TYP."
- **Leaders** land on the thing described, with an arrow on an edge and a dot
  on a surface. Notes stack left or right of the drawing, aligned, with even
  spacing.

## Cross-references

- Every section flag, elevation tag and detail bubble shows the view number
  and sheet of its target, and each resolves to a real view on a real sheet.
- Every view title shows its number and scale.
- There are no dead or circular references. A callout's boundary on its parent
  is the detail's crop, or the region drawn round it.

## Dimensioning by convention

- **Plans**, from the outside in: overall; then grid to grid; then openings
  and wall faces. Strings go to grid lines and structure, or to finish faces
  as the office standard says. Interior strings go to the faces the profile
  names (face of stud or face of finish).
- **Sections and details**: vertical strings from level to level, heights to
  top of slab and top of steel, spot elevations in the office format (e.g.
  ELEV = 359'-0"). Details dimension what the builder sets out (an offset from
  grid to face of sheathing), not what the product fixes.
- **Where dimensions attach**: a dimension binds to model references (grids,
  faces, levels) so it updates with the model. A witness line is only used
  where the model holds nothing to bind to.

## Quality checks before hand-over

Each check is automated where possible:

- **No overlapping text** on any sheet, measured with the real font widths:
  `test/text_overlap.test.mjs`. Grid-bubble, marker and tag text must fit its
  symbol; shrink the text or widen the symbol, but never let it overflow.
- **Cross-references resolve.** Views on sheets are numbered, and there are no
  orphan callouts.
- **Keynotes:** every keynote has a CSI section, and every material used has a
  keynote.
- **Walls join and mitre.** There are no gaps, no overlaps, and no layers
  running through a corner.
- **Dimension values** agree with the model. An overridden value is flagged.
- **Every view on a sheet is cropped.** Annotation stays inside its crop, and
  viewports align.
- **Code:** rated assemblies carry their rating, and egress widths are met
  where a code plan is in the set.

Then **look**:

- render every sheet;
- overlay it on the source or reference where there is one (red for mine,
  blue for the reference);
- zoom to 1:1 on details.

"It looks right" in code is not evidence.

## Lessons from turning PDF sets into models

These come from rebuilding the Frank Harmon sets (Casa Mazatlan, AIA NC,
Schaeffer, Walnut Creek, First Presbyterian); see `webbim/tools/fha/`.

1. **Measure, never estimate.** Read line positions, text origins, grid
   spacings and level values from the PDF's vectors (`fhax.py`, `hl.py`-style
   scans). Eyeballing is off by millimetres, and at 1:12 that shows.
2. **Overlay proof.** Render the sheet, overlay it on the PDF page, and fix
   what is red or blue. Each round finds real errors: a roof 6" low, a beam
   that does not exist, a level written twice.
3. **The office standard is its own layer.** Lift it first: the title block
   (`tbx.py`) and the view title, level, section and dimension styles. After
   that every sheet reads as the office's.
4. **The details specify the assemblies.** Read the wall and floor layers from
   the detail notes, then rebuild the model; plans and sections follow.
5. **Sets contradict themselves.** Examples: a roof 3" apart between A403 and
   A501, and grid B called C in the details. Record the conflict, choose one
   value in the model, and say which.
6. **Tracing is fidelity, not intelligence.** `dlift.py` lifts what the
   model's cut does not draw as 2D detail components; batts become insulation
   runs, and PDF tiling hatches become tile patterns. It proves the model
   against the PDF. It is the wrong end state for new work, which needs
   parametric components.
7. **Fix the engine, not the view.** Mitres, bubble text and annotation scale
   were sometimes tuned per view, and that hid bugs. Annotation must size from
   the profile and the paper, once.
8. **A PDF's words can double the model's.** Level heads, grid letters, view
   numbers and scale lines lifted from a PDF duplicate what the model already
   draws. Skip them in the lift, and prove it with the overlap check.

## The prompt panel and the project's conversation

The architect gives feedback inside the app. The **Prompt** panel takes text,
images (dropped, pasted or captured from the current view) and the context
(active view or sheet, selection). Each prompt is saved **in the project
file**, in `meta.prompts`:

```json
{ "version": 1, "entries": [
  { "id": "P3", "parent": null, "at": "2026-09-30T17:20:00Z", "author": "architect",
    "text": "Grid bubble text too big on A201", "status": "open",
    "context": { "view": "V-P1", "sheet": "A201", "selection": ["G-3"] },
    "images": [{ "name": "a201.jpg", "type": "image/jpeg", "w": 1600, "h": 1067, "data": "data:image/jpeg;base64,..." }] },
  { "id": "P4", "parent": "P3", "author": "claude", "text": "Fixed: bubble text fits its circle.", "status": "answered", "at": "..." } ] }
```

Entries form a tree through `parent`. A root is a topic; replies and
follow-ups nest under it.

When a project file is handed to Claude:

1. Read `meta.prompts`.
2. Work the entries whose status is `"open"`, oldest first. Use each entry's
   context to open the right view, and read its images.
3. Answer each by appending an entry with `author: "claude"`,
   `parent: <its id>`, what was done and what is assumed. Then set the
   original's status to `"answered"`.
4. Never rewrite or delete the architect's entries. The history is the
   project's record.
5. Save the file, so the next session and the architect see the same thread.
