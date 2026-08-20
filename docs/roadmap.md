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

Remaining:

1. Deterministic daily and weekly contracts built on the existing seeded RNG. Blocked
   on the simulation being reproducible from a seed at all: the director, boss and FX
   still call bare `Math.random()`, so the same seed does not produce the same contract.
   Item 4 is blocked on the same thing.
2. A second development tree branch gated behind account level.
3. Per-weapon secondary fire modes, as an eighth Gunsmith slot.
4. Replay capture using the seeded, fixed-timestep simulation.
5. Performance profiling on low-end mobile hardware.
6. Vault variants beyond the loot-and-garrison pair — timed holds, terminal hacks.
7. Turret variants (shield pylon, slow field) selectable from the deployment kit.
8. A second campaign act following the CONTROL designation past trial eleven.
9. Voice or typewriter pacing on briefing dialogue rather than a straight fade-in.
10. Weapon camouflage and charm cosmetics earned at the higher weapon ranks.
11. Saved Gunsmith presets, so one weapon can carry several named builds.
