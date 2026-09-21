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
# The deploy is followed by a check, because this bundle depends on something
# Cloudflare could in principle change under it. Godot 4.5's release wasm is
# 36.3 MiB and Pages refuses any asset over 25 MiB, with no smaller template
# to fall back on, so the wasm is stored gzipped under its uncompressed name
# and _headers declares the encoding. If Cloudflare ever stops honouring that
# header -- or re-encodes the body -- the page goes white with a magic-number
# error and nothing else says why. The check fetches the deployed wasm and
# confirms it decodes to the same byte count that went up.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PROJECT=${1:-red-static}

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
GOT=$(curl -sS --compressed "$URL/index.wasm" | wc -c | tr -d ' ')
if [ "$GOT" != "$WANT" ]; then
  echo "FAIL: the served wasm decoded to $GOT bytes, expected $WANT." >&2
  echo "      Cloudflare is not honouring Content-Encoding on this asset," >&2
  echo "      so the build will not start. Serve index.wasm from an R2" >&2
  echo "      public bucket instead and point the shell at it." >&2
  exit 1
fi
echo "ok: wasm decodes to $GOT bytes"
echo
echo "play at $URL"
