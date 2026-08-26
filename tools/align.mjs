// Do hostile SPRITES land on their COLLIDERS? Measured in pixels, not
// eyeballed — this test exists because eyeballing got it wrong.
//
// Simulation-parity testing cannot catch a presentation bug by construction:
// the world can be bit-identical under both renderers while one of them draws
// it upside down. Two shipped defects hid in exactly that gap — the sprite
// layer was composited vertically mirrored, and the GL view matrix omitted the
// camera shake that Camera.apply applies. Both left every hostile drawn away
// from the collider it belonged to.
//
// Usage: node tools/align.mjs [gl|2d] [--shake]
// Each hostile is recoloured to a unique flat key colour and drawn alone; the
// composite is then scanned for that colour and its centroid compared with the
// world->screen position of the collider.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
import {readPng} from './png.mjs';
const MODE=process.argv[2]||'gl';
const SHAKE=process.argv.includes('--shake');
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:900,height:600}});
p.on('pageerror',e=>console.log('PAGEERROR',String(e).slice(0,200)));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(400);
await p.evaluate(m=>{const raw=JSON.parse(localStorage.getItem('phantom-protocol-save')||'{}');
  raw.settings={...(raw.settings||{}),renderer:m,showMinimap:false,showFps:false};
  localStorage.setItem('phantom-protocol-save',JSON.stringify(raw))},MODE);
await p.reload({waitUntil:'load'});await p.waitForTimeout(700);
await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
await p.waitForTimeout(300);
await p.evaluate(()=>{[...document.querySelectorAll('button,a')].find(e=>/DEPLOY/i.test(e.textContent))?.click()});
await p.waitForTimeout(250);
await p.evaluate(()=>{const r=Math.random;Math.random=()=>0.4242;
  try{document.querySelector('#deployBtn')?.click()}finally{Math.random=r}});
await p.waitForTimeout(2200);

const OFFSETS=[[0,-220],[0,220],[-260,0],[260,0],[-190,-190],[210,200]];
await p.evaluate(v=>{window.__alignShake=v},SHAKE);
const expected=await p.evaluate(offs=>{
  const s=window.__pp,e=s.engine,c=e.camera;
  e.director.update=()=>{};
  Object.defineProperty(e.director,'enemyCap',{get:()=>40,configurable:true});
  e.enemies.length=0;e.projectiles.length=0;e.enemyProjectiles.length=0;
  const px=e.world.width*.5,py=e.world.height*.5;
  e.player.x=px;e.player.y=py;e.player.vx=0;e.player.vy=0;
  // A pinned camera, optionally with a pinned shake and roll. The shake case
  // is the one that used to tear the sprite layer off the world.
  const SX=window.__alignShake?24:0,SY=window.__alignShake?-20:0;
  const ROLL=window.__alignShake?0.011:0;
  c.x=px;c.y=py;c.trauma=0;c.shakeX=SX;c.shakeY=SY;c.rotation=ROLL;
  c.update=function(){this.x=px;this.y=py;this.trauma=0;
    this.shakeX=SX;this.shakeY=SY;this.rotation=ROLL;this.zoom=this.baseZoom};
  c.follow=()=>{};c.zoom=c.baseZoom;
  // Freeze the world: no AI, no firing, no effects moving anything.
  e.updateEnemies=()=>{};
  e.fx.particles.active.length=0;
  const out=[];
  offs.forEach(([dx,dy],i)=>{
    const en=e.spawnEnemy(e.director.pickArchetype(e.rng),px+dx,py+dy);
    if(!en)return;
    en.awareness=0;en.maxHp*=999;en.hp=en.maxHp;en.vx=0;en.vy=0;en.radius=26;
    // A unique, flat, saturated key colour per hostile.
    en.color=['#00ff00','#0000ff','#ff00ff','#7f00ff','#00ff7f','#ff0080'][i];
    en.elite=false;
    // Where Camera.apply would put it: scale, then roll, then centre.
    const lx=(en.x-c.x)*c.zoom+SX, ly=(en.y-c.y)*c.zoom+SY;
    out.push({i,key:en.color,
      x:lx*Math.cos(ROLL)-ly*Math.sin(ROLL)+c.width/2,
      y:lx*Math.sin(ROLL)+ly*Math.cos(ROLL)+c.height/2});
  });
  return{marks:out,camW:c.width,camH:c.height,zoom:c.zoom};
},OFFSETS);
await p.waitForTimeout(1400);
const buf=await p.screenshot({timeout:180000});
await b.close();

const png=readPng(buf),ch=png.channels;
const hex=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
console.log(`\n=== ${MODE.toUpperCase()} sprite-vs-collider alignment${SHAKE?' (camera shaking)':''} ===`);
let worst=0,found=0;
for(const m of expected.marks){
  const [kr,kg,kb]=hex(m.key);
  let sx=0,sy=0,n=0;
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
    const i=(y*png.width+x)*ch;
    const R=png.data[i],G=png.data[i+1],B=png.data[i+2];
    // Near the key hue, and clearly saturated, so lit floor never matches.
    const mx=Math.max(R,G,B),mn=Math.min(R,G,B);
    if(mx-mn<60||mx<60)continue;
    // Direction of the colour vector, which survives the composite's
    // brightness scaling but not a change of hue.
    const kl=Math.hypot(kr,kg,kb)||1,pl=Math.hypot(R,G,B)||1;
    const dot=(R*kr+G*kg+B*kb)/(pl*kl);
    if(dot<0.965)continue;
    sx+=x;sy+=y;n++;
  }
  if(n<12){console.log(`  ${m.key}  collider (${m.x.toFixed(0)},${m.y.toFixed(0)})  sprite NOT FOUND`);continue}
  found++;
  const d=Math.hypot(sx/n-m.x,sy/n-m.y);
  worst=Math.max(worst,d);
  console.log(`  ${m.key}  collider (${m.x.toFixed(0)},${m.y.toFixed(0)})  sprite (${(sx/n).toFixed(0)},${(sy/n).toFixed(0)})  offset ${d.toFixed(1)}px`);
}
console.log(`\n  ${found}/${expected.marks.length} located, worst offset ${worst.toFixed(1)}px`,
  worst<30?'-> ALIGNED':'-> *** MISALIGNED ***');
process.exitCode=(found===expected.marks.length&&worst<30)?0:1;
