# fhax.py <pdf> <out.json> [pages]  - a drawing set's annotation, lifted from its PDF: every text block (lines of one
# size stacked and aligned, as the drafter set them) with its baseline position, cap height, font, rotation,
# alignment and line spacing; its leader (start, elbows, end, arrowhead or dot); dimension strings with their
# dimension line and witness lines; spot elevations; texts inside circles (bubbles: grid heads, view titles, keynotes).
# Paper mm, origin bottom-left.
import pymupdf, json, re, math, sys
from sheetspace import sheet_transform
SRC, OUT = sys.argv[1], sys.argv[2]
PAGES = [int(x) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 else None
K = 25.4 / 72
DIM = re.compile(r"""^\d{2,6}$""")   # metric: dimension strings are whole millimetres
d = pymupdf.open(SRC)
def fontkind(name):
    n = name.lower()
    if "futura" in n or "century" in n or "avant" in n: return "Futura"
    if "bold" in n: return "ArialBold"
    return "Arial"
out = {}
for pg in range(len(d)):
    if PAGES and pg + 1 not in PAGES: continue
    p = d[pg]; TF, SW, SH, VIS = sheet_transform(p)
    T = lambda x, y: TF((x, y))
    spans = []
    for bl in p.get_text("rawdict")["blocks"]:
        for l in bl.get("lines", []):
            for s_ in l["spans"]: s_["text"] = "".join(c["c"] for c in s_["chars"])
            o0 = T(0, 0); o1 = T(l["dir"][0], l["dir"][1]); rot = round(math.degrees(math.atan2(o1[1] - o0[1], o1[0] - o0[0])))
            sp = [s for s in l["spans"] if s["text"].strip()]
            if not sp: continue
            # a line of mixed sizes (a view title: its reference small, its name large) is as many texts as sizes
            runs = [[sp[0]]]
            for s_ in sp[1:]:
                if abs(s_["size"] - runs[-1][-1]["size"]) > 0.3 * runs[-1][-1]["size"]: runs.append([s_])
                else: runs[-1].append(s_)
            for run in runs:
                text = "".join(s_["text"] for s_ in run).strip()
                s0 = run[0]; b = [min(s_["bbox"][0] for s_ in run), min(s_["bbox"][1] for s_ in run), max(s_["bbox"][2] for s_ in run), max(s_["bbox"][3] for s_ in run)] if len(runs) > 1 else l["bbox"]
                # the first letter's own origin (a span's origin can sit on a space, or off the baseline)
                ch = next((c for s_ in run for c in s_["chars"] if c["c"].strip()), None)
                og = T(*ch["origin"]) if ch else T(*s0["origin"])
                c1 = T(b[0], b[1]); c2 = T(b[2], b[3])
                spans.append({"s": text, "ox": og[0], "oy": og[1], "x0": min(c1[0], c2[0]), "x1": max(c1[0], c2[0]), "y0": min(c1[1], c2[1]), "y1": max(c1[1], c2[1]),
                              "size": s0["size"] * K, "rot": rot, "font": fontkind(s0["font"]), "flags": s0["flags"]})
    segs, fills, circles, tris = [], [], [], []
    for dr in p.get_drawings():
        w = dr.get("width") or 0
        items = dr["items"]
        if dr["type"] in ("f", "fs") and len(items) <= 4:
            r = dr["rect"]; c = T((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2); fills.append((c[0], c[1], max(r.width, r.height) * K))
        if dr["type"] in ("f", "fs") and len(items) <= 8 and max(dr["rect"].width, dr["rect"].height) * K < 4:
            tris.append([T(it[1].x, it[1].y) for it in items if it[0] == "l"] + [T(it[2].x, it[2].y) for it in items if it[0] == "l"])
        cs = [it for it in items if it[0] == "c"]
        if len(cs) >= 4 and len(cs) == len(items):
            r = dr["rect"]
            if abs(r.width - r.height) < 0.08 * r.width: c = T((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2); circles.append((c[0], c[1], r.width / 2 * K))
        for it in items:
            if it[0] == "l": segs.append((T(it[1].x, it[1].y), T(it[2].x, it[2].y), w))
    # blocks: lines of one size and rotation, stacked (baselines a steady step apart), aligned left, right or centred
    used = set(); blocks = []
    order = sorted(range(len(spans)), key=lambda i: (spans[i]["rot"], -spans[i]["oy"], spans[i]["ox"]))
    for i in order:
        if i in used: continue
        a = spans[i]; blk = [a]; used.add(i)
        if a["rot"] == 0:
            while True:
                last = blk[-1]; nxt = None
                for j in order:
                    if j in used: continue
                    b = spans[j]
                    if b["rot"] != 0 or abs(b["size"] - last["size"]) > 0.05 or b["font"] != last["font"]: continue
                    step = last["oy"] - b["oy"]
                    if not (last["size"] * 0.9 < step < last["size"] * 1.9): continue
                    if len(blk) >= 2 and abs(step - (blk[-2]["oy"] - last["oy"])) > 0.3: continue
                    if abs(b["x0"] - last["x0"]) < 1.2 or abs(b["x1"] - last["x1"]) < 1.2 or abs((b["x0"] + b["x1"]) / 2 - (last["x0"] + last["x1"]) / 2) < 1.2: nxt = j; break
                if nxt is None: break
                blk.append(spans[nxt]); used.add(nxt)
        blocks.append(blk)
    res = {"size": [SW, SH], "visible": VIS, "notes": [], "dims": [], "bubbles": []}
    near = lambda p, q, t: abs(p[0] - q[0]) < t and abs(p[1] - q[1]) < t
    for blk in blocks:
        a = blk[0]; text = "\n".join(l["s"] for l in blk)
        x0 = min(l["x0"] for l in blk); x1 = max(l["x1"] for l in blk); y0 = min(l["y0"] for l in blk); y1 = max(l["y1"] for l in blk)
        if len(blk) > 1:
            if max(l["x0"] for l in blk) - x0 < 1.2: align = "left"
            elif x1 - min(l["x1"] for l in blk) < 1.2: align = "right"
            else: align = "centre"
        else: align = "left"
        ls = round((blk[0]["oy"] - blk[-1]["oy"]) / (len(blk) - 1), 3) if len(blk) > 1 else None
        cap = a["size"] * 0.7
        if align == "left": at = [a["ox"], a["oy"]]
        elif align == "right": at = [a["x1"], a["oy"]]
        else: at = [(a["x0"] + a["x1"]) / 2, a["oy"]]
        if a["rot"] == 90: at = [a["ox"], a["oy"]]
        item = {"t": text, "at": [round(at[0], 2), round(at[1], 2)], "h": round(cap, 3), "font": a["font"], "rot": a["rot"], "bb": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)]}
        if align != "left": item["align"] = align
        if ls: item["ls"] = ls
        # a bubble: a short text centred in a circle
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        circ = [c for c in circles if math.hypot(c[0] - cx, c[1] - cy) < c[2] * 0.75 and c[2] > (x1 - x0) / 2 * 0.9 and c[2] < 12]
        if circ and len(text) <= 16:
            c = min(circ, key=lambda c: c[2]); item["circle"] = [round(c[0], 2), round(c[1], 2), round(c[2], 2)]; res["bubbles"].append(item); continue
        if len(blk) == 1 and DIM.match(text.replace("’", "'").replace("”", '"')):
            # its dimension line: the thin line nearest under (or beside, rotated) the text, spanning across it
            best = None; vert = a["rot"] != 0
            for (P, Q, w) in segs:
                if vert:
                    if abs(P[0] - Q[0]) > 0.2: continue
                    lo, hi = sorted((P[1], Q[1])); dd = abs(P[0] - x1) if P[0] > cx else abs(x0 - P[0])
                    if lo - 0.5 <= cy <= hi + 0.5 and dd < 3 and (not best or dd < best[0]): best = (dd, [P, Q])
                else:
                    if abs(P[1] - Q[1]) > 0.2: continue
                    lo, hi = sorted((P[0], Q[0])); dd = y0 - P[1]
                    if lo - 0.5 <= cx <= hi + 0.5 and -1.0 < dd < 3 and (not best or dd < best[0]): best = (dd, [P, Q])
            if best:
                # the dimension line runs on past its ticks and its text: follow it through every collinear piece that touches it
                A, B2 = list(best[1][0]), list(best[1][1]); ax = 1 if vert else 0; co = 0 if vert else 1
                lo, hi = sorted((A[ax], B2[ax])); c0 = A[co]; grown = True
                while grown:
                    grown = False
                    for (P, Q, w) in segs:
                        if abs(P[co] - c0) > 0.1 or abs(Q[co] - c0) > 0.1: continue
                        a2, b2 = sorted((P[ax], Q[ax]))
                        if a2 < lo - 0.01 and b2 >= lo - 0.3: lo = a2; grown = True
                        if b2 > hi + 0.01 and a2 <= hi + 0.3: hi = b2; grown = True
                # an arrowhead at an end (its base on the line's end): its tip is where the dimension measures to
                lo0, hi0 = lo, hi
                for tri in tris:
                    if not tri: continue
                    on = [q for q in tri if abs(q[co] - c0) < 0.08]
                    if not on: continue
                    ends = [q[ax] for q in on]
                    vs = [q[ax] for q in tri]
                    if any(abs(e - lo0) < 0.15 for e in vs) and min(vs) < lo0 - 0.3: lo = min(lo, min(vs))
                    if any(abs(e - hi0) < 0.15 for e in vs) and max(vs) > hi0 + 0.3: hi = max(hi, max(vs))
                item["line"] = [[round(c0, 2), round(lo, 2)], [round(c0, 2), round(hi, 2)]] if vert else [[round(lo, 2), round(c0, 2)], [round(hi, 2), round(c0, 2)]]
            res["dims"].append(item); continue
        # a leader: a thin line starting beside the block (either end, within its height), followed through its elbows
        lead = None
        for (P, Q, w) in segs:
            if w > 0.4: continue
            for S, E in ((P, Q), (Q, P)):
                if y0 - 1.5 <= S[1] <= y1 + 1.5 and (-1.5 <= S[0] - x1 <= 4 or -1.5 <= x0 - S[0] <= 4) and math.dist(S, E) > 2.5:
                    sc = abs(S[1] - (y0 + y1) / 2) + (0 if abs(E[1] - S[1]) < 0.2 or abs(E[0] - S[0]) > 0.5 else 1)
                    if not lead or sc < lead[0]: lead = (sc, [S, E])
        if lead and a["rot"] == 0:
            pts = list(lead[1])
            for _ in range(5):
                end = pts[-1]; nxt = None
                for (P, Q, w) in segs:
                    if w > 0.4: continue
                    for S, E in ((P, Q), (Q, P)):
                        if near(S, end, 0.25) and not near(E, pts[-2], 0.5) and math.dist(S, E) > 1 and not any(near(E, q, 0.3) for q in pts): nxt = E
                if nxt is None: break
                pts.append(nxt)
            tip = pts[-1]
            # an outline round the words (a room tag's oblong, a box) is not a leader: it comes back to them
            if x0 - 4 <= tip[0] <= x1 + 4 and y0 - 4 <= tip[1] <= y1 + 4 and len(pts) > 2: lead = None
        if lead and a["rot"] == 0:
            arrow = [f for f in fills if math.hypot(f[0] - tip[0], f[1] - tip[1]) < 2.2 and f[2] < 4]
            dots = [c for c in circles if math.hypot(c[0] - tip[0], c[1] - tip[1]) < 1.0 and c[2] < 1.2]
            item["leader"] = [[round(v, 2) for v in q] for q in pts]
            item["end"] = "arrow" if arrow else "dot" if dots else "none"
            item["side"] = "right" if abs(pts[0][0] - x1) < abs(pts[0][0] - x0) else "left"
        res["notes"].append(item)
    out[str(pg + 1)] = res
    print(pg + 1, "notes", len(res["notes"]), "leaders", sum(1 for n in res["notes"] if "leader" in n), "dims", len(res["dims"]), "with lines", sum(1 for x in res["dims"] if "line" in x), "bubbles", len(res["bubbles"]))
json.dump(out, open(OUT, "w"))
