# Sketcher bracket: a scroll-driven narrative

A parallax, scroll-told page whose 3D background is the `sketcher.json`
parametric model, regenerated live by the Feature Modeller's OpenCascade
kernel. The modeller's interface never appears. The page loads the kernel,
calls `loadModel`, `mesh` and `setParameter`, and each chapter decides how
the result is rendered: datums, sketch draw-on, extrudes growing, the union,
the fillet, then real rebuilds of `NU1` (plate thickness).

| File | What it is |
| --- | --- |
| `index.html` | The page: copy, scroll → camera and render-style mapping, three.js r128 |
| `../kernel/kernel.js` | Headless client for the modeller's worker kernel (shared with TowerC) |
| `../kernel/replicad_single.wasm.gz` | The Feature Modeller's `kernel-payload`, unchanged |
| `../kernel/kernel-worker.js.gz` | The Feature Modeller's `worker-payload` (OCAF document + drivers), unchanged |
| `sketcher.json` | The model (`ocaf-parametric-model` v1, 13 features) |

Serve `web/` over HTTP (for example `python3 -m http.server`) and open
`index.html`. Opened from `file://`, the page can't fetch the kernel.
