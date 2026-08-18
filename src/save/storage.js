const KEY='phantom-protocol-save-v1';
export function defaultSave(){return {version:1,profile:{currency:0,jp:0,directives:0},progression:{},operatives:{vesper:{rank:1,jpSpent:0},bastion:{rank:1,jpSpent:0},mirage:{rank:1,jpSpent:0},wraith:{rank:1,jpSpent:0}},weapons:{},achievements:{},milestones:{},intelligence:{},statistics:{missions:0,wins:0,kills:0,bosses:0,playtime:0,highestLevel:1,longestSurvival:0},settings:{master:1,music:.7,sfx:.8,screenShake:true,damageNumbers:true,particles:'high',performance:false,uiScale:1,touchSize:1}}}
export function loadSave(){try{return {...defaultSave(),...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return defaultSave()}}
export function saveGame(s){localStorage.setItem(KEY,JSON.stringify(s))}
export function exportSave(s){return btoa(unescape(encodeURIComponent(JSON.stringify(s))))}
export function importSave(code){return JSON.parse(decodeURIComponent(escape(atob(code))))}
export function resetSave(){localStorage.removeItem(KEY);return defaultSave()}
