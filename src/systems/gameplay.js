import {WEAPONS} from '../../data/weapons.js';
import {ENEMIES,ELITES,BOSSES} from '../../data/content.js';

const ENEMY_STYLE={
  'Patrol Scout':{kind:'soldier',accent:'#91a8ad',scale:.92},
  'Rifle Cell':{kind:'rifle',accent:'#a7b8b9',scale:1},
  'Shield Trooper':{kind:'shield',accent:'#c7a977',scale:1.08},
  'Pursuit Drone':{kind:'drone',accent:'#82d0d8',scale:.82},
  'Hunter Drone':{kind:'hunter',accent:'#e2b26f',scale:.9},
  'Longshot Sniper':{kind:'sniper',accent:'#c58ea8',scale:.95},
  'Breacher Heavy':{kind:'heavy',accent:'#cb8d6c',scale:1.22},
  'Signal Jammer':{kind:'jammer',accent:'#9d8bc8',scale:1.05},
  'Crawler Robot':{kind:'crawler',accent:'#789ba3',scale:1.15},
  'Veil Operative':{kind:'veil',accent:'#8799a6',scale:.95},
  'Augment Marauder':{kind:'augment',accent:'#d26e62',scale:1.16},
  'Mortar Team':{kind:'mortar',accent:'#bfa672',scale:1.08}
};

const ELITE_STYLE={
  'Null Hunter':{kind:'hunter',accent:'#ff6d65'},
  'Iron Vicar':{kind:'heavy',accent:'#ff8b68'},
  'Signal Warden':{kind:'jammer',accent:'#c895ff'},
  'Glass Hound':{kind:'crawler',accent:'#77e6ff'},
  'Red Auditor':{kind:'rifle',accent:'#ff535b'}
};

export class Gameplay{
constructor(canvas,ctx,opts){
  this.canvas=canvas;this.ctx=ctx;this.opts=opts;this.time=opts.duration*60;this.elapsed=0;this.spawnClock=0;this.fireClock=0;
  this.level=1;this.xp=0;this.xpNeed=18;this.kills=0;this.currency=0;this.jp=0;this.paused=false;this.ended=false;
  this.extraction=false;this.extractTimer=12;this.player={x:canvas.width/2,y:canvas.height/2,r:12,hp:opts.hp,maxHp:opts.hp,speed:opts.speed,armor:opts.armor||0,angle:-Math.PI/2,hit:0};
  this.enemies=[];this.projectiles=[];this.pickups=[];this.particles=[];this.tracers=[];this.weapons=[{...WEAPONS.find(w=>w.id===opts.weapon),level:1}];
  this.boss=null;this.onLevel=()=>{};this.onEnd=()=>{};this.onBoss=()=>{};this.decor=this.buildDecor();
}
resize(w,h){this.canvas.width=w;this.canvas.height=h;this.player.x=Math.max(24,Math.min(w-24,this.player.x));this.player.y=Math.max(24,Math.min(h-24,this.player.y));this.decor=this.buildDecor()}
buildDecor(){
  const w=this.canvas.width||innerWidth,h=this.canvas.height||innerHeight,seed=this.opts.duration*17+(this.opts.mapColor||'').length*31;
  const items=[];for(let i=0;i<18;i++){const x=((i*137+seed*11)%1000)/1000*w,y=((i*251+seed*7)%1000)/1000*h;items.push({x,y,w:24+(i%4)*13,h:12+(i%3)*7,t:i%5})}return items;
}
spawn(){
  const phase=this.elapsed/(this.opts.duration*60),elite=Math.random()<Math.max(0,(phase-.18)*.06),angle=Math.random()*Math.PI*2;
  const dist=Math.max(this.canvas.width,this.canvas.height)*.62+90,x=this.player.x+Math.cos(angle)*dist,y=this.player.y+Math.sin(angle)*dist;
  const type=elite?ELITES[Math.floor(Math.random()*ELITES.length)]:ENEMIES[Math.min(ENEMIES.length-1,Math.floor(phase*ENEMIES.length))];
  const hp=(elite?130:24)*(1+phase*4)*(1+(this.opts.difficulty||0)*.24);this.enemies.push({x,y,r:elite?16:10,hp,maxHp:hp,speed:(elite?74:55)+phase*38,type,elite,flash:0,angle:0,phase:Math.random()*10})
}
spawnBoss(){
  if(this.boss)return;const name=BOSSES[Math.min(BOSSES.length-1,Math.floor((this.opts.duration-5)/10))],hp=1600+this.opts.duration*90;
  this.boss={x:this.player.x+340,y:this.player.y-240,r:48,hp,maxHp:hp,name,phase:1,shot:0,flash:0};this.onBoss(this.boss)
}
update(dt,input){
  if(this.paused||this.ended)return;this.elapsed+=dt;this.player.hit=Math.max(0,this.player.hit-dt);
  if(!this.extraction){this.time=Math.max(0,this.time-dt);if(this.time<=0){this.extraction=true;this.extractTimer=10}}else{this.extractTimer-=dt;if(this.extractTimer<=0){this.ended=true;this.onEnd(true);return}}
  const v=input.vector(),mag=Math.hypot(v.x,v.y);if(mag>.08)this.player.angle=Math.atan2(v.y,v.x);this.player.x+=v.x*this.player.speed*dt;this.player.y+=v.y*this.player.speed*dt;
  this.player.x=Math.max(20,Math.min(this.canvas.width-20,this.player.x));this.player.y=Math.max(20,Math.min(this.canvas.height-20,this.player.y));
  const phase=this.elapsed/(this.opts.duration*60);this.spawnClock-=dt;const maxEnemies=this.opts.performance?90:180;if(this.spawnClock<=0&&this.enemies.length<maxEnemies){this.spawn();this.spawnClock=Math.max(.08,.62-phase*.48)/(1+(this.opts.difficulty||0)*.18)}
  if(!this.boss&&this.time<Math.min(55,this.opts.duration*60*.12))this.spawnBoss();this.fireClock-=dt;if(this.fireClock<=0){this.fire();this.fireClock=this.weapons[0].cooldown*Math.pow(.93,this.weapons[0].level-1)}
  for(const p of this.projectiles){p.px=p.x;p.py=p.y;p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt}this.projectiles=this.projectiles.filter(p=>p.life>0);
  for(const e of this.enemies){const dx=this.player.x-e.x,dy=this.player.y-e.y,m=Math.hypot(dx,dy)||1;e.angle=Math.atan2(dy,dx);e.x+=dx/m*e.speed*dt;e.y+=dy/m*e.speed*dt;e.flash=Math.max(0,e.flash-dt);e.phase+=dt;if(m<e.r+this.player.r){this.player.hp-=Math.max(1,10-this.player.armor)*dt;this.player.hit=.08;if(this.player.hp<=0){this.ended=true;this.onEnd(false);return}}}
  for(const p of this.projectiles){for(const e of this.enemies){if(e.hp<=0)continue;if(Math.hypot(p.x-e.x,p.y-e.y)<p.r+e.r){e.hp-=p.damage;e.flash=.09;p.life=0;this.hitFx(e.x,e.y,e.elite);if(e.hp<=0)this.kill(e)}}if(this.boss&&Math.hypot(p.x-this.boss.x,p.y-this.boss.y)<p.r+this.boss.r){this.boss.hp-=p.damage;this.boss.flash=.08;p.life=0;this.hitFx(p.x,p.y,true);if(this.boss.hp<=0){this.jp+=25;this.currency+=180;this.burstFx(this.boss.x,this.boss.y,26);this.boss=null}}}
  this.enemies=this.enemies.filter(e=>e.hp>0);
  for(const q of this.pickups){if(Math.hypot(q.x-this.player.x,q.y-this.player.y)<90){const dx=this.player.x-q.x,dy=this.player.y-q.y,m=Math.hypot(dx,dy)||1;q.x+=dx/m*360*dt;q.y+=dy/m*360*dt}if(Math.hypot(q.x-this.player.x,q.y-this.player.y)<18){q.dead=true;this.addXP(q.value);this.pickupFx(q.x,q.y)}}this.pickups=this.pickups.filter(q=>!q.dead);
  if(this.boss){this.boss.flash=Math.max(0,this.boss.flash-dt);const dx=this.player.x-this.boss.x,dy=this.player.y-this.boss.y,m=Math.hypot(dx,dy)||1;this.boss.x+=dx/m*32*dt;this.boss.y+=dy/m*32*dt;this.boss.shot-=dt;if(this.boss.shot<=0){this.boss.shot=1.5;this.player.hp-=Math.max(2,16-this.player.armor);this.player.hit=.16;this.warningFx(this.player.x,this.player.y)}}
  for(const p of this.particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;p.vx*=.96;p.vy*=.96}this.particles=this.particles.filter(p=>p.life>0);
}
fire(){
  let target=null,best=Infinity;for(const e of this.enemies){const d=(e.x-this.player.x)**2+(e.y-this.player.y)**2;if(d<best){best=d;target=e}}if(!target&&this.boss)target=this.boss;if(!target)return;
  const dx=target.x-this.player.x,dy=target.y-this.player.y,m=Math.hypot(dx,dy)||1;this.player.angle=Math.atan2(dy,dx);const count=this.weapons[0].level>=3?2:1;
  for(let i=0;i<count;i++){const spread=(i-(count-1)/2)*.12,a=Math.atan2(dy,dx)+spread,sx=this.player.x+Math.cos(a)*15,sy=this.player.y+Math.sin(a)*15;this.projectiles.push({x:sx,y:sy,px:sx,py:sy,vx:Math.cos(a)*520,vy:Math.sin(a)*520,r:3,damage:this.weapons[0].damage*(1+(this.weapons[0].level-1)*.2),life:1.3});this.muzzleFx(sx,sy,a)}}
kill(e){this.kills++;this.currency+=e.elite?8:1;if(e.elite)this.jp+=3;this.pickups.push({x:e.x,y:e.y,r:e.elite?7:5,value:e.elite?7:2,phase:Math.random()*6});this.burstFx(e.x,e.y,e.elite?12:6)}
addXP(v){this.xp+=v;while(this.xp>=this.xpNeed){this.xp-=this.xpNeed;this.level++;this.xpNeed=Math.floor(this.xpNeed*1.17+5);this.paused=true;this.onLevel(this.level);break}}
upgrade(kind){if(kind==='weapon')this.weapons[0].level=Math.min(8,this.weapons[0].level+1);if(kind==='speed')this.player.speed*=1.09;if(kind==='armor')this.player.armor+=1;if(kind==='heal')this.player.hp=Math.min(this.player.maxHp,this.player.hp+28);this.paused=false}
muzzleFx(x,y,a){for(let i=0;i<3;i++){this.particles.push({x,y,vx:Math.cos(a+(Math.random()-.5)*.7)*(90+Math.random()*80),vy:Math.sin(a+(Math.random()-.5)*.7)*(90+Math.random()*80),life:.12+Math.random()*.08,size:2+Math.random()*2,color:'#ffe08a'})}}
hitFx(x,y,elite=false){for(let i=0;i<(elite?7:4);i++){const a=Math.random()*Math.PI*2,s=30+Math.random()*90;this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.18+Math.random()*.18,size:1+Math.random()*2,color:elite?'#ff8b68':'#d5f0ef'})}}
burstFx(x,y,n){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=25+Math.random()*130;this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.25+Math.random()*.35,size:1+Math.random()*3,color:i%3?'#a7b8b9':'#ff8769'})}}
pickupFx(x,y){for(let i=0;i<5;i++){const a=Math.random()*Math.PI*2,s=30+Math.random()*55;this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.2,size:2,color:'#76e7d4'})}}
warningFx(x,y){for(let i=0;i<8;i++){const a=i/8*Math.PI*2;this.particles.push({x,y,vx:Math.cos(a)*100,vy:Math.sin(a)*100,life:.3,size:2,color:'#ff6464'})}}

draw(){
  const c=this.ctx,w=this.canvas.width,h=this.canvas.height;this.drawWorld(c,w,h);for(const q of this.pickups)this.drawPickup(c,q);for(const p of this.projectiles)this.drawProjectile(c,p);for(const e of this.enemies)this.drawEnemy(c,e);if(this.boss)this.drawBoss(c,this.boss);for(const p of this.particles)this.drawParticle(c,p);this.drawPlayer(c,this.player);if(this.extraction)this.drawExtraction(c,w*.84,h*.22)
}
drawWorld(c,w,h){
  c.fillStyle=this.opts.mapColor||'#10262d';c.fillRect(0,0,w,h);
  const grd=c.createRadialGradient(w*.5,h*.5,0,w*.5,h*.5,Math.max(w,h)*.7);grd.addColorStop(0,'rgba(18,48,55,.08)');grd.addColorStop(1,'rgba(0,4,8,.44)');c.fillStyle=grd;c.fillRect(0,0,w,h);
  c.strokeStyle='rgba(118,231,212,.045)';c.lineWidth=1;for(let x=0;x<w;x+=72){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}for(let y=0;y<h;y+=72){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}
  for(const d of this.decor){c.save();c.translate(d.x,d.y);c.fillStyle=d.t===0?'rgba(5,12,16,.42)':'rgba(5,15,19,.24)';c.strokeStyle='rgba(130,176,181,.10)';if(d.t===0){c.fillRect(-d.w/2,-d.h/2,d.w,d.h);c.strokeRect(-d.w/2,-d.h/2,d.w,d.h)}else if(d.t===1){c.beginPath();c.arc(0,0,d.w*.28,0,Math.PI*2);c.fill();c.stroke()}else{c.beginPath();c.moveTo(-d.w/2,0);c.lineTo(d.w/2,0);c.stroke();c.beginPath();c.moveTo(0,-d.h);c.lineTo(0,d.h);c.stroke()}c.restore()}
  c.fillStyle='rgba(255,255,255,.018)';for(let i=0;i<10;i++){const x=(i*173+this.elapsed*3)%w,y=(i*97)%h;c.fillRect(x,y,2,2)}
}
drawPickup(c,q){const pulse=1+Math.sin(this.elapsed*6+q.phase)*.12;c.save();c.translate(q.x,q.y);c.rotate(Math.PI/4);c.shadowColor='#76e7d4';c.shadowBlur=10;c.fillStyle='rgba(118,231,212,.16)';c.fillRect(-8*pulse,-8*pulse,16*pulse,16*pulse);c.shadowBlur=4;c.fillStyle='#8ffff0';c.fillRect(-4*pulse,-4*pulse,8*pulse,8*pulse);c.restore()}
drawProjectile(c,p){c.save();c.strokeStyle='rgba(255,225,137,.35)';c.lineWidth=2;c.beginPath();c.moveTo(p.px,p.py);c.lineTo(p.x,p.y);c.stroke();c.fillStyle='#fff1b0';c.shadowColor='#ffd268';c.shadowBlur=7;c.beginPath();c.arc(p.x,p.y,p.r,0,Math.PI*2);c.fill();c.restore()}
drawEnemy(c,e){
  const style=e.elite?(ELITE_STYLE[e.type]||{kind:'rifle',accent:'#ff7568'}):(ENEMY_STYLE[e.type]||{kind:'soldier',accent:'#9ab1b5',scale:1}),s=(style.scale||1)*(e.elite?1.12:1),a=e.angle;
  c.save();c.translate(e.x,e.y);c.rotate(a);c.shadowColor='rgba(0,0,0,.65)';c.shadowBlur=5;c.shadowOffsetY=4;
  const body=e.flash?'#f5ffff':e.elite?'#5b2426':'#35464b';c.fillStyle=body;c.strokeStyle=style.accent;c.lineWidth=e.elite?2:1;
  if(style.kind==='drone'||style.kind==='hunter'){c.beginPath();c.moveTo(13*s,0);c.lineTo(2*s,-9*s);c.lineTo(-12*s,-6*s);c.lineTo(-8*s,0);c.lineTo(-12*s,6*s);c.lineTo(2*s,9*s);c.closePath();c.fill();c.stroke();c.fillStyle=style.accent;c.fillRect(-2*s,-2*s,7*s,4*s)}
  else if(style.kind==='crawler'){c.fillRect(-10*s,-7*s,20*s,14*s);c.strokeRect(-10*s,-7*s,20*s,14*s);c.strokeStyle=style.accent;for(const yy of[-7,7]){c.beginPath();c.moveTo(-8*s,yy*s);c.lineTo(-14*s,yy*1.35*s);c.stroke();c.beginPath();c.moveTo(8*s,yy*s);c.lineTo(14*s,yy*1.35*s);c.stroke()}c.fillStyle=style.accent;c.fillRect(4*s,-2*s,8*s,4*s)}
  else {c.beginPath();c.arc(-3*s,0,6*s,0,Math.PI*2);c.fill();c.stroke();c.fillRect(-1*s,-6*s,12*s,12*s);c.strokeRect(-1*s,-6*s,12*s,12*s);c.fillStyle=style.accent;c.fillRect(8*s,-2*s,12*s,4*s);if(style.kind==='shield'){c.strokeStyle=style.accent;c.lineWidth=3;c.beginPath();c.arc(4*s,0,14*s,-Math.PI*.55,Math.PI*.55);c.stroke()}if(style.kind==='heavy'){c.fillStyle=style.accent;c.fillRect(-5*s,-9*s,6*s,18*s)}if(style.kind==='jammer'){c.strokeStyle=style.accent;c.beginPath();c.arc(2*s,0,15*s,-.7,.7);c.stroke();c.beginPath();c.arc(2*s,0,20*s,-.55,.55);c.stroke()}}
  c.restore();if(e.elite||e.hp<e.maxHp){const pct=Math.max(0,e.hp/e.maxHp),bw=e.elite?34:24;c.fillStyle='rgba(0,0,0,.6)';c.fillRect(e.x-bw/2,e.y-e.r-10,bw,3);c.fillStyle=style.accent;c.fillRect(e.x-bw/2,e.y-e.r-10,bw*pct,3)}
}
drawBoss(c,b){
  c.save();c.translate(b.x,b.y);c.rotate(this.elapsed*.08);c.shadowColor='rgba(255,60,60,.3)';c.shadowBlur=18;c.fillStyle=b.flash?'#fff':'#39171b';c.strokeStyle='#ff665f';c.lineWidth=3;
  if(b.name.includes('MANTICORE')){for(let i=0;i<6;i++){const a=i/6*Math.PI*2;c.save();c.rotate(a);c.fillRect(14,-8,34,16);c.strokeRect(14,-8,34,16);c.restore()}c.beginPath();c.arc(0,0,27,0,Math.PI*2);c.fill();c.stroke()}
  else if(b.name.includes('CARRION')){c.beginPath();for(let i=0;i<8;i++){const a=i/8*Math.PI*2,r=i%2?31:49,x=Math.cos(a)*r,y=Math.sin(a)*r;i?c.lineTo(x,y):c.moveTo(x,y)}c.closePath();c.fill();c.stroke();c.fillStyle='#ff665f';c.beginPath();c.arc(0,0,8,0,Math.PI*2);c.fill()}
  else{c.fillRect(-39,-25,78,50);c.strokeRect(-39,-25,78,50);c.fillStyle='#ff665f';c.fillRect(18,-5,35,10);for(const y of[-17,17]){c.beginPath();c.arc(-25,y,10,0,Math.PI*2);c.fill()}}
  c.restore()
}
drawParticle(c,p){const alpha=Math.max(0,Math.min(1,p.life/.3));c.globalAlpha=alpha;c.fillStyle=p.color;c.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);c.globalAlpha=1}
drawPlayer(c,p){
  c.save();c.translate(p.x,p.y);c.rotate(p.angle);c.shadowColor='rgba(0,0,0,.7)';c.shadowBlur=6;c.shadowOffsetY=5;c.fillStyle=p.hit?'#ffe0dc':'#1f5659';c.strokeStyle='#8ffff0';c.lineWidth=1.5;
  c.beginPath();c.moveTo(13,0);c.lineTo(3,-8);c.lineTo(-9,-6);c.lineTo(-12,0);c.lineTo(-9,6);c.lineTo(3,8);c.closePath();c.fill();c.stroke();c.fillStyle='#8ffff0';c.fillRect(5,-2,14,4);c.fillStyle='#0a2025';c.beginPath();c.arc(-2,0,3.3,0,Math.PI*2);c.fill();c.restore();
  c.strokeStyle='rgba(118,231,212,.14)';c.beginPath();c.arc(p.x,p.y,18+Math.sin(this.elapsed*4),0,Math.PI*2);c.stroke()
}
drawExtraction(c,x,y){const r=28+Math.sin(this.elapsed*5)*4;c.save();c.strokeStyle='#f5d27a';c.lineWidth=3;c.setLineDash([8,7]);c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.stroke();c.setLineDash([]);c.fillStyle='rgba(245,210,122,.08)';c.beginPath();c.arc(x,y,r-5,0,Math.PI*2);c.fill();c.fillStyle='#f5d27a';c.font='600 11px ui-monospace,monospace';c.textAlign='center';c.fillText('EXTRACT',x,y+r+18);c.restore()}
}
