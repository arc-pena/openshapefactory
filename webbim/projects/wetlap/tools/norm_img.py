# norm_img.py page out.png [scale px/mm] : a page's drawing in sheet space (for checking the normalisation)
import pymupdf, sys
from PIL import Image, ImageDraw
from sheetspace import sheet_transform
d = pymupdf.open('/root/.claude/uploads/d776864e-d834-5bd2-b476-79e1bd735d59/5cbbe666-wetlap_part1.pdf')
pg = int(sys.argv[1]); s = float(sys.argv[3]) if len(sys.argv) > 3 else 1.5
p = d[pg - 1]; f, W, H = sheet_transform(p)
im = Image.new("RGB", (int(W * s), int(H * s)), "white"); g = ImageDraw.Draw(im)
P = lambda q: (lambda m: (m[0] * s, (H - m[1]) * s))(f((q.x, q.y)))
for dr in p.get_drawings():
    for it in dr["items"]:
        if it[0] == "l": g.line([P(it[1]), P(it[2])], fill="black")
        elif it[0] == "re": r = it[1]; g.polygon([P(r.tl), P(r.tr), P(r.br), P(r.bl)], outline="black")
        elif it[0] == "c": g.line([P(it[1]), P(it[4])], fill="black")
for b in p.get_text("dict")["blocks"]:
    for l in b.get("lines", []):
        x0, y0, x1, y1 = l["bbox"]; a = P(pymupdf.Point(x0, y0)); c = P(pymupdf.Point(x1, y1)); g.rectangle([min(a[0], c[0]), min(a[1], c[1]), max(a[0], c[0]), max(a[1], c[1])], outline="red")
im.save(sys.argv[2])
