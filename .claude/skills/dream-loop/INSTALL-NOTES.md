# Install notes for this vendored copy

Upstream: https://github.com/achimala/dream-loop (MIT), at commit 9bddb90.

Vendored into the repository rather than into `~/.claude/skills` because the
remote container is ephemeral: anything outside the working tree is lost when
it restarts, and a skill that disappears between sessions is not installed.

Two changes from upstream, both cosmetic:

- `assets/vesper-preview.gif` (6.7 MB) was dropped. It is a README demo
  animation that no part of the skill reads. The README now links it upstream.
- This file was added.

Everything the skill executes is unmodified: `SKILL.md`, both workflows, the
3D asset guidance, `scripts/fal-batch.mjs`, and `scripts/preview-server.py`.

## What it needs that this environment already has

- **Blender** — `tools/env/install-tools.sh` installs it (step 3 of the
  asset ladder in `references/*/assets-3d.md`).
- **Subagents and vision** — available.
- **A local preview server and screenshots** — `scripts/preview-server.py`,
  plus the repo's existing Playwright capture harnesses under `tools/`.

## What it needs that is NOT configured

- **`FAL_KEY` / `FAL_API_KEY`** for image-to-3D (step 2 of the ladder). Absent,
  so `scripts/fal-batch.mjs submit` will refuse. `check` works offline.
- **An image generation tool for the target screenshot.** The skill will not
  start without one. This session has game-art generation over MCP, which fits
  sprite and texture work; whether it can produce a full target screenshot is
  untested here.

To refresh from upstream: re-clone, drop `assets/`, and keep this file.
