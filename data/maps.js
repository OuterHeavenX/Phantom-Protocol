// Theatre definitions. Each map carries a full render palette, a procedural
// layout generator profile, environmental hazards and its own enemy weighting
// so theatres actually play differently rather than only recolouring.

export const MAPS=[
  {
    id:'blacksite',name:'BLACKSITE ZERO',condition:'Subterranean research complex',
    desc:'Tight interior grid. Heavy cover, short sightlines, close-quarters pressure.',
    music:'blacksite',
    palette:{
      floor:'#0c1f26',floorAlt:'#0e2630',grid:'rgba(118,231,212,.055)',
      wall:'#1a3138',wallEdge:'#4e7d84',accent:'#76e7d4',hazard:'#ffb35c',
      fog:'rgba(2,8,12,.55)',light:'rgba(118,231,212,.10)'
    },
    layout:{type:'complex',density:.78,coverDensity:1.15,roomSize:[220,420],corridorWidth:110},
    hazards:['steamVent','electricFloor'],
    enemyBias:{scout:1.2,rifle:1.2,shield:1.3,crawler:1.2,sniper:.7,mortar:.6},
    boss:'manticore',
    unlocked:true,unlock:null
  },
  {
    id:'arctic',name:'ARCTIC RELAY',condition:'Cryogenic communications base',
    desc:'Open ice fields with sparse structures. Long sightlines favour marksmen on both sides.',
    music:'arctic',
    palette:{
      floor:'#132b38',floorAlt:'#17323f',grid:'rgba(180,225,255,.06)',
      wall:'#22414f',wallEdge:'#7fb4c6',accent:'#8fd8ff',hazard:'#c8f0ff',
      fog:'rgba(12,26,38,.5)',light:'rgba(143,216,255,.12)'
    },
    layout:{type:'open',density:.42,coverDensity:.7,roomSize:[380,700],corridorWidth:210},
    hazards:['iceSlick','blizzard'],
    enemyBias:{sniper:1.6,mortar:1.4,rifle:1.2,pursuit:1.2,shield:.7,crawler:.7},
    boss:'carrion',
    unlocked:true,unlock:null
  },
  {
    id:'sunken',name:'SUNKEN DISTRICT',condition:'Flooded coastal exclusion zone',
    desc:'Waterlogged streets. Shallow water slows movement and conducts electrical damage.',
    music:'sunken',
    palette:{
      floor:'#0a2b2d',floorAlt:'#0d3437',grid:'rgba(118,231,212,.05)',
      wall:'#14383a',wallEdge:'#4f8f8a',accent:'#6fe0c8',hazard:'#ffe08a',
      fog:'rgba(3,18,20,.55)',light:'rgba(111,224,200,.1)'
    },
    layout:{type:'streets',density:.62,coverDensity:.95,roomSize:[260,520],corridorWidth:150},
    hazards:['floodWater','collapsingFloor'],
    enemyBias:{crawler:1.4,veil:1.4,sapper:1.3,scout:1.1,breacher:.8},
    boss:'aegis',
    unlocked:true,unlock:null
  },
  {
    id:'foundry',name:'CINDER FOUNDRY',condition:'Active munitions manufacturing plant',
    desc:'Working industrial floor. Molten channels and moving machinery hurt everything equally.',
    music:'foundry',
    palette:{
      floor:'#241716',floorAlt:'#2c1c19',grid:'rgba(255,150,90,.06)',
      wall:'#3a231f',wallEdge:'#a86a4a',accent:'#ff9a5c',hazard:'#ff5b30',
      fog:'rgba(20,8,6,.5)',light:'rgba(255,140,70,.14)'
    },
    layout:{type:'industrial',density:.85,coverDensity:1.3,roomSize:[200,380],corridorWidth:96},
    hazards:['moltenChannel','pressRam','steamVent'],
    enemyBias:{breacher:1.5,marauder:1.4,shield:1.2,sapper:1.2,sniper:.6},
    boss:'aegis',
    unlocked:false,
    unlock:{type:'stat',stat:'wins',value:3,label:'Complete 3 operations'}
  },
  {
    id:'orbital',name:'MERIDIAN PLATFORM',condition:'Decommissioned orbital transfer station',
    desc:'Low-gravity modular decks. Vacuum breaches vent anything standing in the wrong section.',
    music:'orbital',
    palette:{
      floor:'#12141f',floorAlt:'#171a28',grid:'rgba(200,180,255,.06)',
      wall:'#232538',wallEdge:'#8f8ec6',accent:'#c895ff',hazard:'#ff5b7a',
      fog:'rgba(6,6,14,.6)',light:'rgba(200,149,255,.12)'
    },
    layout:{type:'modular',density:.7,coverDensity:1,roomSize:[240,460],corridorWidth:120},
    hazards:['vacuumBreach','lowGravity'],
    enemyBias:{pursuit:1.5,hunter:1.4,phantomcell:1.5,warden:1.3,breacher:.7},
    boss:'arbiter',
    unlocked:false,
    unlock:{type:'stat',stat:'bosses',value:6,label:'Defeat 6 command signatures'}
  }
];

export const MAPS_BY_ID=Object.fromEntries(MAPS.map(m=>[m.id,m]));

export const HAZARDS={
  steamVent:{name:'Steam Vent',damage:16,interval:6.5,radius:56,warn:1,color:'#dff5f2',affectsEnemies:true},
  electricFloor:{name:'Live Floor',damage:12,interval:7.5,radius:88,warn:1.2,color:'#8fd8ff',status:'shock',affectsEnemies:true},
  iceSlick:{name:'Ice Slick',damage:0,radius:120,friction:.35,color:'#c8f0ff',passive:true},
  blizzard:{name:'Whiteout',damage:0,visibility:.7,color:'#e8f6ff',global:true},
  floodWater:{name:'Floodwater',damage:0,radius:150,slow:.35,color:'#4f8f8a',passive:true,conducts:true},
  collapsingFloor:{name:'Collapsing Deck',damage:28,interval:11,radius:110,warn:1.7,color:'#ffb35c',affectsEnemies:true},
  moltenChannel:{name:'Molten Channel',damage:9,interval:.6,radius:70,color:'#ff5b30',status:'burn',passive:true,affectsEnemies:true},
  pressRam:{name:'Press Ram',damage:58,interval:8.5,radius:96,warn:1.4,color:'#ff9a5c',affectsEnemies:true},
  vacuumBreach:{name:'Vacuum Breach',damage:24,interval:9.5,radius:170,warn:2,color:'#c895ff',pull:340,affectsEnemies:true},
  lowGravity:{name:'Low Gravity',damage:0,global:true,knockbackMult:2.2,frictionMult:.6,color:'#c895ff'}
};

export const DURATIONS=[
  {minutes:5,label:'5 MINUTES',tag:'PROBE',jpMult:.6,desc:'Fast reconnaissance contract. One command signature at the close.'},
  {minutes:10,label:'10 MINUTES',tag:'STANDARD',jpMult:1,desc:'Standard operation length. Balanced escalation curve.'},
  {minutes:15,label:'15 MINUTES',tag:'EXTENDED',jpMult:1.5,desc:'Extended contract. Miniboss encounters begin appearing.'},
  {minutes:20,label:'20 MINUTES',tag:'DEEP',jpMult:2.1,desc:'Deep insertion. Two command signatures and sustained elite pressure.'},
  {minutes:25,label:'25 MINUTES',tag:'PROLONGED',jpMult:2.8,desc:'Prolonged denial operation. Hostile density approaches saturation.'},
  {minutes:30,label:'30 MINUTES',tag:'ENDURANCE',jpMult:3.6,desc:'Full endurance contract. Everything the theatre has, in order.'}
];

export const DIFFICULTIES=[
  {id:0,name:'RECRUIT',hpMult:.75,damageMult:.7,densityMult:.8,speedMult:.92,jpMult:.7,xpMult:1.15,
   desc:'Training parameters. Reduced hostile durability and output.',unlocked:true},
  {id:1,name:'OPERATIVE',hpMult:1,damageMult:1,densityMult:1,speedMult:1,jpMult:1,xpMult:1,
   desc:'Standard field conditions.',unlocked:true},
  {id:2,name:'VETERAN',hpMult:1.4,damageMult:1.3,densityMult:1.25,speedMult:1.06,jpMult:1.4,xpMult:.95,
   desc:'Hardened response. Hostiles are tougher, faster and more numerous.',
   unlock:{type:'stat',stat:'wins',value:1,label:'Complete 1 operation'}},
  {id:3,name:'GHOST',hpMult:2,damageMult:1.7,densityMult:1.5,speedMult:1.12,jpMult:2,xpMult:.9,
   desc:'Full counter-operative doctrine. Elites spawn from the opening minute.',
   unlock:{type:'stat',stat:'wins',value:5,label:'Complete 5 operations'}},
  {id:4,name:'NIGHTMARE',hpMult:3,damageMult:2.2,densityMult:1.85,speedMult:1.2,jpMult:3,xpMult:.85,
   desc:'No margin. Hostile reinforcement is effectively unlimited.',
   unlock:{type:'stat',stat:'bosses',value:10,label:'Defeat 10 command signatures'}},
  {id:5,name:'ARBITRATION',hpMult:4.5,damageMult:3,densityMult:2.3,speedMult:1.3,jpMult:4.5,xpMult:.8,
   desc:'The network is running the engagement directly. It does not intend for you to leave.',
   unlock:{type:'stat',stat:'nightmareWins',value:1,label:'Clear an operation on NIGHTMARE'}}
];

export const DIFFICULTIES_BY_ID=Object.fromEntries(DIFFICULTIES.map(d=>[d.id,d]));
