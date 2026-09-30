# rast.py <pages> <out_dir> [px_per_mm] : each page's raster layer (the tiles Revit exports shaded or hatched regions as),
# composited in sheet space into one image per page, with its sheet rectangle: <out_dir>/r<page>.jpg + r.json.
# Tiles that are blank (all white) are left out; the image is cut to the tiles' extent.
import sys, json, math, pymupdf
from PIL import Image
from sheetspace import sheet_transform
SRC = '/root/.claude/uploads/d776864e-d834-5bd2-b476-79e1bd735d59/5cbbe666-wetlap_part1.pdf'
d = pymupdf.open(SRC); out = sys.argv[2]; S = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
pages = []
for part in sys.argv[1].split(','):
    if '-' in part: a, b = part.split('-'); pages += list(range(int(a), int(b) + 1))
    else: pages.append(int(part))
meta = {}
try: meta = json.load(open(f'{out}/r.json'))
except Exception: pass
for pg in pages:
    p = d[pg - 1]; f = sheet_transform(p)[0]; tiles = []
    for info in p.get_image_info(xrefs=True):
        if not info['xref']: continue
        bb = info['bbox']; tr = info['transform']
        # the tile's corners in sheet mm (its unit square through its transform, in unrotated page space)
        m = pymupdf.Matrix(tr); cs = [f((q.x, q.y)) for q in (pymupdf.Point(0, 0) * m, pymupdf.Point(1, 0) * m, pymupdf.Point(0, 1) * m, pymupdf.Point(1, 1) * m)]
        pix = pymupdf.Pixmap(d, info['xref'])
        if pix.n - pix.alpha > 3 or pix.colorspace is None or pix.colorspace.n != 3: pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        if pix.alpha: pix = pymupdf.Pixmap(pix, 0)
        im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        if im.convert('L').getextrema()[0] > 250: continue
        tiles.append((cs, im))
    if not tiles: print(pg, 'no raster'); continue
    xs = [c[0] for t in tiles for c in t[0]]; ys = [c[1] for t in tiles for c in t[0]]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    W, H = int((x1 - x0) * S), int((y1 - y0) * S); can = Image.new('RGB', (W, H), 'white')
    for cs, im in tiles:
        # image (u, v) in [0,1]^2 -> sheet: c00 + u (c10 - c00) + v (c01 - c00); canvas pixel from sheet
        (a, b), (c, e), (g, h) = cs[0], cs[1], cs[2]
        P = lambda X, Y: ((X - x0) * S, (y1 - Y) * S)
        o, pu, pv = P(a, b), P(c, e), P(g, h)
        # the affine from canvas pixel to image pixel: invert [pu-o, pv-o] scaled by the image size
        ux, uy = (pu[0] - o[0]) / im.width, (pu[1] - o[1]) / im.width; vx, vy = (pv[0] - o[0]) / im.height, (pv[1] - o[1]) / im.height
        det = ux * vy - uy * vx
        ia, ib, ic, id_ = vy / det, -vx / det, -uy / det, ux / det
        tx0, ty0 = min(o[0], pu[0], pv[0], pu[0] + pv[0] - o[0]), min(o[1], pu[1], pv[1], pu[1] + pv[1] - o[1])
        tx1, ty1 = max(o[0], pu[0], pv[0], pu[0] + pv[0] - o[0]), max(o[1], pu[1], pv[1], pu[1] + pv[1] - o[1])
        bx0, by0, bx1, by1 = int(math.floor(tx0)), int(math.floor(ty0)), int(math.ceil(tx1)), int(math.ceil(ty1))
        coeffs = (ia, ib, -(ia * (o[0] - bx0) + ib * (o[1] - by0)), ic, id_, -(ic * (o[0] - bx0) + id_ * (o[1] - by0)))
        patch = im.transform((bx1 - bx0, by1 - by0), Image.AFFINE, coeffs, resample=Image.BILINEAR, fillcolor=(255, 255, 255))
        mask = Image.new('L', im.size, 255).transform((bx1 - bx0, by1 - by0), Image.AFFINE, coeffs, fillcolor=0)
        can.paste(patch, (bx0, by0), mask)
    can.save(f'{out}/r{pg:02d}.jpg', quality=80, optimize=True)
    meta[str(pg)] = {'rect': [round(x0, 3), round(y0, 3), round(x1 - x0, 3), round(y1 - y0, 3)], 'w': W, 'h': H}
    print(pg, len(tiles), 'tiles', meta[str(pg)])
json.dump(meta, open(f'{out}/r.json', 'w'))
