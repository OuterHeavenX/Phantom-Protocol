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
    return -.85, 5.6

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

def manticore(P):
    # MANTICORE SIEGE PLATFORM — quadrupedal, and the largest thing the game
    # draws at roughly 120px, which is where this pipeline has the most pixels
    # to work with.
    add('primitive_cube_add','core',P['hull'],loc=(0,0,.5),scale=(1.15,1.0,.62))
    add('primitive_cube_add','glacis',P['trim'],loc=(.95,0,.55),
        rot=(0,math.radians(-30),0),scale=(.42,.86,.3))
    add('primitive_uv_sphere_add','sensor',P['glass'],loc=(1.05,0,.72),
        scale=(.36,.5,.26),segments=24,ring_count=12)
    # Four legs, splayed. Front and rear differ so the chassis has a heading.
    for sx,sy,name in ((1,1,'fr'),(1,-1,'fl'),(-1,1,'rr'),(-1,-1,'rl')):
        hipx = sx*.86
        add('primitive_cylinder_add',f'hip{name}',P['dark'],loc=(hipx,sy*.92,.46),
            rot=(math.radians(90),0,0),scale=(.26,.26,.22),vertices=14)
        thigh = add('primitive_cube_add',f'thigh{name}',P['hull'],
                    loc=(hipx+sx*.42,sy*1.35,.28),scale=(.5,.20,.16))
        thigh.rotation_euler = (sy*math.radians(-22),0,sx*math.radians(14))
        shin = add('primitive_cube_add',f'shin{name}',P['trim'],
                   loc=(hipx+sx*.86,sy*1.72,-.02),scale=(.42,.13,.12))
        shin.rotation_euler = (sy*math.radians(-34),0,sx*math.radians(22))
        add('primitive_cylinder_add',f'foot{name}',P['dark'],
            loc=(hipx+sx*1.18,sy*1.94,-.30),scale=(.24,.24,.10),vertices=12)
    # Shoulder weapons and the reactor glow that says which end is dangerous.
    for s in (1,-1):
        add('primitive_cube_add',f'mount{s}',P['dark'],loc=(-.15,s*.86,.98),
            scale=(.46,.24,.20))
        add('primitive_cylinder_add',f'gun{s}',P['trim'],loc=(.75,s*.86,1.0),
            rot=(0,math.radians(90),0),scale=(.11,.11,.72),vertices=12)
    add('primitive_cylinder_add','reactor',P['hot'],loc=(-.72,0,.92),
        scale=(.34,.34,.20),vertices=18)
    add('primitive_cube_add','vent',P['hot'],loc=(-1.1,0,.62),scale=(.14,.56,.22))
    return 0, 5.2

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
    return .08, 2.3

ASSETS = {'gunship':gunship,'carrier':carrier,'manticore':manticore,'soldier':soldier}

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

def render(asset, out_path, display_px):
    P = None
    reset()
    P = palette()
    centre, span = ASSETS[asset](P)
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
        for name, px in (('gunship',160),('carrier',146),('manticore',158),('soldier',30)):
            path = os.path.join(out_dir, f'{name}.png')
            render(name, path, px)
            print('wrote', path, f'{px}px')
    else:
        asset = args[0] if args else 'gunship'
        out = args[1] if len(args) > 1 else f'{asset}.png'
        px = int(args[2]) if len(args) > 2 else 64
        render(asset, out, px)
        print('wrote', out, f'{px}px')
