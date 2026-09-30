# shl.py page x0,y0,x1,y1 [minlen] [maxw] : horizontal/vertical line positions in sheet space (clustered), with total length
import pymupdf, sys, collections
from sheetspace import sheet_transform
d = pymupdf.open('/root/.claude/uploads/d776864e-d834-5bd2-b476-79e1bd735d59/5cbbe666-wetlap_part1.pdf')
pg = int(sys.argv[1]); box = [float(v) for v in sys.argv[2].split(',')]; ml = float(sys.argv[3]) if len(sys.argv) > 3 else 1; mw = float(sys.argv[4]) if len(sys.argv) > 4 else 99
p = d[pg - 1]; T = sheet_transform(p)[0]
H = collections.defaultdict(float); V = collections.defaultdict(float); HW = {}; VW = {}
for dr in p.get_drawings():
    w = dr.get('width') or 0
    if w > mw: continue
    for it in dr['items']:
        if it[0] != 'l': continue
        a = T((it[1].x, it[1].y)); b = T((it[2].x, it[2].y))
        if not all(box[0] <= q[0] <= box[2] and box[1] <= q[1] <= box[3] for q in (a, b)): continue
        if abs(a[1] - b[1]) < 0.03 and abs(a[0] - b[0]) >= ml: k = round(a[1], 2); H[k] += abs(a[0] - b[0]); HW[k] = round(w, 2)
        elif abs(a[0] - b[0]) < 0.03 and abs(a[1] - b[1]) >= ml: k = round(a[0], 2); V[k] += abs(a[1] - b[1]); VW[k] = round(w, 2)
print('H', [(k, round(v), HW[k]) for k, v in sorted(H.items()) if v > float(sys.argv[5] if len(sys.argv) > 5 else 30)])
print('V', [(k, round(v), VW[k]) for k, v in sorted(V.items()) if v > float(sys.argv[5] if len(sys.argv) > 5 else 30)])
