import {Rng} from '../core/rng.js';
import {Camera} from '../core/camera.js';
import {clamp,damp,dist,dist2,normalize,compact,SpatialHash,TAU} from '../core/math.js';
import {World} from './world.js';
import {Director} from './director.js';
import {EnemyBrain,AI_STATES} from './ai.js';
import {Loadout} from './weapons.js';
import {Boss} from './boss.js';
import {Objectives} from './objectives.js';
import {Fx} from './fx.js';
import {ABILITIES,TRAITS,distanceToSegment} from './abilities.js';
import {ENEMIES_BY_ID,STATUS_EFFECTS} from '../../data/enemies.js';
import {BOSSES_BY_ID,MINIBOSSES} from '../../data/bosses.js';
import {baseStats} from '../../data/passives.js';
import {WEAPONS_BY_ID} from '../../data/weapons.js';
import {devBonuses} from '../../data/meta.js';
import {masteryBonuses} from '../../data/operatives.js';

// The simulation. One class, one update path — replacing the previous
// Gameplay → Polished → Enhanced → Projectile → Tactical chain where each
// layer re-ran and then undid the layer beneath it.

const FIXED_STEP=1/60;
const MAX_STEPS=5;
export const EXTRACTION_RADIUS=95;
export const EXTRACTION_HOLD=2.5;

export class Engine{
  constructor(canvas,config){
    this.canvas=canvas;
    this.config=config;
    this.settings=config.settings;
    this.audio=config.audio;
    this.rng=new Rng(config.seed??Math.floor(Math.random()*1e9));

    this.operative=config.operative;
    this.map=config.map;
    this.difficulty=config.difficulty;
    this.durationMinutes=config.duration;

    this.camera=new Camera(canvas.width,canvas.height);
    this.camera.resize(canvas.width,canvas.height);
    this.world=new World(this.map,{
      seed:this.rng.int(0,1e9),
      sizeMult:clamp(.75+config.duration/28,.8,1.6)
    });
    this.fx=new Fx(this.settings);

    // ---- Entity stores ----------------------------------------------------
    this.enemies=[];
    this.projectiles=[];      // player-owned
    this.enemyProjectiles=[];
    this.grenades=[];
    this.mines=[];
    this.turrets=[];
    this.phantoms=[];
    this.pickups=[];
    this.beams=[];
    this.shockwaves=[];
    this.strikes=[];
    this.fields=[];
    this.meleeArcs=[];
    this.decoys=[];
    this.scheduled=[];
    this.effects=new Map();

    this.enemyHash=new SpatialHash(120);
    this.pickupHash=new SpatialHash(160);

    // ---- Run state --------------------------------------------------------
    this.elapsed=0;
    this.accumulator=0;
    this.timeRemaining=config.duration*60;
    this.extraction=false;
    this.extractionTimer=25;
    this.extractionPoint=null;
    this.paused=false;
    this.ended=false;
    this.victory=false;
    this.timeDilation=1;
    this.frame=0;

    this.level=1;
    this.xp=0;
    this.xpNeeded=8;
    this.pendingLevelUps=0;
    this.kills=0;
    this.combo=0;
    this.comboTimer=0;
    this.maxCombo=0;
    this.credits=0;
    this.jp=0;
    this.boss=null;
    this.bossesDefeated=[];
    this.announcements=[];

    // ---- Telemetry --------------------------------------------------------
    this.telemetry={
      kills:0,eliteKills:0,minionKills:0,hazardKills:0,
      damageDealt:0,damageTaken:0,healingDone:0,criticalHits:0,
      xpCollected:0,pickups:0,distance:0,dashes:0,abilitiesUsed:0,
      maxAlive:0,evolutions:[]
    };

    // ---- Modifier hooks (set by traits and meta upgrades) ------------------
    this.forgetRateMult=1;
    this.enemyAccuracyPenalty=0;
    this.abilityCooldownMult=1;
    this.explosionSizeMult=1;
    this.eliteDamageMult=1;
    this.playerDamageTakenMult=1;
    this.detectionMult=1;
    this.flatArmor=false;
    this.manualAim=false;

    // ---- Personnel recovery ------------------------------------------------
    // Operatives whose file has not been recovered yet. A run can surface at
    // most `maxDossiers` of them, and only through personnel caches.
    this.discoverable=[...(config.discoverable||[])];
    this.discovered=[];
    this.maxDossiers=2;
    this.dossiersSpawned=0;

    this.setupPlayer();
    this.setupLoadout();
    this.director=new Director(this,{
      difficulty:this.difficulty,duration:config.duration,map:this.map
    });
    this.objectives=new Objectives(this);
    this.applyTrait('onInit');

    this.camera.x=this.player.x;
    this.camera.y=this.player.y;
    this.extractionPoint=this.world.extractionPoint(this.player);
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  setupPlayer(){
    const spawn=this.world.playerSpawn();
    const op=this.operative;
    const dev=devBonuses(this.config.devRanks||{});
    const mastery=masteryBonuses(this.config.masteryXp||0);

    const maxHp=Math.round(
      (op.hp+(dev.maxHp||0)+(mastery.maxHp||0))*(1+(op.stats?.maxHp||0)/100)
    );

    this.player={
      x:spawn.x,y:spawn.y,vx:0,vy:0,
      radius:13,angle:-Math.PI/2,
      hp:maxHp,maxHp,
      baseSpeed:op.speed,
      armor:op.armor+(dev.armor||0)+(mastery.armor||0),
      hitFlash:0,invulnerable:0,
      dashCooldown:0,dashTimer:0,dashDirX:0,dashDirY:0,
      abilityCooldown:0,abilityMax:op.ability.cooldown,
      shieldTimer:0,shieldAngle:0,shieldReflect:false,
      damageBuff:1,damageBuffTimer:0,
      revives:(dev.revives||0),
      regenAccumulator:0,
      knockbackResist:0,
      statuses:new Map(),
      walkPhase:0,
      alive:true
    };
    this.devBonuses=dev;
    this.masteryBonuses=mastery;
    this.detectionMult=1+(dev.detection||0);
  }

  setupLoadout(){
    const base=baseStats();
    const op=this.operative;
    // Operative stat profile, development tree and mastery all fold into the
    // base block before any in-run passives are applied.
    for(const [key,value] of Object.entries(op.stats||{})){
      if(key==='maxHp')continue;
      base[key]=MULTIPLICATIVE.has(key)?value:(base[key]||0)+value;
    }
    const dev=this.devBonuses;
    for(const [key,value] of Object.entries(dev)){
      if(['maxHp','armor','revives','extraChoice','rerolls','banishes','startingWeapons','startLevel','abilityCooldown','detection','creditGain','eliteDamage'].includes(key))continue;
      base[key]=MULTIPLICATIVE.has(key)?(base[key]??1)+value:(base[key]??0)+value;
    }
    for(const [key,value] of Object.entries(this.masteryBonuses)){
      if(['maxHp','armor'].includes(key))continue;
      base[key]=MULTIPLICATIVE.has(key)?(base[key]??1)+value:(base[key]??0)+value;
    }

    this.loadout=new Loadout(this,base);
    this.loadout.addWeapon(op.weapon);
    // "Expanded Loadout" grants a second starting weapon.
    if(dev.startingWeapons&&this.config.secondWeapon){
      this.loadout.addWeapon(this.config.secondWeapon);
    }
    this.loadout.recompute();
    this.stats=this.loadout.stats;
    this.player.abilityMax=op.ability.cooldown*(1+(dev.abilityCooldown||0))*this.abilityCooldownMult;

    this.rerolls=dev.rerolls||0;
    this.banishes=dev.banishes||0;
    this.extraChoice=!!dev.extraChoice;
    this.eliteDamageMult=1+(dev.eliteDamage||0);
    this.creditGainMult=1+(dev.creditGain||0);

    // "Vanguard Doctrine" starts the run already levelled.
    if(dev.startLevel){
      for(let i=0;i<dev.startLevel;i++)this.pendingLevelUps++;
      this.level+=dev.startLevel;
    }
  }

  applyTrait(hook,...args){
    const trait=TRAITS[this.operative.trait.id];
    trait?.[hook]?.(this,...args);
  }

  resize(width,height){
    this.camera.resize(width,height);
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------

  // Fixed-timestep simulation with an accumulator, so behaviour is identical
  // at 30, 60 and 144 Hz. The previous build scaled everything by a variable
  // dt clamped to 33ms, which made high-refresh displays play differently.
  update(realDt,input){
    if(this.ended)return;
    this.frame++;

    if(this.fx.hitStop>0){
      this.fx.hitStop-=realDt;
      this.fx.update(realDt*.25);
      return;
    }
    if(this.paused||this.pendingLevelUps>0){
      this.fx.update(realDt*.3);
      this.camera.update(realDt,0);
      return;
    }

    this.accumulator+=Math.min(realDt,.25);
    let steps=0;
    while(this.accumulator>=FIXED_STEP&&steps<MAX_STEPS){
      this.step(FIXED_STEP,input);
      this.accumulator-=FIXED_STEP;
      steps++;
      if(this.ended||this.pendingLevelUps>0)break;
    }
    // Bail out of a death spiral rather than compounding lag.
    if(steps>=MAX_STEPS)this.accumulator=0;

    this.fx.update(realDt);
    this.camera.follow(this.player,this.aimLead,realDt);
    this.camera.update(realDt,this.settings.screenShake??1);
    this.audio.setIntensity(clamp(this.enemies.length/70+(this.boss?.4:0),0,1));
  }

  step(dt,input){
    this.elapsed+=dt;
    this.dt=dt;

    this.updateTimers(dt);
    this.updateInput(dt,input);
    this.rebuildHashes();
    this.world.update(dt,this);
    this.director.update(dt);

    const enemyDt=dt*this.timeDilation;
    this.updatePlayer(dt);
    this.updateEnemies(enemyDt);
    this.updateBoss(enemyDt);
    this.loadout.update(dt,this);
    this.updateProjectiles(dt,enemyDt);
    this.updateOwnedEntities(dt);
    this.updatePickups(dt);
    this.updateAreaEffects(dt);
    this.updateHazards(dt);
    this.updateScheduled(dt);
    this.updateEffects(dt);
    this.updateStatuses(dt);
    this.objectives.update(dt);

    this.cullEntities();
    this.checkRunState();
  }

  updateTimers(dt){
    if(!this.extraction){
      this.timeRemaining-=dt;
      if(this.timeRemaining<=0){
        this.timeRemaining=0;
        this.beginExtraction();
      }
    }else{
      this.extractionTimer-=dt;
      if(this.extractionTimer<=0)this.finish(false,'EXTRACTION WINDOW MISSED');
    }

    this.comboTimer-=dt;
    if(this.comboTimer<=0&&this.combo>0){
      this.maxCombo=Math.max(this.maxCombo,this.combo);
      this.combo=0;
    }

    let write=0;
    for(const announcement of this.announcements){
      announcement.life-=dt;
      if(announcement.life>0)this.announcements[write++]=announcement;
    }
    this.announcements.length=write;

    this.telemetry.maxAlive=Math.max(this.telemetry.maxAlive,this.enemies.length);
  }

  updateInput(dt,input){
    const player=this.player;
    player.dashCooldown=Math.max(0,player.dashCooldown-dt);
    player.abilityCooldown=Math.max(0,player.abilityCooldown-dt);

    const aim=input.aimVector(this.camera,player);
    this.manualAim=aim.manual&&!this.settings.autoAim===false?aim.manual:aim.manual;
    if(aim.manual){
      player.angle=Math.atan2(aim.y,aim.x);
      this.aimLead={x:aim.x,y:aim.y};
    }else{
      this.aimLead=null;
    }

    if(input.takeAction('dash')&&player.dashCooldown<=0){
      const moving=Math.hypot(input.moveX,input.moveY)>.1;
      const dirX=moving?input.moveX:Math.cos(player.angle);
      const dirY=moving?input.moveY:Math.sin(player.angle);
      const dir=normalize(dirX,dirY);
      player.dashDirX=dir.x;player.dashDirY=dir.y;
      player.dashTimer=.18;
      player.dashCooldown=1.15;
      player.invulnerable=Math.max(player.invulnerable,.22);
      this.telemetry.dashes++;
      this.fx.burst(player.x,player.y,10,{speed:180,life:.3,color:this.operative.color,drag:.9});
      this.audio.play('dash',{volume:.7});
      this.applyTrait('onDash',this.player);
    }

    if(input.takeAction('ability')&&player.abilityCooldown<=0){
      const ability=ABILITIES[this.operative.ability.id];
      if(ability&&ability(this,player)){
        player.abilityCooldown=player.abilityMax;
        this.telemetry.abilitiesUsed++;
      }
    }

    this.moveInput={x:input.moveX,y:input.moveY};
  }

  rebuildHashes(){
    this.enemyHash.rebuild(this.enemies);
    this.pickupHash.rebuild(this.pickups);
  }

  // -------------------------------------------------------------------------
  // Player
  // -------------------------------------------------------------------------

  updatePlayer(dt){
    const player=this.player;
    const stats=this.stats;

    player.hitFlash=Math.max(0,player.hitFlash-dt);
    player.invulnerable=Math.max(0,player.invulnerable-dt);
    if(player.damageBuffTimer>0){
      player.damageBuffTimer-=dt;
      if(player.damageBuffTimer<=0)player.damageBuff=1;
    }
    if(player.shieldTimer>0)player.shieldTimer-=dt;

    // Regeneration from passives and the development tree.
    const regen=(stats.regen||0)+(this.devBonuses.regen||0);
    if(regen>0&&player.hp<player.maxHp){
      player.regenAccumulator+=regen*dt;
      if(player.regenAccumulator>=1){
        const amount=Math.floor(player.regenAccumulator);
        player.regenAccumulator-=amount;
        this.healPlayer(amount,true);
      }
    }

    let speed=player.baseSpeed*stats.moveSpeed;
    // Terrain and status modifiers.
    const terrain=this.world.passiveHazardAt(player.x,player.y);
    if(terrain?.slow)speed*=1-terrain.slow;
    for(const [,status] of player.statuses)if(status.slow)speed*=1-status.slow;

    if(player.dashTimer>0){
      player.dashTimer-=dt;
      const dashSpeed=speed*4.2;
      player.vx=player.dashDirX*dashSpeed;
      player.vy=player.dashDirY*dashSpeed;
      if(this.frame%2===0){
        this.fx.particle({
          x:player.x,y:player.y,vx:0,vy:0,life:.24,size:9,
          color:this.operative.color,kind:'circle',drag:1
        });
      }
    }else{
      const move=this.moveInput||{x:0,y:0};
      const targetVx=move.x*speed;
      const targetVy=move.y*speed;
      const acceleration=terrain?.friction?18*terrain.friction:18;
      player.vx=damp(player.vx,targetVx,acceleration,dt);
      player.vy=damp(player.vy,targetVy,acceleration,dt);
      if(!this.manualAim&&(move.x||move.y))player.angle=Math.atan2(move.y,move.x);
    }

    const previousX=player.x,previousY=player.y;
    player.x+=player.vx*dt;
    player.y+=player.vy*dt;
    this.world.resolveCollision(player,player.radius);
    this.telemetry.distance+=dist(previousX,previousY,player.x,player.y);
    player.walkPhase+=Math.hypot(player.vx,player.vy)*dt*.05;

    if(player.hp<=0)this.playerDown();
  }

  playerDown(){
    const player=this.player;
    if(player.revives>0){
      player.revives--;
      player.hp=Math.round(player.maxHp*.45);
      player.invulnerable=2.4;
      this.fx.flash('#76e7d4',.5);
      this.fx.ring(player.x,player.y,20,320,.7,'#76e7d4',5);
      this.camera.addShake(.45);
      this.audio.play('unlock',{volume:1});
      this.announce('EMERGENCY PROTOCOL ENGAGED','#76e7d4');
      // Clear immediate threats so the revive is not instantly wasted.
      this.spawnShockwave({x:player.x,y:player.y,radius:340,damage:60,knockback:520,color:'#76e7d4'});
      return;
    }
    player.alive=false;
    this.finish(false,'OPERATIVE SIGNAL LOST');
  }

  damagePlayer(amount,options={}){
    const player=this.player;
    if(this.ended||player.invulnerable>0||player.dashTimer>0)return 0;

    // Dodge chance from passives and training.
    const dodge=(this.stats.dodge||0)+(this.devBonuses.dodge||0);
    if(dodge>0&&this.rng.next()<dodge){
      this.fx.text(player.x,player.y-26,'EVADED','#8fd8ff',{size:11});
      this.audio.play('dash',{volume:.4});
      return 0;
    }

    // Directional shield blocks (and can reflect) frontal damage.
    if(player.shieldTimer>0&&options.fromX!==undefined){
      const incoming=Math.atan2(options.fromY-player.y,options.fromX-player.x);
      let delta=Math.abs(((incoming-player.shieldAngle+Math.PI)%TAU+TAU)%TAU-Math.PI);
      if(delta<.9){
        this.fx.ring(player.x,player.y,24,52,.2,'#ffb35c',3);
        this.audio.play('shield',{volume:.5});
        if(player.shieldReflect&&options.projectile){
          options.projectile.vx*=-1;options.projectile.vy*=-1;
          options.projectile.reflected=true;
          options.projectile.damage*=2;
          return 0;
        }
        return 0;
      }
    }

    // Armor: flat reduction for BASTION, percentage for everyone else.
    const armor=player.armor;
    let final=this.flatArmor
      ?Math.max(amount*.15,amount-armor)
      :amount*(1-clamp(armor/(armor+42),0,.72));
    final*=this.playerDamageTakenMult;
    final=Math.max(1,final);

    player.hp-=final;
    player.hitFlash=.16;
    player.invulnerable=Math.max(player.invulnerable,.36);
    this.telemetry.damageTaken+=final;

    this.camera.addShake(clamp(final/player.maxHp*1.6,.08,.5));
    this.fx.flash('#ff4a4a',clamp(final/player.maxHp*1.2,.1,.5));
    this.fx.blood(player.x,player.y,'#ff6b6b',1);
    this.audio.play('hurt',{volume:clamp(final/30,.4,1)});
    if(this.settings.damageNumbers)this.fx.text(player.x,player.y-30,`-${Math.round(final)}`,'#ff7a7a',{size:13});

    if(player.hp<=0)this.playerDown();
    return final;
  }

  healPlayer(amount,silent=false){
    const player=this.player;
    const healed=Math.min(amount,player.maxHp-player.hp);
    if(healed<=0)return 0;
    player.hp+=healed;
    this.telemetry.healingDone+=healed;
    if(!silent){
      this.fx.text(player.x,player.y-30,`+${Math.round(healed)}`,'#8bff9b',{size:12});
      this.fx.ring(player.x,player.y,10,44,.3,'#8bff9b',2);
    }
    return healed;
  }

  blinkPlayer(x,y){
    const player=this.player;
    const clampedX=clamp(x,30,this.world.width-30);
    const clampedY=clamp(y,30,this.world.height-30);
    this.spawnBlinkVfx(player.x,player.y,player.radius,this.operative.color);
    player.x=clampedX;player.y=clampedY;
    this.world.resolveCollision(player,player.radius);
    this.spawnBlinkVfx(player.x,player.y,player.radius,this.operative.color);
    player.invulnerable=Math.max(player.invulnerable,.3);
  }

  // -------------------------------------------------------------------------
  // Enemies
  // -------------------------------------------------------------------------

  spawnEnemy(archetype,x,y,options={}){
    if(this.enemies.length>=this.director.enemyCap)return null;
    const difficulty=this.difficulty;
    const progress=this.director.progress;
    // Health and damage ramp with contract progress and difficulty. The
    // curve is deliberately shallow: hostile *count* is the primary pressure
    // source, so durability must not outrun the player's weapon scaling.
    const hpScale=(1+progress*1.6)*difficulty.hpMult*(options.hpMult||1);
    const damageScale=(1+progress*.8)*difficulty.damageMult*(options.damageMult||1);

    const enemy={
      ...archetype,
      archetype,
      x,y,vx:0,vy:0,
      radius:archetype.radius*(options.scale||1),
      hp:archetype.hp*hpScale,
      maxHp:archetype.hp*hpScale,
      damage:archetype.damage*damageScale,
      speed:archetype.speed*difficulty.speedMult,
      armor:archetype.armor||0,
      angle:0,
      dead:false,
      elite:!!options.elite,
      hitFlash:0,
      statuses:new Map(),
      stunTimer:0,
      confusedTimer:0,
      speedMult:1,
      damageMult:1,
      buffMult:1,
      shieldMult:1,
      chargeTimer:0,
      modifiers:options.modifiers||[],
      xpValue:archetype.xp*(options.xpMult||1),
      creditValue:archetype.credits*(options.creditMult||1),
      jpValue:options.jp||0,
      walkPhase:this.rng.next()*10,
      squad:null
    };
    EnemyBrain.init(enemy,archetype);
    this.enemies.push(enemy);
    return enemy;
  }

  spawnEliteEnemy(eliteDef,x,y){
    const base=ENEMIES_BY_ID[eliteDef.base];
    if(!base)return null;
    const enemy=this.spawnEnemy(base,x,y,{
      elite:true,
      hpMult:eliteDef.hpMult,damageMult:eliteDef.damageMult,
      scale:eliteDef.radiusMult,
      modifiers:eliteDef.modifiers,
      xpMult:eliteDef.xp/Math.max(1,base.xp),
      creditMult:eliteDef.credits/Math.max(1,base.credits),
      jp:eliteDef.jp
    });
    if(!enemy)return null;
    enemy.name=eliteDef.name;
    enemy.color=eliteDef.color;
    enemy.render=eliteDef.render;
    enemy.speed*=eliteDef.speedMult;
    enemy.eliteDef=eliteDef;
    // "Fragile" elites trade durability for speed and damage.
    if(enemy.modifiers.includes('fragile')){enemy.hp*=.6;enemy.maxHp*=.6}
    if(enemy.modifiers.includes('permacloak'))enemy.cloaked=true;
    return enemy;
  }

  spawnMiniboss(spec){
    const eliteDef=[...(this.eliteDefs||[])];
    const base=spec.base;
    const eliteSource=(this.config.elites||[]).find?.(e=>e.id===base);
    const elite=eliteSource||ELITE_FALLBACK[base];
    if(!elite)return null;
    const angle=this.rng.angle();
    const point=this.world.findSpawn(this.rng,{
      x:this.player.x+Math.cos(angle)*600,
      y:this.player.y+Math.sin(angle)*600
    },0,240);
    const enemy=this.spawnEliteEnemy(elite,point.x,point.y);
    if(!enemy)return null;
    enemy.hp*=spec.hpMult;enemy.maxHp*=spec.hpMult;
    enemy.radius*=spec.scale;
    enemy.miniboss=true;
    enemy.name=spec.name;
    this.announce(`${spec.name} DEPLOYED`,'#ff8b68');
    this.audio.play('boss',{volume:.7});
    this.camera.addShake(.3);
    return enemy;
  }

  spawnEscortSquad(unitId,count,origin){
    const archetype=ENEMIES_BY_ID[unitId];
    if(!archetype)return;
    for(let i=0;i<count;i++){
      const angle=i/count*TAU;
      const point=this.world.findSpawn(this.rng,{
        x:(origin?.x??this.player.x)+Math.cos(angle)*260,
        y:(origin?.y??this.player.y)+Math.sin(angle)*260
      },0,160);
      const enemy=this.spawnEnemy(archetype,point.x,point.y);
      if(enemy){
        enemy.awareness=1;
        enemy.memory=6;
        this.fx.ring(point.x,point.y,4,50,.35,'#ff7068',2);
      }
    }
  }

  updateEnemies(dt){
    const player=this.player;
    const context=this.aiContext(dt);

    for(const enemy of this.enemies){
      if(enemy.dead)continue;
      enemy.hitFlash=Math.max(0,enemy.hitFlash-dt);
      enemy.walkPhase+=dt*6;

      // Support and guardian auras buff or shield nearby allies.
      enemy.buffMult=1;
      enemy.shieldMult=1;

      if(enemy.confusedTimer>0){
        enemy.confusedTimer-=dt;
        // Confused units wander instead of pursuing.
        enemy.vx=damp(enemy.vx,Math.cos(enemy.walkPhase)*enemy.speed*.5,4,dt);
        enemy.vy=damp(enemy.vy,Math.sin(enemy.walkPhase)*enemy.speed*.5,4,dt);
      }else if(enemy.chargeTimer>0){
        enemy.chargeTimer-=dt;
        enemy.vx=enemy.chargeVx;
        enemy.vy=enemy.chargeVy;
        // Breachers demolish cover they run through.
        if(enemy.breaksCover)this.breakCoverAround(enemy);
        if(dist(enemy.x,enemy.y,player.x,player.y)<enemy.radius+player.radius+4){
          this.damagePlayer(enemy.damage*1.5,{source:enemy,fromX:enemy.x,fromY:enemy.y});
          enemy.chargeTimer=0;
        }
      }else{
        EnemyBrain.update(enemy,dt,context);
      }

      enemy.x+=enemy.vx*dt;
      enemy.y+=enemy.vy*dt;
      const corrected=this.world.resolveCollision(enemy,enemy.radius);
      if(corrected&&enemy.chargeTimer>0)enemy.chargeTimer=0;
      enemy.angle=Math.atan2(player.y-enemy.y,player.x-enemy.x);

      this.applyEnemyAuras(enemy,dt);
    }

    // Auras applied after positions settle so the reads are consistent.
    this.applySupportAuras();
  }

  aiContext(dt){
    return{
      dt,
      player:this.player,
      world:this.world,
      detectionMult:this.detectionMult,
      forgetRate:1.2*this.forgetRateMult,
      speedMult:this.timeDilation,
      fireRateMult:1/Math.max(.2,this.timeDilation),
      telegraphMult:1,
      playerHidden:false,
      neighboursOf:enemy=>this.enemyHash.query(enemy.x,enemy.y,90,neighbourScratch),
      nearbyAllies:(enemy,radius)=>{
        const found=this.enemyHash.query(enemy.x,enemy.y,radius,neighbourScratch);
        let count=0;
        for(const other of found)if(!other.dead)count++;
        return count;
      },
      claimCoverPoint:(enemy,player)=>this.claimCoverPoint(enemy,player),
      fireEnemyShot:(enemy,spec)=>this.fireEnemyShot(enemy,spec),
      fireMortar:(enemy,spec)=>this.fireMortar(enemy,spec),
      meleeHit:(enemy,damage)=>this.enemyMelee(enemy,damage),
      detonateEnemy:enemy=>this.detonateEnemy(enemy),
      blinkEnemy:(enemy,range)=>this.blinkEnemy(enemy,range),
      onWindup:(enemy,action,duration)=>this.onEnemyWindup(enemy,action,duration),
      onEnrage:enemy=>{
        this.fx.ring(enemy.x,enemy.y,enemy.radius,enemy.radius*3.5,.4,'#ff5b30',3);
        this.audio.play('alarm',{volume:.4});
      }
    };
  }

  // Cover points are claimed so two enemies never occupy the same spot.
  claimCoverPoint(enemy,player){
    if(enemy.coverPoint)enemy.coverPoint.claimedBy=null;
    const points=this.world.coverPoints;
    if(!points.length)return null;
    let best=null,bestScore=-Infinity;
    // Sample a subset — scanning every cover point for every enemy each time
    // one repaths would be needlessly expensive with hundreds of units.
    const samples=Math.min(points.length,42);
    for(let i=0;i<samples;i++){
      const point=points[Math.floor(this.rng.next()*points.length)];
      if(point.claimedBy&&point.claimedBy!==enemy&&!point.claimedBy.dead)continue;
      const toEnemy=dist(point.x,point.y,enemy.x,enemy.y);
      if(toEnemy>640)continue;
      const toPlayer=dist(point.x,point.y,player.x,player.y);
      // Want: close to us, at our preferred engagement range, and protected.
      const protection=this.world.hasLineOfSight(point.x,point.y,player.x,player.y)?0:220;
      const rangeFit=-Math.abs(toPlayer-enemy.preferredRange)*.8;
      const score=protection+rangeFit-toEnemy*.5;
      if(score>bestScore){bestScore=score;best=point}
    }
    if(best){best.claimedBy=enemy;enemy.coverPoint=best}
    return best;
  }

  applyEnemyAuras(enemy,dt){
    // Passive hazards damage hostiles too, which the previous build never did.
    const terrain=this.world.passiveHazardAt(enemy.x,enemy.y);
    if(terrain?.affectsEnemies&&terrain.damage){
      enemy.hazardTick=(enemy.hazardTick||0)-dt;
      if(enemy.hazardTick<=0){
        enemy.hazardTick=terrain.interval||.5;
        this.damageEnemy(enemy,terrain.damage,{source:'hazard',status:terrain.status,statusChance:1});
      }
    }
    if(terrain?.slow)enemy.speedMult=1-terrain.slow*.6;
    else if(!enemy.enraged)enemy.speedMult=1;
  }

  applySupportAuras(){
    for(const source of this.enemies){
      if(source.dead)continue;
      const radius=source.auraRadius||source.shieldRadius;
      if(!radius)continue;
      const affected=this.enemyHash.query(source.x,source.y,radius,neighbourScratch);
      for(const target of affected){
        if(target.dead||target===source)continue;
        if(dist2(source.x,source.y,target.x,target.y)>radius*radius)continue;
        if(source.buffAmount)target.buffMult=Math.max(target.buffMult,1+source.buffAmount);
        if(source.shieldAmount)target.shieldMult=Math.min(target.shieldMult,1-source.shieldAmount);
      }
    }
  }

  breakCoverAround(enemy){
    for(const cover of this.world.cover){
      if(cover.broken||!cover.destructible)continue;
      if(Math.abs(cover.x-enemy.x)>cover.hw+enemy.radius)continue;
      if(Math.abs(cover.y-enemy.y)>cover.hh+enemy.radius)continue;
      if(this.world.damageCover(cover,9999)){
        this.fx.explosion(cover.x,cover.y,60,'#c6a45e');
        this.camera.addShake(.12);
      }
    }
  }

  onEnemyWindup(enemy,action,duration){
    const color=action==='shot'?'#ff5b5b':action==='detonate'?'#ffa14f':'#ffb35c';
    this.fx.ring(enemy.x,enemy.y,enemy.radius,enemy.radius*2.2,duration,color,2);
    if(action==='detonate')this.audio.play('alarm',{volume:.35});
  }

  fireEnemyShot(enemy,spec={}){
    const player=this.player;
    const accuracy=clamp((spec.accuracy??.85)-this.enemyAccuracyPenalty,.2,1);
    // Lead the target, then degrade the solution by the unit's accuracy.
    const travelTime=dist(enemy.x,enemy.y,player.x,player.y)/(spec.speed||250);
    const aimX=player.x+player.vx*travelTime*accuracy;
    const aimY=player.y+player.vy*travelTime*accuracy;
    const baseAngle=Math.atan2(aimY-enemy.y,aimX-enemy.x);
    const error=(1-accuracy)*.55;
    const angle=baseAngle+(this.rng.next()-.5)*error*2;

    this.spawnEnemyProjectile({
      x:enemy.x+Math.cos(angle)*(enemy.radius+4),
      y:enemy.y+Math.sin(angle)*(enemy.radius+4),
      vx:Math.cos(angle)*(spec.speed||250),
      vy:Math.sin(angle)*(spec.speed||250),
      damage:(spec.damage??enemy.damage)*enemy.buffMult,
      radius:spec.tracer?4:3.4,
      color:spec.tracer?'#ff5b5b':enemy.color||'#ffcf73',
      life:4,piercing:spec.piercing,source:enemy
    });
    this.fx.muzzle(enemy.x+Math.cos(angle)*enemy.radius,enemy.y+Math.sin(angle)*enemy.radius,angle,.6);
    this.audio.play('shoot',{volume:.35});
  }

  fireMortar(enemy,spec){
    const player=this.player;
    this.spawnOrbitalStrike({
      x:player.x+player.vx*.6,y:player.y+player.vy*.6,
      delay:spec.delay||1.5,
      damage:spec.damage*enemy.buffMult,
      blastRadius:spec.radius||96,
      knockback:200,hostile:true,color:'#bfa672'
    });
    this.audio.play('shootHeavy',{volume:.5});
  }

  enemyMelee(enemy,damage){
    this.damagePlayer(damage*enemy.buffMult,{source:enemy,fromX:enemy.x,fromY:enemy.y});
    this.fx.burst(
      (enemy.x+this.player.x)/2,(enemy.y+this.player.y)/2,5,
      {speed:140,life:.2,color:'#ff8a6b'}
    );
  }

  detonateEnemy(enemy){
    this.spawnExplosion({
      x:enemy.x,y:enemy.y,
      radius:(enemy.blastRadius||104)*this.explosionSizeMult,
      damage:enemy.damage*2,knockback:340,color:'#ffa14f',hostile:true
    });
    this.killEnemy(enemy,{silent:true,noDrops:true});
  }

  blinkEnemy(enemy,range){
    for(let attempt=0;attempt<10;attempt++){
      const angle=this.rng.angle();
      const distance=range*(.5+this.rng.next()*.6);
      const x=this.player.x+Math.cos(angle)*distance;
      const y=this.player.y+Math.sin(angle)*distance;
      if(!this.world.isInside(x,y,40)||this.world.overlapsSolid(x,y,enemy.radius))continue;
      this.spawnBlinkVfx(enemy.x,enemy.y,enemy.radius,'#b58cff');
      enemy.x=x;enemy.y=y;
      this.spawnBlinkVfx(x,y,enemy.radius,'#b58cff');
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Damage pipeline
  // -------------------------------------------------------------------------

  damageEnemy(target,amount,options={}){
    if(!target||target.dead)return 0;

    const stats=this.stats;
    let damage=amount*this.player.damageBuff;

    // Elite/boss damage bonus from the development tree.
    if(target.elite||target.boss)damage*=this.eliteDamageMult;

    // Critical strike.
    let crit=!!options.crit;
    if(!crit){
      const chance=clamp((stats.critChance||0)+(options.critBonus||0),0,1);
      crit=this.rng.next()<chance;
    }
    if(crit){
      damage*=stats.critDamage||1.8;
      this.telemetry.criticalHits++;
      this.applyTrait('onCrit',target);
    }

    // Target defences: armor, corrosion shred and guardian shielding.
    const shred=target.statuses?.get('corrode')?.armorShred||0;
    const armor=Math.max(0,(target.armor||0)*(1-shred));
    damage*=1-clamp(armor/(armor+55),0,.7);
    damage*=target.shieldMult??1;
    // Marked and corroded targets take extra damage.
    for(const [,status] of target.statuses||[]){
      if(status.damageTaken)damage*=1+status.damageTaken;
    }

    // Shield troopers block most frontal damage.
    if(target.shieldArc&&options.fromX!==undefined){
      const incoming=Math.atan2(options.fromY-target.y,options.fromX-target.x);
      const facing=Math.atan2(this.player.y-target.y,this.player.x-target.x);
      const delta=Math.abs(((incoming-facing+Math.PI)%TAU+TAU)%TAU-Math.PI);
      if(delta<target.shieldArc/2){
        damage*=1-(target.shieldReduction||.82);
        this.fx.ring(target.x,target.y,target.radius,target.radius+14,.16,'#e0c982',2);
      }
    }

    damage=Math.max(1,damage);

    const applied=target.boss?target.takeDamage(damage):(target.hp-=damage,target.hitFlash=.1,damage);
    this.telemetry.damageDealt+=applied;
    if(options.weapon){
      options.weapon.damageDealt+=applied;
    }

    // Lifesteal.
    const lifesteal=stats.lifesteal||0;
    if(lifesteal>0)this.healPlayer(applied*lifesteal,true);

    // Status application.
    if(options.status&&this.rng.next()<(options.statusChance??1)){
      this.applyStatus(target,options.status,1);
    }

    // Knockback, resisted by heavies.
    if(options.knockback&&!target.boss){
      const resist=1-(target.knockbackResist||0);
      const dir=normalize(target.x-this.player.x,target.y-this.player.y);
      const force=options.knockback*resist*.35*(this.world.globalHazards.find(h=>h.knockbackMult)?.knockbackMult||1);
      target.vx+=dir.x*force;
      target.vy+=dir.y*force;
    }

    // Feedback.
    if(this.settings.damageNumbers){
      this.fx.text(target.x,target.y-target.radius-6,Math.round(applied),
        crit?'#ffd166':'#eaf6f4',{damage:true,crit,size:crit?15:11});
    }
    this.fx.impact(target.x,target.y,options.angle??0,crit?'#ffd166':'#d5f0ef',crit?1.6:1);
    this.audio.play(crit?'crit':'hit',{volume:crit?.7:.4});
    if(crit)this.fx.freeze(.02);

    if(target.hp<=0){
      if(target.boss)this.killBoss(target);
      else this.killEnemy(target,{weapon:options.weapon,source:options.source});
    }
    return applied;
  }

  applyStatus(target,statusId,stacks=1){
    if(!target||target.dead)return;
    const spec=STATUS_EFFECTS[statusId];
    if(!spec)return;
    // Shock only stuns machines; it slows everything else.
    if(!target.statuses)target.statuses=new Map();
    const existing=target.statuses.get(statusId);
    const duration=spec.duration*(this.stats.duration||1);
    if(existing){
      existing.timer=duration;
      existing.stacks=Math.min(spec.stacks||1,existing.stacks+stacks);
    }else{
      target.statuses.set(statusId,{
        ...spec,id:statusId,timer:duration,stacks:Math.min(spec.stacks||1,stacks),tickTimer:0
      });
    }
    if(statusId==='shock'&&spec.stunMachines&&target.machine){
      target.stunTimer=Math.max(target.stunTimer||0,1.1);
    }
  }

  updateStatuses(dt){
    const tick=(entity)=>{
      if(!entity.statuses?.size)return;
      for(const [id,status] of entity.statuses){
        status.timer-=dt;
        if(status.timer<=0){entity.statuses.delete(id);continue}
        if(status.tickDamage){
          status.tickTimer-=dt;
          if(status.tickTimer<=0){
            status.tickTimer=status.tickInterval||.5;
            const damage=status.tickDamage*status.stacks;
            if(entity===this.player)this.damagePlayer(damage,{source:'status'});
            else{
              entity.hp-=damage;
              this.fx.particle({
                x:entity.x+(this.rng.next()-.5)*entity.radius,
                y:entity.y+(this.rng.next()-.5)*entity.radius,
                vx:0,vy:-30,life:.35,size:2.4,color:status.color,glow:true
              });
              if(entity.hp<=0&&!entity.dead){
                if(entity.boss)this.killBoss(entity);else this.killEnemy(entity,{});
              }
            }
          }
        }
      }
    };
    for(const enemy of this.enemies)if(!enemy.dead)tick(enemy);
    if(this.boss)tick(this.boss);
    tick(this.player);
  }

  killEnemy(enemy,options={}){
    if(enemy.dead)return;
    enemy.dead=true;
    this.kills++;
    this.combo++;
    this.comboTimer=3.2;
    this.maxCombo=Math.max(this.maxCombo,this.combo);
    this.telemetry.kills++;
    if(enemy.elite)this.telemetry.eliteKills++;
    if(options.source==='hazard')this.telemetry.hazardKills++;
    if(options.weapon)options.weapon.kills++;
    enemy.squad?.remove(enemy);

    this.fx.death(enemy.x,enemy.y,enemy.color,enemy.elite);
    this.world.addDecal(enemy.x,enemy.y,enemy.radius*(enemy.elite?2.2:1.4),
      enemy.machine?'#2a3a40':'#4a1f22',enemy.elite?.4:.28);
    this.audio.play('kill',{volume:enemy.elite?.8:.35});
    if(enemy.elite){this.camera.addShake(.16);this.fx.freeze(.035)}

    if(!options.noDrops)this.dropLoot(enemy);
    this.applyTrait('onKill',enemy);

    // Elite death modifiers.
    if(enemy.modifiers?.includes('splitOnDeath')){
      const base=ENEMIES_BY_ID[enemy.eliteDef?.base||'pursuit'];
      for(let i=0;i<2;i++){
        const spawned=this.spawnEnemy(base,
          enemy.x+this.rng.range(-30,30),enemy.y+this.rng.range(-30,30),
          {hpMult:1.6,damageMult:1.2});
        if(spawned)spawned.awareness=1;
      }
    }
    if(enemy.modifiers?.includes('shockwaveOnCharge')){
      this.spawnShockwave({x:enemy.x,y:enemy.y,radius:180,damage:enemy.damage,
        knockback:300,color:'#ff8b68',hostile:true});
    }
  }

  killBoss(boss){
    if(boss.dead&&this.bossesDefeated.includes(boss.id))return;
    boss.dead=true;
    this.bossesDefeated.push(boss.id);
    this.boss=null;

    this.jp+=boss.def.jp;
    this.credits+=boss.def.credits;
    this.addXp(boss.def.xp);

    // A death sequence with weight, rather than the old instant despawn.
    for(let i=0;i<10;i++){
      this.scheduleAction(i*.12,()=>{
        const angle=this.rng.angle();
        const distance=this.rng.range(0,boss.radius);
        this.fx.explosion(
          boss.x+Math.cos(angle)*distance,boss.y+Math.sin(angle)*distance,
          70,boss.def.color
        );
        this.camera.addShake(.3);
        this.audio.play('explode',{volume:.8});
      });
    }
    this.fx.flash(boss.def.color,.5);
    this.fx.freeze(.12);
    this.announce('COMMAND SIGNATURE TERMINATED',boss.def.color);
    this.audio.play('victory',{volume:.9});

    // Guaranteed reward drops.
    for(let i=0;i<8;i++){
      const angle=this.rng.angle();
      this.spawnPickup('credit',boss.x+Math.cos(angle)*70,boss.y+Math.sin(angle)*70,40);
    }
    this.spawnPickup('chest',boss.x,boss.y,0);
    this.spawnPickup('health',boss.x+40,boss.y,0);
    // A command signature always carries personnel records worth taking.
    this.spawnDossier(boss.x-40,boss.y);
  }

  dropLoot(enemy){
    const luck=this.stats.luck||1;
    this.spawnPickup('xp',enemy.x,enemy.y,enemy.xpValue);
    if(this.rng.next()<.11*luck)this.spawnPickup('credit',enemy.x,enemy.y,enemy.creditValue||1);
    if(this.rng.next()<.032*luck)this.spawnPickup('health',enemy.x,enemy.y,0);
    if(this.rng.next()<.008*luck)this.spawnPickup('magnet',enemy.x,enemy.y,0);
    if(this.rng.next()<.006*luck)this.spawnPickup('bomb',enemy.x,enemy.y,0);
    if(enemy.elite){
      this.jp+=enemy.jpValue||2;
      if(this.rng.next()<.3*luck)this.spawnPickup('chest',enemy.x,enemy.y,0);
      if(this.rng.next()<.03*luck)this.spawnDossier(enemy.x,enemy.y);
    }
  }

  reanimate(enemy,duration){
    const phantom=this.spawnPhantomAt(enemy.x,enemy.y,{
      damage:enemy.damage*1.4,life:duration,speed:enemy.speed*1.1,
      hp:enemy.maxHp*.5,render:enemy.render
    });
    if(phantom)this.fx.ring(enemy.x,enemy.y,6,60,.4,'#9bffb8',2);
  }

  // -------------------------------------------------------------------------
  // Boss lifecycle
  // -------------------------------------------------------------------------

  spawnBoss(bossId){
    if(this.boss)return null;
    const def=BOSSES_BY_ID[bossId];
    if(!def)return null;
    const angle=this.rng.angle();
    const point=this.world.findSpawn(this.rng,{
      x:this.player.x+Math.cos(angle)*520,
      y:this.player.y+Math.sin(angle)*520
    },0,260);
    // Boss durability tracks how strong the operative can plausibly be by the
    // time it appears: a 30-minute contract hands the player an evolved
    // loadout at level 40+, which deleted the old flat-HP bosses in seconds.
    const lengthScale=1+Math.max(0,this.durationMinutes-5)/25*2.4;
    this.boss=new Boss(def,point.x,point.y,{
      hpMult:this.difficulty.hpMult*(1+this.director.progress*.4)*lengthScale,
      damageMult:this.difficulty.damageMult,
      armorMult:1
    });
    this.onBossSpawn?.(this.boss);
    this.announce(def.name,def.color,3.4);
    this.audio.play('boss',{volume:1});
    this.camera.addShake(.6);
    this.fx.flash(def.color,.35);
    return this.boss;
  }

  updateBoss(dt){
    if(!this.boss)return;
    this.boss.update(dt,this);
    if(this.boss&&!this.boss.dead){
      // Contact damage.
      if(dist(this.boss.x,this.boss.y,this.player.x,this.player.y)<this.boss.radius+this.player.radius){
        this.damagePlayer(this.boss.def.phases[this.boss.phaseIndex].contactDamage||14,
          {source:this.boss,fromX:this.boss.x,fromY:this.boss.y});
      }
    }
  }

  // -------------------------------------------------------------------------
  // Projectiles and spawned entities
  // -------------------------------------------------------------------------

  spawnPlayerProjectile(spec){
    this.projectiles.push({
      px:spec.x,py:spec.y,pierceLeft:spec.pierce||0,hitSet:null,
      life:spec.life??2,age:0,...spec
    });
  }

  spawnEnemyProjectile(spec){
    this.enemyProjectiles.push({px:spec.x,py:spec.y,age:0,...spec});
  }

  spawnGrenade(spec){
    this.grenades.push({...spec,age:0,bounces:0});
  }

  spawnMine(spec){
    const mine={...spec,age:0,armed:false,dead:false};
    this.mines.push(mine);
    return mine;
  }

  spawnTurret(spec){
    const turret={...spec,age:0,fireTimer:0,dead:false,angle:0};
    this.turrets.push(turret);
    return turret;
  }

  spawnPhantom(spec){
    // Reanimate at the location of a recent kill if we have one.
    return this.spawnPhantomAt(
      this.player.x+this.rng.range(-50,50),
      this.player.y+this.rng.range(-50,50),
      spec
    );
  }

  spawnPhantomAt(x,y,spec){
    const phantom={
      x,y,vx:0,vy:0,radius:11,angle:0,
      hp:spec.hp||60,maxHp:spec.hp||60,
      damage:spec.damage||24,speed:spec.speed||190,
      life:spec.life||12,age:0,dead:false,
      attackTimer:0,render:spec.render||'soldier',
      weapon:spec.weapon||null
    };
    this.phantoms.push(phantom);
    return phantom;
  }

  spawnBeam(spec){
    this.beams.push({...spec,age:0,tickTimer:0,hitSet:new Set()});
  }

  spawnShockwave(spec){
    this.shockwaves.push({...spec,age:0,current:0,duration:spec.duration||.4,hitSet:new Set()});
    this.fx.ring(spec.x,spec.y,10,spec.radius,.42,spec.color||'#8fd8ff',4);
  }

  spawnOrbitalStrike(spec){
    this.strikes.push({...spec,age:0,fired:false});
  }

  spawnHostileField(spec){
    this.fields.push({...spec,age:0,tickTimer:0});
  }

  spawnMeleeArc(spec){
    this.meleeArcs.push({...spec,age:0,duration:.22,hitSet:new Set()});
  }

  spawnExplosion(spec){
    const radius=spec.radius*this.explosionSizeMult;
    this.fx.explosion(spec.x,spec.y,radius,spec.color||'#ffb35c');
    this.camera.addShake(clamp(radius/700,.08,.4));
    this.audio.play('explode',{volume:clamp(radius/180,.4,1)});
    this.world.addDecal(spec.x,spec.y,radius*.6,'#1a1210',.32,'scorch');

    if(spec.hostile){
      if(dist(spec.x,spec.y,this.player.x,this.player.y)<radius+this.player.radius){
        this.damagePlayer(spec.damage,{source:'explosion',fromX:spec.x,fromY:spec.y});
      }
      return;
    }
    const affected=this.enemyHash.query(spec.x,spec.y,radius,neighbourScratch);
    for(const enemy of affected){
      if(enemy.dead)continue;
      const distance=dist(spec.x,spec.y,enemy.x,enemy.y);
      if(distance>radius+enemy.radius)continue;
      // Falloff from the blast centre.
      const falloff=1-clamp((distance-enemy.radius)/radius,0,1)*.55;
      this.damageEnemy(enemy,spec.damage*falloff,{
        weapon:spec.weapon,knockback:spec.knockback,source:'explosion',
        status:spec.status,statusChance:spec.statusChance,
        fromX:spec.x,fromY:spec.y
      });
    }
    if(this.boss&&dist(spec.x,spec.y,this.boss.x,this.boss.y)<radius+this.boss.radius){
      this.damageEnemy(this.boss,spec.damage,{weapon:spec.weapon,source:'explosion'});
    }
    // Destructible cover in the blast.
    for(const cover of this.world.cover){
      if(cover.broken||!cover.destructible)continue;
      if(dist(spec.x,spec.y,cover.x,cover.y)>radius+Math.max(cover.hw,cover.hh))continue;
      if(this.world.damageCover(cover,spec.damage))this.fx.burst(cover.x,cover.y,10,{speed:150,color:'#c6a45e'});
    }
  }

  spawnChainVfx(points,color){this.fx.chain(points,color)}
  spawnTrailStreak(x1,y1,x2,y2,color){this.fx.streak(x1,y1,x2,y2,color,5,.28)}
  spawnBlinkVfx(x,y,radius,color){
    this.fx.ring(x,y,radius*.3,radius*2.4,.28,color,2);
    this.fx.burst(x,y,10,{speed:180,life:.3,color,drag:.9});
  }
  muzzleFlash(angle,scale){
    const player=this.player;
    this.fx.muzzle(player.x+Math.cos(angle)*18,player.y+Math.sin(angle)*18,angle,scale);
  }

  interceptProjectilesNear(x,y,radius){
    for(const projectile of this.enemyProjectiles){
      if(projectile.dead)continue;
      if(dist2(x,y,projectile.x,projectile.y)>radius*radius)continue;
      projectile.dead=true;
      this.fx.burst(projectile.x,projectile.y,5,{speed:110,life:.2,color:'#76e7d4'});
    }
  }

  clearEnemyProjectiles(convertRatio=0){
    for(const projectile of this.enemyProjectiles){
      projectile.dead=true;
      if(convertRatio&&this.rng.next()<convertRatio){
        this.fx.burst(projectile.x,projectile.y,4,{speed:90,life:.25,color:'#76e7d4'});
      }
    }
  }

  spawnDecoy(x,y,duration){
    this.decoys.push({x,y,life:duration,age:0});
    // Nearby enemies re-target the decoy's position.
    const affected=this.enemyHash.query(x,y,320,neighbourScratch);
    for(const enemy of affected){
      if(enemy.dead)continue;
      enemy.lastKnownX=x;enemy.lastKnownY=y;
      enemy.awareness=Math.min(enemy.awareness,.55);
      enemy.memory=duration;
    }
  }

  updateProjectiles(dt,enemyDt){
    // ---- Player projectiles ----
    for(const p of this.projectiles){
      p.age+=dt;
      p.life-=dt;
      if(p.life<=0){p.dead=true;continue}
      p.px=p.x;p.py=p.y;

      if(p.homing&&p.homing.target){
        const target=p.homing.target;
        if(target.dead){
          p.homing.target=this.enemyHash.nearest(p.x,p.y,420,e=>!e.dead)||this.boss;
        }else{
          const desired=Math.atan2(target.y-p.y,target.x-p.x);
          const current=Math.atan2(p.vy,p.vx);
          let delta=((desired-current+Math.PI)%TAU+TAU)%TAU-Math.PI;
          delta=clamp(delta,-p.homing.turnRate*dt,p.homing.turnRate*dt);
          const angle=current+delta;
          p.vx=Math.cos(angle)*p.homing.speed;
          p.vy=Math.sin(angle)*p.homing.speed;
        }
        if(p.smoke&&this.frame%3===0){
          this.fx.particle({x:p.x,y:p.y,vx:0,vy:0,life:.4,size:4,color:'rgba(160,160,170,.4)',kind:'circle',drag:.9});
        }
      }

      p.x+=p.vx*dt;
      p.y+=p.vy*dt;

      if(p.scorchTrail&&this.frame%4===0){
        this.spawnHostileField({x:p.x,y:p.y,radius:34,duration:2.2,damage:14,
          tickInterval:.4,color:'#ff8a4c',friendly:true});
      }

      // Geometry.
      const obstacle=this.world.raycastObstacle(p.px,p.py,p.x,p.y,true);
      if(obstacle){
        if(obstacle.destructible)this.world.damageCover(obstacle,p.damage);
        if(!p.beam){
          this.hitProjectileTerminal(p);
          continue;
        }
      }

      // Enemies.
      const candidates=this.enemyHash.query(p.x,p.y,p.radius+40,neighbourScratch);
      for(const enemy of candidates){
        if(enemy.dead)continue;
        if(p.hitSet?.has(enemy))continue;
        if(dist2(p.x,p.y,enemy.x,enemy.y)>(p.radius+enemy.radius)**2)continue;

        let damage=p.damage;
        if(p.falloff)damage*=clamp(1-p.age*1.4,.35,1);
        this.damageEnemy(enemy,damage,{
          weapon:p.weapon,knockback:p.knockback,critBonus:p.critBonus,
          status:p.status,statusChance:p.statusChance,
          angle:Math.atan2(p.vy,p.vx),fromX:p.px,fromY:p.py,source:'projectile'
        });

        if(p.pierceLeft>0){
          p.pierceLeft--;
          (p.hitSet||(p.hitSet=new Set())).add(enemy);
        }else{
          this.hitProjectileTerminal(p);
          break;
        }
      }
      if(p.dead)continue;

      // Boss.
      if(this.boss&&dist2(p.x,p.y,this.boss.x,this.boss.y)<(p.radius+this.boss.radius)**2){
        if(!p.hitSet?.has(this.boss)){
          this.damageEnemy(this.boss,p.damage,{weapon:p.weapon,critBonus:p.critBonus,source:'projectile'});
          if(p.pierceLeft>0){p.pierceLeft--;(p.hitSet||(p.hitSet=new Set())).add(this.boss)}
          else this.hitProjectileTerminal(p);
        }
      }

      if(!this.world.isInside(p.x,p.y,-40))p.dead=true;
    }

    // ---- Enemy projectiles ----
    for(const p of this.enemyProjectiles){
      p.age+=enemyDt;
      p.life-=enemyDt;
      if(p.life<=0){p.dead=true;continue}
      p.px=p.x;p.py=p.y;
      p.x+=p.vx*enemyDt;
      p.y+=p.vy*enemyDt;

      if(this.world.raycastObstacle(p.px,p.py,p.x,p.y,true)&&!p.piercing){
        p.dead=true;
        this.fx.impact(p.x,p.y,Math.atan2(p.vy,p.vx),p.color,.7);
        continue;
      }

      // Reflected projectiles hit their own side.
      if(p.reflected){
        const candidates=this.enemyHash.query(p.x,p.y,p.radius+30,neighbourScratch);
        for(const enemy of candidates){
          if(enemy.dead)continue;
          if(dist2(p.x,p.y,enemy.x,enemy.y)>(p.radius+enemy.radius)**2)continue;
          this.damageEnemy(enemy,p.damage,{source:'reflect'});
          p.dead=true;
          break;
        }
        if(p.dead)continue;
      }else if(dist2(p.x,p.y,this.player.x,this.player.y)<(p.radius+this.player.radius)**2){
        const blocked=this.damagePlayer(p.damage,{
          source:p.source,fromX:p.px,fromY:p.py,projectile:p
        });
        if(!p.reflected)p.dead=true;
        if(blocked)this.fx.impact(p.x,p.y,Math.atan2(p.vy,p.vx),'#ff7a7a',1);
        continue;
      }

      if(!this.world.isInside(p.x,p.y,-60))p.dead=true;
    }

    compact(this.projectiles,p=>!p.dead);
    compact(this.enemyProjectiles,p=>!p.dead);
  }

  hitProjectileTerminal(projectile){
    projectile.dead=true;
    if(projectile.blastRadius){
      this.spawnExplosion({
        x:projectile.x,y:projectile.y,radius:projectile.blastRadius,
        damage:projectile.damage*.8,knockback:projectile.knockback,
        weapon:projectile.weapon,color:'#ffb35c'
      });
    }else{
      this.fx.impact(projectile.x,projectile.y,Math.atan2(projectile.vy,projectile.vx),projectile.color);
    }
  }

  updateOwnedEntities(dt){
    // ---- Grenades ----
    for(const g of this.grenades){
      g.age+=dt;
      g.fuse-=dt;
      g.x+=g.vx*dt;
      g.y+=g.vy*dt;
      g.vx*=Math.pow(.965,dt*60);
      g.vy*=Math.pow(.965,dt*60);
      if(this.world.raycastObstacle(g.x-g.vx*dt,g.y-g.vy*dt,g.x,g.y,true)&&g.bounces<3){
        g.bounces++;
        g.vx*=-.55;g.vy*=-.55;
      }
      if(g.fuse<=0){
        g.dead=true;
        this.spawnExplosion({
          x:g.x,y:g.y,radius:g.blastRadius,damage:g.damage,
          knockback:g.knockback,weapon:g.weapon,color:'#ffb35c'
        });
        // Cluster munitions split on detonation.
        for(let i=0;i<(g.cluster||0);i++){
          const angle=i/g.cluster*TAU;
          this.spawnGrenade({
            x:g.x,y:g.y,
            vx:Math.cos(angle)*180,vy:Math.sin(angle)*180,
            fuse:.5,damage:g.damage*.45,blastRadius:g.blastRadius*.55,
            knockback:g.knockback*.5,cluster:0,weapon:g.weapon
          });
        }
      }
    }
    compact(this.grenades,g=>!g.dead);

    // ---- Mines ----
    for(const m of this.mines){
      m.age+=dt;
      m.life-=dt;
      if(m.life<=0){m.dead=true;continue}
      if(!m.armed){
        if(m.age>=m.armTime)m.armed=true;
        continue;
      }
      const trigger=this.enemyHash.query(m.x,m.y,m.blastRadius*.45,neighbourScratch);
      for(const enemy of trigger){
        if(enemy.dead)continue;
        if(dist2(m.x,m.y,enemy.x,enemy.y)>(m.blastRadius*.4)**2)continue;
        m.dead=true;
        this.spawnExplosion({
          x:m.x,y:m.y,radius:m.blastRadius,damage:m.damage,
          knockback:m.knockback,weapon:m.weapon,color:'#ffd166'
        });
        break;
      }
    }
    compact(this.mines,m=>!m.dead);

    // ---- Turrets / interceptor drones ----
    for(const t of this.turrets){
      t.age+=dt;
      t.life-=dt;
      if(t.life<=0){
        t.dead=true;
        this.fx.burst(t.x,t.y,8,{speed:120,life:.35,color:'#76e7d4'});
        continue;
      }
      if(t.mobile&&t.follow){
        // Interceptor drones orbit the operative.
        const angle=t.age*2.2+(t.phaseOffset??(t.phaseOffset=this.rng.next()*TAU));
        const targetX=t.follow.x+Math.cos(angle)*70;
        const targetY=t.follow.y+Math.sin(angle)*70;
        t.x=damp(t.x,targetX,6,dt);
        t.y=damp(t.y,targetY,6,dt);
      }
      t.fireTimer-=dt;
      if(t.fireTimer>0)continue;
      const target=this.enemyHash.nearest(t.x,t.y,t.range,e=>!e.dead)||
        (this.boss&&dist(t.x,t.y,this.boss.x,this.boss.y)<t.range?this.boss:null);
      if(!target)continue;
      t.fireTimer=t.fireRate;
      const angle=Math.atan2(target.y-t.y,target.x-t.x);
      t.angle=angle;
      this.spawnPlayerProjectile({
        x:t.x+Math.cos(angle)*12,y:t.y+Math.sin(angle)*12,
        vx:Math.cos(angle)*t.projectileSpeed,vy:Math.sin(angle)*t.projectileSpeed,
        damage:t.damage,radius:3,pierce:0,knockback:40,
        life:t.range/t.projectileSpeed,weapon:t.weapon,
        color:t.color||'#8ffff0',trail:true
      });
      this.fx.muzzle(t.x,t.y,angle,.5);
      this.audio.play('shoot',{volume:.22});
    }
    compact(this.turrets,t=>!t.dead);

    // ---- Phantoms ----
    for(const p of this.phantoms){
      p.age+=dt;
      p.life-=dt;
      if(p.life<=0||p.hp<=0){
        p.dead=true;
        this.fx.burst(p.x,p.y,10,{speed:140,life:.4,color:'#e0e6ea'});
        continue;
      }
      const target=this.enemyHash.nearest(p.x,p.y,420,e=>!e.dead);
      if(target){
        const dir=normalize(target.x-p.x,target.y-p.y);
        p.vx=damp(p.vx,dir.x*p.speed,6,dt);
        p.vy=damp(p.vy,dir.y*p.speed,6,dt);
        p.angle=Math.atan2(dir.y,dir.x);
        p.attackTimer-=dt;
        if(p.attackTimer<=0&&dist(p.x,p.y,target.x,target.y)<p.radius+target.radius+10){
          p.attackTimer=.7;
          // Attribute through to the summoning weapon so its damage and kill
          // totals reflect what its phantoms actually did.
          this.damageEnemy(target,p.damage,{knockback:80,source:'phantom',weapon:p.weapon});
          if(target.dead){
            this.telemetry.minionKills++;
            if(p.weapon)p.weapon.kills++;
          }
        }
      }else{
        // Idle: follow the operative.
        const dir=normalize(this.player.x-p.x,this.player.y-p.y);
        const distance=dist(p.x,p.y,this.player.x,this.player.y);
        const drive=distance>90?1:0;
        p.vx=damp(p.vx,dir.x*p.speed*drive,5,dt);
        p.vy=damp(p.vy,dir.y*p.speed*drive,5,dt);
      }
      p.x+=p.vx*dt;p.y+=p.vy*dt;
      this.world.resolveCollision(p,p.radius);
    }
    compact(this.phantoms,p=>!p.dead);

    // ---- Decoys ----
    for(const d of this.decoys){
      d.age+=dt;d.life-=dt;
      if(d.life<=0)d.dead=true;
    }
    compact(this.decoys,d=>!d.dead);
  }

  updateAreaEffects(dt){
    // ---- Beams ----
    for(const beam of this.beams){
      beam.age+=dt;
      if(beam.age>=beam.duration){beam.dead=true;continue}
      if(beam.followPlayer){beam.x=this.player.x;beam.y=this.player.y}
      else if(beam.follow){beam.x=beam.follow.x;beam.y=beam.follow.y}
      if(beam.sweep){
        beam.angle=beam.sweep.from+beam.sweep.arc*(beam.age/beam.sweep.duration);
      }
      beam.tickTimer-=dt;
      if(beam.tickTimer>0)continue;
      beam.tickTimer=beam.tickInterval;

      const endX=beam.x+Math.cos(beam.angle)*beam.length;
      const endY=beam.y+Math.sin(beam.angle)*beam.length;

      if(beam.hostile){
        if(distanceToSegment(this.player.x,this.player.y,beam.x,beam.y,endX,endY)<beam.width/2+this.player.radius){
          this.damagePlayer(beam.damage,{source:'beam',fromX:beam.x,fromY:beam.y});
        }
        continue;
      }
      const midX=(beam.x+endX)/2,midY=(beam.y+endY)/2;
      const candidates=this.enemyHash.query(midX,midY,beam.length/2+80,neighbourScratch);
      for(const enemy of candidates){
        if(enemy.dead)continue;
        if(distanceToSegment(enemy.x,enemy.y,beam.x,beam.y,endX,endY)>beam.width/2+enemy.radius)continue;
        this.damageEnemy(enemy,beam.damage,{
          weapon:beam.weapon,knockback:beam.knockback,angle:beam.angle,source:'beam'
        });
      }
      if(this.boss&&distanceToSegment(this.boss.x,this.boss.y,beam.x,beam.y,endX,endY)<beam.width/2+this.boss.radius){
        this.damageEnemy(this.boss,beam.damage,{weapon:beam.weapon,source:'beam'});
      }
    }
    compact(this.beams,b=>!b.dead);

    // ---- Shockwaves ----
    for(const wave of this.shockwaves){
      wave.age+=dt;
      const progress=clamp(wave.age/wave.duration,0,1);
      wave.current=wave.radius*(1-Math.pow(1-progress,2.2));
      if(progress>=1){wave.dead=true;continue}
      if(!wave.damage)continue;

      if(wave.hostile){
        const distance=dist(wave.x,wave.y,this.player.x,this.player.y);
        if(!wave.hitPlayer&&Math.abs(distance-wave.current)<this.player.radius+22){
          wave.hitPlayer=true;
          this.damagePlayer(wave.damage,{source:'shockwave',fromX:wave.x,fromY:wave.y});
        }
        continue;
      }
      const candidates=this.enemyHash.query(wave.x,wave.y,wave.current+50,neighbourScratch);
      for(const enemy of candidates){
        if(enemy.dead||wave.hitSet.has(enemy))continue;
        const distance=dist(wave.x,wave.y,enemy.x,enemy.y);
        if(Math.abs(distance-wave.current)>enemy.radius+26)continue;
        wave.hitSet.add(enemy);
        this.damageEnemy(enemy,wave.damage,{
          weapon:wave.weapon,knockback:wave.knockback,
          status:wave.status,statusChance:wave.statusChance,
          fromX:wave.x,fromY:wave.y,source:'shockwave'
        });
      }
      if(this.boss&&!wave.hitSet.has(this.boss)){
        const distance=dist(wave.x,wave.y,this.boss.x,this.boss.y);
        if(Math.abs(distance-wave.current)<this.boss.radius+26){
          wave.hitSet.add(this.boss);
          this.damageEnemy(this.boss,wave.damage,{weapon:wave.weapon,source:'shockwave'});
        }
      }
    }
    compact(this.shockwaves,w=>!w.dead);

    // ---- Orbital / mortar strikes ----
    for(const strike of this.strikes){
      strike.age+=dt;
      if(strike.age<strike.delay)continue;
      strike.dead=true;
      if(strike.implode){
        // Graviton wells pull hostiles in before detonating.
        const affected=this.enemyHash.query(strike.x,strike.y,strike.blastRadius*1.8,neighbourScratch);
        for(const enemy of affected){
          if(enemy.dead)continue;
          const dir=normalize(strike.x-enemy.x,strike.y-enemy.y);
          enemy.vx+=dir.x*420;enemy.vy+=dir.y*420;
        }
      }
      this.spawnExplosion({
        x:strike.x,y:strike.y,radius:strike.blastRadius,damage:strike.damage,
        knockback:strike.knockback,weapon:strike.weapon,
        hostile:strike.hostile,color:strike.color||'#ffb35c'
      });
    }
    compact(this.strikes,s=>!s.dead);

    // ---- Persistent fields ----
    for(const field of this.fields){
      field.age+=dt;
      if(field.age>=field.duration){field.dead=true;continue}
      if(field.follow){field.x=field.follow.x;field.y=field.follow.y}
      field.tickTimer-=dt;
      if(field.tickTimer>0)continue;
      field.tickTimer=field.tickInterval||.5;
      if(field.friendly){
        const affected=this.enemyHash.query(field.x,field.y,field.radius,neighbourScratch);
        for(const enemy of affected){
          if(enemy.dead)continue;
          if(dist2(field.x,field.y,enemy.x,enemy.y)>field.radius*field.radius)continue;
          this.damageEnemy(enemy,field.damage,{source:'field',status:'burn',statusChance:.5});
        }
      }else if(dist2(field.x,field.y,this.player.x,this.player.y)<field.radius*field.radius){
        this.damagePlayer(field.damage,{source:'field',fromX:field.x,fromY:field.y});
      }
    }
    compact(this.fields,f=>!f.dead);

    // ---- Melee arcs ----
    for(const arc of this.meleeArcs){
      arc.age+=dt;
      if(arc.age>=arc.duration){arc.dead=true;continue}
      arc.x=this.player.x;arc.y=this.player.y;
      const candidates=this.enemyHash.query(arc.x,arc.y,arc.reach+40,neighbourScratch);
      for(const enemy of candidates){
        if(enemy.dead||arc.hitSet.has(enemy))continue;
        const distance=dist(arc.x,arc.y,enemy.x,enemy.y);
        if(distance>arc.reach+enemy.radius)continue;
        const toEnemy=Math.atan2(enemy.y-arc.y,enemy.x-arc.x);
        const delta=Math.abs(((toEnemy-arc.angle+Math.PI)%TAU+TAU)%TAU-Math.PI);
        if(delta>arc.arc/2)continue;
        arc.hitSet.add(enemy);
        this.damageEnemy(enemy,arc.damage,{
          weapon:arc.weapon,knockback:arc.knockback,angle:toEnemy,source:'melee'
        });
      }
      if(this.boss&&!arc.hitSet.has(this.boss)&&dist(arc.x,arc.y,this.boss.x,this.boss.y)<arc.reach+this.boss.radius){
        arc.hitSet.add(this.boss);
        this.damageEnemy(this.boss,arc.damage,{weapon:arc.weapon,source:'melee'});
      }
    }
    compact(this.meleeArcs,a=>!a.dead);
  }

  updateHazards(dt){
    for(const hazard of this.world.hazards){
      if(hazard.passive){
        // Standing damage from molten channels and similar.
        if(hazard.damage&&dist2(hazard.x,hazard.y,this.player.x,this.player.y)<hazard.radius*hazard.radius){
          hazard.playerTick=(hazard.playerTick||0)-dt;
          if(hazard.playerTick<=0){
            hazard.playerTick=hazard.interval||.5;
            this.damagePlayer(hazard.damage,{source:'hazard',fromX:hazard.x,fromY:hazard.y});
          }
        }
        continue;
      }
      if(!hazard.active||hazard.resolved)continue;
      hazard.resolved=true;
      // Vacuum breaches drag everything toward them before venting.
      if(hazard.pull){
        const dir=normalize(hazard.x-this.player.x,hazard.y-this.player.y);
        this.player.vx+=dir.x*hazard.pull;
        this.player.vy+=dir.y*hazard.pull;
      }
      if(dist2(hazard.x,hazard.y,this.player.x,this.player.y)<hazard.radius*hazard.radius){
        this.damagePlayer(hazard.damage,{source:'hazard',fromX:hazard.x,fromY:hazard.y});
        if(hazard.status)this.applyStatus(this.player,hazard.status,1);
      }
      if(hazard.affectsEnemies){
        const affected=this.enemyHash.query(hazard.x,hazard.y,hazard.radius,neighbourScratch);
        for(const enemy of affected){
          if(enemy.dead)continue;
          if(dist2(hazard.x,hazard.y,enemy.x,enemy.y)>hazard.radius*hazard.radius)continue;
          this.damageEnemy(enemy,hazard.damage*2.2,{source:'hazard',status:hazard.status,statusChance:1});
        }
      }
      this.fx.explosion(hazard.x,hazard.y,hazard.radius*.8,hazard.color);
      this.camera.addShake(.1);
    }
    // Reset the one-shot guard once the hazard finishes its active window.
    for(const hazard of this.world.hazards)if(!hazard.active)hazard.resolved=false;
  }

  onHazardFire(hazard){
    this.audio.play('explode',{volume:.4});
  }

  // -------------------------------------------------------------------------
  // Pickups and XP
  // -------------------------------------------------------------------------

  // Drops a personnel cache near the operative. Silently does nothing when
  // there is no unrecovered file left to find, or the run has already had its
  // share, so the caller never has to check first.
  spawnDossier(x=this.player.x,y=this.player.y){
    if(!this.discoverable.length)return false;
    if(this.dossiersSpawned>=this.maxDossiers)return false;
    this.dossiersSpawned++;
    this.spawnPickup('dossier',x+this.rng.range(-24,24),y+this.rng.range(-24,24),0);
    this.announce('PERSONNEL CACHE DETECTED','#f5d27a',2.4);
    this.audio.play('alarm',{volume:.45});
    return true;
  }

  spawnPickup(kind,x,y,value){
    this.pickups.push({
      kind,x,y,value,
      vx:this.rng.range(-40,40),vy:this.rng.range(-40,40),
      age:0,life:kind==='xp'?90:60,
      magnetized:false,phase:this.rng.next()*10
    });
  }

  updatePickups(dt){
    const player=this.player;
    const magnetRadius=110*(this.stats.magnet||1);
    // Signal jammers suppress the pickup magnet.
    let jammed=false;
    for(const enemy of this.enemies){
      if(enemy.dead||!enemy.jamsMagnet)continue;
      if(dist2(enemy.x,enemy.y,player.x,player.y)<(enemy.auraRadius||190)**2){jammed=true;break}
    }
    const effectiveRadius=jammed?34:magnetRadius;

    for(const pickup of this.pickups){
      pickup.age+=dt;
      pickup.life-=dt;
      if(pickup.life<=0){pickup.dead=true;continue}

      pickup.x+=pickup.vx*dt;
      pickup.y+=pickup.vy*dt;
      pickup.vx*=Math.pow(.88,dt*60);
      pickup.vy*=Math.pow(.88,dt*60);

      const distance=dist(pickup.x,pickup.y,player.x,player.y);
      if(pickup.magnetized||distance<effectiveRadius){
        pickup.magnetized=true;
        const dir=normalize(player.x-pickup.x,player.y-pickup.y);
        const pull=clamp(700-distance*1.4,240,900);
        pickup.x+=dir.x*pull*dt;
        pickup.y+=dir.y*pull*dt;
      }
      if(distance<player.radius+10){
        pickup.dead=true;
        this.collectPickup(pickup);
      }
    }
    compact(this.pickups,p=>!p.dead);
  }

  collectPickup(pickup){
    this.telemetry.pickups++;
    switch(pickup.kind){
      case 'xp':
        this.addXp(pickup.value*(this.stats.xpGain||1));
        this.audio.play('pickup',{volume:.3});
        break;
      case 'credit':
        this.credits+=Math.round(pickup.value*this.creditGainMult);
        this.fx.text(pickup.x,pickup.y-14,`+${Math.round(pickup.value*this.creditGainMult)} CR`,'#ffd166',{size:11});
        this.audio.play('coin',{volume:.4});
        break;
      case 'health':{
        const healed=this.healPlayer(Math.round(this.player.maxHp*.3));
        if(!healed)this.credits+=15;
        this.audio.play('heal',{volume:.7});
        break;
      }
      case 'magnet':
        // Sweep every pickup on the field toward the operative.
        for(const other of this.pickups)other.magnetized=true;
        this.fx.ring(this.player.x,this.player.y,20,600,.6,'#76e7d4',3);
        this.announce('COLLECTION SWEEP','#76e7d4',1.2);
        this.audio.play('unlock',{volume:.6});
        break;
      case 'bomb':{
        this.spawnShockwave({
          x:this.player.x,y:this.player.y,radius:520,
          damage:180*this.stats.damage,knockback:520,color:'#ff7068'
        });
        this.fx.flash('#ff7068',.4);
        this.camera.addShake(.5);
        this.announce('AREA DENIAL','#ff7068',1.2);
        this.audio.play('explode',{volume:1});
        break;
      }
      case 'dossier':{
        // Recovering a file identifies exactly one operative. Counseling is
        // scheduled later, from the debrief or the roster screen.
        const index=this.rng.int(0,this.discoverable.length-1);
        const found=this.discoverable.splice(index,1)[0];
        if(!found)break;
        this.discovered.push(found.id);
        this.jp+=5;
        this.fx.ring(pickup.x,pickup.y,10,240,.8,'#f5d27a',3);
        this.fx.flash('#f5d27a',.25);
        this.announce(`PERSONNEL FILE RECOVERED // ${found.codename}`,'#f5d27a',4);
        this.audio.play('unlock',{volume:1});
        break;
      }
      case 'chest':
        this.credits+=Math.round(80*this.creditGainMult);
        this.jp+=2;
        // A chest grants an immediate free adaptation.
        this.pendingLevelUps++;
        this.announce('SUPPLY CACHE RECOVERED','#ffd166',1.6);
        this.audio.play('unlock',{volume:.9});
        break;
      default:break;
    }
  }

  addXp(amount){
    this.xp+=amount;
    this.telemetry.xpCollected+=amount;
    // Tuned so a standard contract reaches roughly level 5 by 30s, 10 by 90s
    // and 30 by the ten-minute mark; the curve flattens at high level so long
    // endurance runs keep producing adaptations.
    while(this.xp>=this.xpNeeded){
      this.xp-=this.xpNeeded;
      this.level++;
      const growth=this.level<20?1.14:this.level<45?1.08:1.05;
      const flat=this.level<20?3:this.level<45?6:10;
      this.xpNeeded=Math.floor(this.xpNeeded*growth+flat);
      this.pendingLevelUps++;
    }
  }

  // Called by the UI once the player picks an adaptation.
  applyUpgrade(choice){
    if(choice.kind==='weapon'){
      const weapon=this.loadout.addWeapon(choice.id);
      this.announce(`${weapon.name} // LV ${weapon.level}`,'#76e7d4',1.4);
    }else if(choice.kind==='passive'){
      const rank=this.loadout.addPassive(choice.id);
      this.announce(`${choice.name} // RANK ${rank}`,'#7db2ff',1.4);
    }else if(choice.kind==='heal'){
      this.healPlayer(Math.round(this.player.maxHp*.4));
    }else if(choice.kind==='credits'){
      this.credits+=choice.value||150;
    }

    this.loadout.recompute(this.externalModifiers());
    this.stats=this.loadout.stats;
    this.syncMaxHp();

    const forged=this.loadout.checkEvolutions();
    for(const evolution of forged){
      this.telemetry.evolutions.push(evolution.id);
      this.announce(`EVOLUTION // ${evolution.name}`,'#ffb35c',3);
      this.fx.flash('#ffb35c',.4);
      this.audio.play('unlock',{volume:1});
      this.onEvolution?.(evolution);
    }

    this.pendingLevelUps=Math.max(0,this.pendingLevelUps-1);
    this.audio.play('levelup',{volume:.8});
  }

  externalModifiers(){
    // Passive max-HP is folded in via syncMaxHp rather than the stat block.
    return{};
  }

  syncMaxHp(){
    const bonus=this.stats.maxHp||0;
    const target=Math.round(
      this.operative.hp*(1+(this.operative.stats?.maxHp||0)/100)+
      (this.devBonuses.maxHp||0)+(this.masteryBonuses.maxHp||0)+bonus
    );
    if(target===this.player.maxHp)return;
    const gained=target-this.player.maxHp;
    this.player.maxHp=target;
    if(gained>0)this.player.hp=Math.min(target,this.player.hp+gained);
    else this.player.hp=Math.min(this.player.hp,target);
    this.player.armor=this.operative.armor+(this.devBonuses.armor||0)+
      (this.masteryBonuses.armor||0)+(this.stats.armor||0);
  }

  // -------------------------------------------------------------------------
  // Scheduling and effects
  // -------------------------------------------------------------------------

  scheduleAction(delay,action){
    this.scheduled.push({time:this.elapsed+delay,action});
  }

  updateScheduled(){
    if(!this.scheduled.length)return;
    let write=0;
    for(const entry of this.scheduled){
      if(entry.time<=this.elapsed){
        try{entry.action()}catch(err){console.warn('[phantom] scheduled action failed',err)}
      }else{
        this.scheduled[write++]=entry;
      }
    }
    this.scheduled.length=write;
  }

  registerEffect(id,duration,tick){
    this.effects.set(id,{remaining:duration,tick});
  }

  updateEffects(dt){
    for(const [id,effect] of this.effects){
      effect.remaining-=dt;
      effect.tick(dt,Math.max(0,effect.remaining));
      if(effect.remaining<=0)this.effects.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------

  beginExtraction(){
    if(this.extraction)return;
    this.extraction=true;
    this.extractionTimer=60;
    this.extractionPoint=this.world.extractionPoint(this.player);
    this.announce('EXTRACTION WINDOW OPEN // REACH THE BEACON','#f5d27a',4);
    this.audio.play('alarm',{volume:.9});
    this.fx.flash('#f5d27a',.3);
  }

  checkRunState(){
    if(this.ended)return;
    if(this.extraction&&this.extractionPoint){
      const distance=dist(this.player.x,this.player.y,this.extractionPoint.x,this.extractionPoint.y);
      // Hold decays rather than resetting: being knocked or dashed out of the
      // zone for a moment should cost progress, not erase it.
      if(distance<EXTRACTION_RADIUS){
        this.extractionHold=(this.extractionHold||0)+this.dt;
        if(this.extractionHold>=EXTRACTION_HOLD)this.finish(true,'EXTRACTION CONFIRMED');
      }else{
        this.extractionHold=Math.max(0,(this.extractionHold||0)-this.dt*.8);
      }
    }
    compact(this.enemies,e=>!e.dead);
  }

  finish(victory,reason){
    if(this.ended)return;
    this.ended=true;
    this.victory=victory;
    this.endReason=reason;
    this.maxCombo=Math.max(this.maxCombo,this.combo);
    this.audio.stopMusic();
    this.audio.play(victory?'victory':'defeat',{volume:1});
    this.onEnd?.(this.summary());
  }

  summary(){
    const duration=this.durationMinutes;
    const difficulty=this.difficulty;
    // Contract payout scales with survival, performance and contract terms.
    const jpEarned=Math.round(
      (this.jp+this.elapsed/24+this.kills*.02+(this.victory?40:0))*
      difficulty.jpMult*(this.config.durationSpec?.jpMult||1)
    );
    return{
      victory:this.victory,reason:this.endReason,
      operativeId:this.operative.id,mapId:this.map.id,
      duration,difficulty:difficulty.id,
      elapsed:this.elapsed,level:this.level,
      kills:this.telemetry.kills,eliteKills:this.telemetry.eliteKills,
      minionKills:this.telemetry.minionKills,hazardKills:this.telemetry.hazardKills,
      damageDealt:this.telemetry.damageDealt,damageTaken:this.telemetry.damageTaken,
      healingDone:this.telemetry.healingDone,criticalHits:this.telemetry.criticalHits,
      xpCollected:this.telemetry.xpCollected,pickups:this.telemetry.pickups,
      distance:this.telemetry.distance,dashes:this.telemetry.dashes,
      abilitiesUsed:this.telemetry.abilitiesUsed,
      maxCombo:this.maxCombo,maxAlive:this.telemetry.maxAlive,
      credits:Math.round(this.credits),jp:jpEarned,
      discovered:[...this.discovered],
      objectivesCleared:this.objectives.completed,
      evolutions:this.telemetry.evolutions,
      bossesDefeated:this.bossesDefeated,
      weapons:this.loadout.weapons.map(w=>({
        id:w.evolved?w.def.base:w.id,form:w.id,level:w.level,
        kills:w.kills,damage:Math.round(w.damageDealt),evolved:w.evolved
      })),
      passives:[...this.loadout.passives.entries()].map(([id,rank])=>({id,rank}))
    };
  }

  announce(text,color='#76e7d4',duration=2.2){
    this.announcements.push({text,color,life:duration,maxLife:duration});
    if(this.announcements.length>4)this.announcements.shift();
  }

  addFloatingText(x,y,text,color){this.fx.text(x,y,text,color,{size:14,life:1.4})}

  cullEntities(){
    // Despawn hostiles that have wandered far outside the play area, which
    // keeps the simulation cost bounded during long endurance contracts.
    const limit=Math.max(this.camera.viewHalfWidth(700),1250);
    let write=0;
    for(const enemy of this.enemies){
      if(enemy.dead)continue;
      if(dist2(enemy.x,enemy.y,this.player.x,this.player.y)>limit*limit&&!enemy.elite&&!enemy.miniboss)continue;
      this.enemies[write++]=enemy;
    }
    this.enemies.length=write;
  }

  destroy(){
    this.fx.clear();
    this.enemies.length=0;
    this.projectiles.length=0;
    this.enemyProjectiles.length=0;
    this.scheduled.length=0;
    this.effects.clear();
  }
}

const neighbourScratch=[];
const MULTIPLICATIVE=new Set([
  'damage','fireRate','area','projectileSpeed','duration','moveSpeed',
  'magnet','xpGain','luck','cooldown','critDamage'
]);

// Minimal elite lookup for minibosses, keyed by their base elite id.
import {ELITES} from '../../data/enemies.js';
const ELITE_FALLBACK=Object.fromEntries(ELITES.map(e=>[e.id,e]));

export {FIXED_STEP};
