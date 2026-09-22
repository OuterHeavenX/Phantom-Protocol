#!/usr/bin/env python3
"""Wet-surface PBR sets for CROSSFALL SPAN.

    python3 tools/godot/make-wet-textures.py godot/art/textures

Six approaches were aimed at the `patch` statistic -- the median contrast
inside a 48-pixel window -- and none of them moved it out of 0.024..0.046
against a floor of 0.064. The project's existing PBR sets, four-to-six times
finer tiling, fixing the underlying darkness, and three variations on
scattered specular puddles.

Measuring the inputs finally explained why. The asphalt set's roughness map
has a mean of 0.876 and a standard deviation of 0.027, over a range of 0.761
to 0.965. It is, to within a couple of percent, a CONSTANT. Its albedo is
barely better at a standard deviation of 0.028.

A uniform roughness means a uniform specular response: every square metre of
that road reflects the lamps, the fires and the sky by exactly the same
amount, so the surface reads as one flat polygon no matter how much albedo
grain is printed on it or how finely it is tiled. Albedo detail cannot fix
that, because at night almost nothing on this map is lit by diffuse light --
what the eye sees on a wet road is specular, and specular is governed by
roughness.

The reference's road measures a median window contrast of 0.716. A real wet
road gets that from PUDDLES: standing water at a roughness near 0.05, which
mirrors every light in the scene, sitting directly against damp asphalt near
0.45, which does not. The contrast between those two is the whole look.

So these sets are built around the roughness map rather than around the
albedo, which is the inversion the previous six attempts were missing:

  * a puddle mask from low-frequency noise, thresholded, with soft edges
  * roughness ~0.06 inside a puddle and ~0.48 outside, giving a standard
    deviation near 0.20 against the old 0.027
  * albedo darkened and slightly desaturated inside puddles, because water
    darkens what it covers, plus oil streaks and dried-out patches so the
    diffuse term varies too
  * normals with a fine ripple, strongest on standing water

Wrapped value noise throughout, so every map tiles.
"""
import os, sys
import numpy as np
from PIL import Image

N = 1024

def lattice(freq, rng):
    g = rng.random((freq + 1, freq + 1))
    g[-1, :] = g[0, :]
    g[:, -1] = g[:, 0]
    xs = np.linspace(0, freq, N, endpoint=False)
    i0 = np.clip(np.floor(xs).astype(int), 0, freq - 1)
    f = xs - i0
    f = f * f * (3 - 2 * f)
    a = g[np.ix_(i0, i0)]
    b = g[np.ix_(i0, i0 + 1)]
    c = g[np.ix_(i0 + 1, i0)]
    d = g[np.ix_(i0 + 1, i0 + 1)]
    fx = f[None, :]
    fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def fbm(octaves, base, rng, gain=0.55):
    out = np.zeros((N, N))
    amp, tot, f = 1.0, 0.0, base
    for _ in range(octaves):
        out += lattice(f, rng) * amp
        tot += amp
        amp *= gain
        f *= 2
    return out / tot

def norm01(a):
    lo, hi = a.min(), a.max()
    return (a - lo) / max(1e-9, hi - lo)

def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    n = np.stack([-dx / l, dy / l, nz / l], -1)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / max(1e-9, e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def write(out, name, albedo, height, rough, metal, normal_strength=3.0):
    Image.fromarray((np.clip(albedo, 0, 1) * 255).astype(np.uint8)).save(
        f"{out}/{name}_albedo.png")
    Image.fromarray(normal_from_height(height, normal_strength)).save(
        f"{out}/{name}_normal.png")
    orm = np.zeros((N, N, 3))
    orm[..., 0] = 1.0
    orm[..., 1] = np.clip(rough, 0.03, 1.0)
    orm[..., 2] = metal if np.isscalar(metal) else metal
    Image.fromarray((orm * 255).astype(np.uint8)).save(f"{out}/{name}_orm.png")
    r = np.clip(rough, 0.03, 1.0)
    print(f"  {name:14s} albedo std {albedo.mean(axis=2).std():.4f}   "
          f"roughness mean {r.mean():.3f} std {r.std():.4f}")

def wet_road(out, rng):
    """Wet asphalt. Puddles against damp aggregate."""
    # Puddles at two scales: broad sheets where the camber holds water, and
    # smaller pockets in the wheel ruts.
    broad = norm01(fbm(3, 3, rng))
    pocket = norm01(fbm(4, 9, rng))
    puddle = np.maximum(smoothstep(0.54, 0.70, broad),
                        smoothstep(0.62, 0.76, pocket) * 0.85)
    # Aggregate and grime, which carry the diffuse variation.
    aggregate = norm01(fbm(5, 96, rng))
    grime = norm01(fbm(4, 7, rng))
    # Oil down the lane centres, as elongated streaks.
    streak = norm01(fbm(3, 5, rng) * 0.4 + lattice(96, rng) * 0.6)
    streak = smoothstep(0.62, 0.90, streak)

    base = 0.30 + aggregate * 0.40 + (grime - 0.5) * 0.30
    base = base - streak * 0.16
    # Water darkens what it covers, and flattens its colour.
    base = base * (1.0 - puddle * 0.42)
    albedo = np.stack([base * 1.00, base * 1.02, base * 1.07], -1)

    # THE map that matters. Standing water is near-mirror; damp asphalt is not.
    #
    # Tried at 0.60/0.20 and reverted. It did not touch the blob at all --
    # the saturated ellipse stayed at 10494 pixels against 10488 -- and it
    # cost the frame everywhere else: the wider lobe put specular over most
    # of the deck, glow picked it up above its 0.90 threshold and smeared it
    # into the sky, and the 95th percentile went from 0.439 to 0.641 with
    # large-scale contrast following it from 0.136 to 0.149. Whatever holds
    # that ellipse at saturation, it is not the width of this lobe.
    rough = 0.48 - puddle * 0.42 + (aggregate - 0.5) * 0.10
    rough = rough + (1.0 - puddle) * (grime - 0.5) * 0.08

    # Ripple, strongest on the water.
    height = aggregate * 0.35 + norm01(fbm(3, 160, rng)) * puddle * 0.65
    write(out, "wetroad", albedo, height, rough, 0.0, normal_strength=2.2)

def wet_concrete(out, rng):
    """Rain-soaked concrete: runs, streaks and dark patches."""
    damp = norm01(fbm(4, 4, rng))
    patch = smoothstep(0.46, 0.72, damp)
    fines = norm01(fbm(5, 64, rng))
    # Vertical runs, which is how rain marks a parapet or a pylon.
    runs = norm01(lattice(220, rng) * 0.7 + fbm(3, 6, rng) * 0.3)
    runs = smoothstep(0.58, 0.88, runs)

    base = 0.44 + fines * 0.34 + (damp - 0.5) * 0.26
    base = base * (1.0 - patch * 0.34) * (1.0 - runs * 0.22)
    albedo = np.stack([base * 1.00, base * 1.01, base * 1.04], -1)
    rough = 0.62 - patch * 0.44 - runs * 0.12 + (fines - 0.5) * 0.12
    height = fines * 0.55 + runs * 0.18
    write(out, "wetconcrete", albedo, height, rough, 0.0, normal_strength=2.8)

def wet_steel(out, rng):
    """Painted steel, beaded and streaked."""
    beads = norm01(fbm(4, 120, rng))
    wet = smoothstep(0.50, 0.74, beads)
    corrosion = smoothstep(0.58, 0.86, norm01(fbm(4, 8, rng)))
    panel = norm01(fbm(3, 5, rng))

    base = 0.40 + panel * 0.22 - corrosion * 0.16
    base = base * (1.0 - wet * 0.20)
    albedo = np.stack([base * 1.06, base * 0.99, base * 0.94], -1)
    rough = 0.44 - wet * 0.33 + corrosion * 0.30 + (panel - 0.5) * 0.10
    metal = 0.75 - corrosion * 0.55
    height = beads * 0.5 + corrosion * 0.4
    write(out, "wetsteel", albedo, height, rough, metal, normal_strength=2.4)

def main(out):
    os.makedirs(out, exist_ok=True)
    print("wet sets:")
    wet_road(out, np.random.default_rng(5150))
    wet_concrete(out, np.random.default_rng(90210))
    wet_steel(out, np.random.default_rng(31337))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "godot/art/textures")
