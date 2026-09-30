# wlift.py <pages> <out.json> : each plan page's walls, columns and residue linework, in sheet space.
#
# How the Techne set (Revit, 1:100) draws a plan, read off its pens:
#   0.48pt black       cut lines of concrete / masonry walls (both faces)
#   0.48pt grey 0.67   cut lines of partitions (both faces)
#   0.60pt black       columns' outlines
#   fill black         existing brick and columns (solid poche)
#   0.24pt (greys)     everything seen below the cut: joinery, fixtures, floor finishes, doors' swings
# A wall is two cut lines, parallel, 50-400 mm apart (0.5-4 mm at 1:100), overlapping along their length: its
# centreline is the middle of the overlap, its thickness the gap. Poche rectangles are columns (squarish) or runs
# of masonry (long). What the model now draws (the walls' faces, the columns) leaves the residue; so do the grids,
# the dimension strings and the bubbles, which the model and the annotation draw. The rest is kept as it is drawn:
# per pen (weight in mm, grey), as polylines in sheet mm (x100, delta-coded), for the view's drafted layer.
import json, math, sys, pymupdf
from sheetspace import sheet_transform
SRC = '/root/.claude/uploads/d776864e-d834-5bd2-b476-79e1bd735d59/5cbbe666-wetlap_part1.pdf'
K = 25.4 / 72
SET = json.load(open('../data/wetlap_set.json'))
GX = [0, 7664, 11460, 15867, 18073, 22137, 25400, 28478, 31740, 35453, 39210, 42438, 45496, 50928, 56415, 61902, 67389, 72876, 79072]
GY = [0, 2402, 5265, 10451, 12575, 20851, 24045, -1034, 516, 8872, 10260]
# the plan's placement on each page: the sheet point of the model's origin (grid 1 x grid A), at 1:100
ORIGIN = {}
for pg in list(range(8, 14)) + list(range(26, 31)): ORIGIN[pg] = (152.86, 170.0)
ORIGIN.update({7: (140.06, 290.0), 22: (140.06, 290.0), 20: (151.51, 187.45), 21: (151.51, 187.45), 23: (151.46, 187.45), 24: (151.46, 187.45), 25: (139.66, 290.15)})
for pg in (15, 16, 17, 18, 19, 32, 33, 34, 35): ORIGIN[pg] = (-209.08, 236.29)
ORIGIN.update({14: (-162.83, 251.88), 31: (-162.95, 251.81)})
VIEW = [4, 50, 837, 590]
DATUMS = {4}                        # pages whose grids the model draws, though their walls are not modelled            # the drawing's area on the sheet (the title strip below)

def lift(pg):
    p = pymupdf.open(SRC)[pg - 1]; f = sheet_transform(p)[0]; O = ORIGIN.get(pg); model = O is not None; O = O or (0, 0)
    M = lambda q: ((q[0] - O[0]) * 100, (q[1] - O[1]) * 100)
    P = SET['pages'][str(pg)]
    segs = []        # (a, b, w, grey, kind)
    fills = []
    for dr in p.get_drawings():
        w = round((dr.get('width') or 0) * K, 3); col = dr.get('color'); gcol = round(col[0], 2) if col else 0
        hexc = '#%02x%02x%02x' % tuple(round(c * 255) for c in col[:3]) if col and len(col) >= 3 else '#000000'
        if dr['type'] == 'f' or (dr['type'] == 'fs' and dr.get('fill')):
            fc = dr.get('fill') or (1, 1, 1)
            pts = []
            for it in dr['items']:
                if it[0] == 'l': pts += [f((it[1].x, it[1].y)), f((it[2].x, it[2].y))]
                elif it[0] == 're': r = it[1]; pts += [f((r.x0, r.y0)), f((r.x1, r.y0)), f((r.x1, r.y1)), f((r.x0, r.y1))]
                elif it[0] == 'qu': q = it[1]; pts += [f((q.ul.x, q.ul.y)), f((q.ur.x, q.ur.y)), f((q.lr.x, q.lr.y)), f((q.ll.x, q.ll.y))]
                elif it[0] == 'c': pts += [f((it[1].x, it[1].y)), f((it[4].x, it[4].y))]
            dd = []
            for q in pts:
                if not dd or abs(dd[-1][0] - q[0]) > 1e-3 or abs(dd[-1][1] - q[1]) > 1e-3: dd.append(q)
            if len(dd) > 2: fills.append((dd, round(fc[0], 2), '#%02x%02x%02x' % tuple(round(c * 255) for c in fc[:3]) if len(fc) >= 3 else '#000000'))
            if dr['type'] == 'f': continue
        for it in dr['items']:
            if it[0] == 'l': segs.append([f((it[1].x, it[1].y)), f((it[2].x, it[2].y)), w, gcol, 'l', None, None, hexc])
            elif it[0] == 're':
                r = it[1]; c = [f((r.x0, r.y0)), f((r.x1, r.y0)), f((r.x1, r.y1)), f((r.x0, r.y1))]
                for i in range(4): segs.append([c[i], c[(i + 1) % 4], w, gcol, 'l', None, None, hexc])
            elif it[0] == 'c': segs.append([f((it[1].x, it[1].y)), f((it[4].x, it[4].y)), w, gcol, 'c', f((it[2].x, it[2].y)), f((it[3].x, it[3].y)), hexc])
    inside = lambda q: VIEW[0] <= q[0] <= VIEW[2] and VIEW[1] <= q[1] <= VIEW[3]
    segs = [s for s in segs if inside(s[0]) and inside(s[1])]
    fills = [x for x in fills if all(inside(q) for q in x[0])]
    used = [False] * len(segs)
    # ------------------------------------------------------------ walls: pairs of cut lines
    cut = [] if not model else [i for i, s in enumerate(segs) if s[4] == 'l' and abs(s[2] - 0.169) < 0.01 and s[3] in (0.0, 0.67) and math.dist(s[0], s[1]) > 0.3]
    info = {}
    for i in cut:
        a, b = segs[i][0], segs[i][1]; L = math.dist(a, b); d = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        if d[0] < -1e-9 or (abs(d[0]) < 1e-9 and d[1] < 0): d = (-d[0], -d[1]); a, b = b, a
        n = (-d[1], d[0]); info[i] = (a, b, d, n, a[0] * n[0] + a[1] * n[1], a[0] * d[0] + a[1] * d[1], b[0] * d[0] + b[1] * d[1])
    walls = []
    byang = {}
    for i in cut: ang = round(math.degrees(math.atan2(info[i][2][1], info[i][2][0])) % 180, 0) % 180; byang.setdefault(ang, []).append(i)
    for ang, ids in byang.items():
        ids.sort(key=lambda i: info[i][4])
        for x, i in enumerate(ids):
            a, b, d, n, c, s0, s1 = info[i]; best = None
            for j in ids[x + 1:]:
                a2, b2, d2, n2, c2, t0, t1 = info[j]
                gap = c2 - c
                if gap < 0.45: continue
                if gap > 4.05: break
                if abs(d[0] * d2[1] - d[1] * d2[0]) > 0.01 or segs[i][3] != segs[j][3]: continue
                lo, hi = max(s0, t0), min(s1, t1)
                if hi - lo < 0.5: continue
                # nothing of the same pen between them (then it is not one wall)
                if best is None or gap < best[0] - 1e-6: best = (gap, j, lo, hi)
            if best:
                gap, j, lo, hi = best; cc = c + gap / 2
                A = (d[0] * lo + n[0] * cc, d[1] * lo + n[1] * cc); B = (d[0] * hi + n[0] * cc, d[1] * hi + n[1] * cc)
                walls.append({'a': A, 'b': B, 't': gap, 'cls': 'C' if segs[i][3] == 0 else 'P', 'ends': (hi - lo) / max(1e-9, (s1 - s0)), 'i': i, 'j': best[1]})
    # one wall drawn with more than two lines (a lining, a finish) pairs twice over: of walls lying on each other
    # (parallel, their bands overlapping, along most of the shorter) the thicker is kept
    def band(w):
        a, b = w['a'], w['b']; L = math.dist(a, b); d = ((b[0] - a[0]) / L, (b[1] - a[1]) / L); n = (-d[1], d[0])
        c = a[0] * n[0] + a[1] * n[1]; s0 = a[0] * d[0] + a[1] * d[1]; return d, c - w['t'] / 2, c + w['t'] / 2, s0, s0 + L
    walls.sort(key=lambda w: -w['t'])
    out_w = []
    for w in walls:
        d, c0, c1, s0, s1 = band(w); dup = False
        for k in out_w:
            e, k0, k1, t0, t1 = band(k)
            if abs(d[0] * e[1] - d[1] * e[0]) > 0.01 or d[0] * e[0] + d[1] * e[1] < 0: continue
            if min(c1, k1) - max(c0, k0) > 0.05 and min(s1, t1) - max(s0, t0) > 0.5 * min(s1 - s0, t1 - t0): dup = True; break
        if not dup: out_w.append(w)
    # ------------------------------------------------------------ columns and masonry: black poche
    # squarish poche is a column; a long run of it is existing masonry (a wall along its length); thin strips (screens,
    # flashings) and shapes that are not rectangles stay drawn. White shapes over masonry are its openings.
    cols, brick, holes = [], [], []
    rect = lambda pts: len(pts) in (4, 5) and all(abs(pts[i][0] - pts[(i + 1) % 4][0]) < 0.02 or abs(pts[i][1] - pts[(i + 1) % 4][1]) < 0.02 for i in range(4))
    bbox = lambda pts: (min(q[0] for q in pts), min(q[1] for q in pts), max(q[0] for q in pts), max(q[1] for q in pts))
    # the PDF clips its poche (one black rectangle, cut back to the piers by a clipping path the vectors do not
    # carry): what is really black is read off the page's raster, along each rectangle's length
    pm = p.get_pixmap(dpi=254, colorspace=pymupdf.csGRAY); PX = pm.width / p.rect.width
    import numpy as np
    A3 = np.array([[*f((0, 0)), 1], [*f((100, 0)), 1], [*f((0, 100)), 1]]); inv = np.linalg.solve(A3, np.array([[0, 0], [100, 0], [0, 100]]))
    RM = p.rotation_matrix
    # sheet mm -> pixel, one affine: composed once
    def _px(q): u = np.array([q[0], q[1], 1]) @ inv; dq = pymupdf.Point(float(u[0]), float(u[1])) * RM; return dq.x * PX, dq.y * PX
    o_, ex_, ey_ = _px((0, 0)), _px((1, 0)), _px((0, 1)); SAM = pm.samples; ST = pm.stride; PW, PH = pm.width, pm.height
    def dark(q):
        x = int(o_[0] + (ex_[0] - o_[0]) * q[0] + (ey_[0] - o_[0]) * q[1]); y = int(o_[1] + (ex_[1] - o_[1]) * q[0] + (ey_[1] - o_[1]) * q[1])
        return 0 <= x < PW and 0 <= y < PH and SAM[y * ST + x] < 90
    def runs(x0, y0, x1, y1):
        horiz = x1 - x0 >= y1 - y0; n = int(((x1 - x0) if horiz else (y1 - y0)) / 0.1); out = []; cur = None
        for i in range(n + 1):
            t = i / max(n, 1)
            qs = [(x0 + (x1 - x0) * t, y0 + (y1 - y0) * k) for k in (0.25, 0.5, 0.75)] if horiz else [(x0 + (x1 - x0) * k, y0 + (y1 - y0) * t) for k in (0.25, 0.5, 0.75)]
            q = qs[1]
            if all(dark(z) for z in qs): cur = [q, q] if cur is None else [cur[0], q]
            elif cur: out.append(cur); cur = None
        if cur: out.append(cur)
        return [(r[0][0], y0, r[1][0], y1) if horiz else (x0, r[0][1], x1, r[1][1]) for r in out if math.dist(r[0], r[1]) > 0.3], horiz
    keep = []
    for pts, g, hc in fills:
        if hc != '#000000' or not rect(pts) or not model: keep.append((pts, g, hc)); continue
        x0, y0, x1, y1 = bbox(pts); w, h = (x1 - x0) * 100, (y1 - y0) * 100
        if min(w, h) < 80: keep.append((pts, g, hc)); continue
        rs, horiz = runs(x0, y0, x1, y1)
        if len(rs) != 1 or math.dist(rs[0][:2], rs[0][2:]) < 0.97 * math.dist((x0, y0), (x1, y1)): pass
        else: rs = [(x0, y0, x1, y1)]
        for (u0, v0, u1, v1) in rs:
            a, b = M((u0, v0)), M((u1, v1)); w, h = b[0] - a[0], b[1] - a[1]
            if min(w, h) < 80: continue
            if max(w, h) / min(w, h) < 2.6: cols.append([round(a[0]), round(a[1]), round(b[0]), round(b[1])])
            else: brick.append([round(a[0]), round(a[1]), round(b[0]), round(b[1])])
    fills = [x for x in keep if x[2] != '#ffffff']
    # the columns' outlines (0.60 black) are the model's now
    for i, s in enumerate(segs):
        if model and abs(s[2] - 0.212) < 0.01 and s[3] == 0: used[i] = True
    # ------------------------------------------------------------ what the annotation draws
    gxs = [O[0] + g / 100 for g in GX] if model else []; gys = [O[1] + g / 100 for g in GY] if model else []
    # the page's own grid heads (a letter or a number or two in a circle) say where the model's grids will be
    # drawn on a plan; a sheet of drafting (elevations drawn on their image) keeps its datums as drawn
    if model or pg in DATUMS:
        for bb in P['bubbles']:
            if len(bb['t'].strip()) <= 2:
                cx, cy, r = bb['circle']
                if bb['t'].strip().isdigit(): gxs.append(cx)
                else: gys.append(cy)
    gext = {}
    for i, s in enumerate(segs):
        if used[i] or s[4] != 'l': continue
        a, b = s[0], s[1]
        if abs(a[0] - b[0]) < 0.02 and s[3] > 0:
            g = next((g for g in gxs if abs(a[0] - g) < 0.08), None)
            if g is not None: used[i] = True; e = gext.setdefault(('x', round(g, 2)), [9e9, -9e9]); e[0] = min(e[0], a[1], b[1]); e[1] = max(e[1], a[1], b[1])
        if abs(a[1] - b[1]) < 0.02 and s[3] > 0:
            g = next((g for g in gys if abs(a[1] - g) < 0.08), None)
            if g is not None: used[i] = True; e = gext.setdefault(('y', round(g, 2)), [9e9, -9e9]); e[0] = min(e[0], a[0], b[0]); e[1] = max(e[1], a[0], b[0])
    for dm in P['dims']:
        if not dm.get('line'): continue
        if not model and len(dm['t']) == 5 and dm['t'].isdigit(): continue      # an RL on its level line: drawn as it is
        (x0, y0), (x1, y1) = dm['line']; L = math.hypot(x1 - x0, y1 - y0) or 1; d = ((x1 - x0) / L, (y1 - y0) / L)
        for i, s in enumerate(segs):
            if used[i]: continue
            for q in (s[0], s[1]):
                u = (q[0] - x0) * d[0] + (q[1] - y0) * d[1]; v = abs(-(q[0] - x0) * d[1] + (q[1] - y0) * d[0])
                if not (-1.5 <= u <= L + 1.5 and v < 1.6): break
            else:
                if math.dist(s[0], s[1]) < 3.3 or all(abs(-(q[0] - x0) * d[1] + (q[1] - y0) * d[0]) < 0.05 for q in (s[0], s[1])): used[i] = True
    for bb in P['bubbles']:
        cx, cy, r = bb['circle']
        for i, s in enumerate(segs):
            if not used[i] and all(math.dist(q, (cx, cy)) < r + 0.25 for q in (s[0], s[1])): used[i] = True
    for n in P['notes']:
        for k in range(len(n.get('leader') or []) - 1):
            A, B = n['leader'][k], n['leader'][k + 1]
            for i, s in enumerate(segs):
                if not used[i] and s[4] == 'l' and ((math.dist(s[0], A) < 0.05 and math.dist(s[1], B) < 0.05) or (math.dist(s[0], B) < 0.05 and math.dist(s[1], A) < 0.05)): used[i] = True
    # ------------------------------------------------------------ the residue, per pen, as polylines
    pens = {}
    for i, s in enumerate(segs):
        if used[i]: continue
        key = f"{s[2]:.3f}|{s[7]}"
        if s[4] == 'c': pens.setdefault(key, {'p': [], 'c': []})['c'].append([s[0], s[5], s[6], s[1]])
        else: pens.setdefault(key, {'p': [], 'c': []})['p'].append([s[0], s[1]])
    enc = lambda pts: (lambda v: v[:2] + [v[i] - v[i - 2] for i in range(2, len(v))])([round(c * 100) for q in pts for c in q])
    res = {}
    for key, pc in pens.items():
        # chain segments end to end into polylines
        chains = []; ends = {}
        for a, b in pc['p']:
            ka, kb = (round(a[0], 2), round(a[1], 2)), (round(b[0], 2), round(b[1], 2))
            if ka in ends:
                ch = ends.pop(ka)
                if ch[-1] == ka: ch.append(kb)
                else: ch.insert(0, kb)
                if kb in ends and ends[kb] is not ch: pass
                ends[kb] = ch
            else: ch = [ka, kb]; chains.append(ch); ends[ka] = ch; ends[kb] = ch
        res[key] = {'l': [enc(ch) for ch in chains], 'c': [enc(c) for c in pc['c']]}
    return {'gridext': [[k[0], k[1], round(v[0], 2), round(v[1], 2)] for k, v in gext.items()], 'origin': O if model else None, 'walls': [{'a': [round(M(w['a'])[0]), round(M(w['a'])[1])], 'b': [round(M(w['b'])[0]), round(M(w['b'])[1])], 't': round(w['t'] * 100), 'cls': w['cls']} for w in out_w],
            'cols': cols, 'brick': brick, 'holes': holes, 'res': res, 'fills': [[enc(pts), hc] for pts, g, hc in fills]}

if __name__ == '__main__':
    pages = []
    for part in sys.argv[1].split(','):
        if '-' in part: a, b = part.split('-'); pages += list(range(int(a), int(b) + 1))
        else: pages.append(int(part))
    out = {}
    for pg in pages:
        out[pg] = lift(pg)
        r = out[pg]; print(pg, 'walls', len(r['walls']), 'cols', len(r['cols']), 'brick', len(r['brick']), 'holes', len(r['holes']), 'pens', {k: len(v['l']) + len(v['c']) for k, v in r['res'].items()}, file=sys.stderr)
    json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'))
