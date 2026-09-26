---
name: model-narrative-site
description: Build a scroll-driven, parallax "narrative" website (Seasats-style) whose 3D background is a parametric CAD model rebuilt live in the browser by the Feature Modeller's OpenCascade kernel, with no modelling UI on screen, plus an optional Sphere-World-style selector that leads into each story and back. Use this whenever someone gives you an ocaf-parametric-model JSON (a Feature Modeller file, "sample", sketcher.json, a tower or BIM export) and wants it shown as a story, landing page, product page, scrollytelling site, 3D showcase or portfolio piece; when they point at a parallax 3D site and say "do something like this with my model"; when they ask to add another sample/project to an existing sample world; or when a model-driven page renders wrong (jittering at survey coordinates, a ghosted layer hiding a sketch, a washed-out white-on-white scene, a slow build with a blank screen). Also use it for the openshapefactory web/ folder (sketcher-narrative, towerc, the selector).
---

# Model narrative sites

The job: a person hands you a parametric model file and a reference site.
You build a page where **the model is the background and the story decides
how it is rendered**. Each chapter shows one step of the model's own history
(datums, sketch, extrude, Boolean, fillet, placement), with the camera and
render style changing as you scroll. Every number on the page comes out of
the kernel. You may also build a selector: a world where each sample is a
wall of animated cubes, and entering one opens its story.

Two finished examples are in `assets/`, taken from the openshapefactory repo
(`web/`). Start from them rather than a blank file, because they already
solve the problems listed below:

- `assets/narrative-small-model.html`: 13-feature bracket, dark studio look,
  whole model in one `loadModel`, parametric variants via `setParameter`.
- `assets/narrative-large-model.html`: 1,426-feature tower, white fog look,
  survey rebase, chunked build by level, elevation staff, section cut-away.
- `assets/selector-sphere-world.html`: white monochrome Sphere World,
  thumbnail → cube wall, drag/wheel/keys, open animation, fade to the story.

## 0. Pin the inputs before writing anything

Ask or check, because the first attempt in the original session went to the
wrong "sample":

- **Which model?** Words like "the sample called X" can mean an uploaded
  `.json`, a Feature Modeller artifact, or code in the repo. Look for uploads
  and list the user's artifacts (`Artifact` `action: "list"`) before guessing.
  The file you want has `"format": "ocaf-parametric-model"`.
- **Which kernel?** The Feature Modeller artifact carries it. Read that
  artifact (`action: "read"`) to get its saved HTML path, then run
  `scripts/extract_kernel.py <html> <site>/kernel/`. Copy `scripts/kernel.js`
  in beside those files.
- **Which look?** The reference site sets the structure: fixed canvas,
  full-height chapters, copy on one side. The user's words set the palette
  (for example "white foggy monochrome"). Keep earlier pages when adding new
  ones. "Don't destroy the previous page" means a new artifact and shared
  files, not an edit to the old one.

## 1. Probe the model with the real kernel

Serve the site folder (`python3 -m http.server 8765`, run in the background),
put `scripts/probe.html` next to `kernel.js`, and run:

```
node scripts/probe_model.mjs http://localhost:8765/kernel/ ../path/to/model.json
```

It reports build time, failures, triangles and edges per feature, the
bounding box, and a float32 warning. Read `references/kernel-api.md` for the
call surface and mesh format. **Plan the story from this output, not from
reading the JSON.** It tells you which features produce faces, edges or
points, how big the model is, and how long the build takes:

- **Under ~3 s:** build it whole, as in the small-model example.
- **Longer:** build in chunks so the model appears while it builds, as in
  the large-model example. See `references/large-models.md`.
- **Any point beyond about 1e6 mm:** rebase before building. See
  `references/large-models.md`. This is not optional: at 2.49e9 mm, float32
  steps are 256 mm.

## 2. Write the story from the feature tree

A chapter per meaningful stage of the model's history, in document order.
Typical beats:

1. **Opening:** the finished model and a live kernel status line.
2. **Datums:** points, vectors and planes.
3. **Each sketch:** drawn on in plan or elevation over a grid.
4. **Each extrude:** growing out of its plane.
5. **Booleans:** crossfade from the inputs to the result.
6. **Finishing operations:** fillets and placements.
7. **Change a parameter:** real `setParameter` rebuilds, precomputed.
8. **Ending:** the file size and feature count, and links (back, source,
   modeller).

Copy should name real feature ids (EX1, NU1 → EX1 → BO1 → FI1) and quote
figures filled in from the kernel's answers (`data-fig` spans). A side rail
with the feature tree, or an elevation staff for buildings, acts as the index
and shows build progress. Keep it a table of contents, not an editor.

Read `references/narrative-engine.md` before writing the page. It covers the
scroll → continuous chapter index, `ramp`/`band` visibility, camera shots
derived from the bounding box, and the render role for each feature type.

## 3. Selector (when there is more than one sample)

Read `references/selector.md`. Items are data rows (id, title, category,
count, blurb, href, thumb). Thumbnails come from each narrative's own poster
frame:

```
node scripts/shots.mjs <url> out 0 --poster
python3 scripts/make_thumb.py out-poster.png thumbs/<id>.png [--invert]
```

Use `--invert` when a dark page goes into a white world.

Pages link with relative URLs. Leaving fades through a white veil. The
selector reads `#<id>` so "← Samples" returns with that sample in front.

## 4. Verify by looking, once per page

Use `scripts/shots.mjs <url> <prefix> 0,1,2,... [--mobile]`, then tile the
PNGs into one contact sheet and read it. Sandbox realities:

- **three.js:** cdnjs is blocked, so run `npm pack three@0.128.0` and extract
  `package/build/three.min.js` where you run the script. The script routes to
  it.
- **Speed:** WebGL is CPU SwiftShader. Keep the viewport small and timeouts
  long. A 30 s screenshot timeout is the renderer, not the page.
- **Rebuild timing:** a big model rebuilds on every page load (~30 s for
  1.4k features here), so batch all the shots for that page into one run.

Check for these, which each broke once in the original session:

- **Framing:** the model is cropped or sits under the copy. Pull shots back
  by multiplying the offset from the target, and use a smaller view offset.
- **Fog:** it swallows a white model. Push fog near/far out in terms of the
  model's size S.
- **Stacked translucency:** sixty 14%-opacity layers make an opaque wall.
  Hide what is above a section instead.
- **Straight-down views:** with Z up, a `lookAt` that points straight down
  flips. Keep some horizontal offset.
- **Washed-out render-target pages:** colours gamma'd twice. Don't `pow(1/2.2)`
  in the post pass for sRGB-authored colours.
- **Clipped display titles:** a missing condensed font falls back wider. Give
  the title box an explicit width.

## 5. Ship

- **Repo:** keep the kernel in one shared folder (`web/kernel/`), one folder
  per narrative, `web/index.html` as the selector, and `web/README.md`
  listing them. Commit and push.
- **Artifact:** run `scripts/stage_artifact.sh <site> index.html <stage>`,
  then publish `<stage>/<name>.html` with `files` mapping every other file to
  its relative path. `.gz` files go with `contentType: "application/wasm"`.
  Each binary is capped at 15 MB, so ship the kernel gzipped. The published
  main page *is* `index.html`, so secondary pages link back with
  `../index.html`. Never map another file to that path. You can't test
  multi-page navigation inside an artifact from here, so say so and ask the
  user to click through once.
- **Shell safety:** `rm -rf $VAR/...` is blocked by the safety check. Use
  literal paths or `"${VAR:?}"`.
- **Report:** give the artifact link, what the kernel measured (build time,
  triangles), and anything you changed about the model to render it, such
  as a rebase. Say this on the page too.
