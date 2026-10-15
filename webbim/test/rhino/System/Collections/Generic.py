class _List(list):
    def Add(self, x): self.append(x)
    @property
    def Count(self): return len(self)
class _ListFactory(object):
    def __getitem__(self, t): return _List
List = _ListFactory()
