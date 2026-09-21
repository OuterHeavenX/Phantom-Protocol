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

def fbm(octaves=5, base=4, gain=0.68, lac=2, rng=None):
    """Fractal noise.

    `gain` was 0.5, which puts the sixth octave at 1/32 amplitude -- below the
    point where it contributes anything visible. The result was a texture whose
    entire content was a 64-170 px blur stretched to 1024, and the build
    measured half the per-pixel gradient energy of the reference screenshots.
    0.68 keeps the fine octaves alive.
    """
    rng = rng or rng_global
    out = np.zeros((N, N)); amp = 1.0; tot = 0.0; f = base
    for _ in range(octaves):
        out += lattice(max(2, int(f)), rng) * amp
        tot += amp; amp *= gain; f *= lac
    return out / tot


def grain_fn(freq=384, rng=None):
    """A near-Nyquist layer.

    Every material needs content at 2-4 px or the surface dissolves into paint
    the moment the camera is more than a couple of metres away. `lattice` at
    this frequency is the cheapest way to get it and still tile.
    """
    rng = rng or rng_global
    return lattice(freq, rng)


def cell_ids(rows, cols=None, rng=None, stagger=False):
    """Per-cell random value on a rows x cols grid, as a full-resolution field.

    Used for per-block and per-sett variation: without it every block in a wall
    shares one base value and the courses read as printed wallpaper. The grid
    MUST line up with whatever joint pattern it is modulating -- an 8x8 and a
    12x12 value grid laid over 5.33 columns of mortar produced a checkerboard
    that had nothing to do with the blocks, which is worse than no variation.
    """
    rng = rng or rng_global
    cols = cols or rows
    g = rng.random((rows, cols))
    idx_y = (np.arange(N) * rows // N)
    idx_x = (np.arange(N) * cols // N)
    if stagger:
        # Odd courses shift half a block, matching a stretcher bond.
        shift = (idx_y % 2)[:, None] * (N // (cols * 2))
        idx_x = ((np.arange(N)[None, :] + shift) % N) * cols // N
        return g[idx_y[:, None], idx_x]
    return g[idx_y[:, None], idx_x[None, :]]

def norm01(a):
    lo, hi = a.min(), a.max()
    return (a - lo) / max(1e-9, hi - lo)

def normal_from_height(h, strength=3.5):
    """Tangent-space normal from a height field.

    At strength 2.0 on a normalised height the fine grain worked out to about
    a 6 degree slope, so mortar joints caught neither a bright top edge nor a
    dark underside under a grazing sun and the normal map may as well not have
    been there.
    """
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

def mat_sandstone(out, name="sandstone", lo=(150, 128, 100), hi=(214, 196, 165),
                  spall_col=(0.13, 0.10, 0.07)):
    """Block-coursed masonry — the dominant wall surface.

    The ramp is a parameter because a sector rendered in one stone colour reads
    as a single extruded object no matter how well it is lit. A multiply tint
    in the material cannot fix that: multiplying a tan texture by a blue tint
    gives a darker tan, never a blue wall. Hue has to come from the ramp, so
    the same masonry generator is run several times into differently coloured
    surfaces and the plan hands them out per wall."""
    grain = fbm(6, 6)
    blotch = fbm(3, 2)
    # Block courses: horizontal beds with staggered vertical joints.
    #
    # Both periods divide 1024, so the pattern tiles. The vertical joint used
    # to be at course*1.5 = 192 px, which is 5.33 columns across the texture:
    # it did not tile, and no per-block value grid could line up with it.
    course = 128          # 8 beds
    joint_period = 256    # 4 columns
    beds = stripes(course, 3, axis=0)
    stagger = (np.floor(np.arange(N)[:, None] / course) % 2) * (joint_period / 2)
    joints = stripes(joint_period, 3, axis=1, jitter=stagger)
    mortar = np.clip(beds + joints * (1 - beds), 0, 1)
    # Patches where the stucco has come away and the block shows through.
    spall = (fbm(4, 3) > 0.66).astype(np.float64)
    spall = np.clip(spall * (0.5 + 0.5 * fbm(5, 8)), 0, 1)
    # Ragged the joint: a constant-width soft stroke reads as a drawn grid.
    mortar = np.clip(mortar - (grain > 0.62) * 0.55, 0, 1)
    # Per-block value jitter. Blocks are one course tall and about 1.5 wide.
    # One value per block, on the same 8 x 4 grid the joints cut.
    blocks = cell_ids(8, 4, stagger=True)
    fine = grain_fn()
    h = norm01(grain * 0.30 + blotch * 0.32 - mortar * 0.7 - spall * 0.25 + fine * 0.14)
    # `blocks` drives the brightness multiply below and must NOT also drive
    # the colour ramp, or the jitter is applied twice and the wall reads as a
    # randomised patchwork rather than as masonry.
    base = norm01(grain * 0.46 + blotch * 0.54)
    alb = tint(base, lo, hi)
    # +/-5% per block. The measured per-block deviation at +/-12% was 0.053
    # against reference walls that are close to uniform in value: the right
    # diagnosis at more than twice the right dose.
    alb = alb * (0.95 + 0.10 * blocks)[..., None]
    alb = alb * (1 - 0.30 * mortar[..., None])
    alb = alb * (1 - 0.18 * spall[..., None]) + np.array(spall_col) * spall[..., None]
    alb = alb * (0.94 + 0.12 * fine)[..., None]
    # A wide roughness range: weathered faces are matte, but the arris and the
    # wind-polished faces catch a sheen, and a uniformly matte wall has no
    # specular information at all.
    rough = 0.45 + 0.42 * norm01(grain) + 0.10 * mortar + 0.05 * fine
    write_material(out, name, alb, h, rough)

def mat_plaster(out, name="plaster", lo=(168, 152, 128), hi=(226, 214, 192)):
    """Rendered plaster -- trim, plinths, cornices, window surrounds.

    This started blue-grey, and materials.gd puts it on every plinth, cornice,
    lintel and window frame in the sector. The effect was cold blue trim
    against warm walls, where the references have warm cream limestone and
    painted stucco throughout.
    """
    grain = fbm(6, 10)
    wear = fbm(4, 3)
    drip = np.clip(fbm(5, 4) - 0.5, 0, 1) * np.linspace(0, 1, N)[:, None]
    fine = grain_fn()
    h = norm01(grain * 0.42 + wear * 0.26 + drip * 0.34 + fine * 0.16)
    base = norm01(grain * 0.34 + wear * 0.50 + fine * 0.16)
    alb = tint(base, lo, hi)
    alb = alb * (1 - 0.35 * drip[..., None]) + np.array([0.22, 0.20, 0.17]) * drip[..., None]
    rough = 0.55 + 0.25 * norm01(wear) + 0.15 * drip + 0.06 * fine
    write_material(out, name, alb, h, rough)

def mat_concrete(out):
    """Poured slab with form seams and aggregate — the interior floor."""
    grain = fbm(6, 12)
    agg = (fbm(6, 40) > 0.62).astype(np.float64) * 0.5
    seams = np.clip(stripes(256, 2, 0) + stripes(256, 2, 1), 0, 1)
    # The old crack layer was a level set of a smooth low-frequency fbm --
    # `abs(f - 0.5) < 0.012` -- which is a single long smoothly meandering
    # closed loop. On the floor it drew a black marker doodle across the whole
    # courtyard. Cracks now come from a ridged high-frequency field, so they
    # branch and terminate the way cracks do, and they are shallow.
    ridged = 1.0 - np.abs(2.0 * fbm(4, 26) - 1.0)
    cracks = np.clip((ridged - 0.93) * 14.0, 0, 1)
    fine = grain_fn()
    h = norm01(grain * 0.42 + agg * 0.26 - seams * 0.8 - cracks * 0.35 + fine * 0.16)
    base = norm01(grain * 0.56 + agg * 0.26 + fine * 0.18)
    alb = tint(base, (78, 78, 76), (142, 140, 133))
    alb = alb * (1 - 0.30 * seams[..., None]) * (1 - 0.30 * cracks[..., None])
    rough = 0.80 + 0.12 * norm01(grain) - 0.10 * agg + 0.06 * fine
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
    fine = grain_fn()
    # Per-sett value. Every stone sharing one base value is what made the
    # paving read as a moulded rubber mat.
    setts = cell_ids(N // cell)
    # Joints carry packed dirt rather than just being darker stone.
    joint = 1.0 - stone
    h = norm01(stone * 0.66 + grain * 0.20 + fine * 0.14)
    base = norm01(stone * 0.32 + grain * 0.46 + fine * 0.22)
    alb = tint(base, (92, 86, 76), (168, 158, 140))
    alb = alb * (0.82 + 0.34 * setts)[..., None]
    alb = alb * (0.78 + 0.22 * stone[..., None])
    # Lighter joints. At 0.34 with a near-black dirt colour the setts read as
    # a dark net laid over the courtyard rather than as packed paving.
    alb = alb * (1 - 0.18 * joint[..., None]) + np.array([0.22, 0.20, 0.17]) * joint[..., None]
    # Foot-polished crowns, rough packed joints. A uniformly matte pavement
    # has no sheen anywhere, and the sheen is how paving reads as stone.
    rough = 0.34 + 0.30 * norm01(grain) + 0.46 * joint + 0.06 * fine
    write_material(out, "cobble", alb, h, rough)

def mat_steel(out):
    """Painted steel plate with rivets — machinery and vault doors."""
    grain = fbm(5, 14)
    # 128 px panels: at uv_scale 0.80 that is a plate about 1.2 m across,
    # rather than the 2 m one that read as a featureless slab at four metres.
    panel = np.clip(stripes(128, 2, 0) + stripes(128, 2, 1), 0, 1)
    px = np.mod(np.arange(N)[None, :], 128); py = np.mod(np.arange(N)[:, None], 128)
    rivets = (((px - 18) ** 2 + (py - 18) ** 2) < 70).astype(np.float64)
    # Rust biased onto seams and rivets, where water sits, and at a frequency
    # that reads as corrosion rather than as a camouflage splotch.
    rust_field = fbm(5, 18)
    rust = np.clip((rust_field - 0.52) * 2.6, 0, 1)
    rust = np.clip(rust * (0.45 + 0.55 * np.clip(panel + rivets, 0, 1)) + rust * 0.35, 0, 1)
    fine = grain_fn()
    h = norm01(grain * 0.18 - panel * 0.8 + rivets * 0.9 + rust * 0.22 + fine * 0.16)
    base = norm01(grain * 0.7 + fine * 0.3)
    # Painted steel, not gun blue. The old ramp was a cold near-black, and
    # with a dark tint on top of it the biggest object in frame measured 0.024
    # luminance: a flat black slab with no readable surface at four metres.
    alb = tint(base, (96, 96, 92), (168, 166, 156))
    alb = alb * (1 - np.clip(rust, 0, 1)[..., None]) + np.array([0.36, 0.19, 0.10]) * np.clip(rust, 0, 1)[..., None]
    alb = alb * (1 - 0.3 * panel[..., None])
    # Rust is not just a colour: it is a roughness jump and a loss of metal.
    rough = 0.38 + 0.46 * np.clip(rust, 0, 1) + 0.12 * norm01(grain) + 0.05 * fine
    metal = np.clip(0.85 - np.clip(rust, 0, 1) * 0.78, 0, 1)
    write_material(out, "steel", alb, h, rough, metal)

def mat_crate(out):
    """Shipping container: corrugated, painted, weathered."""
    corr = (np.sin(np.arange(N)[None, :] / N * np.pi * 2 * 32) * 0.5 + 0.5) * np.ones((N, 1))
    grain = fbm(5, 12)
    scuff = np.clip(fbm(4, 6) - 0.55, 0, 1) * 2.5
    bands = stripes(512, 6, 0)
    fine = grain_fn()
    h = norm01(corr * 0.62 + grain * 0.18 - bands * 0.5 + fine * 0.18)
    base = norm01(corr * 0.28 + grain * 0.54 + fine * 0.18)
    alb = tint(base, (104, 74, 46), (176, 132, 82))
    alb = alb * (1 - np.clip(scuff, 0, 1)[..., None] * 0.6)
    rough = 0.55 + 0.30 * np.clip(scuff, 0, 1) + 0.1 * norm01(grain) + 0.06 * fine
    write_material(out, "crate", alb, h, rough, 0.35)

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "godot/art/textures"
    os.makedirs(out, exist_ok=True)
    mat_sandstone(out); mat_plaster(out); mat_concrete(out)
    mat_cobble(out); mat_steel(out); mat_crate(out)
    # The facade palette. Warm stone stays the majority surface, as it is in
    # the references, but it is no longer the only one: grey breeze block,
    # whitewash, a faded institutional blue-grey and a dull red brick give the
    # neighbouring walls something to be different from.
    mat_sandstone(out, "blockwork", (108, 110, 108), (170, 172, 168),
                  spall_col=(0.10, 0.10, 0.10))
    # Muted terracotta, not postbox red. The first pass ramped to a saturated
    # red that took over every wall it landed on; weathered brick in the
    # references is closer to grey than it is to its own pigment.
    mat_sandstone(out, "brick", (118, 92, 80), (162, 130, 114),
                  spall_col=(0.14, 0.11, 0.09))
    # Whitewash ramped to 0.93 albedo, which is brighter than any real painted
    # surface and was clipping under the key light. Chalky, not paper.
    mat_plaster(out, "whitewash", (152, 150, 142), (198, 196, 186))
    mat_plaster(out, "paintwork", (112, 124, 126), (164, 174, 174))
    print("done ->", out)
