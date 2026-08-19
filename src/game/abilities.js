import {dist,dist2,normalize,clamp,TAU} from '../core/math.js';

// Operative activated abilities. Each entry is a self-contained effect the
// engine invokes; `duration` effects register a tick handler on the engine.

export const ABILITIES={
  // VESPER — blinds and disorients everything in a wide radius.
  scramble(engine,player){
    const radius=340*engine.stats.area;
    engine.spawnShockwave({
      x:player.x,y:player.y,radius,damage:0,knockback:120,
      color:'#76e7d4',ring:true
    });
    const affected=engine.enemyHash.query(player.x,player.y,radius,scratch);
    for(const enemy of affected){
      if(enemy.dead)continue;
      if(dist2(player.x,player.y,enemy.x,enemy.y)>radius*radius)continue;
      enemy.awareness=0;
      enemy.memory=0;
      enemy.confusedTimer=4.5;
      enemy.strafeDir*=-1;
      // Send them chasing a phantom contact away from the player.
      const angle=engine.rng.angle();
      enemy.lastKnownX=player.x+Math.cos(angle)*420;
      enemy.lastKnownY=player.y+Math.sin(angle)*420;
    }
    engine.camera.addShake(.22);
    engine.audio.play('scramble',{volume:1});
    engine.addFloatingText(player.x,player.y-40,'SIGNAL SCRAMBLED','#76e7d4');
    return true;
  },

  // BASTION — directional shield that absorbs and reflects incoming fire.
  bulwarkShield(engine,player){
    player.shieldTimer=6;
    player.shieldAngle=player.angle;
    player.shieldReflect=true;
    engine.audio.play('shield',{volume:1});
    engine.addFloatingText(player.x,player.y-40,'BULWARK FIELD','#ffb35c');
    engine.registerEffect('bulwarkShield',6,(dt,t)=>{
      // Shield tracks the operative's current facing.
      player.shieldAngle=player.angle;
      if(t<=0){player.shieldTimer=0;player.shieldReflect=false}
    });
    return true;
  },

  // MIRAGE — releases independently-hunting interceptor drones.
  droneSwarm(engine,player){
    const count=6;
    for(let i=0;i<count;i++){
      engine.spawnTurret({
        x:player.x+Math.cos(i/count*TAU)*46,
        y:player.y+Math.sin(i/count*TAU)*46,
        damage:22*engine.stats.damage,
        fireRate:.5,range:320,life:12*engine.stats.duration,
        projectileSpeed:560,mobile:true,follow:player,
        color:'#7db2ff',weapon:null
      });
    }
    engine.audio.play('tech',{volume:1});
    engine.addFloatingText(player.x,player.y-40,'INTERCEPTORS AWAY','#7db2ff');
    return true;
  },

  // WRAITH — blink through the densest cluster, cutting everything on the path.
  phaseStrike(engine,player){
    // Find the direction with the most enemies within strike range.
    let bestAngle=player.angle,bestScore=-1;
    for(let i=0;i<12;i++){
      const angle=i/12*TAU;
      let score=0;
      const probe=engine.enemyHash.query(
        player.x+Math.cos(angle)*180,player.y+Math.sin(angle)*180,200,scratch);
      for(const enemy of probe)if(!enemy.dead)score++;
      if(score>bestScore){bestScore=score;bestAngle=angle}
    }
    const distance=280;
    const fromX=player.x,fromY=player.y;
    const toX=player.x+Math.cos(bestAngle)*distance;
    const toY=player.y+Math.sin(bestAngle)*distance;

    engine.blinkPlayer(toX,toY);
    // Damage everything along the traversed line.
    const damage=90*engine.stats.damage;
    const candidates=engine.enemyHash.query((fromX+player.x)/2,(fromY+player.y)/2,distance,scratch);
    for(const enemy of candidates){
      if(enemy.dead)continue;
      if(distanceToSegment(enemy.x,enemy.y,fromX,fromY,player.x,player.y)>70)continue;
      engine.damageEnemy(enemy,damage,{source:'ability',knockback:260,crit:true});
    }
    player.damageBuff=1.45;
    player.damageBuffTimer=3;
    engine.spawnTrailStreak(fromX,fromY,player.x,player.y,'#c79bff');
    engine.camera.addShake(.2);
    engine.audio.play('dash',{volume:1.1});
    engine.addFloatingText(player.x,player.y-40,'PHASE STRIKE','#c79bff');
    return true;
  },

  // ORACLE — slows every hostile while the operative keeps full speed.
  timeDilation(engine,player){
    engine.timeDilation=.28;
    engine.audio.play('tech',{volume:1});
    engine.addFloatingText(player.x,player.y-40,'ARBITRATION WINDOW','#ff8d82');
    engine.registerEffect('timeDilation',5,(dt,remaining)=>{
      // Ease back to normal speed over the final second.
      engine.timeDilation=remaining<1?clamp(.28+(1-remaining)*.72,.28,1):.28;
      if(remaining<=0)engine.timeDilation=1;
    });
    return true;
  },

  // FERROUS — rolling barrage of charges across the surrounding area.
  demolition(engine,player){
    const shells=10;
    for(let i=0;i<shells;i++){
      const angle=engine.rng.angle();
      const distance=engine.rng.range(60,340);
      engine.scheduleAction(i*.14,()=>{
        engine.spawnOrbitalStrike({
          x:player.x+Math.cos(angle)*distance,
          y:player.y+Math.sin(angle)*distance,
          delay:.55,damage:110*engine.stats.damage,
          blastRadius:110*engine.stats.area,knockback:280
        });
      });
    }
    engine.audio.play('alarm',{volume:.9});
    engine.addFloatingText(player.x,player.y-40,'DEMOLITION ORDER','#ff7068');
    return true;
  },

  // CIPHER — detonates every status effect currently on the field.
  systemPurge(engine,player){
    let detonated=0;
    for(const enemy of engine.enemies){
      if(enemy.dead||!enemy.statuses?.size)continue;
      let total=0;
      for(const [,status] of enemy.statuses)total+=(status.stacks||1)*34;
      enemy.statuses.clear();
      engine.spawnExplosion({
        x:enemy.x,y:enemy.y,radius:90*engine.stats.area,
        damage:total*engine.stats.damage,knockback:180,color:'#9bffb8'
      });
      detonated++;
    }
    engine.camera.addShake(.25);
    engine.audio.play('explode',{volume:1});
    engine.addFloatingText(player.x,player.y-40,
      detonated?`PURGE // ${detonated} NODES`:'NO ACTIVE NODES','#9bffb8');
    return true;
  },

  // REQUIEM — consumes held phantoms in a detonation scaled to their number.
  lastRites(engine,player){
    const phantoms=engine.phantoms.filter(p=>!p.dead);
    const power=Math.max(1,phantoms.length);
    for(const phantom of phantoms){
      engine.spawnExplosion({
        x:phantom.x,y:phantom.y,radius:130*engine.stats.area,
        damage:140*power*engine.stats.damage/Math.max(1,phantoms.length)*1.6,
        knockback:320,color:'#e0e6ea'
      });
      phantom.dead=true;
    }
    if(!phantoms.length){
      engine.spawnExplosion({
        x:player.x,y:player.y,radius:150*engine.stats.area,
        damage:120*engine.stats.damage,knockback:280,color:'#e0e6ea'
      });
    }
    engine.camera.addShake(.3);
    engine.audio.play('explode',{volume:1.2});
    engine.addFloatingText(player.x,player.y-40,`LAST RITES // ${phantoms.length}`,'#e0e6ea');
    return true;
  }
};

// Always-on operative traits, applied by the engine at the right moments.
export const TRAITS={
  signalGhost:{
    onInit(engine){engine.forgetRateMult=1.4;engine.enemyAccuracyPenalty=.22}
  },
  compositeFrame:{
    onInit(engine){engine.player.knockbackResist=1;engine.flatArmor=true}
  },
  fastRecompile:{
    onInit(engine){engine.abilityCooldownMult=.75}
  },
  afterimage:{
    onDash(engine,player){
      engine.spawnDecoy(player.x,player.y,3);
      player.damageBuff=1.45;
      player.damageBuffTimer=3;
    }
  },
  combatAnalysis:{
    onCrit(engine,enemy){engine.applyStatus(enemy,'mark',1)}
  },
  overpressure:{
    onInit(engine){engine.explosionSizeMult=1.35;engine.eliteDamageMult=1.2}
  },
  subversion:{
    onKill(engine,enemy){
      if(!enemy.machine)return;
      if(engine.rng.next()<.2)engine.reanimate(enemy,10);
    }
  },
  entropy:{
    onInit(engine){engine.playerDamageTakenMult=1.25},
    onKill(engine){engine.healPlayer(2.5)}
  }
};

function distanceToSegment(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1;
  const lengthSq=dx*dx+dy*dy;
  if(lengthSq<1e-6)return dist(px,py,x1,y1);
  const t=clamp(((px-x1)*dx+(py-y1)*dy)/lengthSq,0,1);
  return dist(px,py,x1+dx*t,y1+dy*t);
}

const scratch=[];

export {distanceToSegment};
