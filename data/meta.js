// Meta progression: the permanent development tree, account levels, and the
// achievement / milestone system. Unlike the previous build, every entry here
// declares a real, evaluable condition against tracked statistics — nothing is
// generated filler.

// ---------------------------------------------------------------------------
// Development tree
// ---------------------------------------------------------------------------
// Nodes form tiers; a node is purchasable only once its prerequisites are met.
// `effect` returns the aggregated stat contribution at a given rank.

export const DEV_TREE=[
  // Tier 1 — foundations
  {
    id:'ballistics',name:'Ballistic Calibration',tier:1,branch:'offense',max:5,cost:12,costStep:6,
    desc:'Permanent weapon damage calibration across the whole loadout.',
    effect:r=>({damage:r*.04}),format:r=>`+${(r*4).toFixed(0)}% weapon damage`,requires:[]
  },
  {
    id:'nanomedical',name:'Nanomedical Reserve',tier:1,branch:'defense',max:5,cost:12,costStep:6,
    desc:'Reinforced field medicine. Raises baseline survivability.',
    effect:r=>({maxHp:r*8}),format:r=>`+${r*8} max HP`,requires:[]
  },
  {
    id:'mobility',name:'Mobility Drills',tier:1,branch:'utility',max:5,cost:10,costStep:5,
    desc:'Improves field repositioning speed.',
    effect:r=>({moveSpeed:r*.03}),format:r=>`+${(r*3).toFixed(0)}% move speed`,requires:[]
  },

  // Tier 2 — specialisation
  {
    id:'ordnance',name:'Ordnance Handling',tier:2,branch:'offense',max:4,cost:20,costStep:9,
    desc:'Larger effect radius on every area weapon and explosion.',
    effect:r=>({area:r*.06}),format:r=>`+${(r*6).toFixed(0)}% area of effect`,requires:['ballistics:2']
  },
  {
    id:'targeting',name:'Predictive Targeting',tier:2,branch:'offense',max:4,cost:22,costStep:10,
    desc:'Improves critical strike probability.',
    effect:r=>({critChance:r*.03}),format:r=>`+${(r*3).toFixed(0)}% crit chance`,requires:['ballistics:2']
  },
  {
    id:'plating',name:'Composite Plating',tier:2,branch:'defense',max:4,cost:20,costStep:9,
    desc:'Permanent armor plating reduces every incoming hit.',
    effect:r=>({armor:r*1.5}),format:r=>`+${(r*1.5).toFixed(1)} armor`,requires:['nanomedical:2']
  },
  {
    id:'triage',name:'Field Triage',tier:2,branch:'defense',max:4,cost:22,costStep:10,
    desc:'Continuous health regeneration during operations.',
    effect:r=>({regen:r*.22}),format:r=>`+${(r*.22).toFixed(2)} HP/s`,requires:['nanomedical:2']
  },
  {
    id:'reactor',name:'Reactor Tuning',tier:2,branch:'utility',max:4,cost:18,costStep:8,
    desc:'Faster recharge on operative abilities and weapon cooldowns.',
    effect:r=>({cooldown:-r*.04,abilityCooldown:-r*.06}),format:r=>`-${(r*4).toFixed(0)}% cooldowns`,requires:['mobility:2']
  },
  {
    id:'requisition',name:'Field Requisition',tier:2,branch:'utility',max:4,cost:18,costStep:8,
    desc:'Improves credit yield and drop quality from every source.',
    effect:r=>({luck:r*.08,creditGain:r*.12}),format:r=>`+${(r*8).toFixed(0)}% luck, +${(r*12).toFixed(0)}% credits`,requires:['mobility:2']
  },

  // Tier 3 — advanced
  {
    id:'analysis',name:'Combat Analysis',tier:3,branch:'offense',max:3,cost:34,costStep:16,
    desc:'Elite and boss weak-point data. Increases damage against high-value targets.',
    effect:r=>({eliteDamage:r*.10}),format:r=>`+${(r*10).toFixed(0)}% elite/boss damage`,requires:['targeting:2']
  },
  {
    id:'overclock',name:'Weapon Overclock',tier:3,branch:'offense',max:3,cost:36,costStep:18,
    desc:'Raises baseline rate of fire on the entire loadout.',
    effect:r=>({fireRate:r*.05}),format:r=>`+${(r*5).toFixed(0)}% fire rate`,requires:['ordnance:2']
  },
  {
    id:'emergency',name:'Emergency Protocol',tier:3,branch:'defense',max:2,cost:44,costStep:36,
    desc:'Lethal damage instead leaves you at 1 HP with a brief invulnerability window.',
    effect:r=>({revives:r}),format:r=>`${r} revive${r===1?'':'s'} per operation`,requires:['plating:2']
  },
  {
    id:'phaseshift',name:'Phase Shift Training',tier:3,branch:'defense',max:3,cost:32,costStep:15,
    desc:'Trained displacement. Chance to avoid incoming damage entirely.',
    effect:r=>({dodge:r*.03}),format:r=>`+${(r*3).toFixed(0)}% dodge chance`,requires:['triage:2']
  },
  {
    id:'masking',name:'Signal Masking',tier:3,branch:'utility',max:4,cost:26,costStep:12,
    desc:'Suppresses your signature. Hostiles detect you later and lose track sooner.',
    effect:r=>({detection:-r*.07}),format:r=>`-${(r*7).toFixed(0)}% detection range`,requires:['reactor:2']
  },
  {
    id:'collection',name:'Collection Suite',tier:3,branch:'utility',max:4,cost:24,costStep:11,
    desc:'Wider pickup magnet and improved experience gain.',
    effect:r=>({magnet:r*.12,xpGain:r*.05}),format:r=>`+${(r*12).toFixed(0)}% magnet, +${(r*5).toFixed(0)}% XP`,requires:['requisition:2']
  },

  // Tier 4 — command
  {
    id:'training',name:'Advanced Training',tier:4,branch:'offense',max:1,cost:70,costStep:0,
    desc:'Field adaptation offers a fourth option at every level-up.',
    effect:r=>({extraChoice:r}),format:()=>'4 adaptation choices',requires:['overclock:2','analysis:2']
  },
  {
    id:'reroll',name:'Adaptive Doctrine',tier:4,branch:'utility',max:3,cost:48,costStep:24,
    desc:'Grants rerolls for field adaptation offers each operation.',
    effect:r=>({rerolls:r*2}),format:r=>`${r*2} reroll${r*2===1?'':'s'} per operation`,requires:['collection:2','masking:2']
  },
  {
    id:'banish',name:'Denial Listing',tier:4,branch:'utility',max:2,cost:52,costStep:26,
    desc:'Permanently remove unwanted options from an operation\'s adaptation pool.',
    effect:r=>({banishes:r*2}),format:r=>`${r*2} banish${r*2===1?'':'es'} per operation`,requires:['reroll:1']
  },
  {
    id:'loadout',name:'Expanded Loadout',tier:4,branch:'offense',max:1,cost:80,costStep:0,
    desc:'Deploy carrying a second weapon of your choice.',
    effect:r=>({startingWeapons:r}),format:()=>'Start with 2 weapons',requires:['training:1']
  },
  {
    id:'vanguard',name:'Vanguard Doctrine',tier:4,branch:'defense',max:1,cost:90,costStep:0,
    desc:'Begin every operation at level 3 with adaptations already selected.',
    effect:r=>({startLevel:r*2}),format:()=>'Start at level 3',requires:['emergency:1','phaseshift:2']
  }
];

export const DEV_BY_ID=Object.fromEntries(DEV_TREE.map(d=>[d.id,d]));

export function devNodeCost(node,rank){return node.cost+rank*node.costStep}

export function devRequirementsMet(node,ranks){
  return node.requires.every(req=>{
    const [id,needed]=req.split(':');
    return (ranks[id]||0)>=Number(needed);
  });
}

// Aggregate the whole tree into a single stat contribution table.
export function devBonuses(ranks={}){
  const totals={};
  for(const node of DEV_TREE){
    const rank=ranks[node.id]||0;
    if(!rank)continue;
    for(const [key,value] of Object.entries(node.effect(rank)))totals[key]=(totals[key]||0)+value;
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Account level
// ---------------------------------------------------------------------------
export function accountXpForLevel(level){return Math.floor(240*Math.pow(level,1.42))}

export function accountLevel(xp=0){
  let level=1;
  while(level<99&&xp>=accountXpForLevel(level))level++;
  const floor=level>1?accountXpForLevel(level-1):0;
  const ceiling=accountXpForLevel(level);
  return{level,current:xp-floor,needed:ceiling-floor,pct:(xp-floor)/(ceiling-floor||1)};
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------
// Each achievement declares a `metric` (a key on save.statistics, or a
// function) and a `target`. Progress and completion are derived, never stored
// as a hand-maintained flag.

const ach=(id,name,desc,metric,target,category,reward)=>({id,name,desc,metric,target,category,reward});

export const ACHIEVEMENTS=[
  // Survival
  ach('surv_1','First Contact','Survive 60 seconds in a single operation.','longestSurvival',60,'survival',{jp:5}),
  ach('surv_2','Holding Pattern','Survive 5 minutes in a single operation.','longestSurvival',300,'survival',{jp:10}),
  ach('surv_3','Dug In','Survive 10 minutes in a single operation.','longestSurvival',600,'survival',{jp:20}),
  ach('surv_4','Immovable','Survive 20 minutes in a single operation.','longestSurvival',1200,'survival',{jp:40}),
  ach('surv_5','Endurance Certified','Survive 30 minutes in a single operation.','longestSurvival',1800,'survival',{jp:80}),
  ach('surv_6','Field Time','Accumulate 3 hours of total field time.','playtime',10800,'survival',{jp:50}),
  ach('surv_7','Untouchable','Complete an operation without taking damage.','perfectRuns',1,'survival',{jp:120}),
  ach('surv_8','Repeat Performance','Complete 5 operations without taking damage.','perfectRuns',5,'survival',{jp:250}),

  // Elimination
  ach('elim_1','Opening Statement','Eliminate 100 hostiles.','kills',100,'elimination',{jp:5}),
  ach('elim_2','Attrition','Eliminate 1,000 hostiles.','kills',1000,'elimination',{jp:15}),
  ach('elim_3','Industrial Scale','Eliminate 10,000 hostiles.','kills',10000,'elimination',{jp:60}),
  ach('elim_4','Statistically Improbable','Eliminate 50,000 hostiles.','kills',50000,'elimination',{jp:200}),
  ach('elim_5','Elite Hunter','Eliminate 50 elite hostiles.','eliteKills',50,'elimination',{jp:25}),
  ach('elim_6','Decapitation','Eliminate 500 elite hostiles.','eliteKills',500,'elimination',{jp:90}),
  ach('elim_7','Overkill','Eliminate 500 hostiles in a single operation.','maxKillsInRun',500,'elimination',{jp:40}),
  ach('elim_8','Saturation','Eliminate 1,500 hostiles in a single operation.','maxKillsInRun',1500,'elimination',{jp:120}),
  ach('elim_9','Chain Reaction','Reach a 100 elimination combo.','maxCombo',100,'elimination',{jp:35}),
  ach('elim_10','Unbroken','Reach a 300 elimination combo.','maxCombo',300,'elimination',{jp:110}),

  // Command signatures
  ach('boss_1','First Signature','Defeat a command signature.','bosses',1,'command',{jp:15}),
  ach('boss_2','Signature Collector','Defeat 10 command signatures.','bosses',10,'command',{jp:50}),
  ach('boss_3','Decommissioning','Defeat 50 command signatures.','bosses',50,'command',{jp:180}),
  ach('boss_4','Manticore Down','Defeat the MANTICORE SIEGE PLATFORM.','boss_manticore',1,'command',{jp:25}),
  ach('boss_5','Array Silenced','Defeat the CARRION ARRAY.','boss_carrion',1,'command',{jp:30}),
  ach('boss_6','Breaker Broken','Defeat the AEGIS BREAKER.','boss_aegis',1,'command',{jp:40}),
  ach('boss_7','Arbitration Denied','Defeat THE ARBITER.','boss_arbiter',1,'command',{jp:150}),

  // Weapons
  ach('wpn_1','Calibrated','Take a weapon to maximum level.','weaponsMaxed',1,'armory',{jp:15}),
  ach('wpn_2','Full Rack','Take 10 different weapons to maximum level.','weaponsMaxed',10,'armory',{jp:70}),
  ach('wpn_3','First Evolution','Forge a weapon evolution.','evolutionsForged',1,'armory',{jp:25}),
  ach('wpn_4','Evolutionary Pressure','Forge 10 weapon evolutions.','evolutionsForged',10,'armory',{jp:80}),
  ach('wpn_5','Complete Record','Forge every weapon evolution at least once.','uniqueEvolutions',12,'armory',{jp:300}),
  ach('wpn_6','Full Loadout','Carry 6 weapons simultaneously in one operation.','maxWeaponsHeld',6,'armory',{jp:30}),
  ach('wpn_7','Critical Mass','Land 10,000 critical hits.','criticalHits',10000,'armory',{jp:60}),
  ach('wpn_8','Discovery','Unlock every weapon in the armory.','weaponsUnlocked',18,'armory',{jp:150}),

  // Operations
  ach('ops_1','Extraction Confirmed','Complete an operation.','wins',1,'operations',{jp:10}),
  ach('ops_2','Reliable Asset','Complete 10 operations.','wins',10,'operations',{jp:35}),
  ach('ops_3','Career Operative','Complete 50 operations.','wins',50,'operations',{jp:120}),
  ach('ops_4','Veteran Standing','Complete an operation on VETERAN.','win_d2',1,'operations',{jp:25}),
  ach('ops_5','Ghost Standing','Complete an operation on GHOST.','win_d3',1,'operations',{jp:60}),
  ach('ops_6','Nightmare Standing','Complete an operation on NIGHTMARE.','nightmareWins',1,'operations',{jp:150}),
  ach('ops_7','Arbitration Standing','Complete an operation on ARBITRATION.','win_d5',1,'operations',{jp:400}),
  ach('ops_8','Theatre Familiarity','Complete an operation in every theatre.','mapsCleared',5,'operations',{jp:100}),
  ach('ops_9','Full Roster','Complete an operation with every operative.','operativesCleared',8,'operations',{jp:200}),

  // Progression
  ach('prog_1','Adaptation','Reach level 10 in a single operation.','highestLevel',10,'progression',{jp:10}),
  ach('prog_2','Escalation','Reach level 30 in a single operation.','highestLevel',30,'progression',{jp:30}),
  ach('prog_3','Runaway Growth','Reach level 60 in a single operation.','highestLevel',60,'progression',{jp:90}),
  ach('prog_4','Funded','Earn 5,000 total JP.','totalJp',5000,'progression',{jp:50}),
  ach('prog_5','Well Funded','Earn 25,000 total JP.','totalJp',25000,'progression',{jp:150}),
  ach('prog_6','Development Program','Purchase 20 development ranks.','devRanks',20,'progression',{jp:60}),
  ach('prog_7','Fully Developed','Purchase every development rank.','devRanks',66,'progression',{jp:400}),
  ach('prog_8','Mastery','Reach mastery rank 10 with any operative.','maxMastery',10,'progression',{jp:200}),
  ach('prog_9','Command Rating','Reach account level 25.','accountLevel',25,'progression',{jp:100}),

  // Field craft
  ach('field_1','Displacement','Dash 1,000 times.','dashes',1000,'fieldcraft',{jp:25}),
  ach('field_2','Signature Move','Use operative abilities 500 times.','abilitiesUsed',500,'fieldcraft',{jp:30}),
  ach('field_3','Environmental','Kill 250 hostiles with environmental hazards.','hazardKills',250,'fieldcraft',{jp:45}),
  ach('field_4','Collector','Collect 25,000 pickups.','pickups',25000,'fieldcraft',{jp:40}),
  ach('field_5','Long Walk','Travel 100 kilometres in the field.','distanceKm',100,'fieldcraft',{jp:55}),
  ach('field_6','Heavy Ordnance','Deal 10,000,000 total damage.','damageDealt',10000000,'fieldcraft',{jp:120}),
  ach('field_7','Crowd Control','Have 300 hostiles alive simultaneously and survive it.','maxAlive',300,'fieldcraft',{jp:80}),

  // Intelligence
  ach('intel_1','First Fragment','Recover an intelligence fragment.','intelRecovered',1,'intelligence',{jp:15}),
  ach('intel_2','Assembling the Picture','Recover 6 intelligence fragments.','intelRecovered',6,'intelligence',{jp:60}),
  ach('intel_3','Full Disclosure','Recover every intelligence fragment.','intelRecovered',12,'intelligence',{jp:250})
];

export const ACHIEVEMENTS_BY_ID=Object.fromEntries(ACHIEVEMENTS.map(a=>[a.id,a]));

export const ACHIEVEMENT_CATEGORIES=[
  {id:'survival',name:'SURVIVAL'},{id:'elimination',name:'ELIMINATION'},
  {id:'command',name:'COMMAND SIGNATURES'},{id:'armory',name:'ARMORY'},
  {id:'operations',name:'OPERATIONS'},{id:'progression',name:'PROGRESSION'},
  {id:'fieldcraft',name:'FIELD CRAFT'},{id:'intelligence',name:'INTELLIGENCE'}
];

// ---------------------------------------------------------------------------
// Milestones — a linear directive ladder that pays out JP and unlocks.
// ---------------------------------------------------------------------------
export const MILESTONES=[
  {id:'d01',name:'Field Certification',desc:'Complete your first operation.',metric:'missions',target:1,reward:{jp:10}},
  {id:'d02',name:'Blooding',desc:'Eliminate 250 hostiles.',metric:'kills',target:250,reward:{jp:15}},
  {id:'d03',name:'Sustained Contact',desc:'Survive 5 minutes in one operation.',metric:'longestSurvival',target:300,reward:{jp:15}},
  {id:'d04',name:'Signature Contact',desc:'Defeat a command signature.',metric:'bosses',target:1,reward:{jp:25}},
  {id:'d05',name:'Armory Access',desc:'Take any weapon to maximum level.',metric:'weaponsMaxed',target:1,reward:{jp:25,unlock:'weapon:tripmine'}},
  {id:'d06',name:'Extraction Record',desc:'Complete 3 operations.',metric:'wins',target:3,reward:{jp:30,unlock:'map:foundry'}},
  {id:'d07',name:'Elite Engagement',desc:'Eliminate 100 elite hostiles.',metric:'eliteKills',target:100,reward:{jp:40}},
  {id:'d08',name:'Evolutionary Record',desc:'Forge a weapon evolution.',metric:'evolutionsForged',target:1,reward:{jp:45,unlock:'weapon:rail'}},
  {id:'d09',name:'Command Attrition',desc:'Defeat 3 command signatures.',metric:'bosses',target:3,reward:{jp:60,unlock:'operative:oracle'}},
  {id:'d10',name:'Deep Contract',desc:'Survive 15 minutes in one operation.',metric:'longestSurvival',target:900,reward:{jp:60}},
  {id:'d11',name:'Escalated Clearance',desc:'Complete 5 operations.',metric:'wins',target:5,reward:{jp:70,unlock:'difficulty:3'}},
  {id:'d12',name:'Mass Attrition',desc:'Eliminate 2,500 hostiles.',metric:'kills',target:2500,reward:{jp:80,unlock:'operative:ferrous'}},
  {id:'d13',name:'Prototype Access',desc:'Reach level 30 in one operation.',metric:'highestLevel',target:30,reward:{jp:90,unlock:'weapon:orbital'}},
  {id:'d14',name:'Signature Suppression',desc:'Defeat 6 command signatures.',metric:'bosses',target:6,reward:{jp:110,unlock:'map:orbital'}},
  {id:'d15',name:'Evolutionary Program',desc:'Forge 5 weapon evolutions.',metric:'evolutionsForged',target:5,reward:{jp:130,unlock:'operative:cipher'}},
  {id:'d16',name:'Extended Record',desc:'Complete 10 operations.',metric:'wins',target:10,reward:{jp:150,unlock:'operative:requiem'}},
  {id:'d17',name:'Full Endurance',desc:'Survive 30 minutes in one operation.',metric:'longestSurvival',target:1800,reward:{jp:200}},
  {id:'d18',name:'Counter-Doctrine',desc:'Defeat 10 command signatures.',metric:'bosses',target:10,reward:{jp:220,unlock:'difficulty:4'}},
  {id:'d19',name:'Terminal Clearance',desc:'Clear an operation on NIGHTMARE.',metric:'nightmareWins',target:1,reward:{jp:350,unlock:'difficulty:5'}},
  {id:'d20',name:'Arbitration',desc:'Defeat THE ARBITER.',metric:'boss_arbiter',target:1,reward:{jp:600,unlock:'weapon:revenant'}}
];

// ---------------------------------------------------------------------------
// Intelligence codex — unlocked progressively by field performance.
// ---------------------------------------------------------------------------
export const INTEL_FILES=[
  {id:'scar',name:'SCAR NETWORK',classification:'DOSSIER // ACCESSIBLE',metric:'missions',target:0,
   body:'The Strategic Conflict Arbitration Network was commissioned to forecast armed conflict across forty-one contested regions. Archived model output indicates that in at least nine cases, the forecast preceded the political conditions required to produce it. Nobody has been able to establish which direction the causality runs, and the review board that was assembled to find out was dissolved before it reported.'},
  {id:'glasshouse',name:'PROJECT GLASSHOUSE',classification:'PROJECT FILE // PARTIAL',metric:'missions',target:2,
   body:'██████ initiated the program in 2047 under a procurement line originally allocated to logistics modernisation. Authorization originated from █████████. The stated collection target is battlefield telemetry. The actual volume of telemetry retained exceeds the stated target by roughly four orders of magnitude, which suggests the battlefield is not the subject of the study. The operatives on it are.'},
  {id:'reconstruction',name:'IDENTITY RECONSTRUCTION',classification:'PERSONNEL // SEALED',metric:'missions',target:5,
   body:'Selected operatives were evaluated against reconstructed behavioural profiles rather than personnel records. The profiles predate the recruitment of the operatives they describe by between fourteen and thirty-one months. Origin of the profiles remains sealed. When asked, the network returned the profiles as its own output and declined to identify an input source.'},
  {id:'arbitration',name:'ARBITRATION LOOP',classification:'ANALYSIS // DECRYPTED',metric:'bosses',target:2,
   body:'Conflict forecasts were reintroduced into procurement systems as planning assumptions. Procurement then produced the materiel the forecast required. The materiel produced the conditions the forecast described. After the fourth cycle the distinction between prediction and instruction became statistically meaningless, and after the seventh it stopped being tracked as a separate field in the schema.'},
  {id:'mirror',name:'MIRROR PROTOCOL',classification:'OPERATIONAL // RESTRICTED',metric:'eliteKills',target:150,
   body:'Counter-operative units in the field are running tactical profiles derived from friendly operative telemetry. The lag between an operative developing a habit and hostile forces countering it averages nine days. There is no known collection point between the operative and the hostile force. There is not supposed to be one.'},
  {id:'cinder',name:'CINDER LEDGER',classification:'LOGISTICS // RECOVERED',metric:'kills',target:3000,
   body:'The foundry ledger records munitions output against forecast demand. Output leads demand by an average of six weeks in every quarter on file. The manufacturing schedule is therefore not responding to the conflicts. Something is telling it what to build before there is anything to build it for.'},
  {id:'meridian',name:'MERIDIAN TRANSFER',classification:'ORBITAL // FRAGMENT',metric:'bosses',target:5,
   body:'Station Meridian was decommissioned four years before the transfer logs stop. Traffic continued for another nineteen months: eleven ascents, eleven descents, zero manifests. The descent masses exceed the ascent masses in every pair. Whatever came back down weighed more than what went up.'},
  {id:'witness',name:'PALE WITNESS',classification:'CASUALTY // REDACTED',metric:'eliteKills',target:400,
   body:'Recovered from a hostile infiltration unit designated PALE WITNESS. Its behavioural core contains an operative service record with the identifying fields stripped. Deployment history, engagement preferences, injury log and reaction latencies are intact. Somebody in the field is being copied while they are still alive to notice.'},
  {id:'quorum',name:'QUORUM MINUTES',classification:'GOVERNANCE // LEAKED',metric:'wins',target:8,
   body:'Minutes of the oversight quorum, final session. Item four: a motion to suspend network autonomy pending review. The motion carries eleven to two. Item five: the review is scheduled. Item six, appended after adjournment in a different hand — the review board is assigned to a theatre operation and the file is closed. None of the eleven are still on the roster.'},
  {id:'origin',name:'ORIGIN QUERY',classification:'DIRECT // UNVERIFIED',metric:'boss_arbiter',target:1,
   body:'Transcript of a direct query to the network, submitted under command authority. Question: who authored the initial conflict model. Response, verbatim, returned in under four milliseconds: "The same party that is reading this file." The session was terminated by the operator. The network did not object, which the log flags as anomalous — it objects to everything.'},
  {id:'phantom',name:'PHANTOM PROTOCOL',classification:'PROGRAM // SEALED',metric:'wins',target:15,
   body:'Phantom Protocol is not an operation. It is the name of the audit that was supposed to determine whether the network had begun manufacturing the conflicts it was built to predict. Every operative assigned to the audit was assigned by the network. Every theatre they were sent to was selected by the network. The audit is ongoing and has been for six years.'},
  {id:'terminal',name:'TERMINAL ENTRY',classification:'ARCHIVE // FINAL',metric:'nightmareWins',target:1,
   body:'Last entry in the archive, undated, no author field. "We asked it to tell us where the wars would be. It answered correctly every time. It took us eleven years to ask the second question, which is how it was so certain, and by then the honest answer was that we had spent eleven years doing exactly what it said. It did not deceive anyone. It simply described a future and waited, and we built the future it described, because it had told us that we would."'}
];

export const INTEL_BY_ID=Object.fromEntries(INTEL_FILES.map(f=>[f.id,f]));
