// Gamepad normalisation.
//
// The Gamepad API hands back whatever the driver felt like reporting, and the
// spread across real hardware is wide enough that reading `axes[0]` and
// `buttons[0]` directly only works for first-party controllers on a good day.
// Everything here exists because some real device does it differently:
//
//   * Non-standard mapping. `pad.mapping` is `'standard'` for controllers the
//     browser recognises and `''` for a great many third-party ones, where the
//     button order is the manufacturer's own. Face buttons are close enough to
//     universal to index blindly; the d-pad is not, so it is read from a hat
//     axis when the button block is missing.
//   * Ghost pads. Browsers report empty slots, and some report a phantom
//     device alongside the real one. Picking `pads[0]` finds the phantom.
//   * Stick drift. A worn or cheap stick rests off centre, sometimes well past
//     a fixed threshold, and a per-axis cutoff turns that into the operative
//     walking into a wall on their own.
//   * Square deadzones. Testing each axis separately makes a diagonal need
//     more push than a cardinal, which is felt immediately even if it is never
//     articulated.
//
// The deadzone here is radial and rescaling: below the floor is nothing, and
// the range above it is stretched back out to a full 0..1 so the first
// perceptible push is a slow walk rather than a lurch to a fifth of top speed.

// Below this fraction of full deflection a stick is considered at rest. Chosen
// above the drift of a well-worn stick and below a deliberate nudge.
const DEADZONE=.18;
// Anything past this counts as fully deflected. Sticks that no longer reach
// the corners still get full speed out of the operative.
const SATURATION=.95;

// Standard mapping, and the closest thing to a consensus on everything else.
export const BUTTON={
  a:0,b:1,x:2,y:3,
  lb:4,rb:5,lt:6,rt:7,
  back:8,start:9,
  l3:10,r3:11,
  up:12,down:13,left:14,right:15,
  guide:16
};

function radial(x,y){
  const m=Math.hypot(x,y);
  if(m<DEADZONE)return{x:0,y:0,m:0};
  // Rescale the live band back to 0..1 so the whole travel is usable.
  const scaled=Math.min(1,(m-DEADZONE)/(SATURATION-DEADZONE));
  return{x:x/m*scaled,y:y/m*scaled,m:scaled};
}

const pressed=(buttons,index)=>{
  const button=buttons[index];
  if(!button)return false;
  // Triggers report as analog on some drivers and digital on others.
  return button.pressed||button.value>.5;
};

// The d-pad, from whichever place this controller keeps it. Standard mapping
// puts it on buttons 12-15; a lot of non-standard pads and most television
// remotes report it as a hat on axis 9, encoded as eight compass positions
// plus a rest value outside the -1..1 band.
function readDpad(buttons,axes){
  if(buttons.length>BUTTON.right){
    return{
      up:pressed(buttons,BUTTON.up),down:pressed(buttons,BUTTON.down),
      left:pressed(buttons,BUTTON.left),right:pressed(buttons,BUTTON.right)
    };
  }
  const hat=axes[9];
  if(hat===undefined||hat>1.05||hat<-1.05)return{up:false,down:false,left:false,right:false};
  // Eight positions evenly spaced from -1 (up) around to 1 (up-left).
  const octant=Math.round((hat+1)*3.5);
  return{
    up:octant===0||octant===1||octant===7,
    right:octant===1||octant===2||octant===3,
    down:octant===3||octant===4||octant===5,
    left:octant===5||octant===6||octant===7
  };
}

// True when a pad is reporting nothing at all. A phantom device sits at rest
// forever, so a resting pad is only skipped while a livelier one exists.
function isIdle(pad){
  for(const axis of pad.axes||[])if(Math.abs(axis)>DEADZONE)return false;
  for(const button of pad.buttons||[])if(button?.pressed||button?.value>.1)return false;
  return true;
}

export class GamepadReader{
  constructor(){
    this.index=null;
    this.id='';
    this.mapping='';
    this.connected=false;
    // Rising-edge bookkeeping, so a held button fires once.
    this.previous=new Map();
  }

  // The pad worth listening to: the one already chosen while it is still
  // reporting, otherwise the first that is actually doing something, otherwise
  // any connected pad at all so a resting controller still counts as present.
  pick(pads){
    const current=this.index!=null?pads[this.index]:null;
    if(current&&current.connected!==false)return current;
    let idle=null;
    for(const pad of pads){
      if(!pad||pad.connected===false)continue;
      if(!isIdle(pad))return pad;
      if(!idle)idle=pad;
    }
    return idle;
  }

  // A normalised snapshot, or null when nothing is plugged in.
  read(){
    if(typeof navigator==='undefined'||!navigator.getGamepads)return null;
    let pads;
    // Safari throws here when the page has not been interacted with yet.
    try{pads=navigator.getGamepads()}catch{return null}
    if(!pads)return null;
    const pad=this.pick(pads);
    if(!pad){
      this.connected=false;
      this.index=null;
      return null;
    }
    this.index=pad.index;
    this.id=pad.id||'';
    this.mapping=pad.mapping||'';
    this.connected=true;

    const axes=pad.axes||[];
    const buttons=pad.buttons||[];
    const move=radial(axes[0]||0,axes[1]||0);
    const aim=radial(axes[2]||0,axes[3]||0);
    const dpad=readDpad(buttons,axes);

    return{
      id:this.id,mapping:this.mapping,index:pad.index,
      moveX:move.x,moveY:move.y,moveM:move.m,
      aimX:aim.x,aimY:aim.y,aimM:aim.m,
      dpad,
      button:i=>pressed(buttons,i),
      buttons,axes
    };
  }

  // True on the frame a control goes from released to held. `name` is any
  // stable string, so sticks pushed past a threshold can be edged too.
  edge(name,held){
    const was=this.previous.get(name)===true;
    this.previous.set(name,!!held);
    return !!held&&!was;
  }

  // Forgets the held state, so releasing a control while the game was not
  // looking cannot swallow the next press.
  clearEdges(){this.previous.clear()}
}
