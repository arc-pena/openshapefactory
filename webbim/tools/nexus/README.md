# Nexus: digitising the level plans

The Nexus sample (`src/sample_nexus.js`) is built from seventeen level plans, `A2_2000_L0.pdf` … `A2_2000_L16.pdf`
(A2 sheets drawn at 1:2000). These scripts read them and write `src/nexus_data.js`.

What is read:

- **The mesh.** The red dash-dot lines (0.24 pt) are not grid lines but a 2D mesh of cells. Each dash is a separate
  path in the PDF, so dashes are grouped into straight edges, snapped into nodes at corners and T-junctions, and the
  cells are traced as the faces of that planar graph. 777 nodes, 319 cells.
- **The site.** The heavy red chain (1.42 pt) is the site boundary; the light one (0.71 pt) the setback line.
- **Which cells each level uses.** Ground floor: the plan is a raster, so coloured pixels are matched to the plan's
  programme palette. L1–L3: the programme fills. L4–L16: the closed black plate outlines (0.85 pt). A cell at least
  half covered is used whole (`1`). On the tower levels a cell partly under a plate whose centre falls in it is used
  in part: `[s, dx, dy]`, the cell scaled by `s = √coverage` about its centroid and moved `dx, dy` mm to the centre of
  what is drawn inside it, so it follows the cell when the mesh is edited.
- **What the plans name.** Lift labels (FOH / Service) banked by position into lift cores, running up while there is
  floor under them; the courts labelled Atrium (their drawn outline as the void); the MEP risers.
- **The reference.** The drawn zones (L1–L3), plate outlines (L4–L16) and labels, kept so the mesh can be checked
  against the drawings in plan.

Levels: ground floor L00 at 0, L01 at +8 m, then 6 m a storey.

## Run

```bash
export NEXUS_PDFS=/path/to/the/pdfs NEXUS_WORK=/path/to/a/work/dir
mkdir -p $NEXUS_WORK/svg
for f in $NEXUS_PDFS/*A2_2000_L*.pdf; do n=$(echo $f | sed -E 's/.*_L([0-9]+)\.pdf/\1/'); pdftocairo -svg $f $NEXUS_WORK/svg/L$n.svg; done
python3 extract_mesh.py      # -> mesh_raw.json   (from svg/L5.svg: a tower level shows the whole mesh)
python3 extract_site.py      # -> site_1.42.json, site_0.71.json
python3 levels.py            # -> nexus_data.json (needs numpy, Pillow, pdftoppm, pdftotext)
python3 make_data_js.py      # -> ../../src/nexus_data.js
```
