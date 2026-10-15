"""Run Provide Python scripts, one after another, in the same stand-in Rhino document; print one JSON line per run.
The stand-in (Rhino/, System/, scriptcontext.py, fakedoc.py) has the parts of RhinoCommon the script calls, with
their argument types checked; it shows the script's logic, not Rhino's geometry.
Usage: python3 run.py first.py [second.py …]"""
import sys, os, json, importlib.util, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import scriptcontext, fakedoc
def layer_path(doc, L):
    names = [L.Name]; pid = L.ParentLayerId
    while pid != fakedoc.System.Guid.Empty:
        P = [x for x in doc.Layers.items if x.Id == pid][0]; names.insert(0, P.Name); pid = P.ParentLayerId
    return "::".join(names)
doc = fakedoc.Doc()
scriptcontext.doc = doc
for i, path in enumerate(sys.argv[1:]):
    spec = importlib.util.spec_from_file_location("wbrun%d" % i, path); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    rep = m.main()
    objs = list(doc.Objects.items.values()); by = {}
    for o in objs: by.setdefault(o.Attributes.GetUserString("wb_id"), []).append(o)
    where = {k: layer_path(doc, doc.Layers[v[0].Attributes.LayerIndex]) for k, v in by.items() if k and not k.startswith(("sheet:", "detail:")) and len(v) == 1 and v[0].Attributes.Space == "model"}
    dets = [o.Geometry for o in objs if isinstance(o.Geometry, fakedoc.Detail)]
    clips = [o for o in objs if o.Attributes.GetUserString("wb_kind") == "clip"]
    print(json.dumps({"run": i + 1, "counts": rep.n, "notes": rep.notes[:5], "pages": len(doc.Views.GetPageViews()), "details": len(dets),
        "clips_with_viewports": sum(1 for c in clips if c.Geometry[2]), "duplicates": [k for k, v in by.items() if k and len(v) > 1 and not k.startswith("sheet:")][:5],
        "layers": sorted(layer_path(doc, L) for L in doc.Layers.items if not L.IsDeleted), "where": where,
        "names": {k: v[0].Attributes.Name for k, v in by.items() if k in ("FL-T",)}}))
