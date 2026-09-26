# The sample selector (Sphere World, bleached)

`assets/selector-sphere-world.html` ports the user's "Sphere World"
artifact (a Vite/three r186 bundle) to plain three r128. The original's
behaviour is kept. Its palette became white fog and monochrome, as asked.

## What Sphere World is

- **Camera:** sits at the origin. Items sit on a ring at `index * 2π/N`, so
  camera yaw is `-position * step`.
- **Panels:** each item is a wall of `36 × 24` instanced boxes on a sphere of
  radius 23. `cell = 0.46`, `thetaCenter = 0.475π`,
  `phiLength = cols·cell / (r·sin θc)`, `phiStart = -π/2 - phiLength/2`,
  panel `rotation.y = -angle`. Sphere point:
  `(-r cosφ sinθ, r cosθ, r sinφ sinθ)`. Each box is oriented with
  `lookAt(dir·r, origin, up)`.
- **Per-frame box matrix:** relief `A = lift·1.9·c·(1+0.9·open) +
  sin(t·1.5 + u·7 + v·3.6 + seed)·d·(0.25 + lift·0.9)`, where
  `c = 0.4 + 0.6·focus` and `d = 0.1 + 0.34·focus + 0.55·open`. Depth
  `L = 0.5 + lift·1.9·c`. Position `dir·(r - A + L/2)`, scale
  `(h, h, L)`. When open, the boxes spread in u/v and twist slightly.
- **Backing:** a faint print of the image on a sphere slice just behind the
  boxes, with an edge frame and a scanline.
- **Navigation:** drag (flick velocity × 0.26, rounded to the nearest item),
  wheel (snap after 170 ms), arrows/A/D, Enter. After 7 s idle it drifts.
  Focus is `1 - smoothstep(0, 1.3, |circular distance|)`.
- **Atmosphere:** a sky sphere with fbm clouds and a horizon band, 2,400
  dust points, and a ground grid at y = −11 with rings pulsing outward,
  moving point lights.
- **Post:** chromatic split and horizontal smear that grow with speed,
  contrast, vignette, grain. Bloom was dropped for the white version.
- **UI:** brand and counter, ticks, a title that slides line in/out, and an
  "open" ring button.

## What changed for "white foggy monochrome"

- **Light ground:** sky nadir/horizon/zenith ≈ 0.80/0.93/0.84 grey, mist
  banks subtract instead of glowing, `FogExp2('#e6e8e9', 0.019)`, dark dust
  with normal blending, grey ground lines.
- **Cube colour:** the image's own grey `0.22 + 0.74·luma`, emissive
  `#2a2e30` at 0.4–1.2.
- **Relief:** `lift` is |luma − median border luma| (normalised,
  pow 0.8), **not** luma. The subject then stands out whether it is darker
  or lighter than its ground.
- **Gamma:** the post pass renders to a `WebGLRenderTarget` and must **not**
  apply `pow(1/2.2)`. The colours are authored as sRGB-ish and doing it made
  everything white on white.
- **Title:** Archivo condensed (wdth 62, 800) uppercase. The title box has
  an explicit width, because the fallback font is wider and clipped
  otherwise.

## Wiring it to stories

- **Items:** `ITEMS` rows:
  `{id, title, category, count, blurb, href, thumb, seed}`. With two items
  the walls face each other (180° apart); that works and feels spacious.
- **Entering:** a click on the wall (raycast against the backing) or Enter
  sets `openTarget = 1`. At 900 ms the white veil comes up; at 1,500 ms it
  navigates to `href`.
- **Returning:** narratives link to `../index.html#<id>`. The selector starts
  at that item. Artifact links only preserve a bare `#token`, so no
  `#key=value`.
- **Back/forward cache:** handle `pageshow` with `persisted` by unlocking
  and dropping the veil.
- **Narrative side:** a `.veil.arriving` fades out on load, and every
  `[data-leave]` link fades to white before following. A dark page still
  starts white and fades in.
- **Thumbnails:** a poster frame from the narrative with overlays hidden
  (`shots.mjs --poster`), then `make_thumb.py`. Tall subjects (towers) make
  a narrow strip of cubes. If that bothers the user, crop tighter or use a
  more horizontal chapter frame.
