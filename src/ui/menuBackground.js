import {TAU} from '../core/math.js';

// Animated tactical-display background for the menu shell. Runs on its own
// canvas behind the UI and stops itself when the menu is torn down.
export class MenuBackground{
  constructor(canvas){
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d');
    this.time=0;
    this.running=true;
    this.blips=[];
    this.contacts=[];
    this.raf=0;
    this.resize();
    this.seed();
    this.onResize=()=>this.resize();
    window.addEventListener('resize',this.onResize,{passive:true});
    this.loop(performance.now());
  }

  resize(){
    const rect=this.canvas.getBoundingClientRect();
    const dpr=Math.min(2,window.devicePixelRatio||1);
    this.canvas.width=Math.max(1,Math.floor(rect.width*dpr));
    this.canvas.height=Math.max(1,Math.floor(rect.height*dpr));
    this.dpr=dpr;
  }

  seed(){
    this.blips=Array.from({length:26},()=>({
      x:Math.random(),y:Math.random(),
      size:.5+Math.random()*2,
      speed:.004+Math.random()*.02,
      angle:Math.random()*TAU,
      pulse:Math.random()*TAU
    }));
    this.contacts=Array.from({length:7},()=>({
      angle:Math.random()*TAU,
      radius:.2+Math.random()*.7,
      speed:(Math.random()-.5)*.14
    }));
  }

  loop(now){
    if(!this.running)return;
    const dt=Math.min(.05,(now-(this.last||now))/1000);
    this.last=now;
    this.time+=dt;
    this.draw(dt);
    this.raf=requestAnimationFrame(t=>this.loop(t));
  }

  draw(dt){
    const ctx=this.ctx;
    const w=this.canvas.width;
    const h=this.canvas.height;
    const scale=this.dpr;

    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,w,h);
    ctx.scale(scale,scale);
    const width=w/scale,height=h/scale;

    // Grid.
    ctx.strokeStyle='rgba(118,231,212,.055)';
    ctx.lineWidth=1;
    const spacing=42;
    const drift=(this.time*8)%spacing;
    ctx.beginPath();
    for(let x=-spacing+drift;x<width+spacing;x+=spacing){
      ctx.moveTo(x,0);ctx.lineTo(x,height);
    }
    for(let y=-spacing+drift;y<height+spacing;y+=spacing){
      ctx.moveTo(0,y);ctx.lineTo(width,y);
    }
    ctx.stroke();

    // Radar sweep centred on the panel.
    const cx=width*.5,cy=height*.5;
    const maxRadius=Math.hypot(width,height)*.45;
    const sweep=this.time*.85%TAU;

    ctx.save();
    ctx.translate(cx,cy);
    const gradient=ctx.createConicGradient?ctx.createConicGradient(sweep,0,0):null;
    if(gradient){
      gradient.addColorStop(0,'rgba(118,231,212,.18)');
      gradient.addColorStop(.08,'rgba(118,231,212,.02)');
      gradient.addColorStop(1,'rgba(118,231,212,0)');
      ctx.fillStyle=gradient;
      ctx.beginPath();ctx.arc(0,0,maxRadius,0,TAU);ctx.fill();
    }
    // Sweep line.
    ctx.strokeStyle='rgba(118,231,212,.35)';
    ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(Math.cos(sweep)*maxRadius,Math.sin(sweep)*maxRadius);
    ctx.stroke();

    // Range rings.
    ctx.strokeStyle='rgba(118,231,212,.14)';
    ctx.lineWidth=1;
    for(let i=1;i<=4;i++){
      ctx.beginPath();ctx.arc(0,0,maxRadius*i/4,0,TAU);ctx.stroke();
    }

    // Tracked contacts orbiting the centre.
    for(const contact of this.contacts){
      contact.angle+=contact.speed*dt;
      const x=Math.cos(contact.angle)*maxRadius*contact.radius;
      const y=Math.sin(contact.angle)*maxRadius*contact.radius;
      // Brighten as the sweep passes over.
      let delta=Math.abs(((contact.angle-sweep+Math.PI)%TAU+TAU)%TAU-Math.PI);
      const brightness=Math.max(.15,1-delta*1.6);
      ctx.fillStyle=`rgba(255,140,120,${brightness*.8})`;
      ctx.fillRect(x-2.5,y-2.5,5,5);
      if(brightness>.5){
        ctx.strokeStyle=`rgba(255,140,120,${(brightness-.5)*.7})`;
        ctx.lineWidth=1;
        ctx.strokeRect(x-7,y-7,14,14);
      }
    }
    ctx.restore();

    // Drifting data blips.
    for(const blip of this.blips){
      blip.x+=Math.cos(blip.angle)*blip.speed*dt;
      blip.y+=Math.sin(blip.angle)*blip.speed*dt;
      if(blip.x<0)blip.x+=1;if(blip.x>1)blip.x-=1;
      if(blip.y<0)blip.y+=1;if(blip.y>1)blip.y-=1;
      blip.pulse+=dt*2;
      const alpha=.1+Math.abs(Math.sin(blip.pulse))*.18;
      ctx.fillStyle=`rgba(118,231,212,${alpha})`;
      ctx.fillRect(blip.x*width,blip.y*height,blip.size,blip.size);
    }

    // Horizontal scan line.
    const scanY=((this.time*.16)%1)*height;
    const scanGradient=ctx.createLinearGradient(0,scanY-40,0,scanY+40);
    scanGradient.addColorStop(0,'rgba(118,231,212,0)');
    scanGradient.addColorStop(.5,'rgba(118,231,212,.05)');
    scanGradient.addColorStop(1,'rgba(118,231,212,0)');
    ctx.fillStyle=scanGradient;
    ctx.fillRect(0,scanY-40,width,80);
  }

  destroy(){
    this.running=false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize',this.onResize);
  }
}
