# slabs.py <out.json> : each GA plan's floor plate - the union of what stands or is finished on it (its walls, piers,
# columns, finish regions: balconies and terraces too), small gaps closed, rooms with no finish filled - and the
# plate's edges no wall runs along (where a balcony's or a terrace's balustrade stands). Model mm.
import json, sys
from shapely.geometry import Polygon, box, LineString
from shapely.ops import unary_union
LIFT = json.load(open('../data/wl_lift.json')); FIN = json.load(open('../data/wl_fin.json'))
PAGES = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
out = {}
for pg in PAGES:
    L = LIFT[str(pg)]; parts = []
    for w in L['walls']:
        a, b = w['a'], w['b']
        if a == b: continue
        parts.append(LineString([a, b]).buffer(max(w['t'], 50) / 2, cap_style=2))
    for r in L.get('brick', []) + L.get('cols', []):
        parts.append(box(min(r[0], r[2]), min(r[1], r[3]), max(r[0], r[2]), max(r[1], r[3])))
    for r in FIN.get(str(pg), []):
        try: parts.append(Polygon(r['ring'], r['holes']).buffer(0))
        except Exception: pass
    if not parts: continue
    U0 = unary_union(parts); U = U0.buffer(900, join_style=2).buffer(-900, join_style=2)
    polys = [U] if U.geom_type == 'Polygon' else list(U.geoms)
    # a plate drawn in pieces too far apart to close (a roof's plant, a level of separate lofts): their outer hull
    if not any(P.area >= 20e6 for P in polys): polys = [U0.convex_hull]
    plates = []
    for P in polys:
        if P.area < 20e6: continue                     # under 20 m2: not a floor plate
        holes = [h for h in P.interiors if Polygon(h).area > 25e6]   # a large void stays (a lightwell); rooms fill
        P = Polygon(P.exterior, holes).simplify(30)
        walls = unary_union([p for p in parts[:len(L['walls'])]]).buffer(120)
        edges = []
        ring = list(P.exterior.coords)
        for a, b in zip(ring, ring[1:]):
            seg = LineString([a, b])
            if seg.length < 600: continue
            free = seg.difference(walls)
            for g in ([free] if free.geom_type == 'LineString' else list(getattr(free, 'geoms', []))):
                if g.length > 900: edges.append([[round(x), round(y)] for x, y in g.coords])
        plates.append({'ring': [[round(x), round(y)] for x, y in list(P.exterior.coords)[:-1]],
                       'holes': [[[round(x), round(y)] for x, y in list(h.coords)[:-1]] for h in P.interiors], 'free': edges})
    out[pg] = plates
    print(pg, len(plates), 'plates', [(round(Polygon(p['ring']).area / 1e6), len(p['free'])) for p in plates], file=sys.stderr)
json.dump(out, open(sys.argv[1], 'w'), separators=(',', ':'))
