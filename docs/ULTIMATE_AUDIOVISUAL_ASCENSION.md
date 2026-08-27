# Ultimate Audiovisual Ascension

Working document for the audiovisual production pass. Records what the
repository **actually contains** as of the baseline commit, what this pass
changes, and what remains unproven.

Status vocabulary, used strictly:

| Term | Meaning |
|---|---|
| **implemented** | Written, wired, and exercised by a test or a measurement in this document |
| **partial** | Works for some cases; the gaps are named |
| **scaffolded** | Architecture exists, content does not |
| **validated** | A named tool or measurement proves it, and the result is recorded here |
| **device-pending** | Cannot be proven in this container; needs physical hardware |

Nothing is called finished because it exists.

---

## 0. Repository forensics

Performed before any code was modified.

### 0.1 Repository identity — a discrepancy

The brief names the repository `OuterHeavenX/RED-STATIC`. **No such repository
exists** on the account. Enumerating everything reachable returns nineteen
repositories, none named RED-STATIC.

The game called RED STATIC lives in `OuterHeavenX/Phantom-Protocol` — the
console logs are prefixed `[red-static]`, the marketing site branch is
`feature/red-static-premium-website`, and `<title>` reads `RED STATIC`.
`Phantom-Protocol` is the repository name; RED STATIC is the game's name.

Treated as the same project. Flagged rather than silently assumed.

### 0.2 Branches

| Branch | Head | State |
|---|---|---|
| `main` | `c03000a` | Validated production. All other branches merged into it. |
| `claude/phantom-protocol-improvements-edbj2c` | `c03000a` | Synced to main |
| `feature/deferred-renderer-all-theatres` | `f606501` | Fully merged |
| `feature/blacksite-authored-art` | `9535bd4` | Fully merged |
| `feature/red-static-premium-website` | `7f0aa35` | Fully merged |

Every branch reports 0 commits not in `main`. There is no unmerged
experimental renderer work to recover — it already shipped.

`feature/ultimate-audiovisual-ascension` did not exist and was created fresh
from `c03000a`. Working tree was clean; no uncommitted work was at risk.

No CI workflows exist (`.github/workflows` absent).

### 0.3 Baseline test results, run before editing

```
tools/check.sh          eslint clean · construction order 0 findings / 38 classes
tools/parity.mjs        blacksite 2d:2d  PARITY OK   geometry 46/135/7
tools/align.mjs         5/6 markers located, worst offset 8.4px -> ALIGNED
tools/clip.mjs          10 theatres, tunnelled 0, sunk-in-geometry 0
```

Recorded as the bar this pass must not fall below.

### 0.4 What the brief assumes vs. what exists

The brief describes six theatres. **Ten** are implemented:

| Brief | Implemented | Note |
|---|---|---|
| BLACKSITE ZERO | `blacksite` BLACKSITE ZERO | matches |
| ARCTIC RELAY / HOLLOW | `arctic` ARCTIC RELAY, `hollow` HOLLOW VALLEY | two separate theatres, not one |
| SUNKEN DISTRICT | `sunken` SUNKEN DISTRICT | matches |
| RED DESERT | — | **does not exist**; nearest is `mire` ASHEN MIRE |
| ORBITAL ELEVATOR TERMINAL | `orbital` MERIDIAN PLATFORM | different name, same idea |
| DEAD SIGNAL | — | **does not exist** as a theatre |
| — | `foundry` CINDER FOUNDRY | unlisted in brief |
| — | `crossfall` CROSSFALL SPAN | unlisted |
| — | `hangar` DERELICT HANGAR | unlisted |
| — | `proving` PROVING GROUND | unlisted |

Any theatre work covers the ten that exist. RED DESERT and DEAD SIGNAL would be
new content, not an upgrade, and are out of scope for an *audiovisual* pass
unless separately commissioned.

### 0.5 Rendering — already far along

Phases 1–3 of the brief are substantially **already implemented**, from earlier
work in this repository:

- Selectable renderer: `auto` / `2d` / `gl`, chosen in `createRenderer`
  (`src/main.js:284`), with safe fallback on construction failure including
  canvas replacement and stray-layer cleanup.
- WebGL2 deferred renderer across all ten theatres (`src/render/gl/deferred.js`):
  MRT G-buffer, instanced light volumes, separable bloom, 22 procedural
  materials, contact shadows and a height-derived solid edge.
- Quality presets LOW / MEDIUM / HIGH / **ULTRA** already exist
  (`src/render/gl/presets.js`) with thirteen individually switchable features.
- Renderer parity against Canvas 2D is proven by `tools/parity.mjs` on all ten
  theatres, with a 2d-against-2d control that must pass first.

**So the honest finding is that this is not a renderer that needs rebuilding.**
The gap is elsewhere.

### 0.6 Where the real gap is — measured

```
30 weapons  ->  6 distinct sounds
      tech x9   laser x6   shoot x5   explode x5   shootHeavy x3   scramble x2

23 enemy archetypes  ->  0 sounds     (grep -c "sound:" data/enemies.js == 0)

audio buses: 2         (sfxBus, musicBus)
spatial audio: none    (distance attenuation only, added this session; no panning,
                        no reflection, no occlusion, no environment zones)
```

A submachine gun and a marksman rifle are the same sound. Nine different
weapons play `tech`. Every enemy in the game is silent apart from the sounds its
*weapon* makes. There is no reverb, no environment awareness, no per-category
mixing, and no voice budget beyond a per-name throttle.

**This is the largest measurable gap in the project and it is exactly what
Phases 9, 10, 11 and 13 of the brief describe.** The visual side has had four
production passes; the audio side has had one, and it was a rebalance rather
than a rebuild.

---

## 1. Plan

Ordered by measured gap, not by the brief's numbering. Each phase must leave the
baseline in §0.3 passing.

| # | Phase | Brief ref | Why here |
|---|---|---|---|
| A | Audio architecture: buses, voice budget, mix priority | 13 | Everything else needs somewhere to plug in |
| B | Weapon audio rebuild — layered, per-class, varied | 9 | 30 weapons / 6 sounds is the worst ratio in the codebase |
| C | Enemy audio identity | 11 | 23 archetypes, zero sounds |
| D | Environment-aware audio — zones, reflection, occlusion | 10 | Makes A–C respond to the sector |
| E | Theatre ambience profiles | 4 (audio half) | Ten theatres, one ambience model |
| F | Weapon and impact visual identity | 7 | Muzzle/impact work, bounded by existing budgets |
| G | Material and lighting refinement per theatre | 2, 3, 4 | Refinement of a working system, not a rebuild |
| H | Camera response layering | 8 | Existing shake is single-channel |
| I | Accessibility completion | 19 | Audit what exists against the brief's list |
| J | Quality tiers + truthful settings reporting | 15, 1 | ULTRA exists; reporting does not |

Non-negotiables carried through every phase:

- The renderer stays presentation-only. `tools/parity.mjs` proves it.
- No unbounded particles, decals, or audio voices.
- Collision geometry is never derived from decorative art (`tools/clip.mjs`).
- Nothing merges to `main` in this pass.

---

## 2. Phase A + B — audio architecture and weapon rebuild

*(Recorded as implemented below; see §5 for validation.)*

### 2.1 Bus topology

Replaces a flat two-bus mixer with a categorised one, so priority and ducking
can act on classes of sound rather than on individual calls.

```
                                      ┌── ui ──────────┐
                                      ├── alert ───────┤   (never ducked)
  source ── category bus ── limiter ──┼── playerWeapon ┤
                                      ├── enemyWeapon ─┤
                                      ├── impact ──────┤
                                      ├── enemy ───────┤
                                      └── ambience ────┘
                                                    │
   music ── musicBus ── musicDuck ──────────────────┼── master ── destination
```

`alert` deliberately bypasses ducking: a critical-health or boss-telegraph cue
must never be attenuated by the thing that made it urgent.

### 2.2 Weapon sounds as layered events

Each shot is assembled from named layers rather than played as one blob:

1. **mech** — the action cycling
2. **crack** — the initial transient
3. **body** — the weapon's own resonance
4. **pressure** — low-frequency push
5. **tail** — environmental reflection

A weapon class supplies the recipe; the environment supplies the tail. Round-to-
round variation is applied to pitch, transient level and tail length so
automatic fire does not retrigger an identical event — varied within a narrow
band, so it reads as the same weapon rather than as randomisation.

### 2.3 Asset provenance

**All audio in RED STATIC is synthesized at runtime** from oscillators and
shaped noise (`src/core/audio.js`) — there are no sound samples in the
repository and none are added by this pass. There is therefore no third-party
audio licensing to record: every sound is generated by original code in this
repository.

The authored *music* tracks are pre-existing and untouched by this pass.

No copyrighted material was downloaded, copied, or committed.

---

## 3. Quality tiers

| Tier | State |
|---|---|
| LOW | implemented, pre-existing |
| MEDIUM | implemented, pre-existing |
| HIGH | implemented, pre-existing |
| ULTRA | implemented, pre-existing |
| CINEMATIC | **not exposed** — would be dishonest without hardware to prove it |

Automatic selection is conservative: `auto` takes WebGL2 only where the probe
reports non-software rendering.

---

## 4. Known limitations of this environment

Recorded because the brief demands device evidence rather than claims:

- **No GPU.** Chromium here falls back to SwiftShader. No frame-rate figure
  produced in this container describes real hardware.
- **No audio device.** The AudioContext barely renders; gain automation is not
  reliably observable. Audio *decisions* can be asserted; the *mix* cannot be
  heard. Every audio claim below is about structure and levels, not about how it
  sounds.
- **No physical phone.** Every "iPhone" measurement is a viewport override,
  which shares no CPU, GPU, thermal budget or browser with the device.

Anything depending on these is marked **device-pending**.

---

## 5. Validation

### Phases A + B — **implemented, validated**

`tools/weapon-audio.mjs` asserts the architecture against the running game:

```
forms                30     every weapon and evolution
families             10     pistol/suppressed/rifle/smg/shotgun/marksman/
                            sniper/lmg/heavy/beam/tech/corrupted (12 defined,
                            10 in use)
unresolved            0     no weapon falls through to a default
channels              7     playerWeapon enemyWeapon impact enemy ambience ui alert
weapon -> playerWeapon     true
hurt   -> alert            true
layersPerShot         5     mech, crack, body, pressure, tail
identicalRounds       0     of 8 consecutive rifle shots
duckedPlayerWeapon  0.6     an alert takes 40% and releases on a ramp
```

Distribution across families: tech 5, heavy 5, corrupted 5, beam 4, sniper 2,
shotgun 2, marksman 2, suppressed 2, rifle 2, smg 1. Evolutions inherit their
base weapon's family, which is why the counts are not all one.

Baseline held after the change:

```
tools/check.sh     eslint clean · construction order 0 findings / 38 classes
tools/parity.mjs   blacksite PARITY OK · foundry PARITY OK   (2d:2d control)
tools/align.mjs    5/6 located, worst offset 8.9px -> ALIGNED
tools/clip.mjs     10 theatres, tunnelled 0, sunk-in-geometry 0
```

Parity passing matters specifically here: the weapon rebuild uses `Math.random`
for round-to-round variation, and parity proves that has not leaked into the
simulation's own random stream.

**Not validated:** how any of it sounds. See §4 — this container has no audio
device. The mix is **device-pending**.

### Phases C–J

Not started. Scaffolding does not exist for them and none of them are claimed.

---

## 6. Still required on physical hardware

- Weapon mix on phone speakers at low volume
- Whether enemy cues survive without headphones
- Frame time under maximum enemy density on an iPhone
- Thermal behaviour across a full 20-minute contract
