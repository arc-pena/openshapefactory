"""Rebuild the red dashed mesh of the Nexus plans as a planar graph with cells.
Dashes are separate short paths (no dash array), so fragments are grouped into straight edges,
edges are snapped into nodes, split at T-junctions, and faces are traced."""
import sys, math, json, collections
sys.path.insert(0, '.')
from svgpaths import paths

def frag_segments(svg, pred):
    out = []
    for p in paths(svg):
        if not pred(p): continue
        for sp in p['subpaths']:
            for i in range(len(sp) - 1):
                a, b = sp[i], sp[i + 1]
                if math.dist(a, b) > 0.25: out.append((a, b))
    return out

class UF:
    def __init__(s, n): s.p = list(range(n))
    def f(s, x):
        while s.p[x] != x: s.p[x] = s.p[s.p[x]]; x = s.p[x]
        return x
    def u(s, a, b): a, b = s.f(a), s.f(b); s.p[a] = b

def group_edges(segs, ang_tol=1.6, off_tol=0.45, gap=3.9):
    info = []
    for a, b in segs:
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy); th = math.atan2(dy, dx) % math.pi
        info.append((th, a, b, L))
    grid = collections.defaultdict(list); G = 6.0
    for i, (th, a, b, L) in enumerate(info):
        for q in (a, b): grid[(int(q[0] // G), int(q[1] // G))].append(i)
    uf = UF(len(segs))
    def same(i, j):
        ti, ai, bi, Li = info[i]; tj, aj, bj, Lj = info[j]
        d = abs(ti - tj); d = min(d, math.pi - d)
        # direction of the longer one rules
        if d > math.radians(ang_tol) and min(Li, Lj) > 1.2: return False
        k = i if Li >= Lj else j; th = info[k][0]; c, s = math.cos(th), math.sin(th); o = info[k][1]
        def proj(p): return ((p[0] - o[0]) * c + (p[1] - o[1]) * s, -(p[0] - o[0]) * s + (p[1] - o[1]) * c)
        pa = [proj(p) for p in (ai, bi)]; pb = [proj(p) for p in (aj, bj)]
        if max(abs(v) for _, v in pa + pb) > off_tol: return False
        ia = sorted(u for u, _ in pa); ib = sorted(u for u, _ in pb)
        g = max(ib[0] - ia[1], ia[0] - ib[1])
        return g < gap
    for cell, ids in list(grid.items()):
        near = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1): near.update(grid.get((cell[0] + dx, cell[1] + dy), ()))
        near = sorted(near)
        for x in range(len(near)):
            for y in range(x + 1, len(near)):
                i, j = near[x], near[y]
                if uf.f(i) != uf.f(j) and same(i, j): uf.u(i, j)
    groups = collections.defaultdict(list)
    for i in range(len(segs)): groups[uf.f(i)].append(i)
    edges = []
    for g in groups.values():
        pts = [p for i in g for p in (info[i][1], info[i][2])]
        w = [info[i][3] for i in g for _ in (0, 1)]
        W = sum(w) or 1; mx = sum(p[0] * ww for p, ww in zip(pts, w)) / W; my = sum(p[1] * ww for p, ww in zip(pts, w)) / W
        sxx = sum(ww * (p[0] - mx) ** 2 for p, ww in zip(pts, w)); syy = sum(ww * (p[1] - my) ** 2 for p, ww in zip(pts, w)); sxy = sum(ww * (p[0] - mx) * (p[1] - my) for p, ww in zip(pts, w))
        th = 0.5 * math.atan2(2 * sxy, sxx - syy); c, s = math.cos(th), math.sin(th)
        ts = [(p[0] - mx) * c + (p[1] - my) * s for p in pts]
        t0, t1 = min(ts), max(ts)
        if t1 - t0 < 0.8: continue
        edges.append(((mx + c * t0, my + s * t0), (mx + c * t1, my + s * t1), len(g)))
    return edges

def inter(a, b, c, d):
    r = (b[0] - a[0], b[1] - a[1]); s = (d[0] - c[0], d[1] - c[1]); den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-9: return None
    t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
    return (a[0] + t * r[0], a[1] + t * r[1])

def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1e-12
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    q = (a[0] + t * dx, a[1] + t * dy); return math.dist(p, q), t, q

def build_graph(edges, snap=5.0, node_tol=1.2):
    E = [list(e[:2]) for e in edges]
    # 1. corner snapping: move each endpoint to the intersection with the closest non-parallel neighbouring edge end
    ends = [(i, k) for i in range(len(E)) for k in (0, 1)]
    grid = collections.defaultdict(list); G = snap
    for i, k in ends: p = E[i][k]; grid[(int(p[0] // G), int(p[1] // G))].append((i, k))
    newp = {}
    for i, k in ends:
        p = E[i][k]; best = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j, m in grid.get((int(p[0] // G) + dx, int(p[1] // G) + dy), ()):
                    if j == i: continue
                    q = E[j][m]
                    if math.dist(p, q) > snap: continue
                    a1 = math.atan2(E[i][1][1] - E[i][0][1], E[i][1][0] - E[i][0][0]); a2 = math.atan2(E[j][1][1] - E[j][0][1], E[j][1][0] - E[j][0][0])
                    da = abs((a1 - a2 + math.pi / 2) % math.pi - math.pi / 2)
                    if da < math.radians(8): continue
                    x = inter(E[i][0], E[i][1], E[j][0], E[j][1])
                    if not x or math.dist(x, p) > snap or math.dist(x, q) > snap: continue
                    dd = math.dist(x, p) + math.dist(x, q)
                    if best is None or dd < best[0]: best = (dd, x)
        if best: newp[(i, k)] = best[1]
    for (i, k), x in newp.items(): E[i][k] = x
    # 2. T-junctions: a free end near another edge's interior gets extended/trimmed onto that edge
    for i in range(len(E)):
        for k in (0, 1):
            if (i, k) in newp: continue
            p = E[i][k]; best = None
            for j in range(len(E)):
                if j == i: continue
                d, t, q = seg_dist(p, E[j][0], E[j][1])
                if d < snap and 0.02 < t < 0.98:
                    x = inter(E[i][0], E[i][1], E[j][0], E[j][1])
                    if x and math.dist(x, p) < snap and (best is None or math.dist(x, p) < best[0]): best = (math.dist(x, p), x)
            if best: E[i][k] = best[1]; newp[(i, k)] = best[1]
    # 3. cluster endpoints into nodes
    nodes = []; ngrid = collections.defaultdict(list)
    def node_of(p):
        cx, cy = int(p[0] // 3), int(p[1] // 3)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for n in ngrid.get((cx + dx, cy + dy), ()):
                    if math.dist(nodes[n], p) < node_tol: return n
        nodes.append(p); ngrid[(cx, cy)].append(len(nodes) - 1); return len(nodes) - 1
    raw = [(node_of(a), node_of(b)) for a, b in E]
    # 4. split edges at nodes lying on them
    out = set()
    for a, b in raw:
        if a == b: continue
        A, B = nodes[a], nodes[b]; on = []
        for n, P in enumerate(nodes):
            if n in (a, b): continue
            d, t, q = seg_dist(P, A, B)
            if d < node_tol * 0.8 and 0 < t < 1: on.append((t, n))
        chain = [a] + [n for _, n in sorted(on)] + [b]
        for x, y in zip(chain, chain[1:]):
            if x != y: out.add((min(x, y), max(x, y)))
    return nodes, sorted(out)

def faces(nodes, edges):
    adj = collections.defaultdict(list)
    for a, b in edges: adj[a].append(b); adj[b].append(a)
    for n in adj: adj[n].sort(key=lambda m: math.atan2(nodes[m][1] - nodes[n][1], nodes[m][0] - nodes[n][0]))
    used = set(); out = []
    for a, b in edges:
        for u, v in ((a, b), (b, a)):
            if (u, v) in used: continue
            loop = [u]; cu, cv = u, v; guard = 0
            while True:
                used.add((cu, cv)); loop.append(cv)
                nb = adj[cv]; i = nb.index(cu)
                nxt = nb[(i - 1) % len(nb)]           # turn: next edge clockwise from the one we came in on
                cu, cv = cv, nxt; guard += 1
                if (cu, cv) == (u, v) or guard > 5000: break
            loop = loop[:-1]
            A = sum(nodes[loop[i]][0] * nodes[loop[(i + 1) % len(loop)]][1] - nodes[loop[(i + 1) % len(loop)]][0] * nodes[loop[i]][1] for i in range(len(loop))) / 2
            out.append((A, loop))
    return out
