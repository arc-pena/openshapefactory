# The CAD goodies blocks as a symbol library: a name read off the block's name (its coded prefix) or, where the
# name says nothing, off what it looks like (reviewed sheet by sheet); a category and a view; a true size.
import json, re, math
B = json.load(open("blocks.json"))

VEH = {"bus": "Bus", "car": "Car", "van": "Van", "trk": "Truck", "rus": "Bus", "rtr": "Truck", "rva": "Van"}
VIEW = {"e": "Side elevation", "f": "Front elevation", "p": "Plan", "r": "Rear elevation", "s": "Section"}

def two(n):
    """02/08/12/13/14/17-series (a manufacturer's coded set): 2 digits, a view letter, a code."""
    m = re.match(r"^(\d\d)([a-z])([a-z]+?)(\d+)$", n)
    if not m: return None
    grp, v, code, num = m.groups(); vw = VIEW.get(v, "Plan")
    c = {
        "bus": ("Vehicles", "Bus"), "car": ("Vehicles", "Car"), "van": ("Vehicles", "Van"), "trk": ("Vehicles", "Truck and trailer"),
        "tre": ("Planting", "Tree"), "man": ("People", "Person"), "phb": ("Site furniture", "Telephone booth"), "phs": ("Site furniture", "Wall telephone"),
        "stl": ("Site furniture", "Street light"), "utb": ("Site furniture", "Umbrella table"), "pvc": ("Sports and site", "Court / field"),
        "phc": ("Accessibility", "Accessibility symbol"), "plc": ("Site furniture", "Picnic table"), "par": ("Annotation", "Pavement arrow"),
        "ptr": ("Planting", "Tree grate / planter"), "rtr": ("Vehicles", "Truck"), "rva": ("Vehicles", "Van"), "rus": ("Vehicles", "Bus"), "rca": ("Vehicles", "Car"),
        "fdr": ("Doors and windows", "Flush door"), "gdr": ("Doors and windows", "Glazed door"), "sgd": ("Doors and windows", "Sliding glass door"),
        "wdr": ("Doors and windows", "Wood panel door"), "hcc": ("Accessibility", "Wheelchair"), "hcp": ("Accessibility", "Accessible toilet room"),
        "elv": ("Doors and windows", "Elevator door"), "esc": ("Sports and site", "Escalator"),
        "hcs": ("Accessibility", "International symbol of access"), "lch": ("Site furniture", "Lounge chair"),
    }.get(code)
    if code == "cvc":
        courts = {"01": "American football field", "02": "Running track", "03": "Soccer field", "04": "Baseball diamond", "05": "Baseball diamond",
                  "06": "Softball diamond", "07": "Basketball court", "08": "Basketball court", "09": "Ice hockey rink", "10": "Tennis court",
                  "11": "Volleyball court", "12": "Badminton court", "13": "Badminton court", "16": "Lacrosse field", "20": "Shuffleboard court", "21": "Tennis court"}
        return ("Sports and site", courts.get(num, "Court"), "Plan", num)
    if code == "wdr" and v == "z": return ("Doors and windows", "Door swing", "Plan", num)
    if code == "hcp" and v == "s": return ("Accessibility", "Wheelchair clearance", "Elevation", num)
    if not c: return None
    cat, noun = c
    if grp == "02" and v == "r": vw = "Rear elevation"
    return (cat, noun, vw, num)

LC_CODE = {"tr": ("Planting", "Tree"), "sh": ("Planting", "Shrub / plant"), "mn": ("People", "Man"), "wm": ("People", "Woman"), "ch": ("People", "Child"),
           "au": ("Vehicles", "Car"), "bt": ("Vehicles", "Boat"), "ac": ("Vehicles", "Aircraft"), "sf": ("Site furniture", "Site furniture"),
           "po": ("Sports and site", "Swimming pool"), "pe": ("People", "Person")}

# names read off the drawings for everything else: (category, name, view)
NAMED = [
    (r"^12-\dslop$", ("Annotation", "Slope symbol", "Section")), (r"^14eelv", ("Doors and windows", "Elevator doors", "Front elevation")),
    (r"^14pesc", ("Sports and site", "Escalator", "Plan")), (r"^14sesc", ("Sports and site", "Escalator", "Section")),
    (r"^17screen$", ("Office", "Projector", "Plan")), (r"^24l8$", ("Doors and windows", "Door swing, left 24\"", "Plan")),
    (r"^24r4$", ("Doors and windows", "Door swing, right 24\"", "Plan")), (r"^72r4$", ("Doors and windows", "Double door swing 72\"", "Plan")),
    (r"^2XTP$", ("Plumbing and bath", "Toilet paper holder, double", "Plan")), (r"^42gbar$", ("Accessibility", "Grab bar 42\"", "Plan")),
    (r"^A\$C14122515$", ("People", "Group of cars and people", "Plan")), (r"^A-P1", ("Furniture", "Bed 160x180 with nightstands", "Plan")),
    (r"^A18104$", ("Furniture", "Armchair", "Plan")), (r"^Achair$", ("Furniture", "Armchair", "Plan")), (r"^AF13A$", ("Furniture", "Round table and chairs", "Plan")),
    (r"^Anglsect$", ("Furniture", "Angled sectional sofa", "Plan")), (r"^Arr2way$", ("Annotation", "Two-way arrow", "Plan")),
    (r"^Arrow", ("Annotation", "Arrow", "Plan")), (r"^Arrs", ("Annotation", "Arrow", "Plan")), (r"^Barsc", ("Annotation", "Bar scale", "Plan")),
    (r"^Barsink$", ("Kitchen and appliances", "Bar sink", "Plan")), (r"^Bed$", ("Furniture", "Bed", "Plan")), (r"^Bedelev$", ("Furniture", "Hospital bed", "Side elevation")),
    (r"^Bell206l$", ("Vehicles", "Helicopter, Bell 206L", "Side elevation")), (r"^bench$", ("Site furniture", "Bench", "Plan")),
    (r"^Betty$|^Fran$|^Mary$", ("People", "Woman standing", "Front elevation")), (r"^Bob$|^Mike$", ("People", "Man standing", "Front elevation")),
    (r"^Bidet$", ("Plumbing and bath", "Bidet", "Plan")), (r"^Break$", ("Annotation", "Break line", "Plan")), (r"^cafe$", ("Furniture", "Cafe table and chairs", "Plan")),
    (r"^Ch\d|^Chr\d|^Cr\d|^Chair\d", ("Furniture", "Chair", "Plan")), (r"^Chest", ("Furniture", "Chest of drawers", "Plan")),
    (r"^Cody\d", ("Furniture", "Sectional sofa module", "Plan")), (r"^Coffee", ("Furniture", "Coffee table", "Plan")),
    (r"^Concblk$", ("Construction", "Concrete block, section", "Section")), (r"^Cooktop$|^Gascktop$|^Gscktop6$|^KSTOVE$", ("Kitchen and appliances", "Cooktop", "Plan")),
    (r"^Copier", ("Office", "Copier", "Plan")), (r"^Cornsink$", ("Kitchen and appliances", "Corner sink", "Plan")), (r"^Couch$|^Loveseat$", ("Furniture", "Sofa", "Plan")),
    (r"^Credenza$", ("Furniture", "Credenza", "Plan")), (r"^Crib$", ("Furniture", "Crib", "Plan")), (r"^CROSS$", ("Annotation", "Cross", "Plan")),
    (r"^Crowd$", ("People", "Crowd", "Front elevation")), (r"^Curvsect$", ("Furniture", "Curved sectional sofa", "Plan")), (r"^D1000$", ("Doors and windows", "Door swing 1000", "Plan")),
    (r"^Dblbed$", ("Furniture", "Double bed", "Plan")), (r"^Dblsink$", ("Kitchen and appliances", "Double sink", "Plan")), (r"^Desk", ("Office", "Desk", "Plan")),
    (r"^Dfsel1$", ("Kitchen and appliances", "Dryer", "Front elevation")), (r"^Dfsel2$", ("Kitchen and appliances", "Dryer", "Side elevation")),
    (r"^Dining\d", ("Furniture", "Dining table and chairs", "Plan")), (r"^DKARM$", ("Annotation", "Door arm lines", "Plan")),
    (r"^Door\d+e$", ("Doors and windows", "Door", "Front elevation")), (r"^Doord\d+e$", ("Doors and windows", "Double door", "Front elevation")),
    (r"^Dresser", ("Furniture", "Dresser", "Front elevation")), (r"^Drinkf$", ("Plumbing and bath", "Drinking fountain", "Plan")),
    (r"^Drinkft$|^Ewc$", ("Plumbing and bath", "Water cooler", "Plan")), (r"^Drinkftn$", ("Plumbing and bath", "Drinking fountain", "Front elevation")),
    (r"^Drsink$", ("Plumbing and bath", "Service sink", "Front elevation")), (r"^Dryer$", ("Kitchen and appliances", "Dryer", "Plan")),
    (r"^Dwfsel1$", ("Kitchen and appliances", "Dishwasher", "Front elevation")), (r"^Dwfsel2$", ("Kitchen and appliances", "Dishwasher", "Side elevation")),
    (r"^E-fl|^Elfl", ("Electrical and MEP", "Fluorescent light", "Plan")), (r"^E-exit|^EXIT1$", ("Electrical and MEP", "Exit sign", "Plan")),
    (r"^E-", ("Electrical and MEP", "Electrical symbol", "Plan")), (r"^ELECDISC$", ("Electrical and MEP", "Disconnect switch", "Plan")),
    (r"^E\d{7}$", ("Plumbing and bath", "Fixture", "Front elevation")), (r"^P\d{7}$", ("Plumbing and bath", "Fixture", "Plan")), (r"^S\d{7}$", ("Plumbing and bath", "Fixture", "Side elevation")),
    (r"^Elm$", ("Electrical and MEP", "Floor outlet", "Plan")), (r"^FAN-FRWN$", ("Planting", "Palm fronds", "Front elevation")),
    (r"^Fe$", ("Electrical and MEP", "Fire extinguisher", "Front elevation")), (r"^Filecab$|^Lfilecab$|^Vfilecab$", ("Office", "File cabinet", "Plan")),
    (r"^fire truck_front", ("Vehicles", "Fire truck", "Front elevation")), (r"^fire truck_side", ("Vehicles", "Fire truck", "Side elevation")), (r"^fire truck_top", ("Vehicles", "Fire truck", "Plan")),
    (r"^Fmtltel1$", ("Plumbing and bath", "Toilet, floor mounted", "Front elevation")), (r"^Fmtltel2$", ("Plumbing and bath", "Toilet, floor mounted", "Side elevation")),
    (r"^Fmurnel1$", ("Plumbing and bath", "Urinal, floor mounted", "Front elevation")), (r"^Fmurnel2$", ("Plumbing and bath", "Urinal, floor mounted", "Side elevation")),
    (r"^Fncomp$", ("Office", "Computer workstation", "Front elevation")), (r"^Fnphone$", ("Office", "Telephone", "Front elevation")),
    (r"^Fttltel1$", ("Plumbing and bath", "Toilet, flush tank", "Front elevation")), (r"^Fttltel2$", ("Plumbing and bath", "Toilet, flush tank", "Side elevation")),
    (r"^Full$", ("Furniture", "Full bed", "Plan")), (r"^Grill$", ("Kitchen and appliances", "Grill", "Plan")), (r"^Hedge$", ("Planting", "Hedge", "Front elevation")),
    (r"^Hvac-ret$", ("Electrical and MEP", "Return air grille", "Plan")), (r"^Hvac$", ("Electrical and MEP", "Supply diffuser", "Plan")),
    (r"^IBMAT$", ("Office", "Computer", "Plan")), (r"^KDW18$", ("Kitchen and appliances", "Dishwasher 18\"", "Plan")), (r"^KEYBOARD$", ("Office", "Keyboard", "Plan")),
    (r"^King$|^Kingbed$", ("Furniture", "King bed", "Plan")), (r"^Kitnet84$", ("Kitchen and appliances", "Kitchenette 84\"", "Front elevation")),
    (r"^Klingon", ("Fun", "Starship", "Plan")), (r"^Kohlrtub$", ("Plumbing and bath", "Whirlpool tub", "Plan")), (r"^KREF28$", ("Kitchen and appliances", "Refrigerator 28\"", "Plan")),
    (r"^KSINK$", ("Kitchen and appliances", "Sink", "Plan")), (r"^L-ahu$", ("Electrical and MEP", "Air handler", "Plan")), (r"^L-comp$", ("Electrical and MEP", "Condenser", "Plan")),
    (r"^L-dbsink$", ("Kitchen and appliances", "Double sink", "Plan")), (r"^L-dryer$", ("Kitchen and appliances", "Dryer", "Plan")), (r"^L-dw$", ("Kitchen and appliances", "Dishwasher", "Plan")),
    (r"^L-lt$", ("Plumbing and bath", "Laundry tub", "Plan")), (r"^L-pump$", ("Electrical and MEP", "Pump", "Plan")), (r"^L-ref$", ("Kitchen and appliances", "Refrigerator", "Plan")),
    (r"^L-sink$", ("Plumbing and bath", "Lavatory", "Plan")), (r"^L-tub$", ("Plumbing and bath", "Tub", "Plan")), (r"^L-washer$|^Washer$", ("Kitchen and appliances", "Washer", "Plan")),
    (r"^L-wc$|^Wc1$", ("Plumbing and bath", "Toilet", "Plan")), (r"^L1$|^L3$", ("Planting", "Leaves", "Plan")), (r"^Ladysit1$", ("People", "Woman sitting", "Front elevation")),
    (r"^Lavpl$", ("Plumbing and bath", "Double lavatory counter", "Plan")), (r"^Lchair$|^Schair$", ("Furniture", "Chair", "Plan")),
    (r"^Living\d", ("Furniture", "Living room group", "Plan")), (r"^Mansit", ("People", "Man sitting", "Front elevation")), (r"^Mechdoor$", ("Doors and windows", "Louvered double door", "Front elevation")),
    (r"^Mopsink$", ("Plumbing and bath", "Mop sink", "Plan")), (r"^Mtlstud$", ("Construction", "Metal stud, section", "Section")),
    (r"^Naw$|^North|^NBCORE", ("Annotation", "North arrow", "Plan")), (r"^Nstand$", ("Furniture", "Nightstand", "Plan")), (r"^Outlet$|^Quad$", ("Electrical and MEP", "Outlet", "Plan")),
    (r"^Ovalsink$|^Sink$|^Sglsink$", ("Plumbing and bath", "Lavatory", "Plan")), (r"^Palm", ("Planting", "Palm", "Plan")), (r"^panton chair$|^silla", ("Furniture", "Chair", "Plan")),
    (r"^Pdlav$", ("Plumbing and bath", "Pedestal lavatory", "Plan")), (r"^PE_M", ("People", "Man sitting", "Side elevation")), (r"^PE_W", ("People", "Woman sitting", "Side elevation")),
    (r"^Pedsinkf$", ("Plumbing and bath", "Pedestal sink", "Front elevation")), (r"^People\d", ("People", "People", "Front elevation")), (r"^Piano$", ("Furniture", "Grand piano", "Plan")),
    (r"^Pianopln$", ("Furniture", "Grand piano and bench", "Plan")), (r"^Plant\d", ("Planting", "Plant", "Plan")), (r"^Poolpump$", ("Sports and site", "Pool pump", "Plan")),
    (r"^Pooltbl$", ("Furniture", "Pool table", "Plan")), (r"^Queen", ("Furniture", "Queen bed", "Plan")), (r"^Range$|^Stove$", ("Kitchen and appliances", "Range", "Plan")),
    (r"^Ref\d|^Refrig", ("Kitchen and appliances", "Refrigerator", "Plan")), (r"^Rfsel1$", ("Kitchen and appliances", "Refrigerator", "Front elevation")),
    (r"^Rfsel2$", ("Kitchen and appliances", "Refrigerator", "Side elevation")), (r"^Roche", ("Furniture", "Sofa", "Plan")),
    (r"^SEAMLESS_CHAISE$", ("Furniture", "Chaise longue", "Plan")), (r"^Sect\d$", ("Furniture", "Sectional sofa corner", "Plan")), (r"^Sectail$|^Section$", ("Annotation", "Section marker", "Plan")),
    (r"^Sdesk$", ("Office", "Desk", "Plan")), (r"^Sf\d|^Sfa\d|^Sof\d|^Sofa\d|^sofa1$", ("Furniture", "Sofa", "Plan")), (r"^Showstf$", ("Plumbing and bath", "Shower stall", "Front elevation")),
    (r"^Showstpl$", ("Plumbing and bath", "Shower stall", "Plan")), (r"^Showsts$", ("Plumbing and bath", "Shower stall", "Side elevation")), (r"^SHWHEADF$", ("Plumbing and bath", "Shower head", "Front elevation")),
    (r"^Singlbed$|^Twin$", ("Furniture", "Single bed", "Plan")), (r"^Sinkfr?n?m?k$|^Sinktrip$", ("Kitchen and appliances", "Kitchen sink", "Plan")),
    (r"^Sprnpump$", ("Electrical and MEP", "Sprinkler pump", "Front elevation")), (r"^Stretchr$", ("Furniture", "Stretcher", "Plan")), (r"^Switch$|^Telout$", ("Electrical and MEP", "Switch / outlet", "Plan")),
    (r"^Table\d$", ("Furniture", "Table", "Plan")), (r"^Tbl-conf$", ("Office", "Conference table", "Plan")), (r"^Tbl-lun$", ("Furniture", "Lunch table and chairs", "Plan")),
    (r"^Tcfsel1$", ("Kitchen and appliances", "Trash compactor", "Front elevation")), (r"^Tcfsel2$", ("Kitchen and appliances", "Trash compactor", "Side elevation")),
    (r"^To\dfel$", ("Plumbing and bath", "Toilet", "Front elevation")), (r"^T[oO0]\d[lr]sel$|^TO1LSEL$", ("Plumbing and bath", "Toilet", "Side elevation")),
    (r"^To\dpl$", ("Plumbing and bath", "Toilet", "Plan")), (r"^Tree\d", ("Planting", "Tree", "Plan")), (r"^Treeel", ("Planting", "Palm", "Front elevation")),
    (r"^Tub", ("Plumbing and bath", "Bathtub", "Plan")), (r"^Tv$", ("Furniture", "Television", "Plan")), (r"^Typstall$", ("Plumbing and bath", "Toilet stall", "Front elevation")),
    (r"^Typstpl$", ("Plumbing and bath", "Toilet stalls", "Plan")), (r"^Typurin$", ("Plumbing and bath", "Urinals with screen", "Front elevation")),
    (r"^Ur$|^URN$", ("Plumbing and bath", "Urinal", "Plan")), (r"^URINF$|^Urinal1$", ("Plumbing and bath", "Urinal", "Front elevation")), (r"^URINFHC$", ("Accessibility", "Accessible urinal", "Front elevation")),
    (r"^Vanfmel1$", ("Plumbing and bath", "Vanity", "Front elevation")), (r"^Vanwhel1$", ("Plumbing and bath", "Vanity, wall hung", "Front elevation")), (r"^Vanwhel2$", ("Plumbing and bath", "Vanity, wall hung", "Side elevation")),
    (r"^VDU-E$", ("Office", "Computer monitor", "Side elevation")), (r"^Washm$", ("Kitchen and appliances", "Washer", "Front elevation")),
    (r"^Wfsel1$", ("Kitchen and appliances", "Washer", "Front elevation")), (r"^Wfsel2$", ("Kitchen and appliances", "Washer", "Side elevation")),
    (r"^Whtltel1$", ("Plumbing and bath", "Toilet, wall hung", "Front elevation")), (r"^Whtltel2$", ("Plumbing and bath", "Toilet, wall hung", "Side elevation")),
    (r"^Whurnel1$", ("Plumbing and bath", "Urinal, wall hung", "Front elevation")), (r"^Whurnel2$", ("Plumbing and bath", "Urinal, wall hung", "Side elevation")),
    (r"^work station", ("Office", "Workstation with people", "Front elevation")), (r"^Woman$", ("People", "Woman standing", "Front elevation")),
    (r"^Shadow|^SHDW$|^Ptshad$|^Rndshad$", ("Graphics", "Shadow hatch", "Plan")), (r"^Nstand", ("Furniture", "Nightstand", "Plan")),
]
SKIP = re.compile(r"^(_|A\$C26360E72|A\$C5BA75167|door_90|LF1$|ELLIPSE$|OVAL$|RECTANG$|SQM$|TICKY$|Pl$|FRWN$|s$|sperm$|LCSETR21_FRAWN|Lc3d|Lcsetr3[45]$|Woman$)")

# normalizing sizes: blocks drawn at a unit size for scaling on insertion, shown here at a typical size
def norm(n, cat, noun, view, w, h):
    big = max(w, h)
    if big < 120 and not n.startswith("_"): return 1000 / 25.4                      # drawn in metres, read as inches
    if n.startswith(("02ptre", "Lcpltr")): return 6000 / big                          # plan trees, 6 m canopy
    if n.startswith("02etre"): return 9000 / h                                         # elevation trees, 9 m
    if n.startswith(("Lcsetr", "LCSETR33_B1")): return 8000 / h if not n.startswith("Lcsetr21") else 6000 / h
    if n.startswith("Lcsesh"): return 2.6
    if n.startswith("Lcsesf"): return 2.6
    if n == "VDU-E": return 450 / w
    if n.startswith("PE_"): return 1300 / h
    return 1.0

lib = []
for n, b in B.items():
    if SKIP.match(n): continue
    x0, y0, x1, y1 = b["bbox"]; w, h = x1 - x0, y1 - y0
    t = two(n); cat = noun = view = None; num = ""
    if t: cat, noun, view, num = t
    m = re.match(r"^(?i:lc)(pl|se)([a-z]{2})(\d+)", n)
    if not cat and m and m.group(2).lower() in LC_CODE:
        cat, noun = LC_CODE[m.group(2).lower()]; view = "Plan" if m.group(1).lower() == "pl" else "Front elevation"; num = m.group(3)
        if m.group(2).lower() == "po": view = "Plan"
        if cat == "Site furniture" and view == "Plan" and m.group(3) in ("04",): noun = "Boulder"
    if not cat and n.startswith("Lcplwm"): cat, noun, view, num = "People", "Woman", "Plan", n[-2:]
    if not cat and n.startswith("Lcchair"): cat, noun, view = "Furniture", "Chair", "Plan"
    if not cat and n == "LCSETR33_B1": cat, noun, view = "Planting", "Tree, bare", "Front elevation"
    if not cat:
        for rx, v in NAMED:
            if re.search(rx, n): cat, noun, view = v; break
    if not cat:
        # what it looks like: a figure's proportions, a vehicle's, a round canopy
        if 1400 < h < 2100 and w < 0.7 * h: cat, noun, view = "People", "Person", "Front elevation"
        elif 3500 < w < 6500 and 1100 < h < 2200: cat, noun, view = "Vehicles", "Car", "Side elevation"
        elif abs(w - h) < 0.1 * max(w, h) and max(w, h) > 2500: cat, noun, view = "Planting", "Tree", "Plan"
        else: cat, noun, view = "Miscellaneous", n, "Plan"
    f = norm(n, cat, noun, view, w, h)
    polys = [[[round(x * f), round(y * f)] for x, y in pl] for pl in b["p"]]
    fills = [[[round(x * f), round(y * f)] for x, y in pl] for pl in b["fill"]]
    W, Hh = round(w * f), round(h * f)
    if W < 10 and Hh < 10: continue
    lib.append({"block": n, "cat": cat, "noun": noun, "view": view, "num": num, "w": W, "h": Hh, "x0": round(x0 * f), "y0": round(y0 * f), "p": polys, "fill": fills})

# names: the noun, what view, a number within its kind, the size, and the source block
from collections import defaultdict
seen = defaultdict(int)
for s in sorted(lib, key=lambda s: (s["cat"], s["noun"], s["view"], s["block"].lower())):
    k = (s["cat"], s["noun"], s["view"]); seen[k] += 1
    size = f"{s['w'] / 1000:.2f} x {s['h'] / 1000:.2f} m"
    s["name"] = f"{s['noun']} {seen[k]:02d} - {s['view'].lower()} ({size})"
json.dump(lib, open("lib.json", "w"), separators=(",", ":"))
cats = defaultdict(int)
for s in lib: cats[s["cat"]] += 1
print(len(lib), dict(sorted(cats.items())))
print(sum(1 for s in lib if s["cat"] == "Miscellaneous"), [s["block"] for s in lib if s["cat"] == "Miscellaneous"][:60])
