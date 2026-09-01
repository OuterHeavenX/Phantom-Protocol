// Do the operative's weapons hit harder, and did that cost anything?
//
// "Punch" is the easiest thing in a mixer to fake by turning something up, and
// turning something up is exactly what this pass was told not to do. So the
// assertions are about shape: that a transient exists above the body, that the
// low end is reinforced by harmonics rather than by level, that heavy weapons
// out-punch light ones, and that the whole thing did not quietly eat the voice
// budget a phone depends on.
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
await p.waitForTimeout(2200);

const out=await p.evaluate(async()=>{
  const a=window.__pp.engine.audio;
  const res={};

  // Voice budget is reset per capture. `canPlay` drops non-essential sounds
  // past 24 live voices and these fire in one synchronous burst, so without
  // this the later captures measure an exhausted mixer rather than a weapon.
  const shot=(voice,opts={})=>{
    const layers=[];
    a.voices=0;a.lastPlayed.clear();
    const rt=a.tone.bind(a),rn=a.noise.bind(a);
    a.tone=o=>{layers.push({k:'tone',...o});return rt(o)};
    a.noise=o=>{layers.push({k:'noise',...o});return rn(o)};
    try{a.weaponShot(voice,1,opts)}finally{a.tone=rt;a.noise=rn}
    return layers;
  };
  // The snap is the only highpass layer in a shot; the reinforcement is the
  // only triangle. Identified by role, not by index, so reordering the layers
  // does not silently change what is being measured.
  const snapOf=ls=>ls.find(l=>l.k==='noise'&&l.filter==='highpass');
  const reinforceOf=ls=>ls.find(l=>l.k==='tone'&&l.type==='triangle');
  const pressOf=ls=>ls.find(l=>l.k==='tone'&&l.type==='sine');

  const families=['pistol','suppressed','rifle','smg','shotgun','marksman',
    'sniper','lmg','heavy','beam','tech','corrupted'];
  res.families={};
  for(const f of families){
    const ls=shot(f);
    const snap=snapOf(ls),rein=reinforceOf(ls),press=pressOf(ls);
    res.families[f]={
      layers:ls.length,
      snap:snap?+snap.gain.toFixed(4):0,
      snapMs:snap?+(snap.duration*1000).toFixed(1):0,
      reinforce:rein?+rein.gain.toFixed(4):0,
      press:press?+press.gain.toFixed(4):0
    };
  }

  // A transient must exist and must be genuinely short — a long "transient" is
  // just more body.
  res.withSnap=families.filter(f=>res.families[f].snap>0).length;
  res.longestSnapMs=Math.max(...families.map(f=>res.families[f].snapMs));

  // Heavier weapons punch harder than light ones, at the same call volume.
  res.heavyVsSmg=[res.families.heavy.snap,res.families.smg.snap];
  res.shotgunVsSuppressed=[res.families.shotgun.snap,res.families.suppressed.snap];
  // A suppressed weapon must stay the quiet one — punch must not erase family
  // identity, which is the failure mode of a global "make it punchier" pass.
  res.suppressedIsQuietest=res.families.suppressed.snap===
    Math.min(...families.map(f=>res.families[f].snap).filter(v=>v>0));

  // Reinforcement is harmonic, not level: it must sit under its own
  // fundamental, and must be absent where there is no low end to reconstruct.
  res.reinforcedFamilies=families.filter(f=>res.families[f].reinforce>0);
  res.beamReinforced=res.families.beam.reinforce>0;
  res.reinforceUnderPress=families.every(f=>{
    const e=res.families[f];
    return e.reinforce===0||e.reinforce<e.press;
  });

  // Incoming fire must not gain the operative's punch — that would erase the
  // whole incoming/outgoing distinction built last pass.
  const inc=shot('rifle',{incoming:true});
  res.incomingSnap=snapOf(inc)?+snapOf(inc).gain.toFixed(4):0;
  res.incomingReinforced=!!reinforceOf(inc);
  res.outgoingSnap=res.families.rifle.snap;

  // Compression sits on the weapon bus, not the master.
  res.hasWeaponCompressor=!!a.weaponPunch;
  res.compressorRatio=a.weaponPunch?+a.weaponPunch.ratio.value.toFixed(2):0;
  res.compressorAttackMs=a.weaponPunch?+(a.weaponPunch.attack.value*1000).toFixed(1):0;
  res.masterLimiterRatio=+a.limiter.ratio.value.toFixed(2);

  // The budget. Two layers were added to a five-layer sound; a phone has 24
  // voices and this must not have quietly halved how many shots fit.
  res.maxVoices=a.maxVoices;
  res.rifleLayers=res.families.rifle.layers;
  res.concurrentShots=Math.floor(a.maxVoices/res.rifleLayers);

  // In a theatre with a real room the synthetic tail stands down, so a shot
  // costs one layer less and is not reverberated twice.
  const {reverbFor}=await import('/data/reverb.js');
  const tailLayer=ls=>ls.find(l=>l.k==='noise'&&l.filter==='lowpass');
  // Dry first, then in the room. Taking the "dry" sample before clearing the
  // profile measured the same room twice and reported no difference — which
  // looked exactly like the feature not working.
  a.setReverbProfile(null);
  const dryShot=shot('rifle');
  const dryTail=tailLayer(dryShot);
  a.setReverbProfile(reverbFor('foundry'));
  const roomed=shot('rifle');
  res.roomedLayers=roomed.length;
  const roomedTail=tailLayer(roomed);
  a.setReverbProfile(null);
  res.tailInRoom=roomedTail?+roomedTail.duration.toFixed(3):0;
  res.tailDry=dryTail?+dryTail.duration.toFixed(3):0;
  res.roomedConcurrentShots=Math.floor(a.maxVoices/res.roomedLayers);
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
if(out.withSnap<9)fail.push(`only ${out.withSnap}/12 families have a transient`);
if(out.longestSnapMs>40)fail.push(`longest transient is ${out.longestSnapMs}ms — that is body, not a transient`);
if(!(out.heavyVsSmg[0]>out.heavyVsSmg[1]))fail.push(`a heavy weapon does not out-punch an SMG (${out.heavyVsSmg})`);
if(!(out.shotgunVsSuppressed[0]>out.shotgunVsSuppressed[1]))fail.push(`a shotgun does not out-punch a suppressed weapon (${out.shotgunVsSuppressed})`);
if(!out.suppressedIsQuietest)fail.push('the suppressed family lost its identity — it is no longer the softest hitting');
if(out.reinforcedFamilies.length<4)fail.push(`only ${out.reinforcedFamilies.length} families get low-end reinforcement`);
if(out.beamReinforced)fail.push('a beam weapon was given a pressure wave it does not have');
if(!out.reinforceUnderPress)fail.push('harmonic reinforcement is louder than the fundamental it reinforces — that is added bass, not translation');
if(!(out.incomingSnap<out.outgoingSnap))fail.push(`incoming fire punches as hard as the operative's own (${out.incomingSnap} vs ${out.outgoingSnap})`);
if(out.incomingReinforced)fail.push('incoming fire got the mobile reinforcement layer, blurring incoming against outgoing');
if(!out.hasWeaponCompressor)fail.push('there is no compressor on the weapon bus');
if(out.compressorRatio>4)fail.push(`weapon-bus compression at ${out.compressorRatio}:1 is not subtle`);
if(!(out.compressorAttackMs>=3))fail.push(`weapon-bus attack of ${out.compressorAttackMs}ms clamps the transient it is meant to let through`);
if(out.masterLimiterRatio>4)fail.push(`the master limiter was made aggressive (${out.masterLimiterRatio}:1) — that is processing everything to fix one category`);
if(out.concurrentShots<3)fail.push(`only ${out.concurrentShots} shots fit in the voice budget — the new layers cost too much`);
if(!(out.tailInRoom<out.tailDry))fail.push(`the synthetic tail does not stand down in a real room (${out.tailInRoom} vs ${out.tailDry}) — every shot is reverberated twice`);
if(out.roomedConcurrentShots<out.concurrentShots)fail.push('a shot costs more in a room than out of one');
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nthe weapons hit harder without getting louder');
await b.close();
