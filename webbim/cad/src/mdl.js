import { acceptsFrom, isElided } from "./ocaf.js";
import { SKETCH_CLICKS, SKETCH_LAYER, currentLayer, nextSketchId, readSketch,
         sketchDirectionAt, sketchElement, sketchHandleAt, sketchLayers, sketchMoveElement,
         sketchFillet, sketchMoveHandle, sketchOverlaps, sketchRelation, sketchTangentArc,
         solveSketch } from "./sketch.js";

// The model description language.
//
// One rule holds this program together: the JSON *is* the model. It is not a
// save format bolted onto a program that keeps the truth somewhere else - it is
// the truth, and every surface that appears to edit geometry is really editing
// this text.
//
//   a toolbar button   is a literal:  { "op": "add", "type": "Cube" }
//   a slider           is a literal:  { "op": "set", "id": "CB1", "key": "dx", "value": 92 }
//   a wire in the graph is a literal: { "op": "connect", "id": "CB1", "key": "plane", "from": "PL1" }
//
// Nothing reaches the document except through one of the edits below, so the
// tree, the definition panel, the node graph and anything driving the page from
// outside are the same program with different pictures on the buttons. Every
// edit that runs is kept, in order, with its JSON - which is what the console in
// the node editor shows, and what an external driver would send.


//! An edit that changes geometry; the kernel re-executes what it touched.
const modelOp = (op, fields, summary, example, run) =>
  ({ op, fields, summary, example, run, view: false });

//! An edit that changes only how the model is looked at. It goes through the
//! same channel and is recorded the same way, but no function re-executes.
const viewOp = (op, fields, summary, example, run) =>
  ({ op, fields, summary, example, run, view: true });

const needText = (edit, key) => {
  const value = edit[key];
  if (typeof value !== "string" || !value.length)
    throw new Error('"' + key + '" must be text');
  return value;
};
const needNumber = (edit, key) => {
  const value = edit[key];
  if (!Number.isFinite(value)) throw new Error('"' + key + '" must be a number');
  return value;
};

//! What a feature is wired to when nothing says otherwise: the selected body if
//! an operation can take it, and the first datum of the right type for the rest.
//! It is the toolbar's rule, written once, so `{"op":"add","type":"Fillet"}` from
//! a console or from a driver does what pressing the button does.
export async function defaultRefs(ctx, type) {
  const [schema, answer] = await Promise.all([ctx.kernel.schema(), ctx.kernel.tree()]);
  const spec = schema.types.find(t => t.type === type);
  const features = (answer.tree || answer).features || [];
  const chosen = ctx.selected ? ctx.selected() : null;
  const selected = features.find(f => f.id === chosen) || null;
  // Several things shift-clicked are several things meant: that is the answer
  // to "which sections", and the only reason guessing one was ever wrong.
  const picked = ((ctx.picked ? ctx.picked() : []) || [])
    .map(id => features.find(f => f.id === id)).filter(Boolean);
  const refs = {};
  //! An argument only shown for one setting of a choice is only WIRED for that
  //! setting. A point by coordinates has no curve to sit on, so guessing one for
  //! it invents a dependency the driver never reads - and, in a document where
  //! that curve is downstream, a cycle out of nothing.
  const applies = arg => {
    if (!arg.showWhen) return true;
    const governs = (spec.args || []).find(a => a.key === arg.showWhen.key);
    if (!governs) return true;
    return arg.showWhen.any ? arg.showWhen.any.includes(governs.default)
                            : governs.default === arg.showWhen.equals;
  };
  for (const arg of (spec ? spec.args : [])) {
    if (!applies(arg)) continue;
    // An input that gathers bodies is left empty: one section is not a loft, and
    // guessing the second is worse than guessing nothing. An input that takes
    // several wires but consumes nothing - the points of a polyline - is wired
    // like any other, because the first one is the same guess a single-wire
    // input would already have made, and more are added by hand.
    if (arg.kind === "refs") {
      // Several things picked by hand are several things meant: the two
      // sections of a loft, the three points of a polyline. That is the answer
      // to "which ones", and the only reason guessing was ever wrong.
      const taking = picked.filter(f => acceptsFrom(arg.accepts, f)
        && !(arg.consumes && f.consumedBy));
      if (taking.length > 1) { refs[arg.key] = taking.map(f => f.id); continue; }
      // With nothing picked, an input that gathers bodies stays empty - one
      // section is not a loft. One that only names sources takes the same first
      // guess a single-wire input would, and more are added by hand.
      if (arg.consumes) continue;
    } else if (arg.kind !== "ref") continue;
    // An input that stands in for numbers already on the node is left alone.
    // Guessing one would quietly override what was typed.
    if (arg.guess === false) continue;
    const accepts = arg.accepts;
    //! WHAT IS SELECTED WINS, for any input it fits - not only for the one
    //! that swallows it.
    //!
    //! This used to prefer the selection only on a CONSUMING argument, so a
    //! fillet took the body you had chosen and a sketch did not take the plane
    //! you had chosen: it took the first plane in the document, which in a
    //! part that opens on its origin is always XY. Select a face's plane, add
    //! a sketch, get one on XY - and then wire it by hand, which is the step
    //! every other modeller removed twenty years ago.
    //!
    //! "The thing I just clicked is what I mean" is the rule every CAD system
    //! has, and there is no reason for it to stop at one kind of argument.
    let target = (selected && acceptsFrom(accepts, selected)
                  && !(arg.consumes && selected.consumedBy)) ? selected : null;
    // Never pick a body another operation has already swallowed.
    if (!target)
      target = features.find(f => acceptsFrom(accepts, f) && !(arg.consumes && f.consumedBy)) || null;
    if (target) refs[arg.key] = target.id;
  }
  return refs;
}

//! The drawing on a sketch, as it stands. The small sketch edits read it,
//! change one thing and write the whole of it back, because the drawing is one
//! string on one label - which is what makes the same edit arrive identically
//! from a click, from the console, or from outside the page.
async function drawingOf(ctx, id) {
  const answer = await ctx.kernel.tree();
  const entry = ((answer.tree || answer).features || []).find(f => f.id === id);
  if (!entry) throw new Error("there is no feature '" + id + "'");
  if (!entry.sketch) throw new Error(entry.name + " is not a sketch");
  return readSketch(entry.sketch.drawing);
}

export const MDL_OPS = [
  modelOp("add", ["type", "name?", "id?", "refs?"],
    "Add a feature of the named type. refs wires its reference arguments as it is born; "
    + "leave it out and each one is wired the way the toolbar would wire it. Give it an "
    + "id and that is what it is called, so the edits after it can wire to it without "
    + "having to be told what it was named.",
    { op: "add", type: "Cube", id: "BASE", name: "Cube.2", refs: { origin: "PT1", plane: "PL1" } },
    async (ctx, edit) => {
      const type = needText(edit, "type");
      const refs = edit.refs && typeof edit.refs === "object"
        ? edit.refs
        : await defaultRefs(ctx, type);
      const born = await ctx.kernel.addFeature(type, refs, edit.id ? String(edit.id) : null);
      if (!edit.name) return born;
      return { ...(await ctx.kernel.rename(born.id, String(edit.name))), id: born.id };
    }),

  modelOp("delete", ["id"],
    "Remove a feature, the way a node editor removes a node. Anything that READ from "
    + "it loses that input and says so; anything it read from is untouched. A set goes "
    + "with everything inside it, however deep - to keep the contents, move them out "
    + "first, which is what taking something out of a set is for. Nothing is refused "
    + "and nothing is left behind in the model file.",
    { op: "delete", id: "SP1" },
    (ctx, edit) => ctx.kernel.deleteFeature(needText(edit, "id"))),

  modelOp("group", ["id", "into?"],
    "File a feature under a set - a GeometricalSet or a Body - or leave `into` out to "
    + "take it back to the top level. A set holds things; it never consumes them, so "
    + "what is in one stays as visible, as wired and as rebuildable as it was.",
    { op: "group", id: "CI1", into: "GS1" },
    (ctx, edit) => ctx.kernel.setParent(needText(edit, "id"),
                                        edit.into ? String(edit.into) : null)),

  modelOp("rename", ["id", "name"],
    "Rename a feature. The id is what references point at; the name is for people.",
    { op: "rename", id: "CB1", name: "Base block" },
    (ctx, edit) => ctx.kernel.rename(needText(edit, "id"), needText(edit, "name"))),

  modelOp("set", ["id", "key", "value"],
    "Set one number: a catalogue argument, or a parameter a script declared for itself. "
    + "A choice takes the index of the option.",
    { op: "set", id: "CB1", key: "dx", value: 92 },
    (ctx, edit) => ctx.kernel.setParameter(
      needText(edit, "id"), needText(edit, "key"), needNumber(edit, "value"))),

  modelOp("connect", ["id", "key", "from", "mode?"],
    "Wire one feature into another's input - a reference, a section of a loft, or a "
    + "slider being driven by a number. What an input takes is what a source produces, "
    + "not which feature type it is. An input that holds several wires gains one more; "
    + 'mode "only" makes this wire the only one on it, which is what dropping a wire '
    + "on it without holding shift does.",
    { op: "connect", id: "FI1", key: "body", from: "CB1" },
    (ctx, edit) => ctx.kernel.setReference(
      needText(edit, "id"), needText(edit, "key"), needText(edit, "from"),
      false, edit.mode === "only")),

  modelOp("disconnect", ["id", "key", "from?"],
    "Pull a wire off an input. An input that takes several wires loses the one named "
    + "in from, or all of them when it is left out.",
    { op: "disconnect", id: "FI1", key: "body" },
    (ctx, edit) => ctx.kernel.setReference(needText(edit, "id"), needText(edit, "key"),
      edit.from ? String(edit.from) : null, true)),

  modelOp("code", ["id", "key", "text"],
    "Replace the source of a written feature. The parameters it declares are reconciled "
    + "against the ones already stored.",
    { op: "code", id: "SC1", key: "source", text: "({ params: [], build(p, k) { … } })" },
    (ctx, edit) => ctx.kernel.setCode(
      needText(edit, "id"), needText(edit, "key"), String(edit.text ?? ""))),

  modelOp("appearance", ["id", "appearance"],
    "Give a feature a finish. Geometry does not rebuild - only the way it is drawn changes.",
    { op: "appearance", id: "CB1", appearance: { finish: "brass" } },
    (ctx, edit) => ctx.kernel.setAppearance(needText(edit, "id"), edit.appearance || null)),

  viewOp("shown", ["id?", "ids?", "on"],
    "Show a body that an operation swallowed, or stop showing it. A body a fillet or a "
    + "boolean consumed leaves the 3D view by default - drawing both puts the old "
    + "corners through the new ones - and this is how that default is overruled, for "
    + "looking at what something was made from. It is remembered on the feature and "
    + "saved with the model, so the next rebuild does not undo it. Takes one id, or "
    + "a list of them as ids, which is one edit and one rebuild rather than one each.",
    { op: "shown", id: "CB1", on: true },
    //! One row or a list of them. A list is ONE call rather than one each:
    //! every one of these rebuilds the tree, and a document of seven thousand
    //! features cannot afford that per feature - see setShownMany.
    (ctx, edit) => (Array.isArray(edit.ids)
      ? ctx.kernel.setShownMany(edit.ids, edit.on !== false)
      : ctx.kernel.setShown(needText(edit, "id"), edit.on !== false))),

  viewOp("reorder", ["ids", "before?", "after?"],
    "Move features up or down the tree, to sit just before or just after another one. "
    + "What the tree shows is the order the features were written in; this is how that "
    + "order is tidied without anything being rebuilt. It does not change what depends "
    + "on what - the rebuild order is the wiring, not the tree - so a feature can be "
    + "moved above something it is built from and will still build after it.",
    { op: "reorder", ids: ["EX1", "FL1"], after: "SK1" },
    (ctx, edit) => {
      const ids = Array.isArray(edit.ids) ? edit.ids : [edit.id].filter(Boolean);
      if (!ids.length) throw new Error('"reorder" needs "ids"');
      const target = edit.after || edit.before;
      if (!target) throw new Error('"reorder" needs "before" or "after"');
      return ctx.kernel.reorder(ids, String(target), !!edit.after);
    }),

  modelOp("spread", ["id"],
    "How a feature pairs up the lists arriving on it - Grasshopper's data matching. "
    + "`match` is \"longest\" (a short list repeats its last value), \"shortest\" (the "
    + "surplus is dropped) or \"cross\" (every combination). `graft` names inputs that "
    + "should make a row each even when only one value arrives.",
    { op: "spread", id: "PA1", match: "cross", graft: ["distance"] },
    (ctx, edit) => ctx.kernel.setSpread(needText(edit, "id"), {
      match: edit.match, graft: edit.graft, flatten: edit.flatten })),

  modelOp("model", ["model"],
    "Replace the whole document with a model file. Everything else above is a small "
    + "edit of the text this one writes wholesale.",
    { op: "model", model: { format: "ocaf-parametric-model", version: 1, features: [] } },
    async (ctx, edit) => {
      const model = typeof edit.model === "string" ? JSON.parse(edit.model) : edit.model;
      if (!model || typeof model !== "object") throw new Error('"model" must be a model file');
      // A model that was shortened so a person could read it is not a model
      // that can be built. Rebuilding from it would throw away the geometry it
      // appears to describe, so it is refused by name instead.
      const short = (model.features || []).find(f =>
        Object.values(f.args || {}).some(isElided));
      if (short)
        throw new Error("this text has had its imported geometry shortened so it could be "
          + "read - " + short.name + " is only a note of its size. Rebuilding from it would "
          + "throw that geometry away. Edit the model in the tree, or open a model file you "
          + "exported.");
      // The layout block is the graph's, not the kernel's; it travels in the
      // same file so a model opens looking the way it was left.
      if (model.layout && typeof model.layout === "object") ctx.readLayout(model.layout);
      if (ctx.readHidden) ctx.readHidden(model.hidden);
      return await ctx.kernel.loadModel(model);
    }),

  modelOp("import", ["format", "data?", "from?", "name?", "encoding?", "as?", "units?", "layers?"],
    "Read a file into the document. `format` is one of the formats this build reads - step, "
    + "brep, obj, stl, dxf. The file arrives one of two ways: `data` is the file itself, as "
    + "text, or base64 with `encoding` set to \"base64\" for a binary STL; `from` is a path in "
    + "the kernel's own filesystem, which is where the page puts a file it streamed in a "
    + "slice at a time so that nothing ever held the whole of it. One or the other, and "
    + "`from` is how anything large gets in. "
    + '`as` is "single" for one feature or '
    + '"parts" to break the file into the parts it names, which only a format that '
    + "carries several will do anything with. What comes in is stored as geometry, not as "
    + "the file - packed, above a few kilobytes - so it rebuilds without the reader that "
    + "read it, and a mesh keeps the "
    + "faces it was authored with, quads included. A DXF is the exception and comes in as a "
    + "SKETCH: `units` says what one unit in the drawing means - mm, cm, m, in, ft - because "
    + "most DXF files do not, and `layers` takes only the layers named.",
    { op: "import", format: "step", name: "bracket.step", as: "parts", data: "ISO-10303-21;…" },
    (ctx, edit) => {
      const from = edit.from ? String(edit.from) : "";
      if (!from && typeof edit.data !== "string")
        throw new Error('"import" needs either "data" - the file - or "from", a file already '
          + "streamed into the kernel");
      return ctx.kernel.importFile({
        format: needText(edit, "format"),
        data: from ? "" : String(edit.data),
        from,
        name: edit.name ? String(edit.name) : "",
        encoding: edit.encoding === "base64" ? "base64" : "text",
        as: edit.as === "parts" ? "parts" : "single",
        units: edit.units ? String(edit.units) : "mm",
        layers: Array.isArray(edit.layers) ? edit.layers.map(String) : null,
      });
    }),

  modelOp("vertex", ["id", "index", "x", "y", "z"],
    "Move one vertex of a mesh, by an offset from where the mesh upstream put it. "
    + "This is what dragging a handle in the viewport writes; an offset of zero puts "
    + "the vertex back and forgets the edit.",
    { op: "vertex", id: "ED1", index: 12, x: 4, y: 0, z: -2 },
    (ctx, edit) => {
      if (!Number.isInteger(edit.index) || edit.index < 0)
        throw new Error('"index" must be a vertex number');
      return ctx.kernel.moveVertex(needText(edit, "id"), edit.index,
        [needNumber(edit, "x"), needNumber(edit, "y"), needNumber(edit, "z")]);
    }),

  modelOp("pick", ["id", "key", "picks"],
    "Replace the sub-shapes an argument is about - which edges a fillet rounds, which "
    + "face a draft hinges on, which face of a skin a Face node takes. A pick names the "
    + "feature it belongs to, the kind, and the number, counting from zero in the order "
    + "they are enumerated for you; \"near\" is optional and says where the thing was, so "
    + "a click can still find it after the body changes shape. Written without it - "
    + "{ of, kind, at } - the number is the whole of the pick, which is the practical "
    + "form when you are editing the file rather than clicking the model. An empty list "
    + "means the operation's own default, which on a fillet is every edge and on a Face "
    + "is every face. Ask Measure for \"How many faces\" first if you need to know what "
    + "the numbers run to. `mode` says how a pick SPREADS, and it is re-asked on every "
    + "rebuild rather than resolved once: \"one\" takes exactly what is listed, "
    + "\"touching\" takes everything sharing a rim with it, \"tangent\" everything that "
    + "continues it smoothly within `angle` degrees. That is what keeps a fillet on the "
    + "whole arris of a cylinder after the cylinder changes size.",
    { op: "pick", id: "FL1", key: "edges",
      picks: [{ of: "CB1", kind: "edge", at: 2, near: [40, 0, 40, 0, 1, 0, 40] },
              { of: "CB1", kind: "edge", at: 5 }] },
    (ctx, edit) => {
      //! `picks` may be left out when only the spreading rule is changing:
      //! "grow these the other way" is an edit of the rule, not a re-pick.
      if (edit.picks !== undefined && !Array.isArray(edit.picks))
        throw new Error('"picks" must be a list');
      if (edit.picks === undefined && edit.mode === undefined)
        throw new Error('"pick" needs "picks", or a "mode" to change how they spread');
      return ctx.kernel.setPicks(needText(edit, "id"), needText(edit, "key"),
                                 edit.picks, edit.mode, edit.angle);
    }),

  modelOp("meshop", ["id", "ops"],
    "Replace the whole list of mesh operations on an Edit Mesh. An operation is a "
    + "record - what it is, what it was about, where those things were and what it was "
    + "set to - and the list is replayed over whatever cage arrives from upstream, so "
    + "an edit made here survives a change to the mesh underneath it.",
    { op: "meshop", id: "EM1",
      ops: [{ op: "extrude", level: "face", at: [3],
              near: [[0, 0, 50, 0, 0, 1, 70.7]], args: { distance: 100 } }] },
    (ctx, edit) => {
      if (!Array.isArray(edit.ops)) throw new Error('"ops" must be a list of operations');
      return ctx.kernel.setMeshOps(needText(edit, "id"), edit.ops);
    }),

  modelOp("sketch", ["id", "drawing"],
    "Replace the whole drawing on a sketch. The three below are small edits of the "
    + "same text; this one writes it wholesale.",
    { op: "sketch", id: "SK1",
      drawing: { elements: [{ id: "e1", type: "circle", c: [0, 0], r: 60 }], constraints: [] } },
    (ctx, edit) => ctx.kernel.setSketch(needText(edit, "id"), null, edit.drawing)),

  modelOp("draw", ["id", "type", "at", "from?", "as?"],
    "Draw one element on a sketch. at is the clicks that would have made it, in the "
    + "plane's own coordinates - a line takes two, an arc takes centre, start and how "
    + "far round. from names an end of another element, as \"e1.b\": the new element "
    + "starts there and leaves it smoothly, so an arc off the end of a line is tangent "
    + "to it and at needs only where the arc ends. This is what clicking in the "
    + "sketcher writes.",
    { op: "draw", id: "SK1", type: "arc", at: [[100, 0], [200, 100]], from: "e1.b" },
    async (ctx, edit) => {
      const type = needText(edit, "type");
      const clicks = Array.isArray(edit.at) ? edit.at : [];
      const wanted = SKETCH_CLICKS[type];
      if (wanted === undefined) throw new Error('there is no sketch element called "' + type + '"');
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const id = typeof edit.as === "string" && edit.as ? edit.as : nextSketchId(drawing);

      // Leaving another element smoothly settles where this one starts and
      // which way it goes, so all it still needs is where it ends.
      const carried = typeof edit.from === "string" && edit.from
        ? sketchHandleAt(drawing, edit.from) : null;
      if (edit.from && !carried)
        throw new Error("there is no handle '" + edit.from + "' on that sketch");
      if (carried) {
        if (clicks.length < 1) throw new Error('"at" needs the point it ends at');
        const start = carried.p;
        const along = sketchDirectionAt(carried.el, carried.key);
        const end = clicks[clicks.length - 1];
        // Three points in a line have no arc through them. That is a line, and
        // drawing one is better than refusing the edit.
        const made = (type === "arc" && along)
          ? sketchTangentArc(start, along, end, id) : null;
        drawing.elements.push(made || sketchElement("line", id, [start, end]));
      } else {
        // A spline takes as many as it is given and wants at least two; every
        // other kind wants exactly what SKETCH_CLICKS says. Demanding two of
        // everything meant a point - which takes ONE click - could never be
        // drawn through this op at all.
        const least = wanted || 2;
        if (clicks.length < least)
          throw new Error(type + " needs " + (wanted ? wanted : "at least two")
            + (least === 1 ? " point" : " points") + ' in "at"');
        drawing.elements.push(sketchElement(type, id, clicks));
      }
      // On whichever layer is current, when the drawing has any. A drawing
      // that has never heard of layers stays that way rather than gaining a
      // "0" on everything.
      if (Array.isArray(drawing.layers) && drawing.layers.length) {
        const on = currentLayer(drawing);
        drawing.elements[drawing.elements.length - 1].layer = on;
      }
      return ctx.kernel.setSketch(edit.id, null, drawing);
    }),

  modelOp("layer", ["id", "name", "show?", "lock?", "rename?", "current?"],
    "One layer of a sketch. A name nobody has used yet makes the layer; show turns it "
    + "on and off - and off means not drawn AND not built, which is how a plan full of "
    + "furniture becomes a profile; lock leaves it drawn and built but stops it being "
    + "picked up; rename carries everything on it across; current says which layer new "
    + "elements go on.",
    { op: "layer", id: "SK1", name: "FURNITURE", show: false },
    async (ctx, edit) => {
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const name = needText(edit, "name");
      const layers = sketchLayers(drawing).map(({ name: had, on, locked }) =>
        ({ name: had, on, locked }));
      let row = layers.find(l => l.name === name);
      if (!row) { row = { name, on: true, locked: false }; layers.push(row); }
      if (edit.show !== undefined) row.on = !!edit.show;
      if (edit.lock !== undefined) row.locked = !!edit.lock;
      if (typeof edit.rename === "string" && edit.rename && edit.rename !== name) {
        const to = edit.rename.trim();
        if (!to) throw new Error("a layer needs a name");
        if (layers.some(l => l.name === to))
          throw new Error('there is already a layer called "' + to + '"');
        // Everything on it comes with it, including the elements that were on
        // it by saying nothing.
        for (const el of drawing.elements)
          if ((el.layer || SKETCH_LAYER) === name) el.layer = to;
        if (drawing.current === name) drawing.current = to;
        row.name = to;
      }
      if (edit.current) drawing.current = row.name;
      drawing.layers = layers;
      return ctx.kernel.setSketch(edit.id, null, drawing);
    }),

  modelOp("unlayer", ["id", "name"],
    "Delete a layer of a sketch AND everything drawn on it. The last layer cannot go: "
    + "a drawing is always on one.",
    { op: "unlayer", id: "SK1", name: "FURNITURE" },
    async (ctx, edit) => {
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const name = needText(edit, "name");
      const layers = sketchLayers(drawing);
      if (!layers.some(l => l.name === name))
        throw new Error('this sketch has no layer called "' + name + '"');
      if (layers.length < 2) throw new Error("that is the only layer - a drawing is on one");
      const gone = new Set(drawing.elements
        .filter(el => (el.layer || SKETCH_LAYER) === name).map(el => el.id));
      drawing.elements = drawing.elements.filter(el => !gone.has(el.id));
      drawing.constraints = drawing.constraints
        .filter(c => !c.of.some(at => gone.has(String(at).split(".")[0])));
      drawing.layers = layers.filter(l => l.name !== name)
        .map(({ name: had, on, locked }) => ({ name: had, on, locked }));
      if (drawing.current === name) drawing.current = drawing.layers[0].name;
      return ctx.kernel.setSketch(edit.id, null, drawing);
    }),

  modelOp("construct", ["id", "of", "on?"],
    "Make elements of a sketch construction geometry, or make them real again. "
    + "Construction geometry is drawn dashed, is picked and constrained and solved "
    + "like anything else, and is never built: it is the centreline two arcs are "
    + "tangent to, not part of the profile. on: false turns it back into output.",
    { op: "construct", id: "SK1", of: ["e1", "e2"], on: true },
    async (ctx, edit) => {
      const of = (Array.isArray(edit.of) ? edit.of : [edit.of])
        .map(name => String(name || "").split(".")[0]).filter(Boolean);
      if (!of.length) throw new Error('"of" names the elements to mark');
      const on = edit.on === undefined ? true : !!edit.on;
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const wanted = new Set(of);
      const found = drawing.elements.filter(el => wanted.has(el.id));
      if (found.length !== wanted.size) {
        const missing = [...wanted].filter(id => !found.some(el => el.id === id));
        throw new Error("that sketch has no element called " + missing.join(", "));
      }
      // Written as a flag or not written at all: a drawing nobody has marked
      // anything in stays a drawing with no construction key in it.
      for (const el of found) { if (on) el.construction = true; else delete el.construction; }
      return ctx.kernel.setSketch(edit.id, null, drawing);
    }),

  modelOp("relayer", ["id", "of", "to"],
    "Move elements of a sketch onto another layer. A name nobody has used yet makes "
    + "the layer, the way the layer op does - so putting a selection somewhere new is "
    + "one edit rather than two.",
    { op: "relayer", id: "SK1", of: ["e1", "e2"], to: "SETTING OUT" },
    async (ctx, edit) => {
      const of = (Array.isArray(edit.of) ? edit.of : [edit.of])
        .map(name => String(name || "").split(".")[0]).filter(Boolean);
      if (!of.length) throw new Error('"of" names the elements to move');
      const to = needText(edit, "to").trim();
      if (!to) throw new Error("a layer needs a name");
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const wanted = new Set(of);
      const found = drawing.elements.filter(el => wanted.has(el.id));
      if (found.length !== wanted.size) {
        const missing = [...wanted].filter(id => !found.some(el => el.id === id));
        throw new Error("that sketch has no element called " + missing.join(", "));
      }
      // The layer is written down even when it already had everything on it,
      // so a drawing that has just been given layers keeps them.
      const layers = sketchLayers(drawing).map(({ name, on, locked }) => ({ name, on, locked }));
      if (!layers.some(l => l.name === to)) layers.push({ name: to, on: true, locked: false });
      for (const el of found) el.layer = to;
      drawing.layers = layers;
      return ctx.kernel.setSketch(edit.id, null, drawing);
    }),

  modelOp("nudge", ["id", "of", "by"],
    "Move elements of a sketch bodily, by the same amount each, in the plane's own "
    + "coordinates. An arc and a circle move by their centre, so the radius and the "
    + "sweep are exactly as they were drawn. This is what dragging a window selection "
    + "in the sketcher writes.",
    { op: "nudge", id: "SK1", of: ["e1", "e2"], by: [40, 0] },
    async (ctx, edit) => {
      const of = (Array.isArray(edit.of) ? edit.of : [edit.of])
        .map(name => String(name || "").split(".")[0]).filter(Boolean);
      if (!of.length) throw new Error('"of" names the elements to move');
      const by = edit.by;
      if (!Array.isArray(by) || by.length !== 2 || !by.every(Number.isFinite))
        throw new Error('"by" must be two numbers');
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const wanted = new Set(of);
      const found = drawing.elements.filter(el => wanted.has(el.id));
      if (!found.length) throw new Error("that sketch has none of those elements on it");
      for (const el of found) sketchMoveElement(el, by);
      return ctx.kernel.setSketch(edit.id, null, drawing);
    }),

  modelOp("weld", ["id", "within?"],
    "Hold together every pair of ends in a sketch that lie on top of one another, "
    + "with a coincidence each. What a DXF import does on arrival, offered again for a "
    + "drawing that arrived before it did - or for one that has been drawn into since. "
    + "within is how close counts, in the plane's units; left out it is a millionth of "
    + "the drawing's own size, which is the same point at any scale.",
    { op: "weld", id: "SK1" },
    async (ctx, edit) => {
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const within = edit.within === undefined ? undefined : Number(edit.within);
      if (within !== undefined && !(within >= 0))
        throw new Error('"within" must be a distance, and not a negative one');
      const found = sketchOverlaps(drawing, within);
      if (!found.length)
        throw new Error("nothing in that sketch has two ends in the same place that are "
          + "not already held together");
      drawing.constraints.push(...found);
      return ctx.kernel.setSketch(edit.id, null, drawing);
    }),

  modelOp("fillet", ["id", "of", "radius"],
    "Round the corner between two elements of a sketch: both are trimmed back and an "
    + "arc of the radius given is put between them, held on at either end with a "
    + "coincidence. of names the two - \"e1\" and \"e2\", or ends of them, which is "
    + "what picking them in the sketcher gives. Lines, arcs and circles; a spline is "
    + "refused rather than approximated. Two that already run into each other smoothly "
    + "have no corner to round and say so.",
    { op: "fillet", id: "SK1", of: ["e1", "e2"], radius: 20 },
    async (ctx, edit) => {
      const of = Array.isArray(edit.of) ? edit.of : [];
      if (of.length !== 2) throw new Error('"of" names the two elements to round between');
      const radius = Number(edit.radius);
      if (!(radius > 0)) throw new Error('"radius" must be greater than zero');
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const made = sketchFillet(drawing, of[0], of[1], radius,
                                nextSketchId(drawing, "f"));
      return ctx.kernel.setSketch(edit.id, null, made.drawing);
    }),

  modelOp("erase", ["id", "element"],
    "Take one element off a sketch, and any relation that named it.",
    { op: "erase", id: "SK1", element: "e3" },
    async (ctx, edit) => {
      const gone = needText(edit, "element");
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      drawing.elements = drawing.elements.filter(el => el.id !== gone);
      drawing.constraints = drawing.constraints.filter(
        c => !c.of.some(name => String(name).split(".")[0] === gone));
      return ctx.kernel.setSketch(edit.id, null, drawing);
    }),

  modelOp("unrelate", ["id", "at?", "type?", "of?"],
    "Take a relation off a sketch: at is its place in the constraints list, or name "
    + "it by type and what it governs. Removing what holds a corner together lets "
    + "the two ends move apart again.",
    { op: "unrelate", id: "SK1", at: 0 },
    async (ctx, edit) => {
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const list = drawing.constraints;
      let gone = -1;
      if (Number.isInteger(edit.at)) {
        if (edit.at < 0 || edit.at >= list.length)
          throw new Error("that sketch has no relation " + edit.at);
        gone = edit.at;
      } else if (edit.type) {
        const of = Array.isArray(edit.of) ? edit.of : null;
        gone = list.findIndex(c => c.type === edit.type
          && (!of || JSON.stringify(c.of) === JSON.stringify(of)));
        if (gone < 0) throw new Error("that sketch has no such " + edit.type + " relation");
      } else throw new Error('name the relation with "at", or with "type" and "of"');
      list.splice(gone, 1);
      return ctx.kernel.setSketch(edit.id, null, drawing);
    }),

  modelOp("relate", ["id", "type", "of"],
    "Put a relation on a sketch: horizontal, vertical, parallel, perpendicular, tangent "
    + "or coincident. of names the elements it governs, or their ends as \"e1.b\".",
    { op: "relate", id: "SK1", type: "perpendicular", of: ["e1", "e2"] },
    async (ctx, edit) => {
      const relation = sketchRelation(needText(edit, "type"),
        Array.isArray(edit.of) ? edit.of : [edit.of]);
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const already = JSON.stringify(relation);
      if (!drawing.constraints.some(c => JSON.stringify(c) === already))
        drawing.constraints.push(relation);
      return ctx.kernel.setSketch(edit.id, null, drawing);
    }),

  modelOp("drag", ["id", "handle", "to"],
    "Move one end of one element of a sketch, in the plane's own coordinates. An "
    + "arc's endpoint is an angle and a radius rather than a free point, so moving "
    + "it turns and resizes the arc instead of tearing it. This is what dragging a "
    + "handle in the sketcher writes.",
    { op: "drag", id: "SK1", handle: "e1.b", to: [120, 40] },
    async (ctx, edit) => {
      const at = String(edit.handle || "");
      if (!/^[^.]+\.[^.]+$/.test(at))
        throw new Error('"handle" names an element and one of its ends, as "e1.b"');
      const to = edit.to;
      if (!Array.isArray(to) || to.length !== 2 || !to.every(Number.isFinite))
        throw new Error('"to" must be two numbers');
      const drawing = await drawingOf(ctx, needText(edit, "id"));
      const found = sketchHandleAt(drawing, at);
      if (!found) throw new Error("there is no handle '" + at + "' on that sketch");
      sketchMoveHandle(found.el, found.key, to);
      // A drag is the one edit where the relations are settled and written down
      // rather than left to the build: the hand is on this handle, so it stays
      // exactly where it was put and everything held to it follows all the way.
      // Anywhere else the drawing keeps what was drawn and the relations are
      // what they come to - here, dragging a corner has to move the corner.
      const settled = solveSketch(drawing, 40, [at]);
      return ctx.kernel.setSketch(edit.id, null, settled.drawing);
    }),

  //! Undo and redo are edits like everything else, so they are recorded, they
  //! show in the console, and a driver on the other end of a socket can send
  //! them. What they restore is the whole model file, because that is what the
  //! model is; the stack they walk is kept by the channel below.
  modelOp("undo", [],
    "Put the document back the way it was before the last edit that changed it. "
    + "View edits - selecting, moving a node on the canvas - are not on the stack.",
    { op: "undo" },
    ctx => ctx.undo()),

  modelOp("redo", [],
    "Put back an edit that was undone. Anything else undoes the redo.",
    { op: "redo" },
    ctx => ctx.redo()),

  viewOp("move", ["id", "x", "y"],
    "Put a node somewhere on the graph canvas. Layout is view state, so no function "
    + "re-executes - but it is written into the same file, under \"layout\".",
    { op: "move", id: "CB1", x: 420, y: 160 },
    (ctx, edit) => {
      ctx.setNode(needText(edit, "id"), needNumber(edit, "x"), needNumber(edit, "y"));
      return { ok: true };
    }),

  viewOp("select", ["id"],
    "Select a feature, in every window at once.",
    { op: "select", id: "CB1" },
    (ctx, edit) => { ctx.select(edit.id ? String(edit.id) : null); return { ok: true }; }),
];

const OP_INDEX = new Map(MDL_OPS.map(spec => [spec.op, spec]));
export const mdlOp = op => OP_INDEX.get(op) || null;

//! The language, in the shape the catalogue is published in - so a driver on the
//! other end of a socket can read what it is allowed to say.
export function mdlSchema() {
  return {
    format: "ocaf-mdl", version: 1,
    summary: "Every edit the document accepts. One object, or an array of them, "
           + "applied in order.",
    ops: MDL_OPS.map(spec => ({
      op: spec.op, fields: spec.fields, summary: spec.summary,
      rebuilds: !spec.view, example: spec.example,
    })),
  };
}

//! Reads one edit, or a list of them, out of text. Trailing commas and a bare
//! object without brackets are both accepted, because people type these.
export function parseEdits(text) {
  const trimmed = String(text || "").trim().replace(/,\s*$/, "");
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed[0] === "[" ? trimmed : "[" + trimmed + "]");
  return parsed.map(edit => {
    if (!edit || typeof edit !== "object" || Array.isArray(edit))
      throw new Error("each edit must be an object");
    if (!OP_INDEX.has(edit.op))
      throw new Error('unknown op "' + edit.op + '" - try ' +
        MDL_OPS.map(s => s.op).join(", "));
    return edit;
  });
}

/* ==========================================================================
   The channel.

   One of these exists per page. Everything that edits the model goes through
   run(); nothing else may touch the kernel. The record it keeps is the whole
   session in the language above, which is why the console can show it and why
   an external driver replaying it lands in the same place.
   ========================================================================== */

//! How many documents back you can go. Each one is the model file, which for a
//! part of this size is a few tens of kilobytes of text - so the whole stack
//! costs about what one mesh does.
const UNDO_DEPTH = 60;

//! Edits that arrive in a stream - a slider being dragged, a handle being
//! pushed around - are one edit as far as a person is concerned, so
//! consecutive ones on the same thing collapse into a single step rather than
//! filling the stack with a hundred of them. What "the same thing" means is
//! this key; an op without one never collapses.
const coalesceKey = edit => {
  if (edit.op === "set") return "set:" + edit.id + ":" + edit.key;
  if (edit.op === "vertex") return "vertex:" + edit.id + ":" + edit.index;
  if (edit.op === "drag") return "drag:" + edit.id + ":" + edit.handle;
  // A mesh operation being dragged - an extrude being pulled out, a bevel
  // being widened - rewrites the whole list on every frame. One drag is one
  // step, same as everything else here.
  if (edit.op === "meshop") return "meshop:" + edit.id;
  if (edit.op === "pick") return "pick:" + edit.id + ":" + edit.key;
  return null;
};
const COALESCE_WINDOW = 900;   // ms

//! What goes into the record of the session. Everything, except the file
//! somebody imported: the console shows every edit that has run, and a
//! megabyte of B-Rep in the middle of it is not something anyone reads. The
//! edit itself ran with the whole file; only the copy kept for reading is
//! shortened, and it says so.
const forRecord = edit => (edit && typeof edit.data === "string" && edit.data.length > 400)
  ? { ...edit, data: "<" + edit.data.length + " characters of file, not kept in the log>" }
  : edit;

export class Mdl {
  constructor(ctx) {
    this.ctx = ctx;              // { kernel, apply, setNode, readLayout, select, selected }
    this.history = [];
    this.serial = 0;
    this.watchers = new Set();
    // The state manager. Two stacks of whole model files: one behind, one
    // ahead. Nothing here understands what an edit does - it only knows what
    // the document said before one, which is the only definition of undo that
    // cannot drift from what the edits actually did.
    this.past = [];
    this.future = [];
    this.restoring = false;
    // What the document said when a hand went down, held until it comes up.
    this.gesturing = null;
    // Whether the kernel is currently allowed to answer approximately. See
    // draft: it is a note about the hand, not about the model.
    this.drafting = false;
    this.ctx.undo = () => this.step(this.past, this.future);
    this.ctx.redo = () => this.step(this.future, this.past);
    // Told whenever the stacks move, which is not the same as an edit running:
    // a batch of twenty edits moves them once, at the end.
    this.onStack = ctx.onStack || (() => {});
  }

  //! The document as it stands, layout and all - one entry on the stack.
  //!
  //! What is HIDDEN travels with it, for the same reason the graph's layout
  //! does: it is part of how the document was left, and a step of undo that
  //! put the geometry back but not what was showing would be a step that only
  //! half happened.
  async snapshot() {
    const model = await this.ctx.kernel.model();
    const layout = this.ctx.readLayout ? this.ctx.readLayout() : null;
    if (layout && Object.keys(layout).length) model.layout = layout;
    const hidden = this.ctx.readHidden ? this.ctx.readHidden() : null;
    if (hidden && hidden.length) model.hidden = hidden;
    return model;
  }

  async restore(model) {
    if (model.layout && this.ctx.readLayout) this.ctx.readLayout(model.layout);
    if (this.ctx.readHidden) this.ctx.readHidden(model.hidden);
    return await this.ctx.kernel.loadModel(model);
  }

  //! One step along the stacks, either way round. What is current goes on the
  //! other stack on the way past, so undo and redo are the same walk.
  async step(from, to) {
    if (!from.length) throw new Error(from === this.past ? "nothing to undo" : "nothing to redo");
    const here = await this.snapshot();
    const there = from.pop();
    this.restoring = true;
    try {
      const payload = await this.restore(there.model);
      to.push({ model: here, label: there.label });
      this.onStack();
      return payload;
    } finally { this.restoring = false; }
  }

  //! What the buttons read to know whether they are live, and what to call the
  //! step they would take.
  get undoable() { return this.past.length ? this.past[this.past.length - 1].label : null; }
  get redoable() { return this.future.length ? this.future[this.future.length - 1].label : null; }

  //! Remembers the document as it was before an edit. Doing something new
  //! forgets the branch that was undone, which is what every undo stack does
  //! and what everyone expects.
  remember(model, edit) {
    const key = coalesceKey(edit);
    const top = this.past[this.past.length - 1];
    if (key && top && top.key === key && Date.now() - top.at < COALESCE_WINDOW) {
      // Still the same drag: keep the older document, move the clock on.
      top.at = Date.now();
    } else {
      this.past.push({ model, label: edit.op, key, at: Date.now() });
      if (this.past.length > UNDO_DEPTH) this.past.shift();
    }
    this.future.length = 0;
    this.onStack();
  }

  watch(fn) { this.watchers.add(fn); return () => this.watchers.delete(fn); }

  announce(record) {
    this.history.push(record);
    if (this.history.length > 500) this.history.shift();
    for (const watcher of this.watchers) { try { watcher(record); } catch (e) { /* a watcher is not the model */ } }
  }

  //! Runs one edit, and hands the answer to whatever draws the document - so a
  //! slider dragged in the node graph redraws the tree, the panel and the 3D
  //! view without the graph knowing any of them exist. Returns what the kernel
  //! answered; throws what it threw, after the failure has been recorded, because
  //! a refused edit is part of the session too.
  //!
  //! \p hint is not part of the language: it is a delivery note for the
  //! redraw ("the panel is mid-drag, leave it alone"), never stored, never sent.
  async run(edit, hint) {
    const spec = OP_INDEX.get(edit && edit.op);
    if (!spec) throw new Error('unknown op "' + (edit && edit.op) + '"');
    const record = { n: ++this.serial, at: Date.now(), edit: forRecord(edit),
                     view: spec.view, ok: true, ms: 0 };
    const started = performance.now();
    // Taken before the edit runs, and kept only if it does: a refused edit
    // changed nothing, so it has nothing to undo.
    const walking = edit.op === "undo" || edit.op === "redo";
    const before = (spec.view || walking || this.restoring) ? null : await this.snapshot();
    try {
      const payload = await spec.run(this.ctx, edit);
      if (before) this.remember(before, edit);
      record.ms = Math.round(performance.now() - started);
      this.announce(record);
      if (payload && payload.tree && this.ctx.apply) this.ctx.apply(payload, hint || {});
      return payload;
    } catch (err) {
      record.ok = false;
      record.error = err && err.message ? err.message : String(err);
      record.ms = Math.round(performance.now() - started);
      this.announce(record);
      throw err;
    }
  }

  //! WHETHER THE KERNEL MAY ANSWER APPROXIMATELY, because a hand is still on
  //! a slider.
  //!
  //! Not an edit, and deliberately not in the language above: nothing about
  //! the model changes, so there is nothing to record, nothing to undo and
  //! nothing to write to a file. It is the same kind of note as \p hint - a
  //! statement about the person, not about the document.
  //!
  //! \p resettle says whether turning it off should rebuild what was drafted
  //! there and then. It should not when an edit is about to follow, because
  //! that edit rebuilds anyway and doing both builds the model twice.
  async draft(on, resettle = true) {
    const kernel = this.ctx.kernel;
    if (!kernel || !kernel.setDraft) return null;
    if (this.drafting === !!on) return null;
    this.drafting = !!on;
    const payload = await kernel.setDraft(!!on, resettle);
    if (payload && payload.tree && this.ctx.apply) this.ctx.apply(payload, { keepPanel: true });
    return payload;
  }

  //! A GESTURE: many edits over time that are one thing that happened.
  //!
  //! runAll knows its edits before it starts. A hand does not - a pad dragged
  //! out across the screen is ninety `set`s that arrive one frame at a time,
  //! and every one of them is a real edit that has to be run for the model to
  //! be rebuilt under the cursor. What they are not is ninety things to undo.
  //! So the snapshot is taken when the hand goes down and kept until it comes
  //! up, exactly as a list does it, with the edits in between running against
  //! a channel that is not recording.
  //!
  //! Nested gestures do nothing, which is what makes it safe to begin one
  //! without first asking whether anything else already has.
  async beginGesture() {
    if (this.gesturing || this.restoring) return;
    this.gesturing = await this.snapshot();
    this.restoring = true;
  }

  //! The hand comes up. \p changed says whether anything actually moved: a
  //! press and release that set nothing is not a step to undo.
  endGesture(changed = true) {
    const before = this.gesturing;
    if (!before) return;
    this.gesturing = null;
    this.restoring = false;
    if (changed) this.remember(before, { op: "set" });
  }

  //! A list of edits applied in order, carrying on past any that are refused
  //! and reporting them - what an assistant working the channel needs, where a
  //! person would have stopped and looked. One step to undo, whatever happened
  //! inside it, and \p onEach is called as each one lands so it can be watched.
  async runBatch(edits, onEach, signal = null) {
    const before = this.restoring ? null : await this.snapshot();
    const failed = [];
    let applied = 0;
    this.restoring = true;
    try {
      for (const edit of edits) {
        // Stop means stop: what has been applied stays, and the rest is dropped
        // rather than hurried through.
        if (signal && signal.aborted) break;
        try {
          await this.run(edit);
          applied++;
          if (onEach) await onEach(null, edit);
        } catch (err) {
          const message = err && err.message ? err.message : String(err);
          failed.push({ edit, message });
          if (onEach) await onEach(message, edit);
        }
      }
    } finally { this.restoring = !before; }
    if (before && applied) this.remember(before, { op: "build" });
    return { applied, failed };
  }

  //! A list of edits, in order, stopping at the first refusal. Returns the last
  //! answer, which is the one carrying the state everything else redraws from.
  //!
  //! Applied together, they are one step to undo. That is what a list means:
  //! drawing a line that also holds a corner together is one action, and so is
  //! pushing six vertices with one handle - the file still says exactly which
  //! six moved.
  async runAll(edits, hint) {
    if (!edits.length) return null;
    const before = this.restoring ? null : await this.snapshot();
    let payload = null;
    this.restoring = true;
    try {
      for (const edit of edits) payload = (await this.run(edit, hint)) || payload;
    } finally { this.restoring = !before; }
    // Kept only if something ran: a list that was refused on its first edit
    // changed nothing.
    if (before && payload) this.remember(before, { op: edits[0].op });
    return payload;
  }

  //! The document as text, with the graph's layout folded in. This is the file:
  //! what the sliders write, what the graph writes, what rebuilds the part.
  async modelText(space = 2) {
    return JSON.stringify(await this.snapshot(), null, space);
  }
}
