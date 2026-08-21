import {Rng,hashSeed} from '../src/core/rng.js';
import {MAPS,DURATIONS,DIFFICULTIES,DIFFICULTIES_BY_ID} from './maps.js';

// Rotating contracts.
//
// A daily and a weekly contract, derived entirely from the date. Nobody stores
// them and nobody transmits them: two operators on opposite sides of the world
// compute the same seed from the same calendar day and get the same sector, the
// same hostiles and the same command signature. That only means something
// because the simulation is reproducible from its seed — see the determinism
// pass in src/game/engine.js. Before that, the seed picked the floor plan and
// nothing else.
//
// Everything here is pure. Given a date it returns the same contract forever,
// so a result recorded today still describes the contract it was set on.

// Calendar day in UTC, so the contract turns over at the same instant for
// everyone rather than at each operator's local midnight.
export function dailyKey(date=new Date()){
  return date.toISOString().slice(0,10);
}

// ISO-8601 week. Thursday decides the year, which is what stops the last days
// of December and the first days of January landing in two different weeks.
export function weeklyKey(date=new Date()){
  const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const week=Math.ceil(((d-yearStart)/86400000+1)/7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}

// Contract modifiers.
//
// Every one of these is expressed purely as multipliers on the difficulty
// object the engine already consumes, so a modifier needs no new simulation
// code and cannot be silently dropped. That constraint is deliberate: fields
// like `detectionMult` look tempting but are recomputed from dev ranks after
// the engine constructs, so a contract setting one would be overwritten
// without complaint.
export const MODIFIERS=[
  {id:'clean',name:'CLEAN SWEEP',short:'CLN',
   desc:'No modifiers. The theatre exactly as it stands.',mods:{}},
  {id:'saturation',name:'SATURATION',short:'SAT',
   desc:'Hostile density raised. They arrive sooner, in greater number, and thinner.',
   mods:{densityMult:1.35,hpMult:.85}},
  {id:'ironclad',name:'IRONCLAD',short:'IRN',
   desc:'Heavier plate issued across the response. Fewer contacts, each one slower to put down.',
   mods:{hpMult:1.5,densityMult:.85}},
  {id:'blitz',name:'BLITZ',short:'BLZ',
   desc:'Fast and lethal. Openings close before you have finished reading them.',
   mods:{speedMult:1.18,damageMult:1.25,hpMult:.8}},
  {id:'glasshouse',name:'GLASS HOUSE',short:'GLS',
   desc:'Everything on the field dies quickly, including the operative carrying the contract.',
   mods:{damageMult:1.6,hpMult:.6,xpMult:1.15}},
  {id:'attrition',name:'ATTRITION',short:'ATT',
   desc:'A grinding denial operation. More of them, tougher, hitting harder, for longer.',
   mods:{hpMult:1.25,damageMult:1.15,densityMult:1.15,xpMult:1.2}}
];

// Fold a modifier into a difficulty, producing the object the engine is given.
// The base id and name survive, because the save records difficulty by id and a
// rotating contract should still count as a clear at that setting.
export function resolveDifficulty(contract){
  const base=contract.difficulty, mods=contract.modifier?.mods||{};
  const out={...base};
  for(const [key,mult] of Object.entries(mods))
    out[key]=(base[key]??1)*mult;
  out.jpMult=(base.jpMult??1)*(contract.jpMult??1);
  return out;
}

export const MODIFIERS_BY_ID=Object.fromEntries(MODIFIERS.map(m=>[m.id,m]));

// Deterministic draw from a namespaced key. The namespace keeps the daily and
// the weekly from ever landing on the same stream even on the same date.
function streamFor(kind,key){
  return new Rng(hashSeed(`${kind}:${key}`));
}

// The daily rotates through the theatres a player has actually reached; the
// weekly is longer, harder, and always runs the full roster of contract lengths
// from the top half of the table.
function buildContract(kind,key,options={}){
  const rng=streamFor(kind,key);
  const weekly=kind==='weekly';

  // Only theatres that ship unlocked can be drawn, so a rotating contract never
  // hands somebody a sector their save has not opened.
  const pool=MAPS.filter(m=>m.unlocked);
  const map=rng.pick(pool.length?pool:MAPS);

  // Weeklies run long: extended through endurance. Dailies stay in the
  // probe-to-deep band so a day's contract fits in one sitting.
  const durations=weekly
    ? DURATIONS.filter(d=>d.minutes>=15)
    : DURATIONS.filter(d=>d.minutes>=5&&d.minutes<=20);
  const duration=rng.pick(durations);

  // A rotating contract sets its own difficulty rather than drawing from what
  // the operator has unlocked. It is a fixed challenge everybody faces on the
  // same terms — gating it behind progression would mean two people comparing
  // results on contracts that were never the same. Filtering by the unlocked
  // flag also left exactly one option, so nothing rotated at all.
  const band=weekly?[2,3,4]:[1,2,3];
  const difficulty=DIFFICULTIES_BY_ID[rng.pick(band)]||DIFFICULTIES[1];

  const modifier=rng.pick(weekly?MODIFIERS.filter(m=>m.id!=='clean'):MODIFIERS);

  return{
    kind,key,
    // The seed the run is launched with. Derived from the same string as the
    // contract itself, so the sector and the schedule agree.
    seed:hashSeed(`${kind}:${key}:run`)%1e9,
    map,duration,difficulty,modifier,
    label:weekly?'WEEKLY CONTRACT':'DAILY CONTRACT',
    // Rotating contracts pay a premium over free deployment.
    jpMult:weekly?2.2:1.35,
    expiresAt:options.expiresAt??null
  };
}

export function dailyContract(date=new Date()){
  const key=dailyKey(date);
  const next=new Date(date);
  next.setUTCDate(next.getUTCDate()+1);
  next.setUTCHours(0,0,0,0);
  return buildContract('daily',key,{expiresAt:next.getTime()});
}

export function weeklyContract(date=new Date()){
  const key=weeklyKey(date);
  // Weeks roll over on Monday 00:00 UTC.
  const next=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  next.setUTCDate(next.getUTCDate()+((8-(next.getUTCDay()||7))%7||7));
  return buildContract('weekly',key,{expiresAt:next.getTime()});
}

export function activeContracts(date=new Date()){
  return[dailyContract(date),weeklyContract(date)];
}

// Human-readable countdown for the board.
export function timeRemaining(contract,now=Date.now()){
  if(!contract.expiresAt)return '';
  const ms=contract.expiresAt-now;
  if(ms<=0)return 'EXPIRED';
  const h=Math.floor(ms/3600000), m=Math.floor(ms%3600000/60000);
  return h>=24?`${Math.floor(h/24)}D ${h%24}H`:h>=1?`${h}H ${m}M`:`${m}M`;
}
