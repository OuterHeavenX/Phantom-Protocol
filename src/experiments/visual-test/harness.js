// BLACKSITE VISUAL TEST — the test controller.
//
// Owns the overlay, the graphics presets, the individual feature switches, the
// enemy-count scenarios and the automated sweep. Everything a person needs to
// find the ceiling on their own hardware, without a build step or a profiler.

import {PRESET_NAMES,TOGGLES,preset} from './presets.js';

export const ENEMY_STEPS=[25,50,100,150,200];

// A rolling window of real frame intervals. Percentiles rather than an average
// because an average of 60 hides the four frames that took 90ms, and those are
// the ones that are felt.
class FrameLog{
  constructor(size=240){
    this.size=size;
    this.times=new Float64Array(size);
    this.n=0;this.i=0;
  }
  push(ms){
    this.times[this.i]=ms;
    this.i=(this.i+1)%this.size;
    if(this.n<this.size)this.n++;
  }
  reset(){this.n=0;this.i=0}
  stats(){
    if(!this.n)return{fps:0,avg:0,p50:0,p95:0,p99:0,worst:0};
    const slice=Array.from(this.times.subarray(0,this.n)).sort((a,b)=>a-b);
    const at=q=>slice[Math.min(slice.length-1,Math.floor(slice.length*q))];
    let sum=0;for(const v of slice)sum+=v;
    const avg=sum/slice.length;
    return{
      fps:Math.round(1000/Math.max(.01,avg)),
      avg:+avg.toFixed(2),
      p50:+at(.5).toFixed(2),
      p95:+at(.95).toFixed(2),
      p99:+at(.99).toFixed(2),
      worst:+slice[slice.length-1].toFixed(2)
    };
  }
}

export class Harness{
  constructor({engine,renderer,quality,onPresetChange,onEnemyCount}){
    this.engine=engine;
    this.renderer=renderer;
    this.quality=quality;
    this.onPresetChange=onPresetChange;
    this.onEnemyCount=onEnemyCount;
    this.frames=new FrameLog();
    this.presetName='HIGH';
    this.targetEnemies=25;
    this.sweep=null;
    this.results=[];
    this.visible=true;
    this.buildOverlay();
  }

  // ---- overlay ------------------------------------------------------------

  buildOverlay(){
    const el=document.createElement('div');
    // Published before anything is wired: the handlers below call back into
    // methods that read it, and one of them runs during construction.
    this.el=el;
    el.className='vt-overlay';
    el.innerHTML=`
      <div class="vt-panel vt-stats">
        <div class="vt-title">BLACKSITE VISUAL TEST<span id="vtHide">×</span></div>
        <div class="vt-grid" id="vtStats"></div>
        <div class="vt-title">RENDERER</div>
        <div class="vt-note" id="vtRenderer"></div>
      </div>
      <div class="vt-panel vt-controls">
        <div class="vt-title">PRESET</div>
        <div class="vt-row" id="vtPresets"></div>
        <div class="vt-title">HOSTILES</div>
        <div class="vt-row" id="vtCounts"></div>
        <div class="vt-title">EFFECTS</div>
        <div class="vt-toggles" id="vtToggles"></div>
        <div class="vt-title">BENCHMARK</div>
        <div class="vt-row">
          <button class="vt-btn vt-wide" id="vtSweep">RUN 25→200 SWEEP</button>
        </div>
        <div class="vt-note" id="vtSweepNote">
          Each step settles for 3s then samples for 6s. Takes about 45s.
        </div>
        <pre class="vt-results" id="vtResults" hidden></pre>
        <div class="vt-row">
          <button class="vt-btn" id="vtCopy" hidden>COPY RESULTS</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.statsEl=el.querySelector('#vtStats');
    this.resultsEl=el.querySelector('#vtResults');
    this.copyBtn=el.querySelector('#vtCopy');

    const presets=el.querySelector('#vtPresets');
    for(const name of PRESET_NAMES){
      const b=document.createElement('button');
      b.className='vt-btn';
      b.textContent=name;
      b.dataset.preset=name;
      b.addEventListener('click',()=>this.applyPreset(name));
      presets.appendChild(b);
    }
    const counts=el.querySelector('#vtCounts');
    for(const n of ENEMY_STEPS){
      const b=document.createElement('button');
      b.className='vt-btn';
      b.textContent=n;
      b.dataset.count=n;
      b.addEventListener('click',()=>this.setEnemies(n));
      counts.appendChild(b);
    }
    const toggles=el.querySelector('#vtToggles');
    for(const [key,label,hint] of TOGGLES){
      const row=document.createElement('button');
      row.className='vt-toggle';
      row.dataset.key=key;
      row.title=hint;
      row.innerHTML=`<i></i><span>${label}</span>`;
      row.addEventListener('click',()=>{
        this.quality[key]=this.quality[key]===false;
        // The three screen-space dials are amounts, not switches.
        if(key==='grain')this.quality.grain=this.quality.grain?0:.04;
        if(key==='scanline')this.quality.scanline=this.quality.scanline?0:.35;
        if(key==='vignette')this.quality.vignette=this.quality.vignette?0:.85;
        this.syncToggles();
      });
      toggles.appendChild(row);
    }
    el.querySelector('#vtHide').addEventListener('click',()=>this.toggleVisible());
    el.querySelector('#vtSweep').addEventListener('click',()=>this.startSweep());
    this.copyBtn.addEventListener('click',()=>this.copyResults());

    window.addEventListener('keydown',e=>{
      if(e.key==='F2'){e.preventDefault();this.toggleVisible()}
    });
    this.syncButtons();
    this.syncToggles();
  }

  // navigator.clipboard exists only in a secure context, so on a phone reading
  // this over plain http from a laptop on the same network — which is the
  // whole point of the exercise — it is undefined and the optional call this
  // used to make silently did nothing while the button claimed COPIED.
  // Selecting the text is the fallback: long-press, copy.
  copyResults(){
    const text=this.resultsEl.textContent;
    if(navigator.clipboard?.writeText){
      navigator.clipboard.writeText(text).then(
        ()=>this.flashCopy('COPIED'),
        ()=>this.selectResults()
      );
      return;
    }
    this.selectResults();
  }

  selectResults(){
    const range=document.createRange();
    range.selectNodeContents(this.resultsEl);
    const selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    // execCommand is deprecated and still the only thing that works here.
    let done=false;
    try{done=document.execCommand('copy')}catch{/* selection stands regardless */}
    this.flashCopy(done?'COPIED':'SELECTED — LONG-PRESS TO COPY');
  }

  flashCopy(label){
    this.copyBtn.textContent=label;
    setTimeout(()=>{this.copyBtn.textContent='COPY RESULTS'},2200);
  }

  toggleVisible(){
    this.visible=!this.visible;
    this.el.classList.toggle('vt-hidden',!this.visible);
  }

  syncButtons(){
    for(const b of this.el.querySelectorAll('[data-preset]')){
      b.classList.toggle('on',b.dataset.preset===this.presetName);
    }
    for(const b of this.el.querySelectorAll('[data-count]')){
      b.classList.toggle('on',Number(b.dataset.count)===this.targetEnemies);
    }
  }

  syncToggles(){
    for(const b of this.el.querySelectorAll('[data-key]')){
      const key=b.dataset.key;
      const value=this.quality[key];
      const on=key==='grain'||key==='scanline'||key==='vignette'?value>0:value!==false;
      b.classList.toggle('on',on);
    }
  }

  applyPreset(name){
    this.presetName=name;
    Object.assign(this.quality,preset(name));
    this.onPresetChange?.(name,this.quality);
    this.frames.reset();
    this.syncButtons();
    this.syncToggles();
  }

  setEnemies(n){
    this.targetEnemies=n;
    this.onEnemyCount?.(n);
    this.frames.reset();
    this.syncButtons();
  }

  // ---- the sweep ----------------------------------------------------------

  // Walks the enemy counts, letting each settle before sampling, and produces
  // a table meant to be copied straight out of the browser. The numbers come
  // from whatever device is running it, which is the only way any of this is
  // worth anything on a phone.
  startSweep(){
    if(this.sweep)return;
    this.results=[];
    this.resultsEl.hidden=false;
    this.copyBtn.hidden=true;
    this.resultsEl.textContent='Running…';
    this.sweep={index:0,phase:'settle',until:performance.now()+3000};
    this.setEnemies(ENEMY_STEPS[0]);
  }

  updateSweep(now){
    const s=this.sweep;
    if(!s)return;
    if(now<s.until)return;
    if(s.phase==='settle'){
      this.frames.reset();
      s.phase='sample';
      s.until=now+6000;
      return;
    }
    const stats=this.frames.stats();
    this.results.push({enemies:ENEMY_STEPS[s.index],...stats,
      lights:this.renderer.lightCount||0,
      particles:this.renderer.particleCount||0,
      projectiles:this.engine.projectiles.length});
    this.renderResults();
    s.index++;
    if(s.index>=ENEMY_STEPS.length){
      this.sweep=null;
      this.copyBtn.hidden=false;
      return;
    }
    this.setEnemies(ENEMY_STEPS[s.index]);
    s.phase='settle';
    s.until=now+3000;
  }

  renderResults(){
    const info=this.renderer.info||{};
    const head=[
      `BLACKSITE VISUAL TEST — ${this.presetName}`,
      `renderer : ${info.renderer||'unknown'}`,
      `software : ${info.software?'YES — CPU rasterised, not representative':'no'}`,
      `canvas   : ${this.renderer.width}x${this.renderer.height} @ dpr ${window.devicePixelRatio||1}`,
      `internal : ${this.renderer.internalWidth}x${this.renderer.internalHeight}`,
      `ua       : ${navigator.userAgent}`,
      '',
      'enemies   fps   avg    p50    p95    p99   worst  lights  parts'
    ].join('\n');
    const rows=this.results.map(r=>
      `${String(r.enemies).padStart(7)}${String(r.fps).padStart(6)}`+
      `${r.avg.toFixed(1).padStart(7)}${r.p50.toFixed(1).padStart(7)}`+
      `${r.p95.toFixed(1).padStart(7)}${r.p99.toFixed(1).padStart(7)}`+
      `${r.worst.toFixed(1).padStart(8)}${String(r.lights).padStart(8)}${String(r.particles).padStart(7)}`
    ).join('\n');
    this.resultsEl.textContent=`${head}\n${rows}`;
  }

  // ---- per frame ----------------------------------------------------------

  update(frameMs,now){
    this.frames.push(frameMs);
    this.updateSweep(now);
    if(!this.visible)return;
    if(now-(this.lastPaint||0)<220)return;
    this.lastPaint=now;
    this.paintStats();
  }

  paintStats(){
    const engine=this.engine;
    const renderer=this.renderer;
    const s=this.frames.stats();
    const t=renderer.timings||{};
    const mem=performance.memory
      ?`${(performance.memory.usedJSHeapSize/1048576).toFixed(0)} MB`
      :'n/a';
    const alive=engine.enemies.filter(e=>!e.dead).length;
    const rows=[
      ['FPS',s.fps],
      ['frame avg',`${s.avg.toFixed(2)} ms`],
      ['p95 / p99',`${s.p95.toFixed(1)} / ${s.p99.toFixed(1)} ms`],
      ['worst',`${s.worst.toFixed(1)} ms`],
      ['hostiles',`${alive} / ${this.targetEnemies}`],
      ['projectiles',engine.projectiles.length+engine.enemyProjectiles.length],
      ['fx particles',engine.fx.particles.count],
      ['gpu particles',renderer.particleCount||0],
      ['lights',renderer.lightCount||0],
      ['props',renderer.propCount||0],
      ['heap',mem],
      ['— pass —',''],
      ['g-buffer',`${(t.gbuffer||0).toFixed(2)} ms`],
      ['lights',`${(t.lights||0).toFixed(2)} ms`],
      ['particles',`${(t.particles||0).toFixed(2)} ms`],
      ['bloom',`${(t.bloom||0).toFixed(2)} ms`],
      ['2D entities',`${(t.entities||0).toFixed(2)} ms`],
      ['tex upload',`${(t.upload||0).toFixed(2)} ms`],
      ['composite',`${(t.composite||0).toFixed(2)} ms`]
    ];
    this.statsEl.innerHTML=rows.map(([k,v])=>
      `<span>${k}</span><b>${v}</b>`).join('');
    if(!this.rendererPainted){
      const info=renderer.info||{};
      this.el.querySelector('#vtRenderer').innerHTML=
        `${info.renderer||'unknown'}<br>`+
        `${renderer.width}×${renderer.height} · dpr ${window.devicePixelRatio||1} · `+
        `internal ${renderer.internalWidth}×${renderer.internalHeight}`+
        (info.software?'<br><b class="vt-warn">SOFTWARE RASTERISER — timings are not representative of GPU hardware</b>':'');
      this.rendererPainted=true;
    }
  }

  dispose(){this.el?.remove()}
}
