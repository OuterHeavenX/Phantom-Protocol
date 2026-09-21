#!/usr/bin/env python3
"""Hostile and operative character models, built in Blender as GLB.

    python3 tools/godot/build-characters.py godot/art/models

Authored in Godot's axis convention -- X right, Y up, -Z forward -- and
exported with `export_yup=False`, the same rule the viewmodel uses, so the
coordinates pass through untouched.

These are seen at five to forty metres in a first-person view, never close, so
they are built for silhouette and value rather than for detail: a readable
head-shoulders-weapon outline, a dark kit tone against the sunlit sandstone,
and one accent colour per archetype taken from data/enemies.js so the same
unit reads the same way it does in the 2D game.
"""
import math, os, sys
import bpy

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, base, metallic=0.0, rough=0.62, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 3.0
    return m

def box(name, size, loc, material, rot=(0, 0, 0), bevel=0.012):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel; b.segments = 2
        b.limit_method = "ANGLE"; b.angle_limit = math.radians(40)
    bpy.ops.object.shade_flat()
    return o

def cyl(name, r, depth, loc, material, rot=(0, 0, 0), verts=12):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc,
                                        rotation=rot, vertices=verts)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o

def sphere(name, r, loc, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=16, ring_count=8)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o

def hexrgb(h):
    """sRGB hex to linear, the same conversion tools/blender/render.py uses."""
    h = h.lstrip("#")
    def f(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(int(h[i:i + 2], 16)) for i in (0, 2, 4))

def humanoid(body_hex, accent_hex, build="medium", helmet="visor", weapon="rifle"):
    """One figure. `build` scales mass, not height: a shield trooper is wider."""
    body = mat("c_body", hexrgb(body_hex), rough=0.66)
    dark = mat("c_dark", tuple(v * 0.42 for v in hexrgb(body_hex)), rough=0.72)
    accent = mat("c_accent", hexrgb(accent_hex), metallic=0.25, rough=0.38,
                 emit=hexrgb(accent_hex))
    steel = mat("c_steel", (0.035, 0.038, 0.042), metallic=0.85, rough=0.36)
    boot = mat("c_boot", (0.020, 0.020, 0.022), rough=0.85)

    w = {"light": 0.88, "medium": 1.0, "heavy": 1.18, "exo": 1.32}[build]

    # Legs. Straight, because these never animate in this build.
    for sx in (-0.11 * w, 0.11 * w):
        box("thigh", (0.15 * w, 0.46, 0.17), (sx, 0.42, 0), dark)
        box("shin", (0.13 * w, 0.42, 0.15), (sx, 0.02, 0.01), dark)
        box("boot", (0.15 * w, 0.11, 0.26), (sx, -0.16, -0.04), boot)
    # Torso and webbing.
    box("torso", (0.44 * w, 0.56, 0.27), (0, 0.92, 0), body)
    box("plate", (0.40 * w, 0.34, 0.09), (0, 0.96, -0.16), dark)
    box("belt", (0.45 * w, 0.09, 0.28), (0, 0.66, 0), dark)
    box("pouchL", (0.10, 0.12, 0.10), (-0.16 * w, 0.70, -0.16), dark)
    box("pouchR", (0.10, 0.12, 0.10), (0.16 * w, 0.70, -0.16), dark)
    # Shoulders and arms, held forward around a weapon.
    for sx in (-1, 1):
        sphere("shoulder", 0.13 * w, (sx * 0.26 * w, 1.13, 0), body, scale=(1, 0.9, 1))
        box("upper", (0.13, 0.30, 0.14), (sx * 0.27 * w, 0.96, -0.02), body)
        box("fore", (0.12, 0.13, 0.30), (sx * 0.20 * w, 0.83, -0.20), dark)
    # Head.
    box("neck", (0.13, 0.08, 0.13), (0, 1.24, 0), dark)
    sphere("head", 0.13, (0, 1.36, -0.01), body, scale=(1.0, 1.12, 1.08))
    if helmet == "full":
        sphere("helm", 0.155, (0, 1.38, -0.01), dark, scale=(1.0, 1.0, 1.08))
        box("visor", (0.17, 0.05, 0.03), (0, 1.35, -0.14), accent)
    elif helmet == "visor":
        sphere("helm", 0.15, (0, 1.40, -0.01), dark, scale=(1.0, 0.8, 1.06))
        box("visor", (0.20, 0.06, 0.03), (0, 1.34, -0.13), accent)
    else:
        box("cap", (0.26, 0.05, 0.24), (0, 1.47, -0.01), dark)
    # Weapon, carried across the body.
    if weapon == "rifle":
        box("gun", (0.06, 0.09, 0.62), (0.10, 0.88, -0.36), steel)
        box("mag", (0.05, 0.16, 0.08), (0.10, 0.77, -0.30), dark)
        box("stock", (0.05, 0.11, 0.18), (0.10, 0.88, 0.00), dark)
    elif weapon == "heavy":
        cyl("gun", 0.065, 0.80, (0.12, 0.90, -0.44), steel)
        box("drum", (0.08, 0.22, 0.22), (0.12, 0.76, -0.24), dark)
    elif weapon == "shield":
        box("gun", (0.05, 0.08, 0.38), (0.16, 0.86, -0.22), steel)
        box("shield", (0.06, 0.92, 0.62), (-0.30, 0.86, -0.18), accent,
            rot=(0, math.radians(-12), 0))
    # A back-mounted power pack, which reads as machine at silhouette size.
    box("pack", (0.30 * w, 0.34, 0.14), (0, 0.98, 0.20), dark)
    box("cell", (0.10, 0.10, 0.05), (0, 1.04, 0.28), accent)

def drone_body(body_hex, accent_hex):
    body = mat("d_body", hexrgb(body_hex), metallic=0.4, rough=0.45)
    dark = mat("d_dark", tuple(v * 0.35 for v in hexrgb(body_hex)), rough=0.6)
    accent = mat("d_accent", hexrgb(accent_hex), metallic=0.2, rough=0.3, emit=hexrgb(accent_hex))
    sphere("hull", 0.26, (0, 1.05, 0), body, scale=(1.0, 0.7, 1.25))
    box("eye", (0.16, 0.07, 0.04), (0, 1.05, -0.30), accent)
    for sx in (-1, 1):
        box("arm", (0.34, 0.05, 0.08), (sx * 0.30, 1.10, 0), dark)
        cyl("hub", 0.07, 0.06, (sx * 0.46, 1.13, 0), dark)
        cyl("disc", 0.22, 0.012, (sx * 0.46, 1.16, 0), accent)
    box("gun", (0.06, 0.06, 0.24), (0, 0.92, -0.20), dark)

# Archetype -> (model fn, kwargs). Colours come from data/enemies.js.
KINDS = {
    "soldier": (humanoid, dict(body_hex="#7f8c94", accent_hex="#ff6a5c", build="medium", helmet="visor", weapon="rifle")),
    "shield": (humanoid, dict(body_hex="#8d8a72", accent_hex="#e0c982", build="heavy", helmet="full", weapon="shield")),
    "sniper": (humanoid, dict(body_hex="#93798c", accent_hex="#e6b9d2", build="light", helmet="cap", weapon="rifle")),
    "heavy": (humanoid, dict(body_hex="#96795f", accent_hex="#ffb0a0", build="exo", helmet="full", weapon="heavy")),
    "drone": (drone_body, dict(body_hex="#6f8590", accent_hex="#8fd8ff")),
}

def export(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=False, export_materials="EXPORT")

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "godot/art/models"
    os.makedirs(out, exist_ok=True)
    for name, (fn, kw) in KINDS.items():
        reset()
        fn(**kw)
        p = os.path.join(out, "char_%s.glb" % name)
        export(p)
        print("wrote", os.path.basename(p), "%.0f KB" % (os.path.getsize(p) / 1024))
