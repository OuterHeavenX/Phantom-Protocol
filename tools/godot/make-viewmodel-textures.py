#!/usr/bin/env python3
"""Surface detail for the first-person weapon and hands.

The viewmodel shipped with flat colour materials -- `mat()` in
build-viewmodel.py sets a Base Color, a Metallic and a Roughness and nothing
else -- so every part of the gun is a single uniform value with only the
bevels to break it up. At the framing the references use, the weapon and the
gloved hands are the largest and nearest objects in the picture, and a large
near object with no surface in it is the most visible kind of flatness there
is.

It shows in the band as well. `patch` is the MEDIAN standard deviation inside
a 48-pixel window -- what a typical patch of the image looks like from close
up -- and mapping it over a 4 by 4 grid puts the whole remaining deficit in
the bottom row: the mockups measure 0.069 to 0.129 of window deviation there
against 0.032 in this build, and that row is mostly weapon in both. Raising
the viewmodel's light rig made it worse rather than better, which is the
diagnosis confirmed: lighting a featureless surface only produces a larger
featureless surface.

Four sets, applied triplanar in Godot rather than through UVs, so no unwrap
is needed and the grain stays continuous across the blocked-out parts:

  vmpolymer  moulded furniture: fine stipple, matte, with a moulding grain
  vmmetal    machined receiver: brushed streaks along the bore, worn edges
  vmglove    knuckle fabric: a woven cross-hatch with rubberised patches
  vmsleeve   cuff webbing: a coarser weave than the glove, no sheen

Wrapped value noise throughout, so every map tiles.
"""
import sys, os
import numpy as np
from PIL import Image

N = 512

def lattice(period, rng):
    """Value noise on a wrapping lattice, bilinear."""
    period = max(2, int(period))
    g = rng.random((period, period))
    ys = np.linspace(0, period, N, endpoint=False)
    xs = np.linspace(0, period, N, endpoint=False)
    y0 = np.floor(ys).astype(int) % period
    x0 = np.floor(xs).astype(int) % period
    y1 = (y0 + 1) % period
    x1 = (x0 + 1) % period
    fy = (ys - np.floor(ys))[:, None]
    fx = (xs - np.floor(xs))[None, :]
    sy = fy * fy * (3 - 2 * fy)
    sx = fx * fx * (3 - 2 * fx)
    a = g[np.ix_(y0, x0)]
    b = g[np.ix_(y0, x1)]
    c = g[np.ix_(y1, x0)]
    d = g[np.ix_(y1, x1)]
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy

def fbm(octaves, period, rng, gain=0.5):
    total = np.zeros((N, N))
    amp = 1.0
    norm = 0.0
    for o in range(octaves):
        total += lattice(period * (2 ** o), rng) * amp
        norm += amp
        amp *= gain
    return total / max(1e-6, norm)

def norm01(a):
    lo, hi = a.min(), a.max()
    return (a - lo) / max(1e-9, hi - lo)

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / max(1e-9, e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def normal_from_height(h, strength):
    gy, gx = np.gradient(h.astype(np.float64))
    n = np.dstack([-gx * strength, gy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)

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
    print(f"  {name:12s} albedo mean {albedo.mean():.3f} std "
          f"{albedo.mean(axis=2).std():.4f}   roughness mean {r.mean():.3f} "
          f"std {r.std():.4f}")

def polymer(out, rng):
    """Moulded furniture: fine stipple over a slow moulding grain."""
    stipple = norm01(fbm(3, 150, rng))
    grain = norm01(fbm(4, 22, rng))
    scuff = smoothstep(0.66, 0.92, norm01(fbm(3, 9, rng)))
    base = 0.42 + (stipple - 0.5) * 0.34 + (grain - 0.5) * 0.20
    base = base + scuff * 0.16
    albedo = np.stack([base * 0.97, base * 0.99, base * 1.05], -1)
    # Matte, and glossier only where it has been handled.
    rough = 0.82 - scuff * 0.26 + (stipple - 0.5) * 0.12
    height = stipple * 0.62 + grain * 0.38
    write(out, "vmpolymer", albedo, height, rough, 0.0, normal_strength=2.6)

def metalwork(out, rng):
    """Machined receiver: brushed streaks, worn edges, a little pitting."""
    # Brushed along one axis: a fine lattice stretched by mixing a very high
    # frequency in one direction with a low one in the other.
    fine = lattice(420, rng)
    slow = lattice(12, rng)
    brush = norm01(fine * 0.55 + slow * 0.45)
    brush = norm01(brush + np.roll(brush, 3, axis=1) * 0.5)
    pit = smoothstep(0.80, 0.97, norm01(fbm(4, 70, rng)))
    wear = smoothstep(0.58, 0.88, norm01(fbm(3, 7, rng)))
    # Subtler than the first pass. The wear term ran to 0.30 over a period-7
    # lattice, which is a feature several centimetres wide -- correct on a
    # wall, and on a 5 cm receiver it is a blotch covering a third of the part.
    base = 0.30 + (brush - 0.5) * 0.22 + wear * 0.15 - pit * 0.08
    albedo = np.stack([base * 0.96, base * 0.99, base * 1.06], -1)
    # Worn metal is polished; the anodised field is not.
    rough = 0.46 - wear * 0.18 + (brush - 0.5) * 0.16 + pit * 0.14
    metal = 0.62 + wear * 0.20 - pit * 0.14
    height = brush * 0.3 + pit * 0.7
    write(out, "vmmetal", albedo, height, rough, metal, normal_strength=1.8)

def glove(out, rng):
    """Knuckle fabric: a woven cross-hatch with rubberised patches."""
    u = np.linspace(0, 2 * np.pi, N, endpoint=False)
    warp = np.sin(u * 64)[None, :]
    weft = np.sin(u * 64)[:, None]
    weave = norm01(warp * weft + norm01(fbm(3, 40, rng)) * 0.9)
    patch = smoothstep(0.52, 0.72, norm01(fbm(3, 6, rng)))
    dirt = norm01(fbm(4, 14, rng))
    base = 0.26 + (weave - 0.5) * 0.24 + (dirt - 0.5) * 0.16
    # Rubberised grip patches are darker and smoother than the fabric.
    base = base * (1.0 - patch * 0.30)
    albedo = np.stack([base * 1.03, base * 0.99, base * 0.96], -1)
    rough = 0.90 - patch * 0.36 + (weave - 0.5) * 0.10
    height = weave * 0.7 + patch * 0.3
    write(out, "vmglove", albedo, height, rough, 0.0, normal_strength=3.2)

def sleeve(out, rng):
    """Cuff webbing: a coarser weave than the glove and no sheen at all."""
    u = np.linspace(0, 2 * np.pi, N, endpoint=False)
    warp = np.sin(u * 30)[None, :]
    weft = np.sin(u * 34)[:, None]
    weave = norm01(warp * 0.6 + weft * 0.6 + norm01(fbm(3, 26, rng)) * 1.1)
    wet = smoothstep(0.60, 0.86, norm01(fbm(3, 5, rng)))
    base = 0.30 + (weave - 0.5) * 0.30
    base = base * (1.0 - wet * 0.26)
    albedo = np.stack([base * 1.00, base * 1.01, base * 0.97], -1)
    rough = 0.94 - wet * 0.30 + (weave - 0.5) * 0.12
    height = weave
    write(out, "vmsleeve", albedo, height, rough, 0.0, normal_strength=3.6)

def main(out):
    os.makedirs(out, exist_ok=True)
    print("viewmodel sets:")
    polymer(out, np.random.default_rng(7331))
    metalwork(out, np.random.default_rng(4242))
    glove(out, np.random.default_rng(1919))
    sleeve(out, np.random.default_rng(8080))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "godot/art/textures")
