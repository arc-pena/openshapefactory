// The model that explains itself.
//
// A scheme is not communicated by a model. It is communicated by a SEQUENCE -
// here is the site, here is the move, here is what that move buys you - and
// every office in the world rebuilds that sequence by hand in a slide deck
// with screenshots that go stale the moment the model changes.
//
// So the sequence is in the model file: beats, each one a camera to fly to, a
// few numbers to arrive at, what to show and hide, and a sentence about why.
// What is checked here is the clock - where you are at eleven seconds, and
// what the state of the world should be when you get there.
import { BEAT_FIELDS, DEFAULT_HOLD, DEFAULT_SECONDS, EASES, beatFromHere, easeAt,
         momentAt, moveBeat, readStory, saysStory, startOf, stateAt, timeline,
         valuesBetween, writeStory } from "../src/story.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;

console.log("1. reading one, tolerantly");
{
  const beats = readStory(JSON.stringify([
    { name: "The site", text: "One way in.", camera: "CAM1", hold: 5 },
    { name: "The move", camera: "CAM2", seconds: 2, hold: 3, set: { "TR1.dz": 3000 } },
  ]));
  check("two beats", beats.length === 2);
  check("every field a beat can have is a field it has",
        BEAT_FIELDS.every(key => key in beats[0]), Object.keys(beats[0]).join());
  check("and what was left out has a sensible answer",
        beats[0].seconds === DEFAULT_SECONDS && beats[1].hold === 3
        && beats[0].ease === "smooth", JSON.stringify(beats[0]));
  // A story somebody edited by hand at ten to nine should lose the beat it got
  // wrong, not the presentation.
  const rough = readStory('[{"name":"Fine"}, 42, null, {"name":"Also fine"}]');
  check("rubbish in the list is dropped, not fatal", rough.length === 2,
        JSON.stringify(rough.map(b => b.name)));
  check("and rubbish for the whole thing is an empty story, not a throw",
        readStory("{{{").length === 0);
  check("a set key that is not feature.parameter is left out",
        Object.keys(readStory('[{"name":"x","set":{"bananas":3,"TR1.dz":9}}]')[0].set)
          .join() === "TR1.dz");
  check("and so is one whose value is not a number",
        Object.keys(readStory('[{"name":"x","set":{"TR1.dz":"tall"}}]')[0].set).length === 0);
  check("what is written out reads back the same",
        readStory(writeStory(beats)).length === 2);
  check("five ways of easing", EASES.length === 5, EASES.map(e => e.key).join());
  check("smooth is slow at both ends",
        near(easeAt("smooth", 0), 0) && near(easeAt("smooth", 1), 1)
        && near(easeAt("smooth", 0.5), 0.5) && easeAt("smooth", 0.25) < 0.25);
  check("even is even", near(easeAt("linear", 0.3), 0.3));
  check("and a cut is not a flight at all",
        easeAt("cut", 0.99) === 0 && easeAt("cut", 1) === 1);
}

console.log("\n2. the clock");
{
  // The first beat has no flight: you are already there when it starts. So
  // five, then two of flight and three of hold, then two and three again.
  const beats = readStory(JSON.stringify([
    { name: "a", hold: 5 },
    { name: "b", seconds: 2, hold: 3 },
    { name: "c", seconds: 2, hold: 3 },
  ]));
  const line = timeline(beats);
  check("the first beat does not fly in", line.rows[0].flight === 0);
  check("the whole thing runs fifteen seconds", near(line.seconds, 15),
        String(line.seconds));
  check("and each beat knows when it starts",
        line.rows.map(r => r.from).join() === "0,5,10", line.rows.map(r => r.from).join());

  check("at nought you are on the first beat, arrived",
        momentAt(beats, 0).at === 0 && !momentAt(beats, 0).flying);
  check("at six you are a second into the second beat's flight",
        momentAt(beats, 6).at === 1 && momentAt(beats, 6).flying
        && near(momentAt(beats, 6).raw, 0.5), JSON.stringify(momentAt(beats, 6)).slice(0, 80));
  check("at eight you have landed on it",
        momentAt(beats, 8).at === 1 && !momentAt(beats, 8).flying);
  check("and the number handed on is already eased",
        near(momentAt(beats, 6).t, easeAt("smooth", 0.5)), String(momentAt(beats, 6).t));
  check("past the end is the end", momentAt(beats, 900).at === 2);
  check("and before the beginning is the beginning", momentAt(beats, -9).at === 0);
  check("a story of nothing has no moment at all", momentAt([], 3) === null);
  check("pressing a row goes to where that beat has landed",
        near(startOf(beats, 1), 7) && near(startOf(beats, 2), 12),
        startOf(beats, 1) + ", " + startOf(beats, 2));
}

console.log("\n3. what the world should look like when you get there");
{
  // JUMPING INTO THE MIDDLE has to land in the state the sequence would have
  // been in - not in whatever the last person left behind. So the state at a
  // beat is everything it and every beat before it asked for.
  const beats = readStory(JSON.stringify([
    { name: "a", camera: "CAM1", show: ["SITE"], set: { "TR1.dz": 0 } },
    { name: "b", camera: "CAM2", show: ["MASS"], hide: ["SITE"],
      set: { "TR1.dz": 9000 } },
    { name: "c", set: { "TR1.rz": 30 },
      section: { axis: "z", at: 1500, style: "poche" } },
  ]));
  const one = stateAt(beats, 0);
  check("the first beat shows what it shows", one.shown.join() === "SITE");
  const two = stateAt(beats, 1);
  check("the second turns the first's off again",
        two.hidden.join() === "SITE" && two.shown.join() === "MASS",
        JSON.stringify(two));
  check("and the numbers are the latest answer", two.values["TR1.dz"] === 9000);
  const three = stateAt(beats, 2);
  check("a beat with no camera keeps the one before", three.camera === "CAM2");
  check("numbers from earlier beats are still there",
        three.values["TR1.dz"] === 9000 && three.values["TR1.rz"] === 30,
        JSON.stringify(three.values));
  check("and a section is a section", three.section.style === "poche"
        && three.section.at === 1500);

  // Partway through a flight the numbers are partway between.
  const half = valuesBetween(beats, 1, 0.5);
  check("halfway through the flight, halfway to the number",
        near(half["TR1.dz"], 4500), String(half["TR1.dz"]));
  check("and all the way at the end", near(valuesBetween(beats, 1, 1)["TR1.dz"], 9000));
  // A NUMBER THE BEAT BEFORE NEVER MENTIONED starts from the live model, so a
  // tween into it always starts from the truth rather than from nought.
  const fresh = valuesBetween(beats, 2, 0.5, { "TR1.rz": 10 });
  check("a number nobody set before starts from where the model has it",
        near(fresh["TR1.rz"], 20), String(fresh["TR1.rz"]));
}

console.log("\n4. writing one");
{
  const made = beatFromHere("Beat 1", "CAM7", "Because.");
  check("a beat from here names its camera", made.camera === "CAM7");
  check("with times somebody can live with",
        made.seconds === DEFAULT_SECONDS && made.hold === DEFAULT_HOLD);
  const beats = readStory(JSON.stringify([{ name: "a" }, { name: "b" }, { name: "c" }]));
  check("a beat moves up", moveBeat(beats, 2, -1).map(b => b.name).join() === "a,c,b",
        moveBeat(beats, 2, -1).map(b => b.name).join());
  check("and down", moveBeat(beats, 0, 1).map(b => b.name).join() === "b,a,c");
  check("off the end it does not move at all",
        moveBeat(beats, 0, -1).map(b => b.name).join() === "a,b,c");
  check("and the list it was given is not the list it changed",
        beats.map(b => b.name).join() === "a,b,c");

  check("a story says how long it runs", saysStory(beats) === "3 beats · 18 s",
        saysStory(beats));
  check("one beat is one beat", /^1 beat ·/.test(saysStory([beats[0]])),
        saysStory([beats[0]]));
  check("and none is empty", saysStory([]) === "empty");
  check("a long one says the minutes",
        /min/.test(saysStory(readStory(JSON.stringify(
          new Array(20).fill({ name: "x", hold: 6, seconds: 3 }))))),
        saysStory(readStory(JSON.stringify(new Array(20).fill({ name: "x", hold: 6, seconds: 3 })))));
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
