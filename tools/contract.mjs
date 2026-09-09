// Long-contract integrity.
//
// Everything else in this directory tests a nine-hundred-tick slice — fifteen
// seconds of a contract that runs twenty minutes. Two run-breaking bugs in two
// rounds of playtesting lived entirely past that horizon and were invisible to
// every tool here:
//
//   * A signature still standing when the clock ran out meant the heads-up
//     display never said the extraction window had opened, and the window
//     closed on the run.
//   * A scheduled spawn refused because a signature was already in the sector
//     was thrown away rather than held, so a twenty-minute contract silently
//     lost its own final boss, and lost the walker every single time.
//
// Both were found by driving a real timeline and watching, which is what this
// does. It runs whole contracts at full length and asserts the things a
// contract promises:
//
//   1. Every scheduled event either fired or was deliberately dropped. An
//      event that a refusal swallowed is the bug above.
//   2. The extraction window opens when the clock runs out, has somewhere to
//      go, and the phase line says so — including while a signature is alive,
//      which is the case that failed.
//   3. The walker arrives when the operator's record says it is due.
//   4. Nothing is left holding in the director's queue at the end.
//   5. The contract can actually be completed: reach the beacon, hold it, win.
//   6. No uncaught error over the whole run.
//
// A twenty-minute contract is 72,000 fixed steps. That takes minutes, not
// seconds — which is the reason nothing was testing this, and not a reason to
// keep not testing it.
//
//   node tools/contract.mjs                      # blacksite, 20min, all scenarios
//   node tools/contract.mjs foundry 30           # one theatre at thirty minutes
//   node tools/contract.mjs blacksite 20 lethal  # a single scenario
// Storage key: `red-static-save` is the live one. `phantom-protocol-save` is a
// legacy name the game reads as a fallback and never writes — seeding that one
// works exactly once, until the game writes the real key, after which every
// seed is silently ignored and the harness tests a default save without saying
// so.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';

const THEATRES=(process.argv[2]||'blacksite').split(',');
const MINUTES=Number(process.argv[3]||20);
// `passive`  the operative kills nothing, so every signature is still standing
//            when the clock runs out. This is the extraction case.
// `lethal`   signatures die in about twenty seconds, so the schedule gets to
//            run to the end. This is the swallowed-event case.
// `extract`  as lethal, then walks to the beacon and leaves. This is the
//            "can the contract actually be won" case.
const SCENARIOS=(process.argv[4]||'passive,lethal,extract').split(',');

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});

async function run(theatre,scenario){
  const p=await b.newPage({viewport:{width:1280,height:720}});
  const errs=[];
  p.on('pageerror',e=>errs.push(String(e&&e.stack||e).split('\n')[0]));
  await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
  await p.waitForTimeout(400);
  await p.evaluate(()=>{
    const raw=JSON.parse(localStorage.getItem('red-static-save')||'{}');
    raw.version=3;
    // DEPLOY, CONTRACTS and GUNSMITH are gated behind campaign progress now, and
    // every harness here reaches a sector through DEPLOY. Seeded as an operator
    // who has already been through the opening rather than a first run.
    raw.campaign={...(raw.campaign||{}),op1:{completed:true}};
    raw.statistics={...(raw.statistics||{}),missions:Math.max(2,raw.statistics?.missions||0)};raw.maps=raw.maps||{};
    for(const id of ['blacksite','arctic','sunken','foundry','orbital','crossfall','hollow','mire','hangar','proving'])
      raw.maps[id]={...(raw.maps[id]||{}),unlocked:true};
    // Enough contracts closed that the walker's record says it is due, which is
    // the only way the nemesis event is scheduled at all.
    raw.statistics={...(raw.statistics||{}),missions:40};
    raw.settings={...(raw.settings||{}),renderer:'2d',showMinimap:false,showFps:false};
    localStorage.setItem('red-static-save',JSON.stringify(raw));
  });
  await p.reload({waitUntil:'load'});await p.waitForTimeout(700);
  await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
  await p.waitForTimeout(300);
  await p.evaluate(()=>{[...document.querySelectorAll('button,a')].find(e=>/DEPLOY/i.test(e.textContent))?.click()});
  await p.waitForTimeout(250);
  await p.evaluate(t=>document.querySelector(`[data-map="${t}"]`)?.click(),theatre);
  await p.waitForTimeout(250);
  await p.evaluate(m=>{
    const chip=[...document.querySelectorAll('[data-dur]')].find(e=>Number(e.dataset.dur)===m);
    if(!chip)throw new Error('no duration chip for '+m+' minutes');
    chip.click();
  },MINUTES);
  await p.waitForTimeout(200);
  await p.evaluate(()=>{const r=Math.random;Math.random=()=>0.4242;
    try{document.querySelector('#deployBtn')?.click()}finally{Math.random=r}});
  await p.waitForTimeout(1800);

  const result=await p.evaluate(async scenario=>{
    const s=window.__pp,e=s.engine;
    cancelAnimationFrame(s.raf);
    e.restoreInterpolation?.();

    // An operative who cannot be killed. The point is to reach the end of the
    // contract's timeline every time, not to survive it — a run that dies at
    // twelve minutes tests nothing about what happens at twenty.
    e.player.maxHp=1e9;e.player.hp=1e9;

    // Every scheduled event, tracked by identity through however many times a
    // held one is retried.
    //
    // What counts as "fired" is deliberately NOT what `fireEvent` returns. The
    // first version of this file asked the director whether the event had run,
    // and the whole shape of the bug being tested for is a director that
    // reports success while quietly dropping a refused spawn — so it reported
    // three clean contracts over code with the fault reintroduced. Outcome is
    // measured at the spawn instead, where the refusal actually happens.
    const outcomes=new Map();
    for(const event of e.director.scriptedEvents)outcomes.set(event,{fired:false});
    let current=null;
    const realFire=e.director.fireEvent.bind(e.director);
    e.director.fireEvent=event=>{
      current=outcomes.get(event)||null;
      try{return realFire(event)}finally{current=null}
    };
    // A spawn that succeeds marks whichever event was being fired at the time.
    // Everything with no spawn of its own — gunships, carriers, surges — is
    // marked on the way through, since nothing refuses those.
    const succeeded=()=>{if(current)current.fired=true};
    const wrap=(name,onSuccess)=>{
      const real=e[name].bind(e);
      e[name]=(...args)=>{const r=real(...args);if(r){succeeded();onSuccess?.()}return r};
    };
    let nemesisSeen=false,signatures=0;
    wrap('spawnBoss',()=>{signatures++});
    wrap('spawnNemesis',()=>{nemesisSeen=true});
    const unrefusable=new Set(['gunship','carrier','eliteSquad','swarmEvent','miniboss']);
    for(const [event,record] of outcomes)if(unrefusable.has(event.type))record.fired=true;

    // Which events were ever held, sampled rather than read at one moment. The
    // director empties its queue the instant the extraction window opens, and
    // that happens inside the same step that opens it — so by the time the run
    // loop can look, the evidence is already gone. The queue is tiny and the
    // scan is nothing next to the step it rides along with.
    const heldEver=new Set();

    const script={moveX:0,moveY:0,ax:1,ay:0,
      aimVector(){return{x:this.ax,y:this.ay,manual:true}},
      takeAction(){return false},poll(){}};

    // What the contract looked like the moment the clock ran out. Captured
    // then rather than at the end, because that is the moment under test.
    let atExpiry=null;
    const total=e.durationMinutes*60;
    // The timeline, plus the whole extraction window, plus a little slack.
    const steps=Math.ceil((total+90)*60);
    for(let i=0;i<steps&&!e.ended;i++){
      if(scenario!=='passive'&&e.boss&&e.boss.introTimer<=0){
        e.damageEnemy(e.boss,e.boss.maxHp/1200,{source:'projectile'});
      }
      if(scenario==='extract'&&e.extraction&&e.extractionPoint){
        // Walk out. Placed rather than steered: pathfinding to the beacon is
        // not what this is testing, and a run that fails to arrive would fail
        // the assertion for the wrong reason.
        e.player.x=e.extractionPoint.x;
        e.player.y=e.extractionPoint.y;
      }
      for(const held of e.director.pendingEvents)heldEver.add(held);
      e.step(1/60,script);
      for(const held of e.director.pendingEvents)heldEver.add(held);
      if(e.extraction&&!atExpiry){
        atExpiry={
          point:!!e.extractionPoint,
          bossAlive:!!e.boss,
          phase:e.director.phaseLabel(),
          window:+e.extractionTimer.toFixed(1),
          // Read here and not at the end: the director clears what it is
          // holding the moment the window opens, so this is the last instant
          // at which a held event is still evidence that it was held.
          held:e.director.pendingEvents.length
        };
      }
    }

    // Everything the contract scheduled and did not deliver. An event that came
    // due inside the extraction window was never going to run.
    const unfired=[],unaccounted=[];
    for(const [event,record] of outcomes){
      if(record.fired||event.at>=total)continue;
      const label=event.type+'@'+Math.round(event.at/total*100)+'%';
      unfired.push(label);
      // Undelivered is not automatically wrong. Undelivered with no sign the
      // director ever knew it could not run is the bug.
      if(!heldEver.has(event))unaccounted.push(label);
    }

    return{
      duration:e.durationMinutes,
      scheduled:e.director.scriptedEvents.map(x=>x.type).join(','),
      unfired,unaccounted,signatures,
      signaturesScheduled:e.director.scriptedEvents
        .filter(x=>x.type==='boss'||x.type==='finalBoss').length,
      reachedExpiry:!!atExpiry,
      atExpiry,
      nemesisDue:!!e.config.nemesis,
      nemesisSeen,
      queueLeft:e.director.pendingEvents.length,
      ended:e.ended,victory:e.victory,reason:e.endReason
    };
  },scenario);

  await p.close();
  return{...result,errors:errs};
}

const fails=[];
const note=(theatre,scenario,message)=>{
  fails.push(`${theatre}/${scenario}: ${message}`);
};

console.log(`long-contract integrity · ${MINUTES} minute contracts\n`);

for(const theatre of THEATRES){
  for(const scenario of SCENARIOS){
    const started=Date.now();
    const r=await run(theatre,scenario);
    const secs=((Date.now()-started)/1000).toFixed(0);

    // 1. Nothing the contract scheduled may go missing.
    //
    // In `passive` the operative kills nothing, so the sector is never clear
    // and a second signature genuinely cannot arrive — there, an undelivered
    // event is correct *provided the director is still holding it*. That is
    // the distinction the whole bug turned on, so it is asserted rather than
    // assumed: everything undelivered has to be accounted for in the queue at
    // the moment the window opened.
    if(scenario==='passive'){
      if(r.unaccounted.length){
        note(theatre,scenario,
          `dropped without trace: ${r.unaccounted.join(', ')} — refused and never held`);
      }
    }else{
      for(const item of r.unfired)note(theatre,scenario,`scheduled event never fired: ${item}`);
      if(r.signatures!==r.signaturesScheduled){
        note(theatre,scenario,
          `${r.signaturesScheduled} signature(s) scheduled, ${r.signatures} arrived`);
      }
    }

    // 2. The clock running out has to open a window that can be reached, and
    //    the phase line has to say so even with a signature still up.
    if(!r.reachedExpiry){
      note(theatre,scenario,'the contract never reached its own expiry');
    }else{
      if(!r.atExpiry.point)note(theatre,scenario,'extraction opened with no beacon to reach');
      if(!/EXTRACT/i.test(r.atExpiry.phase)){
        note(theatre,scenario,
          `phase line did not announce extraction (read "${r.atExpiry.phase}"`+
          `${r.atExpiry.bossAlive?', signature alive':''})`);
      }
    }

    // 3. The walker, when the record says it is due.
    if(r.nemesisDue&&scenario!=='passive'&&!r.nemesisSeen){
      note(theatre,scenario,'walker was due and never arrived');
    }

    // 4. Nothing left holding.
    if(r.queueLeft)note(theatre,scenario,`${r.queueLeft} event(s) still held at the end`);

    // 5. The contract has to be winnable.
    if(scenario==='extract'&&!(r.ended&&r.victory)){
      note(theatre,scenario,`reached the beacon and did not extract (ended=${r.ended} reason=${r.reason})`);
    }

    // 6. No uncaught error.
    for(const err of r.errors.slice(0,3))note(theatre,scenario,`page error: ${err}`);

    const state=r.ended?`${r.victory?'WON':'LOST'} · ${r.reason}`:'still running';
    console.log(
      `${theatre.padEnd(10)} ${scenario.padEnd(8)} ${String(secs+'s').padStart(5)}  `+
      `expiry ${r.reachedExpiry?'reached':'MISSED'}  `+
      `phase "${r.atExpiry?.phase||'--'}"  `+
      `walker ${r.nemesisDue?(r.nemesisSeen?'arrived':'DUE, ABSENT'):'not due'}  `+
      `signatures ${r.signatures}/${r.signaturesScheduled}  `+
      `undelivered ${r.unfired.length} (${r.unaccounted.length} untraced)  ${state}`
    );
  }
}

console.log('');
if(fails.length){
  console.log(`${fails.length} FAILURE(S)`);
  for(const f of fails)console.log('  '+f);
  process.exitCode=1;
}else{
  console.log('all contracts intact');
}
await b.close();
