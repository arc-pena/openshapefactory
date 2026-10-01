# fixtures.py <pages> <out.json> : the plans' fixtures and joinery as family types and their instances.
#
# Revit draws every fixture, appliance and joinery run of the Techne plans in one pen (0.24 pt, grey 0xaa). Its lines
# are split into symbols: lines that only trace a wall's face are dropped (the wall draws that), the rest joined
# where they touch into connected groups; a group of a fixture's size is one instance. Its lines, moved to the
# group's centre, are its family's symbol; groups with the same symbol (in any of four turns) share one type. The
# body is the symbol's outline pulled up through a height read from what it is (its size and shape): a WC, a
# basin or vanity, a bath, a kitchen bench or island, a wardrobe, a fridge.
import json, math, sys, hashlib
LIFT = json.load(open('../data/wl_lift.json'))
PEN = '0.085|#aaaaaa'
PLANS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]

def dec(v):
    o = v[:2]
    for i in range(2, len(v)): o.append(o[i - 2] + v[i])
    return [x / 100 for x in o]

def segs_of(L):
    out = []
    r = L['res'].get(PEN)
    if not r: return out
    for pl in r['l']:
        q = dec(pl); pts = [(q[i], q[i + 1]) for i in range(0, len(q), 2)]
        for a, b in zip(pts, pts[1:]):
            if math.dist(a, b) > 0.02: out.append((a, b))
    for c in r['c']:
        q = dec(c); P = [(q[i], q[i + 1]) for i in range(0, 8, 2)]
        # the cubic as a short polyline
        prev = P[0]
        for k in range(1, 7):
            t = k / 6; u = 1 - t
            x = u**3 * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t**3 * P[3][0]
            y = u**3 * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t**3 * P[3][1]
            out.append((prev, (x, y))); prev = (x, y)
    return out

def wall_faces(L):
    # the modelled walls' two faces, in sheet mm (the lift's walls are in model mm from the page origin)
    O = L['origin']; faces = []
    for w in L['walls']:
        a = (O[0] + w['a'][0] / 100, O[1] + w['a'][1] / 100); b = (O[0] + w['b'][0] / 100, O[1] + w['b'][1] / 100)
        d = math.dist(a, b)
        if d < 0.1: continue
        u = ((b[0] - a[0]) / d, (b[1] - a[1]) / d); n = (-u[1], u[0]); h = w['t'] / 200
        for s in (h, -h): faces.append((a[0] + n[0] * s, a[1] + n[1] * s, u, n, a[0] * u[0] + a[1] * u[1], b[0] * u[0] + b[1] * u[1]))
    return faces

def on_face(seg, faces):
    (a, b) = seg; d = math.dist(a, b)
    if d < 0.3: return False
    u = ((b[0] - a[0]) / d, (b[1] - a[1]) / d)
    for fx, fy, fu, fn, s0, s1 in faces:
        if abs(u[0] * fu[1] - u[1] * fu[0]) > 0.05: continue
        if abs((a[0] - fx) * fn[0] + (a[1] - fy) * fn[1]) > 0.35 or abs((b[0] - fx) * fn[0] + (b[1] - fy) * fn[1]) > 0.35: continue
        sa, sb = a[0] * fu[0] + a[1] * fu[1], b[0] * fu[0] + b[1] * fu[1]
        if min(sa, sb) > min(s0, s1) - 0.5 and max(sa, sb) < max(s0, s1) + 0.5: return True
    return False

def components(segs, tol=0.12):
    # union-find over endpoints that meet (a grid of cells for speed)
    n = len(segs); par = list(range(n))
    def f(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    cell = {}
    for i, (a, b) in enumerate(segs):
        for p in (a, b):
            k = (round(p[0] / tol), round(p[1] / tol))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in cell.get((k[0] + dx, k[1] + dy), []):
                        ri, rj = f(i), f(j)
                        if ri != rj: par[ri] = rj
            cell.setdefault(k, []).append(i)
    groups = {}
    for i in range(n): groups.setdefault(f(i), []).append(segs[i])
    return list(groups.values())

def kind_of(w, d, nseg, curved):
    a, b = max(w, d), min(w, d)
    if curved and a < 800 and b < 600: return 'WC' if a > 550 else 'Basin', 400 if a > 550 else 850
    if 1450 < a < 1900 and 650 < b < 900: return 'Bath', 550
    if 550 < b < 720 and a >= 1200: return 'Bench', 900
    if 700 < b < 1300 and 1200 < a < 3500: return 'Island', 900
    if 450 < b < 650 and a < 1200: return 'Vanity', 850
    if 550 < b < 800 and 550 < a < 800: return 'Appliance', 1800
    return 'Joinery', 900

def canon(lines):
    # the symbol in its own frame, the same whichever of four turns it was drawn in: the turn whose rounded
    # coordinates sort lowest; returns (key, turn in degrees, lines in that frame)
    best = None
    for k in range(4):
        c, s = [(1, 0), (0, 1), (-1, 0), (0, -1)][k]
        rl = [[(x * c + y * s, -x * s + y * c) for x, y in pl] for pl in lines]
        segs = sorted(tuple(sorted([(round(p[0] / 20) * 20, round(p[1] / 20) * 20) for p in (pl[0], pl[-1])])) for pl in rl)
        key = hashlib.md5(json.dumps(segs).encode()).hexdigest()[:12]
        if best is None or key < best[0]: best = (key, k * 90, rl)
    return best

pages = []
for part in sys.argv[1].split(','):
    if '-' in part: a, b = part.split('-'); pages += list(range(int(a), int(b) + 1))
    else: pages.append(int(part))
types, out = {}, {}
for pg in pages:
    L = LIFT[str(pg)]
    if not L.get('origin'): continue
    O = L['origin']; faces = wall_faces(L)
    segs = [s for s in segs_of(L) if not on_face(s, faces)]
    inst = []
    for g in components(segs):
        xs = [p[0] for s in g for p in s]; ys = [p[1] for s in g for p in s]
        w, d = (max(xs) - min(xs)) * 100, (max(ys) - min(ys)) * 100
        if len(g) < 3 or max(w, d) > 6000 or min(w, d) < 150 or max(w, d) < 300: continue
        # a lining or a room's outline (a few long straight lines round an empty middle) is not a fixture
        longs = sum(1 for a, b in g if math.dist(a, b) * 100 > 1000)
        if len(g) <= 6 and longs >= 2 and min(w, d) > 900: continue
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        lines = [[((a[0] - cx) * 100, (a[1] - cy) * 100), ((b[0] - cx) * 100, (b[1] - cy) * 100)] for a, b in g]
        curved = sum(1 for a, b in g if math.dist(a, b) < 0.12) > 8
        key, turn, local = canon(lines)
        if key not in types:
            kind, h = kind_of(w, d, len(g), curved)
            lx = [p[0] for pl in local for p in pl]; ly = [p[1] for pl in local for p in pl]
            types[key] = {'kind': kind, 'height': h, 'lines': [[[round(p[0]), round(p[1])] for p in pl] for pl in local],
                          'body': [[round(min(lx)), round(min(ly))], [round(max(lx)), round(min(ly))], [round(max(lx)), round(max(ly))], [round(min(lx)), round(max(ly))]], 'n': 0}
        types[key]['n'] += 1
        inst.append({'type': key, 'at': [round((cx - O[0]) * 100), round((cy - O[1]) * 100)], 'rot': turn})
    out[pg] = inst
    print(pg, len(segs), 'lines ->', len(inst), 'fixtures', file=sys.stderr)
print(len(types), 'types', sorted(((t['kind'], t['n']) for t in types.values()), key=lambda x: -x[1])[:15], file=sys.stderr)
json.dump({'types': types, 'pages': out}, open(sys.argv[2], 'w'), separators=(',', ':'))
