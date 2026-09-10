# Blender combatant overhaul

The production Canvas renderer now uses original Blender models baked into
directional, transparent WebP atlases. This keeps the game build-free and avoids
requiring a 3D engine on players' devices. It is enabled during normal play.

## Art and coverage

- Eight operatives with colored armor, weapons, packs, optics, cloaks and role equipment.
- All 15 deployment-pool enemies, the carrier and the gunship.
- Six elite variants; minibosses inherit their underlying elite model and scale.
- Manticore, Carrion, Aegis, Arbiter and the persistent Nemesis.
- Squadmates use their operative model, including when downed. Reanimated units
  use the model matching their render archetype.

The editable source is `assets/models/red-static-combatants.blend`. Its 36 named
root hierarchies are arranged as a six-column gallery; mesh parts and materials
remain editable. Humanoid leg assemblies contain eight keyed stride poses.
These are stylized hard-surface models, not motion-captured or facially rigged characters.

Each actor has eight headings and eight poses, at 128 pixels per frame. The atlas
contains 1,024 × 1,024 pixels. The renderer snaps facing to the nearest heading,
selects the walking pose, and anchors the feet at the simulation position.
The character camera is orthographic, looking down from `(0, -6, 9)`.
Machine rotor blades change pose; other rigid machine parts remain static.

`assets/models/combatants-contact-sheet.jpg` is a visual roster. The command
screen's team artwork is rendered from the same models, then cropped and packed
to `assets/images/combat-team.webp`.

## Presentation

`css/overhaul.css` provides graphite panels, warmer health and mission accents,
revised menu typography, and the command-screen team display. `surface.js` bakes
deterministic panel seams, fasteners, wear and drain details for procedural
floors and adds wall fascia lighting. Existing authored environment packs remain
the preferred art where supplied, including Blacksite Zero.

Shadows, damage flashes, cloaking, enemy health bars, awareness indicators,
windups, shield effects, sapper fuse warnings and carrier deployment cues stay
in the live renderer. Livery colors appear as weapon accents. Simulation,
collision, progression and saved-game formats are unchanged.

## Rebuild

From the repository root, with Node, Blender 5.2 and Python with Pillow:

```powershell
node tools/blender-roster.mjs
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b -t 4 --python tools/build-blender-roster.py
python tools/pack-blender-sprites.py
```

The first script reads the actual content registries. The second builds geometry,
renders 2,304 frames and the command artwork, and saves the Blender file. The
third validates every frame, writes lossless WebP atlases, a manifest, and the
contact sheet. Raw renders and Blender backups are ignored by Git. To use the
packer outside Windows, change its contact-sheet font path to an installed font.

For a full rebuild, run all three steps in order and wait for Blender to finish
before packing. No third-party art, paid provider, external texture or add-on is used.

## Validation

Serve the root on port 8080 and run `node tools/visual-qa.cjs` with Playwright
available (`PLAYWRIGHT_MODULE` can point to an installed module). It uses installed
Chrome in headless mode with a fresh browser profile. It checks the 36 loaded
atlases, live deployment, desktop and portrait layouts, pause/resume, all ten
theatre render paths, boss drawing, and procedural fallback with atlas requests
blocked. Screenshots and results go to the ignored `tools/visual-qa-output/` folder.

Also run `npx --yes eslint src data` and
`python -X utf8 tools/construction-order.py src data`.

The loader shares decoded atlases across runs. It starts on the command screen;
an actor whose image has not decoded, or has failed, retains its vector fallback.
The experimental WebGL visual-test renderer is a separate opt-in experiment.
