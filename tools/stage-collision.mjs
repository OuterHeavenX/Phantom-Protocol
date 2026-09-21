// Does what stops the operative match what the operative can see?
//
// The owner's report was "some stages' collision is very confusing and many
// doesn't make sense". Rendering every theatre with ?collisiondebug=1 over the
// art found seven separate causes, none of them in the collision code itself:
// hazards buried in walls, wings and trees with no collider, a bridge wreck
// whose collider was a different size from its art, a ridge crest drawn past
// its wall, an arena ring that stopped the operative fifty units early on the
// diagonals, pillars drawn round on square colliders, a perimeter the 2D
// renderer never drew, and slow zones drawn too faint to see. Each has an
// assertion here, and each assertion was shown to fail with its defect put
// back (see docs/SYSTEMS.md, "Stage collision").
//
// Usage: node tools/stage-collision.mjs
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:900,height:600}});
p.on('pageerror',e=>console.log('PAGEERROR',String(e).slice(0,300)));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});await p.waitForTimeout(500);

const out=await p.evaluate(async()=>{
  const {Engine}=await import('/src/game/engine.js');
  const {Renderer}=await import('/src/render/renderer.js');
  const {MAPS,DURATIONS,DIFFICULTIES}=await import('/data/maps.js');
  const {OPERATIVES}=await import('/data/operatives.js');
  const {defaultSettings}=await import('/src/save/storage.js');
  const audio=new Proxy({},{get:(t,k)=>k==='then'?undefined:()=>0});
  const res={hazardsBuried:[],hazardsStacked:[],unbackedLandmarks:[],wreckMismatch:[],
    ridgeCrest:[],arena:{},perimeter:{},pillar:{},passiveHazard:{},errors:[]};
  const PLAYER_R=13;
  const build=(map,seed)=>{
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
    const settings={...defaultSettings(),renderer:'2d',showMinimap:false,showFps:false,performanceMode:true};
    const engine=new Engine(canvas,{operative:OPERATIVES[0],map,duration:10,durationSpec:DURATIONS[1],
      difficulty:DIFFICULTIES[1],settings,audio,devRanks:{},masteryXp:0,seed});
    return {engine,canvas};
  };

  for(const map of MAPS)for(const seed of [3,11,29]){
    let engine;
    try{({engine}=build(map,seed))}catch(e){res.errors.push(`${map.id}/${seed}: ${String(e).slice(0,160)}`);continue}
    const world=engine.world;
    const tag=`${map.id}#${seed}`;

    // 1. A hazard keeps half its radius clear of walls, cover, vaults and
    //    water. A zone that is mostly under geometry reads as the geometry.
    for(const h of world.hazards){
      const pad=h.radius*.5;
      if(world.overlapsSolid(h.x,h.y,pad)||world.insideVault(h.x,h.y,pad)||!world.playable(h.x,h.y,pad))
        res.hazardsBuried.push(`${tag} ${h.id}@${h.x|0},${h.y|0}`);
    }
    for(let i=0;i<world.hazards.length;i++)for(let j=i+1;j<world.hazards.length;j++){
      const a=world.hazards[i],c=world.hazards[j];
      if(Math.hypot(a.x-c.x,a.y-c.y)<(a.radius+c.radius)*.65)res.hazardsStacked.push(`${tag} ${a.id}/${c.id}`);
    }

    // 2. Everything drawn standing up has a collider under it.
    const coverAt=(x,y,type,within=2)=>world.cover.filter(c=>c.type===type&&Math.abs(c.x-x)<within&&Math.abs(c.y-y)<within);
    for(const lm of world.landmarks){
      if(lm.kind==='conifer'&&!coverAt(lm.x,lm.y,'conifer').length)res.unbackedLandmarks.push(`${tag} conifer`);
      if(lm.kind==='aircraft'){
        const wings=world.cover.filter(c=>c.type==='wing'&&Math.hypot(c.x-lm.x,c.y-lm.y)<150*lm.scale);
        const need=(lm.wingBroken?2:6)+(lm.tailBroken?0:2);
        if(wings.length<need)res.unbackedLandmarks.push(`${tag} aircraft wings ${wings.length}<${need}`);
      }
      if(lm.kind==='vehicle'){
        const [w]=coverAt(lm.x,lm.y,'wreck');
        // drawVehicle: body 108x44, wheels to 64 tall. The collider must be
        // within a few units of that on every side, whatever the seed.
        if(!w||Math.abs(w.w-112)>6||Math.abs(w.h-58)>8||Math.abs(lm.rotation)>.15)
          res.wreckMismatch.push(`${tag} ${w?`${w.w|0}x${w.h|0} yaw ${lm.rotation.toFixed(2)}`:'no collider'}`);
      }
      if(lm.kind==='ridge'){
        // drawRidge's crest reaches 60 units onto the valley side of the line.
        const wall=world.walls.find(w=>w.type==='ridge'&&Math.abs(w.x-lm.x)<2&&Math.abs(w.y-lm.y)<40);
        const reach=wall?(lm.side<0?wall.y+wall.hh-lm.y:lm.y-(wall.y-wall.hh)):-1;
        if(reach<58)res.ridgeCrest.push(`${tag} crest reach ${reach|0}`);
      }
    }

    // 3. Proving Ground: the ring stops the operative at one radius.
    if(map.layout.type==='arena'&&seed===3){
      const cx=world.width/2,cy=world.height/2,r=Math.min(world.width,world.height)*.42;
      const stops=[];let escaped=0;
      for(let deg=0;deg<360;deg++){
        const a=deg*Math.PI/180;let d=0;
        while(d<r+60&&!world.overlapsSolid(cx+Math.cos(a)*d,cy+Math.sin(a)*d,PLAYER_R))d+=1;
        if(d>=r+60)escaped++;
        stops.push(d);
      }
      res.arena={wander:Math.max(...stops)-Math.min(...stops),escaped,min:Math.min(...stops),max:Math.max(...stops)};
    }
  }

  // 4. The 2D renderer draws the perimeter. Same frame with and without the
  //    perimeter walls: the band where they stand must change.
  {
    const {engine,canvas}=build(MAPS[0],5);
    const ctx=canvas.getContext('2d');
    const cam=engine.camera;cam.resize(canvas.width,canvas.height);
    cam.zoom=cam.targetZoom=cam.baseZoom=1;cam.x=200;cam.y=engine.world.height/2;cam.shakeX=cam.shakeY=0;
    // The renderer has to be built AFTER the wall list is set, not before.
    //
    // The authored-architecture path snapshots world.walls in its constructor
    // and the plain path reads it live, so mutating the list between two
    // renders of one Renderer only reaches the second of those. On the opening
    // sector, which is hand-authored, that meant this check was diffing a
    // frame against an identical copy of itself and reporting that the
    // perimeter is never drawn -- for a renderer that draws it perfectly well.
    const grab=()=>{
      const r=new Renderer(canvas,ctx,engine);
      r.render(0);
      const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      r.dispose?.();
      return d;
    };
    const all=engine.world.walls;
    const withWalls=grab();
    engine.world.walls=all.filter(w=>w.type!=='perimeter');
    const without=grab();
    engine.world.walls=all;
    // Screen x of world x in [-60,0] is cam-relative: 600 + (wx-200).
    let changed=0,band=0;
    for(let y=0;y<canvas.height;y+=2)for(let x=340;x<400;x+=2){
      const i=(y*canvas.width+x)*4;band++;
      if(Math.abs(withWalls[i]-without[i])+Math.abs(withWalls[i+1]-without[i+1])+Math.abs(withWalls[i+2]-without[i+2])>24)changed++;
    }
    res.perimeter={changedFraction:+(changed/band).toFixed(2)};
  }

  // 5. Pillar art fills its square collider: the corner is painted.
  {
    const {engine}=build(MAPS[0],5);
    const c=document.createElement('canvas');c.width=c.height=80;
    const ctx=c.getContext('2d');
    const r=new Renderer(c,ctx,engine);
    r.art.shadows=false;
    r.drawCoverPiece(ctx,{x:40,y:40,w:40,h:40,hw:20,hh:20,type:'pillar',broken:false,shake:0,destructible:false,hp:0,maxHp:0,variant:0},engine.world.palette);
    const d=ctx.getImageData(0,0,80,80).data;
    const alphaAt=(x,y)=>d[(y*80+x)*4+3];
    res.pillar={corner:alphaAt(23,23),centre:alphaAt(40,40)};
  }

  // 6. A passive hazard is visible: fill inside, a firm edge.
  {
    const {engine}=build(MAPS[0],5);
    const c=document.createElement('canvas');c.width=c.height=400;
    const ctx=c.getContext('2d');
    const r=new Renderer(c,ctx,engine);
    engine.world.hazards=[{id:'snowDrift',x:200,y:200,radius:120,passive:true,color:'#bfe3f5',phase:0,timer:0,warning:0,active:false}];
    engine.camera.resize(400,400);engine.camera.x=200;engine.camera.y=200;engine.camera.zoom=1;
    r.drawHazards(ctx);
    const d=ctx.getImageData(0,0,400,400).data;
    const a=(x,y)=>d[(y*400+x)*4+3];
    let edge=0;for(let deg=0;deg<360;deg+=5){const x=Math.round(200+Math.cos(deg*Math.PI/180)*120),y=Math.round(200+Math.sin(deg*Math.PI/180)*120);edge=Math.max(edge,a(x,y))}
    res.passiveHazard={fill:a(200,150),edge};
  }
  return res;
});
await b.close();

const fail=[];
if(out.errors.length)fail.push(`engine failed to build: ${out.errors.join(' | ')}`);
if(out.hazardsBuried.length)fail.push(`hazards buried in geometry, vaults or water: ${out.hazardsBuried.slice(0,6).join(', ')}${out.hazardsBuried.length>6?` (+${out.hazardsBuried.length-6})`:''}`);
if(out.hazardsStacked.length)fail.push(`hazards stacked on one spot: ${out.hazardsStacked.slice(0,6).join(', ')}`);
if(out.unbackedLandmarks.length)fail.push(`standing landmarks with no collider: ${out.unbackedLandmarks.slice(0,6).join(', ')}`);
if(out.wreckMismatch.length)fail.push(`bridge wreck collider does not match its art: ${out.wreckMismatch.slice(0,4).join(', ')}`);
if(out.ridgeCrest.length)fail.push(`ridge crest drawn past its wall: ${out.ridgeCrest.slice(0,4).join(', ')}`);
if(!(out.arena.wander<=20))fail.push(`arena ring stops the operative unevenly: wander ${out.arena.wander}px (${out.arena.min}-${out.arena.max})`);
if(out.arena.escaped)fail.push(`arena ring has ${out.arena.escaped} escape directions`);
if(!(out.perimeter.changedFraction>=.5))fail.push(`the 2D renderer does not draw the perimeter (band changed ${out.perimeter.changedFraction})`);
if(!(out.pillar.corner>200))fail.push(`pillar art leaves its collider corner unpainted (alpha ${out.pillar.corner})`);
if(!(out.passiveHazard.fill>=55&&out.passiveHazard.edge>=120))fail.push(`passive hazard too faint to see (fill ${out.passiveHazard.fill}, edge ${out.passiveHazard.edge})`);

console.log(JSON.stringify({arena:out.arena,perimeter:out.perimeter,pillar:out.pillar,passiveHazard:out.passiveHazard,
  buried:out.hazardsBuried.length,stacked:out.hazardsStacked.length,unbacked:out.unbackedLandmarks.length,
  wreck:out.wreckMismatch.length,ridge:out.ridgeCrest.length},null,1));
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1}
else console.log('\nwhat stops the operative is what the operative can see');
