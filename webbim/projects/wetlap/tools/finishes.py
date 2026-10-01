# finishes.py <pages> <out.json> : the plans' floor finishes as regions with their pattern.
#
# A floor finish is drawn as a hatch: parallel lines a constant step apart (timber boards one way, pavers and tiles
# both ways), in one grey pen. Each such line, with a neighbour at that step, stands for a strip a step wide; the
# strips of one pen and direction, unioned, are the finish's region. Its pattern is the step and the direction (and
# its phase, so the model's pattern falls on the set's lines). Regions are in model mm from the page's origin.
import json, math, sys
from collections import Counter
from shapely.geometry import box as sbox
from shapely.ops import unary_union
LIFT = json.load(open('../data/wl_lift.json'))
HATCH_PENS = None          # every hairline grey pen is tried

def dec(v):
    o = v[:2]
    for i in range(2, len(v)): o.append(o[i - 2] + v[i])
    return [x / 100 for x in o]

def lines_of(r):
    out = []
    for pl in r['l']:
        q = dec(pl); pts = [(q[i], q[i + 1]) for i in range(0, len(q), 2)]
        for a, b in zip(pts, pts[1:]):
            if abs(a[1] - b[1]) < 0.01 and abs(a[0] - b[0]) > 1.0: out.append(('H', a[1], min(a[0], b[0]), max(a[0], b[0])))
            elif abs(a[0] - b[0]) < 0.01 and abs(a[1] - b[1]) > 1.0: out.append(('V', a[0], min(a[1], b[1]), max(a[1], b[1])))
    return out

def families(ls):
    # per direction: each line's step to its nearest overlapping parallel neighbour; lines whose step recurs are hatch
    res = []
    for d in ('H', 'V'):
        L = sorted([l for l in ls if l[0] == d], key=lambda l: l[1])
        steps = []
        for i, l in enumerate(L):
            best = None
            for j in range(i + 1, min(len(L), i + 60)):
                m = L[j]; gap = m[1] - l[1]
                if gap < 0.3: continue
                if gap > 9: break
                if min(l[3], m[3]) - max(l[2], m[2]) > 0.5: best = gap; break
            steps.append(best)
        c = Counter(round(s, 1) for s in steps if s)
        for step0, n in c.most_common(3):
            if n < 6: break
            # the step to a hundredth: the mean of the steps near the mode (the PDF rounds each line's place)
            near = [s_ for s_ in steps if s_ and abs(s_ - step0) < 0.15]; step = sum(near) / len(near)
            strips = []
            for l, s in zip(L, steps):
                if s and abs(s - step) < 0.15: strips.append(sbox(l[2], l[1], l[3], l[1] + step) if d == 'H' else sbox(l[1], l[2], l[1] + step, l[3]))
            if len(strips) < 6: continue
            U = unary_union([g.buffer(0.05, join_style=2) for g in strips]).buffer(-0.05, join_style=2)
            res.append((d, step, [l for l, s_ in zip(L, steps) if s_ and abs(s_ - step) < 0.15], U))
    return res

pages = []
for part in sys.argv[1].split(','):
    if '-' in part: a, b = part.split('-'); pages += list(range(int(a), int(b) + 1))
    else: pages.append(int(part))
out = {}
for pg in pages:
    L = LIFT[str(pg)]; O = L.get('origin')
    if not O: continue
    regs = []
    for pen, r in L['res'].items():
        w, col = pen.split('|')
        if float(w) > 0.1 or col in ('#000000', '#aaaaaa', '#ff0000'): continue
        fams = families(lines_of(r))
        # a pen hatched both ways over the same ground is a grid (tiles, pavers)
        Hs = [f for f in fams if f[0] == 'H']; Vs = [f for f in fams if f[0] == 'V']
        for (d, step, phase, U) in fams:
            other = Vs if d == 'H' else Hs
            grid = next((o for o in other if o[3].intersection(U).area > 0.5 * min(U.area, o[3].area)), None)
            if grid and d == 'V': continue            # taken with its H partner
            region = U.union(grid[3]) if grid else U
            polys = [region] if region.geom_type == 'Polygon' else list(region.geoms)
            for P in polys:
                if P.area < 60: continue              # under 0.6 m2: not a finish
                P = P.simplify(0.05)
                ring = [[round((x - O[0]) * 100), round((y - O[1]) * 100)] for x, y in list(P.exterior.coords)[:-1]]
                holes = [[[round((x - O[0]) * 100), round((y - O[1]) * 100)] for x, y in list(h.coords)[:-1]] for h in P.interiors if h.area > 4]
                def ph(lines, dd, st):
                    # the lines' common offset on the step, in model mm from the origin (a circular mean: the PDF
                    # rounds each line's place by a few hundredths)
                    o = O[1] if dd == 'H' else O[0]; mid = lambda l: (((l[2] + l[3]) / 2, l[1]) if dd == 'H' else (l[1], (l[2] + l[3]) / 2))
                    from shapely.geometry import Point
                    vals = [((l[1] - o) * 100) % (st * 100) for l in lines if P.buffer(0.2).contains(Point(*mid(l)))]
                    if not vals: return 0
                    a = [v / (st * 100) * 2 * math.pi for v in vals]
                    m = math.atan2(sum(math.sin(x) for x in a), sum(math.cos(x) for x in a))
                    return round((m / (2 * math.pi) * st * 100) % (st * 100))
                k = {'pen': col, 'kind': 'grid' if grid else ('boards-' + d), 'step': round(step * 100, 1),
                     'step2': round(grid[1] * 100, 1) if grid else None,
                     'phase': ph(phase, d, step),
                     'phase2': ph(grid[2], 'V', grid[1]) if grid else None,
                     'ring': ring, 'holes': holes}
                regs.append(k)
    out[pg] = regs
    print(pg, len(regs), 'finish regions', Counter((r['kind'], r['step'], r['pen']) for r in regs).most_common(6), file=sys.stderr)
json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'))
