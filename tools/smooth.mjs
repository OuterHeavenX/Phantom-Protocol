// Frame-pacing measurement. The simulation runs in fixed 1/60 quanta; the
// display does not. This drives the real engine at a chosen refresh rate and
// measures how evenly the camera actually travels — which is what "smooth"
// means to a player holding one direction down.
//
// The metric is the second difference of camera position per frame. Under a
// constant-velocity operative the camera should advance the same distance
// every frame; anything left over is judder, in on-screen pixels.
//
//   node tools/smooth.mjs [hz,hz,...] [frames]
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const RATES=(process.argv[2]||'60,72,90,120,144').split(',').map(Number);
const FRAMES=Number(process.argv[3]||900);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1280,height:720}});
p.on('pageerror',e=>console.log('  pageerror',String(e&&e.message||e)));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(400);
await p.evaluate(()=>{
  const raw=JSON.parse(localStorage.getItem('phantom-protocol-save')||'{}');
  raw.version=3;raw.maps=raw.maps||{};
  for(const id of ['blacksite','arctic','sunken','foundry','orbital','crossfall','hollow','mire','hangar','proving'])
    raw.maps[id]={...(raw.maps[id]||{}),unlocked:true};
  raw.settings={...(raw.settings||{}),renderer:'2d',showMinimap:false,showFps:false};
  localStorage.setItem('phantom-protocol-save',JSON.stringify(raw));
});
await p.reload({waitUntil:'load'});await p.waitForTimeout(700);
await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
await p.waitForTimeout(300);
await p.evaluate(()=>{[...document.querySelectorAll('button,a')].find(e=>/DEPLOY/i.test(e.textContent))?.click()});
await p.waitForTimeout(250);
await p.evaluate(()=>document.querySelector('[data-map="blacksite"]')?.click());
await p.waitForTimeout(200);
await p.evaluate(()=>{const r=Math.random;Math.random=()=>0.4242;
  try{document.querySelector('#deployBtn')?.click()}finally{Math.random=r}});
await p.waitForTimeout(1800);

const rows=await p.evaluate(async ({rates,frames})=>{
  const s=window.__pp,e=s.engine;
  cancelAnimationFrame(s.raf);
  // A deterministic stand-in for Input: hold one direction, aim fixed. The
  // point is a constant-velocity operative, so any unevenness in the camera
  // belongs to the loop and not to the movement.
  const script={moveX:1,moveY:0,ax:1,ay:0,
    aimVector(){return{x:this.ax,y:this.ay,manual:true}},
    takeAction(){return false},poll(){}};
  // The sector is emptied of geometry and hostiles for the duration. What is
  // under test is the loop, not collision: an operative who walks into a wall
  // stops moving, the camera stops with them, and a run that measures nothing
  // reads as perfectly smooth. Same reason the route is a wide arc — it never
  // has to turn around, so no direction change can be mistaken for judder.
  e.world.walls.length=0;e.world.cover.length=0;e.world.rebuildHash();
  e.world.hazards.length=0;
  e.director.update=()=>{};
  const measure=(hz,interp,jitter)=>{
    e.enemies.length=0;e.projectiles.length=0;e.enemyProjectiles.length=0;
    const spawn=e.world.playerSpawn();
    e.player.x=spawn.x;e.player.y=spawn.y;e.player.vx=0;e.player.vy=0;
    e.player.maxHp=1e6;e.player.hp=1e6;e.player.angle=0;
    e.accumulator=0;e.interpAlpha=0;e.restoreInterpolation();
    e.camera.x=spawn.x;e.camera.y=spawn.y;
    e.settings.renderInterpolation=interp;
    // The camera has to settle onto the moving operative before anything is
    // measured, or the run-up dominates the numbers.
    // Real frame deltas are not the nominal ones. `jitter` shakes each delta
    // by up to +/-12%, the way a browser actually delivers them, because an
    // interpolator that only behaves on a metronome has not been tested.
    let seed=12345;
    const nextDt=()=>{
      const base=1/hz;
      if(!jitter)return base;
      seed=(seed*1664525+1013904223)>>>0;
      return base*(1+((seed/4294967296)-.5)*.24);
    };
    // One slow revolution over the whole run: the operative never stops, and
    // the arc's own contribution to the second difference is v^2/r*dt^2,
    // under a hundredth of a pixel at any of these rates.
    const dir=i=>{const a=(i/(frames+240))*Math.PI*2;
      script.moveX=Math.cos(a);script.moveY=Math.sin(a);};
    for(let i=0;i<240;i++){dir(i);e.update(nextDt(),script);}
    // Two things the eye actually tracks: the sector scrolling past (which is
    // the camera) and the operative's own position within the frame.
    const world=[],self=[];
    for(let i=0;i<frames;i++){
      dir(240+i);e.update(nextDt(),script);
      const z=e.camera.zoom;
      world.push([-e.camera.x*z,-e.camera.y*z]);
      self.push([(e.player.x-e.camera.x)*z,(e.player.y-e.camera.y)*z]);
    }
    const judder=seq=>{
      const j=[];let travel=0;
      for(let i=2;i<seq.length;i++){
        const dx1=seq[i][0]-seq[i-1][0],dy1=seq[i][1]-seq[i-1][1];
        const dx0=seq[i-1][0]-seq[i-2][0],dy0=seq[i-1][1]-seq[i-2][1];
        travel+=Math.hypot(dx1,dy1);
        j.push(Math.hypot(dx1-dx0,dy1-dy0));
      }
      j.sort((a,b)=>a-b);
      return {p95:j[Math.floor(j.length*.95)],worst:j[j.length-1],travel};
    };
    const w=judder(world),sf=judder(self);
    return {p95:w.p95,worst:w.worst,travel:w.travel,selfP95:sf.p95,selfWorst:sf.worst};
  };
  const out=[];
  for(const hz of rates){
    // Off first, then on, so each pair is measured from the same fresh state.
    for(const jitter of [false,true]){
      const off=measure(hz,false,jitter);
      const on=measure(hz,true,jitter);
      out.push({hz,jitter,off,on});
    }
  }
  e.settings.renderInterpolation=true;
  return out;
},{rates:RATES,frames:FRAMES});

console.log('on-screen judder, pixels per frame (second difference)');
console.log('           -- sector scrolling --   -- operative on screen --');
console.log('display     off        on             off        on');
console.log('(~ = frame deltas jittered +/-12%, as a browser really delivers them)');
let bad=0;
for(const r of rows){
  const f=v=>v.toFixed(3).padStart(7);
  // A run where the camera barely moved measured nothing, and would otherwise
  // report flawless smoothness. Say so instead.
  const stalled=Math.min(r.off.travel,r.on.travel)<200;
  if(stalled)bad++;
  console.log(`${String(r.hz+' Hz'+(r.jitter?' ~':'')).padEnd(9)}${f(r.off.p95)}   ${f(r.on.p95)}        ${f(r.off.selfP95)}   ${f(r.on.selfP95)}`
    +(stalled?`   STALLED, camera travelled only ${Math.round(Math.min(r.off.travel,r.on.travel))}px`:''));
}
if(bad)process.exitCode=1;
await b.close();
