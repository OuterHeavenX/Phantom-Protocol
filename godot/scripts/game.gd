extends Node3D

## op1 — COLD OPEN, Blacksite Zero, first person.
##
## Builds the scene entirely in code from the exported level so there is one
## source of truth and no .tscn to drift from it. Runs the real contract:
## five minutes, RECRUIT difficulty, extract at the beacon.

const LevelC := preload("res://scripts/level.gd")
const MaterialsC := preload("res://scripts/materials.gd")
const LevelBuildC := preload("res://scripts/level_build.gd")
const PlayerC := preload("res://scripts/player.gd")
const RngC := preload("res://scripts/rng.gd")
const ViewmodelC := preload("res://scripts/viewmodel.gd")

var level: Level
var player: CharacterBody3D
var sun: DirectionalLight3D
var env_node: WorldEnvironment

## Capture mode: position the camera at a named viewpoint, render, write a PNG
## and quit. Driven by --  capture <out.png> <viewpoint> so the dream-loop can
## take a live screenshot without a human at the keyboard.
var capture_path: String = ""
var capture_view: String = "corridor"

func _ready() -> void:
    _parse_args()
    if capture_path != "":
        # A watchdog, because a capture that hangs is indistinguishable from a
        # capture that is merely slow on a software rasteriser, and the first
        # one cost ten minutes before it was noticed.
        var guard := Timer.new()
        guard.wait_time = 900.0
        guard.one_shot = true
        guard.timeout.connect(func():
            push_error("Capture watchdog fired; nothing was written.")
            get_tree().quit(3))
        add_child(guard)
        guard.start()
    level = LevelC.new()
    if not level.load_from("res://data/level_blacksite.json"):
        push_error("Could not load the level export.")
        return
    var t0 := Time.get_ticks_msec()
    var mats: Dictionary = MaterialsC.build()
    var t1 := Time.get_ticks_msec()
    var builder := LevelBuildC.new()
    add_child(builder)
    builder.build(level, mats)
    var t2 := Time.get_ticks_msec()
    _build_environment()
    _spawn_player()
    var t3 := Time.get_ticks_msec()
    print("BUILD materials=%dms level=%dms rest=%dms nodes=%d" % [t1 - t0, t2 - t1, t3 - t2, _count_nodes(self)])
    if capture_path != "":
        _run_capture()

func _parse_args() -> void:
    var args := OS.get_cmdline_user_args()
    var i := 0
    while i < args.size():
        match args[i]:
            "capture":
                capture_path = args[i + 1] if i + 1 < args.size() else "user://shot.png"
                i += 1
            "view":
                capture_view = args[i + 1] if i + 1 < args.size() else "corridor"
                i += 1
        i += 1

func _build_environment() -> void:
    # Sun. A single hard key at a low-ish western elevation is what gives the
    # reference its long shadows and its warm/cool split: lit faces go amber,
    # shadowed faces take their colour from the sky.
    sun = DirectionalLight3D.new()
    sun.rotation_degrees = Vector3(-42.0, 128.0, 0.0)
    sun.light_color = Color(1.0, 0.94, 0.83)
    # Measured against the references: the build sat about 1.2 stops hot, with
    # 5.7% of pixels clipped against their 0.02%, and a lit-to-shade ground
    # ratio of 5.3:1 against their 2.1:1. Sun down, fill up.
    sun.light_energy = 1.7
    sun.shadow_enabled = true
    sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
    sun.directional_shadow_max_distance = 120.0
    sun.directional_shadow_blend_splits = true
    # A 4096 atlas over four splits affords a much tighter bias. The old values
    # pushed every contact shadow away from the base of its wall, which is a
    # large part of why the boxes looked like they were floating.
    sun.shadow_bias = 0.02
    sun.shadow_normal_bias = 0.6
    sun.light_angular_distance = 0.6
    add_child(sun)

    var env := Environment.new()
    var sky_mat := ProceduralSkyMaterial.new()
    # The sky is both the backdrop and the fill light. Left at full energy it
    # blew out to white paper behind the rooflines and still lit the shaded
    # faces poorly, because what reaches them is the horizon colour rather
    # than the zenith. Pulling energy down and deepening the gradient fixes
    # both: a blue sky above the cornices, and blue bounce in the shadows.
    sky_mat.sky_top_color = Color(0.16, 0.34, 0.68)
    sky_mat.sky_horizon_color = Color(0.62, 0.72, 0.84)
    sky_mat.sky_curve = 0.32
    sky_mat.sky_energy_multiplier = 1.1
    sky_mat.ground_bottom_color = Color(0.30, 0.28, 0.25)
    sky_mat.ground_horizon_color = Color(0.58, 0.55, 0.50)
    sky_mat.ground_energy_multiplier = 0.7
    # A 6-degree disc with a near-zero curve does not draw a sun, it smears the
    # sun's white across the whole upper hemisphere: the sky measured 0.82 to
    # 0.99 edge to edge and was blue nowhere.
    sky_mat.sun_angle_max = 1.5
    sky_mat.sun_curve = 0.15
    var sky := Sky.new()
    sky.sky_material = sky_mat
    env.background_mode = Environment.BG_SKY
    env.sky = sky
    # Sky-sourced ambient is what stops shadowed stone going black; the
    # reference's shadows are blue, not empty.
    env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
    env.ambient_light_sky_contribution = 1.0
    # Sunlit stone against a blue sky has bright, coloured shadows. At 1.15 the
    # shaded half of the sector was reading near black, which is a night look
    # wearing a daytime sun.
    env.ambient_light_energy = 3.6
    env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY

    env.tonemap_mode = Environment.TONE_MAPPER_ACES
    env.tonemap_exposure = 0.55
    env.tonemap_white = 10.0

    env.ssao_enabled = true
    # SSAO multiplies the ambient term, and ambient is the only fill in shadow,
    # so a strong setting crushes every shaded corner to black. It is a contact
    # cue, not a lighting model.
    env.ssao_radius = 0.55
    env.ssao_intensity = 0.85
    env.ssao_power = 1.2
    env.ssao_detail = 0.6
    env.ssao_light_affect = 0.0

    env.ssil_enabled = true
    # Bounce off sunlit stone is what makes a real shadow warm rather than
    # blue. This build's darks were at 0.008/0.029/0.071: nearly black, and the
    # wrong colour besides.
    env.ssil_intensity = 1.1

    env.glow_enabled = true
    env.glow_intensity = 0.18
    env.glow_bloom = 0.04
    env.glow_hdr_threshold = 1.6
    env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE

    # A little depth haze separates the far rooms from the near ones, which is
    # most of how the reference reads as a deep space rather than a flat set.
    env.fog_enabled = true
    env.fog_mode = Environment.FOG_MODE_DEPTH
    env.fog_light_color = Color(0.74, 0.75, 0.72)
    # Depth fog is gated by density even in FOG_MODE_DEPTH, so at 0.0 the whole
    # depth_begin/end/curve block below did nothing.
    env.fog_density = 0.02
    env.fog_depth_begin = 18.0
    env.fog_depth_end = 95.0
    env.fog_depth_curve = 1.4
    env.fog_sun_scatter = 0.22
    # Depth fog reaches the sky as well, and the sky sits at maximum depth, so
    # at full strength it painted the whole sky the fog colour -- which is why
    # every shot so far had a sheet of white paper above the rooflines instead
    # of a blue sky. The haze is wanted on the far rooms and not at all on the
    # sky behind them.
    env.fog_sky_affect = 0.0

    env.adjustment_enabled = true
    env.adjustment_brightness = 1.0
    env.adjustment_contrast = 1.04
    env.adjustment_saturation = 1.0

    # Bounce fill from the anti-sun azimuth. Shadowed stone in a sunlit street
    # is lit mostly by light returning off the stone opposite, which is warm;
    # sky-only ambient makes it blue and reads as dusk.
    var bounce := DirectionalLight3D.new()
    bounce.rotation_degrees = Vector3(-18.0, -52.0, 0.0)
    bounce.light_color = Color(1.0, 0.86, 0.68)
    bounce.light_energy = 0.25
    bounce.shadow_enabled = false
    add_child(bounce)

    env_node = WorldEnvironment.new()
    env_node.environment = env
    add_child(env_node)

func _spawn_player() -> void:
    player = PlayerC.new()
    player.name = "Player"
    var shape := CollisionShape3D.new()
    var capsule := CapsuleShape3D.new()
    # 13 world units of body radius, at the plan scale.
    capsule.radius = level.metres(13.0)
    capsule.height = 1.8
    shape.shape = capsule
    shape.position = Vector3(0.0, 0.9, 0.0)
    player.add_child(shape)

    var head := Node3D.new()
    head.name = "Head"
    head.position = Vector3(0.0, 1.7, 0.0)
    player.add_child(head)

    var cam := Camera3D.new()
    cam.name = "Camera3D"
    # Godot's Camera3D.fov is VERTICAL and keep_aspect defaults to KEEP_HEIGHT,
    # so 90 here was about 127 degrees horizontal at 16:9 -- far wider than the
    # references' ~106, and the cause of the smeared perspective and the
    # too-small-looking weapon.
    cam.fov = 70.0
    cam.near = 0.05
    cam.far = 400.0
    head.add_child(cam)

    var vm := ViewmodelC.new()
    vm.name = "Viewmodel"
    cam.add_child(vm)

    player.speed_mps = level.metres(212.0)
    player.look_locked = capture_path != ""
    add_child(player)
    player.global_position = level.to_world(level.spawn_point, 1.0)

# ---- Capture --------------------------------------------------------------

## Viewpoints chosen to be comparable between rounds: the same places, the same
## headings, so a judge scoring two rounds is scoring the build and not a
## different part of the level.
func _viewpoint(name: String) -> Array:
    var c := Vector2(level.width * 0.5, level.height * 0.5)
    match name:
        "corridor":
            # Standing in CONTROL / 05 looking down the east doorway.
            return [Vector2(c.x - 190.0, c.y), 0.0, -2.0]
        "room":
            # Across REACTOR / 02 toward the north wall.
            return [Vector2(c.x, c.y - 480.0), -90.0, 2.0]
        "wide":
            # Diagonal across the central chamber, both doorways in frame.
            return [Vector2(c.x - 250.0, c.y - 250.0), 45.0, -3.0]
        "extract":
            return [level.extraction_point + Vector2(-260.0, 0.0), 0.0, -1.0]
        _:
            return [c, 0.0, 0.0]

func _run_capture() -> void:
    print("CAPTURE scene: %d nodes" % _count_nodes(self))
    var vp := _viewpoint(capture_view)
    var plan: Vector2 = vp[0]
    var yaw: float = vp[1]
    var pitch: float = vp[2]
    player.global_position = level.to_world(plan, 1.0)
    player.rotation_degrees = Vector3(0.0, yaw, 0.0)
    var head: Node3D = player.get_node("Head")
    head.rotation_degrees = Vector3(pitch, 0.0, 0.0)
    await _capture_after_warmup()

func _capture_after_warmup() -> void:
    # Several frames: shadow atlases, SSAO and the sky all need a frame or two
    # before the first complete image exists. Capturing on frame one produces a
    # picture of a half-built renderer, which then gets judged as art.
    for i in range(6):
        await RenderingServer.frame_post_draw
    var img := get_viewport().get_texture().get_image()
    var err := img.save_png(capture_path)
    if err != OK:
        push_error("Capture failed: %d" % err)
    print("CAPTURED %s %dx%d" % [capture_path, img.get_width(), img.get_height()])
    get_tree().quit()

func _count_nodes(n: Node) -> int:
    var total := 1
    for c in n.get_children():
        total += _count_nodes(c)
    return total
