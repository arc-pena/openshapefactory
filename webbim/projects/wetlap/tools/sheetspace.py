# The PDF's pages are drawn four ways (the page rotated, the sheet turned inside a portrait page, and some sheets
# shifted and cut off by the page they were printed on). Each page's own coordinates (unrotated, y down, pt) map
# to SHEET space: mm on the A1 landscape sheet (841 x 594), x right, y up, the title strip's words reading left
# to right, the strip where every sheet has it (anchored on its "FOR PRICING ONLY" line). `visible` is the part
# of the sheet the page actually shows: what lies outside it is not in the PDF.
import pymupdf
K = 25.4 / 72
ANCHOR = None   # where the anchor line sits on a whole sheet (from a page that shows it all)
def _anchor(p):
    for b in p.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            if "FOR PRICING ONLY" in "".join(s["text"] for s in l["spans"]): return l
    return None
def sheet_transform(p, anchor=(243.26, 16.03)):
    l = _anchor(p); d = l["dir"] if l else (1, 0)
    ux, uy = round(d[0]), round(d[1]); vx, vy = uy, -ux
    X = lambda q: (q[0] * ux + q[1] * uy) * K
    Y = lambda q: (q[0] * vx + q[1] * vy) * K
    if l:
        x0, y0, x1, y1 = l["bbox"]; cs = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        ox = anchor[0] - min(X(c) for c in cs); oy = anchor[1] - min(Y(c) for c in cs)
    else: ox = oy = 0
    f = lambda q: (X(q) + ox, Y(q) + oy)
    W0, H0 = p.mediabox.width, p.mediabox.height
    vs = [f(c) for c in [(0, 0), (W0, 0), (W0, H0), (0, H0)]]
    visible = [max(0, min(v[0] for v in vs)), max(0, min(v[1] for v in vs)), min(841, max(v[0] for v in vs)), min(594, max(v[1] for v in vs))]
    return f, 841.0, 594.0, [round(v, 1) for v in visible]
