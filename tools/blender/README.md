# Blender asset pipeline — R&D, with a corrected measurement

    pip install bpy==4.5.13
    python3 tools/blender/render.py all out/          # all four, at true size
    python3 tools/blender/render.py manticore m.png 158

Four assets build from primitives in `render.py`: `gunship`, `carrier`,
`manticore`, `soldier`. Blender runs as a Python module — no GUI, no `.blend` to
keep in sync, the model is the script, so an art change is a diff.

The game rotates sprites at draw time, so each entity needs one render along +X
rather than a sheet of rotations.

## Correction: the earlier verdict was measured at the wrong size

The first pass concluded that a Blender render loses to the hand-drawn sprite at
"the 60px a gunship occupies on screen". **That number was wrong.** It was taken
as the collision radius doubled, and these sprites draw far outside their
collision radius — the gunship's rotor disc reaches 2.7x it.

Measured properly, by rendering each sprite on an oversized canvas and taking
the alpha bounding box:

| Entity | radius x2 (used before) | actual footprint |
|---|---|---|
| gunship | 60px | **159px** |
| carrier | 70px | **145px** |
| manticore | 120px | **146px** |
| soldier | 26px | **29px** |

So the earlier comparison was judging a render at less than half the size it
would really be seen at. Everything downstream of it was pessimistic.

## The outline pass

The one thing the earlier finding got right was the cause: every shape in the
procedural art carries a light stroke, and that stroke — not the shading — is
what holds a silhouette together against a dark floor.

The render is now done at 6x, the alpha is dilated into a hard edge at a weight
specified in *final* display pixels, and only then is it downsampled with a
restrained sharpen. Doing it in post rather than with Blender's line renderer
keeps the weight exact and independent of camera distance, which is what lets
one pipeline serve a 29px soldier and a 158px siege platform with the same
apparent line.

## Verdict at true gameplay size — mixed, and asset-dependent

- **Carrier — Blender wins clearly.** Reads as a tracked vehicle with a hull,
  glacis, running gear and a turret. The procedural sprite is a flat olive
  hexagon with wheel blobs.
- **Gunship — Blender wins on the airframe.** Real volume, a canopy that reads
  as glass, visible exhausts. Note the procedural version keeps the animated
  rotor disc, which is drawn at runtime and must stay procedural either way.
- **Manticore — the procedural sprite wins, and not narrowly.** This is the
  useful failure. The Blender mech is a competent grey chassis; the shipping
  sprite is an aggressive red-and-orange radial silhouette that reads as a
  threat instantly. Bosses carry **semantic colour** — a boss's job is to look
  dangerous — and a neutral metal palette throws that away. Geometry was never
  the problem here.
- **Soldier — a wash.** At 29px there are not enough pixels for either approach
  to matter.

## Still not production, and why

1. **The boss needs colour identity before it can compete.** Hue is doing work
   in the procedural art that shading cannot replace.
2. **Shipping needs a sprite-loading path** that does not exist — the renderers
   draw procedurally today.
3. **It gives up runtime recolouring** from `enemy.color`, which is how elites,
   cloaking and the walker's accumulated damage are drawn. A baked PNG needs a
   tint mask alongside it to keep those.
4. **Mixing would look worse than either.** Blender vehicles beside procedural
   bosses and infantry is less consistent than committing to one.

Judge every future change at the measured footprint above, never zoomed in.
