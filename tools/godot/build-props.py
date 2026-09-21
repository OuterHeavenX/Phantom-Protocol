#!/usr/bin/env python3
"""Detail props for the 3D sector, built in Blender and exported as GLB.

    python3 tools/godot/build-props.py godot/art/models

The reference screenshots are dense with small hardware: conduit and pipe runs
up the walls, air handlers, awnings, hanging signs, dishes, shutters, wall
lamps, drums and crates. That clutter is most of the difference between a
level that reads as a place and one that reads as a greybox with textures on
it.

**Every prop here is wall-mounted, overhead, or sits on top of something the
simulation already treats as solid.** That rule is not stylistic. The 2D game
owns collision, and this build's colliders are exactly its rectangles; a prop
standing loose on the floor would be walk-through decoration indistinguishable
from real cover, which is precisely the defect that was chased out of the 2D
renderer earlier. Wall and overhead dressing adds density with no collision
question at all, because there is nowhere for the operative to walk into it.
"""
import math, os, sys
import bpy

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, base, metallic=0.0, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    return m

def box(size, loc, material, rot=(0, 0, 0), bevel=0.01, flat=True):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel; b.segments = 2
        b.limit_method = "ANGLE"; b.angle_limit = math.radians(40)
    if flat:
        bpy.ops.object.shade_flat()
    return o

def cyl(r, depth, loc, material, rot=(0, 0, 0), verts=16, bevel=0.006):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc,
                                        rotation=rot, vertices=verts)
    o = bpy.context.object
    o.data.materials.append(material)
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel; b.segments = 2
        b.limit_method = "ANGLE"; b.angle_limit = math.radians(40)
    bpy.ops.object.shade_smooth()
    return o

# Shared palette. Kept muted so props never out-saturate the architecture.
def palette():
    return {
        "steel": mat("p_steel", (0.30, 0.31, 0.32), 0.85, 0.42),
        "galv": mat("p_galv", (0.44, 0.46, 0.47), 0.70, 0.52),
        "rust": mat("p_rust", (0.26, 0.13, 0.07), 0.35, 0.82),
        "paint_blue": mat("p_blue", (0.10, 0.20, 0.30), 0.25, 0.55),
        "paint_red": mat("p_red", (0.32, 0.09, 0.07), 0.20, 0.60),
        "wood": mat("p_wood", (0.30, 0.20, 0.11), 0.0, 0.78),
        "canvas": mat("p_canvas", (0.42, 0.33, 0.22), 0.0, 0.88),
        "dark": mat("p_dark", (0.045, 0.048, 0.050), 0.30, 0.66),
        "glass": mat("p_glass", (0.60, 0.66, 0.62), 0.10, 0.18),
        "concrete": mat("p_conc", (0.40, 0.39, 0.36), 0.0, 0.88),
    }

# --- Props. Local origin is the mounting point: the wall face at Z=0, with
#     +Z pointing out of the wall into the room, +Y up. -----------------------

def prop_pipe_run(P):
    """Three pipes on brackets, running horizontally along a wall."""
    for i, (y, r, m) in enumerate([(0.0, 0.055, P["steel"]), (0.15, 0.040, P["rust"]), (0.28, 0.030, P["galv"])]):
        cyl(r, 5.6, (0, y, 0.10 + r), m, rot=(0, math.radians(90), 0), verts=14)
    for bx in (-2.4, -0.8, 0.8, 2.4):
        box((0.05, 0.42, 0.11), (bx, 0.14, 0.055), P["galv"], bevel=0.006)
    # A valve wheel breaks the run's repetition.
    cyl(0.16, 0.035, (1.6, 0.0, 0.30), P["rust"], rot=(0, math.radians(90), 0), verts=18)
    cyl(0.05, 0.16, (1.6, 0.0, 0.22), P["steel"], rot=(0, math.radians(90), 0))

def prop_conduit(P):
    """Junction box with conduit dropping away from it."""
    box((0.42, 0.56, 0.20), (0, 0, 0.10), P["galv"], bevel=0.012)
    box((0.34, 0.46, 0.02), (0, 0, 0.21), P["dark"], bevel=0.004)
    for dx in (-0.12, 0.12):
        cyl(0.028, 1.5, (dx, -1.03, 0.08), P["galv"], rot=(0, 0, 0), verts=10)
    cyl(0.028, 0.9, (0.12, 0.73, 0.08), P["galv"], verts=10)
    box((0.10, 0.06, 0.09), (0, -0.32, 0.09), P["paint_red"], bevel=0.004)

def prop_ac_unit(P):
    """Wall-hung air handler with a grille and a drip line."""
    box((1.05, 0.72, 0.52), (0, 0, 0.27), P["galv"], bevel=0.018)
    box((0.92, 0.60, 0.03), (0, 0, 0.54), P["dark"], bevel=0.006)
    for i in range(7):
        box((0.88, 0.022, 0.03), (0, -0.25 + i * 0.085, 0.555), P["steel"], bevel=0.003)
    box((1.08, 0.10, 0.14), (0, 0.41, 0.08), P["steel"], bevel=0.008)
    cyl(0.022, 1.4, (0.44, -1.06, 0.06), P["dark"], verts=8)
    box((0.16, 0.12, 0.10), (-0.40, -0.44, 0.10), P["rust"], bevel=0.006)

def prop_awning(P):
    """Canvas canopy on a steel frame, well above head height."""
    box((2.6, 0.05, 1.25), (0, 0.30, 0.66), P["canvas"], rot=(math.radians(-14), 0, 0), bevel=0.01)
    for sx in (-1.22, 0.0, 1.22):
        box((0.05, 0.05, 1.30), (sx, 0.24, 0.65), P["steel"], rot=(math.radians(-14), 0, 0), bevel=0.006)
    box((2.64, 0.10, 0.08), (0, 0.46, 0.04), P["steel"], bevel=0.008)
    # Scalloped valance along the front lip.
    box((2.6, 0.22, 0.03), (0, -0.02, 1.26), P["canvas"], bevel=0.006)
    for sx in (-1.0, 1.0):
        box((0.04, 0.60, 0.04), (sx, 0.02, 0.36), P["steel"], rot=(math.radians(38), 0, 0), bevel=0.004)

def prop_sign(P):
    """Projecting sign on a bracket."""
    box((0.05, 0.05, 0.85), (0, 0.30, 0.42), P["steel"], bevel=0.005)
    box((0.06, 0.62, 0.05), (0, 0.02, 0.80), P["steel"], bevel=0.005)
    box((0.04, 0.52, 1.10), (0, -0.05, 1.10), P["paint_blue"], bevel=0.008)
    box((0.02, 0.40, 0.94), (0.035, -0.05, 1.10), P["canvas"], bevel=0.004)
    box((0.03, 0.10, 0.10), (0, 0.22, 1.60), P["rust"], bevel=0.004)

def prop_dish(P):
    """Satellite dish on a stand-off mast."""
    cyl(0.045, 0.85, (0, 0.40, 0.10), P["galv"], verts=10)
    box((0.22, 0.08, 0.22), (0, 0.0, 0.11), P["galv"], bevel=0.008)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.52, location=(0, 0.80, 0.42), segments=20, ring_count=10)
    d = bpy.context.object
    d.scale = (1.0, 1.0, 0.34)
    bpy.ops.object.transform_apply(scale=True)
    d.data.materials.append(P["galv"])
    bpy.ops.object.shade_smooth()
    cyl(0.035, 0.42, (0, 0.80, 0.62), P["dark"], verts=8)
    cyl(0.07, 0.07, (0, 0.80, 0.82), P["dark"], verts=10)

def prop_shutter(P):
    """Louvred shutter pair for a window reveal."""
    for sx in (-0.34, 0.34):
        box((0.62, 1.42, 0.05), (sx, 0, 0.035), P["paint_blue"], bevel=0.006)
        for i in range(11):
            box((0.54, 0.055, 0.02), (sx, -0.60 + i * 0.12, 0.065), P["paint_blue"], bevel=0.003)
        box((0.62, 0.09, 0.055), (sx, 0.64, 0.04), P["paint_blue"], bevel=0.004)
    box((0.06, 0.06, 0.07), (0, 0, 0.07), P["rust"], bevel=0.004)

def prop_wall_lamp(P):
    """Gooseneck wall lamp. Placed at the level's own structureLight points."""
    box((0.10, 0.16, 0.06), (0, 0, 0.03), P["dark"], bevel=0.006)
    cyl(0.028, 0.36, (0, 0.10, 0.20), P["dark"], rot=(math.radians(62), 0, 0), verts=10)
    bpy.ops.mesh.primitive_cone_add(radius1=0.24, radius2=0.09, depth=0.22,
                                    location=(0, 0.02, 0.40), rotation=(math.radians(180), 0, 0), vertices=18)
    c = bpy.context.object
    c.data.materials.append(P["galv"])
    bpy.ops.object.shade_smooth()
    cyl(0.13, 0.03, (0, 0.02, 0.30), P["glass"], verts=16)

def prop_drum(P):
    """Oil drum. Sits on top of an existing solid, never loose on the floor."""
    cyl(0.29, 0.88, (0, 0.44, 0), P["paint_red"], rot=(math.radians(90), 0, 0), verts=22)
    for y in (0.20, 0.44, 0.68):
        cyl(0.305, 0.05, (0, y, 0), P["rust"], rot=(math.radians(90), 0, 0), verts=22)
    cyl(0.26, 0.03, (0, 0.885, 0), P["rust"], rot=(math.radians(90), 0, 0), verts=22)

def prop_crate_stack(P):
    """Two crates and a pallet, for stacking on containers."""
    box((0.62, 0.52, 0.62), (0, 0.26, 0), P["wood"], bevel=0.012)
    for e in (-0.31, 0.31):
        box((0.04, 0.52, 0.62), (e, 0.26, 0), P["wood"], bevel=0.006)
        box((0.62, 0.52, 0.04), (0, 0.26, e), P["wood"], bevel=0.006)
    box((0.50, 0.42, 0.50), (0.10, 0.73, 0.06), P["wood"], rot=(0, math.radians(17), 0), bevel=0.010)
    box((0.86, 0.09, 0.66), (0, -0.045, 0), P["wood"], bevel=0.006)

PROPS = {
    "pipe_run": prop_pipe_run, "conduit": prop_conduit, "ac_unit": prop_ac_unit,
    "awning": prop_awning, "sign": prop_sign, "dish": prop_dish,
    "shutter": prop_shutter, "wall_lamp": prop_wall_lamp,
    "drum": prop_drum, "crate_stack": prop_crate_stack,
}

def export(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=False, export_materials="EXPORT")

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "godot/art/models"
    os.makedirs(out, exist_ok=True)
    total = 0
    for name, fn in PROPS.items():
        reset()
        fn(palette())
        p = os.path.join(out, "prop_%s.glb" % name)
        export(p)
        total += os.path.getsize(p)
        print("wrote", os.path.basename(p), "%.0f KB" % (os.path.getsize(p) / 1024))
    print("total %.0f KB" % (total / 1024))
