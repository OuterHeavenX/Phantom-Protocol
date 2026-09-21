#!/bin/sh
# Turn the raw web export into a directory Cloudflare Pages will accept.
#
#   tools/godot/pages-bundle.sh
#
# Pages refuses any single asset over 25 MiB. Godot 4.5's release wasm is
# 36.3 MiB and there is no smaller template, so it cannot be uploaded as it
# stands. It does compress to about 8.8 MiB, though, and compression is not
# only a transfer concern: an asset may be STORED compressed as long as the
# response declares how it was encoded. So the wasm is gzipped on disk, kept
# under its original name, and _headers tells Pages to serve it with
# Content-Encoding: gzip. Browsers decompress it before it reaches
# WebAssembly.instantiateStreaming and never know the difference.
#
# The package does not get this treatment. It is Basis-compressed texture data,
# which is already entropy coded -- gzip took 35.9 MiB to 35.5 -- so it had to
# come down by being smaller rather than by being compressed. It is 14.9 MiB.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SRC="$ROOT/build/web"
OUT="$ROOT/build/pages"
LIMIT=$((25 * 1024 * 1024))

[ -f "$SRC/index.wasm" ] || { echo "no web export at $SRC; run tools/godot/export.sh Web" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$SRC"/* "$OUT"/
gzip -9 -c "$SRC/index.wasm" > "$OUT/index.wasm"

cat > "$OUT/_headers" <<'HDR'
# The wasm on disk here is gzip, stored under its uncompressed name so that
# Godot's loader can fetch it by the name it expects. Without this header the
# browser hands the compressed bytes straight to WebAssembly and the module
# fails its magic-number check.
/index.wasm
  Content-Type: application/wasm
  Content-Encoding: gzip
  Cache-Control: public, max-age=31536000, immutable

/index.pck
  Content-Type: application/octet-stream
  Cache-Control: public, max-age=31536000, immutable

# The shell is the only thing that should ever be served stale-free, since it
# is what points at everything else.
/index.html
  Cache-Control: public, max-age=0, must-revalidate
HDR

over=0
for f in "$OUT"/*; do
  [ -f "$f" ] || continue
  size=$(stat -c%s "$f")
  if [ "$size" -gt "$LIMIT" ]; then
    printf '  OVER LIMIT %7.1f MiB  %s\n' "$(echo "$size/1048576" | bc -l)" "$(basename "$f")"
    over=1
  fi
done
if [ "$over" -ne 0 ]; then
  echo "FAIL: Cloudflare Pages rejects assets over 25 MiB" >&2
  exit 1
fi

echo "bundle in $OUT ($(du -sh "$OUT" | cut -f1))"
ls -l "$OUT" | awk 'NR>1 {printf "  %7.2f MiB  %s\n", $5/1048576, $9}' | sort -rn
