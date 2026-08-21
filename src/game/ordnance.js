import {dist2,clamp,TAU} from '../core/math.js';

// Secondary fire implementations.
//
// One entry per module in data/ordnance.js, invoked by the engine when the
// operative triggers secondary fire and the module is off cooldown. Each
// returns true if it fired — returning false leaves the cooldown untouched, so
// a module that had nothing to do does not cost the operative the charge.
//
// Damage scales off the primary weapon's resolved damage rather than a flat
// number, so a module stays worth firing at minute twenty instead of decaying
// into a rounding error against late-contract health pools.

const scratch=[];

// The direction the operative is actually pointing, which is what a secondary
// should follow — not the auto-target the primary picked.
function aim(player){
  return{x:Math.cos(player.angle),y:Math.sin(player.angle)};
}

export const ORDNANCE_FIRE={
  // Lobbed charge on a short fuse. The engine's grenades detonate on time
  // rather than on contact, so the fuse is kept short enough that it lands and
  // goes off rather than rolling past what it was thrown at.
  breach(engine,player,module,damage){
    const dir=aim(player);
    engine.spawnGrenade({
      x:player.x+dir.x*22,y:player.y+dir.y*22,
      vx:dir.x*620,vy:dir.y*620,
      blastRadius:module.radius*engine.stats.area,
      damage,fuse:.85,knockback:260,
      cluster:0
    });
    engine.audio.play('shoot',{volume:.8});
    return true;
  },

  // Close cone. Deliberately short-ranged: this is the answer to something
  // that has already closed, not a second primary.
  scatter(engine,player,module,damage){
    const base=player.angle;
    for(let i=0;i<module.pellets;i++){
      const spread=(i/(module.pellets-1)-.5)*module.spread;
      const angle=base+spread;
      engine.spawnPlayerProjectile({
        x:player.x+Math.cos(angle)*20,y:player.y+Math.sin(angle)*20,
        vx:Math.cos(angle)*940,vy:Math.sin(angle)*940,
        damage,radius:5,life:module.range/940,
        color:'#ffd9a0',pierce:1
      });
    }
    engine.camera.addShake(.16);
    engine.audio.play('shoot',{volume:.9});
    return true;
  },

  // Vents the core into a ring. The knockback is the point — it buys distance
  // the operative could not otherwise take.
  overload(engine,player,module,damage){
    const radius=module.radius*engine.stats.area;
    engine.spawnShockwave({
      x:player.x,y:player.y,radius,damage,
      knockback:module.knockback,color:'#8fd8ff',ring:true
    });
    engine.camera.addShake(.28);
    engine.audio.play('scramble',{volume:.9});
    engine.addFloatingText(player.x,player.y-40,'CORE VENT','#8fd8ff');
    return true;
  },

  // One overcharged round that does not stop. Rewards lining a corridor up.
  lance(engine,player,module,damage){
    const dir=aim(player);
    engine.spawnPlayerProjectile({
      x:player.x+dir.x*24,y:player.y+dir.y*24,
      vx:dir.x*module.speed,vy:dir.y*module.speed,
      damage,radius:9,pierce:module.pierce,life:1.6,
      color:'#dff5f2'
    });
    engine.camera.addShake(.2);
    engine.audio.play('laser',{volume:.9});
    return true;
  },

  // Paints an area. The mark is a multiplier every source respects, so it is
  // worth most to an operative who already puts out a lot of damage.
  marker(engine,player,module,damage){
    const dir=aim(player);
    const x=player.x+dir.x*180, y=player.y+dir.y*180;
    const radius=module.radius*engine.stats.area;
    const marked=engine.enemyHash.query(x,y,radius,scratch);
    let hits=0;
    for(const enemy of marked){
      if(enemy.dead)continue;
      if(dist2(x,y,enemy.x,enemy.y)>radius*radius)continue;
      enemy.markedTimer=module.markDuration;
      enemy.markedMult=module.markMult;
      hits++;
    }
    // Nothing in the blast means nothing was marked. Don't spend the charge.
    if(!hits)return false;
    engine.spawnShockwave({x,y,radius,damage,knockback:0,color:'#f5d27a',ring:true});
    engine.addFloatingText(x,y-30,`${hits} MARKED`,'#f5d27a');
    engine.audio.play('tech',{volume:.8});
    return true;
  },

  // Left where the operative stands, armed on a short fuse. For disengaging.
  anchor(engine,player,module,damage){
    engine.spawnMine({
      x:player.x,y:player.y,
      blastRadius:module.radius*engine.stats.area,
      damage,armTime:module.fuse,life:14,
      knockback:300
    });
    engine.audio.play('tech',{volume:.7});
    engine.addFloatingText(player.x,player.y-40,'ANCHOR SET','#ff6b6b');
    return true;
  }
};
