// Weapon liveries.
//
// The roadmap called for camouflage. It cannot work here: the weapon is drawn
// as a 15x3.2 world-unit sliver — about forty by nine device pixels at desktop
// zoom — in two flat colours, rotating with the operative, under an additive
// lighting pass. There is no surface to put a pattern on, and a charm would be
// sub-pixel.
//
// What is visible at that camera is the thing leaving the barrel. Projectiles
// are the most-looked-at object on screen, their colour already drives the
// trail and the impact spark, and it reads at any zoom on any device. So a
// livery is a small named palette rather than a texture: the tracer, and the
// tint of the weapon in the operative's hands.
//
// Earned against weapon rank, fitted per weapon, purely cosmetic — no livery
// touches a stat, so none of them can be a balance decision wearing a hat.

export const LIVERIES=[
  {
    id:'issue',name:'Standard Issue',short:'STD',rank:0,
    desc:'Factory finish. Whatever the armoury handed you.',
    // A null tracer means "leave the behaviour's own colour alone", which is
    // what keeps the default loadout looking exactly as it always has.
    tracer:null,body:null,swatch:'#ffe08a'
  },
  {
    id:'ember',name:'Ember',short:'EMB',rank:3,
    desc:'Rounds burn orange the whole way out.',
    tracer:'#ff9a4d',body:'#c96a2e',swatch:'#ff9a4d'
  },
  {
    id:'glacier',name:'Glacier',short:'GLC',rank:6,
    desc:'Cold white tracers. Reads clean against a dark theatre.',
    tracer:'#dff4ff',body:'#8fb6c9',swatch:'#dff4ff'
  },
  {
    id:'venom',name:'Venom',short:'VNM',rank:9,
    desc:'Acid green. Unsubtle, and meant to be.',
    tracer:'#a8f04a',body:'#5f8f2c',swatch:'#a8f04a'
  },
  {
    id:'arterial',name:'Arterial',short:'ART',rank:13,
    desc:'Deep red. The theatre already has the palette for it.',
    tracer:'#ff5a5a',body:'#9c2f2f',swatch:'#ff5a5a'
  },
  {
    id:'signal',name:'Signal',short:'SIG',rank:17,
    desc:'The channel colour. Worn by operatives who read the whole disclosure.',
    tracer:'#76e7d4',body:'#2f7d74',swatch:'#76e7d4'
  }
];

export const LIVERIES_BY_ID=Object.fromEntries(LIVERIES.map(l=>[l.id,l]));

export function liveryUnlocked(livery,rank=0){
  return (livery?.rank??0)<=rank;
}

// Resolve a stored id to a livery, falling back to standard issue rather than
// to nothing — a weapon always has a finish, even if it is the default one.
export function liveryFor(id){
  return LIVERIES_BY_ID[id]||LIVERIES[0];
}
