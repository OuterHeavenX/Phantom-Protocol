"""Render original architectural materials in Blender; no external textures.
blender -b -t 6 --python tools/build-level-materials.py
"""
import bpy, math, random
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/sprites/architecture'
OUT.mkdir(parents=True,exist_ok=True)
random.seed(4103)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True
scene.render.resolution_x=scene.render.resolution_y=512
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_mode='RGBA'
scene.world.color=(.22,.25,.29)
scene.view_settings.view_transform='AgX'

def material(name,color,roughness=.8,scale=12):
    m=bpy.data.materials.new(name);m.use_nodes=True
    nodes=m.node_tree.nodes;links=m.node_tree.links
    p=nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=roughness
    noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=scale
    noise.inputs['Detail'].default_value=5;noise.inputs['Roughness'].default_value=.76
    tex=nodes.new('ShaderNodeTexCoord');links.new(tex.outputs['Generated'],noise.inputs['Vector'])
    ramp=nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position=.16;ramp.color_ramp.elements[0].color=tuple(c*.37 for c in color)+(1,)
    ramp.color_ramp.elements[1].position=.84;ramp.color_ramp.elements[1].color=tuple(color)+(1,)
    links.new(noise.outputs['Fac'],ramp.inputs['Fac']);links.new(ramp.outputs['Color'],p.inputs['Base Color'])
    fine=nodes.new('ShaderNodeTexNoise');fine.inputs['Scale'].default_value=180
    fine.inputs['Detail'].default_value=3;links.new(tex.outputs['Generated'],fine.inputs['Vector'])
    bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.5;bump.inputs['Distance'].default_value=.045
    links.new(fine.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],p.inputs['Normal'])
    return m

concrete=material('Aged blue-gray structural concrete',(.32,.38,.39))
stone=material('Quarried slate',(.28,.32,.35),.88,8)
dark=material('Open expansion joints',(.035,.045,.048))
metal=material('Weathered bridge deck',(.20,.25,.27),.48)
snow=material('Compacted windblown snow',(.62,.73,.79),.87,6)
rock=material('Glacial basalt',(.19,.24,.29),.9,5)
rust=material('Oxidized reinforcing steel',(.27,.14,.06),.78)
# Periodic 4D noise avoids visible seams and baked lighting gradients in snow.
nodes=snow.node_tree.nodes;links=snow.node_tree.links
coord=nodes.new('ShaderNodeTexCoord');split=nodes.new('ShaderNodeSeparateXYZ');links.new(coord.outputs['Generated'],split.inputs[0])
circle=[]
for axis in ('X','Y'):
    mul=nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=math.tau;links.new(split.outputs[axis],mul.inputs[0])
    for operation in ('COSINE','SINE'):
        node=nodes.new('ShaderNodeMath');node.operation=operation;links.new(mul.outputs[0],node.inputs[0]);circle.append(node.outputs[0])
vec=nodes.new('ShaderNodeCombineXYZ')
for i in range(3):links.new(circle[i],vec.inputs[i])
noise=nodes.new('ShaderNodeTexNoise');noise.noise_dimensions='4D';noise.inputs['Scale'].default_value=8;noise.inputs['Detail'].default_value=6
links.new(vec.outputs[0],noise.inputs['Vector']);links.new(circle[3],noise.inputs['W'])
ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.09,.14,.18,1);ramp.color_ramp.elements[1].color=(.29,.38,.43,1)
links.new(noise.outputs['Fac'],ramp.inputs[0]);emission=nodes.new('ShaderNodeEmission');links.new(ramp.outputs[0],emission.inputs['Color'])
links.new(emission.outputs[0],nodes.get('Material Output').inputs['Surface'])
objects=[]
def box(name,loc,size,mat,bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.name=name;o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(mat)
    if bevel:
        b=o.modifiers.new('Chipped edge relief','BEVEL');b.width=bevel;b.segments=2
        o.modifiers.new('Corner normals','WEIGHTED_NORMAL')
    objects.append(o);return o

bpy.ops.object.camera_add(location=(0,0,8));camera=bpy.context.object
camera.rotation_euler=(0,0,0);camera.data.type='ORTHO';camera.data.ortho_scale=4
scene.camera=camera
bpy.ops.object.light_add(type='AREA',location=(-3,-4,7));bpy.context.object.data.energy=750;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=5
bpy.ops.object.light_add(type='AREA',location=(4,2,6));bpy.context.object.data.energy=300;bpy.context.object.data.size=4

for kind in ('blacksite-floor','blacksite-wall','crossfall-floor','crossfall-wall','hollow-floor','hollow-wall'):
    for o in objects:o.hide_render=True
    objects=[]
    wall=kind.endswith('wall');theme=kind.split('-')[0]
    base=concrete if theme=='blacksite' else metal if theme=='crossfall' else snow
    if wall:base=concrete if theme!='hollow' else rock
    box(kind+' | mortar bed',(0,0,-.14),(4.2,4.2,.2),dark,0)
    if theme=='hollow' and not wall:
        box('Packed snow',(0,0,-.02),(4,4,.16),snow,0)
    else:
        rows=6 if wall else 4;cols=3 if wall else 4
        sy=4/rows;sx=4/cols
        for row in range(rows):
            offset=sx/2 if wall and row%2 else 0
            for col in range(-1,cols+1):
                x=-2+(col+.5)*sx+offset;y=-2+(row+.5)*sy
                mat=base if (row+col)%5 else (stone if theme=='blacksite' else base)
                o=box('Masonry | course' if wall else 'Deck | slab',(x,y,random.uniform(-.013,.013)),(sx-.032,sy-.032,.18),mat,.02)
                if not wall and theme=='crossfall':
                    for dx in (-sx*.4,sx*.4):
                        box('Deck | countersunk fastener',(x+dx,y-sy*.4,.102),(.032,.032,.009),rust,.003)
    scene.render.filepath=str(OUT/(kind+'.png'));bpy.ops.render.render(write_still=True)
    print('MATERIAL_COMPLETE '+kind,flush=True)
# Original chipped basalt formations, retained as editable meshes.
for o in objects:o.hide_render=True
scene.render.film_transparent=True
camera.location=(0,-7,10);camera.rotation_euler=(Vector((0,0,1.1))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=4.8
for variant in range(3):
    objects=[]
    for i in range(6):
        cx=(i%3-1)*1.04+random.uniform(-.2,.2);cy=(i//3-.5)*.65
        height=random.uniform(1.45,2.6);radius=random.uniform(.52,.73)
        verts=[];n=7
        for ring,z in enumerate((0,height*.46,height)):
            for j in range(n):
                a=j*math.tau/n;rr=radius*random.uniform(.83,1.12)*(1 if ring<2 else .76)
                verts.append((cx+math.cos(a)*rr+ring*.08,cy+math.sin(a)*rr,z+random.uniform(0,.18)))
        faces=[]
        for ring in range(2):
            for j in range(n):faces.append((ring*n+j,ring*n+(j+1)%n,(ring+1)*n+(j+1)%n,(ring+1)*n+j))
        faces.append(tuple(range(2*n,3*n)))
        mesh=bpy.data.meshes.new('Fractured basalt');mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new('Basalt escarpment '+str(variant)+' / '+str(i),mesh);scene.collection.objects.link(obj);obj.data.materials.append(rock);objects.append(obj)
        bevel=obj.modifiers.new('Eroded edges','BEVEL');bevel.width=.035;bevel.segments=2
        top=verts[2*n:];capmesh=bpy.data.meshes.new('Snow cornice')
        capmesh.from_pydata([(x,y,z+.025) for x,y,z in top],[],[tuple(range(n))]);capmesh.update()
        cap=bpy.data.objects.new('Snow cap',capmesh);scene.collection.objects.link(cap);cap.data.materials.append(snow);objects.append(cap)
        thick=cap.modifiers.new('Cornice thickness','SOLIDIFY');thick.thickness=.09
    scene.render.filepath=str(OUT/f'hollow-rock-{variant}.png');bpy.ops.render.render(write_still=True)
    for o in objects:o.hide_render=True
# Preserve the material node graphs and geometry as editable Blender source.
for o in objects:o.hide_render=False
(ROOT/'assets/models').mkdir(exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/models/level-materials.blend'),compress=True)
