from . import Geometry, DocObjects, Display
class UnitSystem(object):
    Millimeters = "mm"; Meters = "m"; Inches = "in"
class RhinoMath(object):
    @staticmethod
    def UnitScale(a, b):
        f = {"mm": 1.0, "m": 1000.0, "in": 25.4}
        return f[a] / f[b]
class RhinoApp(object):
    lines = []
    @staticmethod
    def WriteLine(s): RhinoApp.lines.append(s)
