import {clamp} from './math.js';

const MOVE_KEYS={
  w:[0,-1],arrowup:[0,-1],
  s:[0,1],arrowdown:[0,1],
  a:[-1,0],arrowleft:[-1,0],
  d:[1,0],arrowright:[1,0]
};

// Unified input: keyboard + mouse + gamepad + twin-stick touch.
// Exposes a movement vector, an aim vector and edge-triggered actions.
export class Input{
  constructor(){
    this.keys=new Set();
    this.pressedThisFrame=new Set();
    this.moveX=0;this.moveY=0;
    this.aimX=1;this.aimY=0;
    this.aimActive=false;
    this.pointerX=0;this.pointerY=0;
    this.firing=false;
    this.stickMove={x:0,y:0,active:false};
    this.stickAim={x:0,y:0,active:false};
    this.gamepadIndex=null;
    this.lastScheme='keyboard';
    this.actions={dash:false,ability:false,pause:false,interact:false,swap:false,deploy:false,secondary:false,kit:false};
    this.padDeployHeld=false;
    this.consumed=new Set();
    this.enabled=true;
    this._bound=[];
    this._stickResets=[];
    this.attach();
  }

  attach(){
    const on=(target,type,fn,opts)=>{
      target.addEventListener(type,fn,opts);
      this._bound.push([target,type,fn,opts]);
    };

    on(window,'keydown',e=>{
      const key=e.key.toLowerCase();
      if(!this.keys.has(key))this.pressedThisFrame.add(key);
      this.keys.add(key);
      this.lastScheme='keyboard';
      if(MOVE_KEYS[key]||key===' ')e.preventDefault();
    });
    on(window,'keyup',e=>this.keys.delete(e.key.toLowerCase()));
    on(window,'blur',()=>this.releaseAll());

    on(window,'mousemove',e=>{
      this.pointerX=e.clientX;this.pointerY=e.clientY;
      this.pointerMoved=true;
      this.lastScheme='keyboard';
    });
    on(window,'mousedown',e=>{if(e.button===0)this.firing=true});
    on(window,'mouseup',e=>{if(e.button===0)this.firing=false});
    on(window,'gamepadconnected',e=>{this.gamepadIndex=e.gamepad.index});
    on(window,'gamepaddisconnected',()=>{this.gamepadIndex=null});
  }

  detach(){
    for(const [target,type,fn,opts] of this._bound)target.removeEventListener(type,fn,opts);
    this._bound.length=0;
  }

  releaseAll(){
    this.keys.clear();
    this.firing=false;
    this.releaseSticks();
  }

  // Drop any held virtual stick. Called when an overlay opens so the operative
  // does not keep moving under a paused simulation, and the knob does not
  // linger on screen.
  releaseSticks(){
    for(const reset of this._stickResets)reset();
    this.stickMove.x=this.stickMove.y=0;this.stickMove.active=false;
    this.stickAim.x=this.stickAim.y=0;this.stickAim.active=false;
  }

  // Called once per frame before the simulation reads input.
  poll(){
    let x=0,y=0;
    for(const key of this.keys){
      const dir=MOVE_KEYS[key];
      if(dir){x+=dir[0];y+=dir[1]}
    }
    if(this.stickMove.active){x+=this.stickMove.x;y+=this.stickMove.y;this.lastScheme='touch'}

    const pad=this.readGamepad();
    if(pad){x+=pad.moveX;y+=pad.moveY}

    const mag=Math.hypot(x,y);
    if(mag>1){x/=mag;y/=mag}
    this.moveX=x;this.moveY=y;

    // Aim priority: touch aim stick > gamepad right stick > mouse pointer.
    if(this.stickAim.active){
      this.aimX=this.stickAim.x;this.aimY=this.stickAim.y;this.aimActive=true;
    }else if(pad&&Math.hypot(pad.aimX,pad.aimY)>.25){
      this.aimX=pad.aimX;this.aimY=pad.aimY;this.aimActive=true;
    }else{
      this.aimActive=false;
    }

    if(this.keys.has('shift')||this.keys.has(' '))this.setAction('dash');
    if(this.keys.has('e')||this.keys.has('q'))this.setAction('ability');
    if(this.pressedThisFrame.has('escape')||this.pressedThisFrame.has('p'))this.setAction('pause');
    if(this.pressedThisFrame.has('tab'))this.setAction('swap');
    // Deploy is edge-triggered: holding the key must not empty the whole kit.
    if(this.pressedThisFrame.has('f'))this.setAction('deploy');
    // Which kit the next plant uses. Edge-triggered for the same reason, and
    // deliberately not on the gamepad's face buttons — those are full.
    if(this.pressedThisFrame.has('g'))this.setAction('kit');
    // Secondary fire. R on the keyboard, right mouse button, or the HUD's own
    // button on touch — the same three routes the other actives use.
    if(this.pressedThisFrame.has('r'))this.setAction('secondary');
    if(pad){
      if(pad.dash)this.setAction('dash');
      if(pad.ability)this.setAction('ability');
      if(pad.pause)this.setAction('pause');
      if(pad.deploy&&!this.padDeployHeld)this.setAction('deploy');
      if(pad.secondary&&!this.padSecondaryHeld)this.setAction('secondary');
      this.padSecondaryHeld=!!pad.secondary;
      this.padDeployHeld=pad.deploy;
    }

    this.pressedThisFrame.clear();
  }

  setAction(name){this.actions[name]=true}

  // Edge-triggered read: true once until the action is re-triggered.
  takeAction(name){
    if(!this.actions[name])return false;
    this.actions[name]=false;
    return true;
  }

  readGamepad(){
    if(typeof navigator==='undefined'||!navigator.getGamepads)return null;
    const pads=navigator.getGamepads();
    let pad=this.gamepadIndex!=null?pads[this.gamepadIndex]:null;
    if(!pad)for(const candidate of pads)if(candidate){pad=candidate;this.gamepadIndex=candidate.index;break}
    if(!pad)return null;

    const dead=v=>Math.abs(v)<.22?0:v;
    const axes=pad.axes||[];
    const buttons=pad.buttons||[];
    const held=i=>!!(buttons[i]&&buttons[i].pressed);
    const moveX=dead(axes[0]||0),moveY=dead(axes[1]||0);
    if(moveX||moveY)this.lastScheme='gamepad';
    return{
      moveX,moveY,
      aimX:dead(axes[2]||0),aimY:dead(axes[3]||0),
      dash:held(0)||held(6),
      ability:held(2)||held(7),
      deploy:held(1)||held(4),
      secondary:held(5)||held(3),
      pause:held(9),
      fire:held(5)||held(7)
    };
  }

  // World-space aim direction; falls back to the pointer position projected
  // through the camera, then to the current facing.
  aimVector(camera,player){
    if(this.aimActive){
      const m=Math.hypot(this.aimX,this.aimY)||1;
      return{x:this.aimX/m,y:this.aimY/m,manual:true};
    }
    if(this.lastScheme==='keyboard'&&this.pointerMoved&&camera&&player){
      const world=camera.screenToWorld(this.pointerX,this.pointerY);
      const dx=world.x-player.x,dy=world.y-player.y;
      const m=Math.hypot(dx,dy);
      if(m>4)return{x:dx/m,y:dy/m,manual:true};
    }
    return{x:0,y:0,manual:false};
  }

  // Bind an on-screen virtual joystick. Returns a detach function.
  bindStick(element,knob,which='move',options={}){
    const state=which==='move'?this.stickMove:this.stickAim;
    const radius=options.radius||46;
    const dynamic=options.dynamic!==false;
    const ignoreSelector=options.ignore||null;
    let touchId=null,originX=0,originY=0;

    const reset=()=>{
      touchId=null;state.x=0;state.y=0;state.active=false;
      knob.style.transform='';
      element.classList.remove('active');
    };

    const place=(x,y)=>{
      if(!dynamic){
        const box=element.getBoundingClientRect();
        originX=box.left+box.width/2;originY=box.top+box.height/2;
      }else{
        const size=element.offsetWidth||120,half=size/2,margin=10;
        originX=clamp(x,half+margin,window.innerWidth-half-margin);
        originY=clamp(y,half+margin,window.innerHeight-half-margin);
        element.style.left=`${originX-half}px`;
        element.style.top=`${originY-half}px`;
        element.style.right='auto';
        element.style.bottom='auto';
      }
      element.classList.add('active');
    };

    const drag=(x,y)=>{
      const dx=x-originX,dy=y-originY;
      const d=Math.hypot(dx,dy)||1;
      const clamped=Math.min(radius,d);
      state.x=dx/d*(clamped/radius);
      state.y=dy/d*(clamped/radius);
      state.active=true;
      this.lastScheme='touch';
      knob.style.transform=`translate(${state.x*radius*.8}px,${state.y*radius*.8}px)`;
    };

    const start=e=>{
      if(touchId!==null)return;
      // A stick bound to a large zone (the whole game screen) receives
      // bubbled touches from every control inside it. Calling preventDefault
      // on those suppresses the browser's synthesized click, which silently
      // kills every button and overlay card in the zone — so only claim a
      // touch that did not begin on interactive UI.
      const target=e.target;
      if(ignoreSelector&&target&&target.closest&&target.closest(ignoreSelector))return;
      if(options.stopPropagation)e.stopPropagation();
      const touch=e.changedTouches[0];
      touchId=touch.identifier;
      place(touch.clientX,touch.clientY);
      drag(touch.clientX,touch.clientY);
      e.preventDefault();
    };
    const move=e=>{
      if(touchId===null)return;
      for(const touch of e.changedTouches)if(touch.identifier===touchId){
        drag(touch.clientX,touch.clientY);
        e.preventDefault();
      }
    };
    const end=e=>{
      for(const touch of e.changedTouches)if(touch.identifier===touchId)reset();
    };

    this._stickResets.push(reset);

    const zone=options.zone||element;
    zone.addEventListener('touchstart',start,{passive:false});
    zone.addEventListener('touchmove',move,{passive:false});
    zone.addEventListener('touchend',end,{passive:false});
    zone.addEventListener('touchcancel',reset,{passive:false});

    return()=>{
      zone.removeEventListener('touchstart',start);
      zone.removeEventListener('touchmove',move);
      zone.removeEventListener('touchend',end);
      zone.removeEventListener('touchcancel',reset);
      const index=this._stickResets.indexOf(reset);
      if(index>=0)this._stickResets.splice(index,1);
      reset();
    };
  }
}

export const isTouchDevice=()=>typeof window!=='undefined'&&
  ('ontouchstart' in window||(navigator.maxTouchPoints||0)>0);
