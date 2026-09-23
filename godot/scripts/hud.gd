class_name Hud
extends Control

## Contract HUD.
##
## Only what the 2D game puts on screen during a run: integrity, the contract
## clock, the objective line, level and kills, and a crosshair. Drawn rather
## than built from a scene so it stays in one readable file.

var sim: Sim
## The sector, for the minimap. Set alongside `sim`.
var level: Level
## Which way the operative is facing, in plan space, set by the game each
## frame: the HUD has no camera of its own.
var facing := Vector2.RIGHT

## Recent hits, as {dir: Vector2, life: float} in plan space.
##
## The 2D game draws threat indicators and a minimap as standard and has them
## both on by default. A first-person build asks the player to fight the same
## numbers seeing about seventy degrees of the sector instead of all of it,
## and on a bridge -- a corridor with hostiles at both ends and an objective
## that pins you in place for two seconds at a time -- that is most of what
## makes the second contract harder than its difficulty number says.
var _threats: Array = []
const THREAT_LIFE := 2.2
## Set by the game once the level and the contract are known. Defaults keep a
## HUD drawn before either exists from showing an empty header.
var theatre := "UNKNOWN THEATRE"
var operation := ""

const ACCENT := Color(0.463, 0.906, 0.831)
const WARN := Color(1.0, 0.44, 0.36)
const INK := Color(0.86, 0.92, 0.93)

func _ready() -> void:
    set_anchors_preset(Control.PRESET_FULL_RECT)
    mouse_filter = Control.MOUSE_FILTER_IGNORE

func _process(delta: float) -> void:
    for i in range(_threats.size() - 1, -1, -1):
        _threats[i]["life"] -= delta
        if _threats[i]["life"] <= 0.0:
            _threats.remove_at(i)
    queue_redraw()

## Note a hit for the threat indicator. Connected to the simulation.
func on_player_hurt(_amount: float, from: Vector2) -> void:
    if from == Vector2.INF or sim == null:
        return
    var d: Vector2 = from - sim.player_pos
    if d.length() < 0.001:
        return
    _threats.append({"dir": d.normalized(), "life": THREAT_LIFE})

func _draw() -> void:
    if sim == null:
        return
    var size := get_viewport_rect().size
    var font := ThemeDB.fallback_font
    var pad := 34.0

    # Crosshair. The operative's weapons acquire their own targets, so this is
    # a centre reference rather than an aiming reticle -- it stays a fixed
    # cross and never converges.
    var c := size * 0.5
    var arm := 9.0
    var gap := 4.0
    for d in [Vector2(1, 0), Vector2(-1, 0), Vector2(0, 1), Vector2(0, -1)]:
        draw_line(c + d * gap, c + d * (gap + arm), Color(ACCENT, 0.75), 1.6)
    draw_rect(Rect2(c - Vector2(1, 1), Vector2(2, 2)), Color(ACCENT, 0.5))

    # Integrity bar, bottom left.
    var bw := 320.0
    var bh := 14.0
    var bx := pad
    var by := size.y - pad - bh
    var ratio: float = clampf(sim.player_hp / maxf(1.0, sim.player_max_hp), 0.0, 1.0)
    draw_rect(Rect2(bx - 2, by - 2, bw + 4, bh + 4), Color(0, 0, 0, 0.55))
    draw_rect(Rect2(bx, by, bw, bh), Color(0.08, 0.12, 0.13, 0.9))
    draw_rect(Rect2(bx, by, bw * ratio, bh), WARN if ratio < 0.3 else ACCENT)
    draw_string(font, Vector2(bx, by - 10), "INTEGRITY", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(INK, 0.75))
    draw_string(font, Vector2(bx + bw + 12, by + bh - 1),
        "%d / %d" % [int(sim.player_hp), int(sim.player_max_hp)],
        HORIZONTAL_ALIGNMENT_LEFT, -1, 15, INK)

    # Contract clock, top centre.
    var remaining := sim.time_remaining()
    var clock := "%d:%02d" % [int(remaining) / 60, int(remaining) % 60]
    draw_string(font, Vector2(c.x - 42, pad + 22), clock, HORIZONTAL_ALIGNMENT_LEFT, -1, 30,
        WARN if sim.extraction_active else INK)

    # Objective line under the clock.
    #
    # An operation with its own objective keeps the beacon shut until that is
    # met, so once the window closes the line has to say what is still owed
    # rather than sending the operative to a beacon that will not take them.
    var blocked := sim.blocked_reason()
    var objective := "SURVIVE THE CONTRACT WINDOW"
    if sim.extraction_active:
        objective = "REACH EXTRACTION" if blocked == "" else "EXTRACTION LOCKED // " + blocked
    draw_string(font, Vector2(c.x - 150, pad + 46), objective, HORIZONTAL_ALIGNMENT_CENTER, 300, 14,
        Color(WARN if sim.extraction_active else INK, 0.85))

    # The objective's own counter, when the contract has one.
    var line := sim.objective_line()
    if not line.is_empty():
        var done: bool = line["done"]
        draw_string(font, Vector2(c.x - 150, pad + 78),
            "%s  %s" % [String(line["label"]), String(line["value"])],
            HORIZONTAL_ALIGNMENT_CENTER, 300, 15, ACCENT if done else Color(INK, 0.9))
    if sim.extraction_active and sim.extraction_hold > 0.0:
        var hold: float = clampf(sim.extraction_hold / Sim.EXTRACTION_HOLD, 0.0, 1.0)
        draw_rect(Rect2(c.x - 90, pad + 58, 180.0 * hold, 5), ACCENT)

    # Level, XP and kills, bottom right.
    var rx := size.x - pad - 240.0
    draw_string(font, Vector2(rx, by - 10), "LEVEL %d" % sim.player_level,
        HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(INK, 0.75))
    draw_rect(Rect2(rx, by, 240, bh), Color(0.08, 0.12, 0.13, 0.9))
    var xp: float = clampf(sim.player_xp / maxf(1.0, sim.player_xp_next), 0.0, 1.0)
    draw_rect(Rect2(rx, by, 240.0 * xp, bh), Color(0.49, 0.61, 1.0))
    draw_string(font, Vector2(rx, by + bh + 18), "%d CONFIRMED" % sim.kills,
        HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(INK, 0.8))

    # Hostile count, top left, with the theatre name.
    #
    # The name comes from the map registry rather than being typed here. It
    # was the literal "BLACKSITE ZERO", which is correct for exactly one of
    # the ten maps the game ships and was still being drawn over the bridge.
    draw_string(font, Vector2(pad, pad + 16), theatre, HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color(INK, 0.9))
    draw_string(font, Vector2(pad, pad + 38), operation, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(INK, 0.55))
    draw_string(font, Vector2(pad, pad + 62), "HOSTILES %d" % sim.enemies.size(),
        HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(WARN, 0.85))

    _draw_minimap(size, pad, font)
    _draw_threats(c)

## The sector from above, top-left, as the mockups place it.
##
## Aspect-correct rather than square: CROSSFALL is 3675 by 1092, and squashing
## that into a square makes a bridge look like a room.
func _draw_minimap(size: Vector2, pad: float, font: Font) -> void:
    if level == null or level.width <= 0.0 or level.height <= 0.0:
        return
    var wide: float = minf(230.0, size.x * 0.17)
    var scale: float = wide / level.width
    var tall: float = level.height * scale
    # A very flat sector would otherwise be a few pixels high to read.
    if tall < 62.0:
        tall = 62.0
        scale = minf(wide / level.width, tall / level.height)
        wide = level.width * scale
    var org := Vector2(pad, pad + 86.0)
    var box := Rect2(org, Vector2(wide, tall))
    draw_rect(box, Color(0.012, 0.039, 0.055, 0.82))
    draw_rect(box, Color(ACCENT, 0.30), false, 1.0)

    var to_map := func(p: Vector2) -> Vector2:
        return org + Vector2(p.x * scale, p.y * scale)

    # Geometry, so the deck and its parapets read as a shape.
    for wall in level.walls:
        if String(wall.get("type", "")) == "perimeter":
            continue
        var w: float = float(wall["w"]) * scale
        var h: float = float(wall["h"]) * scale
        draw_rect(Rect2(to_map.call(Vector2(float(wall["x"]) - float(wall["w"]) * 0.5,
            float(wall["y"]) - float(wall["h"]) * 0.5)),
            Vector2(maxf(1.0, w), maxf(1.0, h))), Color(0.47, 0.67, 0.69, 0.40))
    for cv in level.cover:
        draw_rect(Rect2(to_map.call(Vector2(float(cv["x"]) - float(cv["w"]) * 0.5,
            float(cv["y"]) - float(cv["h"]) * 0.5)),
            Vector2(maxf(1.0, float(cv["w"]) * scale), maxf(1.0, float(cv["h"]) * scale))),
            Color(0.47, 0.67, 0.69, 0.26))

    # Objective first, so a hostile standing on it still shows.
    for cache in sim.caches:
        var lit: bool = cache["recovered"]
        draw_circle(to_map.call(cache["pos"]), 3.0,
            Color(0.45, 1.0, 0.62, 0.9) if lit else Color(0.56, 0.85, 1.0, 0.95))
    if sim.extraction_active:
        draw_circle(to_map.call(level.extraction_point), 4.0, Color(ACCENT, 0.95))

    for e in sim.enemies:
        draw_circle(to_map.call(Vector2(e["pos"])), 2.0, Color(WARN, 0.9))

    # The operative, with the slice of sector actually on screen.
    var me: Vector2 = to_map.call(sim.player_pos)
    var half := deg_to_rad(35.0)
    var look := facing.normalized() if facing.length() > 0.001 else Vector2.RIGHT
    var cone := PackedVector2Array([me,
        me + look.rotated(-half) * 15.0, me + look.rotated(half) * 15.0])
    draw_colored_polygon(cone, Color(ACCENT, 0.22))
    draw_circle(me, 2.6, Color(0.92, 0.96, 0.98, 1.0))

## Where the last few hits came from, as arcs around the crosshair.
func _draw_threats(centre: Vector2) -> void:
    if _threats.is_empty():
        return
    var look := facing.normalized() if facing.length() > 0.001 else Vector2.RIGHT
    for t in _threats:
        var d: Vector2 = t["dir"]
        # Signed angle from where the operative is looking to where it came
        # from, so an arc at the top of the screen means straight ahead.
        var ang: float = Bearing.threat(look, d)
        var fade: float = clampf(float(t["life"]) / THREAT_LIFE, 0.0, 1.0)
        var radius := 86.0
        draw_arc(centre, radius, ang - 0.34, ang + 0.34,
            16, Color(WARN, fade * 0.85), 4.0)

