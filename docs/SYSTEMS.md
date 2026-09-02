# RED STATIC — systems as built

The state of the game's presentation systems, as of the atmosphere pass.

`docs/ULTIMATE_AUDIOVISUAL_ASCENSION.md` is the brief that started this work and
is kept as a historical record; where the two disagree, this file is current.

Status markers are used strictly:

- **COMPLETE** — built, wired into the running game, covered by a harness whose
  assertions have each been shown to fail against a deliberately broken build.
- **IN PROGRESS** — partly built. What exists and what does not is stated.
- **PLANNED** — not started. No scaffolding exists.
- **EXPERIMENTAL** — built, deliberately not shipped, kept as R&D.
- **REJECTED** — tried, measured, and not adopted. The measurement is recorded.

Nothing is marked COMPLETE on the strength of compiling.

---

## Audio architecture — COMPLETE

Seven category buses, each with its own gain, so the mixer can prefer one kind
of sound over another rather than every call site guessing:

```
playerWeapon -> punch compressor -+
enemyWeapon  ---------------------+
impact       ---------------------+-> sfxBus -> limiter -> master -> out
enemy        ---------------------+
ambience     ---------------------+
ui           ---------------------+
alert        ---------------------+

musicBus -> musicDuck -> master

(the five combat/ambience buses additionally send to the reverb below)
```

`alert` is deliberately outside all ducking. A critical-health warning or boss
telegraph must never be attenuated by the thing that made it urgent; that is the
one rule the whole topology exists for. It is also the only bus with no reverb
send, alongside `ui` — a warning arriving smeared in reflections is a warning
heard late.

The master limiter sits at -6dB, 3.5:1. It protects against clipping and is
deliberately kept transparent.

## Player weapon families — COMPLETE

Twelve families, defined by proportion rather than absolute level so the mixer
can move them together without any losing character: pistol, suppressed, rifle,
smg, shotgun, marksman, sniper, lmg, heavy, beam, tech, corrupted.

Each shot is layered: snap, crack, body, pressure, harmonic reinforcement,
mechanical action, tail. Per-family `punch` scales the snap and the
reinforcement — force without volume, so a heavy weapon out-hits a submachine
gun at a similar level in the mix.

**Mobile translation.** A phone speaker reproduces almost nothing below ~500Hz,
so the pressure layer is simply absent on the device most people play on. The
answer is not more bass but the missing fundamental: a quiet partial slightly
sharp of the octave, which the ear reconstructs into a pitch never present in
the signal. Gated to families with low end worth reconstructing, and off for
incoming fire.

**Punch compression** sits on the weapon bus only, at 2.6:1 with a 7ms attack —
slow enough to let the leading edge through before gain reduction arrives.
Deliberately not on the master.

Covered by `tools/weapon-audio.mjs` and `tools/weapon-punch.mjs`.

## Enemy weapon routing — COMPLETE

Every hostile archetype names a weapon family from the same table the operative
uses. A rifle is a rifle whoever holds it; what distinguishes incoming is one
shade applied over the family — attenuated crack, top end rolled off, mechanical
layer removed entirely (you never hear another unit's bolt), longer tail.
Volume falls off with real distance.

Routing takes a `hostile` flag rather than keying off the sound's name, because
`laser` and `shootHeavy` are fired by both the operative and bosses. THE ARBITER,
which mirrors the operative's loadout, fires it back with that weapon's own
voice.

Covered by `tools/enemy-audio.mjs`.

## Chassis audio identity — COMPLETE

Seven chassis, independent of weapon, covering all archetypes and elites:
infantry, heavy, drone, swarm, walker, armour, synthetic. Chosen by what the
thing is physically made of, which is what the ear identifies.

Each chassis is one table entry read by three events — death, alert, arrival —
so a chassis cannot arrive half-defined. Arrival is deliberately not universal:
infantry and swarms are silent, because twenty riflemen announcing themselves at
once is noise rather than information.

The alert watches awareness cross in the engine rather than hooking the AI's
sight check, because awareness is raised from six other places besides sight. It
latches and re-arms only on a full loss of contact.

Covered by `tools/enemy-identity.mjs`.

## Theatre ambience — COMPLETE

Ten beds. Each is filtered noise through a drifting filter (a static filter on
static noise reads as circuit hiss within ten seconds), a low oscillator for
whether the place still has power, and intermittent events drawn from eight
shapes with gaps picked from a range rather than fixed.

Covered by `tools/ambience.mjs`.

## Environmental reverb — COMPLETE

A parallel send, built once at unlock. The dry path is untouched, so every level
and duck tuned previously still applies; the room is added beside them.

Rooms are generated, not loaded: noise under an exponential decay, discrete early
reflections where there are hard parallel surfaces, decorrelated across channels
for width. Four numbers separate them — length, decay curve, damping, pre-delay.

Restraint is enforced: longest room 1.4s, wettest send under a third, outdoor
theatres near a tenth. Performance mode shortens the impulse rather than removing
the room. Where a theatre has a room, each weapon's synthetic tail stands down to
a third so nothing is reverberated twice.

| Theatre | Room | Decay | Wet |
|---|---|---|---|
| blacksite | sealed concrete underground | 0.90 | .22 |
| arctic | powered installation in ice | 0.55 | .15 |
| sunken | flooded, roofless, standing water | 1.10 | .25 |
| foundry | working steel foundry | 1.40 | .29 |
| orbital | small metal interior, decommissioned | 0.70 | .20 |
| crossfall | open exterior in rain | 0.34 | .10 |
| hollow | whiteout — the deadest room in the game | 0.28 | .07 |
| mire | waterlogged forestry, no parallel surfaces | 0.46 | .12 |
| hangar | largest hard-surfaced volume, empty | 1.30 | .27 |
| proving | glass and composite laboratory | 0.62 | .18 |

Covered by `tools/reverb.mjs`.

## Per-theatre lighting — COMPLETE

Each theatre has a grade: exposure, ambient, tint, vignette, flicker. Every
value multiplies the quality preset rather than replacing it, so the low-end and
performance presets keep their meaning.

**The readability guarantee is enforced in code, not documented.** `lightingFor`
clamps every value on the way out, so no profile can darken a sector past the
point where a hostile stops being visible against it, and the tint range is
narrow enough to stay a temperature nudge rather than a colour filter.
Reduce-flashing holds the frame perfectly steady rather than damping it.

Both renderers are covered: the deferred path scales its exposure and vignette
uniforms and tints the ambient term; the 2D path scales how much of its light
layer is composited, which is the only route that renderer has.

Covered by `tools/lighting.mjs`.

## Impact source system — COMPLETE

Impacts, muzzles and camera shake all know what caused them. Nine surface types,
twelve muzzle voices, six shake layers with independent caps and decay rates.

Shake additions diminish as a layer fills, converging at 70% of its cap, so
sustained fire cannot pin the camera and leave it vibrating rather than
responding. The whole-camera cap of 0.9 is applied on both paths that touch it.

Covered by `tools/shake.mjs` and `tools/visual-identity.mjs`.

## Blood, oil and machine damage — COMPLETE

Blood sprays along the killing blow, atomises into mist, and stops. Oil comes out
under its own pressure in fat droplets, spreads further, and keeps coming — a
machine leaves a second, wider, directionless pool a body does not.

Machines additionally come apart in the air: sparks, fragments in the hull's own
colour, one electrical arc, then smoke. The objective is material identity, not
gore volume.

## Gunship destruction — COMPLETE

A destroyed aircraft keeps its momentum, loses drive to the tail rotor, and
spins in over ~1.8 seconds — long enough to read as a descent and to let anything
underneath move, short enough that the fight does not stop. Altitude is carried
by the shadow, since a top-down airframe cannot move up the screen to show
height. It lands with a hostile blast, the largest scorch and oil pool in the
game, debris, and a delayed secondary. Audible on the way down, quieting as it
falls.

Continuous voices are stopped at session teardown as well as on contract end,
because starting a new run tears the previous session down without finishing it.

Covered by `tools/wreck.mjs`.

## Command Centre progression — COMPLETE

Sections are granted or classified; classified shows what it will take and
nothing else. Development nodes declassify when affordable and stay readable
permanently. NEW badges are per-section and clear on visit.

The load itself reconciles this and persists the result — without that, `seen`
and `declassified` were rebuilt from the current balance on every load and
neither survived a restart.

Covered by `tools/progression.mjs`.

## Accessibility — IN PROGRESS

**Working:** `reducedFlashing` (screen flash, GL grain, low-health pulse,
weather, CSS class, and now theatre flicker), `screenShake` including zero,
`damageNumbers`, `showHealthBars`, `showThreatIndicators`, independent
master/music/sfx, `uiScale`, `touchSize`, `leftHanded`, `performanceMode`.

**New:** colour vision support with four modes. Not a full-canvas filter — only
the colours carrying meaning are remapped, because the problem is not that the
game is red but that two things meaning different things are the same colour.
The pair that actually fails here is incoming fire against a hazard telegraph.
Each mode separates them by lightness as well as hue, since lightness is the
channel every deficiency keeps. With any mode active, hostile rounds also get a
hard dark outline so they read by contrast rather than by hue at all.

**Still missing, not claimed:** subtitles for radio content, and visual
equivalents for the audio cues that currently have none.

Covered by `tools/accessibility.mjs`, which tests persistence from genuinely
empty storage and asserts an older save loads without losing progression.

## Dynamic lighting events — COMPLETE

Explosions, hazards, elites, the boss and burning wreckage drive lights; theatre
flicker is per-profile; and gunfire now lights the sector it happens in — six
slots, 55ms each, newest wins, pushed after the hazards so a budget overrun
drops a muzzle flash rather than a beacon. Reduce-flashing damps it to a quarter
rather than removing it.

Covered by `tools/muzzle-light.mjs`.

## Blender asset pipeline — EXPERIMENTAL, and REJECTED for shipping

`tools/blender/gunship.py` builds the Vulture from primitives and renders it
orthographically in about 1.5 seconds, using Blender as a Python module. Because
the game rotates sprites at draw time, an entity needs one render rather than a
sheet of rotations.

**It is not production and must not be treated as production**, but the earlier
verdict here was measured wrongly and has been corrected.

That verdict judged the gunship at "the ~60px it occupies on screen". The figure
was the collision radius doubled, and these sprites draw far outside their
collision radius — the gunship's rotor disc reaches 2.7x it. Measured from the
alpha bounding box, the real footprints are gunship 159px, carrier 145px,
manticore 146px, soldier 29px. Everything downstream of the wrong number was
pessimistic.

The cause it identified was right: the procedural art's light outline stroke,
not its shading, is what holds a silhouette at size. The pipeline now renders at
6x, dilates the alpha into a hard edge at a weight given in *final* display
pixels, and downsamples — one pipeline serving a 29px soldier and a 158px siege
platform with the same apparent line.

At true size the result is mixed and asset-dependent: the **carrier** and
**gunship** are clearly better than the shipping sprites; the **manticore** is
clearly worse, because a boss carries semantic colour and a neutral metal
palette throws that away — geometry was never the problem there; the **soldier**
is a wash at 29px.

Four things still block shipping: the boss needs colour identity, there is no
sprite-loading path, baked art gives up runtime recolouring from `enemy.color`
(elites, cloaking, walker damage), and mixing Blender vehicles with procedural
bosses would look less consistent than either alone.

Details and the comparison method in `tools/blender/README.md`.

## Command Centre presentation polish — PLANNED

The ladder works; its presentation has not been reworked.

---

## Performance budget

| Budget | Value | Enforced where |
|---|---|---|
| Audio voices | 24 concurrent, non-essential dropped past it | `canPlay` |
| Reverb impulse | ≤1.4s, ×0.55 in performance mode | `setReverbProfile` |
| Reverb graph | built once at unlock; nothing per contract or per frame | `buildReverb` |
| Decals | baked into one half-res layer past 90 | `drawDecals` |
| Shake, per layer | own cap; sustained input converges at 70% | `addShake` |
| Shake, whole camera | 0.9 | `addShake` and `update` |
| Lighting grade | exposure, ambient, tint, vignette, flicker all clamped | `lightingFor` |
| Ambient events | scheduled with randomised gaps, cleared on stop | `scheduleAmbientEvent` |

## Testing methodology

A test is not trustworthy because it passes. For every meaningful assertion:
run against the correct implementation and confirm it passes; introduce the
defect it is meant to detect; confirm it **fails**; restore; confirm it passes
again.

This has repeatedly caught assertions that were measuring nothing. Recorded
examples, all real:

- A distinctness check compared pitches that carry a per-shot random wobble. It
  passed on a build where all seven table entries had been overwritten with
  identical values — it was measuring `Math.random`.
- Captures ran without resetting the voice budget, so early measurements spent
  all 24 voices and everything after them was silently empty.
- A dry-state check used a tolerance, which cannot distinguish an exponential
  that has nearly finished from one that never lands.
- A decay check called `camera.update?.()`; optional chaining on a renamed
  method silently does nothing and the assertion passes on an untouched object.
- A stale-timer check called the scheduler directly, which returns at its own
  guard whatever the pending timers are doing.
- A contract-ending check passed with the stop removed outright, because
  finishing cascades into teardown which also stops it.
- Harnesses seeded a legacy storage key, and a versionless save is migrated away
  from — so gates were asserted against a default save.

## Save compatibility

The save is versioned and `normalizeSave` merges over defaults. `mergeRecord`
iterates the *incoming* save's keys, so a stored value survives whether or not a
default exists for it.

No field is removed or renamed by this pass. `colorblind` already existed and is
now read. Loading a save with no colour-vision field is asserted to preserve
campaign progress, declassified nodes and seen state.

Declassification is one-way by construction: the save records what has been
cleared rather than recomputing it, so it cannot be relocked.
