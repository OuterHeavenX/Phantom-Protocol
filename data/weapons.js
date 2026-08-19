// Weapon registry. Every entry declares a `behavior` that the combat runtime
// (src/game/weapons.js) implements, plus per-level scaling. Nothing here is
// decorative: each id maps to a distinct firing pattern in the simulation.
//
// scaling values are per-level multipliers/additions applied from level 1.

export const WEAPON_RARITY={common:'#9fb6b8',uncommon:'#76e7d4',rare:'#7db2ff',prototype:'#c79bff',classified:'#ffb35c'};

export const WEAPONS=[
  {
    id:'needle',name:'Needle-7',short:'NDL',category:'firearm',rarity:'common',
    behavior:'projectile',targeting:'nearest',
    desc:'Suppressed marksman pistol. Fires fast, accurate single rounds at the nearest contact.',
    damage:12,cooldown:.62,speed:640,pierce:0,count:1,spread:.03,knockback:60,range:520,
    sound:'shoot',
    scaling:{damage:4.2,cooldown:-.028,count:[0,0,1,0,0,1,0,0],pierce:[0,0,0,1,0,0,0,1],speed:14},
    levelText:l=>['+4 damage','+fire rate','+1 round','+1 pierce','+4 damage','+1 round','+fire rate','+1 pierce'][l-1]
  },
  {
    id:'bulwark',name:'Bulwark AR',short:'BLW',category:'firearm',rarity:'common',
    behavior:'burst',targeting:'nearest',
    desc:'Service assault rifle. Three-round bursts with meaningful stopping power.',
    damage:9,cooldown:1.05,speed:560,pierce:0,count:3,burstDelay:.075,spread:.07,knockback:90,range:480,
    sound:'shoot',
    scaling:{damage:3.4,cooldown:-.05,count:[0,0,1,0,1,0,0,1],spread:-.004},
    levelText:l=>['+3 damage','+fire rate','+1 round','+3 damage','+1 round','tighter spread','+fire rate','+1 round'][l-1]
  },
  {
    id:'kite',name:'Kite Drone',short:'KTE',category:'tech',rarity:'common',
    behavior:'orbit',targeting:'orbit',
    desc:'Escort drones orbit the operative and shred anything that closes in.',
    damage:11,cooldown:0,count:2,orbitRadius:78,orbitSpeed:2.4,hitInterval:.42,knockback:40,
    sound:'tech',
    scaling:{damage:3.6,count:[0,1,0,1,0,1,0,1],orbitRadius:6,orbitSpeed:.16},
    levelText:l=>['+4 damage','+1 drone','+radius','+1 drone','+4 damage','+1 drone','+speed','+1 drone'][l-1]
  },
  {
    id:'monofilament',name:'Monofilament Arc',short:'MNO',category:'melee',rarity:'common',
    behavior:'arc',targeting:'facing',
    desc:'A whipping filament blade that carves a wide arc through everything in front of you.',
    damage:22,cooldown:.95,arc:2.1,reach:96,knockback:190,
    sound:'laser',
    scaling:{damage:7.5,cooldown:-.055,arc:.16,reach:9},
    levelText:l=>['+8 damage','+reach','+arc width','+8 damage','+swing rate','+arc width','+8 damage','+reach'][l-1]
  },
  {
    id:'specter',name:'Specter Rifle',short:'SPC',category:'firearm',rarity:'uncommon',
    behavior:'railshot',targeting:'strongest',
    desc:'Anti-materiel rifle. Slow, deliberate shots that punch through a whole column of hostiles.',
    damage:46,cooldown:1.85,speed:1150,pierce:4,count:1,knockback:210,range:900,critBonus:.15,
    sound:'shootHeavy',
    scaling:{damage:16,cooldown:-.11,pierce:[0,1,0,1,0,1,0,2],critBonus:.03},
    levelText:l=>['+16 damage','+1 pierce','+fire rate','+1 pierce','+16 damage','+1 pierce','+crit','+2 pierce'][l-1]
  },
  {
    id:'scatter',name:'Scatter Breach',short:'SCT',category:'firearm',rarity:'uncommon',
    behavior:'shotgun',targeting:'nearest',
    desc:'Breaching shotgun. A close-range cone of pellets that flattens crowds.',
    damage:8,cooldown:1.15,speed:520,count:7,spread:.62,knockback:150,range:280,falloff:true,
    sound:'shootHeavy',
    scaling:{damage:2.8,cooldown:-.06,count:[0,1,1,0,1,1,0,2],knockback:14},
    levelText:l=>['+3 damage','+1 pellet','+1 pellet','+fire rate','+1 pellet','+1 pellet','+3 damage','+2 pellets'][l-1]
  },
  {
    id:'vector',name:'Vector SMG',short:'VCT',category:'firearm',rarity:'uncommon',
    behavior:'projectile',targeting:'nearest',
    desc:'High cyclic-rate submachine gun. Low per-shot damage, relentless uptime.',
    damage:6,cooldown:.2,speed:600,count:1,spread:.14,knockback:24,range:400,
    sound:'shoot',
    scaling:{damage:2.1,cooldown:-.012,count:[0,0,1,0,0,1,0,1],spread:-.008},
    levelText:l=>['+2 damage','+fire rate','+1 round','tighter spread','+2 damage','+1 round','+fire rate','+1 round'][l-1]
  },
  {
    id:'shard',name:'Shard Grenades',short:'SHD',category:'explosive',rarity:'uncommon',
    behavior:'lobbed',targeting:'random',
    desc:'Bouncing fragmentation charges that detonate into a wide shrapnel burst.',
    damage:34,cooldown:1.75,speed:330,count:1,blastRadius:88,fuse:.9,knockback:230,
    sound:'explode',
    scaling:{damage:11,cooldown:-.1,count:[0,1,0,1,0,1,0,1],blastRadius:8},
    levelText:l=>['+11 damage','+1 charge','+blast radius','+1 charge','+11 damage','+1 charge','+fire rate','+1 charge'][l-1]
  },
  {
    id:'tripmine',name:'Ghostwire Mines',short:'GWM',category:'explosive',rarity:'rare',
    behavior:'mine',targeting:'ground',
    desc:'Proximity charges seeded around the operative. Anything that walks in does not walk out.',
    damage:52,cooldown:2.4,count:1,blastRadius:76,armTime:.5,lifetime:22,maxActive:6,knockback:200,
    sound:'explode',
    scaling:{damage:16,cooldown:-.14,count:[0,1,0,1,0,1,0,1],blastRadius:6,maxActive:[0,1,1,1,1,1,1,2]},
    levelText:l=>['+16 damage','+1 mine','+field cap','+1 mine','+16 damage','+blast radius','+1 mine','+2 field cap'][l-1]
  },
  {
    id:'microwave',name:'Microwave Crown',short:'MWC',category:'tech',rarity:'rare',
    behavior:'aura',targeting:'self',
    desc:'A sustained directed-energy field that cooks everything standing too close.',
    damage:9,cooldown:0,radius:104,tickInterval:.3,statusEffect:'burn',statusChance:.35,
    sound:'tech',
    scaling:{damage:3.2,radius:11,tickInterval:-.016,statusChance:.04},
    levelText:l=>['+3 damage','+radius','+tick rate','+3 damage','+radius','+burn chance','+tick rate','+radius'][l-1]
  },
  {
    id:'emp',name:'EMP Cascade',short:'EMP',category:'tech',rarity:'rare',
    behavior:'pulse',targeting:'self',
    desc:'Expanding electromagnetic shockwave. Stuns machines and staggers everything else.',
    damage:26,cooldown:3.2,radius:190,statusEffect:'shock',statusChance:.85,knockback:280,
    sound:'scramble',
    scaling:{damage:9,cooldown:-.2,radius:22},
    levelText:l=>['+9 damage','+radius','+fire rate','+9 damage','+radius','+fire rate','+9 damage','+radius'][l-1]
  },
  {
    id:'sentry',name:'Sentry Seed',short:'SNT',category:'tech',rarity:'rare',
    behavior:'turret',targeting:'deploy',
    desc:'Deployable autoturrets that hold an area and fire independently of the operative.',
    damage:10,cooldown:6.5,count:1,turretLife:16,turretFireRate:.45,turretRange:290,maxActive:2,speed:600,
    sound:'tech',
    scaling:{damage:3.4,cooldown:-.4,count:[0,0,1,0,0,1,0,0],maxActive:[0,1,0,1,0,1,0,1],turretLife:1.5},
    levelText:l=>['+3 damage','+1 active turret','+1 per deploy','+1 active turret','+3 damage','+1 per deploy','+turret life','+1 active turret'][l-1]
  },
  {
    id:'micro',name:'Micro-Missile Bloom',short:'MMB',category:'tech',rarity:'rare',
    behavior:'homing',targeting:'random',
    desc:'A salvo of seeking micro-missiles that chase down scattered targets.',
    damage:19,cooldown:1.6,speed:290,count:3,turnRate:4.2,blastRadius:44,range:640,
    sound:'shoot',
    scaling:{damage:6.4,cooldown:-.09,count:[0,1,0,1,1,0,1,1],turnRate:.24},
    levelText:l=>['+6 damage','+1 missile','+tracking','+1 missile','+1 missile','+6 damage','+1 missile','+1 missile'][l-1]
  },
  {
    id:'rail',name:'Pale Rail',short:'RAIL',category:'experimental',rarity:'prototype',
    behavior:'beam',targeting:'strongest',
    desc:'Charged rail beam. Holds a lance of light across the battlefield, hitting everything on the line.',
    damage:20,cooldown:2.6,beamDuration:.55,beamWidth:16,range:1000,tickInterval:.09,knockback:40,
    sound:'laser',
    scaling:{damage:7,cooldown:-.15,beamWidth:2.5,beamDuration:.05},
    levelText:l=>['+7 damage','+beam width','+fire rate','+duration','+7 damage','+beam width','+fire rate','+duration'][l-1]
  },
  {
    id:'nanite',name:'Nanite Swarm',short:'NAN',category:'experimental',rarity:'prototype',
    behavior:'chain',targeting:'nearest',
    desc:'Self-replicating nanites that arc from body to body, spreading corrosion as they go.',
    damage:16,cooldown:1.4,chains:3,chainRange:160,range:340,statusEffect:'corrode',statusChance:.6,falloffPerChain:.12,
    sound:'tech',
    scaling:{damage:5.4,cooldown:-.08,chains:[0,1,0,1,1,0,1,1],chainRange:12},
    levelText:l=>['+5 damage','+1 chain','+chain range','+1 chain','+1 chain','+5 damage','+1 chain','+1 chain'][l-1]
  },
  {
    id:'lance',name:'Particle Lance',short:'LNC',category:'experimental',rarity:'prototype',
    behavior:'piercebolt',targeting:'facing',
    desc:'Forward particle bolt that pierces the entire enemy line and leaves a burning trail.',
    damage:38,cooldown:1.5,speed:760,pierce:99,count:1,knockback:120,range:800,statusEffect:'burn',statusChance:.4,trail:true,
    sound:'laser',
    scaling:{damage:13,cooldown:-.08,count:[0,0,1,0,0,1,0,1],speed:24},
    levelText:l=>['+13 damage','+velocity','+1 bolt','+13 damage','+fire rate','+1 bolt','+13 damage','+1 bolt'][l-1]
  },
  {
    id:'orbital',name:'Skyhook Designator',short:'SKY',category:'experimental',rarity:'classified',
    behavior:'orbital',targeting:'zone',
    desc:'Paints ground targets for off-map fire. Marked zones are erased seconds later.',
    damage:96,cooldown:4.6,count:1,blastRadius:118,delay:1.3,knockback:320,
    sound:'explode',
    scaling:{damage:32,cooldown:-.28,count:[0,1,0,1,0,1,0,1],blastRadius:9},
    levelText:l=>['+32 damage','+1 strike','+blast radius','+1 strike','+32 damage','+1 strike','+call rate','+1 strike'][l-1]
  },
  {
    id:'revenant',name:'Revenant Protocol',short:'RVN',category:'experimental',rarity:'classified',
    behavior:'summon',targeting:'deploy',
    desc:'Reanimates fallen hostiles as short-lived phantom escorts that fight alongside you.',
    damage:24,cooldown:5,count:1,minionLife:14,maxActive:3,minionSpeed:190,minionHp:60,
    sound:'tech',
    scaling:{damage:8,cooldown:-.3,maxActive:[0,1,0,1,0,1,0,1],minionLife:1.4},
    levelText:l=>['+8 damage','+1 phantom','+phantom life','+1 phantom','+8 damage','+1 phantom','+call rate','+1 phantom'][l-1]
  }
];

export const MAX_WEAPON_LEVEL=8;

// Requisition ladder. Two weapons ship with the account; the rest are released
// against command rating, so the armory opens on a schedule the player can
// read rather than on a mastery condition they have to reverse-engineer.
export const WEAPON_UNLOCK_LEVEL={
  needle:0,bulwark:0,
  kite:2,monofilament:3,
  specter:5,scatter:7,vector:9,shard:11,
  tripmine:13,microwave:15,emp:17,sentry:19,micro:22,
  rail:25,nanite:28,lance:31,
  orbital:35,revenant:40
};

export function weaponUnlockLevel(id){
  return WEAPON_UNLOCK_LEVEL[id]??0;
}
export const MAX_WEAPON_SLOTS=6;

// Evolutions fuse a maxed weapon with a specific passive at max rank.
// Each evolved form is a real weapon definition with its own behavior.
export const EVOLUTIONS=[
  {
    id:'predator',name:'Predator Network',base:'needle',passive:'optics',
    short:'PRD',category:'firearm',rarity:'classified',behavior:'projectile',targeting:'nearest',
    desc:'Networked fire control. Every round auto-corrects mid-flight and marks its target for the whole loadout.',
    damage:52,cooldown:.24,speed:820,pierce:2,count:3,spread:.05,knockback:90,range:640,
    statusEffect:'mark',statusChance:1,critBonus:.2,sound:'shoot'
  },
  {
    id:'horizon',name:'Horizon Driver',base:'specter',passive:'ammunition',
    short:'HZN',category:'firearm',rarity:'classified',behavior:'railshot',targeting:'strongest',
    desc:'Orbital-grade barrel. A single shot deletes an entire lane and detonates on the far end.',
    damage:210,cooldown:1.1,speed:1600,pierce:99,count:1,knockback:420,range:1400,blastRadius:70,sound:'shootHeavy'
  },
  {
    id:'glassrain',name:'Glass Rain',base:'shard',passive:'harness',
    short:'GLR',category:'explosive',rarity:'classified',behavior:'lobbed',targeting:'random',
    desc:'Cluster munition rework. Each charge splits into six submunitions before impact.',
    damage:82,cooldown:.95,speed:380,count:4,blastRadius:104,fuse:.7,cluster:6,knockback:260,sound:'explode'
  },
  {
    id:'geometry',name:'Silent Geometry',base:'monofilament',passive:'mobility',
    short:'SGM',category:'melee',rarity:'classified',behavior:'arc',targeting:'facing',
    desc:'The filament folds space around the swing. A full 360-degree cut, every time.',
    damage:120,cooldown:.5,arc:6.283,reach:150,knockback:340,sound:'laser'
  },
  {
    id:'aurora',name:'Black Aurora',base:'microwave',passive:'cooling',
    short:'AUR',category:'tech',rarity:'classified',behavior:'aura',targeting:'self',
    desc:'Field inversion. The aura burns, slows and drains everything caught inside it.',
    damage:44,cooldown:0,radius:190,tickInterval:.14,statusEffect:'burn',statusChance:1,lifesteal:.05,sound:'tech'
  },
  {
    id:'deadchannel',name:'Dead Channel',base:'emp',passive:'ewmodule',
    short:'DCH',category:'tech',rarity:'classified',behavior:'pulse',targeting:'self',
    desc:'Total spectrum denial. The pulse never really stops — it just breathes.',
    damage:96,cooldown:1.4,radius:300,statusEffect:'shock',statusChance:1,knockback:420,sound:'scramble'
  },
  {
    id:'ironhalo',name:'Iron Halo',base:'kite',passive:'plating',
    short:'IRH',category:'tech',rarity:'classified',behavior:'orbit',targeting:'orbit',
    desc:'The escort ring becomes armour. Drones intercept incoming fire and grind the perimeter.',
    damage:58,cooldown:0,count:8,orbitRadius:112,orbitSpeed:3.4,hitInterval:.22,knockback:120,intercept:true,sound:'tech'
  },
  {
    id:'witchlight',name:'Witchlight Array',base:'rail',passive:'amplifier',
    short:'WLA',category:'experimental',rarity:'classified',behavior:'beam',targeting:'strongest',
    desc:'Four beams, one designator. The array sweeps the field until nothing is standing.',
    damage:88,cooldown:1.2,beamDuration:1.1,beamWidth:26,range:1300,tickInterval:.06,beams:4,sound:'laser'
  },
  {
    id:'graviton',name:'Graviton Choir',base:'orbital',passive:'reactor',
    short:'GRV',category:'experimental',rarity:'classified',behavior:'orbital',targeting:'zone',
    desc:'Designates a collapsing gravity well instead of a shell. Everything falls inward, then stops existing.',
    damage:260,cooldown:2.6,count:3,blastRadius:170,delay:.9,knockback:600,implode:true,sound:'explode'
  },
  {
    id:'cerberus',name:'Cerberus Bloom',base:'sentry',passive:'loader',
    short:'CRB',category:'tech',rarity:'classified',behavior:'turret',targeting:'deploy',
    desc:'Three-headed autonomous weapon platforms with their own ammunition supply.',
    damage:44,cooldown:2.2,count:2,turretLife:30,turretFireRate:.14,turretRange:420,maxActive:5,speed:800,sound:'tech'
  },
  {
    id:'meridian',name:'Ash Meridian',base:'nanite',passive:'scanner',
    short:'ASH',category:'experimental',rarity:'classified',behavior:'chain',targeting:'nearest',
    desc:'The swarm no longer needs a line. It finds everything on the field and unmakes it.',
    damage:74,cooldown:.7,chains:12,chainRange:280,range:520,statusEffect:'corrode',statusChance:1,falloffPerChain:.02,sound:'tech'
  },
  {
    id:'wake',name:'Pale Wake',base:'lance',passive:'stimulants',
    short:'PWK',category:'experimental',rarity:'classified',behavior:'piercebolt',targeting:'facing',
    desc:'The bolt leaves a burning corridor that persists long after the shot.',
    damage:150,cooldown:.62,speed:980,pierce:99,count:3,knockback:220,range:1100,
    statusEffect:'burn',statusChance:1,trail:true,scorchTrail:true,sound:'laser'
  }
];

export const WEAPONS_BY_ID=Object.fromEntries(WEAPONS.map(w=>[w.id,w]));
export const EVOLUTIONS_BY_ID=Object.fromEntries(EVOLUTIONS.map(e=>[e.id,e]));
export const ALL_WEAPON_FORMS=Object.fromEntries([...WEAPONS,...EVOLUTIONS].map(w=>[w.id,w]));

export function evolutionFor(weaponId){
  return EVOLUTIONS.find(e=>e.base===weaponId)||null;
}
