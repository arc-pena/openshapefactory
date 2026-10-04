# Copies the Feature Modeller and adds a small bridge inside its module script, so the
# compositor (its parent frame) can load a model into it and ask for the model back.
import sys
src, out = sys.argv[1], sys.argv[2]
html = open(src, encoding='utf-8').read()
BRIDGE = r'''
/* ---- Diagram Compositor bridge: answers {call:"load"} and {call:"model"} from the parent frame. ---- */
;(() => {
  if (window.parent === window) return;
  const tell = m => window.parent.postMessage(Object.assign({ dcBridge: 1 }, m), "*");
  const ready = async () => {
    for (let i = 0; i < 1200; i++) {
      try { if (typeof kernel !== "undefined" && kernel && typeof kernel.model === "function") return; } catch (e) {}
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error("the modelling kernel did not start");
  };
  /* ---- Path trace and render passes for the compositor ----
     The modeller's own RenderEngine traces the picture, so the compositor gets exactly the renderer
     the modeller has, materials and all. The passes are rasterised from the same scene and the same
     camera, so every one of them lines up with the traced picture pixel for pixel. */
  const sleepFrame = () => new Promise(r => requestAnimationFrame(() => r()));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // The model is built when its triangles have stopped arriving.
  async function settled() {
    let last = "", still = 0;
    for (let i = 0; i < 400 && still < 3; i++) {
      await wait(250);
      let n = 0, sum = 0; try { for (const [, v] of streams) { n++; sum += (v && v.positions ? v.positions.length : 0); } } catch (e) {}
      const now = n + ":" + sum; still = now === last && n > 0 ? still + 1 : 0; last = now;
    }
  }
  const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const idColour = key => { const x = fnv("id:" + key); let r = x & 255, g = (x >> 8) & 255, b = (x >> 16) & 255; if (r + g + b < 60) r = 200; return [r, g, b]; };
  const canvasBlob = c => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("the browser would not read the pass back")), "image/png"));
  // What each body is made of: a Material feature naming it (last one wins, as in the renderer), else its finish.
  function materialTable() {
    const owned = new Map();
    for (const entry of state.tree.features) {
      if (entry.type !== "Material" || !entry.data || entry.data.kind !== "material") continue;
      for (const id of entry.data.of || []) owned.set(id, { key: "material:" + entry.id, name: entry.name || entry.id });
    }
    const table = new Map();
    for (const entry of state.tree.features) {
      if (!showroom.parts.has(entry.id)) continue;
      let mat = owned.get(entry.id);
      if (!mat) {
        const made = materialOf(entry.appearance), own = entry.appearance || {};
        const hex = Array.isArray(own.color) ? "#" + own.color.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("") : "";
        mat = { key: "finish:" + made.finish + hex, name: made.label + (hex ? " " + hex : "") };
      }
      table.set(entry.id, mat);
    }
    return table;
  }
  // What the renderer currently holds, so a trace only rebuilds what changed: the BVH is the expensive
  // part (every triangle) and the modeller's own export rebuilt it twice per picture.
  let loads = 0, built = -1, fresh = false;
  async function prepare(m) {
    if (fresh) { await settled(); fresh = false; }
    await showroom.start();
    if (built !== loads) { showroom.setScene(state.tree.features, streams); built = loads; }
    if (!showroom.parts.size) throw new Error("the model has no bodies to render");
    if (m.environment && m.environment !== showroom.environment) showroom.applyEnvironment(m.environment);
    if (showroom.quality !== (m.quality || "good")) showroom.applyQuality(m.quality || "good");
    showroom.setExposure(m.exposure == null ? 1 : +m.exposure);
    const ground = m.ground !== false;
    if (showroom.ground && showroom.ground.visible !== ground) showroom.setGroundVisible(ground);
    const T = showroom.tracer;
    // An export's settings: full resolution, no raster stand-in, no fade, nothing waiting.
    Object.assign(T, { renderScale: 1, renderDelay: 0, fadeDuration: 0, minSamples: 1, dynamicLowRes: false, rasterizeScene: false, pausePathTracing: false });
    showroom.exporting = true; // keeps the page's own frame loop off the renderer while we use it
    return { THREE: showroom.PT.THREE, R: showroom.renderer, cam: showroom.camera, w: Math.max(8, Math.round(m.width)), h: Math.max(8, Math.round(m.height)) };
  }
  // The compositor's camera, in the renderer's Y-up frame: Z up all the way (as the modelling view and
  // the compositor do), then the roll about the view axis.
  function placeCam(m, ctx) {
    const toY = ([x, y, z]) => [x, z, -y], e = toY(m.camera.eye), t = toY(m.camera.target), cam = ctx.cam;
    ctx.R.setSize(ctx.w, ctx.h, false);
    cam.position.set(e[0], e[1], e[2]); cam.up.set(0, 1, 0); cam.lookAt(t[0], t[1], t[2]);
    if (m.camera.roll) cam.rotateZ(-m.camera.roll * Math.PI / 180);
    cam.fov = m.camera.fov; cam.aspect = ctx.w / ctx.h; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }
  // Samples until there are enough: several per frame (this copy of the modeller is not on screen, so
  // nobody is waiting for its frames), yielding often enough to stay responsive.
  async function traceLoop(m, ctx, what, share, progress) {
    const T = showroom.tracer, want = Math.max(1, Math.round(m.samples || 32));
    placeCam(m, ctx); T.updateCamera();
    let stuck = 0, had = -1;
    while (T.samples < want) {
      const began = performance.now();
      do T.renderSample(); while (T.samples < want && performance.now() - began < 45);
      const got = Math.floor(T.samples); stuck = got > had ? 0 : stuck + 1; had = got;
      if (stuck > 240) throw new Error("the renderer stopped collecting samples at " + got + " of " + want);
      progress({ what, done: share[0] + share[1] * Math.min(1, got / want) });
      await sleepFrame();
    }
    return canvasBlob(showroom.canvas);
  }
  async function traceForParent(m, progress) {
    const ctx = await prepare(m), THREE = ctx.THREE;
    try {
      const wantClay = m.passes && m.passes.includes("clay");
      const out = { width: ctx.w, height: ctx.h, samples: Math.max(1, Math.round(m.samples || 32)) };
      out.beauty = await traceLoop(m, ctx, "beauty", [0, wantClay ? 0.5 : 1], progress);
      // Clay: the same light on white bodies - light and shadow without the materials.
      if (wantClay) {
        const keep = new Map(), white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
        for (const [id, part] of showroom.parts) { keep.set(id, part.mesh.material); part.mesh.material = white; }
        showroom.tracer.updateMaterials();
        try { out.clay = await traceLoop(m, ctx, "clay", [0.5, 0.5], progress); }
        finally { for (const [id, part] of showroom.parts) part.mesh.material = keep.get(id); showroom.tracer.updateMaterials(); white.dispose(); }
      }
      return out;
    } finally { showroom.exporting = false; }
  }
  // The passes, rasterised from the same scene and camera (no tracing): asked for only when a node
  // downstream reads one, so a plain export is the trace and nothing else.
  async function passesForParent(m, progress) {
    const ctx = await prepare(m), THREE = ctx.THREE, R = ctx.R, cam = ctx.cam, w = ctx.w, h = ctx.h, out = {};
    try {
      progress({ what: "passes", done: 0.1 });
      const table = materialTable();
      const was = { bg: showroom.scene.background, ground: showroom.ground ? showroom.ground.visible : false, tone: R.toneMapping };
      const mats = new Map(); for (const [id, part] of showroom.parts) mats.set(id, part.mesh.material);
      const flat = rgb => new THREE.ShaderMaterial({ uniforms: { c: { value: new THREE.Vector3(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) } },
        vertexShader: "void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: "uniform vec3 c; void main(){ gl_FragColor = vec4(c,1.0); }", side: THREE.DoubleSide });
      const made = [];
      const pass = async (materialFor, scale = 1) => {
        for (const [id, part] of showroom.parts) { const mm = materialFor(id, part); part.mesh.material = mm; if (mm && !made.includes(mm)) made.push(mm); }
        placeCam(m, { ...ctx, w: w * scale, h: h * scale }); cam.aspect = w / h; cam.updateProjectionMatrix();
        R.setClearColor(0x000000, 1); R.render(showroom.scene, cam);
        return canvasBlob(showroom.canvas);
      };
      try {
        showroom.scene.background = new THREE.Color(0, 0, 0); if (showroom.ground) showroom.ground.visible = false; R.toneMapping = THREE.NoToneMapping;
        placeCam(m, ctx); showroom.scene.updateMatrixWorld(true);
        // Depth: straight-line distance from the eye, packed into 24 bits across the model's own range.
        // The nearest point of the box, not its nearest corner: a camera over the middle of a site is far
        // closer to the roof below it than to any corner.
        const box = new THREE.Box3(); for (const [, part] of showroom.parts) box.expandByObject(part.mesh);
        let dmax = 0;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) dmax = Math.max(dmax, cam.position.distanceTo(new THREE.Vector3(x, y, z)));
        const dmin = Math.max(cam.near, box.distanceToPoint(cam.position) * 0.98); dmax *= 1.02;
        const depthMat = new THREE.ShaderMaterial({ uniforms: { lo: { value: dmin }, hi: { value: dmax } }, side: THREE.DoubleSide,
          vertexShader: "varying vec3 vv; void main(){ vec4 p = modelViewMatrix * vec4(position,1.0); vv = p.xyz; gl_Position = projectionMatrix * p; }",
          fragmentShader: "uniform float lo, hi; varying vec3 vv; void main(){ float t = clamp((length(vv) - lo) / (hi - lo), 0.0, 0.99999); vec3 e = fract(t * vec3(1.0, 255.0, 65025.0)); e -= e.yzz * vec3(1.0/255.0, 1.0/255.0, 0.0); gl_FragColor = vec4(e, 1.0); }" });
        out.depth = await pass(() => depthMat); out.depthRange = [dmin, dmax];
        // Normals in the model's own Z-up frame, as colour (x, y, z) * 0.5 + 0.5.
        const normalMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide,
          vertexShader: "varying vec3 vn; void main(){ vn = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
          fragmentShader: "varying vec3 vn; void main(){ vec3 n = normalize(vn); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }" });
        out.normal = await pass(() => normalMat);
        progress({ what: "passes", done: 0.4 });
        // Albedo: each body's own colour (and colour map), unlit.
        out.albedo = await pass(id => new THREE.MeshBasicMaterial({ color: mats.get(id).color, map: mats.get(id).map || null, toneMapped: false, side: THREE.DoubleSide }));
        const objects = [], materials = new Map();
        for (const entry of state.tree.features) if (showroom.parts.has(entry.id)) {
          objects.push({ id: entry.id, name: entry.name || entry.id, colour: idColour(entry.id) });
          const mt = table.get(entry.id); if (!materials.has(mt.key)) materials.set(mt.key, { key: mt.key, name: mt.name, colour: idColour(mt.key), parts: [] }); materials.get(mt.key).parts.push(entry.id);
        }
        const objFlat = new Map(objects.map(o => [o.id, flat(o.colour)])), matFlat = new Map([...materials.values()].map(x => [x.key, flat(x.colour)]));
        out.objectId = await pass(id => objFlat.get(id));
        out.materialId = await pass(id => matFlat.get(table.get(id).key));
        progress({ what: "passes", done: 0.7 });
        // Coverage, and one coverage per material, at twice the size so edges come back soft.
        const white = flat([255, 255, 255]), black = flat([0, 0, 0]);
        out.coverage = await pass(() => white, 2);
        out.materialMasks = {};
        for (const mt of [...materials.values()].slice(0, 32)) out.materialMasks[mt.key] = await pass(id => table.get(id).key === mt.key ? white : black, 2);
        out.legend = { objects, materials: [...materials.values()] };
        made.push(depthMat, normalMat, white, black, ...objFlat.values(), ...matFlat.values());
      } finally {
        for (const [id, part] of showroom.parts) part.mesh.material = mats.get(id);
        showroom.scene.background = was.bg; if (showroom.ground) showroom.ground.visible = was.ground; R.toneMapping = was.tone;
        for (const mm of made) try { mm.dispose(); } catch (e) {}
      }
      progress({ what: "passes", done: 1 });
      return out;
    } finally { showroom.exporting = false; }
  }
  window.addEventListener("message", async e => {
    const m = e.data;
    if (e.source !== window.parent || !m || m.dcBridge !== 1 || !m.call) return;
    try {
      await ready();
      if (m.call === "load") {
        let model = m.model;
        // The same path as opening a model file: switch on any packages it needs first.
        try { if (typeof loadNeeds === "function") model = await loadNeeds(model); } catch (err) {}
        await mdl.run({ op: "model", model });
        loads++; fresh = true;
        try { fitView(); } catch (err) {}
        // The geometry lands after the build, so fit again once the model's extent stops changing -
        // unless the hand has moved the view in the meantime.
        (async () => {
          const at = () => { try { return [view.distance, view.target.x, view.target.y, view.target.z].join(","); } catch (e) { return ""; } };
          const size = () => { try { const f = framingBounds(); return f ? f.box.getBoundingSphere(new THREE.Sphere()).radius : 0; } catch (e) { return 0; } };
          let last = -1, still = 0, mine = at();
          for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 300));
            if (at() !== mine) return;
            const r = size(); still = Math.abs(r - last) < 1e-6 && r > 0 ? still + 1 : 0; last = r;
            if (still >= 2) { try { fitView(); } catch (e) {} return; }
          }
        })();
        tell({ id: m.id, ok: true });
      } else if (m.call === "model") {
        const model = await kernel.model();
        try { const layout = graph.layoutJson(); if (layout && Object.keys(layout).length) model.layout = layout; } catch (err) {}
        try { const hid = [...state.hidden]; if (hid.length) model.hidden = hid; } catch (err) {}
        tell({ id: m.id, ok: true, model });
      } else if (m.call === "trace") {
        tell(Object.assign({ id: m.id, ok: true }, await traceForParent(m, done => tell({ id: m.id, progress: done }))));
      } else if (m.call === "passes") {
        tell(Object.assign({ id: m.id, ok: true }, await passesForParent(m, done => tell({ id: m.id, progress: done }))));
      } else tell({ id: m.id, ok: false, error: "unknown call " + m.call });
    } catch (err) { tell({ id: m.id, ok: false, error: String(err && err.message || err) }); }
  });
  ready().then(() => tell({ ready: true }), err => tell({ ready: false, error: String(err && err.message || err) }));
})();
'''
# Fixes to the modeller copy. Each one names the text it replaces and fails the build if that text
# is gone, so a newer modeller can never be shipped with a fix silently not applied.
def patch(src, old, new, what):
    assert src.count(old) == 1, 'modeller patch target not found (or not unique): ' + what
    return src.replace(old, new)
# 1. The kernel returns NaN points for degenerate edges of imported STEP shapes. Drawn as they are,
#    they make the scene's bounding sphere NaN, the clipping planes follow it, and the whole model
#    vanishes - most visibly when looking through a camera. Drop any segment with a non-finite point.
html = patch(html, 'function againstAnchor(flat, anchor) {',
    'function finiteSegments(flat) {\n'
    '  if (!flat || !flat.length) return flat;\n'
    '  let bad = false; for (let i = 0; i < flat.length; i++) if (!Number.isFinite(flat[i])) { bad = true; break; }\n'
    '  if (!bad) return flat;\n'
    '  const out = new Float32Array(flat.length - flat.length % 6); let n = 0;\n'
    '  for (let i = 0; i + 5 < flat.length; i += 6) { let ok = true; for (let j = 0; j < 6; j++) if (!Number.isFinite(flat[i + j])) { ok = false; break; } if (ok) for (let j = 0; j < 6; j++) out[n++] = flat[i + j]; }\n'
    '  return out.slice(0, n);\n'
    '}\n'
    'function againstAnchor(flat, anchor) {', 'finite edges')
html = patch(html, 'new THREE.Float32BufferAttribute(againstAnchor(mesh.edges, anchor), 3));',
    'new THREE.Float32BufferAttribute(againstAnchor(finiteSegments(mesh.edges), anchor), 3));', 'edges use finiteSegments')
# 2. And should a size ever come out NaN anyway, the clipping planes fall back to a sane one rather
#    than to NaN, which draws nothing at all.
html = patch(html, '  const span = Math.max(view.span, 1);\n  camera.near =',
    '  if (!Number.isFinite(view.span)) view.span = Math.max(view.distance, 1);\n  const span = Math.max(view.span, 1);\n  camera.near =', 'finite span')
# 3. A camera's working frame (the look-through rig's pan, orbit and dolly, and the frustum drawn for
#    it) switched "up" to world Y within 2.6 degrees of vertical, while the view itself is three.js
#    lookAt with Z up all the way. On a near-vertical plan camera the two disagreed, so a pan moved
#    the shot diagonally. Keep Z up as the view does, nudging only an exactly vertical camera.
html = patch(html, """  const world = Math.abs(forward[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  let right = cUnit(cCross(forward, world));
  if (!right) right = [1, 0, 0];""", """  const world = [0, 0, 1];
  let right = cUnit(cCross(forward, world));
  if (!right) right = cUnit(cCross(cUnit(cAdd(forward, [-1e-4, 0, 0])), world)) || [1, 0, 0];""", 'camera frame keeps Z up')
i = html.rfind('</script>')
assert 'type="module"' in html[:i] and html.rfind('<script type="module">') < i
html = html[:i] + BRIDGE + html[i:]
open(out, 'w', encoding='utf-8').write(html)
mod = html[html.rfind('<script type="module">') + len('<script type="module">'):html.rfind('</script>')]
import os
if os.environ.get('MODULE_OUT'): open(os.environ['MODULE_OUT'], 'w', encoding='utf-8').write(mod)  # the module script alone, for reading and grepping
print('modeller.html', len(html.encode('utf-8')), 'bytes')
