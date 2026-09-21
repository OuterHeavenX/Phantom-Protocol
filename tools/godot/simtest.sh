#!/bin/sh
# Play op1 headlessly and assert the contract actually works.
#
#   tools/godot/simtest.sh [SECONDS]
#
# There is no renderer here: this drives the ported simulation on its fixed
# 60 Hz clock with a stand-in operative that kites the nearby group and walks
# to the beacon once the window closes. It exists because every mechanical bug
# so far has been invisible in a screenshot and obvious here -- weapons that
# targeted further than their rounds could travel, and targeting that ignored
# line of sight and spent two thirds of a contract shooting masonry.
set -e
SECONDS_ARG=${1:-340}
ROOT=$(cd "$(dirname "$0")/../../godot" && pwd)
OUT=$(timeout 300 godot --headless --path "$ROOT" -- simtest "$SECONDS_ARG" 2>&1 | grep "^SIMTEST" || true)
echo "$OUT"
[ -n "$OUT" ] || { echo "FAIL: simulation produced no report"; exit 1; }

value() { echo "$OUT" | tr ' ' '\n' | grep "^$1=" | cut -d= -f2 | head -1; }
fail=0
note() { echo "  $1"; fail=1; }

[ "$(value outcome)" = "extracted" ] || note "contract did not end in extraction (outcome=$(value outcome))"
[ "$(value kills)" -ge 20 ] 2>/dev/null || note "only $(value kills) kills: the loadout is not engaging"
[ "$(value peak)" -ge 8 ] 2>/dev/null || note "peak hostiles $(value peak): the director is not escalating"
[ "$(value level)" -ge 5 ] 2>/dev/null || note "reached only level $(value level): experience is not accruing"

blocked=$(echo "$OUT" | tr ' ' '\n' | grep "^blocked=" | cut -d= -f2 | head -1)
hit=$(echo "$OUT" | tr ' ' '\n' | grep "^hit=" | cut -d= -f2 | head -1)
# More rounds into walls than into hostiles means targeting has stopped
# consulting line of sight, which is exactly how this started.
[ "$blocked" -lt "$hit" ] 2>/dev/null || note "more rounds blocked ($blocked) than landed ($hit): line of sight is not being checked"

if [ "$fail" -ne 0 ]; then echo "FAIL"; exit 1; fi
echo "ok: the contract plays and can be completed"
