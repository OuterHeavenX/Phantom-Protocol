import {ENEMIES,ENEMIES_BY_ID,ELITES,CHOPPER,CARRIER} from '../../data/enemies.js';
import {MINIBOSSES} from '../../data/bosses.js';
import {clamp,TAU} from '../core/math.js';
import {Squad} from './ai.js';

// Spawn director. Owns pacing: how many hostiles, of what type, in what
// formation, and when the run escalates. Replaces the previous build's flat
// "spawn one every N seconds" loop with a wave/lull rhythm, squad formations,
// scripted set-pieces and a live pressure controller.

const WAVE_STATES={LULL:'lull',DEPLOY:'deploy',SUSTAIN:'sustain',SURGE:'surge'};

// Wall-clock span over which threat escalation reaches its ceiling, regardless
// of how long the contract itself runs.
const ESCALATION_SECONDS=12*60;

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
        this.stateTimer=4+Math.random()*2;
        break;
      }
      case WAVE_STATES.DEPLOY:{
        this.state=WAVE_STATES.SUSTAIN;
        this.stateTimer=6+Math.random()*4;
        break;
      }
      case WAVE_STATES.SUSTAIN:{
        // Occasional surges break the rhythm so it never feels metronomic.
        if(progress>.25&&Math.random()<.32){
          this.state=WAVE_STATES.SURGE;
          this.queueSurge();
          this.stateTimer=5;
        }else{
          this.state=WAVE_STATES.LULL;
          this.stateTimer=clamp(6-progress*4,1.6,6)+Math.random()*1.5;
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
      const squad=new Squad('assault');
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
    const squad=new Squad('assault');
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
    const distance=engine.camera.viewHalfWidth(180)+rng.range(0,260);
    const point=engine.world.findSpawn(rng,{
      x:engine.player.x+Math.cos(angle)*distance,
      y:engine.player.y+Math.sin(angle)*distance
    },0,180);

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
    const distance=engine.camera.viewHalfWidth(200);
    const point=engine.world.findSpawn(rng,{
      x:engine.player.x+Math.cos(angle)*distance,
      y:engine.player.y+Math.sin(angle)*distance
    },0,200);
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
      const distance=engine.camera.viewHalfWidth(220)+rng.range(60,220);
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
      const distance=engine.camera.viewHalfWidth(60)+rng.range(20,90);
      const point=engine.world.findSpawn(rng,{
        x:engine.player.x+Math.cos(angle)*distance,
        y:engine.player.y+Math.sin(angle)*distance
      },0,220);
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
      this.fireEvent(event);
    }
  }

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
        engine.spawnNemesis();
        break;
      }
      case 'boss':
      case 'finalBoss':{
        engine.spawnBoss(this.bossId);
        this.bossesSpawned++;
        break;
      }
      default:break;
    }
  }

  // Text describing the current phase, shown on the HUD.
  phaseLabel(){
    if(this.engine.boss)return 'COMMAND SIGNATURE ACTIVE';
    if(this.engine.extraction)return 'EXTRACTION PHASE';
    const progress=this.progress;
    if(this.state===WAVE_STATES.SURGE)return 'HOSTILE SURGE';
    if(progress>.85)return 'TOTAL LOCKDOWN';
    if(progress>.6)return 'HEAVY RESPONSE';
    if(progress>.3)return 'ESCALATION';
    return 'INFILTRATION';
  }
}

export {WAVE_STATES};
