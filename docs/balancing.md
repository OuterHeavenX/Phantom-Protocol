# Balancing

## Escalation vs. progress

Two separate clocks, and conflating them was the single largest balance fault in the
build. `Director.progress` is the fraction of the contract elapsed, and drives *scripted*
pacing — where the command signature lands, when the contract ends. `Director.escalation`
is how far the threat has ramped, and drives *pressure* — enemy cap, wave size, surge
size, archetype tier and hostile durability.

Escalation is mostly wall-clock (`clock/12min × 0.7 + progress × 0.3`) because the
operative's power comes from kills, which accrue in real time. Indexing pressure to
contract fraction alone made a five-minute probe roughly three times as intense as a
fifteen-minute operation at the same point on the clock: the contract sold as the gentle
introduction was the hardest one in the game.

## Pressure model

Difficulty comes primarily from **hostile count and composition**, not from durability.
Enemy health scales shallowly with escalation (`1 + escalation × 1.05`) so that weapon
scaling stays ahead of it; letting durability outrun player damage produces a run where
nothing dies and the field saturates.

The enemy cap ramps as `0.16 + escalation^1.7 × 0.84` off a base of 115. Shape matters
more than ceiling: a steeper curve put the arena at its cap around the three-minute mark,
and a player pinned against the cap can never clear faster than hostiles arrive — the run
is lost from that point regardless of play. Wave size is bounded in the same spirit; its
wave-index term is clamped so a long contract does not end up sized by how many waves have
already been sent.

Archetype tiers open on escalation too. Tier 2 roughly triples an archetype's health over
tier 0/1, so it is the largest single jump in incoming pressure and now lands past the
midpoint rather than at 40%.

While a command signature is active the trash cap is thinned to 45%, and during extraction
to 35%, so the encounter stays legible.

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
Boss health scales with contract length (`0.7 + (minutes − 5) / 25 × 2.4`) because a
30-minute run hands the player an evolved loadout at level 40+, against which a flat-health
boss evaporates in seconds — while a five-minute probe reaches the same encounter at
roughly level 13 with a partly-built loadout. Signature attacks carry a 0.72 damage
multiplier: they land for 14–52 against an operative holding roughly 125 health, which
decided the encounter in three or four connects.

Auto-targeting applies a value weighting to surface distance (bosses ×0.3, elites ×0.7).
Without it, `nearest` targeting never selects a boss while any trash is on screen, and the
encounter cannot be fought at all.

## Survivability

Contact damage is gated by a 0.36s invulnerability window, which caps incoming melee
regardless of how many hostiles are touching the player. Being fully surrounded remains
lethal in a few seconds — that is intended — but it is escapable with a dash.

Hazards fire on long cycles (6.5–11s) with a 1–2s telegraph and a persistent dormant
marker. Short cycles turn a theatre into ambient chip damage that cannot be played around.

### Sustain

Operatives carry a baseline 0.45 HP/s regeneration, taking an adaptation restores 7% of
maximum health, and hostiles drop a health cache 7.5% of the time. Before those existed
the only sustain in a contract was that drop, at 3%: measured incoming chip damage of
roughly 0.8 HP/s against a 100-health pool meant a ten-minute contract dealt several times
the player's health bar in damage that could never be recovered, and the run was lost to
attrition no matter how well it was played.

### Extraction

Extraction requires a 2.5s hold inside a 95-unit beacon zone. The hold decays rather than
resetting, so being knocked or dashed briefly out of the zone costs progress instead of
erasing it.

The window is a withdrawal, not another wave. The director stops committing new waves once
it opens, the trash cap drops to 35%, the beacon is placed around a third of the way out
rather than at the 70th percentile of distance, and the operative moves 28% faster.
Holding full saturation through a map crossing made the last minute reliably the deadliest
part of a contract — in harness runs of the previous tuning, no run that survived the
contract ever reached the beacon.

## Verifying a change

`docs/` carries the reasoning; the numbers come from a headless harness that runs the real
engine with a stubbed canvas and a scripted operative. Win rate is noisy — the scripted
operative has no pathfinding, so extraction conversion swings widely — but two metrics are
stable enough to tune against:

- **Fraction surviving the contract**, which is what the pressure curves actually control.
- **Player DPS vs. hostile health arriving per second**, bucketed over time. Sustained
  below 1.0 means the field grows without bound and the run is arithmetically unwinnable;
  the previous tuning sat at 0.35–0.9 from the opening minute onward.
