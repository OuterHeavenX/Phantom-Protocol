import {PolishedGameplay} from './polishedGameplay.js';

export class EnhancedGameplay extends PolishedGameplay{
  constructor(canvas,ctx,opts){
    super(canvas,ctx,opts);
    this.cameraX=0;this.cameraY=0;this.distanceTravelled=0;this.spawnCursor=0;this.tacticalSeed=0;
    this.scrambleCooldown=0;this.scrambleActive=0;this.scramblePulse=0;this.scrambleUnlocked=true;
    this.obstacles=[];this.generateSector();this.player.x=canvas.width/2;this.player.y=canvas.height/2;
    this.waveIndex=0;this.waveState='lull';this.waveLull=2.4;this.waveRemaining=0;this.waveSpawnClock=0;this.waveAge=0;this.waveStartAlive=0;
  }
  resize(w,h){super.resize(w,h);this.player.x=w/2;this.player.y=h/2}
  generateSector(){const w=this.canvas.width,h=this.canvas.height;this.obstacles=[];const add=(x,y,wid,hei,type,hp=0)=>this.obstacles.push({x,y,w:wid,h:hei,type,hp,maxHp:hp,broken:false});add(w*.18,h*.30,130,22,'wall');add(w*.72,h*.24,22,155,'wall');add(w*.58,h*.62,150,22,'breakable',55);add(w*.22,h*.72,92,72,'machinery');add(w*.78,h*.76,108,62,'machinery');add(w*.38,h*.48,78,58,'hide');add(w*.83,h*.43,72,72,'hide');add(w*.48,h*.82,118,20,'breakable',45)}
  update(dt,input){
    const v=input.vector(),mag=Math.hypot(v.x,v.y),neutral={vector:()=>({x:0,y:0})};
    const before=new Map(this.enemies.map(e=>[e,{x:e.x,y:e.y}]));
    this.spawnClock=999;super.update(dt,neutral);if(this.paused||this.ended)return;
    for(const [e,pos] of before){if(this.enemies.includes(e)){e.x=pos.x;e.y=pos.y}}
    this.scrambleCooldown=Math.max(0,this.scrambleCooldown-dt);this.scrambleActive=Math.max(0,this.scrambleActive-dt);this.scramblePulse=Math.max(0,this.scramblePulse-dt);
    this.player.x=this.canvas.width/2;this.player.y=this.canvas.height/2;
    if(mag>.04){const dx=v.x*this.player.speed*dt,dy=v.y*this.player.speed*dt;if(!this.playerBlocked(dx,dy)){this.cameraX+=dx;this.cameraY+=dy;this.distanceTravelled+=Math.hypot(dx,dy);this.player.angle=Math.atan2(v.y,v.x);this.scrollWorld(dx,dy)}}
    this.updateReinforcements(dt);this.assignTacticalRoles();this.tacticalSteering(dt);this.obstacleInteractions(dt);this.cameraAwareDirector(dt);this.player.x=this.canvas.width/2;this.player.y=this.canvas.height/2;
  }
  updateReinforcements(dt){
    if(this.boss)return;
    if(this.waveState==='lull'){this.waveLull-=dt;if(this.waveLull<=0)this.beginWave();return}
    this.waveAge+=dt;this.waveSpawnClock-=dt;
    const cap=this.activeEnemyCap();
    if(this.waveRemaining>0&&this.waveSpawnClock<=0&&this.enemies.length<cap){this.spawnWaveEnemy();this.waveRemaining--;this.waveSpawnClock=.32+Math.random()*.42}
    const deployed=this.waveRemaining<=0,cleared=this.enemies.length<=Math.max(2,Math.floor(this.waveStartAlive*.28)),timeout=this.waveAge>14+Math.min(10,this.waveIndex*1.2);
    if(deployed&&(cleared||timeout))this.endWave();
  }
  beginWave(){
    this.waveIndex++;this.waveState='deploying';this.waveAge=0;this.waveSpawnClock=.1;
    const minute=this.elapsed/60,base=5+Math.min(10,Math.floor(minute*2.1)),growth=Math.min(12,Math.floor(this.waveIndex*.8)),difficulty=Math.round((this.opts.difficulty||0)*2);
    this.waveRemaining=Math.min(30,base+growth+difficulty+Math.floor(Math.random()*3));this.waveStartAlive=this.waveRemaining;
  }
  endWave(){this.waveState='lull';this.waveRemaining=0;this.waveAge=0;const phase=this.elapsed/(this.opts.duration*60);this.waveLull=Math.max(3.5,7.5-phase*2.5)+(Math.random()*2.5)}
  activeEnemyCap(){const phase=this.elapsed/(this.opts.duration*60);if(phase<.16)return 14;if(phase<.38)return 22;if(phase<.68)return 32;return this.opts.performance?38:46}
  spawnWaveEnemy(){super.spawn();const e=this.enemies[this.enemies.length-1];if(!e)return;this.placeAtCameraEdge(e);this.setupTacticalEnemy(e)}
  playerBlocked(dx,dy){const px=this.player.x,py=this.player.y;for(const o of this.obstacles){if(o.broken||o.type==='hide')continue;const nx=px+dx,ny=py+dy;if(nx>o.x-o.w/2-13&&nx<o.x+o.w/2+13&&ny>o.y-o.h/2-13&&ny<o.y+o.h/2+13)return true}return false}
  activateScramble(){if(!this.scrambleUnlocked||this.scrambleCooldown>0||this.paused||this.ended)return false;this.scrambleCooldown=18;this.scrambleActive=4.5;this.scramblePulse=.65;for(const e of this.enemies){const d=Math.hypot(e.x-this.player.x,e.y-this.player.y);if(d<250){e.confused=4+Math.random()*2.5;e.slotAngle+=Math.PI*(.5+Math.random()*1.5);e.orbitDir*=-1}}return true}
  placeAtCameraEdge(e){const w=this.canvas.width,h=this.canvas.height,side=(this.spawnCursor++)%4,margin=48+Math.random()*50,j=.08+Math.random()*.84;if(side===0){e.x=-margin;e.y=h*j}else if(side===1){e.x=w+margin;e.y=h*j}else if(side===2){e.x=w*j;e.y=-margin}else{e.x=w*j;e.y=h+margin}}
  setupTacticalEnemy(e){if(e.tacticalReady)return;e.tacticalReady=true;e.slotAngle=((this.tacticalSeed++*.754877666)%1)*Math.PI*2;e.orbitDir=(this.tacticalSeed%2?1:-1);e.orbitSpeed=.08+Math.random()*.12;e.attackClock=.8+Math.random()*1.8;const t=e.type;if(t==='Longshot Sniper'){e.role='sniper';e.preferredRange=150}else if(t==='Rifle Cell'||t==='Mortar Team'){e.role='ranged';e.preferredRange=105}else if(t==='Pursuit Drone'||t==='Hunter Drone'||t==='Veil Operative'){e.role='flanker';e.preferredRange=78}else if(t==='Shield Trooper'){e.role='shield';e.preferredRange=58}else if(t==='Breacher Heavy'||t==='Augment Marauder'||e.elite){e.role='heavy';e.preferredRange=66}else if(t==='Signal Jammer'){e.role='support';e.preferredRange=118}else{e.role='assault';e.preferredRange=72}}
  assignTacticalRoles(){for(const e of this.enemies)this.setupTacticalEnemy(e)}
  tacticalSteering(dt){const p=this.player;for(const e of this.enemies){if(e.confused>0){e.confused-=dt;const a=e.slotAngle+this.elapsed*e.orbitDir*1.6;e.x+=Math.cos(a)*e.speed*.72*dt;e.y+=Math.sin(a)*e.speed*.72*dt;e.angle=a;continue}if(e.role==='flanker')e.slotAngle+=e.orbitDir*e.orbitSpeed*dt;else if(e.role==='support')e.slotAngle+=e.orbitDir*.035*dt;const targetX=p.x+Math.cos(e.slotAngle)*e.preferredRange,targetY=p.y+Math.sin(e.slotAngle)*e.preferredRange,tx=targetX-e.x,ty=targetY-e.y,td=Math.hypot(tx,ty)||1;const steer=e.role==='sniper'?.68:e.role==='ranged'?.76:e.role==='support'?.64:e.role==='flanker'?1:.9;e.x+=tx/td*e.speed*steer*dt;e.y+=ty/td*e.speed*steer*dt;e.angle=Math.atan2(p.y-e.y,p.x-e.x);if(e.role==='sniper'||e.role==='ranged'||e.role==='support')this.rangedPressure(e,dt)}}
  rangedPressure(e,dt){e.attackClock-=dt;if(e.attackClock>0)return;const d=Math.hypot(e.x-this.player.x,e.y-this.player.y);if(d<70||d>230){e.attackClock=.45;return}e.attackClock=(e.role==='sniper'?2.5:e.role==='support'?2.1:1.65)+Math.random()*.7;const damage=e.role==='sniper'?4:e.role==='support'?2.5:2;this.player.hp-=Math.max(1,damage-this.player.armor*.16);this.player.hit=.11;this.warningFx(this.player.x,this.player.y)}
  obstacleInteractions(dt){for(const e of this.enemies){for(const o of this.obstacles){if(o.broken||o.type==='hide')continue;const dx=e.x-o.x,dy=e.y-o.y,ox=o.w/2+e.r-Math.abs(dx),oy=o.h/2+e.r-Math.abs(dy);if(ox>0&&oy>0){if(o.type==='breakable'&&(e.role==='heavy'||e.elite)){o.hp-=20*dt;if(o.hp<=0){o.broken=true;this.burstFx(o.x,o.y,14)}}else if(ox<oy)e.x+=Math.sign(dx||1)*ox;else e.y+=Math.sign(dy||1)*oy}}}}
  scrollWorld(dx,dy){for(const e of this.enemies){e.x-=dx;e.y-=dy}for(const p of this.projectiles){p.x-=dx;p.y-=dy;p.px-=dx;p.py-=dy}for(const q of this.pickups){q.x-=dx;q.y-=dy}for(const p of this.particles){p.x-=dx;p.y-=dy}if(this.boss){this.boss.x-=dx;this.boss.y-=dy}for(const d of this.decor){d.x-=dx;d.y-=dy;this.wrapDecor(d)}for(const o of this.obstacles){o.x-=dx;o.y-=dy;this.wrapObstacle(o)}}
  wrapDecor(d){const pad=90,w=this.canvas.width,h=this.canvas.height;if(d.x<-pad)d.x+=w+pad*2;else if(d.x>w+pad)d.x-=w+pad*2;if(d.y<-pad)d.y+=h+pad*2;else if(d.y>h+pad)d.y-=h+pad*2}
  wrapObstacle(o){const pad=180,w=this.canvas.width,h=this.canvas.height;if(o.x<-pad)o.x+=w+pad*2;else if(o.x>w+pad)o.x-=w+pad*2;if(o.y<-pad)o.y+=h+pad*2;else if(o.y>h+pad)o.y-=h+pad*2}
  cameraAwareDirector(dt){this.cleanupFarEntities();this.redistributeCrowds(dt);this.limitLocalDensity()}
  cleanupFarEntities(){const w=this.canvas.width,h=this.canvas.height,pad=Math.max(w,h)*.9;this.enemies=this.enemies.filter(e=>e.x>-pad&&e.x<w+pad&&e.y>-pad&&e.y<h+pad);this.pickups=this.pickups.filter(q=>q.x>-pad&&q.x<w+pad&&q.y>-pad&&q.y<h+pad)}
  redistributeCrowds(dt){const es=this.enemies,cell=58,buckets=new Map();for(const e of es){const key=`${Math.floor(e.x/cell)},${Math.floor(e.y/cell)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(e)}for(const group of buckets.values())if(group.length>4){for(let i=0;i<group.length;i++){const e=group[i],a=e.slotAngle+i*.75,r=14+Math.floor(i/5)*10;e.x+=Math.cos(a)*r*dt*3;e.y+=Math.sin(a)*r*dt*3}}}
  limitLocalDensity(){const p=this.player;let close=0;for(const e of this.enemies){if(Math.hypot(e.x-p.x,e.y-p.y)<125&&++close>18){this.placeAtCameraEdge(e);e.slotAngle+=Math.PI*.7}}}
  drawWorld(c,w,h){super.drawWorld(c,w,h);const gx=((-(this.cameraX%96))+96)%96,gy=((-(this.cameraY%96))+96)%96;c.save();c.strokeStyle='rgba(118,231,212,.035)';for(let x=gx-96;x<w+96;x+=96){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}for(let y=gy-96;y<h+96;y+=96){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}this.drawObstacles(c);if(this.scrambleActive>0){const r=70+(1-this.scramblePulse/.65)*190;c.strokeStyle=`rgba(115,245,229,${Math.max(.05,this.scramblePulse)})`;c.lineWidth=2;c.beginPath();c.arc(this.player.x,this.player.y,r,0,Math.PI*2);c.stroke()}c.fillStyle='rgba(117,231,212,.08)';c.font='8px monospace';const sx=((Math.floor(this.cameraX/520)%20)+20)%20,sy=((Math.floor(this.cameraY/520)%20)+20)%20;c.fillText(`GRID ${String(sx).padStart(2,'0')}-${String(sy).padStart(2,'0')}`,18,h-74);c.restore()}
  drawObstacles(c){for(const o of this.obstacles){if(o.broken)continue;c.save();c.translate(o.x,o.y);if(o.type==='wall'){c.fillStyle='#182d32';c.strokeStyle='#66878a';c.fillRect(-o.w/2,-o.h/2,o.w,o.h);c.strokeRect(-o.w/2,-o.h/2,o.w,o.h);for(let x=-o.w/2+8;x<o.w/2;x+=18){c.fillStyle='rgba(130,180,180,.12)';c.fillRect(x,-o.h/2+3,9,o.h-6)}}else if(o.type==='breakable'){c.fillStyle='#493c2c';c.strokeStyle='#c6a45e';c.fillRect(-o.w/2,-o.h/2,o.w,o.h);c.strokeRect(-o.w/2,-o.h/2,o.w,o.h);c.strokeStyle='rgba(255,207,110,.45)';c.beginPath();c.moveTo(-o.w*.25,-o.h/2);c.lineTo(0,o.h/2);c.lineTo(o.w*.2,-o.h/2);c.stroke()}else if(o.type==='machinery'){c.fillStyle='#10252b';c.strokeStyle='#4f7378';c.fillRect(-o.w/2,-o.h/2,o.w,o.h);c.strokeRect(-o.w/2,-o.h/2,o.w,o.h);c.fillStyle='#73e7d4';c.fillRect(-o.w/2+8,-o.h/2+8,6,3);c.fillStyle='#263e43';for(let y=-o.h/2+16;y<o.h/2-5;y+=10)c.fillRect(-o.w/2+8,y,o.w-16,3)}else{c.fillStyle='rgba(2,8,11,.72)';c.strokeStyle='rgba(92,148,151,.38)';c.fillRect(-o.w/2,-o.h/2,o.w,o.h);c.strokeRect(-o.w/2,-o.h/2,o.w,o.h);c.fillStyle='rgba(115,231,212,.18)';c.font='7px monospace';c.fillText('COVER',-16,2)}c.restore()}}
}
