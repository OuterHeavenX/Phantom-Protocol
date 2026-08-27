import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const p=await b.newPage({viewport:{width:900,height:600}});
const errs=[];p.on('pageerror',e=>errs.push(String(e&&e.stack||e).split('\n')[0]));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(400);
await p.evaluate(()=>{localStorage.setItem('phantom-protocol-save',JSON.stringify({version:3,maps:{blacksite:{unlocked:true}},settings:{renderer:'2d',showMinimap:false,audioMix:2}}));});
await p.reload({waitUntil:'load'});await p.waitForTimeout(700);
await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());await p.waitForTimeout(300);
await p.evaluate(()=>{[...document.querySelectorAll('button,a')].find(e=>/DEPLOY/i.test(e.textContent))?.click()});await p.waitForTimeout(250);
await p.evaluate(()=>document.querySelector('[data-map="blacksite"]')?.click());await p.waitForTimeout(250);
await p.evaluate(()=>document.querySelector('#deployBtn')?.click());
await p.waitForTimeout(2200);
const out=await p.evaluate(async()=>{
  const {WEAPONS,EVOLUTIONS,weaponVoice}=await import('/data/weapons.js');
  const a=window.__pp.engine.audio;
  const res={};
  // 1. Coverage: every weapon form resolves to a family.
  const all=[...WEAPONS,...EVOLUTIONS];
  const byVoice={};
  for(const w of all){const v=weaponVoice(w);(byVoice[v]=byVoice[v]||[]).push(w.id);}
  res.forms=all.length;
  res.families=Object.keys(byVoice).length;
  res.distribution=Object.fromEntries(Object.entries(byVoice).map(([k,v])=>[k,v.length]));
  res.unresolved=all.filter(w=>!weaponVoice(w)).map(w=>w.id);
  // 2. Routing: does a shot land on the player-weapon bus?
  res.channels=Object.keys(a.channels||{});
  res.weaponChannel=a.channel('weapon')===a.channels.playerWeapon;
  res.alertChannel=a.channel('hurt')===a.channels.alert;
  // 3. Layer count: how many nodes does one shot create?
  let made=0;
  const realTone=a.tone.bind(a),realNoise=a.noise.bind(a);
  a.tone=o=>{made++;return realTone(o)};
  a.noise=o=>{made++;return realNoise(o)};
  a.lastPlayed.clear();
  a.weaponShot('rifle',1,{});
  res.layersPerShot=made;
  // 4. Variation: successive shots must differ.
  const freqs=[];
  a.noise=o=>{if(o.q===1.1)freqs.push(+o.freq.toFixed(1));return realNoise(o)};
  for(let i=0;i<8;i++){a.lastPlayed.clear();a.weaponShot('rifle',1,{});}
  res.crackFreqs=freqs;
  res.identicalRounds=freqs.length-new Set(freqs).size;
  a.tone=realTone;a.noise=realNoise;
  // 5. Alert ducking makes room.
  a.channels.playerWeapon.gain.value=1;
  a.duckChannels(['playerWeapon'],.4,.2);
  res.duckedPlayerWeapon=+a.channels.playerWeapon.gain.value.toFixed(3);
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');
await b.close();
