// No wall is drawn out past where it was built: at every joined end of every wall in every sample, the end's
// outline stays within a few wall thicknesses of the end point. Walls meeting all but in line (or stacked
// storeys whose ends share a point) once mitred to an intersection hundreds of feet away - the AIA's chase
// wall W-CH-S and kitchen wall W-KL-3a were drawn 109 m long. Proved to fail on that code before the fix.
import test from "node:test";
import assert from "node:assert/strict";

for (const name of ["aia", "schaeffer", "walnut", "fpc", "mazatlan", "pavilion", "rmuh"]) {
  test(`${name}: every wall end stays where the wall ends`, async () => {
    const mod = await import(`../src/sample_${name}.js`);
    const doc = Object.values(mod).find(f => typeof f === "function" && /^build/.test(f.name))();
    const bad = [];
    for (const f of doc.elements()) { if (doc.typeOf(f) !== "Wall") continue; const p = doc.plan(f); if (!p || !p.ends || !p.curve) continue;
      for (const e of ["start", "end"]) { const t = p.ends[e] && p.ends[e].term, c = p.curve[e]; if (!t || !t.pts || !c) continue;
        const far = Math.max(...t.pts.map(q => Math.hypot(q[0] - c[0], q[1] - c[1]))), T = p.stack ? p.stack.T : 300;
        if (far > Math.max(6 * T, 2000)) bad.push(`${doc.idOf(f)}.${e}: outline reaches ${Math.round(far)} mm from the end`); } }
    assert.deepEqual(bad, []);
  });
}
