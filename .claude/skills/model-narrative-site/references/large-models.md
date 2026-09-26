# Large models: rebase, chunk, cut away

This comes from Tower C (`3399-ZHA-M3-A-1000-TowerStructure`): 1,426
features, 8.3 MB of JSON, ~27 s to build in one go. The working code is in
`assets/narrative-large-model.html` (`rebase`, `planChunks`, `addFeature`).

## Rebase before building

BIM exports often place geometry at survey coordinates. Here the slab plane
origins sat at x ≈ 496,554,877 mm, y ≈ 2,492,167,831 mm. The kernel returns
float32 meshes, and float32 at 2.49e9 has a 256 mm step, so slab edges visibly
jitter. The GPU can't fix that, so fix the input:

1. Find the target origin. Here it was the `AxisSystem` whose origin point is
   beyond 1e7: the placement the columns are moved *to*.
2. Subtract it from every `Point` of kind `Coordinates` whose |x| or |y| is
   beyond 1e6. Sketches live in their planes' own coordinates and move with
   the planes. No other feature carries absolute positions in these files.
   Check any new file for exceptions with the probe's warning.
3. Keep the offset and the placement angle
   (`atan2(xdir.dy, xdir.dx)`, 0.978° here) to quote on the page. Say on the
   page that the origin was moved and why. The shapes don't change.

## Build in chunks so it rises while it builds

`loadModel` replaces the whole document, which is exactly what makes
chunking easy. Build a subset, mesh it, keep the triangles on the page, then
load the next subset:

- **Units of work:** the level folders, meaning the `GeometricalSet` whose
  children have level-like names (`B3`, `F9`, `F65E`, `RFW`, …). Get each
  level's elevation from its first non-opening sketch's plane origin `z`.
  Folders with no sketches (columns under `B3`) form the first chunk.
- **Closure per chunk:** take the level folders, all their descendants and
  everything they reference, recursively. Then add the **ancestor folders
  only** (walking up `parent` without adding siblings), or the tree won't
  load. Keep the original feature order and filter `hidden` to the subset.
- **Bands:** about 9 levels each, sorted by elevation, which gave 10 chunks.
  Shared datums are rebuilt in each chunk, so cap progress counts at the
  file's total.
- **What to draw:** the "leaves" (`Extrude`/`Boolean`/`AxisToAxis` that
  nothing references and that aren't hidden). Also mesh on purpose what a
  chapter needs: the typical floor's sketch, slab, opening and Boolean, and
  the unplaced column extrudes.
- **Progress:** each band's arrival darkens its ticks on the elevation staff,
  and the status line counts features. The opening chapter shows the tower
  rising.

The chunked build took about the same total time (~30–33 s) as one
`loadModel`, but something is on screen within a few seconds.

## Typical-element chapters

Pick one representative element (the level about 35% up with exactly one
opening). Look up its sketch, opening sketch, slab extrude, opening extrude
and Boolean by `args.profile.ref` / `args.a.ref`. Its slab extrudes *down*
from the plane: the bounding box z was 42.4–43.4 m for a plane at 43.4 m.
Check the direction from the mesh bounding box before animating growth.

## Performance notes

- Tower C drew 129k triangles plus edges as ~170 meshes, which is fine on a
  GPU.
- SwiftShader (the headless test renderer) needs several seconds per frame at
  full HD. Test at 1100×690.
- Keep one shared material per role and swap `mesh.material` per frame
  (floor, west-crown floor, ghost) rather than cloning per mesh.
