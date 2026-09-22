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
    # Wrap in longitude, so the panorama seams cleanly.
    #
    # This was g[-1] = g[0], which wraps the wrong axis: g is indexed
    # [latitude, longitude], so that set the last ROW equal to the first --
    # tying the south pole to the north, which is meaningless, and leaving the
    # longitude edges free to disagree. They did. The rendered frame carried a
    # dead straight vertical line down the middle of the sky with blue on one
    # side and near-white on the other, and it was the most obviously broken
    # thing in the shot. Measured on the texture: a mean step of 9.0 across
    # the seam column against a median of 0.10 everywhere else.
    g[:, -1] = g[:, 0]
    y = np.linspace(0, freq, H)
    # Sampled on the same grid as `lon` below, one texel short of the full
    # turn, so the wrapped node at index freq is approached and never landed
    # on exactly.
    x = np.linspace(0, freq, W, endpoint=False)
    y0 = np.clip(np.floor(y).astype(int), 0, freq - 1)
    x0 = np.clip(np.floor(x).astype(int), 0, freq - 1)
    # The fraction is measured from the CLIPPED node, not from floor(). With
    # floor() the two disagree at exactly x == freq: the index clamps back to
    # freq-1 while the fraction reads 0, so the last column interpolated to
    # the second-to-last lattice node instead of to the wrapped one, and every
    # octave put a step there. That was the vertical line down the sky.
    yf = (y - y0)[:, None]; xf = (x - x0)[None, :]
    yf = yf * yf * (3 - 2 * yf); xf = xf * xf * (3 - 2 * xf)
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf

def fbm(octaves=6, base=3, gain=0.55):
    out = np.zeros((H, W)); amp = 1.0; tot = 0.0; f = base
    for _ in range(octaves):
        out += lattice(f) * amp
        tot += amp; amp *= gain; f *= 2
    return out / tot

def main(out_dir, night=False):
    # endpoint=False: with it, the last column repeats the first column's
    # longitude, so the texture carries a duplicated column at the seam and
    # the texel grid is not uniform. The wrap above is what makes the join
    # continuous; this is what makes it land on the right texel.
    lon = np.linspace(-np.pi, np.pi, W, endpoint=False)[None, :]
    lat = np.linspace(np.pi / 2, -np.pi / 2, H)[:, None]
    # Broadcast to the full panorama up front. Left as an (H, 1) column the
    # gradient builds an (H, 1, 3) image and the sun term, which is genuinely
    # two-dimensional, has nowhere to accumulate into.
    up = np.sin(lat) * np.ones_like(lon)   # 1 at zenith, 0 at horizon, -1 below

    if night:
        # CROSSFALL's sky. A storm at night over open water: no sun, no blue,
        # a lid of cloud lit faintly from below by the city, and a horizon
        # that is brighter than the zenith rather than darker -- which is the
        # opposite of daylight and is most of what makes a night sky read as
        # overcast rather than as clear. Values are low enough that the sky
        # contributes almost nothing as a light source, which is deliberate:
        # on this map the lamps and the fires are the light.
        zenith = np.array([0.0065, 0.0092, 0.0155])
        horizon = np.array([0.0260, 0.0335, 0.0495])
        ground = np.array([0.0040, 0.0050, 0.0068])
    else:
        zenith = np.array([0.155, 0.275, 0.520])
        # The band visible between rooflines is the first few degrees above
        # the horizon, and at a near-neutral 0.62 it came through as white
        # paper once the tonemapper had it. Deeper and bluer, so the gap
        # reads as sky.
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
    if not night:
        sky += np.array([0.95, 0.80, 0.55]) * (np.clip(cosang, 0, 1) ** 70)[..., None]
    # The broad glow was at 0.30, which with the haze band under it took the
    # strip of sky visible between the rooflines to pure white. It is the
    # backdrop, not a light source: the directional sun carries the exposure.
    if not night:
        sky += np.array([0.14, 0.112, 0.070]) * (np.clip(cosang, 0, 1) ** 8)[..., None]

    # Cumulus. The coverage threshold rises towards the horizon so the layer
    # reads as a ceiling seen in perspective rather than as a wallpaper.
    field = fbm(6, 3)
    cover = (0.30 if night else 0.52) + 0.30 * np.clip(1.0 - up, 0, 2) * 0.5
    cloud = np.clip((field - cover) * 4.2, 0, 1)
    cloud *= np.clip(up * 3.4, 0, 1)      # nothing below the horizon
    # Lit tops, shaded undersides: the cloud's own field doubles as a height.
    lit = np.clip((field - cover - 0.06) * 6.0, 0, 1)
    if night:
        # Cloud lit from BELOW by sodium light off the city, so the base is
        # warm and the tops stay dead. Inverting which side is lit is what
        # separates a night storm from a grey daytime overcast.
        cloud_col = (np.array([0.0300, 0.0225, 0.0150])
                     + np.array([-0.0175, -0.0130, -0.0060]) * lit[..., None])
    else:
        cloud_col = np.array([0.52, 0.54, 0.585]) + np.array([0.44, 0.42, 0.395]) * lit[..., None]
    sky = sky * (1 - cloud[..., None]) + cloud_col * cloud[..., None]

    below = np.clip(-up * 6.0, 0, 1)
    sky = sky * (1 - below[..., None]) + ground * below[..., None]

    # Held well below unity so the sky never clips.
    #
    # 0.80 was set while the panorama had a seam through it, so the strip of
    # sky in frame was half blue and half glow and the brightness of the glow
    # half was never really looked at. With the seam gone the whole strip is
    # the bright side, and it measured a 95th percentile of 0.802 against
    # references at 0.62, 0.72 and 0.76 -- the sky was the brightest thing in
    # the shot and read as paper rather than as air.
    #
    # This is also the ambient term, since the environment takes its fill
    # straight from the sky's radiance, so bringing it down deepens the
    # shadows at the same time -- which is the direction they needed anyway:
    # the crushed-pixel share has been sitting near zero against references
    # between 0.18 and 3.9.
    #
    # Measured at three values rather than argued about. 0.68 put all eleven
    # statistics in band but left the 95th percentile at 0.789 against a
    # ceiling of 0.790, which is no margin at all. 0.58 has the margin and is
    # closer to the references on everything that moved with it:
    #
    #            0.80    0.68    0.58     references
    #   mean     0.418   0.405   0.393    0.369 .. 0.408
    #   p95      0.802   0.789   0.779    0.619 .. 0.760
    #   ratio    18.6    20.5    22.5     7.95 .. 27.0
    #   crushed  0.015   0.056   0.156    0.183 .. 3.904
    img = (np.clip(sky * (1.0 if night else 0.58), 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "sky_panorama_night.png" if night else "sky_panorama.png")
    Image.fromarray(img).save(path)
    print("wrote", path, "%.0f KB" % (os.path.getsize(path) / 1024))

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "godot/art/textures"
    main(out)
    main(out, night=True)
