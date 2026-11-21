#!/usr/bin/env python3
"""Build every NOCTURNE app icon from one square source image.

Usage: python3 tools/make-icons.py icons/source.jpg [--preview out.png]
Writes icons/icon-{48..512}.png ("any"), icons/icon-maskable-{192,512}.png
(artwork scaled into the ~80% safe zone on the image's own corner colour),
icons/apple-touch-icon.png (180, opaque), favicon-16/32.png and favicon.ico.
Prints the sampled background colour for manifest background/theme colours.
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
ANY = [48, 72, 96, 128, 144, 152, 192, 256, 384, 512]
MASKABLE = [192, 512]
SAFE = 0.80  # maskable safe zone: a circle of 80% diameter


def corner_colour(img):
    px = img.load()
    w, h = img.size
    k = max(4, w // 64)
    pts = [(x, y) for cx, cy in ((0, 0), (w - k, 0), (0, h - k), (w - k, h - k)) for x in range(cx, cx + k) for y in range(cy, cy + k)]
    r = sorted(px[p][0] for p in pts)[len(pts) // 2]
    g = sorted(px[p][1] for p in pts)[len(pts) // 2]
    b = sorted(px[p][2] for p in pts)[len(pts) // 2]
    return (r, g, b)


def main(src):
    img = Image.open(src).convert("RGB")
    side = min(img.size)  # centre-crop to square
    left, top = (img.width - side) // 2, (img.height - side) // 2
    img = img.crop((left, top, left + side, top + side))
    bg = corner_colour(img)
    for s in ANY:
        img.resize((s, s), Image.LANCZOS).save(OUT / f"icon-{s}.png", optimize=True)
    img.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png", optimize=True)
    for s in MASKABLE:
        canvas = Image.new("RGB", (s, s), bg)
        inner = round(s * SAFE)
        off = (s - inner) // 2
        canvas.paste(img.resize((inner, inner), Image.LANCZOS), (off, off))
        canvas.save(OUT / f"icon-maskable-{s}.png", optimize=True)
    for s in (16, 32):
        img.resize((s, s), Image.LANCZOS).save(OUT / f"favicon-{s}.png", optimize=True)
    img.save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("#%02x%02x%02x" % bg)


def preview(out):
    """The maskable 512 icon as launchers crop it: full, circle, squircle."""
    from PIL import ImageDraw
    m = Image.open(OUT / "icon-maskable-512.png").convert("RGBA")
    s = 512
    sheet = Image.new("RGBA", (s * 3 + 80, s + 40), (24, 24, 30, 255))
    sheet.paste(m, (20, 20))
    circle = Image.new("L", (s, s), 0)
    ImageDraw.Draw(circle).ellipse((0, 0, s - 1, s - 1), fill=255)
    sheet.paste(m, (s + 40, 20), circle)
    # Superellipse |x|^4 + |y|^4 = 1 (Android/iOS-like squircle).
    sq = Image.new("L", (s, s), 0)
    px = sq.load()
    for y in range(s):
        for x in range(s):
            u, v = (2 * x + 1) / s - 1, (2 * y + 1) / s - 1
            if u ** 4 + v ** 4 <= 1:
                px[x, y] = 255
    sheet.paste(m, (2 * s + 60, 20), sq)
    sheet.convert("RGB").save(out)


if __name__ == "__main__":
    args = sys.argv[1:]
    out = None
    if "--preview" in args:
        i = args.index("--preview")
        out = args[i + 1]
        del args[i:i + 2]
    main(args[0] if args else str(OUT / "source.jpg"))
    if out:
        preview(out)
