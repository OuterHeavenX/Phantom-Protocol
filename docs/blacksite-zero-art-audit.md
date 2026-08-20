# Blacksite Zero — Authored Art Integration Audit

**Status:** read-only technical audit. No engine code was changed to produce it.
**Audited revision:** `45d2b3a` — "Add the Drayman carrier" (`main` and
`claude/phantom-protocol-improvements-edbj2c` were identical at the time of audit).

Purpose: a precise technical asset manifest for replacing Blacksite Zero's
procedural visual representations with authored environment artwork. Every number
here is read from source or measured by instantiating the world generator against
the real `blacksite` map definition across 120 seeds. Nothing is estimated.

---

## 0. How Blacksite Zero is built

### 0.1 Map definition — `data/maps.js`

```js
id:'blacksite', name:'BLACKSITE ZERO',
layout:{type:'complex', density:.78, coverDensity:1.15, roomSize:[220,420], corridorWidth:110},
hazards:['steamVent','electricFloor'],
palette:{floor:'#0c1f26', floorAlt:'#0e2630', grid:'rgba(118,231,212,.055)',
         wall:'#1a3138', wallEdge:'#4e7d84', accent:'#76e7d4', hazard:'#ffb35c',
         fog:'rgba(2,8,12,.55)', light:'rgba(118,231,212,.10)'}
```

Blacksite has **no `weather` key**, so the weather pass is inert. It has **no
landmarks**: `generateComplex()` never pushes to `world.landmarks`, so
`drawLandmarks()` is a no-op in this theatre. There is no `water`. This is the
cleanest theatre in the game to re-skin — nothing but floor, walls, cover,
hazards, decor and decals.

### 0.2 Sector dimensions (exact)

`src/game/world.js` → `base = 2100 * sizeMult`. The shape table has no `complex`
key, so it falls through to `[1,1]` — Blacksite is always **square**.
`src/game/engine.js:82` → `sizeMult = clamp(.75 + durationMinutes/28, .8, 1.6)`.

| Contract | sizeMult | Sector (world units) | Grid cell (4x4) | Max wall segment |
|---|---|---|---|---|
| 5 min | 0.9286 | **1950 x 1950** | 487.5 x 487.5 | 342.5 |
| 10 min | 1.1071 | **2325 x 2325** | 581.3 x 581.3 | 436.3 |
| 15 min | 1.2857 | **2700 x 2700** | 675.0 x 675.0 | 530.0 |
| 20 min | 1.4643 | **3075 x 3075** | 768.8 x 768.8 | 623.8 |
| 25 min | 1.6 (clamped) | **3360 x 3360** | 840.0 x 840.0 | 695.0 |
| 30 min | 1.6 (clamped) | **3360 x 3360** | 840.0 x 840.0 | 695.0 |

25-minute and 30-minute contracts generate **identical sector dimensions** — the
clamp caps at 1.6, which is reached at 23.8 minutes. The largest sector that ever
needs filling is 3360 x 3360, not "30 minutes' worth".

### 0.3 Geometry generation — `generateComplex()`

A 4 x 4 room grid with 24 partition slots (3 vertical lines x 4 cells,
3 horizontal x 4). For each slot:

- **28% chance it is skipped entirely** (`rng.bool(.28)`) — the partition is fully open.
- Otherwise a doorway gap of `corridorWidth = 110` world units is punched at
  `gapCenter = rng.range(edge+90, edge-90)`, leaving up to two wall segments.
- Segments shorter than 20 units are discarded.

**Wall thickness is a hard constant: 26 world units.** Segment length is an
arbitrary real number.

Measured over 120 seeds at 10-minute size (2325 x 2325):

| Metric | Value |
|---|---|
| Partition segments per sector | 22 – 42 (mean 34.0) |
| Segment length min | 35.4 |
| p10 / p25 / median / p75 / p90 | 77.6 / 137.9 / 235.7 / 333.5 / 393.7 |
| Segment length max | 435.9 |

The length distribution is close to **uniform across 50–450** — each 50-unit bin
holds 12–13% of segments. There is no clustering and no modal length.

> **This is the single most important finding for the wall asset.** Wall lengths
> are continuous reals with no repeated values, so a fixed-size wall sprite is
> impossible and a stretched sprite will smear at 27:1 aspect variance. Walls
> **must** be a 3-slice (cap / repeatable middle / cap) along the long axis, with
> the 26-unit cross axis fixed.

Exact bound: `maxSegment = cellDimension - 145` (gap centre is inset 90, half the
110-unit gap is 55). This matches every measured maximum.

### 0.4 Doorways

There are **no door entities**. A doorway is the absence of wall — a 110-unit gap
between two segments, or a wholly skipped partition. `world.walls` contains only
solids; nothing marks a threshold. This behaviour is preserved and no door assets
are proposed.

Doorway framing would have to be inferred at draw time from segment endpoints.
That is a code change and is documented here only.

### 0.5 Vaults — `placeVaults()`

`rng.int(2,3)` targeted (`Rng.int` is inclusive) — **3 vaults on every seed
measured**. Chamber interior half-extent `half = 58`, chamber wall thickness
`t = 16`, span `= (58+16)*2 = 148`.

Three sides are solid walls (`type:'vault'`); the fourth is a destructible seal
(`type:'vaultSeal'`, hp 520). Side geometry is fixed:

- Horizontal side: **148 x 16**
- Vertical side: **16 x 148**

Measured seal orientation over 120 seeds: 144 horizontal / 149 vertical — a
**50/50 split**, so both orientations ship equally and both need art.

Vaults are placed at least 520 units apart and at least 460 units from spawn.

### 0.6 Cover — `scatterCover()`

```js
const COVER_TYPES=[
  {type:'crate',    w:46,  h:46, hp:70,  blocksSight:true,  destructible:true},
  {type:'barrier',  w:96,  h:26, hp:120, blocksSight:true,  destructible:true},
  {type:'pillar',   w:40,  h:40, hp:0,   blocksSight:true,  destructible:false},
  {type:'machinery',w:96,  h:74, hp:0,   blocksSight:true,  destructible:false},
  {type:'lowcover', w:80,  h:24, hp:90,  blocksSight:false, destructible:true},
  {type:'container',w:128, h:60, hp:180, blocksSight:true,  destructible:true}
];
```

Every cover piece is one of exactly **six fixed sizes**. No scaling, no rotation —
cover is always axis-aligned at its authored dimensions. Six sprites at six known
pixel sizes cover the entire cover field.

Target count = `width*height/26000 * 1.15`. Measured per sector:

| Contract | Total cover | Typical mix (single seed) |
|---|---|---|
| 5 min | ~132 | pillar 40, crate 49, machinery 12, lowcover 12, container 9, barrier 7 |
| 10 min | 189 – 231 | pillar ~71, crate ~61, lowcover ~25, machinery ~19, barrier ~19, container ~11 |
| 15 min | ~302 | pillar 109, crate 86, lowcover 37, machinery 25, container 26, barrier 16 |
| 20 min | ~385 | pillar 116, crate 112, lowcover 57, machinery 36, barrier 35, container 26 |
| 25/30 min | ~482 | pillar 177, crate 133, lowcover 63, container 37, machinery 31, barrier 38 |

Frequency over 120 sectors (24,754 pieces total):

| Type | Share |
|---|---|
| pillar | 34.5% |
| crate | 29.4% |
| lowcover | 12.4% |
| machinery | 9.2% |
| barrier | 9.1% |
| container | 5.2% |

Pillar and crate are two-thirds of everything on the floor and should get the most
authoring attention and the most variants.

### 0.7 Hazards — `placeHazards()`

Both Blacksite hazards are non-passive, so `count = rng.int(3,5)` each —
**6 to 10 hazards per sector** (measured 6–10).

| Hazard | Radius | Diameter | Damage | Interval | Warn | Colour | Status |
|---|---|---|---|---|---|---|---|
| `steamVent` | 56 | 112 | 16 | 6.5 s | 1.0 s | `#dff5f2` | — |
| `electricFloor` | 88 | 176 | 12 | 7.5 s | 1.2 s | `#8fd8ff` | shock |

Both affect enemies. Each has **three visual states** in `drawHazards()`: dormant
(ring at `radius*0.8`, alpha .10), warning (dashed ring plus filling disc, alpha
ramps .20 to .60), and active (filled disc, alpha .60). All are circles, all drawn
centre-anchored.

### 0.8 Decor — `scatterDecor()`

`count = width*height/9000` — **423 (5 min) to 1254 (25/30 min)** items. Six kinds
(`rng.int(0,5)`, inclusive), size `10 – 42`, **arbitrary rotation**, alpha
`.035 – .10`. These are single-stroke vector scratches drawn at near-invisible
alpha over the floor.

### 0.9 Floor

`buildFloorPattern()` builds a **128 x 128** canvas tile: base fill, checkerboard
quadrants at 64, a 1px border, a cross at the midlines, and 70 random 2x2 noise
dots. It becomes a `repeat` pattern filled as one `fillRect` under the camera
transform — so it **tiles in world space anchored at world origin (0,0)**, with a
period of 128 world units on both axes.

Also in `drawFloor()`: out-of-bounds shading `rgba(0,0,0,.55)` beyond the sector
edge, and a dashed accent perimeter line `strokeRect(0,0,width,height)`, 3px,
dash `[18,12]`.

### 0.10 The camera — resolution ceiling

`src/core/camera.js`:

```js
const MAX_VISIBLE_WIDTH=920, MAX_VISIBLE_HEIGHT=1180;
baseZoom = clamp(Math.max(width/920, height/1180), .45, 4);
apply(ctx){ ctx.translate(w/2,h/2); ctx.rotate(rotation); ctx.scale(zoom,zoom); ctx.translate(-x,-y); }
```

**Strictly orthographic top-down.** There is no perspective projection, no skew,
no isometric matrix. `rotation` is only camera shake (max +/-0.012 rad). Authored
art must be **overhead top-caps, not front-facing facades.**

`src/main.js:143` caps DPR at 2 (1 in performance mode). Device pixels per world
unit, measured:

| Device | Backing store | px / world unit | Visible world |
|---|---|---|---|
| Desktop 1920x1080 dpr1 | 1920x1080 | 2.09 | 920 x 518 |
| **Desktop 1920x1080 dpr2** | 3840x2160 | **4.00** (clamped) | 960 x 540 |
| Desktop 2560x1440 dpr1 | 2560x1440 | 2.78 | 920 x 518 |
| MacBook 1512x982 dpr2 | 3024x1964 | 3.29 | 920 x 598 |
| iPad Pro 11 landscape dpr2 | 2388x1668 | 2.60 | 920 x 643 |
| iPad Pro 11 portrait dpr2 | 1668x2388 | 2.02 | 824 x 1180 |
| iPad 10.2 portrait dpr2 | 1620x2160 | 1.83 | 885 x 1180 |
| iPhone 15 portrait dpr2 | 786x1704 | 1.44 | 544 x 1180 |
| iPhone SE portrait dpr2 | 750x1334 | 1.13 | 663 x 1180 |
| Phone, performance mode | 393x852 | 0.72 | 544 x 1180 |

`punchZoom` is called exactly once in the codebase (`src/main.js:186`, `-.12` on
boss spawn) and is **negative** — nothing ever zooms in past `baseZoom`.

> **The hard ceiling is 4.00 device pixels per world unit**, set by the
> `clamp(...,.45,4)` in `camera.resize`. Authoring at **4x the world footprint is
> exactly sufficient and mathematically cannot be beaten.** 8x masters would be
> pure waste.

### 0.11 Anchors and implied lighting

Walls and cover are drawn from **top-left = (x - hw, y - hh)**; the stored `x,y`
is the **centre**. A `drawImage(img, x-hw, y-hh, w, h)` is a drop-in replacement
for every `fillRect` in `drawGeometry` / `drawCoverPiece`.

Faux-height is a dark base offset drawn before the lit top face:

- Walls: `fillRect(x-hw+4, y-hh+7, w, h)` at `rgba(0,0,0,.45)` — offset **(+4, +7)**
- Cover: `fillRect(x+3, y+5, w, h)` at `rgba(0,0,0,.4)` — offset **(+3, +5)**

Both point down and slightly right: **key light from upper-left, elevated about
60 degrees below the horizontal** (atan2(7,4) = 60.3, atan2(5,3) = 59.0).
Consistent across the whole theatre.

> **Consequence: art cannot be rotated for reuse.** A horizontal wall sprite
> rotated 90 degrees rotates its implied light source with it. Horizontal and
> vertical variants must be authored separately. The only exception is decor,
> which is already drawn at arbitrary rotation and must therefore stay
> light-neutral.

### 0.12 Render order — `renderer.js:render()`

```
fill #03080d -> camera.apply()
  drawFloor            (floor pattern -> OOB shading -> water -> perimeter line -> drawDecor)
  drawDecals           baked stain layer + up to 90 fresh splats
  drawLandmarks        no-op on Blacksite
  drawHazards
  drawGroundEffects
  drawGeometry         walls, then cover
  drawEntities         painter's sort on y
  drawProjectiles -> drawBeams -> drawParticles
  drawExtractionBeacon -> drawVaultMarkers -> drawMissionMarkers -> drawSquadMarkers -> drawOptic
ctx.restore()
drawLighting()         half-res additive 'lighter' composite over everything
weather                inert on Blacksite
drawPost()             vignette using palette.fog, health pulse, flash, minimap, markers
```

Two things sit **on top of** any authored art: the additive lighting pass and the
vignette. Both are covered under Integration Risks.

### 0.13 Decals

`ensureStainLayer()`: `stainScale = (width*height > 7e6) ? .3 : .42`. Blacksite
crosses 7e6 at 2646 units square, so **5/10/15-minute contracts bake at 0.42;
20/25/30-minute contracts bake at 0.30.** The 90 most recent decals draw crisp;
everything older is baked into that one layer and composited with a single
`drawImage` between the floor and the geometry.

Decals therefore sit **under** walls and cover. Authored floor art will be stained
on top by blood but will never bleed over a crate.

### 0.14 The free variant channel

`addWall()` and `addCover()` both store `variant: rng.int(0,3)` on every piece —
**4 variants, 0–3, already generated, already deterministic per seed, and
currently never read by the renderer.** (`.variant` is referenced nowhere in
`src/render/`.)

This is a fully-built variant selector that costs nothing to adopt. It is the
highest-value finding in the audit after the wall 3-slice.

---

## 1. Production asset manifest

Master sizes are **4x the world footprint**, matching the 4.00 px/world-unit
ceiling from 0.10. "Runtime size" is the size in world units the sprite must
occupy when drawn (the `drawImage` destination width/height). Anchor "centre"
means the world position is the centre; blit at `(x - w/2, y - h/2)`.

| Asset | Existing gameplay footprint | Recommended master size | Runtime size | Anchor | Orientation | Transparency | Repeat / stretch | Variants |
|---|---|---|---|---|---|---|---|---|
| **Floor tile** | tiling pattern, 128 x 128 world period, world-origin anchored | **512 x 512** | 128 x 128 | world origin (0,0) | fixed | **opaque** | **tile, both axes** — seamless required | 1 (noise carries variety) |
| **Wall — horizontal, cap** | thickness 26; segment length arbitrary | **104 x 104** x2 (L, R) | 26 x 26 | top-left of segment | horizontal only | alpha | fixed cap | 2–4 |
| **Wall — horizontal, middle** | as above | **128 x 104** | 32 x 26 | tiles along +X | horizontal only | alpha | **repeat along X** | 2–4 |
| **Wall — vertical, cap** | thickness 26 | **104 x 104** x2 (T, B) | 26 x 26 | top-left of segment | vertical only — **re-lit, not rotated** | alpha | fixed cap | 2–4 |
| **Wall — vertical, middle** | as above | **104 x 128** | 26 x 32 | tiles along +Y | vertical only | alpha | **repeat along Y** | 2–4 |
| **Vault chamber wall — H** | 148 x 16 | **592 x 64** | 148 x 16 | centre | horizontal | alpha | none — fixed size | 1–2 |
| **Vault chamber wall — V** | 16 x 148 | **64 x 592** | 16 x 148 | centre | vertical | alpha | none — fixed size | 1–2 |
| **Vault seal — H, sealed** | 148 x 16, hp 520 | **592 x 64** | 148 x 16 | centre | horizontal | alpha | none | 1 |
| **Vault seal — H, discovered** | same collider, gold indicator strip | **592 x 64** | 148 x 16 | centre | horizontal | alpha | none | 1 |
| **Vault seal — V, sealed** | 16 x 148 | **64 x 592** | 16 x 148 | centre | vertical | alpha | none | 1 |
| **Vault seal — V, discovered** | same | **64 x 592** | 16 x 148 | centre | vertical | alpha | none | 1 |
| **Crate** (29.4% of cover) | 46 x 46, hp 70, blocks sight, destructible | **184 x 184** | 46 x 46 | centre | fixed | alpha | none | **4** |
| **Barrier** (9.1%) | 96 x 26, hp 120, blocks sight, destructible | **384 x 104** | 96 x 26 | centre | fixed axis-aligned | alpha | none | 2–4 |
| **Pillar** (34.5% — most common) | 40 x 40 box collider, drawn as circle r = 20 | **160 x 160** | 40 x 40 | centre | fixed | alpha | none | **4** |
| **Machinery** (9.2%) | 96 x 74, indestructible, blocks sight | **384 x 296** | 96 x 74 | centre | fixed | alpha | none | 2–4 |
| **Lowcover** (12.4%) | 80 x 24, hp 90, **does not block sight** | **320 x 96** | 80 x 24 | centre | fixed | alpha | none | 2–4 |
| **Container** (5.2%) | 128 x 60, hp 180, blocks sight, destructible | **512 x 240** | 128 x 60 | centre | fixed | alpha | none | 2–4 |
| **Steam vent — dormant** | r = 56 (dia 112) | **448 x 448** | 112 x 112 | centre | radial | alpha | none | 1–2 |
| **Steam vent — active** | r = 56, damage 16 / 6.5 s | **448 x 448** | 112 x 112 | centre | radial | alpha, additive-safe | none | 1 |
| **Live floor — dormant** | r = 88 (dia 176) | **704 x 704** | 176 x 176 | centre | radial | alpha | none | 1–2 |
| **Live floor — active** | r = 88, damage 12 / 7.5 s, shock | **704 x 704** | 176 x 176 | centre | radial | alpha, additive-safe | none | 1 |
| **Decor scatter** | size 10 – 42, **arbitrary rotation**, alpha .035–.10 | **168 x 168** | 10 – 42 (scaled) | centre | **rotation-invariant — no baked light** | alpha | none | **6** (matches `rng.int(0,5)`) |
| **Vault floor sigil** | disc r = 40.6 (`half*.7`), pulsing | **336 x 336** | 81 x 81 | centre | fixed | alpha | none | 2 (sealed / breached) |
| **Perimeter edge** *(optional)* | dashed line, sector boundary | **512 x 128** | 128 x 32 | edge | 4 edge orientations | alpha | repeat along edge | 1 |

**Padding:** allow 4px transparent bleed at 4x on every alpha asset.

**Shadows:** do **not** bake the existing `rgba(0,0,0,.4–.45)` drop shadows into
the sprites unless the engine's offset fill is removed at the same time. Doing
both double-darkens.

**Total asset count:** minimum 22 files. Full pack with 4 variants on the two
dominant cover types and 2–4 elsewhere: **58–74 files**, or one atlas.

---

## 2. Proposed directory structure (recommendation)

Mirrors the existing empty `assets/sprites/{operatives,enemies,bosses,weapons,effects}/`
scaffolding. `environment/` does not exist yet.

```
assets/sprites/environment/blacksite/
  floor/      floor-tile.webp
  walls/      wall-h-cap-l-{0..3}.webp  wall-h-mid-{0..3}.webp  wall-h-cap-r-{0..3}.webp
              wall-v-cap-t-{0..3}.webp  wall-v-mid-{0..3}.webp  wall-v-cap-b-{0..3}.webp
  cover/      crate-{0..3}.webp  pillar-{0..3}.webp  barrier-{0..3}.webp
              machinery-{0..3}.webp  lowcover-{0..3}.webp  container-{0..3}.webp
  vault/      chamber-wall-h.webp  chamber-wall-v.webp
              seal-h-sealed.webp   seal-h-found.webp
              seal-v-sealed.webp   seal-v-found.webp
              sigil-sealed.webp    sigil-open.webp
  hazards/    steam-dormant.webp   steam-active.webp
              live-dormant.webp    live-active.webp
  decor/      decor-{0..5}.webp
```

---

## 3. Minimum viable art pack

The smallest set that makes Blacksite read as authored rather than procedural.
**22 assets.**

1. `floor-tile` — 512 x 512, seamless. Highest impact per asset by a wide margin:
   it is the only thing covering all 4.2–11.3 million world units squared of the sector.
2. `wall-h-cap-l`, `wall-h-mid`, `wall-h-cap-r` — 3 assets
3. `wall-v-cap-t`, `wall-v-mid`, `wall-v-cap-b` — 3 assets
4. `crate`, `pillar`, `barrier`, `machinery`, `lowcover`, `container` — 6 assets, one variant each
5. `seal-h-sealed`, `seal-h-found`, `seal-v-sealed`, `seal-v-found` — 4 assets
6. `chamber-wall-h`, `chamber-wall-v` — 2 assets
7. `steam-active`, `live-active` — 2 assets (dormant states can stay vector)

Deliberately excluded from MVP: decor (423–1254 instances at 3.5–10% alpha; near
invisible, worst effort-to-visibility ratio in the theatre), variants, and the
vault sigil.

## 4. Full art pack

MVP plus:

8. **4 variants of `pillar` and `crate`** — these are 63.9% of all cover. Doing
   only these two at 4 variants eliminates most of the visible repetition for 6
   extra assets. Highest-value addition in the whole pack.
9. 2–4 variants of `barrier`, `machinery`, `lowcover`, `container` — 4 to 12 assets
10. 2–4 variants of each wall slice — 6 to 18 assets
11. `steam-dormant`, `live-dormant` — 2 assets
12. `sigil-sealed`, `sigil-open` — 2 assets
13. `decor-{0..5}` — 6 assets, rotation-invariant
14. `perimeter-edge` — 1 asset

Full pack total: **58–74 assets**. At 4x masters in WebP, budget roughly 6–11 MB
source, 1.5–3 MB shipped.

---

## 5. Integration risks

### R1 — There is no image pipeline in the renderer at all (blocking)

Searching for `new Image(`, `createImageBitmap` and `.src=` across `src/` returns
four hits: a codec portrait, two splash-screen loads, and an audio source. The
`Renderer` loads nothing. Its constructor is synchronous and `render()` runs on
frame 1 of the very first `requestAnimationFrame`. There is no atlas, no loader,
no readiness gate and no decode-error path.

All of that has to be built, and every draw path needs a fallback to the current
vector code so a failed decode degrades instead of showing a blank sector. **This
is the largest single piece of work in the integration and it is entirely
infrastructure, not art.**

### R2 — Pattern scaling for the floor tile

`createPattern(tile,'repeat')` tiles in the *current transform's* units. The tile
is currently 128 canvas px = 128 world units, 1:1. A 512px master must be mapped
to a 128-unit period via `pattern.setTransform(new DOMMatrix().scale(0.25))`.

`CanvasPattern.setTransform` is unsupported on iOS Safari below 14.1 — this needs
either a version floor or a pre-downscaled fallback tile. The alternative (drawing
the tile manually in a nested loop) costs roughly 144 `drawImage` calls per frame
at full desktop zoom and should be avoided.

### R3 — Fixed light direction forbids rotation reuse

Per 0.11 the whole theatre is lit from upper-left at about 60 degrees. Horizontal
and vertical wall art, and both vault-seal orientations, must be authored
separately. Rotating to save assets will visibly break the lighting on roughly
half the geometry — and both seal orientations occur with equal frequency
(144 / 149 across 120 seeds), so the error would be visible in every single run.

### R4 — `imageSmoothingEnabled` is inherited global state

It is set to `true` in `drawDecals` and in the lighting composite, and never set
in `drawGeometry`. This currently doesn't matter because nothing in
`drawGeometry` is an image. Once walls and cover become `drawImage` calls they
will silently inherit whatever the previous block left set. Any sprite path must
set it explicitly per block.

### R5 — Broken destructibles vanish with no rubble state

`drawGeometry` does `if(cover.broken)continue;`. `crate`, `barrier`, `lowcover`,
`container` and `vaultSeal` all destruct and simply disappear. Authored art will
make that pop far more than flat rectangles do. Adding destroyed-state sprites is
a gameplay-visual change and would also require a `broken` art path in the
renderer.

### R6 — The integrity bar overlaps oversized art

Damaged destructibles draw a 28 x 3 bar at `cover.y - cover.hh - 7`. Art that
extends more than about 7 world units above its collider will be crossed by it.

### R7 — The `default` case in `drawCoverPiece` silently catches unknown types

`case 'container': default:` — any cover type without a case draws as a container.
Currently harmless, but it makes a typo in an asset-keyed lookup fail silently
rather than loudly.

### R8 — The additive lighting pass will blow out bright art

`drawLighting()` composites at `globalCompositeOperation='lighter'` over the whole
frame: the player carries a 190-unit light, every active hazard adds
`radius*1.6` at intensity .8, and every projectile adds 44–70 units. Authored art
with baked specular highlights will clip to white in combat. **Keep masters in the
mid-value range and let the engine light them** — this is a real constraint on the
paintover, not a nitpick.

### R9 — The vignette tints all edges

`drawPost` fills a radial gradient to `palette.fog` = `rgba(2,8,12,.55)` from 32%
to 78% of the frame. Art evaluated flat in a viewer will look considerably
brighter than it does in play.

### R10 — Camera shake jitters geometry sub-pixel

Cover with `shake > 0` is translated by up to +/-7px randomly per frame, and
camera shake adds +/-26 / +/-22px plus +/-0.012 rad rotation. Art with 1px
hairlines will shimmer. Keep minimum feature width at 2 world units or more.

### R11 — Instance counts favour an atlas over individual images

A 30-minute sector holds up to 482 cover pieces, 42 walls, 9 vault walls, 3 seals,
10 hazards and 1254 decor items. Frustum culling cuts what is drawn, but with
58–74 separate `HTMLImageElement`s the per-draw texture switches will hurt on
mobile. A single atlas (or a small number of them) with source-rect blits is the
right call.

### R12 — 4.00 px/world-unit is a hard ceiling; do not over-author

Established in 0.10. Nothing in the engine can display more than 4 device pixels
per world unit — the clamp in `camera.resize` and the DPR cap in `main.js:143`
both bound it, and the only `punchZoom` in the codebase is negative. 4x masters
are exactly right.

### R13 — Blacksite has no landmark path

`world.landmarks` is empty for `complex` layouts. Any hero prop (a reactor, a
containment cell, a signature set-piece) needs new placement code in
`generateComplex()` and would alter world generation.

### R14 — The minimap will diverge

`drawMinimap` renders walls and cover as plain rectangles from the same data.
Authored art will not reach it. Cosmetic and low priority, but it will look
inconsistent once the world is painted.

### R15 — No service worker or asset manifest exists

The repo has no `sw.js` and no cache manifest. `index.html` preloads only the two
title screens. New art will be fetched cold on first run with no offline story.
Not blocking, but 1.5–3 MB of first-load art on mobile is worth a preload strategy.

### R16 — 25-minute and 30-minute contracts are visually identical

Both clamp to 3360 x 3360. Not an art problem, but worth knowing when sizing the
largest sector.

---

## 6. Recommended integration order

1. **Build the loader and the fallback path first, with zero art.** An atlas
   loader, a `ready` flag, and `drawImage`-or-vector branches in `drawFloor`,
   `drawGeometry` and `drawCoverPiece`. Ship it with the vector path still active
   and verify no regression. This de-risks R1 before a single pixel is drawn.
2. **Floor tile.** One asset, largest visible area, no dependency on the geometry
   work. Resolves R2 in isolation. This alone will change how the theatre reads.
3. **Walls — the 3-slice.** The hardest geometry problem (arbitrary lengths, both
   orientations, R3). Do it second in geometry so the slicing maths is proven
   before the cover pass, and validate against the measured length distribution:
   it must look correct at 35 units *and* at 695.
4. **Cover — pillar and crate first.** 63.9% of all cover between them. Getting
   these two right delivers most of the perceived change in the cover field.
5. **Cover — the remaining four.** barrier, machinery, lowcover, container.
6. **Vault seals and chamber walls.** Fixed sizes, two orientations, two discovery
   states. Self-contained; the discovery state already reads off
   `cover.vault.discovered`.
7. **Hazards.** Three states each; the active state must survive the additive pass (R8).
8. **Wire up the `variant` field.** Free, already persisted, already deterministic
   — flip from one sprite to `sprites[cover.variant]`. Do this once the base
   sprites are proven so variant bugs are distinguishable from sprite bugs.
9. **Decor and the perimeter edge.** Lowest visibility, last.

This order front-loads all the infrastructure risk, then descends strictly by
visible area multiplied by instance count.

---

## 7. Verdict — GO, with two conditions

Blacksite Zero is the best possible first theatre for authored art, and the
numbers say so clearly:

- Cover comes in exactly **six fixed sizes**, never scaled, never rotated — six
  sprites cover 100% of the cover field.
- Wall thickness is a hard constant of **26**, with variance only along one axis.
- The camera is **strictly orthographic** with a hard **4.00 px/world-unit
  ceiling** — no perspective, no isometry, no ambiguity about what to author or at
  what resolution.
- The theatre has **no landmarks, no weather and no water**, so there are no
  bespoke props and no atmospheric layer to fight.
- Anchors are unambiguous: centre position, blit from centre minus half-extents.
- A **4-way variant channel already exists and is already persisted** on every
  wall and cover piece, costing nothing to adopt.

**Condition 1 — build the loader before commissioning art (R1).** There is
currently no image pipeline in the renderer whatsoever. Commissioning 58–74 assets
against an engine that cannot load one is the way this project stalls. The loader
and the vector fallback are a self-contained piece of work that can be done and
verified with no art at all, and it should be done first.

**Condition 2 — walls must be 3-sliced, not stretched (R3, section 0.3).**
Measured segment lengths are continuous reals spread near-uniformly from 35 to 695
units at a fixed 26-unit thickness — up to 27:1 aspect. A stretched wall sprite
will smear visibly on the majority of segments. Horizontal and vertical slice sets
must be authored separately because of the fixed upper-left key light.

Meet those two and there is nothing else in the codebase that blocks this.

---

## Appendix — audit provenance

The audit was performed read-only against `45d2b3a`. No engine, world-generation,
collision, spawning, AI, balance, rendering or save-data code was modified to
produce it. Measurements were taken by importing `src/game/world.js` and
`data/maps.js` into a throwaway Node process and generating sectors from the real
`blacksite` map definition; nothing was written to the repository during
inspection.

This document is the only file the audit added.
