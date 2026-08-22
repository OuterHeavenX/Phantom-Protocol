// Per-theatre scene dressing for the deferred renderer.
//
// The deferred path draws the world as instanced quads: one per surface, each
// carrying a material index, a tint, a height and an animation phase. This
// module is what decides which quads exist. It is the whole difference between
// "the GL renderer works in BLACKSITE ZERO" and "the GL renderer works", so it
// is written as ten explicit theatre profiles rather than one generic room
// generator with the numbers turned up and down.
//
// Two hard rules:
//
//   1. Every wall and every piece of cover the simulation placed gets a prop.
//      Nothing solid is invisible and nothing visible is decoration floating
//      over unrelated collision. Cover the 2D renderer draws as an authored
//      landmark (a tree trunk, a wrecked airframe, a boulder) is the one
//      exception — see LANDMARK_COVER below.
//
//   2. Dressing reads the world and the map, and nothing else. Given the same
//      contract seed it produces the same room on every machine, which is what
//      makes two performance numbers comparable and what keeps a daily
//      contract fair.

import {MAPS_BY_ID} from '../../../data/maps.js';

export const MATERIAL={
  // Built interior set.
  floorPlate:0,      // large worn steel panels with seams
  floorGrate:1,      // walkable grating over a dark void
  hazardStripe:2,    // diagonal warning paint, scuffed
  wall:3,            // heavy panelled wall with rivets
  pipe:4,            // cylindrical run, shaded across its width
  vent:5,            // louvred exhaust
  machine:6,         // bulk plant with panel lines
  screen:7,          // animated monitor
  panel:8,           // illuminated control surface
  crate:9,           // stacked containers
  cable:10,          // drooping conduit
  sign:11,           // stencilled signage
  containment:12,    // glass-fronted cylinder
  lightHousing:13,   // wall-mounted fixture
  puddle:14,         // reflective floor wetness, round
  // Outdoor set.
  ground:15,         // soil, mud, gravel, snowpack
  water:16,          // sheet water, rectangular
  foliage:17,        // canopy and scrub, soft-edged
  deck:18,           // asphalt and poured concrete
  rock:19,           // boulders and ridge stone
  snow:20,           // wind-packed drift with sparkle
  molten:21          // flowing slag
};

export const LIGHT={
  steady:0,
  flicker:1,
  rotate:2,   // sweeping emergency beacon
  pulse:3,
  strobe:4
};

// Cover whose visible form the 2D renderer draws as an authored landmark. The
// GL path leaves these to it rather than putting a box where a wrecked
// airframe is: a generic quad in place of authored art is a downgrade, and the
// landmark layer already draws over the lit scene.
const LANDMARK_COVER=new Set(['fuselage','trunk','boulder','wreck']);

// A tiny deterministic generator, so a theatre dresses identically everywhere.
function rng(seed){
  let s=(seed>>>0)||1;
  return()=>{
    s^=s<<13;s>>>=0;s^=s>>17;s^=s<<5;s>>>=0;
    return s/4294967296;
  };
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
//
// Every theatre already carries a hand-picked 2D palette. Reusing it is what
// makes the GL path recognisably the same theatre rather than a second art
// direction competing with the first.
//
// The palette colours are authored for Canvas 2D, where they are the final
// pixel. Here they are albedo: a surface reflectance the lighting pass then
// multiplies. Feeding #0c1f26 straight in renders a fully lit room almost
// black, so a colour is taken for its hue and rebalanced to a target
// reflectance. Hue is the identity; brightness belongs to the lighting.

const hexCache=new Map();
export function hexToRgb(hex){
  let v=hexCache.get(hex);
  if(v)return v;
  const s=String(hex||'#ffffff').replace('#','').trim();
  const full=s.length===3?s.split('').map(c=>c+c).join(''):s.slice(0,6);
  const n=parseInt(full,16);
  v=Number.isFinite(n)
    ?[((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255]
    :[1,1,1];
  hexCache.set(hex,v);
  return v;
}

const LUMA=[.2126,.7152,.0722];
const luminance=rgb=>rgb[0]*LUMA[0]+rgb[1]*LUMA[1]+rgb[2]*LUMA[2];

// Hue of `hex`, brightness set to `target`. Clamped so a saturated source
// cannot blow one channel past white while the others are still climbing.
export function albedo(hex,target=.30){
  const rgb=hexToRgb(hex);
  const l=luminance(rgb);
  if(l<.004)return[target,target,target];
  const k=Math.min(target/l,1/Math.max(...rgb,.001));
  return[rgb[0]*k,rgb[1]*k,rgb[2]*k];
}

// Normalised to unit brightness, for light colours where intensity is carried
// separately. A dim palette entry must not also mean a dim lamp.
export function emit(hex){
  const rgb=hexToRgb(hex);
  const peak=Math.max(...rgb,.001);
  return[rgb[0]/peak,rgb[1]/peak,rgb[2]/peak];
}

// ---------------------------------------------------------------------------
// Theatre profiles
// ---------------------------------------------------------------------------
//
// `ground` names the material the open floor is made of and the scale its
// plates are laid at. `passes` lists the dressing passes that run, in order,
// with their per-theatre parameters. `sky` is the flat ambient term: outdoors
// it does the work an overhead grid does indoors, which is why exterior
// theatres can have almost no fixtures and still be legible.

const PROFILES={
  blacksite:{
    ground:{material:'floorPlate',plate:151,lum:.30,wear:.10},
    wall:{lum:.34,height:{perimeter:58,other:42}},
    sky:{lum:.42,tintFrom:'light'},
    passes:{
      grating:{count:7},
      hazardPaint:{count:9},
      puddles:{count:6},
      plant:{count:6},
      containment:{count:5},
      pipes:{count:9},
      cables:{count:12},
      stations:{count:22},
      signage:{count:10},
      crates:{count:34},
      overheads:{spacing:340,intensity:.95,radius:360,z:150,lum:.78},
      beacons:{count:9,color:'#ff2a20'},
      brokenLights:{count:7}
    },
    atmosphere:'industrial'
  },

  arctic:{
    // Ice field. Almost nothing is built, so the read has to come from the
    // ground material and from very few, very cold sources.
    ground:{material:'snow',plate:245,lum:.52,wear:.08},
    wall:{lum:.30,height:{perimeter:54,other:38}},
    sky:{lum:.30,tintFrom:'accent'},
    passes:{
      iceSheets:{count:14},
      rocks:{count:22},
      drifts:{count:26},
      pipes:{count:3},
      cables:{count:6},
      stations:{count:5},
      signage:{count:4},
      crates:{count:12},
      masts:{count:9,intensity:1.15,z:210,radius:540,lum:.86},
      beacons:{count:4,color:'#8fd8ff'},
      brokenLights:{count:3}
    },
    atmosphere:'snow'
  },

  sunken:{
    // Flooded streets. Water is the whole identity, and water is the one
    // surface in the set that pays the deferred path back immediately.
    ground:{material:'deck',plate:187,lum:.24,wear:.12},
    wall:{lum:.28,height:{perimeter:56,other:44}},
    sky:{lum:.15,tintFrom:'light'},
    passes:{
      floodwater:{count:22},
      puddles:{count:18},
      foliage:{count:14,lum:.20},
      hazardPaint:{count:6},
      pipes:{count:7},
      cables:{count:16},
      stations:{count:9},
      signage:{count:12},
      crates:{count:20},
      streetLamps:{count:16,intensity:.9,z:170,radius:380,lum:.72},
      beacons:{count:5,color:'#6fe0c8'},
      brokenLights:{count:9}
    },
    atmosphere:'mist'
  },

  foundry:{
    // Working plant. The only theatre lit mostly by what it is making.
    ground:{material:'floorPlate',plate:137,lum:.24,wear:.14},
    wall:{lum:.30,height:{perimeter:62,other:46}},
    sky:{lum:.13,tintFrom:'light'},
    passes:{
      grating:{count:9},
      moltenChannels:{count:9},
      hazardPaint:{count:12},
      plant:{count:11},
      pipes:{count:18},
      cables:{count:14},
      stations:{count:16},
      signage:{count:12},
      crates:{count:30},
      overheads:{spacing:440,intensity:.8,radius:400,z:170,lum:.62,tintFrom:'hazard'},
      beacons:{count:8,color:'#ff5b30'},
      brokenLights:{count:8}
    },
    atmosphere:'foundry'
  },

  orbital:{
    // Modular decking. Clean, cold and almost entirely artificial: the one
    // theatre where the panel lines are the texture.
    ground:{material:'deck',plate:173,lum:.22,wear:.05},
    wall:{lum:.30,height:{perimeter:56,other:44}},
    sky:{lum:.16,tintFrom:'accent'},
    passes:{
      panelRuns:{count:26},
      containment:{count:6},
      pipes:{count:12},
      cables:{count:10},
      stations:{count:28},
      signage:{count:14},
      crates:{count:18},
      overheads:{spacing:330,intensity:.9,radius:360,z:160,lum:.80,tintFrom:'accent'},
      beacons:{count:7,color:'#c895ff'},
      brokenLights:{count:5}
    },
    atmosphere:'vacuum'
  },

  crossfall:{
    // A kilometre of roadway over open water, in the rain. Everything off the
    // deck is water; everything on it is wet.
    ground:{material:'deck',plate:216,lum:.22,wear:.10},
    wall:{lum:.27,height:{perimeter:60,other:52}},
    sky:{lum:.19,tintFrom:'light'},
    passes:{
      openWater:{},
      laneMarkings:{step:260},
      puddles:{count:26},
      suspension:{count:22},
      pipes:{count:5},
      stations:{count:6},
      signage:{count:10},
      crates:{count:10},
      streetLamps:{count:22,intensity:1,z:200,radius:400,lum:.74,tintFrom:'hazard'},
      beacons:{count:6,color:'#ffcf6a'},
      brokenLights:{count:6}
    },
    atmosphere:'rain'
  },

  hollow:{
    // Snowed-in valley floor. No fixtures at all beyond a handful of dropped
    // flares: the sky term and the snow material carry the entire theatre.
    ground:{material:'snow',plate:259,lum:.50,wear:.10},
    wall:{lum:.32,height:{perimeter:64,other:46}},
    sky:{lum:.28,tintFrom:'accent'},
    passes:{
      drifts:{count:38},
      rocks:{count:26},
      foliage:{count:30,lum:.16},
      iceSheets:{count:8},
      cables:{count:4},
      crates:{count:8},
      signage:{count:3},
      flares:{count:11,intensity:1.4,z:26,radius:360,color:'#ff8a4c'},
      beacons:{count:3,color:'#bfe3f5'},
      brokenLights:{count:2}
    },
    atmosphere:'snow'
  },

  mire:{
    // Standing water under a dead canopy. Lit almost entirely by things that
    // are alive, which is the only theatre where that is true.
    ground:{material:'ground',plate:202,lum:.20,wear:.16},
    wall:{lum:.26,height:{perimeter:56,other:40}},
    sky:{lum:.12,tintFrom:'light'},
    passes:{
      floodwater:{count:30},
      foliage:{count:52,lum:.18},
      rocks:{count:12},
      puddles:{count:14},
      cables:{count:20},
      crates:{count:10},
      signage:{count:5},
      bioluminescence:{count:34,intensity:.8,z:18,radius:220,color:'#9ad86f'},
      beacons:{count:3,color:'#d8e05a'},
      brokenLights:{count:4}
    },
    atmosphere:'spores'
  },

  hangar:{
    // Open apron under a roof. Sodium high-bays a long way up, and almost
    // nothing between them and the floor.
    ground:{material:'deck',plate:230,lum:.26,wear:.09},
    wall:{lum:.30,height:{perimeter:80,other:54}},
    sky:{lum:.15,tintFrom:'light'},
    passes:{
      apronMarkings:{step:300},
      hazardPaint:{count:5},
      plant:{count:5},
      pipes:{count:8},
      cables:{count:10},
      stations:{count:12},
      signage:{count:14},
      crates:{count:38},
      overheads:{spacing:540,intensity:1.15,z:280,radius:640,lum:.84,tintFrom:'accent'},
      beacons:{count:5,color:'#ff8a4c'},
      brokenLights:{count:7}
    },
    atmosphere:'dust'
  },

  proving:{
    // A sealed circular floor with nothing on it. The level is bare by design,
    // so the dressing is a lighting rig and a wall of screens and no more.
    ground:{material:'floorPlate',plate:130,lum:.28,wear:.04},
    wall:{lum:.32,height:{perimeter:70,other:48}},
    sky:{lum:.14,tintFrom:'accent'},
    passes:{
      panelRuns:{count:18},
      stations:{count:16},
      signage:{count:8},
      overheads:{spacing:330,intensity:1.05,radius:380,z:200,lum:.85,tintFrom:'accent'},
      beacons:{count:10,color:'#ff5b5b'},
      brokenLights:{count:3}
    },
    atmosphere:'ember'
  }
};

// Theatres are data, so a new one can appear without a profile. Falling back
// on the layout type keeps such a theatre lit and legible rather than blank.
const LAYOUT_FALLBACK={
  complex:'blacksite',industrial:'foundry',modular:'orbital',
  open:'arctic',streets:'sunken',bridge:'crossfall',
  valley:'hollow',swamp:'mire',hangar:'hangar',arena:'proving'
};

export function profileFor(map){
  if(!map)return PROFILES.blacksite;
  return PROFILES[map.id]
    ||PROFILES[LAYOUT_FALLBACK[map.layout?.type]]
    ||PROFILES.blacksite;
}

// Cover types the simulation generates, mapped onto the materials that suit
// them. A theatre can override any of these; anything unlisted is a crate,
// which is the safe read.
const COVER_MATERIAL={
  crate:'crate',container:'crate',
  barrier:'hazardStripe',lowcover:'hazardStripe',
  pillar:'machine',machinery:'machine',
  vaultSeal:'containment',vaultTerminal:'screen',
  log:'foliage'
};

const COVER_OVERRIDE={
  arctic:{crate:'crate',barrier:'snow',lowcover:'snow',pillar:'rock'},
  hollow:{crate:'crate',barrier:'snow',lowcover:'snow',pillar:'rock',log:'foliage'},
  mire:{barrier:'foliage',lowcover:'foliage',pillar:'rock',log:'foliage'},
  sunken:{pillar:'machine'},
  crossfall:{barrier:'hazardStripe',lowcover:'hazardStripe',pillar:'machine'},
  hangar:{pillar:'machine'}
};

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function buildDressing(world,map,seed=1){
  const resolved=map||MAPS_BY_ID.blacksite;
  const profile=profileFor(resolved);
  const palette=resolved.palette||MAPS_BY_ID.blacksite.palette;
  const random=rng(seed*2654435761+0x9e3779b9);
  const range=(a,b)=>a+random()*(b-a);
  const pick=list=>list[Math.floor(random()*list.length)];

  const W=world?world.width:2600;
  const H=world?world.height:1800;
  const props=[];
  const lights=[];
  const emitters=[];

  const prop=(x,y,hw,hh,material,opts={})=>{
    const rgb=opts.rgb||[.22,.24,.26];
    props.push({
      x,y,hw,hh,
      rotation:opts.rotation||0,
      material:MATERIAL[material]??material,
      r:rgb[0],g:rgb[1],b:rgb[2],
      emissive:opts.emissive||0,
      height:opts.height??0,
      roughness:opts.roughness??.7,
      phase:opts.phase??random()*100,
      animation:opts.animation??0
    });
  };
  const light=(x,y,radius,rgb,opts={})=>{
    lights.push({
      x,y,radius,
      r:rgb[0],g:rgb[1],b:rgb[2],
      intensity:opts.intensity??1,
      kind:opts.kind??LIGHT.steady,
      phase:opts.phase??random()*6,
      speed:opts.speed??1,
      z:opts.z??60
    });
  };

  // Somewhere the operative could stand. Dressing that grows out of a wall is
  // the one artefact that makes a generated room read as generated.
  const clear=(x,y,pad)=>{
    if(!world)return true;
    if(!world.playable(x,y,pad))return false;
    return !world.overlapsSolid(x,y,pad);
  };
  // Somewhere with `pad` clear around it, relaxing toward `floor` as the
  // attempts run out. A tight interior grid has almost no spot with 140 units
  // of clearance, and a pass that simply gave up there left BLACKSITE ZERO
  // with two of its six machine halls and none of its steam.
  const findSpot=(pad,tries=48,floor=18)=>{
    for(let i=0;i<tries;i++){
      const t=i/tries;
      const want=pad-(pad-Math.min(pad,floor))*t*t;
      const x=range(want,W-want),y=range(want,H-want);
      if(clear(x,y,want))return[x,y];
    }
    return null;
  };
  // Anywhere at all, wall or not — for things that legitimately sit on top of
  // geometry, such as a lamp on a parapet or a cable spanning a gap.
  const anySpot=()=>[range(W*.04,W*.96),range(H*.04,H*.96)];

  const P=profile.passes;
  const accentLight=emit(palette.accent||'#ffffff');
  const warmLight=emit(palette.hazard||'#ffb35c');
  const coolLight=emit(palette.light?.match(/#[0-9a-f]{3,6}/i)?.[0]||palette.accent||'#ffffff');
  const tintFor=key=>key==='accent'?accentLight
    :key==='hazard'?warmLight
    :key==='light'?coolLight
    :[1,1,1];

  // ---- Ground ------------------------------------------------------------
  // Overlapping per-plate variation rather than one tiled texture, which is
  // what keeps a big floor from reading as wallpaper.
  //
  // These are deliberately the first props in the array. A theatre that ships
  // painted floor art blits that instead, and skipping a contiguous run from
  // index zero is the cheapest way to leave them out.
  {
    const g=profile.ground;
    const plate=g.plate;
    const base=albedo(palette.floor,g.lum);
    const alt=albedo(palette.floorAlt||palette.floor,g.lum*1.08);
    // One plate past the arena on every side. Without it the ground stops dead
    // at the perimeter wall and everything beyond is the cleared buffer, which
    // at the edge of a sector is a hard black rectangle and reads as a bug.
    for(let x=-plate;x<W+plate;x+=plate){
      for(let y=-plate;y<H+plate;y+=plate){
        const wear=random();
        const mix=random()<.35?alt:base;
        prop(x+plate/2,y+plate/2,plate/2,plate/2,g.material,{
          rgb:[mix[0]+wear*g.wear,mix[1]+wear*g.wear,mix[2]+wear*g.wear*1.1],
          roughness:.55+wear*.4
        });
      }
    }
  }

  const floorCount=props.length;

  // ---- Real geometry -----------------------------------------------------
  if(world){
    const wallRgb=albedo(palette.wall,profile.wall.lum);
    const edgeRgb=albedo(palette.wallEdge||palette.wall,profile.wall.lum*1.4);
    for(const wall of world.walls){
      const perimeter=wall.type==='perimeter';
      const rgb=perimeter?edgeRgb:wallRgb;
      prop(wall.x,wall.y,wall.hw,wall.hh,'wall',{
        rgb,
        height:perimeter?profile.wall.height.perimeter:profile.wall.height.other,
        roughness:.5
      });
    }

    const overrides=COVER_OVERRIDE[resolved.id]||{};
    for(const cover of world.cover){
      if(LANDMARK_COVER.has(cover.type))continue;
      const name=overrides[cover.type]||COVER_MATERIAL[cover.type]||'crate';
      const lit=name==='containment'||name==='screen';
      const organic=name==='foliage'||name==='rock'||name==='snow';
      const source=lit?palette.accent
        :organic?(name==='snow'?palette.wallEdge:palette.floorAlt)
        :palette.wallEdge;
      const rgb=lit?albedo(palette.accent,.42):albedo(source,organic?.26:range(.28,.40));
      prop(cover.x,cover.y,cover.hw,cover.hh,name,{
        rgb,
        emissive:lit?1.6:0,
        height:name==='hazardStripe'?10:organic?range(26,44):range(20,34),
        roughness:organic?.9:.7,
        animation:lit?1:0
      });
      if(lit)light(cover.x,cover.y,200,accentLight,{intensity:.7,kind:LIGHT.pulse,z:30});
    }
  }else{
    const t=54;
    const rgb=albedo(palette.wall,profile.wall.lum);
    for(const [x,y,hw,hh] of [
      [W/2,t/2,W/2,t/2],[W/2,H-t/2,W/2,t/2],
      [t/2,H/2,t/2,H/2],[W-t/2,H/2,t/2,H/2]
    ])prop(x,y,hw,hh,'wall',{rgb,height:46,roughness:.5});
  }

  // ---- Dressing passes ---------------------------------------------------

  if(P.grating){
    // Service voids, scattered. An earlier version ran one continuous walkway
    // down the middle of the sector, which looked deliberate in a single open
    // hall and absurd in a corridor grid where it crossed forty walls.
    const rgb=albedo(palette.floor,.14);
    for(let i=0;i<P.grating.count;i++){
      const spot=findSpot(90,24);
      if(!spot)continue;
      prop(spot[0],spot[1],range(70,150),range(60,120),'floorGrate',{rgb,roughness:.8});
    }
  }

  if(P.hazardPaint){
    // Short runs of warning paint, in pairs, wherever there is floor for them.
    // Paint marks a specific hazard; a band across the whole sector marks
    // nothing.
    const rgb=albedo(palette.hazard,.50);
    for(let i=0;i<P.hazardPaint.count;i++){
      const spot=findSpot(120,24);
      if(!spot)continue;
      const horizontal=random()<.65;
      const len=range(80,170);
      for(const side of [-1,1]){
        prop(spot[0]+(horizontal?0:side*54),spot[1]+(horizontal?side*54:0),
          horizontal?len:14,horizontal?14:len,'hazardStripe',
          {rgb,roughness:.85,emissive:.06});
      }
    }
  }

  if(P.laneMarkings){
    // A bridge deck reads as a road the moment it has a centre line.
    const rgb=albedo(palette.hazard,.55);
    for(let x=90;x<W-90;x+=P.laneMarkings.step){
      prop(x,H/2,70,7,'hazardStripe',{rgb,roughness:.8,emissive:.10});
    }
  }

  if(P.apronMarkings){
    // Aircraft guidance lines: long, straight, and going somewhere.
    const rgb=albedo(palette.accent,.48);
    for(let i=0;i<6;i++){
      const y=H*(.14+i*.145);
      prop(W/2,y,W*.42,6,'hazardStripe',{rgb,roughness:.85,emissive:.08});
    }
    for(let x=W*.18;x<W*.85;x+=P.apronMarkings.step){
      prop(x,H/2,7,H*.36,'hazardStripe',{rgb,roughness:.85,emissive:.08});
    }
  }

  if(P.puddles){
    const rgb=albedo(palette.light?.match(/#[0-9a-f]{3,6}/i)?.[0]||palette.accent,.22);
    for(let i=0;i<P.puddles.count;i++){
      const spot=findSpot(140,14);
      if(!spot)continue;
      prop(spot[0],spot[1],range(60,150),range(40,90),'puddle',
        {rgb,roughness:.06,animation:1});
    }
  }

  if(P.floodwater){
    // Standing water in sheets rather than discs: a flooded street is a
    // continuous surface with things sticking out of it.
    const rgb=albedo(palette.floorAlt||palette.floor,.20);
    for(let i=0;i<P.floodwater.count;i++){
      const spot=findSpot(170,14)||anySpot();
      prop(spot[0],spot[1],range(140,340),range(90,220),'water',
        {rgb,roughness:.05,animation:1,rotation:range(-.12,.12)});
    }
  }

  if(P.openWater){
    // The span crosses open water. Two enormous sheets outside the deck, which
    // is the only place in the game the horizon is part of the level.
    const rgb=albedo(palette.floor,.16);
    for(const y of [-H*.34,H*1.34]){
      prop(W/2,y,W*.8,H*.6,'water',{rgb,roughness:.04,animation:1});
    }
  }

  if(P.iceSheets){
    const rgb=albedo(palette.accent,.34);
    for(let i=0;i<P.iceSheets.count;i++){
      const spot=findSpot(150,14)||anySpot();
      prop(spot[0],spot[1],range(110,260),range(80,170),'water',
        {rgb,roughness:.03,animation:1,rotation:range(-.3,.3)});
    }
  }

  if(P.drifts){
    const rgb=albedo(palette.wallEdge||palette.accent,.56);
    for(let i=0;i<P.drifts.count;i++){
      const spot=findSpot(90,14)||anySpot();
      prop(spot[0],spot[1],range(70,200),range(40,120),'snow',
        {rgb,roughness:.6,height:range(8,22),rotation:range(-.4,.4)});
    }
  }

  if(P.rocks){
    const rgb=albedo(palette.wall,.28);
    for(let i=0;i<P.rocks.count;i++){
      const spot=findSpot(70,14);
      if(!spot)continue;
      const s=range(26,74);
      prop(spot[0],spot[1],s,s*range(.7,1.1),'rock',
        {rgb,roughness:.85,height:range(18,42),rotation:range(0,3.14)});
    }
  }

  if(P.foliage){
    const rgb=albedo(palette.accent,P.foliage.lum??.20);
    for(let i=0;i<P.foliage.count;i++){
      const spot=findSpot(60,14);
      if(!spot)continue;
      const s=range(46,130);
      prop(spot[0],spot[1],s,s*range(.75,1.15),'foliage',{
        rgb:[rgb[0]*range(.7,1.25),rgb[1]*range(.8,1.2),rgb[2]*range(.7,1.15)],
        roughness:.92,height:range(30,58),rotation:range(0,3.14)
      });
    }
  }

  if(P.moltenChannels){
    // The plant's own light source. Every channel is also a light and a
    // particle emitter, because a glowing surface that does not spill onto the
    // floor beside it is a texture, not a fire.
    const rgb=albedo(palette.hazard,.62);
    for(let i=0;i<P.moltenChannels.count;i++){
      const spot=findSpot(120,20);
      if(!spot)continue;
      const [x,y]=spot;
      const horizontal=random()<.6;
      const hw=horizontal?range(150,380):range(16,26);
      const hh=horizontal?range(16,26):range(150,380);
      prop(x,y,hw,hh,'molten',{rgb,emissive:range(1.3,2.1),roughness:.5,animation:1});
      light(x,y,Math.max(hw,hh)*1.8+180,warmLight,
        {intensity:1.5,kind:LIGHT.pulse,speed:.35,z:14});
      emitters.push({x,y,kind:'ember',rate:9,scale:1});
    }
  }

  if(P.plant){
    const bodyRgb=albedo(palette.wall,.34);
    const ventRgb=albedo(palette.wall,.22);
    for(let i=0;i<P.plant.count;i++){
      const spot=findSpot(140);
      if(!spot)continue;
      const [x,y]=spot;
      const hw=range(90,130),hh=range(70,100);
      prop(x,y,hw,hh,'machine',{rgb:bodyRgb,height:34,roughness:.42,animation:1});
      const dir=x<W/2?1:-1;
      for(let k=0;k<3;k++){
        const px=x+dir*(hw+10),py=y-hh*.5+k*hh*.5;
        prop(px,py,7,14,'panel',
          {rgb:albedo(palette.accent,.55),emissive:range(1.6,3),height:6,animation:1});
        light(px,py,120,accentLight,
          {intensity:.5,kind:LIGHT.pulse,speed:range(.6,1.6),z:20});
      }
      prop(x-dir*(hw+14),y,12,hh*.6,'vent',{rgb:ventRgb,height:14,roughness:.7});
      emitters.push({x:x-dir*(hw+14),y,kind:'steam',rate:14,scale:1});
      emitters.push({x,y:y-hh,kind:'smoke',rate:4,scale:1.4});
    }
  }

  if(P.containment){
    const rgb=albedo(palette.accent,.40);
    for(let i=0;i<P.containment.count;i++){
      const spot=findSpot(70);
      if(!spot)continue;
      const [x,y]=spot;
      prop(x,y,44,44,'containment',
        {rgb,emissive:range(.9,1.5),height:52,roughness:.15,animation:1});
      light(x,y,230,accentLight,{intensity:.85,kind:LIGHT.pulse,phase:i*1.3,speed:.5,z:44});
      emitters.push({x,y,kind:'glow',rate:8,scale:.7});
    }
  }

  if(P.panelRuns){
    // Illuminated deck seams. What a modular station has instead of grime.
    const rgb=albedo(palette.accent,.50);
    for(let i=0;i<P.panelRuns.count;i++){
      const spot=findSpot(90,14)||anySpot();
      const horizontal=random()<.5;
      prop(spot[0],spot[1],horizontal?range(90,220):5,horizontal?5:range(90,220),'panel',
        {rgb,emissive:range(.9,1.8),height:3,animation:1});
      light(spot[0],spot[1],170,accentLight,{intensity:.35,kind:LIGHT.pulse,speed:.4,z:12});
    }
  }

  if(P.suspension){
    // Cable stays running off the towers. Long, thin and at an angle, which is
    // the only geometry in the game that is none of those things otherwise.
    const rgb=albedo(palette.wallEdge||palette.wall,.18);
    for(let i=0;i<P.suspension.count;i++){
      const x=range(W*.04,W*.96);
      const up=random()<.5;
      prop(x,up?H*.30:H*.70,range(6,10),range(150,320),'cable',
        {rgb,height:6,roughness:.9,rotation:range(-.5,.5)});
    }
  }

  if(P.pipes){
    const rgb=albedo(palette.wallEdge||palette.wall,.30);
    for(let i=0;i<P.pipes.count;i++){
      const y=range(120,H-120);
      const x0=range(80,W*.45),x1=Math.min(W-80,x0+range(320,900));
      prop((x0+x1)/2,y,(x1-x0)/2,range(7,13),'pipe',{rgb,height:20,roughness:.35});
    }
  }

  if(P.cables){
    const rgb=albedo(palette.wall,.12);
    for(let i=0;i<P.cables.count;i++){
      const [x,y]=anySpot();
      prop(x,y,range(60,190),range(2,4),'cable',
        {rgb,height:5,roughness:.9,rotation:range(-.35,.35)});
    }
  }

  if(P.stations){
    const bodyRgb=albedo(palette.wall,.28);
    const screenRgb=albedo(palette.accent,.55);
    for(let i=0;i<P.stations.count;i++){
      const spot=findSpot(80);
      if(!spot)continue;
      const [x,y]=spot;
      prop(x,y,52,26,'machine',{rgb:bodyRgb,height:24,roughness:.5});
      prop(x,y-6,40,16,'screen',
        {rgb:screenRgb,emissive:range(1.8,3.2),height:26,animation:1});
      light(x,y,190,accentLight,{intensity:.6,kind:LIGHT.flicker,speed:range(2,5),z:30});
    }
  }

  if(P.signage){
    const rgb=albedo(palette.wallEdge||palette.accent,.45);
    for(let i=0;i<P.signage.count;i++){
      const [x,y]=anySpot();
      prop(x,y,range(28,54),12,'sign',{rgb,emissive:.35,height:3,roughness:.9});
    }
  }

  if(P.crates){
    const rgb=albedo(palette.hazard,.34);
    for(let i=0;i<P.crates.count;i++){
      const s=range(24,46);
      const spot=findSpot(s+14,12);
      if(!spot)continue;
      prop(spot[0],spot[1],s,s*range(.8,1.1),'crate',{
        rgb:[rgb[0]*range(.8,1.2),rgb[1]*range(.8,1.15),rgb[2]*range(.7,1.1)],
        height:range(18,34),roughness:.75,rotation:range(-.25,.25)
      });
    }
  }

  // ---- Fixtures ----------------------------------------------------------
  // Whatever the theatre is lit by. Indoors this is a ceiling grid; outdoors
  // it is a handful of masts or flares and the sky term does the rest.

  if(P.overheads){
    const o=P.overheads;
    const tint=tintFor(o.tintFrom||'light');
    const housing=[tint[0]*o.lum,tint[1]*o.lum,tint[2]*o.lum];
    const radius=o.radius??430;
    for(let x=o.spacing*.65;x<W;x+=o.spacing){
      for(let y=o.spacing*.65;y<H;y+=o.spacing){
        prop(x,y,26,8,'lightHousing',{rgb:housing,emissive:2.4,height:60});
        light(x,y,radius,tint,{intensity:o.intensity,z:o.z});
      }
    }
  }

  if(P.masts){
    // Free-standing floodlights. Placed on open ground, aimed at nothing in
    // particular, which is what a relay station's lighting actually looks like.
    const m=P.masts;
    const tint=tintFor(m.tintFrom||'accent');
    const housing=[tint[0]*m.lum,tint[1]*m.lum,tint[2]*m.lum];
    for(let i=0;i<m.count;i++){
      const spot=findSpot(120,20)||anySpot();
      prop(spot[0],spot[1],14,14,'lightHousing',{rgb:housing,emissive:3,height:80});
      light(spot[0],spot[1],m.radius??560,tint,{intensity:m.intensity,z:m.z});
    }
  }

  if(P.streetLamps){
    const s=P.streetLamps;
    const tint=tintFor(s.tintFrom||'accent');
    const housing=[tint[0]*s.lum,tint[1]*s.lum,tint[2]*s.lum];
    for(let i=0;i<s.count;i++){
      const [x,y]=anySpot();
      prop(x,y,10,20,'lightHousing',{rgb:housing,emissive:2.6,height:70});
      light(x,y,s.radius??420,tint,{intensity:s.intensity,z:s.z});
    }
  }

  if(P.flares){
    // Dropped, burning on the snow, guttering. The only warm thing in the
    // valley and the only reason anything in it has a shadow.
    const f=P.flares;
    const tint=emit(f.color||'#ff8a4c');
    for(let i=0;i<f.count;i++){
      const spot=findSpot(60,14)||anySpot();
      prop(spot[0],spot[1],9,9,'lightHousing',
        {rgb:[tint[0]*.9,tint[1]*.6,tint[2]*.4],emissive:3.6,height:8,animation:1});
      light(spot[0],spot[1],f.radius??360,tint,
        {intensity:f.intensity,kind:LIGHT.flicker,speed:range(3,7),z:f.z??26});
      emitters.push({x:spot[0],y:spot[1],kind:'ember',rate:6,scale:.8});
    }
  }

  if(P.bioluminescence){
    const b=P.bioluminescence;
    const tint=emit(b.color||'#9ad86f');
    for(let i=0;i<b.count;i++){
      const spot=findSpot(40,10)||anySpot();
      // Foliage rather than a panel: it is the one material with a soft, noisy,
      // round edge, and a glowing rectangle in a swamp reads as a light fitting.
      prop(spot[0],spot[1],range(14,34),range(14,34),'foliage',
        {rgb:[tint[0]*.4,tint[1]*.7,tint[2]*.35],emissive:range(1.1,2.1),
         height:range(6,16),roughness:.9,rotation:range(0,3.14),animation:1});
      light(spot[0],spot[1],b.radius??220,tint,
        {intensity:b.intensity,kind:LIGHT.pulse,speed:range(.3,.9),z:b.z??18});
      emitters.push({x:spot[0],y:spot[1],kind:'glow',rate:3,scale:.5});
    }
  }

  if(P.beacons){
    // Sweeping emergency lights. Every theatre gets some: they are the single
    // most effective thing in the pipeline for making a static room feel like
    // somewhere an alarm is going off.
    const b=P.beacons;
    const tint=emit(b.color||palette.hazard);
    const inset=Math.min(300,Math.min(W,H)*.16);
    const ring=[[inset,inset],[W-inset,inset],[inset,H-inset],[W-inset,H-inset],
      [W/2,H/2],[W/2,inset],[W/2,H-inset],[inset,H/2],[W-inset,H/2],
      [W*.3,H*.3],[W*.7,H*.7]];
    for(let i=0;i<Math.min(b.count,ring.length);i++){
      const [x,y]=ring[i];
      prop(x,y,14,14,'lightHousing',
        {rgb:[tint[0]*.9,tint[1]*.25,tint[2]*.22],emissive:3.4,height:70,phase:i*1.9,animation:1});
      light(x,y,430,tint,{intensity:1.25,kind:LIGHT.rotate,phase:i*1.9,speed:.85,z:80});
    }
  }

  if(P.brokenLights){
    // A room where nothing is broken reads as a diagram.
    const tint=tintFor('light');
    for(let i=0;i<P.brokenLights.count;i++){
      const x=range(W*.16,W*.84),y=range(H*.16,H*.84);
      prop(x,y,22,7,'lightHousing',
        {rgb:[tint[0]*.8,tint[1]*.85,tint[2]*.9],emissive:1.4,height:58,animation:1});
      light(x,y,420,tint,{intensity:1.1,kind:LIGHT.strobe,speed:range(6,13),z:140});
    }
  }

  // Ambient motes across the whole sector, from the theatre's own atmosphere.
  // The renderer spawns these near the camera; the kind is what the theatre is
  // made of.
  const ambientKind={
    industrial:'dust',snow:'snowblow',mist:'mist',foundry:'ember',
    vacuum:'dust',rain:'rain',spores:'spore',dust:'dust',ember:'ember'
  }[profile.atmosphere]||'dust';

  const sky=profile.sky;
  const skyTint=tintFor(sky.tintFrom||'light');

  return{
    props,lights,emitters,floorCount,
    width:W,height:H,seed,
    theatre:resolved.id,
    ambientKind,
    // The flat term the lighting pass starts from, already tinted by the
    // theatre. Outdoors this is most of the light in the scene.
    ambient:[skyTint[0]*sky.lum,skyTint[1]*sky.lum,skyTint[2]*sky.lum]
  };
}
