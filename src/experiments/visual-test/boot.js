// BLACKSITE VISUAL TEST — entry point.
//
// Opt-in only, via ?visualtest=1. Nothing in this module runs otherwise, and
// nothing in src/experiments is imported by the production entry point except
// the one dynamic import in main.js that this file exists to satisfy — so with
// the flag absent, not a byte of it is even fetched.
//
// The test borrows the production Engine wholesale. The simulation is not
// touched: hostiles path, shoot and die exactly as they do in a real contract,
// which is the only way an enemy-count sweep means anything. What is replaced
// is the renderer.

import {Engine} from '../../game/engine.js';
import {Renderer} from '../../render/renderer.js';
import {MAPS,DURATIONS,DIFFICULTIES_BY_ID} from '../../../data/maps.js';
import {OPERATIVES} from '../../../data/operatives.js';
import {VisualTestRenderer} from './renderer-gl.js';
import {emitters} from './scene.js';
import {Harness} from './harness.js';
import {preset} from './presets.js';

export async function bootVisualTest({audio,input,save}){
  await injectStyles();

  const app=document.querySelector('#app');
  app.innerHTML=`
    <div class="screen vt-screen">
      <canvas id="vtCanvas"></canvas>
      <div class="vt-banner">
        BLACKSITE VISUAL TEST — experimental renderer ·
        <a href="?">leave</a>
      </div>
    </div>`;
  const canvas=document.getElementById('vtCanvas');

  // A dedicated theatre entry so the production BLACKSITE ZERO is untouched.
  // Sized to the experimental sector and marked so world generation lays out a
  // room rather than the usual corridor grid.
  const baseMap=MAPS.find(m=>m.id==='blacksite');
  const map={
    ...baseMap,
    id:'blacksite-visual-test',
    name:'BLACKSITE VISUAL TEST',
    // The authored art pack belongs to the production theatre; this one paints
    // its own environment in GL and must not also draw the 2D one underneath.
    art:null
  };

  const params=new URLSearchParams(location.search);
  const quality=preset(params.get('preset')?.toUpperCase()||'HIGH');

  const engine=new Engine(canvas,{
    operative:OPERATIVES[0],
    map,
    duration:30,
    durationSpec:DURATIONS.find(d=>d.minutes===30)||DURATIONS[1],
    difficulty:DIFFICULTIES_BY_ID[1],
    settings:{...(save?.settings||{}),particles:'high',showMinimap:false,
      damageNumbers:true,autoAim:true,performanceMode:false},
    audio,
    devRanks:{},masteryXp:0,
    seed:20260822,
    primary:{weaponId:'needle',mods:null,ordnance:'breach',livery:null}
  });

  // ?renderer=2d runs the identical level, the identical simulation and the
  // identical enemy-count harness through the production Canvas 2D renderer
  // instead. It is the baseline every GL number here is only meaningful
  // against — without it the experiment can say "the new one runs at N" and
  // nothing at all about whether that is better.
  const use2d=params.get('renderer')==='2d';
  if(use2d)return boot2d({app,canvas,engine,quality,params,input});

  // The GL renderer claims the visible canvas first. A canvas gets exactly one
  // context for its lifetime, so taking a 2D one here — which an earlier
  // version of this file did, to build the sprite proxy — makes WebGL2
  // permanently unavailable on it.
  const renderer=new VisualTestRenderer(canvas,engine,
    {quality,seed:1337,capture:params.get('vtcapture')==='1'});
  if(renderer.failed){
    app.innerHTML=`<div class="vt-fail"><h1>WebGL2 unavailable</h1>
      <p>This experiment needs WebGL2. The production game does not.</p>
      <p><a href="?">Back to RED STATIC</a></p></div>`;
    return null;
  }

  // The production renderer, used here only for its entity passes: hostiles,
  // projectiles and pickups are drawn by the shipping sprite code so
  // readability under the new lighting is a fair comparison. It draws onto the
  // renderer's offscreen layer and never presents to the screen.
  const spriteProxy=new Renderer(renderer.entityCanvas,renderer.entityCtx,engine);
  renderer.spriteProxy=spriteProxy;
  renderer.initAtmosphere(emitters(renderer.scene));

  renderer.initAtmosphere(emitters(renderer.scene));

  return runLoop({app,canvas,engine,renderer,quality,params,input,
    onResize:()=>{
      // The proxy draws onto the entity layer, which the GL renderer sizes.
      spriteProxy.resize?.(renderer.entityCanvas.width,renderer.entityCanvas.height);
    }});
}

// ---------------------------------------------------------------------------
// The shared harness loop
// ---------------------------------------------------------------------------
//
// Both rendering paths run through this, so the enemy population, the
// simulation and the sampling are identical and the two sets of numbers can
// be put side by side.

function runLoop({app,canvas,engine,renderer,quality,params,input,onResize}){
  // The director is stood down so the population is exactly what the test asks
  // for. Hostiles are real: same archetypes, same AI, same collision.
  engine.director.update=()=>{};
  let target=Number(params.get('enemies'))||25;
  // The director also caps the population, ramped by how far into a contract
  // it is — which early on is sixteen, and silently made every scenario above
  // that a no-op. The test owns the count.
  Object.defineProperty(engine.director,'enemyCap',{
    get:()=>target+150,   // headroom for corpses not yet culled
    configurable:true
  });

  const ring=(i,n)=>{
    const a=(i/n)*Math.PI*2;
    const r=380+((i*37)%6)*80;
    return{x:engine.player.x+Math.cos(a)*r,y:engine.player.y+Math.sin(a)*r};
  };
  function maintain(){
    const alive=engine.enemies.filter(e=>!e.dead);
    if(alive.length>target){
      for(let i=target;i<alive.length;i++)alive[i].dead=true;
      return;
    }
    // Enough per frame that a jump from 25 to 200 settles well inside the
    // sweep's three-second settle window.
    let added=0;
    for(let i=alive.length;i<target&&added<64;i++,added++){
      const at=ring(i,Math.max(1,target));
      const x=Math.min(engine.world.width-80,Math.max(80,at.x));
      const y=Math.min(engine.world.height-80,Math.max(80,at.y));
      const enemy=engine.spawnEnemy(engine.director.pickArchetype(engine.rng),x,y);
      // Test hostiles are heavily reinforced. The operative never stops
      // firing, and a population that dies as fast as it spawns measures the
      // kill rate rather than the render cost — which is the thing being
      // asked about. They still take hits, so every impact, tracer and spark
      // the real game produces still happens.
      if(enemy){enemy.maxHp*=60;enemy.hp=enemy.maxHp}
    }
  }

  const harness=new Harness({
    engine,renderer,quality,
    onPresetChange:()=>renderer.resize(canvas.width,canvas.height),
    onEnemyCount:n=>{target=n}
  });
  harness.targetEnemies=target;
  harness.syncButtons();

  const resize=()=>{
    const dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.floor(window.innerWidth*dpr);
    canvas.height=Math.floor(window.innerHeight*dpr);
    canvas.style.width=`${window.innerWidth}px`;
    canvas.style.height=`${window.innerHeight}px`;
    engine.resize(canvas.width,canvas.height);
    renderer.resize(canvas.width,canvas.height);
    onResize?.(canvas.width,canvas.height);
  };
  window.addEventListener('resize',resize);
  resize();

  let last=performance.now();
  let raf=0;
  const frame=now=>{
    const ms=now-last;
    last=now;
    const dt=Math.min(.1,ms/1000);
    input.poll();
    // The operative never dies here: a stress test that ends after ninety
    // seconds cannot be swept.
    engine.player.hp=engine.player.maxHp;
    engine.pendingLevelUps=0;
    engine.timeRemaining=Math.max(60,engine.timeRemaining);
    engine.update(dt,input);
    maintain();
    renderer.render(dt);
    harness.update(ms,now);
    raf=requestAnimationFrame(frame);
  };
  raf=requestAnimationFrame(frame);

  const session={
    engine,renderer,harness,
    get target(){return target},
    stop(){
      cancelAnimationFrame(raf);
      window.removeEventListener('resize',resize);
      harness.dispose();
      renderer.dispose?.();
    }
  };
  window.__visualTest=session;
  return session;
}

// The experiment's stylesheet is injected rather than linked from index.html,
// so the production page carries nothing for a mode it is not in.
function injectStyles(){
  return new Promise(resolve=>{
    if(document.getElementById('vt-styles'))return resolve();
    const link=document.createElement('link');
    link.id='vt-styles';
    link.rel='stylesheet';
    link.href='./src/experiments/visual-test/visual-test.css';
    link.addEventListener('load',()=>resolve(),{once:true});
    link.addEventListener('error',()=>resolve(),{once:true});
    document.head.appendChild(link);
  });
}


// ---------------------------------------------------------------------------
// Canvas 2D baseline
// ---------------------------------------------------------------------------
//
// The production renderer, presenting to the screen, driven by the same
// harness so the two sets of numbers are directly comparable. This path adds
// nothing and improves nothing: it is the control.

function boot2d({app,canvas,engine,quality,params,input}){
  const ctx=canvas.getContext('2d',{alpha:false});
  const renderer=new Renderer(canvas,ctx,engine);

  // The harness reads a small surface off whatever is rendering. Presented as
  // an adapter rather than by teaching the harness about two renderers.
  const adapter={
    info:{renderer:'Canvas 2D (production renderer)',software:false,ok:true},
    timings:{gbuffer:0,lights:0,particles:0,bloom:0,composite:0,upload:0,entities:0},
    get lightCount(){return renderer.lightingEnabled?-1:0},
    get particleCount(){return engine.fx.particles.count},
    get propCount(){return engine.world.walls.length+engine.world.cover.length},
    width:canvas.width,height:canvas.height,
    internalWidth:canvas.width,internalHeight:canvas.height,
    resize(w,h){this.width=w;this.height=h;this.internalWidth=w;this.internalHeight=h},
    render(){
      const t=performance.now();
      renderer.render();
      this.timings.composite=performance.now()-t;
    },
    dispose(){renderer.destroy?.()}
  };
  return runLoop({app,canvas,engine,renderer:adapter,quality,params,input,
    onResize:(w,h)=>{renderer.resize?.(w,h);adapter.resize(w,h)}});
}
