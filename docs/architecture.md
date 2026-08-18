# Architecture

Phantom Protocol is a build-free ES-module application. There is no bundler, transpiler
or package manager in the runtime path; `index.html` loads `src/main.js` as a native
module and everything else is reached through relative imports.

## Layering

```
data/        pure content registries — no behaviour, no imports from src/
  ↓
src/core/    engine-agnostic primitives (rng, math, camera, input, audio)
  ↓
src/game/    simulation: engine, world, ai, weapons, abilities, boss, director, fx
  ↓
src/render/  reads simulation state, never mutates it
src/ui/      DOM screens and HUD; talks to the engine through a small surface
  ↓
src/main.js  application state machine and render loop
```

`src/save/` sits beside the simulation: `storage.js` owns persistence and migration,
`progression.js` owns the rules that turn run telemetry into unlocks.

## Simulation model

The engine runs a **fixed timestep** of 1/60s driven by an accumulator, capped at five
steps per frame to avoid a death spiral on a slow frame. Rendering interpolates nothing —
it draws the latest simulated state — but because the step is fixed, gameplay is identical
across refresh rates.

Broad-phase queries go through a uniform `SpatialHash` rebuilt once per step. Every
system that needs neighbours (AI separation, weapon targeting, explosions, beams,
shockwaves, pickups) queries the hash rather than scanning all entities, which keeps the
step cost roughly linear in entity count.

Particles, floating text, rings and streaks are **pooled** (`src/game/fx.js`); a long run
can emit hundreds of thousands of particles without sustained allocation.

## AI

Three cooperating layers:

1. **Squad** — a group with a shared objective (`assault`, `pincer`, `advance`,
   `withdraw`), a morale value eroded by losses, and an elected commander. Squads
   re-decide a few times per second, not per frame.
2. **Brain** — a per-archetype finite state machine selecting one of
   search / engage / flank / cover / suppress / charge / retreat / regroup / ambush /
   windup / stunned, driven by an awareness value that rises with line of sight and
   decays with memory.
3. **Steering** — seek, flee, arrive-at-range, strafe, separation and obstacle avoidance,
   each contributing a weighted force, blended and then smoothed into velocity.

Perception is real: detection is range- and line-of-sight-gated, contacts propagate to
squadmates, and units commit to a last known position rather than tracking the player
through walls. Heavy attacks run through a windup with a visible telegraph.

## Rendering

Ten stages, back to front, described in `src/render/renderer.js`. Entities are sorted by
world Y each frame so overlap reads correctly. The lighting pass renders additive radial
gradients into a half-resolution offscreen canvas which is composited with
`globalCompositeOperation = 'lighter'`; it is skipped entirely in performance mode.

All sprites are procedural vector drawings (`src/render/sprites.js`) with animated limbs
and directional weapons. No image or audio assets are shipped.

## Save format

`SAVE_VERSION = 3`. `normalizeSave` deep-merges any stored save onto a freshly generated
default, so a save written by an older build never crashes a newer one and newly added
content always gets a record. `migrate` handles the v1/v2 layout, which stored the entire
development tree under the vesper operative record and kept boolean milestone flags.

Achievement, directive and unlock state is **derived**, not stored as hand-maintained
flags: `readMetric` resolves a metric name against tracked statistics (including derived
metrics assembled from keyed sub-tables), and the progression sweep grants anything whose
threshold is met.
