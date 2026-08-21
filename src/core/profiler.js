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
    this.phases={};this.counters={};
    this.peakParticles=0;this.peakEnemies=0;
  }

  begin(){
    if(!this.enabled)return;
    this.t0=this.lastMark=performance.now();
    this.open=true;
  }

  // Close the section that started at the previous mark.
  mark(name){
    if(!this.enabled)return;
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
  percentiles(ring=this.frames){
    if(!this.count)return{p50:0,p95:0,p99:0,max:0};
    const slice=Array.prototype.slice.call(ring,0,this.count).sort((a,b)=>a-b);
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
    const phases={};
    for(const name of Object.keys(this.phases))phases[name]=+this.phaseAverage(name).toFixed(2);
    const mem=performance.memory?.usedJSHeapSize;
    return{
      samples:this.count,
      frameMs:{p50:+p.p50.toFixed(2),p95:+p.p95.toFixed(2),p99:+p.p99.toFixed(2),max:+p.max.toFixed(2)},
      fps:{p50:p.p50?Math.round(1000/p.p50):0,worst:p.max?Math.round(1000/p.max):0},
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
