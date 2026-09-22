"""Cross-check src/dxf.js output with ezdxf (pip install ezdxf).

    python3 test/dxf_ezdxf_check.py [file.dxf]

With no argument, a node one-liner writes a DXF from a test scene with every
primitive kind (the 10 mm square at 1.0 mm, arcs both ways, a Bezier, a fill
with an arc edge, a patterned hatch, dashed line, MTEXT) into a temp file.
Exit status 0 = ezdxf opened it, audit found no errors, and the square's
lineweight reads 100.
"""
import os, subprocess, sys, tempfile

import ezdxf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

NODE = r"""
import { writeDXF } from "./src/dxf.js";
const L = (a, b) => ({ k: "L", a, b });
const sq = [L([0,0],[10,0]), L([10,0],[10,10]), L([10,10],[0,10]), L([0,10],[0,0])];
const scene = { size: [420, 297], prims: [
  { t: "stroke", path: sq, weight: 1.0, colour: "#000000", dash: null, layer: "SQUARE" },
  { t: "stroke", path: [{ k: "A", c: [50,50], r: 20, a0: 0, a1: Math.PI/2 }], weight: 0.42, colour: "#ff0000", layer: "Arcs" },
  { t: "stroke", path: [{ k: "A", c: [100,50], r: 20, a0: Math.PI/2, a1: 0 }], weight: 0.35, colour: "#00ff00", layer: "Arcs" },
  { t: "stroke", path: [{ k: "A", c: [150,50], r: 10, a0: 0, a1: 2*Math.PI }], weight: 0.25, colour: "#0000ff", layer: "Arcs" },
  { t: "stroke", path: [{ k: "C", a: [0,100], c1: [10,120], c2: [30,120], b: [40,100] }], weight: 0.5, colour: "#123456", layer: "Curves" },
  { t: "stroke", path: [L([0,150],[100,150])], weight: 0.18, colour: "#000000", dash: [3, 1.5], layer: "Hidden lines" },
  { t: "fill", path: [L([200,0],[240,0]), { k: "A", c: [240,20], r: 20, a0: -Math.PI/2, a1: Math.PI/2 }, L([240,40],[200,40]), L([200,40],[200,0]),
                      L([210,10],[220,10]), L([220,10],[220,20]), L([220,20],[210,20]), L([210,20],[210,10])], colour: "#cccccc", layer: "Fills" },
  { t: "fill", path: [L([300,0],[340,0]), { k: "A", c: [340,20], r: 20, a0: -Math.PI/2, a1: -3*Math.PI/2 }, L([340,40],[300,40]), L([300,40],[300,0])], colour: "#aaaaaa", layer: "Fills" },
  { t: "hatch", path: sq.map(s => L([s.a[0]+300, s.a[1]+100], [s.b[0]+300, s.b[1]+100])),
    pattern: { id: "BRICK", lines: [{ angle: 0, origin: [0,0], delta: [0, 2] }, { angle: 90, origin: [0,0], delta: [2, 4], dash: [2, -2] }] },
    colour: "#444444", weight: 0.13, layer: "Hatch" },
  { t: "text", at: [0, 200], text: "Kitchen {3.2 m}\nCafé", height: 3.5, rot: 15, align: "centre", colour: "#000000", layer: "Text" },
]};
const r = writeDXF(scene, { name: "ezdxf check" });
process.stdout.write(JSON.stringify(r));
"""


def generate():
    out = subprocess.run(["node", "--input-type=module", "-e", NODE], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    import json
    res = json.loads(out)
    fd, path = tempfile.mkstemp(suffix=".dxf")
    with os.fdopen(fd, "w", newline="") as f:
        f.write(res["text"])
    print("writer report:", res["report"])
    return path


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else generate()
    doc = ezdxf.readfile(path)
    print("ezdxf", ezdxf.__version__, "opened", path, "dxfversion", doc.dxfversion)
    auditor = doc.audit()
    print(f"audit: {len(auditor.errors)} errors, {len(auditor.fixes)} fixes")
    for e in auditor.errors:
        print("  ERROR", e.code, e.message)
    for f in auditor.fixes:
        print("  fix  ", f.code, f.message)
    msp = doc.modelspace()
    for e in msp:
        extra = ""
        if e.dxftype() == "ARC":
            extra = f" start={e.dxf.start_angle:.3f} end={e.dxf.end_angle:.3f}"
        if e.dxftype() == "HATCH":
            extra = f" pattern={e.dxf.pattern_name} loops={len(e.paths)}"
        if e.dxftype() == "MTEXT":
            extra = f" text={e.plain_text()!r}"
        print(f"  {e.dxftype():<11} layer={e.dxf.layer:<13} lineweight={e.dxf.get('lineweight')} true_color={e.dxf.get('true_color')} linetype={e.dxf.get('linetype')}{extra}")
    sq = [e for e in msp if e.dxf.layer == "SQUARE"]
    ok = True
    if len(sq) != 1 or sq[0].dxf.lineweight != 100:
        print("FAIL: square lineweight is", [e.dxf.lineweight for e in sq]); ok = False
    if doc.header.get("$INSUNITS") != 4 or doc.header.get("$LWDISPLAY") != 1:
        print("FAIL: header", doc.header.get("$INSUNITS"), doc.header.get("$LWDISPLAY")); ok = False
    if auditor.has_errors:
        print("FAIL: audit reported errors"); ok = False
    # geometry via ezdxf's own bbox of the square
    from ezdxf import bbox
    ext = bbox.extents(sq)
    print("square extents via ezdxf:", ext.extmin, ext.extmax)
    if abs(ext.size.x - 10) > 1e-3 or abs(ext.size.y - 10) > 1e-3:
        print("FAIL: square size", ext.size); ok = False
    print("OK" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
