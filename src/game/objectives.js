// Field objectives — the in-run checklist.
//
// Three objectives are always live. Completing one checks it off, pays out,
// and rolls a fresh one scaled to the operative's current level, so the
// checklist keeps giving the run short-term goals on top of survival.

const SLOTS=3;
const DONE_HOLD=3.2;          // seconds a completed entry stays on the list
const DOSSIER_EVERY=3;        // completions between personnel cache drops

// Each template reads a cumulative counter off the engine; the target is
// always measured from the reading taken when the objective was issued.
// `tick` templates accumulate time instead, and may reset themselves.
export const OBJECTIVE_TEMPLATES=[
  {id:'kills',label:n=>`Eliminate ${n} hostiles`,base:12,per:9,read:e=>e.telemetry.kills},
  {id:'elites',label:n=>`Eliminate ${n} elite signature${n>1?'s':''}`,base:1,per:.55,read:e=>e.telemetry.eliteKills},
  {id:'credits',label:n=>`Recover ${n} credits`,base:60,per:34,read:e=>e.credits},
  {id:'pickups',label:n=>`Collect ${n} drops`,base:25,per:14,read:e=>e.telemetry.pickups},
  {id:'crit',label:n=>`Land ${n} critical hits`,base:15,per:11,read:e=>e.telemetry.criticalHits},
  {id:'dashes',label:n=>`Dash ${n} times`,base:5,per:2.2,read:e=>e.telemetry.dashes},
  {id:'ability',label:n=>`Use your ability ${n} times`,base:2,per:.8,read:e=>e.telemetry.abilitiesUsed},
  {id:'hazard',label:n=>`Kill ${n} hostiles with hazards`,base:2,per:1.1,read:e=>e.telemetry.hazardKills},
  {id:'combo',label:n=>`Reach a ×${n} combo`,base:12,per:5,read:e=>e.maxCombo>e.combo?e.maxCombo:e.combo,absolute:true},
  {id:'survive',label:n=>`Survive ${n} more seconds`,base:35,per:9,unit:'s',tick:(o,dt)=>o.value+dt},
  {
    id:'untouched',label:n=>`Take no damage for ${n}s`,base:18,per:3.4,unit:'s',
    tick:(o,dt,engine)=>{
      const taken=engine.telemetry.damageTaken;
      if(o.mark===undefined)o.mark=taken;
      if(taken>o.mark+.5){o.mark=taken;return 0}
      o.mark=taken;
      return o.value+dt;
    }
  }
];

export class Objectives{
  constructor(engine){
    this.engine=engine;
    this.completed=0;
    this.slots=[];
    this.dirty=true;
    for(let i=0;i<SLOTS;i++)this.slots.push(this.roll());
  }

  // Targets grow with operative level so a late-run objective is still work.
  tier(){return Math.max(0,this.engine.level-1)}

  roll(){
    const engine=this.engine;
    const active=new Set(this.slots.filter(Boolean).map(s=>s.id));
    const pool=OBJECTIVE_TEMPLATES.filter(t=>!active.has(t.id));
    const template=pool[engine.rng.int(0,pool.length-1)]||OBJECTIVE_TEMPLATES[0];
    const tier=this.tier();
    const target=Math.max(1,Math.round(template.base+template.per*tier));
    this.dirty=true;
    return{
      id:template.id,template,target,value:0,
      // Absolute templates (peak combo) are not offsets from a baseline.
      origin:template.read&&!template.absolute?template.read(engine):0,
      done:false,doneTimer:0,
      reward:{credits:Math.round(30+tier*9),jp:1+Math.floor(tier/6)}
    };
  }

  update(dt){
    const engine=this.engine;
    for(const slot of this.slots){
      if(slot.done){
        slot.doneTimer-=dt;
        continue;
      }
      const previous=slot.value;
      if(slot.template.tick){
        slot.value=slot.template.tick(slot,dt,engine);
      }else{
        slot.value=Math.max(0,slot.template.read(engine)-slot.origin);
      }
      if(Math.floor(previous)!==Math.floor(slot.value))this.dirty=true;
      if(slot.value>=slot.target)this.complete(slot);
    }
    for(let i=0;i<this.slots.length;i++){
      if(this.slots[i].done&&this.slots[i].doneTimer<=0)this.slots[i]=this.roll();
    }
  }

  complete(slot){
    const engine=this.engine;
    slot.done=true;
    slot.value=slot.target;
    slot.doneTimer=DONE_HOLD;
    this.completed++;
    this.dirty=true;

    engine.credits+=slot.reward.credits;
    engine.jp+=slot.reward.jp;
    engine.announce(`OBJECTIVE CLEARED // +${slot.reward.credits} CR`,'#8bff9b',1.8);
    engine.fx.text(engine.player.x,engine.player.y-40,'OBJECTIVE CLEARED','#8bff9b',{size:13,life:1.6});
    engine.audio.play('unlock',{volume:.6});

    // Every third clearance surfaces a personnel cache, which is the only
    // way an unrecovered operative file enters the run.
    if(this.completed%DOSSIER_EVERY===0)engine.spawnDossier();
  }

  // Rendered by the HUD; completed entries linger briefly before rolling.
  list(){
    return this.slots.map(slot=>({
      id:slot.id,
      label:slot.template.label(slot.target),
      value:Math.min(slot.value,slot.target),
      target:slot.target,
      unit:slot.template.unit||'',
      done:slot.done
    }));
  }
}
