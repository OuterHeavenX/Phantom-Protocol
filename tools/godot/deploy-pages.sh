#!/bin/sh
# Export, bundle and deploy the browser build to Cloudflare Pages.
#
#   tools/godot/deploy-pages.sh [PROJECT_NAME]
#
# Needs Godot 4.5 with export templates installed, and Cloudflare credentials
# in the environment:
#
#   export CLOUDFLARE_ACCOUNT_ID=...
#   export CLOUDFLARE_API_TOKEN=...     # scope: Cloudflare Pages -- Edit
#
# Or run `npx wrangler login` once, which opens a browser and stores an OAuth
# token, and skip the two variables.
#
# The deploy is followed by a check, because the last arrangement failed
# silently. Godot 4.5's release wasm is 36.3 MiB and Pages refuses anything
# over 25 MiB, so the engine ships gzipped and is decompressed in the page.
# If that upload is ever truncated or corrupt the site simply will not start,
# and the deploy says nothing, so the compressed engine is fetched back and
# inflated to confirm it matches what went up.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PROJECT=${1:-red-static-3d}

sh "$ROOT/tools/godot/export.sh" Web
sh "$ROOT/tools/godot/pages-bundle.sh"

echo "deploying to Cloudflare Pages project '$PROJECT' ..."
OUT=$(npx --yes wrangler@latest pages deploy "$ROOT/build/pages" \
  --project-name "$PROJECT" --commit-dirty=true 2>&1)
echo "$OUT"

URL=$(echo "$OUT" | grep -oE 'https://[a-z0-9.-]*\.pages\.dev' | tail -1)
if [ -z "$URL" ]; then
  echo "deployed, but no URL was printed; check the output above" >&2
  exit 0
fi

echo
echo "verifying $URL ..."
WANT=$(stat -c%s "$ROOT/build/web/index.wasm" 2>/dev/null \
       || stat -f%z "$ROOT/build/web/index.wasm")
GOT=$(curl -sS --fail --retry 12 --retry-delay 10 --retry-all-errors \
        "$URL/index.wasm.gz" | gzip -dc | wc -c | tr -d ' ')
if [ "$GOT" != "$WANT" ]; then
  echo "FAIL: the served engine inflated to $GOT bytes, expected $WANT." >&2
  echo "      The upload is truncated or corrupt; the page will not start." >&2
  exit 1
fi
echo "ok: the served engine inflates to $GOT bytes"
echo
echo "play at $URL"
