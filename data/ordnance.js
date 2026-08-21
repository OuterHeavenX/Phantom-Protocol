// Secondary fire.
//
// An ordnance module fitted to the primary weapon, fired on its own input and
// its own cooldown. Modules are universal rather than per-weapon: eighteen
// weapons across seventeen firing behaviours would have meant eighteen bespoke
// alternate fires to author and balance, and most of them would have been the
// same three ideas wearing different names. One module fits any weapon, so the
// choice is a real one — the operative picks what their primary *lacks*.
//
// Every module is built from spawn helpers the engine already has. None of them
// needs new simulation code, which is also what keeps them off the hot path:
// a module fires a handful of times a minute, not sixty times a second.

export const ORDNANCE=[
  {
    id:'breach',name:'Breach Charge',short:'BRC',icon:'✸',
    desc:'A lobbed charge that detonates on contact. Answers a doorway full of contacts.',
    cooldown:9,
    // Scales off the weapon's damage so a module stays relevant late, rather
    // than becoming a rounding error by minute twenty.
    damageScale:3.2,radius:132,
    tags:['BLAST','LOBBED']
  },
  {
    id:'scatter',name:'Scatter Burst',short:'SCT',icon:'⁘',
    desc:'A close cone of shot. For when something has already closed the distance.',
    cooldown:6,
    damageScale:.85,pellets:9,spread:.78,range:280,
    tags:['CONE','POINT BLANK']
  },
  {
    id:'overload',name:'Overload Coil',short:'OVL',icon:'◎',
    desc:'Vents the weapon core into a shockwave. Clears a circle and buys a step back.',
    cooldown:11,
    damageScale:1.9,radius:190,knockback:420,
    tags:['SHOCKWAVE','KNOCKBACK']
  },
  {
    id:'lance',name:'Rail Lance',short:'LNC',icon:'↑',
    desc:'One overcharged round that keeps going. Punches a line through a corridor.',
    cooldown:8,
    damageScale:4.5,pierce:99,speed:1500,
    tags:['PIERCING','LINE']
  },
  {
    id:'marker',name:'Marker Round',short:'MRK',icon:'◈',
    desc:'Paints whatever it hits. Marked targets take markedly more from everything.',
    cooldown:7,
    damageScale:1.1,markDuration:6,markMult:1.45,radius:120,
    tags:['DEBUFF','AREA']
  },
  {
    id:'anchor',name:'Anchor Mine',short:'ANC',icon:'⊗',
    desc:'Drops a charge at the operative’s feet, armed and waiting. For leaving somewhere behind.',
    cooldown:10,
    damageScale:2.6,radius:150,fuse:1.1,
    tags:['MINE','TRAP']
  }
];

export const ORDNANCE_BY_ID=Object.fromEntries(ORDNANCE.map(o=>[o.id,o]));

// Modules unlock against account command rating, so the choice widens as the
// operator does rather than arriving all at once at induction.
export const ORDNANCE_UNLOCK={breach:0,scatter:0,overload:4,lance:8,marker:12,anchor:16};

export function ordnanceUnlocked(id,accountLevel=0){
  return (ORDNANCE_UNLOCK[id]??0)<=accountLevel;
}
