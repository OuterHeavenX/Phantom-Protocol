// Boot title screen. The artwork in assets/images is a finished title screen —
// logo, tagline and both buttons are painted into the image — so the job here
// is not to draw a menu over it but to make the painted buttons real.
//
// That only works if the image is never cropped, because a crop would slide
// the painted buttons out from under their hit areas. So the stage carries the
// artwork's own aspect ratio and is fitted inside the viewport whole; the
// letterbox is filled with a blurred, dimmed copy of the same image rather
// than bars. With no cropping the mapping is exact, and every hit area can be
// declared as a percentage of the artwork measured off the source file.

const ART={
  wide:{
    ratio:1448/1086,
    base:'assets/images/title-screen-wide',
    // left / top / width / height, as percentages of the artwork.
    buttons:{start:[34.1,75.6,29.8,6.2],settings:[34.1,83.7,29.8,6.4]}
  },
  tall:{
    ratio:853/1844,
    base:'assets/images/title-screen-tall',
    buttons:{start:[17.9,82.1,64.6,4.9],settings:[17.9,87.8,64.6,4.9]}
  }
};

// The variant whose shape is closest to the viewport's, in ratio terms. The
// crossover sits at the geometric mean of the two artworks, so each is used
// for the half of the shape space it fits better.
const CROSSOVER=Math.sqrt(ART.wide.ratio*ART.tall.ratio);

function pickVariant(){
  const ratio=window.innerWidth/Math.max(1,window.innerHeight);
  return ratio<CROSSOVER?'tall':'wide';
}

export class Splash{
  constructor({onStart,onSettings,audio}={}){
    this.onStart=onStart;
    this.onSettings=onSettings;
    this.audio=audio;
    this.variant=null;
    this.dismissed=false;
    this.el=document.createElement('div');
    this.el.className='splash';
    this.el.setAttribute('role','dialog');
    this.el.setAttribute('aria-label','Red Static title screen');
    this.el.innerHTML=`
      <div class="splash-backdrop"></div>
      <div class="splash-stage">
        <img class="splash-art" alt="Red Static" decoding="async" fetchpriority="high">
        <button class="splash-anywhere" data-splash="start" aria-label="Start"></button>
        <button class="splash-hit" data-splash="start" aria-label="Start"></button>
        <button class="splash-hit" data-splash="settings" aria-label="Settings"></button>
        <p class="splash-hint">PRESS START</p>
      </div>`;

    this.stage=this.el.querySelector('.splash-stage');
    this.image=this.el.querySelector('.splash-art');
    // WebP first — it is a tenth of the PNG — with the PNG kept as the
    // fallback a browser that cannot decode it will fall back to. A <picture>
    // would express this declaratively but fetches both when its sources are
    // assigned from script, which is 2 MB wasted on the phone that can least
    // afford it.
    this.image.addEventListener('error',()=>{
      const png=`${ART[this.variant].base}.png`;
      if(!this.image.src.endsWith('.png'))this.image.src=png;
    });
    this.backdrop=this.el.querySelector('.splash-backdrop');
    this.hits={
      start:this.el.querySelector('.splash-hit[data-splash="start"]'),
      settings:this.el.querySelector('.splash-hit[data-splash="settings"]')
    };

    // The painted buttons are small on a short landscape phone, so the whole
    // frame starts the game and only SETTINGS has to be hit precisely. The
    // two painted boxes still sit on top, so they keep their own highlight
    // and SETTINGS still wins the clicks that land on it.
    for(const button of this.el.querySelectorAll('[data-splash]')){
      button.addEventListener('click',()=>this.choose(button.dataset.splash));
    }
    this.onResize=()=>this.applyVariant();
    // The command menu is already built underneath and binds its own arrow
    // and Enter navigation to the window, so the title screen swallows every
    // key in the capture phase. Otherwise Enter would start the game and pick
    // a menu entry the player never saw.
    this.onKey=event=>{
      event.stopImmediatePropagation();
      if(event.key==='Enter'||event.key===' '){event.preventDefault();this.choose('start')}
    };
    window.addEventListener('resize',this.onResize);
    window.addEventListener('orientationchange',this.onResize);
    window.addEventListener('keydown',this.onKey,true);

    this.applyVariant();
  }

  // Swaps the artwork and re-anchors the hit areas. Called on every resize so
  // a rotated phone or a resized window keeps the buttons where they look.
  applyVariant(){
    const variant=pickVariant();
    if(variant===this.variant)return;
    this.variant=variant;
    const art=ART[variant];
    this.image.src=`${art.base}.webp`;
    this.stage.style.setProperty('--splash-ratio',art.ratio);
    this.backdrop.style.backgroundImage=`image-set(url("${art.base}.webp") type("image/webp"),url("${art.base}.png") type("image/png"))`;
    for(const [name,box] of Object.entries(art.buttons)){
      const [left,top,width,height]=box;
      const style=this.hits[name].style;
      style.left=left+'%';style.top=top+'%';
      style.width=width+'%';style.height=height+'%';
    }
  }

  mount(parent){
    parent.appendChild(this.el);
    // Fade in once the artwork has actually decoded, so the first thing on
    // screen is the title screen rather than an empty black frame. The timer
    // is the floor: a slow or failed image must not hold the game hostage.
    const reveal=()=>this.el.classList.add('ready');
    const image=this.image;
    if(image.complete&&image.naturalWidth>0)requestAnimationFrame(reveal);
    else{
      image.addEventListener('load',reveal,{once:true});
      image.addEventListener('error',reveal,{once:true});
      setTimeout(reveal,2500);
    }
    return this;
  }

  choose(action){
    if(this.dismissed)return;
    this.dismissed=true;
    this.audio?.play('select');
    this.el.classList.add('leaving');
    const finish=()=>{
      this.destroy();
      if(action==='settings')this.onSettings?.();
      else this.onStart?.();
    };
    // Fall back to a timer in case the transition never fires (reduced motion,
    // a backgrounded tab), so the title screen can never trap the player.
    let done=false;
    const once=()=>{if(done)return;done=true;finish()};
    this.el.addEventListener('transitionend',once,{once:true});
    setTimeout(once,600);
  }

  destroy(){
    window.removeEventListener('resize',this.onResize);
    window.removeEventListener('orientationchange',this.onResize);
    window.removeEventListener('keydown',this.onKey,true);
    this.el.remove();
  }
}
