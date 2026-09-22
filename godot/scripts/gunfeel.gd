class_name GunFeel
extends Node3D

## Everything that tells the player a round went out.
##
## The weapon fires itself. That is the 2D game's contract -- there is no
## trigger there either, the operative acquires and engages on a cooldown --
## and the port keeps it. What the port did not keep was any way to tell. The
## only feedback was a 0.22 nudge on the viewmodel and a point light lasting a
## tenth of a second, which on a phone in daylight is nothing at all, so the
## honest report was "I can't shoot" from a player who had been shooting the
## whole time.
##
## So: a sound, a flash you can see, and a tracer that shows where the round
## went. None of it changes a number in the simulation. It only makes what the
## simulation already did visible.

## Rendered offline by tools/sfx/weapons.py, the same rounds the 2D build
## plays. A weapon names its set through the registry's `voice` field.
const AUDIO_DIR := "res://art/audio/weapons/%s-%d.ogg"
const ROUNDS_PER_VOICE := 3

## How long the streak and the flash stay up.
##
## These are in seconds but what matters is frames. The first values, 55 and
## 45 ms, are a frame and a half at 30 fps, so on a phone a shot could land
## entirely between two rendered frames and never be seen at all -- which is
## the exact complaint this whole file exists to answer. Roughly 90 and 70 ms
## puts both across two to three frames at 30 and still reads as a streak
## rather than a beam; Counter-Strike's own tracers sit near 100 ms.
const TRACER_LIFE := 0.09
const FLASH_LIFE := 0.07

var muzzle: Node3D = null

var _voice := "pistol"
var _samples: Array[AudioStream] = []
var _players: Array[AudioStreamPlayer3D] = []
var _next_player := 0
var _flash: MeshInstance3D = null
var _flash_timer := 0.0
var _tracer: MeshInstance3D = null
var _tracer_timer := 0.0
var _rng := RandomNumberGenerator.new()
var _burst: MeshInstance3D = null
var _burst_timer := 0.0

func setup(muzzle_node: Node3D, voice: String) -> void:
    muzzle = muzzle_node
    _voice = voice if voice != "" else "pistol"
    _rng.randomize()
    _load_samples()
    _build_flash()
    _build_tracer()
    _build_burst()

func _load_samples() -> void:
    for i in range(1, ROUNDS_PER_VOICE + 1):
        var path := AUDIO_DIR % [_voice, i]
        if ResourceLoader.exists(path):
            var s := load(path)
            if s is AudioStream:
                _samples.append(s)
    if _samples.is_empty():
        push_warning("No weapon audio for voice '%s'" % _voice)
        return
    # A pool, because the Needle's cooldown is shorter than its own report and
    # a single player would cut each shot off with the next one.
    for i in range(4):
        var p := AudioStreamPlayer3D.new()
        p.max_distance = 60.0
        p.unit_size = 6.0
        p.volume_db = -4.0
        # The weapon is at the camera, so it should not swing across the
        # stereo field as the player turns.
        p.panning_strength = 0.0
        add_child(p)
        _players.append(p)

## A flat card at the muzzle rather than only a light. A light alone lifts the
## surfaces near the barrel a little and reads as nothing in daylight.
func _build_flash() -> void:
    var mesh := QuadMesh.new()
    # 6 cm, not 17. The muzzle sits about 40 cm from the eye, so a 17 cm
    # additive billboard there subtends a huge angle and came out as a white
    # blob covering the bottom corner of the frame rather than as a flash.
    mesh.size = Vector2(0.06, 0.06)
    var m := StandardMaterial3D.new()
    m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
    m.albedo_color = Color(1.0, 0.86, 0.58, 0.7)
    m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
    m.disable_receive_shadows = true
    _flash = MeshInstance3D.new()
    _flash.mesh = mesh
    _flash.material_override = m
    _flash.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    _flash.visible = false
    # Layer 2 with the rest of the viewmodel, so the world's lights ignore it.
    _flash.layers = 1 << 1
    add_child(_flash)

func _build_tracer() -> void:
    var mesh := BoxMesh.new()
    mesh.size = Vector3(0.035, 0.035, 1.0)
    var m := StandardMaterial3D.new()
    m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
    m.albedo_color = Color(1.0, 0.78, 0.45, 0.5)
    m.disable_receive_shadows = true
    _tracer = MeshInstance3D.new()
    _tracer.mesh = mesh
    _tracer.material_override = m
    _tracer.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    _tracer.visible = false
    add_child(_tracer)

## `from` and `to` are world space. `to` is where the simulation says the round
## went, which is the acquired contact, so the streak agrees with the hit.
func fire(from: Vector3, to: Vector3) -> void:
    if not _samples.is_empty() and not _players.is_empty():
        var p := _players[_next_player]
        _next_player = (_next_player + 1) % _players.size()
        p.stream = _samples[_rng.randi_range(0, _samples.size() - 1)]
        # A little pitch scatter, or a magazine of identical reports turns
        # into a machine noise rather than a weapon.
        p.pitch_scale = _rng.randf_range(0.94, 1.07)
        p.global_position = from
        p.play()

    if _flash:
        _flash.global_position = from
        _flash.rotation.z = _rng.randf_range(0.0, TAU)
        var scale := _rng.randf_range(0.8, 1.25)
        _flash.scale = Vector3(scale, scale, scale)
        _flash.visible = true
        _flash_timer = FLASH_LIFE

    if _tracer:
        var span := to - from
        var dist := span.length()
        # Start the streak a metre out rather than at the barrel.
        #
        # The muzzle sits about 40 cm from the eye, so a tracer beginning there
        # runs straight through the near plane: an additive box a few
        # centimetres thick fills a large part of the lower frame at that
        # distance and, once the glow pass has it, blooms into a white mass.
        # It measured 55,000 near-white pixels in the bottom corner against
        # 537 before any of this existed. A metre out it reads as a round
        # leaving the weapon, which is what it is.
        const NEAR_SKIP := 1.0
        if dist > NEAR_SKIP + 0.5:
            var dir := span / dist
            var start := from + dir * NEAR_SKIP
            var length := dist - NEAR_SKIP
            _tracer.global_position = start + dir * (length * 0.5)
            _tracer.look_at(to, Vector3.UP)
            _tracer.scale = Vector3(1.0, 1.0, length)
            _tracer.visible = true
            _tracer_timer = TRACER_LIFE

## A short-lived puff where a hostile went down.
const BURST_LIFE := 0.26

func _build_burst() -> void:
    var mesh := SphereMesh.new()
    mesh.radius = 0.55
    mesh.height = 1.1
    mesh.radial_segments = 10
    mesh.rings = 6
    var m := StandardMaterial3D.new()
    m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
    m.albedo_color = Color(1.0, 0.42, 0.30, 0.55)
    m.disable_receive_shadows = true
    _burst = MeshInstance3D.new()
    _burst.mesh = mesh
    _burst.material_override = m
    _burst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    _burst.visible = false
    add_child(_burst)

func kill_burst(at: Vector3) -> void:
    if _burst == null:
        return
    _burst.global_position = at
    _burst.scale = Vector3.ONE * 0.5
    _burst.visible = true
    _burst_timer = BURST_LIFE

func _process(delta: float) -> void:
    if _burst_timer > 0.0:
        _burst_timer -= delta
        if _burst:
            # Expands and thins as it goes, so it reads as a burst rather than
            # a ball that blinks out.
            var t: float = 1.0 - (_burst_timer / BURST_LIFE)
            _burst.scale = Vector3.ONE * (0.5 + t * 1.5)
            var mat: StandardMaterial3D = _burst.material_override
            mat.albedo_color.a = 0.55 * (1.0 - t)
            if _burst_timer <= 0.0:
                _burst.visible = false
    if _flash_timer > 0.0:
        _flash_timer -= delta
        if _flash_timer <= 0.0 and _flash:
            _flash.visible = false
    if _tracer_timer > 0.0:
        _tracer_timer -= delta
        if _tracer_timer <= 0.0 and _tracer:
            _tracer.visible = false
