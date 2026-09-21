#!/usr/bin/env python3
"""Projected decals for the 3D sector.

    python3 tools/godot/make-decals.py godot/art/decals

Godot projects a `Decal` node onto whatever geometry is already there, so
markings cost no geometry, add no collision, and cannot block a sightline the
simulation believes is open. That makes them the cheapest remaining way to add
the painted layer the references lean on.

The content is the level's own. Blacksite Zero names its nine chambers in
src/game/opening-levels.js -- ARCHIVE / 01 through MEDICAL / 09 -- so the wall
stencils are those designations, read out of the same export the geometry
comes from. Nothing here imitates the reference's signage.
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def font(size):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

def weather(img, rng, amount=0.55):
    """Eat into the alpha so paint reads as worn rather than freshly applied."""
    a = np.array(img.split()[-1]).astype(np.float64) / 255.0
    n = rng.random((img.height // 8 + 1, img.width // 8 + 1))
    n = np.array(Image.fromarray((n * 255).astype(np.uint8)).resize(img.size, Image.BICUBIC)) / 255.0
    fine = rng.random((img.height, img.width))
    mask = np.clip(n * 0.75 + fine * 0.25, 0, 1)
    a = a * np.clip((mask - amount) * 3.2 + 0.55, 0, 1)
    out = np.dstack([np.array(img)[..., :3], (a * 255).astype(np.uint8)])
    return Image.fromarray(out.astype(np.uint8), "RGBA")

def stencil_label(text, size=(512, 160), rng=None):
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(76)
    bbox = d.textbbox((0, 0), text, font=f)
    d.text(((size[0] - bbox[2]) / 2, (size[1] - bbox[3]) / 2 - bbox[1]), text,
           font=f, fill=(228, 224, 210, 235))
    return weather(img, rng, 0.42)

def arrow(size=(256, 512), rng=None):
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = (232, 206, 128, 220)
    d.polygon([(128, 60), (232, 240), (168, 240), (168, 452), (88, 452), (88, 240), (24, 240)], fill=c)
    return weather(img, rng, 0.40)

def chevrons(size=(512, 128), rng=None):
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(-2, 10):
        x = i * 64
        d.polygon([(x, 128), (x + 44, 128), (x + 88, 0), (x + 44, 0)], fill=(226, 186, 72, 210))
    return weather(img, rng, 0.36)

def scorch(size=(512, 512), rng=None):
    """A soot bloom. Multiplied onto whatever it lands on."""
    yy, xx = np.mgrid[0:size[1], 0:size[0]]
    cx, cy = size[0] / 2, size[1] * 0.62
    r = np.sqrt(((xx - cx) / (size[0] * 0.44)) ** 2 + ((yy - cy) / (size[1] * 0.40)) ** 2)
    n = rng.random((size[1] // 6, size[0] // 6))
    n = np.array(Image.fromarray((n * 255).astype(np.uint8)).resize(size, Image.BICUBIC)) / 255.0
    a = np.clip((1.25 - r) * 1.5, 0, 1) * (0.55 + 0.45 * n)
    a = np.clip(a, 0, 1) ** 1.5
    rgb = np.zeros((size[1], size[0], 3), np.uint8)
    rgb[..., 0] = 26; rgb[..., 1] = 22; rgb[..., 2] = 19
    return Image.fromarray(np.dstack([rgb, (a * 205).astype(np.uint8)]).astype(np.uint8), "RGBA")

def stain(size=(512, 512), rng=None):
    """A spill: darker, wetter, with a defined edge."""
    yy, xx = np.mgrid[0:size[1], 0:size[0]]
    n = rng.random((12, 12))
    n = np.array(Image.fromarray((n * 255).astype(np.uint8)).resize(size, Image.BICUBIC)) / 255.0
    r = np.sqrt(((xx - size[0] / 2) / (size[0] * 0.40)) ** 2 + ((yy - size[1] / 2) / (size[1] * 0.34)) ** 2)
    a = np.clip((1.05 - r) * 4.0 + (n - 0.5) * 1.6, 0, 1)
    rgb = np.zeros((size[1], size[0], 3), np.uint8)
    rgb[..., 0] = 34; rgb[..., 1] = 30; rgb[..., 2] = 24
    return Image.fromarray(np.dstack([rgb, (a * 190).astype(np.uint8)]).astype(np.uint8), "RGBA")

def streak(size=(256, 512), rng=None):
    """Water running down from a sill or ledge."""
    img = np.zeros((size[1], size[0], 4), np.float64)
    rgbc = np.array([40, 36, 30])
    for i in range(14):
        x = rng.integers(10, size[0] - 10)
        w = rng.integers(3, 12)
        length = rng.integers(size[1] // 3, size[1])
        for y in range(length):
            fade = (1.0 - y / float(length)) ** 0.6
            img[y, max(0, x - w):min(size[0], x + w), :3] = rgbc
            img[y, max(0, x - w):min(size[0], x + w), 3] = np.maximum(
                img[y, max(0, x - w):min(size[0], x + w), 3], 150 * fade)
    return Image.fromarray(img.astype(np.uint8), "RGBA")

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "godot/art/decals"
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(90210)
    import json
    level = json.load(open("godot/data/level_blacksite.json"))
    for i, z in enumerate(level["floorZones"]):
        # "ARCHIVE / 01" stencils better as two lines than one long one.
        label = z["label"].split(" / ")
        img = stencil_label(label[0], rng=rng)
        img.save(os.path.join(out, "label_%d.png" % i))
        num = stencil_label(label[1] if len(label) > 1 else "00", size=(256, 256), rng=rng)
        num.save(os.path.join(out, "number_%d.png" % i))
    arrow(rng=rng).save(os.path.join(out, "arrow.png"))
    chevrons(rng=rng).save(os.path.join(out, "chevrons.png"))
    scorch(rng=rng).save(os.path.join(out, "scorch.png"))
    stain(rng=rng).save(os.path.join(out, "stain.png"))
    streak(rng=rng).save(os.path.join(out, "streak.png"))
    print("wrote", len(os.listdir(out)), "decals ->", out)
