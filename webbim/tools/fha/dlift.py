# dlift.py <pdf> <page> <mine.pdf> <views.json> <out.json> [--batts-only]
# A detail sheet's drafting, lifted from its PDF into the views the model draws: what the model already draws
# (cut walls, slabs, beams, the placed notes and dimensions: ink on our own render of the sheet) is left out; the
# batt insulation (the drafter's loops) becomes insulation zones, drawn by the insulation tool at their width; the
# rest (flashings, sills, blocking, plates, hatching the cut does not carry) is kept per view as 2D detail linework.
# views.json: [{id, rect: [x0,y0,x1,y1] paper mm}]. Out: {id: {batts: [[ax,ay,bx,by,w]], lines: {w: [[x0,y0,...]]}, curves: {w: [...8]}, fills: [[...]]}}
# (paper mm, lower left origin).
import pymupdf, sys, json, math
import numpy as np
from scipy import ndimage
SRC, PG, MINE, VIEWS, OUT = sys.argv[1], int(sys.argv[2]), sys.argv[3], json.load(open(sys.argv[4])), sys.argv[5]
BATTS_ONLY = "--batts-only" in sys.argv
K = 25.4 / 72; p = pymupdf.open(SRC)[PG - 1]; H = p.rect.height
P = lambda q: (q.x * K, (H - q.y) * K)
items = []   # (kind, pts, w, fill, drawing)
BATT = []    # the batt paths: many curves, their ends on the batt's middle line, their handles out to its faces
for di, dr in enumerate(p.get_drawings()):
    cs = [it for it in dr["items"] if it[0] == "c"]
    if (dr.get("width") or 0) <= 0.2 and len(cs) >= 6 and len(cs) >= 0.8 * len(dr["items"]):
        mid = cs[1:-1]   # the first and last curves lead in from a face
        ends = [P(it[1]) for it in mid] + [P(it[4]) for it in mid]; ctl = [P(it[2]) for it in mid] + [P(it[3]) for it in mid]
        xs, ys = [q[0] for q in ends], [q[1] for q in ends]
        if max(xs) - min(xs) < 0.3 and max(ys) - min(ys) > 5:
            h = 0.75 * max(abs(q[0] - xs[0]) for q in ctl); BATT.append((di, [xs[0], min(ys), xs[0], max(ys), 2 * h]))
        elif max(ys) - min(ys) < 0.3 and max(xs) - min(xs) > 5:
            h = 0.75 * max(abs(q[1] - ys[0]) for q in ctl); BATT.append((di, [min(xs), ys[0], max(xs), ys[0], 2 * h]))
    w = round(dr.get("width") or 0, 2); fill = dr["type"] in ("f", "fs") and dr.get("fill")
    if fill:
        poly = []
        for it in dr["items"]:
            if it[0] == "l": poly += [P(it[1]), P(it[2])]
            elif it[0] == "c": poly += [P(q) for q in it[1:5]]
            elif it[0] == "re": r = it[1]; poly += [P(r.tl), P(r.tr), P(r.br), P(r.bl)]
            elif it[0] == "qu": qd = it[1]; poly += [P(qd.ul), P(qd.ur), P(qd.lr), P(qd.ll)]
        if len(poly) > 2: items.append(("F", poly, 0, "#%02x%02x%02x" % tuple(int(c * 255) for c in dr["fill"][:3]), di))
    if dr["type"] == "f": continue
    for it in dr["items"]:
        if it[0] == "l": items.append(("L", [P(it[1]), P(it[2])], w, None, di))
        elif it[0] == "c": items.append(("C", [P(q) for q in it[1:5]], w, None, di))
        elif it[0] == "re":
            r = it[1]; q = [P(r.tl), P(r.tr), P(r.br), P(r.bl)]
            for i in range(4): items.append(("L", [q[i], q[(i + 1) % 4]], w, None, di))
        elif it[0] == "qu":
            qd = it[1]; q = [P(qd.ul), P(qd.ur), P(qd.lr), P(qd.ll)]
            for i in range(4): items.append(("L", [q[i], q[(i + 1) % 4]], w, None, di))
# the hatches: regions filled with the page's tiling patterns (stones, aggregate, stipple), read from the content
# stream (get_drawings does not say which pattern fills a path), each pattern's tile read from its own stream
import re, hashlib
doc = p.parent
def num_ops(stream):
    for t in re.finditer(rb"/[^\s/\[\]()<>]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z*'\"]+|\[|\]", stream): yield t.group(0)
def mul(m, n): return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]]
pats = {}   # name -> xref
pr = doc.xref_get_key(p.xref, "Resources")
rx = int(pr[1].split()[0]) if pr[0] == "xref" else p.xref
pd = doc.xref_get_key(rx, "Pattern")
for nm, x in re.findall(r"/(\w+)\s+(\d+) 0 R", pd[1] if pd[0] == "dict" else doc.xref_object(int(pd[1].split()[0]))): pats[nm] = int(x)
def tile_of(x):
    o = doc.xref_object(x); w = float(re.search(r"/XStep ([\d.]+)", o).group(1)); h = float(re.search(r"/YStep ([\d.]+)", o).group(1)); st = doc.xref_stream(x); segs = []; cur = None; start = None; stack = []
    for t in num_ops(st):
        if re.match(rb"^[-+.\d]", t): stack.append(float(t)); continue
        if t == b"m": cur = start = stack[-2:]
        elif t == b"l" and cur: nx = stack[-2:]; segs += [cur[0], cur[1], nx[0], nx[1]]; cur = nx
        elif t == b"h" and cur and start: segs += [cur[0], cur[1], start[0], start[1]]; cur = start
        stack = []
    # pattern space is flipped (its Matrix turns y down): in mm, y up within the tile
    mt = [float(v) for v in re.search(r"/Matrix \[([^\]]+)\]", o).group(1).split()]
    ORIG[x] = [round(mt[4] * K, 3), round((mt[5] - h) * K, 3)]   # the tile's lower left corner on the page, mm
    return {"w": round(w * K, 4), "h": round(h * K, 4), "segs": [round(v * K if i % 2 == 0 else (h - v) * K, 3) for i, v in enumerate(segs)]}
HATCH = []; TILES = {}; ORIG = {}
stream = b"".join(doc.xref_stream(x) for x in p.get_contents())
ctm = [1, 0, 0, 1, 0, 0]; cstack = []; stack = []; fillpat = None; path = []; cur = None; start = None
for t in num_ops(stream):
    if re.match(rb"^[-+.\d]", t): stack.append(float(t)); continue
    if t.startswith(b"/"): stack.append(t); continue
    if t == b"q": cstack.append(ctm)
    elif t == b"Q": ctm = cstack.pop() if cstack else [1, 0, 0, 1, 0, 0]
    elif t == b"cm" and len(stack) >= 6: ctm = mul([float(v) for v in stack[-6:]], ctm)
    elif t == b"scn" and stack and isinstance(stack[-1], bytes): fillpat = stack[-1][1:].decode()
    elif t in (b"sc", b"rg", b"g", b"k"): fillpat = None
    elif t == b"m": cur = start = stack[-2:]; path.append([cur])
    elif t == b"l" and path: cur = stack[-2:]; path[-1].append(cur)
    elif t == b"c" and path: cur = stack[-2:]; path[-1].append(cur)
    elif t == b"re": x, y, w, h = stack[-4:]; path.append([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
    elif t in (b"f", b"f*", b"F", b"B", b"B*", b"b", b"b*", b"S", b"s", b"n", b"W", b"W*"):
        if t not in (b"W", b"W*"):
            if fillpat and t not in (b"S", b"n") and fillpat in pats:
                x = pats[fillpat]; tl = tile_of(x); hk = hashlib.md5(json.dumps(tl).encode()).hexdigest()[:8]
                TILES[hk] = tl
                loops = [[((q[0] * ctm[0] + q[1] * ctm[2] + ctm[4]) * K, (q[0] * ctm[1] + q[1] * ctm[3] + ctm[5]) * K) for q in lp] for lp in path if len(lp) > 2]
                if loops: HATCH.append((hk, loops, ORIG[x]))
            path = []
    stack = [] if t not in (b"scn",) else []
def inside(pts, r, m=0.3): return all(r[0] - m <= x <= r[2] + m and r[1] - m <= y <= r[3] + m for x, y in pts)
def bbox(pts): xs = [q[0] for q in pts]; ys = [q[1] for q in pts]; return min(xs), min(ys), max(xs), max(ys)
# our render of the sheet, as ink
PX = 12
mp = pymupdf.open(MINE)[0].get_pixmap(dpi=int(PX * 25.4), colorspace=pymupdf.csGRAY)
ink = np.frombuffer(mp.samples, dtype=np.uint8).reshape(mp.height, mp.width) < 235
ink = ndimage.binary_dilation(ink, iterations=3)
MH = mp.height; PX = mp.width / (pymupdf.open(MINE)[0].rect.width * K)   # the raster's own pixels per mm
# the PDF's own render: a drafted line that does not show (a hatch run on under its clip, a line under a mask) is not lifted
sp = p.get_pixmap(dpi=int(round(PX * 25.4)), colorspace=pymupdf.csGRAY); SPX = sp.width / (p.rect.width * K)
seen = ndimage.binary_dilation(np.frombuffer(sp.samples, dtype=np.uint8).reshape(sp.height, sp.width) < 235, iterations=1)
def samples(pts, kind):
    if kind == "C":
        a, b, c, d = pts; return [tuple((1 - t) ** 3 * a[i] + 3 * (1 - t) ** 2 * t * b[i] + 3 * (1 - t) * t * t * c[i] + t ** 3 * d[i] for i in (0, 1)) for t in np.linspace(0, 1, 9)]
    n = max(2, int(math.dist(*pts) / 0.25) + 1); return [(pts[0][0] + (pts[1][0] - pts[0][0]) * t, pts[0][1] + (pts[1][1] - pts[0][1]) * t) for t in np.linspace(0, 1, n)]
def shows(pts, kind):
    ss = samples(pts, kind); hit = 0
    for x, y in ss:
        i, j = int(round(sp.height - y * SPX)), int(round(x * SPX))
        if 0 <= i < seen.shape[0] and 0 <= j < seen.shape[1] and seen[i, j]: hit += 1
    return hit >= 0.6 * len(ss)
def covered(pts, kind):
    if kind == "C":
        a, b, c, d = pts; ss = [tuple((1 - t) ** 3 * a[i] + 3 * (1 - t) ** 2 * t * b[i] + 3 * (1 - t) * t * t * c[i] + t ** 3 * d[i] for i in (0, 1)) for t in np.linspace(0, 1, 9)]
    else:
        n = max(2, int(math.dist(*pts) / 0.25) + 1); ss = [(pts[0][0] + (pts[1][0] - pts[0][0]) * t, pts[0][1] + (pts[1][1] - pts[0][1]) * t) for t in np.linspace(0, 1, n)]
    hit = 0
    for x, y in ss:
        i, j = int(round(MH - y * PX)), int(round(x * PX))
        if 0 <= i < ink.shape[0] and 0 <= j < ink.shape[1] and ink[i, j]: hit += 1
    return hit >= 0.8 * len(ss)
out = {}
for v in VIEWS:
    r = v["rect"]; mine = [it for it in items if inside(it[1], r)]
    bset = {di for di, z in BATT if inside([(z[0], z[1]), (z[2], z[3])], r)}
    batts = [[round(v, 2) for v in z] for di, z in BATT if di in bset]
    inzone = {id(it) for it in mine if it[4] in bset}
    res = {"batts": batts, "lines": {}, "curves": {}, "fills": [], "hatches": []}
    hb = []
    for hk, loops, org in HATCH:
        pts = [q for lp in loops for q in lp]
        hb0 = bbox(pts)
        if hb0[2] < r[0] or hb0[0] > r[2] or hb0[3] < r[1] or hb0[1] > r[3] or not inside([((hb0[0] + hb0[2]) / 2, (hb0[1] + hb0[3]) / 2)], r, 0): continue   # its middle in the view (the crop trims the rest)
        res["hatches"].append([hk, org] + [[round(c, 2) for q in lp for c in q] for lp in loops]); hb.append(bbox(pts))
    if not BATTS_ONLY:
        zones = [(min(b[0], b[2]) - (b[4] / 2 if b[0] == b[2] else 0), min(b[1], b[3]) - (b[4] / 2 if b[1] == b[3] else 0), max(b[0], b[2]) + (b[4] / 2 if b[0] == b[2] else 0), max(b[1], b[3]) + (b[4] / 2 if b[1] == b[3] else 0)) for b in batts]
        for it in mine:
            kind, pts, w, fill, _ = it
            if id(it) in inzone: continue
            bb = bbox(pts)
            if any(z[0] - 0.2 <= bb[0] and bb[2] <= z[2] + 0.2 and z[1] - 0.2 <= bb[1] and bb[3] <= z[3] + 0.2 for z in zones) and max(bb[2] - bb[0], bb[3] - bb[1]) < 4: continue
            if kind == "F" and any(abs(bb[0] - h[0]) < 0.3 and abs(bb[1] - h[1]) < 0.3 and abs(bb[2] - h[2]) < 0.3 and abs(bb[3] - h[3]) < 0.3 for h in hb): continue
            if kind == "F":
                if (bb[2] - bb[0]) * (bb[3] - bb[1]) > 0.01 and not covered([(bb[0], bb[1]), (bb[2], bb[3])], "L"): res["fills"].append([round(c, 2) for q in pts for c in q] + [fill])
                continue
            if kind == "L" and math.dist(*pts) < 0.05: continue
            if covered(pts, kind) or not shows(pts, kind): continue
            key = str(round(w * 0.3528, 3))
            if kind == "L": res["lines"].setdefault(key, []).append([round(c, 2) for q in pts for c in q])
            else: res["curves"].setdefault(key, []).append([round(c, 2) for q in pts for c in q])
        # chain touching segments into polylines (smaller, and drawn as one)
        for key, segs in res["lines"].items():
            ends = {}
            for i, s in enumerate(segs): ends.setdefault((s[0], s[1]), []).append(i)
            used = set(); polys = []
            for i, s in enumerate(segs):
                if i in used: continue
                used.add(i); pl = list(s)
                while True:
                    nx = next((j for j in ends.get((pl[-2], pl[-1]), []) if j not in used), None)
                    if nx is None: break
                    used.add(nx); pl += segs[nx][2:]
                polys.append(pl)
            res["lines"][key] = polys
    out[v["id"]] = res
    print(v["id"], "batts", len(batts), "lines", sum(len(x) for x in res["lines"].values()), "pts", sum(len(p) for x in res["lines"].values() for p in x) // 2, "curves", sum(len(x) for x in res["curves"].values()), "fills", len(res["fills"]), "hatches", len(res["hatches"]))
out["__tiles"] = {k: v for k, v in TILES.items() if any(h[0] == k for r in out.values() for h in r.get("hatches", []))}
json.dump(out, open(OUT, "w"), separators=(",", ":"))
