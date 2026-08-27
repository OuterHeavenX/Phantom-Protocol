// Does the command centre actually gate, declassify and flag?
//
// Written against the ladder rather than the implementation: it drives the save
// through the states a real operator passes through and asserts what should be
// visible at each one.
//
// Note the storage key. `red-static-save` is the live one; `phantom-protocol-save`
// is a legacy name that is read as a fallback and never written. A harness that
// seeds the legacy key appears to work exactly once — until the game writes the
// real key, after which every seed is silently ignored.
// Storage key: `red-static-save` is the live one. `phantom-protocol-save` is a
// legacy name the game reads as a fallback and never writes — seeding that one
// works exactly once, until the game writes the real key, after which every
// seed is silently ignored and the harness tests a default save without saying
// so.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1280,height:800}});
const errs=[];p.on('pageerror',e=>errs.push(String(e&&e.stack||e).split('\n')[0]));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(500);

const nav=async()=>p.evaluate(()=>{
  const out={granted:[],classified:[],withNew:[]};
  for(const el of document.querySelectorAll('.nav-item')){
    const label=el.querySelector('.nav-label')?.textContent.replace('NEW','').trim();
    if(el.classList.contains('classified'))out.classified.push(el.querySelector('.nav-hint').textContent.trim());
    else out.granted.push(label);
    if(el.classList.contains('has-new'))out.withNew.push(label);
  }
  return out;
});
const setSave=async mutate=>{
  await p.evaluate(m=>{
    const raw=JSON.parse(localStorage.getItem('red-static-save')||'null');
    const s=raw||{};
    // eslint-disable-next-line no-new-func
    new Function('s',m)(s);
    localStorage.setItem('red-static-save',JSON.stringify(s));
  },mutate);
  await p.reload({waitUntil:'load'});
  await p.waitForTimeout(700);
  await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
  await p.waitForTimeout(500);
};

const results={};
// 1. Truly fresh: no save at all.
await p.evaluate(()=>localStorage.removeItem('red-static-save'));
await p.reload({waitUntil:'load'});await p.waitForTimeout(800);
await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
await p.waitForTimeout(500);
results.fresh=await nav();

// 2. Development on a fresh save: everything classified, nothing affordable.
results.freshDev=await p.evaluate(()=>{
  document.querySelector('[data-route="development"]')?.click();
  return new Promise(r=>setTimeout(()=>r({
    classified:document.querySelectorAll('.dev-node.classified').length,
    readable:document.querySelectorAll('.dev-node:not(.classified)').length
  }),300));
});

// 3. Enough JP to afford a tier-1 node.
await setSave("s.profile=s.profile||{};s.profile.jp=400;");
results.withJp=await p.evaluate(()=>{
  document.querySelector('[data-route="development"]')?.click();
  return new Promise(r=>setTimeout(()=>r({
    classified:document.querySelectorAll('.dev-node.classified').length,
    readable:document.querySelectorAll('.dev-node:not(.classified)').length
  }),300));
});
// After seeing it, spend it all — declassification must be permanent.
await setSave("s.profile.jp=0;");
results.afterSpending=await p.evaluate(()=>{
  document.querySelector('[data-route="development"]')?.click();
  return new Promise(r=>setTimeout(()=>r({
    readable:document.querySelectorAll('.dev-node:not(.classified)').length
  }),300));
});

// 4. First campaign operation closed -> DEPLOY.
await setSave("s.campaign={op1:{completed:true}};");
results.afterCampaign=await nav();

// 5. Two operations -> CONTRACTS.
await setSave("s.statistics=s.statistics||{};s.statistics.missions=2;");
results.afterTwoOps=await nav();

// 6. An attachment recovered -> GUNSMITH.
await setSave("s.weapons=s.weapons||{};s.weapons.needle=s.weapons.needle||{};s.weapons.needle.seenAttachments=['scope'];");
results.afterAttachment=await nav();

console.log(JSON.stringify(results,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
const has=(list,name)=>list.includes(name);
if(has(results.fresh.granted,'DEPLOY'))fail.push('DEPLOY available on a fresh save');
if(has(results.fresh.granted,'CONTRACTS'))fail.push('CONTRACTS available on a fresh save');
if(has(results.fresh.granted,'GUNSMITH'))fail.push('GUNSMITH available on a fresh save');
if(!has(results.fresh.granted,'CAMPAIGN'))fail.push('CAMPAIGN not available on a fresh save');
if(results.fresh.classified.length!==3)fail.push(`expected 3 classified sections, got ${results.fresh.classified.length}`);
if(results.fresh.withNew.length)fail.push('a fresh save opens wearing NEW badges');
if(results.freshDev.readable!==0)fail.push(`${results.freshDev.readable} dev nodes readable with 0 JP`);
if(results.withJp.readable===0)fail.push('no dev node declassified with 400 JP');
if(results.afterSpending.readable<results.withJp.readable)fail.push('declassification was lost when JP was spent');
if(!has(results.afterCampaign.granted,'DEPLOY'))fail.push('DEPLOY still locked after the first campaign op');
if(!has(results.afterCampaign.withNew,'DEPLOY'))fail.push('DEPLOY did not flag NEW when it unlocked');
if(has(results.afterCampaign.granted,'CONTRACTS'))fail.push('CONTRACTS opened too early');
if(!has(results.afterTwoOps.granted,'CONTRACTS'))fail.push('CONTRACTS still locked after two operations');
if(has(results.afterTwoOps.granted,'GUNSMITH'))fail.push('GUNSMITH opened without an attachment');
if(!has(results.afterAttachment.granted,'GUNSMITH'))fail.push('GUNSMITH still locked after an attachment');
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nprogression ladder intact');
await b.close();
