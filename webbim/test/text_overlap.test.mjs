// No two words on a sample sheet sit on each other: every text a sheet draws (the model's level and grid heads,
// markers, stair numbers, dimension strings, the notes lifted from a set's PDF, the title block) is boxed by its
// measured width and cap height, and no two boxes on one sheet may overlap by more than a sliver. Words a
// viewport's crop hides are not on the sheet and are not counted.
import test from "node:test";
import assert from "node:assert/strict";
import { sheetScene, textWidth } from "../src/scene.js";

export function overlaps(doc, sh) {
  const T = [];
  const walk = (ps, clip = null) => { for (const p of ps) {
    if (p.t === "group") { walk(p.prims, p.clip || clip); continue; }
    if (p.t !== "text" || !String(p.text).trim()) continue;
    const w = textWidth(p.text, p.height, p.font, p.widthFactor || 1), h = p.height, dx = p.align === "centre" ? -w / 2 : p.align === "right" ? -w : 0, dy = p.valign === "middle" ? -h / 2 : 0;
    const a = (p.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), pts = [[dx, dy], [dx + w, dy], [dx + w, dy + h], [dx, dy + h]].map(([x, y]) => [p.at[0] + x * c - y * s, p.at[1] + x * s + y * c]);
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    if (clip && ((b[0] + b[2]) / 2 < clip[0] || (b[0] + b[2]) / 2 > clip[2] || (b[1] + b[3]) / 2 < clip[1] || (b[1] + b[3]) / 2 > clip[3])) continue;
    T.push({ t: p.text, id: p.id, b }); } };
  walk(sheetScene(doc, sh).prims);
  const out = [];
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) { const A = T[i].b, B = T[j].b;
    const ix = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), iy = Math.min(A[3], B[3]) - Math.max(A[1], B[1]); if (ix <= 0.15 || iy <= 0.15) continue;
    if (ix * iy < 0.08 * Math.min((A[2] - A[0]) * (A[3] - A[1]), (B[2] - B[0]) * (B[3] - B[1]))) continue;
    out.push(`${JSON.stringify(T[i].t)} (${T[i].id}) × ${JSON.stringify(T[j].t)} (${T[j].id})`); }
  return out;
}
for (const name of ["aia", "schaeffer", "walnut", "fpc", "mazatlan", "pavilion", "rmuh"]) {
  test(`${name}: no overlapping text on any sheet`, async () => {
    const mod = await import(`../src/sample_${name}.js`);
    const doc = Object.values(mod).find(f => typeof f === "function" && /^build/.test(f.name))();
    const bad = [];
    for (const sh of doc.elements().filter(f => doc.typeOf(f) === "Sheet")) for (const o of overlaps(doc, sh)) bad.push(`${doc.argValue(sh, "number")}: ${o}`);
    assert.deepEqual(bad.slice(0, 10), []);
  });
}
