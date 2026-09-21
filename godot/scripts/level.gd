class_name Level
extends RefCounted

## The first level, loaded from the 2D game's own export.
##
## op1 (COLD OPEN, Blacksite Zero) is hand-authored in
## src/game/opening-levels.js as nine named rooms on a 3x3 grid. Rather than
## re-deriving that in GDScript — where it would drift the first time either
## side was edited — tools/godot/dump-sector.mjs runs the real World class and
## writes res://data/level_blacksite.json. The 3D level is therefore the same
## level by construction: same walls, same cover, same doorways, same lamps,
## same spawn, same extraction point.
##
## Two scales, deliberately. Plan measurements convert at 32 units per metre,
## which puts the operative's 13-unit radius at 0.41 m and a 180-unit doorway
## at 5.6 m. Heights convert at 16 units per metre instead, because the 2D
## game's `height` field drives a 2.5D parallax look rather than real
## architecture: at the plan scale its 64-unit walls would stand 2 m tall
## inside a 22 m room. Doubling height alone keeps every relative ordering the
## author chose — perimeter over wall over column over crate — while giving
## rooms a ceiling a person could stand in.

const PLAN_SCALE := 1.0 / 32.0
const HEIGHT_SCALE := 1.0 / 16.0
const EYE_HEIGHT := 1.7

var width: float = 0.0
var height: float = 0.0
var walls: Array = []
var cover: Array = []
var zones: Array = []
var doorways: Array = []
var lights: Array = []
var hazards: Array = []
var rooms: Array = []
var spawn_point: Vector2 = Vector2.ZERO
var extraction_point: Vector2 = Vector2.ZERO

func load_from(path: String) -> bool:
    var text := FileAccess.get_file_as_string(path)
    if text.is_empty():
        push_error("Level export missing: " + path)
        return false
    var d = JSON.parse_string(text)
    if typeof(d) != TYPE_DICTIONARY:
        push_error("Level export unparseable: " + path)
        return false
    width = float(d.get("width", 2100))
    height = float(d.get("height", 2100))
    walls = d.get("walls", [])
    cover = d.get("cover", [])
    zones = d.get("floorZones", [])
    doorways = d.get("doorways", [])
    lights = d.get("lights", [])
    hazards = d.get("hazards", [])
    rooms = d.get("rooms", [])
    var sp = d.get("spawn", null)
    spawn_point = Vector2(float(sp["x"]), float(sp["y"])) if sp else Vector2(width * 0.5, height * 0.5)
    var ep = d.get("extraction", null)
    extraction_point = Vector2(float(ep["x"]), float(ep["y"])) if ep else Vector2(width * 0.75, height * 0.5)
    return walls.size() > 0

## Everything the simulation collides against.
func solids() -> Array:
    var out: Array = []
    out.append_array(walls)
    out.append_array(cover)
    return out

func overlaps_solid(x: float, y: float, radius: float) -> bool:
    for o in solids():
        if absf(x - float(o["x"])) < float(o["w"]) * 0.5 + radius \
                and absf(y - float(o["y"])) < float(o["h"]) * 0.5 + radius:
            return true
    return false

func playable(x: float, y: float, pad: float = 0.0) -> bool:
    return x > pad and y > pad and x < width - pad and y < height - pad

func open_point_near(x: float, y: float, radius: float = 26.0, pad: float = 70.0) -> Vector2:
    if not overlaps_solid(x, y, radius) and playable(x, y, pad):
        return Vector2(x, y)
    for ring in range(1, 15):
        var distance := ring * 90.0
        var steps := 8 + ring * 2
        for i in range(steps):
            var a := TAU * float(i) / float(steps)
            var px := x + cos(a) * distance
            var py := y + sin(a) * distance
            if not overlaps_solid(px, py, radius) and playable(px, py, pad):
                return Vector2(px, py)
    return Vector2(width * 0.5, height * 0.5)

## A spawn away from the operative, matching World.findSpawn's intent.
func find_spawn(rng: Rng, away_from: Vector2, min_d: float = 520.0, max_d: float = 1100.0, radius: float = 26.0) -> Vector2:
    for attempt in range(32):
        var ease := float(attempt) / 32.0
        var clearance: float = max(20.0, radius * (1.0 - ease * 0.55))
        var a := rng.angle()
        var d := rng.range_f(min_d, max_d)
        var x := clampf(away_from.x + cos(a) * d, 80.0, width - 80.0)
        var y := clampf(away_from.y + sin(a) * d, 80.0, height - 80.0)
        if not overlaps_solid(x, y, clearance) and playable(x, y, 70.0):
            return Vector2(x, y)
    return open_point_near(width * 0.5, height * 0.5, radius, 70.0)

# ---- Unit conversion ------------------------------------------------------

## Plan position (2D game units) to a 3D point on the floor.
func to_world(p: Vector2, y_metres: float = 0.0) -> Vector3:
    return Vector3(p.x * PLAN_SCALE, y_metres, p.y * PLAN_SCALE)

func to_plan(p: Vector3) -> Vector2:
    return Vector2(p.x / PLAN_SCALE, p.z / PLAN_SCALE)

func metres(units: float) -> float:
    return units * PLAN_SCALE

func height_metres(units: float) -> float:
    return units * HEIGHT_SCALE
