// Does a destroyed helicopter actually go down, and does it land?
//
// The failure this exists for is the quiet one: a wreck that spawns, spins,
// and then never reaches the ground — leaving a permanent burning object in
// the sector, a rotor that never stops, and a scheduled explosion that never
// fires. Every assertion below is about the fall completing.
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
  const {CHOPPER}=await import('/data/enemies.js');
  const eng=window.__pp.engine;
  const res={};

  // Drive the simulation by hand at the fixed step, so the result does not
  // depend on how many frames the headless browser felt like delivering.
  const STEP=1/60;
  // A deterministic stand-in for the Input the engine reads, matching the one
  // parity.mjs drives with. Stepping with a bare object throws inside the
  // replay recorder, which reads the real Input's methods.
  const script={
    moveX:0,moveY:0,ax:1,ay:0,
    aimVector(){return{x:this.ax,y:this.ay,manual:true}},
    takeAction(){return false},
    poll(){}
  };
  const run=steps=>{for(let i=0;i<steps;i++)eng.step(STEP,script)};

  const chopper=eng.spawnEnemy(CHOPPER,eng.player.x+240,eng.player.y-160);
  res.spawned=!!chopper;
  res.isFlying=!!chopper?.flying;
  const wrecksBefore=eng.wrecks.length;

  const decalsBefore=eng.world.decals.length;
  eng.killEnemy(chopper,{direction:0});
  res.wreckCreated=eng.wrecks.length===wrecksBefore+1;
  // The kill is credited immediately. A wreck is debris, not a pending kill.
  res.creditedImmediately=eng.kills>0;
  // Marked now, swept at the end of the step — `compact` runs once per step by
  // design, so asserting on the list before stepping tests the harness's
  // impatience rather than the engine.
  res.markedDead=!!chopper.dead;

  // Everything past this point depends on a wreck existing. Read blind, the
  // harness threw on the first undefined field and died with a stack trace
  // instead of reporting which assertion failed — so a build where aircraft
  // simply vanish produced no diagnosis at all.
  const w0=eng.wrecks[eng.wrecks.length-1];
  if(!w0)return res;
  const start={x:w0.x,y:w0.y,angle:w0.angle,altitude:w0.altitude};

  // One second of fall.
  run(60);
  res.removedFromEnemies=!eng.enemies.includes(chopper);
  const mid=eng.wrecks[0];
  res.stillFalling=!!mid;
  if(mid){
    res.altitudeDropped=mid.altitude<start.altitude;
    res.rotated=Math.abs(mid.angle-start.angle)>1;
    res.moved=Math.hypot(mid.x-start.x,mid.y-start.y)>1;
    res.midAltitude=+mid.altitude.toFixed(3);
    // It must still be inside the sector, not clamped into a corner or NaN.
    res.insideWorld=mid.x>=0&&mid.x<=eng.world.width&&mid.y>=0&&mid.y<=eng.world.height;
    res.finite=Number.isFinite(mid.x)&&Number.isFinite(mid.y)&&Number.isFinite(mid.angle);
  }

  // The rotor must still be audible while it is coming down.
  eng.updateRotor();
  res.rotorWhileFalling=+(window.__pp.engine.audio.rotorDuck??1).toFixed(3);

  // Step until it lands, bounded — so a wreck that never reaches the ground
  // fails the assertion instead of hanging the harness.
  // Count the decals the crash itself lays down, isolated to the single step
  // in which it lands.
  //
  // Counting the whole fall instead let ambient kills elsewhere in the sector
  // pad the total, and the assertion passed on a build with both crash
  // splatters deleted outright. A spy on `addDecal` across one step cannot be
  // padded by anything, and is immune to the renderer baking the decal list
  // down behind the harness's back.
  let crashDecals=0;
  const realAddDecal=eng.world.addDecal.bind(eng.world);
  eng.world.addDecal=(...args)=>{crashDecals++;return realAddDecal(...args)};

  let steps=60;   // the second of fall already run above counts toward it
  let landingDecals=0;
  while(eng.wrecks.length&&steps<400){
    const before=crashDecals;
    run(1);steps++;
    if(!eng.wrecks.length)landingDecals=crashDecals-before;
  }
  eng.world.addDecal=realAddDecal;
  res.landed=eng.wrecks.length===0;
  // Counted from the kill, not from the start of this loop. Counting only the
  // tail made a perfectly good 1.3s fall look like 0.3s.
  res.fallSeconds=+(steps/60).toFixed(2);
  res.crashDecals=landingDecals;
  res.decalsAfter=eng.world.decals.length-decalsBefore;

  // Sampled at the landing frame, not minutes later. Checked after the fall
  // had long finished, this was zero either way and proved nothing — the
  // secondary is queued by the crash and outlives the wreck that queued it, so
  // the only moment it is observable is the moment the wreck is gone.
  res.queuedAtLanding=eng.scheduled.length;
  run(60);
  res.queuedAfter=eng.scheduled.length;

  // And with nothing left airborne the rotor must fall silent.
  eng.updateRotor();
  res.wrecksAtEnd=eng.wrecks.length;
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
const has=k=>Object.prototype.hasOwnProperty.call(out,k);
if(!out.spawned)fail.push('could not spawn a gunship to kill');
if(!out.isFlying)fail.push('the gunship is not flagged as flying, so it would never wreck');
if(!out.wreckCreated)fail.push('killing a gunship created no wreck — it just vanished');
if(!out.creditedImmediately)fail.push('the kill was not credited when the gunship was destroyed');
if(!out.markedDead)fail.push('killing the gunship did not mark it dead');
if(!out.removedFromEnemies)fail.push('the destroyed gunship is still in the enemy list a step later');
// Only meaningful once a wreck exists; without one the assertion above has
// already said the real thing and the rest would just be noise.
if(!out.wreckCreated){
  console.log('\nFAILURES');for(const f of fail)console.log('  '+f);
  process.exitCode=1;await b.close();
}
if(!has('stillFalling')||!out.stillFalling)fail.push('the wreck disappeared within the first second instead of falling');
if(!out.altitudeDropped)fail.push('the wreck is not losing altitude');
if(!out.rotated)fail.push('the wreck is not spinning');
if(!out.moved)fail.push('the wreck drops straight down instead of carrying its momentum');
if(!out.insideWorld)fail.push('the wreck left the sector');
if(!out.finite)fail.push('the wreck has non-finite position or angle');
if(!(out.rotorWhileFalling<1))fail.push('a falling gunship makes no rotor sound');
if(!out.landed)fail.push('the wreck never reached the ground');
if(out.crashDecals<12)fail.push(`the crash itself laid down only ${out.crashDecals} decals — no burn or oil`);
if(!out.queuedAtLanding)fail.push('the crash queued no delayed secondary explosion');
if(out.queuedAfter>=out.queuedAtLanding)fail.push('the delayed secondary explosion never fired');
if(out.fallSeconds<1.2)fail.push(`the wreck hit the ground in ${out.fallSeconds}s — too fast to read as a fall`);
if(out.fallSeconds>3)fail.push(`the wreck took ${out.fallSeconds}s to land — the fight stops to watch it`);
if(out.wrecksAtEnd)fail.push(`${out.wrecksAtEnd} wreck(s) still in the sector after landing`);
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nthe gunship goes down');
await b.close();
