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

## A cylinder's depth runs along its LOCAL Z, which in this file's authoring
## space is already Godot's forward. So a barrel, a suppressor or a stock tube
## takes no rotation at all; it is a cross-body pin or a selector -- something
## lying along X -- that needs rot=(0, radians(90), 0). Rotating a barrel by
## 90 degrees about X, which is the instinctive thing to type, stands it on end:
## the first SMG build had its barrel, flash hider and stock tube floating
## vertically above the receiver like a dropped tent pole.
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



# ---------------------------------------------------------------------------
# The Vector: a compact SMG, which is what the references are of.
# ---------------------------------------------------------------------------
#
# The pistol above is the Needle, vesper's starting sidearm. It is not what the
# player is holding during testing and it is not what the reference screenshots
# show: all five are a carbine or an SMG, held with the support hand wrapped
# over a railed handguard, and that silhouette is most of what makes a frame
# read as a modern shooter rather than as a tech demo.
#
# What separates a reference viewmodel from a grey blockout is almost entirely
# COUNT of hard-surface detail, not the accuracy of the main shapes. A real
# rail has forty individual teeth; an ejection port is a recess with a lip; a
# receiver carries screws, pins, a selector, a magazine release, a sling loop
# and stamped text. None of it is individually clever and all of it is what the
# eye reads as "manufactured". So this is built as a lot of small parts and
# then joined per material, which keeps the draw call count where the blockout
# had it.

def _rail(name, material, z0, z1, y, x=0.0, width=0.021, pitch=0.0082):
    """A length of Picatinny rail: a flat base with slots cut by the teeth.

    Modelled as the teeth rather than as the slots, because a tooth is a box
    and a slot is a boolean. At viewmodel distance the difference is not
    visible and the boolean is where this would start failing.
    """
    parts = []
    base = box("%s_base" % name, (width, 0.0042, abs(z1 - z0)),
               (x, y, (z0 + z1) * 0.5), material, bevel=0.0007)
    parts.append(base)
    n = max(2, int(abs(z1 - z0) / pitch))
    for i in range(n):
        z = min(z0, z1) + pitch * (i + 0.5)
        parts.append(box("%s_t%d" % (name, i), (width, 0.0046, pitch * 0.55),
                         (x, y + 0.0044, z), material, bevel=0.0006))
    return parts


def _screw(name, at, material, r=0.0024, depth=0.0026, axis="x"):
    rot = (0, math.radians(90), 0) if axis == "x" else (math.radians(90), 0, 0)
    return cyl(name, r, depth, at, material, rot=rot, verts=12, bevel=0.0004)


def build_smg():
    """Vector SMG. Barrel along -Z, up is +Y, grip near the origin."""
    # The reference weapons are a desaturated blue-grey, not black: a black
    # weapon against this build's dark paving loses its silhouette entirely,
    # which is the mistake the pistol made. Reference 1 measures around 0.20
    # to 0.28 on the receiver flats with much brighter machined edges.
    #
    # These are much lighter than the sector's materials and than the pistol's,
    # and that is deliberate rather than drift. A viewmodel is not lit by the
    # world -- it has its own rig on its own layer -- and every reference is
    # lit far hotter than the scene behind it, because a weapon that tracks
    # the world's exposure disappears whenever the player walks into shade.
    # Measured against the reference, with one correction already burned in:
    # that PNG is a cutout on an OPAQUE WHITE background, not a transparent
    # one -- its alpha is 1.0 everywhere -- so the first pass masked nothing
    # and read the weapon's mean as 0.672 when 57% of those pixels were
    # background. The weapon's real mean is 0.284.
    #
    # What the reference actually has is a value HIERARCHY, which this did
    # not: the black polymer furniture is the darkest thing on the weapon
    # (0.143), the metal sits in the middle, and only the machined chamfers
    # are bright. The first SMG had that inverted, with the polymer stock the
    # brightest object in the frame.
    body = mat("vm_body", (0.108, 0.115, 0.132), metallic=0.62, rough=0.30)
    body_dark = mat("vm_body_dark", (0.046, 0.050, 0.060), metallic=0.58, rough=0.50)
    poly = mat("vm_poly", (0.031, 0.032, 0.036), metallic=0.0, rough=0.70)
    steel = mat("vm_steel2", (0.200, 0.210, 0.228), metallic=0.88, rough=0.13)
    bore = mat("vm_bore2", (0.010, 0.010, 0.012), metallic=0.2, rough=0.9)
    # The charging handle and the selector are the one warm accent in the
    # reference -- a tan/bronze lever that reads instantly against the blue
    # -grey. Without it the whole weapon is one hue and looks untextured.
    accent = mat("vm_accent2", (0.232, 0.150, 0.066), metallic=0.55, rough=0.38)

    # ---- Receiver ---------------------------------------------------------
    box("rx_main", (0.054, 0.047, 0.255), (0.0, 0.012, -0.030), body, bevel=0.0022)
    # A raised spine along the top, so the rail does not sit on a flat plate.
    box("rx_spine", (0.030, 0.012, 0.250), (0.0, 0.038, -0.030), body, bevel=0.0018)
    # Ejection port: a recessed panel with a proud lip around it. Two boxes
    # rather than a boolean -- the lip is what catches light and reads as a
    # cut, the recess alone reads as a decal.
    box("rx_port_lip", (0.0032, 0.030, 0.076), (0.0274, 0.020, -0.052), body, bevel=0.0009)
    box("rx_port", (0.0030, 0.024, 0.068), (0.0286, 0.020, -0.052), bore, bevel=0.0006)
    # Left-side flat, where the stamped text goes once this is textured.
    box("rx_plate", (0.0030, 0.034, 0.150), (-0.0276, 0.014, -0.040), body_dark, bevel=0.0009)

    # ---- Handguard --------------------------------------------------------
    box("hg_main", (0.046, 0.042, 0.150), (0.0, 0.010, -0.232), poly, bevel=0.0020)
    # Vent slots down both sides, which is most of what says "handguard"
    # rather than "tube" at this distance.
    for i in range(6):
        z = -0.170 - i * 0.021
        for sx in (-1, 1):
            box("hg_vent%d_%d" % (i, sx), (0.0034, 0.016, 0.012),
                (sx * 0.0238, 0.010, z), bore, bevel=0.0005)
    # Side rails, short, as the references carry.
    _rail("hg_railL", body, -0.290, -0.200, 0.010, x=-0.0250, width=0.0044, pitch=0.0090)
    _rail("hg_railR", body, -0.290, -0.200, 0.010, x=0.0250, width=0.0044, pitch=0.0090)

    # ---- Top rail, the full length ----------------------------------------
    _rail("rail", body, -0.300, 0.075, 0.046)

    # ---- Barrel and muzzle ------------------------------------------------
    cyl("bbl", 0.0092, 0.095, (0.0, 0.010, -0.340), steel)
    cyl("bbl_nut", 0.0130, 0.016, (0.0, 0.010, -0.303), body, verts=16)
    # Flash hider with real slots, not a smooth tube.
    cyl("fh", 0.0135, 0.038, (0.0, 0.010, -0.392), body_dark, verts=16)
    for i in range(5):
        a = math.radians(-58 + i * 29)
        box("fh_slot%d" % i, (0.0040, 0.0150, 0.020),
            (math.sin(a) * 0.0115, 0.010 + math.cos(a) * 0.0115, -0.396), bore,
            rot=(0, 0, -a), bevel=0.0004)
    cyl("muzzle_bore", 0.0068, 0.012, (0.0, 0.010, -0.408), bore, verts=16, bevel=0)

    # ---- Iron sights ------------------------------------------------------
    # Front post in a protective hood, rear aperture on a folding leaf. The
    # references all carry these even when an optic is fitted, and they are
    # the highest-contrast small shapes in the frame.
    box("fs_base", (0.020, 0.010, 0.020), (0.0, 0.052, -0.276), body_dark, bevel=0.0008)
    for sx in (-1, 1):
        box("fs_ear%d" % sx, (0.0034, 0.024, 0.016), (sx * 0.0082, 0.066, -0.276), body_dark, bevel=0.0006)
    box("fs_post", (0.0026, 0.019, 0.0026), (0.0, 0.0635, -0.276), steel, bevel=0.0004)
    box("rs_base", (0.022, 0.011, 0.024), (0.0, 0.052, 0.020), body_dark, bevel=0.0008)
    box("rs_ring", (0.018, 0.018, 0.0040), (0.0, 0.068, 0.020), body_dark, bevel=0.0007)
    cyl("rs_hole", 0.0052, 0.006, (0.0, 0.068, 0.020), bore, verts=14, bevel=0)

    # ---- Charging handle --------------------------------------------------
    box("ch_arm", (0.010, 0.0090, 0.052), (-0.0300, 0.030, 0.016), accent, bevel=0.0008)
    box("ch_knob", (0.0180, 0.0125, 0.016), (-0.0360, 0.030, 0.034), accent, bevel=0.0010)

    # ---- Controls ---------------------------------------------------------
    cyl("sel", 0.0068, 0.008, (-0.0290, -0.004, 0.044), body_dark, rot=(0, math.radians(90), 0), verts=14)
    box("sel_lever", (0.0075, 0.0052, 0.020), (-0.0320, -0.004, 0.052), accent, bevel=0.0006)
    cyl("mag_rel", 0.0052, 0.007, (0.0280, -0.002, -0.006), body_dark, rot=(0, math.radians(90), 0), verts=12)
    box("sling", (0.0060, 0.014, 0.0060), (-0.0280, 0.030, 0.070), body_dark, bevel=0.0008)

    # ---- Magazine ---------------------------------------------------------
    # Raked forward, which is what stops a magazine reading as a brick.
    box("mag", (0.026, 0.135, 0.040), (0.0, -0.082, -0.012), poly, rot=(math.radians(-7), 0, 0), bevel=0.0018)
    box("mag_well", (0.034, 0.028, 0.050), (0.0, -0.016, -0.014), body, bevel=0.0016)
    for i in range(4):
        box("mag_rib%d" % i, (0.0272, 0.0040, 0.030),
            (0.0, -0.046 - i * 0.026, -0.008 + i * 0.003), bore,
            rot=(math.radians(-7), 0, 0), bevel=0.0005)

    # ---- Grip -------------------------------------------------------------
    box("grip", (0.032, 0.098, 0.044), (0.0, -0.062, 0.062), poly, rot=(math.radians(13), 0, 0), bevel=0.0028)
    # Finger grooves, so the grip is not a slab.
    for i in range(3):
        cyl("grip_groove%d" % i, 0.0062, 0.033, (0.0, -0.040 - i * 0.024, 0.0415 - i * 0.005),
            bore, rot=(0, math.radians(90), 0), verts=12, bevel=0)
    box("trigger_guard", (0.0075, 0.030, 0.044), (0.0, -0.026, 0.028), body, bevel=0.0022)
    box("trigger", (0.0055, 0.020, 0.0075), (0.0, -0.026, 0.030), steel, bevel=0.0007)

    # ---- Stock ------------------------------------------------------------
    cyl("stock_tube", 0.0150, 0.090, (0.0, 0.016, 0.145), body, verts=16)
    box("stock_body", (0.038, 0.050, 0.070), (0.0, 0.012, 0.165), poly, bevel=0.0022)
    box("stock_pad", (0.040, 0.062, 0.012), (0.0, 0.006, 0.202), body_dark, bevel=0.0026)
    box("stock_cheek", (0.030, 0.012, 0.055), (0.0, 0.040, 0.150), poly, bevel=0.0016)

    # ---- Fasteners --------------------------------------------------------
    for i, (x, y, z) in enumerate([
            (0.0272, 0.030, 0.052), (0.0272, -0.002, -0.088), (-0.0272, 0.030, 0.052),
            (-0.0272, -0.002, -0.088), (0.0236, 0.010, -0.286), (-0.0236, 0.010, -0.286),
            (0.0272, 0.032, -0.104), (-0.0272, 0.032, -0.104)]):
        _screw("screw%d" % i, (x, y, z), steel)


def build_smg_gloves():
    """Gloved hands on the SMG: support hand over the handguard, firing hand
    on the grip.

    Two things separate these from the pistol's hands above, and both come
    straight off the references.

    Fingers are separate metaball FIELDS, one per finger, not separate
    elements of one field. Elements of a single field blend into each other,
    which is what turned the last pair of hands into a mitten -- four fingers
    a centimetre apart merge into one mass long before they touch. A field per
    finger cannot blend, so the gaps survive at any resolution.

    And the glove carries hard-surface armour. Every reference glove has
    moulded knuckle plates and a cuff with a distinct edge, and those plates
    are the only crisp specular in an otherwise soft object -- without them a
    hand at this distance is a smooth blob no matter how good its silhouette
    is.
    """
    glove = mat("vm_glove2", (0.028, 0.030, 0.034), metallic=0.0, rough=0.78)
    plate = mat("vm_plate", (0.066, 0.066, 0.070), metallic=0.10, rough=0.46)
    cuff = mat("vm_cuff", (0.052, 0.055, 0.058), metallic=0.0, rough=0.90)

    def field(name, material, build_fn, resolution=0.0022):
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
        conv = bpy.context.object
        conv.name = name
        conv.data.materials.append(material)
        bpy.ops.object.shade_smooth()
        return conv

    def finger(name, pts, r0, r1):
        """One finger, in its own field so it cannot merge with its neighbours."""
        def build(mb):
            for i in range(len(pts) - 1):
                t0 = i / float(len(pts) - 1)
                t1 = (i + 1) / float(len(pts) - 1)
                _limb(mb, pts[i], pts[i + 1],
                      r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1)
        return field(name, glove, build, resolution=0.0016)

    # ---- Support hand, wrapped over the handguard -------------------------
    #
    # The handguard spans x -0.023..0.023, y -0.011..0.031, z -0.307..-0.157.
    # The fingers come up the left side, over the top and down the right, which
    # is a real support grip and is what all five references show. The knuckles
    # therefore sit on TOP of the weapon, in frame, where their plates read.
    for i in range(4):
        z = -0.196 - i * 0.0205
        finger("sup_f%d" % i, [
            (-0.034, -0.004, z), (-0.031, 0.020, z + 0.001),
            (-0.014, 0.041, z + 0.002), (0.012, 0.041, z + 0.002),
            (0.027, 0.023, z + 0.001)],
            0.0090 - i * 0.0004, 0.0074 - i * 0.0004)
    # Thumb, along the near side and pointing forward.
    finger("sup_thumb", [
        (-0.040, -0.026, -0.170), (-0.040, -0.014, -0.196),
        (-0.036, -0.004, -0.224), (-0.031, 0.004, -0.248)], 0.0105, 0.0082)

    def sup_palm(mb):
        # The heel of the hand, below and left of the handguard.
        _limb(mb, (-0.040, -0.014, -0.186), (-0.042, -0.026, -0.246), 0.0175, 0.0165)
        _limb(mb, (-0.034, 0.004, -0.188), (-0.036, -0.006, -0.244), 0.0150, 0.0140)
        # The back of the hand, riding the top-left corner of the handguard.
        _limb(mb, (-0.030, 0.022, -0.190), (-0.032, 0.014, -0.250), 0.0135, 0.0125)
    field("sup_palm", glove, sup_palm)

    def sup_arm(mb):
        # Down and to the left, out of frame toward the shoulder.
        _limb(mb, (-0.044, -0.030, -0.240), (-0.078, -0.098, -0.180), 0.0215, 0.0250)
        _limb(mb, (-0.078, -0.098, -0.180), (-0.120, -0.180, -0.090), 0.0250, 0.0290)
    field("sup_arm", cuff, sup_arm)

    # Knuckle plates on the support hand, sitting over the top of the guard.
    for i in range(4):
        z = -0.196 - i * 0.0205
        box("sup_kn%d" % i, (0.020, 0.0070, 0.0165), (-0.006, 0.0475, z + 0.002),
            plate, rot=(0, 0, math.radians(-14)), bevel=0.0012, segments=3)
    # Cuff band where the glove meets the sleeve.
    cyl("sup_cuff", 0.0245, 0.020, (-0.052, -0.046, -0.228), plate,
        rot=(math.radians(62), math.radians(-28), 0), verts=18, bevel=0.0016)

    # ---- Firing hand, on the grip -----------------------------------------
    #
    # The grip is centred (0, -0.062, 0.062), 0.032 x 0.098 x 0.044, raked 13.
    for i in range(3):
        y = -0.040 - i * 0.022
        finger("fire_f%d" % i, [
            (0.026, y, 0.052), (0.022, y - 0.004, 0.032),
            (0.006, y - 0.008, 0.026), (-0.012, y - 0.006, 0.030)],
            0.0086 - i * 0.0004, 0.0072 - i * 0.0004)
    # Trigger finger, forward onto the trigger rather than around the grip.
    finger("fire_trig", [
        (0.024, -0.026, 0.050), (0.020, -0.028, 0.034),
        (0.010, -0.028, 0.024)], 0.0086, 0.0074)

    def fire_palm(mb):
        _limb(mb, (0.018, -0.030, 0.078), (0.020, -0.086, 0.092), 0.0195, 0.0180)
        _limb(mb, (0.004, -0.032, 0.076), (0.006, -0.082, 0.090), 0.0165, 0.0155)
    field("fire_palm", glove, fire_palm)

    def fire_arm(mb):
        _limb(mb, (0.020, -0.090, 0.098), (0.044, -0.158, 0.172), 0.0215, 0.0255)
        _limb(mb, (0.044, -0.158, 0.172), (0.070, -0.232, 0.250), 0.0255, 0.0295)
    field("fire_arm", cuff, fire_arm)

    for i in range(3):
        y = -0.040 - i * 0.022
        box("fire_kn%d" % i, (0.0070, 0.017, 0.016), (0.0305, y, 0.050),
            plate, rot=(0, math.radians(8), 0), bevel=0.0011, segments=3)
    cyl("fire_cuff", 0.0240, 0.019, (0.028, -0.104, 0.112), plate,
        rot=(math.radians(-42), math.radians(18), 0), verts=18, bevel=0.0016)


def join_by_material():
    """Collapse the parts into one mesh per material.

    The weapon is about two hundred separate objects by the time the rail
    teeth, vents, ribs and screws are placed, and Godot draws every
    MeshInstance3D on its own. Two hundred draw calls for an object in the
    corner of the screen is not affordable next to a sector that was just cut
    to 629, and nothing here ever moves independently, so they collapse to one
    mesh per material with no visible change.
    """
    groups = {}
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH" or not o.data.materials:
            continue
        groups.setdefault(o.data.materials[0].name, []).append(o)
    for name, objs in groups.items():
        if len(objs) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        bpy.context.object.name = "part_%s" % name
    return len(groups)


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
    join_by_material()
    export(os.path.join(out, "viewmodel_needle.glb"))

    reset()
    build_smg()
    build_smg_gloves()
    parts = join_by_material()
    print("smg: %d material groups" % parts)
    export(os.path.join(out, "viewmodel_vector.glb"))
