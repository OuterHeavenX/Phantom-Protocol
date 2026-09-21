#!/bin/sh
# Parse-check every GDScript in the project.
#
# A GDScript parse error does not stop Godot: the scene loads with a null
# script, nothing runs, and -- because the capture watchdog is itself created
# in _ready -- the process sits there until something else kills it. Three
# captures were written off as "software rendering is slow" before it turned
# out the build had not compiled at all. This makes that failure loud and
# takes a few seconds.
set -e
ROOT=$(cd "$(dirname "$0")/../../godot" && pwd)
OUT=$(timeout 120 godot --headless --path "$ROOT" --quit-after 2 2>&1 || true)
if echo "$OUT" | grep -qE "SCRIPT ERROR|Parse Error|Compile Error"; then
  echo "$OUT" | grep -E "SCRIPT ERROR|Parse Error|Compile Error|  at: " | head -20
  echo "FAIL: GDScript did not compile"
  exit 1
fi
echo "ok: all scripts compile"
