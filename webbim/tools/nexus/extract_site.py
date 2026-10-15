"""The site boundary (red, 1.42 pt) and the setback line (red, 0.71 pt) of the Nexus plans: site_1.42.json and
site_0.71.json, page points, y down. The lines are dash-dot chains of separate fragments, some of them arcs, so
fragments are chained greedily end to nearest end (grouping them as straight edges would flatten the arcs)."""
import os, sys, json, math
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from svgpaths import paths
WORK = os.environ.get('NEXUS_WORK', os.getcwd())
svg = sys.argv[1] if len(sys.argv) > 1 else os.path.join(WORK, 'svg', 'L5.svg')
def chain(width):
    frags = [sp for p in paths(svg) if p['stroke'] == (255, 0, 0) and abs(p['w'] - width) < 0.02 for sp in p['subpaths'] if len(sp) >= 2]
    if not frags: return []
    left = frags[1:]; out = list(frags[0])
    while left:
        end = out[-1]
        k, rev = min(((i, r) for i in range(len(left)) for r in (0, 1)), key=lambda t: math.dist(end, left[t[0]][-1] if t[1] else left[t[0]][0]))
        f = left.pop(k); f = f[::-1] if rev else f
        out.extend(f if math.dist(end, f[0]) > 1e-6 else f[1:])
    return out
for w in (1.42, 0.71):
    pts = chain(w); json.dump(pts, open(os.path.join(WORK, 'site_%s.json' % w), 'w'))
    print(w, len(pts), 'points')
