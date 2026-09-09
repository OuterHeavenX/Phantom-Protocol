// Can you tell what just died, and what just noticed you?
//
// Twenty-three archetypes shared one death sound between them: a crawler at
// your ankles and an Aegis Warden ended identically. This asserts that the
// sector now says which, and that the cues that would turn a wave into mush
// are the ones held back.
//
// Storage key: `red-static-save` is the live one and a seed must carry a
// version, or `migrate` rebuilds it from defaults and this tests a save it
// never wrote.
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
  const {ENEMIES,ELITES,CHOPPER,CARRIER,ENEMIES_BY_ID,enemyChassis}=await import('/data/enemies.js');
  const eng=window.__pp.engine;
  const a=eng.audio;
  const res={};

  // 1. Coverage. Every hostile resolves to a chassis, and the chassis are
  //    actually spread rather than everything landing on the fallback.
  const all=[...ENEMIES,CHOPPER,CARRIER,...ELITES];
  const byChassis={};
  for(const e of all){const c=enemyChassis(e);(byChassis[c]=byChassis[c]||[]).push(e.id)}
  res.archetypes=all.length;
  res.chassisKinds=Object.keys(byChassis).length;
  res.distribution=Object.fromEntries(Object.entries(byChassis).map(([k,v])=>[k,v.length]));
  res.unresolved=all.filter(e=>!enemyChassis(e)).map(e=>e.id);
  // Chassis is independent of weapon: two units with the same gun can be built
  // differently, and two units built alike can carry different guns.
  res.shieldVsBreacher=[enemyChassis(ENEMIES_BY_ID.shield),enemyChassis(ENEMIES_BY_ID.breacher)];
  res.crawlerVsWarden=[enemyChassis(ENEMIES_BY_ID.crawler),enemyChassis(ENEMIES_BY_ID.warden)];

  // 2. Routing: these belong on the enemy bus, not the player's or the alert's.
  res.deathBus=a.busFor('enemyDeath',{})===a.channels.enemy;
  res.alertBus=a.busFor('enemyAlert',{})===a.channels.enemy;
  res.hurtStaysAlert=a.busFor('hurt',{})===a.channels.alert;

  // 3. Distinctness. Capture the layers each chassis actually emits.
  // The voice budget is reset before every capture, and this is not a
  // convenience.
  //
  // `canPlay` drops any non-essential sound once 24 voices are live, and these
  // measurements fire in one synchronous burst — so the seven death captures
  // alone spent the entire budget and every capture after them silently
  // measured nothing. Two assertions then failed on mutations that had nothing
  // to do with them, and the baseline was passing partly by luck of ordering.
  // What is under test here is what each event is defined to emit, not what
  // survives a firefight.
  const capture=fn=>{
    const layers=[];
    a.voices=0;
    const rt=a.tone.bind(a),rn=a.noise.bind(a);
    a.tone=o=>{layers.push({k:'tone',...o});return rt(o)};
    a.noise=o=>{layers.push({k:'noise',...o});return rn(o)};
    try{fn()}finally{a.tone=rt;a.noise=rn}
    return layers;
  };
  // Distinctness is measured on durations, not on pitch.
  //
  // Every layer's frequency is multiplied by a per-shot wobble, so two chassis
  // reading from an identical table still produce different numbers — an
  // earlier version of this compared pitches and passed cleanly on a build
  // where all seven entries had been overwritten with the same values. It was
  // measuring Math.random. Durations come off the table untouched.
  const deathOf=chassis=>{
    a.lastPlayed.clear();
    const ls=capture(()=>a.play('enemyDeath',{chassis,volume:1}));
    const t=ls.find(l=>l.k==='tone');
    const ns=ls.filter(l=>l.k==='noise');
    return{
      layers:ls.length,
      fall:t?Math.round(t.freq):null,
      signature:[t?t.duration:null,...ns.map(n=>n.duration)].map(d=>d==null?'-':d.toFixed(3)).join('|')
    };
  };
  res.deaths={};
  for(const c of ['infantry','heavy','drone','swarm','walker','armour','synthetic']){
    res.deaths[c]=deathOf(c);
  }
  res.distinctDeaths=new Set(Object.values(res.deaths).map(d=>d.signature)).size;
  res.deathsWithLayers=Object.values(res.deaths).filter(d=>d.layers>=3).length;

  // 4. The wave-mush guard: infantry and swarms must arrive silently.
  const spawnLayers=chassis=>{
    a.lastPlayed.clear();
    return capture(()=>a.play('enemySpawn',{chassis,volume:1})).length;
  };
  res.spawnInfantry=spawnLayers('infantry');
  res.spawnSwarm=spawnLayers('swarm');
  res.spawnArmour=spawnLayers('armour');
  res.spawnWalker=spawnLayers('walker');

  // 5. Integration. Everything above drives `play` directly, which proves the
  //    sounds exist and nothing about whether the game reaches them.
  const seen=[];
  const realPlay=a.play.bind(a);
  a.play=(name,opts={})=>{seen.push({name,chassis:opts.chassis});return realPlay(name,opts)};

  const spawned=[];
  for(const id of ['rifle','crawler','warden','breacher']){
    const e=eng.spawnEnemy(ENEMIES_BY_ID[id],eng.player.x+70,eng.player.y+70);
    if(e)spawned.push(e);
  }
  res.emittedSpawn=seen.filter(s=>s.name==='enemySpawn').length;

  // Alerting: raise awareness the way a shared contact does, then step.
  const STEP=1/60;
  const script={moveX:0,moveY:0,ax:1,ay:0,
    aimVector(){return{x:this.ax,y:this.ay,manual:true}},takeAction(){return false},poll(){}};
  for(const e of spawned)e.awareness=1;
  eng.step(STEP,script);
  res.emittedAlert=seen.filter(s=>s.name==='enemyAlert').length;
  res.alertChassis=[...new Set(seen.filter(s=>s.name==='enemyAlert').map(s=>s.chassis))].sort();
  // Alerting again without losing you must not retrigger.
  const alertsBefore=res.emittedAlert;
  for(const e of spawned)e.awareness=1;
  eng.step(STEP,script);
  res.alertRetriggered=seen.filter(s=>s.name==='enemyAlert').length-alertsBefore;

  for(const e of spawned)if(!e.dead)eng.killEnemy(e,{});
  res.emittedDeath=seen.filter(s=>s.name==='enemyDeath').length;
  res.deathChassis=[...new Set(seen.filter(s=>s.name==='enemyDeath').map(s=>s.chassis))].sort();
  a.play=realPlay;
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
if(out.unresolved.length)fail.push(`${out.unresolved.length} hostiles resolve to no chassis: ${out.unresolved}`);
if(out.chassisKinds<5)fail.push(`only ${out.chassisKinds} chassis across ${out.archetypes} hostiles`);
if(out.shieldVsBreacher[0]!==out.shieldVsBreacher[1])fail.push(`shield and breacher are both armoured infantry but resolve to ${out.shieldVsBreacher}`);
if(out.crawlerVsWarden[0]===out.crawlerVsWarden[1])fail.push('a crawler and an Aegis Warden are built the same way');
if(!out.deathBus)fail.push('enemy death is not on the enemy bus');
if(!out.alertBus)fail.push('the alert cue is not on the enemy bus');
if(!out.hurtStaysAlert)fail.push('a player-critical cue was moved off the alert bus');
if(out.distinctDeaths<6)fail.push(`death cues are not distinct — only ${out.distinctDeaths} shapes across 7 chassis`);
if(out.deathsWithLayers<7)fail.push(`${7-out.deathsWithLayers} chassis death cue(s) are missing layers`);
if(out.spawnInfantry)fail.push('infantry announce their own arrival — a wave becomes mush');
if(out.spawnSwarm)fail.push('swarms announce their own arrival — a wave becomes mush');
if(!out.spawnArmour)fail.push('armour arrives silently, so nothing announces a carrier');
if(!out.spawnWalker)fail.push('a walker arrives silently');
if(!out.emittedSpawn)fail.push('spawning hostiles emitted no arrival cue at all');
if(out.emittedAlert<3)fail.push(`four hostiles were alerted and ${out.emittedAlert} cue(s) fired`);
if(out.alertChassis.length<3)fail.push(`alerts fired but all sounded alike: ${out.alertChassis}`);
if(out.alertRetriggered)fail.push(`staying alert retriggered the cue ${out.alertRetriggered} time(s)`);
if(out.emittedDeath<4)fail.push(`four hostiles died and ${out.emittedDeath} death cue(s) fired`);
if(out.deathChassis.length<3)fail.push(`deaths fired but all sounded alike: ${out.deathChassis}`);
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nthe sector says what happened in it');
await b.close();
