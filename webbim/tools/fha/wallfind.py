# wallfind.py <pdf> <page> <box> <origin> <scale> [minw] : wall candidates from pairs of heavy parallel lines (model feet)
# prints: axis-aligned walls as  H y=<centre> t=<thick"> x=[a,b]  /  V x=<centre> t=<thick"> y=[a,b]  (+ "C" where grey poché fills it)
import pymupdf, sys, math
pdf, pg, box, org, sc = sys.argv[1], int(sys.argv[2]), [float(v) for v in sys.argv[3].split(",")], [float(v) for v in sys.argv[4].split(",")], float(sys.argv[5])
minw = float(sys.argv[6]) if len(sys.argv) > 6 else 0.5
K = 25.4 / 72; p = pymupdf.open(pdf)[pg - 1]; H = p.rect.height; F = lambda mm: mm * sc / 304.8
M = lambda q: (F(q[0] * K - org[0]), F((H - q[1]) * K - org[1]))
inb = lambda q: box[0] <= q[0] * K <= box[2] and box[1] <= (H - q[1]) * K <= box[3]
hs, vs, grey = [], [], []
for dr in p.get_drawings():
    w = dr.get("width") or 0
    if dr["type"] in ("f", "fs") and dr.get("fill") and dr["fill"][0] < 0.95:
        pts = [M((it[1].x, it[1].y)) for it in dr["items"] if it[0] == "l"]
        if pts: grey.append(pts)
    if w < minw: continue
    for it in dr["items"]:
        if it[0] != "l" or not inb((it[1].x, it[1].y)) or not inb((it[2].x, it[2].y)): continue
        a, b = M((it[1].x, it[1].y)), M((it[2].x, it[2].y))
        if abs(a[1] - b[1]) < 0.02 and abs(a[0] - b[0]) > 0.2: hs.append((a[1], min(a[0], b[0]), max(a[0], b[0])))
        elif abs(a[0] - b[0]) < 0.02 and abs(a[1] - b[1]) > 0.2: vs.append((a[0], min(a[1], b[1]), max(a[1], b[1])))
def pip(q, poly):
    c = False
    for i in range(len(poly)):
        a, b = poly[i], poly[i - 1]
        if (a[1] > q[1]) != (b[1] > q[1]) and q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]: c = not c
    return c
def pairs(L, tag):
    out = []
    L = sorted(L)
    for i, (c1, a1, b1) in enumerate(L):
        for c2, a2, b2 in L[i + 1:]:
            t = c2 - c1
            if t < 0.2: continue
            if t > 1.6: break
            lo, hi = max(a1, a2), min(b1, b2)
            if hi - lo > 0.6: out.append((round((c1 + c2) / 2, 2), round(t * 12, 1), round(lo, 2), round(hi, 2)))
    # keep the thinnest pair for each stretch
    out.sort(key=lambda w: (w[0], w[2]))
    res = []
    for w in out:
        if any(abs(w[0] - r[0]) < 0.6 and w[2] < r[3] - 0.3 and w[3] > r[2] + 0.3 and r[1] <= w[1] for r in res): continue
        res = [r for r in res if not (abs(w[0] - r[0]) < 0.6 and w[2] < r[3] - 0.3 and w[3] > r[2] + 0.3 and r[1] > w[1])] + [w]
    for c, t, lo, hi in sorted(res):
        mid = ((lo + hi) / 2, c) if tag == "H" else (c, (lo + hi) / 2)
        g = "C" if any(pip(mid, r) for r in grey) else " "
        print(f"{tag} {'y' if tag == 'H' else 'x'}={c:7.2f} t={t:5.1f}\" {g} {'x' if tag == 'H' else 'y'}=[{lo:7.2f},{hi:7.2f}]")
pairs(hs, "H"); pairs(vs, "V")
