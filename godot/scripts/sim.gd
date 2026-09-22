class_name Sim
extends Node

## The contract, running in the 2D game's own coordinates and numbers.
##
## This is the part the owner asked to keep. Everything here works in plan
## units and seconds exactly as src/game/ does — spawn distances, wave sizes,
## archetype stats, weapon cooldowns, the five-minute clock, the extraction
## hold — and the 3D scene is only a view onto it. Positions are converted to
## metres at the last moment, when a visual node is moved.
##
## Two mechanics carry over that are unusual for a first-person game, and they
## are kept because they are the game:
##
##  * **Weapons fire themselves.** RED STATIC is a survival roguelite; the
##    operative moves and dodges while their loadout engages automatically on
##    its own cooldown, picking targets by the weapon's `targeting` rule. The
##    player aims their *body and attention*, not a crosshair.
##  * **Threat is scheduled, not placed.** The director escalates waves on a
##    wall-clock curve rather than the sector holding a fixed roster.

const FIXED_STEP := 1.0 / 60.0

## Wall-clock span over which escalation reaches its ceiling, whatever the
## contract length. From src/game/director.js.
const ESCALATION_SECONDS := 12.0 * 60.0
const SPAWN_DISTANCE_MIN := 520.0
const SPAWN_DISTANCE_MAX := 1100.0
const EXTRACTION_RADIUS := 95.0
const EXTRACTION_HOLD := 2.5

enum WaveState { LULL, DEPLOY, SUSTAIN, SURGE }

var level: Level
var rng: Rng
var difficulty: Dictionary = {}
var duration_seconds: float = 300.0
var enemy_bias: Dictionary = {}

var elapsed: float = 0.0
var accumulator: float = 0.0
var finished: bool = false
var outcome: String = ""

# Operative
var player_pos: Vector2 = Vector2.ZERO
var player_hp: float = 100.0
var player_max_hp: float = 100.0
var player_level: int = 1
var player_xp: float = 0.0
var player_xp_next: float = 12.0
var kills: int = 0
var invuln: float = 0.0
var shots_fired: int = 0
var rounds_hit: int = 0
var rounds_expired: int = 0
var rounds_blocked: int = 0
## Passive growth, the same currency the 2D game spends on adaptations.
var player_armor: float = 0.0
var player_regen: float = 0.0
var speed_bonus: float = 0.0

# Contract
var extraction_active: bool = false
var extraction_hold: float = 0.0

# Director
var state: int = WaveState.LULL
var state_timer: float = 3.0
var wave_index: int = 0
var spawn_queue: Array = []
var spawn_timer: float = 0.0
var pressure: float = 0.0

var enemies: Array = []
var projectiles: Array = []
var enemy_projectiles: Array = []

var weapon: Dictionary = {}
var weapon_cooldown: float = 0.0
var weapon_level: int = 1

signal enemy_spawned(e)
signal enemy_died(e)
## `target_pos` is where the round is actually going, in plan coordinates, so
## the presentation can draw a tracer that agrees with the hit rather than
## guessing an endpoint from the direction and the weapon's range.
signal weapon_fired(target_dir, target_pos)
signal player_hurt(amount)
signal level_gained(level)

func setup(lvl: Level, seed_value: int, op: Dictionary, diff: Dictionary,
        minutes: float, weapon_def: Dictionary, bias: Dictionary) -> void:
    level = lvl
    rng = Rng.new(seed_value)
    difficulty = diff
    duration_seconds = minutes * 60.0
    enemy_bias = bias
    weapon = weapon_def
    player_max_hp = float(op.get("hp", 100))
    player_hp = player_max_hp
    player_pos = lvl.spawn_point

func progress() -> float:
    return clampf(elapsed / duration_seconds, 0.0, 1.0)

func escalation() -> float:
    var by_clock := clampf(elapsed / ESCALATION_SECONDS, 0.0, 1.0)
    return clampf(by_clock * 0.7 + progress() * 0.3, 0.0, 1.0)

func enemy_cap() -> int:
    # Ramp shape over ceiling: the opening stays sparse, the midpoint reaches
    # about half, and real saturation is saved for the closing minutes.
    var ramp := 0.16 + pow(escalation(), 1.7) * 0.84
    var extraction_thinning := 0.35 if extraction_active else 1.0
    var density := float(difficulty.get("densityMult", 1.0))
    return int(round(68.0 * ramp * density * extraction_thinning))

## Advance by real time, stepping the simulation at a fixed rate so the
## contract plays out identically regardless of frame rate.
## Steps the simulation at a fixed rate, catching up across slow frames.
##
## The catch-up has to be allowed to give up, and the first version could not.
## It added up to 0.25 s of real time to the accumulator per frame but drained
## at most six steps, which is 0.1 s. Below ten frames a second that is a
## deficit every frame, and the accumulator grows without bound: the
## simulation falls further behind wall-clock time for as long as the game
## runs and never recovers, even once the framerate does. From inside, hostiles
## slow to a crawl and then appear to stop entirely, while the operative --
## who moves in _physics_process and does not depend on this at all -- keeps
## walking around a frozen sector.
##
## So when the step budget is spent, the backlog is dropped rather than
## carried. The simulation then runs coarsely on a slow device instead of
## accurately in the past, which is the right trade: a hostile that advances
## in bigger jumps is a game, and one that stopped forty seconds ago is not.
##
## That stopped the drift from being permanent but not from happening, because
## the cause was upstream: the caller was the render loop. It is now the
## physics loop, at the same 60 Hz as FIXED_STEP, so each call is one step and
## the budget below is never reached in play. It still matters for the
## headless replay, which drives this directly, and as the floor under any
## caller that feeds it real time.
const MAX_STEPS := 6

func advance(delta: float) -> void:
    if finished:
        return
    accumulator += minf(delta, 0.25)
    var steps := 0
    while accumulator >= FIXED_STEP and steps < MAX_STEPS:
        _step(FIXED_STEP)
        accumulator -= FIXED_STEP
        steps += 1
    if steps >= MAX_STEPS:
        accumulator = 0.0

func _step(dt: float) -> void:
    elapsed += dt
    invuln = maxf(0.0, invuln - dt)
    if player_regen > 0.0 and player_hp < player_max_hp:
        player_hp = minf(player_max_hp, player_hp + player_regen * dt)
    _step_director(dt)
    _step_enemies(dt)
    _step_weapon(dt)
    _step_projectiles(dt)
    _step_objective(dt)

# ---- Director -------------------------------------------------------------

func _archetypes() -> Array:
    var out: Array = []
    for e in GameData.enemies:
        var min_t := float(e.get("minTime", 0))
        if elapsed >= min_t:
            out.append(e)
    if out.is_empty() and GameData.enemies.size() > 0:
        out.append(GameData.enemies[0])
    return out

func _pick_archetype() -> Dictionary:
    var list := _archetypes()
    # Weighted by the theatre's own enemyBias, so Blacksite Zero fields the
    # units data/maps.js says it fields.
    var total := 0.0
    for e in list:
        total += float(enemy_bias.get(e.get("id", ""), 1.0))
    var roll := rng.next() * total
    for e in list:
        roll -= float(enemy_bias.get(e.get("id", ""), 1.0))
        if roll <= 0.0:
            return e
    return list[list.size() - 1]

func _step_director(dt: float) -> void:
    state_timer -= dt
    pressure = clampf(float(enemies.size()) / maxf(1.0, float(enemy_cap())), 0.0, 1.0)
    if state_timer <= 0.0:
        _advance_state()
    if not spawn_queue.is_empty():
        spawn_timer -= dt
        if spawn_timer <= 0.0:
            var req: Dictionary = spawn_queue.pop_front()
            if enemies.size() < enemy_cap():
                _execute_spawn(req)
            spawn_timer = float(req.get("gap", 0.1))

func _advance_state() -> void:
    var p := progress()
    match state:
        WaveState.LULL:
            state = WaveState.DEPLOY
            _queue_wave()
            wave_index += 1
            state_timer = 4.0 + rng.range_f(0.0, 2.0)
        WaveState.DEPLOY:
            state = WaveState.SUSTAIN
            state_timer = 6.0 + rng.range_f(0.0, 4.0)
        WaveState.SUSTAIN:
            if p > 0.35 and rng.chance(0.3):
                state = WaveState.SURGE
                _queue_surge()
                state_timer = 5.0
            else:
                state = WaveState.LULL
                state_timer = clampf(6.0 - p * 4.0, 1.6, 6.0) + rng.range_f(0.0, 1.5)
        WaveState.SURGE:
            state = WaveState.LULL
            state_timer = clampf(5.0 - p * 3.0, 1.4, 5.0)

func _queue_wave() -> void:
    var esc := escalation()
    var density := float(difficulty.get("densityMult", 1.0))
    var size := int(round((3.0 + esc * esc * 17.0 + minf(float(wave_index), 26.0) * 0.28)
        * density * (1.0 + pressure * 0.3)))
    var groups := int(clampf(round(float(size) / 6.0), 1.0, 4.0))
    for g in range(groups):
        # Waves arrive as coherent squads from one or two bearings, not as a
        # uniform ring around the operative.
        var bearing := rng.angle()
        var members := int(ceil(float(size) / float(groups)))
        var lead := _pick_archetype()
        for i in range(members):
            var type: Dictionary = lead if rng.chance(0.65) else _pick_archetype()
            spawn_queue.append({"archetype": type, "bearing": bearing, "spread": 0.5, "gap": 0.1})

func _queue_surge() -> void:
    var density := float(difficulty.get("densityMult", 1.0))
    var size := int(round((8.0 + escalation() * 13.0) * density))
    var bearing := rng.angle()
    for i in range(size):
        spawn_queue.append({"archetype": _pick_archetype(), "bearing": bearing, "spread": 1.2, "gap": 0.05})

func _execute_spawn(req: Dictionary) -> void:
    var arch: Dictionary = req["archetype"]
    var bearing: float = float(req["bearing"]) + rng.range_f(-1.0, 1.0) * float(req.get("spread", 0.5))
    var distance := rng.range_f(SPAWN_DISTANCE_MIN, SPAWN_DISTANCE_MAX)
    var want := player_pos + Vector2(cos(bearing), sin(bearing)) * distance
    var radius := float(arch.get("radius", 11))
    var at := level.open_point_near(
        clampf(want.x, 80.0, level.width - 80.0),
        clampf(want.y, 80.0, level.height - 80.0), radius + 6.0, 60.0)
    _spawn(arch, at)

func _spawn(arch: Dictionary, at: Vector2) -> void:
    var hp_mult := float(difficulty.get("hpMult", 1.0))
    var speed_mult := float(difficulty.get("speedMult", 1.0))
    var dmg_mult := float(difficulty.get("damageMult", 1.0))
    var e := {
        "id": arch.get("id", "scout"),
        "def": arch,
        "pos": at,
        "vel": Vector2.ZERO,
        "radius": float(arch.get("radius", 11)),
        "hp": float(arch.get("hp", 20)) * hp_mult,
        "max_hp": float(arch.get("hp", 20)) * hp_mult,
        "speed": float(arch.get("speed", 120)) * speed_mult,
        "damage": float(arch.get("damage", 6)) * dmg_mult,
        "range": float(arch.get("range", 0)),
        "cooldown": float(arch.get("cooldown", 1.4)),
        "fire_timer": rng.range_f(0.2, 1.2),
        "contact_timer": 0.0,
        "render": arch.get("render", "soldier"),
        "xp": float(arch.get("xp", 3)),
        "hit_flash": 0.0,
        "dead": false,
        "node": null,
    }
    enemies.append(e)
    enemy_spawned.emit(e)

# ---- Enemies --------------------------------------------------------------

func _step_enemies(dt: float) -> void:
    var i := enemies.size() - 1
    while i >= 0:
        var e: Dictionary = enemies[i]
        if e["dead"]:
            enemies.remove_at(i)
            i -= 1
            continue
        _step_enemy(e, dt)
        i -= 1

func _step_enemy(e: Dictionary, dt: float) -> void:
    e["hit_flash"] = maxf(0.0, float(e["hit_flash"]) - dt * 4.0)
    var to_player: Vector2 = player_pos - e["pos"]
    var dist := to_player.length()
    var dir := to_player / maxf(0.001, dist)
    var shooter: bool = float(e["range"]) > 0.0

    # Ranged units close to their stand-off distance and hold; melee close all
    # the way. Same rule the 2D AI uses.
    var want_dist: float = float(e["range"]) * 0.72 if shooter else float(e["radius"]) + 14.0
    var move := 1.0
    if dist < want_dist * 0.85:
        move = -0.6
    elif dist < want_dist:
        move = 0.0
    var step: Vector2 = dir * float(e["speed"]) * move * dt
    _move_entity(e, step)

    if shooter:
        e["fire_timer"] = float(e["fire_timer"]) - dt
        if float(e["fire_timer"]) <= 0.0 and dist < float(e["range"]) * 1.1 \
                and level.has_line_of_sight(e["pos"], player_pos):
            e["fire_timer"] = float(e["cooldown"])
            enemy_projectiles.append({
                "pos": e["pos"],
                "vel": dir * float(e["def"].get("projectileSpeed", 300)),
                "damage": float(e["damage"]),
                "life": 3.0,
            })
    else:
        e["contact_timer"] = maxf(0.0, float(e["contact_timer"]) - dt)
        if dist < float(e["radius"]) + 16.0 and float(e["contact_timer"]) <= 0.0:
            e["contact_timer"] = 0.75
            _hurt_player(float(e["damage"]))

## Substepped movement with rectangle depenetration, the same construction the
## 2D world uses: no step is longer than the body is wide, so nothing can pass
## through a solid it would have had to cross.
func _move_entity(e: Dictionary, step: Vector2) -> void:
    var radius: float = float(e["radius"])
    var distance := step.length()
    var limit: float = maxf(4.0, radius * 0.75)
    var steps := 1
    if distance > limit:
        steps = int(min(8.0, ceil(distance / limit)))
    var per := step / float(steps)
    for i in range(steps):
        e["pos"] = e["pos"] + per
        _resolve(e, radius)

func _resolve(e: Dictionary, radius: float) -> void:
    var p: Vector2 = e["pos"]
    p.x = clampf(p.x, radius + 8.0, level.width - radius - 8.0)
    p.y = clampf(p.y, radius + 8.0, level.height - radius - 8.0)
    for pass_i in range(3):
        var moved := false
        for o in level.solids():
            var hw := float(o["w"]) * 0.5
            var hh := float(o["h"]) * 0.5
            var dx: float = p.x - float(o["x"])
            var dy: float = p.y - float(o["y"])
            var ox := hw + radius - absf(dx)
            var oy := hh + radius - absf(dy)
            if ox <= 0.0 or oy <= 0.0:
                continue
            if ox < oy:
                p.x += ox * signf(dx)
            else:
                p.y += oy * signf(dy)
            moved = true
        if not moved:
            break
    e["pos"] = p

# ---- Weapon ---------------------------------------------------------------

## Per-level scaling, read straight from the registry's `scaling` block.
func _stat(key: String, base_default: float = 0.0) -> float:
    var value := float(weapon.get(key, base_default))
    var scaling: Dictionary = weapon.get("scaling", {})
    if not scaling.has(key):
        return value
    var s = scaling[key]
    var levels := weapon_level - 1
    if typeof(s) == TYPE_ARRAY:
        for i in range(mini(levels, s.size())):
            value += float(s[i])
    else:
        value += float(s) * float(levels)
    return value

## Whether the trigger is down.
##
## The 2D game fires on its own and the port followed it, which turned out to
## be the wrong call here: in first person, watching hostiles fall over with no
## input of your own does not read as shooting them, it reads as them dying by
## themselves. So the weapon waits for the trigger.
##
## It defaults to held, and nothing but the player's input ever clears it. That
## keeps the headless contract replay honest -- simtest drives no input, so the
## simulation behaves exactly as it always did and the run stays comparable
## with every earlier one.
var fire_held := true

## Where the weapon is pointed, in plan space, and whether to use it.
##
## The 2D game acquires a contact and sends the round at it. In first person
## that is an aimbot: the crosshair is decoration and the operative shoots
## whatever the simulation picked, which is not a game anyone is playing. With
## `manual_aim` set the round leaves along `aim_dir` and hits whatever happens
## to be there, or nothing.
##
## It stays off by default because the headless replay has no camera to aim
## with, so that run keeps acquiring targets and stays comparable with every
## earlier one.
var manual_aim := false
var aim_dir := Vector2(0.0, -1.0)

func _step_weapon(dt: float) -> void:
    weapon_cooldown = maxf(0.0, weapon_cooldown - dt)
    # No hostiles is not a reason to refuse. The trigger is the player's and
    # the weapon answers to it, whether or not the simulation has anything
    # worth shooting at.
    if weapon_cooldown > 0.0 or not fire_held:
        return
    var to: Vector2
    if manual_aim:
        to = aim_dir.normalized() * _stat("range", 500.0)
    else:
        var target = _acquire_target()
        if target == null:
            return
        to = Vector2(target["pos"]) - player_pos
    if to.length() < 0.001:
        return
    var cooldown: float = maxf(0.08, _stat("cooldown", 0.6))
    weapon_cooldown = cooldown
    var base := to.angle()
    var count := int(maxf(1.0, _stat("count", 1)))
    shots_fired += 1
    var spread := _stat("spread", 0.03)
    for i in range(count):
        var a := base + rng.range_f(-spread, spread)
        projectiles.append({
            "pos": player_pos,
            "vel": Vector2(cos(a), sin(a)) * _stat("speed", 600.0),
            "damage": _stat("damage", 10.0),
            "pierce": int(_stat("pierce", 0)),
            "hit": [],
            "life": _stat("range", 500.0) / maxf(1.0, _stat("speed", 600.0)),
        })
    weapon_fired.emit(to.normalized(), player_pos + to)

## Target selection by the weapon's own `targeting` rule.
func _acquire_target():
    var mode := String(weapon.get("targeting", "nearest"))
    var best = null
    var best_score := INF
    for e in enemies:
        if e["dead"]:
            continue
        var d: float = (Vector2(e["pos"]) - player_pos).length()
        # Within the weapon's actual reach, not beyond it. This was range*1.35,
        # which let the needle lock targets 700 units away while its rounds
        # expire at 520 -- so it fired continuously and never hit anything.
        if d > _stat("range", 500.0):
            continue
        # Nothing is a target through a wall. The 2D AI and targeting both
        # consult World.hasLineOfSight; without it the operative spent most of
        # a contract shooting masonry.
        if not level.has_line_of_sight(player_pos, e["pos"]):
            continue
        var score := d
        if mode == "strongest":
            score = -float(e["hp"])
        if score < best_score:
            best_score = score
            best = e
    return best

func _step_projectiles(dt: float) -> void:
    var i := projectiles.size() - 1
    while i >= 0:
        var p: Dictionary = projectiles[i]
        p["life"] = float(p["life"]) - dt
        p["pos"] = Vector2(p["pos"]) + Vector2(p["vel"]) * dt
        var gone: bool = float(p["life"]) <= 0.0
        if gone:
            rounds_expired += 1
        if not gone and level.overlaps_solid(p["pos"].x, p["pos"].y, 2.0):
            gone = true
            rounds_blocked += 1
        if not gone:
            for e in enemies:
                if e["dead"] or p["hit"].has(e):
                    continue
                if (Vector2(e["pos"]) - Vector2(p["pos"])).length() < float(e["radius"]) + 4.0:
                    _damage_enemy(e, float(p["damage"]))
                    p["hit"].append(e)
                    rounds_hit += 1
                    if p["hit"].size() > int(p["pierce"]):
                        gone = true
                    break
        if gone:
            projectiles.remove_at(i)
        i -= 1

    i = enemy_projectiles.size() - 1
    while i >= 0:
        var p: Dictionary = enemy_projectiles[i]
        p["life"] = float(p["life"]) - dt
        p["pos"] = Vector2(p["pos"]) + Vector2(p["vel"]) * dt
        var gone: bool = float(p["life"]) <= 0.0
        if not gone and level.overlaps_solid(p["pos"].x, p["pos"].y, 2.0):
            gone = true
        if not gone and (Vector2(p["pos"]) - player_pos).length() < 15.0:
            _hurt_player(float(p["damage"]))
            gone = true
        if gone:
            enemy_projectiles.remove_at(i)
        i -= 1

func _damage_enemy(e: Dictionary, amount: float) -> void:
    e["hp"] = float(e["hp"]) - amount
    e["hit_flash"] = 1.0
    if float(e["hp"]) <= 0.0 and not e["dead"]:
        e["dead"] = true
        kills += 1
        _gain_xp(float(e["xp"]))
        enemy_died.emit(e)

func _hurt_player(amount: float) -> void:
    if invuln > 0.0:
        return
    invuln = 0.35
    # Armour is flat reduction with a floor, as in the 2D game: it softens a
    # swarm without ever making a hit free.
    var taken: float = maxf(amount * 0.25, amount - player_armor)
    player_hp = maxf(0.0, player_hp - taken)
    player_hurt.emit(taken)
    if player_hp <= 0.0:
        finished = true
        outcome = "down"

func _gain_xp(amount: float) -> void:
    player_xp += amount
    while player_xp >= player_xp_next:
        player_xp -= player_xp_next
        player_level += 1
        # The 2D game offers a choice of adaptations here: weapon levels and
        # passives both. Granting only weapon levels -- the first cut of this --
        # left the operative with a maxed sidearm and a recruit's body, and the
        # headless contract died at three minutes on the easiest difficulty.
        # Rotating through the same four kinds of upgrade restores the curve
        # without a choice menu this build does not have yet.
        match player_level % 4:
            1:
                player_max_hp += 10.0
                player_hp = minf(player_max_hp, player_hp + 14.0)
            2:
                weapon_level = mini(weapon_level + 1, 8)
            3:
                player_armor = minf(player_armor + 0.9, 8.0)
            _:
                player_regen += 0.45
                speed_bonus += 0.03
        player_xp_next *= 1.22
        level_gained.emit(player_level)

# ---- Objective ------------------------------------------------------------

func _step_objective(dt: float) -> void:
    if not extraction_active and elapsed >= duration_seconds:
        extraction_active = true
    if not extraction_active:
        return
    var d := (player_pos - level.extraction_point).length()
    if d < EXTRACTION_RADIUS:
        extraction_hold += dt
        if extraction_hold >= EXTRACTION_HOLD:
            finished = true
            outcome = "extracted"
    else:
        extraction_hold = maxf(0.0, extraction_hold - dt * 0.6)

func time_remaining() -> float:
    return maxf(0.0, duration_seconds - elapsed)
