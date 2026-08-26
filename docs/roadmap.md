# Roadmap

Shipped in the current build: multi-weapon loadouts with 17 distinct firing behaviours,
12 implemented evolutions, squad-based AI with cover and telegraphed attacks, multi-phase
bosses, procedurally generated bounded arenas, environmental hazards, a layered renderer
with an additive lighting pass, fully synthesized audio, a derived progression system
covering directives, achievements, unlocks and per-operative mastery, a live in-run
objective checklist, field recovery of locked operatives with real-time counseling
sessions, procedural operative portraits with silhouettes for unidentified personnel,
sealed vaults hidden in every generated sector, and operative-planted field turrets with
rank-scaled durability.

Also shipped: a Gunsmith with seven attachment slots, 35 attachments and account-wide
weapon rank; ten theatres with per-theatre weather and authored landmark props, and a
six-operation campaign with briefing dialogue, four mission objective types and
progressive document reveals.

And shipped since: a requisition ladder that issues two weapons at induction and opens
the other sixteen against command rating; persistent blood and oil floor decals that last
the whole operation, baked into an offscreen layer once they age out of the crisp set;
and the Vulture gunship, the first flying hostile, scheduled by contract length rather
than drawn from the deployment pool. Plus an authored boot title screen in a wide and a
tall frame, with the artwork's own painted buttons wired up as the real ones; authored
dossier cards for all eight operatives, readable in full and cropped for the roster; and
music moved off the AudioContext, which was freezing the track whenever the browser
suspended the context. And codec traffic: the deployed operative and a handler talking
over the channel printed on their dossier cards, across twenty events in a contract.

And since: the Drayman carrier, an armoured transport that parks and unloads infantry
until it is destroyed. Plus the Nemesis — a bipedal walker commissioned against the operator, which
withdraws rather than dying and returns with another hardpoint and the scars from the
last meeting. Plus squadmates — a second operative on the ground who fights with their own issue
weapon and their own ability, whom a share of each wave marks as their target, and who
goes down rather than dying.

Fixed on the way through: the HUD template took `(operative, ability)` but its markup
read `engine.ordnance`, so `new Hud(...)` threw a ReferenceError and **no run could
start at all**. This had been true on `main` since secondary fire shipped — every test
since had constructed the Engine directly and never gone through the HUD. The ordnance
button has never rendered until now.

And since: radio traffic moved from the bottom-left corner to under the mission timer,
which meant laying the top row out on an explicit grid. Doing that fixed a phone bug
nobody had reported — the timer panel was sitting on top of the health bar at 430px,
because three tracks never fit and the layout let them try.

And since: the whole authored-art pipeline for Blacksite Zero — a loader with a
procedural fallback for every draw path, an authored floor plate, three-sliced walls in
both orientations, and all six cover types with variants. Plus the simulation made
reproducible from its seed, and the contract board built on top of it: a daily and a
weekly assignment derived from the calendar, with rotating theatres, lengths,
difficulties and modifiers, so every operator faces the same sector on the same day.

Fixed since: the operative faced one way and the rounds went another. `fireDirection`'s
own comment had always said it honoured manual aim, but the code only did that for the
four weapons declared `targeting:'facing'` — every other direct-fire weapon shot whatever
it had acquired, so an operative pointing right put rounds out of their own back. Measured
in a live run: 51 degrees between the sprite and the muzzle before, 1 degree after, and
that 1 degree is weapon spread. Two more things came out of the same corner: the operative
now turns to face what they are engaging rather than the way they are walking, and
`settings.autoAim` — a ternary whose two branches were identical, so the setting resolved
to nothing at all — now means aim assist inside a 38-degree cone, which brings the body
round with the shot so a wide cone never shows as a mismatch.

And since: full controller support. Nothing outside a run had ever polled the gamepad, so
on a console or a television box — where a controller is the only input there is — the
game could not be started at all. Menus now navigate by focus, geometrically, on every
screen; a run can be configured and launched from a pad alone. Third-party controllers get
the same path as first-party ones: non-standard mappings, a D-pad read from a hat axis when
there is no button block, and a radial rescaling deadzone so a worn stick neither walks on
its own nor forces a lurch to a fifth of top speed. Fixed on the way through: holding START
strobed the pause menu open and shut, because gamepad pause was read level-high rather than
on the rising edge; and cycling the field kit had no controller binding at all, which was a
gap I introduced when I added it as a keyboard shortcut.

Remaining:

1. ~~Deterministic daily and weekly contracts.~~ Shipped. Thirty-one draws across the
   AI, the bosses and the director moved onto the seeded stream; particles and audio
   deliberately stayed off it, which is now enforced by test rather than convention.
2. ~~A second development tree branch gated behind account level.~~ Shipped as COMMAND
   DOCTRINE: five nodes that change rules rather than numbers, opening against command
   rating instead of against other nodes. Nothing in it touches world generation, so a
   daily contract still builds the same sector for two operators with different trees.
3. ~~Per-weapon secondary fire modes, as an eighth Gunsmith slot.~~ Shipped, as a rail
   of six universal ordnance modules rather than eighteen bespoke alternate fires — one
   module fits any weapon, so the choice is what the primary lacks.
4. ~~Replay capture using the seeded, fixed-timestep simulation.~~ Shipped. A replay is
   the seed plus the input log, so watching one re-runs the simulation rather than
   playing back a recording of it. Two things make that exact rather than approximate:
   input is captured once per fixed step rather than once per rendered frame, so the
   log does not drift when the recording and playback machines disagree about frame
   rate; and the simulation consumes the quantised values live as well as on replay, so
   there is no rounded copy to diverge from. Adaptation choices are logged alongside —
   which card was taken, rerolled, banished or skipped — because the seed cannot
   predict them, and so is the account's unlocked weapon list, because the offer pool is
   built from it. Measured over ninety seconds of scripted play with every action
   firing: player position identical to six decimals, and no difference in health,
   damage dealt or taken, kills, credits, level, XP, weapons, passives or vault state,
   through the compressed round trip. Nothing a replay does is earned — no payout, no
   unlocks, no write to the save — and that is verified, not asserted.
   The log run-length encodes held input away, then gzips, which is what saves the case
   the run-length pass cannot help with: a mouse or an analog stick moves a little every
   single step. Worst case measured is a thirty-minute contract at about 570 KB; real
   keyboard play is a fraction of that. Saving is offered, not automatic, and a save
   write that hits the origin's quota now sheds replays oldest-first and retries rather
   than losing the whole session's progression.
5. Performance profiling on low-end mobile hardware — **the only item on this list
   that cannot be closed from here**, because it needs a physical phone. The
   instrumentation half is shipped: SETTINGS > show fps now draws frame percentiles, the sim/render split, live
   entity and world counts, heap, and — the point of it — a step-clamp counter that goes
   red when the simulation starts discarding contract time. `window.__profile()` returns
   the same numbers as an object. What remains is running it on an actual phone; every
   "iPhone" figure in this project's history was headless Chromium with a viewport
   override, which shares no CPU, GPU or thermal budget with the device it was named
   after.
   Note: duel operations crashed on construction until Act II shipped — the codec was
   built after the mission, and a duel spawns its boss during mission setup, which fires
   a codec cue.
6. ~~Vault variants beyond the loot-and-garrison pair — timed holds, terminal hacks.~~
   Shipped. Four locks now, drawn from the world's seeded stream so a daily contract
   still hands two operators the same sector. A manual override cannot be shot open at
   all: it runs only while the operative stands at the door, it broadcasts to everything
   within 900 units while it runs, and stepping away bleeds it back at 1.5x. A remote
   lock cannot be shot open either — the lock is on a console placed 300 to 560 units
   away before cover is scattered, which has to be found and put down first. Each lock
   pays its difficulty back in credits.
7. ~~Turret variants (shield pylon, slow field) selectable from the deployment kit.~~
   Shipped as three field kits cycled in the field with `G`. Rank and kit are
   independent: rank still decides how many and how tough, the kit decides what they do.
   The shield pylon and the snare field carry no weapon at all — the pylon cuts incoming
   damage 40% for anyone inside 150 units, the snare halves hostile movement inside 170.
   The snare writes its own multiplier rather than sharing `speedMult`, which is
   deliberately never reset on an enraged hostile and would have kept the slow forever.
8. ~~A second campaign act following the CONTROL designation past trial eleven.~~ Shipped
   as THE GLASSHOUSE: six operations across the four theatres the campaign had never
   used, escalating to twenty minutes on GHOST, with SIGNAL finally forming sentences.
   Fixing it turned up that op6 had never been launchable — see below.
9. ~~Voice or typewriter pacing on briefing dialogue rather than a straight fade-in.~~
   Shipped as typing. Voice was never available — there is no recorded audio in this
   project and nothing here synthesises speech. Three things make typed text read as
   speech rather than as a printer, and all three are in: speakers have their own
   cadence (VECTOR is brisk, the ARCHIVIST thinks out loud, the OPERATIVE says as
   little as possible, SIGNAL comes out unevenly), punctuation holds, and the gap
   before a reply is longer when the speaker changes. Any key or tap finishes the
   whole briefing; `prefers-reduced-motion` renders it instantly. Each line reserves
   its final height before a character is typed, so the DEPLOY button never walks down
   the screen — and the reserved copy is what a screen reader gets, so assistive tech
   is handed the whole briefing at once rather than made to wait out an animation.
   Fixed on the way through: `enableKeyboardNav` left its keydown handler on `window`
   for screens that did not install their own, so Enter on a briefing re-clicked a
   campaign button that was no longer in the document.
10. ~~Weapon camouflage and charm cosmetics earned at the higher weapon ranks.~~ Shipped
   as liveries instead. Camouflage does not survive this camera: the weapon is a 15x3.2
   world-unit sliver, roughly forty by nine device pixels, drawn in two flat colours and
   rotating with the operative — there is no surface for a pattern and a charm would be
   sub-pixel. A livery paints the tracer and the weapon tint instead, which is visible on
   every trigger pull at any zoom.
11. ~~Saved Gunsmith presets, so one weapon can carry several named builds.~~ Shipped.
   A weapon's bench state is three separate things — the attachment build, the
   secondary-fire module and the livery — and switching between two ways of carrying
   the same gun meant re-fitting all of them a slot at a time. A preset is one named
   copy of the lot, four per weapon, stored on the weapon record because that is where
   experience and rank already live: they belong to the weapon, not to whoever is
   carrying it. Saving under a name that already exists replaces it rather than adding
   a near-duplicate, and loading one follows through to the deploying loadout the same
   way fitting a slot does. Builds are sanitised on the way in and again on the way
   out, so a preset can never carry an attachment the weapon has not earned.
12. ~~A sweep for the order-dependent construction bugs the duel crash implied were
   lurking.~~ Done, and the sweep is now a checked-in tool rather than a one-off:
   `tools/check.sh` runs eslint's `no-undef` and `tools/construction-order.py` over
   the source. The construction walk follows `this` across object boundaries and
   reproduces the duel crash when pointed at `859b8ad^`; eslint pins the HUD
   `ReferenceError` when pointed at `443c1e1`. Both are clean on the current tree, so
   the answer to "are there more" is no rather than probably not.
   Still uncovered, and deliberately: a field the constructor initialises to a
   placeholder and fills in later reads as null rather than undefined, which is a
   different bug and a far noisier signal — most placeholders are legitimate.
13. ~~Ship the deferred WebGL2 renderer, in every theatre rather than only in the
   experiment.~~ Done. `src/render/gl/` is now a second production renderer with the
   same public surface as the Canvas 2D one, selected in `createRenderer` and
   controlled by `Settings → Presentation → Renderer`. Per-theatre dressing in
   `dressing.js` gives all ten sectors their own ground material, prop mix and
   lighting rig, coloured from the palette each already had. Seven outdoor materials
   were added to the G-buffer shader — ground, sheet water, foliage, roadway, rock,
   snow, molten slag — because the original set was an interior set and nine of the
   ten theatres are not interiors.
   Three things the promotion turned up that the experiment had not:
   * The experiment ran in one big empty hall, so its dressing ran a walkway down the
     spine of the sector and painted hazard bands across it. In a real corridor grid
     that crossed forty walls. Both are scattered placements now.
   * BLACKSITE ZERO ships authored floor art, and a GL floor threw it away. The
     deferred path now lays a painted floor into the G-buffer as albedo and skips its
     own plates, so the art survives and gains per-pixel lighting rather than losing
     to it.
   * The readability regression the experiment recorded as a blocker was real, and is
     fixed: the composite runs a contrast-adaptive silhouette rim over the sprite
     layer, and world-space markers moved off that layer so they are not fringed by it.
   Exposure was tuned by measurement against the Canvas 2D renderer in the same sector
   at the same contract seed, not by eye — an early build sat about 40% above the 2D
   mean with its top decile clipped to white.
   Not done, and deliberately: no GPU exists in the development environment, so every
   performance figure for the GL path still has to come from real hardware through
   `?visualtest=1`. Nothing in this repository claims otherwise.
14. ~~Gameplay integrity and collision hardening, so the renderer cannot change
   the rules.~~ Done. Eight defects reproduced and fixed, none of them
   WebGL-only — every one predates the deferred renderer and was present in
   Canvas 2D. The two that mattered most were not the ones the brief predicted:
   * **A negative frame delta.** A requestAnimationFrame timestamp is the
     moment the frame began, which can precede a `performance.now()` taken
     later inside that same frame, and only the upper end of the delta was
     clamped. One negative delta ran the camera's `damp` backwards and inverted
     its zoom to about -574, which mirrors the whole view and every
     screen-to-world conversion through the operative, for the two seconds it
     took to converge back. It also drove the simulation accumulator negative
     and stalled the fixed step. It showed up on the slowest startup path,
     which is exactly where a phone lives.
   * **The operative starting inside a wall**, in 14 of 80 generated sectors.
     The start was resolved before vaults, cover and hazards were placed and
     never re-checked; when no room had clearance the code returned an
     unvalidated fallback. Fixing it also took sector reachability from 60-87%
     to 98.7-99.5%, because the old reachability measurement had mostly been
     measuring the broken spawn.
   Movement is now one swept path — 15,021 tunnelling events across 180,000
   dash-speed steps became 0. Spawn validation knows the radius of what it is
   placing and which side of the geometry it is on: 0 of 12,000 deployments
   land on ground the operative cannot reach.
   The renderer-coupling audit found exactly two violations, both fixed: mouse
   aim conflated CSS pixels with drawing-buffer pixels, so it was wrong on
   every retina display and silently corrected itself when performance mode
   dropped the buffer to dpr 1; and hostile deployment distance was read off
   the camera, so a phone in portrait deployed hostiles 272 units away inside
   590 units of visible ground.
   No non-determinism was found in the simulation. Establishing that took five
   rounds of fixing the *harness* — pre-roll state leaking through the RNG
   stream, the contract clock, cover claims, hazard cycles and weapon cooldowns
   — which is why `parity.mjs` now ships with a `2d:2d` control that has to
   pass before any renderer claim is made.
15. ~~Make it possible to tell, at a glance, what is solid.~~ Done, and it was a
   bug rather than a preference. The GL dressing scattered standing crates,
   machinery, containment cylinders, rocks and foliage in the *same materials
   and sizes* as real cover: 31–57% of everything with height in a sector was
   walk-through decoration identical to the solid article. Hence "the same item
   can be walked over in one area and not in the other".
   The rule is now structural — height is only accepted from the pass that
   draws `world.walls` and `world.cover`, enforced inside `prop()` itself, so
   it cannot be broken by forgetting it a second time. Fake standing props
   across all ten theatres: 0.
   Theatres keep their character by dressing cover that is already there rather
   than inventing objects: panels, vents, exhaust, monitors and containment
   glow attach to a real collider. Floor decoration was cut by roughly a third
   and is authored flat.
   Solid things then had to look solid, so the composite derives a directional
   cast shadow and a lit top lip from the same height field the collision
   geometry produced — it cannot disagree with what is solid, and flat
   decoration gets no edge at all.
   Renderer-only: no collider, spawn, hazard or pacing value changed. Parity,
   pixel alignment and the clipping stress all still pass.
16. ~~Tie the molten channels to real hazards.~~ Done. Burning ground was
   theatre dressing invented by the renderer: the pools that read as lethal in
   foundry and the hangar sat wherever the dressing pass felt like putting
   them, and the hazards that actually burn were somewhere else. The molten
   pass now walks `world.hazards` instead, so every drawn pool is a hazard and
   every damaging hazard is drawn — 6 of 6 in both theatres, each pool sitting
   exactly on its collider, with the ember emitters and the pulse light on the
   same coordinates.
17. ~~Fix the camera judder.~~ Done, and it was not the camera. The simulation
   advances in whole 1/60 quanta while the display does not, so on anything
   that is not exactly 60 Hz the world advanced zero pixels on one frame and a
   full step on the next. Measured on the real engine at the real rates: the
   operative's on-screen position juddered by **4.9 px per frame** at 72, 90,
   120 and 144 Hz, and by 4.6 px even at 60 Hz once frame deltas are jittered
   the way a browser actually delivers them. An iPhone Pro runs ProMotion at
   120 Hz, which is the worst case of the four.
   Actors are now drawn between their previous and current simulated
   positions, `alpha` being how much of the next step the accumulator already
   holds, and the swap happens in place so every existing draw site — sprites,
   lights, minimap, HUD markers — smooths without knowing it exists. The same
   figure after the change: **0.011–0.075 px**. Sector scrolling improved from
   0.19–1.05 px to 0.01–0.99 px; the residue there is the camera's own damping
   responding to uneven frame deltas, an order of magnitude below what was
   fixed.
   The simulation never sees an interpolated coordinate — the swap is undone
   before the next step — so replays and daily contracts are unaffected.
   `tools/smooth.mjs` measures it, and reports STALLED rather than a flawless
   zero if the operative it is measuring never actually moved.
18. ~~Make the performance readout work under the renderer it exists for.~~ Done.
   `src/render/gl/deferred.js` never touched the profiler: the Canvas 2D path
   closes each frame with `profiler.mark('render'); profiler.end()`, the GL path
   did not, so the frame never closed and no sample was ever recorded. Measured
   on the same contract with the same input — Canvas 2D 90 samples, p50 1.9ms,
   p95 5.7; deferred WebGL2 **0 samples, every percentile zero**. The panel
   still drew and the fps line still ticked over, because that is computed
   separately, so it looked like it was working. That is the worst way for an
   instrument to fail, and it was failing on the only renderer an iPhone will
   ever select.
   The frame is now closed under GL, and the per-pass costs the renderer already
   measured are handed to the profiler rather than timed twice.
   Two things had to be added before the numbers meant anything:
   * **SCREEN — the interval between presented frames.** GL commands are queued
     and return immediately, so the CPU frame cost cannot see the GPU at all.
     Measured under the software rasteriser: CPU p50 **1.6ms** against a screen
     p50 of **183ms**. With only the CPU number the readout would have claimed
     600 fps while the game ran at five. The panel now leads with SCREEN, and
     with `outside`, the difference between the two — the one honest way to talk
     about GPU cost from JavaScript, since both halves are measured rather than
     inferred.
   * **A tail that is not truncated.** The first version discarded any interval
     over 250ms as "the tab was backgrounded", which on a slow renderer threw
     away every frame worse than the cap and reported 250ms as the worst case —
     a profiler built on percentiles quietly cutting off its own. The tab case
     is now handled where the fact is actually known, in the frame loop's
     visibility handler.
   `?gpusync=1` forces a `gl.finish()` so the frame's true cost can be read on a
   device with no console attached. It is reported next to the interval it
   should match, because it does not always match: measured here at 0.93ms
   against a 183ms frame, which says the work is happening somewhere `finish`
   cannot see. SCREEN is the authority; that line is a hint.
   In portrait the panel now stands clear of the touch controls, which are DOM
   elements over the canvas — portrait being the orientation the readout exists
   for.
19. ~~The extraction window that nobody could see.~~ Fixed, and it was three
   faults stacked on one moment. Reproduced on a real twenty-minute timeline
   rather than reasoned about:
   * `director.phaseLabel()` tested for a boss **before** extraction, so on any
     contract whose signature was still standing when the clock ran out — the
     normal case on a long one — the HUD went on reading COMMAND SIGNATURE
     ACTIVE for the whole sixty-second window and never once said the door was
     open. Extraction now outranks the signature and reads EXTRACT NOW //
     SIGNATURE ACTIVE when both are true.
   * A twenty-minute contract schedules a boss at 42% and its climax at 74%.
     `spawnBoss` refuses while one is already in the sector and the director
     swallowed the refusal, so on the measured timeline — first boss spawned at
     t=504s, still alive at t=888s — the contract's final boss silently never
     happened. Refused events are held and retried the moment the sector is
     clear: verified, second signature at t=951s, `bossesSpawned` 2 rather
     than 1.
   * The window announced itself once, for four seconds, into a boss fight. It
     now calls again at 30, 15 and 5 seconds while the operative is still away
     from the beacon, and the beacon's own edge arrow is the largest marker on
     screen and pulses.
20. ~~Make the heads-up display readable on the device it is played on.~~
   * Off-screen arrows were authored against a desktop window and were specks
     on a phone. They now scale off the short edge of the viewport — so a small
     screen gets proportionally more arrow, not less — carry a dark backing and
     a hairline edge so they survive a bright floor, and the extraction beacon
     outsizes everything else and pulses.
   * Radio traffic was 11px, and **10px on a phone**. Dialogue that cannot be
     read during a firefight may as well not have been written; it is 15px with
     a shadow, and the type goes up on a small screen rather than down.
   * The signature's health bar was the one element in the top HUD positioned
     absolutely at a fixed offset instead of being a real grid item, and it was
     the one that collided — printing over the contract name, the clock, the
     extraction countdown and the radio traffic. It is now a row of the stack in
     both shapes, which is what the rest of that region already promised.
   * Announcements stacked four deep at a fixed size over the same furniture and
     ran off both edges of a phone. They sit clear of the HUD, fit themselves to
     the width, cap at three, and a repeated line refreshes instead of printing
     a column of itself.
21. ~~Stop the music restarting abruptly on long contracts.~~ Tracks played on
   `element.loop`, which jumps from the last sample to the first with nothing in
   between. A piece is a few minutes long and a contract can run thirty, so that
   seam was heard ten times or more in a run. Each track now holds two elements
   on the same file and hands the loop from one to the other over a 2.4s
   equal-power crossfade — the one thing a single media element cannot do for
   itself. A track too short to overlap keeps the native loop, and so does one
   whose length the browser will not report.
