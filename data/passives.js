// Passive registry. Each passive contributes to the aggregated stat block the
// combat runtime reads every frame — no passive here is cosmetic.
//
// `stat` keys resolve against the player's derived stat table:
//   damage, fireRate, area, projectileSpeed, duration, amount (extra shots),
//   maxHp, armor, regen, moveSpeed, magnet, xpGain, luck, cooldown,
//   critChance, critDamage, dodge, lifesteal, revives

export const MAX_PASSIVE_LEVEL=6;
export const MAX_PASSIVE_SLOTS=6;

export const PASSIVES=[
  {
    id:'optics',name:'Targeting Optics',short:'OPT',icon:'◎',
    desc:'Fire-control overlay. Increases all weapon damage.',
    stat:'damage',perLevel:.10,format:v=>`+${Math.round(v*100)}% damage`
  },
  {
    id:'plating',name:'Armored Plating',short:'PLT',icon:'▤',
    desc:'Composite inserts. Reduces incoming damage.',
    stat:'armor',perLevel:2,format:v=>`+${v} armor`
  },
  {
    id:'stimulants',name:'Combat Stimulants',short:'STM',icon:'⚕',
    desc:'Battlefield pharmacology. Increases rate of fire across the loadout.',
    stat:'fireRate',perLevel:.09,format:v=>`+${Math.round(v*100)}% fire rate`
  },
  {
    id:'harness',name:'Tactical Harness',short:'HRN',icon:'✚',
    desc:'Expanded ordnance rig. Increases blast and effect radius.',
    stat:'area',perLevel:.10,format:v=>`+${Math.round(v*100)}% area`
  },
  {
    id:'ammunition',name:'Ammunition Processor',short:'AMM',icon:'⁙',
    desc:'On-board round fabrication. Adds an extra projectile to weapons that fire them.',
    // The runtime rounds the sum of a weapon's base count and this stat, so the
    // label has to round too — flooring it under-reported every other rank.
    // .5 per rank keeps label and runtime in step and stops rank 1 buying
    // nothing: a shotgun already gained a pellet from it, a rifle did not.
    stat:'amount',perLevel:.5,
    format:v=>`+${Math.round(v)} projectile${Math.round(v)===1?'':'s'}`,
    maxLevel:6
  },
  {
    id:'cooling',name:'Cooling System',short:'COO',icon:'❄',
    desc:'Thermal management. Shortens every weapon cooldown.',
    stat:'cooldown',perLevel:-.07,format:v=>`${Math.round(v*100)}% cooldown`
  },
  {
    id:'nanomedical',name:'Nanomedical Kit',short:'NMK',icon:'✜',
    desc:'Autonomous field repair. Regenerates health over time.',
    stat:'regen',perLevel:.55,format:v=>`+${v.toFixed(1)} HP/s`
  },
  {
    id:'amplifier',name:'Signal Amplifier',short:'AMP',icon:'≋',
    desc:'Extends effect duration for beams, mines, turrets and status effects.',
    stat:'duration',perLevel:.13,format:v=>`+${Math.round(v*100)}% duration`
  },
  {
    id:'loader',name:'Magnetic Loader',short:'LDR',icon:'⇈',
    desc:'Accelerated feed system. Increases projectile velocity.',
    stat:'projectileSpeed',perLevel:.12,format:v=>`+${Math.round(v*100)}% projectile speed`
  },
  {
    id:'mobility',name:'Mobility Frame',short:'MOB',icon:'➤',
    desc:'Powered exo-joints. Increases movement speed.',
    stat:'moveSpeed',perLevel:.07,format:v=>`+${Math.round(v*100)}% move speed`
  },
  {
    id:'ewmodule',name:'EW Module',short:'EWM',icon:'⌁',
    desc:'Electronic warfare suite. Increases critical hit chance.',
    stat:'critChance',perLevel:.05,format:v=>`+${Math.round(v*100)}% crit chance`
  },
  {
    id:'scanner',name:'Field Scanner',short:'SCN',icon:'⊙',
    desc:'Wide-band collection. Increases pickup magnet radius and XP gain.',
    stat:'magnet',perLevel:.22,secondary:{stat:'xpGain',perLevel:.06},
    format:v=>`+${Math.round(v*100)}% magnet, +XP`
  },
  {
    id:'reactor',name:'Reactor Weave',short:'RCW',icon:'✷',
    desc:'Woven power core. Increases maximum health.',
    stat:'maxHp',perLevel:22,format:v=>`+${v} max HP`
  },
  {
    id:'phaseweave',name:'Phase Weave',short:'PHW',icon:'◇',
    desc:'Probabilistic displacement. Grants a chance to avoid incoming damage entirely.',
    stat:'dodge',perLevel:.05,format:v=>`+${Math.round(v*100)}% dodge`
  },
  {
    id:'vampiric',name:'Hemostat Loop',short:'HML',icon:'♥',
    desc:'Recovers a fraction of damage dealt as health.',
    stat:'lifesteal',perLevel:.012,format:v=>`+${(v*100).toFixed(1)}% lifesteal`
  },
  {
    id:'auditor',name:'Requisition Auditor',short:'AUD',icon:'$',
    desc:'Improves drop quality and credit yield from every source.',
    stat:'luck',perLevel:.12,format:v=>`+${Math.round(v*100)}% luck`
  }
];

export const PASSIVES_BY_ID=Object.fromEntries(PASSIVES.map(p=>[p.id,p]));

// Baseline derived stats before operatives, passives and meta upgrades apply.
// Baseline stat block every operative starts from, before operative profile,
// passives, mastery and development-tree bonuses are folded in.
//
// `damage` sits above 1.0 deliberately. Measured against the spawn curves, a
// starting weapon delivers well under its nominal DPS once cover, travel time
// and target switching are accounted for, which left the opening minutes
// unable to clear hostiles as fast as they arrived.
export function baseStats(){
  return{
    damage:1.5,fireRate:1,area:1,projectileSpeed:1,duration:1,amount:0,
    maxHp:25,armor:0,regen:0,moveSpeed:1,magnet:1,xpGain:1,luck:1,cooldown:1,
    critChance:.05,critDamage:1.8,dodge:0,lifesteal:0,revives:0
  };
}
