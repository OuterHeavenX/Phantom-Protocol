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
# Parse each script on its own first.
#
# Booting the project reports only the first failure it trips over, and that
# failure is usually a symptom rather than the cause: one script failing to
# parse makes its `class_name` unresolvable, so every file that refers to it
# reports its own error and the real one is not in the list. Checking files
# individually names the actual line.
#
# Autoload singletons are registered when the project boots, not when a single
# script is parsed, so every reference to one is reported here as an unknown
# identifier -- along with the knock-on "failed to compile depended scripts"
# from any file that refers to one. Those two are dropped; the boot check
# below is what covers them.
AUTOLOADS=$(sed -n '/^\[autoload\]/,/^\[/p' "$ROOT/project.godot" \
  | grep -oE '^[A-Za-z_][A-Za-z0-9_]*' | tr '\n' '|' | sed 's/|$//')
[ -n "$AUTOLOADS" ] || AUTOLOADS="__none__"

FAILED=0
for f in "$ROOT"/scripts/*.gd; do
  ONE=$(timeout 60 godot --headless --path "$ROOT" --check-only --script "$f" 2>&1 \
    | grep -vE "Identifier not found: ($AUTOLOADS)|Failed to compile depended scripts" || true)
  if echo "$ONE" | grep -qE "Parse Error|Compile Error"; then
    echo "--- ${f##*/}"
    echo "$ONE" | grep -E "Parse Error|Compile Error|  at: " | head -6
    FAILED=1
  fi
done
if [ "$FAILED" -ne 0 ]; then
  echo "FAIL: GDScript parse error"
  exit 1
fi

# Then boot it, which catches what parsing alone cannot: missing resources,
# bad property names and anything that throws while the scene is built.
OUT=$(timeout 120 godot --headless --path "$ROOT" --quit-after 2 2>&1 || true)
if echo "$OUT" | grep -qE "SCRIPT ERROR|Parse Error|Compile Error"; then
  echo "$OUT" | grep -E "SCRIPT ERROR|Parse Error|Compile Error|  at: " | head -20
  echo "FAIL: GDScript did not compile, or threw while building the scene"
  exit 1
fi
# Finally the assertions that do not need a contract to run: campaign
# progression, which decides which sector loads and what follows what, and
# the save round-trip that makes it survive a reload.
TESTS=$(timeout 120 godot --headless --path "$ROOT" --script res://tests/progression_test.gd 2>&1 || true)
for marker in "PROGRESSION OK" "PERSISTENCE OK" "BEARING OK"; do
  if ! echo "$TESTS" | grep -q "$marker"; then
    echo "$TESTS" | grep -E "Assertion|SCRIPT ERROR|  at: " | head -10
    echo "FAIL: $marker assertions"
    exit 1
  fi
done
echo "ok: all scripts compile, progression, persistence and HUD bearings asserted"
