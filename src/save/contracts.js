// Rotating-contract results.
//
// Only the operator's best attempt at each contract is kept. "Best" is survival
// first and score second: a contract survived beats any score set on a run that
// ended early, because the contract is the same for everybody and finishing it
// is the thing being compared.

function betterThan(next,current){
  if(!current)return true;
  if(!!next.survived!==!!current.survived)return !!next.survived;
  if((next.score||0)!==(current.score||0))return (next.score||0)>(current.score||0);
  return (next.timeSurvived||0)>(current.timeSurvived||0);
}

export function contractRecord(save,contract){
  return save.contracts?.[contract.key]||null;
}

export function recordContract(save,contract,summary){
  if(!save.contracts)save.contracts={};
  const attempt={
    kind:contract.kind,
    key:contract.key,
    map:contract.map.id,
    modifier:contract.modifier?.id||null,
    difficulty:contract.difficulty.id,
    duration:contract.duration.minutes,
    survived:!!summary.survived,
    score:Math.round(summary.score||0),
    kills:summary.kills||0,
    level:summary.level||0,
    timeSurvived:Math.round(summary.timeSurvived||summary.elapsed||0),
    setAt:Date.now()
  };
  const current=save.contracts[contract.key];
  const attempts=(current?.attempts||0)+1;
  if(betterThan(attempt,current))save.contracts[contract.key]={...attempt,attempts};
  else save.contracts[contract.key]={...current,attempts};
  return save.contracts[contract.key];
}
