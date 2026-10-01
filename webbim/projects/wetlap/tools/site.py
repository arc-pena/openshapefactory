# site.py <out.json> : the site boundary from the grid setout (A0020, 1:200): its red dash-dot edges merged into lines,
# each corner where two neighbouring lines meet; in model mm.
import json, math
L = json.load(open('../data/wl_lift.json'))['4']; O = (198.34, 214.24); S = 200
def dec(v):
    o = v[:2]
    for i in range(2, len(v)): o.append(o[i - 2] + v[i])
    return [x / 100 for x in o]
segs = []
for k, r in L['res'].items():
    if '#ff0000' not in k or float(k.split('|')[0]) < 1: continue
    for pl in r['l']:
        q = dec(pl); pts = [(q[i], q[i + 1]) for i in range(0, len(q), 2)]
        segs += [(a, b) for a, b in zip(pts, pts[1:]) if math.dist(a, b) > 0.05]
# group by line (direction, offset)
lines = []
for a, b in segs:
    d = math.dist(a, b); u = ((b[0] - a[0]) / d, (b[1] - a[1]) / d)
    if u[0] < -1e-9 or (abs(u[0]) < 1e-9 and u[1] < 0): u = (-u[0], -u[1])
    n = (-u[1], u[0]); off = a[0] * n[0] + a[1] * n[1]; s0, s1 = sorted((a[0] * u[0] + a[1] * u[1], b[0] * u[0] + b[1] * u[1]))
    for Ln in lines:
        if abs(Ln['u'][0] * u[1] - Ln['u'][1] * u[0]) < 0.04 and abs(Ln['off'] - off) < 0.6 and s0 < Ln['s1'] + 6 and s1 > Ln['s0'] - 6:
            Ln['s0'] = min(Ln['s0'], s0); Ln['s1'] = max(Ln['s1'], s1); break
    else: lines.append({'u': u, 'n': n, 'off': off, 's0': s0, 's1': s1})
lines = [l for l in lines if l['s1'] - l['s0'] > 8]
ends = lambda l: [(l['u'][0] * s + l['n'][0] * l['off'], l['u'][1] * s + l['n'][1] * l['off']) for s in (l['s0'], l['s1'])]
def meet(A, B):
    (p, r), (q, s) = (ends(A)[0], A['u']), (ends(B)[0], B['u']); den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-9: return None
    t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den; return (p[0] + r[0] * t, p[1] + r[1] * t)
# walk: from each line's end to the line whose end is nearest
order = [0]; used = {0}; cur, end = 0, 1; exits = {0: 1}
while True:
    e = ends(lines[cur])[end]; best = None
    for j, l in enumerate(lines):
        if j in used: continue
        for k2, q in enumerate(ends(l)):
            dd = math.dist(e, q)
            if best is None or dd < best[0]: best = (dd, j, k2)
    if not best or best[0] > 12: break
    order.append(best[1]); used.add(best[1]); cur, end = best[1], 1 - best[2]; exits[cur] = end
# corners only where the boundary turns (near-parallel neighbours are one edge drawn in pieces)
keep = [o for i, o in enumerate(order) if abs(lines[order[i - 1]]['u'][0] * lines[o]['u'][1] - lines[order[i - 1]]['u'][1] * lines[o]['u'][0]) > 0.1 or i == 0]
order = keep
pts = []
for i in range(len(order)):
    A, B = lines[order[i - 1]], lines[order[i]]; m = meet(A, B)
    ea, eb = ends(A)[exits.get(order[i - 1], 1)], ends(B)[1 - exits.get(order[i], 1)]
    # two edges that do not reach each other (a short jog between them, too short to read as a line): both ends
    if m is None or math.dist(m, ea) > 6 or math.dist(m, eb) > 6: pts += [ea, eb]
    else: pts.append(m)
model = [[round((p[0] - O[0]) * S), round((p[1] - O[1]) * S)] for p in pts if p]
print(len(lines), 'lines', len(model), 'corners', model)
json.dump(model, open('../data/wl_site.json', 'w'))
