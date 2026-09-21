#!/usr/bin/env python3
"""First-person weapon viewmodel, built in Blender and exported as GLB.

    python3 tools/godot/build-viewmodel.py godot/art/models

Every reference image is dominated by a weapon and a pair of gloved hands in
the lower third of the frame. Without them a screenshot of this build reads as
an architectural walkthrough rather than as a shooter, whatever the walls look
like, so this is the highest-value asset in the project.

Authored directly in Godot's axis convention -- X right, Y up, -Z forward --
and exported with `export_yup=False` so those coordinates pass through
untouched. Building in Blender's native Z-up and letting the exporter convert
is the usual route, but it silently rotates every hand-placed rotation as
well, and the first build came out with the weapon pointing at the ceiling.
Nothing here is ever opened in the Blender GUI, so authoring in the target
convention costs nothing and removes a whole class of mistake.

Modelled from primitives with real bevels, because a viewmodel is seen closer
than anything else in the game: a 2 mm chamfer that would be invisible on a
wall is a bright specular line here, and it is most of what makes a slide read
as machined steel rather than as a grey box.

The operative's sidearm is the Needle-7 from data/weapons.js — a suppressed
marksman pistol, which is what vesper starts op1 holding.
"""
import math, os, sys
import bpy
from mathutils import Vector

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, base, metallic=0.0, rough=0.5, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 2.0
    return m

def box(name, size, loc, material, rot=(0, 0, 0), bevel=0.0015, segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = segments
        b.limit_method = "ANGLE"
        b.angle_limit = math.radians(40)
    # Flat shading on the boxes. A bevelled hard-surface part wants crisp
    # faces with a bright chamfer between them; smoothing rounds that chamfer
    # away and the slide goes back to looking like a soap bar.
    bpy.ops.object.shade_flat()
    return o

def cyl(name, r, depth, loc, material, rot=(0, 0, 0), verts=24, bevel=0.0012):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 2
        b.limit_method = "ANGLE"
        b.angle_limit = math.radians(40)
    bpy.ops.object.shade_smooth()
    return o

## The pistol was first laid out with a 98 mm slide, which is about 60% of a
## real one. Everything looked self-consistent until hands were put on it, at
## which point either the gun was tiny or the hands were gigantic. Rather than
## re-typing forty numbers, the finished group is scaled about the origin to
## bring the slide to ~165 mm and the grip to ~90 mm, which is a real sidearm.
PISTOL_SCALE = 1.70


def build_pistol():
    """Needle-7. Barrel runs along -Z (Godot forward); up is +Y."""
    # Five materials that were all near-black. At albedo 0.022 to 0.045 the
    # slide, the frame, the grip and the suppressor were within a tenth of a
    # stop of each other, so the weapon read as one moulded black mass with no
    # part boundaries in it -- which is the single thing the references never
    # do. A service pistol's slide is nitrided steel at roughly 0.12 albedo
    # with a real sheen, and its frame is matte polymer at half that. Pulling
    # the values apart is what separates the parts; the shapes were already
    # right.
    steel = mat("vm_steel", (0.115, 0.120, 0.128), metallic=0.90, rough=0.26)
    dark = mat("vm_dark", (0.035, 0.036, 0.039), metallic=0.60, rough=0.52)
    poly = mat("vm_polymer", (0.052, 0.052, 0.055), metallic=0.0, rough=0.72)
    # No emission. Two glowing teal dots on a sidearm in a sunlit street were
    # the only emissive pixels in the frame, and nothing in the references
    # glows at all.
    accent = mat("vm_accent", (0.085, 0.090, 0.095), metallic=0.4, rough=0.34)
    brass = mat("vm_brass", (0.52, 0.38, 0.14), metallic=0.95, rough=0.28)

    parts = []
    # Slide, with a flat top rib and an ejection port cut in by a dark inset.
    parts.append(box("slide", (0.0225, 0.0225, 0.098), (0, 0.0115, -0.052), steel, bevel=0.0022, segments=3))
    parts.append(box("slide_rib", (0.0085, 0.0035, 0.090), (0, 0.0235, -0.052), dark, bevel=0.0008))
    parts.append(box("ejection", (0.0125, 0.0115, 0.026), (0.0075, 0.0135, -0.036), dark, bevel=0.0006))
    # Cocking serrations: a short array of thin ribs near the rear.
    for i in range(7):
        z = -0.008 - i * 0.0052
        parts.append(box("serr%d" % i, (0.0232, 0.0150, 0.0016), (0, 0.0118, z), dark, bevel=0.0004))
    # Frame and dust cover.
    parts.append(box("frame", (0.0205, 0.0125, 0.086), (0, -0.0015, -0.044), poly, bevel=0.0018))
    parts.append(box("rail", (0.0150, 0.0055, 0.040), (0, -0.0090, -0.062), dark, bevel=0.0008))
    # Grip, raked back the way a pistol grip is.
    parts.append(box("grip", (0.0195, 0.052, 0.0265), (0, -0.036, 0.004), poly,
                     rot=(math.radians(-15), 0, 0), bevel=0.0020, segments=3))
    parts.append(box("backstrap", (0.0180, 0.048, 0.0055), (0, -0.036, 0.0175), dark,
                     rot=(math.radians(-15), 0, 0), bevel=0.0010))
    parts.append(box("magbase", (0.0180, 0.0055, 0.0235), (0, -0.0615, 0.0105), dark,
                     rot=(math.radians(-15), 0, 0), bevel=0.0008))
    # Trigger guard, as three members rather than a torus so it stays crisp.
    parts.append(box("guard_front", (0.0075, 0.0225, 0.0050), (0, -0.0175, -0.0305), poly, bevel=0.0010))
    parts.append(box("guard_low", (0.0075, 0.0048, 0.0235), (0, -0.0275, -0.0195), poly, bevel=0.0010))
    parts.append(box("trigger", (0.0042, 0.0135, 0.0042), (0, -0.0165, -0.0215), dark, bevel=0.0006))
    # Suppressor: this is the Needle-7's defining feature.
    # A Blender cylinder's axis is its local Z, and in this convention local Z
    # is already the weapon's bore line. The first build rotated these 90
    # degrees -- correct when the model was being axis-converted on export,
    # wrong once it was not -- and stood the suppressor vertically off the
    # slide like a periscope.
    # The can is anodised, not blued: matte and a touch lighter than the
    # frame, so it separates from both the slide in front of it and the hand
    # behind it.
    suppressor = mat("vm_can", (0.072, 0.072, 0.074), metallic=0.45, rough=0.66)
    parts.append(cyl("can", 0.0168, 0.090, (0, 0.0115, -0.140), suppressor))
    for i in range(6):
        parts.append(cyl("can_rib%d" % i, 0.0176, 0.0038, (0, 0.0115, -0.104 - i * 0.0145), steel, bevel=0.0006))
    parts.append(cyl("muzzle_cap", 0.0130, 0.008, (0, 0.0115, -0.186), steel, bevel=0.0006))
    parts.append(cyl("bore", 0.0062, 0.012, (0, 0.0115, -0.190), mat("vm_bore", (0.006, 0.006, 0.007), 0.2, 0.9)))
    # Sights.
    parts.append(box("rear_sight", (0.0135, 0.0060, 0.0055), (0, 0.0255, -0.010), dark, bevel=0.0006))
    parts.append(box("rear_notch", (0.0028, 0.0050, 0.0060), (0, 0.0262, -0.010), steel, bevel=0.0004))
    parts.append(box("front_post", (0.0032, 0.0062, 0.0040), (0, 0.0255, -0.092), dark, bevel=0.0004))
    parts.append(box("front_dot", (0.0022, 0.0022, 0.0042), (0, 0.0272, -0.092), accent, bevel=0.0004))
    # A small charge indicator, so the weapon carries the game's accent colour.
    parts.append(box("indicator", (0.0035, 0.0075, 0.0035), (0.0105, -0.0035, -0.004), accent, bevel=0.0004))
    # No permanently-parked ejected case: scaled up with the rest of the
    # weapon it became a brass ingot on the slide, and the brightest object on
    # the model.
    for o in parts:
        o.scale = tuple(v * PISTOL_SCALE for v in o.scale)
        o.location = tuple(v * PISTOL_SCALE for v in o.location)
    bpy.context.view_layer.update()
    return parts

def _capsule_rotation(direction):
    """Quaternion taking a metaball capsule's local +X onto `direction`."""
    d = Vector(direction)
    if d.length < 1e-9:
        return (1.0, 0.0, 0.0, 0.0)
    return Vector((1.0, 0.0, 0.0)).rotation_difference(d.normalized())


def _limb(mball, p0, p1, r0, r1=None, steps=None):
    """Lay overlapping capsules from p0 to p1, tapering r0 -> r1.

    Metaball elements blend where they overlap, so a chain of these reads as
    one continuous limb rather than as the separate parts it is built from.
    Stepping along the segment rather than placing one long capsule is what
    allows the taper.
    """
    a, b = Vector(p0), Vector(p1)
    seg = b - a
    length = seg.length
    if length < 1e-9:
        return
    r1 = r0 if r1 is None else r1
    steps = steps or max(2, int(length / (r0 * 0.75)))
    rot = _capsule_rotation(seg)
    for i in range(steps + 1):
        t = i / float(steps)
        el = mball.elements.new(type="BALL")
        el.co = a + seg * t
        # A metaball element's `radius` is its field of influence, and the
        # surface lands well inside it. Scaling by 2.1 -- the first guess --
        # made every element swallow its neighbours and the hand came out as
        # two featureless sausages. 1.15 puts the surface near the radius that
        # was asked for, so fingers stay separate from each other.
        el.radius = (r0 + (r1 - r0) * t) * 1.15
        el.rotation = rot


def build_hands():
    """Gloved hands and forearms, built as one metaball field.

    Hands are the one part of this model that primitives cannot carry. Boxes
    and cylinders gave a pile of separate lumps no matter how carefully they
    were placed, because a hand reads as a single continuous mass with
    knuckles in it, not as an assembly. Metaball elements blend where they
    overlap, so a skeleton of capsules fuses into exactly that, and the whole
    limb -- fingers, palm, wrist, forearm -- comes out as one surface.

    Everything is laid out for the camera's actual position: the viewmodel sits
    right of screen centre, so the weapon's LEFT flank faces the viewer and the
    fingers must close on that side to be seen at all.
    """
    # Much darker. The scene's ambient is deliberately strong so shadows stay
    # readable, and the viewmodel takes all of it at point-blank range: at
    # 0.074 the glove came out a pale beige tube that read as a bare forearm.
    # Three zones up the arm, separated by enough value to be legible at
    # viewmodel size but no more. The whole limb used to be one material from
    # fingertip to frame edge and read as a bare tube; the first correction
    # then put the sleeve at three times the glove's albedo, which made the
    # forearms the brightest object in the frame -- brighter than sunlit
    # stone. Roughly 1.4x per step is enough to read as separate garments.
    glove = mat("vm_glove", (0.030, 0.028, 0.026), metallic=0.0, rough=0.78)
    sleeve = mat("vm_sleeve", (0.042, 0.045, 0.038), metallic=0.0, rough=0.90)
    strap = mat("vm_strap", (0.062, 0.057, 0.047), metallic=0.18, rough=0.54)
    parts = []

    def hand_field(name, material, build_fn, resolution=0.0026):
        mb = bpy.data.metaballs.new(name)
        mb.resolution = resolution
        mb.render_resolution = resolution
        obj = bpy.data.objects.new(name, mb)
        bpy.context.collection.objects.link(obj)
        build_fn(mb)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.ops.object.convert(target="MESH")
        converted = bpy.context.object
        converted.name = name
        converted.data.materials.append(material)
        bpy.ops.object.shade_smooth()
        return converted

    # ---- Firing hand ------------------------------------------------------
    #
    # Laid out around the SCALED grip, which spans y -0.105..-0.017,
    # x -0.017..0.017, z -0.016..0.030. Dimensions are a real hand: 9 mm
    # fingers, a 45 mm palm, a 75 mm forearm.
    def right(mb):
        # Palm: a slab behind the grip, thickest at the heel.
        _limb(mb, (0.006, -0.030, 0.040), (0.010, -0.082, 0.052), 0.0205, 0.0190)
        _limb(mb, (-0.008, -0.032, 0.036), (-0.004, -0.078, 0.048), 0.0170, 0.0158)
        # Four fingers closing on the grip's front-left, where the camera sees
        # them. Each runs across the grip, then curls in and down.
        for i in range(4):
            y = -0.032 - i * 0.0205
            r = 0.0092 - i * 0.0005
            _limb(mb, (0.018, y, 0.030), (-0.016, y - 0.002, 0.016), r, r)
            _limb(mb, (-0.016, y - 0.002, 0.016), (-0.026, y - 0.008, -0.008), r, r * 0.94)
            # The tip curls back IN toward the palm, closing the fist. Left
            # running straight it read as an open hand resting against the
            # grip rather than gripping it.
            _limb(mb, (-0.026, y - 0.008, -0.008), (-0.012, y - 0.016, -0.020), r * 0.94, r * 0.80)
        # Knuckle ridges so the back of the hand is not a smooth dome.
        for i in range(4):
            y = -0.032 - i * 0.0205
            _limb(mb, (0.014, y, 0.024), (0.019, y, 0.033), 0.0082, 0.0070)
        # Thumb, laid up the left of the frame toward the slide.
        _limb(mb, (0.020, -0.050, 0.036), (0.011, -0.030, -0.004), 0.0112, 0.0100)
        _limb(mb, (0.011, -0.030, -0.004), (-0.002, -0.020, -0.030), 0.0100, 0.0086)
        # The hand stops at the wrist. The forearm is a separate field below,
        # so it can carry the sleeve material instead of the glove's.
        _limb(mb, (0.010, -0.086, 0.058), (0.014, -0.102, 0.081), 0.0225, 0.0250)

    # ---- Sleeved forearm --------------------------------------------------
    #
    # Overlaps the wrist so the two fields meet without a seam, and runs out
    # of frame at the bottom right.
    def forearm(mb):
        _limb(mb, (0.013, -0.098, 0.074), (0.020, -0.124, 0.112), 0.0262, 0.0300)
        _limb(mb, (0.020, -0.124, 0.112), (0.034, -0.168, 0.196), 0.0300, 0.0370)

    # ---- Support hand -----------------------------------------------------
    #
    # This was left out once on the grounds that two hands never read as two
    # hands at viewmodel size, and that a one-handed hold at least leaves the
    # weapon's left flank clear for the camera. Two separate reviews called
    # its absence out anyway, and they were right: every reference has both
    # hands on the weapon, and a pistol held one-handed reads as a placeholder
    # however well the hand itself is modelled.
    #
    # The earlier attempt failed because it tried to interleave the support
    # fingers between the firing fingers, which needs more resolution than
    # this has. The real grip does not interleave: the support palm presses
    # flat against the exposed left face of the firing hand and its fingers
    # wrap OVER the firing fingers, one row lower. That is a single continuous
    # mass on the side the camera sees, which is exactly what metaballs are
    # good at.
    def left(mb):
        # Heel of the palm against the firing hand's knuckles.
        _limb(mb, (-0.038, -0.030, 0.030), (-0.045, -0.074, 0.044), 0.0180, 0.0172)
        _limb(mb, (-0.030, -0.034, 0.018), (-0.038, -0.070, 0.030), 0.0155, 0.0148)
        # Four fingers lying across the firing hand's, offset half a finger
        # down so the two sets read as interlocking rather than as one slab.
        for i in range(4):
            y = -0.042 - i * 0.0200
            r = 0.0086 - i * 0.0005
            _limb(mb, (-0.026, y, 0.020), (-0.044, y - 0.004, 0.002), r, r)
            _limb(mb, (-0.044, y - 0.004, 0.002), (-0.048, y - 0.012, -0.022), r, r * 0.92)
        # Thumb forward along the frame, which is where a modern grip puts it
        # and which gives the silhouette a clear point at the front.
        _limb(mb, (-0.042, -0.050, 0.040), (-0.038, -0.026, -0.012), 0.0104, 0.0094)
        _limb(mb, (-0.038, -0.026, -0.012), (-0.032, -0.014, -0.042), 0.0094, 0.0080)
        # Wrist, stopping where its own sleeve picks up.
        _limb(mb, (-0.045, -0.078, 0.050), (-0.052, -0.098, 0.074), 0.0205, 0.0230)

    def left_forearm(mb):
        _limb(mb, (-0.051, -0.094, 0.068), (-0.060, -0.122, 0.108), 0.0246, 0.0284)
        _limb(mb, (-0.060, -0.122, 0.108), (-0.076, -0.170, 0.196), 0.0284, 0.0352)


    parts.append(hand_field("hand_r", glove, right))
    parts.append(hand_field("forearm_r", sleeve, forearm))
    parts.append(hand_field("hand_l", glove, left))
    parts.append(hand_field("forearm_l", sleeve, left_forearm))
    # Cuff bands where glove meets sleeve, which is what tells the eye the
    # forearm is clothed rather than a continuation of the hand.
    parts.append(cyl("r_cuff", 0.0306, 0.026, (0.0165, -0.111, 0.094), strap,
                     rot=(math.radians(29), math.radians(-9), 0), verts=18, bevel=0.0026))
    parts.append(cyl("l_cuff", 0.0292, 0.026, (-0.0555, -0.108, 0.090), strap,
                     rot=(math.radians(31), math.radians(12), 0), verts=18, bevel=0.0026))

    return parts


def export(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_apply=True, export_yup=False, export_materials="EXPORT",
    )
    print("wrote", path, "%.0f KB" % (os.path.getsize(path) / 1024))

if __name__ == "__main__":
    # Blender hands the script everything after `--`, including the separator
    # itself, so taking argv[1] blindly wrote the model into a directory
    # literally named "--". Anything that is not a flag is the output path.
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    out = args[0] if args else "godot/art/models"
    os.makedirs(out, exist_ok=True)
    reset()
    build_pistol()
    build_hands()
    export(os.path.join(out, "viewmodel_needle.glb"))
