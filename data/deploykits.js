// Field kits.
//
// The deployment rank decides how many pieces of hardware an operative can
// have planted at once and how much punishment each one takes. The kit decides
// what that hardware *does*. Rank and kit are independent on purpose: a rank 3
// operative fielding three snare fields is a different tactical proposition
// from one fielding three sentries, and neither is strictly better.
//
// Only the sentry has a weapon. The other two are unarmed emitters — they do
// nothing on their own and everything when they are put in the right place,
// which is the whole point of giving the player a choice of what to plant.
//
// Every number here is a multiplier on, or an addition to, the rank spec in
// engine.js. Nothing in this file reads save state, so switching kits mid-run
// is free and instant: the cost of the swap is the cooldown already running.

export const DEPLOY_KITS=[
  {
    id:'sentry',name:'SENTRY GUN',short:'SENTRY',color:'#76e7d4',
    desc:'Automated gun. Engages the nearest hostile in range.',
    hpMult:1,cooldownMult:1
  },
  {
    id:'pylon',name:'SHIELD PYLON',short:'PYLON',color:'#8fd8ff',
    desc:'Unarmed. Cuts incoming damage by 40% for anyone inside its field.',
    hpMult:1.6,cooldownMult:1.2,fieldRadius:150,shelter:.4
  },
  {
    id:'snare',name:'SNARE FIELD',short:'SNARE',color:'#c895ff',
    desc:'Unarmed. Drags hostiles inside its field down to half speed.',
    hpMult:.8,cooldownMult:1,fieldRadius:170,slow:.5
  }
];

export const DEPLOY_KITS_BY_ID=Object.fromEntries(DEPLOY_KITS.map(kit=>[kit.id,kit]));

// Wraps in both directions so a cycle button never has to bounds-check.
export const deployKit=index=>
  DEPLOY_KITS[((index%DEPLOY_KITS.length)+DEPLOY_KITS.length)%DEPLOY_KITS.length];
