import math
class Point3d(object):
    def __init__(self, x, y, z):
        for v in (x, y, z): assert isinstance(v, (int, float)), v
        self.X, self.Y, self.Z = float(x), float(y), float(z)
    def __sub__(self, v): return Point3d(self.X - v.X, self.Y - v.Y, self.Z - v.Z)
    def __add__(self, v): return Point3d(self.X + v.X, self.Y + v.Y, self.Z + v.Z)
class Point2d(object):
    def __init__(self, x, y): self.X, self.Y = x, y
class Vector3d(object):
    def __init__(self, x, y, z):
        for v in (x, y, z): assert isinstance(v, float), ("Vector3d wants floats", x, y, z)
        self.X, self.Y, self.Z = x, y, z
    def Unitize(self):
        l = math.sqrt(self.X ** 2 + self.Y ** 2 + self.Z ** 2) or 1; self.X /= l; self.Y /= l; self.Z /= l; return True
    def __mul__(self, k): return Vector3d(self.X * k, self.Y * k, self.Z * k)
    def __neg__(self): return Vector3d(-self.X, -self.Y, -self.Z)
class Plane(object):
    def __init__(self, o, x, y): self.Origin, self.XAxis, self.YAxis = o, x, y
    @property
    def ZAxis(self):
        a, b = self.XAxis, self.YAxis
        return (a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X)
    def Rotate(self, ang, axis): return True
class Curve(object): pass
class PolylineCurve(Curve):
    def __init__(self, pts): self.pts = list(pts); assert len(self.pts) >= 2
class LineCurve(Curve):
    def __init__(self, a, b): self.a, self.b = a, b
class Interval(object):
    def __init__(self, a, b): self.T0, self.T1 = a, b
class PlaneSurface(object):
    def __init__(self, pl, u, v): self.pl, self.u, self.v = pl, u, v
class Circle(object):
    def __init__(self, pl, r): self.pl, self.r = pl, r
class ArcCurve(Curve):
    def __init__(self, c): self.c = c
class _Face(object):
    def __init__(self, b): self.b = b
    def CreateExtrusion(self, path, cap):
        h = path.b.Z - path.a.Z; assert h > 0
        nb = Brep(); nb.rings = self.b.rings; nb.h = h; return nb
class Brep(object):
    def __init__(self): self.rings = []; self.lumps = 1
    @property
    def Faces(self): return [_Face(self)]
    @staticmethod
    def CreatePlanarBreps(crvs, tol):
        b = Brep(); b.rings = [len(c.pts) for c in crvs]; return [b]
    def Append(self, o): self.lumps += o.lumps
class Extrusion(object):
    @staticmethod
    def Create(c, h, cap): raise Exception("not in stub")
class TextEntity(object):
    def __init__(self): self.TextHeight = 0; self.TextHorizontalAlignment = None; self.TextVerticalAlignment = None
    @staticmethod
    def Create(s, pl, ds, wrapped, w, rot):
        t = TextEntity(); t.text = s; t.pl = pl; return t
