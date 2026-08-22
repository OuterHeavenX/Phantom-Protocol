// BLACKSITE VISUAL TEST — the sector itself.
//
// A dense industrial room described as instanced quads plus a light list.
// Everything is generated from a fixed seed, so the scene is identical on
// every machine and two performance numbers are comparable. Nothing is loaded
// from disk: every surface is shaded procedurally in the fragment shader, which
// keeps the experiment asset-free and entirely original to RED STATIC.
//
// A prop is: position, half-extents, rotation, a material, a tint, an emissive
// strength and a height. Height is what the lighting pass uses to fake a
// normal and to throw a contact shadow, which is most of why the room reads as
// having depth rather than as a top-down blueprint.

export const MATERIAL={
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
  puddle:14          // reflective floor wetness
};

export const LIGHT={
  steady:0,
  flicker:1,
  rotate:2,   // sweeping emergency beacon
  pulse:3,
  strobe:4
};

// A tiny deterministic generator so the room is the same everywhere.
function rng(seed){
  let s=seed>>>0;
  return()=>{
    s^=s<<13;s>>>=0;s^=s>>17;s^=s<<5;s>>>=0;
    return s/4294967296;
  };
}

const prop=(x,y,hw,hh,material,opts={})=>({
  x,y,hw,hh,
  rotation:opts.rotation||0,
  material,
  // Linear colour. The composite pass tonemaps, so these can sit low and still
  // come out with contrast.
  r:opts.r??.22,g:opts.g??.24,b:opts.b??.26,
  emissive:opts.emissive||0,
  height:opts.height??0,
  roughness:opts.roughness??.7,
  metal:opts.metal??.6,
  // Drives every animated material: screens scroll, machinery cycles, the
  // reflective floor ripples.
  phase:opts.phase??0,
  animation:opts.animation??0
});

const light=(x,y,radius,r,g,b,opts={})=>({
  x,y,radius,r,g,b,
  intensity:opts.intensity??1,
  kind:opts.kind??LIGHT.steady,
  phase:opts.phase??0,
  speed:opts.speed??1,
  // Height above the floor. A high fixture washes a wide area flatly; a low
  // one rakes across the height field and picks out every edge.
  z:opts.z??60
});

// Fallback dimensions, used only when the scene is built without a world.
// In the test proper the sector is the engine's own arena, so what is drawn
// and what the operative collides with are the same thing.
export const SECTOR={width:2600,height:1800};

// Cover types the simulation generates, mapped onto the materials that suit
// them. Anything unlisted falls back to a crate, which is the safe read.
const COVER_MATERIAL={
  crate:MATERIAL.crate,container:MATERIAL.crate,
  barrier:MATERIAL.hazardStripe,lowcover:MATERIAL.hazardStripe,
  pillar:MATERIAL.machine,machinery:MATERIAL.machine,
  vaultSeal:MATERIAL.containment,vaultTerminal:MATERIAL.screen,
  boulder:MATERIAL.crate,trunk:MATERIAL.cable,log:MATERIAL.cable
};

// `world` is the engine's generated arena. Passing it in is what keeps the
// experiment honest: every wall and every piece of cover the operative can be
// stopped by gets a prop, so nothing visible is decoration floating over
// unrelated collision, and nothing solid is invisible.
export function buildScene(seed=1337,world=null){
  const random=rng(seed);
  const range=(a,b)=>a+random()*(b-a);
  const props=[];
  const lights=[];
  const W=world?world.width:SECTOR.width;
  const H=world?world.height:SECTOR.height;
  const findSpotEarly=(pad,tries=30)=>{
    for(let i=0;i<tries;i++){
      const x=range(pad,W-pad),y=range(pad,H-pad);
      if(!world)return[x,y];
      if(world.playable(x,y,pad)&&!world.overlapsSolid(x,y,pad))return[x,y];
    }
    return null;
  };

  // ---- Floor -------------------------------------------------------------
  // Large plates on a grid, each with its own wear. Overlapping variation
  // rather than one tiled texture is what keeps a big floor from reading as
  // wallpaper.
  const plate=210;
  for(let x=0;x<W;x+=plate){
    for(let y=0;y<H;y+=plate){
      const wear=random();
      props.push(prop(x+plate/2,y+plate/2,plate/2,plate/2,MATERIAL.floorPlate,{
        r:.24+wear*.10,g:.26+wear*.10,b:.29+wear*.11,
        roughness:.55+wear*.4,metal:.5+wear*.3,
        phase:random()*100
      }));
    }
  }

  // Walkway grating down the spine, over a dark service void.
  for(let x=W*.14;x<W*.86;x+=180){
    props.push(prop(x+90,H/2,90,120,MATERIAL.floorGrate,{
      r:.15,g:.17,b:.19,roughness:.8,metal:.7,phase:random()*100
    }));
  }

  // Hazard paint around the plant and along the spine edges.
  for(const y of [H/2-128,H/2+128]){
    for(let x=W*.14;x<W*.86;x+=240){
      props.push(prop(x+120,y,120,16,MATERIAL.hazardStripe,{
        r:.62,g:.45,b:.07,roughness:.85,metal:.1,emissive:.06
      }));
    }
  }

  // Standing water under the coolant runs, which is the cheapest way to get a
  // reflection into a top-down scene.
  for(let i=0;i<7;i++){
    const spot=findSpotEarly(160);
    if(!spot)continue;
    const [x,y]=spot;
    props.push(prop(x,y,range(60,150),range(40,90),MATERIAL.puddle,{
      r:.12,g:.2,b:.24,roughness:.06,metal:.9,phase:random()*100,animation:1
    }));
  }

  // ---- Real geometry -----------------------------------------------------
  // One prop per wall and per cover piece the simulation actually placed.
  if(world){
    for(const wall of world.walls){
      props.push(prop(wall.x,wall.y,wall.hw,wall.hh,MATERIAL.wall,{
        r:.30,g:.33,b:.36,height:wall.type==='perimeter'?58:42,
        roughness:.5,metal:.75,phase:random()*100
      }));
    }
    for(const cover of world.cover){
      const material=COVER_MATERIAL[cover.type]??MATERIAL.crate;
      const lit=material===MATERIAL.containment||material===MATERIAL.screen;
      props.push(prop(cover.x,cover.y,cover.hw,cover.hh,material,{
        r:lit?.2:range(.30,.44),g:lit?.6:range(.26,.34),b:lit?.7:range(.17,.23),
        emissive:lit?1.6:0,
        height:material===MATERIAL.hazardStripe?10:range(20,34),
        roughness:.7,metal:.4,phase:random()*100,
        animation:lit?1:0
      }));
      if(lit)lights.push(light(cover.x,cover.y,200,.3,.85,1,{intensity:.7,kind:LIGHT.pulse,phase:random()*6,z:30}));
    }
  }else{
    const wallT=54;
    for(const [x,y,hw,hh] of [
      [W/2,wallT/2,W/2,wallT/2],[W/2,H-wallT/2,W/2,wallT/2],
      [wallT/2,H/2,wallT/2,H/2],[W-wallT/2,H/2,wallT/2,H/2]
    ]){
      props.push(prop(x,y,hw,hh,MATERIAL.wall,{
        r:.14,g:.155,b:.17,height:46,roughness:.5,metal:.75,phase:random()*100
      }));
    }
  }

  // ---- Plant ------------------------------------------------------------
  // Machinery blocks with their own indicator panels and exhaust.
  // Placed on open ground when a world is present, so the plant does not grow
  // out of a wall the operative is standing behind.
  const clear=(x,y,pad)=>{
    if(!world)return true;
    if(!world.playable(x,y,pad))return false;
    return !world.overlapsSolid(x,y,pad);
  };
  const findSpot=(pad,tries=40)=>{
    for(let i=0;i<tries;i++){
      const x=range(pad,W-pad),y=range(pad,H-pad);
      if(clear(x,y,pad))return[x,y];
    }
    return null;
  };
  const machineSpots=[];
  for(let i=0;i<6;i++){
    const spot=findSpot(140);
    if(spot)machineSpots.push(spot);
  }
  for(const [x,y] of machineSpots){
    const hw=range(90,130),hh=range(70,100);
    props.push(prop(x,y,hw,hh,MATERIAL.machine,{
      r:.32,g:.34,b:.38,height:34,roughness:.42,metal:.85,
      phase:random()*100,animation:1
    }));
    // Panel lights on the face nearest the room centre.
    const dir=x<W/2?1:-1;
    for(let i=0;i<3;i++){
      const px=x+dir*(hw+10),py=y-hh*.5+i*hh*.5;
      props.push(prop(px,py,7,14,MATERIAL.panel,{
        r:.2,g:.95,b:.8,emissive:range(1.6,3),height:6,
        phase:random()*100,animation:1
      }));
      lights.push(light(px,py,120,.25,1,.85,{
        intensity:.5,kind:LIGHT.pulse,phase:random()*6,speed:range(.6,1.6),z:20
      }));
    }
    // Exhaust vents on the outward face.
    props.push(prop(x-dir*(hw+14),y,12,hh*.6,MATERIAL.vent,{
      r:.2,g:.22,b:.24,height:14,roughness:.7,metal:.8,phase:random()*100
    }));
  }

  // Containment cylinders down the middle of the hall, lit from inside.
  for(let i=0;i<9;i++){
    const spot=findSpot(70);
    if(!spot)continue;
    const [x,y]=spot;
    props.push(prop(x,y,44,44,MATERIAL.containment,{
      r:.1,g:.4,b:.5,emissive:range(.9,1.5),height:52,
      roughness:.15,metal:.3,phase:random()*100,animation:1
    }));
    lights.push(light(x,y,230,.3,.85,1,{
      intensity:.85,kind:LIGHT.pulse,phase:i*1.3,speed:.5,z:44
    }));
  }

  // ---- Pipes and cables --------------------------------------------------
  // Long horizontal runs high on the walls, and slack conduit between them.
  for(let i=0;i<9;i++){
    const y=range(120,H-120);
    const x0=range(80,W*.45),x1=Math.min(W-80,x0+range(320,900));
    props.push(prop((x0+x1)/2,y,(x1-x0)/2,range(7,13),MATERIAL.pipe,{
      r:.30,g:.31,b:.33,height:20,roughness:.35,metal:.95,phase:random()*100
    }));
  }
  for(let i=0;i<12;i++){
    const x=range(W*.05,W*.95),y=range(H*.05,H*.95);
    props.push(prop(x,y,range(60,190),range(2,4),MATERIAL.cable,{
      r:.12,g:.12,b:.14,height:5,roughness:.9,metal:.1,
      rotation:range(-.35,.35),phase:random()*100
    }));
  }

  // ---- Stations and signage ---------------------------------------------
  for(let i=0;i<22;i++){
    const spot=findSpot(80);
    if(!spot)continue;
    const [x,y]=spot;
    props.push(prop(x,y,52,26,MATERIAL.machine,{
      r:.27,g:.29,b:.33,height:24,roughness:.5,metal:.8,phase:random()*100
    }));
    // The monitor itself, scrolling.
    props.push(prop(x,y-6,40,16,MATERIAL.screen,{
      r:.25,g:.75,b:.95,emissive:range(1.8,3.2),height:26,
      phase:random()*100,animation:1
    }));
    lights.push(light(x,y,190,.3,.7,1,{intensity:.6,kind:LIGHT.flicker,phase:random()*8,speed:range(2,5),z:30}));
  }

  for(let i=0;i<10;i++){
    props.push(prop(range(W*.06,W*.94),range(H*.05,H*.95),range(28,54),12,MATERIAL.sign,{
      r:.5,g:.5,b:.45,emissive:.35,height:3,roughness:.9,metal:.1,phase:random()*100
    }));
  }

  // ---- Crates ------------------------------------------------------------
  // Decorative crates only where the world has not already put real ones.
  for(let i=0;i<34;i++){
    const s=range(24,46);
    const spot=findSpot(s+14,12);
    if(!spot)continue;
    props.push(prop(spot[0],spot[1],s,s*range(.8,1.1),MATERIAL.crate,{
      r:range(.34,.5),g:range(.27,.38),b:range(.14,.21),
      height:range(18,34),roughness:.75,metal:.25,
      rotation:range(-.25,.25),phase:random()*100
    }));
  }

  // ---- Lighting ----------------------------------------------------------
  // Cold overheads on a wide grid: the base readability layer, and the reason
  // the room is legible before any of the coloured sources are considered.
  const spacing=320;
  for(let x=spacing*.65;x<W;x+=spacing){
    for(let y=spacing*.65;y<H;y+=spacing){
      props.push(prop(x,y,26,8,MATERIAL.lightHousing,{
        r:.7,g:.78,b:.85,emissive:2.4,height:60,phase:random()*100
      }));
      lights.push(light(x,y,430,.66,.76,.9,{intensity:1.35,z:150}));
    }
  }

  // Red emergency beacons, sweeping. These are the atmosphere.
  const inset=Math.min(300,Math.min(W,H)*.16);
  const beacons=[[inset,inset],[W-inset,inset],[inset,H-inset],[W-inset,H-inset],
    [W/2,H/2],[W/2,inset],[W/2,H-inset],[inset,H/2],[W-inset,H/2]];
  beacons.forEach(([x,y],i)=>{
    props.push(prop(x,y,14,14,MATERIAL.lightHousing,{
      r:1,g:.2,b:.16,emissive:3.4,height:70,phase:i*1.9,animation:1
    }));
    lights.push(light(x,y,430,1,.18,.14,{
      intensity:1.25,kind:LIGHT.rotate,phase:i*1.9,speed:.85,z:80
    }));
  });

  // A couple of failing fixtures, because a room where nothing is broken reads
  // as a diagram.
  for(let i=0;i<7;i++){
    const x=range(W*.16,W*.84),y=range(H*.16,H*.84);
    props.push(prop(x,y,22,7,MATERIAL.lightHousing,{
      r:.8,g:.85,b:.9,emissive:1.4,height:58,phase:random()*10,animation:1
    }));
    lights.push(light(x,y,420,.7,.78,.9,{
      intensity:1.1,kind:LIGHT.strobe,phase:random()*10,speed:range(6,13),z:140
    }));
  }

  return{props,lights,width:W,height:H,seed};
}

// Steam and vent positions the particle system draws from, so the atmosphere
// comes out of the machinery rather than from nowhere.
export function emitters(scene){
  const out=[];
  for(const p of scene.props){
    if(p.material===MATERIAL.vent){
      out.push({x:p.x,y:p.y,kind:'steam',rate:14,scale:1});
    }else if(p.material===MATERIAL.machine&&p.animation){
      out.push({x:p.x,y:p.y-p.hh,kind:'smoke',rate:4,scale:1.4});
    }else if(p.material===MATERIAL.containment){
      out.push({x:p.x,y:p.y,kind:'glow',rate:8,scale:.7});
    }
  }
  return out;
}
