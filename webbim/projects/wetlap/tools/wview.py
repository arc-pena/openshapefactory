# wview.py lift.json page box out.png : the lifted walls (red, as rectangles) and columns (blue) over the source (grey)
import json, sys, math, subprocess
from PIL import Image, ImageDraw
L = json.load(open(sys.argv[1]))[sys.argv[2]]; pg = sys.argv[2]; box = [float(v) for v in sys.argv[3].split(',')]; dpi = 300; s = dpi / 25.4
subprocess.run(['python3', 'ovs.py', '-', pg, str(dpi), sys.argv[3], '/tmp/_src.png'], check=True)
im = Image.open('/tmp/_src.png').convert('L').point(lambda v: 150 + v * 105 // 255).convert('RGB'); g = ImageDraw.Draw(im, 'RGBA')
O = L['origin']; T = lambda q: ((O[0] + q[0] / 100 - box[0]) * s, (box[3] - O[1] - q[1] / 100) * s)
for w in L['walls']:
    a, b, t = w['a'], w['b'], w['t'] / 2; d = math.dist(a, b) or 1; n = (-(b[1] - a[1]) / d * t, (b[0] - a[0]) / d * t)
    g.polygon([T((a[0] + n[0], a[1] + n[1])), T((b[0] + n[0], b[1] + n[1])), T((b[0] - n[0], b[1] - n[1])), T((a[0] - n[0], a[1] - n[1]))], fill=(255, 0, 0, 110) if w['cls'] == 'P' else (0, 160, 0, 110))
for c in L['cols']: g.rectangle([T((c[0], c[3])), T((c[2], c[1]))], fill=(0, 0, 255, 140))
for c in L['brick']: g.rectangle([T((c[0], c[3])), T((c[2], c[1]))], fill=(120, 0, 160, 120))
for c in L['holes']: g.rectangle([T((c[0], c[3])), T((c[2], c[1]))], fill=(255, 200, 0, 200))
im.save(sys.argv[4])
