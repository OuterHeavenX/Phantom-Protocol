class_name Viewmodel
extends Node3D

## The operative's weapon and hands, carried by the camera.
##
## Sway and bob are driven by how the camera is actually moving rather than by
## a free-running timer, so the weapon settles when the player does. A
## viewmodel that keeps swimming while you stand still is the clearest tell
## that a first-person view is faked.

const MODEL := "res://art/models/viewmodel_needle.glb"

## Rest pose, in camera space. Low and to the right, barrel angled a few
## degrees inboard so the suppressor reads across the frame rather than
## pointing at the vanishing point.
## At the previous offset the whole fist sat about 1.45 half-frames below
## centre: the hands were modelled, lit and completely off screen, with only a
## sliver of knuckle at the bottom edge. Higher and pushed forward puts the
## glove and cuff back in frame.
const REST_POS := Vector3(0.145, -0.105, -0.42)
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

var model: Node3D
var muzzle: Node3D
var flash: OmniLight3D
var _sway := Vector2.ZERO
var _bob := 0.0
var _kick := 0.0
var _aim := 0.0

func _ready() -> void:
    var packed := load(MODEL)
    if packed == null:
        push_error("Viewmodel missing: " + MODEL)
        return
    model = packed.instantiate()
    model.scale = Vector3.ONE * VM_SCALE
    add_child(model)
    position = REST_POS
    rotation_degrees = REST_ROT
    # The viewmodel must never cast into the world or receive the world's
    # shadows: at 30 cm from the near plane it would self-shadow into mush.
    for child in _all_descendants(model):
        if child is GeometryInstance3D:
            child.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

    # The weapon is the nearest object to the eye and the only one with no sky
    # above it, so scene ambient alone leaves it a black cutout -- measured at
    # 33% of its pixels under 0.12 luminance against the references' 3%. A dim
    # camera-parented key gives it form without lighting the world.
    var key := OmniLight3D.new()
    key.position = Vector3(-0.22, 0.30, 0.16)
    # Warm, to match the world. A blue-lit weapon in an amber street is
    # exactly what makes a viewmodel look composited in rather than held.
    key.light_color = Color(1.0, 0.92, 0.80)
    key.light_energy = 0.32
    key.omni_range = 1.4
    key.shadow_enabled = false
    add_child(key)

    # A dim cool rim from upper left, so the silhouette holds against a dark
    # background without warming the shadow side.
    var rim := OmniLight3D.new()
    rim.position = Vector3(0.26, 0.24, -0.10)
    rim.light_color = Color(0.78, 0.86, 1.0)
    rim.light_energy = 0.22
    rim.omni_range = 1.2
    rim.shadow_enabled = false
    add_child(rim)

    muzzle = Node3D.new()
    muzzle.position = Vector3(0.0, 0.0115, -0.19)
    add_child(muzzle)

    flash = OmniLight3D.new()
    flash.light_color = Color(1.0, 0.86, 0.62)
    flash.light_energy = 0.0
    flash.omni_range = 7.0
    flash.shadow_enabled = false
    muzzle.add_child(flash)

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
    flash.light_energy = 9.0 * strength
