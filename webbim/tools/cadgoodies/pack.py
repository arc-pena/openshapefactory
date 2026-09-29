import json, zlib, base64, struct
L = json.load(open("lib.json"))
def zz(v): return (v << 1) ^ (v >> 63)
def varint(n, out):
    while True:
        b = n & 0x7f; n >>= 7
        if n: out.append(b | 0x80)
        else: out.append(b); return
geo = bytearray(); idx = []
for s in sorted(L, key=lambda s: (s["cat"], s["name"])):
    view = "Elevation" if s["cat"] in ("Planting", "People") and "elevation" in s["view"].lower() else s["view"]
    name = s["name"].replace(s["view"].lower(), view.lower()) if view != s["view"] else s["name"]
    idx.append({"n": name, "c": s["cat"], "v": view, "b": s["block"], "w": s["w"], "h": s["h"], "x": s["x0"], "y": s["y0"], "o": len(geo)})
    pls = [(p, 0) for p in s["p"]] + [(p, 1) for p in s["fill"]]
    varint(len(pls), geo)
    for p, fl in pls:
        varint(len(p) * 2 + fl, geo); px = py = 0
        for x, y in p: varint(zz(x - px), geo); varint(zz(y - py), geo); px, py = x, y
hj = json.dumps(idx, separators=(",", ":")).encode()
raw = struct.pack("<I", len(hj)) + hj + bytes(geo)
co = zlib.compressobj(9, zlib.DEFLATED, -15); z = co.compress(raw) + co.flush()
b64 = base64.b64encode(z).decode()
open("../../src/cadlib_data.js", "w").write("//! The CAD goodies symbol library (generated from cad_goodies.dxf by tools/cadgoodies): an index and every block's\n//! polylines in mm, varint-coded, raw DEFLATE, base64. Decoded by cadlib.js on first use.\nexport const CADLIB_Z = \"" + b64 + "\";\n")
print(len(hj), len(geo), len(raw), len(z), len(b64))
