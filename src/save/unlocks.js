// Command-centre progression.
//
// The game used to open with every door already unlocked: eleven navigation
// items, a deployment screen, a gunsmith with nothing to fit, and a development
// tree showing fifty upgrades the operator could not afford any of. That is not
// a command centre, it is a menu — and it tells a new operator nothing about
// what to do first.
//
// A section is either **granted** or **classified**. Classified is not greyed
// out: the operator can see that something is there and what it will take, and
// nothing else. The difference matters — a greyed button says "you failed", a
// classified one says "not yet cleared", which is the tone this game is in.
//
// Every gate below reads state the game already records. Nothing here invents a
// new counter, and nothing is stored that could disagree with the save.

import {DEV_TREE,devNodeCost,devRequirementsMet,accountLevel} from '../../data/meta.js';
import {WEAPONS} from '../../data/weapons.js';

// The ladder.
//
// `when` returns true once the section is cleared for access. `need` is what
// the operator is told while it is not — written as an instruction, not as a
// refusal.
export const SECTIONS={
  campaign:{always:true},
  operatives:{always:true},
  armory:{always:true},
  development:{always:true},
  directives:{always:true},
  intel:{always:true},
  stats:{always:true},
  settings:{always:true},

  // The operator's own instruction: deployment opens once the first campaign
  // operation is closed. Until then the campaign is the only way into a sector,
  // which is what makes it read as the beginning rather than as one option
  // among eleven.
  deploy:{
    when:save=>campaignOpsCleared(save)>=1,
    need:'Close the first campaign operation'
  },

  // Rotating assignments are a reason to come back, and there is nothing to
  // come back to until free deployment exists and has been used once.
  contracts:{
    when:save=>campaignOpsCleared(save)>=1&&(save.statistics?.missions||0)>=2,
    need:'Complete two operations'
  },

  // A workshop with nothing to fit is a room full of empty benches. It opens
  // when the first attachment has actually been recovered.
  gunsmith:{
    when:save=>attachmentsFound(save)>=1,
    need:'Recover a weapon attachment in the field'
  }
};

export function campaignOpsCleared(save){
  const campaign=save?.campaign||{};
  let n=0;
  for(const id in campaign)if(campaign[id]?.completed)n++;
  return n;
}

export function attachmentsFound(save){
  const weapons=save?.weapons||{};
  let n=0;
  for(const id in weapons)n+=(weapons[id]?.seenAttachments||[]).length;
  return n;
}

// Whether a command-centre section is open, and what it wants if not.
export function sectionState(save,id){
  const spec=SECTIONS[id];
  if(!spec)return{granted:true,need:''};
  if(spec.always)return{granted:true,need:''};
  return{granted:!!spec.when(save),need:spec.need||''};
}

// ---------------------------------------------------------------------------
// Declassification
//
// A development node stays classified until the operator can actually afford
// it, and then stays visible for good.
//
// Permanence is the part that matters. Hiding it again the moment the points
// are spent would mean buying something makes the tree around it disappear,
// which reads as a bug however it is explained. The save records what has been
// cleared rather than recomputing it, so it can only ever go one way.
// ---------------------------------------------------------------------------

export function declassifiedSet(save){
  save.declassified=save.declassified||{};
  return save.declassified;
}

// Called wherever the operator's points or rating may have changed. Returns the
// nodes that became readable this time, so the caller can flag them as new.
export function refreshDeclassified(save){
  const cleared=declassifiedSet(save);
  const ranks=save.dev||{};
  const rating=accountLevel(save.profile?.accountXp||0).level;
  const jp=save.profile?.jp||0;
  const fresh=[];
  for(const node of DEV_TREE){
    if(cleared[node.id])continue;
    // Already owned counts as cleared — a node with a rank in it can never be
    // secret, whatever the operator can currently afford.
    const rank=ranks[node.id]||0;
    const affordable=jp>=devNodeCost(node,rank);
    if(rank>0||(affordable&&devRequirementsMet(node,ranks,rating))){
      cleared[node.id]=true;
      fresh.push(node.id);
    }
  }
  return fresh;
}

export function isDeclassified(save,nodeId){
  return !!declassifiedSet(save)[nodeId];
}

// ---------------------------------------------------------------------------
// "NEW"
//
// Something is new when it has become available and the operator has not been
// to the screen that holds it since. Acknowledgement is per section, so opening
// DEVELOPMENT clears development's flag and nothing else's.
// ---------------------------------------------------------------------------

function seenRecord(save){
  save.seen=save.seen||{sections:{},dev:{},weapons:{}};
  save.seen.sections=save.seen.sections||{};
  save.seen.dev=save.seen.dev||{};
  save.seen.weapons=save.seen.weapons||{};
  return save.seen;
}

// Runs after anything that can change availability — a finished run, a
// purchase, a load.
//
// Returns whether anything actually changed, so a caller can decide whether the
// save is worth writing. That matters more than it looks: the command centre
// calls this on every render, and writing the save unconditionally there put a
// fresh file on disk before a caller had finished setting one up.
export function refreshAvailability(save){
  const seen=seenRecord(save);
  let changed=refreshDeclassified(save).length>0;

  // Sections that have just opened.
  for(const id in SECTIONS){
    const {granted}=sectionState(save,id);
    if(granted&&seen.sections[id]===undefined){seen.sections[id]='new';changed=true}
  }
  // Development nodes the operator can now read.
  for(const id in declassifiedSet(save)){
    if(seen.dev[id]===undefined){seen.dev[id]='new';changed=true}
  }
  // Weapons that have come off the shelf.
  for(const w of WEAPONS){
    if(save.weapons?.[w.id]?.unlocked&&seen.weapons[w.id]===undefined){
      seen.weapons[w.id]='new';changed=true;
    }
  }
  return changed;
}

// Which command-centre sections should wear a NEW badge.
export function newBySection(save){
  const seen=seenRecord(save);
  const out={};
  for(const id in seen.sections)if(seen.sections[id]==='new')out[id]=true;
  for(const id in seen.dev)if(seen.dev[id]==='new')out.development=true;
  for(const id in seen.weapons)if(seen.weapons[id]==='new')out.armory=true;
  return out;
}

// The operator has looked. Clears the badge for that section and everything
// counted under it.
// Returns whether anything was actually cleared, for the same reason.
export function acknowledgeSection(save,id){
  const seen=seenRecord(save);
  let changed=false;
  if(seen.sections[id]==='new'){seen.sections[id]='seen';changed=true}
  const clear=record=>{
    for(const key in record)if(record[key]==='new'){record[key]='seen';changed=true}
  };
  if(id==='development')clear(seen.dev);
  if(id==='armory')clear(seen.weapons);
  return changed;
}

// A fresh save has seen nothing, but should not open wearing eight badges
// either. Everything available at the very start counts as already seen; only
// what arrives later is new.
export function primeAvailability(save){
  const seen=seenRecord(save);
  refreshDeclassified(save);
  for(const id in SECTIONS){
    const {granted}=sectionState(save,id);
    if(granted)seen.sections[id]='seen';
  }
  for(const id in declassifiedSet(save))seen.dev[id]='seen';
  for(const w of WEAPONS){
    if(save.weapons?.[w.id]?.unlocked)seen.weapons[w.id]='seen';
  }
}

// What a load has to do to a save before the command centre reads it, and
// whether that changed anything worth writing.
//
// The answer matters more than it looks. This work used to happen inside
// `normalizeSave`, which returns only the save — so the change was made and
// the signal thrown away. The command centre then ran its own refresh, found
// the work already done, correctly reported "nothing changed", and never
// wrote. `seen` and `declassified` were therefore recomputed from the current
// balance on every single load and never reached disk: spending points
// re-hid the nodes they bought, and a section that opened while the operator
// was in the field opened silently.
export function reconcileOnLoad(save){
  // A save with no record of what it has been shown is being seen by this
  // ladder for the first time. Everything it already has counts as seen; only
  // what arrives afterwards is new.
  if(!save.seen){primeAvailability(save);return true}
  return refreshAvailability(save);
}
