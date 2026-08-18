import {Gameplay} from './gameplay.js';

const COLORS={
  'Patrol Scout':'#819b91','Rifle Cell':'#8ea09a','Shield Trooper':'#a18e67','Pursuit Drone':'#70b9bd','Hunter Drone':'#c99b5d','Longshot Sniper':'#987b91','Breacher Heavy':'#a9705a','Signal Jammer':'#8778a6','Crawler Robot':'#718d93','Veil Operative':'#73838e','Augment Marauder':'#af5c53','Mortar Team':'#9b8a62'
};

export class EnhancedGameplay extends Gameplay{
  constructor(canvas,ctx,opts){
    super(canvas,ctx,opts);
    this.player.speed*=.68;
    this.baseMoveSpeed=this.player.speed;
  }
  update(dt,input){
    super.update(dt,input);if(this.paused||this.ended)return;
    this.separateSwarm(dt);
  }
  separateSwarm(dt){
    const es=this.enemies,n=es.length,limit=Math.min(n,150);
    for(let i=0;i<limit;i++){
      const a=es[i];let sx=0,sy=0,hits=0;
      for(let j=Math.max(0,i-12);j<Math.min(limit,i+13);j++){
        if(i===j)continue;const b=es[j],dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy,min=(a.r+b.r)*1.55;
        if(d2>0&&d2<min*min){const d=Math.sqrt(d2),push=(min-d)/min;sx+=dx/d*push;sy+=dy/d*push;hits++}
      }
      if(hits){const strength=92*dt;a.x+=sx/hits*strength;a.y+=sy/hits*strength}
    }
  }
  drawWorld(c,w,h){
    const map=this.opts.mapId||'blacksite';
    c.fillStyle=map==='arctic'?'#18303b':map==='sunken'?'#0b3033':'#0c252d';c.fillRect(0,0,w,h);
    if(map==='blacksite')this.drawBlacksite(c,w,h);else this.drawField(c,w,h,map);
    const grd=c.createRadialGradient(w*.5,h*.48,20,w*.5,h*.48,Math.max(w,h)*.72);grd.addColorStop(0,'rgba(21,64,69,.04)');grd.addColorStop(1,'rgba(0,3,7,.48)');c.fillStyle=grd;c.fillRect(0,0,w,h);
  }
  drawBlacksite(c,w,h){
    c.fillStyle='#102b33';for(let y=0;y<h;y+=96)for(let x=0;x<w;x+=96){c.fillRect(x+1,y+1,94,94);c.strokeStyle='rgba(116,183,184,.055)';c.strokeRect(x+.5,y+.5,95,95)}
    c.strokeStyle='rgba(255,190,78,.16)';c.lineWidth=2;for(let y=240;y<h;y+=430){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();for(let x=0;x<w;x+=34){c.beginPath();c.moveTo(x,y-6);c.lineTo(x+12,y+6);c.stroke()}}
    for(const d of this.decor){c.save();c.translate(d.x,d.y);if(d.t===0){c.shadowColor='rgba(0,0,0,.45)';c.shadowBlur=10;c.fillStyle='#07171d';c.fillRect(-d.w/2,-d.h/2,d.w,d.h);c.shadowBlur=0;c.strokeStyle='rgba(117,205,198,.18)';c.strokeRect(-d.w/2,-d.h/2,d.w,d.h);c.fillStyle='rgba(255,178,62,.18)';c.fillRect(-d.w/2+4,-d.h/2+3,4,d.h-6)}else if(d.t===1){c.fillStyle='#071a20';c.beginPath();c.arc(0,0,d.w*.28,0,Math.PI*2);c.fill();c.strokeStyle='rgba(102,216,204,.16)';c.stroke();c.beginPath();c.arc(0,0,d.w*.14,0,Math.PI*2);c.stroke()}else if(d.t===2){c.strokeStyle='rgba(114,211,204,.12)';c.lineWidth=2;c.beginPath();c.moveTo(-d.w/2,0);c.lineTo(d.w/2,0);c.stroke();c.fillStyle='rgba(118,231,212,.16)';c.fillRect(-3,-3,6,6)}else if(d.t===3){c.fillStyle='#0a1a20';c.fillRect(-d.w/2,-d.h/2,d.w,d.h);c.strokeStyle='rgba(180,202,198,.12)';for(let k=-d.w/2+5;k<d.w/2;k+=7){c.beginPath();c.moveTo(k,-d.h/2);c.lineTo(k,d.h/2);c.stroke()}}else{c.fillStyle='rgba(110,231,211,.07)';c.fillRect(-d.w/2,-2,d.w,4);c.shadowColor='#6ee7d3';c.shadowBlur=10;c.fillStyle='rgba(110,231,211,.32)';c.fillRect(-d.w*.18,-1,d.w*.36,2)}c.restore()}
    c.font='8px monospace';c.fillStyle='rgba(174,208,207,.13)';c.fillText('SECTOR B-07 // RESTRICTED',18,h*.42);c.fillText('BLACKSITE INTERNAL GRID',w*.55,h*.72);
  }
  drawField(c,w,h,map){
    c.strokeStyle='rgba(118,231,212,.05)';for(let x=0;x<w;x+=72){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}for(let y=0;y<h;y+=72){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}
    for(const d of this.decor){c.fillStyle=map==='arctic'?'rgba(202,235,244,.06)':'rgba(14,70,66,.16)';c.fillRect(d.x-d.w/2,d.y-d.h/2,d.w,d.h)}
  }
  drawPlayer(c,p){
    const bob=Math.sin(this.elapsed*11)*.8;
    c.save();c.translate(p.x,p.y);c.rotate(p.angle);c.translate(0,bob);
    c.shadowColor='rgba(0,0,0,.7)';c.shadowBlur=7;c.fillStyle='rgba(0,0,0,.38)';c.beginPath();c.ellipse(-3,7,13,7,0,0,Math.PI*2);c.fill();c.shadowBlur=0;
    c.strokeStyle='#8ffff0';c.lineWidth=1.2;c.fillStyle=p.hit?'#f5ffff':'#1b4d4c';
    c.beginPath();c.arc(-5,0,5.5,0,Math.PI*2);c.fill();c.stroke();
    c.fillStyle='#234f49';c.fillRect(-1,-7,11,14);c.strokeRect(-1,-7,11,14);
    c.fillStyle='#0c1c20';c.beginPath();c.moveTo(-7,-5);c.lineTo(-12,-9);c.lineTo(-14,-6);c.lineTo(-9,-1);c.closePath();c.fill();c.beginPath();c.moveTo(-7,5);c.lineTo(-12,9);c.lineTo(-14,6);c.lineTo(-9,1);c.closePath();c.fill();
    c.strokeStyle='#85d9cf';c.lineWidth=3;c.beginPath();c.moveTo(2,-5);c.lineTo(9,-10);c.stroke();c.beginPath();c.moveTo(2,5);c.lineTo(9,10);c.stroke();
    c.strokeStyle='#d8efea';c.lineWidth=3;c.beginPath();c.moveTo(7,-3);c.lineTo(23,-3);c.stroke();c.fillStyle='#f6ffff';c.fillRect(21,-4,6,2);c.fillStyle='#6fe1d2';c.fillRect(-6,-2,3,4);
    c.strokeStyle='rgba(118,231,212,.24)';c.lineWidth=1;c.beginPath();c.arc(0,0,18,0,Math.PI*2);c.stroke();c.restore();
  }
  drawEnemy(c,e){
    const drone=e.type.includes('Drone'),crawler=e.type==='Crawler Robot',heavy=e.type==='Breacher Heavy'||e.type==='Augment Marauder',shield=e.type==='Shield Trooper',sniper=e.type==='Longshot Sniper',jammer=e.type==='Signal Jammer',elite=e.elite;
    if(drone){this.drawDrone(c,e);return}if(crawler){this.drawCrawler(c,e);return}
    const col=elite?'#b6524d':(COLORS[e.type]||'#81918f'),scale=(heavy?1.22:shield?1.12:sniper?.94:1)*(elite?1.12:1),walk=Math.sin(this.elapsed*10+e.phase)*2.2;
    c.save();c.translate(e.x,e.y);c.rotate(e.angle);c.scale(scale,scale);c.shadowColor='rgba(0,0,0,.65)';c.shadowBlur=5;c.fillStyle='rgba(0,0,0,.34)';c.beginPath();c.ellipse(-2,6,11,6,0,0,Math.PI*2);c.fill();c.shadowBlur=0;
    c.strokeStyle=e.flash?'#fff':elite?'#ff8b7d':'rgba(215,232,228,.6)';c.lineWidth=1;
    c.fillStyle=e.flash?'#fff':col;c.beginPath();c.arc(-5,0,4.6,0,Math.PI*2);c.fill();c.stroke();
    c.fillStyle=heavy?'#4c3430':'#253735';c.fillRect(-1,-6,10,12);c.strokeRect(-1,-6,10,12);
    c.strokeStyle=e.flash?'#fff':col;c.lineWidth=3;c.beginPath();c.moveTo(2,-5);c.lineTo(7,-10-walk*.25);c.stroke();c.beginPath();c.moveTo(2,5);c.lineTo(7,10+walk*.25);c.stroke();
    c.strokeStyle='#91a7a4';c.beginPath();c.moveTo(7,-3);c.lineTo(17,-3);c.stroke();c.beginPath();c.moveTo(7,3);c.lineTo(14,6);c.stroke();
    c.strokeStyle=elite?'#ff9b83':'#c5d0cd';c.lineWidth=2.5;c.beginPath();c.moveTo(6,-1);c.lineTo(sniper?25:20,-1);c.stroke();if(sniper){c.fillStyle='#d5b2c6';c.fillRect(15,-3,5,2)}
    if(shield){c.fillStyle='rgba(190,166,104,.35)';c.strokeStyle='#cdbb7b';c.lineWidth=1.5;c.beginPath();c.moveTo(14,-8);c.lineTo(20,-5);c.lineTo(20,5);c.lineTo(14,8);c.closePath();c.fill();c.stroke()}
    if(jammer){c.strokeStyle='#a990df';c.lineWidth=1;c.beginPath();c.arc(2,0,13+Math.sin(this.elapsed*5+e.phase)*2,0,Math.PI*2);c.stroke()}
    if(heavy){c.fillStyle='#5e3f38';c.fillRect(-3,-9,8,4);c.fillRect(-3,5,8,4)}
    if(elite){c.strokeStyle='rgba(255,102,90,.45)';c.beginPath();c.arc(0,0,16,0,Math.PI*2);c.stroke()}
    c.restore();this.drawEnemyHealth(c,e,heavy||elite?17:14);
  }
  drawEnemyHealth(c,e,yOff){if(e.hp>=e.maxHp&&!e.elite)return;const w=e.elite?24:18;c.fillStyle='rgba(1,5,7,.65)';c.fillRect(e.x-w/2,e.y-yOff,w,2.5);c.fillStyle=e.elite?'#ff7068':'#b9d3cf';c.fillRect(e.x-w/2,e.y-yOff,w*Math.max(0,e.hp/e.maxHp),2.5)}
  drawDrone(c,e){const col=e.elite?'#ff7468':(COLORS[e.type]||'#71bdc0'),pulse=Math.sin(this.elapsed*8+e.phase)*1.5;c.save();c.translate(e.x,e.y);c.rotate(e.angle);c.shadowColor=col;c.shadowBlur=6;c.fillStyle='#173136';c.strokeStyle=col;c.lineWidth=1.2;c.beginPath();c.moveTo(10,0);c.lineTo(2,-7);c.lineTo(-8,-5);c.lineTo(-11,0);c.lineTo(-8,5);c.lineTo(2,7);c.closePath();c.fill();c.stroke();c.fillStyle=col;c.beginPath();c.arc(1,0,2.5+pulse*.2,0,Math.PI*2);c.fill();c.strokeStyle=col;c.beginPath();c.moveTo(-4,-6);c.lineTo(-10,-11);c.moveTo(-4,6);c.lineTo(-10,11);c.stroke();c.restore();this.drawEnemyHealth(c,e,15)}
  drawCrawler(c,e){const col=e.elite?'#ff7468':'#789ba3',leg=Math.sin(this.elapsed*12+e.phase)*2;c.save();c.translate(e.x,e.y);c.rotate(e.angle);c.fillStyle='#1e3438';c.strokeStyle=col;c.lineWidth=1.2;c.fillRect(-7,-6,14,12);c.strokeRect(-7,-6,14,12);c.strokeStyle=col;c.beginPath();c.moveTo(-5,-5);c.lineTo(-12,-10-leg);c.moveTo(0,-6);c.lineTo(-2,-13+leg);c.moveTo(5,-5);c.lineTo(12,-10-leg);c.moveTo(-5,5);c.lineTo(-12,10+leg);c.moveTo(0,6);c.lineTo(-2,13-leg);c.moveTo(5,5);c.lineTo(12,10+leg);c.stroke();c.fillStyle='#83d4cf';c.fillRect(4,-2,4,4);c.restore();this.drawEnemyHealth(c,e,16)}
}
