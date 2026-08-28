// Does a gunship overhead actually push the score out of the way?
//
// The rotor is a continuous voice, so it cannot use the event `DUCKING` table
// the weapons go through — this asserts the side-chain that replaces it, and
// the things a side-chain gets wrong: not releasing, releasing instantly,
// stacking with the event duck, and surviving teardown.
//
// Storage key: `red-static-save` is the live one, and a seed must carry a
// version. `phantom-protocol-save` is a legacy name the game reads as a
// fallback and never writes; a versionless seed is migrated away from and the
// harness silently tests a default save.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const p=await b.newPage({viewport:{width:900,height:600}});
const errs=[];p.on('pageerror',e=>errs.push(String(e&&e.stack||e).split('\n')[0]));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(400);
await p.evaluate(()=>{localStorage.setItem('red-static-save',JSON.stringify({version:3,campaign:{op1:{completed:true}},statistics:{missions:2},maps:{blacksite:{unlocked:true}},settings:{renderer:'2d',showMinimap:false,audioMix:2}}));});
await p.reload({waitUntil:'load'});await p.waitForTimeout(700);
await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());await p.waitForTimeout(300);
await p.evaluate(()=>{[...document.querySelectorAll('button,a')].find(e=>/DEPLOY/i.test(e.textContent))?.click()});await p.waitForTimeout(250);
await p.evaluate(()=>document.querySelector('[data-map="blacksite"]')?.click());await p.waitForTimeout(250);
await p.evaluate(()=>document.querySelector('#deployBtn')?.click());
await p.waitForTimeout(2200);

const out=await p.evaluate(async()=>{
  const a=window.__pp.engine.audio;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const res={};
  // The rotor's own duck, read directly. The combined level cannot be used for
  // these: the contract is running, so real gunfire is pulling the event duck
  // the whole time, and `musicDuckLevel` takes the minimum of the two. Reading
  // it here measured the firefight and blamed the rotor.
  const rotor=()=>+(a.rotorDuck??1).toFixed(3);
  const reset=()=>{a.rotorDuck=1;a.rotorDuckAt=0;a.duck=1};

  reset();
  res.quiet=rotor();

  // A gunship arriving at full proximity. The pull must be immediate — one
  // call, not a ramp the caller has to keep feeding.
  a.setRotor(1);
  res.overhead=rotor();

  // Holding. A side-chain must not decay while the helicopter is still there,
  // which is exactly what an event duck would do.
  await wait(700);
  a.setRotor(1);
  res.stillOverhead=rotor();

  // Gunfire underneath it. The two ducks are combined, and must not multiply
  // into silence. Set and read with nothing awaited in between, so the live
  // contract cannot move the event duck mid-measurement.
  a.duck=.78;
  res.firingUnderneath=+a.musicDuckLevel.toFixed(3);
  res.wouldBeIfMultiplied=+(.78*res.overhead).toFixed(3);
  a.duck=1;

  // Leaving. Eased, not instant: after one real frame it must have moved, and
  // must be nowhere near back to full.
  //
  // The wait is the point. The release is measured against the wall clock, so
  // two calls in the same synchronous block are separated by no time and
  // correctly move nothing — asserting on that pair tests the harness's own
  // impatience, not the easing.
  a.setRotor(0);
  await wait(16);
  a.setRotor(0);
  res.oneFrameAfterLeaving=rotor();

  // ...and fully recovered a second and a half later, with the render loop
  // still calling setRotor as it really does.
  for(let i=0;i<90;i++){a.setRotor(0);await wait(20);}
  res.afterLeaving=rotor();

  // Half distance should be half the depth.
  reset();
  a.setRotor(.5);
  res.halfDistance=rotor();

  // Teardown mid-flyover: the engine can stop the rotor directly at the end of
  // a contract, and nothing calls setRotor again afterwards.
  reset();
  a.setRotor(1);
  res.heldBeforeTeardown=rotor();
  a.stopRotor();
  res.afterTeardown=rotor();
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
const near=(a,b,tol=.02)=>Math.abs(a-b)<=tol;
if(!near(out.quiet,1))fail.push(`score is ducked with nothing airborne (${out.quiet})`);
if(out.overhead>=1)fail.push('a gunship overhead does not duck the score at all');
if(!near(out.overhead,.65,.03))fail.push(`overhead duck is ${out.overhead}, expected about .65`);
if(!near(out.stillOverhead,out.overhead,.01))fail.push(`the duck decayed while the gunship was still overhead (${out.overhead} -> ${out.stillOverhead})`);
if(!near(out.firingUnderneath,out.overhead,.01))fail.push(`firing under a gunship stacked the ducks (${out.firingUnderneath}, multiplying would give ${out.wouldBeIfMultiplied})`);
// "Not instant", not "not much". The release is measured against the wall
// clock, so how far it travels in one wait depends on how long that wait
// really took — and on a loaded machine a nominal 16ms frame can be ten times
// that, recovering correctly and tripping a tight threshold. What actually
// distinguishes an eased release from an instant one is that it has not
// finished yet.
if(out.oneFrameAfterLeaving>.99)fail.push(`the score snapped back too fast when the gunship left (${out.oneFrameAfterLeaving} after one frame)`);
if(out.oneFrameAfterLeaving<=out.overhead)fail.push('the score did not start recovering when the gunship left');
if(!near(out.afterLeaving,1))fail.push(`the score never came back after the gunship left (${out.afterLeaving})`);
if(!near(out.halfDistance,.825,.03))fail.push(`half distance ducked ${out.halfDistance}, expected about .825`);
if(!near(out.afterTeardown,1))fail.push(`teardown left the score ducked under a helicopter that no longer exists (${out.afterTeardown})`);
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nrotor side-chain intact');
await b.close();
