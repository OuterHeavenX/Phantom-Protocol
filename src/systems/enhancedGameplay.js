import {PolishedGameplay} from './polishedGameplay.js';

export class EnhancedGameplay extends PolishedGameplay{
  constructor(canvas,ctx,opts){
    super(canvas,ctx,opts);
    this.cameraX=0;
    this.cameraY=0;
    this.distanceTravelled=0;
    this.player.x=canvas.width/2;
    this.player.y=canvas.height/2;
  }

  resize(w,h){
    super.resize(w,h);
    this.player.x=w/2;
    this.player.y=h/2;
  }

  update(dt,input){
    const v=input.vector();
    const mag=Math.hypot(v.x,v.y);
    const neutralInput={vector:()=>({x:0,y:0})};

    super.update(dt,neutralInput);
    if(this.paused||this.ended)return;

    this.player.x=this.canvas.width/2;
    this.player.y=this.canvas.height/2;

    if(mag>.04){
      const dx=v.x*this.player.speed*dt;
      const dy=v.y*this.player.speed*dt;
      this.cameraX+=dx;
      this.cameraY+=dy;
      this.distanceTravelled+=Math.hypot(dx,dy);
      this.player.angle=Math.atan2(v.y,v.x);
      this.scrollWorld(dx,dy);
    }
  }

  scrollWorld(dx,dy){
    for(const e of this.enemies){e.x-=dx;e.y-=dy}
    for(const p of this.projectiles){p.x-=dx;p.y-=dy;p.px-=dx;p.py-=dy}
    for(const q of this.pickups){q.x-=dx;q.y-=dy}
    for(const p of this.particles){p.x-=dx;p.y-=dy}
    if(this.boss){this.boss.x-=dx;this.boss.y-=dy}
    for(const d of this.decor){d.x-=dx;d.y-=dy;this.wrapDecor(d)}
  }

  wrapDecor(d){
    const pad=90,w=this.canvas.width,h=this.canvas.height;
    if(d.x<-pad)d.x+=w+pad*2;
    else if(d.x>w+pad)d.x-=w+pad*2;
    if(d.y<-pad)d.y+=h+pad*2;
    else if(d.y>h+pad)d.y-=h+pad*2;
  }

  drawWorld(c,w,h){
    super.drawWorld(c,w,h);
    const gx=((-(this.cameraX%96))+96)%96;
    const gy=((-(this.cameraY%96))+96)%96;
    c.save();
    c.strokeStyle='rgba(118,231,212,.035)';
    c.lineWidth=1;
    for(let x=gx-96;x<w+96;x+=96){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}
    for(let y=gy-96;y<h+96;y+=96){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}
    c.fillStyle='rgba(117,231,212,.08)';
    c.font='8px monospace';
    const sectorX=((Math.floor(this.cameraX/520)%20)+20)%20;
    const sectorY=((Math.floor(this.cameraY/520)%20)+20)%20;
    c.fillText(`GRID ${String(sectorX).padStart(2,'0')}-${String(sectorY).padStart(2,'0')}`,18,h-74);
    c.restore();
  }
}
