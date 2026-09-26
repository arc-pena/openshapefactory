# The narrative page engine

Both example pages (`assets/narrative-*.html`) share this engine. It uses
three.js r128 from cdnjs as a UMD global, one fixed canvas, and HTML chapters
above it. Scroll drives everything. There is no scroll library and nothing
is pinned.

## Scroll → one continuous number

```js
// chapter = 2.5 means halfway between the centres of sections 2 and 3.
function measure() {
  const mid = scrollY + innerHeight / 2;
  const c = sections.map(s => s.offsetTop + s.offsetHeight / 2);
  if (mid <= c[0]) return chapter = 0;
  for (let i = 0; i < LAST; i++) if (mid < c[i + 1]) return chapter = i + (mid - c[i]) / (c[i + 1] - c[i]);
  chapter = LAST;
}
const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const ramp = (c, a, b) => smooth((c - a) / (b - a));                 // 0 → 1 between a and b
const band = (c, a, b, d, e) => ramp(c, a, b) * (1 - ramp(c, d, e)); // up, hold, down
```

Every visual state is a pure function of `chapter`, computed each frame, so
scrolling backwards just works. Chapter i is centred at `c = i`. Start a
chapter's animation a little before `i` (i − 0.5) and finish it by `i + 0.1`,
so the reader lands on the finished state.

## Camera

- **Shots:** one `{at, look}` per chapter, lerped between `floor(c)` and
  `ceil(c)` with `smooth`.
- **Derive shots from the bounding box** once meshes exist: `C` = centre,
  `S` = size (height for towers, longest side for parts). Write offsets as
  multiples of S so a different model still frames. Re-plan after every
  chunk arrives.
- **Motion on top:** a slow sway (`sin(t*0.12..0.18)`) weighted by `band`
  for the opening and closing chapters, and pointer parallax of about 5% of
  the camera distance.
- **Leave room for the copy:** on desktop,
  `camera.setViewOffset(w, h, -w*0.07..0.12, 0, w, h)` pushes the model away
  from the copy column. On phones use a wider fov, offset `h*0.16..0.18`, and
  put the copy at the bottom of each chapter.
- **Pull back:** first drafts are always too close. Multiply the
  `at - look` offset (factor 1.4–1.9) rather than hand-tuning each shot.
- **Z is up** (`camera.up.set(0,0,1)`). A shot straight down degenerates, so
  add a small horizontal offset.
- **Units:** millimetres. For buildings, put everything in a group with
  `scale.setScalar(0.001)` and think in metres.

## Render roles (a feature type decides how it appears)

| feature | how it enters | notes |
| --- | --- | --- |
| Point / Vector / Plane | amber datums: bead, ArrowHelper, translucent sheet plus outline | fade out once solids exist |
| Sketch | edges drawn on with `geometry.setDrawRange(0, n*k)`, over a faint face fill and a 10 mm grid on its plane | draw order = kernel edge order |
| Extrude | grows from its plane: put the mesh in a holder at the plane, offset back inside, animate `holder.scale` along the direction | from z = 0 for the plate, from y = 16 for the rib |
| Boolean | inputs tinted/clay → crossfade to the result (switch `depthWrite` off while fading) | new edges show where the result changed |
| Fillet / finish | aluminium: `MeshStandardMaterial` metalness 1, roughness ~0.4, env from `PMREMGenerator.fromScene` of a few emissive planes (no HDR fetch) | close-up camera, brighter edges |
| AxisToAxis / placement | local vs placed ghost lines, two grids (survey and local, turned by the placement angle) | quote the real coordinates |
| setParameter | precompute each value **after** the first render: `setParameter` → `mesh([id])` → cache, then reset. Swap geometry by scroll position | quote ms and `report.executed` ids |

## Reading layer

- **Copy:** each `.chapter` holds a `.copy` block with a mono kicker (feature
  ids), a display headline, and 1–2 short paragraphs with figures.
  `min-height: 100svh`.
- **Mist:** a gradient over the stage (`#stage::after`) behind the copy
  side, so the text never needs a box.
- **Readout:** a fixed line at the bottom left, rebuilt only when its HTML
  changes.
- **Index:** the feature tree in document order (highlight the chapter's ids)
  or an elevation staff (ticks at real heights, darkened when built, a marker
  at the camera target or reveal height).
- **Status line:** mirrors the kernel's `progress`/`build` messages and ends
  "N features built in X s, in this tab".

## Pitfalls that already happened

- **Stacked translucency:** a stack of translucent ghosts becomes opaque. In
  plan chapters, hide everything above the level you're drawing (a section
  cut).
- **depthWrite:** a solid that is fading must not write depth, or it hides
  what fades in behind it. A deliberately translucent sheet never writes depth.
- **Sizing from one chunk:** don't take the bounding box, the typical-floor
  centre or the shots from the first chunk alone. Recompute as data arrives.
- **Light pages:** for a white/fog page, fog near ≈ 1.6 S and far ≈ 6 S,
  floor colour around `#cfd3d5`, edges `#2b3134` at 0.5 opacity. Lighter
  than that and the model disappears.
