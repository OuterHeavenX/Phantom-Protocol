class_name Player
extends CharacterBody3D

## First-person operative.
##
## The numbers are the 2D game's: 212 world units per second, a 13-unit body
## radius, a 0.18 s dash on a 1.15 s cooldown. They are converted once through
## Level.PLAN_SCALE so the operative crosses the sector in the same time the
## 2D build takes, which is what the five-minute contract was tuned against.
## What changes is the camera and the input mapping, not the movement model.

const MOUSE_SENS := 0.0022
const DASH_TIME := 0.18
const DASH_COOLDOWN := 1.15
const DASH_SPEED_MULT := 3.2
const ACCEL := 14.0
const AIR_ACCEL := 3.0

var speed_mps: float = 6.6
var eye_height: float = 1.7
var dash_timer: float = 0.0
var dash_cooldown: float = 0.0
var dash_dir: Vector3 = Vector3.ZERO
var look_locked: bool = false

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D

var _bob := 0.0
var _recoil := 0.0
var _awaiting_click := false

## Set when an on-screen stick is driving the camera instead of a mouse.
var touch_driven := false

## Apply a look delta in radians. Touch controls call this; the mouse path
## below does the same arithmetic on its own relative motion.
##
## It exists so the touch layer does not have to forge mouse events. A forged
## InputEventMouseMotion would be ignored anyway, because the mouse path is
## gated on the pointer being captured and a phone never captures one.
func apply_look(delta: Vector2) -> void:
    if look_locked:
        return
    rotate_y(-delta.x)
    head.rotate_x(-delta.y)
    head.rotation.x = clampf(head.rotation.x, -1.45, 1.45)

func _ready() -> void:
    if look_locked:
        return
    # A touch device has no pointer to lock, and asking for one there leaves a
    # capture request outstanding that the first tap would try to satisfy.
    if touch_driven:
        return
    # Browsers will not hand over the pointer except from inside a user
    # gesture. Asking for it as the scene loads throws "A user gesture is
    # required to request Pointer Lock" and the player is left looking
    # straight ahead with a mouse that does nothing, which reads as a broken
    # build rather than as a permission prompt. On the web the capture waits
    # for the first click; on desktop there is nothing to wait for.
    if OS.has_feature("web"):
        _awaiting_click = true
    else:
        Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event: InputEvent) -> void:
    if look_locked or touch_driven:
        return
    if _awaiting_click and event is InputEventMouseButton and event.pressed:
        # This runs inside the browser's gesture, which is the whole point.
        Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
        _awaiting_click = false
        return
    # Escape releases the pointer, and the browser also releases it on its own,
    # so the next click has to be able to take it back.
    if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and OS.has_feature("web"):
        _awaiting_click = true
    if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
        apply_look(event.relative * MOUSE_SENS)

## A world-space heading to walk, in place of the keys, or ZERO for input.
##
## Set by `-- autoplay`. It goes through the same acceleration, collision and
## slide as a player's input rather than moving the body directly: teleporting
## a CharacterBody3D to a point the collider cannot occupy puts it back the
## same frame, and the stand-in wedged against the first wall it met and sat
## there while the contract clock ran out.
var drive := Vector3.ZERO

func _physics_process(delta: float) -> void:
    dash_cooldown = maxf(0.0, dash_cooldown - delta)
    var wish: Vector3
    if drive != Vector3.ZERO:
        wish = drive.normalized()
    else:
        var input_dir := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
        wish = (transform.basis * Vector3(input_dir.x, 0.0, input_dir.y)).normalized()

    if Input.is_action_just_pressed("dash") and dash_cooldown <= 0.0:
        dash_dir = wish if wish.length() > 0.1 else -transform.basis.z
        dash_timer = DASH_TIME
        dash_cooldown = DASH_COOLDOWN

    var target: Vector3
    if dash_timer > 0.0:
        dash_timer -= delta
        target = dash_dir * speed_mps * DASH_SPEED_MULT
    else:
        target = wish * speed_mps

    var a := ACCEL if is_on_floor() else AIR_ACCEL
    velocity.x = move_toward(velocity.x, target.x, a * speed_mps * delta)
    velocity.z = move_toward(velocity.z, target.z, a * speed_mps * delta)
    if not is_on_floor():
        velocity.y -= 22.0 * delta
    else:
        velocity.y = -0.1
    move_and_slide()

    # View bob, scaled by actual ground speed so it stops when you do.
    var planar := Vector2(velocity.x, velocity.z).length()
    _bob += delta * planar * 1.5
    _recoil = move_toward(_recoil, 0.0, delta * 6.0)
    head.position.y = eye_height + sin(_bob) * 0.022 * clampf(planar / speed_mps, 0.0, 1.0)
    camera.rotation.z = lerpf(camera.rotation.z, cos(_bob * 0.5) * 0.006 * clampf(planar / speed_mps, 0.0, 1.0), 0.2)

func add_recoil(amount: float) -> void:
    _recoil = minf(_recoil + amount, 0.09)
    head.rotation.x = clampf(head.rotation.x + amount * 0.45, -1.45, 1.45)

func plan_position(plan_scale: float) -> Vector2:
    return Vector2(global_position.x / plan_scale, global_position.z / plan_scale)
