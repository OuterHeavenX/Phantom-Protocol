# RED STATIC

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
  deployable turrets, designated orbital strikes and phantom summons. Two are issued at
  induction; the other sixteen are requisitioned as command rating rises.
- **16 support systems (passives)** that feed a single derived stat block.
- **12 weapon evolutions**, each fusing a maxed weapon with a maxed support system into
  a new weapon with its own behaviour.
- **15 hostile archetypes** and **6 elite signatures**, each bound to one of 14 AI
  behaviour profiles, plus a rotary gunship that arrives on the director's schedule
  rather than out of the deployment pool.
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
- **35 weapon attachments** across seven slots, unlocked by weapon rank and fitted at the
  Gunsmith bench.
- **Sealed vaults** hidden in every generated sector — 2 to 3 per run, revealed by
  proximity scan, opened by breaching the door, and paid out in caches, credits and
  personnel files. Roughly 40% come with a garrison sealed in alongside the loot.
- **Field turrets** planted by the operative, 1× to 3× simultaneously by kit rank, with
  durability that scales with rank and level and depletes under contact.
- **Codec traffic** — the operative and whoever is running comms talk over the channel
  printed on their own dossier card, through a contract's worth of events.
- **Authored operative dossiers** — eight hand-drawn personnel cards, readable in full,
  with a head-and-shoulders crop carried across the roster and deploy screens. Personnel
  who have not been identified stay procedural black silhouettes.
- **Persistent battlefield gore** — every kill stains the floor and every stain survives
  to extraction.
- **An authored title screen**, in a wide frame and a tall one, picked by the shape of
  the screen it lands on.

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

Authored music plays on the browser's own media pipeline rather than through the
AudioContext. A media element adopted by a suspended context freezes outright — it
reports itself as playing while its clock stops and no sound comes out — and a browser
suspends the context on its own for a backgrounded tab, an interruption from another
app, or its own heuristics. Nothing here suspends it deliberately, so the engine treats
any suspension as something to recover from and resumes it, and keeps the authored track
outside the graph where a suspension cannot reach it at all. A track paused by anything
other than the game is resumed where it stands; a stall is left alone to rebuffer, since
seeking would turn a gap into a jump.

Music is authored where a track exists and synthesized where one does not. Tracks are
registered in `data/music.js` against a campaign operation id or a theatre id, stream
through an `HTMLAudioElement`, and crossfade between pieces; anything without a track
falls back to the adaptive bed whose tempo, layering and filtering follow combat
intensity. One volume control and one mute cover both paths. A browser that cannot decode
a track's format falls back to the bed rather than going silent.

Tracks are offered to the browser as multiple `<source>` candidates, so dropping an
`.m4a` or `.mp3` of the same basename beside a `.ogg` makes it play on browsers that
refuse Vorbis (Safari and iOS) with no code change.

**Campaign.** Six ordered operations (`data/campaign.js`), each carrying its own
briefing and debrief dialogue, a mission objective, and one document fragment. Objectives
are implemented in `src/game/mission.js` and layered over the survival contract: recover
marked data caches, locate an asset and walk them to the beacon alive, or fight a single
prototype with the director muted and no reinforcement on either side. An operation with
an unmet objective cannot extract — the beacon refuses and says why.

**Gunsmith.** Every weapon carries seven slots — optic, barrel, muzzle, underbarrel,
magazine, stock and internal tuning — whose labels change with the weapon's category, so
a drone fits a sensor and an emitter rather than a scope and a barrel. Attachments are
declared in `data/attachments.js` as `mult` and `add` deltas and resolved by
`src/game/gunsmith.js` into one modifier table, applied at `WeaponInstance.stat` — the
single point every weapon stat in the simulation resolves through, so one attachment
affects a railshot and an orbiting drone by the same rule. Almost every attachment
carries a drawback: a slot the player can fill with a pure upgrade is a slot with one
correct answer.

Optics do something visible rather than only shifting numbers. A fitted optic extends
target acquisition beyond the weapon's own effective range, draws its reticle on the
acquired contact — a reflex dot, a holographic ring, a thermal box, a ranging crosshair —
and ranging glass adds a sight line and the distance to target. The lock persists between
shots rather than being rebuilt each frame.

**Weapon rank.** Field experience belongs to the weapon, not the operative: a barrel
earned on the Needle-7 is fitted on the Needle-7 for every operative who carries it.
Weapons rank 1 to 20 on experience weighted toward eliminations, and each rank opens
another attachment. The bench shows what is fitted, what it does to the numbers, and what
is still to earn.

**Loadout.** A primary weapon and its bench build are selected before deployment, on both
the deploy screen and the campaign briefing. Without a selection the operative carries
their own issue weapon, stock.

**Codec.** Every dossier card carries a CODEC panel with a channel number and CONNECTED
under it; `data/codec.js` is what comes over it. Two people talk: the operative who
deployed, speaking for themselves, and a handler running comms from the operations room —
VIPER, the team commander, unless VIPER is the one in the field, in which case RAVEN takes
the desk. Twenty events across a contract each carry a short exchange, written per
operative where a voice exists for them and falling back to a shared line where one does
not, so adding an operative never leaves a gap and writing a line for one never obliges
writing eight.

`src/game/codec.js` decides what is worth saying. A radio that never stops talking is
worse than one that never starts, so it holds three kinds of restraint: beats that would
be false the second time fire once per contract, per-event cooldowns turn a run of elites
into one callout rather than six, and priority lets an urgent line cut off an idle one
mid-sentence — which is how a critical-vitals call lands during chatter. Lines dwell for a
length derived from their own text. Turning the channel off in settings silences it on the
spot and drops what was queued, because a callout that arrives minutes late is worse than
one that never came.

**Operative dossiers.** The roster's identities — codename, real name, role, specialty,
file code and the creed on the CONFIDENTIAL panel — are transcribed from the authored
dossier cards in `assets/images/Character_profile`. The art is the source of truth for
who these people are; `data/operatives.js` holds what they can do. Each card is shown in
full from the roster, and a square head-and-shoulders crop of its photo panel is used
wherever the UI wants a portrait.

An operative who has not been identified keeps the procedural SVG silhouette
(`src/render/portraits.js`): the shape reads as a person and the face is the reward for
recovering the file. That is also why the silhouette engine stays — a photograph cannot
be silhouetted the way a vector bust can, since blacking out a cropped photo yields a
black square rather than a person. It doubles as the fallback for a browser that cannot
decode the WebP art, so the failure mode is a complete picture rather than a broken
image.

**Title screen.** The boot screen is authored artwork, shipped in a wide frame for
desktop and landscape tablets (`assets/images/title-screen-wide.webp`, with the `.png`
behind it) and a tall one for phones (`title-screen-tall.*`). The logo,
tagline and both buttons are painted into the image, so `src/ui/splash.js` does not draw
a menu over it — it makes the painted buttons real. That only works if the artwork is
never cropped, because a crop slides the painted buttons out from under their hit areas,
so the stage carries the artwork's own aspect ratio and is fitted inside the viewport
whole; the letterbox is filled with a blurred, dimmed copy of the same frame rather than
bars. With no cropping the mapping is exact and each hit area is declared as a percentage
of the artwork. Anywhere else on the frame also starts the operation, so the painted
buttons never have to be a precise touch target on a short landscape phone.

The variant is chosen by which artwork's shape is closer to the viewport's, crossing over
at the geometric mean of the two, and re-chosen when the device rotates. Each frame ships
as WebP with the PNG behind it as the fallback — a tenth of the bytes — and the matching
one is preloaded from `index.html` so the title screen is the first thing painted rather
than a black frame. The command menu is built underneath before the title appears, so
dismissing it fades straight through.

**Requisition.** A new operator is issued two weapons — the Needle-7 and the Bulwark
SG — and requisitions the rest as command rating rises, on the ladder declared in
`data/weapons.js` (`WEAPON_UNLOCK_LEVEL`). The armory lists every locked weapon with the
rating it needs rather than hiding it, so the ladder reads as a goal. Every operative
still deploys with their own issue weapon whatever their rating — the ladder governs
what can be *issued to anyone*, not what a specialist carries — and in-run adaptations
still offer the whole armory, so a locked weapon can be earned inside an operation.

**Gore.** Kills stain the ground and the stains stay for the whole operation — organic
hostiles spray dark arterial red, machines burst black oil, and elites throw roughly
twice the volume. A directional kill sprays along the shot. Decals are unbounded but not
unbounded work: the renderer keeps the ~90 newest as crisp vector stains and bakes
everything older into a half-resolution offscreen layer drawn in a single `drawImage`,
so a floor thick with blood costs one blit a frame.

**Gunships.** The Vulture gunship (`data/enemies.js`) is the first flying hostile: it
ignores ground collision, holds a hover band around the operative, strafes rather than
closes, and fires five-round bursts from beyond most weapons' comfortable range. The
director schedules it by contract length — one at 36% on every contract, two more at 66%
on contracts of ten minutes or longer, three more at 82% at twenty minutes and up — so
early operations meet a single gunship and late ones face a flight.

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

**Progression.** Versioned save with migration from earlier formats and from the
storage keys the game used before it was renamed, so progress earned under the old name
survives (`src/save/storage.js`); a 20-node development tree with prerequisites and respec,
per-operative mastery ranks, account levels, and an evaluation engine
(`src/save/progression.js`) that resolves achievement, directive and unlock conditions
against tracked run telemetry.

## Structure

```
assets/   authored art and audio (title screens, music); everything else is procedural
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

## Assets that carry the name

Authored artwork has text painted into the pixels, so renaming the project does not
rename what is inside a PNG — replacing that art is the one part of a rename that has to
happen outside the source tree. The paths are stable and the code reads no text out of
them, so dropping a replacement at the same path is the whole job:

```
assets/images/title-screen-wide.webp     (and .png)   desktop and landscape tablets
assets/images/title-screen-tall.webp     (and .png)   phones
assets/images/Character_profile/<id>.webp             one dossier card per operative
```

The title screens carry the current name. The dossier cards still print the project's
former name across the top of each file, and are the last art outstanding.

The title art's painted START and SETTINGS buttons are made real by hit areas measured as
percentages of the artwork (`src/ui/splash.js`), so new art whose buttons sit elsewhere
needs those percentages re-measured — they moved when the artwork was replaced, and were
re-measured off the new frames. Tapping anywhere on the frame also starts, so the screen
stays usable even before that happens.

## Originality

All characters, organizations, terminology, lore and gameplay presentation in this
repository are original to Red Static. No copyrighted franchise assets or lore are
included, and no third-party art, audio or code is bundled. The title artwork and music
under `assets/` are the project's own; everything drawn in-game is generated at runtime.
