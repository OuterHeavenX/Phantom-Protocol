import {dist,dist2,clamp,TAU} from '../core/math.js';

// Mission objectives layered over the survival loop.
//
// The base contract is "survive the window, reach the beacon". A campaign
// operation can additionally require data caches to be recovered, an asset to
// be walked out alive, or a single prototype to be put down with no
// reinforcement on either side. Each type owns its own spawning, updating,
// completion test and HUD line, so the engine only has to call three methods.

const CACHE_MIN_SPACING=520;

export class Mission{
  constructor(engine,spec){
    this.engine=engine;
    this.type=spec?.type||'extract';
    this.spec=spec||{};
    this.complete=false;
    this.failed=false;
    this.caches=[];
    this.recovered=0;
    this.asset=null;
    this.prototype=null;
    this.announcedReady=false;
    this.setup();
  }

  // ---- Setup --------------------------------------------------------------

  setup(){
    if(this.type==='recover')this.setupCaches();
    else if(this.type==='rescue')this.setupAsset();
    else if(this.type==='duel')this.setupDuel();
  }

  setupCaches(){
    const engine=this.engine;
    const world=engine.world;
    const target=this.spec.caches||3;
    let attempts=0;
    while(this.caches.length<target&&attempts<400){
      attempts++;
      const x=engine.rng.range(200,world.width-200);
      const y=engine.rng.range(200,world.height-200);
      if(!world.playable(x,y,120))continue;
      if(world.overlapsSolid(x,y,60))continue;
      if(world.insideVault(x,y,40))continue;
      // Spread them out, and keep the first one off the operative's start.
      if(dist2(x,y,world.spawnPoint.x,world.spawnPoint.y)<420*420)continue;
      if(this.caches.some(c=>dist2(c.x,c.y,x,y)<CACHE_MIN_SPACING**2))continue;
      this.caches.push({x,y,recovered:false,progress:0,phase:engine.rng.next()*10});
    }
    engine.announce(`RECOVER ${this.caches.length} DATA CACHES`,'#8fd8ff',3.4);
  }

  setupAsset(){
    const engine=this.engine;
    const world=engine.world;
    // The asset starts somewhere the operative has to go and find.
    let spot=null;
    for(let attempt=0;attempt<300&&!spot;attempt++){
      const x=engine.rng.range(220,world.width-220);
      const y=engine.rng.range(220,world.height-220);
      if(!world.playable(x,y,140))continue;
      if(world.overlapsSolid(x,y,54))continue;
      if(world.insideVault(x,y,40))continue;
      if(dist2(x,y,world.spawnPoint.x,world.spawnPoint.y)<700*700)continue;
      spot={x,y};
    }
    spot=spot||{x:world.width/2,y:world.height/2};
    this.asset={
      x:spot.x,y:spot.y,radius:12,angle:0,
      hp:70,maxHp:70,found:false,aboard:false,downed:false,
      hitFlash:0,bob:engine.rng.next()*10,name:'ASSET'
    };
    engine.announce('LOCATE THE ASSET','#8bff9b',3.4);
  }

  setupDuel(){
    // The duel's opponent is the theatre's command signature, spawned at once
    // rather than scheduled, and the director is muted for the whole run.
    const engine=this.engine;
    engine.director.suppressed=true;
    engine.spawnBoss(engine.map.boss);
    this.prototype=engine.boss;
    if(this.prototype){
      this.prototype.name='PROTOTYPE ONE';
      this.prototype.isPrototype=true;
    }
    engine.announce('PROTOTYPE ONE // NO REINFORCEMENT','#ff8d9a',4);
  }

  // ---- Update -------------------------------------------------------------

  update(dt){
    if(this.type==='recover')this.updateCaches(dt);
    else if(this.type==='rescue')this.updateAsset(dt);
    else if(this.type==='duel')this.updateDuel(dt);
  }

  updateCaches(dt){
    const engine=this.engine;
    const player=engine.player;
    for(const cache of this.caches){
      if(cache.recovered)continue;
      // Standing on a cache downloads it; stepping off pauses rather than
      // resetting, so a dodge mid-download does not cost the whole thing.
      if(dist2(player.x,player.y,cache.x,cache.y)<86*86){
        cache.progress=Math.min(1,cache.progress+dt*.5);
        if(cache.progress>=1){
          cache.recovered=true;
          this.recovered++;
          engine.credits+=90;
          engine.jp+=4;
          engine.fx.ring(cache.x,cache.y,12,120,.6,'#8fd8ff',3);
          engine.audio.play('unlock',{volume:.8});
          engine.announce(
            this.recovered>=this.caches.length
              ? 'ALL CACHES RECOVERED // EXTRACT'
              : `CACHE RECOVERED // ${this.recovered}/${this.caches.length}`,
            '#8fd8ff',2.4
          );
          engine.codec?.fire('missionProgress');
        }
      }else{
        cache.progress=Math.max(0,cache.progress-dt*.2);
      }
    }
  }

  updateAsset(dt){
    const engine=this.engine;
    const asset=this.asset;
    if(!asset||asset.downed)return;
    const player=engine.player;

    if(!asset.found){
      if(dist2(player.x,player.y,asset.x,asset.y)<130*130){
        asset.found=true;
        asset.aboard=true;
        engine.announce('ASSET SECURED // WALK THEM OUT','#8bff9b',3);
        engine.codec?.fire('missionProgress');
        engine.fx.ring(asset.x,asset.y,10,150,.6,'#8bff9b',3);
        engine.audio.play('unlock',{volume:.8});
      }
      return;
    }

    // Once secured the asset follows a step behind, and is a real body that
    // hostiles can shoot — losing them fails the operation.
    const target=dist(asset.x,asset.y,player.x,player.y);
    if(target>52){
      const speed=Math.min(engine.player.baseSpeed*1.02,(target-40)*3.2);
      const dx=(player.x-asset.x)/target,dy=(player.y-asset.y)/target;
      asset.x+=dx*speed*dt;
      asset.y+=dy*speed*dt;
      asset.angle=Math.atan2(dy,dx);
      engine.world.resolveCollision(asset,asset.radius);
    }
    if(asset.hitFlash>0)asset.hitFlash-=dt;

    // Splash damage and stray fire from nearby hostiles wear the asset down.
    for(const enemy of engine.enemies){
      if(enemy.dead)continue;
      if(dist2(enemy.x,enemy.y,asset.x,asset.y)>(enemy.radius+22)**2)continue;
      asset.hp-=(enemy.damage||6)*dt*.5;
      asset.hitFlash=.12;
    }
    if(asset.hp<=0){
      asset.downed=true;
      this.failed=true;
      engine.fx.burst(asset.x,asset.y,14,{speed:150,life:.5,color:'#ff7068'});
      engine.announce('ASSET LOST','#ff7068',4);
      engine.finish(false,'ASSET LOST');
    }
  }

  updateDuel(){
    const engine=this.engine;
    if(!this.prototype)return;
    // The prototype dying is the win condition, not a step toward one.
    if(this.prototype.dead||engine.boss===null){
      if(!this.complete){
        this.complete=true;
        engine.announce('PROTOTYPE DOWN','#8bff9b',3);
        engine.finish(true,'PROTOTYPE NEUTRALISED');
      }
    }
  }

  // ---- Completion ---------------------------------------------------------

  // Whether the extraction beacon will accept the operative. A mission with an
  // unmet objective keeps the door shut and says why.
  get objectiveMet(){
    if(this.type==='recover')return this.recovered>=this.caches.length;
    if(this.type==='rescue')return !!this.asset?.aboard&&!this.asset.downed;
    return true;
  }

  get blockedReason(){
    if(this.type==='recover')return `CACHES ${this.recovered}/${this.caches.length}`;
    if(this.type==='rescue')return 'ASSET NOT SECURED';
    return '';
  }

  // One line for the HUD, or null when the base contract is the whole job.
  hudLine(){
    if(this.type==='recover'){
      return{label:'DATA CACHES',value:`${this.recovered}/${this.caches.length}`,
             done:this.objectiveMet};
    }
    if(this.type==='rescue'){
      if(this.asset?.downed)return{label:'ASSET',value:'LOST',done:false};
      return{label:'ASSET',value:this.asset?.aboard?'SECURED':'LOCATE',
             done:!!this.asset?.aboard};
    }
    if(this.type==='duel'&&this.prototype){
      return{label:'PROTOTYPE ONE',
             value:`${Math.max(0,Math.round(this.prototype.healthRatio*100))}%`,done:false};
    }
    return null;
  }

  summary(){
    return{
      type:this.type,
      complete:this.type==='duel'?this.complete:this.objectiveMet,
      recovered:this.recovered,
      caches:this.caches.length,
      assetSecured:!!this.asset?.aboard&&!this.asset?.downed
    };
  }
}
