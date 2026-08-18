# Balancing

## Pressure model

Difficulty comes primarily from **hostile count and composition**, not from durability.
Enemy health scales shallowly with contract progress (`1 + progress × 1.6`) so that weapon
scaling stays ahead of it; letting durability outrun player damage produces a run where
nothing dies and the field saturates.

The enemy cap ramps quadratically (`0.12 + progress² × 0.88`) rather than linearly. The
opening minutes stay readable while the player is still under-levelled, and saturation
only arrives in the back half of a contract. While a command signature is active the trash
cap is thinned to 45% so the encounter stays legible.

## Hostile mobility

Hostile speeds sit at roughly 50–105% of operative speed. Archetypes materially slower
than that can never close, so they accumulate off-screen and the field fills with hostiles
that are alive but irrelevant — the player sees a large count and fights almost nothing.
Reinforcements also deploy with partial awareness and the player's last reported position,
because a unit spawned outside its own detection radius otherwise wakes up with no contact
and wanders.

## Progression curve

XP requirements start at 8 and grow by 1.14 per level below 20, 1.08 below 45, and 1.05
beyond, plus a small flat term. In a standard contract that lands roughly at level 5 by
30 seconds, 10 by 90 seconds and 30 by the ten-minute mark. The curve deliberately
flattens at high level so endurance contracts keep producing adaptations.

## Command signatures

Bosses appear at 74% of the contract, leaving a real fight window before extraction opens.
Placing them later makes the encounter skippable — the player simply walks to the beacon.
Boss health scales with contract length (`1 + (minutes − 5) / 25 × 2.4`) because a
30-minute run hands the player an evolved loadout at level 40+, against which a flat-health
boss evaporates in seconds.

Auto-targeting applies a value weighting to surface distance (bosses ×0.3, elites ×0.7).
Without it, `nearest` targeting never selects a boss while any trash is on screen, and the
encounter cannot be fought at all.

## Survivability

Contact damage is gated by a 0.36s invulnerability window, which caps incoming melee
regardless of how many hostiles are touching the player. Being fully surrounded remains
lethal in a few seconds — that is intended — but it is escapable with a dash.

Hazards fire on long cycles (6.5–11s) with a 1–2s telegraph and a persistent dormant
marker. Short cycles turn a theatre into ambient chip damage that cannot be played around.

Extraction requires a 2.5s hold inside a 95-unit beacon zone. The hold decays rather than
resetting, so being knocked or dashed briefly out of the zone costs progress instead of
erasing it.
