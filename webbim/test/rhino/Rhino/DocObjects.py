import System
class ActiveSpace(object):
    ModelSpace = "model"; PageSpace = "page"
class ObjectColorSource(object):
    ColorFromObject = 1
class ObjectPlotWeightSource(object):
    PlotWeightFromObject = 1
class TextHorizontalAlignment(object):
    Left = "L"; Center = "C"; Right = "R"
class TextVerticalAlignment(object):
    Bottom = "B"
class ObjectEnumeratorSettings(object):
    def __init__(self): self.ViewportFilter = System.Guid.Empty; self.HiddenObjects = False; self.LockedObjects = False; self.IncludeLights = True; self.IncludeGrips = True
class _UserStrings(object):
    def __init__(self): self.us = {}
    def SetUserString(self, k, v): assert isinstance(v, str), (k, v); self.us[k] = v; return True
    def GetUserString(self, k): return self.us.get(k)
class ObjectAttributes(_UserStrings):
    def __init__(self):
        _UserStrings.__init__(self); self.LayerIndex = 0; self.Name = ""; self.ViewportId = System.Guid.Empty; self.Space = ActiveSpace.ModelSpace
        self.ObjectColor = None; self.ColorSource = 0; self.PlotWeight = 0; self.PlotWeightSource = 0
    def Duplicate(self):
        a = ObjectAttributes(); a.__dict__.update(self.__dict__); a.us = dict(self.us); return a
class Layer(_UserStrings):
    def __init__(self):
        _UserStrings.__init__(self); self.Name = ""; self.ParentLayerId = System.Guid.Empty; self.Color = None; self.Index = -1; self.Id = System.Guid(); self.IsDeleted = False; self.hidden_in = set()
    def SetPerViewportVisible(self, vp, on):
        (self.hidden_in.discard if on else self.hidden_in.add)(vp)
