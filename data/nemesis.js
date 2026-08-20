// The Nemesis.
//
// A bipedal walker the network commissions against one operator specifically.
// It is not drawn from the deployment pool and it is not a command signature
// guarding a sector — it is a hunter-killer with a file on you, and the whole
// point of it is that it persists. It arrives, it takes damage, and below a
// threshold it disengages and walks out of the sector rather than dying. What
// comes back is the same machine: heavier, carrying another hardpoint, and
// wearing the holes you put in it last time.
//
// Only the final tier can actually be destroyed. Everything before that is the
// machine learning what you do.

// Designations are issued in order, so a player's first walker is always
// IRONWAKE and the fiction stays consistent between saves.
export const DESIGNATIONS=[
  'IRONWAKE','GALLOWGLASS','COLD SUTURE','PALE VERDICT',
  'ATTRITION NINE','THE LONG ARREARS'
];

// How many contracts a player closes before the network commissions one.
export const FIRST_ENCOUNTER_AT=3;
// And how long it takes to refit between appearances.
export const REFIT_CONTRACTS=2;

// Encounters before it can be destroyed. Below this it always withdraws.
export const TIERS=4;

// The share of its health at which it breaks off, per tier. It holds on longer
// each time — the first meeting is almost a formality, the last is a fight.
const WITHDRAW_AT=[.45,.34,.22,0];

export function withdrawThreshold(tier){
  return WITHDRAW_AT[Math.min(tier,WITHDRAW_AT.length-1)];
}

// Hardpoints are bolted on between contracts, one per return, in this order.
// Each is an ordinary boss pattern — the walker fights with the same machinery
// every command signature uses, it just accumulates more of it.
// `key` is what the save stores. It has to be distinct from `id`, because two
// hardpoints run the same pattern with different numbers — storing the pattern
// id alone would resolve the overclock back to the base array.
export const HARDPOINTS=[
  {key:'array',   id:'radialBurst',weight:4,cooldown:3.6,bullets:12,speed:250,damage:15,
   fitted:'ROTARY ARRAY'},
  {key:'stride',  id:'chargeSlam',weight:3,cooldown:6.5,windup:.9,speed:600,damage:36,
   fitted:'STRIDE ACTUATORS'},
  {key:'mortars', id:'mortarVolley',weight:3,cooldown:5,shells:4,delay:1.2,radius:105,damage:32,
   fitted:'SHOULDER MORTARS'},
  {key:'lance',   id:'sweepBeam',weight:3,cooldown:5.6,windup:1,arc:1.5,damage:28,
   fitted:'LANCE EMITTER'},
  {key:'dismount',id:'summonEscort',weight:2,cooldown:10,count:4,unit:'rifle',
   fitted:'DISMOUNT BAY'},
  {key:'overclock',id:'radialBurst',weight:4,cooldown:2.4,bullets:20,speed:300,damage:18,spiral:true,
   fitted:'ARRAY OVERCLOCK'}
];

export const HARDPOINTS_BY_KEY=Object.fromEntries(HARDPOINTS.map(h=>[h.key,h]));

// The next hardpoint the network bolts on, or null once it carries them all.
export function nextHardpoint(record){
  return HARDPOINTS.find(h=>!record.hardpoints.includes(h.key))||null;
}

// The chassis before anything is bolted to it. Phases are shallow compared to a
// command signature: the walker's escalation happens across contracts, not
// inside one.
export const NEMESIS_CHASSIS={
  id:'nemesis',render:'nemesis',
  title:'Bipedal hunter-killer // commissioned against one operator',
  hp:2200,radius:54,speed:46,armor:16,xp:520,credits:640,jp:44,
  color:'#e0533f',accent:'#ffb35c',
  nemesis:true
};

// Scaling per encounter. Deliberately steep on health and shallow on damage:
// the walker should take longer to put down each time without turning into a
// one-shot, because the encounter has to stay survivable for a player who is
// meeting it at the same command rating they met it at last time.
export function tierScaling(tier){
  return{
    hpMult:1+tier*.55,
    damageMult:1+tier*.12,
    speedMult:1+tier*.06,
    armorMult:1+tier*.2
  };
}

// The record kept between contracts.
export function defaultNemesisRecord(){
  return{
    designation:DESIGNATIONS[0],
    index:0,          // which designation this is
    tier:0,           // encounters survived, which is also its refit level
    encounters:0,
    scars:[],         // chassis-local hit marks, carried between contracts
    hardpoints:[],    // pattern ids bolted on so far
    lastContract:0,   // contracts closed when it was last seen
    retired:false     // destroyed; the network will commission a successor
  };
}

// Whether the walker deploys on this contract.
export function nemesisDue(record,contractsClosed){
  if(!record)return false;
  if(record.retired)return contractsClosed-record.lastContract>=REFIT_CONTRACTS*3;
  if(record.encounters===0)return contractsClosed>=FIRST_ENCOUNTER_AT;
  return contractsClosed-record.lastContract>=REFIT_CONTRACTS;
}

// The phase table for a given record: one phase, plus a harder one once it has
// enough bolted on to change its behaviour partway through a fight.
export function phasesFor(record){
  const fitted=record.hardpoints.map(key=>HARDPOINTS_BY_KEY[key]).filter(Boolean);
  // Always at least the rotary array, so the first encounter is still a fight.
  const opening=fitted.length?fitted:[HARDPOINTS[0]];
  const phases=[{at:1,name:'ACQUISITION',speed:46,patterns:opening.map(strip)}];
  if(record.tier>=2){
    phases.push({
      at:.5,name:'PREJUDICE',speed:58,enrage:1.25,
      patterns:opening.map(p=>strip({...p,cooldown:p.cooldown*.7}))
    });
  }
  return phases;
}

// Hardpoint entries carry a key and a display name the pattern machinery does
// not want to see.
function strip({fitted,key,...pattern}){return pattern}
