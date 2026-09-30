# tbroom.py <pdf> <page> <tbf.json> : give each text and label of a lifted title block family the room its words
# take on the PDF (their line's length), so a wider font on screen shrinks to it instead of running into the next cell
import pymupdf, json, sys, math
SRC, PG, F = sys.argv[1], int(sys.argv[2]), sys.argv[3]
K = 25.4 / 72; p = pymupdf.open(SRC)[PG - 1]; H = p.rect.height
lines = []
for bl in p.get_text("dict")["blocks"]:
    for l in bl.get("lines", []):
        sp = [s for s in l["spans"] if s["text"].strip()]
        if not sp: continue
        o = sp[0]["origin"]; b = l["bbox"]; dx, dy = l["dir"]
        lines.append(((o[0] * K, (H - o[1]) * K), max(b[2] - b[0], b[3] - b[1]) * K if abs(dx) < 0.5 else (b[2] - b[0]) * K))
d = json.load(open(F)); n = 0
for it in d["family"]["items"]:
    if it["k"] not in ("text", "label"): continue
    m = min(lines, key=lambda L: math.dist(L[0], it["at"]))
    if math.dist(m[0], it["at"]) < 0.5 and not it.get("room"): it["room"] = round(m[1] * 1.03, 2); n += 1
json.dump(d, open(F, "w")); print(F, n, "rooms")
