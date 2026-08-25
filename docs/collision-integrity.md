# Collision and gameplay integrity

The rule this document exists to keep: **rendering is downstream of
simulation**. The renderer consumes world state and never defines it. Choosing
between the Canvas 2D and the deferred WebGL2 renderer must change what a
contract looks like and nothing about how it plays.

## Proving it, rather than asserting it

Three checks, all reproducible.

### Renderer parity

`scratchpad/parity.mjs` (developer harness) starts the same contract seed under
both renderers, normalises the starting state, stands the director down, places
a fixed hostile ring, then drives **the simulation directly** with a scripted
input stream at a fixed 1/60 step — 900 ticks of a figure-of-eight walk into
geometry with the weapon firing throughout.

It compares simulation state, never pixels: player position to three decimals,
HP, live hostile count, projectile count, kills, level, elapsed time, and a
rolling hash over every hostile's position and HP, sampled every 150 ticks.

**Run the control first.** `parity.mjs <theatres> <ticks> 2d:2d` runs Canvas 2D
against itself. Until that passes, a mismatch between renderers proves nothing,
because it cannot be told apart from the harness comparing two runs that had
already diverged.

Getting the control to pass took five rounds, and every one of them was the
harness rather than the engine. Both renderers spend a different number of real
frames reaching the first scripted tick — the GL path is far slower under a
software rasteriser — and everything that had been accumulating during that
pre-roll carried the difference forward: the RNG stream position, the contract
clock, the hostile population, cover points still claimed by hostiles that had
been detached rather than killed, hazard cycle timers, and finally the weapon
cooldown, which decided whether the first round went out on tick 9 or tick 12
and took every hostile's HP with it.

That is worth stating plainly: **no non-determinism was found in the
simulation.** Reset those seven things and two runs of the identical build
agree to the last decimal for 170 consecutive ticks with the RNG landing on the
same state. `scratchpad/diverge.mjs` is the bisector that established it — it
runs the same build twice and reports the first tick, entity and field that
disagree.

### Wall clipping

`scratchpad/clip.mjs` drives a body with the operative's radius at full dash
speed into geometry across all ten theatres and counts two failures:

* **tunnelled** — the body crossed a solid's centre plane in one step while
  strictly inside that solid's face span. That is passing through a wall,
  whatever the end position looks like.
* **sunk** — the body finished a step buried more than half its radius inside
  solid geometry.

`--legacy` runs the old integrate-then-depenetrate path for comparison.

### Sector geometry

`scratchpad/doorway.mjs` generates every theatre at many seeds and reports, per
theatre: what fraction of standable ground is reachable from the operative's
start by a flood fill at the operative's own radius; how many open cells are
stranded; how many spawn candidates land inside geometry; whether the fallback
spawn is valid; whether the operative's own start is valid; and whether any
hazard sits inside a wall.

A doorway that looks open is traversable if and only if the fill gets through
it, so reachability *is* the doorway test — at the radius that has to fit.

## What the checks found

| Defect | Renderer | Root cause |
|---|---|---|
| **The operative walks through the middle of every long wall** | both | `SpatialHash.insert` indexed each item by the single cell its **centre** landed in. Collision queries about a hundred units around the entity, so any wall whose centre was further away than that was simply not returned. A sector perimeter is over two thousand units long; an interior wall is hundreds. Collision only worked near a wall's centre. Every consumer was affected — collision resolution, line of sight, projectile raycasts and hostile proximity. This is the headline defect of the pass. |
| Negative frame delta inverts the camera and stalls the simulation | both | A `requestAnimationFrame` timestamp is the moment the frame began, and it can precede a `performance.now()` taken later inside that same frame. Only the upper end of the delta was clamped. One negative delta ran the camera's `damp` backwards and took its zoom to about **-574** — a negative zoom mirrors the whole view and every screen-to-world conversion through the operative — for the two seconds it took to converge back. It also drove the simulation accumulator negative and stalled the fixed step. It appears on the slowest startup path, which is where a phone lives. |
| Operative starts inside solid geometry, 14 sectors in 80 | both | The start was resolved before vaults, cover and hazards were placed, and was never re-checked afterwards. When no room had clearance the code returned an unvalidated `rooms[0]`; with no rooms at all it returned the bare arena centre, which three layouts build on. |
| Entity buried in geometry near the sector edge | both | `resolveCollision` clamped to the arena bounds *after* depenetration, so for any solid near the edge the clamp shoved the entity back into the wall it had just been pushed out of. Whatever runs last wins. |
| Entity buried in a corner | both | Depenetration ran a single pass, so pushing out of the wall on the left could push into the crate below, and that crate had already been visited. |
| Player and hostiles pass through walls under dash | both | Movement integrated the whole step then pushed the entity out of whatever it had ended up inside. A dash covers ~26 units in a 1/60 step; the shallowest cover is 24 deep, so a dash could finish on the far side with nothing left overlapping to correct. |
| Mouse aim wrong on every HiDPI display | both | `clientX/clientY` are CSS pixels; the camera works in drawing-buffer pixels. At dpr 2 the pointer was treated as half as far from centre as it was. Turning on performance mode dropped the buffer to dpr 1 and aim silently became correct — a graphics setting changing how the game played. |
| Hostiles deploy on screen on a phone in portrait | both | Deployment distance was `camera.viewHalfWidth(margin)` — a function of the browser window. Desktop deployed at ~460 world units, an iPhone in portrait at ~272, well inside the 590 units that phone can see vertically. It also moved with the cosmetic zoom punch on a boss reveal. |
| Fast rounds pass through hostiles | both | Projectile-versus-hostile was a point test at the end of the step. At 1500 units/second a step is 25 units — wider than most hostiles. |
| Impact marks inside walls | both | The round detonated wherever it had been integrated to, up to 25 units past the surface it hit. |
| Hostiles deployed into sealed pockets | both | Spawn search checked clearance but not which side of the geometry a candidate was on. |
| Oversized units deployed overlapping walls | both | Spawn clearance was a fixed 26 units for everything, including a 30-unit carrier and a 34-unit command signature. |

### How the wall bug hid

It survived a first stress test that reported zero failures, because that test
aimed the body at the *nearest solid by centre distance* — so contact always
happened near a centre, which was the one place collision worked. The test was
rewritten to charge a random point along a long wall's face, and against the
original code it immediately produced 1,469 tunnelling events and 611 buried
frames in 180,000 steps. Against the fixed code, zero of each.

That is the lesson worth keeping: a collision test that only ever touches
geometry where the broad phase is strongest will pass a broken broad phase.

**No defect in this pass was WebGL-only.** Every one predates the deferred
renderer and is present in Canvas 2D. The renderer work made several of them
easier to see; it caused none of them.

## The fixes, as architecture

**`World.moveEntity(entity,dx,dy,radius)`** is now the single movement path for
the operative, hostiles and deployables. It substeps by the entity's own
radius, so no substep is longer than the entity is wide and tunnelling is
impossible by construction rather than by tuning. Nearly every call is one
substep; the count is capped so a pathological velocity cannot turn a frame
into hundreds of queries.

**`Camera.cssToWorld`** converts a pointer position in the CSS pixels the
browser reports into world space, using the buffer-to-layout ratio recorded at
resize. `Camera.resize` now takes both sizes. Aim goes through it.

**`DEPLOY_RADIUS`** in the director is half the diagonal of the largest slice of
world the camera will ever show — a world-space constant, not a viewport
reading. It is off screen on every device and at every zoom, and it sits inside
the range the desktop build already used.

**`World.buildReachability`** flood-fills standable ground from the operative's
start once at generation, over a 32-unit grid. `findSpawn` consults it, so a
deployment onto ground the operative cannot reach is rejected in constant time.

**`World.openPointNear`** is the one primitive behind both fallback paths, and
`computePlayerSpawn` never returns an unvalidated point. The start is
re-checked after all geometry exists — the only moment the question can
actually be answered — and cover is kept off it while it is scattered.

**`SpatialHash`** now indexes an item across every cell its extent overlaps
rather than the one its centre falls in, and `query` de-duplicates with a
per-query stamp so a caller that accumulates — applying blast damage to
everything returned, say — cannot hit the same target once per cell it
straddles. Static geometry is inserted once per rebuild and entities occupy a
single cell, so the extra buckets cost nothing measurable.

**`segmentHitsCircle`** and **`segmentRectEntry`** in `core/math.js` give
projectiles a swept test against hostiles and a real entry point against
geometry, so a fast round hits what it flew through and its impact lands on the
surface.

## Deliberate mismatches

**Hazard damage tests the operative's centre, not their body.** The drawn ring
is exactly `hazard.radius` and so is the damage test, but the test is against
the centre point, so an operative whose sprite half-overlaps the ring is not
yet taking damage. This is lenient rather than punishing, it is long-standing
balance, and changing it would make every hazard in the game hit harder. The
collision overlay draws both rings — solid for the damage radius, dashed for
radius plus body — so the gap is visible rather than folklore.

**PROVING GROUND is 60% reachable and that is correct.** It is "a sealed
circular floor with no cover and no exit". Every unreachable cell measured is
outside the arena ring and none is inside it; the operative starts at the exact
centre.

**Landmark cover keeps its authored footprint.** Cover drawn as an authored
landmark — a tree trunk, a wrecked airframe, a boulder — collides as the
simulation's box, which is what the AI, the projectiles and the player all use.
The art is fitted to the box, not the other way round.

## Collision debug overlay

Add `?collisiondebug=1` to the URL. It works under either renderer and draws
from live simulation data — `world.walls`, `world.cover`, `entity.radius`, the
same `hazard.radius` the damage test uses — never from sprite bounds. If the
drawn shape and the played shape ever disagreed, an overlay reconstructed from
art would be wrong in the same direction as the bug and would prove nothing.

| Colour | Shape |
|---|---|
| Red boxes | Perimeter walls |
| Blue boxes | Interior walls |
| Amber boxes | Destructible cover |
| Teal boxes | Permanent cover |
| Struck-through grey | Broken cover, no longer solid |
| Violet dashed boxes | Vault chambers |
| Red rings | Hazards — solid is the damage radius, dashed adds the operative's body |
| Orange circles | Hostiles, at the radius collision and hit detection use |
| Violet circles | Flying hostiles, which geometry does not stop |
| Blue circles | Squadmates |
| Yellow / orange dots | Friendly and hostile rounds |
| Green circles | Pickups and their collection radius |
| Teal circle | The operative, plus the pickup magnet range |
| Gold dashed ring | Extraction hold radius |
| Grey / amber pixels | AI cover points, amber when claimed |

A readout in the bottom-left reports the active renderer, theatre, frame rate,
simulation rate, the operative's world coordinates, sector size, live hostile
and round counts, and geometry totals. It is the panel to photograph if
something looks wrong on a phone.

Combine it with either renderer:

```
?collisiondebug=1                     whatever AUTOMATIC picks
?collisiondebug=1&visualtest=1        over the benchmark harness
```

## Measured results

All figures below were produced by the harnesses in `tools/`, in headless
Chromium. There is no GPU in this environment — WebGL2 runs on SwiftShader — so
**no frame-rate figure here means anything about a real device.** Everything
reported is a correctness count, which is hardware-independent.

### Wall clipping — `clip.mjs`, 180,000 dash-speed steps, all ten theatres

| | tunnelled | buried in geometry |
|---|---:|---:|
| Original (`bce7bae`), centre-aimed charges | 15,021 | 12 |
| Original (`bce7bae`), face-aimed charges | 1,469 | 611 |
| Current | **0** | **0** |

The first row is why the second exists. Aiming only at solids' centres charged
the one place a centre-indexed broad phase worked.

### Sector geometry — `doorway.mjs`, 100 generated sectors per theatre set

| | before | after |
|---|---:|---:|
| Operative starts inside geometry | 14 in 80 | **0 in 100** |
| Spawn candidates inside geometry | 0 | 0 |
| Invalid fallback spawns | 0 | 0 |
| Hazards inside walls | 0 | 0 |
| Deployments onto unreachable ground | not checked | **0 of 12,000** |
| Reachable ground, worst theatre excluding PROVING | 62.0% | **98.6%** |
| Reachable ground, best | 99.4% | 99.5% |

PROVING GROUND stays at 60% by design; every unreachable cell measured is
outside the arena ring and none is inside it.

### Renderer parity — `parity.mjs`, 600–900 ticks, simulation state compared

Control (`2d:2d`) green on BLACKSITE ZERO, ASHEN MIRE and PROVING GROUND before
any renderer claim was made.

| Theatre | Canvas 2D vs WebGL2 |
|---|---|
| BLACKSITE ZERO | PARITY OK |
| ARCTIC RELAY | PARITY OK |
| SUNKEN DISTRICT | PARITY OK |
| CINDER FOUNDRY | PARITY OK |
| MERIDIAN PLATFORM | PARITY OK |
| CROSSFALL SPAN | PARITY OK |
| HOLLOW VALLEY | PARITY OK |
| ASHEN MIRE | PARITY OK |
| DERELICT HANGAR | PARITY OK |
| PROVING GROUND | PARITY OK |

### Presentation changes must not move the world — `scratchpad/resize.mjs`

Orientation flip, a browser-UI height change, a return to the original size,
pause and resume, across five configurations including an iPhone-portrait
viewport and a simulated driver failure that forces the canvas element to be
replaced:

* operative moved 0.0000 world units in every case
* sector geometry unchanged in every case
* exactly one game canvas in the document in every case
* a fixed CSS pointer position resolved to the **same world angle at dpr 1 and
  dpr 2** — the direct proof of the aim fix, since before it the two disagreed

### Gameplay matrix — `scratchpad/matrix.mjs`, exercised not asserted

BLACKSITE ZERO and ASHEN MIRE, under both renderers: 119 and 24 drives straight
into interior wall faces with 0 pass-throughs and 0 buried; 56 and 22 diagonal
corner drives with 0 buried; 28 and 26 cover collisions with 0 buried; 40
hostiles placed with 0 inside geometry, 0 on unreachable ground and 0 samples
inside geometry while manoeuvring; rounds fired with 0 ending up inside
geometry; hazards damaging inside their drawn ring and **0 damage taken outside
it**; every pickup collected; pause and resume with the operative moving 0
units; and the results screen reached on run end. No page errors.
