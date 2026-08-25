# Developer checks

`check.sh` is the one that must pass before a commit: eslint's `no-undef` plus
`construction-order.py`. Both exist because each caught a shipped bug that
stopped the game starting.

The three `.mjs` harnesses below are gameplay-integrity checks. Two need only
node; the parity one needs a browser and a served copy of the game.

| Tool | Needs | Answers |
|---|---|---|
| `clip.mjs [steps] [--legacy]` | node | Can anything move through a wall? Drives a body at dash speed into geometry across all ten theatres and counts tunnelling and deep penetration. `--legacy` runs the old integrate-then-depenetrate path to show the difference. |
| `doorway.mjs [seeds]` | node | Is the sector traversable and are spawns valid? Flood-fills standable ground from the operative's start at their own radius, then audits spawn candidates, the fallback spawn, the operative's start and hazard placement. |
| `parity.mjs [theatres] [ticks] [a:b]` | node + playwright + a server | Does the renderer change the game? Runs the same seed and the same scripted input under two renderers and compares simulation state, never pixels. The fourth argument picks the pair; `2d:2d` is the control that must pass first. |
| `diverge.mjs [renderer]` | node + playwright + a server | When parity fails, where? Runs the same build twice and reports the first tick, entity and field that disagree. |
| `align.mjs [gl\|2d] [--shake]` | node + playwright + a server | Does the renderer draw a hostile where its collider is? Recolours hostiles to palette-safe key colours, finds each one's centroid in the composited frame, and compares it in pixels with the world-to-screen position of its collider. Exits non-zero on a miss. |
| `ground-orientation.mjs` | node + playwright + a server | Is the authored-floor blit the right way up? Paints a patch in the ground canvas's top-left quadrant and diffs the composited frame against one without it. |

```sh
node tools/clip.mjs 6000 --legacy     # the old behaviour, for comparison
node tools/clip.mjs 6000              # the current one

node tools/doorway.mjs 12

python3 -m http.server 8931 --bind 127.0.0.1 &
node tools/parity.mjs blacksite,mire,proving 900 2d:2d   # control, must pass first
node tools/parity.mjs blacksite,mire,proving 900 2d:gl   # the real comparison
node tools/diverge.mjs 2d                                # when one of them fails

node tools/align.mjs gl && node tools/align.mjs gl --shake
node tools/align.mjs 2d
node tools/ground-orientation.mjs
```

**Run `align.mjs` on any renderer change.** Simulation parity cannot catch a
presentation bug by construction — the world can be bit-identical under both
renderers while one of them draws it upside down, and that is exactly what
shipped: the sprite layer was composited vertically mirrored, and the GL view
matrix omitted the camera shake `Camera.apply` applies. Both put every hostile
somewhere other than its collider, and both survived a full simulation-parity
sweep and a screenshot review.

The control matters. A renderer comparison that has not first been shown to
agree with itself cannot distinguish a renderer bug from a harness that is
comparing two runs which had already drifted apart before the first tick.

`parity.mjs` expects the game at `http://127.0.0.1:8931` and Playwright's
Chromium; edit the two constants at the top if either differs.
