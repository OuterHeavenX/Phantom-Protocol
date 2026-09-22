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

## Which map this export came from, and the three dictionaries the 2D game
## authored alongside its geometry. The port dressed the first sector from
## nothing but walls and cover because Blacksite is a daylit street and the
## defaults happened to suit it. CROSSFALL is not: it carries rain at full
## density, lightning, and a near-black blue palette, and none of that can be
## guessed from a rectangle list.
var map_id := "blacksite"
var weather = null
var palette = null
var layout = null

## True when the map's own weather says so. The 2D game has no day/night flag
## -- it has a palette and a weather block -- and a deck authored at #141d26
## under full rain is night by construction.
func is_night() -> bool:
    if weather == null:
        return false
    return String(weather.get("type", "")) in ["rain", "storm", "ash", "snow"]

func rain_density() -> float:
    if weather == null:
        return 0.0
    if String(weather.get("type", "")) != "rain":
        return 0.0
    return float(weather.get("density", 0.0))

func wind() -> float:
    return float(weather.get("wind", 0.0)) if weather != null else 0.0

func has_flashes() -> bool:
    return bool(weather.get("flashes", false)) if weather != null else false

## A colour out of the map's palette, parsed from the CSS the 2D game stores.
func pal(key: String, fallback: Color) -> Color:
    if palette == null or not palette.has(key):
        return fallback
    var v := String(palette[key])
    if v.begins_with("#"):
        return Color(v)
    if v.begins_with("rgba(") or v.begins_with("rgb("):
        var inner := v.substr(v.find("(") + 1, v.rfind(")") - v.find("(") - 1)
        var parts := inner.split(",")
        if parts.size() >= 3:
            return Color(float(parts[0]) / 255.0, float(parts[1]) / 255.0,
                float(parts[2]) / 255.0,
                float(parts[3]) if parts.size() > 3 else 1.0)
    return fallback

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
    map_id = String(d.get("map", "blacksite"))
    weather = d.get("weather", null)
    palette = d.get("palette", null)
    layout = d.get("layout", null)
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

## Is anything sight-blocking between two plan-space points?
##
## Ported from World.hasLineOfSight. Targeting needs this: without it the
## operative's weapons lock whatever hostile is nearest in a straight line and
## fire into the wall between them. In a nine-room facility that was 97 of
## every 140 rounds.
##
## Slab method against each rectangle. Cover that does not block sight (low
## cover) is ignored, exactly as the 2D game ignores it.
func has_line_of_sight(from: Vector2, to: Vector2) -> bool:
    var d := to - from
    for o in solids():
        if not bool(o.get("blocksSight", true)):
            continue
        var hw := float(o["w"]) * 0.5
        var hh := float(o["h"]) * 0.5
        var minx := float(o["x"]) - hw
        var maxx := float(o["x"]) + hw
        var miny := float(o["y"]) - hh
        var maxy := float(o["y"]) + hh
        var t0 := 0.0
        var t1 := 1.0
        var blocked := true
        for axis in range(2):
            var origin: float = from.x if axis == 0 else from.y
            var delta: float = d.x if axis == 0 else d.y
            var lo: float = minx if axis == 0 else miny
            var hi: float = maxx if axis == 0 else maxy
            if absf(delta) < 0.00001:
                if origin < lo or origin > hi:
                    blocked = false
                    break
                continue
            var ta := (lo - origin) / delta
            var tb := (hi - origin) / delta
            if ta > tb:
                var swap := ta
                ta = tb
                tb = swap
            t0 = maxf(t0, ta)
            t1 = minf(t1, tb)
            if t0 > t1:
                blocked = false
                break
        if blocked:
            return false
    return true
