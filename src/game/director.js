import {ENEMIES,ENEMIES_BY_ID,ELITES,CHOPPER,CARRIER} from '../../data/enemies.js';
import {MINIBOSSES} from '../../data/bosses.js';
import {clamp,TAU} from '../core/math.js';
import {MAX_VISIBLE_WIDTH,MAX_VISIBLE_HEIGHT} from '../core/camera.js';
import {Squad} from './ai.js';

// Spawn director. Owns pacing: how many hostiles, of what type, in what
// formation, and when the run escalates. Replaces the previous build's flat
// "spawn one every N seconds" loop with a wave/lull rhythm, squad formations,
// scripted set-pieces and a live pressure controller.

const WAVE_STATES={LULL:'lull',DEPLOY:'deploy',SUSTAIN:'sustain',SURGE:'surge'};

// Wall-clock span over which threat escalation reaches its ceiling, regardless
// of how long the contract itself runs.
const ESCALATION_SECONDS=12*60;

// How far from the operative reinforcements arrive, in world units.
//
// This used to be `camera.viewHalfWidth(margin)`, which made hostile
// deployment a function of the browser window. A wide desktop deployed at
// about 460 units; an iPhone in portrait at about 272 — well inside the 590
// units of ground that phone can see vertically, so on the primary handheld
// target hostiles materialised in plain view. It also moved with the cosmetic
// zoom punch on a boss reveal, and with the performance-mode setting, because
// both change the camera.
//
// The camera never shows more than MAX_VISIBLE_WIDTH x MAX_VISIBLE_HEIGHT of
// world, so half that rectangle's diagonal is the nearest a hostile can deploy
// and still be off screen on every device and at every zoom. It lands inside
// the range the desktop build already used, which is why this is a
// renderer-independence fix rather than a pacing change.
const DEPLOY_RADIUS=Math.hypot(MAX_VISIBLE_WIDTH,MAX_VISIBLE_HEIGHT)/2;

// Carriers are the nearest thing to deploy, on purpose: one drives in on the
// ground with only local avoidance to steer by, so every extra metre of
// geometry between it and the operative is another chance to wedge. "Nearest"
// is expressed as the smallest spread on top of DEPLOY_RADIUS rather than as a
// smaller radius — a first attempt at 0.82x put a carrier inside an iPhone's
// visible rectangle at around seventy degrees off horizontal, which is exactly
// the class of viewport-dependent bug this whole change is removing.
const CARRIER_SPREAD=60;

export class Director{
  constructor(engine,options){
    this.engine=engine;
    this.difficulty=options.difficulty;
    this.durationSeconds=options.duration*60;
    this.enemyBias=options.map.enemyBias||{};
    this.bossId=options.map.boss;

    this.state=WAVE_STATES.LULL;
    this.stateTimer=3;
    this.waveIndex=0;
    this.spawnQueue=[];
    this.spawnTimer=0;
    this.eliteTimer=78;
    this.minibossTimer=0;
    this.pressure=0;
    this.lastPressureSample=0;
    this.bossSpawned=false;
    this.bossesSpawned=0;
    // Scheduled events that came due at a moment they could not run.
    this.pendingEvents=[];
    this.scriptedEvents=this.buildEventSchedule(options.duration);
    this.eventIndex=0;
    this.totalSpawned=0;
  }

  // Progress through the contract, 0..1. Drives scripted pacing — where the
  // boss lands, when the contract ends — which must stay tied to its length.
  get progress(){return clamp(this.engine.elapsed/this.durationSeconds,0,1)}

  // How far the *threat* has escalated, 0..1. Deliberately not the same thing
  // as progress: the operative's power comes from kills, which accrue in real
  // time, so indexing pressure purely to contract fraction made a five-minute
  // probe roughly three times as intense as a fifteen-minute operation at the
  // same point on the clock — the shortest contract was the hardest one.
  // Escalation is therefore mostly wall-clock, with enough contract fraction
  // mixed in that a short contract still peaks before it ends.
  get escalation(){
    const byClock=clamp(this.engine.elapsed/ESCALATION_SECONDS,0,1);
    return clamp(byClock*.7+this.progress*.3,0,1);
  }

  // How hard the run should feel right now, factoring difficulty and time.
  get intensity(){
    const time=this.progress;
    return clamp(time*.75+this.pressure*.25,0,1)*(1+this.difficulty.densityMult*.12);
  }

  // Hard cap on simultaneous hostiles, tuned per quality setting.
  get enemyCap(){
    const performance=this.engine.settings.performanceMode;
    const base=performance?68:100;
    // Ramp shape matters more than the ceiling: the previous quadratic put the
    // arena at its cap by the three-minute mark, and a player pinned against
    // the cap can never clear faster than hostiles arrive. This keeps the
    // opening sparse, reaches roughly half the ceiling at the midpoint, and
    // saves genuine saturation for the closing minutes.
    const ramp=.16+Math.pow(this.escalation,1.7)*.84;
    // While a command signature is active the trash population is thinned so
    // the encounter stays readable and the boss is actually fightable.
    const bossThinning=this.engine.boss?.45:1;
    // Extraction is a withdrawal, not another wave: the objective is done and
    // the operative has to cross the sector to the beacon. Holding full
    // saturation through that turned the last minute into the hardest part of
    // the contract by a wide margin.
    const extractionThinning=this.engine.extraction?.35:1;
    return Math.round(base*ramp*this.difficulty.densityMult*bossThinning*extractionThinning);
  }

  // Miniboss and named events, scheduled across the contract length.
  buildEventSchedule(durationMinutes){
    const events=[];
    const total=durationMinutes*60;
    // Air support. One gunship on the way in; a flight of two or three once
    // the sector has had time to call it in properly.
    events.push({at:total*.36,type:'gunship',count:1});
    // Carriers: one mid-contract on anything meaningful, a second pair later.
    // Scheduled rather than drawn from the pool, like the gunship.
    if(durationMinutes>=10)events.push({at:total*.52,type:'carrier',count:1});
    if(durationMinutes>=20)events.push({at:total*.72,type:'carrier',count:2});
    if(durationMinutes>=10)events.push({at:total*.66,type:'gunship',count:2});
    if(durationMinutes>=20)events.push({at:total*.82,type:'gunship',count:3});
    // The walker, when the operator's record says it is due. Early enough in
    // the contract that breaking contact with it is a loss you have to live
    // with rather than something the clock decides for you.
    if(this.engine.config.nemesis)events.push({at:total*.44,type:'nemesis'});
    if(durationMinutes>=10)events.push({at:total*.30,type:'miniboss'});
    if(durationMinutes>=20)events.push({at:total*.42,type:'boss'});
    if(durationMinutes>=15)events.push({at:total*.50,type:'eliteSquad'});
    if(durationMinutes>=15)events.push({at:total*.62,type:'miniboss'});
    if(durationMinutes>=25)events.push({at:total*.68,type:'eliteSquad'});
    // The command signature must arrive with enough of the contract left to
    // be a real encounter — at 94% the player could simply walk to the
    // extraction beacon and skip the fight entirely.
    events.push({at:total*.74,type:'finalBoss'});
    if(durationMinutes>=20)events.push({at:total*.88,type:'swarmEvent'});
    return events.sort((a,b)=>a.at-b.at);
  }

  // Archetypes legal at the current point in the run. Tier 2 roughly triples
  // an archetype's health over tier 0/1, so opening that band early was the
  // single largest jump in incoming pressure — it now lands past the midpoint,
  // once the operative has had time to level weapons into it.
  availableArchetypes(){
    const tierCap=Math.floor(this.escalation*3.6)+(this.difficulty.id>=3?1:0);
    return ENEMIES.filter(e=>e.tier<=tierCap);
  }

  pickArchetype(rng){
    const pool=this.availableArchetypes();
    return rng.weighted(pool,e=>(e.weight||1)*(this.enemyBias[e.id]||1));
  }

  update(dt){
    const engine=this.engine;
    // A duel is one opponent and nothing else: no waves, no elites, no boss
    // schedule beyond the one the mission placed itself.
    if(this.suppressed)return;
    this.samplePressure(dt);
    this.runScriptedEvents();

    // Drain any queued spawns at a controlled rate so waves trickle in
    // instead of appearing all at once.
    if(this.spawnQueue.length){
      this.spawnTimer-=dt;
      if(this.spawnTimer<=0&&engine.enemies.length<this.enemyCap){
        const request=this.spawnQueue.shift();
        this.executeSpawn(request);
        this.spawnTimer=request.gap??.14;
      }
    }

    // Once the extraction window opens the director stops committing new
    // waves; whatever is already on the field is what the operative has to
    // get past.
    if(engine.extraction)return;

    this.stateTimer-=dt;
    if(this.stateTimer<=0)this.advanceState();

    this.eliteTimer-=dt;
    if(this.eliteTimer<=0&&this.escalation>.22){
      this.spawnElite();
      this.eliteTimer=clamp(46-this.escalation*30,10,46)/this.difficulty.densityMult;
    }
  }

  // Pressure rises when the player is comfortable and falls when they are not,
  // so the director keeps the fight tense without spiralling into a wipe.
  samplePressure(dt){
    const engine=this.engine;
    const healthRatio=engine.player.hp/engine.player.maxHp;
    const crowding=clamp(engine.enemies.length/Math.max(20,this.enemyCap*.6),0,1.4);
    const comfort=healthRatio*.6+(1-crowding)*.4;
    const target=clamp(comfort,0,1);
    this.pressure+=(target-this.pressure)*dt*.25;
  }

  advanceState(){
    const progress=this.progress;
    switch(this.state){
      case WAVE_STATES.LULL:{
        this.state=WAVE_STATES.DEPLOY;
        this.waveIndex++;
        this.queueWave();
        this.stateTimer=4+this.engine.rng.range(0,2);
        break;
      }
      case WAVE_STATES.DEPLOY:{
        this.state=WAVE_STATES.SUSTAIN;
        this.stateTimer=6+this.engine.rng.range(0,4);
        break;
      }
      case WAVE_STATES.SUSTAIN:{
        // Occasional surges break the rhythm so it never feels metronomic.
        if(progress>.25&&this.engine.rng.next()<.32){
          this.state=WAVE_STATES.SURGE;
          this.queueSurge();
          this.stateTimer=5;
        }else{
          this.state=WAVE_STATES.LULL;
          this.stateTimer=clamp(6-progress*4,1.6,6)+this.engine.rng.range(0,1.5);
        }
        break;
      }
      default:{
        this.state=WAVE_STATES.LULL;
        this.stateTimer=clamp(5-progress*3,1.4,5);
      }
    }
  }

  queueWave(){
    const rng=this.engine.rng;
    const progress=this.progress;
    // The wave-index term used to compound without limit, so a long contract
    // ended up sending waves sized by how many had already been sent rather
    // than by how far into the contract the operative was.
    const escalation=this.escalation;
    const size=Math.round(
      (3+escalation*escalation*17+Math.min(this.waveIndex,26)*.28)*
      this.difficulty.densityMult*(1+this.pressure*.3)
    );
    // Waves arrive as coherent squads from one or two bearings, not as a
    // uniform ring around the player.
    const groups=clamp(Math.round(size/6),1,4);
    for(let g=0;g<groups;g++){
      const bearing=rng.angle();
      const squad=new Squad('assault',this.engine.rng);
      const members=Math.ceil(size/groups);
      const archetype=this.pickArchetype(rng);
      for(let i=0;i<members;i++){
        // Mixed squads: a lead archetype plus supporting variety.
        const type=rng.bool(.65)?archetype:this.pickArchetype(rng);
        this.spawnQueue.push({archetype:type,bearing,squad,spread:.5,gap:.1});
      }
    }
  }

  queueSurge(){
    const rng=this.engine.rng;
    const size=Math.round((8+this.escalation*13)*this.difficulty.densityMult);
    const squad=new Squad('assault',this.engine.rng);
    const bearing=rng.angle();
    for(let i=0;i<size;i++){
      this.spawnQueue.push({archetype:this.pickArchetype(rng),bearing,squad,spread:1.2,gap:.05});
    }
    this.engine.announce('HOSTILE SURGE INBOUND','#ff7068');
    this.engine.audio.play('alarm',{volume:.7});
  }

  executeSpawn(request){
    const engine=this.engine;
    const rng=engine.rng;
    const angle=request.bearing+(rng.next()-.5)*(request.spread??.6);
    const distance=DEPLOY_RADIUS+rng.range(0,180);
    const point=engine.world.findSpawn(rng,{
      x:engine.player.x+Math.cos(angle)*distance,
      y:engine.player.y+Math.sin(angle)*distance
    },0,180,(ENEMIES_BY_ID[request.archetype?.id]?.radius||request.archetype?.radius||12)+4);

    const enemy=engine.spawnEnemy(request.archetype,point.x,point.y,request.options);
    if(!enemy)return null;
    // Reinforcements are deployed against a known contact: they advance on the
    // player's last reported position rather than spawning outside their own
    // detection range and wandering. Awareness is partial, so they still have
    // to actually acquire the target before they open fire.
    enemy.awareness=.55;
    enemy.memory=8;
    enemy.lastKnownX=engine.player.x;
    enemy.lastKnownY=engine.player.y;
    if(request.squad)request.squad.add(enemy);
    this.totalSpawned++;
    return enemy;
  }

  spawnElite(){
    const engine=this.engine;
    const rng=engine.rng;
    const tierCap=Math.min(ELITES.length,2+Math.floor(this.escalation*ELITES.length));
    const elite=rng.pick(ELITES.slice(0,tierCap));
    const angle=rng.angle();
    const distance=DEPLOY_RADIUS;
    const point=engine.world.findSpawn(rng,{
      x:engine.player.x+Math.cos(angle)*distance,
      y:engine.player.y+Math.sin(angle)*distance
    },0,200,(elite.radius||18)+6);
    const enemy=engine.spawnEliteEnemy(elite,point.x,point.y);
    if(enemy){
      enemy.awareness=1;
      enemy.memory=12;
      enemy.lastKnownX=engine.player.x;
      enemy.lastKnownY=engine.player.y;
      engine.announce(`ELITE CONTACT // ${elite.name.toUpperCase()}`,elite.color);
      engine.audio.play('alarm',{volume:.55});
    }
    return enemy;
  }

  // Air support arrives from one bearing, spread along it, already aware of
  // the operative — a gunship that has to search for its target is not a
  // gunship.
  spawnGunships(count){
    const engine=this.engine;
    const rng=engine.rng;
    const bearing=rng.angle();
    let deployed=0;
    for(let i=0;i<count;i++){
      const angle=bearing+(i-(count-1)/2)*.45;
      const distance=DEPLOY_RADIUS+rng.range(0,160);
      const x=clamp(engine.player.x+Math.cos(angle)*distance,60,engine.world.width-60);
      const y=clamp(engine.player.y+Math.sin(angle)*distance,60,engine.world.height-60);
      // Flying, so it does not need a clear ground spawn — only to be inside
      // the arena.
      const enemy=engine.spawnEnemy(CHOPPER,x,y,{});
      if(!enemy)continue;
      enemy.awareness=1;
      enemy.memory=20;
      enemy.lastKnownX=engine.player.x;
      enemy.lastKnownY=engine.player.y;
      deployed++;
    }
    if(!deployed)return;
    engine.announce(
      deployed>1?`AIR SUPPORT INBOUND // ${deployed} GUNSHIPS`:'AIR SUPPORT INBOUND',
      '#c8d2d6',3.4
    );
    engine.audio.play('alarm',{volume:.85});
    engine.codec?.fire('gunship');
  }

  spawnCarriers(count){
    const engine=this.engine;
    const rng=engine.rng;
    const bearing=rng.angle();
    let deployed=0;
    for(let i=0;i<count;i++){
      const angle=bearing+(i-(count-1)/2)*.7;
      // Just beyond the edge of view. A carrier has to drive in on the ground
      // with only local avoidance to steer by, so every extra metre of
      // geometry between it and the operative is another chance to wedge.
      const distance=DEPLOY_RADIUS+rng.range(0,CARRIER_SPREAD);
      const point=engine.world.findSpawn(rng,{
        x:engine.player.x+Math.cos(angle)*distance,
        y:engine.player.y+Math.sin(angle)*distance
      },0,220,(CARRIER.radius||30)+8);
      const carrier=engine.spawnEnemy(CARRIER,point.x,point.y,{});
      if(!carrier)continue;
      carrier.awareness=1;
      carrier.memory=30;
      carrier.lastKnownX=engine.player.x;
      carrier.lastKnownY=engine.player.y;
      deployed++;
    }
    if(!deployed)return;
    engine.announce(
      deployed>1?`CARRIERS INBOUND // ${deployed}`:'CARRIER INBOUND',
      '#d8c98a',3.2
    );
    engine.audio.play('alarm',{volume:.7});
    engine.codec?.fire('carrier');
  }

  runScriptedEvents(){
    while(this.eventIndex<this.scriptedEvents.length&&
          this.engine.elapsed>=this.scriptedEvents[this.eventIndex].at){
      const event=this.scriptedEvents[this.eventIndex++];
      if(!this.fireEvent(event))this.pendingEvents.push(event);
    }
    this.retryHeldEvents();
  }

  // Events that could not fire when they came due.
  //
  // Everything that can be held is held for one reason: a signature was
  // already in the sector, and both `spawnBoss` and `spawnNemesis` refuse
  // while one is. So there is nothing to retry until that is gone — the first
  // version retried on every step regardless and made 18,722 refused calls in
  // a single twenty-minute contract.
  //
  // The attempt cap is for the refusals that are not about the boss at all: a
  // theatre naming a signature that is not in the table, or a walker event on
  // a save with no record. Those can never succeed, and without a cap they
  // would sit in the queue being retried for the rest of the contract.
  retryHeldEvents(){
    if(!this.pendingEvents.length)return;
    // Past the clock the contract is asking the operative to leave, and a
    // fresh signature is not a thing to drop on them on their way out.
    if(this.engine.extraction){this.pendingEvents.length=0;return}
    if(this.engine.boss)return;
    const held=this.pendingEvents.shift();
    if(this.fireEvent(held))return;
    held.attempts=(held.attempts||0)+1;
    if(held.attempts<3)this.pendingEvents.push(held);
  }

  // Returns false when the event came due at a moment it could not run, and
  // wants holding for later. Anything else counts as handled.
  fireEvent(event){
    const engine=this.engine;
    switch(event.type){
      case 'gunship':{
        this.spawnGunships(event.count||1);
        break;
      }
      case 'miniboss':{
        const spec=engine.rng.pick(MINIBOSSES);
        engine.spawnMiniboss(spec);
        break;
      }
      case 'eliteSquad':{
        engine.announce('ELITE RESPONSE TEAM DEPLOYED','#ff8b68');
        for(let i=0;i<3;i++)engine.scheduleAction(i*.6,()=>this.spawnElite());
        break;
      }
      case 'swarmEvent':{
        engine.announce('TOTAL LOCKDOWN // SATURATION RESPONSE','#ff5b7a');
        engine.audio.play('alarm',{volume:1});
        this.queueSurge();
        this.queueSurge();
        break;
      }
      case 'carrier':{
        this.spawnCarriers(event.count||1);
        break;
      }
      case 'nemesis':{
        // The walker refuses on the same condition as a signature, and on a
        // twenty-minute contract it is scheduled at 44% against a boss at 42%
        // — twenty-four seconds apart, against a fight tuned to last minutes.
        // Measured: refused every time, so on any long contract where the
        // operator's record said the walker was due, it never came. It queues
        // behind the signature now instead of being lost.
        if(!engine.spawnNemesis())return false;
        break;
      }
      case 'boss':
      case 'finalBoss':{
        // `spawnBoss` refuses while a signature is already in the sector, and
        // this used to swallow the refusal. A twenty-minute contract schedules
        // one at 42% and its climax at 74%; measured on a real timeline, the
        // first was still alive when the second came due, so the contract's
        // final boss silently never happened. The event is held instead and
        // retried once the sector is clear.
        if(!engine.spawnBoss(this.bossId))return false;
        this.bossesSpawned++;
        break;
      }
      default:break;
    }
    return true;
  }

  // Text describing the current phase, shown on the HUD.
  phaseLabel(){
    // Extraction outranks the signature. It used to be the other way around,
    // which meant that on a contract whose boss was still standing when the
    // clock ran out — the common case on a long one — the HUD went on saying
    // COMMAND SIGNATURE ACTIVE for the whole sixty-second window and never
    // once told the operative the door was open. The window closed on them.
    if(this.engine.extraction){
      return this.engine.boss?'EXTRACT NOW // SIGNATURE ACTIVE':'EXTRACTION PHASE';
    }
    if(this.engine.boss)return 'COMMAND SIGNATURE ACTIVE';
    const progress=this.progress;
    if(this.state===WAVE_STATES.SURGE)return 'HOSTILE SURGE';
    if(progress>.85)return 'TOTAL LOCKDOWN';
    if(progress>.6)return 'HEAVY RESPONSE';
    if(progress>.3)return 'ESCALATION';
    return 'INFILTRATION';
  }
}

export {WAVE_STATES};
