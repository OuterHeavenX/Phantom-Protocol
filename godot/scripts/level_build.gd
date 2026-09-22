class_name LevelBuild
extends Node3D

const MaterialsC := preload("res://scripts/materials.gd")

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
    # A flat roofline over a whole sector reads as one extruded shape, and
    # every wall/sky boundary in the sector was a dead straight horizontal.
    # This was meant to be driven by the plan's per-object `variant`, but the
    # opening sector leaves that field null on every wall, so the step was
    # always zero and every building came out the same height.
    #
    # The hash of the footprint does the job instead. Four steps of 0.8 m put
    # typically 1.6 m between one side of a lane and the other, which is the
    # difference the references carry between adjacent buildings. It moves no
    # footprint, so the 2D simulation's collision is untouched.
    if base >= 5.0:
        base += float(_pick(o, 71, 5)) * 0.8
    return base

func build(lvl: Level, mats: Dictionary) -> void:
    level = lvl
    materials = mats
    # A bridge is not a street with different textures. Facades, rooflines,
    # awnings, alley clutter and doorframes all assume a room you stand
    # inside, and CROSSFALL is a deck over open water with nothing on either
    # side. So it gets its own pass rather than a pile of exceptions in this
    # one.
    if level.layout != null and String(level.layout.get("type", "")) == "bridge":
        _build_bridge()
        return
    _build_ground()
    _build_solids()
    _build_doorframes()
    _build_props()
    _build_spans()
    _build_decals()
    _build_lights()
    _merge_static()

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
        # Each chamber gets one of four surfaces, chosen from its own
        # footprint so the arrangement is deterministic.
        var surface: String = ["ground", "ground_1", "ground_2", "ground_3"][_pick(z, 121, 4)]
        # Paving, not slab. The concrete plate's form seams landed on a
        # perfectly axis-aligned 1.25 m grid and read as bathroom tile; the
        # cobble set is already at a believable 17 cm.
        var plate := _box(Vector3(zw, 0.02, zh), pos, _mat(surface), false)
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
        if kind == "pillar" or kind == "vault" or kind == "vaultSeal":
            _dress_pillar(Vector3(ow, tall, oh), pos)
        if kind == "masonry" or kind == "wall" or kind == "perimeter":
            _plinth(Vector3(ow, tall, oh), pos)
            _windows(o, Vector3(ow, tall, oh), pos)
            _downpipes(o, Vector3(ow, tall, oh), pos)
            _ground_clutter(o, Vector3(ow, tall, oh), pos)
            _rooftop(o, Vector3(ow, tall, oh), pos)
            _awning(o, Vector3(ow, tall, oh), pos)
            _wall_fixtures(o, Vector3(ow, tall, oh), pos)
            # 0.28 m of overhang, not 0.175. A cornice that casts no shadow
            # line is just a stripe of a different colour.
            # 0.42 m of overhang each side rather than 0.28. The eaves have
            # to project far enough to lay a dark band across the top of the
            # facade; at the old depth the shadow line was a few centimetres
            # and read as a change of colour rather than as a roof.
            var cap := _box(Vector3(ow + 0.84, 0.45, oh + 0.84),
                Vector3(pos.x, tall + 0.225, pos.z), _mat("cornice"), false)
            cap.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

## Per-object material, so neighbouring facades differ.
func _material_for_object(o: Dictionary) -> String:
    var kind := String(o.get("type", "wall"))
    if kind == "masonry" or kind == "wall":
        # The plan's `variant` only runs 0-3 and there are five facade
        # surfaces, so the wall's own position is mixed in to reach the fifth.
        # The mix has to scramble: a plain sum of the coordinates gave
        # neighbouring walls neighbouring seeds, so the two largest facades in
        # the opening view drew the same material and the sector came out one
        # colour again, just a different one. It stays a pure function of the
        # plan, so the layout is identical on every load.
        var v := _pick(o, 91, 8)
        # Warm stone takes half. The references are warm-dominant: tan and
        # terracotta carry the sector and grey concrete punctuates it, and
        # reversing that reads as an industrial estate rather than a town.
        var order := ["wall", "wall", "wall", "wall", "wall_2", "wall_1", "wall_3", "wall_4"]
        return order[v]
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
        # Street lamps are world lights, so they skip the viewmodel layer too.
        lamp.light_cull_mask = 0xFFFFF & ~(1 << 1)
        lamp.position = Vector3(level.metres(float(l["x"])), 2.9, level.metres(float(l["y"])))
        lamp.omni_range = maxf(3.0, level.metres(float(l.get("radius", 150))) * 2.2)
        lamp.light_color = Color(String(l.get("color", "#ffc781")))
        lamp.light_energy = 0.4
        lamp.shadow_enabled = false
        lamp.light_specular = 0.4
        add_child(lamp)

## A base course at pavement level. Buildings in the reference all have one,
## and it is what stops a facade looking like it was dropped onto the ground.
## Something standing on the roof, to break the skyline.
##
## Every wall/sky boundary in the sector was a dead straight horizontal line,
## which is the silhouette of a extruded floor plan and of nothing else. The
## references break their skylines constantly -- a vent stack, a water tank, an
## aerial -- and those breaks are most of what makes a roofline read as a
## building rather than as the top of a wall.
##
## Roughly one facade in six gets one. That is deliberately sparse: a stack on
## every roof is crenellation, an irregular fringe that reads as visual noise
## and makes the walls harder to judge as cover. Everything here stands ON an
## existing solid, so the 2D simulation's collision is untouched.
func _rooftop(o: Dictionary, size: Vector3, pos: Vector3) -> void:
    if _pick(o, 41, 6) != 0:
        return
    # Keep it on the roof. A stack placed past the parapet would hang over the
    # lane below, where nothing supports it and nothing blocks it.
    var half := Vector2(maxf(0.4, size.x * 0.5 - 0.7), maxf(0.4, size.z * 0.5 - 0.7))
    var off := Vector3(
        (float(_pick(o, 42, 9)) / 8.0 - 0.5) * 2.0 * half.x,
        0.0,
        (float(_pick(o, 43, 9)) / 8.0 - 0.5) * 2.0 * half.y)
    var top := size.y + 0.45
    var at := Vector3(pos.x + off.x, top, pos.z + off.z)
    match _pick(o, 44, 3):
        0:
            # Extract stack: a squat housing with a cowl over it.
            var hb := 1.15
            _box(Vector3(1.0, hb, 1.0), at + Vector3(0, hb * 0.5, 0), _mat("machinery"), false)
            _box(Vector3(1.35, 0.14, 1.35), at + Vector3(0, hb + 0.07, 0), _mat("kerb"), false)
            _box(Vector3(0.42, 1.5, 0.42), at + Vector3(0.0, hb + 0.85, 0.0), _mat("machinery"), false)
        1:
            # Water tank on short legs.
            var lg := 0.7
            for sx in [-0.55, 0.55]:
                for sz in [-0.55, 0.55]:
                    _box(Vector3(0.14, lg, 0.14),
                        at + Vector3(sx, lg * 0.5, sz), _mat("machinery"), false)
            _box(Vector3(1.5, 1.25, 1.5), at + Vector3(0, lg + 0.625, 0), _mat("container"), false)
            _box(Vector3(1.62, 0.1, 1.62), at + Vector3(0, lg + 1.3, 0), _mat("kerb"), false)
        _:
            # Aerial mast: thin, tall, and almost all silhouette.
            _box(Vector3(0.5, 0.35, 0.5), at + Vector3(0, 0.175, 0), _mat("kerb"), false)
            _box(Vector3(0.11, 3.1, 0.11), at + Vector3(0, 1.9, 0), _mat("machinery"), false)
            for i in range(2):
                var y := 2.35 + float(i) * 0.62
                _box(Vector3(1.05, 0.07, 0.07), at + Vector3(0, y, 0), _mat("machinery"), false)

## A cap, a footing and a banded joint on a free-standing block.
##
## There are twenty-eight of these in the sector and they are the cover the
## player actually fights around, so they sit close to the camera and fill a
## lot of frame. Undressed they are extruded rectangles: a four-metre concrete
## slab with a bare top edge reads as a placeholder at any distance, and two of
## them at the frame edges were carrying a quarter of the image between them.
##
## All of it is inside the block's own footprint or directly above it, so
## nothing here is reachable and the 2D simulation's collision is unchanged.
func _dress_pillar(size: Vector3, pos: Vector3) -> void:
    # A capping slab, overhanging enough to throw a shadow line down the face.
    var cap := _box(Vector3(size.x + 0.30, 0.22, size.z + 0.30),
        Vector3(pos.x, size.y + 0.11, pos.z), _mat("kerb"), false)
    cap.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
    # A footing, so the block meets the ground in a step rather than a line.
    var foot := _box(Vector3(size.x + 0.22, 0.30, size.z + 0.22),
        Vector3(pos.x, 0.15, pos.z), _mat("kerb"), false)
    foot.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
    # A lift joint partway up. Precast blocks are cast in sections and the
    # seam between them is the one piece of information that tells the eye
    # how tall the thing is.
    if size.y > 2.6:
        var band := _box(Vector3(size.x + 0.08, 0.13, size.z + 0.08),
            Vector3(pos.x, size.y * 0.58, pos.z), _mat("trim"), false)
        band.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

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
    # An 8 m facade at 3.6 m spacing works out to exactly one window, and the
    # opening sector is built almost entirely from 8 m wall segments, so most
    # facades carried a single opening near one end and read as blank. Real
    # buildings put windows on roughly a 2.5 to 3 m grid.
    var spacing := 2.7 + float(_pick(o, 51, 3)) * 0.3
    var count := int(floor((span - 1.4) / spacing))
    if count < 1:
        return
    var depth: float = (size.z if along_x else size.x)
    var start := -(float(count - 1) * spacing) * 0.5
    # A storey every 2.7 m, as many as the wall is tall enough to carry. One
    # row on a seven-metre facade left five metres of unbroken masonry above
    # it, which is most of what made the lanes read as a greybox.
    var rows: Array = [2.5]
    if size.y > 7.0:
        rows.append(5.2)
    if size.y > 10.0:
        rows.append(7.9)
    if size.y > 12.6:
        rows.append(10.6)
    for r in rows:
        if r + 1.5 > size.y - 0.6:
            continue
        for i in range(count):
            var off := start + float(i) * spacing
            var centre := Vector3(
                pos.x + (off if along_x else 0.0),
                r,
                pos.z + (0.0 if along_x else off))
            var w := 1.22
            var h := 1.62
            # The frame used to be a solid box the same size as the opening,
            # drawn at the same centre as the glass -- so it enclosed the
            # glass completely and what the player saw was the frame's own
            # outer face in pale trim. Every window in the sector rendered as
            # a blank light rectangle stuck on the wall. A frame has to be a
            # ring: four bars around an opening, with the dark glazing behind
            # them doing the work.
            var through: float = depth + 0.03
            var glass_size := Vector3(w, h, through) if along_x else Vector3(through, h, w)
            var glass := _box(glass_size, centre, _mat("glass"), false)
            glass.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            # Frame bars stand proud of the wall, so each one casts a shadow
            # onto the glazing behind it and the opening gains real depth.
            var jamb := 0.11
            var proud: float = depth + 0.22
            var head_size := Vector3(w + jamb * 2.0, jamb, proud) if along_x \
                else Vector3(proud, jamb, w + jamb * 2.0)
            var post_size := Vector3(jamb, h + jamb * 2.0, proud) if along_x \
                else Vector3(proud, h + jamb * 2.0, jamb)
            for dy in [-(h + jamb) * 0.5, (h + jamb) * 0.5]:
                var hb: float = dy
                _box(head_size, centre + Vector3(0, hb, 0), _mat("trim"), false) \
                    .cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
            for d in [-(w + jamb) * 0.5, (w + jamb) * 0.5]:
                var side: float = d
                var at: Vector3 = centre + (Vector3(side, 0, 0) if along_x else Vector3(0, 0, side))
                _box(post_size, at, _mat("trim"), false) \
                    .cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
            # A mullion cross, which is what makes an opening read as a window
            # rather than as a rectangle. Set just proud of the glazing.
            var mull: float = depth + 0.13
            var bar_a := Vector3(0.055, h, mull) if along_x else Vector3(mull, h, 0.055)
            var bar_b := Vector3(w, 0.055, mull) if along_x else Vector3(mull, 0.055, w)
            _box(bar_a, centre, _mat("trim"), false).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            _box(bar_b, centre, _mat("trim"), false).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            # A sill that catches the sun and streaks below itself.
            var sill_size := Vector3(w + 0.44, 0.11, depth + 0.34) if along_x else Vector3(depth + 0.34, 0.11, w + 0.44)
            _box(sill_size, centre + Vector3(0, -h * 0.5 - jamb - 0.06, 0), _mat("kerb"), false) \
                .cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
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

## A stable pseudo-random value per (object, slot).
##
## The plan carries a seeded `variant` per object from the 2D game, so dressing
## derived from it is the same on every run without this file owning any
## randomness of its own.
##
## The mixing matters more than it looks. The first version summed the
## coordinates against odd multipliers and took the modulo directly, and every
## wall in the sector came out dressed identically: plan coordinates are all
## multiples of ten, so the sum is always a multiple of ten too, and it is
## therefore constant modulo 2 and modulo 5 -- which is most of the moduli the
## dressing asks for. Two walls facing each other across the lane drew the same
## pipe at the same height with the same panel beside it, and a mirrored street
## is the fastest way to tell a player they are standing in a greybox.
##
## Running the accumulator through an avalanche step first breaks that: each
## shift-xor-multiply round spreads every input bit across the whole word, so
## the low bits the modulo reads stop tracking the coordinate grid.
func _hash64(v: int) -> int:
    var h := v
    h = (h ^ (h >> 33)) * -49064778989728563      # 0xff51afd7ed558ccd
    h = (h ^ (h >> 29)) * -4265267296055464877    # 0xc4ceb9fe1a85ec53
    return h ^ (h >> 32)

func _pick(o: Dictionary, slot: int, modulo: int) -> int:
    var h := int(o.get("variant", 0) if o.get("variant") != null else 0) * 2654435761
    h += int(round(float(o.get("x", 0.0)))) * 40503
    h += int(round(float(o.get("y", 0.0)))) * 12289
    h += slot * 2246822519
    return absi(_hash64(h)) % modulo

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
        # Pillars included: they are solid, so anything set on top of one is
        # out of reach and costs no collision, and they are the blocks nearest
        # the camera in most views.
        if kind != "container" and kind != "machinery" and kind != "pillar":
            continue
        idx += 1
        var top := _height_for(o) + (0.22 if String(o.get("type", "")) == "pillar" else 0.0)
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
## Cables strung across a lane, from one facade to the one opposite.
##
## The lane floor has to stay clear -- the 2D simulation owns collision and
## would let a player walk through anything standing in it -- so the only place
## left to fill the middle of the frame is above head height. That turns out to
## be the right place anyway: the references are full of overhead runs, and a
## cable crossing a street does something no wall dressing can, which is to tie
## the two sides of the lane into one space and give the gap between them a
## measurable depth.
##
## Each span looks for the nearest facade directly opposite, across a gap wide
## enough to be a lane and narrow enough to be spanned.
## Blacksite Zero's lanes run about 21 m between facades, so a 17 m ceiling
## rejected every pair in the sector and not one cable was strung.
const SPAN_MIN := 4.0
const SPAN_MAX := 26.0

func _build_spans() -> void:
    var facades: Array = []
    for o in level.walls:
        var kind := String(o.get("type", "wall"))
        if kind != "masonry" and kind != "wall":
            continue
        facades.append(o)
    var drawn := 0
    for i in range(facades.size()):
        var a: Dictionary = facades[i]
        # One in three facades tries, so lanes carry the odd cable rather than
        # a cat's cradle. A sector roofed over with wire reads as a set.
        if _pick(a, 101, 3) != 0:
            continue
        var aw := level.metres(float(a["w"]))
        var ah := level.metres(float(a["h"]))
        var along_x: bool = aw >= ah
        var ax := level.metres(float(a["x"]))
        var az := level.metres(float(a["y"]))
        var normal := Vector3(0.0, 0.0, 1.0) if along_x else Vector3(1.0, 0.0, 0.0)
        var half: float = (ah if along_x else aw) * 0.5
        for face in [1.0, -1.0]:
            var best: Dictionary = {}
            var best_gap := SPAN_MAX
            for j in range(facades.size()):
                if j == i:
                    continue
                var b: Dictionary = facades[j]
                var bw := level.metres(float(b["w"]))
                var bh := level.metres(float(b["h"]))
                if (bw >= bh) != along_x:
                    continue
                var bx := level.metres(float(b["x"]))
                var bz := level.metres(float(b["y"]))
                # Must overlap along the lane, or the cable runs diagonally
                # off into a wall that is not opposite at all.
                var lateral: float = absf(bx - ax) if along_x else absf(bz - az)
                if lateral > (aw if along_x else ah) * 0.5:
                    continue
                var across: float = (bz - az) if along_x else (bx - ax)
                if across * face <= 0.0:
                    continue
                var gap: float = absf(across) - half - (bh if along_x else bw) * 0.5
                if gap < SPAN_MIN or gap >= best_gap:
                    continue
                best_gap = gap
                best = b
            if best.is_empty():
                continue
            _cable(a, best, along_x, face, half)
            drawn += 1
            break
    if drawn > 0:
        print("SPANS %d cables" % drawn)

func _cable(a: Dictionary, b: Dictionary, along_x: bool, face: float, half: float) -> void:
    var normal := Vector3(0.0, 0.0, 1.0) if along_x else Vector3(1.0, 0.0, 0.0)
    var axis := Vector3(1.0, 0.0, 0.0) if along_x else Vector3(0.0, 0.0, 1.0)
    var bw := level.metres(float(b["w"]))
    var bh := level.metres(float(b["h"]))
    var from: Vector3 = Vector3(level.metres(float(a["x"])), 0.0, level.metres(float(a["y"]))) \
        + normal * half * face
    var to: Vector3 = Vector3(level.metres(float(b["x"])), 0.0, level.metres(float(b["y"]))) \
        - normal * ((bh if along_x else bw) * 0.5) * face
    # Anchor a little below each parapet, and well clear of anything walking
    # underneath: the lowest point of the sag still sits above 4.2 m.
    var ya: float = maxf(4.9, _height_for(a) - 1.1)
    var yb: float = maxf(4.9, _height_for(b) - 1.1)
    # Keep the run over the middle of the lane rather than at a wall end.
    var slide: float = (float(_pick(a, 103, 9)) / 8.0 - 0.5) * (level.metres(float(a["w"] if along_x else a["h"])) - 2.0)
    from += axis * slide
    to += axis * slide
    var segments := 9
    # Catenary, approximated by a parabola. A dead straight cable between two
    # roofs reads as a strut; the sag is the whole point.
    var sag := 0.55 + float(_pick(a, 104, 4)) * 0.16
    var prev := Vector3(from.x, ya, from.z)
    for i in range(1, segments + 1):
        var t := float(i) / float(segments)
        var p := Vector3(from.x, ya, from.z).lerp(Vector3(to.x, yb, to.z), t)
        p.y -= sag * 4.0 * t * (1.0 - t)
        var mid := (prev + p) * 0.5
        var seg := _shallow(Vector3(0.05, (p - prev).length(), 0.05), mid, _mat("machinery"))
        seg.look_at_from_position(mid, p, Vector3.UP)
        # look_at points -Z at the target; the box is long in Y, so tip it.
        seg.rotate_object_local(Vector3.RIGHT, PI * 0.5)
        seg.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        prev = p
    # A bracket at each end, so the cable visibly lands on something.
    for pair in [[Vector3(from.x, ya, from.z), 1.0], [Vector3(to.x, yb, to.z), -1.0]]:
        var at: Vector3 = pair[0]
        var dir: float = pair[1]
        _shallow(Vector3(0.12, 0.12, 0.45), at + normal * face * dir * -0.16 + Vector3(0, 0.02, 0),
            _mat("machinery"))

## How far a prop may stand out from a wall face, in metres.
##
## The 2D simulation owns collision and knows nothing about any of this, so a
## crate left in the middle of a lane would be a crate the player walks through.
## Bodies resolve against walls at a radius of about eleven plan units, which is
## 0.34 m, so anything shallower than that sits inside a margin nothing can
## enter. It is a tight budget, but a prop 0.3 m deep and 1.5 m wide still reads
## completely from the middle of a lane -- depth is the one dimension a player
## standing in front of it cannot judge.
const CLUTTER_DEPTH := 0.30

## Things stacked and propped against the bottom of a facade.
##
## This used to place rubble chunks between 5 and 17 cm across, which at
## standing eye height is invisible: the lane floor read as an unbroken empty
## plane from the camera to the far wall, while the references fill the
## equivalent space with crates, sacks, barrels and bins. These are full-size
## objects held inside the depth budget above.
func _ground_clutter(o: Dictionary, size: Vector3, pos: Vector3) -> void:
    var along_x: bool = size.x >= size.z
    var span: float = size.x if along_x else size.z
    if span < 5.0:
        return
    var half_depth: float = (size.z if along_x else size.x) * 0.5
    var axis := Vector3(1.0, 0.0, 0.0) if along_x else Vector3(0.0, 0.0, 1.0)
    var normal := Vector3(0.0, 0.0, 1.0) if along_x else Vector3(1.0, 0.0, 0.0)
    # One or two per facade. More than that and a sector of thirty walls is
    # prop soup, where nothing is a landmark because everything is clutter.
    var count := 1 + _pick(o, 61, 2)
    for i in range(count):
        var t := (float(_pick(o, i * 17 + 63, 11)) / 10.0 - 0.5) * (span - 2.4)
        var face := 1.0 if _pick(o, i * 19 + 65, 2) == 0 else -1.0
        var base: Vector3 = Vector3(pos.x, 0.0, pos.z) + axis * t \
            + normal * (half_depth + CLUTTER_DEPTH * 0.5) * face
        _clutter_piece(_pick(o, i * 23 + 67, 5), base, axis, normal * face, o, i)

## `axis` runs along the wall, `out` points away from its face.
func _clutter_piece(kind: int, base: Vector3, axis: Vector3, out: Vector3,
        o: Dictionary, slot: int) -> void:
    var d := CLUTTER_DEPTH
    match kind:
        0:
            # Pallet stack: slats with air between them, which is most of what
            # makes a pallet read as a pallet rather than as a box.
            var n := 4 + _pick(o, slot * 7 + 71, 4)
            for i in range(n):
                var y := 0.06 + float(i) * 0.135
                _shallow(Vector3(1.18, 0.085, d), base + Vector3(0, y, 0), _mat("container"))
                _shallow(Vector3(1.18, 0.05, d * 0.55), base + Vector3(0, y + 0.075, 0), _mat("kerb"))
        1:
            # Sandbags: three courses, offset like real coursing.
            for row in range(3):
                var y := 0.11 + float(row) * 0.21
                var shift := 0.16 if row % 2 == 1 else 0.0
                for i in range(4):
                    var x := (float(i) - 1.5) * 0.34 + shift
                    var bag := _shallow(Vector3(0.36, 0.2, d), base + axis * x + Vector3(0, y, 0),
                        _mat("container"))
                    bag.rotation.y = (float(_pick(o, slot * 11 + i + row * 3, 5)) - 2.0) * 0.05
        2:
            # Crate column, each crate turned slightly off the one below.
            var h := 0.62
            for i in range(2 + _pick(o, slot * 13 + 73, 2)):
                var c := _shallow(Vector3(0.66, h, d), base + Vector3(0, h * 0.5 + float(i) * h, 0),
                    _mat("container"))
                c.rotation.y = (float(_pick(o, slot * 3 + i, 7)) - 3.0) * 0.035
        3:
            # Ladder propped against the wall. Almost pure silhouette, and it
            # carries the eye up the facade rather than along the lane.
            var lh := 2.8
            for side in [-0.21, 0.21]:
                var rail: float = side
                _shallow(Vector3(0.07, lh, 0.07), base + axis * rail + Vector3(0, lh * 0.5, 0),
                    _mat("machinery"))
            for i in range(8):
                _shallow(Vector3(0.48, 0.045, 0.045),
                    base + Vector3(0, 0.3 + float(i) * 0.33, 0), _mat("machinery"))
        _:
            # Drums, half-buried in the wall so their depth costs nothing.
            for i in range(2):
                var dr := _shallow(Vector3(0.56, 0.88, d), base + axis * ((float(i) - 0.5) * 0.66)
                    + Vector3(0, 0.44, 0), _mat("machinery"))
                _shallow(Vector3(0.6, 0.05, d), base + axis * ((float(i) - 0.5) * 0.66)
                    + Vector3(0, 0.86, 0), _mat("kerb"))

## A shallow box that casts but adds nothing to the simulation.
func _shallow(size: Vector3, at: Vector3, mat: Material) -> MeshInstance3D:
    var mi := _box(size, at, mat, false)
    mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
    _detail(mi)
    return mi

## Small hardware bolted to a facade: conduit, junction boxes, vents.
##
## The upper two-thirds of every wall in the sector was empty. The references
## put six to twelve small attachments on a wall of this size, and they do more
## than fill space: each one is a hard-edged object of a different value from
## the render behind it, so it breaks the facade into readable pieces and gives
## the eye something to measure the building's size against.
##
## Everything here is a shallow box flat against the face, so it costs no
## collision. The count is bounded: past roughly a dozen per wall the facade
## stops reading as a wall and starts reading as noise, and a distant enemy
## silhouette becomes indistinguishable from a drainpipe.
func _wall_fixtures(o: Dictionary, size: Vector3, pos: Vector3) -> void:
    var along_x: bool = size.x >= size.z
    var span: float = size.x if along_x else size.z
    if span < 4.0 or size.y < 4.0:
        return
    var half_depth: float = (size.z if along_x else size.x) * 0.5
    var axis := Vector3(1.0, 0.0, 0.0) if along_x else Vector3(0.0, 0.0, 1.0)
    var normal := Vector3(0.0, 0.0, 1.0) if along_x else Vector3(1.0, 0.0, 0.0)

    for face in [1.0, -1.0]:
        var out: Vector3 = normal * face
        # A vertical conduit drop, full height, offset from the corner.
        if _pick(o, int(face) * 7 + 131, 2) == 0:
            var cx: float = (float(_pick(o, int(face) + 132, 9)) / 8.0 - 0.5) * (span - 1.2)
            var run := size.y - 0.9
            _face_box(Vector3(0.10, run, 0.10), pos + axis * cx + out * (half_depth + 0.06)
                + Vector3(0, run * 0.5 + 0.25, 0))
            # Saddle clamps down its length, which is what makes a pipe read
            # as fixed to a wall rather than drawn on one.
            for i in range(int(run / 1.4)):
                _face_box(Vector3(0.17, 0.07, 0.16),
                    pos + axis * cx + out * (half_depth + 0.05)
                    + Vector3(0, 0.9 + float(i) * 1.4, 0))
        # A horizontal conduit run at service height with boxes on it.
        if _pick(o, int(face) * 11 + 133, 3) != 0:
            var y := 2.3 + float(_pick(o, int(face) + 134, 4)) * 0.35
            var length: float = span * 0.62
            var mid: float = (float(_pick(o, int(face) + 135, 7)) / 6.0 - 0.5) * (span - length)
            var bar := Vector3(length, 0.075, 0.075) if along_x else Vector3(0.075, 0.075, length)
            _face_box(bar, pos + axis * mid + out * (half_depth + 0.05) + Vector3(0, y, 0))
            for i in range(2):
                var bx: float = mid + (float(i) - 0.5) * length * 0.55
                _face_box(Vector3(0.26, 0.34, 0.14),
                    pos + axis * bx + out * (half_depth + 0.08) + Vector3(0, y - 0.28, 0))
        # A louvred vent, high up.
        if _pick(o, int(face) * 13 + 136, 3) == 0:
            var vx: float = (float(_pick(o, int(face) + 137, 9)) / 8.0 - 0.5) * (span - 1.8)
            var vy: float = size.y - 1.5
            var frame := Vector3(0.78, 0.62, 0.11) if along_x else Vector3(0.11, 0.62, 0.78)
            _face_box(frame, pos + axis * vx + out * (half_depth + 0.05) + Vector3(0, vy, 0),
                "machinery")
            for i in range(5):
                var slat := Vector3(0.70, 0.05, 0.15) if along_x else Vector3(0.15, 0.05, 0.70)
                _face_box(slat, pos + axis * vx + out * (half_depth + 0.06)
                    + Vector3(0, vy - 0.22 + float(i) * 0.11, 0), "kerb")

## Beyond this, small dressing stops being drawn.
##
## The sector builds about ten thousand mesh instances and Godot does not batch
## them, so every one is a draw call. Most are centimetres across -- saddle
## clamps, mullions, junction boxes -- and contribute nothing past a few tens
## of metres, but they were being submitted from anywhere in the level. On a
## phone that is most of the frame budget spent on things too small to see.
##
## Only the small stuff takes this. Walls, cover and rooflines are what the
## player navigates by and are never culled.
const DETAIL_FADE := 38.0
const DETAIL_FADE_MARGIN := 6.0

func _detail(mi: GeometryInstance3D) -> GeometryInstance3D:
    mi.visibility_range_end = DETAIL_FADE
    mi.visibility_range_end_margin = DETAIL_FADE_MARGIN
    mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
    return mi

func _face_box(size: Vector3, at: Vector3, mat: String = "machinery") -> void:
    var mi := _box(size, at, _mat(mat), false)
    mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
    _detail(mi)

## A canopy projecting from the facade, well above head height.
##
## Awnings are the cheapest overhead structure there is and they do two things
## nothing at ground level can: they put a hard horizontal shadow across a wall
## that would otherwise be a blank rectangle, and they give the lane a ceiling
## edge, which is most of how the references convey that a street is enclosed.
## At 3.2 m the underside clears any body in the simulation, so projecting a
## metre and a half into the lane costs no collision at all.
func _awning(o: Dictionary, size: Vector3, pos: Vector3) -> void:
    if size.y < 6.0 or _pick(o, 81, 3) != 0:
        return
    var along_x: bool = size.x >= size.z
    var span: float = size.x if along_x else size.z
    if span < 6.0:
        return
    var half_depth: float = (size.z if along_x else size.x) * 0.5
    var axis := Vector3(1.0, 0.0, 0.0) if along_x else Vector3(0.0, 0.0, 1.0)
    var normal := Vector3(0.0, 0.0, 1.0) if along_x else Vector3(1.0, 0.0, 0.0)
    var face := 1.0 if _pick(o, 82, 2) == 0 else -1.0
    var t := (float(_pick(o, 83, 9)) / 8.0 - 0.5) * (span - 4.2)
    var width := 2.6 + float(_pick(o, 84, 4)) * 0.45
    var reach := 1.35
    var y := 3.2
    var anchor: Vector3 = Vector3(pos.x, y, pos.z) + axis * t + normal * half_depth * face
    # The canopy itself, tipped down away from the wall so it sheds.
    var deck := _shallow(Vector3(width, 0.09, reach),
        anchor + normal * face * (reach * 0.5) + Vector3(0, -0.14, 0), _mat("container"))
    var tilt: float = 0.13 * face * (1.0 if along_x else -1.0)
    deck.rotate_object_local(axis, tilt)
    # A fascia board along the open edge, which is what gives it a silhouette
    # from underneath rather than a thin invisible sliver.
    _shallow(Vector3(width, 0.22, 0.07) if along_x else Vector3(0.07, 0.22, width),
        anchor + normal * face * reach + Vector3(0, -0.25, 0), _mat("kerb"))
    # Diagonal stays back to the wall.
    for side in [-1.0, 1.0]:
        var sx: float = side * (width * 0.5 - 0.12)
        var stay := _shallow(Vector3(0.07, 0.9, 0.07),
            anchor + axis * sx + normal * face * (reach * 0.5) + Vector3(0, 0.22, 0),
            _mat("machinery"))
        stay.rotate_object_local(axis, 0.95 * face * (1.0 if along_x else -1.0))

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

## A projected marking, or a flat quad standing in for one.
##
## `surface` is how far the marking's own surface lies from `pos` along the
## projection direction, which is the node's local -Y. It is only read by the
## quad fallback, which has no projection volume to work with and has to be
## placed on the surface itself.
func _decal(name: String, pos: Vector3, size: Vector3, rot: Vector3 = Vector3.ZERO,
        energy: float = 1.0, fade: float = 0.35, surface: float = -1.0) -> void:
    var tex := _decal_tex(name)
    if tex == null:
        return
    if not GameData.has_rendering_device():
        _decal_quad(tex, pos, size, rot, energy, surface)
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

## Compatibility has no Decal node, so the marking becomes a textured quad.
##
## It is a worse thing than a decal in one specific way: a decal wraps onto
## whatever geometry lies inside its box, while a quad is flat and will float
## over anything that is not. That is acceptable here because every marking in
## this sector is painted on a floor or a wall face, both of which are flat.
## The quad is laid on that surface rather than hovering at the decal's origin,
## and pushed 2 cm proud of it so it does not fight the surface for depth.
func _decal_quad(tex: Texture2D, pos: Vector3, size: Vector3, rot: Vector3,
        energy: float, surface: float) -> void:
    var mesh := PlaneMesh.new()
    # A Decal projects down its local -Y, so its footprint is its X by its Z
    # and a PlaneMesh, which faces +Y over exactly those two axes, matches it.
    mesh.size = Vector2(size.x, size.z)
    var mi := MeshInstance3D.new()
    mi.mesh = mesh
    mi.rotation_degrees = rot
    # How far down the projection axis the surface sits. Floor markings are
    # authored well above the paving so their box reaches it, so without this
    # they would hang in the air at knee height.
    var drop: float = surface if surface >= 0.0 else maxf(0.0, pos.y - 0.02)
    # Build the basis from the euler angles directly. Reading global_transform
    # here returns identity and logs an error, because the node has not been
    # added to the tree yet -- and the position being computed is what decides
    # where to add it.
    var basis := Basis.from_euler(Vector3(
        deg_to_rad(rot.x), deg_to_rad(rot.y), deg_to_rad(rot.z)))
    mi.position = pos - basis.y.normalized() * (drop - 0.02)
    var m := StandardMaterial3D.new()
    m.albedo_texture = tex
    m.albedo_color = Color(1.0, 1.0, 1.0, clampf(energy, 0.0, 1.0))
    m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    m.cull_mode = BaseMaterial3D.CULL_DISABLED
    m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
    mi.material_override = m
    mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    add_child(mi)

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
        # Small and faded. At 9.5 m across and 0.85 opacity the room name was
        # the highest-contrast element in the frame -- brighter than the
        # operative's own weapon -- and painted floor lettering is never the
        # thing a player should be reading first. Worn stencil, not signage.
        _decal("label_%d" % i, Vector3(cx, 0.35, cz - 3.2), Vector3(5.4, 1.2, 1.7), Vector3.ZERO, 0.30)
        _decal("number_%d" % i, Vector3(cx + 5.6, 0.35, cz + 1.4), Vector3(2.0, 1.2, 2.0), Vector3(0, 12.0, 0), 0.32)

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
                _decal("streak", at, Vector3(2.0, 1.0, tall * 0.7), rot, 0.55, 0.5, 0.05)
            # Soot at the base, where the ground meets the wall.
            if _pick(o, idx * 13 + int(face) * 2, 2) == 0:
                continue
            var t2 := (float(_pick(o, idx * 17 + 3, 7)) / 6.0 - 0.5) * (span - 4.0)
            var ground: Vector3 = Vector3(cx, 0.35, cz) + axis * t2 + normal * (half_depth + 1.6) * face
            _decal("scorch", ground, Vector3(4.6, 1.2, 4.6), Vector3(0, float(_pick(o, idx, 8)) * 45.0, 0), 0.8)
            _decal("stain", ground + axis * 2.4, Vector3(3.2, 1.2, 3.2),
                Vector3(0, float(_pick(o, idx * 3, 8)) * 45.0, 0), 0.7)

# ---- Merging ---------------------------------------------------------------

## Combine the static geometry into a few large meshes.
##
## Every solid, kerb, sill, pipe and crate in this file is its own
## MeshInstance3D, and every prop is a scene of a dozen more. That came to
## 10,207 nodes and 2,422 draw calls for a single static view. Godot does not
## batch MeshInstance3D nodes, so that is 2,422 draw calls on any device -- and
## on the browser build, which runs the GL Compatibility renderer over WebGL2
## with no render thread and a validation cost on every call, it is most of the
## frame. The player's report was the frame freezing, hostiles stopping, and
## rounds and their reports coming out only occasionally.
##
## So once everything is placed, the surfaces are baked into combined meshes.
## Each node's transform is folded into its vertices, which is exact: these are
## rigid transforms of static geometry, nothing here is skinned or animated and
## nothing moves after this runs. Hostiles are spawned by the game later and
## are not children of this node, so they are untouched.
##
## Three things have to survive the merge.
##
## Culling: one mesh for the whole sector would be one draw call and would also
## submit every wall in the level from every viewpoint. So groups are cut into
## chunks on the ground plane, and each merged mesh sits at its chunk's centre
## with a tight AABB, so the frustum still discards what is behind the camera
## and the shadow splits still discard what is beyond their range.
##
## Texturing: this file's own materials are world-space triplanar, so a
## vertex's texture coordinate is decided by where it is in the world rather
## than by any UV. Baking to world space and offsetting the merged node so the
## vertices land back where they were is therefore pixel-identical -- which is
## why the chunk centre is subtracted out of the vertices and added back as the
## node's position, rather than the mesh simply being built in world space. The
## props' own materials are UV-mapped instead, and append_from carries their
## UVs across unchanged.
##
## Grouping: everything that distinguishes two surfaces has to be in the key,
## because anything sharing a key becomes indistinguishable. That is the
## material, the shadow setting, the fade distance -- and the vertex format,
## since SurfaceTool builds one format per surface and appending a mesh with
## different attributes to it would corrupt the result.
const MERGE_CHUNK := 26.0

## One surface of one mesh instance, with where it goes.
class MergeItem:
    var node: MeshInstance3D
    var mesh: Mesh
    var surface: int
    var xform: Transform3D

func _merge_static() -> void:
    var groups: Dictionary = {}          ## key -> Array[MergeItem]
    var settings: Dictionary = {}        ## key -> the node state to carry over
    var candidates: Array[MeshInstance3D] = []
    var inv := global_transform.affine_inverse()

    for node in _descendants(self):
        if not (node is MeshInstance3D):
            continue
        var mi: MeshInstance3D = node
        if mi.mesh == null or mi.mesh.get_surface_count() == 0:
            continue
        # A skinned surface is posed by its skeleton every frame, so its
        # vertices are not where the mesh says they are and baking one is
        # meaningless. None exist here today; this keeps that true by
        # construction rather than by assumption.
        #
        # The test is for a Skeleton3D specifically, not for the path being
        # set. MeshInstance3D.skeleton defaults to "..", which resolves to the
        # node's own parent and is never null, so testing the path alone
        # excluded every mesh in the sector -- the merge ran, reported four
        # thousand surfaces combined, and left the two thousand four hundred
        # draw calls it was written to remove exactly where they were.
        if mi.get_node_or_null(mi.skeleton) is Skeleton3D:
            continue
        var local := inv * mi.global_transform
        var taken := 0
        for si in range(mi.mesh.get_surface_count()):
            var mat := _surface_material(mi, si)
            if mat == null:
                continue
            # Transparent surfaces are sorted back to front per object, so
            # merging them would freeze their draw order into whatever the
            # combined mesh happens to hold. There are few -- the floor
            # markings and the window glass -- so they stay as they are.
            var std := mat as BaseMaterial3D
            if std != null and std.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
                continue
            var origin := local.origin
            # surface_get_format lives on ArrayMesh only. Every PrimitiveMesh
            # -- the boxes, planes, spheres and cylinders the bridge builds
            # with -- shares one vertex format, so they take a single sentinel
            # that cannot collide with a real format value. Asking a PlaneMesh
            # for its format is what broke the first bridge build outright.
            var fmt := -1
            if mi.mesh is ArrayMesh:
                fmt = int((mi.mesh as ArrayMesh).surface_get_format(si))
            var key := "%d_%d_%d_%d_%d_%.2f_%.2f_%d" % [
                mat.get_instance_id(),
                int(floor(origin.x / MERGE_CHUNK)),
                int(floor(origin.z / MERGE_CHUNK)),
                fmt,
                int(mi.cast_shadow),
                mi.visibility_range_end,
                mi.visibility_range_end_margin,
                int(mi.visibility_range_fade_mode)]
            var item := MergeItem.new()
            item.node = mi
            item.mesh = mi.mesh
            item.surface = si
            item.xform = local
            if not groups.has(key):
                groups[key] = []
                settings[key] = {
                    "material": mat,
                    "cast_shadow": mi.cast_shadow,
                    "range_end": mi.visibility_range_end,
                    "range_margin": mi.visibility_range_end_margin,
                    "fade_mode": mi.visibility_range_fade_mode,
                }
            groups[key].append(item)
            taken += 1
        if taken > 0:
            candidates.append(mi)

    var made := 0
    var merged_surfaces := 0
    var absorbed: Dictionary = {}        ## MeshInstance3D -> surfaces merged away
    for key in groups:
        var items: Array = groups[key]
        # A surface on its own merges into itself. Skip the rebuild and leave
        # the node that owns it to keep drawing it.
        if items.size() < 2:
            continue
        var cfg: Dictionary = settings[key]
        var centre := Vector3.ZERO
        for it in items:
            centre += (it as MergeItem).xform.origin
        centre /= float(items.size())
        var shift := Transform3D(Basis.IDENTITY, -centre)
        var st := SurfaceTool.new()
        st.begin(Mesh.PRIMITIVE_TRIANGLES)
        for it in items:
            var item: MergeItem = it
            st.append_from(item.mesh, item.surface, shift * item.xform)
            absorbed[item.node] = int(absorbed.get(item.node, 0)) + 1
        var merged := MeshInstance3D.new()
        merged.mesh = st.commit()
        merged.position = centre
        merged.material_override = cfg["material"]
        merged.cast_shadow = cfg["cast_shadow"]
        merged.visibility_range_end = cfg["range_end"]
        merged.visibility_range_end_margin = cfg["range_margin"]
        merged.visibility_range_fade_mode = cfg["fade_mode"]
        add_child(merged)
        made += 1
        merged_surfaces += items.size()

    # A node goes only once every surface it drew is drawn by a merged mesh.
    # One that kept a transparent surface, or whose group was too small to
    # merge, stays and keeps drawing what it still owns -- otherwise the
    # geometry would simply disappear, or be drawn twice.
    var freed := 0
    for mi in candidates:
        if int(absorbed.get(mi, 0)) != mi.mesh.get_surface_count():
            continue
        mi.get_parent().remove_child(mi)
        mi.free()
        freed += 1
    print("MERGE %d surfaces -> %d meshes, %d nodes freed" % [merged_surfaces, made, freed])

## Which material actually draws a surface: the node's override, then its
## per-surface override, then whatever the mesh itself carries.
func _surface_material(mi: MeshInstance3D, surface: int) -> Material:
    if mi.material_override != null:
        return mi.material_override
    var over := mi.get_surface_override_material(surface)
    if over != null:
        return over
    return mi.mesh.surface_get_material(surface)


# ---- CROSSFALL SPAN --------------------------------------------------------
#
# A suspension crossing rather than a street, so almost none of the sector
# dressing above applies: there are no facades, no rooflines, no awnings and
# no alleys. What the 2D simulation hands over is still the same list of
# rectangles, and it is already bridge-shaped -- a single 3465-unit room, two
# `parapet` walls running the full length of the deck, five PAIRS of structure
# lights in sodium (#ffd095) down both edges, and containers and barriers
# scattered across the roadway. So the job here is to read those as what they
# are: barriers, lamp posts and wrecks on a road deck over open water.
#
# Everything this adds that the simulation does not know about obeys the same
# rule the sector does. Towers and cables stand outside the parapets or far
# above head height; wrecks sit exactly on the cover rectangles the simulation
# already collides with; the water is below the deck. Nothing new blocks a
# sightline the simulation thinks is open.

const DECK_Y := 0.0
## How far below the deck the water sits, and how far out it runs. The mockups
## put the camera close enough to the parapet to see water on both sides, and
## the far shore is a glow rather than a line.
const WATER_DROP := 26.0
const WATER_SPAN := 900.0

## Materials built from the map's OWN palette rather than the street sector's.
##
## The first built bridge reused kerb, machinery and brick, which are the
## daylight sector's sandy limestone and warm steel. Under sodium lamps they
## glowed beige, and no amount of light tuning would bring the frame's
## saturation or its red-to-blue ratio down, because the surfaces themselves
## were warm. CROSSFALL authored its own: #141d26 deck, #233140 steel, #6d93ad
## edges, #8fb8dd accent -- a cold blue-grey set, which is what the mockups
## are made of.
##
## Everything is darkened further and roughness dropped, because every
## horizontal surface in those mockups is soaked: wet concrete is roughly half
## the albedo of dry and reflects far more sharply.
var _bmat: Dictionary = {}

## A colour reduced to its hue, at unit mean, so a reflectance can be applied
## to it without inheriting the palette's own brightness.
## The tint that makes a textured material land on a chosen reflectance.
##
## Capped just under 1.0: a tint above unity multiplies the texture past what a
## dielectric can reflect, which is physically impossible and blows highlights.
func _tint(target: float, texture_mean: float) -> float:
    return minf(0.98, target / maxf(0.01, texture_mean))

func _hue_of(c: Color) -> Color:
    var m: float = maxf(0.001, (c.r + c.g + c.b) / 3.0)
    # Half-way to neutral. At full chroma the palette's cast is fine on a
    # near-black surface and far too strong once the albedo is realistic --
    # saturation measured 0.417 against a 0.404 ceiling as the materials came
    # up. Real wet concrete under sodium and cloud is only slightly blue.
    const CHROMA := 0.5
    return Color(lerpf(1.0, c.r / m, CHROMA), lerpf(1.0, c.g / m, CHROMA),
        lerpf(1.0, c.b / m, CHROMA))

func _bridge_mat(key: String) -> Material:
    if _bmat.has(key):
        return _bmat[key]
    # Built on the real PBR sets rather than as flat colours.
    #
    # The bridge shipped its first six rounds with untextured materials, and
    # the measurements said so in three places at once: fine surface variation
    # of 0.024 against the mockups' 0.064 to 0.089, large-scale contrast of
    # 0.167 against their 0.074 to 0.107, and 48 percent of the frame crushed
    # to black against their 15 to 32. All one fault. With no normal map and
    # no roughness variation every pixel is either inside a lamp's pool or it
    # is nothing, so the frame is all extremes and no middle -- which is
    # exactly what those three numbers describe.
    #
    # The tints come from the map's own palette and the sets are the ones the
    # street sector already generates. Wet is carried in the roughness and the
    # tint rather than in a separate material: soaked concrete is about half
    # the albedo of dry and far glossier.
    # The palette gives the HUE; the albedo values are physical.
    #
    # This is the mistake that kept the crushed share at 41 percent through
    # five separate fixes. #141d26 and #233140 are the 2D game's canvas FILL
    # colours -- they are what a pixel ends up as on screen in a top-down
    # game, already lit. Used as albedos in a 3D renderer they are multiplied
    # by an albedo texture and then by the light reaching them, so a deck
    # authored at 0.078 came out under 0.06 everywhere a lamp did not reach.
    # Highlighting the crushed pixels showed it plainly: the road, the towers
    # and the parapets were the crushed region, which is to say every built
    # surface in the frame.
    #
    # So each palette entry is normalised to its hue and multiplied by a
    # reflectance the material actually has. Wet asphalt is about 0.18 dry-
    # equivalent, concrete 0.40, painted steel 0.32. Those are the numbers
    # that put a surface in the 0.11 to 0.16 the mockups hold their deck at.
    # A tint is a MULTIPLIER on the albedo texture, which already carries the
    # material's own reflectance. Getting that wrong is what kept the deck
    # black through seven attempted fixes.
    #
    # The previous pass reasoned correctly that wet asphalt is about 0.20
    # reflectance and then passed 0.20 as the TINT -- where it was multiplied
    # by the asphalt texture's own 0.217, giving 0.043. Every bridge material
    # was between two and five times too dark for the same reason, and no
    # amount of adjusting ambient, fog, occlusion or the water could recover
    # it, because none of those were the term that was wrong.
    #
    # Proved by experiment rather than by argument: forcing the road tint to
    # 0.90 took the crushed share from 40.8 percent to 22.7, inside the band,
    # and put the road at 0.1195 against the mockups' 0.112 to 0.116.
    #
    # So the tint is now derived -- target reflectance divided by the
    # texture's measured mean -- and each target is what the real surface has.
    # The measured means are from the generated sets and are stable because
    # make-textures.py is seeded.
    #
    # The uv scales are in tiles per metre and are much finer than the street
    # sector's. patch is the MEDIAN contrast inside a 48-pixel window and
    # micro is what a blur at 4.5 percent of the frame removes -- both ask for
    # features SMALLER than a window. At 0.22 tiles per metre the deck showed
    # one tile every 4.5 m, which at this camera is a smooth gradient across
    # several windows and reads to both metrics as a flat polygon: patch
    # measured 0.036 against a floor of 0.064 even after the frame stopped
    # being black. Finer tiling puts one to two full cycles of grain in every
    # window, which is what a photograph of wet asphalt actually contains.
    var wall_hue := _hue_of(level.pal("wall", Color(0.137, 0.192, 0.251)))
    var floor_hue := _hue_of(level.pal("floor", Color(0.078, 0.114, 0.149)))
    var m: StandardMaterial3D
    match key:
        "concrete":
            m = MaterialsC.pbr("concrete", 1.15, wall_hue * _tint(0.34, 0.385), 0.12)
            m.roughness = 0.52
        "tower":
            m = MaterialsC.pbr("concrete", 0.85, wall_hue * _tint(0.40, 0.385), 0.08)
            m.roughness = 0.58
        "steel":
            m = MaterialsC.pbr("steel", 1.90, wall_hue * _tint(0.28, 0.473), 0.55)
            m.roughness = 0.38
        "rust":
            m = MaterialsC.pbr("paintwork", 1.60,
                Color(1.10, 0.95, 0.84) * _tint(0.24, 0.572), 0.25)
            m.roughness = 0.62
        "panel":
            m = MaterialsC.pbr("blockwork", 1.45, floor_hue * _tint(0.26, 0.534), 0.30)
            m.roughness = 0.42
        "road":
            m = MaterialsC.pbr("asphalt", 1.35, floor_hue * _tint(0.105, 0.217), 0.0)
            m.roughness = 0.26
        _:
            m = MaterialsC.pbr("concrete", 1.15, wall_hue * _tint(0.30, 0.385), 0.1)
    m.metallic_specular = 0.80
    # World triplanar, as the sector uses, so nothing needs UVs and the grain
    # stays continuous across the joins between deck, kerb and girder.
    m.uv1_triplanar = true
    m.uv1_world_triplanar = true
    _bmat[key] = m
    return m

func _build_bridge() -> void:
    var w := level.metres(level.width)
    var h := level.metres(level.height)
    _bridge_water(w, h)
    _bridge_deck(w, h)
    _bridge_solids()
    _bridge_towers(w, h)
    _bridge_lamps()
    _bridge_wrecks()
    _bridge_fires()
    _bridge_skyline(w, h)
    _bridge_helicopter(w, h)
    _merge_static()
    _bridge_probe(w, h)

## The probe that gives the wet deck something to reflect.
##
## Built LAST, and not allowed to touch ambient.
##
## It used to be created inside _bridge_deck, which runs before the lamps, the
## fires, the towers and the skyline exist -- and with UPDATE_ONCE it captures
## the scene at that moment, so it captured an empty black bridge and then
## imposed that on every surface inside its box. The controlled experiment
## that found the albedo error also removed this probe, and the two together
## reached 22.7 percent crushed where the albedo fix alone reaches 36.5: the
## probe was costing about fourteen points on its own.
##
## AMBIENT_DISABLED because the environment's ambient is the deck's main light
## on this map and a probe set to AMBIENT_ENVIRONMENT replaces it inside the
## box with its own captured version.
## Off by default.
##
## Rebuilding it last and disabling its ambient recovered only 0.7 points of
## crushed share, against the 14 the controlled experiment implied -- and the
## experiment removed it entirely. The wet deck's look is carried by the
## reflection streaks and by roughness, not by this, and the browser build
## runs Compatibility where probe support is weaker anyway. Kept as code
## because it is the right tool if the deck ever needs true reflections, and
## gated so the reason is on the record rather than in a deleted diff.
const USE_PROBE := false

func _bridge_probe(w: float, h: float) -> void:
    if not USE_PROBE:
        return
    var probe := ReflectionProbe.new()
    probe.size = Vector3(w * 0.5, 40.0, h)
    probe.position = Vector3(w * 0.5, 9.0, h * 0.5)
    probe.update_mode = ReflectionProbe.UPDATE_ONCE
    probe.intensity = 0.9
    probe.max_distance = 260.0
    probe.ambient_mode = ReflectionProbe.AMBIENT_DISABLED
    add_child(probe)

func _bridge_water(w: float, h: float) -> void:
    var m := StandardMaterial3D.new()
    # Near-black, and smooth enough to carry the lamps and the fire as long
    # vertical streaks. In the mockups the water is almost entirely reflection
    # -- there is no diffuse colour in it at all at this hour.
    # Not as black as it looks from a photograph.
    #
    # This plane was authored at albedo 0.012 with metallic 0.55, on the
    # reasoning that river water at night is almost pure reflection. That is
    # true of the water's COLOUR and false of its brightness: a metallic
    # surface reflects what is above it, and what is above this one is an
    # overcast sky, so the reflection is the sky's own luminance rather than
    # black. Rendered, it came out under 0.06 across the whole outer third of
    # the frame -- 97.6 percent of one cell and 76 percent of another -- while
    # the mockups hold their water between 0.08 and 0.15, carrying the city's
    # glow and the running lights of boats.
    #
    # It is a large area and it was never revisited after being created, which
    # is most of why the crushed share would not fall below 41 percent no
    # matter what was done to the deck.
    m.albedo_color = Color(0.052, 0.066, 0.092)
    m.metallic = 0.25
    m.roughness = 0.24
    m.metallic_specular = 0.85
    var plane := PlaneMesh.new()
    plane.size = Vector2(WATER_SPAN, WATER_SPAN)
    var mi := MeshInstance3D.new()
    mi.mesh = plane
    mi.material_override = m
    mi.position = Vector3(w * 0.5, -WATER_DROP, h * 0.5)
    mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    add_child(mi)

## The roadway itself: one slab between the parapets, with lane markings.
func _bridge_deck(w: float, h: float) -> void:
    # Wet asphalt, which is the single largest thing in every mockup and where
    # most of the light in those frames actually comes from: the road is close
    # to a mirror, and every lamp, fire and tail light is doubled in it as a
    # long streak running toward the camera.
    #
    # Godot has no screen-space reflection, and the browser build runs the
    # Compatibility renderer where even less is available, so this is built
    # from the two things that do work everywhere -- a low-roughness metallic
    # surface with a probe to reflect, and the streaks themselves as geometry.
    var road := StandardMaterial3D.new()
    road.albedo_color = Color(0.018, 0.020, 0.024)
    road.metallic = 0.42
    road.roughness = 0.13
    road.metallic_specular = 0.9
    var deck := _box(Vector3(w + 2.0, 0.55, h * 0.70),
        Vector3(w * 0.5, -0.275, h * 0.5), road, true, 0.5)
    deck.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    # The underside, so the deck reads as a structure with thickness when seen
    # from the parapet rather than as a plane floating on the water.
    _box(Vector3(w + 2.0, 2.2, h * 0.72), Vector3(w * 0.5, -1.6, h * 0.5),
        _bridge_mat("steel"), false)
    # Box girders under the deck, which is what a suspension span actually
    # hangs from and what the mockups show in silhouette against the water.
    for i in range(3):
        var z := h * 0.5 + (i - 1) * h * 0.22
        _box(Vector3(w, 1.6, 0.9), Vector3(w * 0.5, -2.6, z), _bridge_mat("steel"), false)
    # Lane markings. Long dashes down the centre of a six-lane deck: in the
    # mockups these are the brightest thing on the road other than the
    # reflections, because wet paint throws light straight back.
    var paint := StandardMaterial3D.new()
    paint.albedo_color = Color(0.40, 0.39, 0.36)
    paint.roughness = 0.42
    # A probe over the deck, so the metallic road has something to reflect.
    # Without one a metallic surface reflects the environment sky only, which
    # at night is nearly black, and the road goes flat matte no matter what
    # its roughness says.
    # Puddles: scattered specular hits on a dark road.
    #
    # This is where the mockups' road contrast actually comes from, and three
    # rounds of adding albedo texture detail could never have produced it.
    # Measured on the same 48-pixel windows the band uses, the mockup's road
    # has a median contrast of 0.716 while this build's had 0.318 -- and the
    # mockup's road is DARKER, at a mean of 0.186 against 0.348. A wet road at
    # night is not a mid-grey surface with grain on it; it is a near-black
    # surface carrying dozens of small bright reflections of every light in
    # the scene, and the contrast between those two is the whole look.
    #
    # So the base albedo comes down and these go on top: small additive cards
    # lying in the road, scattered deterministically from the footprint hash,
    # taking their colour from whichever source is nearest -- sodium from the
    # lamps, orange from the fires ahead.
    # More of them, smaller and dimmer.
    #
    # The first pass proved the mechanism -- micro reached band for the first
    # time in twenty-six rounds and patch moved further than under any of the
    # three grain-based attempts -- and then overshot on brightness: the 95th
    # percentile went from 0.455 to 0.631 and the clipped share from 0.843 to
    # 1.177 percent. patch wants MORE contrast inside a window, not less, so
    # the answer is not simply to dim them: it is to keep the count of bright
    # points up while cutting how much of the frame each one covers. Half the
    # energy, two thirds the size, half again as many.
    var puddle_n := int(w * 5.0)
    for i in range(puddle_n):
        var hx := _hash64(i * 6367 + 11)
        var hz := _hash64(i * 9283 + 29)
        var hs := _hash64(i * 4517 + 71)
        var px: float = float(hx % 10000) / 10000.0 * w
        var pz: float = h * 0.5 + (float(hz % 10000) / 10000.0 - 0.5) * h * 0.55
        var warm: float = float(hs % 100) / 100.0
        # Ahead of the player the fires dominate; behind, the lamps do.
        var col := Color(1.0, 0.78, 0.50).lerp(Color(1.0, 0.50, 0.22),
            clampf(1.0 - px / (w * 0.6), 0.0, 1.0) * warm)
        var length: float = 1.1 + float(hs % 37) * 0.145
        var width: float = 0.20 + float(hx % 23) * 0.024
        # Raised 1.6x now that `energy` scales the additive albedo as well as
        # the emission. Before that fix these were adding close to 1.0 at
        # their cores whatever this number said; with it honest, the same
        # number produced a far subtler puddle and micro and patch fell out of
        # band with it. The 95th percentile is at 0.413 against a ceiling of
        # 0.445, so this spends that headroom on the two detail statistics.
        _wet_streak(Vector3(px, 0.0, pz), col, length, width,
            0.034 + float(hz % 17) * 0.0042)

    var lanes := 4
    var n := int(w / 5.5)
    for lane in range(lanes):
        var z := h * 0.5 + (float(lane) - (lanes - 1) * 0.5) * (h * 0.60 / float(lanes))
        for i in range(n):
            var x := 1.0 + i * 5.5
            if int(i + lane) % 3 == 0:
                continue
            var strip := _box(Vector3(2.6, 0.02, 0.16), Vector3(x, 0.02, z), paint, false)
            strip.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            _detail(strip)

## Parapets become steel railings rather than walls, and everything else the
## simulation calls a wall stays a solid so collision is unchanged.
## The reflection streaks under every light on the deck.
##
## A wet road does not reflect a lamp as a dot, it reflects it as a long tapering
## streak running toward the viewer, because the surface is rippled along the
## direction of travel. That streak is a huge share of the lit area in all
## three mockups -- more of the frame than the lamps themselves -- and no
## amount of roughness tuning produces it, because the effect comes from the
## surface's anisotropy rather than from its gloss.
##
## So they are drawn: an additive card lying on the deck under each source,
## long in X (down the span, which is where the camera looks from) and narrow
## in Z. They sit 3 cm above the road and cast nothing.
## The falloff a streak fades out with, built once and shared.
##
## The first version was an untextured additive quad, which is a SOLID slab of
## light with four hard edges -- it clipped 7.3 percent of the frame to white
## against a band of 0.016 to 0.240 and read as a river of lava lying on the
## road rather than as a reflection. A reflection has no edges at all: it is
## brightest directly under the source and falls to nothing along its length
## and across its width, and it is broken up lengthwise by the ripple that
## made it a streak in the first place.
static var _streak_tex: ImageTexture = null

static func streak_texture() -> ImageTexture:
    if _streak_tex != null:
        return _streak_tex
    const W := 160
    const H := 48
    var img := Image.create(W, H, false, Image.FORMAT_RGBAF)
    for y in range(H):
        # Across the width: a smooth bell, zero at both edges.
        var v := (float(y) / float(H - 1)) * 2.0 - 1.0
        var across: float = pow(maxf(0.0, 1.0 - v * v), 1.6)
        for x in range(W):
            # Along the length: brightest at the source end, trailing away.
            var u := float(x) / float(W - 1)
            var along: float = pow(maxf(0.0, 1.0 - u), 1.9)
            # Ripple, so the streak breaks into bands the way a real one does
            # on moving water rather than being a smooth wedge.
            var ripple: float = 0.72 + 0.28 * sin(u * 34.0) * sin(u * 11.0 + 1.3)
            var a: float = across * along * ripple
            img.set_pixel(x, y, Color(1.0, 1.0, 1.0, a))
    _streak_tex = ImageTexture.create_from_image(img)
    return _streak_tex

func _wet_streak(at: Vector3, colour: Color, length: float, width: float, energy: float) -> void:
    var m := StandardMaterial3D.new()
    # The albedo is scaled by the energy too, not just the emission.
    #
    # On an ADDITIVE material the albedo term is added at full strength
    # wherever the falloff texture's alpha approaches 1, so a streak core was
    # adding the whole colour -- close to 1.0 -- no matter what `energy` said.
    # The parameter was only ever controlling the emission half, and the
    # albedo half blew out unchecked: that is why raising the puddle count
    # pushed the clipped share up from 0.752 to 0.907 while their nominal
    # energy was 0.02, and why cutting every emissive on the bridge below
    # unity in the same round did not show.
    m.albedo_color = Color(colour.r * energy, colour.g * energy,
        colour.b * energy, 1.0)
    m.albedo_texture = streak_texture()
    m.emission_enabled = true
    m.emission = colour
    m.emission_energy_multiplier = energy * 0.5
    m.emission_texture = streak_texture()
    m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
    m.cull_mode = BaseMaterial3D.CULL_DISABLED
    m.disable_receive_shadows = true
    m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
    var q := PlaneMesh.new()
    q.size = Vector2(length, width)
    var mi := MeshInstance3D.new()
    mi.mesh = q
    mi.material_override = m
    mi.position = Vector3(at.x, 0.03, at.z)
    mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    add_child(mi)

func _bridge_solids() -> void:
    for o in level.walls:
        var t := String(o.get("type", "wall"))
        var ow := level.metres(float(o["w"]))
        var oh := level.metres(float(o["h"]))
        var pos := Vector3(level.metres(float(o["x"])), 0.0, level.metres(float(o["y"])))
        if t == "parapet":
            _bridge_railing(pos, ow, oh)
        elif t == "perimeter":
            # The ends of the span. Kept solid, since the simulation stops the
            # operative there, but low and concrete rather than a building.
            _box(Vector3(ow, 2.4, oh), pos + Vector3(0, 1.2, 0), _bridge_mat("concrete"), true)
        else:
            _box(Vector3(ow, 2.0, oh), pos + Vector3(0, 1.0, 0), _bridge_mat("steel"), true)

## A concrete kerb with a steel rail above it, which is the section every
## mockup shows along both edges of the deck.
func _bridge_railing(pos: Vector3, ow: float, oh: float) -> void:
    var long_axis := ow > oh
    var length: float = ow if long_axis else oh
    var thick: float = oh if long_axis else ow
    # The kerb is the part the simulation collides with, so it keeps the
    # footprint it was given.
    _box(Vector3(ow, 1.15, oh), pos + Vector3(0, 0.575, 0), _bridge_mat("concrete"), true)
    var ax := Vector3(1, 0, 0) if long_axis else Vector3(0, 0, 1)
    var steel := _bridge_mat("steel")
    # Two horizontal rails and a post every 2.4 m. Posts are inside the kerb's
    # own footprint, so they add nothing the simulation does not already stop.
    for y in [1.55, 2.05]:
        var rail := _box(Vector3(ow if long_axis else 0.09, 0.09, 0.09 if long_axis else oh),
            pos + Vector3(0, y, 0), steel, false)
        rail.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    var posts := int(length / 2.4)
    for i in range(posts):
        var t := (float(i) + 0.5) / float(posts) - 0.5
        var at := pos + ax * (t * length) + Vector3(0, 1.6, 0)
        var p := _box(Vector3(0.10, 1.0, 0.10), at, steel, false)
        p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        _detail(p)

## Two towers, the main cables between them, the suspenders, and the strings
## of lamps along the cables that every mockup leads with.
func _bridge_towers(w: float, h: float) -> void:
    var steel := _bridge_mat("steel")
    var conc := _bridge_mat("concrete")
    var z0 := level.metres(196.56)
    var z1 := level.metres(895.44)
    var tower_x := [w * 0.22, w * 0.78]
    const TOWER_H := 46.0
    for tx in tower_x:
        for tz in [z0, z1]:
            # Leg, tapering in two stages.
            _box(Vector3(3.2, TOWER_H * 0.55, 3.2), Vector3(tx, TOWER_H * 0.275, tz),
                _bridge_mat("tower"), true)
            _box(Vector3(2.6, TOWER_H * 0.45, 2.6),
                Vector3(tx, TOWER_H * 0.55 + TOWER_H * 0.225, tz), _bridge_mat("tower"), false)
        # Cross braces between the legs, and the arch the mockups frame the
        # far span through.
        for y in [TOWER_H * 0.42, TOWER_H * 0.70]:
            _box(Vector3(2.4, 1.8, z1 - z0), Vector3(tx, y, (z0 + z1) * 0.5), _bridge_mat("tower"), false)
        _box(Vector3(2.8, 3.0, z1 - z0 + 3.0), Vector3(tx, TOWER_H - 1.5, (z0 + z1) * 0.5),
            _bridge_mat("tower"), false)
        # A red aircraft warning lamp on each tower, which is the only pure
        # red in the mockups' upper half.
        var warn := OmniLight3D.new()
        warn.position = Vector3(tx, TOWER_H + 1.0, (z0 + z1) * 0.5)
        warn.light_color = Color(1.0, 0.16, 0.12)
        warn.light_energy = 3.0
        warn.omni_range = 18.0
        warn.shadow_enabled = false
        add_child(warn)

    # Main cables: a catenary from tower top to tower top, sagging toward the
    # deck at midspan, plus the back-stays running down to the deck ends.
    for tz in [z0, z1]:
        _bridge_cable(tower_x[0], tower_x[1], TOWER_H, tz, w, true)
        _bridge_cable(-w * 0.10, tower_x[0], TOWER_H, tz, w, false)
        _bridge_cable(tower_x[1], w * 1.10, TOWER_H, tz, w, false)

func _cable_y(x: float, x0: float, x1: float, top: float, sag: float) -> float:
    var t: float = clampf((x - x0) / maxf(0.001, x1 - x0), 0.0, 1.0)
    # A parabola is close enough to a catenary at this span and costs nothing.
    return top - sag * 4.0 * t * (1.0 - t)

func _bridge_cable(x0: float, x1: float, top: float, z: float, w: float, main: bool) -> void:
    var steel := _bridge_mat("steel")
    var sag := (x1 - x0) * 0.22 if main else 0.0
    var segs := int(absf(x1 - x0) / 2.2)
    var prev := Vector3(x0, top if main else 1.6, z)
    for i in range(1, segs + 1):
        var t := float(i) / float(segs)
        var x: float = x0 + (x1 - x0) * t
        var y: float = _cable_y(x, x0, x1, top, sag) if main \
            else lerpf(top if x0 > x1 else 1.6, 1.6 if x0 > x1 else top, t)
        var here := Vector3(x, y, z)
        var mid := (prev + here) * 0.5
        var span := here - prev
        var seg := _box(Vector3(span.length(), 0.22, 0.22), mid, steel, false)
        seg.rotation = Vector3(0.0, 0.0, atan2(span.y, span.x))
        seg.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        prev = here
    if not main:
        return
    # Suspenders down to the deck, and the string of lamps along the cable.
    var lamp := StandardMaterial3D.new()
    lamp.albedo_color = Color(1.0, 0.86, 0.62)
    lamp.emission_enabled = true
    lamp.emission = Color(1.0, 0.84, 0.58)
    lamp.emission_energy_multiplier = 0.98
    lamp.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    var drops := int(absf(x1 - x0) / 4.4)
    for i in range(1, drops):
        var x: float = x0 + (x1 - x0) * (float(i) / float(drops))
        var y := _cable_y(x, x0, x1, top, sag)
        var hang := _box(Vector3(0.09, y - 2.2, 0.09), Vector3(x, (y + 2.2) * 0.5, z), steel, false)
        hang.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        _detail(hang)
        # Every other suspender carries a lamp, which is the dotted catenary
        # of lights running up to the tower in all three mockups.
        if i % 2 == 0:
            var bulb := SphereMesh.new()
            bulb.radius = 0.16
            bulb.height = 0.32
            bulb.radial_segments = 6
            bulb.rings = 4
            var b := MeshInstance3D.new()
            b.mesh = bulb
            b.material_override = lamp
            b.position = Vector3(x, y - 0.45, z)
            b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            add_child(b)

## Lamp posts on the deck, at the positions the simulation authored.
func _bridge_lamps() -> void:
    var steel := _bridge_mat("steel")
    var head := StandardMaterial3D.new()
    head.albedo_color = Color(0.9, 0.78, 0.55)
    head.emission_enabled = true
    head.emission = Color(1.0, 0.80, 0.52)
    head.emission_energy_multiplier = 0.95
    head.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    # The simulation authored five pairs over 115 m of deck, which is one lamp
    # every 23 m per side -- correct for a real bridge but far short of what
    # the mockups carry, where the receding row of lamps is the thing that
    # gives the span its depth. So each authored light is kept exactly where
    # the simulation put it, and two more are interpolated between it and the
    # next. Lamp posts stand on the parapet line, outside the roadway, so they
    # block nothing the simulation thinks is open.
    var posts: Array = []
    for l in level.lights:
        posts.append([Vector2(float(l["x"]), float(l["y"])), String(l.get("color", "#ffd095")),
            float(l.get("radius", 205))])
    var extra: Array = []
    for i in range(posts.size()):
        for j in range(posts.size()):
            if i == j:
                continue
            var a: Vector2 = posts[i][0]
            var b: Vector2 = posts[j][0]
            if absf(a.y - b.y) > 1.0 or b.x <= a.x:
                continue
            if b.x - a.x > 800.0:
                continue
            for k in [1, 2]:
                extra.append([a.lerp(b, float(k) / 3.0), posts[i][1], posts[i][2]])
    posts.append_array(extra)
    for entry in posts:
        var at := level.to_world(entry[0], 0.0)
        var col := Color(String(entry[1]))
        var mast := _box(Vector3(0.22, 8.0, 0.22), at + Vector3(0, 4.0, 0), steel, false)
        mast.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        # The arm reaches in over the roadway, which is what throws the long
        # pool of light down the wet deck.
        var inward: float = 1.0 if at.z < level.metres(level.height) * 0.5 else -1.0
        var arm := _box(Vector3(0.16, 0.16, 2.6), at + Vector3(0, 7.9, inward * 1.3), steel, false)
        arm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        var hd := MeshInstance3D.new()
        var q := BoxMesh.new()
        q.size = Vector3(0.5, 0.18, 0.9)
        hd.mesh = q
        hd.material_override = head
        hd.position = at + Vector3(0, 7.75, inward * 2.5)
        hd.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        add_child(hd)
        var lamp := OmniLight3D.new()
        lamp.position = at + Vector3(0, 7.5, inward * 2.5)
        lamp.light_color = col
        # 9.5 put a pool of pure white under every post.
        #
        # This was the invariant behind three rounds of chasing the wrong
        # emitter: the clipped fraction sat at 1.156 percent while the
        # searchlight came down from 14 to 4.5 to 2.6 and the streaks halved
        # twice, because none of those were producing it. Mapping the clipped
        # pixels found one blob filling 21 percent of the bottom-left cell at
        # (0.998, 1.0, 1.0) -- the nearest lamp's own pool, made worse in the
        # same round by the road's albedo going up 2.4 times underneath it.
        lamp.light_energy = 4.2
        lamp.omni_range = level.metres(float(entry[2])) * 2.0
        lamp.omni_attenuation = 1.15
        lamp.shadow_enabled = false
        add_child(lamp)

## Every cover rectangle the simulation placed becomes a wrecked vehicle.
##
## They keep the footprint they were given, so what stops the operative is
## still exactly what the 2D game stops them on. The type decides the shape: a
## container is a box truck or a bus, a barrier is a car or a jersey block.
func _bridge_wrecks() -> void:
    var body := _bridge_mat("steel")
    var rust := _bridge_mat("rust")
    var glass := _bridge_mat("panel")
    var tyre := StandardMaterial3D.new()
    tyre.albedo_color = Color(0.020, 0.020, 0.022)
    tyre.roughness = 0.92
    var tail := StandardMaterial3D.new()
    tail.albedo_color = Color(0.35, 0.03, 0.03)
    tail.emission_enabled = true
    tail.emission = Color(1.0, 0.07, 0.05)
    tail.emission_energy_multiplier = 1.05
    tail.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

    var idx := 0
    for c in level.cover:
        idx += 1
        var cw := level.metres(float(c["w"]))
        var ch := level.metres(float(c["h"]))
        var at := Vector3(level.metres(float(c["x"])), 0.0, level.metres(float(c["y"])))
        var kind := String(c.get("type", "barrier"))
        var long_x := cw > ch
        var yaw := 0.0 if long_x else PI * 0.5
        # A wreck sitting dead straight on the lane reads as parked, not as
        # abandoned under fire, so each is canted a little off the axis. The
        # angle comes from the footprint hash, so it is the same every run.
        yaw += (float(_pick(c, 37, 9)) - 4.0) * 0.045
        if kind == "container":
            _wreck_truck(at, maxf(cw, ch), minf(cw, ch), yaw, body, rust, glass, tyre, tail, idx)
        else:
            _wreck_car(at, maxf(cw, ch), minf(cw, ch), yaw, body, glass, tyre, tail, idx)

func _wreck_car(at: Vector3, length: float, width: float, yaw: float,
        body: Material, glass: Material, tyre: Material, tail: Material, idx: int) -> void:
    var h := 0.72
    var b := _box(Vector3(length, h, width), at + Vector3(0, h * 0.5, 0), body, true)
    b.rotation.y = yaw
    # Cabin, set back and narrower, which is the whole of a car's silhouette
    # at this distance.
    var cab := _box(Vector3(length * 0.46, 0.52, width * 0.86),
        at + Vector3(0, h + 0.26, 0), glass, false)
    cab.rotation.y = yaw
    var roof := _box(Vector3(length * 0.42, 0.10, width * 0.80),
        at + Vector3(0, h + 0.54, 0), body, false)
    roof.rotation.y = yaw
    for sx in [-1.0, 1.0]:
        for sz in [-1.0, 1.0]:
            var off := Vector3(cos(yaw) * sx * length * 0.33 - sin(yaw) * sz * width * 0.46,
                0.30, sin(yaw) * sx * length * 0.33 + cos(yaw) * sz * width * 0.46)
            var wheel := cyl_node(0.30, 0.18, at + off, tyre)
            wheel.rotation = Vector3(0.0, yaw, PI * 0.5)
            _detail(wheel)
    # Tail lights, which are most of the red in the mockups' middle distance.
    # Tail lights are a point of red in the distance, not a light source.
    #
    # Giving every other wreck a real omni at 2.2 over 5.5 m flooded the whole
    # deck: the frame measured a saturation of 0.554 against the mockups' 0.21
    # to 0.40 and a red-to-blue ratio of 1.84 against their 0.83 to 1.40. In
    # the mockups the tail lights are small hot points that light the wet road
    # directly under the bumper and nothing else. So the lamp is gone and only
    # the emissive card remains, on a quarter of the wrecks rather than half.
    if idx % 4 == 0:
        var off2 := Vector3(-cos(yaw) * length * 0.5, h * 0.62, -sin(yaw) * length * 0.5)
        var t := _box(Vector3(0.10, 0.12, width * 0.26), at + off2, tail, false)
        t.rotation.y = yaw
        t.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _wreck_truck(at: Vector3, length: float, width: float, yaw: float,
        body: Material, rust: Material, glass: Material, tyre: Material,
        tail: Material, idx: int) -> void:
    var h := 1.35
    var box_len := length * 0.62
    var cargo := _box(Vector3(box_len, 2.5, width), at + Vector3(0, h + 1.25, 0), rust, true)
    cargo.rotation.y = yaw
    var chassis := _box(Vector3(length, h, width * 0.9), at + Vector3(0, h * 0.5, 0), body, true)
    chassis.rotation.y = yaw
    var cabin := _box(Vector3(length * 0.26, 1.5, width * 0.92),
        at + Vector3(cos(yaw) * length * 0.36, h + 0.75, sin(yaw) * length * 0.36), body, false)
    cabin.rotation.y = yaw
    var wind := _box(Vector3(0.10, 0.7, width * 0.78),
        at + Vector3(cos(yaw) * length * 0.485, h + 1.0, sin(yaw) * length * 0.485), glass, false)
    wind.rotation.y = yaw
    # Ribs down the cargo body, which is what stops a box truck being a box.
    var ribs := int(box_len / 0.75)
    for i in range(ribs):
        var t := (float(i) + 0.5) / float(ribs) - 0.5
        var off := Vector3(cos(yaw) * t * box_len, h + 1.25, sin(yaw) * t * box_len)
        var rib := _box(Vector3(0.09, 2.4, width + 0.06), at + off, body, false)
        rib.rotation.y = yaw
        rib.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        _detail(rib)
    for sx in [-0.34, 0.30]:
        for sz in [-1.0, 1.0]:
            var off2 := Vector3(cos(yaw) * sx * length - sin(yaw) * sz * width * 0.5,
                0.42, sin(yaw) * sx * length + cos(yaw) * sz * width * 0.5)
            var wheel := cyl_node(0.42, 0.24, at + off2, tyre)
            wheel.rotation = Vector3(0.0, yaw, PI * 0.5)
            _detail(wheel)

## A cylinder as a node, since _box only makes boxes and wheels are the one
## place on this map where that shows.
func cyl_node(r: float, depth: float, at: Vector3, mat: Material) -> MeshInstance3D:
    var m := CylinderMesh.new()
    m.top_radius = r
    m.bottom_radius = r
    m.height = depth
    m.radial_segments = 10
    var mi := MeshInstance3D.new()
    mi.mesh = m
    mi.material_override = mat
    mi.position = at
    mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    add_child(mi)
    return mi

## The burning wrecks in the middle distance, which are the brightest thing in
## every mockup and the reason the deck ahead is lit at all.
##
## Placed on cover rectangles rather than anywhere, so a fire is always
## something that is actually burning rather than a light floating over open
## road, and only on the far half of the span so the player is looking INTO
## them down the deck.
func _bridge_fires() -> void:
    var w := level.metres(level.width)
    var flame := StandardMaterial3D.new()
    flame.albedo_color = Color(1.0, 0.42, 0.10)
    flame.emission_enabled = true
    flame.emission = Color(1.0, 0.44, 0.12)
    flame.emission_energy_multiplier = 1.30
    flame.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    flame.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED

    var placed := 0
    for c in level.cover:
        var x := level.metres(float(c["x"]))
        if x > w * 0.55 or placed >= 5:
            continue
        placed += 1
        var at := Vector3(x, 0.0, level.metres(float(c["y"])))
        # The body of fire: a stack of shrinking emissive blocks. Cheap, and
        # at this distance through rain haze it reads as a fire rather than as
        # geometry, which a single quad never does.
        for i in range(5):
            var t := float(i) / 4.0
            var s := lerpf(2.2, 0.7, t)
            var f := _box(Vector3(s, s * 0.9, s),
                at + Vector3(sin(t * 7.0) * 0.5, 1.0 + t * 3.4, cos(t * 5.0) * 0.5),
                flame, false)
            f.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        # Two lights per fire: a hot close one and a wide one that reaches the
        # deck and the parapets, which is what puts the orange down the road.
        for spec in [[3.2, 13.0, 2.0], [1.3, 34.0, 8.0]]:
            var lamp := OmniLight3D.new()
            lamp.position = at + Vector3(0.0, spec[2], 0.0)
            lamp.light_color = Color(1.0, 0.46, 0.16)
            lamp.light_energy = spec[0]
            lamp.omni_range = spec[1]
            lamp.shadow_enabled = false
            add_child(lamp)
        # The fire doubled in the road, which in the mockups runs most of the
        # way back down the deck toward the player.
        _wet_streak(at, Color(1.0, 0.46, 0.17), 74.0, 5.5, 0.060)
        # Smoke: a dark column leaning with the map's own wind.
        var smoke := StandardMaterial3D.new()
        # Lit from below by the fire under it, as the mockups' columns are:
        # warm and relatively bright at the base, cooling and thinning with
        # height. Flat near-black smoke over the upper centre of the frame is
        # a large part of why those cells measured 56 to 71 percent crushed.
        smoke.albedo_color = Color(0.150, 0.105, 0.078, 0.50)
        smoke.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
        smoke.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
        smoke.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
        var wind := level.wind()
        for i in range(7):
            var t := float(i) / 6.0
            var q := QuadMesh.new()
            q.size = Vector2(lerpf(3.0, 12.0, t), lerpf(3.0, 12.0, t))
            var s := MeshInstance3D.new()
            s.mesh = q
            s.material_override = smoke
            var cool: float = 1.0 - t * 0.72
            var sm: StandardMaterial3D = smoke.duplicate()
            sm.albedo_color = Color(0.150 * cool + 0.030, 0.105 * cool + 0.030,
                0.078 * cool + 0.034, 0.50 - t * 0.18)
            s.material_override = sm
            s.position = at + Vector3(wind * t * 16.0, 4.0 + t * 26.0, sin(t * 3.0) * 2.0)
            s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            add_child(s)

## The city across the water: a band of dark blocks with lit windows.
##
## It is scenery, far outside the deck and far below head height from the
## player's position, so it blocks nothing. Without it the mockups' horizon --
## a low glittering line under a black sky -- is just black.
func _bridge_skyline(w: float, h: float) -> void:
    var block := StandardMaterial3D.new()
    block.albedo_color = Color(0.020, 0.024, 0.034)
    block.roughness = 0.9
    var win := StandardMaterial3D.new()
    win.albedo_color = Color(0.55, 0.50, 0.36)
    win.emission_enabled = true
    win.emission = Color(1.0, 0.86, 0.58)
    win.emission_energy_multiplier = 0.92
    win.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    for side in [-1.0, 1.0]:
        var z: float = h * 0.5 + side * 260.0
        for i in range(46):
            var seed := int(i * 7919 + (1 if side > 0 else 0) * 104729)
            var r := float(_hash64(seed) % 1000) / 1000.0
            var r2 := float(_hash64(seed + 17) % 1000) / 1000.0
            var bw := 9.0 + r * 22.0
            var bh := 14.0 + r2 * 74.0
            var x := -120.0 + i * (w + 240.0) / 46.0 + r * 18.0
            var zz: float = z + (r2 - 0.5) * 90.0
            var b := _box(Vector3(bw, bh, bw * 0.8), Vector3(x, bh * 0.5 - WATER_DROP, zz), block, false)
            b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            # Lit windows, as one emissive strip per few floors rather than as
            # individual panes -- at this distance they merge anyway.
            var floors := int(bh / 6.0)
            for f in range(floors):
                if (_hash64(seed + f * 31) % 100) < 42:
                    continue
                var wy := 4.0 + f * 6.0 - WATER_DROP
                var s := MeshInstance3D.new()
                var q := BoxMesh.new()
                q.size = Vector3(bw * 0.86, 1.5, 0.3)
                s.mesh = q
                s.material_override = win
                s.position = Vector3(x, wy, zz - side * bw * 0.42)
                s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
                add_child(s)

## A gunship holding over the water, with its searchlight on the span.
##
## Every mockup has one: a dark silhouette against the cloud with a hard cone
## of light under it, sweeping the deck or the water. It does more than fill
## the sky -- the cone is the only light in those frames that comes from above
## and outside the bridge, and it is what stops the upper half of the image
## being an empty black lid.
##
## It flies a slow circuit rather than hovering. A static helicopter reads as
## a prop hung in the air; the movement is what sells it, and at this distance
## a simple orbit is indistinguishable from a patrol pattern.
class Helicopter:
    extends Node3D

    var speed := 0.06
    var radius := 0.0
    var centre := Vector3.ZERO
    var height := 0.0
    var phase := 0.0
    var rotor: Node3D = null
    var tail_rotor: Node3D = null
    var beam: Node3D = null

    func _process(delta: float) -> void:
        phase += delta * speed
        var at := centre + Vector3(cos(phase) * radius, height, sin(phase) * radius * 0.45)
        global_position = at
        # Nose along the direction of travel, banked into the turn.
        var fwd := Vector3(-sin(phase), 0.0, cos(phase) * 0.45).normalized()
        rotation = Vector3(0.0, atan2(fwd.x, fwd.z), -0.16)
        if rotor:
            rotor.rotation.y += delta * 34.0
        if tail_rotor:
            tail_rotor.rotation.x += delta * 52.0

func _bridge_helicopter(w: float, h: float) -> void:
    var heli := Helicopter.new()
    # Placed to be IN the shot rather than merely present. The first attempt
    # orbited 95 m off the span's centreline at a 62 m radius, which is where
    # a real patrol would fly and which put it outside the frame from every
    # viewpoint on the deck. The mockups all keep it high and roughly 30
    # degrees off the axis the player is looking down, close enough that the
    # airframe reads and the beam reaches the water.
    heli.centre = Vector3(w * 0.26, 0.0, h * 0.5 + 30.0)
    heli.radius = 26.0
    heli.height = 44.0
    heli.phase = 2.4
    add_child(heli)

    var dark := StandardMaterial3D.new()
    # Almost black. In the mockups the airframe is a silhouette -- the only
    # thing that reads on it is the searchlight and the running lights.
    dark.albedo_color = Color(0.022, 0.026, 0.032)
    dark.roughness = 0.62
    dark.metallic = 0.35

    var body := MeshInstance3D.new()
    var bm := BoxMesh.new()
    bm.size = Vector3(2.4, 2.0, 5.4)
    body.mesh = bm
    body.material_override = dark
    heli.add_child(body)

    var nose := MeshInstance3D.new()
    var nm := BoxMesh.new()
    nm.size = Vector3(1.7, 1.3, 2.0)
    nose.mesh = nm
    nose.material_override = dark
    nose.position = Vector3(0.0, -0.25, 3.2)
    heli.add_child(nose)

    var boom := MeshInstance3D.new()
    var tm := BoxMesh.new()
    tm.size = Vector3(0.55, 0.6, 6.0)
    boom.mesh = tm
    boom.material_override = dark
    boom.position = Vector3(0.0, 0.35, -5.0)
    heli.add_child(boom)

    var fin := MeshInstance3D.new()
    var fm := BoxMesh.new()
    fm.size = Vector3(0.22, 2.2, 1.2)
    fin.mesh = fm
    fin.material_override = dark
    fin.position = Vector3(0.0, 1.3, -7.6)
    heli.add_child(fin)

    for sx in [-1.0, 1.0]:
        var skid := MeshInstance3D.new()
        var sm := BoxMesh.new()
        sm.size = Vector3(0.16, 0.16, 4.2)
        skid.mesh = sm
        skid.material_override = dark
        skid.position = Vector3(sx * 1.1, -1.4, 0.2)
        heli.add_child(skid)

    # Rotor discs rather than blades. At this range individual blades alias
    # into a flicker; a thin disc with a low alpha is what a spinning rotor
    # actually looks like from a kilometre off.
    var disc_mat := StandardMaterial3D.new()
    disc_mat.albedo_color = Color(0.06, 0.07, 0.085, 0.30)
    disc_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    disc_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    disc_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
    var rotor := Node3D.new()
    rotor.position = Vector3(0.0, 1.5, 0.0)
    heli.add_child(rotor)
    heli.rotor = rotor
    for i in range(2):
        var blade := MeshInstance3D.new()
        var qm := BoxMesh.new()
        qm.size = Vector3(11.0, 0.06, 0.55)
        blade.mesh = qm
        blade.material_override = disc_mat
        blade.rotation.y = float(i) * PI * 0.5
        rotor.add_child(blade)

    var trot := Node3D.new()
    trot.position = Vector3(0.36, 1.3, -7.6)
    heli.add_child(trot)
    heli.tail_rotor = trot
    for i in range(2):
        var blade := MeshInstance3D.new()
        var qm := BoxMesh.new()
        qm.size = Vector3(0.06, 2.4, 0.3)
        blade.mesh = qm
        blade.material_override = disc_mat
        blade.rotation.x = float(i) * PI * 0.5
        trot.add_child(blade)

    # Running lights: one red to port, one white on the fin. These are tiny
    # and they are most of what says "aircraft" rather than "dark shape".
    for spec in [[Vector3(-1.3, 0.1, 0.8), Color(1.0, 0.10, 0.08)],
                 [Vector3(1.3, 0.1, 0.8), Color(0.10, 1.0, 0.25)],
                 [Vector3(0.0, 2.3, -7.6), Color(1.0, 0.96, 0.9)]]:
        var m := StandardMaterial3D.new()
        m.albedo_color = spec[1]
        m.emission_enabled = true
        m.emission = spec[1]
        m.emission_energy_multiplier = 1.05
        m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
        var b := MeshInstance3D.new()
        var s := SphereMesh.new()
        s.radius = 0.16
        s.height = 0.32
        s.radial_segments = 6
        s.rings = 4
        b.mesh = s
        b.material_override = m
        b.position = spec[0]
        heli.add_child(b)

    # The searchlight. A real spot, so it lands on the deck and the water and
    # moves with the aircraft.
    var spot := SpotLight3D.new()
    # Aimed outboard, over the water, not down onto the roadway.
    #
    # Three rounds were spent cutting this light's energy -- 14, then 4.5,
    # then 2.6 -- while the clipped fraction sat unmoved at 1.06 to 1.16
    # percent. Cutting energy was never going to work: at an 11 degree cone
    # the output is concentrated into a few square metres, so the pool stays
    # saturated at any energy that leaves it visible at all. And because the
    # aircraft orbits, that pool lands somewhere different in every capture,
    # which is why it kept reappearing after each fix.
    #
    # In the mockups the beam is over the WATER beside the span, seen as a
    # shaft through the rain, and what it lights is a patch of river. So it
    # points outboard and down, spread over four times the area.
    spot.position = Vector3(0.6, -1.2, 1.6)
    spot.rotation_degrees = Vector3(-52.0, 34.0, 0.0)
    spot.spot_angle = 21.0
    spot.light_color = Color(0.86, 0.92, 1.0)
    # 14 put a blown white pool on the deck covering nearly a quarter of the
    # bottom-left of the frame. In the mockups the beam is a shaft you can see
    # THROUGH the rain with a soft ellipse at its foot -- it lights the deck,
    # it does not bleach it.
    spot.light_energy = 1.1
    spot.spot_range = 150.0
    spot.spot_angle_attenuation = 0.6
    spot.shadow_enabled = false
    heli.add_child(spot)

    # And the beam itself, because a spot in rain is visible as a solid shaft
    # and Godot's Compatibility renderer has no volumetric fog to make one.
    var beam_mat := StandardMaterial3D.new()
    beam_mat.albedo_color = Color(0.72, 0.82, 1.0, 0.05)
    beam_mat.emission_enabled = true
    beam_mat.emission = Color(0.72, 0.82, 1.0)
    beam_mat.emission_energy_multiplier = 0.12
    beam_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    beam_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    beam_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
    beam_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
    beam_mat.disable_receive_shadows = true
    var cone := MeshInstance3D.new()
    var cm := CylinderMesh.new()
    cm.top_radius = 0.5
    cm.bottom_radius = 13.0
    cm.height = 72.0
    cm.radial_segments = 12
    cone.mesh = cm
    cone.material_override = beam_mat
    cone.position = Vector3(0.6, -1.2, 1.6) + Vector3(20.0, -30.0, 14.0)
    cone.rotation_degrees = Vector3(38.0, -34.0, 0.0)
    cone.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    heli.add_child(cone)
