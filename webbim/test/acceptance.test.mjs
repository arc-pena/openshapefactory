// The §15 acceptance suite under node. The same cases run in the app's Diagnostics view.
import test from "node:test";
import assert from "node:assert/strict";
import { CASES } from "../src/acceptance.js";

for (const c of CASES) {
  test(`${c.id} · ${c.name}`, { skip: c.gap ? "known gap (see §16 notes)" : false }, () => {
    const r = c.fn();
    assert.ok(r.pass, `expected: ${r.expected}\n     got: ${r.got}${r.note ? "\n    note: " + r.note : ""}`);
  });
}
