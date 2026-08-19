import {ALL_WEAPON_FORMS,MAX_WEAPON_LEVEL,evolutionFor} from '../../data/weapons.js';
import {PASSIVES_BY_ID,MAX_PASSIVE_LEVEL} from '../../data/passives.js';
import {clamp,dist,dist2,normalize,TAU} from '../core/math.js';
import {applyMods} from './gunsmith.js';

// Weapon runtime. Every behavior declared in data/weapons.js has a concrete
// implementation here; a weapon instance owns its own timers and any persistent
// entities it spawns (orbiters, turrets, mines, phantoms).

export class WeaponInstance{
  constructor(defId,level=1,mods=null){
    this.def=ALL_WEAPON_FORMS[defId];
    this.id=defId;
    this.level=level;
    // Gunsmith build modifiers, resolved once before the run starts. Only the
    // weapon the operative deployed with carries them; weapons picked up as
    // in-run adaptations are stock.
    this.mods=mods||null;
    this.cooldown=0;
    this.kills=0;
    this.damageDealt=0;
    this.orbiters=[];
    this.entities=[];   // turrets / mines / phantoms owned by this weapon
    this.tickTimer=0;
    this.evolved=!!this.def.base;
  }

  get name(){return this.def.name}
  get maxed(){return this.evolved||this.level>=MAX_WEAPON_LEVEL}

  // Resolve a scaled stat for the current level. Array entries in `scaling`
  // are per-level deltas; numbers are applied linearly.
  stat(key,stats){
    const def=this.def;
    let value=def[key]??0;
    const scale=def.scaling?.[key];
    if(Array.isArray(scale)){
      for(let l=0;l<this.level-1&&l<scale.length;l++)value+=scale[l];
    }else if(typeof scale==='number'){
      value+=scale*(this.level-1);
    }
    // The fitted build lands last, on top of level scaling, so an attachment
    // reads the same way at level 1 and level 8.
    return applyMods(this.mods,key,value);
  }

  // Damage after weapon level, global damage multipliers and weapon category.
  damage(stats){
    return this.stat('damage',stats)*stats.damage;
  }

  interval(stats){
    const base=Math.max(.05,this.stat('cooldown',stats));
    return base*stats.cooldown/Math.max(.15,stats.fireRate);
  }

  levelUp(){
    if(this.level<MAX_WEAPON_LEVEL)this.level++;
    return this.level;
  }

  // Swap this instance in place to its evolved form.
  evolve(evolutionDef){
    this.def=evolutionDef;
    this.id=evolutionDef.id;
    this.level=MAX_WEAPON_LEVEL;
    this.evolved=true;
    this.cooldown=0;
    this.orbiters.length=0;
  }
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

function acquireTarget(mode,engine,weapon){
  const player=engine.player;
  // An optic reaches for contacts beyond the weapon's own effective range:
  // glass finds the target, the barrel decides what happens next.
  const acquisition=weapon.mods?.optic?.acquisition||1;
  const range=(weapon.stat('range',engine.stats)||900)*acquisition;
  const candidates=engine.enemyHash.query(player.x,player.y,range,targetScratch);

  switch(mode){
    case 'strongest':{
      let best=null,bestScore=-1;
      for(const enemy of candidates){
        if(enemy.dead)continue;
        if(dist2(player.x,player.y,enemy.x,enemy.y)>range*range)continue;
        const score=enemy.hp*(enemy.elite?2.2:1)*(enemy.boss?6:1);
        if(score>bestScore){bestScore=score;best=enemy}
      }
      return best||engine.boss;
    }
    case 'random':{
      const inRange=[];
      for(const enemy of candidates){
        if(!enemy.dead&&dist2(player.x,player.y,enemy.x,enemy.y)<=range*range)inRange.push(enemy);
      }
      if(engine.boss)inRange.push(engine.boss);
      return inRange.length?inRange[Math.floor(engine.rng.next()*inRange.length)]:null;
    }
    case 'nearest':
    default:{
      // Distance is measured to the target's surface, then discounted by
      // target value. Without the discount a boss is never selected while any
      // trash is on screen, so the encounter simply cannot be fought.
      let best=null,bestScore=Infinity;
      for(const enemy of candidates){
        if(enemy.dead)continue;
        const d=Math.sqrt(dist2(player.x,player.y,enemy.x,enemy.y))-enemy.radius;
        if(d>range)continue;
        const score=d*(enemy.elite?PRIORITY.elite:1);
        if(score<bestScore){bestScore=score;best=enemy}
      }
      const boss=engine.boss;
      if(boss){
        const d=Math.sqrt(dist2(player.x,player.y,boss.x,boss.y))-boss.radius;
        if(d<range&&d*PRIORITY.boss<bestScore)best=boss;
      }
      return best;
    }
  }
}

// Wraps acquisition so the renderer knows what the fitted optic is looking at.
function acquireAndMark(mode,engine,weapon){
  const target=acquireTarget(mode,engine,weapon);
  if(weapon.mods?.optic&&target&&!target.dead){
    engine.opticTarget=target;
    engine.opticTargetAt=engine.elapsed;
  }
  return target;
}

const targetScratch=[];

// Auto-target value weighting: lower means higher priority for the same
// distance. Applied to surface distance in `nearest` acquisition.
const PRIORITY={boss:.3,elite:.7};

// Direction the weapon should fire in, honouring manual aim when the player
// is actively aiming and auto-target otherwise.
function fireDirection(engine,weapon,target){
  const player=engine.player;
  if(engine.manualAim&&weapon.def.targeting==='facing'){
    return{x:Math.cos(player.angle),y:Math.sin(player.angle)};
  }
  if(target){
    const d=normalize(target.x-player.x,target.y-player.y);
    if(d.m>0)return d;
  }
  return{x:Math.cos(player.angle),y:Math.sin(player.angle)};
}

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

const BEHAVIORS={
  // Straight-line projectiles fanned by `spread`.
  projectile(weapon,engine,stats){
    const target=acquireAndMark(weapon.def.targeting,engine,weapon);
    if(!target&&!engine.manualAim)return false;
    const dir=fireDirection(engine,weapon,target);
    const count=Math.max(1,Math.round(weapon.stat('count',stats)+stats.amount));
    const spread=weapon.stat('spread',stats);
    const speed=weapon.stat('speed',stats)*stats.projectileSpeed;
    const damage=weapon.damage(stats);
    const baseAngle=Math.atan2(dir.y,dir.x);

    for(let i=0;i<count;i++){
      const offset=count>1?(i-(count-1)/2)*spread*2:(engine.rng.next()-.5)*spread;
      const angle=baseAngle+offset;
      engine.spawnPlayerProjectile({
        x:engine.player.x+Math.cos(angle)*16,
        y:engine.player.y+Math.sin(angle)*16,
        vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,
        damage,radius:4,pierce:weapon.stat('pierce',stats),
        knockback:weapon.stat('knockback',stats),
        life:(weapon.stat('range',stats)||600)/speed,
        weapon,color:'#ffe08a',trail:true
      });
    }
    engine.muzzleFlash(baseAngle,count>2?1.3:1);
    engine.audio.play(weapon.def.sound||'shoot',{volume:.9});
    return true;
  },

  // Fires `count` rounds sequentially rather than as one volley.
  burst(weapon,engine,stats){
    const target=acquireAndMark(weapon.def.targeting,engine,weapon);
    if(!target&&!engine.manualAim)return false;
    const count=Math.max(1,Math.round(weapon.stat('count',stats)+stats.amount));
    const delay=weapon.def.burstDelay||.075;
    for(let i=0;i<count;i++){
      engine.scheduleAction(i*delay,()=>{
        const live=target&&!target.dead?target:acquireTarget(weapon.def.targeting,engine,weapon);
        const dir=fireDirection(engine,weapon,live);
        const angle=Math.atan2(dir.y,dir.x)+(engine.rng.next()-.5)*weapon.stat('spread',stats)*2;
        const speed=weapon.stat('speed',stats)*stats.projectileSpeed;
        engine.spawnPlayerProjectile({
          x:engine.player.x+Math.cos(angle)*16,y:engine.player.y+Math.sin(angle)*16,
          vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,
          damage:weapon.damage(stats),radius:3.5,pierce:weapon.stat('pierce',stats),
          knockback:weapon.stat('knockback',stats),
          life:(weapon.stat('range',stats)||500)/speed,
          weapon,color:'#ffd98a',trail:true
        });
        engine.muzzleFlash(angle,.8);
        engine.audio.play('shoot',{volume:.7});
      });
    }
    return true;
  },

  // Tight cone of short-lived pellets with damage falloff.
  shotgun(weapon,engine,stats){
    const target=acquireAndMark(weapon.def.targeting,engine,weapon);
    if(!target&&!engine.manualAim)return false;
    const dir=fireDirection(engine,weapon,target);
    const baseAngle=Math.atan2(dir.y,dir.x);
    const pellets=Math.max(1,Math.round(weapon.stat('count',stats)+stats.amount*2));
    const spread=weapon.stat('spread',stats);
    const speed=weapon.stat('speed',stats)*stats.projectileSpeed;
    const range=weapon.stat('range',stats)*stats.area;

    for(let i=0;i<pellets;i++){
      const angle=baseAngle+(engine.rng.next()-.5)*spread;
      const velocity=speed*(.85+engine.rng.next()*.3);
      engine.spawnPlayerProjectile({
        x:engine.player.x+Math.cos(angle)*14,y:engine.player.y+Math.sin(angle)*14,
        vx:Math.cos(angle)*velocity,vy:Math.sin(angle)*velocity,
        damage:weapon.damage(stats),radius:3,pierce:0,
        knockback:weapon.stat('knockback',stats),
        life:range/velocity,falloff:weapon.def.falloff,
        weapon,color:'#ffc978'
      });
    }
    engine.muzzleFlash(baseAngle,1.7);
    engine.camera.addShake(.09);
    engine.audio.play(weapon.def.sound||'shootHeavy',{volume:1});
    return true;
  },

  // High-velocity piercing round; the evolved form detonates at the end.
  railshot(weapon,engine,stats){
    const target=acquireAndMark(weapon.def.targeting,engine,weapon);
    if(!target&&!engine.manualAim)return false;
    const dir=fireDirection(engine,weapon,target);
    const angle=Math.atan2(dir.y,dir.x);
    const speed=weapon.stat('speed',stats)*stats.projectileSpeed;
    const count=Math.max(1,Math.round(weapon.stat('count',stats)+stats.amount*.5));
    for(let i=0;i<count;i++){
      const a=angle+(i-(count-1)/2)*.06;
      engine.spawnPlayerProjectile({
        x:engine.player.x+Math.cos(a)*18,y:engine.player.y+Math.sin(a)*18,
        vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,
        damage:weapon.damage(stats),radius:5,
        pierce:weapon.stat('pierce',stats),
        knockback:weapon.stat('knockback',stats),
        life:(weapon.stat('range',stats)||900)/speed,
        critBonus:weapon.stat('critBonus',stats),
        blastRadius:weapon.def.blastRadius?weapon.def.blastRadius*stats.area:0,
        weapon,color:'#e8f6ff',heavy:true,trail:true
      });
    }
    engine.muzzleFlash(angle,2.1);
    engine.camera.addShake(.14);
    engine.audio.play(weapon.def.sound||'shootHeavy',{volume:1.1});
    return true;
  },

  // Pierces everything on the line and optionally leaves a burning corridor.
  piercebolt(weapon,engine,stats){
    const target=acquireAndMark(weapon.def.targeting,engine,weapon);
    const dir=fireDirection(engine,weapon,target);
    const angle=Math.atan2(dir.y,dir.x);
    const speed=weapon.stat('speed',stats)*stats.projectileSpeed;
    const count=Math.max(1,Math.round(weapon.stat('count',stats)+stats.amount));
    for(let i=0;i<count;i++){
      const a=angle+(i-(count-1)/2)*.14;
      engine.spawnPlayerProjectile({
        x:engine.player.x+Math.cos(a)*18,y:engine.player.y+Math.sin(a)*18,
        vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,
        damage:weapon.damage(stats),radius:6,pierce:99,
        knockback:weapon.stat('knockback',stats),
        life:(weapon.stat('range',stats)||800)/speed,
        status:weapon.def.statusEffect,statusChance:weapon.def.statusChance,
        scorchTrail:weapon.def.scorchTrail,
        weapon,color:'#9be8ff',beam:true,trail:true
      });
    }
    engine.muzzleFlash(angle,1.6);
    engine.audio.play(weapon.def.sound||'laser',{volume:.95});
    return true;
  },

  // Arcing charge that detonates after a fuse, optionally splitting first.
  lobbed(weapon,engine,stats){
    const count=Math.max(1,Math.round(weapon.stat('count',stats)+stats.amount));
    for(let i=0;i<count;i++){
      const target=acquireAndMark(weapon.def.targeting,engine,weapon);
      const angle=target
        ?Math.atan2(target.y-engine.player.y,target.x-engine.player.x)+(engine.rng.next()-.5)*.5
        :engine.rng.angle();
      const speed=weapon.stat('speed',stats)*stats.projectileSpeed;
      engine.spawnGrenade({
        x:engine.player.x,y:engine.player.y,
        vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,
        fuse:(weapon.def.fuse||.9)*stats.duration,
        damage:weapon.damage(stats),
        blastRadius:weapon.stat('blastRadius',stats)*stats.area,
        knockback:weapon.stat('knockback',stats),
        cluster:weapon.def.cluster||0,
        weapon
      });
    }
    engine.audio.play('shoot',{volume:.6});
    return true;
  },

  // Proximity mines placed around the operative, capped by `maxActive`.
  mine(weapon,engine,stats){
    const maxActive=Math.round(weapon.stat('maxActive',stats));
    weapon.entities=weapon.entities.filter(e=>!e.dead);
    if(weapon.entities.length>=maxActive)return false;
    const count=Math.min(
      Math.max(1,Math.round(weapon.stat('count',stats)+stats.amount)),
      maxActive-weapon.entities.length
    );
    for(let i=0;i<count;i++){
      const angle=engine.rng.angle();
      const distance=engine.rng.range(40,130);
      const mine=engine.spawnMine({
        x:engine.player.x+Math.cos(angle)*distance,
        y:engine.player.y+Math.sin(angle)*distance,
        damage:weapon.damage(stats),
        blastRadius:weapon.stat('blastRadius',stats)*stats.area,
        armTime:weapon.def.armTime||.5,
        life:(weapon.def.lifetime||22)*stats.duration,
        knockback:weapon.stat('knockback',stats),
        weapon
      });
      weapon.entities.push(mine);
    }
    engine.audio.play('tech',{volume:.5});
    return true;
  },

  // Continuously-maintained ring of orbiting drones.
  orbit(weapon,engine,stats){
    const desired=Math.max(1,Math.round(weapon.stat('count',stats)+stats.amount));
    while(weapon.orbiters.length<desired)weapon.orbiters.push({phase:weapon.orbiters.length,hitTimers:new Map()});
    while(weapon.orbiters.length>desired)weapon.orbiters.pop();
    return false; // handled entirely by tick()
  },

  // Sustained damage field centred on the operative.
  aura(weapon,engine,stats){return false},

  // Expanding shockwave ring.
  pulse(weapon,engine,stats){
    const radius=weapon.stat('radius',stats)*stats.area;
    engine.spawnShockwave({
      x:engine.player.x,y:engine.player.y,
      radius,damage:weapon.damage(stats),
      knockback:weapon.stat('knockback',stats),
      status:weapon.def.statusEffect,statusChance:weapon.def.statusChance,
      color:'#8fd8ff',weapon
    });
    engine.camera.addShake(.16);
    engine.audio.play(weapon.def.sound||'scramble',{volume:.9});
    return true;
  },

  // Wide melee sweep in front of the operative.
  arc(weapon,engine,stats){
    const target=acquireTarget('nearest',engine,weapon);
    const dir=fireDirection(engine,weapon,target);
    const angle=Math.atan2(dir.y,dir.x);
    engine.spawnMeleeArc({
      x:engine.player.x,y:engine.player.y,angle,
      arc:weapon.stat('arc',stats),
      reach:weapon.stat('reach',stats)*stats.area,
      damage:weapon.damage(stats),
      knockback:weapon.stat('knockback',stats),
      weapon
    });
    engine.audio.play(weapon.def.sound||'laser',{volume:.85});
    return true;
  },

  // Seeking missiles that steer toward independent targets.
  homing(weapon,engine,stats){
    const count=Math.max(1,Math.round(weapon.stat('count',stats)+stats.amount));
    const speed=weapon.stat('speed',stats)*stats.projectileSpeed;
    for(let i=0;i<count;i++){
      const target=acquireTarget('random',engine,weapon);
      const launch=engine.rng.angle();
      engine.spawnPlayerProjectile({
        x:engine.player.x+Math.cos(launch)*12,y:engine.player.y+Math.sin(launch)*12,
        vx:Math.cos(launch)*speed*.5,vy:Math.sin(launch)*speed*.5,
        damage:weapon.damage(stats),radius:4,pierce:0,
        blastRadius:weapon.stat('blastRadius',stats)*stats.area,
        knockback:weapon.stat('knockback',stats),
        life:(weapon.stat('range',stats)||640)/speed*2.2,
        homing:{turnRate:weapon.stat('turnRate',stats),speed,target},
        weapon,color:'#ffb35c',trail:true,smoke:true
      });
    }
    engine.audio.play('shoot',{volume:.7});
    return true;
  },

  // Instant hitscan beam that persists and ticks for a duration.
  beam(weapon,engine,stats){
    const beams=weapon.def.beams||1;
    for(let i=0;i<beams;i++){
      const target=acquireTarget(beams>1?'random':weapon.def.targeting,engine,weapon);
      const dir=fireDirection(engine,weapon,target);
      engine.spawnBeam({
        x:engine.player.x,y:engine.player.y,
        angle:Math.atan2(dir.y,dir.x),
        length:weapon.stat('range',stats),
        width:weapon.stat('beamWidth',stats)*stats.area,
        duration:weapon.stat('beamDuration',stats)*stats.duration,
        tickInterval:weapon.def.tickInterval||.09,
        damage:weapon.damage(stats),
        knockback:weapon.stat('knockback',stats),
        followPlayer:true,weapon
      });
    }
    engine.camera.addShake(.1);
    engine.audio.play(weapon.def.sound||'laser',{volume:1});
    return true;
  },

  // Damage that arcs between nearby targets with per-hop falloff.
  chain(weapon,engine,stats){
    const first=acquireTarget('nearest',engine,weapon);
    if(!first)return false;
    const maxChains=Math.round(weapon.stat('chains',stats));
    const chainRange=weapon.stat('chainRange',stats)*stats.area;
    const falloff=weapon.def.falloffPerChain??.12;
    const hit=new Set();
    let current=first;
    let damage=weapon.damage(stats);
    const points=[{x:engine.player.x,y:engine.player.y}];

    for(let hop=0;hop<=maxChains&&current;hop++){
      hit.add(current);
      points.push({x:current.x,y:current.y});
      engine.damageEnemy(current,damage,{
        weapon,source:'chain',
        status:weapon.def.statusEffect,statusChance:weapon.def.statusChance
      });
      damage*=(1-falloff);
      // Next hop: nearest unhit enemy within chain range.
      const candidates=engine.enemyHash.query(current.x,current.y,chainRange,targetScratch);
      let next=null,bestD=chainRange*chainRange;
      for(const enemy of candidates){
        if(enemy.dead||hit.has(enemy))continue;
        const d=dist2(current.x,current.y,enemy.x,enemy.y);
        if(d<bestD){bestD=d;next=enemy}
      }
      current=next;
    }
    engine.spawnChainVfx(points,'#b6ff8a');
    engine.audio.play(weapon.def.sound||'tech',{volume:.8});
    return true;
  },

  // Deployable autonomous turrets.
  turret(weapon,engine,stats){
    const maxActive=Math.round(weapon.stat('maxActive',stats));
    weapon.entities=weapon.entities.filter(e=>!e.dead);
    if(weapon.entities.length>=maxActive)return false;
    const count=Math.min(
      Math.max(1,Math.round(weapon.stat('count',stats))),
      maxActive-weapon.entities.length
    );
    for(let i=0;i<count;i++){
      const angle=engine.rng.angle();
      const turret=engine.spawnTurret({
        x:engine.player.x+Math.cos(angle)*54,
        y:engine.player.y+Math.sin(angle)*54,
        damage:weapon.damage(stats),
        fireRate:(weapon.def.turretFireRate||.45)*stats.cooldown,
        range:(weapon.def.turretRange||290)*stats.area,
        life:weapon.stat('turretLife',stats)*stats.duration,
        projectileSpeed:(weapon.def.speed||600)*stats.projectileSpeed,
        weapon
      });
      weapon.entities.push(turret);
    }
    engine.audio.play('tech',{volume:.7});
    return true;
  },

  // Designated strike: a marked zone that is bombarded after a delay.
  orbital(weapon,engine,stats){
    const count=Math.max(1,Math.round(weapon.stat('count',stats)+stats.amount));
    for(let i=0;i<count;i++){
      const target=acquireTarget('random',engine,weapon);
      const x=target?target.x+engine.rng.range(-40,40):engine.player.x+engine.rng.range(-260,260);
      const y=target?target.y+engine.rng.range(-40,40):engine.player.y+engine.rng.range(-260,260);
      engine.spawnOrbitalStrike({
        x,y,
        delay:(weapon.def.delay||1.3),
        damage:weapon.damage(stats),
        blastRadius:weapon.stat('blastRadius',stats)*stats.area,
        knockback:weapon.stat('knockback',stats),
        implode:weapon.def.implode,
        weapon
      });
    }
    engine.audio.play('tech',{volume:.6});
    return true;
  },

  // Reanimates fallen hostiles as temporary allies.
  summon(weapon,engine,stats){
    const maxActive=Math.round(weapon.stat('maxActive',stats));
    weapon.entities=weapon.entities.filter(e=>!e.dead);
    if(weapon.entities.length>=maxActive)return false;
    const phantom=engine.spawnPhantom({
      damage:weapon.damage(stats),
      life:weapon.stat('minionLife',stats)*stats.duration,
      speed:weapon.def.minionSpeed||190,
      hp:weapon.def.minionHp||60,
      weapon
    });
    if(phantom){
      weapon.entities.push(phantom);
      engine.audio.play('tech',{volume:.7});
      return true;
    }
    return false;
  }
};

// Per-frame upkeep for behaviors that are continuous rather than triggered.
const TICKERS={
  orbit(weapon,engine,stats,dt){
    const radius=weapon.stat('orbitRadius',stats)*stats.area;
    const speed=weapon.stat('orbitSpeed',stats);
    const hitInterval=Math.max(.08,(weapon.def.hitInterval||.42)*stats.cooldown);
    const damage=weapon.damage(stats);
    const count=weapon.orbiters.length||1;
    weapon.orbitAngle=(weapon.orbitAngle||0)+speed*dt;

    weapon.orbiters.forEach((orbiter,index)=>{
      const angle=weapon.orbitAngle+index/count*TAU;
      orbiter.x=engine.player.x+Math.cos(angle)*radius;
      orbiter.y=engine.player.y+Math.sin(angle)*radius;
      orbiter.angle=angle;

      const nearby=engine.enemyHash.query(orbiter.x,orbiter.y,26,targetScratch);
      for(const enemy of nearby){
        if(enemy.dead)continue;
        if(dist2(orbiter.x,orbiter.y,enemy.x,enemy.y)>(enemy.radius+14)**2)continue;
        const last=orbiter.hitTimers.get(enemy)||-99;
        if(engine.elapsed-last<hitInterval)continue;
        orbiter.hitTimers.set(enemy,engine.elapsed);
        engine.damageEnemy(enemy,damage,{weapon,knockback:weapon.stat('knockback',stats),source:'orbit'});
      }
      // Evolved form intercepts hostile projectiles.
      if(weapon.def.intercept)engine.interceptProjectilesNear(orbiter.x,orbiter.y,22);
    });
  },

  aura(weapon,engine,stats,dt){
    const interval=Math.max(.05,weapon.stat('tickInterval',stats)*stats.cooldown);
    weapon.tickTimer-=dt;
    if(weapon.tickTimer>0)return;
    weapon.tickTimer=interval;

    const radius=weapon.stat('radius',stats)*stats.area;
    const damage=weapon.damage(stats);
    weapon.auraRadius=radius;
    const nearby=engine.enemyHash.query(engine.player.x,engine.player.y,radius,targetScratch);
    let hits=0;
    for(const enemy of nearby){
      if(enemy.dead)continue;
      if(dist2(engine.player.x,engine.player.y,enemy.x,enemy.y)>radius*radius)continue;
      engine.damageEnemy(enemy,damage,{
        weapon,source:'aura',
        status:weapon.def.statusEffect,
        statusChance:weapon.stat('statusChance',stats)
      });
      hits++;
    }
    if(hits&&weapon.def.lifesteal)engine.healPlayer(damage*weapon.def.lifesteal*hits);
    if(hits)engine.audio.play('hit',{volume:.35});
  }
};

// ---------------------------------------------------------------------------
// Loadout: owns weapon instances, passive ranks and the derived stat block.
// ---------------------------------------------------------------------------

export class Loadout{
  constructor(engine,baseStatBlock){
    this.engine=engine;
    this.weapons=[];
    this.passives=new Map();   // passiveId -> rank
    this.baseStats=baseStatBlock;
    this.stats={...baseStatBlock};
    this.dirty=true;
  }

  addWeapon(id,mods=null){
    const existing=this.weapons.find(w=>w.id===id);
    if(existing){existing.levelUp();this.dirty=true;return existing}
    const instance=new WeaponInstance(id,1,mods);
    this.weapons.push(instance);
    this.dirty=true;
    return instance;
  }

  addPassive(id){
    const rank=Math.min(MAX_PASSIVE_LEVEL,(this.passives.get(id)||0)+1);
    this.passives.set(id,rank);
    this.dirty=true;
    return rank;
  }

  weaponLevel(id){return this.weapons.find(w=>w.id===id)?.level||0}
  passiveLevel(id){return this.passives.get(id)||0}

  // Recompute the derived stat block from base + passives + external modifiers.
  recompute(externalModifiers={}){
    const stats={...this.baseStats};
    for(const [id,rank] of this.passives){
      const passive=PASSIVES_BY_ID[id];
      if(!passive)continue;
      const contribute=(key,perLevel)=>{
        const value=perLevel*rank;
        // Multiplicative stats start at 1 and accumulate additively on top.
        if(MULTIPLICATIVE.has(key))stats[key]=(stats[key]??1)+value;
        else stats[key]=(stats[key]??0)+value;
      };
      contribute(passive.stat,passive.perLevel);
      if(passive.secondary)contribute(passive.secondary.stat,passive.secondary.perLevel);
    }
    for(const [key,value] of Object.entries(externalModifiers)){
      if(MULTIPLICATIVE.has(key))stats[key]=(stats[key]??1)+value;
      else stats[key]=(stats[key]??0)+value;
    }
    // Guard rails so no combination can produce a nonsensical value.
    stats.cooldown=clamp(stats.cooldown,.2,3);
    stats.fireRate=clamp(stats.fireRate,.25,6);
    stats.moveSpeed=clamp(stats.moveSpeed,.4,3);
    stats.critChance=clamp(stats.critChance,0,1);
    stats.dodge=clamp(stats.dodge,0,.75);
    stats.area=clamp(stats.area,.4,4);
    stats.damage=Math.max(.1,stats.damage);
    this.stats=stats;
    this.dirty=false;
    return stats;
  }

  // Checks every carried weapon for a satisfied evolution requirement.
  checkEvolutions(){
    const forged=[];
    for(const weapon of this.weapons){
      if(weapon.evolved||weapon.level<MAX_WEAPON_LEVEL)continue;
      const evolution=evolutionFor(weapon.id);
      if(!evolution)continue;
      if(this.passiveLevel(evolution.passive)<MAX_PASSIVE_LEVEL)continue;
      weapon.evolve(evolution);
      forged.push(evolution);
    }
    return forged;
  }

  update(dt,engine){
    const stats=this.stats;
    for(const weapon of this.weapons){
      const ticker=TICKERS[weapon.def.behavior];
      if(ticker)ticker(weapon,engine,stats,dt);

      const behavior=BEHAVIORS[weapon.def.behavior];
      if(!behavior)continue;
      const interval=weapon.interval(stats);
      // Continuous behaviors declare a zero cooldown and never trigger here.
      if(interval<=0.05&&(weapon.def.behavior==='orbit'||weapon.def.behavior==='aura')){
        if(weapon.def.behavior==='orbit')behavior(weapon,engine,stats);
        continue;
      }
      weapon.cooldown-=dt;
      if(weapon.cooldown>0)continue;
      const fired=behavior(weapon,engine,stats);
      weapon.cooldown=fired?interval:Math.min(interval,.25);
    }
  }

  // Live description of a weapon's current numbers, for the HUD and menus.
  describe(weapon){
    const stats=this.stats;
    return{
      name:weapon.name,level:weapon.level,evolved:weapon.evolved,
      damage:Math.round(weapon.damage(stats)),
      interval:weapon.interval(stats),
      dps:Math.round(weapon.damage(stats)/Math.max(.08,weapon.interval(stats))*
        Math.max(1,weapon.stat('count',stats)))
    };
  }
}

// Stats that are ratios rather than flat additions.
const MULTIPLICATIVE=new Set([
  'damage','fireRate','area','projectileSpeed','duration','moveSpeed',
  'magnet','xpGain','luck','cooldown','critDamage'
]);

export {BEHAVIORS,acquireTarget};
