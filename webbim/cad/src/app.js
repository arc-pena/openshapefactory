// The emscripten glue, as a module. In the single-file build this import is
// stripped and the glue is concatenated in ahead of everything else, which
// declares the same name; served as modules, it is the file next door.
import replicadInit from "./occt-glue.js";
import { resource } from "./payload.js";
import { createWasmKernel } from "./wasm-kernel.js";
import { createHttpKernel } from "./http-kernel.js";
import { ENVIRONMENTS, Showroom } from "./showroom.js";
import { DXF_IGNORED, DXF_UNITS, dxfSurvey, ignoredName } from "./dxf.js";
import { ARCTIC_LOOK, ARCTIC_OVERLAY, Arctic, FINISHES, POINT_MARKS, POINT_WEIGHTS,
         VIEW_STYLES, appearanceOf, edgeRibbon, findFinish, findMark, findStyle,
         findWeight, hardEdgeMaterial, hexOf, makeSky, materialOf,
         rgbOf } from "./styles.js";
import { Mdl, defaultRefs } from "./mdl.js";
import { acceptsFrom, branchOf, branchesIn, dataLines, lightenModel, round, SAMPLES,
         sliderSpan } from "./ocaf.js";
import { GraphEditor } from "./graph.js";
import { Agent, agentTrouble, DEFAULT_MODEL, KEY_HOME, MODELS } from "./agent.js";
import { PluginHost, unpackResource } from "./plugin.js";
import { createWorkerKernel } from "./worker-kernel.js";
import { makeTour } from "./tour.js";
import { makePie, pieMenu } from "./pie.js";
import { LEVELS, LEVEL_OPS, MESH_MENUS, PICKS, makeMeshEditor } from "./meshedit.js";
import { MESH_OPS } from "./polymesh.js";
import { PICK_MODES, PICK_MODE_LABELS, describePicks, matchPick, pickOf } from "./subshape.js";
// No `as` here, nor anywhere else in this tree. The single-file build strips
// the imports and lets every module share one scope, so a name renamed on the
// way in is a name that does not exist in the page that gets published - and
// it is fine in the served build, which is the one nobody publishes.
import { LEADS, RULERS, faceWay, leadFor, lineWay, middleOf, nearestOnEdges,
         onPlane, rulerAt, vUnit } from "./handle.js";
import { ACTION_SAFE, FRAMES, TITLE_SAFE, dolly, frameAt, frameOf, fromView, letterbox,
         orbitAbout, safeAt, saysShot, truck } from "./camera.js";
import { EASES, beatFromHere, easeAt, momentAt, moveBeat, readStory, saysStory, startOf,
         stateAt, timeline, valuesBetween, writeStory } from "./story.js";
import { CUT_LINES, CUT_PATTERNS, CUT_WEIGHTS, SECTION_AXES, SECTION_STYLES, acrossOf,
         activePlanes, cutLength, cutRecord, cutStyleOf, dashSegments, freshCuts, lineNamed,
         motifsOf, patternNamed, refit, ribbonOf, saysCut, saysWhere, sectionEdges,
         styleNamed, travelOf, HATCH_MOTIFS } from "./section.js";
import { GIZMO_AXES, GIZMO_MODES, GIZMO_ORDER, GIZMO_PLANES, LENSES, TRANSFORM_KEYS,
         angleAbout, coversAt, dollyScale, fovFromLens, framedAt, handlesFor, landOn,
         lensFromFov, reachAlong, saysWhat, shortestTurn, sizeFrom, stepped, transformNow,
         transformTarget } from "./gizmo.js";
import { readValue, saysFormula } from "./formula.js";
import { duplicateEdits, instantiateEdits, reachesOut, saysReuse, setInputGroups,
         setsIn } from "./reuse.js";
import { CLIMATE } from "./climate-plugin.js";
import { IFC } from "./ifc-plugin.js";
import { CROWD } from "./crowd-plugin.js";
import { PACKING } from "./packing-plugin.js";
import { DRAWINGS } from "./drawings-plugin.js";
import { DRAW_LAYERS, assembleDrawing, includedIn, layerPen, penRecord, readExclusions,
         toggleExclusion, writeExclusions } from "./drawings.js";
import { FORMATS, IMPORT_CHUNK, SNIFF_BYTES, countObjParts, formatFor, isBinaryStl,
         readable, scanStep, sniffFormat, toBase64, whyNot } from "./exchange.js";
import { SKETCH_CLICKS, SKETCH_LAYER, SKETCH_RELATIONS, SKETCH_TYPES, currentLayer,
         elementLocked, elementShown, isConstruction, nextSketchId, readSketch,
         sketchBox, sketchCrossings, sketchDirectionAt, sketchDistanceTo, sketchElement,
         sketchHandleAt, sketchHandles, sketchInBox, sketchLayers, sketchMoveElement,
         sketchMoveHandle, sketchOnLayer, sketchOutline, sketchOverlaps,
         sketchRelationMarks, sketchTangentArc, solveSketch } from "./sketch.js";

"use strict";

/* ==========================================================================
   The interface.

   It owns no geometry.  A kernel holds the OCAF document - the label tree, the
   parameters, the B-Rep - and this page mirrors that tree and draws the
   triangles the kernel hands it.  When a parameter changes the kernel
   re-executes the functions downstream of the edit, bumps their revision, and
   the page re-fetches the triangle stream for those shapes only.

   Two kernels answer the same calls:

     the page kernel   OpenCascade compiled to WebAssembly, running right here
     a native kernel   ocafcad serve / python -m ocafpy serve, over HTTP, with
                       real OCAF persistence and STEP export

   Everything below this point talks to `kernel` and never learns which it got.
   ========================================================================== */

let kernel = null;
let ready = false;

const state = {
  schema: null,        // the feature catalogue, from the kernel
  tree: null,          // the mirror of the OCAF document
  report: null,        // what the last regeneration did
  selected: null,      // feature id
  picked: [],          // every feature picked, in the order the tree draws them
  anchor: null,        // where a shift-click measures its block from
  edited: null,        // feature id whose definition the panel shows
  hidden: new Set(),   // per-view hide; the document is not touched
  hover: null,         // the feature under the pointer, lit orange
  //! THE SET BEING WORKED IN - CATIA's work object. Everything made from now
  //! on is filed here. A property of the session rather than of the document:
  //! two people opening one model are not necessarily working in the same
  //! part of it, and which folder somebody's hands are in is not a fact about
  //! the model.
  workingIn: null,
  stream: null,        // what the last triangle fetch cost
  // How the model is drawn. A property of the window rather than of the
  // document: two people looking at one model may want different answers, and
  // neither answer belongs in the file.
  style: "shaded",
};

//! The part the page opens on, so the first thing you see is a real solid.
//! WHAT AN EMPTY DOCUMENT IS, and it is not empty.
//!
//! A part opens on the same four folders every CATIA part opens on, because
//! the first thing anybody does in a blank document is make them: an Origin
//! holding the axis system and the three principal planes, then somewhere for
//! the numbers, somewhere for the relations between them, and somewhere for
//! the part itself.
//!
//! There is no cube. A starter body is a guess at what is being modelled and
//! it is wrong every time; what a person wants on opening is the datums to
//! start from, which is what this is.
//!
//! The point and the three direction vectors live in the Origin folder with
//! the rest. They are what the axis system and the planes are BUILT from -
//! a plane's normal is a wire to a vector, not a number typed on it - so
//! hiding them would be hiding the model from itself. The folder folds.
const STARTER = {
  format: "ocaf-parametric-model", version: 1, name: "Part1", units: "mm",
  features: [
    { id: "ORIGIN", type: "GeometricalSet", name: "Origin", args: {} },
    { id: "PT1", type: "Point",  name: "Origin",      parent: "ORIGIN",
      args: { x: 0, y: 0, z: 0 } },
    { id: "VX",  type: "Vector", name: "X Direction", parent: "ORIGIN",
      args: { dx: 1, dy: 0, dz: 0 } },
    { id: "VY",  type: "Vector", name: "Y Direction", parent: "ORIGIN",
      args: { dx: 0, dy: 1, dz: 0 } },
    { id: "VZ",  type: "Vector", name: "Z Direction", parent: "ORIGIN",
      args: { dx: 0, dy: 0, dz: 1 } },
    { id: "AX1", type: "AxisSystem", name: "Origin Axis System", parent: "ORIGIN",
      args: { kind: "Origin and directions", origin: { ref: "PT1" },
              xdir: { ref: "VX" }, ydir: { ref: "VY" }, size: 200 } },
    //! The three principal planes, each square to the direction it is named
    //! across: XY is normal to Z, YZ to X, ZX to Y.
    { id: "PL1", type: "Plane",  name: "XY Plane", parent: "ORIGIN",
      args: { origin: { ref: "PT1" }, normal: { ref: "VZ" }, size: 200 } },
    { id: "PL2", type: "Plane",  name: "YZ Plane", parent: "ORIGIN",
      args: { origin: { ref: "PT1" }, normal: { ref: "VX" }, size: 200 } },
    { id: "PL3", type: "Plane",  name: "ZX Plane", parent: "ORIGIN",
      args: { origin: { ref: "PT1" }, normal: { ref: "VY" }, size: 200 } },
    { id: "PARAMS", type: "GeometricalSet", name: "Parameters", args: {} },
    { id: "RELS",   type: "GeometricalSet", name: "Relations",  args: {} },
    //! A GEOMETRICAL SET, and it is the current one when the part opens.
    //! This was a Body on the argument that solids belong in a Body and that
    //! is CATIA's distinction - which is true and is not what was asked for.
    //! A set is the more useful default because it takes anything: the first
    //! thing made in a new part is as likely to be a sketch or a plane as a
    //! solid, and a folder that refuses half of them is a folder you fight.
    { id: "PART",   type: "GeometricalSet", name: "Part", args: {} },
  ],
};

/* ==========================================================================
   The one way in.

   Nothing below calls the kernel directly. Every button, every slider, every
   wire dragged in the node graph and every line typed into its console becomes
   one JSON edit, goes through this channel, and the answer redraws whatever is
   open. That is what makes the tree and the graph the same program: they are
   two ways of writing the same text.
   ========================================================================== */

const mdl = new Mdl({
  get kernel() { return kernel; },
  apply: (payload, hint) => applyState(payload, hint),
  setNode: (id, x, y) => graph.setNode(id, x, y),
  readLayout: block => (block === undefined ? graph.layoutJson() : graph.readLayout(block)),
  //! What is hidden, both ways: asked for with nothing, set with a list. The
  //! same shape as readLayout, and in the file for the same reason.
  readHidden: list => {
    if (list === undefined) return [...state.hidden];
    state.hidden = new Set(Array.isArray(list) ? list : []);
    return null;
  },
  select: id => select(id, false),
  selected: () => state.selected,
  onStack: () => refreshSteps(),
  // Everything shift-clicked, so a feature that gathers several - a loft's
  // sections, a join's parts - is born wired to what was picked for it.
  picked: () => state.picked,
});

//! Runs an edit and redraws from the answer. Refusals land in the definition
//! panel and in the graph console, both.
//! Every edit, with a watchdog on it.
//!
//! OpenCascade runs in this page, on this thread. A boolean between two
//! two-hundred-thousand-triangle imports takes as long as it takes and nothing
//! can be drawn while it does - that is the cost of a kernel in a tab, and
//! pretending otherwise would be worse than saying it. What can be done is to
//! stop the page looking DEAD while it happens: after a second of no answer
//! the status bar says what it is working on, so a long edit reads as a long
//! edit rather than as a crash. And whatever happens, the last document is in
//! the browser's own store - see keepModel - so a tab that really does die
//! takes nothing with it.
async function edit(command, options = {}) {
  const watch = setTimeout(() => say("still working on " + (command.op || "that")
    + " - the modelling happens in this page, so a big one takes the page with it"), 1000);
  try { return await mdl.run(command, options); }
  catch (err) { showError(err.message); return null; }
  finally { clearTimeout(watch); }
}

//! Several edits that are one thing that happened: four features filed into a
//! set is one action and one step to undo, not four of each.
edit.many = async (commands, options = {}) => {
  if (!commands.length) return null;
  try { return await mdl.runAll(commands, options); }
  catch (err) { showError(err.message); return null; }
};

const schemaType = type => (state.schema ? state.schema.types.find(t => t.type === type) : null) || null;

/* ---------------------------------------------------- one feature, by name

   THE MOST CALLED FUNCTION IN THE PROGRAM, and it was a linear scan.

   A hundred places ask for a feature by id - the tree as it paints a row,
   the viewport as every shape lands, visibility, selection, the property
   panel. On a part of forty that is forty comparisons and nobody notices. On
   a building of six thousand, drawing the model asks it five thousand times
   and each one walks the list: fifteen million string comparisons to put a
   model on screen, for an answer a map gives in one step.

   The map is keyed on the tree OBJECT rather than rebuilt on a counter,
   because the tree arrives whole from the kernel and is replaced, never
   edited in place - so "is this the same array I indexed?" is the whole of
   the invalidation, and it cannot go stale.                                */

let namedFeatures = null, namedFrom = null;
const feature = id => {
  const tree = state.tree;
  if (!tree) return null;
  if (namedFrom !== tree.features) {
    namedFeatures = new Map();
    for (const f of tree.features) namedFeatures.set(f.id, f);
    namedFrom = tree.features;
  }
  return namedFeatures.get(id) || null;
};
const argSpec = (spec, key) => spec.args.find(a => a.key === key) || null;

/* ==========================================================================
   Viewport.  Nothing here knows what a cube is - it draws the triangles and
   the polylines the kernel sent for each shape.
   ========================================================================== */

const viewportEl = document.getElementById("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewportEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 1, 40000);
const world = new THREE.Group();
scene.add(world);

const key = new THREE.DirectionalLight(0xffffff, 0.78);
const fill = new THREE.DirectionalLight(0xffffff, 0.32);
const ambient = new THREE.AmbientLight(0xffffff, 0.55);
key.position.set(220, -320, 420);
fill.position.set(-360, 240, 120);
scene.add(key, fill, ambient);
// What each style lights the model with. Arctic is nearly all ambient on
// purpose: the only thing that may darken a white model is its own shape, and
// a key light across it would be telling you about the light instead.
const LIGHTING = {
  shaded:   { key: 0.78, fill: 0.32, ambient: 0.55 },
  rendered: { key: 0.55, fill: 0.22, ambient: 0.32 },
  arctic:   { key: 0.10, fill: 0.06, ambient: 0.98 },
};

const THEME = {};
let grid = null, axes = null;

function readTheme() {
  const style = getComputedStyle(document.documentElement);
  for (const name of ["shape", "shape-edge", "brep-edge", "curve", "accent", "hover",
                      "datum", "grid", "grid-axis", "bad", "cut-fill", "cut-line"])
    THEME[name] = new THREE.Color(style.getPropertyValue("--" + name).trim() || "#888888");
  paintBackdrop();
}

//! What is behind the model, which is part of the style. Shaded and Rendered
//! get the sky gradient they have always had; Arctic gets one flat tone a
//! shade darker than the clay, because a graded sky behind a white model is a
//! background competing with the thing in front of it.
function paintBackdrop() {
  const style = getComputedStyle(document.documentElement);
  const flat = style.getPropertyValue("--view-clay").trim() || "#e7eaee";
  viewportEl.style.background = state.style === "arctic" ? flat
    : `linear-gradient(${style.getPropertyValue("--view-top")}, ${style.getPropertyValue("--view-bottom")})`;
}

function buildGround() {
  for (const old of [grid, axes]) if (old) { world.remove(old); old.geometry.dispose(); old.material.dispose(); }
  grid = new THREE.GridHelper(1000, 20, THEME["grid-axis"], THEME.grid);
  grid.rotation.x = Math.PI / 2;            // OpenCascade is Z-up
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  world.add(grid);

  const span = 520;
  axes = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-span, 0, 0), new THREE.Vector3(span, 0, 0),
      new THREE.Vector3(0, -span, 0), new THREE.Vector3(0, span, 0)]),
    new THREE.LineBasicMaterial({ color: THEME["grid-axis"] }));
  world.add(axes);
}

/* ------------------------------------------------------------ orbit + zoom */

//! Panning is grabbing the model, not pushing the camera: the point under the
//! cursor stays under the cursor. So the camera moves the OTHER way from the
//! drag, and it moves by exactly what one pixel is worth at the distance being
//! looked at - which is what makes it feel like dragging a sheet of paper
//! rather than nudging a view.
function pan(dx, dy) {
  const height = renderer.domElement.clientHeight || 1;
  const perPixel = 2 * view.distance
    * Math.tan((camera.fov * Math.PI / 180) / 2) / height;
  const out = new THREE.Vector3().subVectors(camera.position, view.target).normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, out);
  // Straight down on the model, "right" is undefined from the world up; take it
  // from the yaw instead, which always knows which way round the view is.
  if (right.lengthSq() < 1e-8) right.set(-Math.sin(view.yaw), Math.cos(view.yaw), 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(out, right).normalize();
  view.target.addScaledVector(right, -dx * perPixel)
             .addScaledVector(up, dy * perPixel);
}
//! Set while something is building the model on its own, so the viewport keeps
//! up with it rather than staring at where the part used to be.
let following = false;

const view = { target: new THREE.Vector3(0, 0, 40), distance: 460, yaw: -0.72, pitch: 0.62,
               // How big the scene is. Every limit below is a multiple of it
               // rather than a number in millimetres, so the same controls work
               // on a bracket and on a building.
               span: 200 };
const STANDARD_VIEWS = {
  iso:   { yaw: -0.72, pitch: 0.62 },
  top:   { yaw: -Math.PI / 2, pitch: 1.5 },
  front: { yaw: -Math.PI / 2, pitch: 0.001 },
  right: { yaw: 0, pitch: 0.001 },
};

function placeCamera() {
  const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  camera.position.set(
    view.target.x + view.distance * cp * Math.cos(view.yaw),
    view.target.y + view.distance * cp * Math.sin(view.yaw),
    view.target.z + view.distance * sp);
  camera.up.set(0, 0, 1);
  camera.lookAt(view.target);
  // The clipping planes follow the camera rather than being fixed. A shopping
  // centre is thirty metres of millimetres and a bracket is a hundred of them;
  // one pair of planes cannot hold both, and a fixed far plane meant the
  // building simply vanished when the view was pulled back far enough to see
  // it - which looked like "fit does not fit".
  const span = Math.max(view.span, 1);
  camera.near = Math.max(0.05, Math.min(view.distance * 0.02, span * 0.02));
  camera.far = view.distance + span * 6;
  camera.updateProjectionMatrix();
  // A hatch is a density on the paper, so it follows the camera.
  sizeHatches();
}

//! Everything that would be photographed: the built shapes that are showing,
//! leaving out the datums, whose drawn size is arbitrary and would swamp a
//! small part. When there is nothing but datums, they are what there is.
//! HOW BIG THE MODEL IS - which is a question about the MODEL and not about
//! what the camera can currently see.
//!
//! This read group.visible, and group.visible is now two facts in one flag:
//! what the document says, and what this frame's culling decided. Asked
//! during a fit, the second one is circular - the camera is where it is
//! BECAUSE of the fit that has not happened yet - and on a building set out
//! on survey coordinates it framed the three origin planes and left the
//! building four hundred kilometres off screen. Ask what the document says.
//! AND ASKED OF THE DOCUMENT ITSELF, not of the flag the viewport caches for
//! it. The flag is written by applyVisibility, which runs at the END of a
//! sync - so between a model landing and that moment it says "undefined" and
//! this fell back to group.visible, which is true for everything that has just
//! arrived. On this building that meant the fit counted the Families and the
//! Placements, whose stand-ins are four hundred metres across, and framed a
//! sphere twenty-three times too big: the building came up the size of a
//! postage stamp in the middle of an empty screen.
//! WHERE A SHAPE IS, whether or not its triangles are here. A stand-in is an
//! empty group, so asking the OBJECT gets an empty box and every question
//! built on it - where to put the gizmo, what to centre on - answers "nowhere".
//! The recorded box is the same answer and is there either way.
function boxOfShape(id) {
  const held = shapes.get(id);
  if (!held || !held.group) return null;
  const ball = held.group.userData.ball;
  if (ball) return new THREE.Box3(ball.lo.clone(), ball.hi.clone());
  const box = new THREE.Box3().setFromObject(held.group);
  return box.isEmpty() ? null : box;
}

const showsInModel = (id, group) => {
  const entry = feature(id);
  if (entry) return entry.visible !== false && !state.hidden.has(id);
  return group.userData.hiddenByDoc === undefined ? group.visible : !group.userData.hiddenByDoc;
};

function sceneBounds() {
  const box = new THREE.Box3();
  let any = false;
  //! OFF THE RECORDED BOX rather than by walking the triangles: it is the same
  //! answer, it is already worked out, and it is the ONLY answer for a shape
  //! that is standing in as a box and has no triangles to walk. A model that
  //! has only just opened is all of those, and a fit that asked the objects
  //! would have found nothing to frame.
  const reach = group => {
    const ball = group.userData.ball;
    if (ball) box.expandByPoint(ball.lo).expandByPoint(ball.hi);
    else box.expandByObject(group);
  };
  for (const [id, { group }] of shapes) {
    const entry = feature(id);
    if (!showsInModel(id, group) || !entry || entry.category === "datum") continue;
    reach(group); any = true;
  }
  if (!any) for (const [id, { group }] of shapes)
    if (showsInModel(id, group)) { reach(group); any = true; }
  return any && !box.isEmpty() ? box : null;
}

//! The part of the canvas you can actually see. The panels float over the
//! model rather than sitting beside it, so a fit to the whole canvas puts a
//! third of the part underneath them - which is what "it does not fit" looked
//! like. Framing to this rectangle instead is the difference.
function freeRect() {
  const width = renderer.domElement.clientWidth, height = renderer.domElement.clientHeight;
  const whole = { x: 0, y: 0, w: width, h: height };
  if (!width || !height) return whole;
  // Every panel here is position: fixed, and offsetParent is null for those by
  // definition - so asking it whether they are on screen said "no" every time
  // and quietly gave back the whole canvas. The rectangle is the answer.
  const showing = id => {
    const el = document.getElementById(id);
    if (!el || el.hidden) return null;
    const box = el.getBoundingClientRect();
    return box.width > 1 && box.height > 1 ? box : null;
  };
  const pad = 16;
  let left = 0, right = width, top = 0, bottom = height;
  for (const id of ["rail", "sketch-rail", "tree-panel"]) {
    const box = showing(id);
    if (box) left = Math.max(left, box.right + pad);
  }
  for (const id of ["def-panel"]) {
    const box = showing(id);
    if (box) right = Math.min(right, box.left - pad);
  }
  for (const id of ["chip", "sketch-bar"]) {
    const box = showing(id);
    if (box) top = Math.max(top, box.bottom + pad);
  }
  for (const id of ["ai-bar"]) {
    const box = showing(id);
    if (box) bottom = Math.min(bottom, box.top - pad);
  }
  const rect = { x: left, y: top, w: right - left, h: bottom - top };
  // Panels crowding in from every side leave nothing worth aiming at; the
  // whole canvas is a better answer than a sliver.
  if (rect.w < width * 0.3 || rect.h < height * 0.3) return whole;
  return rect;
}

//! How far back the camera has to stand for a sphere of \p radius to fit
//! \p rect, and where to aim so it lands in the middle of it. The window is
//! usually wider than it is tall, so the vertical angle is the one that crops -
//! but not always, and which one it is is what a fit has to answer. That is
//! the whole calculation; the old one multiplied the box diagonal by 1.9.
function frameFor(radius, rect) {
  const width = renderer.domElement.clientWidth || 1;
  const height = renderer.domElement.clientHeight || 1;
  const vertical = camera.fov * Math.PI / 180;
  // The angles the free rectangle subtends, not the ones the canvas does.
  const halfV = Math.atan(Math.tan(vertical / 2) * (rect.h / height));
  const halfH = Math.atan(Math.tan(vertical / 2) * camera.aspect * (rect.w / width));
  const distance = radius / Math.sin(Math.min(halfV, halfH)) * 1.06;
  // And the offset that puts the middle of the rectangle where the middle of
  // the canvas is, in the world, at the distance being looked at.
  const perPixel = 2 * distance * Math.tan(vertical / 2) / height;
  return {
    distance,
    shift: [(rect.x + rect.w / 2 - width / 2) * perPixel,
            (rect.y + rect.h / 2 - height / 2) * perPixel],
  };
}

//! How big what is on screen is, which is what the wheel's limits and the
//! clipping planes are both measured against.
function measureScene() {
  const box = sceneBounds();
  if (!box) return;
  view.span = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1);
}

(function bindControls() {
  let mode = null, lastX = 0, lastY = 0, moved = 0, navigating = false;
  //! WAS THE RIGHT BUTTON A PAN OR A CLICK? The right button has always panned
  //! here, and it now also opens a menu - so the two are told apart the only
  //! way they can be: a drag that moved is a pan, and one that did not is a
  //! click. `contextmenu` fires after the button comes up, which is late
  //! enough to know.
  let rightDragged = false;
  const el = renderer.domElement;

  el.addEventListener("pointerdown", event => {
    // A number being dragged out owns the viewport until it is let go. The
    // press that lets go of it is the press that sets it, and nothing else:
    // it must not also orbit the model or pick whatever is behind the cursor.
    if (dropHeads()) { event.preventDefault(); return; }
    // An operation being pulled out owns the viewport until it is let go, the
    // same way a heads-up number does: while an extrude is being dragged the
    // drag is the extrude, not an orbit.
    if (meshing() && event.button === 0 && meshEditor.grabGizmo(rayFrom(event))) {
      mode = "meshgizmo";
    }
    else if (meshing() && meshEditor.live && event.button === 0) { mode = "meshdrag"; }
    // An axis of the handle takes the drag before the camera does.
    else if (event.button === 0 && !event.shiftKey && grabGizmo(event)) mode = "gizmo";
    // And so does the move, turn or size widget, which is the whole point of
    // making the camera ask for Alt: the left button belongs to the thing on
    // screen, not to the orbit behind it.
    else if (event.button === 0 && !event.shiftKey && grabGizmoWidget(event)) mode = "transform";
    // And the section's knob, which is the only thing a section plane can be
    // taken hold of by.
    else if (event.button === 0 && !event.shiftKey && grabSection(event)) mode = "cutting";
    // A sketch is looked at square on, and stays that way: the drag that would
    // orbit pans instead, because a drawing seen at an angle cannot be drawn on.
    // In select, a press that lands on an end takes hold of it.
    else if (sketching()) {
      // Inside a sketch, shift means "and this one too", not "pan" - so the
      // left button always draws or picks and panning is on the other buttons.
      if (event.button !== 0) mode = "pan";
      else if (grabSketchHandle(event)) mode = "handle";
      // A press that lands on something already picked takes hold of the whole
      // selection; a press on empty paper pulls a window out of it.
      else if (grabSketchMove(event)) mode = "move";
      else if (sketcher.tool === "select") { startSketchBand(event); mode = "band"; }
      else mode = "draw";
    }
    // MAYA'S THREE, and every package that learned them from Maya: Alt with
    // the left button tumbles, with the middle tracks, with the right dollies.
    // The right button on its own still pans, because that is what it has
    // always done here and taking it away would be taking something away.
    else if (event.altKey && event.button === 2) mode = "dolly";
    else mode = (event.shiftKey || event.button === 1 || event.button === 2) ? "pan" : "orbit";
    // WHETHER THIS DRAG IS ALLOWED TO MOVE THE CAMERA. Decided when the button
    // goes down and not changed after, so letting go of Alt halfway through an
    // orbit does not strand the model at an angle nobody asked for. A pan on
    // the middle or right button is always a pan: those buttons have nothing
    // else to do.
    navigating = mode !== "orbit" || !altToOrbit || event.altKey;
    // A dolly is asked for by name, so it is never held back by the setting
    // that decides who owns a plain left drag.
    if (mode === "dolly") navigating = true;
    lastX = event.clientX; lastY = event.clientY; moved = 0;
    if (event.button === 2) rightDragged = false;
    el.setPointerCapture(event.pointerId);
  });
  el.addEventListener("pointermove", event => {
    // The ruler first. A pad being dragged out is not an orbit, and while it
    // is being dragged out nothing else in here gets a look at the pointer.
    if (driveHeads(event)) return;
    if (mode === "meshgizmo") { meshEditor.dragGizmo(rayFrom(event)); return; }
    if (mode === "meshdrag") {
      const dx = event.clientX - lastX, dy = event.clientY - lastY;
      lastX = event.clientX; lastY = event.clientY;
      meshEditor.drag(dx, dy);
      return;
    }
    // In edit mode the thing under the pointer lights up before it is clicked,
    // which is most of what makes picking a face out of four hundred possible.
    if (meshing() && !mode) { meshEditor.hoverAt(event); return; }
    // And the same while an edge or a face is being picked for an operation.
    if (pickingOn() && !mode) { hoverPicking(event); return; }
    // And the handle about to be taken hold of, so a hand knows what it is
    // aiming at before it presses.
    if (gizmoOn() && !mode) hoverGizmo(event);
    if (sectioning() && !mode) hoverSection(event);
    if (sketching()) {
      const uv = sketchAt(event);
      if (uv && (sketcher.clicks.length || sketcher.hover)) { sketcher.hover = uv; refreshSketch(); }
      else sketcher.hover = uv;
    }
    //! WHAT THE POINTER IS OVER, lit before it is clicked. The last of the
    //! modes to get this and the one everybody meets first: edit mode has had
    //! it, sub-shape picking has had it, and choosing a body - the ordinary
    //! thing - had nothing at all, so there was no way to know what a click
    //! was about to take until after it had taken it.
    //!
    //! Only while nothing else owns the pointer. Mid-orbit the answer changes
    //! every frame and means nothing; inside a sketch or the mesh editor
    //! another kind of hover is already running.
    //! While points are being dropped the pointer belongs to the plane: the
    //! ghost follows it and nothing else lights up, because everything that
    //! could light up is behind the plane being drawn on.
    if (!mode && placingOn()) { hoverPlacing(event); return; }
    if (!mode && !sketching() && !meshing() && !pickingOn() && !handEditing())
      hoverFeature(event);
    if (!mode) return;
    if (mode === "gizmo") { dragGizmo(event); return; }
    if (mode === "transform") { dragGizmoWidget(event); return; }
    if (mode === "cutting") { dragSection(event); return; }
    if (mode === "handle") { dragSketchHandle(event); return; }
    if (mode === "move" || mode === "band" || mode === "draw") {
      moved += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY);
      lastX = event.clientX; lastY = event.clientY;
      // Under the wobble a hand makes holding still, nothing has moved yet -
      // so a click on a picked element stays a click rather than a nudge of
      // three hundredths of a millimetre.
      if (moved >= 4 && mode === "move") dragSketchMove(event);
      if (moved >= 4 && mode === "band") dragSketchBand(event);
      return;
    }
    const dx = event.clientX - lastX, dy = event.clientY - lastY;
    lastX = event.clientX; lastY = event.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if ((event.buttons & 2) && moved > 4) rightDragged = true;
    // A left drag with no Alt is not a camera move; it is a drag that missed a
    // handle, and it is still a click as far as picking is concerned.
    // LOOKING THROUGH A CAMERA, the drag moves the CAMERA and not the model.
    // The same three gestures as the viewport, on the same keys - Alt and the
    // left button tumbles it, the middle tracks it, the right dollies it -
    // because a camera IS a viewport and a second set of rules for it is a
    // second set of rules to remember. Without Alt the button is free, so
    // clicking a thing in the model or in the tree still picks it.
    if (lookingThrough() && navigating) {
      if (mode === "dolly") {
        // The camera walks in, which is what a dolly is. Said as a distance
        // because that is what the rig takes, worked out from the same
        // multiple the model view uses so the two feel like one gesture.
        const reach = Math.max(view.distance, 1);
        rigCamera("dolly", reach - reach * dollyScale(dx, dy));
      }
      else if (mode === "orbit") rigCamera("orbit", -dx * 0.006, dy * 0.006);
      else {
        const reach = Math.max(view.distance, 1) * 0.0016;
        rigCamera("truck", -dx * reach, dy * reach);
      }
      return;
    }
    if (!navigating) return;
    if (mode === "dolly") {
      const span = Math.max(view.span, 1);
      view.distance = Math.max(span * 0.02, Math.min(span * 40,
        view.distance * dollyScale(dx, dy)));
      // The widget is drawn at a size measured against the camera distance, so
      // it is rebuilt when that changes, exactly as the wheel does it.
      if (gizmoOn() && !gizmo.grab) refreshGizmo();
      if (meshEdit.gizmo) refreshMeshEdit();
      placeCamera(); draw();
      return;
    }
    if (mode === "orbit") {
      view.yaw -= dx * 0.008;
      view.pitch = Math.max(-1.53, Math.min(1.53, view.pitch + dy * 0.008));
    } else {
      pan(dx, dy);
    }
    placeCamera(); draw();
  });
  el.addEventListener("pointerup", event => {
    if (mode === "meshgizmo") { meshEditor.dropGizmo(); mode = null; return; }
    if (mode === "meshdrag") { meshEditor.drop(); mode = null; return; }
    // A click in edit mode picks at the level being edited: plain replaces,
    // shift adds, ctrl takes away, alt takes the whole loop through it.
    if (meshing() && (mode === "orbit" || mode === "pan") && moved < 4 && event.button === 0) {
      meshEditor.pickAt(event, { add: event.shiftKey, drop: event.ctrlKey || event.metaKey,
                                 loop: event.altKey });
      mode = null;
      return;
    }
    if (pickingOn() && (mode === "orbit" || mode === "pan") && moved < 4
        && event.button === 0) {
      clickPicking(event, false);
      mode = null;
      return;
    }
    if (mode === "transform") { dropGizmoWidget(); mode = null; return; }
    if (mode === "cutting") { dropSection(); mode = null; return; }
    if (lookingThrough() && through.dirty
        && (mode === "orbit" || mode === "pan" || mode === "dolly")) {
      saveThrough(); mode = null; return;
    }
    if (mode === "gizmo") dropGizmo();
    else if (mode === "handle") dropSketchHandle(event);
    else if (mode === "move") dropSketchMove(event);
    else if (mode === "band") { if (moved < 4) { dropSketchBand(null); sketchClick(event); }
                                else dropSketchBand(event); }
    else if (mode === "draw") { if (moved < 4) sketchClick(event); }
    // Shift-drag pans, but shift-click still picks - a click is a drag that
    // went nowhere, and holding shift should not stop you choosing things.
    // Shift-drag pans, but shift-click still picks - a click is a drag that
    // went nowhere, and holding shift should not stop you choosing things.
    else if (mode === "pan" && moved < 4 && event.shiftKey && !handEditing() && !sketching())
      pick(event);
    else if (mode === "orbit" && moved < 4 && placingOn()) dropPoint(event);
    else if (mode === "orbit" && moved < 4 && !pickVertex(event)) {
      // While a mesh is being edited by hand, the viewport belongs to its
      // handles: a click that misses one drops the vertex, it does not walk off
      // to whatever solid happened to be behind it. Esc, or the tree, leaves.
      if (handEditing()) { meshEdit.vertex = -1; refreshMeshEdit(); buildPanel(); }
      else pick(event);
    }
    mode = null;
  });
  //! Off the viewport, nothing is under the pointer.
  el.addEventListener("pointerleave", clearHover);
  el.addEventListener("pointercancel", () => {
    meshEdit.axis = null;
    if (gizmo.grab) dropGizmoWidget();
    if (cutter.grab) dropSection();
    if (sketcher.drag || sketcher.band || sketcher.move) {
      sketcher.drag = sketcher.band = sketcher.move = null;
      sketcher.preview = null;
      refreshSketch();
    }
    mode = null;
  });
  //! Double-clicking a sketch opens it - the way a CAD modeller does, and the
  //! same gesture in the tree. Double-clicking inside an open one ends a
  //! spline, which is the only element that does not know how long it is.
  el.addEventListener("dblclick", event => {
    // DOUBLE-CLICK TAKES THE ARRIS: everything tangent to the edge under the
    // pointer. It is the gesture every modeller has and the reason a fillet on
    // a rounded slab is one click rather than eight.
    if (pickingOn()) { clickPicking(event, true); return; }
    if (sketching()) { endSketchRun(); return; }
    // Already in edit mode: double-clicking picks the LOOP through what is
    // under the pointer, which is Maya's gesture for it.
    if (meshing()) {
      meshEditor.pickAt(event, { loop: true, add: event.shiftKey });
      return;
    }
    pick(event);
    const entry = feature(state.selected);
    if (entry && entry.sketch) { enterSketch(entry.id); return; }
    // A MESH OPENS ITS CAGE. This is the gesture every mesh editor uses and
    // the one the whole edit mode hangs off.
    if (entry && entry.produces === "mesh") enterMeshEdit(entry.id);
  });
  el.addEventListener("contextmenu", event => {
    event.preventDefault();
    // In edit mode the right button is the menu for whatever you are picking,
    // where the pointer is.
    if (meshing()) { openMeshContext(event); return; }
    //! AND OUTSIDE IT, THE MENU FOR WHAT IS UNDER THE POINTER. The right
    //! button was a pan and nothing else, so a body you could see and click
    //! had no menu at all - everything you might want to do to it was in the
    //! tree, which on a building of seven thousand rows is not somewhere you
    //! can get to. Dragging with the right button still pans; this fires when
    //! it did not move.
    if (rightDragged) { rightDragged = false; return; }
    openViewportMenu(event);
  });
  el.addEventListener("wheel", event => {
    event.preventDefault();
    // WHILE THE LENS IS OPEN THE WHEEL IS THE LENS. That is what the widget is
    // for: you cannot judge a focal length by typing numbers at it, you judge
    // it by rolling through them and watching the street compress. Close it
    // and the wheel is the zoom again, which is what it is the rest of the time.
    if (lensOpen()) { rollLens(-Math.sign(event.deltaY)); return; }
    // A DOLLY, NOT A ZOOM. The lens stays where it is and the camera walks:
    // everything behind the subject rushes past, which is the move you were
    // reaching for and the one a zoom cannot make.
    if (lookingThrough()) {
      rigCamera("dolly", -Math.sign(event.deltaY) * Math.max(view.distance, 1) * 0.1);
      // A WHEEL HAS NO BUTTON TO LET GO OF, so there is no moment that is
      // plainly the end of the gesture. Written back a breath after the last
      // notch instead: one step in the undo stack for one roll of the wheel,
      // rather than one per notch.
      settleThrough();
      return;
    }
    // Measured against how big the scene is. Fixed stops at 20 and 8000 mm meant
    // a thirty-metre building could not be pulled back far enough to be seen,
    // and one turn of the wheel undid a fit.
    const span = Math.max(view.span, 1);
    view.distance = Math.max(span * 0.02, Math.min(span * 40,
      view.distance * (1 + Math.sign(event.deltaY) * 0.12)));
    if (meshEdit.gizmo) refreshMeshEdit();
    // The widget is drawn at a size measured against the camera distance, so
    // it has to be rebuilt when that changes or it grows as you pull back.
    if (gizmoOn() && !gizmo.grab) refreshGizmo();
    placeCamera(); draw();
  }, { passive: false });
})();

let frameQueued = false;
function draw() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    lookAtDetail();
    if (state.style !== "arctic") { renderer.render(scene, camera); return; }
    // How far the occlusion reaches is a length in the model's own units: a
    // twentieth of what is on screen darkens the inside of a corner and leaves
    // a flat wall alone, at a bracket's scale and at a masterplan's alike.
    const pass = arcticPass();
    pass.setScale({ radius: Math.max(view.span * 0.05, 1e-4),
                    reach: view.distance + view.span * 3 });
    pass.render(scene, camera);
  });
}

/* ----------------------------------------------------- the three questions

   Run once per frame, before the render. Everything here is arithmetic over
   one sphere per feature: no triangles are touched, nothing is allocated in
   the loop, and a thousand features cost about as much as one draw call.   */

const detailFrustum = new THREE.Frustum();
const detailMatrix = new THREE.Matrix4();
const detailBall = new THREE.Sphere();
let boxHome = null;

function lookAtDetail() {
  if (!detail.on || !shapes.size) return;
  const tall = renderer.domElement.clientHeight || 1;
  //! Pixels across, from one sphere: the radius over the distance, through
  //! the lens. Exact at short range and near enough at long.
  const lens = (tall / 2) / Math.tan((camera.fov * Math.PI / 180) / 2);
  //! THE CAMERA AS IT IS NOW, not as the last frame left it. The renderer is
  //! what refreshes matrixWorldInverse, and it has not run yet this frame - so
  //! this culled against where the camera WAS. On a drag that is one frame of
  //! lag and invisible; on a jump - a fit, a preset view, a centre-on from the
  //! tree - the camera moves further than the model is wide, everything fails
  //! the frustum test at once, and because a frame is only drawn when
  //! something asks for one there is no next frame to put it right. The
  //! building simply disappeared, and stayed disappeared until you touched it.
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  detailMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  detailFrustum.setFromProjectionMatrix(detailMatrix);
  const eye = camera.position;

  //! FIRST PASS: what is on screen at all, and how big it is there. Nothing is
  //! decided yet - the budget decides, and it cannot until it knows the whole
  //! bill.
  const onScreen = [];
  //! What is on screen, big enough to matter, and has no triangles yet. This
  //! is the whole of the "load the tiles you are looking at" question: the
  //! frustum and the pixel test have already been paid for here, and the list
  //! they leave behind is the request.
  const hungry = [];
  let bill = 0;
  detail.gone = 0;
  for (const [id, held] of shapes) {
    const group = held.group;
    //! What the document says comes first: a body somebody put away is away
    //! whatever the camera thinks, and this must not fight applyVisibility.
    if (group.userData.hiddenByDoc) { group.userData.want = "off"; continue; }
    const ball = group.userData.ball;
    if (!ball) { group.userData.want = "full"; continue; }

    detailBall.center.copy(ball.at); detailBall.radius = ball.r;
    if (!detailFrustum.intersectsSphere(detailBall)) {
      group.userData.want = "off"; detail.gone++; continue;
    }
    const away = Math.max(eye.distanceTo(ball.at) - ball.r, 1e-3);
    const across = (ball.r / away) * lens * 2;
    if (across < detail.vanish) { group.userData.want = "off"; detail.gone++; continue; }
    //! A STAND-IN IS ALWAYS A BOX, whatever the budget would have said - it
    //! has nothing else to be until the kernel answers. Being on screen and
    //! this big is exactly what makes it worth asking for.
    if (group.userData.waiting) {
      group.userData.want = "box";
      group.userData.across = across;
      hungry.push({ id, across });
      continue;
    }
    group.userData.want = "full";
    group.userData.across = across;
    //! WHATEVER YOU ARE POINTING AT IS ALWAYS ITSELF, whatever the budget says
    //! later. It is the one thing on screen being looked at closely, and it is
    //! the one place a box would be noticed.
    group.userData.pinned = id === state.selected || id === state.hover
                         || state.picked.includes(id);
    onScreen.push(group);
    bill += group.userData.triangles || 0;
  }

  /* ------------------------------------------------------------ the budget

     UP TO HERE NOTHING HAS BEEN APPROXIMATED - what is on screen and big
     enough to see is drawn as itself, which is what anybody would want and
     what a part always gets.

     Over the budget is where the cheap representation earns its place. The
     smallest things on screen go first, because a box is indistinguishable
     from a beam at fifteen pixels and obvious at two hundred, and it stops
     the moment the bill is under. That is the whole heuristic: the memory the
     card is asked for per frame is capped, and what it is spent on is
     whatever is biggest in front of you.                                   */
  detail.boxed = 0;
  if (bill > detail.frame) {
    //! WORST VALUE FIRST, which is not the same as smallest first.
    //!
    //! Sorted by size alone, the first things boxed are the ones with the
    //! fewest triangles - so the bill barely moves and the loop goes on
    //! boxing until nearly everything is a box. What is wanted is the most
    //! triangles for the fewest pixels: a thousand-triangle bolt twelve
    //! pixels across is the thing to give up, and a two-triangle slab filling
    //! the screen is the last.
    const value = g => (g.userData.triangles || 0)
                     / Math.max(g.userData.across * g.userData.across, 1e-3);
    onScreen.sort((a, b) => value(b) - value(a));
    //! Down to nine tenths rather than to the line, so a frame that is a
    //! triangle over does not box something and unbox it on the next.
    const want = detail.frame * 0.9;
    for (const group of onScreen) {
      if (bill <= want) break;
      if (group.userData.pinned) continue;
      group.userData.want = "box";
      bill -= group.userData.triangles || 0;
      detail.boxed++;
    }
  }
  detail.drawn = onScreen.length - detail.boxed;
  detail.waiting = hungry.length;

  let boxesChanged = false;
  for (const [, held] of shapes) {
    const group = held.group;
    if (group.userData.hiddenByDoc) continue;
    const want = group.userData.want;
    const shownNow = want === "full";
    if (group.visible !== shownNow) group.visible = shownNow;
    if ((group.userData.boxed === true) !== (want === "box")) {
      group.userData.boxed = want === "box";
      boxesChanged = true;
    }
  }
  if (boxesChanged) rebuildBoxes();
  //! AND THEN ASK FOR WHAT IS MISSING. Not awaited: this is the middle of a
  //! frame, and the answer belongs to whichever frame it arrives in.
  if (hungry.length) feedTheView(hungry);
}

/* ----------------------------------------------------- the boxes, as one thing

   A THOUSAND BOXES IS A THOUSAND DRAW CALLS, which is the cost we were trying
   to get away from. So every shape standing in as a box is in ONE geometry,
   rebuilt when the set of them changes - which is when you move far enough
   for something to cross the threshold, not every frame.                    */

function rebuildBoxes() {
  if (boxHome) { world.remove(boxHome); boxHome.geometry.dispose(); boxHome = null; }
  const corners = [], index = [];
  let at = 0;
  for (const [, held] of shapes) {
    const group = held.group;
    if (!group.userData.boxed || !group.userData.ball) continue;
    const { lo, hi } = group.userData.ball;
    const x = [lo.x, hi.x], y = [lo.y, hi.y], z = [lo.z, hi.z];
    for (let i = 0; i < 8; i++) corners.push(x[i & 1], y[(i >> 1) & 1], z[(i >> 2) & 1]);
    //! The twelve triangles of a box, by corner number. Written out because a
    //! BoxGeometry each would be a thousand allocations per rebuild.
    for (const [a, b, c] of BOX_FACES) index.push(at + a, at + b, at + c);
    at += 8;
  }
  if (!corners.length) { draw(); return; }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(corners, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  boxHome = new THREE.Mesh(geometry, boxMaterial());
  boxHome.frustumCulled = false;
  boxHome.renderOrder = -1;
  world.add(boxHome);
}

//! Two triangles a side, wound outwards, by the corner numbering above:
//! bit 0 is x, bit 1 is y, bit 2 is z.
const BOX_FACES = [
  [0, 2, 3], [0, 3, 1], [4, 5, 7], [4, 7, 6],
  [0, 1, 5], [0, 5, 4], [2, 6, 7], [2, 7, 3],
  [0, 4, 6], [0, 6, 2], [1, 3, 7], [1, 7, 5],
];

let boxPaint = null;
function boxMaterial() {
  if (!boxPaint) boxPaint = new THREE.MeshLambertMaterial({ color: 0x9aa4ad,
    flatShading: true, side: THREE.FrontSide });
  const style = findStyle(state.style);
  boxPaint.color.set(style && style.solid ? style.solid : 0x9aa4ad);
  return boxPaint;
}

function resize() {
  const w = viewportEl.clientWidth, h = viewportEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // A camera being looked through owns the projection: its frame is its own
  // shape and has to be laid out again on the new window.
  if (lookingThrough()) { placeThrough(); refreshSafe(); }
  sizeRibbons();
  //! The overlay's width is in PIXELS, so it has to be told how many there
  //! are: the same line is a different fraction of the picture on a window
  //! half the size, and a weight that changed when you resized the window
  //! would not be a weight.
  paintHardEdges();
  draw();
}

/* ======================================= how much of the model is drawn

   A BUILDING IS NOT A PART, and the difference is not one of degree.

   The sample that brought this on is 7,548 features and 655,339 triangles -
   eleven storeys of structure out of Revit - and every one of them was drawn
   every frame whether it was on screen, behind a slab, or a beam four hundred
   metres away projecting to less than a pixel. Nothing about that is
   OpenCascade's doing or the browser's: it is asking the card to rasterise a
   building that is mostly not in shot.

   Three questions, asked per feature per frame, in the order they cost:

     is it on screen          the frustum. Answered with a sphere worked out
                              once when the shape landed, never from the
                              triangles.
     is it worth drawing      how many pixels across it comes to. Under a
                              couple, nothing you draw can be seen; under a
                              dozen, its bounding box is as much of it as the
                              screen can tell.
     is it worth KEEPING      the budget. What is held is capped; over the cap
                              the furthest things give their triangles back
                              and keep a box, and get them again when you go
                              near. The kernel still has the B-Rep, so nothing
                              is lost - this is a cache, and the point of a
                              cache is that it has a size.

   What this is NOT: an occlusion query. Deciding that a beam is behind a slab
   needs the depth buffer read back, which costs a stall per frame and is
   worse than drawing the beam. The honest version of "cheap representation
   for occluded objects" at this scale is the box, and the box is here.     */

const detail = {
  //! Off for a part, on for a building - decided by the size of the thing
  //! rather than by a preference, because nobody wants to be asked.
  on: false,
  //! Under this many pixels across, nothing is drawn at all. Two and a half
  //! pixels is a smudge: there is no drawing of a beam at that size that
  //! differs from not drawing it.
  vanish: 2.5,
  //! HOW MANY TRIANGLES ONE FRAME MAY COST. Over it, the smallest things on
  //! screen are drawn as their bounding boxes instead - smallest first,
  //! stopping the moment the bill is under. 350,000 is a number a laptop
  //! holds sixty times a second; the building that brought this on is
  //! 655,339, and about half of it is never more than a few pixels wide.
  frame: 350000,
  //! Below this many features the whole thing stays off: a part of forty
  //! bodies has nothing to gain and a box where a fillet was is a lie.
  from: 400,
  held: 0, drawn: 0, boxed: 0, gone: 0, evicted: 0, waiting: 0,
};

/* =========================================== the model that is not here yet

   WHAT GOOGLE MAPS DOES, and for the same reason.

   Opening a building meant tessellating all six thousand features before the
   first frame: four seconds of meshing, sixty megabytes of triangles, and a
   camera that could see perhaps three hundred of them. The other five
   thousand were paid for in full and drawn at two pixels or not at all.

   So the kernel is asked the cheap question first - where is each shape and
   how big - and every one of them goes into the scene as a box. That takes a
   fraction of a second and the building is THERE, in outline, complete, and
   you can already turn it round. Then the same three questions the budget
   already asks per frame - is it on screen, how big is it there, is it worth
   drawing - decide what to ask the kernel for, biggest first, and the boxes
   turn into geometry under the camera as you look at them. Turn away and
   nothing more is fetched; the tiles you are not looking at are not loaded.

   The B-Rep never left the kernel, so nothing here is lost - a stand-in is a
   cache miss, not a degraded model, and anything that needs the real
   triangles of everything (a section cut, the showroom, a measurement) says
   so by calling makeResident and waits the once.                          */

//! Feature ids drawn as a box because their triangles have not been asked for.
const unmeshed = new Set();
//! One request in flight at a time: the camera moves while the kernel answers,
//! and a second question asked from the next frame would be about a view that
//! has already gone.
let feeding = false;
//! HOW MANY SHAPES ONE ROUND FETCHES. Enough that a turn of the model fills in
//! in a couple of rounds, few enough that a round is a fifth of a second and
//! the pointer never sticks.
const HUNGER = 180;
//! Below this many shapes at once, everything is meshed up front. A part of
//! two hundred bodies has nothing to gain from this and a box where a fillet
//! was is a lie you would notice.
const LAZY_FROM = 900;

//! The same record ballOf makes, from the kernel's eight numbers instead of
//! from triangles there are none of.
function ballFromBox(low, high) {
  const lo = new THREE.Vector3(low[0], low[1], low[2]);
  const hi = new THREE.Vector3(high[0], high[1], high[2]);
  const at = lo.clone().add(hi).multiplyScalar(0.5);
  return { at, r: Math.max(lo.distanceTo(hi) / 2, 1e-6), lo, hi };
}

//! A shape in the scene that is only its extents. It holds no geometry, so it
//! costs eight numbers and an empty group; the box that is drawn for it comes
//! out of the one merged box mesh, like every other box.
function standIn(box) {
  const existing = shapes.get(box.id);
  if (existing) disposeGroup(existing.group);
  streams.delete(box.id);
  const group = new THREE.Group();
  group.userData.id = box.id;
  group.userData.waiting = true;
  //! NO TRIANGLES, truthfully: it is drawn as a box and costs the frame a
  //! box, so it must not be charged for geometry it does not have.
  group.userData.triangles = 0;
  group.userData.ball = box.low && box.high ? ballFromBox(box.low, box.high) : null;
  world.add(group);
  shapes.set(box.id, { revision: box.revision, group, waiting: true });
  unmeshed.add(box.id);
}

//! The triangles of the shapes named, and the stand-ins replaced by them.
async function fetchShapes(ids) {
  const payload = await kernel.mesh(ids);
  let triangles = 0;
  for (const mesh of payload.features) { setShape(mesh); triangles += mesh.triangles || 0; }
  return triangles;
}

//! ONE ROUND OF FILLING IN, asked by the frame that noticed the gap. The list
//! arrives biggest-on-screen first, because that is the order you would notice
//! them in.
async function feedTheView(hungry) {
  if (feeding || !kernel || !hungry.length) return;
  feeding = true;
  try {
    hungry.sort((a, b) => b.across - a.across);
    const want = hungry.slice(0, HUNGER).map(h => h.id);
    await fetchShapes(want);
    //! ASKED FOR IS ASKED FOR, answered or not. A shape the kernel had nothing
    //! to say about would otherwise still be waiting on the next frame, and be
    //! asked for again, and again, for as long as you looked at it.
    for (const id of want) {
      if (!unmeshed.has(id)) continue;
      unmeshed.delete(id);
      const held = shapes.get(id);
      if (held) { held.waiting = false; held.group.userData.waiting = false; }
    }
    rebuildPickList();
    rebuildBoxes();
    //! AND THE CAPS, if there is a cut: the shapes that just landed are inside
    //! it as much as the ones that were here before it.
    settleSection();
    draw();
  } catch (err) {
    //! A round that failed must not stop the next one - the camera will ask
    //! again on the next frame, and asking again is the whole recovery.
  } finally { feeding = false; }
}

//! EVERYTHING, REALLY EVERYTHING - for the few things that cannot work from a
//! box: a section cut, the showroom, an export of what is on screen.
async function makeResident(why = "Loading the model\u2026") {
  if (!unmeshed.size || !kernel) return;
  const all = [...unmeshed];
  let done = 0;
  showWorking(why, all.length.toLocaleString() + " shapes", 0);
  try {
    for (let at = 0; at < all.length; at += MESH_BATCH) {
      await fetchShapes(all.slice(at, at + MESH_BATCH));
      done += MESH_BATCH;
      showWorking(why, Math.min(done, all.length).toLocaleString() + " of "
                  + all.length.toLocaleString() + " shapes", done / all.length);
      await breathe();
    }
    rebuildPickList();
    weighModel();
    rebuildBoxes();
    draw();
  } finally { doneWorking(); }
}

//! The sphere a group sits in, in world coordinates. Taken once, off the
//! bounding box, because a group's own boundingSphere is per geometry.
function ballOf(group) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return null;
  const ball = box.getBoundingSphere(new THREE.Sphere());
  return { at: ball.center.clone(), r: Math.max(ball.radius, 1e-6),
           lo: box.min.clone(), hi: box.max.clone() };
}

/* -------------------------------------------------- the streamed triangles */
const shapes = new Map();   // feature id -> { revision, group }
const pickable = [];

function disposeGroup(group) {
  group.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) [].concat(object.material).forEach(m => m.dispose());
  });
  world.remove(group);
}

//! Turns one shape's triangle stream into scene objects.
//! A datum is drawn faintly because it is scaffolding. A curve a loft is built
//! on is not scaffolding until something consumes it, so it is drawn as
//! geometry - which is also how you find it to wire it up.
const drawsFaint = entry => !!entry && entry.category === "datum" && entry.type !== "Line";

//! The surface of one body, as this style wants it.
//!
//! Three styles, one material: what changes between them is where the numbers
//! come from. Shaded takes the theme's grey because modelling is not about
//! what a thing is made of. Rendered takes the object's own material, which is
//! the whole point of having one. Arctic takes the same clay for everything,
//! because the moment two objects are different colours you are reading the
//! colours rather than the form.
//! EVERY SURFACE IS DRAWN FROM BOTH SIDES.
//!
//! WebGL's default is to throw away the back of a face, which is free and
//! right for a closed solid: you cannot see the inside of a box. It is wrong
//! for everything else this program makes. A filled surface, a swept skin, a
//! drafted face, a loft - each of those is a sheet with a front and a back,
//! and which one is the front is whatever the kernel happened to decide when
//! it built it. Half of them come out facing away, and a face facing away is
//! not drawn dark or drawn flipped: it is not drawn at all, and you look
//! straight through a surface that is definitely there.
//!
//! So nothing here is culled. three.js flips the normal for a back face
//! before it lights it, so the far side of a sheet shades like a surface
//! rather than like a hole, and a solid looks exactly as it did - its inside
//! is still behind its outside. What it costs is the fill rate of faces that
//! are usually hidden anyway, which is nothing a model of this size notices.
//!
//! The one place this rule does not apply is stencilCopies, which counts
//! front and back faces SEPARATELY to work out where a section plane cuts
//! through solid. That one is about sidedness itself.
//!
//! AND THE FAR SIDE HAS TO BE LIT. Drawing a back face is only half of it: the
//! normal it is shaded with still points away, so every light misses it and it
//! comes back ambient-only - a flat near-black patch where a surface should
//! be, which reads as broken rather than as a surface seen from behind. Later
//! three.js turns the normal round for a back face on its own; the revision
//! this page carries does not, and that was measured rather than assumed - one
//! plane, one light, read off the buffer: 178,244,255 lit and 14,20,28 from
//! behind, which is the ambient term and nothing else.
//!
//! So the flip is done here, in four words of GLSL dropped in after the
//! normal is worked out. A sheet now shades the same from either side, which
//! is the truth about a sheet: it has no inside.
const TURN_BACK_FACES = shader => {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <normal_fragment_begin>",
    "#include <normal_fragment_begin>\n\tnormal = gl_FrontFacing ? normal : -normal;");
};

const bothSides = material => {
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = TURN_BACK_FACES;
  return material;
};

function surfaceMaterial(entry, style = findStyle(state.style)) {
  if (style.clay) {
    const clay = bothSides(new THREE.MeshStandardMaterial({
      color: new THREE.Color(...style.clay), metalness: 0, roughness: 1,
    }));
    clay.userData.base = clay.color.clone();
    return clay;
  }
  if (!style.materials) {
    //! The colour the body wears, on the modelling light - and only the
    //! colour. A finish nobody has chosen is the neutral grey this always
    //! drew, so a part that has never been given a material looks exactly as
    //! it did.
    const worn = style.colours ? materialOf(entry && entry.appearance) : null;
    const colour = worn && entry && entry.appearance
      ? new THREE.Color(...worn.color) : THEME.shape.clone();
    const shaded = bothSides(new THREE.MeshStandardMaterial({
      color: colour, metalness: 0.15, roughness: 0.55,
      transparent: worn && worn.opacity < 0.999,
      opacity: worn ? worn.opacity : 1,
      depthWrite: !worn || worn.opacity >= 0.999,
    }));
    shaded.userData.base = colour.clone();
    return shaded;
  }
  const made = materialOf(entry && entry.appearance);
  const material = bothSides(new THREE.MeshStandardMaterial({
    color: new THREE.Color(...made.color),
    metalness: made.metalness, roughness: made.roughness,
    envMap: skyMap(), envMapIntensity: 1,
    transparent: made.opacity < 0.999, opacity: made.opacity,
    depthWrite: made.opacity >= 0.999,
  }));
  material.userData.base = material.color.clone();
  return material;
}

//! And the line along its edges. A tangent edge is scaffolding for modelling
//! and clutter in a picture, so the styles that are pictures do without it -
//! but a curve FEATURE is not an edge, it is the thing itself, and it is drawn
//! in every style.
//! THE COLOUR SOMEBODY GAVE IT, if they gave it one.
//!
//! A colour on a feature used to mean a colour on its surfaces, so a curve or
//! a plane wore the theme's and nothing else - and a wireframe you have
//! coloured on purpose, which is what a whole imported building's setting-out
//! is, came out in the same green as every other curve. A line is as capable
//! of being blue as a solid is.
function wornColour(entry) {
  const worn = entry && entry.appearance && entry.appearance.color;
  return Array.isArray(worn) && worn.length === 3 ? new THREE.Color(...worn) : null;
}

//! A SOLID'S EDGES ARE BLACK, AND THEY ARE OPAQUE, and the second is what
//! makes the first true.
//!
//! They were a dark slate at four-tenths alpha, which is not a colour: it is
//! four-tenths of a colour over six-tenths of whatever is behind it. On the
//! neutral grey everything used to be, that reads as a darker grey and looks
//! like a line. On a model with colours in it - which is every IFC import, and
//! is the whole point of Shaded obeying colour - it reads as a darker ORANGE
//! on a beam and a darker GREEN on a column, because that is arithmetically
//! what it is. Over the IFC beam orange it composites to rgb(162,105,55).
//!
//! An edge is not a shade of the face it bounds. It is ink on top of it, so it
//! is opaque, and it carries its own colour rather than borrowing one.
//!
//! Its own theme entry rather than shape-edge, which the sketcher also draws
//! held lines with and which has no business turning black because a solid's
//! edges did. In the dark theme it is near-white: "black" means the ink the
//! sheet is not, and black ink on a black sheet is no line at all.
function edgeMaterial(entry, style = findStyle(state.style)) {
  const datum = drawsFaint(entry);
  const curve = !!entry && entry.produces === "curve";
  const shown = curve || datum ? true : style.edges;
  //! Only a datum or a curve wears the colour it was given: those lines ARE
  //! the feature. A solid's edges are not the solid, and taking its colour is
  //! exactly the thing being fixed here.
  const worn = datum || curve ? wornColour(entry) : null;
  const solid = !datum && !curve;
  const line = new THREE.LineBasicMaterial({
    color: worn || (datum ? THEME.datum : curve ? THEME.curve : THEME["brep-edge"]),
    transparent: !solid, opacity: datum ? 0.42 : 1,
    visible: shown && (datum ? style.datums : true),
  });
  line.userData.base = line.color.clone();
  return line;
}

//! The sky a rendered view reflects, built once and kept. Nothing needs it
//! until somebody asks for Rendered, and a session that never does never pays
//! for the prefiltering.
let sky = null;
function skyMap() {
  if (!sky) sky = makeSky(THREE, renderer);
  return sky;
}

//! Ambient occlusion and ink. Also built on demand: two render targets and
//! three shader programs that a shaded session has no use for.
let arctic = null;
function arcticPass() {
  if (!arctic) { arctic = new Arctic(THREE, renderer); arctic.setLook(arcticLook); }
  return arctic;
}

/* ------------------------------------------------- how white, how dark

   THE ONE STYLE WITH A DIAL ON IT, because it is the one whose whole job is
   how something looks rather than what it is. Shaded and Rendered answer a
   question - what is the shape, what is it made of - and there is a right
   answer to both. Arctic is a picture, and how much shadow a picture wants
   is a matter of what is in it: a stair detail wants its corners dug out, a
   tower wants a whisper of grey in the reveals and clean white everywhere
   else. Rhino gives it the same four sliders for the same reason.

   Kept in the browser rather than in the document: it is how THIS WINDOW is
   drawing, like the style itself, and a model file that told everyone else
   how dark their shadows should be would be telling them the wrong thing. */

const arcticLook = { ...ARCTIC_LOOK };

const LOOK_FIELDS = [
  { key: "shadow", input: "look-shadow", digits: 2 },
  { key: "paper",  input: "look-paper",  digits: 2 },
  { key: "ink",    input: "look-ink",    digits: 2 },
  { key: "line",   input: "look-line",   digits: 2 },
];

/* ------------------------------------------------ the model's own edges

   THE INK PASS CANNOT DRAW THESE. It finds silhouettes and creases in the
   depth buffer, which is the right way to draw a form and is the only way
   that works on a mesh - but the edge between two faces meeting at three
   degrees leaves nothing in a depth buffer to find, and on a machined part
   that is most of what you are looking at. Those edges are sitting in the
   geometry: the kernel already sent them, and they are already on the card as
   the LineSegments every other style draws.

   So the overlay is built FROM those, as ribbons - see edgeRibbon - on a
   layer of their own, and Arctic renders that layer once, over the clay and
   under the ink.                                                          */

//! How many segments are worth turning into quads. A ribbon is five times the
//! memory of the line it replaces, and a building imported from IFC can carry
//! millions of edges - so there is a ceiling, and going over it says so rather
//! than quietly drawing half a model or stopping the page for ten seconds.
const HARD_EDGE_BUDGET = 900000;

const hardEdges = new Map();          // feature id -> the ribbon in its group
let hardEdgeTally = { drawn: 0, left: 0 };

//! The width the overlay is drawn at, and the size of the picture it is drawn
//! into - both in pixels, because that is what a line weight means on screen.
function paintHardEdges() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  for (const ribbon of hardEdges.values()) {
    ribbon.material.uniforms.width.value = Math.max(0.25, arcticLook.line);
    ribbon.material.uniforms.screen.value.set(size.x, size.y);
  }
}

//! One shape's overlay, made or taken away. Called as shapes stream in as well
//! as when the switch is thrown, because a model that is still meshing gains
//! bodies for several seconds after the tick was set and every one of them
//! needs its edges.
function hardEdgesFor(id, held) {
  const want = arcticLook.edges && state.style === "arctic";
  const had = hardEdges.get(id);
  if (!want) {
    if (had) {
      had.parent.remove(had);
      had.geometry.dispose();
      had.material.dispose();
      hardEdges.delete(id);
    }
    return;
  }
  //! Rebuilt rather than kept when the shape is replaced: setShape makes a new
  //! group, so an overlay held from before is attached to a group nobody is
  //! drawing. Cheapest test for that is whether it is still in this one.
  if (had && had.parent === held.group) return;
  if (had) { had.geometry.dispose(); had.material.dispose(); hardEdges.delete(id); }
  const lines = held.group.children.find(one => one.isLineSegments && one.userData.brepEdges);
  if (!lines || !lines.geometry.attributes.position) return;
  const positions = lines.geometry.attributes.position.array;
  const segments = Math.floor(positions.length / 6);
  if (hardEdgeTally.drawn + segments > HARD_EDGE_BUDGET) {
    hardEdgeTally.left += segments;
    return;
  }
  const geometry = edgeRibbon(THREE, positions);
  if (!geometry) return;
  const ribbon = new THREE.Mesh(geometry, hardEdgeMaterial(THREE, { width: arcticLook.line }));
  //! NOT A SURFACE, and every walk over a group's children has to be told so:
  //! it is a Mesh, it has triangles, and left unmarked the style walk paints
  //! clay on it, the section walk makes stencil copies of it, and the
  //! appearance walk gives it a finish.
  ribbon.userData.hardEdge = true;
  ribbon.layers.set(ARCTIC_OVERLAY);
  ribbon.renderOrder = 3;
  //! Culled by the LINES' bounds, which are the same bounds: the ribbon is
  //! half a pixel wider and a frustum test does not care.
  ribbon.frustumCulled = true;
  held.group.add(ribbon);
  hardEdges.set(id, ribbon);
  hardEdgeTally.drawn += segments;
}

//! Every shape, brought into line with the switch. Cheap when the switch is
//! off and nothing has been built; a walk plus a build when it has just been
//! turned on.
function syncHardEdges() {
  hardEdgeTally = { drawn: 0, left: 0 };
  for (const [id, held] of shapes) hardEdgesFor(id, held);
  paintHardEdges();
  const tick = document.getElementById("look-edges");
  if (tick) tick.disabled = !anyBrepEdges();
  const note = document.getElementById("look-edges-note");
  if (note) {
    //! WHAT WAS LEFT OUT, SAID OUT LOUD. An overlay that quietly drew the
    //! first nine hundred thousand segments and stopped is an overlay that
    //! looks like a model with its edges missing.
    note.textContent = hardEdgeTally.left
      ? Math.round(hardEdgeTally.left / 1000) + "k edges over the limit, not drawn"
      : !anyBrepEdges() ? "nothing on screen has edges to draw" : "";
    note.hidden = !note.textContent;
  }
}

//! Is there a B-Rep on screen at all? What decides whether the tick is offered
//! - "if you are looking at a solid" is the condition, and a scene of nothing
//! but meshes and curves has no edges of this kind to lay over anything.
function anyBrepEdges() {
  for (const [, held] of shapes)
    if (held.group.visible
        && held.group.children.some(one => one.isLineSegments && one.userData.brepEdges
          && one.geometry.attributes.position
          && one.geometry.attributes.position.count > 1)) return true;
  return false;
}

function rememberedLook() {
  try {
    const kept = JSON.parse(localStorage.getItem("ocafcad/arctic-look") || "null");
    if (kept && typeof kept === "object") {
      for (const { key } of LOOK_FIELDS)
        if (typeof kept[key] === "number" && isFinite(kept[key])) arcticLook[key] = kept[key];
      //! The tick is not one of the four sliders and is not a number, so it is
      //! read on its own. Remembered like the rest of them: how this window
      //! draws is a preference, not a property of the document.
      if (typeof kept.edges === "boolean") arcticLook.edges = kept.edges;
    }
  } catch (e) {}
}

function paintLook() {
  for (const { key, input, digits } of LOOK_FIELDS) {
    const slider = document.getElementById(input);
    const shown = document.getElementById(input + "-out");
    if (slider) slider.value = String(arcticLook[key]);
    if (shown) shown.textContent = arcticLook[key].toFixed(digits);
  }
  const tick = document.getElementById("look-edges");
  if (tick) tick.checked = !!arcticLook.edges;
}

function setLook(changes, remember = true) {
  const wasEdges = arcticLook.edges;
  Object.assign(arcticLook, changes);
  if (arctic) arctic.setLook(arcticLook);
  paintLook();
  //! The weight slider drives BOTH: the ink pass's own thickness, which is a
  //! uniform Arctic already took above, and the overlay's line width, which is
  //! the same number in the same units. One slider, because "how thick is a
  //! line here" is one question and answering it twice is how the two drift
  //! apart.
  if (arcticLook.edges !== wasEdges) syncHardEdges();
  else if (arcticLook.edges) paintHardEdges();
  if (remember)
    try { localStorage.setItem("ocafcad/arctic-look", JSON.stringify(arcticLook)); } catch (e) {}
  draw();
}

function wireLook() {
  rememberedLook();
  paintLook();
  for (const { key, input } of LOOK_FIELDS) {
    const slider = document.getElementById(input);
    if (!slider) continue;
    slider.addEventListener("input", () => setLook({ [key]: Number(slider.value) }));
  }
  const tick = document.getElementById("look-edges");
  if (tick) tick.addEventListener("change", () => setLook({ edges: tick.checked }));
  const reset = document.getElementById("look-reset");
  if (reset) reset.addEventListener("click", () => setLook({ ...ARCTIC_LOOK }));
}
wireLook();

//! Which style is showing, applied to everything already on screen. Nothing is
//! re-meshed - the triangles are the same triangles - so this is a walk over
//! the materials and a redraw.
function applyStyle(styleKey = state.style) {
  const style = findStyle(styleKey);
  state.style = style.key;

  const light = LIGHTING[style.key] || LIGHTING.shaded;
  key.intensity = light.key;
  fill.intensity = light.fill;
  ambient.intensity = light.ambient;

  if (grid) grid.visible = style.ground;
  if (axes) axes.visible = style.ground;

  for (const [id, { group }] of shapes) {
    const entry = feature(id);
    for (const object of group.children) {
      //! The arctic overlay is a Mesh and is not a surface - see hardEdgesFor.
      //! Unguarded, the style walk put clay on it and the edges went white.
      if (object.userData.hardEdge) continue;
      if (object.isMesh) {
        const was = object.material;
        object.material = object.userData.datum
          ? was
          : surfaceMaterial(entry, style);
        if (object.userData.datum) {
          was.color.copy(wornColour(entry) || THEME.datum);
          was.userData.base = was.color.clone();
          was.visible = style.datums;
        }
        else was.dispose();
      } else if (object.isLineSegments) {
        object.material.dispose();
        object.material = edgeMaterial(entry, style);
      } else if (object.isPoints) {
        object.material.visible = style.datums || !object.parent.userData.datum;
      }
    }
  }

  // The backdrop belongs to the style too: a white model wants a plain ground
  // behind it, not a blue-grey sky that its own silhouette disappears into.
  document.body.dataset.style = style.key;
  //! The dial is up only when the style it is about is.
  const look = document.getElementById("arctic-look");
  if (look) look.hidden = style.key !== "arctic";
  //! And the overlay exists only while Arctic does. Left standing, it would
  //! be five times the memory of the edge buffers for something on a layer
  //! nothing is rendering.
  syncHardEdges();
  paintBackdrop();
  // The material panel says where a material is shown and that depends on the
  // style, so it is rebuilt rather than left saying something that was true a
  // moment ago.
  if (state.edited
      && (wearsMaterial(feature(state.edited)) || marksPoints(feature(state.edited))))
    buildPanel();
  for (const button of document.querySelectorAll("[data-style]"))
    button.setAttribute("aria-pressed", button.dataset.style === style.key ? "true" : "false");
  paintSelection();
  draw();
}

function setStyle(styleKey) {
  applyStyle(styleKey);
  try { localStorage.setItem("ocafcad/view-style", state.style); } catch (e) {}
  say(findStyle(state.style).label + " — " + findStyle(state.style).summary);
}

/* ==========================================================================
   DROPPING POINTS ON A PLANE.

   Making a point used to be: press the button, get one at the origin, find the
   two fields, type two numbers, press the button again. Five steps to put a
   mark where you are already looking, repeated for every point.

   So the button starts a MODE instead. A plane is chosen - whatever was
   selected, or the one the new point was wired to - the pointer casts a ray
   onto it, a ghost follows the place it lands, and a click drops a point
   there. It stays in the mode, because points come in groups: a setting-out
   is nine of them and a profile's control points are six. Esc, Enter or Done
   leaves.

   The ray meets the plane as a PLANE, not as the square it is drawn as, so a
   point can be dropped past the edge of the datum - which is the common case
   the moment a model is bigger than 200 mm.
   ========================================================================== */

const placing = { on: false, id: null, frame: null, ghost: null, made: 0 };

const placingOn = () => placing.on;

//! The plane to drop on: what is selected if that is a plane, else whatever
//! the point that was just made is wired to.
function planeFrameFor(entry) {
  const mount = entry && entry.refs && entry.refs.plane ? feature(entry.refs.plane) : null;
  const chosen = state.selected ? feature(state.selected) : null;
  const from = (chosen && chosen.produces === "plane" && chosen.frame) ? chosen
             : (mount && mount.frame) ? mount : null;
  return from ? { id: from.id, frame: from.frame } : null;
}

function beginPlacing(entry) {
  const found = planeFrameFor(entry);
  if (!found) return false;
  placing.on = true;
  placing.id = found.id;
  placing.frame = found.frame;
  placing.made = 0;
  document.body.classList.add("placing");
  const bar = document.getElementById("place-bar");
  if (bar) {
    bar.hidden = false;
    document.getElementById("place-who").textContent =
      (feature(placing.id) || {}).name || "Plane";
  }
  layout();
  //! A ghost of the mark that is about to be dropped, in the hover colour, so
  //! the thing you are aiming is the thing you will get.
  const dot = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position",
      new THREE.Float32BufferAttribute([0, 0, 0], 3)),
    markMaterial(entry, "hover"));
  dot.visible = false;
  placing.ghost = dot;
  world.add(dot);
  say("dropping points on " + ((feature(placing.id) || {}).name || "the plane")
      + " \u00b7 click to place \u00b7 Esc or Enter when done");
  return true;
}

function endPlacing() {
  if (!placing.on) return;
  placing.on = false;
  document.body.classList.remove("placing");
  const bar = document.getElementById("place-bar");
  if (bar) bar.hidden = true;
  layout();
  if (placing.ghost) {
    world.remove(placing.ghost);
    placing.ghost.geometry.dispose();
    placing.ghost.material.dispose();
    placing.ghost = null;
  }
  if (placing.made) say(placing.made + (placing.made === 1 ? " point" : " points") + " placed");
  draw();
}

//! WHERE THE POINTER MEETS THE PLANE, in the plane's own two numbers - which
//! is what a point on a plane is stored as, so nothing is converted twice.
function onPlaneAt(event) {
  const frame = placing.frame;
  if (!frame) return null;
  const ray = rayFrom(event).ray;
  const n = new THREE.Vector3(...frame.normal);
  const at = new THREE.Vector3(...frame.origin);
  const facing = ray.direction.dot(n);
  if (Math.abs(facing) < 1e-6) return null;          // looking along the plane
  const how = at.clone().sub(ray.origin).dot(n) / facing;
  if (how < 0) return null;                          // the plane is behind us
  const hit = ray.origin.clone().addScaledVector(ray.direction, how);
  const from = hit.clone().sub(at);
  return { at: hit,
           h: from.dot(new THREE.Vector3(...frame.x)),
           v: from.dot(new THREE.Vector3(...frame.y)) };
}

function hoverPlacing(event) {
  const found = onPlaneAt(event);
  if (!placing.ghost) return;
  placing.ghost.visible = !!found;
  if (found) placing.ghost.position.copy(found.at);
  draw();
}

async function dropPoint(event) {
  const found = onPlaneAt(event);
  if (!found) return;
  const round = v => Math.round(v * 1000) / 1000;
  const born = await mdl.run({ op: "add", type: "Point", refs: { plane: placing.id } })
    .catch(error => { showError(error.message); return null; });
  if (!born) return;
  await mdl.runAll([
    { op: "set", id: born.id, key: "kind", value: 6 },
    { op: "set", id: born.id, key: "h", value: round(found.h) },
    { op: "set", id: born.id, key: "v", value: round(found.v) },
  ]).catch(error => showError(error.message));
  placing.made++;
}

/* ==========================================================================
   HOW A POINT IS DRAWN.

   A point has no triangles and no edges. Everything else in this viewport
   shows what it is by its surface or its outline; a point has to be given a
   MARK, and which mark is a choice in the same way a line weight is - a
   construction point wants a small cross that stays out of the way, a point
   you are about to grab wants a filled dot, a fixing wants a ring you can see
   the model through.

   Drawn into a canvas and used as the sprite on a PointsMaterial, which is
   what lets one draw call put two hundred identical marks on screen - a
   DivideCurve sends two hundred and they must not cost two hundred objects.

   THE SELECTED MARK IS THE MARK WITH A RING AROUND IT. Not a different shape:
   you have to be able to see that this is the same point you were looking at,
   and swapping a cross for a disc when it is chosen loses that. A ring around
   whatever was there says "this one" without saying anything else.
   ========================================================================== */

const MARK_TEXTURES = new Map();

function markTexture(kind, pen, ringed) {
  const key = kind + ":" + pen + ":" + (ringed ? "r" : "");
  if (MARK_TEXTURES.has(key)) return MARK_TEXTURES.get(key);
  const S = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ink = canvas.getContext("2d");
  ink.strokeStyle = "#ffffff";
  ink.fillStyle = "#ffffff";
  ink.lineCap = "round";
  //! The pen is in canvas pixels, scaled from the weight so "heavy" is heavy
  //! at every marker size rather than only at the big ones.
  ink.lineWidth = pen * 3.2;
  //! The ring lives in the outer quarter, so the mark inside keeps its own
  //! size and the selection reads as something ADDED rather than as the mark
  //! having grown.
  const r = ringed ? S * 0.28 : S * 0.40;
  const mid = S / 2;
  if (kind === "square") ink.fillRect(mid - r, mid - r, r * 2, r * 2);
  else if (kind === "cross") {
    ink.beginPath();
    ink.moveTo(mid - r, mid - r); ink.lineTo(mid + r, mid + r);
    ink.moveTo(mid + r, mid - r); ink.lineTo(mid - r, mid + r);
    ink.stroke();
  } else if (kind === "plus") {
    ink.beginPath();
    ink.moveTo(mid - r, mid); ink.lineTo(mid + r, mid);
    ink.moveTo(mid, mid - r); ink.lineTo(mid, mid + r);
    ink.stroke();
  } else if (kind === "ring") {
    ink.beginPath(); ink.arc(mid, mid, r - ink.lineWidth / 2, 0, Math.PI * 2); ink.stroke();
  } else {
    ink.beginPath(); ink.arc(mid, mid, r, 0, Math.PI * 2); ink.fill();
  }
  if (ringed) {
    ink.lineWidth = Math.max(1.6, pen * 2.2);
    ink.beginPath();
    ink.arc(mid, mid, S * 0.44 - ink.lineWidth, 0, Math.PI * 2);
    ink.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  MARK_TEXTURES.set(key, texture);
  return texture;
}

//! What a feature says its points should look like, with the defaults filled
//! in. Stored on the appearance, beside the finish and the colour, because it
//! is the same kind of fact - how the thing is drawn, not what it is.
function markOf(entry) {
  const said = (entry && entry.appearance) || {};
  return { mark: findMark(said.mark), weight: findWeight(said.markWeight) };
}

//! \p as is "plain", "hover" or "chosen". Size and colour come from the state;
//! the shape and the weight come from the feature.
function markMaterial(entry, as) {
  const { mark, weight } = markOf(entry);
  const grow = as === "hover" ? 1.7 : as === "chosen" ? 1.45 : 1;
  const colour = as === "hover" ? THEME.hover : as === "chosen" ? THEME.accent
               : wornColour(entry) || THEME.datum;
  return new THREE.PointsMaterial({
    color: colour.clone(),
    //! The ring is added at 1.45 of the base size, so the mark inside it stays
    //! the size it was and the ring is genuinely around it.
    size: weight.size * grow * (as === "chosen" ? 1.55 : 1),
    map: markTexture(mark.key, weight.pen, as === "chosen"),
    sizeAttenuation: false, transparent: true, alphaTest: 0.35,
    depthWrite: false, opacity: as === "plain" ? 0.92 : 1,
  });
}

function groupFromStream(mesh, entry) {
  const group = new THREE.Group();
  const datum = drawsFaint(entry);
  const style = findStyle(state.style);
  group.userData.solid = !datum;
  group.userData.curve = !!entry && entry.produces === "curve";
  group.userData.datum = datum;

  if (mesh.positions && mesh.index) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    if (mesh.normals)
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
    geometry.setIndex(mesh.index);
    // Arctic reads its creases off the normals, so a stream that arrived
    // without any gets them worked out rather than drawn with none.
    if (!mesh.normals) geometry.computeVertexNormals();

    const material = datum
      ? new THREE.MeshBasicMaterial({ color: wornColour(entry) || THEME.datum,
                                      transparent: true, opacity: 0.05,
                                      side: THREE.DoubleSide, depthWrite: false,
                                      visible: style.datums })
      : surfaceMaterial(entry, style);
    //! WHAT TO GO BACK TO when a tint comes off. Every other material here
    //! records it; a datum's did not, so the repaint that runs on every hover
    //! put the theme's amber back over a colour somebody had chosen, and an
    //! imported building's setting-out went from blue to amber the first time
    //! the pointer crossed the viewport.
    if (datum) material.userData.base = material.color.clone();

    const solid = new THREE.Mesh(geometry, material);
    solid.userData.id = mesh.id;
    solid.userData.datum = datum;
    group.add(solid);
    //! A PLANE IS A THING YOU CLICK ON. It was left out of the pick list on
    //! the grounds that a datum is scenery - and it is not: a plane is the
    //! commonest input in the whole program, it is drawn where you can see it,
    //! and every other way of choosing one asks you to recognise it by name in
    //! a list of nine. The one real objection is that a plane is big and gets
    //! in front of things, and that is answered where the pick is resolved
    //! rather than by refusing to offer it at all - see `pick`.
    pickable.push(solid);
  }

  if (mesh.edges && mesh.edges.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.edges, 3));
    // A curve is the feature, not the outline of one, so it is drawn in its own
    // colour at full strength rather than as a solid's tangent edge.
    const lines = new THREE.LineSegments(geometry, edgeMaterial(entry, style));
    //! AND WHETHER THESE ARE A SOLID'S EDGES, said here where it is known
    //! rather than worked out again later. A curve feature IS its lines and a
    //! datum's are scaffolding; only a body's are the edges an arctic overlay
    //! is about, and asking the feature again from the other side of the
    //! program would be the same question answered twice.
    lines.userData.brepEdges = !drawsFaint(entry)
      && !(entry && entry.produces === "curve");
    group.add(lines);
  }

  // A vertex carries no triangles, so every one is drawn as a marker. A
  // DivideCurve can send two hundred, so they share one geometry between them.
  const marks = mesh.points && mesh.points.length ? mesh.points
              : mesh.point ? mesh.point : null;
  if (marks) {
    const dots = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position",
        new THREE.Float32BufferAttribute(marks, 3)),
      markMaterial(entry, "plain"));
    dots.userData.id = mesh.id;
    dots.userData.mark = true;
    group.add(dots);
    //! A POINT IS SOMETHING YOU CLICK ON, and it was not: the pick list took
    //! meshes only, so the one kind of feature with no surface at all was the
    //! one kind you could not point at. THREE.Points raycasts against a
    //! threshold rather than against geometry - see rayFrom, where the
    //! threshold is set from the view so a point is as easy to hit far away as
    //! up close.
    pickable.push(dots);
  }
  return group;
}

const streams = new Map();   // feature id -> the triangles the kernel last sent

function setShape(mesh) {
  streams.set(mesh.id, mesh);
  unmeshed.delete(mesh.id);
  const existing = shapes.get(mesh.id);
  if (existing) disposeGroup(existing.group);
  const group = groupFromStream(mesh, feature(mesh.id));
  world.add(group);
  //! HOW BIG IT IS AND WHERE, worked out once when it lands. Every frame asks
  //! whether this is on screen and whether it is worth drawing, and neither
  //! question can be asked a thousand times a frame if answering it means
  //! walking the triangles. See lookAtDetail.
  group.userData.ball = ballOf(group);
  group.userData.triangles = mesh.triangles || 0;
  const held = { revision: mesh.revision, group };
  shapes.set(mesh.id, held);
  //! AND ITS EDGES, IF THE OVERLAY IS ON. A shape that lands after the tick
  //! was set has to be given one too - a model meshes for several seconds, and
  //! an overlay built once when the switch was thrown would cover whatever had
  //! arrived by then and nothing after it.
  if (arcticLook.edges && state.style === "arctic") hardEdgesFor(mesh.id, held);
  //! AND THE TICK ITSELF COMES BACK TO LIFE when the first solid lands. It is
  //! offered only when there is something with edges on screen, and on a model
  //! that is still meshing that is false for the first second - so a tick
  //! switched off at open would stay switched off with a building in front of
  //! it. Asked of THIS shape rather than of all of them, because this runs
  //! once per shape and walking the scene each time is the same quadratic that
  //! cost a third of a second a frame elsewhere.
  if (state.style === "arctic" && group.children.some(one =>
        one.isLineSegments && one.userData.brepEdges)) {
    const tick = document.getElementById("look-edges");
    if (tick && tick.disabled) {
      tick.disabled = false;
      const note = document.getElementById("look-edges-note");
      if (note && !hardEdgeTally.left) { note.textContent = ""; note.hidden = true; }
    }
  }
  // A shape that has just arrived has to be cut with everything else, and the
  // planes' travel re-measured against a model that may have grown.
  if (cutter.on) {
    if (cutter.live.length) clipGroup(group, cutter.live);
    sectionStale = true;
  }
}

//! Rebuilding the caps walks every triangle, so it is done once after a batch
//! of shapes has landed rather than once per shape.
let sectionStale = false;
function settleSection() {
  if (!sectionStale) return;
  sectionStale = false;
  refreshSection();
}

//! AND WHENEVER ANYTHING ABOUT THE DOCUMENT CHANGED. A cut style is a property
//! of an object, so an object that has just been given one has to be re-cut -
//! and nothing re-meshes when only the appearance changed, so the meshing path
//! never hears about it. Every tree that lands marks the section stale; a
//! refresh is a few small meshes and it only happens while a section is open.
function touchSection() { if (cutter.on) sectionStale = true; }

//! IS THIS A PART OR A BUILDING? Asked of the model rather than of the person,
//! because nobody wants a preference for this and the answer is not a
//! judgement: below a few hundred shapes there is nothing to gain and a box
//! where a fillet was is a lie, above it the frame rate is the only thing
//! anybody is thinking about.
function weighModel() {
  let held = 0, drawn = 0;
  for (const [, { group }] of shapes) { held += group.userData.triangles || 0; drawn++; }
  detail.held = held;
  const wants = drawn >= detail.from || held > detail.frame * 2;
  if (wants === detail.on) return;
  detail.on = wants;
  if (!wants) {
    for (const [, { group }] of shapes) group.userData.boxed = false;
    rebuildBoxes();
    for (const [id, { group }] of shapes) {
      const entry = feature(id);
      group.visible = !!entry && entry.visible && !state.hidden.has(id);
    }
  }
  say(wants
    ? drawn.toLocaleString() + " shapes · drawing what is on screen, and the smallest of it "
      + "as boxes when a frame goes over " + (detail.frame / 1000) + "k triangles"
    : "small enough to draw whole");
  draw();
}

//! WHAT CAN BE POINTED AT. Rebuilt whenever the scene is, and it has to agree
//! with what groupFromStream put in the list the first time round - it did
//! not, and the disagreement was invisible: a point was pickable when it was
//! first drawn and stopped being so the moment anything else in the document
//! changed and the list was rebuilt without it. The test for it was
//! `isMesh`, which a mark is not.
function rebuildPickList() {
  pickable.length = 0;
  for (const { group } of shapes.values())
    group.traverse(object => {
      if (object.userData.hardEdge) return;
      if ((object.isMesh || object.isPoints) && object.userData.id) pickable.push(object);
    });
}

//! A true macrotask, with no clamping - the same one the kernel uses between
//! slices, and for the same reason. setTimeout(0) is held to four
//! milliseconds after a few nested calls.
const breathe = () => new Promise(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
  channel.port2.postMessage(0);
});

/* ------------------------------------------------ triangles, a batch at a time

   MESHING SIX THOUSAND SHAPES IS FOUR SECONDS AND SIXTEEN MEGABYTES, asked
   for in one call and handed back in one answer - four seconds in which
   nothing is drawn and nothing moves, and then a building appears all at
   once.

   Asked for in batches instead, the same four seconds are spent with the
   model appearing as it goes: the first bodies are on screen in a fraction of
   a second, the page repaints between batches, and the count says how far
   along it is. Not one microsecond faster. Completely different to wait for.

   WHAT IS ALREADY ON SCREEN GOES FIRST. On an edit that is the critical path
   by definition: those are the shapes somebody is looking at, and the ones
   that are not can arrive a heartbeat later without anybody minding.       */

const MESH_BATCH = 400;
//! How often the half-built model is put on screen while it arrives. Four
//! times a second reads as "it is filling in"; every batch reads as a page
//! that has stopped, because the render costs more than the meshing did.
const SHOW_EVERY_MS = 250;

/* ------------------------------------------- what one frame actually costs

   WHAT IT COSTS TO PUT THE HALF-BUILT MODEL ON SCREEN, in milliseconds, and
   the only reason a building opens in twenty seconds rather than thirty.

   Timing the render from inside the animation frame says half a millisecond,
   and that is true and useless: three.js walks the scene, hands the card a
   pile of draw calls and returns. The card has not drawn anything yet. The
   bill arrives at the next yield, where the browser will not run another task
   until it has rasterised the frame - and on the machine this was measured
   on, with five thousand objects arriving, that was 1,085 ms a frame against
   39 ms for a yield with no frame behind it.

   So it is measured where it is paid, and it is measured rather than guessed
   because the same loop runs on a laptop with a real card, where a frame is
   eight milliseconds and showing every batch is free. Six frames' worth of
   meshing between frames: the model still visibly fills in, and the machine
   decides how often rather than a constant written here.                   */

let paintCost = 16;

//! The only reason the revision counter exists: ask for the shapes whose
//! parameters actually moved, and nothing else.
async function syncShapes() {
  const stale = [];
  for (const entry of state.tree.features) {
    const have = shapes.get(entry.id);
    if (entry.built && (!have || have.revision !== entry.revision)) stale.push(entry.id);
  }
  for (const id of [...shapes.keys()]) {
    if (!feature(id)) {
      disposeGroup(shapes.get(id).group);
      shapes.delete(id); streams.delete(id); unmeshed.delete(id);
    }
  }
  //! Whatever is already drawn is redrawn first.
  stale.sort((a, b) => (shapes.has(b) ? 1 : 0) - (shapes.has(a) ? 1 : 0));

  if (stale.length && kernel) {
    const started = performance.now();
    let triangles = 0;

    //! THE CHEAP PASS FIRST, on anything big enough to be worth it. Whatever
    //! is already drawn is meshed outright - it is on screen now and blanking
    //! it to a box for one frame would be a flicker nobody asked for - and
    //! everything else goes in as its extents, to be fetched by the camera.
    const lazy = stale.length >= LAZY_FROM && "boxes" in kernel;
    const resident = lazy ? stale.filter(id => shapes.has(id) && !shapes.get(id).waiting)
                          : stale;
    const later = lazy ? stale.filter(id => !shapes.has(id) || shapes.get(id).waiting) : [];

    if (later.length) {
      showWorking("Placing\u2026", later.length.toLocaleString() + " shapes", 0);
      const payload = await kernel.boxes(later);
      for (const box of payload.features) standIn(box);
      //! BEFORE THE FIRST FRAME, because a stand-in is only drawn by the part
      //! of the viewport that the budget switches on: asked with it off, the
      //! building would be five thousand empty groups and a blank screen.
      weighModel();
      await breathe();
    }

    let done = 0, painted = 0;
    for (let at = 0; at < resident.length; at += MESH_BATCH) {
      const batch = resident.slice(at, at + MESH_BATCH);
      triangles += await fetchShapes(batch);
      done += batch.length;
      //! SHOWN AS IT ARRIVES, BUT NOT REDRAWN PER BATCH, and the pick list and
      //! the triangle budget asked once at the end rather than thirteen times
      //! on the way. Rebuilding them per batch turned four seconds of meshing
      //! into forty-four.
      if (resident.length > MESH_BATCH) {
        showWorking("Drawing\u2026",
                    done.toLocaleString() + " of " + resident.length.toLocaleString()
                    + " shapes \u00b7 " + triangles.toLocaleString() + " triangles",
                    done / resident.length);
        const now = performance.now();
        const drew = now - painted > Math.max(SHOW_EVERY_MS, paintCost * 6);
        if (drew) { painted = now; draw(); }
        //! AND HERE IS WHERE THE FRAME IS PAID FOR. Not in the rAF callback -
        //! that returns in half a millisecond, having only handed the card a
        //! list - but in the next yield, where the browser stops to rasterise
        //! it before it will run anything else. Measured rather than assumed,
        //! because it is the one number that separates a machine that can
        //! afford to show every batch from one that cannot.
        await breathe();
        if (drew) paintCost = paintCost / 2 + (performance.now() - now) / 2;
      }
    }
    rebuildPickList();
    weighModel();
    //! WHAT IS HELD, not what this pass happened to fetch: with the stand-ins
    //! in, a pass can land no triangles at all and the model still has the
    //! ones it had, plus five thousand boxes waiting to become more.
    state.stream = { shapes: stale.length, triangles: lazy ? detail.held : triangles,
                     ms: Math.round(performance.now() - started) };
  }

  touchSection();
  settleSection();
  // A camera that has been retyped, or whose points have moved, moves the
  // view with it - otherwise you are looking through a camera that is
  // somewhere else.
  if (lookingThrough()) {
    if (!through.dirty) {
      const now = cameraNumbers(lookingThrough());
      through.eye = now.eye.slice();
      through.target = now.target.slice();
    }
    followCamera();
    refreshLens();
  }
  // NOW the modes can be told, with the new triangles in hand. Every mode, not
  // just the open one: a mode left holding a measurement of a shape that has
  // since changed must not show it again when it is reopened.
  for (const mode of modes) if (mode.view.invalidate) mode.view.invalidate();

  applyVisibility();
  paintSelection();
  refreshMeshEdit();
  refreshSketch();
  // The wheel's reach and the clipping planes are both multiples of how big the
  // scene is, so it has to be re-measured whenever the scene changes.
  measureScene();
  // While Claude is building, the view follows what it builds: the point of
  // watching is seeing it, and the first thing it adds is usually nowhere near
  // where the camera happens to be pointing.
  if (following) fitView();
  draw();
  if (staging && showroom.ready) showroom.setScene(state.tree.features, streams);
}

//! Show or hide a feature in the 3D view - one function, because there are
//! four ways to ask for it (the tree's eye, the ring, the tree's menu, a
//! script) and four copies of "add to a Set and redraw" is four places for the
//! file to stop being told.
//!
//! WHAT IS HIDDEN IS PART OF THE DOCUMENT. It is not a property of the
//! geometry - `visible` on a feature already means "not consumed by an
//! operation", and is recomputed on every rebuild - so it rides in the file
//! beside the graph's layout, under its own key. The alternative is a hide
//! that a reload forgets, which is a tree saying one thing and a viewport
//! saying another.
//! EVERYTHING A SET HOLDS, however deep. A set is a folder, so hiding one is
//! hiding what is in it - a folder has no geometry of its own to hide, and an
//! eye on it that did nothing would be an eye that lies.
/* ------------------------------------------------ who is in which set

   ASKED ONCE PER DOCUMENT, NOT ONCE PER QUESTION.

   "What is in this set" was a filter over every feature in the document, and
   the tree asks it twice for every folder it draws, plus once more for the
   eye. On a part of forty features that is free. On a building imported from
   IFC - 7,548 features, 1,665 of them sets - it is a hundred million
   comparisons to draw one tree, and the tree is drawn again every time
   anything at all is selected. Measured: 3,754 ms to fold one branch, and the
   same 3,754 ms to click a column in the viewport.

   Keyed on the tree object itself, which is REPLACED on every edit rather
   than mutated - so the index cannot go stale, only be rebuilt.             */

let kidIndex = new Map(), kidIndexOf = null;
function kidsOf(id) {
  if (kidIndexOf !== state.tree) {
    kidIndex = new Map();
    for (const f of (state.tree ? state.tree.features : [])) {
      const at = f.parent || null;
      const list = kidIndex.get(at);
      if (list) list.push(f); else kidIndex.set(at, [f]);
    }
    kidIndexOf = state.tree;
  }
  return kidIndex.get(id) || [];
}
//! How many, without building the list - which is all the tree row wants.
const kidCount = id => kidsOf(id).length;

function withContents(ids) {
  const out = new Set();
  const take = id => {
    if (out.has(id)) return;
    out.add(id);
    for (const child of kidsOf(id)) take(child.id);
  };
  for (const id of ids) take(id);
  return [...out];
}

function showFeature(id, on) {
  //! WHAT WAS NAMED, kept apart from what it contains. The hidden list applies
  //! to the whole subtree - hiding a storey hides what is in it - but the
  //! document edit below must NOT, and conflating the two quietly rewrote the
  //! model every time somebody clicked the eye on a set.
  const named = Array.isArray(id) ? id : [id];
  const ids = withContents(named);
  for (const one of ids) { if (on) state.hidden.delete(one); else state.hidden.add(one); }
  //! TWO REASONS A THING IS NOT DRAWN, and one switch over both.
  //!
  //! `state.hidden` is this view's own list and is all most rows ever need. A
  //! body an operation SWALLOWED is not on it - the document itself says the
  //! body is not drawn, because a fillet is the cube now - so taking it off
  //! the hidden list does nothing and the eye reads as broken. Overruling that
  //! is an edit to the document, which is a different call.
  //!
  //! Sent only for the features it applies to, and only when showing: hiding
  //! is what the hidden list is for, and a swallowed body that is hidden is
  //! hidden for the ordinary reason like anything else.
  //!
  //! AND ONLY FOR THE ROWS SOMEBODY ACTUALLY CLICKED, never for the contents
  //! this pulled in. Over `ids` it meant that showing a storey un-consumed
  //! every intermediate inside it: on a building imported from IFC, one click
  //! on one set wrote `shownAnyway` onto 715 features - every profile, every
  //! extrusion, every boolean that another feature was built from - and all of
  //! it saved into the file.
  //!
  //! What that LOOKS like is not a visibility bug, which is why it was
  //! reported as geometry changing. A wall is an Extrude with its openings cut
  //! out of it by a Boolean; force-showing the Extrude draws the wall as it
  //! was BEFORE the openings, on top of the one with them. The wall overshoots
  //! its own reveals and the model appears to have been edited. Nothing had
  //! been: the arguments were untouched, the same shapes were built, and one
  //! of them was being drawn that should not have been.
  //!
  //! It is also why the tree flickered. 715 document edits mean 715 trips
  //! through applyState, each one rebuilding the tree - and 715 entries on the
  //! undo stack for a click that was meant to change nothing.
  const swallowed = on ? named.filter(one => {
    const entry = feature(one);
    return entry && entry.visible === false;
  }) : [];
  if (swallowed.length)
    mdl.runAll(swallowed.map(one => ({ op: "shown", id: one, on: true })))
       .catch(error => showError(error.message));
  buildTree(); applyVisibility(); draw();
  // The panel says whether the thing it is showing is showing, so it has to
  // hear about this too - the eye is in two places and they must agree.
  if (ids.includes(state.edited)) buildPanel();
  keepModel();
}

function applyVisibility() {
  for (const [id, { group }] of shapes) {
    const entry = feature(id);
    const shown = !!entry && entry.visible && !state.hidden.has(id);
    //! WHAT THE DOCUMENT SAYS, kept apart from what the CAMERA says. The two
    //! both end up at group.visible and they are different facts: one is "you
    //! put this away", the other is "it is a pixel wide from here". Written
    //! down so the frame's own culling cannot quietly bring back something
    //! that was hidden on purpose - see lookAtDetail.
    group.userData.hiddenByDoc = !shown;
    group.visible = shown;
    if (!shown && group.userData.boxed) group.userData.boxed = false;
  }
  if (detail.on) { rebuildBoxes(); lookAtDetail(); }
}

//! How far a selected body is pulled towards the accent colour. Gentler in the
//! styles that are pictures: forty per cent of blue over a white clay model is
//! a blue model, and arctic's whole claim is that everything is the same clay.
const SELECTED_TINT = 0.42;
const tintFor = style => (style.clay ? 0.14 : style.materials ? 0.22 : SELECTED_TINT);
//! TWO STATES, TWO COLOURS, AND NEITHER OF THEM TIMID.
//!
//! Orange is what the pointer is over; blue is what is chosen. They answer
//! different questions - "this one?" and "this one." - and reading one as the
//! other is how you delete the wrong thing, so they are not two shades of the
//! same idea.
//!
//! The strength was the other half of the complaint. A selected body was
//! tinted towards the accent and given an emissive of 0.06, which on a mid
//! grey in a lit scene is a body that looks very slightly bluer than it did -
//! findable if you already know which one it is, which is not what a highlight
//! is for. Both states now light as well as tint, and the edges take the
//! colour at full strength, which is what actually reads at a distance.
const HOVER_TINT = 0.5;
const GLOW = { hover: 0.4, selected: 0.3 };

function paintSelection() {
  const style = findStyle(state.style);
  for (const [id, { group }] of shapes) {
    const selected = id === state.selected || state.picked.includes(id);
    //! Hover is not shown on something already chosen. It would be saying
    //! "this one?" about the thing it is already saying "this one." about,
    //! and the flicker as the pointer crosses a selected body reads as a bug.
    const lit = !selected && id === state.hover;
    const mark = selected ? THEME.accent : THEME.hover;
    group.traverse(object => {
      if (object.isMesh && object.material.isMeshStandardMaterial) {
        // Back to whatever the style painted it, THEN the tint. Reading the
        // base off the material rather than off the theme is what lets a brass
        // body stay brass when something else is picked.
        const base = object.material.userData.base || THEME.shape;
        object.material.color.copy(base);
        if (selected) object.material.color.lerp(THEME.accent, tintFor(style));
        else if (lit) object.material.color.lerp(THEME.hover, HOVER_TINT * (style.clay ? 0.45 : 1));
        object.material.emissive.copy(mark);
        object.material.emissiveIntensity = selected ? GLOW.selected : lit ? GLOW.hover : 0;
      }
      //! A DATUM LIGHTS UP TOO, and it is the one that needed it most: a plane
      //! is five per cent opaque, so a tint of it is nothing. It goes opaque
      //! enough to see instead.
      if (object.isMesh && object.material.isMeshBasicMaterial && object.userData.datum) {
        //! ASKED OF THE DOCUMENT, not of what the material was made with. A
        //! shape can land before the tree carrying its colour does - the
        //! triangles and the tree arrive on different errands - and a datum's
        //! material is the one thing a style change does not rebuild, so a
        //! plane made in that window kept the theme's amber for good.
        const base = wornColour(feature(object.userData.id))
                  || object.material.userData.base || THEME.datum;
        object.material.color.copy(selected || lit ? mark : base);
        object.material.opacity = selected ? 0.3 : lit ? 0.22 : 0.05;
      }
      if (object.isLineSegments && object.material.isLineBasicMaterial &&
          object.parent && object.parent.userData.solid) {
        // A curve keeps its own colour: the line is the feature, not the
        // silhouette of one, and dimming it to a tangent edge loses it.
        const own = object.material.userData.base
                 || (object.parent.userData.curve ? THEME.curve : THEME["brep-edge"]);
        object.material.color.copy(selected || lit ? mark : own);
        //! Opaque either way now. It used to drop back to four-tenths for a
        //! solid, which put the body's colour back through the line the moment
        //! the pointer left it - so an edge was black while you hovered it and
        //! orange again a frame later.
        object.material.opacity = 1;
      }
      //! AND THE MARKERS. A point cannot be tinted or outlined - it has no
      //! surface and no edges - so the whole mark is replaced: bigger and
      //! orange under the pointer, ringed and blue when it is chosen. See
      //! markMaterial.
      if (object.isPoints && object.userData.mark) {
        const want = selected ? "chosen" : lit ? "hover" : "plain";
        if (object.userData.as !== want) {
          object.userData.as = want;
          object.material.dispose();
          object.material = markMaterial(feature(id), want);
        }
      }
    });
  }
  draw();
}

/* ==========================================================================
   Editing a mesh by hand.

   A feature that holds hand edits - EditMesh - shows its cage vertices as
   handles. Click one, drag an axis, and the move is written into the model
   file as {"12": [4, 0, -2]}: an offset from wherever the mesh upstream put
   that vertex, not a position. So the edit survives a change upstream, reads
   as text, and can be typed instead of dragged.
   ========================================================================== */

const meshEdit = {
  id: null,        // the feature holding the edits
  vertex: -1,      // the vertex the handle is on - the last one picked
  chosen: [],      // every vertex picked, which the handle moves together
  dots: null,      // the handles
  gizmo: null,     // the three axes on the selected one
  axis: null,      // the one being dragged
  from: null,      // where the drag started, along that axis
  before: null,    // index -> the offset it had when the drag started
};

//! The feature being edited by hand, if the one on the panel holds hand edits.
//!
//! Not while EDIT MODE is open: that is the whole editor, with its own
//! handles, its own selection and its own idea of what a click means, and two
//! sets of vertex dots over one cage is two things to click by accident.
function handEditing() {
  if (meshEditor && meshEditor.on) return null;
  const entry = feature(state.edited);
  if (!entry) return null;
  const spec = schemaType(entry.type);
  return spec && spec.args.some(a => a.kind === "edits") ? entry : null;
}

/* ==========================================================================
   EDIT MODE - the mesh editor.

   Double-click a mesh and the viewport becomes its cage. Everything about how
   that works is in meshedit.js; what is here is the wiring: which feature is
   being edited, what the pointer and the keys mean while it is open, and the
   bar along the bottom.

   THE ONE DECISION WORTH WRITING DOWN is what you get when you double-click
   something that is NOT an Edit Mesh. You get an Edit Mesh, put after it,
   wired to it, and opened - because editing a cage that something else built
   is what a modeller does all day, and making people add the node by hand
   first is making them do the software's filing.
   ========================================================================== */

const meshEditor = makeMeshEditor({
  THREE, world, camera, canvas: renderer.domElement,
  mdl, kernel: { cage: id => kernel.cage(id) },
  draw: () => draw(),
  gizmoSpan: () => view.distance * 0.09,
  inputOf: id => {
    const entry = feature(id);
    const from = entry && entry.refs && entry.refs.mesh;
    return Array.isArray(from) ? from[0] : from || null;
  },
  onChange: () => { refreshMeshBar(); buildPanel(); },
});

//! The mesh a double-click should open. An Edit Mesh opens itself; anything
//! else that produces a mesh gets one put on top of it first.
async function enterMeshEdit(id) {
  const entry = feature(id);
  if (!entry) return false;
  let which = id;
  if (entry.type !== "EditMesh") {
    if (entry.produces !== "mesh") return false;
    // Already got one sitting on it? Then that is the one to open, rather than
    // stacking a second Edit Mesh on the first every time somebody
    // double-clicks.
    const already = ((state.tree && state.tree.features) || []).find(f =>
      f.type === "EditMesh" && f.refs && f.refs.mesh === id);
    if (already) which = already.id;
    else {
      const born = await mdl.run({ op: "add", type: "EditMesh",
                                   name: "Edit " + entry.name, refs: { mesh: id } });
      if (!born || !born.id) return false;
      which = born.id;
    }
  }
  if (sketching()) leaveSketch();
  const opened = await meshEditor.enter(which);
  if (!opened) return false;
  // The bar IS the panel while this is open, and the definition panel over on
  // the right is the same node said twice - in less room, and over the model.
  state.edited = null;
  select(which);
  buildPanel();
  document.body.classList.add("meshing");
  meshBar.hidden = false;
  refreshMeshBar();
  layout();
  draw();
  return true;
}

function leaveMeshEdit() {
  if (!meshEditor.on) return;
  meshEditor.leave();
  document.body.classList.remove("meshing");
  meshBar.hidden = true;
  layout();
  draw();
}

const meshing = () => meshEditor.on;

/* ==========================================================================
   PICKING AN EDGE, OR A FACE.

   "Fillet this body" is a blunt answer. What a person means is "round THESE
   four edges" - so the fillet's default is every edge, and beside it is a
   button that hands the viewport over: the body's edges light up one at a
   time as the pointer crosses them, a click takes one, a DOUBLE-CLICK takes
   the whole arris through it, and Done writes the list.

   What gets written is not a highlight. It is a line in the model file saying
   which feature the edge belongs to, which number it was, and where it was -
   see subshape.js - so the fillet still rounds the same four edges after the
   block underneath has been made twice as wide.
   ========================================================================== */

const picking = {
  on: false,
  id: null,            // the feature whose argument is being picked for
  key: null,           // which argument
  kind: "edge",
  of: null,            // the feature whose shape is being picked FROM
  items: [],           // what the kernel offered
  chosen: new Set(),   // indices
  hover: -1,
  group: null,
  busy: false,
  //! WHICH RULE THE PICKS WILL CARRY. A double-click used to walk the arris
  //! there and then and write down the edges it found, which stored the answer
  //! and threw away the question. Now it sets the rule and keeps the one edge
  //! that was clicked as its seed, so the arris is worked out again on every
  //! rebuild - see growPicks.
  mode: null,
};

const pickingOn = () => picking.on;

const PICK_COLOURS = { plain: 0x7d8d99, hover: 0x4aa8ea, chosen: 0x0a6cb0 };

function clearPicking() {
  if (picking.group) {
    world.remove(picking.group);
    disposeGroup(picking.group);
    picking.group = null;
  }
}

//! The body an operation's picks are about: whatever is wired into the
//! argument the operation reads its shape from. A fillet picks off its body; a
//! draft off the same. Nothing here guesses - it is the first reference the
//! feature has that produced a solid.
//! WHAT THE PICKS ARE TAKEN FROM: the first thing wired in that has geometry
//! to pick. Solids first, because on a fillet or a draft that is what is meant
//! and a body can be wired in beside a plane; then anything else built, because
//! a face of a surface or an edge of a curve is just as pickable and refusing
//! it would mean the Face node's own button is dead on a skin.
function pickFrom(entry) {
  const spec = schemaType(entry.type);
  if (!spec) return null;
  let second = null;
  for (const arg of spec.args) {
    if (arg.kind !== "ref") continue;
    const target = entry.refs && entry.refs[arg.key];
    const which = Array.isArray(target) ? target[0] : target;
    const source = which && feature(which);
    if (!source) continue;
    if (source.produces === "solid") return source;
    if (!second && PICKABLE.has(source.produces)) second = source;
  }
  return second;
}
const PICKABLE = new Set(["solid", "plane", "curve"]);

async function enterPicking(entry, arg) {
  const source = pickFrom(entry);
  if (!source) { say("nothing is wired in to pick from"); return false; }
  if (!source.built) { say(source.name + " has not been built, so it has nothing to pick"); return false; }
  let got;
  try { got = await kernel.picks(source.id, arg.of); }
  catch (error) { say("could not read the " + arg.of + "s — " + error.message); return false; }
  if (!got || !got.items.length) { say(source.name + " has no " + arg.of + "s"); return false; }

  picking.on = true;
  picking.id = entry.id;
  picking.key = arg.key;
  picking.kind = arg.of;
  //! Whatever rule this argument already carries is what a re-pick keeps,
  //! unless a double-click asks for tangency again. Cleared here so a plain
  //! re-pick does not silently inherit the last session's double-click.
  picking.mode = null;
  picking.of = source.id;
  picking.items = got.items;
  picking.hover = -1;
  // Whatever is already picked, found again in today's list - so opening the
  // picker on a fillet that already has four edges shows those four lit.
  picking.chosen = new Set();
  const anchors = got.items.map(one => one.near);
  for (const pick of (entry.lists && entry.lists[arg.key]) || []) {
    const at = matchPick(anchors, pick, 0);
    if (at >= 0) picking.chosen.add(at);
  }
  document.body.classList.add("picking");
  pickBar.hidden = false;
  drawPicking();
  refreshPickBar();
  layout();
  return true;
}

async function leavePicking(save = true) {
  const entry = feature(picking.id);
  const key = picking.key, of = picking.of, kind = picking.kind;
  const chosen = [...picking.chosen].sort((a, b) => a - b);
  const items = picking.items;
  const mode = picking.mode;
  picking.on = false;
  picking.items = [];
  picking.mode = null;
  clearPicking();
  document.body.classList.remove("picking");
  pickBar.hidden = true;
  layout();
  draw();
  if (save && entry)
    await edit({ op: "pick", id: entry.id, key,
                 //! items.length is how many of that kind the body had when
                 //! these were picked, and it is the evidence that survives a
                 //! parametric change of any size - see matchPick.
                 picks: chosen.map(at => pickOf(of, kind, at, items[at].near, items.length)),
                 ...(mode ? { mode } : {}) });
  buildPanel();
}

//! Everything there is to pick, drawn: each edge as its own line and each face
//! as its own sheet, so a click can be tested against ONE of them rather than
//! against the whole body, and the one under the pointer can be lit up before
//! it is taken.
function drawPicking() {
  clearPicking();
  if (!picking.on) return;
  const group = new THREE.Group();
  group.renderOrder = 8;
  picking.items.forEach((item, at) => {
    const colour = picking.chosen.has(at) ? PICK_COLOURS.chosen
      : at === picking.hover ? PICK_COLOURS.hover : PICK_COLOURS.plain;
    let drawn;
    if (picking.kind === "face") {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position",
        new THREE.Float32BufferAttribute(Array.from(item.positions), 3));
      geometry.setIndex(Array.from(item.index));
      drawn = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: colour, transparent: true, side: THREE.DoubleSide, depthTest: true,
        opacity: picking.chosen.has(at) ? 0.55 : at === picking.hover ? 0.4 : 0.14 }));
    } else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position",
        new THREE.Float32BufferAttribute(Array.from(item.lines), 3));
      drawn = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: colour, depthTest: false,
        transparent: true, opacity: picking.chosen.has(at) ? 1 : 0.85 }));
    }
    drawn.userData.pickAt = at;
    drawn.renderOrder = picking.chosen.has(at) ? 10 : 9;
    drawn.frustumCulled = false;
    group.add(drawn);
  });
  world.add(group);
  picking.group = group;
  draw();
}

//! Which one is under the pointer. An edge is a line and a line is a hard
//! thing to hit, so the ray is given a threshold that is a share of how far
//! away the camera is - the same rule the vertex handles use, for the same
//! reason.
function pickUnder(event) {
  if (!picking.group) return -1;
  const cast = rayFrom(event);
  cast.params.Line = { threshold: view.distance * 0.012 };
  const hits = cast.intersectObjects(picking.group.children, false);
  const hit = hits.find(one => one.object.userData.pickAt !== undefined);
  return hit ? hit.object.userData.pickAt : -1;
}

function hoverPicking(event) {
  const at = pickUnder(event);
  if (at === picking.hover) return;
  picking.hover = at;
  drawPicking();
}

async function clickPicking(event, whole) {
  const at = pickUnder(event);
  if (at < 0) {
    if (!event.shiftKey) { picking.chosen.clear(); drawPicking(); refreshPickBar(); }
    return;
  }
  let take = [at];
  // A DOUBLE-CLICK TAKES THE ARRIS - and, since this became a rule rather than
  // a result, it says so instead of doing it. The chain is still walked, but
  // only to LIGHT UP what the rule will take: what gets written down is the one
  // edge clicked, plus "tangent", and the arris is worked out again every time
  // the model rebuilds. That is the difference between a fillet that survives
  // its cylinder being resized and one that quietly rounds the half it
  // remembers.
  if (whole && picking.kind !== "vertex" && !picking.busy) {
    picking.mode = "tangent";
    if (picking.kind === "edge") {
      picking.busy = true;
      try {
        const got = await kernel.tangentFrom(picking.of, at, 5);
        if (got && got.chain && got.chain.length) take = got.chain;
      } catch (error) { /* one edge is still a perfectly good answer */ }
      picking.busy = false;
    }
  }
  const had = take.every(one => picking.chosen.has(one));
  for (const one of take) {
    if (had) picking.chosen.delete(one);
    else picking.chosen.add(one);
  }
  drawPicking();
  refreshPickBar();
}

/* ==========================================================================
   WAITING FOR A WIRE.

   A dropdown asks you to recognise a point by its NAME, in a list of forty,
   when what you know about it is where it is. So an input that wants a point
   is a button: press it and the program waits, and the next thing you click -
   in the model or in the tree - is the answer. Nothing else changes; the
   viewport is still the viewport and the tree is still the tree, they are just
   both answering one question for a moment.

   What it will accept is what the argument accepts, and anything that does not
   is refused by name rather than ignored - a click that does nothing and says
   nothing is a click you make three more times.
   ========================================================================== */

const waiting = { on: false, id: null, key: null, accepts: [], many: false, label: "" };

function waitForPick(entry, arg) {
  waiting.on = true;
  waiting.id = entry.id;
  waiting.key = arg.key;
  waiting.accepts = arg.accepts.split(",");
  waiting.many = arg.kind === "refs";
  waiting.label = arg.label;
  document.body.classList.add("waiting");
  say("pick the " + waiting.accepts.join(" or ") + " for " + arg.label
      + " — in the model or in the tree");
  buildPanel();
}

function stopWaiting(quiet = false) {
  if (!waiting.on) return false;
  waiting.on = false;
  waiting.id = waiting.key = null;
  document.body.classList.remove("waiting");
  if (!quiet) say("");
  buildPanel();
  return true;
}

//! A feature offered as the answer. Comes from the viewport and from the tree,
//! which is the whole point: the two ways of finding a thing answer the same
//! question and neither is the proper one.
function offerWire(id) {
  if (!waiting.on) return false;
  const target = feature(id);
  const holder = feature(waiting.id);
  if (!target || !holder) { stopWaiting(); return false; }
  if (target.id === holder.id) { say("a feature cannot be wired to itself"); return true; }
  if (!acceptsFrom(waiting.accepts, target)) {
    say(target.name + " is a " + (target.produces || "feature") + "; "
        + waiting.label + " takes " + waiting.accepts.join(" or "));
    return true;
  }
  if (dependsOn(target.id, holder.id)) {
    say(target.name + " already reads from " + holder.name + ", so wiring it would be a loop");
    return true;
  }
  const key = waiting.key, into = waiting.id, again = waiting.many;
  if (!again) stopWaiting(true);
  // ONE INPUT, HOWEVER MANY READ IT. A set's panel lists an input once even
  // when three things inside it read the same thing, so setting it has to set
  // all three - otherwise the one you can see is repointed and the two you
  // cannot are quietly left where they were.
  const also = sharedWith(into, key);
  mdl.runAll(connectShared(into, key, target.id)).catch(error => showError(error.message));
  const named = (schemaType(holder.type).args.find(a => a.key === key) || {}).label;
  say(target.name + " → " + named
      + (also.length ? " · and the "
          + (also.length === 1 ? "other place that reads it"
                               : also.length + " other places that read it") : ""));
  return true;
}

/* ------------------------------------------------------------- the bar */

const pickBar = document.createElement("section");
pickBar.className = "float mx-bar pick-bar";
pickBar.id = "pick-bar";
pickBar.hidden = true;
document.body.appendChild(pickBar);

//! "vertexs" is not a word. One line rather than a table, because there are
//! three kinds of sub-shape and only one of them is irregular.
const plural = (word, many) => many === 1 ? word
  : word === "vertex" ? "vertices" : word + "s";

function refreshPickBar() {
  if (!picking.on) return;
  const entry = feature(picking.id);
  const source = feature(picking.of);
  const spec = entry && schemaType(entry.type);
  const arg = spec && spec.args.find(a => a.key === picking.key);
  pickBar.innerHTML = '<div class="mx-row">'
    + '<span class="mx-tag">' + safeText((arg && arg.label) || "Pick") + "</span>"
    + '<span class="mx-count">' + picking.chosen.size + " of " + picking.items.length
    + " " + safeText(plural(picking.kind, picking.items.length)) + "</span>"
    + '<span class="mx-hint">on ' + safeText(source ? source.name : "") + " · click to take one"
    + (picking.kind === "edge" ? ", double-click for the whole arris" : "")
    + ", shift-click to add</span>"
    + '<button class="mx-chip" data-pick-all="1">All</button>'
    + '<button class="mx-chip" data-pick-none="1">None</button>'
    + '<button class="btn primary" data-pick-done="1">Done</button>'
    + '<button class="btn" data-pick-drop="1">Cancel</button>'
    + "</div>";
}

pickBar.addEventListener("click", async event => {
  if (event.target.closest("[data-pick-all]")) {
    picking.items.forEach((one, at) => picking.chosen.add(at));
    drawPicking(); refreshPickBar(); return;
  }
  if (event.target.closest("[data-pick-none]")) {
    picking.chosen.clear();
    drawPicking(); refreshPickBar(); return;
  }
  if (event.target.closest("[data-pick-done]")) { await leavePicking(true); return; }
  if (event.target.closest("[data-pick-drop]")) await leavePicking(false);
});

/* ------------------------------------------------------------- the bar */

const meshBar = document.createElement("section");
meshBar.className = "float mx-bar";
meshBar.id = "mesh-bar";
meshBar.hidden = true;
document.body.appendChild(meshBar);

//! The letters, and they are the ones a modeller's left hand already knows.
//!
//! F IS NOT ONE OF THEM, although Blender fills with it. F fits the view, and
//! it does that everywhere else in this program - a mode where the commonest
//! key on the keyboard means something else is a mode people get lost in. Fill
//! is on the bar and in the ring, where it is not needed sixty times an hour.
const OP_KEYS = {
  e: "extrude", i: "inset", b: "bevel", p: "poke", m: "merge",
  x: "remove", s: "smooth", k: "bisect", j: "connect", c: "crease",
};

//! WHAT THE BAR SAYS, and it is deliberately almost nothing.
//!
//! The mode you are in, the menus, how much is picked, and the way out. That
//! is Blender's edit-mode header and it is right: a bar is for saying where
//! you are, not for listing everything the program can do. What you can do
//! lives in the menu for the kind of thing you do it to - and under the right
//! button, where your hand already is.
//!
//! The one thing that does get a row of its own is the number the last
//! operation was run with, because that is the thing you change six times in a
//! row and it is worth nothing behind a click.
function refreshMeshBar() {
  if (!meshEditor.on) return;
  const tally = meshEditor.tally();
  const level = meshEditor.level;
  const lead = meshEditor.lead();
  const entry = feature(meshEditor.id);
  meshBar.innerHTML = '<div class="mx-row">'
    + '<span class="mx-tag">' + safeText(entry ? entry.name : "Edit") + "</span>"
    + '<span class="seg" id="mx-level">'
    + LEVELS.map(one => '<button data-level="' + one.key + '" title="' + one.hint
        + " \u00b7 " + one.stroke + '" aria-pressed="' + (one.key === level ? "true" : "false")
        + '">' + one.label + "</button>").join("")
    + "</span>"
    + '<span class="mx-menus">'
    + '<button class="mx-menu" data-menu="select">Select</button>'
    + MESH_MENUS.map(menu => '<button class="mx-menu" data-menu="' + menu.key + '">'
        + menu.label + "</button>").join("")
    + "</span>"
    + '<span class="mx-count">' + tally.picked + " of " + tally.all + "</span>"
    + '<span class="mx-note">' + safeText(tally.says) + "</span>"
    + '<button class="btn" id="mx-done">Done</button></div>'
    + (meshEditor.ops.length ? '<div class="mx-row"><span class="mx-tag">'
        + safeText(lastStepName()) + "</span>"
        + (lead ? '<span class="mx-lead">' + safeText(lead.key) + "</span>"
            + '<input type="range" id="mx-lead" min="' + leadLow(lead) + '" max="'
            + leadHigh(lead) + '" step="' + leadStep(lead) + '" value="'
            + leadNow(lead) + '">'
            + '<input type="number" class="mx-read" id="mx-lead-read" value="'
            + leadNow(lead) + '" step="' + leadStep(lead) + '">'
          : '<span class="mx-hint">step ' + meshEditor.ops.length + " of "
            + meshEditor.ops.length + "</span>")
        + '<button class="mx-chip" id="mx-drop-step" title="take this step out">Undo step</button>'
        + '</div>' : "")
    + (meshEditor.note ? '<div class="mx-row"><span class="mx-warn">'
        + safeText(meshEditor.note) + "</span></div>" : "");
  layout();
}

const safeText = text => String(text == null ? "" : text)
  .replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

//! The range a lead argument gets. Measured off the model rather than guessed,
//! because 100 mm is the whole of a chair and nothing at all on a masterplan.
const leadSpan = () => {
  const tally = meshEditor.cage ? meshEditor.cage.points : [];
  let far = 1;
  for (const p of tally) far = Math.max(far, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  return far;
};
//! The name of the step the bar is showing, so "Undo step" says what it undoes.
const lastStepName = () => {
  const last = meshEditor.ops[meshEditor.ops.length - 1];
  return last ? ((MESH_OPS[last.op] || {}).label || last.op) : "";
};

//! Rounded to the step it moves in. A readout of 285.78392 is a readout nobody
//! asked for and cannot type back in.
const leadNow = lead => {
  const raw = Array.isArray(lead.value) ? lead.value[2] : Number(lead.value) || 0;
  const step = leadStep(lead);
  return Math.round(raw / step) * step;
};
const leadLow = lead => (lead.key === "amount" || lead.key === "factor" ? 0
  : lead.key === "cuts" || lead.key === "segments" ? 1
  : -Math.round(leadSpan() * 1.5));
const leadHigh = lead => (lead.key === "amount" || lead.key === "factor" ? 1
  : lead.key === "cuts" || lead.key === "segments" ? 12
  : Math.round(leadSpan() * 1.5));
const leadStep = lead => (lead.key === "amount" || lead.key === "factor" ? 0.01
  : lead.key === "cuts" || lead.key === "segments" ? 1
  : Math.max(0.1, Math.round(leadSpan() / 500)));

/* ---------------------------------------------------------- the menus

   One menu element, used four ways: the Select menu, the Vertex, Edge and Face
   menus, the Mesh menu, and the right-click menu in the viewport - which is
   whichever of them matches the level you are at, because that is what a
   context menu means.                                                       */

//! An operation as a line: what it is called, what it does, and whether there
//! is anything picked for it to do it to.
function meshOpItem(op) {
  const spec = MESH_OPS[op];
  if (!spec) return;
  const ready = meshEditor.tally().picked > 0
    || spec.levels.includes("element") || op === "recalc" || op === "merge";
  menuItem(spec.label, spec.note || "", ready ? () => meshEditor.begin(op) : null);
}

function meshMenuBody(which) {
  if (which === "select") {
    menuHead("Select");
    for (const pick of PICKS) {
      if (!pick.levels.includes(meshEditor.level)) continue;
      menuItem(pick.label, "", () => meshEditor.select(pick.key));
    }
    menuRule();
    menuHead("Level");
    for (const one of LEVELS)
      menuItem(one.label, one.hint + " \u00b7 " + one.stroke,
               () => meshEditor.setLevel(one.key));
    return;
  }
  const menu = MESH_MENUS.find(m => m.key === which);
  if (!menu) return;
  menuHead(menu.label);
  menu.groups.forEach((group, i) => {
    if (i) menuRule();
    for (const op of group) meshOpItem(op);
  });
  if (which === "mesh") {
    menuRule();
    menuHead("Move widget");
    for (const [key, label, note] of [["normal", "Normal", "square to what is picked"],
                                      ["global", "Global", "the world's own axes"]])
      menuItem(label, note, () => {
        meshEditor.orient = key;
        meshEditor.paint();
        refreshMeshBar();
      }).classList.toggle("on", meshEditor.orient === key);
    menuRule();
    menuHead("Steps");
    if (!meshEditor.ops.length) menuItem("Nothing yet", "", null);
    meshEditor.ops.forEach((op, i) => {
      menuItem((i + 1) + ". " + ((MESH_OPS[op.op] || {}).label || op.op),
               "take it out", () => meshEditor.dropStep(i));
    });
  }
}

function openMeshMenu(which, x, y, up = false) {
  const menu = document.getElementById("menu");
  menu.textContent = "";
  meshMenuBody(which);
  placeMenu(x, y, up);
}

//! Right-click in the viewport: the menu for the level you are at, where the
//! pointer is. No hunting for a header.
/* ------------------------------------------ the menu on the model itself

   WHAT YOU CAN SEE IS WHAT YOU CAN ASK ABOUT. A right-click on a body offers
   the things that are about THAT body and nowhere else to reach them from -
   above all, where it is in the tree.

   Going the other way has always worked: pick a row, press Centre on it. This
   is the way back, and on a model where the tree is seven thousand rows deep
   it is the only way there is.                                              */

function openViewportMenu(event) {
  const id = idUnder(rayFrom(event));
  const entry = feature(id);
  const menu = document.getElementById("menu");
  menu.textContent = "";
  if (!entry) {
    menuHead("Nothing under the pointer");
    menuItem("Fit the model", "everything, framed", () => fitView());
    menuItem("Fold the tree", "every set, shut", () => foldAll(true));
    placeMenu(event.clientX, event.clientY);
    return;
  }
  //! Clicking with the right button selects what it landed on, the way it
  //! does in the tree - a menu about something that is not marked is a menu
  //! about something you cannot see it is about.
  if (!state.picked.includes(entry.id)) select(entry.id, false);
  menuHead(entry.name);
  menuItem("Show in tree", "scroll to it, opening whatever is folded over it",
           () => { if (!revealInTree(entry.id)) say(entry.name + " has no row in the tree"); });
  menuItem("Centre on it", "bring it into view, from where you are",
           () => centreOn(entry.id));
  menuItem("Open definition", "its parameters, in the panel",
           () => select(entry.id, true));
  menuRule();
  menuItem("Hide it", "take it out of the 3D view",
           () => showFeature(entry.id, false));
  //! The set it is in, because in an imported building the thing you actually
  //! want to put away is the storey, not the one beam you happened to hit.
  const home = feature(entry.parent);
  if (home) {
    menuItem("Hide " + home.name, "everything in that set",
             () => showFeature(home.id, false));
    menuItem("Show " + home.name + " in tree", "the set it is filed in",
             () => revealInTree(home.id));
  }
  menuRule();
  menuItem("Fold the tree", "every set, shut", () => foldAll(true));
  placeMenu(event.clientX, event.clientY);
}

function openMeshContext(event) {
  const menu = document.getElementById("menu");
  menu.textContent = "";
  const which = meshEditor.level === "border" || meshEditor.level === "element"
    ? "mesh" : meshEditor.level;
  meshMenuBody(which);
  menuRule();
  menuHead("Select");
  for (const key of ["all", "none", "invert", "linked", "loop", "ring"]) {
    const pick = PICKS.find(p => p.key === key);
    if (!pick || !pick.levels.includes(meshEditor.level)) continue;
    menuItem(pick.label, "", () => meshEditor.select(pick.key));
  }
  placeMenu(event.clientX, event.clientY);
}

meshBar.addEventListener("click", async event => {
  const level = event.target.closest("[data-level]");
  if (level) { meshEditor.setLevel(level.dataset.level); return; }
  const menu = event.target.closest("[data-menu]");
  if (menu) {
    const box = menu.getBoundingClientRect();
    for (const other of meshBar.querySelectorAll("[data-menu]"))
      other.setAttribute("aria-expanded", other === menu ? "true" : "false");
    openMeshMenu(menu.dataset.menu, box.left, box.top - 6, true);
    return;
  }
  if (event.target.closest("#mx-drop-step")) { await meshEditor.undoStep(); return; }
  if (event.target.closest("#mx-done")) leaveMeshEdit();
});
meshBar.addEventListener("input", async event => {
  if (event.target.id !== "mx-lead" && event.target.id !== "mx-lead-read") return;
  const lead = meshEditor.lead();
  if (!lead) return;
  const value = Number(event.target.value);
  const other = meshBar.querySelector(event.target.id === "mx-lead" ? "#mx-lead-read" : "#mx-lead");
  if (other) other.value = String(value);
  await meshEditor.adjust(lead.key, Array.isArray(lead.value)
    ? [lead.value[0], lead.value[1], value] : value);
});
meshBar.addEventListener("keydown", event => event.stopPropagation());

const AXES = [
  { key: "x", dir: new THREE.Vector3(1, 0, 0), color: 0xd0473f },
  { key: "y", dir: new THREE.Vector3(0, 1, 0), color: 0x3f9e4d },
  { key: "z", dir: new THREE.Vector3(0, 0, 1), color: 0x2f7fd0 },
];

function clearMeshEdit() {
  for (const key of ["dots", "gizmo"]) {
    if (!meshEdit[key]) continue;
    world.remove(meshEdit[key]);
    disposeGroup(meshEdit[key]);
    meshEdit[key] = null;
  }
}

//! The cage of whatever is being edited, as clickable dots, plus the axes on
//! the one that is selected. Rebuilt whenever the mesh or the selection moves.
function refreshMeshEdit() {
  const entry = handEditing();
  clearMeshEdit();
  if (!entry) { meshEdit.id = null; meshEdit.vertex = -1; draw(); return; }
  if (meshEdit.id !== entry.id) { meshEdit.id = entry.id; meshEdit.vertex = -1; }

  const stream = streams.get(entry.id);
  const vertices = stream && stream.vertices;
  if (!vertices || !vertices.length) { draw(); return; }
  const count = vertices.length / 3;
  meshEdit.chosen = meshEdit.chosen.filter(v => v < count);
  if (meshEdit.vertex >= count) meshEdit.vertex = -1;

  const dots = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position",
      new THREE.Float32BufferAttribute(vertices, 3)),
    new THREE.PointsMaterial({ color: THEME.accent, size: 8, sizeAttenuation: false,
                               transparent: true, opacity: 0.95, depthTest: false }));
  dots.renderOrder = 5;
  dots.userData.handles = true;
  const group = new THREE.Group();
  group.add(dots);

  // The ones picked, marked over the top of the rest, so a run of them along an
  // edge reads as a run rather than as a guess.
  if (meshEdit.chosen.length) {
    const marks = meshEdit.chosen.map(v =>
      new THREE.Vector3(vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]));
    const on = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(marks),
      new THREE.PointsMaterial({ color: THEME.datum, size: 13, sizeAttenuation: false,
                                 depthTest: false }));
    on.renderOrder = 6;
    group.add(on);
  }
  world.add(group);
  meshEdit.dots = group;

  if (meshEdit.vertex >= 0) {
    if (!meshEdit.chosen.includes(meshEdit.vertex)) meshEdit.chosen = [meshEdit.vertex];
    const at = new THREE.Vector3(vertices[meshEdit.vertex * 3],
      vertices[meshEdit.vertex * 3 + 1], vertices[meshEdit.vertex * 3 + 2]);
    meshEdit.gizmo = buildGizmo(at);
    world.add(meshEdit.gizmo);
  }
  draw();
}

/* ==========================================================================
   The sketcher.

   A sketch is a drawing in two dimensions and a plane to put it on. Opening
   one takes the viewport over: the camera goes to the plane and stops
   orbiting, the tool rail steps aside for the seven things a drawing is made
   of, and a click is no longer a click on a solid - it is a point on the
   plane, in the plane's own two numbers.

   Nothing here holds any geometry. Every click ends as one line of the model
   description language - {"op":"draw","id":"SK1","type":"line","at":[[0,0],
   [120,0]]} - which goes down the same road as a slider and a wire, and comes
   back as a rebuilt sketch. Drawing a line and typing that line into the model
   file are the same edit, because there is only one of them.
   ========================================================================== */

const sketcher = {
  id: null,          // the sketch being drawn on
  tool: "select",    // a sketch opens ready to look at, not ready to draw
  clicks: [],        // the clicks so far, in the plane's coordinates
  from: null,        // the end a chain is carrying on from: { id, key }
  tangent: true,     // whether an arc off a chain leaves it smoothly
  hover: null,       // where the cursor is on the plane, for the rubber band
  picked: [],        // what a relation will be put on, in the order picked
  relation: -1,      // the relation marker under the cursor's last click, if any
  snapped: null,     // the handle the last click landed on, for coincidence
  drag: null,        // the handle under the cursor, mid-drag
  band: null,        // the window being dragged out: { from, to }
  move: null,        // a whole selection being dragged: { from, by, ids, on }
  preview: null,     // the drawing as the drag would leave it, not yet written
  group: null,       // the overlay: handles, the band, what is picked
  orbit: null,       // the view to put back on the way out
};

//! Choosing a tool abandons whatever was half-drawn - a half-drawn thing
//! belongs to the tool that was drawing it.
function pickSketchTool(type) {
  // Reaching for the arc while a chain is live keeps the chain, so the arc can
  // leave it tangentially. Everything else starts clean.
  const carry = type === "arc" && sketcher.from && sketcher.clicks.length === 1;
  sketcher.tool = type;
  if (!carry) { sketcher.clicks = []; sketcher.from = null; sketcher.snapped = null; }
  sketcher.picked = [];
  sketcher.drag = null;
  sketcher.preview = null;
  refreshSketch();
}

//! What the buttons are called. The type names are lower case because they are
//! what the model file says; these are for people.
const SKETCH_LABELS = {
  select: "Select", point: "Point", line: "Polyline", rect: "Rectangle", arc: "Arc",
  circle: "Circle", ellipse: "Ellipse", oblong: "Oblong", spline: "Spline",
  bspline: "Control curve",
};

const sketching = () => (sketcher.id && feature(sketcher.id)) || null;

//! The plane, as the kernel last resolved it. The driver writes it down when
//! it builds, so the viewport never has to work out which way a plane's axes
//! point - which is exactly the sum it would get subtly wrong.
function sketchFrame() {
  const entry = sketching();
  const frame = entry && entry.sketch && entry.sketch.frame;
  if (!frame) return null;
  return {
    origin: new THREE.Vector3(...frame.origin),
    x: new THREE.Vector3(...frame.x),
    y: new THREE.Vector3(...frame.y),
    normal: new THREE.Vector3(...frame.normal),
  };
}

//! Two numbers on the paper, one point in the world - the same map the kernel
//! builds its edges through.
function sketchToWorld(uv, frame = sketchFrame()) {
  if (!frame) return new THREE.Vector3();
  return frame.origin.clone()
    .addScaledVector(frame.x, uv[0]).addScaledVector(frame.y, uv[1]);
}

//! And back: where a pointer is, on the plane, in the drawing's own numbers.
function sketchAt(event) {
  const frame = sketchFrame();
  if (!frame) return null;
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(frame.normal, frame.origin);
  const hit = rayFrom(event).ray.intersectPlane(plane, new THREE.Vector3());
  if (!hit) return null;
  const away = hit.sub(frame.origin);
  return [Math.round(away.dot(frame.x) * 1e3) / 1e3, Math.round(away.dot(frame.y) * 1e3) / 1e3];
}

//! The drawing as it is WRITTEN DOWN - always a fresh read, never the preview.
//! Every frame of a drag starts here, which is the whole of why a drag follows
//! the cursor: an offset applied to a drawing that already carries the last
//! frame's offset is applied twice, and the line runs away from the hand that
//! is pushing it. That is the bug this function exists to make impossible.
const sketchStored = () => {
  const entry = sketching();
  return entry && entry.sketch ? readSketch(entry.sketch.drawing)
                               : { elements: [], constraints: [] };
};

//! The drawing as it should be seen. Mid-drag that is the drawing as the drag
//! would leave it - shown, not yet written, because a drag is one edit and it
//! is not finished until the cursor is let go.
const sketchDrawing = () => sketcher.preview || sketchStored();

//! WHAT THE DRAG WILL ACTUALLY COME TO. The constraints are the truth: a line
//! held horizontal does not become diagonal because you dragged its end
//! upwards, it slides along. Showing the unsolved drawing mid-drag meant the
//! preview and the result were different drawings, and the moment you let go
//! everything jumped. So the preview is solved, the same way the kernel solves
//! it, with the handle you are holding pinned so the solver moves everything
//! else around it rather than pushing it out from under the cursor.
function settled(drawing, pinned) {
  const entry = sketching();
  if (!entry || !drawing.constraints || !drawing.constraints.length) return drawing;
  const values = entry.values || {};
  if (values.solve) return drawing;                 // the node is set to ignore them
  const passes = Math.max(1, Math.round(values.passes || 24));
  try { return solveSketch(drawing, passes, pinned || []).drawing; }
  catch (error) { return drawing; }
}

//! Every handle of a list of elements, named the way a constraint names one.
//! What to pin while a whole element is being dragged: the solver may move
//! anything it likes EXCEPT the thing in your hand.
const handlesOf = (drawing, ids) => {
  const want = new Set(ids);
  const out = [];
  for (const el of drawing.elements)
    if (want.has(el.id)) for (const [key] of sketchHandles(el)) out.push(el.id + "." + key);
  return out;
};

//! How far a snap reaches, in the drawing's units: a fixed number of pixels,
//! turned into millimetres by how far away the camera is, so it feels the same
//! zoomed in and zoomed out.
const snapReach = () => view.distance * 0.018;

//! The nearest end of anything already drawn. Landing on one and saying so is
//! what makes a drawn corner a corner rather than two lines that nearly meet.
function nearestHandle(uv, drawing = sketchDrawing()) {
  let best = null, reach = snapReach();
  for (const el of drawing.elements) {
    // Nothing on a layer that is off or locked is ever under the cursor. That
    // is what locking is FOR: a survey to draw over that never grabs the drag.
    if (!elementShown(drawing, el) || elementLocked(drawing, el)) continue;
    for (const [key, p] of sketchHandles(el)) {
      const away = Math.hypot(p[0] - uv[0], p[1] - uv[1]);
      if (away < reach) { reach = away; best = { ref: el.id + "." + key, p, id: el.id }; }
    }
  }
  return best;
}

//! Where the relations are drawn. Several holding the same corner would sit on
//! top of one another, so they fan out from it - each one still beside what it
//! governs, and each one separately clickable.
function relationMarks(drawing = sketchDrawing()) {
  const marks = sketchRelationMarks(drawing);
  const step = snapReach() * 0.9;
  const seen = new Map();
  return marks.map(mark => {
    const at = mark.p.map(v => Math.round(v * 10) / 10).join(",");
    const nth = seen.get(at) || 0;
    seen.set(at, nth + 1);
    // Up and to the right of what it holds, then along, the way a drawing
    // board stacks its marks.
    return { ...mark, at: mark.at,
             draw: [mark.p[0] + step * (0.9 + nth * 1.0), mark.p[1] + step * 0.9] };
  });
}

function nearestRelation(uv, drawing = sketchDrawing()) {
  let best = -1, reach = snapReach();
  for (const mark of relationMarks(drawing)) {
    const away = Math.hypot(mark.draw[0] - uv[0], mark.draw[1] - uv[1]);
    if (away < reach) { reach = away; best = mark.at; }
  }
  return best;
}

//! The nearest element, by its own outline. What a relation is put on.
function nearestElement(uv, drawing = sketchDrawing()) {
  let best = null, reach = snapReach() * 1.6;
  for (const el of drawing.elements) {
    if (!elementShown(drawing, el) || elementLocked(drawing, el)) continue;
    // To the element, not to the points it was sampled at. A line is sampled
    // as its two ends and nothing between them, so measuring to the samples
    // meant the middle of a long line was never under the cursor at all -
    // which is most of a line, and exactly where you take hold of one.
    const away = sketchDistanceTo(el, uv, 48);
    if (away < reach) { reach = away; best = el.id; }
  }
  return best;
}

function enterSketch(id) {
  const entry = feature(id);
  if (!entry || !entry.sketch) return;
  // Drawing needs the drawing surface. On a phone whatever sheet is up is over
  // it, so it goes down - the sketch rail is one tap away on Build.
  if (onPhone() && sheetOpen()) openSheet("");
  if (handEditing()) { meshEdit.id = null; meshEdit.vertex = -1; refreshMeshEdit(); }
  sketcher.id = id;
  sketcher.tool = "select";
  sketcher.clicks = [];
  sketcher.from = null;
  sketcher.picked = [];
  sketcher.relation = -1;
  sketcher.snapped = null;
  sketcher.drag = null;
  sketcher.band = null;
  sketcher.move = null;
  sketcher.preview = null;
  sketcher.hover = null;
  sketcher.orbit = { yaw: view.yaw, pitch: view.pitch, distance: view.distance,
                     target: view.target.clone() };
  lookAtSketch();
  buildSketchRail();
  refreshSketch();
  // The drawing is worth having open while you draw on it: the panel shows the
  // JSON, which is the drawing itself and not a report of it. Beside the canvas
  // on a desktop - but on a phone it would be OVER the canvas, so the sheet
  // stays down and the Edit tab is where it waits.
  const raise = phoneSheets;
  phoneSheets = false;
  select(id, true);
  phoneSheets = raise;
  layout();
}

function leaveSketch() {
  if (!sketcher.id) return;
  sketcher.id = null;
  sketcher.clicks = [];
  sketcher.from = null;
  sketcher.picked = [];
  sketcher.drag = null;
  sketcher.band = null;
  sketcher.move = null;
  sketcher.preview = null;
  if (sketcher.orbit) {
    Object.assign(view, { yaw: sketcher.orbit.yaw, pitch: sketcher.orbit.pitch,
                          distance: sketcher.orbit.distance });
    view.target.copy(sketcher.orbit.target);
    sketcher.orbit = null;
    placeCamera();
  }
  refreshSketch();
  refreshToolbar();
  layout();
}

//! Square on to the plane, and staying there. The camera sits along the
//! plane's own normal; while a sketch is open the drag that would orbit pans
//! instead, because a drawing seen at an angle is a drawing you cannot draw on.
function lookAtSketch() {
  const frame = sketchFrame();
  if (!frame) return;
  const n = frame.normal;
  view.target.copy(frame.origin);
  view.yaw = Math.atan2(n.y, n.x);
  view.pitch = Math.max(-1.53, Math.min(1.53, Math.asin(Math.max(-1, Math.min(1, n.z)))));
  placeCamera();
  draw();
}

/* ------------------------------------------------------- drawing overlay */

function refreshSketch() {
  //! THE TREE FOLLOWS THE DRAWING. While a sketch is open its elements are
  //! rows in the tree, and what is picked in the drawing is what is lit up
  //! there - one selection, two places showing it. Rebuilt here because this
  //! is the one function every change inside a sketch goes through, entering
  //! and leaving included.
  buildTree();
  if (sketcher.group) { world.remove(sketcher.group); disposeGroup(sketcher.group); sketcher.group = null; }
  const bar = document.getElementById("sketch-bar");
  const rail = document.getElementById("sketch-rail");
  const entry = sketching();
  bar.hidden = rail.hidden = !entry;
  document.getElementById("rail").hidden = !!entry;
  if (!entry) { draw(); return; }

  document.getElementById("sketch-who").textContent = entry.name;
  document.getElementById("sketch-hint").textContent = sketchHint();
  for (const button of rail.querySelectorAll(".tool[data-sketch]"))
    button.classList.toggle("on", button.dataset.sketch === sketcher.tool);
  for (const button of rail.querySelectorAll(".tool[data-relation]"))
    button.classList.toggle("ready", relationReady(button.dataset.relation));
  for (const button of rail.querySelectorAll(".tool[data-change]"))
    button.classList.toggle("ready", roundable().length === 2);
  // The tangent switch is only a question while there is something to be
  // tangent to, so it is only asked then.
  const smooth = document.getElementById("sketch-tangent");
  smooth.hidden = !(sketcher.from && sketcher.clicks.length === 1);
  smooth.setAttribute("aria-pressed", sketcher.tangent ? "true" : "false");
  // Only offered when there is one in hand, because it is the one button here
  // that takes something away.
  document.getElementById("sketch-unrelate").hidden = sketcher.relation < 0;
  // The fillet is a question about TWO things, so it is asked only when there
  // are two. A radius field standing there with nothing to round is a field in
  // the way of the hint that would have told you to pick something.
  document.getElementById("sketch-fillet").hidden = roundable().length !== 2;
  // Construction is a question about what is picked, so it is only asked while
  // something is. Pressed means everything picked is already construction, and
  // pressing it again makes all of it real.
  const toggle = document.getElementById("sketch-construct");
  const picked = pickedElements();
  toggle.disabled = !picked.length;
  toggle.setAttribute("aria-pressed", picked.length && picked.every(isConstruction)
    ? "true" : "false");
  toggle.title = !picked.length
    ? "Construction geometry — pick elements first. Drawn dashed, drives the drawing, "
      + "and never built."
    : picked.every(isConstruction)
      ? "Make " + (picked.length === 1 ? "this" : "these " + picked.length)
        + " real again — built, and out in the solid"
      : "Make " + (picked.length === 1 ? "this" : "these " + picked.length)
        + " construction: dashed, and never built";

  const frame = sketchFrame();
  if (!frame) { draw(); return; }
  const group = new THREE.Group();
  const drawing = sketchDrawing();

  // The drawing itself, over the top of everything. The kernel already built
  // these edges and the viewport already draws them - but behind the solid the
  // sketch was padded into, and a line you cannot see is a line you cannot
  // draw against.
  for (const el of drawing.elements) {
    // A layer that is off is not drawn, and a locked one is drawn quietly: it
    // is there to draw against, not to be picked up.
    if (!elementShown(drawing, el)) continue;
    const held = elementLocked(drawing, el);
    const scaffold = isConstruction(el);
    const line = sketchOutline(el, 64).map(p => sketchToWorld(p, frame));
    if (line.length < 2) continue;
    // Dashed, and only in here. Construction geometry is drawn the way every
    // drawing board has drawn it, and the dashes are the promise that it will
    // not turn up in the solid: what you see dashed is what does not come out.
    const over = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(line),
      scaffold
        ? new THREE.LineDashedMaterial({ color: THEME.datum, depthTest: false,
                                         transparent: true, opacity: held ? 0.4 : 0.9,
                                         dashSize: snapReach() * 0.7,
                                         gapSize: snapReach() * 0.45 })
        : new THREE.LineBasicMaterial({ color: held ? THEME["shape-edge"] : THEME.curve,
                                        depthTest: false,
                                        transparent: true, opacity: held ? 0.4 : 0.85 }));
    // A dashed material measures its dashes along the line, and the line has to
    // be asked to work out how far along each of its points is.
    if (scaffold) over.computeLineDistances();
    over.renderOrder = 5;
    group.add(over);
  }

  // Every end of everything, as a dot. These are what a click snaps to and
  // what a coincidence is put between.
  const dots = [];
  for (const el of drawing.elements) {
    if (!elementShown(drawing, el) || elementLocked(drawing, el)) continue;
    for (const [, p] of sketchHandles(el)) dots.push(sketchToWorld(p, frame));
  }
  if (dots.length) {
    const cloud = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(dots),
      new THREE.PointsMaterial({ color: THEME.datum, size: 6, sizeAttenuation: false,
                                 depthTest: false }));
    cloud.renderOrder = 6;
    group.add(cloud);
  }

  // The relations, each beside what it holds. They are not geometry, so they
  // are drawn rather than built: a small glyph you can click, and take off.
  for (const mark of relationMarks(drawing)) {
    const chosen = mark.at === sketcher.relation;
    const colour = chosen ? THEME.accent : THEME.datum;
    const at = sketchToWorld(mark.draw, frame);
    const size = snapReach() * 0.42;
    const glyph = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(
        (RELATION_GLYPH[mark.type] || RELATION_GLYPH.coincident).map(([u, v]) =>
          sketchToWorld([mark.draw[0] + u * size, mark.draw[1] + v * size], frame))),
      new THREE.LineBasicMaterial({ color: colour, depthTest: false }));
    glyph.renderOrder = 8;
    group.add(glyph);
    // A thread back to what it holds, so a fanned-out mark still says which
    // corner it belongs to.
    for (const on of mark.on) {
      const tie = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([at, sketchToWorld(on, frame)]),
        new THREE.LineBasicMaterial({ color: colour, depthTest: false,
                                      transparent: true, opacity: chosen ? 0.7 : 0.28 }));
      tie.renderOrder = 8;
      group.add(tie);
    }
  }

  // What a relation would be put on, drawn over the top of it.
  for (const id of sketcher.picked) {
    const el = drawing.elements.find(e => e.id === String(id).split(".")[0]);
    if (!el) continue;
    const line = sketchOutline(el, 48).map(p => sketchToWorld(p, frame));
    if (line.length < 2) continue;
    const shown = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(line),
      new THREE.LineBasicMaterial({ color: THEME.accent, depthTest: false }));
    shown.renderOrder = 7;
    group.add(shown);
  }

  // The window being dragged out. Solid when it takes only what is wholly
  // inside it and dashed when it takes anything it touches, which is the one
  // piece of feedback that makes the two directions worth having.
  if (sketcher.band) {
    const b = sketchBox(sketcher.band.from, sketcher.band.to);
    const crossing = sketcher.band.to[0] < sketcher.band.from[0];
    const corner = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]
      .map(p => sketchToWorld(p, frame));
    const edge = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([...corner, corner[0]]),
      crossing
        ? new THREE.LineDashedMaterial({ color: THEME.accent, depthTest: false,
                                         dashSize: snapReach() * 0.6, gapSize: snapReach() * 0.4 })
        : new THREE.LineBasicMaterial({ color: THEME.accent, depthTest: false }));
    if (crossing) edge.computeLineDistances();
    edge.renderOrder = 9;
    group.add(edge);
    const fill = new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints(
        [corner[0], corner[1], corner[2], corner[0], corner[2], corner[3]]),
      new THREE.MeshBasicMaterial({ color: THEME.accent, depthTest: false, transparent: true,
                                    opacity: 0.09, side: THREE.DoubleSide }));
    fill.renderOrder = 9;
    group.add(fill);
  }

  // The element being drawn, following the cursor. Made the same way the real
  // one will be, so what is shown is what will be written.
  const band = sketchBand(drawing);
  if (band) {
    const line = sketchOutline(band, 48).map(p => sketchToWorld(p, frame));
    if (line.length >= 2) {
      const rubber = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(line),
        new THREE.LineDashedMaterial({ color: THEME.accent, dashSize: 6, gapSize: 4,
                                       depthTest: false }));
      rubber.computeLineDistances();
      rubber.renderOrder = 7;
      group.add(rubber);
    }
  }

  world.add(group);
  sketcher.group = group;
  draw();
}

//! The element the clicks so far would make if the cursor were the last one.
//! Made the same way the real one will be, so what is shown is what will be
//! written - including a tangent arc, which is worth seeing before you commit
//! to it.
function sketchBand(drawing) {
  if (!sketcher.hover || !sketcher.clicks.length) return null;
  const wanted = SKETCH_CLICKS[sketcher.tool];
  const clicks = [...sketcher.clicks, sketcher.hover];
  const smooth = tangentHere(drawing);
  if (smooth && sketcher.tool === "arc")
    return sketchTangentArc(sketcher.clicks[0], smooth, sketcher.hover, "band");
  if (wanted && clicks.length < wanted)
    // Not enough yet to be what it will be; show the straight run of clicks.
    return { id: "band", type: "spline", pts: clicks, closed: false };
  try { return sketchElement(sketcher.tool, "band", clicks); } catch (e) { return null; }
}

//! The direction the chain is travelling, when there is a chain and tangency is
//! wanted. This is what makes the next arc leave the last line smoothly rather
//! than at a kink - the move a CAD sketcher is built around.
function tangentHere(drawing = sketchDrawing()) {
  // Only the arc tool leaves smoothly. Carrying on with the line tool is a
  // polyline, and a polyline's corners are corners.
  if (sketcher.tool !== "arc") return null;
  if (!sketcher.tangent || !sketcher.from || sketcher.clicks.length !== 1) return null;
  const el = drawing.elements.find(e => e.id === sketcher.from.id);
  return el ? sketchDirectionAt(el, sketcher.from.key) : null;
}

function sketchHint() {
  if (sketcher.tool === "select" && sketcher.picked.length === 1 && sketcher.relation < 0)
    return "1 picked · shift-click another, then a relation";
  if (sketcher.relation >= 0) {
    const drawing = sketchDrawing();
    const held = drawing.constraints[sketcher.relation];
    return (held ? held.type : "relation") + " · Delete to take it off";
  }
  if (sketcher.tool === "select") {
    if (sketcher.picked.length)
      return sketcher.picked.length + " picked · apply a relation, Delete, or Esc";
    return "select · drag an end to move it · click to pick, then relate or Delete";
  }
  const wanted = SKETCH_CLICKS[sketcher.tool] || 0;
  const smooth = tangentHere();
  if (smooth) return "arc · tangent to the last segment · click where it ends";
  if (sketcher.tool === "arc" && sketcher.from && sketcher.clicks.length === 1)
    return "arc · 2 more clicks · Tangent to carry on smoothly";
  if (sketcher.tool === "line" && sketcher.clicks.length)
    return "polyline · click for the next corner · Esc or Enter to stop";
  // The two tools that take as many points as you give them, and the one word
  // that tells them apart: a spline goes through its points, a control curve
  // is pulled by them.
  if (!wanted) return sketcher.tool === "bspline"
    ? "control curve · click the points that pull it, Enter or double-click to finish"
    : "spline · click the points it goes through, Enter or double-click to finish";
  const left = wanted - sketcher.clicks.length;
  return sketcher.tool + " · " + (left > 0 ? left + " more click" + (left === 1 ? "" : "s")
                                           : "click to place");
}

/* --------------------------------------------------------------- clicking */

//! One click on the plane. In select it picks or starts a drag; with a tool it
//! collects clicks until there are enough to be something, and writes it.
function sketchClick(event) {
  const uv = sketchAt(event);
  if (!uv) return;
  const drawing = sketchDrawing();

  if (sketcher.tool === "select") {
    // A relation's own mark is the first thing under the cursor: it is drawn
    // over the drawing, and clicking one is how it is taken off again.
    const relation = nearestRelation(uv, drawing);
    if (relation >= 0) {
      sketcher.relation = sketcher.relation === relation ? -1 : relation;
      sketcher.picked = [];
      refreshSketch();
      return;
    }
    sketcher.relation = -1;
    // Picking is what select is for: ends for a coincidence, whole elements
    // for everything else. Shift adds to what is picked, here as everywhere
    // else; clicking nothing clears, the way a canvas does.
    const handle = nearestHandle(uv, drawing);
    const want = handle ? handle.ref : nearestElement(uv, drawing);
    pickInSketch(want, event.shiftKey);
    return;
  }

  // Asked before the click is added, because whether this click finishes a
  // tangent arc depends on what was there before it, not after.
  const smooth = tangentHere(drawing);
  const snap = nearestHandle(uv, drawing);
  const at = snap ? snap.p.slice() : uv;
  if (!sketcher.clicks.length && !sketcher.from) sketcher.snapped = snap ? snap.ref : null;
  sketcher.clicks.push(at);
  // A tangent arc needs only where it ends: where it starts and which way it
  // leaves are both already settled by the element before it.
  const enough = smooth ? 2 : SKETCH_CLICKS[sketcher.tool];
  if (enough && sketcher.clicks.length >= enough) commitSketchElement(snap, smooth);
  else refreshSketch();
}

//! Which handle of a freshly drawn element is its start and which its end.
const SKETCH_ENDS = { line: ["a", "b"], arc: ["start", "end"], spline: null };

function commitSketchElement(endSnap, smooth = null) {
  const clicks = sketcher.clicks.slice();
  const opening = sketcher.snapped;
  const carried = sketcher.from;
  sketcher.clicks = [];
  sketcher.snapped = null;
  if (clicks.length < 2) { refreshSketch(); return; }

  const drawing = sketchDrawing();
  const id = nextSketchId(drawing);
  const tool = sketcher.tool;

  // Tangency is said, not computed here: the edit names the end to leave and
  // the point to reach, and the op works out the arc. So the line in the
  // console is the whole of what happened, and replaying it draws the same arc.
  const carry = smooth ? carried.id + "." + carried.key : null;
  const edits = [carry
    ? { op: "draw", id: sketcher.id, type: "arc", at: [clicks[1]], from: carry, as: id }
    : { op: "draw", id: sketcher.id, type: tool, at: clicks, as: id }];

  const pair = SKETCH_ENDS[tool === "select" ? "line" : tool];
  // An element drawn onto the end of another is meant to stay on it. The snap
  // put it there; the coincidence keeps it there when either is moved. A chain
  // carries its own join, so the corner holds without a second click.
  // A tangent arc already starts where the chain left off; it needs no second
  // way of being told so.
  const joinTo = carry ? null : (opening || (carried && carried.id + "." + carried.key));
  if (pair && joinTo)
    edits.push({ op: "relate", id: sketcher.id, type: "coincident",
                 of: [id + "." + pair[0], joinTo] });
  if (pair && endSnap && endSnap.ref !== joinTo)
    edits.push({ op: "relate", id: sketcher.id, type: "coincident",
                 of: [id + "." + pair[1], endSnap.ref] });

  // A line keeps going: this is a polyline tool, so the end of the segment just
  // drawn is the start of the next one, and switching to the arc tool now
  // carries the tangent with it. Anything else is one element and stops.
  const chains = tool === "line" || tool === "arc";
  if (chains && pair) {
    sketcher.from = { id, key: pair[1] };
    sketcher.clicks = [endSnap ? endSnap.p.slice() : clicks[clicks.length - 1]];
  } else {
    sketcher.from = null;
  }
  mdl.runAll(edits).catch(err => showError(err.message));
}

//! Enter, a double-click, or Esc: that was the last point. A spline needs it
//! because it is however long you make it; a chain needs it because it would
//! otherwise carry on for ever.
function endSketchRun() {
  if (!SKETCH_CLICKS[sketcher.tool] && sketcher.clicks.length >= 2) {
    commitSketchElement(null);
    sketcher.from = null;
    sketcher.clicks = [];
    refreshSketch();
    return true;
  }
  if (sketcher.clicks.length || sketcher.from) {
    sketcher.clicks = [];
    sketcher.from = null;
    sketcher.snapped = null;
    refreshSketch();
    return true;
  }
  return false;
}

/* --------------------------------------------------------------- dragging */

//! Dragging an end of an element. The drawing is changed as the cursor moves so
//! it can be seen, but only the end of the drag is written - one edit, one
//! step to undo, however far the cursor travelled.
function grabSketchHandle(event) {
  if (!sketching() || sketcher.tool !== "select") return false;
  const uv = sketchAt(event);
  if (!uv) return false;
  const found = nearestHandle(uv);
  if (!found) return false;
  sketcher.drag = { ref: found.ref, at: found.p.slice(), moved: false };
  return true;
}

function dragSketchHandle(event) {
  const uv = sketchAt(event);
  if (!uv || !sketcher.drag) return;
  sketcher.drag.at = uv;
  sketcher.drag.moved = true;
  // Shown from the drawing as it would be, without writing anything yet - and
  // built from what is STORED each frame, so the end lands where the cursor is
  // rather than where the cursor has been.
  const preview = sketchStored();
  const found = sketchHandleAt(preview, sketcher.drag.ref);
  if (found) {
    sketchMoveHandle(found.el, found.key, uv);
    sketcher.preview = settled(preview, [sketcher.drag.ref]);
  }
  refreshSketch();
}

/* ------------------------------------------------- windows and whole moves

   The two gestures that make a selection worth having. Drag out a window on
   empty paper and it takes what is in it - left to right, only what is wholly
   inside; right to left, anything it crosses, which is how every CAD package
   has read those two directions since AutoCAD. Then press on any of what is
   picked and drag, and the whole lot moves together.                        */

function startSketchBand(event) {
  const uv = sketchAt(event);
  sketcher.band = uv ? { from: uv, to: uv.slice() } : null;
}

function dragSketchBand(event) {
  const uv = sketchAt(event);
  if (!uv || !sketcher.band) return;
  sketcher.band.to = uv;
  refreshSketch();
}

//! Let go of the window. Without an event it was only ever a click, so the
//! band is taken down and nothing is chosen.
function dropSketchBand(event) {
  const band = sketcher.band;
  sketcher.band = null;
  if (!band || !event) { refreshSketch(); return; }
  const drawing = sketchDrawing();
  const crossing = band.to[0] < band.from[0];
  const found = sketchInBox(drawing, sketchBox(band.from, band.to), { crossing });
  sketcher.relation = -1;
  if (event.shiftKey) {
    const have = new Set(sketcher.picked.map(ref => String(ref).split(".")[0]));
    for (const id of found) if (!have.has(id)) sketcher.picked.push(id);
  } else sketcher.picked = found;
  const n = sketcher.picked.length;
  say(n ? n + (n === 1 ? " picked" : " picked") + " · "
        + (crossing ? "crossing window" : "window")
        + " · drag any of them to move, Delete to erase"
      : "that " + (crossing ? "crossing window" : "window") + " caught nothing");
  refreshSketch();
  buildPanel();
}

//! A press on something already picked takes hold of all of it. Asked after
//! the handles, so dragging one end of a picked line still moves that end -
//! the handle is the finer gesture and it wins where both are on offer.
function grabSketchMove(event) {
  if (!sketching() || sketcher.tool !== "select" || !sketcher.picked.length) return false;
  const uv = sketchAt(event);
  if (!uv) return false;
  const drawing = sketchDrawing();
  const on = nearestElement(uv, drawing);
  if (!on) return false;
  const ids = [...new Set(sketcher.picked.map(ref => String(ref).split(".")[0]))];
  if (!ids.includes(on)) return false;
  sketcher.move = { from: uv, by: [0, 0], ids, on, moved: false };
  return true;
}

function dragSketchMove(event) {
  const uv = sketchAt(event);
  if (!uv || !sketcher.move) return;
  const by = [uv[0] - sketcher.move.from[0], uv[1] - sketcher.move.from[1]];
  sketcher.move.by = by;
  sketcher.move.moved = true;
  // The offset is measured from where the drag STARTED, so it has to be laid
  // on the drawing as it was when the drag started. Laying it on the preview
  // instead added this frame's offset to the last frame's, and the further you
  // dragged the further ahead of the cursor the thing ran.
  const preview = sketchStored();
  const want = new Set(sketcher.move.ids);
  const held = [];
  for (const el of preview.elements)
    if (want.has(el.id)) { sketchMoveElement(el, by); held.push(el.id); }
  sketcher.preview = settled(preview, handlesOf(preview, held));
  refreshSketch();
}

function dropSketchMove(event) {
  const move = sketcher.move;
  sketcher.move = null;
  sketcher.preview = null;
  if (!move) return;
  if (!move.moved) {
    // Taken hold of and let go without moving: a click, and a click picks.
    sketcher.relation = -1;
    pickInSketch(move.on, !!(event && event.shiftKey));
    return;
  }
  edit({ op: "nudge", id: sketcher.id, of: move.ids, by: move.by });
}

function dropSketchHandle(event) {
  const drag = sketcher.drag;
  sketcher.drag = null;
  sketcher.preview = null;
  if (!drag) return;
  if (!drag.moved) {
    // Taken hold of and let go without moving: that is a click, and a click on
    // an end picks it. Two picked ends are what a coincidence is made from.
    sketcher.relation = -1;
    pickInSketch(drag.ref, !!(event && event.shiftKey));
    return;
  }
  edit({ op: "drag", id: sketcher.id, handle: drag.ref, to: drag.at });
}

//! One thing picked in the drawing - an end, or a whole element. Shift adds
//! and takes away; without it a pick is a set of one. Written once because a
//! click on a handle and a click on an element arrive by different roads.
//! Delete on what is picked. A handle belongs to an element, so picking an end
//! and pressing Delete takes the segment it is an end of - which is what a
//! person who has just dragged that end means by it.
function dropPicked() {
  const gone = [...new Set(sketcher.picked.map(ref => String(ref).split(".")[0]))];
  if (!gone.length) return;
  sketcher.picked = [];
  mdl.runAll(gone.map(element => ({ op: "erase", id: sketcher.id, element })));
}

//! The elements behind what is picked - a handle belongs to an element, and
//! construction is a fact about the element rather than about one of its ends.
function pickedElements(drawing = sketchDrawing()) {
  const ids = [...new Set(sketcher.picked.map(ref => String(ref).split(".")[0]))];
  return ids.map(id => drawing.elements.find(el => el.id === id)).filter(Boolean);
}

//! WHAT A FILLET COULD BE ABOUT: the elements picked, when there are two of
//! them and both are things an arc can be tangent to. Asked in one place so
//! the bar, the rail and the hint all agree about when it is on offer.
function roundable() {
  const picked = pickedElements();
  const can = new Set(["line", "arc", "circle"]);
  return picked.length === 2 && picked.every(el => can.has(el.type)) ? picked : [];
}

//! Round the corner between the two picked elements. The radius is the one in
//! the bar; the refusal, when there is one, is the sentence sketchFillet wrote
//! rather than a shrug.
function roundSketchCorner() {
  const two = roundable();
  if (two.length !== 2) { say("pick two lines or arcs to round between"); return; }
  const field = document.getElementById("sketch-radius");
  const radius = Number(field && field.value);
  if (!(radius > 0)) { say("the fillet radius must be greater than zero"); return; }
  sketcher.picked = [];
  sketcher.relation = -1;
  edit({ op: "fillet", id: sketcher.id, of: [two[0].id, two[1].id], radius });
}

//! Construction on or off over everything picked. All of it construction
//! already means the button turns it back into geometry; anything else means
//! make all of it construction - so one button reads the selection and does
//! the thing that is left to do.
function toggleConstruction() {
  const picked = pickedElements();
  if (!picked.length) return;
  const on = !picked.every(isConstruction);
  edit({ op: "construct", id: sketcher.id, of: picked.map(el => el.id), on });
}

function pickInSketch(want, add) {
  if (!want) { if (!add) sketcher.picked = []; refreshSketch(); return; }
  if (!add) {
    sketcher.picked = sketcher.picked.length === 1 && sketcher.picked[0] === want ? [] : [want];
  } else if (sketcher.picked.includes(want)) {
    sketcher.picked = sketcher.picked.filter(p => p !== want);
  } else sketcher.picked.push(want);
  refreshSketch();
}

/* -------------------------------------------------------------- relations */

//! Taking a relation off. What it held comes apart again, which is the point.
function dropRelation() {
  const at = sketcher.relation;
  if (at < 0) return;
  sketcher.relation = -1;
  edit({ op: "unrelate", id: sketcher.id, at });
}

//! How many of what a relation is waiting for. Intersection is the odd one:
//! it takes three, but you only pick TWO - the curves - because the point is
//! the thing it makes rather than a thing you had to have already.
const relationWants = spec =>
  spec.key === "intersect" ? { picks: 2, kind: "element", what: "curves" }
  : spec.of === "handle" ? { picks: spec.takes, kind: "handle", what: "ends" }
  : { picks: spec.takes, kind: "element",
      what: spec.of === "line" ? "lines" : "elements" };

const usableFor = spec => {
  const wants = relationWants(spec);
  return sketcher.picked.filter(p => p.includes(".") === (wants.kind === "handle"));
};

const relationReady = key => {
  const spec = SKETCH_RELATIONS.find(r => r.key === key);
  return !!spec && usableFor(spec).length >= relationWants(spec).picks;
};

//! Select first, then say what should hold - the way every parametric sketcher
//! works. A relation with nothing picked says what it wants rather than doing
//! nothing.
function putRelation(key) {
  const spec = SKETCH_RELATIONS.find(r => r.key === key);
  if (!spec) return;
  const wants = relationWants(spec);
  const usable = usableFor(spec);
  if (usable.length < wants.picks) {
    document.getElementById("sketch-hint").textContent =
      spec.label + " · pick " + wants.picks + " " + wants.what + " first";
    return;
  }
  const picked = usable.slice(0, wants.picks);
  sketcher.picked = [];
  if (key !== "intersect") {
    edit({ op: "relate", id: sketcher.id, type: key, of: picked });
    return;
  }
  // The point is drawn first, at a crossing, and then held to it. Drawn there
  // rather than anywhere and left to the solver, because two curves may cross
  // twice and the one it starts nearest is the one it stays on.
  const drawing = sketchDrawing();
  const at = sketchCrossings(drawing, picked[0], picked[1]);
  if (!at.length) {
    document.getElementById("sketch-hint").textContent =
      spec.label + " · those two do not cross";
    refreshSketch();
    return;
  }
  const id = nextSketchId(drawing);
  mdl.runAll([
    { op: "draw", id: sketcher.id, type: "point", at: [at[0]], as: id },
    { op: "relate", id: sketcher.id, type: "intersect", of: [id + ".p", picked[0], picked[1]] },
  ]);
}

/* -------------------------------------------------------------- the rail */

//! The rail the sketcher draws with: the seven things a drawing is made of,
//! then the six ways one part of it can be held against another.
function buildSketchRail() {
  const rail = document.getElementById("sketch-rail");
  if (rail.dataset.built) return;
  rail.dataset.built = "1";

  const tools = document.createElement("div");
  tools.dataset.group = "elements";
  // Select comes first and is where the sketcher starts, because opening a
  // sketch should not arm a tool: the first thing you want to do to a drawing
  // is usually look at it and push something.
  for (const type of ["select", ...SKETCH_TYPES]) {
    const button = document.createElement("button");
    button.className = "tool";
    button.dataset.sketch = type;
    button.dataset.label =
      type === "select" ? "Select · drag an end, or pick things to relate"
      : type === "line" ? "Polyline · click corner after corner"
      : type === "rect" ? "Rectangle · two opposite corners"
      : type === "arc" ? "Arc · 3 clicks, or tangent to what you just drew"
      : type === "spline" ? "Spline · click points it goes THROUGH, Enter to finish"
      : type === "bspline" ? "Control curve · click points that PULL it, Enter to finish"
      : SKETCH_CLICKS[type] ? SKETCH_LABELS[type] + " · " + SKETCH_CLICKS[type] + " clicks"
      : SKETCH_LABELS[type] + " · click points, Enter to finish";
    // The long form is the hover label; the short one is what is printed under
    // the icon on a phone, where "Polyline · click corner after co…" is not a
    // name, it is a sentence cut in half.
    button.dataset.short = type === "select" ? "Select"
      : type === "line" ? "Polyline" : SKETCH_LABELS[type] || type;
    button.setAttribute("aria-label", type);
    button.innerHTML = svg(SKETCH_ICONS[type]);
    button.addEventListener("click", () => pickSketchTool(type));
    tools.appendChild(button);
  }
  rail.appendChild(tools);
  rail.appendChild(document.createElement("hr"));

  const relations = document.createElement("div");
  relations.dataset.group = "relations";
  for (const spec of SKETCH_RELATIONS) {
    const button = document.createElement("button");
    button.className = "tool";
    button.dataset.relation = spec.key;
    button.dataset.label = spec.label + " · " + spec.hint;
    button.dataset.short = spec.label;
    button.setAttribute("aria-label", spec.label);
    button.innerHTML = svg(SKETCH_ICONS[spec.key]);
    button.addEventListener("click", () => putRelation(spec.key));
    relations.appendChild(button);
  }
  rail.appendChild(relations);
  rail.appendChild(document.createElement("hr"));

  // The third group: things that change what is drawn rather than add to it or
  // hold it. One so far, and it is the one every drawing board has.
  const changes = document.createElement("div");
  changes.dataset.group = "changes";
  const round = document.createElement("button");
  round.className = "tool";
  round.dataset.change = "fillet";
  round.dataset.label = "Fillet \u00b7 pick two lines or arcs, then a radius";
  round.dataset.short = "Fillet";
  round.setAttribute("aria-label", "Fillet");
  round.innerHTML = svg(SKETCH_ICONS.fillet);
  round.addEventListener("click", roundSketchCorner);
  changes.appendChild(round);
  rail.appendChild(changes);
}

/* ======================================================================
   THE WIDGET, AND THE KEYBOARD IT ANSWERS TO.

   W moves, E turns, R resizes, Q puts it away. Everybody's fingers already
   know that; it has been the same four keys since Maya, and 3ds Max and
   Blender both learned it afterwards.

   WHAT IT WRITES. A widget does not move a shape - it writes numbers onto a
   Transform node, and the node moves the shape. That is what keeps the move in
   the tree: undoable, typeable, wireable, and still there tomorrow. Dragging
   something that is already a Transform drives THAT one rather than stacking a
   second on top, so pushing a tower twice leaves one number and not two nodes
   each holding half the answer.

   AND THE NAVIGATION. Holding Alt orbits, because otherwise the left button
   cannot belong to the widget - and a widget you have to aim at between orbits
   is a widget nobody uses. The middle and right buttons still pan, the wheel
   still zooms, and the choice is a setting for anyone who would rather have it
   the other way round.
   ====================================================================== */

const gizmo = {
  mode: null,          // "move" | "rotate" | "scale", or null for none
  id: null,            // the Transform being driven
  over: null,          // what it is being made over, before it exists
  at: new THREE.Vector3(),
  group: null,
  hover: null,
  grab: null,          // { handle, from, was, numbers }
  busy: false,
};

//! Alt to orbit, or drag to orbit. The request was the first; the setting is
//! so the second is still reachable, and it is read back on the way up - the
//! store is a long way down this file and reading it here would be reading it
//! before it exists.
let altToOrbit = true;

const gizmoOn = () => !!(gizmo.mode && gizmo.group);

//! How big the widget is, in the model's units: a share of how far away the
//! camera is, so it is the same size on screen at any zoom.
const gizmoSpan = () => view.distance * 0.2;

//! WHERE THE WIDGET STANDS. The middle of what is selected, because a widget
//! at the world origin while the thing you are moving is ninety metres away is
//! a widget about nothing.
function gizmoSeat(id) {
  const seat = boxOfShape(id);
  if (seat && !seat.isEmpty()) return seat.getCenter(new THREE.Vector3());
  const entry = feature(id);
  const data = entry && entry.data;
  if (data && data.preview) {
    const first = String(data.preview).match(/\(([^)]*)\)/);
    if (first) {
      const p = first[1].split(",").map(Number);
      if (p.length === 3 && p.every(Number.isFinite)) return new THREE.Vector3(...p);
    }
  }
  return new THREE.Vector3();
}

//! Can this be shoved about at all? A datum plane or a number has nothing for
//! a Transform to take hold of, and offering a widget for one is offering a
//! gesture that ends in an error.
const MOVEABLE = new Set(["solid", "curve", "plane", "point"]);
const moveable = entry => !!(entry && MOVEABLE.has(entry.produces) && entry.built);

//! Arm a mode, or put the widget away. The same key twice puts it away, which
//! is what a toggle is and what a hand expects when it presses W twice.
function armGizmo(mode) {
  const want = gizmo.mode === mode ? null : mode;
  gizmo.mode = want;
  if (!want) { dropGizmoWidget(); clearGizmo(); refreshGizmoBar(); draw(); return; }
  const entry = feature(state.selected);
  if (!moveable(entry)) {
    say(entry ? entry.name + " is not a thing a widget can move - pick a body, a curve, "
        + "a plane or a point" : "pick something first, then press W, E or R");
    gizmo.mode = null;
    refreshGizmoBar();
    return;
  }
  refreshGizmo();
  say(GIZMO_MODES[want].label + " \u00b7 " + GIZMO_MODES[want].hint);
}

function clearGizmo() {
  if (!gizmo.group) return;
  world.remove(gizmo.group);
  disposeGroup(gizmo.group);
  gizmo.group = null;
}

//! Built fresh whenever anything it depends on moves: the selection, the
//! camera distance, the shape underneath. Cheap - a dozen small meshes - and
//! rebuilding is the only way it stays the same size on screen.
function refreshGizmo() {
  clearGizmo();
  if (!gizmo.mode) { refreshGizmoBar(); return; }
  const entry = feature(state.selected);
  if (!moveable(entry)) { gizmo.mode = null; refreshGizmoBar(); return; }
  // A Transform already in hand keeps its own seat, so the widget does not
  // jump to the middle of the moved shape as you drag it.
  gizmo.at = gizmo.grab ? gizmo.at : gizmoSeat(entry.id);
  const span = gizmoSpan();
  const group = new THREE.Group();
  group.position.copy(gizmo.at);
  group.renderOrder = 7;

  const lit = key => gizmo.hover === key || (gizmo.grab && gizmo.grab.handle.key === key);
  const skin = (colour, key, strong = 0.95) => new THREE.MeshBasicMaterial({
    color: lit(key) ? 0xf2b134 : colour, depthTest: false, transparent: true,
    opacity: lit(key) ? 1 : strong });

  for (const handle of handlesFor(gizmo.mode)) {
    const dir = new THREE.Vector3(...(handle.dir || [0, 0, 1]));
    if (handle.kind === "axis" || handle.kind === "grip") {
      const material = skin(handle.colour, handle.key);
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(span * 0.022, span * 0.022, span, 10), material);
      const cap = handle.kind === "axis"
        ? new THREE.Mesh(new THREE.ConeGeometry(span * 0.075, span * 0.22, 14), material)
        : new THREE.Mesh(new THREE.BoxGeometry(span * 0.13, span * 0.13, span * 0.13), material);
      const turn = new THREE.Quaternion()
        .setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      shaft.quaternion.copy(turn); cap.quaternion.copy(turn);
      shaft.position.copy(dir).multiplyScalar(span * 0.5);
      cap.position.copy(dir).multiplyScalar(span * 1.08);
      for (const part of [shaft, cap]) {
        part.userData.handle = handle;
        part.renderOrder = 8;
        group.add(part);
      }
    } else if (handle.kind === "plane") {
      // A SQUARE IN THE CORNER BETWEEN TWO ARROWS, which is where every
      // modeller puts it: it is the plane those two axes make, and dragging it
      // slides the thing about in that plane. Drawn both sides, because a
      // plane seen from underneath is still the plane you meant to drag.
      const [u, v] = handle.along.map(a => new THREE.Vector3(...a));
      const size = span * 0.3, off = span * 0.42;
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color: lit(handle.key) ? 0xf2b134 : handle.colour,
          depthTest: false, transparent: true, opacity: lit(handle.key) ? 0.75 : 0.3,
          side: THREE.DoubleSide }));
      const frame = new THREE.Matrix4().makeBasis(u, v,
        new THREE.Vector3().crossVectors(u, v));
      sheet.quaternion.setFromRotationMatrix(frame);
      sheet.position.copy(u).multiplyScalar(off).addScaledVector(v, off);
      sheet.userData.handle = handle;
      sheet.renderOrder = 8;
      group.add(sheet);
      const edge = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-size / 2, -size / 2, 0), new THREE.Vector3(size / 2, -size / 2, 0),
          new THREE.Vector3(size / 2, size / 2, 0), new THREE.Vector3(-size / 2, size / 2, 0)]),
        new THREE.LineBasicMaterial({ color: handle.colour, depthTest: false,
                                      transparent: true, opacity: 0.9 }));
      edge.quaternion.copy(sheet.quaternion);
      edge.position.copy(sheet.position);
      edge.renderOrder = 9;
      group.add(edge);
    } else if (handle.kind === "ring") {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(span, span * 0.02, 8, 80),
        skin(handle.colour, handle.key, 0.9));
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      ring.userData.handle = handle;
      ring.renderOrder = 8;
      group.add(ring);
    } else if (handle.kind === "uniform") {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(span * 0.17, span * 0.17, span * 0.17),
        skin(handle.colour, handle.key, 0.85));
      cube.userData.handle = handle;
      cube.renderOrder = 9;
      group.add(cube);
    }
  }
  gizmo.group = group;
  world.add(group);
  refreshGizmoBar();
  draw();
}

//! The handle under the pointer, if any. Asked on every move while nothing is
//! being dragged, so what is about to be grabbed lights up first.
function gizmoUnder(event) {
  if (!gizmo.group) return null;
  const hits = rayFrom(event).intersectObjects(gizmo.group.children, false);
  return hits.length ? hits[0].object.userData.handle || null : null;
}

function hoverGizmo(event) {
  if (!gizmoOn() || gizmo.grab) return false;
  const found = gizmoUnder(event);
  const key = found ? found.key : null;
  if (key === gizmo.hover) return !!found;
  gizmo.hover = key;
  refreshGizmo();
  draw();
  return !!found;
}

//! Taking hold. Everything the drag will need is measured NOW, against the
//! ray as it is at this instant: where along the axis the pointer reaches,
//! what angle it makes about the ring, how far out it is. The drag is then the
//! difference between that and the same measurement later, which is the only
//! way a number comes out in millimetres rather than in pixels.
function grabGizmoWidget(event) {
  if (!gizmoOn()) return false;
  let handle = gizmoUnder(event);
  if (!handle) return false;
  const entry = feature(state.selected);
  if (!moveable(entry)) return false;
  const ray = rayFrom(event).ray;
  const from = [ray.origin.x, ray.origin.y, ray.origin.z];
  const way = [ray.direction.x, ray.direction.y, ray.direction.z];
  // WHERE THE MEASUREMENTS ARE TAKEN FROM, fixed at the moment the handle is
  // taken hold of and not moved again until it is let go. The widget itself
  // slides along with the drag so the hand can see what it is doing - and if
  // the ruler slid with it, every frame would be measured from a point the
  // last frame had already moved, which is the drag running away from the
  // cursor. It is the same defect the sketcher had, and it is the same cure.
  const seat = gizmo.at.clone();
  const at = [seat.x, seat.y, seat.z];
  let was = null;
  if (handle.kind === "axis" || handle.kind === "grip")
    was = reachAlong(from, way, at, handle.dir);
  else if (handle.kind === "plane") was = landOn(from, way, at, handle.normal);
  else if (handle.kind === "ring")
    was = angleAbout(from, way, at, handle.dir, sideways(handle.dir));
  else if (handle.kind === "uniform") {
    const eye = [camera.position.x - gizmo.at.x, camera.position.y - gizmo.at.y,
                 camera.position.z - gizmo.at.z];
    const across = vUnit([-eye[1], eye[0], 0]) || [1, 0, 0];
    was = reachAlong(from, way, at, across);
    handle = { ...handle, across };
  }
  if (was === null || was === undefined) return false;

  // The node the numbers go on. Made now rather than on the first frame, so
  // the very first millimetre of the drag is already being written somewhere.
  const target = transformTarget(entry);
  gizmo.grab = { handle, from: was, seat, numbers: null, target, moved: false,
                 base: transformNow(entry.type === "Transform" ? entry : null, gizmo.mode) };
  gizmo.grab.numbers = { ...gizmo.grab.base };
  return true;
}

//! A direction square to an axis, for a ring to measure its angle from. Any
//! one will do as long as it is the same one for the whole drag.
const sideways = axis => vUnit([axis[1] - axis[2], axis[2] - axis[0], axis[0] - axis[1]])
  || [1, 0, 0];

function dragGizmoWidget(event) {
  const grab = gizmo.grab;
  if (!grab) return;
  const handle = grab.handle;
  const ray = rayFrom(event).ray;
  const from = [ray.origin.x, ray.origin.y, ray.origin.z];
  const way = [ray.direction.x, ray.direction.y, ray.direction.z];
  const at = [grab.seat.x, grab.seat.y, grab.seat.z];
  // Ctrl steps it. A tower that lands on 3000 rather than on 2987.4 is a tower
  // somebody can build, and holding a key is cheaper than typing the number in
  // afterwards.
  const fine = event.ctrlKey || event.metaKey;

  if (gizmo.mode === "move") {
    let by = [0, 0, 0];
    if (handle.kind === "axis") {
      const now = reachAlong(from, way, at, handle.dir);
      const step = stepped(now - grab.from, fine ? 10 : 0);
      by = handle.dir.map(v => v * step);
    } else {
      const now = landOn(from, way, at, handle.normal);
      if (!now) return;
      const moved = [now[0] - grab.from[0], now[1] - grab.from[1], now[2] - grab.from[2]];
      by = handle.along.map(axis => {
        const along = moved[0] * axis[0] + moved[1] * axis[1] + moved[2] * axis[2];
        return axis.map(v => v * stepped(along, fine ? 10 : 0));
      }).reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]);
    }
    grab.numbers = { dx: grab.base.dx + by[0], dy: grab.base.dy + by[1],
                     dz: grab.base.dz + by[2] };
  } else if (gizmo.mode === "rotate") {
    const now = angleAbout(from, way, at, handle.dir, sideways(handle.dir));
    if (now === null) return;
    const turned = shortestTurn(grab.from, now) * 180 / Math.PI;
    grab.from = now;
    grab.turned = (grab.turned || 0) + turned;
    const total = stepped(grab.turned, fine ? 5 : 0);
    grab.numbers = { rx: grab.base.rx, ry: grab.base.ry, rz: grab.base.rz };
    grab.numbers["r" + handle.key] = grab.base["r" + handle.key] + total;
  } else {
    const axis = handle.kind === "uniform" ? handle.across : handle.dir;
    const now = reachAlong(from, way, at, axis);
    const was = grab.from;
    // Measured as a RATIO from the middle, so pulling twice as far out is
    // twice the size whatever the widget's own size happens to be.
    const span = Math.max(gizmoSpan(), 1e-6);
    const factor = Math.max(0.01, (span + (now - was)) / span);
    grab.numbers = { factor: Math.max(0.01, grab.base.factor * (fine
      ? stepped(factor, 0.05) || 0.05 : factor)) };
  }
  grab.moved = true;
  showGizmoDrag();
  refreshGizmoBar();
}

//! Shown while the hand is still down, without writing anything: the shape
//! that is being moved is nudged in the viewport so the drag can be SEEN, and
//! the truth is written once, on the way up.
function showGizmoDrag() {
  const grab = gizmo.grab;
  const entry = feature(state.selected);
  if (!grab || !entry) return;
  const found = shapes.get(grab.target.make ? grab.target.over : entry.id)
             || shapes.get(entry.id);
  if (!found || !found.group) { draw(); return; }
  const n = grab.numbers, base = grab.base;
  const group = found.group;
  if (!group.userData.restAt) {
    group.userData.restAt = group.position.clone();
    group.userData.restTurn = group.quaternion.clone();
    group.userData.restSize = group.scale.clone();
  }
  const seat = gizmo.at;
  const move = new THREE.Vector3((n.dx || 0) - (base.dx || 0), (n.dy || 0) - (base.dy || 0),
                                 (n.dz || 0) - (base.dz || 0));
  const turn = new THREE.Euler(((n.rx || 0) - (base.rx || 0)) * Math.PI / 180,
                               ((n.ry || 0) - (base.ry || 0)) * Math.PI / 180,
                               ((n.rz || 0) - (base.rz || 0)) * Math.PI / 180, "XYZ");
  const size = (n.factor === undefined ? 1 : n.factor) / (base.factor || 1);
  const about = new THREE.Matrix4().makeTranslation(seat.x, seat.y, seat.z);
  const back = new THREE.Matrix4().makeTranslation(-seat.x, -seat.y, -seat.z);
  const whole = new THREE.Matrix4().makeTranslation(move.x, move.y, move.z)
    .multiply(about)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(turn))
    .multiply(new THREE.Matrix4().makeScale(size, size, size))
    .multiply(back);
  group.position.copy(group.userData.restAt);
  group.quaternion.copy(group.userData.restTurn);
  group.scale.copy(group.userData.restSize);
  group.applyMatrix4(whole);
  // The widget follows the hand, from the seat it was grabbed at - never from
  // where it is now, which is where it was put half a frame ago.
  if (gizmo.group) gizmo.group.position.copy(grab.seat).add(gizmo.mode === "move"
    ? move : new THREE.Vector3());
  draw();
}

//! Letting go. One edit for the whole drag, whatever it travelled through - so
//! it is one step to undo and one line in the file.
async function dropGizmoWidget() {
  const grab = gizmo.grab;
  gizmo.grab = null;
  if (!grab) return;
  // Put the nudged group back; the rebuild is the truth and it is on its way.
  for (const [, { group }] of shapes) {
    if (!group.userData.restAt) continue;
    group.position.copy(group.userData.restAt);
    group.quaternion.copy(group.userData.restTurn);
    group.scale.copy(group.userData.restSize);
    delete group.userData.restAt; delete group.userData.restTurn;
    delete group.userData.restSize;
  }
  gizmo.at = grab.seat.clone();
  if (!grab.moved) { refreshGizmo(); draw(); return; }
  const trim = v => Math.round(v * 1000) / 1000;
  const numbers = {};
  for (const [key, value] of Object.entries(grab.numbers)) numbers[key] = trim(value);
  try {
    gizmo.busy = true;
    let id = grab.target.id;
    if (grab.target.make) {
      const born = await edit({ op: "add", type: "Transform", refs: { shape: grab.target.over } });
      id = born && born.id;
      if (!id) throw new Error("the transform could not be made");
      select(id, false);
    }
    await mdl.runAll(Object.entries(numbers).map(([key, value]) =>
      ({ op: "set", id, key, value })));
  } catch (error) {
    showError(error.message);
  } finally {
    gizmo.busy = false;
  }
  refreshGizmo();
  draw();
}

/* ======================================================================
   LOOKING THROUGH A CAMERA.

   A camera in the tree is only half of it. The other half is being able to
   stand behind it: the viewport becomes the camera, the shot is framed to the
   shape it will be printed in rather than to the shape the window happens to
   be, and everything the hand does to the view is written back into the node
   on the way up. That is what makes a view a thing the document holds rather
   than a mood the window was in.

   THE RIG uses the words a camera crew uses, because they are the right
   words: drag orbits round what it is looking at, shift-drag trucks it
   sideways and pedestals it up, the wheel dollies in and out. A dolly is not a
   zoom - the lens does not move, the camera does, and everything behind the
   subject rushes past. That is the difference you are looking for.
   ====================================================================== */

const through = {
  id: null,          // the camera being looked through
  was: null,         // the view to hand back when you step out
  eye: null,
  target: null,
  shot: null,        // while a story is flying: the lens and frame it is at
  dirty: false,
  saving: false,
};

const lookingThrough = () => (through.id && feature(through.id)) || null;

//! Is this camera's position a thing we may write to? A camera wired to a
//! point follows the point, and shoving the view about must not quietly
//! unwire it.
function cameraFree(entry) {
  const refs = (entry && entry.refs) || {};
  return { eye: !refs.at, target: !refs.look };
}

//! WHAT THE HAND CAN DO IN HERE, said the same way in the bar and in the
//! status line - a camera that is wired to a pair of typed points is driven
//! exactly like a free one, because what moves is the points; one wired to
//! points that are worked out cannot be driven at all, and should say so
//! before the hand tries rather than after.
function throughWrites(entry) {
  const free = cameraFree(entry);
  const refs = (entry && entry.refs) || {};
  return (free.eye || movePoint(refs.at, [0, 0, 0]).length > 0)
      || (free.target || movePoint(refs.look, [0, 0, 0]).length > 0);
}

function saysRig(entry, wheel = true) {
  if (!throughWrites(entry))
    return entry.name + " follows points that are worked out rather than typed";
  return (altToOrbit ? "Alt: left tumbles, middle tracks, right dollies"
                     : "drag to orbit \u00b7 middle tracks \u00b7 right dollies")
       + (wheel ? " \u00b7 wheel to dolly" : "");
}

function cameraNumbers(entry) {
  const v = (entry && entry.values) || {};
  // A STORY FLYING BETWEEN TWO CAMERAS is not at either of them: it is at a
  // lens and a frame partway between, and the letterbox has to follow. So the
  // player may say what the shot is, and when it does not the node does.
  if (through.shot) return through.shot;
  const stand = shapeCentre(entry && entry.refs && entry.refs.at)
    || [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
  const look = shapeCentre(entry && entry.refs && entry.refs.look)
    || [Number(v.tx) || 0, Number(v.ty) || 0, Number(v.tz) || 0];
  return { eye: stand, target: look, lens: Number(v.lens) || 35,
           roll: Number(v.roll) || 0, frame: frameAt(v.frame), safe: safeAt(v.safe) };
}

//! MOVING THE POINT ITSELF, when the camera is wired to one. A camera whose
//! eye is a Point in the tree should still be draggable - what moves is the
//! point, which is the right answer: everything else wired to that point moves
//! with it, and the camera is where it says it is. Only a point that is TYPED
//! can be written to; one worked out from a curve is the curve's to say, and
//! shoving it would be shoving the wrong thing.
function movePoint(id, to) {
  const point = id && feature(id);
  if (!point || point.type !== "Point") return [];
  if ((point.values || {}).kind !== 0) return [];
  const refs = point.refs || {};
  if (refs.x || refs.y || refs.z) return [];      // driven by numbers wired in
  return ["x", "y", "z"].map((key, i) =>
    ({ op: "set", id, key, value: Math.round(to[i] * 100) / 100 }));
}

//! Where a wired point actually ended up, read off what it computed.
function shapeCentre(id) {
  const entry = id && feature(id);
  const preview = entry && entry.data && entry.data.preview;
  const first = preview && String(preview).match(/\(([^)]*)\)/);
  if (!first) return null;
  const p = first[1].split(",").map(Number);
  return p.length === 3 && p.every(Number.isFinite) ? p : null;
}

function lookThrough(id) {
  const entry = feature(id);
  if (!entry || entry.type !== "Camera") { say("that is not a camera"); return; }
  if (entry.error) { say(entry.name + " has not been built: " + entry.error); return; }
  if (!through.id) through.was = { target: view.target.clone(), distance: view.distance,
                                   yaw: view.yaw, pitch: view.pitch, fov: camera.fov };
  through.id = id;
  through.shot = null;
  const now = cameraNumbers(entry);
  through.eye = now.eye.slice();
  through.target = now.target.slice();
  through.dirty = false;
  placeThrough();
  refreshSafe();
  refreshCameraBar();
  layout();
  say("Looking through " + entry.name + " \u00b7 " + saysRig(entry, false)
      + " \u00b7 Esc to step out");
}

function leaveThrough(save = true) {
  if (!through.id) return;
  if (save && through.dirty) saveThrough();
  through.id = null;
  through.shot = null;
  camera.clearViewOffset();
  const wide = renderer.domElement.clientWidth || 1;
  camera.aspect = wide / (renderer.domElement.clientHeight || 1);
  if (through.was) {
    view.target.copy(through.was.target);
    view.distance = through.was.distance;
    view.yaw = through.was.yaw;
    view.pitch = through.was.pitch;
    camera.fov = through.was.fov;
    through.was = null;
  }
  placeCamera();
  refreshSafe();
  refreshCameraBar();
  layout();
  draw();
}

//! The viewport, standing where the camera stands. The yaw and pitch the
//! viewport thinks in are worked out from the pair of points, so stepping out
//! again leaves the orbit controls somewhere sensible rather than at nought.
function placeThrough() {
  const entry = lookingThrough();
  if (!entry) return;
  const now = cameraNumbers(entry);
  const eye = through.eye, target = through.target;
  const out = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
  const reach = Math.hypot(...out) || 1;
  view.target.set(target[0], target[1], target[2]);
  view.distance = reach;
  view.yaw = Math.atan2(out[1], out[0]);
  view.pitch = Math.asin(Math.max(-1, Math.min(1, out[2] / reach)));
  // THE LENS IS THE LENS INSIDE THE FRAME, not across the window. The window
  // is whatever shape it is; the shot is 16:9 in the middle of it, and the
  // camera's vertical angle belongs to the shot. So the renderer is opened up
  // by however much taller the window is than the frame, and the letterbox
  // puts it back.
  // THE SHOT LANDS ON THE FREE RECTANGLE, exactly. A camera's frame is its
  // own shape and the window is another, so the projection is offset: the
  // frame is the whole picture and the canvas is a window onto a bigger one,
  // which is what setViewOffset is for. Done this way the preview is the
  // photograph - the right lens, the right crop, in the right place - rather
  // than an approximation of it with the panels taking a bite out of the side.
  const box = safeBox(now.frame.ratio);
  const wide = renderer.domElement.clientWidth, tall = renderer.domElement.clientHeight;
  camera.fov = fovFromLens(now.lens);
  camera.aspect = now.frame.ratio;
  if (box.width > 1 && box.height > 1)
    camera.setViewOffset(box.width, box.height, -box.x, -box.y, wide, tall);
  placeCamera();
  // Roll: the one thing the orbit camera has no idea about.
  camera.rotateZ(-(now.roll || 0) * Math.PI / 180);
  camera.updateMatrixWorld();
  draw();
}

//! The rig. One function, because every one of these is the same shape of
//! thing: take the pair of points, do one named move to them, put them back.
function rigCamera(kind, a, b) {
  const entry = lookingThrough();
  if (!entry) return false;
  const now = cameraNumbers(entry);
  const view3 = frameOf(through.eye, through.target, 0);
  if (!view3) return false;
  const moved = kind === "orbit" ? orbitAbout(view3, a, b)
              : kind === "truck" ? truck(view3, a, b)
              : dolly(view3, a);
  if (!moved) return false;
  through.eye = moved.eye;
  through.target = moved.target;
  through.dirty = true;
  placeThrough();
  refreshCameraBar();
  return true;
}

//! Written back into the node, once, when the hand comes off. Six numbers and
//! one step to undo, whatever the view travelled through on the way.
async function saveThrough() {
  const entry = lookingThrough();
  if (!entry || through.saving) return;
  const free = cameraFree(entry);
  const numbers = fromView(through.eye, through.target);
  const edits = [];
  if (free.eye) for (const key of ["x", "y", "z"])
    edits.push({ op: "set", id: entry.id, key, value: numbers[key] });
  else edits.push(...movePoint((entry.refs || {}).at,
                               [numbers.x, numbers.y, numbers.z]));
  if (free.target) for (const key of ["tx", "ty", "tz"])
    edits.push({ op: "set", id: entry.id, key, value: numbers[key] });
  else edits.push(...movePoint((entry.refs || {}).look,
                               [numbers.tx, numbers.ty, numbers.tz]));
  if (!edits.length) {
    say(entry.name + " follows points that are worked out rather than typed - "
        + "the view moved, but there is nothing to write it into");
    return;
  }
  through.dirty = false;
  through.saving = true;
  try { await mdl.runAll(edits); } catch (error) { showError(error.message); }
  finally { through.saving = false; }
  refreshCameraBar();
}

//! The same, a moment after a gesture that has no end: the wheel. Held off
//! until the rolling stops so a dozen notches are one number and one undo.
let settling = 0;
function settleThrough() {
  clearTimeout(settling);
  settling = setTimeout(() => { if (lookingThrough() && through.dirty) saveThrough(); }, 420);
}

/* ------------------------------------------------------------ safe frames

   WHAT WILL ACTUALLY BE SEEN. A view is composed for something - a slide, a
   sheet, a phone - and composing it in whatever shape the window happens to be
   is how a scheme loses its own edges. So the frame is drawn, the rest is
   dimmed, and the two rectangles broadcast has used since television had
   rounded corners are drawn inside it: ninety per cent for anything that
   matters, eighty for anything with words in it.                           */

const safeLayer = document.createElement("div");
safeLayer.className = "safe-layer";
safeLayer.id = "safe-layer";
safeLayer.hidden = true;
viewportEl.appendChild(safeLayer);

//! The letterbox, in the free rectangle rather than in the whole window: a
//! shot composed under the definition panel is a shot with a panel in it.
function safeBox(ratio) {
  const rect = freeRect();
  const box = letterbox(rect.w, rect.h, ratio);
  return { x: rect.x + box.x, y: rect.y + box.y, width: box.width, height: box.height };
}

function refreshSafe() {
  const entry = lookingThrough();
  if (!entry) { safeLayer.hidden = true; return; }
  const now = cameraNumbers(entry);
  const box = safeBox(now.frame.ratio);
  const mode = now.safe;
  const pct = (v, of) => (v / of * 100).toFixed(4) + "%";
  const inner = (share, cls) => {
    const w = box.width * share, h = box.height * share;
    return '<div class="' + cls + '" style="left:' + ((box.width - w) / 2) + "px;top:"
      + ((box.height - h) / 2) + "px;width:" + w + "px;height:" + h + 'px"></div>';
  };
  safeLayer.hidden = false;
  // The narrative sits in the picture's own lower third, the way a subtitle
  // does - not over the black bar under it, where half of it would be cut off
  // by a projector that does not know the bar is there.
  captionLayer.style.bottom = story.presenting
    ? Math.max(8, innerHeight - (box.y + box.height) + 10) + "px" : "";
  safeLayer.innerHTML =
      '<div class="safe-mask" style="height:' + box.y + 'px;top:0"></div>'
    + '<div class="safe-mask" style="top:' + (box.y + box.height) + "px;bottom:0" + '"></div>'
    + '<div class="safe-mask" style="top:' + box.y + "px;height:" + box.height
      + "px;left:0;width:" + box.x + 'px"></div>'
    + '<div class="safe-mask" style="top:' + box.y + "px;height:" + box.height
      + "px;left:" + (box.x + box.width) + 'px;right:0"></div>'
    + '<div class="safe-shot" style="left:' + box.x + "px;top:" + box.y + "px;width:"
      + box.width + "px;height:" + box.height + 'px">'
    + (mode.action ? inner(ACTION_SAFE, "safe-in safe-action") : "")
    + (mode.title ? inner(TITLE_SAFE, "safe-in safe-title") : "")
    + (mode.thirds
        ? '<div class="safe-third" style="left:33.3333%"></div>'
          + '<div class="safe-third" style="left:66.6667%"></div>'
          + '<div class="safe-third safe-across" style="top:33.3333%"></div>'
          + '<div class="safe-third safe-across" style="top:66.6667%"></div>'
        : "")
    + '<span class="safe-tag">' + escapeHtml(entry.name) + " \u00b7 "
      + escapeHtml(saysShot(now.lens, now.frame.label,
          Math.hypot(through.eye[0] - through.target[0], through.eye[1] - through.target[1],
                     through.eye[2] - through.target[2])))
    + "</span></div>";
}

/* ------------------------------------------------------------- its own bar */

const cameraBar = document.createElement("section");
cameraBar.className = "float fades mx-bar cam-bar";
cameraBar.id = "camera-bar";
cameraBar.hidden = true;
document.body.appendChild(cameraBar);

function refreshCameraBar() {
  const entry = lookingThrough();
  const on = !!entry;
  if (cameraBar.hidden !== !on) { cameraBar.hidden = !on; layout(); }
  if (!on) return;
  const now = cameraNumbers(entry);
  const free = cameraFree(entry);
  cameraBar.innerHTML = '<div class="mx-row">'
    + '<span class="mx-tag">THROUGH</span>'
    + '<span class="mx-count">' + escapeHtml(entry.name) + "</span>"
    + '<span class="seg">'
    + FRAMES.map((one, i) => '<button data-cam-frame="' + i + '" aria-pressed="'
        + (now.frame.key === one.key ? "true" : "false") + '" title="'
        + escapeAttr(one.note) + '">' + escapeHtml(one.label) + "</button>").join("")
    + "</span>"
    + '<span class="cam-lens"><label>Lens</label>'
    + '<input type="range" data-cam-lens min="10" max="200" step="1" value="'
      + Math.round(now.lens) + '">'
    + "<i>" + Math.round(now.lens) + " mm</i></span>"
    + "</div>"
    + '<div class="mx-row mx-wrap">'
    + '<span class="seg">'
    + ["Off", "Safe", "Thirds", "Both"].map((label, i) =>
        '<button data-cam-safe="' + i + '" aria-pressed="'
        + (now.safe.key === ["off", "safe", "thirds", "both"][i] ? "true" : "false")
        + '">' + label + "</button>").join("")
    + "</span>"
    + '<span class="mx-hint">' + escapeHtml(saysRig(entry))
      + (through.dirty ? " \u00b7 <b>moved</b>" : "") + "</span>"
    + (through.dirty ? '<button data-cam-save>Keep it</button>'
                     : '<button data-cam-save disabled>Keep it</button>')
    + '<button data-cam-out>Step out \u00b7 Esc</button>'
    + "</div>";
}

cameraBar.addEventListener("click", event => {
  const entry = lookingThrough();
  if (!entry) return;
  const frame = event.target.closest("[data-cam-frame]");
  if (frame) { edit({ op: "set", id: entry.id, key: "frame",
                      value: Number(frame.dataset.camFrame) }); return; }
  const safe = event.target.closest("[data-cam-safe]");
  if (safe) { edit({ op: "set", id: entry.id, key: "safe",
                     value: Number(safe.dataset.camSafe) }); return; }
  if (event.target.closest("[data-cam-save]")) { saveThrough(); return; }
  if (event.target.closest("[data-cam-out]")) { leaveThrough(true); return; }
});

//! The bar writes to the node and the node comes back through the tree, so the
//! overlay is refreshed when the tree lands rather than when the button is
//! pressed - see the hook in syncShapes.
function followCamera() {
  if (!lookingThrough()) return;
  placeThrough();
  refreshSafe();
  refreshCameraBar();
}
cameraBar.addEventListener("input", event => {
  const entry = lookingThrough();
  const slide = event.target.closest("[data-cam-lens]");
  if (!entry || !slide) return;
  edit({ op: "set", id: entry.id, key: "lens", value: Number(slide.value) });
});

/* ======================================================================
   THE STORY.

   A scheme is not communicated by a model. It is communicated by a SEQUENCE -
   here is the site, here is the move, here is what that move buys you - and
   the model is only the thing the sequence is about. Every office rebuilds
   that sequence by hand in a slide deck, with screenshots that go stale the
   moment the model changes. This one lives in the model file and cannot.

   TWO KINDS OF CHANGE, and the difference is the whole of how it plays. A
   camera move is free - nothing is remade, the view is simply somewhere else
   next frame - so it is tweened every frame and it is smooth. A NUMBER is not
   free: setting one rebuilds the feature and everything downstream of it. So
   the clock keeps running and the value is whatever the clock says when the
   last rebuild landed. A massing that grows in eleven steps instead of a
   hundred and eighty still reads as a massing that grows, and nothing stalls
   waiting for a frame rate the kernel cannot hit.
   ====================================================================== */

const story = {
  id: null,            // the Story node being played
  beats: [],
  at: 0,
  clock: 0,
  playing: false,
  presenting: false,
  frame: 0,
  last: 0,
  busy: false,         // a rebuild is in flight; do not start another
};

const telling = () => (story.id && feature(story.id)) || null;
const storyOn = () => !!telling();

//! A code argument travels as `entry.code`, the way a Script's source does -
//! so a story is read off the same field the editor in the panel writes.
function storyBeats(entry) {
  return readStory((entry && entry.code) || "[]");
}

//! Opening a story: the beats are read, the first one is arrived at, and
//! nothing is playing yet. Pressing play is a separate decision.
function openStory(id) {
  const entry = feature(id);
  if (!entry || entry.type !== "Story") { say("that is not a story"); return; }
  story.id = id;
  story.beats = storyBeats(entry);
  story.playing = false;
  story.clock = 0;
  story.at = 0;
  if (!story.beats.length) {
    say(entry.name + " has no beats yet - press Add a beat with the view where you want it");
    refreshStoryBar();
    layout();
    return;
  }
  arriveAt(0);
  refreshStoryBar();
  layout();
}

function closeStory(leave = true) {
  story.playing = false;
  story.presenting = false;
  cancelAnimationFrame(story.frame);
  story.frame = 0;
  story.id = null;
  document.body.classList.remove("presenting");
  captionLayer.hidden = true;
  if (leave) leaveThrough(false);
  refreshStoryBar();
  layout();
  draw();
}

//! ARRIVING AT A BEAT: everything it and every beat before it asked for, in
//! one go. Jumping into the middle of a sequence has to land in the state the
//! sequence would have been in, not in whatever the last person left behind.
async function arriveAt(at) {
  const beat = story.beats[at];
  if (!beat) return;
  story.at = at;
  story.clock = startOf(story.beats, at);
  const want = stateAt(story.beats, at);

  // What is showing. Done first, because a beat that turns a massing on and
  // then flies to it should have it there when the flight starts.
  for (const id of want.hidden) state.hidden.add(id);
  for (const id of want.shown) state.hidden.delete(id);
  if (want.hidden.length || want.shown.length) { applyVisibility(); buildTree(); }

  // Where it is cut.
  if (want.section) {
    ensureCuts();
    for (const axis of SECTION_AXES) cutter.cuts[axis.key].on = axis.key === want.section.axis;
    cutter.cuts[want.section.axis].offset = want.section.at;
    cutter.cuts[want.section.axis].flipped = !!want.section.flipped;
    cutter.style = want.section.style;
    cutter.on = true;
    refreshSection();
  } else if (cutter.on) { cutter.on = false; refreshSection(); }

  // Where the camera is.
  flyTo(want.camera, want.camera, 1);
  // And the numbers, all the way to where they should be.
  await pushValues(want.values);
  showCaption();
  refreshStoryBar();
}

//! The shot at a moment: the beat before's camera, this beat's camera, and how
//! far between them. A beat with no camera of its own keeps the last one,
//! which is how a sequence sits still while a massing grows.
function flyTo(fromId, toId, t) {
  const to = feature(toId), was = feature(fromId) || to;
  if (!to || to.type !== "Camera") return;
  through.shot = null;
  const a = cameraNumbers(was && was.type === "Camera" ? was : to);
  const b = cameraNumbers(to);
  const mix = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t,
                         p[2] + (q[2] - p[2]) * t];
  // The lens is mixed in the log, because 24 to 200 through the middle is 70
  // and not 112 - a lens is a ratio, and the halfway point of a ratio is its
  // geometric mean.
  const lens = Math.exp(Math.log(Math.max(1, a.lens)) * (1 - t)
                      + Math.log(Math.max(1, b.lens)) * t);
  through.id = toId;
  through.shot = { eye: mix(a.eye, b.eye), target: mix(a.target, b.target), lens,
                   roll: a.roll + (b.roll - a.roll) * t,
                   frame: t < 0.5 ? a.frame : b.frame,
                   safe: story.presenting ? safeAt(0) : b.safe };
  through.eye = through.shot.eye;
  through.target = through.shot.target;
  through.dirty = false;
  if (!through.was) through.was = { target: view.target.clone(), distance: view.distance,
                                    yaw: view.yaw, pitch: view.pitch, fov: camera.fov };
  placeThrough();
  refreshSafe();
}

//! Numbers, pushed at the model. One batch, and never a second while the first
//! is still in flight - the clock will have moved on by the time it lands and
//! the next batch will be the one the clock asks for then.
async function pushValues(values) {
  const edits = [];
  for (const [key, value] of Object.entries(values || {})) {
    const [id, name] = key.split(".");
    const entry = feature(id);
    if (!entry || !Number.isFinite(value)) continue;
    const now = (entry.values || {})[name];
    if (Number.isFinite(now) && Math.abs(now - value) < 1e-4) continue;
    edits.push({ op: "set", id, key: name, value: Math.round(value * 1000) / 1000 });
  }
  if (!edits.length) return;
  story.busy = true;
  try { await mdl.runAll(edits); } catch (error) { /* a beat naming a gone feature */ }
  finally { story.busy = false; }
}

/* ------------------------------------------------------------- the clock */

function playStory(on) {
  if (!storyOn() || !story.beats.length) return;
  story.playing = on === undefined ? !story.playing : !!on;
  if (story.playing) {
    if (story.clock >= timeline(story.beats).seconds - 1e-6) story.clock = 0;
    story.last = performance.now();
    tickStory();
  } else {
    cancelAnimationFrame(story.frame);
    story.frame = 0;
  }
  refreshStoryBar();
}

function tickStory() {
  story.frame = requestAnimationFrame(tickStory);
  if (!story.playing || !storyOn()) return;
  const now = performance.now();
  const entry = telling();
  const speed = Math.max(0.05, Number((entry.values || {}).speed) || 1);
  story.clock += (now - story.last) / 1000 * speed;
  story.last = now;

  const line = timeline(story.beats);
  if (story.clock >= line.seconds) {
    story.clock = line.seconds;
    story.playing = false;
    cancelAnimationFrame(story.frame);
    story.frame = 0;
    refreshStoryBar();
    return;
  }
  const moment = momentAt(story.beats, story.clock);
  if (!moment) return;
  const arrived = moment.at !== story.at;
  story.at = moment.at;

  // Everything the beat switches on or off happens as its flight begins.
  if (arrived) {
    const want = stateAt(story.beats, moment.at);
    for (const id of want.hidden) state.hidden.add(id);
    for (const id of want.shown) state.hidden.delete(id);
    if (want.hidden.length || want.shown.length) applyVisibility();
    if (want.section) {
      ensureCuts();
      for (const axis of SECTION_AXES) cutter.cuts[axis.key].on = axis.key === want.section.axis;
      cutter.cuts[want.section.axis].offset = want.section.at;
      cutter.style = want.section.style;
      cutter.on = true;
      refreshSection();
    } else if (cutter.on) { cutter.on = false; refreshSection(); }
    showCaption();
  }

  // The camera, every frame, because it is free.
  const before = stateAt(story.beats, moment.at - 1).camera;
  const here = stateAt(story.beats, moment.at).camera;
  if (here) flyTo(before || here, here, moment.flying ? moment.t : 1);

  // And the numbers, whenever the last push has landed.
  if (!story.busy) {
    const live = {};
    for (const key of Object.keys(story.beats[moment.at].set || {})) {
      const [id, name] = key.split(".");
      const found = feature(id);
      if (found) live[key] = (found.values || {})[name];
    }
    const want = valuesBetween(story.beats, moment.at, moment.flying ? moment.t : 1, live);
    if (Object.keys(want).length) pushValues(want);
  }
  refreshStoryClock();
  draw();
}

const stepStory = by => {
  if (!storyOn() || !story.beats.length) return;
  story.playing = false;
  cancelAnimationFrame(story.frame);
  story.frame = 0;
  arriveAt(Math.max(0, Math.min(story.beats.length - 1, story.at + by)));
};

/* ----------------------------------------------------- presenting it

   FULL SCREEN, with the narrative underneath and nothing else. A presentation
   is a thing you hand to a room; a toolbar in the corner of it is a toolbar
   the room is reading instead of the drawing.                              */

const captionLayer = document.createElement("div");
captionLayer.className = "caption-layer";
captionLayer.id = "caption-layer";
captionLayer.hidden = true;
document.body.appendChild(captionLayer);

function showCaption() {
  const entry = telling();
  const beat = story.beats[story.at];
  if (!entry || !beat || (entry.values || {}).captions === 1) {
    captionLayer.hidden = true;
    return;
  }
  const line = timeline(story.beats);
  captionLayer.hidden = false;
  captionLayer.innerHTML =
      '<div class="caption-bar"><span style="width:' + (line.seconds
        ? (story.clock / line.seconds * 100).toFixed(2) : 0) + '%"></span></div>'
    + '<div class="caption-body">'
    + '<h3>' + escapeHtml(beat.name) + "</h3>"
    + (beat.text ? "<p>" + escapeHtml(beat.text) + "</p>" : "")
    + '<div class="caption-dots">'
    + story.beats.map((one, i) => '<button data-beat="' + i + '" aria-pressed="'
        + (i === story.at ? "true" : "false") + '" title="' + escapeAttr(one.name)
        + '"></button>').join("")
    + "</div></div>";
}

function refreshStoryClock() {
  const bar = captionLayer.querySelector(".caption-bar span");
  const line = timeline(story.beats);
  if (bar && line.seconds)
    bar.style.width = (story.clock / line.seconds * 100).toFixed(2) + "%";
  const clock = storyBar.querySelector("[data-story-clock]");
  if (clock) clock.textContent = story.clock.toFixed(1) + " / " + line.seconds.toFixed(1) + " s";
}

captionLayer.addEventListener("click", event => {
  const dot = event.target.closest("[data-beat]");
  if (dot) arriveAt(Number(dot.dataset.beat));
});

function presentStory(on) {
  if (!storyOn()) return;
  story.presenting = on === undefined ? !story.presenting : !!on;
  document.body.classList.toggle("presenting", story.presenting);
  setBare(story.presenting);
  if (story.presenting) { arriveAt(story.at); playStory(true); }
  else { story.playing = false; cancelAnimationFrame(story.frame); story.frame = 0; }
  refreshSafe();
  refreshStoryBar();
  layout();
}

/* ---------------------------------------------------------- writing one */

//! A BEAT FROM WHERE YOU ARE. The camera you are looking through, or a new one
//! standing exactly where the view is - because "add a beat here" has to work
//! the first time, before anybody has made a camera at all.
async function addBeatHere() {
  const entry = telling();
  if (!entry) return;
  let shot = through.id;
  if (!shot) {
    const eye = camera.position, aim = view.target;
    const lens = Math.max(6, Math.round(lensFromFov(camera.fov || 38)));
    const born = await edit({ op: "add", type: "Camera",
                              name: "Shot " + (story.beats.length + 1) });
    shot = born && born.id;
    if (!shot) return;
    const numbers = fromView([eye.x, eye.y, eye.z], [aim.x, aim.y, aim.z]);
    await mdl.runAll([...Object.entries(numbers).map(([key, value]) =>
      ({ op: "set", id: shot, key, value })),
      { op: "set", id: shot, key: "lens", value: lens }]);
  }
  const beats = [...story.beats,
    beatFromHere("Beat " + (story.beats.length + 1), shot, "")];
  await edit({ op: "code", id: entry.id, key: "beats", text: writeStory(beats) });
  story.beats = beats;
  arriveAt(beats.length - 1);
}

async function writeBeats(beats) {
  const entry = telling();
  if (!entry) return;
  story.beats = beats;
  await edit({ op: "code", id: entry.id, key: "beats", text: writeStory(beats) });
  refreshStoryBar();
}

/* ------------------------------------------------------------- its own bar */

const storyBar = document.createElement("section");
storyBar.className = "float fades mx-bar st-bar";
storyBar.id = "story-bar";
storyBar.hidden = true;
document.body.appendChild(storyBar);

function refreshStoryBar() {
  const entry = telling();
  const on = !!entry && !story.presenting;
  if (storyBar.hidden !== !on) { storyBar.hidden = !on; layout(); }
  if (!on) return;
  const line = timeline(story.beats);
  storyBar.innerHTML = '<div class="mx-row">'
    + '<span class="mx-tag">STORY</span>'
    + '<span class="mx-count">' + escapeHtml(entry.name) + "</span>"
    + '<button data-story-step="-1" title="The beat before">\u2039</button>'
    + '<button data-story-play aria-pressed="' + (story.playing ? "true" : "false") + '">'
      + (story.playing ? "Pause" : "Play") + "</button>"
    + '<button data-story-step="1" title="The next beat">\u203a</button>'
    + '<span class="mx-num" data-story-clock>' + story.clock.toFixed(1) + " / "
      + line.seconds.toFixed(1) + " s</span>"
    + '<button data-story-present>Present</button>'
    + '<button data-story-close>Done</button>'
    + "</div>"
    + '<div class="mx-row mx-wrap st-beats">'
    + (story.beats.length
        ? story.beats.map((one, i) => '<button data-beat-go="' + i + '" aria-pressed="'
            + (i === story.at ? "true" : "false") + '">' + (i + 1) + ". "
            + escapeHtml(one.name) + "</button>").join("")
        : '<span class="mx-hint">no beats yet</span>')
    + '<button data-beat-add>+ Beat from this view</button>'
    + (story.beats.length ? '<button data-beat-up>\u2191</button>'
        + '<button data-beat-down>\u2193</button>'
        + '<button data-beat-drop>Remove</button>' : "")
    + "</div>";
}

storyBar.addEventListener("click", async event => {
  const step = event.target.closest("[data-story-step]");
  if (step) { stepStory(Number(step.dataset.storyStep)); return; }
  if (event.target.closest("[data-story-play]")) { playStory(); return; }
  if (event.target.closest("[data-story-present]")) { presentStory(true); return; }
  if (event.target.closest("[data-story-close]")) { closeStory(true); return; }
  const go = event.target.closest("[data-beat-go]");
  if (go) { arriveAt(Number(go.dataset.beatGo)); return; }
  if (event.target.closest("[data-beat-add]")) { addBeatHere(); return; }
  if (event.target.closest("[data-beat-up]")) {
    await writeBeats(moveBeat(story.beats, story.at, -1));
    story.at = Math.max(0, story.at - 1); arriveAt(story.at); return;
  }
  if (event.target.closest("[data-beat-down]")) {
    await writeBeats(moveBeat(story.beats, story.at, 1));
    story.at = Math.min(story.beats.length - 1, story.at + 1); arriveAt(story.at); return;
  }
  if (event.target.closest("[data-beat-drop]")) {
    const beats = story.beats.filter((one, i) => i !== story.at);
    await writeBeats(beats);
    if (beats.length) arriveAt(Math.min(story.at, beats.length - 1));
    else { story.at = 0; refreshStoryBar(); }
  }
});

/* ======================================================================
   THE SECTION.

   Not a debugging aid - the drawing. A plan is a horizontal cut at a metre and
   a half, a section is a vertical one through the thing you care about, and
   whether either of them READS is entirely a question of how the cut face is
   drawn. So there is a plane you drag and there is a style, and the style is
   the half that matters: open, capped, poche, outline.

   THE FILL IS A STENCIL. There is no such thing as "the cut face" in the
   model - clipping a triangle leaves a hole, not a lid. What fills it is the
   oldest trick in the book: count back faces up and front faces down into the
   stencil buffer, and wherever the count is not nought the camera is looking
   through solid, so a quad drawn on the plane is the inside of the building.
   That is why a cap needs no geometry and works on anything, however it was
   built.

   THE LINE IS NOT. A fill has no edge and the edge is what makes it a drawing,
   so the cut line is worked out exactly, from the triangles: where the plane
   crosses each one is a segment, and the segments are the line.
   ====================================================================== */

const cutter = {
  on: false,
  cuts: null,               // per axis: { on, flipped, offset, travel }
  style: "capped",          // the default every object inherits
  ribbons: [],              // the cut lines' materials, told the screen size
  hatches: [],              // the cut faces' textures, told how far away they are
  group: null,              // the caps, the outlines and the handles
  planes: new Map(),        // axis key -> THREE.Plane, kept so a drag is cheap
  live: [],                 // the ones in force, for a shape that lands later
  grab: null,
  hover: null,
};

const sectioning = () => cutter.on && activePlanes(cutter.cuts).length > 0;

//! The model's own extents, which is what a plane's travel is measured
//! against: a slider from -1000 to 1000 is no use on a building.
function modelBox() {
  const box = sceneBounds();
  if (!box || box.isEmpty()) return null;
  return { low: [box.min.x, box.min.y, box.min.z], high: [box.max.x, box.max.y, box.max.z],
           span: box.getSize(new THREE.Vector3()).length() };
}

function ensureCuts() {
  const box = modelBox();
  const low = box ? box.low : [-500, -500, 0], high = box ? box.high : [500, 500, 1000];
  cutter.cuts = cutter.cuts ? refit(cutter.cuts, low, high) : freshCuts(low, high);
  return cutter.cuts;
}

//! Hatching, drawn rather than shipped: forty-five degree lines on a small
//! canvas, repeated across the cut face. Poche is a convention about DENSITY
//! more than about colour, so the lines are thin and close and the paper
//! behind them does the rest.
/* ------------------------------------------------------------ the patterns

   Drawn rather than shipped. Each one is a few strokes on a small canvas,
   repeated across the cut face - so they cost nothing, they take the object's
   own colours, and a new one is four lines here rather than a file somebody
   has to remember to ship.

   A pattern is CACHED BY WHAT IT IS: the pattern, the two colours and the
   scale, so nine objects hatched the same way share one texture and moving a
   section plane makes none.                                                */

/* A TILE HOLDS SIX OF WHATEVER IT IS. Said once, here, because the density on
   screen is worked out from it: six lines in a tile means a tile has to be six
   times the line spacing, and a number that is true in two places is a number
   that gets changed in one of them. */
const HATCH_TILE = 72;
//! How far apart the lines of a hatch should be ON THE SCREEN, in pixels, at
//! scale 1. A drawing's hatch is a density, not a size.
const HATCH_PITCH = 9;

const patterns = new Map();

function patternTexture(kind, ink, paper, tile) {
  const key = [kind, ink, paper, tile.slice(0, 64)].join("|");
  const had = patterns.get(key);
  if (had) return had;

  const size = HATCH_TILE;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const pen = canvas.getContext("2d");
  if (paper) { pen.fillStyle = paper; pen.fillRect(0, 0, size, size); }
  pen.strokeStyle = ink;
  pen.fillStyle = ink;
  const step = size / HATCH_MOTIFS;
  pen.lineWidth = Math.max(1, step / 7);

  //! One way or the other, and they really are the other: written as a start
  //! corner that swapped with the direction, both came out at the SAME forty-
  //! five degrees - so a cross-hatch was a diagonal hatch drawn twice and
  //! concrete and blockwork were the same poche.
  const rake = way => {
    pen.beginPath();
    for (let i = -size * 2; i < size * 3; i += step) {
      pen.moveTo(i, -size);
      pen.lineTo(i + way * size * 3, size * 2);
    }
    pen.stroke();
  };
  const bars = across => {
    pen.beginPath();
    for (let i = 0; i < size; i += step) {
      if (across) { pen.moveTo(0, i); pen.lineTo(size, i); }
      else { pen.moveTo(i, 0); pen.lineTo(i, size); }
    }
    pen.stroke();
  };

  if (kind === "solid") { pen.fillStyle = paper || ink; pen.fillRect(0, 0, size, size); }
  else if (kind === "diagonal") rake(1);
  else if (kind === "backslash") rake(-1);
  else if (kind === "cross") { rake(1); rake(-1); }
  else if (kind === "grid") { bars(true); bars(false); }
  else if (kind === "horizontal") bars(true);
  else if (kind === "vertical") bars(false);
  else if (kind === "dots") {
    const r = Math.max(1, step * 0.17);
    for (let y = step / 2; y < size; y += step)
      for (let x = step / 2; x < size; x += step) {
        pen.beginPath(); pen.arc(x, y, r, 0, Math.PI * 2); pen.fill();
      }
  } else if (kind === "brick") {
    // A running bond: courses, and the perpends offset half a brick on every
    // other one. The oldest pattern on any drawing there has ever been.
    const course = size / 4, brick = size / 2;
    pen.beginPath();
    for (let y = 0, row = 0; y <= size; y += course, row++) {
      pen.moveTo(0, y); pen.lineTo(size, y);
      for (let x = (row % 2 ? brick / 2 : 0); x <= size; x += brick) {
        pen.moveTo(x, y); pen.lineTo(x, y + course);
      }
    }
    pen.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // How many of the motif are in one tile, so the density on screen can be
  // worked out from it rather than guessed at.
  texture.userData = { key };
  // A PICTURE OF YOUR OWN, tiled. Loaded over the top of whatever was drawn,
  // so a tile that has not arrived yet shows the pattern underneath rather
  // than a blank cut face.
  if (kind === "image" && tile) {
    const picture = new Image();
    picture.onload = () => {
      const fit = document.createElement("canvas");
      fit.width = fit.height = 128;
      fit.getContext("2d").drawImage(picture, 0, 0, 128, 128);
      texture.image = fit;
      texture.needsUpdate = true;
      refreshSection();
    };
    picture.src = tile;
  }
  // A cache with no lid fills up; nine hundred textures is a leak, not a
  // cache. The oldest goes when it does.
  if (patterns.size > 48) {
    const first = patterns.keys().next().value;
    const old = patterns.get(first);
    patterns.delete(first);
    if (old) old.dispose();
  }
  patterns.set(key, texture);
  return texture;
}

//! A line with weight, which WebGL will not draw: a ribbon, expanded sideways
//! in the cut plane by exactly as many PIXELS as the weight says. The width is
//! the shader's, so the ribbon never has to be rebuilt when the camera moves.
function ribbonMaterial(colour, weight) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ink: { value: new THREE.Color(colour) },
      weight: { value: weight },
      screen: { value: new THREE.Vector2(1, 1) },
    },
    transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: [
      "attribute vec3 offset;",
      "attribute float side;",
      "uniform float weight;",
      "uniform vec2 screen;",
      "void main() {",
      "  vec4 here = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
      "  vec4 there = projectionMatrix * modelViewMatrix * vec4(position + offset, 1.0);",
      // Where the sideways direction points ON THE SCREEN, which is the only
      // place a line weight in pixels means anything.
      "  vec2 a = here.xy / max(1e-6, here.w) * screen;",
      "  vec2 b = there.xy / max(1e-6, there.w) * screen;",
      "  vec2 way = b - a;",
      "  float len = length(way);",
      "  vec2 unitWay = len > 1e-6 ? way / len : vec2(1.0, 0.0);",
      "  here.xy += unitWay * side * weight * 0.5 / screen * here.w;",
      "  gl_Position = here;",
      "}",
    ].join("\n"),
    fragmentShader: [
      "uniform vec3 ink;",
      "void main() { gl_FragColor = vec4(ink, 1.0); }",
    ].join("\n"),
  });
}

//! The two extra copies of a shape that do the counting. Nothing of them is
//! ever seen: they write only to the stencil buffer.
//!
//! HANDED BACK AS A PAIR, NOT AS A GROUP. A Group's own renderOrder becomes
//! the group order of everything under it, and the sort is by group order
//! FIRST - so two counting copies wrapped in a Group of renderOrder nought
//! rendered before every lid whatever their own renderOrder said. Every
//! object's count went into the stencil, the first lid drew over all of them
//! and wrote depth, and the rest were rejected as coplanar. Which looked
//! exactly like one pattern for the whole model, and was.
function stencilCopies(geometry, plane, order) {
  const base = new THREE.MeshBasicMaterial({
    depthWrite: false, depthTest: false, colorWrite: false,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc });

  const backs = base.clone();
  backs.side = THREE.BackSide;
  backs.clippingPlanes = [plane];
  backs.stencilFail = THREE.IncrementWrapStencilOp;
  backs.stencilZFail = THREE.IncrementWrapStencilOp;
  backs.stencilZPass = THREE.IncrementWrapStencilOp;
  const back = new THREE.Mesh(geometry, backs);
  back.renderOrder = order;

  const fronts = base.clone();
  fronts.side = THREE.FrontSide;
  fronts.clippingPlanes = [plane];
  fronts.stencilFail = THREE.DecrementWrapStencilOp;
  fronts.stencilZFail = THREE.DecrementWrapStencilOp;
  fronts.stencilZPass = THREE.DecrementWrapStencilOp;
  const front = new THREE.Mesh(geometry, fronts);
  front.renderOrder = order;
  return [back, front];
}

//! Every clipping plane, as three.js wants them, kept between frames so a drag
//! only has to move a constant rather than rebuild the world.
function livePlanes() {
  const out = [];
  for (const cut of activePlanes(cutter.cuts)) {
    let plane = cutter.planes.get(cut.key);
    if (!plane) { plane = new THREE.Plane(); cutter.planes.set(cut.key, plane); }
    plane.normal.set(cut.normal[0], cut.normal[1], cut.normal[2]);
    plane.constant = cut.constant;
    out.push(plane);
  }
  for (const key of [...cutter.planes.keys()])
    if (!out.some(p => cutter.planes.get(key) === p)) cutter.planes.delete(key);
  return out;
}

//! The planes handed to every material that draws the model, and to nothing
//! else. Local clipping rather than global, so the widgets, the grid and the
//! section's own handles are not cut in half by the cutter.
function clipGroup(group, planes) {
  group.traverse(object => {
    const material = object.material;
    if (!material) return;
    for (const one of Array.isArray(material) ? material : [material]) {
      one.clippingPlanes = planes.length ? planes : null;
      one.clipShadows = true;
      one.needsUpdate = true;
    }
  });
}

function applyClipping(planes) {
  renderer.localClippingEnabled = planes.length > 0;
  //! KEPT, because the model is no longer all here at once. A shape fetched
  //! after the cut was made has a material of its own, made minutes later by
  //! a camera move, and it has to be born clipped or it stands there whole
  //! among the cut ones with no cap on it. That is what "one cut made several
  //! pieces of strange geometry" was: half a building clipped and half of it
  //! not, and caps drawn for only the half that existed when the plane went
  //! through.
  cutter.live = planes.length ? planes : [];
  for (const [, { group }] of shapes) clipGroup(group, planes);
}

function clearSection() {
  if (!cutter.group) return;
  world.remove(cutter.group);
  disposeGroup(cutter.group);
  cutter.group = null;
}

//! Built whenever the cut moves, the style changes or the model does.
function refreshSection() {
  clearSection();
  if (!cutter.on) { applyClipping([]); refreshSectionBar(); draw(); return; }
  ensureCuts();
  const planes = livePlanes();
  applyClipping(planes);
  if (!planes.length) { refreshSectionBar(); draw(); return; }

  const box = modelBox();
  const span = box ? Math.max(box.span, 1) : 1000;
  const group = new THREE.Group();
  // NOT given a renderOrder of its own: a Group's renderOrder becomes the
  // group order of everything under it and the sort is by group order first,
  // which would flatten every renderOrder set below into one bucket.
  const ribbons = [], hatches = [];
  const cuts = activePlanes(cutter.cuts);
  cuts.forEach((cut, i) => {
    const plane = planes[i];
    const others = planes.filter(p => p !== plane);
    const order = (i + 1) * 4;

    // ONE OBJECT AT A TIME, because a drawing does not hatch everything the
    // same. Concrete is one poche, blockwork another, glass is not hatched at
    // all - so each object's cut face is counted into the stencil on its own,
    // given its own lid, and the count cleared before the next one. It costs
    // one pass per object per plane, which on a model with twenty solids in it
    // is twenty passes and nothing anybody can see.
    let drawn = 0, total = 0, at = order;
    for (const [id, { group: shapeGroup }] of shapes) {
      if (!shapeGroup.visible || !shapeGroup.userData.solid) continue;
      const one = feature(id);
      if (!one) continue;
      const cut = cutStyleOf(one.appearance, cutter.style, setsAbove(id));
      const paper = cut.fill ? hexOf(cut.fill) : "#" + THEME["cut-fill"].getHexString();
      const ink = cut.ink ? hexOf(cut.ink) : "#" + THEME["cut-line"].getHexString();

      if (cut.pattern !== "none") {
        shapeGroup.traverse(object => {
          if (!object.isMesh || object.userData.datum || object.userData.hardEdge
              || !object.geometry) return;
          for (const copy of stencilCopies(object.geometry, plane, at)) group.add(copy);
        });
        const lid = new THREE.Mesh(new THREE.PlaneGeometry(span * 2.5, span * 2.5),
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            map: patternTexture(cut.pattern, ink, paper, cut.tile),
            side: THREE.DoubleSide, clippingPlanes: others.length ? others : null,
            stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
            stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp,
            stencilZPass: THREE.ReplaceStencilOp }));
        // A HATCH IS A DENSITY ON THE PAPER, not a size in the model. Hatched
        // at a fixed count of repeats it went flat grey the moment the camera
        // pulled back - every tile smaller than a pixel, and the mipmap
        // averaging concrete and blockwork into the same nothing. So the
        // repeat is worked out from how far away the camera is, and worked out
        // again whenever it moves: a tile stays about the size of a tile.
        //
        // Its own texture, cloned off the cached one, because two objects
        // hatched the same way are at different distances and a repeat belongs
        // to the lid rather than to the pattern.
        const motifs = motifsOf(cut.pattern);
        lid.material.map = lid.material.map.clone();
        lid.material.map.needsUpdate = true;
        lid.material.map.anisotropy = Math.min(8,
          renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
        if (cut.angle) {
          lid.material.map.center.set(0.5, 0.5);
          lid.material.map.rotation = cut.angle * Math.PI / 180;
        }
        // How big ONE TILE has to be on screen for its lines to be the right
        // distance apart. A picture of your own is one motif and wants to be
        // far bigger - a photograph repeated a hundred times is a texture
        // nobody can read.
        hatches.push({ map: lid.material.map, span,
                       grain: motifs * (cut.pattern === "image" ? 110 : HATCH_PITCH)
                              * cut.scale });
        lid.renderOrder = at + 1;
        lid.onAfterRender = () => renderer.clearStencil();
        lid.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
        lid.position.copy(plane.normal).multiplyScalar(-plane.constant);
        group.add(lid);
        drawn++;
      }

      if (cut.line !== "none") {
        // The exact line of THIS object's cut, off its own triangles.
        const stream = streams.get(id);
        if (stream && stream.positions && stream.index) {
          const face = { normal: [plane.normal.x, plane.normal.y, plane.normal.z],
                         constant: plane.constant };
          let flat = sectionEdges(stream.positions, stream.index, face, []);
          total += cutLength(flat);
          const dash = lineNamed(cut.line);
          if (dash.dash) flat = dashSegments(flat, span * dash.dash / 1000,
            dash.gap ? dash.dash / (dash.dash + dash.gap) : 1,
            dash.second ? span * dash.second / 1000 : 0);
          if (flat.length) {
            const ribbon = ribbonOf(flat, face.normal);
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position",
              new THREE.Float32BufferAttribute(ribbon.position, 3));
            geometry.setAttribute("offset", new THREE.Float32BufferAttribute(ribbon.offset, 3));
            geometry.setAttribute("side", new THREE.Float32BufferAttribute(ribbon.side, 1));
            geometry.setIndex(ribbon.index);
            const material = ribbonMaterial(ink, cut.weight);
            material.clippingPlanes = others.length ? others : null;
            const line = new THREE.Mesh(geometry, material);
            line.frustumCulled = false;
            line.renderOrder = at + 2;
            // A HAIR TOWARDS THE CAMERA. The line and the cap are the same
            // plane, and two things in the same plane fight over which is in
            // front - so the line is lifted onto the removed side, where
            // nothing else is.
            line.position.copy(plane.normal).multiplyScalar(-span * 2e-4);
            group.add(line);
            ribbons.push(material);
          }
        }
      }
      at += 4;
    }
    cutter.cutLength = total;
    cutter.capped = drawn;

    // THE HANDLE. A square outline on the plane with a knob in the middle,
    // dragged along the normal - which is the only direction a section plane
    // has anywhere to go.
    const [u, v] = acrossOf([plane.normal.x, plane.normal.y, plane.normal.z]);
    const half = span * 0.42;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
      new THREE.Vector3(...[0, 1, 2].map(k => u[k] * a * half + v[k] * b * half)));
    const seat = new THREE.Vector3().copy(plane.normal).multiplyScalar(-plane.constant);
    const lit = cutter.hover === cut.key || (cutter.grab && cutter.grab.key === cut.key);
    const frame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(corners.map(p => p.clone().add(seat))),
      new THREE.LineDashedMaterial({ color: lit ? 0xf2b134 : THEME.datum,
        dashSize: span * 0.02, gapSize: span * 0.015, depthTest: false,
        transparent: true, opacity: lit ? 0.95 : 0.55 }));
    frame.computeLineDistances();
    frame.renderOrder = 12;
    group.add(frame);

    const knob = new THREE.Mesh(
      new THREE.ConeGeometry(span * 0.022, span * 0.06, 16),
      new THREE.MeshBasicMaterial({ color: lit ? 0xf2b134 : THEME.accent,
        depthTest: false, transparent: true, opacity: 0.95 }));
    // Pointing the way the plane pushes, sat on the middle of one edge of the
    // frame - a corner is where two edges meet and reads as neither.
    knob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), plane.normal.clone().negate());
    knob.position.copy(seat).addScaledVector(new THREE.Vector3(...u), half);
    knob.userData.cut = cut.key;
    knob.renderOrder = 13;
    group.add(knob);
  });

  cutter.group = group;
  cutter.ribbons = ribbons;
  cutter.hatches = hatches;
  sizeRibbons();
  sizeHatches();
  world.add(group);
  refreshSectionBar();
  draw();
}

//! A line weight is in pixels, so every ribbon has to be told how many pixels
//! the window is. Once when it is built, and again whenever the window changes
//! shape; nothing else moves it.
function sizeRibbons() {
  const wide = renderer.domElement.clientWidth || 1;
  const tall = renderer.domElement.clientHeight || 1;
  for (const material of cutter.ribbons || [])
    material.uniforms.screen.value.set(wide, tall);
}

//! And every hatch has to be told how far away it is, for the same reason: a
//! hatch is a density on the paper. Cheap - two numbers per lid - so it runs
//! with the camera rather than with the section.
function sizeHatches() {
  const list = cutter.hatches;
  if (!list || !list.length) return;
  const tall = renderer.domElement.clientHeight || 1;
  const reach = Math.max(view.distance, 1e-3);
  // How many world units one pixel covers at the target's distance.
  const perPixel = 2 * reach * Math.tan(camera.fov * Math.PI / 360) / tall;
  for (const one of list) {
    const wanted = Math.max(1e-6, one.grain * perPixel);   // world units per tile
    const repeat = Math.max(3, Math.min(600, one.span * 2.5 / wanted));
    one.map.repeat.set(repeat, repeat);
  }
}

//! Switching the whole thing on and off. The first time it is asked for, the
//! level cut comes on with it - a section with no plane switched on is a
//! section that looks broken.
function toggleSection(force) {
  const want = force === undefined ? !cutter.on : !!force;
  cutter.on = want;
  ensureCuts();
  if (want && !activePlanes(cutter.cuts).length) cutter.cuts.z.on = true;
  //! A CUT IS THROUGH THE WHOLE MODEL, including the parts of it the camera
  //! has not asked for yet - a cap that stops where the stand-ins begin is a
  //! drawing of the wrong building. So this is the one place that waits.
  if (want && unmeshed.size) makeResident("Cutting the model\u2026").then(refreshSection);
  else refreshSection();
  layout();
}

function setCut(axis, changes) {
  ensureCuts();
  const was = cutter.on;
  Object.assign(cutter.cuts[axis], changes);
  if (!cutter.on && changes.on) cutter.on = true;
  //! Switched on from the section bar rather than from the button, which is
  //! the same decision and needs the same whole model behind it.
  if (!was && cutter.on && unmeshed.size) {
    makeResident("Cutting the model\u2026").then(refreshSection);
    return;
  }
  refreshSection();
}

/* ------------------------------------------------------------ its handle */

function sectionUnder(event) {
  if (!cutter.group) return null;
  const knobs = [];
  cutter.group.traverse(o => { if (o.userData.cut) knobs.push(o); });
  const hits = rayFrom(event).intersectObjects(knobs, false);
  return hits.length ? hits[0].object.userData.cut : null;
}

function hoverSection(event) {
  if (!sectioning() || cutter.grab) return false;
  const key = sectionUnder(event);
  if (key === cutter.hover) return !!key;
  cutter.hover = key;
  refreshSection();
  return !!key;
}

function grabSection(event) {
  if (!sectioning()) return false;
  const key = sectionUnder(event);
  if (!key) return false;
  const axis = SECTION_AXES.find(a => a.key === key);
  const ray = rayFrom(event).ray;
  const was = reachAlong([ray.origin.x, ray.origin.y, ray.origin.z],
    [ray.direction.x, ray.direction.y, ray.direction.z], [0, 0, 0], axis.normal);
  cutter.grab = { key, axis, from: was, base: cutter.cuts[key].offset };
  return true;
}

function dragSection(event) {
  const grab = cutter.grab;
  if (!grab) return;
  const ray = rayFrom(event).ray;
  const now = reachAlong([ray.origin.x, ray.origin.y, ray.origin.z],
    [ray.direction.x, ray.direction.y, ray.direction.z], [0, 0, 0], grab.axis.normal);
  const travel = cutter.cuts[grab.key].travel;
  const want = grab.base + (now - grab.from);
  cutter.cuts[grab.key].offset = Math.max(travel.from, Math.min(travel.to,
    (event.ctrlKey || event.metaKey) ? Math.round(want / 100) * 100 : want));
  refreshSection();
}

function dropSection() { cutter.grab = null; refreshSection(); }

/* ------------------------------------------------------------- its own bar */

const sectionBar = document.createElement("section");
sectionBar.className = "float fades mx-bar sc-bar";
sectionBar.id = "section-bar";
sectionBar.hidden = true;
document.body.appendChild(sectionBar);

function refreshSectionBar() {
  const on = cutter.on;
  if (sectionBar.hidden !== !on) { sectionBar.hidden = !on; layout(); }
  if (!on) return;
  const cuts = ensureCuts();
  const live = activePlanes(cuts);
  sectionBar.innerHTML = '<div class="mx-row">'
    + '<span class="mx-tag">SECTION</span>'
    + '<span class="seg">'
    + SECTION_AXES.map(axis => '<button data-cut="' + axis.key + '" aria-pressed="'
        + (cuts[axis.key].on ? "true" : "false") + '" title="' + escapeAttr(axis.cut) + '">'
        + escapeHtml(axis.label) + "</button>").join("")
    + "</span>"
    + '<span class="seg">'
    + SECTION_STYLES.map(one => '<button data-cut-style="' + one.key + '" aria-pressed="'
        + (cutter.style === one.key ? "true" : "false") + '" title="'
        + escapeAttr(one.hint) + '">' + escapeHtml(one.label) + "</button>").join("")
    + "</span>"
    + "</div>"
    + '<div class="mx-row mx-wrap">'
    + (live.length ? SECTION_AXES.filter(a => cuts[a.key].on).map(axis => {
        const cut = cuts[axis.key];
        return '<span class="sc-slide"><b>' + escapeHtml(axis.label) + "</b>"
          + '<input type="range" data-cut-at="' + axis.key + '" min="'
          + Math.round(cut.travel.from) + '" max="' + Math.round(cut.travel.to)
          + '" step="1" value="' + Math.round(cut.offset) + '">'
          + '<button data-cut-flip="' + axis.key + '" title="Keep the other half">'
          + (cut.flipped ? "\u21c4" : "\u21c6") + "</button>"
          + '<i>' + escapeHtml(saysWhere(axis.key, cut.offset)) + "</i></span>";
      }).join("") : '<span class="mx-hint">switch a plane on to cut</span>')
    + '<span class="mx-hint">' + escapeHtml(styleNamed(cutter.style).hint) + "</span>"
    + '<button data-cut-off>Done</button>'
    + "</div>";
}

sectionBar.addEventListener("click", event => {
  const axis = event.target.closest("[data-cut]");
  if (axis) { setCut(axis.dataset.cut, { on: !cutter.cuts[axis.dataset.cut].on }); return; }
  const style = event.target.closest("[data-cut-style]");
  if (style) { cutter.style = style.dataset.cutStyle; refreshSection(); return; }
  const flip = event.target.closest("[data-cut-flip]");
  if (flip) { setCut(flip.dataset.cutFlip, { flipped: !cutter.cuts[flip.dataset.cutFlip].flipped });
              return; }
  if (event.target.closest("[data-cut-off]")) toggleSection(false);
});
sectionBar.addEventListener("input", event => {
  const slide = event.target.closest("[data-cut-at]");
  if (!slide) return;
  cutter.cuts[slide.dataset.cutAt].offset = Number(slide.value);
  refreshSection();
});

/* ======================================================================
   THE LENS.

   A camera has a focal length and it is the thing an architect argues about:
   28 mm turns a courtyard into a canyon, 85 mm flattens a street into an
   elevation, and the difference between two schemes is often only that
   somebody photographed them on different lenses. three.js thinks in a
   vertical field of view, which nobody has ever specified a view in, so this
   says millimetres.

   AND IT KEEPS THE FRAMING while it does it, which is the only way to see what
   a lens actually does: the subject stays the size it was and everything
   behind it rushes towards you or away. That is a dolly zoom, and it is the
   difference between changing the lens and changing the zoom.
   ====================================================================== */

const lensPanel = document.createElement("section");
lensPanel.className = "float fades lens-panel";
lensPanel.id = "lens-panel";
lensPanel.hidden = true;
document.body.appendChild(lensPanel);

const lensOpen = () => !lensPanel.hidden;
//! Keeping the framing is what makes it a perspective control rather than a
//! zoom, so it is on unless somebody says otherwise. Read back on the way up,
//! for the same reason as above.
let lensKeepsFraming = true;

function toggleLens(force) {
  const want = force === undefined ? !lensOpen() : !!force;
  lensPanel.hidden = !want;
  if (want) {
    say("Lens \u00b7 roll the wheel to change it \u00b7 P or Esc to put it away");
    refreshLens();
  }
  layout();
  draw();
}

//! One notch of the wheel. Proportional rather than fixed: one step at 24 mm
//! is a different lens, one step at 200 mm is barely anything, and stepping
//! by a share of where you are is how a lens barrel feels.
function rollLens(way) {
  setLens(lensFromFov(camera.fov) * (1 + way * 0.08));
}

function setLens(mm) {
  const want = Math.max(6, Math.min(600, mm));
  // BEHIND A CAMERA, THE LENS IS THE CAMERA'S. Changing the window's field of
  // view while looking through a 35 mm camera would be looking through a lens
  // the camera does not have - and the moment anything rebuilt, the node would
  // put it back. So it is written where it belongs.
  const behind = lookingThrough();
  if (behind && !through.shot) {
    edit({ op: "set", id: behind.id, key: "lens", value: Math.round(want * 10) / 10 })
      .catch(error => showError(error.message));
    refreshLens();
    return;
  }
  const fov = fovFromLens(want);
  if (lensKeepsFraming) {
    const span = Math.max(view.span, 1);
    view.distance = Math.max(span * 0.01, Math.min(span * 120,
      framedAt(view.distance, camera.fov, fov)));
  }
  camera.fov = fov;
  if (gizmoOn() && !gizmo.grab) refreshGizmo();
  placeCamera();
  refreshLens();
  draw();
}

function refreshLens() {
  if (lensPanel.hidden) return;
  // The number a camera is actually on, rather than the one the window's
  // projection has been opened up to so the shot lands in the free rectangle.
  const behind = lookingThrough();
  const shot = behind ? cameraNumbers(behind) : null;
  const mm = shot ? shot.lens : lensFromFov(camera.fov);
  // ACROSS WHAT? Behind a camera the picture is the camera's own frame, not
  // the window - so the width at the target is measured on the frame's ratio,
  // which is the number that says whether the courtyard fits in the shot.
  const aspect = shot ? shot.frame.ratio : (camera.aspect || 1);
  const covers = coversAt(view.distance, behind ? fovFromLens(mm) : camera.fov, aspect);
  const trim = v => v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  lensPanel.innerHTML = '<div class="lens-head"><span class="lens-mm">' + trim(mm)
    + '<i>mm</i></span>'
    + '<span class="lens-fov">' + trim(behind ? fovFromLens(mm) : camera.fov)
      + "\u00b0 vertical" + (behind ? " \u00b7 " + escapeHtml(behind.name) : "")
      + "</span></div>"
    + '<input class="lens-slide" id="lens-slide" type="range" min="6" max="300" step="0.5" value="'
    + Math.min(300, mm) + '" aria-label="Focal length">'
    + '<div class="lens-row">'
    + LENSES.map(one => '<button data-lens="' + one + '" aria-pressed="'
        + (Math.abs(one - mm) < 0.6 ? "true" : "false") + '">' + one + "</button>").join("")
    + "</div>"
    + '<label class="lens-keep"><input type="checkbox" id="lens-keep"'
    + (lensKeepsFraming ? " checked" : "") + "> keeps the framing</label>"
    + '<p class="lens-note">' + (lensKeepsFraming
        ? "the camera walks back as the lens gets longer, so what you are looking at "
          + "stays the size it is and the perspective is what changes"
        : "the camera stays where it is, so this is a zoom")
    + " \u00b7 " + trim(covers) + " mm across at the target</p>"
    + '<p class="lens-note">wheel \u00b7 P to put it away</p>';
  lensPanel.querySelector("#lens-slide").addEventListener("input", event =>
    setLens(Number(event.target.value)));
  lensPanel.querySelector("#lens-keep").addEventListener("change", event => {
    lensKeepsFraming = event.target.checked;
    remember("ocafcad/lens-frame", lensKeepsFraming ? "on" : "off");
    refreshLens();
  });
  for (const button of lensPanel.querySelectorAll("[data-lens]"))
    button.addEventListener("click", () => setLens(Number(button.dataset.lens)));
}

//! The wheel over the panel itself does the same thing as the wheel over the
//! model, so the hand does not have to leave the widget it is reading.
lensPanel.addEventListener("wheel", event => {
  event.preventDefault();
  rollLens(-Math.sign(event.deltaY));
}, { passive: false });

/* ------------------------------------------------------------- its own bar */

const gizmoBar = document.createElement("section");
gizmoBar.className = "float fades mx-bar gz-bar";
gizmoBar.id = "gizmo-bar";
gizmoBar.hidden = true;
document.body.appendChild(gizmoBar);

function refreshGizmoBar() {
  const on = !!gizmo.mode;
  if (gizmoBar.hidden !== !on) { gizmoBar.hidden = !on; layout(); }
  if (!on) return;
  const entry = feature(state.selected);
  const spec = GIZMO_MODES[gizmo.mode];
  const numbers = gizmo.grab ? gizmo.grab.numbers
    : transformNow(entry && entry.type === "Transform" ? entry : null, gizmo.mode);
  gizmoBar.innerHTML = '<div class="mx-row">'
    + '<span class="mx-tag">' + escapeHtml(spec.label.toUpperCase()) + "</span>"
    + '<span class="mx-count">' + escapeHtml(entry ? entry.name : "nothing") + "</span>"
    + '<span class="seg">'
    + GIZMO_ORDER.map(key => '<button data-gizmo="' + key + '" aria-pressed="'
        + (gizmo.mode === key ? "true" : "false") + '">'
        + escapeHtml(GIZMO_MODES[key].label) + " \u00b7 "
        + GIZMO_MODES[key].hotkey.toUpperCase() + "</button>").join("")
    + "</span>"
    + '<span class="mx-num">' + escapeHtml(saysWhat(gizmo.mode, numbers)) + "</span>"
    + '<span class="mx-hint">' + escapeHtml(spec.hint) + "</span>"
    + '<button data-gizmo-off>Done \u00b7 Q</button>'
    + "</div>";
}

gizmoBar.addEventListener("click", event => {
  const pick = event.target.closest("[data-gizmo]");
  if (pick) { armGizmo(pick.dataset.gizmo); return; }
  if (event.target.closest("[data-gizmo-off]")) armGizmo(gizmo.mode);
});

//! Three arrows. Sized against the camera distance so they stay the same size
//! on screen however far out you are.
function buildGizmo(at) {
  const group = new THREE.Group();
  group.position.copy(at);
  const span = view.distance * 0.09;
  for (const axis of AXES) {
    const material = new THREE.MeshBasicMaterial({ color: axis.color, depthTest: false,
                                                   transparent: true, opacity: 0.95 });
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(span * 0.022, span * 0.022, span, 8), material);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(span * 0.07, span * 0.2, 12), material);
    // The cylinder is built along Y; each axis turns it onto its own.
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.dir);
    shaft.quaternion.copy(turn);
    tip.quaternion.copy(turn);
    shaft.position.copy(axis.dir).multiplyScalar(span * 0.5);
    tip.position.copy(axis.dir).multiplyScalar(span * 1.1);
    for (const part of [shaft, tip]) {
      part.userData.axis = axis.key;
      part.renderOrder = 6;
      group.add(part);
    }
  }
  return group;
}

const raycaster = new THREE.Raycaster();

//! Where a ray comes closest to an axis through a point - the whole of what
//! dragging one arrow means.
//! The three.js spelling of the ruler in handle.js. One sum, in one place:
//! the mesh gizmo and the parameter under the hand are measuring the same
//! thing and must not be able to disagree about it.
function alongAxis(ray, origin, dir) {
  return rulerAt([ray.origin.x, ray.origin.y, ray.origin.z],
                      [ray.direction.x, ray.direction.y, ray.direction.z],
                      [origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z]);
}

function rayFrom(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
  //! HOW NEAR COUNTS AS ON A POINT. THREE.Points has no geometry to hit, so
  //! the ray is given a radius, and the radius has to be in WORLD units while
  //! the thing it stands for - a dozen pixels of screen - is not. So it is
  //! worked out from how far the camera is and how tall the viewport is,
  //! which makes a point exactly as easy to hit at arm's length as across a
  //! building.
  const tall = Math.max(1, rect.height);
  raycaster.params.Points.threshold = view.distance * (12 / tall);
  return raycaster;
}

//! An arrow under the pointer starts a drag; nothing else here does.
function grabGizmo(event) {
  if (!meshEdit.gizmo) return null;
  const hits = rayFrom(event).intersectObjects(meshEdit.gizmo.children, false);
  if (!hits.length) return null;
  const axis = AXES.find(a => a.key === hits[0].object.userData.axis);
  const entry = feature(meshEdit.id);
  const moves = (entry && entry.lists && entry.lists.moves) || {};
  meshEdit.axis = axis;
  meshEdit.from = alongAxis(raycaster.ray, meshEdit.gizmo.position, axis.dir);
  // Every vertex picked moves, each from wherever it already was - so pushing a
  // run of them keeps whatever shape the run had.
  meshEdit.before = {};
  for (const at of meshEdit.chosen) meshEdit.before[at] = (moves[at] || [0, 0, 0]).slice();
  return axis;
}

//! Live while the arrow is held: the handle follows, and the mesh is not
//! rebuilt until it is let go - one edit for the drag, not one per frame.
function dragGizmo(event) {
  const axis = meshEdit.axis;
  if (!axis) return;
  const now = alongAxis(rayFrom(event).ray, meshEdit.gizmo.position, axis.dir);
  const step = now - meshEdit.from;
  meshEdit.from = now;
  meshEdit.gizmo.position.addScaledVector(axis.dir, step);
  const scale = (feature(meshEdit.id) || {}).values;
  const factor = scale && Number.isFinite(scale.scale) && Math.abs(scale.scale) > 1e-6
    ? scale.scale : 1;
  const which = { x: 0, y: 1, z: 2 }[axis.key];
  for (const at of Object.keys(meshEdit.before)) meshEdit.before[at][which] += step / factor;
  draw();
}

function dropGizmo() {
  if (!meshEdit.axis) return;
  const moves = meshEdit.before;
  meshEdit.axis = null;
  // One line of the language per vertex, run in order: a drag of six vertices
  // is six edits and one step to undo, and the file says exactly what moved.
  const edits = Object.keys(moves).map(at => {
    // A hand drag is not worth six decimal places; the file stays readable.
    const offset = moves[at].map(v => Math.round(v * 1000) / 1000);
    return { op: "vertex", id: meshEdit.id, index: Number(at),
             x: offset[0], y: offset[1], z: offset[2] };
  });
  if (edits.length) mdl.runAll(edits).catch(err => showError(err.message));
}

//! A handle under the pointer selects that vertex. The threshold is in pixels,
//! so a vertex is as easy to hit far away as up close.
//! Shift adds to what is picked and takes it away again; a plain click starts
//! over. The handle goes on the last one picked and moves all of them, which is
//! how every modeller does it and what makes pushing a whole edge possible.
function pickVertex(event) {
  if (!meshEdit.dots) return false;
  const cast = rayFrom(event);
  cast.params.Points.threshold = view.distance * 0.012;
  const hits = cast.intersectObject(meshEdit.dots.children[0], false);
  if (!hits.length) return false;
  const at = hits[0].index;
  if (event.shiftKey) {
    if (meshEdit.chosen.includes(at)) {
      meshEdit.chosen = meshEdit.chosen.filter(v => v !== at);
      meshEdit.vertex = meshEdit.chosen.length ? meshEdit.chosen[meshEdit.chosen.length - 1] : -1;
    } else {
      meshEdit.chosen.push(at);
      meshEdit.vertex = at;
    }
  } else {
    meshEdit.chosen = [at];
    meshEdit.vertex = at;
  }
  refreshMeshEdit();
  buildPanel();
  return true;
}

//! WHAT IS UNDER THE POINTER, with a plane never standing in front of a
//! solid.
//!
//! A datum plane is 200 mm of nearly transparent sheet and it is usually
//! between the camera and the part. Nearest-hit-wins would mean clicking a
//! body and getting the plane it was drawn on, which is why datums used to be
//! left out of picking altogether - and that made a plane impossible to choose
//! by pointing at it, which is the only way anybody wants to choose one.
//!
//! So both are collected and solids win. A datum is only the answer when there
//! is nothing solid along the ray at all, which is exactly when you meant it.
//! WHAT THE RAY IS ALLOWED TO HIT, without allocating a new list for it.
//!
//! This filtered `pickable` on every pointermove - a thousand-entry array
//! rebuilt for every pixel the cursor travels - and then asked the raycaster
//! to walk all of it. The array is now filled in place and reused, and what
//! the camera has already decided not to draw is not offered to the ray
//! either: you cannot point at something that is not on the screen.
const rayList = [];
function pickableNow() {
  rayList.length = 0;
  for (const m of pickable) {
    if (!m.parent || !m.parent.visible) continue;
    if (m.material && m.material.visible === false) continue;
    rayList.push(m);
  }
  return rayList;
}

function idUnder(ray) {
  const hits = ray.intersectObjects(pickableNow(), false);
  //! A MARK BEATS EVERYTHING. A point is a few pixels across and is nearly
  //! always sitting ON the thing it was made from - a corner of a cube, a
  //! station along a curve - so nearest-hit-wins would mean it could never be
  //! chosen by pointing at it. If the ray came within a dozen pixels of one,
  //! that is what was being aimed at.
  const mark = hits.find(hit => hit.object.userData.mark);
  const solid = hits.find(hit => !hit.object.userData.datum);
  const won = mark || solid || hits[0];
  return won ? won.object.userData.id : null;
}

//! Lit as the pointer passes, and repainted only when the answer CHANGES -
//! a pointermove fires on every pixel and repainting the scene on each of them
//! is a way to make a fast viewport feel slow.
function hoverFeature(event) {
  const id = idUnder(rayFrom(event));
  if (id === state.hover) return;
  state.hover = id;
  //! The cursor says it too, because a highlight you have to be looking at the
  //! right part of the screen to notice is half a signal.
  renderer.domElement.style.cursor = id ? "pointer" : "";
  paintSelection();
}

//! The pointer leaving the viewport leaves nothing lit behind it.
function clearHover() {
  if (state.hover === null) return;
  state.hover = null;
  renderer.domElement.style.cursor = "";
  paintSelection();
}

function pick(event) {
  //! Through rayFrom, so a click and a hover agree about how near counts as
  //! on a point. They did not while this set the ray up itself.
  const id = idUnder(rayFrom(event));
  // AN INPUT IS WAITING. Then this click is the answer to its question rather
  // than a change of selection - which is the whole of what "click the field,
  // then click the thing" means.
  if (waiting.on && id) { offerWire(id); return; }
  if (event.shiftKey && id) pickAlso(id); else select(id, false);
}

//! Everything in view, and no further back than it has to be. The bounding
//! sphere is used rather than the box because a sphere looks the same from
//! every angle, so the framing does not change when the model is turned.
function fitView() {
  const box = sceneBounds();
  if (!box) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  view.span = Math.max(sphere.radius, 1);
  const framing = frameFor(view.span, freeRect());
  view.target.copy(sphere.center);
  view.distance = framing.distance;
  // Aiming off-centre by the same amount the free rectangle is off-centre puts
  // the part in the clear rather than behind a panel.
  placeCamera();
  const out = new THREE.Vector3().subVectors(camera.position, view.target).normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, out);
  if (right.lengthSq() < 1e-8) right.set(-Math.sin(view.yaw), Math.cos(view.yaw), 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(out, right).normalize();
  view.target.addScaledVector(right, -framing.shift[0])
             .addScaledVector(up, framing.shift[1]);
  placeCamera(); draw();
}

//! FIT, BUT ON ONE THING. A masterplan fitted whole is a masterplan you can
//! see nothing in; what you wanted was the one tower you had your finger on.
//! The same framing as fit, so the two feel like the same gesture - and it
//! keeps the angle you were already looking from, because turning the model
//! round as well would be two answers to one question.
function centreOn(id) {
  const entry = feature(id);
  let box = boxOfShape(id);
  if ((!box || box.isEmpty()) && entry) {
    const at = shapeCentre(id);
    if (at) box = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(at[0], at[1], at[2]),
      new THREE.Vector3(1, 1, 1).multiplyScalar(Math.max(1, view.span * 0.05)));
  }
  if (!box || box.isEmpty()) {
    say((entry ? entry.name : "that") + " has nothing on screen to centre on");
    return;
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const framing = frameFor(Math.max(sphere.radius, 1), freeRect());
  view.target.copy(sphere.center);
  view.distance = framing.distance;
  placeCamera();
  const out = new THREE.Vector3().subVectors(camera.position, view.target).normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, out);
  if (right.lengthSq() < 1e-8) right.set(-Math.sin(view.yaw), Math.cos(view.yaw), 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(out, right).normalize();
  view.target.addScaledVector(right, -framing.shift[0]).addScaledVector(up, framing.shift[1]);
  placeCamera();
  // LOOKING THROUGH A CAMERA, centring is the CAMERA moving - it is what a
  // camera operator does, and leaving the viewport somewhere the camera is not
  // would be two views of one thing.
  if (lookingThrough()) {
    through.target = [view.target.x, view.target.y, view.target.z];
    through.eye = [camera.position.x, camera.position.y, camera.position.z];
    through.dirty = true;
    placeThrough();
    refreshSafe();
    saveThrough();
  }
  draw();
  if (entry) say("centred on " + entry.name);
}

//! A CAMERA FROM WHERE YOU ARE STANDING. The view you have just composed by
//! hand, made into a thing the document holds - which is the whole point of a
//! camera being a node, and it should take one press rather than six numbers.
async function cameraFromView(name) {
  const eye = camera.position, aim = view.target;
  const lens = Math.max(6, Math.round(lensFromFov(camera.fov || 38)));
  const born = await edit({ op: "add", type: "Camera", name: name || undefined });
  const id = born && born.id;
  if (!id) return null;
  const numbers = fromView([eye.x, eye.y, eye.z], [aim.x, aim.y, aim.z]);
  await mdl.runAll([...Object.entries(numbers).map(([key, value]) =>
    ({ op: "set", id, key, value })),
    { op: "set", id, key: "lens", value: lens },
    // Drawn at a size that suits the model it is standing in, rather than at
    // six hundred millimetres in the middle of a masterplan.
    { op: "set", id, key: "size", value: Math.max(60, Math.round(view.span * 0.35)) }]);
  select(id, true);
  say((feature(id) || {}).name + " is where you were standing \u00b7 "
      + lens + " mm \u00b7 Look through it in its panel");
  return id;
}

/* ==========================================================================
   Interface.
   ========================================================================== */

//! The sketcher's own rail. Seven shapes and six relations, drawn the way a
//! drawing board draws them.
//! Each relation as a run of line segments in its own little square, drawn on
//! the sketch plane beside what it holds. Pairs of points: every two make one
//! segment, which is what THREE.LineSegments wants.
const RELATION_GLYPH = {
  // two rings, meeting
  coincident: [[-0.9, 0], [-0.1, 0], [0.1, 0], [0.9, 0],
               [-0.35, -0.55], [0.35, -0.55], [-0.35, 0.55], [0.35, 0.55],
               [-0.35, -0.55], [-0.35, 0.55], [0.35, -0.55], [0.35, 0.55]],
  horizontal: [[-0.9, 0.35], [0.9, 0.35], [-0.9, -0.35], [0.9, -0.35]],
  vertical:   [[-0.35, -0.9], [-0.35, 0.9], [0.35, -0.9], [0.35, 0.9]],
  parallel:   [[-0.6, -0.9], [-0.1, 0.9], [0.2, -0.9], [0.7, 0.9]],
  perpendicular: [[-0.8, -0.8], [0.8, -0.8], [-0.2, -0.8], [-0.2, 0.9],
                  [-0.2, -0.4], [0.2, -0.4], [0.2, -0.4], [0.2, -0.8]],
  tangent:    [[-0.9, -0.7], [0.9, -0.7],
               [-0.5, -0.7], [-0.5, -0.3], [-0.5, -0.3], [0, 0.3],
               [0, 0.3], [0.5, -0.3], [0.5, -0.3], [0.5, -0.7]],
  // A cross: two strokes meeting where the point is.
  intersect:  [[-0.85, -0.85], [0.85, 0.85], [-0.85, 0.85], [0.85, -0.85]],
};

// The layer panel's six small buttons. Drawn rather than lettered, because a
// row of six words in a 300 px panel is a row nobody reads.
const LAYER_ICONS = {
  layerOn: '<path d="M1.6 8s2.4-4.2 6.4-4.2S14.4 8 14.4 8s-2.4 4.2-6.4 4.2S1.6 8 1.6 8z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="1.9" fill="currentColor"/>',
  layerOff: '<path d="M1.6 8s2.4-4.2 6.4-4.2S14.4 8 14.4 8s-2.4 4.2-6.4 4.2S1.6 8 1.6 8z" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".45"/><path d="M2.8 13.2L13.2 2.8" stroke="currentColor" stroke-width="1.3"/>',
  layerLocked: '<rect x="3.6" y="7" width="8.8" height="6.4" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5.6 7V5.4a2.4 2.4 0 014.8 0V7" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  layerOpen: '<rect x="3.6" y="7" width="8.8" height="6.4" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/><path d="M5.6 7V5.4a2.4 2.4 0 014.8-.4" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/>',
  // A pencil: this is the one being drawn on.
  layerCurrent: '<path d="M3 13l1-3 6.6-6.6 2 2L6 12z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  // A window drawn round things: what "select everything on this layer" does.
  layerSelect: '<path d="M2.4 2.4h11.2v11.2H2.4z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2.4 1.8"/><circle cx="5.6" cy="5.6" r="1.5" fill="currentColor"/><circle cx="10.4" cy="10.4" r="1.5" fill="currentColor"/>',
  // Things going into a layer.
  layerInto: '<path d="M8 2v7" stroke="currentColor" stroke-width="1.3"/><path d="M5.2 6.6L8 9.6l2.8-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/><path d="M2.6 11.6h10.8v2.2H2.6z" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  // The dashed line itself. The toolbar button, and the one on every row.
  dashed: '<path d="M1.6 8h3M6.5 8h3M11.4 8h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  layerDelete: '<path d="M3.4 4.6h9.2M6.4 4.6V3.2h3.2v1.4M4.6 4.6l.7 8.2h5.4l.7-8.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
};

const SKETCH_ICONS = {
  // The cursor itself: what the sketcher hands you before you ask for a tool.
  select: '<path d="M3.4 2.2l9.4 5.1-4 1-1.6 4.2z" fill="currentColor" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>',
  point: '<circle cx="8" cy="8" r="2.2" fill="currentColor"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2" stroke="currentColor" stroke-width="1"/>',
  line: '<path d="M2.6 13.4L13.4 2.6" stroke="currentColor" stroke-width="1.4"/><circle cx="2.6" cy="13.4" r="1.5" fill="currentColor"/><circle cx="13.4" cy="2.6" r="1.5" fill="currentColor"/>',
  arc: '<path d="M2.4 12.4A9 9 0 0112.4 2.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="2.4" cy="12.4" r="1.4" fill="currentColor"/><circle cx="12.4" cy="2.4" r="1.4" fill="currentColor"/>',
  circle: '<circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/>',
  ellipse: '<ellipse cx="8" cy="8" rx="6.2" ry="3.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/>',
  oblong: '<rect x="1.6" y="4.6" width="12.8" height="6.8" rx="3.4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  rect: '<rect x="2.2" y="4" width="11.6" height="8" fill="none" stroke="currentColor" stroke-width="1.4"/>'
      + '<circle cx="2.2" cy="12" r="1.3" fill="currentColor"/><circle cx="13.8" cy="4" r="1.3" fill="currentColor"/>',
  // Two straight runs and the arc that replaces the corner they made.
  fillet: '<path d="M2.6 13.4V8.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
        + '<path d="M7.4 3.6h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
        + '<path d="M2.6 8.6A4.8 4.8 0 017.4 3.6" fill="none" stroke="currentColor" stroke-width="1.4"/>'
        + '<path d="M2.6 3.6h4.8M2.6 3.6v5" stroke="currentColor" stroke-width=".9" stroke-dasharray="1.8 1.6" opacity=".5"/>',
  spline: '<path d="M1.8 11.5c2.6 0 2.6-7 5.2-7s2.6 7 5.2 7 2.6-3 2.6-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  // The control polygon, and the curve it pulls. What tells the two spline
  // tools apart is exactly this: one goes THROUGH its points, the other is
  // pulled by them.
  bspline: '<path d="M2 13L5 3.4l6 .2 3 9" fill="none" stroke="currentColor" stroke-width=".9" stroke-dasharray="2 1.6" opacity=".55"/>'
         + '<path d="M2 13C3.6 6.4 12.4 6.6 14 12.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
         + '<circle cx="5" cy="3.4" r="1.2" fill="currentColor"/><circle cx="11" cy="3.6" r="1.2" fill="currentColor"/>',

  coincident: '<path d="M2 11.5L7.4 6.1M14 4.5L8.6 9.9" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  horizontal: '<path d="M1.8 8h12.4" stroke="currentColor" stroke-width="1.6"/><path d="M1.8 12.5h12.4" stroke="currentColor" stroke-width=".9" stroke-dasharray="2 2" opacity=".5"/>',
  vertical: '<path d="M8 1.8v12.4" stroke="currentColor" stroke-width="1.6"/><path d="M12.5 1.8v12.4" stroke="currentColor" stroke-width=".9" stroke-dasharray="2 2" opacity=".5"/>',
  parallel: '<path d="M3.4 13.6L7.6 2.4M8.8 13.6L13 2.4" stroke="currentColor" stroke-width="1.4"/>',
  perpendicular: '<path d="M3 13h10M4.6 13V3" stroke="currentColor" stroke-width="1.4"/><path d="M4.6 10.6h2.4v2.4" fill="none" stroke="currentColor" stroke-width="1"/>',
  tangent: '<circle cx="9" cy="9" r="4.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.6 4.6h12.8" stroke="currentColor" stroke-width="1.4"/>',
  // Two curves crossing, and the point that is the crossing.
  intersect: '<path d="M2 3.2c4.6 0 4.6 9.6 9.2 9.6" fill="none" stroke="currentColor" stroke-width="1.3"/>'
           + '<path d="M2 12.8c4.6 0 4.6-9.6 9.2-9.6" fill="none" stroke="currentColor" stroke-width="1.3"/>'
           + '<circle cx="6.6" cy="8" r="2.1" fill="currentColor"/>',
};

const ICONS = {
  ...LAYER_ICONS,

  // A body above, and the lines it casts onto a sheet below: what a projection
  // view IS, said in one mark.
  ProjectionView: '<path d="M3.2 2.4h6.4l2.8 2.6v4.2H3.2z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M4 11.4v2.6M8 11.4v2.6M12 11.4v2.6" stroke="currentColor" stroke-width="1" opacity=".55"/><path d="M1.6 14.6h12.8" stroke="currentColor" stroke-width="1.3"/>',
  // The same, with the plane through it and the cut hatched - the one mark
  // everybody already reads as a section.
  CutView: '<path d="M3.4 3.2h9.2v9.6H3.4z" fill="none" stroke="currentColor" stroke-width="1.15"/><path d="M3.4 6.4h9.2v3.2H3.4z" fill="currentColor" opacity=".22"/><path d="M4.2 9.6l2.4-3.2M7 9.6l2.4-3.2M9.8 9.6l2.4-3.2" stroke="currentColor" stroke-width=".9" opacity=".8"/><path d="M1.2 6.4h13.6M1.2 9.6h13.6" stroke="currentColor" stroke-width="1.25"/>',
  Point: '<circle cx="8" cy="8" r="2.4" fill="currentColor"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.2"/>',
  Vector: '<path d="M2 13L12 4" stroke="currentColor" stroke-width="1.5"/><path d="M13.5 2.5L9 3.6l3.4 3.2z" fill="currentColor"/>',
  Line: '<path d="M2 13L14 3" stroke="currentColor" stroke-width="1.5"/><circle cx="2.6" cy="12.6" r="1.6" fill="currentColor"/><circle cx="13.4" cy="3.4" r="1.6" fill="currentColor"/>',
  // A sheet with a drawing on it: the plane, and two dimensions of lines.
  Sketch: '<path d="M1.6 11.2L5.6 4.6h8.8L10.4 11.2z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round" opacity=".55"/>'
        + '<path d="M4.6 9.6h5.4M7.6 6.2v3.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
        + '<circle cx="4.6" cy="9.6" r="1.15" fill="currentColor"/><circle cx="10" cy="9.6" r="1.15" fill="currentColor"/>',
  Plane: '<path d="M1.5 10.5L6 4.5h8.5L10 10.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  // Three arms from a corner: an axis system is drawn the way it is drawn.
  Story: '<rect x="1.6" y="3" width="8.2" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>'
       + '<path d="M3.4 5.6h4.6M3.4 8h4.6M3.4 10.4h3" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".8"/>'
       + '<path d="M11.4 6.6l3 1.4-3 1.4z" fill="currentColor"/>',
  Camera: '<path d="M1.8 5.4h7.4v5.2H1.8z" fill="none" stroke="currentColor" stroke-width="1.25"/>'
        + '<path d="M9.2 7.6l4.9-2.2v5.4l-4.9-2.2z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>'
        + '<circle cx="4.1" cy="3.6" r="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/>'
        + '<circle cx="7.3" cy="3.6" r="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/>',
  AxisSystem: '<path d="M3 13V4M3 13h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
            + '<path d="M3 13L9.5 8.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".6"/>'
            + '<circle cx="3" cy="13" r="1.5" fill="currentColor"/>',
  // A shape and the same shape further on, with the travel between them.
  Move: '<rect x="1.4" y="8.6" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>'
      + '<rect x="9.6" y="2.4" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".45"/>'
      + '<path d="M6.9 8.2L10 5.1" stroke="currentColor" stroke-width="1.15"/>'
      + '<path d="M11.6 3.6L8.6 4.3l2.1 2.1z" fill="currentColor"/>',
  Rotate: '<path d="M12.6 8a4.6 4.6 0 1 1-1.6-3.5" fill="none" stroke="currentColor" stroke-width="1.3"/>'
        + '<path d="M12 1.9l-.4 3.4 3.2-.8z" fill="currentColor"/>'
        + '<circle cx="8" cy="8" r="1.3" fill="currentColor"/>',
  Mirror: '<path d="M8 1.4v13.2" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.6 1.5"/>'
        + '<path d="M6.4 4.2L2 8l4.4 3.8z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'
        + '<path d="M9.6 4.2L14 8l-4.4 3.8z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" opacity=".45"/>',
  Scale: '<rect x="1.6" y="8.4" width="5.2" height="5.2" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>'
       + '<rect x="1.6" y="1.6" width="12" height="12" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".45"/>',
  AxisToAxis: '<path d="M2 13V7.5M2 13h5.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>'
            + '<path d="M14 3v5.5M14 3H8.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" opacity=".5"/>'
            + '<path d="M5.4 10.4l5.2-5.2" stroke="currentColor" stroke-width="1.1" stroke-dasharray="1.6 1.4"/>',
  Cube: '<path d="M8 1.6l5.6 3v6.8L8 14.4l-5.6-3V4.6z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.4 4.6L8 7.6l5.6-3M8 7.6v6.8" stroke="currentColor" stroke-width="1.1"/>',
  Sphere: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.3"/><ellipse cx="8" cy="8" rx="2.7" ry="6.3" fill="none" stroke="currentColor" stroke-width="1"/>',
  Array: '<rect x="1.6" y="1.6" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9.4" y="1.6" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="1.6" y="9.4" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9.4" y="9.4" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".45"/>',
  // Both written features wear angle brackets; what sits between them says
  // which sample the code starts from.
  Script: '<path d="M5.2 4.4L2 8l3.2 3.6M10.8 4.4L14 8l-3.2 3.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<path d="M6.6 5.2c2.8 0 2.8 1.4 0 1.4M6.6 6.6c2.8 0 2.8 1.4 0 1.4M6.6 8c2.8 0 2.8 1.4 0 1.4M6.6 9.4c2.8 0 2.8 1.4 0 1.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>',
  // The building's own silhouette between the brackets: the long slope, the
  // valley, the peak.
  Center: '<path d="M4.6 4.2L1.6 8l3 3.8M11.4 4.2L14.4 8l-3 3.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<path d="M5.2 11.2c0-2.6.7-3.9 1.6-3.9s1 1.3 1.1 2.4c.2 1.6.9 2.6 1.6-1 .5-2.6 1-3.5 1.4-3.5" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/>',
  Ribbon: '<path d="M5.2 4.4L2 8l3.2 3.6M10.8 4.4L14 8l-3.2 3.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<path d="M6.3 10.6c1-3.6 2.2-5 3.4-5s1.5 1.1 0 1.1" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'
        + '<path d="M6.3 8.6c1.1-2.6 2-3.6 3-3.6" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round" opacity=".6"/>',
  menu: '<path d="M2.6 4.4h10.8M2.6 8h10.8M2.6 11.6h10.8" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>',
  help: '<circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" stroke-width="1.25"/>'
      + '<path d="M6.1 6.2a1.95 1.95 0 113.2 1.5c-.7.55-1.3.9-1.3 1.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
      + '<circle cx="8" cy="11.9" r=".78" fill="currentColor"/>',
  packages: '<path d="M2.4 5.2L8 2.4l5.6 2.8v5.6L8 13.6l-5.6-2.8z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>'
          + '<path d="M2.4 5.2L8 8l5.6-2.8M8 8v5.6" fill="none" stroke="currentColor" stroke-width="1.05"/>',
  undo: '<path d="M3.4 7.6h6.2a3.6 3.6 0 010 7.2H6.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6.2 4.2L2.8 7.6l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  redo: '<path d="M12.6 7.6H6.4a3.6 3.6 0 000 7.2h3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9.8 4.2l3.4 3.4-3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  Fillet: '<path d="M2.5 13.5V8a5.5 5.5 0 015.5-5.5h5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 2.5h5.5M2.5 2.5v5.5" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>',

  /* ------------------------------------------------------------ numbers */
  Number: '<path d="M2.5 11.5h11" stroke="currentColor" stroke-width="1.2"/>'
        + '<circle cx="10" cy="11.5" r="2.4" fill="currentColor"/>'
        + '<path d="M4 6.6V3.4M2.6 4.6L4 3.2l1.4 1.4M8.4 3.2h3.2M8.4 6.4h3.2" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round"/>',
  Series: '<circle cx="2.6" cy="8" r="1.3" fill="currentColor"/><circle cx="6.4" cy="8" r="1.3" fill="currentColor"/>'
        + '<circle cx="10.2" cy="8" r="1.3" fill="currentColor"/><circle cx="14" cy="8" r="1.3" fill="currentColor" opacity=".45"/>'
        + '<path d="M2.6 12.6h11.4" stroke="currentColor" stroke-width=".9" opacity=".4"/>',
  Range: '<path d="M2.5 8h11" stroke="currentColor" stroke-width="1.2"/>'
       + '<path d="M2.5 5v6M13.5 5v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
       + '<path d="M6.2 6.4v3.2M9.8 6.4v3.2" stroke="currentColor" stroke-width="1" opacity=".55"/>',
  Math: '<path d="M2.6 5.4h4M4.6 3.4v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
      + '<path d="M9.4 3.8l3.6 3.6M13 3.8L9.4 7.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
      + '<path d="M2.6 11.4h4M9.4 10.2h3.6M9.4 12.6h3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
      + '<circle cx="4.6" cy="13.4" r=".9" fill="currentColor"/>',
  Expression: '<path d="M4.6 2.8C2.9 2.8 2.9 8 2.9 8s0 5.2 1.7 5.2M11.4 2.8c1.7 0 1.7 5.2 1.7 5.2s0 5.2-1.7 5.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
            + '<path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  Panel: '<rect x="1.8" y="3.2" width="12.4" height="9.6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/>'
       + '<path d="M4 6.2h6M4 8.4h8M4 10.6h4.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".8"/>',

  /* ------------------------------------------------------------- curves */
  Circle: '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.3"/>'
        + '<circle cx="8" cy="8" r="1.1" fill="currentColor"/>',
  // Two circles and the one that touches both: the picture the documentation
  // draws eight of.
  ConstrainedCircle: '<circle cx="4.2" cy="10.4" r="3.1" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".5"/>'
    + '<circle cx="11.6" cy="10.4" r="2.4" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".5"/>'
    + '<circle cx="7.9" cy="5.6" r="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  // A line laid across two circles, touching each.
  ConstrainedLine: '<circle cx="4" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".5"/>'
    + '<circle cx="12" cy="8.6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".5"/>'
    + '<path d="M1.2 6.6L15 5.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  // Two marks and the line of equal distance running between them.
  Bisector: '<circle cx="3.4" cy="11.6" r="1.4" fill="currentColor"/>'
    + '<circle cx="12.6" cy="4.4" r="1.4" fill="currentColor"/>'
    + '<path d="M2.4 3.6L13.6 12.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="2.4 1.8"/>',
  // A curve through three points with a tangent arrow standing on the first.
  BlendCurve: '<path d="M2.4 12.8C2.4 7.2 5.2 4 8 4s5.6 3.2 5.6 8.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
    + '<path d="M2.4 12.8V6.2" stroke="currentColor" stroke-width="1" opacity=".55"/>'
    + '<path d="M2.4 4.4l-1.5 2.6h3z" fill="currentColor" opacity=".7"/>'
    + '<circle cx="8" cy="4" r="1.2" fill="currentColor"/>',
  // A four-sided boundary with a patch filling it.
  FillSurface: '<path d="M2.4 10.6C4.6 12.8 11.4 12.8 13.6 10.6 13.6 7 11 3.4 8 3.4S2.4 7 2.4 10.6z" fill="currentColor" opacity=".16"/>'
    + '<path d="M2.4 10.6C4.6 12.8 11.4 12.8 13.6 10.6" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>'
    + '<path d="M2.4 10.6C2.4 7 5 3.4 8 3.4s5.6 3.6 5.6 7.2" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>'
    + '<path d="M5.4 7.6h5.2" stroke="currentColor" stroke-width=".9" opacity=".5"/>',
  Ellipse: '<ellipse cx="8" cy="8" rx="6.2" ry="3.6" fill="none" stroke="currentColor" stroke-width="1.3"/>'
    + '<path d="M1.8 8h12.4" stroke="currentColor" stroke-width="1" opacity=".5"/>',
  Conic: '<path d="M2.6 2.4C2.6 8 5.4 13.6 8 13.6s5.4-5.6 5.4-11.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
    + '<circle cx="8" cy="10.2" r="1.1" fill="currentColor"/>',
  Oblong: '<path d="M5.6 4.6h4.8a3.4 3.4 0 0 1 0 6.8H5.6a3.4 3.4 0 0 1 0-6.8z" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  Rectangle: '<rect x="2.2" y="4.4" width="11.6" height="7.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  // A corner with the arc that takes it off.
  FilletCurve: '<path d="M2.4 13.4h6a5 5 0 0 0 5-5v-6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
    + '<path d="M13.4 13.4h-2.6M13.4 13.4v-2.6" stroke="currentColor" stroke-width="1" opacity=".45"/>'
    + '<path d="M13.4 13.4L8.4 13.4M13.4 13.4L13.4 8.4" stroke="currentColor" stroke-width="1" stroke-dasharray="1.4 1.4" opacity=".45"/>',
  Polyline: '<path d="M2.2 12.4l3.4-6.2 3.2 3.6 4.9-6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>'
          + '<circle cx="2.2" cy="12.4" r="1.2" fill="currentColor"/><circle cx="5.6" cy="6.2" r="1.2" fill="currentColor"/>'
          + '<circle cx="8.8" cy="9.8" r="1.2" fill="currentColor"/><circle cx="13.7" cy="3.8" r="1.2" fill="currentColor"/>',
  Interpolate: '<path d="M2.2 12.4C4.2 12.4 3.6 5.4 6.4 5.4s2 5.6 4.2 5.6 1.6-7.2 3.2-7.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
             + '<circle cx="2.2" cy="12.4" r="1.2" fill="currentColor"/><circle cx="6.4" cy="5.4" r="1.2" fill="currentColor"/>'
             + '<circle cx="10.6" cy="11" r="1.2" fill="currentColor"/><circle cx="13.8" cy="3.8" r="1.2" fill="currentColor"/>',

  /* ----------------------------------------------------------- analysis */
  EvaluateCurve: '<path d="M1.8 12.6C4.6 12.6 4.2 3.4 8 3.4s3.4 9.2 6.2 9.2" fill="none" stroke="currentColor" stroke-width="1.2"/>'
               + '<circle cx="8" cy="3.4" r="2" fill="currentColor"/>'
               + '<path d="M4.4 3.4h7.2" stroke="currentColor" stroke-width="1" stroke-dasharray="1.6 1.6"/>',
  DivideCurve: '<path d="M1.8 12.6C4.6 12.6 4.2 3.4 8 3.4s3.4 9.2 6.2 9.2" fill="none" stroke="currentColor" stroke-width="1.2"/>'
             + '<circle cx="2.6" cy="11.4" r="1.15" fill="currentColor"/><circle cx="5.2" cy="6.1" r="1.15" fill="currentColor"/>'
             + '<circle cx="8" cy="3.4" r="1.15" fill="currentColor"/><circle cx="10.8" cy="6.1" r="1.15" fill="currentColor"/>'
             + '<circle cx="13.4" cy="11.4" r="1.15" fill="currentColor"/>',
  EvaluateSurface: '<path d="M1.6 10.2L6 5.2h8.4L10 10.2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'
                 + '<circle cx="8" cy="7.7" r="1.9" fill="currentColor"/>'
                 + '<path d="M8 7.7V2.6" stroke="currentColor" stroke-width="1.1" stroke-dasharray="1.6 1.6"/>',
  Measure: '<path d="M1.6 6.2h12.8v3.6H1.6z" fill="none" stroke="currentColor" stroke-width="1.2"/>'
         + '<path d="M4.4 6.2v2M7 6.2v2.9M9.6 6.2v2M12.2 6.2v2.9" stroke="currentColor" stroke-width="1"/>',

  /* --------------------------------------------------------- operations */
  Extrude: '<path d="M2.6 12.6h6.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
         + '<path d="M2.6 12.6V6.4h6.8v6.2M2.6 6.4L5.6 3.4h6.8L9.4 6.4M12.4 3.4v6.2L9.4 12.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  Loft: '<path d="M2.4 12.4c2.6 0 3-1.6 5.6-1.6s3 1.6 5.6 1.6" fill="none" stroke="currentColor" stroke-width="1.25"/>'
      + '<path d="M3.6 8c2.2 0 2.4-1.3 4.4-1.3S10.2 8 12.4 8" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".75"/>'
      + '<path d="M4.8 3.8c1.7 0 1.9-1 3.2-1s1.5 1 3.2 1" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/>',
  Face: '<path d="M1.6 10.4L5.6 4.6h8.8L10.4 10.4z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round" opacity=".45"/>'
      + '<path d="M5.8 10.4L7.9 7.4h4.3l-2.1 3z" fill="currentColor" opacity=".35"/>'
      + '<path d="M5.8 10.4L7.9 7.4h4.3l-2.1 3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  Fill: '<path d="M2.4 11.2C4.4 11.2 4 4.6 8 4.6s3.6 6.6 5.6 6.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
      + '<path d="M2.4 11.2C4.4 11.2 4 4.6 8 4.6s3.6 6.6 5.6 6.6v2.2H2.4z" fill="currentColor" opacity=".28"/>'
      + '<path d="M2.4 13.4h11.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  Boolean: '<circle cx="6" cy="8" r="4.4" fill="none" stroke="currentColor" stroke-width="1.25"/>'
         + '<circle cx="10" cy="8" r="4.4" fill="none" stroke="currentColor" stroke-width="1.25"/>'
         + '<path d="M8 4.1a4.4 4.4 0 000 7.8 4.4 4.4 0 000-7.8z" fill="currentColor" opacity=".35"/>',
  /* ------------------------------------------------------- the primitives
     a graph needs before it can compose anything on its own */
  Numbers: '<path d="M1.8 3.4h12.4M1.8 8h12.4M1.8 12.6h12.4" stroke="currentColor" stroke-width="1" opacity=".3"/>'
         + '<path d="M3 2.2v2.4M6.4 2.2v2.4M9.8 2.2v2.4M13.2 2.2v2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
         + '<path d="M3 6.8v2.4M6.4 6.8v2.4M9.8 6.8v2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
         + '<path d="M3 11.4v2.4M6.4 11.4v2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  Join: '<rect x="1.4" y="2.4" width="5.4" height="5.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.15"/>'
      + '<rect x="9.2" y="2.4" width="5.4" height="5.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.15"/>'
      + '<rect x="5.3" y="8.4" width="5.4" height="5.4" rx="1" fill="currentColor" opacity=".25"/>'
      + '<rect x="5.3" y="8.4" width="5.4" height="5.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.15"/>'
      + '<path d="M4.1 7.8v.8h7.8v-.8" fill="none" stroke="currentColor" stroke-width="1"/>',
  Drape: '<path d="M1.6 12.4c2.6 0 3.2-5.2 6.4-5.2s3.8 5.2 6.4 5.2" fill="none" stroke="currentColor" stroke-width="1.3"/>'
       + '<circle cx="4" cy="2.4" r="1.15" fill="currentColor"/><circle cx="8" cy="2.4" r="1.15" fill="currentColor"/><circle cx="12" cy="2.4" r="1.15" fill="currentColor"/>'
       + '<path d="M4 4.2v3.9M8 4.2v2M12 4.2v3.9" stroke="currentColor" stroke-width="1" stroke-dasharray="1.5 1.5"/>'
       + '<path d="M2.9 8.9L4 10l1.1-1.1M6.9 7L8 8.1 9.1 7M10.9 8.9L12 10l1.1-1.1" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/>',
  PlaceAt: '<path d="M2.2 12.6c2.4 0 3-3.4 5.8-3.4s3.4 3.4 5.8 3.4" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".45"/>'
         + '<rect x="1.2" y="7.2" width="3.4" height="3.4" rx=".6" fill="none" stroke="currentColor" stroke-width="1.2"/>'
         + '<rect x="6.3" y="4.6" width="3.4" height="3.4" rx=".6" fill="none" stroke="currentColor" stroke-width="1.2" transform="rotate(16 8 6.3)"/>'
         + '<rect x="11.4" y="7.2" width="3.4" height="3.4" rx=".6" fill="none" stroke="currentColor" stroke-width="1.2" transform="rotate(-14 13.1 8.9)"/>',

  /* --------------------------------------------------------------- mesh */
  //! The starting mesh: a plan with a bite out of it, gridded - which is what
  //! nearly every one of them is, and what the L most people reach for is.
  MeshTemplate: '<path d="M2 3.2h6.6v4.4H14v5.2H2z" fill="none" stroke="currentColor" '
              + 'stroke-width="1.15" stroke-linejoin="round"/>'
              + '<path d="M5.3 3.2v9.6M8.6 7.6v5.2M11.3 7.6v5.2M2 7.6h6.6M2 10.2h12" '
              + 'stroke="currentColor" stroke-width=".75" opacity=".55"/>',
  //! The cage on the left becoming a surface on the right: the one node that
  //! crosses from the mesh side of this program to the B-Rep side.
  MeshToShape: '<path d="M2 4.2l3.4-1.8 3.4 1.8v5.2L5.4 11.2 2 9.4z" fill="none" '
             + 'stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'
             + '<path d="M2 4.2l3.4 1.8 3.4-1.8M5.4 6v5.2" stroke="currentColor" '
             + 'stroke-width=".7" opacity=".6"/>'
             + '<path d="M10.6 5.4c2.4 0 3.4 1.6 3.4 3.1s-1 3.1-3.4 3.1" fill="none" '
             + 'stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'
             + '<path d="M9.4 8.5h4" stroke="currentColor" stroke-width=".9" opacity=".6"/>',
  MeshBox: '<path d="M8 1.6l5.6 3v6.8L8 14.4l-5.6-3V4.6z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/>'
         + '<path d="M2.4 4.6L8 7.6l5.6-3M8 7.6v6.8M8 1.6v0" stroke="currentColor" stroke-width="1"/>'
         + '<path d="M5.2 3.1v7.6M10.8 3.1v7.6M2.4 8h11.2" stroke="currentColor" stroke-width=".75" opacity=".55"/>',
  MeshGrid: '<path d="M1.6 10.4L6 5.6h8.4L10 10.4z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/>'
          + '<path d="M4.1 8h8.4M7.5 5.6L5.1 10.4M10.3 5.6L7.9 10.4" stroke="currentColor" stroke-width=".8" opacity=".7"/>',
  MeshFromShape: '<path d="M2.2 4.6L6.4 2.2l4.2 2.4v4.8L6.4 11.8 2.2 9.4z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'
               + '<path d="M8.4 12.6h5.4M11.6 10.4l2.2 2.2-2.2 2.2" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>',
  EditMesh: '<path d="M2.2 11.4L6 5.2l3 3.2 2.4-3.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'
          + '<rect x="1" y="10.2" width="2.4" height="2.4" fill="currentColor"/>'
          + '<rect x="4.8" y="4" width="2.4" height="2.4" fill="currentColor"/>'
          + '<rect x="7.8" y="7.2" width="2.4" height="2.4" fill="currentColor"/>'
          + '<rect x="10.4" y="3" width="2.4" height="2.4" fill="currentColor"/>'
          + '<path d="M13.6 4.2v4M11.6 6.2h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".6"/>',
  Subdivide: '<path d="M2.4 13.2V6.4L8 3.4l5.6 3v6.8" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linejoin="round" opacity=".45"/>'
           + '<path d="M3.6 12.6c0-4 1.8-6.2 4.4-6.2s4.4 2.2 4.4 6.2" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>'
           + '<circle cx="2.4" cy="13.2" r="1.1" fill="currentColor" opacity=".55"/><circle cx="8" cy="3.4" r="1.1" fill="currentColor" opacity=".55"/>'
           + '<circle cx="13.6" cy="13.2" r="1.1" fill="currentColor" opacity=".55"/>',
  Weld: '<circle cx="5.4" cy="8" r="2.8" fill="none" stroke="currentColor" stroke-width="1.2"/>'
      + '<circle cx="10.6" cy="8" r="2.8" fill="none" stroke="currentColor" stroke-width="1.2"/>'
      + '<path d="M7.1 8h1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
      + '<path d="M4.4 3.6l1.4 1.4M11.6 3.6l-1.4 1.4" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".55"/>',
  FillHoles: '<path d="M1.8 4.2h12.4v7.6H1.8z" fill="none" stroke="currentColor" stroke-width="1.15"/>'
           + '<path d="M6 5.6h4.4l1.2 2.4-1.6 2.4H6.4L5 8z" fill="currentColor" opacity=".35"/>'
           + '<path d="M6 5.6h4.4l1.2 2.4-1.6 2.4H6.4L5 8z" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linejoin="round"/>',
  MeshMerge: '<path d="M2 5.4h4.6v5.2H2z" fill="none" stroke="currentColor" stroke-width="1.15"/>'
           + '<path d="M9.4 5.4H14v5.2H9.4z" fill="none" stroke="currentColor" stroke-width="1.15"/>'
           + '<path d="M6.6 5.4h2.8v5.2H6.6z" fill="none" stroke="currentColor" stroke-width="1.05" stroke-dasharray="1.7 1.5" opacity=".85"/>'
           + '<path d="M6.6 7.4h2.8M6.6 8.8h2.8" stroke="currentColor" stroke-width=".8" opacity=".45"/>',
  MeshTransform: '<path d="M2.4 9.6L6 6.4l3.4 3 3.6-3.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'
               + '<path d="M8 14.2V11M6.5 12.5L8 11l1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>'
               + '<path d="M8 1.8v3.4M6.5 3.3L8 1.8l1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>',
  MeshDisplace: '<path d="M1.8 11.2h12.4" stroke="currentColor" stroke-width="1.1" opacity=".45"/>'
              + '<path d="M1.8 8.4c2 0 2-4.4 4.1-4.4s2.1 4.4 4.2 4.4 2.1-3 4.1-3" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>'
              + '<path d="M3.6 11.2V9.4M7 11.2V6.6M10.4 11.2V9M13.6 11.2V7" stroke="currentColor" stroke-width=".85" opacity=".6"/>',

  // A folder with wireframe in it: the open tab, and a curve and a point.
  GeometricalSet: '<path d="M1.6 12.6V4.4h4.2l1.4 1.6h7.2v6.6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'
                + '<path d="M3.6 10.6c1.8 0 2-2.4 3.8-2.4s2 2.4 3.8 2.4" fill="none" stroke="currentColor" stroke-width="1.1"/>'
                + '<circle cx="12.4" cy="8.6" r="1.15" fill="currentColor"/>',
  // The same folder with a body in it.
  Body: '<path d="M1.6 12.6V4.4h4.2l1.4 1.6h7.2v6.6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'
      + '<path d="M8 6.6l3.4 1.8v3.2L8 13.4l-3.4-1.8V8.4z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/>',
  // A section carried along a rail: the rail, and the profile riding it.
  // A section turned about an axis: the axis dashed, the profile beside it,
  // and the ring it sweeps out.
  Revolve: '<path d="M8 1.4v13.2" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.6"/>'
         + '<ellipse cx="8" cy="8" rx="6" ry="2.4" fill="none" stroke="currentColor" stroke-width="1.2"/>'
         + '<rect x="10.4" y="6.4" width="2.6" height="3.2" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  // A body with its top corner taken off flush at a plane.
  Trim: '<path d="M2.6 13.4V4.2l5-2.8h6.2v9.2l-5 2.8z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round" opacity=".45"/>'
      + '<path d="M2.6 13.4V8.6l5-2.8h6.2M7.6 5.8v7.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  // An I, which is what the node is for nine times out of ten.
  Section: '<path d="M3.4 2.6h9.2v2.1H9.1v6.6h3.5v2.1H3.4v-2.1h3.5V4.7H3.4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  Sweep: '<path d="M1.8 11.6C4.4 11.6 5 4.6 8.2 4.6s3.8 4.4 6 4.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.2 1.6"/>'
       + '<ellipse cx="5.4" cy="8.6" rx="1.5" ry="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/>'
       + '<ellipse cx="11.6" cy="6.6" rx="1.5" ry="2.5" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/>',
  // The same curve twice, a constant distance apart.
  ParallelCurve: '<path d="M1.6 10.4c3.2 0 3.6-5.2 6.4-5.2s3.2 5.2 6.4 5.2" fill="none" stroke="currentColor" stroke-width="1.3"/>'
               + '<path d="M1.6 13.4c3.2 0 3.6-5.2 6.4-5.2s3.2 5.2 6.4 5.2" fill="none" stroke="currentColor" stroke-width="1.15" stroke-dasharray="2 1.6"/>',
  // A skin, and the wall it becomes.
  ThickSurface: '<path d="M1.8 5.4C4.6 5.4 5 2.4 8 2.4s3.4 3 6.2 3" fill="none" stroke="currentColor" stroke-width="1.3"/>'
              + '<path d="M1.8 9.4C4.6 9.4 5 6.4 8 6.4s3.4 3 6.2 3" fill="none" stroke="currentColor" stroke-width="1.3"/>'
              + '<path d="M1.8 5.4v4M14 5.4v4" stroke="currentColor" stroke-width="1.15"/>',
  // Two things crossing, and the crossing marked.
  Intersect: '<path d="M2 4.2h12M2 11.8h12" stroke="currentColor" stroke-width="1.15" opacity=".5"/>'
           + '<path d="M4.2 2.2l7.6 11.6" stroke="currentColor" stroke-width="1.3"/>'
           + '<circle cx="5.5" cy="4.2" r="1.5" fill="currentColor"/><circle cx="10.5" cy="11.8" r="1.5" fill="currentColor"/>',
  // A wall with a batter on it, hinged on the neutral line.
  Draft: '<path d="M4.4 12.6L6.4 3.4h3.2l2 9.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'
       + '<path d="M1.4 12.6h13.2" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.2 1.6"/>'
       + '<path d="M6.4 3.4v9.2" stroke="currentColor" stroke-width="1" opacity=".45"/>',
  Project: '<path d="M3 4.4C5 4.4 5 1.8 8 1.8s3 2.6 5 2.6" fill="none" stroke="currentColor" stroke-width="1.2"/>'
         + '<path d="M1.6 12.4h12.8" stroke="currentColor" stroke-width="1.2"/>'
         + '<path d="M3 6v4.6M8 3.4v7M13 6v4.6" stroke="currentColor" stroke-width="1" stroke-dasharray="1.6 1.8" opacity=".7"/>',
  part: '<path d="M2.5 4.2L8 1.5l5.5 2.7v7.6L8 14.5l-5.5-2.7z" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="1.9" fill="currentColor"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  //! The two pane switches: a window with a column down one side of it. Drawn
  //! as the thing they hold rather than as a chevron, so the pair reads as a
  //! plan of the screen.
  railPane: '<rect x="2.2" y="3" width="11.6" height="10" rx="1.6" fill="none" '
          + 'stroke="currentColor" stroke-width="1.2"/>'
          + '<rect x="3.6" y="4.4" width="2.8" height="7.2" rx=".6" fill="currentColor" '
          + 'opacity=".75"/>',
  defPane: '<rect x="2.2" y="3" width="11.6" height="10" rx="1.6" fill="none" '
         + 'stroke="currentColor" stroke-width="1.2"/>'
         + '<rect x="9.6" y="4.4" width="2.8" height="7.2" rx=".6" fill="currentColor" '
         + 'opacity=".75"/>',
  // A slider that could be taken from somewhere else wears this.
  wire: '<path d="M6.6 9.4L9.4 6.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
      + '<path d="M8.6 4.4l1.1-1.1a2.6 2.6 0 013.6 3.6l-1.1 1.1M7.4 11.6l-1.1 1.1a2.6 2.6 0 01-3.6-3.6l1.1-1.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  eyeOff: '<path d="M1.5 8S4 3.5 8 3.5s6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/><path d="M2.5 2.5l11 11" stroke="currentColor" stroke-width="1.3"/>',
};
const svg = body => '<svg viewBox="0 0 16 16" aria-hidden="true">' + body + "</svg>";

/* ------------------------------------------------------------ the labels */

//! Every button that carries a data-label gets one, wherever it is: the tool
//! rail, the sketcher's rail, anything added later. One element, fixed to the
//! window, placed beside whatever the cursor is on - because a rail that
//! scrolls clips anything drawn beside a button inside it, which is what was
//! quietly happening to all of these.
(function labelOnHover() {
  const tip = document.getElementById("tip");
  let shown = null;

  const place = target => {
    const box = target.getBoundingClientRect();
    tip.textContent = target.dataset.label || "";
    tip.classList.toggle("dim", !!target.disabled);
    tip.classList.add("on");
    const width = tip.offsetWidth, height = tip.offsetHeight;
    // A button in a row along the top is labelled below it; one in a rail down
    // the side is labelled beside it. Either way it must not cover its
    // neighbours, which is the whole reason it is not a browser tooltip.
    const below = box.top < 80;
    let x = below ? box.left + box.width / 2 - width / 2 : box.right + 9;
    let y = below ? box.bottom + 8 : box.top + box.height / 2 - height / 2;
    if (!below && x + width > innerWidth - 6) x = box.left - 9 - width;
    tip.style.left = Math.max(6, Math.min(innerWidth - width - 6, x)) + "px";
    tip.style.top = Math.max(6, Math.min(innerHeight - height - 6, y)) + "px";
  };

  const hide = () => { shown = null; tip.classList.remove("on"); };

  addEventListener("pointerover", event => {
    const target = event.target.closest && event.target.closest("[data-label]");
    if (!target) { if (shown) hide(); return; }
    shown = target;
    place(target);
  }, true);
  addEventListener("pointerout", event => {
    if (shown && event.target === shown) hide();
  }, true);
  // A button that vanishes under the cursor - a rail swapped for another one -
  // must not leave its label behind.
  addEventListener("pointerdown", hide, true);
  addEventListener("scroll", () => { if (shown) place(shown); }, true);
})();
// The menu goes away for anything that is not choosing from it: a click
// elsewhere, a scroll, Escape, or the tree being rebuilt under it.
addEventListener("pointerdown", event => {
  const menu = document.getElementById("menu");
  // The burger is left alone: it closes the menu itself, and closing it here
  // first would mean it could only ever open.
  if (menu && !menu.hidden && !menu.contains(event.target)
      && !event.target.closest("#btn-menu")) closeMenu();
}, true);
addEventListener("scroll", () => {
  const menu = document.getElementById("menu");
  if (menu && !menu.hidden) closeMenu();
}, true);
addEventListener("keydown", event => {
  const menu = document.getElementById("menu");
  if (event.key === "Escape" && menu && !menu.hidden) { closeMenu(); event.stopPropagation(); }
}, true);

const escapeHtml = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const escapeAttr = s => escapeHtml(s).replace(/"/g, "&quot;");

/* ------------------------------------------------------------------ toolbar */
function buildToolbar() {
  const rail = document.getElementById("rail");
  rail.textContent = "";
  const targets = {};
  const groups = state.schema.categories
    || [{ key: "datum" }, { key: "data" }, { key: "curve" },
        { key: "body" }, { key: "analysis" }, { key: "operation" }];
  //! COLLAPSIBLE ZONES, because a hundred and twenty buttons in one column is
  //! not a toolbar, it is a list you scroll past.
  //!
  //! The rule dividers that used to separate the categories said where one
  //! ended and the next began and nothing else - you still had to walk the
  //! whole rail to find the operations. A heading you can shut takes its
  //! category out of the way entirely, and what is shut is remembered, so a
  //! person who never uses meshes stops scrolling past them for good.
  //!
  //! Datums and curves are open to begin with because that is where a part
  //! starts. Nothing else is: the rail opens short and grows where it is
  //! asked to.
  const OPEN_FIRST = new Set(["datum", "curve", "body"]);
  groups.forEach(group => {
    const key = "rail:" + group.key;
    const remembered = recall("ocafcad/" + key);
    const shutNow = remembered ? remembered === "off" : !OPEN_FIRST.has(group.key);
    const head = document.createElement("button");
    head.type = "button";
    head.className = "rail-head" + (shutNow ? " shut" : "");
    head.dataset.group = group.key;
    head.innerHTML = '<span class="rail-twist">' + (shutNow ? "\u203a" : "\u02c5")
      + "</span><span>" + escapeHtml(group.label || group.key) + "</span>";
    head.title = (shutNow ? "Show " : "Hide ") + (group.label || group.key);
    rail.appendChild(head);
    const box = document.createElement("div");
    box.className = "rail-zone";
    box.dataset.group = group.key;
    box.hidden = shutNow;
    rail.appendChild(box);
    head.addEventListener("click", () => {
      const nowShut = !box.hidden;
      box.hidden = nowShut;
      head.classList.toggle("shut", nowShut);
      head.querySelector(".rail-twist").textContent = nowShut ? "\u203a" : "\u02c5";
      head.title = (nowShut ? "Show " : "Hide ") + (group.label || group.key);
      remember("ocafcad/" + key, nowShut ? "off" : "on");
      layout();
    });
    targets[group.key] = box;
  });
  //! A HEADING WITH NOTHING UNDER IT is a heading that teaches somebody the
  //! rail is longer than it is. A category is only there when something is in
  //! it - which is what lets a package bring a category of its own without
  //! everybody who has not loaded it scrolling past an empty word.
  const stocked = new Set(state.schema.types.filter(spec => !spec.hidden)
                                            .map(spec => spec.category));

  for (const spec of state.schema.types) {
    // A node nobody adds by hand has no button. Import makes these, and an
    // import of nothing is not a thing to offer.
    if (spec.hidden) continue;
    const button = document.createElement("button");
    button.className = "tool";
    button.innerHTML = svg(ICONS[spec.type] || ICONS.part);
    button.dataset.type = spec.type;
    button.dataset.label = spec.type;
    button.setAttribute("aria-label", spec.type);
    button.addEventListener("click", () => addFeature(spec.type));
    (targets[spec.category] || targets.operation || rail).appendChild(button);
  }
  for (const group of groups) {
    if (stocked.has(group.key)) continue;
    const box = targets[group.key];
    const head = rail.querySelector('.rail-head[data-group="' + group.key + '"]');
    if (box) box.remove();
    if (head) head.remove();
  }
  document.getElementById("btn-def-close").innerHTML = svg(ICONS.close);
  document.getElementById("ai-close").innerHTML = svg(ICONS.close);
  document.getElementById("btn-undo").innerHTML = svg(ICONS.undo);
  document.getElementById("btn-redo").innerHTML = svg(ICONS.redo);
  document.getElementById("btn-packages").innerHTML = svg(ICONS.packages);
  document.getElementById("btn-help").innerHTML = svg(ICONS.help);
  document.getElementById("btn-menu").innerHTML = svg(ICONS.menu);
  document.getElementById("btn-rail").innerHTML = svg(ICONS.railPane);
  document.getElementById("btn-panel").innerHTML = svg(ICONS.defPane);
  refreshSteps();
}

//! Fillet waits for its input, the way a CAD operation does.
function refreshToolbar() {
  const selected = feature(state.selected);
  for (const button of document.querySelectorAll(".tool[data-type]")) {
    const spec = schemaType(button.dataset.type);
    if (!spec) continue;
    if (spec.category === "operation") {
      const arg = spec.args.find(a => (a.kind === "ref" || a.kind === "refs") && a.consumes);
      const eligible = selected && arg && acceptsFrom(arg.accepts, selected)
        && !selected.consumedBy;
      button.disabled = !(ready && eligible);
      button.dataset.label = !ready ? "starting…"
        : eligible ? spec.type + " " + selected.name
        : selected && selected.consumedBy
          ? selected.name + " already has a " + (feature(selected.consumedBy) || {}).type
        : arg ? "Select " + arg.accepts.split(",").join(" or ") + " first"
        : spec.type;
    } else {
      button.disabled = !ready;
      button.dataset.label = spec.type;
    }
  }
}

/* ------------------------------------------------------- specification tree */

//! The rows as they are actually drawn, top to bottom, sets and all. A range
//! means "everything between these two ON THE SCREEN", and the screen is the
//! only thing that knows what that is: the tree nests, reorders by set and
//! hides what is filed away, so the document's own order is not it.
const treeOrder = [];

/* ------------------------------------------------ collapsing, and searching

   A TREE THAT DOES NOT COLLAPSE IS A LIST. Once a model has three geometrical
   sets with nine things in each, the thing you are looking for is off the
   bottom - and the answer every tree widget has had since the first one is a
   plus and a minus.

   What is shut is remembered by NAME for the sections and by ID for the sets,
   because "Datums" is the same section in every document and a set's id is
   only meaningful in this one. Kept across reloads, because reopening a file
   and finding everything you had folded away unfolded again is the tree
   forgetting what you told it.                                             */

//! Read back in start(), not here: at the top of the file `recall` has not
//! been reached yet, and a const read before its own declaration is a
//! ReferenceError that takes the whole page with it. This has bitten twice.
const shut = new Set();

function rememberShut() {
  remember("ocafcad/tree-shut", [...shut].join("\u0001"));
}

function toggleShut(key) {
  if (shut.has(key)) shut.delete(key); else shut.add(key);
  rememberShut();
  buildTree();
}

/* -------------------------------------------------- what opens folded

   A SET OF THREE THOUSAND PLACEMENTS IS NOT SOMETHING ANYBODY OPENED THE TREE
   TO READ. An imported building arrives with every set open, which is 9,227
   rows of which perhaps forty are the ones you came for - and the rest are
   the datums holding it up.

   So a set that is big when it is FIRST SEEN opens folded. Decided once per
   set and never again: fold it or open it after that and it stays as you left
   it, because that was a decision and this is only a starting point.       */

const SET_IS_BIG = 60;
const decided = new Set();
function seedFolds() {
  if (!state.tree) return;
  let any = false;
  for (const f of state.tree.features) {
    if (f.category !== "container" || decided.has(f.id)) continue;
    decided.add(f.id);
    if (kidCount(f.id) >= SET_IS_BIG) { shut.add(f.id); any = true; }
  }
  if (any) rememberShut();
}

/* ------------------------------------------------------ folding wholesale

   A MODEL WITH 1,665 SETS IN IT CANNOT BE FOLDED ONE SET AT A TIME. Scrolling
   the panel to find the next minus sign is not a way of tidying a tree, it is
   a way of spending an afternoon - and it is exactly the case a building
   imported from IFC arrives in: project, site, building, eleven storeys, a
   set per element, and every one of them open.

   So: fold everything, open everything, and fold or open one branch and all
   the way down it. Four lines each, on the header and on the menu.          */

//! Every set in the document, and the headings with them.
function foldAll(on, root = null) {
  //! A SET, NOT A LIST. `includes` inside a loop over every feature is six
  //! thousand times two thousand string comparisons on the branch this was
  //! found on - fourteen million of them to fold one folder.
  const inside = root ? new Set(withContents([root])) : null;
  for (const f of (state.tree ? state.tree.features : [])) {
    if (f.category !== "container") continue;
    if (inside && (f.id === root || !inside.has(f.id))) continue;
    if (on) shut.add(f.id); else shut.delete(f.id);
  }
  //! The root itself folds with its contents when the whole branch is asked
  //! for, because "fold this" means this, not everything under it.
  if (root) { if (on) shut.add(root); else shut.delete(root); }
  else for (const name of ["Datums", "Parameters", "Meshes", "PartBody"])
    if (on) shut.add("section:" + name); else shut.delete("section:" + name);
  rememberShut();
  buildTree();
  say((on ? "folded " : "opened ") + (root ? (feature(root) || {}).name || "that set"
                                            : "every set in the tree"));
}

//! The little button. One place, so the section headers and the sets get the
//! same thing and it behaves the same way in both.
function twist(key, many, label) {
  const button = document.createElement("button");
  button.className = "twist" + (many ? "" : " bare");
  button.type = "button";
  button.textContent = shut.has(key) ? "+" : "−";
  button.dataset.twist = key;
  if (!many) { button.tabIndex = -1; button.setAttribute("aria-hidden", "true"); return button; }
  button.title = (shut.has(key) ? "Show what is in " : "Fold away ") + label;
  button.setAttribute("aria-expanded", shut.has(key) ? "false" : "true");
  button.addEventListener("click", event => {
    event.stopPropagation();
    toggleShut(key);
  });
  return button;
}

/* ------------------------------------------------------------- the search

   DOUBLE-CLICK THE TITLE AND IT BECOMES A SEARCH BOX. The heading of a tree
   panel is the one piece of furniture nobody needs twice, and turning it into
   the search is how a person finds the box without hunting for it.

   What is typed is a REGULAR EXPRESSION when it is a valid one and a plain
   piece of text when it is not, so "wall" finds every wall and "^Wall\d+$"
   finds exactly the numbered ones - and a half-typed "wall(" is not an error,
   it is somebody still typing.                                             */

const search = { on: false, text: "" };

function searchRe() {
  const said = search.text.trim();
  if (!said) return null;
  try { return new RegExp(said, "i"); }
  catch (error) { return new RegExp(said.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
}

//! Which features survive the filter: the ones that match, and everything
//! that HOLDS one - a match three sets deep is no use if the sets it is in
//! are not drawn.
function searchKeeps() {
  const re = searchRe();
  if (!re) return null;
  const keep = new Set();
  for (const entry of state.tree.features) {
    if (!re.test(entry.name) && !re.test(entry.type)) continue;
    keep.add(entry.id);
    let up = entry.parent;
    for (let guard = 0; up && guard < 64; guard++) {
      keep.add(up);
      up = (feature(up) || {}).parent;
    }
  }
  return keep;
}

//! The name with the matching part marked, so a filtered tree says why each
//! row is still there.
function markedName(name, re) {
  if (!re) return null;
  const found = String(name).match(re);
  if (!found || !found[0]) return null;
  const at = found.index;
  return escapeHtml(name.slice(0, at)) + "<mark>" + escapeHtml(found[0]) + "</mark>"
       + escapeHtml(name.slice(at + found[0].length));
}

function openSearch(on) {
  search.on = on;
  const box = document.getElementById("tree-search");
  const title = document.getElementById("tree-title");
  box.hidden = !on;
  title.hidden = on;
  if (on) {
    // AUTOCOMPLETE OFF THE SETS, which is what the request was and the right
    // answer: a geometrical set is the thing a person names deliberately, so
    // it is the thing worth completing. Every other node is found by typing
    // three letters of it.
    const names = document.getElementById("tree-names");
    names.textContent = "";
    for (const one of state.tree.features.filter(f => f.category === "container")) {
      const option = document.createElement("option");
      option.value = one.name;
      names.appendChild(option);
    }
    box.value = search.text;
    box.focus();
    box.select();
  } else {
    search.text = "";
  }
  buildTree();
  layout();
}

/* ------------------------------------------------------- the text size

   A SPEC TREE IS READ FOR HOURS. It is the one panel where a person wants the
   text bigger, and the one where they sometimes want it smaller to get more
   of a long model on screen. Ctrl and the wheel over the tree, which is what
   every editor does, and a pair of buttons for the hands that do not know
   that. Remembered, because it is a preference and not a mode. */

let treeText = 1;

function setTreeText(scale) {
  treeText = Math.max(0.7, Math.min(2, Math.round(scale * 100) / 100));
  document.documentElement.style.setProperty("--tree-text", String(treeText));
  remember("ocafcad/tree-text", String(treeText));
  // The panel is sized by what is in it, so bigger text is a wider panel and
  // that is a layout change like any other.
  layout();
}

document.getElementById("tree").addEventListener("wheel", event => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  setTreeText(treeText * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });
document.getElementById("tree-fold").addEventListener("click", event => {
  event.stopPropagation();
  foldAll(true);
});
document.getElementById("tree-unfold").addEventListener("click", event => {
  event.stopPropagation();
  foldAll(false);
});
document.getElementById("tree-bigger").addEventListener("click", event => {
  event.stopPropagation();
  setTreeText(treeText * 1.1);
});
document.getElementById("tree-smaller").addEventListener("click", event => {
  event.stopPropagation();
  setTreeText(treeText / 1.1);
});

// The heading, and the strip it sits in: a double-click anywhere along the
// top of the panel opens the search, because nobody aims at a word.
document.getElementById("tree-head").addEventListener("dblclick", event => {
  if (event.target.closest("#tree-search")) return;
  openSearch(true);
});
document.getElementById("tree-search").addEventListener("input", event => {
  search.text = event.target.value;
  buildTree();
});
document.getElementById("tree-search").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.stopPropagation(); openSearch(false); }
  if (event.key === "Enter") {
    // The first thing that survived, selected - so typing a name and pressing
    // return goes there, which is what a search box is for.
    const first = treeOrder[0];
    if (first) select(first, false);
    event.preventDefault();
  }
});
document.getElementById("tree-search").addEventListener("blur", () => {
  if (!search.text.trim()) openSearch(false);
});

function buildTree() {
  //! Checked here rather than where it is set, because the document can change
  //! under it: opening another model, or deleting the set, leaves a remembered
  //! id pointing at nothing and everything new would be filed into a folder
  //! that is not there.
  if (state.workingIn && !(state.tree
      && state.tree.features.some(f => f.id === state.workingIn
                                    && f.category === "container")))
    state.workingIn = null;
  closeMenu();
  const list = document.getElementById("tree");
  list.textContent = "";
  treeOrder.length = 0;
  if (!state.tree) return;
  seedFolds();
  const keep = searchKeeps();
  const hit = searchRe();

  // The tree keeps CATIA's two sets and adds one: the features that compute
  // rather than build have no place in a part body. Anything filed into a set
  // of the user's own is drawn inside that set instead of here, so every
  // feature appears exactly once however deeply it is put away.
  const loose = state.tree.features.filter(f => !f.parent);
  //! A FOLDER SOMEBODY MADE IS A FOLDER AT THE TOP LEVEL.
  //!
  //! The four headings below are not features - they are a sorting of the
  //! loose features by what kind of thing they are, and they exist because a
  //! document with forty datums and one solid is unreadable as one list. A set
  //! the user made IS a feature, and putting it inside "PartBody" because it
  //! is not a datum files a folder called Origin under the part body, which is
  //! the wrong way up.
  //!
  //! So top-level containers are drawn first, at the top level, in document
  //! order. What is left over is sorted into the headings as before.
  const folders = loose.filter(f => f.category === "container");
  const rest = loose.filter(f => f.category !== "container");
  //! And when the document is ARRANGED - somebody has made folders - the
  //! headings stop insisting on themselves. A new part opens on Origin,
  //! Parameters, Relations and Part with nothing loose at all, and two empty
  //! headings under them would be two rows of nothing. A document with no
  //! folders keeps Datums and PartBody always there, the way it always has.
  const arranged = folders.length > 0;
  const sets = [
    { name: "Datums", optional: arranged,
      features: rest.filter(f => f.category === "datum") },
    { name: "Parameters", optional: true,
      features: rest.filter(f => f.category === "data") },
    { name: "Meshes", optional: true,
      features: rest.filter(f => f.category === "mesh") },
    { name: "PartBody", optional: arranged, features: rest.filter(f =>
        f.category !== "datum" && f.category !== "data" && f.category !== "mesh") },
  ];

  let shown = 0;
  //! The folders somebody made, at the top level, before any heading. In
  //! document order, so a part opens on Origin, Parameters, Relations, Part -
  //! the order they were written in, which is the order they are thought in.
  for (const folder of folders) {
    if (keep && !survives(folder, keep)) continue;
    list.appendChild(treeNode(folder, keep, hit));
    shown++;
  }

  for (const set of sets) {
    // Datums and PartBody are always there, the way CATIA has them. The sets
    // that only exist when something is in them do not announce themselves.
    if (!set.features.length && set.optional) continue;
    // While a search is running, a section with nothing left in it goes too -
    // four empty headings are four rows of nothing between you and the answer.
    const inside = keep ? set.features.filter(f => survives(f, keep)) : set.features;
    if (keep && !inside.length) continue;
    const key = "section:" + set.name;
    const folded = shut.has(key) && !keep;
    const header = document.createElement("li");
    header.className = "set-label";
    const label = document.createElement("span");
    label.textContent = set.name;
    header.append(twist(key, inside.length, set.name), label);
    // Clicking the words does what clicking the sign does, because the whole
    // row looks like a thing to press and a fourteen-pixel target is not one.
    if (inside.length) {
      header.style.cursor = "pointer";
      label.addEventListener("click", () => toggleShut(key));
    }
    list.appendChild(header);
    if (folded) continue;

    const branch = document.createElement("ul");
    branch.className = "branch";
    if (!inside.length) {
      const empty = document.createElement("li");
      empty.className = "node";
      empty.innerHTML = '<span class="kind" style="padding-left:22px">empty</span>';
      branch.appendChild(empty);
    }
    for (const entry of inside) { branch.appendChild(treeNode(entry, keep, hit)); shown++; }
    list.appendChild(branch);
  }
  if (keep && !shown) {
    const none = document.createElement("li");
    none.className = "tree-none";
    none.textContent = "nothing in the tree is called that";
    list.appendChild(none);
  }
}

//! One element of an open drawing, as a row. Picked here or picked in the
//! viewport is the same pick - sketcher.picked is the one list - so the tree
//! lights up with the drawing and a relation can be built by clicking two
//! rows.
function sketchTreeRow(element) {
  const li = document.createElement("li");
  const picked = sketcher.picked.includes(element.id);
  li.className = "node pick sketch-el" + (picked ? " selected" : "");
  li.tabIndex = 0;
  li.title = element.type + " " + element.id;
  const glyph = document.createElement("span");
  glyph.className = "glyph";
  //! The sketcher's own icon for that element type, which is the one on the
  //! button that drew it - so the row and the tool that made it look alike.
  glyph.innerHTML = svg(SKETCH_ICONS[element.type] || SKETCH_ICONS.select);
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = element.id;
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = element.type
    //! isConstruction, not a layer test. SKETCH_LAYER is the name of the
    //! DEFAULT layer - the string "0" - so reading a `.CONSTRUCTION` off it
    //! gives undefined, which matched every element that had never been put on
    //! a layer and labelled the whole drawing construction.
    + (isConstruction(element) ? " · construction" : "")
    + (element.layer && element.layer !== SKETCH_LAYER ? " · " + element.layer : "");
  li.append(glyph, label, kind);
  li.addEventListener("click", event => pickInSketch(element.id, event.shiftKey));
  return li;
}

//! And one relation. Clicking it does what clicking its mark in the drawing
//! does: takes it as the thing being looked at, which is how it is removed.
function sketchRelationRow(relation, at) {
  const li = document.createElement("li");
  li.className = "node pick sketch-rel" + (sketcher.relation === at ? " selected" : "");
  li.tabIndex = 0;
  const spec = SKETCH_RELATIONS.find(r => r.key === relation.type);
  const glyph = document.createElement("span");
  glyph.className = "glyph";
  glyph.innerHTML = svg(SKETCH_ICONS[relation.type] || SKETCH_ICONS.select);
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = (spec ? spec.label : relation.type);
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = (relation.of || []).join(", ");
  li.title = (spec ? spec.hint : relation.type) + " — " + kind.textContent;
  li.append(glyph, label, kind);
  li.addEventListener("click", () => {
    sketcher.relation = sketcher.relation === at ? -1 : at;
    sketcher.picked = [];
    refreshSketch();
  });
  return li;
}

//! Whether a feature survives the filter - itself, or because something
//! inside it did.
/* ------------------------------------------- the selection, without a rebuild

   SELECTING SOMETHING DOES NOT CHANGE THE TREE. It changes which row is
   marked, which is three class names - and building the whole tree again to
   set them cost 3,754 ms on a building, every time anything was clicked in
   the viewport. That is the difference between a model you can work in and
   one you cannot.                                                           */

function paintTree() {
  const several = state.picked.length > 1;
  for (const li of document.querySelectorAll("#tree li.node[data-id]")) {
    const id = li.dataset.id;
    li.classList.toggle("selected", id === state.selected);
    li.classList.toggle("alongside", several && state.picked.includes(id));
    li.classList.toggle("working", id === state.workingIn);
  }
}

//! THE ROW FOR A FEATURE, BROUGHT INTO VIEW - opening whatever is folded over
//! it on the way. The other half of clicking a body: the tree is where a
//! feature's name, its place in the building and everything it was made from
//! are, and on a model of seven thousand nodes finding the row by hand is not
//! a thing anybody is going to do twice.
function revealInTree(id, { open = true } = {}) {
  if (!id) return false;
  //! Every set above it is unfolded first, and the tree built once afterwards
  //! rather than once per level.
  if (open) {
    let moved = false;
    for (let f = feature(id); f; f = feature(f.parent)) {
      if (!f.parent) break;
      if (shut.delete(f.parent)) moved = true;
    }
    //! The headings are folded by their own keys, not by a feature id.
    for (const key of [...shut]) if (/^section:/.test(key)) { /* left alone */ }
    if (moved) { rememberShut(); buildTree(); }
  }
  const row = document.querySelector('#tree li.node[data-id="' + cssEscape(id) + '"]');
  if (!row) return false;
  settleOnRow(row);
  //! A flash, because a row that was scrolled to and is the same colour as the
  //! forty around it has not been found for you, it has been put in front of
  //! you.
  row.classList.remove("found");
  void row.offsetWidth;
  row.classList.add("found");
  setTimeout(() => row.classList.remove("found"), 1600);
  return true;
}

//! SCROLLED TO, THEN SCROLLED AGAIN UNTIL IT STOPS MOVING.
//!
//! One scrollIntoView lands NEAR the row on a big tree and not on it, and the
//! reason is two rules that are each right on their own. The rows off screen
//! are not laid out - `content-visibility: auto` is what keeps a seven
//! thousand feature tree from costing a second a redraw - so the browser
//! scrolls using `contain-intrinsic-size`, which is an ESTIMATE of 23px a row.
//! And the rows are not 23px: a name out of an IFC file wraps onto three and
//! four lines, and the estimate is wrong by a factor of three for hundreds of
//! them. Over that many rows the error is a screenful.
//!
//! What the scroll does is make the rows around the target real, which moves
//! the target. So it is scrolled again, and again, until the answer stops
//! changing - two or three frames in practice, and it converges because each
//! pass resolves the rows it just scrolled past.
//!
//! Reported as "it zooms close enough but not quite, yet when i double click
//! the object afterwards then it does what i need" - the second gesture worked
//! because by then the layout had settled, which is the whole diagnosis.
//!
//! Instantly rather than smoothly: a smooth scroll animates towards a position
//! computed from the estimates, and correcting it mid-flight fights the
//! animation. It arrives in one frame instead, which on a tree nobody is
//! watching scroll is what was wanted anyway.
//! HOW LONG TO KEEP CORRECTING. Eight frames was not enough: measured on the
//! reported building, two rows landed dead centre and a third finished 340px
//! out of a 425px panel, because the rows above it were still being laid out
//! after the loop had given up. Rendering a screenful of wrapped names is not
//! done in eight frames on a tree of seven thousand.
const SETTLE_MS = 800;

function settleOnRow(row) {
  const panel = document.getElementById("tree");
  if (!panel) return;
  const until = performance.now() + SETTLE_MS;
  let watching = true;
  //! AND IT LETS GO THE MOMENT A HAND TOUCHES IT. Correcting for the best part
  //! of a second is right when nobody is doing anything else and is a fight if
  //! they have started to scroll - being dragged back to a row you were
  //! scrolling away from is worse than the row being off centre.
  const stop = () => { watching = false; };
  for (const name of ["wheel", "pointerdown", "keydown"])
    panel.addEventListener(name, stop, { once: true, passive: true });

  const step = () => {
    if (!watching || !row.isConnected) { done(); return; }
    const r = row.getBoundingClientRect(), p = panel.getBoundingClientRect();
    //! Only when it is actually out of place, so a row that has settled is
    //! left alone and the loop costs one rectangle a frame.
    if (Math.abs((r.top + r.height / 2) - (p.top + p.height / 2)) > 2)
      row.scrollIntoView({ block: "center", behavior: "auto" });
    if (performance.now() < until) requestAnimationFrame(step); else done();
  };
  const done = () => {
    for (const name of ["wheel", "pointerdown", "keydown"])
      panel.removeEventListener(name, stop);
  };
  requestAnimationFrame(step);
}

//! An id is ours and short, but it goes into a selector, so it is escaped.
const cssEscape = value => (window.CSS && CSS.escape)
  ? CSS.escape(String(value)) : String(value).replace(/[^\w-]/g, "\\$&");

function survives(entry, keep) {
  return !keep || keep.has(entry.id);
}

//! Is every last thing in this set put away? Stops at the first that is not.
function allHidden(id) {
  let any = false;
  //! BY ID, ALL THE WAY DOWN. This was handed a feature where it wanted an
  //! id - `walk(child)` rather than `walk(child.id)` - so the index it asks
  //! answered "no children" for every set inside a set, the walk stopped one
  //! level in, and a folder whose contents are folders never found anything to
  //! be hidden or showing. On a part that is nothing: the sets hold bodies. On
  //! a building, where every storey is sets of sets, it meant the eye on a
  //! storey stayed open however much of it you put away - the model went, the
  //! tree said it had not.
  const walk = set => {
    for (const child of kidsOf(set)) {
      if (child.category === "container") { if (walk(child.id)) return true; continue; }
      any = true;
      if (!(state.hidden.has(child.id) || child.visible === false)) return true;
    }
    return false;
  };
  const showing = walk(id);
  return any && !showing;
}

const glyphCache = new Map();
function glyphFor(type) {
  let made = glyphCache.get(type);
  if (!made) {
    made = document.createElement("span");
    made.className = "glyph";
    made.innerHTML = svg(ICONS[type] || ICONS.part);
    glyphCache.set(type, made);
  }
  return made.cloneNode(true);
}

function treeNode(entry, keep = null, hit = null) {
  const consumed = !!entry.consumedBy;
  //! A SET'S EYE IS ABOUT WHAT IS IN IT. A folder has no geometry of its own,
  //! so "is it hidden" is a question about its contents - shut when everything
  //! inside is hidden, open while any of it is showing. An empty folder reads
  //! as showing, because there is nothing in it to be putting away.
  //! WALKED UNTIL IT KNOWS, not walked to the end. "Is everything in here
  //! hidden" is answered by the first thing that is not, and a set of three
  //! thousand placements answers on its first child.
  const hidden = entry.category === "container" ? allHidden(entry.id)
    //! `visible === false` is the document saying so - a body something
    //! swallowed - and it reads the same way to the eye as this view's own
    //! hidden list, because to the person looking at it, it is the same fact.
    : state.hidden.has(entry.id) || entry.visible === false;
  treeOrder.push(entry.id);

  const li = document.createElement("li");
  //! The row knows which feature it is, so the selection can be repainted
  //! without the tree being built again, and so a body clicked in the viewport
  //! can be found in it. See paintTree and revealInTree.
  li.dataset.id = entry.id;
  li.className = "node pick " + entry.category + (consumed ? " consumed" : "")
    //! The set being worked in is marked in the tree and nowhere else,
    //! because the tree is where you would look to find out - and a status
    //! line saying it is a status line you stop reading by lunchtime.
    + (entry.id === state.workingIn ? " working" : "")
    + (entry.error ? " failed" : "")
    + (entry.id === state.selected ? " selected" : "")
    + (state.picked.length > 1 && state.picked.includes(entry.id) ? " alongside" : "");
  li.tabIndex = 0;
  li.title = consumed
    ? entry.name + " is consumed by " + (feature(entry.consumedBy) || {}).name
      + " — it stays in the tree, not in the 3D view"
    : (schemaType(entry.type) || {}).summary || entry.type;

  //! THE SAME ICON, COPIED, not parsed again. Seven thousand rows meant seven
  //! thousand runs of the HTML parser over the same dozen glyphs; cloning the
  //! one that was already made is the same picture for none of the work.
  const glyph = glyphFor(entry.type);

  const label = document.createElement("span");
  label.className = "label";
  const marked = markedName(entry.name, hit);
  if (marked) label.innerHTML = marked; else label.textContent = entry.name;
  // The whole name, whatever the panel's width does to it.
  label.title = entry.name;

  const kind = document.createElement("span");
  kind.className = "kind";
  // A feature that computes says what it computed, where a solid says its type.
  kind.textContent = entry.error ? "error"
    // A sketch says what is drawn on it, ahead of everything else: it is what
    // you want to know about a sketch, and a sketch stays worth opening after
    // a pad has consumed it - which is the whole point of one. Only the count
    // here, though: the tree has a name to fit in beside it, and the whole of
    // it is in the panel.
    : entry.sketch ? (entry.sketch.drawing.elements.length || "empty")
        + (entry.sketch.drawing.elements.length === 1 ? " element"
           : entry.sketch.drawing.elements.length ? " elements" : "")
    // A consumed feature is drawn struck through and says what ate it in its
    // tooltip; the word "hidden" here said the same word the eye says about a
    // different thing entirely, which is two meanings for one word in one row.
    : consumed ? "in " + ((feature(entry.consumedBy) || {}).name || "another feature")
    // A SET SAYS HOW MANY THINGS ARE IN IT, not how many strings its summary
    // happened to be written as. "3 texts" is the storage talking; what a
    // person wants to know about a folder is how much is in it.
    : entry.category === "container"
      ? (count => count ? count + (count === 1 ? " item" : " items") : "empty")
        (kidCount(entry.id))
    : entry.data && !entry.built
      ? entry.data.count + " " + entry.data.kind + (entry.data.count === 1 ? "" : "s")
      : entry.type.toLowerCase();

  li.append(glyph, label, kind);

  //! A SET GETS AN EYE TOO, and it is the only row whose eye is about
  //! something other than itself. A folder has no geometry - `built` is false
  //! on one - so the test that gave every other row its eye left folders
  //! without, and hiding a geometrical set meant opening it and clicking eight
  //! eyes. What the eye reads on a folder is what is INSIDE it: shut when
  //! everything in there is hidden, open while any of it is showing, which is
  //! what makes one click put a whole set away and one click bring it back.
  //!
  //! AND SO DOES A BODY SOMETHING SWALLOWED. It was left out on the grounds
  //! that a consumed body is not drawn - which is true, and is a fact about
  //! its VISIBILITY, which is the one thing the eye is for. A fillet's cube is
  //! still in the tree, still editable, still the thing the fillet was made
  //! from, and wanting to look at it is the ordinary reason anybody opens a
  //! tree at all. So it gets the same switch as everything else.
  if (entry.built || entry.category === "container") {
    // The same switch a sketch layer has: always there, pressed or not, one
    // click either way. An eye that only appears on hover is a control you
    // have to know about before you can find it.
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "eye" + (hidden ? " off" : "");
    eye.innerHTML = svg(hidden ? ICONS.eyeOff : ICONS.eye);
    eye.title = entry.category === "container"
      ? (hidden ? "Everything in this set is hidden. Click to show it all."
                : "Click to hide everything in this set.")
      : consumed && hidden
        ? (feature(entry.consumedBy) || {}).name
          + " was made from this, so it is not drawn. Click to show it anyway."
      : consumed
        ? "Shown, although " + ((feature(entry.consumedBy) || {}).name || "another feature")
          + " was made from it. Click to put it away again."
      : hidden ? "Hidden in the 3D view. Click to show it."
               : "Showing. Click to hide it in the 3D view.";
    eye.setAttribute("aria-pressed", String(!hidden));
    eye.addEventListener("click", event => { event.stopPropagation(); showFeature(entry.id, hidden); });
    li.appendChild(eye);
  }

  li.addEventListener("click", event => {
    // The two conventions every file list has had for thirty years, and they
    // are not the same gesture: shift takes the block from the last thing
    // clicked to this one, ctrl takes this one and leaves the rest alone.
    if (event.shiftKey) pickRange(entry.id);
    else if (event.ctrlKey || event.metaKey) pickAlso(entry.id);
    else select(entry.id, false);
  });
  li.addEventListener("dblclick", () => {
    // A sketch opens into the sketcher and a camera opens into its view: the
    // gesture is the same one either way - double-click steps INTO the thing.
    // Doubling on the camera you are already looking through steps back out,
    // so the way in is also the way out. Everything else opens its definition.
    if (entry.sketch) { select(entry.id, false); enterSketch(entry.id); return; }
    if (entry.type === "Camera") {
      select(entry.id, false);
      if (through.id === entry.id) leaveThrough(true); else lookThrough(entry.id);
      return;
    }
    select(entry.id, true);
  });
  li.addEventListener("keydown", event => {
    if (event.key === "Enter") { select(entry.id, true); event.preventDefault(); }
  });
  li.addEventListener("contextmenu", event => {
    event.preventDefault();
    event.stopPropagation();
    // A right-click ON the selection is about the selection. One outside it is
    // about the row it landed on, and takes the selection with it - otherwise
    // the menu would be offering to delete four things you can no longer see
    // marked.
    if (!state.picked.includes(entry.id)) select(entry.id, false);
    openMenu(event, entry);
  });

  // A set carries its contents inside it. Nothing else about the node changes:
  // a set is a folder, not an operation, so what is in one is drawn, wired and
  // rebuilt exactly as it was before it was put away.
  //! BLACK-BOXED, so the tree shows one row. Not folded - folded is a thing you
  //! did to see less of, and reopens; this is a thing the COMPONENT is, it
  //! saves with the model, and what is inside it is not the reader's business
  //! until they white-box it again. CATIA draws the same distinction and for
  //! the same reason: a user feature you can unfold by accident is not a user
  //! feature, it is a folder.
  if (entry.category === "container" && boxed(entry)) {
    const badge = document.createElement("span");
    badge.className = "kind boxed";
    badge.textContent = (entry.contents || []).length + " inside";
    badge.title = "Black-boxed. Right-click to white-box it and see the tree again.";
    li.appendChild(badge);
    li.classList.add("blackbox");
    return li;
  }

  if (entry.category === "container") {
    const all = kidsOf(entry.id);
    const inside = keep ? all.filter(f => survives(f, keep)) : all;
    // A SEARCH OPENS WHAT IT FOUND. Folding is a thing you did on purpose and
    // it is still remembered, but a set that is shut is not a reason to hide
    // the answer to what you just typed.
    const folded = shut.has(entry.id) && !keep;
    li.insertBefore(twist(entry.id, inside.length, entry.name), li.firstChild);
    const branch = document.createElement("ul");
    branch.className = "branch";
    branch.hidden = folded;
    //! A FOLDED BRANCH COSTS NOTHING, which is what makes folding worth doing.
    //!
    //! This built every row inside a shut folder and then hid the lot, so
    //! folding a set of three thousand placements saved a scroll and not one
    //! millisecond - the rows were still made, still laid out, still there to
    //! be walked on the next redraw. A building came in at 9,227 rows in the
    //! DOM with most of them behind a plus sign.
    //!
    //! Now shut means not built. The tree costs what is OPEN in it, and "fold
    //! everything" is the answer to a big model rather than a tidier way of
    //! looking at the same cost.
    if (folded) {
      const holder = document.createElement("li");
      holder.className = "holds";
      holder.append(li, branch);
      return holder;
    }
    if (!inside.length) {
      const empty = document.createElement("li");
      empty.className = "node";
      empty.innerHTML = '<span class="kind" style="padding-left:22px">empty</span>';
      branch.appendChild(empty);
    }
    for (const child of inside) branch.appendChild(treeNode(child, keep, hit));
    const holder = document.createElement("li");
    holder.className = "holds";
    holder.append(li, branch);
    return holder;
  }
  //! A SKETCH IS A FOLDER TOO, BUT ONLY FROM INSIDE IT.
  //!
  //! The elements of a drawing are a tree in their own right - a rectangle, an
  //! arc, the line it was filleted off - and while somebody is drawing they are
  //! the thing being worked on, so they belong in the tree like anything else.
  //! From OUTSIDE the sketch they are not: a part with nine sketches of a dozen
  //! elements each would put a hundred rows nobody is looking at between the
  //! reader and the part, and the whole point of a sketch as a feature is that
  //! it is ONE thing to the model around it.
  //!
  //! So the branch exists exactly while the sketch is open, and folds back to
  //! one row on the way out. That is CATIA's behaviour and it is the same
  //! argument as the black box above: what is inside a thing is not the
  //! reader's business until they go in.
  //!
  //! Nothing here is a feature. The drawing is one string on one label - which
  //! is what makes the sketcher, the node editor and the model file three
  //! windows onto one text - so these rows are a VIEW of that string, and
  //! clicking one picks it in the sketcher exactly as clicking the geometry
  //! would.
  if (entry.sketch && sketcher.id === entry.id) {
    //! What is STORED, not the mid-drag preview: the tree is a list of what
    //! is in the drawing, and a row does not appear or vanish because
    //! something is being dragged past it.
    const drawing = readSketch(entry.sketch.drawing);
    const elements = (drawing && drawing.elements) || [];
    const folded = shut.has("sketch:" + entry.id) && !keep;
    li.insertBefore(twist("sketch:" + entry.id, elements.length, entry.name), li.firstChild);
    const branch = document.createElement("ul");
    branch.className = "branch";
    branch.hidden = folded;
    if (!elements.length) {
      const empty = document.createElement("li");
      empty.className = "node";
      empty.innerHTML = '<span class="kind" style="padding-left:22px">nothing drawn yet</span>';
      branch.appendChild(empty);
    }
    for (const element of elements) branch.appendChild(sketchTreeRow(element));
    //! The relations after the elements, because that is the order they are
    //! made in and the order they are read in: these lines, held like this.
    for (let at = 0; at < (drawing.constraints || []).length; at++)
      branch.appendChild(sketchRelationRow(drawing.constraints[at], at));
    const holder = document.createElement("li");
    holder.className = "holds";
    holder.append(li, branch);
    return holder;
  }

  // Everything that is not a set gets the same blank box where the sign would
  // be, so the names all line up.
  li.insertBefore(twist(entry.id, 0, entry.name), li.firstChild);
  return li;
}

//! One line in the status bar, in place of the selection readout. It lasts
//! until the next selection changes, which is the next thing the reader does.
function say(text) {
  document.getElementById("status-sel").textContent = text;
}

/* ================================================== never go quiet

   THE ONE THING AN INTERFACE MUST NEVER DO is stop moving and not say why.

   A building of six thousand features takes fifteen seconds to build however
   clever anybody is about it - the booleans alone are ten of them - and a
   fifteen-second silence is indistinguishable from a crash. So the page says
   what it is doing and keeps saying it, and the kernel hands the thread back
   every twenty-four milliseconds so that saying it is possible at all.

   Two rules, and the second matters as much as the first:

     never go quiet for long          the panel appears
     never flash for something short  it does not appear for a quarter of a
                                      second's work, because a spinner that
                                      blinks on every edit is worse than none  */

const WORKING_AFTER_MS = 260;
const working = { since: 0, timer: null, showing: false, what: "", much: "" };

function showWorking(what, much = "", part = -1) {
  working.what = what; working.much = much;
  const panel = document.getElementById("working");
  if (!panel) return;
  if (!working.showing) {
    if (!working.timer) {
      working.since = performance.now();
      //! HELD BACK A QUARTER OF A SECOND. Most edits finish inside it and
      //! never show anything at all, which is the point: the panel means
      //! "this is going to take a moment", and it has to be true.
      working.timer = setTimeout(() => {
        working.timer = null;
        if (!working.what) return;
        working.showing = true;
        panel.hidden = false;
        paintWorking();
      }, WORKING_AFTER_MS);
    }
    return;
  }
  paintWorking(part);
}

function paintWorking(part = -1) {
  document.getElementById("working-what").textContent = working.what;
  document.getElementById("working-much").textContent = working.much;
  const fill = document.getElementById("working-fill");
  if (fill) fill.style.width = part >= 0 ? Math.round(part * 100) + "%" : "0%";
}

function doneWorking() {
  working.what = ""; working.much = "";
  if (working.timer) { clearTimeout(working.timer); working.timer = null; }
  const panel = document.getElementById("working");
  if (panel) panel.hidden = true;
  working.showing = false;
}

//! WHAT THE KERNEL IS DOING, said in the words a person would use. The
//! numbers come from the regeneration itself - see settleSlowly - so "4,310
//! of 6,010" is the walk's own count and not a guess about how long it might
//! take.
function watchBuilding(step) {
  const total = step.total || 0;
  const done = step.done || 0;
  const wording = { reading: "Reading the model", building: "Building the model",
                    rebuilding: "Rebuilding" }[step.stage] || "Working";
  showWorking(wording + "\u2026",
              total ? done.toLocaleString() + " of " + total.toLocaleString()
                      + " features" + (step.failed ? " \u00b7 " + step.failed + " in error" : "")
                    : "",
              total ? done / total : -1);
}

/* ---------------------------------------------------------- context menu

   Right-click on a node. A set is the reason this exists: it has a boundary,
   so there are two questions worth asking of it that no slider can answer -
   what crosses that boundary, and what happens if the set goes away.        */

function closeMenu() {
  const menu = document.getElementById("menu");
  menu.hidden = true;
  menu.textContent = "";
  const button = document.getElementById("btn-menu");
  if (button) button.setAttribute("aria-expanded", "false");
  for (const other of document.querySelectorAll("#mesh-bar [data-menu]"))
    other.setAttribute("aria-expanded", "false");
}

//! One line in a menu. Both menus are the same list in the same place - only
//! the questions differ - so they are built the same way. An item with nothing
//! to run is a line that says something rather than a line to press.
function menuItem(label, note, run) {
  const menu = document.getElementById("menu");
  const li = document.createElement("li");
  li.innerHTML = '<span class="menu-label">' + escapeHtml(label) + "</span>"
    + (note ? '<span class="menu-note">' + escapeHtml(note) + "</span>" : "");
  if (run) li.addEventListener("click", () => { closeMenu(); run(); });
  else li.className = "off";
  menu.appendChild(li);
  return li;
}

function menuHead(text) {
  const li = document.createElement("li");
  li.className = "menu-head";
  li.textContent = text;
  document.getElementById("menu").appendChild(li);
}

const menuRule = () =>
  document.getElementById("menu").appendChild(document.createElement("hr"));

//! Shown, then placed: the size it measures is the size it will be. With `up`
//! the y given is the menu's BOTTOM rather than its top, which is what a menu
//! hanging off a bar along the bottom of the window needs.
//!
//! A MENU NEVER GOES OFF THE SCREEN, whatever is in it. Clamping the top was
//! not enough: a menu taller than the window still ran off the bottom, and the
//! items past the edge were unreachable. So it is given the taller of the two
//! sides of the cursor to live in, capped to it, and told to scroll - which is
//! what a long menu does everywhere else. Middle-drag scrolls it too, because
//! a trackpad wheel over a menu is not always a scroll.
const MENU_EDGE = 8;
function placeMenu(x, y, up = false) {
  const menu = document.getElementById("menu");
  menu.hidden = false;
  menu.style.maxHeight = "";
  menu.scrollTop = 0;
  const natural = menu.getBoundingClientRect().height;
  const width = menu.getBoundingClientRect().width;

  // Which side of the cursor it hangs from. Its own side if it fits there,
  // otherwise whichever side has more room - and a menu that fits nowhere
  // takes the bigger half and scrolls.
  const below = innerHeight - y - MENU_EDGE;
  const above = y - MENU_EDGE;
  const wantsUp = up ? natural <= above || above >= below
                     : natural > below && above > below;
  const room = Math.max(120, wantsUp ? above : below);
  const height = Math.min(natural, room);
  menu.style.maxHeight = room + "px";
  menu.dataset.scrolls = natural > room ? "1" : "";
  menu.style.left = Math.max(MENU_EDGE, Math.min(x, innerWidth - width - MENU_EDGE)) + "px";
  menu.style.top = Math.max(MENU_EDGE, wantsUp ? y - height : Math.min(y, innerHeight - height - MENU_EDGE)) + "px";
}

//! Middle-drag anywhere in a menu scrolls it, the way it does in a drawing
//! list. A long menu on a trackpad otherwise needs a gesture the pointer is
//! already busy with.
{
  const menu = document.getElementById("menu");
  let grab = null;
  menu.addEventListener("pointerdown", event => {
    if (event.button !== 1) return;
    event.preventDefault();
    grab = { y: event.clientY, top: menu.scrollTop };
    menu.setPointerCapture(event.pointerId);
  });
  menu.addEventListener("pointermove", event => {
    if (!grab) return;
    menu.scrollTop = grab.top - (event.clientY - grab.y);
  });
  const let_go = () => { grab = null; };
  menu.addEventListener("pointerup", let_go);
  menu.addEventListener("pointercancel", let_go);
  // A middle click in a menu is a scroll gesture, never a paste or a new tab.
  menu.addEventListener("auxclick", event => { if (event.button === 1) event.preventDefault(); });
}

/* -------------------------------------------------------- the document menu

   The first button, top left, where a file menu has always been. Everything
   here is about the document as a file: what comes in, what goes out, and the
   text the whole thing really is.                                           */

function openDocMenu() {
  const menu = document.getElementById("menu");
  menu.textContent = "";

  menuHead("Import");
  menuItem("From a file…", FORMATS.filter(f => f.read).map(f => f.name).join(", "),
           () => fileInput.click());
  menuItem("A set from a model file…",
           "a geometrical set out of another model, as a feature to supply",
           () => reuseInput.click());
  menuRule();

  menuHead("Export");
  for (const format of FORMATS.filter(f => f.write))
    menuItem(format.name, format.short, () => exportAs(format.key));
  menuRule();

  menuHead("Viewport");
  // WHO OWNS THE LEFT BUTTON. Asked here because it is a preference and not a
  // mode: some hands want the widget under the button and the camera behind a
  // key, some want it the other way round, and neither is wrong.
  menuItem(altToOrbit ? "Alt to orbit" : "Drag to orbit",
    altToOrbit ? "Alt: left tumbles, middle tracks, right dollies"
               : "the left button orbits; the widgets need a direct hit",
    () => {
      altToOrbit = !altToOrbit;
      remember("ocafcad/altnav", altToOrbit ? "on" : "off");
      say(altToOrbit
        ? "Alt and the left button tumbles, the middle tracks, the right dollies"
        : "drag to orbit · the widgets take the button where they are");
    }).classList.add("on");
  menuItem("Lens…", "focal length, and what it does to the perspective",
    () => toggleLens(true));
  menuItem("Section… · X", "cut the model open, and say how the cut is drawn",
    () => toggleSection(true));
  menuItem("A camera from this view", "the shot you are looking at, as a node",
    () => cameraFromView());
  menuRule();

  menuHead("Document");
  menuItem("Model file as text…", "read it, or paste one in", () => openModelDialog());
  menuItem("A branch as its own file…", "pick a set and take it out",
           () => openBranchMenu());
  menuItem("Packages…", "what is on the shelf", () => togglePackages(true));
  //! A WAY BACK OUT, and the reason it exists is worth writing down.
  //!
  //! A body an operation was built FROM can be shown anyway - that is a real
  //! gesture and a real edit. A bug once applied it to everything inside a set
  //! rather than to the row that was clicked, so one click could put the flag
  //! on hundreds of features and save all of it. The flag was fixed at the
  //! source; a FILE already carrying them was not recoverable from in here,
  //! because undoing it meant finding and re-clicking every one.
  //!
  //! Offered only when there is something to clear, and it says how many, so
  //! it is a repair somebody reaches for knowingly rather than a button that
  //! silently changes a document.
  const overruled = (state.tree ? state.tree.features : [])
    .filter(f => f.shownAnyway).map(f => f.id);
  if (overruled.length)
    menuItem("Put " + overruled.length + " overruled "
             + (overruled.length === 1 ? "body" : "bodies") + " back",
             "bodies drawn although something was built from them",
             () => clearOverrides(overruled));
  placeMenu(8, 44);
  const button = document.getElementById("btn-menu");
  button.setAttribute("aria-expanded", "true");
}

//! Every "show it anyway" in the document, undone in one edit. One trip
//! through the undo stack rather than one per feature, so it is a single
//! ctrl-Z away if it was not what somebody wanted.
async function clearOverrides(ids) {
  if (!ids.length) return;
  try {
    //! ONE EDIT, not one per body. Sent as a list because each of these
    //! rebuilds the document's tree, and a building of seven and a half
    //! thousand features took twelve minutes to clear 715 of them one at a
    //! time - which is the same fault, in the other direction, as the bug that
    //! made 715 of them in the first place.
    await mdl.run({ op: "shown", ids, on: false });
    say(ids.length + (ids.length === 1 ? " body is" : " bodies are")
        + " back to being replaced by what was made from them");
  } catch (err) { showError(err.message); }
}

/* ---------------------------------------------- a branch out into a file

   The reason a thing is filed anywhere. The sets are listed with what each
   holds; picking one writes a model file containing that set, everything under
   it, and everything those read from - so what comes out opens and rebuilds
   rather than arriving as a list of orphans.                               */

async function openBranchMenu() {
  const menu = document.getElementById("menu");
  menu.textContent = "";
  const model = await mdl.snapshot();
  const rows = branchesIn(model);
  menu.textContent = "";
  menuHead("Take a branch out");
  for (const row of rows)
    menuItem(row.name, row.whole ? "the whole document · " + row.holds + " features"
               : (row.type === "Body" ? "body" : "set") + " · " + row.holds
                 + (row.holds === 1 ? " feature" : " features"),
             row.holds ? () => saveBranch(model, row) : null);
  if (rows.length === 1)
    menuItem("No sets yet", "file things under a Geometrical Set or a Body first", null);
  placeMenu(8, 44);
}

async function saveBranch(model, row) {
  const taken = row.whole ? model : branchOf(model, row.id);
  if (!taken) { say("that branch is not in the document any more"); return; }
  const filename = String(taken.name || "branch").replace(/[^\w.-]+/g, "-") + ".model.json";
  const brought = (taken.branch && taken.branch.brought.length) || 0;
  const note = taken.features.length + " features"
    + (brought ? ", " + brought + " of them brought in from outside the set because "
        + "something in it reads from them" : "");
  const how = await offerFile(filename, JSON.stringify(taken, null, 2),
    "Take out " + row.name,
    "A model file of its own: " + note + ". Open it here, or send it on.");
  if (how === "saved") say(filename + " saved · " + note);
  else if (how === "shown") say(filename + " · " + note);
  else say("not saved");
}

//! Deepest first. A feature something else reads from cannot go until the
//! thing reading it has gone, so deleting a block that contains both a sketch
//! and the pad made from it has to take the pad first - and the order a person
//! happened to click them in says nothing about which that is.
function inFallingOrder(ids) {
  const left = new Set(ids);
  const out = [];
  while (left.size) {
    const rest = [...left];
    // Nothing still waiting reads from these, so they are the top of what is
    // left and they can go now.
    const free = rest.filter(id => !rest.some(other => other !== id && dependsOn(other, id)));
    if (!free.length) { out.push(...rest); break; }   // a cycle cannot happen; do not hang if it does
    for (const id of free) { out.push(id); left.delete(id); }
  }
  return out;
}

//! Everything the menu is about. A right-click inside a selection means the
//! selection - that is what selecting several of them was FOR - and one
//! outside it means the row it landed on, which by now is the selection too.
function menuTargets(entry) {
  return state.picked.length > 1 && state.picked.includes(entry.id)
    ? state.picked.slice() : [entry.id];
}

//! ONLY THE TOPS OF A SELECTION, for anything that MOVES things.
//!
//! Shift-clicking two sets in the tree picks everything drawn between them,
//! which includes what is inside the first one - that is what a range
//! selection in a tree means and it is the right answer for hiding, deleting
//! and duplicating, all of which are about every feature named.
//!
//! Moving is not like those. A child whose parent is also being moved is
//! already going where its parent goes, and re-parenting it as well files it
//! directly in the destination - so the set it came out of arrives empty and
//! its contents arrive loose beside it. Two sets dragged into a third came out
//! as one set and a pile, which is exactly the shape of that mistake.
//!
//! So a move asks for the roots: the members of the selection that do not have
//! another member above them. Everything else follows, untouched, because
//! nothing about it changed.
function topOf(ids) {
  const chosen = new Set(ids);
  const insideAnother = id => {
    for (let up = (feature(id) || {}).parent; up; up = (feature(up) || {}).parent)
      if (chosen.has(up)) return true;
    return false;
  };
  return ids.filter(id => !insideAnother(id));
}

function openMenu(event, entry) {
  const menu = document.getElementById("menu");
  menu.textContent = "";
  const item = (label, note, run) => menuItem(label, note, run);
  const rule = () => menuRule();
  const many = menuTargets(entry);
  const several = many.length > 1;
  //! "and four others" rather than nothing: a menu that does not say how many
  //! things it is about is a menu that deletes three more than you meant.
  const about = one => several ? many.length + " features" : one;

  if (entry.category === "container" && !several) {
    const inputs = (entry.inputs || []).map(id => (feature(id) || {}).name || id);
    const outputs = (entry.outputs || []).map(id => (feature(id) || {}).name || id);
    item("Inputs", inputs.length ? inputs.length + " from outside" : "nothing comes in",
         () => showBoundary(entry));
    item(state.workingIn === entry.id ? "Stop being the current set" : "Make current",
         state.workingIn === entry.id
           ? "new features go to the top level again"
           : "everything made from now on is filed here",
         () => workIn(state.workingIn === entry.id ? null : entry.id));
    item(boxed(entry) ? "White box" : "Black box",
         boxed(entry) ? "show what is inside it again"
                      : "show it as one node, with its parameters",
         () => edit({ op: "set", id: entry.id, key: "shell",
                      value: boxed(entry) ? 0 : 1 }));
    if (outputs.length)
      item("Read by", outputs.length + " outside", () => {
        state.picked = entry.outputs.slice();
        select(entry.outputs[0], false, true);
        say(entry.name + " is read by " + outputs.join(", "));
      });
    rule();
  }

  // Where they live. A set can hold a set, so the list is every container that
  // is not one of these and does not already contain one of them.
  const containers = state.tree.features.filter(f => f.category === "container"
    && !many.includes(f.id) && !many.some(id => within(id, f.id)));
  //! THE ROOTS FIRST, THEN THE QUESTION. Asked the other way round - filter
  //! the selection, then take the roots of what is left - a child whose parent
  //! was filtered out reads as a root and gets moved on its own, straight out
  //! of the set it was sitting in. See topOf.
  const filed = topOf(many).filter(id => (feature(id) || {}).parent);
  if (filed.length)
    item("Take out" + (several ? " of their sets" : " of "
           + (feature(entry.parent) || {}).name), "to the top level",
      () => edit.many(filed.map(id => ({ op: "group", id }))));
  // ONE LINE, NOT ONE PER SET. A document with nine sets in it turned this
  // menu into a list of nine "Move into …" lines and pushed everything that
  // matters off the bottom. Where a thing lives is ONE question; the answer is
  // a list, and a list belongs behind the question rather than in front of it.
  if (containers.length)
    item("Move to a set\u2026", containers.length
           + (containers.length === 1 ? " to choose from" : " to choose from"),
      () => openSetMenu(event, entry, many, containers));
  if (filed.length || containers.length) rule();

  // Hiding is a per-row eye in the tree and there is only one hand: hiding
  // eleven things one eye at a time is the same complaint as deleting them one
  // at a time, so it is here too.
  const dark = many.filter(id => state.hidden.has(id));
  item(dark.length === many.length ? "Show " + about("it") : "Hide " + about("it"),
    "in the 3D view, and in the file", () => showFeature(many, dark.length === many.length));

  //! DUPLICATE, AND THE ORDER OF THE TREE.
  //!
  //! Both are about the same thing: a tree somebody has to live in. Copying a
  //! column and moving it up two rows are the two edits a person makes most
  //! after the model works, and neither of them was here.
  item("Duplicate " + about("it"),
       several ? "another " + many.length + ", wired the same"
               : "another one, wired the same", () => duplicate(many));
  const siblings = orderedSiblings(entry);
  const at = siblings.indexOf(entry.id);
  if (!several && siblings.length > 1) {
    if (at > 0)
      item("Move up", "before " + ((feature(siblings[at - 1]) || {}).name || ""),
        () => edit({ op: "reorder", ids: [entry.id], before: siblings[at - 1] }));
    if (at >= 0 && at < siblings.length - 1)
      item("Move down", "after " + ((feature(siblings[at + 1]) || {}).name || ""),
        () => edit({ op: "reorder", ids: [entry.id], after: siblings[at + 1] }));
    if (at > 0)
      item("Move to the top", "first in " + ((feature(entry.parent) || {}).name || "the tree"),
        () => edit({ op: "reorder", ids: [entry.id], before: siblings[0] }));
    if (at >= 0 && at < siblings.length - 1)
      item("Move to the end", "last in " + ((feature(entry.parent) || {}).name || "the tree"),
        () => edit({ op: "reorder", ids: [entry.id], after: siblings[siblings.length - 1] }));
  }
  rule();

  //! FOLD OR OPEN THE WHOLE BRANCH, which is the only way to deal with a set
  //! that has a hundred sets in it. On the set's own menu because that is
  //! where you are when you decide you have seen enough of it.
  if (!several && entry.category === "container" && kidCount(entry.id)) {
    item("Fold it all away", "this set and every set inside it",
         () => foldAll(true, entry.id));
    item("Open it all up", "this set and every set inside it",
         () => foldAll(false, entry.id));
    rule();
  }

  if (!several) item("Centre on it", "bring it into view, from where you are",
                     () => centreOn(entry.id));
  if (!several) item("Open definition", "", () => select(entry.id, true));
  //! ONE DELETE. It takes a set's contents with it and it cuts whatever was
  //! reading what goes - see Doc.deleteFeature. The note says how much is
  //! about to go, because a folder with eleven things in it looks the same in
  //! this menu as an empty one.
  const inside = withContents(many).filter(id => !many.includes(id));
  item(several ? "Delete " + many.length + " features"
       : entry.category === "container" ? "Delete set" : "Delete",
    inside.length ? "and the " + inside.length
        + (inside.length === 1 ? " feature inside" : " features inside")
      : several ? "and everything selected with it" : "",
    () => deleteFeature(many));

  placeMenu(event.clientX, event.clientY);
}

//! THE CURRENT SET, said in the bar along the bottom.
//!
//! It has to be somewhere that is always on screen, because it changes what
//! every single thing you make does next, and a fact like that cannot live
//! only in a menu you opened once. The tree marks it too - bold and underlined
//! - but a tree can be scrolled away from and the bar cannot.
function sayCurrentSet() {
  const cell = document.getElementById("status-set");
  if (!cell) return;
  const entry = state.workingIn ? feature(state.workingIn) : null;
  const rule = document.getElementById("status-set-sep");
  cell.hidden = !entry;
  if (rule) rule.hidden = !entry;
  if (!entry) return;
  cell.innerHTML = 'in <b>' + escapeHtml(entry.name) + "</b>";
  cell.title = "New features are filed in " + entry.name
    + ". Right-click another set to make that one current.";
}

//! DEFINE IN WORK OBJECT. Said once, and everything made afterwards goes
//! there - which is the difference between a tree you tidy as you go and a
//! tree you tidy on Friday. ONE at a time, which is why this takes an id
//! rather than adding to a list: "current" is a word that only means anything
//! if there is one of them.
function workIn(id) {
  state.workingIn = id && feature(id) ? id : null;
  remember("ocafcad/workingIn", state.workingIn || "");
  buildTree();
  sayCurrentSet();
  say(state.workingIn
    ? (feature(state.workingIn) || {}).name
      + " is the current set \u00b7 new features are filed there"
    : "no current set \u00b7 new features go to the top level");
}

//! WHAT A FEATURE'S NEIGHBOURS ARE, in tree order. Moving a row up means
//! moving it past the row drawn above it, which is the one filed in the same
//! place - not the one that happens to be above it on screen because a folder
//! ended there.
function orderedSiblings(entry) {
  const holder = entry.parent || null;
  return state.tree.features
    .filter(f => (f.parent || null) === holder)
    .map(f => f.id);
}

//! ANOTHER ONE OF THESE, WIRED THE SAME. See duplicateEdits for what happens
//! to the wires, which is the whole of the difference between this and
//! instantiating a set from a file.
async function duplicate(ids) {
  const model = await kernel.model();
  const here = state.tree.features;
  let plan;
  try {
    plan = duplicateEdits(model, Array.isArray(ids) ? ids : [ids], {
      taken: new Set(here.map(f => f.id)),
      takenNames: new Set(here.map(f => f.name)),
      spec: schemaType,
    });
  } catch (error) { showError(error.message); return; }
  try { await mdl.runAll(plan.edits); }
  catch (error) { showError(error.message); return; }
  //! The copies are what is selected afterwards, because the next thing
  //! anybody does to a copy is move it.
  state.picked = plan.made.slice();
  select(plan.made[0], false, true);
  say(plan.made.length === 1
    ? (feature(plan.made[0]) || {}).name + " is a copy of " + (feature(ids[0]) || {}).name
    : plan.made.length + " copies made");
}

//! The second page of the menu: which set. Same menu, same place - a menu that
//! jumps somewhere else to ask the second half of its own question is a menu
//! you lose your place in. Back returns to the first page rather than closing,
//! because choosing wrongly should not mean right-clicking again.
function openSetMenu(event, entry, many, containers) {
  const menu = document.getElementById("menu");
  menu.textContent = "";
  menuHead("Move to a set");
  menuItem("\u2039 Back", "", () => openMenu(event, entry));
  menuRule();
  const part = (state.tree && state.tree.name) || "Part";
  //! The roots of the selection, worked out once. Everything below is a
  //! question about where THESE go; what is inside them goes with them.
  const roots = topOf(many);
  const loose = roots.filter(id => (feature(id) || {}).parent);
  menuItem(part, "the whole document \u00b7 the top level",
    loose.length ? () => edit.many(loose.map(id => ({ op: "group", id }))) : null);
  for (const set of containers) {
    const moving = roots.filter(id => (feature(id) || {}).parent !== set.id);
    const holds = (set.contents || []).length;
    menuItem(set.name,
      (set.type === "Body" ? "body" : "set") + " \u00b7 "
        + (holds ? holds + (holds === 1 ? " feature" : " features") : "empty"),
      moving.length
        ? () => edit.many(moving.map(id => ({ op: "group", id, into: set.id })))
        : null);
  }
  placeMenu(event.clientX, event.clientY);
}

//! Is \p id inside the set \p setId, at any depth? Asked so a set cannot be
//! offered a home inside something it already contains.
/* ------------------------------------------------- where a feature LIVES

   Two questions that every node has and that had nowhere to be asked: is it
   showing, and what is it filed under. Both were reachable - the eye in the
   tree, the right-click menu - and neither was where you are when you are
   looking at the thing, which is the panel.

   THE TOP OF THE TREE IS A SET TOO. A document is a branch like any other: it
   is the one everything is in until it is put somewhere else, and calling it
   by the part's own name rather than "none" is what makes the structure read
   as a structure rather than as a flat list with some folders in it. That is
   what makes "take this branch into a file of its own" a sensible thing to ask
   of any row of the dropdown, including the first.                         */

function placeField(entry) {
  const field = document.createElement("div");
  field.className = "field def-place";
  const hidden = state.hidden.has(entry.id);
  const sets = ((state.tree && state.tree.features) || []).filter(f =>
    f.category === "container" && f.id !== entry.id && !within(entry.id, f.id));
  const part = (state.tree && state.tree.name) || "Part";
  field.innerHTML = '<div class="place-row">'
    + '<button class="place-eye" id="place-eye" aria-pressed="' + (hidden ? "false" : "true")
    + '" title="' + (hidden ? "Show it" : "Hide it") + '">'
    + '<span class="place-dot"></span>' + (hidden ? "Hidden" : "Shown") + "</button>"
    + '<span class="place-tag">in</span>'
    + '<select id="place-set" aria-label="Which set it is filed under">'
    + '<option value=""' + (entry.parent ? "" : " selected") + ">" + escapeHtml(part)
    + " \u00b7 the whole document</option>"
    + sets.map(set => '<option value="' + escapeAttr(set.id) + '"'
        + (entry.parent === set.id ? " selected" : "") + ">" + escapeHtml(set.name)
        + " \u00b7 " + (set.type === "Body" ? "body" : "set") + "</option>").join("")
    + "</select></div>"
    // A mesh is the one kind of thing with a MODE of its own, so it gets the
    // way in here as well as on a double-click and in the ring. Three ways to
    // one place is not three features; it is one feature you can find.
    + (entry.produces === "mesh" ? '<button class="btn place-edit" id="place-edit">'
        + (entry.type === "EditMesh" ? "Enter edit mode" : "Edit its cage") + "</button>" : "")
    // A camera has a mode of its own too: standing behind it. Offered where
    // you are when you are looking at one, which is here.
    + (entry.type === "Camera" ? '<button class="btn place-edit" id="place-look">'
        + (through.id === entry.id ? "Step out of it" : "Look through it") + "</button>" : "")
    + (entry.type === "Story" ? '<button class="btn place-edit" id="place-tell">'
        + (story.id === entry.id ? "Close the story" : "Open the story") + "</button>" : "");

  field.querySelector("#place-eye").addEventListener("click", () =>
    showFeature(entry.id, state.hidden.has(entry.id)));
  field.querySelector("#place-set").addEventListener("change", event =>
    edit({ op: "group", id: entry.id, into: event.target.value || undefined }));
  const enter = field.querySelector("#place-edit");
  if (enter) enter.addEventListener("click", () => enterMeshEdit(entry.id));
  const look = field.querySelector("#place-look");
  if (look) look.addEventListener("click", () =>
    through.id === entry.id ? leaveThrough(true) : lookThrough(entry.id));
  const tell = field.querySelector("#place-tell");
  if (tell) tell.addEventListener("click", () =>
    story.id === entry.id ? closeStory(true) : openStory(entry.id));
  return field;
}

function within(setId, id) {
  for (let f = feature(id); f; f = feature(f.parent))
    if (f.parent === setId) return true;
  return false;
}

/* ------------------------------------------------- a set IS a feature

   A GEOMETRICAL SET TAKES INPUTS, exactly the way a polyline does. Put a
   point, a plane, a circle and an extrude in a set and what that set needs
   from the rest of the document is whatever those four read from outside it -
   and that list is the set's argument list in every sense that matters. It is
   what you would have to supply to use the set somewhere else, and it is what
   you want to repoint when you copy the set and aim it at another site.

   So the definition panel shows it, and shows it as the SAME CONTROL every
   other input uses: a button with the current source's name on it that arms
   the picker, so one click and then one click in the model or the tree
   replaces the input. Nothing new to learn, because it is not a new thing -
   it is the wire that was already there, shown where it can be reached.    */

//! Every wire that crosses INTO a set: which feature holds it, which of its
//! arguments it is, and what it is pointed at from outside. An argument that
//! is EMPTY is an input too - it is the one the set is waiting for - so it is
//! listed rather than left out.
//! WHAT A SET ASKS FOR. Worked out in reuse.js over plain feature records,
//! because the node editor draws the same answer as ports on a collapsed node
//! and two implementations of "how many inputs does this set have" would
//! sooner or later disagree in a way nobody can debug from a screenshot.
//! Shut or open. One reading of the argument, so the tree, the panel, the menu
//! and the node editor cannot disagree about whether a set is a box.
const boxed = entry => !!entry && entry.category === "container"
  && entry.values && entry.values.shell === 1;

//! EVERYTHING INSIDE A BOX THAT NOBODY IS DRIVING. A black box's panel is its
//! parameters, and a parameter is a number or a choice on something inside it
//! that no wire is already deciding - because one that IS wired is not a
//! parameter, it is a consequence, and offering it would be offering to break
//! the wire.
//!
//! Deep rather than one level: a component made of components is still one
//! component to whoever placed it.
function boxedValues(id) {
  const rows = [];
  const walk = parent => {
    for (const one of state.tree.features) {
      if (one.parent !== parent) continue;
      const spec = schemaType(one.type);
      if (spec) for (const arg of spec.args) {
        if (arg.kind !== "real" && arg.kind !== "choice") continue;
        if (!argApplies(one, arg)) continue;
        if (one.driven && one.driven[arg.key]) continue;
        rows.push({ holder: one, arg });
      }
      walk(one.id);
    }
  };
  walk(id);
  return rows;
}

function boxedFields(entry) {
  const rows = boxedValues(entry.id);
  const box = document.createElement("div");
  box.className = "def-section";
  const head = document.createElement("div");
  head.className = "field-head";
  head.innerHTML = "<label>Parameters</label><span class=\"kind\">"
    + (rows.length ? rows.length + (rows.length === 1 ? " value" : " values")
                   : "nothing left to set") + "</span>";
  box.appendChild(head);

  for (const { holder, arg } of rows) {
    const field = arg.kind === "real" ? realField(holder, arg) : choiceField(holder, arg);
    //! Named by what holds it, because "Height" three times over says nothing
    //! and "Column · Height" says which column - and is also how a generator's
    //! plan spells an override, so the panel doubles as the reference for one.
    const label = field.querySelector("label");
    if (label) label.textContent = holder.name + " \u00b7 " + arg.label;
    //! One id per field, not one per argument key. Three circles inside a box
    //! all have a "radius", and three elements with the same id means a label
    //! that focuses the wrong one - which reads as a field that will not take
    //! a click.
    const unique = "b-" + holder.id + "-" + arg.key;
    const input = field.querySelector("input, select");
    if (input && label) { input.id = unique; label.setAttribute("for", unique); }
    box.appendChild(field);
  }
  return box;
}

function setInputs(id) {
  const entry = feature(id);
  return setInputGroups(state.tree.features, id, {
    spec: schemaType,
    applies: argApplies,
    declaredText: (entry && entry.texts && entry.texts.inputs) || "",
    nameOf: to => (feature(to) || {}).name || to,
  });
}

//! Every argument that shares an input with this one, so setting it sets them
//! all. Written by the panel, which is the only thing that knows.
const shared = new Map();          // "childId:key" -> [{ id, key }]

const sharedWith = (id, key) => shared.get(id + ":" + key) || [];

//! The edits that wire, or unwire, a whole input at once.
const connectShared = (id, key, from) =>
  [{ op: "connect", id, key, from },
   ...sharedWith(id, key).map(at => ({ op: "connect", id: at.id, key: at.key, from }))];

const disconnectShared = (id, key, from) =>
  [{ op: "disconnect", id, key, ...(from ? { from } : {}) },
   ...sharedWith(id, key).map(at => ({ op: "disconnect", id: at.id, key: at.key,
                                       ...(from ? { from } : {}) }))];

//! The panel's section for them. Each row is a real refField wired to the
//! real feature and the real argument, with the holder's name put in front of
//! the label so a set with three points in it says which point is which.
function setInputFields(entry) {
  const groups = setInputs(entry.id);
  // The panel is the only place that knows which arguments are one input, so
  // it is the panel that tells the wiring - set up here, read by every path
  // that connects or disconnects one of them.
  shared.clear();
  for (const group of groups)
    for (const row of group.rows)
      shared.set(row.child.id + ":" + row.arg.key,
                 group.rows.filter(other => other !== row)
                           .map(other => ({ id: other.child.id, key: other.arg.key })));

  const box = document.createElement("div");
  box.className = "def-section";
  const head = document.createElement("div");
  head.className = "field-head";
  head.innerHTML = "<label>Inputs</label><span class=\"kind\">"
    + (groups.length ? groups.length + (groups.length === 1 ? " input" : " inputs")
                     : "nothing from outside") + "</span>";
  box.appendChild(head);
  // A group whose wire is empty is the set ASKING for something, which is
  // worth saying at the top rather than leaving to be noticed field by field.
  const asking = groups.filter(one => !one.rows[0].outside.length).length;
  if (asking) {
    const wants = document.createElement("p");
    wants.className = "summary";
    wants.textContent = asking + (asking === 1 ? " of these is empty" : " of these are empty")
      + " — click it, then click what it should follow, in the model or in the tree.";
    box.appendChild(wants);
  }
  if (!groups.length) {
    const none = document.createElement("p");
    none.className = "summary";
    none.textContent = entry.name + " stands on its own - nothing in it reads anything "
      + "from outside the set, so there is nothing to supply when it is reused.";
    box.appendChild(none);
    return box;
  }
  for (const group of groups) {
    // The control is built on the FIRST of the arguments that share the input;
    // the others follow it, because they ARE it.
    const row = group.rows[0];
    const field = row.number ? realField(row.child, row.arg) : refField(row.child, row.arg);
    const label = field.querySelector("label");
    const several = group.rows.length > 1;
    const reads = group.rows.map(one => one.child.name + " · " + one.arg.label).join(", ");
    if (label) {
      // Named for the thing it supplies when several read it - "Scene origin"
      // rather than the first of the four places it happens to be read.
      label.textContent = several && group.name ? group.name
                        : row.child.name + " · " + row.arg.label;
      label.style.cursor = "pointer";
      label.title = several
        ? "Read by " + reads + " — setting it sets all of them"
        : "Show " + row.child.name + " in the tree";
      label.addEventListener("click", () => select(row.child.id, false));
    }
    // ONE INPUT, SEVERAL READERS, SAID OUT LOUD. A field that quietly rewires
    // three things when you set it has to say that it is going to.
    if (several) {
      const kind = field.querySelector(".field-head .kind");
      const note = document.createElement("span");
      note.className = "kind";
      note.textContent = group.rows.length + " read it";
      note.title = reads;
      if (kind) kind.after(note);
      else field.querySelector(".field-head").appendChild(note);
    }
    box.appendChild(field);
  }
  return box;
}

//! What feeds a set from outside it, said out loud and picked in the tree, so
//! the answer is something you can see as well as read.
function showBoundary(entry) {
  const inputs = entry.inputs || [];
  if (!inputs.length) { say(entry.name + " takes nothing from outside itself"); return; }
  state.picked = inputs.slice();
  select(inputs[0], false, true);
  say(entry.name + " is fed by " + inputs.map(id => (feature(id) || {}).name || id).join(", "));
}

/* -------------------------------------------------------- definition panel */
function buildPanel() {
  const host = document.getElementById("def");
  const panel = document.getElementById("def-panel");
  host.textContent = "";
  const entry = feature(state.edited);
  panel.hidden = !entry;
  const switched = document.getElementById("btn-panel");
  if (switched) switched.setAttribute("aria-pressed", entry ? "true" : "false");
  // The panel is one of the two sides the middle is measured against, so its
  // coming and going is a layout change like any other.
  layout();
  // A script needs room to be read; everything else stays narrow.
  panel.classList.toggle("wide", !!entry && !!entry.code);
  if (!entry) {
    // On a desktop the panel simply is not there when nothing is being edited.
    // On a phone the dock has a tab for it, and a tab that opens a blank sheet
    // is a tab that looks broken - so it says what to do instead.
    const empty = document.createElement("div");
    empty.className = "def-head";
    empty.innerHTML = '<div class="summary">Nothing is being edited. Tap a body in the '
      + "model, or a row in the tree, to put its arguments here.</div>";
    host.appendChild(empty);
    return;
  }

  const spec = schemaType(entry.type);
  const head = document.createElement("div");
  head.className = "def-head";
  head.innerHTML =
    '<div class="name-row"><input class="name" id="feature-name" value="' + escapeAttr(entry.name) +
    '" aria-label="Feature name"' + "" + ">" +
    '<span class="badge ' + entry.category + '">' + entry.type + "</span></div>" +
    '<div class="meta">' + entry.entry + " · TFunction_Function<br>{" + spec.guid + "}<br>" +
    "revision " + entry.revision + (entry.built ? "" : " · not built") + "</div>";
  host.appendChild(head);

  const rename = head.querySelector("#feature-name");
  rename.addEventListener("change", () =>
    edit({ op: "rename", id: entry.id, name: rename.value.trim() }));

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = spec.summary;
  host.appendChild(summary);

  host.appendChild(placeField(entry));

  const slot = document.createElement("div");
  slot.id = "def-notice";
  host.appendChild(slot);
  refreshPanelNotice();

  for (const arg of spec.args) {
    if (!argApplies(entry, arg)) continue;
    if (arg.kind === "code") continue;   // the editor goes below the parameters
    // A SET'S DECLARED INPUTS ARE BOOKKEEPING, not a field. They are the
    // set's own record of which of its arguments share one input, written
    // when it is instantiated and read by the Inputs section below - which is
    // where a person deals with them. Showing the JSON as well would be
    // showing the same thing twice, once in a form nobody should be editing.
    if (entry.category === "container" && arg.key === "inputs") continue;
    host.appendChild(arg.kind === "real" ? realField(entry, arg)
                   : arg.kind === "choice" ? choiceField(entry, arg)
                   : arg.kind === "edits" ? editsField(entry, arg)
                   : arg.kind === "subs" ? subsField(entry, arg)
                   : (arg.key === "exclude" && drawsAView(entry))
                       ? exclusionField(entry, arg)
                   : arg.kind === "text" ? textField(entry, arg)
                   : arg.kind === "blob" ? blobField(entry, arg)
                   : arg.kind === "sketch" ? sketchField(entry, arg)
                   : refField(entry, arg));
  }

  // HOW ITS LISTS PAIR UP, under the arguments they pair up. Nothing at all
  // unless two of them are carrying lists - see spreadField.
  const spreading = spreadField(entry);
  if (spreading) host.appendChild(spreading);

  // A SET'S ARGUMENTS ARE THE WIRES THAT REACH INTO IT. Listed after its own
  // arguments, which for a plain geometrical set is none of them - so for the
  // usual set this IS the panel, which is the point.
  if (entry.category === "container") host.appendChild(setInputFields(entry));
  // Shut, its own panel IS the component's: what it takes from outside, then
  // every value inside it that is still free to set.
  if (boxed(entry)) host.appendChild(boxedFields(entry));

  // What the feature computed, as opposed to what it built. A Panel is nothing
  // but this; a DivideCurve has it as well as geometry.
  if (entry.data) host.appendChild(dataField(entry));
  //! THE PENS, for anything that produced a drawing. Asked of the result
  //! rather than of the type, so a node added later that makes one gets the
  //! same panel without this line changing.
  if (drawsAView(entry)) host.appendChild(drawingLayersField(entry));

  // What it is made of. A property of the object, like its size - held on the
  // feature, written into the model file, and read by both renderers.
  if (wearsMaterial(entry)) host.appendChild(materialField(entry));
  //! HOW ITS POINTS ARE DRAWN, for anything that draws any. A property of the
  //! object like its material, in the same place for the same reason - and
  //! offered on a DivideCurve as readily as on a Point, because two hundred
  //! marks along a curve are exactly where the choice matters most.
  if (marksPoints(entry)) host.appendChild(markField(entry));

  // AND HOW IT IS CUT. Beside the material because it is the same kind of
  // fact: a property of the object that travels with it. Offered on anything
  // a section plane can pass through, which is anything solid.
  //! AND ON A SET, which is where a drawing standard actually lives. A
  //! building is not styled object by object - it is styled by trade: every
  //! wall in the blockwork set poched one way, every slab in the structure set
  //! another. Set it once on the set and every solid inside it follows, unless
  //! it has been given an answer of its own. See cutStyleOf, which resolves
  //! the three levels, and setsAbove, which finds the middle one.
  if ((wearsMaterial(entry) && entry.produces === "solid")
      || entry.category === "container")
    host.appendChild(cutField(entry));

  // Whatever the script declared for itself, as sliders.
  if (entry.params && entry.params.length) {
    const head = document.createElement("div");
    head.className = "params-head";
    head.textContent = "Parameters";
    host.appendChild(head);
    for (const param of entry.params) host.appendChild(scriptField(entry, param));
  }
  if (entry.code !== undefined) host.appendChild(codeEditor(entry));

  const actions = document.createElement("div");
  actions.className = "actions";
  // The shortcut is only a shortcut when the operation would take this feature.
  const filletSpec = schemaType("Fillet");
  const filletArg = filletSpec && filletSpec.args.find(a => a.kind === "ref" && a.consumes);
  if (!entry.consumedBy && filletArg && acceptsFrom(filletArg.accepts, entry)) {
    const fillet = document.createElement("button");
    fillet.className = "btn primary";
    fillet.innerHTML = svg(ICONS.Fillet) + "<span>Apply fillet</span>";
    fillet.addEventListener("click", () => { state.selected = entry.id; addFeature("Fillet"); });
    actions.appendChild(fillet);
  }
  const remove = document.createElement("button");
  remove.className = "btn";
  remove.textContent = "Delete feature";
  remove.addEventListener("click", () => deleteFeature(entry.id));
  actions.appendChild(remove);
  host.appendChild(actions);
}

//! Which features have a material at all. A point has no surface to be made of
//! anything, a datum is scaffolding, and a body that has been consumed is not
//! drawn - painting it would be painting something nobody can see.
const wearsMaterial = entry =>
  !!entry && !entry.consumedBy && entry.category !== "datum" && entry.category !== "data"
  && (entry.produces === "solid" || entry.produces === "mesh");

//! Anything that puts marks on screen: a point node, and anything whose data
//! is a list of points - a DivideCurve, an Intersect that came out as points.
const marksPoints = entry =>
  !!entry && !entry.consumedBy
  && (entry.produces === "point" || !!(entry.data && entry.data.kind === "point"));

//! WHAT SHAPE THE MARKS ARE, AND HOW HEAVY. Two rows, the same shape as the
//! material control above it, because it is the same kind of choice: a
//! property of the object that travels in the file and changes nothing about
//! the geometry.
function markField(entry) {
  const field = document.createElement("div");
  field.className = "field material";
  const { mark, weight } = markOf(entry);
  const head = document.createElement("div");
  head.className = "params-head";
  head.innerHTML = "<span>Points</span><span class=\"kind\">"
    + escapeHtml(mark.label.toLowerCase() + " \u00b7 " + weight.label.toLowerCase())
    + "</span>";
  field.appendChild(head);

  const row = (label, list, now, write) => {
    const line = document.createElement("div");
    line.className = "field-head";
    line.innerHTML = "<label>" + label + "</label>";
    field.appendChild(line);
    const group = document.createElement("div");
    group.className = "segmented";
    group.setAttribute("role", "group");
    for (const one of list) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = one.label;
      button.title = one.summary || one.label;
      button.setAttribute("aria-pressed", one.key === now ? "true" : "false");
      button.addEventListener("click", () => write(one.key));
      group.appendChild(button);
    }
    field.appendChild(group);
  };
  const send = next => edit({ op: "appearance", id: entry.id,
                              appearance: { ...(entry.appearance || {}), ...next } });
  row("Shape", POINT_MARKS, mark.key, key => send({ mark: key }));
  row("Weight", POINT_WEIGHTS, weight.key, key => send({ markWeight: key }));
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "How this feature's points are drawn. Under the pointer a mark "
    + "goes orange and grows; chosen, it takes a ring.";
  field.appendChild(hint);
  return field;
}

//! The material of one object, the way Rhino puts it on the object rather than
//! in the scene: pick the nearest thing off the shelf, then move the sliders.
//! What is written down is the name and whatever was moved, so a document says
//! "brass" rather than four numbers that happen to be brass.
function materialField(entry) {
  const field = document.createElement("div");
  field.className = "field material";
  const made = materialOf(entry.appearance);

  const head = document.createElement("div");
  head.className = "params-head";
  head.textContent = "Material";
  field.appendChild(head);

  const swatches = document.createElement("div");
  swatches.className = "swatch-row";
  for (const finish of FINISHES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.dataset.finish = finish.key;
    button.title = finish.label;
    button.setAttribute("aria-label", finish.label);
    button.setAttribute("aria-pressed", finish.key === made.finish ? "true" : "false");
    button.style.background = hexOf(finish.color);
    button.addEventListener("click", () => wearMaterial(entry.id, { finish: finish.key }));
    swatches.appendChild(button);
  }
  field.appendChild(swatches);

  const row = (label, control) => {
    const line = document.createElement("div");
    line.className = "field-head";
    const name = document.createElement("label");
    name.textContent = label;
    line.appendChild(name);
    line.appendChild(control);
    field.appendChild(line);
    return control;
  };

  const colour = document.createElement("input");
  colour.type = "color";
  colour.className = "mat-colour";
  colour.value = hexOf(made.color);
  colour.addEventListener("input", () =>
    wearMaterial(entry.id, { color: rgbOf(colour.value) }, true));
  colour.addEventListener("change", () =>
    wearMaterial(entry.id, { color: rgbOf(colour.value) }));
  row(findFinish(made.finish).label, colour);

  for (const [key, label] of [["gloss", "Gloss"], ["metalness", "Metal"], ["opacity", "Opacity"]]) {
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "mat-slider";
    slider.min = "0"; slider.max = "1"; slider.step = "0.01";
    slider.value = String(made[key]);
    slider.dataset.mat = key;
    // While it is being dragged the material changes on screen and the document
    // is left alone; letting go is the edit. Otherwise one drag is forty
    // entries in the undo stack.
    slider.addEventListener("input", () =>
      wearMaterial(entry.id, { [key]: +slider.value }, true));
    slider.addEventListener("change", () =>
      wearMaterial(entry.id, { [key]: +slider.value }));
    row(label, slider);
  }

  const note = document.createElement("div");
  note.className = "summary";
  note.textContent = state.style === "rendered"
    ? "Shown here and in the showroom."
    : "Shown in the Rendered style and in the showroom. This view is "
      + findStyle(state.style).label + ".";
  field.appendChild(note);
  return field;
}

/* ------------------------------------------------------ how it is cut

   A drawing does not hatch everything the same. Concrete is one poche,
   blockwork another, insulation is a zigzag, glass is not hatched at all and
   is drawn with a fine line; structure is heavy, furniture light. That is not
   decoration - it is how a section is READ, and it has been for a hundred and
   fifty years.

   So it is a property of the OBJECT, beside its material, and it travels in
   the model file with everything else the object says about itself. Anything
   it does not say it takes from the section bar, which is what "As the view"
   means everywhere below.                                                   */

//! The little pictures on the pattern buttons: the same canvas the cut face is
//! filled with, drawn small. A swatch that is a WORD is a swatch you have to
//! learn; a swatch that is the pattern is one you recognise.
function patternSwatch(kind, ink, paper, tile) {
  const size = 22;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * 2;
  const pen = canvas.getContext("2d");
  pen.fillStyle = paper;
  pen.fillRect(0, 0, size * 2, size * 2);
  if (kind !== "none" && kind !== "solid") {
    const texture = patternTexture(kind, ink, paper, tile);
    const image = texture.image;
    if (image && image.width) {
      const pattern = pen.createPattern(image, "repeat");
      if (pattern) { pen.fillStyle = pattern; pen.fillRect(0, 0, size * 2, size * 2); }
    }
  }
  if (kind === "none") {
    pen.clearRect(0, 0, size * 2, size * 2);
    pen.strokeStyle = ink;
    pen.globalAlpha = 0.5;
    pen.beginPath(); pen.moveTo(2, size * 2 - 2); pen.lineTo(size * 2 - 2, 2); pen.stroke();
  }
  return canvas.toDataURL();
}

//! THE SETS AN OBJECT SITS IN, NEAREST FIRST - which is the order "use the
//! parent" means. A wall is in the blockwork set, which is in the fabric set,
//! which is in the building: a style set on any of the three reaches the wall,
//! and the nearest one wins.
//!
//! Cached on the tree's identity, because it is asked once per object per
//! plane per frame while a section plane is being dragged, and a walk up a
//! twelve-deep tree for each of six hundred walls is a walk done seventy-two
//! thousand times a frame.
let styleChain = new Map(), styleChainOf = null;
function setsAbove(id) {
  if (styleChainOf !== state.tree) { styleChain = new Map(); styleChainOf = state.tree; }
  const had = styleChain.get(id);
  if (had) return had;
  const out = [];
  let at = feature(id), guard = 0;
  while (at && at.parent && guard++ < 200) {
    const up = feature(at.parent);
    if (!up) break;
    if (up.appearance) out.push(up.appearance);
    at = up;
  }
  styleChain.set(id, out);
  return out;
}

function cutField(entry) {
  const field = document.createElement("div");
  field.className = "field material cut-style";
  const cut = cutStyleOf(entry.appearance, cutter.style, setsAbove(entry.id));
  const paper = cut.fill ? hexOf(cut.fill) : "#" + THEME["cut-fill"].getHexString();
  const ink = cut.ink ? hexOf(cut.ink) : "#" + THEME["cut-line"].getHexString();
  const own = (entry.appearance && entry.appearance.cut) || {};

  const head = document.createElement("div");
  head.className = "params-head";
  head.textContent = "Section";
  field.appendChild(head);

  const row = (label, control, cls = "") => {
    const line = document.createElement("div");
    line.className = "field-head " + cls;
    const name = document.createElement("label");
    name.textContent = label;
    line.appendChild(name);
    line.appendChild(control);
    field.appendChild(line);
    return control;
  };

  // The patterns, as the patterns.
  const swatches = document.createElement("div");
  swatches.className = "cut-swatches";
  for (const one of CUT_PATTERNS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cut-swatch";
    button.title = one.label + " \u00b7 " + one.hint;
    button.setAttribute("aria-label", one.label);
    const chosen = (own.pattern || "inherit") === one.key;
    button.setAttribute("aria-pressed", chosen ? "true" : "false");
    if (one.key === "inherit") button.textContent = "view";
    else if (one.key === "image") button.textContent = "img";
    else button.style.backgroundImage =
      "url(" + patternSwatch(one.key, ink, paper, cut.tile) + ")";
    button.addEventListener("click", () => wearCut(entry.id, { pattern: one.key }));
    swatches.appendChild(button);
  }
  field.appendChild(swatches);

  // A picture of your own. Shrunk to a tile on the way in: a photograph in a
  // model file is a model file nobody can open, and a hatch is a tile.
  if (cut.pattern === "image") {
    const pick = document.createElement("input");
    pick.type = "file";
    pick.accept = "image/*";
    pick.className = "cut-file";
    pick.addEventListener("change", () => {
      const file = pick.files && pick.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 128;
          canvas.getContext("2d").drawImage(image, 0, 0, 128, 128);
          wearCut(entry.id, { tile: canvas.toDataURL("image/png") });
        };
        image.onerror = () => showError("that file is not an image this can read");
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
    row(cut.tile ? "Change the tile" : "A tile to repeat", pick, "cut-wide");
  }

  const fill = document.createElement("input");
  fill.type = "color";
  fill.className = "mat-colour";
  fill.value = paper;
  fill.addEventListener("input", () => wearCut(entry.id, { fill: rgbOf(fill.value) }, true));
  fill.addEventListener("change", () => wearCut(entry.id, { fill: rgbOf(fill.value) }));
  row("Fill", fill);

  const pen = document.createElement("input");
  pen.type = "color";
  pen.className = "mat-colour";
  pen.value = ink;
  pen.addEventListener("input", () => wearCut(entry.id, { ink: rgbOf(pen.value) }, true));
  pen.addEventListener("change", () => wearCut(entry.id, { ink: rgbOf(pen.value) }));
  row("Line", pen);

  // The line itself: what it is, and how heavy.
  const lines = document.createElement("div");
  lines.className = "cut-seg";
  for (const one of CUT_LINES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = one.label;
    button.title = one.hint || "";
    button.setAttribute("aria-pressed",
      (own.line || "inherit") === one.key ? "true" : "false");
    button.addEventListener("click", () => wearCut(entry.id, { line: one.key }));
    lines.appendChild(button);
  }
  field.appendChild(lines);

  if (cut.line !== "none") {
    const weights = document.createElement("div");
    weights.className = "cut-seg cut-weights";
    for (const one of CUT_WEIGHTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = one.label + " \u00b7 " + one.key + " px";
      button.setAttribute("aria-pressed",
        Math.abs(cut.weight - one.key) < 1e-6 ? "true" : "false");
      const bar = document.createElement("span");
      bar.style.height = Math.max(1, one.key) + "px";
      button.appendChild(bar);
      button.addEventListener("click", () => wearCut(entry.id, { weight: one.key }));
      weights.appendChild(button);
    }
    field.appendChild(weights);
  }

  if (cut.pattern !== "none" && cut.pattern !== "solid") {
    for (const [key, label, min, max, step] of
         [["scale", "Scale", 0.2, 6, 0.05], ["angle", "Angle", 0, 180, 1]]) {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "mat-slider";
      slider.min = String(min); slider.max = String(max); slider.step = String(step);
      slider.value = String(cut[key]);
      slider.addEventListener("input", () =>
        wearCut(entry.id, { [key]: +slider.value }, true));
      slider.addEventListener("change", () => wearCut(entry.id, { [key]: +slider.value }));
      row(label, slider);
    }
  }

  //! WHERE THE ANSWER CAME FROM, in the words of the thing it came from. "From
  //! the view" when a wall is poched because a set three levels up says so is
  //! true of nothing, and leaves somebody hunting for a setting they never
  //! made. Named, they can go and change it.
  const namedSet = () => {
    let at = feature(entry.id), guard = 0;
    while (at && at.parent && guard++ < 200) {
      const up = feature(at.parent);
      if (!up) break;
      if (up.appearance && up.appearance.cut
          && Object.keys(up.appearance.cut).length) return up.name;
      at = up;
    }
    return "a set it is in";
  };
  const note = document.createElement("div");
  note.className = "summary";
  note.textContent = (cut.from === "own" ? "Its own: "
                    : cut.from === "set" ? "From " + namedSet() + ": "
                    : "From the view: ") + saysCut(cut)
    + (cutter.on ? "" : " \u00b7 press X to see it");
  field.appendChild(note);

  if (cut.own) {
    const back = document.createElement("button");
    back.className = "btn row-btn";
    //! "Use parent" is DELETING the answer rather than writing a word that
    //! means "ask upstairs" - which is what lets it fall through to the set
    //! when there is one and to the view when there is not.
    back.textContent = cut.from === "own" && setsAbove(entry.id).some(one =>
      one.cut && Object.keys(one.cut).length)
      ? "Use the set's style" : "Back to the view's style";
    back.addEventListener("click", () => wearCut(entry.id, null));
    field.appendChild(back);
  }
  return field;
}

//! Writes a cut style onto an object, the same way a material is written: only
//! what differs from "as the view" is kept, so an object nobody has styled
//! carries nothing and follows the bar.
function wearCut(id, change, live = false) {
  const entry = feature(id);
  if (!entry) return;
  const was = (entry.appearance && entry.appearance.cut) || {};
  const cut = change === null ? null : cutRecord(change, was);
  const next = { ...(entry.appearance || {}) };
  if (cut) next.cut = cut; else delete next.cut;
  entry.appearance = Object.keys(next).length ? next : null;
  if (cutter.on) refreshSection();
  if (live) return;
  mdl.run({ op: "appearance", id, appearance: entry.appearance }, { keepPanel: true })
    .then(() => { if (state.edited === id) buildPanel(); })
    .catch(err => showError(err.message));
}

//! Writes a material onto an object. \p live means the slider is still moving:
//! the material on screen follows, and the document is written when it stops.
function wearMaterial(id, change, live = false) {
  const entry = feature(id);
  if (!entry) return;
  const made = materialOf(entry.appearance);
  const next = appearanceOf(change.finish || made.finish, {
    color: change.color || (change.finish ? null : made.color),
    gloss: change.gloss !== undefined ? change.gloss : (change.finish ? null : made.gloss),
    metalness: change.metalness !== undefined ? change.metalness
                                              : (change.finish ? null : made.metalness),
    opacity: change.opacity !== undefined ? change.opacity : (change.finish ? null : made.opacity),
  });
  //! THE MARK SETTINGS RIDE THROUGH. appearanceOf builds a clean appearance
  //! out of a finish and its overrides, and knows nothing about points - so
  //! changing a colour would have quietly put the marks back to a dot. They
  //! are on the appearance because that is where "how this is drawn" lives;
  //! that makes carrying them across every rewrite of it this function's job.
  const was = entry.appearance || {};
  if (was.mark) next.mark = was.mark;
  if (was.markWeight) next.markWeight = was.markWeight;
  entry.appearance = next;                    // so the next read sees it at once
  repaintMaterial(id);
  if (showroom.ready) showroom.paint(id, next);
  if (live) return;
  mdl.run({ op: "appearance", id, appearance: next }, { keepPanel: true })
    .then(() => { if (state.edited === id) buildPanel(); })
    .catch(err => showError(err.message));
}

//! One object's surface, rebuilt where it stands. Cheaper than re-skinning the
//! whole scene and it keeps a slider's drag smooth.
function repaintMaterial(id) {
  const held = shapes.get(id);
  if (!held) return;
  const entry = feature(id);
  const style = findStyle(state.style);
  for (const object of held.group.children) {
    //! The marks are rebuilt too, and by the same call, because the shape and
    //! the weight of a point live on the appearance beside the finish - so
    //! "the appearance changed" has to mean both or the panel shows a cross
    //! and the viewport keeps drawing a dot.
    if (object.isPoints && object.userData.mark) {
      object.material.dispose();
      object.userData.as = null;
      object.material = markMaterial(entry, "plain");
      continue;
    }
    if (!object.isMesh || object.userData.datum || object.userData.hardEdge) continue;
    object.material.dispose();
    object.material = surfaceMaterial(entry, style);
  }
  paintSelection();
  draw();
}

//! Two surfaces, one document: a value changed in the node graph has to appear
//! on the panel's slider, and the other way round. Only the control under the
//! pointer is left alone.
function refreshPanelValues() {
  const entry = feature(state.edited);
  const host = document.getElementById("def");
  if (!entry || !host) return;
  const values = { ...entry.values };
  for (const param of entry.params || []) values[param.key] = param.value;
  for (const [key, value] of Object.entries(values)) {
    for (const prefix of ["p-", "n-", "s-", "sn-"]) {
      const input = host.querySelector("#" + prefix + key);
      if (input && input !== document.activeElement)
        input.value = input.type === "number" ? round(value) : value;
    }
    const group = host.querySelector('.segmented[data-key="' + key + '"]');
    if (group)
      [...group.children].forEach((button, index) =>
        button.setAttribute("aria-pressed", index === Math.round(value) ? "true" : "false"));
    const pick = host.querySelector('select.many[data-key="' + key + '"]');
    if (pick && pick !== document.activeElement) pick.value = String(Math.round(value));
  }
}

//! The panel is not rebuilt while a slider is being dragged - that would take
//! the slider out from under the pointer - so the feature's state is refreshed
//! on its own.
function refreshPanelNotice() {
  const slot = document.getElementById("def-notice");
  if (!slot) return;
  slot.textContent = "";
  const entry = feature(state.edited);
  if (!entry) return;
  if (entry.error) slot.appendChild(notice(entry.error, "bad"));
  else if (entry.consumedBy)
    slot.appendChild(notice("Consumed by " + (feature(entry.consumedBy) || {}).name +
      ". It stays in the tree; its result is replaced in the 3D view.", "info"));
}

//! An argument governed by a choice is shown only for the alternative it
//! belongs to, so one feature can carry two patterns without two dialogs.
function argApplies(entry, arg) {
  if (!arg.showWhen) return true;
  const now = entry.values[arg.showWhen.key];
  return arg.showWhen.any ? arg.showWhen.any.includes(now) : now === arg.showWhen.equals;
}

//! HOW THIS FEATURE PAIRS UP THE LISTS ARRIVING ON IT.
//!
//! Offered only where it can do something - two or more inputs carrying lists,
//! which is the "multiple against multiple" case and the only one where the
//! three rules give three different answers. With one list there is nothing to
//! pair it with and every rule agrees, so a control saying so would be a
//! control that never does anything.
//!
//! The counts are on the page beside it, because "Cross reference" means
//! nothing until you can see it is 28 x 4 and read the 112 off the row below.
function spreadField(entry) {
  const lists = Object.entries(entry.lists || {})
    .filter(([, count]) => typeof count === "number" && count > 1);
  if (lists.length < 2) return null;
  const spread = entry.spread || { match: "longest" };
  const spec = schemaType(entry.type);
  const named = key => {
    const arg = (spec.args || []).find(a => a.key === key);
    return (arg && arg.label) || key;
  };
  const counts = lists.map(([key, count]) => named(key) + " " + count).join(" \u00d7 ");
  const longest = Math.max(...lists.map(([, c]) => c));
  const shortest = Math.min(...lists.map(([, c]) => c));
  const cross = lists.reduce((all, [, c]) => all * c, 1);
  const rows = { longest, shortest, cross };

  const field = document.createElement("div");
  field.className = "field";
  field.innerHTML = '<div class="field-head"><label>Lists</label>'
    + '<span class="unit">' + escapeHtml(counts) + "</span></div>";
  const group = document.createElement("div");
  group.className = "segmented";
  group.setAttribute("role", "group");
  [["longest", "Longest"], ["shortest", "Shortest"], ["cross", "Cross"]]
    .forEach(([key, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = label + " list \u2014 " + rows[key]
        + (rows[key] === 1 ? " build" : " builds");
      button.setAttribute("aria-pressed", spread.match === key ? "true" : "false");
      button.addEventListener("click", () =>
        edit({ op: "spread", id: entry.id, match: key,
               graft: spread.graft || [], flatten: spread.flatten || [] }));
      group.appendChild(button);
    });
  field.appendChild(group);
  const said = document.createElement("div");
  said.className = "wired";
  said.innerHTML = "<span>" + rows[spread.match]
    + (rows[spread.match] === 1 ? " build" : " builds")
    + " \u00b7 " + (spread.match === "cross" ? "every combination"
      : spread.match === "shortest" ? "the surplus is dropped"
      : "a short list repeats its last value") + "</span>";
  field.appendChild(said);
  return field;
}

function choiceField(entry, arg) {
  const field = document.createElement("div");
  field.className = "field";
  const current = entry.values[arg.key];

  field.innerHTML = '<div class="field-head"><label>' + arg.label + "</label></div>";
  // Two or three alternatives read as a switch. Eight do not fit in a panel this
  // wide, and squeezing them to four letters each helps nobody.
  if (arg.options.length > 3) {
    const pick = document.createElement("select");
    pick.className = "many";
    pick.dataset.key = arg.key;
    pick.innerHTML = arg.options.map((option, index) =>
      '<option value="' + index + '"' + (index === current ? " selected" : "") + ">" +
      escapeHtml(option) + "</option>").join("");
    // Switching the pattern changes which arguments apply, so the panel is
    // rebuilt rather than refreshed in place.
    pick.addEventListener("change", () =>
      pushParameter(entry.id, arg.key, Number(pick.value), true));
    field.appendChild(pick);
  } else {
    const group = document.createElement("div");
    group.className = "segmented";
    group.dataset.key = arg.key;
    group.setAttribute("role", "group");
    arg.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option;
      button.setAttribute("aria-pressed", index === current ? "true" : "false");
      button.addEventListener("click", () => pushParameter(entry.id, arg.key, index, true));
      group.appendChild(button);
    });
    field.appendChild(group);
  }

  const path = document.createElement("div");
  path.className = "attr-path";
  path.innerHTML = (entry.labels[arg.key] || entry.entry) + " · <b>TDataStd_Integer</b>";
  field.appendChild(path);
  return field;
}

//! One line of text: a list of numbers, typed. Applied when you leave the
//! field, because a half-typed list is not a list.
//! Imported geometry, in the panel. It says what it holds and how much of it,
//! and offers nothing to change - because there is nothing: an import has no
//! recipe, only the shape it arrived as. Everything downstream of it works the
//! same way it works on anything else, which is the whole point of keeping it
//! as a feature rather than as a file on the side.
function blobField(entry, arg) {
  const field = document.createElement("div");
  field.className = "field";
  const size = (entry.sizes && entry.sizes[arg.key]) || 0;
  field.innerHTML = '<div class="field-head"><label>' + escapeHtml(arg.label) + "</label>" +
    '<span class="kind">' + escapeHtml(arg.carries || "geometry") + "</span></div>" +
    '<div class="attr-path">' + (size ? readable(size) + ", read from a file and kept in "
      + "the model" : "empty") + "</div>" +
    '<div class="attr-path">' + (entry.labels[arg.key] || entry.entry)
    + " · <b>TDataStd_AsciiString</b></div>";
  return field;
}

function textField(entry, arg) {
  const field = document.createElement("div");
  field.className = "field";
  const value = (entry.texts && entry.texts[arg.key]) || "";
  field.innerHTML = '<div class="field-head"><label for="t-' + arg.key + '">' +
    escapeHtml(arg.label) + "</label>" +
    (arg.hint ? '<span class="kind">' + escapeHtml(arg.hint) + "</span>" : "") + "</div>";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "line";
  input.id = "t-" + arg.key;
  input.spellcheck = false;
  input.value = value;
  input.addEventListener("change", () =>
    edit({ op: "code", id: entry.id, key: arg.key, text: input.value }, { keepPanel: true }));
  field.appendChild(input);

  const path = document.createElement("div");
  path.className = "attr-path";
  path.innerHTML = (entry.labels[arg.key] || entry.entry) + " · <b>TDataStd_AsciiString</b>";
  field.appendChild(path);
  return field;
}

//! The hand edits, both ways round: the vertex under the handle can be typed
//! as three numbers, and the whole set can be read and cleared. Dragging in the
//! viewport and typing here write the same line of JSON.
//! The drawing, in the panel. It says what is in the sketch, opens the
//! sketcher, and shows the JSON - which is the drawing itself, not a report of
//! it, so editing the text here is editing the sketch.
//! The layers of a drawing, as a drawing office has always had them.
//!
//! On is not a decoration. An element on a layer that is off is not drawn and
//! not built, which is what turns a plan full of furniture, text and survey
//! into the profile of a slab: bring the whole DXF in, then switch off
//! everything that is not the outline. Locked is the other way round - drawn
//! and built, but nothing on it can be picked up, which is what you want of a
//! survey you are drawing over.
function layerList(entry, drawing) {
  const box = document.createElement("div");
  box.className = "layers";
  const layers = sketchLayers(drawing);
  const current = currentLayer(drawing);

  const head = document.createElement("div");
  head.className = "layers-head";
  head.innerHTML = "<span>Layers</span>";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "layer-add";
  add.textContent = "+ New";
  add.title = "A new layer, and everything drawn from now on goes on it";
  add.addEventListener("click", () => {
    let name = "Layer 1";
    for (let i = 1; layers.some(l => l.name === name); i++) name = "Layer " + i;
    edit({ op: "layer", id: entry.id, name, current: true });
  });
  head.appendChild(add);
  box.appendChild(head);

  for (const layer of layers) {
    const row = document.createElement("div");
    row.className = "layer-row";
    row.classList.toggle("current", layer.name === current);

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "layer-icon";
    eye.innerHTML = svg(layer.on ? ICONS.layerOn : ICONS.layerOff);
    eye.title = layer.on ? "Showing - and being built. Click to turn it off."
      : "Off: not drawn, and not built either. Click to turn it on.";
    eye.setAttribute("aria-pressed", String(layer.on));
    eye.addEventListener("click", () =>
      edit({ op: "layer", id: entry.id, name: layer.name, show: !layer.on }));
    row.appendChild(eye);

    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "layer-icon";
    lock.innerHTML = svg(layer.locked ? ICONS.layerLocked : ICONS.layerOpen);
    lock.title = layer.locked ? "Locked: drawn and built, but nothing on it can be picked up."
      : "Unlocked. Click to lock it.";
    lock.setAttribute("aria-pressed", String(layer.locked));
    lock.addEventListener("click", () =>
      edit({ op: "layer", id: entry.id, name: layer.name, lock: !layer.locked }));
    row.appendChild(lock);

    const name = document.createElement("input");
    name.className = "layer-name";
    name.value = layer.name;
    name.spellcheck = false;
    name.title = "The layer's name. Everything on it comes with it.";
    name.addEventListener("keydown", event => event.stopPropagation());
    name.addEventListener("change", () => {
      const to = name.value.trim();
      if (!to || to === layer.name) { name.value = layer.name; return; }
      edit({ op: "layer", id: entry.id, name: layer.name, rename: to });
    });
    row.appendChild(name);

    const count = document.createElement("b");
    count.className = "layer-count";
    count.textContent = layer.count;
    count.title = layer.count + (layer.count === 1 ? " element" : " elements") + " on it";
    row.appendChild(count);

    // What new elements land on. A radio rather than a click on the row,
    // because a row here has four things on it that all do something.
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "layer-icon layer-current";
    pick.innerHTML = svg(ICONS.layerCurrent);
    pick.title = layer.name === current ? "New elements go on this layer"
      : "Draw on this layer from now on";
    pick.setAttribute("aria-pressed", String(layer.name === current));
    pick.addEventListener("click", () =>
      edit({ op: "layer", id: entry.id, name: layer.name, current: true }));
    row.appendChild(pick);

    // Everything on it, picked. The one action here that is about the drawing
    // rather than about the layer, and the one people reach for most - so it
    // is a button rather than only a line in the menu.
    const take = document.createElement("button");
    take.type = "button";
    take.className = "layer-icon";
    take.innerHTML = svg(ICONS.layerSelect);
    take.disabled = !layer.count || !layer.on || layer.locked;
    take.title = !layer.count ? "Nothing is on this layer"
      : !layer.on ? "This layer is off - turn it on to pick what is on it"
      : layer.locked ? "This layer is locked - nothing on it can be picked up"
      : "Select the " + layer.count + (layer.count === 1 ? " element" : " elements")
        + " on this layer";
    take.addEventListener("click", () => selectLayer(entry, layer.name));
    row.appendChild(take);

    const gone = document.createElement("button");
    gone.type = "button";
    gone.className = "layer-icon layer-gone";
    gone.innerHTML = svg(ICONS.layerDelete);
    gone.disabled = layers.length < 2;
    gone.title = layers.length < 2 ? "A drawing is always on one layer"
      : layer.count ? "Delete this layer AND the " + layer.count
          + (layer.count === 1 ? " element" : " elements") + " on it"
        : "Delete this empty layer";
    gone.addEventListener("click", () =>
      edit({ op: "unlayer", id: entry.id, name: layer.name }));
    row.appendChild(gone);

    row.addEventListener("contextmenu", event => {
      event.preventDefault();
      event.stopPropagation();
      openLayerMenu(event, entry, layer, layers, drawing);
    });
    box.appendChild(row);
  }
  return box;
}

//! Everything on a layer, picked. Opens the sketcher if it is not already
//! open, because picking things is something you do in it - and a layer whose
//! elements cannot be picked up says why rather than quietly choosing nothing.
function selectLayer(entry, name) {
  if (sketcher.id !== entry.id) enterSketch(entry.id);
  const drawing = sketchDrawing();
  const found = sketchOnLayer(drawing, name).filter(id => {
    const el = drawing.elements.find(e => e.id === id);
    return el && elementShown(drawing, el) && !elementLocked(drawing, el);
  });
  sketcher.picked = found;
  sketcher.relation = -1;
  refreshSketch();
  buildPanel();
  say(found.length
    ? found.length + (found.length === 1 ? " element" : " elements") + " picked on " + name
      + " · drag any of them to move, Delete to erase"
    : "nothing on " + name + " can be picked - it is empty, off, or locked");
}

//! Right-click on a layer. Everything the row's buttons do, said in words -
//! plus the two things that are about what is picked rather than about the
//! layer, which is what a menu is the right place for.
function openLayerMenu(event, entry, layer, layers, drawing) {
  const menu = document.getElementById("menu");
  menu.textContent = "";
  menuHead(layer.name);

  const here = sketcher.id === entry.id;
  const picked = here ? pickedElements(drawing).map(el => el.id) : [];
  menuItem("Select everything on this layer",
    layer.count ? layer.count + (layer.count === 1 ? " element" : " elements") : "it is empty",
    layer.count && layer.on && !layer.locked ? () => selectLayer(entry, layer.name) : null);
  menuItem("Move the selection to this layer",
    picked.length ? picked.length + (picked.length === 1 ? " element" : " elements")
                  : "nothing is picked in the sketcher",
    picked.length ? () => {
      edit({ op: "relayer", id: entry.id, of: picked, to: layer.name });
      say(picked.length + (picked.length === 1 ? " element" : " elements") + " moved to " + layer.name);
    } : null);
  menuRule();

  menuItem(layer.on ? "Turn it off" : "Turn it on",
    layer.on ? "not drawn, and not built either" : "drawn and built again",
    () => edit({ op: "layer", id: entry.id, name: layer.name, show: !layer.on }));
  menuItem(layer.locked ? "Unlock it" : "Lock it",
    layer.locked ? "so it can be picked up again" : "still drawn and built, but never picked up",
    () => edit({ op: "layer", id: entry.id, name: layer.name, lock: !layer.locked }));
  menuItem("Draw on this layer", "new elements land here",
    () => edit({ op: "layer", id: entry.id, name: layer.name, current: true }));
  menuRule();
  menuItem("Delete this layer",
    layers.length < 2 ? "a drawing is always on one"
      : layer.count ? "and the " + layer.count + (layer.count === 1 ? " element" : " elements")
          + " on it" : "it is empty",
    layers.length < 2 ? null : () => edit({ op: "unlayer", id: entry.id, name: layer.name }));

  placeMenu(event.clientX, event.clientY);
}

//! The drawing's elements, one row each: which layer it is on, from a list,
//! and whether it is construction. The sketcher is where you pick things; this
//! is where you say what they ARE, which is a different job and wants a list.
//!
//! What is picked is what is shown, when anything is - so a window dragged
//! round twelve lines and a look at this panel is the whole gesture. With
//! nothing picked it lists the drawing from the top and says how far it got,
//! because a road layout has five hundred elements and a panel is not a place
//! to put five hundred rows.
const ELEMENT_ROWS = 120;

function elementList(entry, drawing) {
  const box = document.createElement("div");
  box.className = "elements";
  const all = drawing.elements || [];
  if (!all.length) return box;
  const layers = sketchLayers(drawing);
  const here = sketcher.id === entry.id;
  const picked = new Set(here ? pickedElements(drawing).map(el => el.id) : []);
  const chosen = picked.size ? all.filter(el => picked.has(el.id)) : all;
  const shown = chosen.slice(0, ELEMENT_ROWS);

  const head = document.createElement("div");
  head.className = "elements-head";
  head.innerHTML = "<span>Elements</span><span>" + chosen.length
    + (picked.size ? " picked" : " in all") + "</span>";
  box.appendChild(head);

  // One choice for all of them, when several are picked: the move that a
  // window selection is usually dragged out for in the first place.
  if (picked.size > 1) {
    const together = document.createElement("div");
    together.className = "elements-all";
    const label = document.createElement("span");
    label.textContent = "Move all " + picked.size + " to";
    const onto = document.createElement("select");
    onto.className = "element-layer";
    onto.style.flex = "1";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "a layer…";
    onto.appendChild(blank);
    for (const one of layers) {
      const option = document.createElement("option");
      option.value = option.textContent = one.name;
      onto.appendChild(option);
    }
    onto.addEventListener("change", () => {
      if (!onto.value) return;
      edit({ op: "relayer", id: entry.id, of: [...picked], to: onto.value });
      say(picked.size + " elements moved to " + onto.value);
    });
    together.append(label, onto);
    box.appendChild(together);
  }

  if (shown.length < chosen.length) {
    const note = document.createElement("div");
    note.className = "elements-note";
    note.textContent = "The first " + shown.length + " of " + chosen.length
      + " — pick elements in the sketcher and only those are listed.";
    box.appendChild(note);
  }

  const list = document.createElement("div");
  list.className = "elements-list";
  for (const el of shown) {
    const row = document.createElement("div");
    row.className = "element-row";
    row.classList.toggle("picked", picked.has(el.id));

    const who = document.createElement("button");
    who.type = "button";
    who.className = "element-who";
    // "Polyline" is the name of the TOOL; one element the tool made is a line.
    const kind = el.type === "line" ? "Line" : SKETCH_LABELS[el.type] || el.type;
    who.innerHTML = "<b>" + escapeHtml(kind) + "</b><span>" + escapeHtml(el.id) + "</span>";
    who.title = here ? "Pick it in the sketcher" : "Open the sketcher to pick it";
    who.addEventListener("click", () => {
      if (!here) { enterSketch(entry.id); }
      pickInSketch(el.id, false);
      buildPanel();
    });
    row.appendChild(who);

    const onto = document.createElement("select");
    onto.className = "element-layer";
    onto.title = "Which layer it is on";
    for (const one of layers) {
      const option = document.createElement("option");
      option.value = option.textContent = one.name;
      onto.appendChild(option);
    }
    onto.value = el.layer || SKETCH_LAYER;
    onto.addEventListener("change", () =>
      edit({ op: "relayer", id: entry.id, of: [el.id], to: onto.value }));
    row.appendChild(onto);

    const dash = document.createElement("button");
    dash.type = "button";
    dash.className = "element-dash";
    dash.innerHTML = svg(ICONS.dashed);
    dash.setAttribute("aria-pressed", String(isConstruction(el)));
    dash.title = isConstruction(el)
      ? "Construction: drawn dashed, never built. Click to make it real."
      : "Make it construction: dashed, and never built";
    dash.addEventListener("click", () =>
      edit({ op: "construct", id: entry.id, of: [el.id], on: !isConstruction(el) }));
    row.appendChild(dash);

    list.appendChild(row);
  }
  box.appendChild(list);
  return box;
}

function sketchField(entry, arg) {
  const field = document.createElement("div");
  field.className = "field";
  const drawing = (entry.sketch && entry.sketch.drawing) || { elements: [], constraints: [] };
  field.innerHTML = '<div class="field-head"><label>' + arg.label + "</label>" +
    '<span class="kind">' + escapeHtml((entry.sketch && entry.sketch.summary) || "empty") +
    "</span></div>";

  const open = document.createElement("button");
  open.className = "row-btn";
  open.type = "button";
  open.textContent = sketcher.id === entry.id ? "Close the sketcher" : "Draw on it…";
  open.addEventListener("click", () =>
    (sketcher.id === entry.id ? leaveSketch() : enterSketch(entry.id)));
  field.appendChild(open);

  // Holding the corners together. Offered whenever there is a pair of ends in
  // the same place that nothing is holding - which is every drawing that came
  // out of a DXF before the import started doing it on arrival.
  const loose = sketchOverlaps(readSketch(drawing));
  if (loose.length) {
    const join = document.createElement("button");
    join.className = "row-btn";
    join.type = "button";
    join.textContent = "Hold " + loose.length + " overlapping "
      + (loose.length === 1 ? "end" : "ends") + " together";
    join.title = "Ends that lie on top of one another get a coincidence each, so the "
      + "outline stays joined when it is pulled about - and closes into a face.";
    join.addEventListener("click", () => edit({ op: "weld", id: entry.id }));
    field.appendChild(join);
  }

  field.appendChild(layerList(entry, drawing));
  field.appendChild(elementList(entry, drawing));

  const area = document.createElement("textarea");
  area.className = "code";
  area.rows = 7;
  area.spellcheck = false;
  area.value = JSON.stringify(drawing, null, 1);
  area.addEventListener("change", () => {
    let parsed;
    try { parsed = JSON.parse(area.value); }
    catch (err) { showError("the drawing is not valid JSON: " + err.message); return; }
    edit({ op: "sketch", id: entry.id, drawing: parsed });
  });
  field.appendChild(area);

  const path = document.createElement("div");
  path.className = "attr-path";
  path.innerHTML = escapeHtml(entry.labels[arg.key] || "") + " · <b>TDataStd_AsciiString</b>";
  field.appendChild(path);
  return field;
}

//! A LIST OF PICKED SUB-SHAPES, in the panel. What it says now, and the way
//! into the viewport to change it.
//!
//! An empty list is not "none": it is the operation's own default, and on a
//! fillet that is every edge. So the field says "every edge" rather than
//! "0 picked", and the button is an offer to narrow it rather than a
//! requirement to start it.
/* --------------------------------------------------------- a drawing view

   TWO CONTROLS A DRAWING NEEDS AND NOTHING ELSE HAS. What the view leaves out,
   which is a tree with ticks against it, and what each layer is drawn with,
   which is a pen per layer. Both are built here rather than in the package,
   because the package must not know this page exists - it hands over the
   tables and the resolver, and this puts them on screen.                    */

const DRAWING_VIEWS = new Set(["ProjectionView", "CutView"]);

const drawsAView = entry => !!entry && DRAWING_VIEWS.has(entry.type);

//! WHAT A VIEW LEAVES OUT, as the model's own tree with a tick against
//! everything. An exclusion list, so a wing added tomorrow is in the drawing
//! tomorrow - see includedIn, where the same thing is said about why.
function exclusionField(entry, arg) {
  const field = document.createElement("div");
  field.className = "field";
  const off = new Set(readExclusions((entry.texts && entry.texts[arg.key]) || ""));
  const parentOf = id => { const f = feature(id); return f ? (f.parent || null) : null; };
  const childrenOf = id => kidsOf(id).map(f => f.id);
  //! The same list the view itself will draw: everything that is not
  //! setting-out and is not another drawing. A tree with the datums in it is a
  //! tree nobody can find the building in.
  //! WHAT A DRAWING WOULD DRAW, which is the same list the driver works from:
  //! not setting-out, not a number, and not another drawing.
  const drawable = f => f.category !== "datum" && f.category !== "data"
                     && f.category !== "container" && !DRAWING_VIEWS.has(f.type);

  field.innerHTML = '<div class="field-head"><label>' + escapeHtml(arg.label) + "</label>"
    + '<span class="badge">' + (off.size ? off.size + " left out" : "all of it")
    + "</span></div>"
    + '<p class="hint">Everything is in the drawing until you clear its tick. Clearing a '
    + "set clears everything in it - and anything added to the model later is in the "
    + "drawing from the moment it exists.</p>";

  const box = document.createElement("div");
  box.className = "dr-tree";
  //! A SET WITH NOTHING DRAWABLE IN IT IS NOT IN THE TREE. Every document
  //! opens with Origin, Parameters and Relations in it, and none of the three
  //! has anything a drawing could leave out - listed, they are three rows of
  //! ticks that do nothing, at the top, where the building should be.
  const holds = id => {
    for (const child of kidsOf(id)) {
      if (child.category === "container") { if (holds(child.id)) return true; continue; }
      if (drawable(child)) return true;
    }
    return false;
  };
  const rows = [];
  const walk = (id, depth) => {
    for (const child of kidsOf(id)) {
      const isSet = child.category === "container";
      if (isSet ? !holds(child.id) : !drawable(child)) continue;
      const kids = kidsOf(child.id).filter(one =>
        one.category === "container" ? holds(one.id) : drawable(one));
      rows.push({ f: child, depth, kids: kids.length, set: isSet });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  if (!rows.length) {
    const none = document.createElement("p");
    none.className = "hint";
    none.textContent = "There is nothing in the model to leave out yet.";
    box.appendChild(none);
  }
  for (const row of rows) {
    const line = document.createElement("label");
    line.className = "dr-row";
    line.style.paddingLeft = (6 + row.depth * 14) + "px";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    //! TICKED MEANS DRAWN, and a child of an excluded set reads unticked even
    //! though its own id is not in the list - because it is not in the
    //! drawing, and a tick that says otherwise is a tick that lies.
    tick.checked = includedIn(off, row.f.id, parentOf);
    tick.disabled = tick.checked ? false : !off.has(row.f.id);
    tick.addEventListener("change", () => {
      const next = toggleExclusion([...off], row.f.id, tick.checked, childrenOf);
      edit({ op: "code", id: entry.id, key: arg.key,
             text: next.length ? writeExclusions(next) : "" }, { keepPanel: true });
    });
    line.appendChild(tick);
    const name = document.createElement("span");
    name.className = "dr-name";
    name.textContent = row.f.name;
    line.appendChild(name);
    const what = document.createElement("span");
    what.className = "dr-kind";
    what.textContent = row.set ? row.kids + (row.kids === 1 ? " item" : " items")
                               : row.f.type;
    line.appendChild(what);
    box.appendChild(line);
  }
  field.appendChild(box);
  const path = document.createElement("div");
  path.className = "attr-path";
  path.innerHTML = (entry.labels[arg.key] || entry.entry) + " · <b>TDataStd_AsciiString</b>";
  field.appendChild(path);
  return field;
}

//! THE PENS. A layer, a weight, a line type and an ink - which is the whole of
//! what a drawing office ever set, and the reason a drawing reads at a glance.
//!
//! The computed layers are locked: their lines are rebuilt from the model and
//! an edit to them would go silently. Their PENS are not - a pen is not a
//! line, it survives every rebuild, and setting it is most of what somebody
//! wants from this panel.
function drawingLayersField(entry) {
  const field = document.createElement("div");
  field.className = "field";
  //! THE LAYERS ARE WORKED OUT HERE, not sent. The drawing itself is tens of
  //! thousands of points on a building and it travels on every rebuild; the
  //! layer list is the standard set for this kind of view plus whatever the
  //! user has added, which is exactly what assembleDrawing decides, and it can
  //! be decided again here from the authored half alone. How many lines are on
  //! each is in the Computed line above.
  const kind = entry.type === "CutView" ? "cut" : "projection";
  const authored = (entry.sketch && entry.sketch.drawing) || {};
  const layers = assembleDrawing([], authored, kind).layers;
  field.innerHTML = '<div class="field-head"><label>Layers</label>'
    + '<span class="badge">' + layers.length + "</span></div>"
    + '<p class="hint">What each kind of line is drawn with. The computed layers cannot '
    + "be drawn on - their lines come from the model - but their pens are yours, and they "
    + "survive every rebuild. Add a layer to annotate on.</p>";

  //! Written back through the node's own drawing argument, which is the
  //! authored half - so a pen set here is saved with the document and is not
  //! thrown away by the next rebuild.
  const writeLayers = next => {
    const held = entry.sketch && entry.sketch.drawing ? entry.sketch.drawing : {};
    edit({ op: "sketch", id: entry.id, key: "notes",
           drawing: { ...held, layers: next } }, { keepPanel: true });
  };
  const mine = () => {
    const held = entry.sketch && entry.sketch.drawing ? entry.sketch.drawing : {};
    return Array.isArray(held.layers) ? held.layers.map(one => ({ ...one })) : [];
  };

  const box = document.createElement("div");
  box.className = "dr-layers";
  for (const layer of layers) {
    const pen = layerPen(layer);
    const row = document.createElement("div");
    row.className = "dr-layer";
    const name = document.createElement("span");
    name.className = "dr-name";
    name.textContent = layer.name;
    name.title = (DRAW_LAYERS.find(one => one.name === layer.name) || {}).hint || "";
    row.appendChild(name);

    const weight = document.createElement("select");
    weight.className = "dr-pen";
    weight.title = "Pen weight";
    for (const one of CUT_WEIGHTS) {
      const option = document.createElement("option");
      option.value = String(one.key);
      option.textContent = one.label;
      option.selected = Math.abs(one.key - pen.weight) < 1e-6;
      weight.appendChild(option);
    }
    row.appendChild(weight);

    const line = document.createElement("select");
    line.className = "dr-pen";
    line.title = "Line type";
    for (const one of CUT_LINES) {
      if (one.key === "inherit") continue;
      const option = document.createElement("option");
      option.value = one.key;
      option.textContent = one.label;
      option.selected = one.key === pen.line;
      line.appendChild(option);
    }
    row.appendChild(line);

    const ink = document.createElement("input");
    ink.type = "color";
    ink.className = "dr-ink";
    ink.title = "Ink";
    ink.value = hexOf(pen.ink);
    row.appendChild(ink);

    const shown = document.createElement("button");
    shown.type = "button";
    shown.className = "btn row-btn dr-eye";
    shown.textContent = layer.on === false ? "Off" : "On";
    shown.title = "Whether this layer is drawn";
    row.appendChild(shown);

    const change = changes => {
      const next = mine();
      const at = next.findIndex(one => one.name === layer.name);
      const was = at >= 0 ? next[at] : { name: layer.name };
      const written = penRecord({ ...was, name: layer.name }, changes);
      if (at >= 0) next[at] = written; else next.push(written);
      writeLayers(next);
    };
    weight.addEventListener("change", () => change({ weight: Number(weight.value) }));
    line.addEventListener("change", () => change({ line: line.value }));
    ink.addEventListener("change", () => change({ ink: rgbOf(ink.value) }));
    shown.addEventListener("click", () => {
      const next = mine();
      const at = next.findIndex(one => one.name === layer.name);
      const was = at >= 0 ? next[at] : { name: layer.name };
      const now = { ...was, name: layer.name, on: layer.on === false };
      if (at >= 0) next[at] = now; else next.push(now);
      writeLayers(next);
    });
    box.appendChild(row);
  }
  field.appendChild(box);

  const add = document.createElement("button");
  add.className = "btn row-btn";
  add.textContent = "Add a layer";
  add.addEventListener("click", () => {
    const next = mine();
    let n = next.length + 1;
    while (layers.some(one => one.name === "Layer " + n)) n++;
    next.push({ name: "Layer " + n, on: true, locked: false });
    writeLayers(next);
  });
  field.appendChild(add);
  return field;
}

function subsField(entry, arg) {
  const field = document.createElement("div");
  field.className = "field";
  const picks = (entry.lists && entry.lists[arg.key]) || [];
  const source = pickFrom(entry);
  field.innerHTML = '<div class="field-head"><label>' + escapeHtml(arg.label) + "</label>"
    + '<span class="badge">' + escapeHtml(describePicks(picks, arg.of, arg.whole || "all"))
    + "</span></div>"
    + '<button class="btn row-btn" data-pick="' + escapeAttr(arg.key) + '"'
    + (source && source.built ? "" : " disabled") + ">"
    + (picks.length ? "Change the " + escapeHtml(plural(arg.of, 2))
                    : "Pick " + escapeHtml(plural(arg.of, 2)) + " on the model") + "</button>"
    + (picks.length ? '<button class="btn row-btn" data-unpick="' + escapeAttr(arg.key)
        + '">Back to ' + escapeHtml(arg.whole || "all of them") + "</button>" : "")
    + '<p class="hint">' + escapeHtml(arg.summary || "") + "</p>"
    + (picks.length ? '<div class="readout">'
        + picks.map(one => escapeHtml(one.kind + " " + one.at + " of "
            + ((feature(one.of) || {}).name || one.of))).join("<br>") + "</div>" : "");
  field.querySelector("[data-pick]").addEventListener("click", () => enterPicking(entry, arg));
  const back = field.querySelector("[data-unpick]");
  if (back) back.addEventListener("click", () =>
    edit({ op: "pick", id: entry.id, key: arg.key, picks: [] }));
  //! HOW THE PICKS SPREAD, and it is a rule rather than a result.
  //!
  //! This is the difference between a fillet that survives its cylinder being
  //! resized and one that does not. "One by one" is what a list of indices has
  //! always meant. "Tangent" says: these edges AND everything that continues
  //! them smoothly - re-asked on every rebuild, so an arris that gains a
  //! segment gains it in the fillet too. "Touching" says the same of anything
  //! sharing a rim, whatever the angle, which is how you take a whole pocket
  //! off one face of it.
  //!
  //! Offered only once something is picked: there is nothing for a rule to
  //! grow from until then, and the default of "all of them" needs no help.
  if (picks.length && arg.of !== "vertex") {
    const rule = (entry.values && entry.values[arg.key]) || { mode: "one", angle: 5 };
    const spread = document.createElement("div");
    spread.className = "field-head";
    spread.style.marginTop = "6px";
    spread.innerHTML = "<label>Spreads by</label>";
    field.appendChild(spread);
    const group = document.createElement("div");
    group.className = "segmented";
    group.setAttribute("role", "group");
    PICK_MODES.forEach((mode, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = PICK_MODE_LABELS[index];
      button.title = mode === "one"
        ? "Exactly the " + plural(arg.of, picks.length) + " listed"
        : mode === "touching"
          ? "Those, and everything sharing a rim with them - worked out again "
            + "every time the model rebuilds"
          : "Those, and everything that continues them smoothly - worked out "
            + "again every time the model rebuilds, so the run survives a change "
            + "of size";
      button.setAttribute("aria-pressed", rule.mode === mode ? "true" : "false");
      button.addEventListener("click", () =>
        edit({ op: "pick", id: entry.id, key: arg.key, mode }));
      group.appendChild(button);
    });
    field.appendChild(group);
    const said = document.createElement("p");
    said.className = "hint";
    said.textContent = rule.mode === "one"
      ? picks.length + " " + plural(arg.of, picks.length) + ", and only those."
      : (rule.mode === "tangent"
          ? "Grown along tangency from " : "Grown to everything touching ")
        + picks.length + " " + plural(arg.of, picks.length)
        + ", again on every rebuild.";
    field.appendChild(said);
  }
  return field;
}

function editsField(entry, arg) {
  const field = document.createElement("div");
  field.className = "field";
  const moves = (entry.lists && entry.lists[arg.key]) || {};
  const count = Object.keys(moves).length;
  field.innerHTML = '<div class="field-head"><label>' + arg.label + "</label>" +
    '<span class="kind">' + (count ? count + (count === 1 ? " vertex" : " vertices") : "none") +
    "</span></div>";

  const hint = document.createElement("div");
  hint.className = "attr-path";
  hint.style.marginTop = "0";
  hint.textContent = meshEdit.id === entry.id
    ? (meshEdit.vertex >= 0 ? "vertex " + meshEdit.vertex + " · drag an axis, or type below"
                            : "click a handle in the viewport · Esc to leave")
    : "open this feature to show its handles";
  field.appendChild(hint);

  if (meshEdit.id === entry.id && meshEdit.vertex >= 0) {
    const at = meshEdit.vertex;
    const offset = moves[at] || [0, 0, 0];
    const row = document.createElement("div");
    row.className = "triple";
    ["X", "Y", "Z"].forEach((axis, i) => {
      const cell = document.createElement("label");
      cell.innerHTML = "<span>" + axis + "</span>";
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.5";
      input.value = round(offset[i]);
      input.addEventListener("change", () => {
        const next = offset.slice();
        next[i] = Number(input.value) || 0;
        edit({ op: "vertex", id: entry.id, index: at, x: next[0], y: next[1], z: next[2] });
      });
      cell.appendChild(input);
      row.appendChild(cell);
    });
    field.appendChild(row);
  }

  if (count) {
    const actions = document.createElement("div");
    actions.className = "wired";
    actions.innerHTML = "<span>" + count + " moved, in the model file under <b>" +
      escapeHtml(arg.key) + "</b></span>";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear all";
    clear.addEventListener("click", async () => {
      // One vertex at a time, so every undo is one edit in the console too.
      for (const index of Object.keys(moves))
        await edit({ op: "vertex", id: entry.id, index: Number(index), x: 0, y: 0, z: 0 });
    });
    actions.appendChild(clear);
    field.appendChild(actions);
  }

  const path = document.createElement("div");
  path.className = "attr-path";
  path.innerHTML = (entry.labels[arg.key] || entry.entry) + " · <b>TDataStd_AsciiString</b>";
  field.appendChild(path);
  return field;
}

//! The readout. Long lists are shown to a limit with a count, because the
//! point is to see the shape of the data, not to scroll through it.
function dataField(entry) {
  const field = document.createElement("div");
  field.className = "field";
  const data = entry.data;
  field.innerHTML = '<div class="field-head"><label>' +
    (entry.type === "Panel" ? "Watching" : data.kind === "mesh" ? "Mesh" : "Computed") +
    "</label><span class=\"kind\">" +
    (data.kind === "mesh" ? data.faces + (data.faces === 1 ? " face" : " faces")
      : data.count + " " + data.kind + (data.count === 1 ? "" : "s")) + "</span></div>";
  const box = document.createElement("div");
  box.className = "readout";
  box.textContent = data.preview || "—";
  field.appendChild(box);
  const path = document.createElement("div");
  path.className = "attr-path";
  path.innerHTML = entry.entry + ":103 · <b>" +
    (data.kind === "text" ? "TDataStd_ExtStringArray" : "TDataStd_RealArray") + "</b>";
  field.appendChild(path);
  return field;
}

function notice(text, kind) {
  const div = document.createElement("div");
  div.className = "notice" + (kind === "info" ? " info" : "");
  div.textContent = text;
  return div;
}
function showError(message) {
  const host = document.getElementById("def");
  const existing = host.querySelector(".notice.api");
  if (existing) existing.remove();
  const div = notice(message, "bad");
  div.classList.add("api");
  host.prepend(div);
}

//! A number, and the wire that may be driving it. Driven, the slider shows what
//! is arriving and stops taking input - the value is somewhere else now, and
//! the way to change it is to go there or pull the wire off.
function realField(entry, arg) {
  const field = document.createElement("div");
  field.className = "field";
  const value = entry.values[arg.key];
  const path = entry.labels[arg.key] || entry.entry;
  const from = entry.driven ? entry.driven[arg.key] : null;
  const count = entry.lists ? entry.lists[arg.key] : null;

  // The declared range is how far the slider travels, not a limit on the value:
  // a number typed or wired may be anywhere. So the track stretches to hold
  // whatever it is actually showing, and the handle never sits lying at one end.
  const span = sliderSpan(arg, value);
  field.innerHTML =
    '<div class="field-head"><label for="p-' + arg.key + '">' + arg.label + "</label>" +
    //! TEXT, NOT A NUMBER INPUT. A number input will not hold "10m" or
    //! "Width/Bays" long enough to be read - the browser clears what it
    //! cannot parse - and those are the whole point. The spinner goes with
    //! it, which is no loss: the slider beside it is a better one.
    '<span class="value-box"><input type="text" inputmode="text" id="n-' + arg.key +
    '" value="' + round(value) + '" autocomplete="off" spellcheck="false"' +
    (from ? " disabled" : "") + "><span class=\"unit\">" + (arg.unit || "") + "</span></span></div>" +
    '<input type="range" id="p-' + arg.key + '" min="' + span.min + '" max="' + span.max +
    '" step="' + arg.step + '" value="' + value + '"' + (from ? " disabled" : "") + ">";

  if (from) {
    const wire = document.createElement("div");
    wire.className = "wired";
    const source = (feature(from) || {}).name || from;
    //! IT NO LONGER READS THE FIRST, so it no longer says it does. A wire
    //! carrying twenty-eight numbers builds this feature twenty-eight times
    //! and hands the results on together - see Driver.execute.
    const grafted = ((entry.spread && entry.spread.graft) || []).includes(arg.key);
    const many = count > 1 || grafted;
    wire.innerHTML = '<span title="' + escapeAttr(source +
      (many ? " sends " + count + (count === 1 ? " value" : " values")
            + "; this feature is built once for each of them" : "")) +
      '">driven by <b>' + escapeHtml(source) + "</b>" +
      (count > 1 ? " · " + count + " values · one build each" : "") + "</span>";
    const off = document.createElement("button");
    off.type = "button";
    off.textContent = "Unwire";
    off.addEventListener("click", () =>
      mdl.runAll(disconnectShared(entry.id, arg.key))
         .catch(error => showError(error.message)));
    wire.appendChild(off);
    field.appendChild(wire);
  }

  const drivers = state.tree.features.filter(other =>
    other.id !== entry.id && other.produces === "number" && !dependsOn(other.id, entry.id));
  if (!from && drivers.length) {
    const pick = document.createElement("select");
    pick.className = "drive";
    pick.hidden = true;
    pick.innerHTML = '<option value="">— take this from a number —</option>' +
      drivers.map(d => '<option value="' + escapeAttr(d.id) + '">' + escapeHtml(d.name) +
        "</option>").join("");
    pick.addEventListener("change", () => pick.value &&
      mdl.runAll(connectShared(entry.id, arg.key, pick.value))
         .catch(error => showError(error.message)));
    field.appendChild(pick);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "drive-toggle";
    toggle.title = "Drive this from a number";
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = svg(ICONS.wire);
    toggle.addEventListener("click", () => {
      pick.hidden = !pick.hidden;
      toggle.setAttribute("aria-expanded", pick.hidden ? "false" : "true");
      if (!pick.hidden) pick.focus();
    });
    field.querySelector(".field-head").appendChild(toggle);
  }

  const trail = document.createElement("div");
  trail.className = "attr-path";
  trail.innerHTML = path + " · <b>TDataStd_Real</b>" +
    (from ? " · <b>TDF_Reference</b> → " + escapeHtml((feature(from) || {}).entry || from) : "");
  field.appendChild(trail);

  const slider = field.querySelector('input[type="range"]');
  const number = field.querySelector(".value-box input");
  const send = (raw, live) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    slider.value = v; number.value = round(v);
    pushParameter(entry.id, arg.key, v, false, live);
  };
  //! `input` while the hand is down, `change` when it comes up. Only the
  //! second means "that is the number" - see drainParameters.
  slider.addEventListener("input", () => send(slider.value, true));
  slider.addEventListener("change", () => restParameter());
  number.addEventListener("change", () => typeValue(entry, arg, number, slider));
  number.addEventListener("input", () => sayValue(field, entry, arg, number.value));
  return field;
}

/* ------------------------------------------- what a person may type into it

   A BOX THAT ONLY TAKES 4.5 makes you do the arithmetic on paper and type the
   answer in, and a model built that way is full of numbers nobody can
   explain. So the box takes what a person would say: a quantity with a unit
   on it, arithmetic over quantities, and the NAME of something else in the
   document.

   The last of those is the one that matters. Typing a name does not copy a
   number - it wires the two together, which is the whole difference between a
   parametric model and a spreadsheet of numbers that used to agree. And
   typing arithmetic over two names makes an Expression node in the tree and
   in the graph, wires both of them into it, and wires it into the field: what
   CATIA calls a formula, and what you asked for.

   The reading itself is in formula.js and knows nothing about any of this. */

//! What the fields know about: everything that produces a number, by name.
function numberNamed(name) {
  const said = String(name || "").trim().toLowerCase();
  return state.tree.features.find(f =>
    f.produces === "number" && String(f.name).trim().toLowerCase() === said) || null;
}

const numberValue = name => {
  const one = numberNamed(name);
  if (!one) return undefined;
  const preview = (one.data || {}).preview;
  const read = Number(String(preview == null ? "" : preview).match(/[-\d.eE+]+/));
  if (Number.isFinite(read)) return read;
  const values = one.values || {};
  for (const key of ["value", "a", "start", "from"])
    if (Number.isFinite(Number(values[key]))) return Number(values[key]);
  return undefined;
};

//! What was typed, read, without doing anything about it. Used live as the
//! keys go in, so a person can see what the box is making of it before they
//! commit to it.
const readTyped = (arg, text, id) => readValue(text, {
  unit: arg.unit,
  lookup: numberValue,
  known: name => { const one = numberNamed(name);
                   return !!one && one.id !== id && !dependsOn(one.id, id); },
});

//! The running commentary under the box. Three lines of HTML and it is the
//! whole of what makes typing "Width/Bays" feel safe: it says what it will do
//! before it does it.
function sayValue(field, entry, arg, text) {
  let note = field.querySelector(".value-said");
  const said = String(text || "").trim();
  const plain = said === "" || /^-?\d*\.?\d*$/.test(said);
  if (plain) { if (note) note.remove(); return; }
  if (!note) {
    note = document.createElement("div");
    note.className = "value-said";
    field.querySelector(".field-head").after(note);
  }
  const got = readTyped(arg, said, entry.id);
  const trim = v => Math.round(v * 1000) / 1000;
  note.classList.toggle("bad", got.kind === "error");
  note.textContent =
      got.kind === "error" ? got.message
    : got.kind === "number" ? "= " + trim(got.value) + (arg.unit ? " " + arg.unit : "")
    : got.kind === "wire" ? "follows " + got.name
    : got.kind === "formula"
      ? "a formula over " + got.names.join(" and ")
        + (got.value === null ? "" : " \u00b7 " + trim(got.value)
           + (arg.unit ? " " + arg.unit : "") + " today")
    : "";
}

//! And what happens when it is committed. One of three things, and which one
//! is the reading's to say rather than this function's to guess.
async function typeValue(entry, arg, box, slider) {
  const got = readTyped(arg, box.value, entry.id);
  if (got.kind === "blank") { box.value = round(entry.values[arg.key]); return; }
  if (got.kind === "error") { showError(got.message); return; }
  if (got.kind === "number") {
    if (slider) slider.value = got.value;
    box.value = round(got.value);
    pushParameter(entry.id, arg.key, got.value);
    return;
  }
  if (got.kind === "wire") {
    const source = numberNamed(got.name);
    if (!source) { showError("nothing here is called " + got.name); return; }
    await edit({ op: "connect", id: entry.id, key: arg.key, from: source.id })
      .catch(error => showError(error.message));
    say(arg.label + " follows " + source.name);
    return;
  }
  // A FORMULA BECOMES A NODE. Three wires in, one out, and it is in the tree
  // and in the graph like everything else - which is the point: a formula you
  // cannot see is a number that changes for no reason.
  const sources = got.names.map(numberNamed);
  if (sources.some(one => !one)) { showError("something in that formula is not here"); return; }
  const id = "FX" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const refs = {};
  sources.forEach((one, i) => { refs["abc"[i]] = one.id; });
  const edits = [
    { op: "add", type: "Expression", id, name: saysFormula(got.said), refs },
    { op: "code", id, key: "formula", text: got.js },
    { op: "connect", id: entry.id, key: arg.key, from: id },
  ];
  try {
    await mdl.runAll(edits);
    say(arg.label + " is now " + saysFormula(got.said)
        + " \u00b7 it is in the tree, and in the graph");
    select(entry.id, true);
  } catch (error) { showError(error.message); }
}

//! A parameter the script declared. It is stored on a label of its own, so it
//! reads and writes exactly like a catalogue argument.
function scriptField(entry, param) {
  const field = document.createElement("div");
  field.className = "field";

  // A declared parameter that names its alternatives gets a switch, the same
  // one a catalogue choice gets.
  if (param.options) {
    field.innerHTML = '<div class="field-head"><label>' + escapeHtml(param.label) + "</label></div>";
    const group = document.createElement("div");
    group.className = "segmented";
    group.dataset.key = param.key;
    group.setAttribute("role", "group");
    param.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option;
      button.setAttribute("aria-pressed", index === Math.round(param.value) ? "true" : "false");
      button.addEventListener("click", () => pushParameter(entry.id, param.key, index, true));
      group.appendChild(button);
    });
    field.appendChild(group);

    const path = document.createElement("div");
    path.className = "attr-path";
    path.innerHTML = escapeHtml(param.key) + " · <b>TDataStd_Real</b> · declared by the script";
    field.appendChild(path);
    return field;
  }

  field.innerHTML =
    '<div class="field-head"><label for="s-' + param.key + '">' + escapeHtml(param.label) + "</label>" +
    '<span class="value-box"><input type="text" inputmode="text" autocomplete="off"'
    + ' spellcheck="false" id="sn-' + param.key + '" value="' +
    round(param.value) + '" step="' + param.step + '" min="' + param.min + '" max="' + param.max +
    '"><span class="unit">' + escapeHtml(param.unit || "") + "</span></span></div>" +
    '<input type="range" id="s-' + param.key + '" min="' + param.min + '" max="' + param.max +
    '" step="' + param.step + '" value="' + param.value + '">' +
    '<div class="attr-path">' + escapeHtml(param.key) + " · <b>TDataStd_Real</b> · declared by the script</div>";

  const slider = field.querySelector('input[type="range"]');
  const number = field.querySelector(".value-box input");
  const send = (raw, live) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    slider.value = v; number.value = round(v);
    pushParameter(entry.id, param.key, v, false, live);
  };
  slider.addEventListener("input", () => send(slider.value, true));
  slider.addEventListener("change", () => restParameter());
  // A parameter a script declared takes what a catalogue argument takes: a
  // quantity, some arithmetic, or the name of a number to follow. One rule.
  number.addEventListener("change", () => {
    const got = readTyped({ key: param.key, label: param.label, unit: param.unit || "" },
                          number.value, entry.id);
    if (got.kind === "number") { send(got.value); return; }
    if (got.kind === "error") { showError(got.message); return; }
    if (got.kind === "blank") { number.value = round(param.value); return; }
    typeValue(entry, { key: param.key, label: param.label, unit: param.unit || "" },
              number, slider);
  });
  number.addEventListener("input", () =>
    sayValue(field, entry, { key: param.key, label: param.label, unit: param.unit || "" },
             number.value));
  return field;
}

//! The source of a Script feature. Applied on demand rather than on every
//! keystroke, because a half-written function is not a model.
function codeEditor(entry) {
  const editor = document.createElement("div");
  editor.className = "editor";
  editor.innerHTML =
    '<div class="editor-head"><label for="code-area"><b>Code</b></label>' +
    '<span class="kind" style="font-family:var(--mono);font-size:9.5px;color:var(--ink-3)">' +
    (entry.labels[entry.codeKey] || entry.entry) + " · TDataStd_AsciiString</span></div>";

  const area = document.createElement("textarea");
  area.id = "code-area";
  area.spellcheck = false;
  area.value = entry.code;
  editor.appendChild(area);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Return an object with params and build(p, k). k gives you box, "
    + "cylinder, sphere, sector, beam, tube, move, rotate, cut, fuse, common, fillet "
    + "and compound. Declared parameters become the sliders above.";
  editor.appendChild(hint);

  const row = document.createElement("div");
  row.className = "row";
  const apply = document.createElement("button");
  apply.className = "btn primary";
  apply.textContent = "Run";
  const revert = document.createElement("button");
  revert.className = "btn";
  revert.textContent = "Revert";
  const status = document.createElement("span");
  status.className = "spacer";
  status.style.cssText = "font-size:11px;color:var(--ink-3);text-align:right";
  row.append(apply, revert, status);
  editor.appendChild(row);

  const run = async () => {
    apply.disabled = true;
    status.textContent = "running…";
    try {
      await mdl.run({ op: "code", id: entry.id, key: entry.codeKey, text: area.value });
      status.textContent = "";
    } catch (err) {
      status.textContent = err.message.slice(0, 60);
    } finally { apply.disabled = false; }
  };
  apply.addEventListener("click", run);
  revert.addEventListener("click", () => { area.value = entry.code; status.textContent = ""; });

  // Tab belongs to the code, not to the next control.
  area.addEventListener("keydown", event => {
    if (event.key === "Tab") {
      event.preventDefault();
      const at = area.selectionStart;
      area.setRangeText("  ", at, area.selectionEnd, "end");
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); run(); }
  });
  return editor;
}

function refField(entry, arg) {
  const field = document.createElement("div");
  field.className = "field";
  const many = arg.kind === "refs";
  const wired = many ? (entry.lists[arg.key] || []) : [entry.refs[arg.key] || ""].filter(Boolean);
  const accepts = arg.accepts.split(",");
  const options = state.tree.features.filter(other =>
    other.id !== entry.id && acceptsFrom(accepts, other) && !dependsOn(other.id, entry.id));

  field.innerHTML = '<div class="field-head"><label>' + arg.label + "</label>" +
    '<span class="kind">' + accepts.join(" / ") + (many ? " · in order" : "") + "</span></div>";

  // One wire is a dropdown. Several are a list, each with the way to remove it,
  // and a dropdown at the end that adds the next one.
  for (const id of many ? wired : []) {
    const row = document.createElement("div");
    row.className = "wired";
    row.innerHTML = "<span>" + escapeHtml((feature(id) || {}).name || id) + "</span>";
    const off = document.createElement("button");
    off.type = "button";
    off.textContent = "Remove";
    off.addEventListener("click", () =>
      mdl.runAll(disconnectShared(entry.id, arg.key, id))
         .catch(error => showError(error.message)));
    row.appendChild(off);
    field.appendChild(row);
  }

  // A WIRE IS PICKED, NOT CHOSEN FROM A LIST.
  //
  // A dropdown asks you to recognise a point by its name in a list of forty.
  // Nobody knows their points by name; they know where they are. So the field
  // is a button that arms the picker - click it, then click the point in the
  // model or its row in the tree, and that is the wire. The list is still
  // there, one click further on, for the cases where the thing is behind
  // something or has no geometry to click at all.
  const armed = waiting.on && waiting.id === entry.id && waiting.key === arg.key;
  const current = many ? "" : wired[0] || "";
  const free = many ? options.filter(o => !wired.includes(o.id)) : options;

  const row = document.createElement("div");
  row.className = "wire-row" + (armed ? " armed" : "");
  const take = document.createElement("button");
  take.type = "button";
  take.className = "btn wire-pick";
  take.textContent = armed ? "Pick it in the model, or in the tree · Esc to stop"
    : many ? "Add one from the model"
    : current ? escapeHtml((feature(current) || {}).name || current)
    : "Pick one from the model";
  take.title = armed ? "Click the " + accepts.join(" or ") + " in the viewport or the tree"
    : "Click, then click the " + accepts.join(" or ") + " in the viewport or the tree";
  take.addEventListener("click", () => (armed ? stopWaiting() : waitForPick(entry, arg)));
  row.appendChild(take);

  // The last resort, folded away: the same list it always was.
  const more = document.createElement("button");
  more.type = "button";
  more.className = "wire-more";
  more.setAttribute("aria-expanded", "false");
  more.title = "Choose from a list instead";
  more.textContent = "\u25be";
  row.appendChild(more);
  field.appendChild(row);

  const select = document.createElement("select");
  select.className = "wire-list";
  select.hidden = true;
  select.innerHTML = '<option value="">' + (many ? "— add a section —" : "— not set —") +
    "</option>" + free.map(option =>
      '<option value="' + escapeAttr(option.id) + '"' + (option.id === current ? " selected" : "") +
      ">" + escapeHtml(option.name) + "</option>").join("");
  select.addEventListener("change", () =>
    mdl.runAll(select.value ? connectShared(entry.id, arg.key, select.value)
                            : disconnectShared(entry.id, arg.key))
       .catch(error => showError(error.message)));
  more.addEventListener("click", () => {
    select.hidden = !select.hidden;
    more.setAttribute("aria-expanded", select.hidden ? "false" : "true");
  });
  field.appendChild(select);

  // And the way to take a wire off, when there is one and it is not a list.
  if (!many && current) {
    const off = document.createElement("button");
    off.type = "button";
    off.className = "wire-off";
    off.textContent = "Disconnect";
    off.addEventListener("click", () =>
      mdl.runAll(disconnectShared(entry.id, arg.key))
         .catch(error => showError(error.message)));
    row.insertBefore(off, more);
  }

  const path = document.createElement("div");
  path.className = "attr-path";
  path.innerHTML = (entry.labels[arg.key] || entry.entry) + " · <b>TDF_Reference</b>" +
    (wired.length && !many ? " → " + (feature(wired[0]) || {}).entry : "") +
    (many ? " × " + wired.length : "") +
    (arg.consumes ? " · consumes the body" : "");
  field.appendChild(path);
  return field;
}

//! True when \p id already depends on \p onId - the guard that stops the
//! reference dropdown from offering a cycle.
function dependsOn(id, onId) {
  const seen = new Set();
  const walk = current => {
    if (current === onId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    return wiresOf(current).some(target => walk(target));
  };
  return walk(id);
}

//! Everything a feature reads from: reference arguments, sliders being driven,
//! and every wire into an input that takes several.
function wiresOf(id) {
  const entry = feature(id);
  if (!entry) return [];
  const out = Object.values(entry.refs || {}).filter(Boolean);
  for (const value of Object.values(entry.lists || {}))
    if (Array.isArray(value)) out.push(...value.filter(Boolean));
  return out;
}

/* ---------------------------------------------------------------------- log */
function buildLog() {
  const host = document.getElementById("log-pop");
  const summary = document.getElementById("status-regen");
  host.textContent = "";
  const report = state.report;
  if (!report) { summary.textContent = "ready"; return; }

  // The status bar carries the shape of the last regeneration; the detail is
  // one click away rather than permanently on screen.
  summary.innerHTML = report.failed.length
    ? '<span class="err">' + escapeHtml(report.failed[0].name) + " failed</span>"
    : '<span class="ran">' + report.executed.length + "</span> of " + report.functions +
      " rebuilt" + (state.stream ? " · " + state.stream.triangles.toLocaleString() + " tris" : "");

  const line = (text, className) => {
    const div = document.createElement("div");
    div.className = className;
    div.textContent = text;
    host.appendChild(div);
  };
  line("regenerated " + report.executed.length + " of " + report.functions + " functions", "head");
  for (const e of report.executed) line("+ " + e.name + "  rev " + e.revision, "ran");
  for (const e of report.failed) line("! " + e.name + ": " + e.message, "err");
  for (const e of report.skipped) line("= " + e.name, "same");
  if (state.stream)
    line("streamed " + state.stream.shapes + " shape" + (state.stream.shapes === 1 ? "" : "s") +
         " · " + state.stream.triangles.toLocaleString() + " triangles · " + state.stream.ms + " ms",
         "stream");
  //! WHAT THE VIEWPORT IS ACTUALLY DOING WITH THEM, when it is doing anything
  //! other than drawing the lot. Said here rather than left to be guessed at:
  //! a box standing in for a beam is a thing a person should be told about,
  //! not something they find out by wondering why a detail went square.
  if (detail.on)
    line("holding " + detail.held.toLocaleString() + " triangles · drawing " + detail.drawn
         + " shapes whole · " + detail.boxed + " as boxes · " + detail.gone
         + " off screen or under " + detail.vanish + " px"
         + (unmeshed.size ? " · " + unmeshed.size.toLocaleString() + " not fetched yet" : ""),
         "stream");
  // It just got taller or shorter, and the tree above it stands on it.
  if (!host.hidden) layout();
}

/* -------------------------------------------------------------- operations

   A NUMBER BEING DRAGGED, AND THE SAME NUMBER LET GO OF.

   A slider fires far faster than the kernel can rebuild, so the newest value
   wins and everything in between is dropped. That is enough while a rebuild
   costs forty milliseconds and nothing like enough while one costs five
   seconds: dropping frames does not help when every frame you keep is five
   seconds long.

   So a model that is slow is drafted while the hand is down - see setDrafting
   in ocaf.js, and the two roads through builders.Intersect - and built
   properly the moment it comes up. "Slow" is measured, not guessed: the last
   ACCURATE rebuild is timed, and a model that rebuilds in forty milliseconds
   never takes the cheap road at all, because there is nothing to gain and a
   slightly coarser curve to lose.                                            */

let inFlight = false, pendingParam = null;
//! How long the last accurate rebuild took. Only accurate ones are timed: a
//! draft is fast by construction, and timing those would turn the draft off
//! again on the next frame.
let lastExactMs = 0;
//! A hand is on a slider now; and a draft may be on screen with no hand on
//! anything, which is the one state that must not be allowed to persist.
let dragLive = false, needExact = false;
//! Below this a rebuild is not worth approximating: the pause is shorter than
//! the eye notices and the exact curve is right there.
const DRAFT_ABOVE_MS = 120;

async function pushParameter(id, key, value, rebuildPanel = false, live = false) {
  pendingParam = { id, key, value, rebuildPanel };
  dragLive = !!live;
  if (!live) needExact = true;
  return drainParameters();
}

//! THE HAND CAME OFF. Sent on a slider's `change`, which is the only event
//! that means it - `input` fires for every pixel of the drag and cannot tell
//! the last one from the rest. Nothing is pushed: the value arrived with the
//! final `input`. What this asks for is the accurate build of it.
async function restParameter() {
  dragLive = false;
  needExact = true;
  return drainParameters();
}

async function drainParameters() {
  if (inFlight || !ready) return;          // the loop below will see what was left
  inFlight = true;
  try {
    while (pendingParam || needExact) {
      if (pendingParam) {
        const next = pendingParam;
        pendingParam = null;
        const cheap = dragLive && lastExactMs > DRAFT_ABOVE_MS;
        // Flipped without a rebuild of its own: the edit on the next line is
        // the rebuild, and doing both would build the model twice.
        await mdl.draft(cheap, false);
        const started = performance.now();
        await mdl.run({ op: "set", id: next.id, key: next.key, value: next.value },
                      { keepPanel: !next.rebuildPanel });
        if (!cheap) { lastExactMs = performance.now() - started; needExact = false; }
        continue;
      }
      needExact = false;
      const started = performance.now();
      const payload = await mdl.draft(false, true);
      if (payload) lastExactMs = performance.now() - started;
    }
  } catch (err) { showError(err.message); }
  finally { inFlight = false; }
}

async function addFeature(type) {
  if (!ready) return;
  const spec = schemaType(type);
  // A set takes what is picked with it. That is how a group gets made anywhere
  // else, and it saves the alternative - make an empty set, then move six
  // things into it one at a time through the menu.
  const taking = spec.category === "container" ? state.picked.slice() : [];
  // No refs: the edit wires the inputs itself, the way a CAD command does - the
  // selected body for an operation, the first datum of the right type for the
  // rest. Typing the same edit into the graph console gets the same wiring.
  const payload = await edit({ op: "add", type });
  if (!payload) return;
  //! A POINT LANDS ON A PLANE WHEN THERE IS ONE.
  //!
  //! "On a plane" is what a person wants from the Point button: two numbers
  //! measured in a plane they can see, which stay meaningful when the plane
  //! moves. Three world coordinates are the answer when you already know
  //! where the thing is in space, which is the last thing you know while a
  //! model is being built.
  //!
  //! Done here and not as the catalogue's default, because it depends on the
  //! document: a point on a plane needs a plane. With none, the node stays on
  //! Coordinates rather than arriving broken - and {"op":"add","type":"Point"}
  //! from a script or a file still means what it has always meant.
  if (type === "Point" && !payload.refs) {
    const chosen = state.selected ? feature(state.selected) : null;
    const plane = (chosen && chosen.produces === "plane" && chosen.built) ? chosen
      : (state.tree.features || []).find(f => f.produces === "plane" && f.built);
    if (plane) {
      await mdl.runAll([{ op: "set", id: payload.id, key: "kind", value: 6 },
                        { op: "connect", id: payload.id, key: "plane", from: plane.id }]);
    }
  }
  if (taking.length)
    await mdl.runAll(taking.map(id => ({ op: "group", id, into: payload.id })));
  //! AND INTO THE SET BEING WORKED IN, which is CATIA's "define in work
  //! object" and the reason its tree stays readable in a long session.
  //!
  //! Without it every new feature lands at the top level and the tidying is a
  //! job you do afterwards, one right-click at a time, by which point you have
  //! forgotten which of forty loose points belonged with which surface. With
  //! it, the set you are working in is stated once and everything made after
  //! that goes there.
  //!
  //! A set does NOT go inside itself, and a set made while working in one
  //! DOES go inside it - which is how a sub-set is made, and the same gesture
  //! CATIA uses.
  if (state.workingIn && feature(state.workingIn) && payload.id !== state.workingIn)
    await mdl.run({ op: "group", id: payload.id, into: state.workingIn });
  select(payload.id, true);
  //! A SKETCH OPENS. Making one and then having to say "now let me draw on
  //! it" is a step that exists for no reason: nobody makes an empty sketch on
  //! purpose, and a sketch with nothing on it is the one thing in the document
  //! that cannot build. It mounts on whatever plane was selected - see
  //! defaultRefs - and you are inside it, drawing, which is what pressing the
  //! button meant.
  if (spec.type === "Sketch") { enterSketch(payload.id); return; }
  //! AND A POINT KEEPS GOING. The first one is made where the button was
  //! pressed - at the plane's origin, which is somewhere you can see - and
  //! then the pointer drops more of them until Esc, Enter or Done. Points
  //! come in groups: a setting-out is nine and a profile's controls are six,
  //! and pressing a button five times between each is the step this removes.
  if (spec.type === "Point") { beginPlacing(feature(payload.id)); return; }
  if (spec.category !== "datum" && spec.category !== "container") fitView();
  offerHeads(payload.id);
}

//! One feature or a whole block of them, and a block is one step to undo.
//!
//! In falling order, because the kernel refuses to delete anything that is
//! still being read from: select a sketch and the pad made out of it and the
//! pad has to go first, which is not the order anybody clicked them in.
//! Nothing is asked and nothing is refused: a delete takes what it is given,
//! takes a set's contents with it, and cuts the wires that were reading it.
//! Undo is one keystroke away and is a better answer than a dialog that
//! appears every time and is read the first two.
async function deleteFeature(what) {
  const ids = (Array.isArray(what) ? what : [what]).filter(Boolean);
  if (!ids.length) return;
  const was = { selected: state.selected, edited: state.edited, picked: state.picked.slice() };
  if (ids.includes(state.selected)) { state.selected = null; state.anchor = null; }
  if (ids.includes(state.edited)) state.edited = null;
  state.picked = state.picked.filter(id => !ids.includes(id));
  const order = inFallingOrder(ids);
  const done = ids.length === 1
    ? await edit({ op: "delete", id: order[0] })
    : await edit.many(order.map(id => ({ op: "delete", id })));
  if (!done) {
    state.selected = was.selected;
    state.edited = was.edited;
    state.picked = was.picked;
    buildPanel();
  }
}

//! Everything between the last thing clicked and this one, as the tree draws
//! them. That is what shift has meant in every list since the Finder, and
//! doing it one row at a time - which is what this used to make you do - is
//! not a shortcut for it, it is the thing the shortcut exists to replace.
//!
//! The anchor is wherever the selection last STARTED, so shift-clicking again
//! grows or shrinks the same block rather than starting a new one from
//! wherever the block happens to end.
function pickRange(id) {
  const from = treeOrder.indexOf(state.anchor ?? state.selected);
  const to = treeOrder.indexOf(id);
  if (to < 0) return;
  if (from < 0) { select(id, false); return; }
  const lo = Math.min(from, to), hi = Math.max(from, to);
  state.picked = treeOrder.slice(lo, hi + 1);
  // The row clicked is the one the panel follows; the anchor stays where it
  // was, which is what makes the block adjustable.
  select(id, false, true);
}

//! Ctrl adds one to what is picked and takes it away again; a plain click
//! starts over. The set is what a Loft's sections and a Join's parts are wired
//! from, and what Delete removes - so picking several is worth doing.
function pickAlso(id) {
  if (!id) { state.picked = []; select(null, false); return; }
  state.picked = state.picked.includes(id)
    ? state.picked.filter(p => p !== id)
    : [...state.picked, id];
  // The panel follows the last one picked, and the set is kept: this is the
  // one path that adds rather than replaces.
  select(state.picked.length ? state.picked[state.picked.length - 1] : null, false, true);
}

//! \p keep leaves the picked set alone; without it a selection is a set of
//! one, so there is only ever one answer to "what is selected".
function select(id, openDefinition, keep = false) {
  // A row in the tree is as good an answer as a click in the model, and for a
  // datum with nothing to click at it is the only one.
  if (waiting.on && id && offerWire(id)) return;
  // A plain click is where a range will be measured from next time. Adding to
  // the set does not move that, or a block could never be grown twice.
  if (!keep) { state.picked = id ? [id] : []; state.anchor = id; }
  state.selected = id;
  if (openDefinition || (id && state.edited && id !== state.edited)) state.edited = id;
  const entry = feature(id);
  document.getElementById("status-sel").innerHTML = entry
    ? "<b>" + escapeHtml(entry.name) + "</b> · " + entry.entry + " · " + entry.type
    : "click a body · double-click to edit it";
  sayCurrentSet();
  //! PAINTED, NOT REBUILT. Nothing about the tree's shape depends on what is
  //! selected - only which rows are marked - and rebuilding it to mark them is
  //! what made a click in a large model take four seconds.
  paintTree(); buildPanel(); refreshToolbar(); paintSelection();
  //! And the row is brought into view when it is already on screen somewhere.
  //! Opening folded sets is NOT done here: folding is a thing somebody did on
  //! purpose, and a click should not undo it. "Show in tree" is the command
  //! that opens them, and it is on the menu.
  if (id) revealInTree(id, { open: false });
  refreshMeshEdit();
  // The widget belongs to whatever is selected, so it follows the selection -
  // and goes away when what is selected is not a thing it can move.
  if (gizmo.mode && !gizmo.grab) refreshGizmo();
  // "Open its definition" means show it, and on a phone the definition is a
  // sheet. Selecting alone does not raise it: the model is what you are
  // looking at, and a sheet over it every time you tapped a body would be
  // the model half the time.
  if (phoneSheets && openDefinition && onPhone() && state.edited) openSheet("def");
  // Selecting anything else leaves the sketch; the tree is a way out too.
  if (sketcher.id && id !== sketcher.id) leaveSketch();
  else if (sketcher.id) refreshSketch();
  if (graph.showing) graph.update();
  if (staging) refreshStageSelection();
}

//! Everything the kernel says, in one place: mirror the tree, redraw the
//! panels, then fetch the triangles for whatever it rebuilt.
function applyState(payload, options = {}) {
  if (payload.tree) state.tree = payload.tree;
  // An analysis is about a shape. Change the shape and it is about something
  // that is no longer there - and a stale one looks exactly like a fresh one.
  // Telling the modes happens in syncShapes, NOT here: the tree arrives first
  // and the triangles a moment later, so a mode told at this point would
  // rebuild itself from the shape as it was before the edit.
  if (payload.report) state.report = payload.report;
  buildTree();
  buildLog();
  updateStamp();
  if (options.keepPanel) { refreshPanelNotice(); refreshPanelValues(); }
  else buildPanel();
  refreshToolbar();
  graph.sync();
  //! AND THE PANEL COMES DOWN WHEN THE TRIANGLES ARE HERE, not when the
  //! kernel finished. Building and drawing are one wait to the person doing
  //! it, and saying "done" with a third of the model on screen is saying the
  //! wrong thing.
  syncShapes().then(buildLog).catch(err => showError(err.message))
              .finally(doneWorking);
  keepModel();
  //! WEB BIM: this page is also the second interface onto a Web BIM document.
  //! The page that holds it hears about every change and brings the building
  //! up to date - see the bridge at the end of this file.
  const bridge = globalThis.__webbimCad;
  if (bridge && bridge.onChange) bridge.onChange();
}

/* --------------------------------------------------------- the spare copy

   A tab can go away without asking: a reload, a crash, a phone deciding the
   page has been in the background long enough. The document is text - that is
   the whole design - so there is no reason for any of that to cost anything,
   and this keeps the last one in the browser's own store beside the page.

   It is NOT a save. The file is what the Model dialog writes and what Export
   produces; this is the thing that is there when you come back and find the
   tab did not survive the night. It is kept per document, it is written after
   the edit rather than during it, and it never gets in the way of an edit: a
   store that is full or switched off is a store that quietly does nothing.   */

const SPARE = "ocafcad/spare";
//! Four megabytes. localStorage is about five in every browser that has it,
//! and a model carrying an imported STEP file can be bigger than that - so
//! the size is checked and the truth is told rather than a quota error being
//! thrown into the middle of somebody's edit.
const SPARE_LIMIT = 4e6;
let sparePending = 0, spareSaid = false, spareBusy = false;

function keepModel() {
  if (!ready || !mdl) return;
  // After the edit, not during it, and never two at once. Serialising the
  // document asks the kernel for the whole of it, and the kernel answers one
  // question at a time: a spare copy taken while an edit is still in flight
  // would be a second caller in there, which is the one way a background
  // convenience could take the page down with it.
  clearTimeout(sparePending);
  sparePending = setTimeout(async () => {
    if (spareBusy || inFlight) { keepModel(); return; }
    spareBusy = true;
    try {
      const text = await mdl.modelText(0);
      if (text.length > SPARE_LIMIT) {
        if (!spareSaid) {
          spareSaid = true;
          say("this model is too big to keep a spare copy of in the browser - "
            + "export it, or keep the model file");
        }
        try { localStorage.removeItem(SPARE); } catch (e) { /* nothing to remove */ }
        return;
      }
      spareSaid = false;
      localStorage.setItem(SPARE, JSON.stringify({ at: Date.now(), text }));
    } catch (err) { /* a full or private store keeps nothing, and says nothing */ }
    finally { spareBusy = false; }
  }, 900);
}

//! What was left in the browser last time, if anything, and how long ago.
function spareModel() {
  try {
    const said = JSON.parse(localStorage.getItem(SPARE) || "null");
    return said && typeof said.text === "string" && said.text.length > 40 ? said : null;
  } catch (e) { return null; }
}

//! Offered, never forced. A model that opens by itself over the one somebody
//! wanted is worse than one that has to be asked for - so this is a line in
//! the status bar with a button on it, and doing nothing loses nothing.
function offerSpare() {
  const spare = spareModel();
  if (!spare) return;
  const old = Date.now() - spare.at;
  // Something from ten seconds ago is this session reloading, not a crash.
  if (old < 8000) return;
  const bar = document.getElementById("status-sel");
  const ago = old < 90e3 ? Math.round(old / 1000) + " s"
    : old < 5400e3 ? Math.round(old / 60e3) + " min"
    : Math.round(old / 3600e3) + " h";
  bar.innerHTML = "";
  bar.append("a model from " + ago + " ago was left open  ");
  const open = document.createElement("button");
  open.className = "btn primary";
  open.textContent = "Recover it";
  open.addEventListener("click", async () => {
    try {
      await mdl.run({ op: "model", model: JSON.parse(spare.text) });
      say("recovered the model that was open " + ago + " ago");
      fitView();
    } catch (err) { showError(err.message); }
  });
  const no = document.createElement("button");
  no.className = "btn";
  no.textContent = "Discard";
  no.addEventListener("click", () => {
    try { localStorage.removeItem(SPARE); } catch (e) { /* already gone */ }
    say("the spare copy is gone");
  });
  bar.append(open, no);
}

function updateStamp() {
  if (!state.tree) return;
  document.getElementById("doc-title").textContent = state.tree.name;
  document.getElementById("doc-count").textContent =
    state.tree.features.length + " features · " + state.tree.units;
  //! WHICH THREAD IS DOING THE WORK, and it has to be asked of `inWorker`
  //! rather than of `kind`. The worker's proxy carries the kernel's own
  //! properties across the port, `kind` among them - so a kernel in a worker
  //! says "wasm" exactly like one in the page, and this read "modelling in
  //! this page" for the whole time it was not. Which is the one line anybody
  //! would look at to find out whether the worker started.
  document.getElementById("status-kernel").textContent =
    !kernel ? "starting…"
    : kernel.inWorker ? "modelling on its own thread"
    : kernel.kind === "wasm" ? "modelling in this page"
    : kernel.description;
}

/* ----------------------------------------------------------- which kernel */

function setLink(active) {
  const chip = document.getElementById("btn-link");
  chip.classList.toggle("live", !!active);
  document.getElementById("link-label").textContent = !active ? "starting…"
    : active.kind === "wasm" ? "in page"
    : (active.base ? active.base.replace(/^https?:\/\//, "") : "same origin");
}

//! Hands the interface over to a kernel: catalogue first, then the document,
//! then the triangles. Nothing above here knows which kernel it got.
async function attachKernel(next, model) {
  kernel = next;
  ready = false;
  //! The page is what says a build is happening, so the page is what hears
  //! about it. A kernel that cannot call back leaves this alone and the panel
  //! simply never appears.
  if ("onBuild" in kernel) kernel.onBuild = watchBuilding;
  state.schema = await kernel.schema();
  buildToolbar();
  buildDock();
  //! After the rail is built, because there is nothing to arm until the
  //! elements exist. Idempotent - dragToScroll marks what it has already done.
  armScrolling();

  for (const [, { group }] of shapes) disposeGroup(group);
  shapes.clear();
  state.stream = null;

  const payload = model ? await kernel.loadModel(model) : await kernel.tree();
  ready = true;
  setLink(kernel);
  applyState(payload);

  const bodies = state.tree.features.filter(f => f.category !== "datum");
  // Selected and its definition ready, but on a phone the sheet stays down:
  // the first thing anybody should see is the model, not a panel about it.
  const raise = phoneSheets;
  phoneSheets = false;
  select(bodies.length ? bodies[bodies.length - 1].id : null, true);
  phoneSheets = raise;
  fitView();
}

/* Where the big pieces sit when they are not inside the page. Relative to the
   page, because that is what makes the folder movable: a site at /cad and a
   site at / are the same files. */
const KERNEL_URL = "kernel/replicad_single.wasm";
const STAGE_URL = "kernel/playcanvas.min.js";

const boot = message => {
  const el = document.getElementById("boot-message");
  if (el) el.textContent = message;
};

//! Where the 22 MB of WebAssembly comes from. In the single-file build it is
//! inside the page, gzipped to about 9 MB of text; served from a web server it
//! is a file beside the page. Either way it arrives as a Response, so the
//! streaming compiler starts on it before it has finished arriving.
const kernelResponse = () =>
  resource("kernel-payload", KERNEL_URL, "the modeller", "application/wasm");

/* ------------------------------------------------- where the modelling runs

   OFF THIS THREAD IF IT CAN BE, because the one thing an interface must not do
   is stop.

   A boolean between two buildings is ten seconds of solid C++ compiled to
   WebAssembly, and on the page's own thread that is ten seconds in which
   nothing else happens: no scroll, no hover, not even the spinner that was
   there to say the program had not died. Everything else in this file is about
   not asking for that work until it is needed; this is about the work itself
   being somewhere else while it happens.

   It is a try, not a requirement. A browser with no workers, a page opened off
   the filesystem, a worker that refuses to start - any of those and the
   modelling happens here as it always did, which is slower to live with and
   is not broken.                                                            */

const WORKER_URL = "app/kernel-worker.js";

let pageKernel = null;

//! The worker first. The WebAssembly is unpacked here - the page is what can
//! reach the payload element - and handed over rather than fetched twice.
async function useWorkerKernel() {
  boot("unpacking the modeller");
  const bytes = await (await kernelResponse()).arrayBuffer();
  const worker = await createWorkerKernel({
    url: WORKER_URL, elementId: "worker-payload", wasmBinary: bytes, onProgress: boot });
  //! Proved before it is trusted: a worker that starts and then cannot answer
  //! is worse than one that never started, because the fallback has gone.
  await worker.schema();
  return worker;
}

async function makePageKernel() {
  {
    boot("unpacking the modeller");
    const instantiateWasm = (imports, onReady) => {
      kernelResponse()
        .then(answer => WebAssembly.instantiateStreaming(answer, imports))
        .then(result => onReady(result.instance, result.module))
        .catch(() =>
          // Some browsers refuse to stream-compile a synthesised response, so
          // the whole of it is read first and compiled from the buffer.
          kernelResponse()
            .then(answer => answer.arrayBuffer())
            .then(buffer => WebAssembly.instantiate(buffer, imports))
            .then(result => onReady(result.instance, result.module))
            .catch(err => boot(err.message)));
      return {};   // emscripten reads this as "the instance is coming later"
    };
    return createWasmKernel({ initModule: replicadInit, instantiateWasm, onProgress: boot });
  }
}

async function usePageKernel() {
  if (!pageKernel) {
    try {
      pageKernel = await useWorkerKernel();
    } catch (err) {
      //! Said out loud rather than swallowed: "it is slower than it should be"
      //! is a thing somebody should be able to find out.
      pageKernel = await makePageKernel();
      setTimeout(() => say("the modelling is running on this page's own thread - "
        + "this browser would not start a worker (" + err.message + "), so a long "
        + "build will hold the window while it runs"), 1500);
    }
  }
  await attachKernel(pageKernel, STARTER);
  //! WEB BIM: the IFC package is always on - a building comes and goes as IFC,
  //! and the classes it reads map onto the building's own.
  packages.load("ifc").catch(err => say("the IFC package would not start: " + err.message));
  //! A NEW PART OPENS WITH PART CURRENT. The four folders exist so there is
  //! somewhere for everything to go; leaving none of them current would make
  //! the first thing anybody draws land loose at the top level beside them,
  //! which is the arrangement the folders were put there to avoid.
  //!
  //! Only when nothing is remembered and only when it is really this starter,
  //! so opening a document of your own does not have a set chosen for you.
  if (!state.workingIn && feature("PART")) workIn("PART");
}

async function useNativeKernel(base) {
  const model = kernel ? await kernel.model() : null;
  const next = await createHttpKernel(base);
  // Carry the part across rather than dropping the user back on the starter.
  await attachKernel(next, model);
  try { localStorage.setItem("ocafcad/base", base); } catch (e) { /* private window */ }
}

/* ------------------------------------------------------------------- boot */
const modalLink = document.getElementById("modal-link");
const modal = document.getElementById("modal");

document.getElementById("btn-link").addEventListener("click", () => modalLink.showModal());
document.getElementById("btn-disconnect").addEventListener("click", async () => {
  modalLink.close();
  const model = kernel ? await kernel.model() : null;
  await attachKernel(pageKernel, model || STARTER);
});
document.getElementById("btn-connect").addEventListener("click", async () => {
  const button = document.getElementById("btn-connect");
  const url = document.getElementById("link-url").value.trim().replace(/\/$/, "");
  button.textContent = "Connecting…";
  try {
    await useNativeKernel(url);
    modalLink.close();
    button.textContent = "Connect";
  } catch (err) {
    button.textContent = "Nothing at that address";
    setTimeout(() => { button.textContent = "Connect"; }, 2600);
  }
});

/* ------------------------------------------------------------------ samples

   A worked example, loaded whole. It replaces the document, so it takes two
   clicks: one to open the list, one to choose - and the list says so.
   -------------------------------------------------------------------------- */

const sampleMenu = document.getElementById("sample-menu");

//! THE MODEL BEHIND A SAMPLE, whichever way this page keeps it. Two of them are
//! written in the source and are simply there; the rest are model files in
//! data/samples/ - packed into the single-file build, served from the folder
//! otherwise - and this is the one place that difference is handled. Read once
//! and kept, so opening the same sample twice does not fetch it twice.
const sampleModels = new Map();

async function sampleModel(sample) {
  if (sample.model) return sample.model;
  if (sampleModels.has(sample.key)) return sampleModels.get(sample.key);
  const model = await unpackResource("sample-" + sample.key,
                                     "the " + sample.name + " sample",
                                     "data/" + sample.file);
  sampleModels.set(sample.key, model);
  return model;
}

function buildSampleMenu() {
  sampleMenu.textContent = "";
  // The samples scroll and the warning under them does not: see the stylesheet.
  const scroller = document.createElement("div");
  scroller.className = "scroller";
  sampleMenu.appendChild(scroller);
  for (const sample of SAMPLES) {
    const button = document.createElement("button");
    button.innerHTML = "<b>" + escapeHtml(sample.name) + "</b><span>" +
      escapeHtml(sample.summary) + "</span>";
    button.addEventListener("click", async () => {
      sampleMenu.hidden = true;
      state.hidden.clear();
      state.selected = null;
      state.edited = null;
      // Straight down the same channel as everything else, so it lands in the
      // graph console like any other edit. A sample kept as a file has to be
      // read first, and a read that fails says so where the click was rather
      // than leaving an empty document and no reason for it.
      let model;
      try { model = await sampleModel(sample); }
      catch (error) { say("could not open " + sample.name + ": " + error.message); return; }
      if (await edit({ op: "model", model })) fitView();
    });
    scroller.appendChild(button);
  }
  const warn = document.createElement("div");
  warn.className = "warn";
  warn.textContent = "replaces what is open · copy it out with Model first";
  sampleMenu.appendChild(warn);
}

document.getElementById("btn-sample").addEventListener("click", event => {
  if (!sampleMenu.hidden) { sampleMenu.hidden = true; return; }
  if (!sampleMenu.childElementCount) buildSampleMenu();
  const rect = event.currentTarget.getBoundingClientRect();
  sampleMenu.style.left = Math.min(rect.left, innerWidth - 336) + "px";
  sampleMenu.style.top = rect.bottom + 8 + "px";
  sampleMenu.hidden = false;
});
addEventListener("pointerdown", event => {
  if (!sampleMenu.hidden && !sampleMenu.contains(event.target) &&
      !document.getElementById("btn-sample").contains(event.target)) sampleMenu.hidden = true;
}, true);

/* --------------------------------------------------------------- node graph
   The specification tree read the other way round. It owns no state of its own
   beyond where the nodes sit, and even that is written into the model file, so
   a part opens laid out the way it was left.
   -------------------------------------------------------------------------- */

const graph = new GraphEditor({
  mdl,
  read: () => ({ tree: state.tree, schema: state.schema, selected: state.selected,
                 picked: state.picked }),
  get icons() { return ICONS; },
  openDefinition: id => { select(id, true); toggleTree(true); },
  onOpen: () => document.getElementById("btn-graph").setAttribute("aria-pressed", "true"),
  onClose: () => document.getElementById("btn-graph").setAttribute("aria-pressed", "false"),
  // The graph may be on another screen; the drawing is not. Draw… on a sketch
  // node opens the sketcher here.
  onSketch: id => { focus(); enterSketch(id); },
  onPhone: () => onPhone(),
});
document.getElementById("btn-graph").addEventListener("click", () => graph.toggle());
/* ----------------------------------------------------------- undo, redo */

//! Both are edits, so they go down the same channel as everything else and are
//! recorded the same way. What they walk is the stack of model files the
//! channel keeps: every edit that changed the document remembers what it said
//! before, so undo is never a guess about what an edit did.
function step(back) {
  mdl.run({ op: back ? "undo" : "redo" })
     .then(() => { select(state.selected, false); refreshSteps(); })
     .catch(err => { showError(err.message); refreshSteps(); });
}

function refreshSteps() {
  const undo = document.getElementById("btn-undo");
  const redo = document.getElementById("btn-redo");
  undo.disabled = !mdl.undoable;
  redo.disabled = !mdl.redoable;
  undo.dataset.label = mdl.undoable ? "Undo " + mdl.undoable + " (Ctrl+Z)" : "Nothing to undo";
  redo.dataset.label = mdl.redoable ? "Redo " + mdl.redoable + " (Ctrl+Shift+Z)" : "Nothing to redo";
}

document.getElementById("btn-undo").addEventListener("click", () => step(true));
document.getElementById("btn-redo").addEventListener("click", () => step(false));
// Every edit moves the stack, wherever it came from - a slider here, a wire in
// the node graph, a line typed into the console.
mdl.watch(() => refreshSteps());

document.getElementById("sketch-done").addEventListener("click", leaveSketch);
document.getElementById("place-done").addEventListener("click", endPlacing);
document.getElementById("sketch-unrelate").addEventListener("click", dropRelation);
const constructButton = document.getElementById("sketch-construct");
constructButton.innerHTML = svg(ICONS.dashed);
constructButton.addEventListener("click", toggleConstruction);
document.getElementById("sketch-tangent").addEventListener("click", () => {
  sketcher.tangent = !sketcher.tangent;
  refreshSketch();
});
document.getElementById("sketch-do-round").addEventListener("click", roundSketchCorner);

/* ----------------------------------------------------------------------- AI

   Claude, working the one channel everything else works. It is handed the op
   table, the catalogue and the document, and what it writes goes through
   mdl.run exactly as a dragged wire does - so there is nothing it can do that
   could not have been typed into the console, and watching it work is watching
   nodes appear and wire themselves up.
   ========================================================================== */

const agent = new Agent({
  mdl,
  // The model file as the kernel writes it - the same text the Model dialog
  // shows and the same one a sample loads. There is only one of it.
  read: async () => ({
    schema: state.schema,
    // What is on the shelf as well as what is loaded, so the answer to "can it
    // do a sun study" is "load the Climate package" rather than an invented
    // node or a flat no.
    packages: packages.schema(),
    // Lightened: a document carrying imported geometry is megabytes of B-Rep,
    // and in a prompt that is megabytes of nothing. What the assistant needs
    // to know about an import is that it is there and how big it is.
    model: lightenModel(await kernel.model()),
    errors: (state.tree ? state.tree.features : [])
      .filter(f => f.error).map(f => f.id + ' \"' + f.name + '\": ' + f.error),
  }),
  onBusy: busy => {
    following = busy;
    if (busy) fitView();
    aiBar.classList.toggle("working", busy);
    document.getElementById("ai-stop").hidden = !busy;
    document.getElementById("ai-send").disabled = busy;
    document.getElementById("ai-state").textContent = busy ? "building" : "ask";
  },
});

const aiBar = document.getElementById("ai-bar");
const aiLog = document.getElementById("ai-log");

function aiSay(className, text) {
  const line = document.createElement("div");
  line.className = className;
  line.textContent = text;
  aiLog.appendChild(line);
  aiLog.scrollTop = aiLog.scrollHeight;
  return line;
}

//! How many lines are behind the fold, so a shut panel still says there is
//! something to look at.
function aiCount() {
  const fold = document.getElementById("ai-fold");
  fold.dataset.count = aiLog.childElementCount || "";
}

//! What Claude is doing, as it does it. An edit that lands is one line of the
//! language, shown as the language - because that is exactly what was sent.
function aiEvent(event, running) {
  if (event.kind === "text") {
    if (!running.said) running.said = aiSay("said", "");
    running.said.textContent = event.text;
    aiLog.scrollTop = aiLog.scrollHeight;
    return;
  }
  if (event.kind === "edit" || event.kind === "refused") {
    const line = document.createElement("div");
    line.className = event.kind === "refused" ? "bad" : "did";
    if (event.kind === "refused") {
      line.textContent = "refused: " + JSON.stringify(event.edit) + " — " + event.message;
    } else {
      const what = document.createElement("b");
      what.textContent = event.edit.op;
      const rest = document.createElement("span");
      const { op, ...fields } = event.edit;
      rest.textContent = JSON.stringify(fields);
      line.append(what, rest);
    }
    aiLog.appendChild(line);
    aiLog.scrollTop = aiLog.scrollHeight;
    aiCount();
    // The next thing it says starts a new line rather than growing this one.
    running.said = null;
  }
}

async function aiAsk() {
  const field = document.getElementById("ai-prompt");
  const prompt = field.value.trim();
  if (!prompt || agent.busy) return;
  // Nobody to ask: open the way to fix it rather than refusing into a log. What
  // was typed stays in the box, so connecting and pressing Build is the whole
  // of the recovery.
  if (!(await agent.ready())) { openAIConnect(); return; }
  field.value = "";
  aiSay("asked", prompt);
  const running = { said: null };
  try {
    await agent.ask(prompt, event => aiEvent(event, running));
  } catch (err) {
    aiSay("bad", agentTrouble(err));
    // A key that has stopped working should stop looking connected.
    const code = err && err.code;
    if (code === "http_401" || code === "http_403") { agent.disconnect(); refreshAI(); }
  }
}

//! The working is worth watching the first time and in the way the tenth, so
//! it folds down to the prompt alone and stays that way until it is opened
//! again. What is happening is still on screen: it is the model.
function foldAI(shut) {
  aiBar.classList.toggle("folded", shut);
  const fold = document.getElementById("ai-fold");
  fold.setAttribute("aria-pressed", shut ? "true" : "false");
  fold.dataset.label = shut ? "Show what it is doing" : "Hide what it is doing";
  remember("ocafcad/ai-fold", shut ? "shut" : "open");
  aiLog.scrollTop = aiLog.scrollHeight;
}

function openAI(open) {
  aiBar.hidden = !open;
  document.getElementById("btn-ai").setAttribute("aria-pressed", open ? "true" : "false");
  if (!open) {
    agent.stop();
    if (sheetOpen() === "ai") openSheet("");
    return;
  }
  document.getElementById("ai-prompt").focus();
  // Said once, on the first opening, so nobody types into a bar that cannot ask.
  if (!aiBar.dataset.checked) {
    aiBar.dataset.checked = "1";
    agent.ready().then(sample => {
      refreshAI();
      if (sample) return;
      aiSay("bad", agentTrouble({ message: "no-sample" }));
      aiSay("said", "A key is made at " + KEY_HOME + " and stays in this browser.");
    });
  }
}

/* ------------------------------------------------------- connecting Claude

   The assistant needs somebody to answer. Published as an Artifact the page
   asks the reader's own Claude account and none of this is ever seen. Served as
   an ordinary web page there is nobody to ask, so the person connects a key of
   their own - it stays in their browser, and the work is billed to them.     */

const aiDialog = document.getElementById("modal-ai");
const aiConnectButton = document.getElementById("ai-connect");

//! The bar, told what it is connected to. It is the one place that says so, so
//! "why is this doing nothing" has an answer on screen rather than in a log.
function refreshAI() {
  const how = agent.connection;
  aiConnectButton.hidden = how.how === "page" || how.how === "unknown";
  aiConnectButton.textContent = how.how === "key" ? "Connected" : "Connect";
  aiConnectButton.title = how.how === "key"
    ? "Running on " + how.key + " · " + how.model + " — press to change or forget it"
    : "Connect your Anthropic account so the assistant can answer";
  document.getElementById("ai-prompt").placeholder = how.how === "none"
    ? "connect an Anthropic key to ask for something…"
    : "a hillside villa with a lap pool and a cantilevered roof…";
}

function buildAIDialog() {
  const how = agent.connection;
  const select = document.getElementById("ai-model");
  if (!select.options.length)
    for (const model of MODELS) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label + " — " + model.note;
      select.appendChild(option);
    }
  select.value = how.model || DEFAULT_MODEL;
  document.getElementById("ai-model-note").textContent = "billed to your account";
  document.getElementById("ai-connect-state").textContent = how.how === "key"
    ? "connected · " + how.key + " · " + how.model
    : "not connected";
  document.getElementById("btn-ai-forget").hidden = how.how !== "key";
  document.getElementById("ai-key").value = "";
  document.getElementById("btn-ai-go").textContent = how.how === "key" ? "Reconnect" : "Connect";
}

function openAIConnect() {
  buildAIDialog();
  aiDialog.showModal();
  document.getElementById("ai-key").focus();
}

aiConnectButton.addEventListener("click", openAIConnect);
document.getElementById("btn-ai-cancel").addEventListener("click", () => aiDialog.close());
document.getElementById("btn-ai-forget").addEventListener("click", () => {
  agent.disconnect();
  buildAIDialog();
  refreshAI();
  aiSay("bad", "The key is forgotten. Nothing can be asked until one is connected again.");
});
document.getElementById("btn-ai-go").addEventListener("click", async () => {
  const button = document.getElementById("btn-ai-go");
  const state = document.getElementById("ai-connect-state");
  const was = button.textContent;
  button.disabled = true;
  button.textContent = "checking…";
  state.textContent = "asking Anthropic whether that key works…";
  try {
    const how = await agent.connect(document.getElementById("ai-key").value,
                                    document.getElementById("ai-model").value);
    aiDialog.close();
    refreshAI();
    aiSay("said", "Connected · " + how.key + " · " + how.model
      + ". Ask for something and it will build it.");
  } catch (err) {
    state.textContent = agentTrouble(err);
    button.textContent = was;
  } finally { button.disabled = false; }
});
document.getElementById("ai-key").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); document.getElementById("btn-ai-go").click(); }
  event.stopPropagation();
});

document.getElementById("ai-fold").addEventListener("click", () =>
  foldAI(!aiBar.classList.contains("folded")));
document.getElementById("btn-ai").addEventListener("click", () => openAI(aiBar.hidden));
document.getElementById("ai-send").addEventListener("click", aiAsk);
document.getElementById("ai-stop").addEventListener("click", () => {
  agent.stop();
  aiSay("bad", "Stopped. Ask for something else, or say what to change.");
});
document.getElementById("ai-close").addEventListener("click", () => openAI(false));
document.getElementById("ai-prompt").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); aiAsk(); }
  event.stopPropagation();
});

/* ----------------------------------------------------------------- showroom

   The modelling view and the stage are two renderers over one document: the
   kernel's triangles go to both, and neither owns the model.                */

const showroom = new Showroom({
  canvas: document.getElementById("stage-canvas"),
  payloadId: "showroom-payload",
  payloadUrl: STAGE_URL,
});
const stage = document.getElementById("showroom");
const stageUi = document.getElementById("stage-ui");
let staging = false;

function buildStageControls() {
  const finishes = document.getElementById("stage-finishes");
  for (const finish of FINISHES) {
    const button = document.createElement("button");
    button.className = "swatch";
    button.dataset.finish = finish.key;
    button.title = finish.label;
    button.setAttribute("aria-label", finish.label);
    button.setAttribute("aria-pressed", "false");
    const [r, g, b] = finish.color;
    button.style.background = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    if (finish.metalness > 0.5)
      button.style.backgroundImage =
        "linear-gradient(140deg, rgba(255,255,255,.75), rgba(255,255,255,0) 55%)";
    button.addEventListener("click", () => applyFinish(finish.key));
    finishes.appendChild(button);
  }

  const envs = document.getElementById("stage-envs");
  for (const preset of ENVIRONMENTS) {
    const button = document.createElement("button");
    button.textContent = preset.label;
    button.dataset.env = preset.key;
    button.setAttribute("aria-pressed", preset.key === showroom.environment ? "true" : "false");
    button.addEventListener("click", () => {
      showroom.applyEnvironment(preset.key);
      for (const other of envs.children)
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
      syncStageToggles();
    });
    envs.appendChild(button);
  }
}

//! The scene presets carry their own floor and reflection, so the toggles
//! follow whichever stage is showing rather than arguing with it.
function syncStageToggles() {
  document.getElementById("btn-stage-ground")
    .setAttribute("aria-pressed", showroom.ground && showroom.ground.enabled ? "true" : "false");
  document.getElementById("btn-stage-reflect")
    .setAttribute("aria-pressed", showroom.reflection > 0.01 ? "true" : "false");
}

function refreshStageSelection() {
  const entry = feature(state.selected);
  document.getElementById("stage-part").textContent = entry ? entry.name : "nothing selected";
  const current = entry && entry.appearance ? entry.appearance.finish : null;
  for (const button of document.querySelectorAll("#stage-finishes .swatch"))
    button.setAttribute("aria-pressed", button.dataset.finish === current ? "true" : "false");
  if (showroom.ready) showroom.highlight(state.selected);
}

async function applyFinish(key) {
  const entry = feature(state.selected);
  if (!entry) return;
  const appearance = appearanceOf(key);
  showroom.paint(entry.id, appearance);
  try {
    await mdl.run({ op: "appearance", id: entry.id, appearance }, { keepPanel: true });
  } catch (err) { showError(err.message); }
  refreshStageSelection();
}

function stageResize() {
  if (!showroom.ready) return;
  showroom.resize(innerWidth, innerHeight);
}

async function enterShowroom() {
  const button = document.getElementById("btn-stage");
  const was = button.textContent;
  button.disabled = true;
  button.textContent = "opening…";
  try {
    const firstTime = !showroom.ready;
    //! THE SHOWROOM IS A PHOTOGRAPH, so it gets the whole model: a box where
    //! a balustrade was is fine at two pixels in the modeller and is the
    //! subject of the picture here.
    await makeResident("Preparing the showroom\u2026");
    await showroom.start();
    if (firstTime) {
      buildStageControls();
      showroom.onPick = id => { state.selected = id; refreshStageSelection(); };
      addEventListener("resize", stageResize);
    }
    stageResize();
    showroom.setScene(state.tree.features, streams);
    syncStageToggles();

    // Arrive from where the modelling camera was looking, then ease to the
    // hero view - the move is the transition.
    showroom.orbit.yaw = -(view.yaw * 180 / Math.PI) - 90;
    showroom.orbit.pitch = Math.max(-8, Math.min(80, view.pitch * 180 / Math.PI));
    showroom.place();

    staging = true;
    document.body.classList.add("staging");
    stage.classList.add("on");
    requestAnimationFrame(() => stageUi.classList.add("shown"));
    showroom.frame(null, 950);
    button.textContent = was;
  } catch (err) {
    button.textContent = err.message.slice(0, 34);
    setTimeout(() => { button.textContent = was; }, 3200);
  } finally { button.disabled = false; }
}

function leaveShowroom() {
  staging = false;
  showroom.turntable = false;
  document.getElementById("btn-stage-spin").setAttribute("aria-pressed", "false");
  stageUi.classList.remove("shown");
  stage.classList.remove("on");
  document.body.classList.remove("staging");
  buildTree(); buildPanel(); refreshToolbar();
}

/* ==========================================================================
   Packages.

   A package is off until it is asked for. What it gets when it is asked for is
   this kit: the kernel, the document language, and the pieces of the viewport
   it needs to draw over the model. It is deliberately the real ones rather than
   a smaller copy - a package's node is a node, and a package's view draws in
   the same scene everything else does.
   ========================================================================== */

//! Every mode a loaded package offers, and which one is open. More than one
//! package can bring a view, so this is a list rather than a variable - and
//! only one is ever open, because they all draw over the same model.
let modes = [];
let openMode = null;

//! A HANDLE FOR DRIVING THE PAGE FROM OUTSIDE IT, which is how the browser
//! tests look at what the viewport decided. Nothing in the program reads it.
//! WHAT THE VIEWPORT IS HOLDING, for a harness driving the real page and for
//! anybody who wants to know why a frame cost what it did. Read-only in
//! spirit: nothing in the program reads this back.
globalThis.__cad = {
  detail, shapes, unmeshed, view, setShape,
  entry: id => feature(id),
  //! So the tree's reveal can be driven and MEASURED from outside. Where a row
  //! lands after being scrolled to is not something that can be checked by
  //! reading the code: it depends on layout the browser has not done yet.
  reveal: id => revealInTree(id),
  get kernel() { return kernel; },
  get camera() { return camera; },
  look: () => lookAtDetail(),
  fit: () => fitView(),
  run: command => mdl.run(command),
  packages: () => packages,
  turn: (yaw, pitch) => { view.yaw += yaw; if (pitch) view.pitch += pitch;
                          placeCamera(); draw(); },
  zoom: by => { view.distance *= by; placeCamera(); draw(); },
  sample: n => [...shapes.entries()].slice(0, n).map(([id, held]) => ({
    id, visible: held.group.visible, want: held.group.userData.want,
    across: held.group.userData.across, tris: held.group.userData.triangles,
    ball: held.group.userData.ball
      ? { r: held.group.userData.ball.r,
          at: held.group.userData.ball.at.toArray().map(v => Math.round(v)) } : null,
  })),
};

const packageKit = {
  get kernel() { return kernel; },
  mdl,
  THREE, world, scene, camera,
  streams: () => streams,
  tree: () => state.tree || { features: [] },
  hidden: () => state.hidden,
  theme: () => THEME,
  draw: () => draw(),
  fitView: () => fitView(),

  //! The model's own meshes, hidden while something is drawn over them. Not the
  //! whole world group: a package's own drawing is in there too, and hiding
  //! that would hide the thing being looked at.
  //!
  //! Coming BACK is not "show everything". A mode that turned the model off
  //! and then turned every mesh on again would show the things somebody has
  //! hidden and the things an operation has consumed - the tree would say
  //! hidden and the viewport would say otherwise, and the tree is right. So
  //! the way back is the same function every other redraw uses, which reads
  //! the document and the hide set rather than setting a flag.
  setModelVisible(on) {
    if (on) applyVisibility(); else for (const { group } of shapes.values()) group.visible = false;
    draw();
  },

  //! Frame something that is not the model. A package's own drawing can be far
  //! bigger than the part it is about - a sun dome over a doorknob - and
  //! fitView only knows about the model's own meshes, so it would leave the
  //! camera inside it looking at nothing.
  frameOn(centre, radius) {
    view.span = Math.max(radius, 1);
    view.target.set(centre[0], centre[1], centre[2]);
    view.distance = frameFor(view.span, freeRect()).distance;
    placeCamera();
    draw();
  },

  //! Straight down over something, which a plan view is. Kept here rather than
  //! in the package because it is the camera, and the camera is the page's.
  lookDown(centre, radius) {
    view.span = Math.max(radius, 1);
    view.target.set(centre[0], centre[1], centre[2]);
    view.distance = frameFor(view.span, freeRect()).distance;
    view.pitch = Math.PI / 2 - 0.001;
    view.yaw = 0;
    placeCamera();
    draw();
  },

  //! A PACKAGE THAT CAN READ A KIND OF FILE NOBODY ELSE CAN.
  //!
  //! The one hook a format needs, because everything else about opening a file
  //! - the picker, the drop veil, sniffing what a nameless file is - belongs
  //! to the page and stays with it. A reader says which
  //! extensions are its own and how to turn the text into a model file; the
  //! page does the rest, so an imported building lands on the undo stack like
  //! anything else.
  //!
  //! Hands back the way to take it off again, which is what a package's
  //! dispose is for: putting the package away has to leave the page exactly as
  //! it found it, including not claiming .ifc any more.
  addReader(reader) {
    if (!reader || !reader.key) return () => {};
    readers.set(reader.key, reader);
    refreshAccept();
    return () => { readers.delete(reader.key); refreshAccept(); };
  },

  toolkit: () => kernel.toolkit(),
  installDrivers: (specs, builders) => kernel.installDrivers(specs, builders),
  removeDrivers: specs => kernel.removeDrivers(specs),
  //! SWITCHED ON WHERE THE MODELLING IS. A driver is a closure over the
  //! kernel and a closure cannot cross a message port, so when the modelling
  //! is in a worker the package is switched on THERE, from the same
  //! declaration this side is reading. Answers false when the modelling is
  //! here, and the host installs the drivers itself as it always did.
  usePackage: async id => {
    if (!kernel || !kernel.inWorker) return false;
    await kernel.usePackage(id);
    return true;
  },
  dropPackage: async id => {
    if (!kernel || !kernel.inWorker) return false;
    await kernel.dropPackage(id);
    return true;
  },
  typesInUse: types => kernel.typesInUse(types),
};

const packages = new PluginHost(packageKit, { onChange: () => afterPackages() });

//! A package that adds nodes has changed the catalogue, so everything built
//! from the catalogue is stale: the rail, the graph's menu, and what the
//! assistant is told it can use.
async function afterPackages() {
  state.schema = await kernel.schema();
  buildToolbar();
  refreshToolbar();
  buildPackages();
  buildModes();
}

//! A button per mode, in the chip beside Showroom. A package that is put away
//! takes its button - and its open mode - with it.
/* ==========================================================================
   The phone.

   One document, one kernel, one set of edits - a second arrangement of the
   surface, because a phone is a third of the width with no hover, no
   right-click and a thumb rather than a pointer.

   The model gets the screen. Everything that floated somewhere different on a
   desktop - the rail, the tree, the definition, the assistant - becomes the
   same thing here: a sheet that comes up from the dock over the model, one at
   a time, and goes away again. And the way between modes is not five buttons
   in the far corner from a thumb; it is a tab in that dock, and the modes are
   a list with names in it.
   ========================================================================== */

//! A phone is narrow AND has a thumb on it. Width alone called a narrow window
//! on a desktop a phone - which is what a page in a side panel is - and handed
//! a mouse the dock, the sheets and every control sized for a thumb. The
//! stylesheet is gated on the same two things in the same words; a narrow
//! window with a pointer stays a desktop and is scaled down to fit instead.
const PHONE = matchMedia("(max-width: 900px) and (pointer: coarse)");
const onPhone = () => PHONE.matches;

//! Whether opening a definition should raise the sheet that shows it. It should
//! - that is what opening one means - except while the page is starting, where
//! nobody asked for anything yet and the model is the thing to see.
let phoneSheets = true;

const DOCK_ICONS = {
  tools: ICONS.Cube || ICONS.part,
  tree: '<path d="M3 4h10M3 8h10M3 12h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  def: '<path d="M2.8 12.4l7.1-7.1 2.8 2.8-7.1 7.1H2.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'
     + '<path d="M9.9 5.3l1.6-1.6a1.4 1.4 0 012 0l.8.8a1.4 1.4 0 010 2l-1.6 1.6" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  modes: '<rect x="2" y="2.5" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.25"/>'
       + '<rect x="9" y="2.5" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.25"/>'
       + '<rect x="2" y="8.8" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.25"/>'
       + '<rect x="9" y="8.8" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.25"/>',
  ai: '<path d="M8 2.2l1.5 3.9L13.4 7.6 9.5 9.1 8 13 6.5 9.1 2.6 7.6 6.5 6.1z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>',
};

const MODE_ICONS = {
  model: ICONS.Cube || ICONS.part,
  nodes: '<circle cx="4" cy="4.5" r="2" fill="none" stroke="currentColor" stroke-width="1.25"/>'
       + '<circle cx="12" cy="11.5" r="2" fill="none" stroke="currentColor" stroke-width="1.25"/>'
       + '<path d="M5.7 5.6c2.2 1.4 2.6 3 4.6 4.6" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  showroom: '<path d="M2.4 9.5c1.6-3.6 3.5-5.4 5.6-5.4s4 1.8 5.6 5.4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>'
          + '<ellipse cx="8" cy="12" rx="4.6" ry="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/>',
  mode: '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.25"/>'
      + '<path d="M8 2.4v11.2M2.4 8h11.2" stroke="currentColor" stroke-width="1"/>',
};

//! Which sheet is up, or none. The body carries it because the rules that lay
//! the sheets out are the ones that need to know, and they are stylesheet
//! rules: nothing here moves anything, it only says what is open.
function openSheet(name) {
  const was = document.body.dataset.sheet || "";
  const now = was === name ? "" : (name || "");
  document.body.dataset.sheet = now;
  for (const button of document.querySelectorAll("#dock button"))
    button.setAttribute("aria-pressed", button.dataset.sheet === now ? "true" : "false");
  if (now === "modes") buildModeSheet();
  if (now === "ai") openAI(true);
  if (now === "def") buildPanel();
  if (now === "tools") refreshToolbar();
  return now;
}

const sheetOpen = () => document.body.dataset.sheet || "";

function buildDock() {
  const dock = document.getElementById("dock");
  for (const button of dock.querySelectorAll("button")) {
    const key = button.dataset.sheet;
    button.querySelector(".dock-icon").innerHTML = svg(DOCK_ICONS[key] || ICONS.part);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => openSheet(key));
  }
  dock.hidden = !onPhone();
}

//! Every way of looking at this model, by name. The rows come from the same
//! list the desktop's buttons come from, so a package that adds a mode adds a
//! row here without knowing this exists.
function buildModeSheet() {
  const host = document.getElementById("sheet-modes");
  host.textContent = "";
  const head = text => {
    const h = document.createElement("h3");
    h.textContent = text;
    host.appendChild(h);
  };
  const row = (icon, name, note, on, run) => {
    const button = document.createElement("button");
    button.className = "mode-row";
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.innerHTML = '<span class="mode-icon">' + svg(icon) + "</span><span><b>"
      + escapeHtml(name) + "</b><span>" + escapeHtml(note) + "</span></span>";
    button.addEventListener("click", () => { openSheet(""); run(); });
    host.appendChild(button);
    return button;
  };

  head("Looking at it");
  const plain = !openMode && !staging && !graph.showing;
  row(MODE_ICONS.model, "Model", "the part, and the tools that build it", plain, () => {
    if (openMode) leaveMode();
    if (staging) leaveShowroom();
    if (graph.showing) graph.close();
  });
  row(MODE_ICONS.nodes, "Nodes", "the model as a graph you can wire", graph.showing,
      () => graph.toggle());
  row(MODE_ICONS.showroom, "Showroom", "see it as a product, lit and finished", staging,
      () => (staging ? leaveShowroom() : enterShowroom()));
  for (const mode of modes)
    row(MODE_ICONS.mode, mode.label, mode.title || "", openMode === mode,
        () => (openMode === mode ? leaveMode() : enterMode(mode)));

  head("Drawn as");
  const styles = document.createElement("div");
  styles.className = "mode-cams";
  for (const style of VIEW_STYLES) {
    const button = document.createElement("button");
    button.textContent = style.label.toUpperCase();
    button.dataset.style = style.key;
    button.setAttribute("aria-pressed", style.key === state.style ? "true" : "false");
    button.addEventListener("click", () => { setStyle(style.key); buildModeSheet(); });
    styles.appendChild(button);
  }
  host.appendChild(styles);

  head("Camera");
  const cams = document.createElement("div");
  cams.className = "mode-cams";
  for (const name of ["iso", "top", "front", "right", "fit"]) {
    const button = document.createElement("button");
    button.textContent = name.toUpperCase();
    button.addEventListener("click", () => {
      if (name === "fit") return fitView();
      Object.assign(view, STANDARD_VIEWS[name]);
      placeCamera(); draw();
    });
    cams.appendChild(button);
  }
  host.appendChild(cams);

  head("The document");
  row(ICONS.packages, "Packages", "what is on the shelf, and what is loaded", false,
      () => togglePackages(true));
  row(DOCK_ICONS.tree, "Samples", "a worked example to start from", false,
      () => document.getElementById("btn-sample").click());
}

//! A phone that has been turned, or a window someone dragged wider. The dock
//! appears and goes, and a sheet left open on a desktop would be a panel stuck
//! to the bottom of the screen - so it is put away on the way across.
function refreshLayout() {
  document.getElementById("dock").hidden = !onPhone();
  if (!onPhone() && sheetOpen()) openSheet("");
}
PHONE.addEventListener("change", refreshLayout);

function buildModes() {
  const host = document.getElementById("mode-buttons");
  const was = openMode ? openMode.key : null;
  modes = packages.views()
    .filter(entry => entry.live && entry.live.view)
    .map(entry => ({ key: entry.key, label: entry.label, title: entry.title,
                     view: entry.live.view }));
  if (openMode && !modes.some(m => m.key === was)) leaveMode();

  host.textContent = "";
  for (const mode of modes) {
    host.appendChild(document.createElement("div")).className = "sep";
    const button = document.createElement("button");
    button.id = "btn-mode-" + mode.key;
    button.textContent = mode.label;
    button.title = mode.title || mode.label;
    button.setAttribute("aria-pressed", openMode === mode ? "true" : "false");
    button.addEventListener("click", () => {
      if (openMode === mode) leaveMode(); else enterMode(mode);
    });
    host.appendChild(button);
    mode.button = button;
  }
  if (was) {
    const again = modes.find(m => m.key === was);
    if (again) { openMode = again; again.button.setAttribute("aria-pressed", "true"); }
  }
  if (sheetOpen() === "modes") buildModeSheet();
}

function enterMode(mode) {
  if (onPhone() && sheetOpen()) openSheet("");
  if (staging) leaveShowroom();
  if (sketching()) leaveSketch();
  if (openMode) leaveMode();
  openMode = mode;
  mode.button.setAttribute("aria-pressed", "true");
  mode.view.enter();
  // A mode brings its own panel and its own bar, and they are the two sides
  // the middle is measured against.
  layout();
}

function leaveMode() {
  if (!openMode) return;
  const mode = openMode;
  openMode = null;
  if (mode.button) mode.button.setAttribute("aria-pressed", "false");
  mode.view.leave();
  layout();
}

function buildPackages() {
  const host = document.getElementById("packages");
  const schema = packages.schema();
  const row = (entry, on) => {
    const adds = [];
    if (entry.nodes && entry.nodes.length) adds.push(entry.nodes.join(" · "));
    if (entry.view) adds.push(entry.view + " mode");
    const item = document.createElement("div");
    item.className = "pkg" + (on ? " on" : "");
    item.innerHTML = '<div class="pkg-text"><b>' + escapeHtml(entry.name) + "</b><span>"
      + escapeHtml(entry.summary) + "</span>"
      + (adds.length ? '<div class="pkg-adds">' + escapeHtml(adds.join("  ·  ")) + "</div>" : "")
      + "</div>";
    const button = document.createElement("button");
    button.textContent = on ? "Loaded" : "Load";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = on ? "putting away…" : "loading…";
      try { await packages.toggle(entry.id); }
      catch (err) {
        const note = document.createElement("div");
        note.className = "pkg-note";
        note.textContent = err.message;
        host.appendChild(note);
        buildPackagesSoon();
      } finally { button.disabled = false; }
    });
    item.appendChild(button);
    return item;
  };
  host.textContent = "";
  const title = document.createElement("h3");
  title.textContent = "Packages";
  host.appendChild(title);
  for (const entry of schema.loaded) host.appendChild(row(entry, true));
  for (const entry of schema.available) host.appendChild(row(entry, false));
  if (!schema.loaded.length && !schema.available.length) {
    const empty = document.createElement("div");
    empty.className = "pkg-note";
    empty.style.color = "var(--ink-3)";
    empty.textContent = "nothing on the shelf";
    host.appendChild(empty);
  }
}

//! A refusal is worth reading, so the list is not rebuilt out from under it.
let packagesPending = null;
function buildPackagesSoon() {
  clearTimeout(packagesPending);
  packagesPending = setTimeout(buildPackages, 4000);
}

//! The shelf, open or shut. Reached from its own button and from the document
//! menu, so it is one function rather than one handler.
function togglePackages(force) {
  const host = document.getElementById("packages");
  const opening = force === undefined ? host.hidden : force;
  if (opening) buildPackages();
  host.hidden = !opening;
  document.getElementById("btn-packages")
    .setAttribute("aria-pressed", opening ? "true" : "false");
  layout();
}
document.getElementById("btn-packages").addEventListener("click", () => togglePackages());

/* ======================================================= being shown round

   THE ONE THING A PROGRAM CANNOT ASK ITS USER TO DO IS EXPLAIN IT to the next
   person. So it explains itself: it points at its own parts, one at a time,
   and where a step teaches a GESTURE it stops and waits until you have made
   it. What the tour needs from the interface is small and is all here - a way
   to open a panel, a way to select something, a way to say "has anything
   happened since I asked".                                                  */

//! Two numbers that change when the thing the tour is waiting for happens. A
//! string rather than a flag, because "did the camera move" and "did the model
//! change" are both questions about a difference, not about an event - and a
//! difference cannot be missed the way an event can.
const viewKey = () => [view.yaw, view.pitch, view.distance, view.target.x,
                       view.target.y, view.target.z].map(n => Math.round(n * 100)).join(",");
const modelKey = () => !state.tree ? "" : state.tree.features.length + "/"
  + state.tree.features.slice(0, 300).map(f => f.revision).join(".");

let tourMark = { view: "", model: "" };

const tour = makeTour({
  //! Wrapped rather than passed: the two of them are declared further down
  //! this file, and a name read at the moment this object is built is a name
  //! that does not exist yet. Read when they are called, they do.
  remember: (key, value) => remember(key, value),
  recall: key => recall(key),
  run: command => mdl.run(command),
  mark: () => { tourMark = { view: viewKey(), model: modelKey() }; return tourMark; },
  turned: () => viewKey() !== tourMark.view,
  edited: () => modelKey() !== tourMark.model,
  has: type => !!state.tree && state.tree.features.some(f => f.type === type),
  //! The gestures as they really are on this machine, in this session.
  navigation: () => (altToOrbit
    ? "<b>Alt</b> and drag turns it. <b>Middle-drag</b> slides it about, "
      + "<b>right-drag</b> pushes it away, the <b>wheel</b> zooms. A plain drag "
      + "selects instead - the document menu has a setting that swaps those two "
      + "round if you would rather."
    : "<b>Drag</b> turns it. <b>Middle-drag</b> slides it about, "
      + "<b>right-drag</b> pushes it away, the <b>wheel</b> zooms.")
    + " <kbd>F</kbd> frames whatever is there.",
  //! Selects the newest feature of a kind, so the panel the next step points
  //! at has something in it. Answers true whether or not it found one: the
  //! step is worth showing either way, and a tour that stops because a cube
  //! was deleted is a tour that has misunderstood its job.
  pick: type => {
    const found = state.tree && [...state.tree.features].reverse().find(f => f.type === type);
    if (found) select(found.id, true);
    return true;
  },
  show: (what, on) => {
    if (what === "tree") toggleTree(on);
    else if (what === "rail") { if (on) stowRail(true); }
    else if (what === "panel" && on) stowPanel(true);
  },
});

document.getElementById("btn-help").addEventListener("click", () => {
  if (tour.running()) tour.stop(); else tour.resume();
});
document.getElementById("btn-menu").addEventListener("click", () => {
  if (document.getElementById("menu").hidden) openDocMenu(); else closeMenu();
});
addEventListener("pointerdown", event => {
  const host = document.getElementById("packages");
  if (host.hidden) return;
  if (host.contains(event.target) || event.target.closest("#btn-packages")) return;
  host.hidden = true;
  document.getElementById("btn-packages").setAttribute("aria-pressed", "false");
}, true);

document.getElementById("btn-stage").addEventListener("click", enterShowroom);
document.getElementById("btn-stage-exit").addEventListener("click", leaveShowroom);
document.getElementById("btn-stage-ground").addEventListener("click", event => {
  const on = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", on ? "true" : "false");
  showroom.setGroundVisible(on);
});
document.getElementById("btn-stage-reflect").addEventListener("click", event => {
  const on = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", on ? "true" : "false");
  showroom.setReflection(on ? 0.42 : 0);
});
document.getElementById("btn-stage-spin").addEventListener("click", event => {
  showroom.turntable = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", showroom.turntable ? "true" : "false");
});
document.getElementById("stage-exposure").addEventListener("input", event => {
  showroom.setExposure(Number(event.target.value));
});

let lastSpin = performance.now();
(function spinLoop(now) {
  const dt = Math.min(0.1, ((now || performance.now()) - lastSpin) / 1000);
  lastSpin = now || performance.now();
  if (staging && showroom.ready) showroom.spin(dt);
  // A mode that moves gets the clock. Only the open one - a paused simulation
  // in a mode nobody is looking at should cost nothing at all.
  if (openMode && openMode.view.tick) {
    openMode.view.tick(dt);
    draw();
  }
  requestAnimationFrame(spinLoop);
})();

/* ---------------------------------------------------------------- exporting */

//! The viewer's own save dialog, where the page is allowed to offer one. Served
//! by a local kernel, or opened as a file, there is no such surface at all.
let downloads;
const saveFile = async (filename, data) => {
  if (downloads === undefined) {
    const host = typeof claude !== "undefined" ? claude : null;
    downloads = host && typeof host.use === "function"
      ? await host.use("downloads").catch(() => null)
      : null;
  }
  if (!downloads) return { status: "unavailable" };
  return downloads.save({ filename, data });
};

const stepDialog = document.getElementById("modal-step");
document.getElementById("btn-step-close").addEventListener("click", () => stepDialog.close());
document.getElementById("btn-step-copy").addEventListener("click", async () => {
  const button = document.getElementById("btn-step-copy");
  const area = document.getElementById("step-text");
  try { await navigator.clipboard.writeText(area.value); button.textContent = "Copied"; }
  catch (e) { area.select(); button.textContent = "Press Ctrl+C"; }
  setTimeout(() => { button.textContent = "Copy"; }, 1600);
});

/* ==========================================================================
   Files.

   One file in, one file out, and one rule about which: a format that carries
   several parts may be broken into several features, and every other format
   comes in as one object. That is not a preference to be set - it is what the
   file itself does or does not say - so the question is only ever asked of a
   file that has an answer to it.

   Nothing here reads geometry. The kernel does that, through one call, and
   what comes back is a feature in the tree like any other.
   ========================================================================== */

const EXTENSION = { step: ".step", brep: ".brep", obj: ".obj", stl: ".stl", dxf: ".dxf",
                    model: ".model.json" };

//! The name to save under: the document's, made safe for a filesystem.
const stemOf = () => ((state.tree && state.tree.name) || "part").replace(/[^\w.-]+/g, "-");

//! One text file out, wherever this page is allowed to put one. The viewer's
//! save allowlist has no .step or .brep in it, so a refused extension is
//! retried under one it does accept and renamed on the way in; a page with no
//! save surface at all hands over the text instead.
async function offerFile(filename, text, title, note) {
  let saved = null;
  try {
    saved = await saveFile(filename, text);
  } catch (err) {
    if (err && err.code === "rejected_extension") {
      try { saved = await saveFile(filename + ".txt", text); }
      catch (retry) { saved = { status: retry && retry.code === "declined" ? "declined" : "failed" }; }
    } else saved = { status: err && err.code === "declined" ? "declined" : "failed" };
  }
  if (saved && saved.status === "saved") return "saved";
  if (saved && saved.status === "declined") return "declined";

  // No save surface here, so the text is handed over instead - and a text box
  // is no way to hand over a few megabytes. Say so rather than locking the
  // page up filling one.
  if (text.length > 2 * 1024 * 1024) {
    say(filename + " is " + readable(text.length) + ", and this view cannot save files - "
      + "it can only show text, which is no way to move a file that size. Connect a server, "
      + "or open the page where saving is allowed.");
    return "too big";
  }

  document.getElementById("step-title").textContent = title;
  document.getElementById("step-summary").textContent =
    filename + " · " + readable(text.length);
  document.getElementById("step-note").textContent = note;
  document.getElementById("step-text").value = text;
  stepDialog.showModal();
  return "shown";
}

async function exportAs(key) {
  const format = FORMATS.find(f => f.key === key);
  if (!format || !format.write) { say("nothing here writes " + key); return; }
  const filename = stemOf() + (EXTENSION[key] || "." + key);
  say("writing " + filename + "…");
  try {
    // The model file is the document itself and needs no kernel; the rest is
    // geometry, and only the kernel has that.
    const answer = key === "model"
      ? { text: await mdl.modelText(), note: "every feature, its arguments and its references" }
      : await kernel.exportShapes(key);
    const how = await offerFile(filename, answer.text, "Export " + format.name,
      format.summary + " This view cannot save files, so copy the text and keep it under "
      + "that name — or connect a server, which writes one straight to disk.");
    if (how === "saved") say(filename + " saved · " + answer.note);
    else if (how === "declined") say("not saved");
    else if (how === "shown") say(filename + " · " + answer.note);
  } catch (err) {
    say("could not write " + filename + " — " + err.message);
  }
}

/* ------------------------------------------------------------------ import */

//! Formats a package brought with it. Empty until one is loaded, and empty
//! again the moment it is put away - see addReader.
const readers = new Map();
const readerFor = name => {
  const dot = String(name || "").toLowerCase().lastIndexOf(".");
  const ext = dot < 0 ? "" : String(name).toLowerCase().slice(dot);
  for (const reader of readers.values())
    if (reader.extensions.includes(ext)) return reader;
  return null;
};

const fileInput = document.getElementById("file-input");
// Everything that can be read, and everything a CAD user will reasonably try:
// a file this build cannot read is better picked and explained than greyed out
// with no reason given.
function refreshAccept() {
  fileInput.accept = [...FORMATS.filter(f => f.read).flatMap(f => f.extensions),
                      ...[...readers.values()].flatMap(r => r.extensions),
                      ".iges", ".igs", ".3dm", ".ifc", ".dxf", ".sat"].join(",");
}
refreshAccept();
fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = "";                        // so the same file can be picked twice
  if (file) takeFile(file);
});

/* --------------------------------------------------- a file, a slice at a time

   THE PAGE NEVER HOLDS THE FILE. It reads a slice, hands the slice to the
   kernel, drops it and reads the next one - so a 184 MB import costs the page
   8 MB at a time and costs it nothing at all once the last slice has gone.
   The reader on the other side opens it off the kernel's own filesystem, and
   what lands in the document is the geometry, packed.

   This is what removes the size ceiling, and it is why there is no longer a
   number to refuse at. The two places that still need a whole file as one
   string are named where they happen: a package's own reader, and a model
   file - both are read IN THE PAGE by code that wants the text, and streaming
   into the kernel does nothing for either.                                   */

//! One path per file taken. Two files dropped together are two uploads, and
//! sharing a path would have the second one writing through the first.
let uploadsMade = 0;
const uploadPath = name =>
  "/upload-" + (++uploadsMade) + "-" + String(name).replace(/[^\w.-]+/g, "_").slice(-40);

//! The file into the kernel, one slice at a time, saying how far it has got -
//! because on a large file this is the part that takes a visible while, and a
//! page that says nothing for twenty seconds looks broken.
async function streamIntoKernel(file, path) {
  const started = performance.now();
  for (let at = 0; at < file.size; at += IMPORT_CHUNK) {
    const end = Math.min(at + IMPORT_CHUNK, file.size);
    const bytes = new Uint8Array(await file.slice(at, end).arrayBuffer());
    await kernel.takeUpload({ path, bytes, at });
    if (file.size > IMPORT_CHUNK)
      say("reading " + file.name + " · " + readable(end) + " of " + readable(file.size));
  }
  await kernel.finishUpload({ path });
  return performance.now() - started;
}

//! A file handed over whole, which is what a kernel that cannot take an upload
//! gets. THE NATIVE KERNEL OVER HTTP IS THAT KERNEL: its import is one POST of
//! one JSON body, and the page has no way to feed a file into a server it did
//! not write. So this road stays, honestly, for exactly that case - and it is
//! the road with a ceiling on it, because the whole file really is in the page
//! here, and base64 of a binary STL is a third bigger again.
async function handOverWhole(file, format) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const binary = format.key === "stl" && isBinaryStl(bytes);
  const data = binary ? toBase64(bytes) : new TextDecoder().decode(bytes);
  //! Surveyed through the same window the kernel would have used, over the
  //! string instead of over a file. The answers have to be the same ones or
  //! the dialog would say one thing on one kernel and another on the other.
  const read = (at, length) => data.slice(at, at + length);
  const survey = { size: file.size, parts: 1, assembly: false };
  if (!binary && format.key === "step") {
    const { products, assembly } = scanStep(read, data.length);
    survey.assembly = assembly;
    survey.parts = Math.max(products, assembly ? 2 : 1);
  } else if (!binary && format.key === "obj") {
    survey.parts = countObjParts(read, data.length);
  } else if (format.key === "dxf") {
    survey.survey = dxfSurvey(data);
  }
  return { request: { op: "import", format: format.key, name: file.name,
                      encoding: binary ? "base64" : "text", data,
                      size: file.size, assembly: survey.assembly }, survey };
}

//! One file, read and taken for whatever it is. Says back which of three
//! things happened, because a drop of several files has to know whether this
//! one has stopped to ask a question: "asked" means a dialog is up and the
//! rest must wait, "no" means nothing was taken.
async function takeFile(file) {
  //! A PACKAGE'S READER IS ASKED FIRST, and before the list of things this
  //! build cannot do - because the list is what it cannot do WITHOUT the
  //! package, and IFC is on it. With the IFC package loaded, an .ifc is a
  //! model file; with it off, it is still the sentence explaining why not.
  const brought = readerFor(file.name);
  const excuse = brought ? null : whyNot(file.name);
  if (excuse) { say(file.name + " is " + excuse.name + ", and " + excuse.reason); return "no"; }

  say("reading " + file.name + " · " + readable(file.size) + "…");

  //! ENOUGH OF THE FILE TO SAY WHAT IT IS, and not a byte more. The name is
  //! asked first and the contents only if the name said nothing - a file
  //! called .step is read as STEP whatever is inside it; a file dragged off a
  //! mail client as "attachment" has no name to go on, and every format here
  //! says what it is in its first few lines.
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());

  //! What the package hands back is a MODEL FILE, so it opens the way every
  //! model file opens: one edit, one undo step, one redraw. Nothing about a
  //! building being a building reaches this far.
  //! READ WHOLE, and honestly so: the reader is in the page and wants the text,
  //! so the text is what it gets. Streaming into the kernel would not help a
  //! reader that never asks the kernel anything.
  if (brought) {
    try {
      const got = brought.open(await file.text(), file.name);
      await mdl.run({ op: "model", model: got.model });
      fitView();
      for (const line of (got.say || [])) say(line);
      if (!got.say || !got.say.length) say(file.name + " opened");
    } catch (err) { say("could not read " + file.name + " — " + err.message); return "no"; }
    return "done";
  }

  let format = formatFor(file.name);
  if (!format || !format.read) {
    const sniffed = sniffFormat(head);
    format = sniffed ? FORMATS.find(f => f.key === sniffed) : null;
    if (!format) {
      say("nothing here reads " + file.name + " — try "
        + FORMATS.filter(f => f.read).map(f => f.name).join(", "));
      return "no";
    }
    say(file.name + " does not say what it is, and it reads as " + format.name);
  }

  // A model file is not an import: it IS the document, so it replaces it.
  //! The other whole-file read, and for the same reason - the JSON is parsed
  //! here, in the page, before anything of it reaches the kernel.
  if (format.key === "model") {
    try {
      await mdl.run({ op: "model", model: await file.text() });
      fitView();
      say(file.name + " opened");
    } catch (err) { say("could not open " + file.name + " — " + err.message); return "no"; }
    return "done";
  }

  //! EVERY OTHER FORMAT GOES THE SAME WAY, whatever it is and whatever size it
  //! is. STEP, BREP, OBJ, STL and DXF are all read by the kernel, so all five
  //! are streamed into it rather than handed over as a string - there is no
  //! format here with a limit and no format here with a fast path.
  const streams = typeof kernel.takeUpload === "function";
  const path = streams ? uploadPath(file.name) : "";
  let request, survey;
  try {
    if (streams) {
      const took = await streamIntoKernel(file, path);
      say(file.name + " · " + readable(file.size) + " read in " + Math.round(took) + " ms");
      survey = await kernel.surveyUpload({ path, format: format.key });
      request = { op: "import", format: format.key, name: file.name,
                  from: path, size: file.size, assembly: !!survey.assembly };
    } else {
      const handed = await handOverWhole(file, format);
      request = handed.request;
      survey = handed.survey;
    }
  } catch (err) {
    if (path) await kernel.dropUpload({ path }).catch(() => {});
    say("could not read " + file.name + " — " + err.message);
    return "no";
  }

  // A drawing is asked two things a solid never is: how big one unit in it is,
  // and which layers of it are wanted. Both have to be answered before it is
  // read, so the file is surveyed first and converted afterwards.
  if (format.key === "dxf") {
    if (!survey.survey) {
      if (path) await kernel.dropUpload({ path }).catch(() => {});
      say("could not read " + file.name + " — nothing in it reads as a drawing");
      return "no";
    }
    askDxf(request, format, survey.survey);
    return "asked";
  }

  if (survey.parts > 1) { askImport(request, format, survey.parts); return "asked"; }
  await runImport({ ...request, as: "single" });
  return "done";
}

/* --------------------------------------------------------- dropping a file

   The shortest way there is to open something: drag it onto the page and let
   go. Nothing new happens to the file afterwards - it goes through exactly the
   same takeFile as the picker, so a model file opens, a STEP imports, a DXF
   asks its two questions. The only thing here is catching the drop and saying
   where to let go.                                                          */

const dropVeil = document.getElementById("drop-veil");
const dropNote = document.getElementById("drop-note");

//! A drag is only ours if it is carrying files. Dragging selected text about,
//! or a handle inside the page, must go on working - so a drag whose types do
//! not include "Files" is left entirely alone.
const draggingFiles = event =>
  !!event.dataTransfer && [...(event.dataTransfer.types || [])].includes("Files");

// dragenter and dragleave fire for every element the cursor crosses, so the
// veil is counted in and out rather than switched: one leave inside the page
// is a child being left, not the page.
let overPage = 0;
const showDrop = on => {
  dropVeil.hidden = !on;
  if (on) dropNote.textContent = "a model file opens as the document · "
    + FORMATS.filter(f => f.read && f.key !== "model").map(f => f.name).join(", ")
    + " come in as features";
};

window.addEventListener("dragenter", event => {
  if (!draggingFiles(event)) return;
  event.preventDefault();
  if (++overPage === 1) showDrop(true);
});
window.addEventListener("dragover", event => {
  if (!draggingFiles(event)) return;
  // Without this the browser takes the drop itself and navigates to the file,
  // which loses the document.
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
// Counted down on any leave rather than only on a file's: the count only ever
// went up for a file, and a browser that declines to say what a leaving drag
// was carrying would otherwise leave the veil up for good.
window.addEventListener("dragleave", () => {
  if (overPage && --overPage <= 0) { overPage = 0; showDrop(false); }
});
// At the drop the files themselves are there to be counted, which is a surer
// answer than the types list - and getting this wrong means the browser takes
// the drop and navigates to the file, losing the document.
window.addEventListener("drop", event => {
  const files = event.dataTransfer && event.dataTransfer.files;
  if (!files || !files.length) return;
  event.preventDefault();
  overPage = 0;
  showDrop(false);
  takeFiles(files);
});
// A drag abandoned outside the window, or called off with Escape, never sends
// the leave that would put the veil down - so the end of the drag does it.
window.addEventListener("dragend", () => { overPage = 0; showDrop(false); });

//! Several files at once. A model file IS the document, so it goes first and
//! only one of them can go at all - opening a second would throw away the
//! first, along with whatever was imported into it.
async function takeFiles(list) {
  const files = [...(list || [])];
  if (!files.length) return;
  const isModel = file => {
    const format = formatFor(file.name);
    return !!format && format.key === "model";
  };
  const models = files.filter(isModel);
  const order = [...models.slice(0, 1), ...files.filter(file => !isModel(file))];
  if (models.length > 1)
    say(models.length + " model files at once — " + models[0].name + " is the document, "
      + "and a model file replaces it, so the rest are left");

  for (let i = 0; i < order.length; i++) {
    const how = await takeFile(order[i]);
    const left = order.length - i - 1;
    // A file that stopped to ask something holds up the queue, because the
    // question is answered by one dialog and there is one of it.
    if (how === "asked" && left) {
      say("answer that first — " + left + (left === 1 ? " more file is" : " more files are")
        + " still to come, drop them again after");
      return;
    }
  }
}

/* ============================================================ reuse a set

   A GEOMETRICAL SET IS ALREADY A USER-DEFINED FEATURE. What it needs from the
   rest of the document is whatever its contents read from outside it, which
   is what the definition panel now lists. What was missing was the ability to
   take one out of one file and put it in another - which is this.

   Copied, not referenced: a set instantiated here is a real set with real
   features in it, wired to each other exactly as they were and editable
   afterwards, because a feature you cannot open is a feature you cannot fix
   at four o'clock on a Friday. What is NOT copied is anything it read from
   outside itself. Those arrive unwired on purpose - the whole point of
   reusing a set somewhere else is that the somewhere else is different - and
   the panel then asks you for them by name.

   The reading and the planning are in reuse.js and know nothing about any of
   this; what is here is the file, the question and the edits.             */

const reuseDialog = document.getElementById("modal-reuse");
const reuseInput = document.getElementById("reuse-input");
let reusing = null;

reuseInput.addEventListener("change", async () => {
  const file = reuseInput.files && reuseInput.files[0];
  reuseInput.value = "";
  if (!file) return;
  let model;
  try { model = JSON.parse(await file.text()); }
  catch (error) { showError(file.name + " is not a model file this can read"); return; }
  if (!model || !Array.isArray(model.features)) {
    showError(file.name + " has no features in it");
    return;
  }
  const sets = setsIn(model, { isSet: one => {
    const spec = schemaType(one.type);
    return !!spec && spec.category === "container";
  } });
  if (!sets.length) {
    showError(file.name + " has no geometrical sets in it - a set is what gets "
      + "instantiated, so put what you want to reuse into one and save it again");
    return;
  }
  askReuse(file.name, model, sets);
});

function askReuse(fileName, model, sets) {
  reusing = { model, sets, at: 0, fileName };
  document.getElementById("reuse-title").textContent = "Instantiate from " + fileName;
  document.getElementById("reuse-note").textContent =
    sets.length + (sets.length === 1 ? " set" : " sets") + " in that file. What comes "
    + "across is the set and everything in it, wired to each other as they were; what "
    + "it read from outside arrives empty, and its panel asks you for those.";
  const host = document.getElementById("reuse-choice");
  host.textContent = "";
  sets.forEach((one, at) => {
    const button = document.createElement("button");
    button.className = "pick-opt";
    button.setAttribute("aria-pressed", String(at === 0));
    button.innerHTML = "<b>" + escapeHtml(one.name) + "</b><span>"
      + escapeHtml(saysReuse(one).replace(one.name + " · ", "")) + "</span>";
    button.addEventListener("click", () => {
      reusing.at = at;
      for (const other of host.children)
        other.setAttribute("aria-pressed", String(other === button));
    });
    host.appendChild(button);
  });
  reuseDialog.showModal();
}

document.getElementById("btn-reuse-cancel").addEventListener("click", () => {
  reuseDialog.close();
  reusing = null;
});
document.getElementById("btn-reuse-go").addEventListener("click", async () => {
  if (!reusing) { reuseDialog.close(); return; }
  const { model, sets, at } = reusing;
  reuseDialog.close();
  reusing = null;
  const chosen = sets[at];
  const here = state.tree.features;
  let plan;
  try {
    plan = instantiateEdits(model, chosen.id, {
      taken: new Set(here.map(f => f.id)),
      takenNames: new Set(here.map(f => f.name)),
      spec: schemaType,
    });
  } catch (error) { showError(error.message); return; }
  try {
    await mdl.runAll(plan.edits);
  } catch (error) { showError(error.message); return; }
  select(plan.id, true);
  // TWO KINDS OF LEFTOVER, and they are not the same thing to a person. A
  // wire that was dropped is an empty field waiting to be filled. A NUMBER
  // driven from outside cannot be left empty - a number is always some
  // number - so it arrives as the value it used to fall back on, and saying
  // which ones those are is the difference between a model that is waiting
  // for you and one quietly using the last file's dimensions.
  const wires = plan.inputs.filter(one => !one.drives);
  const numbers = plan.inputs.filter(one => one.drives);
  const named = list => list.map(one => one.holder + " · " + one.key).join(", ");
  say(plan.name + " is in"
    + (wires.length ? " · supply " + named(wires) : "")
    + (numbers.length ? " · " + named(numbers)
        + (numbers.length === 1 ? " followed a number in that file and now holds"
                                : " followed numbers in that file and now hold")
        + " the value it fell back on" : "")
    + (!plan.inputs.length ? " · it needs nothing from this document" : ""));
});

const importDialog = document.getElementById("modal-import");
let pending = null;

//! The one question a file cannot answer for itself. Asked only when the file
//! says it has more than one part in it, which is the whole of the rule.
function askImport(request, format, several) {
  pending = { ...request, as: "parts" };
  document.getElementById("import-title").textContent = "Import " + format.name;
  document.getElementById("import-note").textContent =
    request.name + " · " + readable(request.size) + " — this file describes "
    + several + (format.key === "step"
        ? (request.assembly ? " products in an assembly." : " separate products.")
        : " named groups.")
    + " It can come in either way.";

  const host = document.getElementById("import-choice");
  host.textContent = "";
  const options = [
    { as: "parts", title: "As sub-components",
      note: format.key === "step"
        ? "One feature per part, filed together in a Body — the assembly as the file "
          + "has it. Each part can then be moved, cut or measured on its own."
        : "One feature per named group, filed together in a set. Each mesh keeps the "
          + "faces it was authored with." },
    { as: "single", title: "As one single object",
      note: format.key === "step"
        ? "Every solid in one feature. Lighter in the tree, and the right answer when "
          + "what arrived is one thing that happens to be written as several."
        : "Every group merged into one mesh." },
  ];
  for (const option of options) {
    const button = document.createElement("button");
    button.className = "pick-opt";
    button.setAttribute("aria-pressed", String(option.as === pending.as));
    button.innerHTML = "<b>" + escapeHtml(option.title) + "</b><span>"
      + escapeHtml(option.note) + "</span>";
    button.addEventListener("click", () => {
      pending.as = option.as;
      for (const other of host.children)
        other.setAttribute("aria-pressed", String(other === button));
    });
    host.appendChild(button);
  }
  importDialog.showModal();
}

//! The two questions a DXF cannot answer for itself.
//!
//! How big it is, because $INSUNITS says "unitless" in most files ever
//! exported and 4200 then means four metres or four thousand millimetres
//! depending on who drew it. And which layers, because a floor plan is mostly
//! furniture, hatching and text, and a sketch of all of it is a sketch nobody
//! can work in.
function askDxf(request, format, survey) {
  const chosen = new Set(survey.layers.map(l => l.name));
  pending = { ...request, as: "single", units: survey.units.key === "none" ? "mm" : survey.units.key,
              layers: [...chosen] };

  document.getElementById("import-title").textContent = "Import " + format.name;
  document.getElementById("import-note").textContent =
    request.name + " · " + readable(request.size) + " — " + survey.entities
    + " entities on " + survey.layers.length + (survey.layers.length === 1 ? " layer" : " layers")
    + (survey.blocks ? ", " + survey.blocks
        + (survey.blocks === 1 ? " block" : " blocks") : "") + ". "
    + (survey.saidUnits && survey.units.key !== "none"
        ? "The file says it is drawn in " + survey.units.label.toLowerCase() + "."
        : "The file does not say what its units are, which is usual.")
    + " It comes in as a sketch.";

  const host = document.getElementById("import-choice");
  host.textContent = "";

  const head = text => {
    const line = document.createElement("div");
    line.className = "pick-head";
    line.textContent = text;
    host.appendChild(line);
  };

  head("One unit in the drawing is");
  const units = document.createElement("div");
  units.className = "pick-row";
  for (const unit of DXF_UNITS.filter(u => ["mm", "cm", "m", "in", "ft"].includes(u.key))) {
    const button = document.createElement("button");
    button.className = "pick-chip";
    button.textContent = unit.label;
    button.setAttribute("aria-pressed", String(unit.key === pending.units));
    button.addEventListener("click", () => {
      pending.units = unit.key;
      for (const other of units.children)
        other.setAttribute("aria-pressed", String(other === button));
    });
    units.appendChild(button);
  }
  host.appendChild(units);

  if (survey.layers.length > 1) {
    head("Layers");
    const list = document.createElement("div");
    list.className = "pick-layers";
    for (const layer of survey.layers) {
      const row = document.createElement("label");
      row.className = "pick-layer";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = true;
      box.addEventListener("change", () => {
        if (box.checked) chosen.add(layer.name); else chosen.delete(layer.name);
        pending.layers = [...chosen];
      });
      const name = document.createElement("span");
      name.textContent = layer.name;
      const count = document.createElement("b");
      count.textContent = layer.entities;
      row.append(box, name, count);
      list.appendChild(row);
    }
    host.appendChild(list);
  }

  // What is in the file that a sketch has no meaning for, said before it is
  // imported rather than after.
  const lost = survey.kinds.filter(k => DXF_IGNORED[k.type]);
  if (lost.length) {
    const note = document.createElement("div");
    note.className = "pick-note";
    note.textContent = "Not brought in: "
      + lost.map(k => ignoredName(k.type, k.entities)).join(", ")
      + ". A sketch holds geometry; the rest belongs to a drawing sheet.";
    host.appendChild(note);
  }

  importDialog.showModal();
}

//! NOTHING IMPORTED MEANS NOTHING LEFT BEHIND. The file is already on the
//! kernel's filesystem by the time the dialog is up - it had to be, to be
//! surveyed - and a cancelled import that leaves it there is two hundred
//! megabytes nobody can see and nobody can free.
document.getElementById("btn-import-cancel").addEventListener("click", () => {
  importDialog.close();
  const dropped = pending;
  pending = null;
  if (dropped && dropped.from) kernel.dropUpload({ path: dropped.from }).catch(() => {});
  say("nothing imported");
});
document.getElementById("btn-import-go").addEventListener("click", () => {
  importDialog.close();
  const request = pending;
  pending = null;
  if (request) runImport(request);
});

async function runImport(request) {
  const button = document.getElementById("btn-menu");
  button.disabled = true;
  say("building " + request.name + "…");
  try {
    const answer = await mdl.run(request);
    fitView();
    // Selected on arrival: a set if it made one, the feature itself if not, so
    // what came in is the thing in front of you.
    const landed = answer.set || (answer.created && answer.created[0]);
    if (landed) select(landed, false);
    say(request.name + " — " + answer.note);
  } catch (err) {
    say("could not import " + request.name + " — " + err.message);
  } finally {
    button.disabled = false;
    //! Said again on the way out whatever happened. The kernel frees the file
    //! as soon as the shapes are out of it, but a read that threw before that
    //! would leave it there, and it is the largest thing in the kernel's
    //! filesystem by a wide margin.
    if (request.from) kernel.dropUpload({ path: request.from }).catch(() => {});
  }
}

//! The document as text. Normally the whole of it - that is the point, the
//! JSON is the model - but a document carrying imported geometry is megabytes
//! of B-Rep that nobody reads and no text box enjoys, so those are shown as a
//! note of their size and the Rebuild button stands down. It is refused rather
//! than allowed to rebuild without them: a model that quietly lost its
//! geometry looks exactly like one that worked.
async function openModelDialog() {
  const heading = document.getElementById("model-note");
  const rebuild = document.getElementById("btn-load");
  let text = "", light = null;
  try {
    text = await mdl.modelText();
    if (text.length > 600000) light = lightenModel(await kernel.model());
  } catch (err) { text = "// " + err.message; }
  if (light) {
    document.getElementById("model-text").value = JSON.stringify(light, null, 2);
    heading.textContent = "The parametric model — every feature, its arguments and its "
      + "references. " + readable(light.elided) + " of imported geometry is shown as its "
      + "size rather than its contents, so this text cannot be rebuilt from. Export the "
      + "model file to keep it whole.";
    rebuild.disabled = true;
  } else {
    document.getElementById("model-text").value = text;
    heading.textContent = "The parametric model — every feature, its arguments and its "
      + "references. Paste one in and it is rebuilt.";
    rebuild.disabled = false;
  }
  modal.showModal();
}
document.getElementById("btn-model").addEventListener("click", openModelDialog);
document.getElementById("btn-close").addEventListener("click", () => modal.close());
document.getElementById("btn-copy").addEventListener("click", async () => {
  const button = document.getElementById("btn-copy");
  const area = document.getElementById("model-text");
  try { await navigator.clipboard.writeText(area.value); button.textContent = "Copied"; }
  catch (e) { area.select(); button.textContent = "Press Ctrl+C"; }
  setTimeout(() => { button.textContent = "Copy"; }, 1600);
});
document.getElementById("btn-load").addEventListener("click", async () => {
  const button = document.getElementById("btn-load");
  try {
    await mdl.run({ op: "model", model: document.getElementById("model-text").value });
    modal.close();
    fitView();
  } catch (err) {
    button.textContent = err.message.slice(0, 48);
    setTimeout(() => { button.textContent = "Rebuild"; }, 3200);
  }
});

for (const button of document.querySelectorAll("#view-tools button")) {
  button.addEventListener("click", () => {
    if (button.dataset.style) return setStyle(button.dataset.style);
    const name = button.dataset.view;
    if (name === "fit") return fitView();
    Object.assign(view, STANDARD_VIEWS[name]);
    placeCamera(); draw();
  });
}

// The style survives a reload, because it is how somebody prefers to work
// rather than something they are choosing again every morning.
applyStyle((() => {
  try { return localStorage.getItem("ocafcad/view-style") || "shaded"; }
  catch (e) { return "shaded"; }
})());

//! Materials carry theme colours, so a theme change rebuilds them from the
//! triangles the kernel already sent - no rebuild of the geometry.
function repaintTheme() {
  readTheme();
  buildGround();
  const ids = [...shapes.keys()];
  for (const { group } of shapes.values()) disposeGroup(group);
  shapes.clear();
  if (kernel && ids.length) {
    kernel.mesh(ids).then(payload => {
      for (const mesh of payload.features) setShape(mesh);
      rebuildPickList(); applyVisibility(); paintSelection(); draw();
    }).catch(() => {});
  }
  draw();
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", repaintTheme);
new MutationObserver(repaintTheme).observe(document.documentElement, { attributeFilter: ["data-theme"] });
addEventListener("resize", resize);
new ResizeObserver(resize).observe(viewportEl);

const treePanel = document.getElementById("tree-panel");
const logPop = document.getElementById("log-pop");
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* private */ } };
const recall = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };

function toggleTree(force) {
  treePanel.hidden = force === undefined ? !treePanel.hidden : !force;
  remember("ocafcad/tree", treePanel.hidden ? "off" : "on");
  layout();
}

/* ======================================================================
   THE LAYOUT.

   Everything here floats over the model, which is the point - but floating
   over the MODEL and floating over each other are different things, and only
   the first one is wanted. Nothing in CSS can decide this on its own: the tool
   rail's width depends on how many tools a package added, the definition panel
   is wider for a script than for a slider, a mode's bar is as wide as its own
   words, and a bar in the middle cannot say how wide it is until it knows both
   sides. So the page measures what is actually on screen and writes three
   numbers; every rule that needs to keep out of something else's way is
   written against those.

   Run it whenever anything opens, closes, stows or resizes. It is three
   getBoundingClientRects and a string; it can run as often as it likes.
   ====================================================================== */

const uiScale = () =>
  Number(getComputedStyle(document.documentElement).getPropertyValue("--ui")) || 1;

//! On screen, and taking up room - which is not the same as "not hidden": a
//! stowed panel is still in the document and still has a width.
const onScreen = el => {
  if (!el || el.hidden || !el.isConnected) return false;
  const seen = getComputedStyle(el);
  if (seen.display === "none" || seen.visibility === "hidden" || +seen.opacity < 0.05)
    return false;
  const box = el.getBoundingClientRect();
  return box.width > 1 && box.height > 1;
};

let layoutQueued = 0;
/* ==========================================================================
   PANELS YOU DRAG RATHER THAN PANELS WITH BARS DOWN THE SIDE.

   A scrollbar is a control whose whole job is to tell you the panel is too
   short, and it charges a permanent gutter for the news. These panels float
   over the model and are narrow - the rail is three buttons wide - so seven
   pixels is a real fraction of them, and on a trackpad or a touch screen
   nobody reaches for the bar anyway.

   So the bar goes and the panel becomes the thing you drag: press on any blank
   part of it and pull, the way a map moves. Three rules keep that from
   swallowing the interface it is drawn over:

     A DRAG IS NOT A CLICK, and four pixels is the line. Under four the press
     goes through to whatever was under it, so a button still presses; over
     four the click that would follow is swallowed, so letting go of a drag
     over a button does not fire it.

     THE MIDDLE BUTTON ALWAYS DRAGS, wherever it is pressed - over a button,
     over a field, anywhere. That is the one gesture that cannot mean anything
     else here, which is why it is the one that never has to ask.

     A PANEL THAT FITS IS NOT DRAGGABLE, and says so by not offering the
     cursor. `can-scroll` is re-measured on every layout, because a panel that
     fits until the tree grows is a panel whose answer changes.
   ========================================================================== */

const DRAG_SLOP = 4;

//! WHAT WAS COPIED: a list of ids, not a pile of geometry. See the Ctrl+C
//! handler for why that is the right shape here.
let clipboard = [];

function dragToScroll(el) {
  if (!el || el.dataset.dragScroll) return;
  el.dataset.dragScroll = "1";
  el.classList.add("scrollable");
  let from = null;
  const holdable = event => event.button === 1
    //! The left button drags only from the SPACE between things. Pressing a
    //! button and pulling is how a slider is used, and stealing that to scroll
    //! the panel would make every control in it unusable.
    || (event.button === 0 && !event.target.closest(
      "button, input, select, textarea, a, .node, .segmented, [contenteditable]"));
  el.addEventListener("pointerdown", event => {
    if (!holdable(event) || el.scrollHeight <= el.clientHeight + 1) return;
    from = { y: event.clientY, top: el.scrollTop, moved: 0, id: event.pointerId };
    //! Not captured yet: capturing on the press would take the pointer away
    //! from a button before we know whether this is a drag at all. It is
    //! captured at the moment it becomes one, below.
  });
  el.addEventListener("pointermove", event => {
    if (!from || event.pointerId !== from.id) return;
    const by = event.clientY - from.y;
    if (!from.moved && Math.abs(by) < DRAG_SLOP) return;
    if (!from.moved) {
      from.moved = 1;
      el.classList.add("dragging");
      try { el.setPointerCapture(event.pointerId); } catch (e) { /* already gone */ }
    }
    el.scrollTop = from.top - by;
    event.preventDefault();
  });
  const letGo = event => {
    if (!from || (event && event.pointerId !== undefined && event.pointerId !== from.id)) return;
    const dragged = !!from.moved;
    from = null;
    el.classList.remove("dragging");
    //! The click that follows a drag is swallowed, once. Letting go over a
    //! button after pulling the panel past it must not press it.
    if (dragged) el.addEventListener("click",
      swallow => { swallow.stopPropagation(); swallow.preventDefault(); },
      { capture: true, once: true });
  };
  el.addEventListener("pointerup", letGo);
  el.addEventListener("pointercancel", letGo);
  //! The middle button's own default is the browser's autoscroll, which draws
  //! its own compass over the page and fights this.
  el.addEventListener("auxclick", event => { if (event.button === 1) event.preventDefault(); });
  el.addEventListener("pointerdown", event => { if (event.button === 1) event.preventDefault(); });
}

//! Every panel that scrolls, told it does. Called once at boot; the
//! `can-scroll` class is refreshed by layout(), because whether a panel
//! overflows is a thing that changes as the document does.
function armScrolling() {
  for (const id of ["rail", "sketch-rail", "tree", "def", "graph-side"])
    dragToScroll(document.getElementById(id));
}

function markScrollable() {
  for (const id of ["rail", "sketch-rail", "tree", "def", "graph-side"]) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("can-scroll", el.scrollHeight > el.clientHeight + 1);
  }
}

function layout() {
  if (layoutQueued) return;
  layoutQueued = requestAnimationFrame(() => { layoutQueued = 0; measureLayout(); });
}

function measureLayout() {
  const root = document.documentElement;
  const ui = uiScale();
  // In the units a scaled panel thinks in, because that is what the rules are
  // written in. See --sky and --span.
  const wide = el => (onScreen(el) ? el.getBoundingClientRect().width / ui : 0);
  const edge = parseFloat(getComputedStyle(root).getPropertyValue("--edge")) || 12;

  const rail = document.getElementById("rail");
  const sketchRail = document.getElementById("sketch-rail");
  const railWide = Math.max(wide(rail), wide(sketchRail));
  const railDock = railWide ? railWide + edge : 0;

  const treeWide = wide(treePanel);
  const leftDock = railDock + (treeWide ? treeWide + edge : 0);

  // The right-hand column is whichever panel is in it: the definition panel in
  // the model, a mode's own panel while a mode is open. They share the slot and
  // only one of them is ever up.
  const right = [document.getElementById("def-panel"),
                 ...document.querySelectorAll(".fl-panel, .an-panel, .sp-panel")];
  // The lens sits in the right-hand column under whatever panel is there, so
  // it is measured with them rather than against them.
  const rightWide = Math.max(0, ...right.map(wide));
  const rightDock = rightWide ? rightWide + edge : 0;

  // The log popup stands on the bottom of the tree's column, so while it is
  // open it is the tree's floor. Measured rather than assumed: it is as tall as
  // it has to be to say what it has to say, up to its own ceiling.
  const logTall = onScreen(logPop) ? logPop.getBoundingClientRect().height / ui : 0;

  // AND WHAT THE BOTTOM ROW HAS TAKEN. A mode's bar sits along the bottom and
  // anything standing in a bottom corner has to stand on top of it. Measured
  // from the boxes rather than from a list of modes, so a package that puts a
  // bar of its own up is covered without this knowing about it.
  let barTall = 0;
  for (const bar of document.querySelectorAll("#sketch-bar, #mesh-bar, #pick-bar, "
      + "#gizmo-bar, #section-bar, #camera-bar, #story-bar, .fl-bar, .an-bar, .sp-bar")) {
    if (!onScreen(bar)) continue;
    barTall = Math.max(barTall, bar.getBoundingClientRect().height / ui);
  }
  root.style.setProperty("--bar-h", (barTall ? barTall + edge : 0) + "px");
  // What the bottom right corner has taken. The view controls grow a button
  // per mode a package adds, so the number cannot be written into a rule.
  const tools = document.getElementById("view-tools");
  root.style.setProperty("--corner-r", (wide(tools) || 0) + "px");
  root.style.setProperty("--log-dock", (logTall ? logTall + edge : 0) + "px");
  root.style.setProperty("--rail-dock", railDock + "px");
  root.style.setProperty("--left-dock", leftDock + "px");
  root.style.setProperty("--right-dock", rightDock + "px");

  // AND WHETHER A BAR HAS TAKEN THE BOTTOM ROW. On a window wide enough for
  // both, the status line sits in the corner beside the bar; on one that is
  // not, they are the same row and the status line stands down. Asked of the
  // boxes rather than of a list of modes, so a package that adds a bar of its
  // own is covered without this knowing about it.
  // Asked of the status line's BOX rather than of whether it can be seen: it
  // is hidden by the answer to this question, so using visibility here would
  // be asking the answer to decide the question. See body.barred.
  const status = document.getElementById("status");
  const laidOut = el => {
    if (!el || el.hidden || !el.isConnected) return false;
    if (getComputedStyle(el).display === "none") return false;
    const box = el.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  };
  let barred = false;
  if (laidOut(status)) {
    const mine = status.getBoundingClientRect();
    for (const bar of document.querySelectorAll("#sketch-bar, #mesh-bar, #pick-bar, "
        + "#gizmo-bar, #section-bar, #camera-bar, #story-bar, .fl-bar, .an-bar, .sp-bar, "
        + "#ai-bar, #log-pop, #packages")) {
      if (!onScreen(bar)) continue;
      const box = bar.getBoundingClientRect();
      if (Math.min(mine.right, box.right) - Math.max(mine.left, box.left) > 1
          && Math.min(mine.bottom, box.bottom) - Math.max(mine.top, box.top) > 1) {
        barred = true;
        break;
      }
    }
  }
  document.body.classList.toggle("barred", barred);
  //! WHETHER A PANEL IS DRAGGABLE IS A THING THAT CHANGES. A rail that fits
  //! until the window shortens, a tree that fits until the model grows - the
  //! answer is re-measured here because this is where every other measurement
  //! of the layout already happens.
  markScrollable();
}

addEventListener("resize", () => { layout(); if (lookingThrough()) { placeThrough(); refreshSafe(); } });
addEventListener("resize", layout);

//! The tool rail, stowed off the left edge and brought back. The chip says
//! which it is, because a switch that does not say what it did is a switch
//! people press twice.
function stowRail(force) {
  const off = force === undefined ? !document.body.classList.contains("no-rail") : !force;
  document.body.classList.toggle("no-rail", off);
  document.getElementById("btn-rail").setAttribute("aria-pressed", off ? "false" : "true");
  remember("ocafcad/rail", off ? "off" : "on");
  layout();
}

//! And the definition panel. Closing it is stowing it; bringing it back opens
//! it on whatever is selected, which is what you were looking at.
function stowPanel(force) {
  const on = force === undefined ? !state.edited : !!force;
  if (on) {
    const which = state.edited || state.selected
      || (state.picked.length ? state.picked[state.picked.length - 1] : null);
    if (!which) { say("nothing is selected, so there is nothing to show"); return; }
    state.edited = which;
  } else state.edited = null;
  buildPanel();
}
document.getElementById("btn-tree").addEventListener("click", () => {
  // On a phone the tree is a sheet and the dock owns it; the title is still the
  // way in, because that is where a hand goes.
  if (onPhone()) { openSheet("tree"); return; }
  toggleTree();
});
document.getElementById("btn-def-close").addEventListener("click", () => stowPanel(false));
document.getElementById("btn-rail").addEventListener("click", () => stowRail());
document.getElementById("btn-panel").addEventListener("click", () => stowPanel());
document.getElementById("btn-log").addEventListener("click", () => {
  logPop.hidden = !logPop.hidden; layout();
});
addEventListener("pointerdown", event => {
  if (!logPop.hidden && !logPop.contains(event.target) &&
      !document.getElementById("btn-log").contains(event.target)) {
    logPop.hidden = true; layout();
  }
}, true);

addEventListener("keydown", event => {
  // Undo works even from a field: it is the one shortcut people expect
  // everywhere, and the browser's own would only undo the typing.
  if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z")) {
    event.preventDefault();
    step(!event.shiftKey);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && (event.key === "y" || event.key === "Y")) {
    event.preventDefault();
    step(false);
    return;
  }
  if (event.target.matches("input, textarea, select")) return;

  //! Esc and Enter both leave the placing mode, because both mean "that is
  //! enough" and nobody should have to remember which.
  if (placingOn() && (event.key === "Escape" || event.key === "Enter")) {
    event.preventDefault();
    endPlacing();
    return;
  }

  //! COPY, PASTE AND DUPLICATE, on the keys everybody's hands already know.
  //!
  //! There is no clipboard of geometry here and there does not need to be: a
  //! copy is a LIST OF IDS, and what makes the copy is reading them out of the
  //! document when the paste happens. That means a paste always copies what
  //! those features are NOW rather than what they were when Ctrl+C was
  //! pressed, which is the behaviour you want in a parametric modeller and the
  //! one you would have had to go out of your way to break.
  //!
  //! Ctrl+D is the same thing in one keystroke, which is what it means
  //! everywhere else.
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey
      && "cvdCVD".includes(event.key) && !sketching() && !meshing()) {
    const chosen = state.picked.length ? state.picked.slice()
                 : state.selected ? [state.selected] : [];
    const key = event.key.toLowerCase();
    if (key === "c") {
      if (!chosen.length) return;
      event.preventDefault();
      clipboard = chosen;
      say(chosen.length === 1
        ? (feature(chosen[0]) || {}).name + " copied"
        : chosen.length + " features copied");
      return;
    }
    if (key === "v") {
      if (!clipboard.length) return;
      event.preventDefault();
      //! Whatever is still there. A paste after a delete copies what survives
      //! rather than refusing the lot.
      const alive = clipboard.filter(id => feature(id));
      if (!alive.length) { say("what was copied is not in the document any more"); return; }
      duplicate(alive);
      return;
    }
    if (key === "d") {
      if (!chosen.length) return;
      event.preventDefault();
      duplicate(chosen);
      return;
    }
  }

  // EDIT MODE OWNS THE KEYBOARD while it is open, because the keys everybody's
  // hands already know - 1, 2, 3 for the levels, E to extrude, I to inset -
  // are keys this program uses for other things everywhere else. One mode, one
  // meaning; nothing is half-shared.
  if (meshing() && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const level = meshEditor.hotkey(event.key);
    if (level) { meshEditor.setLevel(level); return; }
    if (event.key === "a" || event.key === "A") {
      meshEditor.select(meshEditor.tally().picked ? "none" : "all");
      return;
    }
    if (event.key === "l" || event.key === "L") { meshEditor.select("linked"); return; }
    if (event.key === "r" || event.key === "R") { meshEditor.select("ring"); return; }
    if (event.key === "+" || event.key === "=") { meshEditor.select("grow"); return; }
    if (event.key === "-" || event.key === "_") { meshEditor.select("shrink"); return; }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      meshEditor.begin(event.shiftKey ? "dissolve" : "remove");
      return;
    }
    const op = OP_KEYS[event.key.toLowerCase()];
    if (op && MESH_OPS[op] && MESH_OPS[op].levels.includes(meshEditor.level)) {
      event.preventDefault();
      meshEditor.begin(op);
      return;
    }
    if (event.key === "Escape") { leaveMeshEdit(); return; }
    if (event.key === "Enter") { leaveMeshEdit(); return; }
  }
  if (meshing() && (event.ctrlKey || event.metaKey)
      && (event.key === "r" || event.key === "R")) {
    event.preventDefault();
    meshEditor.begin("loopcut");
    return;
  }

  // THE FOUR KEYS EVERY MODELLER HAS. Not while a sketch or a cage is open:
  // those modes have their own hands and their own meanings for these letters,
  // and a key that means two things is a key nobody trusts.
  if (!sketching() && !meshing() && !headsOpen()
      && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    const armed = { w: "move", e: "rotate", r: "scale" }[event.key.toLowerCase()];
    if (armed) { event.preventDefault(); armGizmo(armed); return; }
    if (event.key === "q" || event.key === "Q") {
      event.preventDefault();
      if (gizmo.mode) armGizmo(gizmo.mode);
      return;
    }
    if (event.key === "p" || event.key === "P") { event.preventDefault(); toggleLens(); return; }
    if (event.key === "x" || event.key === "X") { event.preventDefault(); toggleSection(); return; }
    //! The key it is written on. A question mark is shift-slash on most
    //! layouts and its own key on some, so the character is what is asked
    //! about rather than the key under it.
    if (event.key === "?") {
      event.preventDefault();
      if (tour.running()) tour.stop(); else tour.resume();
      return;
    }
  }
  if (event.key === "Escape" && gizmo.mode) { armGizmo(gizmo.mode); return; }
  if (event.key === "Escape" && lensOpen()) { toggleLens(false); return; }
  if (event.key === "Escape" && cutter.on) { toggleSection(false); return; }
  if (storyOn()) {
    if (event.key === "Escape") {
      if (story.presenting) { presentStory(false); return; }
      closeStory(true);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault(); stepStory(1); return;
    }
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault(); stepStory(-1); return;
    }
  }
  if (event.key === "Escape" && lookingThrough()) { leaveThrough(true); return; }

  if (event.key === "f" || event.key === "F") { if (sketching()) lookAtSketch(); else fitView(); }
  if (event.key === "t" || event.key === "T") toggleTree();
  if (event.key === "g" || event.key === "G") graph.toggle();
  if (event.key === "a" || event.key === "A") openAI(aiBar.hidden);
  if (sketching() && (event.key === "Delete" || event.key === "Backspace")) {
    // A relation's mark is drawn over the drawing and picked ahead of it, so
    // Delete means the relation when one is picked and the segments otherwise.
    event.preventDefault();
    if (sketcher.relation >= 0) dropRelation(); else dropPicked();
    return;
  }
  if (event.key === "Enter" && sketching()) { endSketchRun(); return; }
  if (event.key === "Escape" && headsOpen()) { closeHeads(true); return; }
  // One key for "let me set this by hand", on whatever is selected. The panel
  // is the other way to the same number and neither is the proper one.
  if ((event.key === "d" || event.key === "D") && state.selected && !headsOpen()) {
    openHeads(state.selected, pointerAt.x, pointerAt.y);
    return;
  }
  if (event.key === "Escape" && waiting.on) { stopWaiting(); return; }
  if (event.key === "Escape" && pickingOn()) { leavePicking(false); return; }
  if (event.key === "Enter" && pickingOn()) { leavePicking(true); return; }
  if (event.key === "Escape") {
    sampleMenu.hidden = true;
    const shelf = document.getElementById("packages");
    if (!shelf.hidden) {
      shelf.hidden = true;
      document.getElementById("btn-packages").setAttribute("aria-pressed", "false");
      return;
    }
    if (!aiBar.hidden) { openAI(false); return; }
    if (staging) return leaveShowroom();
    if (openMode) return leaveMode();
    // Out of the sketcher a step at a time: the half-drawn element, then what
    // is picked, then the sketch itself.
    if (sketching()) {
      if (endSketchRun()) return;
      if (sketcher.relation >= 0) { sketcher.relation = -1; refreshSketch(); return; }
      if (sketcher.picked.length) { sketcher.picked = []; refreshSketch(); return; }
      if (sketcher.tool !== "select") { pickSketchTool("select"); return; }
      leaveSketch();
      return;
    }
    state.edited = null; buildPanel(); logPop.hidden = true; layout();
  }
});

/* ------------------------------------------- the parameter under the hand */

/*  A fillet has a radius, a pad has a distance, a point has somewhere to be.
 *  Making one and then going to look for that number in a panel is two actions
 *  where there is one thought, so the number comes up under the cursor the
 *  moment the feature exists - and the mouse drives it against the model,
 *  which is how every modeller worth the name has done it for thirty years.
 *
 *  The panel is not replaced and nothing is hidden from it. Both write the
 *  same `set` through the same channel, so a value dragged in the viewport
 *  moves the panel's slider as it goes and a value typed in the panel moves
 *  the model - they are two hands on one number rather than two numbers.
 *
 *  What the pointer MEANS is in handle.js, with the table of which argument
 *  each feature leads with. What is here is the pill, the ray, and the rule
 *  that a whole drag is one thing to undo.
 */

const headsBar = document.getElementById("heads");
const heads = {
  id: null,        // the feature being set
  lead: null,      // which argument, and how a hand drives it
  ruler: null,     // { at, dir } in the model's own space
  from: 0,         // where along the ruler the drag started
  was: null,       // what it said before, for Escape
  driving: false,  // is the pointer still setting it
  changed: false,
};

//! What a feature is drawn as, for the sums: the triangles and the lines the
//! viewport already has. Nothing is asked of the kernel - the ruler is read
//! off the thing you can see, which is the thing you are pointing at.
const drawnOf = id => (id ? streams.get(id) || null : null);

//! Where a feature IS: a point says so itself, and anything else is taken as
//! the middle of its extents.
function spotOf(id) {
  const entry = feature(id);
  if (entry && entry.data && entry.data.kind === "point" && entry.data.preview) {
    const said = entry.data.preview.replace(/[()]/g, "").split(",").map(Number);
    if (said.length >= 3 && said.every(Number.isFinite)) return said.slice(0, 3);
  }
  const drawn = drawnOf(id);
  if (!drawn) return null;
  return middleOf(drawn.positions) || middleOf(drawn.edges) || middleOf(drawn.points) || null;
}

//! Which way a feature points: along it if it is a line, out of it if it is a
//! face. A vector and a plane both answer this, which is what lets a pad know
//! which way it grows without being told.
function wayOf(id) {
  const drawn = drawnOf(id);
  if (!drawn) return null;
  return lineWay(drawn.edges) || faceWay(drawn.positions, drawn.index) || null;
}

//! The ruler for a feature: anchored on one of its inputs and running along
//! another, whichever of them it actually has. Falling back, in order, to the
//! feature's own geometry and then to the screen - because a ruler you cannot
//! work out is better as a ruler across the view than as no drag at all.
function rulerFor(entry) {
  const named = RULERS[entry.type] || {};
  const refs = entry.refs || {};
  let at = null, dir = null;
  for (const key of named.at || []) { at = at || spotOf(refs[key]); }
  for (const key of named.dir || []) { dir = dir || wayOf(refs[key]); }
  at = at || spotOf(entry.id);
  dir = dir || wayOf(entry.id);
  if (!at) return null;
  if (!dir) {
    // Across the view: the drag still measures millimetres in the model, they
    // are just millimetres towards the camera's right.
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    dir = [right.x, right.y, right.z];
  }
  return { at, dir: vUnit(dir) || [0, 0, 1] };
}

const rayOf = event => {
  const ray = rayFrom(event).ray;
  return { from: [ray.origin.x, ray.origin.y, ray.origin.z],
           way: [ray.direction.x, ray.direction.y, ray.direction.z] };
};

//! Where a pointer is, in the model, for a point being placed: on whatever is
//! under it, snapped to a curve if that is what is under it, and on the ground
//! otherwise. This is the "click a plane and the point goes there" rule, and
//! the reason it is one function is that "there" has three answers.
function placeAt(event) {
  const { from, way } = rayOf(event);
  const hits = rayFrom(event).intersectObjects(pickableNow(), false);
  // A curve first, wherever the ray passed near one: a point dropped on a
  // curve belongs ON it, not on whatever is behind it.
  let best = null;
  for (const entry of state.tree.features) {
    if (entry.produces !== "curve" || state.hidden.has(entry.id)) continue;
    const drawn = drawnOf(entry.id);
    const near = drawn && nearestOnEdges(drawn.edges, from, way);
    if (near && (!best || near.gap < best.gap)) best = { ...near, id: entry.id };
  }
  const reach = view.span * 0.02;
  if (best && best.gap < reach) return { at: best.at, on: best.id, what: "curve" };
  if (hits.length) {
    const p = hits[0].point;
    return { at: [p.x, p.y, p.z], on: hits[0].object.userData.id, what: "surface" };
  }
  // Nothing under it: the plane the view is looking at, through the middle of
  // what is being looked at, so a point always lands somewhere sensible.
  const facing = new THREE.Vector3();
  camera.getWorldDirection(facing);
  const at = onPlane(from, way, [view.target.x, view.target.y, view.target.z],
                     [facing.x, facing.y, facing.z]);
  return at ? { at, on: null, what: "view" } : null;
}

//! The number the pointer is asking for, given what kind of drag this is.
function headsValue(event) {
  const { from, way } = rayOf(event);
  const lead = heads.lead, ruler = heads.ruler;
  if (lead.drag === "place") {
    const found = placeAt(event);
    return found ? { keys: lead.keys, values: found.at, said: found.what } : null;
  }
  if (lead.drag === "curve") {
    const entry = feature(heads.id);
    const curve = entry && entry.refs ? entry.refs.curve : null;
    const drawn = drawnOf(curve);
    const near = drawn && nearestOnEdges(drawn.edges, from, way);
    return near ? { key: lead.key, value: Math.max(0, Math.min(1, near.t)) } : null;
  }
  if (lead.drag === "radius") {
    const facing = new THREE.Vector3();
    camera.getWorldDirection(facing);
    const hit = onPlane(from, way, ruler.at, [facing.x, facing.y, facing.z]);
    if (!hit) return null;
    const now = Math.hypot(hit[0] - ruler.at[0], hit[1] - ruler.at[1], hit[2] - ruler.at[2]);
    return { key: lead.key, value: heads.was + (now - heads.from) };
  }
  if (lead.drag === "axis") {
    const now = rulerAt(from, way, ruler.at, ruler.dir);
    return { key: lead.key, value: heads.was + (now - heads.from) };
  }
  return null;
}

//! Where the drag starts from, so the first pixel of movement is the first
//! millimetre of change rather than a jump.
function headsAnchor(event) {
  const { from, way } = rayOf(event);
  if (heads.lead.drag === "axis")
    return rulerAt(from, way, heads.ruler.at, heads.ruler.dir);
  if (heads.lead.drag === "radius") {
    const facing = new THREE.Vector3();
    camera.getWorldDirection(facing);
    const hit = onPlane(from, way, heads.ruler.at, [facing.x, facing.y, facing.z]);
    return hit ? Math.hypot(hit[0] - heads.ruler.at[0], hit[1] - heads.ruler.at[1],
                            hit[2] - heads.ruler.at[2]) : 0;
  }
  return 0;
}

//! Open it on a feature. \p x, \p y is where the cursor was, which is where the
//! pill goes; \p live says whether the pointer starts out driving it, which it
//! does when the feature has only just been made.
function openHeads(id, x, y, live = true) {
  const entry = feature(id);
  const spec = entry && schemaType(entry.type);
  const lead = entry && spec ? leadFor(entry, spec) : null;
  if (!lead) { closeHeads(); return false; }
  heads.id = id;
  heads.lead = lead;
  heads.ruler = lead.drag === "axis" || lead.drag === "radius" ? rulerFor(entry) : null;
  heads.was = lead.keys ? lead.values.slice() : lead.value;
  heads.from = 0;
  heads.changed = false;
  heads.driving = !!live && !!lead.drag && (lead.drag !== "axis" || !!heads.ruler);
  drawHeads(x, y);
  if (heads.driving) mdl.beginGesture();
  return true;
}

function drawHeads(x, y) {
  const lead = heads.lead;
  if (!lead) return;
  if (x !== undefined) {
    headsBar.style.left = Math.max(120, Math.min(innerWidth - 120, x)) + "px";
    headsBar.style.top = Math.max(60, Math.min(innerHeight - 24, y)) + "px";
  }
  headsBar.hidden = false;
  headsBar.classList.toggle("driving", heads.driving);
  const entry = feature(heads.id);
  if (lead.keys) {
    // Three numbers is not a slider. A point being placed says where it is and
    // what it landed on, and the click is the whole of the interaction.
    const at = lead.keys.map(key => round(entry.values[key]));
    headsBar.innerHTML = '<span class="hd-name"></span><span class="hd-said"></span>'
      + '<span class="hd-hint">click to drop · Esc to put it back</span>';
    headsBar.querySelector(".hd-name").textContent = lead.label;
    headsBar.querySelector(".hd-said").textContent = at.join(", ");
    return;
  }
  const value = entry.values[lead.key];
  const span = sliderSpan({ min: lead.min, max: lead.max, step: lead.step }, value);
  headsBar.innerHTML = '<span class="hd-name"></span>'
    + '<input type="range" min="' + span.min + '" max="' + span.max
    + '" step="' + lead.step + '" value="' + value + '">'
    //! The same box as the panel's, and the same rules: 10m, 2400/3, or the
    //! name of a parameter to follow. A heads-up number that could not take
    //! what the panel takes would be two rules for one thing.
    + '<span class="hd-box"><input type="text" inputmode="text" autocomplete="off"'
    + ' spellcheck="false" value="' + round(value) + '"><span class="hd-unit"></span></span>'
    //! A WAY OUT THAT IS NOT A GUESS. The bar appears the moment a feature is
    //! made, which is right - the number you are about to type is under the
    //! cursor - but it used to stay until something else took the viewport,
    //! so it sat over the model long after the number was set. Now it goes by
    //! itself a breath after the last thing you did to it, and there is a
    //! button for the hands that would rather say so.
    + '<button type="button" class="hd-done">Done</button>';
  headsBar.querySelector(".hd-name").textContent = lead.label;
  headsBar.querySelector(".hd-unit").textContent = lead.unit || "";
  const slider = headsBar.querySelector('input[type="range"]');
  const box = headsBar.querySelector('.hd-box input');
  const put = (raw, redraw, live) => {
    const asked = Number(raw);
    if (!Number.isFinite(asked)) return;
    heads.changed = true;
    heads.driving = false;
    headsBar.classList.remove("driving");
    pushParameter(heads.id, lead.key, asked, false, live);
    if (redraw) slider.value = String(asked); else box.value = String(round(asked));
  };
  headsBar.querySelector(".hd-done").addEventListener("click", () => closeHeads());
  slider.addEventListener("input", () => { nudgeHeads(); put(slider.value, false, true); });
  slider.addEventListener("change", () => restParameter());
  box.addEventListener("change", () => { nudgeHeads(); typeHeads(entry, lead, box, slider); });
  box.addEventListener("input", nudgeHeads);
  nudgeHeads();
  box.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Enter") { typeHeads(entry, lead, box, slider); closeHeads(); }
    if (event.key === "Escape") closeHeads(true);
  });
}

//! What was typed into the heads-up box, read the same way the panel reads
//! its own. A plain number is set; a name is wired; a formula becomes a node.
function typeHeads(entry, lead, box, slider) {
  const arg = { key: lead.key, label: lead.label, unit: lead.unit || "" };
  const got = readTyped(arg, box.value, entry.id);
  if (got.kind === "blank") return;
  if (got.kind === "error") { showError(got.message); return; }
  if (got.kind === "number") {
    heads.changed = true;
    heads.driving = false;
    headsBar.classList.remove("driving");
    slider.value = String(got.value);
    box.value = String(round(got.value));
    pushParameter(heads.id, lead.key, got.value);
    return;
  }
  // A wire or a formula ends the gesture: the number is not a number any
  // more, it is something the document works out, so there is nothing left
  // here to drag.
  const id = heads.id;
  closeHeads();
  typeValue(entry, arg, box, null);
  select(id, true);
}

//! Live, as the pointer moves. One edit a frame at most, and the model is
//! rebuilt under the cursor rather than after it - watching the pad grow is
//! the entire point.
function driveHeads(event) {
  if (!heads.driving || !heads.lead) return false;
  const asked = headsValue(event);
  if (!asked) return true;
  heads.changed = true;
  if (asked.keys) {
    // Three numbers, one edit each, and the panel is left alone between them.
    const edits = asked.keys.map((key, i) =>
      ({ op: "set", id: heads.id, key, value: Math.round(asked.values[i] * 1e3) / 1e3 }));
    if (!headsBusy) {
      headsBusy = true;
      mdl.runAll(edits, { keepPanel: true })
         .catch(err => showError(err.message))
         .finally(() => { headsBusy = false; drawHeads(); });
    }
  } else {
    pushParameter(heads.id, asked.key, Math.round(asked.value * 1e3) / 1e3);
    const slider = headsBar.querySelector('input[type="range"]');
    const box = headsBar.querySelector('.hd-box input');
    if (slider) slider.value = String(asked.value);
    if (box) box.value = String(round(asked.value));
  }
  return true;
}
let headsBusy = false;

//! The pointer lets go of it. The pill stays - the slider and the box are
//! still there to tune what the drag roughed out.
function dropHeads() {
  if (!heads.driving) return false;
  heads.driving = false;
  headsBar.classList.remove("driving");
  mdl.endGesture(heads.changed);
  drawHeads();
  return true;
}

//! And away. \p revert puts back what it said before, which is what Escape is
//! for: a drag you did not mean should leave nothing behind.
/* ------------------------------------------------- when it goes away again

   THE BAR THAT WOULD NOT LEAVE. It is offered the moment a feature is made,
   which is the right moment - the number you are about to type belongs under
   the cursor. What was wrong was that it then stayed, over the model, until
   something else happened to take the viewport.

   So it times itself out: a couple of seconds after the last thing you did to
   it, it goes. Every touch of it puts the clock back, and the clock is
   stopped altogether while the pointer is over it or the number box has the
   caret - a bar that vanished while you were reaching for it or typing into
   it would be worse than one that overstayed.                              */

const HEADS_LINGER = 2600;
let headsClock = 0;

function nudgeHeads() {
  clearTimeout(headsClock);
  if (headsBar.hidden || heads.driving) return;
  headsClock = setTimeout(() => {
    if (headsBar.hidden) return;
    if (headsBar.matches(":hover")) { nudgeHeads(); return; }
    if (headsBar.contains(document.activeElement)) { nudgeHeads(); return; }
    closeHeads();
  }, HEADS_LINGER);
}

headsBar.addEventListener("pointerenter", () => clearTimeout(headsClock));
headsBar.addEventListener("pointerleave", nudgeHeads);
headsBar.addEventListener("pointerdown", () => clearTimeout(headsClock));

function closeHeads(revert = false) {
  clearTimeout(headsClock);
  const lead = heads.lead, id = heads.id;
  const driving = heads.driving;
  headsBar.hidden = true;
  headsBar.innerHTML = "";
  heads.id = null; heads.lead = null; heads.driving = false;
  if (driving) mdl.endGesture(heads.changed && !revert);
  if (revert && lead && heads.changed) {
    const back = lead.keys
      ? lead.keys.map((key, i) => ({ op: "set", id, key, value: heads.was[i] }))
      : [{ op: "set", id, key: lead.key, value: heads.was }];
    mdl.runAll(back).catch(() => {});
  }
  heads.changed = false;
}

const headsOpen = () => !!heads.lead;

//! Offered the moment a feature is made, from the rail, the ring or a script -
//! one rule, so a pad made any of those ways comes up ready to be dragged out.
function offerHeads(id) {
  if (!id) return;
  openHeads(id, pointerAt.x, pointerAt.y);
}

/* ------------------------------------------------- full screen, and the pie */

/*  Two things, and they are one thing.
 *
 *  Full screen (Tab) takes every panel, rail, bar and readout off the screen
 *  and leaves the model. That is only worth having if nothing becomes
 *  unreachable while they are gone - so the marking menu (Space) is not a
 *  shortcut to some of the interface, it is the whole of it, and it works the
 *  same whether the panels are there or not.
 *
 *  What the menu offers is worked out in pie.js from a description of the
 *  document, not written out here by hand. Everything below is that
 *  description and the table of things to do: one place to read for "what can
 *  this program do", and one place for a new command to be added to.
 */

//! The ring covers the whole window while it is up, which is what keeps a
//! drag under it from orbiting the very model the menu is about.
const pie = makePie(document.getElementById("pie-host"));
let bare = false;

//! Full screen on or off. The panels are not removed, only faded out and made
//! deaf: a panel that is rebuilt while it is invisible is a panel that is
//! already right when it comes back, and every mode, sheet and dialog keeps
//! working exactly as it did.
function setBare(on) {
  bare = !!on;
  document.body.classList.toggle("bare", bare);
  const hint = document.getElementById("bare-hint");
  // A presentation is a thing you hand to a room, and a keyboard hint over the
  // narrative is a hint the room reads instead of the drawing.
  const quiet = !!(story && story.presenting);
  hint.hidden = quiet;
  if (!quiet) {
    hint.innerHTML = bare
      ? "<b>Space</b> for the menu · <b>Tab</b> for the panels"
      : "<b>Tab</b> for full screen";
    hint.classList.add("on");
    clearTimeout(setBare.fading);
    setBare.fading = setTimeout(() => hint.classList.remove("on"), 2600);
  }
  remember("ocafcad/bare", bare ? "on" : "off");
  layout();
}

//! What can be done to the drawing, in the order the rail draws it - so a flick
//! into the Draw ring lands on the tool the same button would.
const sketchToolList = () => ["select", ...SKETCH_TYPES].map(key => ({
  key,
  label: key === "select" ? "Select" : key === "line" ? "Polyline" : SKETCH_LABELS[key] || key,
  hint: key === "select" ? "drag an end, or pick things to relate"
      : SKETCH_CLICKS[key] ? SKETCH_CLICKS[key] + " clicks"
      : "click points, Enter to finish",
}));

//! The document as the menu needs to see it. Read once, when the menu opens:
//! it is a snapshot of a thing that is about to be acted on, and a menu built
//! from live getters would be a menu whose items change while it is up.
function pieWorld() {
  const selected = feature(state.selected);
  const drawing = sketching() ? sketchDrawing() : null;
  const picked = drawing ? pickedElements(drawing) : [];
  const spec = selected ? schemaType(selected.type) : null;
  const lead = selected && spec ? leadFor(selected, spec) : null;
  return {
    selected,
    // The one number this thing is about, so the ring can offer to set it.
    lead: lead ? lead.label : null,
    picked: state.picked.length,
    hidden: selected ? state.hidden.has(selected.id) : false,
    containers: (state.tree ? state.tree.features : []).filter(f =>
      f.category === "container" && (!selected
        || (f.id !== selected.id && !within(selected.id, f.id)))),
    types: (state.schema && state.schema.types) || [],
    categories: (state.schema && state.schema.categories) || [],
    accepts: acceptsFrom,
    formats: FORMATS,
    styles: VIEW_STYLES,
    style: state.style,
    modes: modes.map(m => ({ key: m.key, label: m.label, title: m.title })),
    mode: openMode ? { key: openMode.key, label: openMode.label } : null,
    packages: packages.schema(),
    staging,
    // Edit mode, and what it is looking at. The ring is built from the same
    // two tables the bar is - LEVEL_OPS and PICKS - so the menu and the bar
    // can never offer different things.
    // A mesh is the one thing with a mode of its own, so the ring offers the
    // way in - and says whether it is opening what is there or making it.
    meshEdit: selected && selected.produces === "mesh"
      ? { already: selected.type === "EditMesh" } : null,
    meshing: meshing(),
    meshLevel: meshEditor.level,
    meshPicked: meshEditor.on ? meshEditor.tally().picked : 0,
    meshSteps: meshEditor.on ? meshEditor.ops.length : 0,
    meshOps: meshEditor.on
      ? (LEVEL_OPS[meshEditor.level] || []).filter(op => MESH_OPS[op])
          .map(op => ({ key: op, label: MESH_OPS[op].label, note: MESH_OPS[op].note }))
      : [],
    meshPicks: meshEditor.on
      ? PICKS.filter(pick => pick.levels.includes(meshEditor.level))
      : [],
    sketching: sketching(),
    sketchTools: sketchToolList(),
    sketchTool: sketcher.tool,
    sketchPicked: picked.length,
    sketchRelation: sketcher.relation,
    construction: picked.length > 0 && picked.every(isConstruction),
    relations: SKETCH_RELATIONS,
    stage: {
      ground: pressed("btn-stage-ground"),
      reflect: pressed("btn-stage-reflect"),
      spin: !!showroom.turntable,
    },
    bare,
    tree: !treePanel.hidden,
    panel: !!state.edited,
    graph: graph.showing,
    ai: !aiBar.hidden,
    can: { undo: !!mdl.undoable, redo: !!mdl.redoable },
    act: PIE_ACTS,
  };
}

const pressed = id => document.getElementById(id).getAttribute("aria-pressed") === "true";
const clickOn = id => document.getElementById(id).click();

//! Every command the menu can run, and every one of them is the same call the
//! button that used to be the only way to it makes. Nothing here is a second
//! implementation of anything: a command with two bodies is a command that
//! behaves two ways.
const PIE_ACTS = {
  add: type => addFeature(type),
  meshEnter: () => { if (state.selected) enterMeshEdit(state.selected); },
  meshLevel: level => meshEditor.setLevel(level),
  meshSelect: what => meshEditor.select(what),
  meshOp: op => meshEditor.begin(op),
  meshUndo: () => meshEditor.undoStep(),
  meshDone: () => leaveMeshEdit(),
  //! The contextual half of the ring: make a node AND wire what is picked into
  //! the input the menu said it would go into. "Point on it" and "Spline
  //! through it" both feed a curve to a Point node - which input decides which
  //! of them you asked for, so the input is what the item carries.
  //!
  //! Everything else on the new node is wired the way the toolbar would wire
  //! it, so a plane made on a point still gets a normal and is built rather
  //! than born broken. The two edits are one undo: adding a node and putting
  //! it on the setting the label promised are not two things that happened.
  make: async (type, into, kind, many) => {
    const refs = await defaultRefs({ kernel, selected: () => state.selected,
                                     picked: () => state.picked }, type);
    // Several things shift-clicked are several sections of a loft, and the one
    // selected is only the last of them.
    if (many) {
      const all = state.picked.length > 1 ? state.picked.slice() : [state.selected];
      refs[into] = all.filter(Boolean);
    } else refs[into] = state.selected;
    const born = await edit({ op: "add", type, refs });
    if (!born) return;
    if (kind !== undefined)
      await mdl.runAll([{ op: "set", id: born.id, key: "kind", value: kind }])
               .catch(err => showError(err.message));
    select(born.id, true);
    if (schemaType(type) && schemaType(type).category !== "datum") fitView();
    offerHeads(born.id);
  },
  openDef: () => select(state.selected, true),
  del: () => deleteFeature(state.picked.length > 1 ? state.picked.slice() : state.selected),
  visible: was => showFeature(state.picked.length > 1 ? state.picked.slice()
                              : state.selected, was),
  moveInto: into => edit({ op: "group", id: state.selected, into }),
  takeOut: () => edit({ op: "group", id: state.selected }),

  fit: () => (sketching() ? lookAtSketch() : fitView()),
  look: name => { Object.assign(view, STANDARD_VIEWS[name]); placeCamera(); draw(); },
  lookAtSketch: () => lookAtSketch(),
  style: key => setStyle(key),

  showroom: () => enterShowroom(),
  leaveShowroom: () => leaveShowroom(),
  stageGround: () => clickOn("btn-stage-ground"),
  stageReflect: () => clickOn("btn-stage-reflect"),
  stageSpin: () => clickOn("btn-stage-spin"),

  nodes: () => graph.toggle(),
  ai: () => openAI(aiBar.hidden),
  shelf: () => togglePackages(true),
  loadPackage: id => packages.toggle(id).catch(err => showError(err.message)),
  mode: key => { const found = modes.find(m => m.key === key); if (found) enterMode(found); },
  leaveMode: () => leaveMode(),

  importFile: () => fileInput.click(),
  exportAs: key => exportAs(key),
  modelFile: () => openModelDialog(),
  samples: () => clickOn("btn-sample"),
  undo: () => step(true),
  redo: () => step(false),

  drag: () => openHeads(state.selected, pointerAt.x, pointerAt.y),

  bare: on => setBare(on),
  tree: () => toggleTree(),
  panel: () => { state.edited = state.edited ? null : state.selected; buildPanel(); },

  sketchTool: key => pickSketchTool(key),
  relation: key => putRelation(key),
  dropRelation: () => dropRelation(),
  construction: () => toggleConstruction(),
  sketchDelete: () => dropPicked(),
  sketchDone: () => leaveSketch(),
};

//! Where the ring opens: under the cursor, the way a marking menu always has -
//! so the flick starts from where the hand already is rather than from the
//! middle of the screen.
let pointerAt = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener("pointermove", event => {
  if (pie.isOpen()) return;
  pointerAt = { x: event.clientX, y: event.clientY };
}, true);

function openPie() {
  const items = pieMenu(pieWorld());
  pie.open(items, pointerAt.x, pointerAt.y);
}

addEventListener("keydown", event => {
  // A field being typed into owns its keys, and so does a dialog: Tab in a
  // form is Tab in a form, and taking it away would leave a modal nobody can
  // move around with a keyboard.
  if (event.target.matches("input, textarea, select")) return;
  if (event.target.closest("dialog") || document.querySelector("dialog[open]")) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key === "Tab") {
    event.preventDefault();
    setBare(!bare);
    return;
  }
  if (event.code === "Space" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    // Held down: the menu is already up and the hand is mid-flick.
    if (event.repeat) return;
    // WHILE A STORY IS OPEN the space bar is play and pause, which is what it
    // is in front of a room and what a hand reaches for without looking.
    if (storyOn()) { playStory(); return; }
    if (pie.isOpen()) pie.close(); else openPie();
    return;
  }
  if (!pie.isOpen()) return;
  // While it is up the menu owns the keyboard. A shortcut firing behind a ring
  // that is about to be chosen from would be two commands for one press.
  if (event.key === "Escape") pie.close();
  else if (event.key === "Backspace") pie.back();
  event.preventDefault();
  event.stopPropagation();
}, true);

addEventListener("keyup", event => {
  if (event.code === "Space" || event.key === " ") pie.release();
}, true);

//! A phone has no space bar and no keyboard at all. A long press on the model
//! is the same gesture - press, drag, let go - and it opens the same ring.
(function touchPie() {
  let timer = 0, from = null;
  const viewport = document.getElementById("viewport");
  viewport.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch" || pie.isOpen()) return;
    from = { x: event.clientX, y: event.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => { pointerAt = from; openPie(); }, 480);
  }, true);
  const drop = event => {
    if (from && event && Math.hypot(event.clientX - from.x, event.clientY - from.y) < 12) return;
    clearTimeout(timer);
  };
  viewport.addEventListener("pointermove", drop, true);
  viewport.addEventListener("pointerup", () => clearTimeout(timer), true);
  viewport.addEventListener("pointercancel", () => clearTimeout(timer), true);
})();

(async function start() {
  readTheme();
  buildGround();
  placeCamera();
  resize();

  // The preferences that are about how the hand works, read back now that the
  // store this file keeps them in exists.
  for (const one of String(recall("ocafcad/tree-shut") || "").split("\u0001"))
    if (one) shut.add(one);
  setTreeText(Number(recall("ocafcad/tree-text")) || 1);
  altToOrbit = recall("ocafcad/altnav") !== "off";
  lensKeepsFraming = recall("ocafcad/lens-frame") !== "off";
  if (recall("ocafcad/tree") === "off") treePanel.hidden = true;
  // A stowed rail survives a reload too: where somebody wants the room is a
  // preference, not a mood.
  if (recall("ocafcad/rail") === "off") stowRail(false);
  layout();
  // Full screen survives a reload, because it is how somebody prefers to work.
  // The hint that comes up with it is what stops that being a page with no
  // interface on it and no way of knowing why.
  if (recall("ocafcad/bare") === "on") setBare(true);
  //! The set being worked in is remembered across a reload, but not trusted:
  //! it is only applied once a document is open and only if the set is still
  //! in it. A remembered id pointing at nothing would file everything new
  //! into a folder that is not there.
  state.workingIn = recall("ocafcad/workingIn") || null;
  foldAI(recall("ocafcad/ai-fold") === "shut");

  const params = new URLSearchParams(location.search);
  let remembered = null;
  try { remembered = localStorage.getItem("ocafcad/base"); } catch (e) { /* private window */ }
  document.getElementById("link-url").value = remembered || "http://127.0.0.1:8787";

  // A native kernel serving this very page wins: it is already the document.
  const asked = params.get("api");
  const sameOrigin = location.protocol.startsWith("http") ? "" : null;
  for (const candidate of [asked, sameOrigin].filter(c => c !== null && c !== undefined)) {
    try {
      boot("connecting");
      await useNativeKernel(candidate);
      document.getElementById("boot").hidden = true;
      offerSpare();
      return;
    } catch (err) { /* fall through to the kernel in this page */ }
  }

  try {
    await usePageKernel();
  } catch (err) {
    boot("could not start the modeller: " + err.message);
    document.getElementById("boot").classList.add("failed");
    return;
  }
  document.getElementById("boot").hidden = true;
  offerSpare();
  //! ONCE, TO SOMEBODY WHO HAS NEVER BEEN HERE. This is the whole point of it:
  //! the person who opens this without anybody sitting beside them should not
  //! have to find the help button to be told there is one. Afterwards it never
  //! appears by itself again, and the ? button is where it lives.
  // inside Web BIM the building is already on screen: the tour waits to be asked for (the ? button)
  if (!tour.offered() && window.parent === window) setTimeout(() => tour.start(0), 900);
})();


/* ==========================================================================
   Web BIM.

   Inside Web BIM this page is a second interface onto the same building: the
   page that holds it writes the building in as nodes, hears about every edit,
   and writes back what the building made of it. Nothing here knows what a wall
   is - it is the ordinary edit channel, handed to whoever is outside.
   ========================================================================== */
const bimBridge = {
  onChange: null,
  get ready() { return ready; },
  load: model => mdl.run({ op: "model", model }),
  run: command => mdl.run(command),
  model: async () => JSON.parse(await mdl.modelText(0)),
  fit: () => fitView(),
  say: text => say(text),
};
globalThis.__webbimCad = bimBridge;
if (window.parent !== window) {
  //! The way back: the same building, drawn the way a BIM tool draws it.
  const back = document.createElement("button");
  back.id = "btn-revit-style";
  back.type = "button";
  back.title = "Back to the Revit-style interface - the same model";
  back.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 5.5h13M5 5.5V14" stroke="currentColor" stroke-width="1.3"/></svg><span>Revit style</span>';
  back.addEventListener("click", () => window.parent.postMessage({ webbim: "revit" }, "*"));
  const css = document.createElement("style");
  css.textContent = "#btn-revit-style{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;display:flex;gap:7px;align-items:center;"
    + "padding:8px 16px;border-radius:999px;border:1px solid rgba(15,108,189,.5);background:#0f6cbd;color:#fff;font:600 13px/1 system-ui,sans-serif;"
    + "box-shadow:0 4px 18px rgba(15,108,189,.35);cursor:pointer}#btn-revit-style:hover{background:#0b5aa0}";
  document.head.append(css);
  document.body.append(back);
}
