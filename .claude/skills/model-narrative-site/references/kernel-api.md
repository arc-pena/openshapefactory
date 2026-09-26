# The Feature Modeller kernel, headless

## Where it comes from

The Feature Modeller single-file artifact has two
`<script type="application/octet-stream">` payloads, each gzip + base64:

| element id | file | contents |
| --- | --- | --- |
| `kernel-payload` | `replicad_single.wasm.gz` | OpenCascade (replicad build), ~22 MB raw, ~7.2 MB gz |
| `worker-payload` | `kernel-worker.js.gz` | Emscripten glue, OCAF document, feature drivers and message loop, as one **module** worker (~1.7 MB raw) |

`scripts/extract_kernel.py` writes both out unchanged. The worker bundle is
self-contained: it takes the wasm bytes over the port and fetches nothing.

## Protocol (what `kernel.js` wraps)

```
page → worker   {id, call, args}
worker → page   {id, ok, value | error}
                {progress: "starting the modeller" | "ready"}   while starting
                {build: {stage, done, total, failed}}           while building
```

The first call is `start` with `[{wasmBinary}]`, with the ArrayBuffer
transferred. Its answer is `{calls: [...names], values: {kind, description}}`.
Every other call is `kernel[name](...args)` and returns a promise. The worker
must be `{type: "module"}` because the glue uses `import.meta`.

```js
const k = await startKernel({ base: "../kernel/", onProgress, onBuild });
const r = await k.loadModel(modelJson);    // replaces the document, builds everything
// r = {ok, tree, report: {executed:[{id,name,revision}], skipped, failed, done, total}}
const m = await k.mesh(ids?);              // omit ids for every feature
const r2 = await k.setParameter("NU1", "value", 20); // rebuilds only downstream
```

Other calls exist, but a narrative rarely needs them: `tree`, `model`,
`setSketch`, `addFeature`, `exportStep`, `boxes`. If a call seems to be
missing, list `started.calls` before assuming anything.

## Mesh format (per feature in `m.features`)

```
{ id, type, name, revision, built, visible,
  shape: "solid"|"compound"|"face"|"edge"|"vertex",
  positions: Float32Array xyz, normals: Float32Array, index: Uint32Array, triangles,
  edges: Float32Array  // LINE SEGMENT PAIRS: a0 a1 b0 b1 ... (use THREE.LineSegments)
  point: [x,y,z], points: flat xyz  // for point features
  meshError }
```

Measured behaviour:

- **Datums:** `Point` gives `point`. `Vector` gives `edges` as one segment
  from the origin, 100 long. `Plane` gives a 2-triangle square plus edges.
- **Sketches:** `Sketch` gives the closed face (triangles) plus its edges, in
  world coordinates on its plane. Draw it on with `setDrawRange` over the
  segment pairs.
- **Solids:** `Extrude`, `Boolean`, `Fillet` and `AxisToAxis` give
  triangles, normals and edges.
- **Hidden inputs still mesh:** a feature consumed by another (an extrude
  that a Boolean uses, a column extrude that a placement moves) meshes fine.
  Mesh it deliberately when a chapter shows the "before".
- **Precision:** everything is float32, so large coordinates must be rebased
  first (see large-models.md).

## Timings seen (headless Chromium in the sandbox)

| model | features | loadModel | mesh | notes |
| --- | --- | --- | --- | --- |
| sketcher.json | 13 | ~1.0–1.2 s | fast | `setParameter` on NU1 ≈ 0.4–0.6 s, re-runs 4 of 13 |
| Tower C | 1,426 | ~27 s | ~8.6 s | 305 extrudes, 136 Booleans, 40 AxisToAxis, 27,860 sketch segments |

A real desktop is usually faster. Design for the slow case anyway: show
progress, and render what has been built so far.

## Model file shape (`ocaf-parametric-model` v1)

```
{ format, version, name, units: "mm",
  features: [{ id, type, name, args: {...{ref: "ID"}...}, parent?: "GSn", appearance? }],
  hidden: [ids] }
```

`GeometricalSet` features are folders (`parent` links). References are
`{ref: id}` anywhere inside `args`. Argument values such as `distance` may be
`{value, from: "NU1"}` links to Number features. That link is what makes a
`setParameter` chapter meaningful.
