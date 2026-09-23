// The OCAF document, in the shape OpenCascade gives it.
//
// Labels form a tree; each carries attributes under the names OCAF uses. A
// feature is a label with a TFunction_Function attribute naming its driver; the
// driver reads the argument labels beneath it and writes a TNaming_NamedShape.
// Regeneration walks the dependency graph the drivers describe and executes
// only the functions the logbook marks as touched or impacted.
//
// The geometry itself is not here. Drivers are registered from outside with a
// build() that calls a real kernel - OpenCascade compiled to WebAssembly in the
// browser, the same OpenCascade natively behind the HTTP kernel.

import { EMPTY_SKETCH, readSketch, sketchSummary } from "./sketch.js";
import { PICK_MODES, PICK_ANGLE } from "./subshape.js";
import { SECTION_KINDS } from "./sections.js";

/* --------------------------------------------------------------- samples

   A whole document, ready to load. Not a feature and not a script: every one
   of these is the catalogue wired to itself, which is the point of showing it.
   ------------------------------------------------------------------------ */

//! A hillside town, after Zaha Hadid Architects' "Rock" prototype for the
//! Dubrovnik golf and spa resort. The hill is a grid displaced by a formula;
//! the plan is three numbers typed into a list; Drape projects that plan onto
//! the hill; the villa is a lens lofted from a battered base to an oversailing
//! lid with a sinkhole cut through it; and PlaceAt puts it at every site,
//! turned by its own angle. Fifty-two nodes and no script.
export const HILLSIDE_TOWN = {
  "format": "ocaf-parametric-model",
  "version": 1,
  "name": "Hillside Town",
  "units": "mm",
  "features": [
    {
      "id": "PT1",
      "type": "Point",
      "name": "Site origin",
      "args": {
        "x": 0,
        "y": 0,
        "z": 0
      }
    },
    {
      "id": "VZ",
      "type": "Vector",
      "name": "Up",
      "args": {
        "dx": 0,
        "dy": 0,
        "dz": 1
      }
    },
    {
      "id": "PL1",
      "type": "Plane",
      "name": "Site plane",
      "args": {
        "origin": {
          "ref": "PT1"
        },
        "normal": {
          "ref": "VZ"
        },
        "size": 300
      }
    },
    {
      "id": "NW",
      "type": "Number",
      "name": "Site width",
      "args": {
        "value": 4200
      }
    },
    {
      "id": "ND",
      "type": "Number",
      "name": "Site depth",
      "args": {
        "value": 3200
      }
    },
    {
      "id": "NH",
      "type": "Number",
      "name": "Hill height",
      "args": {
        "value": 900
      }
    },
    {
      "id": "MG",
      "type": "MeshGrid",
      "name": "Terrain grid",
      "args": {
        "plane": {
          "ref": "PL1"
        },
        "width": {
          "value": 4200,
          "from": "NW"
        },
        "depth": {
          "value": 3200,
          "from": "ND"
        },
        "cols": 16,
        "rows": 14
      }
    },
    {
      "id": "MD",
      "type": "MeshDisplace",
      "name": "Landform",
      "args": {
        "mesh": {
          "ref": "MG"
        },
        "along": "Z",
        "amount": {
          "value": 900,
          "from": "NH"
        },
        "formula": "Math.exp(-((x / 1500) ** 2)) * (0.30 + 0.70 * (y + 1600) / 3200) + 0.10 * Math.cos(x / 430) * (y + 1600) / 3200"
      }
    },
    {
      "id": "SD",
      "type": "Subdivide",
      "name": "Hill",
      "args": {
        "mesh": {
          "ref": "MD"
        },
        "on": "On",
        "levels": 1,
        "boundary": "Keep sharp",
        "shading": "Smooth"
      }
    },
    {
      "id": "NB",
      "type": "Numbers",
      "name": "Bay positions",
      "args": {
        "values": "-1450, 0, 1450",
        "scale": 1
      }
    },
    {
      "id": "PR1",
      "type": "Point",
      "name": "Row 1 plan",
      "args": {
        "x": {
          "value": 0,
          "from": "NB"
        },
        "y": -830,
        "z": 0
      }
    },
    {
      "id": "PR2",
      "type": "Point",
      "name": "Row 2 plan",
      "args": {
        "x": {
          "value": 0,
          "from": "NB"
        },
        "y": 320,
        "z": 0
      }
    },
    {
      "id": "DR1",
      "type": "Drape",
      "name": "Row 1 sites",
      "args": {
        "points": {
          "ref": "PR1"
        },
        "onto": {
          "ref": "SD"
        },
        "lift": 0,
        "miss": "Drop them"
      }
    },
    {
      "id": "DR2",
      "type": "Drape",
      "name": "Row 2 sites",
      "args": {
        "points": {
          "ref": "PR2"
        },
        "onto": {
          "ref": "SD"
        },
        "lift": 0,
        "miss": "Drop them"
      }
    },
    {
      "id": "PX",
      "type": "Numbers",
      "name": "Lens x",
      "args": {
        "values": "-450, -240, 210, 480, 200, -240",
        "scale": 1
      }
    },
    {
      "id": "PY",
      "type": "Numbers",
      "name": "Lens y",
      "args": {
        "values": "0, -172, -200, 0, 200, 172",
        "scale": 1
      }
    },
    {
      "id": "BT",
      "type": "Number",
      "name": "Batter",
      "args": {
        "value": 0.68
      }
    },
    {
      "id": "NO",
      "type": "Number",
      "name": "Roof oversail",
      "args": {
        "value": 1.06
      }
    },
    {
      "id": "MBX",
      "type": "Math",
      "name": "Base x",
      "args": {
        "a": {
          "value": 1,
          "from": "PX"
        },
        "b": {
          "value": 0.68,
          "from": "BT"
        },
        "op": "A \u00d7 B"
      }
    },
    {
      "id": "MBY",
      "type": "Math",
      "name": "Base y",
      "args": {
        "a": {
          "value": 1,
          "from": "PY"
        },
        "b": {
          "value": 0.68,
          "from": "BT"
        },
        "op": "A \u00d7 B"
      }
    },
    {
      "id": "QB",
      "type": "Point",
      "name": "Base lens",
      "args": {
        "x": {
          "value": 0,
          "from": "MBX"
        },
        "y": {
          "value": 0,
          "from": "MBY"
        },
        "z": -430
      }
    },
    {
      "id": "WB",
      "type": "Polyline",
      "name": "Base",
      "args": {
        "points": {
          "ref": "QB"
        },
        "closed": "Closed"
      }
    },
    {
      "id": "QT",
      "type": "Point",
      "name": "Eaves lens",
      "args": {
        "x": {
          "value": 0,
          "from": "PX"
        },
        "y": {
          "value": 0,
          "from": "PY"
        },
        "z": 205
      }
    },
    {
      "id": "WT",
      "type": "Polyline",
      "name": "Eaves",
      "args": {
        "points": {
          "ref": "QT"
        },
        "closed": "Closed"
      }
    },
    {
      "id": "LM",
      "type": "Loft",
      "name": "Mass",
      "args": {
        "sections": [
          {
            "ref": "WB"
          },
          {
            "ref": "WT"
          }
        ],
        "cap": "Solid",
        "ruled": "Ruled"
      }
    },
    {
      "id": "MOX",
      "type": "Math",
      "name": "Roof x",
      "args": {
        "a": {
          "value": 1,
          "from": "PX"
        },
        "b": {
          "value": 1.06,
          "from": "NO"
        },
        "op": "A \u00d7 B"
      }
    },
    {
      "id": "MOY",
      "type": "Math",
      "name": "Roof y",
      "args": {
        "a": {
          "value": 1,
          "from": "PY"
        },
        "b": {
          "value": 1.06,
          "from": "NO"
        },
        "op": "A \u00d7 B"
      }
    },
    {
      "id": "QR",
      "type": "Point",
      "name": "Roof underside",
      "args": {
        "x": {
          "value": 0,
          "from": "MOX"
        },
        "y": {
          "value": 0,
          "from": "MOY"
        },
        "z": 205
      }
    },
    {
      "id": "WR",
      "type": "Polyline",
      "name": "Soffit",
      "args": {
        "points": {
          "ref": "QR"
        },
        "closed": "Closed"
      }
    },
    {
      "id": "QS",
      "type": "Point",
      "name": "Roof top",
      "args": {
        "x": {
          "value": 0,
          "from": "MOX"
        },
        "y": {
          "value": 0,
          "from": "MOY"
        },
        "z": 246
      }
    },
    {
      "id": "WS",
      "type": "Polyline",
      "name": "Roof edge",
      "args": {
        "points": {
          "ref": "QS"
        },
        "closed": "Closed"
      }
    },
    {
      "id": "LP",
      "type": "Loft",
      "name": "Roof plate",
      "args": {
        "sections": [
          {
            "ref": "WR"
          },
          {
            "ref": "WS"
          }
        ],
        "cap": "Solid",
        "ruled": "Ruled"
      }
    },
    {
      "id": "CX",
      "type": "Numbers",
      "name": "Court x",
      "args": {
        "values": "-250, 300, 345, -165",
        "scale": 1
      }
    },
    {
      "id": "CY",
      "type": "Numbers",
      "name": "Court y",
      "args": {
        "values": "-118, -58, 118, 152",
        "scale": 1
      }
    },
    {
      "id": "QC",
      "type": "Point",
      "name": "Court floor",
      "args": {
        "x": {
          "value": 0,
          "from": "CX"
        },
        "y": {
          "value": 0,
          "from": "CY"
        },
        "z": -30
      }
    },
    {
      "id": "WC",
      "type": "Polyline",
      "name": "Court sill",
      "args": {
        "points": {
          "ref": "QC"
        },
        "closed": "Closed"
      }
    },
    {
      "id": "QD",
      "type": "Point",
      "name": "Court sky",
      "args": {
        "x": {
          "value": 0,
          "from": "CX"
        },
        "y": {
          "value": 0,
          "from": "CY"
        },
        "z": 420
      }
    },
    {
      "id": "WD",
      "type": "Polyline",
      "name": "Court head",
      "args": {
        "points": {
          "ref": "QD"
        },
        "closed": "Closed"
      }
    },
    {
      "id": "LC",
      "type": "Loft",
      "name": "Sinkhole",
      "args": {
        "sections": [
          {
            "ref": "WC"
          },
          {
            "ref": "WD"
          }
        ],
        "cap": "Solid",
        "ruled": "Ruled"
      }
    },
    {
      "id": "BM",
      "type": "Boolean",
      "name": "Mass, cut",
      "args": {
        "a": {
          "ref": "LM"
        },
        "b": {
          "ref": "LC"
        },
        "op": "Difference"
      }
    },
    {
      "id": "BP",
      "type": "Boolean",
      "name": "Roof, cut",
      "args": {
        "a": {
          "ref": "LP"
        },
        "b": {
          "ref": "LC"
        },
        "op": "Difference"
      }
    },
    {
      "id": "PP",
      "type": "Point",
      "name": "Pool corner",
      "args": {
        "x": -150,
        "y": -66,
        "z": -30
      }
    },
    {
      "id": "CP",
      "type": "Cube",
      "name": "Pool",
      "args": {
        "origin": {
          "ref": "PP"
        },
        "plane": {
          "ref": "PL1"
        },
        "dx": 420,
        "dy": 62,
        "dz": 20
      }
    },
    {
      "id": "JV",
      "type": "Join",
      "name": "Villa",
      "args": {
        "parts": [
          {
            "ref": "BM"
          },
          {
            "ref": "BP"
          },
          {
            "ref": "CP"
          }
        ]
      }
    },
    {
      "id": "NT1",
      "type": "Numbers",
      "name": "Row 1 turns",
      "args": {
        "values": "0, 16, -12",
        "scale": 1
      }
    },
    {
      "id": "NT2",
      "type": "Numbers",
      "name": "Row 2 turns",
      "args": {
        "values": "9, -20, 24",
        "scale": 1
      }
    },
    {
      "id": "PA1",
      "type": "PlaceAt",
      "name": "Row 1",
      "args": {
        "shape": {
          "ref": "JV"
        },
        "points": {
          "ref": "DR1"
        },
        "angles": {
          "ref": "NT1"
        },
        "turn": 0,
        "lift": 0
      }
    },
    {
      "id": "PA2",
      "type": "PlaceAt",
      "name": "Row 2",
      "args": {
        "shape": {
          "ref": "JV"
        },
        "points": {
          "ref": "DR2"
        },
        "angles": {
          "ref": "NT2"
        },
        "turn": 0,
        "lift": 0
      }
    },
    {
      "id": "JT",
      "type": "Join",
      "name": "The town",
      "args": {
        "parts": [
          {
            "ref": "PA1"
          },
          {
            "ref": "PA2"
          }
        ]
      }
    },
    {
      "id": "MS",
      "type": "Measure",
      "name": "Across the site",
      "args": {
        "shape": {
          "ref": "SD"
        },
        "quantity": "Size X"
      }
    },
    {
      "id": "EX",
      "type": "Expression",
      "name": "In metres",
      "args": {
        "a": {
          "value": 1,
          "from": "MS"
        },
        "b": 1,
        "c": 0,
        "formula": "a / 100"
      }
    },
    {
      "id": "PN",
      "type": "Panel",
      "name": "Site width",
      "args": {
        "input": {
          "ref": "EX"
        }
      }
    }
  ],
  "layout": {
    "PT1": [
      30,
      30
    ],
    "VZ": [
      30,
      210
    ],
    "PL1": [
      330,
      30
    ],
    "NW": [
      30,
      400
    ],
    "ND": [
      30,
      560
    ],
    "NH": [
      30,
      720
    ],
    "MG": [
      330,
      400
    ],
    "MD": [
      640,
      400
    ],
    "SD": [
      950,
      400
    ],
    "NB": [
      330,
      780
    ],
    "PR1": [
      640,
      780
    ],
    "PR2": [
      640,
      1010
    ],
    "DR1": [
      950,
      780
    ],
    "DR2": [
      950,
      1010
    ],
    "PX": [
      1450,
      30
    ],
    "PY": [
      1450,
      190
    ],
    "BT": [
      1450,
      350
    ],
    "NO": [
      1450,
      510
    ],
    "MBX": [
      1770,
      30
    ],
    "MBY": [
      1770,
      190
    ],
    "QB": [
      2090,
      30
    ],
    "WB": [
      2390,
      30
    ],
    "QT": [
      2090,
      190
    ],
    "WT": [
      2390,
      190
    ],
    "LM": [
      2690,
      30
    ],
    "MOX": [
      1770,
      350
    ],
    "MOY": [
      1770,
      510
    ],
    "QR": [
      2090,
      350
    ],
    "WR": [
      2390,
      350
    ],
    "QS": [
      2090,
      510
    ],
    "WS": [
      2390,
      510
    ],
    "LP": [
      2690,
      350
    ],
    "CX": [
      1450,
      700
    ],
    "CY": [
      1450,
      860
    ],
    "QC": [
      1770,
      700
    ],
    "WC": [
      2090,
      700
    ],
    "QD": [
      1770,
      860
    ],
    "WD": [
      2090,
      860
    ],
    "LC": [
      2390,
      700
    ],
    "BM": [
      3010,
      30
    ],
    "BP": [
      3010,
      350
    ],
    "PP": [
      1450,
      1020
    ],
    "CP": [
      1770,
      1020
    ],
    "JV": [
      3330,
      30
    ],
    "NT1": [
      2650,
      780
    ],
    "NT2": [
      2650,
      940
    ],
    "PA1": [
      2970,
      780
    ],
    "PA2": [
      2970,
      1010
    ],
    "JT": [
      3290,
      780
    ],
    "MS": [
      1250,
      400
    ],
    "EX": [
      1250,
      560
    ],
    "PN": [
      1250,
      720
    ]
  }
};

//! The sketcher, taught by example. Three sketches and nothing else builds
//! any of this part:
//!
//!   Plate outline  four elements chained into an outline, held square by
//!                  horizontal, vertical and parallel; three more loops drawn
//!                  inside it, which come out as holes because they are inside
//!                  it rather than because anyone said so.
//!   Rib section    the same node on a plane standing on its side, so the
//!                  drawing's u and v are the world's Z and X. Nothing in the
//!                  drawing knows that.
//!   Open chain     a line and an arc that do not close, extruded on Surface
//!                  rather than Solid - the other half of that toggle.
//!
//! Every number in it can be read off the drawing: the outline measures
//! 1143.81 mm, the fin 6513.27 mm2 - which is the chain's 162.83 mm swept
//! 40 - and fusing the rib to the plate removes 39,788 mm3, the trapezoid
//! where the two overlap, exactly.
export const SKETCHER_PART = {
  format: "ocaf-parametric-model", version: 1, name: "Sketcher", units: "mm",
  features: [
    { id: "PT1", type: "Point",  name: "Origin",    args: { x: 0, y: 0, z: 0 } },
    { id: "VE1", type: "Vector", name: "Up",        args: { dx: 0, dy: 0, dz: 1 } },
    { id: "VE2", type: "Vector", name: "Across",    args: { dx: 0, dy: 1, dz: 0 } },
    { id: "PL1", type: "Plane",  name: "Plate plane",
      args: { origin: { ref: "PT1" }, normal: { ref: "VE1" } } },
    { id: "PT2", type: "Point",  name: "Rib base",  args: { x: 0, y: 16, z: 0 } },
    { id: "PL2", type: "Plane",  name: "Rib plane",
      args: { origin: { ref: "PT2" }, normal: { ref: "VE2" } } },
    { id: "NU1", type: "Number", name: "Plate thickness", args: { value: 14 } },

    { id: "SK1", type: "Sketch", name: "Plate outline",
      args: { plane: { ref: "PL1" }, origin: { ref: "PT1" }, faces: "Make faces",
        solve: "Solve", passes: 24,
        drawing: {
          elements: [
            { id: "front", type: "line", a: [-120, -70], b: [90, -70] },
            { id: "nose",  type: "arc",  c: [90, -20], r: 50, a0: -1.5707963, a1: 1.5707963 },
            { id: "back",  type: "line", a: [90, 30], b: [-120, 30] },
            { id: "side",  type: "line", a: [-120, 30], b: [-120, -70] },
            { id: "bolt",  type: "circle", c: [-90, -20], r: 16 },
            { id: "eye",   type: "circle", c: [90, -20], r: 22 },
            { id: "slot",  type: "oblong", a: [-40, -20], b: [30, -20], r: 14 },
          ],
          constraints: [
            { type: "horizontal", of: ["front"] },
            { type: "horizontal", of: ["back"] },
            { type: "vertical",   of: ["side"] },
            { type: "parallel",   of: ["front", "back"] },
          ],
        } } },
    { id: "EX1", type: "Extrude", name: "Plate",
      args: { profile: { ref: "SK1" }, direction: { ref: "VE1" },
              distance: { value: 14, from: "NU1" }, cap: "Solid" },
      appearance: { finish: "aluminium" } },

    { id: "SK2", type: "Sketch", name: "Rib section",
      args: { plane: { ref: "PL2" }, origin: { ref: "PT2" }, faces: "Make faces",
        solve: "Solve", passes: 24,
        drawing: {
          elements: [
            { id: "foot",  type: "line", a: [0, -120], b: [0, 90] },
            { id: "slope", type: "line", a: [0, 90], b: [70, 20] },
            { id: "head",  type: "line", a: [70, 20], b: [70, -120] },
            { id: "spine", type: "line", a: [70, -120], b: [0, -120] },
          ],
          constraints: [{ type: "parallel", of: ["foot", "head"] }],
        } } },
    { id: "EX2", type: "Extrude", name: "Rib",
      args: { profile: { ref: "SK2" }, direction: { ref: "VE2" },
              distance: 14, cap: "Solid" },
      appearance: { finish: "aluminium" } },

    { id: "BO1", type: "Boolean", name: "Plate and rib",
      args: { a: { ref: "EX1" }, b: { ref: "EX2" }, op: "Union" },
      appearance: { finish: "aluminium" } },
    { id: "FI1", type: "Fillet", name: "Broken edges",
      args: { body: { ref: "BO1" }, radius: 2 },
      appearance: { finish: "aluminium" } },

    { id: "SK3", type: "Sketch", name: "Open chain",
      args: { plane: { ref: "PL1" }, origin: { ref: "PT1" }, faces: "Make faces",
        solve: "Solve", passes: 24,
        drawing: {
          elements: [
            { id: "run", type: "line", a: [-80, 90], b: [20, 90] },
            { id: "turn", type: "arc", c: [20, 50], r: 40, a0: 0, a1: 1.5707963 },
          ],
          constraints: [{ type: "horizontal", of: ["run"] }],
        } } },
    { id: "EX3", type: "Extrude", name: "Guide fin",
      args: { profile: { ref: "SK3" }, direction: { ref: "VE1" },
              distance: 40, cap: "Surface" },
      appearance: { finish: "glass" } },
  ],
};

//! WHERE A SAMPLE'S MODEL COMES FROM. The first two are written here, because
//! they are written BY hand and read as source. The rest are files - models
//! somebody built in the program and saved - and a model file is data, not
//! source: it lives in data/samples/ beside the page, packed into the
//! single-file build and fetched from the folder when the page is served, the
//! same way a package's table does. So a sample here carries EITHER a model or
//! the name of its file, and nothing reads one until it is asked for.
export const SAMPLES = [
  { key: "hillside-town", name: "Hillside town",
    summary: "A landform, six villas terraced across it, and the plan projected onto "
           + "the hill. The villa is after Zaha Hadid Architects' Rock, Dubrovnik. "
           + "52 nodes, no script.",
    model: HILLSIDE_TOWN },
  { key: "sketcher", name: "Sketcher",
    summary: "How a sketch is used, in three of them: an outline held square by "
           + "relations with holes drawn inside it, the same node on a plane standing "
           + "on its side, and a chain that does not close, swept as a surface. "
           + "Double-click any of them to draw on it.",
    model: SKETCHER_PART },

  { key: "3dspline", name: "3dspline", file: "samples/3dspline.json",
    summary: "A blend curve run between the ends of two sketched splines, with "
           + "its tangent direction and tension set at each end - so the join "
           + "is smooth and you can see what changes it. The set it is built in "
           + "collapses to one node in the graph. Two cameras: double-click "
           + "either to look through it. 14 nodes." },
  { key: "columns-on-a-curve", name: "Columns on a curve",
    file: "samples/Columns_on_a_curve.json",
    summary: "A column built once - five named numbers, an expression for the "
           + "top, a solved section sketch, an extrude - and placed at every "
           + "one of ten stations evaluated along a sketched curve. Two "
           + "geometrical sets, each a single node in the graph. 25 nodes." },
  { key: "fillsurface", name: "fillsurface", file: "samples/fillsurface.json",
    summary: "The blend curve worked out in full: two of them run between two "
           + "sketched splines, each with its tangent direction drawn as a line "
           + "you can see, and a surface filled across the loop they make. The "
           + "fill is left reporting on purpose - the loop has a 500 mm gap in "
           + "it, and the node names both loose ends and how far apart they "
           + "are. 29 nodes." },
  { key: "fillsurface-extrude", name: "fillsurface_extrude",
    file: "samples/fillsurface_extrude.json",
    summary: "The small one: a rounded rectangle, extruded, and a surface filled "
           + "across its top held tangent to the sides and pulled through a "
           + "point. Point the fill at the draft instead to see it let the "
           + "curved corners go. 8 nodes." },
  { key: "fillsurface-draft", name: "fillsurface_draft",
    file: "samples/fillsurface_draft.json",
    summary: "The same rounded rectangle drafted rather than extruded, so the "
           + "sides the fill is held tangent to are cones instead of cylinders. "
           + "The fill keeps the tangency it can and says which edges it had to "
           + "let go of, which is the difference worth looking at beside "
           + "fillsurface_extrude. 8 nodes." },
  { key: "wideflange", name: "wideflange", file: "samples/wideflange.json",
    summary: "Nine wide flange sections, each a solved sketch, and a column "
           + "built from one of them: named numbers for where it stands, an "
           + "expression for its top, planes off those and an extrude between "
           + "them. The set it is in is what Instantiate copies. 34 nodes." },

  { key: "polyline", name: "polyline", file: "samples/polyline.json",
    summary: "The smallest thing that shows what a parallel curve is: eight points, "
           + "a polyline through them, and one offset held a distance from it the "
           + "whole way. Drag the distance and watch the corners - they run on "
           + "until they meet, they round, or they carry the tangent, and the node "
           + "says which. 12 nodes." },
  { key: "parallelcurveseries", name: "parallelcurveseries",
    file: "samples/parallelcurveseries.json",
    summary: "The same polyline, with a SERIES wired into the offset distance - so "
           + "the one node builds once for every number in the series and hands "
           + "them all on together. A setback drawing, or the contours of a bund. "
           + "Change the count and the whole family follows. 14 nodes." },
  { key: "sample-slab", name: "sample_slab_for_flow",
    file: "samples/sample_slab_for_flow.json",
    summary: "A slab, as simply as one can be said: an origin, three planes, a "
           + "sketch on one of them and a pad off it. The thing to open when you "
           + "want to see the shape of a document rather than a piece of "
           + "geometry. 14 nodes." },
  { key: "sample-cap", name: "Sample_Cap", file: "samples/Sample_Cap.json",
    summary: "Two caps driven by top-level named numbers: a radius and a height "
           + "each, arithmetic for the rest, and a fillet on every arris. Change "
           + "the radius and both caps follow - including the fillets, which is "
           + "the part that used to give up at large radii. 59 nodes." },
  { key: "samplecap-one", name: "samplecap_onecaponly",
    file: "samples/samplecap_onecaponly.json",
    summary: "One of those caps, with a GENERATOR in it: the same part written as "
           + "a plan that emits its own nodes, beside the hand-built one. What a "
           + "script node and a built tree look like side by side. 35 nodes." },
];

/* ------------------------------------------------------------- catalogue */

//! The script a new Script feature starts with: a spiral stair, whose treads,
//! risers, centre pole, stringer and handrail are separate solids driven by the
//! parameters it declares. Edit it and the feature becomes something else.
//! A third sample, and the most literal: the Heydar Aliyev Center. The roof
//! is one loft through section curves laid the way the building draws them -
//! rolled lip, valley on the ground, a rise through a 45-degree tangent to the
//! peak - and the steep face behind the peak is a mullion grid rather than
//! shell.
export const HEYDAR_CENTER = `({
  params: [
    { key: "length",      label: "Length",           def: 4200, min: 1500, max: 12000, step: 100 },
    { key: "width",       label: "Width",            def: 2600, min: 800,  max: 8000,  step: 100 },
    { key: "height",      label: "Peak height",      def: 1450, min: 400,  max: 4000,  step: 25 },
    { key: "lipHeight",   label: "Lip height",       def: 0.40, min: 0.15, max: 0.49,  step: 0.01, unit: "" },
    { key: "valleyAt",    label: "Valley at",        def: 0.43, min: 0.20, max: 0.60,  step: 0.01, unit: "" },
    { key: "peakAt",      label: "Peak at",          def: 0.92, min: 0.70, max: 0.97,  step: 0.01, unit: "" },
    { key: "soffit",      label: "Soffit height",    def: 0.17, min: 0.05, max: 0.45,  step: 0.01, unit: "" },
    { key: "soffitBack",  label: "Soffit reach",     def: 0.74, min: 0.45, max: 0.95,  step: 0.01, unit: "" },
    { key: "hookTail",    label: "Hook tail",        def: 0.20, min: 0.02, max: 0.40,  step: 0.01, unit: "" },
    { key: "lobes",       label: "Lobes",            def: 3,    min: 1,    max: 6,     step: 1, unit: "" },
    { key: "sections",    label: "Section curves",   def: 26,   min: 6,    max: 60,    step: 1, unit: "" },
    { key: "stations",    label: "Points per curve", def: 56,   min: 20,   max: 110,   step: 2, unit: "" },
    { key: "thickness",   label: "Shell thickness",  def: 34,   min: 6,    max: 160,   step: 2 },
    { key: "facade",      label: "Facade",           options: ["On", "Off"], def: 0 },
    { key: "mullionsU",   label: "Mullions across",  def: 30,   min: 4,    max: 70,    step: 1, unit: "" },
    { key: "mullionsV",   label: "Transoms",         def: 8,    min: 2,    max: 24,    step: 1, unit: "" },
    { key: "mullionSize", label: "Mullion size",     def: 30,   min: 6,    max: 120,   step: 2 },
  ],

  build(p, k) {
    /* ------------------------------------------------------------------
       One curve drives the whole roof. Read left to right it is:

         a hook - the skin runs out along the plaza, turns back on itself
                  and curls over at a lip LOWER than the mid-point
         a fall - the long slope down into a valley that touches the ground
         a rise - through a 45-degree tangent, to the peak
         a soffit - the steep drop behind the peak turns back under itself
                  and runs in, leaving the entrance overhang

       So the section is open at both ends and doubles back at both ends.
       Everything else is that curve, changed across the width and lofted.
       ------------------------------------------------------------------ */

    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = t => t * t * (3 - 2 * t);

    //! Catmull-Rom through the control polygon, parameterised by index - the
    //! curve turns back on itself at both ends, so it cannot be a function of x.
    const spline = (cps, t) => {
      const n = cps.length - 1;
      const x = Math.max(0, Math.min(1, t)) * n;
      const i = Math.min(n - 1, Math.floor(x));
      const f = x - i;
      const at = j => cps[Math.max(0, Math.min(n, j))];
      const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      const term = q => 0.5 * ((2 * b[q]) + (-a[q] + c[q]) * f
        + (2 * a[q] - 5 * b[q] + 4 * c[q] - d[q]) * f * f
        + (-a[q] + 3 * b[q] - 3 * c[q] + d[q]) * f * f * f);
      return [term(0), term(1)];
    };

    const controls = s => {
      const rise = s.peakAt - s.valleyAt;
      const lip = s.lip;
      const sof = s.soffit;
      return [
        [s.hookTail,            0.000],          // free edge, out on the plaza
        [s.hookTail * 0.42,     0.006],
        [0.032,                 0.034],
        [0.000,                 0.115],          // the turn at the far left
        [0.001,                 lip * 0.58],
        [0.020,                 lip * 0.89],
        [0.068,                 lip],            // the lip: lower than mid-point
        [0.150,                 lip * 0.96],
        [0.248,                 lip * 0.78],
        [0.338,                 lip * 0.47],
        [s.valleyAt - 0.045,    lip * 0.15],
        [s.valleyAt,            0.000],          // the valley, on the ground
        [s.valleyAt + rise*0.11, s.peak * 0.14],
        [s.valleyAt + rise*0.26, s.peak * 0.38], // the 45-degree tangent
        [s.valleyAt + rise*0.46, s.peak * 0.64],
        [s.valleyAt + rise*0.70, s.peak * 0.86],
        [s.valleyAt + rise*0.89, s.peak * 0.978],
        [s.peakAt,              s.peak],         // the peak
        [s.peakAt + (1-s.peakAt)*0.56, s.peak * 0.92],
        [1.000,                 s.peak * 0.62],
        [1.000,                 sof + (s.peak - sof) * 0.26],
        [0.986,                 sof * 1.12],
        [0.946,                 sof],            // turns back under itself
        [s.soffitBack + 0.055,  sof * 0.99],
        [s.soffitBack,          sof * 0.98],     // the free edge of the soffit
      ];
    };

    /* How the section changes across the width: the main peak stands at the
       front, and behind it the roof settles into lobes, each lower and drawn
       further forward - which is the roofscape rather than an extrusion. */
    const lobes = Math.max(1, Math.round(p.lobes));
    const sectionAt = v => {
      const fall = 1 - smooth(Math.min(1, v * 1.04));
      const ripple = 0.5 + 0.5 * Math.cos(v * Math.PI * 2 * lobes);
      const peak = Math.max(0.12, lerp(0.17, 1.0, fall) * lerp(0.74, 1.0, ripple));
      return {
        peak,
        lip: p.lipHeight * lerp(0.34, 1.0, fall),
        // The overhang cannot sit above the roof it hangs from.
        soffit: Math.min(p.soffit, peak * 0.45),
        soffitBack: lerp(0.90, p.soffitBack, fall),
        hookTail: p.hookTail * lerp(0.25, 1.0, fall),
        valleyAt: lerp(p.valleyAt * 0.74, p.valleyAt, fall),
        peakAt: lerp(p.peakAt - 0.20, p.peakAt, fall),
        span: lerp(0.64, 1.0, smooth(Math.min(1, (1 - v) * 1.55))),
        shift: (1 - fall) * 0.10 * p.length,
      };
    };

    const surface = (u, v) => {
      const s = sectionAt(v);
      const [along, up] = spline(controls(s), u);
      return [s.shift + along * p.length * s.span, v * p.width, up * p.height];
    };

    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
    const unit = a => {
      const l = Math.hypot(a[0], a[1], a[2]);
      return l < 1e-9 ? [0, 0, 1] : [a[0]/l, a[1]/l, a[2]/l];
    };
    const d = 6e-4;
    const normalAt = (u, v) => unit(cross(
      sub(surface(Math.min(1, u + d), v), surface(Math.max(0, u - d), v)),
      sub(surface(u, Math.min(1, v + d)), surface(u, Math.max(0, v - d)))));

    const sections = Math.max(3, Math.round(p.sections));
    const stations = Math.max(12, Math.round(p.stations));
    const half = p.thickness / 2;
    const parts = [];

    /* ---- the roof: the section curve given thickness, lofted across ---- */
    const profiles = [];
    for (let j = 0; j <= sections; j++) {
      const v = j / sections;
      const outer = [], inner = [];
      for (let i = 0; i <= stations; i++) {
        const u = i / stations;
        const point = surface(u, v);
        const n = normalAt(u, v);
        outer.push([point[0] + n[0]*half, point[1] + n[1]*half, point[2] + n[2]*half]);
        inner.push([point[0] - n[0]*half, point[1] - n[1]*half, point[2] - n[2]*half]);
      }
      profiles.push(k.polyline(outer.concat(inner.reverse()), { closed: true }));
    }
    parts.push(k.loft(profiles, { solid: true, ruled: true }));

    /* ---- the facade: the glazed wall standing under the overhang ----
       It hangs from the free edge of the soffit and meets the plaza, so its
       plan follows the roof's edge and every mullion leans with it. */
    if (Math.round(p.facade) === 0) {
      const across = Math.max(2, Math.round(p.mullionsU));
      const down = Math.max(2, Math.round(p.mullionsV));
      const size = p.mullionSize;
      const head = v => surface(1, v);
      const wall = (v, t) => {
        const top = head(v);
        return [top[0], top[1], lerp(top[2], 0, t)];
      };

      for (let i = 0; i <= across; i++) {
        const v = i / across;
        for (let s = 0; s < down; s++)
          parts.push(k.beam(wall(v, s / down), wall(v, (s + 1) / down), size, size));
      }
      for (let s = 0; s <= down; s++) {
        const t = s / down;
        for (let i = 0; i < across; i++)
          parts.push(k.beam(wall(i / across, t), wall((i + 1) / across, t),
                            size * 0.7, size * 0.7));
      }
    }

    return k.compound(parts);
  }
})`;

//! A second sample: the ribboned shell of a Heydar-Aliyev-like form. A
//! lofted driver surface, taken in bands with a gap between each - and the
//! driver surface itself never built, only the bands.
export const HEYDAR = `({
  params: [
    { key: "direction",  label: "Ribbon direction", options: ["U", "V"], def: 0 },
    { key: "ribbons",    label: "Ribbons",         def: 22,   min: 3,   max: 60,   step: 1, unit: "" },
    { key: "length",     label: "Length",          def: 3600, min: 800, max: 9000, step: 100 },
    { key: "width",      label: "Width",           def: 1500, min: 400, max: 4000, step: 50 },
    { key: "height",     label: "Peak height",     def: 1000, min: 200, max: 3000, step: 25 },
    { key: "solidRatio", label: "Ribbon / gap",    def: 0.62, min: 0.15,max: 0.95, step: 0.01, unit: "" },
    { key: "thickness",  label: "Ribbon thickness",def: 26,   min: 4,   max: 120,  step: 2 },
    { key: "stations",   label: "Loft stations",   def: 26,   min: 8,   max: 60,   step: 1, unit: "" },
    { key: "meander",    label: "Meander",         def: 240,  min: 0,   max: 1200, step: 20 },
    { key: "crownShift", label: "Crown shift",     def: 0.16, min: -0.6,max: 0.6,  step: 0.02, unit: "" },
  ],

  build(p, k) {
    /* ------------------------------------------------------------------
       The driver surface is never built. It is a loft through CV curves,
       and every band is a strip of it - so the strips are taken straight
       off the definition instead of slicing a surface that would only be
       thrown away.

       S(u, v): u runs the length of the building, v runs across a section
       from the ground on one side, over the crown, to the ground on the
       other.
       ------------------------------------------------------------------ */

    // The section's control polygon, normalised: ground, up over the crown,
    // and back down to ground. This is the CV curve the whole thing lofts from.
    const SECTION = [
      [-1.00, 0.00], [-0.86, 0.06], [-0.62, 0.30], [-0.34, 0.72],
      [-0.04, 1.00], [ 0.30, 0.94], [ 0.60, 0.66], [ 0.82, 0.30],
      [ 0.94, 0.09], [ 1.00, 0.00],
    ];

    // How the section grows and shrinks down the length: one dominant peak,
    // a trough, then a second swell that runs out to the ground.
    const HEIGHT = [0.06, 0.42, 0.86, 1.00, 0.83, 0.58, 0.72, 0.63, 0.34, 0.10, 0.02];
    const WIDTH  = [0.30, 0.62, 0.88, 1.00, 0.97, 0.86, 0.92, 0.88, 0.70, 0.44, 0.26];
    const DRIFT  = [-0.9, -0.62, -0.24, 0.04, 0.28, 0.42, 0.30, 0.06, -0.26, -0.62, -0.9];

    //! Catmull-Rom through a list of numbers, clamped at the ends.
    const alongList = (list, t) => {
      const n = list.length - 1;
      const x = Math.max(0, Math.min(1, t)) * n;
      const i = Math.min(n - 1, Math.floor(x));
      const f = x - i;
      const at = j => list[Math.max(0, Math.min(n, j))];
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      return 0.5 * ((2 * p1) + (-p0 + p2) * f
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
        + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
    };

    //! The same interpolation through the section's control points, which is
    //! what turns ten CVs into a smooth curve.
    const alongSection = t => {
      const n = SECTION.length - 1;
      const x = Math.max(0, Math.min(1, t)) * n;
      const i = Math.min(n - 1, Math.floor(x));
      const f = x - i;
      const at = j => SECTION[Math.max(0, Math.min(n, j))];
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      const term = c => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * f
        + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * f * f
        + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * f * f * f);
      return [term(0), term(1)];
    };

    const surface = (u, v) => {
      const h = alongList(HEIGHT, u) * p.height;
      const w = alongList(WIDTH, u) * p.width / 2;
      const drift = alongList(DRIFT, u) * p.meander;
      const [ny, nz] = alongSection(v);
      // The crown leans along the length, which is what stops it reading as
      // an extrusion.
      const lean = p.crownShift * p.width * 0.5 * Math.sin(Math.PI * u) * nz;
      return [u * p.length, drift + ny * w + lean, nz * h];
    };

    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
                             a[2] * b[0] - a[0] * b[2],
                             a[0] * b[1] - a[1] * b[0]];
    const unit = a => {
      const l = Math.hypot(a[0], a[1], a[2]);
      return l < 1e-9 ? [0, 0, 1] : [a[0] / l, a[1] / l, a[2] / l];
    };
    const step = 1e-3;

    //! The surface normal, from the two tangents. It is the direction the band
    //! is given its thickness in.
    const normalAt = (u, v) => {
      const du = sub(surface(Math.min(1, u + step), v), surface(Math.max(0, u - step), v));
      const dv = sub(surface(u, Math.min(1, v + step)), surface(u, Math.max(0, v - step)));
      return unit(cross(du, dv));
    };

    /* A ribbon is a strip of the surface: constant in one parameter, running
       the length of the other. Which is which is the only thing the direction
       switch changes - U lays them along the building, V wraps them over it. */
    const acrossV = Math.round(p.direction) === 0;
    const at = (run, band) => acrossV ? surface(run, band) : surface(band, run);
    const normalOn = (run, band) => acrossV ? normalAt(run, band) : normalAt(band, run);

    const count = Math.max(2, Math.round(p.ribbons));
    const stations = Math.max(4, Math.round(p.stations));
    const pitch = 1 / count;
    const solid = pitch * Math.max(0.05, Math.min(0.98, p.solidRatio));
    const half = p.thickness / 2;

    const strips = [];
    for (let i = 0; i < count; i++) {
      const b0 = i * pitch;
      const b1 = b0 + solid;

      // One closed section per station: the strip's width across the surface,
      // given thickness along the normal. Lofting these along the run is the
      // ribbon.
      const profiles = [];
      for (let s = 0; s <= stations; s++) {
        const run = s / stations;
        const a = at(run, b0);
        const c = at(run, b1);
        const n = normalOn(run, (b0 + b1) / 2);
        const out = [n[0] * half, n[1] * half, n[2] * half];
        profiles.push(k.polyline([
          [a[0] + out[0], a[1] + out[1], a[2] + out[2]],
          [c[0] + out[0], c[1] + out[1], c[2] + out[2]],
          [c[0] - out[0], c[1] - out[1], c[2] - out[2]],
          [a[0] - out[0], a[1] - out[1], a[2] - out[2]],
        ], { closed: true }));
      }
      strips.push(k.loft(profiles, { solid: true, ruled: true }));
    }

    return k.compound(strips);
  }
})`;

//! What a new Generator starts as: the power-copy. It reads a list of points
//! off whatever is wired into it, makes one copy of a named set per point, and
//! wires each copy's declared input to a point of its own. Change the list and
//! the number of copies changes with it - that is the whole feature, and it is
//! twelve lines.
export const POWER_COPY = `({
  params: [
    { key: "rise", label: "Rise per copy", def: 0, min: -2000, max: 2000, step: 10 },
  ],

  plan(p, doc) {
    // Everything that can be made, system nodes and user sets alike:
    //   doc.nodes().map(n => n.name + " (" + n.kind + ")")
    const set = doc.nodes().find(n => n.kind === "user");
    if (!set) return [];
    const where = doc.declared(set.name)[0];        // its first declared input

    const out = [];
    doc.points().forEach((at, i) => {
      out.push({ key: "at" + i, type: "Point",
                 name: "Station " + (i + 1),
                 set: { x: at[0], y: at[1], z: at[2] + i * p.rise } });
      out.push({ key: "of" + i, type: set.name,
                 name: set.name + "." + (i + 1),
                 inputs: where ? { [where]: "@at" + i } : {} });
    });
    return out;
  }
})`;

export const SPIRAL_STAIR = `({
  params: [
    { key: "steps",            label: "Steps",             def: 13,  min: 3,   max: 40,   step: 1, unit: "" },
    { key: "rise",             label: "Rise per step",     def: 190, min: 120, max: 280,  step: 5 },
    { key: "sweep",            label: "Total sweep",       def: 270, min: 90,  max: 1080, step: 5, unit: "deg" },
    { key: "innerRadius",      label: "Inner radius",      def: 110, min: 60,  max: 400,  step: 5 },
    { key: "outerRadius",      label: "Outer radius",      def: 700, min: 300, max: 1600, step: 10 },
    { key: "treadThickness",   label: "Tread thickness",   def: 45,  min: 10,  max: 90,   step: 1 },
    { key: "treadGap",         label: "Gap between treads",def: 2,   min: 0,   max: 20,   step: 0.5, unit: "deg" },
    { key: "riserThickness",   label: "Riser thickness",   def: 18,  min: 0,   max: 40,   step: 1 },
    { key: "poleRadius",       label: "Centre pole radius",def: 75,  min: 30,  max: 250,  step: 5 },
    { key: "stringerDepth",    label: "Stringer depth",    def: 180, min: 0,   max: 400,  step: 5 },
    { key: "stringerThickness",label: "Stringer thickness",def: 14,  min: 4,   max: 40,   step: 1 },
    { key: "railHeight",       label: "Handrail height",   def: 900, min: 700, max: 1200, step: 10 },
    { key: "railWidth",        label: "Handrail width",    def: 58,  min: 20,  max: 110,  step: 2 },
    { key: "railThickness",    label: "Handrail thickness",def: 34,  min: 12,  max: 90,   step: 2 },
  ],

  build(p, k) {
    const parts = [];
    const step  = p.sweep / p.steps;        // degrees of turn per tread
    const turns = p.sweep / 360;
    const climb = p.steps * p.rise;         // height gained over the whole run
    const pitch = climb / turns;            // rise per full turn, for the helices

    // Centre pole.
    parts.push(k.cylinder(p.poleRadius, climb + p.rise));

    // Tread and riser are modelled once. Every step is that same shape at a
    // different location, so the kernel builds and meshes them only once.
    const tread = k.sector(p.innerRadius, p.outerRadius, step - p.treadGap, p.treadThickness);
    const riser = p.riserThickness > 0
      ? k.box(p.outerRadius - p.innerRadius, p.riserThickness, p.rise - p.treadThickness,
              { at: [p.innerRadius, -p.riserThickness / 2, 0] })
      : null;

    for (let i = 0; i < p.steps; i++) {
      const angle = i * step;
      parts.push(k.move(k.rotate(tread, angle), [0, 0, (i + 1) * p.rise - p.treadThickness]));
      if (riser) parts.push(k.move(k.rotate(riser, angle), [0, 0, i * p.rise]));
    }

    // A section swept along a helix: one continuous solid, not a chain of
    // segments. The helix starts at [radius, 0, 0], so that is where the
    // profile is placed, facing along the tangent there; [1, 0, 0] is the
    // radial direction at that point, which is what puts a rail's width across
    // the stair rather than up it.
    const swept = (radius, z, profileAt) => {
      const spine = k.move(k.helix(radius, pitch, turns), [0, 0, z]);
      const tangent = k.helixTangent(radius, pitch);
      return k.sweep(profileAt([radius, 0, z], tangent), spine);
    };

    // Stringer: a rectangular section under the outer edge of the treads.
    if (p.stringerDepth > 0)
      parts.push(swept(p.outerRadius - p.stringerThickness / 2,
        p.rise - p.treadThickness - p.stringerDepth / 2,
        (at, tangent) => k.rectangle(p.stringerThickness, p.stringerDepth,
                                     { at, axis: tangent, xdir: [1, 0, 0] })));

    // Handrail: an elliptical section - wider than it is deep, the way a rail
    // sits in the hand - swept along the same helix a rail height above the
    // tread noses.
    parts.push(swept(p.outerRadius - p.railWidth / 2 - 30,
      p.rise + p.railHeight,
      (at, tangent) => k.ellipse(p.railWidth / 2, p.railThickness / 2,
                                 { at, axis: tangent, xdir: [1, 0, 0] })));

    return k.compound(parts);
  }
})`;

//! A number. Every one of these can also be driven by a wire from a feature
//! that produces numbers, in which case the slider shows what is arriving and
//! the stored literal is kept but not read. That is the whole of the
//! difference between a parameter and a computed value here.
const real = (key, label, def, min, max, step, unit = "mm") =>
  ({ key, label, kind: "real", def, min, max, step, unit });
//! One wire. \p accepts lists what a source may *produce*, not what type it is,
//! so a new feature that produces curves is accepted by every curve input
//! without any of them being told about it.
const ref = (key, label, accepts, consumes = false) =>
  ({ key, label, kind: "ref", accepts, consumes });
//! The same, but never guessed at. An input that OVERRIDES numbers already on
//! the node - a camera's position, which is three reals unless a point is
//! wired in instead - must arrive empty: wired to the first point in the
//! document it would quietly ignore what was typed, and on a camera it would
//! stand the eye on its own target and refuse to build.
const spare = (key, label, accepts) =>
  ({ key, label, kind: "ref", accepts, consumes: false, guess: false });
//! Many wires into one input, in order: the sections of a loft, the bodies of
//! a union. Held as child labels of the argument, each with its own
//! TDF_Reference.
const refs = (key, label, accepts, consumes = false) =>
  ({ key, label, kind: "refs", accepts, consumes });

//! Vertices someone moved by hand, as JSON on a label of its own:
//! {"12":[4,0,-2]} is vertex 12, pushed four along X and two down. Written by
//! dragging a handle in the viewport, and just as well by typing it into the
//! model file - which is the point.
const edits = (key, label, summary) => ({ key, label, kind: "edits", def: "{}", summary });

//! A 2D drawing, as JSON on a label of its own. Held exactly as it is drawn,
//! so the sketcher, the node editor and the model file are three windows onto
//! one string. Its geometry means nothing until the sketch's plane says where
//! it is - which is what makes a sketch a sketch.
const drawing = (key, label, summary) =>
  ({ key, label, kind: "sketch", def: JSON.stringify(EMPTY_SKETCH), summary });

//! What a feature hands downstream. An input accepts a set of these.
export const KINDS = ["number", "point", "vector", "axis", "curve", "plane",
                      "solid", "mesh", "text"];
const ANY = KINDS.slice();
//! Source the user edits, held as a TDataStd_AsciiString.
const code = (key, label, def) => ({ key, label, kind: "code", def });
//! One line of text the user types, held as a TDataStd_AsciiString. Same
//! storage as code, a different control: a field rather than an editor.
const text = (key, label, def, hint = "") => ({ key, label, kind: "text", def, hint });
//! Geometry that came from a file, held as a TDataStd_AsciiString like the two
//! above. What makes it its own kind is not how it is stored but that nobody
//! edits it: it is megabytes of B-Rep or OBJ, it travels in the model file so
//! the document stands on its own, and every surface that shows a model to a
//! person - the panel, the text box, the assistant's briefing - shows its size
//! instead of its contents.
const blob = (key, label, carries) => ({ key, label, kind: "blob", def: "", carries });
//! A fixed set of alternatives, held as a TDataStd_Integer index.
const choice = (key, label, options, def = 0) =>
  ({ key, label, kind: "choice", options, def });
//! Only shown, and only read, when another argument has this value. It is how
//! one feature carries two patterns without two features in the tree.
//! A LIST OF SUB-SHAPES PICKED OFF A BODY - which edges to round, which face
//! is the neutral one. Stored as text like the rest, and readable as text: an
//! entry says which feature the sub-shape belongs to, which kind it is, which
//! number it was, and where it was, so a person can check a pick against the
//! model rather than taking the file's word for it. See subshape.js.
//!
//! An EMPTY list is not "none". It is the operation's own default - every edge
//! for a fillet - because that is what the operation means when nobody has said
//! otherwise, and because a fillet that did nothing until you picked something
//! would be a worse fillet.
const subs = (key, label, of, summary, whole = "all of them") =>
  ({ key, label, kind: "subs", of, def: "[]", whole, summary });

const when = (arg, key, equals) => ({ ...arg, showWhen: { key, equals } });

//! The same, for an argument that belongs to SEVERAL of a choice's answers - a
//! starting mesh has a radius whether it is a disc, a cylinder or a sphere, and
//! writing that as three arguments would be three things to keep in step.
const whenAny = (arg, key, list) => ({ ...arg, showWhen: { key, any: list } });

//! The same builders, handed out - because a package declares its nodes in
//! exactly the form the catalogue above is written in, and a second way of
//! spelling an argument is a second thing that can be wrong about one.
export const ARG = { real, ref, spare, refs, choice, text, code, blob, edits, subs, drawing,
                     when, whenAny, ANY, KINDS };

//! WHAT A SET ASKS FOR, WRITTEN DOWN. A set's inputs are worked out live -
//! every wire that reaches into it from outside - and that is enough right up
//! until two things inside it read the SAME thing outside. Then they are one
//! input, not two, and the only way to know that once the wires have been cut
//! is to have written it down before they were. Which is exactly when it is
//! known: instantiating a set from a file drops those wires, and it knows
//! which of them shared a source.
//!
//! Empty on a set that was built by hand, because nothing has been cut and the
//! live answer is the whole answer.
//! OPEN OR SHUT. A container that is shut shows in the tree as one row with no
//! contents and offers, in its panel, the inputs it takes and every value
//! inside it that nothing is driving - which is what a user-defined feature is.
//! Right-click white-boxes it again and the tree is back.
//!
//! It is an ARGUMENT rather than a view setting because it belongs to the
//! model: somebody who builds a component and black-boxes it is saying what
//! the component IS, and that has to survive being saved and sent on.
const blackBox = () =>
  choice("shell", "Shown as", ["Open", "Black box"], 0);

const declaredInputs = () =>
  text("inputs", "Declared inputs", "",
       "the set's own argument list, as JSON - written when a set is "
       + "instantiated so that wires which shared one source stay one input");

//! One table drives the toolbar, the label layout (an argument's index here is
//! its OCAF child tag), the sliders and the neutral file format. It mirrors
//! ocaf/src/Schema.cxx entry for entry, GUIDs included.
export const CATALOGUE = [
  /* ------------------------------------------------------------- datums */
  //! One point node, not five. What it is a point OF is a choice on it, and the
  //! arguments change with the choice - the way a CAD modeller has always done
  //! it, and the reason the toolbar has one point button rather than a menu of
  //! them. Every kind still produces a point, so nothing downstream cares which
  //! one it was. Kind 0 is the plain one, so a file written before this loads
  //! unchanged.
  { type: "Point", guid: "9a1b2c30-0001-4c00-9e00-caf000000001", category: "datum",
    produces: "point",
    summary: "A location in space, found whichever way suits: typed in, along a curve, "
           + "the centre of a circle, the far end of something in a direction, where "
           + "two curves come closest, or a point dropped onto a plane or a surface. "
           + "Wire a list of numbers into a coordinate and one point becomes a row of "
           + "them - and a list of points projected onto a plane comes back as a list.",
    //! ON A PLANE IS APPENDED, never inserted: the index of an option is what
    //! a document stores, and reordering this list would turn every saved
    //! "Centre of" into something else.
    //!
    //! It is the default a person gets, and it is NOT the default here. A
    //! point on a plane needs a plane, and whether there is one is a fact
    //! about the document rather than about the catalogue - so the rule lives
    //! where the document is known, in the add path, and this stays
    //! Coordinates. That also keeps {"op":"add","type":"Point"} followed by
    //! setting x, y and z doing what it has always done, which is the most
    //! basic thing anybody writes in this language.
    args: [choice("kind", "Point", ["Coordinates", "On a curve", "Centre of",
                                    "Extreme along", "Between two curves",
                                    "Projected onto", "On a plane"], 0),
           when(real("x", "X", 0, -2000, 2000, 0.5), "kind", 0),
           when(real("y", "Y", 0, -2000, 2000, 0.5), "kind", 0),
           when(real("z", "Z", 0, -2000, 2000, 0.5), "kind", 0),
           when(ref("curve", "Curve", ["curve"]), "kind", 1),
           when(real("at", "Along it", 0.5, 0, 1, 0.01, ""), "kind", 1),
           when(ref("of", "Circle or arc", ["curve"]), "kind", 2),
           when(ref("shape", "Shape", ["curve", "plane", "solid", "mesh"]), "kind", 3),
           when(ref("along", "Direction", ["vector"]), "kind", 3),
           when(choice("end", "Which end", ["Furthest along", "Furthest back"], 0), "kind", 3),
           when(ref("first", "First curve", ["curve"]), "kind", 4),
           when(ref("second", "Second curve", ["curve"]), "kind", 4),
           when(ref("what", "Point", ["point"]), "kind", 5),
           when(ref("onto", "Onto", ["plane", "solid", "curve", "mesh"]), "kind", 5),
           when(choice("way", "How", ["Nearest point", "Straight down"], 0),
                "kind", 5),
           //! APPENDED, as every new argument is: the index is the tag on
           //! disk. The plane is wired the way every other plane input is, so
           //! a new point lands on the first plane in the document - which in
           //! a part that opens on its origin is the XY plane.
           when(ref("plane", "Plane", ["plane"]), "kind", 6),
           //! H and V, not X and Y: they are measured IN the plane, along its
           //! own two directions, so a point stays where it was put when the
           //! plane is turned. Calling them X and Y would be inviting somebody
           //! to type world coordinates into them.
           when(real("h", "H", 0, -4000, 4000, 0.5), "kind", 6),
           when(real("v", "V", 0, -4000, 4000, 0.5), "kind", 6)] },
  //! And one vector node, the same way the point node works. A direction typed
  //! in and a direction read off the model are the same thing to everything
  //! downstream, so they are two settings of one node.
  //!
  //! The tangent is asked for AT A POINT rather than at a parameter. A point is
  //! already a thing in the document - one mounted on the curve, the centre of
  //! something, the end of something else - and it moves when the model moves.
  //! A parameter is a number that has to be kept in step with it by hand, and a
  //! plane standing on the point with a normal taken at some other parameter is
  //! a plane that is not square to the curve at the point it is standing on.
  { type: "Vector", guid: "9a1b2c30-0002-4c00-9e00-caf000000002", category: "datum",
    produces: "vector",
    summary: "A direction, typed in or read off the model: three components, or the "
           + "tangent to a curve at a point on it. Orients lines, planes and the "
           + "solids placed on them.",
    args: [choice("kind", "Vector", ["Components", "Tangent at a point"], 0),
           when(real("dx", "dX", 0, -100, 100, 0.1, ""), "kind", 0),
           when(real("dy", "dY", 0, -100, 100, 0.1, ""), "kind", 0),
           when(real("dz", "dZ", 1, -100, 100, 0.1, ""), "kind", 0),
           when(ref("curve", "Curve", ["curve"]), "kind", 1),
           when(ref("at", "Point on it", ["point"]), "kind", 1)] },
  //! One line node, the same way. What it runs between is a choice; how far it
  //! runs is another. A line may be cut by a length either side of where it
  //! starts, or stopped dead on a plane - which is what a construction line
  //! usually wants and cannot say with a number.
  { type: "Line", guid: "9a1b2c30-0003-4c00-9e00-caf000000003", category: "datum",
    produces: "curve",
    summary: "A straight line, found whichever way suits: from a point along a "
           + "direction, between two points, normal to a plane, tangent to a curve, or "
           + "the axis of a cylinder. Its ends are two lengths from where it starts, or "
           + "a plane it runs into.",
    args: [choice("kind", "Line", ["Point and direction", "Between two points",
                                   "Normal to a plane", "Tangent to a curve",
                                   "Axis of"], 0),
           when(ref("origin", "Start point", ["point"]), "kind", 0),
           when(ref("direction", "Direction", ["vector"]), "kind", 0),
           when(ref("from", "From point", ["point"]), "kind", 1),
           when(ref("to", "To point", ["point"]), "kind", 1),
           when(ref("plane", "Plane", ["plane"]), "kind", 2),
           when(ref("at", "Through point", ["point"]), "kind", 2),
           when(ref("curve", "Curve", ["curve"]), "kind", 3),
           when(real("along", "Along it", 0.5, 0, 1, 0.01, ""), "kind", 3),
           when(ref("shape", "Cylinder or cone", ["solid", "plane"]), "kind", 4),
           choice("limit", "Ends", ["Two lengths", "Onto a plane"], 0),
           when(real("start", "Back to", 0, -4000, 4000, 1), "limit", 0),
           when(real("length", "Forward to", 100, -4000, 4000, 1), "limit", 0),
           when(ref("until", "Until", ["plane"]), "limit", 1)] },
  //! And one plane node. Offsetting a plane, bisecting two, standing one on the
  //! end of a curve and turning one about an axis are four different questions
  //! with the same answer, so they are four settings of one node rather than
  //! four nodes.
  { type: "Plane", guid: "9a1b2c30-0004-4c00-9e00-caf000000004", category: "datum",
    produces: "plane",
    summary: "A planar datum, found whichever way suits: an origin and a normal, square "
           + "across a curve, offset from another plane, halfway between two, or one "
           + "turned about an axis. The normal takes a line as readily as a vector - a "
           + "direction is a direction - so a plane stands square to a tangent by "
           + "being given it.",
    args: [choice("kind", "Plane", ["Origin and normal", "Normal to a curve",
                                    "Offset from a plane", "Between two planes",
                                    "Turned about an axis"], 0),
           when(ref("origin", "Origin", ["point"]), "kind", 0),
           when(ref("normal", "Normal", ["vector", "curve"]), "kind", 0),
           when(ref("curve", "Curve", ["curve"]), "kind", 1),
           when(real("at", "Along it", 0.5, 0, 1, 0.01, ""), "kind", 1),
           when(ref("from", "Plane", ["plane"]), "kind", 2),
           when(real("offset", "Offset", 100, -4000, 4000, 1), "kind", 2),
           when(ref("a", "First plane", ["plane"]), "kind", 3),
           when(ref("b", "Second plane", ["plane"]), "kind", 3),
           when(ref("turn", "Plane", ["plane"]), "kind", 4),
           when(ref("axis", "Axis", ["vector", "curve"]), "kind", 4),
           when(real("angle", "Angle", 45, -360, 360, 1, "°"), "kind", 4),
           real("size", "Display size", 160, 10, 2000, 5),
           //! WHICH WAY IS SIDEWAYS ON IT, for the plane asked for from an
           //! origin and a normal. A normal alone fixes the plane but not the
           //! paper on it: OpenCascade picks an X direction and it is whichever
           //! one its arithmetic reaches, so a rectangle sketched on that plane
           //! sits at an angle nobody chose. Everywhere a drawing comes from
           //! something that STATED its axes - an imported IFC element, a
           //! placement out of a STEP assembly, a datum meant to agree with
           //! another - this is the argument that says so.
           //!
           //! Appended, because an argument's place in this list is its tag in
           //! the document. Left empty it changes nothing, which is what every
           //! file written before it says.
           when(spare("xdir", "X direction", ["vector", "curve"]), "kind", 0)] },
  //! An axis system is a placement: an origin and three directions, the thing
  //! CATIA puts under every part and every transform. Wire one into a Move or a
  //! Rotate and the shape follows it; wire two into Axis to axis and the shape
  //! goes from one to the other, which is how a part is positioned in an
  //! assembly without a single typed coordinate.
  //!
  //! Right-handed, always. X is taken as given, Y is squared up against it, and
  //! Z is X cross Y - so a pair of directions that are not quite perpendicular
  //! still makes a frame rather than an error.
  //! A CAMERA IS A THING, not a mood the window was in.
  //!
  //! Every view worth having gets lost: somebody orbits, somebody else opens
  //! the file, and the shot that explained the scheme is gone. A camera in the
  //! tree is a shot you can come back to, wire a number into, move with a
  //! widget and hand to somebody else in the model file - and because it is an
  //! axis system with a lens on it, everything that takes a frame takes one.
  //!
  //! Where it stands and what it looks at are numbers, with a point to wire in
  //! instead when you would rather they followed something. Both, because a
  //! camera you cannot type a coordinate into is a camera you cannot put back
  //! where it was, and a camera that cannot follow a point is a camera that
  //! cannot track a building as it moves.
  { type: "Camera", guid: "9a1b2c30-0006-4c00-9e00-caf000000006", category: "datum",
    produces: "axis",
    summary: "A camera: where it stands, what it looks at, and what lens is on it. "
           + "Press Look through and the viewport becomes it; everything you do to the "
           + "view while you are in there is written back into these numbers, so the "
           + "shot is something the document holds. Safe frames show what a 16:9 or an "
           + "A3 will actually catch.",
    args: [spare("at", "Stands at", ["point"]),
           real("x", "X", 6000, -1000000, 1000000, 10),
           real("y", "Y", -9000, -1000000, 1000000, 10),
           real("z", "Z", 1700, -1000000, 1000000, 10),
           spare("look", "Looks at", ["point"]),
           real("tx", "Target X", 0, -1000000, 1000000, 10),
           real("ty", "Target Y", 0, -1000000, 1000000, 10),
           real("tz", "Target Z", 1700, -1000000, 1000000, 10),
           real("lens", "Lens", 35, 6, 600, 1, " mm"),
           real("roll", "Roll", 0, -180, 180, 0.5, "\u00b0"),
           choice("frame", "Frame",
                  ["16:9", "3:2", "4:3", "1:1", "2:1", "9:16 upright", "A4 landscape",
                   "A3 landscape"], 0),
           choice("safe", "Safe frames", ["Off", "Action and title", "Thirds", "Both"], 3),
           real("size", "Drawn size", 600, 20, 20000, 10)] },
  { type: "AxisSystem", guid: "9a1b2c30-0005-4c00-9e00-caf000000005", category: "datum",
    produces: "axis",
    summary: "An origin and three directions - the placement a transform is measured "
           + "in. Found from directions, from three points, or from a plane. Right "
           + "handed: Y is squared against X, and Z is X cross Y.",
    args: [choice("kind", "Axis system", ["Origin and directions", "Three points",
                                          "From a plane"], 0),
           when(ref("origin", "Origin", ["point"]), "kind", 0),
           when(ref("xdir", "X direction", ["vector", "curve"]), "kind", 0),
           when(ref("ydir", "Y direction", ["vector", "curve"]), "kind", 0),
           when(ref("at", "Origin", ["point"]), "kind", 1),
           when(ref("alongX", "Point on X", ["point"]), "kind", 1),
           when(ref("inPlane", "Point in the XY plane", ["point"]), "kind", 1),
           when(ref("plane", "Plane", ["plane"]), "kind", 2),
           real("size", "Display size", 200, 10, 20000, 5)] },

  /* --------------------------------------------------------------- data
     Nothing here makes geometry. They make the numbers geometry is made of,
     and they are wired into any slider in the document. */
  { type: "Number", guid: "9a1b2c30-0040-4c00-9e00-caf000000040", category: "data",
    produces: "number",
    summary: "One number, on a slider of its own, to be wired into as many inputs "
           + "as you like. Change it once and everything reading it rebuilds.",
    args: [real("value", "Value", 100, -10000, 10000, 0.1, "")] },
  { type: "Series", guid: "9a1b2c30-0041-4c00-9e00-caf000000041", category: "data",
    produces: "number",
    summary: "A list of numbers: a start, a step, and how many. Wire it into a "
           + "coordinate of a Point and you have a row of points.",
    args: [real("start", "Start", 0, -10000, 10000, 1, ""),
           real("step", "Step", 10, -1000, 1000, 0.5, ""),
           real("count", "Count", 10, 1, 400, 1, "")] },
  { type: "Range", guid: "9a1b2c30-0042-4c00-9e00-caf000000042", category: "data",
    produces: "number",
    summary: "A list of numbers spread evenly between two bounds - the parameters "
           + "along a curve, the stations across a surface.",
    args: [real("from", "From", 0, -10000, 10000, 0.01, ""),
           real("to", "To", 1, -10000, 10000, 0.01, ""),
           real("steps", "Steps", 10, 1, 400, 1, "")] },
  { type: "Math", guid: "9a1b2c30-0043-4c00-9e00-caf000000043", category: "data",
    produces: "number",
    summary: "Two numbers and an operation. Both inputs take wires, and if either "
           + "carries a list the answer is a list of the same length.",
    args: [real("a", "A", 1, -10000, 10000, 0.1, ""),
           real("b", "B", 1, -10000, 10000, 0.1, ""),
           choice("op", "Operation",
                  ["A + B", "A − B", "A × B", "A ÷ B", "A ^ B", "min", "max", "A mod B"], 0)] },
  { type: "Expression", guid: "9a1b2c30-0044-4c00-9e00-caf000000044", category: "data",
    produces: "number",
    summary: "A formula over three wired numbers. Written as JavaScript over a, b and "
           + "c, with i and n bound to the position and length when a list arrives.",
    args: [real("a", "A", 1, -10000, 10000, 0.1, ""),
           real("b", "B", 1, -10000, 10000, 0.1, ""),
           real("c", "C", 0, -10000, 10000, 0.1, ""),
           code("formula", "Formula", "a * Math.sin(b * i / n) + c")] },
  { type: "Numbers", guid: "9a1b2c30-0046-4c00-9e00-caf000000046", category: "data",
    produces: "number",
    summary: "A list of numbers, typed. Where a Series gives an even run, this gives the "
           + "ones you actually meant - the turn of each villa, the corners of a rectangle.",
    args: [text("values", "Values", "0, 10, 20", "separated by commas or spaces"),
           real("scale", "Scale", 1, -1000, 1000, 0.01, "")] },
  //! THE SEQUENCE THAT EXPLAINS THE SCHEME, in the model file with the model.
  //! Every office rebuilds this by hand in a slide deck, with screenshots that
  //! go stale the moment the model changes. A beat is where the camera is,
  //! what is showing, what the numbers are set to, and a sentence about why -
  //! so the deck IS the model, and it cannot go stale.
  { type: "Story", guid: "9a1b2c30-0047-4c00-9e00-caf000000047", category: "data",
    produces: "text",
    summary: "A sequence that explains the scheme: beats, each one a camera to fly to, "
           + "a few numbers to arrive at, what to show and hide, and a sentence or two "
           + "about why. Press Present and it plays full screen with the narrative "
           + "underneath. Nothing in it is a screenshot, so it is as live as the model.",
    args: [code("beats", "Beats",
                "[\n  { \"name\": \"The site\", \"text\": \"Nine hundred metres of "
                + "frontage, and one way in.\",\n    \"camera\": \"CAM1\", \"seconds\": 3, "
                + "\"hold\": 5 }\n]"),
           real("speed", "Speed", 1, 0.1, 6, 0.1, "\u00d7"),
           choice("captions", "Narrative", ["Show it", "Hide it"], 0)] },
  { type: "Panel", guid: "9a1b2c30-0045-4c00-9e00-caf000000045", category: "data",
    produces: "text",
    summary: "Shows what is wired into it, as text, in the node and in the definition "
           + "panel. It builds nothing; it is how you see what is flowing.",
    args: [ref("input", "Input", ANY)] },

  /* ------------------------------------------------------------- curves */
  //! The sketch. Everything a CAD modeller draws in two dimensions before it
  //! becomes three: the drawing itself is one JSON string on one label, the
  //! plane and the origin are wires, and the loops it closes come out as
  //! planar faces ready to be padded.
  { type: "Sketch", guid: "9a1b2c30-0090-4c00-9e00-caf000000090", category: "curve",
    produces: "curve",
    summary: "A 2D drawing on a plane. Lines, arcs, circles, ellipses, oblongs, points "
           + "and splines, in the plane's own u-v coordinates, held with their "
           + "constraints as JSON. Point it at a different plane or origin and the "
           + "whole drawing moves. Closed loops come out as planar faces, ready to "
           + "extrude into a pad.",
    args: [ref("plane", "Plane", ["plane"]), ref("origin", "Origin", ["point"]),
           drawing("drawing", "Drawing",
                   "the 2D elements and their constraints, as JSON: "
                   + "{\"elements\":[{\"id\":\"e1\",\"type\":\"line\","
                   + "\"a\":[0,0],\"b\":[100,0]}],\"constraints\":[]}"),
           choice("faces", "Closed loops", ["Make faces", "Leave as wires"], 0),
           choice("solve", "Constraints", ["Solve", "Ignore"], 0),
           real("passes", "Solver passes", 24, 1, 400, 1, "")] },
  //! THE ARGUMENTS ARE APPENDED, never inserted. An argument's index here is
  //! its OCAF child tag, so putting the centre in front of the radius would
  //! quietly read every circle in every file already saved as having its
  //! radius where its centre is. New questions go at the end, whatever that
  //! does to the order they are asked in.
  { type: "Circle", guid: "9a1b2c30-0050-4c00-9e00-caf000000050", category: "curve",
    produces: "curve",
    summary: "A circle on a plane, standing where you say. Wire a point into the "
           + "centre and it stands there; say whether the plane is only telling it "
           + "which way to face or is also the height it sits at. Its size is a "
           + "radius, or a point it has to pass through. A circle found from what it "
           + "must TOUCH is the constrained circle instead.",
    args: [ref("plane", "Plane", ["plane"]), real("radius", "Radius", 60, 0.5, 4000, 0.5),
           spare("centre", "Centre", ["point"]),
           //! THE QUESTION THE USER ASKED FOR, in the words it was asked in: a
           //! plane may be the SUPPORT a circle lies on, or only the direction
           //! it faces. Dropped onto the plane, a centre two metres above it
           //! makes a circle on the plane; left alone, it makes one two metres
           //! up, parallel to it.
           choice("onPlane", "The plane",
                  ["Only says which way it faces", "Is what it lies on"], 0),
           choice("kind", "Its size is", ["A radius", "A point it passes through"], 0),
           when(spare("through", "Passes through", ["point"]), "kind", 1)] },
  { type: "Ellipse", guid: "9a1b2c30-0056-4c00-9e00-caf000000056", category: "curve",
    produces: "curve",
    summary: "An ellipse on a plane: a long radius, a short one, and the angle the "
           + "long one is turned to within the plane. Wire a point into the centre "
           + "to stand it somewhere, and a second into the long axis to point it at "
           + "something rather than typing the angle.",
    args: [ref("plane", "Plane", ["plane"]), spare("centre", "Centre", ["point"]),
           choice("onPlane", "The plane",
                  ["Only says which way it faces", "Is what it lies on"], 0),
           real("major", "Long radius", 120, 0.5, 100000, 0.5),
           real("minor", "Short radius", 70, 0.5, 100000, 0.5),
           real("angle", "Turned by", 0, -180, 180, 0.5, "\u00b0"),
           spare("towards", "Long axis towards", ["point"]),
           choice("trim", "Draw", ["The whole ellipse", "An arc of it"], 0),
           when(real("from", "From", 0, -360, 360, 1, "\u00b0"), "trim", 1),
           when(real("to", "To", 180, -360, 360, 1, "\u00b0"), "trim", 1)] },
  //! A PARABOLA AND A HYPERBOLA ARE ONE NODE, because they are one question -
  //! how sharply does it open - and because this build carries neither
  //! gp_Parab nor gp_Hypr, so both arrive the same way: sampled. A conic drawn
  //! as two hundred segments lofts, sweeps and measures exactly as a conic
  //! does; what it cannot do is come back out of a STEP file calling itself a
  //! parabola, which is worth saying rather than hiding.
  { type: "Conic", guid: "9a1b2c30-0057-4c00-9e00-caf000000057", category: "curve",
    produces: "curve",
    summary: "A parabola or a hyperbola on a plane, standing on its apex and opening "
           + "along the plane's own direction unless you turn it. Its shape is the "
           + "focal distance - how far the focus is from the apex - and how far out "
           + "to draw it.",
    args: [ref("plane", "Plane", ["plane"]), spare("apex", "Apex", ["point"]),
           choice("onPlane", "The plane",
                  ["Only says which way it faces", "Is what it lies on"], 0),
           choice("kind", "Which", ["Parabola", "Hyperbola"], 0),
           real("focal", "Focal distance", 60, 0.1, 100000, 0.5),
           when(real("minor", "Short radius", 60, 0.1, 100000, 0.5), "kind", 1),
           real("extent", "How far out", 300, 1, 100000, 1),
           real("angle", "Turned by", 0, -180, 180, 0.5, "\u00b0"),
           real("steps", "Smoothness", 96, 8, 1200, 1, "")] },
  { type: "Oblong", guid: "9a1b2c30-0058-4c00-9e00-caf000000058", category: "curve",
    produces: "curve",
    summary: "A slot: two straight sides and a half-circle at each end. The shape a "
           + "bolt hole is, and the one a running track is - given as a length "
           + "overall and a width across.",
    args: [ref("plane", "Plane", ["plane"]), spare("centre", "Centre", ["point"]),
           choice("onPlane", "The plane",
                  ["Only says which way it faces", "Is what it lies on"], 0),
           real("length", "Length", 240, 0.5, 100000, 0.5),
           real("width", "Width", 80, 0.5, 100000, 0.5),
           real("angle", "Turned by", 0, -180, 180, 0.5, "\u00b0")] },
  //! ONE RECTANGLE, WITH A CORNER RADIUS. A rounded rectangle is a rectangle
  //! whose corners have a radius, and two nodes for that would be two places
  //! to change a width. Nought is square, which is what a rectangle has always
  //! been.
  { type: "Rectangle", guid: "9a1b2c30-0059-4c00-9e00-caf000000059", category: "curve",
    produces: "curve",
    summary: "A rectangle on a plane, square-cornered or rounded - the corner radius "
           + "is a number on the node, and nought is square. Anchored at its middle "
           + "or at a corner, whichever suits what it is being lined up with.",
    args: [ref("plane", "Plane", ["plane"]), spare("at", "At", ["point"]),
           choice("onPlane", "The plane",
                  ["Only says which way it faces", "Is what it lies on"], 0),
           real("width", "Width", 240, 0.5, 100000, 0.5),
           real("height", "Height", 160, 0.5, 100000, 0.5),
           real("radius", "Corner radius", 0, 0, 100000, 0.5),
           choice("anchor", "The point is", ["Its middle", "A corner"], 0),
           real("angle", "Turned by", 0, -180, 180, 0.5, "\u00b0")] },
  //! ROUNDING THE CORNERS OF A CURVE, which is the 2D fillet - and every
  //! corner by default, the way the solid fillet takes every edge by default.
  //! Clicking the ones you want in the viewport narrows it, the same gesture
  //! and the same storage.
  { type: "FilletCurve", guid: "9a1b2c30-005b-4c00-9e00-caf00000005b", category: "curve",
    produces: "curve",
    summary: "Rounds the corners of a curve. Every corner by default; click the "
           + "ones you want in the viewport to round only those. A corner between "
           + "two straight runs is rounded exactly; one where the curve already "
           + "turns smoothly is left alone and said so.",
    args: [ref("curve", "Curve", ["curve"], true),
           subs("corners", "Corners", "vertex",
                "which corners to round \u00b7 empty rounds every one",
                "every corner"),
           real("radius", "Radius", 20, 0.01, 100000, 0.5)] },

  /* ------------------------------------------- lines and circles from constraints

     A drawing office does not say "a circle at 40, 60 of radius 12". It says
     "the circle of radius 12 that touches that arc and that line, on the
     outside of both" - and the numbers fall out of the relation rather than
     the other way about. OpenCascade has a package for exactly this, GccAna,
     and the WebAssembly build shipped here does not carry it, so it is solved
     in gcc.js instead. Same constructions, same four qualifiers, same
     several-answers-and-you-pick-one.

     ONE NODE, NOT NINE. A circle from constraints is a circle whichever
     construction found it, so the construction is a choice on the node the
     same way the point node works, and everything downstream is none the
     wiser. */
  { type: "ConstrainedCircle", guid: "9a1b2c30-0053-4c00-9e00-caf000000053",
    category: "curve", produces: "curve",
    summary: "A circle found from what it must touch rather than from where it is. "
           + "Tangent to two things with a radius, tangent to three, tangent to two "
           + "and centred on a third, through three points - the constructions "
           + "GccAna offers. Several answers usually fit; say which side of each "
           + "argument you want to be on to narrow them, then pick from what is "
           + "left. Everything is worked out on the plane, so the things it "
           + "touches are read as they fall on it.",
    args: [ref("plane", "Plane", ["plane"]),
           choice("kind", "The circle is",
                  ["Tangent to two, with a radius", "Tangent to three",
                   "Tangent to two, centred on a third",
                   "Tangent to one, centred on another, with a radius",
                   "Tangent to one, centred at a point",
                   "Through three points", "Through two points, with a radius"], 0),
           ref("first", "First", ["curve", "point", "plane"]),
           whenAny(spare("second", "Second", ["curve", "point", "plane"]),
                   "kind", [0, 1, 2, 5, 6]),
           whenAny(spare("third", "Third", ["curve", "point", "plane"]), "kind", [1, 5]),
           whenAny(spare("on", "Centred on", ["curve", "plane"]), "kind", [2, 3]),
           when(spare("at", "Centred at", ["point"]), "kind", 4),
           whenAny(real("radius", "Radius", 60, 0.01, 100000, 0.5), "kind", [0, 3, 6]),
           whenAny(choice("askFirst", "Against the first",
                          ["Either side", "Outside it", "Inside it", "Around it"], 0),
                   "kind", [0, 1, 2, 3]),
           whenAny(choice("askSecond", "Against the second",
                          ["Either side", "Outside it", "Inside it", "Around it"], 0),
                   "kind", [0, 1, 2]),
           when(choice("askThird", "Against the third",
                       ["Either side", "Outside it", "Inside it", "Around it"], 0),
                "kind", 1),
           //! THE SECOND AND THIRD ARRIVE EMPTY. Guessed the way every other
           //! input is guessed, all three would point at the same feature and
           //! the node would be born asking for a circle tangent to one thing
           //! three times over. A constraint is about the relation BETWEEN
           //! things, so the things have to be said.
           //! WHICH OF THEM. Eight is the documentation's own number for a
           //! tangency to two circles, and no amount of qualifying always gets
           //! to one - so the last word is a number, and the note says how
           //! many there were to choose from.
           real("answer", "Which answer", 1, 1, 32, 1, ""),
           whenAny(choice("trim", "Draw",
                          ["The whole circle", "The arc between the points"], 0),
                   "kind", [5, 6])] },
  { type: "ConstrainedLine", guid: "9a1b2c30-0054-4c00-9e00-caf000000054",
    category: "curve", produces: "curve",
    summary: "A straight line found from what it must touch: tangent to two things, "
           + "or tangent to one and parallel, square, or at an angle to another. "
           + "A line has no ends, so it is drawn as a segment of the length you "
           + "ask for, centred between what it touches.",
    args: [ref("plane", "Plane", ["plane"]),
           choice("kind", "The line is",
                  ["Tangent to two", "Tangent to one, parallel to a line",
                   "Tangent to one, square to a line",
                   "Tangent to one, at an angle to a line"], 0),
           ref("first", "First", ["curve", "point", "plane"]),
           when(spare("second", "Second", ["curve", "point", "plane"]), "kind", 0),
           whenAny(spare("reference", "Reference line", ["curve", "vector", "axis"]),
                   "kind", [1, 2, 3]),
           when(real("angle", "Angle", 30, -180, 180, 0.5, "\u00b0"), "kind", 3),
           when(choice("askFirst", "Against the first",
                       ["Either side", "Outside it", "Inside it"], 0), "kind", 0),
           when(choice("askSecond", "Against the second",
                       ["Either side", "Outside it", "Inside it"], 0), "kind", 0),
           real("answer", "Which answer", 1, 1, 8, 1, ""),
           real("length", "Length", 400, 1, 100000, 1)] },
  { type: "Bisector", guid: "9a1b2c30-0055-4c00-9e00-caf000000055",
    category: "curve", produces: "curve",
    summary: "Everywhere that is equally far from two things. Between two points or "
           + "two lines that is a straight line; between a line and a point it is a "
           + "parabola; between a circle and a point inside it an ellipse, outside it "
           + "a hyperbola. The conics arrive as a fine run of segments, because this "
           + "build carries no parabola to hand back - they draw, loft and measure "
           + "the same either way.",
    args: [ref("plane", "Plane", ["plane"]),
           ref("first", "First", ["curve", "point", "plane"]),
           spare("second", "Second", ["curve", "point", "plane"]),
           real("span", "How far to draw it", 0, 0, 100000, 1),
           real("steps", "Smoothness", 96, 8, 1200, 1, "")] },
  //! THE BLEND CURVE, which CATIA calls exactly that. A spline through points
  //! is a spline; a spline that ARRIVES somewhere in a direction you chose is
  //! a piece of a design. The difference is one constraint per point, and
  //! whether it is honoured.
  //!
  //! Tangents are matched to points BY POSITION: the first wire into Tangents
  //! belongs to the first wire into Through, and so on. Fewer tangents than
  //! points is normal - the ones you did not say are worked out from the
  //! neighbours, the way a spline already does it.
  { type: "BlendCurve", guid: "9a1b2c30-005a-4c00-9e00-caf00000005a", category: "curve",
    produces: "curve",
    summary: "A smooth curve through points that LEAVES AND ARRIVES the way you say. "
           + "Wire in the points it passes through, and, for any of them, a direction "
           + "it has to be going at that point - a vector, an axis, or a straight "
           + "curve to run along. Tension is how hard the constraint pulls: 1 is the "
           + "natural spline, more bulges towards the direction, less tightens onto "
           + "the chord. One number for the whole curve, or one per point typed in "
           + "order.",
    args: [refs("points", "Through", ["point"]),
           refs("tangents", "Going which way", ["vector", "axis", "curve"]),
           real("tension", "Tension", 1, 0.05, 20, 0.05, ""),
           text("tensions", "Tension at each", "",
                "one per point, in order - 1, 2, 0.5 - and blank for the one above"),
           choice("ends", "Ends", ["Open", "Closed"], 0),
           choice("honour", "The directions are",
                  ["Honoured exactly", "A suggestion"], 0),
           real("steps", "Smoothness", 24, 2, 400, 1, "")] },
  { type: "Polyline", guid: "9a1b2c30-0051-4c00-9e00-caf000000051", category: "curve",
    produces: "curve",
    summary: "Straight segments through a list of points. Takes as many sources as "
           + "you wire into it, in the order they were wired - shift-drag to add "
           + "another rather than replace what is there.",
    args: [refs("points", "Points", ["point"]),
           choice("closed", "Ends", ["Open", "Closed"], 0)] },
  { type: "Interpolate", guid: "9a1b2c30-0052-4c00-9e00-caf000000052", category: "curve",
    produces: "curve",
    summary: "One smooth B-spline through a list of points - the control curve a "
           + "lofted surface is laid on.",
    args: [refs("points", "Points", ["point"]),
           choice("closed", "Ends", ["Open", "Closed"], 0),
           real("degree", "Degree", 3, 1, 8, 1, "")] },

  /* ----------------------------------------------------------- analysis
     The other direction: geometry back into numbers and points. */
  //! THE FILL SURFACE, with constraints - which is the class-A tool and the
  //! reason BRepOffsetAPI_MakeFilling exists. A boundary alone gives you a
  //! patch; a boundary where each curve also names a surface it has to meet
  //! TANGENTIALLY gives you a patch that disappears into the thing around it,
  //! which is the whole of corner-blending and most of car-body surfacing.
  //!
  //! Supports are matched to boundary curves BY POSITION, the way the blend
  //! curve matches tangents to points: the first wire into "Meeting" belongs
  //! to the first wire into "Boundary". Leave one out and that edge is only
  //! held in place, not held tangent.
  { type: "FillSurface", guid: "9a1b2c30-005c-4c00-9e00-caf00000005c", category: "body",
    produces: "solid",
    summary: "A surface through a boundary of curves, made to meet what is around it. "
           + "Each boundary curve may name a shape it has to touch, run tangent to, "
           + "or match the curvature of - and the patch may be made to pass through "
           + "points as well. Says how well it managed: the gap in millimetres, the "
           + "tangency in degrees, and the curvature.",
    args: [refs("boundary", "Boundary", ["curve"], true),
           refs("supports", "Meeting", ["solid", "plane", "curve"]),
           choice("continuity", "How it meets them",
                  ["Touching \u00b7 G0", "Tangent \u00b7 G1", "Curvature \u00b7 G2"], 1),
           text("each", "Or one per curve", "",
                "G0, G1, G2 - one per boundary curve, in order; blank uses the "
                + "setting above"),
           refs("through", "Passing through", ["point"]),
           real("degree", "Degree", 3, 2, 12, 1, ""),
           real("tolerance", "Tolerance", 0.01, 1e-5, 10, 0.001)] },
  { type: "EvaluateCurve", guid: "9a1b2c30-0060-4c00-9e00-caf000000060", category: "analysis",
    produces: "point",
    summary: "The point at a parameter along a curve, with its tangent drawn. Wire a "
           + "list of parameters in and a list of points comes out.",
    args: [ref("curve", "Curve", ["curve"]),
           real("t", "Parameter", 0.5, 0, 1, 0.001, ""),
           real("tangent", "Tangent length", 40, 0, 1000, 1)] },
  { type: "DivideCurve", guid: "9a1b2c30-0061-4c00-9e00-caf000000061", category: "analysis",
    produces: "point",
    summary: "A curve split into equal lengths, as a list of points.",
    args: [ref("curve", "Curve", ["curve"]),
           real("count", "Divisions", 10, 1, 400, 1, ""),
           choice("ends", "Ends", ["Include", "Exclude"], 0)] },
  { type: "EvaluateSurface", guid: "9a1b2c30-0062-4c00-9e00-caf000000062", category: "analysis",
    produces: "point",
    summary: "The point at (u, v) on a face of a shape, with its normal drawn. The "
           + "first face unless you pick one - which is what to do on a skin that has "
           + "several, because \"the first face\" is an accident of how it was built.",
    args: [ref("surface", "Surface", ["plane", "solid", "curve"]),
           subs("face", "Face", "face",
                "which face to sample \u00b7 empty takes the first", "the first face"),
           real("u", "U", 0.5, 0, 1, 0.001, ""), real("v", "V", 0.5, 0, 1, 0.001, ""),
           real("normal", "Normal length", 40, 0, 1000, 1)] },
  { type: "Drape", guid: "9a1b2c30-0064-4c00-9e00-caf000000064", category: "analysis",
    produces: "point",
    summary: "Drops points straight down onto a surface, a solid or a mesh, and hands "
           + "back where they landed. The move that turns a flat plan into a site plan.",
    args: [refs("points", "Points", ["point"]),
           ref("onto", "Onto", ["solid", "plane", "mesh"]),
           real("lift", "Lift", 0, -2000, 2000, 1),
           choice("miss", "Points that miss", ["Drop them", "Leave them"], 0)] },
  { type: "Measure", guid: "9a1b2c30-0063-4c00-9e00-caf000000063", category: "analysis",
    produces: "number",
    summary: "A number taken off a shape - its length, its area, its volume, or the "
           + "size of its bounding box - to be wired back into the model.",
    args: [ref("shape", "Shape", ["curve", "plane", "solid", "point", "mesh"]),
           choice("quantity", "Quantity",
                  ["Length", "Area", "Volume", "Size X", "Size Y", "Size Z", "Diagonal",
                   "How many faces", "How many edges", "How many vertices"], 0)] },

  /* ------------------------------------------------------------- solids */
  { type: "Cube", guid: "9a1b2c30-0010-4c00-9e00-caf000000010", category: "body",
    produces: "solid",
    summary: "A box placed at a point, oriented by a plane, sized in three axes.",
    args: [ref("origin", "Corner point", ["point"]), ref("plane", "Placement plane", ["plane"]),
           real("dx", "Length X", 80, 1, 4000, 1), real("dy", "Length Y", 80, 1, 4000, 1),
           real("dz", "Length Z", 80, 1, 4000, 1)] },
  { type: "Sphere", guid: "9a1b2c30-0011-4c00-9e00-caf000000011", category: "body",
    produces: "solid",
    summary: "A sphere centred on a point.",
    args: [ref("center", "Centre point", ["point"]), real("radius", "Radius", 50, 1, 2000, 1)] },
  { type: "Script", guid: "9a1b2c30-0030-4c00-9e00-caf000000030", category: "body",
    produces: "solid",
    summary: "A feature you write. The code declares its own parameters and returns "
           + "a shape, so anything this build can make can become a feature. "
           + "This one starts as a spiral stair.",
    args: [code("code", "Code", SPIRAL_STAIR)] },
  { type: "Center", guid: "9a1b2c30-0032-4c00-9e00-caf000000032", category: "body",
    produces: "solid",
    summary: "A written feature starting from the Heydar Aliyev Center: a roof lofted "
           + "through section curves, and a soft grid of mullions on the glazed face "
           + "behind the peak.",
    args: [code("code", "Code", HEYDAR_CENTER)] },
  { type: "Ribbon", guid: "9a1b2c30-0031-4c00-9e00-caf000000031", category: "body",
    produces: "solid",
    summary: "The same written feature, starting from a different sample: a lofted "
           + "shell taken in bands with a gap between each, after Heydar Aliyev. The "
           + "driver surface is never built - only the bands cut from it.",
    args: [code("code", "Code", HEYDAR)] },

  /* --------------------------------------------------------------- mesh
     A polymesh: vertices, and faces of any number of sides. Not a B-Rep -
     there is no surface under it, only the polygons - which is why it can be
     pushed around by hand and subdivided into something smooth. */
  { type: "MeshBox", guid: "9a1b2c30-0080-4c00-9e00-caf000000080", category: "mesh",
    produces: "mesh",
    summary: "A box as a polymesh, divided as finely as you like. The starting point "
           + "for pushing vertices around, and for subdividing.",
    args: [ref("origin", "Corner point", ["point"]), ref("plane", "Placement plane", ["plane"]),
           real("dx", "Length X", 120, 1, 4000, 1), real("dy", "Length Y", 120, 1, 4000, 1),
           real("dz", "Length Z", 120, 1, 4000, 1),
           real("segX", "Divisions X", 1, 1, 40, 1, ""),
           real("segY", "Divisions Y", 1, 1, 40, 1, ""),
           real("segZ", "Divisions Z", 1, 1, 40, 1, "")] },
  { type: "MeshGrid", guid: "9a1b2c30-0081-4c00-9e00-caf000000081", category: "mesh",
    produces: "mesh",
    summary: "A flat grid of quads on a plane - a surface to push into shape.",
    args: [ref("plane", "Plane", ["plane"]),
           real("width", "Width", 400, 1, 8000, 5), real("depth", "Depth", 400, 1, 8000, 5),
           real("cols", "Columns", 6, 1, 120, 1, ""), real("rows", "Rows", 6, 1, 120, 1, "")] },
  { type: "MeshFromShape", guid: "9a1b2c30-0082-4c00-9e00-caf000000082", category: "mesh",
    produces: "mesh",
    summary: "Turns a solid into a polymesh by tessellating it, so anything the B-Rep "
           + "side builds can be welded, subdivided and pushed around by hand.",
    args: [ref("shape", "Shape", ["solid", "plane"], true),
           real("quality", "Tessellation", 1, 0.05, 8, 0.05, ""),
           choice("weld", "Vertices", ["Weld", "Leave as tessellated"], 0)] },
  { type: "EditMesh", guid: "9a1b2c30-0083-4c00-9e00-caf000000083", category: "mesh",
    produces: "mesh",
    summary: "The full mesh editor, as a node. Double-click it and the viewport goes "
           + "into edit mode: pick vertices, edges, faces, borders or whole elements "
           + "and extrude, bevel, inset, loop cut, bridge, dissolve, weld, crease - "
           + "everything a subdivision cage needs. NOTHING IS BAKED. What is stored is "
           + "the LIST of operations, and the list is replayed over whatever arrives "
           + "from upstream, so changing the cage underneath re-runs every edit on top "
           + "of it. That is what lets you change the topology here without touching "
           + "the work above.",
    args: [ref("mesh", "Mesh", ["mesh"], true),
           code("ops", "Operations", "[]"),
           edits("moves", "Moved vertices",
                 "vertex index → offset, as JSON: {\"12\": [4, 0, -2]}"),
           real("scale", "Move scale", 1, -8, 8, 0.05, "")] },
  { type: "MeshTemplate", guid: "9a1b2c30-008a-4c00-9e00-caf00000008a", category: "mesh",
    produces: "mesh",
    summary: "The mesh you start from. Nobody models a subdivision surface out of "
           + "nothing - it starts as a slab, a block, a ring, an L or a hexagon and is "
           + "pushed from there - so this is that first move as a node, all quads "
           + "wherever quads are possible, because a triangle in a cage is a permanent "
           + "pucker in the surface it means.",
    args: [choice("kind", "Shape", ["Plane", "Grid", "Box", "L-shape", "Cross", "Hexagon",
                                    "Honeycomb", "Disc", "Cylinder", "Tube", "Sphere",
                                    "Torus"], 1),
           ref("plane", "Placement plane", ["plane"]),
           whenAny(real("width", "Width", 1000, 1, 100000, 10), "kind", [0, 1, 3, 4]),
           whenAny(real("depth", "Depth", 1000, 1, 100000, 10), "kind", [0, 1, 3, 4]),
           whenAny(real("cols", "Columns", 4, 1, 200, 1, ""), "kind", [0, 1]),
           whenAny(real("rows", "Rows", 4, 1, 200, 1, ""), "kind", [0, 1, 8, 9, 10]),
           when(real("dx", "Length X", 1000, 1, 100000, 10), "kind", 2),
           when(real("dy", "Length Y", 1000, 1, 100000, 10), "kind", 2),
           when(real("dz", "Length Z", 1000, 1, 100000, 10), "kind", 2),
           when(real("segX", "Divisions X", 1, 1, 60, 1, ""), "kind", 2),
           when(real("segY", "Divisions Y", 1, 1, 60, 1, ""), "kind", 2),
           when(real("segZ", "Divisions Z", 1, 1, 60, 1, ""), "kind", 2),
           whenAny(real("arm", "Arm", 500, 1, 100000, 10), "kind", [3, 4]),
           whenAny(real("leg", "Leg", 500, 1, 100000, 10), "kind", [3, 4]),
           whenAny(real("grid", "Spacing", 250, 1, 20000, 5), "kind", [3, 4]),
           whenAny(real("radius", "Radius", 500, 1, 100000, 10), "kind", [5, 7, 8, 10, 11]),
           when(real("size", "Cell size", 200, 1, 20000, 5), "kind", 6),
           when(real("inner", "Inner radius", 250, 1, 100000, 10), "kind", 9),
           when(real("outer", "Outer radius", 500, 1, 100000, 10), "kind", 9),
           when(real("tube", "Tube radius", 160, 1, 100000, 5), "kind", 11),
           whenAny(real("height", "Height", 1000, 1, 100000, 10), "kind", [8, 9]),
           whenAny(real("rings", "Rings", 2, 1, 60, 1, ""), "kind", [5, 6, 7, 11]),
           whenAny(real("sides", "Sides", 12, 3, 200, 1, ""), "kind", [7, 8, 9, 10, 11]),
           when(choice("caps", "Ends", ["Capped", "Open"], 0), "kind", 8)] },
  { type: "MeshToShape", guid: "9a1b2c30-008b-4c00-9e00-caf00000008b", category: "body",
    produces: "solid",
    summary: "A cage back into B-Rep, the way Rhino turns a SubD into a NURBS object. "
           + "The mesh is subdivided to the level you ask for and every face of the "
           + "result is made into a planar face, and the faces are sewn - so a closed "
           + "cage comes out a solid you can fillet, boolean, section and write to "
           + "STEP. A smooth cage wants two or three levels; a faceted massing wants "
           + "none.",
    args: [ref("mesh", "Mesh", ["mesh"], true),
           real("levels", "Smooth by", 0, 0, 4, 1, ""),
           choice("boundary", "Open edges", ["Keep sharp", "Smooth"], 0),
           real("tolerance", "Sewing tolerance", 0.01, 0.000001, 100, 0.001),
           choice("solid", "Make", ["A solid if it closes", "A shell"], 0)] },
  { type: "Subdivide", guid: "9a1b2c30-0084-4c00-9e00-caf000000084", category: "mesh",
    produces: "mesh",
    summary: "Catmull-Clark subdivision. Every face becomes quads and the mesh pulls "
           + "towards a smooth surface. Switch it off to see and edit the cage. CREASES "
           + "set in the mesh editor are honoured here: an edge creased hard holds its "
           + "fold however many levels you ask for, which is how a subdivision model "
           + "gets an arris without packing extra loops against it by hand.",
    args: [ref("mesh", "Mesh", ["mesh"], true),
           choice("on", "Subdivision", ["On", "Off"], 0),
           real("levels", "Levels", 2, 1, 4, 1, ""),
           choice("boundary", "Open edges", ["Keep sharp", "Smooth"], 0),
           choice("shading", "Shading", ["Smooth", "Faceted"], 0)] },
  { type: "Weld", guid: "9a1b2c30-0085-4c00-9e00-caf000000085", category: "mesh",
    produces: "mesh",
    summary: "Merges vertices closer together than a distance, and drops the faces that "
           + "collapse when they do. What makes a tessellation into a mesh.",
    args: [ref("mesh", "Mesh", ["mesh"], true),
           real("tolerance", "Distance", 0.05, 0.0001, 100, 0.0001),
           choice("degenerate", "Collapsed faces", ["Remove", "Keep"], 0)] },
  { type: "FillHoles", guid: "9a1b2c30-0086-4c00-9e00-caf000000086", category: "mesh",
    produces: "mesh",
    summary: "Walks the open edges, chains them into loops, and closes each one. Weld "
           + "first if the hole is only two vertices sitting on top of each other.",
    args: [ref("mesh", "Mesh", ["mesh"], true),
           real("maxEdges", "Largest hole", 64, 3, 4000, 1, ""),
           choice("fill", "Fill with", ["One n-gon", "Fan from the middle"], 0)] },
  { type: "MeshMerge", guid: "9a1b2c30-0089-4c00-9e00-caf000000089", category: "mesh",
    produces: "mesh",
    summary: "Amalgamates two cages: finds the faces where they run into each other, "
           + "removes them, and bridges the openings left behind with quads. Not a CSG "
           + "boolean - it keeps the quad topology a subdivision needs.",
    args: [ref("a", "Mesh A", ["mesh"], true), ref("b", "Mesh B", ["mesh"], true),
           choice("mode", "Remove the faces", ["Inside the other", "Facing, within a distance"], 0),
           when(real("distance", "Distance", 40, 0.1, 2000, 0.5), "mode", 1),
           when(real("facing", "How square on", 0.35, 0, 1, 0.01, ""), "mode", 1),
           choice("bridge", "Openings", ["Bridge them", "Leave them open"], 0),
           choice("flip", "Bridge direction", ["As found", "Reversed"], 0),
           real("twist", "Twist", 0, -64, 64, 1, ""),
           real("weld", "Weld after", 0.05, 0, 200, 0.01)] },
  { type: "MeshTransform", guid: "9a1b2c30-0087-4c00-9e00-caf000000087", category: "mesh",
    produces: "mesh",
    summary: "Moves, turns and scales a mesh. Every number takes a wire, so this is "
           + "where a mesh is placed by arithmetic rather than by hand. One factor for "
           + "all of it, then a factor per axis - which is where a squash along one "
           + "direction lives: a sphere with Z at 0.4 is the flattened dome a B-Rep "
           + "transform cannot make.",
    args: [ref("mesh", "Mesh", ["mesh"], true),
           real("mx", "Move X", 0, -8000, 8000, 1), real("my", "Move Y", 0, -8000, 8000, 1),
           real("mz", "Move Z", 0, -8000, 8000, 1),
           real("rx", "Turn about X", 0, -360, 360, 1, "°"),
           real("ry", "Turn about Y", 0, -360, 360, 1, "°"),
           real("rz", "Turn about Z", 0, -360, 360, 1, "°"),
           real("scale", "Scale", 1, 0.01, 20, 0.01, ""),
           real("sx", "Scale X", 1, 0.01, 20, 0.01, ""),
           real("sy", "Scale Y", 1, 0.01, 20, 0.01, ""),
           real("sz", "Scale Z", 1, 0.01, 20, 0.01, "")] },
  { type: "MeshDisplace", guid: "9a1b2c30-0088-4c00-9e00-caf000000088", category: "mesh",
    produces: "mesh",
    summary: "Pushes every vertex along a direction by a formula over its own position. "
           + "The mathematical half of editing a mesh, next to the handles.",
    args: [ref("mesh", "Mesh", ["mesh"], true),
           choice("along", "Along", ["Vertex normal", "X", "Y", "Z"], 0),
           real("amount", "Amount", 20, -2000, 2000, 0.5),
           code("formula", "Formula",
                "Math.sin(x * 0.02) * Math.cos(y * 0.02)")] },

  /* --------------------------------------------------------- containers

     A folder that is also a node. CATIA files wireframe and surfaces into
     geometrical sets and solids into bodies, and the reason is not tidiness:
     it is that a set has a boundary, so you can ask what crosses it. Anything
     feeding the contents from outside is an input to the set, and that list is
     the honest answer to "what does this depend on" for a group of forty nodes
     that would otherwise have to be read one at a time.

     Containers drive no geometry. They hold nothing, build nothing and consume
     nothing - what is in one stays exactly as visible, as wired and as
     rebuildable as it was - so filing a node away can never change the part. */
  /* ----------------------------------------------------------- imported
     Geometry that arrived from a file. It has no recipe - there is nothing to
     drive, no argument to slide - so what it holds is the geometry itself,
     and rebuilding it means reading that back. That is the whole difference
     between an import and every other node here, and the reason an import
     can still be moved, cut, filleted and measured like anything else: what
     it hands downstream is an ordinary shape. */
  { type: "Imported", guid: "9a1b2c30-00b0-4c00-9e00-caf0000000b0", category: "body",
    produces: "solid", hidden: true,
    summary: "A solid or surface read from a file - STEP, or this modeller's own BREP. "
           + "Kept as the shape itself rather than as the file it came from, so it "
           + "rebuilds without the reader that first read it. Added by Import, not "
           + "from the toolbar.",
    args: [blob("brep", "Geometry", "B-Rep"), text("source", "From", "", "the file it came from")] },
  { type: "MeshImported", guid: "9a1b2c30-00b1-4c00-9e00-caf0000000b1", category: "mesh",
    produces: "mesh", hidden: true,
    summary: "A polymesh read from a file - OBJ or STL. Whatever the file was, it is "
           + "kept as OBJ: one format to read back, and a model file a person can "
           + "still read. Added by Import, not from the toolbar.",
    args: [blob("obj", "Geometry", "OBJ"), text("source", "From", "", "the file it came from"),
           choice("smooth", "Shading", ["Faceted", "Smooth"], 0)] },

  //! A FEATURE THAT WRITES FEATURES. Its code returns a list of nodes that
  //! should exist, not a shape; the reconciler makes the difference between
  //! that list and what is already filed under it. A container, because what
  //! it makes belongs to it - deleting it takes them, and black-boxing it
  //! shows the lot as one node.
  { type: "Generator", guid: "9a1b2c30-00a2-4c00-9e00-caf0000000a2",
    category: "container", produces: "text",
    summary: "A script that writes the model. It returns a list of nodes - system "
           + "types and sets somebody built, asked for the same way - and the number "
           + "of them follows whatever list is wired in, so feeding it more points "
           + "makes more copies and feeding it fewer removes the extras.",
    //! "reads" and not "inputs": declaredInputs() already owns that key, and
    //! two arguments with one key is not a clash anybody sees - the model file
    //! simply carries whichever was written last, and the plan reads an empty
    //! list and makes nothing. Found that way, too.
    args: [code("plan", "Plan", POWER_COPY),
           //! guess: false. Every other list input is worth auto-wiring to
           //! whatever was selected; this one is not. A generator wired by
           //! accident to the first datum in the document reads a point where
           //! a list was meant and makes nothing, silently - which is exactly
           //! how the first one behaved.
           { ...refs("reads", "Reads", KINDS.slice()), guess: false },
           text("made", "What it made", "",
                "which node answers which key - bookkeeping, not for editing"),
           choice("live", "Rebuild", ["On every change", "Paused"], 0),
           blackBox()] },
  { type: "GeometricalSet", guid: "9a1b2c30-00a0-4c00-9e00-caf0000000a0",
    category: "container", produces: "text",
    summary: "A folder for wireframe and surfaces - points, lines, planes, curves, "
           + "skins. Right-click it for what feeds it from outside, or to black-box "
           + "it so it reads as one node. Deleting it keeps everything in it and "
           + "hands it back to whatever the set was in.",
    args: [declaredInputs(), blackBox()] },
  { type: "Body", guid: "9a1b2c30-00a1-4c00-9e00-caf0000000a1",
    category: "container", produces: "text",
    summary: "A folder for solids - the bodies you add to and remove from. Same as a "
           + "geometrical set in every way but what belongs in it, which is the "
           + "distinction the two factories draw.",
    args: [declaredInputs(), blackBox()] },

  /* --------------------------------------------------------- operations */
  { type: "Extrude", guid: "9a1b2c30-0070-4c00-9e00-caf000000070", category: "operation",
    produces: "solid",
    summary: "Drags a profile along a direction. On Solid every closed loop in the "
           + "profile is capped and padded - a sketch of six loops pads into six "
           + "bodies. On Surface the wires are swept open instead, which is what to "
           + "use when the profile is a rib, a wall or a skin rather than a body.",
    args: [ref("profile", "Profile", ["curve", "plane"], true),
           //! Only asked for when the direction is not the profile's own. A
           //! `when` here is what stops it being auto-wired as well as what
           //! hides it, which is the point: a new extrude with "Normal to the
           //! profile" set has no direction wired at all, and that absence is
           //! what tells an old file apart from a new one. See the driver.
           when(ref("direction", "Direction", ["vector"]), "way", 1),
           choice("limit", "Limit", ["Distance", "Up to plane"], 0),
           when(real("distance", "Distance", 120, -4000, 4000, 1), "limit", 0),
           when(ref("until", "Up to", ["plane"]), "limit", 1),
           choice("cap", "Result", ["Solid", "Surface"], 0),
           //! APPENDED, and the default is Normal because that is what an
           //! extrude of a sketch means nine times in ten - a pad comes off
           //! the paper it was drawn on. Wiring a vector to say so was asking
           //! for a fact the profile already knows, and getting it wrong is
           //! how you extrude a plan sideways.
           choice("way", "Direction from",
                  ["Normal to the profile", "A direction"], 0)] },
  { type: "Loft", guid: "9a1b2c30-0071-4c00-9e00-caf000000071", category: "operation",
    produces: "solid",
    summary: "A skin through section curves, in the order they are wired. Two or more "
           + "sections; add another port by dragging into the empty one.",
    args: [refs("sections", "Sections", ["curve"], true),
           choice("cap", "Result", ["Solid", "Surface"], 0),
           choice("ruled", "Between sections", ["Smooth", "Ruled"], 0)] },
  { type: "Boolean", guid: "9a1b2c30-0072-4c00-9e00-caf000000072", category: "operation",
    produces: "solid",
    summary: "Union, difference or intersection of two solids. Both stay in the tree "
           + "and leave the 3D view.",
    args: [ref("a", "A", ["solid"], true), ref("b", "B", ["solid"], true),
           choice("op", "Operation", ["Union", "Difference", "Intersection"], 0)] },
  { type: "Project", guid: "9a1b2c30-0073-4c00-9e00-caf000000073", category: "operation",
    produces: "curve",
    summary: "Drops a curve onto a surface: sampled along its length, each sample "
           + "pulled to the nearest point on the target, and re-fitted.",
    args: [ref("curve", "Curve", ["curve"]), ref("onto", "Onto", ["plane", "solid"]),
           real("samples", "Samples", 40, 4, 400, 1, ""),
           choice("fit", "Result", ["Smooth", "Segments"], 0)] },
  //! One rail, one profile. The other half of extruding: a wall follows a
  //! direction, a handrail follows a curve, and everything with a constant
  //! section is one of the two.
  { type: "Sweep", guid: "9a1b2c30-0077-4c00-9e00-caf000000077", category: "operation",
    produces: "solid",
    summary: "Sweeps a profile along one rail, keeping its angle to the rail the whole "
           + "way - a handrail, a gutter, a moulding, a road. On Solid the profile is "
           + "capped first, so a closed profile comes out as a body. Give it a second "
           + "profile and the section BECOMES that one along the rail rather than "
           + "staying as it was: a duct that starts round and ends square, a handrail "
           + "that tapers.",
    args: [ref("profile", "Profile", ["curve"], true),
           ref("spine", "Rail", ["curve"], true),
           choice("cap", "Result", ["Solid", "Surface"], 0),
           //! Appended, never inserted: an argument's index here is its OCAF
           //! child tag, so a new question goes at the end whatever that does
           //! to the order it is asked in.
           spare("into", "Becoming", ["curve"])] },
  //! A REVOLUTION, which this had no road to at all.
  //!
  //! Everything turned about an axis - a dome, a dish, a baluster, a tank end,
  //! a bollard, and in a building model every IfcRevolvedAreaSolid - was out
  //! of reach, and the only way to one was a loft through sections somebody
  //! placed by hand. Extrude, Loft and Sweep were three of the four classical
  //! sweeps and this is the fourth.
  { type: "Revolve", guid: "9a1b2c30-0110-4c00-9e00-caf000000110", category: "operation",
    produces: "solid",
    summary: "A profile turned about an axis. 360 closes it into a full body of "
           + "revolution; less makes a wedge of one, which is how a dome is cut open "
           + "or a segment of a tank end is made. A closed profile gives a body and an "
           + "open one gives a skin, exactly as a pad does. The profile must not cross "
           + "its own axis - a section that straddles it has no revolution.",
    args: [ref("profile", "Profile", ["curve", "plane"], true),
           ref("axis", "Axis", ["vector", "curve", "axis"]),
           spare("through", "Axis through", ["point"]),
           real("angle", "Angle", 360, -360, 360, 1, "\u00b0"),
           choice("cap", "Result", ["Solid", "Surface"], 0)] },

  //! CUT IT OFF AT A PLANE, which is what IFC means by a half-space and what
  //! every clipped element in a building model is made with: a roof slab is a
  //! prism with its ends taken off at the pitch, and there is no other honest
  //! way to say that.
  //!
  //! It is the trim that Extrude's "up to plane" does, as a node of its own -
  //! so anything at all can be cut, not only the thing being padded.
  { type: "Trim", guid: "9a1b2c30-0111-4c00-9e00-caf000000111", category: "operation",
    produces: "solid",
    summary: "Everything on one side of a plane, cut flush with it. The plane is "
           + "infinite, whatever square is drawn for it, so a body is cut wherever it "
           + "reaches - and a plane at an angle cuts at that angle, which is the whole "
           + "point of it.",
    args: [ref("body", "Body", ["solid", "curve", "plane"], true),
           ref("by", "Plane", ["plane"]),
           choice("side", "Keep", ["Behind the plane", "In front of it"], 0)] },

  //! A STRUCTURAL SECTION IS A NAME AND SIX NUMBERS, not twelve lines and four
  //! fillets. Drawn by hand it stops being an I-beam the moment the web
  //! thickness changes; declared here it stays one - and a beam that came in
  //! from IFC and a beam somebody typed are the same beam, because they are
  //! the same arithmetic. See sections.js.
  { type: "Section", guid: "9a1b2c30-0112-4c00-9e00-caf000000112", category: "curve",
    produces: "curve",
    summary: "A structural section on a plane: I, angle, channel, tee, purlin, hollow "
           + "or trapezium, by its own dimensions. The root and toe radii are real "
           + "arcs, not a polygon fine enough to look like them - a rolled section's "
           + "root radius is a dimension a fabricator reads and a weld sits in. "
           + "Centred on the middle of its bounding box, which is where a column wants "
           + "it and where IFC puts it.",
    args: [ref("plane", "Plane", ["plane"]),
           choice("kind", "Section", SECTION_KINDS, 0),
           real("depth", "Depth", 400, 1, 100000, 1),
           real("width", "Width", 180, 1, 100000, 1),
           real("web", "Web or wall", 9, 0, 10000, 0.5),
           real("flange", "Flange", 14, 0, 10000, 0.5),
           real("root", "Root radius", 10, 0, 10000, 0.5),
           real("toe", "Toe radius", 0, 0, 10000, 0.5),
           real("lip", "Lip", 20, 0, 10000, 0.5),
           real("top", "Top width", 120, 0, 100000, 1),
           real("offset", "Top offset", 30, -100000, 100000, 1),
           spare("centre", "Centred on", ["point"])] },

  { type: "ParallelCurve", guid: "9a1b2c30-0078-4c00-9e00-caf000000078", category: "curve",
    produces: "curve",
    summary: "A curve offset from another by a distance. A flat curve needs nothing "
           + "else and is offset in its own plane; a curve lying on a surface needs "
           + "that surface as a support, and is offset within it so it stays on it. "
           + "Corners run on until they meet, or are rounded with an arc, or carry "
           + "the tangent. A closed loop grows on a positive distance; an open run goes "
           + "to the left of the way it is drawn. A setback, a kerb line, a second "
           + "rail.",
    //! APPENDED, as every new argument is: the index is the tag on disk, so a
    //! corner setting inserted anywhere but the end would make every saved
    //! parallel curve read its support as its distance.
    args: [ref("curve", "Curve", ["curve"], true),
           real("distance", "Distance", 100, -4000, 4000, 1),
           //! NEVER GUESSED AT. A support is what a curve lying on a SURFACE
           //! needs - a rail up a cylinder, a setback on a roof - and a flat
           //! curve needs nothing at all. Auto-wiring one meant a polyline
           //! drawn on a sketch arrived with a plane in its Support and took
           //! the in-surface road, which is the sampled one and which refuses
           //! outright when the curve is not exactly on the thing it was
           //! handed. "It only works if no support is set" was the report,
           //! and it was right: the support was never the person's doing.
           spare("support", "Support", ["solid", "plane"]),
           //! SHARP BY DEFAULT, and it is a considered change from rounded.
           //! A centreline offset to its setbacks, checked against the same
           //! drawing made in other software: seven offsets at +/-100 to
           //! +400, every one of them a six-vertex polyline like the source,
           //! each corner carried on until the two runs meet. That is what a
           //! draughtsman means by an offset, it is what AutoCAD, Rhino and
           //! Illustrator do to a polyline, and it is the only setting whose
           //! answer can be laid over a drawing vertex for vertex. Rounded
           //! stays one click away and is the safer answer at a very sharp
           //! corner, where a mitre runs a long way out.
           choice("join", "Corners", ["Rounded", "Sharp", "Tangent"], 1)] },
  { type: "ThickSurface", guid: "9a1b2c30-0079-4c00-9e00-caf000000079", category: "operation",
    produces: "solid",
    summary: "Gives a surface a thickness, so a skin becomes a body - a slab from a "
           + "roof, a wall from a swept ribbon. Either all on one side of the surface "
           + "or half each way.",
    args: [ref("surface", "Surface", ["solid", "curve", "plane"], true),
           real("thickness", "Thickness", 200, -2000, 2000, 1),
           choice("sides", "Grow", ["One side", "Both sides"], 0)] },
  { type: "Intersect", guid: "9a1b2c30-007a-4c00-9e00-caf00000007a", category: "operation",
    produces: "curve",
    summary: "Where two things cross, as wireframe: the section curve of a plane "
           + "through a solid, the line two surfaces share, the point two curves meet "
           + "at. It cuts nothing - it only says where.",
    args: [ref("a", "A", ANY, true), ref("b", "B", ANY, true)] },
  //! WHICH FACE. Everything downstream of a skin - a panel, a sample, a
  //! thickness - is about ONE face of it, and until there was a node that could
  //! say which, every one of them silently meant the first. This is that node:
  //! it takes a shape and hands back the faces picked off it, so "face 2 of
  //! Loft.1" is a thing a model file can hold and a thing a click can make.
  { type: "Face", guid: "9a1b2c30-007c-4c00-9e00-caf00000007c", category: "operation",
    produces: "plane",
    summary: "One face of a shape, on its own - so everything downstream is about that "
           + "face and not the whole body. Press Pick faces and click them on the "
           + "model; empty takes every face, which is how a skin comes apart into its "
           + "strips. The picks are written into the model file as \"face 2 of "
           + "Loft.1\", with where that face was, so they survive the shape changing "
           + "under them.",
    args: [ref("of", "Shape", ["solid", "plane", "curve", "mesh"], true),
           subs("faces", "Faces", "face",
                "which faces to take \u00b7 empty takes every one", "every face")] },
  //! THE FACE A BOUNDARY BOUNDS, flat or not. The planar one is a
  //! BRepBuilderAPI_MakeFace and refuses anything out of plane; four corners
  //! sampled off a curved skin are never in plane, so a panel on a warped
  //! surface could not be made at all. The patch is the answer to that.
  { type: "Fill", guid: "9a1b2c30-007d-4c00-9e00-caf00000007d", category: "operation",
    produces: "plane",
    summary: "The face a closed boundary bounds - flat when the boundary is flat, and "
           + "a minimum-energy patch through it when it is not. What turns four "
           + "corners of a warped panel into something you can see, thicken and "
           + "measure.",
    args: [ref("boundary", "Boundary", ["curve", "plane"], true),
           choice("surface", "Surface", ["Whichever fits", "Planar only", "Patch"], 0)] },
  { type: "Draft", guid: "9a1b2c30-007b-4c00-9e00-caf00000007b", category: "operation",
    produces: "solid",
    summary: "Leans the sides of a body over by an angle, hinged where they meet a "
           + "neutral plane - what makes a moulded part come out of its mould, and "
           + "what puts a batter on a wall. Sides drafts the faces that run along the "
           + "pull direction and leaves the top and bottom alone.",
    args: [ref("body", "Body", ["solid"], true),
           ref("neutral", "Neutral plane", ["plane"]),
           subs("hinge", "Neutral face", "face",
                "a face of the body to hinge on, instead of a plane", "the plane above"),
           ref("direction", "Pull", ["vector"]),
           real("angle", "Angle", 5, -60, 60, 0.5, "\u00b0"),
           choice("faces", "Faces", ["Sides", "All"], 0),
           subs("drafted", "Faces to draft", "face",
                "which faces lean over · empty uses the choice above",
                "whichever the choice above says")] },
  { type: "Join", guid: "9a1b2c30-0074-4c00-9e00-caf000000074", category: "operation",
    produces: "solid",
    summary: "Gathers several shapes into one without cutting or fusing them - the group "
           + "of a node editor. What goes downstream as a single thing.",
    args: [refs("parts", "Parts", ["solid", "curve"], true)] },
  { type: "PlaceAt", guid: "9a1b2c30-0076-4c00-9e00-caf000000076", category: "operation",
    produces: "solid",
    summary: "Puts one shape at every point in a list, turned by an angle taken from "
           + "another. The shape is built once and the copies are the same shape at a "
           + "different axis system, which is why a hundred cost about what one does.",
    args: [ref("shape", "Shape", ["solid", "curve"], true),
           refs("points", "Points", ["point"]),
           ref("angles", "Turn each", ["number"]),
           real("turn", "Turn all", 0, -360, 360, 1, "°"),
           real("lift", "Lift", 0, -4000, 4000, 1)] },

  /* -------------------------------------------------------- transforms
     Where a shape is, said as a feature rather than typed into the shape that
     made it. Every one of these is one gp_Trsf over a shape that is already
     built, so it costs a matrix and not a rebuild, and the shape it moves stays
     in the tree with its own parameters still live.                          */
  { type: "Move", guid: "9a1b2c30-00e0-4c00-9e00-caf0000000e0", category: "operation",
    produces: "solid",
    summary: "Moves a shape: along a direction by a distance, from one point to "
           + "another, or part of the way between two points. Between is the useful "
           + "one - wire a number into how far along and the shape tweens.",
    args: [ref("shape", "Shape", ["solid", "curve", "plane", "point"], true),
           choice("kind", "Move", ["Along a direction", "Point to point",
                                   "Between two points"], 0),
           when(ref("direction", "Direction", ["vector", "curve"]), "kind", 0),
           when(real("distance", "Distance", 100, -100000, 100000, 1), "kind", 0),
           when(ref("from", "From point", ["point"]), "kind", 1),
           when(ref("to", "To point", ["point"]), "kind", 1),
           when(ref("start", "From point", ["point"]), "kind", 2),
           when(ref("end", "To point", ["point"]), "kind", 2),
           when(real("at", "How far along", 0.5, -8, 8, 0.01, ""), "kind", 2),
           choice("keep", "Result", ["The shape moved", "Both, where it was and where "
                                     + "it went"], 0)] },
  //! Two angles rather than one, because the useful rotation is a sweep: start
  //! at 15 and end at 75 and the shape turns 60, and a number wired into either
  //! end animates it.
  { type: "Rotate", guid: "9a1b2c30-00e1-4c00-9e00-caf0000000e1", category: "operation",
    produces: "solid",
    summary: "Turns a shape about an axis, from a start angle to an end angle. The axis "
           + "is a direction through a point, a line, or an axis system - and an axis "
           + "system brings its own origin, so nothing else is needed.",
    args: [ref("shape", "Shape", ["solid", "curve", "plane", "point"], true),
           ref("axis", "Axis", ["vector", "curve", "axis"], true),
           ref("through", "Through point", ["point"]),
           real("start", "Start angle", 0, -3600, 3600, 1, "\u00b0"),
           real("end", "End angle", 90, -3600, 3600, 1, "\u00b0"),
           choice("keep", "Result", ["The shape turned", "Both, before and after"], 0)] },
  { type: "Mirror", guid: "9a1b2c30-00e2-4c00-9e00-caf0000000e2", category: "operation",
    produces: "solid",
    summary: "The mirror image of a shape in a plane - a datum plane, or a point with a "
           + "normal through it. Both halves keeps the original, which is what makes a "
           + "symmetrical part out of half of one.",
    args: [ref("shape", "Shape", ["solid", "curve", "plane", "point"], true),
           choice("by", "Mirror in", ["A plane", "A point and a normal"], 0),
           when(ref("plane", "Plane", ["plane"]), "by", 0),
           when(ref("at", "Point on the plane", ["point"]), "by", 1),
           when(ref("normal", "Normal", ["vector", "curve"]), "by", 1),
           choice("keep", "Result", ["The mirror image", "Both halves"], 0)] },
  //! One factor, the same in every direction, and that is not a shortcut: a
  //! B-Rep here is moved by a gp_Trsf, a gp_Trsf carries one scale factor, and
  //! the non-uniform transform that would squash a solid along one direction -
  //! BRepBuilderAPI_GTransform - is not in this build. Ask gp_Trsf for a squash
  //! and it quietly returns the uniform scale of the same volume instead. So
  //! scaling along one direction is a mesh operation, and Mesh Transform takes
  //! a factor per axis.
  { type: "Scale", guid: "9a1b2c30-00e3-4c00-9e00-caf0000000e3", category: "operation",
    produces: "solid",
    summary: "A shape larger or smaller about a point, by one factor in every "
           + "direction. Squashing along one direction only is a mesh operation here - "
           + "put the shape through Mesh from shape and scale that, which takes a "
           + "factor per axis.",
    args: [ref("shape", "Shape", ["solid", "curve", "plane", "point"], true),
           ref("centre", "About point", ["point"]),
           real("factor", "Factor", 2, 0.001, 1000, 0.01, "")] },
  //! ONE NODE THE HANDLES DRIVE. Move, Rotate and Scale each say one thing and
  //! say it well - a direction wired in, an axis, a centre - and none of them
  //! is what a hand on a widget is doing. A widget is dragging a shape about in
  //! space: a bit along X, a turn about Z, a size. So there is a node whose
  //! arguments ARE those numbers, and the widget writes them.
  //!
  //! It reads as what it is in the file, too. "dz: 3000" is a storey up; the
  //! same move said with Move is a Vector node, a distance and two wires.
  //!
  //! Scale first, then the turns, then the move - the order every package
  //! composes them in, so a part turned and moved is where you expect and not
  //! somewhere out past the origin.
  { type: "Transform", guid: "9a1b2c30-00e5-4c00-9e00-caf0000000e5", category: "operation",
    produces: "solid",
    summary: "A shape moved, turned and resized by numbers - what the move, turn and "
           + "size widgets write. Press W, E or R with something selected and drag the "
           + "handles; the numbers here are what your hand did, and they can be typed "
           + "over, wired to, and animated like any others.",
    args: [ref("shape", "Shape", ["solid", "curve", "plane", "point"], true),
           real("dx", "Move X", 0, -100000, 100000, 1),
           real("dy", "Move Y", 0, -100000, 100000, 1),
           real("dz", "Move Z", 0, -100000, 100000, 1),
           real("rx", "Turn about X", 0, -3600, 3600, 1, "\u00b0"),
           real("ry", "Turn about Y", 0, -3600, 3600, 1, "\u00b0"),
           real("rz", "Turn about Z", 0, -3600, 3600, 1, "\u00b0"),
           real("factor", "Size", 1, 0.001, 1000, 0.01, ""),
           ref("about", "Turn and size about", ["point"]),
           choice("keep", "Result", ["The shape moved",
                                     "Both, where it was and where it went"], 0)] },
  //! The assembly transform. Nothing is typed: a part drawn about its own frame
  //! goes to wherever the target frame is, and moving the target moves the part.
  { type: "AxisToAxis", guid: "9a1b2c30-00e4-4c00-9e00-caf0000000e4", category: "operation",
    produces: "solid",
    summary: "Takes a shape from one axis system to another - the assembly move. What "
           + "was drawn about the first frame ends up placed about the second, so "
           + "moving the target frame moves the part with it.",
    //! A MESH TOO, because this is the node an instance is made with - one
    //! master, many placements - and half of an imported building arrives as
    //! triangles. Adding a kind to what an input ACCEPTS is safe where adding
    //! an argument would not be: the list is not a tag on disk.
    args: [ref("shape", "Shape", ["solid", "curve", "plane", "point", "mesh"], true),
           ref("from", "From axis system", ["axis"], true),
           ref("to", "To axis system", ["axis"], true)] },
  { type: "Array", guid: "9a1b2c30-0021-4c00-9e00-caf000000021", category: "operation",
    produces: "solid",
    summary: "Repeats a body in a grid or around an axis. One feature in the tree, "
           + "however many copies it makes.",
    args: [ref("source", "Feature", ["solid"], true),
           choice("mode", "Pattern", ["Rectangular", "Polar"], 0),
           when(real("countX", "Count X", 3, 1, 40, 1, ""), "mode", 0),
           when(real("spacingX", "Spacing X", 120, -4000, 4000, 1), "mode", 0),
           when(real("countY", "Count Y", 1, 1, 40, 1, ""), "mode", 0),
           when(real("spacingY", "Spacing Y", 120, -4000, 4000, 1), "mode", 0),
           when(real("countZ", "Count Z", 1, 1, 20, 1, ""), "mode", 0),
           when(real("spacingZ", "Spacing Z", 120, -4000, 4000, 1), "mode", 0),
           when(ref("center", "Centre", ["point"]), "mode", 1),
           when(ref("axis", "Axis", ["vector"]), "mode", 1),
           when(real("count", "Count", 6, 1, 120, 1, ""), "mode", 1),
           when(real("angle", "Sweep", 360, -360, 360, 5, "°"), "mode", 1)] },
  { type: "Fillet", guid: "9a1b2c30-0020-4c00-9e00-caf000000020", category: "operation",
    produces: "solid",
    summary: "Rounds the edges of a body. Every edge unless you pick some: press Pick "
           + "edges, click them on the model - double-click for the whole arris, which "
           + "takes everything tangent to it - and press Done. The picks are written "
           + "into the model file as \"edge 2 of Cube.1\", with where that edge was, so "
           + "they survive the body changing shape under them.",
    args: [ref("body", "Body", ["solid"], true),
           real("radius", "Radius", 10, 0.1, 2000, 0.5),
           subs("edges", "Edges", "edge",
                "which edges to round · empty rounds every edge", "every edge")] },
];

//! The order the toolbar and the graph's Add menu group them in.
export const CATEGORIES = [
  { key: "datum",     label: "datums" },
  { key: "data",      label: "numbers" },
  { key: "curve",     label: "curves" },
  { key: "body",      label: "solids" },
  { key: "mesh",      label: "mesh" },
  //! Drawings are their own kind of thing, not curves that happen to be flat:
  //! a drawing is about the model rather than part of it. The heading is empty
  //! - and therefore not drawn - until the Drawings package is loaded.
  { key: "drawing",   label: "drawings" },
  { key: "analysis",  label: "analysis" },
  { key: "operation", label: "operations" },
  { key: "container", label: "sets" },
];

export const FIRST_ARG_TAG = 1, RESULT_TAG = 100, ERROR_TAG = 101, REVISION_TAG = 102;
//! A NOTE is not an error. A feature that built, and built what was asked, but
//! has something to say about how - twelve faces sewn into a solid, a step of
//! an edit list that could not find what it was about - needs somewhere to say
//! it that is not the error label, because an error stops the feature and this
//! does not. See F.note.
export const NOTE_TAG = 104;

//! Beside the B-Rep result, what the feature computed: numbers, points,
//! vectors or lines of text. A Number has only this and no shape; an
//! EvaluateCurve has both. Held the way OCAF holds such things - the kind as a
//! TDataStd_AsciiString and the values as a TDataStd_RealArray.
export const DATA_TAG = 103;

//! A Script feature declares its own parameters, so they cannot live in the
//! catalogue. Each gets a label of its own under the feature, carrying the
//! parameter's name and value exactly as a catalogue argument would; the
//! declaration itself is cached beside them so the interface can draw the
//! sliders without compiling anything.
export const PARAM_TAG_BASE = 10, PARAM_TAG_LIMIT = 50, SPECS_TAG = 51;

//! How a feature should look, as opposed to what shape it is. Kept on the
//! feature so it saves with the model and survives regeneration, but outside the
//! arguments, because it drives no geometry - XCAF keeps colour beside a shape
//! for the same reason.
export const APPEARANCE_TAG = 52;

//! Where a sketch's plane put it, written by the driver when it builds and read
//! by the viewport so it can lock the camera to the plane and put a click back
//! into the drawing's own two numbers. A result, not an argument: the plane says
//! what it is, and this is what the plane came to.
export const FRAME_TAG = 53;

//! Which container a feature is filed under, as a TDF_Reference to it. It goes
//! on the CHILD rather than as a list on the container for the reason OCAF
//! itself puts a parent on a label: a feature belongs to exactly one set, and
//! one place to write that is one place for it to be wrong. It is not an
//! argument - a container drives no geometry - so it never reaches a driver and
//! never orders a rebuild.
export const PARENT_TAG = 54;

//! HOW A FEATURE PAIRS UP THE LISTS ARRIVING ON IT - Grasshopper's data
//! matching, stored beside the appearance rather than among the arguments.
//!
//! Outside the arguments for the same reason the appearance is: it drives no
//! geometry of its own. It changes how the arguments that DO drive geometry are
//! read, which makes it a property of the reading rather than a thing read.
//! Keeping it out of args also means every feature type in the catalogue gets
//! it without a single catalogue entry being touched - and an argument added to
//! a hundred entries is a hundred chances to insert rather than append.
//!
//! Held as {"match":"longest"|"shortest"|"cross","graft":[key],"flatten":[key]}.
//! Absent means the default, which is `longest` and nothing grafted.
export const SPREAD_TAG = 55;

//! SOMEBODY SAID TO SHOW THIS ANYWAY.
//!
//! A body an operation swallowed leaves the 3D view: a fillet is the cube
//! now, and drawing both of them puts the old corners through the new ones.
//! That is the right DEFAULT and it was being enforced as a rule -
//! updateVisibility ran after every regeneration and set every consumed source
//! back to invisible, so turning one on again lasted until the next edit and
//! there was no point offering the switch at all.
//!
//! This is the exception, stored on the feature so it survives the rebuild
//! that would otherwise undo it, and saved with the model so it survives the
//! file. Set when somebody turns a swallowed body back on - to look at what a
//! fillet was made from, which is the whole reason the body is still in the
//! tree.
export const SHOWN_TAG = 56;

//! WHICH ROW OF ITS LISTS A FEATURE IS BEING BUILT FOR.
//!
//! A number that arrived on a wire from a Series is not one number, it is
//! twenty-eight, and the feature is built twenty-eight times. Every driver
//! reads its numbers through F.real, so the row is set here, once, and every
//! driver in the catalogue iterates without knowing it does - which is the
//! only way this was ever going to reach a hundred feature types.
//!
//! Module state, and safe as module state because drivers run one at a time:
//! regeneration walks the graph in order and no build calls another. Set and
//! cleared in a finally by Driver.execute, which is the only thing that may
//! touch it.
let rowPick = null;
export function spreadRow(row) { const was = rowPick; rowPick = row; return was; }

//! WHETHER A BUILD IS ALLOWED TO BE APPROXIMATE, because a hand is still on
//! the slider.
//!
//! One node in a model can be slower than all the rest put together - the
//! intersection of a solid by twenty-three extruded offsets is four and a
//! half seconds of OpenCascade's general numeric intersector - and dragging a
//! number through it means asking for that once a frame. The answer is not to
//! make the exact road faster, because the exact road is already doing the
//! only thing it can. It is to have a second road, taken only while the
//! number is moving, and to take the first one the moment it stops.
//!
//! A driver opts in by declaring `draft`, and reads this to know which road it
//! is on. Nothing else changes: the feature builds, produces a shape, and the
//! tree, the viewer and everything downstream are none the wiser. The only
//! thing that knows is the document, which remembers WHICH features were
//! built the cheap way so it can build them again for real - see
//! Doc.recompute. That is what makes the switch safe: a draft can never be
//! mistaken for the answer, because the answer is always computed before
//! anybody stops looking.
let draftPass = false;
export function setDrafting(on) { draftPass = !!on; }
export function drafting() { return draftPass; }

const byType = new Map();
const byGuid = new Map();

//! Every entry goes through here, the ones written above and the ones a
//! package brings with it, so a type added at run time is a type in every
//! sense: the tree finds it, the model file names it, the graph draws it.
//!
//! The check is the reason this is a function rather than two Map constructors.
//! A repeated guid does not fail - it makes one type quietly answer as another,
//! and what you see is a feature refusing an argument it plainly has. That was
//! found once by accident; it is not going to be found by accident twice.
export function registerTypes(specs, from = "the catalogue") {
  // Against what is already registered AND against the rest of this batch. Two
  // entries of one batch clashing with each other passed this check and then
  // overwrote each other in the maps below: a Move node given the guid of
  // GeometricalSet made every set in every document answer as a Move, and what
  // you saw was a folder refusing to hold anything.
  const seen = new Set();
  for (const spec of specs) {
    const clash = byType.has(spec.type) || seen.has("type " + spec.type)
                    ? "type name " + spec.type
                : byGuid.has(spec.guid) || seen.has("guid " + spec.guid)
                    ? "guid " + spec.guid : null;
    if (clash) throw new Error(from + " brings a " + clash + " that is already taken");
    seen.add("type " + spec.type).add("guid " + spec.guid);
  }
  for (const spec of specs) {
    byType.set(spec.type, spec);
    byGuid.set(spec.guid, spec);
    if (!CATALOGUE.includes(spec)) CATALOGUE.push(spec);
  }
  return specs;
}

//! And out again, when a package is put away. Only the caller knows whether
//! anything in the document still uses them - it holds the document - so this
//! does as it is told.
export function unregisterTypes(specs) {
  for (const spec of specs) {
    byType.delete(spec.type);
    byGuid.delete(spec.guid);
    const at = CATALOGUE.indexOf(spec);
    if (at >= 0) CATALOGUE.splice(at, 1);
  }
}

registerTypes(CATALOGUE.slice());

export const typeSpec = type => byType.get(type) || null;

//! EVERY TYPE THERE IS, right now - the catalogue plus whatever a loaded
//! package added. The static CATALOGUE is not the answer to that question and
//! anything that asks it by importing CATALOGUE is wrong the moment a package
//! is on: a generator's plan has to be able to ask for a node a package
//! brought, the same way it asks for a Circle.
export const registeredTypes = () => [...byType.values()];
const argIndex = (spec, key) => spec.args.findIndex(a => a.key === key);

/* ------------------------------------------------------------- TDF labels */

//! HOW MANY TIMES THE DOCUMENT HAS CHANGED SHAPE.
//!
//! Three counters, because three different things are cached and they go
//! stale at different rates. \p treeStamp moves when a feature is removed or
//! the tree is reordered, and guards the list of features and the index of
//! them by id. \p parentStamp moves when something is filed in a set, and
//! guards the index of what is in each set. \p wireStamp moves when a
//! reference is made or broken, and guards the index of who reads from whom.
//!
//! Split three ways because reading a file does all three kinds of change
//! thousands of times, and one counter would mean every index rebuilt on every
//! edit - which is the walk they exist to remove. An ADD is folded into the
//! indexes instead of invalidating them, because an add is the one change that
//! can be.
//!
//! Deliberately NOT bumped by every label that gets made. Setting a parameter
//! creates a label the first time, and a counter that moved for that would be
//! invalidated by every edit in a file - which is exactly the case the indexes
//! exist for.
//!
//! Module state, and honest as module state because the counters only ever go
//! up: a stale cache is impossible, and a cache missed because some other
//! document moved costs one walk.
let treeStamp = 0, wireStamp = 0, parentStamp = 0;
export const treeChanged = () => ++treeStamp;
export const wiringChanged = () => ++wireStamp;
export const nestingChanged = () => ++parentStamp;

export class Label {
  constructor(tag, parent) {
    this.tag = tag;
    this.parent = parent;
    this.children = new Map();
    this.attr = Object.create(null);
    this.nextTag = 0;
  }
  findChild(tag, create = false) {
    let child = this.children.get(tag);
    if (!child && create) { child = new Label(tag, this); this.children.set(tag, child); }
    return child || null;
  }
  dropChild(tag) { this.children.delete(tag); }
  newChild() { return this.findChild(++this.nextTag, true); }
  childList() { return [...this.children.values()].sort((a, b) => a.tag - b.tag); }
  get entry() {
    const parts = [];
    for (let l = this; l.parent; l = l.parent) parts.unshift(l.tag);
    return "0:" + parts.join(":");
  }
}

/* ------------------------------------------------- reading a feature label */

export const F = {
  spec: f => (f && byGuid.get(f.attr.TFunction_Function)) || null,
  name: f => (f && f.attr.TDataStd_Name) || "",
  id: f => (f && f.attr.TDataStd_AsciiString) || "",
  visible: f => f.attr.TDataStd_Integer !== 0,
  setVisible: (f, v) => { f.attr.TDataStd_Integer = v ? 1 : 0; },
  //! Whether somebody has overruled the "consumed bodies leave the view" rule
  //! for this one. See SHOWN_TAG.
  pinnedShown(f) {
    const label = f && f.findChild(SHOWN_TAG);
    return !!(label && label.attr.TDataStd_Integer === 1);
  },
  setPinnedShown(f, on) {
    f.findChild(SHOWN_TAG, true).attr.TDataStd_Integer = on ? 1 : 0;
  },
  revision: f => {
    const label = f.findChild(REVISION_TAG);
    return label ? label.attr.TDataStd_Integer || 0 : 0;
  },
  bumpRevision: f => {
    const label = f.findChild(REVISION_TAG, true);
    label.attr.TDataStd_Integer = (label.attr.TDataStd_Integer || 0) + 1;
  },

  argLabel(f, key, create = false) {
    const spec = F.spec(f);
    if (!spec) return null;
    const index = argIndex(spec, key);
    if (index < 0) return null;
    const label = f.findChild(FIRST_ARG_TAG + index, create);
    if (label && create) label.attr.TDataStd_Name = key;
    return label;
  },
  //! The number an argument is worth right now. A slider with a wire on it
  //! reports what is arriving down the wire; the literal underneath is kept but
  //! not read, so pulling the wire off puts the old value back. Every driver in
  //! the kernel calls this, so every slider in the document is wireable without
  //! a single driver knowing about it.
  real(f, key, fallback = 0) {
    const label = F.argLabel(f, key);
    if (!label) return fallback;
    const wired = F.wiredNumbers(label);
    //! THE ROW, NOT THE FIRST. A wire carrying twenty-eight numbers used to
    //! hand over the first of them and drop the other twenty-seven on the
    //! floor - the Series was wired up, the slider showed -97, and one curve
    //! came out where twenty-eight were asked for. Which row is being built is
    //! decided by Driver.execute; with no row set this is row zero, which is
    //! the old behaviour exactly.
    if (wired && wired.length) {
      const at = rowPick && Number.isInteger(rowPick[key]) ? rowPick[key] : 0;
      return wired[Math.min(Math.max(0, at), wired.length - 1)];
    }
    return typeof label.attr.TDataStd_Real === "number" ? label.attr.TDataStd_Real : fallback;
  },
  //! The whole list arriving on an argument's wire, or null when it has none.
  //! Only the components that mean something for a list read this.
  reals(f, key, fallback = 0) {
    const label = F.argLabel(f, key);
    const wired = label && F.wiredNumbers(label);
    if (wired && wired.length) return wired;
    return [F.real(f, key, fallback)];
  },
  wiredNumbers(label) {
    const source = label && label.attr.TDF_Reference;
    if (!source) return null;
    const data = F.data(source);
    return data && data.kind === "number" ? data.values : null;
  },
  //! True when a slider is being driven from somewhere else.
  driven(f, key) {
    const label = F.argLabel(f, key);
    return !!(label && label.attr.TDF_Reference);
  },
  setReal(f, key, value) { F.argLabel(f, key, true).attr.TDataStd_Real = value; },
  choice(f, key, fallback = 0) {
    const label = F.argLabel(f, key);
    return label && typeof label.attr.TDataStd_Integer === "number"
      ? label.attr.TDataStd_Integer : fallback;
  },
  setChoice(f, key, index) { F.argLabel(f, key, true).attr.TDataStd_Integer = index; },

  code(f, key, fallback = "") {
    const label = F.argLabel(f, key);
    return label && typeof label.attr.TDataStd_AsciiString === "string"
      ? label.attr.TDataStd_AsciiString : fallback;
  },
  setCode(f, key, value) { F.argLabel(f, key, true).attr.TDataStd_AsciiString = value; },
  //! Text and code sit on the same attribute; only the control differs.
  text(f, key, fallback = "") { return F.code(f, key, fallback); },
  setText(f, key, value) { F.setCode(f, key, value); },

  //! Vertices someone moved by hand: an object of index → [dx, dy, dz], held
  //! as text on the argument's label so it travels in the file and can be read
  //! and written there.
  edits(f, key) {
    const label = F.argLabel(f, key);
    const text = label && label.attr.TDataStd_AsciiString;
    if (typeof text !== "string" || !text.trim()) return {};
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) { return {}; }
  },
  //! The sub-shapes picked for an argument, as the list subshape.js reads.
  picks(f, key) {
    const label = F.argLabel(f, key);
    const text = label && label.attr.TDataStd_AsciiString;
    if (typeof text !== "string" || !text.trim()) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter(one => one && one.kind) : [];
    } catch (e) { return []; }
  },
  setPicks(f, key, picks) {
    const clean = (Array.isArray(picks) ? picks : []).filter(one =>
      one && typeof one === "object" && one.kind
      && Number.isInteger(Number(one.at)) && Number(one.at) >= 0)
      .map(one => {
        const made = { of: one.of ? String(one.of) : "", kind: String(one.kind),
                       at: Number(one.at),
                       near: (Array.isArray(one.near) ? one.near : [])
                         .map(v => Math.round(Number(v) * 1e4) / 1e4)
                         .filter(Number.isFinite) };
        //! How many of that kind the body had when the pick was taken - see
        //! matchPick. Dropped here would mean a pick that survives the session
        //! it was made in and not the file.
        if (Number.isInteger(Number(one.count)) && Number(one.count) > 0)
          made.count = Number(one.count);
        return made;
      });
    F.argLabel(f, key, true).attr.TDataStd_AsciiString = JSON.stringify(clean);
    return clean;
  },

  //! HOW A SUB-SHAPE PICK SPREADS, stored beside the picks rather than inside
  //! them. The list is a JSON string on TDataStd_AsciiString; the rule is two
  //! attributes on the same label that were not being used - which means a
  //! file written before this existed reads back as "one", exactly as it
  //! behaved, without the pick format changing at all.
  pickMode(f, key) {
    const label = F.argLabel(f, key);
    const at = label && label.attr.TDataStd_Integer;
    const mode = PICK_MODES[Number.isInteger(at) ? at : 0] || PICK_MODES[0];
    const angle = label && typeof label.attr.TDataStd_Real === "number"
                && label.attr.TDataStd_Real > 0 ? label.attr.TDataStd_Real : PICK_ANGLE;
    return { mode, angle };
  },
  setPickMode(f, key, mode, angle) {
    const label = F.argLabel(f, key, true);
    const at = PICK_MODES.indexOf(String(mode));
    label.attr.TDataStd_Integer = at < 0 ? 0 : at;
    const want = Number(angle);
    label.attr.TDataStd_Real = Number.isFinite(want) && want > 0 ? want : PICK_ANGLE;
    return F.pickMode(f, key);
  },

  setEdits(f, key, moves) {
    const clean = {};
    for (const [index, offset] of Object.entries(moves || {})) {
      const at = Math.round(Number(index));
      if (!Number.isInteger(at) || at < 0) continue;
      if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite)) continue;
      // A vertex put back where it started is not an edit; forget it.
      if (offset.every(v => Math.abs(v) < 1e-9)) continue;
      clean[at] = offset.map(round);
    }
    F.argLabel(f, key, true).attr.TDataStd_AsciiString = JSON.stringify(clean);
    return clean;
  },
  moveVertex(f, key, index, offset) {
    const moves = F.edits(f, key);
    if (!offset) delete moves[index]; else moves[index] = offset;
    return F.setEdits(f, key, moves);
  },

  //! The drawing on a sketch argument. Stored as the text it is written in and
  //! read back through the same tolerant parser the file format uses, so a
  //! drawing typed into the model file by hand behaves like one that was drawn.
  sketch(f, key) {
    const label = F.argLabel(f, key);
    return readSketch(label && label.attr.TDataStd_AsciiString);
  },
  setSketch(f, key, source) {
    const clean = readSketch(source);
    F.argLabel(f, key, true).attr.TDataStd_AsciiString = JSON.stringify(clean);
    return clean;
  },

  appearance(f) {
    const label = f.findChild(APPEARANCE_TAG);
    if (!label || typeof label.attr.TDataStd_AsciiString !== "string") return null;
    try { return JSON.parse(label.attr.TDataStd_AsciiString); } catch (e) { return null; }
  },
  setAppearance(f, appearance) {
    const label = f.findChild(APPEARANCE_TAG, true);
    if (!appearance) label.attr.TDataStd_AsciiString = "";
    else label.attr.TDataStd_AsciiString = JSON.stringify(appearance);
  },

  //! The data-matching settings, defaulted rather than nullable: every reader
  //! wants the three fields and none of them wants to write the default twice.
  spread(f) {
    const label = f && f.findChild(SPREAD_TAG);
    let said = null;
    try {
      if (label && typeof label.attr.TDataStd_AsciiString === "string"
          && label.attr.TDataStd_AsciiString)
        said = JSON.parse(label.attr.TDataStd_AsciiString);
    } catch (e) { said = null; }
    const match = said && MATCHES.includes(said.match) ? said.match : MATCHES[0];
    const list = of => Array.isArray(said && said[of]) ? said[of].map(String) : [];
    return { match, graft: list("graft"), flatten: list("flatten") };
  },
  setSpread(f, spread) {
    const label = f.findChild(SPREAD_TAG, true);
    const clean = {};
    if (spread && MATCHES.includes(spread.match) && spread.match !== MATCHES[0])
      clean.match = spread.match;
    for (const of of ["graft", "flatten"])
      if (spread && Array.isArray(spread[of]) && spread[of].length)
        clean[of] = spread[of].map(String);
    //! An empty setting is stored as nothing at all, so a model file carries a
    //! line about matching only where somebody chose something.
    label.attr.TDataStd_AsciiString = Object.keys(clean).length ? JSON.stringify(clean) : "";
    return F.spread(f);
  },

  parent(f) {
    const label = f && f.findChild(PARENT_TAG);
    return (label && label.attr.TDF_Reference) || null;
  },
  setParent(f, container) {
    const label = f.findChild(PARENT_TAG, true);
    if (container) label.attr.TDF_Reference = container;
    else delete label.attr.TDF_Reference;
  },

  frame(f) {
    const label = f.findChild(FRAME_TAG);
    if (!label || typeof label.attr.TDataStd_AsciiString !== "string") return null;
    try { return JSON.parse(label.attr.TDataStd_AsciiString); } catch (e) { return null; }
  },
  setFrame(f, frame) {
    f.findChild(FRAME_TAG, true).attr.TDataStd_AsciiString =
      frame ? JSON.stringify(frame) : "";
  },

  //! What the script last declared, so the panel can draw its sliders without
  //! compiling the code again.
  paramSpecs(f) {
    const label = f.findChild(SPECS_TAG);
    if (!label || typeof label.attr.TDataStd_AsciiString !== "string") return [];
    try { return JSON.parse(label.attr.TDataStd_AsciiString); } catch (e) { return []; }
  },
  setParamSpecs(f, specs) {
    f.findChild(SPECS_TAG, true).attr.TDataStd_AsciiString = JSON.stringify(specs);
  },

  paramLabels(f) {
    return f.childList().filter(l => l.tag >= PARAM_TAG_BASE && l.tag < PARAM_TAG_LIMIT
                                     && l.attr.TDataStd_Name);
  },
  paramLabel(f, key) {
    return F.paramLabels(f).find(l => l.attr.TDataStd_Name === key) || null;
  },
  paramValue(f, key, fallback = 0) {
    const label = F.paramLabel(f, key);
    return label && typeof label.attr.TDataStd_Real === "number" ? label.attr.TDataStd_Real : fallback;
  },
  paramValues(f) {
    const values = {};
    for (const label of F.paramLabels(f)) values[label.attr.TDataStd_Name] = label.attr.TDataStd_Real;
    return values;
  },
  setParamValue(f, key, value) {
    let label = F.paramLabel(f, key);
    if (!label) {
      for (let tag = PARAM_TAG_BASE; tag < PARAM_TAG_LIMIT; tag++)
        if (!f.findChild(tag)) { label = f.findChild(tag, true); break; }
      if (!label) throw new Error("a script may declare at most "
        + (PARAM_TAG_LIMIT - PARAM_TAG_BASE) + " parameters");
      label.attr.TDataStd_Name = key;
    }
    label.attr.TDataStd_Real = value;
    return label;
  },

  //! Brings the stored parameters into line with what the script now declares:
  //! values already there are kept, new ones take their default, and parameters
  //! the script dropped are forgotten.
  syncParams(f, specs) {
    const wanted = new Set(specs.map(spec => spec.key));
    for (const label of F.paramLabels(f))
      if (!wanted.has(label.attr.TDataStd_Name)) f.dropChild(label.tag);
    for (const spec of specs) {
      const existing = F.paramLabel(f, spec.key);
      const value = existing && typeof existing.attr.TDataStd_Real === "number"
        ? existing.attr.TDataStd_Real : spec.def;
      F.setParamValue(f, spec.key, clampTo(spec, value));
    }
    F.setParamSpecs(f, specs);
  },

  //! An argument is live only when its condition holds; the rest are carried
  //! but not read, so switching a pattern back keeps the values you had.
  applies(f, arg) {
    if (!arg.showWhen) return true;
    const now = F.choice(f, arg.showWhen.key, 0);
    return arg.showWhen.any ? arg.showWhen.any.includes(now) : now === arg.showWhen.equals;
  },
  reference(f, key) {
    const label = F.argLabel(f, key);
    return label ? label.attr.TDF_Reference || null : null;
  },
  setReference(f, key, target) {
    F.argLabel(f, key, true).attr.TDF_Reference = target;
    wiringChanged();
  },

  //! An input that takes several wires in order. Each one lives on a child of
  //! the argument's own label, so the order is the tag order and a gap left by
  //! a removed wire closes itself.
  references(f, key) {
    const label = F.argLabel(f, key);
    if (!label) return [];
    return label.childList().map(child => child.attr.TDF_Reference).filter(Boolean);
  },
  setReferences(f, key, targets) {
    const label = F.argLabel(f, key, true);
    label.children.clear();
    label.nextTag = 0;
    for (const target of targets) if (target) label.newChild().attr.TDF_Reference = target;
    return label;
  },

  resultLabel: (f, create = false) => (f ? f.findChild(RESULT_TAG, create) : null),
  //! What a feature built, or null. Asking an input that is not wired what it
  //! built is a fair question with a plain answer - and since an argument shown
  //! only for one setting of a choice is routinely unwired, it is asked often.
  shape(f) {
    const result = F.resultLabel(f);
    return result ? result.attr.TNaming_NamedShape || null : null;
  },

  //! What the feature computed, beside whatever it built. Numbers, points and
  //! vectors are held as a flat TDataStd_RealArray with a stride; text is held
  //! as a TDataStd_ExtStringArray, which is what a Panel shows.
  dataLabel: (f, create = false) => f.findChild(DATA_TAG, create),
  data(f) {
    const label = F.dataLabel(f);
    if (!label || !label.attr.TDataStd_AsciiString) return null;
    const kind = label.attr.TDataStd_AsciiString;
    return {
      kind,
      stride: kind === "point" || kind === "vector" || kind === "mesh"
           || kind === "axis" ? 3 : 1,
      values: label.attr.TDataStd_RealArray || [],
      lines: label.attr.TDataStd_ExtStringArray || [],
      // A polymesh keeps its faces here, packed as [sides, i, i, …, sides, …],
      // which is a TDataStd_IntegerArray and nothing more exotic.
      faces: label.attr.TDataStd_IntegerArray || [],
      // Whether the normals should be averaged across a face's edges. A
      // property of the mesh, not of the viewer, so it travels with it.
      smooth: label.attr.TDataStd_Integer === 1,
    };
  },
  setData(f, data) {
    const label = F.dataLabel(f, true);
    if (!data) {
      label.attr.TDataStd_AsciiString = "";
      label.attr.TDataStd_RealArray = [];
      label.attr.TDataStd_ExtStringArray = [];
      label.attr.TDataStd_IntegerArray = [];
      return label;
    }
    label.attr.TDataStd_AsciiString = data.kind;
    label.attr.TDataStd_RealArray = (data.values || []).map(round);
    label.attr.TDataStd_ExtStringArray = data.lines || [];
    label.attr.TDataStd_IntegerArray = data.faces || [];
    label.attr.TDataStd_Integer = data.smooth ? 1 : 0;
    return label;
  },
  //! Points and vectors read back as triples, which is how every driver wants
  //! them and how the interface previews them.
  triples(data) {
    if (!data || data.stride !== 3) return [];
    const out = [];
    for (let i = 0; i + 2 < data.values.length; i += 3)
      out.push([data.values[i], data.values[i + 1], data.values[i + 2]]);
    return out;
  },
  error(f) {
    const label = f.findChild(ERROR_TAG);
    return label ? label.attr.TDataStd_AsciiString || "" : "";
  },
  setError(f, message) { f.findChild(ERROR_TAG, true).attr.TDataStd_AsciiString = message; },

  //! What the driver wants to say about a build that WORKED. Cleared on every
  //! rebuild, like the error, so a note never outlives the thing it was about.
  note(f) {
    const label = f.findChild(NOTE_TAG);
    return label ? label.attr.TDataStd_AsciiString || "" : "";
  },
  setNote(f, message) { f.findChild(NOTE_TAG, true).attr.TDataStd_AsciiString = message || ""; },
};

/* ----------------------------------------------------------------- logbook */

export class Logbook {
  constructor() { this.touched = new Set(); this.impacted = new Set(); }
  touch(label) { this.touched.add(label); }
  impact(label) { this.impacted.add(label); }
  isModified(label) { return this.touched.has(label) || this.impacted.has(label); }
  clear() { this.touched.clear(); this.impacted.clear(); }
}

/* ----------------------------------------------------------------- drivers */

//! A driver is registered against its type's GUID and supplies two things: a
//! check that runs before the kernel is called, and the build itself.
//! HOW SEVERAL LISTS ARRIVING ON ONE FEATURE ARE PAIRED UP. Grasshopper's
//! three, under Grasshopper's names, because anybody who wants this already
//! knows them.
//!
//!   longest   as many rows as the longest list; a shorter one repeats its
//!             last value. Twenty-eight distances and one angle is
//!             twenty-eight rows of that one angle. The default, and the same
//!             rule the Point node has always used for its x, y and z.
//!   shortest  as many rows as the shortest; the surplus is dropped. What you
//!             want when two lists are meant to be the same length and you
//!             would rather see the short answer than a repeated tail.
//!   cross     every combination. Twenty-eight distances and four angles is a
//!             hundred and twelve rows.
export const MATCHES = ["longest", "shortest", "cross"];
export const MATCH_LABELS = ["Longest list", "Shortest list", "Cross reference"];

//! The rows themselves: one object per row, mapping an argument key to the
//! index of the value it should read. Handed to spreadRow, read by F.real.
export function spreadRows(lists, match = MATCHES[0]) {
  if (!lists.length) return [null];
  if (match === "cross") {
    let rows = [{}];
    for (const { key, count } of lists) {
      const wider = [];
      for (const row of rows)
        for (let i = 0; i < count; i++) wider.push({ ...row, [key]: i });
      rows = wider;
    }
    return rows;
  }
  const counts = lists.map(l => l.count);
  const n = match === "shortest" ? Math.min(...counts) : Math.max(...counts);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = {};
    //! The shorter list repeats its LAST value rather than wrapping round.
    //! Wrapping is defensible and is what a modulo would give for free; it is
    //! also how you get a list of twenty-eight setbacks whose twenty-ninth
    //! quietly goes back to the first. Repeating the last is what Grasshopper
    //! does and what the Point node here already did.
    for (const { key, count } of lists) row[key] = Math.min(i, count - 1);
    rows.push(row);
  }
  return rows;
}

export class Driver {
  constructor(spec, { precondition, build, release, describeError, ownLists, compound, draft }) {
    this.spec = spec;
    this.precondition = precondition || (() => null);
    this.build = build;
    this.release = release || (() => {});
    // Each kernel knows how its own failures arrive; ours is the fallback.
    this.describeError = describeError || kernelMessage;
    //! A DRIVER THAT READS ITS OWN LISTS IS LEFT ALONE. Point, Math,
    //! Expression and the two Evaluate nodes call F.reals and pair up x, y and
    //! z themselves - they have done since before this existed. Iterated from
    //! outside as well they would spread over their lists twice, and a Point
    //! fed twenty-eight x values would come back as seven hundred and
    //! eighty-four points.
    this.ownLists = !!ownLists;
    //! Gathering several shapes into one belongs to the kernel, which is the
    //! only thing here that knows what a shape is.
    this.compound = compound || null;
    //! THIS DRIVER HAS A CHEAP ROAD AND KNOWS WHEN IT IS ON IT. Declared by
    //! the handful of drivers that can cost seconds; read by the document, so
    //! that whatever was built cheaply is built again the moment it is allowed
    //! to be slow. See setDrafting.
    this.draft = !!draft;
  }

  //! WHICH OF THIS FEATURE'S NUMBERS ARRIVED AS LISTS, and how long each is.
  //! Only `real` arguments: those are the ones a wire of numbers can land on.
  //! A list of one is not a list - it is a number that came down a wire, and
  //! it builds once like any other.
  spreadLists(f) {
    if (this.ownLists) return [];
    const spread = F.spread(f);
    const lists = [];
    for (const arg of this.spec.args || []) {
      if (arg.kind !== "real") continue;
      const label = F.argLabel(f, arg.key);
      const wired = label && F.wiredNumbers(label);
      if (!wired) continue;
      //! GRAFTED MEANS "ONE ROW EACH WHATEVER THE LENGTH". On a list of one it
      //! is the difference between a feature that builds a shape and one that
      //! builds a compound holding a shape - which is nothing to look at and
      //! everything to whatever is downstream counting items.
      if (wired.length > 1 || spread.graft.includes(arg.key))
        lists.push({ key: arg.key, count: wired.length });
    }
    return lists;
  }

  //! A reference argument depends on the *result* of the feature it points at.
  //! That is what orders the graph: edit a cube and its fillet must follow.
  arguments(f) {
    const args = [];
    // PARENT_TAG carries a reference too, and it is deliberately not one of
    // these: which folder a feature is filed in has nothing to do with what it
    // is built from. Counting it would order the graph by the tree, make every
    // member of a set depend on the set, and refuse to delete a container
    // because everything in it "reads from" it.
    const skip = new Set([RESULT_TAG, ERROR_TAG, REVISION_TAG, NOTE_TAG, DATA_TAG, PARENT_TAG]);
    const walk = label => {
      for (const child of label.childList()) {
        if (label === f && skip.has(child.tag)) continue;
        const target = child.attr.TDF_Reference;
        if (target) {
          // A wire carries both what was built and what was computed, and a
          // reader may be waiting on either.
          args.push(F.resultLabel(target, true));
          args.push(F.dataLabel(target, true));
        }
        args.push(child);
        // An input taking several wires keeps them on children of its own.
        if (child.children.size) walk(child);
      }
    };
    walk(f);
    return args;
  }
  //! SEVERAL ROWS' WORTH OF ANSWER, MADE INTO ONE FEATURE'S WORTH.
  //!
  //! Shapes go into a compound, which is how OpenCascade says "these several
  //! things, together" and is already what a sketch with three loops in it
  //! hands over. That matters more than it looks: extruding a compound of
  //! twenty-eight wires gives twenty-eight solids without anything downstream
  //! being told about lists at all. The multiplication carries itself.
  //!
  //! Data is concatenated when every row agrees on what kind it is, and
  //! dropped when they do not, which cannot happen from one driver but is
  //! cheap to be sure of.
  gather(made, rows, refused = []) {
    const shapes = made.map(one =>
      (one && typeof one.ShapeType === "function") ? one : (one && one.shape)).filter(Boolean);
    const datas = made.map(one =>
      (one && typeof one.ShapeType === "function") ? null : (one && one.data)).filter(Boolean);
    const shape = shapes.length && this.compound
      ? (shapes.length === 1 ? shapes[0] : this.compound(shapes))
      : (shapes[0] || null);
    let data = null;
    if (datas.length && datas.every(d => d.kind === datas[0].kind)) {
      data = { ...datas[0], values: datas.flatMap(d => d.values || []) };
      if (datas.some(d => d.lines)) data.lines = datas.flatMap(d => d.lines || []);
    }
    //! The row note is kept when every row said the same thing, which they
    //! almost always do - "1 run · open · sharp corners" is about the curve,
    //! not about the distance. When they differ it is dropped rather than
    //! picked from, because one row's note standing for twenty-eight is a lie
    //! that reads like a fact.
    const notes = new Set(made.map(one => (one && one.note) || ""));
    const shared = notes.size === 1 ? [...notes][0] : "";
    const count = shapes.length || datas.length;
    const note = [
      count + (count === 1 ? " item" : " items")
        + (refused.length ? " of " + rows + " - " + refused.length + " would not build" : ""),
      shared,
    ].filter(Boolean).join(" \u00b7 ");
    return { shape, data, note };
  }

  results(f) { return [F.resultLabel(f, true), F.dataLabel(f, true)]; }
  mustExecute(f, log) {
    return log.isModified(f) || this.arguments(f).some(a => log.isModified(a));
  }

  //! Never lets the kernel take the process with it: the arguments are checked
  //! first, the call itself is guarded, and a failure keeps the last good shape
  //! so the rest of the tree still regenerates.
  //! A failure clears the note as well as setting the error. A note is a
  //! report on the last thing that built, and left beside an error it is a
  //! report on something that is no longer there - "4 items" sitting under
  //! "every side length must be positive", describing a build two edits ago.
  fail(f, why) { F.setError(f, why); F.setNote(f, ""); return 1; }

  execute(f, log) {
    //! ONCE PER ROW OF ITS LISTS, which for almost every feature is once.
    const lists = this.spreadLists(f);
    const rows = spreadRows(lists, F.spread(f).match);

    let built = null;
    if (rows.length === 1 && !rows[0]) {
      const objection = this.precondition(f);
      if (objection) return this.fail(f, objection);
      try {
        built = this.build(f);
      } catch (err) {
        return this.fail(f, this.describeError(err));
      }
    } else {
      const made = [], refused = [];
      const was = spreadRow(null);
      try {
        for (const row of rows) {
          spreadRow(row);
          //! THE PRECONDITION IS PART OF THE ROW, not part of the feature.
          //! It reads the same numbers the build does - "every side length
          //! must be positive" is a question about THIS row's numbers - so
          //! asked once before the loop it was asked about row zero and
          //! answered for all of them. A Series starting at 0 wired into a
          //! cube's height refused all eight boxes because the first was
          //! flat.
          const objection = this.precondition(f);
          if (objection) { refused.push(objection); continue; }
          try {
            const one = this.build(f);
            if (one) made.push(one);
          } catch (err) {
            //! A ROW THAT WILL NOT BUILD IS SKIPPED AND COUNTED, not thrown.
            //! Twenty-eight setbacks off one curve, and the four tightest of
            //! them have nowhere to go: refusing all twenty-eight because of
            //! those four is refusing the answer because part of it is
            //! interesting. The count goes in the note, so the four are not
            //! silent either.
            refused.push(this.describeError(err));
          }
        }
      } finally { spreadRow(was); }
      if (!made.length)
        return this.fail(f, refused.length
          ? refused[0] + (refused.length > 1
              ? " (and " + (refused.length - 1) + " more of the " + rows.length + ")" : "")
          : "none of those " + rows.length + " rows built anything");
      built = this.gather(made, rows.length, refused);
    }

    // A driver hands back a shape, or { shape, data }, or data alone - a Number
    // and a Series compute something and build nothing.
    const bare = built && typeof built.ShapeType === "function";
    const shape = bare ? built : (built && built.shape) || null;
    const data = bare ? null : (built && built.data) || null;
    if (!shape && !data) return this.fail(f, "the driver produced nothing");

    const result = F.resultLabel(f, true);
    if (result.attr.TNaming_NamedShape) this.release(result.attr.TNaming_NamedShape);
    result.attr.TNaming_NamedShape = shape;
    const dataLabel = F.setData(f, data);

    F.setNote(f, (built && built.note) || "");
    F.setError(f, "");
    F.bumpRevision(f);
    log.impact(result);
    log.impact(dataLabel);
    log.impact(f);
    return 0;
  }
}

//! OpenCascade throws Standard_Failure, which arrives as a pointer, a number or
//! an Error depending on how it crossed the boundary. Say something useful
//! whichever it was.
export function kernelMessage(err) {
  if (!err) return "it failed without a message";
  if (typeof err === "string") return err;
  if (typeof err === "number") return "internal fault (code " + err + ")";
  if (err.message) return err.message.replace(/^Error:\s*/, "");
  return String(err);
}

/* ---------------------------------------------------------------- document */

export class Doc {
  constructor(drivers, title = "Part1", units = "mm") {
    this.drivers = drivers;              // guid -> Driver
    this.root = new Label(0, null);
    this.main = this.root.findChild(1, true);
    this.main.attr.TDataStd_Name = title;
    this.main.attr.TDataStd_AsciiString = units;
    this.featuresRoot = this.main.findChild(1, true);
    this.log = new Logbook();
    //! The features whose last build was a draft - approximate, because a hand
    //! was on a slider at the time. Emptied as they are built again for real.
    this.drafted = new Set();
    this.title = title;
    this.units = units;
  }

  //! THE FEATURES, WALKED ONCE PER CHANGE RATHER THAN ONCE PER QUESTION.
  //!
  //! This was a sort of the tag map every time anybody asked, and find() was a
  //! linear scan over the answer. That is invisible on a part with forty
  //! features in it and it is the whole cost of opening a building: reading a
  //! Revit model of 8,859 features took 168 seconds, and almost all of it was
  //! forty thousand edits each scanning nine thousand features to look up the
  //! one they were about. Indexed, the same file takes seconds.
  //!
  //! Kept honest by treeStamp rather than by remembering to invalidate:
  //! nothing can add or remove a label without the counter moving, so the
  //! cache cannot be stale - only missed.
  features() {
    if (this.listAt !== treeStamp || !this.list) {
      this.list = this.featuresRoot.childList().filter(l => l.attr.TFunction_Function);
      this.byId = null;
      this.listAt = treeStamp;
    }
    return this.list;
  }
  find(reference) {
    const list = this.features();
    const index = () => {
      const map = new Map();
      for (const f of list) map.set(F.id(f), f);
      return map;
    };
    if (!this.byId) this.byId = index();
    const hit = this.byId.get(reference);
    //! CHECKED, NOT TRUSTED. A feature's id is written onto the label AFTER
    //! the label exists, so an index taken in between has it under the empty
    //! string - and the tree's shape did not change when the id was written,
    //! so nothing else would notice. A miss rebuilds once and tries again,
    //! which costs a walk on a genuine miss and nothing at all otherwise.
    if (hit && F.id(hit) === reference) return hit;
    this.byId = index();
    //! An id first, because that is what an edit carries. A NAME is the
    //! fallback and stays a scan: names change without the tree changing
    //! shape, so an index of them could go stale in a way this one cannot.
    return this.byId.get(reference) || list.find(f => F.name(f) === reference) || null;
  }
  driverOf(f) { return this.drivers.get(f.attr.TFunction_Function) || null; }

  //! A NAME NOTHING ELSE HAS. Walked from a counter rather than from one,
  //! because a file of nine thousand features adds them one at a time and
  //! starting the count at one every time is a walk per feature - which is the
  //! same quadratic that made reading a building take minutes.
  uniqueName(type) {
    const used = new Set(this.features().map(F.name));
    const from = (this.nameFrom || (this.nameFrom = new Map())).get(type) || 1;
    for (let i = from; ; i++)
      if (!used.has(type + "." + i)) { this.nameFrom.set(type, i + 1); return type + "." + i; }
  }
  uniqueId(type) {
    const used = new Set(this.features().map(F.id));
    const stem = type.slice(0, 2).toUpperCase();
    for (let i = 1; ; i++) if (!used.has(stem + i)) return stem + i;
  }

  addFeature(type, id, name) {
    const spec = typeSpec(type);
    if (!spec) throw new Error('unknown feature type "' + type + '"');
    if (id && this.find(id)) throw new Error('duplicate feature id "' + id + '"');

    const f = this.featuresRoot.newChild();
    f.attr.TFunction_Function = spec.guid;
    f.attr.TDataStd_AsciiString = id || this.uniqueId(type);
    f.attr.TDataStd_Name = name || this.uniqueName(type);
    //! FOLDED INTO THE INDEXES rather than invalidating them. Reading a
    //! building is nine thousand adds, and a rebuilt index on each one is the
    //! walk per add that the index was there to remove - measured at about
    //! fifty seconds on a Revit model. An add is the one change that folds in
    //! exactly: the feature goes on the end of the list, under its own id, and
    //! in nobody's set until something files it.
    if (this.list && this.listAt === treeStamp) {
      this.list.push(f);
      if (this.byId) this.byId.set(F.id(f), f);
    }
    nestingChanged();
    F.setVisible(f, true);
    for (const arg of spec.args) {
      const label = F.argLabel(f, arg.key, true);
      if (arg.kind === "real") label.attr.TDataStd_Real = arg.def;
      else if (arg.kind === "choice") label.attr.TDataStd_Integer = arg.def;
      else if (arg.kind === "code") label.attr.TDataStd_AsciiString = arg.def;
      else if (arg.kind === "sketch") label.attr.TDataStd_AsciiString = arg.def;
    }
    F.resultLabel(f, true);
    this.log.touch(f);
    return f;
  }

  //! Every wire out of \p f, whichever kind of input it lands on - a reference
  //! argument, a slider being driven, or one of several sections into a loft.
  dependents(f) {
    return this.features().filter(other => this.wiresOf(other).includes(f));
  }

  wiresOf(f) {
    const out = [];
    for (const arg of F.spec(f).args) {
      if (arg.kind === "refs") out.push(...F.references(f, arg.key));
      else {
        const target = F.reference(f, arg.key);
        if (target) out.push(target);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------ containers

     A container is a feature like any other - it is in the same flat list, in
     the same rebuild order - and being in one is a single reference on the
     member pointing back. Everything below is that one fact read different
     ways.                                                                   */

  isContainer(f) { return !!f && F.spec(f).category === "container"; }

  //! WHAT IS IN WHICH SET, indexed. Asking it by filtering the whole document
  //! is one walk per set, and a set's summary is rebuilt on every regeneration
  //! - so on a building of 1,665 sets that was 48 seconds of walking, per
  //! rebuild, to write "12 items" sixteen hundred times.
  childIndex() {
    if (this.kidsAt !== treeStamp + parentStamp || !this.kids) {
      this.kids = new Map();
      for (const f of this.features()) {
        const parent = F.parent(f);
        const list = this.kids.get(parent);
        if (list) list.push(f); else this.kids.set(parent, [f]);
      }
      this.kidsAt = treeStamp + parentStamp;
    }
    return this.kids;
  }

  //! And the other direction: who reads from this one. Same reason - a set's
  //! summary says what reads out of it, which asked the long way is a walk of
  //! every wire in the document per set.
  readerIndex() {
    if (this.readersAt !== wireStamp + treeStamp || !this.readers) {
      this.readers = new Map();
      for (const f of this.features())
        for (const source of this.wiresOf(f)) {
          const list = this.readers.get(source);
          if (list) { if (!list.includes(f)) list.push(f); } else this.readers.set(source, [f]);
        }
      this.readersAt = wireStamp + treeStamp;
    }
    return this.readers;
  }

  //! What is filed directly in a container, in document order.
  contents(container) { return this.childIndex().get(container) || []; }

  //! Everything in it, however deep - a set inside a set is still inside.
  within(container) {
    const out = [];
    const walk = set => {
      for (const f of this.contents(set)) { out.push(f); if (this.isContainer(f)) walk(f); }
    };
    walk(container);
    return out;
  }

  //! File \p f under \p container, or at the top level when it is null. A set
  //! cannot be put inside itself, at any depth: that is the one move that would
  //! make a tree stop being one.
  setParent(f, container) {
    if (container) {
      if (!this.isContainer(container))
        throw new Error(F.name(container) + " is not a set - only a set holds things");
      if (container === f) throw new Error("a set cannot be put inside itself");
      for (let up = F.parent(container); up; up = F.parent(up))
        if (up === f) throw new Error(F.name(container) + " is already inside " + F.name(f));
    }
    F.setParent(f, container || null);
    nestingChanged();                    // what is in which set has moved
    this.log.touch(f);
    if (container) this.log.touch(container);
  }

  //! What feeds a set from outside it: every feature that something inside
  //! reads from and that is not itself inside. The boundary of the set, stated
  //! as a list - which is the whole reason for drawing a boundary.
  inputsOf(container) {
    const inside = new Set([container, ...this.within(container)]);
    const out = [];
    for (const f of inside)
      for (const source of this.wiresOf(f))
        if (!inside.has(source) && !out.includes(source)) out.push(source);
    return out;
  }

  //! And the other direction: what outside the set reads from something in it.
  //! Deleting a set never touches these, because deleting a set never deletes
  //! what is in it.
  outputsOf(container) {
    const inside = new Set([container, ...this.within(container)]);
    const index = this.readerIndex();
    const out = [];
    for (const one of inside)
      for (const reader of index.get(one) || [])
        if (!inside.has(reader) && !out.includes(reader)) out.push(reader);
    return out;
  }

  //! DELETE IS DELETE. One behaviour, and it is the node editor's.
  //!
  //! Taking a node out of a graph does not ask permission and does not leave a
  //! shell behind. What read FROM it loses an input and says so; what it read
  //! from is untouched, because nothing about those changed. That is all a
  //! delete is, and it used to be three things pretending to be one:
  //!
  //!   A SET WAS DISSOLVED rather than deleted. Its contents were handed back
  //!   to whatever the set was in and the folder vanished from under them,
  //!   which is not what anybody means by deleting a set - it is what they
  //!   mean by ungrouping one, and that is what moving things out of a set
  //!   already does, in the menu, by name.
  //!
  //!   A FEATURE SOMETHING READ FROM WAS REFUSED. "Fillet.1 still reads from
  //!   Cube.1" is true and is not a reason to keep the cube: the fillet is
  //!   going to have to hear about this sooner or later, and telling it now,
  //!   with an empty input it can complain about, is better than making the
  //!   person work out the order to take a model apart in.
  //!
  //!   AND THERE WAS A SECOND DELETE for the case the first one would not do,
  //!   which is one command too many for an operation this plain.
  //!
  //! What is gone is gone from the model file too, which is the other half of
  //! "removed": no orphan parent references, no wires pointing at nothing.
  deleteFeature(f) {
    //! A folder goes with what is in it, all the way down. Listed before
    //! anything is removed, because reading the contents of a label that has
    //! been taken out of the tree gives nothing.
    const going = [f, ...this.within(f)];
    const doomed = new Set(going);
    for (const one of going) {
      //! Only the wires from OUTSIDE need cutting - a reader that is going
      //! too has nothing to be left holding.
      for (const reader of this.dependents(one)) {
        if (doomed.has(reader)) continue;
        for (const arg of F.spec(reader).args) {
          if (arg.kind !== "ref" && arg.kind !== "refs") continue;
          this.clearReference(reader, arg.key, one);
        }
      }
    }
    for (const one of going) {
      const shape = F.shape(one);
      const driver = this.driverOf(one);
      if (shape && driver) driver.release(shape);
      this.featuresRoot.dropChild(one.tag);
      treeChanged();
    }
    return going.length;
  }

  setParameter(f, key, value) {
    const spec = F.spec(f);
    const arg = spec && spec.args.find(a => a.key === key &&
      (a.kind === "real" || a.kind === "choice"));
    if (!Number.isFinite(value)) throw new Error("'" + key + "' must be a number");

    if (!arg) {
      // Not in the catalogue - it may be one the script declared for itself.
      const declared = F.paramSpecs(f).find(p => p.key === key);
      if (!declared) throw new Error(F.name(f) + " has no parameter '" + key + "'");
      const stored = clampTo(declared, value);
      this.log.touch(F.setParamValue(f, key, stored));
      return stored;
    }

    const label = F.argLabel(f, key, true);
    let stored;
    if (arg.kind === "choice") {
      // A choice really is bounded: there is no fifth option out of four.
      stored = Math.min(arg.options.length - 1, Math.max(0, Math.round(value)));
      label.attr.TDataStd_Integer = stored;
    } else {
      // A number is not. What the catalogue declares is how far the SLIDER
      // travels - a comfortable range for the thing at hand - and clamping to
      // it meant a building could not be typed in at all: a 9 m wall silently
      // became 4 m because a cube's slider stops there, and nothing said so.
      // A wired number was never clamped, so this was inconsistent as well as
      // wrong. The drivers guard themselves; that is what preconditions are for.
      if (!Number.isFinite(value)) throw new Error("'" + key + "' must be a number");
      stored = value;
      label.attr.TDataStd_Real = stored;
    }
    this.log.touch(label);
    return stored;
  }

  //! Editing the source is an edit like any other: the label is touched and the
  //! solver re-runs this feature and everything downstream of it.
  setCode(f, key, text) {
    const spec = F.spec(f);
    // Text and code share the attribute and the edit; a one-line field and a
    // full editor are two controls over one string.
    const arg = spec && spec.args.find(a => a.key === key &&
      (a.kind === "code" || a.kind === "text"));
    if (!arg) throw new Error(F.name(f) + " has no text to edit at '" + key + "'");
    if (typeof text !== "string") throw new Error("the code must be text");
    F.setCode(f, key, text);
    this.log.touch(F.argLabel(f, key));
  }

  //! Drawing a line is an edit like any other: the drawing is one string on one
  //! label, and rewriting it re-runs the sketch and everything downstream of it.
  //! The sketcher, the node editor and someone typing into the model file all
  //! arrive here.
  setSketch(f, key, source) {
    const spec = F.spec(f);
    const arg = spec && spec.args.find(a => a.key === key && a.kind === "sketch");
    if (!arg) throw new Error(F.name(f) + " has no drawing at '" + key + "'");
    const clean = F.setSketch(f, key, source);
    this.log.touch(F.argLabel(f, key));
    return clean;
  }

  //! Appearance drives no geometry, so it is set without touching the logbook:
  //! nothing needs rebuilding, only redrawing.
  //! MOVING A FEATURE UP OR DOWN THE TREE.
  //!
  //! What the tree shows, top to bottom, is the order the feature labels sit
  //! in under the document - childList sorts by tag - so moving a row is
  //! renumbering tags. That is safe here for one reason worth saying out loud:
  //! a feature's IDENTITY is a string stored on it, not its tag, and a wire is
  //! a pointer to a label rather than a path to one. So nothing that refers to
  //! a feature refers to where it sits.
  //!
  //! It does not touch the rebuild order either. Regeneration walks the
  //! DEPENDENCY graph, which is what the arguments say and not what the tree
  //! shows, so a feature dragged above the thing it is built from still builds
  //! after it. CATIA forbids that arrangement; this only declines to pretend
  //! the tree is the graph.
  //!
  //! \p ids move together, in the order they are given, to just before or
  //! after \p target.
  reorder(ids, target, after = false) {
    const all = this.features();
    const moving = ids.map(id => this.find(id)).filter(Boolean);
    if (!moving.length || !target) return false;
    const landing = this.find(target);
    if (!landing || moving.includes(landing)) return false;
    const rest = all.filter(f => !moving.includes(f));
    const at = rest.indexOf(landing);
    if (at < 0) return false;
    const cut = at + (after ? 1 : 0);
    const order = [...rest.slice(0, cut), ...moving, ...rest.slice(cut)];
    //! Renumbered from one, into a map rebuilt from scratch. Writing tags into
    //! the map they are keys of, one at a time, walks over entries that have
    //! not moved yet.
    const root = this.featuresRoot;
    const others = root.childList().filter(l => !l.attr.TFunction_Function);
    root.children = new Map();
    treeChanged();
    order.forEach((f, index) => { f.tag = index + 1; root.children.set(f.tag, f); });
    let next = order.length;
    for (const spare of others) { spare.tag = ++next; root.children.set(spare.tag, spare); }
    root.nextTag = Math.max(root.nextTag, next);
    //! Nothing is TOUCHED. A feature that moved did not change, and neither
    //! did anything reading it - the tree is drawn from this order and that is
    //! the whole of what changed.
    return true;
  }

  //! SHOW A BODY SOMETHING ELSE SWALLOWED, or stop. Sets the flag AND the
  //! visibility, so the answer is right before the next regeneration rather
  //! than after it - nothing here rebuilds, and waiting for an unrelated edit
  //! to make the view agree is how a switch comes to look broken.
  setPinnedShown(f, on) {
    F.setPinnedShown(f, on);
    if (on) F.setVisible(f, true);
    else if (this.consumedBy(f)) F.setVisible(f, false);
    return !!on;
  }

  setAppearance(f, appearance) { F.setAppearance(f, appearance); }

  //! TOUCHED, unlike the appearance beside it. How a feature pairs up its
  //! lists decides how many shapes it makes and what each one is built from,
  //! so changing it is changing the geometry and the graph has to know.
  setSpread(f, spread) {
    const stored = F.setSpread(f, spread);
    this.log.touch(f.findChild(SPREAD_TAG, true));
    this.log.touch(f);
    return stored;
  }

  //! Wiring. An input says what a source may *produce*, not which feature types
  //! it will take, so a component added later is accepted everywhere its output
  //! makes sense. A slider takes a wire too: any input at all accepts numbers.
  //! \p only makes this the input's single wire rather than one more on it -
  //! what dropping a wire on a multi-wire input without holding shift means.
  setReference(f, key, target, only = false) {
    const spec = F.spec(f);
    const arg = spec && spec.args.find(a => a.key === key);
    if (!arg || arg.kind === "code" || arg.kind === "sketch")
      throw new Error(F.name(f) + " has no input '" + key + "'");
    if (target) {
      const accepts = arg.kind === "ref" || arg.kind === "refs" ? arg.accepts : ["number"];
      const gives = F.spec(target).produces;
      if (!accepts.includes(gives))
        throw new Error(arg.label + " takes " + accepts.join(" or ") + ", and "
          + F.name(target) + " gives " + gives);
      if (this.dependsOn(target, f))
        throw new Error(F.name(target) + " already depends on " + F.name(f));
    }
    if (arg.kind === "refs") {
      const already = only ? [] : F.references(f, key);
      F.setReferences(f, key, target ? [...already, target] : already);
    } else {
      F.setReference(f, key, target);
    }
    this.log.touch(F.argLabel(f, key, true));
  }

  //! Removes one wire from an input, by the feature it came from. A single-wire
  //! input clears; a multi-wire input closes the gap.
  clearReference(f, key, target) {
    const spec = F.spec(f);
    const arg = spec && spec.args.find(a => a.key === key);
    if (!arg) throw new Error(F.name(f) + " has no input '" + key + "'");
    if (arg.kind === "refs") {
      const kept = F.references(f, key).filter(t => t !== target);
      F.setReferences(f, key, target ? kept : []);
    } else {
      F.setReference(f, key, null);
    }
    this.log.touch(F.argLabel(f, key, true));
  }

  //! True when \p f reads, directly or not, from \p other.
  dependsOn(f, other) {
    const seen = new Set();
    const walk = current => {
      if (current === other) return true;
      if (seen.has(current)) return false;
      seen.add(current);
      return this.wiresOf(current).some(target => {
        return target ? walk(target) : false;
      });
    };
    return walk(f);
  }

  //! Kahn's algorithm over producer -> consumer edges: the order
  //! TFunction_Iterator derives from the same Arguments()/Results() lists.
  order() {
    const features = this.features();
    const producer = new Map();
    for (const f of features) {
      producer.set(F.resultLabel(f, true), f);
      producer.set(F.dataLabel(f, true), f);
    }
    const incoming = new Map(features.map(f => [f, new Set()]));
    const outgoing = new Map(features.map(f => [f, new Set()]));

    for (const f of features)
      for (const a of this.driverOf(f).arguments(f)) {
        const from = producer.get(a);
        if (from && from !== f) { incoming.get(f).add(from); outgoing.get(from).add(f); }
      }

    const ready = features.filter(f => incoming.get(f).size === 0);
    const sorted = [];
    while (ready.length) {
      const f = ready.shift();
      sorted.push(f);
      for (const next of outgoing.get(f)) {
        incoming.get(next).delete(f);
        if (incoming.get(next).size === 0) ready.push(next);
      }
    }
    for (const f of features) if (!sorted.includes(f)) sorted.push(f); // a cycle must not hide the rest
    return sorted;
  }

  /* ------------------------------------------- regeneration, in slices

     THE SAME WALK, HANDED BACK ONE FEATURE AT A TIME.

     The kernel runs in the page. A regeneration of six thousand features is
     fifteen seconds, and fifteen seconds of a synchronous loop is fifteen
     seconds of a tab that does not scroll, does not repaint and does not say
     why - which is the worst thing an interface can do and the one thing it
     must never do.

     So the loop is a generator. Driven straight through it IS the old
     recompute, to the line; driven a slice at a time it lets the page breathe
     between slices, draw what has been built so far, and say how far along it
     is. Nothing about the order or the result changes - only who is holding
     the loop.                                                              */
  * regenerate(all = false) {
    const report = { functions: 0, executed: [], skipped: [], failed: [], done: 0, total: 0 };
    if (all) for (const f of this.features()) this.log.touch(f);
    if (!draftPass && this.drafted.size)
      for (const f of this.features()) if (this.drafted.has(F.id(f))) this.log.touch(f);
    for (const f of this.features()) if (this.isContainer(f)) this.log.touch(f);

    const order = this.order();
    report.total = order.length;
    for (const f of order) {
      const driver = this.driverOf(f);
      report.done++;
      if (!driver) { yield report; continue; }
      report.functions++;
      const entry = () => ({ id: F.id(f), name: F.name(f), revision: F.revision(f) });
      if (!driver.mustExecute(f, this.log)) { report.skipped.push(entry()); yield report; continue; }
      const drafted = draftPass && !!driver.draft;
      if (driver.execute(f, this.log) === 0) report.executed.push(entry());
      else report.failed.push({ ...entry(), message: F.error(f) });
      if (drafted) this.drafted.add(F.id(f)); else this.drafted.delete(F.id(f));
      yield report;
    }
    this.log.clear();
    this.updateVisibility();
    return report;
  }

  recompute(all = false) {
    const run = this.regenerate(all);
    let step = run.next();
    while (!step.done) step = run.next();
    return step.value;
  }

  //! A body consumed by an operation stays in the tree and leaves the 3D view
  //! - unless somebody has said otherwise, which they are now allowed to do.
  //!
  //! This runs after every regeneration, so what it writes it writes again on
  //! every edit. That is what made turning a swallowed body back on
  //! impossible: the switch worked, and the next slider dragged anywhere in
  //! the document put it back. The pin is checked here and nowhere else, which
  //! is why one line is the whole of the fix.
  updateVisibility() {
    const features = this.features();
    for (const f of features) F.setVisible(f, true);
    for (const f of features)
      for (const arg of F.spec(f).args) {
        if (!arg.consumes) continue;
        const sources = arg.kind === "refs" ? F.references(f, arg.key) : [F.reference(f, arg.key)];
        for (const source of sources)
          if (source && !F.pinnedShown(source)) F.setVisible(source, false);
      }
  }
  //! WHAT SWALLOWED THIS ONE - a fillet's cube, a boolean's two bodies.
  //!
  //! Asked of every feature in treeJson, and answered by walking every OTHER
  //! feature and every argument of it. That is n squared with an argument loop
  //! inside, and on a building of six thousand features it was SEVEN AND A
  //! HALF SECONDS to write the tree - once per edit, before anything is
  //! drawn. Indexed on the same stamps as the reader index beside it.
  eaterIndex() {
    if (this.eatersAt !== wireStamp + treeStamp || !this.eaters) {
      this.eaters = new Map();
      for (const other of this.features())
        for (const arg of F.spec(other).args) {
          if (!arg.consumes) continue;
          const sources = arg.kind === "refs" ? F.references(other, arg.key)
                                              : [F.reference(other, arg.key)];
          for (const source of sources)
            if (source && !this.eaters.has(source)) this.eaters.set(source, other);
        }
      this.eatersAt = wireStamp + treeStamp;
    }
    return this.eaters;
  }
  consumedBy(f) { return this.eaterIndex().get(f) || null; }

  /* --------------------------------------------------- the wire formats */

  //! The document a front-end mirrors. Identical in shape to TreeToJson() in
  //! the native kernel, so the interface cannot tell the two apart.
  treeJson() {
    return {
      format: "ocaf-tree", version: 1, name: this.title, units: this.units,
      features: this.features().map(f => {
        const spec = F.spec(f);
        const values = {}, refs = {}, labels = {}, driven = {}, lists = {}, texts = {};
        // Imported geometry is published as its size and nothing else. The
        // tree travels on every rebuild, and a few megabytes of B-Rep in it
        // would be a few megabytes moved to redraw a name.
        const sizes = {};
        for (const arg of spec.args) {
          const label = F.argLabel(f, arg.key, true);
          labels[arg.key] = label.entry;
          if (arg.kind === "real") {
            values[arg.key] = F.real(f, arg.key, arg.def);
            // A slider with a wire on it shows what is arriving; the literal
            // underneath is what comes back when the wire is pulled off.
            if (label.attr.TDF_Reference) {
              driven[arg.key] = F.id(label.attr.TDF_Reference);
              refs[arg.key] = driven[arg.key];
              const wired = F.wiredNumbers(label);
              if (wired && wired.length > 1) lists[arg.key] = wired.length;
            }
          }
          else if (arg.kind === "choice") values[arg.key] = F.choice(f, arg.key, arg.def);
          else if (arg.kind === "code") { /* published separately, below */ }
          else if (arg.kind === "text") texts[arg.key] = F.text(f, arg.key, arg.def);
          else if (arg.kind === "blob") sizes[arg.key] = F.code(f, arg.key, "").length;
          else if (arg.kind === "edits") lists[arg.key] = F.edits(f, arg.key);
          else if (arg.kind === "subs") {
            lists[arg.key] = F.picks(f, arg.key);
            //! The RULE travels with the list, because the panel has to offer
            //! it and the tree has to be able to say "tangent" rather than
            //! "eight edges".
            values[arg.key] = F.pickMode(f, arg.key);
          }
          else if (arg.kind === "sketch") { /* published whole, below */ }
          else if (arg.kind === "refs") lists[arg.key] = F.references(f, arg.key).map(F.id);
          else {
            const target = F.reference(f, arg.key);
            refs[arg.key] = target ? F.id(target) : null;
          }
        }
        const consumer = this.consumedBy(f);
        const entry = {
          id: F.id(f), name: F.name(f), type: spec.type, category: spec.category,
          produces: spec.produces, entry: f.entry, visible: F.visible(f),
          revision: F.revision(f), built: !!F.shape(f), values, refs, labels, driven,
          lists, texts, sizes,
        };
        const holder = F.parent(f);
        if (holder) entry.parent = F.id(holder);
        if (spec.category === "container") {
          entry.contents = this.contents(f).map(F.id);
          entry.inputs = this.inputsOf(f).map(F.id);
          entry.outputs = this.outputsOf(f).map(F.id);
        }
        // What it computed, summarised: enough for a node to show it and for a
        // Panel to print it, without moving a thousand numbers per redraw.
        const data = F.data(f);
        if (data && (data.values.length || data.lines.length)) {
          entry.data = {
            kind: data.kind, stride: data.stride,
            count: data.lines.length ? data.lines.length
                 : data.values.length / data.stride,
            preview: previewData(data),
          };
          if (data.kind === "mesh") entry.data.faces = meshFaces(data).length;
        }
        // A polymesh has no B-Rep behind it, and is drawn from its own polygons.
        if (data && data.kind === "mesh") entry.built = true;
        // A script publishes its source and the parameters it declared, so the
        // panel can draw an editor and a slider per parameter without knowing
        // anything about what the script builds.
        // The drawing travels whole: the sketcher needs every point of it, and
        // it is small next to a mesh. Same string the model file carries.
        const paper = spec.args.find(a => a.kind === "sketch");
        if (paper) {
          entry.sketch = { key: paper.key, drawing: F.sketch(f, paper.key) };
          entry.sketch.summary = sketchSummary(entry.sketch.drawing);
          // Where the plane put it, last time it built. The viewport needs it
          // to lock the camera and to turn a click back into two numbers.
          const frame = F.frame(f);
          if (frame) entry.sketch.frame = frame;
        }
        //! AND A PLANE'S FRAME, published like a sketch's. The viewport needs
        //! an origin and two directions to turn a click on a plane into a
        //! place on it, and a drawn square is not those.
        if (spec.produces === "plane") {
          const frame = F.frame(f);
          if (frame) entry.frame = frame;
        }
        const source = spec.args.find(a => a.kind === "code");
        if (source) {
          entry.code = F.code(f, source.key, source.def);
          entry.codeKey = source.key;
          const stored = F.paramValues(f);
          entry.params = F.paramSpecs(f).map(p => ({ ...p, value: stored[p.key] ?? p.def }));
        }
        const appearance = F.appearance(f);
        if (appearance) entry.appearance = appearance;
        //! Published on every feature, not only the ones with a list on them,
        //! because the panel offers the setting wherever an input COULD carry
        //! one - which is every real argument there is.
        entry.spread = F.spread(f);
        //! Published so the eye can be drawn pressed on a body that is
        //! showing despite having been swallowed.
        if (F.pinnedShown(f)) entry.shownAnyway = true;
        if (F.error(f)) entry.error = F.error(f);
        if (F.note(f)) entry.note = F.note(f);
        if (consumer) entry.consumedBy = F.id(consumer);
        return entry;
      }),
    };
  }

  modelJson() {
    return {
      format: "ocaf-parametric-model", version: 1, name: this.title, units: this.units,
      features: this.features().map(f => {
        const spec = F.spec(f);
        const args = {};
        for (const arg of spec.args) {
          if (arg.kind === "real") {
            const label = F.argLabel(f, arg.key, true);
            const literal = typeof label.attr.TDataStd_Real === "number"
              ? round(label.attr.TDataStd_Real) : arg.def;
            // A driven slider writes both: where the number comes from, and the
            // value to fall back on when the wire is pulled off.
            args[arg.key] = label.attr.TDF_Reference
              ? { value: literal, from: F.id(label.attr.TDF_Reference) }
              : literal;
          }
          else if (arg.kind === "edits") {
            const moves = F.edits(f, arg.key);
            if (Object.keys(moves).length) args[arg.key] = moves;
          }
          else if (arg.kind === "subs") {
            // Left out when nothing is picked, so a fillet that rounds
            // everything reads in the file exactly as it always did.
            const picked = F.picks(f, arg.key);
            const rule = F.pickMode(f, arg.key);
            //! A bare list when nothing spreads, which is what every file
            //! written before this looks like and what most of them still
            //! will. The object form appears only where a rule was chosen.
            if (picked.length)
              args[arg.key] = rule.mode === PICK_MODES[0]
                ? picked
                : { mode: rule.mode, angle: rule.angle, picks: picked };
          }
          else if (arg.kind === "text") args[arg.key] = F.text(f, arg.key, arg.def);
          else if (arg.kind === "blob") args[arg.key] = F.code(f, arg.key, arg.def);
          else if (arg.kind === "sketch") args[arg.key] = F.sketch(f, arg.key);
          else if (arg.kind === "refs") args[arg.key] = F.references(f, arg.key).map(t => ({ ref: F.id(t) }));
          else if (arg.kind === "choice") args[arg.key] = arg.options[F.choice(f, arg.key, arg.def)];
          else if (arg.kind === "code") {
            args[arg.key] = F.code(f, arg.key, arg.def);
            const stored = F.paramValues(f);
            if (Object.keys(stored).length)
              args.params = Object.fromEntries(
                Object.entries(stored).map(([key, value]) => [key, round(value)]));
          }
          else {
            const target = F.reference(f, arg.key);
            if (target) args[arg.key] = { ref: F.id(target) };
          }
        }
        const entry = { id: F.id(f), type: spec.type, name: F.name(f), args };
        const holder = F.parent(f);
        if (holder) entry.parent = F.id(holder);
        const appearance = F.appearance(f);
        if (appearance) entry.appearance = appearance;
        //! Only where somebody chose something. A file full of
        //! "spread":{"match":"longest","graft":[],"flatten":[]} on every
        //! feature is a file nobody can read a diff of.
        if (F.pinnedShown(f)) entry.shownAnyway = true;
        const spread = F.spread(f);
        const chosen = {};
        if (spread.match !== MATCHES[0]) chosen.match = spread.match;
        for (const of of ["graft", "flatten"])
          if (spread[of].length) chosen[of] = spread[of];
        if (Object.keys(chosen).length) entry.spread = chosen;
        return entry;
      }),
    };
  }

  static fromModel(drivers, model) {
    if (!model || !Array.isArray(model.features)) throw new Error('no "features" array');
    const doc = new Doc(drivers, model.name || "Part1", model.units || "mm");
    for (const entry of model.features) {
      const f = doc.addFeature(entry.type, entry.id, entry.name);
      if (entry.appearance && typeof entry.appearance === "object")
        F.setAppearance(f, entry.appearance);
      if (entry.spread && typeof entry.spread === "object")
        F.setSpread(f, entry.spread);
      if (entry.shownAnyway) F.setPinnedShown(f, true);
    }
    for (const entry of model.features) {
      const f = doc.find(entry.id);
      const spec = F.spec(f);
      for (const [key, value] of Object.entries(entry.args || {})) {
        if (key === "params" && value && typeof value === "object") {
          // Restored before the script runs; the driver reconciles them against
          // what the code declares once it compiles.
          for (const [name, stored] of Object.entries(value))
            if (typeof stored === "number") F.setParamValue(f, name, stored);
          continue;
        }
        const arg = spec.args.find(a => a.key === key);
        if (!arg) throw new Error(spec.type + ' has no argument "' + key + '"');
        if (arg.kind === "code" || arg.kind === "text" || arg.kind === "blob") {
          if (typeof value !== "string") throw new Error(key + " of " + entry.id + " must be text");
          F.setCode(f, key, value);
          continue;
        }
        if (arg.kind === "real") {
          const literal = value && typeof value === "object" ? value.value : value;
          if (typeof literal !== "number")
            throw new Error(key + " of " + entry.id + " must be a number");
          F.setReal(f, key, literal);
          if (value && typeof value === "object" && value.from) {
            const source = doc.find(value.from);
            if (!source) throw new Error(entry.id + "." + key + " is driven by an unknown feature");
            F.setReference(f, key, source);
          }
        } else if (arg.kind === "edits") {
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error(key + " of " + entry.id + " must be an object of index → offset");
          F.setEdits(f, key, value);
        } else if (arg.kind === "subs") {
          //! Either form: the bare list every earlier file holds, or the
          //! object that carries a spreading rule with it.
          const list = Array.isArray(value) ? value : (value && value.picks);
          if (!Array.isArray(list))
            throw new Error(key + " of " + entry.id + " must be a list of picked sub-shapes, "
              + "or an object with a \"picks\" list and a \"mode\"");
          F.setPicks(f, key, list);
          if (!Array.isArray(value) && value)
            F.setPickMode(f, key, value.mode, value.angle);
        } else if (arg.kind === "sketch") {
          if (typeof value !== "string" && (!value || typeof value !== "object"))
            throw new Error(key + " of " + entry.id + " must be a drawing");
          F.setSketch(f, key, value);
        } else if (arg.kind === "refs") {
          const list = Array.isArray(value) ? value : [value];
          F.setReferences(f, key, list.map(item => {
            const target = doc.find(typeof item === "string" ? item : item && item.ref);
            if (!target) throw new Error(entry.id + "." + key + " references an unknown feature");
            return target;
          }));
        } else if (arg.kind === "choice") {
          // Written as the option's name, read back as either name or index.
          const index = typeof value === "number" ? value : arg.options.indexOf(value);
          if (index < 0 || index >= arg.options.length)
            throw new Error(key + " of " + entry.id + " must be one of " + arg.options.join(", "));
          F.setChoice(f, key, index);
        } else {
          const target = doc.find(typeof value === "string" ? value : value.ref);
          if (!target) throw new Error(entry.id + "." + key + " references an unknown feature");
          F.setReference(f, key, target);
        }
      }
    }
    // Filed away last, once every feature exists: a set may be written after
    // the things it holds, or before them, and neither should matter.
    for (const entry of model.features) {
      if (!entry.parent) continue;
      const holder = doc.find(String(entry.parent));
      if (!holder) throw new Error(entry.id + " is filed under an unknown set '"
        + entry.parent + "'");
      doc.setParent(doc.find(entry.id), holder);
    }
    return doc;
  }
}

//! Whether a feature may be wired into an input. Inputs name the kinds they
//! take, not the feature types, so a component added later is accepted
//! everywhere its output makes sense. Type names are still honoured, because a
//! native kernel that predates kinds publishes those.
export function acceptsFrom(accepts, entry) {
  if (!entry) return false;
  const list = Array.isArray(accepts) ? accepts : String(accepts || "").split(",");
  return list.includes(entry.produces) || list.includes(entry.type);
}

//! Numbers out of a line someone typed. Commas, spaces or newlines between
//! them; anything that is not a number is skipped rather than failing the whole
//! list, because half a list is more use than an error while you are typing.
export function parseNumbers(source) {
  return String(source || "").split(/[\s,;]+/)
    // An empty part is not a zero: splitting " " gives two of them, and a list
    // of nothing has to read as a list of nothing.
    .filter(part => part.length)
    .map(part => Number(part))
    .filter(Number.isFinite);
}

export const round = v => Math.round(v * 1e6) / 1e6;

//! What a Panel prints and a node shows under its header. Long lists are cut
//! off with a count, because the point is to see the shape of the data.
//! The faces of a packed mesh, back as lists of vertex indices.
//!
//! The pack is [sides, i, j, …] per face, and then - after a face of NOUGHT
//! sides, which cannot happen and so cannot be mistaken for one - the
//! sharpness table. See \ref meshCreases.
export function meshFaces(data) {
  const out = [];
  const packed = (data && data.faces) || [];
  for (let i = 0; i < packed.length; ) {
    const sides = packed[i++];
    if (!(sides > 0) || i + sides > packed.length) break;
    out.push(packed.slice(i, i + sides));
    i += sides;
  }
  return out;
}

//! HOW SHARP EACH FOLD IS, off the tail of the same integer array.
//!
//! A subdivision surface is smooth everywhere and a building has arrises, so
//! an edge carries a crease from 0 to 1 and a vertex carries a corner. They
//! belong to the MESH rather than to the node that set them - they have to
//! travel downstream through every weld, transform and merge to reach the
//! Subdivide that reads them - and the mesh is two arrays in an OCAF label
//! with no room for a third. So they ride on the end of the face list, behind
//! a sentinel, as thousandths:
//!
//!     … faces … , 0, edgeCount, a, b, w, a, b, w, …, cornerCount, v, w, …
//!
//! Adding an attribute to the schema would have been tidier and would have
//! made every model file written before today unreadable. This does not.
export function meshCreases(data) {
  const packed = (data && data.faces) || [];
  let i = 0;
  for (; i < packed.length; ) {
    const sides = packed[i++];
    if (!(sides > 0) || i + sides > packed.length) break;
    i += sides;
  }
  const creases = {}, corners = {};
  if (packed[i - 1] !== 0) return { creases, corners };
  const edges = packed[i++] || 0;
  for (let n = 0; n < edges && i + 2 < packed.length + 1; n++) {
    const a = packed[i++], b = packed[i++], w = packed[i++];
    creases[a < b ? a + "," + b : b + "," + a] = Math.max(0, Math.min(1, w / 1000));
  }
  const points = packed[i++] || 0;
  for (let n = 0; n < points && i + 1 < packed.length + 1; n++) {
    const v = packed[i++], w = packed[i++];
    corners[v] = Math.max(0, Math.min(1, w / 1000));
  }
  return { creases, corners };
}

//! And the way back: the tail to staple onto a packed face list. Nothing at
//! all when nothing is creased, so a mesh that has never been creased packs
//! exactly as it always did.
export function meshSharpness(creases = {}, corners = {}) {
  const edges = Object.entries(creases)
    .map(([key, w]) => [...key.split(",").map(Number), Math.round(Math.max(0, Math.min(1, w)) * 1000)])
    .filter(([a, b, w]) => Number.isInteger(a) && Number.isInteger(b) && w > 0);
  const points = Object.entries(corners)
    .map(([v, w]) => [Number(v), Math.round(Math.max(0, Math.min(1, w)) * 1000)])
    .filter(([v, w]) => Number.isInteger(v) && w > 0);
  if (!edges.length && !points.length) return [];
  return [0, edges.length, ...edges.flat(), points.length, ...points.flat()];
}

//! How many faces of each number of sides - the one line that says whether a
//! mesh is quads, triangles, or something a subdivision will not enjoy.
export function meshTally(data) {
  const tally = new Map();
  for (const face of meshFaces(data)) tally.set(face.length, (tally.get(face.length) || 0) + 1);
  const name = { 3: "tris", 4: "quads", 5: "pentagons", 6: "hexagons" };
  return [...tally].sort((a, b) => a[0] - b[0])
    .map(([sides, n]) => n + " " + (name[sides] || sides + "-gons")).join(" · ");
}

export function previewData(data, limit = 6) {
  if (!data) return "";
  if (data.kind === "mesh") {
    const tally = meshTally(data);
    return (data.values.length / 3) + " vertices · " + (tally || "no faces");
  }
  if (data.lines.length)
    return data.lines.slice(0, limit).join(" · ")
         + (data.lines.length > limit ? " … +" + (data.lines.length - limit) : "");
  if (data.stride === 3) {
    const points = F.triples(data);
    return points.slice(0, limit).map(p => "(" + p.map(trimNumber).join(", ") + ")").join(" ")
         + (points.length > limit ? " … +" + (points.length - limit) : "");
  }
  return data.values.slice(0, limit).map(trimNumber).join(", ")
       + (data.values.length > limit ? " … +" + (data.values.length - limit) : "");
}

//! Numbers as a person reads them: no trailing zeros, no fifteen decimals.
export const trimNumber = v =>
  Number.isFinite(v) ? String(Math.round(v * 1e4) / 1e4) : String(v);

//! Every line of what a feature computed, for the Panel and for the clipboard.
export function dataLines(data) {
  if (!data) return [];
  if (data.lines.length) return data.lines.slice();
  if (data.stride === 3)
    return F.triples(data).map(p => "(" + p.map(trimNumber).join(", ") + ")");
  return data.values.map(trimNumber);
}

//! How far a slider's track runs: what the catalogue suggests, opened out to
//! hold the value if it is outside - and rounded to something a person would
//! have chosen, so the track ends at 25 000 rather than at 22 143.
export function sliderSpan(arg, value) {
  let { min, max } = arg;
  if (!Number.isFinite(value)) return { min, max };
  const round = (v, up) => {
    const size = Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1)));
    return (up ? Math.ceil(v / size) : Math.floor(v / size)) * size;
  };
  if (value > max) max = round(value * 1.15, true);
  if (value < min) min = round(value * (value < 0 ? 1.15 : 0.85), false);
  return { min, max };
}

//! Keeps a value inside the range its declaration allows.
export function clampTo(spec, value) {
  if (!Number.isFinite(value)) return spec.def;
  const min = Number.isFinite(spec.min) ? spec.min : -Infinity;
  const max = Number.isFinite(spec.max) ? spec.max : Infinity;
  return Math.min(max, Math.max(min, value));
}

//! What a shortened blob says in place of the geometry. Recognised on the way
//! back in, so a model that has been read rather than exported is refused
//! instead of quietly rebuilding without the geometry it appears to describe.
export const ELIDED = "geometry not shown";
const elidedMark = length => "<" + ELIDED + ": " + Math.round(length / 1024) + " kB>";
export const isElided = value =>
  typeof value === "string" && value.startsWith("<" + ELIDED + ":");

/* ================================================== a branch, on its own

   THE POINT OF FILING THINGS. A set is a boundary, and a boundary is only
   worth drawing if you can pick the thing up by it: take the massing out of
   this document and into its own, take the core and the stairs into a file to
   send somebody, split a study that has grown into three studies.

   What comes back is a MODEL FILE, not a fragment. Everything filed under the
   branch comes, and so does everything those features READ FROM - wherever it
   was filed - because a file that will not rebuild is not a file, it is a
   list. A point three sets away that the branch depends on arrives with it and
   lands at the top level, which is where a thing whose set did not come
   belongs.

   Pure, and over the model file rather than the document: this is the
   operation a person means when they say "open this JSON and give me that
   branch", and it should not need a kernel to answer.                       */

//! Every container in a model file, with what is in each - the tree a person
//! browses before picking. The document itself is the first row, because the
//! whole thing is a branch too, and the only one that is always there.
export function branchesIn(model) {
  const features = (model && model.features) || [];
  const rows = [{ id: null, name: model.name || "Part", type: "Document",
                  holds: features.length, whole: true }];
  for (const f of features) {
    if (f.type !== "GeometricalSet" && f.type !== "Body") continue;
    rows.push({ id: f.id, name: f.name || f.id, type: f.type,
                holds: featuresUnder(features, f.id).length, whole: false });
  }
  return rows;
}

//! Everything filed under a set, however deep - a set inside a set is inside
//! the outer one too, which is what nesting means and what the tree draws.
function featuresUnder(features, setId) {
  const held = new Set([setId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of features) {
      if (held.has(f.id) || !f.parent || !held.has(f.parent)) continue;
      held.add(f.id);
      grew = true;
    }
  }
  held.delete(setId);
  return features.filter(f => held.has(f.id));
}

//! THE BRANCH AS A DOCUMENT. \p pick is a set's id, or a list of them, or null
//! for the whole thing.
export function branchOf(model, pick) {
  const features = (model && model.features) || [];
  const wanted = (Array.isArray(pick) ? pick : [pick]).filter(id => id !== undefined);
  if (!wanted.length || wanted.every(id => id === null))
    return { ...model, features: features.map(f => ({ ...f })) };

  const keep = new Set();
  const sets = [];
  for (const id of wanted) {
    const set = features.find(f => f.id === id);
    if (!set) continue;
    sets.push(set);
    keep.add(set.id);
    for (const f of featuresUnder(features, set.id)) keep.add(f.id);
  }
  if (!keep.size) return null;

  // And then everything those read from, transitively. A branch that arrives
  // without the plane its sketch is on is a branch that arrives broken.
  const brought = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of features) {
      if (!keep.has(f.id)) continue;
      for (const target of refsOf(f))
        if (!keep.has(target) && features.some(other => other.id === target)) {
          keep.add(target);
          brought.add(target);
          grew = true;
        }
    }
  }

  // In the order the document had them, which is an order that rebuilds.
  const taken = features.filter(f => keep.has(f.id)).map(f => {
    const copy = { ...f };
    // A parent that did not come cannot be filed under: the feature lands at
    // the top of the new document, which is where it now is.
    if (copy.parent && !keep.has(copy.parent)) delete copy.parent;
    return copy;
  });
  const named = sets.length === 1 ? (sets[0].name || sets[0].id)
    : (model.name || "Part") + " (" + sets.length + " branches)";
  return { ...model, name: named, features: taken, branch: {
    of: model.name || "Part", sets: sets.map(set => set.id),
    brought: [...brought],
  } };
}

//! WHICH FEATURES A FEATURE POINTS AT, in a model file.
//!
//! A reference is written as `{ "ref": "P0" }` inside the arguments, and a list
//! of them as an array of those - which is what makes the file readable and
//! what makes this two lines rather than a schema lookup. The tree says the
//! same thing a different way, as a plain `refs` map, so both shapes are read
//! and a caller can hand in either.
function refsOf(feature) {
  const out = [];
  const take = value => {
    if (!value) return;
    if (Array.isArray(value)) { for (const one of value) take(one); return; }
    if (typeof value === "string") { out.push(value); return; }
    if (typeof value === "object" && typeof value.ref === "string") out.push(value.ref);
  };
  for (const value of Object.values((feature && feature.args) || {})) take(value);
  for (const value of Object.values((feature && feature.refs) || {})) take(value);
  return out;
}

//! The model file with imported geometry taken out and its size put in its
//! place. A copy, for reading: what the text box shows when a document carries
//! a few megabytes of B-Rep, and what the assistant is briefed with - because
//! nobody reads a megabyte of B-Rep and in a prompt it is a megabyte of
//! nothing. The document itself is untouched, and what comes back says on its
//! face that it cannot be rebuilt from.
export function lightenModel(model) {
  let elided = 0;
  const features = (model.features || []).map(entry => {
    const spec = typeSpec(entry.type);
    if (!spec) return entry;
    const blobs = spec.args.filter(arg => arg.kind === "blob").map(arg => arg.key);
    if (!blobs.length) return entry;
    const args = { ...entry.args };
    for (const key of blobs) {
      if (typeof args[key] !== "string" || !args[key].length) continue;
      elided += args[key].length;
      args[key] = elidedMark(args[key].length);
    }
    return { ...entry, args };
  });
  return elided ? { ...model, features, elided } : model;
}

//! The catalogue in the shape the HTTP kernel publishes it, so the interface
//! reads one format whichever kernel it is talking to.
export function schemaJson() {
  return {
    format: "ocaf-feature-catalogue", version: 1,
    kinds: KINDS, categories: CATEGORIES,
    types: CATALOGUE.map(spec => ({
      type: spec.type, guid: spec.guid, category: spec.category,
      produces: spec.produces, summary: spec.summary,
      // A node nobody adds by hand. It exists, it rebuilds, it is in the
      // catalogue and the assistant is told about it - it just has no button,
      // because pressing one would make an import of nothing.
      ...(spec.hidden ? { hidden: true } : {}),
      //! A node that reads other features' APPEARANCES, and so has to be
      //! rebuilt when one changes. A drawing is the only kind there is: what
      //! a body is poched with is part of how it looks AND is geometry on the
      //! sheet. See setAppearance, which asks this rather than knowing names.
      ...(spec.readsAppearance ? { readsAppearance: true } : {}),
      args: spec.args.map((arg, index) => {
        const base = { key: arg.key, label: arg.label, tag: FIRST_ARG_TAG + index, kind: arg.kind };
        if (arg.showWhen) base.showWhen = arg.showWhen;
        if (arg.kind === "real")
          return { ...base, default: arg.def, min: arg.min, max: arg.max,
                   step: arg.step, unit: arg.unit, accepts: "number" };
        if (arg.kind === "choice")
          return { ...base, default: arg.def, options: arg.options };
        if (arg.kind === "code")
          return { ...base, default: arg.def };
        if (arg.kind === "blob")
          return { ...base, default: "", carries: arg.carries || "" };
        if (arg.kind === "edits")
          return { ...base, default: arg.def, summary: arg.summary || "" };
        if (arg.kind === "subs")
          return { ...base, default: arg.def, of: arg.of, whole: arg.whole,
                   summary: arg.summary || "" };
        if (arg.kind === "sketch")
          return { ...base, default: arg.def, summary: arg.summary || "" };
        if (arg.kind === "text")
          return { ...base, default: arg.def, hint: arg.hint || "" };
        return { ...base, accepts: arg.accepts.join(","), consumes: arg.consumes,
                 ...(arg.guess === false ? { guess: false } : {}) };
      }),
    })),
  };
}
