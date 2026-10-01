# rawgray.py : the elevation pages' raster layers as raw greyscale (for measuring, at build time only - never in the
# project file): data/raster/r<page>.gray + its size and sheet rectangle in r.json
import json
from PIL import Image
meta = json.load(open('../data/raster/r.json'))
for pg in ('36', '37', '38'):
    im = Image.open(f'../data/raster/r{pg}.jpg').convert('L'); open(f'../data/raster/r{pg}.gray', 'wb').write(im.tobytes())
    meta[pg]['gw'], meta[pg]['gh'] = im.size
json.dump(meta, open('../data/raster/r.json', 'w')); print('ok')
