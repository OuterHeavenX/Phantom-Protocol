// Where exactly do two identical runs first disagree?
// Storage key: `red-static-save` is the live one. `phantom-protocol-save` is a
// legacy name the game reads as a fallback and never writes — seeding that one
// works exactly once, until the game writes the real key, after which every
// seed is silently ignored and the harness tests a default save without saying
// so.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const MODE=process.argv[2]||'2d';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function run(){
  const p=await b.newPage({viewport:{width:1100,height:700}});
  await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
  await p.waitForTimeout(400);
  await p.evaluate(m=>{const raw=JSON.parse(localStorage.getItem('red-static-save')||'{}');
    // Without a version the save goes through `migrate`, which rebuilds it from
  // the v1/v2 layout and drops anything seeded here.
  raw.version=3;
  // DEPLOY is gated behind campaign progress now, and this harness reaches a
  // sector through it. Seeded as an operator who has been through the opening.
  raw.campaign={...(raw.campaign||{}),op1:{completed:true}};
  raw.statistics={...(raw.statistics||{}),missions:2};
  raw.settings={...(raw.settings||{}),renderer:m,showMinimap:false};
    localStorage.setItem('red-static-save',JSON.stringify(raw))},MODE);
  await p.reload({waitUntil:'load'});await p.waitForTimeout(700);
  await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
  await p.waitForTimeout(300);
  await p.evaluate(()=>{[...document.querySelectorAll('button,a')].find(e=>/DEPLOY/i.test(e.textContent))?.click()});
  await p.waitForTimeout(250);
  await p.evaluate(()=>{const r=Math.random;Math.random=()=>0.4242;
    try{document.querySelector('#deployBtn')?.click()}finally{Math.random=r}});
  await p.waitForTimeout(1800);
  const out=await p.evaluate(()=>{
    const s=window.__pp,e=s.engine;
    cancelAnimationFrame(s.raf);
    const spawn=e.world.playerSpawn();
    e.player.x=spawn.x;e.player.y=spawn.y;e.player.vx=0;e.player.vy=0;
    e.player.maxHp=1e5;e.player.hp=1e5;e.player.angle=0;
    e.player.statuses.clear();
    e.elapsed=0;e.accumulator=0;e.frame=0;
    e.enemies.length=0;e.projectiles.length=0;e.enemyProjectiles.length=0;
    e.pickups.length=0;e.strikes.length=0;e.beams.length=0;e.shockwaves.length=0;
    e.kills=0;e.combo=0;
    for(const pt of e.world.coverPoints||[])pt.claimedBy=null;
    e.world.hazards.forEach((h,i)=>{h.timer=(i*0.37)%(h.interval||3);
      h.warning=0;h.active=false;h.activeTimer=0;h.phase=i*1.13});
    // Weapon cooldowns are the last thing carrying the pre-roll forward. A
    // weapon a third of the way through its cycle fires on a different tick
    // than one at zero, and everything downstream of that first round —
    // hostile HP, knockback, positions — diverges with it. This was the only
    // remaining difference between two runs of the identical build.
    for(const w of e.loadout?.weapons||[]){w.cooldown=0;if(w.timer!==undefined)w.timer=0}
    e.rng.state=(e.rng.seed||0x9e3779b9)>>>0;
    e.director.spawnQueue.length=0;
    e.director.update=()=>{};
    Object.defineProperty(e.director,'enemyCap',{get:()=>64,configurable:true});
    for(let i=0;i<12;i++){
      const a=(i/12)*Math.PI*2,d=170+((i*53)%5)*46;
      const sp=e.world.findSpawn(e.rng,{x:e.player.x+Math.cos(a)*d,y:e.player.y+Math.sin(a)*d},0,60,14);
      const en=e.spawnEnemy(e.director.pickArchetype(e.rng),sp.x,sp.y);
      if(en){en.awareness=1;en.maxHp*=3;en.hp=en.maxHp}
    }
    const script={moveX:0,moveY:0,ax:1,ay:0,
      aimVector(){return{x:this.ax,y:this.ay,manual:true}},takeAction(){return false},poll(){}};
    const frames=[];
    for(let t=0;t<170;t++){
      const a=t*0.021;
      script.moveX=Math.cos(a);script.moveY=Math.sin(a*2);
      script.ax=Math.cos(a*1.7);script.ay=Math.sin(a*1.7);
      e.step(1/60,script);
      frames.push([
        'P|'+e.projectiles.map(pr=>
          `${pr.x.toFixed(4)},${pr.y.toFixed(4)},${pr.damage},${(pr.life??0).toFixed(4)}`).join(' / '),
        'W|'+(e.loadout?.weapons||[]).map(w=>(+w.cooldown).toFixed(4)).join(','),
        'S|'+`${e.player.x.toFixed(6)},${e.player.y.toFixed(6)},${e.player.angle.toFixed(6)},`+
             `${(e.manualAim?1:0)},${(e.engagementX??0).toFixed(4)},${(e.engagementY??0).toFixed(4)}`
      ].concat(e.enemies.map(en=>
        `${en.x.toFixed(6)},${en.y.toFixed(6)},${en.vx.toFixed(6)},${en.vy.toFixed(6)},`+
        `${en.hp.toFixed(3)},${en.state||''},${(en.awareness??0).toFixed(4)},`+
        `${(en.fireTimer??0).toFixed(4)},${(en.stateTimer??0).toFixed(4)}`)));
    }
    return{frames,rngAfter:e.rng.state>>>0};
  });
  await p.close();
  return out;
}
const a=await run(),c=await run();
let found=false;
for(let t=0;t<a.frames.length&&!found;t++){
  for(let i=0;i<a.frames[t].length;i++){
    if(a.frames[t][i]!==c.frames[t][i]){
      console.log(`first divergence at tick ${t}, row ${i}`);
      console.log('  rows: 0=projectiles 1=weaponTimers 2=player, then enemies');
      console.log('  run A:',a.frames[t][i]);
      console.log('  run B:',c.frames[t][i]);
      if(t>0){
        console.log('  previous tick A:',a.frames[t-1][i]);
        console.log('  previous tick B:',c.frames[t-1][i]);
      }
      found=true;break;
    }
  }
}
if(!found)console.log('no divergence in 40 ticks; rng after A',a.rngAfter,'B',c.rngAfter);
await b.close();
