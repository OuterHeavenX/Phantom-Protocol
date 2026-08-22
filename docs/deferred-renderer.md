# The deferred renderer

RED STATIC ships two renderers. The Canvas 2D one in `src/render/renderer.js` has
always drawn the game and still does wherever the other cannot run. The deferred
WebGL2 one in `src/render/gl/` draws the same contract with per-pixel lighting,
contact shadows, bloom and procedural materials, in all ten theatres.

They present the same surface — construct, `resize`, `render`, `destroy` — so
`src/main.js` chooses between them in one function and nothing else in the game
knows there is a choice.

## Where it came from

It began as `src/experiments/visual-test/`, an isolated experiment built to answer
one question: can this game get real lighting in a browser without a bundler, an
engine, or throwing away its art? The experiment stayed unmerged until it had been
run on real hardware. This is the promoted version of that code; the experiment now
imports the shipping renderer rather than carrying a copy, so its benchmark measures
what actually runs.

## The pipeline

| # | Pass | What it does |
|---|------|--------------|
| 1 | G-buffer | One instanced quad per dressed surface, writing albedo/roughness and a height field. Several hundred surfaces in one draw call. |
| 2 | Ambient | The theatre's sky term plus every emissive surface. |
| 3 | Lights | One instanced quad per light, sized to its radius, blended additively. A light shades only the pixels it reaches. |
| 4 | Particles | One instanced additive quad each, the whole system in one draw call, fed from the existing pooled `Fx` arrays. |
| 5 | Bloom | Bright-pass plus a separable blur at quarter resolution. |
| 6 | Composite | Filmic tonemap, the sprite layer over the top, then grain, scanlines and vignette. |

Height is written rather than a baked normal, so an edge stays sharp at any zoom and
the lighting pass can ray-march the height field for contact shadows.

## What it does not draw

Sprites are not reimplemented. Hostiles, projectiles, pickups, decals, landmarks,
hazards and every world-space marker are drawn by the production Canvas 2D code into
an offscreen canvas and uploaded as one texture per frame, then composited with a
readability floor so a hostile crossing an unlit corridor is still a hostile.
`src/render/sprites.js` stays the single source of truth for what anything in this
game looks like.

Screen-space UI — weather, the minimap, off-screen markers, announcements, the
performance readout — goes on a plain 2D canvas stacked over the GL one. It is never
uploaded, tonemapped or blurred. A minimap that has been through a filmic curve is a
worse minimap.

## Authored floor art

A theatre that ships painted floor art (`map.art`) has that art drawn by the 2D
renderer and laid into the G-buffer as albedo before anything else, and its own
procedural floor plates skipped. The painted floor then gets per-pixel falloff,
contact shadows and every muzzle flash that lands on it — strictly more than it got
under Canvas 2D. BLACKSITE ZERO is the only theatre with a pack so far; the other
nine paint their floors procedurally in the shader.

## Per-theatre dressing

`src/render/gl/dressing.js` decides which quads exist. It is ten explicit theatre
profiles rather than one generic room generator, because "the renderer works in
BLACKSITE ZERO" and "the renderer works" are different claims.

Each profile names the material its open ground is made of, a wall treatment, a sky
term, and a list of dressing passes with their parameters — grating, hazard paint,
floodwater, ice sheets, drifts, rocks, foliage, molten channels, plant, containment,
panel runs, suspension cables, pipes, cables, stations, signage, crates — and then
its fixtures: overhead grids, masts, street lamps, dropped flares, bioluminescence,
sweeping beacons, failing lights.

| Theatre | Ground | Lit by |
|---|---|---|
| BLACKSITE ZERO | painted art | overhead grid, sweeping beacons |
| ARCTIC RELAY | snow | a few floodlight masts, a high sky term |
| SUNKEN DISTRICT | wet deck | street lamps over sheet water |
| CINDER FOUNDRY | steel plate | its own molten channels |
| MERIDIAN PLATFORM | deck panels | illuminated seams and an overhead grid |
| CROSSFALL SPAN | roadway | sodium lamps along the span |
| HOLLOW VALLEY | snow | dropped flares and moonlight, no fixtures |
| ASHEN MIRE | mud | bioluminescence, nothing built |
| DERELICT HANGAR | concrete apron | sodium high-bays a long way up |
| PROVING GROUND | clean plate | a lighting rig and a wall of screens |

Colour comes from the theatre's existing 2D palette, so the GL path is recognisably
the same theatre rather than a second art direction. Palette entries are authored as
finished pixels; here they are albedo, so a colour is taken for its hue and
rebalanced to a target reflectance. Hue is the identity; brightness belongs to the
lighting.

Two hard rules hold in every profile:

1. Every wall and every piece of cover the simulation placed gets a prop. Nothing
   solid is invisible and nothing visible is decoration over unrelated collision.
   Cover the 2D renderer draws as an authored landmark — a tree trunk, a wrecked
   airframe, a boulder — is the exception, and stays on the sprite layer.
2. Dressing reads the world and the map and nothing else. Given the same contract
   seed it produces the same sector on every machine, which is what keeps a daily
   contract fair and two performance numbers comparable.

## Choosing a renderer

`Settings → Presentation → Renderer`:

- **AUTOMATIC** (default) takes the deferred path wherever WebGL2 exists and is
  backed by real hardware, and Canvas 2D otherwise.
- **DEFERRED (WEBGL2)** forces it on.
- **CANVAS 2D** forces it off.

A canvas is bound to its context for life, so the choice takes effect at the next
deployment rather than mid-contract. The settings screen reports what AUTOMATIC
found on this machine.

Automatic declines a software rasteriser. SwiftShader and llvmpipe report themselves
as WebGL2 and then shade every fragment on the CPU; this pipeline is entirely
fill-bound, so on a software rasteriser it is several times slower than the Canvas 2D
renderer it would be replacing. `probeWebGL2()` in `src/render/gl/support.js` runs on
a throwaway 1×1 canvas, because probing on the real one would spend the one context
it gets.

Anything that goes wrong falls back rather than failing: no WebGL2, a driver that
refuses to link a shader, a lost context. A lost context is recovered by rebuilding
every GL object from the scene description, which is pure data.

## Effect density

One setting drives both renderers. `Settings → Presentation → Effect density` maps to
a GL preset in `src/render/gl/presets.js`: LOW at 60% render scale with no shadows,
bloom or atmosphere; MEDIUM at 80% with one bloom pass; HIGH at full resolution with
everything. Performance mode forces LOW. ULTRA exists only in the visual test — it is
there to find a ceiling, not to be played at.

## Measuring it

Two numbers matter and neither is guessable.

**Cost.** `?visualtest=1` runs the shipping deferred renderer under a sweep from 25 to
200 hostiles and reports frame times, per-pass timings, light and particle counts.
`?visualtest=1&renderer=2d` runs the identical level and simulation through the Canvas
2D renderer as the control. `?visualtest=1&theatre=<id>` picks a theatre. See
`src/experiments/visual-test/README.md`.

**Exposure.** The deferred path can be talked into looking better than it is by simply
being brighter. The tuning here was done against the Canvas 2D renderer in the same
sector at the same contract seed, sampling five fixed camera stations and comparing
mean and percentile luminance, rather than by eye. The target is mean parity with more
range: darker shadows, brighter pools, the same overall exposure. An early build sat
about 40% above the 2D mean with its top decile clipped to white, which reads as washed
out and costs the theatre its palette.
