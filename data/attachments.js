// Gunsmith: attachment registry.
//
// Every weapon carries seven slots. Attachments are unlocked by that weapon's
// own field experience, which accrues account-wide rather than per operative —
// a barrel earned on the Needle-7 is on the Needle-7 for everyone who carries
// it.
//
// Effects are declared as `mult` (multiplied into the resolved stat) and `add`
// (added after). They are applied at WeaponInstance.stat, which is the single
// point every weapon stat in the simulation resolves through, so an attachment
// affects a railshot and an orbiting drone by the same rule.
//
// Almost everything carries a drawback. A slot the player can fill with a pure
// upgrade is a slot with one correct answer.

export const MAX_WEAPON_RANK=20;

// Cumulative experience needed to reach a rank.
export function rankForXp(xp=0){
  let rank=1;
  while(rank<MAX_WEAPON_RANK&&xp>=xpForRank(rank+1))rank++;
  return rank;
}
export function xpForRank(rank){
  if(rank<=1)return 0;
  return Math.round(130*Math.pow(rank-1,1.55));
}
export function rankProgress(xp=0){
  const rank=rankForXp(xp);
  if(rank>=MAX_WEAPON_RANK)return{rank,current:1,needed:1,pct:1,max:true};
  const floor=xpForRank(rank),ceiling=xpForRank(rank+1);
  return{rank,current:xp-floor,needed:ceiling-floor,pct:(xp-floor)/(ceiling-floor),max:false};
}

// Slot labels change with the weapon's category so a drone does not carry a
// "muzzle brake" and a monofilament whip does not carry a "magazine".
export const SLOTS=[
  {id:'optic',order:0,labels:{firearm:'OPTIC',tech:'SENSOR',melee:'TARGETING',explosive:'SIGHT',experimental:'ARRAY'}},
  {id:'barrel',order:1,labels:{firearm:'BARREL',tech:'EMITTER',melee:'EDGE',explosive:'TUBE',experimental:'CONDUIT'}},
  {id:'muzzle',order:2,labels:{firearm:'MUZZLE',tech:'FOCUS',melee:'TIP',explosive:'VENT',experimental:'APERTURE'}},
  {id:'underbarrel',order:3,labels:{firearm:'UNDERBARREL',tech:'MOUNT',melee:'GRIP',explosive:'BIPOD',experimental:'HARNESS'}},
  {id:'magazine',order:4,labels:{firearm:'MAGAZINE',tech:'CELL',melee:'RESERVOIR',explosive:'PAYLOAD',experimental:'FEED'}},
  {id:'stock',order:5,labels:{firearm:'STOCK',tech:'GYRO',melee:'BALANCE',explosive:'BRACE',experimental:'FRAME'}},
  {id:'tuning',order:6,labels:{firearm:'INTERNAL TUNING'}}
];

export const SLOTS_BY_ID=Object.fromEntries(SLOTS.map(s=>[s.id,s]));

export function slotLabel(slotId,category='firearm'){
  const slot=SLOTS_BY_ID[slotId];
  if(!slot)return slotId.toUpperCase();
  return slot.labels[category]||slot.labels.firearm;
}

// `only` restricts an attachment to certain weapon categories; omitted means
// it fits everything. `optic` entries additionally declare how they change
// target acquisition, which the runtime reads directly.
export const ATTACHMENTS=[
  // ---- Optics ------------------------------------------------------------
  {
    id:'ironsight',slot:'optic',rank:1,name:'Iron Sights',short:'IRN',
    desc:'Factory sights. No magnification, nothing to snag, nothing to fail.',
    mult:{},add:{}
  },
  {
    id:'reddot',slot:'optic',rank:2,name:'Reflex Red Dot',short:'RDS',
    desc:'Unmagnified reflex sight. Faster on target, tighter grouping.',
    mult:{spread:.62,cooldown:.96},add:{},
    optic:{reticle:'dot',acquisition:1.08}
  },
  {
    id:'holo',slot:'optic',rank:5,name:'Holographic Sight',short:'HOL',
    desc:'Wide holographic reticle. Reads the whole engagement rather than one contact.',
    mult:{spread:.7},add:{critChance:.03},
    optic:{reticle:'holo',acquisition:1.22}
  },
  {
    id:'thermal',slot:'optic',rank:9,name:'Thermal Scope',short:'THM',
    desc:'Thermal overlay. Marks the acquired contact and reaches well past open sights.',
    mult:{range:1.28,spread:.55,cooldown:1.06},add:{},
    optic:{reticle:'thermal',acquisition:1.35,marks:true}
  },
  {
    id:'variable',slot:'optic',rank:14,name:'Variable Ranging Optic',short:'VRO',
    desc:'Long-range glass. Hits harder at distance and pulls the camera back to use it.',
    mult:{range:1.45,damage:1.12,cooldown:1.14,spread:.5},add:{},
    optic:{reticle:'crosshair',acquisition:1.5,marks:true,zoom:.94}
  },

  // ---- Barrels -----------------------------------------------------------
  {
    id:'standardbarrel',slot:'barrel',rank:1,name:'Standard Barrel',short:'STD',
    desc:'Issue length. Balanced, unremarkable, reliable.',
    mult:{},add:{}
  },
  {
    id:'shortbarrel',slot:'barrel',rank:3,name:'Cut-Down Barrel',short:'CUT',
    desc:'Shortened for close work. Comes up faster, gives away reach.',
    mult:{cooldown:.86,range:.8,spread:1.2},add:{}
  },
  {
    id:'heavybarrel',slot:'barrel',rank:6,name:'Heavy Profile Barrel',short:'HVY',
    desc:'Thicker profile. More weight behind every round, slower between them.',
    mult:{damage:1.16,range:1.15,cooldown:1.1},add:{}
  },
  {
    id:'rifledbarrel',slot:'barrel',rank:10,name:'Match Rifled Barrel',short:'MCH',
    desc:'Precision rifling. Tight, fast, and unforgiving of a poor mount.',
    mult:{spread:.55,speed:1.2,damage:1.06},add:{},
    only:['firearm','explosive','experimental']
  },
  {
    id:'ventedbarrel',slot:'barrel',rank:13,name:'Vented Assembly',short:'VNT',
    desc:'Aggressive porting. Sustains fire at the cost of stopping power.',
    mult:{cooldown:.78,damage:.92},add:{}
  },

  // ---- Muzzles -----------------------------------------------------------
  {
    id:'nomuzzle',slot:'muzzle',rank:1,name:'Bare Crown',short:'—',
    desc:'Nothing fitted. Nothing added, nothing lost.',
    mult:{},add:{}
  },
  {
    id:'compensator',slot:'muzzle',rank:4,name:'Compensator',short:'CMP',
    desc:'Redirects gas upward. Keeps a burst on target.',
    mult:{spread:.68},add:{}
  },
  {
    id:'brake',slot:'muzzle',rank:7,name:'Muzzle Brake',short:'BRK',
    desc:'Harsh but effective. More authority per hit, wider grouping.',
    mult:{damage:1.1,knockback:1.35,spread:1.18},add:{}
  },
  {
    id:'suppressor',slot:'muzzle',rank:11,name:'Suppressor',short:'SUP',
    desc:'Subsonic loadout. Hostiles take longer to work out where you are.',
    mult:{damage:.95},add:{},
    field:{detection:-.28}
  },
  {
    id:'flashhider',slot:'muzzle',rank:15,name:'Directional Hider',short:'FLH',
    desc:'Signature management with a velocity bias.',
    mult:{speed:1.25,spread:.85},add:{},
    field:{detection:-.12}
  },

  // ---- Underbarrel -------------------------------------------------------
  {
    id:'nogrip',slot:'underbarrel',rank:1,name:'No Attachment',short:'—',
    desc:'Rail left clear.',
    mult:{},add:{}
  },
  {
    id:'vertgrip',slot:'underbarrel',rank:3,name:'Vertical Grip',short:'VRT',
    desc:'Straight purchase. Steadies everything, adds nothing.',
    mult:{spread:.74},add:{}
  },
  {
    id:'anglegrip',slot:'underbarrel',rank:8,name:'Angled Grip',short:'ANG',
    desc:'Rolls the weapon onto target sooner.',
    mult:{cooldown:.9,spread:1.08},add:{}
  },
  {
    id:'bipod',slot:'underbarrel',rank:12,name:'Folding Bipod',short:'BIP',
    desc:'Braced for reach. Excellent when you can afford to stand still.',
    mult:{range:1.22,damage:1.08,moveSpeed:.96},add:{}
  },
  {
    id:'laser',slot:'underbarrel',rank:16,name:'Target Designator',short:'LAS',
    desc:'Paints the acquired contact. Everything you fire lands closer to where you meant.',
    mult:{spread:.6},add:{critChance:.05},
    optic:{acquisition:1.15}
  },

  // ---- Magazine ----------------------------------------------------------
  {
    id:'standardmag',slot:'magazine',rank:1,name:'Standard Feed',short:'STD',
    desc:'Issue capacity.',
    mult:{},add:{}
  },
  {
    id:'extendedmag',slot:'magazine',rank:4,name:'Extended Feed',short:'EXT',
    desc:'More rounds down range per cycle, at some cost to control.',
    mult:{spread:1.12},add:{count:1}
  },
  {
    id:'hollowpoint',slot:'magazine',rank:7,name:'Fragmenting Rounds',short:'FRG',
    desc:'Deforming projectiles. Devastating on contact, poor against plate.',
    mult:{damage:1.18,pierce:0},add:{},
    penalty:{armorPiercing:-1}
  },
  {
    id:'ap',slot:'magazine',rank:10,name:'Armour-Piercing Rounds',short:'AP',
    desc:'Hardened penetrators. Punch through a line rather than stopping at it.',
    mult:{damage:.94},add:{pierce:1}
  },
  {
    id:'overpressure',slot:'magazine',rank:17,name:'Overpressure Loads',short:'OVP',
    desc:'Loaded past specification. Hits far harder and heats the weapon doing it.',
    mult:{damage:1.3,cooldown:1.18},add:{}
  },

  // ---- Stock -------------------------------------------------------------
  {
    id:'standardstock',slot:'stock',rank:1,name:'Fixed Stock',short:'FIX',
    desc:'Issue furniture.',
    mult:{},add:{}
  },
  {
    id:'lightstock',slot:'stock',rank:5,name:'Skeleton Stock',short:'SKL',
    desc:'Stripped for weight. Move better, hold worse.',
    mult:{spread:1.15},add:{moveSpeed:.04}
  },
  {
    id:'heavystock',slot:'stock',rank:9,name:'Weighted Stock',short:'WGT',
    desc:'Mass where it steadies the shot. Slower on your feet.',
    mult:{spread:.7,damage:1.06},add:{moveSpeed:-.03}
  },
  {
    id:'recoilpad',slot:'stock',rank:13,name:'Recoil Buffer',short:'BUF',
    desc:'Absorbs the cycle. Faster follow-up without losing the group.',
    mult:{cooldown:.9,spread:.92},add:{}
  },
  {
    id:'gyrostock',slot:'stock',rank:18,name:'Stabiliser Gyro',short:'GYR',
    desc:'Active stabilisation. Holds the weapon steady while you keep moving.',
    mult:{spread:.62},add:{moveSpeed:.02},
    only:['tech','experimental','firearm']
  },

  // ---- Internal tuning ---------------------------------------------------
  {
    id:'stocktune',slot:'tuning',rank:1,name:'Factory Specification',short:'FAC',
    desc:'Left as delivered.',
    mult:{},add:{}
  },
  {
    id:'triggerjob',slot:'tuning',rank:6,name:'Match Trigger',short:'TRG',
    desc:'Lighter break. Fires sooner, forgives less.',
    mult:{cooldown:.88,spread:1.1},add:{}
  },
  {
    id:'boredout',slot:'tuning',rank:11,name:'Bored Chamber',short:'BOR',
    desc:'Opened up for volume. More on target, less reach.',
    mult:{damage:1.14,range:.9},add:{}
  },
  {
    id:'coolant',slot:'tuning',rank:15,name:'Coolant Loop',short:'CLT',
    desc:'Thermal bleed. Sustains a rate of fire the frame should not allow.',
    mult:{cooldown:.82},add:{},
    penalty:{}
  },
  {
    id:'calibrated',slot:'tuning',rank:19,name:'Calibrated Internals',short:'CAL',
    desc:'Every tolerance closed by hand. Better at everything, and it took twenty operations to earn.',
    mult:{damage:1.08,spread:.88,cooldown:.94},add:{}
  }
];

export const ATTACHMENTS_BY_ID=Object.fromEntries(ATTACHMENTS.map(a=>[a.id,a]));

// Attachments legal for a weapon, in unlock order.
export function attachmentsFor(slotId,category){
  return ATTACHMENTS.filter(a=>
    a.slot===slotId&&(!a.only||a.only.includes(category))
  ).sort((a,b)=>a.rank-b.rank);
}

// The rank-1 entry of a slot, which is always the "nothing fitted" option.
export function defaultAttachment(slotId,category){
  return attachmentsFor(slotId,category)[0]||null;
}

export function defaultBuild(weapon){
  const build={};
  for(const slot of SLOTS){
    const entry=defaultAttachment(slot.id,weapon.category);
    if(entry)build[slot.id]=entry.id;
  }
  return build;
}
