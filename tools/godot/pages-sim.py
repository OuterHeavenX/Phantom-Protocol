#!/usr/bin/env python3
"""Serve build/pages the way Cloudflare Pages would, honouring _headers.

    python3 tools/godot/pages-sim.py build/pages [PORT]

The web export ships a wasm that is stored gzipped under its uncompressed
name, because Pages refuses any asset over 25 MiB and Godot 4.5's release wasm
is 36.3 MiB with no smaller template available. That only works if the response
carries Content-Encoding, so this serves the bundle with its own _headers
applied and the arrangement can be proven in a real browser before anything is
deployed.

Only as much of the _headers syntax as this bundle uses: a path at column zero,
then indented "Name: value" lines.
"""
import functools
import http.server
import os
import sys


def load_rules(root):
    rules, path = {}, None
    header_file = os.path.join(root, "_headers")
    if not os.path.exists(header_file):
        return rules
    for line in open(header_file):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            path = line.strip()
            rules[path] = {}
        elif path and ":" in line:
            key, value = line.split(":", 1)
            rules[path][key.strip()] = value.strip()
    return rules


def main(root, port):
    rules = load_rules(root)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def _rule(self):
            return rules.get(self.path.split("?")[0], {})

        def end_headers(self):
            for key, value in self._rule().items():
                self.send_header(key, value)
            super().end_headers()

        def guess_type(self, path):
            # _headers wins on content type: the stdlib map calls .wasm text,
            # and instantiateStreaming refuses anything but application/wasm.
            return self._rule().get("Content-Type", super().guess_type(path))

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Handler, directory=root))
    print("serving %s on http://127.0.0.1:%d" % (root, port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "build/pages",
         int(sys.argv[2]) if len(sys.argv) > 2 else 8778)
