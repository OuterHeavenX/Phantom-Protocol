import {EnhancedGameplay} from './enhancedGameplay.js';

export class ProjectileGameplay extends EnhancedGameplay{
  constructor(canvas,ctx,opts){
    super(canvas,ctx,opts);
    this.enemyProjectiles=[];
  }

  spawnWaveEnemy(){
    super.spawnWaveEnemy();
    const e=this.enemies[this.enemies.length-1];
    if(!e)return;
    const easiest=(this.opts.difficulty||0)<=0;
    if(easiest&&e.type==='Longshot Sniper'){
      const activeSnipers=this.enemies.filter(x=>x!==e&&x.type==='Longshot Sniper'&&x.hp>0).length;
      if(activeSnipers>=1){
        e.type='Rifle Cell';
        e.tacticalReady=false;
        this.setupTacticalEnemy(e);
      }
    }
  }

  rangedPressure(e,dt){
    e.attackClock-=dt;
    if(e.attackClock>0)return;
    const dx=this.player.x-e.x,dy=this.player.y-e.y,d=Math.hypot(dx,dy)||1;
    if(d<70||d>260){e.attackClock=.45;return}

    const sniper=e.role==='sniper',support=e.role==='support';
    e.attackClock=(sniper?2.7:support?2.15:1.75)+Math.random()*.65;
    const speed=sniper?255:support?155:220;
    const damage=sniper?7:support?3:4;
    const warmup=sniper?.62:support?.18:.1;
    const color=sniper?'#ff6868':support?'#b89cff':'#ffcf73';
    const r=sniper?4.2:support?5.5:3.2;
    const a=Math.atan2(dy,dx);
    this.enemyProjectiles.push({
      x:e.x,y:e.y,px:e.x,py:e.y,
      vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,
      r,damage,color,life:3,warmup,sniper,support,
      aimX:this.player.x,aimY:this.player.y
    });
    this.hostileMuzzleFx(e.x,e.y,a,color);
  }

  update(dt,input){
    super.update(dt,input);
    if(this.paused||this.ended)return;
    this.updateEnemyProjectiles(dt);
    this.checkDeath();
  }

  updateEnemyProjectiles(dt){
    for(const p of this.enemyProjectiles){
      p.life-=dt;
      if(p.warmup>0){p.warmup-=dt;continue}
      p.px=p.x;p.py=p.y;p.x+=p.vx*dt;p.y+=p.vy*dt;

      if(this.shotHitsObstacle(p)){p.life=0;this.hitFx(p.x,p.y,false);continue}

      if(Math.hypot(p.x-this.player.x,p.y-this.player.y)<p.r+this.player.r){
        this.player.hp=Math.max(0,this.player.hp-Math.max(1,p.damage-this.player.armor*.16));
        this.player.hit=.13;p.life=0;this.warningFx(this.player.x,this.player.y);
      }
    }
    const pad=80,w=this.canvas.width,h=this.canvas.height;
    this.enemyProjectiles=this.enemyProjectiles.filter(p=>p.life>0&&p.x>-pad&&p.x<w+pad&&p.y>-pad&&p.y<h+pad);
  }

  shotHitsObstacle(p){
    for(const o of this.obstacles){
      if(o.broken||o.type==='hide')continue;
      if(p.x>o.x-o.w/2&&p.x<o.x+o.w/2&&p.y>o.y-o.h/2&&p.y<o.y+o.h/2)return true;
    }
    return false;
  }

  scrollWorld(dx,dy){
    super.scrollWorld(dx,dy);
    for(const p of this.enemyProjectiles){p.x-=dx;p.y-=dy;p.px-=dx;p.py-=dy;p.aimX-=dx;p.aimY-=dy}
  }

  draw(){
    super.draw();
    const c=this.ctx;
    for(const p of this.enemyProjectiles)this.drawEnemyProjectile(c,p);
  }

  drawEnemyProjectile(c,p){
    c.save();
    if(p.warmup>0){
      const alpha=Math.min(.72,.18+(1-p.warmup/(p.sniper?.62:.18))*.54);
      c.strokeStyle=p.sniper?`rgba(255,82,82,${alpha})`:`rgba(255,207,115,${alpha*.55})`;
      c.lineWidth=p.sniper?1.5:1;
      c.setLineDash(p.sniper?[7,5]:[3,5]);
      c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.aimX,p.aimY);c.stroke();
      c.setLineDash([]);
      c.fillStyle=p.color;c.shadowColor=p.color;c.shadowBlur=8;
      c.beginPath();c.arc(p.x,p.y,p.r+1,0,Math.PI*2);c.fill();
      c.restore();return;
    }

    c.strokeStyle=p.color;c.globalAlpha=.58;c.lineWidth=p.sniper?2.5:p.support?2:1.5;
    c.beginPath();c.moveTo(p.px,p.py);c.lineTo(p.x,p.y);c.stroke();
    c.globalAlpha=1;c.fillStyle=p.color;c.shadowColor=p.color;c.shadowBlur=p.support?13:9;
    c.beginPath();c.arc(p.x,p.y,p.r,0,Math.PI*2);c.fill();
    if(p.sniper){c.strokeStyle='rgba(255,255,255,.75)';c.lineWidth=1;c.beginPath();c.arc(p.x,p.y,p.r+2,0,Math.PI*2);c.stroke()}
    c.restore();
  }

  hostileMuzzleFx(x,y,a,color){
    for(let i=0;i<3;i++)this.particles.push({x,y,vx:Math.cos(a+(Math.random()-.5)*.5)*(45+Math.random()*55),vy:Math.sin(a+(Math.random()-.5)*.5)*(45+Math.random()*55),life:.12+Math.random()*.1,size:1.5+Math.random()*2,color});
  }
}
