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
# Import first. A newly added `class_name` is not resolvable until the project
# has been rescanned, so without this the check reports a parse error for a
# file that is perfectly fine -- and, worse, a real error looks the same.
timeout 240 godot --headless --path "$ROOT" --import >/dev/null 2>&1 || true
OUT=$(timeout 120 godot --headless --path "$ROOT" --quit-after 2 2>&1 || true)
if echo "$OUT" | grep -qE "SCRIPT ERROR|Parse Error|Compile Error"; then
  echo "$OUT" | grep -E "SCRIPT ERROR|Parse Error|Compile Error|  at: " | head -20
  echo "FAIL: GDScript did not compile, or threw while building the scene"
  exit 1
fi
echo "ok: all scripts compile"
