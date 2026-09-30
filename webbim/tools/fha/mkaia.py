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
