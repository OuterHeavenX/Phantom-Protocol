const KEY='phantom-protocol-save-v1';
const BASE_STATS={missions:0,wins:0,kills:0,bosses:0,playtime:0,highestLevel:1,longestSurvival:0,totalJp:0,totalCredits:0,intelRecovered:0};
const BASE_VESPER={rank:1,jpSpent:0,upgrades:{}};
export function defaultSave(){return {version:2,profile:{currency:0,jp:0,directives:0},progression:{},operatives:{vesper:{...BASE_VESPER},bastion:{rank:1,jpSpent:0,upgrades:{}},mirage:{rank:1,jpSpent:0,upgrades:{}},wraith:{rank:1,jpSpent:0,upgrades:{}}},weapons:{},achievements:{},milestones:{},intelligence:{scar:true,glasshouse:true},statistics:{...BASE_STATS},settings:{master:1,music:.7,sfx:.8,screenShake:true,damageNumbers:true,particles:'high',performance:false,uiScale:1,touchSize:1}}}
function mergeSave(raw={}){const d=defaultSave(),ops={...d.operatives,...(raw.operatives||{})};for(const id of Object.keys(ops))ops[id]={...d.operatives[id],...ops[id],upgrades:{...(d.operatives[id]?.upgrades||{}),...(ops[id]?.upgrades||{})}};return {...d,...raw,profile:{...d.profile,...(raw.profile||{})},progression:{...d.progression,...(raw.progression||{})},operatives:ops,weapons:{...d.weapons,...(raw.weapons||{})},achievements:{...d.achievements,...(raw.achievements||{})},milestones:{...d.milestones,...(raw.milestones||{})},intelligence:{...d.intelligence,...(raw.intelligence||{})},statistics:{...d.statistics,...(raw.statistics||{})},settings:{...d.settings,...(raw.settings||{})},version:2}}
export function loadSave(){try{return mergeSave(JSON.parse(localStorage.getItem(KEY)||'{}'))}catch{return defaultSave()}}
export function saveGame(s){localStorage.setItem(KEY,JSON.stringify(s))}
export function exportSave(s){return btoa(unescape(encodeURIComponent(JSON.stringify(s))))}
export function importSave(code){return mergeSave(JSON.parse(decodeURIComponent(escape(atob(code)))))}
export function resetSave(){localStorage.removeItem(KEY);return defaultSave()}
