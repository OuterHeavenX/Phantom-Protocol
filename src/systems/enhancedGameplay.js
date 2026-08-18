import {Gameplay} from './gameplay.js';

export class EnhancedGameplay extends Gameplay{
  update(dt,input){
    super.update(dt,input);if(this.paused||this.ended)return;
    this.separateSwarm(dt);
  }
  separateSwarm(dt){
    const es=this.enemies,n=es.length,limit=Math.min(n,150);
    for(let i=0;i<limit;i++){
      const a=es[i];let sx=0,sy=0,hits=0;
      for(let j=Math.max(0,i-10);j<Math.min(limit,i+11);j++){
        if(i===j)continue;const b=es[j],dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy,min=(a.r+b.r)*1.35;
        if(d2>0&&d2<min*min){const d=Math.sqrt(d2),push=(min-d)/min;sx+=dx/d*push;sy+=dy/d*push;hits++}
      }
      if(hits){const strength=72*dt;a.x+=sx/hits*strength;a.y+=sy/hits*strength}
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
    c.save();c.translate(p.x,p.y);c.rotate(p.angle);c.shadowColor='rgba(0,0,0,.65)';c.shadowBlur=8;c.fillStyle='rgba(0,0,0,.38)';c.beginPath();c.ellipse(-3,5,15,9,0,0,Math.PI*2);c.fill();c.shadowBlur=0;
    c.fillStyle=p.hit?'#fff':'#183e42';c.strokeStyle='#8ffff0';c.lineWidth=1.5;c.beginPath();c.moveTo(13,0);c.lineTo(5,-8);c.lineTo(-9,-7);c.lineTo(-13,0);c.lineTo(-8,8);c.lineTo(5,8);c.closePath();c.fill();c.stroke();
    c.fillStyle='#0a181c';c.fillRect(-4,-10,7,5);c.fillStyle='#6fe1d2';c.fillRect(1,-9,3,2);c.fillStyle='#b9d5d1';c.fillRect(5,-2,17,4);c.fillStyle='#effffb';c.fillRect(20,-1,5,2);c.fillStyle='rgba(118,231,212,.2)';c.beginPath();c.arc(0,0,18,0,Math.PI*2);c.stroke();c.restore();
  }
}
