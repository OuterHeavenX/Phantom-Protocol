import {Boss} from './boss.js';
import {clamp,dist,normalize,TAU} from '../core/math.js';
import {
  NEMESIS_CHASSIS,DESIGNATIONS,TIERS,
  defaultNemesisRecord,phasesFor,tierScaling,withdrawThreshold,nextHardpoint
} from '../../data/nemesis.js';

// The walker in the field.
//
// It is a Boss underneath — the phase machine, the weighted patterns, the
// telegraphed windups are all the same machinery every command signature uses.
// What it adds is the thing that makes it a nemesis rather than an encounter:
// below a threshold it breaks contact and leaves, and everything that happened
// to it is written back to the save so the next one is the same machine.

const WITHDRAW_SPEED=1.9;    // multiplier while disengaging
const WITHDRAW_SECONDS=4.2;  // how long it takes to clear the sector
const MAX_SCARS=14;          // carried between contracts

export class Nemesis extends Boss{
  constructor(record,x,y,scaling){
    const def={
      ...NEMESIS_CHASSIS,
      name:record.designation,
      phases:phasesFor(record),
      intro:record.encounters===0
        ? 'Walker on the net. It is not guarding anything. It came for you.'
        : `${record.designation} is back on its feet. It remembers.`
    };
    super(def,x,y,scaling);
    this.record=record;
    this.tier=record.tier;
    this.nemesis=true;
    // Scars from previous contracts, in chassis-local coordinates so they sit
    // on the same plate no matter which way it is facing.
    this.scars=record.scars.slice(0,MAX_SCARS);
    this.freshScars=[];
    this.withdrawing=false;
    this.withdrawTimer=0;
    this.withdrawAngle=0;
    this.escaped=false;
  }

  // Where a hit landed, relative to the chassis, so it can be drawn there
  // again next time. Recorded on every hit; only kept if it withdraws.
  markScar(x,y){
    const local=Math.atan2(y-this.y,x-this.x)-this.angle;
    const radius=Math.min(1,dist(this.x,this.y,x,y)/this.radius);
    this.freshScars.push({a:+local.toFixed(2),r:+radius.toFixed(2)});
    if(this.freshScars.length>MAX_SCARS)this.freshScars.shift();
  }

  // Everything it is carrying plus everything it took this contract. Read at
  // the end of a run, so a walker that took fire and then left keeps both.
  allScars(){
    return [...this.scars,...this.freshScars].slice(-MAX_SCARS);
  }

  // Called instead of dying while it still has tiers left to spend.
  beginWithdraw(engine){
    if(this.withdrawing)return;
    this.withdrawing=true;
    this.withdrawTimer=WITHDRAW_SECONDS;
    this.withdrawAngle=Math.atan2(this.y-engine.player.y,this.x-engine.player.x);
    this.telegraph=null;
    this.windup=0;
    this.windupPattern=null;
    engine.clearEnemyProjectiles(.5);
    engine.announce(`${this.name} IS BREAKING CONTACT`,this.def.accent,3.4);
    engine.audio.play('alarm',{volume:.8});
    engine.camera.addShake(.4);
    engine.codec?.fire('nemesisWithdraw');
  }

  update(dt,engine){
    if(this.dead)return;
    if(this.withdrawing){
      this.updateWithdraw(dt,engine);
      return;
    }
    // Below its threshold it stops fighting and starts leaving, unless this is
    // the tier where it has run out of places to run.
    // Sustained Pressure raises the threshold, so the walker breaks off with
    // more health left on it — it still escapes, it just takes less away.
    const floor=withdrawThreshold(this.tier)+(engine.nemesisWithdrawBonus||0);
    if(floor>0&&this.healthRatio<=floor){
      this.beginWithdraw(engine);
      return;
    }
    super.update(dt,engine);
  }

  // Walking out: still solid, no longer shooting, and no longer killable. The
  // point is that you were not fast enough, not that the game took the kill
  // away at the last moment — so it is announced well before it is immune.
  updateWithdraw(dt,engine){
    this.withdrawTimer-=dt;
    this.hitFlash=Math.max(0,this.hitFlash-dt);
    const speed=this.baseSpeed*WITHDRAW_SPEED;
    this.x+=Math.cos(this.withdrawAngle)*speed*dt;
    this.y+=Math.sin(this.withdrawAngle)*speed*dt;
    this.angle=this.withdrawAngle;
    this.strideLimp=1;
    if(engine.frame%4===0){
      engine.fx.particle({
        x:this.x+(Math.random()-.5)*this.radius,
        y:this.y+(Math.random()-.5)*this.radius,
        vx:0,vy:-20,life:.9,size:7,color:'rgba(60,60,66,.5)',kind:'circle',drag:.94
      });
    }
    if(this.withdrawTimer<=0)this.completeWithdraw(engine);
  }

  completeWithdraw(engine){
    this.escaped=true;
    this.dead=true;
    engine.boss=null;
    engine.announce(`${this.name} HAS LEFT THE SECTOR`,'#ff7068',3.2);
    engine.onNemesisEscape?.(this);
  }
}

// ---------------------------------------------------------------------------
// The record between contracts
// ---------------------------------------------------------------------------

// Reads the save's record, creating one if the operator has never met it.
export function nemesisRecord(save){
  if(!save.nemesis)save.nemesis=defaultNemesisRecord();
  return save.nemesis;
}

// What a contract that met the walker writes back.
//
// `outcome` is 'escaped' when it broke contact, 'destroyed' when it did not,
// and 'survived' when the contract ended with it still standing — which counts
// as an escape for the walker's purposes but does not refit it.
export function commitNemesis(save,result){
  const record=nemesisRecord(save);
  if(!result)return record;
  record.encounters++;
  record.lastContract=save.statistics?.missions||0;

  if(result.outcome==='destroyed'){
    record.retired=true;
    record.tier=0;
    record.scars=[];
    record.hardpoints=[];
    // The network commissions a successor under the next designation.
    record.index=(record.index+1)%DESIGNATIONS.length;
    record.designation=DESIGNATIONS[record.index];
    return record;
  }

  // It got away: it keeps the damage and comes back with more bolted on.
  if(Array.isArray(result.scars)&&result.scars.length){
    record.scars=result.scars.slice(-MAX_SCARS);
  }
  if(record.tier<TIERS-1){
    record.tier++;
    const fitting=nextHardpoint(record);
    if(fitting)record.hardpoints.push(fitting.key);
  }
  return record;
}

// Difficulty scaling for a spawn, combining the contract's own multipliers with
// how many times this machine has walked away.
export function nemesisScaling(record,engine){
  const tier=tierScaling(record.tier);
  const lengthScale=.7+Math.max(0,engine.durationMinutes-5)/25*1.8;
  return{
    hpMult:engine.difficulty.hpMult*tier.hpMult*lengthScale,
    damageMult:engine.difficulty.damageMult*.72*tier.damageMult,
    armorMult:tier.armorMult
  };
}
