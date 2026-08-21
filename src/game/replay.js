// Replay capture.
//
// The simulation is seeded and runs on a fixed timestep, so a run is fully
// determined by its seed, its configuration and the input it was given. That
// means a replay does not have to be a recording of what happened — it is the
// seed plus the input log, and the simulation regenerates the rest.
//
// The whole input surface the simulation reads is five things: two movement
// axes, an aim vector, whether that aim was manual, and five edge-triggered
// actions. Everything else on the Input object — pointer coordinates, stick
// state, gamepad axes, the pause key — either never reaches `step()` or is
// resolved into one of those five before it does.
//
// Two properties make this exact rather than approximate:
//
//   The frame is captured once per fixed step, not once per rendered frame.
//   A slow frame runs up to five steps and a fast one runs none, so a
//   per-frame log would drift the moment the recording machine and the
//   playback machine disagreed about frame rate.
//
//   The simulation consumes the quantised values, live as well as on replay.
//   Movement and aim are stored as signed bytes. If the live run used full
//   precision and the replay used the rounded copy, the two would diverge
//   within seconds — so the rounding happens at capture, once, for both.

export const REPLAY_VERSION=2;

// Settings that reach the simulation rather than only the presentation, and so
// have to travel with a replay. `autoAim` decides whether a weapon adjusts onto
// a contact near the pointer; `performanceMode` lowers the hostile cap from a
// hundred to sixty-eight. A replay recorded under one and watched under the
// other is a different run, so the recording's values win on playback.
//
// Anything added here later must be added to this list in the same commit —
// it is the one place that knows a preference is not just a preference.
export const SIM_SETTINGS=['autoAim','performanceMode'];

// The actions the simulation reads, in bit order. Order is part of the file
// format: appending is safe, reordering is not.
export const REPLAY_ACTIONS=['dash','ability','deploy','kit','secondary'];
const MANUAL_BIT=1<<REPLAY_ACTIONS.length;

const clamp8=v=>Math.max(-127,Math.min(127,Math.round((v||0)*127)));
const from8=v=>v/127;

// One fixed step of input packs into five bytes — two movement axes, two aim
// axes and a flag byte — plus a two-byte repeat count. Aim y is stored rather
// than recovered from aim x and the vector's length: rounding to a byte means
// the reconstruction would miss by one now and then, and a replay that is
// nearly right is a replay that diverges.

// Reads everything the simulation will consume this step, once, up front.
// takeAction is edge-triggered and consumed on read, so this has to be the
// only place it is read — which it is, because the simulation is handed the
// snapshot rather than the live object.
export function captureStep(input,camera,player){
  const aim=input.aimVector(camera,player);
  let flags=0;
  const actions={};
  for(let i=0;i<REPLAY_ACTIONS.length;i++){
    const name=REPLAY_ACTIONS[i];
    const fired=input.takeAction(name);
    actions[name]=fired;
    if(fired)flags|=1<<i;
  }
  if(aim.manual)flags|=MANUAL_BIT;
  // Quantise here so the live run and the replay consume identical numbers.
  const moveX=clamp8(input.moveX),moveY=clamp8(input.moveY);
  const aimX=clamp8(aim.x),aimY=clamp8(aim.y);
  return new StepInput(moveX,moveY,aimX,aimY,flags,actions);
}

// A frozen step of input. Serves the same three members the simulation reads
// off the live Input, and nothing else — anything the simulation started
// reading that is not here would throw on replay rather than silently drift.
export class StepInput{
  constructor(moveX,moveY,aimX,aimY,flags,actions){
    this.qMoveX=moveX;this.qMoveY=moveY;
    this.qAimX=aimX;this.qAimY=aimY;
    this.flags=flags;
    this.moveX=from8(moveX);
    this.moveY=from8(moveY);
    this.aim={x:from8(aimX),y:from8(aimY),manual:(flags&MANUAL_BIT)!==0};
    this.actions=actions||StepInput.decodeActions(flags);
  }

  static decodeActions(flags){
    const actions={};
    for(let i=0;i<REPLAY_ACTIONS.length;i++)actions[REPLAY_ACTIONS[i]]=(flags&(1<<i))!==0;
    return actions;
  }

  aimVector(){return this.aim}
  // Not consumed: within one step the simulation reads each action once, and
  // re-reading a snapshot must give the same answer as reading it the first
  // time or a replay would depend on call order.
  takeAction(name){return this.actions[name]===true}
}

// Packs to bytes and run-length encodes as it goes. Held input is the common
// case — walking in one direction for two seconds is a hundred and twenty
// identical steps — so the log of a real run collapses hard.
export class ReplayRecorder{
  constructor(){
    this.runs=[];   // [count, mx, my, ax, ay, flags] per distinct step
    this.steps=0;
    this.last=null;
  }

  record(step){
    this.steps++;
    const last=this.last;
    if(last&&last[1]===step.qMoveX&&last[2]===step.qMoveY&&
       last[3]===step.qAimX&&last[4]===step.qAimY&&last[5]===step.flags&&last[0]<65535){
      last[0]++;
      return;
    }
    const run=[1,step.qMoveX,step.qMoveY,step.qAimX,step.qAimY,step.flags];
    this.runs.push(run);
    this.last=run;
  }

  // A base64 payload of 7-byte records: a 16-bit repeat count, four signed
  // axis bytes and a flag byte.
  encode(){
    const bytes=new Uint8Array(this.runs.length*7);
    let o=0;
    for(const [count,mx,my,ax,ay,flags] of this.runs){
      bytes[o++]=count&255;
      bytes[o++]=(count>>8)&255;
      bytes[o++]=mx&255;
      bytes[o++]=my&255;
      bytes[o++]=ax&255;
      bytes[o++]=ay&255;
      bytes[o++]=flags&255;
    }
    return {steps:this.steps,runs:this.runs.length,data:toBase64(bytes)};
  }
}

function toBase64(bytes){
  let binary='';
  for(let i=0;i<bytes.length;i+=8192){
    binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
  }
  return btoa(binary);
}

function fromBase64(text){
  const binary=atob(text||'');
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}

// Held input run-length encodes away to nothing, but a mouse or an analog
// stick moves a little every step, and there the run-length pass buys nothing
// at all — a thirty-minute contract is about a megabyte of base64. gzip roughly
// halves that, and the axes are smooth so it does well on exactly the case the
// run-length pass cannot help with.
//
// The compression sits at the storage boundary rather than inside the codec so
// the recorder and the player stay synchronous: only saving a replay and
// opening one have to wait, and neither is in a frame.
const canZip=()=>typeof CompressionStream==='function'&&typeof DecompressionStream==='function';

async function through(stream,bytes){
  const writer=stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export async function packLog(log){
  if(!log?.data||log.z||!canZip())return log;
  try{
    const packed=await through(new CompressionStream('gzip'),fromBase64(log.data));
    const data=toBase64(packed);
    // Refuse a pack that made it bigger, which a very short log can.
    if(data.length>=log.data.length)return log;
    return {...log,z:true,data};
  }catch{
    return log;
  }
}

export async function unpackLog(log){
  if(!log?.z)return log;
  if(!canZip())throw new Error('this browser cannot read compressed replays');
  const raw=await through(new DecompressionStream('gzip'),fromBase64(log.data));
  return {steps:log.steps,runs:log.runs,data:toBase64(raw)};
}

// Replays an encoded log one step at a time. Runs dry rather than throwing
// when a replay is shorter than the simulation asks for: a run that ended on
// a death has no input after it, and the simulation is about to end too.
export class ReplayPlayer{
  constructor(encoded){
    if(encoded?.z)throw new Error('replay log must be unpacked before playback');
    const bytes=fromBase64(encoded?.data);
    this.frames=[];
    for(let o=0;o+6<bytes.length;o+=7){
      const count=bytes[o]|(bytes[o+1]<<8);
      const mx=(bytes[o+2]<<24>>24),my=(bytes[o+3]<<24>>24);
      const ax=(bytes[o+4]<<24>>24),ay=(bytes[o+5]<<24>>24);
      this.frames.push({count,step:new StepInput(mx,my,ax,ay,bytes[o+6],null)});
    }
    this.total=encoded.steps||0;
    this.index=0;
    this.left=this.frames[0]?.count||0;
    this.consumed=0;
    this.idle=new StepInput(0,0,0,0,0,null);
  }

  get done(){return this.consumed>=this.total}

  next(){
    while(this.index<this.frames.length&&this.left<=0){
      this.index++;
      this.left=this.frames[this.index]?.count||0;
    }
    const frame=this.frames[this.index];
    if(!frame)return this.idle;
    this.left--;
    this.consumed++;
    return frame.step;
  }
}
