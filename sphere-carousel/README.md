# Sphere World — carousel navigation

A Three.js reimplementation of the sphere-world navigation pattern: the camera
sits at the **centre of a sphere**, the items live on its **inner surface**, and
dragging rotates the world so the next item swings in from the right or left and
snaps to centre. Moody, game-like, no image assets.

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # dist/
```

Drag, scroll, arrow keys or the ticks on the right to travel. Enter / click the
centred panel to open it, Escape to close.

> **Provenance.** The reference site (rogierdeboeve.com) is blocked by this
> environment's network egress policy, so its bundle was never fetched, read or
> decompiled. This is a from-scratch reconstruction of the *mechanics* as
> described, not a copy of anyone's code, and none of the content, artwork or
> copy is theirs.

## How the navigation works

The entire interaction is **one scalar**, `position`, measured in items
(`src/nav/SphereNavigation.js`):

```
yaw = -position * (2π / itemCount)
```

Item 3 is dead centre when `position === 3`. Because the panels are spread
evenly around a full revolution, `position` can run off in either direction
forever — that is what makes the carousel endless with no wrap-around
bookkeeping. Only the UI ever takes a modulo.

| Piece | Behaviour |
| --- | --- |
| `target` | What input devices write to. Drag adds `-dx * 1.35 / viewportWidth` items per pixel. |
| `position` | Chases `target` with `damp()` — frame-rate independent exponential approach, λ 16 while held, 5.2 once released. |
| Flick | On release the smoothed pointer velocity is projected forward (clamped to ±2.4 items), *then* rounded. That projection is what makes a quick flick skip two items and a lazy half-drag fall back. |
| Snap | `target = Math.round(target)` on release; wheel snaps 170 ms after the gesture goes quiet, so trackpads stay continuous. |
| Focus | `1 - smoothstep(0, 1.3, |ringDelta(position, i)|)` per panel — drives brightness, relief, rim and frame opacity. |
| Attract | 7 s idle and the world starts drifting on its own again. |

Everything else about the rig is there so it doesn't feel like a turntable:
pointer look-around (±3°), idle sway, and a roll into the turn proportional to
travel velocity.

## How the panels work

Each item is **not** a texture on a quad (`src/world/ItemPanel.js`):

1. Artwork is painted procedurally to a 2D canvas (`src/util/artwork.js`), then
   auto-levelled — the palettes are deliberately low-key, and a mosaic built
   from a flat dark image reads as a black wall.
2. The canvas is box-filtered down to one sample per grid cell (36 × 24) by
   letting the browser resample it.
3. Those cells become an `InstancedMesh` of boxes laid out on the sphere's
   surface, each pushed towards the viewer by its luminance and depth-scaled to
   match, with a travelling ripple on top.
4. A dim textured sphere-slice sits behind the grid so the gaps read as shadow
   rather than holes, and the brightest cells get additive nubs for the bloom to
   catch.

Two details that took the most iterations, both consequences of viewing from the
sphere's centre:

- **Emissive has to be tinted per instance.** three multiplies only the *diffuse*
  term by the instance colour, so any cube outside a lamp's reach goes black and
  the artwork falls apart. `onBeforeCompile` carries the instance colour on its
  own varying and multiplies `totalEmissiveRadiance` by it. (`vColor` can't be
  reused — it's a `vec4` and the fragment stage only declares it for `USE_COLOR`.)
- **Relief is invisible head-on.** The cubes extrude straight down the view ray,
  so the extrusion shows up only as *shading*: recessed cells are darkened by a
  luminance-derived occlusion factor, and the gap backing is kept darker than
  the cubes.

## World and grade

`WorldSphere` is a 320-unit shell rendered `BackSide` with a painted fragment
shader (three-stop sky ramp, drifting fbm cloud bank, horizon band, stars,
dither) — unlit, so its size costs nothing. `Atmosphere` adds dust that
counter-rotates against the camera yaw for parallax, a fading ground grid, and
the lamps: a dim one riding at the centre plus two orbiting accents that sculpt
the cubes. `PostFX` is bloom → a single grade pass (radial chromatic
aberration and a capped symmetric smear, both scaled by travel velocity,
vignette, grain, filmic contrast) → `OutputPass`.

## Performance

- Panels outside focus freeze: no per-instance matrix work for items behind you
  (~864 instances × 6, only 1–3 panels animate at a time).
- Panels are built one per frame during boot, so the main thread never blocks
  and the loading bar reflects real work.
- Sustained slow frames walk the pixel ratio down (`_trackPerformance`).
- Reduced-motion sessions get less bloom, less grain, no velocity FX, no drift.

## Tuning

| Knob | Where |
| --- | --- |
| Items per pixel of drag | `SphereNavigation.dragScale` |
| Snap / glide feel | λ values in `SphereNavigation.update` |
| Flick strength | `0.26` factor in `_onUp` |
| Mosaic resolution, relief | `ItemPanel` constructor (`cols`, `rows`, `cell`, `relief`) |
| Sphere radius, fog, exposure | `src/core/App.js` |
| Grade | `GradeShader.uniforms` in `src/post/PostFX.js` |
| Content | `src/data/items.js` |

## Verified

Built and driven in headless Chromium (Playwright): boot completes, drag
advances one item and snaps (`target` lands on an integer), arrow keys and the
tick rail travel the shortest way round, open/close locks and unlocks input and
dollies the camera, layout holds at 1440×900 and 390×844, no page or shader
errors.
