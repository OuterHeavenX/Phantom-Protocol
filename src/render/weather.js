import {clamp,TAU} from '../core/math.js';

// Ambient weather. Drawn in screen space with a parallax offset taken from the
// camera, so a field of a few hundred particles covers an arbitrarily large
// sector without allocating per-frame.
//
// Each theatre declares its own profile in data/maps.js (`map.weather`); a
// theatre without one renders nothing and costs nothing.

const COUNTS={rain:260,snow:220,fog:26,dust:120,ember:90};

export class Weather{
  constructor(profile,settings){
    this.profile=profile||null;
    this.settings=settings;
    this.particles=[];
    this.time=0;
    this.flash=0;
    this.flashTimer=this.profile?.flashes?4+Math.random()*7:0;
    this.build();
  }

  get active(){return !!this.profile}

  build(){
    if(!this.profile)return;
    const quality=this.settings?.particles==='low'?.45:this.settings?.particles==='medium'?.75:1;
    const count=Math.round((COUNTS[this.profile.type]||120)*(this.profile.density||1)*quality);
    this.particles.length=0;
    for(let i=0;i<count;i++)this.particles.push(this.spawn(true));
  }

  spawn(initial){
    // Positions are normalised 0..1 across the viewport and wrapped, so a
    // resize never leaves a gap.
    return{
      x:Math.random(),y:initial?Math.random():-0.05,
      z:.4+Math.random()*.6,              // depth: parallax and size
      seed:Math.random()*TAU,
      life:Math.random()
    };
  }

  update(dt){
    if(!this.profile)return;
    this.time+=dt;
    if(this.profile.flashes){
      this.flashTimer-=dt;
      if(this.flashTimer<=0){
        this.flash=1;
        this.flashTimer=5+Math.random()*9;
      }
      this.flash=Math.max(0,this.flash-dt*3.2);
    }
  }

  // Rendered after the world, before the HUD. `ctx` is already in screen space.
  draw(ctx,width,height,camera,elapsed){
    const profile=this.profile;
    if(!profile)return;
    const reduced=this.settings?.reducedFlashing;

    // Whole-scene tint sets the theatre's mood before any particle is drawn.
    if(profile.ambient){
      ctx.fillStyle=profile.ambient;
      ctx.fillRect(0,0,width,height);
    }

    switch(profile.type){
      case 'rain':this.drawRain(ctx,width,height,camera,reduced);break;
      case 'snow':this.drawSnow(ctx,width,height,camera);break;
      case 'fog':this.drawFog(ctx,width,height,camera,elapsed);break;
      case 'dust':this.drawDust(ctx,width,height,camera,elapsed);break;
      case 'ember':this.drawEmber(ctx,width,height,camera);break;
      default:break;
    }
  }

  // Parallax offset in screen pixels, wrapped into 0..1 space.
  offset(camera,depth){
    return{
      ox:((-camera.x*depth*.0006)%1+1)%1,
      oy:((-camera.y*depth*.0006)%1+1)%1
    };
  }

  drawRain(ctx,width,height,camera,reduced){
    const profile=this.profile;
    const wind=profile.wind??-.3;
    ctx.save();
    ctx.strokeStyle=profile.color||'rgba(176,214,232,.5)';
    ctx.lineWidth=1.1;
    ctx.beginPath();
    for(const p of this.particles){
      const {ox,oy}=this.offset(camera,p.z);
      // Falling is time-driven; the modulo keeps the column endless.
      const fall=(p.y+oy+this.time*(1.1+p.z*1.5))%1;
      const drift=(p.x+ox+fall*wind)%1;
      const x=((drift%1)+1)%1*width;
      const y=fall*height;
      const len=(10+p.z*22);
      ctx.moveTo(x,y);
      ctx.lineTo(x+wind*len*1.8,y+len);
    }
    ctx.stroke();

    // Splash flecks near the ground plane read as rain hitting the deck.
    ctx.fillStyle=profile.color||'rgba(176,214,232,.5)';
    ctx.globalAlpha=.35;
    for(let i=0;i<40;i++){
      const p=this.particles[i];
      if(!p)break;
      const sx=(((p.x*7.3+this.time*.2)%1)+1)%1*width;
      const sy=(((p.seed*.16+this.time*.9)%1)+1)%1*height;
      const r=1+Math.abs(Math.sin(this.time*8+p.seed))*1.6;
      ctx.fillRect(sx,sy,r,1);
    }
    ctx.globalAlpha=1;

    // Distant lightning, suppressed when the player has asked for less flashing.
    if(this.flash>0&&!reduced){
      ctx.fillStyle=`rgba(200,225,255,${(this.flash*.22).toFixed(3)})`;
      ctx.fillRect(0,0,width,height);
    }
    ctx.restore();
  }

  drawSnow(ctx,width,height,camera){
    const profile=this.profile;
    const wind=profile.wind??.2;
    ctx.save();
    ctx.fillStyle=profile.color||'rgba(232,246,255,.7)';
    for(const p of this.particles){
      const {ox,oy}=this.offset(camera,p.z);
      const fall=(p.y+oy+this.time*(.10+p.z*.22))%1;
      // Sideways sway makes flakes drift rather than drop straight.
      const sway=Math.sin(this.time*.8+p.seed)*.02;
      const drift=(p.x+ox+fall*wind+sway)%1;
      const x=((drift%1)+1)%1*width;
      const y=fall*height;
      const r=.9+p.z*2.2;
      ctx.globalAlpha=.28+p.z*.5;
      ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
    }
    ctx.restore();
  }

  drawFog(ctx,width,height,camera,elapsed){
    const profile=this.profile;
    ctx.save();
    // Slow overlapping banks rather than a flat wash, so movement reads.
    for(const p of this.particles){
      const {ox,oy}=this.offset(camera,p.z*.5);
      const x=((p.x+ox+Math.sin(elapsed*.06+p.seed)*.05)%1+1)%1*width;
      const y=((p.y+oy+Math.cos(elapsed*.05+p.seed)*.04)%1+1)%1*height;
      const r=(140+p.z*300);
      const gradient=ctx.createRadialGradient(x,y,0,x,y,r);
      gradient.addColorStop(0,profile.color||'rgba(126,150,124,.4)');
      gradient.addColorStop(1,'rgba(0,0,0,0)');
      ctx.globalAlpha=.14+p.z*.13;
      ctx.fillStyle=gradient;
      ctx.fillRect(x-r,y-r,r*2,r*2);
    }
    // Motes of light drifting through the canopy.
    if(profile.fireflies){
      ctx.globalAlpha=1;
      for(let i=0;i<24;i++){
        const p=this.particles[i%this.particles.length];
        const t=elapsed*.35+p.seed*3;
        const x=((p.x+Math.sin(t*.7)*.06)%1+1)%1*width;
        const y=((p.y+Math.cos(t*.5)*.05)%1+1)%1*height;
        const pulse=(Math.sin(t*2.4)+1)/2;
        ctx.fillStyle=`rgba(198,240,140,${(pulse*.5).toFixed(3)})`;
        ctx.beginPath();ctx.arc(x,y,1.6+pulse*1.4,0,TAU);ctx.fill();
      }
    }
    ctx.restore();
  }

  drawDust(ctx,width,height,camera,elapsed){
    const profile=this.profile;
    ctx.save();
    // Shafts of light from the roof, before the motes so motes read inside them.
    if(profile.shafts){
      for(let i=0;i<4;i++){
        const x=width*(.16+i*.23)+Math.sin(elapsed*.08+i)*22;
        const w=width*.10;
        const gradient=ctx.createLinearGradient(x,0,x+w*.6,height);
        gradient.addColorStop(0,'rgba(255,232,180,.11)');
        gradient.addColorStop(1,'rgba(255,232,180,0)');
        ctx.fillStyle=gradient;
        ctx.beginPath();
        ctx.moveTo(x,0);ctx.lineTo(x+w,0);
        ctx.lineTo(x+w*2.1,height);ctx.lineTo(x+w*.9,height);
        ctx.closePath();ctx.fill();
      }
    }
    ctx.fillStyle=profile.color||'rgba(214,190,150,.3)';
    for(const p of this.particles){
      const {ox,oy}=this.offset(camera,p.z);
      const x=((p.x+ox+Math.sin(this.time*.3+p.seed)*.03)%1+1)%1*width;
      const y=((p.y+oy+this.time*.02*(profile.wind??.1))%1+1)%1*height;
      ctx.globalAlpha=.15+p.z*.35;
      ctx.beginPath();ctx.arc(x,y,.7+p.z*1.5,0,TAU);ctx.fill();
    }
    ctx.restore();
  }

  drawEmber(ctx,width,height,camera){
    const profile=this.profile;
    ctx.save();
    for(const p of this.particles){
      const {ox,oy}=this.offset(camera,p.z);
      // Embers rise, so the vertical term is negated.
      const rise=1-((p.y+oy+this.time*(.06+p.z*.14))%1);
      const x=((p.x+ox+Math.sin(this.time*1.1+p.seed)*.02)%1+1)%1*width;
      const y=rise*height;
      const pulse=(Math.sin(this.time*3+p.seed)+1)/2;
      ctx.globalAlpha=clamp((.2+p.z*.5)*(.4+pulse*.6),0,1);
      ctx.fillStyle=profile.color||'rgba(255,140,120,.4)';
      ctx.beginPath();ctx.arc(x,y,.8+p.z*1.7,0,TAU);ctx.fill();
    }
    ctx.restore();
  }
}
