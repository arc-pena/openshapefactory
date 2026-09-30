# p2m.py <pdf> <page> <x0,y0,x1,y1 paper mm> <ox,oy paper mm of model origin> <scale> [minlen_ft] [--w]
# the PDF's straight lines inside a box, in model feet (x right, y up from the origin), merged per line; with weight
import pymupdf, sys, math, collections
pdf, pg, box, org, sc = sys.argv[1], int(sys.argv[2]), [float(v) for v in sys.argv[3].split(",")], [float(v) for v in sys.argv[4].split(",")], float(sys.argv[5])
minlen = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0
K = 25.4 / 72; p = pymupdf.open(pdf)[pg - 1]; H = p.rect.height
F = lambda mm: mm * sc / 304.8
segs = []
for dr in p.get_drawings():
    w = round(dr.get("width") or 0, 2)
    for it in dr["items"]:
        pts = []
        if it[0] == "l": pts = [(it[1].x, it[1].y), (it[2].x, it[2].y)]
        elif it[0] == "re": r = it[1]; pts = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)]
        for a, b in zip(pts, pts[1:]):
            A = (a[0] * K, (H - a[1]) * K); B = (b[0] * K, (H - b[1]) * K)
            if not (box[0] <= A[0] <= box[2] and box[1] <= A[1] <= box[3] and box[0] <= B[0] <= box[2] and box[1] <= B[1] <= box[3]): continue
            M = lambda q: (round(F(q[0] - org[0]), 2), round(F(q[1] - org[1]), 2))
            a2, b2 = M(A), M(B)
            if math.dist(a2, b2) >= minlen: segs.append((a2, b2, w))
H_, V_, O_ = collections.defaultdict(list), collections.defaultdict(list), []
for a, b, w in segs:
    if abs(a[1] - b[1]) < 0.03: H_[(round(a[1], 2), w)].append(tuple(sorted((a[0], b[0]))))
    elif abs(a[0] - b[0]) < 0.03: V_[(round(a[0], 2), w)].append(tuple(sorted((a[1], b[1]))))
    else: O_.append((a, b, w))
def merge(iv):
    iv = sorted(iv); out = []
    for s, e in iv:
        if out and s <= out[-1][1] + 0.05: out[-1][1] = max(out[-1][1], e)
        else: out.append([s, e])
    return out
print("HORIZONTAL (y: x-spans)  weight")
for (y, w), iv in sorted(H_.items()): print(f"  y={y:8.2f} w={w}: " + " ".join(f"[{s:.2f},{e:.2f}]" for s, e in merge(iv)))
print("VERTICAL (x: y-spans)")
for (x, w), iv in sorted(V_.items()): print(f"  x={x:8.2f} w={w}: " + " ".join(f"[{s:.2f},{e:.2f}]" for s, e in merge(iv)))
print("OTHER", len(O_))
for a, b, w in O_[:int(sys.argv[7]) if len(sys.argv) > 7 else 40]: print("  ", a, b, w)
