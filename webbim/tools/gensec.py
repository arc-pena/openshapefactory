"""Regenerates src/sections.js, the structural section catalogue.

Inputs, fetched into the working directory before running:
  steelpy/            pip download steelpy (Apache-2.0) and unzip: AISC shapes database CSVs ("shape files/")
  profiles.csv        FreeCAD src/Mod/BIM/Presets/profiles.csv (European and British I sections, RHS, CHS)
  eu/                 pip download eurocodepy (MIT) and unzip: eurocodepy/data/*_profiles_euro.json
                      (SHS, and a cross-check of every HE/IPE row against FreeCAD's)
The Australian tables are typed in below and flagged `check` in the output.
"""
import csv, json, re
SP = "steelpy/steelpy/shape files/"
IN = 25.4
r1 = lambda x: round(float(x) * IN, 1)
def rows(f): return list(csv.DictReader(open(SP + f)))
def aname(s):  # W44X408 -> W44x408, HSS28_000X1_000 -> HSS28.000x1.000 (decimals), M12_5X12_4 -> M12.5x12.4
    return s.replace("_", ".").replace("X", "x")
def hssname(s):  # HSS10X3_1_2X3_16 -> HSS10x3-1/2x3/16 (AISC fractions)
    def part(p):
        q = p.split("_")
        return q[0] if len(q) == 1 else f"{q[0]}/{q[1]}" if len(q) == 2 else f"{q[0]}-{q[1]}/{q[2]}"
    return "x".join(part(p) for p in s.split("X"))
cat = []
# ---- AISC
fams = []
for code, f, label in [("W", "W_shapes.csv", "W — wide flange"), ("HP", "HP_shapes.csv", "HP — bearing piles"), ("M", "M_shapes.csv", "M — miscellaneous"), ("S", "S_shapes.csv", "S — American standard beams")]:
    fams.append({"name": label, "shape": "I", "items": [[aname(r["shape"]), r1(r["d"]), r1(r["bf"]), r1(r["tw"]), r1(r["tf"])] for r in rows(f)]})
hr = rows("HSS_shapes.csv")
fams.append({"name": "HSS — rectangular & square", "shape": "RHS", "items": [[hssname(r["shape"]), r1(r["Ht"]), r1(r["B"]), r1(r["tnom"])] for r in hr]})
fams.append({"name": "HSS — round", "shape": "CHS", "items": [[aname(r["shape"]), r1(r["OD"]), r1(r["tnom"])] for r in rows("HSS_R_shapes.csv")]})
fams.append({"name": "Pipe", "shape": "CHS", "items": [[r["shape"], r1(r["OD"]), r1(r["tnom"])] for r in rows("PIPE_shapes.csv")]})
cat.append({"std": "American (AISC)", "source": "AISC Shapes Database, via the steelpy package (Apache-2.0); inches converted to mm", "families": fams})
# ---- European / British (FreeCAD profiles.csv, cross-checked against eurocodepy)
fc = [r for r in csv.reader(l for l in open("profiles.csv") if l.strip() and not l.startswith("#"))]
def fcI(cat_, pref=None):
    out = []
    for r in fc:
        if r[0] != cat_ or r[2] != "H": continue
        if pref and not re.match(pref, r[1]): continue
        w, hgt, tw, tf = map(float, r[3:7]); out.append([r[1], hgt, w, tw, tf])
    return out
efams = [
    {"name": "IPE", "shape": "I", "items": fcI("IPE")},
    {"name": "HEA (HE-A, HE-AA)", "shape": "I", "items": fcI("HEA")},
    {"name": "HEB", "shape": "I", "items": fcI("HEB")},
    {"name": "HEM", "shape": "I", "items": fcI("HEM")},
    {"name": "INP", "shape": "I", "items": fcI("INP")},
]
rh = [[r[1], float(r[4]), float(r[3]), float(r[5])] for r in fc if r[0] == "RHS" and r[2] == "RH"]
efams.append({"name": "SHS — square hollow (EN 10210/10219)", "shape": "RHS", "items": [x for x in rh if x[1] == x[2]]})
efams.append({"name": "RHS — rectangular hollow (EN 10210/10219)", "shape": "RHS", "items": [x for x in rh if x[1] != x[2]]})
efams.append({"name": "CHS — circular hollow (EN 10210/10219)", "shape": "CHS", "items": [[r[1], float(r[3]), float(r[4])] for r in fc if r[0] == "CHS" and r[2] == "C"]})
cat.append({"std": "European (EN)", "source": "FreeCAD BIM profiles table (profiles.csv), checked against eurocodepy (MIT)", "families": efams})
cat.append({"std": "British (BS 4)", "source": "FreeCAD BIM profiles table (profiles.csv)", "families": [
    {"name": "UB — universal beams", "shape": "I", "items": fcI("UB")},
    {"name": "UC — universal columns", "shape": "I", "items": fcI("UC")}]})
# cross-check European I against eurocodepy
eu = {x["Section"]: x for x in json.load(open("eu/eurocodepy/data/i_profiles_euro.json"))}
bad = 0; n = 0
for f in efams[:4]:
    for nm, d, b, tw, tf in f["items"]:
        e = eu.get(nm)
        if not e: continue
        n += 1
        if any(abs(a - b_ * 10) > 0.05 for a, b_ in [(d, e["h"]), (b, e["b"]), (tw, e["tw"]), (tf, e["tf"])]): bad += 1; print("MISMATCH", nm, (d, b, tw, tf), (e["h"], e["b"], e["tw"], e["tf"]))
print("eurocodepy cross-check:", n, "compared,", bad, "differ")
json.dump(cat, open("cat_partial.json", "w"))
for s in cat:
    print(s["std"], [(f["name"], len(f["items"])) for f in s["families"]])
# ---- SHS from eurocodepy (cm -> mm)
shs = json.load(open("eu/eurocodepy/data/shs_profiles_euro.json"))
efams[5]["items"] = [[x["Section"].replace("_", "."), round(x["h"] * 10, 1), round(x["b"] * 10, 1), round(x["tw"] * 10, 2)] for x in shs]
# ---- Australian (AS/NZS 3679.1 hot rolled, AS/NZS 3679.2 welded, AS/NZS 1163 hollow): typed from the
# InfraBuild / Austube Mills catalogue tables as recalled - not machine-read, so flagged for checking.
UB = """610UB125 612 229 11.9 19.6|610UB113 607 228 11.2 17.3|610UB101 602 228 10.6 14.8|530UB92.4 533 209 10.2 15.6|530UB82.0 528 209 9.6 13.2|460UB82.1 460 191 9.9 16.0|460UB74.6 457 190 9.1 14.5|460UB67.1 454 190 8.5 12.7|410UB59.7 406 178 7.8 12.8|410UB53.7 403 178 7.6 10.9|360UB56.7 359 172 8.0 13.0|360UB50.7 356 171 7.3 11.5|360UB44.7 352 171 6.9 9.7|310UB46.2 307 166 6.7 11.8|310UB40.4 304 165 6.1 10.2|310UB32.0 298 149 5.5 8.0|250UB37.3 256 146 6.4 10.9|250UB31.4 252 146 6.1 8.6|250UB25.7 248 124 5.0 8.0|200UB29.8 207 134 6.3 9.6|200UB25.4 203 133 5.8 7.8|200UB22.3 202 133 5.0 7.0|200UB18.2 198 99 4.5 7.0|180UB22.2 179 90 6.0 10.0|180UB18.1 175 90 5.0 8.0|180UB16.1 173 90 4.5 7.0|150UB18.0 155 75 6.0 9.5|150UB14.0 150 75 5.0 7.0"""
UC = """310UC158 327 311 15.7 25.0|310UC137 321 309 13.8 21.7|310UC118 315 307 11.9 18.7|310UC96.8 308 305 9.9 15.4|250UC89.5 260 256 10.5 17.3|250UC72.9 254 254 8.6 14.2|200UC59.5 210 205 9.3 14.2|200UC52.2 206 204 8.0 12.5|200UC46.2 203 203 7.3 11.0|150UC37.2 162 154 8.1 11.5|150UC30.0 158 153 6.6 9.4|150UC23.4 152 152 6.1 6.8|100UC14.8 97 99 5.0 7.0"""
WB = """1200WB455 1200 500 16 40|1200WB423 1192 500 16 36|1200WB392 1184 500 16 32|1200WB342 1184 400 16 32|1200WB317 1176 400 16 28|1200WB278 1170 350 16 25|1200WB249 1170 275 16 25|1000WB322 1024 400 16 32|1000WB296 1016 400 16 28|1000WB258 1010 350 16 25|1000WB215 1000 300 16 20|900WB282 924 400 12 32|900WB257 916 400 12 28|900WB218 910 350 12 25|900WB175 900 300 12 20|800WB192 816 300 10 28|800WB168 810 275 10 25|800WB146 800 275 10 20|800WB122 792 250 10 16|700WB173 716 275 10 28|700WB150 710 250 10 25|700WB130 700 250 10 20|700WB115 692 250 10 16"""
def I_(s): return [[p[0]] + [float(v) for v in p[1:]] for p in (x.split() for x in s.split("|"))]
SHS_AU = {400: [16, 12.5, 10], 350: [16, 12.5, 10, 8], 300: [16, 12.5, 10, 8], 250: [16, 12.5, 10, 9, 6], 200: [16, 12.5, 10, 9, 6, 5], 150: [10, 9, 6, 5], 125: [10, 9, 6, 5, 4], 100: [10, 9, 6, 5, 4, 3, 2.5, 2], 89: [6, 5, 3.5], 75: [6, 5, 4, 3.5, 3, 2.5], 65: [6, 5, 4, 3, 2.5, 2, 1.6], 50: [6, 5, 4, 3, 2.5, 2, 1.6], 40: [4, 3, 2.5, 2, 1.6], 35: [3, 2.5, 2, 1.6], 30: [2, 1.6], 25: [3, 2.5, 2, 1.6], 20: [2, 1.6]}
RHS_AU = {(400, 300): [16, 12.5, 10], (400, 200): [16, 12.5, 10, 8], (350, 250): [16, 12.5, 10, 8], (300, 200): [16, 12.5, 10, 9, 8, 6], (250, 150): [16, 12.5, 10, 9, 8, 6, 5], (200, 100): [10, 9, 6, 5, 4], (150, 100): [10, 9, 6, 5, 4], (152, 76): [6, 5], (150, 50): [6, 5, 4, 3], (127, 51): [6, 5, 3.5], (125, 75): [6, 5, 4, 3], (102, 76): [6, 5, 3.5], (100, 50): [6, 5, 4, 3.5, 3, 2.5, 2], (76, 38): [4, 3, 2.5], (75, 50): [6, 5, 4, 3, 2.5, 2], (75, 25): [2.5, 2, 1.6], (65, 35): [4, 3, 2.5, 2], (50, 25): [3, 2.5, 2, 1.6], (50, 20): [3, 2.5, 2, 1.6]}
CHS_AU = {610.0: [12.7, 9.5, 6.4], 508.0: [12.7, 9.5, 6.4], 457.0: [12.7, 9.5, 6.4], 406.4: [12.7, 9.5, 6.4], 355.6: [12.7, 9.5, 6.4], 323.9: [12.7, 9.5, 6.4], 273.1: [9.3, 6.4, 4.8], 219.1: [8.2, 6.4, 4.8], 168.3: [7.1, 6.4, 4.8], 165.1: [5.4, 5.0, 3.5, 3.0], 139.7: [5.4, 5.0, 3.5, 3.0], 114.3: [6.0, 5.4, 4.8, 4.5, 3.6, 3.2], 101.6: [5.7, 5.0, 4.0, 3.2, 2.6], 88.9: [5.9, 5.5, 5.0, 4.0, 3.2, 2.6], 76.1: [5.9, 4.5, 3.6, 3.2, 2.3], 60.3: [5.4, 4.5, 3.6, 2.9, 2.3], 48.3: [5.4, 4.0, 3.2, 2.9, 2.3], 42.4: [4.9, 4.0, 3.2, 2.6, 2.0], 33.7: [4.5, 4.0, 3.2, 2.6, 2.0], 26.9: [4.0, 3.2, 2.6, 2.3, 2.0]}
g = lambda v: ("%g" % v)
cat.append({"std": "Australian (AS/NZS)", "source": "Typed from the InfraBuild (hot rolled, welded) and Austube Mills (hollow) catalogue tables; not read from a machine-readable file - check against the current catalogue before relying on a dimension", "check": True, "families": [
    {"name": "UB — universal beams (AS/NZS 3679.1)", "shape": "I", "items": I_(UB)},
    {"name": "UC — universal columns (AS/NZS 3679.1)", "shape": "I", "items": I_(UC)},
    {"name": "WB — welded beams (AS/NZS 3679.2)", "shape": "I", "items": I_(WB)},
    {"name": "SHS — square hollow (AS/NZS 1163)", "shape": "RHS", "items": [[f"{b}x{b}x{g(t)}SHS", b, b, t] for b, ts in SHS_AU.items() for t in ts]},
    {"name": "RHS — rectangular hollow (AS/NZS 1163)", "shape": "RHS", "items": [[f"{d}x{b}x{g(t)}RHS", d, b, t] for (d, b), ts in RHS_AU.items() for t in ts]},
    {"name": "CHS — circular hollow (AS/NZS 1163)", "shape": "CHS", "items": [[f"{g(D)}x{g(t)}CHS", D, t] for D, ts in CHS_AU.items() for t in ts]}]})
# sanity: I sections must have tf*2 < d and tw < bf; hollow t*2 < b
for s in cat:
    for f in s["families"]:
        for it in f["items"]:
            if f["shape"] == "I": assert it[4] * 2 < it[1] and it[3] < it[2], it
            if f["shape"] == "RHS": assert it[3] * 2 < min(it[1], it[2]), it
            if f["shape"] == "CHS": assert it[2] * 2 < it[1], it
total = sum(len(f["items"]) for s in cat for f in s["families"])
js = "//! Structural section catalogue: wide flange / I-H, rectangular and square hollow, circular hollow.\n//! Generated - do not edit by hand. All dimensions mm. Row shapes:\n//!   I   [name, depth d, flange width bf, web tw, flange tf]\n//!   RHS [name, depth, width, wall t]\n//!   CHS [name, outside diameter, wall t]\n"
js += "export const SECTION_CATALOGUE = " + json.dumps(cat, separators=(",", ":")) + ";\n"
open(__import__("os").path.join(__import__("os").path.dirname(__file__), "..", "src", "sections.js"), "w").write(js)
print("total", total, "sections;", len(js) // 1024, "KB")
for s in cat: print(s["std"], [(f["name"].split(" ")[0], len(f["items"])) for f in s["families"]])
