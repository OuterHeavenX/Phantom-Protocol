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
    key.light_color = Color(1.0, 0.92, 0.80)
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
    key.light_energy = 1.35
    key.omni_range = 1.4
    key.shadow_enabled = false
    key.light_cull_mask = VM_LAYER
    add_child(key)

    # A cool rim from upper right, so the silhouette holds against a bright
    # pavement without warming the shadow side.
    var rim := OmniLight3D.new()
    rim.position = Vector3(0.26, 0.24, -0.10)
    rim.light_color = Color(0.78, 0.86, 1.0)
    rim.light_energy = 0.70
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
    position = REST_POS_FOR.get(id, REST_POS)
    rotation_degrees = REST_ROT_FOR.get(id, REST_ROT)
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
    var base: Vector3 = REST_POS.lerp(ADS_POS, _aim)
    position = base + Vector3(_sway.x, _sway.y, 0.0) + bob + Vector3(0.0, 0.0, _kick * 0.06)
    var r: Vector3 = REST_ROT * (1.0 - _aim * 0.85)
    rotation_degrees = r + Vector3(-_kick * 9.0, _sway.x * 45.0, _sway.y * 28.0)

    if flash.light_energy > 0.0:
        flash.light_energy = maxf(0.0, flash.light_energy - delta * 90.0)

func fire_kick(strength: float = 1.0) -> void:
    _kick = minf(_kick + 0.22 * strength, 0.5)
    flash.light_energy = 2.2 * strength
