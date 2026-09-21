class_name TouchControls
extends CanvasLayer

## On-screen controls for touch devices.
##
## The desktop scheme is WASD plus mouse look, which a phone has none of. This
## layer supplies the same four movement actions and the same look delta from
## touch instead, so nothing downstream has to know which one it is being
## driven by: movement goes through Input.action_press at analog strength, and
## look is handed to the player directly.
##
## The layout is the one every mobile shooter converged on, for the reason that
## it is the only one that works with two thumbs anchored at the bottom
## corners: movement on the left, look on the right, actions as buttons under
## the right thumb. The left stick floats rather than sitting at a fixed point,
## because a thumb cannot reliably find a fixed circle it cannot see while
## looking at the middle of the screen.
##
## The weapon is not on a button. The simulation acquires and fires on its own,
## exactly as it does in the 2D game, so adding a trigger here would be adding
## a mechanic rather than porting one.

## Fraction of the shorter screen edge. Sized in relative terms because the
## same build runs on a phone at 1170 px across and a desktop browser at 2560.
const STICK_RADIUS := 0.135
const STICK_DEADZONE := 0.16
const BUTTON_RADIUS := 0.085
## Radians per viewport pixel. A full swipe across the 1920-unit viewport turns
## about 290 degrees, which is roughly where a thumb wants it. The first value
## tried was 0.0042, which is nearly two full turns across one swipe.
const LOOK_SENS := 0.0026

## The left thumb owns the left 45% of the screen. Slightly under half, so that
## a right thumb reaching in for the buttons does not land in movement.
const MOVE_ZONE := 0.45

var player: Node = null

var _move_touch := -1
var _move_origin := Vector2.ZERO
var _move_vec := Vector2.ZERO
var _look_touch := -1
var _look_last := Vector2.ZERO
var _button_touch := {}          ## touch index -> action name
var _held := {}                  ## action name -> true
var _surface: Control = null

func _ready() -> void:
    layer = 2
    _surface = Control.new()
    _surface.set_anchors_preset(Control.PRESET_FULL_RECT)
    # The surface is painted, never clicked. Left interactive it would swallow
    # the touches before _input ever saw them.
    _surface.mouse_filter = Control.MOUSE_FILTER_IGNORE
    _surface.draw.connect(_draw_surface)
    add_child(_surface)
    get_viewport().size_changed.connect(func(): _surface.queue_redraw())

func _unit() -> float:
    var s := get_viewport().get_visible_rect().size
    return minf(s.x, s.y)

## Buttons sit above the bottom edge and inside the right edge, clear of the
## home indicator and of the curve of a rounded display.
func _button_centres() -> Dictionary:
    var s := get_viewport().get_visible_rect().size
    var r := _unit() * BUTTON_RADIUS
    var margin := r * 1.35
    return {
        "dash": Vector2(s.x - margin, s.y - margin),
        "ability": Vector2(s.x - margin * 2.9, s.y - margin * 0.75),
    }

func _input(event: InputEvent) -> void:
    if event is InputEventScreenTouch:
        if event.pressed:
            _press(event.index, event.position)
        else:
            _release(event.index)
        get_viewport().set_input_as_handled()
    elif event is InputEventScreenDrag:
        _drag(event.index, event.position, event.relative)
        get_viewport().set_input_as_handled()

## Temporary instrumentation, removed once the mapping is confirmed.
var debug := false

func _press(index: int, pos: Vector2) -> void:
    if debug:
        print("PRESS i=%d pos=%s view=%s" % [index, pos, get_viewport().get_visible_rect().size])
    var r := _unit() * BUTTON_RADIUS
    for action in _button_centres():
        if pos.distance_to(_button_centres()[action]) <= r * 1.25:
            _button_touch[index] = action
            _held[action] = true
            Input.action_press(action)
            _surface.queue_redraw()
            return
    var s := get_viewport().get_visible_rect().size
    if pos.x < s.x * MOVE_ZONE:
        # The stick appears where the thumb landed rather than the thumb having
        # to find the stick.
        if _move_touch == -1:
            _move_touch = index
            _move_origin = pos
            _move_vec = Vector2.ZERO
            _surface.queue_redraw()
    elif _look_touch == -1:
        _look_touch = index
        _look_last = pos

func _drag(index: int, pos: Vector2, relative: Vector2) -> void:
    if index == _move_touch:
        var r := _unit() * STICK_RADIUS
        var off := (pos - _move_origin) / r
        if off.length() > 1.0:
            # Past full deflection the stick re-centres under the thumb, so a
            # long drag keeps steering instead of pinning to one direction.
            _move_origin = pos - off.normalized() * r
            off = off.normalized()
        _move_vec = off
        _apply_move()
        _surface.queue_redraw()
    elif index == _look_touch and player != null and player.has_method("apply_look"):
        # The delta is measured here rather than taken from the event.
        #
        # InputEventScreenDrag.relative does not report the movement since the
        # press on this path: a touch that went down at x=1563 and moved about
        # 150 px right arrived with a relative of (1938, 554), which pitched
        # the camera to the floor stop on the first frame. Position is
        # unambiguous, so the difference between successive positions is used
        # instead and the event's own relative is ignored.
        var delta := pos - _look_last
        _look_last = pos
        if debug:
            print("LOOK i=%d delta=%s event_rel=%s" % [index, delta, relative])
        player.apply_look(delta * LOOK_SENS)

func _release(index: int) -> void:
    if _button_touch.has(index):
        var action: String = _button_touch[index]
        _button_touch.erase(index)
        _held.erase(action)
        Input.action_release(action)
        _surface.queue_redraw()
        return
    if index == _move_touch:
        _move_touch = -1
        _move_vec = Vector2.ZERO
        _apply_move()
        _surface.queue_redraw()
    elif index == _look_touch:
        _look_touch = -1

## Movement reaches the game as the same four actions the keyboard drives, at
## analog strength, so Input.get_vector in the player reads a real stick rather
## than four booleans and the operative can walk as well as run.
func _apply_move() -> void:
    var v := _move_vec
    if v.length() < STICK_DEADZONE:
        v = Vector2.ZERO
    for pair in [["move_right", v.x], ["move_left", -v.x],
                 ["move_back", v.y], ["move_forward", -v.y]]:
        var action: String = pair[0]
        var amount: float = pair[1]
        if amount > 0.0:
            Input.action_press(action, clampf(amount, 0.0, 1.0))
        else:
            Input.action_release(action)

## Released on the way out, or the operative keeps walking into a wall forever
## after the layer is removed.
func release_all() -> void:
    for action in ["move_left", "move_right", "move_forward", "move_back",
                   "dash", "ability"]:
        Input.action_release(action)

func _exit_tree() -> void:
    release_all()

# ---- Painting ---------------------------------------------------------------
#
# Drawn rather than built from textures: these are circles and glyphs, they have
# to resize with the viewport on every rotation, and a draw call costs less than
# an atlas that would need its own art pass.

func _draw_surface() -> void:
    var c := _surface
    var unit := _unit()
    var r := unit * STICK_RADIUS
    var dim := Color(1, 1, 1, 0.16)
    var lit := Color(1, 1, 1, 0.30)

    if _move_touch != -1:
        c.draw_arc(_move_origin, r, 0, TAU, 48, dim, unit * 0.006, true)
        var knob := _move_origin + _move_vec * r
        c.draw_circle(knob, unit * 0.045, lit)
    else:
        # A resting hint in the lower left, so the control is discoverable
        # before the first touch without sitting under the thumb.
        var s := c.size
        var rest := Vector2(s.x * 0.16, s.y * 0.76)
        c.draw_arc(rest, r * 0.8, 0, TAU, 48, Color(1, 1, 1, 0.07), unit * 0.005, true)

    var br := unit * BUTTON_RADIUS
    var labels := {"dash": "DASH", "ability": "ABIL"}
    var font := ThemeDB.fallback_font
    var size := int(unit * 0.032)
    for action in _button_centres():
        var at: Vector2 = _button_centres()[action]
        var on: bool = _held.has(action)
        c.draw_circle(at, br, Color(1, 1, 1, 0.16 if on else 0.07))
        c.draw_arc(at, br, 0, TAU, 40, Color(1, 1, 1, 0.34 if on else 0.18),
            unit * 0.005, true)
        var text: String = labels[action]
        var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
        c.draw_string(font, at + Vector2(-w * 0.5, size * 0.35), text,
            HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(1, 1, 1, 0.55 if on else 0.34))
