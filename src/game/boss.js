import {clamp,dist,normalize,damp,TAU} from '../core/math.js';

// Boss controller. A boss is a phase machine: each phase declares a weighted
// set of attack patterns with independent cooldowns, and phases swap in at
// health thresholds. Patterns are implemented as generator-style routines that
// push entities into the engine.

export class Boss{
  constructor(def,x,y,scaling={}){
    this.def=def;
    this.id=def.id;
    this.name=def.name;
    this.x=x;this.y=y;
    this.vx=0;this.vy=0;
    this.radius=def.radius;
    this.maxHp=Math.round(def.hp*(scaling.hpMult||1));
    this.hp=this.maxHp;
    this.armor=def.armor*(scaling.armorMult||1);
    this.speed=def.speed;
    this.baseSpeed=def.speed;
    this.angle=0;
    this.boss=true;
    this.elite=true;
    this.dead=false;
    this.hitFlash=0;
    this.statuses=new Map();
    this.damageMult=scaling.damageMult||1;

    this.phaseIndex=0;
    this.phase=def.phases[0];
    this.patternCooldowns=new Map();
    this.activePattern=null;
    this.patternTimer=0;
    this.windup=0;
    this.windupPattern=null;
    this.globalCooldown=2.2;
    this.spinAngle=0;
    this.shieldTimer=0;
    this.shieldReduction=0;
    this.introTimer=2.4;
    this.enrage=1;
    this.telegraph=null;

    for(const pattern of def.phases.flatMap(p=>p.patterns)){
      this.patternCooldowns.set(pattern.id,pattern.cooldown*.5);
    }
  }

  get healthRatio(){return this.hp/this.maxHp}

  update(dt,engine){
    if(this.dead)return;
    this.hitFlash=Math.max(0,this.hitFlash-dt);
    this.spinAngle+=dt*.35;
    if(this.introTimer>0){this.introTimer-=dt;return}

    this.updatePhase(engine);
    this.updateShield(dt);
    this.move(dt,engine);

    // Windup: telegraph is visible, then the pattern releases.
    if(this.windup>0){
      this.windup-=dt;
      if(this.windup<=0){
        const pattern=this.windupPattern;
        this.windupPattern=null;
        this.telegraph=null;
        PATTERNS[pattern.id]?.fire(this,pattern,engine);
      }
      return;
    }

    this.globalCooldown-=dt;
    for(const [id,value] of this.patternCooldowns)this.patternCooldowns.set(id,value-dt);
    if(this.globalCooldown>0)return;

    const pattern=this.choosePattern(engine);
    if(!pattern)return;

    this.patternCooldowns.set(pattern.id,pattern.cooldown/this.enrage);
    this.globalCooldown=(.9+Math.random()*.6)/this.enrage;

    const impl=PATTERNS[pattern.id];
    if(!impl)return;
    if(impl.windup){
      this.windup=(pattern.windup||impl.windup)/this.enrage;
      this.windupPattern=pattern;
      this.telegraph=impl.telegraph?impl.telegraph(this,pattern,engine):null;
      engine.audio.play('alarm',{volume:.5});
    }else{
      impl.fire(this,pattern,engine);
    }
  }

  updatePhase(engine){
    const ratio=this.healthRatio;
    // Phases are ordered from full health downward.
    let target=0;
    for(let i=0;i<this.def.phases.length;i++){
      if(ratio<=this.def.phases[i].at)target=i;
    }
    if(target===this.phaseIndex)return;
    this.phaseIndex=target;
    this.phase=this.def.phases[target];
    this.speed=this.phase.speed||this.baseSpeed;
    this.enrage=this.phase.enrage||1;
    // Phase transition clears the field of its own shots and announces itself.
    engine.clearEnemyProjectiles(.6);
    engine.onBossPhase?.(this,this.phase);
    engine.camera.addShake(.5);
    engine.audio.play('boss',{volume:.8});
    this.globalCooldown=1.4;
  }

  updateShield(dt){
    if(this.shieldTimer>0){
      this.shieldTimer-=dt;
      if(this.shieldTimer<=0)this.shieldReduction=0;
    }
  }

  move(dt,engine){
    const player=engine.player;
    const toPlayer=normalize(player.x-this.x,player.y-this.y);
    this.angle=Math.atan2(player.y-this.y,player.x-this.x);

    if(this.chargeTimer>0){
      // Committed charge overrides normal movement.
      this.chargeTimer-=dt;
      this.x+=this.chargeVx*dt;
      this.y+=this.chargeVy*dt;
      if(engine.world.raycastObstacle(this.x,this.y,this.x+this.chargeVx*dt,this.y+this.chargeVy*dt)){
        this.chargeTimer=0;
        if(this.chargeShockwave)this.emitShockwave(engine);
      }
      // Contact damage during the charge.
      if(dist(this.x,this.y,player.x,player.y)<this.radius+player.radius+6){
        engine.damagePlayer(this.chargeDamage||30,{source:this});
        this.chargeTimer=0;
        if(this.chargeShockwave)this.emitShockwave(engine);
      }
      engine.world.resolveCollision(this,this.radius);
      return;
    }

    // Bosses keep a stand-off distance and circle, rather than trickling in
    // at a fixed speed the way the old single-blob boss did.
    const distance=dist(this.x,this.y,player.x,player.y);
    const preferred=this.radius+180;
    const drive=distance>preferred?1:distance<preferred*.65?-1:0;
    const strafeDir=this.strafeDir||(this.strafeDir=Math.random()<.5?1:-1);

    const targetVx=(toPlayer.x*drive-toPlayer.y*strafeDir*.5)*this.speed;
    const targetVy=(toPlayer.y*drive+toPlayer.x*strafeDir*.5)*this.speed;
    this.vx=damp(this.vx,targetVx,3,dt);
    this.vy=damp(this.vy,targetVy,3,dt);
    this.x+=this.vx*dt;
    this.y+=this.vy*dt;
    engine.world.resolveCollision(this,this.radius);

    if(Math.random()<dt*.2)this.strafeDir*=-1;
  }

  emitShockwave(engine){
    engine.spawnShockwave({
      x:this.x,y:this.y,radius:220,damage:(this.chargeDamage||30)*.7*this.damageMult,
      knockback:420,color:this.def.accent,hostile:true
    });
    engine.camera.addShake(.4);
    engine.audio.play('explode',{volume:1});
  }

  takeDamage(amount){
    const reduced=amount*(1-this.shieldReduction);
    this.hp-=reduced;
    this.hitFlash=.08;
    if(this.hp<=0){this.hp=0;this.dead=true}
    return reduced;
  }

  choosePattern(engine){
    const available=this.phase.patterns.filter(p=>(this.patternCooldowns.get(p.id)||0)<=0);
    if(!available.length)return null;
    let total=0;
    for(const pattern of available)total+=pattern.weight||1;
    let roll=Math.random()*total;
    for(const pattern of available){
      roll-=pattern.weight||1;
      if(roll<=0)return pattern;
    }
    return available[available.length-1];
  }
}

// ---------------------------------------------------------------------------
// Attack patterns
// ---------------------------------------------------------------------------

const PATTERNS={
  // Ring of projectiles, optionally rotating between volleys.
  radialBurst:{
    fire(boss,pattern,engine){
      const count=pattern.bullets||14;
      boss.spiralOffset=(boss.spiralOffset||0)+(pattern.spiral?.28:0);
      for(let i=0;i<count;i++){
        const angle=i/count*TAU+(pattern.spiral?boss.spiralOffset:0);
        engine.spawnEnemyProjectile({
          x:boss.x+Math.cos(angle)*boss.radius,
          y:boss.y+Math.sin(angle)*boss.radius,
          vx:Math.cos(angle)*(pattern.speed||250),
          vy:Math.sin(angle)*(pattern.speed||250),
          damage:pattern.damage*boss.damageMult,
          radius:6,color:boss.def.color,life:5,fromBoss:true
        });
      }
      engine.audio.play('shootHeavy',{volume:.8});
      engine.camera.addShake(.12);
    }
  },

  // Multi-armed rotating spiral, the signature CARRION pattern.
  spiralWave:{
    fire(boss,pattern,engine){
      const arms=pattern.arms||3;
      const perArm=pattern.bullets||9;
      const direction=pattern.counterRotate&&Math.random()<.5?-1:1;
      for(let shot=0;shot<perArm;shot++){
        engine.scheduleAction(shot*.07,()=>{
          if(boss.dead)return;
          const base=(boss.spiralAngle=(boss.spiralAngle||0)+.19*direction);
          for(let arm=0;arm<arms;arm++){
            const angle=base+arm/arms*TAU;
            engine.spawnEnemyProjectile({
              x:boss.x+Math.cos(angle)*boss.radius,
              y:boss.y+Math.sin(angle)*boss.radius,
              vx:Math.cos(angle)*(pattern.speed||220),
              vy:Math.sin(angle)*(pattern.speed||220),
              damage:pattern.damage*boss.damageMult,
              radius:5.5,color:boss.def.accent,life:5,fromBoss:true
            });
          }
        });
      }
      engine.audio.play('tech',{volume:.7});
    }
  },

  // Rotating beam sweep, telegraphed by a visible aiming line.
  sweepBeam:{
    windup:1.1,
    telegraph(boss,pattern,engine){
      const angle=Math.atan2(engine.player.y-boss.y,engine.player.x-boss.x);
      boss.sweepStart=angle-(pattern.arc||1.4)/2;
      return{type:'sweep',angle,arc:pattern.arc||1.4,length:900,beams:pattern.beams||1};
    },
    fire(boss,pattern,engine){
      const beams=pattern.beams||1;
      const arc=pattern.arc||1.4;
      const duration=.9;
      for(let b=0;b<beams;b++){
        engine.spawnBeam({
          x:boss.x,y:boss.y,
          angle:boss.sweepStart+b/beams*TAU*(beams>1?1:0),
          length:900,width:22,duration,tickInterval:.12,
          damage:pattern.damage*boss.damageMult,
          hostile:true,follow:boss,
          sweep:{from:boss.sweepStart+b/beams*TAU*(beams>1?1:0),arc,duration},
          color:boss.def.color
        });
      }
      engine.audio.play('laser',{volume:1.1});
      engine.camera.addShake(.2);
    }
  },

  // Predicted-position shells that land after a delay, marked on the ground.
  mortarVolley:{
    fire(boss,pattern,engine){
      const shells=pattern.shells||5;
      for(let i=0;i<shells;i++){
        engine.scheduleAction(i*.18,()=>{
          if(boss.dead)return;
          const player=engine.player;
          const spread=i===0?0:120+i*30;
          const angle=Math.random()*TAU;
          engine.spawnOrbitalStrike({
            x:player.x+player.vx*.5+Math.cos(angle)*spread*Math.random(),
            y:player.y+player.vy*.5+Math.sin(angle)*spread*Math.random(),
            delay:pattern.delay||1.2,
            damage:pattern.damage*boss.damageMult,
            blastRadius:pattern.radius||110,
            knockback:260,hostile:true,color:boss.def.accent
          });
        });
      }
      engine.audio.play('shootHeavy',{volume:.7});
    }
  },

  // Telegraphed straight-line charge, optionally ending in a shockwave.
  chargeSlam:{
    windup:.85,
    telegraph(boss,pattern,engine){
      const angle=Math.atan2(engine.player.y-boss.y,engine.player.x-boss.x);
      boss.chargeAngle=angle;
      return{type:'line',angle,length:900,width:boss.radius*2.2};
    },
    fire(boss,pattern,engine){
      const angle=boss.chargeAngle??boss.angle;
      boss.chargeVx=Math.cos(angle)*(pattern.speed||620);
      boss.chargeVy=Math.sin(angle)*(pattern.speed||620);
      boss.chargeTimer=.85;
      boss.chargeDamage=pattern.damage;
      boss.chargeShockwave=!!pattern.shockwave;
      engine.audio.play('dash',{volume:1.1});
      engine.camera.addShake(.24);
    }
  },

  // Calls in a squad of escorts around the arena edge.
  summonEscort:{
    fire(boss,pattern,engine){
      engine.spawnEscortSquad(pattern.unit,pattern.count||4,boss);
      engine.audio.play('alarm',{volume:.7});
    }
  },

  droneCurtain:{
    fire(boss,pattern,engine){
      engine.spawnEscortSquad(pattern.unit||'pursuit',pattern.count||8,boss);
      engine.audio.play('tech',{volume:.8});
    }
  },

  // Teleport to a new firing position, breaking the player's positioning.
  blinkReposition:{
    fire(boss,pattern,engine){
      const player=engine.player;
      for(let attempt=0;attempt<16;attempt++){
        const angle=Math.random()*TAU;
        const distance=(pattern.range||340)*(.6+Math.random()*.6);
        const x=player.x+Math.cos(angle)*distance;
        const y=player.y+Math.sin(angle)*distance;
        if(!engine.world.isInside(x,y,boss.radius+30))continue;
        if(engine.world.overlapsSolid(x,y,boss.radius))continue;
        engine.spawnBlinkVfx(boss.x,boss.y,boss.radius,boss.def.color);
        boss.x=x;boss.y=y;
        engine.spawnBlinkVfx(x,y,boss.radius,boss.def.color);
        engine.audio.play('tech',{volume:.9});
        return;
      }
    }
  },

  // Marked ground strikes that predict where the player is heading.
  markedStrike:{
    fire(boss,pattern,engine){
      const count=pattern.count||3;
      for(let i=0;i<count;i++){
        engine.scheduleAction(i*.14,()=>{
          if(boss.dead)return;
          const player=engine.player;
          const lead=pattern.predictive?.75:.2;
          const jitter=pattern.predictive?40:150;
          engine.spawnOrbitalStrike({
            x:player.x+player.vx*lead+(Math.random()-.5)*jitter,
            y:player.y+player.vy*lead+(Math.random()-.5)*jitter,
            delay:pattern.delay||1.2,
            damage:pattern.damage*boss.damageMult,
            blastRadius:pattern.radius||100,
            knockback:240,hostile:true,color:boss.def.color
          });
        });
      }
    }
  },

  // Persistent damaging zone centred on the boss.
  nullField:{
    fire(boss,pattern,engine){
      engine.spawnHostileField({
        x:boss.x,y:boss.y,radius:pattern.radius||260,
        duration:pattern.duration||4,damage:pattern.damage,
        tickInterval:.5,color:boss.def.accent,follow:boss
      });
      engine.audio.play('scramble',{volume:.9});
    }
  },

  // Temporary heavy damage reduction the player has to wait out or burst past.
  shieldCycle:{
    fire(boss,pattern,engine){
      boss.shieldTimer=pattern.duration||4;
      boss.shieldReduction=pattern.reduction||.8;
      engine.audio.play('shield',{volume:1});
      engine.addFloatingText(boss.x,boss.y-boss.radius-20,'ADAPTIVE SHIELD','#8fd8ff');
    }
  },

  // THE ARBITER copies the player's own loadout back at them.
  mirrorFire:{
    fire(boss,pattern,engine){
      const weapons=engine.loadout.weapons;
      if(!weapons.length){PATTERNS.radialBurst.fire(boss,{bullets:12,speed:280,damage:pattern.damage},engine);return}
      const weapon=weapons[Math.floor(Math.random()*weapons.length)];
      const angle=Math.atan2(engine.player.y-boss.y,engine.player.x-boss.x);
      const shots=clamp(Math.round(weapon.level*.8)+2,3,10);
      for(let i=0;i<shots;i++){
        const a=angle+(i-(shots-1)/2)*.12;
        engine.spawnEnemyProjectile({
          x:boss.x+Math.cos(a)*boss.radius,y:boss.y+Math.sin(a)*boss.radius,
          vx:Math.cos(a)*420,vy:Math.sin(a)*420,
          damage:pattern.damage*boss.damageMult,
          radius:5,color:'#e0e6ea',life:4,fromBoss:true
        });
      }
      engine.addFloatingText(boss.x,boss.y-boss.radius-20,weapon.name.toUpperCase(),'#e0e6ea');
      engine.audio.play('shoot',{volume:1});
    }
  }
};

export {PATTERNS};
