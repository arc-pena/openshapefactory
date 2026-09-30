# pens.py page box out.png : a region of a page in sheet space, each pen class in its own colour (for reading how the set draws)
import pymupdf, sys
from PIL import Image, ImageDraw
from sheetspace import sheet_transform
d = pymupdf.open('/root/.claude/uploads/d776864e-d834-5bd2-b476-79e1bd735d59/5cbbe666-wetlap_part1.pdf')
pg = int(sys.argv[1]); box = [float(v) for v in sys.argv[2].split(',')]; s = 8
p = d[pg - 1]; f = sheet_transform(p)[0]
im = Image.new("RGB", (int((box[2] - box[0]) * s), int((box[3] - box[1]) * s)), "white"); g = ImageDraw.Draw(im)
P = lambda q: (lambda m: ((m[0] - box[0]) * s, (box[3] - m[1]) * s))(f((q.x, q.y)))
COL = {(0.48, 0.67): "red", (0.48, 0.0): "blue", (0.6, 0.0): "green", (0.96, 0.0): "magenta", (0.24, 0.0): "black", (0.96, 0.67): "orange"}
for dr in p.get_drawings():
    w = round(dr.get('width') or 0, 2); c = round((dr.get('color') or (1,))[0], 2)
    if dr['type'] == 'f':
        fc = dr.get('fill') or (1, 1, 1)
        if fc[0] < 0.9:
            for it in dr['items']:
                if it[0] == 're': r = it[1]; g.polygon([P(r.tl), P(r.tr), P(r.br), P(r.bl)], fill="#88f")
            pts = [P(it[1]) for it in dr['items'] if it[0] == 'l']
            if len(pts) > 2: g.polygon(pts, fill="#88f")
        continue
    col = COL.get((w, c), "#ccc")
    for it in dr['items']:
        if it[0] == 'l': g.line([P(it[1]), P(it[2])], fill=col, width=2 if col != "#ccc" else 1)
        elif it[0] == 're': r = it[1]; g.polygon([P(r.tl), P(r.tr), P(r.br), P(r.bl)], outline=col)
        elif it[0] == 'c': g.line([P(it[1]), P(it[4])], fill=col)
im.save(sys.argv[3])
