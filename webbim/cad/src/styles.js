// What the model looks like.
//
// Two separate things live here, because they are two halves of one question.
//
// A MATERIAL is a property of an object: this bracket is brass, that slab is
// concrete. It is held on the feature, travels in the model file, and is the
// same fact whichever window is looking - the modelling view and the showroom
// read it from the same table.
//
// A VIEW STYLE is a property of the WINDOW: how the whole model is drawn at
// this moment. Shaded is for modelling and says nothing about materials.
// Rendered obeys them. Arctic ignores them on purpose - everything is the same
// white clay, lit by nothing but its own shape, so what you are looking at is
// the FORM and not the paint. That is what Rhino's Arctic is for and what
// Enscape's white mode is for, and the reason both of them draw a black line
// along every sharp edge: without it a white model against a white background
// loses its corners.
//
// The arctic pass is written here rather than in the app because it is a
// renderer, not an interface: four passes, two render targets and about a
// hundred lines of GLSL, and none of it knows what a feature is.

/* ------------------------------------------------------------- materials */

//! The material library. A finish is a name for a set of numbers a person
//! recognises - "brass" rather than metalness 1, gloss 0.8 - and it is the
//! whole of what most objects need. Anything more particular is an override
//! on top of one, which is how Rhino's material properties work: pick the
//! closest thing, then move the sliders.
export const FINISHES = [
  // What everything is until somebody says otherwise. A material a person has
  // not chosen should look like a part, not like chrome - and every sample in
  // this document that asks for a finish nobody ever wrote lands here too.
  { key: "default",  label: "Default",        color: [0.58, 0.63, 0.67], metalness: 0.12, gloss: 0.45 },
  { key: "aluminium",label: "Aluminium",      color: [0.80, 0.82, 0.84], metalness: 1,    gloss: 0.55 },
  { key: "steel",    label: "Brushed steel",  color: [0.62, 0.65, 0.68], metalness: 1,    gloss: 0.62 },
  { key: "chrome",   label: "Chrome",         color: [0.88, 0.90, 0.93], metalness: 1,    gloss: 0.96 },
  { key: "brass",    label: "Brass",          color: [0.83, 0.66, 0.31], metalness: 1,    gloss: 0.80 },
  { key: "anodised", label: "Anodised black", color: [0.09, 0.10, 0.11], metalness: 0.85, gloss: 0.45 },
  { key: "paint",    label: "Gloss paint",    color: [0.16, 0.42, 0.66], metalness: 0.05, gloss: 0.92 },
  { key: "matte",    label: "Matte white",    color: [0.90, 0.90, 0.89], metalness: 0.02, gloss: 0.22 },
  { key: "oak",      label: "Oak",            color: [0.71, 0.53, 0.31], metalness: 0,    gloss: 0.35 },
  { key: "concrete", label: "Concrete",       color: [0.60, 0.59, 0.56], metalness: 0,    gloss: 0.12 },
  { key: "glass",    label: "Glass",          color: [0.78, 0.86, 0.90], metalness: 0.02, gloss: 0.98,
    opacity: 0.22 },
];

export const findFinish = key => FINISHES.find(f => f.key === key) || FINISHES[0];

//! HOW A POINT IS DRAWN.
//!
//! A point has no triangles and no edges, so it is drawn as a MARK - and a
//! mark is a choice, the way a line weight is. A construction point wants to
//! be a small cross that stays out of the way; a point somebody is about to
//! grab wants to be a filled dot; a point standing for a fixing wants to be a
//! ring you can see the model through. Every drafting program has had this
//! list since before there were screens to draw it on, and it is the same
//! list because it is the right one.
//!
//! The key is what is stored on the feature, so it survives the file and does
//! not depend on the order of this array.
export const POINT_MARKS = [
  { key: "dot",    label: "Dot",    summary: "a filled disc - the default, and the easiest to hit" },
  { key: "square", label: "Square", summary: "a filled square, which reads as \"placed\" rather than \"found\"" },
  { key: "cross",  label: "Cross",  summary: "an X, for a point that marks a spot without covering it" },
  { key: "ring",   label: "Ring",   summary: "a circle you can see the model through" },
  { key: "plus",   label: "Plus",   summary: "a + , which reads as a coordinate rather than a thing" },
];
export const findMark = key => POINT_MARKS.find(m => m.key === key) || POINT_MARKS[0];

//! And how heavy. The same idea as a line weight and the same three names,
//! because a drawing where the points are one weight and the lines are
//! another is a drawing that reads as two drawings.
export const POINT_WEIGHTS = [
  { key: "fine",   label: "Fine",   size: 5,  pen: 1.2 },
  { key: "medium", label: "Medium", size: 8,  pen: 1.8 },
  { key: "heavy",  label: "Heavy",  size: 12, pen: 2.6 },
];
export const findWeight = key => POINT_WEIGHTS.find(w => w.key === key) || POINT_WEIGHTS[1];

//! What an object is actually made of: the finish it names, with whatever it
//! says for itself on top. One answer, in one shape, for every renderer -
//! because "the showroom shows brass and the viewport shows grey" is not two
//! opinions about a material, it is a bug.
//!
//! Gloss and roughness are the same number said two ways round. Both are here
//! because the two renderers ask for different ones, and converting it twice
//! in two places is how they drift apart.
export function materialOf(appearance) {
  const finish = findFinish(appearance && appearance.finish);
  const own = appearance || {};
  const number = (value, fallback) => (typeof value === "number" ? value : fallback);
  const gloss = Math.min(1, Math.max(0, number(own.gloss, finish.gloss)));
  return {
    finish: finish.key,
    label: finish.label,
    color: Array.isArray(own.color) && own.color.length === 3 ? own.color : finish.color,
    metalness: Math.min(1, Math.max(0, number(own.metalness, finish.metalness))),
    gloss,
    roughness: Math.min(1, Math.max(0.02, 1 - gloss)),
    opacity: Math.min(1, Math.max(0.02, number(own.opacity, number(finish.opacity, 1)))),
  };
}

//! The same, as the record that is written into the document. Only what
//! differs from the finish is kept, so a model file says "brass" rather than
//! four numbers that happen to be brass - and a finish whose numbers are
//! changed later changes everything wearing it.
export function appearanceOf(finishKey, overrides = {}) {
  const finish = findFinish(finishKey);
  const out = { finish: finish.key, color: finish.color };
  for (const key of ["color", "metalness", "gloss", "opacity"]) {
    const value = overrides[key];
    if (value === undefined || value === null) continue;
    const same = key === "color"
      ? Array.isArray(value) && value.every((v, i) => Math.abs(v - finish.color[i]) < 1e-3)
      : Math.abs(value - (key === "opacity" ? (finish.opacity || 1) : finish[key])) < 1e-3;
    if (same && key !== "color") delete out[key];
    else out[key] = value;
  }
  return out;
}

//! #rrggbb from the 0..1 triple the document holds, and back. The document
//! keeps linear-ish triples because that is what both renderers take; a colour
//! input is hex because that is what a person is given.
export const hexOf = rgb =>
  "#" + rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16).padStart(2, "0")).join("");
export const rgbOf = hex => {
  const clean = String(hex || "").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return Number.isFinite(n) && full.length === 6
    ? [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] : [0.5, 0.5, 0.5];
};

/* ----------------------------------------------------------- view styles */

//! The three ways of looking, and what each one is FOR. The flags are read by
//! the viewport rather than interpreted: a style is a row in this table and
//! adding a fourth is adding a row.
export const VIEW_STYLES = [
  //! COLOUR, BUT NOT FINISH.
  //!
  //! Shaded drew one neutral grey on everything, on the reasoning that a
  //! modelling view is about form and a material is about appearance. That is
  //! right about brass and chrome and glass - a modelling view has no business
  //! putting a mirror in front of you - and wrong about COLOUR, which is how
  //! anybody tells a beam from a column from a slab at a glance. A building
  //! imported from IFC is six thousand grey extrusions without it.
  //!
  //! So the colour is obeyed and the finish is not: no metal, no gloss, no
  //! reflections, the same flat modelling light on everything, and the tangent
  //! edges still drawn. What you lose is the shine; what you gain is knowing
  //! what you are looking at.
  { key: "shaded", label: "Shaded",
    summary: "For modelling. Each body in its own colour on a flat modelling light, "
           + "tangent edges drawn, datums and the grid where you left them.",
    materials: false, colours: true, edges: true, datums: true, ground: true, clay: null },
  { key: "rendered", label: "Rendered",
    summary: "What things are made of. Every body wears its own material, lit by a "
           + "sky and a floor; no tangent edges, because a rendered view has no "
           + "wireframe in it.",
    materials: true, edges: false, datums: false, ground: true, clay: null },
  { key: "arctic", label: "Arctic",
    summary: "Form, and nothing else. One white clay everywhere, shaded by ambient "
           + "occlusion so the shape of a corner is the only thing that darkens it, "
           + "with a black line along every sharp edge and silhouette.",
    materials: false, edges: false, datums: false, ground: false,
    clay: [0.88, 0.885, 0.89] },
];

export const findStyle = key => VIEW_STYLES.find(s => s.key === key) || VIEW_STYLES[0];

/* --------------------------------------------------------------- arctic

   Ambient occlusion and ink, in four passes.

   1. The model is drawn into a buffer holding nothing but a view-space normal
      and a linear depth, packed into one RGBA8 texture: the normal
      octahedrally in two channels, the depth as a 16-bit pair in the other
      two. That is everything the next two passes need and it costs one extra
      draw of the geometry.

   2. Ambient occlusion, at half resolution because it is a low-frequency
      thing. The estimator is McGuire's Alchemy AO: for a ring of neighbours,
      how far each one sticks up out of the plane of the point being shaded,
      over the square of how far away it is. No light, no shadow map, no
      randomness that has to be filtered out later - just the geometry
      disagreeing with its own tangent plane.

   3. The model again, in clay, into the canvas.

   4. One full-screen quad, multiplied over it, carrying the blurred occlusion
      AND the lines. The lines are found here rather than drawn as geometry
      because the interesting ones are not in the model: a silhouette is an
      edge between a surface and whatever is behind it, and which edge that is
      changes every time the camera moves. Both kinds fall out of the same
      buffer - a jump in depth is a silhouette, a jump in normal is a crease -
      which is why a fillet's tangent edge draws no line and the corner of a
      box does.                                                              */

const QUAD_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

//! Shared by the buffer that writes the normals and the passes that read them.
const OCT = `
vec2 octEncode(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  vec2 e = n.xy;
  if (n.z < 0.0) e = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return e * 0.5 + 0.5;
}
vec3 octDecode(vec2 e) {
  e = e * 2.0 - 1.0;
  vec3 n = vec3(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}
vec2 packDepth(float v) {
  v = clamp(v, 0.0, 1.0) * 255.0;
  float hi = floor(v);
  return vec2(hi / 255.0, v - hi);
}
float unpackDepth(vec2 v) { return v.x + v.y / 255.0; }`;

const BUFFER_VERTEX = `
varying vec3 vNormal;
varying float vDepth;
void main() {
  vec4 seen = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalMatrix * normal;
  vDepth = -seen.z;
  gl_Position = projectionMatrix * seen;
}`;

const BUFFER_FRAGMENT = `
precision highp float;
uniform float reach;
varying vec3 vNormal;
varying float vDepth;
${OCT}
void main() {
  vec3 n = normalize(vNormal);
  // Both sides of a surface face the camera as far as this is concerned: a
  // single-sided sheet seen from behind is still a surface with an edge.
  if (!gl_FrontFacing) n = -n;
  gl_FragColor = vec4(octEncode(n), packDepth(vDepth / reach));
}`;

/* ---------------------------------------------------- how white, how dark

   THE FOUR NUMBERS THE LOOK IS MADE OF, and they are on a panel rather than
   in this file because "how strong the shadows are" is a matter of taste and
   of what is being drawn. A study model of a stair wants its corners dug out;
   a competition image of a tower wants almost nothing, a whisper of grey in
   the reveals and a clean white everywhere else. Rhino's Arctic has the same
   sliders for the same reason.

     shadow    how dark the occlusion goes, 0 for none
     paper     how white the flats stay - it lifts the FLOOR of the shading
               rather than washing the whole thing out, so a corner still
               reads while a wall goes clean white
     ink       how black a line is
     line      how thick, in pixels                                        */

//! \p edges is not a shader uniform and is not one of the four. It is a
//! switch: whether the model's OWN edges - the B-Rep's, the ones the kernel
//! sent - are laid over the top in black. The ink pass finds silhouettes and
//! creases from the depth buffer, which is the right way to draw a form; what
//! it cannot do is draw the edge between two faces that meet at a couple of
//! degrees, because there is nothing in the depth buffer to find. Those are
//! exactly the edges a machined part is read by, and they are sitting in the
//! geometry already.
export const ARCTIC_LOOK = { shadow: 1, paper: 0.35, ink: 0.85, line: 1.15, edges: false };

/* -------------------------------------------------- lines with a width

   WEBGL WILL NOT DRAW A LINE THICKER THAN ONE PIXEL. `linewidth` on a
   LineBasicMaterial is in the specification, is respected by nobody, and
   fails silently - which makes it worse than absent, because a slider wired
   to it moves and nothing happens.

   So a line with a width is not a line, it is a RIBBON: two triangles per
   segment, pushed apart sideways. Sideways in SCREEN SPACE, worked out per
   vertex from the two ends after they are projected, so a 2 px line is 2 px
   whether the edge is a metre away or a kilometre, and nothing has to be
   rebuilt when the camera moves.

   The same idea as ribbonOf in section.js, and deliberately not the same
   code: that one expands in the plane of a cut, which is right for a line
   that lies in one and wrong for an edge of a solid seen from anywhere. */

const RIBBON_VERTEX = `
attribute vec3 other;          // the segment's far end
attribute float side;          // which way to push this vertex, +1 or -1
uniform vec2 screen;           // the drawing buffer, in pixels
uniform float width;           // how thick, in pixels

void main() {
  vec4 here = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 there = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
  //! BEHIND THE CAMERA, w GOES NEGATIVE and the perspective divide turns a
  //! segment into a streak across the whole screen. A segment with either end
  //! behind the eye is left unexpanded - it is a hairline for one frame while
  //! it crosses the plane, which nobody sees, rather than a triangle the size
  //! of the window, which everybody does.
  if (here.w > 0.0001 && there.w > 0.0001) {
    //! NOT CALLED "half": that is a reserved word in GLSL, reserved for a type
    //! this version does not have, and the compiler reports it as a parse
    //! error the page swallows into "shader error".
    //!
    //! And the word is not in BACKTICKS here either, which is the second half
    //! of the same hour: this shader is a template literal, a backtick inside
    //! one ends it, and what the browser then reported was a JavaScript syntax
    //! error - "Unexpected identifier" - on a line of GLSL.
    vec2 middle = screen * 0.5;
    vec2 a = (here.xy / here.w) * middle;
    vec2 b = (there.xy / there.w) * middle;
    vec2 along = b - a;
    float run = length(along);
    vec2 across = run > 0.0001 ? vec2(-along.y, along.x) / run : vec2(0.0, 1.0);
    vec2 push = across * side * (width * 0.5);
    here.xy += (push / middle) * here.w;
  }
  gl_Position = here;
  #include <clipping_planes_vertex>
}
`;

const RIBBON_FRAGMENT = `
precision mediump float;
uniform vec3 ink;
uniform float opacity;
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(ink, opacity);
}
`;

//! The material every hard-edge overlay is drawn with. Depth-tested, so an
//! edge behind a wall stays behind it; offset towards the eye, because an edge
//! lies exactly ON the surface it belongs to and a tie in the depth test is
//! decided by whichever happened to be drawn last, which flickers.
export function hardEdgeMaterial(THREE, { width = 1.15, ink = 0x000000, opacity = 1 } = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: RIBBON_VERTEX,
    fragmentShader: RIBBON_FRAGMENT,
    uniforms: {
      screen: { value: new THREE.Vector2(1, 1) },
      width: { value: width },
      ink: { value: new THREE.Color(ink) },
      opacity: { value: opacity },
    },
    transparent: opacity < 1,
    //! So the section plane cuts the overlay with everything else. Without it
    //! the edges of the half you cut away go on being drawn in mid-air.
    clipping: true,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });
  material.userData.hardEdge = true;
  return material;
}

//! Segment pairs in, a ribbon out. \p positions is the flat array the kernel
//! already sent for the edges - six numbers a segment - so nothing is fetched
//! and nothing is recomputed; this reads the buffer that is already on the
//! card and builds the quads beside it.
export function edgeRibbon(THREE, positions) {
  const segments = Math.floor(positions.length / 6);
  if (!segments) return null;
  const point = new Float32Array(segments * 4 * 3);
  const other = new Float32Array(segments * 4 * 3);
  const side = new Float32Array(segments * 4);
  //! Over 65,535 vertices an index has to be 32 bits, and a model with more
  //! than sixteen thousand edges in one body is not unusual.
  const index = segments * 4 > 65535 ? new Uint32Array(segments * 6)
                                     : new Uint16Array(segments * 6);
  for (let s = 0; s < segments; s++) {
    const at = s * 6;
    const a = [positions[at], positions[at + 1], positions[at + 2]];
    const b = [positions[at + 3], positions[at + 4], positions[at + 5]];
    //! FOUR VERTICES, AND THE SIDE FLIPS AT THE FAR END. The shader works the
    //! perpendicular out from "this end towards the other end", which reverses
    //! at b - so +1 at b is the opposite side of the ribbon from +1 at a, and
    //! the quad comes out as a bow tie. Flipped here, once, rather than with a
    //! second attribute saying which end this is.
    const rows = [[a, b, 1], [a, b, -1], [b, a, -1], [b, a, 1]];
    for (let i = 0; i < 4; i++) {
      const [here, there, way] = rows[i];
      const v = (s * 4 + i) * 3;
      point[v] = here[0]; point[v + 1] = here[1]; point[v + 2] = here[2];
      other[v] = there[0]; other[v + 1] = there[1]; other[v + 2] = there[2];
      side[s * 4 + i] = way;
    }
    const base = s * 4, out = s * 6;
    index[out] = base; index[out + 1] = base + 1; index[out + 2] = base + 2;
    index[out + 3] = base; index[out + 4] = base + 2; index[out + 5] = base + 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(point, 3));
  geometry.setAttribute("other", new THREE.BufferAttribute(other, 3));
  geometry.setAttribute("side", new THREE.BufferAttribute(side, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  //! The bounds are the SEGMENTS' bounds, and they are wrong by half a line
  //! width at the rim - which is a fraction of a pixel and is the right answer
  //! for frustum culling, where the alternative is computing them from a
  //! projection that has not happened yet.
  geometry.computeBoundingSphere();
  return geometry;
}

//! The layer the overlay lives on. A camera renders layer 0 and nothing else
//! unless it is told otherwise, so an object put here is invisible to every
//! ordinary render and is drawn only by the one pass in Arctic that asks for
//! it. That is what keeps it out of the depth-and-normals buffer the shading
//! is estimated from, where a ribbon has no normals and would carve a black
//! trench either side of every edge.
export const ARCTIC_OVERLAY = 2;

const AO_FRAGMENT = `
precision highp float;
uniform sampler2D buffer;
uniform vec2 pixel;            // 1 / size of the buffer being read
uniform vec2 focal;            // tan(fov/2) * aspect, tan(fov/2)
uniform float reach;           // what depth 1.0 means, in world units
uniform float radius;          // how far around a point counts, in world units
uniform float strength;
varying vec2 vUv;
${OCT}

vec3 seenAt(vec2 uv, float depth) {
  return vec3((uv * 2.0 - 1.0) * focal, -1.0) * depth;
}

//! INTERLEAVED GRADIENT NOISE, not a sine hash.
//!
//! The spiral has to start somewhere, and where it starts has to differ
//! between neighbouring pixels or every pixel samples the same twelve places
//! and the estimator's own pattern appears in the picture as rings. A sine
//! hash differs all right, but it differs RANDOMLY: the error at each pixel
//! is independent of its neighbours', which is exactly the noise that a blur
//! then has to be wide enough to remove. Jimenez's noise is a plane repeating
//! over a small cell, so any neighbourhood of a few pixels covers the whole
//! turn between them - the error cancels in the blur instead of being
//! averaged down, and eight taps of blur do what forty of sampling would.
float dither(vec2 at) {
  return fract(52.9829189 * fract(dot(at, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec4 here = texture2D(buffer, vUv);
  float depth = unpackDepth(here.zw) * reach;
  // Nothing was drawn here. Depth 1.0 is the cleared background.
  if (unpackDepth(here.zw) >= 0.999) { gl_FragColor = vec4(1.0, 1.0, 0.0, 1.0); return; }

  vec3 at = seenAt(vUv, depth);
  vec3 n = octDecode(here.xy);

  // How big the radius is on screen at this distance. A point twice as far
  // away gets half the ring, which is what keeps the occlusion world-sized
  // rather than screen-sized.
  float span = radius / (depth * focal.y * 2.0);
  float turn = dither(gl_FragCoord.xy) * 6.2831853;

  //! COUNTED, not assumed. Sixteen taps go out and near a silhouette half of
  //! them land on the background, where there is nothing to occlude with -
  //! and HOW MANY land there changes from pixel to pixel, because each pixel
  //! starts its spiral at a different angle. Dividing the answer by sixteen
  //! regardless turns that into variance, and variance at the one place the
  //! eye is looking hardest is the ring of dark speckles that followed every
  //! silhouette in this view. Dividing by the taps that actually found
  //! geometry asks the right question - of the directions where there IS
  //! something, how much of it is in the way - and the speckle goes.
  float sum = 0.0, used = 0.0;
  const int TAPS = 16;
  for (int i = 0; i < TAPS; i++) {
    float t = (float(i) + 0.5) / float(TAPS);
    float angle = turn + t * 6.2831853 * 3.0;         // a spiral, not a circle
    // sqrt, so the taps are spread EVENLY OVER THE DISC. Stepping the radius
    // linearly crowds them into the middle, where they all see the same
    // millimetre of geometry and the far half of the radius is guessed at.
    vec2 offset = vec2(cos(angle), sin(angle)) * span * sqrt(t);
    vec2 uv = vUv + offset;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
    vec4 other = texture2D(buffer, uv);
    float otherDepth = unpackDepth(other.zw);
    if (otherDepth >= 0.999) continue;
    vec3 to = seenAt(uv, otherDepth * reach) - at;
    float far2 = dot(to, to);
    //! OUT OF RANGE IS NOT OCCLUSION. A tap that lands on something a long
    //! way in front of this point is a different object, and Alchemy's
    //! division by the distance does not make it small enough: a wall four
    //! metres nearer than the floor behind it darkens the floor in a band.
    //! AND THE RANGE ENDS GRADUALLY. A tap that either counts in full or not
    //! at all, depending on whether it fell a millimetre inside the radius,
    //! is the same speckle in another place.
    float fade = 1.0 - clamp(far2 / (radius * radius * 4.0), 0.0, 1.0);
    if (fade <= 0.0) continue;
    used += 1.0;
    //! AND THE BIAS IS AN ANGLE, not a depth.
    //!
    //! A flat surface must not occlude itself through the quantisation in the
    //! buffer, and a bias in depth does that much - but it does nothing for a
    //! surface seen nearly edge-on, where the taps a few pixels away are
    //! genuinely above the tangent plane because the surface is CURVING. What
    //! that looked like was a ring of dark dots following every silhouette,
    //! dots rather than a band because each pixel's spiral starts somewhere
    //! else. Requiring the neighbour to stand a fixed FRACTION of its own
    //! distance out of the plane - about two degrees - is scale-free, and it
    //! is the difference between a clean white edge and a stippled one.
    float rise = dot(to, n) - max(depth * 0.0015, 0.035 * sqrt(far2));
    sum += max(0.0, rise) * fade / (far2 + 0.0001);
  }

  // Contrast on the way out. The estimator is linear in how much geometry is
  // in the way, and a linear ramp reads as haze; what a person recognises as
  // a corner is the last quarter of it going dark quickly.
  float ao = max(0.0, 1.0 - strength * radius * sum / max(used, 1.0));
  // The depth goes out with it, so the blur can tell one surface from the one
  // behind it without reading the full-size buffer again.
  gl_FragColor = vec4(pow(ao, 1.5), unpackDepth(here.zw), 0.0, 1.0);
}`;

/* ------------------------------------------------------- and then blurred

   TWO PASSES ACROSS AND DOWN RATHER THAN A SQUARE, which is the same blur for
   a fifth of the reads, and EDGE-AWARE, which is the whole point: a box blur
   over the occlusion drags the dark out of an inside corner and across the
   face in front of it, and what that looks like is a smudge round every
   opening. A tap only counts if it is on the same surface, and "the same
   surface" is a depth within a small fraction of its own distance - so the
   blur stops dead at a silhouette and runs freely along a wall.            */

const BLUR_FRAGMENT = `
precision highp float;
uniform sampler2D ao;
uniform vec2 step;             // (1/width, 0) across, (0, 1/height) down
uniform float reach;           // what depth 1.0 means, in world units
uniform float radius;          // how far around a point counts, in world units
varying vec2 vUv;

void main() {
  vec2 here = texture2D(ao, vUv).rg;
  float depth = here.g;
  if (depth >= 0.999) { gl_FragColor = vec4(1.0, depth, 0.0, 1.0); return; }

  //! HOW MUCH DEPTH COUNTS AS THE SAME SURFACE - and it is the OCCLUSION
  //! RADIUS, not a fraction of the distance.
  //!
  //! It was a fraction of the distance, and strict, on the reasoning that a
  //! blur which runs across a silhouette drags the dark out of a corner and
  //! smears it over whatever is in front. True - but a surface seen nearly
  //! edge-on changes depth by that same fraction in one texel, so on every
  //! thin sliver of geometry the blur weighted its neighbours at nothing and
  //! handed the raw estimate straight through. The raw estimate has one
  //! spiral of sixteen taps in it and each texel starts its spiral somewhere
  //! else, so what came out was a rash of dark speckles along the underside
  //! of everything: exactly where a white model needs to look calmest.
  //!
  //! Occlusion is a quantity that varies over the radius by construction, so
  //! smoothing over the radius cannot blur away anything the estimator
  //! resolved, and a real silhouette is many radii deep and still stops it.
  float same = max(radius * 1.5, 1e-6) / reach;

  float sum = here.r, weight = 1.0;
  for (int i = 1; i <= 4; i++) {
    float away = float(i);
    // A gaussian by its shape rather than by a table: exp(-x^2/2s^2), s = 2.
    float g = exp(-away * away / 8.0);
    for (int side = 0; side < 2; side++) {
      vec2 uv = vUv + step * away * (side == 0 ? 1.0 : -1.0);
      vec2 there = texture2D(ao, uv).rg;
      if (there.g >= 0.999) continue;
      float w = g * exp(-abs(there.g - depth) / same);
      sum += there.r * w;
      weight += w;
    }
  }
  gl_FragColor = vec4(sum / weight, depth, 0.0, 1.0);
}`;

/* -------------------------------------------------------------- the lines

   TWO THINGS WERE WRONG WITH THEM, and they are the two things anybody
   notices about a line drawn by a shader.

   ONE: A LINE THAT IS EITHER THERE OR NOT IS A LINE WITH STAIRCASES IN IT.
   The test is whether the pixel next door is behind this one or faces
   somewhere else, and both are yes-or-no questions about a grid of samples -
   so the answer was 1 or 0 and every diagonal came out as a flight of steps.
   What makes it smooth is asking HOW MUCH rather than WHETHER: a neighbour
   just over the threshold is a faint line, one at twice it is a black line,
   and the ramp between them is the antialiasing.

   TWO: WHAT COUNTS AS "BEHIND" WAS A FIXED ALLOWANCE, and a fixed allowance
   is wrong in both directions at once. It has to be generous, because a floor
   seen at a grazing angle changes depth enormously from one pixel to the next
   and none of that is an edge - and being generous means a real step smaller
   than the allowance draws nothing. On the sample this was found with, the
   line round the foot of a cap came out as a row of dashes: the step was
   about the size of the allowance, so the test passed on some pixels and
   failed on the ones between.

   The honest test costs no more. This surface has a normal, so it knows where
   IT would be at the neighbour's pixel - the plane through the point, down
   the neighbour's ray - and the question is how far the neighbour is from
   THAT rather than from here. A grazing floor predicts its own falling away
   and draws nothing; a one-millimetre step on a face square to the camera is
   a mile off the prediction and draws a line. The tolerance becomes a
   fraction of the distance and stops being a fudge.                       */

const INK_FRAGMENT = `
precision highp float;
uniform sampler2D ao;
uniform sampler2D buffer;
uniform vec2 pixel;            // 1 / size of the full-resolution buffer
uniform vec2 aoPixel;          // 1 / size of the occlusion buffer
uniform vec2 focal;            // tan(fov/2) * aspect, tan(fov/2)
uniform float reach;
uniform float crease;          // cos of the angle that counts as sharp
uniform float ink;             // how black the line is
uniform float thickness;
uniform float paper;           // how white the flats stay, 0..1
varying vec2 vUv;
${OCT}

//! The ray through a pixel, in view space, one unit deep.
vec3 rayAt(vec2 uv) { return vec3((uv * 2.0 - 1.0) * focal, -1.0); }

void main() {
  // Already blurred, twice, and edge-aware both times - so one bilinear tap
  // is the whole of it here.
  float shade = texture2D(ao, vUv).r;

  vec4 here = texture2D(buffer, vUv);
  float depth = unpackDepth(here.zw);
  vec3 n = octDecode(here.xy);

  float line = 0.0;
  if (depth < 0.999) {
    float away = depth * reach;
    vec3 at = rayAt(vUv) * away;
    float onPlane = dot(n, at);
    // A step of a third of a per cent of how far away it is. Small, because
    // the prediction is good; a fixed allowance had to be twenty times this
    // to survive a grazing floor.
    float tol = away * 0.0033;

    vec2 step = pixel * thickness;
    float behind = 0.0, turned = 1.0;
    // Eight ways round, not four. A ridge that runs diagonally across the
    // pixel grid is missed by half its neighbours by the four-way test, and
    // what that looks like is a dashed line.
    for (int i = 0; i < 8; i++) {
      float turn = float(i) * 0.78539816;              // 45 degrees each
      vec2 way = vec2(cos(turn), sin(turn));
      vec2 uv = vUv + way * step;
      vec4 other = texture2D(buffer, uv);
      float otherDepth = unpackDepth(other.zw);
      if (otherDepth >= 0.999) { behind = 8.0; continue; }   // nothing behind it
      // Where THIS surface would be at the neighbour's pixel: the plane
      // through the point, down the neighbour's ray.
      vec3 ray = rayAt(uv);
      float slant = dot(n, ray);
      float predicted = abs(slant) < 1e-5 ? away : onPlane / slant;
      behind = max(behind, (otherDepth * reach - predicted) / tol);
      // A crease: the neighbour faces somewhere else entirely. A curved
      // face turns by a degree or two a pixel and never trips this; the
      // corner of a box turns by ninety.
      turned = min(turned, dot(n, octDecode(other.xy)));
    }
    float silhouette = smoothstep(0.6, 2.0, behind);
    // From "not quite sharp" to "sharp", rather than at it: the half-angle
    // is where the ramp starts, the angle itself is where it is black.
    float sharp = smoothstep(mix(1.0, crease, 0.45), crease, turned);
    line = max(silhouette, sharp);
  }

  // AND HOW WHITE IT STAYS. The occlusion is lifted off the floor rather than
  // scaled: scaling it takes the corners with it and the model goes flat,
  // while lifting the floor leaves the deepest quarter of the range where it
  // was and washes the rest clean.
  shade = mix(shade, 1.0, paper * (1.0 - shade * shade));

  float dark = shade * (1.0 - line * ink);
  gl_FragColor = vec4(vec3(dark), 1.0);
}`;
export class Arctic {
  constructor(THREE, renderer) {
    this.THREE = THREE;
    this.renderer = renderer;
    this.width = 0;
    this.height = 0;
    this.radius = 0;
    this.reach = 0;

    this.buffer = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true,
    });
    const halfTarget = () => new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false,
    });
    //! Two of them, because a separable blur has to land somewhere between
    //! the pass across and the pass down.
    this.occlusion = halfTarget();
    this.smoothed = halfTarget();

    this.depthMaterial = new THREE.ShaderMaterial({
      vertexShader: BUFFER_VERTEX, fragmentShader: BUFFER_FRAGMENT,
      uniforms: { reach: { value: 1 } }, side: THREE.DoubleSide,
    });

    this.aoMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: AO_FRAGMENT,
      uniforms: {
        buffer: { value: this.buffer.texture },
        pixel: { value: new THREE.Vector2() },
        focal: { value: new THREE.Vector2() },
        reach: { value: 1 }, radius: { value: 1 }, strength: { value: 2.6 },
      },
      depthTest: false, depthWrite: false,
    });

    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: BLUR_FRAGMENT,
      uniforms: { ao: { value: null }, step: { value: new THREE.Vector2() },
                  reach: { value: 1 }, radius: { value: 1 } },
      depthTest: false, depthWrite: false,
    });

    this.inkMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: INK_FRAGMENT,
      uniforms: {
        ao: { value: this.smoothed.texture },
        buffer: { value: this.buffer.texture },
        pixel: { value: new THREE.Vector2() },
        aoPixel: { value: new THREE.Vector2() },
        reach: { value: 1 },
        focal: { value: new THREE.Vector2() },
        crease: { value: Math.cos(32 * Math.PI / 180) },
        ink: { value: ARCTIC_LOOK.ink },
        thickness: { value: ARCTIC_LOOK.line },
        paper: { value: ARCTIC_LOOK.paper },
      },
      // Multiplied over the clay: this pass carries how DARK each pixel is and
      // nothing else, so it works over any background without knowing it.
      blending: THREE.MultiplyBlending, transparent: true,
      depthTest: false, depthWrite: false,
    });

    // One triangle in clip space for every full-screen pass.
    const quad = new THREE.BufferGeometry();
    quad.setAttribute("position", new THREE.Float32BufferAttribute(
      [-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    quad.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = quad;
    this.screen = new THREE.Scene();
    this.screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blit = new THREE.Mesh(quad, this.aoMaterial);
    this.blit.frustumCulled = false;
    this.screen.add(this.blit);
  }

  setSize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.buffer.setSize(width, height);
    //! AT THE SIZE OF THE PICTURE, not half of it. Half resolution is the
    //! usual economy and it is the right one for a low-frequency quantity
    //! over a big smooth surface - but a building is mostly slivers seen at a
    //! grazing angle, a reveal is two texels wide at half size, and what
    //! cannot be resolved there cannot be smoothed there either. Four times
    //! the taps for a pass that is a couple of milliseconds on any card made
    //! this decade, and the underside of the model stops crawling.
    this.occlusion.setSize(width, height);
    this.smoothed.setSize(width, height);
    this.aoMaterial.uniforms.pixel.value.set(1 / width, 1 / height);
    this.inkMaterial.uniforms.pixel.value.set(1 / width, 1 / height);
    this.inkMaterial.uniforms.aoPixel.value.set(1 / width, 1 / height);
  }

  //! How far the occlusion reaches, in the model's own units, and how far away
  //! the far end of the depth buffer is. Both are set by the caller because
  //! only the caller knows how big the thing on screen is: a 2 m radius is
  //! right for a building and absurd for a bracket.
  setScale({ radius, reach }) {
    this.radius = radius;
    this.reach = reach;
  }

  //! How white and how dark, from the panel. Every one of them is optional and
  //! whatever is left out stays where it was, so a slider can be moved without
  //! the caller having to hold the other three.
  setLook(look = {}) {
    const number = (value, was) => (typeof value === "number" && isFinite(value) ? value : was);
    const ao = this.aoMaterial.uniforms;
    const ink = this.inkMaterial.uniforms;
    //! The strength the estimator wants is not the number on the slider: 1 on
    //! the slider is the shading this looked like before there was a slider.
    ao.strength.value = number(look.shadow, ao.strength.value / 2.6) * 2.6;
    ink.paper.value = Math.min(1, Math.max(0, number(look.paper, ink.paper.value)));
    ink.ink.value = Math.min(1, Math.max(0, number(look.ink, ink.ink.value)));
    ink.thickness.value = Math.max(0.25, number(look.line, ink.thickness.value));
    if (typeof look.crease === "number")
      ink.crease.value = Math.cos(Math.min(89, Math.max(1, look.crease)) * Math.PI / 180);
  }

  //! Draws \p scene with \p camera. The caller has already put the clay
  //! materials on; this adds the shading and the ink.
  render(scene, camera) {
    const { renderer } = this;
    const size = renderer.getDrawingBufferSize(new this.THREE.Vector2());
    this.setSize(size.x, size.y);

    const reach = this.reach || camera.far;
    const radius = this.radius || reach * 0.02;
    const tan = Math.tan((camera.fov * Math.PI / 180) / 2);

    this.depthMaterial.uniforms.reach.value = reach;
    for (const material of [this.aoMaterial, this.inkMaterial])
      material.uniforms.reach.value = reach;
    this.aoMaterial.uniforms.radius.value = radius;
    this.aoMaterial.uniforms.focal.value.set(tan * camera.aspect, tan);
    this.blurMaterial.uniforms.reach.value = reach;
    this.blurMaterial.uniforms.radius.value = radius;
    this.inkMaterial.uniforms.focal.value.set(tan * camera.aspect, tan);

    const wasTarget = renderer.getRenderTarget();
    const wasOverride = scene.overrideMaterial;
    const wasAutoClear = renderer.autoClear;
    const wasClear = renderer.getClearColor(new this.THREE.Color());
    const wasAlpha = renderer.getClearAlpha();

    //! THE OVERLAY IS NOT IN THE SHADING. It is on a layer of its own and the
    //! camera is told to ignore that layer for the two passes that estimate
    //! the form - the depth-and-normals buffer, and the clay - and then to
    //! render nothing BUT that layer, once, on top. A ribbon has no normals to
    //! give the first pass, and left in it, each edge carved a black trench
    //! down both sides of itself.
    const wasLayers = camera.layers.mask;
    camera.layers.disable(ARCTIC_OVERLAY);

    // 1. normals and depth. White means depth 1.0, which is "nothing here".
    scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.buffer);
    renderer.setClearColor(0xffffff, 1);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    scene.overrideMaterial = wasOverride;

    // 2. the occlusion from them, and then across and down to smooth it.
    this.blit.material = this.aoMaterial;
    renderer.setRenderTarget(this.occlusion);
    renderer.render(this.screen, this.screenCamera);

    this.blit.material = this.blurMaterial;
    const wide = this.occlusion.width, tall = this.occlusion.height;
    this.blurMaterial.uniforms.ao.value = this.occlusion.texture;
    this.blurMaterial.uniforms.step.value.set(1 / wide, 0);
    renderer.setRenderTarget(this.smoothed);
    renderer.render(this.screen, this.screenCamera);

    this.blurMaterial.uniforms.ao.value = this.smoothed.texture;
    this.blurMaterial.uniforms.step.value.set(0, 1 / tall);
    renderer.setRenderTarget(this.occlusion);
    renderer.render(this.screen, this.screenCamera);
    //! Down lands back in the first one, so the ink pass is handed whichever
    //! of the two the last pass wrote.
    this.inkMaterial.uniforms.ao.value = this.occlusion.texture;

    // 3. the model in clay.
    renderer.setRenderTarget(wasTarget);
    renderer.setClearColor(wasClear, wasAlpha);
    renderer.render(scene, camera);

    //! 3b. THE MODEL'S OWN EDGES, over the clay and under the ink. Over the
    //! clay because they are drawn against the depth the clay just wrote, so
    //! an edge round the back stays round the back. Under the ink because the
    //! ink pass multiplies, and black multiplied by anything is still black -
    //! so an edge drawn here is exactly as black as it was asked to be, and
    //! the paper slider cannot wash it out.
    //!
    //! Nothing at all when nothing is on the layer, which is the usual case:
    //! a render of an empty layer is one state change.
    camera.layers.set(ARCTIC_OVERLAY);
    renderer.autoClear = false;
    renderer.render(scene, camera);
    camera.layers.mask = wasLayers;

    // 4. the shading and the ink, multiplied over it. autoClear stays OFF -
    // 3b turned it off and this pass needs it off for the same reason: a
    // full-screen pass that clears first is a full-screen pass multiplied over
    // nothing, which is black, and over a canvas with an alpha channel,
    // invisible.
    this.blit.material = this.inkMaterial;
    renderer.render(this.screen, this.screenCamera);

    renderer.autoClear = wasAutoClear;
  }

  dispose() {
    this.buffer.dispose();
    this.occlusion.dispose();
    this.smoothed.dispose();
    this.quad.dispose();
    for (const material of [this.depthMaterial, this.aoMaterial,
                            this.blurMaterial, this.inkMaterial])
      material.dispose();
  }
}

//! The sky a rendered view is lit by, made rather than fetched: a page that
//! may not load an HDR file can still have a horizon, and this is what makes
//! chrome look like chrome instead of grey plastic. A vertical gradient with a
//! bright band where the sky meets the ground, run through the same
//! prefiltering any image-based light gets.
export function makeSky(THREE, renderer, { top = "#f3f7fb", horizon = "#ffffff",
                                           ground = "#7d838a" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 128;
  const paint = canvas.getContext("2d");
  const sky = paint.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, top);
  sky.addColorStop(0.46, horizon);
  sky.addColorStop(0.54, ground);
  sky.addColorStop(1, ground);
  paint.fillStyle = sky;
  paint.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const prefilter = new THREE.PMREMGenerator(renderer);
  prefilter.compileEquirectangularShader();
  const map = prefilter.fromEquirectangular(texture).texture;
  prefilter.dispose();
  texture.dispose();
  return map;
}
