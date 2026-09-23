// The cage, and everything you can do to one.
//
// A subdivision model is not a solid with a smooth option on it. It is a CAGE
// - a few hundred quads you push about by hand - and the smooth surface is
// what that cage means. So the cage is the design tool, and a program that
// offers a subdivision node without offering the cage editing that goes with
// it has offered the icing and not the cake. This module is the cake: the
// topology, the selection, and the operations that every mesh editor worth
// using has - Blender's, Maya's, Max's - written over one representation.
//
// THE REPRESENTATION. A mesh is
//
//     { points: [[x, y, z], …],          the vertices
//       faces:  [[i, j, k, …], …],       n-gons, wound anticlockwise seen from
//                                        outside, indices into points
//       creases: { "3,7": 0.8, … },      how sharp an edge is under subdivision
//       corners: { "12": 1 } }           and how sharp a vertex is
//
// and that is all of it. No half-edge structure is stored, because a cage is
// small and the adjacency is cheap to work out when it is wanted and a
// nightmare to keep correct when it is not. \ref topologyOf builds it in one
// pass and every operation here asks for it rather than maintaining one.
//
// WHY THE OPERATIONS ARE PURE. Every one of them takes a mesh and gives back a
// new mesh; none of them writes into the one it was handed. That is not
// fastidiousness - it is what makes the editing non-destructive. An Edit Mesh
// node holds a LIST of operations, and the list is replayed over whatever cage
// arrives from upstream every time anything upstream changes. Change the
// divisions on the box underneath and the extrude, the bevel and the loop cut
// on top of it all happen again, in order, to the new box. That is 3ds Max's
// Edit Poly, it is the reason this is a modeller rather than a mesh painter,
// and it only works if the operations are functions.
//
// WHAT AN OPERATION REFERS TO. Indices, into the mesh as it stands when the
// operation runs - which is the mesh after everything before it in the list.
// Indices move when the topology upstream changes, so each operation also
// carries the position of what it was pointing at, and \ref rebindTo finds the
// nearest match when the index no longer lands where it did. That is best
// effort and it is honest about it: an operation that has lost what it was
// about says so rather than silently doing something else.

/* ------------------------------------------------------------- the small
   arithmetic. Prefixed, because the single-file build shares one scope with
   every other module and `sub`, `add` and `unit` were taken three times over
   before this file existed. */

export const pmAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const pmSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const pmMul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const pmDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const pmCross = (a, b) => [a[1] * b[2] - a[2] * b[1],
                                  a[2] * b[0] - a[0] * b[2],
                                  a[0] * b[1] - a[1] * b[0]];
export const pmLen = a => Math.hypot(a[0], a[1], a[2]);
export const pmUnit = a => {
  const n = pmLen(a);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
};
export const pmMid = list => {
  if (!list.length) return [0, 0, 0];
  let x = 0, y = 0, z = 0;
  for (const p of list) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / list.length, y / list.length, z / list.length];
};

//! The key an edge is known by. Undirected - an edge belongs to two faces and
//! they walk it in opposite directions, so the pair has to sort.
export const edgeKey = (a, b) => (a < b ? a + "," + b : b + "," + a);
export const edgeEnds = key => key.split(",").map(Number);

//! A mesh with everything optional filled in. Everything here takes one of
//! these and gives one back, so a caller that has only points and faces - a
//! file, a tessellation, the kernel - can hand that in.
export function cageOf(mesh) {
  return {
    points: (mesh.points || []).map(p => [+p[0], +p[1], +p[2]]),
    faces: (mesh.faces || []).map(f => f.map(Number)),
    creases: { ...(mesh.creases || {}) },
    corners: { ...(mesh.corners || {}) },
  };
}

//! A copy that shares nothing with the original. The operations build their
//! results rather than copying, so this is for callers.
export function copyCage(mesh) { return cageOf(mesh); }

/* ------------------------------------------------------------- topology */

//! Everything adjacent to everything, in one pass.
//!
//!   edges      key -> { a, b, faces: [face index, …] }
//!   vertFaces  vertex -> faces touching it
//!   vertEdges  vertex -> edge keys touching it
//!   faceEdges  face -> its edge keys, in winding order
//!
//! A cage is hundreds of faces, not millions, so this is rebuilt whenever it
//! is wanted rather than kept in step with the edits. Keeping an adjacency
//! structure correct through an extrude is most of the bugs in a mesh editor.
export function topologyOf(mesh) {
  const edges = new Map();
  const vertFaces = mesh.points.map(() => []);
  const vertEdges = mesh.points.map(() => []);
  const faceEdges = [];
  mesh.faces.forEach((face, fi) => {
    const keys = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      if (vertFaces[a] && !vertFaces[a].includes(fi)) vertFaces[a].push(fi);
      const key = edgeKey(a, b);
      keys.push(key);
      let edge = edges.get(key);
      if (!edge) { edge = { a: Math.min(a, b), b: Math.max(a, b), faces: [] }; edges.set(key, edge); }
      edge.faces.push(fi);
    }
    faceEdges.push(keys);
  });
  for (const [key, edge] of edges) {
    if (vertEdges[edge.a]) vertEdges[edge.a].push(key);
    if (vertEdges[edge.b]) vertEdges[edge.b].push(key);
  }
  return { edges, vertFaces, vertEdges, faceEdges };
}

//! Which way a face looks. Newell's method, so it is right for an n-gon that
//! is not quite flat - which, on a cage somebody has been pushing about, is
//! every n-gon.
export function faceNormal(mesh, face) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < face.length; i++) {
    const p = mesh.points[face[i]], q = mesh.points[face[(i + 1) % face.length]];
    if (!p || !q) continue;
    x += (p[1] - q[1]) * (p[2] + q[2]);
    y += (p[2] - q[2]) * (p[0] + q[0]);
    z += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return pmUnit([x, y, z]);
}

export const faceCentre = (mesh, face) => pmMid(face.map(i => mesh.points[i]));

//! The area of an n-gon, by the same Newell vector: half its length is the
//! area of the polygon it came from, planar or not quite.
export function faceArea(mesh, face) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < face.length; i++) {
    const p = mesh.points[face[i]], q = mesh.points[face[(i + 1) % face.length]];
    if (!p || !q) continue;
    x += p[1] * q[2] - p[2] * q[1];
    y += p[2] * q[0] - p[0] * q[2];
    z += p[0] * q[1] - p[1] * q[0];
  }
  return pmLen([x, y, z]) / 2;
}

//! A vertex's direction, averaged from the faces on it and weighted by their
//! area, so a vertex between one big face and six slivers points where the big
//! face points.
export function vertexNormals(mesh, topo = topologyOf(mesh)) {
  const normals = mesh.points.map(() => [0, 0, 0]);
  mesh.faces.forEach((face, fi) => {
    const n = faceNormal(mesh, face), w = faceArea(mesh, face) || 1;
    for (const v of face)
      if (normals[v]) {
        normals[v][0] += n[0] * w; normals[v][1] += n[1] * w; normals[v][2] += n[2] * w;
      }
  });
  return normals.map((n, i) => {
    const u = pmUnit(n);
    if (u[0] || u[1] || u[2]) return u;
    // A vertex on no face at all still has to point somewhere.
    const near = topo.vertEdges[i] && topo.vertEdges[i][0];
    if (!near) return [0, 0, 1];
    const [a, b] = edgeEnds(near);
    return pmUnit(pmSub(mesh.points[a === i ? b : a] || [0, 0, 1], mesh.points[i]));
  });
}

export function boundsOf(mesh) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.points)
    for (let k = 0; k < 3; k++) {
      if (p[k] < lo[k]) lo[k] = p[k];
      if (p[k] > hi[k]) hi[k] = p[k];
    }
  return Number.isFinite(lo[0]) ? { lo, hi } : { lo: [0, 0, 0], hi: [0, 0, 0] };
}

//! An edge with one face on it is the edge of a hole. An edge with three is a
//! mesh that will not subdivide and will not sew, and saying which edges those
//! are is most of diagnosing a cage that came out of a file.
export function openEdges(mesh, topo = topologyOf(mesh)) {
  const out = [];
  for (const [key, edge] of topo.edges) if (edge.faces.length === 1) out.push(key);
  return out;
}

export function oddEdges(mesh, topo = topologyOf(mesh)) {
  const out = [];
  for (const [key, edge] of topo.edges) if (edge.faces.length > 2) out.push(key);
  return out;
}

/* ------------------------------------------------------- what an element is

   3ds Max calls a connected lump of faces an ELEMENT, and it is the level
   people reach for most often on an imported model: two boxes in one mesh are
   two elements until you weld them, and one after. So it is not a stored
   property - it is worked out from the topology every time, which is exactly
   why welding changes the count. That is the behaviour, and it falls out of
   doing it this way rather than having to be arranged. */

//! The faces of the mesh, grouped into what is joined to what. Joined means
//! SHARING A VERTEX, not sharing a position: two boxes standing face to face
//! are two elements until the vertices are welded into one.
export function shellsOf(mesh, topo = topologyOf(mesh)) {
  const seen = new Int32Array(mesh.faces.length).fill(-1);
  const shells = [];
  for (let start = 0; start < mesh.faces.length; start++) {
    if (seen[start] >= 0) continue;
    const mark = shells.length, group = [];
    const stack = [start];
    seen[start] = mark;
    while (stack.length) {
      const fi = stack.pop();
      group.push(fi);
      for (const v of mesh.faces[fi])
        for (const other of topo.vertFaces[v] || [])
          if (seen[other] < 0) { seen[other] = mark; stack.push(other); }
    }
    shells.push(group.sort((a, b) => a - b));
  }
  return shells;
}

//! Which element each face is in, for colouring and for picking.
export function shellIndex(mesh, topo = topologyOf(mesh)) {
  const of = new Int32Array(mesh.faces.length).fill(-1);
  shellsOf(mesh, topo).forEach((group, i) => { for (const fi of group) of[fi] = i; });
  return of;
}

//! The open edges, chained into the loops that go round each hole. What a
//! border level selects, and what Fill and Bridge are handed.
export function borderLoops(mesh, topo = topologyOf(mesh)) {
  const open = new Map();
  for (const key of openEdges(mesh, topo)) {
    const [a, b] = edgeEnds(key);
    if (!open.has(a)) open.set(a, []);
    if (!open.has(b)) open.set(b, []);
    open.get(a).push(b);
    open.get(b).push(a);
  }
  const used = new Set();
  const loops = [];
  for (const [start] of open) {
    if (used.has(start)) continue;
    const loop = [];
    let at = start, from = -1;
    while (at !== undefined && !used.has(at)) {
      used.add(at);
      loop.push(at);
      const next = (open.get(at) || []).find(v => v !== from && !used.has(v));
      from = at;
      at = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/* --------------------------------------------------------- the selection

   Three levels plus two, and they are the five every editor of this kind has:
   VERTEX, EDGE, FACE, then BORDER (an open loop, as one thing) and ELEMENT (a
   connected lump). A selection is a level and a set of indices - edge indices
   being keys rather than numbers, because an edge has no number of its own. */

export const MESH_LEVELS = ["vertex", "edge", "face", "border", "element"];

//! The vertices a selection touches, whatever level it was made at. Most of
//! the operations that move things want this and nothing else.
export function vertsOf(mesh, level, items, topo = topologyOf(mesh)) {
  const out = new Set();
  if (level === "vertex") for (const i of items) out.add(+i);
  else if (level === "edge") for (const key of items) for (const v of edgeEnds(key)) out.add(v);
  else if (level === "face") for (const fi of items) for (const v of mesh.faces[fi] || []) out.add(v);
  else if (level === "border") for (const loop of items) for (const v of loop) out.add(+v);
  else if (level === "element") {
    const shells = shellsOf(mesh, topo);
    for (const si of items) for (const fi of shells[si] || []) for (const v of mesh.faces[fi]) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

//! The faces a selection touches. A face is IN when every one of its vertices
//! is, which is the rule Blender uses and the one that makes a box of picked
//! vertices extrude the faces you meant rather than the whole mesh.
export function facesOf(mesh, level, items, topo = topologyOf(mesh)) {
  if (level === "face") return [...items].map(Number).filter(fi => mesh.faces[fi]);
  if (level === "element") {
    const shells = shellsOf(mesh, topo);
    return [...items].flatMap(si => shells[si] || []);
  }
  const verts = new Set(vertsOf(mesh, level, items, topo));
  const out = [];
  mesh.faces.forEach((face, fi) => { if (face.every(v => verts.has(v))) out.push(fi); });
  return out;
}

//! The edges a selection touches, by the same rule.
export function edgesIn(mesh, level, items, topo = topologyOf(mesh)) {
  if (level === "edge") return [...items];
  const verts = new Set(vertsOf(mesh, level, items, topo));
  const out = [];
  for (const [key, edge] of topo.edges)
    if (verts.has(edge.a) && verts.has(edge.b)) out.push(key);
  return out;
}

//! THE EDGE LOOP. Walk off both ends of an edge, at each vertex taking the
//! edge across from the one you came in on - which only exists where four
//! edges meet, so the walk stops by itself at a pole. This is Blender's
//! Alt-click, Maya's double-click, and the single most used selection in
//! subdivision modelling: it is how you pick the line round a shape that you
//! are about to cut, slide or crease.
export function edgeLoop(mesh, key, topo = topologyOf(mesh)) {
  const loop = new Set([key]);
  const across = (vertex, from) => {
    const around = topo.vertEdges[vertex] || [];
    // Four edges at a vertex: the loop carries on across. Anything else is a
    // pole and the loop ends there, which is the rule that makes a loop follow
    // the shape rather than wander into it.
    if (around.length !== 4) return null;
    const fromFaces = new Set(topo.edges.get(from).faces);
    // The one that shares NEITHER face with the edge we arrived on.
    return around.find(other => other !== from
      && !topo.edges.get(other).faces.some(f => fromFaces.has(f))) || null;
  };
  for (const end of edgeEnds(key)) {
    let at = end, from = key;
    for (let guard = 0; guard < 4096; guard++) {
      const next = across(at, from);
      if (!next || loop.has(next)) break;
      loop.add(next);
      const [a, b] = edgeEnds(next);
      at = a === at ? b : a;
      from = next;
    }
  }
  return [...loop];
}

//! THE EDGE RING. Step across each quad to the edge opposite, rather than
//! round each vertex. A ring is what a loop cut is put through, and what a
//! bridge is built between.
export function edgeRing(mesh, key, topo = topologyOf(mesh)) {
  const ring = new Set([key]);
  const opposite = (fi, from) => {
    const face = mesh.faces[fi];
    if (!face || face.length !== 4) return null;
    const keys = topo.faceEdges[fi];
    const at = keys.indexOf(from);
    return at < 0 ? null : keys[(at + 2) % 4];
  };
  const walk = start => {
    let from = key, face = start;
    for (let guard = 0; guard < 4096; guard++) {
      const next = opposite(face, from);
      if (!next || ring.has(next)) break;
      ring.add(next);
      const faces = topo.edges.get(next).faces;
      const on = faces.find(f => f !== face);
      if (on === undefined) break;
      from = next;
      face = on;
    }
  };
  for (const fi of topo.edges.get(key).faces) walk(fi);
  return [...ring];
}

//! A FACE LOOP: the faces a ring of edges runs through. What you get when you
//! double-click a face in Maya, and what an inset or a delete usually wants.
export function faceLoop(mesh, key, topo = topologyOf(mesh)) {
  const seen = new Set();
  for (const edge of edgeRing(mesh, key, topo))
    for (const fi of topo.edges.get(edge).faces) seen.add(fi);
  return [...seen];
}

//! Everything joined to what is picked, at the level it was picked at. L in
//! Blender, and the way you pick one object out of an imported mesh.
export function linkedFrom(mesh, level, items, topo = topologyOf(mesh)) {
  const faces = facesOf(mesh, level, items, topo);
  const shells = shellsOf(mesh, topo);
  const want = new Set();
  const index = shellIndex(mesh, topo);
  for (const fi of faces) want.add(index[fi]);
  const out = [];
  for (const si of want) out.push(...shells[si]);
  return out;
}

//! One step outwards: everything sharing a vertex with what is picked. Ctrl +
//! plus, and the way a selection is grown to a region.
export function growSelection(mesh, level, items, topo = topologyOf(mesh)) {
  const verts = new Set(vertsOf(mesh, level, items, topo));
  const near = new Set(verts);
  for (const v of verts)
    for (const key of topo.vertEdges[v] || [])
      for (const end of edgeEnds(key)) near.add(end);
  if (level === "vertex") return [...near].sort((a, b) => a - b);
  if (level === "edge") {
    const out = [];
    for (const [key, edge] of topo.edges)
      if (near.has(edge.a) && near.has(edge.b)) out.push(key);
    return out;
  }
  const out = [];
  mesh.faces.forEach((face, fi) => { if (face.some(v => verts.has(v))) out.push(fi); });
  return out;
}

//! And one step in: drop whatever is on the edge of the selection.
export function shrinkSelection(mesh, level, items, topo = topologyOf(mesh)) {
  if (level === "vertex") {
    const picked = new Set([...items].map(Number));
    return [...picked].filter(v =>
      (topo.vertEdges[v] || []).every(key => edgeEnds(key).every(e => picked.has(e))))
      .sort((a, b) => a - b);
  }
  if (level === "face") {
    const picked = new Set([...items].map(Number));
    return [...picked].filter(fi =>
      topo.faceEdges[fi].every(key =>
        topo.edges.get(key).faces.every(other => picked.has(other))));
  }
  const picked = new Set(items);
  return [...picked].filter(key => {
    const [a, b] = edgeEnds(key);
    return [a, b].every(v => (topo.vertEdges[v] || []).every(other => picked.has(other)));
  });
}

//! Everything that is not picked, at this level.
export function invertSelection(mesh, level, items, topo = topologyOf(mesh)) {
  const picked = new Set(level === "edge" ? items : [...items].map(Number));
  if (level === "vertex")
    return mesh.points.map((p, i) => i).filter(i => !picked.has(i));
  if (level === "face")
    return mesh.faces.map((f, i) => i).filter(i => !picked.has(i));
  if (level === "element")
    return shellsOf(mesh, topo).map((s, i) => i).filter(i => !picked.has(i));
  return [...topo.edges.keys()].filter(key => !picked.has(key));
}

//! Pick what is like what is picked. Blender's Select Similar, cut to the
//! traits that matter on a cage: how many sides a face has, how many edges
//! meet at a vertex, how long an edge is, which way a face points.
export function similarTo(mesh, level, items, trait, tolerance = 0.02,
                          topo = topologyOf(mesh)) {
  const out = [];
  if (level === "face") {
    const picked = [...items].map(Number).filter(fi => mesh.faces[fi]);
    if (!picked.length) return [];
    if (trait === "sides") {
      const sizes = new Set(picked.map(fi => mesh.faces[fi].length));
      mesh.faces.forEach((f, fi) => { if (sizes.has(f.length)) out.push(fi); });
    } else if (trait === "area") {
      const areas = picked.map(fi => faceArea(mesh, mesh.faces[fi]));
      mesh.faces.forEach((f, fi) => {
        const a = faceArea(mesh, f);
        if (areas.some(b => Math.abs(a - b) <= Math.max(b, a) * tolerance + 1e-9)) out.push(fi);
      });
    } else {
      const ways = picked.map(fi => faceNormal(mesh, mesh.faces[fi]));
      mesh.faces.forEach((f, fi) => {
        const n = faceNormal(mesh, f);
        if (ways.some(w => pmDot(n, w) > 1 - tolerance)) out.push(fi);
      });
    }
    return out;
  }
  if (level === "vertex") {
    const picked = [...items].map(Number);
    const valence = new Set(picked.map(v => (topo.vertEdges[v] || []).length));
    mesh.points.forEach((p, i) => {
      if (valence.has((topo.vertEdges[i] || []).length)) out.push(i);
    });
    return out;
  }
  const picked = [...items];
  const lengthOf = key => {
    const [a, b] = edgeEnds(key);
    return pmLen(pmSub(mesh.points[b], mesh.points[a]));
  };
  if (trait === "faces") {
    const counts = new Set(picked.map(key => topo.edges.get(key).faces.length));
    for (const [key, edge] of topo.edges) if (counts.has(edge.faces.length)) out.push(key);
    return out;
  }
  const lengths = picked.map(lengthOf);
  for (const key of topo.edges.keys()) {
    const l = lengthOf(key);
    if (lengths.some(m => Math.abs(l - m) <= Math.max(l, m) * tolerance + 1e-9)) out.push(key);
  }
  return out;
}

//! Select All by Trait: the four questions worth asking of a cage that came
//! out of a file and will not behave.
export function byTrait(mesh, trait, topo = topologyOf(mesh)) {
  if (trait === "open") return openEdges(mesh, topo);
  if (trait === "odd") return oddEdges(mesh, topo);
  if (trait === "loose")
    return mesh.points.map((p, i) => i).filter(i => !(topo.vertFaces[i] || []).length);
  if (trait === "ngons")
    return mesh.faces.map((f, i) => i).filter(i => mesh.faces[i].length > 4);
  if (trait === "tris")
    return mesh.faces.map((f, i) => i).filter(i => mesh.faces[i].length === 3);
  if (trait === "poles")
    return mesh.points.map((p, i) => i)
      .filter(i => { const n = (topo.vertEdges[i] || []).length; return n && n !== 4; });
  return [];
}

//! Every nth, so a checker of faces can be extruded into a waffle. Blender's
//! Checker Deselect, which sounds like a toy until the first time a facade
//! needs one.
export function checker(items, keep = 1, skip = 1, offset = 0) {
  const period = Math.max(1, keep + skip);
  return [...items].filter((item, i) => ((i + offset) % period) < keep);
}

/* =========================================================== the operations

   Every one takes a mesh and gives back a new one, and every one also says
   what it left selected - because after an extrude what you want selected is
   the new cap, not the face you started from, and an editor that makes you
   re-pick after every operation is an editor nobody finishes a model in.

   The shape of a result is { points, faces, creases, corners, picked, level }.
   \ref applyOps threads them together; the UI reads `picked` to move the
   selection on.                                                             */

//! A mesh under construction: the points and faces so far, with the crease
//! table carried along by KEY rather than by index, so that adding a vertex in
//! the middle of the list does not silently re-point every crease in the mesh.
function building(mesh) {
  const points = mesh.points.map(p => p.slice());
  const faces = [];
  const creases = new Map();
  const corners = new Map();
  for (const [key, t] of Object.entries(mesh.creases || {})) creases.set(key, t);
  for (const [v, t] of Object.entries(mesh.corners || {})) corners.set(+v, t);
  return {
    points, faces, creases, corners,
    add(p) { points.push([p[0], p[1], p[2]]); return points.length - 1; },
    face(list) {
      // A face with a repeated vertex, or fewer than three, is not a face. It
      // arrives from a collapse or a degenerate bevel and it is dropped here
      // rather than being left for the subdivision to trip over.
      const clean = [];
      for (const v of list) if (clean[clean.length - 1] !== v && v !== undefined) clean.push(v);
      while (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
      if (clean.length >= 3) { faces.push(clean); return faces.length - 1; }
      return -1;
    },
    //! An edge that used to be creased, under its new numbering.
    carry(oldA, oldB, newA, newB) {
      const was = creases.get(edgeKey(oldA, oldB));
      if (was !== undefined) creases.set(edgeKey(newA, newB), was);
    },
    done(picked, level) {
      return {
        points, faces,
        creases: Object.fromEntries([...creases].filter(([key]) => {
          const [a, b] = edgeEnds(key);
          return a < points.length && b < points.length;
        })),
        corners: Object.fromEntries([...corners].filter(([v]) => v < points.length)),
        picked: picked || [], level,
      };
    },
  };
}

//! Points moved, nothing else touched. The one operation every drag is.
export function moveVerts(mesh, verts, by) {
  const out = building(mesh);
  const which = new Set([...verts].map(Number));
  out.faces.push(...mesh.faces.map(f => f.slice()));
  for (const v of which)
    if (out.points[v]) out.points[v] = pmAdd(out.points[v], by);
  return out.done([...which], "vertex");
}

//! Each point moved by its own vector - what a gizmo drag on a whole selection
//! becomes once the falloff is worked out, and what a replayed op stores.
export function moveEach(mesh, offsets) {
  const out = building(mesh);
  out.faces.push(...mesh.faces.map(f => f.slice()));
  const touched = [];
  for (const [v, by] of Object.entries(offsets)) {
    const i = +v;
    if (!out.points[i]) continue;
    out.points[i] = pmAdd(out.points[i], by);
    touched.push(i);
  }
  return out.done(touched, "vertex");
}

//! Scale, rotate and move a selection about its own middle - or about a point
//! given. The three transforms are one operation because they are one gizmo.
export function transformVerts(mesh, verts, { move = [0, 0, 0], scale = [1, 1, 1],
                                              turn = [0, 0, 0], about = null } = {}) {
  const which = [...verts].map(Number).filter(v => mesh.points[v]);
  const pivot = about || pmMid(which.map(v => mesh.points[v]));
  const [rx, ry, rz] = turn.map(d => d * Math.PI / 180);
  const spin = p => {
    let [x, y, z] = p;
    let c = Math.cos(rx), s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ry); s = Math.sin(ry);
    [z, x] = [z * c - x * s, z * s + x * c];
    c = Math.cos(rz); s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  };
  const out = building(mesh);
  out.faces.push(...mesh.faces.map(f => f.slice()));
  for (const v of which) {
    const local = pmSub(mesh.points[v], pivot);
    const scaled = [local[0] * scale[0], local[1] * scale[1], local[2] * scale[2]];
    out.points[v] = pmAdd(pmAdd(pivot, spin(scaled)), move);
  }
  return out.done(which, "vertex");
}

//! Along the normals rather than along an axis. Alt-S in Blender, and the
//! operation a shell or a thickness is really made of.
export function shrinkFatten(mesh, verts, amount, topo = topologyOf(mesh)) {
  const normals = vertexNormals(mesh, topo);
  const offsets = {};
  for (const v of [...verts].map(Number)) if (mesh.points[v]) offsets[v] = pmMul(normals[v], amount);
  return moveEach(mesh, offsets);
}

//! Towards a sphere through the selection. A rough way to round a corner off a
//! cage, and the fastest way to make a blocky mass read as a mass.
export function toSphere(mesh, verts, factor = 1) {
  const which = [...verts].map(Number).filter(v => mesh.points[v]);
  const middle = pmMid(which.map(v => mesh.points[v]));
  const radius = which.reduce((sum, v) => sum + pmLen(pmSub(mesh.points[v], middle)), 0)
               / Math.max(1, which.length);
  const offsets = {};
  for (const v of which) {
    const out = pmSub(mesh.points[v], middle);
    const want = pmAdd(middle, pmMul(pmUnit(out), radius));
    offsets[v] = pmMul(pmSub(want, mesh.points[v]), factor);
  }
  return moveEach(mesh, offsets);
}

//! Laplacian smoothing: every picked vertex walks towards the average of its
//! neighbours. Run it a few times and a cage that was drawn by hand settles.
export function smoothVerts(mesh, verts, factor = 0.5, rounds = 1,
                            topo = topologyOf(mesh)) {
  const which = new Set([...verts].map(Number));
  let points = mesh.points.map(p => p.slice());
  for (let round = 0; round < Math.max(1, rounds); round++) {
    const next = points.map(p => p.slice());
    for (const v of which) {
      const around = (topo.vertEdges[v] || []).map(key => {
        const [a, b] = edgeEnds(key);
        return points[a === v ? b : a];
      }).filter(Boolean);
      if (!around.length) continue;
      const want = pmMid(around);
      next[v] = pmAdd(points[v], pmMul(pmSub(want, points[v]), factor));
    }
    points = next;
  }
  const out = building({ ...mesh, points });
  out.faces.push(...mesh.faces.map(f => f.slice()));
  return out.done([...which], "vertex");
}

//! A jolt, per vertex, seeded so that the same op replays the same way. A cage
//! that is too regular reads as a computer drew it; this is the cheapest fix.
export function randomize(mesh, verts, amount = 10, seed = 1) {
  let state = (seed | 0) || 1;
  const random = () => ((state = (state * 48271) % 2147483647) / 2147483647) * 2 - 1;
  const offsets = {};
  for (const v of [...verts].map(Number))
    if (mesh.points[v]) offsets[v] = [random() * amount, random() * amount, random() * amount];
  return moveEach(mesh, offsets);
}

/* --------------------------------------------------------------- extrude */

//! EXTRUDE A REGION OF FACES. The picked faces are lifted, the boundary of the
//! region is walled in, and the old faces go. One extrude for the whole
//! region, so a block of nine faces comes up as one block with one wall round
//! it rather than as nine towers.
//!
//! The direction is the average of what the region faces, unless one is given
//! - and a zero-height extrude is still worth doing, because what you usually
//! want next is to drag the new cap, and that needs the cap to exist.
export function extrudeFaces(mesh, faces, { by = null, distance = 0,
                                            individual = false, alongNormals = false } = {},
                             topo = topologyOf(mesh)) {
  const picked = [...faces].map(Number).filter(fi => mesh.faces[fi]);
  if (!picked.length) return { ...cageOf(mesh), picked: [], level: "face" };
  if (individual) return extrudeIndividual(mesh, picked, distance, topo);

  const out = building(mesh);
  const inRegion = new Set(picked);
  const way = by || pmMul(pmUnit(pmMid(picked.map(fi => faceNormal(mesh, mesh.faces[fi])))),
                          distance);

  // The vertices of the region get a copy each; everything else stays put.
  const lifted = new Map();
  const normals = alongNormals ? vertexNormals(mesh, topo) : null;
  for (const fi of picked)
    for (const v of mesh.faces[fi])
      if (!lifted.has(v))
        lifted.set(v, out.add(pmAdd(mesh.points[v],
          alongNormals ? pmMul(normals[v], distance) : way)));

  // Everything not picked is kept as it was.
  mesh.faces.forEach((face, fi) => { if (!inRegion.has(fi)) out.face(face.slice()); });
  // The picked faces become their own lids.
  for (const fi of picked) out.face(mesh.faces[fi].map(v => lifted.get(v)));
  // And the edges on the rim of the region become the wall.
  const wall = [];
  for (const fi of picked) {
    const face = mesh.faces[fi];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const on = topo.edges.get(edgeKey(a, b)).faces;
      if (on.some(other => !inRegion.has(other)) || on.length === 1)
        wall.push([a, b]);
    }
  }
  for (const [a, b] of wall) {
    out.face([a, b, lifted.get(b), lifted.get(a)]);
    // A creased rim stays creased on the way up: the fold you made is still
    // the fold you meant after the wall was built under it.
    out.carry(a, b, lifted.get(a), lifted.get(b));
  }
  const lids = [];
  for (let i = out.faces.length - picked.length - wall.length; i < out.faces.length - wall.length; i++)
    lids.push(i);
  return out.done(lids, "face");
}

//! Each face on its own, walled in on all four sides. What makes a grid of
//! faces into a grid of boxes in one gesture.
export function extrudeIndividual(mesh, faces, distance, topo = topologyOf(mesh)) {
  const picked = new Set([...faces].map(Number));
  const out = building(mesh);
  mesh.faces.forEach((face, fi) => { if (!picked.has(fi)) out.face(face.slice()); });
  const lids = [];
  for (const fi of picked) {
    const face = mesh.faces[fi];
    const way = pmMul(faceNormal(mesh, face), distance);
    const up = face.map(v => out.add(pmAdd(mesh.points[v], way)));
    lids.push(out.face(up));
    for (let i = 0; i < face.length; i++)
      out.face([face[i], face[(i + 1) % face.length], up[(i + 1) % face.length], up[i]]);
  }
  return out.done(lids, "face");
}

//! Extrude edges into faces. What builds a wall off the rim of an opening, and
//! what a surface is grown from when there is nothing to grow it off yet.
export function extrudeEdges(mesh, edges, by, topo = topologyOf(mesh)) {
  const out = building(mesh);
  out.faces.push(...mesh.faces.map(f => f.slice()));
  const lifted = new Map();
  const lift = v => {
    if (!lifted.has(v)) lifted.set(v, out.add(pmAdd(mesh.points[v], by)));
    return lifted.get(v);
  };
  const made = [];
  for (const key of edges) {
    const [a, b] = edgeEnds(key);
    const up = [lift(a), lift(b)];
    out.face([a, b, up[1], up[0]]);
    made.push(edgeKey(up[0], up[1]));
    out.carry(a, b, up[0], up[1]);
  }
  return out.done(made, "edge");
}

//! Extrude vertices into edges - the way a line is drawn in a mesh editor.
export function extrudeVerts(mesh, verts, by) {
  const out = building(mesh);
  out.faces.push(...mesh.faces.map(f => f.slice()));
  const made = [];
  for (const v of [...verts].map(Number)) {
    if (!mesh.points[v]) continue;
    const up = out.add(pmAdd(mesh.points[v], by));
    // An edge with no face on it cannot be stored in a face list, so it is
    // carried as a degenerate two-sided face and cleaned up by the caller.
    made.push(up);
  }
  return out.done(made, "vertex");
}

/* ----------------------------------------------------------------- inset */

//! INSET: a smaller copy of the face inside it, with a ring of faces between.
//! With a depth it is the same move an opening in a facade is made of - inset,
//! then push in - which is why the two are one operation with two numbers.
//!
//! The region is inset as a region: a block of faces gets one ring round the
//! block, not a ring round each. `individual` gives the other answer.
export function insetFaces(mesh, faces, { thickness = 10, depth = 0,
                                          individual = false } = {},
                           topo = topologyOf(mesh)) {
  const picked = [...faces].map(Number).filter(fi => mesh.faces[fi]);
  if (!picked.length) return { ...cageOf(mesh), picked: [], level: "face" };
  const out = building(mesh);
  const inRegion = new Set(picked);

  if (individual) {
    mesh.faces.forEach((face, fi) => { if (!inRegion.has(fi)) out.face(face.slice()); });
    const inner = [];
    for (const fi of picked) {
      const face = mesh.faces[fi];
      const normal = faceNormal(mesh, face);
      const small = face.map((v, i) => {
        const before = face[(i - 1 + face.length) % face.length];
        const after = face[(i + 1) % face.length];
        const step = bisectorStep(mesh.points[v], mesh.points[before], mesh.points[after],
                                  thickness);
        return out.add(pmAdd(pmAdd(mesh.points[v], step), pmMul(normal, depth)));
      });
      inner.push(out.face(small));
      for (let i = 0; i < face.length; i++)
        out.face([face[i], face[(i + 1) % face.length],
                  small[(i + 1) % face.length], small[i]]);
    }
    return out.done(inner, "face");
  }

  // As a region. The vertices on the rim move in; the ones inside the region
  // stay where they are, so a block of nine keeps its own grid.
  const rim = new Set();
  for (const fi of picked) {
    const face = mesh.faces[fi];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const on = topo.edges.get(edgeKey(a, b)).faces;
      if (on.length === 1 || on.some(other => !inRegion.has(other))) { rim.add(a); rim.add(b); }
    }
  }
  const normal = pmUnit(pmMid(picked.map(fi => faceNormal(mesh, mesh.faces[fi]))));
  // Which way the rim runs at each of its vertices, so the step is off the RIM
  // rather than towards the middle: a long thin region inset towards its centre
  // pinches into a spike, and inset off its own edges stays parallel to them.
  const rimNext = new Map();
  for (const fi of picked) {
    const face = mesh.faces[fi];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const on = topo.edges.get(edgeKey(a, b)).faces;
      if (on.length !== 1 && !on.some(other => !inRegion.has(other))) continue;
      rimNext.set(a, b);
    }
  }
  const rimBack = new Map();
  for (const [a, b] of rimNext) rimBack.set(b, a);
  const moved = new Map();
  for (const v of rim) {
    const before = rimBack.has(v) ? mesh.points[rimBack.get(v)] : null;
    const after = rimNext.has(v) ? mesh.points[rimNext.get(v)] : null;
    const step = before && after
      ? bisectorStep(mesh.points[v], before, after, thickness)
      : pmMul(pmUnit(pmSub(pmMid([...rim].map(k => mesh.points[k])), mesh.points[v])), thickness);
    moved.set(v, out.add(pmAdd(pmAdd(mesh.points[v], step), pmMul(normal, depth))));
  }
  const inside = v => (moved.has(v) ? moved.get(v) : v);
  mesh.faces.forEach((face, fi) => { if (!inRegion.has(fi)) out.face(face.slice()); });
  const lids = [];
  for (const fi of picked) lids.push(out.face(mesh.faces[fi].map(inside)));
  for (const fi of picked) {
    const face = mesh.faces[fi];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      if (!moved.has(a) || !moved.has(b)) continue;
      const on = topo.edges.get(edgeKey(a, b)).faces;
      if (on.length !== 1 && !on.some(other => !inRegion.has(other))) continue;
      out.face([a, b, moved.get(b), moved.get(a)]);
    }
  }
  return out.done(lids, "face");
}

//! HOW FAR ALONG THE BISECTOR a corner has to move for the edges either side of
//! it to come in by `thickness`. On a right-angled corner that is thickness x
//! root two; on a sharp one it is a long way, which is why a spike insets into
//! a needle and why the answer has to be the bisector rather than the diagonal
//! to the middle.
function bisectorStep(at, before, after, thickness) {
  const a = pmUnit(pmSub(before, at)), b = pmUnit(pmSub(after, at));
  const bisector = pmUnit(pmAdd(a, b));
  if (!bisector[0] && !bisector[1] && !bisector[2]) return [0, 0, 0];
  // The sine of half the corner angle: how much of a step along the bisector
  // shows up as a step away from either edge.
  const half = Math.sqrt(Math.max(1e-6, (1 - pmDot(a, b)) / 2));
  return pmMul(bisector, Math.min(thickness / half, 1e6));
}

/* ----------------------------------------------------------------- bevel */

//! BEVEL EDGES. Every picked edge becomes a strip; the corners where picked
//! edges meet become an n-gon. The workhorse of hard-surface modelling and,
//! on a cage, the way a fold is given a width rather than a crease.
//!
//! Done by CORNER SPLITTING, which is the way that survives an n-gon: each
//! face keeps its own copy of a bevelled vertex, pulled in along the two edges
//! of that face, and the strips and caps are built between the copies. No
//! offset surface, no self-intersection tests - a cage does not want them.
export function bevelEdges(mesh, edges, { width = 5, segments = 1 } = {},
                           topo = topologyOf(mesh)) {
  const picked = new Set([...edges].filter(key => topo.edges.has(key)));
  if (!picked.size) return { ...cageOf(mesh), picked: [], level: "edge" };
  const out = building(mesh);
  const hot = new Set();
  for (const key of picked) for (const v of edgeEnds(key)) hot.add(v);

  // EVERY NEW POINT IS NAMED BY WHAT PULLED IT THERE, not by which face it is
  // in - a vertex pulled back along one edge is the SAME point whichever of
  // the faces on that edge is asking for it. Naming them per face instead
  // leaves two coincident points where the cap meets the strip, and a cage
  // that looks right and is torn.
  const made = new Map();
  const pointAt = (v, along) => {
    const name = v + "/" + along;
    if (made.has(name)) return made.get(name);
    const to = along === "" ? null : Number(along);
    const step = to === null ? [0, 0, 0]
      : pmMul(pmUnit(pmSub(mesh.points[to], mesh.points[v])),
              Math.min(width, pmLen(pmSub(mesh.points[to], mesh.points[v])) * 0.45));
    made.set(name, out.add(pmAdd(mesh.points[v], step)));
    return made.get(name);
  };
  // Where both of a face's edges at a corner are bevelled, the corner goes to
  // the intersection of the two pulled-back lines, which is its own point.
  const inner = new Map();
  const cornerAt = (fi, v, before, after) => {
    const name = fi + ":" + v;
    if (inner.has(name)) return inner.get(name);
    const one = pmUnit(pmSub(mesh.points[before], mesh.points[v]));
    const two = pmUnit(pmSub(mesh.points[after], mesh.points[v]));
    inner.set(name, out.add(pmAdd(mesh.points[v],
      pmAdd(pmMul(one, width), pmMul(two, width)))));
    return inner.get(name);
  };

  //! What a face's corner becomes: nothing, one point, or two.
  //!
  //! A BEVELLED EDGE PULLS THE FACE BACK OFF ITSELF. So a corner beside a
  //! bevelled edge moves along the face's OTHER edge - away from the bevel -
  //! and a corner with a bevelled edge running out of the face altogether is
  //! cut off, becoming two points, one down each of the face's edges. That
  //! second case is the one that turns the top of a box into an octagon when
  //! its four uprights are bevelled, and getting it wrong is the difference
  //! between a bevel and a shrunken face.
  const cornerOf = (fi, face, i) => {
    const v = face[i];
    if (!hot.has(v)) return [v];
    const before = face[(i - 1 + face.length) % face.length];
    const after = face[(i + 1) % face.length];
    const backBevelled = picked.has(edgeKey(v, before));
    const onBevelled = picked.has(edgeKey(v, after));
    if (backBevelled && onBevelled) return [cornerAt(fi, v, before, after)];
    if (backBevelled) return [pointAt(v, String(after))];
    if (onBevelled) return [pointAt(v, String(before))];
    // Nothing of this face is bevelled at v, but something else at v is: the
    // corner is sliced off.
    const elsewhere = (topo.vertEdges[v] || []).some(key => picked.has(key));
    if (!elsewhere) return [v];
    return [pointAt(v, String(before)), pointAt(v, String(after))];
  };

  mesh.faces.forEach((face, fi) => {
    const walk = [];
    for (let i = 0; i < face.length; i++) walk.push(...cornerOf(fi, face, i));
    out.face(walk);
  });

  // A STRIP along each bevelled edge, between the two faces on it. Each face
  // gives the strip its own corner point at each end of the edge.
  const sideOf = (fi, v) => {
    const face = mesh.faces[fi];
    const i = face.indexOf(v);
    const got = cornerOf(fi, face, i);
    return got[got.length - 1] === undefined ? got[0] : got[0];
  };
  const strips = [];
  for (const key of picked) {
    const edge = topo.edges.get(key);
    if (edge.faces.length !== 2) continue;
    const [f1, f2] = edge.faces;
    // WHICH WAY ROUND. The strip has to be wound the way the face beside it is
    // wound, and which of the two faces the topology listed first is an
    // accident. Take the first one's own direction along the edge, and the
    // strip comes out facing the same way as the mesh it is joining - get this
    // wrong and half the bevels on a box are inside out, which shades as a
    // black patch and measures as a hole in the volume.
    const one = mesh.faces[f1];
    const at = one.indexOf(edge.a);
    const forward = at >= 0 && one[(at + 1) % one.length] === edge.b;
    // ...and the strip runs AGAINST that direction, because it lies on the far
    // side of the edge from the face whose winding named it.
    const [x, y] = forward ? [edge.b, edge.a] : [edge.a, edge.b];
    const corners = [[f1, x], [f1, y], [f2, y], [f2, x]].map(([fi, v]) => sideOf(fi, v));
    if (corners.some(v => v === undefined)) continue;
    strips.push({ key, a: x, b: y, corners });
  }
  const kept = [];
  for (const { key, a, b, corners } of strips) {
    const [p0, p1, p2, p3] = corners;
    if (segments <= 1) {
      out.face([p0, p1, p2, p3]);
      kept.push(edgeKey(p0, p1));
      out.carry(a, b, p0, p1);
      continue;
    }
    // More than one segment: the strip is cut across, and the middle rows are
    // pushed out towards where the edge was, so it reads as a round rather
    // than as a chamfer.
    const rows = [[p0, p1]];
    for (let seg = 1; seg < segments; seg++) {
      const t = seg / segments;
      const bulge = Math.sin(t * Math.PI) * 0.22;
      const left = pmAdd(out.points[p0], pmMul(pmSub(out.points[p3], out.points[p0]), t));
      const right = pmAdd(out.points[p1], pmMul(pmSub(out.points[p2], out.points[p1]), t));
      rows.push([out.add(pmAdd(left, pmMul(pmSub(mesh.points[a], left), bulge))),
                 out.add(pmAdd(right, pmMul(pmSub(mesh.points[b], right), bulge)))]);
    }
    rows.push([p3, p2]);
    for (let seg = 0; seg + 1 < rows.length; seg++)
      out.face([rows[seg][0], rows[seg][1], rows[seg + 1][1], rows[seg + 1][0]]);
    kept.push(edgeKey(rows[0][0], rows[0][1]));
  }

  // And a cap where THREE OR MORE bevelled edges meet, which is the only case
  // that leaves a hole: two leave a strip that closes itself, and one leaves
  // the sliced corner the faces either side already filled in.
  for (const v of hot) {
    const hotEdges = (topo.vertEdges[v] || []).filter(key => picked.has(key));
    if (hotEdges.length < 3) continue;
    const around = orderFacesAround(mesh, v, topo.vertFaces[v] || [], topo);
    const ring = around.map(fi => sideOf(fi, v)).filter(p => p !== undefined);
    if (ring.length < 3) continue;
    // Facing the way the vertex faced, or the cap is a hole in the shading.
    const was = pmMid((topo.vertFaces[v] || []).map(fi => faceNormal(mesh, mesh.faces[fi])));
    const now = faceNormal({ points: out.points }, ring);
    out.face(pmDot(now, was) < 0 ? [...ring].reverse() : ring);
  }
  // The original corners are not in anything any more: a bevel replaces them.
  return { ...dropLoose(out.done(kept, "edge")), picked: kept, level: "edge" };
}

//! The faces round a vertex, in the order they actually go round it, by
//! walking face to face across the shared edges. A fan that does not close -
//! a vertex on the rim of a hole - comes back in one run, which is right.
function orderFacesAround(mesh, vertex, faces, topo) {
  const set = new Set(faces);
  const next = fi => {
    const face = mesh.faces[fi];
    const at = face.indexOf(vertex);
    if (at < 0) return null;
    const after = face[(at + 1) % face.length];
    const on = topo.edges.get(edgeKey(vertex, after)).faces;
    return on.find(other => other !== fi && set.has(other));
  };
  const order = [];
  let at = faces[0];
  for (let guard = 0; guard < faces.length + 1 && at !== undefined && at !== null; guard++) {
    if (order.includes(at)) break;
    order.push(at);
    at = next(at);
  }
  for (const fi of faces) if (!order.includes(fi)) order.push(fi);
  return order;
}

//! BEVEL VERTICES: each picked vertex opens into a face. The way a corner is
//! knocked off without touching the edges running into it.
export function bevelVerts(mesh, verts, width = 5, topo = topologyOf(mesh)) {
  const hot = new Set([...verts].map(Number).filter(v => mesh.points[v]));
  if (!hot.size) return { ...cageOf(mesh), picked: [], level: "vertex" };
  const out = building(mesh);
  const copy = new Map();
  mesh.faces.forEach((face, fi) => {
    for (let i = 0; i < face.length; i++) {
      const v = face[i];
      if (!hot.has(v)) continue;
      const before = face[(i - 1 + face.length) % face.length];
      const after = face[(i + 1) % face.length];
      let at = mesh.points[v];
      for (const other of [before, after]) {
        const along = pmSub(mesh.points[other], mesh.points[v]);
        at = pmAdd(at, pmMul(pmUnit(along), Math.min(width, pmLen(along) * 0.45) / 2));
      }
      copy.set(fi + "," + v, out.add(at));
    }
  });
  mesh.faces.forEach((face, fi) =>
    out.face(face.map(v => (hot.has(v) ? copy.get(fi + "," + v) : v))));
  const made = [];
  for (const v of hot) {
    const around = (topo.vertFaces[v] || []).filter(fi => copy.has(fi + "," + v));
    if (around.length < 3) continue;
    made.push(out.face(orderFacesAround(mesh, v, around, topo).map(fi => copy.get(fi + "," + v))));
  }
  return out.done(made.filter(i => i >= 0), "face");
}

/* ------------------------------------------------------- cutting it up */

//! SUBDIVIDE EDGES. Every picked edge gets cuts put in it, and every face that
//! had a cut edge is rebuilt round the new points. A face with all its edges
//! cut once becomes a proper grid; a face with some of them cut becomes an
//! n-gon, which is the honest answer and what Blender does too.
export function subdivideEdges(mesh, edges, cuts = 1, topo = topologyOf(mesh)) {
  const n = Math.max(1, Math.round(cuts));
  const picked = new Set([...edges].filter(key => topo.edges.has(key)));
  if (!picked.size) return { ...cageOf(mesh), picked: [], level: "edge" };
  const out = building(mesh);
  // The new points along each cut edge, stored from the low index up.
  const along = new Map();
  for (const key of picked) {
    const [a, b] = edgeEnds(key);
    const made = [];
    for (let i = 1; i <= n; i++)
      made.push(out.add(pmAdd(mesh.points[a],
        pmMul(pmSub(mesh.points[b], mesh.points[a]), i / (n + 1)))));
    along.set(key, made);
    // A cut edge keeps its crease on every piece of itself.
    const was = out.creases.get(key);
    if (was !== undefined) {
      const chain = [a, ...made, b];
      for (let i = 0; i + 1 < chain.length; i++) out.creases.set(edgeKey(chain[i], chain[i + 1]), was);
      out.creases.delete(key);
    }
  }
  const made = [];
  mesh.faces.forEach((face, fi) => {
    const walk = [];
    let cut = false;
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      walk.push(a);
      const key = edgeKey(a, b);
      const points = along.get(key);
      if (!points) continue;
      cut = true;
      // Walked in the face's own direction, which may be against the key's.
      walk.push(...(a < b ? points : [...points].reverse()));
    }
    if (!cut) { out.face(face.slice()); return; }
    // A QUAD WITH EVERY EDGE CUT becomes a grid rather than one big n-gon,
    // because that is what anybody who asked for a subdivide wanted.
    if (face.length === 4 && face.every((v, i) =>
        along.has(edgeKey(v, face[(i + 1) % 4])))) {
      gridBetween(out, mesh, face, along, n);
      return;
    }
    made.push(out.face(walk));
  });
  return out.done(made.filter(i => i >= 0), "face");
}

//! A quad whose four sides are all cut the same number of times, filled with
//! the grid that implies. Bilinear inside, which is what a cage wants: the
//! smoothing is the subdivision's job, not the cutting's.
function gridBetween(out, mesh, face, along, n) {
  const side = (a, b) => {
    const points = along.get(edgeKey(a, b));
    return a < b ? points : [...points].reverse();
  };
  const [v0, v1, v2, v3] = face;
  const bottom = [v0, ...side(v0, v1), v1];
  const right = [v1, ...side(v1, v2), v2];
  const top = [v3, ...side(v3, v2), v2];
  const left = [v0, ...side(v0, v3), v3];
  const rows = [];
  for (let j = 0; j <= n + 1; j++) {
    const row = [];
    for (let i = 0; i <= n + 1; i++) {
      if (j === 0) { row.push(bottom[i]); continue; }
      if (j === n + 1) { row.push(top[i]); continue; }
      if (i === 0) { row.push(left[j]); continue; }
      if (i === n + 1) { row.push(right[j]); continue; }
      const u = i / (n + 1), v = j / (n + 1);
      const p = pmAdd(
        pmAdd(pmMul(mesh.points[v0], (1 - u) * (1 - v)), pmMul(mesh.points[v1], u * (1 - v))),
        pmAdd(pmMul(mesh.points[v2], u * v), pmMul(mesh.points[v3], (1 - u) * v)));
      row.push(out.add(p));
    }
    rows.push(row);
  }
  for (let j = 0; j < n + 1; j++)
    for (let i = 0; i < n + 1; i++)
      out.face([rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]]);
}

//! A LOOP CUT: the ring of edges through a quad strip, cut across, with the
//! new loop slid along if you want it off centre. Ctrl+R, and after extrude
//! the operation a subdivision model is mostly made of - it is how you tell a
//! smooth surface where to hold its shape.
export function loopCut(mesh, seedEdge, { cuts = 1, offset = 0 } = {},
                        topo = topologyOf(mesh)) {
  const ring = edgeRing(mesh, seedEdge, topo);
  if (!ring.length) return { ...cageOf(mesh), picked: [], level: "edge" };
  const n = Math.max(1, Math.round(cuts));
  // Where along each edge the cuts go. One cut can be slid; several are spread.
  const at = [];
  for (let i = 1; i <= n; i++)
    at.push(n === 1 ? Math.min(0.98, Math.max(0.02, 0.5 + offset / 2)) : i / (n + 1));
  const out = building(mesh);
  const along = new Map();
  for (const key of ring) {
    const [a, b] = edgeEnds(key);
    along.set(key, at.map(t => out.add(pmAdd(mesh.points[a],
      pmMul(pmSub(mesh.points[b], mesh.points[a]), t)))));
    const was = out.creases.get(key);
    if (was !== undefined) {
      const chain = [a, ...along.get(key), b];
      for (let i = 0; i + 1 < chain.length; i++) out.creases.set(edgeKey(chain[i], chain[i + 1]), was);
      out.creases.delete(key);
    }
  }
  const cutSet = new Set(ring);
  const made = [];
  mesh.faces.forEach((face, fi) => {
    const sides = topo.faceEdges[fi].map((key, i) => (cutSet.has(key) ? i : -1))
                      .filter(i => i >= 0);
    // A quad cut on two opposite sides splits into n+1 quads across. Anything
    // else the ring touched is left as an n-gon with the new points in its rim,
    // which keeps the mesh watertight where the ring ends.
    if (face.length === 4 && sides.length === 2 && (sides[1] - sides[0]) === 2) {
      const first = sides[0];
      const a = face[first], b = face[(first + 1) % 4];
      const c = face[(first + 2) % 4], d = face[(first + 3) % 4];
      const one = orderedAlong(along, a, b), two = orderedAlong(along, c, d);
      let left = [a, d];
      for (let i = 0; i < n; i++) {
        const right = [one[i], two[n - 1 - i]];
        made.push(out.face([left[0], right[0], right[1], left[1]]));
        left = right;
      }
      out.face([left[0], b, c, left[1]]);
      return;
    }
    if (!sides.length) { out.face(face.slice()); return; }
    const walk = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      walk.push(a);
      const points = along.get(edgeKey(a, b));
      if (points) walk.push(...orderedAlong(along, a, b));
    }
    out.face(walk);
  });
  // What is left selected is the new loop, which is what you slide next.
  const loop = [];
  for (const points of along.values())
    for (let i = 0; i + 1 < points.length; i++) loop.push(edgeKey(points[i], points[i + 1]));
  return out.done(loop.length ? loop : ring, "edge");
}

//! The cut points on an edge, in the direction a to b.
function orderedAlong(along, a, b) {
  const points = along.get(edgeKey(a, b)) || [];
  return a < b ? points : [...points].reverse();
}

//! UN-SUBDIVIDE, after a fashion: dissolve every other edge loop. What is
//! really wanted is the inverse of Catmull-Clark and there isn't one, so this
//! does the honest thing - drops the edges whose two faces can be merged into
//! a quad - which on a once-subdivided cage gives the cage back.
export function unSubdivide(mesh, topo = topologyOf(mesh)) {
  const drop = new Set();
  const used = new Set();
  for (const [key, edge] of topo.edges) {
    if (edge.faces.length !== 2) continue;
    const [f1, f2] = edge.faces;
    if (used.has(f1) || used.has(f2)) continue;
    if (mesh.faces[f1].length !== 4 || mesh.faces[f2].length !== 4) continue;
    if (mesh.creases && mesh.creases[key] !== undefined) continue;
    drop.add(key);
    used.add(f1); used.add(f2);
  }
  return dissolveEdges(mesh, [...drop], topo);
}

//! BRIDGE two loops of edges with a strip of quads. What closes the gap
//! between two openings, and what makes a tube out of two rings.
export function bridgeLoops(mesh, edges, { twist = 0, flip = false } = {},
                            topo = topologyOf(mesh)) {
  const rings = chainEdges([...edges]);
  if (rings.length < 2) return { ...cageOf(mesh), picked: [], level: "face" };
  const out = building(mesh);
  out.faces.push(...mesh.faces.map(f => f.slice()));
  const made = [];
  for (let r = 0; r + 1 < rings.length; r += 2) {
    let one = rings[r], two = rings[r + 1];
    if (one.length !== two.length) {
      // Unequal loops: the shorter one is resampled onto the longer, which is
      // what lets a six-sided opening bridge to an eight-sided one.
      two = resampleRing(mesh, two, one.length);
    }
    // Line the second loop up with the first: start at the vertex nearest the
    // first loop's start, and go round the way that does not cross over.
    const start = nearestIn(mesh, mesh.points[one[0]], two);
    let ordered = two.slice(start).concat(two.slice(0, start));
    if (flip) ordered = [ordered[0], ...ordered.slice(1).reverse()];
    if (twist) {
      const t = ((Math.round(twist) % ordered.length) + ordered.length) % ordered.length;
      ordered = ordered.slice(t).concat(ordered.slice(0, t));
    }
    for (let i = 0; i < one.length; i++) {
      const a = one[i], b = one[(i + 1) % one.length];
      const c = ordered[(i + 1) % ordered.length], d = ordered[i];
      made.push(out.face([a, b, c, d]));
    }
  }
  return out.done(made.filter(i => i >= 0), "face");
}

//! Loose edges chained into the rings they form. A bridge is handed two
//! openings as one set of edges and has to tell which is which.
function chainEdges(edges) {
  const near = new Map();
  for (const key of edges) {
    const [a, b] = edgeEnds(key);
    if (!near.has(a)) near.set(a, []);
    if (!near.has(b)) near.set(b, []);
    near.get(a).push(b);
    near.get(b).push(a);
  }
  const seen = new Set();
  const rings = [];
  for (const [start] of near) {
    if (seen.has(start)) continue;
    const ring = [];
    let at = start, from = -1;
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      ring.push(at);
      const next = (near.get(at) || []).find(v => v !== from && !seen.has(v));
      from = at;
      at = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

//! A ring walked at even spacing into a different number of vertices. Used
//! only to bridge openings that do not match; the points are new.
function resampleRing(mesh, ring, want) {
  const points = ring.map(v => mesh.points[v]);
  const lengths = points.map((p, i) => pmLen(pmSub(points[(i + 1) % points.length], p)));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const out = [];
  for (let i = 0; i < want; i++) {
    let walk = (i / want) * total;
    let at = 0;
    while (walk > lengths[at] && at < lengths.length - 1) { walk -= lengths[at]; at++; }
    out.push(ring[at]);
  }
  return out;
}

const nearestIn = (mesh, point, ring) => {
  let best = 0, far = Infinity;
  ring.forEach((v, i) => {
    const d = pmLen(pmSub(mesh.points[v], point));
    if (d < far) { far = d; best = i; }
  });
  return best;
};

//! BISECT: cut the mesh with a plane. The knife that is worth having on a
//! cage - an interactive knife draws where the mouse went, and where the mouse
//! went is never where a building wants a line. A plane is.
//!
//! Faces the plane crosses are split in two along it; faces wholly on one side
//! are kept as they are. Optionally one side is thrown away, which is how a
//! symmetrical model is cut in half before being mirrored.
export function bisect(mesh, { origin = [0, 0, 0], normal = [0, 0, 1],
                               clear = 0, fill = false } = {}) {
  const side = p => pmDot(pmSub(p, origin), normal);
  const out = building(mesh);
  const on = new Map();                     // edge key -> the point on the plane
  const cutAt = (a, b) => {
    const key = edgeKey(a, b);
    if (on.has(key)) return on.get(key);
    const sa = side(mesh.points[a]), sb = side(mesh.points[b]);
    const t = sa / (sa - sb);
    const at = out.add(pmAdd(mesh.points[a], pmMul(pmSub(mesh.points[b], mesh.points[a]), t)));
    on.set(key, at);
    return at;
  };
  const eps = 1e-7;
  const openings = [];
  for (const face of mesh.faces) {
    const signs = face.map(v => side(mesh.points[v]));
    const above = signs.some(s => s > eps), below = signs.some(s => s < -eps);
    if (!above || !below) {
      // Wholly on one side. Keep it unless this side is the one being cleared.
      const which = above ? 1 : below ? -1 : 0;
      if (clear && which === clear) continue;
      out.face(face.slice());
      continue;
    }
    const upper = [], lower = [], seam = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const sa = signs[i], sb = signs[(i + 1) % face.length];
      if (sa >= -eps) upper.push(a);
      if (sa <= eps) lower.push(a);
      if ((sa > eps && sb < -eps) || (sa < -eps && sb > eps)) {
        const mid = cutAt(a, b);
        upper.push(mid);
        lower.push(mid);
        seam.push(mid);
      }
    }
    if (seam.length === 2) openings.push(seam);
    if (clear !== 1) out.face(upper);
    if (clear !== -1) out.face(lower);
  }
  if (fill && openings.length)
    for (const loop of chainEdges(openings.map(([a, b]) => edgeKey(a, b))))
      if (loop.length >= 3) out.face(loop);
  const cut = out.done([], "face");
  // A cleared half leaves its vertices behind in the point list: they are in
  // nothing, they are invisible, and they still count when anything asks how
  // big the mesh is. Take them out.
  return clear ? { ...dropLoose(cut), picked: [], level: "face" } : cut;
}

//! POKE: a vertex in the middle of each face, fanned out to its corners. The
//! way an n-gon is turned into triangles that all meet in the middle, and the
//! start of a spike or a dome.
export function pokeFaces(mesh, faces, offset = 0) {
  const picked = new Set([...faces].map(Number));
  const out = building(mesh);
  const made = [];
  mesh.faces.forEach((face, fi) => {
    if (!picked.has(fi)) { out.face(face.slice()); return; }
    const centre = pmAdd(faceCentre(mesh, face), pmMul(faceNormal(mesh, face), offset));
    const hub = out.add(centre);
    for (let i = 0; i < face.length; i++)
      made.push(out.face([face[i], face[(i + 1) % face.length], hub]));
  });
  return out.done(made.filter(i => i >= 0), "face");
}

//! Triangulate: fan for a convex n-gon, which on a cage is all of them.
export function triangulate(mesh, faces) {
  const picked = new Set([...faces].map(Number));
  const out = building(mesh);
  const made = [];
  mesh.faces.forEach((face, fi) => {
    if (!picked.has(fi) || face.length <= 3) { out.face(face.slice()); return; }
    for (let i = 1; i + 1 < face.length; i++)
      made.push(out.face([face[0], face[i], face[i + 1]]));
  });
  return out.done(made.filter(i => i >= 0), "face");
}

//! Triangles back into quads, by pairing each triangle with the neighbour it
//! makes the squarest quad with. A tessellated import is triangles, and a
//! triangle cage subdivides into a mess - so this is the operation that makes
//! an imported model editable.
export function quadrangulate(mesh, faces, limit = 40, topo = topologyOf(mesh)) {
  const picked = new Set([...faces].map(Number).filter(fi => mesh.faces[fi].length === 3));
  const cos = Math.cos(limit * Math.PI / 180);
  const pairs = [];
  const taken = new Set();
  // Every shared edge between two picked triangles, best first.
  const candidates = [];
  for (const [key, edge] of topo.edges) {
    if (edge.faces.length !== 2) continue;
    const [f1, f2] = edge.faces;
    if (!picked.has(f1) || !picked.has(f2)) continue;
    if (pmDot(faceNormal(mesh, mesh.faces[f1]), faceNormal(mesh, mesh.faces[f2])) < cos) continue;
    candidates.push({ key, f1, f2, quality: quadQuality(mesh, mesh.faces[f1], mesh.faces[f2], key) });
  }
  candidates.sort((a, b) => b.quality - a.quality);
  for (const c of candidates) {
    if (taken.has(c.f1) || taken.has(c.f2)) continue;
    taken.add(c.f1); taken.add(c.f2);
    pairs.push(c);
  }
  const out = building(mesh);
  const made = [];
  mesh.faces.forEach((face, fi) => { if (!taken.has(fi)) out.face(face.slice()); });
  for (const { f1, f2, key } of pairs) {
    const [a, b] = edgeEnds(key);
    const one = mesh.faces[f1], two = mesh.faces[f2];
    const apex = one.find(v => v !== a && v !== b);
    const other = two.find(v => v !== a && v !== b);
    // Wound from the first triangle, so the quad faces the way they did.
    const at = one.indexOf(apex);
    const next = one[(at + 1) % 3];
    made.push(next === a ? out.face([apex, a, other, b]) : out.face([apex, b, other, a]));
  }
  return out.done(made.filter(i => i >= 0), "face");
}

//! How square the quad two triangles would make is: 1 for a square, 0 for a
//! sliver. The measure is the worst corner's departure from a right angle.
function quadQuality(mesh, one, two, key) {
  const [a, b] = edgeEnds(key);
  const apex = one.find(v => v !== a && v !== b);
  const other = two.find(v => v !== a && v !== b);
  if (apex === undefined || other === undefined) return -1;
  const quad = [apex, a, other, b].map(v => mesh.points[v]);
  let worst = 1;
  for (let i = 0; i < 4; i++) {
    const before = pmUnit(pmSub(quad[(i + 3) % 4], quad[i]));
    const after = pmUnit(pmSub(quad[(i + 1) % 4], quad[i]));
    worst = Math.min(worst, 1 - Math.abs(pmDot(before, after)));
  }
  return worst;
}

/* -------------------------------------------------- taking things away

   DISSOLVE and DELETE are different operations and the difference matters.
   Delete takes the geometry away and leaves a hole. Dissolve takes the
   geometry away and merges what was round it, leaving the surface closed. On a
   cage you nearly always want dissolve, which is why Blender gave it its own
   key, and why both are here.                                              */

//! Dissolve edges: the faces either side of each picked edge become one face.
export function dissolveEdges(mesh, edges, topo = topologyOf(mesh)) {
  const drop = new Set([...edges].filter(key => topo.edges.has(key)
    && topo.edges.get(key).faces.length === 2));
  if (!drop.size) return { ...cageOf(mesh), picked: [], level: "edge" };
  // Which faces merge with which: a union-find over the dropped edges.
  const parent = mesh.faces.map((f, i) => i);
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const key of drop) {
    const [f1, f2] = topo.edges.get(key).faces;
    const a = root(f1), b = root(f2);
    if (a !== b) parent[a] = b;
  }
  const groups = new Map();
  mesh.faces.forEach((face, fi) => {
    const r = root(fi);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(fi);
  });
  const out = building(mesh);
  const made = [];
  for (const group of groups.values()) {
    if (group.length === 1) { made.push(out.face(mesh.faces[group[0]].slice())); continue; }
    // The rim of the group: every edge of it with only one face in the group.
    const count = new Map();
    for (const fi of group)
      for (const key of topo.faceEdges[fi]) count.set(key, (count.get(key) || 0) + 1);
    const rim = [...count].filter(([key, n]) => n === 1).map(([key]) => key);
    const loops = chainEdges(rim);
    // One loop is a face; several means the group had a hole in it, and the
    // biggest loop is the outside of it.
    if (!loops.length) continue;
    loops.sort((a, b) => b.length - a.length);
    made.push(out.face(loops[0]));
  }
  for (const key of drop) out.creases.delete(key);
  return out.done(made.filter(i => i >= 0), "face");
}

//! Dissolve vertices: the faces round each picked vertex become one, and the
//! vertex goes. What takes a pole out of a cage.
export function dissolveVerts(mesh, verts, topo = topologyOf(mesh)) {
  const drop = new Set([...verts].map(Number));
  const around = new Set();
  for (const v of drop) for (const key of topo.vertEdges[v] || []) around.add(key);
  const merged = dissolveEdges(mesh, [...around].filter(key =>
    topo.edges.get(key).faces.length === 2), topo);
  // And then the vertex itself, which is now inside one face.
  return dropVerts(merged, [...drop]);
}

//! Dissolve faces: a block of faces becomes one face.
export function dissolveFaces(mesh, faces, topo = topologyOf(mesh)) {
  const picked = new Set([...faces].map(Number));
  const inside = [];
  for (const [key, edge] of topo.edges)
    if (edge.faces.length === 2 && edge.faces.every(fi => picked.has(fi))) inside.push(key);
  return dissolveEdges(mesh, inside, topo);
}

//! Vertices out of the point list, with every face renumbered and any face
//! that lost too much dropped.
function dropVerts(mesh, verts) {
  const drop = new Set([...verts].map(Number));
  const renumber = new Int32Array(mesh.points.length).fill(-1);
  const points = [];
  mesh.points.forEach((p, i) => {
    if (drop.has(i)) return;
    renumber[i] = points.length;
    points.push(p.slice());
  });
  const faces = [];
  for (const face of mesh.faces) {
    const kept = face.filter(v => !drop.has(v)).map(v => renumber[v]);
    if (kept.length >= 3) faces.push(kept);
  }
  const creases = {};
  for (const [key, t] of Object.entries(mesh.creases || {})) {
    const [a, b] = edgeEnds(key);
    if (drop.has(a) || drop.has(b)) continue;
    creases[edgeKey(renumber[a], renumber[b])] = t;
  }
  const corners = {};
  for (const [v, t] of Object.entries(mesh.corners || {}))
    if (!drop.has(+v)) corners[renumber[+v]] = t;
  return { points, faces, creases, corners, picked: [], level: "vertex" };
}

//! Anything with no face on it, gone. Run after every delete, because a
//! loose vertex is invisible and breaks a sew.
export function dropLoose(mesh) {
  const topo = topologyOf(mesh);
  const loose = mesh.points.map((p, i) => i).filter(i => !(topo.vertFaces[i] || []).length);
  return loose.length ? dropVerts(mesh, loose) : { ...cageOf(mesh), picked: [], level: "vertex" };
}

//! DELETE, at each level, leaving the hole. `only` deletes the faces and keeps
//! their vertices and edges, which is Blender's "Only Faces" and what you want
//! before a re-bridge.
export function deleteAt(mesh, level, items, { only = false } = {},
                         topo = topologyOf(mesh)) {
  if (level === "face" || level === "element") {
    const faces = new Set(facesOf(mesh, level, items, topo));
    const out = { ...cageOf(mesh) };
    out.faces = mesh.faces.filter((f, fi) => !faces.has(fi));
    return only ? { ...out, picked: [], level: "face" } : dropLoose(out);
  }
  if (level === "edge") {
    const drop = new Set(items);
    const out = { ...cageOf(mesh) };
    out.faces = mesh.faces.filter((face, fi) =>
      !topo.faceEdges[fi].some(key => drop.has(key)));
    for (const key of drop) delete out.creases[key];
    return dropLoose(out);
  }
  return dropVerts(mesh, vertsOf(mesh, level, items, topo));
}

/* ------------------------------------------------------------- welding */

//! MERGE BY DISTANCE. Vertices closer together than a tolerance become one,
//! and a face that collapses to a line goes. This is Weld, it is Remove
//! Doubles, and it is what turns a tessellation into a cage and two elements
//! into one - which is exactly why the element count changes after it.
export function mergeByDistance(mesh, tolerance = 0.05, verts = null) {
  const only = verts ? new Set([...verts].map(Number)) : null;
  const cell = Math.max(tolerance, 1e-6) * 2;
  const bucket = new Map();
  const at = p => [Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)];
  const to = new Int32Array(mesh.points.length).fill(-1);
  const points = [];
  mesh.points.forEach((p, i) => {
    if (only && !only.has(i)) { to[i] = points.length; points.push(p.slice()); return; }
    const [x, y, z] = at(p);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++)
      for (let dy = -1; dy <= 1 && found < 0; dy++)
        for (let dz = -1; dz <= 1 && found < 0; dz++) {
          const near = bucket.get((x + dx) + "," + (y + dy) + "," + (z + dz));
          if (!near) continue;
          for (const j of near)
            if (pmLen(pmSub(points[j], p)) <= tolerance) { found = j; break; }
        }
    if (found >= 0) { to[i] = found; return; }
    to[i] = points.length;
    points.push(p.slice());
    const key = at(p).join(",");
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(to[i]);
  });
  const faces = [];
  for (const face of mesh.faces) {
    const walk = [];
    for (const v of face) {
      const w = to[v];
      if (walk[walk.length - 1] !== w) walk.push(w);
    }
    while (walk.length > 1 && walk[0] === walk[walk.length - 1]) walk.pop();
    if (walk.length >= 3) faces.push(walk);
  }
  const creases = {};
  for (const [key, t] of Object.entries(mesh.creases || {})) {
    const [a, b] = edgeEnds(key);
    if (to[a] !== to[b]) creases[edgeKey(to[a], to[b])] = t;
  }
  const corners = {};
  for (const [v, t] of Object.entries(mesh.corners || {})) corners[to[+v]] = t;
  return { points, faces, creases, corners, picked: [], level: "vertex" };
}

//! MERGE AT A POINT: everything picked becomes one vertex, at the middle of
//! them, at the first, or at a point given. Collapse, in Blender's words, and
//! the way a five-sided hole is closed to nothing.
export function mergeAt(mesh, verts, where = "centre") {
  const which = [...verts].map(Number).filter(v => mesh.points[v]);
  if (which.length < 2) return { ...cageOf(mesh), picked: [], level: "vertex" };
  const to = Array.isArray(where) ? where
    : where === "first" ? mesh.points[which[0]]
    : where === "last" ? mesh.points[which[which.length - 1]]
    : pmMid(which.map(v => mesh.points[v]));
  const out = cageOf(mesh);
  for (const v of which) out.points[v] = to.slice();
  return mergeByDistance(out, 1e-6, which);
}

//! COLLAPSE: each connected run of picked things becomes one vertex, rather
//! than all of them becoming one. Collapsing two separate edge loops should
//! give two vertices, not join the model to itself.
export function collapse(mesh, level, items, topo = topologyOf(mesh)) {
  const verts = vertsOf(mesh, level, items, topo);
  const picked = new Set(verts);
  const seen = new Set();
  let out = cageOf(mesh);
  const moves = [];
  for (const start of verts) {
    if (seen.has(start)) continue;
    const group = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const v = stack.pop();
      group.push(v);
      for (const key of topo.vertEdges[v] || [])
        for (const end of edgeEnds(key))
          if (picked.has(end) && !seen.has(end)) { seen.add(end); stack.push(end); }
    }
    if (group.length > 1) moves.push(group);
  }
  for (const group of moves) {
    const to = pmMid(group.map(v => mesh.points[v]));
    for (const v of group) out.points[v] = to.slice();
  }
  return mergeByDistance(out, 1e-6, moves.flat());
}

//! RIP: pull a selection apart from what it is joined to, giving each face its
//! own copy of the picked vertices. What opens a seam in a closed cage.
export function ripVerts(mesh, verts, topo = topologyOf(mesh)) {
  const hot = new Set([...verts].map(Number));
  const out = building(mesh);
  const copy = new Map();
  mesh.faces.forEach((face, fi) => {
    out.face(face.map(v => {
      if (!hot.has(v)) return v;
      const key = fi + "," + v;
      if (!copy.has(key)) copy.set(key, out.add(mesh.points[v]));
      return copy.get(key);
    }));
  });
  return dropLoose(out.done([...copy.values()], "vertex"));
}

//! SPLIT: the picked faces are given their own copies of every vertex, so the
//! region comes away as an element of its own without moving.
export function splitFaces(mesh, faces, topo = topologyOf(mesh)) {
  const picked = new Set([...faces].map(Number));
  const out = building(mesh);
  const copy = new Map();
  mesh.faces.forEach((face, fi) => {
    if (!picked.has(fi)) { out.face(face.slice()); return; }
    out.face(face.map(v => {
      if (!copy.has(v)) copy.set(v, out.add(mesh.points[v]));
      return copy.get(v);
    }));
  });
  return dropLoose(out.done([], "face"));
}

/* ------------------------------------------------------------- normals */

//! Every picked face wound the other way.
export function flipFaces(mesh, faces) {
  const picked = new Set([...faces].map(Number));
  const out = cageOf(mesh);
  out.faces = mesh.faces.map((face, fi) => (picked.has(fi) ? [...face].reverse() : face.slice()));
  return { ...out, picked: [...picked], level: "face" };
}

//! RECALCULATE: make the winding agree across the whole mesh, then point it
//! outwards. An imported cage with half its faces the wrong way round shades
//! black in patches and sews into nothing; this is the fix, and it is one
//! flood fill plus a volume test.
export function recalculateNormals(mesh, inward = false, topo = topologyOf(mesh)) {
  const flip = new Uint8Array(mesh.faces.length);
  const seen = new Uint8Array(mesh.faces.length);
  const walked = (face, flipped) => (flipped ? [...face].reverse() : face);
  for (let start = 0; start < mesh.faces.length; start++) {
    if (seen[start]) continue;
    seen[start] = 1;
    const stack = [start];
    while (stack.length) {
      const fi = stack.pop();
      const face = walked(mesh.faces[fi], flip[fi]);
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i + 1) % face.length];
        for (const other of topo.edges.get(edgeKey(a, b)).faces) {
          if (other === fi || seen[other]) continue;
          const theirs = mesh.faces[other];
          const at = theirs.indexOf(a);
          // Neighbours agree when they walk the shared edge in OPPOSITE
          // directions. Walking it the same way means one of them is inside out.
          const same = at >= 0 && theirs[(at + 1) % theirs.length] === b;
          flip[other] = same ? 1 - flip[fi] : flip[fi];
          seen[other] = 1;
          stack.push(other);
        }
      }
    }
  }
  const out = { ...cageOf(mesh) };
  out.faces = mesh.faces.map((face, fi) => walked(face, flip[fi]).slice());
  // And then the whole thing the right way out, by the sign of its volume.
  let volume = 0;
  for (const face of out.faces)
    for (let i = 1; i + 1 < face.length; i++) {
      const a = out.points[face[0]], b = out.points[face[i]], c = out.points[face[i + 1]];
      volume += pmDot(a, pmCross(b, c)) / 6;
    }
  if ((volume < 0) !== !!inward) out.faces = out.faces.map(f => [...f].reverse());
  return { ...out, picked: [], level: "face" };
}

/* ----------------------------------------------------- thickness and copies */

//! SOLIDIFY: the surface gets a back. An inner shell offset along the normals,
//! wound the other way, with the open edges walled in between them.
export function solidify(mesh, thickness = 10, topo = topologyOf(mesh)) {
  const normals = vertexNormals(mesh, topo);
  const out = building(mesh);
  const inner = mesh.points.map((p, i) => out.add(pmAdd(p, pmMul(normals[i], -thickness))));
  out.faces.push(...mesh.faces.map(f => f.slice()));
  for (const face of mesh.faces) out.face([...face].reverse().map(v => inner[v]));
  // The wall round an opening, wound the way the face beside it walks that
  // edge rather than the way the edge's key happens to sort - which is
  // arbitrary, and which left half the walls inside out.
  mesh.faces.forEach((face, fi) => {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      if (topo.edges.get(edgeKey(a, b)).faces.length !== 1) continue;
      out.face([b, a, inner[a], inner[b]]);
    }
  });
  return out.done([], "face");
}

//! WIREFRAME: every edge becomes a bar. The quickest way to get from a cage to
//! a space frame, and the reason it is here rather than in a plug-in.
export function wireframe(mesh, thickness = 5, topo = topologyOf(mesh)) {
  const out = building({ points: [], faces: [] });
  const normals = vertexNormals(mesh, topo);
  for (const [key] of topo.edges) {
    const [a, b] = edgeEnds(key);
    const along = pmUnit(pmSub(mesh.points[b], mesh.points[a]));
    const up = pmUnit(pmCross(along, pmAdd(normals[a], normals[b])));
    const side = pmUnit(pmCross(along, up));
    const corners = [];
    for (const end of [a, b])
      for (const [su, ss] of [[1, 1], [1, -1], [-1, -1], [-1, 1]])
        corners.push(out.add(pmAdd(mesh.points[end],
          pmAdd(pmMul(up, su * thickness / 2), pmMul(side, ss * thickness / 2)))));
    const [p0, p1, p2, p3, q0, q1, q2, q3] = corners;
    out.face([p0, p1, p2, p3]);
    out.face([q3, q2, q1, q0]);
    out.face([p0, q0, q1, p1]);
    out.face([p1, q1, q2, p2]);
    out.face([p2, q2, q3, p3]);
    out.face([p3, q3, q0, p0]);
  }
  return out.done([], "face");
}

//! MIRROR: a reflected copy, welded to the original along the plane. What a
//! symmetrical building is modelled as - half of it, plus this.
export function mirrorMesh(mesh, { origin = [0, 0, 0], normal = [1, 0, 0],
                                   weld = 0.05, join = true } = {}) {
  const n = pmUnit(normal);
  const reflect = p => {
    const d = pmDot(pmSub(p, origin), n);
    return pmSub(p, pmMul(n, 2 * d));
  };
  const out = building(join ? mesh : { points: [], faces: [] });
  if (join) out.faces.push(...mesh.faces.map(f => f.slice()));
  const shift = out.points.length;
  for (const p of mesh.points) out.add(reflect(p));
  for (const face of mesh.faces) out.face([...face].reverse().map(v => v + shift));
  for (const [key, t] of Object.entries(mesh.creases || {})) {
    const [a, b] = edgeEnds(key);
    out.creases.set(edgeKey(a + shift, b + shift), t);
  }
  const made = out.done([], "face");
  return weld > 0 ? mergeByDistance(made, weld) : made;
}

//! SYMMETRIZE: cut one half away and mirror the other into its place, so a
//! model that was nearly symmetrical becomes exactly so.
export function symmetrize(mesh, { origin = [0, 0, 0], normal = [1, 0, 0],
                                   keep = -1, weld = 0.05 } = {}) {
  const half = bisect(mesh, { origin, normal, clear: keep });
  return mirrorMesh(half, { origin, normal, weld, join: true });
}

//! SPIN, which is Screw when it climbs: the selection swept round an axis in
//! steps, each step bridged to the last. A tower, a stair, a dome rib.
export function spin(mesh, edges, { axis = [0, 0, 1], centre = [0, 0, 0],
                                    angle = 360, steps = 12, rise = 0 } = {},
                     topo = topologyOf(mesh)) {
  const n = Math.max(1, Math.round(steps));
  const unit = pmUnit(axis);
  const turn = (p, a) => {
    // Rodrigues, about the axis through the centre.
    const v = pmSub(p, centre);
    const c = Math.cos(a), s = Math.sin(a);
    return pmAdd(pmAdd(centre, pmAdd(pmMul(v, c), pmMul(pmCross(unit, v), s))),
                 pmMul(unit, pmDot(unit, v) * (1 - c) + 0));
  };
  const rim = [...edges].filter(key => topo.edges.has(key));
  if (!rim.length) return { ...cageOf(mesh), picked: [], level: "face" };
  const out = building(mesh);
  out.faces.push(...mesh.faces.map(f => f.slice()));
  const ends = new Set();
  for (const key of rim) for (const v of edgeEnds(key)) ends.add(v);
  let row = new Map([...ends].map(v => [v, v]));
  const closed = Math.abs(angle) >= 359.999;
  const made = [];
  for (let s = 1; s <= n; s++) {
    const a = (angle * Math.PI / 180) * (s / n);
    const next = new Map();
    if (closed && s === n) for (const v of ends) next.set(v, v);
    else for (const v of ends)
      next.set(v, out.add(pmAdd(turn(mesh.points[v], a), pmMul(unit, rise * s / n))));
    for (const key of rim) {
      const [p, q] = edgeEnds(key);
      made.push(out.face([row.get(p), row.get(q), next.get(q), next.get(p)]));
    }
    row = next;
  }
  return out.done(made.filter(i => i >= 0), "face");
}

/* ---------------------------------------------------------- filling in */

//! FILL: close an opening with one n-gon, or with a fan. The same operation
//! FillHoles does to every hole at once, here to the one you picked.
export function fillLoop(mesh, edges, { fan = false } = {}, topo = topologyOf(mesh)) {
  const loops = chainEdges([...edges]).map(loop => facingOut(mesh, loop, topo));
  const out = building(mesh);
  out.faces.push(...mesh.faces.map(f => f.slice()));
  const made = [];
  for (const loop of loops) {
    if (loop.length < 3) continue;
    if (!fan) { made.push(out.face(loop)); continue; }
    const hub = out.add(pmMid(loop.map(v => mesh.points[v])));
    for (let i = 0; i < loop.length; i++)
      made.push(out.face([loop[i], loop[(i + 1) % loop.length], hub]));
  }
  return out.done(made.filter(i => i >= 0), "face");
}

//! A rim walked the way a cap over it has to be wound.
//!
//! Chaining loose edges into a loop gives a ring in whichever direction the
//! walk happened to go, and half the time that is the wrong way - which caps a
//! cylinder with a lid that faces into it. The face already on the rim knows
//! which way is out: the cap runs AGAINST it, as any two faces sharing an edge
//! do.
function facingOut(mesh, loop, topo) {
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const edge = topo.edges && topo.edges.get(edgeKey(a, b));
    if (!edge || edge.faces.length !== 1) continue;
    const face = mesh.faces[edge.faces[0]];
    const at = face.indexOf(a);
    if (at < 0) continue;
    // The face walks a -> b, so the cap must walk b -> a.
    return face[(at + 1) % face.length] === b ? [...loop].reverse() : loop;
  }
  return loop;
}

//! GRID FILL: an opening with an even number of sides filled with quads rather
//! than with a fan. The difference between a hole that subdivides and one that
//! puckers, which on a subdivision model is the whole difference.
export function gridFill(mesh, edges, { span = 0 } = {}, topo = topologyOf(mesh)) {
  const loops = chainEdges([...edges]).map(loop => facingOut(mesh, loop, topo));
  const out = building(mesh);
  out.faces.push(...mesh.faces.map(f => f.slice()));
  const made = [];
  for (const loop of loops) {
    if (loop.length < 4 || loop.length % 2) { made.push(out.face(loop)); continue; }
    const half = loop.length / 2;
    const offset = ((Math.round(span) % half) + half) % half;
    const rolled = loop.slice(offset).concat(loop.slice(0, offset));
    // Two opposite runs of the loop, walked towards each other.
    const one = rolled.slice(0, half + 1);
    const two = rolled.slice(half).concat([rolled[0]]).reverse();
    const rows = [one];
    const inner = half - 1;
    for (let j = 1; j <= inner; j++) {
      const t = j / (inner + 1);
      const row = [two[0] !== undefined && j === inner + 1 ? two[0] : null];
      row.length = 0;
      for (let i = 0; i <= half; i++) {
        if (i === 0) { row.push(rolled[(rolled.length - j) % rolled.length]); continue; }
        if (i === half) { row.push(rolled[half + j]); continue; }
        const a = mesh.points[one[i]], b = mesh.points[two[i]];
        row.push(out.add(pmAdd(a, pmMul(pmSub(b, a), t))));
      }
      rows.push(row);
    }
    rows.push(two);
    for (let j = 0; j + 1 < rows.length; j++)
      for (let i = 0; i + 1 < half + 1; i++)
        made.push(out.face([rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]]));
  }
  return out.done(made.filter(i => i >= 0), "face");
}

//! CONNECT: a cut from vertex to vertex across the faces they share. J in
//! Blender, and the way a face is split exactly where you want it split rather
//! than where a loop cut would put it.
export function connectVerts(mesh, verts, topo = topologyOf(mesh)) {
  const picked = new Set([...verts].map(Number));
  const out = building(mesh);
  const made = [];
  mesh.faces.forEach((face, fi) => {
    const on = face.map((v, i) => (picked.has(v) ? i : -1)).filter(i => i >= 0);
    if (on.length !== 2) { out.face(face.slice()); return; }
    const [i, j] = on;
    if ((j - i) === 1 || (i === 0 && j === face.length - 1)) { out.face(face.slice()); return; }
    made.push(out.face(face.slice(i, j + 1)));
    made.push(out.face(face.slice(j).concat(face.slice(0, i + 1))));
  });
  return out.done(made.filter(i => i >= 0), "face");
}

/* -------------------------------------------------- sharpness for the subdiv

   A subdivision surface is smooth everywhere, which is the point of it and
   also its problem: a building has arrises. A CREASE says how strongly an edge
   holds its fold - 0 is fully smooth, 1 is a hard arris - and a CORNER says
   the same about a vertex. Both are Pixar's, both are what OpenSubdiv and
   Maya and Max and Blender all carry, and both live on the mesh so they travel
   downstream with it.                                                        */

export function setCrease(mesh, edges, amount) {
  const out = cageOf(mesh);
  const t = Math.max(0, Math.min(1, +amount || 0));
  for (const key of edges) {
    if (t <= 0) delete out.creases[key];
    else out.creases[key] = t;
  }
  return { ...out, picked: [...edges], level: "edge" };
}

export function setCorner(mesh, verts, amount) {
  const out = cageOf(mesh);
  const t = Math.max(0, Math.min(1, +amount || 0));
  for (const v of [...verts].map(Number)) {
    if (t <= 0) delete out.corners[v];
    else out.corners[v] = t;
  }
  return { ...out, picked: [...verts].map(Number), level: "vertex" };
}

//! A copy of the picked faces, in place. Duplicate, and the start of most
//! things - copy the wall, move it, bridge the two.
export function duplicateFaces(mesh, faces, by = [0, 0, 0]) {
  const picked = [...faces].map(Number).filter(fi => mesh.faces[fi]);
  const out = building(mesh);
  out.faces.push(...mesh.faces.map(f => f.slice()));
  const copy = new Map();
  const made = [];
  for (const fi of picked)
    made.push(out.face(mesh.faces[fi].map(v => {
      if (!copy.has(v)) copy.set(v, out.add(pmAdd(mesh.points[v], by)));
      return copy.get(v);
    })));
  return out.done(made.filter(i => i >= 0), "face");
}

//! Separate the picked faces into their own mesh, and say what is left. Used
//! by the Separate operation, which makes two features out of one.
export function separateFaces(mesh, faces) {
  const picked = new Set([...faces].map(Number));
  const taken = dropLoose({ ...cageOf(mesh), faces: mesh.faces.filter((f, i) => picked.has(i)) });
  const left = dropLoose({ ...cageOf(mesh), faces: mesh.faces.filter((f, i) => !picked.has(i)) });
  return { taken, left };
}

/* ====================================================== Catmull-Clark, with
                                                          the folds you asked for

   The smooth surface a cage means. Standard Catmull-Clark for n-gons, plus the
   one thing a building needs that a character does not: CREASES. A subdivision
   surface is smooth everywhere, and a building has arrises - a parapet, a
   reveal, the line where a soffit meets a wall - so without creases every
   subdivision model of a building is a blancmange, and the only way to get an
   edge is to pack extra loops against it by hand.

   A crease is a number from 0 to 1 on an edge. 0 subdivides as usual; 1 holds
   the fold exactly; in between the edge point is interpolated between the two,
   which is the semi-sharp rule Pixar published and everybody has since. A
   CORNER does the same for a vertex.                                        */

export function catmullClark(mesh, { sharpBoundary = true } = {}) {
  const topo = topologyOf(mesh);
  const creaseOf = key => {
    const set = mesh.creases && mesh.creases[key];
    if (set !== undefined) return Math.max(0, Math.min(1, set));
    return sharpBoundary && topo.edges.get(key).faces.length === 1 ? 1 : 0;
  };
  const points = [];
  const add = p => { points.push([p[0], p[1], p[2]]); return points.length - 1; };

  // A point in the middle of every face.
  const facePoint = mesh.faces.map(face => add(faceCentre(mesh, face)));

  // A point on every edge: the average of its ends and the two face points,
  // pulled back towards the plain midpoint by however creased it is.
  const edgePoint = new Map();
  const edgeCrease = new Map();
  for (const [key, edge] of topo.edges) {
    const a = mesh.points[edge.a], b = mesh.points[edge.b];
    const middle = pmMul(pmAdd(a, b), 0.5);
    const crease = creaseOf(key);
    edgeCrease.set(key, crease);
    if (edge.faces.length < 2) { edgePoint.set(key, add(middle)); continue; }
    const smooth = pmMul(pmAdd(pmAdd(a, b),
      pmAdd(points[facePoint[edge.faces[0]]], points[facePoint[edge.faces[1]]])), 0.25);
    edgePoint.set(key, add(pmAdd(smooth, pmMul(pmSub(middle, smooth), crease))));
  }

  // And every old vertex moved, by whichever rule its own sharpness calls for.
  //
  // Three rules, and which one a vertex gets is decided by how many sharp
  // edges run into it. That is the classification everybody uses - Pixar
  // named them smooth, crease and corner - and it is what makes a creased
  // LOOP read as a crisp line while a single creased edge reads as a dart
  // that fades out at both ends.
  const moved = mesh.points.map((v, i) => {
    const around = topo.vertEdges[i] || [];
    const faces = topo.vertFaces[i] || [];
    const sharp = around.filter(key => edgeCrease.get(key) > 0);
    const corner = Math.max(0, Math.min(1, (mesh.corners && mesh.corners[i]) || 0));

    // A CORNER: three or more sharp edges, a corner tag, or a vertex with only
    // one face on it - the corner of an open sheet, which stays put or the
    // sheet shrinks away from its own boundary every level.
    if (corner >= 1 || sharp.length > 2 || (faces.length === 1 && sharp.length >= 2)
        || !faces.length || !around.length)
      return add(v);

    let smooth;
    if (faces.length < around.length) {
      // On the rim of a hole and not held: the boundary is a curve through the
      // rim, which keeps it a smooth line rather than pulling it inwards.
      const open = around.filter(key => topo.edges.get(key).faces.length === 1).slice(0, 2);
      const ends = open.map(key => {
        const [a, b] = edgeEnds(key);
        return mesh.points[a === i ? b : a];
      });
      smooth = ends.length === 2
        ? pmMul(pmAdd(pmAdd(ends[0], ends[1]), pmMul(v, 6)), 1 / 8) : v;
    } else {
      const n = faces.length;
      const F = pmMid(faces.map(fi => points[facePoint[fi]]));
      const R = pmMid(around.map(key => {
        const [a, b] = edgeEnds(key);
        return pmMul(pmAdd(mesh.points[a], mesh.points[b]), 0.5);
      }));
      smooth = pmMul(pmAdd(pmAdd(F, pmMul(R, 2)), pmMul(v, n - 3)), 1 / n);
    }

    // A CREASE VERTEX: exactly two sharp edges, so it runs along the crease as
    // a curve rather than settling into the surface.
    if (sharp.length === 2) {
      const strength = Math.min(...sharp.map(key => edgeCrease.get(key)));
      const ends = sharp.map(key => {
        const [a, b] = edgeEnds(key);
        return mesh.points[a === i ? b : a];
      });
      const along = pmMul(pmAdd(pmAdd(ends[0], ends[1]), pmMul(v, 6)), 1 / 8);
      smooth = pmAdd(smooth, pmMul(pmSub(along, smooth), strength));
    }
    if (corner > 0) smooth = pmAdd(smooth, pmMul(pmSub(v, smooth), corner));
    return add(smooth);
  });

  // Every face becomes one quad per corner.
  const faces = [];
  mesh.faces.forEach((face, fi) => {
    for (let i = 0; i < face.length; i++) {
      const before = face[(i - 1 + face.length) % face.length];
      const v = face[i], after = face[(i + 1) % face.length];
      faces.push([moved[v], edgePoint.get(edgeKey(v, after)), facePoint[fi],
                  edgePoint.get(edgeKey(before, v))]);
    }
  });

  // A creased edge stays creased on both of its halves. Without this a crease
  // survives one level and vanishes at the next, which looks like the setting
  // not working rather than like it wearing off.
  const creases = {};
  for (const [key, crease] of edgeCrease) {
    if (crease <= 0) continue;
    const [a, b] = edgeEnds(key);
    const mid = edgePoint.get(key);
    creases[edgeKey(moved[a], mid)] = crease;
    creases[edgeKey(mid, moved[b])] = crease;
  }
  const corners = {};
  for (const [v, t] of Object.entries(mesh.corners || {}))
    if (moved[+v] !== undefined) corners[moved[+v]] = t;
  return { points, faces, creases, corners };
}

/* ========================================================= the starting mesh

   NOBODY MODELS FROM NOTHING. A subdivision model starts as a block, a slab, a
   ring or an L and is pushed from there, and the first five minutes of every
   session is making that. So the starting topologies are a node: pick the one
   the massing is shaped like, set how finely it is divided, and start pushing.

   All-quad wherever it can be, because a quad cage is what Catmull-Clark
   wants: a triangle in a cage becomes a permanent pucker in the surface. */

//! A flat quad, or a grid of them. The slab everything sits on.
export function planeMesh({ width = 1000, depth = 1000, cols = 1, rows = 1 } = {}) {
  const nx = Math.max(1, Math.round(cols)), ny = Math.max(1, Math.round(rows));
  const points = [];
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++)
      points.push([-width / 2 + width * i / nx, -depth / 2 + depth * j / ny, 0]);
  const faces = [];
  const at = (i, j) => j * (nx + 1) + i;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
  return { points, faces, creases: {}, corners: {} };
}

//! A box, divided. Every face shares its corners with the next, so it is a
//! closed cage rather than six loose sheets.
export function boxMesh({ dx = 1000, dy = 1000, dz = 1000,
                          segX = 1, segY = 1, segZ = 1, centred = true } = {}) {
  const nx = Math.max(1, Math.round(segX)), ny = Math.max(1, Math.round(segY)),
        nz = Math.max(1, Math.round(segZ));
  const index = new Map();
  const points = [];
  const at = (i, j, k) => {
    const key = i + "," + j + "," + k;
    if (index.has(key)) return index.get(key);
    const p = [dx * i / nx, dy * j / ny, dz * k / nz];
    if (centred) { p[0] -= dx / 2; p[1] -= dy / 2; p[2] -= dz / 2; }
    index.set(key, points.length);
    points.push(p);
    return points.length - 1;
  };
  const faces = [];
  const sheet = (n, m, make) => {
    for (let a = 0; a < n; a++)
      for (let b = 0; b < m; b++) faces.push(make(a, b));
  };
  sheet(nx, ny, (i, j) => [at(i, j, 0), at(i, j + 1, 0), at(i + 1, j + 1, 0), at(i + 1, j, 0)]);
  sheet(nx, ny, (i, j) => [at(i, j, nz), at(i + 1, j, nz), at(i + 1, j + 1, nz), at(i, j + 1, nz)]);
  sheet(nx, nz, (i, k) => [at(i, 0, k), at(i + 1, 0, k), at(i + 1, 0, k + 1), at(i, 0, k + 1)]);
  sheet(nx, nz, (i, k) => [at(i, ny, k), at(i, ny, k + 1), at(i + 1, ny, k + 1), at(i + 1, ny, k)]);
  sheet(ny, nz, (j, k) => [at(0, j, k), at(0, j, k + 1), at(0, j + 1, k + 1), at(0, j + 1, k)]);
  sheet(ny, nz, (j, k) => [at(nx, j, k), at(nx, j + 1, k), at(nx, j + 1, k + 1), at(nx, j, k + 1)]);
  return { points, faces, creases: {}, corners: {} };
}

//! AN L-SHAPED PLAN, which is the shape half the massing in an office is. Two
//! rectangles sharing a corner, gridded so the shared edge has vertices on
//! both sides of it and the cage is one piece.
export function lShapeMesh({ width = 1200, depth = 1200, arm = 500, leg = 500,
                             grid = 200 } = {}) {
  const step = Math.max(1, grid);
  const inside = [Math.max(step, Math.min(width - step, arm)),
                  Math.max(step, Math.min(depth - step, leg))];
  const xs = axisStops(0, width, inside[0], step);
  const ys = axisStops(0, depth, inside[1], step);
  const index = new Map();
  const points = [];
  const at = (i, j) => {
    const key = i + "," + j;
    if (!index.has(key)) {
      index.set(key, points.length);
      points.push([xs[i] - width / 2, ys[j] - depth / 2, 0]);
    }
    return index.get(key);
  };
  const faces = [];
  for (let j = 0; j + 1 < ys.length; j++)
    for (let i = 0; i + 1 < xs.length; i++) {
      // The bite out of the corner: everything beyond both insets is missing,
      // and what is left is the L.
      if (xs[i] >= inside[0] && ys[j] >= inside[1]) continue;
      faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  return { points, faces, creases: {}, corners: {} };
}

//! A CROSS, or a T when the arms are not equal - the other two plans that turn
//! up before anything else. Same machinery as the L: a grid with bites taken
//! out of the corners.
export function crossMesh({ width = 1200, depth = 1200, arm = 400, leg = 400,
                            grid = 200, tee = false } = {}) {
  const step = Math.max(1, grid);
  const x0 = Math.max(step, Math.min(width / 2 - step, (width - arm) / 2));
  const y0 = Math.max(step, Math.min(depth / 2 - step, (depth - leg) / 2));
  const xs = axisStops(0, width, x0, step, width - x0);
  const ys = axisStops(0, depth, y0, step, depth - y0);
  const index = new Map();
  const points = [];
  const at = (i, j) => {
    const key = i + "," + j;
    if (!index.has(key)) {
      index.set(key, points.length);
      points.push([xs[i] - width / 2, ys[j] - depth / 2, 0]);
    }
    return index.get(key);
  };
  const faces = [];
  for (let j = 0; j + 1 < ys.length; j++)
    for (let i = 0; i + 1 < xs.length; i++) {
      const outX = xs[i] < x0 || xs[i] >= width - x0;
      const outY = ys[j] < y0 || ys[j] >= depth - y0;
      if (outX && outY) continue;
      if (tee && outY && ys[j] < y0) continue;
      faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  return { points, faces, creases: {}, corners: {} };
}

//! Stops along an axis at about the spacing asked for, with the given breaks
//! landing exactly on a stop. A plan whose inside corner is between two
//! vertices is a plan you cannot pull the corner of.
function axisStops(from, to, ...breaks) {
  const step = breaks.pop ? breaks[breaks.length - 1] : 100;
  const marks = [from, to, ...breaks.slice(0, -1)].filter(v => v >= from && v <= to);
  const spacing = breaks[breaks.length - 1];
  const wanted = new Set(marks.map(v => Math.round(v * 1e6) / 1e6));
  const all = [...wanted].sort((a, b) => a - b);
  const stops = [];
  for (let i = 0; i + 1 < all.length; i++) {
    const span = all[i + 1] - all[i];
    const n = Math.max(1, Math.round(span / spacing));
    for (let k = 0; k < n; k++) stops.push(all[i] + span * k / n);
  }
  stops.push(all[all.length - 1]);
  return stops;
}

//! A HEXAGON, all quads. Three rhombi meeting in the middle, each gridded -
//! the pattern a cube's corner makes, which is the only way to fill a hexagon
//! with quads without a pole on the rim. Good starting topology for a tower:
//! six faces round, three-fold symmetry, no triangles.
export function hexagonMesh({ radius = 600, rings = 2 } = {}) {
  const n = Math.max(1, Math.round(rings));
  const index = new Map();
  const points = [];
  const at = p => {
    const key = p.map(v => Math.round(v * 1e4)).join(",");
    if (!index.has(key)) { index.set(key, points.length); points.push(p); }
    return index.get(key);
  };
  const corner = k => [radius * Math.cos(Math.PI / 3 * k), radius * Math.sin(Math.PI / 3 * k), 0];
  const middle = [0, 0, 0];
  const faces = [];
  for (let k = 0; k < 6; k += 2) {
    // One rhombus: the centre, two adjacent corners, and the corner between.
    const a = corner(k), b = corner(k + 1), c = corner(k + 2);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const p = (u, v) => at(bilinear(middle, a, b, c, u, v));
        faces.push([p(i / n, j / n), p((i + 1) / n, j / n),
                    p((i + 1) / n, (j + 1) / n), p(i / n, (j + 1) / n)]);
      }
  }
  return { points, faces, creases: {}, corners: {} };
}

const bilinear = (p00, p10, p11, p01, u, v) => pmAdd(
  pmAdd(pmMul(p00, (1 - u) * (1 - v)), pmMul(p10, u * (1 - v))),
  pmAdd(pmMul(p11, u * v), pmMul(p01, (1 - u) * v)));

//! A HONEYCOMB: a field of hexagonal faces, rings deep. Not a subdivision cage
//! - hexagons subdivide into a mess - but the starting mesh for a panelised
//! facade or a canopy, and the thing people mean half the time they ask for a
//! hexagonal mesh, so both are here and they are named differently.
export function honeycombMesh({ size = 200, rings = 2, rotate = false } = {}) {
  const index = new Map();
  const points = [];
  const at = p => {
    const key = p.map(v => Math.round(v * 1e3)).join(",");
    if (!index.has(key)) { index.set(key, points.length); points.push(p); }
    return index.get(key);
  };
  const n = Math.max(0, Math.round(rings));
  const faces = [];
  const turn = rotate ? 0 : Math.PI / 6;
  for (let q = -n; q <= n; q++)
    for (let r = Math.max(-n, -q - n); r <= Math.min(n, -q + n); r++) {
      const cx = size * Math.sqrt(3) * (q + r / 2);
      const cy = size * 1.5 * r;
      const ring = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 3 * k + turn;
        ring.push(at([cx + size * Math.cos(a), cy + size * Math.sin(a), 0]));
      }
      faces.push(ring);
    }
  return { points, faces, creases: {}, corners: {} };
}

//! A disc of quads, with a square in the middle rather than a pole - the
//! "quad sphere" pattern, and the reason a cylinder built on it subdivides
//! cleanly where one built on a fan does not.
export function discMesh({ radius = 500, rings = 2, sides = 4 } = {}) {
  const n = Math.max(1, Math.round(rings));
  const around = Math.max(3, Math.round(sides));
  if (around === 4) {
    // A rounded square grid, pushed out to the circle at the rim.
    const grid = planeMesh({ width: radius * 2, depth: radius * 2, cols: n * 2, rows: n * 2 });
    grid.points = grid.points.map(p => {
      const far = Math.max(Math.abs(p[0]), Math.abs(p[1]));
      if (far < 1e-9) return p;
      const straight = pmLen([p[0], p[1], 0]);
      const want = far;                       // the square's own radius there
      return pmMul([p[0], p[1], 0], want / straight);
    });
    return grid;
  }
  const points = [[0, 0, 0]];
  const faces = [];
  for (let r = 1; r <= n; r++)
    for (let k = 0; k < around; k++) {
      const a = 2 * Math.PI * k / around;
      points.push([radius * r / n * Math.cos(a), radius * r / n * Math.sin(a), 0]);
    }
  const at = (r, k) => 1 + (r - 1) * around + ((k % around) + around) % around;
  for (let k = 0; k < around; k++) faces.push([0, at(1, k), at(1, k + 1)]);
  for (let r = 1; r < n; r++)
    for (let k = 0; k < around; k++)
      faces.push([at(r, k), at(r + 1, k), at(r + 1, k + 1), at(r, k + 1)]);
  return { points, faces, creases: {}, corners: {} };
}

//! A tube, capped or not. The cage a tower, a column or a chimney starts as.
export function cylinderMesh({ radius = 400, height = 1000, sides = 8,
                               rows = 1, caps = true } = {}) {
  const n = Math.max(3, Math.round(sides)), m = Math.max(1, Math.round(rows));
  const points = [];
  for (let j = 0; j <= m; j++)
    for (let k = 0; k < n; k++) {
      const a = 2 * Math.PI * k / n;
      points.push([radius * Math.cos(a), radius * Math.sin(a), height * j / m - height / 2]);
    }
  const at = (j, k) => j * n + ((k % n) + n) % n;
  const faces = [];
  for (let j = 0; j < m; j++)
    for (let k = 0; k < n; k++)
      faces.push([at(j, k), at(j, k + 1), at(j + 1, k + 1), at(j + 1, k)]);
  if (caps) {
    faces.push([...Array(n).keys()].map(k => at(0, n - 1 - k)));
    faces.push([...Array(n).keys()].map(k => at(m, k)));
  }
  return { points, faces, creases: {}, corners: {} };
}

//! A ring with a hole in it - a doughnut in plan, which is a courtyard block.
export function tubeMesh({ inner = 250, outer = 500, height = 600,
                           sides = 12, rows = 1 } = {}) {
  const n = Math.max(3, Math.round(sides)), m = Math.max(1, Math.round(rows));
  const points = [];
  const ring = (r, z) => {
    const base = points.length;
    for (let k = 0; k < n; k++) {
      const a = 2 * Math.PI * k / n;
      points.push([r * Math.cos(a), r * Math.sin(a), z]);
    }
    return base;
  };
  const rings = [];
  for (let j = 0; j <= m; j++) rings.push([ring(outer, height * j / m - height / 2),
                                           ring(inner, height * j / m - height / 2)]);
  const faces = [];
  const step = (base, k) => base + ((k % n) + n) % n;
  for (let j = 0; j < m; j++)
    for (let k = 0; k < n; k++) {
      faces.push([step(rings[j][0], k), step(rings[j][0], k + 1),
                  step(rings[j + 1][0], k + 1), step(rings[j + 1][0], k)]);
      faces.push([step(rings[j][1], k + 1), step(rings[j][1], k),
                  step(rings[j + 1][1], k), step(rings[j + 1][1], k + 1)]);
    }
  for (let k = 0; k < n; k++) {
    faces.push([step(rings[0][0], k + 1), step(rings[0][0], k),
                step(rings[0][1], k), step(rings[0][1], k + 1)]);
    faces.push([step(rings[m][0], k), step(rings[m][0], k + 1),
                step(rings[m][1], k + 1), step(rings[m][1], k)]);
  }
  return { points, faces, creases: {}, corners: {} };
}

//! A sphere of quads with a pole at each end. Coarse on purpose: this is a
//! cage, and eight by six subdivides into something rounder than a hundred by
//! a hundred of anything else.
export function sphereMesh({ radius = 500, sides = 8, rows = 6 } = {}) {
  const n = Math.max(3, Math.round(sides)), m = Math.max(2, Math.round(rows));
  const points = [[0, 0, radius]];
  for (let j = 1; j < m; j++)
    for (let k = 0; k < n; k++) {
      const phi = Math.PI * j / m, theta = 2 * Math.PI * k / n;
      points.push([radius * Math.sin(phi) * Math.cos(theta),
                   radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi)]);
    }
  const south = points.length;
  points.push([0, 0, -radius]);
  const at = (j, k) => 1 + (j - 1) * n + ((k % n) + n) % n;
  const faces = [];
  for (let k = 0; k < n; k++) faces.push([0, at(1, k), at(1, k + 1)]);
  for (let j = 1; j + 1 < m; j++)
    for (let k = 0; k < n; k++)
      faces.push([at(j, k), at(j + 1, k), at(j + 1, k + 1), at(j, k + 1)]);
  for (let k = 0; k < n; k++) faces.push([south, at(m - 1, k + 1), at(m - 1, k)]);
  return { points, faces, creases: {}, corners: {} };
}

//! A torus - the one starting mesh that is a different topology rather than a
//! different shape, and the quickest way to see whether a subdivision is right.
export function torusMesh({ radius = 500, tube = 160, sides = 12, rings = 8 } = {}) {
  const n = Math.max(3, Math.round(sides)), m = Math.max(3, Math.round(rings));
  const points = [];
  for (let j = 0; j < m; j++)
    for (let k = 0; k < n; k++) {
      const u = 2 * Math.PI * j / m, v = 2 * Math.PI * k / n;
      points.push([(radius + tube * Math.cos(v)) * Math.cos(u),
                   (radius + tube * Math.cos(v)) * Math.sin(u), tube * Math.sin(v)]);
    }
  const at = (j, k) => (((j % m) + m) % m) * n + ((k % n) + n) % n;
  const faces = [];
  for (let j = 0; j < m; j++)
    for (let k = 0; k < n; k++)
      faces.push([at(j, k), at(j + 1, k), at(j + 1, k + 1), at(j, k + 1)]);
  return { points, faces, creases: {}, corners: {} };
}

//! The starting meshes, by name, with the arguments each one reads. One table
//! so the node, the pie menu and the tests all agree about what exists.
export const TEMPLATES = {
  plane: planeMesh, grid: planeMesh, box: boxMesh,
  lshape: lShapeMesh, cross: crossMesh, hexagon: hexagonMesh,
  honeycomb: honeycombMesh, disc: discMesh, cylinder: cylinderMesh,
  tube: tubeMesh, sphere: sphereMesh, torus: torusMesh,
};

export const TEMPLATE_NAMES = ["plane", "grid", "box", "lshape", "cross", "hexagon",
                               "honeycomb", "disc", "cylinder", "tube", "sphere", "torus"];

export function templateMesh(kind, options = {}) {
  const make = TEMPLATES[kind] || planeMesh;
  return cageOf(make(options));
}

/* ==================================================== the non-destructive list

   WHAT AN EDIT MESH NODE ACTUALLY IS. Not a mesh - a LIST of operations, and
   the mesh is what you get by running them over whatever arrives from
   upstream. Change the box underneath from three divisions to five and the
   extrude, the bevel and the two loop cuts all happen again to the new box.
   That is Max's Edit Poly and it is the difference between a modeller and a
   mesh painter.

   THE HARD PART is what an operation POINTS AT. "Extrude face 17" means
   nothing after the cage upstream has been re-divided, because face 17 is
   somewhere else now. So every operation carries the POSITIONS of the things
   it was about as well as their indices, and \ref rebindTo finds them again by
   where they were. It is best effort - it has to be, there is no other honest
   answer - and when it cannot find them it says so in the notes rather than
   silently operating on whatever happens to be numbered that today.        */

//! WHERE THE THINGS AN OPERATION IS ABOUT WERE, recorded so they can be found
//! again after the cage underneath changes.
//!
//! Not just a point. A vertex is a point; an edge is a midpoint, a direction
//! and a half-length; a face is a centre, a normal and the radius of the
//! circle round it. The extra numbers are what let one recorded face find the
//! FOUR faces that replaced it when somebody re-divided the box underneath -
//! which is the whole trick, and a centre alone cannot do it.
export function anchorsOf(mesh, level, items, topo = topologyOf(mesh)) {
  if (level === "vertex")
    return [...items].map(v => (mesh.points[v] || [0, 0, 0]).slice());
  if (level === "edge") return [...items].map(key => {
    const [a, b] = edgeEnds(key);
    const p = mesh.points[a], q = mesh.points[b];
    if (!p || !q) return [0, 0, 0, 0, 0, 0, 0];
    const along = pmSub(q, p);
    const half = pmLen(along) / 2;
    const unit = pmUnit(along);
    return [...pmMul(pmAdd(p, q), 0.5), ...unit, half];
  });
  const groups = level === "element"
    ? [...items].map(si => (shellsOf(mesh, topo)[si] || []))
    : [...items].map(fi => (mesh.faces[fi] ? [Number(fi)] : []));
  return groups.map(group => {
    if (!group.length) return [0, 0, 0, 0, 0, 1, 0];
    const centre = pmMid(group.map(fi => faceCentre(mesh, mesh.faces[fi])));
    const normal = pmUnit(pmMid(group.map(fi => faceNormal(mesh, mesh.faces[fi]))));
    let radius = 0;
    for (const fi of group)
      for (const v of mesh.faces[fi])
        radius = Math.max(radius, pmLen(pmSub(mesh.points[v], centre)));
    return [...centre, ...normal, radius];
  });
}

//! THE THINGS NEAREST WHERE THEY WERE. What makes an operation survive a
//! change upstream, and the only part of this that cannot be exactly right.
//!
//! An index that still lands on something at the same place is kept as it is,
//! which is the usual case and costs nothing. Otherwise the recorded shape is
//! used as a CATCHMENT: every face inside the circle the old face filled, and
//! facing the same way, is taken - so the top of a box that has since been
//! divided into four rebinds to all four, and the extrude that was recorded on
//! one face happens to the region that replaced it. Same for an edge that has
//! been cut in half: both halves are it now.
//!
//! When the catchment is empty the operation has lost what it was about, and
//! it says so. There is no honest alternative to saying so: operating on
//! whatever happens to be numbered 17 today is how a model quietly turns into
//! a different model.
export function rebindTo(mesh, level, items, anchors, topo = topologyOf(mesh)) {
  const asked = [...items];
  if (!anchors || !anchors.length || anchors.length !== asked.length)
    return { at: asked, lost: 0 };
  const box = boundsOf(mesh);
  const size = Math.max(1e-6, pmLen(pmSub(box.hi, box.lo)));
  const here = anchorsOf(mesh, level, asked, topo);
  const out = [];
  const taken = new Set();
  let lost = 0;

  const sameSpot = (a, b) => a && b && pmLen(pmSub([a[0], a[1], a[2]], [b[0], b[1], b[2]]))
    <= size * 1e-5;

  asked.forEach((item, i) => {
    const want = anchors[i];
    if (!want) { out.push(item); return; }
    if (sameSpot(here[i], want) && !taken.has(item)) {
      taken.add(item);
      out.push(item);
      return;
    }
    const found = catchmentIn(mesh, level, want, size, topo).filter(id => !taken.has(id));
    if (!found.length) { lost++; return; }
    for (const id of found) { taken.add(id); out.push(id); }
  });
  return { at: out, lost };
}

//! Everything of this level that the recorded shape covers now.
function catchmentIn(mesh, level, want, size, topo) {
  const at = [want[0], want[1], want[2]];
  if (level === "vertex") {
    let best = null, far = size * 0.08;
    mesh.points.forEach((p, i) => {
      const d = pmLen(pmSub(p, at));
      if (d < far) { far = d; best = i; }
    });
    return best === null ? [] : [best];
  }
  if (level === "edge") {
    const way = [want[3], want[4], want[5]], half = want[6] || size * 0.02;
    const reach = Math.max(half * 1.05, size * 0.005);
    const got = [];
    for (const [key, edge] of topo.edges) {
      const p = mesh.points[edge.a], q = mesh.points[edge.b];
      const middle = pmMul(pmAdd(p, q), 0.5);
      if (pmLen(pmSub(middle, at)) > reach) continue;
      // Running the same way, either way round: an edge is not directed.
      if (Math.abs(pmDot(pmUnit(pmSub(q, p)), way)) < 0.87) continue;
      got.push(key);
    }
    if (got.length) return got;
    // Nothing parallel and close: the nearest midpoint, if there is one at all.
    let best = null, far = size * 0.08;
    for (const [key, edge] of topo.edges) {
      const d = pmLen(pmSub(pmMul(pmAdd(mesh.points[edge.a], mesh.points[edge.b]), 0.5), at));
      if (d < far) { far = d; best = key; }
    }
    return best === null ? [] : [best];
  }
  const way = [want[3], want[4], want[5]], radius = want[6] || size * 0.05;
  if (level === "element") {
    const shells = shellsOf(mesh, topo);
    let best = null, far = Math.max(radius, size * 0.1);
    shells.forEach((group, i) => {
      const centre = pmMid(group.map(fi => faceCentre(mesh, mesh.faces[fi])));
      const d = pmLen(pmSub(centre, at));
      if (d < far) { far = d; best = i; }
    });
    return best === null ? [] : [best];
  }
  const got = [];
  mesh.faces.forEach((face, fi) => {
    const centre = faceCentre(mesh, face);
    if (pmLen(pmSub(centre, at)) > radius) return;
    if (pmDot(faceNormal(mesh, face), way) < 0.5) return;
    got.push(fi);
  });
  if (got.length) return got;
  let best = null, far = size * 0.1;
  mesh.faces.forEach((face, fi) => {
    const d = pmLen(pmSub(faceCentre(mesh, face), at));
    if (d < far && pmDot(faceNormal(mesh, face), way) > 0) { far = d; best = fi; }
  });
  return best === null ? [] : [best];
}

//! EVERY OPERATION THE LIST CAN HOLD, with what it is called, which levels it
//! makes sense at, and what it takes. One table, because the replay, the pie
//! menu, the floating parameter and the panel all have to agree about what an
//! operation is - and a table is the only way they do.
//!
//! `levels` is which sub-object level the operation reads its selection at.
//! `lead` names the argument a drag in the viewport drives, so that picking
//! Extrude and moving the mouse extrudes rather than opening a dialogue.
export const MESH_OPS = {
  // No lead: a move is driven by the widget in the viewport, and a slider that
  // only drove one of its three numbers would be a slider that lies.
  move: { label: "Move", levels: ["vertex", "edge", "face", "border", "element"],
          args: { by: [0, 0, 0] },
          note: "push the selection along a vector" },
  transform: { label: "Transform", levels: ["vertex", "edge", "face", "border", "element"],
               args: { move: [0, 0, 0], scale: [1, 1, 1], turn: [0, 0, 0] },
               note: "move, turn and scale about the middle of it" },
  shrinkfatten: { label: "Shrink / fatten", levels: ["vertex", "edge", "face", "element"],
                  lead: "amount", args: { amount: 20 },
                  note: "along the normals, not along an axis" },
  sphere: { label: "To sphere", levels: ["vertex", "edge", "face", "element"],
            lead: "factor", args: { factor: 1 }, note: "round the selection off" },
  smooth: { label: "Smooth", levels: ["vertex", "edge", "face", "element"],
            lead: "factor", args: { factor: 0.5, rounds: 1 },
            note: "each vertex towards the average of its neighbours" },
  randomize: { label: "Randomise", levels: ["vertex", "edge", "face", "element"],
               lead: "amount", args: { amount: 10, seed: 1 },
               note: "a jolt per vertex, the same one every rebuild" },

  extrude: { label: "Extrude", levels: ["face", "edge", "vertex", "border"],
             lead: "distance", args: { distance: 100, individual: false, alongNormals: false },
             note: "lift it and wall in what it left" },
  inset: { label: "Inset", levels: ["face"], lead: "thickness",
           args: { thickness: 50, depth: 0, individual: false },
           note: "a smaller copy inside, with a ring between" },
  bevel: { label: "Bevel", levels: ["edge", "vertex"], lead: "width",
           args: { width: 30, segments: 1 }, note: "give the fold a width" },
  loopcut: { label: "Loop cut", levels: ["edge"], lead: "offset",
             args: { cuts: 1, offset: 0 }, note: "a ring of edges across the strip" },
  subdivide: { label: "Subdivide", levels: ["edge", "face"], lead: "cuts",
               args: { cuts: 1 }, note: "cut what is picked into more of it" },
  unsubdivide: { label: "Un-subdivide", levels: ["face", "element"], args: {},
                 note: "merge quads back into bigger quads" },
  bridge: { label: "Bridge", levels: ["edge", "border"], args: { twist: 0, flip: false },
            note: "a strip of quads between two openings" },
  bisect: { label: "Bisect", levels: ["face", "element"],
            args: { origin: [0, 0, 0], normal: [0, 0, 1], clear: 0, fill: false },
            note: "cut the whole mesh with a plane" },
  poke: { label: "Poke", levels: ["face"], lead: "offset", args: { offset: 0 },
          note: "a point in the middle, fanned to the corners" },
  triangulate: { label: "Triangulate", levels: ["face", "element"], args: {},
                 note: "n-gons into triangles" },
  quadrangulate: { label: "Tris to quads", levels: ["face", "element"], lead: "limit",
                   args: { limit: 40 }, note: "pair triangles back into quads" },
  connect: { label: "Connect", levels: ["vertex"], args: {},
             note: "a cut from vertex to vertex across the face" },

  dissolve: { label: "Dissolve", levels: ["vertex", "edge", "face"], args: {},
              note: "take it away and close the surface over it" },
  remove: { label: "Delete", levels: ["vertex", "edge", "face", "border", "element"],
            args: { only: false }, note: "take it away and leave the hole" },
  merge: { label: "Merge by distance", levels: ["vertex", "edge", "face", "element"],
           lead: "tolerance", args: { tolerance: 1, all: false },
           note: "vertices that sit together become one" },
  weldat: { label: "Weld together", levels: ["vertex", "edge"], args: { where: "centre" },
            note: "the selection becomes one vertex" },
  collapse: { label: "Collapse", levels: ["vertex", "edge", "face"], args: {},
              note: "each run of it becomes one vertex" },
  rip: { label: "Rip", levels: ["vertex", "edge"], args: {},
         note: "pull it away from what it is joined to" },
  split: { label: "Split", levels: ["face", "element"], args: {},
           note: "the region comes away as its own element" },

  flip: { label: "Flip normals", levels: ["face", "element"], args: {},
          note: "wind it the other way" },
  recalc: { label: "Recalculate normals", levels: ["face", "element"],
            args: { inward: false }, note: "make the whole mesh agree, facing out" },
  solidify: { label: "Solidify", levels: ["face", "element"], lead: "thickness",
              args: { thickness: 30 }, note: "give the surface a back" },
  wireframe: { label: "Wireframe", levels: ["face", "element"], lead: "thickness",
               args: { thickness: 20 }, note: "every edge becomes a bar" },
  mirror: { label: "Mirror", levels: ["face", "element"],
            args: { origin: [0, 0, 0], normal: [1, 0, 0], weld: 0.5 },
            note: "a reflected copy, welded along the plane" },
  symmetrize: { label: "Symmetrise", levels: ["face", "element"],
                args: { origin: [0, 0, 0], normal: [1, 0, 0], keep: -1, weld: 0.5 },
                note: "make one half of it the other half" },
  spin: { label: "Spin", levels: ["edge", "border"],
          args: { axis: [0, 0, 1], centre: [0, 0, 0], angle: 360, steps: 12, rise: 0 },
          note: "sweep it round an axis, climbing if you like" },
  fill: { label: "Fill", levels: ["edge", "border"], args: { fan: false },
          note: "close the opening" },
  gridfill: { label: "Grid fill", levels: ["edge", "border"], lead: "span",
              args: { span: 0 }, note: "close it with quads rather than a fan" },
  duplicate: { label: "Duplicate", levels: ["face", "element"], lead: "by",
               args: { by: [0, 0, 0] }, note: "a copy of the region, in place" },

  crease: { label: "Crease", levels: ["edge"], lead: "amount", args: { amount: 1 },
            note: "how hard the subdivision holds this fold" },
  corner: { label: "Corner", levels: ["vertex"], lead: "amount", args: { amount: 1 },
            note: "how hard the subdivision holds this point" },
};

//! Run one operation over a mesh. Everything the list replays goes through
//! here, and so does everything the editor does live - there is one code path,
//! which is why what you see while you drag is what the file rebuilds to.
export function applyOp(mesh, record) {
  const kind = record.op;
  const spec = MESH_OPS[kind];
  if (!spec) throw new Error('there is no mesh operation called "' + kind + '"');
  const topo = topologyOf(mesh);
  const level = record.level || spec.levels[0];
  const bound = rebindTo(mesh, level, record.at || [], record.near, topo);
  const at = bound.at;
  const args = { ...spec.args, ...(record.args || {}) };
  const verts = () => vertsOf(mesh, level, at, topo);
  const faces = () => facesOf(mesh, level, at, topo);
  const edges = () => edgesIn(mesh, level, at, topo);

  let result;
  switch (kind) {
    case "move":
      result = record.offsets ? moveEach(mesh, record.offsets) : moveVerts(mesh, verts(), args.by);
      break;
    case "transform": result = transformVerts(mesh, verts(), args); break;
    case "shrinkfatten": result = shrinkFatten(mesh, verts(), args.amount, topo); break;
    case "sphere": result = toSphere(mesh, verts(), args.factor); break;
    case "smooth": result = smoothVerts(mesh, verts(), args.factor, args.rounds, topo); break;
    case "randomize": result = randomize(mesh, verts(), args.amount, args.seed); break;

    case "extrude":
      result = level === "vertex" ? extrudeVerts(mesh, at, args.by || [0, 0, args.distance])
        : level === "edge" || level === "border"
          ? extrudeEdges(mesh, edges(), args.by || [0, 0, args.distance], topo)
          : extrudeFaces(mesh, faces(), args, topo);
      break;
    case "inset": result = insetFaces(mesh, faces(), args, topo); break;
    case "bevel": result = level === "vertex" ? bevelVerts(mesh, verts(), args.width, topo)
                                              : bevelEdges(mesh, edges(), args, topo); break;
    case "loopcut": result = loopCut(mesh, at[0], args, topo); break;
    case "subdivide": result = subdivideEdges(mesh, edges(), args.cuts, topo); break;
    case "unsubdivide": result = unSubdivide(mesh, topo); break;
    case "bridge": result = bridgeLoops(mesh, edges(), args, topo); break;
    case "bisect": result = bisect(mesh, args); break;
    case "poke": result = pokeFaces(mesh, faces(), args.offset); break;
    case "triangulate": result = triangulate(mesh, faces()); break;
    case "quadrangulate": result = quadrangulate(mesh, faces(), args.limit, topo); break;
    case "connect": result = connectVerts(mesh, verts(), topo); break;

    case "dissolve":
      result = level === "vertex" ? dissolveVerts(mesh, at, topo)
        : level === "edge" ? dissolveEdges(mesh, at, topo)
        : dissolveFaces(mesh, faces(), topo);
      break;
    case "remove": result = deleteAt(mesh, level, at, args, topo); break;
    case "merge":
      result = mergeByDistance(mesh, args.tolerance, args.all ? null : verts());
      break;
    case "weldat": result = mergeAt(mesh, verts(), args.where); break;
    case "collapse": result = collapse(mesh, level, at, topo); break;
    case "rip": result = ripVerts(mesh, verts(), topo); break;
    case "split": result = splitFaces(mesh, faces(), topo); break;

    case "flip": result = flipFaces(mesh, faces()); break;
    case "recalc": result = recalculateNormals(mesh, args.inward, topo); break;
    case "solidify": result = solidify(mesh, args.thickness, topo); break;
    case "wireframe": result = wireframe(mesh, args.thickness, topo); break;
    case "mirror": result = mirrorMesh(mesh, args); break;
    case "symmetrize": result = symmetrize(mesh, args); break;
    case "spin": result = spin(mesh, edges(), args, topo); break;
    case "fill": result = fillLoop(mesh, edges(), args, topo); break;
    case "gridfill": result = gridFill(mesh, edges(), args, topo); break;
    case "duplicate": result = duplicateFaces(mesh, faces(), args.by); break;

    case "crease": result = setCrease(mesh, edges(), args.amount); break;
    case "corner": result = setCorner(mesh, verts(), args.amount); break;
    default: throw new Error('the mesh operation "' + kind + '" is not wired up');
  }
  // AN OPERATION THAT ONLY MOVES POINTS LEAVES THE SELECTION ALONE. Pushing a
  // face out should not drop you into vertex mode with its four corners picked
  // - what you were working on is still what you are working on, and an editor
  // that re-picks after every nudge is an editor you fight.
  if (KEEPS_PICKED.has(kind))
    return { mesh: cageOf(result), picked: at, level, lost: bound.lost };
  return { mesh: cageOf(result), picked: result.picked || [],
           level: result.level || level, lost: bound.lost };
}

//! The operations that change where things are without changing what they are.
const KEEPS_PICKED = new Set(["move", "transform", "shrinkfatten", "sphere", "smooth",
                              "randomize", "crease", "corner", "flip", "recalc"]);

//! The whole list, in order, over a cage from upstream. What an Edit Mesh node
//! builds, every time anything above it changes.
//!
//! An operation that throws does NOT stop the list. A cage that lost the face
//! an extrude was about should come out as the rest of the model with one
//! operation missing and a line saying which - not as an error where a
//! building used to be. The notes are what the panel prints.
export function applyOps(mesh, ops) {
  let at = cageOf(mesh);
  const notes = [];
  let picked = [], level = "vertex";
  (Array.isArray(ops) ? ops : []).forEach((record, i) => {
    if (!record || typeof record !== "object" || !record.op) return;
    try {
      const done = applyOp(at, record);
      at = done.mesh;
      picked = done.picked;
      level = done.level;
      if (done.lost)
        notes.push("step " + (i + 1) + " (" + (MESH_OPS[record.op] || {}).label + "): "
          + done.lost + (done.lost === 1 ? " thing it was about is" : " things it was about are")
          + " no longer in the mesh");
    } catch (error) {
      notes.push("step " + (i + 1) + " (" + record.op + ") did not run: " + error.message);
    }
  });
  return { mesh: at, notes, picked, level };
}

//! A tally for the tree and the panel: what the cage is, in words.
export function tallyOf(mesh) {
  const counts = new Map();
  for (const face of mesh.faces) counts.set(face.length, (counts.get(face.length) || 0) + 1);
  const said = [...counts].sort((a, b) => a[0] - b[0]).map(([sides, n]) =>
    n + " " + (sides === 3 ? "tri" : sides === 4 ? "quad" : sides + "-gon") + (n === 1 ? "" : "s"));
  return said.join(" · ") || "nothing";
}
