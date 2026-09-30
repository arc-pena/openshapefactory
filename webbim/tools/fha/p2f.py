# p2f.py <pdf> <page> <box> <origin> <scale> : filled regions (poché) inside a box, as polygons in model feet, with colour
import pymupdf, sys
pdf, pg, box, org, sc = sys.argv[1], int(sys.argv[2]), [float(v) for v in sys.argv[3].split(",")], [float(v) for v in sys.argv[4].split(",")], float(sys.argv[5])
K = 25.4 / 72; p = pymupdf.open(pdf)[pg - 1]; H = p.rect.height; F = lambda mm: mm * sc / 304.8
for dr in p.get_drawings():
    if dr["type"] not in ("f", "fs") or not dr.get("fill"): continue
    r = dr["rect"]; x0, y0, x1, y1 = r.x0 * K, (H - r.y1) * K, r.x1 * K, (H - r.y0) * K
    if not (box[0] <= x0 and x1 <= box[2] and box[1] <= y0 and y1 <= box[3]): continue
    if (x1 - x0) * (y1 - y0) < 1: continue
    pts = []
    for it in dr["items"]:
        for q in ([it[1], it[2]] if it[0] == "l" else [it[1].tl, it[1].tr, it[1].br, it[1].bl] if it[0] == "re" else [it[1], it[-1]]):
            m = (round(F(q.x * K - org[0]), 2), round(F((H - q.y) * K - org[1]), 2))
            if not pts or pts[-1] != m: pts.append(m)
    print([round(c, 2) for c in dr["fill"]], len(pts), pts[:40])
