# Builds the Vulture gunship in Blender and renders it top-down.
#
# The game rotates every sprite at draw time, so an entity needs exactly one
# render — straight down, orthographic, transparent — and not a sheet of
# rotations. That is the single fact that makes this pipeline cheap enough to
# consider at all.
#
# Only the airframe is rendered. The rotor stays procedural and is drawn over
# the top at runtime, because a rotor is a moving part whose blur has to track
# the engine's actual spin rate; baking it would freeze it.
#
#   python3 tools/blender/gunship.py
import bpy, bmesh, math, sys, os

OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets/sprites/chopper.png'
SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 256

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name, base, metallic=.8, rough=.45, alpha=1.0, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*base, alpha)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = rough
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = 1.6
    return m

def add(prim, name, mat, loc=(0,0,0), rot=(0,0,0), scale=(1,1,1), **kw):
    getattr(bpy.ops.mesh, prim)(location=loc, rotation=rot, **kw)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o

reset()

hull   = material('hull',   (.20, .24, .27), metallic=.85, rough=.42)
dark   = material('dark',   (.09, .11, .13), metallic=.7,  rough=.55)
trim   = material('trim',   (.62, .67, .70), metallic=.9,  rough=.30)
glass  = material('glass',  (.30, .62, .78), metallic=.2,  rough=.08, emission=(.12,.34,.46))
hot    = material('hot',    (.85, .35, .12), metallic=.3,  rough=.6,  emission=(.9,.32,.08))

# Fuselage: a stretched sphere flattened into a hull, nose toward +X.
body = add('primitive_uv_sphere_add', 'fuselage', hull, scale=(1.72, .74, .58), segments=40, ring_count=20)
# Taper the tail end so it reads as a nose and a back rather than a capsule.
for v in body.data.vertices:
    if v.co.x < 0:
        f = 1 + v.co.x * .34
        v.co.y *= max(.35, f)
        v.co.z *= max(.40, f)

add('primitive_cylinder_add', 'tailboom', dark,
    loc=(-2.05, 0, .06), rot=(0, math.radians(90), 0), scale=(.17, .17, 1.0), vertices=18)
add('primitive_cube_add', 'tailfin', hull, loc=(-2.95, 0, .30), scale=(.16, .06, .46))
add('primitive_cylinder_add', 'tailrotor', trim,
    loc=(-2.95, .18, .30), rot=(math.radians(90), 0, 0), scale=(.34, .34, .04), vertices=16)

# Canopy over the nose.
add('primitive_uv_sphere_add', 'canopy', glass, loc=(.80, 0, .26), scale=(.72, .52, .38), segments=28, ring_count=14)

# Stub wings with underslung pods.
for side in (1, -1):
    w = add('primitive_cube_add', f'wing{side}', hull, loc=(-.16, side*1.10, -.02), scale=(.40, .58, .09))
    w.rotation_euler = (0, 0, side * math.radians(13))
    add('primitive_cylinder_add', f'pod{side}', dark,
        loc=(-.20, side*1.52, -.20), rot=(0, math.radians(90), 0), scale=(.23, .23, .56), vertices=14)
    add('primitive_cube_add', f'skid{side}', trim, loc=(.10, side*.86, -.72), scale=(1.15, .05, .04))
    # Engine exhaust, warm so it catches the eye at the back of the hull.
    add('primitive_cylinder_add', f'exhaust{side}', hot,
        loc=(-1.30, side*.40, .34), rot=(0, math.radians(90), 0), scale=(.15, .15, .22), vertices=12)

# Rotor head only — the blades are drawn by the game.
add('primitive_cylinder_add', 'rotorhead', trim, loc=(0, 0, .78), scale=(.20, .20, .18), vertices=16)

# Lighting. A key from the front-left and a cool fill, which is what gives the
# hull its top surface; a flat top-down render with one lamp reads as a decal.
key = bpy.data.lights.new('key', 'SUN'); key.energy = 5.0; key.angle = .30
ko = bpy.data.objects.new('key', key); bpy.context.collection.objects.link(ko)
ko.rotation_euler = (math.radians(38), math.radians(14), math.radians(-42))

fill = bpy.data.lights.new('fill', 'SUN'); fill.energy = 1.7
fill.color = (.55, .72, 1.0)
fo = bpy.data.objects.new('fill', fill); bpy.context.collection.objects.link(fo)
fo.rotation_euler = (math.radians(-30), math.radians(-20), math.radians(120))

# Straight down, orthographic. Nose points +X to match the sprite convention:
# the game rotates by `enemy.angle`, where zero faces right.
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 5.6
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
# Centred on the airframe's own extent, not on the origin. The tail boom
# reaches much further back than the nose reaches forward, so framing on the
# origin pushed the whole aircraft into the right of the image and wasted a
# third of the sprite on empty air.
cam.location = (-.85, 0, 12)
# Zero yaw, not -90. Looking straight down the -Z axis, image-right is +X and
# image-up is +Y, so the model's +X nose lands pointing right — which is where
# `ctx.rotate(enemy.angle)` expects zero degrees to face. A quarter turn here
# put every aircraft in the game side-on to its own heading.
cam.rotation_euler = (0, 0, 0)
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.render.resolution_x = SIZE
scene.render.resolution_y = SIZE
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
scene.render.filepath = os.path.abspath(OUT)
bpy.ops.render.render(write_still=True)
print('wrote', scene.render.filepath)
