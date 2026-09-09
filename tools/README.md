# Developer checks

`check.sh` is the one that must pass before a commit: eslint's `no-undef` plus
`construction-order.py`. Both exist because each caught a shipped bug that
stopped the game starting.

The three `.mjs` harnesses below are gameplay-integrity checks. Two need only
node; the parity one needs a browser and a served copy of the game.

| Tool | Needs | Answers |
|---|---|---|
| `clip.mjs [steps] [--legacy]` | node | Can anything move through a wall? Drives a body at dash speed into geometry across all ten theatres and counts tunnelling and deep penetration. `--legacy` runs the old integrate-then-depenetrate path to show the difference. |
| `doorway.mjs [seeds]` | node | Is the sector traversable and are spawns valid? Flood-fills standable ground from the operative's start at their own radius, then audits spawn candidates, the fallback spawn, the operative's start and hazard placement. |
| `parity.mjs [theatres] [ticks] [a:b]` | node + playwright + a server | Does the renderer change the game? Runs the same seed and the same scripted input under two renderers and compares simulation state, never pixels. The fourth argument picks the pair; `2d:2d` is the control that must pass first. |
| `diverge.mjs [renderer]` | node + playwright + a server | When parity fails, where? Runs the same build twice and reports the first tick, entity and field that disagree. |
| `align.mjs [gl\|2d] [--shake]` | node + playwright + a server | Does the renderer draw a hostile where its collider is? Recolours hostiles to palette-safe key colours, finds each one's centroid in the composited frame, and compares it in pixels with the world-to-screen position of its collider. Exits non-zero on a miss. |
| `ground-orientation.mjs` | node + playwright + a server | Is the authored-floor blit the right way up? Paints a patch in the ground canvas's top-left quadrant and diffs the composited frame against one without it. |

```sh
node tools/clip.mjs 6000 --legacy     # the old behaviour, for comparison
node tools/clip.mjs 6000              # the current one

node tools/doorway.mjs 12

python3 -m http.server 8931 --bind 127.0.0.1 &
node tools/parity.mjs blacksite,mire,proving 900 2d:2d   # control, must pass first
node tools/parity.mjs blacksite,mire,proving 900 2d:gl   # the real comparison
node tools/diverge.mjs 2d                                # when one of them fails

node tools/align.mjs gl && node tools/align.mjs gl --shake
node tools/align.mjs 2d
node tools/ground-orientation.mjs

node tools/smooth.mjs                      # frame pacing at 60/72/90/120/144 Hz
node tools/smooth.mjs 120 1800             # one rate, longer sample

node tools/contract.mjs                    # whole 20-minute contracts, all scenarios
node tools/contract.mjs foundry 30         # one theatre at thirty minutes
node tools/contract.mjs blacksite 20 lethal
```

**Run `contract.mjs` on any change to the director, the mission or the run
lifecycle.** Everything else here tests a nine-hundred-tick slice — fifteen
seconds of a contract that runs twenty minutes — and two run-breaking bugs in
two rounds of playtesting lived entirely past that horizon. A signature still
standing when the clock ran out meant the phase line never said the extraction
window had opened, and the window closed on the run; and a scheduled spawn
refused because a signature was already present was thrown away rather than
held, so a twenty-minute contract silently lost its own final boss and lost the
walker every single time. Both were found by a person playing, not by anything
in this directory.

It runs three scenarios per contract. `passive` kills nothing, so every
signature is still alive when the clock runs out — the extraction case.
`lethal` clears signatures in about twenty seconds so the schedule runs to the
end — the lost-event case. `extract` does that and then leaves, which asks
whether the contract can be won at all. A twenty-minute contract is 72,000
fixed steps and takes about a minute per scenario; that cost is the reason
nothing was testing this, and not a reason to keep not testing it.

Outcome is measured **at the spawn, not at the director**. The first version
asked `fireEvent` whether the event had run, and the shape of the bug being
tested for is a director that reports success while dropping a refused spawn —
so it passed three clean contracts over code with the fault put back in. It was
only trusted once it had been shown to fail: both bugs were reintroduced
deliberately and it caught all eight symptoms.

`smooth.mjs` drives the real engine at a chosen refresh rate and measures how
evenly the picture actually travels — the second difference of on-screen
position, in pixels, for both the scrolling sector and the operative within the
frame. It empties the sector of geometry and hostiles first and walks a wide
arc, because an operative who has walked into a wall stops moving and a run
that measures nothing reads as perfectly smooth; a run whose camera barely
travelled is reported as STALLED rather than passing. Every rate is measured
twice, once on a metronome and once with frame deltas jittered by ±12% the way
a browser really delivers them — an interpolator that only behaves on a
metronome has not been tested.

**Run `align.mjs` on any renderer change.** Simulation parity cannot catch a
presentation bug by construction — the world can be bit-identical under both
renderers while one of them draws it upside down, and that is exactly what
shipped: the sprite layer was composited vertically mirrored, and the GL view
matrix omitted the camera shake `Camera.apply` applies. Both put every hostile
somewhere other than its collider, and both survived a full simulation-parity
sweep and a screenshot review.

The control matters. A renderer comparison that has not first been shown to
agree with itself cannot distinguish a renderer bug from a harness that is
comparing two runs which had already drifted apart before the first tick.

`rotor-duck.mjs` asserts that a gunship overhead pushes the score out of the
way, and that it does so as a continuous side-chain rather than as an event.
The distinction is the whole point: the weapons duck the music through the
`DUCKING` table, which pulls, holds and releases — the right shape for a sound
ninety milliseconds long and the wrong one for a rotor that is audible for the
length of a flyover. It measures `rotorDuck` directly rather than the combined
`musicDuckLevel`, because the contract is live while the harness runs and real
gunfire moves the event duck the whole time; reading the combined level
measured the firefight and blamed the rotor.

Every assertion in it was shown to fail before it was trusted, by putting each
defect back one at a time: no duck, an instant release, ducks that multiply
instead of taking the deeper of the two, a teardown that leaves the score held
down, and an eased attack instead of an immediate one.

`enemy-audio.mjs` asserts that a firefight carries information: that each
hostile archetype resolves to a weapon family, that hostile fire leaves on the
`enemyWeapon` bus while the operative's own stays on `playerWeapon` even for the
sound names both of them use, and that incoming fire is spectrally shaded away
from outgoing.

Its most important assertion is the dullest one. Everything else exercises
`busFor` and `weaponShot` directly, which proves the machinery works and proves
nothing about whether a hostile pulling a trigger ever reaches it — so the
harness also spawns four real archetypes, fires them through the engine, and
watches what is actually emitted. Reverting only the call site leaves every
other assertion green.

Note the margin on the spectral assertions. Every shot is detuned by up to its
family's `spread`, so "lower than the last one" is a coin flip between two shots
of the same voice and passes on a build with no shading at all; the thresholds
are set well outside the wobble and were confirmed to fail on three consecutive
runs with the shading removed.

`ambience.mjs` asserts that every theatre has a bed of its own, that the beds
differ from one another, and — mostly — that the bed stops. A continuous voice
is easy to start and easy to believe in; what goes wrong is that it never ends,
and a drip playing under the command centre is the kind of bug that ships.

Three of its assertions were rewritten after they failed to catch a
deliberately broken build, and each failure is worth knowing about:

- The randomness check generated its own random numbers and tested those. It
  proved `Math.random` is random and nothing at all about the game. It now
  intercepts the scheduler's own timer requests.
- The stale-timer check called the scheduler by hand after stopping, which
  returns at its own opening guard whatever the pending timers are doing. It
  now leaves a real timer in flight, stops, and waits past when it would have
  fired.
- The contract-ending check passed with the stop removed from `Engine.finish`
  outright, because finishing cascades into the session teardown, which also
  stops the bed. It now cuts that cascade so it tests the path it names.

`wreck.mjs` drives a gunship kill and steps the simulation by hand at the fixed
timestep until the wreckage lands, so the result does not depend on how many
frames a headless browser felt like delivering. The failure it exists for is the
quiet one: a wreck that spawns, spins, and never reaches the ground, leaving a
permanent burning object in the sector and a rotor that never stops.

Three of its assertions were wrong before they were right. One checked the enemy
list immediately after the kill, when removal is swept once per step by design.
One sampled the queued secondary explosion long after it had already fired, so
it was zero either way. One counted decals across the whole fall, which let
ambient kills elsewhere pad the total — it passed on a build with both crash
splatters deleted outright, and now spies on `addDecal` across the single
landing step instead.

It also used to die on a stack trace rather than report anything when no wreck
existed at all, which is the one build you most want a diagnosis from.

`enemy-identity.mjs` asserts that a hostile's death, its alert and its arrival
say what kind of thing it was — that chassis is independent of weapon, that the
cues land on the enemy bus, that alerting latches instead of retriggering every
frame, and that infantry and swarms arrive silently so a wave does not turn to
mush.

Two of its assertions were measuring the harness rather than the game:

- Distinctness compared pitches, and every layer's frequency carries a per-shot
  wobble — so it passed cleanly on a build where all seven chassis entries had
  been overwritten with identical values. It was measuring `Math.random`. It
  now compares durations, which come off the table untouched.
- Captures ran in one synchronous burst without resetting the voice budget.
  `canPlay` drops non-essential sounds past 24 live voices, so the seven death
  captures spent the whole budget and everything measured after them was
  silently empty. Two unrelated assertions failed on mutations that had nothing
  to do with them, and the baseline was passing partly by luck of ordering.

`parity.mjs` expects the game at `http://127.0.0.1:8931` and Playwright's
Chromium; edit the two constants at the top if either differs.
