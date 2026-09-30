# mkset.py : the set's data for the builder - the Techne title block family, each page's sheet (number, name, scale,
# who drew it; the drawing list supplies what a cut-off page does not show) and its lifted annotation
import json
x = json.load(open('../data/wl_x.json')); tb = json.load(open('../data/tb_techne.json'))
LIST = ["A0000 LOCATION PLAN / DRAWING LIST", "A0001 GENERAL NOTES", "A0010 SITE PLAN", "A0020 GRID SETOUT", "A0050 WETLAP BUILDING DEMOLITION PLANS",
  "A0055 WETLAP BUILDING DEMOLITION ELEVATIONS", "A0099 APARTMENT BASEMENT GA PLAN", "A0100 APARTMENT GROUND LEVEL GA PLAN", "A0101 APARTMENT LEVEL 1 GA PLAN",
  "A0102 APARTMENT LEVEL 2 GA PLAN", "A0103 APARTMENT LEVEL 3 GA PLAN", "A0104 APARTMENT LEVEL 4 GA PLAN", "A0105 APARTMENT ROOFTOP GA PLAN",
  "A0149 LOFT BASEMENT GA PLAN", "A0150 LOFT GROUND LEVEL GA PLAN", "A0151 LOFT LEVEL 1 GA PLAN", "A0152 LOFT LEVEL 2 GA PLAN", "A0153 LOFT LEVEL 3 GA PLAN",
  "A0154 LOFT TERRACE GA PLAN", "A0200 APARTMENT GROUND LEVEL CONCRETE SETOUT PLAN", "A0201 APARTMENT LEVEL 1 CONCRETE SETOUT PLAN",
  "A0299 APARTMENT BASEMENT WALL SETOUT PLAN", "A0300 APARTMENT GROUND LEVEL WALL SETOUT PLAN", "A0301 APARTMENT LEVEL 1 WALL SETOUT PLAN",
  "A0599 APARTMENT BASEMENT RCP", "A0600 APARTMENT GROUND LEVEL RCP", "A0601 APARTMENT LEVEL 1 RCP", "A0602 APARTMENT LEVEL 2 RCP", "A0603 APARTMENT LEVEL 3 RCP",
  "A0604 APARTMENT LEVEL 4 RCP", "A0649 LOFT BASEMENT RCP", "A0650 LOFT GROUND LEVEL RCP", "A0651 LOFT LEVEL 1 RCP", "A0652 LOFT LEVEL 2 RCP", "A0653 LOFT LEVEL 3 RCP",
  "A0800 APARTMENT BUILDING ELEVATIONS", "A0801 APARTMENT BUILDING ELEVATIONS", "A0850 LOFT BUILDING ELEVATIONS"]
fam = tb["family"]
# the strip's own words that change from sheet to sheet: the sheet number (lifted), who drafted it (a label), the
# sheet's name and scale over the strip (right-aligned name, the scale after it)
for it in fam["items"]:
    if it.get("k") == "label" and it.get("field") == "Sheet Name": it["field"] = "Drawn By"; it.pop("line", None); it.pop("room", None)
    if it.get("k") == "text" and it.get("text") == "25/03/2021" and abs(it["at"][0] - 693.86) < 1: it.update(k="label", field="Issue Date"); it.pop("text")
fam["items"] += [{"k": "label", "field": "Sheet Name", "at": [759.0, 55.68], "h": 7.546, "font": "Arial", "align": "right", "room": 330},
                 {"k": "label", "field": "Scale", "at": [785.13, 55.68], "h": 7.546, "font": "Arial"},
                 {"k": "circle", "c": [730.6, 25.2], "r": 5.3, "w": 0.18}]
fam["scaleStyle"] = "band"; fam["viewTitles"] = "techne"
sheets = {}
for i, s in enumerate(LIST):
    pg = str(i + 1); num, name = s.split(" ", 1); v = tb["sheets"].get(pg) or tb["sheets"].get(i + 1) or {}
    sheets[pg] = {"number": num, "name": name, "scale": "", "date": "25/03/2021", "tb": "SY-TB-TECHNE", "drawn": (v.get("name") or "").split("\n")[-1] if v else ""}
pages = {}
for pg, v in x.items():
    keep = lambda n: n["bb"][1] > 48 and not (n["bb"][0] > 560 and n["bb"][1] < 70 and n["h"] > 7)   # the strip and the sheet's title are the family's
    pages[pg] = {"size": v["size"], "visible": v["visible"], "notes": [n for n in v["notes"] if keep(n)], "dims": [n for n in v["dims"] if keep(n)], "bubbles": [n for n in v["bubbles"] if keep(n)]}
json.dump({"titleBlocks": {"SY-TB-TECHNE": fam}, "sheets": sheets, "pages": pages}, open('../data/wetlap_set.json', 'w'))
print(len(pages), "pages;", sum(len(p["notes"]) for p in pages.values()), "notes")
