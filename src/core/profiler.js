// Frame profiler.
//
// Built for a question this project could not answer: does the game hold up on
// a real phone? Every "iPhone" measurement taken during development was
// headless Chromium with a viewport override — that changes the canvas size and
// nothing else. It shares no CPU, no GPU, no thermal budget and no browser with
// the device it was named after, so it says how the game scales in pixels and
// nothing about how it runs in a hand.
//
// This puts the numbers on screen instead, so they can be read off the hardware
// that actually matters.
//
// Three rules:
//
//   1. Free when off. A profiler that costs frame time on the device it is
//      meant to measure is worse than no profiler. Every method checks one
//      boolean first and returns.
//   2. Percentiles, not averages. A mean of sixty frames hides the one that
//      took 400ms, and that frame is the whole complaint.
//   3. Count the clamps. The simulation runs a fixed step with a cap on how
//      many it will take per frame; past that cap it discards time and the
//      contract quietly runs slow. On a desktop that never fires. On a
//      throttled phone it is the difference between "slow" and "wrong", and
//      nothing else in the game reports it.

const CAPACITY=240;               // four seconds at 60fps

export class Profiler{
  constructor(){
    this.enabled=false;
    this.frames=new Float32Array(CAPACITY);
    this.count=0;
    this.head=0;
    this.phases={};               // name -> Float32Array ring
    this.counters={};             // name -> integer
    this.t0=0;
    this.lastMark=0;
    // The interval between presented frames, on its own ring. This is not a
    // sub-section of the CPU frame and must not share its clock: under a GPU
    // renderer the CPU frame can finish in a millisecond while the display
    // still only manages thirty a second, because GL commands are queued and
    // return immediately. What the player feels is this number.
    this.presents=new Float32Array(CAPACITY);
    this.presentCount=0;
    this.presentHead=0;
    this.skipPresent=true;      // the first tick has no interval to report
    this.peakParticles=0;
    this.peakEnemies=0;
  }

  setEnabled(on){
    if(on===this.enabled)return;
    this.enabled=!!on;
    if(!on)this.reset();
  }

  reset(){
    this.open=false;
    this.count=0;this.head=0;
    this.presentCount=0;this.presentHead=0;this.skipPresent=true;
    this.phases={};this.counters={};
    this.peakParticles=0;this.peakEnemies=0;
  }

  // One presented frame, measured from the frame loop rather than from inside
  // it.
  //
  // The only samples thrown away are the ones that describe something other
  // than a slow frame: a tab returning from the background, which arrives as a
  // single gap of seconds. `skipPresent` is set by the frame loop when that
  // happens, so the judgement is made where the fact is known.
  //
  // Nothing else is discarded, and the ceiling is deliberately far out at two
  // seconds. An earlier version dropped anything over 250ms, which on a
  // renderer running at five frames a second silently threw away every frame
  // worse than the cap and reported 250ms as the worst case — a profiler whose
  // whole reason to exist is percentiles, quietly truncating its own tail.
  present(ms){
    if(!this.enabled)return;
    if(this.skipPresent){this.skipPresent=false;return}
    if(!(ms>0)||ms>2000)return;
    this.presents[this.presentHead]=ms;
    this.presentHead=(this.presentHead+1)%CAPACITY;
    if(this.presentCount<CAPACITY)this.presentCount++;
  }

  // A duration the caller measured itself. The deferred renderer already times
  // each of its passes to drive the visual test's overlay, and timing them a
  // second time here would be both redundant and slightly different.
  phase(name,ms){
    // Only inside an open frame. A paused or level-up frame renders without
    // the simulation having opened one, and a section recorded then is timed
    // from a stale mark and lands in a slot no frame will ever close.
    if(!this.enabled||!this.open)return;
    const ring=this.phases[name]||(this.phases[name]=new Float32Array(CAPACITY));
    ring[this.head]=ms;
  }

  begin(){
    if(!this.enabled)return;
    this.t0=this.lastMark=performance.now();
    this.open=true;
  }

  // Close the section that started at the previous mark.
  mark(name){
    if(!this.enabled||!this.open)return;
    const now=performance.now();
    const ring=this.phases[name]||(this.phases[name]=new Float32Array(CAPACITY));
    ring[this.head]=now-this.lastMark;
    this.lastMark=now;
  }

  end(){
    // Only close a frame that was opened. The readout is switched on partway
    // through a frame, so without this the first sample would be measured from
    // a stale start and land in the buffer as a phantom spike — exactly the
    // kind of number that sends someone hunting a stall that never happened.
    if(!this.enabled||!this.open)return;
    this.open=false;
    this.frames[this.head]=performance.now()-this.t0;
    this.head=(this.head+1)%CAPACITY;
    if(this.count<CAPACITY)this.count++;
  }

  count_(name,by=1){
    if(!this.enabled)return;
    this.counters[name]=(this.counters[name]||0)+by;
  }

  peak(name,value){
    if(!this.enabled)return;
    if(name==='particles'&&value>this.peakParticles)this.peakParticles=value;
    if(name==='enemies'&&value>this.peakEnemies)this.peakEnemies=value;
  }

  // Percentiles over the live window. Sorting 240 floats a few times a second
  // is cheap next to the frame it is describing, and only happens when the
  // readout is actually being drawn.
  percentiles(ring=this.frames,count=this.count){
    if(!count)return{p50:0,p95:0,p99:0,max:0};
    const slice=Array.prototype.slice.call(ring,0,count).sort((a,b)=>a-b);
    const at=q=>slice[Math.min(slice.length-1,Math.floor(slice.length*q))];
    return{p50:at(.5),p95:at(.95),p99:at(.99),max:slice[slice.length-1]};
  }

  phaseAverage(name){
    const ring=this.phases[name];
    if(!ring||!this.count)return 0;
    let total=0;
    for(let i=0;i<this.count;i++)total+=ring[i];
    return total/this.count;
  }

  // A plain object, so the numbers can be read from a console, posted from a
  // phone, or asserted in a test without going through the overlay.
  snapshot(){
    const p=this.percentiles();
    const present=this.percentiles(this.presents,this.presentCount);
    const phases={};
    for(const name of Object.keys(this.phases))phases[name]=+this.phaseAverage(name).toFixed(2);
    const mem=performance.memory?.usedJSHeapSize;
    return{
      samples:this.count,
      frameMs:{p50:+p.p50.toFixed(2),p95:+p.p95.toFixed(2),p99:+p.p99.toFixed(2),max:+p.max.toFixed(2)},
      fps:{p50:p.p50?Math.round(1000/p.p50):0,worst:p.max?Math.round(1000/p.max):0},
      // What reached the screen, as opposed to what the CPU spent. Slow p99
      // here with a fast `frameMs` is the signature of a GPU-bound frame.
      presentSamples:this.presentCount,
      presentMs:{p50:+present.p50.toFixed(2),p95:+present.p95.toFixed(2),
                 p99:+present.p99.toFixed(2),max:+present.max.toFixed(2)},
      presentFps:{p50:present.p50?Math.round(1000/present.p50):0,
                  worst:present.max?Math.round(1000/present.max):0},
      phasesMs:phases,
      counters:{...this.counters},
      peak:{particles:this.peakParticles,enemies:this.peakEnemies},
      heapMb:mem?+(mem/1048576).toFixed(1):null
    };
  }
}

// One instance for the running session. The engine and the renderer both write
// to it, and the overlay reads it.
export const profiler=new Profiler();
