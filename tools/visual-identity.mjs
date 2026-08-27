// Does the presentation actually differ per weapon and per surface?
//
// The failure this guards against is the one it was written for: thirty weapons
// and ten theatres all producing the same five-spark burst and the same cone of
// muzzle flash. It asserts difference, not beauty.
// Storage key: `red-static-save` is the live one. `phantom-protocol-save` is a
// legacy name the game reads as a fallback and never writes — seeding that one
// works exactly once, until the game writes the real key, after which every
// seed is silently ignored and the harness tests a default save without saying
// so.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
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
  const {MAPS}=await import('/data/maps.js');
  const e=window.__pp.engine,fx=e.fx;
  const res={};
  // Count particles produced by one event, by intercepting the pool.
  const count=fn=>{let n=0;const real=fx.particle.bind(fx);
    fx.particle=o=>{n++;return real(o)};try{fn()}finally{fx.particle=real}return n;};
  // 1. Muzzle flash differs by family.
  const voices=['suppressed','pistol','smg','rifle','shotgun','marksman','sniper','lmg','heavy','beam','tech','corrupted'];
  res.muzzle={};for(const v of voices)res.muzzle[v]=count(()=>fx.muzzle(0,0,0,1,v));
  res.muzzleDistinct=new Set(Object.values(res.muzzle)).size;
  res.suppressedQuietest=Math.min(...Object.values(res.muzzle))===res.muzzle.suppressed;
  // 2. Impact differs by surface.
  const surfaces=['concrete','metal','snow','ice','water','sand','glass','mire','armour'];
  res.impact={};for(const s of surfaces)res.impact[s]=count(()=>fx.surfaceImpact(0,0,0,{surface:s,voice:'rifle',intensity:1}));
  res.impactDistinct=new Set(Object.values(res.impact)).size;
  // 3. Impact scales with weapon family on the same surface.
  res.punch={};for(const v of ['suppressed','rifle','heavy'])res.punch[v]=count(()=>fx.surfaceImpact(0,0,0,{surface:'concrete',voice:v,intensity:1}));
  res.punchOrdered=res.punch.suppressed<res.punch.rifle&&res.punch.rifle<res.punch.heavy;
  // 4. Every theatre declares a surface, and they are not all the same.
  res.theatres=MAPS.length;
  res.withSurface=MAPS.filter(m=>m.surface?.ground&&m.surface?.wall).length;
  res.groundKinds=new Set(MAPS.map(m=>m.surface?.ground)).size;
  // 5. Brass only from ballistic families.
  res.casingBallistic=count(()=>fx.casing(0,0,0,'rifle'));
  res.casingEnergy=count(()=>fx.casing(0,0,0,'beam'));
  // 6. Camera layers sum, cap, and decay independently.
  const cam=e.camera;cam.shakeLayers={};cam.trauma=0;
  cam.addShake(1,'recoil');const recoilCapped=+cam.shakeLayers.recoil.toFixed(3);
  cam.addShake(1,'explosion');const both=+cam.totalTrauma().toFixed(3);
  cam.update(.5,1);
  res.recoilCap=recoilCapped;
  res.layersSum=both;
  res.recoilDecaysFaster=(cam.shakeLayers.recoil||0)<(cam.shakeLayers.explosion||0);
  res.totalCapped=cam.trauma<=0.9001;
  return res;
});
const fail=[];
if(out.muzzleDistinct<5)fail.push(`muzzle flashes only ${out.muzzleDistinct} distinct shapes`);
if(!out.suppressedQuietest)fail.push('suppressed weapon is not the least visible');
if(out.impactDistinct<4)fail.push(`impacts only ${out.impactDistinct} distinct responses`);
if(!out.punchOrdered)fail.push('impact does not scale with weapon weight');
if(out.withSurface!==out.theatres)fail.push(`${out.theatres-out.withSurface} theatres have no surface`);
if(out.groundKinds<4)fail.push(`only ${out.groundKinds} distinct ground materials across theatres`);
if(out.casingEnergy!==0)fail.push('energy weapons eject brass');
if(out.casingBallistic===0)fail.push('ballistic weapons eject no brass');
if(!out.recoilDecaysFaster)fail.push('recoil does not decay faster than an explosion');
if(!out.totalCapped)fail.push('camera shake is not capped');
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nvisual identity intact');
await b.close();
