# ovs.py <mine.pdf> <page> <dpi> [x0,y0,x1,y1 sheet mm] <out.png> : our sheet (red) over the source page (blue), both in
# sheet space; black where they agree. <mine.pdf> '-' saves the source crop alone. The source page is resampled from its own orientation into sheet space.
import sys, pymupdf
from PIL import Image, ImageOps, ImageChops
from sheetspace import sheet_transform
SRC = '/root/.claude/uploads/d776864e-d834-5bd2-b476-79e1bd735d59/5cbbe666-wetlap_part1.pdf'
mine, pg, dpi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
box = [float(v) for v in sys.argv[4].split(',')] if len(sys.argv) > 5 else [0, 0, 841, 594]; out = sys.argv[-1]
s = dpi / 25.4
p = pymupdf.open(SRC)[pg - 1]; f = sheet_transform(p)[0]
pm = p.get_pixmap(dpi=dpi); src = Image.frombytes("RGB", (pm.width, pm.height), pm.samples)
# sheet mm -> unrotated page pt: invert f (affine) from three points; unrotated -> displayed pixels via rotation_matrix
import numpy as np
A = np.array([[*f((0, 0)), 1], [*f((100, 0)), 1], [*f((0, 100)), 1]]); Bq = np.array([[0, 0], [100, 0], [0, 100]])
inv = np.linalg.solve(A, Bq)          # [X, Y, 1] @ inv = [px, py] (page pt)
R = p.rotation_matrix
W, H = int((box[2] - box[0]) * s), int((box[3] - box[1]) * s)
# output pixel (u, v) -> sheet (X, Y) = (box0 + u/s, box3 - v/s) -> page pt -> displayed pt -> pixel (*dpi/72)
def M(u, v):
    X, Y = box[0] + u / s, box[3] - v / s; q = np.array([X, Y, 1]) @ inv
    dq = pymupdf.Point(q[0], q[1]) * R; return dq.x * dpi / 72, dq.y * dpi / 72
o = M(0, 0); ex = M(1, 0); ey = M(0, 1)
coeffs = (ex[0] - o[0], ey[0] - o[0], o[0], ex[1] - o[1], ey[1] - o[1], o[1])
a = src.transform((W, H), Image.AFFINE, coeffs, resample=Image.BILINEAR, fillcolor="white")
if mine == "-": a.save(out); sys.exit(0)
mp = pymupdf.open(mine)[0]; k = 72 / 25.4; Hm = mp.rect.height
b = mp.get_pixmap(dpi=dpi, clip=pymupdf.Rect(box[0] * k, Hm - box[3] * k, box[2] * k, Hm - box[1] * k))
b = Image.frombytes("RGB", (b.width, b.height), b.samples).resize(a.size)
A_, B_ = ImageOps.invert(a.convert("L")), ImageOps.invert(b.convert("L"))
Image.merge("RGB", (ImageOps.invert(A_), ImageOps.invert(ImageChops.lighter(A_, B_)), ImageOps.invert(B_))).save(out)
