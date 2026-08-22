import {loadSave,saveGame} from './save/storage.js';
import {commitRun,completeRecruitments,undiscoveredOperatives,
  clearHealed,sendToMedical} from './save/progression.js';
import {nemesisRecord,commitNemesis} from './game/nemesis.js';
import {recordContract} from './save/contracts.js';
import {nemesisDue} from '../data/nemesis.js';
import {Screens} from './ui/screens.js';
import {Splash} from './ui/splash.js';
import {Hud} from './ui/hud.js';
import {LevelUpScreen} from './ui/levelup.js';
import {PauseMenu} from './ui/pause.js';
import {Engine} from './game/engine.js';
import {Renderer} from './render/renderer.js';
import {DeferredRenderer} from './render/gl/deferred.js';
import {shouldUseGL,probeWebGL2} from './render/gl/support.js';
import {Input,isTouchDevice} from './core/input.js';
import {BUTTON} from './core/gamepad.js';
import {FocusNav} from './ui/focusnav.js';
import {audio} from './core/audio.js';
import {profiler} from './core/profiler.js';
import {resolveBuild} from './game/gunsmith.js';

// Application entry point. Owns the top-level state machine (menu ⇄ run),
// the render loop and the wiring between the simulation, the renderer and
// the DOM UI.

// Elements that must receive their own touches rather than driving the
// movement stick. Anything matching this keeps its synthesized click.
const UI_TOUCH_TARGETS='.overlay,.hud-actions,.stick-aim,button,a,input,select,textarea,[role="button"]';

let save=loadSave();
const completed=completeRecruitments(save);
const healed=clearHealed(save);
if(completed.length>0||healed.length>0)saveGame(save);
let session=null;
const input=new Input();
const screens=new Screens(save,startRun,audio);
// Exposed for the same reason window.__pp is: a menu screen can only be
// checked by rendering it, and three of this project's worst bugs were
// invisible to anything that did not go through the real UI.
window.__screens=screens;

// ---------------------------------------------------------------------------
// Experimental visual test
// ---------------------------------------------------------------------------
//
// ?visualtest=1 boots src/experiments/visual-test instead of the game. The
// import is dynamic, so with the flag absent none of the experiment is even
// fetched, and this is the only line of production code that knows it exists.
// It runs before any menu is rendered and returns, so nothing below sets up.
const VT_PARAM=new URLSearchParams(location.search).get('visualtest');
const VISUAL_TEST=VT_PARAM!==null&&VT_PARAM!=='0'&&VT_PARAM.toLowerCase()!=='false';

// Announces which build is actually executing. index.html watches for this: a
// cached module from before a feature existed ignores that feature's URL flag
// in silence, and the resulting "it just runs the normal game" is impossible
// to tell from a bug without something to check against.
window.__redstatic={
  visualTest:VISUAL_TEST,
  features:['fieldkits','vaultlocks','replay','gunsmithpresets','gamepad','visualtest']
};
console.info('[red-static] boot · visualtest=%s · %s',
  VISUAL_TEST,window.__redstatic.features.join(','));

if(VISUAL_TEST){
  import('./experiments/visual-test/boot.js')
    .then(m=>m.bootVisualTest({audio,input,save}))
    .catch(err=>{
      console.error('[red-static] visual test failed to boot',err);
      document.querySelector('#app').innerHTML=
        `<div style="padding:40px;font:13px ui-monospace,monospace;color:#dceceb">
           <h1>Visual test failed to boot</h1><pre>${String(err&&err.stack||err)}</pre>
           <p><a style="color:#76e7d4" href="?">Back to RED STATIC</a></p></div>`;
    });
}

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

// The command menu is built immediately and the boot title screen is laid
// over it, so dismissing the title fades straight through to a menu that is
// already there. START is also the gesture that unlocks audio, which is why
// the title track opens under the artwork rather than after it.
// Skipped under ?visualtest=1: the experiment owns the whole page, and a menu
// and a title screen built underneath it would both fight it for the canvas
// and quietly distort every number it reports.
if(!VISUAL_TEST){
  screens.menu();
  new Splash({
    audio,
    onStart:()=>{},
    onSettings:()=>screens.settings()
  }).mount(document.body);
}

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
    // The second operative on the ground, when one was selected.
    squadmate:config.squadmate||null,
    // The walker's record, passed in only on contracts where it is due — the
    // director tests for its presence to decide whether to schedule it.
    nemesis:nemesisDue(nemesisRecord(save),save.statistics.missions||0)
      ?nemesisRecord(save):null,
    // Primary weapon and its bench build, resolved into combat modifiers.
    primary:config.primary?{
      weaponId:config.primary.weapon.id,
      mods:resolveBuild(config.primary.weapon,config.primary.build,config.primary.rank),
      // Secondary fire rides alongside the attachment build rather than inside
      // it: sanitizeBuild rebuilds from the known slot list and would drop it.
      ordnance:config.primary.ordnance||null,
      livery:config.primary.livery||null
    }:null,
    // Files a personnel cache can turn up in this run.
    discoverable:undiscoveredOperatives(save).map(op=>({id:op.id,codename:op.codename})),
    // Free deployment rolls a fresh seed; a rotating contract supplies its own,
    // derived from the calendar, so every operator faces the same sector.
    seed:config.seed??Math.floor(Math.random()*1e9),
    // Watching rather than playing. The engine reads its input from the log
    // instead of the device, and nothing downstream of `step` can tell.
    replay:config.replay||null
  };

  // The HUD owns the canvas element, so create the DOM before the engine.
  const placeholder=document.createElement('canvas');
  placeholder.width=window.innerWidth;
  placeholder.height=window.innerHeight;
  const engine=new Engine(placeholder,engineConfig);

  const hud=new Hud(app,engine);
  // The renderer may have to replace the canvas element to recover from a
  // failed GL initialisation, so it hands back the one actually in the page.
  const {renderer,canvas}=createRenderer(hud,engine,save.settings);
  engine.canvas=canvas;
  const levelUp=new LevelUpScreen(engine,save);
  const pause=new PauseMenu(engine,save,{
    onSettingsChange:()=>{
      audio.applySettings(save.settings);
      renderer.quality=save.settings.particles;
      engine.fx.setQuality(save.settings.particles);
      saveGame(save);
    }
  });

  session={engine,renderer,hud,levelUp,pause,config,raf:0,last:performance.now(),
    detachSticks:[],replaying:!!config.replay};
  // Exposed for debugging and automated smoke tests.
  window.__pp=session;
  // Readable from a remote-debugged phone, or from a test, without going
  // through the on-screen overlay.
  window.__profile=()=>profiler.snapshot();

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
  hud.el.kitBtn?.addEventListener('click',()=>input.setAction('kit'));
  hud.el.ordnanceBtn?.addEventListener('click',()=>input.setAction('secondary'));

  engine.onEnd=summary=>finishRun(summary,config);
  engine.onBossSpawn=boss=>{
    // Brief cinematic hold on the boss reveal.
    engine.camera.punchZoom(-.12);
  };
  engine.onEvolution=()=>{};

  // Music is chosen by operation first so a campaign track plays on its own
  // operation, then by theatre so the same piece covers free deployment there.
  // `fallback` names the synthesized bed for everything without a track.
  audio.unlock().then(()=>audio.startMusic(
    config.operation?.id||config.map.id,
    {fallback:config.map.music||'blacksite'}
  ));

  session.last=performance.now();
  session.raf=requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Renderer selection
// ---------------------------------------------------------------------------
//
// Two renderers ship: the Canvas 2D one that has always run the game, and the
// deferred WebGL2 one. They present the same surface, so this is the only
// place that knows there is a choice.
//
// A canvas gets exactly one context for its lifetime, so the decision has to
// be made before anything touches it — taking a 2D context to "check
// something first" permanently forecloses WebGL2 on that canvas. The
// capability probe therefore runs on a throwaway 1x1 canvas.
//
// Anything that goes wrong falls back rather than failing: a browser without
// WebGL2, a driver that refuses to link a shader, a machine where the only
// implementation is a software rasteriser. The 2D renderer is not a
// degraded mode, it is the shipping renderer, and every theatre still looks
// right under it.
function createRenderer(hud,engine,settings){
  let canvas=hud.el.canvas;
  if(shouldUseGL(settings)){
    try{
      const gl=new DeferredRenderer(canvas,engine);
      if(!gl.failed){
        console.info('[red-static] renderer: deferred WebGL2 · %s',probeWebGL2().renderer);
        return{renderer:gl,canvas};
      }
      gl.destroy?.();
    }catch(err){
      console.warn('[red-static] deferred renderer failed, falling back to Canvas 2D',err);
    }
    // The canvas may now hold a dead or half-built GL context, and a canvas
    // cannot trade one context for another. Replacing the element is the only
    // way back to Canvas 2D.
    const fresh=canvas.cloneNode(false);
    fresh.width=canvas.width;
    fresh.height=canvas.height;
    canvas.replaceWith(fresh);
    hud.el.canvas=fresh;
    canvas=fresh;
  }
  const ctx=canvas.getContext('2d',{alpha:false});
  // Nothing left to draw with. Better to say so than to run a blank frame loop.
  if(!ctx)throw new Error('No 2D canvas context available');
  return{renderer:new Renderer(canvas,ctx,engine),canvas};
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

  if(engine.replaying){
    // Nobody is here to pick a card, so the logged choices are replayed into
    // the same code the screen would have called. Looped because a reroll or a
    // banish does not settle the level — the next decision does.
    let guard=0;
    while(engine.pendingLevelUps>0&&!engine.ended&&guard++<64){
      const decision=engine.takeDecision();
      if(!decision)break;
      levelUp.applyDecision(decision);
    }
    // Out of log, or stalled on a level nothing left in the log can settle.
    // Either way there is nothing more to watch.
    const stalled=engine.pendingLevelUps>0&&engine.decisionIndex>=engine.decisions.length;
    if(!engine.ended&&(engine.replayPlayer.done||stalled))engine.finish(false,'REPLAY ENDED');
  }else if(engine.pendingLevelUps>0&&!levelUp.element&&!engine.ended&&!pause.open){
    // Present the adaptation screen whenever the engine queues a level.
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

  // A replay is a recording being watched, not a contract being run. Nothing
  // it does is earned: no payout, no unlocks, no medical, no walker record,
  // and above all no write to the save.
  if(session.replaying){
    teardownSession();
    audio.startMusic('menu');
    screens.replayFinished(summary,config.replay);
    return;
  }

  summary.operationId=config.operation?.id||null;
  // A rotating contract keeps only the operator's best attempt at it.
  if(config.contract)recordContract(save,config.contract,summary);
  // A squadmate carried out on their back spends real time in medical. Being
  // downed is not a death, but walking to the beacon without them is a choice
  // the next contract remembers.
  for(const left of summary.squadLeftBehind||[])sendToMedical(save,left);
  // The walker's record is written before the run is committed, so its
  // `lastContract` marker is measured against the contract count it fought in
  // rather than the one after it.
  if(summary.nemesis)commitNemesis(save,summary.nemesis);
  const payout=commitRun(save,summary);
  screens.setSave(save);

  // The results screen offers to keep it. Captured here rather than stored
  // automatically: most runs are not worth a shelf slot, and the player is the
  // only one who knows which was.
  config.replayCapture=session.engine.replaySnapshot(save);

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
  session.renderer?.destroy();
  session.engine?.destroy();
  input.releaseAll();
  session=null;
  window.__pp=null;
}

// ---------------------------------------------------------------------------
// Menu navigation from a controller or a remote
// ---------------------------------------------------------------------------
//
// The simulation reads the pad through `input.poll()`, which only runs inside a
// run. Everything else — the title screen, every menu, the adaptation cards,
// the pause menu — was mouse and keyboard only, which on a console or a
// television box meant the game could not be started at all.
//
// This loop runs for the life of the page and drives DOM focus whenever the
// player is not actually driving an operative. Because it moves real focus and
// activates with `.click()`, it works on every screen without any of them
// knowing it exists.

const focusNav=new FocusNav();

// Held directions repeat, or a long rack is a lot of separate presses. Slow
// enough on the first repeat to not overshoot a short list.
const NAV_FIRST_REPEAT=420;
const NAV_REPEAT=120;
let navRepeatAt=0;
let navDirection=null;
// Whether a controller is currently the thing being used. Drives the focus
// ring: a mouse player should never see one, and a player across the room
// needs it to be unmissable.
let padActive=false;

function setPadActive(active){
  if(padActive===active)return;
  padActive=active;
  document.documentElement.classList.toggle('pad-nav',active);
}
window.addEventListener('mousemove',()=>setPadActive(false),{passive:true});
window.addEventListener('touchstart',()=>setPadActive(false),{passive:true});

// True when the pad should be working menus rather than the operative: no run
// at all, or a run with something on top of it.
function uiHasFocus(){
  if(!session)return true;
  return !!(session.levelUp?.element||session.pause?.open||session.engine?.ended);
}

function navigate(direction,now){
  if(direction!==navDirection){
    navDirection=direction;
    navRepeatAt=now+NAV_FIRST_REPEAT;
    return true;
  }
  if(now<navRepeatAt)return false;
  navRepeatAt=now+NAV_REPEAT;
  return true;
}

function pollMenuGamepad(now){
  const pad=input.pad.read();
  if(!pad){navDirection=null;return}
  if(!uiHasFocus()){
    // The simulation owns the pad. Keep the edge history warm so a button
    // still held when a menu opens does not immediately fire in it.
    navDirection=null;
    return;
  }

  if(pad.moveM>0||pad.aimM>0||pad.dpad.up||pad.dpad.down||pad.dpad.left||pad.dpad.right||
     pad.button(BUTTON.a)||pad.button(BUTTON.b)||pad.button(BUTTON.start)||pad.button(BUTTON.back)){
    setPadActive(true);
  }
  // A freshly rendered screen has focus on nothing. Anchoring it here rather
  // than in the screens means every screen gets it, including ones written
  // later that never heard of any of this.
  if(padActive&&!focusNav.focused())focusNav.focusFirst();

  const up=pad.dpad.up||pad.moveY<-.5||pad.aimY<-.5;
  const down=pad.dpad.down||pad.moveY>.5||pad.aimY>.5;
  const left=pad.dpad.left||pad.moveX<-.5||pad.aimX<-.5;
  const right=pad.dpad.right||pad.moveX>.5||pad.aimX>.5;
  const direction=up?'up':down?'down':left?'left':right?'right':null;

  if(direction){
    if(navigate(direction,now)){
      if(focusNav.move(direction))audio.play('select',{volume:.3});
    }
  }else{
    navDirection=null;
  }

  // A confirms, B goes back. Start also confirms, because a remote's only
  // other button tends to be its menu key.
  if(input.pad.edge('uiConfirm',pad.button(BUTTON.a)||pad.button(BUTTON.start))){
    if(!focusNav.focused())focusNav.focusFirst();
    else{audio.play('confirm',{volume:.5});focusNav.activate()}
  }
  if(input.pad.edge('uiBack',pad.button(BUTTON.b)||pad.button(BUTTON.back))){
    if(focusNav.back())audio.play('deny',{volume:.4});
  }
}

function menuLoop(now){
  pollMenuGamepad(now);
  requestAnimationFrame(menuLoop);
}
requestAnimationFrame(menuLoop);

// Arrow keys and Enter drive the same focus model, so a television remote that
// reports as a keyboard lands in exactly the same place as one that reports as
// a pad. Only outside a run: in one, the arrows are the operative's legs.
window.addEventListener('keydown',event=>{
  if(!uiHasFocus())return;
  const map={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
  const direction=map[event.key];
  if(direction){
    // Let a real text field have its own arrows.
    if(document.activeElement?.matches?.('input,textarea,select'))return;
    if(focusNav.move(direction))event.preventDefault();
    return;
  }
  if(event.key==='Enter'&&!focusNav.focused()){
    if(focusNav.focusFirst())event.preventDefault();
  }
});

// Pause automatically when the tab loses focus so runs are not lost.
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&session&&!session.engine.ended&&!session.pause.open){
    session.pause.show();
  }
});

// Surface fatal errors instead of leaving a black screen.
window.addEventListener('error',event=>{
  console.error('[red-static] runtime error',event.error||event.message);
});
