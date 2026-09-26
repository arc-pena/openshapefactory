#!/usr/bin/env python3
"""Turn a clean poster screenshot into a 512x352 monochrome selector thumbnail.

    python3 make_thumb.py <poster.png> <out.png> [--invert]

Crops to the subject (pixels that differ from the border's median grey by more
than 18 levels, 1st-99th percentile, padded 25%) at the selector's 512:352
aspect, converts to grey, stretches contrast, then lifts the blacks
(70 + 0.73 v) so a dark subject keeps its shading instead of turning into a
flat silhouette. Pass --invert for a dark-ground page going into a white
world. Needs Pillow and numpy (pip install pillow numpy).
"""
import sys

import numpy as np
from PIL import Image, ImageOps

W, H = 512, 352


def main(src: str, out: str, invert: bool) -> None:
    im = Image.open(src).convert("L")
    if invert:
        im = ImageOps.invert(im)
    a = np.asarray(im).astype(float)
    bg = np.median(np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]))
    ys, xs = np.where(np.abs(a - bg) > 18)
    if not len(xs):
        sys.exit("nothing stands out from the background - is the poster frame empty?")
    x0, x1 = np.percentile(xs, 1), np.percentile(xs, 99)
    y0, y1 = np.percentile(ys, 1), np.percentile(ys, 99)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = (x1 - x0) * 1.25, (y1 - y0) * 1.25
    if w / h < W / H:
        w = h * W / H
    else:
        h = w * H / W
    box = (int(cx - w / 2), int(cy - h / 2), int(cx + w / 2), int(cy + h / 2))
    c = ImageOps.autocontrast(im.crop(box).resize((W, H), Image.LANCZOS), cutoff=1)
    c = c.point(lambda v: int(70 + v * 0.73))
    c.convert("RGB").save(out)
    print(out, "crop", box, "background", bg)


if __name__ == "__main__":
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    main(args[0], args[1], "--invert" in sys.argv)
