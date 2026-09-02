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
- **Manticore — the procedural sprite still wins after a colour pass.** The
  most useful result here, and worth reading in full below.
- **Soldier — a wash.** At 29px there are not enough pixels for either approach
  to matter.

## The Manticore colour pass — done, measured, still second

The grey chassis was rebuilt around the boss's own `color` and `accent` from
`data/bosses.js` rather than an orange invented for the render, so the mech
cannot drift from its own health bar, telegraphs and minimap mark. Red plating
over a dark frame, hazard chevrons on the glacis, an emissive reactor, the
six-barrel array the boss's title says it carries.

Two real bugs were found and fixed doing it:

- sRGB colours were fed straight into Blender's linear Base Color, which
  desaturates every saturated hue — most of how a deliberate hazard red ends up
  looking like grey plastic.
- The frame spanned z −0.14 to 1.06 and the plating 0.70 to 1.02, so the armour
  was *inside* the frame. From a top-down camera the chassis rendered grey with
  a red trim, and the recolour looked like it had barely worked when it had
  simply been buried.

Both fixed, and the result is a clearly better mech than the grey one. It is
still not a better **boss**, and the reason is not fidelity:

1. **Silhouette.** The shipping sprite is a radial six-armed star. Nothing else
   in the game is that shape, so it is identifiable at a glance and at any
   angle. The Blender chassis is a rectangle with four legs — a shape a hundred
   other games use. Recolouring a generic silhouette does not make it iconic.
2. **Value range.** The sprite is a near-black body with a hot red outline:
   enormous contrast. The render sits in a narrow mid band — mid red on mid
   grey — which is exactly the mistake this file warns about two sections up.
   Colour was raised; *value separation* was not.

The first of those is a design decision, not a rendering setting, and it belongs
to whoever owns the art direction. The honest summary is that a colour pass was
necessary and insufficient: it closed the gap and did not close it enough.

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
