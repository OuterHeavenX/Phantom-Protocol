# Architecture

Red Static is a build-free ES-module application. There is no bundler, transpiler
or package manager in the runtime path; `index.html` loads `src/main.js` as a native
module and everything else is reached through relative imports.

## Layering

```
data/        pure content registries — no behaviour, no imports from src/
  ↓
src/core/    engine-agnostic primitives (rng, math, camera, input, audio)
  ↓
src/game/    simulation: engine, world, ai, weapons, abilities, boss, director,
             objectives, fx
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

## Sector generation order

`World.generate` resolves things in a deliberate order, because each stage competes for
the same open ground:

1. **Start position** (`computePlayerSpawn`), cached so later stages can avoid it.
2. **Vaults** (`placeVaults`) — chamber-sized footprints are almost impossible to find
   once cover has been scattered, so vaults claim theirs first. A vault is rejected
   near the start (it would seal the operative in) and its door is only cut on a side
   with a walkable approach, so no vault can generate unopenable. Each chamber then
   draws a lock from the same seeded stream — never from save state, or two operators
   would get different sectors from one daily contract seed. Two of the four locks make
   the seal indestructible, so the alternate route is the only route: a manual override
   held at the door, or a console (`placeVaultTerminal`) put down elsewhere in the
   sector. The console is placed here too, and for the same reason — 300 to 560 units of
   open ground is easy before cover exists and hard after. When the sector cannot supply
   it, the chamber falls back to a plain cache rather than shipping a vault nothing can
   open.
3. **Cover**, **hazards** and **hostile spawns**, all of which exclude vault interiors —
   a sealed chamber must not contain a hazard the player is forced to walk into or a
   hostile that cannot path out.

## Input

One `Input` object folds keyboard, mouse, touch and gamepad into a movement vector, an
aim vector and a set of edge-triggered actions. Two pieces sit beside it:

* **`src/core/gamepad.js`** normalises what the Gamepad API actually returns. Everything
  in it exists because some real device does it differently: non-standard `mapping`, where
  the button order is the manufacturer's own; phantom pads reported alongside the real one;
  a D-pad that lives on a hat axis rather than in the standard button block; triggers that
  report analog on one driver and digital on another. Sticks get a radial, rescaling
  deadzone rather than a per-axis cutoff, so diagonals need no more push than cardinals and
  the live band stretches back out to a full 0..1.
* **`src/ui/focusnav.js`** navigates menus by driving the browser's own focus. Every
  control in this project is a real `<button>`, so the navigable set is whatever is
  focusable and visible in the topmost layer, and activating one is `.click()`. Direction
  is geometric, not document order. Screens written later are navigable the day they ship
  without knowing this exists.

`main.js` runs a poller for the life of the page. When no run is in progress — or one is
in progress with the adaptation cards or the pause menu on top of it — the pad drives
focus; otherwise it drives the operative. Arrow keys route to the same focus model outside
a run and to the operative's legs inside one, so a television remote reporting as a
keyboard lands in the same place as one reporting as a pad.

## Aiming

Where the rounds go and where the operative is drawn facing are one decision, resolved in
`fireDirection` and mirrored onto `player.angle`:

* **Pointing the weapon wins.** Every behaviour that reaches `fireDirection` fires in a
  straight line — nothing there tracks or homes — so an actively aimed weapon fires along
  the facing, whatever it has acquired.
* **Auto-target is assist, not override.** With `settings.autoAim` on, a contact inside a
  38-degree cone of the pointer is taken, and `markEngagement` brings the body round onto
  it. The cone can be generous precisely because the sprite follows the shot.
* **Not aiming means the operative turns to the fight.** The facing follows the last
  direction rounds actually went for `ENGAGEMENT_HOLD` seconds, then falls back to the
  direction of travel. Walking right while engaging something on the left is a real thing
  to do, and the body should be turned towards the thing being shot.

`autoAim` and `performanceMode` are the two preferences that change the simulation rather
than its presentation, so they are listed in `SIM_SETTINGS` and travel inside a replay.
Anything added to that pair belongs in the same list, in the same commit.

## Replays

A run is fully determined by its seed, its configuration and its input, so a replay is
those three things rather than a recording. `src/game/replay.js` holds the codec;
`Engine.step` resolves the live input into one frozen `StepInput` per fixed step, and
recording and playback both hang off that single point.

Two properties make it exact:

* **Per fixed step, not per frame.** A slow frame runs up to five steps and a fast one
  runs none, so a per-frame log drifts the moment two machines disagree about frame rate.
* **The simulation consumes the quantised values.** Movement and aim are stored as signed
  bytes; if the live run used full precision and the replay used the rounded copy, the two
  would part company within seconds. The rounding happens once, at capture, for both.

Three things the seed cannot supply ride in the replay header: the adaptation choices
(which card was taken, rerolled, banished or skipped), the account's unlocked weapon list
(the offer pool is built from it, so a viewer with different unlocks would be offered
different cards), and the resolved seed itself.

Watching one never writes to the save — no payout, no unlocks, no medical, no walker
record.

## Static checks

There is no build step, so nothing type-checks this code on the way past. Two
checks run over the source instead, and each exists because it caught a shipped
bug that stopped the game starting:

```sh
tools/check.sh
```

1. **`npx eslint src data`** (`eslint.config.mjs`). The rule that earns its
   place is `no-undef`. A template literal in `hud.js` referenced `engine`
   where the function only took `(operative, ability)`, so the HUD constructor
   threw and no run could start at all — and it shipped, because every test
   built the `Engine` directly and never went through the HUD.
2. **`python3 tools/construction-order.py src data`**. Walks each constructor
   statement by statement and reports reads of fields that are not assigned
   yet but will be. It follows `this` across object boundaries — into the
   constructors it is handed to, through the alias they stash it under, and
   back out through every method they call on it — because that is the shape
   the real bug had: the engine built the codec after the mission, a duel
   objective spawned its boss during mission setup, and `spawnBoss` fired a
   codec cue. Run it on `859b8ad^` and it reproduces that crash with the whole
   chain.

Neither replaces running the game. Three of this project's worst bugs were only
visible through the real menus in a real browser, so a change to the HUD or the
run lifecycle still needs a launch.

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
and directional weapons. Operative portraits are the same idea in SVG for the DOM UI
(`src/render/portraits.js`): a hash of the operative id selects skin, hair, crown, optic
and insignia variants, so a face is stable across sessions without shipping an image.
Passing `silhouette` renders the identical geometry as a flat black bust, which is what
an unidentified operative looks like on the roster. No image or audio assets are
shipped.

## Save format

`SAVE_VERSION = 3`. `normalizeSave` deep-merges any stored save onto a freshly generated
default, so a save written by an older build never crashes a newer one and newly added
content always gets a record. `migrate` handles the v1/v2 layout, which stored the entire
development tree under the vesper operative record and kept boolean milestone flags.

Achievement, directive and unlock state is **derived**, not stored as hand-maintained
flags: `readMetric` resolves a metric name against tracked statistics (including derived
metrics assembled from keyed sub-tables), and the progression sweep grants anything whose
threshold is met.

## Music

`data/music.js` maps a key to a track file. `AudioEngine.startMusic(key,{fallback})`
resolves it in order: the campaign operation id, then the theatre id, then nothing — at
which point the synthesized bed named by `fallback` plays instead. Two keys deliberately
share one track (an operation and the theatre it is set in), so the "already playing"
check compares media elements rather than keys.

Tracks stream through an `HTMLAudioElement` adopted into the audio graph by
`createMediaElementSource`. That adoption is one-way and one-time per element, so the
elements are cached for the session rather than rebuilt per deployment. Each has its own
gain node for crossfades; the shared music bus still owns volume and mute, so one control
covers both the authored and synthesized paths.

Failure is expected rather than exceptional: an unsupported codec, a missing file, or a
blocked autoplay call all fall back to the synthesized bed. Nothing about a music problem
is allowed to leave a run silent.

## Gunsmith

`data/attachments.js` declares slots and attachments; `src/game/gunsmith.js` resolves a
saved build into one modifier table of `mult` and `add` entries. That table is applied in
exactly one place — `WeaponInstance.stat` — which is the choke point every weapon stat in
the simulation already resolved through. An attachment therefore affects all seventeen
firing behaviours without any of them knowing attachments exist.

Two rules keep the system honest. `MODIFIABLE` whitelists the stats an attachment may
touch, so a typo in the registry cannot quietly introduce a new stat. And `sanitizeBuild`
drops any slot referencing an attachment that is unknown, wrong-slotted, illegal for the
weapon's category, or above its current rank — a save edited by hand, or carried across a
data change, can never equip something unearned.

Only the weapon the operative deployed with carries a build. Weapons picked up as in-run
adaptations are stock, which keeps the bench a pre-mission decision rather than something
the adaptation screen has to model.
