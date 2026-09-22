class_name Hud
extends Control

## Contract HUD.
##
## Only what the 2D game puts on screen during a run: integrity, the contract
## clock, the objective line, level and kills, and a crosshair. Drawn rather
## than built from a scene so it stays in one readable file.

var sim: Sim
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

func _process(_delta: float) -> void:
    queue_redraw()

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
