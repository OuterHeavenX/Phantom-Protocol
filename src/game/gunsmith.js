import {
  ATTACHMENTS_BY_ID,SLOTS,attachmentsFor,defaultBuild,
  rankForXp,rankProgress
} from '../../data/attachments.js';
import {WEAPONS_BY_ID} from '../../data/weapons.js';

// Resolves a saved weapon build into the modifier table the combat runtime
// applies. Everything the Gunsmith screen shows and everything the simulation
// reads comes through here, so a preview in the menu and the weapon in hand
// can never disagree.

// Stats an attachment may touch. `mult` entries multiply the resolved value;
// `add` entries are added afterwards. Anything not listed is ignored, so a
// typo in the registry cannot quietly introduce a new stat.
export const MODIFIABLE=new Set([
  'damage','cooldown','spread','range','speed','count','pierce',
  'knockback','blastRadius','critChance','critDamage','moveSpeed'
]);

// Stats where a smaller number is the better outcome, for UI colouring.
export const LOWER_IS_BETTER=new Set(['cooldown','spread']);

const EMPTY={mult:{},add:{},optic:null,field:{}};

// Whether an attachment is available on a weapon at its current rank.
export function attachmentUnlocked(attachment,rank){
  return !!attachment&&rank>=attachment.rank;
}

// The build actually usable right now: anything referencing a locked or
// unknown attachment falls back to that slot's default, so a save edited by
// hand or carried across a data change can never equip something unearned.
export function sanitizeBuild(weapon,build,rank){
  const safe=defaultBuild(weapon);
  if(!build)return safe;
  for(const slot of SLOTS){
    const id=build[slot.id];
    if(!id)continue;
    const attachment=ATTACHMENTS_BY_ID[id];
    if(!attachment||attachment.slot!==slot.id)continue;
    if(attachment.only&&!attachment.only.includes(weapon.category))continue;
    if(!attachmentUnlocked(attachment,rank))continue;
    safe[slot.id]=id;
  }
  return safe;
}

// Folds a build into one modifier table.
export function resolveBuild(weapon,build,rank=1){
  if(!weapon)return{...EMPTY};
  const safe=sanitizeBuild(weapon,build,rank);
  const mult={},add={},field={};
  let optic=null;

  for(const slot of SLOTS){
    const attachment=ATTACHMENTS_BY_ID[safe[slot.id]];
    if(!attachment)continue;
    for(const [key,value] of Object.entries(attachment.mult||{})){
      if(!MODIFIABLE.has(key))continue;
      mult[key]=(mult[key]??1)*value;
    }
    for(const [key,value] of Object.entries(attachment.add||{})){
      if(!MODIFIABLE.has(key))continue;
      add[key]=(add[key]??0)+value;
    }
    for(const [key,value] of Object.entries(attachment.field||{})){
      field[key]=(field[key]??0)+value;
    }
    // Optic properties accumulate so a designator can stack with a scope.
    if(attachment.optic){
      optic=optic||{acquisition:1,reticle:null,marks:false,zoom:1};
      optic.acquisition*=attachment.optic.acquisition??1;
      optic.zoom*=attachment.optic.zoom??1;
      optic.marks=optic.marks||!!attachment.optic.marks;
      if(attachment.optic.reticle)optic.reticle=attachment.optic.reticle;
    }
  }
  return{mult,add,optic,field,build:safe};
}

// Applies the resolved table to one stat. Called from WeaponInstance.stat for
// every weapon stat the simulation reads.
export function applyMods(mods,key,value){
  if(!mods)return value;
  let out=value;
  if(mods.mult&&mods.mult[key]!==undefined)out*=mods.mult[key];
  if(mods.add&&mods.add[key]!==undefined)out+=mods.add[key];
  // Counts and pierce are whole things; a fractional projectile is not a
  // projectile, and rounding at the point of use would round inconsistently.
  if(key==='count'||key==='pierce')out=Math.max(0,Math.round(out));
  if(key==='cooldown')out=Math.max(.02,out);
  if(key==='spread')out=Math.max(0,out);
  return out;
}

// ---- UI support -----------------------------------------------------------

// The stat line shown on the bench: base weapon value versus built value.
export function previewStats(weapon,build,rank=1){
  const mods=resolveBuild(weapon,build,rank);
  const keys=['damage','cooldown','range','spread','count','pierce'];
  return keys
    .filter(key=>weapon[key]!==undefined)
    .map(key=>{
      const base=weapon[key];
      const built=applyMods(mods,key,base);
      const delta=base===0?0:(built-base)/Math.abs(base);
      return{
        key,base,built,delta,
        better:LOWER_IS_BETTER.has(key)?built<base:built>base,
        worse:LOWER_IS_BETTER.has(key)?built>base:built<base
      };
    });
}

// A single 0..1 score per axis for the bench's summary bars. Deliberately
// coarse: it is a shape at a glance, not a spreadsheet.
export function buildProfile(weapon,build,rank=1){
  const mods=resolveBuild(weapon,build,rank);
  const value=key=>applyMods(mods,key,weapon[key]??0);
  const damage=value('damage')*(value('count')||1);
  const rate=1/Math.max(.05,value('cooldown')||.5);
  return{
    power:Math.min(1,damage/90),
    rate:Math.min(1,rate/6),
    reach:Math.min(1,(value('range')||300)/900),
    control:Math.min(1,1-Math.min(1,(value('spread')??0)/.5))
  };
}

export function weaponRank(record){return rankForXp(record?.xp||0)}
export function weaponRankProgress(record){return rankProgress(record?.xp||0)}

// Attachments a weapon has earned but not yet fitted anywhere, for the "new"
// badge on the bench.
export function newlyUnlocked(weapon,record){
  const rank=weaponRank(record);
  const seen=new Set(record?.seenAttachments||[]);
  const found=[];
  for(const slot of SLOTS){
    for(const attachment of attachmentsFor(slot.id,weapon.category)){
      if(attachmentUnlocked(attachment,rank)&&!seen.has(attachment.id)){
        found.push(attachment);
      }
    }
  }
  return found;
}

export function weaponFor(id){return WEAPONS_BY_ID[id]||null}

// ---- Presets ---------------------------------------------------------------
//
// A weapon's bench state is three separate things — the attachment build, the
// secondary-fire module and the livery — and switching between two ways of
// carrying the same gun meant re-fitting all of them a slot at a time. A preset
// is one named copy of the lot.
//
// Presets are stored on the weapon record rather than on the profile, because
// that is where everything else about a weapon already lives: experience, rank
// and the build itself are account-wide and belong to the weapon, not to
// whoever is carrying it.

export const MAX_PRESETS=4;

// A snapshot of how the weapon is set up right now. The build is sanitised on
// the way in so a preset can never carry an attachment the weapon has not
// earned, even if the record it was taken from somehow did.
export function makePreset(weapon,record,rank,name){
  // Upper-cased to match every other label on the bench; the list and the
  // name field would otherwise disagree about how a build is written.
  const clean=String(name||'').trim().slice(0,24).toUpperCase();
  return{
    id:`p${Date.now().toString(36)}${Math.floor(Math.random()*1e4).toString(36)}`,
    name:clean||`BUILD ${((record?.presets?.length)||0)+1}`,
    build:sanitizeBuild(weapon,record?.build,rank),
    ordnance:record?.ordnance||null,
    livery:record?.livery||null,
    savedAt:Date.now()
  };
}

// Stores a preset, newest first, dropping the oldest past the cap. A preset
// whose name matches an existing one replaces it rather than adding a
// near-duplicate, so re-saving after a tweak does what it looks like it does.
export function storePreset(record,preset){
  if(!Array.isArray(record.presets))record.presets=[];
  const key=preset.name.toLowerCase();
  const existing=record.presets.findIndex(p=>p.name.toLowerCase()===key);
  if(existing>=0)record.presets.splice(existing,1);
  record.presets.unshift(preset);
  record.presets.length=Math.min(record.presets.length,MAX_PRESETS);
  return preset;
}

export function deletePreset(record,id){
  if(!Array.isArray(record.presets))return false;
  const before=record.presets.length;
  record.presets=record.presets.filter(p=>p.id!==id);
  return record.presets.length!==before;
}

// Writes a preset back onto the record. Sanitised again on the way out: a
// preset saved before a data change might name an attachment that no longer
// exists, and a build is the one thing here that reaches the simulation.
export function applyPreset(weapon,record,preset,rank){
  if(!preset)return false;
  record.build=sanitizeBuild(weapon,preset.build,rank);
  if(preset.ordnance)record.ordnance=preset.ordnance;
  if(preset.livery)record.livery=preset.livery;
  return true;
}
