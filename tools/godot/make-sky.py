#!/usr/bin/env python3
"""Bake an equirectangular sky panorama for the sector.

    python3 tools/godot/make-sky.py godot/art/textures

Godot's procedural sky gives a clean two-stop gradient and nothing else, which
is what the build has been rendering under: a perfectly smooth field with no
cloud, no haze band and no variation along the horizon. Two things follow from
that. The obvious one is that the strip of sky visible above the rooflines is
the flattest region in the frame. The less obvious one matters more -- the
environment takes its ambient term straight from the sky's radiance, so a sky
with no structure lights every shadowed surface in the sector with the same
featureless wash from every direction.

This writes a panorama instead: a horizon-to-zenith gradient with a warm haze
band, layered cumulus that thin out towards the horizon the way real cloud
does in perspective, and a broad sun glow placed to match the key light.
"""
import os, sys
import numpy as np
from PIL import Image

W, H = 2048, 1024
# Matches sun.rotation_degrees in game.gd: 42 degrees of elevation at a
# bearing of 128. If the key light moves, this has to move with it or the
# brightest part of the sky will sit somewhere the shadows disagree with.
SUN_YAW = 128.0
SUN_PITCH = 42.0

rng = np.random.default_rng(90210)

def lattice(freq):
    g = rng.random((freq + 1, freq + 1))
    g[-1] = g[0]          # wrap in longitude, so the panorama seams cleanly
    y = np.linspace(0, freq, H)
    x = np.linspace(0, freq, W)
    yi = np.floor(y).astype(int); xi = np.floor(x).astype(int)
    yf = (y - yi)[:, None]; xf = (x - xi)[None, :]
    yf = yf * yf * (3 - 2 * yf); xf = xf * xf * (3 - 2 * xf)
    y0 = np.clip(yi, 0, freq - 1); x0 = np.clip(xi, 0, freq - 1)
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf

def fbm(octaves=6, base=3, gain=0.55):
    out = np.zeros((H, W)); amp = 1.0; tot = 0.0; f = base
    for _ in range(octaves):
        out += lattice(f) * amp
        tot += amp; amp *= gain; f *= 2
    return out / tot

def main(out_dir):
    lon = np.linspace(-np.pi, np.pi, W)[None, :]
    lat = np.linspace(np.pi / 2, -np.pi / 2, H)[:, None]
    # Broadcast to the full panorama up front. Left as an (H, 1) column the
    # gradient builds an (H, 1, 3) image and the sun term, which is genuinely
    # two-dimensional, has nowhere to accumulate into.
    up = np.sin(lat) * np.ones_like(lon)   # 1 at zenith, 0 at horizon, -1 below

    zenith = np.array([0.155, 0.275, 0.520])
    # The band visible between rooflines is the first few degrees above the
    # horizon, and at a near-neutral 0.62 it came through as white paper once
    # the tonemapper had it. Deeper and bluer, so the gap reads as sky.
    horizon = np.array([0.400, 0.480, 0.605])
    ground = np.array([0.180, 0.170, 0.158])

    t = np.clip(up, 0, 1) ** 0.55
    sky = horizon + (zenith - horizon) * t[..., None]
    # A warm haze band in the few degrees just above the horizon, which is
    # what stops the join between sky and rooflines reading as a hard edge.
    haze = np.exp(-np.clip(up, 0, 1) * 14.0)
    sky += np.array([0.052, 0.038, 0.016]) * haze[..., None]

    # Sun disc and glow, matching the key light's bearing.
    sy = np.radians(SUN_PITCH); sx = np.radians(SUN_YAW)
    sun_v = np.array([np.cos(sy) * np.sin(sx), np.sin(sy), np.cos(sy) * np.cos(sx)])
    vx = np.cos(lat) * np.sin(lon); vy = np.sin(lat) * np.ones_like(lon)
    vz = np.cos(lat) * np.cos(lon)
    cosang = vx * sun_v[0] + vy * sun_v[1] + vz * sun_v[2]
    sky += np.array([0.95, 0.80, 0.55]) * (np.clip(cosang, 0, 1) ** 70)[..., None]
    # The broad glow was at 0.30, which with the haze band under it took the
    # strip of sky visible between the rooflines to pure white. It is the
    # backdrop, not a light source: the directional sun carries the exposure.
    sky += np.array([0.14, 0.112, 0.070]) * (np.clip(cosang, 0, 1) ** 8)[..., None]

    # Cumulus. The coverage threshold rises towards the horizon so the layer
    # reads as a ceiling seen in perspective rather than as a wallpaper.
    field = fbm(6, 3)
    cover = 0.52 + 0.30 * np.clip(1.0 - up, 0, 2) * 0.5
    cloud = np.clip((field - cover) * 4.2, 0, 1)
    cloud *= np.clip(up * 3.4, 0, 1)      # nothing below the horizon
    # Lit tops, shaded undersides: the cloud's own field doubles as a height.
    lit = np.clip((field - cover - 0.06) * 6.0, 0, 1)
    cloud_col = np.array([0.52, 0.54, 0.585]) + np.array([0.44, 0.42, 0.395]) * lit[..., None]
    sky = sky * (1 - cloud[..., None]) + cloud_col * cloud[..., None]

    below = np.clip(-up * 6.0, 0, 1)
    sky = sky * (1 - below[..., None]) + ground * below[..., None]

    # Held below unity so the sky never clips. Measured against the
    # references, their sky sits near 0.78 rather than at paper white.
    img = (np.clip(sky * 0.80, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "sky_panorama.png")
    Image.fromarray(img).save(path)
    print("wrote", path, "%.0f KB" % (os.path.getsize(path) / 1024))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "godot/art/textures")
