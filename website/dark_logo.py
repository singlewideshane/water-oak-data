"""Make a dark-lettered copy of the original SingleWideShane logo.

Only the white lettering changes (to charcoal #1C1B18). The colored A keeps its exact
pixels, and every pixel keeps its transparency, so size, spacing and shapes are untouched.
Usage: python website/dark_logo.py site/assets/logo-wordmark.png site/assets/logo-wordmark-dark.png
"""
import sys
from PIL import Image

CHARCOAL = (0x1C, 0x1B, 0x18)


def darken(src, dst):
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, h = im.size
    changed = colored = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            sat = (mx - mn) / mx if mx else 0
            if sat < 0.12 and mx >= 160:  # white / near-white lettering
                px[x, y] = (*CHARCOAL, a)
                changed += 1
            else:
                colored += 1
    if changed == 0 or colored == 0:
        raise SystemExit(f"logo looks different than expected (letters {changed}, colored {colored}); not changing it")
    im.save(dst, optimize=True)
    print(f"Dark logo saved: {changed} letter pixels darkened, {colored} colored pixels kept.")


if __name__ == "__main__":
    darken(sys.argv[1], sys.argv[2])
