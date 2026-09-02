// Does gunfire light the sector, and can it swamp the frame?
//
// Muzzle flash is the only light source in this game that can arrive several
// times a second from a dozen places at once. The failure that matters is not
// "it does not work" — it is that a squad of riflemen pushes the hazards, the
// boss and the extraction beacon out of the renderer's light budget, so the
// lights that actually tell the operative something stop being drawn. Most of
// what follows is about the cap.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:900,height:600}});
const errs=[];p.on('pageerror',e=>errs.push(String(e&&e.stack||e).split('\n')[0]));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(600);

const out=await p.evaluate(async()=>{
  const {Fx}=await import('/src/game/fx.js');
  const res={};
  const make=(settings={})=>new Fx({particles:'high',...settings});

  // 1. A shot lights something.
  const fx=make();
  res.restingLights=fx.activeMuzzleLights().length;
  fx.muzzle(100,100,0,1,'rifle');
  const lit=fx.activeMuzzleLights();
  res.afterOneShot=lit.length;
  res.firstIntensity=lit.length?+lit[0].intensity.toFixed(3):0;
  res.firstRadius=lit.length?Math.round(lit[0].radius):0;
  // Warm, and taken from the flash's own colour rather than a second constant.
  res.warm=lit.length?lit[0].r>=lit[0].b:false;

  // 2. Heavier weapons light more of the room than light ones.
  const reach=voice=>{const f=make();f.muzzle(0,0,0,1,voice);
    const l=f.activeMuzzleLights();return l.length?Math.round(l[0].radius):0};
  res.reach={suppressed:reach('suppressed'),pistol:reach('pistol'),
    rifle:reach('rifle'),shotgun:reach('shotgun'),heavy:reach('heavy')};
  // A suppressed weapon has almost no flash to light anything with.
  res.suppressedDark=res.reach.suppressed===0;

  // 3. THE CAP. Sustained fire from many sources must not exceed it.
  const swarm=make();
  for(let i=0;i<200;i++)swarm.muzzle(i*7,i*5,0,1,'lmg');
  res.afterTwoHundredShots=swarm.activeMuzzleLights().length;
  res.ringSize=swarm.muzzleLights.length;

  // 4. Newest wins — the flash you want is the one that just happened.
  const recency=make();
  for(let i=0;i<20;i++)recency.muzzle(i*100,0,0,1,'rifle');
  const held=recency.activeMuzzleLights().map(l=>l.x).sort((a,b)=>a-b);
  res.heldPositions=held;
  res.holdsMostRecent=held[held.length-1]===1900;

  // 5. Brief. A light that outlives its own flash reads as a lamp.
  const decay=make();
  decay.muzzle(0,0,0,1,'rifle');
  decay.update(.03);
  res.midIntensity=+(decay.activeMuzzleLights()[0]?.intensity??0).toFixed(3);
  decay.update(.05);
  res.afterEightyMs=decay.activeMuzzleLights().length;

  // 6. Reduce-flashing damps it without removing the information.
  const damped=make({reducedFlashing:true});
  damped.muzzle(0,0,0,1,'rifle');
  res.dampedIntensity=+(damped.activeMuzzleLights()[0]?.intensity??0).toFixed(3);

  // 7. No allocation per read, and none left across a contract boundary.
  const reused=make();
  reused.muzzle(0,0,0,1,'rifle');
  const scratch=[];
  const a1=reused.activeMuzzleLights(scratch);
  const a2=reused.activeMuzzleLights(scratch);
  res.reusesScratch=a1===scratch&&a2===scratch;
  reused.clear();
  res.clearedOnClear=reused.activeMuzzleLights().length;
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
if(out.restingLights)fail.push('a quiet sector already has muzzle lights in it');
if(out.afterOneShot!==1)fail.push(`one shot produced ${out.afterOneShot} lights`);
if(!(out.firstIntensity>0))fail.push('a shot lights nothing');
if(!(out.firstRadius>0))fail.push('the flash has no reach');
if(!out.warm)fail.push('muzzle light is not warm');
if(!(out.reach.heavy>out.reach.pistol))fail.push(`a heavy weapon lights no more of the room than a pistol (${out.reach.heavy} vs ${out.reach.pistol})`);
if(!(out.reach.shotgun>out.reach.rifle))fail.push('a shotgun lights no more than a rifle');
if(!out.suppressedDark)fail.push(`a suppressed weapon lights the room (reach ${out.reach.suppressed})`);
if(out.afterTwoHundredShots>out.ringSize)fail.push(`200 shots produced ${out.afterTwoHundredShots} lights — the cap does not hold`);
if(out.ringSize>8)fail.push(`the muzzle light cap is ${out.ringSize} — too many to leave room for the lights that matter`);
if(!out.holdsMostRecent)fail.push(`the cap discards the newest flash rather than the oldest (${out.heldPositions})`);
if(!(out.midIntensity<out.firstIntensity))fail.push('the flash does not fall off');
if(out.afterEightyMs)fail.push('the flash is still lit 80ms later — that is a lamp, not a shot');
if(!(out.dampedIntensity<out.firstIntensity))fail.push('reduce-flashing does not damp muzzle lighting');
if(!(out.dampedIntensity>0))fail.push('reduce-flashing removes the light entirely, losing where fire is coming from');
if(!out.reusesScratch)fail.push('reading the flashes allocates a new array each frame');
if(out.clearedOnClear)fail.push('a flash survives into the next contract');
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\ngunfire lights the sector without swamping it');
await b.close();
