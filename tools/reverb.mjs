// Does the sector have a room, and is it the right one?
//
// Reverb is the easiest system in a mixer to fake: a wet gain that is never
// zero looks alive from the outside whatever it is connected to. So this
// asserts the connections, not just the levels — which categories reach the
// convolver, which must never, and whether the impulse actually changes when
// the theatre does.
//
// Storage key: `red-static-save` is the live one and a seed must carry a
// version, or `migrate` rebuilds it from defaults.
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
await p.waitForTimeout(2400);

const out=await p.evaluate(async()=>{
  const {REVERB,reverbFor}=await import('/data/reverb.js');
  const {MAPS}=await import('/data/maps.js');
  const a=window.__pp.engine.audio;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const res={};

  // 1. Coverage, and that the rooms are actually different rooms.
  res.theatres=MAPS.length;
  res.missing=MAPS.filter(m=>!REVERB[m.id]).map(m=>m.id);
  const sig=id=>{const r=REVERB[id];return [r.decay,r.curve,r.damping,r.wet].join('|')};
  res.distinctRooms=new Set(MAPS.filter(m=>REVERB[m.id]).map(m=>sig(m.id))).size;
  res.unknownIsDry=reverbFor('nowhere')===null;
  // Restraint: nothing may be a cathedral, and outdoor spaces must be quiet.
  res.longestDecay=Math.max(...Object.values(REVERB).map(r=>r.decay));
  res.wettest=Math.max(...Object.values(REVERB).map(r=>r.wet));
  // Snow is the most absorbent surface in the game and must be the deadest.
  res.snowIsDeadest=REVERB.hollow.wet===Math.min(...Object.values(REVERB).map(r=>r.wet));
  res.hangarRingsLongerThanSnow=REVERB.hangar.decay>REVERB.hollow.decay*3;

  // 2. Routing. Which categories reach the room, and which must never.
  res.sends=Object.keys(a.reverbSends||{}).sort();
  res.uiHasNoSend=!a.reverbSends?.ui;
  res.alertHasNoSend=!a.reverbSends?.alert;
  res.dryPathIntact=!!a.channels.playerWeapon&&!!a.sfxBus;

  // 3. The room is live during a contract, and is the theatre's own.
  a.setReverbProfile(reverbFor('blacksite'));
  await wait(60);
  res.liveWet=+a.reverbSends.playerWeapon.gain.value.toFixed(4);
  res.liveReturn=+a.reverbReturn.gain.value.toFixed(3);
  res.impulseSeconds=a.convolver.buffer?+(a.convolver.buffer.length/a.ctx.sampleRate).toFixed(3):0;
  res.impulseChannels=a.convolver.buffer?a.convolver.buffer.numberOfChannels:0;
  res.damping=Math.round(a.reverbDamp.frequency.value);

  // Switching theatre must actually change the room, not just the level.
  a.setReverbProfile(reverbFor('hangar'));
  await wait(60);
  // Guarded. A build that never generates an impulse leaves this null, and
  // reading through it killed the harness on a stack trace rather than
  // reporting the one thing that was wrong — which is the build you most want
  // a diagnosis from.
  const buf=a.convolver.buffer;
  res.hangarSeconds=buf?+(buf.length/a.ctx.sampleRate).toFixed(3):0;
  res.hangarDamping=Math.round(a.reverbDamp.frequency.value);
  res.roomChanged=!!buf&&res.hangarSeconds!==res.impulseSeconds;

  // The impulse must decay, or it is noise rather than a tail.
  if(buf){
    const d=buf.getChannelData(0);
    const head=d.slice(0,2000).reduce((s,v)=>s+Math.abs(v),0)/2000;
    const tail=d.slice(-2000).reduce((s,v)=>s+Math.abs(v),0)/2000;
    res.impulseDecays=head>tail*4;
  }else{
    res.impulseDecays=false;
  }

  // 4. Leaving the sector must take the room with it.
  a.setReverbProfile(null);
  // Past the point the ramp is scheduled to land on exactly zero. A shorter
  // wait samples an exponential mid-flight and reports a residual that is
  // simply the curve not having finished.
  await wait(600);
  res.dryWet=+a.reverbSends.playerWeapon.gain.value.toFixed(3);
  res.dryReturn=+a.reverbReturn.gain.value.toFixed(3);

  // 5. Performance mode shortens the room rather than keeping a phone busy.
  // Guarded like the reads above, and for the same reason: on a build that
  // never generates an impulse this was the second place that died on a null
  // before any assertion got to speak.
  const seconds=()=>a.convolver.buffer?+(a.convolver.buffer.length/a.ctx.sampleRate).toFixed(3):0;
  const real=a.settings.performanceMode;
  a.settings.performanceMode=true;
  a.setReverbProfile(reverbFor('foundry'));
  const perf=seconds();
  a.settings.performanceMode=false;
  a.setReverbProfile(reverbFor('foundry'));
  const full=seconds();
  a.settings.performanceMode=real;
  res.perfSeconds=perf;res.fullSeconds=full;
  a.setReverbProfile(null);
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
if(out.missing.length)fail.push(`${out.missing.length} theatre(s) have no room: ${out.missing}`);
if(out.distinctRooms<out.theatres)fail.push(`${out.theatres} theatres share only ${out.distinctRooms} distinct rooms`);
if(!out.unknownIsDry)fail.push('an unknown theatre falls into some other theatre\'s room instead of running dry');
if(out.longestDecay>1.6)fail.push(`longest room is ${out.longestDecay}s — that is a cathedral, not a sector`);
if(out.wettest>.34)fail.push(`wettest send is ${out.wettest} — the room is louder than the thing in it`);
if(!out.snowIsDeadest)fail.push('a whiteout is not the deadest room in the game');
if(!out.hangarRingsLongerThanSnow)fail.push('a hangar does not ring longer than a snowfield');
if(out.uiHasNoSend===false)fail.push('UI sounds are being reverberated');
if(out.alertHasNoSend===false)fail.push('critical alerts are being reverberated');
if(!out.dryPathIntact)fail.push('the dry path was disturbed');
if(!out.sends.includes('playerWeapon'))fail.push('player weapons do not reach the room');
if(!out.sends.includes('enemyWeapon'))fail.push('enemy weapons do not reach the room');
if(!out.sends.includes('impact'))fail.push('impacts do not reach the room');
if(!(out.liveWet>0))fail.push('the room is silent during a contract');
if(!(out.liveReturn>0))fail.push('the reverb return never opened');
if(!(out.impulseSeconds>0))fail.push('no impulse was generated');
if(out.impulseChannels!==2)fail.push(`impulse is ${out.impulseChannels}-channel — a mono room has no width`);
if(!out.impulseDecays)fail.push('the impulse does not decay — that is noise, not a tail');
if(!out.roomChanged)fail.push('switching theatre did not change the room');
if(out.hangarDamping<=out.damping)fail.push('a steel hangar is no brighter than a concrete bunker');
// Exactly zero, not merely small.
//
// A threshold here cannot tell an exponential that has nearly finished from
// one that never lands — and "nearly zero" means a convolver still running for
// the rest of the session. With a tolerance of .02 this passed on a build with
// the hard set removed, reading 0.001 where the correct build reads 0.
if(out.dryWet!==0)fail.push(`leaving the sector left the send at ${out.dryWet} rather than exactly zero`);
if(out.dryReturn!==0)fail.push(`leaving the sector left the return at ${out.dryReturn} rather than exactly zero`);
if(out.impulseSeconds>0&&!(out.perfSeconds<out.fullSeconds))fail.push('performance mode does not shorten the room');
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nevery theatre is a room');
await b.close();
