#!/bin/sh
# Export the Godot build for one or all targets.
#
#   tools/godot/export.sh            # every preset
#   tools/godot/export.sh Web        # one preset by name
#
# Presets live in godot/export_presets.cfg. Desktop is the primary target --
# Steam, and the Steam Deck through the Linux build, which runs natively there
# rather than under Proton. Web is a second target sharing the same project.
#
# The two do not share a renderer. Browsers have no Vulkan, so the web build
# runs Godot's Compatibility backend over WebGL2 while desktop stays on
# Forward+. project.godot selects that per platform, so nothing here branches.
set -e
ROOT=$(cd "$(dirname "$0")/../../godot" && pwd)
OUT=$(cd "$ROOT/.." && pwd)/build
ONLY=$1

# Import first. Exporting a project whose textures have not been imported in
# the target's compression format fails with a bare "configuration errors" and
# no further explanation, which is a long way to walk for a missing step.
timeout 1200 godot --headless --path "$ROOT" --import >/dev/null 2>&1 || true

run() {
  name=$1; dir=$2
  [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && return 0
  mkdir -p "$OUT/$dir"
  printf '%s ... ' "$name"
  if timeout 1200 godot --headless --path "$ROOT" --export-release "$name" 2>&1 \
     | grep -qiE "ERROR: (Cannot export|Project export)"; then
    echo "FAILED"
    timeout 1200 godot --headless --path "$ROOT" --export-release "$name" 2>&1 \
      | grep -iE "error" | head -5
    return 1
  fi
  echo "ok ($(du -sh "$OUT/$dir" | cut -f1))"
}

run Linux linux
run Windows windows
run Web web
echo "builds in $OUT"
