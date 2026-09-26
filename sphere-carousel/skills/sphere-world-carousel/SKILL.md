---
name: sphere-world-carousel
description: How to build a drag-to-rotate carousel whose camera sits at the centre of a sphere with the items on its inner surface - one scalar for the whole interaction, flick and snap, artwork rebuilt as instanced cubes, and the moody grade over the top. Use this for any change inside sphere-carousel/, whenever you are building a 3D carousel, slider or menu with inertia and snapping, whenever instanced colours render black or a texture comes out mirrored, whenever a WebGL scene keeps flipping between washed out and pitch black, and whenever a DOM caption laid over a 3D scene stacks up or disagrees with the scene.
---

# Sphere world carousel

`sphere-carousel/` is a Three.js study: the camera never leaves the centre of a
sphere, the items live on its inner surface, and dragging rotates the world so
the next one swings in from the side and snaps to centre. It ships with no
image assets — every panel is painted at run time.

## The loop

```bash
cd sphere-carousel
npm run build                 # vite -> dist/
npm run build:artifact        # + folds dist/ into one self-contained HTML file
npm run drive -- dist/sphere-world.html scenario.mjs         # real browser
```

`npm run drive` is `skills/sphere-world-carousel/scripts/drive.mjs`: it opens the
built file in Chromium, and hands a scenario module `state()`, `lines()`,
`drag()`, `step()`, `settle()` and `shot()`. It needs `playwright` (a
devDependency) and a Chromium — `PW_CHROMIUM=/path/to/chrome` pins one, and a
preinstalled `/opt/pw-browsers/chromium-*` is found automatically.

Then commit with the session trailer and republish the single file **to the
Artifact URL in README.md**, so the link the user already has keeps working.
Publishing without that URL makes a second artifact.

## The whole interaction is one scalar

`position`, measured in items. Item 3 is centred when `position === 3`:

```
yaw = -position * (TAU / itemCount)
```

Panels are spread around a full revolution, so `position` may run off in either
direction forever — that is what makes the carousel endless with no wrap-around
bookkeeping. Only the UI takes a modulo. Everything else falls out of it:

- **`target` is what input writes to; `position` chases it** with a
  frame-rate-independent `damp()` (λ 16 while a pointer is held, 5.2 once
  released), so the feel is identical at 60 and 144 Hz.
- **Snapping is rounding, but only after the flick is projected.** On release,
  add the smoothed pointer velocity × 0.26 (clamped to ±2.4 items) *then*
  `Math.round`. Round first and a quick flick can only ever advance one item.
- **Step from `target`, never from `position`.** `Math.round(this.position) + 1`
  looks right and is wrong: presses arriving before the world catches up all
  resolve to the same neighbour, so four taps on → move one item. Counting from
  `target` makes them queue.
- **Wheel writes continuously and snaps on silence** (170 ms after the last
  event), or trackpads fight the snap all the way.
- **Focus is angular distance, not an index test**:
  `1 - smoothstep(0, 1.3, |ringDelta(position, i)|)`. One number drives
  brightness, relief, rim, frame opacity and whether a panel animates at all.
- Grabbing sets `target = position` so the world stops dead in the hand.

Everything else about the rig exists so it doesn't feel like a turntable:
pointer look-around (±3°, scaled *down* while an item is open or the panel
drifts off-centre), idle sway, roll into the turn, and an attract drift that
resumes after 7 s of idle at 0.055 items/s.

## Panels: an image rebuilt as instanced cubes

Paint the artwork to a 2D canvas, let the browser box-filter it down to one
sample per cell (`drawImage` into a cols × rows canvas), then place one box per
cell on the sphere's surface, extruded by that cell's luminance.

- **Match three's sphere convention or the image mirrors.** A slice uses
  `x = -R·cos(phi)·sin(theta)`, `z = R·sin(phi)·sin(theta)`, so `u = 0` lands on
  screen *right*. Hand-placed instances must read the artwork column back to
  front (`cols - 1 - col`); a backing slice that flips `1 - uv.x` and a cube
  grid that doesn't will disagree, and the artwork reads correct on one and
  mirrored on the other.
- **Auto-level the artwork before sampling it.** Percentile-clipped (2nd/98th)
  stretch to 0.04–0.95. Moody palettes are low-key by design, and a mosaic built
  from a flat dark image is a black wall — the relief has nothing to show.
- **The per-instance colour has to tint emissive too.** three multiplies only
  the *diffuse* term by `instanceColor`, so any cube outside a lamp's reach goes
  black. Inject `totalEmissiveRadiance *= tint` in `onBeforeCompile`. Do **not**
  reuse `vColor` for it: it is a `vec4`, and `color_pars_fragment` declares it
  only under `USE_COLOR`/`USE_COLOR_ALPHA`, never for instanced colours. Carry
  the tint on a varying of your own, seeded from `instanceColor` under
  `#ifdef USE_INSTANCING_COLOR`.
- **A broken injection is silent.** When that shader failed, the mesh simply
  stopped drawing and the backing plane showed through — the page looked like a
  flat photo, and nothing appeared in `pageerror` or the console capture. If
  geometry vanishes after an `onBeforeCompile` edit, suspect the injection
  before you suspect your matrices.
- **Relief is invisible head-on.** From the centre of the sphere the extrusion
  runs straight down the view ray. Depth only reads as *shading*: multiply each
  cell by an occlusion factor (`0.52 + 0.48·√luma`), and keep the gap backing
  *darker* than the cubes (`0.07 + focus·0.11`). Gaps brighter than the cubes
  turn the mosaic into a glowing grid — the exact opposite of relief.
- **Freeze what isn't in focus.** Rewrite instance matrices only while
  `focus > 0.02`; hide past `|delta| > 2.2`. With six panels that is ~1–3
  animating instead of 5 000 matrices a frame.

## Light so the image survives, then sculpt

The oscillation to avoid: brighten the lights until everything is milky, darken
them until only the lamp's sweep is visible, repeat. Fix it in this order:

1. **Source values** — auto-levelled artwork, before touching a light.
2. **A floor that cannot swing** — the tinted emissive above (0.12 + focus·0.34)
   is what guarantees the image is legible from any angle.
3. **Lights sculpt only** — a dim lamp riding at the sphere's centre (330,
   decay 1.9) fills the faces that point at the viewer; two orbiting accents
   (620 teal / 480 amber) graze the cubes. Orbiting lights swing hard at these
   distances, so never let legibility depend on where they are this second.

Hemisphere 0.42 and key 0.85 are ambience, not illumination. Fog (`FogExp2`
0.023) is what makes a 23-unit sphere read as a world; the painted shell itself
is unlit and opts out.

## Velocity-driven effects need a stated cap

The grade is where the mood is won, and where one bad constant ruins a frame.
A smear of `speed × 0.045` capped at 0.05 of the viewport, sampled one-sided, is
a streak machine — at four items/s it smears 72 px in one direction. What works:
symmetric taps, `speed × 0.0016` capped at **0.006** (≈1 px of blur per item/s of
travel), aberration scaled `1 + speed × 2.2`. Bloom threshold must be raised
(0.86) once the artwork is properly levelled, or highlights blow out.

State every velocity cap in pixels before accepting it.

## The caption overlay is where the real bugs were

The DOM layer over the scene broke more often than the WebGL did.

- **Retire every line in the mask, not the first one.** A masked line swap that
  does `querySelector('.line')` retires only the oldest node. Any index change
  inside the animation window orphans the line actually on screen: it keeps its
  settled class, never gets an exit transform, never gets a removal timer, and
  sits there. Travel through six items fast and all six titles are stacked on
  the left. Retire all of them, drop the settled class on the way out, and give
  each its own removal.
- **Equal specificity is decided by document order.** `.line.is-settled`
  declared after `.line.is-out` means a settled line can never leave, however
  correct the JavaScript is. Put the exit rule last *and* remove the class.
- **Stack the lines, don't flow them.** Absolute-position them inside a
  fixed-height mask; in normal flow the "hidden" line is simply the second line
  of a two-line box.
- The detail panel kept reading correctly through all of this, because it sets
  `textContent` on its own element. A caption that is right in one view and
  wrong in another points straight at the animated one.

## Input: taps, frames, and what counts as a click

- **A tap should only open what it points at.** "Pointer moved < 6 px" is not
  enough: a click meant to focus the window opened a project and locked
  navigation. Carry the tap's NDC and raycast before opening — against the
  panel's *backing slice*, one cheap mesh, not 864 instanced cubes. Keyboard and
  the Open button pass no coordinates and always open the centred item.
- Touch never fires a hover move, so seed the pointer position on `pointerdown`
  as well, or the first tap raycasts from wherever the mouse last was.
- Inside an artifact frame: `preventDefault` the arrows (they scroll the host),
  and `window.focus()` on `pointerdown` — keyboard travel does nothing until the
  document has focus.
- Keep horizontal FOV usable on phones: `clamp(52 + (1.4 - aspect)·26, 52, 78)`.
  At 52° a 390 px viewport sees nothing but the panel and the carousel stops
  reading as a world.

## Driving it headless

`measured-truth` has the general rule; these are the traps this scene sets.

- **`page.evaluate` between mouse moves destroys the gesture.** The round trip
  stretches each step to hundreds of ms, so the pointer velocity the app reads
  is ~-72 px/s instead of ~-2400, the flick projects to nothing, and a drag that
  works by hand "fails" in the harness. Move without probing, and make the drag
  long enough to cross the half-item snap threshold on its own.
- **Assert `nav.target` is an integer**, and which one. It is the whole
  interaction in one number, and it is stable between frames in a way that a
  screenshot is not.
- **Software WebGL puts the animation into slow motion.** Frames take longer
  than the app's 50 ms `dt` clamp, so the world advances well under real time:
  a snap that takes 1 s by hand was still 12% short after a 2.2 s wait. Never
  wait a fixed number of milliseconds — wait for the condition
  (`|position - target| < 0.01`), which is what `settle()` does.
- **Mid-swap, zero visible caption lines is correct.** The invariant to assert
  is *never two*: one leaving and one arriving can both be in flight, and a
  probe that lands between them legitimately sees none at rest.
- **`renderer.info` is meaningless after a composer render** — it reported 1
  call and 1 triangle, which is the final fullscreen quad, not the scene.
- **Drawing the WebGL canvas into a 2D canvas reads black** without
  `preserveDrawingBuffer`. Screenshot instead; don't conclude the scene is dead.
- Beware clicking to "focus the page" before a test: on this app that used to
  open a project and lock every later step. That is how the tap bug was found.

## Reporting back

Lead with what the user can now do ("drag and the next panel swings in and
snaps"), then the evidence: the target the snap landed on, the counts, the
measured drag. Say plainly which part is unverified — and when a visual change
was tuned by eye over several passes, say that it was tuned, not measured.
