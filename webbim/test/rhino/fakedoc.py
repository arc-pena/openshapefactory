import System, copy
from Rhino.DocObjects import ObjectAttributes, ActiveSpace, Layer
class RObj(object):
    def __init__(self, geom, attr): self.Id = System.Guid(); self.Geometry = geom; self.Attributes = attr.Duplicate()
class Layers(object):
    def __init__(self): self.items = []
    def __iter__(self): return iter(list(self.items))
    def __getitem__(self, i): return self.items[i]
    def Add(self, L):
        for M in self.items:
            if not M.IsDeleted and M.Name == L.Name and M.ParentLayerId == L.ParentLayerId: return -1
        N = copy.deepcopy(L); N.Index = len(self.items); N.Id = System.Guid(); self.items.append(N); return N.Index
    def Modify(self, L, i, quiet):
        for M in self.items:
            if M is not self.items[i] and not M.IsDeleted and M.Name == L.Name and M.ParentLayerId == L.ParentLayerId: return False
        old = self.items[i]; N = copy.deepcopy(L); N.Index = i; N.Id = old.Id; self.items[i] = N; return True
    def Delete(self, i, quiet): self.items[i].IsDeleted = True; return True
class Objects(object):
    def __init__(self, doc): self.doc = doc; self.items = {}
    def GetObjectList(self, s):
        out = [o for o in self.items.values()]
        if s.ViewportFilter != System.Guid.Empty: out = [o for o in out if o.Attributes.ViewportId == s.ViewportFilter]
        return out
    def _add(self, g, a): o = RObj(g, a); self.items[o.Id] = o; self.doc.log.append(("add", a.GetUserString("wb_id"))); return o.Id
    AddBrep = AddText = AddSurface = AddCurve = _add
    def AddClippingPlane(self, pl, du, dv, vps, a): o = RObj(("clip", pl, list(vps)), a); self.items[o.Id] = o; return o.Id
    def Replace(self, gid, g): self.items[gid].Geometry = g; self.doc.log.append(("replace", self.items[gid].Attributes.GetUserString("wb_id"))); return True
    def ModifyAttributes(self, gid, a, quiet): self.items[gid].Attributes = a.Duplicate(); return True
    def Delete(self, o, quiet):
        gid = o if isinstance(o, System.Guid) else o.Id
        if gid in self.items: self.doc.log.append(("delete", self.items[gid].Attributes.GetUserString("wb_id"))); del self.items[gid]; return True
        return False
class Viewport(object):
    def __init__(self): self.Id = System.Guid(); self.DisplayMode = None; self.CameraUp = None; self.parallel = False; self.cam = None
    def ChangeToParallelProjection(self, sym): self.parallel = True; return True
    def SetCameraLocations(self, t, l): self.cam = (t, l)
class DetailGeometry(object):
    def __init__(self): self.IsProjectionLocked = False; self.scale = None
    def SetScale(self, m, mu, p, pu): self.scale = (m, mu, p, pu); return True
class Detail(object):
    def __init__(self, doc, page, title, a, b):
        self.doc = doc; self.Viewport = Viewport(); self.DetailGeometry = DetailGeometry(); self.title = title; self.rect = (a.X, a.Y, b.X, b.Y)
        at = ObjectAttributes(); at.ViewportId = page.MainViewport.Id; at.Space = ActiveSpace.PageSpace
        o = RObj(self, at); self.Id = o.Id; doc.Objects.items[o.Id] = o
    @property
    def Attributes(self): return self.doc.Objects.items[self.Id].Attributes
    def CommitViewportChanges(self): return True
    def CommitChanges(self): return True
class PageView(object):
    def __init__(self, doc, name, w, h): self.doc = doc; self.PageName = name; self.PageWidth = w; self.PageHeight = h; self.MainViewport = Viewport()
    def AddDetailView(self, title, a, b, proj): return Detail(self.doc, self, title, a, b)
    def SetPageAsActive(self): pass
    def Redraw(self): pass
class Views(object):
    def __init__(self, doc): self.doc = doc; self.pages = []; self.RedrawEnabled = True; self.ActiveView = None
    def AddPageView(self, name, w, h): p = PageView(self.doc, name, w, h); self.pages.append(p); return p
    def GetPageViews(self): return list(self.pages)
    def GetViewList(self, a, b): return ["Perspective"]
    def Redraw(self): pass
class Strings(object):
    def __init__(self): self.d = {}
    def SetString(self, k, v): self.d[k] = v
    def GetValue(self, k): return self.d.get(k)
class DimStyles(object):
    Current = "default"
class Doc(object):
    def __init__(self, units="mm"):
        self.ModelUnitSystem = units; self.PageUnitSystem = "mm"; self.ModelAbsoluteTolerance = 0.01
        self.Layers = Layers(); self.Objects = Objects(self); self.Views = Views(self); self.Strings = Strings(); self.DimStyles = DimStyles(); self.log = []
    def BeginUndoRecord(self, s): return 1
    def EndUndoRecord(self, n): return True
