#!/bin/sh
# Turn the raw web export into a directory Cloudflare Pages will accept.
#
#   tools/godot/pages-bundle.sh
#
# Pages refuses any single asset over 25 MiB. Godot 4.5's release wasm is
# 36.3 MiB and there is no smaller template, so it cannot be uploaded as it
# stands. It does compress to about 8.8 MiB.
#
# The first attempt stored those compressed bytes under the wasm's own name and
# used a _headers rule to declare Content-Encoding. That works against a local
# server and does not work on Pages: the deployed asset came back as 9,256,790
# bytes, exactly the compressed size, so the header never reached the client
# and a browser would have handed gzip to WebAssembly and failed on the magic
# number. The deploy reported success throughout.
#
# Nothing is asked of the host now. The engine ships as an ordinary asset
# called index.wasm.gz and a small script injected into the shell decompresses
# it in the page with DecompressionStream. No header rules, no host behaviour
# to depend on, and it would work the same on any static host.
#
# The package needs none of this. It is Basis-compressed texture data, already
# entropy coded -- gzip took 35.9 MiB to 35.5 -- so it had to come down by
# being smaller rather than by being compressed. It is 14.9 MiB.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SRC="$ROOT/build/web"
OUT="$ROOT/build/pages"
LIMIT=$((25 * 1024 * 1024))

[ -f "$SRC/index.wasm" ] || { echo "no web export at $SRC; run tools/godot/export.sh Web" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$SRC"/* "$OUT"/
rm -f "$OUT/index.wasm"
gzip -9 -c "$SRC/index.wasm" > "$OUT/index.wasm.gz"

# Inject the decompression shim ahead of every other script in the shell, so
# fetch is already wrapped by the time the engine asks for its wasm.
python3 - "$OUT/index.html" "$ROOT/tools/godot/wasm-gz-shim.html" <<'PYEOF'
import sys
page, shim = sys.argv[1], sys.argv[2]
html = open(page).read()
inject = open(shim).read()
marker = "<head>"
if marker not in html:
    sys.exit("no <head> in the exported shell; cannot inject the wasm shim")
html = html.replace(marker, marker + "\n" + inject, 1)
open(page, "w").write(html)
PYEOF

cat > "$OUT/_headers" <<'HDR'
# No Content-Encoding rule here. Pages did not apply one, which is the whole
# reason the engine is fetched and decompressed by the page instead.
/index.wasm.gz
  Content-Type: application/gzip
  Cache-Control: public, max-age=31536000, immutable

/index.pck
  Content-Type: application/octet-stream
  Cache-Control: public, max-age=31536000, immutable

# The shell is the one thing that must never be served stale, since it points
# at everything else.
/index.html
  Cache-Control: public, max-age=0, must-revalidate
HDR

# stat's flags differ between GNU and BSD, and this script runs both on a
# Linux CI runner and on a developer's Mac. awk does the arithmetic rather
# than bc, which is not installed on the GitHub runner images.
filesize() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1"
}

over=0
for f in "$OUT"/*; do
  [ -f "$f" ] || continue
  size=$(filesize "$f")
  if [ "$size" -gt "$LIMIT" ]; then
    echo "$size $(basename "$f")" | awk '{printf "  OVER LIMIT %7.1f MiB  %s\n", $1/1048576, $2}'
    over=1
  fi
done
if [ "$over" -ne 0 ]; then
  echo "FAIL: Cloudflare Pages rejects assets over 25 MiB" >&2
  exit 1
fi

echo "bundle in $OUT ($(du -sh "$OUT" | cut -f1))"
for f in "$OUT"/*; do
  [ -f "$f" ] || continue
  echo "$(filesize "$f") $(basename "$f")"
done | sort -rn | awk '{printf "  %7.2f MiB  %s\n", $1/1048576, $2}' 
