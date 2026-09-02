import {clamp,TAU} from '../core/math.js';

// ---------------------------------------------------------------------------
// Impact and muzzle tables
//
// Kept as data at the top of the file rather than buried in the methods,
// because these are art decisions and the point of them is that somebody can
// look at all of them side by side and see that concrete does not spark and
// snow does not ricochet.
// ---------------------------------------------------------------------------

// How hard each weapon family leaves a mark. A suppressed pistol barely marks
// the wall; a heavy weapon takes a piece out of it.
const IMPACT_PUNCH={
  suppressed:.5,pistol:.7,smg:.75,tech:.7,beam:.85,
  rifle:1,marksman:1.35,corrupted:1.2,
  shotgun:1.5,sniper:1.7,lmg:1.15,heavy:2
};

const SURFACE_IMPACTS={
  // Powdered, not shiny. Falls rather than flies.
  concrete:{debris:{count:6,spread:1.5,speed:120,life:.42,size:2.2,gravity:220,
                    color:['#9aa2a4','#7d8688','#b3b8b6'],kind:'square'},
            ring:{to:14,life:.16,color:'rgba(180,180,175,.35)'},flash:'#cfd4d2'},
  // The one surface that genuinely sparks, and it throws almost no dust.
  metal:{debris:{count:3,spread:1.2,speed:170,life:.22,size:1.6,
                 color:['#c9d4d8','#8fa2a8'],kind:'square'},
         sparks:{count:7,speed:250,color:['#fff3c4','#ffd268','#ff9a3c']},
         flash:'#ffe8b0'},
  // Muffled. A puff that hangs, no hard edges, no sparks at all.
  snow:{debris:{count:9,spread:2,speed:80,life:.7,size:3,gravity:70,drag:.94,
                color:['#ffffff','#e8f4ff','#cfe4f2'],kind:'circle'},
        ring:{to:18,life:.3,color:'rgba(230,244,255,.4)'}},
  // Shatters rather than powders.
  ice:{debris:{count:7,spread:1.8,speed:200,life:.5,size:2.4,gravity:260,
               color:['#dff3ff','#a9d8ec','#ffffff'],kind:'square'},
       sparks:{count:3,speed:180,color:['#eafaff']},flash:'#dff3ff'},
  water:{debris:{count:10,spread:1.9,speed:140,life:.45,size:2.6,gravity:340,
                 color:['#bfe6ef','#8fd0dd','#e7f7fa'],kind:'circle'},
         ring:{to:22,life:.34,color:'rgba(160,225,240,.45)'}},
  sand:{debris:{count:8,spread:2.1,speed:100,life:.6,size:2.8,gravity:150,drag:.93,
                color:['#c9a877','#a8895c','#e0c79a'],kind:'circle'},
        ring:{to:20,life:.26,color:'rgba(200,170,120,.35)'}},
  glass:{debris:{count:8,spread:2.2,speed:240,life:.5,size:1.8,gravity:300,
                 color:['#dff6ff','#ffffff','#a9d8ec'],kind:'square'},
         sparks:{count:4,speed:200,color:['#ffffff']},flash:'#eafaff'},
  // Contaminated ground: wet, dark, and it does not spark either.
  mire:{debris:{count:7,spread:1.9,speed:95,life:.55,size:2.6,gravity:260,
                                color:['#5d6b47','#47563a','#7a8a5e'],
                kind:'circle'},
        ring:{to:16,life:.28,color:'rgba(120,150,90,.3)'}},
  // Ablative plate coming off a machine.
  armour:{debris:{count:5,spread:1.4,speed:190,life:.3,size:1.8,
                  color:['#b9c4c8','#8a969a'],kind:'square'},
          sparks:{count:6,speed:230,color:['#fff3c4','#ffc46a']},flash:'#ffe8b0'}
};

// Muzzle flash per family. `count:0` is a suppressor doing its job.
const MUZZLES={
  suppressed:{count:2,spread:.5,speed:110,life:.06,size:1.5,ring:0,smoke:2,scale:.6,
              color:['#cfd6c8','#9fb0a4']},
  pistol:{count:4,spread:.7,speed:210,life:.09,size:2.2,ring:22,smoke:0,
          color:['#fff3c4','#ffd268','#ffa63c']},
  smg:{count:4,spread:.9,speed:200,life:.08,size:2,ring:20,smoke:0,
       color:['#fff3c4','#ffd268']},
  rifle:{count:5,spread:.62,speed:250,life:.1,size:2.6,ring:26,smoke:0,
         color:['#fff3c4','#ffd268','#ffa63c']},
  // Wide and brief.
  shotgun:{count:9,spread:1.15,speed:280,life:.11,size:3.2,ring:34,smoke:3,scale:1.15,
           color:['#fff6d8','#ffcf72','#ff9a3c']},
  // Long narrow spike, visible pressure ring, real smoke.
  marksman:{count:5,spread:.3,speed:360,life:.12,size:2.8,ring:32,smoke:2,scale:1.1,
            color:['#ffffff','#ffe6a2','#ffb04c']},
  sniper:{count:6,spread:.22,speed:430,life:.14,size:3,ring:40,smoke:3,scale:1.25,
          color:['#ffffff','#ffe6a2','#ffa63c']},
  lmg:{count:6,spread:.7,speed:260,life:.1,size:2.8,ring:28,smoke:1,
       color:['#fff3c4','#ffd268','#ffa63c']},
  heavy:{count:8,spread:.85,speed:300,life:.15,size:4,ring:46,smoke:4,scale:1.3,
         color:['#fff6d8','#ffbe5c','#ff8a3c']},
  // Energy: a bloom, not a blast, and no smoke because nothing burned.
  beam:{count:4,spread:.5,speed:180,life:.12,size:2.4,ring:30,smoke:0,
        ringColor:'#8fd8ff',color:['#dff6ff','#8fd8ff','#4fa8d8']},
  tech:{count:3,spread:.8,speed:150,life:.1,size:2,ring:18,smoke:0,
        ringColor:'#76e7d4',color:['#d8fff6','#76e7d4']},
  corrupted:{count:5,spread:1,speed:230,life:.13,size:2.6,ring:28,smoke:1,
             ringColor:'#ff5b5b',color:['#ffd8d8','#ff6b6b','#c895ff']}
};

// Families that eject brass. Energy and tech weapons do not.
const CASING_VOICES=new Set(['pistol','smg','rifle','marksman','sniper','lmg','shotgun','suppressed']);

// Visual effects: particles, floating damage numbers, transient overlays.
// Everything is pooled — long runs can produce tens of thousands of particles
// and allocating a fresh object for each one is what makes browser games stutter.

class Pool{
  constructor(factory,reset,initial=256){
    this.factory=factory;
    this.reset=reset;
    this.free=[];
    this.active=[];
    for(let i=0;i<initial;i++)this.free.push(factory());
  }

  spawn(init){
    const item=this.free.pop()||this.factory();
    this.reset(item);
    init(item);
    this.active.push(item);
    return item;
  }

  update(dt,step){
    let write=0;
    for(let i=0;i<this.active.length;i++){
      const item=this.active[i];
      if(step(item,dt)){
        this.active[write++]=item;
      }else{
        this.free.push(item);
      }
    }
    this.active.length=write;
  }

  clear(){
    for(const item of this.active)this.free.push(item);
    this.active.length=0;
  }

  get count(){return this.active.length}
}

export class Fx{
  constructor(settings={}){
    this.settings=settings;
    this.quality=settings.particles||'high';
    this.particles=new Pool(
      ()=>({x:0,y:0,vx:0,vy:0,life:0,maxLife:1,size:1,color:'#fff',drag:.94,gravity:0,glow:false,kind:'square',rotation:0,spin:0}),
      p=>{p.drag=.94;p.gravity=0;p.glow=false;p.kind='square';p.rotation=0;p.spin=0},
      1200
    );
    this.texts=new Pool(
      ()=>({x:0,y:0,vy:-34,life:0,maxLife:1,text:'',color:'#fff',size:12,crit:false}),
      t=>{t.vy=-34;t.crit=false;t.size=12},
      128
    );
    // Muzzle illumination.
    //
    // A fixed ring of six slots, allocated once and written in place — no pool,
    // no allocation, and a hard cap that cannot be exceeded however fast the
    // sector is firing. The cap is the point: the renderers have their own
    // light budget, and gunfire is the one source that can arrive faster than
    // anything else in the game. Left uncapped, a squad of riflemen would push
    // the hazards, the boss and the extraction beacon out of the budget
    // entirely — the lights that actually tell the operative something.
    //
    // Six is enough to read as a sector lit by its own gunfire. Newest wins,
    // because the flash you want to see is the one that just happened.
    this.muzzleLights=Array.from({length:6},()=>({
      x:0,y:0,life:0,maxLife:1,radius:0,r:1,g:.86,b:.55
    }));
    this.muzzleCursor=0;

    this.rings=new Pool(
      ()=>({x:0,y:0,radius:0,targetRadius:0,life:0,maxLife:1,color:'#fff',width:2,filled:false}),
      r=>{r.width=2;r.filled=false},
      64
    );
    this.streaks=new Pool(
      ()=>({x1:0,y1:0,x2:0,y2:0,life:0,maxLife:1,color:'#fff',width:2}),
      s=>{s.width=2},
      64
    );
    this.chains=[];
    this.screenFlash=0;
    this.screenFlashColor='#fff';
    this.hitStop=0;
  }

  // Particle budget scales with the quality setting so low-end devices can
  // still run the same effects at reduced density.
  get densityScale(){
    return this.quality==='low'?.28:this.quality==='medium'?.6:1;
  }

  setQuality(quality){this.quality=quality}

  particle(options){
    if(this.particles.active.length>(this.quality==='low'?600:this.quality==='medium'?1600:3200))return;
    this.particles.spawn(p=>{
      p.x=options.x;p.y=options.y;
      p.vx=options.vx||0;p.vy=options.vy||0;
      p.life=p.maxLife=options.life||.4;
      p.size=options.size||2;
      p.color=options.color||'#fff';
      p.drag=options.drag??.94;
      p.gravity=options.gravity||0;
      p.glow=!!options.glow;
      p.kind=options.kind||'square';
      p.rotation=options.rotation||0;
      p.spin=options.spin||0;
    });
  }

  burst(x,y,count,options={}){
    const total=Math.max(1,Math.round(count*this.densityScale));
    for(let i=0;i<total;i++){
      const angle=options.angle!==undefined
        ?options.angle+(Math.random()-.5)*(options.spread??TAU)
        :Math.random()*TAU;
      const speed=(options.speed||90)*(.4+Math.random());
      this.particle({
        x,y,
        vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,
        life:(options.life||.4)*(.6+Math.random()*.8),
        size:(options.size||2.5)*(.6+Math.random()*.8),
        color:Array.isArray(options.color)
          ?options.color[Math.floor(Math.random()*options.color.length)]
          :(options.color||'#fff'),
        drag:options.drag,gravity:options.gravity,glow:options.glow,
        kind:options.kind,spin:(Math.random()-.5)*8
      });
    }
  }

  // The flash, shaped by what fired it.
  //
  // A suppressor exists to hide this, so it barely shows. A shotgun throws a
  // wide short cone. An anti-materiel rifle produces a long narrow spike and a
  // visible pressure ring. They were all the same cone before.
  muzzle(x,y,angle,scale=1,voice='rifle'){
    const m=MUZZLES[voice]||MUZZLES.rifle;
    const s=scale*(m.scale??1);
    if(m.count>0){
      this.burst(x,y,m.count*s,{
        angle,spread:m.spread,speed:m.speed*s,life:m.life,size:m.size*s,
        color:m.color,glow:true,drag:.86
      });
    }
    if(m.ring>0)this.ring(x,y,10*s,m.ring*s,.1,m.ringColor||'#ffe08a',3);
    this.muzzleLight(x,y,s,m);
    // Smoke lingers where the flash was, on the weapons big enough to make it.
    if(m.smoke>0){
      this.burst(x+Math.cos(angle)*8,y+Math.sin(angle)*8,m.smoke,{
        angle,spread:1.1,speed:34,life:.55,size:5*s,
        color:'rgba(150,150,150,.28)',drag:.93,kind:'circle'
      });
    }
  }

  // Brass, for the families that eject it. Thrown to the side of the weapon
  // rather than along the shot, with gravity so it lands rather than drifting.
  casing(x,y,angle,voice='rifle'){
    if(!CASING_VOICES.has(voice))return;
    const side=angle+Math.PI*.55;
    this.burst(x,y,1,{
      angle:side,spread:.5,speed:120,life:.7,size:1.6,
      color:'#d8b070',drag:.9,gravity:420,kind:'square'
    });
  }

  // What a round does to what it hit.
  //
  // Every impact in the game used to be the same five-spark burst regardless
  // of whether it landed on concrete, ice, water or a person, and regardless of
  // whether it came from a suppressed pistol or an anti-materiel rifle. The
  // surface decides the debris; the weapon family decides how much of it and
  // how hard it leaves.
  //
  // Recipes are deliberately few and strongly differentiated. At this camera
  // distance a subtle difference is no difference — what has to read is
  // *concrete versus metal versus snow*, not the grade of the concrete.
  surfaceImpact(x,y,angle,{surface='concrete',voice='rifle',intensity=1}={}){
    const punch=IMPACT_PUNCH[voice]??1;
    const n=intensity*punch;
    const back=angle+Math.PI;
    const recipe=SURFACE_IMPACTS[surface]||SURFACE_IMPACTS.concrete;

    // Debris thrown back along the incoming line.
    if(recipe.debris){
      const d=recipe.debris;
      this.burst(x,y,Math.round(d.count*n),{
        angle:back,spread:d.spread,speed:d.speed*n,life:d.life,
        size:d.size*Math.min(2,n),color:d.color,
        drag:d.drag??.9,gravity:d.gravity||0,glow:!!d.glow,kind:d.kind
      });
    }
    // Sparks are a metal response, not a universal one. Snow does not spark.
    if(recipe.sparks&&punch>.4){
      this.burst(x,y,Math.round(recipe.sparks.count*n),{
        angle:back,spread:2.2,speed:recipe.sparks.speed*n,life:.26,
        size:1.4,color:recipe.sparks.color,drag:.86,glow:true
      });
    }
    if(recipe.ring){
      this.ring(x,y,2,recipe.ring.to*n,recipe.ring.life,recipe.ring.color,2);
    }
    // A heavy round leaves a mark; a pistol does not.
    if(recipe.flash&&punch>=1.3){
      this.ring(x,y,1,10*n,.09,recipe.flash,3,true);
    }
  }

  impact(x,y,angle,color='#d5f0ef',intensity=1){
    this.burst(x,y,5*intensity,{
      angle:angle+Math.PI,spread:1.6,speed:150*intensity,life:.22,
      size:2*intensity,color,drag:.9,glow:true
    });
  }

  // `mist` is the fine airborne spray a body throws and a hull does not. Oil
  // comes out under its own pressure in fat droplets; blood atomises.
  blood(x,y,color='#8b3a3a',intensity=1,{mist=true}={}){
    this.burst(x,y,Math.round(11*intensity),{
      speed:130*intensity,life:.55,size:2.9,color,gravity:70,drag:.9
    });
    // Heavier, slower droplets that fall short of the spray and land in a
    // tighter group, which is what gives the spatter a near edge and a far one
    // rather than a single even ring.
    this.burst(x,y,Math.round(6*intensity),{
      speed:58*intensity,life:.75,size:4.2,color,gravity:150,drag:.86
    });
    if(mist){
      this.burst(x,y,Math.round(7*intensity),{
        speed:190*intensity,life:.3,size:1.4,color,gravity:20,drag:.82
      });
    }
  }

  // One flash of illumination, written into the next slot of the ring.
  //
  // Deliberately shorter than the muzzle particles it accompanies: real muzzle
  // flash is over in a couple of milliseconds and what persists is the smoke,
  // so a light that outlives its own flash reads as a lamp rather than a shot.
  muzzleLight(x,y,scale,spec){
    // A suppressed weapon has almost no flash to light anything with, and the
    // table already says so — the light is scaled by the same ring size the
    // muzzle effect uses rather than by a second number that could disagree
    // with it.
    // `??`, not `||`. The suppressed family declares `ring:0` to say it has no
    // visible flash at all, and `||` reads that explicit zero as "unset" and
    // substitutes the default — so the one weapon in the game whose whole point
    // is not lighting up the room lit up the room.
    const reach=(spec.ring??14)*scale;
    if(reach<8)return;
    const slot=this.muzzleLights[this.muzzleCursor];
    this.muzzleCursor=(this.muzzleCursor+1)%this.muzzleLights.length;
    slot.x=x;slot.y=y;
    slot.radius=reach*3.4;
    slot.life=slot.maxLife=.055;
    // Warm, from the hottest colour the flash itself is drawn in, so the light
    // and the thing casting it agree.
    const hex=(spec.color&&spec.color[0])||'#fff3c4';
    slot.r=parseInt(hex.slice(1,3),16)/255;
    slot.g=parseInt(hex.slice(3,5),16)/255;
    slot.b=parseInt(hex.slice(5,7),16)/255;
  }

  // Live flashes, brightest first, for whichever renderer is asking.
  //
  // Intensity is squared on the way out so the flash falls off fast rather than
  // fading — which is what makes it read as a flash. `reducedFlashing` damps it
  // rather than removing it: a strobing light is exactly what that setting is
  // for, but the illumination still carries information about where fire is
  // coming from.
  activeMuzzleLights(out=[]){
    out.length=0;
    const damp=this.settings.reducedFlashing?.28:1;
    for(const l of this.muzzleLights){
      if(l.life<=0)continue;
      const t=l.life/l.maxLife;
      out.push({x:l.x,y:l.y,radius:l.radius,intensity:t*t*damp,r:l.r,g:l.g,b:l.b});
    }
    return out;
  }

  // The trail behind a machine that is on fire and going down. Called every
  // few frames while it falls, so each call is deliberately small — the plume
  // is made by the trail persisting, not by any one puff being large.
  deathTrail(x,y,intensity=1){
    this.burst(x,y,2,{
      speed:26,life:1.7,size:7*intensity,drag:.93,
      color:'rgba(74,74,80,.55)',kind:'circle'
    });
    this.burst(x,y,2,{
      speed:54,life:.34,size:3.2*intensity,drag:.9,glow:true,
      color:['#ffb35c','#ff7043','#ffe6a8']
    });
  }

  // What comes off a chassis when it stops, over and above the fluid.
  //
  // Blood and oil already separate the two materials on the floor. This
  // separates them in the air: a body throws fabric and dust, a machine throws
  // sparks, hot fragments and a short electrical failure. The objective is
  // material identity rather than more gore — a player should know what they
  // just killed without reading the health bar that is no longer there.
  machineDeath(x,y,color='#8a929a',scale=1){
    // Sparks: bright, fast, gravity-bound, and gone quickly.
    this.burst(x,y,Math.round(9*scale),{
      speed:270*scale,life:.42,size:1.6,drag:.88,gravity:320,glow:true,
      color:['#ffe6a8','#ffb35c','#fff']
    });
    // Fragments of the chassis itself, in its own colour so the wreck reads as
    // having come from that unit.
    this.burst(x,y,Math.round(6*scale),{
      speed:150*scale,life:.65,size:2.8,drag:.9,gravity:260,
      color:[color,'#5a6a6c','#2b3338']
    });
    // The short electrical failure: one bright arc, then nothing.
    this.ring(x,y,2,26*scale,.16,'#bfe9ff',2);
    // Smoke, which is what is left a moment later.
    this.burst(x,y,Math.round(4*scale),{
      speed:44*scale,life:1.25,size:6.5*scale,drag:.93,
      color:'rgba(70,72,78,.5)',kind:'circle'
    });
  }

  explosion(x,y,radius,color='#ffb35c'){
    this.ring(x,y,radius*.25,radius,.42,color,4);
    this.ring(x,y,radius*.1,radius*.7,.28,'#fff',2);
    this.burst(x,y,Math.round(radius*.34),{
      speed:radius*3.4,life:.55,size:4,drag:.88,glow:true,
      color:[color,'#fff3c4','#ff7043','#8a5a3a']
    });
    // Lingering smoke.
    this.burst(x,y,Math.round(radius*.14),{
      speed:radius*.9,life:1.5,size:9,drag:.94,color:'rgba(90,90,96,.5)',kind:'circle'
    });
  }

  death(x,y,color='#a7b8b9',elite=false){
    this.burst(x,y,elite?26:11,{
      speed:elite?300:180,life:elite?.7:.45,size:elite?4:2.6,
      color:[color,'#e6f2f0','#5a6a6c'],drag:.9,gravity:40
    });
    if(elite)this.ring(x,y,10,110,.4,color,3);
  }

  ring(x,y,from,to,life,color,width=2,filled=false){
    this.rings.spawn(r=>{
      r.x=x;r.y=y;r.radius=from;r.targetRadius=to;
      r.life=r.maxLife=life;r.color=color;r.width=width;r.filled=filled;
    });
  }

  streak(x1,y1,x2,y2,color,width=2,life=.18){
    this.streaks.spawn(s=>{
      s.x1=x1;s.y1=y1;s.x2=x2;s.y2=y2;
      s.life=s.maxLife=life;s.color=color;s.width=width;
    });
  }

  chain(points,color,life=.22){
    this.chains.push({points:points.map(p=>({x:p.x,y:p.y})),color,life,maxLife:life});
    if(this.chains.length>40)this.chains.shift();
  }

  text(x,y,text,color='#fff',options={}){
    if(this.settings.damageNumbers===false&&options.damage)return;
    this.texts.spawn(t=>{
      t.x=x+(Math.random()-.5)*14;t.y=y;
      t.vy=options.vy??-38;
      t.life=t.maxLife=options.life||.85;
      t.text=String(text);t.color=color;
      t.size=options.size||12;
      t.crit=!!options.crit;
    });
  }

  flash(color='#fff',intensity=.3){
    if(this.settings.reducedFlashing)intensity*=.35;
    this.screenFlash=Math.max(this.screenFlash,intensity);
    this.screenFlashColor=color;
  }

  // Brief freeze on heavy impacts. Sells weight far better than shake alone.
  freeze(duration=.05){
    this.hitStop=Math.max(this.hitStop,duration);
  }

  update(dt){
    for(const l of this.muzzleLights)if(l.life>0)l.life-=dt;
    this.particles.update(dt,(p,step)=>{
      p.life-=step;
      if(p.life<=0)return false;
      p.x+=p.vx*step;p.y+=p.vy*step;
      p.vy+=p.gravity*step;
      const drag=Math.pow(p.drag,step*60);
      p.vx*=drag;p.vy*=drag;
      p.rotation+=p.spin*step;
      return true;
    });
    this.texts.update(dt,(t,step)=>{
      t.life-=step;
      if(t.life<=0)return false;
      t.y+=t.vy*step;
      t.vy*=Math.pow(.92,step*60);
      return true;
    });
    this.rings.update(dt,(r,step)=>{
      r.life-=step;
      if(r.life<=0)return false;
      const progress=1-r.life/r.maxLife;
      r.current=r.radius+(r.targetRadius-r.radius)*(1-Math.pow(1-progress,2.4));
      return true;
    });
    this.streaks.update(dt,(s,step)=>{
      s.life-=step;
      return s.life>0;
    });
    let write=0;
    for(const chain of this.chains){
      chain.life-=dt;
      if(chain.life>0)this.chains[write++]=chain;
    }
    this.chains.length=write;

    this.screenFlash=Math.max(0,this.screenFlash-dt*3.2);
    this.hitStop=Math.max(0,this.hitStop-dt);
  }

  clear(){
    this.particles.clear();
    this.texts.clear();
    this.rings.clear();
    this.streaks.clear();
    this.chains.length=0;
    this.screenFlash=0;
    // Written in place rather than pooled, so they need clearing explicitly —
    // a flash left live here would light the first frame of the next contract.
    for(const l of this.muzzleLights)l.life=0;
  }

  get stats(){
    return{
      particles:this.particles.count,
      texts:this.texts.count,
      rings:this.rings.count
    };
  }
}

export {Pool};
