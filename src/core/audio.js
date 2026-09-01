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
// Mix categories. Order is documentation, not priority — priority is in
// `CHANNEL_OF` and in what `alert` is exempted from.
const CHANNELS=['playerWeapon','enemyWeapon','impact','enemy','ambience','ui','alert'];

// Which category each sound belongs to. Anything unlisted lands on `impact`,
// which is the least surprising default: it is ducked under alerts and does not
// duck anything itself.
const CHANNEL_OF={
  weapon:'playerWeapon',enemyWeapon:'enemyWeapon',
  enemyDeath:'enemy',enemyAlert:'enemy',enemySpawn:'enemy',
  shoot:'playerWeapon',shootHeavy:'playerWeapon',laser:'playerWeapon',
  tech:'playerWeapon',scramble:'playerWeapon',reload:'playerWeapon',
  hit:'impact',crit:'impact',kill:'impact',explode:'impact',
  mechStep:'enemy',
  hurt:'alert',alarm:'alert',boss:'alert',shield:'alert',
  codec:'ui',select:'ui',type:'ui',confirm:'ui',deny:'ui',
  pickup:'ui',coin:'ui',heal:'ui',levelup:'ui',unlock:'ui',
  victory:'ui',defeat:'ui',dash:'playerWeapon'
};

// An alert briefly pushes these categories down so it can be heard through
// them. Short and shallow: this is making room, not stopping the fight.
const ALERT_DUCKS=['playerWeapon','enemyWeapon','impact','enemy','ambience'];

// Which categories the room answers, and how much of each relative to the
// theatre's own wet level.
//
// `ui` and `alert` are deliberately absent and must stay that way. A menu
// click does not happen in the sector, and a critical-health warning that
// arrives smeared in reflections is a warning the operative hears late — the
// whole bus topology exists so that cue is never degraded by anything.
//
// Ambience is sent at a trickle. It was recorded in the room already, in the
// sense that it *is* the room; sending it back into itself just makes it
// mushy.
const REVERB_SENDS={
  playerWeapon:1, enemyWeapon:1, impact:.9, enemy:.7, ambience:.18
};

// ---------------------------------------------------------------------------
// Weapon voices
//
// Thirty weapons used to share six sounds — nine of them played the same `tech`
// blip, and a submachine gun and an anti-materiel rifle were indistinguishable.
// A gunshot is not one sound; it is a stack of them arriving in a particular
// order, and which layers dominate is what tells the ear what fired.
//
//   mech      the action cycling — bolt, hammer, servo
//   crack     the initial transient, the part that carries across a sector
//   body      the weapon's own resonance, where calibre lives
//   pressure  low-frequency push, felt more than heard
//   tail      the room answering, which the environment scales
//
// A family is defined by proportion rather than by absolute level, so the mixer
// can move all of them together without any one losing its character.
// How hard a family hits, over and above its level.
//
// Punch is not volume. It scales the two layers the ear reads as force — the
// initial transient and the harmonic reinforcement under the body — so a heavy
// weapon can feel heavier than a submachine gun while sitting at a similar
// level in the mix. Raising volume instead would just make it mask the enemies.
const WEAPON_PUNCH={
  pistol:.9, suppressed:.45, rifle:1, smg:.75, shotgun:1.5, marksman:1.15,
  sniper:1.3, lmg:1.05, heavy:1.6, beam:.35, tech:.5, corrupted:1.1
};

// A phone speaker reproduces almost nothing below about 500Hz, so the `press`
// layer that gives these weapons their weight on headphones is simply absent
// on the device most people are playing this on.
//
// The fix is not more bass — the driver cannot move that air, and asking it to
// only produces distortion. It is the missing fundamental: given the harmonics
// of a low tone, the ear reconstructs a pitch that was never in the signal. A
// quiet partial an octave and a twelfth above the press layer puts the weight
// back on a small speaker, and on a good one it sits under the fundamental
// where it is very nearly inaudible.
const MISSING_FUNDAMENTAL={mult:2.02,gain:.42,duration:.72};

const WEAPON_VOICES={
  // Compact, sharp, quick to get out of the way.
  pistol:{crack:[2600,700,.26,.05],body:[340,120,.17,.07],press:[95,60,.12,.08],
          mech:[1800,.05,.03],tail:.14,spread:.05},
  // Mechanically loud and acoustically quiet: the action is most of what you
  // hear. Never a comedy "pew" — the crack is still there, just contained.
  suppressed:{crack:[1500,520,.1,.035],body:[260,150,.09,.05],press:[80,55,.07,.06],
              mech:[1300,.11,.05],tail:.05,spread:.04},
  // Aggressive mid crack with a tight bass push under it.
  rifle:{crack:[3000,780,.34,.055],body:[420,150,.2,.085],press:[78,48,.2,.11],
         mech:[1600,.07,.04],tail:.2,spread:.05},
  // Lighter report, rhythm does the work.
  smg:{crack:[3200,900,.24,.04],body:[500,210,.13,.05],press:[110,70,.09,.06],
       mech:[2000,.09,.035],tail:.12,spread:.07},
  // Violent pressure first, body second, mechanical afterthought.
  shotgun:{crack:[1500,380,.34,.075],body:[190,70,.34,.16],press:[54,34,.32,.2],
           mech:[900,.09,.09],tail:.3,spread:.05},
  // Deliberate. Long tail, deep body, very sharp leading edge.
  marksman:{crack:[3400,820,.36,.06],body:[300,110,.24,.12],press:[64,40,.24,.15],
            mech:[1400,.08,.06],tail:.34,spread:.03},
  sniper:{crack:[4200,900,.42,.065],body:[240,86,.28,.16],press:[50,32,.3,.24],
          mech:[1200,.08,.07],tail:.5,spread:.02},
  // Sustained mechanical violence, deliberately held back in level so a long
  // burst does not become fatiguing.
  lmg:{crack:[2800,700,.3,.05],body:[360,130,.22,.1],press:[62,40,.24,.14],
       mech:[1100,.12,.05],tail:.24,spread:.06},
  heavy:{crack:[1200,300,.36,.09],body:[150,58,.36,.2],press:[44,28,.38,.26],
         mech:[700,.14,.11],tail:.4,spread:.04},
  // Not ballistic: no pressure wave, no mechanical action worth hearing.
  beam:{crack:[2100,620,.2,.09],body:[900,320,.2,.13],press:[150,90,.07,.09],
        mech:[0,0,0],tail:.16,spread:.06},
  tech:{crack:[1700,900,.15,.05],body:[760,1400,.14,.1],press:[180,120,.05,.07],
        mech:[2600,.05,.03],tail:.1,spread:.09},
  // The signal getting into the weapon. Detuned, wrong, still a gunshot.
  corrupted:{crack:[2300,410,.28,.07],body:[330,660,.2,.14],press:[70,110,.2,.16],
             mech:[1500,.08,.05],tail:.26,spread:.14}
};
// How a hostile sounds when it stops, notices you, or arrives.
//
// Twenty-three archetypes shared one death sound between them, so a crawler at
// your ankles and an Aegis Warden ended identically and the sector told you
// nothing about what had just happened in it.
//
// Each chassis is described by what it is made of rather than by a list of
// samples, and the three events read the same fields — so a chassis is one
// entry, not three, and a new one cannot arrive half-defined.
//
//   fall    the pitch a dying thing slides down, in Hz: [from, to, seconds]
//   timbre  the oscillator that carries it. Organic things are not square.
//   body    the mass hitting the deck: [centre Hz, gain, seconds]
//   debris  what comes off it afterwards: [centre Hz, gain, seconds]
//   note    the alert: what it says when it sees you, [from, to, seconds]
//   arrive  gain of the spawn cue, 0 for anything that should arrive silently
const CHASSIS_VOICES={
  // Meat and webbing. A cry cut short, then gear on the floor.
  infantry:{fall:[300,120,.26],timbre:'sawtooth',body:[190,.22,.16],
    debris:[1400,.1,.12],note:[430,620,.13],arrive:0},
  // Same shape, lower and longer, with much more metal in it.
  heavy:{fall:[190,74,.4],timbre:'sawtooth',body:[110,.3,.28],
    debris:[900,.16,.22],note:[280,380,.18],arrive:.22},
  // No voice at all. A rotor unspooling and the electronics letting go.
  drone:{fall:[1300,150,.34],timbre:'square',body:[240,.16,.14],
    debris:[3000,.13,.09],note:[880,1320,.1],arrive:.3},
  // Small, fast and mechanically nasty. Chitters rather than falls.
  swarm:{fall:[1700,520,.14],timbre:'triangle',body:[420,.12,.08],
    debris:[2600,.11,.07],note:[1500,1900,.07],arrive:0},
  // Servos losing pressure, then a lot of weight arriving at once.
  walker:{fall:[420,90,.52],timbre:'sawtooth',body:[74,.36,.42],
    debris:[700,.2,.3],note:[320,240,.24],arrive:.34},
  // A hull opening up. Long, deep, and nothing sharp in it anywhere.
  armour:{fall:[210,44,.75],timbre:'sawtooth',body:[52,.42,.6],
    debris:[520,.24,.44],note:[150,116,.34],arrive:.4},
  // Detuned against itself on the way out, which is the tell that it was
  // never quite a physical object.
  synthetic:{fall:[760,180,.3],timbre:'square',body:[300,.14,.18],
    debris:[2200,.12,.16],note:[640,470,.15],arrive:.26}
};

// What makes a shot read as *incoming* rather than outgoing.
//
// Deliberately not a second table of twelve families. A rifle is a rifle
// whoever is holding it, and a parallel set of enemy voices would only
// guarantee the two drift apart the first time one of them is tuned. What tells
// the ear somebody else fired is the same thing that tells it in the real
// world: the shot has crossed some ground to reach you, and ground takes the
// top off the transient, removes the mechanical detail entirely — you never
// hear another man's bolt — and hands back more of the room instead.
//
// Applied on top of whichever family the hostile carries, so a hostile sniper
// still sounds like a sniper and still sounds like it is pointed at you.
const INCOMING={crackGain:.62,crackFreq:.72,mech:0,tail:1.7};

// name -> [how much of the score to take, how long to hold it there]
// Deliberately shallow. The resting level came down at the same time, and the
// two multiply — a deep duck on top of a quieter score left the music at about
// a seventh of what it was, which is not "mixed under the weapons", it is off.
const DUCKING={
  weapon:[.22,.12],mechStep:[.24,.2],shoot:[.2,.1],shootHeavy:[.28,.16],laser:[.22,.14],scramble:[.2,.14],
  explode:[.42,.3],boss:[.5,.9],hurt:[.3,.24],victory:[.55,1],defeat:[.55,1],
  // Shallower than the operative's own weapon and held for less time. There is
  // one of you and there can be thirty of them, so a duck sized for your rifle
  // would leave the score pinned flat for the length of every firefight.
  enemyWeapon:[.14,.09]
};

// How far a gunship overhead pushes the score down, at its closest.
//
// The table above cannot express this. Every entry in it is an event: a pull
// of some depth, a hold of some length, and then a release, which is the right
// shape for something ninety milliseconds long. A rotor is audible for the
// whole flyover — often half a minute — so driving it through `duckMusic` on
// every frame would just pin the score down for the duration and leave
// `relaxDuck` fighting the retrigger the entire time.
//
// So the rotor gets the other kind of duck: a continuous one, held at a depth
// that follows how close the helicopter is. It takes less than a rifle does at
// full depth, because it takes it for a thousand times longer.
const ROTOR_DUCK=.35;
// Seconds for the score to come back once the gunship starts leaving. The pull
// down is immediate and the lift is eased, which is the same asymmetry the
// event duck has and is there for the same reason — room has to exist before
// the sound needs it, and a gunship passing behind a ridgeline should not make
// the music surge.
const ROTOR_DUCK_RELEASE=1.6;
// Seconds of overlap when a track loops back on itself. An authored piece is a
// few minutes long and a contract can run thirty, so the seam is heard ten
// times or more in one run — `element.loop` jumps from the last sample to the
// first with nothing in between, which is the abrupt end-and-restart. Two
// elements per track playing the same file let the tail be faded into the head
// instead, which is the one thing a single media element cannot do.
const LOOP_FADE=2.4;
export class AudioEngine{
  constructor(settings={}){
    this.ctx=null;
    this.ready=false;
    this.settings={master:1,music:.38,sfx:1,muted:false,...settings};
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

    // Category buses.
    //
    // Everything used to arrive on one effects bus, which meant the mix had no
    // way to prefer one kind of sound over another: a wave of impacts and the
    // one cue telling the operative a sniper had them were the same to it.
    // Each category now has its own gain, so priority is something the mixer
    // can act on rather than something each call site has to guess at.
    //
    // `alert` is deliberately outside the ducking below. A critical-health
    // warning or a boss telegraph must never be attenuated by the thing that
    // made it urgent — that is the one rule this whole topology exists for.
    this.channels={};
    for(const name of CHANNELS){
      const gain=this.ctx.createGain();
      gain.gain.value=1;
      gain.connect(this.sfxBus);
      this.channels[name]=gain;
    }

    // Punch compression, on the operative's weapon bus and nowhere else.
    //
    // The attack is deliberately slow enough to let the shot's leading edge
    // through before the gain reduction arrives, and the release fast enough to
    // recover between rounds. That combination is what a compressor is actually
    // for here: it does not make the weapon louder, it makes the transient
    // stand further above its own body, which is the thing the ear reads as
    // force. A ratio this gentle also stops a long burst from climbing over the
    // rest of the mix.
    //
    // Deliberately not on the master. The limiter there protects the whole bus
    // from clipping and must stay transparent; processing everything to make
    // one category hit harder is how a mix ends up flat.
    this.channels.playerWeapon.disconnect();
    this.weaponPunch=this.ctx.createDynamicsCompressor();
    this.weaponPunch.threshold.value=-20;
    this.weaponPunch.knee.value=7;
    this.weaponPunch.ratio.value=2.6;
    this.weaponPunch.attack.value=.007;
    this.weaponPunch.release.value=.11;
    this.channels.playerWeapon.connect(this.weaponPunch);
    this.weaponPunch.connect(this.sfxBus);

    // A limiter stops dense firefights from clipping. It used to sit at -14dB
    // with an 8:1 ratio, which is not gentle: in a real firefight the bus is
    // over that threshold continuously, so every shot was squashed by the one
    // before it and the weapon stopped being audible at exactly the moment it
    // mattered. Held below clipping without flattening the thing it protects.
    this.limiter=this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value=-6;
    this.limiter.knee.value=8;
    this.limiter.ratio.value=3.5;
    this.limiter.attack.value=.004;
    this.limiter.release.value=.16;
    this.sfxBus.connect(this.limiter);
    this.limiter.connect(this.master);

    this.musicBus=this.ctx.createGain();
    this.musicBus.gain.value=this.settings.music;
    // Music runs through a duck that the combat sounds pull down. The score and
    // the weapons were competing for the same space with nothing arbitrating
    // between them, and the score won because it is continuous while a gunshot
    // is ninety milliseconds long. Turning the music down everywhere would have
    // paid for that with a dead sector between fights; this only takes it back
    // while something is actually shooting.
    this.musicDuck=this.ctx.createGain();
    this.musicDuck.gain.value=1;
    this.musicBus.connect(this.musicDuck);
    this.musicDuck.connect(this.master);

    this.buildReverb();

    this.buildNoise();
    this.watchContext();
    this.ready=true;
    return Promise.resolve();
  }

  // ---- Reverb --------------------------------------------------------------
  //
  // A parallel send, built once and never rebuilt.
  //
  //   channels[n] ─┬─────────────────────────────────→ sfxBus        (dry)
  //                └→ send[n] → predelay → convolver → damp → return (wet)
  //
  // The dry path is untouched, which is the whole reason for doing it this way:
  // every level, duck and throttle tuned over the last passes still applies
  // exactly as before, and the room is added beside them rather than in front
  // of them. Switching theatre swaps one buffer and moves a few gains; nothing
  // is created per contract and nothing at all per frame.
  buildReverb(){
    const ctx=this.ctx;
    this.reverbSends={};

    this.reverbReturn=ctx.createGain();
    this.reverbReturn.gain.value=0;
    this.reverbReturn.connect(this.sfxBus);

    // Tail damping. Concrete and snow eat the top end, sheet metal does not,
    // and this is most of what makes two rooms of the same size sound
    // different.
    this.reverbDamp=ctx.createBiquadFilter();
    this.reverbDamp.type='lowpass';
    this.reverbDamp.frequency.value=3000;
    this.reverbDamp.connect(this.reverbReturn);

    this.convolver=ctx.createConvolver();
    this.convolver.normalize=true;
    this.convolver.connect(this.reverbDamp);

    // Pre-delay. A larger room takes longer to answer, and this gap is what
    // the ear actually reads as size — more reliably than tail length.
    this.reverbPredelay=ctx.createDelay(.2);
    this.reverbPredelay.delayTime.value=.01;
    this.reverbPredelay.connect(this.convolver);

    // Nothing below this is worth reverberating; it only makes the low end
    // muddy, which on a phone speaker is the difference between weight and
    // noise.
    this.reverbCut=ctx.createBiquadFilter();
    this.reverbCut.type='highpass';
    this.reverbCut.frequency.value=180;
    this.reverbCut.connect(this.reverbPredelay);

    for(const name in REVERB_SENDS){
      const bus=this.channels[name];
      if(!bus)continue;
      const send=ctx.createGain();
      send.gain.value=0;
      bus.connect(send);
      send.connect(this.reverbCut);
      this.reverbSends[name]=send;
    }
  }

  // A room, generated rather than loaded.
  //
  // Noise under an exponential decay is a serviceable diffuse tail; the early
  // reflections are added as discrete spikes on top, because hard parallel
  // surfaces produce distinct slaps and those are what separate a corridor
  // from a field. The two channels are decorrelated so the result has width.
  buildImpulse(profile){
    const ctx=this.ctx;
    const rate=ctx.sampleRate;
    const length=Math.max(1,Math.floor(rate*profile.decay));
    const buffer=ctx.createBuffer(2,length,rate);
    for(let ch=0;ch<2;ch++){
      const data=buffer.getChannelData(ch);
      for(let i=0;i<length;i++){
        const t=i/length;
        data[i]=(Math.random()*2-1)*Math.pow(1-t,profile.curve);
      }
      for(const [time,gain] of profile.early||[]){
        const index=Math.floor(time*rate);
        // Opposite signs per channel: the same slap arriving at both ears
        // identically collapses the image to the centre and reads as a
        // delay effect rather than as a room.
        if(index<length)data[index]+=gain*(ch?-1:1);
      }
    }
    return buffer;
  }

  // Put the mixer in a room, or take it out of one. `null` is dry.
  setReverbProfile(profile){
    if(!this.ready||!this.ctx||!this.convolver)return;
    const now=this.ctx.currentTime;
    if(!profile){
      this.reverbProfile=null;
      // Ramped down, then set to exactly zero.
      //
      // `setTargetAtTime` is exponential: it approaches a value and never
      // arrives at it. On its own it left a permanent residual send behind
      // after every contract — quiet, but a convolver still running and a
      // room still faintly answering menu sounds for the rest of the session.
      // The hard set lands at a fraction of an already quiet level, well below
      // anything audible, and guarantees the room is actually gone.
      const settled=now+.45;
      for(const name in this.reverbSends){
        const gain=this.reverbSends[name].gain;
        gain.setTargetAtTime(0,now,.12);
        gain.setValueAtTime(0,settled);
      }
      this.reverbReturn.gain.setTargetAtTime(0,now,.12);
      this.reverbReturn.gain.setValueAtTime(0,settled);
      return;
    }
    // Performance mode shortens the room rather than removing it. A convolver
    // costs in proportion to its impulse, and half a tail still tells the
    // operative where they are.
    const scale=this.settings.performanceMode?.55:1;
    const shaped={...profile,decay:Math.max(.08,profile.decay*scale)};
    this.reverbProfile=shaped;
    this.convolver.buffer=this.buildImpulse(shaped);
    this.reverbPredelay.delayTime.setTargetAtTime(profile.predelay,now,.05);
    this.reverbDamp.frequency.setTargetAtTime(profile.damping,now,.05);
    this.reverbReturn.gain.setTargetAtTime(1,now,.2);
    for(const name in this.reverbSends){
      this.reverbSends[name].gain.setTargetAtTime(
        profile.wet*(REVERB_SENDS[name]||0),now,.2);
    }
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
  // `essential` exempts a cue from the voice budget, not from mute or its own
  // throttle. The budget exists to stop a hundred simultaneous impacts turning
  // the mix to mush; a cue that tells the player something they cannot learn
  // any other way should not be the thing it drops.
  canPlay(name,throttle,{essential=false}={}){
    if(!this.ready||!this.ctx||this.settings.muted)return false;
    if(!essential&&this.voices>=this.maxVoices)return false;
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
    env.connect(bus||this.currentBus||this.sfxBus);
    osc.start(t);
    osc.stop(t+duration+.02);
    this.track(osc,duration+delay);
    return osc;
  }

  // `attack` matches `tone`'s. Every noise event used to open in four
  // milliseconds, which is correct for a gunshot or an impact and wrong for
  // anything that swells — a gust of wind or distant thunder given a four
  // millisecond edge does not read as weather, it reads as a gunshot with the
  // top rolled off.
  noise({duration=.2,gain=.3,delay=0,filter='lowpass',freq=1200,endFreq=null,q=1,attack=.004,bus=null}={}){
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
    // Clamped below the duration, or a long attack on a short event schedules
    // its peak after its own release and the sound never arrives at all.
    env.gain.exponentialRampToValueAtTime(Math.max(.0001,gain),t+Math.min(attack,duration*.9));
    env.gain.exponentialRampToValueAtTime(.0001,t+duration);
    src.connect(biquad);biquad.connect(env);env.connect(bus||this.currentBus||this.sfxBus);
    src.start(t);
    src.stop(t+duration+.02);
    this.track(src,duration+delay);
    return src;
  }

  // ---- Sound library -----------------------------------------------------

  // Where a sound should be routed, and the node to hand the helpers.
  channel(name){
    if(!this.channels)return null;
    return this.channels[CHANNEL_OF[name]||'impact']||null;
  }

  // Which bus an event goes out on.
  //
  // A sound is not owned by its name. `laser` is the operative's beam weapon
  // and it is also a boss's; `shootHeavy` is fired by both. Routing purely by
  // name put every one of those on the player's own bus, so the mixer had no
  // way to tell incoming from outgoing and the dedicated `enemyWeapon` channel
  // sat built, connected and completely unused. `hostile` is the override: the
  // caller knows who pulled the trigger, and nothing else does.
  busFor(name,options){
    if(options&&options.hostile&&this.channels?.enemyWeapon)return this.channels.enemyWeapon;
    return this.channel(name);
  }

  // Pull the noisy categories down for a moment so a cue can be heard through
  // them. Recovers on its own; nothing has to remember to put it back.
  duckChannels(names,amount=.45,hold=.18){
    if(!this.ready||!this.ctx||!this.channels)return;
    const now=this.ctx.currentTime;
    for(const name of names){
      const bus=this.channels[name];
      if(!bus)continue;
      bus.gain.cancelScheduledValues(now);
      // The attack is immediate and the release is a ramp, which is what a duck
      // is for: room has to be made *before* the cue arrives, not eased into
      // while it plays. Setting the value rather than scheduling it also makes
      // the attenuation observable, which a scheduled automation is not.
      bus.gain.value=1-clamp(amount,0,.9);
      bus.gain.setTargetAtTime(1,now+hold,.18);
    }
  }

  play(name,options={}){
    // The context only exists after the unlock gesture resolves, and unlock is
    // async — a click handler firing on that same first gesture would
    // otherwise reach the oscillator helpers with no context at all.
    if(!this.ready||!this.ctx)return;
    const volume=clamp(options.volume??1,0,1.5);

    // How far each kind of sound pushes the score out of the way. Weapon fire
    // is repetitive, so it takes a little and holds it; an explosion or a
    // signature arriving takes a lot.
    const duck=options.hostile?DUCKING.enemyWeapon:DUCKING[name];
    if(duck)this.duckMusic(duck[0],duck[1]);
    // An alert makes room for itself in the effects mix, not just in the music.
    if(CHANNEL_OF[name]==='alert')this.duckChannels(ALERT_DUCKS,.4,.22);
    // Routed once for the whole event rather than at every layer inside it.
    // `tone` and `noise` pick this up when no bus is passed explicitly, so a
    // sound made of five layers reaches its category without five arguments,
    // and a sound added later is routed without anyone remembering to.
    this.currentBus=this.busFor(name,options);
    // Every layer of the event is built synchronously inside the switch below,
    // so the routing only has to survive that. It is cleared straight after so
    // a helper called from anywhere else cannot inherit the last category used.
    try{return this.playEvent(name,volume,options)}finally{this.currentBus=null}
  }

  // One shot, assembled.
  //
  // `spread` is how far this family is allowed to wander round to round. It is
  // deliberately narrow: an automatic weapon that retriggers an identical event
  // sounds like a loop, and one that wanders too far sounds like a different
  // gun every round. Both are wrong, and the band between them is small.
  //
  // `tail` is scaled by the caller, which is how the same weapon comes out
  // tight in a corridor and long across open ground.
  weaponShot(voice,volume,options){
    const v=WEAPON_VOICES[voice]||WEAPON_VOICES.rifle;
    const wobble=1+(Math.random()*2-1)*(v.spread||.05);
    // Incoming fire is the same family seen from the other end. One shade
    // applied over every family, rather than a second set of voices to keep in
    // step with the first.
    const far=options.incoming?INCOMING:null;
    let tail=(v.tail||.15)*(options.tail??1)*(far?far.tail:1);

    const punch=(WEAPON_PUNCH[voice]??1)*(far?.55:1);

    // The snap: the first two milliseconds, above everything else in the shot.
    //
    // This is where "punch" actually lives. The ear judges force from the
    // leading edge, not from level — a shot with a hard transient reads as
    // violent at a volume where a shot without one reads as soft, which is why
    // this pass adds a layer rather than turning anything up. Short enough to
    // cost almost nothing against the voice budget.
    if(punch>.4){
      this.noise({duration:.022,gain:.16*punch*volume,freq:5200*wobble,
        endFreq:2600,filter:'highpass',attack:.0012});
    }

    const [ct,ce,cg,cd]=v.crack;
    this.noise({duration:cd,gain:cg*volume*(far?far.crackGain:1),
      freq:ct*wobble*(far?far.crackFreq:1),endFreq:ce*(far?far.crackFreq:1),
      filter:'bandpass',q:1.1});

    const [bt,be,bg,bd]=v.body;
    this.tone({freq:bt*wobble,endFreq:be,type:'sawtooth',duration:bd,
      gain:bg*volume});

    const [pt,pe,pg,pd]=v.press;
    if(pg>0)this.tone({freq:pt,endFreq:pe,type:'sine',duration:pd,gain:pg*volume});

    // Harmonic reinforcement of that press layer, so the weight survives a
    // phone speaker. Gated on families that have low end worth reinforcing —
    // a beam has no pressure wave to reconstruct, and adding a partial to one
    // would be inventing weight the weapon is not supposed to have.
    //
    // Detuned very slightly sharp of the exact octave: an exact multiple fuses
    // with the fundamental and reads as the same tone slightly louder, which
    // is the thing this is trying not to be.
    if(pg>=.15&&!far){
      this.tone({freq:pt*MISSING_FUNDAMENTAL.mult,endFreq:pe*MISSING_FUNDAMENTAL.mult,
        type:'triangle',duration:pd*MISSING_FUNDAMENTAL.duration,
        gain:pg*volume*MISSING_FUNDAMENTAL.gain*punch});
    }

    // The action. Offset a little so it reads as a separate mechanical event
    // rather than as part of the report.
    const [mf,mg,md]=v.mech;
    if(mg>0&&!far){
      this.noise({duration:md,gain:mg*volume,freq:mf*wobble,endFreq:mf*.5,
        filter:'bandpass',q:2.4,delay:.012});
    }

    // The room answering.
    //
    // This layer was always a stand-in for a room the mixer did not have. It
    // now has one, so where a convolved theatre is active the synthetic tail is
    // pulled most of the way down: leaving both in place reverberates every
    // shot twice, which smears exactly the transient the rest of this pass was
    // spent sharpening. It is not removed outright — a little of it still
    // belongs to the weapon rather than to the room, and it is what the shot
    // falls back on in a theatre with no profile.
    //
    // It is also the longest-lived layer in the shot, so standing down here is
    // what pays for the two layers added above against the voice budget.
    const roomed=this.reverbProfile?.wet>0;
    if(roomed)tail*=.34;
    if(tail>.02){
      this.noise({duration:tail,gain:cg*volume*.3*(far?far.crackGain:1),
        freq:700,endFreq:180,filter:'lowpass',delay:.02});
    }
  }

  playEvent(name,volume,options){
    switch(name){
      // Every firearm arrives here. `voice` names the family; the weapon
      // registry decides which one, so a new weapon is a data change.
      case 'weapon':{
        const voice=options.voice||'rifle';
        // Throttled per family rather than globally, so a pistol and a rifle
        // firing together do not silence one another.
        if(!this.canPlay('weapon:'+voice,options.throttle??.028))return;
        this.weaponShot(voice,volume,options);
        break;
      }
      // Hostile fire. Same layer machinery as the operative's own weapon and
      // the same family table, shaded to read as incoming.
      case 'enemyWeapon':{
        const voice=options.voice||'rifle';
        // Throttled per family, and looser than the player's: thirty hostiles
        // firing at once is normal, and the throttle is what stops that from
        // turning into a wall of noise with no shape to it.
        if(!this.canPlay('enemyWeapon:'+voice,options.throttle??.045))return;
        this.weaponShot(voice,volume,{...options,incoming:true});
        break;
      }
      // A hostile stopping. Three layers: what it was, the mass of it arriving
      // on the deck, and what came off it afterwards.
      case 'enemyDeath':{
        const v=CHASSIS_VOICES[options.chassis]||CHASSIS_VOICES.infantry;
        // Throttled per chassis rather than globally. A wave dying together
        // should thin out, but a walker going down in the middle of it must not
        // be the sound that gets dropped.
        if(!this.canPlay('enemyDeath:'+options.chassis,options.throttle??.05))return;
        const wobble=.9+Math.random()*.2;
        const [from,to,dur]=v.fall;
        this.tone({freq:from*wobble,endFreq:to,type:v.timbre,duration:dur,
          gain:.26*volume});
        const [bf,bg,bd]=v.body;
        this.noise({duration:bd,gain:bg*volume,freq:bf*wobble,endFreq:bf*.4,
          filter:'lowpass',attack:.01});
        const [df,dg,dd]=v.debris;
        this.noise({duration:dd,gain:dg*volume,freq:df*wobble,endFreq:df*.35,
          filter:'bandpass',q:1.6,delay:dur*.5});
        break;
      }
      // The moment it has you. Short and pitched clear of the weapon families,
      // because this has to cut through fire rather than sit inside it.
      case 'enemyAlert':{
        const v=CHASSIS_VOICES[options.chassis]||CHASSIS_VOICES.infantry;
        if(!this.canPlay('enemyAlert:'+options.chassis,options.throttle??.4))return;
        const [from,to,dur]=v.note;
        const wobble=.94+Math.random()*.12;
        this.tone({freq:from*wobble,endFreq:to,type:v.timbre,duration:dur,
          gain:.2*volume,attack:.012});
        this.noise({duration:dur*.6,gain:.07*volume,freq:from*2,
          filter:'bandpass',q:2.2});
        break;
      }
      // Arrival. Deliberately not universal: `arrive` is zero for infantry and
      // swarms, because twenty of them entering at once is the one case where
      // a cue per unit becomes noise instead of information. What is left is
      // the arrival of something big enough to be worth turning around for.
      case 'enemySpawn':{
        const v=CHASSIS_VOICES[options.chassis]||CHASSIS_VOICES.infantry;
        if(!v.arrive)return;
        if(!this.canPlay('enemySpawn:'+options.chassis,options.throttle??.55))return;
        const [from,to]=v.note;
        this.tone({freq:to*.5,endFreq:from*.5,type:v.timbre,duration:.26,
          gain:.16*volume*v.arrive,attack:.06});
        this.noise({duration:.3,gain:.1*volume*v.arrive,freq:from,endFreq:from*.4,
          filter:'lowpass',attack:.05});
        break;
      }
      case 'shoot':
        if(!this.canPlay('shoot',.035))return;
        // The operative's own weapon, reported as barely audible on a phone
        // over the score — and it was the quietest thing in the mix by a way.
        this.noise({duration:.09,gain:.3*volume,freq:2600,endFreq:600,filter:'bandpass',q:1.1});
        this.tone({freq:340,endFreq:110,type:'square',duration:.075,gain:.15*volume});
        break;
      // A machine the size of a room putting a foot down. Two halves: the
      // hydraulic release on the way down, and the mass landing. `weight`
      // scales both the pitch and the body, so a light walker ticks and a
      // siege platform thumps, from one sound rather than four.
      case 'mechStep':{
        const weight=clamp(options.weight??1,.4,2);
        const bass=48/weight;
        this.tone({freq:bass*2.4,endFreq:bass,type:'sine',
          duration:.16*weight,gain:.34*volume});
        this.noise({duration:.11*weight,gain:.2*volume,
          freq:900/weight,endFreq:130,filter:'lowpass'});
        // Servo whine as the limb unloads, which is what makes it read as a
        // machine rather than a rock falling over.
        this.tone({freq:1500/weight,endFreq:2300/weight,type:'sawtooth',
          duration:.09,gain:.035*volume,delay:.02});
        break;
      }
      case 'shootHeavy':
        if(!this.canPlay('shootHeavy',.06))return;
        this.noise({duration:.2,gain:.4*volume,freq:1500,endFreq:180,filter:'lowpass'});
        this.tone({freq:180,endFreq:52,type:'sawtooth',duration:.18,gain:.26*volume});
        break;
      case 'laser':
        if(!this.canPlay('laser',.05))return;
        this.tone({freq:1500,endFreq:320,type:'sawtooth',duration:.17,gain:.19*volume});
        this.tone({freq:2400,endFreq:700,type:'sine',duration:.12,gain:.1*volume});
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
      // A dry key click under typed briefing dialogue. Deliberately near the
      // floor and throttled hard: it is a texture under the reading, and a
      // per-character tick at any real volume is unbearable within a sentence.
      case 'type':
        if(!this.canPlay('type',.032))return;
        this.noise({duration:.016,gain:.022*volume,freq:2400,filter:'bandpass',q:2.2});
        break;
      case 'confirm':
        this.tone({freq:520,endFreq:880,type:'square',duration:.12,gain:.09*volume});
        break;
      case 'deny':
        this.tone({freq:220,endFreq:120,type:'square',duration:.18,gain:.1*volume});
        break;
      // The codec opening: two clean tones and a breath of carrier hiss, the
      // sound a channel makes when somebody keys it.
      case 'codec':
        // Essential: a transmission opening during a firefight is exactly when
        // the voice budget is full, and exactly when the callout matters most.
        // Levelled with the other interface cues — a shade under 'confirm' —
        // rather than the near-silence it shipped at.
        if(!this.canPlay('codec',.12,{essential:true}))return;
        this.tone({freq:1180,type:'square',duration:.045,gain:.1*volume});
        this.tone({freq:1570,type:'square',duration:.06,gain:.09*volume,delay:.055});
        this.noise({duration:.09,gain:.028*volume,freq:3200,filter:'bandpass',q:1.4,delay:.02});
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
    const base=this.settings.muted?0:clamp(this.settings.master*this.settings.music,0,1);
    return base*this.musicDuckLevel;
  }

  // The score answers to two ducks at once: the event duck that gunfire pulls
  // and lets go of, and the continuous one the rotor holds for as long as a
  // gunship is overhead. It takes whichever is deeper rather than multiplying
  // them, so a firefight underneath a helicopter does not stack into silence.
  get musicDuckLevel(){
    return Math.min(this.duck??1,this.rotorDuck??1);
  }

  // ---- Ambience ----------------------------------------------------------
  //
  // The bed a theatre sits on. Continuous like the rotor and built the same
  // way — nodes held directly rather than pushed through `tone`/`noise`, which
  // exist for one-shots and would count a permanent voice against the budget
  // forever.
  //
  // The intermittent events do go through the one-shot helpers, because that is
  // exactly what they are.
  startAmbience(profile){
    if(!this.ready||!this.ctx||this.ambience)return;
    if(!profile)return;
    const ctx=this.ctx;
    const out=ctx.createGain();
    out.gain.value=0;
    out.connect(this.channels?.ambience||this.sfxBus);

    const parts=[];

    // Air. Broadband noise through a drifting filter.
    if(profile.air){
      const a=profile.air;
      const src=ctx.createBufferSource();
      src.buffer=this.noiseBuffer;
      src.loop=true;
      const filter=ctx.createBiquadFilter();
      filter.type=a.filter||'lowpass';
      filter.frequency.value=a.freq;
      filter.Q.value=a.q||.5;
      const gain=ctx.createGain();
      gain.gain.value=a.gain;
      src.connect(filter);filter.connect(gain);gain.connect(out);

      // The drift. Without it the noise is stationary, and stationary noise
      // stops reading as an environment within about ten seconds — the ear
      // files it as circuit hiss and then ignores it completely.
      let drift=null;
      if(a.drift){
        const [rate,depth]=a.drift;
        drift=ctx.createOscillator();
        drift.frequency.value=rate;
        const depthGain=ctx.createGain();
        depthGain.gain.value=depth;
        drift.connect(depthGain);
        depthGain.connect(filter.frequency);
        drift.start();
      }
      src.start();
      parts.push(src);
      if(drift)parts.push(drift);
    }

    // Hum. Whether the place still has power.
    if(profile.hum){
      const h=profile.hum;
      const osc=ctx.createOscillator();
      osc.type=h.type||'sine';
      osc.frequency.value=h.freq;
      const gain=ctx.createGain();
      gain.gain.value=h.gain;
      const lp=ctx.createBiquadFilter();
      lp.type='lowpass';
      lp.frequency.value=h.freq*4;
      osc.connect(lp);lp.connect(gain);gain.connect(out);
      osc.start();
      parts.push(osc);
    }

    this.ambience={out,parts,timers:[]};
    // Faded in rather than switched on. A bed that appears at full level on the
    // first frame of a contract is heard as a glitch, which is the opposite of
    // what a bed is for.
    out.gain.setTargetAtTime(1,ctx.currentTime,1.2);

    for(const event of profile.events||[])this.scheduleAmbientEvent(event);
  }

  // One event, rescheduling itself. Each occurrence picks its own next gap, so
  // the pattern never settles into a rhythm the ear can predict.
  scheduleAmbientEvent(event){
    if(!this.ambience)return;
    const [min,max]=event.every;
    const delay=(min+Math.random()*(max-min))*1000;
    const timer=setTimeout(()=>{
      // Checked again on firing, not only on scheduling: the contract can end
      // inside the gap, and a stale timer would put a drip over the results
      // screen.
      if(!this.ambience)return;
      this.ambientEvent(event.sound,event.gain??.5);
      this.scheduleAmbientEvent(event);
    },delay);
    this.ambience.timers.push(timer);
  }

  // The event shapes themselves. Small, cheap, and deliberately not weapons —
  // nothing here has a transient sharp enough to be mistaken for gunfire.
  ambientEvent(sound,gain){
    if(!this.ready||!this.ctx)return;
    const bus=this.channels?.ambience||this.sfxBus;
    const wobble=.8+Math.random()*.4;
    switch(sound){
      case 'drip':
        this.tone({freq:900*wobble,endFreq:260,type:'sine',duration:.14,
          gain:.2*gain,bus});
        break;
      case 'arc':
        this.noise({duration:.07,gain:.24*gain,freq:3200*wobble,endFreq:1400,
          filter:'bandpass',q:3,bus});
        this.noise({duration:.03,gain:.14*gain,freq:5200,filter:'highpass',
          delay:.05,bus});
        break;
      case 'gust':
        // Long and slow. A gust is a change in the wind, so it is shaped like
        // one rather than struck like a note.
        this.noise({duration:2.4*wobble,gain:.3*gain,freq:700,endFreq:300,
          filter:'bandpass',q:.7,attack:.9,bus});
        break;
      case 'iceCrack':
        this.noise({duration:.11,gain:.26*gain,freq:1800*wobble,endFreq:420,
          filter:'bandpass',q:2.2,bus});
        this.tone({freq:180*wobble,endFreq:70,type:'triangle',duration:.22,
          gain:.12*gain,delay:.02,bus});
        break;
      case 'groan':
        // Metal under load. Detuned against itself, which is most of why it
        // sounds like stress rather than like a note.
        this.tone({freq:104*wobble,endFreq:88,type:'sawtooth',duration:1.6,
          gain:.1*gain,attack:.5,bus});
        this.tone({freq:107*wobble,endFreq:90,type:'sawtooth',duration:1.5,
          gain:.07*gain,attack:.6,detune:14,bus});
        break;
      case 'creak':
        this.tone({freq:420*wobble,endFreq:250,type:'triangle',duration:.5,
          gain:.1*gain,attack:.14,bus});
        break;
      case 'emberPop':
        this.noise({duration:.05,gain:.2*gain,freq:1500*wobble,endFreq:600,
          filter:'bandpass',q:2,bus});
        break;
      case 'boom':
        // Distant. No top end at all — that is the entire reason it reads as
        // far away rather than as something happening to you.
        this.noise({duration:1.1,gain:.3*gain,freq:150,endFreq:50,
          filter:'lowpass',attack:.12,bus});
        break;
      default:
        break;
    }
  }

  stopAmbience(){
    if(!this.ambience)return;
    const a=this.ambience;
    // Cleared before anything else. A timer that fires between the fade
    // starting and the nodes stopping would schedule the next one against an
    // ambience that no longer exists.
    this.ambience=null;
    for(const timer of a.timers)clearTimeout(timer);
    try{
      a.out.gain.setTargetAtTime(0,this.ctx.currentTime,.4);
      // Stopped, not merely faded. A gain ramp is a promise about a value and
      // says nothing about the oscillators behind it, which run until somebody
      // stops them.
      const stopAt=this.ctx.currentTime+2;
      for(const part of a.parts)part.stop(stopAt);
    }catch{/* already stopped */}
  }

  // ---- Rotor -------------------------------------------------------------
  //
  // A helicopter is a continuous sound, not an event, so it cannot be one of
  // the one-shots above: it is a voice that is started when the first gunship
  // arrives and stopped when the last one leaves.
  //
  // Filtered noise for the wash, amplitude-modulated by an oscillator for the
  // blade chop, plus a low tone for the turbine underneath. The chop rate is
  // what the ear identifies as a helicopter — everything else is texture.
  startRotor(){
    if(!this.ready||!this.ctx||this.rotor)return;
    const ctx=this.ctx;
    const out=ctx.createGain();
    out.gain.value=0;
    out.connect(this.channels?.enemy||this.sfxBus);

    // Blade wash.
    const src=ctx.createBufferSource();
    src.buffer=this.noiseBuffer;
    src.loop=true;
    const band=ctx.createBiquadFilter();
    band.type='bandpass';
    band.frequency.value=440;
    band.Q.value=.8;

    // The chop. A sine at blade-passing rate, offset so it never fully closes
    // — a rotor thumps, it does not stutter.
    const chopDepth=ctx.createGain();
    chopDepth.gain.value=.62;
    const chopFloor=ctx.createGain();
    chopFloor.gain.value=.38;
    const lfo=ctx.createOscillator();
    lfo.type='sine';
    lfo.frequency.value=13;
    const lfoGain=ctx.createGain();
    lfoGain.gain.value=1;
    lfo.connect(lfoGain);
    lfoGain.connect(chopDepth.gain);

    src.connect(band);
    band.connect(chopDepth);
    band.connect(chopFloor);
    chopDepth.connect(out);
    chopFloor.connect(out);

    // Turbine.
    const turbine=ctx.createOscillator();
    turbine.type='sawtooth';
    turbine.frequency.value=96;
    const turbineFilter=ctx.createBiquadFilter();
    turbineFilter.type='lowpass';
    turbineFilter.frequency.value=340;
    const turbineGain=ctx.createGain();
    turbineGain.gain.value=.1;
    turbine.connect(turbineFilter);
    turbineFilter.connect(turbineGain);
    turbineGain.connect(out);

    src.start();lfo.start();turbine.start();
    this.rotor={out,src,lfo,turbine,level:0};
  }

  // `level` is 0 when nothing is airborne and rises as the nearest gunship
  // closes, so the rotor announces itself before the shooting starts.
  setRotor(level){
    if(!this.ready||!this.ctx)return;
    const target=clamp(level,0,1);
    // Before the branches, so the score is let back up on the same frames the
    // rotor is fading out — including the ones that return early below.
    this.updateRotorDuck(target);
    if(target<=0){
      if(!this.rotor)return;
      this.rotor.out.gain.setTargetAtTime(0,this.ctx.currentTime,.25);
      // Torn down rather than left fading, once nothing has been airborne for
      // long enough that the fade is certainly finished. A gain ramp is a
      // promise about a value, not about the oscillators behind it — those go
      // on running until something stops them.
      this.rotorSilentSince=this.rotorSilentSince||performance.now();
      if(performance.now()-this.rotorSilentSince>1500)this.stopRotor();
      return;
    }
    this.rotorSilentSince=0;
    if(!this.rotor)this.startRotor();
    if(!this.rotor)return;
    // Halved after hearing it on a phone: at .5 the rotor sat on top of the
    // firefight rather than under it. A helicopter is meant to be felt across
    // the sector, not to be the loudest thing in it.
    this.rotor.out.gain.setTargetAtTime(target*.25,this.ctx.currentTime,.18);
    // Blades speed up a little as it bears down, which reads as approach even
    // when the level is holding steady.
    this.rotor.lfo.frequency.setTargetAtTime(11+target*5,this.ctx.currentTime,.4);
  }

  // The rotor's side-chain on the music. Called from `setRotor`, so it tracks
  // the same distance the rotor's own gain does and cannot drift out of step
  // with what is actually audible.
  //
  // Timed off the wall clock rather than a passed-in delta: this is driven from
  // the render loop, whose frame length is not the simulation's fixed step, and
  // a release measured in seconds should mean seconds however fast the game is
  // drawing. The clamp keeps a backgrounded tab, which stops delivering frames
  // entirely, from returning to a five-second gap and snapping the score back
  // in one jump.
  updateRotorDuck(level){
    const now=performance.now();
    const elapsed=this.rotorDuckAt?Math.min((now-this.rotorDuckAt)/1000,.25):0;
    this.rotorDuckAt=now;

    const current=this.rotorDuck??1;
    const target=1-clamp(level,0,1)*ROTOR_DUCK;
    let next=target<current
      ? target
      : Math.min(target,current+ROTOR_DUCK_RELEASE*elapsed);
    // Settle exactly, or the last fraction of the lift is spent below full
    // volume forever and the score never quite comes back.
    if(next>.998)next=1;

    this.rotorDuck=next;
    // Only when it moved enough to hear. This runs every frame, and each call
    // schedules automation on the music gain and writes every <audio> element's
    // volume; doing that for a change of a thousandth is work with no audible
    // result.
    if(Math.abs(next-current)>.002)this.applyDuck();
  }

  stopRotor(){
    if(!this.rotor)return;
    const r=this.rotor;
    this.rotor=null;
    // Released here and not only in `updateRotorDuck`, because the engine can
    // tear the rotor down directly at the end of a contract. Nothing would call
    // `setRotor` again afterwards, so the score would stay held down under a
    // helicopter that no longer exists.
    this.rotorDuck=1;
    this.rotorDuckAt=0;
    this.applyDuck();
    try{
      r.out.gain.setTargetAtTime(0,this.ctx.currentTime,.2);
      const stopAt=this.ctx.currentTime+1.2;
      r.src.stop(stopAt);r.lfo.stop(stopAt);r.turbine.stop(stopAt);
    }catch{/* already stopped */}
  }

  // ---- Ducking -----------------------------------------------------------
  //
  // Combat pulls the score down for as long as it lasts and lets it back up
  // afterwards. Reported from an iPhone: the music was too loud and the bullets
  // could barely be heard, which is one problem and not two — the score is
  // continuous and a gunshot is ninety milliseconds long, so with nothing
  // arbitrating between them the score simply wins.
  //
  // It has to be done twice, because the music arrives by two different roads.
  // The authored tracks are <audio> elements that were deliberately kept out of
  // the AudioContext (an element adopted by a suspended context freezes), so
  // they are ducked through their own volume; the synthesized bed is in the
  // graph and is ducked with a gain node.
  duckMusic(amount=.4,hold=.12){
    if(!this.ready)return;
    this.duck=Math.min(this.duck??1,1-clamp(amount,0,.85));
    this.duckHeldUntil=performance.now()+hold*1000;
    if(!this.duckTimer)this.duckTimer=setInterval(()=>this.relaxDuck(),40);
    this.applyDuck();
  }

  relaxDuck(){
    // Held flat while the shooting continues, then back up over about a second
    // — fast enough to hear the score return between engagements, slow enough
    // that a pause in fire does not make it surge.
    if(performance.now()<this.duckHeldUntil)return;
    this.duck=Math.min(1,(this.duck??1)+.06);
    this.applyDuck();
    if(this.duck>=1){clearInterval(this.duckTimer);this.duckTimer=null}
  }

  applyDuck(){
    const level=this.musicDuckLevel;
    if(this.musicDuck&&this.ctx){
      this.musicDuck.gain.setTargetAtTime(level,this.ctx.currentTime,.03);
    }
    for(const entry of (this.trackNodes||new Map()).values())this.applyTrackVolume(entry);
  }

  // One <audio> element per track, kept for the session so a redeployment
  // reuses the element (and whatever it has already buffered) instead of
  // starting the download again.
  trackNode(track){
    this.trackNodes=this.trackNodes||new Map();
    let entry=this.trackNodes.get(track.file);
    if(entry)return entry;

    // Two elements on the same file: one playing, one waiting to take the loop
    // over. They share the browser's cache, so the second costs a decode and
    // not a download.
    const build=()=>{
      const el=new Audio();
      el.preload='auto';
      // Native looping is off — the whole point is to control the seam. It is
      // switched back on below for a track too short to overlap.
      el.loop=false;
      // Offered as <source> children rather than a single src so the browser
      // picks the first format it can actually decode.
      for(const candidate of trackSources(track)){
        const source=document.createElement('source');
        source.src=candidate.src;
        source.type=candidate.type;
        el.appendChild(source);
      }
      el.volume=0;
      return el;
    };
    const element=build();
    const spare=build();

    entry={element,track,failed:false,level:0,fade:null,
           elements:[element,spare],active:0,loopGain:[1,0],loopTimer:null};

    for(const el of entry.elements){
      el.addEventListener('error',()=>{
        entry.failed=true;
        console.warn('[red-static] music track failed to load',track.file);
        // Losing the authored track mid-session must not leave the run silent.
        if(this.currentTrack===entry)this.startSynthMusic(this.synthKey||'blacksite');
      });
      // A stall is the browser waiting on more of the file. Left alone it
      // recovers by itself; restarting or seeking here would turn a gap into a
      // jump backwards, so the only thing to do is not make it worse.
      el.addEventListener('pause',()=>{
        // Anything that pauses the current track without the game asking is an
        // interruption to recover from, not an instruction. Rate-limited so a
        // browser that insists on keeping it paused is left alone rather than
        // fought once per event.
        if(this.currentTrack!==entry||entry.stopping)return;
        // The outgoing half of a loop crossfade is paused on purpose, and so
        // is anything that is not the element currently carrying the track.
        // Restarting either would stack a second copy of the music.
        if(entry.crossing||el!==entry.elements[entry.active])return;
        const now=performance.now();
        if(now-(entry.resumedAt||0)<600)return;
        entry.resumedAt=now;
        el.play().catch(()=>{});
      });
    }

    this.trackNodes.set(track.file,entry);
    return entry;
  }

  // Applies a track's fade level and the global music setting to both of its
  // elements. `loopGain` is the seam crossfade and `level` is the track's own
  // fade, and the two multiply: a track fading out across its own loop point
  // has to keep both.
  applyTrackVolume(entry){
    if(!entry)return;
    const base=entry.level*this.musicLevel;
    const list=entry.elements||[entry.element];
    for(let i=0;i<list.length;i++){
      list[i].volume=clamp(base*(entry.loopGain?entry.loopGain[i]:1),0,1);
    }
  }

  // Watches the playing element approach the end of the file and hands the
  // loop to the other one, overlapping them for LOOP_FADE seconds.
  //
  // Driven by a timer rather than `timeupdate`, which browsers fire about four
  // times a second — too coarse to start a two-second fade on time.
  startLoopWatch(entry){
    this.stopLoopWatch(entry);
    entry.loopTimer=setInterval(()=>{
      if(this.currentTrack!==entry||entry.stopping)return;
      const from=entry.elements[entry.active];
      const duration=from.duration;
      // Metadata not in yet, or a stream with no known length. Nothing to
      // schedule against; the native loop below is the safety net.
      if(!isFinite(duration)||duration<=0)return;
      if(duration<LOOP_FADE*2+1){
        // Too short to overlap without fading across most of the piece. Let
        // the browser loop it and stop watching.
        from.loop=true;
        this.stopLoopWatch(entry);
        return;
      }
      if(entry.crossing||from.paused)return;
      if(duration-from.currentTime>LOOP_FADE)return;

      entry.crossing=true;
      const next=1-entry.active;
      const to=entry.elements[next];
      to.currentTime=0;
      entry.loopGain[next]=0;
      this.applyTrackVolume(entry);
      to.play()?.catch?.(()=>{
        // The incoming element was refused. Fall back to the plain loop rather
        // than letting the piece run off the end into silence.
        entry.crossing=false;
        from.loop=true;
        this.stopLoopWatch(entry);
      });

      const started=performance.now();
      const span=LOOP_FADE*1000;
      const step=setInterval(()=>{
        const t=Math.min(1,(performance.now()-started)/span);
        // Equal-power, so the overlap holds a constant loudness instead of
        // dipping through the middle the way a linear pair does.
        entry.loopGain[next]=Math.sin(t*Math.PI/2);
        entry.loopGain[entry.active]=Math.cos(t*Math.PI/2);
        this.applyTrackVolume(entry);
        if(t>=1){
          clearInterval(step);
          const old=entry.elements[entry.active];
          old.pause();
          old.currentTime=0;
          entry.loopGain[entry.active]=0;
          entry.active=next;
          entry.element=to;
          entry.loopGain[next]=1;
          entry.crossing=false;
          this.applyTrackVolume(entry);
        }
      },40);
    },200);
  }

  stopLoopWatch(entry){
    if(entry?.loopTimer){clearInterval(entry.loopTimer);entry.loopTimer=null}
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
          this.stopLoopWatch(previous);
          this.fadeTrack(previous,0);
          setTimeout(()=>{
            if(this.currentTrack!==previous)for(const el of previous.elements)el.pause();
            previous.stopping=false;
          },MUSIC_FADE*1000);
        }
        this.currentTrack=entry;
        entry.stopping=false;
        if(!resuming){
          // A fresh start rewinds both halves and puts the loop back on the
          // first one, so a track resumed later does not come back mid-seam.
          entry.crossing=false;
          entry.active=0;
          entry.element=entry.elements[0];
          entry.loopGain[0]=1;entry.loopGain[1]=0;
          for(const el of entry.elements){el.pause();el.currentTime=0}
        }
        this.applyTrackVolume(entry);
        const played=entry.element.play();
        this.startLoopWatch(entry);
        this.fadeTrack(entry,1,resuming?.25:MUSIC_FADE);
        // Autoplay can still be refused before the unlock gesture lands.
        played?.catch?.(err=>{
          console.warn('[red-static] music playback blocked',err);
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
    // The loop hand-off must not fire during the fade out, or the piece the
    // game just stopped starts a fresh copy of itself on the other element.
    this.stopLoopWatch(entry);
    this.fadeTrack(entry,0,.5);
    setTimeout(()=>{
      if(this.currentTrack!==entry)for(const el of entry.elements)el.pause();
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
