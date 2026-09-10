"""Pack Blender renders into browser-ready lossless atlases and a contact sheet."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
roster=json.loads((ROOT/'assets/models/roster.json').read_text())
out=ROOT/'assets/sprites/combatants'
out.mkdir(parents=True,exist_ok=True)
manifest={'version':1,'generator':'Blender 5.2 / tools/build-blender-roster.py','frameSize':128,'directions':8,'poses':8,'actors':{}}
sheet=Image.new('RGB',(1200,((len(roster)+5)//6)*220),(12,20,25))
draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',13)
for i,r in enumerate(roster):
    atlas=Image.new('RGBA',(1024,1024))
    for pose in range(8):
        for direction in range(8):
            file=ROOT/'assets/models/renders'/f'{r["key"]}-{pose}-{direction}.png'
            with Image.open(file) as frame:
                assert frame.size==(128,128),file
                assert frame.getchannel('A').getbbox(),f'Empty render: {file}'
                atlas.paste(frame,(direction*128,pose*128))
    if r['kind']=='operative':
        poses={atlas.crop((0,p*128,128,(p+1)*128)).tobytes() for p in range(8)}
        assert len(poses)>=6,f'Frozen walk cycle: {r["key"]}'
    atlas.save(out/f'{r["key"]}.webp',lossless=True,method=6)
    ortho=5.1 if r['kind']=='chopper' else 4.2 if r['kind'] in ('apc','manticore','aegis','nemesis','carrion') else 3.7
    manifest['actors'][r['key']]={'file':r['key']+'.webp','anchor':[.5,.5+.85*.593/ortho],'name':r['name'],'kind':r['kind']}
    x=(i%6)*200;y=(i//6)*220
    draw.line((x+12,y+210,x+188,y+210),fill=(42,59,64))
    preview=atlas.crop((128,0,256,128)).resize((184,184),Image.Resampling.LANCZOS)
    sheet.paste(preview,(x+8,y),preview)
    draw.text((x+12,y+180),r['name'][:23],fill=(199,217,220),font=font)
    draw.text((x+12,y+196),r['key'],fill=(94,135,139),font=font)
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
sheet.save(ROOT/'assets/models/combatants-contact-sheet.jpg',quality=92)
with Image.open(ROOT/'assets/images/combat-team.png') as hero:
    hero.crop(hero.getchannel('A').getbbox()).save(ROOT/'assets/images/combat-team.webp',lossless=True,method=6)
print(f'Packed {len(roster)} actors / {len(roster)*64} frames')
