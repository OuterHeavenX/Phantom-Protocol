"""Blender 5.x: original hard-surface combatants, editable source + 8-way walk frames.
Run from repository root: blender -b -t 4 --python tools/build-blender-roster.py
Then run tools/pack-blender-sprites.py with Pillow. No external assets or add-ons.
"""
import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/models'
FRAMES=OUT/'renders'
FRAMES.mkdir(parents=True,exist_ok=True)
roster=json.loads((OUT/'roster.json').read_text())
if '--' in sys.argv:
    keys=sys.argv[sys.argv.index('--')+1:]
    roster=[r for r in roster if r['key'] in keys]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    if c.name!='Collection': bpy.data.collections.remove(c)
scene=bpy.context.scene
scene.render.engine='BLENDER_WORKBENCH'
scene.render.resolution_x=128
scene.render.resolution_y=128
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
scene.display.shading.light='STUDIO'
scene.display.shading.studiolight_rotate_z=.45
scene.display.shading.color_type='MATERIAL'
scene.display.shading.show_shadows=True
scene.display.shading.show_cavity=True
scene.display.shading.cavity_type='BOTH'
scene.display.shading.curvature_ridge_factor=1.6
scene.display.shading.curvature_valley_factor=1.2
scene.display.shading.show_specular_highlight=True
scene.display.shading.show_object_outline=False
scene.display.render_aa='16'
scene.view_settings.view_transform='Standard'
scene.render.image_settings.compression=20

def material(name,hexcolor,metal=.3):
    m=bpy.data.materials.new(name)
    rgb=tuple(int(hexcolor.lstrip('#')[i:i+2],16)/255 for i in (0,2,4))
    m.diffuse_color=(*rgb,1)
    m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*rgb,1)
    bs.inputs['Metallic'].default_value=metal
    bs.inputs['Roughness'].default_value=.38
    return m

dark=material('Graphite | ballistic fabric','#202c32',.05)
rubber=material('Rubber | boots and seals','#10181e',.02)
steel=material('Titanium | worn edges','#8b9b9e',.75)
black=material('Ceramic | weapon receiver','#303a40',.6)
glass=material('Optics | smoked blue glass','#254c60',.75)
bone=material('Pale ceramic','#c6c9c2',.4)
root=None
legs=[]

def finish(obj,name,mat,parent=None):
    obj.name=name
    obj.data.materials.append(mat)
    obj.parent=parent or root
    return obj

def box(name,loc,size,mat,bevel=.05,parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object
    o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    finish(o,name,mat,parent)
    if bevel:
        mod=o.modifiers.new('Machined bevel','BEVEL');mod.width=bevel;mod.segments=2
        mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return o

def sphere(name,loc,size,mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1,location=loc)
    o=bpy.context.object;o.scale=size
    for poly in o.data.polygons:poly.use_smooth=True
    return finish(o,name,mat)

def rod(name,a,b,r,mat,vertices=10):
    delta=Vector(b)-Vector(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=delta.length,location=(Vector(a)+Vector(b))/2)
    o=bpy.context.object;o.rotation_euler=delta.to_track_quat('Z','Y').to_euler()
    return finish(o,name,mat)

def human(r,plate,accent):
    kind=r['kind'];ident=r['id']
    heavy=kind in ('heavy','augment','arbiter') or ident in ('bastion','ferrous')
    w=1.28 if heavy else 1
    # Separate thigh/shin/boot assemblies expose a real eight-pose stride.
    for side in (-1,1):
        group=bpy.data.objects.new(('L' if side<0 else 'R')+' leg | stride',None)
        scene.collection.objects.link(group);group.parent=root
        before=set(bpy.data.objects)
        rod('Thigh | ballistic sleeve',(-.08,side*.24*w,.94),(-.13,side*.27*w,.53),.16*w,dark)
        box('Knee | ceramic cap',(.01,side*.28*w,.52),(.27,.27,.27),plate)
        rod('Shin | articulated greave',(-.13,side*.27*w,.5),(-.17,side*.28*w,.18),.13*w,plate)
        box('Boot | toe guard',(.02,side*.28*w,.12),(.49,.29,.23),rubber)
        for o in set(bpy.data.objects)-before:o.parent=group
        legs.append((group,side))
    box('Pelvis | utility belt',(0,0,.98),(.47,.65*w,.24),black)
    box('Torso | under suit',(-.02,0,1.34),(.5,.76*w,.65),dark,.1)
    box('Chest | split armor',(.23,0,1.40),(.19,.66*w,.47),plate,.06)
    for side in (-1,1):
        box('Chest | raised panel',(.34,side*.175*w,1.44),(.055,.29*w,.29),plate,.025)
        box('Magazine pouch',(.32,side*.19,1.13),(.17,.17,.22),dark,.025)
        sphere('Shoulder | deltoid',(-.01,side*.46*w,1.55),(.23,.22,.25),plate)
        box('Shoulder | unit stripe',(.045,side*.61*w,1.59),(.22,.04,.12),accent,.015)
        rod('Arm | upper',(0,side*.49*w,1.43),(.19,side*.5*w,1.17),.115,dark)
        rod('Forearm | gauntlet',(.19,side*.5*w,1.17),(.49,side*.23,1.31),.12,plate)
        sphere('Glove',(.51,side*.23,1.31),(.13,.12,.12),rubber)
    box('Backpack | power unit',(-.40,0,1.35),(.32,.52,.51),plate,.06)
    for z in (1.22,1.32,1.42):box('Backpack | vent',(-.575,0,z),(.02,.36,.027),rubber,.005)
    sphere('Helmet | armored shell',(-.015,0,1.94),(.29,.30,.32),plate)
    box('Visor | luminous slit',(.247,0,1.96),(.08,.43,.10),accent,.025)
    box('Respirator',(.24,0,1.80),(.15,.28,.16),black,.035)
    for side in (-1,1):sphere('Helmet | comms receiver',(-.02,side*.29,1.92),(.12,.07,.15),black)
    rod('Comms | aerial',(-.38,-.21,1.55),(-.43,-.21,2.22),.018,steel)
    weapon=r.get('weapon','rifle')
    blade=weapon in ('monofilament','revenant') or kind in ('veil','augment','arbiter')
    sniper=weapon=='specter' or kind=='sniper'
    launcher=weapon=='shard' or kind in ('mortar','heavy')
    if blade:
        box('Monofilament | grip',(.64,-.28,1.28),(.3,.09,.09),black)
        o=box('Monofilament | blade',(1.04,-.28,1.29),(.64,.055,.12),steel,.008)
        box('Monofilament | energized edge',(1.05,-.31,1.33),(.64,.022,.025),accent,.003)
    elif launcher:
        rod('Launcher | launch tube',(.28,-.24,1.4),(1.18,-.24,1.4),.15,black)
        rod('Launcher | muzzle rim',(1.17,-.24,1.4),(1.25,-.24,1.4),.17,steel)
        box('Launcher | power indicator',(.66,-.38,1.43),(.26,.025,.07),accent,.008)
    else:
        box('Rifle | stock',(.28,-.2,1.35),(.38,.12,.17),black)
        box('Rifle | receiver',(.64,-.2,1.37),(.43,.16,.20),black,.025)
        box('Rifle | magazine',(.62,-.2,1.19),(.14,.11,.23),steel,.025)
        rod('Rifle | barrel',(.83,-.2,1.4),(1.55 if sniper else 1.19,-.2,1.4),.035,steel)
        box('Rifle | top rail',(.65,-.2,1.49),(.4,.12,.045),steel,.008)
        if sniper:rod('Rifle | telescopic sight',(.48,-.2,1.59),(.86,-.2,1.59),.065,glass)
    if kind=='shield' or ident=='bastion':
        box('Shield | armored slab',(.68,.54,1.13),(.15,.68,1.32),plate,.08)
        box('Shield | viewport',(.77,.54,1.55),(.02,.40,.13),glass,.01)
        box('Shield | identification band',(.77,.54,1.0),(.025,.46,.10),accent,.008)
    if ident in ('wraith','oracle','cipher','requiem') or kind in ('veil','sniper','arbiter'):
        # A draped, faceted mantle is authored mesh, not a runtime triangle.
        verts=[(-.31,-.4,1.72),(-.31,.4,1.72),(-.65,-.48,.43),(-.65,.48,.43),(-.78,0,.32)]
        mesh=bpy.data.meshes.new('Mantle folds');mesh.from_pydata(verts,[],[(0,1,4),(0,4,2),(1,3,4)])
        o=bpy.data.objects.new('Mantle | field cloak',mesh);scene.collection.objects.link(o);finish(o,o.name,dark)
        mod=o.modifiers.new('Fabric thickness','SOLIDIFY');mod.thickness=.035
    if kind=='sapper' or ident=='ferrous':
        for y in (-.19,.19):rod('Charge canister',(-.57,y,1.0),(-.57,y,1.67),.115,accent)
    if r.get('elite'):
        for y in (-.42,.42):box('Elite | dorsal fin',(-.28,y,1.85),(.17,.08,.55),accent,.01)
    if ident=='vesper':
        for y in (-.13,.13):rod('Recon | night optic',(.26,y,2.07),(.42,y,2.07),.065,accent)
    if ident=='mirage':
        box('Command | signal pack',(-.51,0,1.54),(.2,.68,.44),plate)
        for y in (-.32,.32):rod('Command | relay aerial',(-.51,y,1.7),(-.51,y,2.30),.025,accent)
    if ident=='cipher':
        sphere('Electronic warfare | shoulder node',(-.08,.55,1.86),(.18,.16,.19),accent)
    if ident=='requiem' or kind=='arbiter':
        box('Assault | faceplate',(.25,0,1.90),(.13,.36,.3),bone,.05)
        box('Assault | optic slit',(.33,0,1.98),(.02,.30,.05),accent,.005)

def machine(r,plate,accent):
    k=r['kind']
    if k=='apc':
        box('Carrier | beveled hull',(0,0,.64),(2.7,1.5,.83),plate,.2)
        for s in (-1,1):
            for x in (-.9,0,.9):rod('Carrier | road wheel',(x,s*.69,.35),(x,s*.96,.35),.36,rubber,16)
            for x in (-.75,0,.75):box('Carrier | side armor',(x,s*.80,.78),(.65,.10,.42),plate)
        box('Carrier | glacis viewport',(1.34,0,.89),(.045,.92,.18),glass,.01)
        box('Carrier | rear ramp',(-1.37,0,.60),(.1,1.1,.65),black)
        sphere('Carrier | turret',(.16,0,1.18),(.47,.44,.24),plate)
        rod('Carrier | autocannon',(.27,0,1.22),(1.48,0,1.22),.07,steel)
        for y in (-.54,.54):box('Carrier | headlamp',(1.37,y,.67),(.05,.15,.11),accent)
    elif k=='chopper':
        sphere('Gunship | fuselage',(.25,0,.95),(1.08,.44,.44),plate)
        sphere('Gunship | canopy',(.92,0,1.07),(.45,.35,.26),glass)
        rod('Gunship | tail boom',(-.5,0,.92),(-1.95,0,1.16),.13,plate)
        box('Gunship | tailplane',(-1.8,0,1.15),(.34,1.0,.07),plate)
        box('Gunship | vertical stabilizer',(-1.94,0,1.38),(.35,.07,.57),plate)
        for s in (-1,1):
            box('Gunship | stub wing',(-.05,s*.58,.82),(.51,.75,.09),plate)
            rod('Gunship | rocket pod',(-.25,s*.85,.70),(.52,s*.85,.70),.16,black)
            rod('Gunship | landing skid',(-.7,s*.46,.32),(.9,s*.46,.32),.045,steel)
        rod('Gunship | rotor mast',(0,0,1.2),(0,0,1.66),.065,steel)
        for a in (0,math.pi/2):
            o=box('Gunship | main rotor',(0,0,1.67),(3.85,.105,.035),black,.008);o.rotation_euler.z=a
    elif k in ('drone','crawler','jammer','warden','carrion'):
        sphere('Autonomous | core',(0,0,.87),(.48,.42,.25),plate)
        box('Autonomous | sensor head',(.40,0,.93),(.17,.30,.14),black)
        box('Autonomous | optics',(.49,0,.95),(.04,.21,.07),accent,.01)
        crawler=k=='crawler'
        count=6 if k=='carrion' else 4
        for i in range(count):
            a=(i+.5)*math.tau/count;x=math.cos(a);y=math.sin(a)
            rod('Outrigger | strut',(x*.22,y*.22,.8),(x*.92,y*.92,.65),.065,steel)
            if crawler:
                rod('Crawler | lower leg',(x*.92,y*.92,.65),(x*1.2,y*1.2,.12),.075,plate)
                box('Crawler | foot',(x*1.2,y*1.2,.10),(.35,.19,.14),rubber)
            else:
                rod('Rotor | shroud',(x*.85,y*.85,.67),(x*.85,y*.85,.83),.30,plate,16)
                rod('Rotor | turbine',(x*.85,y*.85,.82),(x*.85,y*.85,.85),.23,rubber,16)
                box('Rotor | blade',(x*.85,y*.85,.87),(.43,.055,.018),steel,.003)
                sphere('Rotor | hub',(x*.85,y*.85,.89),(.07,.07,.035),accent)
        if k in ('jammer','warden','carrion'):
            rod('Relay | mast',(0,0,1),(0,0,1.75),.055,steel)
            sphere('Relay | shield emitter',(0,0,1.6),(.28,.28,.18),accent)
            for y in (-.19,.19):rod('Relay | antenna',(-.17,y,.95),(-.17,y,1.96),.025,accent)
    else:
        # Distinct boss silhouettes: tracked siege chassis, shield walker, scarred biped.
        walker=k in ('aegis','nemesis')
        box('Platform | command hull',(0,0,1.14),(1.3,1.28,.69),plate,.17)
        for s in (-1,1):
            if walker:
                rod('Walker | hip',(0,s*.43,1.05),(-.30,s*.95,.63),.17,steel)
                rod('Walker | piston',(-.3,s*.95,.63),(.15,s*1.08,.25),.12,plate)
                box('Walker | armored foot',(.24,s*1.08,.14),(.98,.51,.28),plate,.09)
            else:
                box('Siege | track unit',(0,s*.92,.39),(2.1,.57,.64),rubber,.17)
                for x in (-.80,-.4,0,.4,.8):box('Siege | track cleat',(x,s*.92,.72),(.16,.60,.07),steel,.008)
            box('Platform | shoulder pod',(-.22,s*.87,1.45),(.64,.54,.53),plate)
            for z in (1.35,1.56):
                for y in (s*.76,s*.98):rod('Platform | missile tube',(.10,y,z),(.22,y,z),.065,rubber)
        sphere('Platform | armored sensor',(.14,0,1.69),(.41,.43,.24),plate)
        box('Platform | red eye',(.49,0,1.72),(.06,.44,.12),accent,.015)
        for i in range(6):
            a=i*math.tau/6
            rod('Rotary array | barrel',(.5,math.cos(a)*.15,1.10+math.sin(a)*.15),(1.65,math.cos(a)*.15,1.10+math.sin(a)*.15),.042,steel)
        if k=='aegis':box('Aegis | shield panel',(.75,.92,1.12),(.17,.85,1.66),accent,.10)
        if k=='nemesis':
            for z in (1.10,1.25,1.4):box('Nemesis | campaign scars',(.66,-.26,z),(.025,.27,.035),rubber,.001)

bpy.ops.object.camera_add(location=(0,-6,9))
camera=bpy.context.object;camera.name='Sprite camera | orthographic 56 degrees'
target=Vector((0,0,.85));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=3.7;scene.camera=camera
roots=[]
for index,r in enumerate(roster):
    root=bpy.data.objects.new(r['key'],None);scene.collection.objects.link(root);roots.append(root)
    root['asset_id']=r['key'];root['original_art']='Authored for Red Static in Blender'
    legs=[]
    accent=material(r['key']+' | identification',r['color'])
    palette={'vesper':'#315a61','bastion':'#85724f','mirage':'#415d80','wraith':'#504662',
             'oracle':'#68725b','ferrous':'#825348','cipher':'#3d6959','requiem':'#a2aba8'}
    plate=material(r['key']+' | armor',palette.get(r['id'],'#66685b' if r['kind'] in ('soldier','shield','heavy','mortar') else '#4d5963'))
    if r['kind']=='operative' or r['kind'] in ('soldier','shield','sniper','heavy','veil','augment','mortar','sapper','arbiter'):
        human(r,plate,accent)
    else:machine(r,plate,accent)
    members=[root,*root.children_recursive]
    camera.data.ortho_scale=5.1 if r['kind']=='chopper' else 4.2 if r['kind'] in ('apc','manticore','aegis','nemesis','carrion') else 3.7
    # Blender +X is game right; clockwise screen headings rotate about -Z.
    for pose in range(8):
        # Evaluate each pose at its own frame; render otherwise reapplies frame 1.
        scene.frame_set(pose+1)
        for leg,side in legs:
            leg.location.x=math.sin(pose*math.pi/4)*side*.34
            leg.location.z=max(0,math.sin(pose*math.pi/4)*side)*.13
            leg.rotation_euler.y=math.cos(pose*math.pi/4)*side*.12
            leg.keyframe_insert('location',frame=pose+1)
            leg.keyframe_insert('rotation_euler',frame=pose+1)
        for obj in members:
            if obj.name.startswith(('Rotor | blade','Gunship | main rotor')):
                obj.rotation_euler.z=pose*math.pi/4+(math.pi/2 if obj.name.endswith('.001') else 0)
        for direction in range(8):
            root.rotation_euler.z=-direction*math.tau/8
            scene.render.filepath=str(FRAMES/f'{r["key"]}-{pose}-{direction}.png')
            bpy.ops.render.render(write_still=True)
    root.rotation_euler.z=0
    for leg,side in legs:leg.location=(0,0,0)
    for obj in members:obj.hide_render=True
    print('ROSTER_COMPLETE '+r['key'],flush=True)
# Render the command screen's three-person team using the same source models.
if len(roots)>3:
    for r in roots:
        if r.name not in ('op-vesper','op-bastion','op-wraith'):continue
        r.location={'op-vesper':(.65,0,0),'op-bastion':(-.65,1.25,0),'op-wraith':(-.75,-1.35,0)}[r.name]
        for o in [r,*r.children_recursive]:o.hide_render=False
    camera.location=(7,-9,6.5)
    camera.rotation_euler=(Vector((0,0,1))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.ortho_scale=5.5
    scene.render.resolution_x=1000;scene.render.resolution_y=1000
    scene.display.render_aa='32'
    scene.render.filepath=str(ROOT/'assets/images/combat-team.png')
    bpy.ops.render.render(write_still=True)
# Editable gallery: every model kept as separate named hierarchy with materials.
for i,r in enumerate(roots):
    r.location=((i%6)*5,(i//6)*5,0)
    for o in [r,*r.children_recursive]:o.hide_render=False
scene.frame_start=1;scene.frame_end=8
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'red-static-combatants.blend'),compress=True)
print('BLENDER_ROSTER_COMPLETE',flush=True)
