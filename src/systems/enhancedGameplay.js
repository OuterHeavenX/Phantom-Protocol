import {PolishedGameplay} from './polishedGameplay.js';

export class EnhancedGameplay extends PolishedGameplay{
  constructor(canvas,ctx,opts){
    super(canvas,ctx,opts);
    this.cameraX=0;this.cameraY=0;this.distanceTravelled=0;this.spawnCursor=0;
    this.player.x=canvas.width/2;this.player.y=canvas.height/2;
  }
  resize(w,h){super.resize(w,h);this.player.x=w/2;this.player.y=h/2}
  update(dt,input){
    const v=input.vector(),mag=Math.hypot(v.x,v.y),neutral={vector:()=>({x:0,y:0})};
    super.update(dt,neutral);if(this.paused||this.ended)return;
    this.player.x=this.canvas.width/2;this.player.y=this.canvas.height/2;
    if(mag>.04){const dx=v.x*this.player.speed*dt,dy=v.y*this.player.speed*dt;this.cameraX+=dx;this.cameraY+=dy;this.distanceTravelled+=Math.hypot(dx,dy);this.player.angle=Math.atan2(v.y,v.x);this.scrollWorld(dx,dy)}
    this.cameraAwareDirector(dt);this.player.x=this.canvas.width/2;this.player.y=this.canvas.height/2;
  }
  scrollWorld(dx,dy){for(const e of this.enemies){e.x-=dx;e.y-=dy}for(const p of this.projectiles){p.x-=dx;p.y-=dy;p.px-=dx;p.py-=dy}for(const q of this.pickups){q.x-=dx;q.y-=dy}for(const p of this.particles){p.x-=dx;p.y-=dy}if(this.boss){this.boss.x-=dx;this.boss.y-=dy}for(const d of this.decor){d.x-=dx;d.y-=dy;this.wrapDecor(d)}}
  wrapDecor(d){const pad=90,w=this.canvas.width,h=this.canvas.height;if(d.x<-pad)d.x+=w+pad*2;else if(d.x>w+pad)d.x-=w+pad*2;if(d.y<-pad)d.y+=h+pad*2;else if(d.y>h+pad)d.y-=h+pad*2}
  cameraAwareDirector(dt){this.cleanupFarEntities();this.redistributeCrowds(dt);this.limitLocalDensity();}
  cleanupFarEntities(){const w=this.canvas.width,h=this.canvas.height,pad=Math.max(w,h)*.85;this.enemies=this.enemies.filter(e=>e.x>-pad&&e.x<w+pad&&e.y>-pad&&e.y<h+pad);this.pickups=this.pickups.filter(q=>q.x>-pad&&q.x<w+pad&&q.y>-pad&&q.y<h+pad);}
  redistributeCrowds(dt){
    const p=this.player,es=this.enemies,cell=62,buckets=new Map();
    for(const e of es){const key=`${Math.floor(e.x/cell)},${Math.floor(e.y/cell)}`;(buckets.get(key)||buckets.set(key,[]).get(key)).push(e)}
    for(const group of buckets.values())if(group.length>4){for(let i=0;i<group.length;i++){const e=group[i],a=(i/group.length)*Math.PI*2+e.phase,r=18+Math.floor(i/6)*11,targetX=e.x+Math.cos(a)*r,targetY=e.y+Math.sin(a)*r;e.x+=(targetX-e.x)*Math.min(1,dt*4);e.y+=(targetY-e.y)*Math.min(1,dt*4)}}
    for(let i=0;i<es.length;i++){const a=es[i],dx=a.x-p.x,dy=a.y-p.y,d=Math.hypot(dx,dy)||1,personal=p.r+a.r+12;if(d<personal){a.x+=dx/d*(personal-d)*.42;a.y+=dy/d*(personal-d)*.42}for(let j=i+1;j<Math.min(es.length,i+28);j++){const b=es[j],ex=a.x-b.x,ey=a.y-b.y,ed=Math.hypot(ex,ey)||1,min=(a.r+b.r)*2.25;if(ed<min){const push=(min-ed)*.22;a.x+=ex/ed*push;b.x-=ex/ed*push;a.y+=ey/ed*push;b.y-=ey/ed*push}}}
  }
  limitLocalDensity(){
    const p=this.player,w=this.canvas.width,h=this.canvas.height;let close=0;
    for(const e of this.enemies){const d=Math.hypot(e.x-p.x,e.y-p.y);if(d<150){close++;if(close>22)this.redeployToEdge(e,w,h)}}
  }
  redeployToEdge(e,w,h){const side=(this.spawnCursor++)%4,margin=55,jitter=Math.random();if(side===0){e.x=-margin;e.y=jitter*h}else if(side===1){e.x=w+margin;e.y=jitter*h}else if(side===2){e.x=jitter*w;e.y=-margin}else{e.x=jitter*w;e.y=h+margin}}
  spawnEnemy(elite=false){
    super.spawnEnemy(elite);const e=this.enemies[this.enemies.length-1];if(!e)return;const w=this.canvas.width,h=this.canvas.height,side=(this.spawnCursor++)%4,margin=42+Math.random()*42,j=.08+Math.random()*.84;if(side===0){e.x=-margin;e.y=h*j}else if(side===1){e.x=w+margin;e.y=h*j}else if(side===2){e.x=w*j;e.y=-margin}else{e.x=w*j;e.y=h+margin}
  }
  drawWorld(c,w,h){super.drawWorld(c,w,h);const gx=((-(this.cameraX%96))+96)%96,gy=((-(this.cameraY%96))+96)%96;c.save();c.strokeStyle='rgba(118,231,212,.035)';c.lineWidth=1;for(let x=gx-96;x<w+96;x+=96){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}for(let y=gy-96;y<h+96;y+=96){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}c.fillStyle='rgba(117,231,212,.08)';c.font='8px monospace';const sx=((Math.floor(this.cameraX/520)%20)+20)%20,sy=((Math.floor(this.cameraY/520)%20)+20)%20;c.fillText(`GRID ${String(sx).padStart(2,'0')}-${String(sy).padStart(2,'0')}`,18,h-74);c.restore()}
}
