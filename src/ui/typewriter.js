// Briefing dialogue pacing.
//
// The briefing screen used to drop all of its lines in at once on staggered
// fade-ins. That reads as a document appearing, not as people talking, and it
// gave the writing no room — a briefing is the only place in the game where
// two characters speak to each other at length, and it was over before the
// player registered who was speaking.
//
// Voice was the other option on the roadmap and it is not available: there is
// no recorded audio in this project and nothing here synthesises speech. So the
// pacing is typographic. Three things make typed text read as speech rather
// than as a printer:
//
//   1. Speakers have their own cadence. VECTOR is a handler issuing orders and
//      is brisk; the ARCHIVIST is thinking out loud; the OPERATIVE says as
//      little as possible; SIGNAL is nine months into a trial nobody told him
//      had ended, and comes out unevenly.
//   2. Punctuation holds. A full stop is a breath, a comma is shorter, a dash
//      is somebody being interrupted or interrupting themselves.
//   3. The gap between lines is longer when the speaker changes, because that
//      gap is somebody deciding to answer.
//
// Layout is reserved before a single character is typed: each line carries its
// full text as an invisible ghost that sets the box height, and the typed text
// is painted over the top. Without that the container grows line by line and
// the DEPLOY button walks down the screen while the player is reading.
//
// The ghost is the copy screen readers get, so assistive tech is handed the
// whole briefing immediately rather than being made to wait out an animation.

// Inlined rather than imported from screens.js, which imports this module:
// the cycle would resolve, but a binding that is only safe because it happens
// to be read at call time is not worth the coupling.
const escapeHtml=text=>String(text).replace(/[&<>"]/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// Milliseconds per character, and how much that wanders. Jitter is a fraction
// of the base: SIGNAL's delivery is meant to be visibly unsteady, everyone
// else's only enough to not sound mechanical.
const VOICES={
  vector:{ms:17,jitter:.25},
  archivist:{ms:24,jitter:.3},
  operative:{ms:20,jitter:.2},
  signal:{ms:34,jitter:.85},
  default:{ms:20,jitter:.3}
};

// Extra hold after a character, in milliseconds.
const HOLDS={'.':260,'!':260,'?':300,',':110,';':150,':':150,'—':190,'–':190};

const REDUCED=()=>{
  try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches}
  catch{return false}
};

export class Typewriter{
  // `lines` is the same {speaker,text} shape the campaign data uses.
  constructor(container,lines,{audio=null,onDone=null}={}){
    this.container=container;
    this.lines=lines||[];
    this.audio=audio;
    this.onDone=onDone;
    this.raf=0;
    this.done=false;
    this.index=0;      // which line is typing
    this.chars=0;      // characters revealed in that line
    this.nextAt=0;     // timestamp the next character is due

    this.render();
    this.nodes=[...container.querySelectorAll('.line')];
    this.typed=this.nodes.map(n=>n.querySelector('.typed'));

    // Any input finishes the whole briefing. One gesture rather than a
    // line-by-line advance: the lines are all on screen already, so "show me
    // the rest" is the only thing a player can mean by tapping.
    this.onInput=event=>{
      if(this.done)return;
      if(event.type==='keydown'&&!['Enter',' ','Escape'].includes(event.key))return;
      // Never swallow a click on a real control.
      if(event.target?.closest?.('button,a,input,select,textarea'))return;
      this.finish();
    };
    this.container.addEventListener('pointerdown',this.onInput);
    window.addEventListener('keydown',this.onInput);

    if(REDUCED()||!this.lines.length)this.finish();
    else{
      this.tick=now=>{
        this.step(now);
        if(!this.done)this.raf=requestAnimationFrame(this.tick);
      };
      this.raf=requestAnimationFrame(this.tick);
    }
  }

  render(){
    this.container.innerHTML=this.lines.map(line=>{
      const speaker=String(line.speaker||'').toLowerCase();
      return `
        <div class="line speaker-${escapeHtml(speaker)}">
          <b>${escapeHtml(line.speaker||'')}</b>
          <p><span class="ghost">${escapeHtml(line.text||'')}</span
            ><span class="typed" aria-hidden="true"></span></p>
        </div>`;
    }).join('');
    this.container.classList.add('typing');
  }

  step(now){
    if(this.index>=this.lines.length)return this.finish();
    const node=this.nodes[this.index];
    if(!node)return this.finish();
    if(!node.classList.contains('revealed')){
      node.classList.add('revealed','typing');
      // Charge the line gap before the first character, so a reply lands after
      // a beat rather than on top of the question.
      const previous=this.lines[this.index-1];
      const changed=previous&&previous.speaker!==this.lines[this.index].speaker;
      this.nextAt=now+(this.index===0?120:changed?420:220);
      return;
    }
    if(now<this.nextAt)return;

    const text=this.lines[this.index].text||'';
    const voice=VOICES[String(this.lines[this.index].speaker||'').toLowerCase()]||VOICES.default;
    // Catch up rather than emitting one character per frame: a 16ms frame at
    // 17ms/char would otherwise cap every voice at the refresh rate.
    let guard=0;
    while(now>=this.nextAt&&this.chars<text.length&&guard++<400){
      const ch=text[this.chars++];
      const wander=1+(Math.random()*2-1)*voice.jitter;
      this.nextAt+=Math.max(4,voice.ms*wander)+(HOLDS[ch]||0);
    }
    this.typed[this.index].textContent=text.slice(0,this.chars);
    // A dry key click, throttled in the mixer so it stays a texture.
    if(this.chars<text.length)this.audio?.play('type',{volume:.5});

    if(this.chars>=text.length){
      node.classList.remove('typing');
      this.index++;
      this.chars=0;
    }
  }

  // Paint every line in full and stop. Called by the skip gesture, by reduced
  // motion, and by the natural end of the last line.
  finish(){
    if(this.done)return;
    this.done=true;
    cancelAnimationFrame(this.raf);
    this.raf=0;
    this.nodes?.forEach((node,i)=>{
      node.classList.add('revealed');
      node.classList.remove('typing');
      if(this.typed?.[i])this.typed[i].textContent=this.lines[i]?.text||'';
    });
    this.container.classList.remove('typing');
    this.container.classList.add('typed-out');
    this.detach();
    this.onDone?.();
  }

  detach(){
    this.container.removeEventListener('pointerdown',this.onInput);
    window.removeEventListener('keydown',this.onInput);
  }

  destroy(){
    cancelAnimationFrame(this.raf);
    this.raf=0;
    this.done=true;
    this.detach();
  }
}
