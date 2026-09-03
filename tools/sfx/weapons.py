#!/usr/bin/env python3
"""Offline weapon-report synthesis for RED STATIC.

    pip install numpy scipy soundfile
    python3 tools/sfx/weapons.py render assets/audio/sfx/weapons   # 12 families x 3 rounds
    python3 tools/sfx/weapons.py analyze assets/audio/sfx/weapons  # the numbers the harness checks

Why offline. The game synthesised every shot live in Web Audio from five clean
layers — filtered noise, a sawtooth, a sine — and clean is the problem. A real
report is dense: a pressure wave clipping the air, a barrel and receiver
ringing, the whole stack driven into saturation. Web Audio has no cheap
saturation stage and every layer costs a voice, so the live shot could never be
more than a sketch. Rendering here allows any amount of processing per shot for
zero runtime cost, and a shot then costs one voice instead of six.

Every family is a recipe over the same layers the live synth used, so the
vocabulary in src/core/audio.js still applies:

    crack     the muzzle transient, 2-12 ms, the part that carries
    body      the calibre — resonant, band-limited noise, 40-300 ms
    sub       the pressure wave, a sine dropping through the 30-90 Hz band
    mech      the action cycling — bolt, slide, pump
    tail      the air answering, short here because the game has a real room

...plus the two things the live synth could not do: **saturation** of the
summed stack, and **resonators** that give the body a pitch instead of a band.
"""
import json, math, os, sys
import numpy as np
from scipy import signal
import soundfile as sf

SR = 44100
FAMILIES = ['pistol','suppressed','rifle','smg','shotgun','marksman','sniper',
            'lmg','heavy','beam','tech','corrupted']
ROUNDS = 3

# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------

def seconds(n): return int(n*SR)

def white(rng, dur): return rng.standard_normal(seconds(dur)).astype(np.float64)

def env_exp(dur, decay, attack=.0005, hold=0.0):
    """Instant-ish attack, exponential decay with time constant `decay`."""
    n=seconds(dur); t=np.arange(n)/SR
    a=np.clip(t/max(attack,1e-5),0,1)
    d=np.exp(-np.maximum(0,t-hold)/max(decay,1e-4))
    return a*d

def bp(x, lo, hi, order=2):
    sos=signal.butter(order,[lo,hi],btype='band',fs=SR,output='sos'); return signal.sosfilt(sos,x)
def hp(x, f, order=2):
    sos=signal.butter(order,f,btype='high',fs=SR,output='sos'); return signal.sosfilt(sos,x)
def lp(x, f, order=2):
    sos=signal.butter(order,f,btype='low',fs=SR,output='sos'); return signal.sosfilt(sos,x)

def resonator(x, f, q):
    """A ringing peak — what gives a body a calibre rather than a band."""
    b,a=signal.iirpeak(f,q,fs=SR); return signal.lfilter(b,a,x)

def sweep_sine(dur, f0, f1, curve=4.0):
    """Sine whose pitch falls exponentially f0 -> f1 over `dur`."""
    n=seconds(dur); t=np.arange(n)/SR
    k=np.log(f1/f0)
    f=f0*np.exp(k*(1-np.exp(-curve*t/dur))/(1-np.exp(-curve)))
    return np.sin(2*np.pi*np.cumsum(f)/SR)

def saturate(x, drive):
    return np.tanh(x*drive)/np.tanh(drive)

def pad(x, n):
    return x if len(x)>=n else np.concatenate([x,np.zeros(n-len(x))])

def mix(*layers, length=None):
    n=length or max(len(l) for l,_ in layers)
    out=np.zeros(n)
    for l,g in layers: out[:len(l)]+=l[:n]*g
    return out

def at(x, delay, n):
    """Place x starting at `delay` seconds inside a buffer of n samples."""
    out=np.zeros(n); s=seconds(delay); x=x[:max(0,n-s)]; out[s:s+len(x)]=x; return out

# ---- Layers ----------------------------------------------------------------

def crack(rng, ms, lo=1800, hi=9000, click=1.0):
    """Muzzle transient: a hard impulse and a burst of bright noise."""
    dur=ms/1000
    n=white(rng,dur)*env_exp(dur,dur*.3,attack=.0002)
    n=bp(n,lo,hi,2)
    imp=np.zeros(seconds(dur)); imp[0]=1.0; imp[1]=-.6
    imp=resonator(imp,(lo+hi)/2.5,2.0)*click
    return n+imp*3

def body(rng, dur, centre, q=3.5, band=(120,2200), decay=None):
    """Calibre: band-limited noise with a resonant peak, decaying."""
    decay=decay or dur*.35
    n=white(rng,dur)*env_exp(dur,decay,attack=.001)
    n=bp(n,*band,2)
    return n+resonator(n,centre,q)*1.4

def sub(dur, f0, f1, decay=None, drive=1.6):
    decay=decay or dur*.45
    s=sweep_sine(dur,f0,f1)*env_exp(dur,decay,attack=.002)
    # A touch of saturation so the fundamental has harmonics — the missing
    # fundamental for a small speaker, baked in rather than added live.
    return saturate(s,drive)

def clack(rng, f, ms=14, q=6.0, metal=1.0):
    """One mechanical click: an impulse through a metallic resonance."""
    dur=ms/1000
    imp=np.zeros(seconds(dur)); imp[0]=1.0
    x=resonator(imp,f,q)+resonator(imp,f*2.7,q*1.5)*.4*metal
    x+=white(rng,dur)*env_exp(dur,dur*.15)*.25
    return x*env_exp(dur,dur*.4,attack=.0002)

def tail(rng, dur, cutoff=1400, reflections=(0.011,0.023,0.041)):
    """Air answering: dark noise with a few early reflections."""
    n=white(rng,dur)*env_exp(dur,dur*.3,attack=.004)
    n=lp(n,cutoff,2)
    out=n.copy()
    for i,d in enumerate(reflections):
        out+=at(n,d,len(n))*(.55-i*.12)
    return out

def finish(x, peak=.89, drive=1.4, fade=.012, hpf=28):
    """Saturate the stack, clean the extreme lows, normalise, fade out."""
    x=saturate(x,drive)
    x=hp(x,hpf,1)
    n=seconds(fade); x[-n:]*=np.linspace(1,0,n)
    return x/max(1e-9,np.max(np.abs(x)))*peak

# ---------------------------------------------------------------------------
# The families
# ---------------------------------------------------------------------------

def r_pistol(rng, v):
    n=seconds(.42)
    x=mix((crack(rng,4,2200,9000),1.4),
          (body(rng,.09,330+v*15,q=4,band=(150,2600)),.9),
          (sub(.14,95,48),.3),
          (at(clack(rng,2400,10),.026,n),.5),   # slide unlocks
          (at(clack(rng,1700,16),.078,n),.42),  # slide returns
          (tail(rng,.3,1600),.28),length=n)
    return finish(x,drive=1.6)

def r_suppressed(rng, v):
    n=seconds(.36)
    # The can takes the crack; what is left is the action and a puff of gas.
    puff=lp(white(rng,.05)*env_exp(.05,.012,attack=.0008),2800,3)
    x=mix((crack(rng,3,900,3000,click=.4),.35),
          (puff,1.1),
          (body(rng,.06,250,q=3,band=(120,1600)),.55),
          (sub(.09,80,55,drive=1.2),.16),
          (at(clack(rng,2100,12,metal=1.3),.018,n),.95),
          (at(clack(rng,1500,18,metal=1.3),.064,n),.8),
          (tail(rng,.14,900),.14),length=n)
    return finish(x,drive=1.2)

def r_rifle(rng, v):
    n=seconds(.55)
    x=mix((crack(rng,5,2600,11000),1.6),
          (body(rng,.11,430+v*12,q=4.5,band=(140,3000)),.95),
          (body(rng,.16,175,q=3,band=(90,900)),.75),
          (sub(.17,85,42),.36),
          (at(clack(rng,1900,12),.03,n),.4),
          (at(clack(rng,1300,20),.085,n),.3),
          (tail(rng,.42,1500),.34),length=n)
    return finish(x,drive=1.8)

def r_smg(rng, v):
    n=seconds(.34)
    x=mix((crack(rng,3.5,2800,10000),1.3),
          (body(rng,.07,520+v*20,q=4,band=(200,3400)),.85),
          (sub(.1,110,60),.22),
          (at(clack(rng,2600,9),.02,n),.5),
          (tail(rng,.24,1700),.24),length=n)
    return finish(x,drive=1.6)

def r_shotgun(rng, v):
    n=seconds(.95)
    boom=body(rng,.22,150,q=2.5,band=(60,700),decay=.09)
    x=mix((crack(rng,9,1200,7000),1.7),
          (boom,1.7),
          (body(rng,.09,700,q=2,band=(300,2600)),.7),
          (sub(.32,62,28,decay=.12,drive=2.2),.6),
          (tail(rng,.5,1100),.5),
          # The pump, well after the report.
          (at(clack(rng,900,26,q=4,metal=1.4),.36,n),.55),
          (at(clack(rng,1200,22,q=4,metal=1.4),.47,n),.5),length=n)
    return finish(x,drive=2.1)

def r_marksman(rng, v):
    n=seconds(.8)
    x=mix((crack(rng,5.5,3000,12000),1.8),
          (body(rng,.14,300,q=5,band=(120,2800)),1.0),
          (body(rng,.24,140,q=3,band=(70,700)),.8),
          (sub(.26,66,36,decay=.1),.45),
          (at(clack(rng,1500,14),.04,n),.35),
          (tail(rng,.62,1300),.42),length=n)
    return finish(x,drive=1.9)

def r_sniper(rng, v):
    n=seconds(1.15)
    x=mix((crack(rng,7,3400,13000),2.0),
          (body(rng,.2,240,q=5,band=(90,2600)),1.15),
          (body(rng,.36,110,q=3,band=(50,560)),1.0),
          (sub(.42,52,26,decay=.16,drive=2.0),.55),
          (tail(rng,.9,1200,reflections=(.013,.029,.052,.09)),.5),
          # Bolt back, bolt forward — the deliberate part.
          (at(clack(rng,1100,28,q=5,metal=1.5),.62,n),.5),
          (at(clack(rng,1400,24,q=5,metal=1.5),.78,n),.45),length=n)
    return finish(x,drive=2.0)

def r_lmg(rng, v):
    n=seconds(.5)
    x=mix((crack(rng,5,2400,10000),1.4),
          (body(rng,.12,360+v*10,q=4,band=(130,2800)),1.0),
          (body(rng,.15,160,q=3,band=(80,800)),.75),
          (sub(.18,70,40),.4),
          (at(clack(rng,1100,16,metal=1.4),.024,n),.6),   # heavy bolt
          (tail(rng,.36,1400),.32),length=n)
    return finish(x,drive=1.9)

def r_heavy(rng, v):
    n=seconds(1.4)
    boom=body(rng,.4,140,q=2.5,band=(40,600),decay=.16)
    x=mix((crack(rng,12,900,6000),1.6),
          (boom,1.8),
          (body(rng,.14,420,q=2,band=(200,2200)),.7),
          (sub(.54,46,24,decay=.2,drive=2.6),.7),
          (tail(rng,1.1,900,reflections=(.017,.037,.066,.11)),.6),
          (at(clack(rng,600,40,q=3,metal=1.6),.14,n),.45),length=n)
    return finish(x,drive=2.4)

def r_beam(rng, v):
    # Not ballistic. No pressure wave; a charge tick, an FM zap, and hiss.
    n=seconds(.3); t=np.arange(n)/SR
    carrier=2300*np.exp(-t*7)+420
    modf=carrier*1.5
    idx=3.0*np.exp(-t*12)
    zap=np.sin(2*np.pi*np.cumsum(carrier)/SR+idx*np.sin(2*np.pi*np.cumsum(modf)/SR))
    zap*=env_exp(.3,.05,attack=.0015)
    hiss=hp(white(rng,.3),3000,2)*env_exp(.3,.045,attack=.002)
    tick=np.zeros(n); tick[0]=1; tick=resonator(tick,5200,8)*env_exp(.3,.004)
    x=mix((zap,.9),(hiss,.35),(tick,1.2),length=n)
    x=hp(x,180,2)   # nothing below the mids, on purpose
    return finish(x,drive=1.3,hpf=160)

def r_tech(rng, v):
    n=seconds(.36); t=np.arange(n)/SR
    # Plasma: noise through a resonance that rises as it decays, plus a pop.
    burst=white(rng,.36)*env_exp(.36,.06,attack=.001)
    f=760+640*(1-np.exp(-t*18))
    out=np.zeros(n); y1=y2=0.0
    for i in range(n):
        w=2*np.pi*f[i]/SR; r=.985
        b0=1-r; y=b0*burst[i]+2*r*math.cos(w)*y1-r*r*y2
        y2=y1; y1=y; out[i]=y
    pop=sub(.09,240,120,drive=1.2)
    tick=np.zeros(n); tick[0]=1; tick=resonator(tick,3600,6)*env_exp(.36,.006)
    x=mix((out,1.0),(pop,.5),(tick,.9),(hp(white(rng,.12)*env_exp(.12,.02),5000),.3),length=n)
    return finish(x,drive=1.5)

def r_corrupted(rng, v):
    # A rifle shot with the signal in it: pitched wrong, ring-modulated,
    # stuttering. Still a gunshot.
    n=seconds(.62); t=np.arange(n)/SR
    base=mix((crack(rng,6,2000,9000),1.5),
             (body(rng,.14,330,q=4,band=(120,2600)),.95),
             (sub(.2,70,110,decay=.09),.32),   # rises: the wrong way
             (tail(rng,.46,1400),.35),length=n)
    ring=np.sin(2*np.pi*np.cumsum(330+330*(1-np.exp(-t*9)))/SR)
    gate=(np.sin(2*np.pi*t*(160+v*30))>-.3).astype(float)
    gate=np.where(t<.02,1,gate)   # never gate the transient
    x=base*(.55+.45*ring)*(.5+.5*gate)
    # Crush the tail: 6-bit for the last part.
    crush=np.round(x*32)/32
    blend=np.clip((t-.06)/.12,0,1)
    x=x*(1-blend)+crush*blend
    return finish(x,drive=1.8)

RECIPES={'pistol':r_pistol,'suppressed':r_suppressed,'rifle':r_rifle,'smg':r_smg,
         'shotgun':r_shotgun,'marksman':r_marksman,'sniper':r_sniper,'lmg':r_lmg,
         'heavy':r_heavy,'beam':r_beam,'tech':r_tech,'corrupted':r_corrupted}

# Loudness per family, applied after normalisation. Not a mixer — the game's
# buses are — but the suppressed weapon must arrive quieter than everything
# else and the heavies a little hotter, at the same call volume.
LEVEL={'pistol':.80,'suppressed':.42,'rifle':.86,'smg':.74,'shotgun':.95,'marksman':.9,
       'sniper':.95,'lmg':.84,'heavy':1.0,'beam':.6,'tech':.62,'corrupted':.82}

def render(out_dir):
    os.makedirs(out_dir,exist_ok=True)
    for fam in FAMILIES:
        for v in range(ROUNDS):
            rng=np.random.default_rng(hash((fam,v))&0xffffffff)
            x=RECIPES[fam](rng,v)*LEVEL[fam]
            path=os.path.join(out_dir,f'{fam}-{v+1}.ogg')
            sf.write(path,x.astype(np.float32),SR,format='OGG',subtype='VORBIS')
            print('wrote',path,f'{len(x)/SR:.2f}s')

# ---------------------------------------------------------------------------
# Analysis — the same numbers tools/weapon-punch.mjs checks on the decoded
# buffers, so a recipe can be judged here before it is shipped.
# ---------------------------------------------------------------------------

def metrics(x):
    n=len(x)
    first=x[:seconds(.006)]
    transient=float(np.sqrt(np.mean(first**2)))
    rms=float(np.sqrt(np.mean(x**2)))
    spec=np.abs(np.fft.rfft(x))**2; freqs=np.fft.rfftfreq(n,1/SR)
    total=spec.sum()+1e-12
    subfrac=float(spec[freqs<120].sum()/total)
    bands={'sub':float(spec[freqs<120].sum()/total),
           'low':float(spec[(freqs>=120)&(freqs<450)].sum()/total),
           'mid':float(spec[(freqs>=450)&(freqs<2200)].sum()/total),
           'high':float(spec[freqs>=2200].sum()/total)}
    centroid=float((spec*freqs).sum()/total)
    # Length: where the envelope drops 40 dB below peak.
    envl=np.abs(signal.hilbert(x)); thr=envl.max()*.01
    length=float(np.max(np.nonzero(envl>thr))/SR) if np.any(envl>thr) else 0
    return dict(transient=round(transient,4),rms=round(rms,4),subFraction=round(subfrac,3),
                bands={k:round(v,2) for k,v in bands.items()},
                centroidHz=round(centroid),lengthS=round(length,3),peak=round(float(np.max(np.abs(x))),3))

def analyze(out_dir):
    res={}
    for fam in FAMILIES:
        x,_=sf.read(os.path.join(out_dir,f'{fam}-1.ogg'))
        res[fam]=metrics(x)
    print(json.dumps(res,indent=1))
    return res

if __name__=='__main__':
    cmd=sys.argv[1] if len(sys.argv)>1 else 'render'
    out=sys.argv[2] if len(sys.argv)>2 else 'assets/audio/sfx/weapons'
    if cmd=='render': render(out)
    elif cmd=='analyze': analyze(out)
    else: raise SystemExit('render | analyze')
