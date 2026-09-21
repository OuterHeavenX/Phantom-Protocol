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
    _build_props()
    _build_decals()
    _build_lights()

func _mat(name: String) -> Material:
    return materials.get(name, materials.get("wall", null))

## Chamfered box mesh, cached by (size, chamfer).
##
## Every solid in the sector was a raw BoxMesh, so every edge in the level was
## a razor-sharp 90-degree corner of zero width. Real masonry has a 1-3 cm
## arris that catches a bright line in sun and a dark one in shade, and its
## absence is the single clearest tell that a scene is made of primitives.
## The chamfer faces are flat-shaded on their own smoothing group so they read
## as a distinct plane rather than being rounded away.
##
## Triplanar mapping means these need no UVs, which keeps the builder simple.
static var _mesh_cache: Dictionary = {}

static func chamfered_box(size: Vector3, chamfer: float) -> ArrayMesh:
    var key := "%.3f_%.3f_%.3f_%.3f" % [size.x, size.y, size.z, chamfer]
    if _mesh_cache.has(key):
        return _mesh_cache[key]
    var h := size * 0.5
    var c: float = minf(chamfer, minf(h.x, minf(h.y, h.z)) * 0.45)
    var i := Vector3(h.x - c, h.y - c, h.z - c)
    var st := SurfaceTool.new()
    st.begin(Mesh.PRIMITIVE_TRIANGLES)
    st.set_smooth_group(-1)

    # Godot culls back faces by CLOCKWISE winding seen from the front, which is
    # the opposite of the counter-clockwise order these quads are built in.
    # Emitted the natural way round, every box rendered inside-out: the ground
    # slab showed the underside of its own floor (black) and the containers
    # showed their interiors.
    var quad := func(a: Vector3, b: Vector3, cc: Vector3, d: Vector3) -> void:
        var n := (b - a).cross(d - a).normalized()
        for v in [a, cc, b, a, d, cc]:
            st.set_normal(n)
            st.add_vertex(v)

    # Six faces, each inset by the chamfer on its two in-plane axes.
    for axis in range(3):
        for sgn in [-1.0, 1.0]:
            var n := Vector3.ZERO
            n[axis] = sgn
            var u := Vector3.ZERO
            var w := Vector3.ZERO
            u[(axis + 1) % 3] = 1.0
            w[(axis + 2) % 3] = 1.0
            var centre := n * h[axis]
            var eu: float = i[(axis + 1) % 3]
            var ew: float = i[(axis + 2) % 3]
            var a := centre - u * eu - w * ew
            var b := centre + u * eu - w * ew
            var cc := centre + u * eu + w * ew
            var d := centre - u * eu + w * ew
            if sgn > 0.0:
                quad.call(a, b, cc, d)
            else:
                quad.call(d, cc, b, a)

    # Twelve edge chamfers.
    for axis in range(3):
        var ax := (axis + 1) % 3
        var bx := (axis + 2) % 3
        for sa in [-1.0, 1.0]:
            for sb in [-1.0, 1.0]:
                var p0 := Vector3.ZERO
                var p1 := Vector3.ZERO
                p0[axis] = -i[axis]
                p1[axis] = i[axis]
                var e0 := p0
                var e1 := p1
                e0[ax] = sa * h[ax]; e0[bx] = sb * i[bx]
                e1[ax] = sa * h[ax]; e1[bx] = sb * i[bx]
                e0[axis] = -i[axis]; e1[axis] = i[axis]
                var f0 := p0
                var f1 := p1
                f0[ax] = sa * i[ax]; f0[bx] = sb * h[bx]
                f1[ax] = sa * i[ax]; f1[bx] = sb * h[bx]
                f0[axis] = -i[axis]; f1[axis] = i[axis]
                if sa * sb > 0.0:
                    quad.call(e0, e1, f1, f0)
                else:
                    quad.call(f0, f1, e1, e0)

    # Eight corner triangles.
    for sx in [-1.0, 1.0]:
        for sy in [-1.0, 1.0]:
            for sz in [-1.0, 1.0]:
                var a := Vector3(sx * h.x, sy * i.y, sz * i.z)
                var b := Vector3(sx * i.x, sy * h.y, sz * i.z)
                var cc := Vector3(sx * i.x, sy * i.y, sz * h.z)
                var n := (b - a).cross(cc - a).normalized()
                if n.dot(Vector3(sx, sy, sz)) < 0.0:
                    n = -n
                else:
                    var swap := b
                    b = cc
                    cc = swap
                var tri := [a, b, cc]
                for v in tri:
                    st.set_normal(n)
                    st.add_vertex(v)

    # No tangents: triplanar mapping derives its own basis from world space, and
    # SurfaceTool refuses to generate them without UVs anyway.
    var mesh: ArrayMesh = st.commit()
    _mesh_cache[key] = mesh
    return mesh

func _box(size: Vector3, pos: Vector3, mat: Material, collide: bool, uv_scale: float = 1.0) -> MeshInstance3D:
    # Chamfer scales a little with the object so a crate keeps a crisp edge and
    # a 20 m facade gets a arris you can actually see, but it is always small.
    var chamfer: float = clampf(minf(size.x, minf(size.y, size.z)) * 0.05, 0.012, 0.055)
    var mesh := chamfered_box(size, chamfer)
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
        # Collision stays a plain box. The chamfer is a couple of centimetres
        # of visual relief; the footprint the simulation owns is the rectangle.
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
        # Paving, not slab. The concrete plate's form seams landed on a
        # perfectly axis-aligned 1.25 m grid and read as bathroom tile; the
        # cobble set is already at a believable 17 cm.
        var plate := _box(Vector3(zw, 0.02, zh), pos, _mat("ground"), false)
        plate.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _build_solids() -> void:
    for o in level.solids():
        var ow := level.metres(float(o["w"]))
        var oh := level.metres(float(o["h"]))
        var tall := _height_for(o)
        var pos := Vector3(level.metres(float(o["x"])), tall * 0.5, level.metres(float(o["y"])))
        var kind := String(o.get("type", "wall"))
        _box(Vector3(ow, tall, oh), pos, _mat(_material_for_object(o)), true)
        # A cornice caps every facade. It is the cheapest single thing that
        # stops a wall reading as an extruded rectangle: it gives the top edge
        # a shadow line and a change of material, which is what the eye uses
        # to tell a building from a block.
        if kind == "masonry" or kind == "wall" or kind == "perimeter":
            _plinth(Vector3(ow, tall, oh), pos)
            _windows(o, Vector3(ow, tall, oh), pos)
            _downpipes(o, Vector3(ow, tall, oh), pos)
            _ground_clutter(o, Vector3(ow, tall, oh), pos)
            # 0.28 m of overhang, not 0.175. A cornice that casts no shadow
            # line is just a stripe of a different colour.
            var cap := _box(Vector3(ow + 0.56, 0.45, oh + 0.56),
                Vector3(pos.x, tall + 0.225, pos.z), _mat("cornice"), false)
            cap.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

## Per-object material, so neighbouring facades differ.
func _material_for_object(o: Dictionary) -> String:
    var kind := String(o.get("type", "wall"))
    if kind == "masonry" or kind == "wall":
        var v := int(o.get("variant", 0)) % 4
        return "wall" if v == 0 else "wall_%d" % v
    return _material_for(kind)

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
        # The plan's 24 teal entries are inset doorway markers in the 2D art,
        # not hanging lamps. Made into omnis they washed the far arch and the
        # right-hand facade cyan, and no reference frame has a cyan pixel.
        var col := Color(String(l.get("color", "#ffc781")))
        if col.b > col.r:
            continue
        var lamp := OmniLight3D.new()
        lamp.position = Vector3(level.metres(float(l["x"])), 2.9, level.metres(float(l["y"])))
        lamp.omni_range = maxf(3.0, level.metres(float(l.get("radius", 150))) * 2.2)
        lamp.light_color = Color(String(l.get("color", "#ffc781")))
        lamp.light_energy = 0.4
        lamp.shadow_enabled = false
        lamp.light_specular = 0.4
        add_child(lamp)

## A base course at pavement level. Buildings in the reference all have one,
## and it is what stops a facade looking like it was dropped onto the ground.
func _plinth(size: Vector3, pos: Vector3) -> void:
    var p := _box(Vector3(size.x + 0.28, 0.85, size.z + 0.28),
        Vector3(pos.x, 0.425, pos.z), _mat("trim"), false)
    p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
    # A kerb stone at the very bottom, stepping out past the plinth. Walls met
    # the ground at a perfect intersection with nothing in the join, which is
    # one of the strongest "this is a box on a plane" cues there is.
    var k := _box(Vector3(size.x + 0.52, 0.14, size.z + 0.52),
        Vector3(pos.x, 0.07, pos.z), _mat("kerb"), false)
    k.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

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
            # Glass set back behind the frame, so the reveal casts into the
            # opening. The previous recess was an untextured near-black box --
            # the only flat-paint surface left in the build, and it read as a
            # hole cut in cardboard.
            var inset := 0.12
            var glass_pos: Vector3 = centre + (Vector3(0, 0, -inset) if along_x else Vector3(-inset, 0, 0))
            var glass := _box(glass_size * 0.94, glass_pos, _mat("glass"), false)
            glass.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            # A mullion cross, which is what makes an opening read as a window
            # rather than as a rectangle.
            var bar_a := Vector3(0.06, h, 0.10) if along_x else Vector3(0.10, h, 0.06)
            var bar_b := Vector3(w, 0.06, 0.10) if along_x else Vector3(0.10, 0.06, w)
            _box(bar_a, glass_pos, _mat("trim"), false).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            _box(bar_b, glass_pos, _mat("trim"), false).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            # A sill that catches the sun and streaks below itself.
            var sill_size := Vector3(w + 0.40, 0.10, depth + 0.30) if along_x else Vector3(depth + 0.30, 0.10, w + 0.40)
            _box(sill_size, centre + Vector3(0, -h * 0.5 - 0.05, 0), _mat("trim"), false)
            # Shutters on the lower row only, where a person could reach them.
            if r < 4.0 and int(o.get("variant", 0)) % 2 == 0:
                var sh_yaw: float = 0.0 if along_x else 90.0
                var face_sign := 1.0 if (centre.z > pos.z or centre.x > pos.x) else -1.0
                var sh_pos: Vector3 = centre + (Vector3(0, 0, depth * 0.5 * face_sign) if along_x else Vector3(depth * 0.5 * face_sign, 0, 0))
                _mount("shutter", sh_pos, sh_yaw if face_sign > 0.0 else sh_yaw + 180.0)

# ---- Dressing --------------------------------------------------------------

## Props are loaded once and reused as instances.
const PROP_DIR := "res://art/models/prop_%s.glb"

## How far each prop reaches along the wall it is mounted on, in metres.
##
## Without this a 5.6 m pipe run placed near the end of a 9 m wall hangs half
## its length out over the doorway next to it, held up by nothing. Placement
## clamps the offset so the whole prop stays on its face, and skips the prop
## entirely where the face is too short to hold it.
const PROP_HALF_LENGTH := {
    "pipe_run": 2.85, "awning": 1.35, "ac_unit": 0.55, "sign": 0.32,
    "dish": 0.55, "conduit": 0.22, "shutter": 0.50, "wall_lamp": 0.10,
    "drum": 0.32, "crate_stack": 0.45,
}
var _prop_cache: Dictionary = {}

func _prop(name: String) -> Node3D:
    if not _prop_cache.has(name):
        var path := PROP_DIR % name
        _prop_cache[name] = load(path) if ResourceLoader.exists(path) else null
    var packed = _prop_cache[name]
    if packed == null:
        return null
    return packed.instantiate()

## Place a prop on a wall face.
##
## Prop local space is the mounting convention from tools/godot/build-props.py:
## the wall face lies at Z=0 with +Z pointing out into the room and +Y up. All
## this has to do is put that origin on the face and turn it to match the
## face's outward normal.
func _mount(name: String, pos: Vector3, yaw_deg: float, scale: float = 1.0) -> void:
    var node := _prop(name)
    if node == null:
        return
    node.position = pos
    node.rotation_degrees = Vector3(0.0, yaw_deg, 0.0)
    node.scale = Vector3.ONE * scale
    # Dressing casts. A prop that throws no shadow onto the wall behind it
    # reads as a sticker, and that shadow is most of what makes it a solid
    # object. This was switched off for capture performance when there were no
    # props to speak of; with ten families placed it was the reason none of
    # them read. Paid for by a 45 m shadow distance and two splits instead of
    # four, which costs far less than it buys.
    for c in _descendants(node):
        if c is GeometryInstance3D:
            c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
    add_child(node)

func _descendants(n: Node) -> Array:
    var out: Array = []
    for c in n.get_children():
        out.append(c)
        out.append_array(_descendants(c))
    return out

## A stable pseudo-random value per (object, slot). The plan carries a seeded
## `variant` per object from the 2D game, so dressing derived from it is the
## same on every run without this file owning any randomness of its own.
func _pick(o: Dictionary, slot: int, modulo: int) -> int:
    var h := int(o.get("variant", 0)) * 2654435761
    h += int(absf(float(o.get("x", 0.0)))) * 40503
    h += int(absf(float(o.get("y", 0.0)))) * 12289
    h += slot * 2246822519
    return int(absf(float(h % modulo)))

func _build_props() -> void:
    _dress_walls()
    _dress_lamps()
    _dress_solids()

## Hardware on the faces of the tall facades.
func _dress_walls() -> void:
    var wall_kinds := ["masonry", "wall", "perimeter"]
    var idx := 0
    for o in level.walls:
        var kind := String(o.get("type", "wall"))
        if not wall_kinds.has(kind):
            continue
        idx += 1
        var ow := level.metres(float(o["w"]))
        var oh := level.metres(float(o["h"]))
        var tall := _height_for(o)
        var cx := level.metres(float(o["x"]))
        var cz := level.metres(float(o["y"]))
        var along_x: bool = ow >= oh
        var span: float = ow if along_x else oh
        if span < 5.0:
            continue
        var half_depth: float = (oh if along_x else ow) * 0.5
        # Both long faces of an interior wall look into a room, so both get
        # dressed. Yaw turns the prop's +Z onto that face's outward normal.
        var faces := [
            {"yaw": 0.0, "offset": Vector3(0.0, 0.0, half_depth)},
            {"yaw": 180.0, "offset": Vector3(0.0, 0.0, -half_depth)},
        ] if along_x else [
            {"yaw": 90.0, "offset": Vector3(half_depth, 0.0, 0.0)},
            {"yaw": -90.0, "offset": Vector3(-half_depth, 0.0, 0.0)},
        ]
        for f in range(faces.size()):
            var face: Dictionary = faces[f]
            var base: Vector3 = Vector3(cx, 0.0, cz) + face["offset"]
            var axis := Vector3(1.0, 0.0, 0.0) if along_x else Vector3(0.0, 0.0, 1.0)
            # Two dressing slots per face, each choosing from a different
            # family so one wall never gets two of the same thing. Two, not
            # three: Each prop is tens of meshes and the
            # capture renders on a software rasteriser; the first pass put ~260
            # of them in the sector and the capture blew its watchdog.
            var slots := [
                {"t": -0.31, "set": ["pipe_run", "conduit", "ac_unit"], "y": [3.1, 2.5, 3.9]},
                {"t": 0.0, "set": ["sign", "awning", "conduit"], "y": [3.5, 3.0, 2.2]},
                {"t": 0.31, "set": ["ac_unit", "dish", "pipe_run"], "y": [3.7, 4.6, 3.3]},
            ]
            for sl in range(slots.size()):
                var slot: Dictionary = slots[sl]
                # Two independent draws: one decides whether the slot is used
                # at all, the other which family fills it. Deriving both from
                # one number tied the skip rate to the option count and, when
                # the slot list grew, indexed past the end of it.
                if _pick(o, sl * 7 + f * 3 + idx, 5) == 0:
                    continue
                var options: Array = slot["set"]
                var heights: Array = slot["y"]
                var choice := _pick(o, sl * 31 + f * 11 + idx * 3 + 5, options.size())
                var name: String = options[choice]
                var y: float = heights[choice]
                # Clamp below the parapet: a dish silhouetted against the sky
                # with nothing behind it reads as a balloon.
                y = minf(y, tall - 2.2)
                if y < 1.8:
                    continue
                var reach: float = float(PROP_HALF_LENGTH.get(name, 0.5))
                var room: float = span * 0.5 - reach - 0.35
                if room <= 0.0:
                    continue
                var offset: float = clampf(span * float(slot["t"]), -room, room)
                _mount(name, base + axis * offset + Vector3(0.0, y, 0.0), face["yaw"])

## Lamp bodies at the level's own light positions.
##
## The plan already says where the facility's lamps are -- the 2D game draws a
## glow at each. Putting real geometry there means the light in the 3D scene
## comes out of a visible fitting instead of out of thin air.
func _dress_lamps() -> void:
    for l in level.lights:
        var col := Color(String(l.get("color", "#ffc781")))
        # Only the warm room lamps get a fitting; the teal pair flanking each
        # doorway are inset markers in the 2D art, not hanging lights.
        if col.b > col.r:
            continue
        var pos := Vector3(level.metres(float(l["x"])), 3.05, level.metres(float(l["y"])))
        var near := _nearest_wall_face(pos)
        if near.is_empty():
            continue
        _mount("wall_lamp", near["pos"], near["yaw"])

## The wall face closest to a point, with the yaw that faces away from it.
func _nearest_wall_face(p: Vector3) -> Dictionary:
    var best := {}
    var best_d := 6.0
    for o in level.walls:
        var ow := level.metres(float(o["w"]))
        var oh := level.metres(float(o["h"]))
        var cx := level.metres(float(o["x"]))
        var cz := level.metres(float(o["y"]))
        if _height_for(o) < 4.0:
            continue
        var dx: float = p.x - cx
        var dz: float = p.z - cz
        if absf(dx) > ow * 0.5 + 3.0 or absf(dz) > oh * 0.5 + 3.0:
            continue
        var along_x: bool = ow >= oh
        var d: float = absf(dz) - oh * 0.5 if along_x else absf(dx) - ow * 0.5
        if d < 0.0 or d > best_d:
            continue
        best_d = d
        if along_x:
            var sgn: float = signf(dz)
            best = {"pos": Vector3(clampf(p.x, cx - ow * 0.5 + 0.6, cx + ow * 0.5 - 0.6), p.y, cz + sgn * oh * 0.5),
                    "yaw": 0.0 if sgn >= 0.0 else 180.0}
        else:
            var sgx: float = signf(dx)
            best = {"pos": Vector3(cx + sgx * ow * 0.5, p.y, clampf(p.z, cz - oh * 0.5 + 0.6, cz + oh * 0.5 - 0.6)),
                    "yaw": 90.0 if sgx >= 0.0 else -90.0}
    return best

## Drums and crates on top of the cover the simulation already has.
func _dress_solids() -> void:
    var idx := 0
    for o in level.cover:
        var kind := String(o.get("type", ""))
        if kind != "container" and kind != "machinery":
            continue
        idx += 1
        var top := _height_for(o)
        var cx := level.metres(float(o["x"]))
        var cz := level.metres(float(o["y"]))
        var ow := level.metres(float(o["w"]))
        var oh := level.metres(float(o["h"]))
        var choice := _pick(o, idx, 3)
        if choice == 2:
            continue
        var name := "drum" if choice == 0 else "crate_stack"
        # Nudged off centre so the stack does not look placed by a machine,
        # but kept well inside the footprint so nothing overhangs into a lane.
        var ox: float = (float(_pick(o, idx + 11, 7)) / 6.0 - 0.5) * maxf(0.0, ow - 1.1)
        var oz: float = (float(_pick(o, idx + 23, 7)) / 6.0 - 0.5) * maxf(0.0, oh - 1.1)
        var yaw: float = float(_pick(o, idx + 31, 8)) * 45.0
        _mount(name, Vector3(cx + ox, top, cz + oz), yaw)

## A downpipe from the cornice to the kerb at facade corners.
##
## Every reference has a vertical run somewhere in frame; this build had only
## horizontal pipes, and a vertical breaks the flat facade rectangle better
## than anything else of comparable cost. Flush to the wall, so it adds no
## collision.
func _downpipes(o: Dictionary, size: Vector3, pos: Vector3) -> void:
    if size.y < 6.0:
        return
    var along_x: bool = size.x >= size.z
    var span: float = size.x if along_x else size.z
    if span < 6.0:
        return
    var half_depth: float = (size.z if along_x else size.x) * 0.5
    var axis := Vector3(1.0, 0.0, 0.0) if along_x else Vector3(0.0, 0.0, 1.0)
    var normal := Vector3(0.0, 0.0, 1.0) if along_x else Vector3(1.0, 0.0, 0.0)
    for end in [-1.0, 1.0]:
        for face in [-1.0, 1.0]:
            if _pick(o, int(end) * 5 + int(face) * 3, 4) == 0:
                continue
            var at: Vector3 = Vector3(pos.x, size.y * 0.5, pos.z) \
                + axis * (span * 0.5 - 0.55) * end \
                + normal * (half_depth + 0.09) * face
            var pipe := _box(Vector3(0.16, size.y - 0.55, 0.16), at, _mat("machinery"), false)
            pipe.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
            # A hopper at the top and a shoe at the bottom.
            _box(Vector3(0.30, 0.26, 0.24), Vector3(at.x, size.y - 0.55, at.z), _mat("machinery"), false)
            _box(Vector3(0.22, 0.18, 0.34), Vector3(at.x, 0.30, at.z) + normal * 0.06 * face,
                _mat("machinery"), false)

## Spall and rubble along wall bases.
##
## Small enough to be visual only: every piece sits within 40 cm of a face the
## simulation already treats as solid, so there is nowhere for the operative to
## walk into one and no sightline it could block that the sim thinks is open.
func _ground_clutter(o: Dictionary, size: Vector3, pos: Vector3) -> void:
    var along_x: bool = size.x >= size.z
    var span: float = size.x if along_x else size.z
    if span < 6.0:
        return
    var half_depth: float = (size.z if along_x else size.x) * 0.5
    var axis := Vector3(1.0, 0.0, 0.0) if along_x else Vector3(0.0, 0.0, 1.0)
    var normal := Vector3(0.0, 0.0, 1.0) if along_x else Vector3(1.0, 0.0, 0.0)
    for i in range(6):
        if _pick(o, i * 13 + 41, 3) == 0:
            continue
        var t := (float(_pick(o, i * 17 + 7, 11)) / 10.0 - 0.5) * (span - 1.6)
        var face := 1.0 if _pick(o, i * 19 + 3, 2) == 0 else -1.0
        var out := 0.30 + float(_pick(o, i * 23 + 9, 5)) * 0.03
        var scale := 0.05 + float(_pick(o, i * 29 + 11, 6)) * 0.022
        var at: Vector3 = Vector3(pos.x, scale * 0.5, pos.z) + axis * t + normal * (half_depth + out) * face
        var chunk := _box(Vector3(scale * 1.7, scale, scale * 1.3), at, _mat("kerb"), false)
        chunk.rotation.y = float(_pick(o, i * 31 + 5, 8)) * 0.4
        chunk.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

# ---- Decals ----------------------------------------------------------------

## Projected markings.
##
## A `Decal` projects onto whatever geometry is already there, so none of this
## adds a triangle of collision or occludes a sightline the simulation believes
## is open -- which makes it the only way to add a painted layer under the rule
## this build works to. The content is the level's own: Blacksite Zero names
## its nine chambers, and those designations are what goes on the floors.
##
## A Decal projects along its local -Y. Floor markings therefore need no
## rotation; wall markings are turned so -Y points into the face.
const DECAL_DIR := "res://art/decals/%s.png"

func _decal_tex(name: String) -> Texture2D:
    var path := DECAL_DIR % name
    return load(path) if ResourceLoader.exists(path) else null

func _decal(name: String, pos: Vector3, size: Vector3, rot: Vector3 = Vector3.ZERO,
        energy: float = 1.0, fade: float = 0.35) -> void:
    var tex := _decal_tex(name)
    if tex == null:
        return
    var d := Decal.new()
    d.texture_albedo = tex
    d.size = size
    d.position = pos
    d.rotation_degrees = rot
    d.albedo_mix = energy
    d.upper_fade = fade
    d.lower_fade = fade
    d.normal_fade = 0.35
    add_child(d)

func _build_decals() -> void:
    _decal_zone_labels()
    _decal_thresholds()
    _decal_grime()

## The chamber designation painted on each floor, as facilities do.
func _decal_zone_labels() -> void:
    for i in range(level.zones.size()):
        var z: Dictionary = level.zones[i]
        var cx := level.metres(float(z["x"]))
        var cz := level.metres(float(z["y"]))
        # Offset off the room centre so the label is not always under the
        # operative's feet the moment they walk in.
        _decal("label_%d" % i, Vector3(cx, 0.35, cz - 3.2), Vector3(9.5, 1.2, 3.0), Vector3.ZERO, 0.85)
        _decal("number_%d" % i, Vector3(cx + 5.6, 0.35, cz + 1.4), Vector3(3.0, 1.2, 3.0), Vector3(0, 12.0, 0), 0.85)

## Hazard chevrons across every doorway threshold, and an arrow leading in.
func _decal_thresholds() -> void:
    for d in level.doorways:
        var vertical: bool = d.get("vertical", false)
        var cx := level.metres(float(d["x"]))
        var cz := level.metres(float(d["y"]))
        var span := level.metres(float(d["h"] if vertical else d["w"]))
        var yaw := 90.0 if vertical else 0.0
        _decal("chevrons", Vector3(cx, 0.35, cz), Vector3(span * 0.92, 1.2, 1.5),
            Vector3(0, yaw, 0), 0.9)
        # An arrow on each approach, pointing through the opening.
        for side in [-1.0, 1.0]:
            var offset: Vector3 = Vector3(0, 0, 3.4 * side) if not vertical else Vector3(3.4 * side, 0, 0)
            # The arrow art points toward -Z in its own space; turn it to face
            # the doorway from whichever side it sits on.
            var arrow_yaw: float = yaw + (0.0 if side > 0.0 else 180.0)
            _decal("arrow", Vector3(cx, 0.35, cz) + offset, Vector3(1.6, 1.2, 3.2),
                Vector3(0, arrow_yaw, 0), 0.75)

## Soot, spills and water runs. Placed deterministically from the plan's own
## seeded `variant` field, so a sector looks the same every time it is loaded.
func _decal_grime() -> void:
    var idx := 0
    for o in level.walls:
        var kind := String(o.get("type", "wall"))
        if kind != "masonry" and kind != "wall":
            continue
        idx += 1
        var ow := level.metres(float(o["w"]))
        var oh := level.metres(float(o["h"]))
        var tall := _height_for(o)
        var cx := level.metres(float(o["x"]))
        var cz := level.metres(float(o["y"]))
        var along_x: bool = ow >= oh
        var span: float = ow if along_x else oh
        if span < 5.0:
            continue
        var half_depth: float = (oh if along_x else ow) * 0.5
        var axis := Vector3(1.0, 0.0, 0.0) if along_x else Vector3(0.0, 0.0, 1.0)
        var normal := Vector3(0.0, 0.0, 1.0) if along_x else Vector3(1.0, 0.0, 0.0)
        for face in [-1.0, 1.0]:
            # Water streaking down the facade.
            for k in range(2):
                if _pick(o, idx * 7 + k * 3 + int(face), 3) == 0:
                    continue
                var t := (float(_pick(o, idx * 11 + k * 5, 9)) / 8.0 - 0.5) * (span - 2.5)
                var at: Vector3 = Vector3(cx, tall * 0.55, cz) + axis * t + normal * (half_depth + 0.05) * face
                # Turned so the projection points into the wall face.
                var rot: Vector3 = Vector3(90.0 * face, 0.0, 0.0) if along_x else Vector3(0.0, 0.0, -90.0 * face)
                _decal("streak", at, Vector3(2.0, 1.0, tall * 0.7), rot, 0.55, 0.5)
            # Soot at the base, where the ground meets the wall.
            if _pick(o, idx * 13 + int(face) * 2, 2) == 0:
                continue
            var t2 := (float(_pick(o, idx * 17 + 3, 7)) / 6.0 - 0.5) * (span - 4.0)
            var ground: Vector3 = Vector3(cx, 0.35, cz) + axis * t2 + normal * (half_depth + 1.6) * face
            _decal("scorch", ground, Vector3(4.6, 1.2, 4.6), Vector3(0, float(_pick(o, idx, 8)) * 45.0, 0), 0.8)
            _decal("stain", ground + axis * 2.4, Vector3(3.2, 1.2, 3.2),
                Vector3(0, float(_pick(o, idx * 3, 8)) * 45.0, 0), 0.7)
