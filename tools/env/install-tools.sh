#!/bin/sh
# Installs the content tooling this repo's pipelines use, idempotently.
#
#   Blender  as the `bpy` wheel from PyPI (the full engine, headless), plus a
#            `blender` CLI shim for `blender -b -P script.py` style usage.
#            download.blender.org is denied by the remote environment's
#            network policy; PyPI is not.
#   Godot    4.5 stable, headless-capable, from the GitHub release archive.
#   Python   numpy, scipy, soundfile, pillow — for tools/sfx and tools/blender.
#
# Safe to run on every session start: each step is skipped when already done.
set -e
BPY_VERSION=4.5.13
GODOT_VERSION=4.5-stable

if ! python3 -c "import bpy" 2>/dev/null; then
  echo "== installing bpy $BPY_VERSION (Blender as a Python module, ~370 MB)"
  pip install -q "bpy==$BPY_VERSION"
fi
python3 -c "import numpy,scipy,soundfile,PIL" 2>/dev/null || pip install -q numpy scipy soundfile pillow

if [ ! -x /usr/local/bin/blender ]; then
  echo "== installing blender CLI shim"
  cp "$(dirname "$0")/blender-shim.py" /usr/local/bin/blender
  chmod +x /usr/local/bin/blender
fi

if ! command -v godot >/dev/null 2>&1; then
  echo "== installing Godot $GODOT_VERSION"
  mkdir -p /opt/godot
  curl -sSfL -o /tmp/godot.zip \
    "https://github.com/godotengine/godot/releases/download/$GODOT_VERSION/Godot_v${GODOT_VERSION}_linux.x86_64.zip"
  (cd /opt/godot && unzip -qo /tmp/godot.zip && chmod +x "Godot_v${GODOT_VERSION}_linux.x86_64")
  ln -sf "/opt/godot/Godot_v${GODOT_VERSION}_linux.x86_64" /usr/local/bin/godot
  rm -f /tmp/godot.zip
fi

echo "blender: $(blender --version 2>/dev/null | head -1)"
echo "godot:   $(godot --headless --version 2>/dev/null | tail -1)"
