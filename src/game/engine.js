import {Rng} from '../core/rng.js';
import {profiler} from '../core/profiler.js';
import {Camera} from '../core/camera.js';
import {clamp,damp,dist,dist2,normalize,compact,approachAngle,SpatialHash,TAU} from '../core/math.js';
import {World} from './world.js';
import {Director} from './director.js';
import {EnemyBrain,AI_STATES} from './ai.js';
import {Loadout,ASSIST_CONE} from './weapons.js';
import {Boss} from './boss.js';
import {Objectives} from './objectives.js';
import {Mission} from './mission.js';
import {CodecDirector} from './codec.js';
import {Squadmate} from './squadmate.js';
import {Nemesis,nemesisScaling} from './nemesis.js';
import {Fx} from './fx.js';
import {ORDNANCE_FIRE} from './ordnance.js';
import {ORDNANCE_BY_ID} from '../../data/ordnance.js';
import {liveryFor} from '../../data/liveries.js';
import {DEPLOY_KITS,deployKit} from '../../data/deploykits.js';
import {vaultKind} from '../../data/vaults.js';
import {captureStep,ReplayRecorder,ReplayPlayer,REPLAY_VERSION,SIM_SETTINGS} from './replay.js';
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
// Movement bonus while the extraction window is open. Withdrawing across a
// saturated sector on foot was reliably the deadliest part of a contract;
// this makes the run for the beacon a sprint the operative can actually win.
export const EXTRACTION_SPEED_BONUS=1.28;
// Close enough for the operative's scanner to resolve a sealed chamber.
export const VAULT_SCAN_RADIUS=330;

// How long the operative keeps facing a contact after the last round went its
// way. Without a hold the body snaps back to the walking direction between
// shots, which is the flicker the mismatch used to hide behind.
export const ENGAGEMENT_HOLD=1.1;
// Radians per second the body turns to bring a new contact round. Fast enough
// that the sprite is never meaningfully behind the rounds, slow enough that
// two weapons working different targets read as tracking rather than snapping.
export const TURN_RATE=16;

// How long a fitted optic keeps its lock on a contact after last acquiring it.
// Comfortably longer than any weapon's cycle, so the reticle reads as steady.
export const OPTIC_LOCK_HOLD=1.4;

// Fraction of hostiles that deploy with the squadmate as their mark.
const SQUAD_AGGRO_SHARE=.34;

// Baseline sustain, in HP per second, before any passive or development-tree
// regeneration. Enough to recover from chip damage between engagements
// without meaningfully blunting a burst.
export const BASE_REGEN=.45;
// Fraction of maximum health restored when an adaptation is taken, which ties
// the sustain economy to the progression the player is already chasing.
export const LEVEL_UP_HEAL=.07;

// Field turrets. Every operative carries a rank 1 kit; the Deployment Kit
// adaptation raises the rank, which is what turns 1x into 2x and 3x. Higher
// ranks also field a sturdier chassis — durability is the whole point of the
// upgrade, since a planted turret has no expiry timer and only dies to damage.
export const MAX_DEPLOY_RANK=3;
export const DEPLOY_RANKS=[
  {rank:1,turrets:1,cooldown:18,hp:150,damage:9,fireRate:.62},
  {rank:2,turrets:2,cooldown:15,hp:240,damage:11,fireRate:.55},
  {rank:3,turrets:3,cooldown:12,hp:360,damage:14,fireRate:.46}
];
export const deploySpec=rank=>DEPLOY_RANKS[clamp(rank,1,MAX_DEPLOY_RANK)-1];

export class Engine{
  constructor(canvas,config){
    this.canvas=canvas;
    this.config=config;
    // Resolved before anything else in the constructor: these are pure config,
    // and the modifier hooks, the turret kit and the loadout all read them.
    // They used to be computed two hundred lines down, which meant anything
    // above that line silently saw undefined.
    this.devBonuses=devBonuses(config.devRanks||{});
    // A handful of preferences change the simulation rather than how it looks,
    // so a replay carries its own and they win here. Copied rather than
    // mutated: this object is the live save's settings and the menu is still
    // holding it.
    this.settings=config.replay?.settings
      ?{...config.settings,...config.replay.settings}
      :config.settings;
    this.audio=config.audio;
    // Kept, not just consumed: a replay is the seed plus the input log, so the
    // resolved seed has to survive the run even when the caller passed none.
    this.seed=config.seed??Math.floor(Math.random()*1e9);
    this.rng=new Rng(this.seed);

    // ---- Replay ------------------------------------------------------------
    // Recording is always on and costs one packed run-length record per change
    // of input. Playing back replaces the live input entirely: `step` reads the
    // log instead of the device, so nothing downstream knows the difference.
    this.stepIndex=0;
    this.replayPlayer=config.replay?new ReplayPlayer(config.replay.log):null;
    this.replayRecorder=this.replayPlayer?null:new ReplayRecorder();
    // Choices made outside `step` — which adaptation was taken, rerolled,
    // banished or skipped — are input too, and the simulation cannot infer
    // them from the seed.
    this.decisions=this.replayPlayer?(config.replay.decisions||[]).slice():[];
    this.decisionIndex=0;

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
      maxAlive:0,evolutions:[],
      vaultsFound:0,vaultsBreached:0,turretsDeployed:0
    };

    // ---- Modifier hooks (set by traits and meta upgrades) ------------------
    this.forgetRateMult=1;
    this.enemyAccuracyPenalty=0;
    this.abilityCooldownMult=1;
    // Command doctrine multipliers, read where each behaviour lives rather than
    // folded into stats. Clamped so a maxed branch cannot reach zero.
    this.squadDamageMult=1+(this.devBonuses.squadDamage||0);
    this.squadReviveMult=Math.max(.4,1+(this.devBonuses.squadRevive||0));
    this.nemesisWithdrawBonus=this.devBonuses.nemesisWithdraw||0;
    this.extractionHoldMult=Math.max(.4,1+(this.devBonuses.extractionHold||0));
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

    // ---- Field turret kit --------------------------------------------------
    this.deployRank=1+(this.devBonuses.deployRank||0);
    this.deployCooldown=0;
    // Which kit the next plant uses. Run state, not save state: every
    // operative carries all three and swaps between them in the field.
    this.deployKitIndex=0;

    // The direction rounds last actually went, and when. The operative faces
    // this rather than their walking direction, so the sprite and the rounds
    // agree about which way the fight is.
    this.engagementX=1;
    this.engagementY=0;
    this.engagementAt=-99;
    this.manualAim=false;

    this.setupPlayer();
    this.setupSquad();
    this.setupLoadout();
    this.director=new Director(this,{
      difficulty:this.difficulty,duration:config.duration,map:this.map
    });
    this.objectives=new Objectives(this);
    // Radio traffic between the operative and whoever is running comms. It
    // reads engine events and nothing else, so muting it costs the simulation
    // nothing.
    //
    // Built before the mission, not after: a duel objective spawns its boss
    // during Mission setup, and spawnBoss fires a codec cue. With the codec
    // constructed afterwards that cue hit undefined and threw, which made
    // every duel operation crash the moment it was launched.
    this.codec=new CodecDirector(this);
    // Campaign operations layer an objective over the survival contract.
    this.mission=new Mission(this,config.objective);
    this.applyTrait('onInit');
    this.codec.fire('deploy');

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
    const dev=this.devBonuses;
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
      ordnanceCooldown:0,ordnanceMax:0,
      shieldTimer:0,shieldAngle:0,shieldReflect:false,
      damageBuff:1,damageBuffTimer:0,
      revives:(dev.revives||0),
      regenAccumulator:0,
      knockbackResist:0,
      statuses:new Map(),
      walkPhase:0,
      alive:true
    };
    this.masteryBonuses=mastery;
    this.detectionMult=1+(dev.detection||0);
  }

  // A second operative deploys alongside, when one was selected and is not in
  // medical. Kept as an array so the shape does not have to change if a
  // contract ever fields more than one.
  setupSquad(){
    this.squad=[];
    const mate=this.config.squadmate;
    if(!mate)return;
    const angle=this.rng.angle();
    const spawn=this.world.findSpawn(this.rng,{
      x:this.player.x+Math.cos(angle)*70,
      y:this.player.y+Math.sin(angle)*70
    },0,120);
    this.squad.push(new Squadmate(this,mate,spawn));
  }

  // Live squadmates, which is what most callers actually mean.
  get standingSquad(){
    const out=[];
    for(const mate of this.squad)if(!mate.downed)out.push(mate);
    return out;
  }

  // Who a given hostile is currently working on. Enemies keep the assignment
  // they were given rather than re-picking every frame, so a squad does not
  // oscillate between two targets, and it falls back to the operative the
  // moment their mark goes down.
  aiTargetFor(enemy){
    const mark=enemy.aggro;
    if(mark&&!mark.downed&&this.squad.includes(mark))return mark;
    return this.player;
  }

  updateSquad(dt){
    for(const mate of this.squad)mate.update(dt);
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
      if(['maxHp','armor','revives','extraChoice','rerolls','banishes','startingWeapons','startLevel','abilityCooldown','detection','creditGain','eliteDamage',
        // Command doctrine: consumed by name at the site each one changes,
        // never folded into the stat block, where they would silently do nothing.
        'ordnanceReady','squadDamage','squadRevive','nemesisWithdraw','deployRank','extractionHold'].includes(key))continue;
      base[key]=MULTIPLICATIVE.has(key)?(base[key]??1)+value:(base[key]??0)+value;
    }
    for(const [key,value] of Object.entries(this.masteryBonuses)){
      if(['maxHp','armor'].includes(key))continue;
      base[key]=MULTIPLICATIVE.has(key)?(base[key]??1)+value:(base[key]??0)+value;
    }

    this.loadout=new Loadout(this,base);
    // The operative deploys with the weapon selected in the loadout screen,
    // fitted as it was left on the bench; without a selection they carry their
    // own issue weapon, stock.
    const primary=this.config.primary;
    this.primaryId=primary?.weaponId||op.weapon;
    this.primaryMods=primary?.mods||null;
    this.loadout.addWeapon(this.primaryId,this.primaryMods);
    // An optic changes how far the loadout acquires targets, and a suppressor
    // changes how quickly hostiles resolve where the fire came from.
    this.opticProfile=this.primaryMods?.optic||null;
    this.opticTarget=null;
    this.opticTargetAt=0;
    if(this.primaryMods?.field?.detection){
      this.detectionMult*=1+this.primaryMods.field.detection;
    }
    // The ordnance module fitted to the primary. Its cooldown answers to the
    // same development rank that shortens the operative's ability, so a build
    // invested in actives feels it on both.
    // Resolved here rather than trusted from the caller: the config may carry
    // the module object or just its id, and an unknown id resolves to nothing
    // rather than to a half-built module that fires blanks.
    // Cosmetic finish on the primary. Keyed by weapon id rather than held as a
    // single value, so a weapon picked up mid-contract keeps its own default
    // instead of inheriting the primary's paint.
    this.liveries={};
    if(primary?.livery){
      const livery=liveryFor(typeof primary.livery==='string'?primary.livery:primary.livery?.id);
      if(livery&&(livery.tracer||livery.body))this.liveries[this.primaryId]=livery;
    }

    const fitted=primary?.ordnance;
    this.ordnance=ORDNANCE_BY_ID[typeof fitted==='string'?fitted:fitted?.id]||null;
    if(this.ordnance){
      this.player.ordnanceMax=this.ordnance.cooldown*(1+(dev.abilityCooldown||0))*this.abilityCooldownMult;
      // Hot Load deploys with the module already charged.
      this.player.ordnanceCooldown=this.devBonuses.ordnanceReady?0:this.ordnance.cooldown*.5;
    }
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

    profiler.begin();
    this.accumulator+=Math.min(realDt,.25);
    let steps=0;
    while(this.accumulator>=FIXED_STEP&&steps<MAX_STEPS){
      this.step(FIXED_STEP,input);
      this.accumulator-=FIXED_STEP;
      steps++;
      if(this.ended||this.pendingLevelUps>0)break;
    }
    // Bail out of a death spiral rather than compounding lag. This is the one
    // event worth counting above all others: past the cap the contract silently
    // runs slower than the clock, and nothing else in the game says so.
    if(steps>=MAX_STEPS){
      profiler.count_('stepClamps');
      profiler.count_('droppedMs',Math.round(this.accumulator*1000));
      this.accumulator=0;
    }
    profiler.count_('steps',steps);
    profiler.mark('sim');
    profiler.peak('enemies',this.enemies.length);
    profiler.peak('particles',this.fx.stats?.particles||0);

    this.fx.update(realDt);
    this.codec.update(realDt);
    this.camera.follow(this.player,this.aimLead,realDt);
    this.camera.update(realDt,this.settings.screenShake??1);
    this.audio.setIntensity(clamp(this.enemies.length/70+(this.boss?.4:0),0,1));
  }

  step(dt,input){
    this.elapsed+=dt;
    this.dt=dt;
    if(this.director.progress>=.5)this.codec.fire('halfway');

    this.updateTimers(dt);
    // The optic holds its lock between shots. Clearing it every step would
    // show the reticle on the one frame in forty the weapon happens to fire,
    // so it persists until the contact dies or the lock goes stale.
    if(this.opticTarget&&(this.opticTarget.dead||this.elapsed-this.opticTargetAt>OPTIC_LOCK_HOLD)){
      this.opticTarget=null;
    }
    // Every step resolves its input into one frozen snapshot, and recording
    // and playback both hang off that single point. Doing it per step rather
    // than per frame is what makes a replay independent of frame rate: a slow
    // frame runs up to five steps and a fast one runs none.
    const frame=this.replayPlayer?this.replayPlayer.next():captureStep(input,this.camera,this.player);
    this.replayRecorder?.record(frame);
    this.stepIndex++;
    this.updateInput(dt,frame);
    this.rebuildHashes();
    this.world.update(dt,this);
    this.director.update(dt);

    const enemyDt=dt*this.timeDilation;
    this.updatePlayer(dt);
    this.updateSquad(dt);
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
    this.updateTurretDurability(dt);
    this.updateVaults(dt);
    this.mission.update(dt);
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
    player.ordnanceCooldown=Math.max(0,player.ordnanceCooldown-dt);
    this.deployCooldown=Math.max(0,this.deployCooldown-dt);

    if(input.takeAction('deploy'))this.deployTurret();
    if(input.takeAction('kit'))this.cycleDeployKit();

    const aim=input.aimVector(this.camera,player);
    // This used to read `aim.manual && !autoAim===false ? aim.manual :
    // aim.manual` — a ternary whose branches were identical, so the auto-target
    // setting resolved to nothing at all. Manual aim is simply whether the
    // operative is pointing the weapon; what auto-target changes is what
    // happens when they are not, which is where fireDirection reads it.
    this.manualAim=aim.manual;
    if(aim.manual){
      this.aimLead={x:aim.x,y:aim.y};
      // Where the operative is pointing, and — when auto-target assist has
      // adjusted a shot onto a contact inside that cone — where the rounds
      // actually went. The body holds the adjusted line for as long as the
      // engagement is live, rather than flicking back to the raw pointer on
      // every frame no weapon happened to fire.
      const engaged=this.elapsed-this.engagementAt<ENGAGEMENT_HOLD&&
        this.engagementX*aim.x+this.engagementY*aim.y>=ASSIST_CONE;
      // Snapped, not eased: the rounds leave along this angle the same step,
      // so easing it would put the muzzle behind the pointer.
      player.angle=engaged
        ?Math.atan2(this.engagementY,this.engagementX)
        :Math.atan2(aim.y,aim.x);
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

    // Secondary fire. A module returns false when it found nothing to do — a
    // marker round with nothing in the blast — and keeps its charge.
    if(input.takeAction('secondary')&&this.ordnance&&player.ordnanceCooldown<=0){
      const fire=ORDNANCE_FIRE[this.ordnance.id];
      if(fire&&fire(this,player,this.ordnance,this.ordnanceDamage())){
        player.ordnanceCooldown=player.ordnanceMax;
        this.telemetry.ordnanceFired=(this.telemetry.ordnanceFired||0)+1;
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

    // Regeneration from passives and the development tree, on top of a small
    // baseline. Without a baseline the only sustain in a contract was a 3%
    // drop chance, so unavoidable chip damage was permanent and a long run
    // was lost to attrition no matter how well it was played.
    const regen=BASE_REGEN+(stats.regen||0)+(this.devBonuses.regen||0);
    if(regen>0&&player.hp<player.maxHp){
      player.regenAccumulator+=regen*dt;
      if(player.regenAccumulator>=1){
        const amount=Math.floor(player.regenAccumulator);
        player.regenAccumulator-=amount;
        this.healPlayer(amount,true);
      }
    }

    let speed=player.baseSpeed*stats.moveSpeed;
    if(this.extraction)speed*=EXTRACTION_SPEED_BONUS;
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
      // Facing, when the operative is not pointing the weapon themselves. The
      // contact being engaged wins over the direction of travel: walking right
      // while shooting something on the left is a real thing to do, and the
      // body should be turned towards the thing being shot. Falls back to the
      // walk once the engagement goes stale.
      if(!this.manualAim){
        const engaged=this.elapsed-this.engagementAt<ENGAGEMENT_HOLD;
        const faceX=engaged?this.engagementX:move.x;
        const faceY=engaged?this.engagementY:move.y;
        if(faceX||faceY){
          player.angle=approachAngle(player.angle,Math.atan2(faceY,faceX),TURN_RATE*dt);
        }
      }
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

    // A shield pylon's field is the last thing between the armour maths and
    // the health bar, so it is worth exactly what it says on the kit.
    const shelter=this.turretField(player.x,player.y,'shelter');
    if(shelter>0){
      final*=1-shelter;
      this.fx.ring(player.x,player.y,player.radius+4,player.radius+18,.18,'#8fd8ff',2);
    }

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
    else if(player.hp/player.maxHp<=.25)this.codec.fire('critical');
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

  // Defaults to the operative, but takes an actor: a squadmate running WRAITH's
  // phase strike has to move the squadmate, not whoever is holding the pad.
  blinkPlayer(x,y,actor=this.player){
    const player=actor;
    const clampedX=clamp(x,30,this.world.width-30);
    const clampedY=clamp(y,30,this.world.height-30);
    const color=player===this.player?this.operative.color:player.color;
    this.spawnBlinkVfx(player.x,player.y,player.radius,color);
    player.x=clampedX;player.y=clampedY;
    this.world.resolveCollision(player,player.radius);
    this.spawnBlinkVfx(player.x,player.y,player.radius,color);
    player.invulnerable=Math.max(player.invulnerable,.3);
  }

  // -------------------------------------------------------------------------
  // Enemies
  // -------------------------------------------------------------------------

  spawnEnemy(archetype,x,y,options={}){
    if(this.enemies.length>=this.director.enemyCap)return null;
    const difficulty=this.difficulty;
    // Escalation rather than contract progress: hostile durability tracks how
    // long the operative has had to build a loadout, not what fraction of the
    // contract has elapsed.
    const progress=this.director.escalation;
    // Health and damage ramp with contract progress and difficulty. The
    // curve is deliberately shallow: hostile *count* is the primary pressure
    // source, so durability must not outrun the player's weapon scaling.
    // Progress scaling sits on top of archetype tier escalation, which already
    // multiplies base health several times over across a contract. Stacking a
    // steep curve on that outran the player's own damage growth outright.
    const hpScale=(1+progress*1.05)*difficulty.hpMult*(options.hpMult||1);
    const damageScale=(1+progress*.6)*difficulty.damageMult*(options.damageMult||1);

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
    EnemyBrain.init(enemy,archetype,this.rng);
    this.assignAggro(enemy);
    this.enemies.push(enemy);
    return enemy;
  }

  // A share of each wave is pointed at the squadmate rather than the
  // operative. Assigned once, at spawn, so a hostile commits to a mark instead
  // of thrashing between two — and kept well under half, because the squadmate
  // is support, not a way to make the contract somebody else's problem.
  assignAggro(enemy){
    enemy.aggro=null;
    const standing=this.standingSquad;
    if(!standing.length)return;
    if(this.rng.next()>=SQUAD_AGGRO_SHARE)return;
    enemy.aggro=standing[this.rng.int(0,standing.length-1)];
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
    this.codec.fire('elite');
    this.audio.play('boss',{volume:.7});
    this.camera.addShake(.3);
    return enemy;
  }

  // A carrier putting infantry on the ground. Each carrier tracks what it has
  // unloaded and stops at its own cap, so destroying one is what ends the
  // stream rather than the global enemy cap quietly doing it for you.
  deployFromCarrier(carrier){
    const archetype=ENEMIES_BY_ID[carrier.deployUnit||'rifle'];
    if(!archetype)return;
    carrier.deployed=(carrier.deployed||[]).filter(unit=>!unit.dead);
    const room=(carrier.deployCap||9)-carrier.deployed.length;
    if(room<=0)return;

    const count=Math.min(room,carrier.deployCount||3);
    let dropped=0;
    for(let i=0;i<count;i++){
      // Out of the back, away from whoever the carrier is facing.
      const angle=carrier.angle+Math.PI+this.rng.range(-.6,.6);
      const point=this.world.findSpawn(this.rng,{
        x:carrier.x+Math.cos(angle)*(carrier.radius+24),
        y:carrier.y+Math.sin(angle)*(carrier.radius+24)
      },0,90);
      const unit=this.spawnEnemy(archetype,point.x,point.y);
      if(!unit)continue;
      unit.awareness=1;
      unit.memory=10;
      unit.lastKnownX=this.player.x;
      unit.lastKnownY=this.player.y;
      carrier.deployed.push(unit);
      dropped++;
    }
    if(!dropped)return;
    carrier.rampTimer=.9;
    this.fx.ring(carrier.x,carrier.y,carrier.radius,carrier.radius+40,.35,'#d8c98a',2);
    this.audio.play('reload',{volume:.55});
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
      // Every steering, sighting and firing decision below reads ctx.player.
      // Swapping it per hostile is what lets a share of them work the
      // squadmate instead, without a second copy of the behaviour tree.
      const victim=this.aiTargetFor(enemy);
      context.player=victim;
      enemy.hitFlash=Math.max(0,enemy.hitFlash-dt);
      if(enemy.markedTimer>0)enemy.markedTimer-=dt;
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
        if(dist(enemy.x,enemy.y,victim.x,victim.y)<enemy.radius+victim.radius+4){
          this.damageVictim(victim,enemy.damage*1.5,{source:enemy,fromX:enemy.x,fromY:enemy.y});
          enemy.chargeTimer=0;
        }
      }else{
        EnemyBrain.update(enemy,dt,context);
      }

      // A tracked vehicle drives through light cover rather than around it.
      // Without this the carrier wedges itself on the first crate it meets and
      // never reaches its standoff — the AI steers locally and cannot path.
      if(enemy.crushesCover&&!enemy.parked&&Math.hypot(enemy.vx,enemy.vy)>12){
        this.breakCoverAround(enemy);
      }

      enemy.x+=enemy.vx*dt;
      enemy.y+=enemy.vy*dt;
      // Aircraft are over the sector, not in it: geometry neither stops them
      // nor shelters the operative from them. They are still held inside the
      // arena bounds so they cannot drift out of the fight.
      if(enemy.flying){
        enemy.x=clamp(enemy.x,enemy.radius,this.world.width-enemy.radius);
        enemy.y=clamp(enemy.y,enemy.radius,this.world.height-enemy.radius);
        enemy.rotor=(enemy.rotor||0)+dt*26;
      }else{
        const corrected=this.world.resolveCollision(enemy,enemy.radius);
        if(corrected&&enemy.chargeTimer>0)enemy.chargeTimer=0;
      }
      enemy.angle=Math.atan2(player.y-enemy.y,player.x-enemy.x);

      this.applyEnemyAuras(enemy,dt);
    }

    // Auras applied after positions settle so the reads are consistent.
    this.applySupportAuras();
  }

  // The tracer a weapon fires, or null to leave its behaviour's own colour
  // alone. Standard Issue stores no tracer, so an unfitted loadout resolves to
  // null here and every shot looks exactly as it always has.
  liveryTracer(weapon){
    return this.liveries[weapon?.id]?.tracer||null;
  }

  // The tint of the weapon in the operative's hands, for the renderer.
  liveryBody(weaponId){
    return this.liveries[weaponId]?.body||null;
  }

  // A module's damage rides on the primary's, so secondary fire stays relevant
  // against late-contract health pools instead of decaying into chip damage.
  ordnanceDamage(){
    if(!this.ordnance)return 0;
    const weapon=this.loadout.weapons.find(w=>w.id===this.primaryId)||this.loadout.weapons[0];
    const base=weapon?weapon.damage(this.stats):this.stats.damage*8;
    return base*(this.ordnance.damageScale||1);
  }

  aiContext(dt){
    return{
      dt,
      // The simulation's own stream. Every AI draw goes through it, so the
      // same contract seed produces the same hostiles doing the same things.
      // Cosmetic randomness — particles, audio variation, weather — stays off
      // it deliberately, or a change of particle quality would desync the run.
      rng:this.rng,
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
      deployFrom:enemy=>this.deployFromCarrier(enemy),
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

    // Snare fields get their own multiplier rather than sharing speedMult:
    // that one is deliberately never reset on an enraged hostile, so writing a
    // field into it would leave the slow behind after the hostile walked out.
    // This is assigned every frame, so it cannot accumulate a residue.
    const snare=this.turretField(enemy.x,enemy.y,'slow');
    enemy.snareMult=snare>0?1-snare:1;
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
    const victim=this.aiTargetFor(enemy);
    this.damageVictim(victim,damage*enemy.buffMult,{source:enemy,fromX:enemy.x,fromY:enemy.y});
    this.fx.burst(
      (enemy.x+victim.x)/2,(enemy.y+victim.y)/2,5,
      {speed:140,life:.2,color:'#ff8a6b'}
    );
  }

  // One door for hostile damage, so a caller never has to know whether it is
  // hitting the operative or somebody standing next to them.
  damageVictim(victim,amount,options={}){
    if(victim&&victim!==this.player)return victim.damage(amount,options);
    return this.damagePlayer(amount,options);
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

    // Where the walker was hit, so the hole is on the same plate next time.
    // Recorded on the way in rather than after mitigation, because a shot that
    // was absorbed still scored the armour.
    if(target.nemesis&&options.hitX!==undefined){
      target.markScar(options.hitX,options.hitY);
    }

    const stats=this.stats;
    let damage=amount*this.player.damageBuff;

    // A marker round paints a target: everything that hits it while the paint
    // lasts does more. Applied here rather than at each damage source so the
    // mark cannot be inconsistent between a bullet, a blast and a burn.
    if(target.markedTimer>0)damage*=target.markedMult||1;

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
      // `angle` is the direction the blow came from, which is the direction
      // the spatter should be thrown.
      else this.killEnemy(target,{
        weapon:options.weapon,source:options.source,direction:options.angle,
        ally:options.ally
      });
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
    if(!options.silent){
      this.codec.fire('firstContact');
      if(enemy.elite)this.codec.fire('eliteDown');
      if(this.combo>=25)this.codec.fire('combo');
    }
    if(options.weapon)options.weapon.kills++;
    if(options.ally)options.ally.kills++;
    enemy.squad?.remove(enemy);

    this.fx.death(enemy.x,enemy.y,enemy.color,enemy.elite);

    // Machines leak oil, everything else bleeds. Both stain the floor for the
    // rest of the contract; the direction of the killing blow throws the
    // spatter, so a firefight leaves a readable record of where it happened.
    const gore=enemy.machine
      ? {color:'#07090b',alpha:.62,particle:'#12161a'}
      : {color:'#57121a',alpha:.5,particle:'#7d1d24'};
    const scale=enemy.elite?2.1:1;
    this.world.splatter(enemy.x,enemy.y,{
      radius:enemy.radius*1.5*scale,
      color:gore.color,
      alpha:gore.alpha,
      angle:options.direction??null,
      intensity:scale
    });
    this.fx.blood(enemy.x,enemy.y,gore.particle,(enemy.elite?2.2:1.3));
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
    if(boss.nemesis){
      boss.destroyed=true;
      this.codec.fire('nemesisDown');
    }
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
    this.codec.fire('bossDown');
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
    if(this.rng.next()<.075*luck)this.spawnPickup('health',enemy.x,enemy.y,0);
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
    // A five-minute probe reaches its command signature at roughly level 13
    // with a partly-built loadout, where the old flat baseline took the whole
    // remaining contract to chew through; a thirty-minute contract arrives
    // with an evolved loadout that deleted it outright.
    const lengthScale=.7+Math.max(0,this.durationMinutes-5)/25*2.4;
    this.boss=new Boss(def,point.x,point.y,{
      hpMult:this.difficulty.hpMult*(1+this.director.progress*.4)*lengthScale,
      // Signature attacks land for 14-52 against an operative carrying roughly
      // 125 health, so the encounter was decided in three or four connects
      // regardless of how the rest of the contract had gone.
      damageMult:this.difficulty.damageMult*.72,
      armorMult:1
    });
    this.onBossSpawn?.(this.boss);
    this.announce(def.name,def.color,3.4);
    this.codec.fire('boss');
    this.audio.play('boss',{volume:1});
    this.camera.addShake(.6);
    this.fx.flash(def.color,.35);
    return this.boss;
  }

  // The walker deploys from the operator's own record rather than from the
  // theatre's boss table, and it arrives closer than a command signature: it
  // is not guarding anything, it walked here to find you.
  spawnNemesis(){
    if(this.boss)return null;
    const record=this.config.nemesis;
    if(!record)return null;
    const angle=this.rng.angle();
    const point=this.world.findSpawn(this.rng,{
      x:this.player.x+Math.cos(angle)*420,
      y:this.player.y+Math.sin(angle)*420
    },0,240);
    this.boss=new Nemesis(record,point.x,point.y,nemesisScaling(record,this));
    // Held separately from `this.boss`, which is cleared the moment it dies or
    // walks out — the outcome still has to be readable at the end of the run.
    this.nemesisRef=this.boss;
    this.onBossSpawn?.(this.boss);
    this.announce(record.designation,this.boss.def.color,3.6);
    this.codec.fire(record.encounters===0?'nemesisFirst':'nemesisReturn');
    this.audio.play('boss',{volume:1});
    this.camera.addShake(.7);
    this.fx.flash(this.boss.def.color,.4);
    return this.boss;
  }

  // What the contract writes back about the walker, if it showed up at all.
  nemesisOutcome(){
    const walker=this.nemesisRef;
    if(!walker)return null;
    if(walker.destroyed)return{outcome:'destroyed'};
    // Broke contact, or the contract simply ended with it still standing.
    return{outcome:walker.escaped?'escaped':'survived',scars:walker.allScars()};
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
        if(p.ally)p.ally.damageDealt+=damage;
        this.damageEnemy(enemy,damage,{
          ally:p.ally,
          weapon:p.weapon,knockback:p.knockback,critBonus:p.critBonus,
          status:p.status,statusChance:p.statusChance,
          angle:Math.atan2(p.vy,p.vx),fromX:p.px,fromY:p.py,source:'projectile',
          hitX:p.x,hitY:p.y
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
      }else{
        // Whoever the round physically reaches wears it, which is not always
        // whoever it was aimed at — an ally who steps into the line takes it.
        let struck=null;
        if(dist2(p.x,p.y,this.player.x,this.player.y)<(p.radius+this.player.radius)**2){
          struck=this.player;
        }else{
          for(const mate of this.squad){
            if(mate.downed)continue;
            if(dist2(p.x,p.y,mate.x,mate.y)>(p.radius+mate.radius)**2)continue;
            struck=mate;break;
          }
        }
        if(struck){
          const blocked=this.damageVictim(struck,p.damage,{
            source:p.source,fromX:p.px,fromY:p.py,projectile:p
          });
          if(!p.reflected)p.dead=true;
          if(blocked)this.fx.impact(p.x,p.y,Math.atan2(p.vy,p.vx),'#ff7a7a',1);
          continue;
        }
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
      // Unarmed kits project a field instead of shooting. The field is read
      // where it lands — damagePlayer for a pylon, applyEnemyAuras for a
      // snare — so there is nothing to do for one here.
      if(t.unarmed)continue;
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

  // ---- Field turrets -------------------------------------------------------

  get deployedTurrets(){
    let count=0;
    for(const turret of this.turrets)if(turret.planted&&!turret.dead)count++;
    return count;
  }

  // Records the direction a weapon just fired in, so the operative can turn to
  // face it. Called from fireDirection with the resolved fire solution itself
  // rather than with a target, so what the body faces and what the rounds do
  // are the same vector by construction.
  markEngagement(x,y){
    this.engagementX=x;
    this.engagementY=y;
    this.engagementAt=this.elapsed;
  }

  // ---- Replay --------------------------------------------------------------

  get replaying(){return !!this.replayPlayer}

  // Logs a choice the player made on the adaptation screen. Called by the
  // level-up UI, which is the only thing that can make one.
  recordDecision(kind,index=-1){
    if(this.replayPlayer)return;
    this.decisions.push({at:this.stepIndex,kind,index});
  }

  // The next logged choice during playback, or null once the log runs out —
  // which happens when a replay was cut short, and is not an error.
  takeDecision(){
    if(!this.replayPlayer)return null;
    return this.decisions[this.decisionIndex++]||null;
  }

  // Everything needed to rebuild this run from scratch. The unlocked weapon
  // list rides along because the adaptation pool is built from it, so a replay
  // watched on an account with different unlocks would be offered different
  // cards and diverge on the first level.
  replaySnapshot(save){
    if(!this.replayRecorder)return null;
    const unlocked=Object.entries(save?.weapons||{})
      .filter(([,record])=>record?.unlocked).map(([id])=>id);
    return {
      v:REPLAY_VERSION,
      seed:this.seed,
      recordedAt:Date.now(),
      operative:this.operative.id,
      map:this.map.id,
      duration:this.durationMinutes,
      difficulty:this.difficulty.id,
      primary:this.config.primary||null,
      squadmate:this.config.squadmate?.id||null,
      operation:this.config.operation?.id||null,
      devRanks:this.config.devRanks||{},
      masteryXp:this.config.masteryXp||0,
      settings:Object.fromEntries(SIM_SETTINGS.map(key=>[key,this.settings[key]])),
      unlocked,
      decisions:this.decisions,
      log:this.replayRecorder.encode()
    };
  }

  get deploySpec(){return deploySpec(this.deployRank)}

  get deployKit(){return deployKit(this.deployKitIndex)}

  // Swaps the kit the next plant will use. Free and instant — the cost of
  // switching is the cooldown already running, not a second one — because a
  // kit choice is only interesting if it can answer what is happening now.
  cycleDeployKit(){
    this.deployKitIndex=(this.deployKitIndex+1)%DEPLOY_KITS.length;
    const kit=this.deployKit;
    this.announce(`FIELD KIT // ${kit.name}`,kit.color,1.4);
    this.audio.play('select',{volume:.45});
    return kit;
  }

  // The strongest field of a given kind covering a point, or 0. Only unarmed
  // kits carry fields, so a sentry-only loadout pays one dead property read
  // per planted turret and nothing else.
  turretField(x,y,key){
    let best=0;
    for(const turret of this.turrets){
      if(turret.dead)continue;
      const strength=turret[key];
      if(!strength||strength<=best)continue;
      const radius=turret.fieldRadius;
      if(!radius||dist2(x,y,turret.x,turret.y)>radius*radius)continue;
      best=strength;
    }
    return best;
  }

  // Whether the deploy button should read as available.
  get canDeploy(){
    return this.deployCooldown<=0&&this.deployedTurrets<this.deploySpec.turrets;
  }

  // Plants a turret at the operative's feet. Returns false (without spending
  // the cooldown) when the kit is not ready or there is nowhere to put it.
  deployTurret(){
    if(!this.canDeploy)return false;
    const spec=this.deploySpec;
    const player=this.player;

    // Drop it just behind the operative so it does not block the muzzle, and
    // fall back to the operative's own footprint if that spot is solid.
    let x=player.x-Math.cos(player.angle)*26;
    let y=player.y-Math.sin(player.angle)*26;
    if(this.world.overlapsSolid(x,y,14)){
      x=player.x;y=player.y;
      if(this.world.overlapsSolid(x,y,14))return false;
    }

    // Durability scales with kit rank and how far into the run the operative
    // is, so a rank 3 chassis late in a contract genuinely holds a corridor.
    // The kit then trades on top of that: a pylon is meant to be stood behind
    // and is built for it, a snare emitter is fragile bait.
    const kit=this.deployKit;
    const maxHp=Math.round((spec.hp+this.level*8)*(1+(this.stats.area||1)-1)*(kit.hpMult||1));
    // A sentry keeps the operative's own colour, the way it always has. The
    // unarmed kits take the kit colour instead, because with no barrel to
    // rotate the colour is the only thing telling three planted discs apart.
    const color=kit.id==='sentry'?this.operative.color:kit.color;
    const turret=this.spawnTurret({
      x,y,
      kit:kit.id,
      unarmed:kit.id!=='sentry',
      damage:spec.damage*(this.stats.damage||1),
      fireRate:spec.fireRate*(this.stats.cooldown||1),
      range:300*(this.stats.area||1),
      // Area governs a field's reach the same way it governs a sentry's.
      fieldRadius:kit.fieldRadius?kit.fieldRadius*(this.stats.area||1):0,
      shelter:kit.shelter||0,
      slow:kit.slow||0,
      life:Infinity,
      projectileSpeed:560*(this.stats.projectileSpeed||1),
      color,
      weapon:null
    });
    turret.planted=true;
    turret.hp=turret.maxHp=maxHp;
    turret.rank=this.deployRank;

    this.deployCooldown=spec.cooldown*(this.stats.cooldown||1)*(kit.cooldownMult||1);
    this.telemetry.turretsDeployed++;
    this.fx.ring(x,y,6,turret.fieldRadius||44,.35,color,2);
    this.audio.play('unlock',{volume:.45});
    this.announce(`${kit.name} // ${this.deployedTurrets}/${spec.turrets}`,color,1.3);
    return true;
  }

  // Planted turrets have no expiry, so hostiles crowding one are what
  // eventually takes it down.
  updateTurretDurability(dt){
    for(const turret of this.turrets){
      if(!turret.planted||turret.dead)continue;
      const nearby=this.enemyHash.query(turret.x,turret.y,46,turretScratch);
      for(const enemy of nearby){
        if(enemy.dead)continue;
        if(dist2(enemy.x,enemy.y,turret.x,turret.y)>(enemy.radius+16)**2)continue;
        turret.hp-=(enemy.damage||6)*dt*1.6;
        turret.hitFlash=.12;
      }
      if(turret.hitFlash>0)turret.hitFlash-=dt;
      if(turret.hp<=0){
        turret.dead=true;
        this.fx.explosion(turret.x,turret.y,54,turret.color||'#76e7d4');
        this.audio.play('explode',{volume:.5});
      }
    }
  }

  // Sealed vaults: scan on approach, work the lock, pay out on breach.
  updateVaults(dt){
    const player=this.player;
    for(const vault of this.world.vaults){
      const kind=vaultKind(vault.kind);
      if(!vault.discovered){
        if(dist2(player.x,player.y,vault.x,vault.y)>VAULT_SCAN_RADIUS**2)continue;
        vault.discovered=true;
        this.telemetry.vaultsFound++;
        this.announce(kind.detect,kind.color,3);
        this.fx.ring(vault.x,vault.y,20,VAULT_SCAN_RADIUS,.9,'#f5d27a',2);
        this.codec.fire('vaultDetected');
        this.audio.play('alarm',{volume:.5});
        continue;
      }
      if(vault.breached)continue;
      if(!vault.seal.broken)this.updateVaultLock(vault,kind,dt);
      // Every lock ends the same way: once the plate is off, the chamber pays
      // out. An unsealed plate gets there by taking damage like any other
      // cover; a sealed one is retracted by openVaultSeal.
      if(vault.seal.broken)this.breachVault(vault);
    }
  }

  // The part of a vault that differs by lock. Only ever called on a discovered
  // chamber whose plate is still shut.
  updateVaultLock(vault,kind,dt){
    if(!kind.sealed)return;
    const player=this.player;

    if(vault.kind==='terminal'){
      // Nothing to do until the console goes down — wherever it is, and
      // whatever put it down.
      if(vault.terminal?.broken)this.openVaultSeal(vault,'REMOTE LOCK RELEASED');
      return;
    }

    if(vault.kind==='hold'){
      const inside=dist2(player.x,player.y,vault.x,vault.y)<=vault.holdRadius**2;
      if(inside){
        if(!vault.holding)this.beginVaultHold(vault);
        vault.hold=Math.min(vault.holdTime,vault.hold+dt);
        // The override is loud for as long as it is running.
        if(this.rng.next()<dt*6){
          this.fx.particle({
            x:vault.x+this.rng.range(-vault.half,vault.half),
            y:vault.y+this.rng.range(-vault.half,vault.half),
            vx:0,vy:-40,life:.5,size:2.2,color:'#8fd8ff',glow:true
          });
        }
        if(vault.hold>=vault.holdTime){
          vault.holding=false;
          this.openVaultSeal(vault,'OVERRIDE COMPLETE');
        }
      }else if(vault.hold>0){
        // Walking away does not reset the override, but it does bleed it back
        // faster than it filled — leaving is a real cost, not a free pause.
        vault.hold=Math.max(0,vault.hold-dt*1.5);
        if(vault.hold<=0&&vault.holding){
          vault.holding=false;
          this.announce('OVERRIDE LOST','#ff7068',1.6);
          this.audio.play('deny',{volume:.5});
        }
      }
    }
  }

  // Starts a manual override. The chamber broadcasts while it runs, which is
  // the whole trade: the operative is standing still, in the open, advertising
  // exactly where they are.
  beginVaultHold(vault){
    vault.holding=true;
    this.announce('MANUAL OVERRIDE ENGAGED // HOLD THE DOOR','#8fd8ff',2.2);
    this.audio.play('alarm',{volume:.6});
    for(const enemy of this.enemies){
      if(enemy.dead)continue;
      if(dist2(enemy.x,enemy.y,vault.x,vault.y)>900*900)continue;
      enemy.awareness=1;
      enemy.lastKnownX=this.player.x;
      enemy.lastKnownY=this.player.y;
    }
  }

  // Retracts a plate that damage was never going to open. From here the normal
  // breach path takes over, so a sealed lock and a shot-off one pay out
  // through exactly one piece of code.
  openVaultSeal(vault,message){
    if(vault.seal.broken)return;
    vault.seal.broken=true;
    // The plate stopped being geometry, and the AI's cover reads have to know.
    this.world.rebuildHash();
    this.world.buildCoverPoints();
    this.announce(message,'#8fd8ff',2);
    this.fx.ring(vault.seal.x,vault.seal.y,8,Math.max(vault.seal.w,vault.seal.h),.5,'#8fd8ff',3);
    this.audio.play('tech',{volume:.6});
  }

  breachVault(vault){
    vault.breached=true;
    this.telemetry.vaultsBreached++;
    this.fx.flash('#f5d27a',.35);
    this.fx.ring(vault.x,vault.y,10,vault.half*2.2,.7,'#f5d27a',3);
    this.camera.addShake(.4);
    this.audio.play('unlock',{volume:1});
    this.announce('VAULT BREACHED','#f5d27a',2.6);
    this.codec.fire('vaultBreached');

    const kind=vaultKind(vault.kind);
    const rng=this.rng;
    const scatter=()=>({
      x:vault.x+rng.range(-vault.half*.6,vault.half*.6),
      y:vault.y+rng.range(-vault.half*.6,vault.half*.6)
    });

    // Standing payout: credits, a supply cache (free adaptation) and a heal.
    for(let i=0;i<6;i++){
      const at=scatter();
      this.spawnPickup('credit',at.x,at.y,rng.int(35,60));
    }
    const chest=scatter();
    this.spawnPickup('chest',chest.x,chest.y,0);
    const health=scatter();
    this.spawnPickup('health',health.x,health.y,0);
    this.jp+=6;

    // A vault is the most reliable place to turn up a personnel file.
    this.spawnDossier(vault.x,vault.y+vault.half*.4);

    if(vault.guarded){
      // The garrison was sealed in with the cache. Opening it lets them out.
      this.announce('VAULT GARRISON ACTIVE','#ff7068',2.4);
      this.codec.fire('garrison');
      this.audio.play('alarm',{volume:.8});
      const count=rng.int(2,4);
      for(let i=0;i<count;i++){
        const angle=(i/count)*TAU+rng.range(-.3,.3);
        const x=vault.x+Math.cos(angle)*vault.half*.55;
        const y=vault.y+Math.sin(angle)*vault.half*.55;
        // One elite anchors the garrison; the rest are line hostiles. Elites
        // are drawn from the same tier band the director would use now.
        const tierCap=Math.min(ELITES.length,2+Math.floor(this.director.progress*ELITES.length));
        const enemy=i===0
          ? this.spawnEliteEnemy(rng.pick(ELITES.slice(0,tierCap)),x,y)
          : this.spawnEnemy(this.director.pickArchetype(rng),x,y);
        if(enemy){
          enemy.awareness=1;
          enemy.lastKnownX=this.player.x;
          enemy.lastKnownY=this.player.y;
        }
      }
    }

    // Every lock but the plain cache asks for something the cache does not,
    // and pays the difference back in credits.
    if(kind.bonusCredits)this.credits+=Math.round(kind.bonusCredits*this.creditGainMult);
  }

  // Drops a personnel cache near the operative. Silently does nothing when
  // there is no unrecovered file left to find, or the run has already had its
  // share, so the caller never has to check first.
  spawnDossier(x=this.player.x,y=this.player.y){
    if(!this.discoverable.length)return false;
    if(this.dossiersSpawned>=this.maxDossiers)return false;
    this.dossiersSpawned++;
    this.spawnPickup('dossier',x+this.rng.range(-24,24),y+this.rng.range(-24,24),0);
    this.announce('PERSONNEL CACHE DETECTED','#f5d27a',2.4);
    this.codec.fire('personnelCache');
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
        this.codec.fire('personnelFound');
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
    }else if(choice.kind==='deploy'){
      this.deployRank=Math.min(MAX_DEPLOY_RANK,this.deployRank+1);
      // A fresh rank arrives ready so the upgrade is felt immediately.
      this.deployCooldown=0;
      this.announce(`DEPLOYMENT KIT // ${this.deploySpec.turrets}× TURRETS`,'#ffb35c',1.6);
    }

    this.loadout.recompute(this.externalModifiers());
    this.stats=this.loadout.stats;
    this.syncMaxHp();

    const forged=this.loadout.checkEvolutions();
    for(const evolution of forged){
      this.telemetry.evolutions.push(evolution.id);
      this.announce(`EVOLUTION // ${evolution.name}`,'#ffb35c',3);
      this.codec.fire('evolution');
      this.fx.flash('#ffb35c',.4);
      this.audio.play('unlock',{volume:1});
      this.onEvolution?.(evolution);
    }

    // Taking an adaptation patches the operative up a little.
    this.healPlayer(Math.round(this.player.maxHp*LEVEL_UP_HEAL),true);

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
        try{entry.action()}catch(err){console.warn('[red-static] scheduled action failed',err)}
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
    this.codec.fire('extraction');
    this.announce('EXFIL PROTOCOL // MOVEMENT BOOSTED','#8bff9b',3);
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
        // An operation with an unmet objective does not get to leave.
        if(!this.mission.objectiveMet){
          this.extractionHold=0;
          if(!this._blockedNotice||this.elapsed-this._blockedNotice>4){
            this._blockedNotice=this.elapsed;
            this.announce(`OBJECTIVE INCOMPLETE // ${this.mission.blockedReason}`,'#ff7068',2.4);
            this.codec.fire('extractionBlocked');
          }
          return;
        }
        this.extractionHold=(this.extractionHold||0)+this.dt;
        if(this.extractionHold>=EXTRACTION_HOLD*this.extractionHoldMult)this.finish(true,'EXTRACTION CONFIRMED');
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
    // Nothing more comes over the channel once the contract closes, so a
    // callout cannot arrive over the results screen.
    this.codec.clear();
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
      // What the second operative was worth, and whether they walked out.
      squad:this.squad.map(mate=>({
        id:mate.id,codename:mate.codename,color:mate.color,
        kills:mate.kills,damageDealt:Math.round(mate.damageDealt),
        downed:mate.downed
      })),
      squadLeftBehind:this.squad.filter(mate=>mate.downed).map(mate=>mate.id),
      nemesis:this.nemesisOutcome(),
      objectivesCleared:this.objectives.completed,
      mission:this.mission.summary(),
      vaultsFound:this.telemetry.vaultsFound,
      vaultsBreached:this.telemetry.vaultsBreached,
      turretsDeployed:this.telemetry.turretsDeployed,
      deployRank:this.deployRank,
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
const turretScratch=[];
const MULTIPLICATIVE=new Set([
  'damage','fireRate','area','projectileSpeed','duration','moveSpeed',
  'magnet','xpGain','luck','cooldown','critDamage'
]);

// Minimal elite lookup for minibosses, keyed by their base elite id.
import {ELITES} from '../../data/enemies.js';
const ELITE_FALLBACK=Object.fromEntries(ELITES.map(e=>[e.id,e]));

export {FIXED_STEP};
