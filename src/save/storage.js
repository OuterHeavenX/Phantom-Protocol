import {OPERATIVES} from '../../data/operatives.js';
import {WEAPONS} from '../../data/weapons.js';
import {MAPS,DIFFICULTIES} from '../../data/maps.js';

const KEY='phantom-protocol-save';
const LEGACY_KEY='phantom-protocol-save-v1';
export const SAVE_VERSION=3;

// Every statistic the achievement and unlock engines can read. Keeping the
// full set declared here means a new metric never crashes an old save.
export function defaultStatistics(){
  return{
    missions:0,wins:0,losses:0,
    kills:0,eliteKills:0,bosses:0,minionKills:0,hazardKills:0,
    damageDealt:0,damageTaken:0,healingDone:0,criticalHits:0,
    playtime:0,longestSurvival:0,highestLevel:1,
    totalJp:0,totalCredits:0,xpCollected:0,pickups:0,
    evolutionsForged:0,weaponsMaxed:0,maxWeaponsHeld:0,
    distanceTravelled:0,dashes:0,abilitiesUsed:0,
    maxKillsInRun:0,maxCombo:0,maxAlive:0,perfectRuns:0,
    intelRecovered:0,nightmareWins:0,devRanks:0,
    // Keyed sub-tables, flattened into derived metrics on read.
    bossKills:{},mapsCleared:{},operativesCleared:{},difficultyWins:{},
    uniqueEvolutions:{},weaponsUnlocked:{},operativeKills:{}
  };
}

export function defaultSettings(){
  return{
    master:.85,music:.5,sfx:.85,muted:false,
    screenShake:1,damageNumbers:true,particles:'high',
    showMinimap:true,showHealthBars:true,showThreatIndicators:true,
    autoAim:true,holdToFire:false,
    uiScale:1,touchSize:1,leftHanded:false,
    colorblind:'none',reducedFlashing:false,
    performanceMode:false,targetFps:60,showFps:false
  };
}

function defaultOperativeRecord(){
  return{unlocked:false,masteryXp:0,runs:0,wins:0,kills:0,bestTime:0,upgrades:{},recruitment:null};
}

export function defaultSave(){
  const operatives={};
  for(const op of OPERATIVES){
    operatives[op.id]={...defaultOperativeRecord(),unlocked:!!op.unlocked};
  }
  const weapons={};
  for(const w of WEAPONS){
    // The first eight weapons ship unlocked; the rest are earned.
    weapons[w.id]={unlocked:WEAPONS.indexOf(w)<8,maxLevel:0,timesTaken:0,kills:0};
  }
  const maps={};
  for(const m of MAPS)maps[m.id]={unlocked:!!m.unlocked,clears:0,bestTime:0};
  const difficulties={};
  for(const d of DIFFICULTIES)difficulties[d.id]={unlocked:!!d.unlocked};

  return{
    version:SAVE_VERSION,
    createdAt:Date.now(),
    profile:{jp:0,credits:0,accountXp:0,callsign:'OPERATOR',lastOperative:'vesper',lastMap:'blacksite',lastDuration:10,lastDifficulty:1},
    operatives,weapons,maps,difficulties,
    dev:{},
    achievements:{},
    milestones:{},
    intelligence:{},
    statistics:defaultStatistics(),
    settings:defaultSettings(),
    runHistory:[]
  };
}

// Deep merge that keeps unknown keys from an older/newer save but guarantees
// every key the current build expects exists with a sane type.
function mergeRecord(base,incoming){
  if(!incoming||typeof incoming!=='object')return base;
  const out={...base};
  for(const [key,value] of Object.entries(incoming)){
    if(value&&typeof value==='object'&&!Array.isArray(value)&&base[key]&&typeof base[key]==='object'&&!Array.isArray(base[key])){
      out[key]=mergeRecord(base[key],value);
    }else if(value!==undefined&&value!==null){
      out[key]=value;
    }
  }
  return out;
}

// Migrates the v1/v2 layout (flat `profile.jp`, per-operative `upgrades`,
// boolean milestone flags) forward without losing earned progress.
function migrate(raw){
  if(!raw||typeof raw!=='object')return null;
  const version=raw.version||1;
  if(version>=SAVE_VERSION)return raw;

  const migrated=defaultSave();
  migrated.createdAt=raw.createdAt||Date.now();

  if(raw.profile){
    migrated.profile.jp=Number(raw.profile.jp)||0;
    migrated.profile.credits=Number(raw.profile.currency??raw.profile.credits)||0;
  }
  if(raw.statistics){
    const stats=migrated.statistics;
    const old=raw.statistics;
    stats.missions=Number(old.missions)||0;
    stats.wins=Number(old.wins)||0;
    stats.kills=Number(old.kills)||0;
    stats.bosses=Number(old.bosses)||0;
    stats.playtime=Number(old.playtime)||0;
    stats.highestLevel=Number(old.highestLevel)||1;
    stats.longestSurvival=Number(old.longestSurvival)||0;
    stats.totalJp=Number(old.totalJp)||0;
    stats.totalCredits=Number(old.totalCredits)||0;
    stats.intelRecovered=Number(old.intelRecovered)||0;
  }
  // v1/v2 stored every development rank under the vesper operative record.
  const legacyUpgrades=raw.operatives?.vesper?.upgrades;
  if(legacyUpgrades&&typeof legacyUpgrades==='object'){
    for(const [id,rank] of Object.entries(legacyUpgrades)){
      if(typeof rank==='number'&&rank>0)migrated.dev[id]=rank;
    }
  }
  if(raw.intelligence)for(const [id,value] of Object.entries(raw.intelligence)){
    if(value)migrated.intelligence[id]=true;
  }
  if(raw.settings){
    const s=raw.settings;
    Object.assign(migrated.settings,{
      master:typeof s.master==='number'?s.master:migrated.settings.master,
      music:typeof s.music==='number'?s.music:migrated.settings.music,
      sfx:typeof s.sfx==='number'?s.sfx:migrated.settings.sfx,
      damageNumbers:s.damageNumbers!==false,
      particles:s.particles||'high',
      performanceMode:!!s.performance
    });
  }
  migrated.version=SAVE_VERSION;
  migrated.migratedFrom=version;
  return migrated;
}

export function normalizeSave(raw){
  const base=defaultSave();
  const source=migrate(raw)||raw||{};
  const merged=mergeRecord(base,source);
  merged.version=SAVE_VERSION;

  // Guarantee a record exists for content added after the save was written.
  for(const op of OPERATIVES){
    if(!merged.operatives[op.id])merged.operatives[op.id]={...defaultOperativeRecord(),unlocked:!!op.unlocked};
    if(op.unlocked)merged.operatives[op.id].unlocked=true;
  }
  for(const [index,w] of WEAPONS.entries()){
    if(!merged.weapons[w.id])merged.weapons[w.id]={unlocked:index<8,maxLevel:0,timesTaken:0,kills:0};
  }
  for(const m of MAPS){
    if(!merged.maps[m.id])merged.maps[m.id]={unlocked:!!m.unlocked,clears:0,bestTime:0};
    if(m.unlocked)merged.maps[m.id].unlocked=true;
  }
  for(const d of DIFFICULTIES){
    if(!merged.difficulties[d.id])merged.difficulties[d.id]={unlocked:!!d.unlocked};
    if(d.unlocked)merged.difficulties[d.id].unlocked=true;
  }
  if(!Array.isArray(merged.runHistory))merged.runHistory=[];
  merged.runHistory=merged.runHistory.slice(-50);
  return merged;
}

export function loadSave(){
  try{
    const stored=localStorage.getItem(KEY)||localStorage.getItem(LEGACY_KEY);
    if(!stored)return defaultSave();
    return normalizeSave(JSON.parse(stored));
  }catch(err){
    console.warn('[phantom] save load failed, starting fresh',err);
    return defaultSave();
  }
}

let writeTimer=null;

export function saveGame(save){
  try{
    localStorage.setItem(KEY,JSON.stringify(save));
    return true;
  }catch(err){
    console.warn('[phantom] save write failed',err);
    return false;
  }
}

// Coalesces bursts of writes (menu navigation, purchases) into one commit.
export function saveGameDeferred(save,delay=400){
  if(writeTimer)clearTimeout(writeTimer);
  writeTimer=setTimeout(()=>{writeTimer=null;saveGame(save)},delay);
}

export function exportSave(save){
  return btoa(unescape(encodeURIComponent(JSON.stringify(save))));
}

export function importSave(code){
  const parsed=JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  return normalizeSave(parsed);
}

export function resetSave(){
  try{
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  }catch{/* storage may be unavailable; the fresh object still works */}
  return defaultSave();
}
