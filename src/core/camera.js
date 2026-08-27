import {clamp,damp,lerp,TAU} from './math.js';

// Camera response layers.
//
// `cap` is how much of the shake budget one source may ever hold; `decay` is
// how fast it lets go, relative to the camera's own decay rate. Recoil is
// capped low and released fast because it fires constantly; an explosion is
// allowed to dominate briefly and rings out slowly.
const SHAKE_LAYERS={
  recoil:{cap:.22,decay:2.6},
  impact:{cap:.5,decay:1},
  explosion:{cap:.85,decay:.7},
  boss:{cap:.6,decay:.8},
  environment:{cap:.3,decay:.45},
  signal:{cap:.4,decay:.6}
};
// The whole camera, however many sources are shouting at once.
const SHAKE_TOTAL_CAP=.9;

// Caps on how much world may be visible along each axis. Using the larger of
// the two required zooms keeps a tall portrait phone from showing an absurd
// vertical corridor, while a wide desktop still gets a full tactical picture.
const MAX_VISIBLE_WIDTH=920;
const MAX_VISIBLE_HEIGHT=1180;

// World-space camera. The previous build pinned the player to the canvas
// centre and slid the entire world underneath; entities now live in real
// world coordinates and the camera resolves the view transform.
export class Camera{
  constructor(width,height){
    this.x=0;this.y=0;
    this.width=width;this.height=height;
    this.zoom=1;this.targetZoom=1;this.baseZoom=1;
    this.pixelScaleX=1;this.pixelScaleY=1;
    this.shake=0;this.shakeDecay=3.2;
    this.offsetX=0;this.offsetY=0;
    this.lookAhead=90;
    this.rotation=0;
    this.enabled=true;
    this.trauma=0;
    // Independent shake sources, summed each frame. See `addShake`.
    this.shakeLayers={};
    this.time=0;
  }

  // `width`/`height` are drawing-buffer pixels. `cssWidth`/`cssHeight` are the
  // element's layout size, which is what a pointer event reports — the two
  // differ by the device pixel ratio, and conflating them is why mouse aim was
  // wrong on every retina display (see cssToWorld).
  resize(width,height,cssWidth=width,cssHeight=height){
    this.width=width;this.height=height;
    this.pixelScaleX=cssWidth>0?width/cssWidth:1;
    this.pixelScaleY=cssHeight>0?height/cssHeight:1;
    // Show a fixed slice of the world regardless of resolution or device
    // pixel ratio, so a high-DPR phone and a desktop see the same tactical
    // picture (the previous ratio-of-diagonals formula made a retina display
    // see twice as much ground as a standard one).
    this.baseZoom=clamp(
      Math.max(width/MAX_VISIBLE_WIDTH,height/MAX_VISIBLE_HEIGHT),
      .45,4
    );
  }

  follow(target,aim,dt){
    if(!target)return;
    dt=Math.max(0,dt)||0;
    const leadX=aim?aim.x*this.lookAhead:0;
    const leadY=aim?aim.y*this.lookAhead:0;
    this.offsetX=damp(this.offsetX,leadX,3,dt);
    this.offsetY=damp(this.offsetY,leadY,3,dt);
    this.x=damp(this.x,target.x+this.offsetX,9,dt);
    this.y=damp(this.y,target.y+this.offsetY,9,dt);
  }

  // `amount` is trauma in 0..1; shake magnitude scales with its square so
  // small hits stay subtle while big ones land hard.
  //
  // `layer` names what caused it. Every source used to add into one number,
  // which meant a firefight and an explosion and a walker's footfalls all
  // competed for the same channel: whichever arrived last set the tone, and a
  // sustained source could sit the camera at maximum trauma indefinitely. Each
  // layer now decays at its own rate and carries its own ceiling, and they sum
  // — so a recoil buzz under an explosion reads as both, and neither can take
  // the whole budget on its own.
  addShake(amount,layer='impact'){
    const spec=SHAKE_LAYERS[layer]||SHAKE_LAYERS.impact;
    const current=this.shakeLayers[layer]||0;
    this.shakeLayers[layer]=clamp(current+amount,0,spec.cap);
    // Kept in step so anything still reading `trauma` sees the whole picture.
    this.trauma=clamp(this.totalTrauma(),0,1);
  }

  totalTrauma(){
    let total=0;
    for(const name in this.shakeLayers)total+=this.shakeLayers[name];
    return total;
  }

  punchZoom(amount){
    this.targetZoom=clamp(this.targetZoom+amount,.7,1.6);
  }

  update(dt,intensity=1){
    // Never integrate backwards. `damp` run with a negative delta does not
    // ease towards its target, it explodes away from it — a single frame with
    // dt of -1 took the zoom from 1 to about -574, and a negative zoom mirrors
    // the entire view and every screen-to-world conversion through the
    // operative. The caller clamps too; this is the guard that matters,
    // because this is the value that blows up.
    dt=Math.max(0,dt)||0;
    this.time+=dt;
    // Each layer relaxes on its own clock. Recoil disappears almost at once;
    // an explosion rings on; environmental vibration is a slow bed under both.
    for(const name in this.shakeLayers){
      const spec=SHAKE_LAYERS[name]||SHAKE_LAYERS.impact;
      const next=this.shakeLayers[name]-this.shakeDecay*spec.decay*dt*.55;
      if(next<=0.0001)delete this.shakeLayers[name];
      else this.shakeLayers[name]=next;
    }
    // Summed, then capped once. Without the ceiling a boss fight in a hazard
    // field could stack four sources into something unplayable.
    this.trauma=clamp(this.totalTrauma(),0,SHAKE_TOTAL_CAP);
    const t=this.trauma*this.trauma*intensity;
    // Two frequencies per axis rather than one, so a sustained shake does not
    // read as a clean sine — a camera oscillating on a single note looks like
    // an effect, not like a room reacting.
    const f=this.time*34;
    this.shakeX=(Math.sin(f*1.13)+Math.sin(f*2.7)*.35)*t*20;
    this.shakeY=(Math.cos(f*0.97)+Math.cos(f*2.3)*.35)*t*17;
    this.rotation=Math.sin(f*.71)*t*.012;
    this.targetZoom=damp(this.targetZoom,1,4.5,dt);
    this.zoom=damp(this.zoom,this.targetZoom*this.baseZoom,7,dt);
  }

  // Applies the view transform to a 2D context. Callers must restore().
  apply(ctx){
    ctx.save();
    ctx.translate(this.width/2,this.height/2);
    ctx.rotate(this.rotation);
    ctx.scale(this.zoom,this.zoom);
    ctx.translate(-this.x+(this.shakeX||0)/this.zoom,-this.y+(this.shakeY||0)/this.zoom);
  }

  // A pointer position, in the CSS pixels the browser reports, to world space.
  //
  // The bug this replaces: aim read clientX/clientY straight into
  // screenToWorld, which works in buffer pixels. On a dpr-2 display the buffer
  // is twice the layout size, so the pointer was treated as being half as far
  // from the centre as it really was — the effective crosshair was stuck in
  // the top-left quadrant and only agreed with the cursor at dead centre.
  // Turning on performance mode dropped the buffer to dpr 1 and the aim
  // silently became correct, which is why it read as a graphics setting
  // changing how the game played.
  cssToWorld(cx,cy){
    return this.screenToWorld(cx*(this.pixelScaleX||1),cy*(this.pixelScaleY||1));
  }

  screenToWorld(sx,sy){
    return{
      x:(sx-this.width/2)/this.zoom+this.x,
      y:(sy-this.height/2)/this.zoom+this.y
    };
  }

  worldToScreen(wx,wy){
    return{
      x:(wx-this.x)*this.zoom+this.width/2,
      y:(wy-this.y)*this.zoom+this.height/2
    };
  }

  // Half extents of the visible world rectangle, plus a margin used for
  // culling and for spawning just outside the player's sightline.
  viewHalfWidth(margin=0){return this.width/2/this.zoom+margin}
  viewHalfHeight(margin=0){return this.height/2/this.zoom+margin}

  isVisible(x,y,radius=0){
    return Math.abs(x-this.x)<this.viewHalfWidth(radius+40)&&
           Math.abs(y-this.y)<this.viewHalfHeight(radius+40);
  }

  // A point on the ellipse just beyond the view, for off-screen spawning.
  edgePoint(angle,margin=140){
    return{
      x:this.x+Math.cos(angle)*(this.viewHalfWidth(margin)),
      y:this.y+Math.sin(angle)*(this.viewHalfHeight(margin))
    };
  }

  randomEdgePoint(rng,margin=140){
    return this.edgePoint(rng.next()*TAU,margin);
  }
}

export {lerp,MAX_VISIBLE_WIDTH,MAX_VISIBLE_HEIGHT};
