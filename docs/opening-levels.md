# Opening campaign: architecture and collision rebuild

The visual/layout rebuild is scoped to **Blacksite Zero (Cold Open), Crossfall
Span, and Hollow Valley**, the first three campaign missions. The other seven
theatres retain their layouts and presentation. The reference images informed
raised architectural mass, visible foundations, cool ambient color and warm
entrance lighting; no artwork or branding from those games is included.

- **Blacksite:** nine connected research chambers, 180-unit door openings,
  structural buttresses, grouped equipment, service inlays, and dedicated vault sites.
- **Crossfall:** a continuous bridge deck with substantial parapets, five pier
  bays, marked traffic lanes, sheltered side cover, and an unobstructed central route.
- **Hollow:** a continuous basalt escarpment, snow-covered rock formations,
  open-ended bunker shelters, a compacted rescue route, and readable terrain edges.

The layout source is `src/game/opening-levels.js`. The renderer is
`src/render/architecture.js`. Wall and cover art derives directly from the
collision rectangles. Wall tops and faces rise from those footprints; sections
are sorted with actors so structures occlude correctly. Raised geometry becomes
translucent when it would hide the player, while its ground footprint stays visible.
Destroyed cover stops drawing when its actual collision is removed. Damaged
destructible objects retain health indicators.

## Collision correction

The old obstacle hash indexed only each rectangle's center. A local query near
the far end of a long wall could therefore miss it, affecting movement, sight
and bullets. `SpatialHash.insertBounds()` now indexes every cell occupied by a
structure and deduplicates query results. Ordinary point/entity hashes keep
their existing path. This correctness fix applies to walls throughout the game.

Doors and central routes are reserved against random vault placement. All three
missions retain their objectives, enemy encounters, extraction, and sealed
vaults. Simulation replay version is now 3 because regenerated layouts and
collision behavior change deterministic playback; older recordings use the
existing “outdated” guard. Saved progression is not reset.

## Blender assets

`assets/models/level-materials.blend` contains original material node graphs,
floor/wall meshes, and the three rock formations. The runtime uses nine lossless
WebP files under `assets/sprites/architecture/`. A shared image cache avoids
repeated network transfers. If an image cannot load, the architecture still
draws its footprint and raised geometry using the palette fallback.
Repeated wall and equipment faces are baked to reusable sprites after loading;
ground shadows, occlusion fading, damage bars and vault states remain live.

Rebuild from the project root:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b -t 6 --python tools/build-level-materials.py
python tools/pack-level-materials.py
```

The packer needs Pillow. Blender uses Cycles, procedural materials, and no
external assets or add-ons. The snow material uses periodic 4D noise to avoid
tile seams. The PNG files are build intermediates; WebP files are used in-game.

## Checks

`node tools/opening-levels.test.mjs` tests 45 generated sectors across five
seeds and three contract scales. It checks actual movement against long-wall
ends, line of sight, bullet interception, query deduplication, connected rooms
and doors, reinforcement positions, extraction, mission caches/rescue positions,
and retained vaults.

With the root served on localhost:8080, `node tools/level-qa.cjs` uses Playwright
and installed Chrome to capture each level and entrance at desktop and portrait
sizes. Set `PLAYWRIGHT_MODULE` if Playwright lives outside the module search path.
Screenshots and results are under the ignored `tools/visual-qa-output/` directory.

Also run ESLint over `src data` and
`python -X utf8 tools/construction-order.py src data`.
