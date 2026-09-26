---
name: webbim-dev-loop
description: The working loop for the openshapefactory Web BIM app (webbim/) - build both targets, run the acceptance suite, drive the real single-file build in headless Chromium to prove a change works, commit with the session trailer, and republish the live Artifact at the same URL. Use this for any change inside webbim/, whenever you are about to say a feature works, when a browser test "can't hit" an element, when the build refuses a name, or when publishing or pushing webbim.
---

# Web BIM development loop

`webbim/` is a browser BIM on an OCAF-style document: about 23k lines of plain
ES modules in `src/`, built into single-file HTML pages. `webbim/cad/` is a
vendored copy of the user's parametric CAD, and editing that copy is fine.
**The upstream CAD repository (arc-pena/OCAF_V1) is read-only**: pull from it,
never push to it or open anything on it.

## The loop

```bash
cd webbim
node build.mjs                      # refuses on name collisions, aliases, bad order - read the message
node test/acceptance.test.mjs       # the M01… acceptance cases in src/acceptance.js (170 at M70)
node --test test/*.test.mjs         # + spaces, DXF, PDF raster measurement
node skills/webbim-dev-loop/scripts/drive.cjs dist/web-bim.html <three.min.js> my-scenario.cjs
```

Then commit, push to the session branch, and republish.

### The build is one scope

`dist/web-bim.html` concatenates every module into **one scope**. A duplicate
top-level name would silently win there, while the served `index.html` (native
modules) would throw. So `build.mjs` refuses:
- the same top-level name in two modules, including the second name in
  `const A = …, B = …` (a hidden `WHITE` once collided this way),
- import aliases,
- importing a later module,
- a file missing from `MODULES`.

When it refuses, rename with a specific name (`SHEET_WHITE`, `keyLight`).
Don't work around the check. A new module must be added to `MODULES` in
dependency order.

A class field can also clobber a method of the same name (`this.key = light`
over `key()`). The build can't see that, so give fields specific names.

`dist/web-bim-studio.html` is the same page with the CAD app embedded (needs
`cad/parametric-cad.html`; the build says how). It must stay under the 16 MB
page limit.

### Acceptance tests carry hand-derived numbers

Add each feature as the next `M<nn>` case in `src/acceptance.js`, with an
expected value worked out on paper. For example: the level count goes 2 → 3,
the pasted slab lands 3000 mm up on L1 with offset 0, and the copied door has
its *own* opening. If a test fails on a missing import, it's usually a missing
`import` in acceptance.js itself.

### Prove it in the real page

Unit tests don't click. For anything interactive, drive the built file:
`scripts/drive.cjs` launches Chromium with SwiftShader WebGL, serves three.js
locally, injects `window.__app`, and gives helpers: `sample()`,
`openFirst(type)`, `screen(viewId, modelPt)`, `count(type)`, `arg(id, key)`,
`msg()`, `hitsAt(viewId, pt)`, `hitBoxes(viewId)`, `shot(file)`.

Rules learned the hard way:
- **Probe before you debug.** When a click "misses", print `hitsAt` at that
  point first. The frontmost element is often not the one you meant: in the
  Studio House south elevation, garden wall GW1 (1.5 m tall, depth 1) covers
  the bottom of door D1. A point outside every wall also reads as "click on a
  wall". Twice the code was right and the test point was wrong.
- Drive through the UI the user uses (menus by visible text, typed shortcuts
  like `MV`, `CO`, `WN`, Ctrl+C/V, real mouse drags with steps). Setting
  state directly skips the bug.
- Assert the size *and* the direction: a 60 px drag at 22.47 mm/px moves
  1348 mm, and to the right.
- Look at the screenshot, then say only what it shows. If something may be
  cropped out of view, say so rather than claiming it rendered.

Keep scenarios and screenshots in the session scratchpad, not in the repo.

## Commit, push, publish

- Commit to the session's branch. End messages with the
  `Co-Authored-By` / `Claude-Session` trailer the session gives you. No model
  names in repo files. No PR unless the user asks.
- Republish `dist/web-bim-studio.html` **to the existing Artifact URL** in
  README.md (https://claude.ai/artifact/EuWpSVPSYJtKFJB8GHDqfP) so the link
  never changes. Omit `capabilities` on republish to keep the stored ones
  (`downloads`, `sample`). Publishing without the URL creates a second
  artifact.
- Rebuild before publishing. Never publish one target without the other.

## Reporting back

Lead with what the user can now do, in their words ("select a slab in the
section, Ctrl+C, Ctrl+V, click a storey up"), then the evidence (counts
before → after, the measured drag). Name anything that is not verified, and
anything you found that is surprising but correct, such as an element that
can't be clicked because another element is in front.
