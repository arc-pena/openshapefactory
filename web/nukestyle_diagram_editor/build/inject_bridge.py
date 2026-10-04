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
