#!/bin/sh
# Frame-cost report for the 3D build.
#
#   tools/godot/perf.sh [FRAMES] [WIDTHxHEIGHT]
#
# Renders on Mesa's software Vulkan, so the milliseconds it prints are not a
# phone's or a desktop's. The draw-call and object counts are, because they
# are what the scene asks of any renderer. Run it small: a software rasteriser
# at 1600x900 costs tens of seconds a frame, and the counts are the same at
# 320x180.
set -e
FRAMES=${1:-8}
RES=${2:-320x180}
W=${RES%x*}
H=${RES#*x}
ROOT=$(cd "$(dirname "$0")/../../godot" && pwd)
xvfb-run -a --server-args="-screen 0 ${W}x${H}x24" \
  env VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.json \
      VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json \
  godot --path "$ROOT" --rendering-driver vulkan --resolution "${W}x${H}" \
  -- perf "$FRAMES" 2>&1 \
  | grep -viE "alsa|pulse|ALSA|ERROR: Condition .status" || true
