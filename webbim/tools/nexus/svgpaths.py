"""Read pdftocairo SVG output: every <path> outside <defs> with its stroke/fill colour, width and points (transform applied).
Returns list of dicts {stroke, fill, w, subpaths:[[(x,y),...]], closed:[bool]} in page points (y down)."""
import re, math
NUM = r'[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?'
def col(v):
    if not v or v == 'none': return None
    m = re.findall(r'([\d.]+)%', v)
    return tuple(round(float(x) / 100 * 255) for x in m) if m else v
def parse_d(d):
    toks = re.findall(r'[MLCZmlcz]|' + NUM, d)
    subs, closed, cur, i, cmd = [], [], None, 0, None
    while i < len(toks):
        t = toks[i]
        if t in 'MLCZmlcz': cmd = t; i += 1
        if cmd in 'Zz':
            if cur: closed[-1] = True
            cmd = None; continue
        if cmd == 'M':
            cur = [(float(toks[i]), float(toks[i + 1]))]; subs.append(cur); closed.append(False); i += 2; cmd = 'L'
        elif cmd == 'L':
            cur.append((float(toks[i]), float(toks[i + 1]))); i += 2
        elif cmd == 'C':
            p0 = cur[-1]; c1 = (float(toks[i]), float(toks[i + 1])); c2 = (float(toks[i + 2]), float(toks[i + 3])); p3 = (float(toks[i + 4]), float(toks[i + 5])); i += 6
            for k in range(1, 5):
                u = k / 4; a = (1 - u) ** 3; b = 3 * u * (1 - u) ** 2; c = 3 * u * u * (1 - u); e = u ** 3
                cur.append((a * p0[0] + b * c1[0] + c * c2[0] + e * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + e * p3[1]))
        else:
            i += 1
    return subs, closed
def paths(svg):
    s = open(svg).read(); s = s[s.find('</defs>'):]
    out = []
    for t in re.finditer(r'<path ([^>]*)/>', s):
        a = t.group(1); g = lambda k: (re.search(' ?' + k + r'="([^"]*)"', ' ' + a) or [None, None])[1]
        d = g('d')
        if not d: continue
        subs, closed = parse_d(d)
        tr = g('transform')
        if tr:
            m = [float(x) for x in re.findall(NUM, tr)]
            A, B, C, D, E, F = m
            subs = [[(A * x + C * y + E, B * x + D * y + F) for x, y in sp] for sp in subs]
        w = g('stroke-width')
        out.append(dict(stroke=col(g('stroke')), fill=col(g('fill')), w=float(w) if w else 0, subpaths=subs, closed=closed))
    return out
