#!/usr/bin/env python3
"""Tileable PBR texture set for the 3D build.

    python3 tools/godot/make-textures.py godot/art/textures

Why procedural. The reference look is carried by materials more than by
geometry: sunlit stucco, worn concrete, painted steel. Flat colours read as
untextured plastic at any lighting quality, and there is no texture library in
this environment. Everything here is generated from wrapped value noise, so
each map tiles exactly and costs nothing to store in git beyond the PNG.

Each material emits three maps Godot reads directly:

    <name>_albedo.png     base colour, sRGB
    <name>_normal.png     tangent-space normal, derived from the height field
    <name>_orm.png        R unused, G roughness, B metallic  (Godot ORM layout)

The height field is shared between the normal and the roughness so bevels,
mortar lines and panel seams agree with each other instead of being three
independent noises that happen to sit on the same surface.
"""
import os, sys
import numpy as np
from PIL import Image

N = 1024
rng_global = np.random.default_rng(20260921)

def lattice(freq, rng):
    """Random lattice, wrapped, bilinearly resampled to NxN. Tileable."""
    g = rng.random((freq, freq)).astype(np.float64)
    # Wrap by tiling one extra row/col from the opposite edge.
    gw = np.vstack([g, g[:1]])
    gw = np.hstack([gw, gw[:, :1]])
    ys = np.linspace(0, freq, N, endpoint=False)
    xs = np.linspace(0, freq, N, endpoint=False)
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    # Smoothstep for a value-noise look rather than a linear pyramid.
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    a = gw[np.ix_(y0, x0)]; b = gw[np.ix_(y0, x0 + 1)]
    c = gw[np.ix_(y0 + 1, x0)]; d = gw[np.ix_(y0 + 1, x0 + 1)]
    return (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy)

def fbm(octaves=5, base=4, gain=0.5, lac=2, rng=None):
    rng = rng or rng_global
    out = np.zeros((N, N)); amp = 1.0; tot = 0.0; f = base
    for _ in range(octaves):
        out += lattice(max(2, int(f)), rng) * amp
        tot += amp; amp *= gain; f *= lac
    return out / tot

def norm01(a):
    lo, hi = a.min(), a.max()
    return (a - lo) / max(1e-9, hi - lo)

def normal_from_height(h, strength=2.0):
    # Wrapped central differences, so the normal map tiles with the height.
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    n = np.stack([-dx / l, dy / l, nz / l], -1)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)

def save(path, arr):
    Image.fromarray(arr).save(path)

def write_material(out, name, albedo, height, rough, metal=0.0):
    save(f"{out}/{name}_albedo.png", (np.clip(albedo, 0, 1) * 255).astype(np.uint8))
    save(f"{out}/{name}_normal.png", normal_from_height(height))
    orm = np.zeros((N, N, 3))
    orm[..., 1] = np.clip(rough, 0.04, 1.0)
    orm[..., 2] = metal if np.isscalar(metal) else metal
    save(f"{out}/{name}_orm.png", (orm * 255).astype(np.uint8))
    print("wrote", name)

def tint(h, col_lo, col_hi):
    """Map a 0..1 field through a two-point colour ramp."""
    lo = np.array(col_lo, dtype=np.float64) / 255.0
    hi = np.array(col_hi, dtype=np.float64) / 255.0
    return lo[None, None, :] + (hi - lo)[None, None, :] * h[..., None]

def stripes(period, width, axis=0, jitter=None):
    """Wrapped mortar/panel lines. 1 inside a line, 0 elsewhere."""
    idx = np.arange(N)
    coord = idx[:, None] * np.ones((1, N)) if axis == 0 else idx[None, :] * np.ones((N, 1))
    if jitter is not None:
        coord = coord + jitter
    m = np.mod(coord, period)
    return ((m < width) | (m > period - width)).astype(np.float64)

# ---------------------------------------------------------------------------

def mat_sandstone(out):
    """Sunlit stucco over block courses — the dominant wall surface."""
    grain = fbm(6, 6)
    blotch = fbm(3, 2)
    # Block courses: horizontal beds with staggered vertical joints.
    course = 128
    beds = stripes(course, 3, axis=0)
    stagger = (np.floor(np.arange(N)[:, None] / course) % 2) * (course / 2)
    joints = stripes(course * 1.5, 3, axis=1, jitter=stagger)
    mortar = np.clip(beds + joints * (1 - beds), 0, 1)
    # Patches where the stucco has come away and the block shows through.
    spall = (fbm(4, 3) > 0.66).astype(np.float64)
    spall = np.clip(spall * (0.5 + 0.5 * fbm(5, 8)), 0, 1)
    h = norm01(grain * 0.35 + blotch * 0.4 - mortar * 0.7 - spall * 0.25)
    base = norm01(grain * 0.5 + blotch * 0.5)
    alb = tint(base, (150, 128, 100), (214, 196, 165))
    alb = alb * (1 - 0.30 * mortar[..., None])
    alb = alb * (1 - 0.18 * spall[..., None]) + np.array([0.13, 0.10, 0.07]) * spall[..., None]
    rough = 0.72 + 0.16 * norm01(grain) + 0.08 * mortar
    write_material(out, "sandstone", alb, h, rough)

def mat_plaster(out):
    """Painted plaster — the blue-grey walls in the references."""
    grain = fbm(6, 10)
    wear = fbm(4, 3)
    drip = np.clip(fbm(5, 4) - 0.5, 0, 1) * np.linspace(0, 1, N)[:, None]
    h = norm01(grain * 0.5 + wear * 0.3 + drip * 0.4)
    base = norm01(grain * 0.4 + wear * 0.6)
    alb = tint(base, (96, 112, 122), (166, 182, 188))
    alb = alb * (1 - 0.35 * drip[..., None]) + np.array([0.22, 0.20, 0.17]) * drip[..., None]
    rough = 0.55 + 0.25 * norm01(wear) + 0.15 * drip
    write_material(out, "plaster", alb, h, rough)

def mat_concrete(out):
    """Poured slab with form seams and aggregate — the interior floor."""
    grain = fbm(6, 12)
    agg = (fbm(6, 40) > 0.62).astype(np.float64) * 0.5
    seams = np.clip(stripes(256, 2, 0) + stripes(256, 2, 1), 0, 1)
    cracks = (np.abs(fbm(4, 5) - 0.5) < 0.012).astype(np.float64)
    h = norm01(grain * 0.5 + agg * 0.3 - seams * 0.8 - cracks * 0.6)
    base = norm01(grain * 0.7 + agg * 0.3)
    alb = tint(base, (78, 78, 76), (142, 140, 133))
    alb = alb * (1 - 0.35 * seams[..., None]) * (1 - 0.45 * cracks[..., None])
    rough = 0.80 + 0.12 * norm01(grain) - 0.10 * agg
    write_material(out, "concrete", alb, h, rough)

def mat_cobble(out):
    """Set stone paving — the courtyard ground in the references."""
    cell = 64
    jx = (lattice(N // cell, rng_global) - 0.5) * 10
    jy = (lattice(N // cell, rng_global) - 0.5) * 10
    gx = np.mod(np.arange(N)[None, :] + jx, cell) / cell
    gy = np.mod(np.arange(N)[:, None] + jy, cell) / cell
    d = np.minimum(np.minimum(gx, 1 - gx), np.minimum(gy, 1 - gy))
    stone = np.clip(d * 6.0, 0, 1)
    grain = fbm(5, 16)
    h = norm01(stone * 0.75 + grain * 0.25)
    base = norm01(stone * 0.4 + grain * 0.6)
    alb = tint(base, (92, 86, 76), (168, 158, 140))
    alb = alb * (0.55 + 0.45 * stone[..., None])
    rough = 0.70 + 0.2 * norm01(grain) + 0.1 * (1 - stone)
    write_material(out, "cobble", alb, h, rough)

def mat_steel(out):
    """Painted steel plate with rivets — machinery and vault doors."""
    grain = fbm(5, 14)
    panel = np.clip(stripes(256, 3, 0) + stripes(170, 3, 1), 0, 1)
    px = np.mod(np.arange(N)[None, :], 170); py = np.mod(np.arange(N)[:, None], 256)
    rivets = (((px - 24) ** 2 + (py - 24) ** 2) < 90).astype(np.float64)
    rust = np.clip(fbm(4, 4) - 0.58, 0, 1) * 3.0
    h = norm01(grain * 0.2 - panel * 0.8 + rivets * 0.9 + rust * 0.2)
    base = norm01(grain)
    alb = tint(base, (58, 66, 70), (108, 118, 122))
    alb = alb * (1 - np.clip(rust, 0, 1)[..., None]) + np.array([0.36, 0.19, 0.10]) * np.clip(rust, 0, 1)[..., None]
    alb = alb * (1 - 0.3 * panel[..., None])
    rough = 0.42 + 0.30 * np.clip(rust, 0, 1) + 0.12 * norm01(grain)
    metal = np.clip(0.85 - np.clip(rust, 0, 1) * 0.7, 0, 1)
    write_material(out, "steel", alb, h, rough, metal)

def mat_crate(out):
    """Shipping container: corrugated, painted, weathered."""
    corr = (np.sin(np.arange(N)[None, :] / N * np.pi * 2 * 32) * 0.5 + 0.5) * np.ones((N, 1))
    grain = fbm(5, 12)
    scuff = np.clip(fbm(4, 6) - 0.55, 0, 1) * 2.5
    bands = stripes(512, 6, 0)
    h = norm01(corr * 0.7 + grain * 0.2 - bands * 0.5)
    base = norm01(corr * 0.35 + grain * 0.65)
    alb = tint(base, (104, 74, 46), (176, 132, 82))
    alb = alb * (1 - np.clip(scuff, 0, 1)[..., None] * 0.6)
    rough = 0.55 + 0.30 * np.clip(scuff, 0, 1) + 0.1 * norm01(grain)
    write_material(out, "crate", alb, h, rough, 0.35)

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "godot/art/textures"
    os.makedirs(out, exist_ok=True)
    mat_sandstone(out); mat_plaster(out); mat_concrete(out)
    mat_cobble(out); mat_steel(out); mat_crate(out)
    print("done ->", out)
