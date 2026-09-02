// Does the camera match the weapon, and does it stay readable?
//
// Two failures matter here and they pull against each other. A camera that does
// not respond makes a heavy weapon feel like a toy; a camera that responds to
// everything makes the game unplayable, and the second is much easier to ship
// by accident because each individual change feels like an improvement.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:900,height:600}});
const errs=[];p.on('pageerror',e=>errs.push(String(e&&e.stack||e).split('\n')[0]));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(600);

const out=await p.evaluate(async()=>{
  const {Camera}=await import('/src/core/camera.js');
  const res={};
  const cam=()=>{const c=new Camera(900,600);c.resize(900,600);return c};

  // 1. Weapon class hierarchy. Read off the engine's own table, not restated
  //    here — a copy would drift and then assert its own drift is correct.
  const src=await (await fetch('/src/game/engine.js')).text();
  const block=src.slice(src.indexOf('const RECOIL={'),src.indexOf('};',src.indexOf('const RECOIL={')));
  res.recoil=Object.fromEntries([...block.matchAll(/(\w+):([0-9.]+)/g)].map(m=>[m[1],+m[2]]));
  const r=res.recoil;
  res.hierarchy=[r.suppressed,r.pistol,r.rifle,r.shotgun,r.sniper,r.heavy];
  res.heavyOverSuppressed=+(r.heavy/r.suppressed).toFixed(1);

  // 2. A single heavy hit lands in full — diminishing returns must not blunt
  //    the first impulse, only the pile-up.
  const single=cam();
  single.addShake(.5,'explosion');
  res.singleExplosion=+single.shakeLayers.explosion.toFixed(4);

  // 3. Sustained fire must not pin the layer at its cap.
  const burst=cam();
  for(let i=0;i<60;i++)burst.addShake(r.lmg,'recoil');
  res.burstRecoil=+burst.shakeLayers.recoil.toFixed(4);
  res.recoilCap=.22;
  res.burstFillsCap=+(burst.shakeLayers.recoil/res.recoilCap).toFixed(3);

  // A single shot from the same weapon, for the ratio that says the camera is
  // still responding to individual rounds rather than sitting on a limit.
  const one=cam();
  one.addShake(r.lmg,'recoil');
  res.singleRecoil=+one.shakeLayers.recoil.toFixed(4);

  // 4. Everything at once must stay under the whole-camera cap.
  const chaos=cam();
  for(let i=0;i<40;i++){
    chaos.addShake(.5,'explosion');chaos.addShake(.4,'impact');
    chaos.addShake(.3,'boss');chaos.addShake(.2,'environment');
    chaos.addShake(.2,'signal');chaos.addShake(.1,'recoil');
  }
  res.totalTrauma=+chaos.trauma.toFixed(4);
  res.totalCap=.9;

  // 5. It must decay back to rest, or the sector never settles.
  const decaying=cam();
  decaying.addShake(.5,'explosion');
  // Called without optional chaining on purpose. `update?.()` on a renamed or
  // missing method silently does nothing, the camera never decays because it
  // was never stepped, and the assertion passes by measuring an untouched
  // object — which is the same shape of hole this project has hit before.
  for(let i=0;i<180;i++)decaying.update(1/60);
  res.afterTwoSeconds=+(decaying.trauma||0).toFixed(4);
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
const h=out.hierarchy;
for(let i=1;i<h.length;i++){
  if(!(h[i]>h[i-1]))fail.push(`weapon recoil is not monotonic across classes: ${h}`);
}
if(out.heavyOverSuppressed<4)fail.push(`a heavy weapon shakes the camera only ${out.heavyOverSuppressed}x a suppressed one`);
if(!(out.singleExplosion>.45))fail.push(`a single explosion lands only ${out.singleExplosion} — diminishing returns blunted the first impulse`);
if(out.burstFillsCap>.96)fail.push(`sustained fire pins the recoil layer at ${out.burstFillsCap} of its cap — the camera stops responding and just vibrates`);
if(!(out.burstRecoil>out.singleRecoil))fail.push('sustained fire does not build at all');
if(out.totalTrauma>out.totalCap+1e-6)fail.push(`everything at once reaches ${out.totalTrauma}, over the whole-camera cap of ${out.totalCap}`);
if(out.afterTwoSeconds>.05)fail.push(`the camera is still at ${out.afterTwoSeconds} two seconds after one explosion`);
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nthe camera matches the weapon and still settles');
await b.close();
