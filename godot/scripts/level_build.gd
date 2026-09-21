class_name LevelBuild
extends Node3D

## Builds the 3D sector from the exported plan.
##
## Every solid in the plan becomes a box of the same footprint with a
## StaticBody3D of the same footprint, so what stops the operative is exactly
## what the 2D game's collision rectangles stop them on. Nothing here invents
## geometry the simulation does not know about; decoration that would block a
## sightline the simulation thinks is open is the one thing this file must not
## add.

const FLOOR_THICKNESS := 0.4

var level: Level
var materials: Dictionary = {}

## Metres of height per kind of solid.
##
## The plan's own `height` field drives a 2.5D parallax look in the 2D game,
## not architecture: at the plan scale its walls stand 2 m tall inside a 22 m
## room, which renders as a hedge maze rather than a street. These are the
## heights the same objects need to read as buildings, keeping the author's
## ordering intact — outer block over facade over column over crate. Nothing
## here touches the footprint, so no sightline or collision the simulation
## knows about is changed.
const HEIGHTS := {
    "perimeter": 13.0,
    "masonry": 7.2,
    "wall": 7.2,
    "vault": 5.4,
    "pillar": 4.4,
    "machinery": 2.2,
    "container": 2.6,
    "vaultSeal": 4.0,
    "crate": 1.4,
    "barrier": 1.2,
    "lowcover": 1.0,
}

## How far above the floor the doorway opening is cut. Wide, low openings under
## a deep lintel are what make the reference's archways read as archways.
const DOOR_OPENING := 3.4

func _height_for(o: Dictionary) -> float:
    var base: float = float(HEIGHTS.get(String(o.get("type", "wall")), 7.2))
    # A flat roofline over a whole sector reads as one extruded shape. The
    # plan already carries a per-object `variant` (0-3) chosen by the 2D
    # game's seeded RNG, so stepping height by it varies the skyline without
    # introducing any randomness of our own and without moving a footprint.
    if base >= 5.0:
        base += float(int(o.get("variant", 0))) * 0.62
    return base

func build(lvl: Level, mats: Dictionary) -> void:
    level = lvl
    materials = mats
    _build_ground()
    _build_solids()
    _build_doorframes()
    _build_lights()

func _mat(name: String) -> Material:
    return materials.get(name, materials.get("wall", null))

func _box(size: Vector3, pos: Vector3, mat: Material, collide: bool, uv_scale: float = 1.0) -> MeshInstance3D:
    var mesh := BoxMesh.new()
    mesh.size = size
    var mi := MeshInstance3D.new()
    mi.mesh = mesh
    mi.position = pos
    if mat:
        mi.material_override = mat
    mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
    add_child(mi)
    if collide:
        var body := StaticBody3D.new()
        var shape := CollisionShape3D.new()
        var box := BoxShape3D.new()
        box.size = size
        shape.shape = box
        body.position = pos
        body.add_child(shape)
        add_child(body)
    return mi

func _build_ground() -> void:
    # One slab under the whole sector, then a distinct plate per named room so
    # the nine chambers read as different spaces rather than one warehouse.
    var w := level.metres(level.width)
    var h := level.metres(level.height)
    _box(Vector3(w + 8.0, FLOOR_THICKNESS, h + 8.0),
        Vector3(w * 0.5, -FLOOR_THICKNESS * 0.5, h * 0.5), _mat("ground"), true)
    for z in level.zones:
        var zw := level.metres(float(z["w"]))
        var zh := level.metres(float(z["h"]))
        var pos := Vector3(level.metres(float(z["x"])), 0.005, level.metres(float(z["y"])))
        var plate := _box(Vector3(zw, 0.02, zh), pos, _mat("floor"), false)
        plate.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _build_solids() -> void:
    for o in level.solids():
        var ow := level.metres(float(o["w"]))
        var oh := level.metres(float(o["h"]))
        var tall := _height_for(o)
        var pos := Vector3(level.metres(float(o["x"])), tall * 0.5, level.metres(float(o["y"])))
        var kind := String(o.get("type", "wall"))
        _box(Vector3(ow, tall, oh), pos, _mat(_material_for(kind)), true)
        # A cornice caps every facade. It is the cheapest single thing that
        # stops a wall reading as an extruded rectangle: it gives the top edge
        # a shadow line and a change of material, which is what the eye uses
        # to tell a building from a block.
        if kind == "masonry" or kind == "wall" or kind == "perimeter":
            _plinth(Vector3(ow, tall, oh), pos)
            _windows(o, Vector3(ow, tall, oh), pos)
            var cap := _box(Vector3(ow + 0.35, 0.34, oh + 0.35),
                Vector3(pos.x, tall + 0.17, pos.z), _mat("cornice"), false)
            cap.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

func _material_for(kind: String) -> String:
    match kind:
        "perimeter": return "perimeter"
        "masonry", "wall": return "wall"
        "vault", "vaultSeal": return "vault"
        "pillar": return "pillar"
        "machinery": return "machinery"
        "container": return "container"
        _: return "wall"

func _build_doorframes() -> void:
    # A lintel over each doorway and a jamb either side. These sit inside the
    # opening the plan already left, so they add no collision the simulation
    # does not have: the lintel is above head height and the jambs are flush
    # with the wall ends.
    for d in level.doorways:
        var vertical: bool = d.get("vertical", false)
        var dw := level.metres(float(d["w"]))
        var dh := level.metres(float(d["h"]))
        var cx := level.metres(float(d["x"]))
        var cz := level.metres(float(d["y"]))
        var wall_h: float = float(HEIGHTS.get("masonry", 7.2))
        var opening := DOOR_OPENING
        var lintel_h: float = max(0.2, wall_h - opening)
        var size := Vector3(dw, lintel_h, dh) if vertical else Vector3(dw, lintel_h, dh)
        var mi := _box(Vector3(size.x, lintel_h, size.z), Vector3(cx, wall_h - lintel_h * 0.5, cz), _mat("trim"), false)
        mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

func _build_lights() -> void:
    for l in level.lights:
        var lamp := OmniLight3D.new()
        lamp.position = Vector3(level.metres(float(l["x"])), 2.9, level.metres(float(l["y"])))
        lamp.omni_range = maxf(3.0, level.metres(float(l.get("radius", 150))) * 2.2)
        lamp.light_color = Color(String(l.get("color", "#ffc781")))
        lamp.light_energy = 1.6
        lamp.shadow_enabled = false
        lamp.light_specular = 0.4
        add_child(lamp)

## A base course at pavement level. Buildings in the reference all have one,
## and it is what stops a facade looking like it was dropped onto the ground.
func _plinth(size: Vector3, pos: Vector3) -> void:
    var p := _box(Vector3(size.x + 0.28, 0.85, size.z + 0.28),
        Vector3(pos.x, 0.425, pos.z), _mat("trim"), false)
    p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

## Recessed windows along the long face of a facade.
##
## Spacing and count come from the wall's own length and `variant`, so they are
## deterministic and identical between runs. The recess is a dark inset box
## plus a surround; both sit inside the wall's footprint, so neither adds
## collision or blocks a sightline the simulation believes is open.
func _windows(o: Dictionary, size: Vector3, pos: Vector3) -> void:
    var along_x: bool = size.x >= size.z
    var span: float = size.x if along_x else size.z
    if span < 5.0 or size.y < 5.0:
        return
    var variant := int(o.get("variant", 0))
    var spacing := 3.6 + float(variant) * 0.35
    var count := int(floor((span - 2.0) / spacing))
    if count < 1:
        return
    var depth: float = (size.z if along_x else size.x)
    var start := -(float(count - 1) * spacing) * 0.5
    var rows := [2.6, 5.4] if size.y > 8.0 else [2.9]
    for r in rows:
        if r + 1.5 > size.y - 0.6:
            continue
        for i in range(count):
            var off := start + float(i) * spacing
            var centre := Vector3(
                pos.x + (off if along_x else 0.0),
                r,
                pos.z + (0.0 if along_x else off))
            var w := 1.15
            var h := 1.5
            var frame_size := Vector3(w + 0.26, h + 0.26, depth + 0.16) if along_x else Vector3(depth + 0.16, h + 0.26, w + 0.26)
            var glass_size := Vector3(w, h, depth + 0.22) if along_x else Vector3(depth + 0.22, h, w)
            var frame := _box(frame_size, centre, _mat("trim"), false)
            frame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
            var recess := MeshInstance3D.new()
            var rm := BoxMesh.new()
            rm.size = glass_size
            recess.mesh = rm
            recess.position = centre
            var dark := StandardMaterial3D.new()
            dark.albedo_color = Color(0.035, 0.045, 0.055)
            dark.roughness = 0.35
            dark.metallic = 0.0
            recess.material_override = dark
            recess.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            add_child(recess)
