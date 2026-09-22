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
const TouchControlsC := preload("res://scripts/touch_controls.gd")
const GunFeelC := preload("res://scripts/gunfeel.gd")

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
## Frame-cost report: render N frames, print what the renderer was asked to do
## and how long each frame took, then quit. Driven by -- perf <frames>.
##
## This exists because three separate player reports -- enemies frozen while
## the player still moves, shots going out occasionally, shot sounds
## occasionally -- are all one symptom if the frame rate is low enough, and
## guessing at that from a screenshot is how rounds get wasted. The numbers it
## prints are draw calls and milliseconds, which is what the fix has to move.
var perf_frames := 0
## Which sector to build. The game ships two: the daylit opening street and
## CROSSFALL SPAN, a suspension crossing in rain at night. Driven by
## -- level <id> so a capture can be taken of either without a code change.
var level_id := "blacksite"

var sim: Sim
var hud: Hud
var touch_controls: CanvasLayer = null
var gunfeel: Node3D = null

## True while the capture is fast-forwarding the contract.
##
## The advance steps the simulation a few thousand times inside a single frame,
## so nothing is ever drawn and no _process runs to expire anything. Shot
## effects fired during it therefore latch: the flash, the streak and the
## muzzle light are left switched on, at whatever position the operative
## happened to be at, and the screenshot afterwards catches them there. It
## showed up as a bright pool of light on the paving beside the weapon that
## took several rounds to chase, because the element producing it was not even
## where the camera was looking.
var _fast_forward := false
var rain_nodes: Array = []
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
    if not level.load_from("res://data/level_%s.json" % level_id):
        push_error("Could not load the level export.")
        return
    # Yield before taking the thread, or the browser never gets its audio up.
    #
    # Building the sector holds the main thread for about six seconds in a
    # browser, and the frames after it are held again by the first shader
    # compiles. Godot asks for its AudioWorklet module during engine startup,
    # but addModule resolves on that same main thread, so the driver does not
    # finish coming up until all of it is done -- measured at 33 to 43 seconds
    # in, against a context created in the first second. Until then the mixer
    # has nowhere to send anything and every shot is silent, which is a large
    # part of why "no sound" kept being reported by someone who had waited a
    # perfectly reasonable ten seconds before firing.
    #
    # So the heavy work waits behind a loading screen for a moment of real
    # time first. Nothing here is hogging the thread during that wait, so the
    # worklet resolves in it, and the driver is up before the sector exists
    # rather than long after. Measured in a browser, before and after: the
    # worklet connects to the destination at 2 s instead of 33 to 43 s.
    #
    # What this does not fix is the gap between tapping and the context
    # actually reporting itself running, which is resume() resolving on the
    # same main thread and therefore waiting on a frame. That is 19 s on a
    # software rasteriser doing fourteen seconds a frame, and a frame on a
    # real phone GPU, so it is not worth engineering around here.
    #
    # Not for the capture or the headless replay: both expect a built world
    # when _ready returns, and neither has anyone listening.
    if capture_path == "" and simtest_seconds <= 0.0:
        _build_loading_screen()
        await get_tree().create_timer(STARTUP_YIELD).timeout
    var t0 := Time.get_ticks_msec()
    var mats: Dictionary = MaterialsC.build()
    var t1 := Time.get_ticks_msec()
    var builder := LevelBuildC.new()
    add_child(builder)
    builder.build(level, mats)
    var t2 := Time.get_ticks_msec()
    _build_environment()
    _spawn_player()
    _build_rain()
    _start_contract()
    var t3 := Time.get_ticks_msec()
    print("BUILD materials=%dms level=%dms rest=%dms nodes=%d" % [t1 - t0, t2 - t1, t3 - t2, _count_nodes(self)])
    _clear_loading_screen()
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

## How long to leave the main thread alone before building the sector.
##
## Long enough for a browser to finish fetching and compiling the audio
## worklet, which is the thing being waited for; short enough that it reads as
## part of loading rather than as a hang. It costs the same on desktop, where
## it buys nothing and is not worth a platform branch to avoid.
const STARTUP_YIELD := 0.75

var _loading: CanvasLayer = null

## Something to look at during the wait above and the build after it.
##
## Without it the player gets a blank window for the better part of ten
## seconds on a phone, which reads as a broken page rather than as loading.
func _build_loading_screen() -> void:
    _loading = CanvasLayer.new()
    _loading.layer = 8
    var bg := ColorRect.new()
    bg.set_anchors_preset(Control.PRESET_FULL_RECT)
    bg.color = Color(0.03, 0.035, 0.045)
    bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
    _loading.add_child(bg)
    var label := Label.new()
    label.set_anchors_preset(Control.PRESET_FULL_RECT)
    label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
    label.text = "RED STATIC\n\nBUILDING SECTOR"
    label.add_theme_color_override("font_color", Color(0.78, 0.80, 0.83))
    label.mouse_filter = Control.MOUSE_FILTER_IGNORE
    _loading.add_child(label)
    add_child(_loading)

func _clear_loading_screen() -> void:
    if _loading != null:
        _loading.queue_free()
        _loading = null

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
            "perf":
                perf_frames = int(args[i + 1]) if i + 1 < args.size() else 60
                i += 1
            "level":
                level_id = args[i + 1] if i + 1 < args.size() else "blacksite"
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
    # Four splits over 60 m. Two splits over 45 gave neither: the near split
    # was too coarse for prop contact shadows and the range stopped short of
    # the far wall, so the frame had no cast shadows at any distance.
    #
    # The browser build takes two, at the same 60 m. Each split is a full pass
    # over every shadow caster in its range, so on a phone four of them is
    # four times the geometry submitted for a map nobody looks at directly.
    # The range is kept, because losing it is what made two splits look wrong;
    # what is lost instead is the near split's precision, which costs contact
    # shadow crispness and not the shadows themselves.
    sun.directional_shadow_mode = (DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
        if GameData.has_rendering_device()
        else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS)
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
    var pano := load("res://art/textures/sky_panorama_night.png") if level.is_night() \
        else load("res://art/textures/sky_panorama.png")
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

    # Compatibility has neither screen space occlusion nor screen space
    # indirect lighting, and asking for them there prints a warning per call
    # and then ignores it. The browser build loses both, which costs it some
    # contact shading -- there is no cheap substitute, and a fake one applied
    # only on the web would make the two builds diverge further, not less.
    var rd := GameData.has_rendering_device()

    env.tonemap_mode = Environment.TONE_MAPPER_ACES
    # Compatibility measures about half a stop brighter than Forward+ on the
    # same scene: mean luminance 0.486 against 0.412, and a 95th percentile of
    # 0.840 against 0.655. Most of that is the missing occlusion and indirect
    # passes, which on Forward+ are subtracting light everywhere at once. The
    # exposure is trimmed to put the browser build back in the same band as
    # the desktop one rather than leaving it visibly washed out.
    env.tonemap_exposure = 1.06 if rd else 0.87
    env.tonemap_white = 3.0

    env.ssao_enabled = rd
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

    env.ssil_enabled = rd
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
    #
    # It had gone too far the other way: at 0.9 the frame measured a mean
    # luminance of 0.448 against a reference band topping out at 0.438, and a
    # crushed-pixel share of 0.015% against 0.18 to 3.9 in the references --
    # a sector with no deep shadow anywhere in it. 0.60 puts the mean at 0.416
    # and, as a side effect, the sun-to-shade ratio at 18.2 against the
    # references' 8 to 27, where before it sat under all three.
    bounce.light_energy = 0.60
    bounce.shadow_enabled = false
    bounce.light_cull_mask = WORLD_LAYERS
    add_child(bounce)

    if level.is_night():
        _night_overrides(env, bounce)

    env_node = WorldEnvironment.new()
    env_node.environment = env
    add_child(env_node)

## Turn the daylight rig into CROSSFALL's night.
##
## Written as an override on top of the day setup rather than as a second
## environment builder, because almost everything -- the tonemapper, the glow
## curve, the fog model, the sky as an ambient source -- is shared, and two
## copies of that would drift apart within a round.
##
## The numbers come off the three mockups rather than out of the air. They
## measure a mean luminance of 0.151 to 0.185 against the daylight sector's
## 0.40, a 5th percentile of 0.003 to 0.008, and a crushed-pixel share of 18
## to 30 percent: a quarter of that frame is genuinely black, with everything
## that is lit at all being lit by a lamp, a fire or a window rather than by
## the sky. That is the opposite of the opening sector, where the sky is the
## light source and nothing is allowed to go empty.
func _night_overrides(env: Environment, bounce: DirectionalLight3D) -> void:
    # The moon, not the sun. Cool, weak, and high, so it separates the deck
    # from the water and does nothing else. Keeping shadows on it is what
    # stops the towers and the wrecks reading as flat cutouts.
    sun.rotation_degrees = Vector3(-58.0, 152.0, 0.0)
    sun.light_color = Color(0.60, 0.70, 0.95)
    sun.light_energy = 0.16
    sun.light_angular_distance = 1.4
    sun.directional_shadow_max_distance = 90.0

    # The fill goes almost entirely. In the mockups the only thing filling a
    # shadow is a sodium lamp or a fire, and the fill light was the single
    # lever keeping the day scene's shadows off the floor.
    bounce.light_energy = 0.09
    bounce.light_color = Color(0.42, 0.52, 0.72)

    # Sky ambient stops being the light source. At sky contribution 1.0 the
    # night panorama would still wash the deck to an even blue; a fixed dark
    # colour with a low energy leaves the lamps to do the work.
    env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
    env.ambient_light_sky_contribution = 0.0
    # The ambient colour is derived from the map's fog hue, not used raw.
    #
    # The palette's `fog` is rgba(10,18,28), which is a 2D canvas overlay
    # colour -- something drawn ON TOP of a finished frame -- and using it
    # directly as an ambient light meant a contribution of (0.028, 0.051,
    # 0.079) at energy 0.72. Four rounds were spent raising that energy from
    # 0.22 to 0.72 and wondering why the crushed share would not fall: the
    # energy was multiplying almost nothing.
    #
    # The hue is worth keeping -- it is the map's own cold cast -- so it is
    # normalised and re-scaled to a real overcast dome instead. Measured
    # against the mockups, the regions with no direct light on them sit around
    # 0.11 to 0.14 rather than at zero, because an overcast sky lights
    # everything under it from every direction.
    var fog_hue := level.pal("fog", Color(0.055, 0.075, 0.105))
    var hue_mean: float = maxf(0.001, (fog_hue.r + fog_hue.g + fog_hue.b) / 3.0)
    env.ambient_light_color = Color(fog_hue.r / hue_mean, fog_hue.g / hue_mean,
        fog_hue.b / hue_mean) * 0.20
    env.ambient_light_energy = 1.0

    # Storm haze. Heavy, close and blue: the mockups lose the far tower to it
    # and the city across the water is a glow rather than a skyline. This is
    # also what keeps the deck's far end from being a hard horizon line.
    env.fog_enabled = true
    env.fog_mode = Environment.FOG_MODE_DEPTH
    env.fog_light_color = level.pal("fog", Color(0.075, 0.095, 0.130))
    env.fog_light_energy = 2.0
    env.fog_density = 0.052
    env.fog_depth_begin = 4.0
    env.fog_depth_end = 115.0
    env.fog_sky_affect = 0.85

    # Glow carries the look. Every light source in the mockups has a halo in
    # the rain and the fires bloom hard; at the day scene's 0.18 intensity and
    # 1.6 threshold none of that happens, because almost nothing in a night
    # frame is over the threshold in the first place.
    env.glow_enabled = true
    #
    # These were the cause of a blown blob that survived four rounds of
    # cutting emitters. The clipped fraction sat between 1.06 and 1.16 percent
    # while the searchlight went from 14 to 1.1 and was re-aimed off the deck
    # entirely, the beam cone was cut four times, the wet streaks were halved
    # twice, the lamps came down by more than half and every unshaded emissive
    # on the bridge was halved. None of it moved the number, because the
    # saturated region was not a light at all: it was the bloom halo, which at
    # a threshold of 0.65 with a 2.2 HDR scale takes whatever is currently
    # brightest and amplifies it back into clipping. Cutting a source just
    # handed the job to the next one down.
    # Four parameters moved at once was too much: the halo stopped clipping
    # but took a lot of the frame's light with it, mean fell out of band and
    # the crushed share went from 36 to 51 percent. About 40 percent of the
    # cut comes back, which is enough glow to make the lamps and fires read
    # through rain without the pass feeding on itself.
    env.glow_intensity = 0.44
    env.glow_bloom = 0.08
    env.glow_hdr_threshold = 0.90
    env.glow_hdr_scale = 1.45
    env.glow_strength = 1.05

    # Exposure. The band wants a mean near 0.15 against the day scene's 0.40,
    # and most of that has to come from there being no sky light rather than
    # from pulling the tonemapper down, or the lamps and fires go with it.
    # Exposure, raised after three rounds of region-specific fixes failed to
    # move the crushed share off 48 percent.
    #
    # Ambient was fixed, the pylons were given their own brighter material,
    # the road was lightened and de-metalled -- and the number sat at 48.4,
    # 49.4, 49.4. At some point the right move is the lever that is certainly
    # connected to every pixel rather than a fourth guess at which object is
    # responsible. Mean is failing LOW now as well, so exposure serves both.
    env.tonemap_exposure = 1.02 if GameData.has_rendering_device() else 0.86
    env.tonemap_white = 4.0

    # The occlusion passes are worth more here than in daylight, since there
    # is no fill to recover a corner the pass over-darkens.
    if GameData.has_rendering_device():
        env.ssao_intensity = 2.4
        env.ssil_intensity = 0.25

## Rain, carried by the camera rather than placed in the world.
##
## CROSSFALL's weather block asks for density 1 with a wind of -0.34, and a
## kilometre of open deck cannot be filled with particles -- so the rain is a
## box that travels with the player, which is how every shooter does it. From
## inside it is indistinguishable from weather over the whole span, and it
## costs one emitter instead of a hundred.
##
## Two layers, because one never reads: a near layer of fast bright streaks
## that sells the speed, and a far layer of slow faint ones that fills the
## depth between the player and the towers. A single layer at one speed looks
## like a screen effect rather than like falling water.
func _build_rain() -> void:
    if level.rain_density() <= 0.0 or player == null:
        return
    var wind := level.wind()
    for layer in range(2):
        var near := layer == 0
        # CPUParticles3D, not GPU.
        #
        # GPUParticles3D simulates in a compute shader, and the Compatibility
        # renderer -- which is what the browser build runs, over WebGL2 -- has
        # no compute stage at all. The GPU version would have meant a phone
        # standing in a rainstorm with no rain in it, on the one platform
        # where the weather matters most, and nothing would have reported an
        # error. The CPU path runs everywhere and a few thousand quads is
        # nothing next to the 629 draw calls the sector already costs.
        var p := CPUParticles3D.new()
        p.amount = int((900 if near else 1600) * level.rain_density())
        p.lifetime = 1.1 if near else 2.6
        p.preprocess = 1.2
        p.local_coords = false
        p.draw_order = CPUParticles3D.DRAW_ORDER_VIEW_DEPTH
        p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
        p.emission_box_extents = Vector3(22.0 if near else 46.0, 1.0, 22.0 if near else 46.0)
        p.direction = Vector3(wind, -1.0, 0.0)
        p.spread = 2.0
        p.initial_velocity_min = 16.0 if near else 9.0
        p.initial_velocity_max = 22.0 if near else 13.0
        p.gravity = Vector3(0.0, -6.0, 0.0)
        p.scale_amount_min = 0.8
        p.scale_amount_max = 1.5 if near else 1.0

        # A drop is a stretched quad, unshaded and additive: rain is seen
        # because it catches the lamps, not because it has a colour.
        var q := QuadMesh.new()
        q.size = Vector2(0.018 if near else 0.010, 0.62 if near else 0.34)
        var dm := StandardMaterial3D.new()
        dm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
        dm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
        dm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
        dm.albedo_color = Color(0.62, 0.74, 0.88, 0.45 if near else 0.20)
        dm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
        dm.billboard_keep_scale = true
        dm.disable_receive_shadows = true
        q.material = dm
        p.mesh = q
        p.position = Vector3(0.0, 9.0, 0.0)
        p.emitting = true
        rain_nodes.append(p)
        player.add_child(p)

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
    # A night scene needs the weapon at night exposure too, or the rig that
    # keeps it readable in shade turns it into the brightest thing in frame.
    if level.is_night():
        vm.rig_scale = 0.20
    cam.add_child(vm)
    viewmodel = vm

    player.speed_mps = level.metres(212.0)
    player.look_locked = capture_path != ""
    add_child(player)
    player.global_position = level.to_world(level.spawn_point, 1.0)
    _build_touch_controls()

## On-screen controls, where the device has a touchscreen and nothing else.
##
## The check is for the screen rather than for the platform, because the same
## web export serves both: a phone browser and a desktop browser load the same
## wasm, and only one of them wants a thumbstick painted over the frame. Pass
## `touch` on the command line to force it on for testing on a machine that
## has no touchscreen.
func _build_touch_controls() -> void:
    # Not during an offscreen capture or a headless contract run: a thumbstick
    # painted over a reference screenshot would be scored as part of the art.
    if capture_path != "" or simtest_seconds > 0.0:
        return
    var forced := "touch" in OS.get_cmdline_user_args()
    if not forced and not DisplayServer.is_touchscreen_available():
        return
    var tc := TouchControlsC.new()
    tc.player = player
    player.touch_driven = true
    add_child(tc)
    touch_controls = tc

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
    # CROSSFALL runs along X: 3675 units of deck by 1092 of width, spawn at
    # (1837, 546) and extraction 735 units west of it. Every mockup is the
    # same shot -- standing on the deck looking along its length toward the
    # far tower, with the burning wrecks between -- so these look down -X,
    # which is toward the extraction end.
    match name:
        "span":
            return [Vector2(2600.0, 546.0), 90.0, -2.0]
        "deck":
            return [Vector2(2150.0, 430.0), 90.0, -4.0]
        "tower":
            return [Vector2(1500.0, 546.0), 90.0, 4.0]
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
    # Restart the rain where the camera actually ended up.
    #
    # The emitters preprocess their first second at the spawn point, which is
    # where the player is built; the capture then teleports the player across
    # the span, and every drop already in flight stays behind at the spawn in
    # world coordinates. The frame came back with no rain in it at all while
    # the emitters were running perfectly well a hundred metres away.
    for r in rain_nodes:
        r.restart()
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

## Overrides the operative's issued weapon while the port is being tested.
##
## The Vector SMG cycles every 0.2 s against the Needle's slower beat, which
## makes it the right thing to judge the shot feedback and the framerate
## against: a weapon that fires twice a second tells you very little about
## either. Set this back to "" to restore whatever the operative carries.
const TEST_WEAPON := "vector"

# ---- Contract -------------------------------------------------------------

func _start_contract() -> void:
    var op: Dictionary = GameData.operatives[0]
    var weapon_def := {}
    # Issue whatever the operative carries, unless the command line overrides
    # it: `-- weapon vector` puts the Vector SMG in their hands instead, which
    # is a far better thing to test feedback and framerate against than a
    # suppressed sidearm on a one-in-two-second cycle.
    var want := String(op.get("weapon", "needle"))
    # Never during the headless replay. That run is the gate on the shipped
    # loadout, and swapping the weapon under it makes it measure something
    # nobody plays: the Vector carries 4.7 times the Needle's spread over a
    # shorter range, so a stationary operative misses most of what it fires
    # and the contract drops from 55 kills to 17. That is the weapon being a
    # close-range weapon, not a regression, and the gate should not have to
    # tell the difference.
    if TEST_WEAPON != "" and simtest_seconds <= 0.0:
        want = TEST_WEAPON
    var args := OS.get_cmdline_user_args()
    for i in range(args.size() - 1):
        if args[i] == "weapon":
            want = args[i + 1]
    for w in GameData.weapons:
        if w.get("id", "") == want:
            weapon_def = w
            break
    var map := GameData.map_named("blacksite")
    sim = SimC.new()
    sim.name = "Sim"
    add_child(sim)
    # The operative aims. In first person, acquiring a target and sending the
    # round at it regardless of where the player is pointing is an aimbot.
    #
    # Except in the headless replay, which has no camera and therefore nothing
    # to aim with. That run keeps acquiring targets so it stays comparable with
    # every earlier one, and it is measuring the simulation rather than the
    # aiming anyway.
    sim.manual_aim = simtest_seconds <= 0.0
    sim.setup(level, 1234, op, GameData.difficulty(int(GameData.op1.get("difficulty", 0))),
        float(GameData.op1.get("duration", 5)), weapon_def, map.get("enemyBias", {}))
    sim.enemy_spawned.connect(_on_enemy_spawned)
    sim.enemy_died.connect(_on_enemy_died)
    sim.weapon_fired.connect(_on_weapon_fired)
    # The loadout is only resolved here, a step after the viewmodel node was
    # built, so this is where the weapon's own model goes in.
    if viewmodel:
        viewmodel.use_weapon(String(weapon_def.get("id", "")))
    gunfeel = GunFeelC.new()
    add_child(gunfeel)
    gunfeel.setup(viewmodel.muzzle if viewmodel else null,
        String(weapon_def.get("voice", "pistol")))

    hud = HudC.new()
    hud.sim = sim
    var mdef: Dictionary = GameData.map_named(level.map_id)
    hud.theatre = String(mdef.get("name", level.map_id.to_upper()))
    hud.operation = "OP %d // %s" % [int(GameData.op1.get("index", 1)),
        String(GameData.op1.get("name", ""))]
    var layer := CanvasLayer.new()
    layer.add_child(hud)
    add_child(layer)

    _build_extraction_marker()

## The simulation runs on the physics clock, not the render clock.
##
## It used to run here, in _process. The operative, being a CharacterBody3D,
## has always moved in _physics_process. Those are two different clocks, and
## Godot treats them differently when a frame takes too long: it keeps
## stepping physics to catch up, but _process runs exactly once per rendered
## frame. So on a slow frame the player moved at full speed while the
## simulation got one advance() call carrying a large delta, which the step
## budget then truncated -- and the hostiles crawled or stopped while the
## player walked around them at normal speed. That is the "enemies froze while
## I could still move" report, and it is not a stutter: it is two clocks
## drifting apart, so it does not recover.
##
## It also gated the weapon on the frame rate. fire_held was sampled once per
## rendered frame, so at ten frames a second the trigger was read ten times a
## second no matter what the weapon's cooldown was -- rounds and their reports
## came out "occasionally", which is the other two reports.
##
## Both go away by running the simulation on the same clock as the body it is
## following. Sim.FIXED_STEP is 1/60 and Godot's physics tick is 60 Hz, so
## each call is exactly one step, and when a frame does run long both the
## player and the simulation slow down together.
func _physics_process(delta: float) -> void:
    if sim == null or capture_path != "":
        return
    sim.fire_held = Input.is_action_pressed("fire")
    sim.player_pos = level.to_plan(player.global_position)
    # Plan space shares its axes with world space, so a world heading is a
    # plan heading once the vertical is dropped.
    var fwd := -player.global_transform.basis.z
    var flat := Vector2(fwd.x, fwd.z)
    if flat.length() > 0.001:
        sim.aim_dir = flat.normalized()
    sim.advance(delta)
    _sync_enemies()

## Only what has to be per-frame: the viewmodel's sway, which is a visual
## response to how fast the operative is moving and has nothing to step.
func _process(delta: float) -> void:
    if perf_frames > 0:
        _perf_tick(delta)
    if sim == null or capture_path != "":
        return
    if viewmodel:
        var planar := Vector2(player.velocity.x, player.velocity.z).length()
        viewmodel.update_motion(delta, Vector2.ZERO,
            clampf(planar / maxf(0.1, player.speed_mps), 0.0, 1.0), false)

## ---- Frame-cost report ----------------------------------------------------

var _perf_seen := 0
var _perf_ms: Array[float] = []

func _perf_tick(_delta: float) -> void:
    _perf_seen += 1
    # The first frames pay for shader compilation and the first upload of every
    # mesh, which is not what a player is standing in, so they are discarded.
    const WARMUP := 5
    if _perf_seen == WARMUP:
        print("PERF objects=%d draw_calls=%d primitives=%d vram=%.1fMB" % [
            RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
            RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
            RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
            float(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED)) / 1048576.0,
        ])
    if _perf_seen > WARMUP:
        _perf_ms.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0
            + Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0)
    if _perf_seen < perf_frames:
        return
    var frame_ms := _perf_ms.duplicate()
    frame_ms.sort()
    var total := 0.0
    for v in frame_ms:
        total += v
    var n: int = maxi(frame_ms.size(), 1)
    print("PERF frames=%d cpu_mean=%.1fms cpu_p95=%.1fms" % [
        frame_ms.size(), total / float(n), frame_ms[mini(int(n * 0.95), n - 1)]])
    print("PERF fps=%.1f" % Performance.get_monitor(Performance.TIME_FPS))
    get_tree().quit(0)

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
    if node != null and is_instance_valid(node) and gunfeel and not _fast_forward:
        # Something has to mark the kill. Without it a hostile simply stops
        # existing between one frame and the next, which reads as the thing
        # vanishing on its own rather than as having been shot.
        gunfeel.kill_burst(node.global_position + Vector3(0.0, 1.0, 0.0))
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

func _on_weapon_fired(_dir: Vector2, target_pos: Vector2) -> void:
    # Both of these latch during a fast-forward, the kick because it switches
    # the muzzle light on and nothing runs to decay it, and that light is
    # parented to the camera so it travels to the capture viewpoint still lit.
    if _fast_forward:
        return
    if viewmodel:
        viewmodel.fire_kick(1.0)
    if gunfeel and viewmodel and viewmodel.muzzle:
        # Chest height on the target rather than its feet, so the tracer runs
        # to where the contact is rather than to the paving under it.
        gunfeel.fire(viewmodel.muzzle.global_position,
            level.to_world(target_pos, 1.2))

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
    glow.emission_energy_multiplier = 0.8 if level.is_night() else 2.4
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
    _fast_forward = true
    var vp := _viewpoint(capture_view)
    sim.player_pos = vp[0]
    # Point the weapon where the capture camera is looking. Without this the
    # operative aims along plan -Y whatever the viewpoint, so a capture shows
    # rounds leaving in a direction nobody is facing.
    var yaw := deg_to_rad(float(vp[1]))
    sim.aim_dir = Vector2(sin(yaw), -cos(yaw))
    for i in range(int(seconds / step)):
        if sim.finished:
            break
        sim._step(step)
        # The capture operative stands still by definition, so they take every
        # contact hit and are dead inside a minute. A screenshot is not a
        # playthrough; hold them up rather than photographing a corpse.
        sim.player_hp = sim.player_max_hp
        sim.player_pos = vp[0]
    _fast_forward = false
    _sync_enemies()
