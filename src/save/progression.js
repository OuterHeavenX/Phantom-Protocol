import {ACHIEVEMENTS,MILESTONES,INTEL_FILES,DEV_TREE,devNodeCost,devRequirementsMet,accountLevel} from '../../data/meta.js';
import {OPERATIVES,masteryRank} from '../../data/operatives.js';
import {WEAPONS,EVOLUTIONS} from '../../data/weapons.js';
import {MAPS,DIFFICULTIES} from '../../data/maps.js';
import {saveGame} from './storage.js';

// Resolves the metric names used by achievements, milestones and unlock
// conditions into a single number, including the derived ones that are stored
// as keyed sub-tables rather than counters.
export function readMetric(save,metric){
  const stats=save.statistics||{};
  if(typeof metric==='function')return metric(save);

  switch(metric){
    case 'mapsCleared':return Object.values(stats.mapsCleared||{}).filter(Boolean).length;
    case 'operativesCleared':return Object.values(stats.operativesCleared||{}).filter(Boolean).length;
    case 'uniqueEvolutions':return Object.keys(stats.uniqueEvolutions||{}).length;
    case 'weaponsUnlocked':return Object.values(save.weapons||{}).filter(w=>w.unlocked).length;
    case 'weaponsMaxed':return Object.values(save.weapons||{}).filter(w=>(w.maxLevel||0)>=8).length;
    case 'devRanks':return Object.values(save.dev||{}).reduce((sum,rank)=>sum+rank,0);
    case 'maxMastery':return Math.max(0,...Object.values(save.operatives||{}).map(o=>masteryRank(o.masteryXp||0).rank));
    case 'accountLevel':return accountLevel(save.profile?.accountXp||0).level;
    case 'distanceKm':return (stats.distanceTravelled||0)/1000;
    case 'intelRecovered':return Object.values(save.intelligence||{}).filter(Boolean).length;
    default:break;
  }
  // boss_<id> — a specific command signature has been defeated.
  if(metric.startsWith('boss_'))return (stats.bossKills||{})[metric.slice(5)]||0;
  // win_d<n> — an operation cleared at a specific difficulty.
  if(metric.startsWith('win_d'))return (stats.difficultyWins||{})[metric.slice(5)]||0;
  return Number(stats[metric])||0;
}

export function achievementProgress(save,achievement){
  const current=readMetric(save,achievement.metric);
  const done=!!save.achievements?.[achievement.id]||current>=achievement.target;
  return{current:Math.min(current,achievement.target),target:achievement.target,done,
         pct:Math.min(1,current/achievement.target)};
}

export function milestoneProgress(save,milestone){
  const current=readMetric(save,milestone.metric);
  const done=!!save.milestones?.[milestone.id]||current>=milestone.target;
  return{current:Math.min(current,milestone.target),target:milestone.target,done,
         pct:Math.min(1,current/milestone.target)};
}

// Applies a milestone reward string such as "weapon:rail" or "operative:oracle".
function applyUnlock(save,token,unlocked){
  if(!token)return;
  const [kind,id]=token.split(':');
  const tables={weapon:save.weapons,operative:save.operatives,map:save.maps,difficulty:save.difficulties};
  const table=tables[kind];
  if(!table||!table[id]||table[id].unlocked)return;
  table[id].unlocked=true;
  const names={
    weapon:WEAPONS.find(w=>w.id===id)?.name,
    operative:OPERATIVES.find(o=>o.id===id)?.codename,
    map:MAPS.find(m=>m.id===id)?.name,
    difficulty:DIFFICULTIES.find(d=>String(d.id)===id)?.name
  };
  unlocked.push({kind,id,name:names[kind]||id});
}

// Evaluates every content unlock condition declared in the data registries.
// This is what makes locked operatives, maps and difficulties actually open.
function evaluateContentUnlocks(save,unlocked){
  const check=entry=>{
    if(!entry.unlock)return false;
    if(entry.unlock.type!=='stat')return false;
    return readMetric(save,entry.unlock.stat)>=entry.unlock.value;
  };
  for(const op of OPERATIVES){
    const record=save.operatives[op.id];
    if(record&&!record.unlocked&&check(op)){
      record.unlocked=true;
      unlocked.push({kind:'operative',id:op.id,name:op.codename});
    }
  }
  for(const map of MAPS){
    const record=save.maps[map.id];
    if(record&&!record.unlocked&&check(map)){
      record.unlocked=true;
      unlocked.push({kind:'map',id:map.id,name:map.name});
    }
  }
  for(const diff of DIFFICULTIES){
    const record=save.difficulties[diff.id];
    if(record&&!record.unlocked&&check(diff)){
      record.unlocked=true;
      unlocked.push({kind:'difficulty',id:diff.id,name:diff.name});
    }
  }
  // Weapons unlock once enough of the roster has been mastered, so the
  // armory keeps opening up as the player progresses.
  const maxed=readMetric(save,'weaponsMaxed');
  const level=readMetric(save,'accountLevel');
  const thresholds={tripmine:1,microwave:2,emp:3,sentry:4,micro:5,rail:6,nanite:7,lance:8,orbital:10};
  for(const [id,needed] of Object.entries(thresholds)){
    const record=save.weapons[id];
    if(record&&!record.unlocked&&(maxed>=needed||level>=needed*3)){
      record.unlocked=true;
      unlocked.push({kind:'weapon',id,name:WEAPONS.find(w=>w.id===id)?.name||id});
    }
  }
}

// Sweeps achievements, milestones and intel, granting anything newly earned.
// Returns the list of new awards so the UI can surface them.
export function evaluateProgression(save){
  const awards=[];
  const unlocked=[];

  for(const achievement of ACHIEVEMENTS){
    if(save.achievements[achievement.id])continue;
    if(readMetric(save,achievement.metric)>=achievement.target){
      save.achievements[achievement.id]=Date.now();
      const jp=achievement.reward?.jp||0;
      if(jp){save.profile.jp+=jp;save.statistics.totalJp+=jp}
      awards.push({type:'achievement',id:achievement.id,name:achievement.name,jp});
    }
  }

  for(const milestone of MILESTONES){
    if(save.milestones[milestone.id])continue;
    if(readMetric(save,milestone.metric)>=milestone.target){
      save.milestones[milestone.id]=Date.now();
      const jp=milestone.reward?.jp||0;
      if(jp){save.profile.jp+=jp;save.statistics.totalJp+=jp}
      applyUnlock(save,milestone.reward?.unlock,unlocked);
      awards.push({type:'milestone',id:milestone.id,name:milestone.name,jp});
    }
  }

  for(const file of INTEL_FILES){
    if(save.intelligence[file.id])continue;
    if(readMetric(save,file.metric)>=file.target){
      save.intelligence[file.id]=Date.now();
      awards.push({type:'intel',id:file.id,name:file.name});
    }
  }

  evaluateContentUnlocks(save,unlocked);
  for(const item of unlocked)awards.push({type:'unlock',...item});
  save.statistics.devRanks=readMetric(save,'devRanks');
  return awards;
}

const bump=(table,key,amount=1)=>{if(key!=null)table[key]=(table[key]||0)+amount};

// Folds one completed run's telemetry into the persistent save, then runs the
// progression sweep. `run` is the summary object produced by the engine.
export function commitRun(save,run){
  const stats=save.statistics;

  stats.missions++;
  if(run.victory)stats.wins++;else stats.losses++;
  stats.kills+=run.kills||0;
  stats.eliteKills+=run.eliteKills||0;
  stats.minionKills+=run.minionKills||0;
  stats.hazardKills+=run.hazardKills||0;
  stats.damageDealt+=run.damageDealt||0;
  stats.damageTaken+=run.damageTaken||0;
  stats.healingDone+=run.healingDone||0;
  stats.criticalHits+=run.criticalHits||0;
  stats.playtime+=run.elapsed||0;
  stats.xpCollected+=run.xpCollected||0;
  stats.pickups+=run.pickups||0;
  stats.distanceTravelled+=run.distance||0;
  stats.dashes+=run.dashes||0;
  stats.abilitiesUsed+=run.abilitiesUsed||0;
  stats.evolutionsForged+=run.evolutions?.length||0;
  stats.vaultsFound+=run.vaultsFound||0;
  stats.vaultsBreached+=run.vaultsBreached||0;
  stats.turretsDeployed+=run.turretsDeployed||0;

  stats.longestSurvival=Math.max(stats.longestSurvival,run.elapsed||0);
  stats.highestLevel=Math.max(stats.highestLevel,run.level||1);
  stats.maxKillsInRun=Math.max(stats.maxKillsInRun,run.kills||0);
  stats.maxCombo=Math.max(stats.maxCombo,run.maxCombo||0);
  stats.maxAlive=Math.max(stats.maxAlive,run.maxAlive||0);
  stats.maxWeaponsHeld=Math.max(stats.maxWeaponsHeld,run.weapons?.length||0);
  if(run.victory&&(run.damageTaken||0)<=0)stats.perfectRuns++;

  const jp=Math.max(0,Math.round(run.jp||0));
  const credits=Math.max(0,Math.round(run.credits||0));
  save.profile.jp+=jp;
  save.profile.credits+=credits;
  stats.totalJp+=jp;
  stats.totalCredits+=credits;

  const accountXp=Math.round((run.elapsed||0)*.6+(run.kills||0)*.4+(run.victory?250:60));
  save.profile.accountXp=(save.profile.accountXp||0)+accountXp;

  for(const evolution of run.evolutions||[])stats.uniqueEvolutions[evolution]=true;
  for(const weapon of run.weapons||[]){
    const record=save.weapons[weapon.id];
    if(!record)continue;
    record.timesTaken=(record.timesTaken||0)+1;
    record.maxLevel=Math.max(record.maxLevel||0,weapon.level||0);
    record.kills=(record.kills||0)+(weapon.kills||0);
  }

  const operative=save.operatives[run.operativeId];
  if(operative){
    operative.runs=(operative.runs||0)+1;
    operative.kills=(operative.kills||0)+(run.kills||0);
    operative.masteryXp=(operative.masteryXp||0)+Math.round((run.elapsed||0)*.5+(run.kills||0)*.35+(run.victory?400:80));
    if(run.victory){
      operative.wins=(operative.wins||0)+1;
      operative.bestTime=Math.max(operative.bestTime||0,run.elapsed||0);
      stats.operativesCleared[run.operativeId]=true;
    }
  }

  if(run.victory){
    stats.mapsCleared[run.mapId]=true;
    bump(stats.difficultyWins,run.difficulty);
    if(run.difficulty>=4)stats.nightmareWins++;
    const mapRecord=save.maps[run.mapId];
    if(mapRecord){
      mapRecord.clears=(mapRecord.clears||0)+1;
      mapRecord.bestTime=Math.max(mapRecord.bestTime||0,run.elapsed||0);
    }
  }

  stats.bosses+=run.bossesDefeated?.length||0;
  for(const bossId of run.bossesDefeated||[])bump(stats.bossKills,bossId);

  // Personnel files recovered in the field persist whether or not counseling
  // is scheduled from the debrief — the roster screen can start it later.
  const recovered=[];
  for(const operativeId of run.discovered||[]){
    if(recordDiscovery(save,operativeId))recovered.push(operativeId);
  }

  save.profile.lastOperative=run.operativeId;
  save.profile.lastMap=run.mapId;
  save.profile.lastDuration=run.duration;
  save.profile.lastDifficulty=run.difficulty;

  save.runHistory.push({
    at:Date.now(),operative:run.operativeId,map:run.mapId,
    duration:run.duration,difficulty:run.difficulty,
    victory:!!run.victory,elapsed:Math.round(run.elapsed||0),
    kills:run.kills||0,level:run.level||1,jp
  });
  save.runHistory=save.runHistory.slice(-50);

  // Campaign operations close only when their objective was actually met.
  let operationClosed=false;
  if(run.operationId&&run.victory&&run.mission?.complete!==false){
    save.campaign=save.campaign||{};
    if(!save.campaign[run.operationId]?.completed){
      save.campaign[run.operationId]={completed:true,at:Date.now()};
      operationClosed=true;
    }
  }

  const awards=evaluateProgression(save);
  saveGame(save);
  return{jp,credits,accountXp,awards,recovered,operationClosed};
}

// Purchase a development node; returns true when the transaction went through.
export function purchaseDevNode(save,nodeId){
  const node=DEV_TREE.find(n=>n.id===nodeId);
  if(!node)return false;
  const rank=save.dev[nodeId]||0;
  if(rank>=node.max)return false;
  if(!devRequirementsMet(node,save.dev||{}))return false;
  const cost=devNodeCost(node,rank);
  if((save.profile.jp||0)<cost)return false;
  save.profile.jp-=cost;
  save.dev[nodeId]=rank+1;
  save.statistics.devRanks=readMetric(save,'devRanks');
  evaluateProgression(save);
  saveGame(save);
  return true;
}

// Refund the whole tree for a JP fee, so players can re-specialise.
export function respecDev(save){
  const spent=DEV_TREE.reduce((total,node)=>{
    const rank=save.dev[node.id]||0;
    let sum=0;
    for(let r=0;r<rank;r++)sum+=devNodeCost(node,r);
    return total+sum;
  },0);
  if(!spent)return 0;
  const refund=Math.floor(spent*.8);
  save.dev={};
  save.profile.jp+=refund;
  save.statistics.devRanks=0;
  saveGame(save);
  return refund;
}

export function isUnlocked(save,kind,id){
  const tables={weapon:save.weapons,operative:save.operatives,map:save.maps,difficulty:save.difficulties};
  return !!tables[kind]?.[id]?.unlocked;
}

export function unlockedOperatives(save){
  return OPERATIVES.filter(o=>save.operatives[o.id]?.unlocked);
}

export function unlockedMaps(save){
  return MAPS.filter(m=>save.maps[m.id]?.unlocked);
}

export function unlockedDifficulties(save){
  return DIFFICULTIES.filter(d=>save.difficulties[d.id]?.unlocked);
}

export function unlockedWeapons(save){
  return WEAPONS.filter(w=>save.weapons[w.id]?.unlocked);
}

export function evolutionsDiscovered(save){
  return EVOLUTIONS.filter(e=>save.statistics.uniqueEvolutions?.[e.id]);
}

// Counseling hours are declared per operative; harder assets take longer to
// clear for field duty.
export function counselHours(operativeId){
  return OPERATIVES.find(o=>o.id===operativeId)?.counselHours||4;
}

// Recovering a personnel file in the field. Idempotent — a second recovery of
// the same operative is a no-op rather than a reset.
export function recordDiscovery(save,operativeId){
  const record=save.operatives[operativeId];
  if(!record||record.unlocked||record.discovered)return false;
  record.discovered=true;
  return true;
}

export function startRecruitment(save,operativeId,durationHours){
  const record=save.operatives[operativeId];
  if(!record)return false;
  // Counseling can only be scheduled for an operative whose file is in hand.
  if(record.unlocked||record.recruitment||!record.discovered)return false;
  record.recruitment={
    startedAt:Date.now(),
    durationMs:(durationHours||counselHours(operativeId))*60*60*1000
  };
  return true;
}

// Operatives whose file is still missing — the pool a run can draw from.
export function undiscoveredOperatives(save){
  return OPERATIVES.filter(op=>{
    const record=save.operatives[op.id];
    return record&&!record.unlocked&&!record.discovered&&!record.recruitment;
  });
}

export function recruitmentProgress(save,operativeId){
  const record=save.operatives[operativeId];
  if(!record?.recruitment)return null;
  const elapsed=Date.now()-record.recruitment.startedAt;
  const total=record.recruitment.durationMs;
  const remaining=Math.max(0,total-elapsed);
  return{
    startedAt:record.recruitment.startedAt,
    durationMs:total,
    elapsed,
    remaining,
    progress:Math.min(1,elapsed/total),
    complete:remaining===0
  };
}

export function completeRecruitments(save){
  const completed=[];
  for(const op of OPERATIVES){
    const progress=recruitmentProgress(save,op.id);
    if(progress?.complete){
      save.operatives[op.id].unlocked=true;
      save.operatives[op.id].recruitment=null;
      completed.push({kind:'operative',id:op.id,name:op.codename});
    }
  }
  return completed;
}
