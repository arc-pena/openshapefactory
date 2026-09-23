// The two factories.
//
// CATIA splits its geometry API in two, and the split is the right one: a
// HybridShapeFactory that makes wireframe and surfaces, and a ShapeFactory that
// makes and cuts solids. Everything that is not a solid is hybrid; everything
// that is, is not. Nothing else needs saying to know which half a thing lives
// in, and a person who knows CATIA already knows where to look.
//
// The point of naming them is that they become a surface with a shape, rather
// than a pile of calls. Every operation here is DECLARED - a name, what it
// takes, what it gives back, one sentence - and the declaration and the
// implementation are the same object, so they cannot drift. That declaration is
// what the kernel publishes, what the node editor's catalogue is built on top
// of, and what the assistant is handed when it is asked to build something. One
// definition, three readers.
//
// The layering it buys:
//
//     factory (HSF / SF)   the geometry, and only the geometry
//            |             knows nothing about documents, labels or features
//     OCAF driver          reads the arguments off the labels, calls one
//            |             factory operation, hands back the shape
//     node element         the catalogue entry: what it is called, what it
//                          takes, and which driver runs it
//
// A driver that reaches past the factory into OpenCascade is a driver doing two
// jobs, and the reason a "point on curve" and a "point at the centre" ended up
// with two different ideas of what a curve is.

/* ------------------------------------------------------------------ maths */

export const CONFUSION = 1e-7;

//! How many samples a CLOSED curve is fitted through, at least. See the spline
//! factory for the measurement behind the number: the fit is not periodic, so
//! the seam closes only as smoothly as the samples either side of it make it.
export const FIT_SEAM_SAMPLES = 120;

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                    a[0] * b[1] - a[1] * b[0]],
  length: a => Math.hypot(a[0], a[1], a[2]),
  norm(a) { const l = V.length(a); return l < 1e-9 ? null : V.scale(a, 1 / l); },
};

//! Rodrigues: \p v turned \p angle about \p axis.
export function turnAbout(v, axis, angle) {
  const k = V.norm(axis);
  if (!k) return v;
  const c = Math.cos(angle), s = Math.sin(angle);
  const along = V.dot(v, k);
  const cross = V.cross(k, v);
  return [v[0] * c + cross[0] * s + k[0] * along * (1 - c),
          v[1] * c + cross[1] * s + k[1] * along * (1 - c),
          v[2] * c + cross[2] * s + k[2] * along * (1 - c)];
}

/* ------------------------------------------------------------- the tables

   Each entry is the operation AND its declaration. `run` is what gets called;
   the rest is what gets published. They are the same object, so a signature
   cannot describe an operation that is not there and an operation cannot exist
   without saying what it is.                                                */

//! One factory, built from its table. The result is callable as
//! `hsf.pointCoord(...)` and readable as `hsf.$manifest`.
function assemble(table, kind) {
  const api = { $kind: kind, $manifest: [] };
  for (const entry of table) {
    api[entry.name] = entry.run;
    api.$manifest.push({ name: entry.name, takes: entry.takes,
                         gives: entry.gives, summary: entry.summary });
  }
  Object.freeze(api.$manifest);
  return api;
}

//! Both factories, over one OpenCascade. \p kit carries the handful of things
//! that need the shape utilities living in the kernel - reading a wire off a
//! shape, listing its vertices - so the factory never has to know how a
//! document stores anything.
export function makeFactories(oc, kit) {
  const { wireOf, verticesOf, compoundOf, tessellationOf, deflectionFor,
          smallestSolidExtent } = kit;
  const pnt = p => new oc.gp_Pnt(p[0], p[1], p[2]);
  const dir = d => new oc.gp_Dir(d[0], d[1], d[2]);
  const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
  const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
  const WIRE = oc.TopAbs_ShapeEnum.TopAbs_WIRE;
  const SOLID = oc.TopAbs_ShapeEnum.TopAbs_SOLID;
  const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;

  const count = (shape, of) => {
    const walk = new oc.TopExp_Explorer(shape, of, ANY);
    let n = 0;
    while (walk.More()) { n++; walk.Next(); }
    walk.delete();
    return n;
  };
  const each = (shape, of, cast) => {
    const walk = new oc.TopExp_Explorer(shape, of, ANY);
    const out = [];
    while (walk.More()) { out.push(cast(walk.Current())); walk.Next(); }
    walk.delete();
    return out;
  };
  const positive = (value, what) => {
    if (!(value > CONFUSION)) throw new Error(what + " must be greater than zero");
    return value;
  };
  //! An axis system from a location and a normal, with an X direction that is
  //! a suggestion rather than a demand: gp_Ax2 projects it onto the plane, so
  //! a rough one will do as long as it is not along the normal.
  //! Straight segments through a list of points. Declared here rather than
  //! only in the table because two other operations end in one, and reaching
  //! back into the assembled factory to build a wire would make the table
  //! depend on its own result.
  const polylineOf = (points, closed) => {
    if (points.length < 2) throw new Error("a polyline needs at least two points");
    const maker = new oc.BRepBuilderAPI_MakeWire();
    const run = closed ? [...points, points[0]] : points;
    let any = false;
    for (let i = 0; i + 1 < run.length; i++) {
      if (V.length(V.sub(run[i + 1], run[i])) < CONFUSION) continue;
      maker.Add(new oc.BRepBuilderAPI_MakeEdge(pnt(run[i]), pnt(run[i + 1])).Edge());
      any = true;
    }
    if (!any) throw new Error("all of those points are in the same place");
    return maker.Wire();
  };

  //! A RUN OF POINTS AS ONE SMOOTH CURVE, rather than as a run of segments.
  //!
  //! Every curve in this program that is not a line, a circle or a conic is
  //! worked out as points - a Catmull-Rom through them, a Hermite blend with a
  //! tension at each end, a parabola walked out along its arms, a curve pulled
  //! down onto a skin - and every one of them used to be handed on as the
  //! polyline it had been sampled as. That is what made a sketched spline
  //! extrude into forty-eight flat strips instead of one surface. The geometry
  //! really was forty-eight straight edges; the faceting was not the display.
  //!
  //! It did not have to be. This build does carry a B-spline fitter. What it
  //! does not carry is the name it was looked for under: TColgp_Array1OfPnt is
  //! a typedef, and the binding is published under the template it is a
  //! typedef OF - NCollection_Array1_gp_Pnt - so every search for the TColgp
  //! name came back empty and the conclusion was that GeomAPI_PointsToBSpline
  //! could not be fed. It can.
  //!
  //! THE ENDS ARE EXACT. Measured, not assumed: a sketch chain welds its
  //! elements end to end, and a curve that missed its own ends by a micron
  //! would stop the wire closing. Everything between is within \p tolerance.
  const smoothOf = (points, closed, tolerance = 0) => {
    const run = [];
    for (const p of points)
      if (!run.length || V.length(V.sub(p, run[run.length - 1])) > CONFUSION) run.push(p);
    // A closed run is one whose last point IS its first: said here rather than
    // left to the caller, because a fit is not told about closure any other way.
    if (closed && run.length > 2
        && V.length(V.sub(run[0], run[run.length - 1])) > CONFUSION) run.push(run[0]);
    // Two points are a line, and a line is better as a line than as a spline
    // pretending to be one.
    if (run.length < 3) return polylineOf(points, closed);

    //! A TOLERANCE IS A LENGTH, so it has to know how long the curve is. A
    //! fixed hundredth of a millimetre is nothing on a two-metre curve and a
    //! crude approximation on a two-millimetre one. A hundred-thousandth of
    //! the run's own reach is well under a display pixel at any zoom that
    //! shows the whole curve, and it keeps the pole count - and the seconds -
    //! in hand: asking for more than the samples themselves know is paying
    //! for precision that was never in the input.
    let reach = 0;
    for (const axis of [0, 1, 2]) {
      let low = Infinity, high = -Infinity;
      for (const p of run) { low = Math.min(low, p[axis]); high = Math.max(high, p[axis]); }
      reach = Math.max(reach, high - low);
    }
    const tol = tolerance > 0 ? tolerance : Math.max(1e-4, reach * 1e-5);

    try {
      const array = new oc.NCollection_Array1_gp_Pnt(1, run.length);
      run.forEach((p, i) => array.SetValue(i + 1, pnt(p)));
      const fitted = new oc.GeomAPI_PointsToBSpline(
        array, 3, 8, oc.GeomAbs_Shape.GeomAbs_C2, tol);
      if (!fitted.IsDone()) return polylineOf(points, closed);
      const maker = new oc.BRepBuilderAPI_MakeWire();
      maker.Add(new oc.BRepBuilderAPI_MakeEdge(fitted.Curve()).Edge());
      if (!maker.IsDone()) return polylineOf(points, closed);
      return maker.Wire();
    } catch (error) {
      // ONE CURVE IS NOT THE MODEL. A fit that will not converge is a reason to
      // hand back the segments it was fitted to, not a reason for the feature
      // to fail: it is the same curve either way, and the only difference is
      // whether what is built off it comes out smooth.
      return polylineOf(points, closed);
    }
  };

  const faceOf = wire => {
    const face = new oc.BRepBuilderAPI_MakeFace(wire, true);
    if (!face.IsDone()) throw new Error("that wire does not bound a flat face");
    return face.Face();
  };

  //! How much surface a shape has. Used to check a fix rather than to report a
  //! number, so the answer only has to be comparable with itself.
  const areaOf = shape => {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(shape, props, false, false);
    return props.Mass();
  };

  //! THE FACE A BOUNDARY BOUNDS WHEN IT IS NOT FLAT. Four corners sampled off a
  //! loft are almost never coplanar, and BRepBuilderAPI_MakeFace wants a plane
  //! before it will do anything - so a panel taken off a curved skin cannot be
  //! made the flat way at all. This is the other way: a surface that passes
  //! through the boundary edges and minimises its own bending in between, which
  //! is the bilinear patch when the boundary is four straight runs and a
  //! reasonable answer when it is not.
  //!
  //! The constraint is C0 - pass through the edges - rather than G1, because G1
  //! asks each edge which face it lies on and a boundary built out of loose
  //! polylines has no answer.
  const patchOf = wire => {
    const fill = new oc.BRepOffsetAPI_MakeFilling(3, 15, 2, false, 1e-5, 1e-4, 1e-2, 1e-1, 8, 9);
    let edges = 0;
    for (const edge of each(wire, EDGE, oc.TopoDS.Edge)) {
      fill.Add(edge, oc.GeomAbs_Shape.GeomAbs_C0, true);
      edges++;
    }
    if (edges < 3) throw new Error("a patch needs a boundary of at least three edges");
    fill.Build(new oc.Message_ProgressRange());
    if (!fill.IsDone()) throw new Error("no surface would pass through that boundary");
    const face = fill.Shape();
    if (!face || face.IsNull()) throw new Error("the patch came out empty");
    return face;
  };

  //! Flat if it can be, patched if it cannot. Asked in that order because a
  //! planar face carries its plane with it and everything downstream - a pad, a
  //! sketch support, a draft's neutral plane - would rather have the plane than
  //! a spline that happens to be flat.
  const anyFaceOf = wire => {
    try {
      const face = new oc.BRepBuilderAPI_MakeFace(wire, true);
      if (face.IsDone()) return face.Face();
    } catch (error) { /* not planar; the patch below is the answer */ }
    return patchOf(wire);
  };

  //! Where a wire starts and where it stops, walked as one curve. Not its
  //! vertices: a wire's ends are the two the edges do not share, and picking
  //! those out of a chain of forty is work the adaptor has already done.
  const endsOf = wire => {
    const walk = new oc.BRepAdaptor_CompCurve(wire);
    const a = walk.Value(walk.FirstParameter()), b = walk.Value(walk.LastParameter());
    return [[a.X(), a.Y(), a.Z()], [b.X(), b.Y(), b.Z()]];
  };

  //! The direction of a wire that is one straight edge, or null if it is not
  //! one. Both halves of the question in one answer, because the caller wants
  //! the direction the moment the answer is yes.
  const straightRun = wire => {
    const edges = each(wire, EDGE, oc.TopoDS.Edge);
    if (edges.length !== 1) return null;
    try {
      const walk = new oc.BRepAdaptor_Curve(edges[0]);
      if (walk.GetType() !== oc.GeomAbs_CurveType.GeomAbs_Line) return null;
      // BRepAdaptor_Curve::Line() would say it outright, but gp_Lin is not
      // bound in this build - so the direction comes off the two ends, which
      // for a straight edge is the same answer.
      const [from, to] = endsOf(wire);
      return V.norm(V.sub(to, from));
    } catch (e) { return null; }
  };

  //! HOW A CORNER IS TURNED. The three OpenCascade offers, named the way a
  //! person asks for them rather than the way the header spells them.
  const JOINS = ["Rounded", "Sharp", "Tangent"];
  const joinType = said => said === 1 ? oc.GeomAbs_JoinType.GeomAbs_Intersection
                        : said === 2 ? oc.GeomAbs_JoinType.GeomAbs_Tangent
                                     : oc.GeomAbs_JoinType.GeomAbs_Arc;

  //! How far across a shape is, for tolerances that have to scale with it.
  const extentsOf = shape => {
    try {
      const box = new oc.Bnd_Box();
      oc.BRepBndLib.Add(shape, box, false);
      if (box.IsVoid()) return 0;
      const lo = box.CornerMin(), hi = box.CornerMax();
      return Math.hypot(hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z());
    } catch (e) { return 0; }
  };

  //! How long a wire is. The same call the Measure node makes, so the number
  //! here and the number on screen are the same number.
  const lengthOf = shape => {
    try {
      const props = new oc.GProp_GProps();
      oc.BRepGProp.LinearProperties(shape, props, false, false);
      return props.Mass();
    } catch (e) { return NaN; }
  };

  //! EVERY POINT AND TANGENT ALONG A WIRE, EDGE BY EDGE.
  //!
  //! BRepAdaptor_CompCurve walks a whole wire as one curve and is the obvious
  //! tool, and its POSITIONS are right. Its DERIVATIVES are not to be relied
  //! on here: sampled through it, a perfectly smooth interpolated curve gave
  //! tangents that swung about, the sideways step swung with them, and the
  //! curve fitted through those steps came back ten metres from a curve four
  //! hundred long. Walked edge by edge - each with its own adaptor, its own
  //! parameter range and its own orientation - the same curve offsets exactly.
  //!
  //! An edge REVERSED in the wire runs backwards through its own parameters,
  //! and a tangent read without noticing that points the other way, which puts
  //! half the offset on the wrong side of the curve.
  const walkWire = (wire, samples, visit, { ends = true } = {}) => {
    const edges = each(wire, EDGE, oc.TopoDS.Edge);
    if (!edges.length) return 0;
    const per = Math.max(2, Math.ceil(samples / edges.length));
    let seen = 0, along = null;
    for (const edge of edges) {
      const walk = new oc.BRepAdaptor_Curve(edge);
      const first = walk.FirstParameter(), last = walk.LastParameter();
      //! THE CONTINUITY GUARD BELOW IS RESET AT EVERY EDGE, and forgetting to
      //! was a bug with a shape you could see. Inside one edge a tangent
      //! cannot turn round, so one that reads as having is noise and is turned
      //! back. ACROSS a joint it can and routinely does: a polyline that
      //! doubles back - two runs meeting at 145 degrees - turns its tangent by
      //! more than a right angle, which reads as reversed and used to be
      //! "corrected" into pointing back down the wire. Every offset point on
      //! that second run then came out on the far side of it.
      //!
      //! Measured on [0,0]-[100,0]-[60,60] offset by 20: the last point came
      //! back at (43.4, 48.9), which is twenty millimetres on the WRONG side
      //! of the corner it should have been twenty the other side of. The
      //! curve crossed itself in the middle and looked, in the word used at
      //! the time, waky.
      along = null;
      //! Compared as a STRING. Orientation() comes back as "TopAbs_REVERSED"
      //! through this binding, not as the enum value, so comparing it with
      //! oc.TopAbs_Orientation.TopAbs_REVERSED is a string against an object
      //! and is false for every edge there has ever been.
      const back = String(edge.Orientation()) === "TopAbs_REVERSED";
      //! `ends: false` leaves out the two ends of every edge. A CORNER is
      //! where a curve stops being a constant distance from its offset: the
      //! nearest point from a source corner to an offset that has been trimmed
      //! or turned there is not the offset distance, and measuring it as if it
      //! were made a perfectly good inward offset report itself "16.5685 mm
      //! off" - which is 40*sqrt(2) - 40, the corner, and nothing wrong at all.
      for (let i = ends ? 0 : 1; i <= (ends ? per : per - 1); i++) {
        const u = first + (last - first) * (i / per);
        const at = walk.Value(u);
        const d = walk.DN(u, 1);
        let way = V.norm([d.X(), d.Y(), d.Z()]);
        if (!way) continue;
        if (back) way = V.scale(way, -1);
        //! A TANGENT CANNOT TURN ROUND INSIDE ONE EDGE, so one that reads as
        //! having turned round has not: it is numerical noise, and near the
        //! first knot of a fitted B-spline there is plenty of it. Sampled at
        //! two hundred points, an interpolated curve read its first three
        //! tangents as forward, backward, backward - which put those offset
        //! points twenty millimetres on the WRONG side of the curve, and the
        //! spline fitted through the result swung two thousand millimetres
        //! away trying to pass through both sides of it.
        //!
        //! Turned back rather than dropped, because dropping them leaves a gap
        //! exactly where the curve is hardest to fit.
        if (along && V.dot(way, along) < 0) way = V.scale(way, -1);
        along = way;
        visit([at.X(), at.Y(), at.Z()], way);
        seen++;
      }
    }
    return seen;
  };

  //! THE PLANE A CURVE LIES IN, WORKED OUT FROM THE CURVE.
  //!
  //! A sketch writes down the plane it was drawn on and a support declares
  //! one, but most curves have neither: a Polyline through four points, an
  //! interpolated curve, a blend. They are almost always flat all the same,
  //! and without a normal an offset has no side to go to, no way to check
  //! which side it went to, and no way to redo it when the kernel strays. An
  //! interpolated curve offset by 20 came back with its worst point 362 mm out
  //! and nothing noticed, because every check needed a normal and there was
  //! none.
  //!
  //! So it is measured: sample the curve, take the widest triangle in the
  //! samples, and check every other sample lies in the plane it spans. Return
  //! nothing when they do not, because then the curve really is three
  //! dimensional and an offset of it needs a support to say what "sideways"
  //! means.
  const planeOfWire = (wire, samples = 32) => {
    try {
      const pts = [];
      walkWire(wire, samples, at => pts.push(at));
      if (pts.length < 3) return null;
      const origin = pts[0];
      let normal = null, widest = 0;
      for (let i = 1; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          const cross = V.cross(V.sub(pts[i], origin), V.sub(pts[j], origin));
          const area = V.length(cross);
          if (area > widest) { widest = area; normal = V.norm(cross); }
        }
      if (!normal) return null;
      const reach = extentsOf(wire) || 1;
      for (const p of pts)
        if (Math.abs(V.dot(V.sub(p, origin), normal)) > Math.max(1e-6, reach * 1e-5))
          return null;                                   // genuinely not flat
      return normal;
    } catch (e) { return null; }
  };

  //! A SUPPORT THAT IS FLAT IS NOT A SUPPORT, IT IS A PLANE.
  //!
  //! Offsetting a curve "within a surface" is a different road from offsetting
  //! it in a plane, and a much worse one: it samples, projects, steps in the
  //! tangent plane, re-projects and fits, and its own report says how far off
  //! it came out. That is the price of a surface that curves. A PLANE does not
  //! curve, so none of it is necessary - offsetting in a plane is the exact 2D
  //! road, and a planar support is only telling us which plane.
  //!
  //! It matters because wiring the plane a curve was drawn on is the obvious
  //! thing to do, and doing it used to quietly swap an exact answer for a
  //! sampled one. Returns the plane's normal, or null when the support really
  //! does curve.
  const flatSupport = face => {
    try {
      if (!face) return null;
      const on = new oc.BRepAdaptor_Surface(face, true);
      if (String(on.GetType()) !== "GeomAbs_Plane") return null;
      const d = on.Plane().Axis().Direction();
      return V.norm([d.X(), d.Y(), d.Z()]);
    } catch (e) { return null; }
  };

  //! IS THAT ANSWER A CURVE OR A KNOT?
  //!
  //! An offset has a length bound and it is exact: a simple curve offset by d
  //! gains at most 2*pi*d, because that is its total turning. A curve whose
  //! radius of curvature dips below d has no simple offset at all - the two
  //! sides of the tight bend cross, and what comes back is the right shape
  //! with a loop tied in it. A real CAD offset trims those loops; this one
  //! cannot, so the least it can do is not hand one over pretending.
  //!
  //! Measured: an interpolated curve 487 long, offset by 20, came back 1700
  //! long - three and a half times its source, every point of it a plausible
  //! 20 from the curve, and completely unusable. A quarter of the source's
  //! length on top of the turning bound is slack no honest offset needs.
  const knotted = (wire, made, distance) => {
    const was = lengthOf(wire), now = lengthOf(made);
    if (!Number.isFinite(was) || !Number.isFinite(now)) return false;
    //! BOTH WAYS. Too long is a loop; too short is a stub. The same walk that
    //! returned 1700 mm for a 487 mm curve returned 10 mm for it once the loop
    //! was refused - a fragment of the answer, handed over with a note saying
    //! all was well. The turning bound holds in both directions: an offset
    //! gains at most 2*pi*d and loses at most 2*pi*d, and the slack is a
    //! quarter of the source on top of that.
    const slack = 2 * Math.PI * Math.abs(distance) + Math.max(was, Math.abs(distance)) * 0.25;
    return now > was + slack || now < was - slack;
  };

  //! HOW FAR THE ANSWER REALLY IS FROM THE CURVE IT CAME FROM, at its worst.
  //! The one property an offset has to have, and the only honest way to know
  //! whether the kernel delivered it.
  const strayOf = (wire, made, distance, samples = 48) => {
    try {
      let worst = 0;
      walkWire(wire, samples, at => {
        const gap = new oc.BRepExtrema_DistShapeShape();
        gap.LoadS1(new oc.BRepBuilderAPI_MakeVertex(pnt(at)).Vertex());
        gap.LoadS2(made);
        gap.Perform();
        if (!gap.IsDone() || !gap.NbSolution()) return;
        worst = Math.max(worst, Math.abs(gap.Value() - Math.abs(distance)));
      }, { ends: false });
      return worst;
    } catch (e) { return 0; }
  };

  //! OFFSETTING A CURVE WITHIN A SURFACE, the long way round.
  //!
  //! BRepOffsetAPI_MakeOffset has a constructor that takes a FACE and offsets
  //! within it, and it is the right tool. It is also not in this build: handed
  //! a face it traps - "null function or function signature mismatch" - and it
  //! does so for every form of it, with the face's own wire, with a wire added,
  //! with no wire at all. Probed rather than assumed, because the support
  //! argument had been in the catalogue for months and the one thing it was
  //! for had never once worked.
  //!
  //! So it is done here, by the same road builders.Project takes: walk the
  //! curve, step sideways in the surface's own tangent plane, pull each step
  //! back onto the surface, and fit one B-spline through what comes out. The
  //! sideways step is perpendicular to the curve and lies IN the surface, so
  //! the result stays on the surface, which is the whole point of a support.
  //!
  //! What this is not: a geodesic offset. The step is measured as a straight
  //! line and then projected, so on a surface that curves hard across the
  //! offset the distance comes out slightly short. It is measured rather than
  //! hoped for - the caller is told the worst error - and on anything gently
  //! curved it is far below the tolerance anybody is working to.
  const offsetInSurface = (wire, distance, face, samples = 160) => {
    const surface = oc.BRep_Tool.Surface(face);
    const probe = new oc.BRepAdaptor_Surface(face, true);
    const onto = at => {
      const got = new oc.GeomAPI_ProjectPointOnSurf(pnt(at), surface);
      if (!got.NbPoints()) return null;
      const p = got.NearestPoint();
      const uv = got.LowerDistanceParameters(0, 0);
      return { at: [p.X(), p.Y(), p.Z()], u: uv.U, v: uv.V };
    };
    //! The surface's normal where the curve actually is, not at the middle of
    //! its parameter range: on a cylinder those differ by ninety degrees.
    const normalAt = (u, v) => {
      const du = Math.max(1e-6, Math.abs(probe.LastUParameter() - probe.FirstUParameter()) * 1e-4);
      const dv = Math.max(1e-6, Math.abs(probe.LastVParameter() - probe.FirstVParameter()) * 1e-4);
      const put = (a, b) => { const q = probe.Value(a, b); return [q.X(), q.Y(), q.Z()]; };
      const here = put(u, v);
      return V.norm(V.cross(V.sub(put(u + du, v), here), V.sub(put(u, v + dv), here)));
    };

    const run = [];
    let worst = 0, adrift = 0;
    const reach = (() => {
      const box = extentsOf(wire);
      return box ? Math.max(box, 1) : 1;
    })();
    walkWire(wire, samples, (from, way) => {
      const seat = onto(from);
      if (!seat) return;
      adrift = Math.max(adrift, V.length(V.sub(seat.at, from)));
      const up = normalAt(seat.u, seat.v);
      if (!up) return;
      // Right of travel, in the surface - the same side rule the flat road uses.
      const side = V.norm(V.cross(way, up));
      if (!side) return;
      const landed = onto(V.add(seat.at, V.scale(side, distance)));
      if (!landed) return;
      run.push(landed.at);
      worst = Math.max(worst, Math.abs(V.length(V.sub(landed.at, seat.at)) - Math.abs(distance)));
    });
    if (run.length < 3)
      throw new Error("that curve does not lie on its support, so there is no "
        + "surface to offset it within - check the support, or unwire it to "
        + "offset in the curve's own plane");
    //! ON the support, not merely near it. Projecting a curve that is nowhere
    //! near its support onto it does not fail - it hands back the shadow, which
    //! is a curve in the wrong place with a note saying everything went well.
    //! A thousandth of the curve's own size is generous for a curve that was
    //! drawn on the surface and hopeless for one that was not.
    if (adrift > Math.max(1e-3, reach * 1e-3))
      throw new Error("that curve is not on its support - the furthest part of it is "
        + Math.round(adrift * 100) / 100 + " mm away, so there is no surface there to "
        + "offset it within. Unwire the support to offset it in its own plane");
    return { shape: smoothOf(run, closedWire(wire), 0), worst };
  };

  //! One offset, asked for exactly once. Split out because the side check
  //! below has to be able to ask for the other one.
  const offsetOnce = (wire, distance, turn, open, support) => {
    const maker = support
      ? new oc.BRepOffsetAPI_MakeOffset(support, turn, open)
      : new oc.BRepOffsetAPI_MakeOffset(wire, turn, open);
    if (support) maker.AddWire(wire);
    try {
      //! SetApprox(false), AND IT IS THE WHOLE DIFFERENCE BETWEEN A PARALLEL
      //! CURVE AND A PILE OF CHIPS.
      //!
      //! The offset of a B-spline is not a B-spline, so it cannot be written
      //! as one exactly. Left alone, OpenCascade hands back edges carrying
      //! Geom_OffsetCurve - the offset AS ITSELF, exact, and four edges for
      //! the curve measured below. Asked to approximate, it fits B-splines
      //! through that and chops the result to hold the tolerance: the same
      //! curve came back in 231 edges, and a closed one in 313.
      //!
      //! Measured on an interpolated spline 381.690 long, offset by 20:
      //!
      //!     SetApprox(true)    386.624 long   231 edges   worst 0.0001
      //!     SetApprox(false)   386.624 long     4 edges   worst 0.0000
      //!
      //! Identical length, identical distance, fifty-seven times the topology
      //! - and every one of those 231 edges arrives in the viewport, in the
      //! extrude built on it, and in the STEP. That is what "the parallel
      //! curve comes out waky" was.
      //!
      //! The comment this replaces said SetApprox(true) was there because the
      //! plain answer gained 119.5 of length where the turning says exactly
      //! 2*pi*20 = 125.66. Re-measured: the plain answer gains 125.68. The
      //! five per cent was somebody else's bug, fixed since, and the flag
      //! outlived the reason for it.
      maker.SetApprox(false);
      maker.Perform(distance, 0);
      return maker.IsDone() ? maker.Shape() : null;
    } catch (e) { return null; }
  };

  //! DID IT GO WHERE IT WAS TOLD, AND IS THAT A QUESTION THIS CAN ANSWER?
  //! Three answers, not two: 1 for the side the sign asked for, -1 for the
  //! other one, and 0 for "cannot tell from here".
  //!
  //! The third is not pedantry. Reading it as "not wrong" - which is what a
  //! boolean forces - made an offset that had gone to the WRONG side
  //! indistinguishable from one nobody could measure, and the caller then had
  //! no way to prefer an answer it had read as right over one it had not read
  //! at all. What came of that: a distance whose own side has no offset was
  //! answered with the OTHER side's offset, built, with no error on it, on
  //! the opposite side of the curve from where the number said.
  //!
  //! Measured off the two shapes rather than reasoned about from the wire's
  //! orientation, because orientation is exactly the thing that is not
  //! reliable here.
  //!
  //! Closed: a simple closed curve offset OUTWARD by d gains exactly 2*pi*d
  //! of length, whatever shape it is, because its total turning is one
  //! revolution - the arcs added at the convex corners and the runs trimmed
  //! at the concave ones come to that and nothing else. So the sign of the
  //! change in length says which way it went, and it says it for a kidney
  //! shape as surely as for a circle.
  //!
  //! Open: the vector from a point half way along the source to the nearest
  //! place on the result is compared with normal x tangent. RIGHT of the way
  //! it is drawn, and not left, because that is the side that agrees with
  //! what a CLOSED curve does. A circle drawn the usual way round grows
  //! outward on a positive distance, and outward is to the right of travel;
  //! an arc of that same circle has to move the same way or the two disagree
  //! - which is exactly the surprise this started from, an arc of r100 offset
  //! by +25 coming back at r75 while the whole circle came back at r125.
  const sideRead = (wire, made, distance, shut, normal) => {
    if (!made || made.IsNull()) return 0;
    try {
      if (shut) {
        const grew = lengthOf(made) - lengthOf(wire);
        if (!Number.isFinite(grew) || Math.abs(grew) < CONFUSION) return 0;
        return (distance > 0) === (grew > 0) ? 1 : -1;
      }
      if (!normal) return 0;                      // no plane to have a side of
      const mid = midOf(wire);
      if (!mid) return 0;
      const side = V.norm(V.cross(mid.way, normal));
      if (!side) return 0;
      const gap = new oc.BRepExtrema_DistShapeShape();
      gap.LoadS1(new oc.BRepBuilderAPI_MakeVertex(pnt(mid.at)).Vertex());
      gap.LoadS2(made);
      gap.Perform();
      if (!gap.IsDone() || gap.NbSolution() < 1) return 0;
      const p = gap.PointOnShape2(1);
      const went = V.sub([p.X(), p.Y(), p.Z()], mid.at);
      const on = V.dot(went, side);
      if (Math.abs(on) < CONFUSION) return 0;
      return (distance > 0) === (on > 0) ? 1 : -1;
    } catch (e) { return 0; }
  };

  //! Where a wire is, and which way it is going, half way along it. Used to
  //! work out which SIDE an offset came out on - see parallelCurve.
  const midOf = wire => {
    const edges = each(wire, EDGE, oc.TopoDS.Edge);
    if (!edges.length) return null;
    const edge = edges[Math.floor(edges.length / 2)];
    try {
      const walk = new oc.BRepAdaptor_Curve(edge);
      const u = (walk.FirstParameter() + walk.LastParameter()) / 2;
      const at = walk.Value(u);
      const d = walk.DN(u, 1);
      const way = V.norm([d.X(), d.Y(), d.Z()]);
      return way ? { at: [at.X(), at.Y(), at.Z()], way } : null;
    } catch (e) { return null; }
  };

  //! A shape somewhere else, under a location rather than rebuilt.
  const shapeMoved = (shape, by) => {
    const move = new oc.gp_Trsf();
    move.SetTranslation(new oc.gp_Vec(by[0], by[1], by[2]));
    return shape.Moved(new oc.TopLoc_Location(move));
  };

  //! Does this wire come back to where it started? Asked of the geometry
  //! rather than of TopoDS_Shape::Closed(), which is a flag somebody has to
  //! have set and which an assembled wire usually has not.
  const closedWire = wire => {
    //! GEOMETRY, WITH A TOLERANCE THAT SCALES. Are the two ends in the same
    //! place - and "the same place" has to mean something relative to the
    //! curve, because a fitted B-spline six hundred millimetres round closes
    //! to about a thousandth and a fixed 1e-4 called that open. Read as open,
    //! a closed loop asked to grow by 20 took the open road and came back 120
    //! shorter.
    //!
    //! The topological test - a closed wire has as many vertices as edges -
    //! was tried here and is wrong in this build: a single fitted B-spline
    //! edge reports one vertex whether it closes or not, so every spline came
    //! back "closed", the fit looped its far end round to its start, and the
    //! offset of an open curve came back a curve away from where it belonged.
    try {
      const [from, to] = endsOf(wire);
      const span = V.length(V.sub(to, from));
      const reach = extentsOf(wire) || 1;
      return span < Math.max(1e-4, reach * 1e-5);
    } catch (e) { return false; }
  };

  //! A solid whose faces face out. A shell thickened from a surface whose
  //! normals happen to point inwards comes back inside out - it measures a
  //! NEGATIVE volume, and every boolean after it is then working with a void
  //! rather than a body. Cheap to detect and cheap to put right.
  const rightWayOut = shape => {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
    return props.Mass() < 0 ? shape.Reversed() : shape;
  };

  //! A surface moved along its own normal. Both factories reach for it - the
  //! hybrid one to publish it, the solid one on its way to a thickness - so it
  //! is declared once, here, rather than in either table.
  const offsetSurfaceOf = (surface, distance) => {
    if (Math.abs(distance) < CONFUSION) return surface;
    const made = new oc.BRepOffsetAPI_MakeOffsetShape();
    made.PerformByJoin(surface, distance, CONFUSION * 10,
      oc.BRepOffset_Mode.BRepOffset_Skin, false, false,
      oc.GeomAbs_JoinType.GeomAbs_Arc, false);
    if (!made.IsDone()) throw new Error("that surface will not offset by that much");
    return made.Shape();
  };

  //! A profile carried along a rail, once. Both factories reach for it - a
  //! skin in one, a body in the other - so the settings that make it right are
  //! written down once, here, where they cannot be got wrong in only one of
  //! the two.
  //!
  //! Both settings matter, and neither is the default:
  //!
  //!   SetTransitionMode(RightCorner)   what to do where the rail turns a
  //!                                    corner. Left on Transformed, the
  //!                                    section is dragged through the corner
  //!                                    rather than mitred at it.
  //!   Add(..., correction = true)      turn the section to stay square to the
  //!                                    rail. Without it the section keeps the
  //!                                    angle it started at the whole way.
  //!
  //! Measured on a quarter turn of radius 1000 with a 100 radius section, where
  //! the right answer is 49,339,215: the defaults give 31,415,927 - which is
  //! exactly the section swept STRAIGHT for 1000, the section never having
  //! turned at all. Correction alone gives 32,427,006 and the corner mode alone
  //! 41,998,774. Only both together give the elbow.
  const pipeAlong = (profileWire, spine, solid, intoWire = null) => {
    const shell = new oc.BRepOffsetAPI_MakePipeShell(spine);
    shell.SetMode(false);                       // corrected Frenet
    shell.SetTransitionMode(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
    shell.Add(profileWire, false, true);
    //! A SECOND PROFILE MORPHS THE SECTION ALONG THE RAIL, which is the third
    //! kind of pipe surface the documentation lists: not a constant section
    //! dragged along, but one that BECOMES another on the way - a duct that
    //! starts round and ends square, a handrail that tapers. The same call
    //! either way; the second Add is the whole difference.
    if (intoWire) shell.Add(intoWire, false, true);
    shell.Build(new oc.Message_ProgressRange());
    if (!shell.IsDone()) throw new Error("that profile will not sweep along that rail");
    if (solid && !shell.MakeSolid())
      throw new Error("that profile does not close, so it cannot sweep into a body");
    const made = shell.Shape();
    if (!made || made.IsNull()) throw new Error("that sweep came out empty");
    return made;
  };

  //! Every closed run a profile offers, as { outer, holes } - one entry per
  //! region. A profile is often several separate loops, and a loop may have
  //! loops inside it; both have to be swept as what they are, because adding
  //! two wires to one MakePipeShell makes a sweep that MORPHS from the first
  //! into the second rather than two tubes.
  const regionsOf = profile => {
    const faces = each(profile, FACE, oc.TopoDS.Face);
    if (faces.length) return faces.map(face => {
      const outer = oc.BRepTools.OuterWire(face);
      return { outer, holes: each(face, WIRE, oc.TopoDS.Wire)
        .filter(w => !w.IsSame(outer)) };
    });
    const wires = each(profile, WIRE, oc.TopoDS.Wire);
    return (wires.length ? wires : [wireOf(profile)]).map(outer => ({ outer, holes: [] }));
  };

  //! The one loft, used by both factories: a skin here, a body there.
  const thruSections = (sections, ruled, solid) => {
    if (sections.length < 2) throw new Error("a loft needs at least two sections");
    const maker = new oc.BRepOffsetAPI_ThruSections(solid, ruled, CONFUSION);
    for (const section of sections) maker.AddWire(section);
    maker.Build();
    if (!maker.IsDone()) throw new Error("those sections will not loft");
    return maker.Shape();
  };

  const frame = (at, normal, xdir) => {
    const n = V.norm(normal);
    if (!n) throw new Error("that direction has no length");
    const across = xdir && V.norm(xdir);
    return across && Math.abs(V.dot(across, n)) < 0.999
      ? new oc.gp_Ax2(pnt(at), dir(n), dir(across))
      : new oc.gp_Ax2(pnt(at), dir(n));
  };

  /* ================================================== HybridShapeFactory */

  //! THE VIEW'S OWN AXES, worked out in ONE place because two places is two
  //! answers. The projection and the cut face are drawn on the same sheet and
  //! have to agree about which way u runs; derived separately, they did not -
  //! the cut came out turned a quarter turn from the lines round it, which on
  //! a square plan is invisible and on anything else is obviously wrong.
  //!
  //! It is the same rule viewFrame uses on the page, for the same reason.
  const viewAxes = (look, up) => {
    const gaze = V.norm(look) || [0, 0, -1];
    const z = [-gaze[0], -gaze[1], -gaze[2]];
    let hint = V.norm(up || [0, 0, 1]);
    //! Looking straight down, "up the sheet" cannot be the world Z - that is
    //! the direction of travel - so it becomes world Y, which is north-up.
    if (!hint || Math.abs(V.dot(hint, z)) > 0.999)
      hint = Math.abs(z[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
    const x = V.norm(V.cross(hint, z)) || [1, 0, 0];
    return { x, y: V.cross(z, x), z };
  };

  //! Runs joined end to end while their ends agree. Enough for a wire,
  //! which is a chain by definition - so this is a matching problem rather
  //! than a search, and it stops the moment the loop closes.
  const chainRuns = (pieces, tol) => {
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
    const left = pieces.slice();
    const out = [];
    while (left.length) {
      const run = left.shift();
      for (;;) {
        const tip = run[run.length - 1];
        let at = -1, flip = false;
        for (let i = 0; i < left.length; i++) {
          if (near(left[i][0], tip)) { at = i; flip = false; break; }
          if (near(left[i][left[i].length - 1], tip)) { at = i; flip = true; break; }
        }
        if (at < 0) break;
        const piece = left.splice(at, 1)[0];
        run.push(...(flip ? piece.slice(0, -1).reverse() : piece.slice(1)));
        if (near(run[0], run[run.length - 1])) break;
      }
      out.push(run);
    }
    return out;
  };

  const hybridTable = [

    /* ----------------------------------------------------------- points */
    { name: "pointCoord", takes: "x, y, z", gives: "point",
      summary: "A point at three coordinates.",
      run: (x, y, z) => [x, y, z] },

    { name: "pointOnCurve", takes: "curve, ratio", gives: "{ at, tangent }",
      summary: "A point a fraction of the way along a curve, with the direction "
             + "the curve is going there. The whole wire, not one edge, so a "
             + "chained profile reads as one curve the way it looks.",
      run: (curve, ratio) => {
        const adaptor = new oc.BRepAdaptor_CompCurve(wireOf(curve));
        const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
        const u = first + (last - first) * Math.max(0, Math.min(1, ratio));
        const p = adaptor.Value(u);
        const d = new oc.gp_Vec();
        adaptor.D1(u, new oc.gp_Pnt(), d);
        return { at: [p.X(), p.Y(), p.Z()], tangent: V.norm([d.X(), d.Y(), d.Z()]) };
      } },

    { name: "curveAtPoint", takes: "curve, point", gives: "{ at, tangent, ratio }",
      summary: "The nearest place on a curve to a point, with the direction the curve "
             + "is going there. The same answer pointOnCurve gives, asked the other "
             + "way round: a point you have already put on the curve says where it is "
             + "on it, so nothing downstream has to carry a parameter that has to be "
             + "kept in step with the point by hand.",
      run: (curve, point) => {
        const adaptor = new oc.BRepAdaptor_CompCurve(wireOf(curve));
        const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
        if (!(last > first)) throw new Error("that curve cannot be walked along");
        const away = u => {
          const p = adaptor.Value(u);
          return V.length([p.X() - point[0], p.Y() - point[1], p.Z() - point[2]]);
        };
        // Coarse first, then squeezed: a composite curve has no closed form for
        // this and OpenCascade's projector wants a single Geom_Curve, which a
        // chained profile is not. A hundred samples finds the right edge of the
        // chain; forty halvings of the bracket take the rest to floating point.
        const STEPS = 100;
        let lo = first, hi = last, best = first, score = Infinity;
        for (let i = 0; i <= STEPS; i++) {
          const u = first + ((last - first) * i) / STEPS;
          const d = away(u);
          if (d < score) { score = d; best = u; }
        }
        const span = (last - first) / STEPS;
        lo = Math.max(first, best - span);
        hi = Math.min(last, best + span);
        for (let i = 0; i < 40 && hi - lo > 1e-12; i++) {
          const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
          if (away(a) < away(b)) hi = b; else lo = a;
        }
        const u = (lo + hi) / 2;
        const p = adaptor.Value(u);
        const d = new oc.gp_Vec();
        adaptor.D1(u, new oc.gp_Pnt(), d);
        const tangent = V.norm([d.X(), d.Y(), d.Z()]);
        if (!tangent) throw new Error("the curve has no direction there");
        return { at: [p.X(), p.Y(), p.Z()], tangent,
                 ratio: (u - first) / (last - first) };
      } },

    { name: "pointCenter", takes: "shape", gives: "point",
      summary: "The centre of a circular or elliptical edge, taken from the curve "
             + "itself rather than from a bounding box - so half an arc still says "
             + "where its centre is, which a box cannot. Anything else answers with "
             + "the middle of its extents.",
      run: shape => {
        for (const edge of each(shape, EDGE, oc.TopoDS.Edge)) {
          try {
            const curve = new oc.BRepAdaptor_Curve(edge);
            const type = curve.GetType();
            const at = type === oc.GeomAbs_CurveType.GeomAbs_Circle ? curve.Circle().Location()
                     : type === oc.GeomAbs_CurveType.GeomAbs_Ellipse ? curve.Ellipse().Location()
                     : null;
            if (at) return [at.X(), at.Y(), at.Z()];
          } catch (e) { /* not a conic; try the next edge */ }
        }
        const box = new oc.Bnd_Box();
        oc.BRepBndLib.Add(shape, box, true);
        if (box.IsVoid()) throw new Error("there is nothing there to take the centre of");
        const lo = box.CornerMin(), hi = box.CornerMax();
        return [(lo.X() + hi.X()) / 2, (lo.Y() + hi.Y()) / 2, (lo.Z() + hi.Z()) / 2];
      } },

    { name: "pointExtreme", takes: "shape, direction, furthest", gives: "point",
      summary: "The point on a shape that reaches furthest along a direction, or "
             + "furthest back against it. Read off the same tessellation the "
             + "viewport draws, so the far end found is the far end you can see - "
             + "a cylinder's side counts, not only its rims.",
      run: (shape, direction, furthest = true) => {
        const along = V.norm(direction);
        if (!along) throw new Error("a direction is needed to be extreme along");
        let best = null, score = furthest ? -Infinity : Infinity;
        const consider = p => {
          const d = V.dot(p, along);
          if (furthest ? d > score : d < score) { score = d; best = p; }
        };
        for (const p of verticesOf(shape)) consider(p);
        for (const p of tessellationOf(shape, deflectionFor(shape))) consider(p);
        if (!best) throw new Error("there is nothing there to be extreme");
        return best;
      } },

    { name: "pointBetween", takes: "a, b", gives: "{ at, gap }",
      summary: "Where two shapes come closest, and how far apart they are there. A "
             + "gap of zero means they cross, so this answers \"the intersection\" "
             + "and \"the nearest point\" with one call - as well, because this "
             + "build carries no curve-to-curve intersector.",
      run: (a, b) => {
        const gap = new oc.BRepExtrema_DistShapeShape();
        gap.LoadS1(a);
        gap.LoadS2(b);
        gap.Perform();
        if (!gap.IsDone() || gap.NbSolution() < 1)
          throw new Error("those two never come near each other");
        const p = gap.PointOnShape1(1), q = gap.PointOnShape2(1);
        return { at: [(p.X() + q.X()) / 2, (p.Y() + q.Y()) / 2, (p.Z() + q.Z()) / 2],
                 gap: gap.Value() };
      } },

    { name: "pointVertex", takes: "point", gives: "shape",
      summary: "One point as a shape, so it can be drawn and picked.",
      run: at => new oc.BRepBuilderAPI_MakeVertex(pnt(at)).Shape() },

    /* ------------------------------------------------------------ lines */
    { name: "lineFrom", takes: "at, along, from, to", gives: "shape",
      summary: "A straight edge along a direction, cut by two lengths measured from "
             + "where it starts - so it may run backwards as well as forwards.",
      run: (at, along, from, to) => {
        const unit = V.norm(along);
        if (!unit) throw new Error("that line has no direction");
        if (Math.abs(to - from) < CONFUSION) throw new Error("the line has no length");
        return new oc.BRepBuilderAPI_MakeEdge(
          pnt(V.add(at, V.scale(unit, from))), pnt(V.add(at, V.scale(unit, to)))).Shape();
      } },

    { name: "lineDistanceToPlane", takes: "at, along, plane", gives: "number",
      summary: "How far along a direction a plane is - what turns \"until that "
             + "plane\" into a length, and says so when the two never meet.",
      run: (at, along, plane) => {
        const unit = V.norm(along);
        if (!unit) throw new Error("that line has no direction");
        const origin = plane.Location(), normal = plane.Direction();
        const n = [normal.X(), normal.Y(), normal.Z()];
        const facing = V.dot(n, unit);
        if (Math.abs(facing) < CONFUSION)
          throw new Error("the line runs along that plane, so it never reaches it");
        return V.dot(V.sub([origin.X(), origin.Y(), origin.Z()], at), n) / facing;
      } },

    { name: "axisOf", takes: "shape or direction", gives: "{ at, along }",
      summary: "A direction, from a vector or from whatever a shape runs along - the "
             + "axis of a cylinder, the run of a line. Turning a plane wants one and "
             + "so does a revolution, and neither cares which it was given.",
      run: (shape, straight) => {
        if (straight && V.length(straight) > CONFUSION)
          return { at: [0, 0, 0], along: V.norm(straight) };
        if (!shape) return null;
        const ends = verticesOf(shape);
        if (ends.length >= 2) {
          const along = V.norm(V.sub(ends[ends.length - 1], ends[0]));
          if (along) return { at: ends[0], along };
        }
        return null;
      } },

    /* ----------------------------------------------------------- planes */
    { name: "planeNormal", takes: "at, normal, xdir", gives: "axis system",
      summary: "The plane through a point with a normal. Every other plane here "
             + "comes back as one of these, so nothing downstream has to know which "
             + "way it was asked for.",
      run: (at, normal, xdir) => frame(at, normal, xdir) },

    { name: "planeOffset", takes: "plane, distance", gives: "axis system",
      summary: "A plane parallel to another, a distance along its normal. It keeps "
             + "the parent's X direction, so the two share a coordinate system.",
      run: (plane, distance) => {
        const n = plane.Direction(), at = plane.Location(), x = plane.XDirection();
        return frame([at.X() + n.X() * distance, at.Y() + n.Y() * distance,
                      at.Z() + n.Z() * distance],
                     [n.X(), n.Y(), n.Z()], [x.X(), x.Y(), x.Z()]);
      } },

    { name: "planeMean", takes: "a, b", gives: "axis system",
      summary: "The plane halfway between two. Facing each other and facing the same "
             + "way both make sense, so the nearer reading is taken and the bisector "
             + "never flips as one of them turns.",
      run: (a, b) => {
        const na = a.Direction(), nb = b.Direction();
        const pa = a.Location(), pb = b.Location();
        const sign = na.X() * nb.X() + na.Y() * nb.Y() + na.Z() * nb.Z() < 0 ? -1 : 1;
        const between = [na.X() + nb.X() * sign, na.Y() + nb.Y() * sign,
                         na.Z() + nb.Z() * sign];
        if (V.length(between) < CONFUSION)
          throw new Error("those two planes are back to back");
        return frame([(pa.X() + pb.X()) / 2, (pa.Y() + pb.Y()) / 2, (pa.Z() + pb.Z()) / 2],
                     between);
      } },

    { name: "planeRotate", takes: "plane, axis, degrees", gives: "axis system",
      summary: "A plane turned about an axis, staying where it is.",
      run: (plane, axis, degrees) => {
        const at = plane.Location(), n = plane.Direction();
        return frame([at.X(), at.Y(), at.Z()],
                     turnAbout([n.X(), n.Y(), n.Z()], axis, degrees * Math.PI / 180));
      } },

    //! EVERYTHING ON ONE SIDE OF A PLANE, CUT AWAY.
    //!
    //! "Extrude up to that plane" was being done as arithmetic: measure from
    //! the middle of the profile to the plane along the direction, and sweep
    //! that far. That is exact for a plane square to the sweep and wrong for
    //! every other one - an angled plane is nearer at one edge of the profile
    //! than the other, and a prism of one length cannot be flush with it. What
    //! came back was a plain prism of the average depth, which looks right
    //! from the front and is not trimmed to anything.
    //!
    //! The real answer is to sweep PAST the plane and cut, which is what every
    //! kernel does underneath. OpenCascade's own BRepFeat_MakePrism would do
    //! it in one call and is not in this build; a half-space is, and it is the
    //! same operation with the steps showing. The half-space is the infinite
    //! solid on the far side of the plane, so cutting it off leaves exactly
    //! the part on the near side, flush with the plane however it is angled.
    //!
    //! Measured: a cylinder of radius 100 swept along Z and trimmed at a plane
    //! through z = 150 tilted 24 degrees - volume 4712389.0, against
    //! pi*100^2*150 = 4712389.0 for the flat cut at the same height, which is
    //! what the tilt has to come to when it turns about the axis.
    { name: "trimAtPlane", takes: "shape, plane, from", gives: "shape",
      summary: "A shape with everything on the far side of a plane cut off, keeping "
             + "the side \p from is on. What \"up to that plane\" really means, and "
             + "the only form of it that is right for a plane at an angle.",
      run: (shape, plane, from) => {
        const origin = plane.Location(), normal = plane.Direction();
        const at = [origin.X(), origin.Y(), origin.Z()];
        const n = V.norm([normal.X(), normal.Y(), normal.Z()]);
        if (!n) throw new Error("that plane has no normal");
        const side = V.dot(V.sub(from, at), n);
        if (Math.abs(side) < CONFUSION)
          throw new Error("that is on the plane, so there is no side to keep");
        //! The half-space is named by a point INSIDE it, and the point has to
        //! be far enough out to be unambiguous - the reach of the shape being
        //! cut is the only length here that is guaranteed to be big enough.
        const reach = Math.max(extentsOf(shape) || 0, Math.abs(side)) * 4 + 1;
        const away = V.add(at, V.scale(n, side > 0 ? -reach : reach));
        const face = new oc.BRepBuilderAPI_MakeFace(
          new oc.gp_Pln(new oc.gp_Ax3(plane)), -reach, reach, -reach, reach).Face();
        const beyond = new oc.BRepPrimAPI_MakeHalfSpace(face, pnt(away)).Solid();
        const cut = new oc.BRepAlgoAPI_Cut(shape, beyond);
        cut.Build();
        if (!cut.IsDone()) throw new Error("that shape will not trim at that plane");
        const made = cut.Shape();
        if (!made || made.IsNull() || (count(made, FACE) === 0 && count(made, EDGE) === 0))
          throw new Error("nothing of that shape is on this side of the plane");
        return made;
      } },

    //! How big a shape is, corner to corner. Declared because the drivers need
    //! it too - an extrude that has to overshoot a plane has to know by how
    //! much - and reaching into the factory's own helper from outside it is
    //! how two definitions of "how big" come to disagree.
    //! THE PLANE A FLAT SHAPE LIES IN, or nothing when it does not lie in one.
    //! Declared so a driver can ask - an extrude taking its direction from the
    //! profile needs exactly this, and a sketch built out of loose curves has
    //! no frame written on it to read instead.
    { name: "planeOfShape", takes: "shape", gives: "vector",
      summary: "The normal of the plane a flat shape lies in, or nothing when it is "
             + "not flat. What \"normal to the profile\" is asking for.",
      run: shape => {
        try {
          const wires = each(shape, WIRE, oc.TopoDS.Wire);
          for (const wire of wires) { const n = planeOfWire(wire); if (n) return n; }
          return null;
        } catch (e) { return null; }
      } },

    { name: "extentsOf", takes: "shape", gives: "number",
      summary: "The diagonal of a shape's bounding box: one number for how big it is.",
      run: shape => extentsOf(shape) || 0 },

    { name: "planeFace", takes: "plane, size", gives: "shape",
      summary: "A plane as something you can see: a square of it, centred on its "
             + "origin. The size is display only and drives no geometry.",
      run: (plane, size) => {
        const half = positive(size, "display size") / 2;
        return new oc.BRepBuilderAPI_MakeFace(
          new oc.gp_Pln(new oc.gp_Ax3(plane)), -half, half, -half, half).Shape();
      } },

    /* ----------------------------------------------------------- curves */
    { name: "circle", takes: "plane, radius", gives: "shape",
      summary: "A circle on a plane, as a closed wire.",
      run: (plane, radius) => new oc.BRepBuilderAPI_MakeWire(
        new oc.BRepBuilderAPI_MakeEdge(
          new oc.gp_Circ(plane, positive(radius, "circle radius"))).Edge()).Wire() },

    { name: "ellipse", takes: "plane, major, minor", gives: "shape",
      summary: "An ellipse on a plane, as a closed wire. Its major radius runs along "
             + "the plane's X direction.",
      run: (plane, major, minor) => {
        const a = positive(major, "major radius"), b = positive(minor, "minor radius");
        if (b > a) throw new Error("an ellipse's minor radius cannot exceed its major radius");
        return new oc.BRepBuilderAPI_MakeWire(
          new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Elips(plane, a, b)).Edge()).Wire();
      } },

    { name: "polyline", takes: "points, closed", gives: "shape",
      summary: "Straight segments through a list of points, open or closed.",
      run: (points, closed) => polylineOf(points, closed) },

    { name: "fitCurve", takes: "points, closed, tolerance", gives: "shape",
      summary: "One smooth B-spline curve through a run of points, passing through "
             + "the first and last exactly and within the tolerance of the rest. "
             + "Give it the samples of a curve you have worked out yourself and it "
             + "hands back the curve, as one edge - which is what makes anything "
             + "built off it come out smooth rather than faceted. The tolerance "
             + "defaults to a hundred-thousandth of the run's own reach.",
      run: (points, closed, tolerance = 0) => smoothOf(points, closed === true, tolerance) },

    { name: "spline", takes: "points, closed, perSpan", gives: "shape",
      summary: "A smooth curve through a list of points - Catmull-Rom, parameterised "
             + "by index so it may double back on itself, sampled, and fitted back "
             + "to one B-spline edge. Raising perSpan makes the sampling finer, "
             + "which the fit follows; it does not add segments to the answer.",
      run: (list, closed, perSpan = 12) => {
        //! A REPEATED CONTROL POINT IS A CUSP, and it is dropped here for the
        //! same reason it is dropped in the kernel's Catmull-Rom: a span of no
        //! length carries no shape, and what it leaves behind is a point where
        //! the curve has no tangent - which nothing downstream can offset,
        //! fillet or sweep past.
        const points = list.filter((p, i) => i === 0
          || Math.hypot(p[0] - list[i - 1][0], p[1] - list[i - 1][1],
                        p[2] - list[i - 1][2]) > CONFUSION);
        const n = points.length;
        if (n < 3) throw new Error("a spline needs at least three points");
        const at = i => points[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
        const out = [];
        //! A CLOSED RUN IS SAMPLED HARDER, and the reason is the seam. The fit
        //! is not periodic - nothing here binds a periodic fitter - so where
        //! the loop comes back to its start the two ends are only as parallel
        //! as the samples either side of them make them. Measured: a loop of
        //! 60 samples closes with a 0.63-degree kink, 120 with 0.02, and 240
        //! with 0.004. So a closed run gets at least 120 samples, which costs
        //! milliseconds and buys a join nobody can see.
        const steps = closed ? Math.max(perSpan, Math.ceil(FIT_SEAM_SAMPLES / n)) : perSpan;
        for (let s = 0; s < (closed ? n : n - 1); s++) {
          const [a, b, c, d] = [at(s - 1), at(s), at(s + 1), at(s + 2)];
          for (let j = 0; j < steps; j++) {
            const u = j / steps;
            out.push([0, 1, 2].map(k => 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * u
              + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u * u
              + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u * u * u)));
          }
        }
        if (!closed) out.push(points[n - 1]);
        return smoothOf(out, closed, 0);
      } },

    { name: "fill", takes: "wire", gives: "shape",
      summary: "The face a closed wire bounds - planar when the wire is flat, and a "
             + "patch through it when it is not, so four warped corners off a loft "
             + "still make something you can see, thicken and measure. What makes a "
             + "drawing something a pad can be swept from.",
      run: wire => anyFaceOf(wire) },

    { name: "patch", takes: "wire", gives: "shape",
      summary: "The same, but never planar: a minimum-energy surface through the "
             + "boundary edges. Ask for this rather than fill when the boundary is "
             + "nearly flat and you want the curved answer anyway.",
      run: wire => patchOf(wire) },

    { name: "flatFill", takes: "wire", gives: "shape",
      summary: "The planar face a closed wire bounds, and an error when the wire is "
             + "not flat. The strict one, for when out-of-plane is a mistake worth "
             + "hearing about rather than something to work around.",
      run: wire => faceOf(wire) },

    { name: "fillWithHoles", takes: "outer, holes", gives: "shape",
      summary: "A planar face with holes in it. The holes may run either way round: "
             + "which way a wire runs is decided by the order somebody drew it in, "
             + "and it is sorted out here rather than assumed.",
      //! OPENCASCADE DECIDES WHAT AN ADDED WIRE MEANS BY ITS ORIENTATION.
      //! Running the same way as the outline it is a SECOND OUTLINE and the
      //! face comes back bigger; running against it, it is a hole. So
      //! reversing every hole - which is what this used to do - is right
      //! exactly half the time, and wrong silently: the face builds, it is
      //! just the wrong face.
      //!
      //! Measured on the sketch that brought this up. A hexagon with three
      //! rectangles inside it filled to 134,619,894 mm2 where the outline
      //! alone is 113,425,286: the three holes had been added, to the square
      //! millimetre, and the pad built from it was a solid hexagon with three
      //! solid blocks standing in it.
      //!
      //! ShapeFix_Face::FixOrientation needs no telling which wire is which -
      //! it works out the containment itself and turns each one to suit. The
      //! area is checked afterwards all the same, because a fix that made the
      //! face bigger has not fixed anything.
      run: (outer, holes) => {
        const list = (holes || []).filter(Boolean);
        const plain = faceOf(outer);
        if (!list.length) return plain;
        //! MEASURED BEFORE, AND ON ITS OWN FACE. ShapeFix_Face works on the
        //! face it was handed - Add puts the wire INTO it - so the outline
        //! asked afterwards is no longer the outline, and a guard that
        //! compared the two would be comparing a shape with itself. Its own
        //! copy goes in, and what the outline was is remembered first.
        const was = areaOf(plain);
        try {
          const fix = new oc.ShapeFix_Face(faceOf(outer));
          for (const hole of list) fix.Add(oc.TopoDS.Wire(hole));
          fix.FixOrientation();
          const made = fix.Face();
          if (made && !made.IsNull() && areaOf(made) < was + CONFUSION) return made;
        } catch (err) { /* the outline alone is the honest answer */ }
        return plain;
      } },

    { name: "parallelCurve", takes: "curve, distance, support, normal, join", gives: "shape",
      summary: "A curve offset from another. A flat curve needs nothing else and is "
             + "offset in its own plane; a curve lying on a surface is offset in that "
             + "surface, so it stays on it - which is exactly when CATIA asks for a "
             + "support and when it does not. `join` turns the corners: 0 rounds them "
             + "with an arc of the offset distance, 1 runs the two sides on until they "
             + "meet, 2 carries the tangent. `normal` is for the one shape that cannot "
             + "say which way is sideways: a single straight run lies in EVERY plane "
             + "through it.",
      run: (curve, distance, support, normal, join = 0) => {
        if (Math.abs(distance) < CONFUSION) return curve;
        const turn = joinType(join);
        // A sketch hands over everything drawn on it, which may be several
        // separate runs. Poured into one wire they make a broken one, and
        // OpenCascade answers a broken wire with "command not done" - so each
        // run is offset as itself and the results go back together.
        const wires = each(curve, WIRE, oc.TopoDS.Wire);
        const runs = wires.length ? wires : [wireOf(curve)];
        //! A curve that was never told which plane it is in is asked.
        const flatOf = wire => normal || planeOfWire(wire);
        const out = [];
        let rounded = 0, flipped = 0, strayed = 0;
        //! Whether the support turned out to be flat, for the note. Read once
        //! here rather than per run: one support, one answer.
        const flatWhole = support ? flatSupport(support) : null;
        for (const wire of runs) {
          // The third argument is isOpenResult, and it is the whole difference
          // between a parallel curve and a racetrack. Told an open spine is
          // closed, OpenCascade walks out along one side, round the end and
          // back along the other - which builds, and measures the same for
          // +50 as for -50, so nothing downstream would ever notice.
          const shut = closedWire(wire);
          const open = !shut;
          // The one run that cannot be offset by asking OpenCascade: a single
          // straight edge lies in every plane through it, so there is no side
          // to go to. Told which plane, the answer is a translation - which is
          // all an offset of a straight line ever was.
          const sideways = open && count(wire, EDGE) === 1 && straightRun(wire);
          if (sideways) {
            if (!normal) throw new Error(
              "a single straight segment lies in every plane through it, so there is "
              + "no one side to offset it to - draw another segment, or wire a plane "
              + "or a surface as its support");
            const across = V.norm(V.cross(normal, sideways));
            if (!across) throw new Error("that segment runs along its own support");
            out.push(shapeMoved(wire, V.scale(across, distance)));
            continue;
          }

          //! ASKED, THEN CHECKED, THEN ASKED AGAIN THE OTHER WAY.
          //!
          //! OpenCascade does not use one convention for which side a positive
          //! distance goes to. On a CLOSED wire it grows the loop, whichever
          //! way round the wire runs. On an OPEN one it goes to a side decided
          //! by the direction of travel - so a quarter arc of radius 100
          //! offset by +25 came back at radius 75, while a full circle of the
          //! same radius offset by the same +25 came back at 125. Both are
          //! defensible; together they are not a convention, and a setback
          //! that grows one curve and shrinks the next is not usable.
          //!
          //! So the rule is declared here and enforced by measurement: a
          //! closed loop GROWS on a positive distance, and an open run goes to
          //! the LEFT of the way it is drawn, seen from the support's normal.
          //! Build it, look at where it went, and if it went the other way
          //! build it again with the sign turned over. One extra solve on half
          //! the cases, and the number in the field means one thing.
          //! A SUPPORT MEANS A DIFFERENT ROAD ENTIRELY, not a different
          //! argument to the same call - see offsetInSurface for why. Unless
          //! the support is FLAT, in which case it is not a different road at
          //! all: see flatSupport.
          const level = support ? flatSupport(support) : null;
          if (support && !level) {
            const got = offsetInSurface(wire, distance, support);
            strayed = Math.max(strayed, got.worst);
            out.push(got.shape);
            continue;
          }
          const flat = level || flatOf(wire);
          const bare = made => !made || made.IsNull() || count(made, EDGE) === 0;

          //! BOTH SIGNS ARE ASKED FOR, AND THEN THE RIGHT ONE IS CHOSEN.
          //!
          //! OpenCascade does not use one convention for which side a positive
          //! distance goes to, so the convention is this program's and is
          //! enforced by measurement: build it, see which side it landed on,
          //! keep the one that landed where the sign said. That used to be
          //! done by building ONE and flipping if it was wrong - which works
          //! only as long as the first attempt lands SOMEWHERE. When it comes
          //! back empty it has landed nowhere, the side check has nothing to
          //! measure and reports "not wrong", and the other sign - the side
          //! that was asked for, and which exists - was never tried.
          //!
          //! Measured on an open four-segment polyline 3144.612 long. The way
          //! OpenCascade calls positive on this wire is the INWARD side, and
          //! inward it runs out past about 400: the inside of the turns is
          //! nearer than that, so the offset crosses itself and nothing comes
          //! back. Outward has no limit at all - at 831 it is 7069.16 long in
          //! seven edges, exactly as it should be. What came up on screen was
          //! "that curve cannot be offset by 831 - it turns tighter than that
          //! somewhere along it", which is true of the side nobody asked for
          //! and false of the side they did. And 200 worked, because there the
          //! wrong-side answer was merely wrong rather than absent.
          //!
          //! Two solves rather than one-and-sometimes-two. It is one extra
          //! offset on a curve somebody is looking at, and it is what lets the
          //! refusal below know whether the other side has room.
          const ahead = offsetOnce(wire, distance, turn, open);
          const astern = offsetOnce(wire, -distance, turn, open);
          //! Asked of BOTH with the requested `distance`, because the question
          //! is the same for both: is this shape on the side that sign means?
          const went = made => bare(made) ? 0 : sideRead(wire, made, distance, shut, flat);
          const aheadWent = went(ahead), asternWent = went(astern);
          //! READ AS RIGHT FIRST, UNREADABLE SECOND, READ AS WRONG NEVER. An
          //! offset whose side could not be measured is worth handing over -
          //! that is most of what a curve with no plane and no nearest point
          //! can give. One that WAS measured and came back on the other side
          //! is not: it is an answer to the opposite question, and passing it
          //! off as this one is how a -400 came back as the +400 curve, built,
          //! with nothing on it to say so.
          let answer = null;
          if (aheadWent > 0) answer = ahead;
          else if (asternWent > 0) { answer = astern; flipped++; }
          else if (aheadWent === 0 && !bare(ahead)) answer = ahead;
          else if (asternWent === 0 && !bare(astern)) { answer = astern; flipped++; }

          //! IT REFUSED, AND A REFUSAL IS THE ANSWER.
          //!
          //! There used to be a second road here: walk the curve, step
          //! sideways by the distance, fit a B-spline through the result. It
          //! is gone, and its going is the fix. A sampled offset is not a
          //! parallel curve - it is a curve that passes near where a parallel
          //! curve would be, with an error nobody chose and a shape that
          //! depends on the sampling. Worse, it took over from a perfectly
          //! good answer whenever the stray check fired, which at a concave
          //! corner it always does.
          //!
          //! What is here instead is OpenCascade's own planar offset, which is
          //! the 2D one: handed a planar wire, BRepOffsetAPI_MakeOffset drops
          //! to the wire's plane, offsets there, turns the corners and trims
          //! the crossings. Measured against the derived identities on every
          //! planar shape in the test suite - line, arc, ellipse, polyline,
          //! reflex polyline, line-arc-line, open spline, closed spline, in
          //! the XY plane and in one tilted 37 degrees and yawed 63 - the
          //! worst point is 0.0000 mm off the distance asked for. There is
          //! nothing for a sampled road to improve on.
          if (bare(answer)) {
            //! AND THE REFUSAL NAMES THE SIDE, because it is almost never both
            //! of them. An offset AWAY from a curve has no limit whatever the
            //! curve does; it is the offset INTO the bends that runs out, when
            //! the inside of a turn is nearer than the distance asked for. So
            //! when the other side did build, say so and give the number to
            //! type - which is the same number with its sign turned over.
            const roomOver = !bare(ahead) || !bare(astern);
            throw new Error(runs.length > 1
              ? "one of those " + runs.length + " runs will not offset by " + distance
              : !flat
                ? "that curve is not flat, so there is no plane to offset it in - "
                  + "wire the surface it lies on as its support"
                : roomOver
                  ? "that curve cannot be offset by " + distance + " on THAT side - the "
                    + "inside of a turn along it is nearer than " + Math.abs(distance)
                    + ", so the offset would cross itself. The other side has room: "
                    + "try " + (-distance)
                  : "that curve cannot be offset by " + distance
                    + " - it turns tighter than that somewhere along it, so there is no "
                    + "curve that stays that far from it. Try a smaller distance");
          }

          //! MEASURED AND REPORTED, NOT MEASURED AND SECOND-GUESSED - and only
          //! where the measure means anything, which is a run with no corners
          //! in it.
          //!
          //! "Every point of the answer is d from the source" is a property of
          //! a SMOOTH curve's offset. It is not a property of a corner's, and
          //! it is not meant to be: on the inside of a bend the offset is
          //! trimmed back to where the two sides cross, so the source points
          //! whose perpendicular lands in the trimmed-away part have no point
          //! of the answer d from them at all. The nearest is the mitre, and
          //! the mitre is further.
          //!
          //! Measured on the centreline of the reference drawing - five
          //! segments, four corners - offset inward: the answer's vertices sit
          //! on the ones drawn in other software to four decimal places, and
          //! this measure called it "36.3022 mm off the distance asked for".
          //! Both numbers are right. Only one of them is about the offset.
          //!
          //! So it is asked of a single edge and of nothing else. That is the
          //! fitted spline, the arc, the interpolated curve - everything whose
          //! offset really does hold one distance all the way along, and the
          //! only place a number here is worth printing.
          if (count(wire, EDGE) === 1)
            strayed = Math.max(strayed, strayOf(wire, answer, distance));

          //! A KNOT IS NOT AN OFFSET. MakeOffset trims the crossings it
          //! finds, but a curve that folds over itself hard enough can still
          //! come back with a loop tied in it, and the length bound catches
          //! that where nothing else does.
          if (knotted(wire, answer, distance))
            throw new Error("that curve turns tighter than " + Math.abs(distance)
              + " somewhere along it, so its offset crosses itself - what comes back is "
              + Math.round(lengthOf(answer)) + " mm long where the curve is "
              + Math.round(lengthOf(wire)) + ". Try a smaller distance");
          if (shut) rounded++;
          out.push(answer);
        }
        const trim = v => Math.round(v * 1e4) / 1e4;
        return {
          shape: out.length === 1 ? out[0] : compoundOf(out),
          note: [
            runs.length + (runs.length === 1 ? " run" : " runs"),
            rounded ? (rounded === runs.length ? "closed" : rounded + " of them closed")
                    : "open",
            support && !flatWhole ? "offset within its support"
                                  : JOINS[join].toLowerCase() + " corners",
            //! SAID BECAUSE IT IS APPROXIMATE. The in-surface road samples and
            //! projects, so the distance can come out slightly short where the
            //! surface curves across it. A number nobody can see is still a
            //! number somebody may need.
            //! Reported at one per cent of the distance and not at a ten
            //! thousandth: below that it is the fit's own residue and saying
            //! it on every note teaches nobody anything. Above it, it is worth
            //! knowing - a 40 mm setback that runs to 46 somewhere along a
            //! trimmed corner is a real 46, and the person laying it out would
            //! rather be told.
            strayed > Math.max(1e-3, Math.abs(distance) * 0.01)
              ? "the worst point is " + trim(strayed) + " mm off the distance asked for"
              : "",
          ].filter(Boolean).join(" \u00b7 "),
        };
      } },


    { name: "offsetSurface", takes: "surface, distance", gives: "shape",
      summary: "A surface moved a distance along its own normal - still a skin, not a "
             + "body. What a thickness is measured from when it grows both ways.",
      run: (surface, distance) => offsetSurfaceOf(surface, distance) },

    { name: "project", takes: "points, onto", gives: "points",
      summary: "Points pulled onto the nearest place on a shape. Sampling, not an "
             + "exact projection - this build carries no BRepProj_Projection - but "
             + "the nearest point is exact at every sample.",
      run: (points, onto) => points.map(p => {
        const gap = new oc.BRepExtrema_DistShapeShape();
        gap.LoadS1(new oc.BRepBuilderAPI_MakeVertex(pnt(p)).Shape());
        gap.LoadS2(onto);
        gap.Perform();
        if (!gap.IsDone() || gap.NbSolution() < 1) return p;
        const q = gap.PointOnShape2(1);
        return [q.X(), q.Y(), q.Z()];
      }) },


    /* ------------------------------------------------ hidden-line removal

       THE OPERATION A DRAWING IS MADE OF, and the one thing in this program
       that cannot be approximated. A drawing is not a render with the colours
       removed: it is the model's edges sorted into what you can see, what is
       behind something, what is only a silhouette and what is a smooth crease,
       and the sorting IS the drawing. Do it by rendering and reading pixels
       back and you get an image; do it in the geometry and you get lines you
       can dimension, select, and send to a plotter.

       OpenCascade's HLR does it exactly, in the B-Rep, which is why it is slow
       and why it is worth it. It is handed the bodies and an eye position, and
       gives back compounds of 2D edges lying on z = 0 in the eye's own frame -
       so the flattening is already done and u and v are simply x and y.     */

    { name: "projectHidden",
      takes: "shapes, origin, look, up, { curved, tolerance }",
      gives: "{ sharp, outline, smooth, sharpHidden, outlineHidden, smoothHidden }, "
           + "each a list of polylines in the view plane's own u-v",
      summary: "Hidden-line removal: the bodies as they would be DRAWN from a given "
             + "direction, with every line classified. Seen edges, silhouettes of "
             + "curved surfaces, smooth creases, and the same three again for what is "
             + "behind something else. Exact, in the geometry - not read back off a "
             + "picture - so what comes out can be dimensioned and plotted.",
      run: (shapes, origin, look, up, opts = {}) => {
        const list = (Array.isArray(shapes) ? shapes : [shapes]).filter(Boolean);
        const empty = { sharp: [], outline: [], smooth: [],
                        sharpHidden: [], outlineHidden: [], smoothHidden: [] };
        if (!list.length) return empty;
        //! The frame's z points AT the eye, which is the opposite of the way
        //! you are looking - see viewFrame, which works the same sign out for
        //! the same reason. The two have to agree or the drawing the kernel
        //! makes and the plane the page puts it on are mirror images.
        const { x, z } = viewAxes(look, up);
        const at = origin || [0, 0, 0];

        const eye = new oc.gp_Ax2(pnt(at), dir(z), dir(x));
        const algo = new oc.HLRBRep_Algo();
        //! The second argument is the "nb iso" - isoparametric lines drawn
        //! across a curved face. Zero, because isos are a shading convention
        //! from before shading, and on a building they are a grey mess.
        for (const one of list) algo.Add(one, 0);
        algo.Projector(new oc.HLRAlgo_Projector(eye));
        algo.Update();
        //! HIDING IS THE EXPENSIVE HALF and the half that makes it a drawing.
        //! Without it every edge comes back visible and a solid reads as a
        //! wireframe of itself.
        algo.Hide();
        const to = new oc.HLRBRep_HLRToShape(algo);

        //! Straight edges get their two ends and nothing between; everything
        //! else is sampled. A curve's sample count is its length over the
        //! tolerance, capped - a 90 m viaduct arris at a tenth of a millimetre
        //! would be nine hundred thousand points nobody can see.
        const tol = Math.max(1e-6, opts.tolerance || 0.05);
        const curved = Math.max(4, Math.min(400, Math.round(opts.curved || 48)));
        const runsOf = compound => {
          const out = [];
          if (!compound || compound.IsNull()) return out;
          const walk = new oc.TopExp_Explorer(compound, EDGE, ANY);
          while (walk.More()) {
            try {
              const edge = oc.TopoDS.Edge(walk.Current());
              const adaptor = new oc.BRepAdaptor_Curve(edge);
              const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
              const straight = String(adaptor.GetType()) === "GeomAbs_Line";
              const steps = straight ? 1 : curved;
              const run = [];
              for (let i = 0; i <= steps; i++) {
                const p = adaptor.Value(first + (last - first) * (i / steps));
                //! z is dropped, not checked: every point HLR returns lies on
                //! the projection plane by construction, and keeping a
                //! coordinate that is always zero would only invite something
                //! downstream to believe it.
                const uv = [p.X(), p.Y()];
                const had = run[run.length - 1];
                if (!had || Math.hypot(uv[0] - had[0], uv[1] - had[1]) > tol) run.push(uv);
              }
              if (run.length >= 2) out.push(run);
            } catch (err) { /* an edge that will not sample is an edge left out */ }
            walk.Next();
          }
          walk.delete();
          return out;
        };
        const ask = name => {
          try { return runsOf(to[name]()); } catch (err) { return []; }
        };
        return {
          sharp: ask("VCompound"),
          outline: ask("OutLineVCompound"),
          smooth: [...ask("Rg1LineVCompound"), ...ask("RgNLineVCompound")],
          sharpHidden: ask("HCompound"),
          outlineHidden: ask("OutLineHCompound"),
          smoothHidden: [...ask("Rg1LineHCompound"), ...ask("RgNLineHCompound")],
        };
      } },

    /* ------------------------------------------------------- the cut face

       WHAT THE PLANE PASSED THROUGH, as closed loops on the sheet. Not the
       same question as "where do these two surfaces cross": a section curve is
       a line, and what poche needs is a REGION - the loop that bounds solid
       material - because that is what gets filled.

       Taken off the trimmed solid rather than computed: after a body has been
       trimmed at the plane, the faces that lie IN the plane are the cut, and
       their outer wires are the loops. Exact, already closed, and right for a
       body with a hole in it, which an intersection curve is not.           */

    { name: "cutLoops", takes: "shapes, origin, normal, look, up, { tolerance }",
      gives: "loops, each a closed polyline in the VIEW's own u-v",
      summary: "The closed regions where a cutting plane passed through solid "
             + "material - what poche fills. Read off the faces of the trimmed body "
             + "that lie in the plane, so a body with a void in it gives the void "
             + "back as its own loop rather than filling it in. Flattened in the "
             + "view's axes, not the plane's, so the fill lands under the lines.",
      //! TWO DIRECTIONS AND THEY ARE NOT THE SAME ONE. \p normal says which
      //! plane counts as the cut; \p look says which way the sheet is faced.
      //! They agree for a plan and a section and disagree the moment somebody
      //! asks for an axonometric of a cut - and flattening by the plane's own
      //! axes rather than the view's turned the poche a quarter turn out of
      //! register with the lines drawn round it.
      run: (shapes, origin, normal, look, up, opts = {}) => {
        const list = (Array.isArray(shapes) ? shapes : [shapes]).filter(Boolean);
        const n = V.norm(normal) || [0, 0, 1];
        const at = origin || [0, 0, 0];
        const { x, y } = viewAxes(look || V.scale(n, -1), up);
        const flat = p => [V.dot(V.sub(p, at), x), V.dot(V.sub(p, at), y)];
        const tol = Math.max(1e-6, opts.tolerance || 0.05);
        const out = [];
        for (const one of list) {
          const faces = new oc.TopExp_Explorer(one, FACE, ANY);
          while (faces.More()) {
            try {
              const face = oc.TopoDS.Face(faces.Current());
              const surface = new oc.BRepAdaptor_Surface(face);
              //! Only planes, and only THIS plane. A cylinder's face is never
              //! the cut however close it lies, and a parallel plane fifty
              //! millimetres away is a different storey.
              if (String(surface.GetType()) === "GeomAbs_Plane") {
                const pln = surface.Plane();
                const ax = pln.Axis();
                const d = ax.Direction(), o = ax.Location();
                const facing = Math.abs(V.dot([d.X(), d.Y(), d.Z()], n));
                const offset = Math.abs(V.dot(V.sub([o.X(), o.Y(), o.Z()], at), n));
                if (facing > 0.999 && offset < tol * 20) {
                  for (const wire of each(face, WIRE, s => oc.TopoDS.Wire(s))) {
                    //! EACH EDGE ON ITS OWN, THEN CHAINED. A wire's edges come
                    //! out of the explorer in the order they were built, not
                    //! the order they join - and a loop whose points are in
                    //! build order is a bow tie. It fills as one too, which is
                    //! how a poche of half the right area looked like a poche
                    //! rather than like a bug. This build has no
                    //! BRepTools_WireExplorer to ask for the right order, so
                    //! the ends are matched here.
                    const pieces = [];
                    for (const edge of each(wire, EDGE, s => oc.TopoDS.Edge(s))) {
                      const adaptor = new oc.BRepAdaptor_Curve(edge);
                      const a = adaptor.FirstParameter(), b = adaptor.LastParameter();
                      const straight = String(adaptor.GetType()) === "GeomAbs_Line";
                      const steps = straight ? 1 : 32;
                      const piece = [];
                      for (let i = 0; i <= steps; i++) {
                        const p = adaptor.Value(a + (b - a) * (i / steps));
                        const uv = flat([p.X(), p.Y(), p.Z()]);
                        const had = piece[piece.length - 1];
                        if (!had || Math.hypot(uv[0] - had[0], uv[1] - had[1]) > tol) piece.push(uv);
                      }
                      if (piece.length >= 2) pieces.push(piece);
                    }
                    for (const run of chainRuns(pieces, tol * 4))
                      if (run.length >= 3) out.push(run);
                  }
                }
              }
            } catch (err) { /* a face that will not read is a face left out */ }
            faces.Next();
          }
          faces.delete();
        }
        return out;
      } },

    { name: "intersect", takes: "a, b", gives: "shape",
      summary: "Where two shapes cross, as wireframe: the section curve of two "
             + "surfaces, the point where two curves meet.",
      //! \p plane, when one of the two IS a plane, is that plane UNBOUNDED.
      //!
      //! A datum plane is drawn as a square because a plane has to be drawn as
      //! something, and its size is display only - the catalogue calls it
      //! "Display size" and it drives no geometry. It drove this. Sectioning a
      //! 400 mm cube against a plane drawn 200 mm across gave "those two do
      //! not cross anywhere", because the little square is entirely inside the
      //! cube and never touches its surface; the same plane drawn 400 across
      //! gave the four edges anybody would expect. A plane is infinite or it
      //! is not a plane, so the driver hands the plane over as itself and the
      //! square is left to the viewport.
      run: (a, b, plane = null) => {
        const section = plane
          ? new oc.BRepAlgoAPI_Section(plane.on, new oc.gp_Pln(new oc.gp_Ax3(plane.ax)), false)
          : new oc.BRepAlgoAPI_Section(a, b, false);
        section.ComputePCurveOn1(false);
        section.Approximation(true);
        section.Build();
        if (!section.IsDone()) throw new Error("those two will not intersect");
        const shape = section.Shape();
        if (count(shape, EDGE) === 0 && verticesOf(shape).length === 0)
          throw new Error("those two do not cross anywhere");
        return shape;
      } },

    /* --------------------------------------------------------- surfaces */
    { name: "extrude", takes: "profile, along", gives: "shape",
      summary: "A surface swept from a wire along a direction. The hybrid half of "
             + "extruding: a skin, not a body. For a body, pad it.",
      run: (profile, along) => {
        if (V.length(along) < CONFUSION) throw new Error("the sweep has no length");
        return new oc.BRepPrimAPI_MakePrism(profile,
          new oc.gp_Vec(along[0], along[1], along[2])).Shape();
      } },

    //! A SURFACE OF REVOLUTION, which is the one classical sweep this had no
    //! road to at all. Everything turned about an axis - a dome, a dish, a
    //! baluster, a tank end, and in a building model every IfcRevolvedAreaSolid
    //! - was out of reach, and the only way to it was a loft through sections
    //! somebody placed by hand.
    //!
    //! A closed profile gives a solid and an open one gives a skin, exactly as
    //! a pad does, because that is what OpenCascade's MakeRevol does with each
    //! and it is the right answer for both.
    { name: "revolve", takes: "profile, at, along, angle", gives: "shape",
      summary: "A profile turned about an axis. The angle is in degrees; 360 closes "
             + "it into a full body of revolution. The axis is a point and a "
             + "direction, and the profile must not cross it - a section that "
             + "straddles its own axis has no revolution.",
      run: (profile, at, along, angle) => {
        const way = V.norm(along);
        if (!way) throw new Error("the axis has no direction");
        const turn = Math.abs(angle) < CONFUSION ? 360 : angle;
        const axis = new oc.gp_Ax1(pnt(at), dir(way));
        const maker = new oc.BRepPrimAPI_MakeRevol(profile, axis,
                                                   turn * Math.PI / 180, false);
        if (!maker.IsDone()) throw new Error("that profile cannot be turned about that axis");
        return maker.Shape();
      } },

    { name: "sweep1", takes: "profile, spine, into", gives: "shape",
      summary: "A profile swept along one rail, as a skin. The section turns to stay "
             + "square to the rail the whole way, so a rail that bends carries the "
             + "section round with it rather than dragging it through sideways. Give "
             + "it a second profile and the section MORPHS into that one along the "
             + "rail, which is how a duct goes from round to square. For a body "
             + "rather than a skin, the solid factory ribs along the same rail.",
      run: (profile, spine, into = null) => {
        const rail = wireOf(spine);
        if (into) return pipeAlong(wireOf(profile), rail, false, wireOf(into));
        const skins = regionsOf(profile).flatMap(region =>
          [region.outer, ...region.holes].map(wire => pipeAlong(wire, rail, false)));
        return skins.length === 1 ? skins[0] : compoundOf(skins);
      } },

    { name: "loft", takes: "sections, ruled", gives: "shape",
      summary: "A skin through section curves, in the order they are given. Ruled "
             + "runs straight between them; smooth passes through. For a body rather "
             + "than a skin, the solid factory lofts too.",
      run: (sections, ruled = false) => thruSections(sections, ruled, false) },

    /* ------------------------------------------------------- assembling */
    { name: "join", takes: "shapes", gives: "shape",
      summary: "Several shapes gathered as one, compounded rather than fused. The "
             + "group of a node editor: what goes downstream as a single thing.",
      run: shapes => compoundOf(shapes) },
  ];

  /* ========================================================= ShapeFactory */

  const shapeTable = [
    { name: "box", takes: "plane, dx, dy, dz", gives: "solid",
      summary: "A box from a corner, oriented by a plane.",
      run: (plane, dx, dy, dz) => new oc.BRepPrimAPI_MakeBox(plane,
        positive(dx, "box width"), positive(dy, "box depth"),
        positive(dz, "box height")).Shape() },

    { name: "boxAt", takes: "corner, dx, dy, dz", gives: "solid",
      summary: "An upright box from a corner, square to the world. What a room in a "
             + "massing study is, and what anything else that is laid out on a plan and "
             + "given a height is - so the caller does not have to build a placement to "
             + "say the one thing every one of them says.",
      run: (corner, dx, dy, dz) => new oc.BRepPrimAPI_MakeBox(
        new oc.gp_Ax2(new oc.gp_Pnt(corner[0], corner[1], corner[2]),
                      new oc.gp_Dir(0, 0, 1), new oc.gp_Dir(1, 0, 0)),
        positive(dx, "box width"), positive(dy, "box depth"),
        positive(dz, "box height")).Shape() },

    { name: "cylinder", takes: "plane, radius, height, degrees", gives: "solid",
      summary: "A full cylinder, or a pie slice when an angle is given.",
      run: (plane, radius, height, degrees) => {
        const r = positive(radius, "cylinder radius");
        const h = positive(height, "cylinder height");
        return degrees === undefined
          ? new oc.BRepPrimAPI_MakeCylinder(plane, r, h).Shape()
          : new oc.BRepPrimAPI_MakeCylinder(plane, r, h,
              positive(degrees, "angle") * Math.PI / 180).Shape();
      } },

    { name: "sphere", takes: "plane, radius", gives: "solid",
      summary: "A sphere at a point.",
      run: (plane, radius) => new oc.BRepPrimAPI_MakeSphere(plane,
        positive(radius, "sphere radius")).Shape() },

    { name: "pad", takes: "profile, along", gives: "solid",
      summary: "A body swept from a face along a direction - the solid half of "
             + "extruding. Every face the profile offers is padded, so a sketch of "
             + "six closed loops pads into six bodies rather than the first.",
      run: (profile, along) => {
        if (V.length(along) < CONFUSION) throw new Error("the pad has no depth");
        const vector = new oc.gp_Vec(along[0], along[1], along[2]);
        const faces = each(profile, FACE, oc.TopoDS.Face);
        if (!faces.length) throw new Error("there is no face to pad");
        const swept = faces.map(face => new oc.BRepPrimAPI_MakePrism(face, vector).Shape());
        return swept.length === 1 ? swept[0] : compoundOf(swept);
      } },

    { name: "add", takes: "a, b", gives: "solid",
      summary: "Two bodies fused into one. CATIA calls it Add; it is the union.",
      run: (a, b) => {
        const made = new oc.BRepAlgoAPI_Fuse(a, b, new oc.Message_ProgressRange());
        made.Build(new oc.Message_ProgressRange());
        if (!made.IsDone()) throw new Error("those two will not add together");
        return made.Shape();
      } },

    { name: "remove", takes: "a, b", gives: "solid",
      summary: "The second body taken out of the first. CATIA calls it Remove. If it "
             + "ever appears to do nothing, measure it: a self-intersecting argument "
             + "is answered by handing back what it was given, with no error.",
      run: (a, b) => {
        const made = new oc.BRepAlgoAPI_Cut(a, b, new oc.Message_ProgressRange());
        made.Build(new oc.Message_ProgressRange());
        if (!made.IsDone()) throw new Error("that will not cut");
        return made.Shape();
      } },

    { name: "intersect", takes: "a, b", gives: "solid",
      summary: "What two bodies have in common.",
      run: (a, b) => {
        const made = new oc.BRepAlgoAPI_Common(a, b, new oc.Message_ProgressRange());
        made.Build(new oc.Message_ProgressRange());
        if (!made.IsDone()) throw new Error("those two do not overlap");
        return made.Shape();
      } },

    { name: "thickness", takes: "surface, thickness, both", gives: "solid",
      summary: "A surface given a thickness, so a skin becomes a body. Thickening is "
             + "not offsetting: an offset surface is another skin, and it is "
             + "MakeThickSolid that closes the two skins into something with a volume. "
             + "Both sides moves the surface back half the thickness first, so the "
             + "surface ends up down the middle of what it made. Which side a "
             + "one-sided thickness grows towards is the surface's own normal; the "
             + "sign of the thickness is how you say the other one.",
      run: (surface, thickness, both = false) => {
        const t = Math.abs(thickness);
        if (t < CONFUSION) throw new Error("the thickness must not be zero");
        const from = both ? offsetSurfaceOf(surface, -t / 2 * Math.sign(thickness || 1))
                          : surface;
        const made = new oc.BRepOffsetAPI_MakeThickSolid();
        made.MakeThickSolidBySimple(from, thickness < 0 ? -t : t);
        if (!made.IsDone()) throw new Error("that surface will not thicken");
        const shape = made.Shape();
        if (!shape || shape.IsNull() || count(shape, SOLID) === 0)
          throw new Error("thickening that surface by " + thickness + " leaves no body");
        return rightWayOut(shape);
      } },

    { name: "draft", takes: "solid, faces, neutral, direction, degrees", gives: "solid",
      summary: "Faces leaned over by an angle about where they meet a neutral face - "
             + "what makes a moulded part come out of its mould.",
      run: (solid, faces, neutral, direction, degrees) => {
        const made = new oc.BRepOffsetAPI_DraftAngle(solid);
        const pull = V.norm(direction);
        if (!pull) throw new Error("a direction is needed to draft along");
        let any = false;
        for (const face of faces) {
          made.Add(face, dir(pull), degrees * Math.PI / 180,
                   new oc.gp_Pln(new oc.gp_Ax3(neutral)));
          if (!made.AddDone()) { made.Remove(face); continue; }
          any = true;
        }
        if (!any) throw new Error("none of those faces can take that draft");
        made.Build();
        if (!made.IsDone()) throw new Error("that draft will not build");
        return made.Shape();
      } },

    { name: "rib", takes: "profile, spine, into", gives: "solid",
      summary: "A closed profile swept along one rail into a body - CATIA calls it a "
             + "Rib. A handrail, a gutter, a moulding, a road. A profile with a hole "
             + "in it sweeps into a body with a bore, rather than into two bodies one "
             + "inside the other.",
      run: (profile, spine, into = null) => {
        const rail = wireOf(spine);
        // A section that becomes another one along the rail is one body, not
        // a region at a time: the two profiles are the two ends of one pipe.
        if (into) return pipeAlong(wireOf(profile), rail, true, wireOf(into));
        const bodies = regionsOf(profile).map(region => {
          const body = pipeAlong(region.outer, rail, true);
          if (!region.holes.length) return body;
          // A hole in the section is a bore along the whole sweep, which is
          // the bore swept and taken out - not a second tube left inside.
          return region.holes.reduce((solid, hole) => {
            const bore = pipeAlong(hole, rail, true);
            const cut = new oc.BRepAlgoAPI_Cut(solid, bore, new oc.Message_ProgressRange());
            cut.Build(new oc.Message_ProgressRange());
            return cut.IsDone() ? cut.Shape() : solid;
          }, body);
        });
        return bodies.length === 1 ? bodies[0] : compoundOf(bodies);
      } },

    { name: "loft", takes: "sections, ruled", gives: "solid",
      summary: "A body through section curves - the closed loft. The sections are "
             + "capped, so it comes out solid rather than as a tube.",
      run: (sections, ruled = false) => thruSections(sections, ruled, true) },

    { name: "fillet", takes: "solid, radius", gives: "solid",
      summary: "Every edge of a body rounded to a radius. The radius is checked "
             + "against the body first: on an 80 mm cube the solver answers r = 39.9 "
             + "with IsDone() true, r = 40 with false and r = 60 with true again, so "
             + "asking it whether the radius fits is not a way of finding out.",
      run: (solid, radius) => {
        const r = positive(radius, "fillet radius");
        const smallest = smallestSolidExtent(solid);
        if (Number.isFinite(smallest) && r >= smallest / 2)
          throw new Error("a " + r + " mm fillet does not fit a body only "
                        + Math.round(smallest * 10) / 10 + " mm across");
        const made = new oc.BRepFilletAPI_MakeFillet(solid,
          oc.ChFi3d_FilletShape.ChFi3d_Rational);
        let any = false;
        for (const edge of each(solid, EDGE, oc.TopoDS.Edge)) { made.Add(r, edge); any = true; }
        if (!any) throw new Error("that body has no edges to round");
        made.Build(new oc.Message_ProgressRange());
        if (!made.IsDone()) throw new Error("the fillet did not converge at " + r + " mm");
        const shape = made.Shape();
        if (!shape || shape.IsNull() || count(shape, FACE) === 0)
          throw new Error("the fillet produced an empty shape at " + r + " mm");
        return shape;
      } },

    { name: "move", takes: "shape, by", gives: "shape",
      summary: "A shape somewhere else. The same shape under a different location, "
             + "so a hundred copies cost a matrix each rather than a rebuild.",
      run: (shape, by) => shapeMoved(shape, by) },

    { name: "rotate", takes: "shape, at, axis, degrees", gives: "shape",
      summary: "A shape turned about an axis through a point.",
      run: (shape, at, axis, degrees) => {
        const turn = new oc.gp_Trsf();
        turn.SetRotation(new oc.gp_Ax1(pnt(at), dir(V.norm(axis) || [0, 0, 1])),
                         degrees * Math.PI / 180);
        return shape.Moved(new oc.TopLoc_Location(turn));
      } },

    { name: "assemble", takes: "shapes", gives: "shape",
      summary: "Bodies gathered without being fused - a part with several bodies in "
             + "it, which is what a Part is.",
      run: shapes => compoundOf(shapes) },
  ];

  const hybrid = assemble(hybridTable, "HybridShapeFactory");
  const shape = assemble(shapeTable, "ShapeFactory");
  return { hybrid, shape };
}

//! What the kernel publishes about itself, beside its catalogue of nodes: the
//! two factories and what each of them can do. A node's driver is one call into
//! one of these, so knowing the factories is knowing what a node could be built
//! from - which is why the assistant is shown both.
export function factorySchema(factories) {
  return {
    format: "ocaf-geometry-api", version: 1,
    summary: "Two factories, split the way CATIA splits them: everything that is not "
           + "a solid is hybrid, everything that is, is not. A node's driver reads its "
           + "arguments off the document and makes one call into one of these.",
    factories: [
      { name: factories.hybrid.$kind, makes: "wireframe and surfaces",
        operations: factories.hybrid.$manifest },
      { name: factories.shape.$kind, makes: "solids, and operations between bodies",
        operations: factories.shape.$manifest },
    ],
  };
}
