# Wetlap Residential Development: a 3D model rebuilt from its PDF

This folder holds the Techne Architecture + Interior Design Design Development
set, part 1 (38 A1 sheets, 25/03/2021), rebuilt as a web-bim model. Every
sheet is a view of that model. It is **not** a sample and is not on the File
menu. Open `wetlap.json` with **File › Open**.

Nothing on the sheets is traced. The PDF is read only to measure from:

- positions, pens and hatch steps;
- the set's tags and their leaders;
- window heights and finish shades from its elevation images, at build time.

What a sheet shows is drawn by model elements, or is an annotation of them.
There are no detail lines, filled regions, symbols, imported CAD or pictures
anywhere. What a view owns is only text, dimensions bound to model elements,
and tags of model elements. A floor's pattern in plan is the floor material's
surface pattern. `node audit.mjs` checks all of this and fails on anything
drafted.

## What is in the model

- **The office profile (Techne, Australian practice).**
  - A1 sheets and the title strip; mm units.
  - RLs on the AHD. The model's zero is RL 25600.
  - Level heads read RL, ▽, name.
  - Grid heads are 9 mm. Dimensions use oblique ticks.
  - Existing work is solid black. New concrete is outlined black. Partitions
    are outlined grey.
  - Lettering is Swiss 721 Condensed (Arial at 0.81 width).
- **Levels and grids.** Levels for both buildings (the apartments, "NORTH",
  and the lofts), and grids 1–19 and A–K. Each view draws its grids where the
  set does.
- **Walls.** Taken from the plans' cut lines, from each level to the next.
  - Existing brick piers and columns come from the poché.
  - The existing north façade's two gables are its Level 3 walls' top profile.
  - Glass balustrades run along the free edges of the balconies and
    terraces.
- **Floors.** Each level's plate is the union of what stands and is finished
  on it. Floor finishes are finish floors whose material carries the set's
  boards, tiles or pavers as a surface pattern, set out on the set's lines.
- **Doors and windows.**
  - A door stands wherever the set draws a swing. Its hand and facing come
    from the arc.
  - Windows and sliding doors stand at the tagged openings and between the
    existing piers. Their sills and heads are measured off the set's
    elevations.
  - Each carries its mark and type (A.G.23 / WT01), and its tag is the
    model's own.
- **Fixtures and joinery.** WCs, basins, baths, kitchens, islands, vanities
  and wardrobes are instances of family types made from the plans' symbols.
  Each type has a plan symbol and a 3D body.
- **Finishes.** The elevations' finish tags (XREN-02, XMT-01…) paint the
  surface they point at with a material of that code. The tags are the
  model's material tags.
- **Site.** The site boundary comes from the grid setout, plus the ground
  under it.
- **Views.**
  - 30 plans and RCPs, placed where the set places them.
  - 7 elevations, which are views of the model.
  - A 3D view.

## Known limits

- **19 sheets are cut off in the PDF.** Pages 6–12, 15–18, 22–24 and 26–30
  show only the left 595 mm of the 841 mm sheet, so the model stops where
  those plans stop. The apartments' east end is the most affected. An
  uncropped export would complete it.
- **Not modelled yet:**
  - stairs, lifts, ramps;
  - planters and screens;
  - RCP ceilings and lights;
  - roofs over the new levels;
  - the lofts' façade fins and panels;
  - the site and location plans' context (adjacent buildings, streets).

  Those sheets show only what the model has.
- **Four sheets are notes only:** A0000, A0001, A0010 and A0055. Their
  drawings (the cover, the site context, the demolition elevations) need
  context and demolition modelling that is not done yet, so they carry the
  set's text and nothing drafted.
- **78 dimensions are left out.** One or both of their ends do not land on
  a model element.
- **Fixture types are many** (one per distinct symbol). Similar symbols are not
  yet merged into one family.

## Rebuilding

```sh
cd tools
python3 wlx.py <set.pdf> ../data/wl_x.json      # words, dimensions, bubbles in sheet space
python3 mkset.py                                 # -> data/wetlap_set.json (title strip from wtbx.py)
python3 wlift.py 1-38 ../data/wl_lift.json       # walls, poche, and the linework to read elements from
python3 fixtures.py 7-19 ../data/wl_fix.json     # fixture families and instances
python3 finishes.py 7-19 ../data/wl_fin.json     # finish regions and their patterns
python3 slabs.py ../data/wl_slab.json            # floor plates, balustrade edges
python3 site.py                                  # site boundary
python3 rast.py 36-38 ../data/raster 6 && python3 rawgray.py   # elevation images, for measuring only
cd .. && node build.mjs --pdf A0100,A0800        # -> wetlap.json (+ out/*.pdf)
node audit.mjs                                   # the model-only test: PASS or the list of drafted elements
python3 tools/ovs.py out/A0100.pdf 8 100 0,0,841,594 check.png # overlay proof: red ours, blue the set
```
