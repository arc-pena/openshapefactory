# every block of the file as polylines in mm (insertion point at its base point), simplified
import ezdxf, json, math, sys
from ezdxf import path as zpath
from ezdxf.disassemble import recursive_decompose
d = ezdxf.readfile("cad goodies.dxf")
scale = {}
for e in d.modelspace().query("INSERT"): scale[e.dxf.name] = abs(e.dxf.xscale) or 1
def dp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy)
    best, bi = -1, 0
    for i in range(1, len(pts)-1):
        p = pts[i]
        dd = abs(dy*(p[0]-a[0]) - dx*(p[1]-a[1]))/L if L > 1e-9 else math.hypot(p[0]-a[0], p[1]-a[1])
        if dd > best: best, bi = dd, i
    if best <= tol: return [a, b]
    return dp(pts[:bi+1], tol)[:-1] + dp(pts[bi:], tol)
out = {}
for b in d.blocks:
    if b.name.startswith('*') or b.is_any_layout: continue
    s = scale.get(b.name)
    f = 1.0 if s is None or abs(s - 1) < 1e-6 else s * 25.4 / 21.0493080039988
    if s is None: f = 25.4        # never placed: a library block drawn in inches
    polys, fills = [], []
    try:
        for e in recursive_decompose(b):
            t = e.dxftype()
            if t in ("TEXT", "MTEXT", "ATTDEF", "ATTRIB", "POINT", "VIEWPORT", "IMAGE", "WIPEOUT"): continue
            try:
                if t == "HATCH":
                    if e.dxf.solid_fill:
                        for p in zpath.from_hatch(e):
                            fills.append([(v.x*f, v.y*f) for v in p.flattening(0.5/f if f > 2 else 0.5)])
                    continue
                if t in ("SOLID", "TRACE", "3DFACE"):
                    vs = [e.dxf.vtx0, e.dxf.vtx1, e.dxf.vtx3 if t != "3DFACE" else e.dxf.vtx2, e.dxf.vtx2 if t != "3DFACE" else e.dxf.vtx3]
                    polys.append([(v[0]*f, v[1]*f) for v in vs + [vs[0]]]); continue
                p = zpath.make_path(e)
                for sp in (p.sub_paths() if p.has_sub_paths else [p]):
                    pts = [(v.x*f, v.y*f) for v in sp.flattening(0.02 * 25.4 / f if f > 2 else 1.0)]
                    if len(pts) >= 2: polys.append(pts)
            except Exception as ex:
                pass
    except Exception as ex:
        print("skip", b.name, ex, file=sys.stderr)
    allp = [q for pl in polys + fills for q in pl]
    if not allp: continue
    xs = [q[0] for q in allp]; ys = [q[1] for q in allp]
    size = max(max(xs)-min(xs), max(ys)-min(ys), 1)
    tol = max(1.0, size * 0.0028)
    sp = [dp(pl, tol) for pl in polys]; sf = [dp(pl, tol) for pl in fills]
    q = lambda pl: [[round(x), round(y)] for x, y in pl]
    sp = [q(pl) for pl in sp]; sf = [q(pl) for pl in sf]
    sp = [pl for pl in sp if len(pl) >= 2 and any(pl[i] != pl[0] for i in range(len(pl)))]
    out[b.name] = {"f": round(f, 4), "bbox": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))], "p": sp, "fill": sf}
json.dump(out, open("blocks.json", "w"), separators=(",", ":"))
n = sum(len(v["p"]) + len(v["fill"]) for v in out.values()); pts = sum(len(pl) for v in out.values() for pl in v["p"] + v["fill"])
print(len(out), "blocks", n, "polylines", pts, "points")
