class_name Viewmodel
extends Node3D

## The operative's weapon and hands, carried by the camera.
##
## Sway and bob are driven by how the camera is actually moving rather than by
## a free-running timer, so the weapon settles when the player does. A
## viewmodel that keeps swimming while you stand still is the clearest tell
## that a first-person view is faked.

## One model per weapon, because the references are all of a carbine or an SMG
## and the operative spends the test build holding the Vector. A suppressed
## pistol standing in for an SMG is the single most obvious thing wrong with a
## frame of this game next to a reference screenshot.
const MODEL := "res://art/models/viewmodel_needle.glb"
const MODELS := {
    "vector": "res://art/models/viewmodel_vector.glb",
}

## Where the barrel ends, in the viewmodel's own space with VM_SCALE already
## applied. The flash, the tracer origin and the report all hang off this, so a
## longer weapon needs its own or the muzzle flash goes off inside the
## handguard.
const MUZZLE := Vector3(0.0, 0.0115, -0.19)
const MUZZLES := {
    "vector": Vector3(0.0, 0.008, -0.325),
}

## The SMG is 60 cm from butt pad to flash hider against the pistol's 22, so it
## cannot sit where the pistol sat: at the pistol's rest pose the stock lands
## behind the camera and the weapon reads as a barrel floating in the corner.
## Pushed well forward of the pistol's. The SMG's stock sits 17 cm behind its
## own origin, so at the first rest pose the butt pad was 15 cm from the eye
## and filled the bottom-right sixth of the frame as a bare white slab.
const REST_POS_FOR := {
    "vector": Vector3(0.138, -0.168, -0.478),
}
const REST_ROT_FOR := {
    "vector": Vector3(-1.5, 5.0, 0.5),
}

## Rest pose, in camera space. Low and to the right, barrel angled a few
## degrees inboard so the suppressor reads across the frame rather than
## pointing at the vanishing point.
## At the previous offset the whole fist sat about 1.45 half-frames below
## centre: the hands were modelled, lit and completely off screen, with only a
## sliver of knuckle at the bottom edge. Higher and pushed forward puts the
## glove and cuff back in frame.
## Lowered from -0.105. The muzzle was sitting close to the horizon line, so
## the weapon competed with the sightline it is supposed to sit beneath; in the
## references the muzzle is always clearly below the crosshair.
const REST_POS := Vector3(0.172, -0.150, -0.42)
const REST_ROT := Vector3(-2.0, 6.0, 0.5)
const ADS_POS := Vector3(0.0, -0.050, -0.34)
## The weapon is authored at true scale. It needed scaling up while the camera
## was at 127 degrees horizontal; with the FOV corrected to a realistic 70
## vertical it is the right size on its own, and scaling geometry to fix a
## framing problem distorts the slide's perspective against the hand.
## Drawn through the world's 106-degree horizontal lens, a correctly-sized
## pistol spanned 43% of frame width against the references' 25%. Real shooters
## render the viewmodel through a narrower lens; this is the same correction
## expressed as one number.
const VM_SCALE := 0.78

## Render layer 2, reserved for the viewmodel. World lights clear this bit from
## their cull masks and the viewmodel's own lights set only this bit, so the
## two lighting rigs never touch each other.
const VM_LAYER := 1 << 1

var model: Node3D
var muzzle: Node3D
var flash: OmniLight3D
var _sway := Vector2.ZERO
var _bob := 0.0
var _kick := 0.0
var _aim := 0.0

var _weapon := ""
## The active weapon's rest pose, resolved once in use_weapon.
##
## These exist because the constants alone were dead code: use_weapon set the
## SMG's pose on the node, and update_motion then recomputed `position` from
## the pistol's REST_POS on the very next frame and every frame after. The
## SMG was drawn at the Needle's pose for every capture that followed, so the
## reframing that was supposed to get its stock out of the lens did nothing.
## Multiplies the rig, so the weapon sits in the scene's own exposure.
##
## The rig is deliberately independent of the world's lighting, which is what
## keeps a weapon readable in shade -- but independent is not the same as
## fixed. On the night bridge the unchanged rig made the weapon the brightest
## object in a frame whose band wants a mean of 0.15, and it read as a white
## prop held in front of a dark photograph.
var rig_scale := 1.0

## Extra key, spent only where the fill has been taken away.
var key_boost := 1.0

## How much of the key the opposite-side fill carries.
##
## The rig is two omnis 1.2 to 1.4 m apart on either side of a weapon held 40
## cm from the eye, so at equal energies they wrap it from both directions and
## the result is flat by construction -- which is what the night frames show:
## an evenly lit mid-grey object with no dark side. Every reference has a
## clear key side and a clear shadow side with only a thin rim opposite, and
## that value range across the largest near object in the picture is a real
## part of what the band's window deviation is measuring.
var fill_ratio := 1.0

var _rest_pos := REST_POS
var _rest_rot := REST_ROT

func _ready() -> void:
    _build_rig()
    use_weapon("")

## Muzzle marker and the two-light rig that lights the weapon on its own layer.
func _build_rig() -> void:
    # With the world's lights culled off the viewmodel layer, this rig is the
    # only thing lighting the weapon, so it carries the whole exposure rather
    # than topping up the sun. Warm key from the left, matching the sector's
    # own sun direction, because a blue-lit weapon in an amber street is
    # exactly what makes a viewmodel look composited in rather than held.
    var key := OmniLight3D.new()
    key.position = Vector3(-0.22, 0.30, 0.16)
    # Warm, to match the world. A blue-lit weapon in an amber street is
    # exactly what makes a viewmodel look composited in rather than held.
    key.light_color = Color(0.94, 0.96, 1.0)
    # Sky ambient is not cull-masked, so it still reaches the weapon and
    # already carries most of its exposure; this rig only has to add shape.
    # Set to 2.1 the glove blew to near-white at an albedo of 0.03, which is
    # the same overcorrection the sector's key light needed undoing from.
    #
    # Raised again once the reference was measured rather than eyeballed. The
    # weapon was rendering at a mean of 0.198 against the reference's 0.672,
    # and both this and the albedos were short -- the earlier retreat to 0.55
    # was a correct response to a blown GLOVE at albedo 0.03, not evidence
    # that the weapon was bright enough. The glove's albedo carries that now.
    key.light_energy = 0.85 * rig_scale * key_boost
    key.omni_range = 1.4
    key.shadow_enabled = false
    key.light_cull_mask = VM_LAYER
    add_child(key)

    # A cool rim from upper right, so the silhouette holds against a bright
    # pavement without warming the shadow side.
    var rim := OmniLight3D.new()
    rim.position = Vector3(0.26, 0.24, -0.10)
    rim.light_color = Color(0.78, 0.86, 1.0)
    rim.light_energy = 0.70 * rig_scale * fill_ratio
    rim.omni_range = 1.2
    rim.shadow_enabled = false
    rim.light_cull_mask = VM_LAYER
    add_child(rim)

    muzzle = Node3D.new()
    muzzle.position = MUZZLE
    add_child(muzzle)

    flash = OmniLight3D.new()
    flash.light_color = Color(1.0, 0.86, 0.62)
    flash.light_energy = 0.0
    # A 7 m range at energy 9, sitting 40 cm from the eye, is not a muzzle
    # flash: it floods the whole lower frame and the ground in front of the
    # operative, and on a weapon cycling every 0.2 s it is lit more than half
    # the time, so it reads as a lamp bolted to the barrel. Short and dim
    # enough to kick light onto what is close and nothing else.
    flash.omni_range = 3.2
    flash.shadow_enabled = false
    muzzle.add_child(flash)

## Swap in the model for a weapon id, or the sidearm when it has none.
##
## The weapon is not known when this node is built -- the operative's loadout
## is resolved a step later, when the contract starts -- so the model is loaded
## here and can be replaced once it is.
func use_weapon(id: String) -> void:
    if id == _weapon and model != null:
        return
    _weapon = id
    if model != null:
        model.queue_free()
        model = null
    var path: String = MODELS.get(id, MODEL)
    if not ResourceLoader.exists(path):
        path = MODEL
    var packed = load(path)
    if packed == null:
        push_error("Viewmodel missing: " + path)
        return
    model = packed.instantiate()
    model.scale = Vector3.ONE * VM_SCALE
    add_child(model)
    _rest_pos = REST_POS_FOR.get(id, REST_POS)
    _rest_rot = REST_ROT_FOR.get(id, REST_ROT)
    position = _rest_pos
    rotation_degrees = _rest_rot
    if muzzle != null:
        muzzle.position = MUZZLES.get(id, MUZZLE)
    # The viewmodel must never cast into the world or receive the world's
    # shadows: at 30 cm from the near plane it would self-shadow into mush.
    #
    # It also lives on its own render layer, and the world's lights are told
    # to skip that layer. A weapon held 30 cm from the eye receives the sun at
    # a grazing angle no world surface does, so when the key light was raised
    # for the sector the glove's highlights blew to white while its albedo was
    # still 0.03 -- the hand read as a row of pale sausages. Lighting the
    # viewmodel only from its own rig is how shooters keep a weapon looking
    # the same whether the player is in a sunlit street or a dark stairwell.
    for child in _all_descendants(model):
        if child is GeometryInstance3D:
            child.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            child.layers = VM_LAYER
    _texture_surfaces()

## Surface detail for every part of the weapon and the hands.
##
## build-viewmodel.py's `mat()` sets a base colour, a metallic and a roughness
## and nothing else, so each part of the model is one uniform value broken up
## only by its bevels. At the framing the references use, the weapon and the
## gloved hands are the largest and nearest objects in the frame, and that is
## the worst place in a picture to put a surface with nothing in it.
##
## It shows in the band too. `patch` is the median standard deviation inside a
## 48-pixel window; mapped over a 4 by 4 grid the whole remaining deficit sits
## in the bottom row, where the mockups measure 0.069 to 0.129 against 0.032
## here, and that row is mostly weapon in both. Raising the rig's light energy
## moved the number DOWN, which settles what the fault is: a better-lit
## featureless surface is a larger featureless surface.
##
## Applied here rather than in Blender because triplanar needs no UV unwrap
## and keeps the grain continuous across parts that were blocked out
## separately. The maps are multiplied onto whatever base colour the GLB
## already carries, so the value hierarchy the model was authored with --
## polymer darkest, metal mid, machined edges brightest -- survives.
## Tiles per metre, and much finer than a world surface: a receiver is 5 cm
## across, so 54 tiles per metre puts under three cycles over it and the
## texture's slowest features -- which are meant to be wear blotches a few
## centimetres wide on a wall -- become granite mottling on a gun.
##
## `vm_glove2` and `vm_cuff` are the parts actually in frame; the first pass
## listed `vm_glove` and `vm_sleeve` only and left both hands smooth grey.
const SURFACE_SETS := {
    "vm_poly": ["vmpolymer", 150.0], "vm_polymer": ["vmpolymer", 150.0],
    "vm_body": ["vmmetal", 165.0], "vm_body_dark": ["vmmetal", 165.0],
    "vm_steel": ["vmmetal", 190.0], "vm_steel2": ["vmmetal", 190.0],
    "vm_dark": ["vmmetal", 170.0], "vm_can": ["vmmetal", 150.0],
    "vm_accent": ["vmmetal", 180.0], "vm_accent2": ["vmmetal", 180.0],
    "vm_plate": ["vmmetal", 160.0],
    "vm_glove": ["vmglove", 175.0], "vm_glove2": ["vmglove", 175.0],
    "vm_strap": ["vmsleeve", 150.0], "vm_cuff": ["vmsleeve", 135.0],
    "vm_sleeve": ["vmsleeve", 135.0],
}

func _texture_surfaces() -> void:
    for child in _all_descendants(model):
        if not (child is MeshInstance3D):
            continue
        var mi := child as MeshInstance3D
        if mi.mesh == null:
            continue
        for si in range(mi.mesh.get_surface_count()):
            var src := mi.get_active_material(si)
            if not (src is BaseMaterial3D):
                continue
            var base := src as BaseMaterial3D
            var key := base.resource_name
            if key == "":
                key = String(mi.name)
            if OS.get_cmdline_user_args().has("vmdump"):
                print("VMMAT node=%s surf=%d resource_name='%s' class=%s" % [
                    mi.name, si, base.resource_name, base.get_class()])
            if not SURFACE_SETS.has(key):
                continue
            var entry: Array = SURFACE_SETS[key]
            var m: StandardMaterial3D = base.duplicate()
            var alb := _tex(entry[0], "albedo")
            if alb == null:
                continue
            # The set's albedo is centred near 0.3 to 0.44, so using it raw
            # would wash out a receiver authored at 0.10. Dividing the tint by
            # the set's mean keeps each part's authored value and lets the map
            # supply only the variation around it.
            var mean: float = float(SET_MEAN.get(entry[0], 0.35))
            var c := base.albedo_color
            m.albedo_color = Color(minf(1.0, c.r / mean), minf(1.0, c.g / mean),
                minf(1.0, c.b / mean), c.a)
            m.albedo_texture = alb
            var nrm := _tex(entry[0], "normal")
            if nrm != null:
                m.normal_enabled = true
                m.normal_texture = nrm
                m.normal_scale = 0.9
            var orm := _tex(entry[0], "orm")
            if orm != null:
                m.roughness_texture = orm
                m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
                m.roughness = 1.0
            m.uv1_triplanar = true
            m.uv1_world_triplanar = false
            m.uv1_scale = Vector3(entry[1], entry[1], entry[1])
            m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
            mi.set_surface_override_material(si, m)

## Mean albedo of each generated set, from make-viewmodel-textures.py.
const SET_MEAN := {
    "vmpolymer": 0.435, "vmmetal": 0.330, "vmglove": 0.236, "vmsleeve": 0.281,
}

static func _tex(set_name: String, slot: String) -> Texture2D:
    var path := "res://art/textures/%s_%s.png" % [set_name, slot]
    if not ResourceLoader.exists(path):
        return null
    return load(path)

func _all_descendants(n: Node) -> Array:
    var out: Array = []
    for c in n.get_children():
        out.append(c)
        out.append_array(_all_descendants(c))
    return out

## `look_delta` is this frame's mouse movement, `speed01` ground speed as a
## fraction of the operative's top speed.
func update_motion(delta: float, look_delta: Vector2, speed01: float, aiming: bool) -> void:
    _aim = move_toward(_aim, 1.0 if aiming else 0.0, delta * 6.0)
    _sway = _sway.lerp(look_delta * -0.9, clampf(delta * 12.0, 0.0, 1.0))
    _sway = _sway.limit_length(0.05)
    _bob += delta * speed01 * 9.0
    _kick = move_toward(_kick, 0.0, delta * 5.5)

    var bob := Vector3(cos(_bob) * 0.010, -absf(sin(_bob)) * 0.012, 0.0) * speed01
    var base: Vector3 = _rest_pos.lerp(ADS_POS, _aim)
    position = base + Vector3(_sway.x, _sway.y, 0.0) + bob + Vector3(0.0, 0.0, _kick * 0.06)
    var r: Vector3 = _rest_rot * (1.0 - _aim * 0.85)
    rotation_degrees = r + Vector3(-_kick * 9.0, _sway.x * 45.0, _sway.y * 28.0)

    if flash.light_energy > 0.0:
        flash.light_energy = maxf(0.0, flash.light_energy - delta * 90.0)

func fire_kick(strength: float = 1.0) -> void:
    _kick = minf(_kick + 0.22 * strength, 0.5)
    flash.light_energy = 2.2 * strength
