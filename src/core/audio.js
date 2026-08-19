import {clamp} from './math.js';
import {trackFor,trackSources,MUSIC_FORMATS} from '../../data/music.js';

// Sound effects are fully synthesized at runtime from oscillators and shaped
// noise buffers, so the game keeps its weapon reports, impacts and UI clicks
// without shipping a single sample.
//
// Music is authored where a track exists for the theatre or operation and
// synthesized where one does not. Authored tracks stream through an
// HTMLAudioElement that plays on the browser's own media pipeline rather than
// through the AudioContext, because a media element adopted by a suspended
// context freezes outright — it reports itself as playing while its clock
// stops and no sound comes out, and nothing short of resuming the context
// brings it back. Its level is driven from the same settings as the
// synthesized bed, so one volume control, one mute and one crossfade still
// cover both paths, and a browser that cannot decode the file falls back to
// the bed rather than going silent.

// Seconds to crossfade between two pieces of music.
const MUSIC_FADE=1.1;
export class AudioEngine{
  constructor(settings={}){
    this.ctx=null;
    this.ready=false;
    this.settings={master:1,music:.55,sfx:.8,muted:false,...settings};
    this.noiseBuffer=null;
    this.musicNodes=[];
    this.musicTimer=null;
    this.intensity=0;
    this.targetIntensity=0;
    this.step=0;
    this.lastPlayed=new Map();
    this.voices=0;
    this.maxVoices=24;
  }

  // Browsers require a user gesture; call this from the first click/keypress.
  unlock(){
    if(this.ctx)
      return this.ctx.state==='suspended'?this.ctx.resume().then(()=>{this.ready=true}):Promise.resolve();
    const Ctor=window.AudioContext||window.webkitAudioContext;
    if(!Ctor)return Promise.resolve();
    this.ctx=new Ctor();
    this.master=this.ctx.createGain();
    this.master.gain.value=this.settings.muted?0:this.settings.master;
    this.master.connect(this.ctx.destination);

    this.sfxBus=this.ctx.createGain();
    this.sfxBus.gain.value=this.settings.sfx;

    // A gentle limiter stops dense firefights from clipping.
    this.limiter=this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value=-14;
    this.limiter.knee.value=12;
    this.limiter.ratio.value=8;
    this.limiter.attack.value=.003;
    this.limiter.release.value=.18;
    this.sfxBus.connect(this.limiter);
    this.limiter.connect(this.master);

    this.musicBus=this.ctx.createGain();
    this.musicBus.gain.value=this.settings.music;
    this.musicBus.connect(this.master);

    this.buildNoise();
    this.watchContext();
    this.ready=true;
    return Promise.resolve();
  }

  // A browser may suspend the context on its own — a backgrounded tab, an
  // interruption from another app, its own autoplay heuristics. Nothing in the
  // game suspends it deliberately, so any suspension is something to recover
  // from: while it lasts every synthesized sound is silent. Resuming needs no
  // gesture once one has been given, and is harmless if refused.
  watchContext(){
    const revive=()=>this.resumeContext();
    this.ctx.addEventListener?.('statechange',()=>{
      if(this.ctx.state==='suspended')revive();
    });
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)revive()});
    // Kept for the life of the page rather than removed after the first
    // gesture: a context suspended in the middle of a session needs the next
    // interaction just as much as the first one did.
    for(const event of ['pointerdown','keydown','touchstart'])
      window.addEventListener(event,revive,{passive:true});
  }

  resumeContext(){
    if(this.ctx?.state==='suspended')this.ctx.resume().catch(()=>{});
  }

  buildNoise(){
    const seconds=1.4;
    const length=Math.floor(this.ctx.sampleRate*seconds);
    const buffer=this.ctx.createBuffer(1,length,this.ctx.sampleRate);
    const data=buffer.getChannelData(0);
    let last=0;
    for(let i=0;i<length;i++){
      const white=Math.random()*2-1;
      // Light low-pass gives a fuller, less hissy noise floor.
      last=(last+.06*white)/1.06;
      data[i]=last*3.2;
    }
    this.noiseBuffer=buffer;
  }

  applySettings(settings){
    Object.assign(this.settings,settings);
    if(!this.ctx)return;
    const now=this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted?0:this.settings.master,now,.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx,now,.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music,now,.1);
    // Authored tracks are outside the graph, so they take the same change
    // through their own element volume.
    for(const entry of (this.trackNodes||new Map()).values())this.applyTrackVolume(entry);
  }

  now(){return this.ctx?this.ctx.currentTime:0}

  // Voice budget + per-sound throttle keeps huge waves from turning the
  // mix into mush and from allocating hundreds of nodes per frame.
  canPlay(name,throttle){
    if(!this.ready||!this.ctx||this.settings.muted)return false;
    if(this.voices>=this.maxVoices)return false;
    if(throttle){
      const t=this.ctx.currentTime;
      const last=this.lastPlayed.get(name)||-99;
      if(t-last<throttle)return false;
      this.lastPlayed.set(name,t);
    }
    return true;
  }

  track(node,duration){
    this.voices++;
    node.onended=()=>{this.voices=Math.max(0,this.voices-1)};
    // Fallback in case onended never fires.
    setTimeout(()=>{this.voices=Math.max(0,this.voices-1)},duration*1000+250);
  }

  tone({freq=440,endFreq=null,type='sine',duration=.2,gain=.3,delay=0,attack=.005,bus=null,detune=0}={}){
    const ctx=this.ctx,t=ctx.currentTime+delay;
    const osc=ctx.createOscillator();
    const env=ctx.createGain();
    osc.type=type;
    osc.detune.value=detune;
    osc.frequency.setValueAtTime(freq,t);
    if(endFreq!==null)osc.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq),t+duration);
    env.gain.setValueAtTime(.0001,t);
    env.gain.exponentialRampToValueAtTime(Math.max(.0001,gain),t+attack);
    env.gain.exponentialRampToValueAtTime(.0001,t+duration);
    osc.connect(env);
    env.connect(bus||this.sfxBus);
    osc.start(t);
    osc.stop(t+duration+.02);
    this.track(osc,duration+delay);
    return osc;
  }

  noise({duration=.2,gain=.3,delay=0,filter='lowpass',freq=1200,endFreq=null,q=1,bus=null}={}){
    const ctx=this.ctx,t=ctx.currentTime+delay;
    const src=ctx.createBufferSource();
    src.buffer=this.noiseBuffer;
    src.playbackRate.value=.8+Math.random()*.5;
    const biquad=ctx.createBiquadFilter();
    biquad.type=filter;
    biquad.frequency.setValueAtTime(freq,t);
    biquad.Q.value=q;
    if(endFreq!==null)biquad.frequency.exponentialRampToValueAtTime(Math.max(40,endFreq),t+duration);
    const env=ctx.createGain();
    env.gain.setValueAtTime(.0001,t);
    env.gain.exponentialRampToValueAtTime(Math.max(.0001,gain),t+.004);
    env.gain.exponentialRampToValueAtTime(.0001,t+duration);
    src.connect(biquad);biquad.connect(env);env.connect(bus||this.sfxBus);
    src.start(t);
    src.stop(t+duration+.02);
    this.track(src,duration+delay);
    return src;
  }

  // ---- Sound library -----------------------------------------------------

  play(name,options={}){
    // The context only exists after the unlock gesture resolves, and unlock is
    // async — a click handler firing on that same first gesture would
    // otherwise reach the oscillator helpers with no context at all.
    if(!this.ready||!this.ctx)return;
    const volume=clamp(options.volume??1,0,1.5);
    switch(name){
      case 'shoot':
        if(!this.canPlay('shoot',.035))return;
        this.noise({duration:.09,gain:.16*volume,freq:2600,endFreq:600,filter:'bandpass',q:1.1});
        this.tone({freq:340,endFreq:110,type:'square',duration:.07,gain:.07*volume});
        break;
      case 'shootHeavy':
        if(!this.canPlay('shootHeavy',.06))return;
        this.noise({duration:.2,gain:.26*volume,freq:1500,endFreq:180,filter:'lowpass'});
        this.tone({freq:180,endFreq:52,type:'sawtooth',duration:.18,gain:.16*volume});
        break;
      case 'laser':
        if(!this.canPlay('laser',.05))return;
        this.tone({freq:1500,endFreq:320,type:'sawtooth',duration:.17,gain:.11*volume});
        this.tone({freq:2400,endFreq:700,type:'sine',duration:.12,gain:.06*volume});
        break;
      case 'tech':
        if(!this.canPlay('tech',.05))return;
        this.tone({freq:760,endFreq:1500,type:'triangle',duration:.14,gain:.1*volume});
        break;
      case 'hit':
        if(!this.canPlay('hit',.022))return;
        this.noise({duration:.06,gain:.13*volume,freq:3400,endFreq:900,filter:'bandpass',q:.8});
        break;
      case 'crit':
        if(!this.canPlay('crit',.04))return;
        this.noise({duration:.09,gain:.19*volume,freq:5200,endFreq:1200,filter:'bandpass',q:1.4});
        this.tone({freq:1750,endFreq:900,type:'square',duration:.08,gain:.09*volume});
        break;
      case 'kill':
        if(!this.canPlay('kill',.05))return;
        this.noise({duration:.22,gain:.17*volume,freq:900,endFreq:120,filter:'lowpass'});
        break;
      case 'explode':
        if(!this.canPlay('explode',.06))return;
        this.noise({duration:.55,gain:.34*volume,freq:900,endFreq:60,filter:'lowpass'});
        this.tone({freq:110,endFreq:32,type:'sine',duration:.45,gain:.24*volume});
        break;
      case 'hurt':
        if(!this.canPlay('hurt',.12))return;
        this.tone({freq:220,endFreq:70,type:'sawtooth',duration:.24,gain:.24*volume});
        this.noise({duration:.2,gain:.16*volume,freq:700,endFreq:180,filter:'lowpass'});
        break;
      case 'dash':
        if(!this.canPlay('dash',.1))return;
        this.noise({duration:.24,gain:.2*volume,freq:400,endFreq:3000,filter:'bandpass',q:.7});
        break;
      case 'pickup':
        if(!this.canPlay('pickup',.03))return;
        this.tone({freq:820,endFreq:1320,type:'triangle',duration:.09,gain:.09*volume});
        break;
      case 'coin':
        if(!this.canPlay('coin',.04))return;
        this.tone({freq:1180,type:'square',duration:.07,gain:.07*volume});
        this.tone({freq:1760,type:'square',duration:.09,gain:.05*volume,delay:.05});
        break;
      case 'heal':
        this.tone({freq:520,endFreq:900,type:'sine',duration:.3,gain:.17*volume});
        this.tone({freq:780,endFreq:1300,type:'sine',duration:.34,gain:.1*volume,delay:.06});
        break;
      case 'levelup':
        [523,659,784,1047].forEach((f,i)=>this.tone({freq:f,type:'triangle',duration:.34,gain:.16*volume,delay:i*.075}));
        break;
      case 'select':
        if(!this.canPlay('select',.02))return;
        this.tone({freq:660,type:'square',duration:.05,gain:.055*volume});
        break;
      case 'confirm':
        this.tone({freq:520,endFreq:880,type:'square',duration:.12,gain:.09*volume});
        break;
      case 'deny':
        this.tone({freq:220,endFreq:120,type:'square',duration:.18,gain:.1*volume});
        break;
      case 'alarm':
        [0,.28,.56].forEach(d=>this.tone({freq:880,endFreq:560,type:'sawtooth',duration:.26,gain:.14*volume,delay:d}));
        break;
      case 'boss':
        this.tone({freq:64,endFreq:44,type:'sawtooth',duration:2.4,gain:.3*volume});
        this.tone({freq:96,endFreq:70,type:'square',duration:2.1,gain:.14*volume,delay:.15});
        this.noise({duration:2.2,gain:.13*volume,freq:220,endFreq:70,filter:'lowpass'});
        break;
      case 'unlock':
        [392,523,659,880,1047].forEach((f,i)=>this.tone({freq:f,type:'sine',duration:.5,gain:.13*volume,delay:i*.09}));
        break;
      case 'victory':
        [523,659,784,1047,1319].forEach((f,i)=>this.tone({freq:f,type:'triangle',duration:.6,gain:.16*volume,delay:i*.13}));
        break;
      case 'defeat':
        [392,330,262,196].forEach((f,i)=>this.tone({freq:f,type:'sawtooth',duration:.75,gain:.15*volume,delay:i*.22}));
        break;
      case 'scramble':
        this.tone({freq:1400,endFreq:180,type:'sawtooth',duration:.7,gain:.2*volume});
        this.noise({duration:.8,gain:.16*volume,freq:3000,endFreq:200,filter:'bandpass',q:2});
        break;
      case 'shield':
        this.tone({freq:300,endFreq:620,type:'sine',duration:.35,gain:.14*volume});
        break;
      case 'reload':
        if(!this.canPlay('reload',.1))return;
        this.noise({duration:.07,gain:.1*volume,freq:1800,filter:'bandpass',q:2});
        this.noise({duration:.09,gain:.12*volume,freq:900,filter:'bandpass',q:2,delay:.11});
        break;
      default:break;
    }
  }

  // ---- Adaptive music ----------------------------------------------------

  // Intensity 0..1 drives tempo, layer count and filter openness.
  setIntensity(value){this.targetIntensity=clamp(value,0,1)}

  // Whether this browser can decode the authored tracks at all. Safari has
  // historically refused Ogg Vorbis, and a silent title screen is a worse
  // outcome than the synthesized bed.
  get supportsTracks(){
    if(this._supportsTracks===undefined){
      const probe=document.createElement('audio');
      this._supportsTracks=!!probe.canPlayType&&
        MUSIC_FORMATS.some(f=>probe.canPlayType(f.type)!=='');
    }
    return this._supportsTracks;
  }

  // The level the authored tracks play at: the same two settings the
  // synthesized bed answers to, so one slider and one mute move both.
  get musicLevel(){
    return this.settings.muted?0:clamp(this.settings.master*this.settings.music,0,1);
  }

  // One <audio> element per track, kept for the session so a redeployment
  // reuses the element (and whatever it has already buffered) instead of
  // starting the download again.
  trackNode(track){
    this.trackNodes=this.trackNodes||new Map();
    let entry=this.trackNodes.get(track.file);
    if(entry)return entry;

    const element=new Audio();
    element.loop=true;
    element.preload='auto';
    // Offered as <source> children rather than a single src so the browser
    // picks the first format it can actually decode.
    for(const candidate of trackSources(track)){
      const source=document.createElement('source');
      source.src=candidate.src;
      source.type=candidate.type;
      element.appendChild(source);
    }

    entry={element,track,failed:false,level:0,fade:null};
    element.volume=0;

    element.addEventListener('error',()=>{
      entry.failed=true;
      console.warn('[phantom] music track failed to load',track.file);
      // Losing the authored track mid-session must not leave the run silent.
      if(this.currentTrack===entry)this.startSynthMusic(this.synthKey||'blacksite');
    });
    // A stall is the browser waiting on more of the file. Left alone it
    // recovers by itself; restarting or seeking here would turn a gap into a
    // jump backwards, so the only thing to do is not make it worse.
    element.addEventListener('pause',()=>{
      // Anything that pauses the current track without the game asking is an
      // interruption to recover from, not an instruction. Rate-limited so a
      // browser that insists on keeping it paused is left alone rather than
      // fought once per event.
      if(this.currentTrack!==entry||entry.stopping)return;
      const now=performance.now();
      if(now-(entry.resumedAt||0)<600)return;
      entry.resumedAt=now;
      element.play().catch(()=>{});
    });

    this.trackNodes.set(track.file,entry);
    return entry;
  }

  // Applies a track's fade level and the global music setting to the element.
  applyTrackVolume(entry){
    if(!entry)return;
    entry.element.volume=clamp(entry.level*this.musicLevel,0,1);
  }

  // Crossfades on a timer rather than an AudioParam ramp: the element is not
  // in the audio graph, so there is no param to schedule against.
  fadeTrack(entry,to,seconds=MUSIC_FADE){
    if(!entry)return;
    if(entry.fade){clearInterval(entry.fade);entry.fade=null}
    const from=entry.level;
    const span=Math.max(.001,seconds)*1000;
    const started=performance.now();
    if(from===to){this.applyTrackVolume(entry);return}
    entry.fade=setInterval(()=>{
      const t=Math.min(1,(performance.now()-started)/span);
      entry.level=from+(to-from)*t;
      this.applyTrackVolume(entry);
      if(t>=1){clearInterval(entry.fade);entry.fade=null}
    },40);
  }

  // `key` is an operation id or theatre id; `fallback` names the synthesized
  // bed to use when no authored track is registered for it.
  startMusic(key='blacksite',options={}){
    if(!this.ready||!this.ctx)return;
    const fallback=options.fallback||key;
    this.synthKey=fallback;

    const track=this.supportsTracks?trackFor(key):null;
    if(track){
      const entry=this.trackNode(track);
      if(entry&&!entry.failed){
        this.musicKey=key;
        // Already the current piece: let it run rather than restarting it.
        // Two keys can share a track (an operation and its theatre), so this
        // is a comparison of entries, not of keys. A stalled or interrupted
        // element is resumed where it stands — seeking to zero here would
        // turn a recoverable gap into a restart.
        const resuming=this.currentTrack===entry;
        this.stopSynthMusic();
        if(this.currentTrack&&!resuming){
          const previous=this.currentTrack;
          previous.stopping=true;
          this.fadeTrack(previous,0);
          setTimeout(()=>{
            if(this.currentTrack!==previous)previous.element.pause();
            previous.stopping=false;
          },MUSIC_FADE*1000);
        }
        this.currentTrack=entry;
        entry.stopping=false;
        if(!resuming)entry.element.currentTime=0;
        this.applyTrackVolume(entry);
        const played=entry.element.play();
        this.fadeTrack(entry,1,resuming?.25:MUSIC_FADE);
        // Autoplay can still be refused before the unlock gesture lands.
        played?.catch?.(err=>{
          console.warn('[phantom] music playback blocked',err);
          this.currentTrack=null;
          this.startSynthMusic(fallback);
        });
        return;
      }
    }

    this.stopTrack();
    this.startSynthMusic(fallback);
  }

  stopTrack(){
    if(!this.currentTrack)return;
    const entry=this.currentTrack;
    this.currentTrack=null;
    // Flagged so the element's own pause handler reads this as the game
    // stopping the music rather than as an interruption to recover from.
    entry.stopping=true;
    this.fadeTrack(entry,0,.5);
    setTimeout(()=>{
      if(this.currentTrack!==entry)entry.element.pause();
      entry.stopping=false;
    },520);
  }

  startSynthMusic(key='blacksite'){
    if(!this.ready||!this.ctx)return;
    this.stopSynthMusic();
    this.musicKey=key;
    this.step=0;
    this.musicOn=true;
    const scales={
      blacksite:[0,3,5,7,10],
      arctic:[0,2,3,7,8],
      sunken:[0,2,5,7,9],
      foundry:[0,1,5,6,10],
      orbital:[0,4,5,7,11],
      menu:[0,3,7,10,14]
    };
    this.scale=scales[key]||scales.blacksite;
    this.rootFreq=key==='menu'?55:key==='arctic'?61.74:key==='orbital'?73.42:49;
    this.schedule();
  }

  stopMusic(){
    this.stopTrack();
    this.stopSynthMusic();
  }

  stopSynthMusic(){
    this.musicOn=false;
    if(this.musicTimer){clearTimeout(this.musicTimer);this.musicTimer=null}
  }

  schedule(){
    if(!this.musicOn||!this.ctx)return;
    this.intensity+=(this.targetIntensity-this.intensity)*.16;
    const beat=60/(74+this.intensity*44)/2;
    this.playStep();
    this.step++;
    this.musicTimer=setTimeout(()=>this.schedule(),beat*1000);
  }

  playStep(){
    if(!this.ctx||this.settings.muted)return;
    const step=this.step,intensity=this.intensity;
    const bar=Math.floor(step/16)%4;
    const semitone=n=>this.rootFreq*Math.pow(2,n/12);

    // Bass pulse on every second sixteenth.
    if(step%2===0){
      const degree=this.scale[(bar*2+Math.floor(step/8))%this.scale.length];
      this.tone({
        freq:semitone(degree),type:'sawtooth',duration:.34,
        gain:.16+intensity*.1,bus:this.musicBus
      });
    }
    // Kick.
    if(step%8===0){
      this.tone({freq:130,endFreq:42,type:'sine',duration:.24,gain:.34,bus:this.musicBus});
    }
    // Hat, denser as intensity rises.
    if(step%2===1&&(intensity>.25||step%4===1)){
      this.noise({duration:.05,gain:.045+intensity*.05,freq:8000,filter:'highpass',bus:this.musicBus});
    }
    // Snare on the backbeat once the fight is on.
    if(intensity>.35&&step%8===4){
      this.noise({duration:.16,gain:.1+intensity*.07,freq:2400,endFreq:900,filter:'bandpass',q:.9,bus:this.musicBus});
    }
    // Sparse lead motif in the upper register.
    if(intensity>.55&&step%16===6){
      const degree=this.scale[(step/2+bar)%this.scale.length];
      this.tone({freq:semitone(degree+24),type:'triangle',duration:.5,gain:.07,bus:this.musicBus});
    }
    // Long pad swell at the top of each bar.
    if(step%32===0){
      this.tone({freq:semitone(this.scale[0]+12),type:'sine',duration:2.6,gain:.055,attack:.6,bus:this.musicBus});
      this.tone({freq:semitone(this.scale[2]+12),type:'sine',duration:2.6,gain:.04,attack:.8,bus:this.musicBus});
    }
  }
}

export const audio=new AudioEngine();

// Exposed for debugging and automated smoke tests, alongside window.__pp.
if(typeof window!=='undefined')window.__audio=audio;
