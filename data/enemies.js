// Enemy archetypes. `ai` selects a behaviour profile in src/game/ai.js,
// `render` selects a sprite routine in src/render/sprites.js, and `tier`
// controls when the spawn director is allowed to introduce the archetype.

export const ENEMIES=[
  {
    id:'scout',name:'Patrol Scout',ai:'rusher',render:'soldier',tier:0,weight:10,
    hp:22,speed:168,damage:7,radius:11,xp:5,credits:1,armor:0,color:'#8fa79c',
    desc:'Light patrol infantry. Closes without hesitation and without much of a plan.'
  },
  {
    id:'rifle',name:'Rifle Cell',ai:'shooter',render:'soldier',tier:0,weight:10,
    hp:30,speed:124,damage:6,radius:11,xp:6,credits:1,armor:0,color:'#a7b8b9',
    range:250,fireRate:1.9,projectileSpeed:250,burst:2,accuracy:.86,
    desc:'Standard rifle team. Holds range, fires in pairs, repositions between bursts.'
  },
  {
    // The shield tracks the player, so direct fire is always partially
    // absorbed. Kept at tier 2 with a survivable reduction: at tier 1 a
    // starting sidearm could not meaningfully hurt it, which turned an early
    // spawn into an unkillable wall rather than a positioning problem.
    id:'shield',name:'Shield Trooper',ai:'shieldWall',render:'shield',tier:2,weight:5,
    hp:68,speed:108,damage:9,radius:13,xp:11,credits:2,armor:5,color:'#c7a977',
    shieldArc:1.5,shieldReduction:.6,
    desc:'Ballistic shield line. Absorbs most direct fire — use explosives, auras or status damage.'
  },
  {
    id:'pursuit',name:'Pursuit Drone',ai:'flanker',render:'drone',tier:0,weight:8,
    hp:20,speed:208,damage:6,radius:9,xp:6,credits:1,armor:0,color:'#82d0d8',
    machine:true,orbitBias:.7,
    desc:'Fast interceptor drone. Circles to your flank instead of charging head-on.'
  },
  {
    id:'hunter',name:'Hunter Drone',ai:'diveBomber',render:'drone',tier:2,weight:6,
    hp:42,speed:224,damage:16,radius:10,xp:11,credits:2,armor:1,color:'#e2b26f',
    machine:true,diveWindup:.75,diveSpeed:520,
    desc:'Attack drone. Locks on, telegraphs, then commits to a high-speed strafing run.'
  },
  {
    id:'sniper',name:'Longshot Sniper',ai:'sniper',render:'sniper',tier:2,weight:4,
    hp:34,speed:102,damage:22,radius:11,xp:13,credits:3,armor:0,color:'#c58ea8',
    range:520,fireRate:3.4,projectileSpeed:620,windup:1.05,accuracy:.97,
    desc:'Designated marksman. Paints a visible laser before firing — break the line.'
  },
  {
    id:'breacher',name:'Breacher Heavy',ai:'juggernaut',render:'heavy',tier:2,weight:5,
    hp:150,speed:112,damage:20,radius:17,xp:19,credits:4,armor:10,color:'#cb8d6c',
    chargeWindup:.9,chargeSpeed:400,breaksCover:true,knockbackResist:.9,
    desc:'Assault frame. Winds up and charges in a straight line, wrecking cover on the way.'
  },
  {
    id:'jammer',name:'Signal Jammer',ai:'support',render:'jammer',tier:2,weight:4,
    hp:62,speed:118,damage:4,radius:13,xp:15,credits:4,armor:2,color:'#9d8bc8',
    machine:true,auraRadius:190,buffAmount:.3,jamsMagnet:true,
    desc:'Force multiplier. Buffs nearby hostiles and suppresses your pickup magnet.'
  },
  {
    id:'crawler',name:'Crawler Robot',ai:'swarmer',render:'crawler',tier:1,weight:9,
    hp:26,speed:188,damage:9,radius:10,xp:6,credits:1,armor:0,color:'#789ba3',
    machine:true,packBonus:.25,
    desc:'Quadruped swarm unit. Individually trivial, dangerous in packs — and it knows it.'
  },
  {
    id:'veil',name:'Veil Operative',ai:'ambusher',render:'veil',tier:3,weight:5,
    hp:56,speed:216,damage:19,radius:11,xp:17,credits:4,armor:2,color:'#8799a6',
    cloakRange:340,decloakRange:90,ambushDamage:1.6,
    desc:'Counter-infiltration specialist. Goes optically dark at range and reappears on top of you.'
  },
  {
    id:'marauder',name:'Augment Marauder',ai:'berserker',render:'augment',tier:3,weight:5,
    hp:130,speed:178,damage:22,radius:15,xp:21,credits:5,armor:6,color:'#d26e62',
    enrageThreshold:.4,enrageSpeed:1.65,enrageDamage:1.4,
    desc:'Chem-augmented shock infantry. Gets faster and angrier the closer it is to dying.'
  },
  {
    id:'mortar',name:'Mortar Team',ai:'artillery',render:'mortar',tier:3,weight:4,
    hp:70,speed:96,damage:26,radius:13,xp:19,credits:5,armor:2,color:'#bfa672',
    range:620,minRange:180,fireRate:3.8,shellDelay:1.5,blastRadius:96,
    desc:'Indirect fire team. Drops marked shells on your predicted position — keep moving.'
  },
  {
    id:'sapper',name:'Sapper Cell',ai:'kamikaze',render:'sapper',tier:3,weight:4,
    hp:44,speed:228,damage:44,radius:12,xp:15,credits:3,armor:0,color:'#ffa14f',
    fuse:.85,blastRadius:104,
    desc:'Suicide charge team. Sprints in, lights up, and detonates. Kill it early or leave.'
  },
  {
    id:'warden',name:'Aegis Warden',ai:'guardian',render:'warden',tier:4,weight:3,
    hp:190,speed:118,damage:18,radius:16,xp:29,credits:8,armor:12,color:'#7fd8c4',
    machine:true,shieldRadius:170,shieldAmount:.55,
    desc:'Projects a damage-reduction dome over nearby hostiles. Priority target.'
  },
  {
    id:'phantomcell',name:'Phantom Cell',ai:'blinker',render:'veil',tier:4,weight:3,
    hp:88,speed:202,damage:24,radius:12,xp:25,credits:6,armor:3,color:'#b58cff',
    blinkInterval:2.6,blinkRange:260,
    desc:'Experimental displacement infantry. Teleports around cover and behind you.'
  }
];

export const ELITES=[
  {
    id:'nullhunter',name:'Null Hunter',base:'hunter',ai:'diveBomber',render:'drone',
    hpMult:7,damageMult:2,speedMult:1.2,radiusMult:1.5,xp:40,credits:26,jp:3,color:'#ff6d65',
    modifiers:['splitOnDeath'],
    desc:'Elite interceptor. Splits into two smaller drones when destroyed.'
  },
  {
    id:'ironvicar',name:'Iron Vicar',base:'breacher',ai:'juggernaut',render:'heavy',
    hpMult:9,damageMult:1.8,speedMult:1.05,radiusMult:1.5,xp:46,credits:30,jp:4,color:'#ff8b68',
    modifiers:['shockwaveOnCharge','armored'],
    desc:'Elite breacher. Its charge terminates in a ground-shattering shockwave.'
  },
  {
    id:'signalwarden',name:'Signal Warden',base:'jammer',ai:'support',render:'jammer',
    hpMult:6,damageMult:1.4,speedMult:1.1,radiusMult:1.4,xp:42,credits:28,jp:3,color:'#c895ff',
    modifiers:['summonsEscort','jamsHud'],
    desc:'Elite electronic warfare platform. Calls escorts and corrupts your HUD.'
  },
  {
    id:'glasshound',name:'Glass Hound',base:'crawler',ai:'swarmer',render:'crawler',
    hpMult:5,damageMult:1.9,speedMult:1.5,radiusMult:1.5,xp:38,credits:24,jp:3,color:'#77e6ff',
    modifiers:['leapAttack','fragile'],
    desc:'Elite pursuit unit. Extremely fast, extremely aggressive, not especially durable.'
  },
  {
    id:'redauditor',name:'Red Auditor',base:'rifle',ai:'sniper',render:'sniper',
    hpMult:7,damageMult:2.2,speedMult:1.1,radiusMult:1.4,xp:44,credits:32,jp:4,color:'#ff535b',
    modifiers:['markTarget','suppressiveFire'],
    desc:'Elite marksman. Marks you for the entire hostile force before it fires.'
  },
  {
    id:'palewitness',name:'Pale Witness',base:'veil',ai:'ambusher',render:'veil',
    hpMult:6,damageMult:2.4,speedMult:1.35,radiusMult:1.35,xp:48,credits:34,jp:5,color:'#e6e0ff',
    modifiers:['permacloak','teleportStrike'],
    desc:'Elite infiltrator. Effectively invisible until the moment it is already on you.'
  }
];

export const ENEMIES_BY_ID=Object.fromEntries(ENEMIES.map(e=>[e.id,e]));
export const ELITES_BY_ID=Object.fromEntries(ELITES.map(e=>[e.id,e]));

// Status effects the simulation can apply to enemies (and a few to the player).
export const STATUS_EFFECTS={
  burn:{name:'Burning',color:'#ff8a4c',duration:3,tickDamage:6,tickInterval:.5,stacks:5},
  shock:{name:'Shocked',color:'#8fd8ff',duration:1.6,slow:.75,stunMachines:true,stacks:1},
  corrode:{name:'Corroded',color:'#b6ff8a',duration:5,armorShred:.5,damageTaken:.2,stacks:3},
  slow:{name:'Slowed',color:'#9bc8ff',duration:2.5,slow:.45,stacks:1},
  mark:{name:'Marked',color:'#ff5b7a',duration:6,damageTaken:.25,stacks:1},
  freeze:{name:'Frozen',color:'#c8f0ff',duration:1.2,slow:.95,stacks:1}
};
