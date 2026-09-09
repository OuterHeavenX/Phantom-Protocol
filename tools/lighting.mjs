// Does each theatre look like itself, and is it still playable?
//
// The failure mode of an atmosphere pass is a sector that looks superb and
// cannot be read — a hostile that vanishes against the floor, a round that
// disappears into a vignette. So the clamps get as many assertions as the
// profiles do, and they are asserted as enforced behaviour rather than as
// documented intent: `lightingFor` must refuse an out-of-range profile, not
// merely be accompanied by a comment asking nicely.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const p=await b.newPage({viewport:{width:900,height:600}});
const errs=[];p.on('pageerror',e=>errs.push(String(e&&e.stack||e).split('\n')[0]));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(600);

const out=await p.evaluate(async()=>{
  const {LIGHTING,LIGHTING_LIMITS,lightingFor,exposureAt}=await import('/data/lighting.js');
  const {MAPS}=await import('/data/maps.js');
  const res={};

  // 1. Coverage, and that the grades are actually different grades.
  res.theatres=MAPS.length;
  res.missing=MAPS.filter(m=>!LIGHTING[m.id]).map(m=>m.id);
  const sig=id=>{const g=lightingFor(id);
    return [g.exposure,g.ambient,g.vignette,g.tint.join('/')].join('|')};
  res.distinctGrades=new Set(MAPS.map(m=>sig(m.id))).size;
  // An unlisted theatre is lit like the game rather than not lit at all.
  const unknown=lightingFor('nowhere');
  res.unknownIsNeutral=unknown.exposure===1&&unknown.ambient===1&&unknown.vignette===1;

  // 2. Identity: the physics has to be the right way round.
  res.snowAmbient=lightingFor('hollow').ambient;
  res.orbitalAmbient=lightingFor('orbital').ambient;
  res.snowBrighterThanDerelict=res.snowAmbient>res.orbitalAmbient;
  res.foundryWarm=lightingFor('foundry').tint[0]>lightingFor('foundry').tint[2];
  res.arcticCool=lightingFor('arctic').tint[2]>lightingFor('arctic').tint[0];
  res.flickering=MAPS.filter(m=>lightingFor(m.id).flicker).map(m=>m.id);

  // 3. The readability clamps, enforced rather than intended.
  const absurd={exposure:9,ambient:99,tint:[4,.05,4],vignette:8,flicker:[3,.9]};
  const {LIGHTING:L}=await import('/data/lighting.js');
  L.__probe=absurd;
  const clamped=lightingFor('__probe');
  delete L.__probe;
  res.clamped={
    exposure:clamped.exposure,ambient:clamped.ambient,
    tint:clamped.tint,vignette:clamped.vignette,
    flickerDepth:clamped.flicker?clamped.flicker[1]:0
  };
  res.limits=LIGHTING_LIMITS;
  // And every shipped profile is inside them without needing to be clamped.
  res.allWithinLimits=MAPS.every(m=>{
    const raw=LIGHTING[m.id];if(!raw)return true;
    const g=lightingFor(m.id);
    return g.exposure===raw.exposure&&g.ambient===raw.ambient&&g.vignette===raw.vignette;
  });

  // 4. Flicker: present, small, and switched off by reduce-flashing.
  const foundry=lightingFor('foundry');
  const samples=[];
  for(let t=0;t<40;t++)samples.push(exposureAt(foundry,t*.05,false));
  res.flickerRange=+(Math.max(...samples)-Math.min(...samples)).toFixed(4);
  res.flickerCentre=+(samples.reduce((a,v)=>a+v,0)/samples.length).toFixed(3);
  const reduced=[];
  for(let t=0;t<40;t++)reduced.push(exposureAt(foundry,t*.05,true));
  res.reducedRange=+(Math.max(...reduced)-Math.min(...reduced)).toFixed(4);
  // A theatre with no flicker must be perfectly steady.
  const still=lightingFor('hollow');
  res.steadyRange=+(Math.max(...[0,1,2,3].map(t=>exposureAt(still,t)))
    -Math.min(...[0,1,2,3].map(t=>exposureAt(still,t)))).toFixed(4);
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');

const fail=[];
const L=out.limits;
if(out.missing.length)fail.push(`${out.missing.length} theatre(s) have no lighting grade: ${out.missing}`);
if(out.distinctGrades<out.theatres)fail.push(`${out.theatres} theatres share only ${out.distinctGrades} grades`);
if(!out.unknownIsNeutral)fail.push('an unlisted theatre is graded rather than left neutral');
if(!out.snowBrighterThanDerelict)fail.push(`a whiteout (${out.snowAmbient}) is not brighter than a dead orbital platform (${out.orbitalAmbient})`);
if(!out.foundryWarm)fail.push('the foundry is not lit warm');
if(!out.arcticCool)fail.push('the arctic relay is not lit cool');
if(out.flickering.length<3)fail.push(`only ${out.flickering.length} theatres have any flicker`);
if(out.flickering.length>7)fail.push(`${out.flickering.length} theatres flicker — the whole game pulses`);
if(out.clamped.exposure>L.exposure[1])fail.push(`an absurd exposure was not clamped (${out.clamped.exposure})`);
if(out.clamped.ambient>L.ambient[1])fail.push(`an absurd ambient was not clamped (${out.clamped.ambient})`);
if(out.clamped.vignette>L.vignette[1])fail.push(`an absurd vignette was not clamped (${out.clamped.vignette}) — the frame can be closed to a pinhole`);
if(out.clamped.tint.some(c=>c>L.tint[1]||c<L.tint[0]))fail.push(`an absurd tint was not clamped (${out.clamped.tint}) — a theatre can be recoloured wholesale`);
if(out.clamped.flickerDepth>L.flickerDepth)fail.push(`an absurd flicker depth was not clamped (${out.clamped.flickerDepth})`);
if(!out.allWithinLimits)fail.push('a shipped profile is outside the limits and is being silently clamped');
if(!(out.flickerRange>.005))fail.push('the flickering theatres do not actually flicker');
if(out.flickerRange>.14)fail.push(`flicker swings exposure by ${out.flickerRange} — the frame visibly pulses`);
if(out.reducedRange>.0001)fail.push(`reduce-flashing leaves ${out.reducedRange} of flicker — it damps rather than stops`);
if(out.steadyRange>.0001)fail.push('a theatre with no flicker is not steady');
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nevery theatre is lit like itself, and still readable');
await b.close();
