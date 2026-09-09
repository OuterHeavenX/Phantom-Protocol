// Do the weapons hit? Measured on the rounds the game actually decodes.
//
// Every shot used to be five clean live layers — "peashooter" was the owner's
// word. The families now ship as rendered rounds (tools/sfx/weapons.py) and
// the synthesis is the fallback. This harness decodes the shipped files
// through the game's own loader and checks the things that make a report
// read as force: a hard leading edge, weight under the ballistic families and
// none under the beam, the suppressed weapon still the quiet one, incoming
// fire shaded darker and softer, the weapon-bus compressor still gentle, and a
// shot costing one voice rather than six.
//
// Storage key: `red-static-save` is the live one.
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
// The rounds decode in the background after the unlock gesture.
await p.waitForFunction(()=>window.__pp?.engine?.audio?.sampleStatus&&window.__pp.engine.audio.sampleStatus!=='loading',null,{timeout:15000}).catch(()=>{});

const out=await p.evaluate(async()=>{
  const a=window.__pp.engine.audio;
  const res={status:a.sampleStatus,loaded:[...a.samples.keys()].sort()};
  const families=['pistol','suppressed','rifle','smg','shotgun','marksman',
    'sniper','lmg','heavy','beam','tech','corrupted'];

  // ---- The files, as decoded --------------------------------------------
  const analyse=buf=>{
    const x=buf.getChannelData(0),sr=buf.sampleRate,n=x.length;
    const first=Math.floor(sr*.006);
    let t=0;for(let i=0;i<first;i++)t+=x[i]*x[i];
    let e=0;for(let i=0;i<n;i++)e+=x[i]*x[i];
    // Sub energy by a crude 120 Hz lowpass (one pole), against the total.
    let lpv=0,sub=0;const k=1-Math.exp(-2*Math.PI*120/sr);
    for(let i=0;i<n;i++){lpv+=k*(x[i]-lpv);sub+=lpv*lpv}
    return {transient:Math.sqrt(t/first),rms:Math.sqrt(e/n),subFraction:sub/(e||1),seconds:buf.duration};
  };
  res.families={};
  for(const f of families){
    const list=a.samples.get(f);
    if(!list){res.families[f]=null;continue}
    const m=list.map(analyse);
    res.families[f]={
      rounds:list.length,
      transient:+(m.reduce((s,v)=>s+v.transient,0)/m.length).toFixed(4),
      rms:+(m.reduce((s,v)=>s+v.rms,0)/m.length).toFixed(4),
      subFraction:+(m.reduce((s,v)=>s+v.subFraction,0)/m.length).toFixed(3),
      seconds:+Math.max(...m.map(v=>v.seconds)).toFixed(2),
      // The three rounds are different files, not one file three times.
      distinctRounds:new Set(list.map(bf=>bf.getChannelData(0).slice(200,400).join(','))).size
    };
  }
  const F=res.families;
  const have=families.filter(f=>F[f]);
  res.heavyVsSmg=[F.heavy?.transient??0,F.smg?.transient??0];
  res.shotgunVsSuppressed=[F.shotgun?.transient??0,F.suppressed?.transient??0];
  res.suppressedIsQuietest=!!F.suppressed&&F.suppressed.rms===Math.min(...have.map(f=>F[f].rms));
  res.weightedFamilies=have.filter(f=>F[f].subFraction>=.2);
  res.beamSub=F.beam?.subFraction??1;
  res.longestSeconds=Math.max(...have.map(f=>F[f].seconds));
  res.repeatedRounds=have.filter(f=>F[f].distinctRounds<F[f].rounds);

  // ---- The shot, as played ------------------------------------------------
  const shot=(voice,opts={})=>{
    const calls={samples:[],layers:[]};
    a.voices=0;a.lastPlayed.clear();
    const rs=a.sample.bind(a),rt=a.tone.bind(a),rn=a.noise.bind(a);
    a.sample=(buf,o)=>{calls.samples.push({...o,seconds:buf.duration});return rs(buf,o)};
    a.tone=o=>{calls.layers.push({k:'tone',...o});return rt(o)};
    a.noise=o=>{calls.layers.push({k:'noise',...o});return rn(o)};
    const before=a.voices;
    try{a.weaponShot(voice,1,opts)}finally{a.sample=rs;a.tone=rt;a.noise=rn}
    calls.voices=a.voices-before;
    return calls;
  };
  const {reverbFor}=await import('/data/reverb.js');
  a.setReverbProfile(null);
  const dry=shot('rifle');
  res.dryUsesSample=dry.samples.length===1;
  res.dryVoices=dry.voices;
  // The open-ground air is gated on the family's tail, and the rifle's sits
  // exactly on the gate — measured there, the room test passed with the gate
  // removed. The sniper's long tail is what the air exists for.
  const open=shot('sniper');
  res.openVoices=open.voices;
  a.setReverbProfile(reverbFor('foundry'));
  const roomed=shot('sniper');
  res.roomedVoices=roomed.voices;
  a.setReverbProfile(null);
  const inc=shot('rifle',{incoming:true});
  res.incoming={gain:inc.samples[0]?.gain??null,rate:inc.samples[0]?.rate??null,lowpass:inc.samples[0]?.lowpass??null};
  res.outgoing={gain:dry.samples[0]?.gain??null,lowpass:dry.samples[0]?.lowpass??null};
  // Round robin: three shots, three files.
  const seen=new Set();for(let i=0;i<3;i++)seen.add(shot('rifle').samples[0]?.seconds);
  res.roundRobinFiles=seen.size;
  // The synthesis is still there for a family that has not decoded.
  const kept=a.samples.get('pistol');a.samples.delete('pistol');
  const fallback=shot('pistol');
  a.samples.set('pistol',kept);
  res.fallbackLayers=fallback.layers.length;
  res.fallbackUsedSample=fallback.samples.length;

  // ---- The bus -------------------------------------------------------------
  res.hasWeaponCompressor=!!a.weaponPunch;
  res.compressorRatio=a.weaponPunch?+a.weaponPunch.ratio.value.toFixed(2):0;
  res.compressorAttackMs=a.weaponPunch?+(a.weaponPunch.attack.value*1000).toFixed(1):0;
  res.masterLimiterRatio=+a.limiter.ratio.value.toFixed(2);
  res.maxVoices=a.maxVoices;
  res.concurrentShots=Math.floor(a.maxVoices/Math.max(1,res.dryVoices));
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
if(out.status!=='ready')fail.push(`rendered rounds did not load (status ${out.status})`);
if(out.loaded.length<12)fail.push(`only ${out.loaded.length}/12 families decoded: ${out.loaded}`);
if(!(out.heavyVsSmg[0]>out.heavyVsSmg[1]))fail.push(`a heavy weapon does not out-punch an SMG (${out.heavyVsSmg})`);
if(!(out.shotgunVsSuppressed[0]>out.shotgunVsSuppressed[1]))fail.push(`a shotgun does not out-punch a suppressed weapon (${out.shotgunVsSuppressed})`);
if(!out.suppressedIsQuietest)fail.push('the suppressed family lost its identity — it is no longer the quiet one');
if(out.weightedFamilies.length<7)fail.push(`only ${out.weightedFamilies.length} families carry weight under 120 Hz`);
if(!(out.beamSub<.05))fail.push(`the beam carries a pressure wave it does not have (sub ${out.beamSub})`);
if(out.longestSeconds>1.6)fail.push(`a round runs ${out.longestSeconds}s — that is a tail the room should be providing`);
if(out.repeatedRounds.length)fail.push(`families whose rounds are one file repeated: ${out.repeatedRounds}`);
if(!out.dryUsesSample)fail.push('a shot does not play the rendered round');
if(!(out.dryVoices<=2))fail.push(`a shot costs ${out.dryVoices} voices — rendering was meant to make it one`);
if(!(out.openVoices===2))fail.push(`a sniper shot on open ground costs ${out.openVoices} voices — the synthetic air is not there`);
if(!(out.roomedVoices===1))fail.push(`a sniper shot in a room costs ${out.roomedVoices} voices — the synthetic air did not stand down`);
if(!(out.incoming.gain<out.outgoing.gain))fail.push(`incoming fire is as loud as the operative's own (${out.incoming.gain} vs ${out.outgoing.gain})`);
if(!(out.incoming.lowpass>0&&!out.outgoing.lowpass))fail.push('incoming fire is not shaded darker than outgoing');
if(!(out.incoming.rate<1))fail.push('incoming fire is not slowed');
if(out.roundRobinFiles<3)fail.push(`a burst repeats the same file (${out.roundRobinFiles} distinct in 3 shots)`);
if(!(out.fallbackLayers>=4&&out.fallbackUsedSample===0))fail.push(`the synthesis fallback is gone (${out.fallbackLayers} layers, ${out.fallbackUsedSample} samples)`);
if(!out.hasWeaponCompressor)fail.push('there is no compressor on the weapon bus');
if(out.compressorRatio>4)fail.push(`weapon-bus compression at ${out.compressorRatio}:1 is not subtle`);
if(!(out.compressorAttackMs>=3))fail.push(`weapon-bus attack of ${out.compressorAttackMs}ms clamps the transient it is meant to let through`);
if(out.masterLimiterRatio>4)fail.push(`the master limiter was made aggressive (${out.masterLimiterRatio}:1)`);
if(out.concurrentShots<10)fail.push(`only ${out.concurrentShots} shots fit in the voice budget`);
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nthe weapons hit, and a shot costs one voice');
await b.close();
