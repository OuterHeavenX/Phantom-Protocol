# Blender asset pipeline — production source for the entity art

    pip install bpy==4.5.13
    python3 tools/blender/render.py all assets/sprites/entities/   # all 31, at frame size
    python3 tools/blender/render.py heavy heavy.png 96

Thirty-one assets build from primitives in `render.py`: the gunship and
carrier, four boss hulls, twelve enemy body kinds from one parametric figure
plus four small-machine builders, and the operative in eight variants. Blender
runs as a Python module — no GUI, no `.blend` to keep in sync, the model is the
script, so an art change is a diff. Colours are read out of `data/enemies.js`,
`data/bosses.js` and `data/operatives.js` at render time and never restated.

The game rotates sprites at draw time, so each entity needs one render along +X
rather than a sheet of rotations. `src/render/entityart.js` loads the PNGs and
`drawEnemy`, `drawBoss` and `drawPlayer` draw them where one exists; moving
parts (legs, rotors, dishes, rings) stay procedural and are drawn under or over
the baked body.

## Three rules the renderer enforces

1. **The camera is centred on the origin** (`camera()` asserts `centre_x == 0`).
   The game rotates about the entity's position; a render framed on its
   bounding box orbits its own position instead of yawing in place.
2. **Units per pixel are fixed per kind** (`span_for`). The `ref` radius in
   `entityart.js` is only correct because the frame covers `px * 11 / radius`
   world units. Hand-set spans were a bug: widening one to fit a longer weapon
   shrank the whole figure by the same factor.
3. **The frame may not clip** (`fit()`). Because the origin is the frame centre,
   the frame must be twice the model's *forward reach*, not its width. A
   weapon that reaches past half the span is silently cut at the edge, and the
   sizing ratio then never moves however long the weapon is made — which is
   exactly how the sniper and heavy shipped at 0.77 of their footprint, and
   why three "one more notch of reach" passes changed nothing. `fit()` now
   aborts the render with the frame size it needs.

## Measurement: always at true gameplay size

An earlier verdict judged the gunship at "the 60px it occupies on screen". That
number was the collision radius doubled, and these sprites draw far outside
their collision radius — the gunship's rotor disc reaches 2.7x it. Measured
from the alpha bounding box of the procedural sprite on an oversized canvas:

| Entity | radius x2 | actual footprint | frame |
|---|---|---|---|
| gunship | 60px | 159px | 160 |
| carrier | 70px | 145px | 146 |
| manticore | 120px | 146px | 158 |
| heavy | 34px | 63px wide, 45px forward | 96 |
| sniper | 22px | 40px wide, 28px forward | 60 |
| soldier | 22px | 28px wide, 15px forward | 36 |

The infantry frames are larger than the sprite width because of rule 3.

## The outline pass

Every shape in the procedural art carries a light stroke, and that stroke — not
the shading — is what holds a silhouette together against a dark floor. The
render is done at 6x, the alpha is dilated into a hard edge at a weight
specified in *final* display pixels, and only then is it downsampled with a
restrained sharpen. Doing it in post keeps the weight exact and independent of
camera distance, which is what lets one pipeline serve a 28px soldier and a
158px siege platform with the same apparent line.

## Top-down modelling lessons, each found by looking at the sheet

- sRGB colours must be linearised (`hexrgb`) before they go into Base Color, or
  every saturated hue renders as grey plastic.
- Plating has to sit *above* the frame in z, or the top-down camera sees the
  frame and the recolour looks like it did nothing (the first Manticore pass).
- A vertical shield slab is a line from above; it is angled to have any width.
- Rotor hubs must not be the rotor colour, or the runtime arcs drawn over them
  vanish and measure as frozen.
- An emissive plate on top of a dark chassis washes the whole unit pale; the
  warden's rim is a thin edge with the hull cut over it.

## Verdict at true gameplay size

Per kind, in `docs/SYSTEMS.md` under "Authored character and machine art". The
short version: vehicles and bosses gain the most, the heavies and wardens show
real form, and infantry at 28–40px are a solid lit silhouette rather than
"detailed" — no pipeline gets detail out of a two-pixel face. The Manticore's
procedural six-armed star remains the more iconic *silhouette*; the user chose
the Blender roster for consistency and the comparison is kept honest here.

Judge every future change at the measured footprint above, never zoomed in.
