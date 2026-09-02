// Do the accessibility settings actually do anything?
//
// The colour-vision setting was written into every save since the settings
// screen shipped and read by nothing at all, which is worse than not offering
// it: somebody who needs it turns it on, sees no change, and concludes the game
// does not care. So the assertions here are about effect and persistence, not
// about the control existing.
//
// Persistence is tested from genuinely empty storage each time. A setting that
// appears to survive a reload because a previous run left it there is the exact
// failure this file exists to catch, and it has caught it before in this
// project.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const p=await b.newPage({viewport:{width:1280,height:800}});
const errs=[];p.on('pageerror',e=>errs.push(String(e&&e.stack||e).split('\n')[0]));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(400);

const res={};

// ---- 1. Fresh boot: the accommodation is off and nothing is recoloured -----
await p.evaluate(()=>localStorage.removeItem('red-static-save'));
await p.reload({waitUntil:'load'});await p.waitForTimeout(700);
await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
await p.waitForTimeout(400);
Object.assign(res,await p.evaluate(async()=>{
  const {colorblindMode,colorblindActive,roleColor,PALETTES}=await import('/data/colorblind.js');
  return{
    freshMode:colorblindMode(),
    freshActive:colorblindActive(),
    freshHostile:roleColor('hostile'),
    modes:Object.keys(PALETTES),
    // The roles that carry meaning must all exist in every palette, or a mode
    // silently falls back to the default colour for whichever one is missing.
    completePalettes:Object.values(PALETTES).every(pal=>
      ['hostile','warning','hazard','friendly','objective','pickup'].every(r=>!!pal[r]))
  };
}));

// ---- 2. Every mode actually changes the colours that carry meaning ---------
Object.assign(res,await p.evaluate(async()=>{
  const {setColorblindMode,roleColor,PALETTES}=await import('/data/colorblind.js');
  const out={separated:{},changed:{}};
  for(const mode of Object.keys(PALETTES)){
    setColorblindMode(mode);
    const hostile=roleColor('hostile'),warning=roleColor('warning');
    out.changed[mode]=[hostile,warning,roleColor('objective')].join(',');
    // The pair this game actually fails on is incoming fire against a
    // telegraph — not red against green, of which there is none. Compare them
    // by lightness, which is the channel every colour deficiency keeps.
    const lum=hex=>{
      const n=parseInt(hex.slice(1),16);
      return (((n>>16)&255)*.2126+((n>>8)&255)*.7152+(n&255)*.0722)/255;
    };
    out.separated[mode]=+Math.abs(lum(hostile)-lum(warning)).toFixed(3);
  }
  setColorblindMode('none');
  return out;
}));

// ---- 3. Persistence across a reload, from empty storage -------------------
await p.evaluate(async()=>{
  const {SAVE_VERSION}=await import('/src/save/storage.js');
  const s=JSON.parse(localStorage.getItem('red-static-save')||'null')||{};
  s.settings={...(s.settings||{}),colorblind:'protanopia',reducedFlashing:true};
  s.version=SAVE_VERSION;
  localStorage.setItem('red-static-save',JSON.stringify(s));
});
await p.reload({waitUntil:'load'});await p.waitForTimeout(800);
await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
await p.waitForTimeout(400);
Object.assign(res,await p.evaluate(async()=>{
  const {colorblindMode,colorblindActive}=await import('/data/colorblind.js');
  const saved=JSON.parse(localStorage.getItem('red-static-save')).settings;
  return{
    afterReloadMode:colorblindMode(),
    afterReloadActive:colorblindActive(),
    savedColorblind:saved.colorblind,
    savedReducedFlashing:saved.reducedFlashing,
    // Applied on load, not only when the settings screen is next opened.
    flashingClass:document.documentElement.classList.contains('reduced-flashing')
  };
}));

// ---- 4. An older save with no field at all must not break or reset --------
await p.evaluate(async()=>{
  const {SAVE_VERSION}=await import('/src/save/storage.js');
  localStorage.setItem('red-static-save',JSON.stringify({
    version:SAVE_VERSION,
    campaign:{op1:{completed:true}},
    declassified:{reflex1:true},
    seen:{sections:{deploy:'seen'},dev:{},weapons:{}},
    settings:{master:.85,music:.38,sfx:1}
  }));
});
await p.reload({waitUntil:'load'});await p.waitForTimeout(800);
await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
await p.waitForTimeout(400);
Object.assign(res,await p.evaluate(async()=>{
  const {colorblindMode}=await import('/data/colorblind.js');
  const saved=JSON.parse(localStorage.getItem('red-static-save'));
  return{
    legacyMode:colorblindMode(),
    legacyKeptCampaign:!!saved.campaign?.op1?.completed,
    legacyKeptDeclassified:!!saved.declassified?.reflex1,
    legacyKeptSeen:saved.seen?.sections?.deploy==='seen'
  };
}));

// ---- 5. reducedFlashing genuinely attenuates -------------------------------
Object.assign(res,await p.evaluate(async()=>{
  const {Fx}=await import('/src/game/fx.js');
  const on=new Fx({reducedFlashing:true}),off=new Fx({reducedFlashing:false});
  on.flash('#fff',1);off.flash('#fff',1);
  // `screenFlash`, not `flashIntensity`. The first version of this read a field
  // that does not exist, got undefined for both, and reported them as equal —
  // a failure that looked like the feature being broken when it was the
  // assertion reading the wrong thing.
  return{flashReduced:+(on.screenFlash??0).toFixed(3),
         flashNormal:+(off.screenFlash??0).toFixed(3)};
}));

console.log(JSON.stringify(res,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
if(res.freshMode!=='none')fail.push(`a fresh save starts in ${res.freshMode} instead of off`);
if(res.freshActive)fail.push('a fresh save reports an accommodation active');
if(res.modes.length<4)fail.push(`only ${res.modes.length} colour-vision modes offered`);
if(!res.completePalettes)fail.push('a palette is missing a semantic role and silently falls back');
const distinct=new Set(Object.values(res.changed)).size;
if(distinct<res.modes.length)fail.push(`${res.modes.length} modes produce only ${distinct} distinct palettes — some do nothing`);
for(const [mode,sep] of Object.entries(res.separated)){
  if(mode==='none')continue;
  if(sep<.12)fail.push(`in ${mode}, incoming fire and a telegraph differ by only ${sep} in lightness`);
}
if(res.afterReloadMode!=='protanopia')fail.push(`the mode did not survive a reload (got ${res.afterReloadMode})`);
if(!res.afterReloadActive)fail.push('the mode survived the reload but reports inactive');
if(res.savedColorblind!=='protanopia')fail.push('the save no longer holds the chosen mode');
if(!res.flashingClass)fail.push('reduced flashing is not applied on load');
if(res.legacyMode!=='none')fail.push(`a save with no colour-vision field came back as ${res.legacyMode}`);
if(!res.legacyKeptCampaign)fail.push('loading an older save lost campaign progress');
if(!res.legacyKeptDeclassified)fail.push('loading an older save relocked a declassified node');
if(!res.legacyKeptSeen)fail.push('loading an older save lost what had been seen');
if(!(res.flashReduced<res.flashNormal))fail.push(`reduce-flashing does not attenuate (${res.flashReduced} vs ${res.flashNormal})`);
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\naccessibility settings do something');
await b.close();
