#!/usr/bin/env python3
"""Measure a capture against the reference screenshots.

    python3 tools/godot/measure.py CAPTURE.png

Three rounds of visual critique found the same pattern each time: the
diagnosis was right and the correction was two to three times too large. The
cure for that is not more care, it is a number to aim at. This prints the
handful of statistics the critiques actually used, for the capture and for
each reference, plus a pass/fail against the acceptance band agreed for the
lighting pass.

HUD bands are cropped before measuring, since they are flat overlay pixels and
would otherwise drag the exposure statistics around.
"""
import sys, os, json
import numpy as np
from PIL import Image

## Two reference sets, because the game now has two lighting regimes and one
## band cannot serve both. The daylight set is the CS screenshots the opening
## sector is scored against; the bridge set is the night/rain mockups for
## CROSSFALL SPAN, which measure a mean of 0.151 to 0.182 against the day
## set's 0.37 to 0.41, and a 5th percentile of 0.003 against their 0.12. A
## night scene judged against a daylight band would be told to triple its
## exposure, which is exactly the wrong note.
REF_SETS = {
    "day": (".", ["target.jpg", "target-b.jpg", "target-c.jpg"]),
    "bridge": ("bridge", ["target1.png", "target2.png", "target3.png"]),
}
DL = os.path.join(os.path.dirname(__file__), "..", "..", ".dream-loop")

def load(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float64) / 255.0
    # Drop the top and bottom tenth: HUD on ours, HUD on theirs.
    h = a.shape[0]
    return a[int(h * 0.10):int(h * 0.90)]

def luma(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def saturation(a):
    mx = a.max(-1); mn = a.min(-1)
    return np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)

def stats(a, name):
    y = luma(a)
    return {
        "name": name,
        "mean": float(y.mean()),
        "p95": float(np.percentile(y, 95)),
        "p99": float(np.percentile(y, 99)),
        "std": float(y.std()),
        "clipped%": float((y > 0.98).mean() * 100),
        "crushed%": float((y < 0.06).mean() * 100),
        "sat": float(saturation(a).mean()),
        "R:B": float(a[..., 0].mean() / max(1e-6, a[..., 2].mean())),
    }

def box_blur(y, k):
    """Separable box blur by summed-area table, so radius costs nothing."""
    pad = np.pad(y, k, mode="edge")
    c = pad.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    w = 2 * k + 1
    h, wd = y.shape
    out = (c[w:w + h, w:w + wd] - c[0:h, w:w + wd]
           - c[w:w + h, 0:wd] + c[0:h, 0:wd])
    return out / (w * w)

def macro_micro(a):
    """Split luminance variation into large and small spatial scales.

    Every round of critique said the same thing about the surfaces: the fine
    grain is right and the large blotches are missing. The global standard
    deviation cannot see that difference, because a frame can reach the
    reference spread from tile noise alone. Blurring at roughly a tenth of the
    frame separates the two: what survives the blur is macro variation, what
    the blur removes is micro detail.
    """
    y = luma(a)
    k = max(2, int(min(y.shape) * 0.045))
    lo = box_blur(y, k)
    return float(lo.std()), float((y - lo).std())

def patch_variation(a):
    """Median contrast inside a small window, over the whole frame.

    This is the measure the surface critique used: a wall that reads as painted
    concrete varies within itself, while a wall that reads as a flat polygon
    does not. Whole-frame spread cannot tell those apart, because a frame can
    reach the reference spread purely from the step between one surface and the
    next. Taking the median over windows asks a different question: what does a
    typical patch of this image look like from close up?
    """
    y = luma(a)
    n = 48
    h, w = y.shape
    ys = np.arange(0, h - n, n)
    xs = np.arange(0, w - n, n)
    tiles = np.stack([y[i:i + n, j:j + n] for i in ys for j in xs])
    sd = tiles.reshape(len(tiles), -1).std(1)
    return float(np.median(sd))

def lit_shade_ratio(a):
    """Linear-light ratio between the brightest and darkest tenths.

    A proxy for the key-to-fill ratio that needs no hand-placed probes: take
    the mean linear luminance of the top and bottom deciles of the frame,
    ignoring the extremes so a single blown pixel or a black window cannot
    set it.
    """
    y = luma(a)
    lin = np.where(y <= 0.04045, y / 12.92, ((y + 0.055) / 1.055) ** 2.4)
    flat = np.sort(lin.ravel())
    n = flat.size
    lit = flat[int(n * 0.86):int(n * 0.98)].mean()
    shade = flat[int(n * 0.04):int(n * 0.16)].mean()
    return float(lit / max(1e-9, shade))

# The acceptance band is derived from the references themselves, never typed by
# hand. Three rounds of critique overcorrected by two to three times because the
# targets were directions ("more contrast") rather than numbers; a band copied
# from someone else's metric is the same mistake with extra steps. Each metric's
# band is the span the three references occupy, widened by a tolerance that is a
# fraction of that span, so a capture passes when it sits where the references
# sit and not where I guessed they sit.
TOLERANCE = 0.18   # fraction of the reference span added to each end
FLOOR = {          # minimum half-width where the references happen to agree
    "mean": 0.03, "p95": 0.03, "p99": 0.03, "std": 0.015,
    "ratio": 1.5, "clipped%": 0.05, "crushed%": 0.5, "sat": 0.03, "R:B": 0.08,
    "macro": 0.012, "micro": 0.008, "patch": 0.008,
}
BANDED = ["mean", "p95", "std", "macro", "micro", "patch", "ratio", "clipped%", "crushed%", "sat", "R:B"]

def band(refs, key):
    vals = [r[key] for r in refs]
    lo, hi = min(vals), max(vals)
    pad = max((hi - lo) * TOLERANCE, FLOOR.get(key, 0.0))
    # Nothing below zero is meaningful for any of these metrics.
    return (max(0.0, lo - pad), hi + pad)

def main(path, ref_set="day"):
    sub, refs = REF_SETS[ref_set]
    rows = []
    for r in refs:
        p = os.path.join(DL, sub, r)
        if os.path.exists(p):
            a = load(p)
            s = stats(a, r)
            s["ratio"] = lit_shade_ratio(a)
            s["macro"], s["micro"] = macro_micro(a)
            s["patch"] = patch_variation(a)
            rows.append(s)
    a = load(path)
    cur = stats(a, os.path.basename(path))
    cur["ratio"] = lit_shade_ratio(a)
    cur["macro"], cur["micro"] = macro_micro(a)
    cur["patch"] = patch_variation(a)
    rows.append(cur)

    keys = ["mean", "p95", "std", "macro", "micro", "patch", "ratio", "clipped%", "crushed%", "sat", "R:B"]
    print(f"{'':<16}" + "".join(f"{k:>10}" for k in keys))
    for s in rows:
        print(f"{s['name']:<16}" + "".join(f"{s[k]:>10.3f}" for k in keys))

    print()
    failed = []
    for k in BANDED:
        lo, hi = band(rows[:-1], k)
        v = cur[k]
        ok = lo <= v <= hi
        print(f"  {'PASS' if ok else 'FAIL'}  {k:<10} {v:7.3f}   want {lo:.3f}..{hi:.3f}")
        if not ok:
            failed.append(k)
    print()
    if failed:
        print("OUT OF BAND:", ", ".join(failed))
        return 1
    print("all lighting statistics inside the reference band")
    return 0

if __name__ == "__main__":
    # tools/godot/measure.py SHOT.png [day|bridge]
    args = sys.argv[1:]
    sys.exit(main(args[0] if args else ".dream-loop/current.png",
                  args[1] if len(args) > 1 else "day"))
