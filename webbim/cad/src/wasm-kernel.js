// OpenCascade in the page.
//
// The same kernel the native runtime uses, compiled to WebAssembly. It builds
// the real B-Rep - a filleted box here has twelve cylindrical faces and eight
// spherical corners, exactly as it does in the STEP file - and hands back the
// triangles OpenCascade meshed from it.
//
// Failure is the interesting part. OpenCascade reports trouble three different
// ways and only one of them is an exception, so every driver is guarded three
// times over:
//
//   1. a precondition, checked against the geometry before the kernel is
//      called at all - this is what stops an over-sized fillet radius, which
//      OpenCascade will otherwise answer with IsDone() == true and a shape
//      that is quietly wrong;
//   2. a try/catch around the call, because Standard_Failure crosses the
//      WebAssembly boundary as a number, a pointer or an Error depending on
//      where it was raised;
//   3. a check of the result - IsDone(), a non-null shape, and faces on it.
//
// A feature that fails keeps its last good shape and records the message, so
// one bad radius never takes the model, or the page, down with it.

import { CATALOGUE, Doc, Driver, F, clampTo, dataLines, drafting, kernelMessage,
         meshCreases, meshFaces, meshSharpness, parseNumbers, registeredTypes,
         schemaJson, setDrafting, typeSpec } from "./ocaf.js";
import { chainSegments, meshCross, meshSlice, thin } from "./draft.js";
import { SECTION_KINDS, sectionOutline } from "./sections.js";
import { RECONCILE_PASSES, compilePlan, planDoc, readMade, readPlan, reconcile,
         saysPlan, writeMade } from "./generate.js";
import { freshId, freshName, instantiateEdits } from "./reuse.js";
import { MESH_OPS, anchorsOf, applyOps, cageOf, catmullClark, tallyOf,
         templateMesh, topologyOf } from "./polymesh.js";
import { edgeAnchor, faceAnchor, growPicks, readPicks, resolvePicks,
         tangentChain } from "./subshape.js";
import { bsplinePoints, builtDrawing, reversedBspline, shownDrawing, sketchArcPoint,
         sketchChainEnds, sketchEnds, sketchLoops, sketchNesting, sketchOutline,
         solveSketch, splinePoints, wholeEllipse } from "./sketch.js";
import { cornersOf, frameAt, frameOf, saysShot } from "./camera.js";
import { readStory, saysStory } from "./story.js";
import { fovFromLens } from "./gizmo.js";
import { QUALIFIERS, bisector, cCircle, cLine, cPoint, circle2PointsRadius,
         circle2TanOn, circle2TanRadius, circle3Tan, circleTanCentre,
         circleTanOnRadius, circleThrough3, line2Tan, lineTanAngle,
         saysCircle, saysLine } from "./gcc.js";
import { CONFUSION, FIT_SEAM_SAMPLES, V, factorySchema, makeFactories,
         turnAbout } from "./factory.js";
import { FORMATS, countObjParts, fromBase64, isAssembly, isPacked, latin1, packGeometry,
         parseObj, parseStl, realNames, scanStep, unpackGeometry, utf8, writeObj,
         writeStl } from "./exchange.js";
import { DXF_LIMIT, describeDrawing, dxfDrawing, dxfSurvey, ignoredName,
         writeDxf } from "./dxf.js";

export async function createWasmKernel({ initModule, wasmBinary, instantiateWasm,
                                        locateFile, onProgress }) {
  if (onProgress) onProgress("starting the modeller");
  //! `locateFile` is where the WebAssembly WOULD be if it had to be fetched,
  //! and it never does here - it is either handed over as bytes or compiled
  //! from a response. It is worth naming anyway: unnamed, the glue works the
  //! path out itself with `new URL(name, import.meta.url)`, and inside a
  //! worker made from a blob `import.meta.url` is a blob: URL, which cannot be
  //! the base of anything. That throws "Invalid URL" before the first line of
  //! the kernel runs.
  const options = instantiateWasm ? { instantiateWasm } : { wasmBinary };
  if (locateFile) options.locateFile = locateFile;
  const oc = await initModule(options);
  if (onProgress) onProgress("ready");

  const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
  const SOLID = oc.TopAbs_ShapeEnum.TopAbs_SOLID;
  const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
  const VERTEX = oc.TopAbs_ShapeEnum.TopAbs_VERTEX;
  const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;

  /* ------------------------------------------------------------ helpers */

  const Feature_choice = (f, key) => F.choice(f, key, 0);

  const pnt = p => new oc.gp_Pnt(p[0], p[1], p[2]);
  const dir = d => new oc.gp_Dir(d[0], d[1], d[2]);

  const length = V.length;
  //! The point a feature stands for, read from what it computed rather than
  //! from its arguments. An input that says it accepts "point" then really does
  //! accept any of them - a Point of any kind, a point off a curve, a draped
  //! site - instead of only the one feature type that happened to spell its
  //! coordinates x, y and z.
  const readPoint = f => {
    const data = f && F.data(f);
    return data && data.kind === "point" && data.values.length >= 3
      ? [data.values[0], data.values[1], data.values[2]] : null;
  };
  //! The same, but ALL of them. A point feature may be a row - a list of
  //! numbers wired into a coordinate, a divided curve, a drape - and an
  //! operation about points is about every one of them, not about the first.
  const readPoints = f => {
    const data = f && F.data(f);
    if (!data || data.kind !== "point") return [];
    const out = [];
    for (let i = 0; i + 2 < data.values.length; i += 3)
      out.push([data.values[i], data.values[i + 1], data.values[i + 2]]);
    return out;
  };
  const readVector = f => {
    const data = f && F.data(f);
    return data && data.kind === "vector" && data.values.length >= 3
      ? [data.values[0], data.values[1], data.values[2]] : null;
  };

  //! An axis system, read the same way: whatever built it, what comes out is an
  //! origin and three directions.
  const readAxisSystem = f => {
    const data = f && F.data(f);
    if (!data || data.kind !== "axis" || data.values.length < 12) return null;
    const v = data.values;
    return { at: v.slice(0, 3), x: v.slice(3, 6), y: v.slice(6, 9), z: v.slice(9, 12) };
  };

  //! Three directions that are square to each other and right handed, out of
  //! two that may be neither. X is believed; Y is squared against it; Z is the
  //! cross of the two. A Y that is parallel to X - or missing - is replaced by
  //! any perpendicular, because a frame is still a frame.
  function frameFrom(origin, xdir, ydir) {
    const x = V.norm(xdir) || [1, 0, 0];
    let y = ydir ? V.norm(V.sub(ydir, V.scale(x, V.dot(x, ydir)))) : null;
    if (!y) {
      const other = Math.abs(x[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      y = V.norm(V.cross(other, x));
    }
    return { at: origin, x, y, z: V.cross(x, y) };
  }

  const axisPlacement = a => new oc.gp_Ax3(pnt(a.at), dir(a.z), dir(a.x));

  //! A plane datum resolved, whichever way it was asked for. One answer, not
  //! two: either the frame or the sentence saying why there isn't one. A flag
  //! that switched between them could not survive being called recursively -
  //! "fine" and "broken" both came back as null - so it does not exist.
  function resolvePlane(f) {
    const no = why => ({ ax: null, why });
    if (!f || F.spec(f).type !== "Plane") return no("that is not a plane");
    //! Every branch ends here, and here means one HybridShapeFactory call.
    //! The factory raises; a datum answers with a sentence instead, because a
    //! plane that cannot be worked out is something to say, not to throw.
    const made = build => {
      try {
        const ax = build();
        return ax ? { ax, why: null } : no("that plane cannot be worked out");
      } catch (e) { return no(describeError(e)); }
    };
    const frame = (at, normal, xdir) => {
      if (!at || !normal) return no("that plane cannot be worked out");
      return made(() => HSF.planeNormal(at, normal, xdir));
    };

    switch (Feature_choice(f, "kind")) {
      case 1: {                                   // square across a curve
        const curve = F.reference(f, "curve");
        if (!F.shape(curve)) return no("no curve to stand across");
        const on = alongCurve(curve, F.real(f, "at", 0.5));
        if (!on || !on.tangent) return no("that curve cannot be walked along");
        return frame(on.at, on.tangent);
      }
      case 2: {                                   // offset from another plane
        const parent = resolvePlane(F.reference(f, "from"));
        if (!parent.ax) return no(parent.why || "no plane to offset from");
        return made(() => HSF.planeOffset(parent.ax, F.real(f, "offset", 100)));
      }
      case 3: {                                   // halfway between two planes
        const a = resolvePlane(F.reference(f, "a"));
        const b = resolvePlane(F.reference(f, "b"));
        if (!a.ax || !b.ax) return no(a.why || b.why || "two planes are needed");
        return made(() => HSF.planeMean(a.ax, b.ax));
      }
      case 4: {                                   // turned about an axis
        const parent = resolvePlane(F.reference(f, "turn"));
        if (!parent.ax) return no(parent.why || "no plane to turn");
        const spin = axisOf(F.reference(f, "axis"));
        if (!spin) return no("an axis is needed to turn about");
        return made(() => HSF.planeRotate(parent.ax, spin.along, F.real(f, "angle", 45)));
      }
      default: {                                  // an origin and a normal
        const origin = readPoint(F.reference(f, "origin"));
        // A direction is a direction. A vector says which way it points and so
        // does a line, an edge or the axis of a cylinder - and refusing the
        // second kind means a plane square to a tangent line cannot be asked
        // for at all, which is the one thing a curve-mounted plane is for.
        const way = axisOf(F.reference(f, "normal"));
        const normal = way && way.along;
        if (!origin) return no("origin point is missing");
        if (!normal || length(normal) < CONFUSION) return no("normal vector is missing or null");
        //! And which way is sideways, when somebody has said. Squared against
        //! the normal by the factory, so a direction that is not quite
        //! perpendicular still makes a frame rather than an error.
        const sideways = axisOf(F.reference(f, "xdir"));
        return frame(origin, normal, sideways && sideways.along);
      }
    }
  }

  //! A vector datum resolved, whichever way it was asked for - the same shape
  //! of answer as the plane and the line, for the same reason. The direction,
  //! and where to draw it: a tangent belongs on the curve it was taken from,
  //! not at the world origin, or it is a direction nobody can see the sense of.
  function resolveVector(f) {
    const no = why => ({ along: null, at: [0, 0, 0], why });
    if (Feature_choice(f, "kind") === 1) {
      const curve = F.reference(f, "curve");
      if (!F.shape(curve)) return no("no curve to be tangent to");
      const on = readPoint(F.reference(f, "at"));
      if (!on) return no("a point on the curve is needed");
      try {
        const found = HSF.curveAtPoint(F.shape(curve), on);
        return { along: found.tangent, at: found.at, why: null };
      } catch (e) { return no(describeError(e)); }
    }
    const along = [F.real(f, "dx"), F.real(f, "dy"), F.real(f, "dz")];
    if (length(along) < CONFUSION) return no("a vector needs a non-zero direction");
    return { along, at: [0, 0, 0], why: null };
  }

  //! WHERE THE AXIS OF A REVOLUTION IS AND WHICH WAY IT POINTS. A vector says
  //! the direction and a point says where it stands; without a point it stands
  //! where the vector was drawn, which for a plain Vector is the world origin
  //! and is what anybody means by "about Z".
  function revolveAxis(f) {
    const found = axisOf(F.reference(f, "axis"));
    if (!found || !found.along) return null;
    const through = readPoint(F.reference(f, "through"));
    return { at: through || found.at || [0, 0, 0], along: found.along };
  }

  //! A section stands on its plane the way a sketch does, and is centred where
  //! it is told rather than always on the plane's own origin.
  function sectionFrame(f) {
    const axis = planeAxis(F.reference(f, "plane"))
      || new oc.gp_Ax2(pnt([0, 0, 0]), dir([0, 0, 1]));
    const X = axis.XDirection(), Y = axis.YDirection(), N = axis.Direction();
    const here = axis.Location();
    const x = [X.X(), X.Y(), X.Z()], y = [Y.X(), Y.Y(), Y.Z()], n = [N.X(), N.Y(), N.Z()];
    const seat = [here.X(), here.Y(), here.Z()];
    const asked = readPoint(F.reference(f, "centre"));
    const origin = asked ? V.sub(asked, V.scale(n, V.dot(V.sub(asked, seat), n))) : seat;
    return { normal: n, x, y, origin,
             at: uv => V.add(origin, V.add(V.scale(x, uv[0]), V.scale(y, uv[1]))) };
  }

  const sectionElements = f => sectionOutline(
    SECTION_KINDS[Feature_choice(f, "kind")] || SECTION_KINDS[0], {
      depth: F.real(f, "depth", 400), width: F.real(f, "width", 180),
      web: F.real(f, "web", 9), flange: F.real(f, "flange", 14),
      root: F.real(f, "root", 10), toe: F.real(f, "toe", 0),
      lip: F.real(f, "lip", 20), top: F.real(f, "top", 120),
      offset: F.real(f, "offset", 30), wall: F.real(f, "web", 9),
      outerRadius: F.real(f, "root", 10), innerRadius: F.real(f, "toe", 0),
    });

  //! The frame, or null - what every driver that stands something on a plane
  //! has always asked for.
  const planeAxis = f => resolvePlane(f).ax;
  //! And why there isn't one, for the precondition to say out loud.
  const planeTrouble = f => resolvePlane(f).why;

  //! A direction, from a vector or from whatever a curve happens to run along.
  //! Turning a plane wants one and so does an axis of revolution, and neither
  //! cares which of the two it was given.
  function axisOf(f) {
    const found = HSF.axisOf(f && F.shape(f), readVector(f));
    if (found) return found;
    const on = alongCurve(f, 0.5);
    return on && on.tangent ? { at: on.at, along: on.tangent } : null;
  }

  //! Where a line starts and which way it goes, whichever way it was asked
  //! for. Same shape of answer as the plane, for the same reason.
  function resolveLine(f) {
    const no = why => ({ ray: null, why });
    const ray = (at, along) => {
      const unit = V.norm(along);
      if (!at || !unit) return no("that line has no direction");
      return { ray: { at, along: unit }, why: null };
    };
    switch (Feature_choice(f, "kind")) {
      case 1: {
        const a = readPoint(F.reference(f, "from")), b = readPoint(F.reference(f, "to"));
        if (!a || !b) return no("two points are needed");
        const along = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        if (length(along) < CONFUSION) return no("those two points are the same point");
        return ray(a, along);
      }
      case 2: {
        const plane = resolvePlane(F.reference(f, "plane"));
        if (!plane.ax) return no(plane.why || "no plane to stand on");
        const n = plane.ax.Direction(), at = plane.ax.Location();
        const through = readPoint(F.reference(f, "at"));
        return ray(through || [at.X(), at.Y(), at.Z()], [n.X(), n.Y(), n.Z()]);
      }
      case 3: {
        const curve = F.reference(f, "curve");
        if (!F.shape(curve)) return no("no curve to be tangent to");
        const on = alongCurve(curve, F.real(f, "along", 0.5));
        if (!on || !on.tangent) return no("that curve cannot be walked along");
        return ray(on.at, on.tangent);
      }
      case 4: {
        const spin = axisOf(F.reference(f, "shape"));
        if (!spin) return no("nothing there has an axis");
        return ray(spin.at, spin.along);
      }
      default: {
        const at = readPoint(F.reference(f, "origin"));
        const along = readVector(F.reference(f, "direction"));
        if (!at) return no("start point is missing");
        if (!along || length(along) < CONFUSION) return no("direction vector is missing or null");
        return ray(at, along);
      }
    }
  }

  function countSubShapes(shape, kind) {
    const explorer = new oc.TopExp_Explorer(shape, kind, ANY);
    let n = 0;
    while (explorer.More()) { n++; explorer.Next(); }
    explorer.delete();
    return n;
  }

  //! The extents of a shape, used both to size the tessellation and to judge
  //! whether a fillet radius can possibly fit.
  function extents(shape) {
    const box = new oc.Bnd_Box();
    oc.BRepBndLib.Add(shape, box, true);
    if (box.IsVoid()) { box.delete(); return null; }
    const lo = box.CornerMin(), hi = box.CornerMax();
    const size = [hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z()];
    const centre = [(lo.X() + hi.X()) / 2, (lo.Y() + hi.Y()) / 2, (lo.Z() + hi.Z()) / 2];
    const low = [lo.X(), lo.Y(), lo.Z()], high = [hi.X(), hi.Y(), hi.Z()];
    box.delete();
    return { size, centre, low, high,
             smallest: Math.min(...size), diagonal: Math.hypot(...size) };
  }

  //! The smallest extent of any single solid in a shape. A fillet radius has to
  //! fit the individual body, not the bounding box of a whole array of them.
  function smallestSolidExtent(shape) {
    let smallest = Infinity;
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, ANY);
    while (explorer.More()) {
      const box = extents(explorer.Current());
      if (box) smallest = Math.min(smallest, box.smallest);
      explorer.Next();
    }
    explorer.delete();
    if (smallest !== Infinity) return smallest;
    const whole = extents(shape);
    return whole ? whole.smallest : Infinity;
  }

  const deflectionFor = shape => {
    const box = extents(shape);
    return Math.max(1e-3, (box ? box.diagonal : 100) * 2e-3);
  };

  /* ---------------------------------------------------------- the API

     Every driver below builds its shape by calling one of these two and
     nothing else. That is the whole point of them: a driver's job is to read
     its arguments off the document and hand them over, so "point on a curve"
     and "point at the centre" cannot end up with two different ideas of what a
     curve is. The handful of things a factory needs that only the document
     side knows how to do - reading a wire off a shape, meshing one - are
     handed in rather than reached for, so the factories stay geometry.        */

  const kit = {
    wireOf: shape => wireFrom(shape),
    verticesOf: shape => verticesOf(shape),
    compoundOf: shapes => compoundOf(shapes),
    tessellationOf: (shape, deflection) => tessellationOf(shape, deflection),
    deflectionFor: shape => deflectionFor(shape),
    smallestSolidExtent: shape => smallestSolidExtent(shape),
  };
  const { hybrid: HSF, shape: SF } = makeFactories(oc, kit);

  /* ------------------------------------------------------------ drivers */

  const release = shape => { try { shape.delete(); } catch (e) { /* already gone */ } };

  //! A Standard_Failure raised inside WebAssembly arrives as a
  //! WebAssembly.Exception carrying the OpenCascade message; unwrap it so the
  //! panel shows what the kernel actually said.
  function describeError(err) {
    if (err && typeof err.message === "string" && err.message) return err.message;
    try {
      if (typeof WebAssembly !== "undefined" && WebAssembly.Exception &&
          err instanceof WebAssembly.Exception && oc.getExceptionMessage) {
        const [kind, text] = oc.getExceptionMessage(err);
        const message = text ? text : String(kind);
        if (oc.decrementExceptionRefcount) oc.decrementExceptionRefcount(err);
        return message;
      }
    } catch (ignored) { /* fall through to the generic wording */ }
    return kernelMessage(err);
  }

  //! Where a curve is, a fraction of the way along it. The whole wire, not one
  //! edge, so a chained profile reads as one curve the way it looks.
  function alongCurve(f, t) {
    const shape = f && F.shape(f);
    if (!shape) return null;
    try { return HSF.pointOnCurve(shape, t); } catch (e) { return null; }
  }

  //! The centre of a circular or elliptical edge, taken from the curve itself
  //! rather than from a bounding box - so half an arc still says where its
  //! centre is, which a box cannot.
  function centreOf(shape) {
    try { return HSF.pointCenter(shape); } catch (e) { return null; }
  }

  //! Every point OpenCascade meshed a shape down to - the same tessellation the
  //! viewport draws. Asking the drawn shape where its far end is beats asking
  //! its vertices, because a cylinder's side is not a vertex.
  function tessellationOf(shape, deflection) {
    const out = [];
    const push = run => {
      for (let i = 0; i + 2 < run.length; i += 3) out.push([run[i], run[i + 1], run[i + 2]]);
    };
    try {
      if (countSubShapes(shape, FACE) > 0) {
        const faces = oc.ReplicadMeshExtractor.extract(shape, deflection, 0.3, false);
        push(readFloats(faces.getVerticesPtr(), faces.getVerticesSize()));
        faces.delete();
      }
      if (countSubShapes(shape, EDGE) > 0) {
        const edges = oc.ReplicadEdgeMeshExtractor.extract(shape, deflection, 0.3);
        push(readFloats(edges.getLinesPtr(), edges.getLinesSize()));
        edges.delete();
      }
    } catch (e) { /* the vertices alone, then */ }
    return out;
  }

  //! The point of a shape that reaches furthest along a direction - vertices
  //! and tessellation both, so the far end of a curved face is found and not
  //! just its corners.
  function extremeOf(shape, along, furthest = true) {
    try { return HSF.pointExtreme(shape, along, furthest); } catch (e) { return null; }
  }

  //! Where two shapes come closest, and how far apart they are there. Zero
  //! means they cross, so this answers "the intersection" and "the near point"
  //! with one call - which is as well, because this build carries no curve-to-
  //! curve intersector.
  function nearestBetween(a, b) {
    try { return HSF.pointBetween(a, b); } catch (e) { return null; }
  }

  const builders = {
    //! Wire a list of numbers into a coordinate and one point becomes a row of
    //! them: the shortest list repeats its last value, which is the rule
    //! everything downstream of here follows.
    //! One node, five ways of finding a point. Whichever it is, the answer goes
    //! out as a point and nothing downstream knows the difference - which is
    //! the reason for having one node rather than five.
    Point: {
      //! Pairs up its own lists - see Driver.spreadLists.
      ownLists: true,
      precondition: f => {
        const kind = Feature_choice(f, "kind");
        if (kind === 1 && !F.shape(F.reference(f, "curve"))) return "no curve to sit on";
        if (kind === 2 && !F.shape(F.reference(f, "of"))) return "nothing to find the centre of";
        if (kind === 3) {
          if (!F.shape(F.reference(f, "shape"))) return "nothing to measure";
          if (!readVector(F.reference(f, "along"))) return "a direction is needed to be extreme along";
        }
        if (kind === 4 && !(F.shape(F.reference(f, "first")) && F.shape(F.reference(f, "second"))))
          return "two curves are needed";
        if (kind === 5) {
          if (!F.reference(f, "what")) return "no point to project";
          const onto = F.reference(f, "onto");
          if (!onto) return "nothing to project onto";
          const mesh = F.data(onto);
          if (!(mesh && mesh.kind === "mesh") && !F.shape(onto))
            return F.name(onto) + " has not been built";
        }
        if (kind === 6) {
          const plane = F.reference(f, "plane");
          if (!plane) return "no plane to sit on";
          return planeTrouble(plane);
        }
        return null;
      },
      build: f => {
        const kind = Feature_choice(f, "kind");
        let rows = null;
        if (kind === 1) {
          const on = alongCurve(F.reference(f, "curve"), F.real(f, "at", 0.5));
          if (!on) throw new Error("that curve cannot be walked along");
          rows = [on.at];
        } else if (kind === 2) {
          const at = centreOf(F.shape(F.reference(f, "of")));
          if (!at) throw new Error("nothing round to take the centre of");
          rows = [at];
        } else if (kind === 3) {
          const at = extremeOf(F.shape(F.reference(f, "shape")),
                               readVector(F.reference(f, "along")),
                               Feature_choice(f, "end") === 0);
          if (!at) throw new Error("nothing to be extreme");
          rows = [at];
        } else if (kind === 4) {
          const meet = nearestBetween(F.shape(F.reference(f, "first")),
                                      F.shape(F.reference(f, "second")));
          if (!meet) throw new Error("those two never come near each other");
          rows = [meet.at];
        } else if (kind === 5) {
          // DROPPED ONTO SOMETHING. A whole row at a time, because the point it
          // is given may itself be a row: a grid of points projected onto a
          // plane is a grid on that plane, which is what makes this worth
          // having rather than five separate nodes.
          const from = F.reference(f, "what");
          const onto = F.reference(f, "onto");
          const straight = Feature_choice(f, "way") === 1;
          const source = readPoints(from);
          if (!source.length) throw new Error("that has no points to project");
          rows = source.map(at => {
            const landed = projectOnto(at, onto, straight);
            if (!landed) throw new Error("that point does not land on "
              + F.name(onto) + " - it is past its edge, or the normal misses it");
            return landed;
          });
        } else if (kind === 6) {
          //! ON A PLANE: two numbers measured in the plane's OWN directions,
          //! not in the world's. That is the whole point of it - a point put
          //! 40 across and 25 up a face stays 40 across and 25 up when the
          //! face turns, and three world coordinates do not.
          const ax = planeAxis(F.reference(f, "plane"));
          if (!ax) throw new Error("that plane cannot be worked out");
          const at = ax.Location(), x = ax.XDirection(), y = ax.YDirection();
          const origin = [at.X(), at.Y(), at.Z()];
          const across = [x.X(), x.Y(), x.Z()], up = [y.X(), y.Y(), y.Z()];
          //! Lists here too, the same as coordinates: a row of H values and
          //! one V lays a row of points along the plane.
          rows = zip([F.reals(f, "h", 0), F.reals(f, "v", 0)]).map(([h, v]) =>
            [origin[0] + across[0] * h + up[0] * v,
             origin[1] + across[1] * h + up[1] * v,
             origin[2] + across[2] * h + up[2] * v]);
        } else {
          // Coordinates. Wire a list of numbers into one and a point becomes a
          // row of them: the shortest list repeats its last value, the rule
          // everything downstream of here follows.
          rows = zip([F.reals(f, "x", 0), F.reals(f, "y", 0), F.reals(f, "z", 0)]);
        }
        const shape = rows.length === 1
          ? HSF.pointVertex(rows[0])
          : HSF.join(rows.map(row => HSF.pointVertex(row)));
        return { shape, data: points(rows) };
      },
    },

    //! One vector node, two ways of having a direction, and nothing downstream
    //! knows the difference - a plane's normal reads what this COMPUTED, not
    //! what was typed into it, so a tangent orients a plane exactly the way
    //! three numbers do.
    Vector: {
      precondition: f => resolveVector(f).why,
      // Drawn at a readable length along the direction, from where the
      // direction was found: at the origin when it was typed in, and on the
      // curve when it was read off one. The magnitude stays in the parameters,
      // where it is read from.
      build: f => {
        const answer = resolveVector(f);
        if (!answer.along) throw new Error(answer.why);
        const v = answer.along;
        return { shape: HSF.lineFrom(answer.at, v, 0, 100), data: vectors([v]) };
      },
    },

    //! Where the line runs is one question; how far it runs is another, and the
    //! second one has an answer a number cannot give - stop on that plane. So
    //! the two are separate settings and every combination of them works.
    Line: {
      precondition: f => resolveLine(f).why,
      build: f => {
        const answer = resolveLine(f);
        if (!answer.ray) throw new Error(answer.why);
        const { at, along } = answer.ray;
        // Between two points means between them: the ends are the points, so
        // the lengths are read off rather than typed in.
        let from = F.real(f, "start", 0), to = F.real(f, "length", 100);
        if (Feature_choice(f, "kind") === 1 && Feature_choice(f, "limit") === 0) {
          const a = readPoint(F.reference(f, "from")), b = readPoint(F.reference(f, "to"));
          from = 0;
          to = length([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
        }
        if (Feature_choice(f, "limit") === 1) {
          // Run into the plane instead of to a length: how far along the
          // direction the plane is, which is the only sensible reading of
          // "until", and says so when the two never meet.
          const stop = planeAxis(F.reference(f, "until"));
          if (!stop) throw new Error("no plane to run into");
          to = HSF.lineDistanceToPlane(at, along, stop);
          from = 0;
        }
        return HSF.lineFrom(at, along, from, to);
      },
    },

    Plane: {
      precondition: f => {
        if (F.real(f, "size", 160) <= CONFUSION) return "display size must be positive";
        return planeTrouble(f);
      },
      build: f => {
        const axis = planeAxis(f);
        if (!axis) throw new Error("that plane cannot be worked out");
        //! ITS FRAME, WRITTEN DOWN, the way a sketch writes its own. A plane
        //! that has only a square of face to show for itself can be drawn and
        //! cannot be USED by the interface: turning a click into a place on it
        //! needs an origin and two directions, and reading those back off a
        //! tessellated square is guesswork. A sketch has needed this since it
        //! existed; a plane needs it for the same reasons and did not have it.
        const at = axis.Location(), x = axis.XDirection(), y = axis.YDirection();
        const n = axis.Direction();
        F.setFrame(f, {
          origin: [at.X(), at.Y(), at.Z()].map(round4),
          x: [x.X(), x.Y(), x.Z()].map(round4),
          y: [y.X(), y.Y(), y.Z()].map(round4),
          normal: [n.X(), n.Y(), n.Z()].map(round4),
        });
        return HSF.planeFace(axis, F.real(f, "size", 160));
      },
    },

    //! Three directions and a point, drawn as three lines so it can be seen,
    //! published as twelve numbers so it can be used. What a transform is
    //! measured in, and what a part is placed by.
    AxisSystem: {
      precondition: f => {
        const kind = Feature_choice(f, "kind");
        if (kind === 1) {
          if (!readPoint(F.reference(f, "at"))) return "origin point is missing";
          if (!readPoint(F.reference(f, "alongX"))) return "a point on X is needed";
          if (!readPoint(F.reference(f, "inPlane"))) return "a third point is needed to fix the plane";
        } else if (kind === 2) {
          if (!F.reference(f, "plane")) return "no plane to take a frame from";
          return planeTrouble(F.reference(f, "plane"));
        } else if (!readPoint(F.reference(f, "origin"))) return "origin point is missing";
        if (F.real(f, "size", 200) <= CONFUSION) return "display size must be positive";
        return null;
      },
      build: f => {
        const kind = Feature_choice(f, "kind");
        let frame;
        if (kind === 1) {
          const at = readPoint(F.reference(f, "at"));
          const onX = readPoint(F.reference(f, "alongX"));
          const inPlane = readPoint(F.reference(f, "inPlane"));
          const x = V.sub(onX, at);
          if (length(x) < CONFUSION) throw new Error("the point on X is the origin");
          frame = frameFrom(at, x, V.sub(inPlane, at));
          if (length(V.cross(x, V.sub(inPlane, at))) < CONFUSION)
            throw new Error("those three points are in a straight line, so they fix no plane");
        } else if (kind === 2) {
          const ax = planeAxis(F.reference(f, "plane"));
          if (!ax) throw new Error("that plane cannot be worked out");
          const z = ax.Direction(), x = ax.XDirection(), at = ax.Location();
          frame = frameFrom([at.X(), at.Y(), at.Z()], [x.X(), x.Y(), x.Z()],
                            V.cross([z.X(), z.Y(), z.Z()], [x.X(), x.Y(), x.Z()]));
        } else {
          const origin = readPoint(F.reference(f, "origin"));
          const runs = key => {
            const along = axisOf(F.reference(f, key));
            return along ? along.along : null;
          };
          const xdir = runs("xdir") || [1, 0, 0];
          const ydir = runs("ydir");
          if (length(xdir) < CONFUSION) throw new Error("the X direction is null");
          frame = frameFrom(origin, xdir, ydir);
        }
        const size = F.real(f, "size", 200);
        const arm = way => HSF.lineFrom(frame.at, way, 0, size);
        return {
          shape: HSF.join([arm(frame.x), arm(frame.y), arm(frame.z)]),
          data: { kind: "axis",
                  values: [...frame.at, ...frame.x, ...frame.y, ...frame.z] },
        };
      },
    },

    //! A CAMERA, drawn as what it is: a little body and the pyramid of what it
    //! can see, out as far as the thing it is looking at. Drawn rather than
    //! implied, because a camera you cannot see in the model is a camera
    //! nobody remembers is there - and the pyramid is the part that answers
    //! "will the tower be in shot".
    Camera: {
      precondition: f => {
        const eye = readPoint(F.reference(f, "at"))
          || [F.real(f, "x", 0), F.real(f, "y", 0), F.real(f, "z", 0)];
        const target = readPoint(F.reference(f, "look"))
          || [F.real(f, "tx", 0), F.real(f, "ty", 0), F.real(f, "tz", 0)];
        if (length(V.sub(target, eye)) < CONFUSION)
          return "the camera is standing on what it is looking at - move one of them";
        if (F.real(f, "lens", 35) < 1) return "a lens is millimetres, and more than one";
        return null;
      },
      build: f => {
        const eye = readPoint(F.reference(f, "at"))
          || [F.real(f, "x", 0), F.real(f, "y", 0), F.real(f, "z", 0)];
        const target = readPoint(F.reference(f, "look"))
          || [F.real(f, "tx", 0), F.real(f, "ty", 0), F.real(f, "tz", 0)];
        const view = frameOf(eye, target, F.real(f, "roll", 0));
        if (!view) throw new Error("that camera has nowhere to look");
        const lens = F.real(f, "lens", 35);
        const shape = frameAt(Feature_choice(f, "frame"));
        const fov = fovFromLens(lens);
        const size = F.real(f, "size", 600);

        // The pyramid, at the drawn size rather than all the way to the
        // target: a frustum nine hundred metres long is a line across the
        // whole model and tells you nothing.
        const reach = Math.min(size, view.distance * 0.9);
        const corners = cornersOf(view, fov, shape.ratio, reach / view.distance);
        const lines = [];
        for (let i = 0; i < 4; i++) {
          lines.push(HSF.polyline([eye, corners[i]], false));
          lines.push(HSF.polyline([corners[i], corners[(i + 1) % 4]], false));
        }
        // A nick out of the top edge, which is how every camera glyph says
        // which way up it is.
        const top = V.scale(V.add(corners[2], corners[3]), 0.5);
        lines.push(HSF.polyline([corners[3], V.add(top, V.scale(view.up, reach * 0.16)),
                                 corners[2]], false));
        // And the line to what it is actually looking at, dashed by being
        // short: enough to say "that way" without drawing a ruler.
        lines.push(HSF.polyline([eye, V.add(eye, V.scale(view.forward,
          Math.min(view.distance, reach * 1.35)))], false));

        return {
          shape: HSF.join(lines),
          data: { kind: "axis",
                  values: [...eye, ...view.right, ...view.up, ...view.forward] },
          note: saysShot(lens, shape.label, view.distance),
        };
      },
    },

    Cube: {
      precondition: f => {
        if (!readPoint(F.reference(f, "origin"))) return "corner point is missing";
        for (const key of ["dx", "dy", "dz"])
          if (F.real(f, key, 80) <= CONFUSION) return "every side length must be positive";
        return null;
      },
      build: f => {
        const corner = readPoint(F.reference(f, "origin"));
        // The plane supplies the orientation, the point the position.
        const plane = planeAxis(F.reference(f, "plane"));
        const placement = plane
          ? new oc.gp_Ax2(pnt(corner), plane.Direction(), plane.XDirection())
          : new oc.gp_Ax2(pnt(corner), dir([0, 0, 1]));
        return SF.box(placement, F.real(f, "dx", 80), F.real(f, "dy", 80), F.real(f, "dz", 80));
      },
    },

    Sphere: {
      precondition: f => {
        if (!readPoint(F.reference(f, "center"))) return "centre point is missing";
        if (F.real(f, "radius", 50) <= CONFUSION) return "radius must be positive";
        return null;
      },
      build: f => SF.sphere(HSF.planeNormal(readPoint(F.reference(f, "center")), [0, 0, 1]),
                            F.real(f, "radius", 50)),
    },

    Fillet: {
      //! The guard that matters. On an 80 mm cube OpenCascade answers r = 39.9
      //! with IsDone() == true, r = 40 with false, and r = 60 with true again -
      //! so IsDone() cannot be trusted on its own. A radius has to clear half
      //! the body's smallest extent before the kernel is asked at all.
      precondition: f => {
        const source = F.reference(f, "body");
        if (!source) return "no body selected";
        const body = F.shape(source);
        if (!body) return "the body to fillet has not been built";

        const radius = F.real(f, "radius", 10);
        if (radius <= CONFUSION) return "radius must be positive";
        if (countSubShapes(body, EDGE) === 0) return "this body has no edges to round";
        // A fillet needs something with a thickness. Handed a pile of loose
        // surfaces - which is what half the STEP files in the world are -
        // OpenCascade does not refuse, it faults, and a fault is a number with
        // no explanation in it. So the shape is asked what it is first.
        if (countSubShapes(body, SOLID) === 0
            && countSubShapes(body, oc.TopAbs_ShapeEnum.TopAbs_SHELL) === 0)
          return F.name(source) + " has no solid to round - it is " + describeShape(body)
            + ", and a fillet needs a body";

        const smallest = smallestSolidExtent(body);
        if (Number.isFinite(smallest) && radius >= smallest / 2)
          return "radius " + trim(radius) + " mm does not fit: the body is only "
               + trim(smallest) + " mm across, so the limit is " + trim(smallest / 2) + " mm";
        // A pick that has lost its edge is worth saying before the build runs,
        // because the build will still work - with one edge fewer - and a
        // fillet that quietly rounds three of four edges is a drawing error
        // that ships.
        return null;
      },
      //! EVERY EDGE, OR THE ONES PICKED. Nobody picks edges before they have
      //! seen the fillet, so the default is the whole body and the picks are a
      //! narrowing of it - which is also why an empty list has to mean "all"
      //! rather than "none".
      build: f => {
        const body = F.shape(F.reference(f, "body"));
        const radius = F.real(f, "radius", 10);
        const picked = pickedSubs(f, "edges", body, "edge");
        if (!picked.chosen.length)
          throw new Error(picked.whole ? "that body has no edges to round"
            : "none of the picked edges is in this body any more");
        const made = new oc.BRepFilletAPI_MakeFillet(body, oc.ChFi3d_FilletShape.ChFi3d_Rational);
        for (const edge of picked.chosen) made.Add(radius, edge);
        made.Build(new oc.Message_ProgressRange());
        if (!made.IsDone())
          throw new Error("the fillet did not converge at " + trim(radius) + " mm"
            + (picked.whole ? "" : " on those " + picked.chosen.length + " edges"));
        const shape = made.Shape();
        if (!shape || shape.IsNull() || countSubShapes(shape, FACE) === 0)
          throw new Error("the fillet produced an empty shape at " + trim(radius) + " mm");
        return { shape, note: picked.whole ? undefined
          : picked.chosen.length + (picked.chosen.length === 1 ? " edge" : " edges") + " rounded"
            + (picked.lost ? " \u00b7 " + picked.lost + " picked "
                + (picked.lost === 1 ? "edge is" : "edges are")
                + " no longer in this body" : "") };
      },
    },
  };

  const trim = v => (Math.round(v * 10) / 10).toString();

  //! Instances are cheap - what costs is the vertex stream they mesh down to.
  const INSTANCE_LIMIT = 1000;

  //! Every placement of an arrayed feature, as a list of transforms. The first
  //! is the identity, so the source stays exactly where it was drawn.
  function arrayPlacements(f) {
    const placements = [];
    if (Feature_choice(f, "mode") === 0) {
      const nx = Math.max(1, Math.round(F.real(f, "countX", 3)));
      const ny = Math.max(1, Math.round(F.real(f, "countY", 1)));
      const nz = Math.max(1, Math.round(F.real(f, "countZ", 1)));
      const sx = F.real(f, "spacingX", 120);
      const sy = F.real(f, "spacingY", 120);
      const sz = F.real(f, "spacingZ", 120);
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++)
          for (let k = 0; k < nz; k++) {
            const trsf = new oc.gp_Trsf();
            if (i || j || k) trsf.SetTranslation(new oc.gp_Vec(i * sx, j * sy, k * sz));
            placements.push(trsf);
          }
      return placements;
    }

    const count = Math.max(1, Math.round(F.real(f, "count", 6)));
    const sweep = F.real(f, "angle", 360);
    const centre = readPoint(F.reference(f, "center")) || [0, 0, 0];
    const direction = readVector(F.reference(f, "axis"));
    const axis = new oc.gp_Ax1(pnt(centre),
      direction && length(direction) > CONFUSION ? dir(direction) : dir([0, 0, 1]));

    // A full turn closes on itself, so the last copy would land on the first.
    const closed = Math.abs(Math.abs(sweep) - 360) < 1e-6;
    const stride = count < 2 ? 0 : (closed ? sweep / count : sweep / (count - 1));
    for (let i = 0; i < count; i++) {
      const trsf = new oc.gp_Trsf();
      if (i) trsf.SetRotation(axis, (stride * i) * Math.PI / 180);
      placements.push(trsf);
    }
    return placements;
  }

  builders.Array = {
    precondition: f => {
      const source = F.reference(f, "source");
      if (!source) return "no feature selected to array";
      if (!F.shape(source)) return "the feature to array has not been built";

      if (Feature_choice(f, "mode") === 0) {
        const nx = Math.round(F.real(f, "countX", 3));
        const ny = Math.round(F.real(f, "countY", 1));
        const nz = Math.round(F.real(f, "countZ", 1));
        const total = Math.max(1, nx) * Math.max(1, ny) * Math.max(1, nz);
        if (total > INSTANCE_LIMIT)
          return total + " copies is more than this build will make at once (limit "
               + INSTANCE_LIMIT + ")";
        // Copies stacked on top of each other are a modelling mistake, not a shape.
        const box = extents(F.shape(source));
        if (box) {
          const pairs = [["countX", "spacingX", 0], ["countY", "spacingY", 1], ["countZ", "spacingZ", 2]];
          for (const [countKey, spacingKey, axis] of pairs)
            if (Math.round(F.real(f, countKey, 1)) > 1 &&
                Math.abs(F.real(f, spacingKey, 0)) < box.size[axis] * 0.02)
              return "spacing along " + spacingKey.slice(-1)
                   + " is too small - the copies would sit inside each other";
        }
      } else {
        const count = Math.round(F.real(f, "count", 6));
        if (count > INSTANCE_LIMIT)
          return count + " copies is more than this build will make at once (limit "
               + INSTANCE_LIMIT + ")";
        const direction = readVector(F.reference(f, "axis"));
        if (direction && length(direction) < CONFUSION)
          return "the axis vector has no direction";
      }
      return null;
    },
    build: f => {
      const source = F.shape(F.reference(f, "source"));
      const builder = new oc.TopoDS_Builder();
      const compound = new oc.TopoDS_Compound();
      builder.MakeCompound(compound);

      // An instance is the same shape at a different location, not a copy of it.
      // TopoDS_Shape::Moved swaps the TopLoc_Location and leaves the underlying
      // TShape shared, so the B-Rep is built once and triangulated once however
      // many instances there are: at 200 copies of a filleted box that is 4 ms
      // instead of 72 to build, and 49 ms instead of 1698 to mesh.
      for (const trsf of arrayPlacements(f))
        builder.Add(compound, source.Moved(new oc.TopLoc_Location(trsf)));
      return compound;
    },
  };

  /* ------------------------------------------------- the scripting surface

     What a Script feature is handed. Small on purpose: solids, placement and
     booleans, in the units the document is drawn in. Placement goes through
     TopoDS_Shape::Moved, so repeating a shape costs a location and not a
     rebuild - a stair with thirteen identical treads models one.            */

  function axisSystem(opts = {}) {
    const at = opts.at || [0, 0, 0];
    const up = opts.axis || [0, 0, 1];
    if (opts.xdir) return new oc.gp_Ax2(pnt(at), dir(up), dir(opts.xdir));
    return new oc.gp_Ax2(pnt(at), dir(up));
  }

  const asNumber = (value, name) => {
    if (!Number.isFinite(value)) throw new Error(name + " must be a number, got " + value);
    return value;
  };
  const positive = (value, name) => {
    if (!Number.isFinite(value) || value <= CONFUSION)
      throw new Error(name + " must be greater than zero, got " + value);
    return value;
  };

  //! Moving a wire hands back a TopoDS_Shape, and the sweep builders want a
  //! TopoDS_Wire, so the type has to be put back on.
  function asWire(shape, what) {
    if (!shape || typeof shape.ShapeType !== "function")
      throw new Error("the " + what + " is not a shape");
    if (shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_WIRE) return oc.TopoDS.Wire(shape);
    if (shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_EDGE)
      return new oc.BRepBuilderAPI_MakeWire(oc.TopoDS.Edge(shape)).Wire();
    throw new Error("the " + what + " must be a wire");
  }

  //! The script API. A script is written by hand, so this reads the way a
  //! person writes - `cylinder(r, h, { at, axis })` rather than a placement
  //! built first - but every one of these that a factory already does is that
  //! factory call with the arguments unpacked. The ergonomics are here; the
  //! geometry is not.
  function shapeApi() {
    const api = {
      box(dx, dy, dz, opts) { return SF.box(axisSystem(opts), dx, dy, dz); },

      //! A full cylinder, or a pie slice when an angle in degrees is given.
      cylinder(radius, height, opts = {}) {
        return SF.cylinder(axisSystem(opts), radius, height, opts.angle);
      },

      sphere(radius, opts) { return SF.sphere(axisSystem(opts), radius); },

      //! An annular sector: a pie slice with its middle bored out. A stair
      //! tread, in other words.
      sector(innerRadius, outerRadius, angle, thickness, opts) {
        const outer = api.cylinder(positive(outerRadius, "sector outer radius"),
          positive(thickness, "sector thickness"),
          { ...opts, angle: positive(angle, "sector angle") });
        if (!(innerRadius > CONFUSION)) return outer;
        if (innerRadius >= outerRadius)
          throw new Error("the sector's inner radius must be smaller than its outer radius");
        const bore = api.cylinder(innerRadius, thickness * 3,
          { ...opts, at: [(opts && opts.at ? opts.at[0] : 0), (opts && opts.at ? opts.at[1] : 0),
                          (opts && opts.at ? opts.at[2] : 0) - thickness] });
        return api.cut(outer, bore);
      },

      //! A rectangular bar running from one point to another - a stringer, a
      //! baluster, a beam. The bar's length lies along the axis system's main
      //! direction, because gp_Ax2 projects the X direction onto the plane
      //! normal to it: aim a sloping beam with X and it comes out horizontal.
      beam(from, to, width, depth, opts = {}) {
        const along = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        const span = length(along);
        if (span < CONFUSION) throw new Error("a beam needs two different points");
        const w = positive(width, "beam width");
        const d = positive(depth, "beam depth");

        const up = opts.up || [0, 0, 1];
        // Across the run, horizontally; if the run is vertical, any perpendicular will do.
        let across = V.norm(V.cross(up, along)) || V.norm(V.cross([1, 0, 0], along)) || [1, 0, 0];
        const upright = V.norm(V.cross(along, across)) || [0, 0, 1];

        // Centre the section on the line rather than hanging it off one corner.
        const origin = V.add(from, V.add(V.scale(across, -w / 2), V.scale(upright, -d / 2)));
        return new oc.BRepPrimAPI_MakeBox(
          new oc.gp_Ax2(pnt(origin), dir(along), dir(across)), w, d, span).Shape();
      },

      /* --------------------------------------------------------- curves

         A profile is a closed wire; a spine is an open one. Sweeping one along
         the other is how anything with a constant section gets made - a
         handrail, a stringer, a thread.                                    */

      //! A helix, built the way OpenCascade builds one: a straight line in the
      //! (u,v) parameter space of a cylinder, which maps to a helix in space.
      //! It starts at angle zero - at [radius, 0, 0] from the origin given -
      //! and rises by `pitch` every turn.
      helix(radius, pitch, turns, opts = {}) {
        const r = positive(radius, "helix radius");
        const p = asNumber(pitch, "helix pitch");
        const n = positive(turns, "helix turns");

        const surface = new oc.Geom_CylindricalSurface(
          new oc.gp_Ax3(pnt(opts.at || [0, 0, 0]), dir(opts.axis || [0, 0, 1])), r);
        // Advancing 2*pi in u while advancing `pitch` in v is one turn.
        const line = new oc.Geom2d_Line(
          new oc.gp_Ax2d(new oc.gp_Pnt2d(0, 0), new oc.gp_Dir2d(2 * Math.PI, p)));
        const segment = new oc.Geom2d_TrimmedCurve(
          line, 0, n * Math.hypot(2 * Math.PI, p), true, true);

        const edge = new oc.BRepBuilderAPI_MakeEdge(segment, surface).Edge();
        // The edge so far exists only on the surface; give it a 3D curve.
        oc.BRepLib.BuildCurve3d(edge, 1e-5, oc.GeomAbs_Shape.GeomAbs_C1, 14, 0);
        return new oc.BRepBuilderAPI_MakeWire(edge).Wire();
      },

      //! The tangent of that helix where it starts, which is where a profile
      //! has to face to be swept along it.
      helixTangent(radius, pitch) {
        return V.norm([0, radius, pitch / (2 * Math.PI)]) || [0, 1, 0];
      },

      ellipse(major, minor, opts = {}) {
        return HSF.ellipse(axisSystem(opts), major, minor);
      },

      circle(radius, opts = {}) { return HSF.circle(axisSystem(opts), radius); },

      //! A wire through a run of points, closed or not.
      polyline(points, opts = {}) {
        if (!Array.isArray(points)) throw new Error("a polyline needs a list of points");
        return HSF.polyline(points, opts.closed === true);
      },

      //! A rectangle centred on `at`, lying in the plane normal to `axis`. Its
      //! width runs along `xdir` and its height across it, so a stringer's
      //! thickness and depth land on the axes you meant.
      rectangle(width, height, opts = {}) {
        const w = positive(width, "rectangle width") / 2;
        const h = positive(height, "rectangle height") / 2;
        const at = opts.at || [0, 0, 0];
        const normal = V.norm(opts.axis || [0, 0, 1]) || [0, 0, 1];

        const seed = opts.xdir || (Math.abs(normal[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]);
        // Only the part of xdir that lies in the plane can be the width axis.
        const projected = V.add(seed, V.scale(normal, -(seed[0] * normal[0]
          + seed[1] * normal[1] + seed[2] * normal[2])));
        const x = V.norm(projected)
          || V.norm(V.cross(normal, [1, 0, 0])) || V.norm(V.cross(normal, [0, 1, 0]));
        const y = V.norm(V.cross(normal, x));

        const corner = (sx, sy) => V.add(at, V.add(V.scale(x, sx * w), V.scale(y, sy * h)));
        return api.polyline([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
                            { closed: true });
      },

      face(wire) { return HSF.fill(wire); },

      //! Sweeps a profile along a spine. The default keeps the profile upright
      //! the whole way - a handrail does not roll over as it turns - which is
      //! what a constant binormal means; pass frenet: true to let it follow the
      //! curve's own frame instead.
      sweep(profile, spine, opts = {}) {
        const shell = new oc.BRepOffsetAPI_MakePipeShell(asWire(spine, "spine"));
        if (opts.frenet) shell.SetMode(true);
        else shell.SetMode(dir(opts.up || [0, 0, 1]));
        // Correction turns the profile to face along the spine; contact would
        // also slide it onto the spine, which moves the section off centre.
        shell.Add(asWire(profile, "profile"), opts.contact === true, opts.correct !== false);
        shell.Build(new oc.Message_ProgressRange());
        if (!shell.IsDone()) throw new Error("the sweep did not succeed");
        if (opts.solid !== false && !shell.MakeSolid())
          throw new Error("the sweep did not close into a solid");
        return shell.Shape();
      },

      //! Lofts through a run of profiles - the way the neck thread of the
      //! OpenCascade bottle is made.
      loft(profiles, opts = {}) {
        const list = [].concat(profiles).filter(Boolean).map(w => asWire(w, "loft profile"));
        return opts.solid !== false ? SF.loft(list, opts.ruled === true)
                                    : HSF.loft(list, opts.ruled === true);
      },

      //! Sweeps a face or a wire straight along a vector. A face gives a body,
      //! a wire gives a skin, which is the difference between the two factories
      //! stated as an argument rather than as a choice.
      prism(base, along) {
        return base.ShapeType() === FACE ? SF.pad(base, along) : HSF.extrude(base, along);
      },

      //! A round tube through a run of points: a cylinder per segment, a sphere
      //! at every joint so the corners close. For anything smooth, sweep a
      //! circle along a proper spine instead.
      tube(points, radius) {
        const r = positive(radius, "tube radius");
        if (!Array.isArray(points) || points.length < 2)
          throw new Error("a tube needs at least two points");
        const parts = [];
        for (let i = 0; i < points.length - 1; i++) {
          const along = [points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1],
                         points[i + 1][2] - points[i][2]];
          const span = length(along);
          if (span < CONFUSION) continue;
          parts.push(new oc.BRepPrimAPI_MakeCylinder(
            new oc.gp_Ax2(pnt(points[i]), dir(along)), r, span).Shape());
        }
        for (let i = 1; i < points.length - 1; i++) parts.push(api.sphere(r, { at: points[i] }));
        return api.compound(parts);
      },

      move(shape, by) {
        return SF.move(shape, [asNumber(by[0], "dx"), asNumber(by[1], "dy"),
                               asNumber(by[2], "dz")]);
      },

      rotate(shape, degrees, opts = {}) {
        return SF.rotate(shape, opts.at || [0, 0, 0], opts.axis || [0, 0, 1],
                         asNumber(degrees, "angle"));
      },

      cut(a, b) { return SF.remove(a, b); },
      fuse(a, b) { return SF.add(a, b); },
      common(a, b) { return SF.intersect(a, b); },

      fillet(shape, radius) { return SF.fillet(shape, radius); },

      compound(shapes) {
        const list = [].concat(shapes).filter(Boolean);
        if (!list.length) throw new Error("nothing to assemble");
        return SF.assemble(list);
      },
    };
    return api;
  }

  //! Compiles the source and reads back what it declares. Anything the script
  //! gets wrong - a syntax error, a missing build, a malformed parameter -
  //! surfaces here rather than half-way through modelling.
  function compileScript(source) {
    let module;
    try {
      module = new Function('"use strict"; return (' + source + ");")();
    } catch (err) {
      throw new Error("the code did not compile: " + (err && err.message ? err.message : err));
    }
    if (!module || typeof module !== "object")
      throw new Error("the code must evaluate to an object with params and build");
    if (typeof module.build !== "function")
      throw new Error("the code must define build(params, kernel)");

    const params = [];
    for (const raw of module.params || []) {
      if (!raw || typeof raw.key !== "string" || !raw.key)
        throw new Error("every parameter needs a key");

      // A parameter that names its alternatives is a switch, not a slider. The
      // value stored is still a number - the index - so nothing below here
      // needs to know the difference.
      if (Array.isArray(raw.options)) {
        if (raw.options.length < 2)
          throw new Error("'" + raw.key + "' needs at least two options");
        params.push({
          key: raw.key,
          label: typeof raw.label === "string" ? raw.label : raw.key,
          options: raw.options.map(String),
          def: Number.isFinite(raw.def) ? Math.round(raw.def) : 0,
          min: 0, max: raw.options.length - 1, step: 1, unit: "",
        });
        continue;
      }

      params.push({
        key: raw.key,
        label: typeof raw.label === "string" ? raw.label : raw.key,
        def: Number.isFinite(raw.def) ? raw.def : 0,
        min: Number.isFinite(raw.min) ? raw.min : 0,
        max: Number.isFinite(raw.max) ? raw.max : 100,
        step: Number.isFinite(raw.step) && raw.step > 0 ? raw.step : 1,
        unit: typeof raw.unit === "string" ? raw.unit : "mm",
      });
    }
    if (params.length > 40) throw new Error("a script may declare at most 40 parameters");
    return { module, params };
  }

  builders.Script = {
    //! Compiling is part of the check: a script that will not compile never
    //! reaches the kernel, and the parameters it declares are reconciled with
    //! the ones already stored before anything is built.
    precondition: f => {
      const source = F.code(f, "code", "");
      if (!source.trim()) return "there is no code to run";
      try {
        const { params } = compileScript(source);
        F.syncParams(f, params);
      } catch (err) {
        return err.message;
      }
      return null;
    },
    build: f => {
      const { module, params } = compileScript(F.code(f, "code", ""));
      const stored = F.paramValues(f);
      const values = {};
      for (const spec of params)
        values[spec.key] = clampTo(spec, stored[spec.key] ?? spec.def);

      const shape = module.build(values, shapeApi());
      if (!shape || typeof shape.IsNull !== "function" || shape.IsNull())
        throw new Error("build() must return a shape");
      return shape;
    },
  };

  // The same driver behind both: what differs is only the code it starts with.
  builders.Ribbon = builders.Script;
  builders.Center = builders.Script;

  /* ==========================================================================
     Data.

     Half of what follows builds no geometry at all. A Number, a Series, a bit
     of arithmetic - they compute, and what they compute is wired into the
     sliders of the features that do build. The other half runs the other way:
     a point taken off a curve, a length taken off a solid, back out as numbers.

     Lists travel through the data components. The solid components read the
     first item and say so; making a hundred cubes from a hundred numbers is a
     data tree, and this is not one.
     ========================================================================== */

  //! Grasshopper's longest-list rule: the shortest input repeats its last item
  //! until the longest is exhausted.
  function zip(lists) {
    const n = Math.max(1, ...lists.map(l => l.length));
    const out = [];
    for (let i = 0; i < n; i++)
      out.push(lists.map(l => (l.length ? l[Math.min(i, l.length - 1)] : 0)));
    return out;
  }

  const numbers = values => ({ kind: "number", values });
  const points = list => ({ kind: "point", values: list.flat() });
  const vectors = list => ({ kind: "vector", values: list.flat() });
  const text = lines => ({ kind: "text", values: [], lines });

  //! Every vertex of a shape, in the order OpenCascade walks them.
  //! The vertices a feature put there on purpose: the ones standing free in the
  //! shape, not the two at the ends of every edge. A curve made of two hundred
  //! segments has four hundred vertices and none of them is a point anybody
  //! asked for, so the search does not descend into edges.
  function verticesOf(shape) {
    const out = [];
    if (!shape) return out;
    if (shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_VERTEX) {
      const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(shape));
      return [[p.X(), p.Y(), p.Z()]];
    }
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, EDGE);
    const seen = new Set();
    while (explorer.More()) {
      const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(explorer.Current()));
      const key = p.X().toFixed(6) + "," + p.Y().toFixed(6) + "," + p.Z().toFixed(6);
      if (!seen.has(key)) { seen.add(key); out.push([p.X(), p.Y(), p.Z()]); }
      explorer.Next();
    }
    explorer.delete();
    return out;
  }

  //! The points arriving on an input: what the source computed if it computed
  //! points, and otherwise the vertices of whatever it built.
  function pointsFrom(source) {
    if (!source) return [];
    const data = F.data(source);
    if (data && data.stride === 3) return F.triples(data);
    return verticesOf(F.shape(source));
  }

  //! Every point arriving on an input, from every wire on it, in the order they
  //! were wired. One source or five reads the same to whatever consumes it,
  //! which is what lets three separate points make a polyline.
  const pointsOf = (f, key) => F.references(f, key).flatMap(pointsFrom);

  const compoundOf = shapes => {
    const builder = new oc.TopoDS_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    for (const shape of shapes) if (shape) builder.Add(compound, shape);
    return compound;
  };
  const vertexAt = p => new oc.BRepBuilderAPI_MakeVertex(pnt(p)).Shape();
  const segment = (a, b) =>
    length([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) < CONFUSION
      ? null : new oc.BRepBuilderAPI_MakeEdge(pnt(a), pnt(b)).Shape();

  builders.Number = {
    build: f => ({ data: numbers([F.real(f, "value", 100)]) }),
  };

  builders.Series = {
    precondition: f => F.real(f, "count", 10) < 1 ? "a series needs at least one item" : null,
    build: f => {
      const start = F.real(f, "start", 0), step = F.real(f, "step", 10);
      const count = Math.max(1, Math.round(F.real(f, "count", 10)));
      return { data: numbers(Array.from({ length: count }, (_, i) => start + i * step)) };
    },
  };

  builders.Range = {
    build: f => {
      const from = F.real(f, "from", 0), to = F.real(f, "to", 1);
      const steps = Math.max(1, Math.round(F.real(f, "steps", 10)));
      // n steps means n + 1 stations, both bounds included - the way a range of
      // parameters along a curve has to come out.
      return { data: numbers(Array.from({ length: steps + 1 },
        (_, i) => from + (to - from) * (i / steps))) };
    },
  };

  const MATH_OPS = [
    (a, b) => a + b, (a, b) => a - b, (a, b) => a * b, (a, b) => a / b,
    (a, b) => Math.pow(a, b), Math.min, Math.max, (a, b) => a % b,
  ];

  builders.Math = {
      //! Pairs up its own lists - see Driver.spreadLists.
      ownLists: true,
    precondition: f => {
      const op = Feature_choice(f, "op");
      if ((op === 3 || op === 7) && F.reals(f, "b", 1).every(b => Math.abs(b) < 1e-12))
        return "B is zero, and this operation divides by it";
      return null;
    },
    build: f => {
      const apply = MATH_OPS[Feature_choice(f, "op")] || MATH_OPS[0];
      const pairs = zip([F.reals(f, "a", 1), F.reals(f, "b", 1)]);
      return { data: numbers(pairs.map(([a, b]) => {
        const v = apply(a, b);
        return Number.isFinite(v) ? v : 0;
      })) };
    },
  };

  builders.Expression = {
      //! Pairs up its own lists - see Driver.spreadLists.
      ownLists: true,
    //! Compiled before anything reads it, so a half-written formula reads as a
    //! syntax error rather than as a modelling failure.
    precondition: f => {
      const source = F.code(f, "formula", "").trim();
      if (!source) return "there is no formula";
      try { compileFormula(source); } catch (err) { return err.message; }
      return null;
    },
    build: f => {
      const evaluate = compileFormula(F.code(f, "formula", "").trim());
      const rows = zip([F.reals(f, "a", 1), F.reals(f, "b", 1), F.reals(f, "c", 0)]);
      return { data: numbers(rows.map(([a, b, c], i) => {
        const v = evaluate(a, b, c, i, rows.length);
        if (!Number.isFinite(v))
          throw new Error("the formula gave " + v + " at item " + (i + 1));
        return v;
      })) };
    },
  };

  //! One expression over a, b, c, and the position i in a list of n. Built with
  //! the same Function the written features use; it can read nothing it is not
  //! handed, so it cannot reach the document or the page.
  const formulaCache = new Map();
  function compileFormula(source) {
    if (formulaCache.has(source)) return formulaCache.get(source);
    let fn;
    try {
      fn = new Function("a", "b", "c", "i", "n", "Math",
        '"use strict"; return (' + source + ");");
    } catch (err) {
      throw new Error("the formula will not compile: " + (err.message || err));
    }
    const wrapped = (a, b, c, i, n) => {
      const v = fn(a, b, c, i, n, Math);
      if (typeof v !== "number") throw new Error("the formula gave " + typeof v + ", not a number");
      return v;
    };
    if (formulaCache.size > 60) formulaCache.clear();
    formulaCache.set(source, wrapped);
    return wrapped;
  }

  //! A story computes nothing and builds nothing: it is a sequence, and what
  //! it does it does to the VIEW. What it publishes is a line about itself, so
  //! the tree says how long it runs without anybody opening it.
  builders.Story = {
    precondition: () => null,
    build: f => {
      const beats = readStory(F.text(f, "beats", "[]"));
      const missing = beats.filter(b => b.camera && !doc.find(b.camera));
      return { data: text([saysStory(beats)]),
               note: missing.length
                 ? missing.length + (missing.length === 1 ? " beat names a camera"
                     : " beats name cameras") + " that is not in this document"
                 : undefined };
    },
  };

  builders.Panel = {
    precondition: f => F.reference(f, "input") ? null : "nothing is wired into this panel",
    build: f => {
      const source = F.reference(f, "input");
      const data = F.data(source);
      if (data && (data.values.length || data.lines.length))
        return { data: text(dataLines(data)) };
      // Nothing computed: say what was built instead, which is still an answer.
      const shape = F.shape(source);
      if (!shape) return { data: text([F.name(source) + " has not been built"]) };
      const box = extents(shape);
      return { data: text([
        F.name(source) + " · " + shapeKind(shape),
        countSubShapes(shape, SOLID) + " solids · " + countSubShapes(shape, FACE) + " faces · "
          + countSubShapes(shape, EDGE) + " edges",
        box ? "size " + box.size.map(trim).join(" × ") + " mm" : "empty",
      ]) };
    },
  };

  /* ------------------------------------------------------------- curves */

  //! The wire of a curve-producing feature. An edge is promoted; anything else
  //! is refused by name rather than crashing the builder it was handed to.
  //! Whatever a shape offers, as one wire. The factories take shapes, so this
  //! is the form they are handed; the feature form below is the same thing with
  //! the label read off first.
  const WIRE = oc.TopAbs_ShapeEnum.TopAbs_WIRE;

  //! Is this wire a loop? Asked of the wire rather than of its Closed() flag,
  //! which is only as true as whoever built it remembered to set it: a wire of
  //! n edges is closed when it has n corners rather than n + 1.
  function wireIsClosed(wire) {
    const edges = subShapes(wire, EDGE, oc.TopoDS.Edge).length;
    if (!edges) return false;
    const corners = [];
    for (const v of subShapes(wire, VERTEX, oc.TopoDS.Vertex))
      if (!corners.some(other => other.IsSame(v))) corners.push(v);
    return corners.length === edges;
  }

  //! How big a wire is, as its bounding box's diagonal. What "the outer one"
  //! means when a drawing hands over a rectangle and the circle inside it.
  function wireSpan(wire) {
    const box = new oc.Bnd_Box();
    oc.BRepBndLib.Add(wire, box, false);
    if (box.IsVoid()) { box.delete(); return 0; }
    const lo = box.CornerMin(), hi = box.CornerMax();
    const span = Math.hypot(hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z());
    box.delete();
    return span;
  }

  //! ONE WIRE OUT OF WHATEVER ARRIVED, and the truth about how many there
  //! were.
  //!
  //! A DRAWING IS NOT ONE LOOP. A sketch with a rectangle and a circle in it
  //! is two, and pouring every edge of both into a single BRepBuilderAPI_
  //! MakeWire answers "BRep_API: command not done" - which is what stopped a
  //! perfectly good sketch being a loft section. Several loops means the outer
  //! one, because that is what a section IS: the hole in it is a second loft
  //! and a cut, not something ThruSections has a word for. Closed first, then
  //! biggest, so a stray line left in the drawing cannot win.
  function wiresFrom(shape, what = "curve") {
    if (!shape) throw new Error("the " + what + " has not been built");
    if (shape.ShapeType() === WIRE) return { wires: [oc.TopoDS.Wire(shape)], loose: false };
    if (shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_EDGE)
      return { wires: [new oc.BRepBuilderAPI_MakeWire(oc.TopoDS.Edge(shape)).Wire()],
               loose: false };
    const found = uniqueSubs(shape, WIRE, oc.TopoDS.Wire);
    if (found.length) return { wires: found, loose: false };
    // No wires at all: loose edges, which is what a curve node hands over.
    const edges = subShapes(shape, EDGE, oc.TopoDS.Edge);
    if (!edges.length) throw new Error("the " + what + " has no edges");
    const maker = new oc.BRepBuilderAPI_MakeWire();
    for (const edge of edges) maker.Add(edge);
    if (!maker.IsDone())
      throw new Error("the " + what + " is several separate runs, so it is not one wire");
    return { wires: [maker.Wire()], loose: true };
  }

  function wireFrom(shape, what = "curve") {
    const { wires } = wiresFrom(shape, what);
    if (wires.length === 1) return wires[0];
    const closed = wires.filter(wireIsClosed);
    const among = closed.length ? closed : wires;
    return among.reduce((best, one) => wireSpan(one) > wireSpan(best) ? one : best, among[0]);
  }

  //! The same, and how many it had to choose between - so an operation can say
  //! "the outer loop of Sketch.1" rather than quietly using one of three.
  function outlineOf(source, what) {
    const shape = source && F.shape(source);
    const { wires } = wiresFrom(shape, what);
    return { wire: wireFrom(shape, what), many: wires.length };
  }

  const wireOf = (source, what) => wireFrom(source && F.shape(source), what);

  function firstFace(shape, what) {
    if (!shape) throw new Error("the " + what + " has not been built");
    const explorer = new oc.TopExp_Explorer(shape, FACE, ANY);
    if (!explorer.More()) { explorer.delete(); throw new Error("the " + what + " has no faces"); }
    const face = oc.TopoDS.Face(explorer.Current());
    explorer.delete();
    return face;
  }

  const subShapes = (shape, kind, cast) => {
    const explorer = new oc.TopExp_Explorer(shape, kind, ANY);
    const out = [];
    while (explorer.More()) { out.push(cast(explorer.Current())); explorer.Next(); }
    explorer.delete();
    return out;
  };

  /* ================================================ picking one edge, or one face

     AN OPERATION ABOUT PARTICULAR EDGES has to be able to say which, in a file,
     in a way that still means the same edges tomorrow. The whole of that is in
     subshape.js and is nothing to do with OpenCascade; what is here is the two
     halves that are.

     THE ORDER HAS TO BE THE SAME ORDER, every time and on both sides: the list
     the viewport picks from and the list the driver rounds have to be the same
     list, or "edge 2" means one edge on screen and another in the build. So
     there is exactly one enumeration, \ref uniqueSubs, and everything uses it.

     AND IT HAS TO BE UNIQUE. TopExp_Explorer walks an edge once per face on
     it, so a cube's twelve edges arrive as twenty-four; a person who picked the
     seventh would have picked something that is not there twice. They are
     deduped by where they are, which on a real shape is exact - two visits to
     one edge have the same geometry - and settled with IsSame where two
     genuinely different sub-shapes land in the same bucket.                 */

  function uniqueSubs(shape, kind, cast) {
    const all = subShapes(shape, kind, cast);
    const buckets = new Map();
    const out = [];
    for (const one of all) {
      const box = new oc.Bnd_Box();
      oc.BRepBndLib.Add(one, box, false);
      let key = "empty";
      if (!box.IsVoid()) {
        const lo = box.CornerMin(), hi = box.CornerMax();
        key = [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()]
          .map(v => Math.round(v * 1e4)).join(",");
      }
      box.delete();
      const seen = buckets.get(key);
      if (seen && seen.some(other => other.IsSame(one))) continue;
      if (seen) seen.push(one); else buckets.set(key, [one]);
      out.push(one);
    }
    return out;
  }

  const eachEdge = shape => uniqueSubs(shape, EDGE, oc.TopoDS.Edge);
  const eachFace = shape => uniqueSubs(shape, FACE, oc.TopoDS.Face);
  //! THE CORNERS OF A WIRE, once each and in the order the wire runs - which
  //! matters, because a corner is named by its number and a number that means
  //! a different corner after a rebuild is worse than no number at all.
  const eachVertex = shape => uniqueSubs(shape, VERTEX, oc.TopoDS.Vertex);

  //! WHAT THE VIEWPORT PICKS FROM. Every edge as the polyline it is drawn
  //! with, every face as its own triangles - so a click can be tested against
  //! one edge rather than against the whole body, and the one under the pointer
  //! can be lit up before it is chosen.
  //!
  //! Asked for only while somebody is picking, which is why it can afford to
  //! tessellate each face on its own.
  function pickList(shape, kind) {
    const rough = deflectionFor(shape);
    const out = [];
    //! A CORNER IS A POINT, and a point cannot be clicked - there is nothing
    //! of it to hit. So each one is offered as a small three-armed cross, in
    //! the model's own units, which the viewport draws and the ray tests
    //! exactly as it tests an edge. One kind of item, one hit test, one
    //! highlight; the only difference is the shape of the thing drawn.
    if (kind === "vertex") {
      const arm = Math.max(deflectionFor(shape) * 6, 1e-6);
      for (const corner of eachVertex(shape)) {
        const p = oc.BRep_Tool.Pnt(corner);
        const at = [p.X(), p.Y(), p.Z()];
        const lines = [];
        for (const way of [[arm, 0, 0], [0, arm, 0], [0, 0, arm]])
          lines.push(at[0] - way[0], at[1] - way[1], at[2] - way[2],
                     at[0] + way[0], at[1] + way[1], at[2] + way[2]);
        out.push({ at: out.length, lines, points: [at], near: at.slice() });
      }
      return out;
    }
    if (kind === "face") {
      for (const face of eachFace(shape)) {
        const mesh = oc.ReplicadMeshExtractor.extract(face, rough, 0.3, false);
        const positions = readFloats(mesh.getVerticesPtr(), mesh.getVerticesSize());
        const index = readInts(mesh.getTrianglesPtr(), mesh.getTrianglesSize());
        const normals = readFloats(mesh.getNormalsPtr(), mesh.getNormalsSize());
        mesh.delete();
        out.push({ at: out.length, positions, index, normals,
                   near: faceAnchor(positions, index) });
      }
      return out;
    }
    for (const edge of eachEdge(shape)) {
      const drawn = oc.ReplicadEdgeMeshExtractor.extract(edge, rough, 0.3);
      const flat = readFloats(drawn.getLinesPtr(), drawn.getLinesSize());
      drawn.delete();
      // The extractor gives line SEGMENTS; the walk wants a run of points.
      const points = [];
      for (let i = 0; i + 5 < flat.length; i += 6) {
        if (!points.length) points.push([flat[i], flat[i + 1], flat[i + 2]]);
        points.push([flat[i + 3], flat[i + 4], flat[i + 5]]);
      }
      out.push({ at: out.length, lines: Array.from(flat), points,
                 near: edgeAnchor(points) });
    }
    return out;
  }

  //! The sub-shapes an argument's picks resolve to, today. An empty list of
  //! picks is the operation's own default and comes back as everything; a pick
  //! that has lost what it was about is left out and counted, so the driver can
  //! say so rather than quietly doing less.
  function pickedSubs(f, key, shape, kind) {
    const picks = readPicks(F.picks(f, key));
    const all = kind === "face" ? eachFace(shape)
              : kind === "vertex" ? eachVertex(shape) : eachEdge(shape);
    if (!picks.length) return { chosen: all, lost: 0, whole: true };
    const parts = pickList(shape, kind);
    const anchors = parts.map(one => one.near);
    const { found, lost } = resolvePicks(anchors, picks);
    //! AND THEN GROWN AGAIN, against the shape as it is now.
    //!
    //! This is the whole of what makes a fillet survive its cylinder being
    //! resized. Double-clicking an edge used to walk the arris once, at the
    //! time of the click, and write down the edges it found - the selection
    //! stored, the reason for it thrown away. Rebuild with the arris split in
    //! two and the fillet rounds the half it remembers.
    //!
    //! Re-asked here, every rebuild, the pick is a seed and the rule grows it:
    //! a face that has joined the arris is taken, one that has left is not
    //! missed. A vertex has nothing to spread along, so it never grows.
    const rule = F.pickMode(f, key);
    const chosen = kind === "vertex" || rule.mode === "one"
      ? found
      : growPicks(kind, kind === "face" ? parts : parts.map(one => one.points), found, rule);
    return { chosen: chosen.map(at => all[at]).filter(Boolean),
             lost: lost.length, whole: false };
  }

  //! Every face a profile offers, capping its wires if it offers none. What a
  //! solid is swept from.
  function capped(f, source) {
    const faces = subShapes(source, FACE, oc.TopoDS.Face);
    if (faces.length) return faces;
    const wires = subShapes(source, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopoDS.Wire);
    const out = [];
    for (const wire of wires.length ? wires : [wireOf(F.reference(f, "profile"), "profile")]) {
      try {
        const face = new oc.BRepBuilderAPI_MakeFace(wire, true);
        if (face.IsDone()) out.push(face.Face());
      } catch (e) { /* an open wire will not cap; it is not a solid */ }
    }
    // Nothing capped: sweep it open rather than fail, and say so by shape.
    return out.length ? out : wires;
  }

  //! Every wire a profile offers, taken off its faces when it has them. What a
  //! surface is swept from.
  function outlines(f, source) {
    const wires = subShapes(source, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopoDS.Wire);
    if (wires.length) return wires;
    return [wireOf(F.reference(f, "profile"), "profile")];
  }

  /* ------------------------------------------------ the drawn curve family

     WHERE A SHAPE STANDS, and what the plane has to do with it. A plane can
     mean two things and CAD has always been sloppy about which: it can be the
     SUPPORT a thing lies on, or it can only be saying WHICH WAY the thing
     faces. Wire a point two metres above a plane into a circle and both
     answers are defensible - a circle on the plane under the point, or a
     circle two metres up facing the same way. So it is asked rather than
     assumed, on every one of these.                                        */

  //! The frame a drawn curve stands in: the plane's direction, at the centre
  //! point if one is wired, and turned within the plane by \p angle. The
  //! centre is dropped onto the plane or left where it is, as the node says.
  function seatOn(f, centreKey = "centre", angleKey = "angle") {
    const axis = planeAxis(F.reference(f, "plane"));
    if (!axis) return null;
    const N = axis.Direction(), X = axis.XDirection();
    const n = [N.X(), N.Y(), N.Z()], x = [X.X(), X.Y(), X.Z()];
    const here = axis.Location();
    let at = [here.X(), here.Y(), here.Z()];
    const asked = readPoint(F.reference(f, centreKey));
    if (asked) at = Feature_choice(f, "onPlane") === 1
      ? V.sub(asked, V.scale(n, V.dot(V.sub(asked, at), n)))   // dropped onto it
      : asked;                                                  // left where it is
    const turn = angleKey ? F.real(f, angleKey, 0) * Math.PI / 180 : 0;
    const Y = axis.YDirection();
    const y = [Y.X(), Y.Y(), Y.Z()];
    const along = V.add(V.scale(x, Math.cos(turn)), V.scale(y, Math.sin(turn)));
    const across = V.add(V.scale(x, -Math.sin(turn)), V.scale(y, Math.cos(turn)));
    return { at, n, x: along, y: across,
             ax: new oc.gp_Ax2(pnt(at), dir(n), dir(along)),
             //! Two numbers on the plane, one point in the world.
             on: uv => V.add(at, V.add(V.scale(along, uv[0]), V.scale(across, uv[1]))) };
  }

  const planeNeeded = what => f =>
    planeAxis(F.reference(f, "plane")) ? null : "a plane is needed to put the " + what + " on";

  builders.Circle = {
    precondition: f => {
      if (!planeAxis(F.reference(f, "plane"))) return "a plane is needed to put the circle on";
      if (Feature_choice(f, "kind") === 0 && F.real(f, "radius", 60) <= CONFUSION)
        return "radius must be positive";
      return null;
    },
    build: f => {
      const seat = seatOn(f, "centre", null);
      let radius = F.real(f, "radius", 60);
      if (Feature_choice(f, "kind") === 1) {
        // SIZED BY A POINT IT PASSES THROUGH. Measured in the plane, not in
        // space: a point a little off the plane should not make the circle
        // bigger by the amount it is off, it should make one that passes
        // under it.
        const through = readPoint(F.reference(f, "through"));
        if (!through) throw new Error("wire in the point it has to pass through");
        const out = V.sub(through, seat.at);
        const flat = V.sub(out, V.scale(seat.n, V.dot(out, seat.n)));
        radius = V.length(flat);
        if (radius <= CONFUSION)
          throw new Error("that point is the centre, so there is no circle through it");
      }
      return { shape: HSF.circle(seat.ax, radius),
               note: "r " + Math.round(radius * 100) / 100 };
    },
  };

  builders.Ellipse = {
    precondition: f => {
      const said = planeNeeded("ellipse")(f);
      if (said) return said;
      if (F.real(f, "minor", 70) > F.real(f, "major", 120))
        return "the short radius cannot be longer than the long one";
      return null;
    },
    build: f => {
      let seat = seatOn(f, "centre", "angle");
      // POINTED AT SOMETHING rather than typed: the long axis turned to face a
      // point is how an ellipse gets lined up with a street or a site edge,
      // and it stays lined up when the point moves.
      const towards = readPoint(F.reference(f, "towards"));
      if (towards) {
        const out = V.sub(towards, seat.at);
        const flat = V.sub(out, V.scale(seat.n, V.dot(out, seat.n)));
        if (V.length(flat) > CONFUSION) {
          const along = V.norm(flat);
          const across = V.cross(seat.n, along);
          seat = { ...seat, x: along, y: across,
                   ax: new oc.gp_Ax2(pnt(seat.at), dir(seat.n), dir(along)),
                   on: uv => V.add(seat.at, V.add(V.scale(along, uv[0]),
                                                  V.scale(across, uv[1]))) };
        }
      }
      const major = F.real(f, "major", 120), minor = F.real(f, "minor", 70);
      if (Feature_choice(f, "trim") !== 1)
        return { shape: HSF.ellipse(seat.ax, major, minor),
                 note: major + " × " + minor };
      const from = F.real(f, "from", 0) * Math.PI / 180;
      const to = F.real(f, "to", 180) * Math.PI / 180;
      if (Math.abs(to - from) < 1e-6) throw new Error("an arc of no angle is not an arc");
      const arc = new oc.GC_MakeArcOfEllipse(new oc.gp_Elips(seat.ax, major, minor),
                                             from, to, true);
      if (!arc.IsDone()) throw new Error("that arc of the ellipse is degenerate");
      return { shape: new oc.BRepBuilderAPI_MakeWire(
                 new oc.BRepBuilderAPI_MakeEdge(arc.Value()).Edge()).Wire(),
               note: Math.round((to - from) * 180 / Math.PI) + "° of "
                     + major + " × " + minor };
    },
  };

  //! A PARABOLA OR A HYPERBOLA, SAMPLED. Both are written about their apex in
  //! the plane's own two directions and then walked out along both arms, so
  //! the curve is symmetric about the axis by construction rather than by
  //! arithmetic that has to be got right twice.
  builders.Conic = {
    precondition: planeNeeded("conic"),
    build: f => {
      const seat = seatOn(f, "apex", "angle");
      const focal = Math.max(1e-3, F.real(f, "focal", 60));
      const reach = Math.max(1, F.real(f, "extent", 300));
      const steps = Math.max(8, Math.round(F.real(f, "steps", 96)));
      const hyperbola = Feature_choice(f, "kind") === 1;
      const minor = Math.max(1e-3, F.real(f, "minor", 60));
      const uv = [];
      for (let i = -steps; i <= steps; i++) {
        const t = (i / steps) * reach;
        if (hyperbola) {
          // x = a cosh(u), y = b sinh(u), walked in u so the arms are even.
          const u = (i / steps) * Math.asinh(Math.max(1e-6, reach / minor));
          uv.push([focal * Math.cosh(u) - focal, minor * Math.sinh(u)]);
        } else {
          // y^2 = 4 f x, apex at the origin, opening along the plane's X.
          uv.push([(t * t) / (4 * focal), t]);
        }
      }
      //! Walked out as points and handed back as ONE curve. gp_Parab and
      //! gp_Hypr are not in this build, so a parabola cannot be an analytic
      //! edge here - but it does not have to be a hundred and ninety-two
      //! straight ones either. The samples are exact on the conic; the fit
      //! through them is a B-spline within a hundred-thousandth of the reach.
      return { shape: HSF.fitCurve(uv.map(p => seat.on(p)), false, 0),
               data: { kind: "curve" },
               note: (hyperbola ? "hyperbola" : "parabola") + " · focal "
                     + Math.round(focal * 100) / 100 };
    },
  };

  builders.Oblong = {
    precondition: f => {
      const said = planeNeeded("slot")(f);
      if (said) return said;
      if (F.real(f, "width", 80) <= CONFUSION) return "the width must be positive";
      if (F.real(f, "length", 240) < F.real(f, "width", 80) - CONFUSION)
        return "a slot is at least as long as it is wide - shorter than that is a circle";
      return null;
    },
    build: f => {
      const seat = seatOn(f, "centre", "angle");
      const width = F.real(f, "width", 80), length = F.real(f, "length", 240);
      const r = width / 2, straight = Math.max(0, length / 2 - r);
      const maker = new oc.BRepBuilderAPI_MakeWire();
      const arcTo = (centre, from, to) => {
        const mid = (from + to) / 2;
        const at = a => seat.on([centre + r * Math.cos(a), r * Math.sin(a)]);
        maker.Add(new oc.BRepBuilderAPI_MakeEdge(new oc.GC_MakeArcOfCircle(
          pnt(at(from)), pnt(at(mid)), pnt(at(to))).Value()).Edge());
      };
      const seg = (a, b) => {
        if (V.length(V.sub(b, a)) > CONFUSION)
          maker.Add(new oc.BRepBuilderAPI_MakeEdge(pnt(a), pnt(b)).Edge());
      };
      seg(seat.on([-straight, -r]), seat.on([straight, -r]));
      arcTo(straight, -Math.PI / 2, Math.PI / 2);
      seg(seat.on([straight, r]), seat.on([-straight, r]));
      arcTo(-straight, Math.PI / 2, Math.PI * 1.5);
      if (!maker.IsDone()) throw new Error("the slot would not close");
      return { shape: maker.Wire(), note: length + " × " + width };
    },
  };

  builders.Rectangle = {
    precondition: f => {
      const said = planeNeeded("rectangle")(f);
      if (said) return said;
      if (F.real(f, "width", 240) <= CONFUSION || F.real(f, "height", 160) <= CONFUSION)
        return "a rectangle needs a width and a height";
      if (F.real(f, "radius", 0) > Math.min(F.real(f, "width", 240),
                                            F.real(f, "height", 160)) / 2 + CONFUSION)
        return "the corner radius is more than half the short side - there would be "
             + "nothing left of the straight";
      return null;
    },
    build: f => {
      const seat = seatOn(f, "at", "angle");
      const w = F.real(f, "width", 240), h = F.real(f, "height", 160);
      const r = Math.max(0, Math.min(F.real(f, "radius", 0), Math.min(w, h) / 2));
      // Anchored at the middle, or at the corner the width and height run from.
      const shift = Feature_choice(f, "anchor") === 1 ? [w / 2, h / 2] : [0, 0];
      const flat = uv => seat.on([uv[0] + shift[0], uv[1] + shift[1]]);
      const x = w / 2, y = h / 2;
      const maker = new oc.BRepBuilderAPI_MakeWire();
      const seg = (a, b) => {
        if (V.length(V.sub(flat(a), flat(b))) > CONFUSION)
          maker.Add(new oc.BRepBuilderAPI_MakeEdge(pnt(flat(a)), pnt(flat(b))).Edge());
      };
      const round = (cx, cy, from, to) => {
        const at = a => flat([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        maker.Add(new oc.BRepBuilderAPI_MakeEdge(new oc.GC_MakeArcOfCircle(
          pnt(at(from)), pnt(at((from + to) / 2)), pnt(at(to))).Value()).Edge());
      };
      if (r <= CONFUSION) {
        seg([-x, -y], [x, -y]); seg([x, -y], [x, y]);
        seg([x, y], [-x, y]); seg([-x, y], [-x, -y]);
      } else {
        seg([-x + r, -y], [x - r, -y]);
        round(x - r, -y + r, -Math.PI / 2, 0);
        seg([x, -y + r], [x, y - r]);
        round(x - r, y - r, 0, Math.PI / 2);
        seg([x - r, y], [-x + r, y]);
        round(-x + r, y - r, Math.PI / 2, Math.PI);
        seg([-x, y - r], [-x, -y + r]);
        round(-x + r, -y + r, Math.PI, Math.PI * 1.5);
      }
      if (!maker.IsDone()) throw new Error("the rectangle would not close");
      return { shape: maker.Wire(),
               note: w + " × " + h + (r > CONFUSION ? " · r " + r : "") };
    },
  };



  /* ------------------------------------------------------- the blend curve

     A SPLINE THROUGH POINTS IS A SPLINE. A spline that LEAVES and ARRIVES the
     way you said is a piece of a design, and the difference is one constraint
     per point.

     Written as a cubic Hermite per span, which is the shape that takes a
     direction at each end and a magnitude to go with it. Where no direction
     is given the Catmull-Rom one is used, so a blend curve with nothing said
     about it is exactly the spline node - and every constraint added moves it
     from there rather than from nowhere.

     Tension scales the tangent's LENGTH, not its direction: 1 is the natural
     spline, more bulges out towards the direction before turning, less pulls
     the curve onto its chord. It is the knob every blend tool has and the one
     that is actually used.                                                 */

  //! A direction read off whatever was wired in: a vector, an axis, or a
  //! straight curve to run along. Null when nothing was wired at that
  //! position, which means "work it out from the neighbours".
  function wayFrom(source) {
    if (!source) return null;
    const vector = readVector(source);
    if (vector) return V.norm(vector);
    const axis = readAxisSystem(source);
    if (axis) return V.norm(axis.z);
    const shape = F.shape(source);
    if (!shape) return null;
    const edges = subShapes(shape, EDGE, oc.TopoDS.Edge);
    if (!edges.length) return null;
    const ends = edgeEnds(edges[0]);
    return ends ? V.norm(V.sub(ends[1], ends[0])) : null;
  }

  //! "1, 2, 0.5" - one per point, and whatever is missing falls back to the
  //! one number on the node. Typed, because a tension per point is a row of
  //! small numbers and a row of sliders would be a panel nobody could read.
  function tensionList(text, fallback, many) {
    const said = String(text || "").split(/[,\s]+/).map(Number).filter(Number.isFinite);
    return Array.from({ length: many },
                      (_, i) => (said[i] > 0 ? said[i] : fallback));
  }

  builders.BlendCurve = {
    precondition: f => pointsOf(f, "points").length < 2
      ? "a blend curve needs at least two points to run between" : null,
    build: f => {
      const list = pointsOf(f, "points");
      const closed = Feature_choice(f, "ends") === 1;
      const sources = F.references(f, "tangents");
      const said = list.map((_, i) => wayFrom(sources[i]));
      const tension = tensionList(F.text(f, "tensions"),
                                  Math.max(0.05, F.real(f, "tension", 1)), list.length);
      const strict = Feature_choice(f, "honour") === 0;
      const n = list.length;
      const at = i => list[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];

      //! The tangent AT each point. Where one was given it is used, turned to
      //! run the way the curve is already going so a direction wired in
      //! backwards does not fold the curve over - unless it was asked to be
      //! honoured exactly, in which case backwards is what was asked for and
      //! the curve turns round.
      const ways = list.map((p, i) => {
        const along = V.sub(at(i + 1), at(i - 1));
        const natural = V.scale(along, 0.5);
        const asked = said[i];
        if (!asked) return V.scale(natural, tension[i]);
        const size = V.length(natural) || V.length(V.sub(at(i + 1), at(i))) || 1;
        const way = strict || V.dot(asked, natural) >= 0 ? asked : V.scale(asked, -1);
        return V.scale(way, size * tension[i]);
      });

      const steps = Math.max(2, Math.round(F.real(f, "steps", 24)));
      const spans = closed ? n : n - 1;
      const out = [];
      for (let s = 0; s < spans; s++) {
        const p0 = at(s), p1 = at(s + 1);
        const m0 = ways[((s % n) + n) % n], m1 = ways[((s + 1) % n + n) % n];
        for (let j = 0; j < steps; j++) {
          const u = j / steps, u2 = u * u, u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u;
          const h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
          out.push([0, 1, 2].map(k =>
            h00 * p0[k] + h10 * m0[k] + h01 * p1[k] + h11 * m1[k]));
        }
      }
      if (!closed) out.push(list[n - 1]);
      const held = said.filter(Boolean).length;
      //! The Hermite is worked out here and fitted back to one edge: what a
      //! blend curve is FOR is joining two curves smoothly, and a join made of
      //! twenty-four straight steps is not smooth however fine the steps are.
      return { shape: HSF.fitCurve(out, closed, 0),
               data: points(list),
               note: n + " points · " + (held ? held + " with a direction given"
                                                  : "no directions given") };
    },
  };

  /* ---------------------------------------------------- the fill surface

     THE CLASS-A TOOL. BRepOffsetAPI_MakeFilling takes a boundary, and for
     each boundary edge it will take a FACE the new surface has to meet - G0
     touching, G1 tangent, G2 matching curvature - plus points it has to pass
     through. That is exactly CATIA's Fill with constraints, and it is the
     move that makes a patch disappear into the thing around it.

     And it SAYS HOW WELL IT DID. MakeFilling reports the worst gap, the worst
     angle and the worst curvature difference it left behind, which for this
     kind of work is not a detail - a patch that is tangent to within four
     degrees is not tangent, and the only way to know is to be told.        */

//! WHETHER A RUN OF EDGES MAKES A LOOP, and the sentence to say when it does
//! not. In a closed contour every end is shared by exactly two edges; an end
//! that only one edge reaches is a loose one, and the gap is how far it is
//! from the nearest other loose end.
//!
//! Named rather than counted, because "the boundary does not close" sends
//! somebody hunting through thirty curves, and "Sketch.2 and BlendCurve.2 are
//! 500 mm apart" sends them to the wire that is wrong.
function openContour(rows, tol) {
  const close = Math.max(tol, CONFUSION * 10);
  const ends = [];
  for (const row of rows) {
    const pair = edgeEnds(row.edge);
    if (!pair) continue;
    for (const at of pair) {
      const had = ends.find(one => V.length(V.sub(one.at, at)) <= close);
      if (had) { had.count++; if (!had.names.includes(row.name)) had.names.push(row.name); }
      else ends.push({ at, count: 1, names: [row.name] });
    }
  }
  const loose = ends.filter(one => one.count === 1);
  if (!loose.length) return null;

  //! The two loose ends nearest one another, which is the gap somebody has to
  //! close. On a boundary that is open in two places this names the smaller
  //! one; fixing it brings the other into view, which is the right order to
  //! work in anyway.
  let near = null;
  for (let i = 0; i < loose.length; i++)
    for (let j = i + 1; j < loose.length; j++) {
      const span = V.length(V.sub(loose[i].at, loose[j].at));
      if (!near || span < near.span) near = { span, a: loose[i], b: loose[j] };
    }
  const trim = v => Math.round(v * 100) / 100;
  const where = one => one.names.filter(Boolean).join(" and ") || "one of the curves";
  const spot = one => "(" + one.at.map(v => Math.round(v)).join(", ") + ")";
  return "the boundary does not close - a surface is filled INSIDE a loop, and "
       + loose.length + (loose.length === 1 ? " end is loose" : " ends are loose")
       + (near ? ". The nearest two are " + trim(near.span) + " mm apart: "
                 + where(near.a) + " stops at " + spot(near.a) + " and "
                 + where(near.b) + " stops at " + spot(near.b)
               : "")
       + ". Join them up, or raise the tolerance past the gap if it is meant "
       + "to be that rough";
}

//! AND IS THE ANSWER SANE? MakeFilling does not always converge, and when it
//! does not converge it does not say so - it hands back a surface anyway. On
//! a boundary of a hundred small edges spanning metres it can return a sheet
//! two hundred times the size of the loop it was given, which is exactly what
//! "it filled outside my wire" looks like from the outside.
//!
//! So the answer is measured against the question. A patch bounded by a loop
//! cannot be much bigger than the loop: it is a minimum-energy surface, and
//! the minimum-energy surface through a boundary lives within that
//! boundary's own reach. Three times over is generous. Two hundred times is
//! not a surface, it is a failure that forgot to raise.
function sprawl(face, edges) {
  const loop = extents(compoundOf(edges));
  const made = extents(face);
  if (!loop || !made) return null;
  const reach = Math.max(loop.diagonal, CONFUSION);
  return made.diagonal > reach * 3 ? { reach, got: made.diagonal } : null;
}

  //! WHEN THE TANGENCY WILL NOT BUILD, ASK FOR LESS OF IT. GeomPlate reaches
  //! through a face's surface class, and this cut-down WebAssembly kernel does
  //! not carry every one of them. Handed a class it is missing it does not
  //! refuse - it TRAPS, "null function or function signature mismatch" - and a
  //! trap arrives on the Build, long after the Add that caused it, with no
  //! saying which edge it belonged to.
  //!
  //! A DENY-LIST WAS TRIED AND IT WAS WRONG. The draft that started this
  //! holds eight tangencies as an extrude and traps as a draft of that same
  //! extrude, and the faces that changed are cones - but a cone built on its
  //! own holds a tangency perfectly well, as do planes, cylinders, surfaces of
  //! revolution and B-spline patches. So it is not the CLASS that cannot be
  //! held, it is this particular geometry, and no list of type names can know
  //! that in advance.
  //!
  //! So it is found out by asking, in three goes, each one asking for less:
  //! every tangency it was told to hold, then only the ones against flat
  //! faces - the curved corners of a draft are what falls away, and its flats
  //! are what a person was mostly after - then none at all, the boundary held
  //! in place and a sentence saying the tangency was dropped. A patch with an
  //! explanation attached beats an empty tree.
  const HOLD_ALL = 2, HOLD_FLATS = 1, HOLD_NONE = 0;

  function surfaceKind(face) {
    try { return String(new oc.BRepAdaptor_Surface(face, true).GetType()); }
    catch (error) { return ""; }
  }

  const FILL_CONTINUITY = ["C0", "G1", "G2"];

  //! "G1, G2, G0" - one per boundary curve, and whatever is missing falls
  //! back to the one setting on the node.
  function continuityList(text, fallback, many) {
    const said = String(text || "").toUpperCase().split(/[,\s]+/).filter(Boolean)
      .map(word => word === "G0" || word === "C0" ? 0 : word === "G1" ? 1
                 : word === "G2" ? 2 : -1);
    return Array.from({ length: many },
                      (_, i) => (said[i] >= 0 ? said[i] : fallback));
  }

  //! WHICH FACE of a support a boundary edge should meet. A plane has one; a
  //! solid has dozens, and the one that was meant is the one the edge is
  //! lying on - so it is the nearest, measured from the middle of the edge.
  //! Said out loud because it is a rule somebody has to be able to predict.
  function nearestFace(shape, edge) {
    const faces = subShapes(shape, FACE, oc.TopoDS.Face);
    if (!faces.length) return null;
    if (faces.length === 1) return faces[0];
    const ends = edgeEnds(edge);
    const mid = ends ? V.scale(V.add(ends[0], ends[1]), 0.5) : [0, 0, 0];
    const probe = new oc.BRepBuilderAPI_MakeVertex(pnt(mid)).Vertex();
    let best = faces[0], far = Infinity;
    for (const face of faces) {
      const span = gapBetween(probe, face);
      if (Number.isFinite(span) && span < far) { far = span; best = face; }
    }
    return best;
  }

  builders.FillSurface = {
    precondition: f => {
      const boundary = F.references(f, "boundary").filter(one => F.shape(one));
      if (!boundary.length) return "wire in the curves that bound the surface";
      return null;
    },
    build: f => {
      const boundary = F.references(f, "boundary").filter(one => F.shape(one));
      const supports = F.references(f, "supports");
      const degree = Math.max(2, Math.round(F.real(f, "degree", 3)));
      const tol = Math.max(1e-5, F.real(f, "tolerance", 0.01));
      //! TRIED, AND TRIED AGAIN ASKING FOR LESS. A tangency the edge cannot
      //! carry sometimes raises on the Add and sometimes waits and collapses
      //! on the Build - one is a refusal and the other is a wasm trap, and
      //! from out here they are the same thing: this boundary will not take
      //! that constraint. So it goes down the rungs, holding every tangency,
      //! then only the flat ones, then none, and the note says what it let go
      //! of. A patch with a sentence attached beats an empty tree.
      let got = attempt(HOLD_ALL);
      //! WHY IT WOULD NOT TAKE, carried down each rung. A patch that quietly
      //! drops its tangency and says only "it would not build" sends somebody
      //! hunting; the same patch saying what OpenCascade actually objected to
      //! sends them to the thing that is wrong.
      let why = got.refused && got.refused.length ? got.refused[0] : "";
      if (!got.ok) {
        got = attempt(HOLD_FLATS, why);
        if (!got.ok) {
          why = (got.refused && got.refused.length ? got.refused[0] : "") || why;
          got = attempt(HOLD_NONE, why);
        }
      }
      if (!got.ok) throw got.error;
      return got.answer;

      function attempt(rung, why = "") {
      const hold = rung > HOLD_NONE;
      //! NOT EVERY TOLERANCE IS A LENGTH. MakeFilling takes four, and only
      //! two of them are distances: Tol2d is parametric, TolAng is an ANGLE
      //! in radians and TolCurv is a curvature. Scaling all four by the
      //! millimetre tolerance on the node meant that asking for a loose 100
      //! mm fit also asked for an angular tolerance of a thousand radians,
      //! which is not loose, it is meaningless - and the solve it produced
      //! was a surface with no relation to the curves it was given.
      //!
      //! So the node's number is the 3D tolerance, which is what a person
      //! means by it, and the other three keep the values OpenCascade ships.
      const fill = new oc.BRepOffsetAPI_MakeFilling(
        degree, 15, 2, false, 1e-5, tol, 0.01, 0.1, 8, 9);

      //! EVERY EDGE OF EVERY CURVE, flattened, so a boundary given as one
      //! polyline of nine segments is nine edges - which is what MakeFilling
      //! wants - while the continuity is still said per CURVE, which is how a
      //! person thinks about it.
      const rows = [];
      boundary.forEach((one, i) => {
        // ONCE EACH. A sketch that makes faces carries every edge twice - in
        // the face and in the wire - and the same edge handed to MakeFilling
        // twice is the same constraint asked for twice, which is at best
        // wasted work and at worst a contradiction it has to average out.
        for (const edge of eachEdge(F.shape(one)))
          rows.push({ edge, curve: i, name: F.name(one) });
      });
      if (rows.length < 2)
        throw new Error("a surface needs a boundary of at least two edges");
      //! AND DOES IT CLOSE? This is the one thing MakeFilling will not tell
      //! you. Handed a chain with a gap in it, it does not refuse - it solves
      //! an under-determined problem and hands back a surface that sprawls
      //! outside the curves it was given, which is exactly what a broken fill
      //! looks like from the outside. So the loop is checked here, where the
      //! gap can be measured and named.
      const gap = openContour(rows, tol);
      if (gap) throw new Error(gap);
      const wants = continuityList(F.text(f, "each"),
                                   Feature_choice(f, "continuity"), boundary.length);

      let tangential = 0;
      const refused = [];
      const cannot = [];
      for (const row of rows) {
        const level = hold ? (wants[row.curve] || 0) : 0;
        const support = supports[row.curve];
        const face = level > 0 && support && F.shape(support)
          ? nearestFace(F.shape(support), row.edge) : null;
        const shape = oc.GeomAbs_Shape[
          "GeomAbs_" + FILL_CONTINUITY[face ? level : 0]];
        //! A TANGENCY THAT WILL NOT TAKE IS STILL A BOUNDARY. OpenCascade
        //! wants the edge to lie ON the face it is held tangent to, and when
        //! it does not - or when the two are coplanar, so "tangent" asks for a
        //! surface with no room to leave in - it raises rather than answers.
        //! Better to build the patch held in place and SAY the tangency was
        //! refused: a surface you can look at and a sentence saying what it is
        //! missing is a position to work from, and nothing at all is not.
        let took = false;
        const kind = face ? surfaceKind(face).replace("GeomAbs_", "") : "";
        if (face && rung === HOLD_FLATS && kind !== "Plane") {
          //! Set down rather than tried: this rung exists because the last one
          //! trapped, and trying the curved ones again is how you trap again.
          cannot.push(kind.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
        } else if (face) {
          try { fill.Add(row.edge, face, shape, true); took = true; tangential++; }
          catch (error) { refused.push(kernelMessage(error)); }
        }
        if (!took) {
          try { fill.Add(row.edge, oc.GeomAbs_Shape.GeomAbs_C0, true); }
          catch (error) {
            throw new Error("that boundary would not be taken: " + kernelMessage(error));
          }
        }
      }

      const through = pointsOf(f, "through");
      for (const p of through) fill.Add(pnt(p));
      const wanted = through;

      //! A CONSTRAINT THAT IS ACCEPTED AND THEN COLLAPSES. Adding a tangency
      //! to a face OpenCascade will not project the edge onto does not raise
      //! on the Add - it raises, or quietly fails, on the Build, long after
      //! the thing that caused it. So the reason is caught here as well and
      //! carried out with the answer.
      let face = null;
      try {
        fill.Build(new oc.Message_ProgressRange());
        if (fill.IsDone()) face = fill.Shape();
        else if (hold && tangential)
          refused.push("it could not be solved with the tangency held");
      } catch (error) {
        const said = kernelMessage(error);
        if (hold && tangential) refused.push(said);
        return { ok: false, refused, error: new Error("no surface would pass through that "
          + "boundary: " + said) };
      }
      if (!face || face.IsNull()) {
        if (hold && tangential && !refused.length)
          refused.push("it could not be solved with the tangency held");
        return { ok: false, refused, error: new Error("no surface would pass through that "
          + "boundary" + (tangential ? " and meet what it was told to meet" : "")) };
      }
      //! MEASURED, NOT TRUSTED. Raising the number of pieces the surface is
      //! allowed does not save this case - it was tried at twenty and at
      //! forty and the answer was still tens of metres across - so there is
      //! nothing to do but say so and name the tool that does work.
      const wild = sprawl(face, rows.map(one => one.edge));
      if (wild)
        return { ok: false, error: new Error(
          "the filling did not converge - the boundary is "
          + Math.round(wild.reach) + " mm across and the surface that came back is "
          + Math.round(wild.got) + " mm across, so it is nowhere near inside the loop. "
          + "That happens on a boundary of many small edges: this one has " + rows.length
          + " of them, and the filling has a fixed number of pieces to work with. "
          + "For a patch that runs between two rails a Loft through them is the tool "
          + "for it; a fill is for a boundary of a few smooth curves") };

      //! HOW WELL IT DID, in the units somebody argues about: the gap in
      //! millimetres, the tangency as an angle rather than as a sine, and the
      //! curvature as the number the kernel gives.
      const trim = v => Math.round(v * 1e4) / 1e4;
      const said = ["gap " + trim(safely(() => fill.G0Error(), 0)) + " mm"];
      if (tangential) {
        const g1 = safely(() => fill.G1Error(), 0);
        said.push("tangency " + trim(Math.asin(Math.max(-1, Math.min(1, g1)))
                                     * 180 / Math.PI) + "°");
        if (wants.some(w => w === 2))
          said.push("curvature " + trim(safely(() => fill.G2Error(), 0)));
      }
      //! DID IT ACTUALLY REACH THEM? A point constraint is a request, not a
      //! guarantee - MakeFilling weighs it against the boundary and the
      //! smoothness and settles somewhere - so the answer is measured off the
      //! surface it built rather than taken on trust. "Passes through three
      //! points" with no number beside it is the kind of claim that hides a
      //! patch sailing past all three.
      if (wanted.length) {
        const missed = wanted.map(at => distanceTo(face, at)).filter(Number.isFinite);
        const worst = missed.length ? Math.max(...missed) : NaN;
        said.push(wanted.length + (wanted.length === 1 ? " point" : " points")
          + " to pass through"
          + (Number.isFinite(worst) ? ", the furthest missed by " + trim(worst) + " mm"
                                    : ""));
      }
      //! SAID, NOT SWALLOWED. Four of eight held tangent with a sentence
      //! about the other four is a useful answer; "0 held tangent" with no
      //! reason is the report that sent somebody looking.
      if (cannot.length) {
        const sorts = Array.from(new Set(cannot));
        said.push(cannot.length + (cannot.length === 1 ? " edge meets a " : " edges meet a ")
          + sorts.join(" or a ") + ", which this boundary will not take a tangency "
          + "against \u2014 the flat faces are held and the curved ones are not");
      }
      if (refused.length)
        said.push(refused.length + (refused.length === 1 ? " edge" : " edges")
          + " would not take the constraint " + JSON.stringify(refused[0]).slice(1, -1)
          + " \u2014 an edge has to lie ON the face it is held tangent to");
      if (rung === HOLD_NONE && wants.some(one => one > 0))
        said.push("the constraints would not build on this boundary, so it is held "
          + "in place only \u2014 "
          + (why || "an edge has to lie ON the face it meets"));
      return { ok: true, refused, answer: { shape: face,
               note: rows.length + " edges · " + tangential + " held tangent · "
                     + said.join(" · ") } };
      }
    },
  };

  //! HOW FAR APART TWO SHAPES ARE. Loaded and performed rather than
  //! constructed with arguments: this build binds BRepExtrema_DistShapeShape
  //! but NOT the Extrema_ExtFlag enum its longer constructors take, so every
  //! one of those throws before it runs. Caught, it looks like "the two never
  //! came near each other" - which is how a nearest-face search came to
  //! return the first face every time, and a point constraint came to report
  //! nothing at all about whether it had been met. The factory always used
  //! this form; these two did not.
  function gapBetween(a, b) {
    try {
      const gap = new oc.BRepExtrema_DistShapeShape();
      gap.LoadS1(a);
      gap.LoadS2(b);
      gap.Perform();
      return gap.IsDone() && gap.NbSolution() > 0 ? gap.Value() : NaN;
    } catch (error) { return NaN; }
  }

  //! How far a point is from a shape, measured rather than assumed. The one
  //! honest answer to "did the surface go where I told it to".
  const distanceTo = (shape, at) =>
    gapBetween(new oc.BRepBuilderAPI_MakeVertex(pnt(at)).Vertex(), shape);

  const safely = (run, fallback) => { try { return run(); } catch (error) { return fallback; } };

  /* --------------------------------------------- rounding a curve's corners

     THE 2D FILLET. OpenCascade has ChFi2d for this and the WebAssembly build
     does not carry it, so it is done the way a draughtsman does it: at each
     corner, back off along both arms by the tangent length, and swing an arc
     between where you got to.

        L = r / tan(a/2)      how far back along each arm
        d = r / sin(a/2)      how far the centre is from the corner

     where a is the angle the two arms make WITH EACH OTHER. Exact between two
     straight runs, which is nearly every corner anybody wants rounded; where
     an arm is already curved the backing-off is walked along the real curve
     rather than along its tangent, so the arc lands on the curve and meets it
     as near to smoothly as the curve's own bend allows.                    */

  //! The edges of a wire, in the order the wire runs, each with its two ends.
  //! This build has no BRepTools_WireExplorer, so they are chained by their
  //! endpoints - which is what the explorer does anyway.
  function orderedEdges(wire) {
    const edges = subShapes(wire, EDGE, oc.TopoDS.Edge)
      .map(edge => ({ edge, ends: edgeEnds(edge) }))
      .filter(one => one.ends);
    if (edges.length < 2) return edges;
    const near = (a, b) => V.length(V.sub(a, b)) < CONFUSION * 100;
    const left = edges.slice();
    const run = [left.shift()];
    for (let guard = 0; guard < edges.length * 2 && left.length; guard++) {
      const tail = run[run.length - 1].ends[1];
      let took = -1;
      for (let i = 0; i < left.length; i++) {
        if (near(left[i].ends[0], tail)) { took = i; break; }
        if (near(left[i].ends[1], tail)) {
          left[i] = { edge: left[i].edge, ends: [left[i].ends[1], left[i].ends[0]],
                      flipped: true };
          took = i; break;
        }
      }
      if (took < 0) {
        // Not joined onto this end: try the front, which is what happens when
        // the walk started in the middle of an open chain.
        const head = run[0].ends[0];
        for (let i = 0; i < left.length; i++) {
          if (near(left[i].ends[1], head)) { run.unshift(left.splice(i, 1)[0]); took = -2; break; }
          if (near(left[i].ends[0], head)) {
            const one = left.splice(i, 1)[0];
            run.unshift({ edge: one.edge, ends: [one.ends[1], one.ends[0]], flipped: true });
            took = -2; break;
          }
        }
        if (took === -2) continue;
        break;                      // a wire in pieces: round what is joined
      }
      run.push(left.splice(took, 1)[0]);
    }
    return run;
  }

  //! Which way an edge runs at one of its ends, pointing INTO the edge - so
  //! two edges meeting at a corner give the two arms of that corner.
  function wayAtEnd(one, atStart) {
    const adaptor = new oc.BRepAdaptor_Curve(one.edge);
    const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
    // The edge's own parameters run its own way; `ends` has already been put
    // the way the chain runs, so a flipped edge reads its parameters backwards.
    const fromStart = atStart !== !!one.flipped;
    const a = fromStart ? first : last, b = fromStart ? last : first;
    const step = (b - a) * 1e-4;
    const p0 = adaptor.Value(a), p1 = adaptor.Value(a + step);
    return V.norm([p1.X() - p0.X(), p1.Y() - p0.Y(), p1.Z() - p0.Z()]);
  }

  //! How far along an edge from one end you have to go to be \p want away from
  //! that end, as a fraction of the edge. Bisected, because the only thing
  //! that can be asked of a general curve is where it is at a parameter.
  function backOff(one, atStart, want) {
    const adaptor = new oc.BRepAdaptor_Curve(one.edge);
    const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
    const fromStart = atStart !== !!one.flipped;
    const a = fromStart ? first : last, b = fromStart ? last : first;
    const at = t => { const p = adaptor.Value(a + (b - a) * t); return [p.X(), p.Y(), p.Z()]; };
    const seat = at(0);
    if (V.length(V.sub(at(1), seat)) < want) return null;   // the arm is too short
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (V.length(V.sub(at(mid), seat)) < want) lo = mid; else hi = mid;
    }
    return { t: (lo + hi) / 2, at: at((lo + hi) / 2) };
  }

  //! THE NEAREST POINT ON AN EDGE, with the parameter it sits at. Nearest is
  //! the whole point: the line from a point to the nearest place on a curve is
  //! perpendicular to that curve, and perpendicular to the curve at distance r
  //! is what being tangent to a circle of radius r MEANS. So this is how a
  //! fillet finds where it touches without ever solving for a tangent.
  function touchOnEdge(edge, from) {
    try {
      const gap = new oc.BRepExtrema_DistShapeShape();
      gap.LoadS1(new oc.BRepBuilderAPI_MakeVertex(pnt(from)).Vertex());
      gap.LoadS2(edge);
      gap.Perform();
      if (!gap.IsDone() || gap.NbSolution() < 1) return null;
      const p = gap.PointOnShape2(1);
      // AN OUT-PARAMETER COMES BACK AS AN OBJECT. ParOnEdgeS2's second argument
      // is a reference OpenCascade writes the parameter into, and embind hands
      // that back as {t}. Read as a number it is NaN, which then travels: a
      // trim fraction of NaN fails every comparison it is put through, so the
      // corner is quietly counted as too tight and the whole fillet reports
      // "no arc of that radius fits" with nothing wrong with the radius.
      const par = gap.ParOnEdgeS2(1);
      const u = typeof par === "number" ? par : par && par.t;
      if (!Number.isFinite(u)) return null;
      return { at: [p.X(), p.Y(), p.Z()], u, away: gap.Value() };
    } catch (error) { return null; }
  }

  //! Where a parameter on an edge sits as a fraction of the way the CHAIN
  //! walks it, which is the direction everything downstream trims in.
  function chainFraction(one, u) {
    const adaptor = new oc.BRepAdaptor_Curve(one.edge);
    const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
    const a = one.flipped ? last : first, b = one.flipped ? first : last;
    return Math.max(0, Math.min(1, (u - a) / (b - a || 1)));
  }

  //! WHERE A FILLET OF RADIUS r REALLY SITS IN A CORNER.
  //!
  //! Between two straight arms this is trigonometry: back off r/tan(half the
  //! corner) along each arm and put the centre r/sin(half) out along the
  //! bisector. That was already here and it was being handed the wrong angle -
  //! one arm was read pointing INTO the corner and the other pointing out of
  //! it, so the angle used was the corner's SUPPLEMENT. tan and sin of the
  //! wrong half-angle put the centre in the wrong place and the ends at the
  //! wrong distance, and the arc through them was a real arc that met neither
  //! arm tangentially. It came out right at exactly one corner - ninety
  //! degrees, where the supplement is the angle - which is why it looked fine
  //! for as long as it did.
  //!
  //! And straight arms are only half of it: an arm that is a CURVE has a
  //! different tangent at every point along it, so where the fillet touches
  //! depends on where it touches. So the trigonometry is the first guess and
  //! then it is walked in. Each pass takes the nearest point on each arm to
  //! the current centre - nearest is perpendicular, and perpendicular at r is
  //! tangent - and moves the centre to the place that is r out from both. It
  //! settles in two or three passes on a straight corner and half a dozen on
  //! a curved one, and it is CHECKED at the end rather than trusted.
  function filletSeat(armA, armB, corner, radius, guess) {
    let centre = guess;
    let touchA = null, touchB = null;
    for (let pass = 0; pass < 12; pass++) {
      touchA = touchOnEdge(armA.edge, centre);
      touchB = touchOnEdge(armB.edge, centre);
      if (!touchA || !touchB) return null;
      const awayA = V.norm(V.sub(centre, touchA.at));
      const awayB = V.norm(V.sub(centre, touchB.at));
      if (!awayA || !awayB) return null;
      const moved = V.scale(V.add(V.add(touchA.at, V.scale(awayA, radius)),
                                  V.add(touchB.at, V.scale(awayB, radius))), 0.5);
      const step = V.length(V.sub(moved, centre));
      centre = moved;
      if (step < radius * 1e-9) break;
    }
    if (!touchA || !touchB) return null;
    // MEASURED, NOT ASSUMED. The iteration can settle on a centre that is r
    // from neither arm - a corner too tight for the radius does exactly that -
    // and an arc drawn from it would be the wrong arc, drawn confidently.
    const offA = Math.abs(V.length(V.sub(centre, touchA.at)) - radius);
    const offB = Math.abs(V.length(V.sub(centre, touchB.at)) - radius);
    if (offA > radius * 1e-4 || offB > radius * 1e-4) return null;
    // The two touch points have to be on the arms either side of THIS corner,
    // not somewhere else on a curve that loops back past the centre.
    const reachA = V.length(V.sub(touchA.at, corner));
    const reachB = V.length(V.sub(touchB.at, corner));
    if (!(reachA > CONFUSION) || !(reachB > CONFUSION)) return null;
    const inward = V.norm(V.add(V.norm(V.sub(touchA.at, centre)),
                                V.norm(V.sub(touchB.at, centre))));
    if (!inward) return null;
    return { centre, a: touchA, b: touchB, mid: V.add(centre, V.scale(inward, radius)) };
  }

  builders.FilletCurve = {
    precondition: f => {
      if (!F.shape(F.reference(f, "curve"))) return "wire in the curve to round";
      if (F.real(f, "radius", 20) <= CONFUSION) return "the radius must be positive";
      return null;
    },
    build: f => {
      const source = F.shape(F.reference(f, "curve"));
      const wires = subShapes(source, WIRE, oc.TopoDS.Wire);
      const wire = wires.length ? wires[0] : null;
      if (!wire) throw new Error("that is not a wire - there are no corners on it");
      const run = orderedEdges(wire);
      if (run.length < 2) throw new Error("one edge has no corners to round");
      const r = F.real(f, "radius", 20);
      const closed = V.length(V.sub(run[0].ends[0], run[run.length - 1].ends[1]))
                     < CONFUSION * 100;

      //! WHICH CORNERS. Empty is every one, the way the solid fillet takes
      //! every edge - and the numbers are the corners as the viewport offered
      //! them, so picking in the model and reading the file say the same thing.
      const corners = eachVertex(wire).map(v => {
        const p = oc.BRep_Tool.Pnt(v);
        return [p.X(), p.Y(), p.Z()];
      });
      const picks = readPicks(F.picks(f, "corners"));
      let wanted = null;
      if (picks.length) {
        const { found, lost } = resolvePicks(corners, picks);
        wanted = found.map(at => corners[at]).filter(Boolean);
        if (!wanted.length)
          throw new Error("none of the corners picked are on this curve any more");
        if (lost.length) wanted.lost = lost.length;
      }
      const asked = at => !wanted
        || wanted.some(one => V.length(V.sub(one, at)) < CONFUSION * 100);

      const maker = new oc.BRepBuilderAPI_MakeWire();
      let rounded = 0, smooth = 0, tight = 0;
      // Each edge is trimmed at whichever of its ends got rounded, so the
      // trims are worked out first and the wire is built once.
      const trims = run.map(() => ({ from: 0, to: 1 }));
      const arcs = [];
      const junctions = [];
      for (let i = 0; i + 1 < run.length; i++) junctions.push([i, i + 1]);
      if (closed && run.length > 2) junctions.push([run.length - 1, 0]);

      for (const [a, b] of junctions) {
        const corner = run[a].ends[1];
        if (!asked(corner)) continue;
        // BOTH ARMS READ THE SAME WAY: out of the corner and along the edge.
        // wayAtEnd points INTO the edge from whichever end it is asked about,
        // so at the corner that IS the arm leaving it - for both of them. It
        // used to negate the first one, on the reading that wayAtEnd gave the
        // way the edge arrives, and that turned the corner into its own
        // supplement: tan and sin of the wrong half-angle put the centre in
        // the wrong place and the ends at the wrong distance, so the arc
        // through them was a real arc that met neither arm tangentially. It
        // came out right at one angle only - ninety degrees, where a corner
        // and its supplement are the same - which is why it passed for long.
        const armA = wayAtEnd(run[a], false), armB = wayAtEnd(run[b], true);
        if (!armA || !armB) continue;
        const cos = Math.max(-1, Math.min(1, V.dot(armA, armB)));
        const angle = Math.acos(cos);
        if (angle > Math.PI - 1e-4) { smooth++; continue; }   // doubles back
        if (angle < 1e-4) { smooth++; continue; }             // already smooth
        const half = angle / 2;
        // The straight-arm answer: exact when the arms are straight, and the
        // opening move for filletSeat when they are not.
        const reach = r / Math.tan(half);
        const backA = backOff(run[a], false, reach);
        const backB = backOff(run[b], true, reach);
        if (!backA || !backB) { tight++; continue; }
        const bisect = V.norm(V.add(V.norm(V.sub(backA.at, corner)),
                                    V.norm(V.sub(backB.at, corner))));
        if (!bisect) { tight++; continue; }
        const seat = filletSeat(run[a], run[b], corner, r,
                                V.add(corner, V.scale(bisect, r / Math.sin(half))));
        if (!seat) { tight++; continue; }
        const cutA = chainFraction(run[a], seat.a.u);
        const cutB = chainFraction(run[b], seat.b.u);
        if (!(cutA > 0) || !(cutB < 1)) { tight++; continue; }
        trims[a].to = cutA;
        trims[b].from = cutB;
        // Three points on the circle it settled on: where it touches each arm,
        // and the middle of the arc between them, on the corner's side. Which
        // two edges it cut travels with it, so that giving a corner up below
        // can hand both of them back.
        arcs.push({ after: a, onto: b, a: seat.a.at, mid: seat.mid, b: seat.b.at });
        rounded++;
      }
      //! TWO FILLETS CANNOT EAT THE SAME EDGE TWICE. Every corner is worked
      //! out on its own, and on a short edge between two rounded corners both
      //! arcs can back off past the middle of it. What is left of that edge is
      //! then nothing - or less than nothing - so it drops out of the wire and
      //! leaves a hole where it used to be, and the only thing OpenCascade has
      //! to say about that is that the wire would not join up. Which sends
      //! somebody looking at the arcs, and there is nothing wrong with any of
      //! the arcs.
      //!
      //! So the overlap is settled here, by giving up whole corners rather
      //! than by shaving radii: the corner taking the bigger bite out of the
      //! starved edge goes, both of the edges it cut are handed back, and the
      //! next starved edge is looked at. Giving up a corner is what "too
      //! tight" already means, and it is counted and said as that - the rest
      //! of the curve still gets rounded, which beats refusing all of it over
      //! one short edge.
      for (let guard = 0; guard <= arcs.length; guard++) {
        const starved = trims.findIndex(cut => !(cut.to - cut.from > 1e-9));
        if (starved < 0) break;
        const atEnd = arcs.find(one => one.after === starved);
        const atStart = arcs.find(one => one.onto === starved);
        const drop = !atStart ? atEnd
          : !atEnd ? atStart
          : (1 - trims[starved].to) >= trims[starved].from ? atEnd : atStart;
        if (!drop) break;                      // nothing left to give up
        trims[drop.after].to = 1;
        trims[drop.onto].from = 0;
        arcs.splice(arcs.indexOf(drop), 1);
        rounded--; tight++;
      }

      if (!rounded)
        throw new Error(smooth && !tight
          ? "every corner there already meets smoothly - there is nothing to round"
          : tight ? "no arc of " + r + " fits those corners - try a smaller radius"
                  : "there is no corner there to round");

      //! THE WIRE, WALKED ONCE: each edge trimmed to what is left of it, and
      //! the arc that replaced each corner put in after the edge it follows.
      //!
      //! Which edge that is comes off the arc itself rather than off a count.
      //! It used to be zipped: the nth junction got the nth arc, on the
      //! assumption that every junction makes one - and every junction that is
      //! already smooth, too tight for the radius, or simply not one of the
      //! corners that was picked makes none. One skipped corner shifted every
      //! arc after it onto the wrong edge, and the wire came back "would not
      //! join up" with nothing wrong with any of the arcs in it.
      const arcAfter = new Map();
      for (const arc of arcs) arcAfter.set(arc.after, arc);
      run.forEach((one, i) => {
        const cut = trims[i];
        const piece = trimmedEdge(one, cut.from, cut.to);
        if (piece) maker.Add(piece);
        const arc = arcAfter.get(i);
        if (arc) maker.Add(new oc.BRepBuilderAPI_MakeEdge(new oc.GC_MakeArcOfCircle(
          pnt(arc.a), pnt(arc.mid), pnt(arc.b)).Value()).Edge());
      });
      if (!maker.IsDone()) throw new Error("the rounded curve would not join up");
      const said = [rounded + (rounded === 1 ? " corner" : " corners") + " rounded"];
      if (smooth) said.push(smooth + " already smooth");
      if (tight) said.push(tight + " too tight for " + r);
      if (wanted && wanted.lost) said.push(wanted.lost + " picked corners lost");
      return { shape: maker.Wire(), note: said.join(" · ") };
    },
  };

  //! What is left of an edge between two fractions of it. Straight or curved,
  //! read off its own parameters - and nothing at all when the trims have met
  //! in the middle, which is what a corner rounded from both sides leaves.
  function trimmedEdge(one, from, to) {
    if (!(to - from > 1e-9)) return null;
    const adaptor = new oc.BRepAdaptor_Curve(one.edge);
    const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
    const a = one.flipped ? last : first, b = one.flipped ? first : last;
    const pa = a + (b - a) * from, pb = a + (b - a) * to;
    try {
      const made = new oc.BRepBuilderAPI_MakeEdge(
        oc.BRep_Tool.Curve_2(one.edge, {}, {}),
        Math.min(pa, pb), Math.max(pa, pb));
      if (made.IsDone()) return made.Edge();
    } catch (error) { /* fall through to the straight case */ }
    const at = t => { const p = adaptor.Value(t); return [p.X(), p.Y(), p.Z()]; };
    const ends = [at(pa), at(pb)];
    if (V.length(V.sub(ends[1], ends[0])) < CONFUSION) return null;
    return new oc.BRepBuilderAPI_MakeEdge(pnt(ends[0]), pnt(ends[1])).Edge();
  }

  /* ----------------------------------- lines and circles from constraints

     THE ARGUMENTS ARE THINGS IN THE MODEL and the solver works in two numbers
     on a plane, so something has to read one as the other. That is all this
     is: a wired feature comes in, and out comes a point, a straight line or a
     circle written in the plane's own u-v - which is what gcc.js takes.

     A curve that is neither straight nor round is refused by name rather than
     approximated, because a tangency to "roughly that spline" is not a
     tangency and an answer that looks nearly right is worse than none.      */

  //! What a shape is, as a flat element on the plane. Null when it is nothing
  //! the constraints can be about.
  function flatElement(frame, shape) {
    if (!shape || shape.IsNull()) return null;
    const type = shape.ShapeType();
    if (type === VERTEX) {
      const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(shape));
      return cPoint(frame.of([p.X(), p.Y(), p.Z()]));
    }
    // A wire or a compound: whatever single edge is inside it. A circle drawn
    // by the Circle node arrives as a wire of one edge, which is the common
    // case and would otherwise be refused for being a wire.
    if (type !== EDGE) {
      const edges = subShapes(shape, EDGE, oc.TopoDS.Edge);
      if (edges.length === 1) return flatElement(frame, edges[0]);
      if (!edges.length) {
        const corners = subShapes(shape, VERTEX, oc.TopoDS.Vertex);
        if (corners.length === 1) return flatElement(frame, corners[0]);
      }
      return null;
    }
    const edge = oc.TopoDS.Edge(shape);
    const adaptor = new oc.BRepAdaptor_Curve(edge);
    const kind = adaptor.GetType();
    if (kind === oc.GeomAbs_CurveType.GeomAbs_Circle) {
      const circ = adaptor.Circle();
      const at = circ.Location();
      return cCircle(frame.of([at.X(), at.Y(), at.Z()]), circ.Radius());
    }
    // A STRAIGHT EDGE IS A LINE, and it is read off its ends rather than off
    // gp_Lin - which this build does not bind, so asking the adaptor for it
    // raises instead of answering. The ends are on the edge either way.
    const ends = edgeEnds(edge);
    if (!ends) return null;
    const flatA = frame.of(ends[0]), flatB = frame.of(ends[1]);
    if (kind === oc.GeomAbs_CurveType.GeomAbs_Line) return cLine(flatA, gSubFlat(flatB, flatA));
    // Not straight and not round by declaration, but it may still BE straight
    // - a segment built through two points comes back as a BSpline of degree
    // one often enough to be worth the check.
    const mid = pointAt(adaptor, 0.5);
    if (mid) {
      const m = frame.of(mid);
      const along = gSubFlat(flatB, flatA);
      const span = Math.hypot(along[0], along[1]);
      const off = span > CONFUSION
        ? Math.abs((m[0] - flatA[0]) * along[1] - (m[1] - flatA[1]) * along[0]) / span
        : Infinity;
      if (off < CONFUSION * 10) return cLine(flatA, along);
    }
    return null;
  }

  const gSubFlat = (a, b) => [a[0] - b[0], a[1] - b[1]];

  //! The two ends of an edge, in the world - off the curve's own parameters,
  //! which every edge has whatever it is made of.
  function edgeEnds(edge) {
    try {
      const adaptor = new oc.BRepAdaptor_Curve(edge);
      const a = adaptor.Value(adaptor.FirstParameter());
      const b = adaptor.Value(adaptor.LastParameter());
      const ends = [[a.X(), a.Y(), a.Z()], [b.X(), b.Y(), b.Z()]];
      return V.length(V.sub(ends[1], ends[0])) > CONFUSION ? ends : null;
    } catch (error) { return null; }
  }

  function pointAt(adaptor, t) {
    try {
      const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
      const p = adaptor.Value(first + (last - first) * t);
      return [p.X(), p.Y(), p.Z()];
    } catch (error) { return null; }
  }

  //! The element a wired argument comes to, with the name of what went wrong
  //! when it comes to nothing - because "no answer" and "that spline is not
  //! something a tangency can be about" are different things to be told.
  function constraintOf(frame, f, key) {
    const source = F.reference(f, key);
    if (!source) return { error: "nothing is wired into " + key };
    // A PLANE, read on this plane, is the line the two planes cross in - which
    // is what a plane means to a drawing laid on another one.
    // THE SHAPE FIRST, and the numbers only when there is no shape. A curve
    // node carries the points it was built through as its data, so reading the
    // numbers first would take a spline for the point it starts at - and a
    // tangency to "the first point of that spline" is not what anybody asked
    // for. A Point has a vertex for a shape, so nothing is lost by the order.
    const shape = F.shape(source);
    const element = shape ? flatElement(frame, shape)
                          : (readPoint(source) ? cPoint(frame.of(readPoint(source))) : null);
    if (!shape && !element)
      return { error: (F.name(source) || key) + " has no shape to constrain against" };
    if (!element)
      return { error: (F.name(source) || key) + " is neither a point, a straight line nor a "
                    + "circle on this plane - a tangency can only be about those" };
    return { element };
  }

  const askOf = (f, key) => (QUALIFIERS[Feature_choice(f, key)] || QUALIFIERS[0]).key;

  //! The answer somebody asked for, out of however many there were.
  function pickAnswer(list, f) {
    const want = Math.max(1, Math.round(F.real(f, "answer", 1)));
    if (!list.length) return null;
    return list[Math.min(list.length, want) - 1];
  }

  //! And the note that says what was on offer, because a node that silently
  //! shows the third of eight is a node nobody can drive.
  const howMany = (list, want) => list.length === 1 ? "one answer"
    : Math.min(list.length, Math.max(1, Math.round(want))) + " of " + list.length + " answers";

  function circlesFor(f, frame) {
    const kind = Feature_choice(f, "kind");
    const grab = key => constraintOf(frame, f, key);
    const radius = F.real(f, "radius", 60);
    if (kind === 5 || kind === 6) {
      const a = grab("first"), b = grab("second");
      if (a.error) throw new Error(a.error);
      if (b.error) throw new Error(b.error);
      if (kind === 6) return circle2PointsRadius(a.element.at, b.element.at, radius);
      const c = grab("third");
      if (c.error) throw new Error(c.error);
      return circleThrough3(a.element.at, b.element.at, c.element.at);
    }
    const a = grab("first");
    if (a.error) throw new Error(a.error);
    if (kind === 4) {
      const at = grab("at");
      if (at.error) throw new Error(at.error);
      return circleTanCentre(a.element, at.element.at);
    }
    if (kind === 3) {
      const on = grab("on");
      if (on.error) throw new Error(on.error);
      return circleTanOnRadius(a.element, on.element, radius, askOf(f, "askFirst"));
    }
    const b = grab("second");
    if (b.error) throw new Error(b.error);
    if (kind === 0)
      return circle2TanRadius(a.element, b.element, radius,
                              askOf(f, "askFirst"), askOf(f, "askSecond"));
    if (kind === 2) {
      const on = grab("on");
      if (on.error) throw new Error(on.error);
      return circle2TanOn(a.element, b.element, on.element,
                          [askOf(f, "askFirst"), askOf(f, "askSecond")]);
    }
    const c = grab("third");
    if (c.error) throw new Error(c.error);
    return circle3Tan(a.element, b.element, c.element,
                      [askOf(f, "askFirst"), askOf(f, "askSecond"), askOf(f, "askThird")]);
  }

  builders.ConstrainedCircle = {
    precondition: f => planeAxis(F.reference(f, "plane"))
      ? null : "a plane is needed to work the constraints out on",
    build: f => {
      const frame = sketchFrame(f);
      const found = circlesFor(f, frame);
      const one = pickAnswer(found, f);
      if (!one)
        throw new Error(found.family
          ? "every circle that touches one of those touches the other, so there are "
            + "infinitely many - move one of them, or say which side to be on"
          : "no circle answers that");
      const kind = Feature_choice(f, "kind");
      const arc = (kind === 5 || kind === 6) && Feature_choice(f, "trim") === 1;
      const shape = arc ? arcThroughFlat(frame, one, f) : HSF.circle(frame.frame(one.at), one.r);
      return { shape,
               data: { kind: "curve",
                       preview: saysCircle(one, Math.max(0, Math.round(F.real(f, "answer", 1)) - 1),
                                           found.length) },
               note: howMany(found, F.real(f, "answer", 1)) + " · r "
                     + Math.round(one.r * 100) / 100 };
    },
  };

  //! The arc rather than the whole circle: the piece that runs between the
  //! points it was asked to pass through, the short way round.
  function arcThroughFlat(frame, one, f) {
    const kind = Feature_choice(f, "kind");
    const keys = kind === 5 ? ["first", "second", "third"] : ["first", "second"];
    const ends = keys.map(key => constraintOf(frame, f, key))
                     .map(got => got.element && got.element.at).filter(Boolean);
    if (ends.length < 2) throw new Error("an arc needs the points it runs between");
    if (kind === 5)
      return new oc.BRepBuilderAPI_MakeWire(new oc.BRepBuilderAPI_MakeEdge(
        new oc.GC_MakeArcOfCircle(pnt(frame.at(ends[0])), pnt(frame.at(ends[1])),
                                  pnt(frame.at(ends[2]))).Value()).Edge()).Wire();
    // Two points and a radius: the short way round, through the point halfway
    // along the near side of the circle.
    const angle = at => Math.atan2(at[1] - one.at[1], at[0] - one.at[0]);
    let a = angle(ends[0]), b = angle(ends[1]);
    let by = b - a;
    while (by > Math.PI) by -= Math.PI * 2;
    while (by < -Math.PI) by += Math.PI * 2;
    const mid = a + by / 2;
    const via = [one.at[0] + one.r * Math.cos(mid), one.at[1] + one.r * Math.sin(mid)];
    return new oc.BRepBuilderAPI_MakeWire(new oc.BRepBuilderAPI_MakeEdge(
      new oc.GC_MakeArcOfCircle(pnt(frame.at(ends[0])), pnt(frame.at(via)),
                                pnt(frame.at(ends[1]))).Value()).Edge()).Wire();
  }

  builders.ConstrainedLine = {
    precondition: f => planeAxis(F.reference(f, "plane"))
      ? null : "a plane is needed to work the constraints out on",
    build: f => {
      const frame = sketchFrame(f);
      const kind = Feature_choice(f, "kind");
      const a = constraintOf(frame, f, "first");
      if (a.error) throw new Error(a.error);
      let found;
      if (kind === 0) {
        const b = constraintOf(frame, f, "second");
        if (b.error) throw new Error(b.error);
        found = line2Tan(a.element, b.element,
                         askOf(f, "askFirst"), askOf(f, "askSecond"));
      } else {
        const r = constraintOf(frame, f, "reference");
        if (r.error) throw new Error(r.error);
        if (r.element.kind !== "line")
          throw new Error("the reference has to be a straight line to be parallel to");
        const turn = kind === 1 ? 0 : kind === 2 ? Math.PI / 2
                   : F.real(f, "angle", 30) * Math.PI / 180;
        found = lineTanAngle(a.element, r.element, turn);
      }
      const one = pickAnswer(found, f);
      if (!one) throw new Error("no line answers that");
      // A line has no ends. It is drawn as a segment the length that was
      // asked for, centred on the middle of what it touches - which is where
      // a person is looking when they made it.
      const half = Math.max(1, F.real(f, "length", 400)) / 2;
      const seat = one.touches.length
        ? one.touches.reduce((acc, p) => [acc[0] + p[0] / one.touches.length,
                                          acc[1] + p[1] / one.touches.length], [0, 0])
        : one.at;
      const along = (one.at[0] - seat[0]) * one.way[0] + (one.at[1] - seat[1]) * one.way[1];
      const mid = [one.at[0] - one.way[0] * along, one.at[1] - one.way[1] * along];
      const ends = [[mid[0] - one.way[0] * half, mid[1] - one.way[1] * half],
                    [mid[0] + one.way[0] * half, mid[1] + one.way[1] * half]];
      return { shape: HSF.polyline(ends.map(uv => frame.at(uv)), false),
               data: { kind: "curve",
                       preview: saysLine(one, Math.max(0, Math.round(F.real(f, "answer", 1)) - 1),
                                         found.length) },
               note: howMany(found, F.real(f, "answer", 1)) };
    },
  };

  builders.Bisector = {
    precondition: f => planeAxis(F.reference(f, "plane"))
      ? null : "a plane is needed to work the bisector out on",
    build: f => {
      const frame = sketchFrame(f);
      const a = constraintOf(frame, f, "first");
      if (a.error) throw new Error(a.error);
      const b = constraintOf(frame, f, "second");
      if (b.error) throw new Error(b.error);
      const got = bisector(a.element, b.element,
                           { span: Math.max(0, F.real(f, "span", 0)),
                             steps: Math.max(8, Math.round(F.real(f, "steps", 96))) });
      if (!got || got.points.length < 2)
        throw new Error("nothing is equally far from those two");
      return { shape: HSF.polyline(got.points.map(uv => frame.at(uv)), false),
               data: { kind: "curve", preview: got.kind },
               note: got.kind + " · " + got.points.length + " points" };
    },
  };

  //! Catmull-Rom through the points, parameterised by index so the curve may
  //! double back on itself, then sampled. OpenCascade's B-spline fitter wants a
  //! TColgp array this build does not export, so the smooth curve arrives as a
  //! fine run of segments - which is what it is drawn and lofted as anyway.
  function catmullRom(list, closed, perSpan) {
    //! TWO CONTROL POINTS IN THE SAME PLACE MAKE A CUSP, and a cusp is a place
    //! no curve built on this can be offset, filleted or swept past. It is
    //! easier to arrive at than it looks: a Points argument that auto-wired a
    //! guess and was then handed that same point again holds it twice, and
    //! nothing between there and here would have said so.
    //!
    //! Measured: an interpolated curve through (0,0) (140,60) (300,70)
    //! (420,20), with (0,0) in the list twice, offset by 20 - the offset came
    //! back within 0.95 mm of its source at the doubled point, 19.05 off the
    //! distance asked for, and correctly so. There is no curve 20 mm from a
    //! cusp. So the repeat goes here rather than the complaint: a span of no
    //! length carries no shape, and dropping it changes nothing else.
    const cps = list.filter((p, i) => i === 0
      || Math.hypot(p[0] - list[i - 1][0], p[1] - list[i - 1][1],
                    p[2] - list[i - 1][2]) > 1e-9);
    const n = cps.length;
    const at = i => cps[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
    const spans = closed ? n : n - 1;
    const out = [];
    for (let s = 0; s < spans; s++) {
      const [a, b, c, d] = [at(s - 1), at(s), at(s + 1), at(s + 2)];
      for (let j = 0; j < perSpan; j++) {
        const u = j / perSpan;
        out.push([0, 1, 2].map(k => 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * u
          + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u * u
          + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u * u * u)));
      }
    }
    if (!closed) out.push(cps[n - 1]);
    return out;
  }

  builders.Polyline = {
    precondition: f => pointsOf(f, "points").length < 2
      ? "a polyline needs at least two points" : null,
    build: f => {
      const list = pointsOf(f, "points");
      return { shape: HSF.polyline(list, Feature_choice(f, "closed") === 1),
               data: points(list) };
    },
  };

  /* --------------------------------------------------------------- sketch

     A drawing in two dimensions, put on a plane. Everything in the drawing is
     written in the plane's own u-v coordinates, so this is the only place in
     the program where the sketch meets the world: the plane resolves to a
     gp_Ax2, every point in the drawing goes through it, and the edges are
     built there. Point the sketch at another plane and the whole drawing moves
     with it, because none of it was ever written in world coordinates.

     Edges are built through the points the chain walker hands over rather than
     from each element's own arithmetic. A drawing is full of hundredth-of-a-
     millimetre gaps and a wire will not close over one; welding the ends first
     and building an arc through three points on it means the wire closes
     exactly, and the arc is still a real arc rather than a run of segments. */

  //! The sketch's frame: the plane it is on, moved to the origin point if one
  //! is wired. Without a plane it lies on world XY, so a new sketch draws.
  function sketchFrame(f) {
    const axis = planeAxis(F.reference(f, "plane"))
      || new oc.gp_Ax2(pnt([0, 0, 0]), dir([0, 0, 1]));
    const X = axis.XDirection(), Y = axis.YDirection(), N = axis.Direction();
    const here = axis.Location();
    const x = [X.X(), X.Y(), X.Z()], y = [Y.X(), Y.Y(), Y.Z()], n = [N.X(), N.Y(), N.Z()];
    const seat = [here.X(), here.Y(), here.Z()];
    // A POINT OFF THE PLANE DOES NOT LIFT THE SKETCH OFF IT. The origin says
    // WHERE ON the plane the drawing's (0, 0) sits; a point that happens to be
    // two metres above it slides the origin within the plane, it does not carry
    // the drawing up with it. Wired straight through, any point in the model
    // took the whole sketch off its own plane - so the sketch was not on the
    // plane it said it was on, every constraint was measured somewhere else,
    // and a pad off it started in mid-air. It is projected, the way every
    // modeller projects it.
    const asked = readPoint(F.reference(f, "origin"));
    const origin = asked ? V.sub(asked, V.scale(n, V.dot(V.sub(asked, seat), n))) : seat;
    return {
      normal: n, x, y, origin,
      //! Two numbers on the paper, one point in the world.
      at: uv => V.add(origin, V.add(V.scale(x, uv[0]), V.scale(y, uv[1]))),
      //! And back the other way: where a point in the world falls on the
      //! paper. What lets a constraint read a circle somebody drew in space
      //! as a circle on this plane.
      of: world => [V.dot(V.sub(world, origin), x), V.dot(V.sub(world, origin), y)],
      //! A frame for a circle or an ellipse: on the plane, centred there, and
      //! turned in the plane by \p turn so an ellipse knows which way it lies.
      frame(uv, turn = 0) {
        const along = V.add(V.scale(x, Math.cos(turn)), V.scale(y, Math.sin(turn)));
        return new oc.gp_Ax2(pnt(this.at(uv)), dir(n), dir(along));
      },
    };
  }

  //! The drawing as the sketch will be built from it: read off the label, then
  //! relaxed against its own constraints unless that is switched off. The
  //! solved drawing is not written back - the constraints are the truth and
  //! this is what they come to, so nothing drifts by being rebuilt twice.
  function sketchDrawing(f) {
    const drawing = F.sketch(f, "drawing");
    if (Feature_choice(f, "solve") !== 0) return drawing;
    return solveSketch(drawing, Math.max(1, Math.round(F.real(f, "passes", 24)))).drawing;
  }

  const round4 = v => Math.round(v * 1e6) / 1e6;

  //! An edge between two points on the plane - or nothing, when they are the
  //! same point. A surveyed DXF is full of lines of no length: duplicates
  //! nobody ever saw because they are drawn on top of the line beside them.
  //! BRepBuilderAPI_MakeEdge answers one of those by raising "BRep_API: command
  //! not done", and that raise used to come up through the whole Sketch build,
  //! so six invisible lines in a drawing of five hundred meant none of it
  //! appeared outside the sketcher.
  const straight = (frame, a, b) =>
    Math.hypot(b[0] - a[0], b[1] - a[1]) > CONFUSION
      ? new oc.BRepBuilderAPI_MakeEdge(pnt(frame.at(a)), pnt(frame.at(b))).Edge() : null;

  //! An arc through three of its own points. Its ends are exactly the ones the
  //! chain welded, whatever that did to the radius.
  function arcThrough(frame, a, via, b) {
    const arc = new oc.GC_MakeArcOfCircle(pnt(frame.at(a)), pnt(frame.at(via)), pnt(frame.at(b)));
    if (!arc.IsDone()) throw new Error("the arc is degenerate");
    return new oc.BRepBuilderAPI_MakeEdge(arc.Value()).Edge();
  }

  //! A RUN OF DRAWN POINTS AS ONE SMOOTH EDGE, in the plane's own coordinates.
  //! A sketched spline is worked out here - by de Boor for a B-spline, by
  //! Catmull-Rom for a spline - and what it is worked out as is points. Handed
  //! on as points it was a run of straight edges, and a pad off it came out as
  //! that many flat strips; fitted, it is one B-spline edge and the pad off it
  //! is one surface. The fit keeps the welded ends exactly, which is what lets
  //! the chain either side of it still close.
  const smoothEdge = (frame, list) => {
    const wire = HSF.fitCurve(list.map(uv => frame.at(uv)), false, 0);
    const edges = subShapes(wire, EDGE, oc.TopoDS.Edge);
    // The fit falls back to segments when it will not converge, and segments
    // are still the curve - so whatever came back is what the chain gets.
    return edges.length ? edges : runOfEdges(frame, list);
  };

  const runOfEdges = (frame, list) => {
    const out = [];
    for (let i = 0; i + 1 < list.length; i++) {
      const [a, b] = [list[i], list[i + 1]];
      const edge = straight(frame, a, b);
      if (edge) out.push(edge);
    }
    return out;
  };

  //! One element as edges, in the direction the chain walks it. \p a and \p b
  //! are the welded ends; a closed element has neither and is built from its
  //! own numbers.
  function sketchEdgesOf(el, frame, a, b) {
    // Nothing one element is wrong about is allowed to reach the rest of the
    // drawing. A zero-length line, a circle of no radius, an arc the weld made
    // degenerate: each of them is one element that cannot be built, and the
    // answer is to build the other five hundred.
    try { return edgesOfElement(el, frame, a, b).filter(Boolean); }
    catch (e) { return []; }
  }

  function edgesOfElement(el, frame, a, b) {
    switch (el.type) {
      case "point": return [];
      case "line":  return [straight(frame, a, b)];
      case "arc": {
        const via = sketchArcPoint(el, (el.a0 + el.a1) / 2);
        return [arcThrough(frame, a, via, b)];
      }
      case "circle":
        if (!(el.r > CONFUSION)) return [];
        return [new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(frame.frame(el.c), el.r)).Edge()];
      case "ellipse": {
        if (!(el.rx > CONFUSION) || !(el.ry > CONFUSION)) return [];
        // gp_Elips insists the major radius is the larger one; a taller
        // ellipse is the same ellipse turned a quarter turn.
        const tall = (el.ry || 0) > (el.rx || 0);
        const major = Math.max(el.rx, el.ry), minor = Math.min(el.rx, el.ry);
        const turn = (el.rot || 0) + (tall ? Math.PI / 2 : 0);
        const conic = new oc.gp_Elips(frame.frame(el.c, turn), major, minor);
        if (wholeEllipse(el)) return [new oc.BRepBuilderAPI_MakeEdge(conic).Edge()];
        // An arc of one. Turning the frame a quarter turn moved the parameter
        // with it, so the two ends move by the same quarter turn.
        const shift = tall ? -Math.PI / 2 : 0;
        if (Math.abs(el.a1 - el.a0) < CONFUSION) return [];
        return [new oc.BRepBuilderAPI_MakeEdge(conic, el.a0 + shift, el.a1 + shift).Edge()];
      }
      case "oblong": {
        if (!(el.r > CONFUSION)) return [];
        // Two straights and a half turn at either end - built through points so
        // the four meet exactly.
        const along = V.norm([el.b[0] - el.a[0], el.b[1] - el.a[1], 0]) || [1, 0, 0];
        const side = [-along[1], along[0]];
        const r = el.r;
        const off = (c, k, m) => [c[0] + side[0] * r * k + along[0] * r * m,
                                  c[1] + side[1] * r * k + along[1] * r * m];
        const b1 = off(el.b, -1, 0), b2 = off(el.b, 1, 0);
        const a1 = off(el.a, 1, 0), a2 = off(el.a, -1, 0);
        return [arcThrough(frame, b1, off(el.b, 0, 1), b2),
                straight(frame, b2, a1),
                arcThrough(frame, a1, off(el.a, 0, -1), a2),
                straight(frame, a2, b1)];
      }
      case "rect": {
        const [u0, v0] = el.a, [u1, v1] = el.b;
        if (Math.abs(u1 - u0) < CONFUSION || Math.abs(v1 - v0) < CONFUSION) return [];
        const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        return corners.map((c, i) => straight(frame, c, corners[(i + 1) % 4]))
                      .filter(Boolean);
      }
      case "spline": {
        const run = splinePoints(el, 12);
        if (run.length < 2) return [];
        const walk = a && b ? [a, ...run.slice(1, -1), b] : run;
        return smoothEdge(frame, walk);
      }
      // A B-spline is evaluated here rather than handed to the kernel with a
      // knot vector - nothing in this build takes one - so it is walked out
      // exactly, by de Boor, and fitted back to a single edge through what it
      // passes through. Which is a B-spline again, and reads as one downstream.
      case "bspline": {
        const run = bsplinePoints(el, 16);
        if (run.length < 2) return [];
        const walk = a && b ? [a, ...run.slice(1, -1), b] : run;
        return smoothEdge(frame, walk);
      }
      default: return [];
    }
  }

  //! A chain of elements as one wire. If the exact edges will not join - a
  //! spline doubling back on itself, an arc the weld made degenerate - the
  //! chain is rebuilt as a fine polyline through the same drawing, because a
  //! wire that closes is worth more than a wire that is analytic.
  function sketchWire(drawing, chain, frame, closed) {
    const run = sketchChainEnds(drawing, chain, closed);
    const edges = [];
    for (const step of run) {
      const walked = step.reversed
        ? { ...step.el, ...reverseElement(step.el) } : step.el;
      edges.push(...sketchEdgesOf(walked, frame, step.a, step.b));
    }
    if (!edges.length) return null;
    const joined = (() => {
      const maker = new oc.BRepBuilderAPI_MakeWire();
      for (const edge of edges) maker.Add(edge);
      return maker.IsDone() ? maker.Wire() : null;
    })();
    if (joined) return joined;

    const walk = [];
    for (const step of run) {
      const line = sketchOutlineOf(step.el, step.reversed);
      for (const p of line) if (!walk.length || Math.hypot(p[0] - walk[walk.length - 1][0],
                                                           p[1] - walk[walk.length - 1][1]) > 1e-6)
        walk.push(p);
    }
    if (walk.length < 2) return null;
    const fallback = new oc.BRepBuilderAPI_MakeWire();
    for (const edge of runOfEdges(frame, closed ? [...walk, walk[0]] : walk)) fallback.Add(edge);
    return fallback.IsDone() ? fallback.Wire() : null;
  }

  //! sketchWire, and never a raise. One chain of a drawing that will not become
  //! a wire is one chain missing from what the sketch builds; the rest of the
  //! drawing has done nothing wrong.
  function sketchWireOrNothing(drawing, chain, frame, closed) {
    try { return sketchWire(drawing, chain, frame, closed); }
    catch (e) { return null; }
  }

  //! An element walked backwards.
  //!
  //! Only a spline needs one. A line and an arc are built from the welded ends
  //! the walk hands over, and those are already in the order it walks them, so
  //! turning the element round as well turns it back. An arc especially: its
  //! sweep is a pair of angles that only ever increases, so there is no way to
  //! write [a1, a0] at all - the arc's own numbers say which arc it is, and the
  //! ends say which way along it. Writing a0 = a1, a1 = a0 + 2*pi did have a
  //! meaning, and it was a three-quarter turn the other way round.
  function reverseElement(el) {
    if (el.type === "spline") return { pts: (el.pts || []).slice().reverse() };
    if (el.type === "bspline") return reversedBspline(el);
    return {};
  }

  function sketchOutlineOf(el, reversed) {
    const line = sketchOutline(el, 64);
    return reversed ? line.slice().reverse() : line;
  }

  builders.Sketch = {
    precondition: f => {
      // The frame is written before anything can go wrong with the drawing,
      // because an empty sketch is exactly the one you need it for: without it
      // the viewport cannot turn a click into two numbers, and a sketch you
      // cannot click on is a sketch you can never draw the first line on.
      const frame = sketchFrame(f);
      F.setFrame(f, { origin: frame.origin.map(round4), x: frame.x.map(round4),
                      y: frame.y.map(round4), normal: frame.normal.map(round4) });
      const drawing = F.sketch(f, "drawing");
      const elements = drawing.elements || [];
      if (!elements.length) return "the sketch is empty - draw something on it";
      // And that is the only thing it refuses. A drawing of loose lines that
      // close nothing is a drawing; so is one of nothing but points, which is
      // a setting-out. Both used to be turned away here, and a DXF of survey
      // marks or of a plan that never closed came in as a feature in error.
      if (!shownDrawing(drawing).elements.length)
        return "every layer in this sketch is turned off - turn one on to see it";
      // And construction geometry is not output, so a drawing of nothing but
      // construction geometry outputs nothing. Said here rather than raised
      // from the build, because it is a state somebody meant to be in on the
      // way to drawing the real thing over the top of it.
      if (!builtDrawing(drawing).elements.length)
        return "everything in this sketch is construction geometry - it drives the "
          + "drawing, but nothing is built from it";
      return null;
    },
    build: f => {
      const api = shapeApi();
      // Solved over the whole drawing - a relation may hold something on a
      // layer that is off, and construction geometry is exactly the thing that
      // holds the rest where it is - and built over what is left after both.
      const drawing = builtDrawing(sketchDrawing(f));
      const frame = sketchFrame(f);
      const { loops, open } = sketchLoops(drawing, 0.05);
      const wanted = Feature_choice(f, "faces") === 0;

      // A closed loop becomes a planar face, and that face is what a pad is
      // extruded from - so everything the sketcher closes is pad-ready without
      // anyone asking for a surface. A loop drawn inside another is a hole in
      // it rather than a second plate, and a loop inside a hole is solid again:
      // the nesting is counted, not guessed.
      const wires = loops.map(loop => sketchWireOrNothing(drawing, loop, frame, true));
      const nesting = sketchNesting(drawing, loops);
      const shapes = [];
      for (let i = 0; i < loops.length; i++) {
        const wire = wires[i];
        if (!wire) continue;
        if (!wanted) { shapes.push(wire); continue; }
        if (nesting[i].hole) continue;              // built into its outline below
        try {
          const maker = new oc.BRepBuilderAPI_MakeFace(wire, true);
          if (!maker.IsDone()) { shapes.push(wire); continue; }
          const holes = [];
          for (let j = 0; j < loops.length; j++)
            if (wires[j] && nesting[j].hole && nesting[j].parent === i) holes.push(wires[j]);
          //! HOLES THE RIGHT WAY ROUND, which is the factory's job and not a
          //! question the sketcher can answer: which way a loop runs is
          //! decided by the order somebody drew it in. A hexagon with three
          //! rectangles inside it used to pad as a solid hexagon with three
          //! solid blocks standing in it, because every hole had been
          //! reversed and half of them were then wrong. See fillWithHoles.
          shapes.push(holes.length ? HSF.fillWithHoles(wire, holes) : maker.Face());
        } catch (e) { shapes.push(wire); }
      }
      for (const chain of open) {
        const wire = sketchWireOrNothing(drawing, chain, frame, false);
        if (wire) shapes.push(wire);
      }

      // The points someone put in the sketch come out as points, so a sketch
      // is also a way of laying out a row of locations on a plane - and a
      // drawing of nothing but points is a perfectly good sketch. They are
      // built as vertices, so that one has a shape like anything else rather
      // than being a feature that failed.
      const marks = (drawing.elements || []).filter(el => el.type === "point")
        .map(el => frame.at(el.p));
      for (const mark of marks) {
        try { shapes.push(vertexAt(mark)); } catch (e) { /* one mark, not the drawing */ }
      }
      if (!shapes.length)
        throw new Error("nothing in this drawing could be built - every element in it is "
          + "a line of no length or a circle of no radius");

      const shape = shapes.length === 1 ? shapes[0] : api.compound(shapes);
      return marks.length ? { shape, data: points(marks) } : shape;
    },
  };

  builders.Interpolate = {
    precondition: f => pointsOf(f, "points").length < 3
      ? "an interpolated curve needs at least three points" : null,
    build: f => {
      const list = pointsOf(f, "points");
      const closed = Feature_choice(f, "closed") === 1;
      // Degree is what it means here: 1 is the polyline itself, higher degrees
      // ask for a finer sampling of the same spline.
      const perSpan = Math.max(1, Math.round(F.real(f, "degree", 3)) * 6);
      //! A closed loop is sampled harder than an open one, because the fit is
      //! not periodic and the seam closes only as smoothly as the samples
      //! either side of it make it. Same number, same reason, as the spline
      //! factory: see FIT_SEAM_SAMPLES.
      const steps = closed
        ? Math.max(perSpan, Math.ceil(FIT_SEAM_SAMPLES / list.length)) : perSpan;
      const run = catmullRom(list, closed, steps);
      return { shape: HSF.fitCurve(run, closed, 0), data: points(list) };
    },
  };

  /* ----------------------------------------------------------- analysis */

  //! A curve sampled densely, with the running length at every sample - enough
  //! to answer both "where is parameter t" and "where is half way along".
  function sampleCurve(wire, samples = 400) {
    const curve = new oc.BRepAdaptor_CompCurve(wire);
    const first = curve.FirstParameter(), last = curve.LastParameter();
    const at = u => {
      const p = curve.Value(first + (last - first) * Math.max(0, Math.min(1, u)));
      return [p.X(), p.Y(), p.Z()];
    };
    const run = [], lengths = [0];
    for (let i = 0; i <= samples; i++) run.push(at(i / samples));
    for (let i = 1; i < run.length; i++)
      lengths.push(lengths[i - 1] + length([run[i][0] - run[i - 1][0],
        run[i][1] - run[i - 1][1], run[i][2] - run[i - 1][2]]));
    const total = lengths[lengths.length - 1];

    //! The parameter at a fraction of the arc length, found in the table.
    const byLength = fraction => {
      const want = total * Math.max(0, Math.min(1, fraction));
      let i = 1;
      while (i < lengths.length && lengths[i] < want) i++;
      const lo = lengths[i - 1], hi = lengths[i] !== undefined ? lengths[i] : lo;
      const span = hi - lo;
      return ((i - 1) + (span > 1e-12 ? (want - lo) / span : 0)) / samples;
    };
    return { at, byLength, total, tangent: u => {
      const step = 1e-4;
      const a = at(Math.max(0, u - step)), b = at(Math.min(1, u + step));
      return V.norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) || [1, 0, 0];
    } };
  }

  builders.EvaluateCurve = {
      //! Pairs up its own lists - see Driver.spreadLists.
      ownLists: true,
    precondition: f => F.reference(f, "curve") ? null : "no curve to evaluate",
    build: f => {
      const curve = sampleCurve(wireOf(F.reference(f, "curve"), "curve"));
      const draw = F.real(f, "tangent", 40);
      const hits = F.reals(f, "t", 0.5).map(t => {
        const u = Math.max(0, Math.min(1, t));
        return { point: curve.at(u), tangent: curve.tangent(u) };
      });
      const parts = [];
      for (const hit of hits) {
        parts.push(vertexAt(hit.point));
        if (draw > CONFUSION)
          parts.push(segment(hit.point, V.add(hit.point, V.scale(hit.tangent, draw))));
      }
      return { shape: compoundOf(parts.filter(Boolean)), data: points(hits.map(h => h.point)) };
    },
  };

  builders.DivideCurve = {
    precondition: f => {
      if (!F.reference(f, "curve")) return "no curve to divide";
      if (F.real(f, "count", 10) < 1) return "a curve cannot be divided into less than one";
      return null;
    },
    build: f => {
      const curve = sampleCurve(wireOf(F.reference(f, "curve"), "curve"));
      const count = Math.max(1, Math.round(F.real(f, "count", 10)));
      const inclusive = Feature_choice(f, "ends") === 0;
      const list = [];
      // Divisions, not points: n divisions give n + 1 stations with the ends in.
      const stations = inclusive ? count + 1 : count - 1;
      for (let i = 0; i < Math.max(1, stations); i++)
        list.push(curve.at(curve.byLength(inclusive
          ? (stations > 1 ? i / (stations - 1) : 0)
          : (i + 1) / count)));
      return { shape: compoundOf(list.map(vertexAt)), data: points(list) };
    },
  };

  builders.EvaluateSurface = {
      //! Pairs up its own lists - see Driver.spreadLists.
      ownLists: true,
    precondition: f => F.reference(f, "surface") ? null : "no surface to evaluate",
    build: f => {
      const shape = F.shape(F.reference(f, "surface"));
      if (!shape) throw new Error("the surface has not been built");
      // WHICHEVER FACE WAS PICKED, and the first one when none was. A skin has
      // as many faces as it has strips and "the first" is an accident of how
      // the loft was wound, so a sample that means anything has to be able to
      // say which.
      const picked = pickedSubs(f, "face", shape, "face");
      if (!picked.whole && !picked.chosen.length)
        throw new Error("the picked face is not in that shape any more");
      const face = picked.whole ? firstFace(shape, "surface") : picked.chosen[0];
      const surface = new oc.BRepAdaptor_Surface(face, true);
      const u0 = surface.FirstUParameter(), u1 = surface.LastUParameter();
      const v0 = surface.FirstVParameter(), v1 = surface.LastVParameter();
      const draw = F.real(f, "normal", 40);
      const at = (su, sv) => {
        const p = surface.Value(u0 + (u1 - u0) * su, v0 + (v1 - v0) * sv);
        return [p.X(), p.Y(), p.Z()];
      };
      const rows = zip([F.reals(f, "u", 0.5), F.reals(f, "v", 0.5)]);
      const parts = [], list = [];
      for (const [su, sv] of rows) {
        const u = Math.max(0, Math.min(1, su)), v = Math.max(0, Math.min(1, sv));
        const here = at(u, v);
        list.push(here);
        parts.push(vertexAt(here));
        if (draw > CONFUSION) {
          // The normal from two steps across the surface: no D1 binding needed,
          // and it degrades to nothing rather than throwing at a seam.
          const step = 1e-3;
          const du = V.add(at(Math.min(1, u + step), v), V.scale(here, -1));
          const dv = V.add(at(u, Math.min(1, v + step)), V.scale(here, -1));
          const normal = V.norm(V.cross(du, dv));
          if (normal) parts.push(segment(here, V.add(here, V.scale(normal, draw))));
        }
      }
      // Which face this landed on, said out loud. A sample that silently took
      // the first face of a nine-face skin is the defect this argument exists
      // to fix, so the node says which face it is on whenever there is a choice.
      const many = eachFace(shape).length;
      const which = picked.whole ? 0 : eachFace(shape).findIndex(one => one.IsSame(face));
      return { shape: compoundOf(parts.filter(Boolean)), data: points(list),
               note: many > 1 ? "face " + (which + 1) + " of " + many
                 + (picked.whole ? " \u00b7 pick a face to sample another" : "") : undefined };
    },
  };

  builders.Measure = {
    precondition: f => {
      const source = F.reference(f, "shape");
      if (!source) return "nothing to measure";
      const data = F.data(source);
      if (data && data.kind === "mesh") return null;      // a mesh has no B-Rep
      if (!F.shape(source)) return F.name(source) + " has not been built";
      return null;
    },
    build: f => {
      const source = F.reference(f, "shape");
      const meshData = F.data(source);
      if (meshData && meshData.kind === "mesh") return { data: numbers([measureMesh(f, meshData)]) };
      const shape = F.shape(source);
      const quantity = Feature_choice(f, "quantity");
      // HOW MANY OF SOMETHING, which is a measurement like any other and the
      // one a model needs before it can take the pieces apart: you cannot ask
      // for face 5 of a skin until you know there are nine.
      if (quantity >= 7) {
        const kind = quantity === 7 ? FACE : quantity === 8 ? EDGE : VERTEX;
        const cast = quantity === 7 ? oc.TopoDS.Face
                   : quantity === 8 ? oc.TopoDS.Edge : oc.TopoDS.Vertex;
        return { data: numbers([uniqueSubs(shape, kind, cast).length]) };
      }
      if (quantity <= 2) {
        const props = new oc.GProp_GProps();
        if (quantity === 0) oc.BRepGProp.LinearProperties(shape, props, false, false);
        else if (quantity === 1) oc.BRepGProp.SurfaceProperties(shape, props, false, false);
        else oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
        const value = props.Mass();
        props.delete();
        //! A LENGTH AND AN AREA ARE MAGNITUDES. OpenCascade's mass is signed,
        //! and a face whose normal points the other way comes back negative -
        //! which is a thing worth being told, but not by handing "minus
        //! fifteen square metres" to whatever reads this next. So the number
        //! is the size and the note is the direction.
        const size = Number.isFinite(value) ? Math.abs(value) : 0;
        return { data: numbers([size]),
                 note: value < 0
                   ? "the shape is inside out - its "
                     + ["length", "area", "volume"][quantity]
                     + " came back negative, which means its faces point the other way"
                   : undefined };
      }
      const box = extents(shape);
      if (!box) return { data: numbers([0]) };
      return { data: numbers([quantity === 6 ? box.diagonal : box.size[quantity - 3]]) };
    },
  };

  /* ==========================================================================
     Polymesh.

     A different kind of geometry from everything above it. A B-Rep has a
     surface under every face and OpenCascade owns it; a polymesh is a list of
     points and a list of faces of any number of sides, and nothing owns it but
     this file. That is what makes it something you can shove a vertex around
     in, and what makes Catmull-Clark possible in the first place.

     A mesh travels as { points: [[x,y,z], …], faces: [[i, j, k, …], …] }, and
     is stored as a flat TDataStd_RealArray beside a TDataStd_IntegerArray
     packed [sides, i, j, …].
     ========================================================================== */

  const packMesh = mesh => ({
    kind: "mesh",
    values: mesh.points.flat(),
    // The creases ride on the end of the face list - see meshSharpness. A mesh
    // that has never been creased packs byte for byte as it always did.
    faces: mesh.faces.flatMap(face => [face.length, ...face])
      .concat(meshSharpness(mesh.creases, mesh.corners)),
  });

  //! The mesh arriving on an input, unpacked. Anything that is not a mesh -
  //! a list of points, say - is refused by name rather than half-read.
  function meshFrom(source, what) {
    if (!source) throw new Error("no " + what + " is wired in");
    const data = F.data(source);
    if (!data || data.kind !== "mesh")
      throw new Error(F.name(source) + " is not a mesh");
    const points = F.triples(data);
    const sharp = meshCreases(data);
    return { points, faces: meshFaces(data), creases: sharp.creases, corners: sharp.corners };
  }

  const meshCounts = mesh => mesh.points.length + " vertices, " + mesh.faces.length + " faces";

  //! Does this feature hand on triangles rather than a B-Rep? Asked by the few
  //! operations that take either.
  const isMesh = source => {
    const data = source && F.data(source);
    return !!(data && data.kind === "mesh");
  };

  //! A guard every mesh driver runs before it hands anything on. A mesh with a
  //! face pointing at a vertex that is not there will take the renderer down
  //! two features later, where nothing explains it.
  const MESH_VERTICES = 800000;

  function checkMesh(mesh, what) {
    if (!mesh.points.length) throw new Error("the " + what + " has no vertices");
    for (const face of mesh.faces)
      for (const index of face)
        if (!Number.isInteger(index) || index < 0 || index >= mesh.points.length)
          throw new Error("the " + what + " has a face pointing at vertex " + index
            + ", and there are only " + mesh.points.length);
    //! THE ONE CEILING LEFT, and it is not about the file - a file of any size
    //! streams in and is read. It is about what ONE editable mesh feature can
    //! be in a browser, and it was measured rather than guessed: 780,000
    //! vertices imports in 3.7 seconds and the page turns at 60 frames a
    //! second afterwards; 1,500,000 in the same page had not finished ten
    //! minutes later. The cliff is between those two, so the number sits just
    //! above the measurement that held.
    //!
    //! And it says the way round it, because there is one: an OBJ broken into
    //! its named groups is several meshes rather than one, and each of them is
    //! its own feature with its own ceiling.
    if (mesh.points.length > MESH_VERTICES)
      throw new Error(mesh.points.length + " vertices is more than one mesh feature will "
        + "carry here (" + MESH_VERTICES + ") - import the file as sub-components and "
        + "each named group becomes a mesh of its own");
    return mesh;
  }

  const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const centroid = list => vmul(list.reduce(vadd, [0, 0, 0]), 1 / Math.max(1, list.length));

  //! Newell's normal: right for an n-gon, and right for one that is not quite
  //! flat, which after a few hand edits none of them are.
  function faceNormal(points, face) {
    let n = [0, 0, 0];
    for (let i = 0; i < face.length; i++) {
      const a = points[face[i]], b = points[face[(i + 1) % face.length]];
      n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]),
           n[1] + (a[2] - b[2]) * (a[0] + b[0]),
           n[2] + (a[0] - b[0]) * (a[1] + b[1])];
    }
    return V.norm(n) || [0, 0, 1];
  }

  const faceArea = (points, face) => {
    let n = [0, 0, 0];
    for (let i = 0; i < face.length; i++) {
      const a = points[face[i]], b = points[face[(i + 1) % face.length]];
      n = [n[0] + (a[1] * b[2] - a[2] * b[1]),
           n[1] + (a[2] * b[0] - a[0] * b[2]),
           n[2] + (a[0] * b[1] - a[1] * b[0])];
    }
    return 0.5 * Math.hypot(n[0], n[1], n[2]);
  };

  //! Signed volume by the divergence theorem, fanning each face from its first
  //! vertex. Only means anything on a mesh that is actually closed.
  const meshVolume = mesh => {
    let total = 0;
    for (const face of mesh.faces)
      for (let i = 1; i + 1 < face.length; i++) {
        const [a, b, c] = [mesh.points[face[0]], mesh.points[face[i]], mesh.points[face[i + 1]]];
        total += (a[0] * (b[1] * c[2] - b[2] * c[1])
                - a[1] * (b[0] * c[2] - b[2] * c[0])
                + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      }
    return Math.abs(total);
  };

  //! Averaged face normals, weighted by nothing - the mesh is a cage, and a
  //! cage's normals only have to be good enough to light it.
  function vertexNormals(mesh) {
    const normals = mesh.points.map(() => [0, 0, 0]);
    for (const face of mesh.faces) {
      const n = faceNormal(mesh.points, face);
      for (const index of face) normals[index] = vadd(normals[index], n);
    }
    return normals.map(n => V.norm(n) || [0, 0, 1]);
  }

  /* ------------------------------------------------------- the half-edges */

  //! Every directed edge in the mesh, and the face it belongs to. An edge whose
  //! reverse is missing is an open edge: the boundary of a hole, or of a sheet.
  function edgeMap(mesh) {
    const used = new Map();                 // "a,b" -> face index
    const key = (a, b) => a + "," + b;
    mesh.faces.forEach((face, at) => {
      for (let i = 0; i < face.length; i++)
        used.set(key(face[i], face[(i + 1) % face.length]), at);
    });
    const open = [];
    for (const [pair] of used) {
      const [a, b] = pair.split(",").map(Number);
      if (!used.has(key(b, a))) open.push([a, b]);
    }
    return { used, open, isOpen: (a, b) => !used.has(key(b, a)) || !used.has(key(a, b)) };
  }

  /* --------------------------------------------------------- Catmull-Clark */

  //! Catmull-Clark now lives in polymesh.js, with the creases, because the
  //! editor has to run the same subdivision the kernel does in order to show
  //! you what you are about to build. One implementation, imported here.

  /* ----------------------------------------------------------------- weld */

  //! Merges vertices that sit within \p tolerance of each other by rounding them
  //! into a grid and keeping the first of each cell. The neighbouring cells are
  //! checked too, so two points either side of a cell wall still meet.
  function weldMesh(mesh, tolerance, dropDegenerate) {
    const size = Math.max(1e-9, tolerance);
    const cells = new Map();
    const remap = new Array(mesh.points.length);
    const points = [];

    mesh.points.forEach((p, i) => {
      const c = p.map(v => Math.floor(v / size));
      let found = -1;
      for (let dx = -1; dx <= 1 && found < 0; dx++)
        for (let dy = -1; dy <= 1 && found < 0; dy++)
          for (let dz = -1; dz <= 1 && found < 0; dz++) {
            const bucket = cells.get((c[0] + dx) + "," + (c[1] + dy) + "," + (c[2] + dz));
            if (!bucket) continue;
            for (const candidate of bucket)
              if (length(vsub(points[candidate], p)) <= tolerance) { found = candidate; break; }
          }
      if (found < 0) {
        points.push(p);
        found = points.length - 1;
        const k = c.join(",");
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(found);
      }
      remap[i] = found;
    });

    const faces = [];
    for (const face of mesh.faces) {
      // A run of the same vertex is one vertex now; a face left with fewer than
      // three has collapsed.
      const walked = [];
      for (const i of face) {
        const to = remap[i];
        if (!walked.length || walked[walked.length - 1] !== to) walked.push(to);
      }
      while (walked.length > 1 && walked[0] === walked[walked.length - 1]) walked.pop();
      if (walked.length >= 3 || !dropDegenerate) faces.push(walked);
    }
    return { points, faces: faces.filter(face => face.length >= 3),
             merged: mesh.points.length - points.length,
             dropped: mesh.faces.length - faces.filter(face => face.length >= 3).length };
  }

  /* ------------------------------------------------------------ hole fill */

  //! Chains the open edges into loops and closes each one. A loop is walked by
  //! following the open edge that leaves the vertex the last one arrived at, so
  //! a hole with a pinch in it comes out as two loops rather than one bad face.
  //! Every closed run of open edges. A hole with a pinch in it comes out as two
  //! loops rather than one bad face, because the walk follows the open edge
  //! leaving the vertex it just arrived at and never uses one twice.
  function boundaryLoops(mesh, maxEdges = 100000) {
    const { open } = edgeMap(mesh);
    const leaving = new Map();
    for (const [a, b] of open) {
      if (!leaving.has(a)) leaving.set(a, []);
      leaving.get(a).push(b);
    }
    const walked = new Set();
    const loops = [], abandoned = [];
    for (const [start] of leaving) {
      let here = start;
      const loop = [];
      while (leaving.has(here)) {
        const next = (leaving.get(here) || []).find(to => !walked.has(here + "," + to));
        if (next === undefined) break;
        walked.add(here + "," + next);
        loop.push(here);
        here = next;
        if (here === start || loop.length > maxEdges) break;
      }
      if (loop.length >= 3 && here === start && loop.length <= maxEdges) loops.push(loop);
      else if (loop.length) abandoned.push(loop);
    }
    return { loops, abandoned };
  }

  function fillHoles(mesh, maxEdges, fan) {
    const points = mesh.points.slice();
    const faces = mesh.faces.slice();
    const { loops, abandoned } = boundaryLoops(mesh, maxEdges);

    for (const loop of loops) {
      // The loop runs the way the open edges do, so the patch faces the other
      // way - reversed, it agrees with the faces around it.
      const ring = loop.slice().reverse();
      if (fan && ring.length > 4) {
        points.push(centroid(ring.map(i => points[i])));
        const middle = points.length - 1;
        for (let i = 0; i < ring.length; i++)
          faces.push([middle, ring[i], ring[(i + 1) % ring.length]]);
      } else {
        faces.push(ring);
      }
    }
    return { points, faces, filled: loops.length, skipped: abandoned.length };
  }

  /* --------------------------------------------------------- mesh sources */

  //! A box as a cage of quads. Each face is a grid, and the grids share their
  //! edges, so the box welds to itself without being welded.
  function boxMesh(dx, dy, dz, segX, segY, segZ, place) {
    const points = [];
    const index = new Map();
    const at = (i, j, k) => {
      const key = i + "," + j + "," + k;
      if (!index.has(key)) {
        points.push(place([dx * i / segX, dy * j / segY, dz * k / segZ]));
        index.set(key, points.length - 1);
      }
      return index.get(key);
    };
    const faces = [];
    const quad = (a, b, c, d) => faces.push([a, b, c, d]);
    for (let i = 0; i < segX; i++) for (let j = 0; j < segY; j++) {
      quad(at(i, j, 0), at(i, j + 1, 0), at(i + 1, j + 1, 0), at(i + 1, j, 0));
      quad(at(i, j, segZ), at(i + 1, j, segZ), at(i + 1, j + 1, segZ), at(i, j + 1, segZ));
    }
    for (let i = 0; i < segX; i++) for (let k = 0; k < segZ; k++) {
      quad(at(i, 0, k), at(i + 1, 0, k), at(i + 1, 0, k + 1), at(i, 0, k + 1));
      quad(at(i, segY, k), at(i, segY, k + 1), at(i + 1, segY, k + 1), at(i + 1, segY, k));
    }
    for (let j = 0; j < segY; j++) for (let k = 0; k < segZ; k++) {
      quad(at(0, j, k), at(0, j, k + 1), at(0, j + 1, k + 1), at(0, j + 1, k));
      quad(at(segX, j, k), at(segX, j + 1, k), at(segX, j + 1, k + 1), at(segX, j, k + 1));
    }
    return { points, faces };
  }

  //! The axis system a mesh source is laid out on: the plane gives the
  //! orientation, the point the position, and the same fallback as everywhere
  //! else when either is missing.
  function meshFrame(originFeature, planeFeature) {
    const at = readPoint(originFeature) || [0, 0, 0];
    const axis = planeAxis(planeFeature);
    if (!axis) return p => vadd(at, p);
    const o = axis.Location(), z = axis.Direction(), x = axis.XDirection(), y = axis.YDirection();
    const O = [o.X(), o.Y(), o.Z()], X = [x.X(), x.Y(), x.Z()];
    const Y = [y.X(), y.Y(), y.Z()], Z = [z.X(), z.Y(), z.Z()];
    // The plane orients; the point positions, measured from the plane's origin.
    const shift = originFeature ? vsub(at, O) : [0, 0, 0];
    return p => vadd(vadd(O, shift),
      vadd(vadd(vmul(X, p[0]), vmul(Y, p[1])), vmul(Z, p[2])));
  }

  builders.MeshBox = {
    precondition: f => {
      for (const key of ["dx", "dy", "dz"])
        if (F.real(f, key, 120) <= CONFUSION) return "every side must be longer than nothing";
      return null;
    },
    build: f => {
      const seg = key => Math.max(1, Math.round(F.real(f, key, 1)));
      const place = meshFrame(F.reference(f, "origin"), F.reference(f, "plane"));
      const mesh = boxMesh(F.real(f, "dx", 120), F.real(f, "dy", 120), F.real(f, "dz", 120),
                           seg("segX"), seg("segY"), seg("segZ"), place);
      return { data: packMesh(checkMesh(mesh, "box")) };
    },
  };

  builders.MeshGrid = {
    precondition: f => {
      if (F.real(f, "width", 400) <= CONFUSION || F.real(f, "depth", 400) <= CONFUSION)
        return "the grid must have a size";
      return null;
    },
    build: f => {
      const cols = Math.max(1, Math.round(F.real(f, "cols", 6)));
      const rows = Math.max(1, Math.round(F.real(f, "rows", 6)));
      const w = F.real(f, "width", 400), d = F.real(f, "depth", 400);
      const place = meshFrame(null, F.reference(f, "plane"));
      const points = [], faces = [];
      for (let j = 0; j <= rows; j++)
        for (let i = 0; i <= cols; i++)
          points.push(place([-w / 2 + w * i / cols, -d / 2 + d * j / rows, 0]));
      const at = (i, j) => j * (cols + 1) + i;
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++)
          faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
      return { data: packMesh(checkMesh({ points, faces }, "grid")) };
    },
  };

  builders.MeshFromShape = {
    precondition: f => {
      const source = F.reference(f, "shape");
      if (!source) return "nothing is wired in to tessellate";
      if (!F.shape(source)) return F.name(source) + " has not been built";
      if (countSubShapes(F.shape(source), FACE) === 0)
        return F.name(source) + " has no faces to tessellate";
      return null;
    },
    //! OpenCascade tessellates per face and gives every face its own copy of
    //! the shared vertices, so the result is a pile of triangles rather than a
    //! mesh. Welding is what turns it into one, and is on by default.
    build: f => {
      const shape = F.shape(F.reference(f, "shape"));
      const quality = Math.max(0.05, F.real(f, "quality", 1));
      const stream = tessellate(shape, deflectionFor(shape) / quality);
      if (!stream.positions || !stream.index || !stream.index.length)
        throw new Error("the tessellation came back empty");
      const points = [];
      for (let i = 0; i + 2 < stream.positions.length; i += 3)
        points.push([stream.positions[i], stream.positions[i + 1], stream.positions[i + 2]]);
      const faces = [];
      for (let i = 0; i + 2 < stream.index.length; i += 3)
        faces.push([stream.index[i], stream.index[i + 1], stream.index[i + 2]]);
      let mesh = { points, faces };
      if (Feature_choice(f, "weld") === 0) {
        const box = extents(shape);
        mesh = weldMesh(mesh, Math.max(1e-4, (box ? box.diagonal : 100) * 1e-5), true);
      }
      return { data: packMesh(checkMesh(mesh, "tessellation")) };
    },
  };

  /* ----------------------------------------------------- mesh operations */

  builders.EditMesh = {
    precondition: f => F.reference(f, "mesh") ? null : "no mesh to edit",
    //! THE EDIT LIST, REPLAYED. Not a mesh - a list of operations, run in order
    //! over whatever cage arrives from upstream. Change the divisions on the
    //! box underneath and the extrude, the bevel and the loop cuts all happen
    //! again to the new box, which is the whole reason this is a node rather
    //! than a bake.
    //!
    //! The hand-moved vertices come first and are kept as they were: they are
    //! the old way of saying the same thing, every model written before the
    //! editor existed has them, and they cost nothing.
    //!
    //! An operation that cannot find what it was about does not stop the list.
    //! A cage that has lost one face of one step should rebuild as the rest of
    //! the model with a line saying which step missed - not as an error where
    //! a building used to be.
    build: f => {
      const mesh = meshFrom(F.reference(f, "mesh"), "mesh");
      const moves = F.edits(f, "moves");
      const scale = F.real(f, "scale", 1);
      const points = mesh.points.map(p => p.slice());
      let stale = 0;
      for (const [index, offset] of Object.entries(moves)) {
        const at = Number(index);
        if (!(at >= 0 && at < points.length)) { stale++; continue; }
        points[at] = vadd(points[at], vmul(offset, scale));
      }
      let ops = [];
      const said = String(F.text(f, "ops") || "").trim();
      if (said && said !== "[]") {
        try {
          const read = JSON.parse(said);
          if (!Array.isArray(read)) throw new Error("the operations must be a list");
          ops = read;
        } catch (error) {
          throw new Error("the operation list is not readable: " + error.message);
        }
      }
      const done = applyOps({ ...mesh, points }, ops);
      const data = packMesh(checkMesh(done.mesh, "mesh"));
      const notes = [...done.notes];
      if (stale) notes.push(stale + " hand-moved vertices are no longer in this mesh");
      return { data, note: notes.length ? notes.join(" · ") : undefined };
    },
  };

  /* ------------------------------------------------- the cage back to B-Rep

     THE WAY OUT OF THE MESH SIDE. Rhino turns a SubD into a NURBS object and
     everything downstream then treats it as ordinary geometry; this does the
     same with the geometry this kernel has. The cage is subdivided to the
     level asked for, every face of the result becomes a face of a B-Rep, and
     the faces are sewn into a shell - a solid, if the cage was closed.

     A face of the subdivided cage is very nearly flat, which is the whole
     reason this works: one more level halves how far from flat a face is. So a
     face that IS flat within the sewing tolerance is made as one planar face,
     and one that is not is fanned into triangles, which are flat by
     construction. The result is exact - it is a real B-Rep with real faces,
     not a tessellation pretending - and it can be filleted, cut, sectioned and
     written to STEP like anything else here.                                */

  builders.MeshToShape = {
    precondition: f => {
      const source = F.reference(f, "mesh");
      if (!source) return "no mesh to convert";
      const data = F.data(source);
      if (!data || data.kind !== "mesh") return F.name(source) + " is not a mesh";
      const levels = Math.max(0, Math.round(F.real(f, "levels", 0)));
      const after = meshFaces(data).length * Math.pow(4, levels);
      if (after > 20000)
        return "that would be about " + Math.round(after / 1000) + "k faces to sew; "
          + "use fewer levels or a coarser cage";
      return null;
    },
    build: f => {
      let mesh = meshFrom(F.reference(f, "mesh"), "mesh");
      const levels = Math.max(0, Math.round(F.real(f, "levels", 0)));
      const sharp = Feature_choice(f, "boundary") === 0;
      for (let i = 0; i < levels; i++) mesh = catmullClark(mesh, { sharpBoundary: sharp });
      const tolerance = Math.max(1e-6, F.real(f, "tolerance", 0.01));
      const sewn = sewMesh(mesh, tolerance, Feature_choice(f, "solid") === 0);
      const { shape, closed, split, rim } = sewn;
      const faces = countSubShapes(shape, FACE);
      return {
        shape,
        note: faces + (faces === 1 ? " face" : " faces")
          + (closed ? ", sewn into a solid"
              : ", sewn into a shell" + (rim.length ? " - the cage is open along "
                  + rim.length + (rim.length === 1 ? " edge" : " edges") : ""))
          + (split ? " · " + split + " faces were not flat and were split into triangles" : ""),
      };
    },
  };

  builders.MeshTemplate = {
    //! The starting topologies. One node, a dozen shapes, because what they
    //! have in common - all quads, one piece, ready to push - matters more
    //! than what tells them apart.
    build: f => {
      const kind = ["plane", "grid", "box", "lshape", "cross", "hexagon", "honeycomb",
                    "disc", "cylinder", "tube", "sphere", "torus"][Feature_choice(f, "kind")]
                || "grid";
      const at = (key, fallback) => F.real(f, key, fallback);
      const options = {
        width: at("width", 1000), depth: at("depth", 1000),
        cols: Math.round(at("cols", 4)), rows: Math.round(at("rows", 4)),
        dx: at("dx", 1000), dy: at("dy", 1000), dz: at("dz", 1000),
        segX: Math.round(at("segX", 1)), segY: Math.round(at("segY", 1)),
        segZ: Math.round(at("segZ", 1)),
        arm: at("arm", 500), leg: at("leg", 500), grid: at("grid", 250),
        radius: at("radius", 500), size: at("size", 200),
        inner: at("inner", 250), outer: at("outer", 500), tube: at("tube", 160),
        height: at("height", 1000),
        rings: Math.round(at("rings", 2)), sides: Math.round(at("sides", 12)),
        caps: Feature_choice(f, "caps") === 0,
        tee: false,
      };
      if (kind === "plane") { options.cols = 1; options.rows = 1; }
      let mesh = templateMesh(kind, options);
      // Wherever the plane says, if one is wired in: a starting mesh is the
      // first thing in a model and it belongs where the model is, not at the
      // origin because that is where the maths happened.
      const place = meshFrame(null, F.reference(f, "plane"));
      if (place) mesh = { ...mesh, points: mesh.points.map(p => place(p)) };
      return { data: packMesh(checkMesh(mesh, "mesh")) };
    },
  };

  builders.Subdivide = {
    precondition: f => {
      const source = F.reference(f, "mesh");
      if (!source) return "no mesh to subdivide";
      if (Feature_choice(f, "on") === 1) return null;
      const data = F.data(source);
      const faces = data ? meshFaces(data).length : 0;
      const levels = Math.max(1, Math.round(F.real(f, "levels", 2)));
      // Every level multiplies the face count by the number of corners. Four
      // levels of a thousand quads is a quarter of a million faces, and the
      // level after that is where the tab stops responding.
      const after = faces * Math.pow(4, levels);
      if (after > 150000)
        return "level " + levels + " of this mesh would be about "
          + Math.round(after / 1000) + "k faces; use fewer levels or a coarser cage";
      return null;
    },
    build: f => {
      let mesh = meshFrom(F.reference(f, "mesh"), "mesh");
      if (Feature_choice(f, "on") === 0) {
        const levels = Math.max(1, Math.round(F.real(f, "levels", 2)));
        const sharp = Feature_choice(f, "boundary") === 0;
        for (let i = 0; i < levels; i++) mesh = catmullClark(mesh, { sharpBoundary: sharp });
      }
      const data = packMesh(checkMesh(mesh, "mesh"));
      data.smooth = Feature_choice(f, "shading") === 0;
      return { data };
    },
  };

  builders.Weld = {
    //! The same rule the fillet radius follows: judge it against the geometry
    //! before the operation runs, not by whether the result looks empty
    //! afterwards. A tolerance past a quarter of the mesh is never a weld.
    precondition: f => {
      const source = F.reference(f, "mesh");
      if (!source) return "no mesh to weld";
      const data = F.data(source);
      if (!data || data.kind !== "mesh") return F.name(source) + " is not a mesh";
      const points = F.triples(data);
      if (!points.length) return F.name(source) + " has no vertices";
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const p of points)
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
      const diagonal = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      const tolerance = F.real(f, "tolerance", 0.05);
      if (diagonal > CONFUSION && tolerance >= diagonal / 4)
        return "welding at " + trim(tolerance) + " mm would take most of a mesh only "
          + trim(diagonal) + " mm across; the limit here is " + trim(diagonal / 4) + " mm";
      return null;
    },
    build: f => {
      const mesh = meshFrom(F.reference(f, "mesh"), "mesh");
      const welded = weldMesh(mesh, Math.max(1e-6, F.real(f, "tolerance", 0.05)),
                              Feature_choice(f, "degenerate") === 0);
      if (!welded.faces.length && mesh.faces.length)
        throw new Error("that distance welds the whole mesh into nothing");
      return { data: packMesh(checkMesh(welded, "mesh")) };
    },
  };

  builders.FillHoles = {
    precondition: f => F.reference(f, "mesh") ? null : "no mesh to fill",
    build: f => {
      const mesh = meshFrom(F.reference(f, "mesh"), "mesh");
      const filled = fillHoles(mesh, Math.max(3, Math.round(F.real(f, "maxEdges", 64))),
                               Feature_choice(f, "fill") === 1);
      return { data: packMesh(checkMesh(filled, "mesh")) };
    },
  };

  /* ----------------------------------------------------------- amalgamate

     What a subdivision workflow actually wants when two cages meet. A CSG
     boolean would cut them against each other exactly and hand back a seam of
     triangles, which is right for a solid and useless as a cage: Catmull-Clark
     wants quads, and a triangle fan round the join pinches under it. So this
     does what a modeller does by hand - throws away the faces where the two
     run into each other, and bridges the openings left behind.

     For an exact boolean, do it on the B-Rep side and come back: Boolean, then
     MeshFromShape. That gives the right solid and a tessellation of it.
     ------------------------------------------------------------------------ */

  //! Every triangle of a mesh, for ray casting. Faces are fanned, which is
  //! exact for a convex n-gon and close enough for a cage's slightly bent ones.
  function trianglesOf(mesh) {
    const out = [];
    for (const face of mesh.faces)
      for (let i = 1; i + 1 < face.length; i++)
        out.push([mesh.points[face[0]], mesh.points[face[i]], mesh.points[face[i + 1]]]);
    return out;
  }

  //! Moller-Trumbore. Returns the distance along the ray, or null.
  function rayHitsTriangle(from, dir, [a, b, c]) {
    const e1 = vsub(b, a), e2 = vsub(c, a);
    const h = V.cross(dir, e2);
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-12) return null;                 // parallel
    const inv = 1 / det;
    const s = vsub(from, a);
    const u = inv * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u < 0 || u > 1) return null;
    const q = V.cross(s, e1);
    const v = inv * (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]);
    if (v < 0 || u + v > 1) return null;
    const t = inv * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
    return t > 1e-9 ? t : null;
  }

  // A direction chosen to line up with nothing: an axis-aligned ray through an
  // axis-aligned cage hits edges, and an edge hit is counted twice or not at all.
  const ODD_RAY = V.norm([0.5773502692, 0.3313007813, 0.7457221543]);

  //! Odd number of crossings, so it is inside. Only worth using on a mesh that
  //! is closed; on an open one it answers something, but not this question.
  function insideMesh(point, triangles) {
    let crossings = 0;
    for (const triangle of triangles)
      if (rayHitsTriangle(point, ODD_RAY, triangle) !== null) crossings++;
    return (crossings & 1) === 1;
  }

  //! The distance from a point to the nearest triangle of a mesh, and the
  //! direction to it. Brute force over the triangles: a cage is a few hundred.
  function nearestOn(point, triangles) {
    let best = Infinity, at = null;
    for (const [a, b, c] of triangles) {
      const n = V.norm(V.cross(vsub(b, a), vsub(c, a)));
      if (!n) continue;
      const away = vsub(point, a);
      const off = away[0] * n[0] + away[1] * n[1] + away[2] * n[2];
      // The foot of the perpendicular, clamped back into the triangle by
      // falling to the nearest corner when it lands outside.
      const foot = vsub(point, vmul(n, off));
      const inside = [[a, b], [b, c], [c, a]].every(([p, q]) => {
        const edge = vsub(q, p), to = vsub(foot, p);
        const cross = V.cross(edge, to);
        return cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] >= -1e-9;
      });
      const candidates = inside ? [foot] : [a, b, c];
      for (const candidate of candidates) {
        const d = length(vsub(point, candidate));
        if (d < best) { best = d; at = candidate; }
      }
    }
    return { distance: best, at };
  }

  //! Two open loops, sewn together. Equal lengths give quads all the way round;
  //! unequal ones walk both loops in step and drop in a triangle wherever one
  //! side has to catch up, which is what a bridge between mismatched loops is.
  function bridgeLoops(A, B) {
    const n = A.length, m = B.length;
    const faces = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      const ta = i < n ? (i + 1) / n : Infinity;
      const tb = j < m ? (j + 1) / m : Infinity;
      // Wound against the loops, not with them. A boundary loop follows the
      // free directed edges of the faces around it, so a bridge that runs the
      // same way leaves the edge free a second time and the rim stays open.
      if (i < n && j < m && Math.abs(ta - tb) < 1e-9) {
        faces.push([A[(i + 1) % n], A[i], B[j], B[(j + 1) % m]]);
        i++; j++;
      } else if (ta < tb) {
        faces.push([A[(i + 1) % n], A[i], B[j % m]]);
        i++;
      } else {
        faces.push([A[i % n], B[j], B[(j + 1) % m]]);
        j++;
      }
    }
    return faces;
  }

  //! Which vertex of B to start at so the bridge does not come out twisted:
  //! the rotation that puts the two loops closest to each other overall.
  function alignLoops(points, A, B) {
    let best = 0, shortest = Infinity;
    for (let k = 0; k < B.length; k++) {
      let total = 0;
      for (let i = 0; i < A.length; i++) {
        const b = B[(k + Math.round(i * B.length / A.length)) % B.length];
        total += length(vsub(points[A[i]], points[b]));
        if (total >= shortest) break;
      }
      if (total < shortest) { shortest = total; best = k; }
    }
    return best;
  }

  const rotated = (loop, by) =>
    loop.map((_, i) => loop[(((i + by) % loop.length) + loop.length) % loop.length]);

  builders.MeshMerge = {
    precondition: f => {
      for (const key of ["a", "b"]) {
        const source = F.reference(f, key);
        if (!source) return "both meshes are needed - " + key.toUpperCase() + " is empty";
        const data = F.data(source);
        if (!data || data.kind !== "mesh") return F.name(source) + " is not a mesh";
        if (!data.values.length) return F.name(source) + " has no vertices";
      }
      const size = ["a", "b"].reduce((n, key) =>
        n + meshFaces(F.data(F.reference(f, key))).length, 0);
      // Both tests are brute force over the other mesh's triangles. Two cages
      // are a few hundred faces; two tessellations are a hundred thousand, and
      // that is a different algorithm, not a slower one.
      if (size > 6000)
        return size + " faces is more than this merge will walk - it compares every "
          + "face against the whole of the other mesh. Merge the cages, then subdivide.";
      return null;
    },

    build: f => {
      const A = meshFrom(F.reference(f, "a"), "mesh A");
      const B = meshFrom(F.reference(f, "b"), "mesh B");
      const mode = Feature_choice(f, "mode");

      // One mesh, B's indices moved up behind A's.
      const shift = A.points.length;
      const points = A.points.concat(B.points);
      const faces = A.faces.concat(B.faces.map(face => face.map(i => i + shift)));
      const fromA = faces.map((_, at) => at < A.faces.length);

      const trianglesA = trianglesOf(A), trianglesB = trianglesOf(B);
      const distance = F.real(f, "distance", 40);
      const squareOn = F.real(f, "facing", 0.35);

      //! Whether a face is in the way of the other mesh: either its middle is
      //! inside it, or it is close to it and pointing at it.
      const inTheWay = (face, mine, theirs, triangles) => {
        const middle = centroid(face.map(i => points[i]));
        if (mode === 0) return insideMesh(middle, triangles);
        const near = nearestOn(middle, triangles);
        if (!(near.distance <= distance) || !near.at) return false;
        const towards = V.norm(vsub(near.at, middle));
        if (!towards) return true;
        const n = faceNormal(points, face);
        return n[0] * towards[0] + n[1] * towards[1] + n[2] * towards[2] >= squareOn;
      };

      const doomed = faces.map((face, at) =>
        inTheWay(face, at, null, fromA[at] ? trianglesB : trianglesA));
      const removed = doomed.filter(Boolean).length;
      if (!removed)
        throw new Error(mode === 0
          ? "neither cage reaches inside the other, so nothing was removed - move them "
            + "together, or switch to facing within a distance"
          : "no face is within " + trim(distance) + " mm of the other cage and pointing at it");
      if (removed === faces.length)
        throw new Error("that would remove every face of both cages");

      // The vertices the removed faces touched: only the loops around those are
      // the ones this operation made, and only those get bridged.
      const touched = new Set();
      faces.forEach((face, at) => { if (doomed[at]) for (const i of face) touched.add(i); });

      const kept = faces.filter((_, at) => !doomed[at]);
      const keptFromA = faces.map((_, at) => at).filter(at => !doomed[at]).map(at => fromA[at]);
      let merged = { points, faces: kept };

      if (Feature_choice(f, "bridge") === 0) {
        const { loops } = boundaryLoops(merged, 4000);
        // A loop belongs to whichever cage its vertices came from, and it is one
        // of ours only if the faces we removed were the ones that opened it.
        const ours = loops.filter(loop => loop.every(i => touched.has(i)));
        const sideA = ours.filter(loop => loop[0] < shift);
        const sideB = ours.filter(loop => loop[0] >= shift);
        if (!sideA.length || !sideB.length)
          throw new Error("removing those faces left " + sideA.length + " opening"
            + (sideA.length === 1 ? "" : "s") + " on A and " + sideB.length + " on B, "
            + "so there is nothing to bridge across - try the other way of choosing faces");

        const flip = Feature_choice(f, "flip") === 1;
        const twist = Math.round(F.real(f, "twist", 0));
        const spare = sideB.slice();
        const bridged = [];
        for (const loop of sideA) {
          // Each opening on A joins the nearest one left on B.
          const middle = centroid(loop.map(i => points[i]));
          let best = 0, shortest = Infinity;
          spare.forEach((other, at) => {
            const d = length(vsub(middle, centroid(other.map(i => points[i]))));
            if (d < shortest) { shortest = d; best = at; }
          });
          if (!spare.length) break;
          const partner = spare.splice(best, 1)[0];
          // The two loops run the way their own faces wind, which is opposite
          // across the join; one is turned round so the bridge does not knot.
          const facing = flip ? partner.slice() : partner.slice().reverse();
          const aligned = rotated(facing, alignLoops(points, loop, facing) + twist);
          bridged.push(...bridgeLoops(loop, aligned));
        }
        if (!bridged.length)
          throw new Error("the openings could not be bridged");
        merged = { points, faces: kept.concat(bridged) };
      }

      const weld = F.real(f, "weld", 0.05);
      if (weld > 1e-9) merged = weldMesh(merged, weld, true);
      // A merge that leaves nothing standing is a mistake, not a result.
      if (!merged.faces.length) throw new Error("nothing was left of either cage");
      return { data: packMesh(checkMesh(merged, "merged mesh")) };
    },
  };

  builders.MeshTransform = {
    precondition: f => {
      if (!F.reference(f, "mesh")) return "no mesh to move";
      for (const key of ["scale", "sx", "sy", "sz"])
        if (Math.abs(F.real(f, key, 1)) < 1e-6) return "a scale of zero leaves nothing";
      return null;
    },
    build: f => {
      const mesh = meshFrom(F.reference(f, "mesh"), "mesh");
      // One factor, then a factor per axis. Both, because "twice the size" and
      // "squashed to 0.4 in Z" are different sentences and a modeller says both.
      const scale = F.real(f, "scale", 1);
      const axes = [F.real(f, "sx", 1) * scale, F.real(f, "sy", 1) * scale,
                    F.real(f, "sz", 1) * scale];
      const move = [F.real(f, "mx", 0), F.real(f, "my", 0), F.real(f, "mz", 0)];
      const [rx, ry, rz] = ["rx", "ry", "rz"].map(k => F.real(f, k, 0) * Math.PI / 180);
      const turn = (p, angle, i, j) => {
        const c = Math.cos(angle), s = Math.sin(angle);
        const out = p.slice();
        out[i] = p[i] * c - p[j] * s;
        out[j] = p[i] * s + p[j] * c;
        return out;
      };
      // About the mesh's own middle, so turning it does not fling it away.
      const middle = centroid(mesh.points);
      const points = mesh.points.map(p => {
        const d = vsub(p, middle);
        let q = [d[0] * axes[0], d[1] * axes[1], d[2] * axes[2]];
        q = turn(q, rx, 1, 2);
        q = turn(q, ry, 2, 0);
        q = turn(q, rz, 0, 1);
        return vadd(vadd(q, middle), move);
      });
      return { data: packMesh(checkMesh({ points, faces: mesh.faces }, "mesh")) };
    },
  };

  builders.MeshDisplace = {
    precondition: f => {
      if (!F.reference(f, "mesh")) return "no mesh to displace";
      const source = F.code(f, "formula", "").trim();
      if (!source) return "there is no formula";
      try { compileDisplacement(source); } catch (err) { return err.message; }
      return null;
    },
    build: f => {
      const mesh = meshFrom(F.reference(f, "mesh"), "mesh");
      const evaluate = compileDisplacement(F.code(f, "formula", "").trim());
      const amount = F.real(f, "amount", 20);
      const along = Feature_choice(f, "along");
      const normals = along === 0 ? vertexNormals(mesh) : null;
      const axis = [null, [1, 0, 0], [0, 1, 0], [0, 0, 1]][along] || [0, 0, 1];
      const n = mesh.points.length;
      const points = mesh.points.map((p, i) => {
        const k = evaluate(p[0], p[1], p[2], i, n);
        if (!Number.isFinite(k))
          throw new Error("the formula gave " + k + " at vertex " + i);
        return vadd(p, vmul(normals ? normals[i] : axis, k * amount));
      });
      return { data: packMesh(checkMesh({ points, faces: mesh.faces }, "mesh")) };
    },
  };

  //! One expression over a vertex's own position, and where it sits in the list.
  //! Compiled the same guarded way the written features are.
  const displacementCache = new Map();
  function compileDisplacement(source) {
    if (displacementCache.has(source)) return displacementCache.get(source);
    let fn;
    try {
      fn = new Function("x", "y", "z", "i", "n", "Math",
        '"use strict"; return (' + source + ");");
    } catch (err) {
      throw new Error("the formula will not compile: " + (err.message || err));
    }
    const wrapped = (x, y, z, i, n) => {
      const v = fn(x, y, z, i, n, Math);
      if (typeof v !== "number") throw new Error("the formula gave " + typeof v + ", not a number");
      return v;
    };
    if (displacementCache.size > 60) displacementCache.clear();
    displacementCache.set(source, wrapped);
    return wrapped;
  }

  //! The same seven quantities off a polymesh. Length is the total length of
  //! its edges, area the sum of its polygons, volume the divergence-theorem
  //! answer - which only means something on a mesh that is closed.
  function measureMesh(f, data) {
    const mesh = { points: F.triples(data), faces: meshFaces(data) };
    const quantity = Feature_choice(f, "quantity");
    if (quantity === 0) {
      let total = 0;
      const seen = new Set();
      for (const face of mesh.faces)
        for (let i = 0; i < face.length; i++) {
          const a = face[i], b = face[(i + 1) % face.length];
          const key = a < b ? a + "," + b : b + "," + a;
          if (seen.has(key)) continue;
          seen.add(key);
          total += length(vsub(mesh.points[a], mesh.points[b]));
        }
      return total;
    }
    if (quantity === 1) return mesh.faces.reduce((n, face) => n + faceArea(mesh.points, face), 0);
    if (quantity === 2) return meshVolume(mesh);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.points)
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
    const size = [0, 1, 2].map(i => (Number.isFinite(hi[i] - lo[i]) ? hi[i] - lo[i] : 0));
    return quantity === 6 ? Math.hypot(...size) : size[quantity - 3];
  }

  /* ================================================================ lists

     The four primitives a graph needs before it can compose anything: a list
     you type, a group, a projection onto terrain, and a way to put one shape
     at many places. Without them a definition of any size falls back to a
     written feature, and a written feature takes no inputs - so it stops being
     part of the graph at all.
     ================================================================== */

  builders.Numbers = {
    precondition: f => parseNumbers(F.text(f, "values", "")).length
      ? null : "type some numbers, separated by commas or spaces",
    build: f => {
      const scale = F.real(f, "scale", 1);
      return { data: numbers(parseNumbers(F.text(f, "values", "")).map(v => v * scale)) };
    },
  };

  builders.Join = {
    precondition: f => {
      const parts = F.references(f, "parts");
      if (!parts.length) return "nothing is wired in to join";
      for (const part of parts)
        if (!F.shape(part)) return F.name(part) + " has not been built";
      return null;
    },
    //! A compound, not a fuse. The parts keep their own faces and nothing is
    //! recomputed - which is what a group is for.
    build: f => compoundOf(F.references(f, "parts").map(F.shape)),
  };

  //! Triangles to cast against, whether the target is a mesh or a solid. A
  //! solid is tessellated once, here, at the resolution the viewer would use.
  function targetTriangles(source, what) {
    const data = F.data(source);
    if (data && data.kind === "mesh")
      return trianglesOf({ points: F.triples(data), faces: meshFaces(data) });
    const shape = F.shape(source);
    if (!shape) throw new Error(F.name(source) + " has not been built");
    const stream = tessellate(shape, 0);
    if (!stream.positions || !stream.index || !stream.index.length)
      throw new Error("there is no surface on " + F.name(source) + " to land on");
    const out = [];
    const at = i => [stream.positions[i * 3], stream.positions[i * 3 + 1], stream.positions[i * 3 + 2]];
    for (let i = 0; i + 2 < stream.index.length; i += 3)
      out.push([at(stream.index[i]), at(stream.index[i + 1]), at(stream.index[i + 2])]);
    return out;
  }

  //! The nearest point to \p at on one triangle, and how far that is. The
  //! classic clamp-to-the-triangle: inside the face it is the foot of the
  //! perpendicular, outside it is the nearest point of the nearest edge.
  function nearestOnTriangle(at, [a, b, c]) {
    const ab = V.sub(b, a), ac = V.sub(c, a), ap = V.sub(at, a);
    const d1 = V.dot(ab, ap), d2 = V.dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return a;
    const bp = V.sub(at, b);
    const d3 = V.dot(ab, bp), d4 = V.dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0)
      return V.add(a, V.scale(ab, d1 / (d1 - d3 || 1)));
    const cp = V.sub(at, c);
    const d5 = V.dot(ab, cp), d6 = V.dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0)
      return V.add(a, V.scale(ac, d2 / (d2 - d6 || 1)));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0)
      return V.add(b, V.scale(V.sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6) || 1)));
    const denom = 1 / (va + vb + vc);
    return V.add(a, V.add(V.scale(ab, vb * denom), V.scale(ac, vc * denom)));
  }

  //! WHERE A POINT LANDS ON SOMETHING ELSE. A plane is answered exactly and
  //! without an edge - the foot of the perpendicular, which is still on the
  //! plane a hundred metres past where the plane happens to be DRAWN, because
  //! a plane is infinite and only its picture is not. Anything else is
  //! answered off its triangles: nearest point, or straight down, which is the
  //! one an architect means by "put this on the site".
  function projectOnto(at, onto, straightDown) {
    const plane = planeAxis(onto);
    if (plane && !straightDown) {
      const N = plane.Direction(), P = plane.Location();
      const n = [N.X(), N.Y(), N.Z()], seat = [P.X(), P.Y(), P.Z()];
      return V.sub(at, V.scale(n, V.dot(V.sub(at, seat), n)));
    }
    let triangles = [];
    try { triangles = targetTriangles(onto, "target"); } catch (error) { triangles = []; }
    if (triangles.length) {
      if (straightDown) {
        let high = -Infinity;
        for (const [a, b, c] of triangles) high = Math.max(high, a[2], b[2], c[2]);
        const from = [at[0], at[1], high + 1];
        let best = null;
        for (const triangle of triangles) {
          const t = rayHitsTriangle(from, [0, 0, -1], triangle);
          if (t === null) continue;
          const z = from[2] - t;
          if (best === null || z > best) best = z;
        }
        return best === null ? null : [at[0], at[1], best];
      }
      let best = null, far = Infinity;
      for (const triangle of triangles) {
        const here = nearestOnTriangle(at, triangle);
        const d = V.length(V.sub(here, at));
        if (d < far) { far = d; best = here; }
      }
      return best;
    }
    // No surface at all: a curve will do, and the nearest point on it is the
    // same question asked of one dimension fewer.
    const shape = F.shape(onto);
    if (!shape || straightDown) return null;
    let best = null, far = Infinity;
    for (const edge of eachEdge(shape)) {
      const walk = new oc.BRepAdaptor_Curve(edge);
      const steps = 64;
      const t0 = walk.FirstParameter(), t1 = walk.LastParameter();
      for (let i = 0; i <= steps; i++) {
        const p = walk.Value(t0 + (t1 - t0) * (i / steps));
        const here = [p.X(), p.Y(), p.Z()];
        const d = V.length(V.sub(here, at));
        if (d < far) { far = d; best = here; }
      }
    }
    return best;
  }

  builders.Drape = {
    precondition: f => {
      if (!F.references(f, "points").length) return "no points to drape";
      if (!F.reference(f, "onto")) return "nothing to drape them onto";
      return null;
    },
    //! Straight down, and the highest thing hit wins - so a point over an
    //! overhang lands on the top of it, the way a building sits on a hill
    //! rather than inside it.
    build: f => {
      const plan = pointsOf(f, "points");
      if (!plan.length) throw new Error("that input carries no points");
      const triangles = targetTriangles(F.reference(f, "onto"), "target");
      if (!triangles.length) throw new Error("the target has no surface to land on");

      let high = -Infinity;
      for (const [a, b, c] of triangles) high = Math.max(high, a[2], b[2], c[2]);
      const start = high + 1;
      const down = [0, 0, -1];
      const lift = F.real(f, "lift", 0);
      const keep = Feature_choice(f, "miss") === 1;

      const landed = [];
      let missed = 0;
      for (const point of plan) {
        const from = [point[0], point[1], start];
        let best = null;
        for (const triangle of triangles) {
          const t = rayHitsTriangle(from, down, triangle);
          if (t === null) continue;
          const z = start - t;
          if (best === null || z > best) best = z;
        }
        if (best === null) { missed++; if (keep) landed.push([point[0], point[1], point[2] + lift]); continue; }
        landed.push([point[0], point[1], best + lift]);
      }
      if (!landed.length)
        throw new Error("not one of those " + plan.length + " points is over the target");
      if (missed && !keep && landed.length < plan.length)
        F.setError(f, "");                       // a partial drape is still a drape
      return { shape: compoundOf(landed.map(vertexAt)), data: points(landed) };
    },
  };

  builders.PlaceAt = {
    precondition: f => {
      const shape = F.reference(f, "shape");
      if (!shape) return "no shape to place";
      if (!F.shape(shape)) return F.name(shape) + " has not been built";
      if (!F.references(f, "points").length) return "no points to place it at";
      if (!pointsOf(f, "points").length) return "nothing wired into Points carries any";
      return null;
    },
    //! One shape, many locations. Each copy is the same TopoDS_Shape with a
    //! different TopLoc_Location on it - the instancing the Array feature uses,
    //! so the cost of the hundredth copy is a matrix, not a rebuild.
    build: f => {
      const shape = F.shape(F.reference(f, "shape"));
      const at = pointsOf(f, "points");
      const angles = F.reference(f, "angles");
      const turns = angles ? (F.data(angles) || { values: [] }).values : [];
      const base = F.real(f, "turn", 0);
      const lift = F.real(f, "lift", 0);
      if (at.length > 2000)
        throw new Error(at.length + " places is more than this will build at once");

      const api = shapeApi();
      const copies = at.map((point, i) => {
        // The angle list is read the way every other list is: the shortest
        // repeats its last value, so one angle turns them all.
        const turn = base + (turns.length ? turns[Math.min(i, turns.length - 1)] : 0);
        const turned = Math.abs(turn) > 1e-9
          ? api.rotate(shape, turn, { at: [0, 0, 0], axis: [0, 0, 1] })
          : shape;
        return api.move(turned, [point[0], point[1], point[2] + lift]);
      });
      return compoundOf(copies);
    },
  };

  /* --------------------------------------------------------- transforms

     One gp_Trsf each, over a shape that is already built. Rigid moves go on as
     a TopLoc_Location - the shape is not rebuilt, it is the same shape
     somewhere else, which is why a mirrored assembly costs a matrix. A mirror
     and a scale change the shape itself, so those go through
     BRepBuilderAPI_Transform.                                                */

  //! What every transform below does with its answer: put it on, and keep the
  //! original beside it if that was asked for.
  //! THE SAME SHAPE, AS A SHAPE OF ITS OWN. A driver that hands back the shape
  //! it was given hands back the object its INPUT is stored in - and the next
  //! time that driver runs, the document releases what it stored last time,
  //! which deletes the input's shape out from under the feature that owns it.
  //! Every build after that says "Cannot pass deleted object as a pointer of
  //! type TopoDS_Shape" and there is nothing in the tree to explain it. So a
  //! pass-through is a location of nothing: a new handle onto the same
  //! geometry, which costs nothing and is safe to release.
  const asItWas = shape => shape.Moved(new oc.TopLoc_Location(new oc.gp_Trsf()));

  function transformed(shape, trsf, { rebuild = false, keep = false } = {}) {
    const moved = rebuild
      ? new oc.BRepBuilderAPI_Transform(shape, trsf, true).Shape()
      : shape.Moved(new oc.TopLoc_Location(trsf));
    return keep ? compoundOf([shape, moved]) : moved;
  }

  const movedTrouble = f => {
    const shape = F.reference(f, "shape");
    if (!shape) return "no shape to move";
    if (!F.shape(shape)) return F.name(shape) + " has not been built";
    return null;
  };

  builders.Move = {
    precondition: f => {
      const trouble = movedTrouble(f);
      if (trouble) return trouble;
      const kind = Feature_choice(f, "kind");
      if (kind === 1 && !(readPoint(F.reference(f, "from")) && readPoint(F.reference(f, "to"))))
        return "two points are needed to move between";
      if (kind === 2 && !(readPoint(F.reference(f, "start")) && readPoint(F.reference(f, "end"))))
        return "two points are needed to move between";
      if (kind === 0) {
        const along = axisOf(F.reference(f, "direction"));
        if (!along) return "a direction is needed";
        if (Math.abs(F.real(f, "distance", 100)) < CONFUSION) return "distance must not be zero";
      }
      return null;
    },
    build: f => {
      const shape = F.shape(F.reference(f, "shape"));
      const kind = Feature_choice(f, "kind");
      let by;
      if (kind === 1) {
        by = V.sub(readPoint(F.reference(f, "to")), readPoint(F.reference(f, "from")));
      } else if (kind === 2) {
        // The tween. Not clamped: a fraction past 1 goes past the far point and
        // a negative one goes back beyond the near one, which is what makes it
        // useful wired to a slider.
        const from = readPoint(F.reference(f, "start"));
        const to = readPoint(F.reference(f, "end"));
        by = V.scale(V.sub(to, from), F.real(f, "at", 0.5));
      } else {
        const along = axisOf(F.reference(f, "direction"));
        by = V.scale(V.norm(along.along) || [0, 0, 1], F.real(f, "distance", 100));
      }
      // A tween at nought is a tween at nought - the start of the travel, not a
      // mistake. Only point to point complains, because there the two points
      // being the same is somebody having wired the same point twice.
      if (kind === 1 && V.length(by) < CONFUSION)
        throw new Error("those two points are the same, so that is a move of nothing");
      // A tween at nought is a tween at nought - the start of the travel, not a
      // mistake - so it goes on as a translation of nothing rather than as an
      // error, and the shape it hands on is its own shape rather than the one
      // upstream, which everything downstream depends on.
      const trsf = new oc.gp_Trsf();
      trsf.SetTranslation(new oc.gp_Vec(by[0], by[1], by[2]));
      return transformed(shape, trsf, { keep: Feature_choice(f, "keep") === 1 });
    },
  };

  builders.Rotate = {
    precondition: f => {
      const trouble = movedTrouble(f);
      if (trouble) return trouble;
      const system = readAxisSystem(F.reference(f, "axis"));
      if (!system && !axisOf(F.reference(f, "axis")))
        return "an axis is needed to turn about";
      if (Math.abs(F.real(f, "end", 90) - F.real(f, "start", 0)) < CONFUSION)
        return "the start and end angles are the same, so nothing turns";
      return null;
    },
    //! An axis system knows where it is, so it needs no point wired to it. A
    //! bare direction does not, and falls back to the origin the way a rotation
    //! about "Z" has always meant about the Z axis.
    build: f => {
      const shape = F.shape(F.reference(f, "shape"));
      const system = readAxisSystem(F.reference(f, "axis"));
      const found = system ? { at: system.at, along: system.z } : axisOf(F.reference(f, "axis"));
      const at = readPoint(F.reference(f, "through")) || found.at || [0, 0, 0];
      const turn = F.real(f, "end", 90) - F.real(f, "start", 0);
      const trsf = new oc.gp_Trsf();
      trsf.SetRotation(new oc.gp_Ax1(pnt(at), dir(V.norm(found.along) || [0, 0, 1])),
                       turn * Math.PI / 180);
      return transformed(shape, trsf, { keep: Feature_choice(f, "keep") === 1 });
    },
  };

  builders.Mirror = {
    precondition: f => {
      const trouble = movedTrouble(f);
      if (trouble) return trouble;
      if (Feature_choice(f, "by") === 0) {
        if (!F.reference(f, "plane")) return "no plane to mirror in";
        return planeTrouble(F.reference(f, "plane"));
      }
      if (!readPoint(F.reference(f, "at"))) return "a point on the mirror plane is needed";
      if (!axisOf(F.reference(f, "normal"))) return "a normal to the mirror plane is needed";
      return null;
    },
    build: f => {
      const shape = F.shape(F.reference(f, "shape"));
      let at, normal;
      if (Feature_choice(f, "by") === 0) {
        const ax = planeAxis(F.reference(f, "plane"));
        if (!ax) throw new Error("that plane cannot be worked out");
        const p = ax.Location(), n = ax.Direction();
        at = [p.X(), p.Y(), p.Z()];
        normal = [n.X(), n.Y(), n.Z()];
      } else {
        at = readPoint(F.reference(f, "at"));
        normal = axisOf(F.reference(f, "normal")).along;
      }
      const trsf = new oc.gp_Trsf();
      // A mirror in a PLANE, not in a line: gp_Ax2 built from the point and the
      // normal is the plane, and SetMirror of an Ax2 reflects through it.
      trsf.SetMirror(new oc.gp_Ax2(pnt(at), dir(V.norm(normal) || [0, 0, 1])));
      // Reflecting turns a shape inside out - the faces that faced out face in -
      // so this one is rebuilt rather than relocated.
      return transformed(shape, trsf,
                         { rebuild: true, keep: Feature_choice(f, "keep") === 1 });
    },
  };

  builders.Scale = {
    precondition: f => {
      const trouble = movedTrouble(f);
      if (trouble) return trouble;
      if (F.real(f, "factor", 2) <= CONFUSION) return "the factor must be positive";
      return null;
    },
    build: f => {
      const shape = F.shape(F.reference(f, "shape"));
      const at = readPoint(F.reference(f, "centre")) || [0, 0, 0];
      const factor = F.real(f, "factor", 2);
      if (Math.abs(factor - 1) < CONFUSION) return asItWas(shape);
      const trsf = new oc.gp_Trsf();
      trsf.SetScale(pnt(at), factor);
      return transformed(shape, trsf, { rebuild: true });
    },
  };

  //! WHAT THE WIDGETS WRITE. Scale, then the three turns, then the move -
  //! composed in that order because that is the order every package composes
  //! them in, and a part turned and then moved has to end up where the hand
  //! left it rather than out past the origin.
  //!
  //! The turns are about the point given, or about the middle of the shape
  //! when none is: turning a tower about the world origin when you meant to
  //! turn it on its own spot is the single most annoying thing a transform can
  //! do, and it is not what the ring under your hand looked like it would do.
  builders.Transform = {
    precondition: f => {
      const trouble = movedTrouble(f);
      if (trouble) return trouble;
      if (F.real(f, "factor", 1) <= CONFUSION) return "the size must be greater than zero";
      return null;
    },
    build: f => {
      const shape = F.shape(F.reference(f, "shape"));
      const by = [F.real(f, "dx", 0), F.real(f, "dy", 0), F.real(f, "dz", 0)];
      const turn = [F.real(f, "rx", 0), F.real(f, "ry", 0), F.real(f, "rz", 0)];
      const factor = F.real(f, "factor", 1);
      const about = readPoint(F.reference(f, "about")) || centreOfShape(shape) || [0, 0, 0];
      const keep = Feature_choice(f, "keep") === 1;

      const still = V.length(by) < CONFUSION && Math.abs(factor - 1) < CONFUSION
        && turn.every(a => Math.abs(a) < 1e-9);
      // A transform of nothing is still a transform: it hands its own shape on
      // rather than failing, because everything downstream is wired to THIS
      // node and a widget that has not been dragged yet must not break the tree.
      if (still) return keep ? compoundOf([shape, asItWas(shape)]) : asItWas(shape);

      // Composed by multiplying in order rather than by hand: gp_Trsf carries a
      // scale factor of its own, so a scale and a rotation really are one
      // transform and there is nothing to approximate.
      let composed = new oc.gp_Trsf();
      if (Math.abs(factor - 1) >= CONFUSION) {
        const s = new oc.gp_Trsf();
        s.SetScale(pnt(about), factor);
        composed.Multiply(s);
      }
      const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      for (let i = 0; i < 3; i++) {
        if (Math.abs(turn[i]) < 1e-9) continue;
        const r = new oc.gp_Trsf();
        r.SetRotation(new oc.gp_Ax1(pnt(about), dir(axes[i])), turn[i] * Math.PI / 180);
        composed.PreMultiply(r);
      }
      if (V.length(by) >= CONFUSION) {
        const t = new oc.gp_Trsf();
        t.SetTranslation(new oc.gp_Vec(by[0], by[1], by[2]));
        composed.PreMultiply(t);
      }
      // A scale has to be rebuilt rather than relocated: a location carries a
      // rigid move and nothing else, so a scaled shape put on one comes back
      // the size it started.
      const rebuild = Math.abs(factor - 1) >= CONFUSION;
      return transformed(shape, composed, { rebuild, keep });
    },
  };

  //! The middle of a shape's bounding box, which is what "about itself" means
  //! to a hand on a ring.
  function centreOfShape(shape) {
    const box = extents(shape);
    return box ? box.centre : null;
  }

  builders.AxisToAxis = {
    precondition: f => {
      const source = F.reference(f, "shape");
      if (!source) return "no shape to move";
      if (!F.shape(source) && !isMesh(source)) return F.name(source) + " has not been built";
      if (!readAxisSystem(F.reference(f, "from"))) return "no axis system to come from";
      if (!readAxisSystem(F.reference(f, "to"))) return "no axis system to go to";
      return null;
    },
    //! gp_Trsf::SetTransformation of two gp_Ax3 is exactly this operation, and
    //! it is the one an assembly is built out of: the part is drawn about its
    //! own frame once, and every instance of it is that frame sent somewhere.
    build: f => {
      const source = F.reference(f, "shape");
      const from = readAxisSystem(F.reference(f, "from"));
      const to = readAxisSystem(F.reference(f, "to"));
      const trsf = new oc.gp_Trsf();
      trsf.SetTransformation(axisPlacement(to), axisPlacement(from));
      //! A MESH GOES THE SAME WAY A SOLID DOES.
      //!
      //! This is the node an instance is made with - one master, many
      //! placements - and an imported building is full of things that arrived
      //! as triangles: a joist exported as an IfcPolygonalFaceSet and put down
      //! two hundred times. Refused a mesh, the only way to place those was to
      //! write the triangles out again at each one, which on a Revit model was
      //! 38,963 nodes where 8,859 do.
      //!
      //! Mesh transform could not stand in for it: that turns about the mesh's
      //! own middle by three Euler angles, which is a different question from
      //! "put this frame there".
      if (!F.shape(source) && isMesh(source)) {
        const mesh = meshFrom(source, "shape");
        const points = mesh.points.map(p => {
          const moved = pnt(p).Transformed(trsf);
          return [moved.X(), moved.Y(), moved.Z()];
        });
        return { data: packMesh(checkMesh({ points, faces: mesh.faces }, "mesh")) };
      }
      return transformed(F.shape(source), trsf, {});
    },
  };

  /* --------------------------------------------------------- operations */

//! WHICH WAY AN EXTRUDE GOES, and it is the profile's own answer unless told
//! otherwise.
//!
//! A pad comes off the paper it was drawn on. Asking for a vector to say so
//! was asking for a fact the profile already knows, and getting it wrong is
//! how a plan gets extruded sideways.
//!
//! THE MISSING LABEL IS WHAT TELLS AN OLD FILE APART. A choice reports its
//! default when nothing was ever stored, so "Normal to the profile" and "never
//! asked" read the same - and every extrude saved before this existed has a
//! direction wired and no `way`. Turning those into normal extrudes would
//! quietly re-point geometry in files that were finished. So: nothing stored
//! AND a direction wired means the direction, which is exactly what that file
//! has always done. A new extrude has no direction wired, because the argument
//! only applies when `way` says so, and takes the normal.
  const extrudeWay = f => {
    const said = Feature_choice(f, "way", -1);
    const wired = V.norm(readVector(F.reference(f, "direction")) || [0, 0, 0]);
    if (said === 1 || (said < 0 && wired)) return wired;
    const profile = F.reference(f, "profile");
    const frame = F.frame(profile);
    if (frame && frame.normal) return V.norm(frame.normal);
    //! A FACE FIRST, then the wires. firstFace throws when there are none -
    //! which a curve profile has - so it is asked inside a try rather than
    //! guarded with a second walk of the same shape.
    try {
      const off = normalOfFace(firstFace(F.shape(profile), "profile"));
      if (off) return off;
    } catch (e) { /* no faces: it is a curve, and curves have wires */ }
    //! A flat WIRE has a plane too, and a sketch that was never given a frame
    //! - one built from loose curves - is the common case for that.
    return HSF.planeOfShape(F.shape(profile)) || null;
  };

  builders.Extrude = {
    precondition: f => {
      const profile = F.reference(f, "profile");
      if (!profile) return "no profile to extrude";
      if (!F.shape(profile)) return F.name(profile) + " has not been built";
      if (!extrudeWay(f)) return Feature_choice(f, "way") === 1
        ? "a direction vector is needed"
        : "that profile is not flat, so it has no normal to come off - "
          + "set Direction from to \"A direction\" and wire one";
      if (Feature_choice(f, "limit") === 1) {
        if (!F.reference(f, "until")) return "no plane to extrude up to";
        return planeTrouble(F.reference(f, "until"));
      }
      if (Math.abs(F.real(f, "distance", 120)) <= CONFUSION) return "distance must not be zero";
      return null;
    },
    build: f => {
      const source = F.shape(F.reference(f, "profile"));
      const v = extrudeWay(f);
      // How far is either a number or a plane. "Up to that face" is the
      // measurement a person actually has, and it keeps being true when the
      // plane moves - which a number typed once does not.
      //! UP TO A PLANE IS A TRIM, NOT A LENGTH.
      //!
      //! This measured from the middle of the profile to the plane and swept
      //! that far, which is exact for a plane square to the sweep and wrong
      //! for every other one: an angled plane is nearer at one edge of the
      //! profile than at the other, and no prism of a single length is flush
      //! with it. What came back was a plain prism of the average depth.
      //!
      //! So it sweeps PAST the plane and cuts - see trimAtPlane. Past by
      //! enough that the prism crosses the plane everywhere, which is the
      //! centre distance plus the profile's own reach, doubled and then some:
      //! the cut is what decides where it ends, so overshooting costs nothing
      //! but a boolean.
      const stop = Feature_choice(f, "limit") === 1
        ? planeAxis(F.reference(f, "until")) : null;
      const middle = HSF.pointCenter(source);
      const reach = stop
        ? HSF.lineDistanceToPlane(middle, v, stop)
        : F.real(f, "distance", 120);
      if (Math.abs(reach) < CONFUSION)
        throw new Error("the profile is already on that plane, so there is nothing to extrude");
      const over = stop
        ? Math.sign(reach) * (Math.abs(reach) + HSF.extentsOf(source) * 2 + 1)
        : reach;
      const along = V.scale(v, over);

      // Solid or surface is a real choice, not a hint, and the two factories
      // are where it is made. A pad is swept from the faces of the profile -
      // every one of them, so a sketch of six closed loops pads into six bodies
      // rather than the first. A surface is swept from the wires, so the same
      // sketch on "Surface" gives six tubes; a profile that arrived as a face
      // has its own outlines taken back off it.
      //! The trim keeps the side the PROFILE is on, which is the only side
      //! anybody means by "up to".
      const cut = made => stop ? HSF.trimAtPlane(made, stop, middle) : made;
      if (Feature_choice(f, "cap") === 0) {
        const faces = capped(f, source);
        if (!faces.length) throw new Error("the profile has nothing to extrude");
        return cut(SF.pad(HSF.join(faces), along));
      }
      const wires = outlines(f, source);
      if (!wires.length) throw new Error("the profile has nothing to extrude");
      return cut(HSF.extrude(HSF.join(wires), along));
    },
  };

  //! THE FOURTH CLASSICAL SWEEP. Extrude, Loft and Sweep were three of them
  //! and there was no road to this one at all: everything turned about an axis
  //! - a dome, a dish, a baluster, a tank end, and every IfcRevolvedAreaSolid
  //! in a building model - had to be faked as a loft through sections placed
  //! by hand.
  builders.Revolve = {
    precondition: f => {
      const profile = F.reference(f, "profile");
      if (!profile) return "no profile to turn";
      if (!F.shape(profile)) return F.name(profile) + " has not been built";
      if (!F.reference(f, "axis")) return "no axis to turn about";
      if (!revolveAxis(f)) return "that axis has no direction";
      return null;
    },
    build: f => {
      const source = F.shape(F.reference(f, "profile"));
      const axis = revolveAxis(f);
      const angle = F.real(f, "angle", 360);
      const turn = shape => HSF.revolve(shape, axis.at, axis.along, angle);
      if (Feature_choice(f, "cap") === 0) {
        const faces = capped(f, source);
        if (!faces.length) throw new Error("the profile has nothing to turn");
        const made = faces.map(turn);
        return { shape: made.length === 1 ? made[0] : compoundOf(made),
                 note: Math.abs(angle) >= 360 ? undefined : Math.round(angle) + "\u00b0" };
      }
      const wires = outlines(f, source);
      if (!wires.length) throw new Error("the profile has nothing to turn");
      const made = wires.map(turn);
      return made.length === 1 ? made[0] : compoundOf(made);
    },
  };

  //! CUT IT OFF AT A PLANE. The trim Extrude's "up to plane" does, as a node
  //! of its own, so anything at all can be cut and not only the thing being
  //! padded. A roof slab is a prism with its ends taken off at the pitch, and
  //! there is no other honest way to say that.
  builders.Trim = {
    precondition: f => {
      const body = F.reference(f, "body");
      if (!body) return "nothing to trim";
      if (!F.shape(body)) return F.name(body) + " has not been built";
      if (!F.reference(f, "by")) return "no plane to trim at";
      return planeTrouble(F.reference(f, "by"));
    },
    build: f => {
      const shape = F.shape(F.reference(f, "body"));
      const plane = planeAxis(F.reference(f, "by"));
      const at = plane.Location(), way = plane.Direction();
      const seat = [at.X(), at.Y(), at.Z()];
      const normal = [way.X(), way.Y(), way.Z()];
      //! WHICH SIDE TO KEEP, said as a point on it. The reach of the body is
      //! the only length here that is certainly big enough to be on one side
      //! of the plane and not on the other.
      const reach = (HSF.extentsOf(shape) || 1000) * 2 + 1;
      const keep = Feature_choice(f, "side") === 1 ? reach : -reach;
      return HSF.trimAtPlane(shape, plane, V.add(seat, V.scale(normal, keep)));
    },
  };

  //! A NAME AND SIX NUMBERS, not twelve lines and four fillets. The outline
  //! arithmetic is in sections.js, shared with the IFC reader, so a beam that
  //! came in from a file and a beam somebody typed are the same beam.
  builders.Section = {
    precondition: f => {
      if (!planeAxis(F.reference(f, "plane")))
        return planeTrouble(F.reference(f, "plane"))
            || "a plane is needed to put the section on";
      const made = sectionElements(f);
      if (!made.outer.length) return "that section has no size";
      return null;
    },
    build: f => {
      const frame = sectionFrame(f);
      const made = sectionElements(f);
      const ring = elements => {
        const drawing = { elements, constraints: [] };
        const { loops } = sketchLoops(drawing, 0.05);
        return loops.map(loop => sketchWireOrNothing(drawing, loop, frame, true))
                    .filter(Boolean);
      };
      const outer = ring(made.outer);
      if (!outer.length) throw new Error("that section does not close");
      const holes = made.inner.flatMap(ring);
      //! A FACE, NOT A WIRE. A section is always a closed profile, so there is
      //! no case where the loop is the answer - and a face is what measures an
      //! area, what pads into a body, and what carries its own holes with it
      //! rather than as a second loop somebody downstream has to notice.
      const shape = HSF.fillWithHoles(outer[0], holes.length ? holes : outer.slice(1));
      const kind = SECTION_KINDS[Feature_choice(f, "kind")] || SECTION_KINDS[0];
      return { shape, note: kind + " \u00b7 " + Math.round(F.real(f, "depth", 400))
                          + " \u00d7 " + Math.round(F.real(f, "width", 180)) };
    },
  };

  builders.Loft = {
    precondition: f => {
      const sections = F.references(f, "sections");
      if (sections.length < 2) return "a loft needs at least two sections";
      for (const section of sections)
        if (!F.shape(section)) return F.name(section) + " has not been built";
      return null;
    },
    build: f => {
      // A SECTION IS ONE LOOP. A drawing may hold several - a rectangle and
      // the circle inside it - and ThruSections has no word for the second, so
      // the outer one is taken and the node says it did rather than quietly
      // choosing for you.
      const sources = F.references(f, "sections");
      const outlines = sources.map(s => outlineOf(s, "section"));
      const ruled = Feature_choice(f, "ruled") === 1;
      const shape = Feature_choice(f, "cap") === 0
        ? SF.loft(outlines.map(one => one.wire), ruled)
        : HSF.loft(outlines.map(one => one.wire), ruled);
      const several = sources.filter((s, i) => outlines[i].many > 1);
      return several.length
        ? { shape, note: "the outer loop of " + several.map(F.name).join(", ")
              + (several.length === 1 ? "" : "") + " \u00b7 the rest is a second loft and a cut" }
        : shape;
    },
  };

  builders.Boolean = {
    precondition: f => {
      for (const key of ["a", "b"]) {
        const source = F.reference(f, key);
        if (!source) return "both bodies are needed - " + key.toUpperCase() + " is empty";
        if (!F.shape(source)) return F.name(source) + " has not been built";
        if (countSubShapes(F.shape(source), FACE) === 0)
          return F.name(source) + " has no faces to work with";
      }
      return null;
    },
    build: f => {
      const a = F.shape(F.reference(f, "a")), b = F.shape(F.reference(f, "b"));
      const op = Feature_choice(f, "op");
      const shape = op === 0 ? SF.add(a, b) : op === 1 ? SF.remove(a, b) : SF.intersect(a, b);
      if (countSubShapes(shape, FACE) === 0)
        throw new Error("the two bodies do not meet, so the result is empty");
      return shape;
    },
  };

  builders.Project = {
    precondition: f => {
      if (!F.reference(f, "curve")) return "no curve to project";
      const onto = F.reference(f, "onto");
      if (!onto) return "nothing to project onto";
      if (!F.shape(onto)) return F.name(onto) + " has not been built";
      if (countSubShapes(F.shape(onto), FACE) === 0)
        return F.name(onto) + " has no faces to land on";
      return null;
    },
    //! Sampled, pulled to the target, and re-fitted. An exact projected curve
    //! needs BRepProj_Projection, which this kernel does not carry; the nearest
    //! point on the target is exact at every sample, and the samples are yours.
    build: f => {
      const curve = sampleCurve(wireOf(F.reference(f, "curve"), "curve"));
      const target = F.shape(F.reference(f, "onto"));
      const count = Math.max(4, Math.round(F.real(f, "samples", 40)));
      const surfaces = [];
      const explorer = new oc.TopExp_Explorer(target, FACE, ANY);
      while (explorer.More()) {
        surfaces.push(oc.BRep_Tool.Surface(oc.TopoDS.Face(explorer.Current())));
        explorer.Next();
      }
      explorer.delete();
      if (!surfaces.length) throw new Error("the target has no surface to land on");

      const list = [];
      for (let i = 0; i <= count; i++) {
        const here = curve.at(i / count);
        let best = null, nearest = Infinity;
        for (const surface of surfaces) {
          const onto = new oc.GeomAPI_ProjectPointOnSurf(pnt(here), surface);
          if (onto.NbPoints() > 0 && onto.LowerDistance() < nearest) {
            const p = onto.NearestPoint();
            nearest = onto.LowerDistance();
            best = [p.X(), p.Y(), p.Z()];
          }
          onto.delete();
        }
        if (best) list.push(best);
      }
      if (list.length < 2) throw new Error("nothing of that curve lands on the target");
      //! Smoothed means fitted, not resampled: the landings are where the
      //! curve really met the target, and a B-spline through them is the
      //! projected curve. Taking it straight is still a polyline, because
      //! "straight" is a request for exactly the points that were measured.
      const smooth = Feature_choice(f, "fit") === 0;
      return { shape: smooth && list.length > 2 ? HSF.fitCurve(list, false, 0)
                                                : HSF.polyline(list, false),
               data: points(list) };
    },
  };

  //! Sweeping along a rail rather than along a direction. The profile is
  //! capped for a body and left open for a skin, which is the same choice
  //! Extrude offers and made in the same place.
  builders.Sweep = {
    precondition: f => {
      for (const [key, what] of [["profile", "profile"], ["spine", "rail"]]) {
        const source = F.reference(f, key);
        if (!source) return "no " + what + " to sweep" + (key === "spine" ? " along" : "");
        if (!F.shape(source)) return F.name(source) + " has not been built";
      }
      return null;
    },
    //! Solid or skin, the same rail. The factory works out what the profile
    //! offers - one loop, several, or a loop with a hole in it - so there is
    //! nothing to cap or take apart first.
    build: f => {
      const source = F.shape(F.reference(f, "profile"));
      const spine = F.shape(F.reference(f, "spine"));
      // A SECTION THAT BECOMES ANOTHER ONE. The third kind of pipe surface
      // the documentation lists, and the one nobody can fake with a constant
      // section: two profiles on one rail, and the sweep morphs between them.
      const into = F.reference(f, "into");
      const second = into ? F.shape(into) : null;
      if (into && !second) throw new Error(F.name(into) + " has not been built");
      const made = Feature_choice(f, "cap") === 0 ? SF.rib(source, spine, second)
                                                  : HSF.sweep1(source, spine, second);
      return second ? { shape: made, note: "the section becomes " + F.name(into) }
                    : made;
    },
  };

  //! WHICH WAY A FACE LOOKS, at the middle of its parameter range. Enough for
  //! "which side is sideways" on a planar support, and a reasonable answer on
  //! a gently curved one - the offset itself stays on the surface either way,
  //! because that is MakeOffset's job; this only decides the sign.
  function normalOfFace(face) {
    if (!face) return null;
    //! Three samples and a cross product, and not BRepLProp_SLProps, which
    //! this build does not carry - written against it first and probed second,
    //! which is the wrong way round and is why the check exists at all.
    try {
      const probe = new oc.BRepAdaptor_Surface(face, true);
      const u0 = probe.FirstUParameter(), u1 = probe.LastUParameter();
      const v0 = probe.FirstVParameter(), v1 = probe.LastVParameter();
      const u = (u0 + u1) / 2, v = (v0 + v1) / 2;
      const step = axis => Math.max(1e-6, Math.abs(axis) * 1e-3);
      const du = step(u1 - u0), dv = step(v1 - v0);
      const at = (a, b) => { const p = probe.Value(a, b); return [p.X(), p.Y(), p.Z()]; };
      const here = at(u, v);
      return V.norm(V.cross(V.sub(at(u + du, v), here), V.sub(at(u, v + dv), here)));
    } catch (error) { return null; }
  }

  //! And a datum plane, which is not a face at all - it is an axis system, and
  //! the normal is the third direction of it.
  function planeNormalOf(support) {
    if (!support) return null;
    try {
      const frame = F.frame(support);
      if (frame && frame.normal) return frame.normal;
      const ax = planeAxis(support);
      return ax && ax.z ? V.norm(ax.z) : null;
    } catch (error) { return null; }
  }

  builders.ParallelCurve = {
    precondition: f => {
      const curve = F.reference(f, "curve");
      if (!curve) return "no curve to offset";
      if (!F.shape(curve)) return F.name(curve) + " has not been built";
      const support = F.reference(f, "support");
      if (support && !F.shape(support)) return F.name(support) + " has not been built";
      return null;
    },
    //! The support is asked for only when it is needed, the way CATIA asks: a
    //! curve that is already flat carries its own plane, and one that lies on
    //! a surface has to be told which surface or the offset leaves it.
    build: f => {
      const source = F.reference(f, "curve");
      const support = F.reference(f, "support");
      const face = support ? firstFace(F.shape(support), "support") : null;
      // A sketch writes down the plane it was drawn on, so a spine drawn as one
      // straight segment still knows which way is sideways.
      const frame = F.frame(source);
      //! AND A SUPPORT SAYS IT TOO. A straight Line with a plane wired into it
      //! used to be refused - "no one side to offset it to" - because the only
      //! road to a normal was a sketch's own frame, and a Line has none. Which
      //! made the support argument useless for the one input that most needs
      //! it: wiring the plane changed nothing at all.
      const way = (frame && frame.normal) || normalOfFace(face)
               || planeNormalOf(support);
      const got = HSF.parallelCurve(F.shape(source), F.real(f, "distance", 100), face,
                                    way, Feature_choice(f, "join"));
      return got && got.shape ? got : { shape: got };
    },
  };

  builders.ThickSurface = {
    precondition: f => {
      const source = F.reference(f, "surface");
      if (!source) return "no surface to thicken";
      if (!F.shape(source)) return F.name(source) + " has not been built";
      if (countSubShapes(F.shape(source), FACE) === 0)
        return F.name(source) + " is a curve, not a surface - fill it or extrude it first";
      if (Math.abs(F.real(f, "thickness", 200)) <= CONFUSION) return "thickness must not be zero";
      return null;
    },
    build: f => SF.thickness(F.shape(F.reference(f, "surface")),
                             F.real(f, "thickness", 200),
                             Feature_choice(f, "sides") === 1),
  };

  /* ------------------------------------------------- a section, twice over

     WHY A SECTION HAS TWO ROADS. Intersecting a solid by twenty-three
     extruded offset curves takes four and a half seconds, and it is not the
     WASM: OpenCascade has an analytic intersector for a plane against a
     cylinder and none at all for either of them against a surface of
     extrusion over a B-spline, so all hundred and sixty face pairs go to the
     general numeric intersector at about thirty milliseconds each. Measured,
     not guessed - and unchanged by turning the approximation off, by
     sectioning the parts one at a time, or by a bounding-box prefilter, all
     of which were tried.

     Nothing is going to make that road fast, so while a hand is on a slider
     the section is taken on the triangles instead - the ones the viewer was
     going to be given anyway - and the moment the hand comes off it is taken
     properly. See setDrafting in ocaf.js for how the document guarantees the
     second half of that.                                                    */

  //! Triangles are kept between frames, because in a drag it is usually only
  //! ONE side of the section that is moving. Keyed by revision, so a shape
  //! that was rebuilt is meshed again and one that was not is not.
  const draftMeshes = new Map();
  function draftMesh(source) {
    const id = F.id(source), revision = F.revision(source);
    const had = draftMeshes.get(id);
    if (had && had.revision === revision) return had.mesh;
    const shape = F.shape(source);
    const deflection = deflectionFor(shape);
    const stream = tessellate(shape, deflection);
    const mesh = { positions: stream.positions || [], index: stream.index || [],
                   deflection: stream.deflection || deflection };
    if (draftMeshes.size > 64) draftMeshes.clear();
    draftMeshes.set(id, { revision, mesh });
    return mesh;
  }

  const axisPoint = ax => { const p = ax.Location(); return [p.X(), p.Y(), p.Z()]; };
  const axisNormal = ax => { const d = ax.Direction(); return [d.X(), d.Y(), d.Z()]; };

  //! The same answer as HSF.intersect, to the accuracy the surfaces are drawn
  //! at. Loose segments off the triangles, threaded into runs, thinned to the
  //! deflection they were sampled at - a circle off a cylinder comes back as
  //! thirty points rather than three hundred - and handed over as polylines.
  function draftSection(datum, other, a, b) {
    let segments = [], tolerance = 0;
    if (datum) {
      const mesh = draftMesh(other);
      const ax = planeAxis(datum);
      segments = meshSlice(mesh, axisPoint(ax), axisNormal(ax));
      tolerance = mesh.deflection;
    } else {
      const ma = draftMesh(a), mb = draftMesh(b);
      segments = meshCross(ma, mb);
      tolerance = Math.max(ma.deflection, mb.deflection);
    }
    const edges = [];
    for (const run of chainSegments(segments)) {
      const thinned = thin(run, tolerance);
      const shut = V.length(V.sub(thinned[0], thinned[thinned.length - 1])) <= tolerance;
      const run_ = shut ? thinned.slice(0, -1) : thinned;
      if (run_.length < 2) continue;
      try { edges.push(HSF.polyline(run_, shut)); }
      catch (err) { /* a run of points all in one place is not a curve */ }
    }
    return edges.length === 1 ? edges[0] : compoundOf(edges);
  }

  builders.Intersect = {
    //! This one is allowed to be approximate mid-drag. See draftSection.
    draft: true,
    precondition: f => {
      for (const key of ["a", "b"]) {
        const source = F.reference(f, key);
        if (!source) return "both are needed - " + key.toUpperCase() + " is empty";
        if (!F.shape(source)) return F.name(source) + " has not been built";
      }
      return null;
    },
    build: f => {
      const a = F.reference(f, "a"), b = F.reference(f, "b");
      //! A PLANE IS INFINITE. Its drawn square is display only, and sectioning
      //! against the square is how a 400 cube failed to cross a plane through
      //! the middle of it - see the factory's intersect. Asked of the feature
      //! rather than of the shape, because only the document knows that this
      //! face stands for a plane and that one is a face somebody made.
      const boundless = side =>
        side && F.spec(side).type === "Plane" && planeAxis(side) ? side : null;
      const datum = boundless(b) || boundless(a);
      const other = datum === b ? a : datum === a ? b : null;
      const plane = datum ? { ax: planeAxis(datum), on: F.shape(other) } : null;
      const shape = drafting()
        ? draftSection(datum, other, a, b)
        : HSF.intersect(F.shape(a), F.shape(b), plane);
      const marks = verticesOf(shape);
      // A section that came out as points is a point: say so in the data as
      // well as in the shape, so it can drive anything that wants one.
      return marks.length && countSubShapes(shape, EDGE) === 0
        ? { shape, data: points(marks) } : shape;
    },
  };

  /* ------------------------------------------------ one face, and a face from
     a boundary

     TAKING A SKIN APART. Everything that samples a surface, panels it or
     thickens it is about ONE face of it; until there was a node that could say
     which, every one of them meant "whichever the explorer reached first",
     which is an accident of how the loft was wound and not a thing anybody
     chose. Face is that node. It hands the picked faces back as a shape of
     their own, so the node downstream is about that face because there is
     nothing else in front of it.

     AND PUTTING ONE BACK TOGETHER. Four corners sampled off a curved skin are
     never coplanar, so the flat face-maker refuses them and a panel on a warped
     surface cannot be built at all. Fill asks for the flat one first, because a
     planar face carries its plane and everything downstream would rather have
     it, and falls to a patch through the boundary when there is no plane to
     have.                                                                  */

  builders.Face = {
    precondition: f => {
      const source = F.reference(f, "of");
      if (!source) return "nothing wired in to take a face from";
      const shape = F.shape(source);
      if (!shape) return F.name(source) + " has not been built";
      if (countSubShapes(shape, FACE) === 0)
        return F.name(source) + " has no faces - it is " + describeShape(shape);
      return null;
    },
    build: f => {
      const source = F.reference(f, "of");
      const shape = F.shape(source);
      const picked = pickedSubs(f, "faces", shape, "face");
      if (!picked.chosen.length)
        throw new Error(picked.whole ? "that shape has no faces"
          : "none of the picked faces is in " + F.name(source) + " any more");
      const many = eachFace(shape).length;
      const took = picked.chosen.length;
      return { shape: took === 1 ? picked.chosen[0] : compoundOf(picked.chosen),
               note: picked.whole
                 ? (many > 1 ? "every face \u00b7 " + many + " of them" : undefined)
                 : took + (took === 1 ? " face" : " faces") + " of " + many
                   + (picked.lost ? " \u00b7 " + picked.lost + " picked "
                       + (picked.lost === 1 ? "face is" : "faces are")
                       + " no longer in that shape" : "") };
    },
  };

  builders.Fill = {
    precondition: f => {
      const source = F.reference(f, "boundary");
      if (!source) return "no boundary to fill";
      const shape = F.shape(source);
      if (!shape) return F.name(source) + " has not been built";
      if (countSubShapes(shape, EDGE) === 0)
        return F.name(source) + " has no edges to bound a face";
      return null;
    },
    build: f => {
      const source = F.reference(f, "boundary");
      const wire = wireOf(source, "boundary");
      const want = Feature_choice(f, "surface");
      if (want === 1) return { shape: HSF.flatFill(wire), note: "planar" };
      if (want === 2) return { shape: HSF.patch(wire), note: "patched" };
      // Whichever fits, and it says which it got: "planar" and "patched" are
      // different answers and the difference is worth seeing in the tree.
      try {
        const flat = new oc.BRepBuilderAPI_MakeFace(wire, true);
        if (flat.IsDone()) return { shape: flat.Face(), note: "planar" };
      } catch (error) { /* out of plane; patch it */ }
      return { shape: HSF.patch(wire), note: "patched \u00b7 the boundary is not flat" };
    },
  };

  builders.Draft = {
    precondition: f => {
      const body = F.reference(f, "body");
      if (!body) return "no body to draft";
      if (!F.shape(body)) return F.name(body) + " has not been built";
      if (countSubShapes(F.shape(body), FACE) === 0) return F.name(body) + " has no faces";
      const neutral = F.reference(f, "neutral");
      const hinge = readPicks(F.picks(f, "hinge"));
      if (!neutral && !hinge.length)
        return "a neutral plane is needed - it is the height the draft turns about. "
             + "Wire a plane in, or pick a face of the body to hinge on";
      if (neutral && !hinge.length) {
        const trouble = planeTrouble(neutral);
        if (trouble) return trouble;
      }
      if (Math.abs(F.real(f, "angle", 5)) <= CONFUSION) return "an angle of zero drafts nothing";
      return null;
    },
    //! Which faces to lean over is the driver's question, not the factory's:
    //! it is read off the document, the way every other argument is. "Sides"
    //! means the faces that run along the pull rather than across it - the
    //! walls of a pad, not its top and bottom.
    build: f => {
      const body = F.shape(F.reference(f, "body"));
      // THE HINGE. A plane wired in, or a face of the body picked off it -
      // which is what a person means nine times in ten, because the height the
      // draft turns about is usually the bottom of the thing being drafted and
      // there is no reason to build a datum for it.
      const picked = pickedSubs(f, "hinge", body, "face");
      let neutral = null;
      if (!picked.whole && picked.chosen.length) {
        const surface = new oc.BRepAdaptor_Surface(picked.chosen[0]);
        if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane)
          throw new Error("the picked face is not flat, so it cannot be a neutral plane");
        // A plane's own frame is a gp_Ax3 - it carries a handedness nobody here
        // asked for - and the draft wants the gp_Ax2 a datum plane gives it.
        const frame = surface.Plane().Position();
        neutral = new oc.gp_Ax2(frame.Location(), frame.Direction());
      } else neutral = planeAxis(F.reference(f, "neutral"));
      if (!neutral) throw new Error("no neutral plane and no face picked to hinge on");

      const pull = readVector(F.reference(f, "direction"))
        || [neutral.Direction().X(), neutral.Direction().Y(), neutral.Direction().Z()];
      const along = V.norm(pull);

      // AND WHAT LEANS. The faces picked, if any were; otherwise the choice -
      // the sides, or all of them.
      const wanted = pickedSubs(f, "drafted", body, "face");
      const sidesOnly = Feature_choice(f, "faces") === 0;
      const chosen = [];
      for (const face of wanted.chosen) {
        if (!wanted.whole) { chosen.push(face); continue; }
        if (!sidesOnly) { chosen.push(face); continue; }
        const surface = new oc.BRepAdaptor_Surface(face);
        if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) continue;
        const n = surface.Plane().Axis().Direction();
        if (Math.abs(V.dot([n.X(), n.Y(), n.Z()], along)) < 0.5) chosen.push(face);
      }
      if (!chosen.length)
        throw new Error(wanted.whole
          ? "no face of that body runs along the pull direction - "
            + "check the direction, or draft all faces"
          : "none of the picked faces is in this body any more");
      const shape = SF.draft(body, chosen, neutral, along, F.real(f, "angle", 5));
      return { shape, note: wanted.whole && picked.whole ? undefined
        : chosen.length + (chosen.length === 1 ? " face" : " faces") + " drafted"
          + (picked.whole ? "" : " about a picked face") };
    },
  };

  //! A container builds nothing, and that is the point of it. It holds no
  //! geometry, consumes nothing and hides nothing: what is filed in a set stays
  //! exactly as visible and as wired as it was, so putting a node away can
  //! never change the part. What it computes is a sentence about itself - what
  //! it holds and what crosses its boundary - which is what the tree and the
  //! panel show when you ask.
  builders.GeometricalSet = {
    build: f => {
      const inside = doc.within(f), feeds = doc.inputsOf(f), out = doc.outputsOf(f);
      const count = (n, one, many) => n + " " + (n === 1 ? one : many);
      return { data: text([
        count(inside.length, "item", "items"),
        feeds.length ? "in: " + feeds.map(F.name).join(", ") : "nothing comes in",
        out.length ? "out: " + out.map(F.name).join(", ") : "nothing reads out of it",
      ]) };
    },
  };
  builders.Body = builders.GeometricalSet;

  /* --------------------------------------------------------- generators

     A feature whose output is other features.

     The driver itself builds nothing: it compiles the plan, reconciles its own
     parameters, and says what it made last time. The making happens in
     settle() below, AFTER the whole tree has computed - because a plan reads
     what its inputs COMPUTED, and until the solver has run there is nothing to
     read. Running it as part of the solve would mean a plan that reads a point
     list drawn by a curve it also made, which is the kind of loop that only
     ever ends one way.                                                       */

  builders.Generator = {
    precondition: f => {
      const source = F.code(f, "plan", "");
      if (!source.trim()) return "there is no plan to run";
      try {
        const { params } = compilePlan(source);
        F.syncParams(f, params);
      } catch (err) { return err.message; }
      return null;
    },
    build: f => {
      const inside = doc.within(f);
      const made = readMade(F.text(f, "made", ""));
      const keys = Object.keys(made).length;
      const paused = Feature_choice(f, "live") === 1;
      return { data: text([
        saysPlan({ added: 0, removed: 0, kept: keys, total: inside.length }),
        keys && keys !== inside.length
          ? keys + " keyed, " + inside.length + " in the tree" : "",
        paused ? "paused - it will not rebuild until this is set back" : "",
      ].filter(Boolean)) };
    },
  };

  //! ONE PLAN, RUN. Everything a plan needs to read is read off the document
  //! that has just finished computing, so the numbers it sees are the numbers
  //! on screen.
  function runPlan(f) {
    const { module, params } = compilePlan(F.code(f, "plan", ""));
    const stored = F.paramValues(f);
    const values = {};
    for (const spec of params) values[spec.key] = clampTo(spec, stored[spec.key] ?? spec.def);

    const model = doc.modelJson();
    const api = planDoc(model, {
      here: F.id(f),
      catalogue: registeredTypes(),
      //! What a feature COMPUTED, by id - which is what a generator is driven
      //! by and is not in the model file, because the model file is the
      //! question and this is the answer.
      data: id => { const other = doc.find(id); return other ? F.data(other) : null; },
    });
    const plan = readPlan(module.plan(values, api),
                          (want, forced) => api.resolve(want, forced));

    const taken = new Set(doc.features().map(F.id));
    const takenNames = new Set(doc.features().map(F.name));
    const mint = () => {
      const id = freshId("GN", taken);
      taken.add(id);
      return id;
    };
    return reconcile({
      plan,
      made: readMade(F.text(f, "made", "")),
      owner: F.id(f),
      mint,
      rename: key => freshName(F.name(f) + "." + key, takenNames),
      instantiate: (setId, name) => {
        const got = instantiateEdits(model, setId, { taken, takenNames,
                                                     spec: typeSpec, name });
        //! EVERY ID IT MINTED, RESERVED. instantiateEdits works on a COPY of
        //! the taken set, so it cannot know about a second call - and a plan
        //! that copies one set three times calls it three times. Without this
        //! the second copy mints the same ids as the first and the apply stops
        //! on "duplicate feature id", halfway through.
        taken.add(got.id);
        for (const now of Object.values(got.renamed)) taken.add(now);
        //! And every NAME, for the same reason. instantiateEdits picks fresh
        //! names out of a copy of the set it was handed, so three copies in one
        //! plan each name their members ".2" and the tree fills with features
        //! that cannot be told apart by reading it.
        takenNames.add(got.name);
        for (const edit of got.edits) if (edit.op === "add" && edit.name) takenNames.add(edit.name);
        return got;
      },
    });
  }

  //! A GENERATED NODE AND EVERYTHING UNDER IT.
  //!
  //! doc.deleteFeature DISSOLVES a container that has contents - it keeps what
  //! is in it and hands it up to whatever the set was in, which is what you
  //! want when a person deletes a folder they made and emphatically not what
  //! you want when a list shrinks by one. Dissolving a copy tipped fourteen
  //! members out into the generator, where nothing knew about them and nothing
  //! ever collected them, so a list going five to one left the tree bigger
  //! than it started.
  //!
  //! Leaves first, and then whatever is left with nothing reading it - because
  //! members of a copy read each other, and deleteFeature refuses while
  //! anything still does.
  //! ALL OF THEM AT ONCE, and that is not an optimisation.
  //!
  //! A plan that shrinks from five copies to one deletes four points and four
  //! sets, and each point is read by the set beside it. Deleted one at a time
  //! in the order the plan happens to list them, the first delete fails -
  //! something still reads it - and the whole batch is refused, so the list
  //! shrinks on screen and the model does not. Taken together they peel: at
  //! every round, whatever nothing OUTSIDE the doomed set still reads comes
  //! out, until none is left.
  function deleteMany(features) {
    const doomed = [];
    const walk = one => {
      if (doomed.includes(one)) return;
      doomed.push(one);
      for (const child of doc.contents(one)) walk(child);
    };
    for (const f of features) walk(f);
    const left = new Set(doomed);
    for (let guard = doomed.length + 1; guard > 0 && left.size; guard--) {
      let went = false;
      for (const one of [...left]) {
        if (doc.dependents(one).some(other => !left.has(other))) continue;
        if (doc.contents(one).some(child => left.has(child))) continue;
        try { doc.deleteFeature(one); left.delete(one); went = true; }
        catch (err) { /* something still reads it; try again next round */ }
      }
      if (!went) break;
    }
    if (left.size)
      throw new Error([...left].map(F.name).slice(0, 3).join(", ")
        + (left.size > 3 ? " and " + (left.size - 3) + " more" : "")
        + " could not be removed - something outside still reads from them");
  }

  //! THE EDIT VOCABULARY, APPLIED TO THE DOCUMENT DIRECTLY. The same ops the
  //! interface sends, because a generator is not a second way of changing a
  //! model - it is the same way, written by a script instead of by a hand.
  function applyEdits(edits) {
    // Deletes first and together: see deleteMany. Then everything else, in the
    // order the plan wrote it, because an add has to precede the wire onto it.
    const doomed = edits.filter(one => one.op === "delete")
                        .map(one => doc.find(one.id)).filter(Boolean);
    if (doomed.length) deleteMany(doomed);

    for (const edit of edits) {
      if (edit.op === "delete") continue;
      const f = edit.id ? doc.find(edit.id) : null;
      switch (edit.op) {
        case "add": doc.addFeature(edit.type, edit.id, edit.name); break;
        case "rename": if (f) f.attr.TDataStd_Name = edit.name; break;
        case "group": if (f) doc.setParent(f, edit.into ? doc.find(edit.into) : null); break;
        case "set": if (f) doc.setParameter(f, edit.key, edit.value); break;
        case "code": if (f) doc.setCode(f, edit.key, edit.text); break;
        case "sketch": if (f) doc.setSketch(f, "drawing", edit.drawing); break;
        case "pick": if (f) F.setPicks(f, edit.key, edit.picks); break;
        case "appearance": if (f) doc.setAppearance(f, edit.appearance); break;
        case "vertex": if (f) F.moveVertex(f, "edits", edit.index,
                                           [edit.x, edit.y, edit.z]); break;
        case "connect": {
          const to = doc.find(edit.from);
          if (f && to) doc.setReference(f, edit.key, to);
          break;
        }
        default: break;
      }
    }
  }

  //! REGENERATE, THEN LET THE GENERATORS CATCH UP, THEN REGENERATE AGAIN.
  //!
  //! A plan that has not changed emits no edits, so the usual case is one
  //! extra pass that does nothing and costs a JSON walk. A plan whose input
  //! list grew emits one add and the second pass builds it. A chain of
  //! generators takes one pass per link, which is what the ceiling counts.
  //!
  //! The ceiling is not a performance guard, it is a loop guard: a plan that
  //! reads something downstream of itself never settles, and the difference
  //! between saying so and hanging the page is this loop.
/* ================================================ never hold the page

   THE KERNEL RUNS IN THE PAGE. A regeneration of six thousand features is
   fifteen seconds of a synchronous loop, and fifteen seconds of a synchronous
   loop is a tab that does not scroll, does not repaint and does not say why.

   So a long regeneration is driven a SLICE at a time. Between slices the loop
   hands the thread back - long enough for the page to repaint, to run the
   animation that says it is working, and to say how far along it is - and
   picks up exactly where it left off, because the walk is a generator and
   nothing about its order or its result changed.

   The slice is measured in MILLISECONDS rather than in features: a boolean is
   seventeen milliseconds and a point is four microseconds, and a slice
   counted in features would be either a stutter or a freeze depending on
   which it got.                                                            */

  const SLICE_MS = 24;

  //! A slice at a time, with the thread handed back in between. \p tell is
  //! called with how far along it is, so whatever is watching can say so.
  async function settleSlowly(all, tell) {
    const run = doc.regenerate(all);
    let step, mark = Date.now();
    for (;;) {
      step = run.next();
      if (step.done) break;
      if (Date.now() - mark < SLICE_MS) continue;
      mark = Date.now();
      if (tell) tell({ done: step.value.done, total: step.value.total,
                       failed: step.value.failed.length });
      await breathe();
    }
    return step.value;
  }

/* --------------------------------------------- settling, without the freeze

   Every edit in the kernel ends in settle(), and settle() ends in a
   regeneration. On a part that is milliseconds. On a building it is seconds,
   and seconds of a synchronous loop in the page is a tab that has stopped.

   So there are two: the straight one, which is what a small model wants and
   what everything that is not an edit still uses, and the sliced one, which
   hands the thread back every twenty-four milliseconds and says how far along
   it is. They walk the same generator and produce the same report.        */

  //! Above this many features, an edit settles in slices. Below it the
  //! slicing is pure overhead - a promise per twenty-four milliseconds of
  //! work that finishes in four.
  const BIG_ENOUGH_TO_SLICE = 250;

  async function settleAsync(all, tell) {
    if (doc.features().length < BIG_ENOUGH_TO_SLICE) return settle(all);
    let report = await settleSlowly(all, tell);
    //! The generators, exactly as the straight one runs them - and then one
    //! more sliced pass if any of them made anything.
    for (let pass = 0; pass < RECONCILE_PASSES; pass++) {
      if (!runGenerators()) return report;
      report = await settleSlowly(false, tell);
    }
    sayUnsettled();
    return report;
  }

  //! ONE PASS OF THE GENERATORS: every plan run, its edits applied, and
  //! whether any of them made anything. Lifted out of settle so the sliced
  //! settle can run exactly the same pass rather than a second copy of it.
  function runGenerators() {
    let worked = false;
    for (const f of doc.features()) {
      if (!F.spec(f) || F.spec(f).type !== "Generator") continue;
      if (F.error(f) || Feature_choice(f, "live") === 1) continue;
      let got;
      try { got = runPlan(f); }
      catch (err) { F.setError(f, kernelMessage(err)); continue; }
      if (!got.edits.length) continue;
      //! A HALF-APPLIED PLAN IS WORSE THAN A REFUSED ONE. The edits are
      //! applied in order and one of them can still fail - a wire to
      //! something that turned out not to be there, an id that collided -
      //! and what is left then is a partial copy that the NEXT pass does not
      //! know about, so it makes another. Three passes of that and the tree
      //! has three half-columns in it, which is what this loop did before the
      //! rollback existed. So what this batch created is taken back out.
      try { applyEdits(got.edits); }
      catch (err) {
        for (const edit of got.edits)
          if (edit.op === "add") {
            const stray = doc.find(edit.id);
            if (stray) { try { doc.deleteFeature(stray); } catch (e) { /* gone already */ } }
          }
        F.setError(f, "the plan could not be applied: " + kernelMessage(err));
        continue;
      }
      doc.setCode(f, "made", writeMade(got.made));
      worked = true;
    }
    return worked;
  }

  //! Said on the generators rather than thrown, because the model is still
  //! there and still drawable - it is just one pass behind whatever it is
  //! chasing.
  function sayUnsettled() {
    for (const f of doc.features())
      if (F.spec(f) && F.spec(f).type === "Generator" && !F.error(f))
        F.setNote(f, "it did not settle in " + RECONCILE_PASSES
          + " passes - something it makes is feeding something it reads");
  }

  function settle(all = false) {
    let report = doc.recompute(all);
    for (let pass = 0; pass < RECONCILE_PASSES; pass++) {
      if (!runGenerators()) return report;
      report = doc.recompute(false);
    }
    sayUnsettled();
    return report;
  }


  /* ---------------------------------------------------------- imported

     Two drivers, and neither builds anything. What they hold IS the geometry -
     a B-Rep string, or OBJ text - so rebuilding is reading it back. Held that
     way rather than as the file it arrived in so that one reader rebuilds
     every import, whichever reader first read it. */

  /* ------------------------------------------- packed geometry, unpacked

     A DRIVER CANNOT WAIT. Every builder here is synchronous, and unpacking is
     a DecompressionStream, which is not - so a packed blob is opened on the
     way IN, before anything is built, and the plain text waits here for the
     driver that needs it.

     It waits only that long. The moment the settle is over the shape is built
     and OCAF is holding it, and keeping a hundred and eighty megabytes of text
     beside a shape that no longer needs it would be paying the price this
     whole change exists to avoid. See openPacked, which fills this, and
     loadModel, which empties it again.                                     */

  const unpacked = new Map();

  //! Every packed import in the document, opened. Awaited by the callers that
  //! are allowed to await - loading a model, and importing a file - which are
  //! the only two ways a packed blob ever arrives.
  //! Which node keeps its geometry where. One table, so a node added later
  //! that holds a file is packed and opened by saying so here and nowhere
  //! else.
  const PACKED_ARGS = { Imported: "brep", MeshImported: "obj" };

  const openPacked = async () => {
    for (const f of doc.features()) {
      const spec = F.spec(f);
      const key = spec && PACKED_ARGS[spec.type];
      if (!key) continue;
      const id = F.id(f);
      if (unpacked.has(id)) continue;
      const held = F.code(f, key, "");
      if (!isPacked(held)) continue;
      try { unpacked.set(id, await unpackGeometry(held)); }
      catch (err) { /* left packed: the driver says so by name */ }
    }
  };

  builders.Imported = {
    precondition: f => F.code(f, "brep", "") ? null
      : "this import holds no geometry - it was read from a file that had none",
    //! A shape and a readout of what it is, which is what every other node
    //! hands back. The readout matters more here than anywhere else: an import
    //! is the one node whose contents nobody chose, so "3 solids, 18 faces" is
    //! the difference between a body you can fillet and a pile of surfaces that
    //! will refuse - and it says which before you wire anything to it.
    build: f => {
      const held = F.code(f, "brep", "");
      const plain = unpacked.get(F.id(f));
      //! AN IMPORT CANNOT CHANGE. Nothing feeds it and none of its arguments
      //! move, so a rebuild that arrives with the text already put away can
      //! answer with the shape it built before - which is the same shape, by
      //! construction. Only an import that has never been built needs the
      //! text, and that only happens where something could await it.
      if (!plain && isPacked(held)) {
        const already = F.shape(f);
        if (already && !already.IsNull()) return { shape: already };
        throw new Error("this import is stored packed and has not been opened yet - "
          + "reopen the model file and it will come back");
      }
      const shape = oc.BRepToolsWrapper.Read(plain || held);
      if (!shape || shape.IsNull())
        throw new Error("the stored geometry will not read back - the model file may be truncated");
      const from = F.code(f, "source", "");
      return { shape, data: text([describeShape(shape), from ? "from " + from : "read from a file"]) };
    },
  };

  builders.MeshImported = {
    precondition: f => F.code(f, "obj", "") ? null
      : "this import holds no geometry - it was read from a file that had none",
    build: f => {
      const held = F.code(f, "obj", "");
      const plain = unpacked.get(F.id(f));
      //! The same rule as Imported: a mesh that came from a file cannot
      //! change, so a rebuild that arrives after the text was put away answers
      //! with the cage it built before. See builders.Imported, where the whole
      //! of the reasoning is.
      if (!plain && isPacked(held)) {
        const already = F.data(f);
        if (already && already.kind === "mesh") return { data: already };
        throw new Error("this import is stored packed and has not been opened yet - "
          + "reopen the model file and it will come back");
      }
      const parts = parseObj(plain || held);
      if (!parts.length) throw new Error("the stored geometry has no faces in it");
      // A part is written per feature, so there is normally one. Several are
      // merged rather than refused: an OBJ typed in by hand may have any number.
      const points = [], faces = [];
      for (const part of parts) {
        const base = points.length;
        for (const p of part.points) points.push(p);
        for (const face of part.faces) faces.push(face.map(i => i + base));
      }
      return { data: { ...packMesh(checkMesh({ points, faces }, "imported mesh")),
                       smooth: Feature_choice(f, "smooth") === 1 } };
    },
  };

  const drivers = new Map();
  for (const spec of CATALOGUE) {
    const builder = builders[spec.type];
    if (!builder) continue;
    //! `compound` is how a driver's several rows become one feature's shape;
    //! `ownLists` is declared on the five builders that pair up their own
    //! lists. See Driver.spreadLists.
    drivers.set(spec.guid, new Driver(spec,
      { ...builder, release, describeError, compound: list => HSF.join(list) }));
  }

  /* ---------------------------------------------------------- meshing */

  //! Copies a run of floats out of the WebAssembly heap. The view has to be
  //! made fresh every time: growing the heap detaches any earlier one.
  const readFloats = (ptr, size) =>
    size ? Array.from(new Float32Array(oc.wasmMemory.buffer, ptr, size)) : [];
  const readInts = (ptr, size) =>
    size ? Array.from(new Uint32Array(oc.wasmMemory.buffer, ptr, size)) : [];

  //! Polymesh in, the same vertex stream out. Faces of any number of sides are
  //! fanned into triangles for drawing only - the mesh itself keeps its n-gons,
  //! and every edge of every polygon is sent as a line so the cage reads as the
  //! cage rather than as the triangles it was drawn with.
  //!
  //! The unsplit vertices go too, under `vertices`: those are the ones a handle
  //! can be put on, and their positions in that list are the indices a hand edit
  //! is written against.
  function streamMesh(data) {
    const points = F.triples(data);
    const faces = meshFaces(data);
    const out = { shape: "mesh", vertices: points.flat(), faceCount: faces.length };

    const smooth = data.smooth === true;
    const normals = smooth ? vertexNormals({ points, faces }) : null;
    const positions = [], normalOut = [], index = [];
    for (const face of faces) {
      const n = smooth ? null : faceNormal(points, face);
      // Flat shading needs its own copy of each corner; smooth shading could
      // share them, but a fan is written the same way either way.
      const base = positions.length / 3;
      for (const at of face) {
        positions.push(points[at][0], points[at][1], points[at][2]);
        const vn = smooth ? normals[at] : n;
        normalOut.push(vn[0], vn[1], vn[2]);
      }
      for (let i = 1; i + 1 < face.length; i++) index.push(base, base + i, base + i + 1);
    }
    out.positions = positions;
    out.normals = normalOut;
    out.index = index;
    out.triangles = index.length / 3;

    const seen = new Set();
    const edges = [];
    for (const face of faces)
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i + 1) % face.length];
        const key = a < b ? a + "," + b : b + "," + a;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push(points[a][0], points[a][1], points[a][2],
                   points[b][0], points[b][1], points[b][2]);
      }
    out.edges = edges;
    return out;
  }

  //! A TRUE MACROTASK, with no clamping. setTimeout(0) is held to four
  //! milliseconds after a handful of nested calls, which on a walk of six
  //! thousand features would be a minute of waiting for the clock rather than
  //! for the geometry. A MessageChannel has no such rule, and node has one
  //! too, so the tests take the same road the page does.
  const breathe = () => new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(0);
  });

  //! B-Rep in, vertex stream out - the whole contract with the viewer.
  //! The enum arrives as "TopAbs_SOLID" and the native kernel reports "solid",
  //! so a client reads one vocabulary whichever kernel answered.
  const shapeKind = shape => String(shape.ShapeType()).replace(/^TopAbs_/, "").toLowerCase();

  function tessellate(shape, deflection) {
    const out = {};
    if (!shape || shape.IsNull()) return out;

    out.shape = shapeKind(shape);
    const tolerance = deflection > 0 ? deflection : deflectionFor(shape);
    out.deflection = tolerance;

    if (countSubShapes(shape, FACE) > 0) {
      const faces = oc.ReplicadMeshExtractor.extract(shape, tolerance, 0.3, false);
      out.positions = readFloats(faces.getVerticesPtr(), faces.getVerticesSize());
      out.normals = readFloats(faces.getNormalsPtr(), faces.getNormalsSize());
      out.index = readInts(faces.getTrianglesPtr(), faces.getTrianglesSize());
      out.triangles = out.index.length / 3;
      // which B-Rep face each run of triangles came from: [start, count, faceId] in index units
      out.faceGroups = readInts(faces.getFaceGroupsPtr(), faces.getFaceGroupsSize());
      faces.delete();
    }

    if (countSubShapes(shape, EDGE) > 0) {
      const edges = oc.ReplicadEdgeMeshExtractor.extract(shape, tolerance, 0.3);
      out.edges = readFloats(edges.getLinesPtr(), edges.getLinesSize());
      edges.delete();
    }

    // A point feature may hold one vertex or two hundred; a vertex carries no
    // triangles, so each one is sent as a location for the viewer to mark.
    const marks = verticesOf(shape);
    if (marks.length) {
      out.points = marks.flat();
      out.point = marks[0];
    }
    return out;
  }

  /* ----------------------------------------------------------- kernel */

  let doc = new Doc(drivers);

  //! A CAGE, SEWN INTO A B-REP. One quad per face where the quad is flat and a
  //! fan of triangles where it is not, sewn, and closed into a solid if the
  //! cage had no rim.
  //!
  //! Lifted out of MeshToShape's driver because a DRAWING needs it too, and
  //! for the same reason the node exists: hidden-line removal is a B-Rep
  //! operation and half the world's IFC arrives tessellated. Two copies of
  //! this would be two answers to "is that quad flat enough", and the one that
  //! disagreed would be the one that made a drawing with holes in it.
  const sewMesh = (mesh, tolerance = 0.01, wantSolid = true) => {
    const faceOfRing = ring => {
      const points = ring.map(i => mesh.points[i]);
      const maker = new oc.BRepBuilderAPI_MakeWire();
      let edges = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if (V.length(V.sub(b, a)) < tolerance) continue;
        maker.Add(new oc.BRepBuilderAPI_MakeEdge(pnt(a), pnt(b)).Edge());
        edges++;
      }
      if (edges < 3) return null;
      const face = new oc.BRepBuilderAPI_MakeFace(maker.Wire(), true);
      return face.IsDone() ? face.Face() : null;
    };

    //! How far from flat a face is, as a fraction of its own size. A quad off
    //! by a thousandth of its diagonal is flat as far as a B-Rep is concerned;
    //! one off by a tenth is a saddle and has to be split.
    const flatEnough = ring => {
      if (ring.length <= 3) return true;
      const points = ring.map(i => mesh.points[i]);
      const normal = faceNormal(mesh.points, ring);
      const at = centroid(points);
      let far = 0, size = 0;
      for (const p of points) {
        far = Math.max(far, Math.abs(V.dot(V.sub(p, at), normal)));
        size = Math.max(size, V.length(V.sub(p, at)));
      }
      return far <= Math.max(tolerance, size * 1e-3);
    };

    const sewing = new oc.BRepBuilderAPI_Sewing(tolerance, true, true, true, false);
    let made = 0, split = 0;
    for (const ring of mesh.faces) {
      const whole = flatEnough(ring) ? faceOfRing(ring) : null;
      if (whole) { sewing.Add(whole); made++; continue; }
      // Not flat: fanned into triangles, which cannot help being flat.
      for (let i = 1; i + 1 < ring.length; i++) {
        const piece = faceOfRing([ring[0], ring[i], ring[i + 1]]);
        if (piece) { sewing.Add(piece); made++; }
      }
      split++;
    }
    if (!made) throw new Error("none of the faces of that mesh could be built");
    sewing.Perform(new oc.Message_ProgressRange());
    let shape = sewing.SewedShape();
    if (!shape || shape.IsNull()) throw new Error("those faces would not sew together");

    // A SOLID ONLY IF THE CAGE CLOSED. OpenCascade will happily make a solid
    // out of an open shell and report success - it has no opinion about
    // whether the shell bounds anything - so the question is asked of the
    // mesh, where it has an exact answer: an edge with one face on it is a
    // hole, and a mesh with a hole in it is a shell.
    const rim = [...topologyOf(mesh).edges.values()].filter(e => e.faces.length === 1);
    let closed = false;
    if (!rim.length && wantSolid && shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_SHELL) {
      try {
        const solid = new oc.BRepBuilderAPI_MakeSolid(oc.TopoDS.Shell(shape));
        if (solid.IsDone()) { shape = solid.Solid(); closed = true; }
      } catch (error) { closed = false; }
    }
    return { shape, closed, split, rim };
  };

  //! EVERY BODY IN THE DOCUMENT, with what it is called and what it sits
  //! inside. A drawing view is the one thing here that is about the model as a
  //! whole rather than about the shapes wired into it: "draw this building"
  //! means all of it, and a view that had to be wired to six hundred walls
  //! would be a view nobody makes.
  //!
  //! IT IS READ AT BUILD TIME, so it sees whatever has been built by then.
  //! Document order is build order, so a view made after the model sees the
  //! finished model - which is the order anybody works in. Wire the bodies in
  //! explicitly and the dependency is recorded and the order is guaranteed;
  //! leave it empty and it is the natural order rather than a promised one,
  //! and that is worth knowing rather than hiding.
  const bodies = (options = {}) => {
    const skip = new Set(options.except || []);
    const out = [];
    //! Counted rather than swallowed: a drawing that quietly left three
    //! buildings out is a drawing nobody can trust, and the count is what the
    //! panel says out loud.
    let sewn = 0, over = 0, failed = 0;
    for (const f of doc.features()) {
      const id = F.id(f);
      if (skip.has(id)) continue;
      const spec = F.spec(f);
      if (options.notTypes && options.notTypes.includes(spec.type)) continue;
      if (options.notCategories && options.notCategories.includes(spec.category)) continue;
      if (options.visible !== false && !F.visible(f)) continue;
      let shape = F.shape(f);
      //! A POLYMESH HAS NO B-REP, and half the IFC in the world arrives as
      //! one: tessellated in the file, so what came in is triangles and
      //! nothing else. Hidden-line removal is a B-Rep operation, so a drawing
      //! of a tessellated import would be an empty sheet - which is the
      //! failure that looks most like success there is, because a blank
      //! drawing of a building looks like a drawing that has not built yet.
      //!
      //! So they are sewn, here, on the way past. It costs a face per triangle
      //! and it is the honest cost of drawing something that arrived as a
      //! picture of itself - and there is a budget, because a 200,000-triangle
      //! site model would sew for minutes. What is over the budget is counted
      //! and reported rather than dropped in silence.
      if ((!shape || shape.IsNull()) && options.sewMeshes) {
        const data = F.data(f);
        if (data && data.kind === "mesh") {
          const cage = { points: F.triples(data), faces: meshFaces(data) };
          if (cage.faces.length > (options.faceBudget || 20000)) { over++; continue; }
          try { shape = sewMesh(cage, options.tolerance || 0.01, true).shape; sewn++; }
          catch (err) { failed++; continue; }
        }
      }
      if (!shape || shape.IsNull()) continue;
      if (options.solidsOnly && countSubShapes(shape, SOLID) === 0) continue;
      //! THE APPEARANCE TRAVELS WITH THE BODY, and the sets it sits in with
      //! it. A drawing hatches concrete one way and blockwork another, and the
      //! answer to "which" is the same three-level cascade the section cutter
      //! resolves - so the driver needs the same three levels, and this is
      //! where the tree that holds them is.
      const above = [];
      for (let up = doc.find(F.parent(f)), guard = 0; up && guard < 200;
           up = doc.find(F.parent(up)), guard++) {
        const worn = F.appearance(up);
        if (worn) above.push(worn);
      }
      out.push({ id, name: F.name(f), type: spec.type, category: spec.category,
                 parent: F.parent(f), appearance: F.appearance(f), above, shape });
    }
    //! The tally rides on the list rather than beside it, so a caller that
    //! only wants the bodies can ignore it and one that has to be honest
    //! about what it left out cannot lose it.
    out.sewn = sewn; out.overBudget = over; out.unsewable = failed;
    return out;
  };

  const state = report => ({ ok: true, tree: doc.treeJson(), report });

  /* ------------------------------------------------------------ exchange

     Everything the readers and writers need that is not arithmetic. The
     arithmetic - OBJ and STL, both ways - is in exchange.js and knows nothing
     about OpenCascade; what is here is the part that does.                  */

  /* ---------------------------------------- a file, arriving in pieces

     THE KERNEL'S OWN FILESYSTEM IS NOT THE LIMIT. Measured on this build:
     320 MB written into it while the heap was 100 MB. What could not take a
     large file was the page - the whole thing in one JavaScript string,
     handed across the port, base64'd, and kept in the document.

     So a file arrives in slices and is written straight to a path the readers
     already use. Nothing above this ever holds more than one slice, and the
     readers do not change: STEP was always read from a path, and BREP is read
     from one now.                                                          */

  const uploads = new Map();

  //! One slice. \p at says where it goes, so a slice that arrives out of order
  //! is written where it belongs rather than appended in the wrong place -
  //! which on a file read through a port is the difference between a model and
  //! a reader error nobody can explain.
  const takeChunk = (path, bytes, at) => {
    let held = uploads.get(path);
    if (!held || at === 0) {
      try { oc.FS.unlink(path); } catch (err) { /* nothing there yet */ }
      held = { stream: oc.FS.open(path, "w"), wrote: 0 };
      uploads.set(path, held);
    }
    const slice = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    oc.FS.write(held.stream, slice, 0, slice.length, at);
    held.wrote = Math.max(held.wrote, at + slice.length);
    return held.wrote;
  };

  const closeUpload = path => {
    const held = uploads.get(path);
    if (!held) return 0;
    try { oc.FS.close(held.stream); } catch (err) { /* already closed */ }
    uploads.delete(path);
    return held.wrote;
  };

  const dropUpload = path => {
    closeUpload(path);
    try { oc.FS.unlink(path); } catch (err) { /* it may never have landed */ }
  };

  const uploadSize = path => {
    try { return oc.FS.stat(path).size; } catch (err) { return 0; }
  };

  //! A window onto a file that is far too big to hold: `length` characters
  //! from `at`, one character per byte, read straight off the filesystem. The
  //! stream is opened and closed per window on purpose - a survey is a few
  //! dozen of these, and a handle left open across a read that throws is a
  //! file that cannot be unlinked afterwards.
  const windowOf = (path, at, length) => {
    if (length <= 0) return "";
    const stream = oc.FS.open(path, "r");
    try {
      const buffer = new Uint8Array(length);
      const got = oc.FS.read(stream, buffer, 0, length, at);
      return latin1(got < length ? buffer.subarray(0, got) : buffer);
    } finally {
      try { oc.FS.close(stream); } catch (err) { /* already gone */ }
    }
  };

  //! OpenCascade's own shape format, read back. It is what every import is
  //! stored as, so this is the road every rebuild of an import takes.
  const readBrep = text => {
    const shape = oc.BRepToolsWrapper.Read(text);
    if (!shape || shape.IsNull())
      throw new Error("that BREP file will not read - it may not be a BREP file");
    return { shape };
  };

  //! A STEP file, transferred. Every root separately: an assembly written as
  //! several products comes back as several shapes, and that is the structure
  //! the file itself carries. What it does NOT carry through these bindings is
  //! the nesting below that - the compound of a sub-assembly arrives whole -
  //! so a part is a solid, and the import says so rather than implying a tree
  //! it cannot see.
  //! THE SAME READER, HANDED A PATH INSTEAD OF A STRING. The file is already
  //! in the kernel's filesystem - it was streamed there - so nothing needs to
  //! hold it as text on the way past. This is the whole of what removes the
  //! size ceiling for BREP: BRepToolsWrapper.Read takes a string in these
  //! bindings, so the text exists for as long as the read takes and no longer,
  //! and it never exists in the page at all.
  const readBrepFrom = path => {
    const text = oc.FS.readFile(path, { encoding: "utf8" });
    return readBrep(text);
  };

  const readStepFrom = path => {
    if (oc.Interface_Static)
      oc.Interface_Static.SetCVal("xstep.cascade.unit", doc.units === "m" ? "M" : "MM");
    const reader = new oc.STEPControl_Reader();
    const status = String(reader.ReadFile(path));
    return finishStep(reader, status);
  };

  const readStep = text => {
    const path = "/import.step";
    if (oc.Interface_Static)
      oc.Interface_Static.SetCVal("xstep.cascade.unit", doc.units === "m" ? "M" : "MM");
    oc.FS.writeFile(path, text);
    const reader = new oc.STEPControl_Reader();
    let status;
    try {
      status = String(reader.ReadFile(path));
    } finally {
      try { oc.FS.unlink(path); } catch (err) { /* the scratch file is not important */ }
    }
    return finishStep(reader, status);
  };

  const finishStep = (reader, status) => {
    if (status !== "IFSelect_RetDone")
      throw new Error("that STEP file was refused (" + status + ")");
    if (!reader.NbRootsForTransfer())
      throw new Error("that STEP file holds nothing that transfers to a shape");
    reader.TransferRoots(new oc.Message_ProgressRange());
    const parts = [];
    for (let i = 1; i <= reader.NbShapes(); i++) {
      const shape = reader.Shape(i);
      if (shape && !shape.IsNull()) parts.push({ shape });
    }
    return parts;
  };

  //! A transferred root broken into the parts a person would call parts:
  //! solids if there are any, shells if there are not, faces if there are
  //! neither. A root that is one of those already comes back as itself.
  const explode = parts => {
    const SHELL = oc.TopAbs_ShapeEnum.TopAbs_SHELL;
    const out = [];
    for (const part of parts) {
      const solids = subShapes(part.shape, SOLID, oc.TopoDS.Solid);
      const shells = solids.length ? [] : subShapes(part.shape, SHELL, oc.TopoDS.Shell);
      const faces = solids.length || shells.length ? [] : subShapes(part.shape, FACE, oc.TopoDS.Face);
      const pieces = solids.length ? solids : shells.length ? shells : faces;
      if (!pieces.length) { out.push(part); continue; }
      for (const piece of pieces) out.push({ shape: piece, name: part.name });
    }
    return out;
  };

  //! A compound that holds one solid and nothing else IS that solid, and a STEP
  //! reader hands back plenty of them. Unwrapped here so what lands in the tree
  //! is a body like any other body - the counts have to match exactly, because
  //! a compound of one solid and three loose edges is not the solid.
  const unwrap = shape => {
    if (!shape || shape.IsNull()) return shape;
    if (String(shape.ShapeType()) !== "TopAbs_COMPOUND") return shape;
    const solids = subShapes(shape, SOLID, oc.TopoDS.Solid);
    if (solids.length !== 1) return shape;
    const one = solids[0];
    if (countSubShapes(one, FACE) !== countSubShapes(shape, FACE)
        || countSubShapes(one, EDGE) !== countSubShapes(shape, EDGE)) return shape;
    return one;
  };

  const describeShape = shape => {
    const solids = countSubShapes(shape, SOLID), faces = countSubShapes(shape, FACE);
    const count = (n, one) => n + " " + one + (n === 1 ? "" : "s");
    return solids ? count(solids, "solid") + ", " + count(faces, "face")
      : faces ? count(faces, "face") : "no surfaces - wireframe only";
  };

  //! STL gives every triangle its own three vertices, so a cube arrives as 36
  //! points that are really 8. Welding is what makes it a mesh rather than a
  //! pile, and it is done against the size of the thing rather than against a
  //! fixed number, because a file in metres and a file in millimetres are the
  //! same model.
  const weldTriangles = mesh => {
    if (!mesh.points.length) return mesh;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.points)
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    return weldMesh(mesh, Math.max(1e-7, diagonal * 1e-6), true);
  };

  //! Several parts as one mesh, vertices renumbered. Faces are copied across
  //! exactly as they are: a quad stays a quad.
  const mergeParts = (parts, name) => {
    const points = [], faces = [];
    for (const part of parts) {
      const base = points.length;
      for (const p of part.points) points.push(p);
      for (const face of part.faces) faces.push(face.map(i => i + base));
    }
    return { name, points, faces };
  };

  //! An OBJ group name may not carry a space and survive every reader.
  const objName = name => String(name || "part").replace(/\s+/g, "_");

  //! Everything visible, as polygons. A polymesh gives up its own faces
  //! untouched - which is the whole point: a quad cage exported here opens as
  //! a quad cage in Blender, and comes back as one. A B-Rep has no faces to
  //! keep, so it is tessellated and welded, and those are triangles because
  //! that is what a tessellation is.
  const exportParts = () => {
    const parts = [];
    for (const f of doc.features()) {
      if (!F.visible(f)) continue;
      const data = F.data(f);
      if (data && data.kind === "mesh") {
        parts.push({ name: objName(F.name(f)), points: F.triples(data), faces: meshFaces(data) });
        continue;
      }
      // A datum plane has a face on it so it can be seen; it is not geometry
      // anybody wants in a mesh file.
      if (F.spec(f).category === "datum") continue;
      const shape = F.shape(f);
      if (!shape || countSubShapes(shape, FACE) === 0) continue;   // nothing to tessellate
      const stream = tessellate(shape, deflectionFor(shape));
      if (!stream.positions || !stream.index || !stream.index.length) continue;
      const points = [], faces = [];
      for (let i = 0; i + 2 < stream.positions.length; i += 3)
        points.push([stream.positions[i], stream.positions[i + 1], stream.positions[i + 2]]);
      for (let i = 0; i + 2 < stream.index.length; i += 3)
        faces.push([stream.index[i], stream.index[i + 1], stream.index[i + 2]]);
      const box = extents(shape);
      parts.push({ name: objName(F.name(f)),
                   ...weldMesh({ points, faces }, Math.max(1e-4, (box ? box.diagonal : 100) * 1e-5), true) });
    }
    return parts;
  };

  return {
    kind: "wasm",
    description: "modelling in this page",

    //! What this kernel is: its catalogue of nodes, and the API those nodes are
    //! built out of. Two halves of one answer - a node is a driver and a driver
    //! is one factory call - so they are published together and anything
    //! reading the kernel, the node editor or the assistant, gets both.
    async schema() {
      return { ...schemaJson(), api: factorySchema({ hybrid: HSF, shape: SF }),
               exchange: FORMATS };
    },

    /* ------------------------------------------------------- packages

       What a package is handed, and how its nodes get in. A package's driver
       is a driver like any other - it reads its arguments off the labels and
       calls the factories - so what it needs is what every driver here needs,
       and it is handed the same things rather than a smaller copy of them. */

    //! Everything a package's drivers build with. The factories first, because
    //! a driver that reaches past them into OpenCascade is a driver doing two
    //! jobs - that rule does not stop applying because the driver arrived in a
    //! package.
    toolkit() {
      return {
        oc, F, hybrid: HSF, shape: SF,
        readPoint, readVector, planeAxis, planeTrouble, axisOf, alongCurve,
        wireFrom, firstFace, verticesOf, compoundOf, subShapes, extents,
        deflectionFor, tessellationOf, countSubShapes, describeError,
        points, numbers, vectors, text, pointsOf, zip,
        tessellate, sampleCurve, capped, outlines,
        bodies, FACE, EDGE, SOLID, ANY,
      };
    },

    //! A package's nodes, given drivers. The catalogue already has the specs by
    //! the time this is called - the package system put them there - so all
    //! that is left is to say which function builds each one.
    installDrivers(specs, builders) {
      const missing = specs.filter(spec => !builders[spec.type]).map(spec => spec.type);
      if (missing.length)
        throw new Error("no driver for " + missing.join(", ")
          + " - a node without one is a node that cannot build");
      for (const spec of specs)
        drivers.set(spec.guid, new Driver(spec, { ...builders[spec.type], release, describeError }));
    },

    removeDrivers(specs) { for (const spec of specs) drivers.delete(spec.guid); },

    //! Which of these types the document is actually using, by feature name.
    //! Asked before a package is put away, because taking a type out from under
    //! a feature leaves something nothing can rebuild.
    typesInUse(types) {
      const wanted = new Set(types);
      return doc.features().filter(f => wanted.has(F.spec(f).type)).map(F.name);
    },
    async tree() { return { ok: true, tree: doc.treeJson() }; },
    async model() { return doc.modelJson(); },

    //! WHOEVER IS WATCHING A LONG BUILD. Called with { stage, done, total }
    //! every slice or so; set by the page, left null by everything else. Not
    //! to be confused with the onProgress this factory TAKES, which is about
    //! starting OpenCascade up once. A kernel across a wire cannot call back,
    //! which is why this is a property and not an argument: the ones that can
    //! do, and the ones that cannot are not asked to.
    onBuild: null,

    async loadModel(model) {
      const parsed = typeof model === "string" ? JSON.parse(model) : model;
      //! READING THE FILE IS ITSELF WORK. Six thousand features is a second
      //! of parsing and wiring before a single shape is built, so the page is
      //! told what is happening before it starts rather than after.
      if (this.onBuild) this.onBuild({ stage: "reading", done: 0, total: 0 });
      const replacement = Doc.fromModel(drivers, parsed);
      for (const f of doc.features()) {                 // free the old B-Rep
        const shape = F.shape(f);
        if (shape) release(shape);
      }
      doc = replacement;
      //! BEFORE ANYTHING BUILDS. A packed import cannot be opened by its own
      //! driver - drivers are synchronous and unpacking is a stream - so it is
      //! opened here, where waiting is allowed.
      unpacked.clear();
      await openPacked();
      const tell = this.onBuild
        ? step => this.onBuild({ stage: "building", ...step }) : null;
      if (tell) await breathe();                        // let the message land
      const settled = state(await settleAsync(true, tell));
      //! AND PUT AWAY AGAIN. The shapes are built and OCAF is holding them;
      //! the text was only ever needed to get there, and on a large import it
      //! is the biggest thing in memory by a wide margin.
      unpacked.clear();
      return settled;
    },

    async setParameter(id, key, value) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      doc.setParameter(f, key, value);
      const tell = this.onBuild
        ? step => this.onBuild({ stage: "rebuilding", ...step }) : null;
      return state(await settleAsync(false, tell));
    },

    //! Editing a script is an edit of the document, undone and redone and saved
    //! like any other.
    //! One vertex, moved. The offset lands on whichever argument of the feature
    //! holds hand edits, so a feature that has none refuses it by name.
    async moveVertex(id, index, offset) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      const arg = F.spec(f).args.find(a => a.kind === "edits");
      if (!arg) throw new Error(F.name(f) + " does not hold hand edits - put an "
        + "EditMesh after it and move the vertex there");
      const zero = !offset || offset.every(v => Math.abs(v) < 1e-9);
      F.moveVertex(f, arg.key, index, zero ? null : offset);
      doc.log.touch(F.argLabel(f, arg.key, true));
      return state(settle(false));
    },

    //! THE CAGE A FEATURE PRODUCED, in full - points, n-gon faces and the
    //! sharpness table. The stream a mesh sends the viewport is triangles and
    //! loose edges, which is everything drawing it needs and nothing selecting
    //! it needs: an editor has to know which four points make face 12 before
    //! it can let anybody click on it. So the editor asks for this instead,
    //! and only while it is open.
    async cage(id) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      const data = F.data(f);
      if (!data || data.kind !== "mesh") throw new Error(F.name(f) + " is not a mesh");
      const sharp = meshCreases(data);
      // And the edit list itself, when this feature holds one, so the editor
      // opens on what is already there rather than on an empty list that would
      // overwrite it the first time anybody pressed anything.
      let ops = null;
      if (F.spec(f).args.some(a => a.key === "ops" && a.kind === "code")) {
        try { ops = JSON.parse(String(F.text(f, "ops") || "[]")); } catch (error) { ops = []; }
        if (!Array.isArray(ops)) ops = [];
      }
      return { id, name: F.name(f), points: F.triples(data), faces: meshFaces(data),
               creases: sharp.creases, corners: sharp.corners, smooth: !!data.smooth,
               ops, note: F.note(f) };
    },

    //! WHAT THERE IS TO PICK on a feature's shape: every edge as the polyline
    //! it is drawn with, or every face as its own triangles, each with the
    //! anchor that will find it again. Asked for only while somebody is
    //! picking, which is why it can afford to tessellate each face on its own.
    async picks(id, kind) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      const shape = F.shape(f);
      if (!shape) throw new Error(F.name(f) + " has not been built, so it has nothing to pick");
      const want = kind === "face" ? "face" : "edge";
      return { id, name: F.name(f), kind: want, items: pickList(shape, want) };
    },

    //! The whole arris through one edge - everything tangent to it, walked.
    //! Double-click, in other words, and the reason a fillet on a rounded slab
    //! is one gesture rather than eight.
    async tangentFrom(id, at, angle) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      const shape = F.shape(f);
      if (!shape) throw new Error(F.name(f) + " has not been built");
      const edges = pickList(shape, "edge").map(one => one.points);
      return { id, chain: tangentChain(edges, Math.max(0, Math.round(at)),
                                       { angle: Number(angle) > 0 ? Number(angle) : 5 }) };
    },

    //! The picks on an argument, written. One call, one list, one undo step -
    //! the same shape as the mesh editor's, for the same reason: a pick is a
    //! record rather than a change to a number.
    async setPicks(id, key, picks, mode, angle) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      const arg = F.spec(f).args.find(a => a.key === key && a.kind === "subs");
      if (!arg) throw new Error(F.name(f) + " has no picked sub-shapes called '" + key + "'");
      if (Array.isArray(picks)) F.setPicks(f, key, picks);
      //! The rule is set without touching the list, so "spread this the other
      //! way" is one edit rather than a re-pick. Passing neither is how the
      //! list is cleared, which is what "back to all of them" sends.
      if (mode !== undefined || angle !== undefined)
        F.setPickMode(f, key, mode === undefined ? F.pickMode(f, key).mode : mode, angle);
      doc.log.touch(F.argLabel(f, key, true));
      return state(settle(false));
    },

    //! THE EDIT LIST, WRITTEN. One call, one list, one undo step - the editor
    //! works out the operation and hands the whole list over, because an
    //! operation is a record rather than a change to a number and there is
    //! nothing smaller to send.
    async setMeshOps(id, ops) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      const arg = F.spec(f).args.find(a => a.key === "ops" && a.kind === "code");
      if (!arg) throw new Error(F.name(f) + " does not hold a list of mesh operations - "
        + "put an EditMesh after it and edit there");
      const list = Array.isArray(ops) ? ops : [];
      for (const record of list)
        if (!record || typeof record !== "object" || !MESH_OPS[record.op])
          throw new Error('"' + (record && record.op)
            + '" is not a mesh operation this knows');
      F.setText(f, "ops", JSON.stringify(list));
      doc.log.touch(F.argLabel(f, "ops", true));
      return state(settle(false));
    },

    async setCode(id, key, text) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      doc.setCode(f, key, text);
      return state(settle(false));
    },

    //! The drawing on a sketch. One string in, the whole sketch and everything
    //! downstream of it rebuilt - which is the same road the tree, the node
    //! editor and someone typing into the model file all take.
    async setSketch(id, key, drawing) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      const arg = key || (F.spec(f).args.find(a => a.kind === "sketch") || {}).key;
      if (!arg) throw new Error(F.name(f) + " has nothing to draw on");
      doc.setSketch(f, arg, drawing);
      return state(settle(false));
    },

    //! Wiring. An input that takes one wire is set; an input that takes several
    //! gets another. Passing no target clears - all of them, or the one named.
    async setReference(id, key, target, remove = false, only = false) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      if (remove || !target) doc.clearReference(f, key, target ? doc.find(target) : null);
      else doc.setReference(f, key, doc.find(target), only);
      return state(settle(false));
    },

    async addFeature(type, refs = {}, id = null) {
      const spec = typeSpec(type);
      if (!spec) throw new Error('unknown feature type "' + type + '"');
      const f = doc.addFeature(type, id);
      try {
        for (const [key, id] of Object.entries(refs)) {
          if (!id) continue;
          // An input that gathers takes a list: several things picked by hand
          // are wired in the order they were picked.
          for (const one of Array.isArray(id) ? id : [id]) {
            const target = doc.find(one);
            if (!target) throw new Error("cannot point " + key + " at unknown feature '" + one + "'");
            doc.setReference(f, key, target);
          }
        }
      } catch (err) {
        doc.deleteFeature(f);
        throw err;
      }
      return { ...state(settle(false)), id: F.id(f) };
    },

    //! File a feature under a set, or at the top level when `into` is null.
    //! One feature at a time, the way every other edit here works, so an undo
    //! step is one move and the report says which.
    async setParent(id, into) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      const holder = into ? doc.find(into) : null;
      if (into && !holder) throw new Error("no set '" + into + "'");
      doc.setParent(f, holder);
      return state(settle(false));
    },

    //! Everything feeding a set's contents from outside it. Published rather
    //! than worked out by the interface, because the answer depends on the
    //! wiring and the wiring lives here.
    async inputsOf(id) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      if (!doc.isContainer(f)) throw new Error(F.name(f) + " is not a set");
      return { ok: true, inputs: doc.inputsOf(f).map(x => ({ id: F.id(x), name: F.name(x) })),
               outputs: doc.outputsOf(f).map(x => ({ id: F.id(x), name: F.name(x) })),
               contents: doc.within(f).map(x => ({ id: F.id(x), name: F.name(x) })) };
    },

    async deleteFeature(id) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      doc.deleteFeature(f);
      return state(settle(false));
    },

    async rename(id, name) {
      const f = doc.find(id);
      if (!f || !name) throw new Error("no such feature, or an empty name");
      f.attr.TDataStd_Name = name;
      return state({ functions: 0, executed: [], skipped: [], failed: [] });
    },

    //! What a feature should look like. No rebuild follows - appearance is not
    //! geometry - so the tree comes back with no regeneration report.
    async setAppearance(id, appearance) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      doc.setAppearance(f, appearance);
      //! AN APPEARANCE IS USUALLY ONLY LOOKS, and looks are the renderer's -
      //! which is why this has never rebuilt anything. A drawing is the
      //! exception: what hatch a body is poched with is part of its
      //! appearance AND is geometry on the sheet, so a view that reads
      //! appearances has to be rebuilt when one changes or the drawing goes
      //! on showing the hatch you just took off.
      //!
      //! Declared by the node - `readsAppearance` on its spec - rather than
      //! named here, so the kernel does not have to know what a drawing is.
      const readers = doc.features().filter(one => {
        const spec = F.spec(one);
        return spec && spec.readsAppearance;
      });
      if (!readers.length) return { ok: true, tree: doc.treeJson(), report: null };
      for (const one of readers) doc.log.touch(F.argLabel(one, F.spec(one).args[0].key, true));
      return state(await settleAsync(false, null));
    },

    //! Show a body that something else swallowed, or stop showing it. See
    //! SHOWN_TAG: the rule is a default, and this is how it is overruled.
    //! MANY AT ONCE, in one call and one tree. Written because the one-at-a-time
    //! form is a round trip and a full treeJson PER FEATURE - on a building of
    //! seven and a half thousand features that is a tenth of a second each, and
    //! putting 715 overruled bodies back took twelve minutes of them. The same
    //! mistake, in the other direction, as the bug that made 715 of them.
    async setShownMany(ids, on) {
      const list = Array.isArray(ids) ? ids : [ids];
      let touched = 0;
      for (const id of list) {
        const f = doc.find(id);
        if (!f) continue;                       // a row that has since gone is not an error
        doc.setPinnedShown(f, !!on);
        touched++;
      }
      return { ok: true, tree: doc.treeJson(), report: null, touched };
    },

    async setShown(id, on) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      doc.setPinnedShown(f, !!on);
      return { ok: true, tree: doc.treeJson(), report: null };
    },

    //! WHETHER A BUILD IS ALLOWED TO BE APPROXIMATE, because a hand is still
    //! on a slider. Turning it OFF rebuilds whatever was drafted, which is why
    //! it answers with a tree: the accurate answer arrives as an ordinary
    //! redraw, one frame after the hand comes off, and nothing else has to
    //! remember to ask for it.
    //!
    //! Turning it ON answers with nothing at all. There is no reason to redraw
    //! for it - the very next edit is the one being drafted for.
    async setDraft(on, resettle = true) {
      const was = drafting();
      setDrafting(!!on);
      if (!!on === was || on || !resettle) return null;
      if (!doc.drafted.size) return null;
      return state(settle());
    },

    //! Where a feature sits in the tree. A view change, like the appearance:
    //! the rebuild order is the dependency graph and this is not it.
    async reorder(ids, target, after) {
      const list = Array.isArray(ids) ? ids : [ids];
      if (!doc.reorder(list, target, !!after))
        throw new Error("those features cannot be put there");
      return { ok: true, tree: doc.treeJson(), report: null };
    },

    //! How this feature pairs up the lists arriving on it. Unlike the
    //! appearance above, it rebuilds: see Doc.setSpread.
    async setSpread(id, spread) {
      const f = doc.find(id);
      if (!f) throw new Error("no feature '" + id + "'");
      doc.setSpread(f, spread);
      return state(settle(false));
    },

    //! The scene as STEP, for taking into any other CAD system. Every visible
    //! solid is transferred as its own root, so the parts stay separate rather
    //! than arriving as one lump.
    async exportStep() {
      const parts = [];
      for (const f of doc.features()) {
        if (!F.visible(f)) continue;
        const shape = F.shape(f);
        // Datums are construction geometry and have no business in a solid
        // exchange file.
        if (shape && countSubShapes(shape, SOLID) > 0) parts.push({ f, shape });
      }
      if (!parts.length) {
        // A polymesh is not a solid and STEP does not carry one. Say which
        // rather than "nothing to export" when the scene is plainly full.
        const meshes = doc.features().filter(f => {
          const data = F.data(f);
          return F.visible(f) && data && data.kind === "mesh";
        });
        if (meshes.length)
          throw new Error("STEP carries solids, and everything visible here is a polymesh - "
            + meshes.map(F.name).join(", ") + ". Put a MeshFromShape the other way round, or "
            + "export the mesh from the showroom instead.");
        throw new Error("there is nothing solid in the scene to export");
      }

      const writer = new oc.STEPControl_Writer();
      if (oc.Interface_Static)
        oc.Interface_Static.SetCVal("write.step.unit", doc.units === "m" ? "M" : "MM");

      for (const part of parts) {
        const status = writer.Transfer(part.shape,
          oc.STEPControl_StepModelType.STEPControl_AsIs, true, new oc.Message_ProgressRange());
        if (String(status) !== "IFSelect_RetDone")
          throw new Error("could not transfer " + F.name(part.f) + " to STEP");
      }

      const path = "/export.step";
      if (String(writer.Write(path)) !== "IFSelect_RetDone")
        throw new Error("could not write the STEP file");
      const text = oc.FS.readFile(path, { encoding: "utf8" });
      try { oc.FS.unlink(path); } catch (err) { /* the scratch file is not important */ }

      return { ok: true, text, solids: parts.length, name: doc.title, units: doc.units,
               parts: parts.length,
               note: parts.length + (parts.length === 1 ? " solid" : " solids")
                 + ", each its own root, in " + doc.units };
    },

    /* ------------------------------------------------------ exchange

       Files in and files out. Two rules hold this end of it together.

       A mesh keeps its faces. A quad stays a quad, an n-gon stays an n-gon,
       through the import, through the document and back out again - because a
       low-poly model from Blender or Max is a CAGE, and a cage triangulated on
       the way in is a cage you can no longer subdivide. Triangles appear in
       exactly two places and both are forced: STL, which has nothing else, and
       the tessellation of a B-Rep, which never had faces to keep.

       Whatever arrives is converted once, here, to the one form the document
       stores - a B-Rep string for solids, OBJ text for meshes. So every import
       rebuilds through one reader rather than through whichever reader first
       read it, and the model file says what it holds in a form a person can
       still read. */

    //! What can be read and written, published so the interface builds its
    //! menus from the kernel's own answer rather than from a list of its own
    //! that can drift.
    formats: FORMATS,

    //! One file in. Returns the document, and a note saying what was found -
    //! which is the part worth reading, because "14 solids in 3 assemblies"
    //! and "one solid" are both successes and only one of them is what was
    //! expected.
    //! A plane to put an imported drawing on, when the document has none. The
    //! same three datums a new document opens with, made here so that opening
    //! a DXF into an empty document does not need a person to draw a plane
    //! first.
    datumPlane(stem) {
      const origin = doc.addFeature("Point", null, "Origin");
      const up = doc.addFeature("Vector", null, "Z Direction");
      doc.setParameter(up, "dx", 0);
      doc.setParameter(up, "dy", 0);
      doc.setParameter(up, "dz", 1);
      const plane = doc.addFeature("Plane", null, "XY Plane");
      doc.setReference(plane, "origin", origin);
      doc.setReference(plane, "normal", up);
      return plane;
    },

    //! ONE SLICE OF A FILE, into the kernel's own filesystem. Answered here
    //! rather than by a driver because nothing about it is geometry: it is the
    //! file arriving, and what makes it worth having is that no caller ever
    //! holds more than one slice.
    async takeUpload({ path, bytes, at = 0 }) {
      return { wrote: takeChunk(String(path), bytes, Number(at) || 0) };
    },
    async finishUpload({ path }) { return { wrote: closeUpload(String(path)) }; },
    async dropUpload({ path }) { dropUpload(String(path)); return { ok: true }; },

    //! WHAT A STREAMED FILE SAYS ABOUT ITSELF, so the page can ask its one
    //! question - one thing, or several? - without ever having read the file.
    //! Counted through a window here rather than from a string, which is what
    //! makes the answer cost the same for two hundred megabytes as for two.
    //!
    //! A DXF is the exception and is read whole. Its survey is a list of
    //! layers and of what is drawn on them, not a count, and the import that
    //! follows reads the whole of it anyway - so reading it once more to
    //! answer the dialog would buy nothing.
    async surveyUpload({ path, format }) {
      const file = String(path);
      closeUpload(file);
      const size = uploadSize(file);
      const read = (at, length) => windowOf(file, at, length);
      if (format === "step") {
        const { products, assembly } = scanStep(read, size);
        return { size, parts: Math.max(products, assembly ? 2 : 1), assembly };
      }
      if (format === "obj") return { size, parts: countObjParts(read, size), assembly: false };
      if (format === "dxf")
        return { size, parts: 1, assembly: false,
                 survey: dxfSurvey(oc.FS.readFile(file, { encoding: "utf8" })) };
      return { size, parts: 1, assembly: false };
    },

    async importFile({ format, name = "", data = "", encoding = "text", as = "single",
                       units = "mm", layers = null, from = "" }) {
      const spec = FORMATS.find(f => f.key === format);
      if (!spec || !spec.read) throw new Error('this kernel cannot read "' + format + '"');
      //! A STREAMED IMPORT HAS NO `data`: the file is already on the kernel's
      //! filesystem under `from`, put there a slice at a time. Everything
      //! below reads it from there and the page never held it.
      const streamed = typeof from === "string" && from.length > 0;
      if (streamed) closeUpload(from);
      const bytes = encoding === "base64" ? fromBase64(data) : null;
      const stem = String(name).replace(/\.[^.]*$/, "") || "Imported";

      const made = [];
      const hold = (type, key, geometry, partName, source) => {
        const f = doc.addFeature(type, null, partName);
        F.setCode(f, key, geometry);
        F.setCode(f, "source", source);
        made.push(f);
        return f;
      };

      let note = "", folder = "Body";
      if (format === "step" || format === "brep") {
        //! Read from the file when it was streamed, from the string when it
        //! was not. The text is only fetched for the things that still need it
        //! - the names in a STEP assembly - and a streamed import does not
        //! fetch it at all unless it is a STEP, which is the case where it is
        //! worth the read.
        const text = streamed ? "" : (bytes ? utf8(bytes) : String(data));
        const parts = streamed
          ? (format === "brep" ? [readBrepFrom(from)] : readStepFrom(from))
          : (format === "brep" ? [readBrep(text)] : readStep(text));
        if (!parts.length) throw new Error("nothing in that file transferred into a shape");

        // One object, or one per part. Exploding is only offered for a format
        // that carries several - everything else has one thing in it, and
        // pretending otherwise would make a set of one.
        // One thing stays one thing. Wrapping a single shape in a compound of
        // one would make an import the only node in the document whose result
        // is a container, and every operation downstream would meet a shape of
        // a kind nothing else here produces.
        const pieces = as === "parts" ? explode(parts)
          : parts.length === 1 ? [{ shape: unwrap(parts[0].shape) }]
          : [{ shape: compoundOf(parts.map(p => p.shape)) }];
        //! THE NAMES ARE READ FROM THE FILE, and a streamed one is read off
        //! the kernel's filesystem rather than from a string the page sent.
        //! Only for a STEP, and only when there is more than one piece to
        //! name: reading two hundred megabytes back to label a single body
        //! would undo the point of streaming it.
        const namesFrom = () => {
          if (format !== "step" || pieces.length < 2) return [];
          try {
            return realNames(streamed ? oc.FS.readFile(from, { encoding: "utf8" }) : text);
          } catch (err) { return []; }
        };
        const names = namesFrom();
        const named = names.length === pieces.length ? names : null;
        //! PACKED ON THE WAY INTO THE DOCUMENT. BREP is ASCII and repetitive
        //! and gzips about eight times, which is what lets a 184 MB import
        //! live in a model file that still stands on its own - and in an undo
        //! stack that is still worth having. See packGeometry, which leaves a
        //! small import alone because a small one reads better plain.
        let stored = 0;
        for (let i = 0; i < pieces.length; i++) {
          const piece = pieces[i];
          const label = pieces.length === 1 ? stem
            : (piece.name || (named ? named[i] : "") || stem + " " + (i + 1));
          const written = oc.BRepToolsWrapper.Write(piece.shape);
          const packed = await packGeometry(written);
          stored += packed.length;
          const made = hold("Imported", "brep", packed, label, name);
          //! The plain text is in hand already, so the driver that is about to
          //! run gets it rather than unpacking what was just packed.
          if (packed !== written) unpacked.set(F.id(made), written);
        }
        note = pieces.length === 1
          ? "one object, " + describeShape(pieces[0].shape)
          : pieces.length + " parts"
            + (named ? ", named from the file" : ", numbered - the file gave no usable names");
        //! WHAT THE DOCUMENT NOW HOLDS, said out loud. An import that packed a
        //! hundred and eighty megabytes into twenty-four is worth knowing
        //! about: it is the difference between a model file somebody can send
        //! and one nobody can open, and it is not visible anywhere else.
        if (stored >= 1024 * 1024)
          note += " · " + (stored / 1024 / 1024).toFixed(1) + " MB stored";
        //! Only asked of a file the page actually handed over. A streamed one
        //! is on the kernel's filesystem and reading it back to answer a note
        //! would be reading the whole import a second time.
        if (format === "step" && as !== "parts" && !streamed && isAssembly(text))
          note += " (this file is an assembly - import it again as sub-components to break it up)";
        // Freed in the order they were made: a piece is a sub-shape of a part,
        // and a part is only its own if nothing exploded it.
        for (const piece of pieces)
          if (!parts.some(part => part.shape === piece.shape)) release(piece.shape);
        for (const part of parts) release(part.shape);
        //! THE FILE GOES as soon as the shapes are out of it. It is the
        //! largest thing in the kernel's filesystem by a wide margin, and
        //! leaving a hundred and eighty megabytes of it behind after an import
        //! would mean a second import could not be read.
        if (streamed) dropUpload(from);
      } else if (format === "obj" || format === "stl") {
        folder = "GeometricalSet";
        //! STREAMED OR HANDED OVER, and the difference is only where the bytes
        //! come from. A streamed OBJ is read off the kernel's filesystem as
        //! text; a streamed STL is read as bytes, because a binary STL is not
        //! text and reading it as any encoding would corrupt it.
        const asText = () => streamed ? oc.FS.readFile(from, { encoding: "utf8" })
                                      : (bytes ? utf8(bytes) : String(data));
        const asBytes = () => streamed ? oc.FS.readFile(from) : (bytes || String(data));
        const parts = format === "obj"
          ? parseObj(asText())
          : [{ name: stem, ...weldTriangles(parseStl(asBytes())) }];
        if (!parts.length) throw new Error("no faces in that file");
        const kept = parts.reduce((n, part) => n + part.faces.length, 0);
        const quads = parts.reduce((n, part) => n + part.faces.filter(f => f.length > 3).length, 0);

        const pieces = as === "parts" ? parts : [mergeParts(parts, stem)];
        //! Packed like any other import. An OBJ is text and repetitive and
        //! gzips as well as a BREP does, so a mesh that arrives as two hundred
        //! megabytes is not two hundred megabytes of document.
        let storedMesh = 0;
        for (const piece of pieces) {
          const written = writeObj([piece], "from " + name);
          const packed = await packGeometry(written);
          storedMesh += packed.length;
          const made = hold("MeshImported", "obj", packed, piece.name || stem, name);
          if (packed !== written) unpacked.set(F.id(made), written);
        }
        note = pieces.length + (pieces.length === 1 ? " mesh, " : " meshes, ") + kept + " faces"
          + (quads ? " - " + quads + " of them with more than three sides, kept as they are"
                   : " - all triangles");
      } else if (format === "dxf") {
        // A drawing is not a shape, and this is the one import that does not
        // make one. It makes a SKETCH - on a plane, with its corners written
        // down as coincidences - because everything a person wants to do with
        // an imported outline afterwards is a thing you do to a sketch.
        const text = streamed ? oc.FS.readFile(from, { encoding: "utf8" })
                              : (bytes ? utf8(bytes) : String(data));
        const { drawing, report } = dxfDrawing(text, {
          units: units || "mm",
          layers: Array.isArray(layers) && layers.length ? layers : null,
          limit: DXF_LIMIT,
        });
        if (!drawing.elements.length) {
          // Nothing came in, and the only useful thing to say is what IS in
          // the file: a drawing of nothing but text and dimensions is a common
          // thing to be sent, and "no geometry" on its own reads like a fault.
          const had = Object.entries(report.skipped)
            .map(([type, n]) => ignoredName(type, n)).join(", ");
          throw new Error("there is no geometry in that file for a sketch to hold"
            + (had ? " - what is in it is " + had : "")
            + (report.tilted ? (had ? ", and " : " - ") + report.tilted
                + " entities are drawn out of plane" : "")
            + (layers && layers.length ? " (on the layers you kept)" : ""));
        }

        const plane = doc.features().find(f => F.spec(f).type === "Plane") || this.datumPlane(stem);
        const sketch = doc.addFeature("Sketch", null, stem);
        doc.setReference(sketch, "plane", plane);
        const origin = doc.features().find(f => F.spec(f).type === "Point");
        if (origin) doc.setReference(sketch, "origin", origin);
        doc.setSketch(sketch, "drawing", drawing);
        // "Ignore": solving on arrival would move an imported drawing to
        // satisfy coincidences it already satisfies, and a drawing that shifts
        // the moment it lands is a drawing nobody trusts. Turn it back on when
        // you start pulling the outline about.
        doc.setParameter(sketch, "solve", 1);
        made.push(sketch);

        const said = Object.entries(report.skipped)
          .map(([type, n]) => ignoredName(type, n)).join(", ");
        note = report.elements + " elements from " + report.entities + " entities"
          + (report.blocks ? ", " + report.blocks + " block placements flattened" : "")
          + (report.joints ? ", " + report.joints + " corners held together"
             + (report.welded ? " (" + report.welded
                + " of them ends that only happened to meet)" : "") : "")
          + (said ? " · not brought in: " + said : "")
          + (report.tilted ? " · " + report.tilted + " out of plane" : "")
          + (report.collapsed ? " · " + report.collapsed
             + " of no length at all, left out" : "")
          + (report.full ? " · the file has more than " + report.limit
             + " entities and that is as many as a sketch holds - turn layers off and export again"
             : "");
      } else {
        if (streamed) dropUpload(from);
        throw new Error('"' + format + '" is not read here - a model file is opened, not imported');
      }
      //! Whatever branch ran, the file is done with. Said once here as well as
      //! in the branches that free it early, because a path that forgets leaves
      //! the largest thing in the kernel's filesystem behind it.
      if (streamed) dropUpload(from);

      // Several parts are a set, the way anything several is a set here: they
      // are filed under one, so the tree shows the file as one thing that can
      // be opened rather than as fourteen loose features.
      let holder = null;
      if (made.length > 1) {
        holder = doc.addFeature(folder, null, stem);
        for (const f of made) doc.setParent(f, holder);
      }

      const settled = state(settle(false));
      //! The plain text was only needed for the build that has just happened.
      //! On a large import it is the biggest thing in memory, and the shapes
      //! do not need it now.
      unpacked.clear();
      return { ...settled, note,
               created: made.map(F.id), set: holder ? F.id(holder) : null };
    },

    //! Everything visible, out. STEP is a separate road because it is the only
    //! one OpenCascade writes for us; the rest are written here, from what the
    //! features already hold.
    async exportShapes(format) {
      if (format === "step") return await this.exportStep();
      const spec = FORMATS.find(f => f.key === format);
      if (!spec || !spec.write) throw new Error('this kernel cannot write "' + format + '"');
      const stem = (doc.title || "part").replace(/[^\w.-]+/g, "-");

      if (format === "brep") {
        const shapes = doc.features().filter(f => F.visible(f) && F.shape(f)).map(F.shape);
        if (!shapes.length) throw new Error("there is no B-Rep geometry visible to write");
        return { ok: true, text: oc.BRepToolsWrapper.Write(compoundOf(shapes)),
                 parts: shapes.length, name: doc.title, units: doc.units,
                 note: shapes.length + " shapes, exactly as they are held" };
      }

      // A DXF is a drawing, and the drawings in this document are its sketches.
      // Every one of them goes, consumed or not: the profile a slab was
      // extruded from is exactly the thing somebody wants back as a DXF, and
      // it is hidden precisely because it was used.
      if (format === "dxf") {
        const sketches = doc.features().filter(f => F.spec(f).type === "Sketch")
          .map(f => ({ name: F.name(f), drawing: sketchDrawing(f) }))
          .filter(one => (one.drawing.elements || []).length);
        if (!sketches.length)
          throw new Error("there are no sketches in this document, and a DXF is a drawing - "
            + "draw one, or import one, and it will go back out");
        const written = writeDxf(sketches, { units: "mm", name: doc.title });
        return { ok: true, text: written.text, parts: written.layers,
                 name: doc.title, units: doc.units,
                 note: written.entities + " entities on " + written.layers
                   + (written.layers === 1 ? " layer" : " layers") + ", in millimetres"
                   + (written.construction
                       ? " · " + written.construction + " construction held back" : "") + " · "
                   + sketches.map(one => one.name + ": " + describeDrawing(one.drawing))
                     .join(" · ") };
      }

      const parts = exportParts();
      if (!parts.length) throw new Error("there is nothing visible to write");
      const polygons = parts.reduce((n, p) => n + p.faces.filter(f => f.length > 3).length, 0);
      const note = "from " + doc.title + ", " + doc.units;
      const text = format === "obj" ? writeObj(parts, note) : writeStl(parts, stem);
      return { ok: true, text, parts: parts.length, name: doc.title, units: doc.units,
               note: format === "obj"
                 ? parts.length + " objects" + (polygons
                     ? ", " + polygons + " faces of more than three sides kept as they are"
                     : "")
                 : parts.length + " objects, fanned into triangles - which is all STL has" };
    },

    /* ------------------------------------------- where a shape is, and no more

       THE CHEAP ANSWER, so the viewport can put a building on screen before
       it has tessellated any of it.

       Tessellating six thousand features takes four seconds and sixty
       megabytes of triangles, and at the moment the file opens the camera can
       see perhaps three hundred of them. What it needs for the rest is where
       they are and how big - eight numbers each, off the bounding box, which
       OpenCascade already has from the B-Rep and does not have to mesh to
       give. The viewport draws those as boxes and asks for the triangles of
       whatever it is actually looking at, as it looks at it.

       The face count travels with them because the budget has to guess a
       weight for something it has not meshed, and faces are the only honest
       proxy the cheap answer has.                                         */
    async boxes(ids) {
      const wanted = ids && ids.length ? ids : doc.features().map(F.id);
      const features = [];
      for (const id of wanted) {
        const f = doc.find(id);
        if (!f) continue;
        const spec = F.spec(f);
        const shape = F.shape(f);
        const data = F.data(f);
        let low = null, high = null, faces = 0;
        try {
          if (data && data.kind === "mesh") {
            for (const p of F.triples(data)) {
              if (!low) { low = p.slice(); high = p.slice(); continue; }
              for (let i = 0; i < 3; i++) {
                if (p[i] < low[i]) low[i] = p[i];
                if (p[i] > high[i]) high[i] = p[i];
              }
            }
            faces = meshFaces(data).length;
          } else if (shape && !shape.IsNull()) {
            const room = extents(shape);
            if (room) { low = room.low; high = room.high; }
            faces = countSubShapes(shape, FACE);
          }
        } catch (err) { low = null; high = null; }
        features.push({
          id, type: spec.type, name: F.name(f), revision: F.revision(f),
          built: !!shape || !!(data && data.kind === "mesh"), visible: F.visible(f),
          low, high, faces,
        });
      }
      return { ok: true, features };
    },

    //! Only the shapes the caller names, which is only ever the shapes whose
    //! revision moved.
    async mesh(ids) {
      const wanted = ids && ids.length ? ids : doc.features().map(F.id);
      const features = [];
      for (const id of wanted) {
        const f = doc.find(id);
        if (!f) continue;
        const spec = F.spec(f);
        const shape = F.shape(f);
        const data = F.data(f);
        let mesh = {};
        try {
          // A polymesh is drawn from its own polygons; there is no B-Rep under
          // it to tessellate.
          mesh = data && data.kind === "mesh" ? streamMesh(data) : tessellate(shape, 0);
        } catch (err) {
          mesh = { meshError: describeError(err) };
        }
        features.push({
          id, type: spec.type, name: F.name(f), revision: F.revision(f),
          built: !!shape || !!(data && data.kind === "mesh"), visible: F.visible(f), ...mesh,
        });
      }
      return { ok: true, features };
    },
  };
}
