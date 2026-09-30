import json
x=json.load(open('aia_x.json')); a=json.load(open('tbf_aia.json')); b=json.load(open('tbf_aiad.json'))
sheets={}
for pg,v in a['sheets'].items(): sheets[pg]=dict(v, tb="SY-TB-AIA")
for pg,v in b['sheets'].items(): sheets[pg]=dict(v, tb="SY-TB-AIAD")
pages={}
for pg,v in x.items():
  keep=lambda n: n['bb'][0] < 865
  pages[pg]={"size":v["size"],"notes":[n for n in v["notes"] if keep(n)],"dims":[n for n in v["dims"] if keep(n)],"bubbles":[n for n in v["bubbles"] if keep(n)]}
json.dump({"titleBlocks":{"SY-TB-AIA":a['family'],"SY-TB-AIAD":b['family']},"sheets":sheets,"pages":pages},open('fhaset_aia.json','w'))
# the detail sheets' drafting (dlift.py): batts as zones, the rest as linework, in hundredths of a mm, each polyline
# from its first point by steps
import os
def enc(v):
    q = [round(x * 100) for x in v]; return q[:2] + [q[i] - q[i - 2] for i in range(2, len(q))]
S = json.load(open('fhaset_aia.json'))
for pg, n in (("7", "A501"), ("8", "A502"), ("9", "A503")):
    if not os.path.exists(f'lift_{n}.json'): continue
    L = json.load(open(f'lift_{n}.json'))
    tiles = L.pop("__tiles", {})
    S["pages"][pg]["lift"] = {vid: {"b": r["batts"], "l": {w: [enc(p) for p in ps] for w, ps in r["lines"].items()}, "c": {w: [enc(p) for p in ps] for w, ps in r["curves"].items()},
                                    "f": [enc(f[:-1]) + [f[-1]] for f in r["fills"]], "h": [[h[0], h[1]] + [enc(lp) for lp in h[2:]] for h in r.get("hatches", [])]} for vid, r in L.items()}
    S.setdefault("tiles", {}).update(tiles)
json.dump(S, open('fhaset_aia.json', 'w'))
