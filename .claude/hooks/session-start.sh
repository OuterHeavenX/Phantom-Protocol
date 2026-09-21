#!/bin/bash
# Installs the content tooling (Blender as bpy + CLI shim, Godot, Python
# rendering deps) for Claude Code on the web. Idempotent; a no-op once the
# container has been cached with the tools present.
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
sh "$CLAUDE_PROJECT_DIR/tools/env/install-tools.sh"
