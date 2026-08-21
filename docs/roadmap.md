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

And since: the whole authored-art pipeline for Blacksite Zero — a loader with a
procedural fallback for every draw path, an authored floor plate, three-sliced walls in
both orientations, and all six cover types with variants. Plus the simulation made
reproducible from its seed, and the contract board built on top of it: a daily and a
weekly assignment derived from the calendar, with rotating theatres, lengths,
difficulties and modifiers, so every operator faces the same sector on the same day.

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
4. Replay capture using the seeded, fixed-timestep simulation. No longer blocked — the
   simulation now reproduces exactly from its seed, so a replay is an input log plus a
   seed rather than a state dump.
5. Performance profiling on low-end mobile hardware. The instrumentation half is
   shipped: SETTINGS > show fps now draws frame percentiles, the sim/render split, live
   entity and world counts, heap, and — the point of it — a step-clamp counter that goes
   red when the simulation starts discarding contract time. `window.__profile()` returns
   the same numbers as an object. What remains is running it on an actual phone; every
   "iPhone" figure in this project's history was headless Chromium with a viewport
   override, which shares no CPU, GPU or thermal budget with the device it was named
   after.
   Note: duel operations crashed on construction until Act II shipped — the codec was
   built after the mission, and a duel spawns its boss during mission setup, which fires
   a codec cue. Worth assuming other order-dependent construction bugs are lurking.
6. Vault variants beyond the loot-and-garrison pair — timed holds, terminal hacks.
7. Turret variants (shield pylon, slow field) selectable from the deployment kit.
8. ~~A second campaign act following the CONTROL designation past trial eleven.~~ Shipped
   as THE GLASSHOUSE: six operations across the four theatres the campaign had never
   used, escalating to twenty minutes on GHOST, with SIGNAL finally forming sentences.
   Fixing it turned up that op6 had never been launchable — see below.
9. Voice or typewriter pacing on briefing dialogue rather than a straight fade-in.
10. ~~Weapon camouflage and charm cosmetics earned at the higher weapon ranks.~~ Shipped
   as liveries instead. Camouflage does not survive this camera: the weapon is a 15x3.2
   world-unit sliver, roughly forty by nine device pixels, drawn in two flat colours and
   rotating with the operative — there is no surface for a pattern and a charm would be
   sub-pixel. A livery paints the tracer and the weapon tint instead, which is visible on
   every trigger pull at any zoom.
11. Saved Gunsmith presets, so one weapon can carry several named builds.
