// Deterministic gameplay parity: identical seed, identical scripted input,
// under Canvas 2D and under WebGL2. Compares simulation state, never pixels.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const THEATRES=process.argv[2]?process.argv[2].split(','):['blacksite'];
const TICKS=Number(process.argv[3]||900);
// `A:B` runs renderer A against renderer B. `2d:2d` is the control: it asks
// whether the harness and the simulation are deterministic at all before any
// claim about renderers is made.
const PAIR=(process.argv[4]||'2d:gl').split(':');
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});

async function run(theatre,mode){
  const p=await b.newPage({viewport:mode==='gl'?{width:1000,height:640}:{width:1280,height:720}});
  const errs=[];
  p.on('pageerror',e=>errs.push(String(e&&e.stack||e).split('\n')[0]));
  await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
  await p.waitForTimeout(400);
  await p.evaluate(m=>{
    const raw=JSON.parse(localStorage.getItem('phantom-protocol-save')||'{}');
    raw.version=3;raw.maps=raw.maps||{};
    for(const id of ['blacksite','arctic','sunken','foundry','orbital','crossfall','hollow','mire','hangar','proving'])
      raw.maps[id]={...(raw.maps[id]||{}),unlocked:true};
    raw.settings={...(raw.settings||{}),renderer:m,showMinimap:false,showFps:false};
    localStorage.setItem('phantom-protocol-save',JSON.stringify(raw));
  },mode);
  await p.reload({waitUntil:'load'});await p.waitForTimeout(700);
  await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
  await p.waitForTimeout(300);
  await p.evaluate(()=>{[...document.querySelectorAll('button,a')].find(e=>/DEPLOY/i.test(e.textContent))?.click()});
  await p.waitForTimeout(250);
  await p.evaluate(t=>document.querySelector(`[data-map="${t}"]`)?.click(),theatre);
  await p.waitForTimeout(200);
  await p.evaluate(()=>{const r=Math.random;Math.random=()=>0.4242;
    try{document.querySelector('#deployBtn')?.click()}finally{Math.random=r}});
  await p.waitForTimeout(1800);

  // Drive the simulation directly with a scripted input stream at a fixed
  // step. The render loop is stopped so the only thing advancing the world is
  // this loop — identical tick counts on both renderers by construction.
  const result=await p.evaluate(async ticks=>{
    const s=window.__pp;
    const e=s.engine;
    cancelAnimationFrame(s.raf);
    // Normalise the starting state. Both renderers spend a different number of
    // real frames getting to this point — the GL one is far slower under a
    // software rasteriser — so without this the comparison would be of two
    // runs that had already diverged before the first scripted tick, and any
    // mismatch would say nothing about the renderer.
    const spawn=e.world.playerSpawn();
    e.player.x=spawn.x;e.player.y=spawn.y;
    e.player.vx=0;e.player.vy=0;
    // Reinforced so the scripted run reaches its full length instead of ending
    // on a death a third of the way in. Deterministic, and identical on both
    // renderers. Hostiles still hit, so damage, knockback and hit reactions
    // all still run.
    e.player.maxHp=100000;e.player.hp=100000;
    e.player.angle=0;
    e.elapsed=0;e.accumulator=0;e.frame=0;
    e.enemies.length=0;e.projectiles.length=0;e.enemyProjectiles.length=0;
    e.pickups.length=0;e.strikes.length=0;
    e.kills=0;e.combo=0;
    e.beams.length=0;e.shockwaves.length=0;
    if(e.fields)e.fields.length=0;
    if(e.turrets)e.turrets.length=0;
    if(e.mines)e.mines.length=0;
    e.player.statuses.clear();
    // Hazards run on their own clocks and those clocks advanced through the
    // pre-roll, which is a different length on each run. A hazard that is
    // mid-cycle rather than dormant damages hostiles, moves them, and takes
    // the whole simulation with it. Rewound to a deterministic phase.
    e.world.hazards.forEach((h,i)=>{
      h.timer=(i*0.37)%(h.interval||3);
      h.warning=0;h.active=false;h.activeTimer=0;h.phase=i*1.13;
    });
    // Same for the random stream: the pre-roll drew a different number of
    // values on each renderer, so it is rewound to the contract seed. Combat
    // rolls in the scripted section then draw from the same position on both.
    // Weapon cooldowns are the last thing carrying the pre-roll forward. A
    // weapon a third of the way through its cycle fires on a different tick
    // than one at zero, and everything downstream of that first round —
    // hostile HP, knockback, positions — diverges with it. This was the only
    // remaining difference between two runs of the identical build.
    for(const w of e.loadout?.weapons||[]){w.cooldown=0;if(w.timer!==undefined)w.timer=0}
    e.rng.state=(e.rng.seed||0x9e3779b9)>>>0;
    // The director is stood down and a fixed hostile ring placed by hand, so
    // the population under test is identical rather than merely similarly
    // paced. Their AI, collision and damage are the real ones.
    // Detaching hostiles from `e.enemies` does not release what they were
    // holding. Cover points stay claimed by objects nothing can reach any
    // more, and the pre-roll claimed a different number on each run — which
    // is exactly the divergence a 2d-against-2d control run exposed.
    for(const pt of e.world.coverPoints||[])pt.claimedBy=null;
    e.director.spawnQueue.length=0;
    e.director.update=()=>{};
    Object.defineProperty(e.director,'enemyCap',{get:()=>64,configurable:true});
    for(let i=0;i<12;i++){
      const a=(i/12)*Math.PI*2;
      const d=170+((i*53)%5)*46;
      const spot=e.world.findSpawn(e.rng,
        {x:e.player.x+Math.cos(a)*d,y:e.player.y+Math.sin(a)*d},0,60,14);
      const en=e.spawnEnemy(e.director.pickArchetype(e.rng),spot.x,spot.y);
      if(en){en.awareness=1;en.maxHp*=3;en.hp=en.maxHp}
    }
    // A deterministic stand-in for the Input the engine reads.
    const script={
      moveX:0,moveY:0,
      aimVector(){return{x:this.ax,y:this.ay,manual:true}},
      takeAction(){return false},
      ax:1,ay:0,
      poll(){}
    };
    const samples=[];
    const placed=e.enemies.map(en=>`${en.id||en.type||'?'}@${en.x.toFixed(2)},${en.y.toFixed(2)}:${en.maxHp}`);
    const seedInfo={seed:e.seed,rng:e.rng.seed,state:e.rng.state>>>0,
      worldSeed:e.world.seed,elapsed:e.elapsed,
      level:e.level,statsMove:e.stats.moveSpeed,fireRate:e.stats.fireRate,
      weapons:(e.weapons||[]).map(x=>x.id||x.weaponId||'?').join('|')};
    const hash=()=>{
      let h=0;
      const push=v=>{h=(h*31+Math.round(v*100))|0};
      push(e.player.x);push(e.player.y);push(e.player.hp);
      push(e.enemies.length);push(e.projectiles.length);push(e.kills);push(e.xp||0);
      for(const en of e.enemies){push(en.x);push(en.y);push(en.hp)}
      return h;
    };
    for(let t=0;t<ticks;t++){
      // A repeating figure-of-eight that walks the operative into geometry
      // from every direction, with the weapon firing the whole time.
      const a=t*0.021;
      script.moveX=Math.cos(a);
      script.moveY=Math.sin(a*2);
      script.ax=Math.cos(a*1.7);script.ay=Math.sin(a*1.7);
      e.step(1/60,script);
      if(t%150===149)samples.push({t:t+1,
        px:+e.player.x.toFixed(3),py:+e.player.y.toFixed(3),
        hp:+e.player.hp.toFixed(3),
        enemies:e.enemies.filter(x=>!x.dead).length,
        projectiles:e.projectiles.length,
        kills:e.kills,level:e.level,
        elapsed:+e.elapsed.toFixed(4),
        hash:hash()});
      if(e.ended)break;
    }
    return{samples,placed,seedInfo,ended:e.ended,ticks:e.frame,
      renderer:s.renderer.constructor.name,
      seed:s.config.seed,
      world:[e.world.width,e.world.height],
      walls:e.world.walls.length,cover:e.world.cover.length,
      hazards:e.world.hazards.length};
  },TICKS);
  await p.close();
  return{...result,errors:errs};
}

let bad=0;
for(const theatre of THEATRES){
  const two=await run(theatre,PAIR[0]);
  const gl=await run(theatre,PAIR[1]);
  const same=JSON.stringify(two.samples)===JSON.stringify(gl.samples);
  const geo=two.walls===gl.walls&&two.cover===gl.cover&&two.hazards===gl.hazards&&
            String(two.world)===String(gl.world);
  if(!same||!geo)bad++;
  console.log(`${theatre.padEnd(10)} ${same&&geo?'PARITY OK':'*** MISMATCH ***'}  `+
    `${two.renderer} vs ${gl.renderer}  seed ${two.seed}/${gl.seed}  `+
    `geometry ${two.walls}/${two.cover}/${two.hazards} vs ${gl.walls}/${gl.cover}/${gl.hazards}`);
  if(!same){
    if(JSON.stringify(two.seedInfo)!==JSON.stringify(gl.seedInfo)){
      console.log('   SEED/STATS DIFFER\n    a:',JSON.stringify(two.seedInfo),
                  '\n    b:',JSON.stringify(gl.seedInfo));
    }
    for(let i=0;i<Math.max(two.placed.length,gl.placed.length);i++){
      if(two.placed[i]!==gl.placed[i]){
        console.log(`   PLACEMENT DIFFERS at ${i}: ${two.placed[i]} vs ${gl.placed[i]}`);
        break;
      }
    }
    for(let i=0;i<Math.max(two.samples.length,gl.samples.length);i++){
      const a=JSON.stringify(two.samples[i]),c=JSON.stringify(gl.samples[i]);
      if(a!==c){console.log('   2d:',a,'\n   gl:',c);break}
    }
  }else{
    const last=two.samples[two.samples.length-1];
    console.log('           final tick',last?.t,'player',last?.px+','+last?.py,
      'hostiles',last?.enemies,'kills',last?.kills,'ended',two.ended,'/',gl.ended);
  }
  for(const e of [...two.errors,...gl.errors].slice(0,3))console.log('   PAGE ERROR:',e);
}
await b.close();
process.exitCode=bad?1:0;
