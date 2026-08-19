import {loadSave,saveGame} from './save/storage.js';
import {commitRun,completeRecruitments,undiscoveredOperatives} from './save/progression.js';
import {Screens} from './ui/screens.js';
import {Hud} from './ui/hud.js';
import {LevelUpScreen} from './ui/levelup.js';
import {PauseMenu} from './ui/pause.js';
import {Engine} from './game/engine.js';
import {Renderer} from './render/renderer.js';
import {Input,isTouchDevice} from './core/input.js';
import {audio} from './core/audio.js';

// Application entry point. Owns the top-level state machine (menu ⇄ run),
// the render loop and the wiring between the simulation, the renderer and
// the DOM UI.

// Elements that must receive their own touches rather than driving the
// movement stick. Anything matching this keeps its synthesized click.
const UI_TOUCH_TARGETS='.overlay,.hud-actions,.stick-aim,button,a,input,select,textarea,[role="button"]';

let save=loadSave();
const completed=completeRecruitments(save);
if(completed.length>0)saveGame(save);
let session=null;
const input=new Input();
const screens=new Screens(save,startRun,audio);

screens.onSaveReplaced=next=>{
  save=next;
  screens.setSave(save);
  applyGlobalSettings();
};

applyGlobalSettings();
audio.applySettings({
  master:save.settings.master,music:save.settings.music,
  sfx:save.settings.sfx,muted:save.settings.muted
});

// Browsers block audio until a gesture; unlock on the first interaction.
const unlockAudio=()=>{
  audio.unlock().then(()=>{
    if(!session)audio.startMusic('menu');
  });
  window.removeEventListener('pointerdown',unlockAudio);
  window.removeEventListener('keydown',unlockAudio);
  window.removeEventListener('touchstart',unlockAudio);
};
window.addEventListener('pointerdown',unlockAudio);
window.addEventListener('keydown',unlockAudio);
window.addEventListener('touchstart',unlockAudio);

function applyGlobalSettings(){
  document.documentElement.style.setProperty('--ui-scale',save.settings.uiScale||1);
  document.documentElement.style.setProperty('--touch-scale',save.settings.touchSize||1);
  document.documentElement.classList.toggle('left-handed',!!save.settings.leftHanded);
  document.documentElement.classList.toggle('reduced-flashing',!!save.settings.reducedFlashing);
}

screens.menu();

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startRun(config){
  teardownSession();
  applyGlobalSettings();

  const app=document.querySelector('#app');
  const operativeRecord=save.operatives[config.operative.id]||{};

  // Build the engine first so the HUD can read from it as it constructs.
  const engineConfig={
    operative:config.operative,
    map:config.map,
    duration:config.duration,
    durationSpec:config.durationSpec,
    difficulty:config.difficulty,
    settings:save.settings,
    audio,
    devRanks:save.dev,
    masteryXp:operativeRecord.masteryXp||0,
    // Campaign operation, when this run is a story mission.
    objective:config.operation?.objective,
    // Files a personnel cache can turn up in this run.
    discoverable:undiscoveredOperatives(save).map(op=>({id:op.id,codename:op.codename})),
    seed:Math.floor(Math.random()*1e9)
  };

  // The HUD owns the canvas element, so create the DOM before the engine.
  const placeholder=document.createElement('canvas');
  placeholder.width=window.innerWidth;
  placeholder.height=window.innerHeight;
  const engine=new Engine(placeholder,engineConfig);

  const hud=new Hud(app,engine);
  const canvas=hud.el.canvas;
  const ctx=canvas.getContext('2d',{alpha:false});
  engine.canvas=canvas;

  const renderer=new Renderer(canvas,ctx,engine);
  const levelUp=new LevelUpScreen(engine,save);
  const pause=new PauseMenu(engine,save,{
    onSettingsChange:()=>{
      audio.applySettings(save.settings);
      renderer.quality=save.settings.particles;
      engine.fx.setQuality(save.settings.particles);
      saveGame(save);
    }
  });

  session={engine,renderer,hud,levelUp,pause,config,raf:0,last:performance.now(),detachSticks:[]};
  // Exposed for debugging and automated smoke tests.
  window.__pp=session;

  const resize=()=>{
    const dpr=Math.min(save.settings.performanceMode?1:2,window.devicePixelRatio||1);
    const width=Math.floor(window.innerWidth*dpr);
    const height=Math.floor(window.innerHeight*dpr);
    canvas.width=width;
    canvas.height=height;
    canvas.style.width=`${window.innerWidth}px`;
    canvas.style.height=`${window.innerHeight}px`;
    engine.resize(width,height);
    renderer.resize(width,height);
  };
  resize();
  session.onResize=resize;
  window.addEventListener('resize',resize,{passive:true});

  // Touch controls: movement stick anywhere on the left, aim stick on the right.
  if(isTouchDevice()){
    hud.el.screen.classList.add('touch');
    // The movement stick listens on the whole screen, so it must ignore
    // touches that begin on any interactive element inside it.
    session.detachSticks.push(
      input.bindStick(hud.el.stickMove,hud.el.knobMove,'move',{
        radius:48*(save.settings.touchSize||1),
        zone:hud.el.screen,
        ignore:UI_TOUCH_TARGETS
      })
    );
    session.detachSticks.push(
      input.bindStick(hud.el.stickAim,hud.el.knobAim,'aim',{
        radius:44*(save.settings.touchSize||1),
        dynamic:false,
        stopPropagation:true
      })
    );
  }

  hud.el.pauseBtn.addEventListener('click',()=>pause.toggle());
  hud.el.abilityBtn.addEventListener('click',()=>input.setAction('ability'));
  hud.el.dashBtn.addEventListener('click',()=>input.setAction('dash'));
  hud.el.turretBtn.addEventListener('click',()=>input.setAction('deploy'));

  engine.onEnd=summary=>finishRun(summary,config);
  engine.onBossSpawn=boss=>{
    // Brief cinematic hold on the boss reveal.
    engine.camera.punchZoom(-.12);
  };
  engine.onEvolution=()=>{};

  audio.unlock().then(()=>audio.startMusic(config.map.music||'blacksite'));

  session.last=performance.now();
  session.raf=requestAnimationFrame(tick);
}

function tick(now){
  if(!session)return;
  const {engine,renderer,hud,levelUp,pause}=session;
  const dt=Math.min(.1,(now-session.last)/1000);
  session.last=now;

  input.poll();

  if(input.takeAction('pause')&&!engine.ended&&engine.pendingLevelUps===0){
    input.releaseSticks();
    pause.toggle();
  }

  if(!pause.open){
    engine.update(dt,input);
  }

  // Present the adaptation screen whenever the engine queues a level.
  if(engine.pendingLevelUps>0&&!levelUp.element&&!engine.ended&&!pause.open){
    input.releaseSticks();
    levelUp.show(()=>{});
  }

  renderer.render();
  hud.update(dt);

  if(!engine.ended)session.raf=requestAnimationFrame(tick);
}

function finishRun(summary,config){
  if(!session)return;
  const {levelUp,pause}=session;
  levelUp.destroy();
  pause.close();
  cancelAnimationFrame(session.raf);

  summary.operationId=config.operation?.id||null;
  const payout=commitRun(save,summary);
  screens.setSave(save);

  // Surface unlocks and achievements earned by this run.
  for(const award of payout.awards){
    if(award.type==='unlock')audio.play('unlock',{volume:.8});
  }

  teardownSession();
  audio.startMusic('menu');
  // A campaign operation closed for the first time earns its debrief and the
  // document it returned before the ordinary results screen.
  if(payout.operationClosed&&config.operation){
    screens.debrief(config.operation,()=>screens.results(summary,payout,config));
  }else{
    screens.results(summary,payout,config);
  }
}

function teardownSession(){
  if(!session)return;
  cancelAnimationFrame(session.raf);
  window.removeEventListener('resize',session.onResize);
  for(const detach of session.detachSticks)detach?.();
  session.hud?.destroy();
  session.engine?.destroy();
  input.releaseAll();
  session=null;
  window.__pp=null;
}

// Pause automatically when the tab loses focus so runs are not lost.
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&session&&!session.engine.ended&&!session.pause.open){
    session.pause.show();
  }
});

// Surface fatal errors instead of leaving a black screen.
window.addEventListener('error',event=>{
  console.error('[phantom] runtime error',event.error||event.message);
});
