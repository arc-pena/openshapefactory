// Nothing over anything else, at any size of window.
//
// The interface floats over the model, which is the point - but floating over
// the MODEL and floating over each other are different things and only the
// first one is wanted. Two rules make that true and both of them are easy to
// break by writing ordinary CSS, so both are checked here, against the
// stylesheet itself.
//
// ONE. The interface is SCALED on a big monitor, with `zoom`. A zoom scales a
// box and its offsets after the browser has worked them out, and it does not
// scale what a viewport unit or a percentage resolved to - so `100vh` inside a
// panel at 1.15 comes back as the window's height and renders fifteen per cent
// taller than the window, and a bar centred with `left: 50%` sits a hundred and
// forty pixels right of centre. Every such measurement goes through --sky and
// --span, which divide by the scale.
//
// TWO. What is down each side is not knowable in CSS - the rail's width
// depends on how many tools a package added, the definition panel is wider for
// a script - so the page measures it into --left-dock and --right-dock, and
// everything in the middle is written against --free and --middle.
//
// The browser check that goes with this one is a harness that opens the real
// page at eleven window sizes and measures every pair of panels for overlap.
// This is the part that can run in a second, and it is the part that catches
// the mistake being made again.
import { readFileSync } from "fs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const style = html.slice(html.indexOf("<style>"), html.lastIndexOf("</style>"));

//! Every declaration in the sheet, as { rule, property, value }, with the
//! comments taken out so prose about 100vh is not mistaken for 100vh.
const bare = style.replace(/\/\*[\s\S]*?\*\//g, "");
//! Every declaration in the sheet, with the @media overrides told apart from
//! the plain ones: a phone lays these out differently on purpose - full width,
//! stacked on the dock - and that is not the mistake being looked for.
function declarations(css, inMedia = false) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = css.slice(i, open).trim().split("\n").pop().trim();
    // Walk to the matching brace, so a @media block is taken whole.
    let depth = 1, j = open + 1;
    while (j < css.length && depth) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith("@")) out.push(...declarations(body, true));
    else for (const line of body.split(";")) {
      const cut = line.indexOf(":");
      if (cut < 0) continue;
      out.push({ selector: head, inMedia,
                 prop: line.slice(0, cut).trim(), value: line.slice(cut + 1).trim() });
    }
    i = j;
  }
  return out;
}
const rules = declarations(bare);

//! The panels that float over the model - the ones a viewport unit or a
//! percentage would mis-place. Matched EXACTLY, because a badge hanging off the
//! end of a button inside one is positioned against the button and is nobody's
//! business here.
const FLOATS = ["#chip", "#rail", "#sketch-rail", "#tree-panel", "#def-panel", "#status",
                "#view-tools", "#mesh-bar", "#sketch-bar", "#ai-bar", "#log-pop",
                "#packages", "#menu", "#sample-menu", ".fl-bar", ".fl-panel", ".an-bar",
                ".an-panel", ".sp-bar", ".sp-panel", ".mx-bar", "dialog"];
const isFloat = selector => selector.split(",").some(one => FLOATS.includes(one.trim()));

console.log("1. the scaled interface measures the window in its own units");
{
  check("there are declarations to check at all", rules.length > 300, String(rules.length));
  const sky = rules.find(r => r.prop === "--sky");
  const span = rules.find(r => r.prop === "--span");
  check("--sky is the window's height divided by the scale",
        sky && /100vh\s*\/\s*var\(--ui\)/.test(sky.value), sky && sky.value);
  check("--span is its width, the same way",
        span && /100vw\s*\/\s*var\(--ui\)/.test(span.value), span && span.value);

  // And nothing else uses a raw viewport unit. A rule that does is a rule that
  // is right at --ui 1 and wrong on the monitor the office actually uses.
  const raw = rules.filter(r => !r.prop.startsWith("--")
    && /\b\d*\.?\d+v(h|w|min|max)\b/.test(r.value));
  check("no rule measures the window without dividing by the scale",
        raw.length === 0, raw.map(r => r.selector + " { " + r.prop + ": " + r.value + " }").join(" | "));

  // Nor positions itself at a percentage of it, which has the same fault.
  const half = rules.filter(r => (r.prop === "left" || r.prop === "top"
    || r.prop === "right" || r.prop === "bottom") && /%/.test(r.value)
    && isFloat(r.selector));
  check("and none places itself at a percentage of the window",
        half.length === 0, half.map(r => r.selector + " { " + r.prop + ": " + r.value + " }").join(" | "));
}

console.log("\n2. the middle knows what the sides have taken");
{
  for (const name of ["--rail-dock", "--left-dock", "--right-dock", "--free", "--middle"])
    check(name + " is declared", rules.some(r => r.prop === name));

  const free = rules.find(r => r.prop === "--free");
  check("the free middle is the window less both sides",
        free && /--left-dock/.test(free.value) && /--right-dock/.test(free.value), free && free.value);
  const middle = rules.find(r => r.prop === "--middle");
  check("and its middle is measured from the left side, not from the window",
        middle && /--left-dock/.test(middle.value) && /--free/.test(middle.value),
        middle && middle.value);

  // THE BARS. Everything that runs along the top or the bottom of the window is
  // centred on the middle and fits inside it. A bar that is centred on the
  // WINDOW runs under the definition panel the moment one is open, which is
  // what it used to do.
  // By the selector the sheet uses for each, which for the mesh editor's bar is
  // its class rather than its id.
  const bars = ["#sketch-bar", ".mx-bar", ".fl-bar", ".an-bar", ".sp-bar", "#ai-bar"];
  for (const bar of bars) {
    // The rule as the desktop has it. A phone lays these out differently on
    // purpose - full width, stacked on the dock - and that override is not the
    // mistake this is looking for.
    const mine = rules.filter(r => !r.inMedia
      && r.selector.split(",").map(s => s.trim()).includes(bar));
    const placed = mine.find(r => r.prop === "left");
    check(bar + " is centred on the free middle",
          placed && /var\(--middle\)/.test(placed.value),
          placed ? placed.value : "no left rule");
    const fits = mine.some(r => (r.prop === "width" || r.prop === "max-width")
                             && /var\(--free\)/.test(r.value));
    check(bar + " fits in it", fits,
          mine.filter(r => /width/.test(r.prop)).map(r => r.prop + ": " + r.value).join(", ")
          || "no width rule");
  }

  // THE SIDES. The left column hangs off the rail, so stowing the rail really
  // does give the room back rather than leaving a hole.
  const tree = rules.filter(r => r.selector.includes("#tree-panel") && r.prop === "left");
  check("the tree stands beside the rail rather than at a fixed offset",
        tree.some(r => /var\(--rail-dock\)/.test(r.value)), tree.map(r => r.value).join(" | "));
  const shelf = rules.filter(r => r.selector.includes("#packages") && r.prop === "right");
  check("the package shelf keeps clear of whatever is down the right",
        shelf.some(r => /var\(--right-dock\)/.test(r.value)), shelf.map(r => r.value).join(" | "));
}

console.log("\n3. the corners, and the panels above them");
{
  const corner = rules.find(r => r.prop === "--corner");
  check("--corner says what the bottom corners claim", !!corner, corner && corner.value);
  // A panel in a top corner runs to the bottom of the window, so it has to stop
  // short of whatever is in the bottom corner - the status line on the left,
  // the view controls on the right.
  for (const panel of ["#def-panel", "#tree-panel", ".fl-panel", ".an-panel"]) {
    const mine = rules.filter(r => r.selector.split(",").map(s => s.trim()).includes(panel)
                                && r.prop === "max-height");
    check(panel + " stops above the bottom corner",
          mine.some(r => /var\(--corner\)/.test(r.value)),
          mine.map(r => r.value).join(" | ") || "no max-height");
  }
}

console.log("\n4. what can be put away can be brought back");
{
  check("a stowed rail is off the edge rather than merely invisible",
        /body\.no-rail #rail/.test(bare) && /#rail[^{]*\{[^}]*transition/.test(bare)
        || /transition:[^;]*left/.test(bare),
        "the rail slides");
  check("and it is unclickable while it is off there",
        /body\.no-rail[^{]*\{[^}]*visibility:\s*hidden/.test(bare));
  check("the chip carries the switch that brings it back",
        /id="btn-rail"/.test(html) && /id="btn-panel"/.test(html));
  check("and the switches say which way they are",
        /#chip \.pane\[aria-pressed="true"\]/.test(bare));
  check("a pane switch is not drawn as a mode",
        /aria-pressed="true"\]:not\(\.pane\)/.test(bare));
  check("the status line stands down when a bar takes its row",
        /body\.barred #status/.test(bare));
  check("and it keeps its box while it does, or the answer would flicker",
        /body\.barred #status\s*\{[^}]*visibility:\s*hidden/.test(bare),
        (bare.match(/body\.barred #status\s*\{[^}]*\}/) || [""])[0]);
}

console.log("\n5. the tree reads, folds and searches");
{
  // A TREE THAT TRUNCATES IS A TREE YOU CANNOT READ, and one that scrolls
  // sideways is worse: you lose the row you were on to go and find the rest
  // of its name. So the panel is sized by what is in it and the names wrap.
  check("the tree panel is sized by its contents",
        /#tree-panel\s*\{[^}]*width:\s*max-content/.test(bare),
        (bare.match(/#tree-panel\s*\{[^}]*\}/) || [""])[0].slice(0, 120));
  check("with a floor so it does not twitch narrower as sets are folded",
        /#tree-panel\s*\{[^}]*min-width:/.test(bare));
  check("and a ceiling so it never eats the model",
        /#tree-panel\s*\{[^}]*max-width:/.test(bare));
  check("a name is never cut off into an ellipsis",
        !/\.node \.label\s*\{[^}]*text-overflow/.test(bare),
        (bare.match(/\.node \.label\s*\{[^}]*\}/) || [""])[0]);
  //! BREAK-WORD, NOT ANYWHERE. Both wrap; the difference is what they say the
  //! narrowest the box could be is. `anywhere` says one character, and a panel
  //! sized by its contents believes it - a name out of an IFC file came down
  //! the tree one letter per line for thirty rows. `break-word` asks for the
  //! longest word and breaks inside one only when it is short of room.
  check("and it wraps rather than running off the side",
        /\.node \.label\s*\{[^}]*overflow-wrap:\s*break-word/.test(bare),
        (bare.match(/\.node \.label\s*\{[^}]*\}/) || [""])[0]);
  check("  without telling the panel one character is a width",
        !/\.node \.label\s*\{[^}]*overflow-wrap:\s*anywhere/.test(bare));
  check("the tree scrolls down and never across",
        /#tree\s*\{[^}]*overflow-x:\s*hidden/.test(bare)
        && /#tree\s*\{[^}]*overflow-y:\s*auto/.test(bare),
        (bare.match(/#tree\s*\{[^}]*\}/) || [""])[0]);
  check("every row has a place for the fold sign, whether or not it folds",
        /\.twist\s*\{[^}]*width:/.test(bare) && /\.twist\.bare/.test(bare));
  check("and a folded branch is really gone, not merely faint",
        /\.branch\[hidden\]\s*\{[^}]*display:\s*none/.test(bare));
  check("the heading turns into a search box",
        /id="tree-search"/.test(html) && /id="tree-title"/.test(html));
  check("which completes the names of the sets",
        /id="tree-names"/.test(html) && /list="tree-names"/.test(html));
  check("and what it matched is marked in the row",
        /\.node \.label mark/.test(bare));
}

console.log("\n8. a tree with seven thousand rows in it");
{
  //! A BUILDING IS NOT A PART. An IFC import is 7,548 features and 1,665
  //! sets; the tree drew every row of every folded branch and then hid them,
  //! rebuilt itself whenever anything was SELECTED, and asked "what is in
  //! this set" by filtering the whole document twice per folder. Measured on
  //! the model that brought it up: 3,754 ms to fold one branch, and the same
  //! 3,754 ms to click a column in the viewport.
  //!
  //! These are the things that fixed it, checked in the source because each
  //! of them is a one-line mistake to make again.
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  check("what is in a set is indexed, not filtered out of the whole document",
        /function kidsOf\(/.test(app)
        && !/state\.tree\.features\.filter\(f => f\.parent === entry\.id\)/.test(app));
  check("a folded branch builds no rows at all",
        /if \(folded\) \{[\s\S]{0,240}?return holder;/.test(app));
  check("selecting repaints the tree rather than building it",
        /function paintTree\(/.test(app) && /paintTree\(\); buildPanel\(\)/.test(app));
  check("every set can be folded at once, and opened again", /function foldAll\(/.test(app));
  check("and a row can be found from the model", /function revealInTree\(/.test(app));
  check("the tree header has a fold-everything and an open-everything",
        /id="tree-fold"/.test(html) && /id="tree-unfold"/.test(html));
  check("a row that was scrolled to says so",
        /#tree \.node\.found\s*\{[^}]*animation/.test(bare));
  //! A name may wrap and a KIND may not: one is what the thing is called, the
  //! other is a word about it. A consumed body's kind is "in <whatever ate
  //! it>", which out of an IFC file is sixty characters and took the row.
  check("the kind is cut short rather than taking the row",
        /\.node \.kind\s*\{[^}]*text-overflow:\s*ellipsis/.test(bare));
  check("and the name keeps a width it can be read in",
        /\.node \.label\s*\{[^}]*min-width:\s*\d+ch/.test(bare));
}

console.log("\n8b. an eye is not an edit");
{
  //! WHAT A VISIBILITY TOGGLE MAY WRITE INTO THE DOCUMENT, which is almost
  //! nothing. Hiding is this window's own list; the one exception is a body
  //! another feature was BUILT FROM, which the document itself says is not
  //! drawn - clicking its eye overrules that, and overruling it is a real
  //! edit that is saved.
  //!
  //! That exception was applied to the CONTENTS the toggle pulled in as well
  //! as to the row somebody clicked, and on a building imported from IFC one
  //! click on one set wrote `shownAnyway` onto 715 features: every profile,
  //! every extrusion, every boolean that something else was built from, all
  //! of it into the file.
  //!
  //! It did not read as a visibility bug. A wall is an Extrude with its
  //! openings cut out by a Boolean, so force-showing the Extrude draws the
  //! wall as it was BEFORE its openings, over the top of the one with them:
  //! the walls overshoot their reveals and the model looks edited. Measured
  //! on the file it was reported with, against the same file saved before the
  //! clicking: not one argument of not one feature differed - only 715
  //! shownAnyway flags, and every one of the 715 was a feature another
  //! feature reads from.
  //!
  //! Checked in the source because it is a one-word mistake to make again -
  //! `ids` and `named` are both in scope on the line, and one of them is a
  //! whole storey.
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const body = (app.match(/function showFeature\([\s\S]*?\n\}/) || [""])[0];
  check("showFeature keeps what was clicked apart from what it contains",
        /const named = Array\.isArray\(id\)/.test(body)
        && /const ids = withContents\(named\)/.test(body));
  check("the hidden list takes the contents, because hiding a set hides it all",
        /for \(const one of ids\) \{ if \(on\) state\.hidden\.delete/.test(body));
  check("but the document edit is only for the rows somebody named",
        /const swallowed = on \? named\.filter\(/.test(body));
  check("and it is never sent when hiding, which needs no edit at all",
        /const swallowed = on \? [^:]+: \[\];/.test(body));
}

console.log("\n9. and a viewport with seven hundred thousand triangles in it");
{
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  check("what is off screen is not drawn", /detailFrustum\.intersectsSphere/.test(app));
  check("  asked of a sphere worked out once, not of the triangles",
        /function ballOf\(/.test(app) && /userData\.ball = ballOf\(group\)/.test(app));
  check("what is under a couple of pixels is not drawn either",
        /across < detail\.vanish/.test(app));
  check("and over the budget the rest is drawn as boxes",
        /if \(bill > detail\.frame\)/.test(app));
  check("  worst value first - the most triangles for the fewest pixels",
        /across \* g\.userData\.across/.test(app));
  check("  in ONE geometry, or a thousand boxes is a thousand draw calls",
        /function rebuildBoxes\(/.test(app));
  //! The one that broke it while it was being written: how big the MODEL is
  //! and what THIS FRAME can see are different questions, and both were
  //! answered by group.visible - so a fit framed whatever the last frame had
  //! culled, and a building on survey coordinates was left four hundred
  //! kilometres off screen.
  check("how big the model is does not ask what the camera culled",
        /showsInModel/.test(app) && /showsInModel\(id, group\)/.test(app));
  check("and the picker is not handed a new array on every pointer move",
        /function pickableNow\(/.test(app)
        && !/pickable\.filter\(m => m\.parent/.test(app));
}

console.log("\n10. and a building that arrives before it has been tessellated");
{
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const kernel = readFileSync(new URL("../src/wasm-kernel.js", import.meta.url), "utf8");
  check("the kernel can be asked where a shape is without meshing it",
        /async boxes\(ids\)/.test(kernel));
  check("  and it answers with the extents, not with triangles",
        /low, high, faces,/.test(kernel));
  check("a big model goes in as stand-ins first", /function standIn\(/.test(app)
        && /stale\.length >= LAZY_FROM/.test(app));
  check("  which cost no triangles, truthfully",
        /group\.userData\.triangles = 0;/.test(app));
  check("the frame that sees a gap is what asks for it",
        /hungry\.push\(\{ id, across \}\)/.test(app)
        && /if \(hungry\.length\) feedTheView\(hungry\)/.test(app));
  check("  biggest on screen first", /hungry\.sort\(\(a, b\) => b\.across - a\.across\)/.test(app));
  //! The loop that would never end: a shape the kernel has nothing to say
  //! about is still waiting on the next frame, and asked for again.
  check("  and asked-for counts as answered", /if \(!unmeshed\.has\(id\)\) continue;/.test(app));
  check("a cut and a showroom get the whole model", /async function makeResident\(/.test(app)
        && /makeResident\("Cutting the model/.test(app));
  //! Measured where it is paid rather than inside the animation frame, which
  //! is where it is not.
  check("how long a frame costs is measured at the yield after it",
        /paintCost = paintCost \/ 2/.test(app) && !/lastFrameMs/.test(app));
  //! Handed a feature where it wanted an id, so it stopped one level in - and
  //! on a building, where every storey is sets of sets, the eye on a storey
  //! stayed open however much of it you put away.
  check("a set's eye asks what is inside it, all the way down",
        /if \(walk\(child\.id\)\) return true/.test(app));
  check("and the fit asks the document, not a flag written later",
        /const entry = feature\(id\);\n  if \(entry\) return entry\.visible !== false/.test(app));
  check("the feature lookup is a map, not a walk of six thousand",
        /namedFeatures = new Map\(\)/.test(app)
        && !/features\.find\(f => f\.id === id\)/.test(app));
}

console.log("\n10b. and the modelling off the thread the window is drawn on");
{
  const worker = readFileSync(new URL("../src/kernel-worker.js", import.meta.url), "utf8");
  const proxy = readFileSync(new URL("../src/worker-kernel.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const host = readFileSync(new URL("../src/plugin.js", import.meta.url), "utf8");
  const build = readFileSync(new URL("../build.py", import.meta.url), "utf8");

  check("every call goes down the port by name", /kernel\[call\]/.test(worker)
        && /post\(\{ id, ok: true, value: await method\.apply/.test(worker));
  //! A call that throws and says nothing leaves a promise on the page that
  //! never settles, which is the thing this whole arrangement exists to stop.
  check("  and a call that throws answers too", /post\(\{ id, ok: false, error:/.test(worker));
  check("  and a worker that dies tells every call waiting on it",
        /for \(const \[, answer\] of waiting\) answer\.reject\(why\)/.test(proxy));
  check("the page's side is built from the kernel's own methods, not a list",
        /for \(const name of started\.calls\)/.test(proxy));
  check("the WebAssembly is handed over rather than copied",
        /wasmBinary \? \[wasmBinary\] : \[\]/.test(proxy));
  //! import.meta.url in a blob worker is a blob: URL, which cannot be a base -
  //! so the glue must not be left to work the path out for itself.
  check("and the glue is told where the file is rather than guessing",
        /locateFile: name => name/.test(worker) && /options\.locateFile = locateFile/.test(
          readFileSync(new URL("../src/wasm-kernel.js", import.meta.url), "utf8")));
  check("a browser with no worker still models, in the page",
        /pageKernel = await makePageKernel\(\)/.test(app)
        && /this browser would not start a worker/.test(app));
  //! A driver closes over the kernel, and a closure does not cross a port.
  check("a package with nodes is switched on where the modelling is",
        /usePackage\(id\)/.test(worker) && /await this\.kit\.usePackage\(id\)/.test(host));
  check("  keyed by the package's own id, not by a name written twice",
        /SHELF\[plugin\.id\] = plugin/.test(worker));
  check("  and the drivers are not even built on the page's side",
        /typeof plugin\.drivers === "function" \? plugin\.drivers\(this\.kit\)/.test(host));
  check("the single file carries the worker's own bundle",
        /worker-payload/.test(build) && /def worker_modules\(\)/.test(build));
  check("  which cannot be the page's script - it would take over onmessage",
        /WORKER_ENTRY = "kernel-worker\.js"/.test(build)
        && !/"kernel-worker\.js",/.test(build.split("MODULES = ")[1].split("]")[0]));
}

console.log("\n10c. and somebody opening it for the first time with nobody beside them");
{
  const tour = readFileSync(new URL("../src/tour.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");

  check("there is a button that explains the program", /id="btn-help"/.test(shell)
        && /ICONS\.help/.test(app));
  check("  and it comes up by itself the first time, once",
        /if \(!tour\.offered\(\)\) setTimeout/.test(app));
  //! A picture of the interface teaches nothing. Every step points at an
  //! element that is really there, and leaves it working.
  check("each step points at a real element", /document\.querySelector\(step\.at\)/.test(tour));
  check("  which stays clickable under the dimming",
        /#tour \{[^}]*pointer-events: none/.test(shell)
        && /#tour-hole \{[^}]*box-shadow: 0 0 0 9999px/.test(shell));
  //! You cannot be shown how to turn a model by reading that you can.
  check("the steps that teach a gesture wait for it", /step\.wait\.of\(began\)/.test(tour)
        && /wait: \{ of: \(\) => kit\.turned\(\)/.test(tour));
  check("  and Next does it for you rather than trapping you",
        /if \(step && step\.wait && step\.wait\.give\)/.test(tour));
  check("  and Escape leaves at any point", /event\.key === "Escape"\) \{ event\.preventDefault\(\); stop\(\); \}/.test(tour));
  //! Which button turns the model is a preference, so the tour asks rather
  //! than telling somebody the wrong thing in its second sentence.
  check("what it says about the mouse is asked, not written down",
        /body: kit\.navigation\(\)/.test(tour) && /navigation: \(\) => \(altToOrbit/.test(app));
  check("leaving keeps your place and finishing does not",
        /kit\.remember\(GOT_TO, finished \? "" :/.test(tour));
}

console.log("\n11. and a document too big to put in one turn");
{
  const agent = readFileSync(new URL("../src/agent.js", import.meta.url), "utf8");
  check("the briefing has a budget", /const DOC_BUDGET = /.test(agent)
        && /\$\{documentBrief\(model\)\}/.test(agent));
  check("  under it the document still goes whole",
        /if \(whole\.length <= DOC_BUDGET\) return whole;/.test(agent));
  check("  over it, its shape goes instead", /export function documentDigest\(/.test(agent));
  check("look can read one part of it by id", /export function featureBrief\(/.test(agent)
        && /if \(id\) return \{ \.\.\.featureBrief\(model, id\), errors \}/.test(agent));
  check("and an edit does not report six thousand features back",
        /const listed = all\.slice\(-300\);/.test(agent));
}

console.log(failures ? "\n" + failures + " FAILED" : "\nall checks passed");
process.exit(failures ? 1 : 0);
