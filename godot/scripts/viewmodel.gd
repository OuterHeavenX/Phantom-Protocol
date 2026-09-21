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
const REST_POS := Vector3(0.132, -0.148, -0.335)
const REST_ROT := Vector3(-2.0, 5.5, 1.5)
const ADS_POS := Vector3(0.0, -0.052, -0.235)
## The weapon is authored at true scale (a 9.8 cm slide). Held that close to a
## 90-degree camera it reads smaller than the references, where the sidearm
## fills most of the lower right. Games solve this by drawing the viewmodel
## with its own narrow FOV; scaling it up here is the same trick with one
## number instead of a second camera.
const VM_SCALE := 1.35

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
