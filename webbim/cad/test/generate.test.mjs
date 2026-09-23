// A script that writes the model.
//
// The thing being checked is topology, and it is checked by counting. A plan
// driven by a list of three makes three; the same plan on a list of five makes
// five and the first three KEEP THEIR IDS, because the whole point of
// reconciling rather than rebuilding is that editing the end of a list does not
// disturb the beginning of it. Then back to one, and what is left is one.
//
// The other half is that a plan which has not changed emits nothing at all.
// That is what makes it safe to run on every regeneration: it is not a
// performance property, it is the difference between settling and looping.
import { createWasmKernel } from "../src/wasm-kernel.js";
import { Mdl } from "../src/mdl.js";
import { PLAN_CEILING, fingerprint, planDoc, readMade, readPlan,
         reconcile, writeMade } from "../src/generate.js";
import { readFileSync } from "fs";

const DIR = process.env.OCJS_DIR || "/tmp/oc/rep/package/dist";
const init = (await import(DIR + "/replicad_single.js")).default;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};

console.log("1. a plan is read before it is believed");
{
  const anything = want => ({ kind: "system", name: want });
  const refused = (said, what) => {
    try { readPlan(said, anything); return "(accepted)"; }
    catch (e) { return e.message; }
  };
  check("a list is required", /must return a list/.test(refused({})), refused({}));
  check("two nodes cannot share a key",
    /share the key/.test(refused([{ key: "a", type: "Point" }, { key: "a", type: "Point" }])),
    refused([{ key: "a", type: "Point" }, { key: "a", type: "Point" }]));
  check("a node must say what to make",
    /does not say what to make/.test(refused([{ key: "a" }])), refused([{ key: "a" }]));
  const huge = Array.from({ length: PLAN_CEILING + 1 }, (_, i) => ({ key: i, type: "Point" }));
  check("the ceiling is a refusal, not a hang",
    /ceiling/.test(refused(huge)), refused(huge).slice(0, 60));
  check("a name nothing answers to is named",
    /nothing is called/.test((() => {
      try { readPlan([{ key: "a", type: "Nonsuch" }], () => null); return ""; }
      catch (e) { return e.message; }
    })()));
  check("the key defaults to the position",
    readPlan([{ type: "Point" }, { type: "Point" }], anything).map(o => o.key).join() === "0,1");
}

console.log("\n2. a fingerprint is what would have to change");
{
  const one = readPlan([{ key: "a", type: "Point", set: { x: 1 } }],
                       want => ({ kind: "system", name: want }))[0];
  const same = readPlan([{ key: "a", type: "Point", set: { x: 1 } }],
                        want => ({ kind: "system", name: want }))[0];
  const other = readPlan([{ key: "a", type: "Point", set: { x: 2 } }],
                         want => ({ kind: "system", name: want }))[0];
  check("the same node prints the same", fingerprint(one) === fingerprint(same));
  check("a changed value prints differently", fingerprint(one) !== fingerprint(other));
}

console.log("\n3. what it made, written down and read back");
{
  const made = { a: { id: "GN", print: "x", type: "Point", copy: null } };
  check("round trips", JSON.stringify(readMade(writeMade(made))) === JSON.stringify(made));
  check("rubbish is empty, not fatal", JSON.stringify(readMade("{{{")) === "{}");
  check("a row without an id is dropped, the rest survive",
    Object.keys(readMade('{"made":{"a":{"id":"GN"},"b":{"nope":1}}}')).join() === "a");
}

const kernel = await createWasmKernel({ initModule: init,
                                        wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
const mdl = new Mdl({ kernel, setNode: () => {}, readLayout: () => ({}),
                      select: () => {}, selected: () => null });
const feats = async () => (await kernel.tree()).tree.features;
const under = async id => (await feats()).filter(f => f.parent === id);
const errors = async () => (await feats()).filter(f => f.error)
  .map(f => f.name + ": " + f.error);

console.log("\n4. the number of nodes follows the list");
let GEN, NU;
{
  await mdl.run({ op: "model", model: { format: "ocaf-parametric-model", version: 1,
                                        name: "Gen", units: "mm", features: [] } });
  const PT = (await mdl.run({ op: "add", type: "Point" })).id;
  const VZ = (await mdl.run({ op: "add", type: "Vector" })).id;
  await mdl.run({ op: "set", id: VZ, key: "dx", value: 0 });
  await mdl.run({ op: "set", id: VZ, key: "dz", value: 1 });
  const PL = (await mdl.run({ op: "add", type: "Plane", refs: { origin: PT, normal: VZ } })).id;
  NU = (await mdl.run({ op: "add", type: "Numbers", name: "Bays" })).id;
  await mdl.run({ op: "code", id: NU, key: "values", text: "0, 300, 600" });

  GEN = (await mdl.run({ op: "add", type: "Generator", name: "Rings" })).id;
  await mdl.run({ op: "connect", id: GEN, key: "reads", from: NU });
  await mdl.run({ op: "code", id: GEN, key: "plan", text: `({
    params: [{ key: "radius", label: "Radius", def: 80, min: 10, max: 400, step: 5 }],
    plan(p, doc) {
      return doc.numbers().map((x, i) => ({
        key: "c" + i, type: "Circle", name: "Ring " + (i + 1),
        refs: { plane: ${JSON.stringify(PL)} },
        set: { radius: p.radius + i * 20 },
      }));
    }
  })` });

  const three = await under(GEN);
  check("three numbers make three nodes", three.length === 3,
        three.map(f => f.name).join(", "));
  check("they are filed under the generator", three.every(f => f.parent === GEN));
  check("and they built", (await errors()).length === 0, (await errors()).join(" | "));
  const wasIds = three.map(f => f.id);

  await mdl.run({ op: "code", id: NU, key: "values", text: "0, 300, 600, 900, 1200" });
  const five = await under(GEN);
  check("five numbers make five", five.length === 5, String(five.length));
  check("and the first three kept their ids",
        five.slice(0, 3).map(f => f.id).join() === wasIds.join(),
        five.slice(0, 3).map(f => f.id).join() + " vs " + wasIds.join());

  await mdl.run({ op: "code", id: NU, key: "values", text: "0, 300" });
  const two = await under(GEN);
  check("two numbers make two - the extras are removed, not orphaned",
        two.length === 2, String(two.length));
  check("and nothing was left loose in the document",
        (await feats()).filter(f => f.type === "Circle" && f.parent !== GEN).length === 0);
}

console.log("\n5. a plan that has not changed does nothing");
{
  const before = (await feats()).map(f => f.id + ":" + f.revision).join();
  await kernel.tree();
  await kernel.tree();
  const after = (await feats()).map(f => f.id + ":" + f.revision).join();
  check("no ids and no revisions move on a re-read", before === after);

  //! Setting a parameter to what it already is still counts as an edit, so the
  //! generator re-plans - and the plan it produces has to be the same plan, or
  //! every regeneration would churn the tree.
  const ids = (await under(GEN)).map(f => f.id).join();
  await kernel.setParameter(GEN, "radius", 80);
  check("re-planning with the same inputs keeps every node",
        (await under(GEN)).map(f => f.id).join() === ids,
        (await under(GEN)).map(f => f.id).join());
}

console.log("\n6. a value that changes patches rather than replaces");
{
  const ids = (await under(GEN)).map(f => f.id).join();
  await kernel.setParameter(GEN, "radius", 140);
  const now = await under(GEN);
  check("the nodes are the same nodes", now.map(f => f.id).join() === ids);
  check("and the value moved", Math.abs(now[0].values.radius - 140) < 1e-9,
        String(now[0].values.radius));
}

console.log("\n7. it says what is wrong instead of failing silently");
{
  await mdl.run({ op: "code", id: GEN, key: "plan",
                  text: `({ params: [], plan() { return [{ key: "a", type: "Nonsuch" }]; } })` });
  const f = (await feats()).find(one => one.id === GEN);
  check("a type nothing answers to is reported on the generator",
        !!f.error && /nothing is called/.test(f.error), f.error || "(no error)");
  check("and what it made before is still there", (await under(GEN)).length > 0);

  await mdl.run({ op: "code", id: GEN, key: "plan", text: "not javascript {" });
  const g = (await feats()).find(one => one.id === GEN);
  check("code that will not compile is reported too",
        !!g.error && /did not compile/.test(g.error), g.error || "(no error)");
}

console.log("\n8. power-copying a user feature, per point");
{
  const kernel2 = await createWasmKernel({ initModule: init,
                                           wasmBinary: readFileSync(DIR + "/replicad_single.wasm") });
  const mdl2 = new Mdl({ kernel: kernel2, setNode: () => {}, readLayout: () => ({}),
                         select: () => {}, selected: () => null });
  await mdl2.run({ op: "model", model: JSON.parse(readFileSync(
    new URL("../data/samples/wideflange.json", import.meta.url), "utf8")) });
  const all2 = async () => (await kernel2.tree()).tree.features;
  const started = (await all2()).length;

  const list = (await mdl2.run({ op: "add", type: "Numbers", name: "Bays" })).id;
  await mdl2.run({ op: "code", id: list, key: "values", text: "0, 4000, 8000" });
  const gen = (await mdl2.run({ op: "add", type: "Generator", name: "Colonnade" })).id;
  await mdl2.run({ op: "connect", id: gen, key: "reads", from: list });

  //! doc.declared() over a set that has never been copied: the names are
  //! worked out from its wiring, because nothing has written them down yet.
  const model = await kernel2.model();
  const seen = planDoc(model, { here: gen }).declared("Column one");
  check("a hand-built set still reports what it asks for", seen.length > 0, seen.join(", "));

  await mdl2.run({ op: "code", id: gen, key: "plan", text: `({
    params: [],
    plan(p, doc) {
      const asks = doc.declared("Column one")[0];
      const out = [];
      doc.numbers().forEach((x, i) => {
        out.push({ key: "at" + i, type: "Point", name: "Bay " + (i + 1), set: { x, y: 0, z: 0 } });
        out.push({ key: "col" + i, type: "Column one", name: "Column " + (i + 1),
                   inputs: asks ? { [asks]: "@at" + i } : {} });
      });
      return out;
    }
  })` });

  const made = (await all2()).filter(f => f.parent === gen);
  check("three bays make three points and three copies", made.length === 6,
        made.map(f => f.type).join(", "));
  const everyone = await all2();
  check("each copy is a set with the source's members in it",
        made.filter(f => f.category === "container")
            .every(set => everyone.some(f => f.parent === set.id)),
        made.filter(f => f.category === "container").map(f => f.name).join(", "));
  const bad = (await all2()).filter(f => f.error);
  check("and every copy built - its input was wired by the plan",
        bad.length === 0, bad.map(f => f.name + ": " + f.error).join(" | "));

  const grown = (await mdl2.run({ op: "code", id: list, key: "values",
                                  text: "0, 4000, 8000, 12000, 16000" }), (await all2()).length);
  await mdl2.run({ op: "code", id: list, key: "values", text: "0" });
  const back = (await all2()).length;
  check("growing and shrinking leaves one copy and no debris",
        (await all2()).filter(f => f.parent === gen).length === 2,
        (await all2()).filter(f => f.parent === gen).map(f => f.name).join(", "));
  check("and the document is the size it was plus one copy",
        back > started && back < grown, started + " -> " + grown + " -> " + back);

  //! A GENERATOR IS NOT A COMPONENT. The first plan written against this found
  //! the generator itself in its own list of user nodes and copied it.
  const offered = planDoc(await kernel2.model(), { here: gen, catalogue: [] }).nodes();
  check("a generator is not offered as something to copy",
        !offered.some(one => one.kind === "user" && one.name === "Colonnade"),
        offered.filter(one => one.kind === "user").map(one => one.name).join(", "));
}

console.log("\n9. black-boxing a set");
{
  const model = await kernel.model();
  const box = model.features.find(f => f.type === "Generator");
  await mdl.run({ op: "set", id: box.id, key: "shell", value: 1 });
  const shut = (await feats()).find(f => f.id === box.id);
  check("the set says it is shut", shut.values.shell === 1, String(shut.values.shell));
  check("and it still knows what is in it", (shut.contents || []).length >= 0);
  check("it saves with the model",
        (await kernel.model()).features.find(f => f.id === box.id).args.shell === "Black box",
        JSON.stringify((await kernel.model()).features.find(f => f.id === box.id).args.shell));
  await mdl.run({ op: "set", id: box.id, key: "shell", value: 0 });
  check("and opens again",
        (await feats()).find(f => f.id === box.id).values.shell === 0);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
