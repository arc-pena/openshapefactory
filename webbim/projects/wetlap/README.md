# Wetlap Residential Development: a project file rebuilt from its PDF

This folder holds the Techne Architecture + Interior Design Design Development
set, part 1 (38 A1 sheets, 25/03/2021). It was rebuilt as a web-bim model with
its sheets. It is **not** a sample and is not on the File menu. Open
`wetlap.json` with **File › Open**.

## What is in the file

- **The office profile (Techne, Australian practice).**
  - A1 sheets with the Techne title strip.
  - Swiss 721 Condensed, drawn as Arial at 0.81 width.
  - RLs in mm on the AHD. The model's zero is RL 25600, the apartments'
    ground floor.
  - Level heads read RL, ▽, name, at the right.
  - Grid heads are 9 mm. Dimensions use oblique ticks, in mm.
  - Existing work is solid black; new concrete is outlined black; partitions
    are outlined grey.
- **The model.**
  - 12 levels, for the apartments ("NORTH") and the lofts.
  - Grids 1–19 and A–K.
  - About 4,600 walls, taken from the cut lines of the GA plans. Each runs
    from its level to the next.
  - The existing brick piers and columns, and a slab on each level.
  - A 3D view (`V-3D`).
- **The sheets.** All 38, numbered and named as in the set.
  - Each plan is a live plan view of its level, placed where the set places
    it. Its notes, window and door tags, dimensions and bubbles are
    annotation.
  - The grids stop and start where the sheet draws them, with each head at
    the drawn end.
  - What the model does not draw becomes the view's drafted layer, pen for
    pen: joinery, fixtures, finishes, door swings, stairs, site boundary.
  - The elevations and the site and location plans are shaded raster in the
    PDF. They are laid on their sheets as images, with the words over them as
    live text.

## Known limits

- **19 sheets are cut off in the PDF.** Pages 6–12, 15–18, 22–24 and 26–30
  show only the left 595 mm of the 841 mm sheet. Their right-hand parts are
  missing from the PDF, so the drafted layer stops there. The model's walls
  also stop there on those levels. An uncropped export would complete them.
- **Openings are gaps, not doors or windows yet.** The plans show the swings
  and frames (drafted), and the walls stop at the openings. Door and window
  elements with their types (DT06, WT01…) are the next step.
- **No roofs or sections yet.** Part 1 has no sections, and the roofs are only
  in the elevations.
- **The elevations are the set's images plus text.** They are not model
  elevations yet.

## Rebuilding

The PDF is read once into `data/`, then the builder runs:

```sh
cd tools
python3 wlx.py <set.pdf> ../data/wl_x.json      # words, dimensions, bubbles in sheet space
python3 wtbx.py ...                              # the title strip family (see tb_cfg.json)
python3 mkset.py                                 # -> data/wetlap_set.json
python3 wlift.py 1-38 ../data/wl_lift.json       # walls, poche, drafted layer per page
python3 rast.py 1-38 ../data/raster 6            # each page's raster layer, composited
cd .. && node build.mjs --pdf A0100,A0800        # -> wetlap.json (+ out/*.pdf to check)
python3 tools/ovs.py out/A0100.pdf 8 100 0,0,841,594 check.png   # overlay: red ours, blue the set
```

The tools in `tools/`:

- `sheetspace.py`: normalises every page (rotated, turned, shifted) to A1
  landscape sheet mm.
- `wlift.py`: reads the plans' pens.
  - 0.48 pt black is a cut concrete face; 0.48 pt grey is a cut partition
    face.
  - Two parallel faces 50–400 mm apart make a wall.
  - Black poché is split by the page raster, because the PDF clips it.
- `rast.py`: composites Revit's image tiles into one image per page.
- `ovs.py`: the overlay proof.
