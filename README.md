# PHANTOM PROTOCOL

A build-free, static browser survival-action roguelite set in an original near-future military espionage universe.

## Current playable release
- 4 unlocked operatives + 1 classified operative
- 17 weapon definitions
- 13 passives
- 11 evolution records
- 12 normal enemy archetypes
- 5 elite archetypes
- 3 boss signatures
- 3 maps
- 5/10/15/20/25/30 minute contracts
- XP level-up loop with in-run upgrades
- persistent JP and operative development
- 64 milestones and 72 achievement definitions
- local persistent save, export/import/reset
- keyboard + mobile virtual joystick controls
- extraction phase, results and failure flow

## Controls
Desktop: WASD or arrow keys. Mobile: virtual joystick. Pause with the HUD button.

## XP vs JP
XP is collected from battlefield pickups and resets each mission. JP is awarded from elites, bosses and mission performance, then persists for permanent development purchases.

## Running
Serve the folder as a static site or publish the repository root through GitHub Pages. `index.html` uses only repository-relative paths and native ES modules; no npm, Vite, Webpack, Bun, React, or compilation step is required.

## Structure
`data/` contains content registries. `src/core/` handles input. `src/systems/` contains gameplay simulation. `src/ui/` contains menu screens. `src/save/` contains persistence. CSS is split by general, HUD, and responsive presentation.

## Roadmap
Add authored sprite/portrait packs, additional maps and environmental geometry, richer weapon-specific behaviors, true multi-weapon loadouts, hidden rooms, dynamic events, deterministic daily seeds, synthesized/original audio assets, deeper job grids, lore unlock gating and performance profiling on real mobile hardware.

## Originality
All characters, organizations, terminology, lore and gameplay presentation in this repository are original to Phantom Protocol. No copyrighted franchise assets or lore are included.
