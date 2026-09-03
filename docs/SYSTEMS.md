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

## Authored entity art — COMPLETE (shipped)

Seven Blender renders are now drawn in the running game: the gunship, the
carrier, infantry, and all four boss hulls. `src/render/entityart.js` loads
them; `drawEnemy` and `drawBoss` use them where one exists.

Three rules govern it:

- **Moving parts stay procedural.** Boss legs are animated from the gait and the
  gunship's rotor from its spin rate, so only hulls are baked. A walker that
  glides is the most obvious way to make an expensive asset look cheap.
- **Nothing is required.** Every entity keeps its procedural routine, which
  draws until the image decodes and forever if it is missing.
- **Runtime colour still works.** Elites tint through a small cache of
  pre-composited canvases; `tintFor` holds the policy so it can be asserted.

Total asset weight is 96 KB for all seven.

Covered by `tools/entity-art.mjs`, whose central assertion is that the frame
differs with the art layer on and off — the check that would have caught the
pipeline never being wired in at all.

## Authored character and machine art — COMPLETE (shipped)

The roster: twelve enemy body kinds, and the operative in eight per-operative
variants. Rendered by `tools/blender/render.py` from one parametric figure
(build, helmet, weapon, pack, armour, shield, charge) plus four small-machine
builders, in the game's own units so a render scales with `radius` exactly as
the procedural sprite did. Colours are read out of `data/enemies.js` and
`data/operatives.js` at render time and never restated.

**What is baked and what is not.** Bodies only. Every unit's moving part stays
procedural and is drawn under or over the render by `ART_PARTS`: legs swing
from the walk phase on all infantry, rotors turn on the drone, the crawler's
legs wobble, the jammer's dish rotates and pulses, the warden's ring
counter-rotates, the sapper's charge pulses, the veil shimmers, the marauder's
enrage ring shows. Each fragment is lifted from the procedural renderer it came
from, so the animation is identical whichever body is under it. A hit flash
draws the procedural body for that one frame, because a baked render cannot go
white.

**The operative** is eight one-kilobyte renders rather than one tinted sprite,
because a whole-figure tint would shift the teal body along with the accent.
One capability is given up on this path and recorded here: the livery weapon
tint, which coloured the weapon in the operative's hands — the weapon is part
of the render.

**Sizing is asserted, not assumed.** The harness compares each baked body's
on-screen extent against the procedural sprite it replaces and fails outside
0.8–1.3×. The first render pass shipped the sniper at 0.77 and the heavy at
0.63 of their footprint. The bodies were not small and the weapons were not
short: the weapons were *clipped by the frame*, because the origin sits at the
frame centre and the frame was sized to the sprite's width rather than twice
its forward reach. The renderer now refuses to clip.

**Three top-down modelling lessons**, each found by looking at the sheet:

- A vertical shield slab is a line from above. It has to be angled to have any
  width in the frame.
- The drone's rotor hubs were the rotor colour, so the runtime arcs drawn over
  them were invisible — and measured as frozen. Hubs are dark now.
- An emissive plate on top of a dark chassis washes the whole unit pale. The
  warden's rim is a thin edge.

**The honest limit.** Infantry are 28–40 px wide on screen and a face is two
pixels. "Detailed" is not available at that size in any pipeline. What the
render buys is a solid, lit, outlined silhouette; the heavies at 46–63 px are
where the extra pixels actually show, and the verdict below is per kind for
that reason.

**Verdict per kind, from the art-on/art-off sheet at true size (3× zoom to
read it, judged at 1×):**

- **Heavy — clear gain.** An armoured exo figure with a rotary cannon on its
  shoulder replaces a grey blob with a tube. The one infantry body with enough
  pixels (63) for form to show, and it does.
- **Mortar, crawler, sapper — gain.** The tripod and tube read as a mortar
  where the procedural sprite was a two-legged lump; the crawler has a body
  with volume under its legs; the sapper's charge is a lit sphere on a pack.
- **Shield, sniper, soldier, augment, veil — a solid lit silhouette, not
  "detail".** Same footprint as before (0.95–1.13), rounder shoulders, a helmet
  and a weapon with thickness. At 28–40px a face is two pixels in any
  pipeline; these are cleaner, not richer. The shield's pale accent reads
  weaker than the procedural yellow outline it replaces.
- **Drone — a wash.** A 22px X-frame under animated arcs; the render is
  thinner than the diamond it replaces (0.86) and neither is better.
- **Jammer, warden — a wash on form; the warden's hull reads lighter.** The
  moving dish and ring are the identity of both units and stay procedural, so
  the baked hull is a box or a hexagon either way. The lit top face of the
  warden hull is paler than the procedural dark green.
- **Operative — slightly darker and 0.85 of the procedural width.** The body
  is the same `#22484c`; the procedural version's bright livery weapon is the
  contrast that is given up, and it is the one sprite on screen all run. Worth
  a pass of its own if the player reads as dim in play.

Sizing after the frame fix: soldier 1.04, shield 0.95, sniper 1.03, heavy
1.02, veil 1.13, augment 1.04, sapper 1.00, mortar 1.08, drone 0.86, crawler
1.11, jammer 1.00, warden 1.00, operative 0.85. Total weight for all 26 assets
is 168 KB.

Covered by `tools/entity-art.mjs`.

## Blender asset pipeline — COMPLETE (production source)

`tools/blender/render.py` is the source of every PNG in
`assets/sprites/entities/`: twenty-six assets from primitives, rendered
orthographically with Blender as a Python module. The renderer enforces three
things structurally rather than by convention: the camera is centred on the
entity origin (asserted), units per pixel are derived per kind so `ref` in
`entityart.js` stays correct (`span_for`), and a model that would be clipped by
its frame aborts the render with the size it needs (`fit()`).

That last guard exists because of a defect found late: the sniper and heavy
weapons were cut off at the frame edge, so three successive passes that
lengthened the weapon changed nothing on screen. The frame has to be twice the
forward reach, not the sprite width, because the origin is the frame centre.

What the pipeline gives up, and what replaces it: whole-figure runtime
recolouring from `enemy.color` is replaced by the elite tint cache and by
per-operative renders; the hit flash draws the procedural body for its one
frame. Baked art is never required — every entity keeps its procedural routine
as the fallback.

Details, measurements and modelling lessons in `tools/blender/README.md`.

## Stage collision — COMPLETE

The owner reported that "some stages' collision is very confusing and many
doesn't make sense". The collision code was not the cause. Every theatre was
rendered with `?collisiondebug=1` over its art, and the confusion came from
eight places where what stopped the operative and what the operative could
see were different things:

- **Hazards were placed inside geometry.** The placement clearance relaxed to
  18% of the radius as attempts ran out, so drifts crossed ridge walls, spore
  blooms sat half under a parapet and slicks sat inside sealed vaults. A zone
  that slows or burns while mostly buried reads as the geometry misbehaving.
  Clearance now holds at 55% and the hazard is dropped instead; centres also
  stay 70% of their combined radii apart, so two zones do not read as one with
  the wrong radius.
- **Aircraft wings and tails had no collider.** The airframe is drawn 108
  units out from the fuselage each side and only the fuselage stopped anyone.
  Boxes now lie along each swept panel; they block movement, not sight.
- **Conifers had no collider at all.** The trunk has one now, 30% of the drawn
  size; the canopy is overhead and is still walked under.
- **Bridge wrecks had a random collider under fixed art.** A box 84–132 wide
  under a 108-unit vehicle left invisible wall past one bumper and let the
  operative into the other, and a yaw of up to 14° turned the art away from
  the box. The collider is the art's footprint and the yaw is under 7°.
- **The ridge crest was drawn 25 units past its wall.** The wall now spans the
  crest.
- **The Proving Ground ring stopped the operative fifty units early on the
  diagonals.** Forty-four long axis-aligned slabs became 128 small blocks; the
  wander is 14 units, measured by ray-marching the ring.
- **Pillars were drawn round on square colliders.** Eight units of invisible
  wall at every corner of dozens of pillars per interior sector. The column
  now stands on a square base plate, which is also what the GL renderer
  already drew.
- **The 2D renderer never drew the perimeter.** The sector ended at a dashed
  line with darkened floor continuing past it — an invisible wall on every
  edge, while the GL renderer stood a solid one there. It is drawn now, except
  where it lies out in a theatre's water.
- **Passive slow zones were drawn at 16% alpha** and could not be seen over a
  dark floor, so the drag they apply read as the ground catching. They are
  filled at 26% with a firm edge and an inner ring.

Two things were seen and deliberately left: boulders keep an axis-aligned
collider under rotated art (the mismatch is a few units at the corners), and
the landmark theatres still receive the generic crate and container scatter
from `coverDensity`, which is thematically odd but collides exactly as drawn.

Covered by `tools/stage-collision.mjs`, which asserts each of the nine points
above across every theatre and three seeds. All ten mutations that reintroduce
a defect are caught; the restored state passes.

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
