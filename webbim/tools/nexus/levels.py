"""Per-level digitising: which mesh cells each drawn plan occupies, the drawn outlines for review,
programme zones with labels, and the vertical elements the plans name (lifts, atria, MEP risers).
Writes ../nexus_data.json (model units: mm, y up).

  used[cell] = 1               the whole cell is floor on that level
  used[cell] = [s, dx, dy]     part of it: the cell scaled by s about its centroid, then moved by (dx, dy) mm
                               (the centre of what is drawn inside the cell), so it follows the cell when nodes move
"""
import sys, os, math, json, re, glob, subprocess
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svgpaths import paths
from mesh import faces
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('NEXUS_WORK', os.getcwd())          # svg/, site_*.json, mesh_raw.json; nexus_data.json is written here
D = os.environ.get('NEXUS_PDFS', OUT) + '/'              # the A2_2000_L*.pdf files
FILES = {int(re.search(r'_L(\d+)\.pdf', f).group(1)): f for f in glob.glob(D + '*A2_2000_L*.pdf')}
MM = 25.4 / 72 * 2000                      # model mm per page point (A2 at 1:2000; scale bar 100 m = 141.68 pt checks out)
site = json.load(open(f'{OUT}/site_1.42.json')); setback = json.load(open(f'{OUT}/site_0.71.json'))
X0 = min(p[0] for p in site); Y0 = max(p[1] for p in site)
def M(p): return [round((p[0] - X0) * MM), round((Y0 - p[1]) * MM)]
K = 2.0                                    # raster px per point for coverage
W, H = int(1683.84 * K) + 1, int(1190.64 * K) + 1
raw = json.load(open(f'{OUT}/mesh_raw.json')); nodes = [tuple(p) for p in raw['nodes']]; edges = [tuple(e) for e in raw['edges']]
F = [f for f in faces(nodes, edges) if f[0] > 0]
used_nodes = sorted({n for _, loop in F for n in loop}, key=lambda n: (round(nodes[n][1] / 25), nodes[n][0])); remap = {n: i for i, n in enumerate(used_nodes)}
cells = []
for A, loop in sorted(F, key=lambda f: (round(sum(nodes[n][1] for n in f[1]) / len(f[1]) / 25), sum(nodes[n][0] for n in f[1]) / len(f[1]))):
    cells.append({'loop': [remap[n] for n in loop], 'areaPt': A})
def cell_poly(c): return [nodes[used_nodes[n]] for n in c['loop']]
def poly_centroid(P):
    a = cx = cy = 0
    for i in range(len(P)):
        (x0, y0), (x1, y1) = P[i], P[(i + 1) % len(P)]; k = x0 * y1 - x1 * y0; a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k
    return (cx / (3 * a), cy / (3 * a)) if abs(a) > 1e-9 else (sum(p[0] for p in P) / len(P), sum(p[1] for p in P) / len(P))
def inside(pt, P):
    x, y = pt; c = False; j = len(P) - 1
    for k in range(len(P)):
        (xi, yi), (xj, yj) = P[k], P[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
        j = k
    return c
CM = []                                    # per cell: (x0, y0, mask) in raster px
for c in cells:
    im = Image.new('L', (W, H), 0); ImageDraw.Draw(im).polygon([(x * K, y * K) for x, y in cell_poly(c)], fill=1)
    bb = im.getbbox(); CM.append((bb, np.array(im.crop(bb), dtype=bool) if bb else None))
def coverage(built):
    """Share of each cell drawn as floor, and the centre (page pt) of the drawn part."""
    cov, ctr = [], []
    for bb, m in CM:
        if not bb: cov.append(0); ctr.append(None); continue
        b = built[bb[1]:bb[3], bb[0]:bb[2]] & m; n = int(b.sum())
        cov.append(round(n / max(1, int(m.sum())), 3))
        if n: ys, xs = np.nonzero(b); ctr.append(((xs.mean() + bb[0]) / K, (ys.mean() + bb[1]) / K))
        else: ctr.append(None)
    return cov, ctr
PALETTE = np.array([(224, 192, 224), (232, 199, 224), (240, 160, 112), (242, 168, 120), (224, 164, 104), (240, 240, 128), (255, 255, 64), (114, 28, 77), (112, 16, 64),
           (215, 34, 137), (208, 32, 128), (176, 224, 240), (191, 226, 240), (79, 163, 199), (64, 160, 192), (77, 139, 128), (64, 128, 128), (255, 0, 255), (255, 196, 199),
           (217, 24, 154), (195, 228, 103), (255, 191, 0)], dtype=np.int32)
GREY = {(230, 230, 230), (105, 105, 105), (86, 86, 86), (190, 190, 190), (165, 165, 165), (0, 0, 0), (0, 255, 0), (255, 255, 255)}
def simplify(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1e-9
        d = abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L
        if d > dmax: dmax, idx = d, i
    if dmax > tol: return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)
    return [a, b]
def simplify_loop(pts, tol):
    if len(pts) > 1 and math.dist(pts[0], pts[-1]) < 1e-6: pts = pts[:-1]
    if len(pts) < 4: return pts
    far = max(range(len(pts)), key=lambda i: math.dist(pts[0], pts[i]))
    a = simplify(pts[:far + 1], tol); b = simplify(pts[far:] + [pts[0]], tol)
    return a[:-1] + b[:-1]
def words(L):
    out = subprocess.run(['pdftotext', '-bbox', FILES[L], '-'], capture_output=True, text=True).stdout
    return [(float(a), float(b), float(c), float(d), t) for a, b, c, d, t in re.findall(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', out)]
def l0_mask():
    cache = f'{OUT}/L0_built.png'
    if os.path.exists(cache): return np.array(Image.open(cache)) > 0
    png = f'{OUT}/L0_k'
    subprocess.run(['pdftoppm', '-r', str(int(72 * K)), '-png', '-singlefile', FILES[0], png], check=True)
    a = np.array(Image.open(png + '.png').convert('RGB').resize((W, H)), dtype=np.int32)
    sat = a.max(2) - a.min(2) >= 40
    hit = np.zeros(a.shape[:2], bool)
    for c in PALETTE: hit |= ((a - c) ** 2).sum(2) < 1600
    m = sat & hit; Image.fromarray((m * 255).astype(np.uint8)).save(cache); return m
levels, plate_rings = [], {}
for L in sorted(FILES):
    outlines, zones = [], []
    if L == 0: built = l0_mask()
    else:
        img = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(img)
        for p in paths(f'{OUT}/svg/L{L}.svg'):
            if L <= 3 and p['fill'] and p['fill'] not in GREY and not p['stroke']:
                for sp in p['subpaths']:
                    if len(sp) >= 3:
                        dr.polygon([(x * K, y * K) for x, y in sp], fill=1)
                        A = abs(sum(sp[i][0] * sp[(i + 1) % len(sp)][1] - sp[(i + 1) % len(sp)][0] * sp[i][1] for i in range(len(sp)))) / 2
                        if A > 40: zones.append({'color': '#%02x%02x%02x' % p['fill'], 'pts': [M(q) for q in simplify_loop(sp, 0.25)], 'areaPt': A, '_page': sp})
            if L >= 4 and p['stroke'] == (0, 0, 0) and abs(p['w'] - 0.85) < 0.02:
                for sp in p['subpaths']:
                    if len(sp) >= 3:
                        closed = math.dist(sp[0], sp[-1]) < 6
                        if closed: dr.polygon([(x * K, y * K) for x, y in sp], fill=1)
                        outlines.append({'closed': closed, 'pts': [M(q) for q in (simplify_loop(sp, 0.12) if closed else simplify(sp, 0.12))], '_page': sp,
                                         'centroid': [sum(q[0] for q in sp) / len(sp), sum(q[1] for q in sp) / len(sp)]})
        built = np.array(img) > 0
    cov, ctr = coverage(built)
    plate_rings[L] = [o['_page'] for o in outlines if o['closed']]
    ws = words(L) if L > 0 else []
    for z in zones: z['label'] = ''
    lifts = []
    for w in ws:
        if w[4] == 'Lift':
            prev = [v for v in ws if v[4] in ('FOH', 'Service') and abs(v[2] - w[0]) < 3 and abs(v[1] - w[1]) < 3]
            lifts.append({'kind': prev[0][4] if prev else 'Lift', 'page': ((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)})
    lab = [{'text': w[4], 'page': ((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)} for w in ws if w[4] in ('MM', 'ULO', 'Atrium', 'Office', 'Hotel', 'MEP', 'WC', 'Entertainment', 'HyperMarket')]
    # zones take the label that sits in them (smallest zone wins)
    for l in lab:
        hit = sorted([z for z in zones if inside(l['page'], z['_page'])], key=lambda z: z['areaPt'])
        if hit and not hit[0]['label']: hit[0]['label'] = l['text']
    used = {i: 1 for i, c in enumerate(cov) if c >= 0.5}
    if L >= 4:
        # cells partly under a drawn plate whose centre falls inside them: kept at their drawn share, centred on it
        for o in outlines:
            if not o['closed']: continue
            for i, c in enumerate(cells):
                if i in used or cov[i] < 0.06 or not ctr[i] or not inside(o['centroid'], cell_poly(c)): continue
                s = round(math.sqrt(cov[i]), 3); cc = poly_centroid(cell_poly(c)); q = ctr[i]
                # the scaled cell's centre lands on the drawn part's centre: d = target - centroid (mm, y up)
                used[i] = [s, round((q[0] - cc[0]) * MM), round(-(q[1] - cc[1]) * MM)]
    for o in outlines: o.pop('centroid', None)
    levels.append({'level': L, 'name': f'L{L:02d}', 'elevation': 0 if L == 0 else 8000 + 6000 * (L - 1), 'cov': cov, 'used': {str(k): v for k, v in used.items()},
                   'outlines': outlines, 'zones': zones, 'lifts': lifts, 'labels': lab})
    print(f'L{L}: used {len(used)} cells ({sum(1 for v in used.values() if v != 1)} part), outlines {len(outlines)}, zones {len(zones)}, lifts {len(lifts)}, labels {len(lab)}', flush=True)

# ---------------------------------------------------------------- vertical elements
def floor_at(L, pt):
    """Is the page point on floor at level L? (inside a used cell, or under a drawn tower plate)"""
    lv = levels[L]
    for k, v in lv['used'].items():
        if v == 1 and inside(pt, cell_poly(cells[int(k)])): return True
    return sum(inside(pt, r) for r in plate_rings.get(L, [])) % 2 == 1
def cluster(items, radius):
    groups = []
    for it in items:
        g = next((g for g in groups if math.dist(g['c'], it['page']) < radius), None)
        if g: g['m'].append(it); n = len(g['m']); g['c'] = (sum(x['page'][0] for x in g['m']) / n, sum(x['page'][1] for x in g['m']) / n)
        else: groups.append({'c': it['page'], 'm': [it]})
    return groups
vertical = []
# lifts: every lift the podium plans name, banked by position (a bank is a core); it runs from the ground up as long
# as there is floor under it
allLifts = [dict(l, level=lv['level']) for lv in levels for l in lv['lifts']]
for g in cluster(allLifts, 9.0):          # 9 pt = 6.35 m
    lvs = sorted({m['level'] for m in g['m']}); per = max(sum(1 for m in g['m'] if m['level'] == x) for x in lvs)
    kinds = [m['kind'] for m in g['m']]; kind = max(set(kinds), key=kinds.count)
    top = lvs[-1]
    while top + 1 < len(levels) and floor_at(top + 1, g['c']): top += 1
    vertical.append({'use': 'Lift', 'label': f'{kind} lifts', 'at': M(g['c']), 'cars': per, 'base': 0, 'top': top})
# atria: the courts the plans name, the drawn court as the void, from its level up while the plate surrounds it
for lv in levels:
    for l in lv['labels']:
        if l['text'] != 'Atrium': continue
        z = next((z for z in sorted(lv['zones'], key=lambda z: z['areaPt']) if inside(l['page'], z['_page'])), None)
        top = lv['level']
        while top + 1 < len(levels) and any(inside(l['page'], r) for r in plate_rings.get(top + 1, [])) and not floor_at(top + 1, l['page']): top += 1
        vertical.append({'use': 'Atrium', 'label': 'Atrium', 'at': M(l['page']), 'outline': z['pts'] if z else None, 'base': lv['level'], 'top': top})
    for l in lv['labels']:
        if l['text'] != 'MEP': continue
        top = lv['level']
        while top + 1 < len(levels) and floor_at(top + 1, l['page']): top += 1
        vertical.append({'use': 'Riser', 'label': 'MEP riser', 'at': M(l['page']), 'base': 0, 'top': max(top, lv['level'])})
for lv in levels:
    for z in lv['zones']: z.pop('_page', None)
    for o in lv['outlines']: o.pop('_page', None)
    lv['lifts'] = [{'kind': l['kind'], 'at': M(l['page'])} for l in lv['lifts']]
    lv['labels'] = [{'text': l['text'], 'at': M(l['page'])} for l in lv['labels']]
print('vertical:', len(vertical), {u: sum(1 for v in vertical if v['use'] == u) for u in ('Lift', 'Atrium', 'Riser')})
for v in vertical: print('  ', v['use'], v['label'], v.get('cars', ''), f"L{v['base']:02d}-L{v['top']:02d}", v['at'])
out = {'scale': 2000, 'mmPerPt': MM, 'originPt': [X0, Y0],
       'site': [M(p) for p in simplify_loop(site, 0.3)], 'setback': [M(p) for p in simplify(setback, 0.3)],
       'nodes': [M(nodes[n]) for n in used_nodes], 'cells': [c['loop'][::-1] for c in cells], 'levels': levels, 'vertical': vertical}
json.dump(out, open(f'{OUT}/nexus_data.json', 'w'))
print('nodes', len(out['nodes']), 'cells', len(out['cells']), 'site pts', len(out['site']), 'setback pts', len(out['setback']))
