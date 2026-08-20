# Shipping an environment art pack

How to drop authored artwork into a theatre. The loader and every fallback path
already exist; this is the procedure, not a plan.

The numbers a pack has to hit — footprints, master sizes, anchors, the implied
light direction — live in [`blacksite-zero-art-audit.md`](blacksite-zero-art-audit.md).
This document only covers wiring.

## The two steps

1. Put the pack at `assets/sprites/environment/<pack>/`, with a
   `manifest.json` at its root.
2. Set `art` on that theatre in `data/maps.js` — `true` when the directory is
   named after the theatre id, or the directory name as a string when it is
   not. Every URL is passed through `encodeURI`, so a directory or file name
   containing spaces works without being renamed.

Until step 2 the game makes no request at all — a theatre without the flag never
probes for files that do not exist. Until step 1 resolves, and forever after if
it fails, every draw path stays on the procedural branch it uses today.

## Manifest

```json
{
  "theatre": "blacksite",
  "version": 1,
  "shadows": true,
  "sprites": {
    "floor": {"src": "floor/floor-tile.webp", "world": [128, 128]},

    "wall.h": {"cap": 26, "world": [32, 26], "slice": {
      "capA": "walls/wall-h-cap-l.webp",
      "mid":  "walls/wall-h-mid.webp",
      "capB": "walls/wall-h-cap-r.webp"}},

    "cover.crate": {"variants": [
      "cover/crate-0.webp", "cover/crate-1.webp",
      "cover/crate-2.webp", "cover/crate-3.webp"]},

    "cover.pillar": {"src": "cover/pillar.webp"}
  }
}
```

`world` is the sprite's footprint in world units. It matters in exactly two
places — the floor tile, where it sets the repeat period, and a wall slice,
where it sets the tiling step of the middle piece. Everywhere else the renderer
already knows the footprint from the collider, so it may be omitted.

`variants` is an ordered list indexed by the `variant` value (0–3) the world
generator already stores on every wall and cover piece. A given crate therefore
keeps the same face for a whole contract, and the same seed reproduces it. Ship
fewer than four and the index wraps. A single `src` is shorthand for a one-entry
list.

`shadows` (default `true`) keeps the engine's faux-height drop shadow under
authored pieces. Set it `false` only if the pack bakes its own in, or the two
will stack.

## Keys

| Key | Replaces |
|---|---|
| `floor` | the tiled floor pattern |
| `wall.h`, `wall.v` | partition segments, three-sliced along the long axis |
| `vault.wall.h`, `vault.wall.v` | chamber walls (148x16 / 16x148) |
| `vault.seal.h`, `vault.seal.v` | a sealed vault door |
| `vault.seal.h.found`, `vault.seal.v.found` | the same door once the scanner has resolved it |
| `vault.sigil`, `vault.sigil.open` | the floor sigil inside a discovered chamber |
| `cover.crate`, `cover.barrier`, `cover.pillar`, `cover.machinery`, `cover.lowcover`, `cover.container` | the six generated cover types |
| `hazard.<id>.dormant`, `hazard.<id>.active` | a hazard's resting and firing states |
| `decor.0` … `decor.5` | the six scattered decor kinds |

Wall slices may also be shipped per variant as `wall.h.0`, `wall.h.1` and so on;
the unsuffixed key covers the whole theatre when only one set exists.

Anything not listed keeps drawing procedurally. There is no requirement to ship
a complete pack, and no penalty for a partial one. A slice set is all-or-nothing:
if any of its three pieces fails to decode the whole key is dropped, so a wall
falls back complete rather than showing a gap where a cap should be.

## What is wired up today

Blacksite Zero is opted in with `art:'black site'` and ships two things: a
512x512 floor plate mapped to the existing 128-unit tiling period, and the
horizontal partition wall set — a 104x104 cap at each end and a 128x104 middle
that tiles at 32 world units. Everything else in that theatre — vertical walls,
cover, vault chamber walls and seals, hazards, decor — still draws procedurally,
and so does the floor or the walls if their files fail to load. No other theatre
has the flag.

## What the loader guarantees

- **Absence is not an error.** No flag, no manifest, or a manifest that decodes
  nothing, all resolve quietly to the procedural theatre.
- **Loading never blocks a frame.** The first frame runs long before any image
  decodes. A pack does not go live until all of it has resolved, so a frame is
  either fully procedural or fully authored — never half-dressed.
- **Failure degrades per key.** One 404 inside an otherwise good pack drops that
  one sprite; the piece it would have covered draws procedurally and the rest of
  the theatre is unaffected. A wall slice missing any of its three pieces falls
  back whole rather than shipping a gap.
- **Walls tile, they do not stretch.** Generated segments run from roughly 35 to
  695 world units at a fixed thickness, so the middle piece repeats at its
  authored step and the last tile is cut with a source rect. Nothing is ever
  scaled off its authored pixels-per-unit — on a wall too short to hold two full
  caps, each cap keeps its outer end and gives up its inner edge to a source
  rect rather than being squashed to fit.

## Two things to watch in the art

Both come out of the audit and both are easy to get wrong:

- **The additive lighting pass runs over everything.** Art with baked specular
  highlights clips to white in combat. Keep masters mid-value and let the engine
  light them.
- **The key light is fixed at upper-left.** Horizontal and vertical wall sets
  have to be authored separately; rotating one to make the other rotates its
  light with it. Decor is the exception — it is scattered at arbitrary rotation,
  so its art has to be light-neutral.
