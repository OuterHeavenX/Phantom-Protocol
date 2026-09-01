# Blender asset pipeline — a working proof, and what it found

`gunship.py` builds the Vulture gunship from primitives in Blender and renders
it orthographically from directly above, transparent, at any size:

    pip install bpy==4.5.13
    python3 tools/blender/gunship.py assets/sprites/chopper.png 256

It renders in about 1.5 seconds on CPU. Blender is used as a Python module —
there is no GUI, no `.blend` file to keep in sync, and the model is the script,
so an art change is a diff like any other.

## One fact makes this cheap

The game rotates every sprite at draw time (`ctx.rotate(enemy.angle)`), so an
entity needs exactly **one** render — nose along +X — and not a sheet of
rotations. That is the difference between a handful of small PNGs and an atlas
of hundreds.

Only the airframe is rendered. The rotor stays procedural and is drawn over the
top at runtime, because its blur has to track the engine's actual spin rate —
and during a crash that rate is winding down. Baking it would freeze it.

## The finding: this is not yet an upgrade

Rendered at 256px the Blender airframe is plainly richer than the hand-drawn
one — real specular falloff on the hull, a glass canopy, warm exhaust.

At the size the game actually draws it, that reverses. A gunship has radius 26,
so it occupies about 60 pixels on screen. Downscaled to 60px against a dark
theatre floor the render turns to grey mush: the internal shading that carried
it at 256px is exactly what does not survive, and there is nothing left holding
the silhouette together.

The procedural sprite survives because every shape in it is drawn with a light
**outline stroke**. That stroke is not decoration — it is what separates the
airframe from a dark floor at 60 pixels, and it is the single reason the flat
version reads better in play than the shaded one.

So a naive swap makes the game look worse where it counts. Anyone continuing
this should take three things from it:

1. **Bake a rim/outline pass into the render.** Freestyle lines or an inverted-
   hull shell, matched to the stroke weight the procedural sprites already use.
   Without this, nothing else matters.
2. **Raise material contrast well past what looks right at full size.** Value
   range is what survives downscaling; hue and fine detail are not.
3. **Spend the effort where there are pixels to spend it on.** The win grows
   with entity size — bosses, the carrier, the Nemesis walker — and is largest
   of all off the battlefield, in portraits and menu art, where the size
   constraint does not apply at all. It is smallest on a 22-pixel crawler.

There is also a capability being given up, which is worth stating plainly: the
procedural sprites are recoloured at runtime from `enemy.color`, which is how
elites, cloaking alpha and the walker's accumulated damage are drawn today. A
baked PNG has none of that unless the pipeline emits a tint mask alongside it.

Nothing here is wired into the game. It is a pipeline and a measurement, not
shipped art.
