// Can you tell incoming fire from your own, and one hostile from another?
//
// Before this existed every hostile in the game played a single generic `shoot`
// at a fixed volume, routed to the operative's own weapon bus — so a firefight
// carried no information at all: not direction, not distance, not what was
// shooting at you.
//
// Storage key: `red-static-save` is the live one and a seed must carry a
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
  const {ENEMIES,ELITES,CHOPPER,CARRIER,enemyVoice}=await import('/data/enemies.js');
  const a=window.__pp.engine.audio;
  const res={};

  // 1. Coverage. Every hostile that can shoot resolves to a family, and the
  //    families are actually spread across the table rather than everything
  //    quietly landing on the fallback.
  const all=[...ENEMIES,CHOPPER,CARRIER,...ELITES];
  const byVoice={};
  for(const e of all){const v=enemyVoice(e);(byVoice[v]=byVoice[v]||[]).push(e.eliteDef?.id||e.id);}
  res.archetypes=all.length;
  res.families=Object.keys(byVoice).length;
  res.distribution=Object.fromEntries(Object.entries(byVoice).map(([k,v])=>[k,v.length]));
  res.unresolved=all.filter(e=>!enemyVoice(e)).map(e=>e.id);
  // An elite is its own unit: the Red Auditor is built on a rifle cell.
  res.redAuditor=enemyVoice(ELITES.find(e=>e.id==='redauditor'));
  res.rifleCell=enemyVoice(ENEMIES.find(e=>e.id==='rifle'));
  res.sniper=enemyVoice(ENEMIES.find(e=>e.id==='sniper'));

  // 2. Routing. Hostile fire must leave on the enemy bus, and the operative's
  //    own must not — including for sounds both of them use.
  res.hostileBus=a.busFor('enemyWeapon',{hostile:true})===a.channels.enemyWeapon;
  res.sharedNameHostile=a.busFor('laser',{hostile:true})===a.channels.enemyWeapon;
  res.sharedNamePlayer=a.busFor('laser',{})===a.channels.playerWeapon;
  res.playerStaysPlayer=a.busFor('weapon',{})===a.channels.playerWeapon;

  // 3. The incoming shade. Same family, measurably different shot: the crack
  //    loses level and top end, the action disappears entirely.
  const capture=()=>{
    const layers=[];
    const realTone=a.tone.bind(a),realNoise=a.noise.bind(a);
    a.tone=o=>{layers.push({kind:'tone',...o});return realTone(o)};
    a.noise=o=>{layers.push({kind:'noise',...o});return realNoise(o)};
    return{layers,done:()=>{a.tone=realTone;a.noise=realNoise;return layers}};
  };
  const shot=incoming=>{
    const c=capture();
    a.lastPlayed.clear();
    a.weaponShot('rifle',1,incoming?{incoming:true}:{});
    return c.done();
  };
  const outgoing=shot(false),incoming=shot(true);
  const crackOf=ls=>ls.find(l=>l.kind==='noise'&&l.q===1.1);
  const mechOf=ls=>ls.find(l=>l.kind==='noise'&&l.q===2.4);
  res.outgoingCrack={gain:+crackOf(outgoing).gain.toFixed(3),freq:Math.round(crackOf(outgoing).freq)};
  res.incomingCrack={gain:+crackOf(incoming).gain.toFixed(3),freq:Math.round(crackOf(incoming).freq)};
  res.outgoingHasAction=!!mechOf(outgoing);
  res.incomingHasAction=!!mechOf(incoming);
  res.outgoingLayers=outgoing.length;
  res.incomingLayers=incoming.length;

  // 4. Distinctness. Two different hostile families must not produce the same
  //    shot, or the table is decorative.
  const crackFreq=voice=>{
    const c=capture();
    a.lastPlayed.clear();
    a.weaponShot(voice,1,{incoming:true});
    return Math.round(crackOf(c.done()).freq);
  };
  res.sniperCrack=crackFreq('sniper');
  res.techCrack=crackFreq('tech');
  res.shotgunCrack=crackFreq('shotgun');

  // 5. Integration. Everything above tests `busFor` and `weaponShot` directly,
  //    which proves the machinery works and proves nothing about whether a
  //    hostile pulling a trigger reaches it. Drive real units and watch what
  //    the engine actually emits.
  {
    const eng2=window.__pp.engine;
    const {ENEMIES_BY_ID}=await import('/data/enemies.js');
    const seen=[];
    const realPlay=a.play.bind(a);
    a.play=(name,opts={})=>{seen.push({name,voice:opts.voice,hostile:!!opts.hostile});return realPlay(name,opts)};
    // Put shooters right next to the operative and fire them by hand, so the
    // result does not depend on the director choosing to spawn any.
    for(const id of ['rifle','sniper','crawler','warden']){
      const arch=ENEMIES_BY_ID[id];
      const e=eng2.spawnEnemy(arch,eng2.player.x+60,eng2.player.y+60);
      if(e)eng2.fireEnemyShot(e,arch);
    }
    a.play=realPlay;
    res.emitted=seen.filter(s=>s.hostile||s.name==='shoot'||s.name==='enemyWeapon');
    res.emittedVoices=[...new Set(res.emitted.filter(s=>s.name==='enemyWeapon').map(s=>s.voice))].sort();
    res.emittedGenericShoot=seen.filter(s=>s.name==='shoot').length;
  }

  // 6. Distance. A hostile across the sector must be quieter than one on top
  //    of you. Measured through the engine's own falloff, not re-derived.
  const eng=window.__pp.engine,pl=eng.player;
  res.audibleClose=+eng.audibleAt(pl.x+40,pl.y,1100).toFixed(3);
  res.audibleFar=+eng.audibleAt(pl.x+1000,pl.y,1100).toFixed(3);
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
if(out.unresolved.length)fail.push(`${out.unresolved.length} hostiles resolve to no family: ${out.unresolved}`);
if(out.families<6)fail.push(`only ${out.families} families across ${out.archetypes} hostiles — they still mostly sound alike`);
if(out.redAuditor===out.rifleCell)fail.push('the Red Auditor sounds like the rifle cell it is built from');
if(out.redAuditor!==out.sniper)fail.push(`the Red Auditor is a marksman but fires a ${out.redAuditor}`);
if(!out.hostileBus)fail.push('hostile fire does not go out on the enemy bus');
if(!out.sharedNameHostile)fail.push('a boss firing `laser` still lands on the player bus');
if(!out.sharedNamePlayer)fail.push('the operative firing `laser` was moved off the player bus');
if(!out.playerStaysPlayer)fail.push('the operative weapon left the player bus');
if(out.incomingCrack.gain/out.outgoingCrack.gain>.85)fail.push(`incoming fire is not attenuated (${out.incomingCrack.gain} vs ${out.outgoingCrack.gain})`);
// A margin, not a strict inequality. Every shot is detuned by up to the
// family's `spread` (5% on a rifle), so "lower than the last one" is a coin
// flip between two shots of the same voice and would pass on a build with no
// shade at all. The shade moves it by 28%, so anything under 85% is the shade
// and not the wobble.
if(out.incomingCrack.freq/out.outgoingCrack.freq>.85)fail.push(`incoming fire kept its top end (${out.incomingCrack.freq}Hz vs ${out.outgoingCrack.freq}Hz)`);
if(!out.outgoingHasAction)fail.push('the operative weapon lost its mechanical layer');
if(out.incomingHasAction)fail.push('you can hear another unit cycling its action');
if(out.sniperCrack===out.techCrack||out.techCrack===out.shotgunCrack||out.sniperCrack===out.shotgunCrack){
  fail.push(`hostile families are not distinct (sniper ${out.sniperCrack}, tech ${out.techCrack}, shotgun ${out.shotgunCrack})`);
}
if(!(out.audibleFar<out.audibleClose))fail.push(`distance does not attenuate hostile fire (${out.audibleFar} vs ${out.audibleClose})`);
if(!out.emitted.length)fail.push('hostiles firing emitted no sound at all');
if(out.emittedGenericShoot)fail.push(`${out.emittedGenericShoot} hostiles still play the generic \`shoot\``);
if(out.emitted.some(s=>!s.hostile))fail.push('a hostile fired without being marked hostile, so it routed to the player bus');
if(out.emittedVoices.length<3)fail.push(`four different hostiles fired but produced ${out.emittedVoices.length} voice(s): ${out.emittedVoices}`);
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nhostiles have their own voice');
await b.close();
