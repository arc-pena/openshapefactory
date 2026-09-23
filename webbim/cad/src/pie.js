//! A marking menu, and everything the modeller can do arranged in one.
//!
//! Maya's idea, and the reason it is worth copying: a menu whose items are
//! places rather than rows. North is always North, so the way to a command is
//! a DIRECTION you learn with your hand instead of a name you read every time.
//! Flick up-then-right for a pad and after a week you stop seeing the menu at
//! all - which is the whole point of it, and something a list of words down
//! the side of the screen can never do however well it is written.
//!
//! Three rules follow from that and they are the whole design.
//!
//! An item's place never moves. The ring for a context is built the same way
//! every time, in a fixed order, and an item that does not apply is not
//! silently squeezed out of the middle of it - it leaves a gap in the list it
//! was in, or the list it was in is not there at all. A menu that reshuffles
//! is a menu nobody can learn.
//!
//! It is CONTEXTUAL. What can be done to nothing is not what can be done to a
//! selected solid, and neither is what can be done inside a sketch. So the
//! root ring is asked for fresh every time the menu opens, from the state of
//! the document rather than from a table written out by hand - a package that
//! adds a node type adds a wedge here for the same reason it adds a button to
//! the rail.
//!
//! And it is the WHOLE interface, not a shortcut to some of it. Full screen
//! means the panels are gone, and a command that lives only on a panel would
//! be a command you cannot reach - so everything the chip, the rails, the
//! tree's context menu and the view tools can do is in here.
//!
//! Nothing in this file knows what a solid is. It is handed a description of
//! the world and a table of things to do, and it gives back a tree of items:
//! that way the menu can be checked, item by item, without a browser - and
//! what it offers is decided in one readable place rather than in a listener
//! attached to a button.

//! How many wedges one ring will hold before it spills onto another. Twelve is
//! thirty degrees each, which is still a flick you can aim; past that the
//! directions stop being distinct and the menu stops being a marking menu.
export const PIE_MAX = 12;

//! The dead zone in the middle, in pixels. Inside it no wedge is chosen, so
//! opening the menu and letting go without moving does nothing - which is what
//! makes "press space to look at it" safe.
export const PIE_DEAD = 26;

//! Where each wedge of a ring of \p count sits, as the angle of its middle
//! measured CLOCKWISE FROM NORTH in radians. North first, because up is where
//! a hand goes and the first item is the one most often wanted.
export function ringLayout(count) {
  const out = [];
  const step = (Math.PI * 2) / Math.max(1, count);
  for (let i = 0; i < count; i++) out.push({ mid: i * step, from: (i - 0.5) * step,
                                             to: (i + 0.5) * step, step });
  return out;
}

//! The angle of a pointer offset from the middle, clockwise from North, in
//! [0, 2π). Screen coordinates, so y grows downwards and North is -y.
export function pieAngle(dx, dy) {
  const a = Math.atan2(dx, -dy);
  return a < 0 ? a + Math.PI * 2 : a;
}

//! Which wedge of a ring of \p count the pointer is in, or -1 for none: inside
//! the dead zone, or an empty ring.
export function wedgeAt(count, dx, dy, dead = PIE_DEAD) {
  if (!count) return -1;
  if (Math.hypot(dx, dy) < dead) return -1;
  const step = (Math.PI * 2) / count;
  return Math.round(pieAngle(dx, dy) / step) % count;
}

//! Where to draw the chip for a wedge. An ellipse rather than a circle because
//! screens are wide and so are words: the items to the left and right are the
//! ones that need room for their text, and they are the ones pushed furthest
//! out.
export function chipAt(mid, rx = 214, ry = 134) {
  const sin = Math.sin(mid), cos = Math.cos(mid);
  const r = Math.hypot(rx * sin, ry * cos);
  return { x: r * sin, y: -r * cos, r };
}

//! A list too long for one ring, cut into rings. The last wedge of a full one
//! opens the rest, so the places of the first eleven never move as the list
//! grows - which is the rule this whole menu is built on.
export function paged(items, max = PIE_MAX) {
  if (items.length <= max) return items;
  const head = items.slice(0, max - 1);
  const rest = items.slice(max - 1);
  head.push({ label: "More…", note: rest.length + " more", items: paged(rest, max) });
  return head;
}

/* ------------------------------------------------------------- the items */

const leaf = (label, note, run, extra = {}) => ({ label, note, run, ...extra });
const branch = (label, note, items) => ({ label, note, items });
//! An item that is not there rather than an item that is dead. A greyed row is
//! a promise that something can be done; a gap is the truth.
const only = (when, item) => (when ? [item] : []);

//! WHAT YOU DO TO A THING OF THIS KIND, in the order you most often do it.
//!
//! This is the table the whole contextual ring turns on, and it is a table on
//! purpose. "Every node whose input happens to accept a solid" is a list of
//! twenty and it is not an answer: pick a solid in any modeller and the four
//! things you want are a fillet, a boolean, a measurement and a move, and they
//! want to be under your hand rather than two flicks inside an alphabet. The
//! long list is still there, one wedge along, and nothing is hidden - but the
//! first four places belong to the four things.
//!
//! Each row says which node to make and WHICH INPUT OF IT the selected thing
//! goes into, because that is what makes "point on a curve" different from
//! "curve through points" when both of them wire a curve to a Point. `kind`,
//! where there is one, is the setting that node has to be on for the input to
//! mean what the label says.
//!
//! A row is offered only when the schema really has that node and that node's
//! input really does accept what is selected, so a row that stops being true -
//! a package taken off the shelf, an argument renamed - stops being offered
//! rather than becoming a wedge that fails.
export const COMMON = {
  point: [
    { type: "Plane", into: "origin", kind: 0, label: "Plane here",
      note: "a plane standing on this point" },
    { type: "Line", into: "origin", kind: 0, label: "Line from here",
      note: "along a direction" },
    { type: "Cube", into: "origin", label: "Cube here", note: "a box with a corner on it" },
    { type: "Sphere", into: "center", label: "Sphere here", note: "centred on it" },
    { type: "Measure", into: "shape", label: "Measure", note: "where it is" },
    { type: "Polyline", into: "points", label: "Polyline", note: "through this point and more" },
    { type: "Interpolate", into: "points", label: "Spline", note: "a smooth curve through points" },
  ],
  curve: [
    { type: "Extrude", into: "profile", label: "Extrude", note: "a pad out of this profile" },
    { type: "Point", into: "curve", kind: 1, label: "Point on it",
      note: "a point along the curve" },
    { type: "Plane", into: "curve", kind: 1, label: "Plane across it",
      note: "square across the curve" },
    { type: "Loft", into: "sections", label: "Loft", note: "through this and the next section" },
    { type: "Sweep", into: "spine", label: "Sweep along it", note: "run a profile down it" },
    { type: "ParallelCurve", into: "curve", label: "Offset", note: "a curve parallel to it" },
    { type: "DivideCurve", into: "curve", label: "Divide", note: "points evenly along it" },
    { type: "Project", into: "curve", label: "Project", note: "onto a plane or a solid" },
    { type: "Measure", into: "shape", label: "Measure", note: "how long it is" },
  ],
  plane: [
    { type: "Sketch", into: "plane", label: "Sketch on it", note: "draw a profile" },
    { type: "Cube", into: "plane", label: "Cube on it", note: "standing on this plane" },
    { type: "Extrude", into: "profile", label: "Extrude", note: "a pad off this face" },
    { type: "Plane", into: "from", kind: 2, label: "Offset plane",
      note: "parallel, a distance away" },
    { type: "Circle", into: "plane", label: "Circle on it", note: "" },
    { type: "MeshTemplate", into: "plane", label: "Starting mesh",
      note: "a slab, a block, an L, a hexagon" },
    { type: "MeshGrid", into: "plane", label: "Mesh grid", note: "a grid to push about" },
    { type: "Measure", into: "shape", label: "Measure", note: "" },
  ],
  solid: [
    { type: "Fillet", into: "body", label: "Fillet", note: "round its edges" },
    { type: "Boolean", into: "a", label: "Boolean", note: "cut, fuse, or what is common" },
    { type: "Measure", into: "shape", label: "Measure", note: "volume, area, extents" },
    { type: "Move", into: "shape", label: "Move", note: "along a direction, or point to point" },
    { type: "Mirror", into: "shape", label: "Mirror", note: "about a plane" },
    { type: "Array", into: "source", label: "Array", note: "a row or a ring of it" },
    { type: "ThickSurface", into: "surface", label: "Shell", note: "give it a wall thickness" },
    { type: "Draft", into: "body", label: "Draft", note: "taper its walls" },
    { type: "MeshFromShape", into: "shape", label: "To mesh", note: "tessellate it" },
    { type: "Rotate", into: "shape", label: "Rotate", note: "about an axis" },
    { type: "Scale", into: "shape", label: "Scale", note: "" },
  ],
  mesh: [
    { type: "EditMesh", into: "mesh", label: "Edit mesh",
      note: "its cage: vertices, edges, faces" },
    { type: "MeshToShape", into: "mesh", label: "To solid",
      note: "sew the cage into a B-Rep" },
    { type: "Subdivide", into: "mesh", label: "Subdivide", note: "smooth it, Catmull-Clark" },
    { type: "Weld", into: "mesh", label: "Weld", note: "join vertices that sit together" },
    { type: "FillHoles", into: "mesh", label: "Fill holes", note: "close what is open" },
    { type: "MeshDisplace", into: "mesh", label: "Displace", note: "along the normals" },
    { type: "MeshTransform", into: "mesh", label: "Transform", note: "move, turn, scale" },
    { type: "MeshMerge", into: "a", label: "Merge", note: "with another mesh" },
    { type: "Measure", into: "shape", label: "Measure", note: "" },
  ],
  vector: [
    { type: "Line", into: "direction", kind: 0, label: "Line along it", note: "from a point" },
    { type: "Plane", into: "normal", kind: 0, label: "Plane square to it", note: "on a point" },
    { type: "Extrude", into: "direction", label: "Extrude along it", note: "" },
    { type: "AxisSystem", into: "xdir", kind: 0, label: "Axis system", note: "X along it" },
  ],
  axis: [
    { type: "AxisToAxis", into: "from", label: "Axis to axis", note: "place a part by it" },
    { type: "Rotate", into: "axis", label: "Rotate about it", note: "" },
  ],
  number: [
    { type: "Panel", into: "input", label: "Panel", note: "print what it computes" },
  ],
};

//! The rows of \ref COMMON that really apply, in their table order. The arg has
//! to exist, it has to accept what is selected, and a body something has
//! already eaten cannot be fed to anything else.
export function commonFor(world) {
  const { selected, types = [], accepts } = world;
  if (!selected) return [];
  const out = [];
  for (const row of COMMON[selected.produces] || []) {
    const spec = types.find(t => t.type === row.type);
    if (!spec || spec.hidden) continue;
    const arg = (spec.args || []).find(a => a.key === row.into
      && (a.kind === "ref" || a.kind === "refs"));
    if (!arg || !accepts(arg.accepts, selected)) continue;
    if (arg.consumes && selected.consumedBy) continue;
    out.push({ ...row, many: arg.kind === "refs", summary: spec.summary });
  }
  return out;
}

//! And EVERYTHING else the selected thing can be wired into: every node with an
//! input that accepts it, at the first input that does. This is the long
//! honest list - the one that cannot go stale, because it is read off the
//! schema - and it lives one wedge along from the four that matter.
export function derivationsFor(world) {
  const { selected, types = [], accepts } = world;
  if (!selected) return [];
  const already = new Set(commonFor(world).map(row => row.type));
  const out = [];
  for (const spec of types) {
    if (spec.hidden || already.has(spec.type) || spec.type === selected.type
        && spec.category === "container") continue;
    const arg = (spec.args || []).find(a => (a.kind === "ref" || a.kind === "refs")
      && accepts(a.accepts, selected));
    if (!arg) continue;
    if (arg.consumes && selected.consumedBy) continue;
    out.push({ type: spec.type, into: arg.key, many: arg.kind === "refs",
               label: spec.type, note: spec.summary || "" });
  }
  return out;
}

//! Which operations would take what is selected. The same test the rail makes
//! to un-grey its buttons, asked of the same schema - so what the menu offers
//! and what the rail offers can never drift apart.
export function operationsFor(world) {
  const { selected, types = [], accepts } = world;
  if (!selected || selected.consumedBy) return [];
  return types.filter(spec => {
    if (spec.hidden || spec.category !== "operation") return false;
    const arg = (spec.args || []).find(a => (a.kind === "ref" || a.kind === "refs") && a.consumes);
    return !!arg && accepts(arg.accepts, selected);
  });
}

//! Every node type there is, by the category it is filed under - the rail's
//! groups, in the rail's order, because they are the same groups.
function addBranch(world) {
  const { types = [], categories = [], act } = world;
  const groups = categories.length ? categories
    : [...new Set(types.map(t => t.category))].map(key => ({ key }));
  const rings = [];
  for (const group of groups) {
    const mine = types.filter(t => !t.hidden && t.category === group.key);
    if (!mine.length) continue;
    rings.push(branch(title(group.label || group.key), mine.length + " nodes",
      paged(mine.map(spec => leaf(spec.type, spec.summary ? short(spec.summary) : "",
                                  () => act.add(spec.type))))));
  }
  return branch("Add", "a new node", paged(rings));
}

//! Load a package, put one away, and step into the modes a loaded one brings -
//! the shelf and the mode buttons, which are two halves of one question.
function packagesBranch(world) {
  const { packages = { loaded: [], available: [] }, modes = [], mode, act } = world;
  const items = [];
  for (const entry of modes)
    items.push(leaf(entry.label, mode && mode.key === entry.key ? "leave it" : entry.title || "",
      () => (mode && mode.key === entry.key ? act.leaveMode() : act.mode(entry.key)),
      { on: !!mode && mode.key === entry.key }));
  for (const entry of packages.loaded || [])
    items.push(leaf(entry.name, "loaded — put it away", () => act.loadPackage(entry.id),
                    { on: true }));
  for (const entry of packages.available || [])
    items.push(leaf(entry.name, short(entry.summary || ""), () => act.loadPackage(entry.id)));
  items.push(leaf("The shelf…", "everything there is", () => act.shelf()));
  return branch("Packages", (modes.length ? modes.length + " modes · " : "")
    + ((packages.loaded || []).length + " loaded"), paged(items));
}

function viewBranch(world) {
  const { act, sketching } = world;
  return branch("View", "where it is looked at from", [
    leaf("Fit", "the whole model", () => act.fit()),
    leaf("Iso", "", () => act.look("iso")),
    leaf("Top", "", () => act.look("top")),
    leaf("Front", "", () => act.look("front")),
    leaf("Right", "", () => act.look("right")),
    ...only(!!sketching, leaf("Square on", "look at the sketch", () => act.lookAtSketch())),
  ]);
}

function styleBranch(world) {
  const { styles = [], style, act } = world;
  return branch("Style", "how it is drawn",
    styles.map(s => leaf(s.label, short(s.summary || ""), () => act.style(s.key),
                         { on: s.key === style })));
}

function documentBranch(world) {
  const { formats = [], can = {}, act } = world;
  return branch("Document", "what comes in and goes out", [
    leaf("Open a file…", formats.filter(f => f.read).map(f => f.name).join(", "),
         () => act.importFile()),
    branch("Export", formats.filter(f => f.write).length + " formats",
      paged(formats.filter(f => f.write)
        .map(f => leaf(f.name, f.short || "", () => act.exportAs(f.key))))),
    leaf("Model file…", "read it, or paste one in", () => act.modelFile()),
    leaf("Samples…", "a worked example to start from", () => act.samples()),
    ...only(!!can.undo, leaf("Undo", "", () => act.undo())),
    ...only(!!can.redo, leaf("Redo", "", () => act.redo())),
  ]);
}

//! The panels, from the one place that can still reach them once they are all
//! hidden. Full screen is first because it is the way back.
function interfaceBranch(world) {
  const { bare, tree, panel, act } = world;
  return branch("Interface", bare ? "full screen" : "panels", [
    leaf(bare ? "Show the panels" : "Full screen", "Tab", () => act.bare(!bare), { on: bare }),
    leaf("Specification tree", tree ? "hide it" : "show it", () => act.tree(), { on: !!tree }),
    leaf("Definition", panel ? "close it" : "nothing is being edited",
         () => act.panel(), { on: !!panel }),
  ]);
}

//! What can be done TO the thing that is selected. Everything the tree's own
//! context menu offers, which is where these used to live and the reason a
//! full screen with no tree in it would otherwise lose them.
function editBranch(world) {
  const { selected, containers = [], hidden, act, picked = 1 } = world;
  const home = selected.parent ? containers.find(c => c.id === selected.parent) : null;
  const many = picked > 1;
  return branch("Edit", many ? picked + " selected" : selected.name, [
    leaf("Definition", "open its arguments", () => act.openDef()),
    ...only(!!world.lead, leaf("Set " + (world.lead || "").toLowerCase(),
      "by hand, against the model", () => act.drag())),
    leaf(hidden ? "Show" : "Hide", "in the 3D view", () => act.visible(!!hidden), { on: !!hidden }),
    ...only(!!home, leaf("Take out of " + (home ? home.name : ""), "to the top level",
                         () => act.takeOut())),
    ...only(containers.filter(c => c.id !== selected.parent).length > 0,
      branch("Move into", "a set", paged(containers.filter(c => c.id !== selected.parent)
        .map(set => leaf(set.name, set.type === "Body" ? "solids" : "wireframe",
                         () => act.moveInto(set.id)))))),
  ]);
}

/* -------------------------------------------------------------- the rings */

//! What the sketcher can do. A sketch is its own interface - the modelling
//! tools have nothing to add while one is open - so its ring is its own too.
function sketchRing(world) {
  const { act, sketchTools = [], relations = [], sketchTool, sketchPicked = 0,
          sketchRelation = -1, construction } = world;
  return [
    branch("Draw", sketchTool ? "now: " + sketchTool : "",
      paged(sketchTools.map(t => leaf(t.label, t.hint || "", () => act.sketchTool(t.key),
                                      { on: t.key === sketchTool })))),
    branch("Relate", sketchPicked ? sketchPicked + " picked" : "pick two things first",
      paged([...relations.map(r => leaf(r.label, r.hint || "", () => act.relation(r.key))),
             ...only(sketchRelation >= 0,
                     leaf("Delete relation", "the one picked", () => act.dropRelation()))])),
    leaf("Construction", "dashed, drives the drawing, never built",
         () => act.construction(), { on: !!construction }),
    leaf("Delete", sketchPicked ? sketchPicked + " picked" : "nothing picked",
         () => act.sketchDelete()),
    leaf("Square on", "look at the sketch", () => act.lookAtSketch()),
    viewBranch(world),
    interfaceBranch(world),
    leaf("Done", "leave the sketch", () => act.sketchDone()),
  ];
}

//! The showroom is a different renderer with a different set of questions, and
//! almost nothing the modeller does applies while it is up.
function showroomRing(world) {
  const { act, stage = {} } = world;
  return [
    leaf("Ground", "the floor under it", () => act.stageGround(), { on: !!stage.ground }),
    leaf("Reflection", "in the floor", () => act.stageReflect(), { on: !!stage.reflect }),
    leaf("Turntable", "let it spin", () => act.stageSpin(), { on: !!stage.spin }),
    interfaceBranch(world),
    leaf("Leave", "back to the model", () => act.leaveShowroom()),
  ];
}

//! A package mode owns the viewport while it is open. What still makes sense
//! is looking at the thing, and leaving.
function modeRing(world) {
  const { mode, act } = world;
  return [
    viewBranch(world),
    styleBranch(world),
    packagesBranch(world),
    interfaceBranch(world),
    leaf("Leave " + mode.label, "back to the model", () => act.leaveMode()),
  ];
}

//! How many of a kind's commonest operations go on the root ring. Four, which
//! is what is left of twelve places once Add, the long list, the housekeeping
//! and the five rings that are always there have theirs.
export const COMMON_ON_RING = 4;

//! The modelling ring with nothing selected: the program itself, in one fixed
//! order that never changes while nothing is picked.
function idleRing(world) {
  const { act } = world;
  return [
    addBranch(world),
    viewBranch(world),
    styleBranch(world),
    packagesBranch(world),
    leaf("Showroom", "see it as a product", () => act.showroom()),
    leaf("Nodes", "edit it as a graph", () => act.nodes(), { on: !!world.graph }),
    leaf("AI", "ask Claude to build it", () => act.ai(), { on: !!world.ai }),
    documentBranch(world),
    interfaceBranch(world),
  ];
}

//! And with something selected, which is the ring this is all for.
//!
//! Pick a solid and Fillet, Boolean, Measure and Move are under your hand.
//! Pick a sketch and the first of them is Extrude. Pick a point and it is a
//! plane on the point; a mesh and it is Edit mesh and Subdivide. That is what
//! contextual has to mean - not "a branch called Apply that lists whatever
//! happens to typecheck", which is a list you read rather than a place you
//! flick to.
//!
//! Twelve places, and the four at the front are the only ones that change with
//! what is picked. What is always there keeps its order behind them, and the
//! long list of everything else is one wedge rather than gone.
function pickedRing(world) {
  const { selected, act, picked = 1, meshEdit } = world;
  // A MESH HAS A MODE, so the first flick on one is the way into it rather
  // than a node that would put another Edit Mesh on top of the one already
  // there. Adding a node and entering the editor are not the same gesture and
  // should not be the same word.
  const already = meshEdit && meshEdit.already;
  const common = commonFor(world)
    .filter(row => !(already && row.type === "EditMesh"));
  const first = common.slice(0, COMMON_ON_RING - (meshEdit ? 1 : 0));
  const rest = [...common.slice(first.length), ...derivationsFor(world)];
  return [
    addBranch(world),
    ...only(!!meshEdit, leaf("Edit mode",
      already ? "its cage: vertices, edges, faces"
              : "put an Edit Mesh on it and open its cage",
      () => act.meshEnter())),
    ...first.map(row => leaf(row.label, row.note || short(row.summary || ""),
                             () => act.make(row.type, row.into, row.kind, row.many))),
    ...only(rest.length > 0, branch("Build", "everything else it feeds",
      paged(rest.map(row => leaf(row.label, row.note ? short(row.note) : "",
                                 () => act.make(row.type, row.into, row.kind, row.many)))))),
    editBranch(world),
    // Delete has a place of its own. It is the commonest thing anybody does to
    // a thing they have selected, and a command that common does not belong
    // behind another flick - the ring exists so that what you do most is one
    // gesture rather than two.
    leaf(picked > 1 ? "Delete " + picked : "Delete",
         picked > 1 ? "all of them" : selected.name, () => act.del()),
    viewBranch(world),
    styleBranch(world),
    // The rest of the program, one flick down, because with something selected
    // you are modelling rather than switching to the showroom - and because
    // the eleven places above are worth more than a flat list of twenty.
    branch("Workspace", "the rest of the program", [
      leaf("Showroom", "see it as a product", () => act.showroom()),
      leaf("Nodes", "edit it as a graph", () => act.nodes(), { on: !!world.graph }),
      leaf("AI", "ask Claude to build it", () => act.ai(), { on: !!world.ai }),
      packagesBranch(world),
      documentBranch(world),
      interfaceBranch(world),
    ]),
  ];
}

function modelRing(world) {
  return world.selected ? pickedRing(world) : idleRing(world);
}

//! The root ring for the world as it stands. One question, asked fresh every
//! time the menu opens.
export function pieMenu(world) {
  if (world.staging) return showroomRing(world);
  if (world.meshing) return paged(meshRing(world));
  if (world.sketching) return sketchRing(world);
  if (world.mode) return modeRing(world);
  return paged(modelRing(world));
}

//! THE RING IN EDIT MODE, and it is contextual twice over: once on what LEVEL
//! you are at - vertex, edge, face, border, element - and once on whether
//! anything is picked at all.
//!
//! With a face picked the first flick is Extrude, because that is what anybody
//! does to a face. With an edge it is Loop cut, because that is what anybody
//! does to an edge. With nothing picked there is nothing to do TO anything, so
//! the ring is about picking instead. That is what contextual has to mean at
//! this level as much as at the level above: not a menu of everything that
//! typechecks, but the four things your hand was already going for.
function meshRing(world) {
  const { act, meshLevel = "face", meshPicked = 0, meshOps = [], meshPicks = [],
          meshSteps = 0 } = world;
  const first = meshOps.slice(0, 4);
  const rest = meshOps.slice(4);
  return [
    branch("Select", meshPicked ? meshPicked + " picked" : "nothing picked",
      paged(meshPicks.map(pick => leaf(pick.label, pick.note || "",
                                       () => act.meshSelect(pick.key))))),
    ...(meshPicked
      ? first.map(op => leaf(op.label, op.note || "", () => act.meshOp(op.key)))
      : [leaf("All", "everything at this level", () => act.meshSelect("all"))]),
    ...only(rest.length > 0, branch("More", "everything else at this level",
      paged(rest.map(op => leaf(op.label, op.note || "", () => act.meshOp(op.key)))))),
    branch("Level", "what a click picks · now " + meshLevel,
      MESH_PIE_LEVELS.map(one => leaf(one.label, one.hint,
        () => act.meshLevel(one.key), { on: one.key === meshLevel }))),
    ...only(meshSteps > 0,
      leaf("Step back", meshSteps + (meshSteps === 1 ? " step" : " steps") + " so far",
           () => act.meshUndo())),
    viewBranch(world),
    styleBranch(world),
    interfaceBranch(world),
    leaf("Done", "back to the model", () => act.meshDone()),
  ];
}

//! The five levels, for the ring. Spelled out here rather than imported so the
//! menu keeps working when the editor is not loaded - a pie menu that throws
//! is a pie menu that takes the page with it.
const MESH_PIE_LEVELS = [
  { key: "vertex", label: "Vertex", hint: "the points · 1" },
  { key: "edge", label: "Edge", hint: "the lines · 2" },
  { key: "face", label: "Face", hint: "the polygons · 3" },
  { key: "border", label: "Border", hint: "a whole open loop · 4" },
  { key: "element", label: "Element", hint: "a connected lump · 5" },
];

//! A summary cut to something that fits under a word. The first clause, which
//! in this catalogue is always the sentence that says what the thing is.
function short(text) {
  const said = String(text || "").split(/[.·]/)[0].trim();
  return said.length > 54 ? said.slice(0, 52).trimEnd() + "…" : said;
}

const title = key => String(key || "").replace(/^./, c => c.toUpperCase());

/* ------------------------------------------------------------ the widget */

//! The menu on screen. It knows about angles and chips and nothing else: what
//! the items mean is decided above, and what they do is a function each of
//! them is carrying.
//!
//! Two ways of working it, and they are the same two Maya has. Tap space, let
//! go, and the menu stays up to be read and clicked - which is what it is for
//! the first hundred times. Hold space, flick, and let go, and the thing under
//! the flick runs without the menu ever being read - which is what it is for
//! ever after. The second is the first done quickly; there is no mode.
//!
//! The middle never moves as you go deeper. A sub-menu that re-centres itself
//! where the last one was released walks across the screen and eventually off
//! it, and the gesture for a command stops being one shape.
export function makePie(host, { onOpen, onClose } = {}) {
  const veil = document.createElement("div");
  veil.className = "pie-veil";
  veil.hidden = true;
  const ring = document.createElement("div");
  ring.className = "pie-ring";
  ring.setAttribute("role", "menu");
  veil.appendChild(ring);
  host.appendChild(veil);

  let stack = [];              // the rings walked into, innermost last
  let at = { x: 0, y: 0 };     // the middle, in page pixels
  let live = -1;               // the wedge under the pointer
  let moved = false;           // has the pointer left the dead zone at all
  let scale = 1;               // how big the ring is drawn, against the screen
  const items = () => (stack.length ? stack[stack.length - 1].items : []);

  //! How big to draw it. The interface has one scale for the screen it is on,
  //! and the ring takes it - a little smaller where there is no room across.
  //!
  //! Worked out HERE and applied as a transform, not as CSS `zoom`. Zoom
  //! multiplies an element's own `left` and `top`, so a ring told to open at
  //! the cursor on a screen scaled to 1.3 was drawn a third of the way further
  //! down and across than the middle the wedges were being measured from: the
  //! highlight lagged the pointer by a hundred pixels and got worse the
  //! further from the top left corner you were. A scale about the ring's own
  //! origin moves nothing and, being uniform, leaves every angle exactly as it
  //! was - which is the whole of what the hit test reads.
  const sized = () => {
    const ui = Number(getComputedStyle(document.documentElement)
      .getPropertyValue("--ui")) || 1;
    return ui * (innerWidth <= 900 ? 0.86 : 1);
  };

  const draw = () => {
    ring.textContent = "";
    ring.style.left = at.x + "px";
    ring.style.top = at.y + "px";
    const list = items();
    const places = ringLayout(list.length);

    const heart = document.createElement("div");
    heart.className = "pie-heart";
    heart.textContent = stack.length > 1 ? stack[stack.length - 1].label : "";
    ring.appendChild(heart);

    // A word each, and nothing else. The note is what an item is FOR, and
    // reading eleven of those is reading a menu - which is the thing a marking
    // menu exists not to be. So it is said once, under the middle, about
    // whichever one the hand is pointing at.
    list.forEach((item, i) => {
      const spot = chipAt(places[i].mid);
      const spoke = document.createElement("div");
      spoke.className = "pie-spoke";
      spoke.dataset.wedge = String(i);
      spoke.style.width = spot.r + "px";
      spoke.style.transform = "rotate(" + (places[i].mid - Math.PI / 2) + "rad)";
      ring.appendChild(spoke);

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "pie-item"
        + (item.items ? " branch" : "") + (item.on ? " on" : "")
        + (i === live ? " live" : "");
      chip.dataset.wedge = String(i);
      chip.style.left = spot.x + "px";
      chip.style.top = spot.y + "px";
      // Away from the middle: a chip to the RIGHT of it grows rightwards and
      // one to the left grows leftwards, so no label ever crosses the centre
      // and two neighbours cannot land on each other.
      chip.style.transform = "translate(" + (-50 + 50 * Math.sin(places[i].mid)) + "%, -50%)";
      chip.innerHTML = '<span class="pie-label"></span>'
        + (item.items ? '<span class="pie-more">▸</span>' : "");
      chip.querySelector(".pie-label").textContent = item.label;
      chip.title = item.note || item.label;
      chip.addEventListener("click", event => { event.stopPropagation(); choose(i); });
      ring.appendChild(chip);
    });

    const said = document.createElement("div");
    said.className = "pie-say";
    ring.appendChild(said);

    const foot = document.createElement("div");
    foot.className = "pie-foot";
    foot.textContent = stack.length > 1
      ? "flick and let go, or click · Backspace goes back · Esc closes"
      : "flick and let go, or click · Esc closes";
    ring.appendChild(foot);
    paint();
  };

  const paint = () => {
    for (const chip of ring.querySelectorAll(".pie-item, .pie-spoke"))
      chip.classList.toggle("live", Number(chip.dataset.wedge) === live);
    const said = ring.querySelector(".pie-say");
    const item = items()[live];
    if (said) said.textContent = item ? (item.note || item.label) : "";
  };

  const choose = i => {
    const item = items()[i];
    if (!item) return;
    if (item.items) {
      stack.push({ items: item.items, label: item.label });
      live = -1; moved = false;
      draw();
      return;
    }
    close();
    // After the menu is down, so a command that opens a panel is not opening
    // it underneath something that is about to be removed.
    try { item.run(); } catch (err) { console.error(err); }
  };

  const back = () => {
    if (stack.length <= 1) { close(); return; }
    stack.pop();
    live = -1; moved = false;
    draw();
  };

  //! What the pointer is on. The word under it wins, and the angle decides
  //! everywhere else.
  //!
  //! Both, because neither alone is right. A chip is nudged off its own ray so
  //! that it cannot land on its neighbour, so the angle to the middle of a
  //! word is not always the angle of the wedge it belongs to - and lighting up
  //! the item next to the one being pointed at is exactly as wrong as lagging
  //! behind the pointer. Out in the gaps between words there is nothing under
  //! the cursor and the angle is the only answer, which is what makes a flick
  //! work at all.
  const track = (x, y, target) => {
    const chip = target && target.closest ? target.closest(".pie-item") : null;
    const found = chip ? Number(chip.dataset.wedge)
      : wedgeAt(items().length, x - at.x, y - at.y, PIE_DEAD * scale);
    if (found >= 0) moved = true;
    if (found !== live) { live = found; paint(); }
  };

  const open = (list, x, y) => {
    if (!list || !list.length) return;
    stack = [{ items: list, label: "" }];
    scale = sized();
    ring.style.transform = "scale(" + scale + ")";
    // Kept clear of the edges, so a ring opened in a corner is still a ring -
    // and by as much as it is actually drawn, which is the margin times the
    // scale it is drawn at.
    const across = 232 * scale, down = 168 * scale;
    at = { x: Math.max(across, Math.min(innerWidth - across, x)),
           y: Math.max(down, Math.min(innerHeight - down, y)) };
    live = -1; moved = false;
    veil.style.setProperty("--pie-x", at.x + "px");
    veil.style.setProperty("--pie-y", at.y + "px");
    veil.hidden = false;
    draw();
    if (onOpen) onOpen();
  };

  const close = () => {
    if (veil.hidden) return;
    veil.hidden = true;
    stack = [];
    live = -1; moved = false;
    if (onClose) onClose();
  };

  veil.addEventListener("pointermove", event =>
    track(event.clientX, event.clientY, event.target));
  veil.addEventListener("pointerdown", event => {
    // A press on the veil rather than on a chip: the wedge under it if there
    // is one, and otherwise the way out.
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 2) { back(); return; }
    if (live >= 0) choose(live); else close();
  });
  veil.addEventListener("contextmenu", event => { event.preventDefault(); back(); });

  return {
    open, close, back,
    isOpen: () => !veil.hidden,
    //! Space let go. A flick that left the middle picks what it was pointing
    //! at; a tap leaves the menu up to be read.
    release: () => { if (!veil.hidden && moved && live >= 0) choose(live); },
    deep: () => stack.length,
    element: veil,
  };
}
