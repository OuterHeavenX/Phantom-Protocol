# BLACKSITE VISUAL TEST

An isolated experiment to find out how far RED STATIC's presentation can be
pushed in a browser before the frame rate gives out, and whether a GPU
rendering path is worth having.

**Nothing here ships.** No file in `src/experiments/` is imported by the
production game except one dynamic `import()` in `src/main.js`, guarded by a
URL flag. With the flag absent, not a byte of this is fetched.

## Running it

| URL | What it does |
| --- | --- |
| `?visualtest=1` | The experimental WebGL2 renderer, HIGH preset |
| `?visualtest=1&preset=ultra` | Start on a given preset (`low`/`medium`/`high`/`ultra`) |
| `?visualtest=1&renderer=2d` | **The control.** Same level, same simulation, same harness, drawn by the production Canvas 2D renderer |
| `?visualtest=1&enemies=200` | Start at a given hostile count |
| `?visualtest=1&vtcapture=1` | Keep the drawing buffer readable so screenshot tools can see the frame. Costs a copy per frame — never benchmark with it |

`F2` hides and shows the overlay.

**Run the sweep on your own hardware.** The button marked `RUN 25→200 SWEEP`
walks the five hostile counts, settling three seconds and sampling six at each,
and prints a table with the renderer string and user agent in it. `COPY
RESULTS` puts it on the clipboard. Numbers from anywhere else — including any
in this repository's history — are not numbers from your phone.

## What is in the sector

Everything is generated from a fixed seed and shaded procedurally. There is not
one image file in this experiment, which keeps it original to RED STATIC and
keeps the download at zero.

The room is built **from the engine's own arena**: every wall and every piece of
cover the operative can be stopped by gets a prop, so nothing visible is
decoration floating over unrelated collision and nothing solid is invisible.
Decoration — floor plating, grating, hazard paint, pipes, cabling, machinery,
monitors, containment cylinders, signage, standing water — is placed on open
ground around it.

## The pipeline

1. **G-buffer** — one instanced quad per prop, writing albedo/roughness and a
   height field. Nine hundred-odd props in a single draw call.
2. **Ambient** — a floor of light, plus every emissive surface lighting itself.
3. **Lights** — one instanced quad per light, sized to its radius, blended
   additively. Fifty lights shade only the pixels they reach rather than the
   whole screen fifty times.
4. **Particles** — one instanced additive quad each, the whole system in one
   draw call, fed from the existing pooled `Fx` arrays plus a renderer-side
   atmosphere system.
5. **Bloom** — bright-pass and a separable blur at quarter resolution.
6. **Composite** — tonemap, the Canvas 2D entity layer over the top, then
   vignette, grain and scanlines.

### Entities are not reimplemented

Hostiles, projectiles and pickups are drawn by the **production sprite code**
onto an offscreen 2D canvas, which is uploaded as one texture per frame and
composited in step 6. Two reasons:

* Readability is the thing this experiment must not break. Every hostile pixel
  is identical to the shipping game.
* It makes the interesting production question directly measurable: can the
  existing 2D sprite pipeline keep its art and gain GPU lighting? The upload is
  timed separately and reported in the overlay as `tex upload`.

The composite gives entity pixels a guaranteed light floor. A hostile crossing
an unlit corridor is a gameplay problem, not a mood.

## Reading the overlay

`FPS`, `frame avg`, `p95`, `p99` and `worst` come from real frame intervals.
Percentiles rather than an average, because an average of 60 hides the four
frames that took 90 ms and those are the ones that are felt.

The per-pass numbers are **CPU time spent issuing each pass**, not GPU time. GL
commands are asynchronous; on working hardware these are submission costs and
near zero. The honest whole-frame figure is the frame interval. `tex upload`
and `2D entities` are real CPU work and are the two that matter on this list.

If the renderer string names SwiftShader, llvmpipe or similar, the overlay says
so in orange: that is a **software rasteriser**, shading every fragment on the
CPU, and fill-heavy work like this behaves nothing like it does on a GPU.

## Presets and switches

`LOW` / `MEDIUM` / `HIGH` / `ULTRA`. ULTRA is deliberately past sensible — it
exists to answer "where is the ceiling", not "what should ship".

Every expensive thing is separately switchable, because a single quality slider
tells you the frame got slower and never which effect did it.
