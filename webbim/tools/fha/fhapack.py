# fhapack.py : every set's lifted annotation and title blocks -> webbim/src/fha_pdf.js (raw DEFLATE, base64, per set)
import json, zlib, base64, glob, os
SETS = {}
for f in sorted(glob.glob("fhaset_*.json")):
    SETS[f[7:-5]] = json.load(open(f))
def slim(o):
    if isinstance(o, float): return round(o, 2)
    if isinstance(o, list): return [slim(x) for x in o]
    if isinstance(o, dict): return {k: slim(v) for k, v in o.items() if v is not None}
    return o
out = ["//! The Frank Harmon sets' annotation, lifted from their PDFs (see tools/fha): each set's title block families, each",
       "//! sheet's own title block values, and every page's notes (with their leaders), dimension strings and bubbles, in",
       "//! paper mm from the sheet's lower left. Carried deflated; read once, on first use.", "",
       'import { inflateBase64 } from "./inflate.js";', ""]
for k, v in SETS.items():
    z = base64.b64encode(zlib.compress(json.dumps(slim(v), separators=(",", ":")).encode(), 9)[2:-4]).decode()
    out.append(f'const FHA_{k.upper()}_Z = "{z}";')
out += ["const FHA_CACHE = {};", "/** One set's data: { titleBlocks: {id: family}, sheets: {page: {number, name, scale, tb}}, pages: {page: {size, notes, dims, bubbles}} }. */",
        "export function fhaPdf(set) {", "  if (!FHA_CACHE[set]) FHA_CACHE[set] = JSON.parse(inflateBase64({ " + ", ".join(f"{k}: FHA_{k.upper()}_Z" for k in SETS) + " }[set]));", "  return FHA_CACHE[set];", "}", ""]
open("/home/user/openshapefactory/webbim/src/fha_pdf.js", "w").write("\n".join(out))
print({k: len(json.dumps(v)) for k, v in SETS.items()}, os.path.getsize("/home/user/openshapefactory/webbim/src/fha_pdf.js"))
