// The Drawings package.
//
// What a modeller is FOR, in the end, is a set of drawings. The model is how
// you work out the building; the drawings are what you hand over, and they are
// a different document with different rules. A drawing is not a screenshot: it
// is the model flattened onto a named plane, with the lines sorted into kinds
// and each kind given a pen, and what it leaves out is as deliberate as what
// it shows.
//
// TWO NODES, because there are two drawings:
//
//   Projection view   look at the model from a direction and draw what you
//                     see. An elevation, a plan of a roof, an axonometric.
//
//   Cut view          put a plane through it, throw away what is in front,
//                     and draw what is left - with the cut itself poched, the
//                     way every plan and every section has been drawn since
//                     drawings existed.
//
// BOTH PRODUCE A DRAWING, not a picture: the result is sketch geometry on a
// plane, so everything the sketch already does works on it. You can dimension
// it, snap to it, draw over it, turn a layer off, and send the whole thing out
// as DXF. That is the entire reason it is built this way rather than as a
// renderer with a line filter.
//
// WHAT IS COMPUTED AND WHAT IS AUTHORED. The projected lines are computed -
// exactly, by hidden-line removal in the geometry, not by reading pixels back
// off a render - and they are rebuilt whenever the model changes. The
// annotation is authored, held on the node, and never touched by a rebuild.
// The layers the computed lines land on are locked for exactly that reason: an
// edit there is an edit the next rebuild would silently discard.
//
// WHAT IT DOES NOT DO YET, said plainly: there is no sheet, no title block and
// no automatic dimensioning. A view is a drawing on a plane in the model, which
// is where the information is; laying several of them out on a sheet at a
// stated scale is the next piece and is not in this version.

import { ARG, F } from "./ocaf.js";
import { offerPlugin } from "./plugin.js";
import { CUT_LINES, CUT_WEIGHTS, cutStyleOf } from "./section.js";
import { BEYOND, DRAW_CLASSES, DRAW_LAYERS, POINT_SYMBOLS, assembleDrawing,
         beyondNamed, countByLayer, elementsFromRuns, fromPlane, includedIn,
         layerForClass, layerPen, noteStrokes, readExclusions, saysView,
         standardLayers, viewFrame } from "./drawings.js";

/* ---------------------------------------------------------------- the nodes

   THE ARGUMENTS ARE APPENDED, never inserted - an argument's index here is its
   storage tag, so a question added in the middle would quietly read every
   drawing already saved as having its scale where its look direction is.    */

//! What both views ask, in the same order, so the two panels read the same and
//! a view changed from one to the other keeps the answers that still apply.
const VIEW_ARGS = () => [
  ARG.ref("plane", "Drawn on", ["plane"]),
  //! EMPTY MEANS EVERYTHING, and that is the useful default: a drawing of a
  //! building is a drawing of the building, and nobody wires six hundred walls
  //! into it one at a time. Wire something in and it is that instead - which
  //! is also the form that records a dependency, so the order is guaranteed
  //! rather than natural. Both are said in the summary.
  //! guess: false, and it is the difference between the button doing what it
  //! says and doing a tenth of it. Every other list input is worth auto-wiring
  //! to the first thing that fits; here, EMPTY IS THE ANSWER - it means the
  //! whole model - so a guess does not save a step, it silently replaces
  //! "draw the building" with "draw the first wall".
  { ...ARG.refs("of", "Of", ["solid", "mesh", "curve"], false), guess: false },
  ARG.choice("look", "Looking",
             ["Square at the plane", "Straight down", "From the south",
              "From the west", "Down a body diagonal"], 0),
  //! THE EXCLUSION TREE, and it is an exclusion list rather than an inclusion
  //! list on purpose. A drawing that names what it contains misses the wing
  //! somebody added this morning, and nothing about the drawing looks wrong. A
  //! drawing that names what it leaves out shows the new wing the moment it
  //! exists.
  ARG.text("exclude", "Left out", "",
           "the ids this view leaves out, as JSON: {\"off\":[\"S3\",\"W12\"]}. "
           + "Leaving a set out leaves out everything in it."),
  ARG.real("scale", "Scale 1:", 100, 1, 5000, 1, ""),
  ARG.choice("hidden", "What is behind something",
             ["Draw it dashed", "Leave it out"], 1),
  ARG.choice("tangent", "Smooth creases", ["Draw them fine", "Leave them out"], 1),
  ARG.real("quality", "Curve detail", 48, 4, 400, 1, ""),
  //! The authored half. A drawing argument, the same kind the sketch uses, so
  //! the sketch editor opens on it and every tool already works.
  ARG.drawing("notes", "Annotation",
              "your own half of this drawing - text, leaders, symbols and any lines "
              + "you draw yourself, on layers you add. A rebuild never touches it."),
];

export const DRAWING_NODES = [
  { type: "ProjectionView", guid: "9a1b2c30-0120-4c00-9e00-caf000000120",
    category: "drawing", produces: "curve",
    summary: "The model as it would be DRAWN from one direction, flattened onto a "
           + "plane. Exact hidden-line removal in the geometry: seen edges, "
           + "silhouettes of curved surfaces, smooth creases and hidden lines each "
           + "land on their own layer with their own pen. What comes out is sketch "
           + "geometry, so it can be dimensioned, drawn over and sent out as DXF. "
           + "Wire nothing into Of and it draws the whole model.",
    args: VIEW_ARGS() },

  //! readsAppearance: a cut view hatches each body with the body's own style,
  //! so changing that style has to rebuild it. Without this the hatch you just
  //! turned off stays on the sheet until something else happens to the model.
  { type: "CutView", guid: "9a1b2c30-0121-4c00-9e00-caf000000121",
    category: "drawing", produces: "curve", readsAppearance: true,
    summary: "A section: a plane through the model, everything in front of it thrown "
           + "away, and what the plane passed through drawn heavy and poched - the "
           + "way a plan and a section have always been drawn. Say how much you want "
           + "to see behind the cut: nothing, everything, or as far as a stated "
           + "depth, which is what stops the hill behind swallowing the building. "
           + "Produces a drawing, not a picture.",
    args: [...VIEW_ARGS(),
           ARG.choice("beyond", "Behind the cut",
                      BEYOND.map(one => one.label), 1),
           ARG.when(ARG.real("depth", "As far as", 5000, 1, 1000000, 100), "beyond", 2),
           ARG.choice("poche", "The cut face",
                      ["Poché - hatched", "Filled", "Outline only"], 0),
           ARG.real("hatch", "Hatch spacing", 40, 1, 5000, 1),
           ARG.real("angle", "Hatch angle", 45, -90, 90, 5, "°")] },
];

/* ------------------------------------------------------------------ drivers

   A DRIVER IS ONE CALL INTO THE FACTORIES. The projection itself is
   `projectHidden` and the cut face is `cutLoops`, both of which live in the
   kernel's hybrid factory where the OpenCascade is - nothing in this file
   reaches past them. What is left here is reading the arguments, deciding
   which bodies are in the view, and turning the polylines that come back into
   a drawing.                                                                */

//! The five ways of looking, as directions. The plane's own normal is the
//! answer nine times in ten, which is why it is first.
const LOOKS = [null, [0, 0, -1], [0, 1, 0], [1, 0, 0], [-1, -1, -1]];

//! The types that ARE drawings, named once - see bodiesFor, where both halves
//! of "a drawing never draws a drawing" read it.
const VIEWS = new Set(["ProjectionView", "CutView"]);

export function drawingDrivers(kit) {
  const K = kit.toolkit();

  //! Where the drawing lives and which way the eye is. The plane says where;
  //! the look says which way, and unsaid it is the plane's own normal.
  const frameOf = f => {
    const axis = K.planeAxis(K.F.reference(f, "plane"));
    if (!axis) return null;
    const X = axis.XDirection(), N = axis.Direction(), at = axis.Location();
    const normal = [N.X(), N.Y(), N.Z()];
    const said = LOOKS[Math.max(0, Math.min(LOOKS.length - 1, K.F.choice(f, "look", 0)))];
    //! The EYE looks AT the model, so it looks back along the plane's normal -
    //! a plan drawn on a horizontal plane looks down, not up. Said once here
    //! because getting it backwards mirrors every drawing and the mirror of a
    //! symmetrical building looks perfectly correct.
    const look = said || [-normal[0], -normal[1], -normal[2]];
    return { origin: [at.X(), at.Y(), at.Z()], normal, look,
             up: [X.X(), X.Y(), X.Z()] };
  };

  //! What is in this view. Whatever is wired in, or - wired to nothing - every
  //! body in the document that is not a drawing view itself and has not been
  //! excluded.
  const bodiesFor = f => {
    //! A DRAWING IS NEVER A SOURCE FOR A DRAWING, wired or not. Both halves of
    //! that rule are needed: the unwired half is below, and this is the wired
    //! one. A view produces curves, curves are something a view can be OF, and
    //! the first thing that fits is what an auto-wire reaches for - so the
    //! second view somebody makes would quietly be a view of the first, whose
    //! lines all lie ON the plane, and the error it gives is about the plane.
    const wired = K.F.references(f, "of")
      .filter(one => { const spec = K.F.spec(one); return !spec || !VIEWS.has(spec.type); })
      .filter(one => K.F.shape(one))
      .map(one => ({ shape: K.F.shape(one), appearance: K.F.appearance(one), above: [] }));
    if (wired.length) return { bodies: wired, counted: wired.length, excluded: 0,
                               sewn: 0, overBudget: 0 };
    const off = readExclusions(K.F.text(f, "exclude", ""));
    //! A DRAWING NEVER DRAWS A DRAWING. Without this, two views in one document
    //! each draw the other's lines, the second one draws the first one's
    //! drawing of it, and what you get is a drawing that grows every rebuild.
    //! SETTING-OUT IS NOT DRAWN. A datum plane is a 400 mm square somebody
    //! sized for the screen, and a drawing that projected it would have that
    //! square across the middle of it - a line that is not a line of the
    //! building, at a size that means nothing, in every view.
    //! sewMeshes, because half the IFC in the world arrives tessellated and a
    //! drawing of it would otherwise be a blank sheet. See bodies(), where the
    //! cost and the budget are explained.
    const all = K.bodies({ except: [K.F.id(f)],
                           notCategories: ["datum", "data"],
                           notTypes: [...VIEWS], sewMeshes: true });
    const parents = new Map(all.map(one => [one.id, one.parent]));
    const bodies = [];
    let excluded = 0;
    for (const one of all) {
      if (!includedIn(off, one.id, id => parents.get(id) || null)) { excluded++; continue; }
      bodies.push(one);
    }
    return { bodies, counted: bodies.length, excluded,
             sewn: all.sewn || 0, overBudget: all.overBudget || 0 };
  };

  //! WHY THERE IS NOTHING, said as the reason rather than as the symptom.
  //! "Nothing to draw" with a model plainly full on screen is the message that
  //! sends somebody looking for a bug in the wrong place - it is almost always
  //! that everything was tessellated and too big to sew, or excluded.
  const nothingToDraw = (got, verb) => {
    if (got.overBudget)
      return "there is nothing to " + verb + " - " + got.overBudget
        + (got.overBudget === 1 ? " body is" : " bodies are")
        + " tessellated meshes too dense to turn back into geometry. Drawing is a "
        + "geometry operation; put a MeshToShape on a coarser cage, or wire the "
        + "bodies you want into Of.";
    if (got.excluded)
      return "there is nothing to " + verb + " - every body in the model has been "
        + "left out of this view";
    return "there is nothing to " + verb + " - the model has nothing solid in it yet";
  };

  //! And what it cost, when it cost something. Said only when it happened, so
  //! a drawing of ordinary geometry says nothing about meshes.
  const saysSewn = got => {
    const out = [];
    if (got.sewn) out.push(got.sewn + (got.sewn === 1 ? " mesh was" : " meshes were")
      + " turned back into geometry to draw");
    if (got.overBudget) out.push(got.overBudget
      + (got.overBudget === 1 ? " mesh was" : " meshes were") + " too dense and were left out");
    return out;
  };

  //! The lines, as a shape: every polyline put back on the plane it was
  //! flattened onto, so the drawing stands in the model where it belongs and
  //! can be looked at from any angle like anything else.
  const shapeOf = (drawing, frame) => {
    const wires = [];
    for (const el of drawing.elements) {
      const run = el.type === "line" ? [el.a, el.b] : (el.pts || []);
      if (run.length < 2) continue;
      try {
        wires.push(K.hybrid.polyline(run.map(uv => fromPlane(uv, frame)), !!el.closed));
      } catch (err) { /* one line, not the drawing */ }
    }
    for (const note of (drawing.notes || []))
      for (const [a, b] of noteStrokes(note)) {
        try { wires.push(K.hybrid.polyline([fromPlane(a, frame), fromPlane(b, frame)], false)); }
        catch (err) { /* one stroke, not the drawing */ }
      }
    return wires;
  };

  //! Hatching a loop, as segments. Parallel lines clipped to the loop by the
  //! even-odd rule - which is exactly right for a region with a hole in it,
  //! because a point inside the hole crosses the boundary an even number of
  //! times and is therefore outside.
  const hatchLoops = (loops, spacing, degrees) => {
    if (!loops.length || !(spacing > 0)) return [];
    const a = degrees * Math.PI / 180;
    const ux = Math.cos(a), uy = Math.sin(a);
    let lo = Infinity, hi = -Infinity, from = Infinity, to = -Infinity;
    const along = p => p[0] * ux + p[1] * uy;
    const across = p => -p[0] * uy + p[1] * ux;
    for (const loop of loops) for (const p of loop) {
      lo = Math.min(lo, across(p)); hi = Math.max(hi, across(p));
      from = Math.min(from, along(p)); to = Math.max(to, along(p));
    }
    if (!(hi > lo)) return [];
    const out = [];
    //! Capped, because a hatch spacing somebody typed as 1 on a four-hundred
    //! metre site is four hundred thousand lines and a page that never comes
    //! back. The cap is a number, not a silence: the panel says what it drew.
    const rows = Math.min(4000, Math.floor((hi - lo) / spacing) + 1);
    for (let r = 0; r <= rows; r++) {
      const v = lo + r * spacing;
      const crossings = [];
      for (const loop of loops) {
        for (let i = 0; i < loop.length; i++) {
          const p = loop[i], q = loop[(i + 1) % loop.length];
          const pv = across(p), qv = across(q);
          if ((pv > v) === (qv > v)) continue;
          const t = (v - pv) / (qv - pv);
          crossings.push(along(p) + (along(q) - along(p)) * t);
        }
      }
      crossings.sort((m, n) => m - n);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const s = crossings[i], e = crossings[i + 1];
        if (e - s < 1e-9) continue;
        out.push([[ux * s - uy * v, uy * s + ux * v],
                  [ux * e - uy * v, uy * e + ux * v]]);
      }
    }
    return out;
  };

  const runsFor = (f, shapes, frame, extra = {}) => {
    const quality = Math.round(K.F.real(f, "quality", 48));
    const got = K.hybrid.projectHidden(shapes, frame.origin, frame.look, frame.up,
                                       { curved: quality });
    const runs = { sharp: got.sharp, outline: got.outline,
                   smooth: K.F.choice(f, "tangent", 1) === 0 ? got.smooth : [],
                   ...extra };
    if (K.F.choice(f, "hidden", 1) === 0) {
      runs.sharpHidden = got.sharpHidden;
      runs.outlineHidden = got.outlineHidden;
      runs.smoothHidden = K.F.choice(f, "tangent", 1) === 0 ? got.smoothHidden : [];
    }
    return runs;
  };

  //! What both drivers end with: the computed lines and the authored ones put
  //! together, the shape built, and enough said in the panel that somebody can
  //! tell a view of nothing from a view that failed.
  const finish = (f, frame, runs, kind, lines) => {
    const computed = elementsFromRuns(runs, { tolerance: 0.01 });
    const drawing = assembleDrawing(computed, K.F.sketch(f, "notes"), kind);
    const wires = shapeOf(drawing, { o: frame.origin, ...planeAxes(frame) });
    const counts = countByLayer(drawing);
    const said = [...counts.entries()]
      .filter(([, n]) => n > 0)
      .map(([name, n]) => name.toLowerCase() + " " + n);
    if (!wires.length)
      throw new Error("nothing in this view - either everything is behind the plane, "
        + "or everything in the model has been left out of it");
    return {
      shape: wires.length === 1 ? wires[0] : K.shape.assemble(wires),
      data: { kind: "drawing", drawing, lines: [...lines, said.join(" · ")] },
    };
  };

  //! The sheet's own u and v, worked out the same way the page works them out.
  //! Two copies of one rule is one rule too many, but the kernel cannot import
  //! the page's module list - so it calls the same function, from the same
  //! file, with the same arguments.
  const planeAxes = frame => {
    const made = viewFrame(frame.origin, frame.look, frame.up);
    return { x: made.x, y: made.y, z: made.z };
  };

  return {
    ProjectionView: {
      precondition: f => {
        if (!K.F.reference(f, "plane")) return "a drawing needs a plane to live on";
        if (!K.planeAxis(K.F.reference(f, "plane")))
          return "that is not something a drawing can be drawn on";
        return null;
      },
      build: f => {
        const frame = frameOf(f);
        const axes = planeAxes(frame);
        //! The viewport needs the frame to turn a click into two numbers, so
        //! the drawing can be annotated with the sketch tools. Written before
        //! anything can go wrong with the projection, for the same reason the
        //! sketch writes it before anything can go wrong with the drawing.
        K.F.setFrame(f, { origin: frame.origin, x: axes.x, y: axes.y, normal: axes.z });
        const got = bodiesFor(f);
        if (!got.bodies.length) throw new Error(nothingToDraw(got, "draw"));
        return finish(f, frame, runsFor(f, got.bodies.map(one => one.shape), frame),
          "projection",
          [saysView({ kind: "projection", scale: Math.round(K.F.real(f, "scale", 100)),
                      excluded: got.excluded || 0 }),
           got.counted + (got.counted === 1 ? " body" : " bodies") + " drawn",
           ...saysSewn(got)]);
      },
    },

    CutView: {
      precondition: f => {
        if (!K.F.reference(f, "plane")) return "a section needs a plane to cut on";
        if (!K.planeAxis(K.F.reference(f, "plane")))
          return "that is not something a section can be cut on";
        return null;
      },
      build: f => {
        const frame = frameOf(f);
        const axes = planeAxes(frame);
        K.F.setFrame(f, { origin: frame.origin, x: axes.x, y: axes.y, normal: axes.z });
        const got = bodiesFor(f);
        if (!got.bodies.length) throw new Error(nothingToDraw(got, "cut"));
        const { bodies, counted, excluded } = got;

        //! THE NEAR SIDE IS THROWN AWAY. Which side that is follows from the
        //! look direction and nothing else: whatever the eye is on the near
        //! side of goes, which is what makes a plan of a building a plan and
        //! not a view of the roof.
        const eye = [frame.origin[0] - frame.look[0], frame.origin[1] - frame.look[1],
                     frame.origin[2] - frame.look[2]];
        const behind = [frame.origin[0] + frame.look[0], frame.origin[1] + frame.look[1],
                        frame.origin[2] + frame.look[2]];
        void eye;
        const plane = K.planeAxis(K.F.reference(f, "plane"));
        //! KEPT ONE BY ONE, WITH ITS STYLE, because a drawing does not hatch
        //! everything the same: concrete is one poche, blockwork another, and
        //! glass is not hatched at all. The pairing has to survive the trim,
        //! so what is carried forward is the body and its style together.
        const kept = [];
        for (const one of bodies) {
          try { kept.push({ ...one, shape: K.hybrid.trimAtPlane(one.shape, plane, behind) }); }
          catch (err) { /* a body wholly in front of the plane is simply gone */ }
        }
        if (!kept.length)
          throw new Error("the plane is in front of everything - nothing is behind it "
            + "to draw. Move it, or turn it round.");

        //! HOW FAR BEHIND, which is the difference between a section that
        //! reads and a section of a hillside. Trimmed a second time, at a
        //! plane the stated depth back, because "as far as" is a place and
        //! a fade is a rendering trick.
        const mode = beyondNamed(BEYOND[Math.max(0, Math.min(2,
          K.F.choice(f, "beyond", 1)))].key);
        let drawn = kept;
        if (mode.key === "depth") {
          const depth = Math.max(1, K.F.real(f, "depth", 5000));
          const back = [frame.origin[0] + frame.look[0] * depth,
                        frame.origin[1] + frame.look[1] * depth,
                        frame.origin[2] + frame.look[2] * depth];
          const far = K.hybrid.planeNormal(back, frame.look);
          const near = [frame.origin[0] + frame.look[0] * depth * 0.5,
                        frame.origin[1] + frame.look[1] * depth * 0.5,
                        frame.origin[2] + frame.look[2] * depth * 0.5];
          const trimmed = [];
          for (const one of drawn) {
            try { trimmed.push({ ...one, shape: K.hybrid.trimAtPlane(one.shape, far, near) }); }
            catch (err) { /* wholly beyond the depth: left out, which is the point */ }
          }
          drawn = trimmed;
        }

        //! The cut face, read off the trimmed bodies rather than computed as
        //! an intersection curve - because poche fills a REGION and an
        //! intersection gives a line. ONE BODY AT A TIME, so each one is
        //! hatched with its own style: the same three-level cascade the
        //! section cutter resolves - the object, then the sets it is in, then
        //! the view - which is what "define it at the geoset and at the
        //! object" means.
        const poche = K.F.choice(f, "poche", 0);
        const spacing = Math.max(1, K.F.real(f, "hatch", 40));
        const turn = K.F.real(f, "angle", 45);
        const lines = [], fills = [];
        let regions = 0;
        for (const one of kept) {
          const loops = K.hybrid.cutLoops([one.shape], frame.origin, frame.normal,
                                          frame.look, frame.up, {});
          if (!loops.length) continue;
          regions += loops.length;
          for (const loop of loops) lines.push([...loop, loop[0]]);
          if (poche === 2) continue;             // outline only: no fill at all
          const style = cutStyleOf(one.appearance, poche === 0 ? "poche" : "capped",
                                   one.above || []);
          //! An object whose own style says "no pattern" is not hatched, and
          //! that is the whole point of the cascade: glass in a wall of
          //! blockwork reads as a gap rather than as more blockwork.
          if (style.pattern === "none") continue;
          for (const run of hatchLoops(loops, spacing * (style.scale || 1),
                                       turn + (style.angle || 0)))
            fills.push(run);
        }
        const extra = { cut: poche === 0 ? [...lines, ...fills] : lines };
        const loops = { length: regions };

        //! Nothing behind the cut means the cut and nothing else - so the
        //! projection is skipped entirely rather than computed and discarded,
        //! which on a building is the difference between instant and a minute.
        const runs = mode.key === "none"
          ? { sharp: [], outline: [], smooth: [], ...extra }
          : runsFor(f, (drawn.length ? drawn : kept).map(one => one.shape), frame, extra);

        return finish(f, frame, runs, "cut",
          [saysView({ kind: "cut", scale: Math.round(K.F.real(f, "scale", 100)),
                      excluded: excluded || 0, beyond: mode.key,
                      depth: Math.round(K.F.real(f, "depth", 5000)) }),
           counted + (counted === 1 ? " body" : " bodies") + " cut",
           loops.length + (loops.length === 1 ? " cut region" : " cut regions"),
           ...saysSewn(got)]);
      },
    },
  };
}

/* ------------------------------------------------------------ the package */

export const DRAWINGS = offerPlugin({
  id: "drawings",
  name: "Drawings",
  version: 1,
  summary: "Turn the model into drawings. Pick a plane, and either project the model "
         + "onto it or cut through it - and get real sketch geometry back, with seen "
         + "edges, silhouettes, hidden lines and the cut each on its own layer with "
         + "its own pen. Poché, view beyond, an exclusion tree for what to leave out, "
         + "and your own annotation layers on top. Exact hidden-line removal, so what "
         + "comes out can be dimensioned and plotted.",

  nodes: DRAWING_NODES,

  api: {
    name: "DrawingFactory",
    summary: "Making a drawing from a model: the projection itself, which is geometry "
           + "and happens in the kernel, and the conventions around it, which are "
           + "arithmetic and happen here. Nothing in it renders anything - hidden-line "
           + "removal is exact, in the B-Rep, which is why what comes out can be "
           + "dimensioned rather than only looked at.",
    operations: [
      { name: "projectHidden", takes: "shapes, origin, look, up, options",
        gives: "{ sharp, outline, smooth, sharpHidden, outlineHidden, smoothHidden }",
        summary: "Hidden-line removal in the geometry. Every line classified: real "
               + "edges, silhouettes where a curved surface turns away, smooth "
               + "creases, and the same three again for what something is in front "
               + "of. A kernel operation - this package only asks for it." },
      { name: "cutLoops", takes: "shapes, origin, normal, options",
        gives: "loops, closed, on the plane",
        summary: "The closed regions where a plane passed through solid material - "
               + "what poché fills. Read off the trimmed body's own faces, so a "
               + "shaft comes back as its own loop rather than being filled in." },
      { name: "chainPolylines", takes: "segments, tolerance", gives: "polylines",
        summary: "Segments joined end to end. Hidden-line removal returns a wall as "
               + "forty separate pieces; a drawing wants one line you can select." },
      { name: "includedIn", takes: "exclusions, id, parentOf", gives: "true or false",
        summary: "Whether an object is in a view. An EXCLUSION list, so anything new "
               + "in the model is in the drawing until somebody decides otherwise - "
               + "the other way round, a drawing silently misses what was added." },
      { name: "layerPen", takes: "layer", gives: "{ weight, line, ink, symbol, size }",
        summary: "What a layer is drawn with, resolved: what it says for itself, with "
               + "the drawing conventions standing in where it says nothing." },
      { name: "symbolStrokes", takes: "symbol, at, size", gives: "segments",
        summary: "A point symbol as lines - a cross, a target, a station mark. Strokes "
               + "rather than a font, so they scale and go out to DXF." },
      { name: "assembleDrawing", takes: "computed, authored, kind", gives: "a drawing",
        summary: "The computed half and the authored half put together. The computed "
               + "layers come back locked, because an edit to them is one the next "
               + "rebuild would throw away." },
    ],
  },

  //! NO VIEW AND NO MODE. A drawing is not another way of looking at the
  //! model, it is a thing IN the model - it has a place, it has a tree row,
  //! and you look at it with the viewport you already have. A package that
  //! added a mode here would be a package asking you to leave the model to
  //! look at a part of it.

  drivers: drawingDrivers,

  async start(kit) {
    void kit;
    return {
      //! What the interface needs to draw a drawing the way a drawing is drawn,
      //! handed over rather than imported, so nothing in the page has to know
      //! this package exists until it is loaded.
      layers: DRAW_LAYERS,
      classes: DRAW_CLASSES,
      symbols: POINT_SYMBOLS,
      weights: CUT_WEIGHTS,
      lines: CUT_LINES.filter(one => one.key !== "inherit"),
      beyond: BEYOND,
      penOf: layerPen,
      layerOf: layerForClass,
      standardLayers,
      dispose: () => {},
    };
  },
});
