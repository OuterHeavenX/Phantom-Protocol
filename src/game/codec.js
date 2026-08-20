import {CODEC_EVENTS,codecBeat,handlerFor,channelFor} from '../../data/codec.js';
import {OPERATIVES_BY_ID} from '../../data/operatives.js';
import {Rng} from '../core/rng.js';

// Codec traffic director.
//
// The engine fires events at it; it decides what is worth saying, and when. It
// owns three pieces of restraint, because a radio that never stops talking is
// worse than one that never starts:
//
//   once      — beats that would be false the second time (deploy, halfway)
//   cooldown  — per-event, so a run of elites is one callout, not six
//   priority  — a higher-priority beat interrupts a lower one mid-sentence,
//               which is why a critical-vitals call lands during idle chatter
//
// Lines dwell for a length derived from their own text, so a short line does
// not sit as long as a long one, with a floor that keeps it readable.

const GLOBAL_GAP=1.1;        // seconds of quiet enforced between beats
const READ_SPEED=17;         // characters per second
const MIN_DWELL=2.2;
const MAX_DWELL=6;
const MAX_QUEUE=3;

function dwellFor(text){
  return Math.min(MAX_DWELL,Math.max(MIN_DWELL,text.length/READ_SPEED));
}

export class CodecDirector{
  constructor(engine){
    this.engine=engine;
    this.operativeId=engine.operative.id;
    this.handlerId=handlerFor(this.operativeId);

    this.speakers={
      self:this.speakerFor(this.operativeId),
      handler:this.speakerFor(this.handlerId)
    };

    // Its own stream, derived from the run's seed. Picking a line must never
    // draw from the simulation's RNG: the same seed has to produce the same
    // contract whether or not the channel is switched on, and a replay of a
    // seed must not depend on how much anybody said.
    this.rng=new Rng((engine.rng.seed^0x5ec0dec0)>>>0);

    this.queue=[];
    this.current=null;
    this.timer=0;
    this.gap=0;
    this.fired=new Set();
    this.lastFired=new Map();
    // Bumped whenever the displayed line changes, so the HUD can tell a new
    // line from the same one still on screen without comparing strings.
    this.revision=0;
  }

  // Read live rather than captured at construction, so turning the channel
  // off from the pause menu silences it on the spot.
  get enabled(){return this.engine.settings?.codec!==false}

  speakerFor(id){
    const op=OPERATIVES_BY_ID[id];
    return{
      id,
      codename:op?.codename||'COMMAND',
      portrait:op?.portrait||null,
      color:op?.color||'#76e7d4',
      channel:channelFor(id)
    };
  }

  // Events are fired unconditionally by the engine; every reason to stay quiet
  // lives here rather than at each call site.
  fire(event){
    if(!this.enabled)return;
    const spec=CODEC_EVENTS[event];
    if(!spec)return;
    if(spec.once&&this.fired.has(event))return;
    const now=this.engine.elapsed;
    if(spec.cooldown&&now-(this.lastFired.get(event)??-1e9)<spec.cooldown)return;

    const lines=codecBeat(event,this.operativeId,()=>this.rng.next());
    if(!lines.length)return;

    const priority=spec.priority||1;
    // A more urgent beat replaces whatever is queued and cuts off whatever is
    // speaking; a less urgent one waits its turn, and is dropped if the queue
    // is already backed up rather than arriving long after it was true.
    if(this.current&&priority>this.current.priority){
      this.queue.length=0;
      this.current=null;
    }else if(this.queue.length>=MAX_QUEUE){
      return;
    }

    this.fired.add(event);
    this.lastFired.set(event,now);
    for(const line of lines){
      this.queue.push({
        event,priority,
        speaker:this.speakers[line.from]||this.speakers.handler,
        text:line.text,
        dwell:dwellFor(line.text)
      });
    }
  }

  update(dt){
    // Turning the channel off drops what was waiting as well as what was
    // speaking: a callout that arrives minutes late, when it is switched back
    // on, is worse than one that never came.
    if(!this.enabled){
      if(this.current||this.queue.length)this.clear();
      return;
    }
    if(this.current){
      this.timer-=dt;
      if(this.timer>0)return;
      this.current=null;
      this.gap=GLOBAL_GAP;
    }
    if(this.gap>0){this.gap-=dt;return}
    const next=this.queue.shift();
    if(!next)return;
    this.current=next;
    this.timer=next.dwell;
    this.revision++;
    this.engine.audio?.play('codec');
  }

  // Silences the channel and drops anything still waiting — used when the run
  // ends, so a callout cannot arrive over the results screen.
  clear(){
    this.queue.length=0;
    this.current=null;
    this.timer=0;
  }
}
