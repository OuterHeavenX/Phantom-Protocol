// Boss definitions. Each boss is a multi-phase encounter: phases swap in at
// health thresholds, and every phase declares which attack patterns are legal
// plus how aggressively they are chained. Patterns are implemented in
// src/game/boss.js.

export const BOSSES=[
  {
    id:'manticore',name:'MANTICORE SIEGE PLATFORM',render:'manticore',
    title:'Autonomous siege chassis // six-barrel rotary array',
    hp:2600,radius:52,speed:52,armor:14,xp:400,credits:520,jp:32,
    color:'#ff665f',accent:'#ffb35c',
    intro:'Rotary array spinning up. It has already solved the room.',
    phases:[
      {
        at:1,name:'SUPPRESSION',speed:52,
        patterns:[
          {id:'radialBurst',weight:4,cooldown:3.4,bullets:14,speed:250,damage:14},
          {id:'sweepBeam',weight:3,cooldown:5.2,windup:1.1,arc:1.4,damage:26},
          {id:'summonEscort',weight:2,cooldown:9,count:4,unit:'rifle'}
        ]
      },
      {
        at:.65,name:'BOMBARDMENT',speed:64,enrage:1.15,
        patterns:[
          {id:'radialBurst',weight:4,cooldown:2.6,bullets:20,speed:280,damage:16,spiral:true},
          {id:'mortarVolley',weight:4,cooldown:4.2,shells:5,delay:1.2,radius:110,damage:34},
          {id:'chargeSlam',weight:3,cooldown:6,windup:.85,speed:620,damage:38},
          {id:'summonEscort',weight:2,cooldown:11,count:5,unit:'crawler'}
        ]
      },
      {
        at:.3,name:'TERMINAL PROTOCOL',speed:78,enrage:1.4,
        patterns:[
          {id:'radialBurst',weight:5,cooldown:1.9,bullets:26,speed:320,damage:18,spiral:true},
          {id:'sweepBeam',weight:4,cooldown:3.6,windup:.75,arc:2.6,damage:32,beams:2},
          {id:'mortarVolley',weight:4,cooldown:3.2,shells:8,delay:1,radius:120,damage:38},
          {id:'chargeSlam',weight:4,cooldown:4.4,windup:.6,speed:720,damage:44,shockwave:true}
        ]
      }
    ]
  },
  {
    id:'carrion',name:'CARRION ARRAY',render:'carrion',
    title:'Orbital relay node // distributed fire control',
    hp:3400,radius:56,speed:74,armor:10,xp:520,credits:660,jp:38,
    color:'#c895ff',accent:'#8fd8ff',
    intro:'The array is not firing at you. It is telling something else where you are.',
    phases:[
      {
        at:1,name:'TRIANGULATION',speed:74,
        patterns:[
          {id:'spiralWave',weight:4,cooldown:3.8,arms:3,bullets:9,speed:220,damage:15},
          {id:'markedStrike',weight:4,cooldown:4.6,delay:1.4,radius:96,damage:40,count:3},
          {id:'blinkReposition',weight:3,cooldown:5.5,range:340}
        ]
      },
      {
        at:.6,name:'SATURATION',speed:88,enrage:1.2,
        patterns:[
          {id:'spiralWave',weight:5,cooldown:2.8,arms:5,bullets:11,speed:250,damage:17},
          {id:'markedStrike',weight:4,cooldown:3.4,delay:1.1,radius:110,damage:46,count:5},
          {id:'droneCurtain',weight:4,cooldown:7,count:8,unit:'pursuit'},
          {id:'blinkReposition',weight:3,cooldown:4,range:400}
        ]
      },
      {
        at:.28,name:'DENIAL',speed:104,enrage:1.5,
        patterns:[
          {id:'spiralWave',weight:5,cooldown:2,arms:7,bullets:13,speed:290,damage:19,counterRotate:true},
          {id:'markedStrike',weight:5,cooldown:2.4,delay:.9,radius:124,damage:52,count:7},
          {id:'nullField',weight:4,cooldown:8,duration:4,radius:260,damage:12},
          {id:'droneCurtain',weight:3,cooldown:8,count:10,unit:'hunter'}
        ]
      }
    ]
  },
  {
    id:'aegis',name:'AEGIS BREAKER',render:'aegis',
    title:'Counter-operative platform // adaptive shielding',
    hp:4600,radius:60,speed:96,armor:18,xp:680,credits:840,jp:46,
    color:'#ffb35c',accent:'#ff665f',
    intro:'Built to kill people like you. The file says it has done it before.',
    phases:[
      {
        at:1,name:'ASSESSMENT',speed:96,shield:true,
        patterns:[
          {id:'chargeSlam',weight:5,cooldown:3.6,windup:.7,speed:700,damage:36},
          {id:'radialBurst',weight:3,cooldown:4,bullets:16,speed:280,damage:18},
          {id:'shieldCycle',weight:3,cooldown:8,duration:4,reduction:.8}
        ]
      },
      {
        at:.66,name:'ESCALATION',speed:112,enrage:1.25,shield:true,
        patterns:[
          {id:'chargeSlam',weight:5,cooldown:2.8,windup:.55,speed:800,damage:42,shockwave:true},
          {id:'sweepBeam',weight:4,cooldown:4,windup:.8,arc:2.2,damage:34,beams:2},
          {id:'mortarVolley',weight:3,cooldown:4.4,shells:6,delay:1.1,radius:118,damage:40},
          {id:'summonEscort',weight:3,cooldown:9,count:6,unit:'marauder'}
        ]
      },
      {
        at:.32,name:'BREAKER',speed:134,enrage:1.6,
        patterns:[
          {id:'chargeSlam',weight:6,cooldown:2,windup:.4,speed:940,damage:50,shockwave:true},
          {id:'sweepBeam',weight:5,cooldown:3,windup:.55,arc:3.1,damage:40,beams:3},
          {id:'spiralWave',weight:4,cooldown:2.4,arms:6,bullets:12,speed:320,damage:22,counterRotate:true},
          {id:'nullField',weight:4,cooldown:7,duration:5,radius:300,damage:16}
        ]
      }
    ]
  },
  {
    id:'arbiter',name:'THE ARBITER',render:'arbiter',
    title:'Unregistered // origin classified',
    hp:7200,radius:64,speed:120,armor:22,xp:1200,credits:1500,jp:80,
    color:'#e0e6ea',accent:'#ff5b7a',
    intro:'It is running your own tactical profile. Every counter you have is already in the model.',
    finalBoss:true,
    phases:[
      {
        at:1,name:'MIRROR',speed:120,
        patterns:[
          {id:'mirrorFire',weight:5,cooldown:2.4,damage:26},
          {id:'blinkReposition',weight:4,cooldown:3.2,range:420},
          {id:'radialBurst',weight:3,cooldown:3.6,bullets:22,speed:300,damage:22,spiral:true}
        ]
      },
      {
        at:.7,name:'PREDICTION',speed:138,enrage:1.2,
        patterns:[
          {id:'mirrorFire',weight:5,cooldown:1.8,damage:30},
          {id:'markedStrike',weight:5,cooldown:2.6,delay:.85,radius:120,damage:54,count:6,predictive:true},
          {id:'sweepBeam',weight:4,cooldown:3.2,windup:.6,arc:2.8,damage:38,beams:3},
          {id:'summonEscort',weight:3,cooldown:8,count:6,unit:'phantomcell'}
        ]
      },
      {
        at:.4,name:'INSTRUCTION',speed:156,enrage:1.45,
        patterns:[
          {id:'spiralWave',weight:5,cooldown:1.7,arms:8,bullets:14,speed:340,damage:26,counterRotate:true},
          {id:'chargeSlam',weight:5,cooldown:2.2,windup:.35,speed:1000,damage:56,shockwave:true},
          {id:'nullField',weight:4,cooldown:6,duration:5,radius:320,damage:20},
          {id:'markedStrike',weight:5,cooldown:2,delay:.7,radius:130,damage:60,count:8,predictive:true}
        ]
      },
      {
        at:.15,name:'ARBITRATION',speed:180,enrage:1.9,
        patterns:[
          {id:'mirrorFire',weight:6,cooldown:1.1,damage:38},
          {id:'spiralWave',weight:6,cooldown:1.3,arms:10,bullets:16,speed:380,damage:30,counterRotate:true},
          {id:'chargeSlam',weight:5,cooldown:1.6,windup:.28,speed:1100,damage:64,shockwave:true},
          {id:'markedStrike',weight:6,cooldown:1.5,delay:.6,radius:140,damage:70,count:10,predictive:true}
        ]
      }
    ]
  }
];

export const BOSSES_BY_ID=Object.fromEntries(BOSSES.map(b=>[b.id,b]));

// Mid-run miniboss encounters, lighter than a full command signature.
export const MINIBOSSES=[
  {id:'harrier',name:'HARRIER PLATFORM',base:'nullhunter',hpMult:2.4,scale:1.3},
  {id:'anvil',name:'ANVIL FRAME',base:'ironvicar',hpMult:2.6,scale:1.35},
  {id:'oracle_echo',name:'ORACLE ECHO',base:'redauditor',hpMult:2.2,scale:1.25}
];
