import {clamp,damp,normalize,dist,dist2,angleDelta,approachAngle,TAU} from '../core/math.js';

// Enemy intelligence.
//
// Three layers cooperate:
//   1. Squads   — groups of enemies that share a tactical objective and a
//                 morale pool, coordinated by a commander unit.
//   2. Brains   — a per-archetype finite state machine (search, engage,
//                 flank, take cover, suppress, reposition, retreat).
//   3. Steering — seek/arrive/separate/avoid forces blended into one move
//                 vector, so units never stack or walk through geometry.
//
// The previous build ran a single shared "orbit a slot angle" routine for
// every enemy and re-derived it from scratch each frame.

export const AI_STATES={
  IDLE:'idle',SEARCH:'search',ENGAGE:'engage',FLANK:'flank',
  COVER:'cover',SUPPRESS:'suppress',CHARGE:'charge',RETREAT:'retreat',
  REGROUP:'regroup',AMBUSH:'ambush',WINDUP:'windup',STUNNED:'stunned'
};

let squadIdCounter=0;

export class Squad{
  constructor(objective='assault'){
    this.id=++squadIdCounter;
    this.members=[];
    this.objective=objective;
    this.morale=1;
    this.commander=null;
    this.focusX=0;this.focusY=0;
    this.decisionTimer=0;
    this.flankSide=Math.random()<.5?1:-1;
    this.initialSize=0;
    this.suppressing=false;
  }

  add(enemy){
    this.members.push(enemy);
    enemy.squad=this;
    this.initialSize=Math.max(this.initialSize,this.members.length);
    if(!this.commander)this.electCommander();
  }

  remove(enemy){
    const index=this.members.indexOf(enemy);
    if(index>=0)this.members.splice(index,1);
    if(this.commander===enemy)this.electCommander();
    // Losses erode the squad's willingness to press the attack.
    this.morale=Math.max(0,this.morale-.14);
  }

  electCommander(){
    // Prefer the toughest surviving member, which is usually the unit best
    // placed to hold the line the others form up on.
    let best=null,bestScore=-1;
    for(const member of this.members){
      if(member.dead)continue;
      const score=member.maxHp+(member.role==='heavy'?200:0);
      if(score>bestScore){bestScore=score;best=member}
    }
    this.commander=best;
  }

  // Squad-level decision, re-evaluated a few times per second.
  think(dt,ctx){
    this.decisionTimer-=dt;
    if(this.decisionTimer>0)return;
    this.decisionTimer=.45+Math.random()*.35;

    const alive=this.members.filter(m=>!m.dead);
    if(!alive.length)return;

    const strength=alive.length/Math.max(1,this.initialSize);
    this.morale=clamp(this.morale+dt*.05,0,1);

    // Centroid drives regroup behaviour.
    let sx=0,sy=0;
    for(const member of alive){sx+=member.x;sy+=member.y}
    this.centerX=sx/alive.length;
    this.centerY=sy/alive.length;

    const player=ctx.player;
    const distanceToPlayer=dist(this.centerX,this.centerY,player.x,player.y);

    if(strength<.3&&this.morale<.4){
      this.objective='withdraw';
    }else if(alive.length>=4&&distanceToPlayer<560){
      // With numbers, split: half pins from the front, half swings wide.
      this.objective='pincer';
    }else if(distanceToPlayer>900){
      this.objective='advance';
    }else{
      this.objective='assault';
    }

    this.focusX=player.x;
    this.focusY=player.y;

    // Assign flank sides so a pincer actually converges from two directions.
    if(this.objective==='pincer'){
      alive.forEach((member,index)=>{
        member.flankSide=index%2===0?this.flankSide:-this.flankSide;
        member.squadRole=index%2===0?'pin':'flank';
      });
    }else{
      for(const member of alive){member.squadRole='assault'}
    }
  }
}

// ---------------------------------------------------------------------------
// Steering primitives — all return a normalised-ish force, blended by weight.
// ---------------------------------------------------------------------------

function seek(enemy,tx,ty,out){
  const dx=tx-enemy.x,dy=ty-enemy.y;
  const m=Math.hypot(dx,dy);
  if(m<1e-3)return out;
  out.x+=dx/m;out.y+=dy/m;
  return out;
}

function flee(enemy,tx,ty,out){
  const dx=enemy.x-tx,dy=enemy.y-ty;
  const m=Math.hypot(dx,dy);
  if(m<1e-3)return out;
  out.x+=dx/m;out.y+=dy/m;
  return out;
}

// Arrive: eases off as the unit reaches its stand-off band, so ranged units
// hold a distance instead of oscillating through it.
function maintainRange(enemy,tx,ty,preferred,band,out,weight=1){
  const dx=tx-enemy.x,dy=ty-enemy.y;
  const m=Math.hypot(dx,dy)||1;
  const error=m-preferred;
  if(Math.abs(error)<band)return out;
  const sign=error>0?1:-1;
  const strength=clamp(Math.abs(error)/(preferred||1),0,1)*weight;
  out.x+=dx/m*sign*strength;
  out.y+=dy/m*sign*strength;
  return out;
}

// Orbit the target at a fixed radius, used by flankers and circling drones.
function strafe(enemy,tx,ty,direction,out,weight=1){
  const dx=tx-enemy.x,dy=ty-enemy.y;
  const m=Math.hypot(dx,dy)||1;
  out.x+=-dy/m*direction*weight;
  out.y+=dx/m*direction*weight;
  return out;
}

// Separation from squadmates, evaluated against the engine's spatial hash so
// it stays linear in the number of enemies instead of quadratic.
function separate(enemy,neighbours,out,weight=1){
  let count=0,sx=0,sy=0;
  for(const other of neighbours){
    if(other===enemy||other.dead)continue;
    const dx=enemy.x-other.x,dy=enemy.y-other.y;
    const d2=dx*dx+dy*dy;
    const minimum=(enemy.radius+other.radius)*1.55;
    if(d2>1e-4&&d2<minimum*minimum){
      const d=Math.sqrt(d2);
      const push=(minimum-d)/minimum;
      sx+=dx/d*push;sy+=dy/d*push;
      count++;
    }
  }
  if(count){out.x+=sx/count*weight;out.y+=sy/count*weight}
  return out;
}

// Steer around solid geometry by probing ahead and sliding along the blocked
// axis, which stops units from grinding into wall corners forever.
function avoidObstacles(enemy,world,out,weight=1){
  const speed=Math.hypot(enemy.vx||0,enemy.vy||0);
  if(speed<1)return out;
  const probeLength=clamp(enemy.radius+speed*.28,26,80);
  const ax=enemy.x+(enemy.vx/speed)*probeLength;
  const ay=enemy.y+(enemy.vy/speed)*probeLength;
  const hit=world.raycastObstacle(enemy.x,enemy.y,ax,ay,false);
  if(!hit)return out;
  // Slide perpendicular to the surface normal we most likely struck.
  const dx=enemy.x-hit.x,dy=enemy.y-hit.y;
  if(Math.abs(dx/(hit.hw||1))>Math.abs(dy/(hit.hh||1))){
    out.x+=Math.sign(dx||1)*weight;
    out.y+=(enemy.wallSlide||1)*weight*.7;
  }else{
    out.y+=Math.sign(dy||1)*weight;
    out.x+=(enemy.wallSlide||1)*weight*.7;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Brain: per-frame decision + steering for a single enemy.
// ---------------------------------------------------------------------------

export class EnemyBrain{
  static init(enemy,archetype){
    enemy.state=AI_STATES.SEARCH;
    enemy.stateTimer=0;
    enemy.awareness=0;            // 0 unaware .. 1 fully tracking
    enemy.lastKnownX=enemy.x;
    enemy.lastKnownY=enemy.y;
    enemy.memory=0;
    enemy.attackCooldown=Math.random()*1.4;
    enemy.windup=0;
    enemy.windupAction=null;
    enemy.flankSide=Math.random()<.5?1:-1;
    enemy.wallSlide=Math.random()<.5?1:-1;
    enemy.strafeDir=Math.random()<.5?1:-1;
    enemy.coverPoint=null;
    enemy.coverTimer=0;
    enemy.repathTimer=0;
    enemy.burstRemaining=0;
    enemy.burstTimer=0;
    enemy.vx=0;enemy.vy=0;
    enemy.desiredX=enemy.x;enemy.desiredY=enemy.y;
    enemy.profile=archetype.ai;
    enemy.preferredRange=PROFILES[archetype.ai]?.preferredRange??90;
    enemy.aggression=.7+Math.random()*.5;
    enemy.reactionDelay=PROFILES[archetype.ai]?.reaction??.25;
    enemy.reactionTimer=0;
    enemy.cloaked=false;
    enemy.enraged=false;
    enemy.blinkTimer=archetype.blinkInterval||0;
  }

  // Returns the desired movement force for this frame; the engine applies it.
  static update(enemy,dt,ctx){
    const profile=PROFILES[enemy.profile]||PROFILES.rusher;
    const player=ctx.player;
    const world=ctx.world;

    enemy.stateTimer+=dt;
    enemy.attackCooldown-=dt;
    if(enemy.hitFlash>0)enemy.hitFlash-=dt;

    // ---- Perception -------------------------------------------------------
    const distanceToPlayer=dist(enemy.x,enemy.y,player.x,player.y);
    const detectionRange=(profile.detection??620)*ctx.detectionMult;
    const hasSight=distanceToPlayer<detectionRange&&
      (distanceToPlayer<110||world.hasLineOfSight(enemy.x,enemy.y,player.x,player.y));

    if(hasSight&&!ctx.playerHidden){
      enemy.awareness=Math.min(1,enemy.awareness+dt*(distanceToPlayer<260?4:2.2));
      enemy.memory=profile.memory??3.2;
      enemy.lastKnownX=player.x;
      enemy.lastKnownY=player.y;
      // Lead the player's motion so predictions are not always stale.
      enemy.predictX=player.x+player.vx*.35;
      enemy.predictY=player.y+player.vy*.35;
    }else{
      enemy.memory-=dt;
      if(enemy.memory<=0)enemy.awareness=Math.max(0,enemy.awareness-dt*ctx.forgetRate);
    }

    // Squadmates share contacts: one unit seeing you alerts the whole squad.
    if(enemy.awareness>=1&&enemy.squad&&!enemy.squad.alerted){
      enemy.squad.alerted=true;
      for(const member of enemy.squad.members){
        if(member===enemy||member.dead)continue;
        member.awareness=Math.max(member.awareness,.7);
        member.lastKnownX=player.x;
        member.lastKnownY=player.y;
        member.memory=Math.max(member.memory,2);
      }
    }

    // ---- Status gating ----------------------------------------------------
    if(enemy.stunTimer>0){
      enemy.stunTimer-=dt;
      enemy.state=AI_STATES.STUNNED;
      return ZERO;
    }

    // ---- State selection --------------------------------------------------
    if(enemy.windup>0){
      enemy.windup-=dt;
      if(enemy.windup<=0)EnemyBrain.releaseWindup(enemy,ctx);
      // Most windups root the unit; charges creep forward to telegraph intent.
      return enemy.windupAction==='charge'?
        applyForce(enemy,seek(enemy,player.x,player.y,force()),dt,.18,ctx):ZERO;
    }

    const chosen=profile.decide(enemy,{...ctx,distanceToPlayer,hasSight,profile});
    if(chosen&&chosen!==enemy.state){
      enemy.state=chosen;
      enemy.stateTimer=0;
    }

    // ---- Steering ---------------------------------------------------------
    const steer=force();
    const neighbours=ctx.neighboursOf(enemy);

    switch(enemy.state){
      case AI_STATES.SEARCH:EnemyBrain.steerSearch(enemy,steer,ctx);break;
      case AI_STATES.ENGAGE:EnemyBrain.steerEngage(enemy,steer,ctx,profile,distanceToPlayer);break;
      case AI_STATES.FLANK:EnemyBrain.steerFlank(enemy,steer,ctx,profile,distanceToPlayer);break;
      case AI_STATES.COVER:EnemyBrain.steerCover(enemy,steer,ctx,profile);break;
      case AI_STATES.CHARGE:seek(enemy,enemy.chargeX??player.x,enemy.chargeY??player.y,steer);break;
      case AI_STATES.RETREAT:flee(enemy,player.x,player.y,steer);break;
      case AI_STATES.REGROUP:{
        const squad=enemy.squad;
        if(squad)seek(enemy,squad.centerX??player.x,squad.centerY??player.y,steer);
        else flee(enemy,player.x,player.y,steer);
        break;
      }
      case AI_STATES.AMBUSH:EnemyBrain.steerAmbush(enemy,steer,ctx,profile,distanceToPlayer);break;
      case AI_STATES.SUPPRESS:
        maintainRange(enemy,player.x,player.y,enemy.preferredRange,40,steer,1);
        strafe(enemy,player.x,player.y,enemy.strafeDir,steer,.5);
        break;
      default:seek(enemy,player.x,player.y,steer);
    }

    separate(enemy,neighbours,steer,profile.separation??1.35);
    avoidObstacles(enemy,world,steer,1.1);

    // ---- Attacking --------------------------------------------------------
    if(enemy.awareness>.35&&enemy.attackCooldown<=0){
      profile.attack(enemy,{...ctx,distanceToPlayer,hasSight});
    }
    // Burst fire continues independently of the attack cooldown.
    if(enemy.burstRemaining>0){
      enemy.burstTimer-=dt;
      if(enemy.burstTimer<=0){
        enemy.burstRemaining--;
        enemy.burstTimer=enemy.burstInterval||.09;
        ctx.fireEnemyShot(enemy,enemy.burstSpec);
      }
    }

    return applyForce(enemy,steer,dt,profile.speedScale??1,ctx);
  }

  static steerSearch(enemy,steer,ctx){
    // Sweep around the last known contact point; drift if there never was one.
    if(enemy.memory>0||enemy.awareness>0){
      seek(enemy,enemy.lastKnownX,enemy.lastKnownY,steer);
      // Only circle once close to the objective — units still crossing open
      // ground should drive straight at it.
      const remaining=dist(enemy.x,enemy.y,enemy.lastKnownX,enemy.lastKnownY);
      if(remaining<180)strafe(enemy,enemy.lastKnownX,enemy.lastKnownY,enemy.strafeDir,steer,.6);
    }else{
      enemy.repathTimer-=ctx.dt;
      if(enemy.repathTimer<=0||enemy.patrolX===undefined){
        enemy.repathTimer=2.6+Math.random()*2;
        const angle=Math.random()*TAU;
        enemy.patrolX=enemy.x+Math.cos(angle)*300;
        enemy.patrolY=enemy.y+Math.sin(angle)*300;
      }
      seek(enemy,enemy.patrolX,enemy.patrolY,steer);
    }
  }

  static steerEngage(enemy,steer,ctx,profile,distanceToPlayer){
    const player=ctx.player;
    maintainRange(enemy,player.x,player.y,enemy.preferredRange,profile.rangeBand??36,steer,1.15);
    // Circle while holding position so the firing line keeps moving.
    if(distanceToPlayer<enemy.preferredRange*1.6){
      strafe(enemy,player.x,player.y,enemy.strafeDir,steer,profile.strafe??.55);
      // Occasionally reverse to break player muscle memory.
      if(Math.random()<ctx.dt*.35)enemy.strafeDir*=-1;
    }
  }

  static steerFlank(enemy,steer,ctx,profile,distanceToPlayer){
    const player=ctx.player;
    // Aim for a point offset around the player rather than the player itself.
    const baseAngle=Math.atan2(enemy.y-player.y,enemy.x-player.x);
    const target=baseAngle+enemy.flankSide*(profile.flankArc??1.1);
    const radius=enemy.preferredRange*1.05;
    const tx=player.x+Math.cos(target)*radius;
    const ty=player.y+Math.sin(target)*radius;
    seek(enemy,tx,ty,steer);
    if(distanceToPlayer<enemy.preferredRange*.8)flee(enemy,player.x,player.y,steer);
  }

  static steerCover(enemy,steer,ctx,profile){
    const player=ctx.player;
    if(!enemy.coverPoint||enemy.coverTimer<=0||enemy.coverPoint.obstacle.broken){
      enemy.coverPoint=ctx.claimCoverPoint(enemy,player);
      enemy.coverTimer=3.5+Math.random()*3;
    }
    enemy.coverTimer-=ctx.dt;
    if(enemy.coverPoint){
      seek(enemy,enemy.coverPoint.x,enemy.coverPoint.y,steer);
    }else{
      // No cover available — fall back on stand-off behaviour.
      maintainRange(enemy,player.x,player.y,enemy.preferredRange,40,steer,1);
    }
  }

  static steerAmbush(enemy,steer,ctx,profile,distanceToPlayer){
    const player=ctx.player;
    if(distanceToPlayer>(profile.strikeRange??120)){
      // Approach quietly from behind the player's facing.
      const behind=Math.atan2(player.vy||0,player.vx||1)+Math.PI;
      const tx=player.x+Math.cos(behind)*90;
      const ty=player.y+Math.sin(behind)*90;
      seek(enemy,tx,ty,steer);
    }else{
      seek(enemy,player.x,player.y,steer);
    }
  }

  static beginWindup(enemy,action,duration,ctx,payload={}){
    enemy.windup=duration;
    enemy.windupAction=action;
    enemy.windupPayload=payload;
    enemy.windupMax=duration;
    ctx.onWindup?.(enemy,action,duration);
  }

  static releaseWindup(enemy,ctx){
    const action=enemy.windupAction;
    enemy.windupAction=null;
    const payload=enemy.windupPayload||{};
    switch(action){
      case 'shot':ctx.fireEnemyShot(enemy,payload);break;
      case 'charge':{
        const player=ctx.player;
        const dir=normalize(player.x-enemy.x,player.y-enemy.y);
        enemy.chargeVx=dir.x*(payload.speed||420);
        enemy.chargeVy=dir.y*(payload.speed||420);
        enemy.chargeTimer=payload.duration||.85;
        enemy.state=AI_STATES.CHARGE;
        break;
      }
      case 'dive':{
        const player=ctx.player;
        const dir=normalize(player.x-enemy.x,player.y-enemy.y);
        enemy.chargeVx=dir.x*(payload.speed||520);
        enemy.chargeVy=dir.y*(payload.speed||520);
        enemy.chargeTimer=.6;
        enemy.state=AI_STATES.CHARGE;
        break;
      }
      case 'mortar':ctx.fireMortar(enemy,payload);break;
      case 'detonate':ctx.detonateEnemy(enemy);break;
      case 'leap':{
        const player=ctx.player;
        const dir=normalize(player.x-enemy.x,player.y-enemy.y);
        enemy.chargeVx=dir.x*640;
        enemy.chargeVy=dir.y*640;
        enemy.chargeTimer=.45;
        enemy.state=AI_STATES.CHARGE;
        break;
      }
      default:break;
    }
  }
}

const ZERO={x:0,y:0};
const forcePool={x:0,y:0};
function force(){forcePool.x=0;forcePool.y=0;return forcePool}

// Convert accumulated steering into a velocity, with smoothing so units
// accelerate rather than snapping to full speed.
function applyForce(enemy,steer,dt,scale,ctx){
  const m=Math.hypot(steer.x,steer.y);
  const speed=enemy.speed*scale*(enemy.speedMult||1)*ctx.speedMult;
  if(m>1e-4){
    const tx=steer.x/m*speed;
    const ty=steer.y/m*speed;
    enemy.vx=damp(enemy.vx,tx,9,dt);
    enemy.vy=damp(enemy.vy,ty,9,dt);
  }else{
    enemy.vx=damp(enemy.vx,0,7,dt);
    enemy.vy=damp(enemy.vy,0,7,dt);
  }
  return{x:enemy.vx,y:enemy.vy};
}

// ---------------------------------------------------------------------------
// Behaviour profiles. `decide` picks a state; `attack` runs the offence.
// ---------------------------------------------------------------------------

const PROFILES={
  rusher:{
    preferredRange:26,detection:700,memory:3,strafe:.2,separation:1.5,reaction:.15,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      // Even rushers spread out when a squad is large enough to encircle.
      if(enemy.squadRole==='flank'&&ctx.distanceToPlayer>150)return AI_STATES.FLANK;
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer>enemy.radius+ctx.player.radius+16)return;
      enemy.attackCooldown=.85;
      ctx.meleeHit(enemy,enemy.damage);
    }
  },

  shooter:{
    preferredRange:230,detection:760,memory:4,strafe:.7,rangeBand:44,separation:1.3,reaction:.3,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      if(enemy.squad?.objective==='withdraw')return AI_STATES.RETREAT;
      // Break line of sight to reload, then step back out.
      if(enemy.hp/enemy.maxHp<.4&&Math.random()<ctx.dt*.6)return AI_STATES.COVER;
      if(!ctx.hasSight&&enemy.awareness>.5)return AI_STATES.ENGAGE;
      if(enemy.squadRole==='flank')return AI_STATES.FLANK;
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(!ctx.hasSight||ctx.distanceToPlayer>(enemy.range||250))return;
      enemy.attackCooldown=(enemy.fireRate||1.9)*ctx.fireRateMult;
      enemy.burstRemaining=(enemy.burst||2)-1;
      enemy.burstInterval=.1;
      enemy.burstSpec={speed:enemy.projectileSpeed||250,damage:enemy.damage,accuracy:enemy.accuracy??.86};
      ctx.fireEnemyShot(enemy,enemy.burstSpec);
    }
  },

  // Gunships never take cover and never close: they orbit at standoff, walk
  // bursts across the target, and reposition when the operative gets under
  // them. Ground geometry is irrelevant to them in both directions.
  gunship:{
    preferredRange:300,detection:1100,memory:8,strafe:1.25,rangeBand:70,separation:2.2,reaction:.35,
    decide(enemy,ctx){
      if(enemy.awareness<.25)return AI_STATES.SEARCH;
      // Too close to depress the guns: peel off and re-establish standoff.
      if(ctx.distanceToPlayer<enemy.hoverBand*.55)return AI_STATES.RETREAT;
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer>(enemy.range||400))return;
      enemy.attackCooldown=(enemy.fireRate||2.4)*ctx.fireRateMult;
      enemy.burstRemaining=(enemy.burst||5)-1;
      enemy.burstInterval=.085;
      enemy.burstSpec={
        speed:enemy.projectileSpeed||400,damage:enemy.damage,
        accuracy:enemy.accuracy??.8
      };
      ctx.fireEnemyShot(enemy,enemy.burstSpec);
    }
  },

  // The carrier does not fight. It drives to standoff, parks, and opens its
  // ramp on a timer. Everything dangerous about it is what comes out.
  carrier:{
    preferredRange:320,detection:1200,memory:14,strafe:0,rangeBand:50,separation:.6,reaction:.6,
    decide(enemy,ctx){
      if(enemy.awareness<.2)return AI_STATES.SEARCH;
      // The standoff has to sit outside where the steering settles — a
      // preferred range with a band around it never closes to its own centre,
      // so a threshold set at the centre is one the carrier never crosses.
      if(ctx.distanceToPlayer<=(enemy.standoff||430)){
        if(!enemy.parked){
          enemy.parked=true;
          enemy.rollingSpeed=enemy.speed;
          // Parked means parked: a carrier that keeps nudging around while it
          // unloads reads as indecisive rather than deliberate.
          enemy.speed=0;
          enemy.vx=0;enemy.vy=0;
        }
        return AI_STATES.SUPPRESS;
      }
      if(enemy.parked){
        enemy.parked=false;
        enemy.speed=enemy.rollingSpeed??enemy.speed;
      }

      // The steering is local — it has no path around a wall, and a carrier
      // pinned on one would sit out of reach unloading nothing for the rest of
      // the contract. If it stops making ground, it stops where it is and
      // opens the ramp there. A carrier parked badly is still a carrier.
      const last=enemy.approachMark;
      if(last===undefined||last-ctx.distanceToPlayer>24){
        enemy.approachMark=ctx.distanceToPlayer;
        enemy.stalledFor=0;
      }else{
        enemy.stalledFor=(enemy.stalledFor||0)+ctx.dt;
        if(enemy.stalledFor>4){
          enemy.parked=true;
          enemy.rollingSpeed=enemy.speed;
          enemy.speed=0;
          enemy.vx=0;enemy.vy=0;
          return AI_STATES.SUPPRESS;
        }
      }
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      // `attack` is the behaviour tree's per-unit tick with a cooldown on it,
      // which is exactly the shape a deployment cycle wants.
      if(!enemy.parked)return;
      enemy.attackCooldown=(enemy.deployInterval||5.5)*ctx.fireRateMult;
      ctx.deployFrom?.(enemy);
    }
  },

  sniper:{
    preferredRange:440,detection:900,memory:5,strafe:.25,rangeBand:80,separation:1.1,reaction:.5,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      if(ctx.distanceToPlayer<180)return AI_STATES.RETREAT;
      // Snipers strongly prefer to shoot from behind cover.
      if(ctx.hasSight&&enemy.attackCooldown>.6)return AI_STATES.COVER;
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(!ctx.hasSight||ctx.distanceToPlayer>(enemy.range||520)||ctx.distanceToPlayer<160)return;
      enemy.attackCooldown=(enemy.fireRate||3.4)*ctx.fireRateMult;
      // Long, clearly-telegraphed laser before the shot lands.
      EnemyBrain.beginWindup(enemy,'shot',(enemy.windup||1.05)*ctx.telegraphMult,ctx,{
        speed:enemy.projectileSpeed||620,damage:enemy.damage,
        accuracy:enemy.accuracy??.97,tracer:true,piercing:true
      });
    }
  },

  flanker:{
    preferredRange:120,detection:720,memory:3.4,strafe:1,flankArc:1.5,separation:1.4,reaction:.2,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      return ctx.distanceToPlayer>90?AI_STATES.FLANK:AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer>enemy.radius+ctx.player.radius+20)return;
      enemy.attackCooldown=.7;
      ctx.meleeHit(enemy,enemy.damage);
    }
  },

  diveBomber:{
    preferredRange:260,detection:840,memory:4,strafe:.85,rangeBand:60,separation:1.2,reaction:.3,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(!ctx.hasSight||ctx.distanceToPlayer>420)return;
      enemy.attackCooldown=3.2*ctx.fireRateMult;
      EnemyBrain.beginWindup(enemy,'dive',(enemy.diveWindup||.75)*ctx.telegraphMult,ctx,{
        speed:enemy.diveSpeed||520
      });
    }
  },

  juggernaut:{
    preferredRange:60,detection:760,memory:5,strafe:.15,separation:1.1,speedScale:1,reaction:.4,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer<enemy.radius+ctx.player.radius+14){
        enemy.attackCooldown=1.1;
        ctx.meleeHit(enemy,enemy.damage);
        return;
      }
      if(ctx.distanceToPlayer>520||!ctx.hasSight)return;
      enemy.attackCooldown=4.4*ctx.fireRateMult;
      EnemyBrain.beginWindup(enemy,'charge',(enemy.chargeWindup||.9)*ctx.telegraphMult,ctx,{
        speed:enemy.chargeSpeed||400,duration:.9
      });
    }
  },

  shieldWall:{
    preferredRange:44,detection:640,memory:4,strafe:.1,separation:1.6,speedScale:1,reaction:.35,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      // Shield troopers form up on the squad's line rather than freelancing.
      if(enemy.squad&&enemy.squad.commander&&enemy.squad.commander!==enemy){
        const commander=enemy.squad.commander;
        if(dist2(enemy.x,enemy.y,commander.x,commander.y)>240*240)return AI_STATES.REGROUP;
      }
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer>enemy.radius+ctx.player.radius+18)return;
      enemy.attackCooldown=1.3;
      ctx.meleeHit(enemy,enemy.damage);
    }
  },

  support:{
    preferredRange:300,detection:700,memory:4,strafe:.4,rangeBand:70,separation:1.2,reaction:.4,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      if(ctx.distanceToPlayer<200)return AI_STATES.RETREAT;
      // Support units hang back behind their own squad's centroid.
      return AI_STATES.SUPPRESS;
    },
    attack(enemy,ctx){
      // Support does not shoot; its contribution is the aura, applied by the
      // engine each frame from the archetype's auraRadius/buffAmount.
      enemy.attackCooldown=1;
    }
  },

  guardian:{
    preferredRange:200,detection:700,memory:4,strafe:.3,rangeBand:60,separation:1.2,reaction:.4,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      if(ctx.distanceToPlayer<160)return AI_STATES.RETREAT;
      return AI_STATES.SUPPRESS;
    },
    attack(enemy,ctx){
      if(!ctx.hasSight||ctx.distanceToPlayer>400)return;
      enemy.attackCooldown=2.6*ctx.fireRateMult;
      ctx.fireEnemyShot(enemy,{speed:230,damage:enemy.damage,accuracy:.8});
    }
  },

  swarmer:{
    preferredRange:30,detection:660,memory:2.6,strafe:.35,separation:1.15,reaction:.12,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer>enemy.radius+ctx.player.radius+14)return;
      enemy.attackCooldown=.6;
      // Swarmers hit harder when their packmates are also in contact.
      const pack=1+Math.min(4,(ctx.nearbyAllies(enemy,120)-1))*(enemy.packBonus||0);
      ctx.meleeHit(enemy,enemy.damage*pack);
    }
  },

  ambusher:{
    preferredRange:70,detection:900,memory:5,strafe:.5,strikeRange:130,separation:1.2,reaction:.2,
    decide(enemy,ctx){
      if(enemy.awareness<.2)return AI_STATES.SEARCH;
      // Cloaked while far, decloaks for the strike.
      enemy.cloaked=ctx.distanceToPlayer>(enemy.decloakRange||90)&&enemy.awareness>.2;
      return AI_STATES.AMBUSH;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer>enemy.radius+ctx.player.radius+22)return;
      enemy.attackCooldown=1.4;
      const bonus=enemy.cloaked?(enemy.ambushDamage||1.6):1;
      enemy.cloaked=false;
      ctx.meleeHit(enemy,enemy.damage*bonus);
    }
  },

  berserker:{
    preferredRange:34,detection:780,memory:4,strafe:.25,separation:1.3,reaction:.2,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      // Enrage below the health threshold: faster, harder, no retreat.
      const ratio=enemy.hp/enemy.maxHp;
      if(!enemy.enraged&&ratio<(enemy.enrageThreshold||.4)){
        enemy.enraged=true;
        enemy.speedMult=(enemy.speedMult||1)*(enemy.enrageSpeed||1.65);
        enemy.damageMult=(enemy.damageMult||1)*(enemy.enrageDamage||1.4);
        ctx.onEnrage?.(enemy);
      }
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer>enemy.radius+ctx.player.radius+18)return;
      enemy.attackCooldown=enemy.enraged?.55:.9;
      ctx.meleeHit(enemy,enemy.damage*(enemy.damageMult||1));
    }
  },

  artillery:{
    preferredRange:460,detection:900,memory:5,strafe:.2,rangeBand:90,separation:1.1,reaction:.6,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      if(ctx.distanceToPlayer<(enemy.minRange||180))return AI_STATES.RETREAT;
      return AI_STATES.COVER;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer>(enemy.range||620)||ctx.distanceToPlayer<(enemy.minRange||180))return;
      enemy.attackCooldown=(enemy.fireRate||3.8)*ctx.fireRateMult;
      // Indirect fire ignores line of sight but lands on a predicted point.
      EnemyBrain.beginWindup(enemy,'mortar',.6*ctx.telegraphMult,ctx,{
        delay:enemy.shellDelay||1.5,radius:enemy.blastRadius||96,damage:enemy.damage
      });
    }
  },

  kamikaze:{
    preferredRange:20,detection:820,memory:4,strafe:.1,separation:1.6,speedScale:1.1,reaction:.1,
    decide(enemy,ctx){
      if(enemy.awareness<.25)return AI_STATES.SEARCH;
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer>(enemy.blastRadius||104)*.55)return;
      enemy.attackCooldown=99;
      EnemyBrain.beginWindup(enemy,'detonate',(enemy.fuse||.85)*ctx.telegraphMult,ctx,{});
    }
  },

  blinker:{
    preferredRange:150,detection:860,memory:4,strafe:.8,rangeBand:50,separation:1.2,reaction:.25,
    decide(enemy,ctx){
      if(enemy.awareness<.3)return AI_STATES.SEARCH;
      enemy.blinkTimer-=ctx.dt;
      if(enemy.blinkTimer<=0){
        enemy.blinkTimer=enemy.blinkInterval||2.6;
        ctx.blinkEnemy(enemy,enemy.blinkRange||260);
      }
      return AI_STATES.ENGAGE;
    },
    attack(enemy,ctx){
      if(ctx.distanceToPlayer>enemy.radius+ctx.player.radius+24)return;
      enemy.attackCooldown=1.1;
      ctx.meleeHit(enemy,enemy.damage);
    }
  }
};

export {PROFILES};
