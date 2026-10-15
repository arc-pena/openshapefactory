import uuid
class Guid(object):
    def __init__(self, s=None): self.s = s or str(uuid.uuid4())
    def __eq__(self, o): return isinstance(o, Guid) and o.s == self.s
    def __ne__(self, o): return not self.__eq__(o)
    def __hash__(self): return hash(self.s)
    def __str__(self): return self.s
    def __repr__(self): return "Guid(%s)" % self.s[:8]
    @staticmethod
    def NewGuid(): return Guid()
Guid.Empty = Guid("00000000-0000-0000-0000-000000000000")
