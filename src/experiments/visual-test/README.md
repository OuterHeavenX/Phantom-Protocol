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

## Measured results

**Everything below was measured in headless Chromium in a container with no
GPU.** WebGL2 there runs on SwiftShader, a *software rasteriser* that shades
every fragment on the CPU, and WebGPU is not available at all. The GL
magnitudes are therefore worthless as a prediction of real hardware — a
fill-heavy pipeline like this is the worst case for a software rasteriser. The
*shapes* below are still informative, and are called out as such. Run the sweep
on your own machine and your own phone for numbers that mean something.

Environment: `HeadlessChrome/141`, 1280×800, dpr 1, `ANGLE (Google, Vulkan
1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`.

### Enemy-count sweep, HIGH preset

| hostiles | Canvas 2D (production) | WebGL2 on SwiftShader |
| ---: | ---: | ---: |
| 25 | 52 fps · 19.3 ms | 3 fps · 307 ms |
| 50 | 48 fps · 20.8 ms | 3 fps · 397 ms |
| 100 | 43 fps · 23.1 ms | 3 fps · 324 ms |
| 150 | 38 fps · 26.4 ms | 2 fps · 539 ms |
| 200 | 33 fps · 30.2 ms | 3 fps · 318 ms |

The magnitudes are not comparable. **The shapes are, and they are opposite.**
Canvas 2D degrades steadily with hostile count — 19.3 ms to 30.2 ms, a 56%
increase from 25 to 200 — because every entity is its own set of path
operations. The GL path is flat: 307 ms at 25 hostiles and 318 ms at 200. Its
cost is per-pixel work that does not care how many things are on screen. That
difference is architectural, not hardware-specific.

### What each effect costs

HIGH preset, 100 hostiles, baseline 316.65 ms. Each row is that one thing
switched off.

| off | frame | saved |
| --- | ---: | ---: |
| half resolution | 137.6 ms | **179.1 ms (57%)** |
| lighting, all | 160.2 ms | **156.4 ms (49%)** |
| scene lights only | 174.8 ms | 141.9 ms (45%) |
| contact shadows | 290.7 ms | 26.0 ms (8%) |
| bloom | 310.1 ms | 6.5 ms (2%) |
| combat lights | 310.9 ms | 5.8 ms (2%) |
| grain + scanlines + vignette | 314.5 ms | 2.2 ms (1%) |
| material detail | 317.4 ms | −0.7 ms (noise) |
| atmosphere | 317.4 ms | −0.7 ms (noise) |
| GPU particles | 316.7 ms | 0.0 ms (noise) |
| 2D particles | 333.3 ms | −16.7 ms (noise) |

Two things dominate and everything else is rounding: **resolution** and **light
volume overdraw**. Thirty overlapping light quads at full radius is the whole
frame. That conclusion does transfer to real hardware — the constant shrinks by
orders of magnitude, but overdraw is still what a deferred 2D lighting pass
spends its time on, and resolution is still the one dial that moves cost
linearly.

The negative rows are measurement noise on a 3 fps sample, not effects that
make the frame faster. They are left in rather than tidied away because
pretending a ±17 ms wobble at 316 ms is signal would be worse.

### Readability regression at ULTRA

Worth stating because the brief was explicit that hostiles must stay readable
under heavy combat, and at ULTRA they are **less** readable than in production,
not more. Against a flat teal floor a grey hostile has high contrast. Against
lit, grimy, seamed plating and a dark grating span it does not, even with the
composite's guaranteed light floor.

This is a content problem rather than a renderer one — the entity layer is
identical pixels in both — and the fix is a rim light or an outline on hostiles
keyed to local scene brightness, which is not in this experiment. It is the
single thing that would have to be solved before any of this went near a
production level.

### Not measured

* **Any GPU.** No device in this environment has one.
* **Any phone.** No iPhone, iPad or Android device was involved at any point.
* **WebGPU.** `navigator.gpu` is undefined here, so nothing was tried.
