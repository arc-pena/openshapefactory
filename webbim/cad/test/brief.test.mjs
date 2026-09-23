// A turn has a size, and a building is bigger than it.
//
// The briefing used to carry `JSON.stringify(model)`, which is right for
// anything anybody models by hand and thirty-five times over the limit for an
// IFC building: what came back was not a bad answer but "the turns exceed the
// 64 KiB limit". So over a budget the document is sent as its shape instead,
// and any part of it can still be read exactly, by id.
//
// Checked against a document the size of a real one rather than against the
// source, because the thing that matters is the number of characters.
import { documentBrief, documentDigest, featureBrief } from "../src/agent.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};

//! A building's shape: folders of folders, and a few thousand extrusions cut
//! with each other. Not real geometry - the question here is about size.
function aBuilding(storeys = 6, perStorey = 200) {
  const features = [{ id: "GS1", type: "GeometricalSet", name: "Projekt", args: { shell: "Open" } }];
  for (let s = 0; s < storeys; s++) {
    const floor = "GS" + (s + 2);
    features.push({ id: floor, type: "GeometricalSet", name: "Storey " + s,
                    args: { shell: "Open" }, parent: "GS1" });
    for (let i = 0; i < perStorey; i++) {
      const id = "EX" + (s * perStorey + i);
      features.push({ id, type: "Extrude", name: "Wand-" + i + " [" + s + "]", parent: floor,
                      args: { profile: { ref: "SK" + i }, limit: "Distance",
                              distance: 2700 + i, cap: "Solid",
                              way: "Normal to the profile" } });
    }
  }
  return { format: "ocaf-parametric-model", version: 1, name: "A building",
           units: "mm", features };
}

console.log("1. a part goes whole, as it always did");
{
  const part = { name: "a bracket", units: "mm", features: aBuilding(1, 20).features };
  const brief = documentBrief(part);
  check("under the budget it is the document itself", brief.startsWith("{"));
  check("  and it is the whole of it", brief === JSON.stringify(part));
}

console.log("\n2. a building goes as its shape");
{
  const model = aBuilding();
  const whole = JSON.stringify(model);
  const brief = documentBrief(model);
  check("the document really is too big for a turn", whole.length > 64 * 1024,
        whole.length.toLocaleString() + " characters");
  check("the brief fits in one", brief.length < 64 * 1024,
        brief.length.toLocaleString() + " characters");
  check("  and it is not the document", !brief.startsWith("{"));
  check("it says how many features there are", brief.includes(model.features.length.toLocaleString()));
  check("it says what the document is made of", /1,?20[01] × Extrude|1200 × Extrude/.test(brief)
        || brief.includes("× Extrude"));
  check("it names the folders", brief.includes("Storey 0"));
  check("  with how much is in them", /\[200 items/.test(brief));
  check("it carries the newest features, where the work is",
        brief.includes("Wand-199 [5]"));
  check("and it says how to read the rest", /look/.test(brief));
}

console.log("\n3. and any part of it can still be read exactly");
{
  const model = aBuilding();
  const one = featureBrief(model, "GS2");
  check("a folder reads back as itself", one.found && one.feature.name === "Storey 0");
  check("  with what is inside it", one.insideCount === 200);
  check("  capped, so the answer fits too", one.inside.length <= 400);
  const missing = featureBrief(model, "NOPE");
  check("and an id that is not there says so", !missing.found && /NOPE/.test(missing.note));
}

console.log("\n4. the digest survives a document with nothing in it");
{
  const empty = { name: "empty", units: "mm", features: [] };
  const digest = documentDigest(empty);
  check("no features, no throw", typeof digest === "string" && digest.includes("0 features"));
  check("  and it says there are none in no folder", digest.includes("(none)"));
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall checks passed");
process.exit(failures ? 1 : 0);
