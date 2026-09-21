#!/usr/bin/env python3
"""Render the viewmodel on its own so it can be judged at a useful size.

    python3 tools/godot/preview-viewmodel.py out.png [YAW_DEG]

In game the weapon occupies a few hundred pixels in one corner, which is far
too small to tell a badly-placed finger from a shadow. This renders the same
GLB from a camera in roughly the player's eye position, large and lit, so each
modelling change can be checked in one pass instead of through a full level
capture.
"""
import math, os, sys
import bpy

def main(out, yaw=0.0):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath="godot/art/models/viewmodel_needle.glb")
    # The model is authored in Godot space (Y up, -Z forward) and the importer
    # hands it back Y-up, so a default Blender camera -- which also looks down
    # -Z with +Y up -- frames it without any correction.
    rig = bpy.data.objects.new("rig", None)
    bpy.context.collection.objects.link(rig)
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and o.parent is None:
            o.parent = rig
    rig.rotation_euler = (0, math.radians(yaw), 0)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 38
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.02, -0.02, 0.34)
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam

    key = bpy.data.lights.new("key", "AREA"); key.energy = 45; key.size = 1.2
    ko = bpy.data.objects.new("key", key); bpy.context.collection.objects.link(ko)
    ko.location = (0.7, 0.7, 0.7); ko.rotation_euler = (math.radians(-40), math.radians(38), 0)
    fill = bpy.data.lights.new("fill", "AREA"); fill.energy = 12; fill.size = 2.0
    fo = bpy.data.objects.new("fill", fill); bpy.context.collection.objects.link(fo)
    fo.location = (-0.8, 0.2, 0.5); fo.rotation_euler = (math.radians(-20), math.radians(-52), 0)

    world = bpy.data.worlds.new("w"); world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.36, 0.42, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    bpy.context.scene.world = world

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 48
    sc.render.resolution_x = 900; sc.render.resolution_y = 900
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = os.path.abspath(out)
    bpy.ops.render.render(write_still=True)
    print("wrote", out)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "vm.png",
         float(sys.argv[2]) if len(sys.argv) > 2 else 0.0)
