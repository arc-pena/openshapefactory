# tbx.py <pdf> <pages> <region x0,y0,x1,y1 mm> <config.json> <out.json>
# A drawing set's title block, lifted from its PDF as a title block family: the lines and the words in the region
# (the strip or band), as they are on the first page given. Words that change from sheet to sheet become labels
# (Sheet Number, Sheet Name lines, Scale, Date); words equal to a project value in the config become labels of
# that field; the rest stays fixed text. Also returns each page's own values (number, name, scale, date).
import pymupdf, json, re, math, sys
from sheetspace import sheet_transform
SRC, PAGES, REG, CFG, OUT = sys.argv[1], [int(x) for x in sys.argv[2].split(",")], [float(v) for v in sys.argv[3].split(",")], json.load(open(sys.argv[4])), sys.argv[5]
K = 25.4 / 72
d = pymupdf.open(SRC)
inside = lambda x, y: REG[0] <= x <= REG[2] and REG[1] <= y <= REG[3]
def fontkind(name):
    n = name.lower()
    if "walsheim" in n or "circular" in n or "futura" in n: return "Futura"
    return "ArialBold" if "bold" in n else "Arial"
def texts(p):
    T = sheet_transform(p)[0]; out = []
    for bl in p.get_text("dict")["blocks"]:
        for l in bl.get("lines", []):
            sp = [s for s in l["spans"] if s["text"].strip()]
            if not sp: continue
            s0 = sp[0]; ox, oy = T(s0["origin"])
            b = l["bbox"]; c1 = T((b[0], b[1])); c2 = T((b[2], b[3])); cx, cy = (c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2
            if not inside(cx, cy): continue
            o0 = T((0, 0)); o1 = T(l["dir"]); rot = round(math.degrees(math.atan2(o1[1] - o0[1], o1[0] - o0[0])))
            out.append({"s": "".join(s["text"] for s in l["spans"]).strip(), "at": [round(ox, 2), round(oy, 2)], "h": round(s0["size"] * K * 0.7, 3), "rot": rot, "font": fontkind(s0["font"]),
                        "bb": [min(c1[0], c2[0]), min(c1[1], c2[1]), max(c1[0], c2[0]), max(c1[1], c2[1])], "w": round(abs(c2[0] - c1[0]) if rot in (0, 180) else abs(c2[1] - c1[1]), 2)})
    return out
def lines(p):
    T = sheet_transform(p)[0]; segs = []
    for dr in p.get_drawings():
        w = round(dr.get("width") or 0.1, 2)
        for it in dr["items"]:
            if it[0] == "l":
                a = list(T((it[1].x, it[1].y))); b = list(T((it[2].x, it[2].y)))
                if inside(*a) and inside(*b) and math.dist(a, b) > 0.3: segs.append([a, b, w])
            elif it[0] == "re":
                r = it[1]; qa = T((r.x0, r.y0)); qb = T((r.x1, r.y1)); x0, x1, y0, y1 = min(qa[0], qb[0]), max(qa[0], qb[0]), min(qa[1], qb[1]), max(qa[1], qb[1])
                if inside(x0, y0) and inside(x1, y1):
                    for a, b in (([x0, y0], [x1, y0]), ([x1, y0], [x1, y1]), ([x1, y1], [x0, y1]), ([x0, y1], [x0, y0])): segs.append([a, b, w])
    # merge collinear touching pieces, drop duplicates
    out = []
    for a, b, w in sorted(segs, key=lambda s: (round(s[0][1], 1), round(s[0][0], 1))):
        if any(abs(a[0] - q[0][0]) < 0.05 and abs(a[1] - q[0][1]) < 0.05 and abs(b[0] - q[1][0]) < 0.05 and abs(b[1] - q[1][1]) < 0.05 for q in out): continue
        out.append([a, b, w])
    return out
pages = {pg: texts(d[pg - 1]) for pg in PAGES}
first = PAGES[0]
SHEETNO = re.compile(r"^[A-Z]{1,2}-?\d{3,4}[A-Z]?$"); SCALE = re.compile(r"(=|^as noted$|^NTS$)", re.I); DATE = re.compile(r"^\d{1,2}[ ./]\d{1,2}[ ./]\d{2,4}$")
same = lambda t, u: abs(t["at"][0] - u["at"][0]) < 1.5 and abs(t["at"][1] - u["at"][1]) < 1.5 and t["rot"] == u["rot"]
# a word varies when some other page has a different word at its place (or none)
varying = []
for t in pages[first]:
    others = [next((u for u in pages[pg] if same(t, u)), None) for pg in PAGES[1:]]
    varying.append(any(o is None or o["s"] != t["s"] for o in others) or t["s"] in CFG.get("names", []) or bool(SCALE.search(t["s"])) or bool(SHEETNO.match(t["s"])))
proj = CFG.get("project", {})       # value -> field name
items = []
for a, b, w in lines(d[first - 1]): items.append({"k": "line", "pts": [[round(a[0], 2), round(a[1], 2)], [round(b[0], 2), round(b[1], 2)]], "w": w})
name_lines = []
for t, v in zip(pages[first], varying):
    base = {"at": t["at"], "h": t["h"], "font": t["font"], "room": round(t["w"] * 1.03, 2)}
    if t["rot"]: base["rot"] = t["rot"]
    if v:
        if SHEETNO.match(t["s"]): items.append(dict(base, k="label", field="Sheet Number"))
        elif SCALE.search(t["s"]): items.append(dict(base, k="label", field="Scale"))
        elif DATE.match(t["s"]): items.append(dict(base, k="label", field="Issue Date"))
        else: name_lines.append((t, base))
    elif t["s"] in proj:
        f = proj[t["s"]].split(":"); it = dict(base, k="label", field=f[0])
        if len(f) > 1: it["line"] = int(f[1])
        items.append(it)
    else: items.append(dict(base, k="text", text=t["s"]))
# the sheet's name, in reading order (down the strip for words turned 90: left to right)
name_lines.sort(key=lambda tb: (tb[0]["at"][0], -tb[0]["at"][1]) if tb[0]["rot"] else (-tb[0]["at"][1], tb[0]["at"][0]))
for i, (t, base) in enumerate(name_lines): items.append(dict(base, k="label", field="Sheet Name", line=i, room=CFG.get("nameRoom")))
per = {}
for pg in PAGES:
    vals = {"number": "", "name": [], "scale": "", "date": ""}
    for t in pages[pg]:
        if any(same(t, n[0]) for n in name_lines) or (not any(same(t, u) for u in pages[first])):
            if not SHEETNO.match(t["s"]) and not SCALE.search(t["s"]) and not DATE.match(t["s"]): vals["name"].append(t)
        if SHEETNO.match(t["s"]) and any(same(t, u) and SHEETNO.match(u["s"]) for u in pages[first]): vals["number"] = t["s"]
        if SCALE.search(t["s"]) and any(same(t, u) and SCALE.search(u["s"]) for u in pages[first]): vals["scale"] = t["s"]
        if DATE.match(t["s"]) and any(same(t, u) and DATE.match(u["s"]) for u in pages[first]): vals["date"] = t["s"]
    vals["name"] = "\n".join(t["s"] for t in sorted(vals["name"], key=lambda t: (t["at"][0], -t["at"][1]) if t["rot"] else (-t["at"][1], t["at"][0])))
    per[pg] = vals
W, H = 841.0, 594.0
fam = {"family": "titleblock", "name": CFG["name"], "space": "paper", "design": [round(W, 2), round(H, 2)], "hold": CFG.get("hold", "right"), "holdY": CFG.get("holdY", "bottom"),
       "viewTitles": "band", "scaleStyle": CFG.get("scaleStyle", "imperial"), "fields": [], "visibility": [], "items": items}
json.dump({"family": fam, "sheets": per}, open(OUT, "w"))
print(len(items), "items;", sum(1 for i in items if i["k"] == "label"), "labels")
for pg, v in per.items(): print(pg, v)
