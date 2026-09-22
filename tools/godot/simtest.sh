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
ONLY_OP=${2:-}

value() { echo "$OUT" | tr ' ' '\n' | grep "^$1=" | cut -d= -f2 | head -1; }
fail=0
note() { echo "  $1"; fail=1; }

run_op() {
  op=$1
  echo "-- op$op"
  OUT=$(timeout 400 godot --headless --path "$ROOT" -- simtest "$SECONDS_ARG" op "$op" 2>&1 | grep "^SIMTEST" || true)
  echo "$OUT"
  [ -n "$OUT" ] || { echo "  FAIL: simulation produced no report"; fail=1; return; }
  check_common
}

check_common() {
  [ "$(value outcome)" = "extracted" ] || note "contract did not end in extraction (outcome=$(value outcome))"
  [ "$(value kills)" -ge 12 ] 2>/dev/null || note "only $(value kills) kills: the loadout is not engaging"
  [ "$(value peak)" -ge 8 ] 2>/dev/null || note "peak hostiles $(value peak): the director is not escalating"
  [ "$(value level)" -ge 5 ] 2>/dev/null || note "reached only level $(value level): experience is not accruing"

  blocked=$(echo "$OUT" | tr ' ' '\n' | grep "^blocked=" | cut -d= -f2 | head -1)
  hit=$(echo "$OUT" | tr ' ' '\n' | grep "^hit=" | cut -d= -f2 | head -1)
  # More rounds into walls than into hostiles means targeting has stopped
  # consulting line of sight, which is exactly how this started.
  [ "$blocked" -lt "$hit" ] 2>/dev/null || note "more rounds blocked ($blocked) than landed ($hit): line of sight is not being checked"

  # An operation with its own objective has to be completable, not just
  # survivable. CROSSFALL keeps the beacon shut until three data caches are
  # recovered, so an extraction there is only meaningful with all three in.
  caches=$(echo "$OUT" | tr ' ' '\n' | grep "^caches=" | cut -d= -f2 | head -1)
  if [ -n "$caches" ]; then
    got=${caches%%/*}
    want=${caches##*/}
    [ "$got" = "$want" ] 2>/dev/null || note "recovered $caches caches: the objective was not completed"
  fi
}

if [ -n "$ONLY_OP" ]; then
  run_op "$ONLY_OP"
else
  # Every contract this build can run, because a change to the simulation
  # that only the opening sector exercises is a change that has not been
  # tested.
  run_op 1
  run_op 2
fi

if [ "$fail" -ne 0 ]; then echo "FAIL"; exit 1; fi
echo "ok: every contract plays and can be completed"
