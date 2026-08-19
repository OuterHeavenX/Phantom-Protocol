import {clamp} from './math.js';

// Fully synthesized audio. The repository ships no audio assets, so every
// sound is generated at runtime from oscillators and shaped noise buffers.
// This keeps the project build-free and asset-free while still giving the
// game weapon reports, impacts, UI clicks and an adaptive music bed.
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
    this.ready=true;
    return Promise.resolve();
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

  startMusic(key='blacksite'){
    if(!this.ready||!this.ctx)return;
    this.stopMusic();
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
