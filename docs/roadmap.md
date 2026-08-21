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
