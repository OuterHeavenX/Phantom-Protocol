import {PolishedGameplay} from './polishedGameplay.js';

export class EnhancedGameplay extends PolishedGameplay{
  constructor(canvas,ctx,opts){
    super(canvas,ctx,opts);
    this.cameraX=0;this.cameraY=0;this.distanceTravelled=0;this.spawnCursor=0;this.tacticalSeed=0;
    this.player.x=canvas.width/2;this.player.y=canvas.height/2;
  }
  resize(w,h){super.resize(w,h);this.player.x=w/2;this.player.y=h/2}
  update(dt,input){
    const v=input.vector(),mag=Math.hypot(v.x,v.y),neutral={vector:()=>({x:0,y:0})};
    super.update(dt,neutral);if(this.paused||this.ended)return;
    this.player.x=this.canvas.width/2;this.player.y=this.canvas.height/2;
    if(mag>.04){const dx=v.x*this.player.speed*dt,dy=v.y*this.player.speed*dt;this.cameraX+=dx;this.cameraY+=dy;this.distanceTravelled+=Math.hypot(dx,dy);this.player.angle=Math.atan2(v.y,v.x);this.scrollWorld(dx,dy)}
    this.assignTacticalRoles();this.tacticalSteering(dt);this.cameraAwareDirector(dt);this.player.x=this.canvas.width/2;this.player.y=this.canvas.height/2;
  }
  spawn(){
    super.spawn();const e=this.enemies[this.enemies.length-1];if(!e)return;this.placeAtCameraEdge(e);this.setupTacticalEnemy(e);
  }
  placeAtCameraEdge(e){const w=this.canvas.width,h=this.canvas.height,side=(this.spawnCursor++)%4,margin=48+Math.random()*50,j=.08+Math.random()*.84;if(side===0){e.x=-margin;e.y=h*j}else if(side===1){e.x=w+margin;e.y=h*j}else if(side===2){e.x=w*j;e.y=-margin}else{e.x=w*j;e.y=h+margin}}
  setupTacticalEnemy(e){if(e.tacticalReady)return;e.tacticalReady=true;e.slotAngle=((this.tacticalSeed++*.754877666)%1)*Math.PI*2;e.orbitDir=(this.tacticalSeed%2?1:-1);e.orbitSpeed=.08+Math.random()*.12;e.attackClock=.8+Math.random()*1.8;const t=e.type;if(t==='Longshot Sniper'){e.role='sniper';e.preferredRange=150}else if(t==='Rifle Cell'||t==='Mortar Team'){e.role='ranged';e.preferredRange=105}else if(t==='Pursuit Drone'||t==='Hunter Drone'||t==='Veil Operative'){e.role='flanker';e.preferredRange=78}else if(t==='Shield Trooper'){e.role='shield';e.preferredRange=58}else if(t==='Breacher Heavy'||t==='Augment Marauder'||e.elite){e.role='heavy';e.preferredRange=66}else if(t==='Signal Jammer'){e.role='support';e.preferredRange=118}else{e.role='assault';e.preferredRange=72}}
  assignTacticalRoles(){for(const e of this.enemies)this.setupTacticalEnemy(e)}
  tacticalSteering(dt){
    const p=this.player;for(const e of this.enemies){
      if(e.role==='flanker')e.slotAngle+=e.orbitDir*e.orbitSpeed*dt;else if(e.role==='support')e.slotAngle+=e.orbitDir*.035*dt;
      const targetX=p.x+Math.cos(e.slotAngle)*e.preferredRange,targetY=p.y+Math.sin(e.slotAngle)*e.preferredRange,tx=targetX-e.x,ty=targetY-e.y,td=Math.hypot(tx,ty)||1;
      const steer=e.role==='sniper'?.72:e.role==='ranged'?.82:e.role==='support'?.68:1.05;
      e.x+=tx/td*e.speed*steer*dt;e.y+=ty/td*e.speed*steer*dt;
      const pdx=p.x-e.x,pdy=p.y-e.y;e.angle=Math.atan2(pdy,pdx);
      if(e.role==='sniper'||e.role==='ranged'||e.role==='support')this.rangedPressure(e,dt);
    }
  }
  rangedPressure(e,dt){e.attackClock-=dt;if(e.attackClock>0)return;const d=Math.hypot(e.x-this.player.x,e.y-this.player.y);if(d<70||d>230){e.attackClock=.45;return}const cadence=e.role==='sniper'?2.5:e.role==='support'?2.1:1.65;e.attackClock=cadence+Math.random()*.7;const damage=e.role==='sniper'?4:e.role==='support'?2.5:2;this.player.hp-=Math.max(1,damage-this.player.armor*.16);this.player.hit=.11;this.warningFx(this.player.x,this.player.y)}
  scrollWorld(dx,dy){for(const e of this.enemies){e.x-=dx;e.y-=dy}for(const p of this.projectiles){p.x-=dx;p.y-=dy;p.px-=dx;p.py-=dy}for(const q of this.pickups){q.x-=dx;q.y-=dy}for(const p of this.particles){p.x-=dx;p.y-=dy}if(this.boss){this.boss.x-=dx;this.boss.y-=dy}for(const d of this.decor){d.x-=dx;d.y-=dy;this.wrapDecor(d)}}
  wrapDecor(d){const pad=90,w=this.canvas.width,h=this.canvas.height;if(d.x<-pad)d.x+=w+pad*2;else if(d.x>w+pad)d.x-=w+pad*2;if(d.y<-pad)d.y+=h+pad*2;else if(d.y>h+pad)d.y-=h+pad*2}
  cameraAwareDirector(dt){this.cleanupFarEntities();this.redistributeCrowds(dt);this.limitLocalDensity()}
  cleanupFarEntities(){const w=this.canvas.width,h=this.canvas.height,pad=Math.max(w,h)*.9;this.enemies=this.enemies.filter(e=>e.x>-pad&&e.x<w+pad&&e.y>-pad&&e.y<h+pad);this.pickups=this.pickups.filter(q=>q.x>-pad&&q.x<w+pad&&q.y>-pad&&q.y<h+pad)}
  redistributeCrowds(dt){const es=this.enemies,cell=58,buckets=new Map();for(const e of es){const key=`${Math.floor(e.x/cell)},${Math.floor(e.y/cell)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(e)}for(const group of buckets.values())if(group.length>4){for(let i=0;i<group.length;i++){const e=group[i],a=e.slotAngle+i*.75,r=14+Math.floor(i/5)*10;e.x+=Math.cos(a)*r*dt*3;e.y+=Math.sin(a)*r*dt*3}}for(let i=0;i<es.length;i++){const a=es[i];for(let j=i+1;j<Math.min(es.length,i+32);j++){const b=es[j],dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy)||1,min=(a.r+b.r)*2.15;if(d<min){const push=(min-d)*.2;a.x+=dx/d*push;b.x-=dx/d*push;a.y+=dy/d*push;b.y-=dy/d*push}}}}
  limitLocalDensity(){const p=this.player,w=this.canvas.width,h=this.canvas.height;let close=0;for(const e of this.enemies){const d=Math.hypot(e.x-p.x,e.y-p.y);if(d<125){close++;if(close>18){this.placeAtCameraEdge(e);e.slotAngle+=Math.PI*.7}}}}
  drawWorld(c,w,h){super.drawWorld(c,w,h);const gx=((-(this.cameraX%96))+96)%96,gy=((-(this.cameraY%96))+96)%96;c.save();c.strokeStyle='rgba(118,231,212,.035)';c.lineWidth=1;for(let x=gx-96;x<w+96;x+=96){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}for(let y=gy-96;y<h+96;y+=96){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}c.fillStyle='rgba(117,231,212,.08)';c.font='8px monospace';const sx=((Math.floor(this.cameraX/520)%20)+20)%20,sy=((Math.floor(this.cameraY/520)%20)+20)%20;c.fillText(`GRID ${String(sx).padStart(2,'0')}-${String(sy).padStart(2,'0')}`,18,h-74);c.restore()}
}
