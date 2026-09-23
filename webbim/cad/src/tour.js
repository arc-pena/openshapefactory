// Being shown round, by the program itself.
//
// Somebody opening this for the first time is looking at a rail of forty
// glyphs, a tree with four folders in it and an empty grey screen, and every
// one of those is obvious once you know and opaque until you do. The usual
// answer is a manual nobody reads and a video nobody finishes. This is the
// other answer: the program points at its own parts, one at a time, says what
// each is FOR rather than what it is called, and - where it matters - stops and
// waits for you to do the thing yourself.
//
// THREE RULES, and they are what separate this from a slideshow.
//
//   IT POINTS AT THE REAL THING. Every step spotlights an element that is
//   actually on screen and leaves it working. Nothing is a picture of the
//   interface; it is the interface, with the rest of it dimmed.
//
//   IT WAITS FOR YOU. The steps that teach a gesture - turning the model,
//   making a feature, changing a number - do not advance until it happens.
//   You cannot be shown how to turn a model by reading that you can.
//
//   IT NEVER TRAPS YOU. Every step can be skipped, the whole thing can be
//   left at any point with Escape, and it picks up where it stopped. A tour
//   you cannot get out of is worse than no tour.
//
// The content is written for somebody who has never used a CAD program, not
// for somebody who has used a different one. What a feature IS gets explained
// before what the button does.

//! Where the tour keeps what it knows about you: whether it has been offered,
//! and how far you got. Under the same prefix as every other preference.
const SEEN = "ocafcad/tour-seen";
const GOT_TO = "ocafcad/tour-step";

//! How often a waiting step looks to see whether you have done the thing. Five
//! times a second is instant to a person and nothing to a machine.
const WATCH_MS = 200;

/* ------------------------------------------------------------- the steps

   `at` is a selector for the thing being pointed at, and may match nothing -
   on a phone half of these are not on screen, and a step whose target is
   missing simply speaks from the middle instead of pointing. That is the whole
   of the phone handling, and it is enough.

   `before` sets the stage: opens the panel the step is about, selects the
   thing it is about. `wait` is what the step is waiting for you to do, with
   the words to put under the card while it waits.                          */

export function tourSteps(kit) {
  return [
    {
      id: "welcome",
      title: "This is a parametric modeller",
      body: "Nothing you make here is a drawing. It is a <b>recipe</b>: every "
          + "feature remembers what it was made from and what it was made with, "
          + "so any number in it can be changed afterwards and everything "
          + "downstream rebuilds itself.<br><br>Four minutes and you will know "
          + "where everything is.",
    },
    {
      id: "viewport",
      at: "#viewport",
      title: "The model, and how to look at it",
      //! ASKED OF THE PROGRAM, not written down here. Which button turns the
      //! model is a preference - some hands want the camera on the left
      //! button and the widgets behind a key, some the other way round - and
      //! a tour that teaches the wrong one is worse than no tour at all.
      body: kit.navigation() + "<br><br>Have a go - the tour waits here until "
          + "you do.",
      wait: { of: () => kit.turned(), hint: "turn the model with a drag" },
    },
    {
      id: "rail",
      at: "#rail",
      before: () => kit.show("rail", true),
      title: "Everything you can make",
      body: "Grouped by what it produces. <b>Datums</b> are the points, lines "
          + "and planes you set out on - they have no substance. <b>Curves</b> "
          + "are lines and sketches. <b>Solids</b> are bodies. "
          + "<b>Operations</b> change a body that already exists, and "
          + "<b>Sets</b> are folders to keep it all in.",
    },
    {
      id: "make",
      at: '#rail [data-type="Cube"]',
      before: () => kit.show("rail", true),
      title: "Make something",
      body: "Click the cube. It arrives at the origin at a default size - "
          + "every feature does, because a feature you cannot see is a feature "
          + "you cannot correct.",
      wait: { of: () => kit.has("Cube"), hint: "click the cube on the rail",
              give: () => kit.run({ op: "add", type: "Cube", name: "First block" }) },
    },
    {
      id: "tree",
      at: "#tree-panel",
      before: () => kit.show("tree", true),
      title: "Everything you have made",
      body: "In the order you made it. The eye beside a row puts it away "
          + "without deleting it; the folders hold what you file into them. "
          + "Click a row to select it, double-click to open it.<br><br>This is "
          + "the <b>specification</b>: the model IS this list.",
    },
    {
      id: "panel",
      at: "#def-panel",
      before: () => kit.pick("Cube") && kit.show("panel", true),
      title: "What a feature was made with",
      body: "Every number, every choice, every input. Change one and the model "
          + "rebuilds - not just this feature, but everything made from it.",
    },
    {
      id: "change",
      //! A SLIDER, not the first input in the panel - which is the name box,
      //! and "change a number" pointing at a name is the tour teaching the
      //! wrong thing in the one step that waits for the right one.
      at: '#def input[type="range"], #def input[type="number"], #def select',
      before: () => kit.pick("Cube") && kit.show("panel", true),
      title: "Change a number",
      body: "Drag a slider or type in a box. Watch the model while you do it.",
      wait: { of: () => kit.edited(), hint: "change any of its sizes" },
    },
    {
      id: "wiring",
      at: "#def-panel",
      title: "Features are wired to each other",
      body: "An input does not take a number you type in twice - it takes what "
          + "another feature <b>produces</b>. A field expecting a plane will "
          + "accept any plane in the model.<br><br>Click the field, then click "
          + "the thing: in the tree, or in the model itself.",
    },
    {
      id: "operations",
      at: "#rail",
      title: "An operation eats what it is made from",
      body: "A fillet is not something applied to a cube. It is a feature that "
          + "<b>consumes</b> the cube and produces a rounded one - so the cube "
          + "stays in the tree, still editable, and the fillet follows it.<br>"
          + "<br>That is why the tree is a history and not a pile.",
    },
    {
      id: "nodes",
      at: "#btn-graph",
      title: "The same model, as a graph",
      body: "The tree says the order things were made in. The graph says what "
          + "feeds what - the same model, drawn the way it actually is. You "
          + "can wire it there by dragging.",
    },
    {
      id: "styles",
      at: "#view-tools",
      title: "How it is drawn, and where from",
      body: "<b>Shaded</b> for modelling, <b>Rendered</b> for materials, "
          + "<b>Arctic</b> for form - white clay and a line on every edge, "
          + "with its own dials for how white and how dark. The other five are "
          + "standard views; <b>Fit</b> frames everything.",
    },
    {
      id: "section",
      at: "#viewport",
      title: "Cutting through it",
      body: "<kbd>X</kbd> cuts the model with a plane you can slide, and fills "
          + "the cut face so the building reads as solid rather than hollow. "
          + "<kbd>X</kbd> again puts it back.",
    },
    {
      id: "samples",
      at: "#btn-sample",
      title: "Somebody else's model to pull apart",
      body: "The fastest way to learn what this can do: open a worked example, "
          + "open its tree, and change its numbers. Nothing you do to one can "
          + "hurt anything.",
    },
    {
      id: "packages",
      at: "#btn-packages",
      title: "Packages add whole subjects",
      body: "Off until you ask for them. <b>IFC</b> opens building models. "
          + "<b>Climate</b> puts the sun where it really is. <b>Flow</b> walks "
          + "people through your plan. <b>Packing</b> fits a brief into a "
          + "massing. Each brings its own nodes and its own mode.",
    },
    {
      id: "assistant",
      at: "#btn-ai",
      title: "Or ask for it in words",
      body: "Describe what you want and watch it appear - as <b>nodes</b>, in "
          + "the tree, wired up, every one of them yours to change afterwards. "
          + "It edits through exactly the channel your own clicks do; there is "
          + "no second way into the model.",
    },
    {
      id: "keeping",
      at: "#btn-model",
      title: "Keeping it",
      body: "<b>Model</b> is the file: the whole parametric recipe as text, to "
          + "copy or to paste back. The document menu exports STEP, OBJ, STL "
          + "and DXF for everybody else's software.<br><br>Your work is also "
          + "kept in this browser as you go, so a closed tab is not a lost "
          + "afternoon.",
    },
    {
      id: "done",
      title: "That is the whole of it",
      body: "Make something, select it, change its numbers, wire the next "
          + "thing to it. Everything else is more of those four.<br><br>The "
          + "<b>?</b> button brings this back whenever you want it, and "
          + "<kbd>Esc</kbd> leaves it at any point.",
    },
  ];
}

/* --------------------------------------------------------------- the tour */

export function makeTour(kit) {
  const layer = document.getElementById("tour");
  const hole = document.getElementById("tour-hole");
  const card = document.getElementById("tour-card");
  const heading = document.getElementById("tour-title");
  const words = document.getElementById("tour-body");
  const hint = document.getElementById("tour-hint");
  const dots = document.getElementById("tour-dots");
  const count = document.getElementById("tour-count");
  const back = document.getElementById("tour-back");
  const next = document.getElementById("tour-next");
  const quit = document.getElementById("tour-quit");
  if (!layer) return { start() {}, stop() {}, running: () => false };

  let steps = [], at = -1, watching = null, following = null;

  //! LEAVING KEEPS YOUR PLACE, finishing does not. Somebody who stops halfway
  //! through and comes back wants the rest of it; somebody who read the last
  //! card and pressed Done wants the beginning if they ever ask again.
  const stop = (finished = false) => {
    clearInterval(watching); watching = null;
    cancelAnimationFrame(following); following = null;
    layer.hidden = true;
    kit.remember(GOT_TO, finished ? "" : String(Math.max(at, 0)));
    at = -1;
  };

  //! WHERE THE CARD GOES: beside the thing, on whichever side there is room
  //! for it, and in the middle when there is nothing to point at. Re-measured
  //! every frame while a step is up, because the thing being pointed at may be
  //! in a panel that is still opening - and because a step that waits for you
  //! to do something is pointing at a thing that is about to move.
  const place = target => {
    const gap = 14;
    const box = target ? target.getBoundingClientRect() : null;
    if (!box || !box.width || !box.height) {
      //! Everything dims and nothing is lit - which is what the first and last
      //! cards want. Set on the element rather than left to the stylesheet:
      //! the previous step wrote these as inline styles, and an inline style
      //! is not something a rule can take back.
      hole.hidden = false;
      hole.style.left = "50%"; hole.style.top = "50%";
      hole.style.width = "0px"; hole.style.height = "0px";
      card.style.left = "50%";
      card.style.top = "50%";
      card.style.transform = "translate(-50%, -50%)";
      return;
    }
    hole.hidden = false;
    hole.style.left = (box.left - 6) + "px";
    hole.style.top = (box.top - 6) + "px";
    hole.style.width = (box.width + 12) + "px";
    hole.style.height = (box.height + 12) + "px";

    const size = card.getBoundingClientRect();
    const room = { right: innerWidth - box.right, left: box.left,
                   below: innerHeight - box.bottom, above: box.top };
    let left, top;
    if (room.right >= size.width + gap) { left = box.right + gap; top = box.top; }
    else if (room.left >= size.width + gap) { left = box.left - size.width - gap; top = box.top; }
    else if (room.below >= size.height + gap) { left = box.left; top = box.bottom + gap; }
    else { left = box.left; top = box.top - size.height - gap; }
    card.style.transform = "none";
    card.style.left = Math.max(gap, Math.min(left, innerWidth - size.width - gap)) + "px";
    card.style.top = Math.max(gap, Math.min(top, innerHeight - size.height - gap)) + "px";
  };

  const show = async n => {
    clearInterval(watching); watching = null;
    at = Math.max(0, Math.min(n, steps.length - 1));
    const step = steps[at];
    kit.remember(GOT_TO, String(at));

    if (step.before) { try { await step.before(); } catch (err) { /* a closed panel is not fatal */ } }

    heading.textContent = step.title;
    words.innerHTML = step.body;
    count.textContent = (at + 1) + " of " + steps.length;
    back.disabled = at === 0;
    next.textContent = at === steps.length - 1 ? "Done" : "Next";
    dots.textContent = "";
    for (let i = 0; i < steps.length; i++) {
      const dot = document.createElement("span");
      dot.className = "tour-dot" + (i === at ? " here" : i < at ? " past" : "");
      dot.addEventListener("click", () => show(i));
      dots.appendChild(dot);
    }

    //! WAITING IS THE POINT OF THE THING, so it is said out loud rather than
    //! left as a card that has mysteriously stopped. `give` is the way out for
    //! somebody who would rather be shown: it does the step for them.
    hint.hidden = !step.wait;
    if (step.wait) {
      hint.textContent = "← " + step.wait.hint;
      const began = kit.mark();
      watching = setInterval(() => {
        let done = false;
        try { done = !!step.wait.of(began); } catch (err) { done = false; }
        if (done) { clearInterval(watching); watching = null; show(at + 1); }
      }, WATCH_MS);
    }

    //! Followed rather than placed once: a panel that is opening, a model that
    //! is being turned, a window being resized - the card keeps up with all of
    //! them for the price of one getBoundingClientRect a frame.
    const target = step.at ? document.querySelector(step.at) : null;
    const follow = () => { place(target); following = requestAnimationFrame(follow); };
    cancelAnimationFrame(following);
    follow();
  };

  const start = (from = 0) => {
    steps = tourSteps(kit);
    layer.hidden = false;
    kit.remember(SEEN, "yes");
    show(from);
  };

  next.addEventListener("click", () => {
    if (at >= steps.length - 1) { stop(true); return; }
    //! "Next" over a waiting step is "show me instead" - the step does itself
    //! and moves on, rather than leaving somebody stuck at a gesture they
    //! cannot make on the machine they are on.
    const step = steps[at];
    if (step && step.wait && step.wait.give) { try { step.wait.give(); } catch (err) { /* it stays */ } }
    show(at + 1);
  });
  back.addEventListener("click", () => show(at - 1));
  quit.addEventListener("click", () => stop());
  addEventListener("keydown", event => {
    if (layer.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); stop(); }
    else if (event.key === "ArrowRight") { event.preventDefault(); next.click(); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); back.click(); }
  });

  return {
    start,
    stop,
    running: () => !layer.hidden,
    //! Where it got to last time, so the ? button offers to carry on rather
    //! than starting the whole thing again.
    resume: () => start(Number(kit.recall(GOT_TO)) || 0),
    offered: () => kit.recall(SEEN) === "yes",
  };
}
