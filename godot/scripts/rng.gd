class_name Rng
extends RefCounted

## mulberry32, ported from src/core/rng.js.
##
## The same generator with the same seed must produce the same sector on both
## sides, or the 3D level stops being the level the 2D game balanced. Integer
## work is masked to 32 bits because GDScript ints are 64-bit and JavaScript's
## bitwise operators are not.

const M32: int = 0xFFFFFFFF

var seed_value: int = 0
var state: int = 0

func _init(s: int = 0) -> void:
    seed_value = s & M32
    state = seed_value if seed_value != 0 else 0x9e3779b9

func _imul(a: int, b: int) -> int:
    # Math.imul: 32-bit signed multiply, kept in 32 unsigned bits here.
    return ((a & M32) * (b & M32)) & M32

func next() -> float:
    state = (state + 0x6d2b79f5) & M32
    var t: int = state
    t = _imul(t ^ (t >> 15), t | 1)
    t = (t ^ (t + _imul(t ^ (t >> 7), t | 61))) & M32
    return float((t ^ (t >> 14)) & M32) / 4294967296.0

func range_f(lo: float, hi: float) -> float:
    return lo + next() * (hi - lo)

func range_i(lo: int, hi: int) -> int:
    return int(floor(range_f(float(lo), float(hi) + 1.0)))

func chance(p: float = 0.5) -> bool:
    return next() < p

func pick(list: Array):
    return list[int(floor(next() * list.size()))]

func angle() -> float:
    return next() * TAU
