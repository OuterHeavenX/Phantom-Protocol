# PHANTOM PROTOCOL

A build-free, static browser survival-action roguelite set in an original near-future
military espionage universe. No npm, no bundler, no framework — native ES modules and
canvas, served straight from the repository root.

## Playing

Serve the folder as a static site, or publish the repository root through GitHub Pages.
`index.html` uses only repository-relative paths and native ES modules.

```
python3 -m http.server 8080     # then open http://localhost:8080
```

## Controls

| Action | Keyboard / Mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | `WASD` / arrows | Left stick | Left half of screen (dynamic stick) |
| Aim | Mouse pointer | Right stick | Right stick |
| Dash | `Shift` / `Space` | A / LB | On-screen button |
| Ability | `E` / `Q` | X / RT | On-screen button |
| Deploy turret | `F` | B / LB | On-screen button |
| Pause | `Esc` / `P` | Start | HUD button |
| Select adaptation | `1`–`4` | — | Tap card |
| Reroll adaptation | `R` | — | Tap button |

Weapons fire automatically at acquired targets. Aiming manually biases targeting and
camera lead; auto-target can be disabled in settings.

## Content

- **8 operatives**, each with distinct stats, a starting weapon, an always-on trait and
  an activated ability with its own implementation.
- **18 weapons** across 17 distinct firing behaviours — projectile, burst, shotgun,
  railshot, piercing bolt, lobbed explosive, proximity mine, orbiting drones, damage
  aura, shockwave pulse, melee arc, homing missiles, sustained beam, chain lightning,
  deployable turrets, designated orbital strikes and phantom summons.
- **16 support systems (passives)** that feed a single derived stat block.
- **12 weapon evolutions**, each fusing a maxed weapon with a maxed support system into
  a new weapon with its own behaviour.
- **15 hostile archetypes** and **6 elite signatures**, each bound to one of 15 AI
  behaviour profiles.
- **4 multi-phase command signatures (bosses)** with 12 distinct attack patterns.
- **10 theatres**, each with its own palette, procedural layout generator, hazard set and
  hostile weighting — including a rain-lashed suspension span, a snowed-in valley, a
  drowned forest, a hangar of stripped and burned-out airframes, and a sealed duel
  chamber. Five carry ambient weather (rain with lightning, snow, fog, dust with roof
  shafts, embers) and authored landmark props.
- **A 6-operation campaign** with pre-mission dialogue, four objective types and a
  document recovered from each operation; read in order they are the Glasshouse
  disclosure.
- **6 contract lengths × 6 threat levels**, with unlock gating. A new operator's first
  deployment defaults to the five-minute probe on standard threat.
- **20 command directives**, **61 achievements** and **12 intelligence files**, all with
  real, evaluable conditions tied to tracked statistics.
- **11 field objective types** rolled three at a time into a live in-run checklist.
- **Sealed vaults** hidden in every generated sector — 2 to 3 per run, revealed by
  proximity scan, opened by breaching the door, and paid out in caches, credits and
  personnel files. Roughly 40% come with a garrison sealed in alongside the loot.
- **Field turrets** planted by the operative, 1× to 3× simultaneously by kit rank, with
  durability that scales with rank and level and depletes under contact.
- **Procedural operative portraits**, drawn as deterministic SVG busts from the
  operative id — and as black silhouettes for personnel who have not been identified.

## Systems

**Simulation.** A single fixed-timestep engine (`src/game/engine.js`) running at 60 Hz
with an accumulator, so behaviour is identical at 30, 60 and 144 Hz. Entities live in
true world coordinates with a real camera.

**AI.** Three cooperating layers (`src/game/ai.js`): squads that share a tactical
objective and a morale pool, a per-archetype finite state machine (search, engage, flank,
take cover, suppress, charge, retreat, regroup, ambush), and steering behaviours
(seek / arrive / strafe / separate / obstacle avoidance) blended into one movement
vector. Hostiles use precomputed cover points, share contacts across a squad, telegraph
their heavy attacks, and lose track of a target they cannot see.

**World.** Finite bounded arenas generated per run (`src/game/world.js`) from one of five
layout generators, populated with destructible cover, line-of-sight-blocking geometry,
environmental hazards and precomputed AI cover points.

**Director.** A pacing controller (`src/game/director.js`) that alternates lull, deploy,
sustain and surge states, deploys hostiles as coherent squads from one or two bearings,
schedules minibosses and set-piece events across the contract, and adjusts pressure based
on how comfortable the player currently is.

**Rendering.** A ten-stage layered pipeline (`src/render/renderer.js`): tiled floor,
persistent decals, hazards, geometry with height offsets, ground effects, y-sorted
entities with shadows, projectiles, beams, pooled particles, an additive half-resolution
lighting pass, then post (vignette, flash, minimap, off-screen threat markers). All
sprites are drawn procedurally as animated vector figures — the repository ships no
image assets.

**Audio.** Sound effects are fully synthesized at runtime from oscillators and shaped
noise (`src/core/audio.js`) — a complete sound library with no samples.

Music is authored where a track exists and synthesized where one does not. Tracks are
registered in `data/music.js` against a campaign operation id or a theatre id, stream
through an `HTMLAudioElement` routed into the shared music bus, and crossfade between
pieces; anything without a track falls back to the adaptive bed whose tempo, layering and
filtering follow combat intensity. A browser that cannot decode a track's format falls
back to the bed rather than going silent.

Tracks are offered to the browser as multiple `<source>` candidates, so dropping an
`.m4a` or `.mp3` of the same basename beside a `.ogg` makes it play on browsers that
refuse Vorbis (Safari and iOS) with no code change.

**Campaign.** Six ordered operations (`data/campaign.js`), each carrying its own
briefing and debrief dialogue, a mission objective, and one document fragment. Objectives
are implemented in `src/game/mission.js` and layered over the survival contract: recover
marked data caches, locate an asset and walk them to the beacon alive, or fight a single
prototype with the director muted and no reinforcement on either side. An operation with
an unmet objective cannot extract — the beacon refuses and says why.

**Field objectives.** Three objectives are always live (`src/game/objectives.js`),
drawn from eleven templates and scaled to the operative's current level. Clearing one
pays credits and job points, checks it off the HUD list and rolls a replacement; every
third clearance drops a personnel cache.

**Sealed vaults.** Every sector generates 2 to 3 concealed chambers
(`World.placeVaults`). The geometry is ordinary structure — nothing is invisible and
nothing blocks movement unseen — but the chamber only announces itself once the
operative's scanner resolves it at close range. The door is destructible cover, so any
weapon can breach it. Vaults claim their footprint before cover is scattered, never
generate around the operative's start, and only ever face a side with a walkable
approach.

**Field turrets.** Every operative carries a rank 1 deployment kit; the Deployment Kit
adaptation raises it to rank 2 and 3, which is what turns 1× into 2× and 3×. A planted
turret has no expiry timer — durability is the limiter, scaling with kit rank and
operative level, and draining while hostiles are on top of it.

**Personnel recovery.** Locked operatives can be found in the field rather than only
unlocked by statistics. A personnel cache identifies one operative whose file is still
missing; recovering it opens a real-time counseling session (2, 4, 8 or 12 hours,
declared per operative) that runs while the game is closed. The operative joins the
roster when the session closes.

**Progression.** Versioned save with migration from earlier formats
(`src/save/storage.js`), a 20-node development tree with prerequisites and respec,
per-operative mastery ranks, account levels, and an evaluation engine
(`src/save/progression.js`) that resolves achievement, directive and unlock conditions
against tracked run telemetry.

## Structure

```
data/     content registries (operatives, weapons, passives, enemies, bosses, maps, meta)
src/core/ rng, math + spatial hash, camera, input, synthesized audio
src/game/ engine, world generation, AI, weapons, abilities, boss, director, fx
src/render/ layered renderer and procedural sprite library
src/ui/   menus, HUD, adaptation screen, pause menu, animated menu background
src/save/ persistence and progression evaluation
css/      general, HUD, responsive
```

## XP vs JP vs Credits

XP is collected from battlefield pickups and drives in-run levels and adaptations; it
resets each operation. JP (job points) is awarded from elites, command signatures and
mission performance, and persists for permanent development purchases. Credits accumulate
within and across runs as a secondary currency.

## Originality

All characters, organizations, terminology, lore and gameplay presentation in this
repository are original to Phantom Protocol. No copyrighted franchise assets or lore are
included, and no third-party art, audio or code is bundled.
