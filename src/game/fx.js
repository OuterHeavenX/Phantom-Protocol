import {clamp,TAU} from '../core/math.js';

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

  muzzle(x,y,angle,scale=1){
    this.burst(x,y,4*scale,{
      angle,spread:.7,speed:220*scale,life:.11,size:2.6*scale,
      color:['#fff3c4','#ffd268','#ffa63c'],glow:true,drag:.86
    });
    this.ring(x,y,10*scale,26*scale,.1,'#ffe08a',3);
  }

  impact(x,y,angle,color='#d5f0ef',intensity=1){
    this.burst(x,y,5*intensity,{
      angle:angle+Math.PI,spread:1.6,speed:150*intensity,life:.22,
      size:2*intensity,color,drag:.9,glow:true
    });
  }

  blood(x,y,color='#8b3a3a',intensity=1){
    this.burst(x,y,7*intensity,{
      speed:120*intensity,life:.5,size:2.6,color,gravity:60,drag:.9
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
