// Operative roster. Every operative carries a distinct stat profile, a
// starting weapon, an always-on trait and an activated ability with its own
// implementation in src/game/abilities.js.

export const OPERATIVES=[
  {
    id:'vesper',codename:'VESPER',name:'Elara Voss',role:'Electronic Infiltration',
    desc:'Reconnaissance officer who corrupts hostile target locks and moves before the correction lands.',
    weapon:'needle',
    hp:100,speed:212,armor:0,
    growth:{hp:8,speed:1.4,armor:.18},
    trait:{id:'signalGhost',name:'Signal Ghost',desc:'Hostiles lose your track 40% faster and their shots lead you incorrectly.'},
    ability:{id:'scramble',name:'Scramble Beacon',desc:'Blinds and disorients every hostile in a wide radius.',cooldown:18},
    stats:{damage:1,fireRate:1.05,area:1,moveSpeed:1.04,magnet:1.15},
    unlocked:true,unlock:null,
    color:'#76e7d4'
  },
  {
    id:'bastion',codename:'BASTION',name:'Marcus Vale',role:'Mechanized Breacher',
    desc:'Heavy infantry veteran in a reinforced field frame. Slower, far harder to remove.',
    weapon:'bulwark',
    hp:150,speed:176,armor:6,
    growth:{hp:14,speed:.9,armor:.5},
    trait:{id:'compositeFrame',name:'Composite Frame',desc:'Armor reduces damage by a flat amount and you cannot be knocked back.'},
    ability:{id:'bulwarkShield',name:'Bulwark Field',desc:'Projects a directional shield that absorbs incoming fire and reflects it.',cooldown:22},
    stats:{damage:1.12,fireRate:.94,area:1.05,moveSpeed:.94,maxHp:20},
    unlocked:true,unlock:null,
    color:'#ffb35c'
  },
  {
    id:'mirage',codename:'MIRAGE',name:'Noor Sayegh',role:'Information Warfare',
    desc:'Drone tactician. Everything on her rig recharges faster than it has any right to.',
    weapon:'kite',
    hp:94,speed:206,armor:0,
    growth:{hp:7,speed:1.5,armor:.14},
    trait:{id:'fastRecompile',name:'Fast Recompile',desc:'All weapon cooldowns are reduced by 12% and ability recharge is 25% faster.'},
    ability:{id:'droneSwarm',name:'Interceptor Swarm',desc:'Releases a swarm of attack drones that hunt independently for 12 seconds.',cooldown:24},
    stats:{cooldown:.88,fireRate:1.08,duration:1.15,moveSpeed:1.02},
    unlocked:true,unlock:null,
    color:'#7db2ff'
  },
  {
    id:'wraith',codename:'WRAITH',name:'Ilan Rook',role:'Close Infiltration',
    desc:'Close-range specialist. Rewards aggressive movement and punishes anything that lets him get close.',
    weapon:'monofilament',
    hp:106,speed:230,armor:1,
    growth:{hp:8,speed:2.1,armor:.2},
    trait:{id:'afterimage',name:'Afterimage',desc:'Dashing leaves a decoy and grants +45% damage for 3 seconds.'},
    ability:{id:'phaseStrike',name:'Phase Strike',desc:'Blinks through the nearest cluster of hostiles, cutting everything on the path.',cooldown:14},
    stats:{damage:1.08,moveSpeed:1.1,critChance:.08,area:.95},
    unlocked:true,unlock:null,
    color:'#c79bff'
  },
  {
    id:'oracle',codename:'ORACLE',name:'Tamsin Keene',role:'Threat Analysis',
    desc:'Predictive-fire specialist reconstructed from a buried black program. Sees the shot before it is taken.',
    weapon:'specter',
    hp:92,speed:198,armor:0,
    growth:{hp:6,speed:1.3,armor:.12},
    trait:{id:'combatAnalysis',name:'Combat Analysis',desc:'+18% critical chance and criticals mark targets for +25% damage from all sources.'},
    ability:{id:'timeDilation',name:'Arbitration Window',desc:'Slows every hostile to a crawl for 5 seconds while you keep full speed.',cooldown:30},
    stats:{damage:1.15,critChance:.18,critDamage:2.2,fireRate:.92},
    unlocked:false,
    unlock:{type:'stat',stat:'bosses',value:3,label:'Defeat 3 command signatures'},
    color:'#ff8d82'
  },
  {
    id:'ferrous',codename:'FERROUS',name:'Dima Karsk',role:'Ordnance Engineering',
    desc:'Demolitions engineer with an unhealthy relationship to blast radius calculations.',
    weapon:'shard',
    hp:118,speed:190,armor:3,
    growth:{hp:10,speed:1.1,armor:.3},
    trait:{id:'overpressure',name:'Overpressure',desc:'All explosions are 35% larger and deal 20% more damage to elites.'},
    ability:{id:'demolition',name:'Demolition Order',desc:'Saturates the surrounding area with a rolling barrage of charges.',cooldown:26},
    stats:{area:1.35,damage:1.1,moveSpeed:.96,fireRate:.9},
    unlocked:false,
    unlock:{type:'stat',stat:'kills',value:2500,label:'Eliminate 2,500 hostiles'},
    color:'#ff7068'
  },
  {
    id:'cipher',codename:'CIPHER',name:'Ada Renn',role:'Systems Subversion',
    desc:'Turns hostile hardware against its owners. The battlefield stops being entirely theirs.',
    weapon:'nanite',
    hp:88,speed:204,armor:0,
    growth:{hp:6,speed:1.5,armor:.1},
    trait:{id:'subversion',name:'Subversion',desc:'Killing a machine has a 20% chance to reanimate it as a temporary ally.'},
    ability:{id:'systemPurge',name:'System Purge',desc:'Detonates every status effect currently on the field simultaneously.',cooldown:20},
    stats:{damage:1.05,duration:1.25,luck:1.2,maxHp:-6},
    unlocked:false,
    unlock:{type:'stat',stat:'evolutionsForged',value:5,label:'Forge 5 weapon evolutions'},
    color:'#9bffb8'
  },
  {
    id:'requiem',codename:'REQUIEM',name:'—',role:'Unregistered',
    desc:'No personnel file exists. Command denies the codename is in use. Field telemetry disagrees.',
    weapon:'revenant',
    hp:80,speed:220,armor:0,
    growth:{hp:5,speed:1.8,armor:.1},
    trait:{id:'entropy',name:'Entropy',desc:'You take 25% more damage, deal 40% more, and every kill briefly restores health.'},
    ability:{id:'lastRites',name:'Last Rites',desc:'Consumes all active phantoms in a detonation scaled to how many were held.',cooldown:18},
    stats:{damage:1.4,fireRate:1.1,moveSpeed:1.06,maxHp:-20},
    unlocked:false,
    unlock:{type:'stat',stat:'wins',value:10,label:'Complete 10 operations'},
    color:'#e0e6ea'
  }
];

export const OPERATIVES_BY_ID=Object.fromEntries(OPERATIVES.map(o=>[o.id,o]));

// Mastery ranks are earned per operative through use, and grant small
// permanent bonuses to that operative only.
export const MASTERY_RANKS=[
  {rank:1,xp:0,bonus:null},
  {rank:2,xp:900,bonus:{stat:'maxHp',value:8,label:'+8 max HP'}},
  {rank:3,xp:2400,bonus:{stat:'damage',value:.04,label:'+4% damage'}},
  {rank:4,xp:5200,bonus:{stat:'moveSpeed',value:.03,label:'+3% move speed'}},
  {rank:5,xp:9600,bonus:{stat:'armor',value:1,label:'+1 armor'}},
  {rank:6,xp:16000,bonus:{stat:'damage',value:.06,label:'+6% damage'}},
  {rank:7,xp:25000,bonus:{stat:'maxHp',value:16,label:'+16 max HP'}},
  {rank:8,xp:38000,bonus:{stat:'critChance',value:.05,label:'+5% crit chance'}},
  {rank:9,xp:56000,bonus:{stat:'cooldown',value:-.05,label:'-5% cooldowns'}},
  {rank:10,xp:80000,bonus:{stat:'damage',value:.10,label:'+10% damage'}}
];

export function masteryRank(xp=0){
  let current=MASTERY_RANKS[0];
  for(const entry of MASTERY_RANKS)if(xp>=entry.xp)current=entry;
  return current;
}

export function masteryProgress(xp=0){
  const rank=masteryRank(xp);
  const next=MASTERY_RANKS.find(r=>r.rank===rank.rank+1);
  if(!next)return{rank:rank.rank,current:1,needed:1,pct:1,max:true};
  const span=next.xp-rank.xp;
  return{rank:rank.rank,current:xp-rank.xp,needed:span,pct:(xp-rank.xp)/span,max:false};
}

// Aggregate every mastery bonus earned up to the operative's current rank.
export function masteryBonuses(xp=0){
  const rank=masteryRank(xp).rank;
  const totals={};
  for(const entry of MASTERY_RANKS){
    if(entry.rank>rank||!entry.bonus)continue;
    totals[entry.bonus.stat]=(totals[entry.bonus.stat]||0)+entry.bonus.value;
  }
  return totals;
}
