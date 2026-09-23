// Edit mode.
//
// Double-click a mesh and the viewport stops being a viewport of objects and
// becomes a viewport of the cage: points, edges and faces you can pick, and
// forty operations that do things to what you picked. It is the mode Blender,
// Maya and Max all have and it works the way they all work, because that is
// what everybody's hands already know - press 1, 2, 3 for vertex, edge, face;
// Alt-click for a loop; E to extrude, I to inset, Ctrl-R for a loop cut.
//
// TWO THINGS MAKE IT DIFFERENT FROM THEIRS, and they are the two the office
// actually needs.
//
// NOTHING IS BAKED. Every operation is a record appended to a list on the Edit
// Mesh node, and the list is replayed over whatever cage arrives from upstream.
// Change the box the whole thing was built on and every extrude, bevel and loop
// cut happens again to the new box. That is Max's Edit Poly rather than
// Blender's destructive stack, and it is the difference between a modeller and
// a sculpting tool.
//
// IT RUNS TWICE. Once here, in the page, on the cage it already has - which is
// what you see while you drag, at the frame rate - and once in the kernel, when
// you let go, which is what the model becomes. Both run the SAME functions out
// of polymesh.js, so what you saw is what you got; there is no preview code to
// drift away from the real thing.

import { MESH_LEVELS, MESH_OPS, anchorsOf, applyOps, borderLoops, boundsOf, byTrait,
         cageOf, checker, edgeEnds, edgeKey, edgeLoop, edgeRing, edgesIn, faceCentre,
         faceLoop, faceNormal, facesOf, growSelection, invertSelection, linkedFrom,
         openEdges, pmAdd, pmCross, pmDot, pmLen, pmMid, pmMul, pmSub, pmUnit,
         shellsOf, shrinkSelection,
         similarTo, tallyOf, topologyOf, vertsOf } from "./polymesh.js";
import { rulerAt } from "./handle.js";

/* -------------------------------------------------------------- the levels

   Five, and they are the five 3ds Max has rather than the three Blender has,
   because the two Max adds are the two an imported model needs. A BORDER is an
   open loop taken as one thing - what you bridge or cap. An ELEMENT is a
   connected lump - and because it is worked out from the topology rather than
   stored, welding two elements together really does make them one, and the
   count in the bar really does change. */

export const LEVELS = [
  { key: "vertex", label: "Vertex", hint: "the points", stroke: "1" },
  { key: "edge", label: "Edge", hint: "the lines between them", stroke: "2" },
  { key: "face", label: "Face", hint: "the polygons", stroke: "3" },
  { key: "border", label: "Border", hint: "a whole open loop", stroke: "4" },
  { key: "element", label: "Element", hint: "a connected lump", stroke: "5" },
];

//! WHICH OPERATIONS BELONG TO WHICH LEVEL, in the order a person reaches for
//! them. MESH_OPS says what an operation can do; this says what to offer first,
//! which is a different question and the one a menu has to answer.
export const LEVEL_OPS = {
  vertex: ["extrude", "bevel", "connect", "weldat", "collapse", "merge", "smooth",
           "shrinkfatten", "corner", "rip", "sphere", "randomize", "dissolve", "remove"],
  edge: ["extrude", "bevel", "loopcut", "subdivide", "crease", "bridge", "fill",
         "gridfill", "spin", "collapse", "dissolve", "remove"],
  face: ["extrude", "inset", "poke", "subdivide", "duplicate", "split", "solidify",
         "flip", "recalc", "triangulate", "quadrangulate", "unsubdivide", "smooth",
         "shrinkfatten", "bisect", "mirror", "symmetrize", "wireframe", "dissolve", "remove"],
  border: ["extrude", "fill", "gridfill", "bridge", "spin", "remove"],
  element: ["duplicate", "flip", "recalc", "solidify", "wireframe", "mirror",
            "symmetrize", "triangulate", "quadrangulate", "unsubdivide", "smooth",
            "bisect", "split", "remove"],
};

//! THE MENUS ALONG THE TOP, arranged the way Blender arranges them - because
//! the bar should say what MODE you are in and nothing else, and everything you
//! can do lives one click down in the menu for the kind of thing you do it to.
//!
//! A wall of forty buttons is not an interface. It is a list of everything the
//! program can do, printed, and the price of never having to look for anything
//! is never being able to see anything either.
export const MESH_MENUS = [
  { key: "vertex", label: "Vertex",
    groups: [["extrude", "bevel", "connect"],
             ["weldat", "collapse", "merge", "rip"],
             ["smooth", "shrinkfatten", "sphere", "randomize"],
             ["corner"],
             ["dissolve", "remove"]] },
  { key: "edge", label: "Edge",
    groups: [["extrude", "bevel", "loopcut", "subdivide"],
             ["bridge", "fill", "gridfill", "spin"],
             ["crease"],
             ["collapse", "dissolve", "remove"]] },
  { key: "face", label: "Face",
    groups: [["extrude", "inset", "poke", "subdivide"],
             ["duplicate", "split", "solidify"],
             ["triangulate", "quadrangulate", "unsubdivide"],
             ["flip", "recalc"],
             ["dissolve", "remove"]] },
  { key: "mesh", label: "Mesh",
    groups: [["merge", "smooth", "shrinkfatten", "sphere", "randomize"],
             ["mirror", "symmetrize", "bisect"],
             ["solidify", "wireframe"],
             ["triangulate", "quadrangulate", "unsubdivide"],
             ["flip", "recalc"]] },
];

//! The selections worth having a button for. Every one of them is a question
//! about the topology that would take a minute to answer by hand.
export const PICKS = [
  { key: "all", label: "All", levels: MESH_LEVELS },
  { key: "none", label: "None", levels: MESH_LEVELS },
  { key: "invert", label: "Invert", levels: MESH_LEVELS },
  { key: "grow", label: "Grow", levels: ["vertex", "edge", "face"] },
  { key: "shrink", label: "Shrink", levels: ["vertex", "edge", "face"] },
  { key: "loop", label: "Loop", levels: ["edge", "face"] },
  { key: "ring", label: "Ring", levels: ["edge"] },
  { key: "linked", label: "Linked", levels: ["vertex", "edge", "face"] },
  { key: "similar", label: "Similar", levels: ["vertex", "edge", "face"] },
  { key: "checker", label: "Every other", levels: ["vertex", "edge", "face"] },
  { key: "open", label: "Open edges", levels: ["edge", "border"] },
  { key: "poles", label: "Poles", levels: ["vertex"] },
  { key: "ngons", label: "N-gons", levels: ["face"] },
  { key: "tris", label: "Triangles", levels: ["face"] },
];

const HOT = {
  1: "vertex", 2: "edge", 3: "face", 4: "border", 5: "element",
};

/* ----------------------------------------------------------- the editor */

//! Everything the editor needs from the page, and nothing it does not: the
//! renderer, the document, and a way to ask for a frame. Handed in rather than
//! reached for, so this file can be read on its own and tested without one.
export function makeMeshEditor(kit) {
  const { THREE } = kit;
  const editor = {
    on: false,
    id: null,                       // the Edit Mesh feature being edited
    level: "face",
    picked: [],                     // at the current level
    hover: null,
    cage: null,                     // { points, faces, creases, corners }
    ops: [],                        // the list as it stands
    topo: null,
    busy: false,
    live: null,                     // an operation being dragged
    note: "",
    // WHICH WAY THE WIDGET POINTS. Normal means the selection's own frame -
    // square to the face, along the edge - which is how you push a wall out of
    // a building that is not aligned to the world, and it is the orientation
    // this starts in because on a cage it is right far more often than global.
    orient: "normal",
    grab: null,                     // an axis of the widget being dragged
  };

  /* ------------------------------------------------------- what is drawn */

  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 6;
  kit.world.add(group);

  const soft = (colour, opacity) => new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide });
  const wire = (colour, opacity = 1) => new THREE.LineBasicMaterial({
    color: colour, transparent: opacity < 1, opacity, depthTest: false });

  const parts = {
    // The cage itself, always drawn, so you can see what you are editing
    // through whatever the subdivision downstream has turned it into.
    cage: new THREE.LineSegments(new THREE.BufferGeometry(), wire(0x5b6a76, 0.75)),
    creased: new THREE.LineSegments(new THREE.BufferGeometry(), wire(0xd2691e, 1)),
    dots: new THREE.Points(new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0x8b99a5, size: 7, sizeAttenuation: false,
                                 depthTest: false })),
    // A DOT IN THE MIDDLE OF EVERY FACE, in face mode, and in the middle of
    // every element in element mode. It is what Blender draws and it is not
    // decoration: a face you can see the centre of is a face you can tell from
    // the one behind it, and a selected one shows at a glance which side of an
    // edge got picked.
    faceDots: new THREE.Points(new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0x8b99a5, size: 6, sizeAttenuation: false,
                                 depthTest: false })),
    litFaceDots: new THREE.Points(new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0x0a6cb0, size: 10, sizeAttenuation: false,
                                 depthTest: false })),
    litDots: new THREE.Points(new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0x0a6cb0, size: 11, sizeAttenuation: false,
                                 depthTest: false })),
    litEdges: new THREE.LineSegments(new THREE.BufferGeometry(), wire(0x0a6cb0)),
    litFaces: new THREE.Mesh(new THREE.BufferGeometry(), soft(0x0a6cb0, 0.42)),
    overFaces: new THREE.Mesh(new THREE.BufferGeometry(), soft(0x4aa8ea, 0.22)),
    overEdges: new THREE.LineSegments(new THREE.BufferGeometry(), wire(0x4aa8ea, 0.9)),
    overDots: new THREE.Points(new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0x4aa8ea, size: 10, sizeAttenuation: false,
                                 depthTest: false })),
  };
  for (const part of Object.values(parts)) {
    part.renderOrder = 7;
    part.frustumCulled = false;
    group.add(part);
  }
  // What the ray is actually fired at: one mesh with every face of the cage
  // fanned into it, and a lookup from triangle back to face. Never drawn.
  const target = new THREE.Mesh(new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  target.frustumCulled = false;
  let triangleFace = [];
  group.add(target);

  const put = (part, points) => {
    const array = new Float32Array(points.length * 3);
    points.forEach((p, i) => { array[i * 3] = p[0]; array[i * 3 + 1] = p[1]; array[i * 3 + 2] = p[2]; });
    part.geometry.dispose();
    part.geometry = new THREE.BufferGeometry();
    part.geometry.setAttribute("position", new THREE.BufferAttribute(array, 3));
    part.visible = points.length > 0;
  };

  //! Every face of a selection as triangles, for the translucent wash over it.
  const faceTriangles = faces => {
    const out = [];
    for (const fi of faces) {
      const face = editor.cage.faces[fi];
      if (!face) continue;
      for (let i = 1; i + 1 < face.length; i++)
        out.push(editor.cage.points[face[0]], editor.cage.points[face[i]],
                 editor.cage.points[face[i + 1]]);
    }
    return out;
  };

  const edgeLines = keys => {
    const out = [];
    for (const key of keys) {
      const [a, b] = edgeEnds(key);
      if (editor.cage.points[a] && editor.cage.points[b])
        out.push(editor.cage.points[a], editor.cage.points[b]);
    }
    return out;
  };

  //! Draw the lot. Cheap enough to do on every change: a cage is hundreds of
  //! faces, and the reason a cage is hundreds of faces is so that it can be.
  function paint() {
    if (!editor.cage) return;
    const mesh = editor.cage;
    const topo = editor.topo;
    const plain = [], hot = [];
    for (const [key] of topo.edges) {
      const [a, b] = edgeEnds(key);
      (mesh.creases[key] > 0 ? hot : plain).push(mesh.points[a], mesh.points[b]);
    }
    put(parts.cage, plain);
    put(parts.creased, hot);
    put(parts.dots, editor.level === "vertex" ? mesh.points : []);

    const picked = editor.picked;
    const shells = editor.level === "element" ? shellsOf(mesh, topo) : null;
    const middles = editor.level === "face"
      ? mesh.faces.map(face => faceCentre(mesh, face))
      : shells ? shells.map(group => pmMid(group.map(fi => faceCentre(mesh, mesh.faces[fi]))))
      : [];
    const litMiddles = middles.length
      ? picked.map(i => middles[i]).filter(Boolean) : [];
    put(parts.faceDots, middles);
    put(parts.litFaceDots, litMiddles);
    put(parts.litDots, editor.level === "vertex"
      ? picked.map(v => mesh.points[v]).filter(Boolean) : []);
    put(parts.litEdges, editor.level === "edge" ? edgeLines(picked)
      : editor.level === "border" ? edgeLines(borderEdges(picked)) : []);
    const litFaces = editor.level === "face" ? picked
      : editor.level === "element" ? picked.flatMap(si => (shellsOf(mesh, topo)[si] || [])) : [];
    setTriangles(parts.litFaces, faceTriangles(litFaces));

    const over = editor.hover;
    put(parts.overDots, over && over.level === "vertex" && mesh.points[over.at]
      ? [mesh.points[over.at]] : []);
    put(parts.overEdges, over && over.level === "edge" ? edgeLines([over.at])
      : over && over.level === "border" ? edgeLines(borderEdges([over.at])) : []);
    setTriangles(parts.overFaces, over && over.level === "face" ? faceTriangles([over.at])
      : over && over.level === "element"
        ? faceTriangles(shellsOf(mesh, topo)[over.at] || []) : []);
    placeGizmo();
    kit.draw();
  }

  const setTriangles = (part, points) => {
    put(part, points);
    part.geometry.computeVertexNormals();
  };

  const borderEdges = loops => {
    const all = borderLoops(editor.cage, editor.topo);
    const out = [];
    for (const which of loops) {
      const loop = all[which];
      if (!loop) continue;
      for (let i = 0; i < loop.length; i++) {
        const key = edgeKey(loop[i], loop[(i + 1) % loop.length]);
        if (editor.topo.edges.has(key)) out.push(key);
      }
    }
    return out;
  };

  //! The ray target, rebuilt whenever the cage changes. One triangle list, and
  //! an array saying which face each triangle came from - which is how a hit
  //! on a fan becomes a click on an n-gon.
  function aim() {
    const mesh = editor.cage;
    const points = [];
    triangleFace = [];
    mesh.faces.forEach((face, fi) => {
      for (let i = 1; i + 1 < face.length; i++) {
        points.push(mesh.points[face[0]], mesh.points[face[i]], mesh.points[face[i + 1]]);
        triangleFace.push(fi);
      }
    });
    put(target, points);
    target.visible = true;
    target.material.visible = false;
  }

  /* ----------------------------------------------------- the move widget

     THE THREE ARROWS, where the selection is and pointing the way the
     selection points. Drag one and everything picked goes along it.

     Blender's "normal" transform orientation, and it is the one that matters
     on a cage: a face pulled along its own normal comes straight out of the
     wall, and a face pulled along world Z on a building that is not square to
     the world goes somewhere nobody asked for. Vertex mode has no face to take
     a direction from, so it uses the vertex's own normal - averaged from the
     faces on it, which is the direction a point on a surface points.        */

  const AXIS_COLOURS = [0xd0473f, 0x3f9e4d, 0x2f7fd0];
  const gizmo = new THREE.Group();
  gizmo.visible = false;
  gizmo.renderOrder = 9;
  group.add(gizmo);
  const arms = [];
  for (let a = 0; a < 3; a++) {
    const material = new THREE.MeshBasicMaterial({ color: AXIS_COLOURS[a], depthTest: false,
                                                   transparent: true, opacity: 0.95 });
    const arm = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), material);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 12), material);
    shaft.userData.axis = a;
    tip.userData.axis = a;
    shaft.renderOrder = 9;
    tip.renderOrder = 9;
    arm.add(shaft, tip);
    arm.userData.axis = a;
    gizmo.add(arm);
    arms.push({ arm, shaft, tip, material });
  }
  const hub = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xf0f4f7, depthTest: false }));
  hub.renderOrder = 9;
  gizmo.add(hub);

  //! WHERE THE WIDGET STANDS AND WHICH WAY IT POINTS. The middle of what is
  //! picked, and a frame taken from it: square to the face, along the edge, off
  //! the vertex - or the world's own axes when the orientation is set to
  //! global, which is what you want for moving something onto a grid.
  editor.frame = () => {
    if (!editor.cage || !editor.picked.length) return null;
    const mesh = editor.cage, topo = editor.topo;
    const verts = vertsOf(mesh, editor.level, editor.picked, topo);
    if (!verts.length) return null;
    const at = pmMid(verts.map(v => mesh.points[v]));
    if (editor.orient === "global")
      return { at, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
    let up = null, along = null;
    if (editor.level === "face" || editor.level === "element") {
      const faces = facesOf(mesh, editor.level, editor.picked, topo);
      if (faces.length) {
        up = pmUnit(pmMid(faces.map(fi => faceNormal(mesh, mesh.faces[fi]))));
        const face = mesh.faces[faces[0]];
        along = pmUnit(pmSub(mesh.points[face[1]], mesh.points[face[0]]));
      }
    } else if (editor.level === "edge" || editor.level === "border") {
      const keys = edgesIn(mesh, editor.level, editor.picked, topo);
      if (keys.length) {
        const [a, b] = edgeEnds(keys[0]);
        // Along the edge is X; square to the faces on it is Z. An edge with one
        // face has that face's normal, and a loose one falls back to the world.
        along = pmUnit(pmSub(mesh.points[b], mesh.points[a]));
        const on = topo.edges.get(keys[0]).faces;
        if (on.length) up = pmUnit(pmMid(on.map(fi => faceNormal(mesh, mesh.faces[fi]))));
      }
    } else {
      const normals = vertexNormalsOf(mesh, topo);
      up = pmUnit(pmMid(verts.map(v => normals[v])));
    }
    if (!up || !pmLen(up)) up = [0, 0, 1];
    if (!along || Math.abs(pmDot(pmUnit(along), up)) > 0.99) {
      const guess = Math.abs(up[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
      along = pmUnit(pmCross(guess, up));
    }
    const x = pmUnit(pmSub(along, pmMul(up, pmDot(along, up))));
    const y = pmUnit(pmCross(up, x));
    return { at, axes: [x, y, up] };
  };

  //! The vertex normals, cached per cage: the frame asks for them on every
  //! selection change and a cage is not so small that it is free.
  let normalCache = null, normalFor = null;
  const vertexNormalsOf = (mesh, topo) => {
    if (normalFor === mesh) return normalCache;
    normalFor = mesh;
    normalCache = normalsOf(mesh, topo);
    return normalCache;
  };
  const normalsOf = (mesh, topo) => {
    const out = mesh.points.map(() => [0, 0, 0]);
    mesh.faces.forEach(face => {
      const n = faceNormal(mesh, face);
      for (const v of face) if (out[v]) out[v] = pmAdd(out[v], n);
    });
    return out.map(n => (pmLen(n) > 1e-9 ? pmUnit(n) : [0, 0, 1]));
  };

  //! Put the arrows where the frame says, at a size that reads the same
  //! however far away the camera is.
  function placeGizmo() {
    const frame = editor.frame();
    if (!frame) { gizmo.visible = false; return; }
    const span = kit.gizmoSpan ? kit.gizmoSpan() : 60;
    gizmo.visible = true;
    gizmo.position.set(frame.at[0], frame.at[1], frame.at[2]);
    hub.scale.setScalar(span * 0.07);
    arms.forEach(({ arm, shaft, tip }, a) => {
      const dir = new THREE.Vector3(...frame.axes[a]);
      const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      arm.quaternion.copy(turn);
      shaft.scale.set(span * 0.022, span, span * 0.022);
      shaft.position.set(0, span * 0.5, 0);
      tip.scale.set(span * 0.075, span * 0.22, span * 0.075);
      tip.position.set(0, span * 1.1, 0);
    });
    editor.gizmoAt = frame;
  }

  //! An arrow under the pointer takes the drag. Everything picked then moves
  //! along that axis, as one \ref move operation that is rewritten on every
  //! frame - so the whole drag is one step in the list and one undo.
  editor.grabGizmo = ray => {
    if (!editor.on || !gizmo.visible) return null;
    const hits = ray.intersectObjects(gizmo.children, true);
    const hit = hits.find(h => h.object.userData.axis !== undefined);
    if (!hit) return null;
    const frame = editor.frame();
    if (!frame) return null;
    const axis = hit.object.userData.axis;
    editor.grab = { axis, dir: frame.axes[axis], at: frame.at,
                    from: rulerAt([ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z],
                                  [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z],
                                  frame.at, frame.axes[axis]),
                    moved: false };
    return editor.grab;
  };

  editor.dragGizmo = async ray => {
    const grab = editor.grab;
    if (!grab) return;
    const now = rulerAt([ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z],
                        [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z],
                        grab.at, grab.dir);
    if (!Number.isFinite(now) || !Number.isFinite(grab.from)) return;
    const by = pmMul(grab.dir, now - grab.from);
    if (!grab.moved && pmLen(by) < 1e-9) return;
    // The FIRST frame of the drag appends a move; every frame after it rewrites
    // that same move, so a drag is one entry in the list rather than four
    // hundred of them.
    await run("move", { by }, { live: true, replace: grab.moved });
    grab.moved = true;
  };

  editor.dropGizmo = async () => {
    const grab = editor.grab;
    editor.grab = null;
    if (!grab) return;
    if (!grab.moved) return;
    await commit();
  };

  /* --------------------------------------------------------- the picking */

  const ray = new THREE.Raycaster();

  //! What is under the pointer, at the level being edited. One raycast at the
  //! faces, then the answer is refined by level - the nearest corner of the
  //! face that was hit, the nearest of its edges, the face itself, its border,
  //! its element. Picking edges by raycasting lines directly is a lottery at
  //! any distance; picking the face and then asking which of its edges you
  //! were nearest is exact.
  function under(event) {
    if (!editor.cage || !editor.cage.faces.length) return null;
    const rect = kit.canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1), kit.camera);
    const hits = ray.intersectObject(target, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const fi = triangleFace[Math.floor(hit.faceIndex)];
    const face = editor.cage.faces[fi];
    if (!face) return null;
    const where = [hit.point.x, hit.point.y, hit.point.z];
    if (editor.level === "face") return { level: "face", at: fi };
    if (editor.level === "element") {
      const shells = shellsOf(editor.cage, editor.topo);
      const which = shells.findIndex(group => group.includes(fi));
      return which < 0 ? null : { level: "element", at: which };
    }
    if (editor.level === "vertex") {
      let best = face[0], far = Infinity;
      for (const v of face) {
        const d = pmLen(pmSub(editor.cage.points[v], where));
        if (d < far) { far = d; best = v; }
      }
      return { level: "vertex", at: best };
    }
    // An edge, of this face, nearest where the ray landed.
    let best = null, far = Infinity;
    for (let i = 0; i < face.length; i++) {
      const key = edgeKey(face[i], face[(i + 1) % face.length]);
      const d = toSegment(where, editor.cage.points[face[i]],
                          editor.cage.points[face[(i + 1) % face.length]]);
      if (d < far) { far = d; best = key; }
    }
    if (!best) return null;
    if (editor.level === "edge") return { level: "edge", at: best };
    const loops = borderLoops(editor.cage, editor.topo);
    const [a, b] = edgeEnds(best);
    const which = loops.findIndex(loop => loop.includes(a) && loop.includes(b));
    return which < 0 ? null : { level: "border", at: which };
  }

  const toSegment = (p, a, b) => {
    const along = pmSub(b, a), length = pmLen(along);
    if (length < 1e-9) return pmLen(pmSub(p, a));
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * along[0] + (p[1] - a[1]) * along[1]
      + (p[2] - a[2]) * along[2]) / (length * length)));
    return pmLen(pmSub(p, pmAdd(a, pmMul(along, t))));
  };

  /* --------------------------------------------------- the edit list itself */

  //! Run an operation on what is picked. THE WHOLE EDITOR IS THIS FUNCTION.
  //!
  //! The record is built against the cage as it stands - what level, which
  //! items, and where those items are - appended to the list, and the list is
  //! replayed here to give the new cage and the new selection. The kernel is
  //! told last, and while a drag is going on it is not told at all: the page
  //! has the same code the kernel has, so the shape under the mouse is the
  //! shape the file will rebuild to.
  async function run(op, args = {}, { live = false, replace = false } = {}) {
    if (!editor.cage || editor.busy) return null;
    const spec = MESH_OPS[op];
    if (!spec) return null;
    // RE-RUNNING THE LAST OPERATION KEEPS WHAT IT WAS ABOUT. Only its numbers
    // change: the face being dragged out is the same face, and asking the cage
    // again would ask the cage the operation has already moved. Chasing its own
    // answer is exactly what that does - three frames into a drag the recorded
    // position is where the face has got to, the replay looks for it where it
    // has NOT got to yet, finds nothing, and the operation quietly loses its
    // selection half way through the gesture.
    const before = replace ? editor.ops[editor.ops.length - 1] : null;
    const same = before && before.op === op ? before : null;
    const level = same ? same.level
      : spec.levels.includes(editor.level) ? editor.level : spec.levels[0];
    const at = same ? same.at
      : level === editor.level ? editor.picked
      : level === "face" ? facesOf(editor.cage, editor.level, editor.picked, editor.topo)
      : level === "edge" ? edgesIn(editor.cage, editor.level, editor.picked, editor.topo)
      : vertsOf(editor.cage, editor.level, editor.picked, editor.topo);
    const record = { op, level, at: [...at],
                     near: same ? same.near : anchorsOf(editor.cage, level, at, editor.topo),
                     args: { ...spec.args, ...args } };
    const list = replace ? [...editor.ops.slice(0, -1), record] : [...editor.ops, record];
    const done = applyOps(editor.base, list);
    editor.ops = list;
    editor.note = done.notes.join(" · ");
    settle(done.mesh, done.picked, done.level);
    if (live) later(); else await commit();
    return record;
  }

  //! A LIVE operation does not go to the kernel on every frame - that is a
  //! round trip per pixel of drag and the reason it is being run here at all.
  //! But it cannot simply wait for a mouse-up either: an operation chosen off
  //! the menu and never dragged would sit in the page and never reach the
  //! document. So a quarter of a second after the last change, it commits
  //! itself. Both routes land on the same list and the same undo step, because
  //! mdl coalesces consecutive meshop edits on one feature.
  let settleTimer = 0;
  function later() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settleTimer = 0; commit(); }, 250);
  }

  //! What the cage is now. Kept apart from the kernel's copy so a drag can run
  //! at the frame rate: the base is what arrived from upstream, the list is
  //! replayed over it, and only the answer is drawn.
  function settle(mesh, picked, level) {
    editor.cage = cageOf(mesh);
    editor.topo = topologyOf(editor.cage);
    if (level && MESH_LEVELS.includes(level)) editor.level = level;
    editor.picked = (picked || []).filter(item => exists(item, editor.level));
    aim();
    paint();
    kit.onChange && kit.onChange();
  }

  const exists = (item, level) => {
    if (level === "vertex") return !!editor.cage.points[item];
    if (level === "face") return !!editor.cage.faces[item];
    if (level === "edge") return editor.topo.edges.has(item);
    if (level === "element") return item < shellsOf(editor.cage, editor.topo).length;
    return item < borderLoops(editor.cage, editor.topo).length;
  };

  //! Tell the document. One call, one undo step, and the same list the page
  //! has just run - so the rebuild cannot come out different from the preview.
  async function commit() {
    clearTimeout(settleTimer);
    settleTimer = 0;
    if (!editor.id) return;
    editor.busy = true;
    try {
      await kit.mdl.run({ op: "meshop", id: editor.id, ops: editor.ops });
    } catch (error) {
      editor.note = String(error.message || error);
    } finally {
      editor.busy = false;
    }
    kit.onChange && kit.onChange();
  }

  /* ------------------------------------------------------------- the mode */

  editor.enter = async id => {
    const got = await kit.kernel.cage(id).catch(() => null);
    if (!got) return false;
    editor.id = id;
    editor.on = true;
    editor.ops = Array.isArray(got.ops) ? got.ops : [];
    editor.note = got.note || "";
    // THE CAGE THIS EDITOR HOLDS is the one arriving from UPSTREAM, not the one
    // the node produced. The list is replayed over the former, and an
    // operation is not invertible, so there is no way back to it from the
    // result - it is read from whatever is wired into the node's mesh input.
    const base = await kit.kernel.cage(kit.inputOf(id) || id).catch(() => null);
    editor.base = cageOf(base || got);
    const done = applyOps(editor.base, editor.ops);
    editor.picked = [];
    settle(done.mesh, [], editor.level);
    group.visible = true;
    return true;
  };

  editor.leave = () => {
    editor.on = false;
    editor.id = null;
    editor.cage = null;
    editor.picked = [];
    editor.hover = null;
    group.visible = false;
    kit.draw();
    kit.onChange && kit.onChange();
  };

  editor.setLevel = level => {
    if (!MESH_LEVELS.includes(level) || !editor.cage) return;
    // Carry the selection across rather than dropping it: picking three faces
    // and pressing 2 should give you their edges, which is what every editor
    // of this kind does and what makes the levels feel like one selection seen
    // five ways.
    const was = editor.level;
    const carried = level === "vertex" ? vertsOf(editor.cage, was, editor.picked, editor.topo)
      : level === "edge" ? edgesIn(editor.cage, was, editor.picked, editor.topo)
      : level === "face" ? facesOf(editor.cage, was, editor.picked, editor.topo)
      : level === "element"
        ? [...new Set(facesOf(editor.cage, was, editor.picked, editor.topo).map(fi =>
            shellsOf(editor.cage, editor.topo).findIndex(g => g.includes(fi))))].filter(i => i >= 0)
      : [];
    editor.level = level;
    editor.picked = carried;
    editor.hover = null;
    paint();
    kit.onChange && kit.onChange();
  };

  editor.hoverAt = event => {
    if (!editor.on) return;
    const got = under(event);
    const was = editor.hover;
    if ((was && was.at) === (got && got.at) && (was && was.level) === (got && got.level)) return;
    editor.hover = got;
    paint();
  };

  //! A click. Plain replaces the selection, shift adds, ctrl takes away, and
  //! alt takes the loop through it - which is the one shortcut nobody who has
  //! modelled a subdivision surface can work without.
  editor.pickAt = (event, modifiers = {}) => {
    if (!editor.on) return false;
    const got = under(event);
    if (!got) {
      if (!modifiers.add && !modifiers.drop) { editor.picked = []; paint(); kit.onChange && kit.onChange(); }
      return true;
    }
    let items = [got.at];
    if (modifiers.loop && editor.level === "edge")
      items = edgeLoop(editor.cage, got.at, editor.topo);
    else if (modifiers.loop && editor.level === "face")
      items = faceLoop(editor.cage, nearestEdgeOf(got.at), editor.topo);
    const have = new Set(editor.picked.map(String));
    if (modifiers.drop) for (const item of items) have.delete(String(item));
    else if (modifiers.add) for (const item of items) have.add(String(item));
    else { have.clear(); for (const item of items) have.add(String(item)); }
    editor.picked = [...have].map(item => (editor.level === "edge" ? item : Number(item)));
    paint();
    kit.onChange && kit.onChange();
    return true;
  };

  const nearestEdgeOf = fi => {
    const face = editor.cage.faces[fi];
    return face ? edgeKey(face[0], face[1]) : null;
  };

  /* ----------------------------------------------------- the selections */

  editor.select = (what, extra = {}) => {
    if (!editor.cage) return;
    const mesh = editor.cage, topo = editor.topo, level = editor.level;
    const all = () => level === "vertex" ? mesh.points.map((p, i) => i)
      : level === "face" ? mesh.faces.map((f, i) => i)
      : level === "edge" ? [...topo.edges.keys()]
      : level === "element" ? shellsOf(mesh, topo).map((g, i) => i)
      : borderLoops(mesh, topo).map((l, i) => i);
    if (what === "all") editor.picked = all();
    else if (what === "none") editor.picked = [];
    else if (what === "invert") editor.picked = invertSelection(mesh, level, editor.picked, topo);
    else if (what === "grow") editor.picked = growSelection(mesh, level, editor.picked, topo);
    else if (what === "shrink") editor.picked = shrinkSelection(mesh, level, editor.picked, topo);
    else if (what === "linked") {
      const faces = linkedFrom(mesh, level, editor.picked, topo);
      editor.picked = level === "face" ? faces
        : level === "vertex" ? vertsOf(mesh, "face", faces, topo)
        : edgesIn(mesh, "face", faces, topo);
    } else if (what === "loop") {
      const out = new Set();
      if (level === "edge") for (const key of editor.picked)
        for (const other of edgeLoop(mesh, key, topo)) out.add(other);
      editor.picked = [...out];
    } else if (what === "ring") {
      const out = new Set();
      for (const key of editor.picked)
        for (const other of edgeRing(mesh, key, topo)) out.add(other);
      editor.picked = [...out];
    } else if (what === "similar") {
      editor.picked = similarTo(mesh, level, editor.picked, extra.trait || "sides", 0.03, topo);
    } else if (what === "checker") {
      editor.picked = checker(editor.picked.length ? editor.picked : all(), 1, 1);
    } else if (what === "open") {
      editor.picked = level === "border" ? borderLoops(mesh, topo).map((l, i) => i)
                                         : openEdges(mesh, topo);
    } else if (what === "poles" || what === "ngons" || what === "tris") {
      editor.picked = byTrait(mesh, what, topo);
    }
    paint();
    kit.onChange && kit.onChange();
  };

  /* ---------------------------------------------- the operation, and the drag

     An operation runs the moment it is chosen, with its default, and then the
     LEAD argument is put under the mouse: pull and the extrude gets longer,
     let go and that is the number. That is how a modeller works - the dialogue
     box came later and is worse - and it costs nothing here because the
     operation is a record that can simply be run again with a different
     number.                                                                 */

  editor.run = run;

  editor.begin = async (op, args) => {
    const spec = MESH_OPS[op];
    if (!spec || !editor.cage) return null;
    const done = await run(op, args || {}, { live: !!spec.lead });
    if (!spec.lead) return null;
    editor.live = { op, args: { ...spec.args, ...(args || {}) }, lead: spec.lead,
                    from: null, scale: sizeOf() };
    return editor.live;
  };

  //! How big the thing being edited is, so a drag of a hundred pixels means a
  //! sensible amount on a 200 mm cage and on a 200 m one.
  const sizeOf = () => {
    const box = boundsOf(editor.cage);
    return Math.max(1, pmLen(pmSub(box.hi, box.lo)));
  };

  editor.drag = async (dx, dy) => {
    const live = editor.live;
    if (!live) return;
    const spec = MESH_OPS[live.op];
    const step = (dx - dy) * sizeOf() * 0.0016;
    const now = live.args[live.lead];
    const want = Array.isArray(now) ? now.map((v, i) => (i === 2 ? v + step : v))
      : (typeof now === "number" ? now + step : step);
    live.args[live.lead] = live.lead === "amount" && (live.op === "crease" || live.op === "corner")
      ? Math.max(0, Math.min(1, want)) : want;
    await run(live.op, live.args, { live: true, replace: true });
  };

  editor.drop = async () => {
    if (!editor.live) return;
    editor.live = null;
    await commit();
  };

  //! The lead argument of the operation just run, so a panel can show it and a
  //! number can be typed instead of dragged.
  editor.lead = () => {
    const last = editor.ops[editor.ops.length - 1];
    if (!last) return null;
    const spec = MESH_OPS[last.op];
    if (!spec || !spec.lead) return null;
    return { op: last.op, label: spec.label, key: spec.lead,
             value: last.args[spec.lead], args: last.args };
  };

  //! Change the number on the operation just run, which is the "adjust last
  //! operation" panel every modeller has and the reason you can pick Extrude
  //! without knowing how far yet.
  editor.adjust = async (key, value) => {
    const last = editor.ops[editor.ops.length - 1];
    if (!last) return;
    await run(last.op, { ...last.args, [key]: value }, { replace: true });
  };

  //! Take the last operation off. Undo does this too - this is the button on
  //! the list, for when you want to reach past the last thing you did.
  editor.undoStep = async () => {
    if (!editor.ops.length) return;
    editor.ops = editor.ops.slice(0, -1);
    const done = applyOps(editor.base, editor.ops);
    editor.note = done.notes.join(" · ");
    settle(done.mesh, [], editor.level);
    await commit();
  };

  editor.dropStep = async index => {
    if (!editor.ops[index]) return;
    editor.ops = editor.ops.filter((op, i) => i !== index);
    const done = applyOps(editor.base, editor.ops);
    editor.note = done.notes.join(" · ");
    settle(done.mesh, [], editor.level);
    await commit();
  };

  //! What the bar says: how much is picked, out of how much there is.
  editor.tally = () => {
    if (!editor.cage) return { picked: 0, all: 0, says: "" };
    const mesh = editor.cage, topo = editor.topo;
    const all = editor.level === "vertex" ? mesh.points.length
      : editor.level === "face" ? mesh.faces.length
      : editor.level === "edge" ? topo.edges.size
      : editor.level === "element" ? shellsOf(mesh, topo).length
      : borderLoops(mesh, topo).length;
    return { picked: editor.picked.length, all, says: tallyOf(mesh) };
  };

  editor.hotkey = key => HOT[key] || null;
  editor.group = group;
  editor.widget = gizmo;
  editor.paint = paint;
  editor.dispose = () => { kit.world.remove(group); };
  return editor;
}
