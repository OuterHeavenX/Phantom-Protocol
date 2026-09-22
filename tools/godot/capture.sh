#!/bin/sh
# Render one frame of the 3D build offscreen and write it as a PNG.
#
#   tools/godot/capture.sh OUT.png [VIEWPOINT] [WIDTHxHEIGHT]
#
# There is no GPU here, so this runs Godot's Forward+ renderer on Mesa's
# software Vulkan (lavapipe) inside a virtual framebuffer. That is slow --
# seconds per frame -- but it is the same renderer and the same shaders the
# game uses on real hardware, so what the judge scores is what a player sees.
# The compatibility renderer would be faster and would quietly drop SSAO,
# SSIL and the glow pass, which are most of what is being judged.
set -e
OUT=${1:-/tmp/shot.png}
VIEW=${2:-corridor}
RES=${3:-1600x900}
LEVEL=${4:-blacksite}
W=${RES%x*}
H=${RES#*x}
ROOT=$(cd "$(dirname "$0")/../../godot" && pwd)
mkdir -p "$(dirname "$OUT")"
# Godot runs with its own project directory as the working directory, so a
# relative output path would be written somewhere inside godot/ and the check
# below would report a failure for a frame that rendered perfectly well.
OUT=$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")
rm -f "$OUT"
xvfb-run -a --server-args="-screen 0 ${W}x${H}x24" \
  env VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.json \
      VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json \
  godot --path "$ROOT" --rendering-driver vulkan --resolution "${W}x${H}" \
  -- capture "$OUT" view "$VIEW" level "$LEVEL" 2>&1 \
  | grep -viE "alsa|pulse|audio|ERROR: Condition .status" || true
test -s "$OUT" || { echo "CAPTURE FAILED: no image at $OUT" >&2; exit 1; }
echo "ok $OUT ($(stat -c%s "$OUT") bytes)"
