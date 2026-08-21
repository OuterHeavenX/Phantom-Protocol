#!/bin/sh
# Static checks for a project with no build step. Both of these exist because
# each one caught a shipped bug that stopped the game starting.
set -e
cd "$(dirname "$0")/.."

echo "== eslint =="
npx --yes eslint src data

echo
echo "== construction order =="
python3 tools/construction-order.py src data
