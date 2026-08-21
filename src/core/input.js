import {clamp} from './math.js';
import {GamepadReader,BUTTON} from './gamepad.js';

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
    this.pad=new GamepadReader();
    this.lastScheme='keyboard';
    this.actions={dash:false,ability:false,pause:false,interact:false,swap:false,deploy:false,secondary:false,kit:false};
    // Every gamepad action is edge-triggered through the reader, so holding a
    // button does one thing rather than one thing per frame. Pause used to be
    // read level-high, which strobed the pause menu open and shut for as long
    // as START was down.
    this.padState=null;
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
    on(window,'gamepadconnected',e=>{
      this.pad.index=e.gamepad.index;
      // A pad that arrives mid-session has no press history, and inheriting
      // the last one's would swallow the first button.
      this.pad.clearEdges();
    });
    on(window,'gamepaddisconnected',()=>{
      this.pad.index=null;
      this.pad.clearEdges();
    });
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
    }else if(pad&&pad.aimM>0){
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
      // Dash and ability may repeat while held — their cooldowns govern them
      // and holding the button to dash again the moment it is ready is what a
      // player expects. Everything else fires once per press.
      if(pad.dash)this.setAction('dash');
      if(pad.ability)this.setAction('ability');
      if(this.pad.edge('pause',pad.pause))this.setAction('pause');
      if(this.pad.edge('deploy',pad.deploy))this.setAction('deploy');
      if(this.pad.edge('secondary',pad.secondary))this.setAction('secondary');
      if(this.pad.edge('kit',pad.kit))this.setAction('kit');
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

  // The pad as the simulation wants it: a movement vector that includes the
  // d-pad, an aim vector, and actions that have already been edged.
  readGamepad(){
    const pad=this.pad.read();
    this.padState=pad;
    if(!pad)return null;
    const held=pad.button;

    // The d-pad drives movement alongside the stick. Plenty of third-party
    // controllers have a stick nobody wants to use, and a television remote
    // has nothing else at all.
    let moveX=pad.moveX,moveY=pad.moveY;
    if(pad.dpad.left)moveX-=1;
    if(pad.dpad.right)moveX+=1;
    if(pad.dpad.up)moveY-=1;
    if(pad.dpad.down)moveY+=1;
    const m=Math.hypot(moveX,moveY);
    if(m>1){moveX/=m;moveY/=m}
    if(moveX||moveY||pad.aimM>0)this.lastScheme='gamepad';

    return{
      moveX,moveY,
      aimX:pad.aimX,aimY:pad.aimY,aimM:pad.aimM,
      // Face and shoulder buttons both, because which of the two a player
      // reaches for is a matter of what they grew up holding.
      dash:held(BUTTON.a)||held(BUTTON.lt),
      ability:held(BUTTON.x)||held(BUTTON.rt),
      deploy:held(BUTTON.b)||held(BUTTON.lb),
      secondary:held(BUTTON.rb)||held(BUTTON.y),
      kit:held(BUTTON.l3),
      pause:held(BUTTON.start)||held(BUTTON.back),
      fire:held(BUTTON.rb)||held(BUTTON.rt)
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
