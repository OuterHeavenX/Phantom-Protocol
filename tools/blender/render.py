# The RED STATIC asset pipeline.
#
#   python3 tools/blender/render.py <asset> <out.png> <display-px>
#   python3 tools/blender/render.py all out/
#
# Assets: gunship, carrier, manticore, soldier
#
# The game rotates sprites at draw time, so each entity needs one render along
# +X rather than a sheet of rotations.
#
# THE OUTLINE IS THE POINT. The first version of this pipeline lost to the
# hand-drawn sprite at real gameplay size, and the reason was specific: every
# shape in the procedural art carries a light stroke, and that stroke — not the
# shading — is what holds a silhouette together at sixty pixels against a dark
# floor. A shaded render with no edge turns to grey mush at that size however
# good it looks at 256.
#
# So the render is done large, the alpha is dilated into a hard edge at a weight
# matched to the target display size, and only then is it downsampled. Doing it
# in post rather than with Blender's line renderer keeps the weight exact and
# independent of camera distance, which is what makes one pipeline work for a
# 26px crawler and a 120px siege platform.
import bpy, math, os, sys

# ---------------------------------------------------------------------------
# Scene construction
# ---------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name, base, metallic=.8, rough=.45, emission=None, strength=1.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m

def add(prim, name, mat, loc=(0,0,0), rot=(0,0,0), scale=(1,1,1), **kw):
    getattr(bpy.ops.mesh, prim)(location=loc, rotation=rot, **kw)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o

def hexrgb(h):
    h = h.lstrip('#')
    # sRGB to linear, because Blender's Base Color is linear and feeding it an
    # sRGB triple washes every saturated colour out — which is most of how a
    # deliberate hazard red ends up looking like grey plastic.
    def lin(c):
        c = int(h[c:c+2], 16) / 255
        return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    return (lin(0), lin(2), lin(4))

import re as _re

def registry_colours():
    """id -> hex, read straight out of data/enemies.js and data/operatives.js.

    The JS files are the only source of truth for what colour a unit is; a
    second copy here would drift and the sprite would stop matching its own
    health bar and minimap mark. Regex is enough because the registries are
    written one object per entry."""
    out = {}
    for path in ('data/enemies.js', 'data/operatives.js'):
        try:
            src = open(path).read()
        except OSError:
            continue
        for blk in _re.split(r'\n\s*\{\s*\n', src):
            i = _re.search(r"id:'(\w+)'", blk)
            c = _re.search(r"color:'(#[0-9a-fA-F]{6})'", blk)
            if i and c and i.group(1) not in out:
                out[i.group(1)] = c.group(1)
    return out

COLOURS = registry_colours()

def palette():
    # Deliberately higher contrast than looks right at full size.
    #
    # Value range is what survives a downsample; hue and fine detail are not.
    # Tuned by eye at 256px these read as slightly overdone, which is the
    # correct amount of overdone for something that will be seen at 60.
    return dict(
        hull  = material('hull',  (.22, .26, .29), metallic=.85, rough=.38),
        dark  = material('dark',  (.06, .07, .09), metallic=.6,  rough=.6),
        trim  = material('trim',  (.72, .78, .82), metallic=.9,  rough=.24),
        glass = material('glass', (.24, .58, .76), metallic=.2,  rough=.06,
                         emission=(.14,.40,.54)),
        hot   = material('hot',   (.9, .34, .1),   metallic=.3,  rough=.6,
                         emission=(1,.34,.06), strength=2.4),
        warn  = material('warn',  (.95, .74, .2),  metallic=.4,  rough=.4,
                         emission=(1,.72,.16), strength=1.8),
    )

def lighting():
    # A key from the front-left and a cool fill. A single lamp on a top-down
    # render flattens the hull into a decal; the fill is what puts a readable
    # edge on the side the key misses.
    key = bpy.data.lights.new('key', 'SUN'); key.energy = 5.5; key.angle = .28
    ko = bpy.data.objects.new('key', key); bpy.context.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(36), math.radians(12), math.radians(-44))
    fill = bpy.data.lights.new('fill', 'SUN'); fill.energy = 1.9
    fill.color = (.52, .70, 1.0)
    fo = bpy.data.objects.new('fill', fill); bpy.context.collection.objects.link(fo)
    fo.rotation_euler = (math.radians(-28), math.radians(-18), math.radians(124))

def camera(centre_x, span):
    # `centre_x` must be zero for anything the game rotates.
    #
    # The game rotates a sprite about the entity's origin, so the origin has to
    # land at the centre of the image. Framing on the model's bounding box
    # instead puts the origin off-centre — and the gunship, whose tail reaches
    # far further back than its nose reaches forward, then orbits its own
    # position instead of yawing in place. Caught by the centring assertion in
    # tools/entity-art.mjs; the fix is a wider span, not a shifted camera.
    assert centre_x == 0, 'camera must be centred on the model origin'
    # Straight down, orthographic, zero yaw. Image-right is +X, which is where
    # `ctx.rotate(enemy.angle)` expects zero degrees to face.
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = span
    cam = bpy.data.objects.new('cam', cd)
    bpy.context.collection.objects.link(cam)
    cam.location = (centre_x, 0, 14)
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam

# ---------------------------------------------------------------------------
# Assets. Each returns (camera centre on X, ortho span).
# ---------------------------------------------------------------------------

def gunship(P):
    body = add('primitive_uv_sphere_add', 'fuselage', P['hull'],
               scale=(1.72,.74,.58), segments=40, ring_count=20)
    for v in body.data.vertices:
        if v.co.x < 0:
            f = 1 + v.co.x * .34
            v.co.y *= max(.35, f); v.co.z *= max(.40, f)
    add('primitive_cylinder_add','boom',P['dark'],loc=(-2.05,0,.06),
        rot=(0,math.radians(90),0),scale=(.17,.17,1.0),vertices=18)
    add('primitive_cube_add','fin',P['hull'],loc=(-2.95,0,.30),scale=(.16,.06,.46))
    add('primitive_cylinder_add','tailrotor',P['trim'],loc=(-2.95,.18,.30),
        rot=(math.radians(90),0,0),scale=(.34,.34,.04),vertices=16)
    add('primitive_uv_sphere_add','canopy',P['glass'],loc=(.80,0,.26),
        scale=(.72,.52,.38),segments=28,ring_count=14)
    for s in (1,-1):
        w = add('primitive_cube_add',f'wing{s}',P['hull'],loc=(-.16,s*1.10,-.02),
                scale=(.40,.58,.09))
        w.rotation_euler = (0,0,s*math.radians(13))
        add('primitive_cylinder_add',f'pod{s}',P['dark'],loc=(-.20,s*1.52,-.20),
            rot=(0,math.radians(90),0),scale=(.23,.23,.56),vertices=14)
        add('primitive_cube_add',f'skid{s}',P['trim'],loc=(.10,s*.86,-.72),
            scale=(1.15,.05,.04))
        add('primitive_cylinder_add',f'exh{s}',P['hot'],loc=(-1.30,s*.40,.34),
            rot=(0,math.radians(90),0),scale=(.15,.15,.22),vertices=12)
    add('primitive_cylinder_add','rotorhead',P['trim'],loc=(0,0,.78),
        scale=(.20,.20,.18),vertices=16)
    return 0, 7.2

def carrier(P):
    # Tracked armoured carrier. Wide, flat, and unmistakably not a person.
    add('primitive_cube_add','hull',P['hull'],loc=(0,0,.1),scale=(1.5,1.02,.42))
    add('primitive_cube_add','glacis',P['hull'],loc=(1.35,0,.02),
        rot=(0,math.radians(-22),0),scale=(.5,1.0,.34))
    add('primitive_cube_add','deck',P['dark'],loc=(-.2,0,.52),scale=(1.0,.86,.08))
    for s in (1,-1):
        add('primitive_cube_add',f'track{s}',P['dark'],loc=(0,s*1.14,-.12),
            scale=(1.62,.24,.36))
        for i in range(5):
            add('primitive_cylinder_add',f'wheel{s}{i}',P['trim'],
                loc=(-1.25+i*.62,s*1.14,-.20),rot=(math.radians(90),0,0),
                scale=(.20,.20,.26),vertices=14)
        add('primitive_cube_add',f'skirt{s}',P['hull'],loc=(0,s*1.02,.06),
            scale=(1.5,.06,.3))
    # Turret and gun, offset back so the hull reads as having a front.
    add('primitive_cylinder_add','turret',P['hull'],loc=(-.25,0,.72),
        scale=(.62,.62,.26),vertices=20)
    add('primitive_cylinder_add','barrel',P['trim'],loc=(.75,0,.74),
        rot=(0,math.radians(90),0),scale=(.10,.10,1.0),vertices=12)
    add('primitive_cube_add','ramp',P['dark'],loc=(-1.52,0,.02),scale=(.12,.8,.36))
    add('primitive_cylinder_add','beacon',P['warn'],loc=(-.25,.44,.98),
        scale=(.11,.11,.10),vertices=10)
    return 0, 4.6

def boss_hull(P, spec):
    # A boss HULL. Deliberately no legs.
    #
    # `drawBoss` draws mech legs separately, animated from the gait and walk
    # phase, and the chopper's rotor disc is animated the same way. Baking
    # either into the sprite would freeze a moving part — the walker would
    # glide, which is the single most obvious way to make an expensive asset
    # look cheap. So the pipeline renders what does not move and leaves what
    # does to the runtime.
    plate  = material('plate',  hexrgb(spec['color']), metallic=.55, rough=.42)
    accent = material('accent', hexrgb(spec['accent']), metallic=.5, rough=.38,
                      emission=hexrgb(spec['accent']), strength=.5)
    core   = material('core',   hexrgb(spec['core']), metallic=.2, rough=.5,
                      emission=hexrgb(spec['core']), strength=6.0)
    frame  = P['dark']
    return plate, accent, core, frame

# Each boss's colours come from data/bosses.js so the hull cannot drift from
# its own health bar, telegraphs and minimap mark.
BOSS_SPEC={
  'manticore':{'color':'#ff665f','accent':'#ffb35c','core':'#ff7a22'},
  'carrion':  {'color':'#c895ff','accent':'#8fd8ff','core':'#b46bff'},
  'aegis':    {'color':'#7fd4c4','accent':'#f5d27a','core':'#5fe0c0'},
  'arbiter':  {'color':'#e0e6ea','accent':'#ff5b5b','core':'#ff3b3b'},
}

def manticore(P):
    # MANTICORE SIEGE PLATFORM — broad, forward-heavy, six-barrel rotary array.
    # The widest hull of the four; it should look like it is bracing.
    plate, accent, core, frame = boss_hull(P, BOSS_SPEC['manticore'])
    add('primitive_cube_add','frame',frame,loc=(0,0,.40),scale=(1.2,1.10,.44))
    add('primitive_cube_add','deck',plate,loc=(0,0,.96),scale=(1.12,1.02,.18))
    add('primitive_cube_add','glacis',plate,loc=(1.02,0,.72),
        rot=(0,math.radians(-34),0),scale=(.46,.94,.30))
    for i,off in enumerate((-.46,0,.46)):
        add('primitive_cube_add',f'chev{i}',accent,loc=(1.20,off,.88),
            rot=(0,math.radians(-34),math.radians(30)),scale=(.20,.075,.05))
    add('primitive_uv_sphere_add','sensor',P['glass'],loc=(1.06,0,.98),
        scale=(.34,.46,.22),segments=24,ring_count=12)
    for s in (1,-1):
        add('primitive_cube_add',f'pauldron{s}',plate,loc=(.50,s*1.00,1.04),
            rot=(math.radians(s*-16),0,0),scale=(.42,.30,.20))
        add('primitive_cube_add',f'mount{s}',frame,loc=(-.10,s*.92,1.20),
            scale=(.44,.26,.20))
        for i in range(3):
            add('primitive_cylinder_add',f'gun{s}{i}',P['trim'],
                loc=(.80,s*.92+(i-1)*.13,1.20+(i%2)*.06),
                rot=(0,math.radians(90),0),scale=(.055,.055,.72),vertices=10)
    add('primitive_cylinder_add','reactor',core,loc=(-.70,0,1.22),
        scale=(.40,.40,.22),vertices=20)
    add('primitive_torus_add','ring',accent,loc=(-.70,0,1.24),
        major_radius=.54,minor_radius=.07,major_segments=24,minor_segments=8)
    for s in (1,-1):
        add('primitive_cube_add',f'vent{s}',core,loc=(-1.18,s*.34,.62),
            scale=(.12,.20,.20))
    return 0, 5.4

def carrion(P):
    # CARRION ARRAY — a sensor mast, not a gun platform. Tall, thin, radial:
    # the silhouette that separates it from Manticore is the dish and the spines.
    plate, accent, core, frame = boss_hull(P, BOSS_SPEC['carrion'])
    add('primitive_cylinder_add','frame',frame,loc=(0,0,.42),
        scale=(.94,.94,.40),vertices=8)
    add('primitive_cylinder_add','collar',plate,loc=(0,0,.92),
        scale=(1.02,1.02,.16),vertices=8)
    # The dish, offset forward so the array has a heading.
    add('primitive_uv_sphere_add','dish',plate,loc=(.30,0,1.20),
        scale=(.86,.86,.34),segments=32,ring_count=14)
    add('primitive_cylinder_add','emitter',core,loc=(.30,0,1.46),
        scale=(.22,.22,.16),vertices=16)
    # Radial spines. A shape nothing else in the game has, which is the point.
    for i in range(8):
        a=i/8*math.tau
        sp=add('primitive_cube_add',f'spine{i}',accent,
               loc=(math.cos(a)*1.34,math.sin(a)*1.34,.86),
               scale=(.44,.055,.055))
        sp.rotation_euler=(0,0,a)
        add('primitive_cylinder_add',f'tip{i}',core,
            loc=(math.cos(a)*1.76,math.sin(a)*1.76,.86),
            scale=(.075,.075,.075),vertices=8)
    add('primitive_cylinder_add','stack',frame,loc=(-.72,0,1.12),
        scale=(.24,.24,.34),vertices=10)
    return 0, 5.0

def aegis(P):
    # AEGIS BREAKER — a shield, worn. Broad frontal plates and a heavy, blunt
    # hull; the silhouette reads as armour first and weapon second.
    plate, accent, core, frame = boss_hull(P, BOSS_SPEC['aegis'])
    add('primitive_cube_add','frame',frame,loc=(-.10,0,.42),scale=(1.0,1.02,.44))
    add('primitive_cube_add','deck',plate,loc=(-.10,0,.96),scale=(.92,.94,.18))
    # The shield: two overlapping slabs angled forward, with a gap you can see
    # the core through.
    for s in (1,-1):
        sh=add('primitive_cube_add',f'shield{s}',plate,loc=(.86,s*.52,.86),
               scale=(.24,.62,.52))
        sh.rotation_euler=(0,math.radians(-14),math.radians(s*10))
        add('primitive_cube_add',f'rib{s}',accent,loc=(1.06,s*.52,.86),
            rot=(0,math.radians(-14),math.radians(s*10)),scale=(.05,.56,.10))
        add('primitive_cube_add',f'brace{s}',frame,loc=(.44,s*.72,.78),
            scale=(.34,.10,.26))
    add('primitive_cylinder_add','core',core,loc=(.62,0,.96),
        rot=(0,math.radians(90),0),scale=(.24,.24,.14),vertices=18)
    add('primitive_cube_add','spine',frame,loc=(-.86,0,1.06),scale=(.34,.44,.24))
    for s in (1,-1):
        add('primitive_cylinder_add',f'thruster{s}',core,loc=(-1.10,s*.44,.80),
            rot=(0,math.radians(90),0),scale=(.16,.16,.16),vertices=12)
    return 0, 5.2

def arbiter(P):
    # THE ARBITER — mirrors the operative's own loadout, so it is the sleek one:
    # pale, narrow, bilaterally symmetric, with a single red eye. The only boss
    # whose accent is hostile red against a white hull.
    plate, accent, core, frame = boss_hull(P, BOSS_SPEC['arbiter'])
    body=add('primitive_uv_sphere_add','frame',plate,loc=(0,0,.80),
             scale=(1.20,.72,.46),segments=36,ring_count=18)
    for v in body.data.vertices:
        if v.co.x<0:
            f=1+v.co.x*.28
            v.co.y*=max(.45,f)
    add('primitive_cube_add','spine',frame,loc=(-.30,0,1.14),scale=(.86,.14,.12))
    # The eye. One hard red point on an otherwise pale hull — the whole read.
    add('primitive_uv_sphere_add','eye',core,loc=(.86,0,1.02),
        scale=(.22,.30,.16),segments=20,ring_count=10)
    add('primitive_torus_add','socket',accent,loc=(.86,0,1.02),
        major_radius=.32,minor_radius=.05,major_segments=20,minor_segments=8)
    # Mirrored arms, held out — it is copying your weapons, so it has hands.
    for s in (1,-1):
        arm=add('primitive_cube_add',f'arm{s}',plate,loc=(.30,s*.88,.92),
                scale=(.52,.16,.14))
        arm.rotation_euler=(0,0,math.radians(s*-18))
        add('primitive_cube_add',f'hand{s}',frame,loc=(.86,s*1.10,.92),
            scale=(.20,.12,.12))
        add('primitive_cylinder_add',f'muzzle{s}',accent,loc=(1.14,s*1.16,.92),
            rot=(0,math.radians(90),0),scale=(.06,.06,.18),vertices=10)
    add('primitive_cylinder_add','vent',core,loc=(-1.06,0,.90),
        rot=(0,math.radians(90),0),scale=(.20,.20,.14),vertices=14)
    return 0, 5.0

def soldier(P):
    # Infantry, at roughly 26px on screen — the hardest case for this pipeline
    # and the one most likely to lose to the hand-drawn sprite.
    add('primitive_uv_sphere_add','helmet',P['hull'],loc=(.06,0,.92),
        scale=(.34,.34,.28),segments=20,ring_count=10)
    add('primitive_cube_add','torso',P['hull'],loc=(0,0,.5),scale=(.30,.42,.40))
    add('primitive_cube_add','rig',P['dark'],loc=(.16,0,.54),scale=(.14,.38,.30))
    add('primitive_cube_add','pack',P['dark'],loc=(-.30,0,.56),scale=(.16,.30,.28))
    for s in (1,-1):
        add('primitive_cube_add',f'arm{s}',P['hull'],loc=(.16,s*.46,.48),
            scale=(.18,.13,.30))
        add('primitive_cube_add',f'leg{s}',P['dark'],loc=(-.04,s*.20,.06),
            scale=(.20,.16,.34))
    # Weapon, held across the body and pointing +X so the sprite reads a facing.
    add('primitive_cube_add','weapon',P['trim'],loc=(.62,.14,.52),scale=(.46,.07,.07))
    add('primitive_cube_add','mag',P['dark'],loc=(.52,.14,.38),scale=(.09,.06,.14))
    return 0, 2.6

# ---------------------------------------------------------------------------
# Infantry. One parametric figure, in the game's own units (radius 11 = 1 unit
# per pixel), BODY ONLY — the runtime draws the legs, animated from the walk
# phase, underneath. Facing +X.
# ---------------------------------------------------------------------------

def shade(hexc, k):
    r, g, b = hexrgb(hexc)
    f = (lambda v: v + (1 - v) * k) if k > 0 else (lambda v: v * (1 + k))
    return (f(r), f(g), f(b))

def figure(P, body_hex, accent_hex, build='medium', helmet='visor',
           weapon='rifle', pack=False, armor=False, shield=False, charge=False,
           outline_hex=None):
    body   = material('body',   hexrgb(body_hex),      metallic=.15, rough=.62)
    dark   = material('bdark',  shade(body_hex, -.38), metallic=.2,  rough=.7)
    accent = material('baccent',hexrgb(accent_hex),    metallic=.35, rough=.4,
                      emission=hexrgb(accent_hex), strength=.9)
    skin   = material('head',   shade(body_hex, .18),  metallic=.1,  rough=.6)
    steel  = P['trim']; frame = P['dark']
    w = {'light':.85,'medium':1.0,'heavy':1.18,'exo':1.32}[build]

    # Torso: a rounded block, wider for heavier builds.
    add('primitive_cube_add','torso',body,loc=(1.0,0,1.6),scale=(5.0,5.6*w,1.9))
    if armor:
        add('primitive_cube_add','plate',accent,loc=(2.2,0,2.9),scale=(2.8,3.4*w,.5))
    # Shoulders
    for sd in (1,-1):
        add('primitive_uv_sphere_add',f'shoulder{sd}',dark,loc=(0.2,sd*5.4*w,2.6),
            scale=(2.0,1.6,1.5),segments=16,ring_count=8)
        # Arms forward, holding the weapon.
        a=add('primitive_cylinder_add',f'arm{sd}',dark,loc=(3.6,sd*3.6*w,2.4),
              rot=(0,math.radians(78),0),scale=(1.0,1.0,3.4),vertices=10)
    if build=='exo':
        for sd in (1,-1):
            add('primitive_cube_add',f'exo{sd}',steel,loc=(-0.5,sd*6.6,2.4),scale=(2.4,1.2,1.4))
    # Head, set back from centre so the figure reads as facing forward.
    add('primitive_uv_sphere_add','head',skin,loc=(-2.4,0,3.9),scale=(4.0,4.0,3.2),
        segments=20,ring_count=10)
    if helmet=='visor':
        add('primitive_cube_add','visor',accent,loc=(0.2,0,3.9),scale=(.9,2.4,1.2))
    elif helmet=='full':
        add('primitive_uv_sphere_add','dome',dark,loc=(-2.4,0,4.4),scale=(4.4,4.4,2.8),
            segments=20,ring_count=10)
        add('primitive_cube_add','slit',accent,loc=(0.6,0,4.2),scale=(.7,2.8,.5))
    elif helmet=='hood':
        add('primitive_cone_add','hood',dark,loc=(-2.6,0,4.6),scale=(4.6,4.6,3.2),vertices=16)
        add('primitive_uv_sphere_add','lens',accent,loc=(0.4,0,4.0),scale=(.9,1.4,.9),
            segments=10,ring_count=6)
    else:  # cap
        add('primitive_cylinder_add','cap',dark,loc=(-2.4,0,5.4),scale=(3.8,3.8,.9),vertices=16)
        add('primitive_cube_add','brim',dark,loc=(0.4,0,5.0),scale=(2.2,3.2,.3))
    if pack:
        add('primitive_cube_add','pack',dark,loc=(-4.8,0,2.2),scale=(2.0,4.0,2.4))
    if charge:
        add('primitive_uv_sphere_add','charge',P['warn'],loc=(-5.6,0,3.4),scale=(2.2,2.2,2.2),
            segments=14,ring_count=8)
    if shield:
        sh=add('primitive_cube_add','shield',accent,loc=(12.5,0,3.2),scale=(4.6,11.5,.6))
        sh.rotation_euler=(0,math.radians(-28),0)
        add('primitive_cube_add','shieldrib',steel,loc=(11.6,0,3.9),rot=(0,math.radians(-28),0),scale=(.4,9.5,.3))
    # Weapon, in front.
    # Reach is set to the procedural sprite's measured forward extent (see
    # tools/entity-art.mjs sizing): rifle 15px at 1 unit/px, sniper 28px,
    # heavy 45px at 11/17 units/px = 29 units. The frame must then be wide
    # enough to hold it — `fit()` in render() refuses to clip.
    if weapon=='rifle':
        add('primitive_cube_add','wep',steel,loc=(8.5,1.2,2.6),scale=(6.5,.8,.8))
        add('primitive_cube_add','mag',frame,loc=(6.5,1.2,1.6),scale=(.9,.6,1.3))
    elif weapon=='smg':
        add('primitive_cube_add','wep',steel,loc=(7.4,1.2,2.6),scale=(4.2,.8,.8))
        add('primitive_cube_add','mag',frame,loc=(6.6,1.2,1.5),scale=(.7,.6,1.4))
    elif weapon=='sniper':
        add('primitive_cube_add','wep',steel,loc=(15.5,1.2,2.6),scale=(12.5,.8,.8))
        add('primitive_cylinder_add','scope',frame,loc=(7.5,1.2,3.5),
            rot=(0,math.radians(90),0),scale=(.6,.6,2.2),vertices=10)
    elif weapon=='heavy':
        add('primitive_cylinder_add','wep',steel,loc=(15.0,1.4,2.6),
            rot=(0,math.radians(90),0),scale=(2.4,2.4,14.0),vertices=12)
        add('primitive_cube_add','box',frame,loc=(5.5,1.4,1.4),scale=(2.2,1.6,1.8))
    elif weapon=='blade':
        add('primitive_cube_add','wep',accent,loc=(13.0,1.2,2.6),scale=(9.5,.35,1.2))
    elif weapon=='launcher':
        add('primitive_cylinder_add','wep',steel,loc=(11.0,1.4,2.8),
            rot=(0,math.radians(90),0),scale=(2.2,2.2,7.5),vertices=12)

# The collision radius each render is sized for. The figure is modelled at
# radius 11 = 1 unit per pixel, so a kind at radius r must be rendered with
# span = px * 11 / r — that keeps units-per-pixel identical to the game and is
# the only thing that makes `ref` in entityart.js correct. Hand-set spans were
# the bug: widening one to fit a longer weapon shrank the whole figure by the
# same factor, and the sizing ratio never moved.
REF_RADIUS = {'soldier':11,'shield':13,'sniper':11,'heavy':17,'veil':11,'augment':15,
              'sapper':12,'mortar':13,'drone':9,'crawler':10,'jammer':13,'warden':16}
def span_for(kind, px, radius=None):
    r = radius or REF_RADIUS.get(kind, 11)
    return px * 11.0 / r

def infantry_builder(kind, spec):
    def build(P):
        body = COLOURS.get(spec.get('colour_from', kind), '#a7b8b9')
        accent = spec.get('accent') or shade_hex(body, .3)
        figure(P, body, accent, **{k:v for k,v in spec.items() if k not in ('colour_from','accent','span')})
        return 0, span_for(kind, CURRENT_PX)
    return build

def shade_hex(hexc, k):
    r, g, b = shade(hexc, k)
    to = lambda v: int(round(max(0, min(1, v)) ** (1/2.2) * 255))
    return '#%02x%02x%02x' % (to(r), to(g), to(b))

INFANTRY = {
    'soldier': dict(colour_from='rifle',   build='medium', helmet='visor', weapon='rifle'),
    'shield':  dict(colour_from='shield',  accent='#e0c982', build='heavy', helmet='full', weapon='smg', armor=True, shield=True),
    'sniper':  dict(colour_from='sniper',  accent='#e6b9d2', build='light', helmet='cap',  weapon='sniper', pack=True),
    'heavy':   dict(colour_from='breacher',build='exo',    helmet='full',  weapon='heavy', armor=True),
    'veil':    dict(colour_from='veil',    accent='#d6e2ff', build='light', helmet='hood', weapon='blade'),
    'augment': dict(colour_from='marauder',accent='#ffb0a0', build='heavy', helmet='full', weapon='blade', armor=True),
    'sapper':  dict(colour_from='sapper',  accent='#ffd166', build='medium',helmet='cap',  weapon='none', pack=True, charge=True),
}

# The operative. Same figure, the game's teal body, the operative's own accent
# and weapon. Eight variants: a whole-sprite tint would shift the body too, and
# eight one-kilobyte files are cheaper than getting that wrong.
WEAPON_LOOK = {'needle':'smg','bulwark':'rifle','kite':'none','monofilament':'blade',
               'specter':'sniper','scatter':'heavy','vector':'smg','shard':'launcher',
               'tripmine':'smg','microwave':'none','emp':'none','sentry':'smg',
               'micro':'launcher','rail':'sniper','nanite':'none','lance':'sniper',
               'orbital':'launcher','revenant':'blade'}
OPERATIVES = {'vesper':'needle','bastion':'bulwark','mirage':'kite','wraith':'monofilament',
              'oracle':'specter','ferrous':'shard','cipher':'nanite','requiem':'revenant'}

def player_builder(op):
    def build(P):
        accent = COLOURS.get(op, '#76e7d4')
        figure(P, '#22484c', accent, build='medium', helmet='visor',
               weapon=WEAPON_LOOK.get(OPERATIVES[op], 'rifle'), armor=True,
               outline_hex='#c8fff8')
        return 0, span_for('player', CURRENT_PX, 13)
    return build

# ---------------------------------------------------------------------------
# Small machines. Static part only; the moving part stays procedural.
# ---------------------------------------------------------------------------

def drone(P):
    # Fuselage only. The rotors spin at runtime.
    c = COLOURS.get('pursuit', '#82d0d8')
    hull = material('dhull', hexrgb('#1a3238'), metallic=.6, rough=.5)
    acc  = material('dacc',  hexrgb(c), metallic=.4, rough=.4, emission=hexrgb(c), strength=1.4)
    add('primitive_cone_add','nose',hull,loc=(6,0,1.5),rot=(0,math.radians(90),0),
        scale=(3.6,3.6,3.6),vertices=12)
    add('primitive_cube_add','body',hull,loc=(-2,0,1.5),scale=(6.5,3.4,1.5))
    add('primitive_cube_add','tail',hull,loc=(-9,0,1.6),scale=(2.2,1.0,.6))
    for sd in (1,-1):
        add('primitive_cube_add',f'boom{sd}',hull,loc=(-4,sd*7,1.4),scale=(1.4,3.6,.5))
        add('primitive_cylinder_add',f'hub{sd}',hull,loc=(-4,sd*9,1.9),scale=(1.1,1.1,.6),vertices=10)
    add('primitive_uv_sphere_add','eye',acc,loc=(3,0,2.4),scale=(2.2,2.2,1.4),segments=12,ring_count=6)
    return 0, span_for('drone', CURRENT_PX)

def crawler(P):
    # Chassis only. The legs wobble at runtime.
    c = COLOURS.get('crawler', '#9ad7c5')
    hull = material('chull', hexrgb('#1e3438'), metallic=.6, rough=.5)
    acc  = material('cacc',  hexrgb(c), metallic=.4, rough=.4, emission=hexrgb(c), strength=1.2)
    add('primitive_cube_add','chassis',hull,loc=(0.5,0,1.4),scale=(8.5,6,1.6))
    add('primitive_cube_add','ridge',acc,loc=(0.5,0,3.1),scale=(5.5,.8,.3))
    add('primitive_cube_add','mandible',acc,loc=(9.5,0,1.4),scale=(2.2,1.6,.9))
    add('primitive_uv_sphere_add','opt',acc,loc=(6,0,2.6),scale=(1.4,2.0,1.0),segments=10,ring_count=6)
    return 0, span_for('crawler', CURRENT_PX)

def jammer(P):
    # Body only. The dish rotates at runtime.
    c = COLOURS.get('jammer', '#b29ae9')
    body = material('jbody', hexrgb(c), metallic=.5, rough=.45)
    trim = material('jtrim', hexrgb('#dcd2ff'), metallic=.6, rough=.35)
    add('primitive_cube_add','body',body,loc=(0.5,0,1.8),scale=(6.5,7,2.0))
    add('primitive_cube_add','panel',trim,loc=(0.5,0,3.9),scale=(5.0,5.5,.3))
    add('primitive_cylinder_add','mast',trim,loc=(0,0,5.4),scale=(1.4,1.4,1.4),vertices=12)
    for sd in (1,-1):
        add('primitive_cube_add',f'fin{sd}',trim,loc=(-5,sd*4.5,2.2),scale=(1.4,1.2,2.6))
    return 0, span_for('jammer', CURRENT_PX)

def warden(P):
    # Hex chassis and core. The shield ring counter-rotates at runtime.
    c = COLOURS.get('warden', '#7fd4c4')
    hull = material('whull', hexrgb('#123832'), metallic=.6, rough=.5)
    acc  = material('wacc',  hexrgb(c), metallic=.4, rough=.4, emission=hexrgb(c), strength=1.8)
    add('primitive_cylinder_add','hex',hull,loc=(0,0,2.0),scale=(11,11,2.2),vertices=6)
    add('primitive_cylinder_add','rim',acc,loc=(0,0,4.3),scale=(10.6,10.6,.25),vertices=6)
    add('primitive_cylinder_add','rimcut',hull,loc=(0,0,4.45),scale=(9.2,9.2,.3),vertices=6)
    add('primitive_cylinder_add','core',acc,loc=(0,0,4.9),scale=(4,4,1.2),vertices=18)
    for i in range(6):
        a=i/6*math.tau
        add('primitive_cube_add',f'node{i}',hull,loc=(math.cos(a)*9.5,math.sin(a)*9.5,4.6),
            scale=(1.4,1.4,.9))
    return 0, span_for('warden', CURRENT_PX)

def mortar(P):
    # No moving part; the whole thing is baked.
    c = COLOURS.get('mortar', '#c9b27f')
    body = material('mbody', hexrgb(c), metallic=.5, rough=.5)
    dark = material('mdark', shade(c,-.35), metallic=.5, rough=.6)
    for i in range(3):
        a=i/3*math.tau+.5
        leg=add('primitive_cylinder_add',f'leg{i}',dark,loc=(math.cos(a)*5,math.sin(a)*5,1.0),
                scale=(.8,.8,5.5),vertices=8)
        leg.rotation_euler=(math.radians(-math.sin(a)*40),math.radians(math.cos(a)*40),0)
    add('primitive_cylinder_add','tube',body,loc=(2.5,0,4.0),rot=(0,math.radians(-55),0),
        scale=(2.4,2.4,9.0),vertices=14)
    add('primitive_cylinder_add','base',dark,loc=(0,0,1.2),scale=(4,4,1.0),vertices=16)
    return 0, span_for('mortar', CURRENT_PX)

ASSETS = {'gunship':gunship,'carrier':carrier,
          'manticore':manticore,'carrion':carrion,'aegis':aegis,'arbiter':arbiter,
          'drone':drone,'crawler':crawler,'jammer':jammer,'warden':warden,'mortar':mortar}
for _k,_spec in INFANTRY.items(): ASSETS[_k]=infantry_builder(_k,_spec)
for _op in OPERATIVES: ASSETS['player-'+_op]=player_builder(_op)

# ---------------------------------------------------------------------------
# Render and outline
# ---------------------------------------------------------------------------

# Stroke weight at final display size, in pixels. Matched by eye to the
# procedural sprites, which stroke at 1.4px.
OUTLINE_PX = 1.5
OUTLINE_RGB = (10, 9, 13)
# Render this many times the display size, then downsample. Rendering large and
# reducing is what keeps the edge clean; rendering at target size gives a
# stair-stepped outline that reads as an artefact.
SUPERSAMPLE = 6

CURRENT_PX = 64

def fit(span, display_px):
    # Refuse to clip. The camera is centred on the origin, so the frame holds
    # half the span in every direction; a weapon that reaches past that is
    # silently cut off at the edge, and the sizing ratio then never moves no
    # matter how long the weapon is made — which is exactly how the sniper and
    # heavy shipped at 0.77 of their footprint. The remedy is a wider frame
    # (units per pixel are fixed per kind by span_for), never a shorter weapon.
    from mathutils import Vector
    bpy.context.view_layer.update()
    reach = 0.0
    for o in bpy.context.scene.objects:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            reach = max(reach, abs(w.x), abs(w.y))
    margin = OUTLINE_PX * span / display_px + span / display_px
    assert reach + margin <= span / 2, (
        f'model reaches {reach:.1f} units from origin but the frame holds '
        f'{span/2:.1f}: render at {int(math.ceil(2*(reach+margin)*display_px/span))}px or more')

def auto_px(asset):
    # The frame a figure needs: twice its forward reach plus the outline, in
    # pixels, rounded up to a multiple of four. Only meaningful for assets whose
    # span comes from span_for (units per pixel fixed per kind); the vehicles
    # and boss hulls fill a frame sized to the sprite footprint by hand.
    global CURRENT_PX
    from mathutils import Vector
    CURRENT_PX = 100
    reset()
    _, span = ASSETS[asset](palette())
    bpy.context.view_layer.update()
    reach = 0.0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                reach = max(reach, abs(w.x), abs(w.y))
    need = 2 * (reach * 100 / span + OUTLINE_PX + 1)
    return int(math.ceil(need / 4) * 4)

def render(asset, out_path, display_px=None):
    global CURRENT_PX
    if display_px is None:
        display_px = auto_px(asset)
    CURRENT_PX = display_px
    reset()
    P = palette()
    centre, span = ASSETS[asset](P)
    fit(span, display_px)
    lighting()
    camera(centre, span)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    size = display_px * SUPERSAMPLE
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    raw = os.path.splitext(out_path)[0] + '.raw.png'
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    scene.render.filepath = os.path.abspath(raw)
    bpy.ops.render.render(write_still=True)
    outline(raw, out_path, display_px)
    os.remove(raw)
    return out_path

def outline(raw_path, out_path, display_px):
    # The stroke, added in post.
    #
    # Dilating the alpha and filling behind it produces exactly the edge the
    # hand-drawn sprites have, at a weight specified in *final* pixels — so the
    # same pipeline gives a 26px soldier and a 120px siege platform the same
    # apparent line, which no camera-space outline can do.
    from PIL import Image, ImageFilter, ImageChops
    img = Image.open(raw_path).convert('RGBA')
    scale = img.width / display_px
    grow = max(1, int(round(OUTLINE_PX * scale)))
    alpha = img.getchannel('A')
    # MaxFilter needs an odd window; the window is the diameter of the growth.
    window = grow * 2 + 1
    grown = alpha.filter(ImageFilter.MaxFilter(window))
    ring = ImageChops.subtract(grown, alpha)
    edge = Image.new('RGBA', img.size, (*OUTLINE_RGB, 0))
    edge.putalpha(ring)
    plate = Image.new('RGBA', img.size, (0,0,0,0))
    plate.alpha_composite(edge)
    plate.alpha_composite(img)
    final = plate.resize((display_px, display_px), Image.LANCZOS)
    # A light sharpen recovers the definition the reduction costs. Restrained:
    # over-sharpening puts a halo on the outline, which reads as a render
    # artefact rather than as art.
    final = final.filter(ImageFilter.UnsharpMask(radius=1.1, percent=55, threshold=2))
    final.save(out_path)

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    if args and args[0] == 'all':
        out_dir = args[1] if len(args) > 1 else 'out'
        # Display sizes are the sprite's MEASURED on-screen footprint, not
        # radius x2.
        #
        # These sprites draw far outside their collision radius — the gunship's
        # rotor disc reaches 2.7x it — so radius x2 understated every one of
        # them by more than half. An earlier version of this pipeline was judged
        # at 60px for the gunship when the real figure is nearer 160, which is
        # the difference between "loses badly" and "has room to work".
        # Measured by rendering each sprite on an oversized canvas and taking
        # the alpha bounding box.
        #
        # Figures and small machines are measured instead (`auto_px`): their
        # frame is 2 x the model's FORWARD reach, not the sprite width, because
        # the origin sits at the frame centre and the weapon reaches one way.
        # A hand-kept list here is how the sniper and heavy shipped clipped.
        sizes=[('gunship',160),('carrier',146),
               ('manticore',158),('carrion',158),('aegis',158),('arbiter',158)]
        sizes+=[(k,None) for k in ('soldier','shield','sniper','heavy','veil','augment',
                                   'sapper','mortar','drone','crawler','jammer','warden')]
        sizes+=[('player-'+op,None) for op in OPERATIVES]
        for name, px in sizes:
            path = os.path.join(out_dir, f'{name}.png')
            render(name, path, px)
            print('wrote', path, f'{CURRENT_PX}px')
    else:
        asset = args[0] if args else 'gunship'
        out = args[1] if len(args) > 1 else f'{asset}.png'
        px = int(args[2]) if len(args) > 2 else None
        render(asset, out, px)
        print('wrote', out, f'{CURRENT_PX}px')
