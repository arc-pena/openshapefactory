class Color(object):
    def __init__(self, r, g, b): self.rgb = (r, g, b)
    @staticmethod
    def FromArgb(r, g, b): return Color(r, g, b)
