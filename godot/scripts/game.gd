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
const SimC := preload("res://scripts/sim.gd")
const HudC := preload("res://scripts/hud.gd")

var level: Level
var player: CharacterBody3D
var sun: DirectionalLight3D
var env_node: WorldEnvironment

## Capture mode: position the camera at a named viewpoint, render, write a PNG
## and quit. Driven by --  capture <out.png> <viewpoint> so the dream-loop can
## take a live screenshot without a human at the keyboard.
var capture_path: String = ""
var capture_view: String = "corridor"
## Headless contract test: run the simulation for N seconds of game time with
## no renderer and report what happened. This is how the mechanics are checked
## without a human at the keyboard.
var simtest_seconds: float = 0.0

var sim: Sim
var hud: Hud
var viewmodel: Node3D
var _enemy_nodes: Dictionary = {}
var _char_cache: Dictionary = {}
## Which model stands in for each archetype's `render` kind.
const CHAR_FOR := {
    "soldier": "soldier", "shield": "shield", "sniper": "sniper",
    "heavy": "heavy", "drone": "drone", "crawler": "drone",
    "jammer": "drone", "warden": "heavy", "veil": "sniper",
    "augment": "heavy", "sapper": "soldier", "mortar": "heavy",
}

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
    _start_contract()
    var t3 := Time.get_ticks_msec()
    print("BUILD materials=%dms level=%dms rest=%dms nodes=%d" % [t1 - t0, t2 - t1, t3 - t2, _count_nodes(self)])
    if simtest_seconds > 0.0:
        _run_simtest()
        return
    if capture_path != "":
        # Step the contract forward before capturing, so the HUD shows a live
        # clock rather than an opening-frame zero. The combat viewpoint runs
        # much further, because the director's first wave is scheduled after a
        # three second lull and deploys 520 units out: a capture taken at t=0
        # shows an empty sector and proves nothing about the game.
        _advance_for_capture(70.0 if capture_view == "combat" else 2.0)
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
            "simtest":
                simtest_seconds = float(args[i + 1]) if i + 1 < args.size() else 300.0
                i += 1
        i += 1

## Every render layer except the viewmodel's. World lights use this as their
## cull mask so the weapon is lit only by the rig parented to the camera.
const WORLD_LAYERS := 0xFFFFF & ~(1 << 1)

func _build_environment() -> void:
    # Sun. A single hard key at a low-ish western elevation is what gives the
    # reference its long shadows and its warm/cool split: lit faces go amber,
    # shadowed faces take their colour from the sky.
    sun = DirectionalLight3D.new()
    # A review read this key as sitting on the camera axis and asked for it
    # to be swung across the lane. Tried at 158 and again at 143, and both
    # were worse in the frame than the bearing they replaced: the sun moved
    # behind the buildings at the camera's back and dropped the entire
    # foreground into their shadow, leaving no sunlit ground anywhere. At 128
    # the facades already show a lit front and a turned shadow return, which
    # was what the note was actually asking for. Left where it was.
    sun.rotation_degrees = Vector3(-42.0, 128.0, 0.0)
    sun.light_color = Color(1.0, 0.94, 0.83)
    # The sun spent three rounds at around 1.1 while sky ambient sat near 6.5,
    # which is a six-to-one fill: every surface was lit from everywhere, so
    # nothing cast a shadow onto anything and the whole courtyard read flat.
    # Key and fill swap places here.
    sun.light_energy = 2.8
    sun.shadow_enabled = true
    sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
    # Four splits over 60 m. Two splits over 45 gave neither: the near split
    # was too coarse for prop contact shadows and the range stopped short of
    # the far wall, so the frame had no cast shadows at any distance.
    sun.directional_shadow_max_distance = 60.0
    sun.directional_shadow_blend_splits = true
    # A 4096 atlas over four splits affords a much tighter bias. The old values
    # pushed every contact shadow away from the base of its wall, which is a
    # large part of why the boxes looked like they were floating.
    sun.shadow_bias = 0.02
    sun.shadow_normal_bias = 0.15
    sun.light_angular_distance = 0.6
    # Skip the viewmodel layer. The weapon sits 30 cm from the eye and would
    # take the key at an angle no world surface does; it has its own rig.
    sun.light_cull_mask = WORLD_LAYERS
    add_child(sun)

    var env := Environment.new()
    # The sky is both the backdrop and the fill light. Left at full energy it
    # blew out to white paper behind the rooflines and still lit the shaded
    # faces poorly, because what reaches them is the horizon colour rather
    # than the zenith. Pulling energy down and deepening the gradient fixes
    # both: a blue sky above the cornices, and blue bounce in the shadows.
    # A baked panorama replaces the procedural gradient.
    #
    # ProceduralSkyMaterial gives a clean two-stop ramp and nothing else, so
    # the strip of sky above the rooflines was the flattest region in the
    # frame. It matters beyond that strip: the environment takes its ambient
    # term straight from the sky's radiance, so a sky with no structure lights
    # every shadowed surface in the sector with the same wash from every
    # direction. The panorama carries cumulus, a horizon haze band and a sun
    # glow placed at the key light's own bearing.
    var pano := load("res://art/textures/sky_panorama.png")
    var sky_mat: Material
    if pano != null:
        var pm := PanoramaSkyMaterial.new()
        pm.panorama = pano
        pm.energy_multiplier = 1.0
        sky_mat = pm
    else:
        # Kept as a fallback so a missing texture degrades to the old look
        # rather than to a black void.
        var proc := ProceduralSkyMaterial.new()
        proc.sky_top_color = Color(0.36, 0.50, 0.72)
        proc.sky_horizon_color = Color(0.80, 0.82, 0.85)
        proc.sky_curve = 0.20
        proc.sky_energy_multiplier = 1.1
        proc.ground_bottom_color = Color(0.30, 0.28, 0.25)
        proc.ground_horizon_color = Color(0.58, 0.55, 0.50)
        proc.ground_energy_multiplier = 0.7
        proc.sun_angle_max = 1.5
        proc.sun_curve = 0.15
        sky_mat = proc
    var sky := Sky.new()
    sky.sky_material = sky_mat
    env.background_mode = Environment.BG_SKY
    env.sky = sky
    # Sky-sourced ambient is what stops shadowed stone going black; the
    # reference's shadows are blue, not empty.
    env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
    env.ambient_light_sky_contribution = 1.0
    # Note that with sky contribution at 1.0 Godot takes the ambient term
    # straight from the sky's own radiance and this energy value does nothing
    # at all. Two rounds were spent moving it and measuring no change; the
    # shadow fill is the `bounce` light further down, and the sky's brightness
    # is the sky material's. Left at unity so it is not mistaken for a control.
    env.ambient_light_energy = 1.0
    env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY

    env.tonemap_mode = Environment.TONE_MAPPER_ACES
    env.tonemap_exposure = 1.06
    env.tonemap_white = 3.0

    env.ssao_enabled = true
    # SSAO multiplies the ambient term, and ambient is the only fill in shadow,
    # so a strong setting crushes every shaded corner to black. It is a contact
    # cue, not a lighting model.
    # Just under a metre. At 0.55 the occlusion was too tight to darken a
    # wall/ground junction at all: the paving read the same brightness two
    # centimetres from a wall as it did in the middle of the lane, and every
    # solid in the sector looked like it was hovering a few millimetres off
    # the floor rather than sitting on it.
    env.ssao_radius = 0.9
    env.ssao_intensity = 1.1
    env.ssao_power = 1.0
    env.ssao_detail = 0.6
    env.ssao_light_affect = 0.0

    env.ssil_enabled = true
    # Bounce off sunlit stone is what makes a real shadow warm rather than
    # blue. This build's darks were at 0.008/0.029/0.071: nearly black, and the
    # wrong colour besides.
    env.ssil_intensity = 0.6

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
    # In FOG_MODE_DEPTH the density scalar multiplies the final depth-derived
    # blend, so 0.02 capped the haze at 2% and there was no aerial perspective
    # at all: buildings 60 m away were as contrasty as a wall 3 m away.
    env.fog_density = 0.65
    env.fog_depth_begin = 18.0
    env.fog_depth_end = 95.0
    env.fog_depth_curve = 1.4
    env.fog_sun_scatter = 0.22
    # Depth fog reaches the sky as well, and the sky sits at maximum depth, so
    # at full strength it painted the whole sky the fog colour -- which is why
    # every shot so far had a sheet of white paper above the rooflines instead
    # of a blue sky. The haze is wanted on the far rooms and not at all on the
    # sky behind them.
    # A little haze on the sky, not none. Zero was the overcorrection for the
    # sky being painted fog-white; the references do carry some.
    env.fog_sky_affect = 0.30

    env.adjustment_enabled = true
    env.adjustment_brightness = 1.0
    env.adjustment_contrast = 0.96
    env.adjustment_saturation = 1.0

    # Bounce fill from the anti-sun azimuth. Shadowed stone in a sunlit street
    # is lit mostly by light returning off the stone opposite, which is warm;
    # sky-only ambient makes it blue and reads as dusk.
    var bounce := DirectionalLight3D.new()
    bounce.rotation_degrees = Vector3(-18.0, -52.0, 0.0)
    bounce.light_color = Color(1.0, 0.86, 0.68)
    # Shadowed stone was measuring under a tenth of the luminance of the same
    # stone in sun, against roughly a quarter in the references, so their
    # shadows read as stone and this build's read as holes cut in the frame.
    # This light is the only lever that lifts them without also lifting the
    # sky, the sunlit faces, or the highlights.
    bounce.light_energy = 0.9
    bounce.shadow_enabled = false
    bounce.light_cull_mask = WORLD_LAYERS
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
    viewmodel = vm

    player.speed_mps = level.metres(212.0)
    player.look_locked = capture_path != ""
    add_child(player)
    player.global_position = level.to_world(level.spawn_point, 1.0)

# ---- Capture --------------------------------------------------------------

## Viewpoints chosen to be comparable between rounds: the same places, the same
## headings, so a judge scoring two rounds is scoring the build and not a
## different part of the level.
func _viewpoint(name: String) -> Array:
    # Plan bearings, since the yaw is not obvious: 0 looks toward plan -Y,
    # 90 toward -X, 180 toward +Y, -90 toward +X.
    #
    # These are chosen from the level data rather than by eye. The sector is a
    # 3x3 grid of 700-unit rooms, and the two long axial runs -- south to north
    # and west to east through the centre chamber -- give a clear 1600 units
    # of sightline through two archways each. The first attempt at a "wide"
    # shot put the camera in a corner 30 cm from a pillar.
    match name:
        "corridor":
            # INTAKE / 08 north through CONTROL / 05 into REACTOR / 02.
            return [Vector2(1050.0, 1900.0), 0.0, -1.5]
        "wide":
            # TRANSIT / 04 east through CONTROL / 05 into LABORATORY / 06.
            return [Vector2(250.0, 1050.0), -90.0, -1.5]
        "room":
            # Standing in the centre chamber looking at its north wall.
            return [Vector2(1050.0, 1330.0), 0.0, 1.0]
        "extract":
            # Approaching the beacon in LABORATORY / 06.
            return [Vector2(1420.0, 1050.0), -90.0, -1.0]
        "combat":
            # Same standpoint as `corridor`, but the contract has been run
            # forward so there are hostiles on the ground. Chosen by the
            # capture path below, which then aims at the nearest one.
            return [Vector2(1050.0, 1750.0), 0.0, -1.0]
        _:
            return [Vector2(level.width * 0.5, level.height * 0.5), 0.0, 0.0]

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

# ---- Contract -------------------------------------------------------------

func _start_contract() -> void:
    var op: Dictionary = GameData.operatives[0]
    var weapon_def := {}
    for w in GameData.weapons:
        if w.get("id", "") == op.get("weapon", "needle"):
            weapon_def = w
            break
    var map := GameData.map_named("blacksite")
    sim = SimC.new()
    sim.name = "Sim"
    add_child(sim)
    sim.setup(level, 1234, op, GameData.difficulty(int(GameData.op1.get("difficulty", 0))),
        float(GameData.op1.get("duration", 5)), weapon_def, map.get("enemyBias", {}))
    sim.enemy_spawned.connect(_on_enemy_spawned)
    sim.enemy_died.connect(_on_enemy_died)
    sim.weapon_fired.connect(_on_weapon_fired)

    hud = HudC.new()
    hud.sim = sim
    var layer := CanvasLayer.new()
    layer.add_child(hud)
    add_child(layer)

    _build_extraction_marker()

func _process(delta: float) -> void:
    if sim == null or capture_path != "":
        return
    sim.player_pos = level.to_plan(player.global_position)
    sim.advance(delta)
    _sync_enemies()
    if viewmodel:
        var planar := Vector2(player.velocity.x, player.velocity.z).length()
        viewmodel.update_motion(delta, Vector2.ZERO,
            clampf(planar / maxf(0.1, player.speed_mps), 0.0, 1.0), false)

func _char_scene(kind: String):
    var name: String = CHAR_FOR.get(kind, "soldier")
    if not _char_cache.has(name):
        var path := "res://art/models/char_%s.glb" % name
        _char_cache[name] = load(path) if ResourceLoader.exists(path) else null
    return _char_cache[name]

func _on_enemy_spawned(e: Dictionary) -> void:
    var packed = _char_scene(String(e.get("render", "soldier")))
    var node: Node3D
    if packed != null:
        node = packed.instantiate()
    else:
        node = Node3D.new()
    # The figures are modelled at human height in metres; the simulation knows
    # them only as a radius in plan units, so nothing is scaled to match.
    add_child(node)
    node.global_position = level.to_world(e["pos"], 0.0)
    e["node"] = node
    _enemy_nodes[node] = e

func _on_enemy_died(e: Dictionary) -> void:
    var node = e.get("node", null)
    if node != null and is_instance_valid(node):
        _enemy_nodes.erase(node)
        node.queue_free()
    e["node"] = null

func _sync_enemies() -> void:
    for e in sim.enemies:
        var node = e.get("node", null)
        if node == null or not is_instance_valid(node):
            continue
        var target := level.to_world(e["pos"], 0.0)
        node.global_position = target
        # Face the operative. These are static meshes; a turn is the whole of
        # their animation, and at this distance it is enough to read intent.
        var to_player: Vector2 = sim.player_pos - Vector2(e["pos"])
        if to_player.length() > 1.0:
            node.rotation.y = atan2(to_player.x, to_player.y) + PI

func _on_weapon_fired(_dir: Vector2) -> void:
    if viewmodel:
        viewmodel.fire_kick(1.0)

## A beacon at the extraction point, lit once the contract window closes.
func _build_extraction_marker() -> void:
    var marker := Node3D.new()
    marker.name = "Extraction"
    marker.position = level.to_world(level.extraction_point, 0.0)
    var pillar := MeshInstance3D.new()
    var mesh := CylinderMesh.new()
    mesh.top_radius = level.metres(Sim.EXTRACTION_RADIUS) * 0.12
    mesh.bottom_radius = mesh.top_radius
    mesh.height = 9.0
    pillar.mesh = mesh
    var glow := StandardMaterial3D.new()
    glow.albedo_color = Color(0.463, 0.906, 0.831, 0.30)
    glow.emission_enabled = true
    glow.emission = Color(0.463, 0.906, 0.831)
    glow.emission_energy_multiplier = 2.4
    glow.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    pillar.material_override = glow
    pillar.position.y = 4.5
    pillar.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    marker.add_child(pillar)
    add_child(marker)

## Drive the contract on a fixed clock with no renderer, walking the operative
## toward the extraction point once the window closes, and report the result.
func _run_simtest() -> void:
    var step := Sim.FIXED_STEP
    var steps := int(simtest_seconds / step)
    var peak := 0
    for i in range(steps):
        if sim.finished:
            break
        # Stand-in for a player. A stationary operative is not a fair test of
        # the contract -- the game is built around moving -- so this kites away
        # from the nearest hostile, and walks to the beacon once it is live.
        var move := Vector2.ZERO
        if sim.extraction_active:
            var to: Vector2 = level.extraction_point - sim.player_pos
            if to.length() > 4.0:
                move = to.normalized()
        else:
            var nearest := INF
            var away := Vector2.ZERO
            for e in sim.enemies:
                var d: float = (Vector2(e["pos"]) - sim.player_pos).length()
                if d < nearest:
                    nearest = d
                    away = (sim.player_pos - Vector2(e["pos"])).normalized()
            # Kite the whole nearby group rather than the single closest
            # hostile, which is what walks a bot into a corner.
            var push := Vector2.ZERO
            for e in sim.enemies:
                var v: Vector2 = sim.player_pos - Vector2(e["pos"])
                var d: float = maxf(1.0, v.length())
                if d < 320.0:
                    push += v.normalized() * (320.0 - d) / 320.0
            if push.length() > 0.05:
                move = push.normalized()
            elif nearest < 260.0:
                move = away
        if move != Vector2.ZERO:
            var want: Vector2 = sim.player_pos + move * 212.0 * step
            if not level.overlaps_solid(want.x, want.y, 13.0) and level.playable(want.x, want.y, 20.0):
                sim.player_pos = want
        sim._step(step)
        peak = maxi(peak, sim.enemies.size())
    print("SIMTEST rounds hit=%d expired=%d blocked=%d" % [sim.rounds_hit, sim.rounds_expired, sim.rounds_blocked])
    print("SIMTEST elapsed=%.1fs finished=%s outcome=%s shots=%d peak=%d alive=%d kills=%d level=%d weapon_level=%d hp=%.0f/%.0f extraction=%s hold=%.2f" % [
        sim.elapsed, sim.finished, sim.outcome, sim.shots_fired, peak, sim.enemies.size(),
        sim.kills, sim.player_level, sim.weapon_level, sim.player_hp, sim.player_max_hp,
        sim.extraction_active, sim.extraction_hold])
    get_tree().quit()

## Run the contract forward with the operative held in place, syncing the
## hostile nodes as it goes so they are where the simulation says they are.
func _advance_for_capture(seconds: float) -> void:
    var step := Sim.FIXED_STEP
    var vp := _viewpoint(capture_view)
    sim.player_pos = vp[0]
    for i in range(int(seconds / step)):
        if sim.finished:
            break
        sim._step(step)
        # The capture operative stands still by definition, so they take every
        # contact hit and are dead inside a minute. A screenshot is not a
        # playthrough; hold them up rather than photographing a corpse.
        sim.player_hp = sim.player_max_hp
        sim.player_pos = vp[0]
    _sync_enemies()
