// Does a theatre sound like anywhere?
//
// The `ambience` bus was built, connected and routed to by nothing at all, so
// ten theatres — a flooded exclusion zone, a glacial basin, an active munitions
// plant — were all the same empty room between gunshots.
//
// The assertions that matter here are the leak ones. A continuous voice is easy
// to start and easy to believe in; what goes wrong is that it never stops, and
// a bed still playing under the command centre is the kind of bug you ship.
//
// Storage key: `red-static-save` is the live one and a seed must carry a
// version, or `migrate` rebuilds it from defaults and the harness quietly tests
// a save it did not write.
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
await p.waitForTimeout(2500);

const out=await p.evaluate(async()=>{
  const {AMBIENCE,ambienceFor}=await import('/data/ambience.js');
  const {MAPS}=await import('/data/maps.js');
  const a=window.__pp.engine.audio;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const res={};

  // 1. Coverage. Every theatre in the game has a bed of its own, and the beds
  //    are actually different from one another rather than one preset copied.
  res.theatres=MAPS.length;
  res.missing=MAPS.filter(m=>!AMBIENCE[m.id]).map(m=>m.id);
  const signature=id=>{
    const b=AMBIENCE[id];
    return JSON.stringify([b.air&&[b.air.freq,b.air.filter,b.air.gain],b.hum&&b.hum.freq,
      (b.events||[]).map(e=>e.sound).sort()]);
  };
  const sigs=MAPS.filter(m=>AMBIENCE[m.id]).map(m=>signature(m.id));
  res.distinctBeds=new Set(sigs).size;
  res.eventKinds=[...new Set(Object.values(AMBIENCE).flatMap(b=>(b.events||[]).map(e=>e.sound)))].sort();
  // A theatre nobody wrote a bed for must land somewhere real, not on silence.
  res.unknownTheatre=!!ambienceFor('a-theatre-that-does-not-exist');

  // 2. It is actually running during a contract, and it is on its own bus.
  res.liveDuringContract=!!a.ambience;
  res.beddedParts=a.ambience?a.ambience.parts.length:0;
  res.scheduledEvents=a.ambience?a.ambience.timers.length:0;

  // 3. The bed fades in. A bed that arrives at full level on the first frame
  //    is heard as a glitch, which is the opposite of the point.
  res.fadesIn=a.ambience?a.ambience.out.gain.value<1:false;

  // 4. Events do not fire on a fixed interval. This watches the real
  //    scheduler: an earlier version of this assertion generated its own
  //    random numbers and checked those, which proved that Math.random is
  //    random and nothing whatsoever about the game.
  const gaps=[];
  {
    const realTimeout=window.setTimeout;
    window.setTimeout=(fn,ms)=>{gaps.push(ms);return realTimeout(()=>{},0)};
    for(let i=0;i<40;i++)a.scheduleAmbientEvent({sound:'drip',every:[4,11],gain:.5});
    window.setTimeout=realTimeout;
  }
  res.sampledGaps=gaps.length;
  res.distinctGaps=new Set(gaps).size;
  res.gapRange=gaps.length?[Math.round(Math.min(...gaps)),Math.round(Math.max(...gaps))]:null;
  // Every gap must land inside the range the profile asked for, or the numbers
  // are varied but not the numbers anybody wrote down.
  res.gapsInRange=gaps.every(g=>g>=4000&&g<=11000);

  // 5. Stopping actually stops. The nodes have to be stopped, not just faded:
  //    a gain ramp is a promise about a value and says nothing about the
  //    oscillators behind it.
  const parts=a.ambience?a.ambience.parts.slice():[];
  let stopCalls=0;
  for(const part of parts){
    const real=part.stop.bind(part);
    part.stop=t=>{stopCalls++;return real(t)};
  }
  a.stopAmbience();
  res.stoppedNodes=stopCalls;
  res.clearedAfterStop=!a.ambience;
  // A pending timer surviving the stop puts a drip over the results screen.
  //
  // Calling `scheduleAmbientEvent` by hand after the stop does not test this —
  // it returns at its own opening guard whatever the timers are doing. The
  // only honest test is to leave a real timer in flight, stop, and wait past
  // when it would have fired.
  {
    a.startAmbience({air:{freq:300,q:.5,gain:.01,filter:'lowpass'},hum:null,
      events:[{sound:'drip',every:[.05,.06],gain:.01}]});
    let fired=0;
    const realEvent=a.ambientEvent.bind(a);
    a.ambientEvent=(...args)=>{fired++;return realEvent(...args)};
    a.stopAmbience();
    await wait(320);
    a.ambientEvent=realEvent;
    res.eventsAfterStop=fired;
  }

  // 6. Restart must not double up. Two beds playing at once is the classic
  //    outcome of a start that does not check.
  a.startAmbience(ambienceFor('hollow'));
  const first=a.ambience;
  a.startAmbience(ambienceFor('foundry'));
  res.doubleStartIgnored=a.ambience===first;
  a.stopAmbience();
  await wait(30);
  res.silentAfterFinalStop=!a.ambience;

  // 7. Integration. Everything above proves `stopAmbience` works and proves
  //    nothing about whether the game ever calls it. A bed that survives into
  //    the command centre is the whole reason this harness exists.
  const eng=window.__pp.engine;
  a.startAmbience(ambienceFor('blacksite'));
  res.liveBeforeFinish=!!a.ambience;
  // `finish` is isolated deliberately. Left alone it cascades into the session
  // teardown, which also stops the bed — so the assertion passed with the stop
  // removed from `finish` entirely, and proved only that *something* somewhere
  // cleaned up. Cutting the cascade tests the one path this claims to test.
  const realOnEnd=eng.onEnd;
  eng.onEnd=()=>{};
  eng.ended=false;
  eng.finish(false,'harness');
  eng.onEnd=realOnEnd;
  res.stoppedByFinish=!a.ambience;
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
if(out.missing.length)fail.push(`${out.missing.length} theatre(s) have no bed: ${out.missing}`);
if(out.distinctBeds<out.theatres)fail.push(`${out.theatres} theatres share only ${out.distinctBeds} distinct beds`);
if(out.eventKinds.length<6)fail.push(`only ${out.eventKinds.length} kinds of ambient event across every theatre`);
if(!out.unknownTheatre)fail.push('an unknown theatre falls back to silence instead of a real bed');
if(!out.liveDuringContract)fail.push('no ambience is running during a contract');
if(out.beddedParts<1)fail.push('the bed has no continuous layers');
if(out.scheduledEvents<1)fail.push('no ambient events were scheduled');
if(!out.fadesIn)fail.push('the bed arrives at full level instead of fading in');
if(out.sampledGaps<40)fail.push(`the scheduler was asked for 40 gaps and produced ${out.sampledGaps}`);
if(out.distinctGaps<35)fail.push(`ambient events fire on a fixed interval (${out.distinctGaps} distinct gaps in ${out.sampledGaps})`);
if(!out.gapsInRange)fail.push(`gaps fell outside the profile's range: ${out.gapRange}`);
if(out.stoppedNodes<out.beddedParts)fail.push(`stopping faded ${out.beddedParts} nodes but stopped only ${out.stoppedNodes} — the oscillators keep running`);
if(!out.clearedAfterStop)fail.push('the ambience handle survives stopAmbience');
if(out.eventsAfterStop)fail.push(`${out.eventsAfterStop} ambient event(s) fired after the stop`);
if(!out.doubleStartIgnored)fail.push('starting a second bed over a running one was allowed');
if(!out.silentAfterFinalStop)fail.push('ambience still running after the final stop');
if(!out.liveBeforeFinish)fail.push('the harness could not start a bed to test the contract ending');
if(!out.stoppedByFinish)fail.push('the bed survived the end of the contract and plays under the results screen');
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nevery theatre has a bed');
await b.close();
