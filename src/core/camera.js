import {clamp,damp,lerp,TAU} from './math.js';

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
    this.shake=0;this.shakeDecay=3.2;
    this.offsetX=0;this.offsetY=0;
    this.lookAhead=90;
    this.rotation=0;
    this.enabled=true;
    this.trauma=0;
    this.time=0;
  }

  resize(width,height){
    this.width=width;this.height=height;
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
    const leadX=aim?aim.x*this.lookAhead:0;
    const leadY=aim?aim.y*this.lookAhead:0;
    this.offsetX=damp(this.offsetX,leadX,3,dt);
    this.offsetY=damp(this.offsetY,leadY,3,dt);
    this.x=damp(this.x,target.x+this.offsetX,9,dt);
    this.y=damp(this.y,target.y+this.offsetY,9,dt);
  }

  // `amount` is trauma in 0..1; shake magnitude scales with its square so
  // small hits stay subtle while big ones land hard.
  addShake(amount){
    this.trauma=clamp(this.trauma+amount,0,1);
  }

  punchZoom(amount){
    this.targetZoom=clamp(this.targetZoom+amount,.7,1.6);
  }

  update(dt,intensity=1){
    this.time+=dt;
    this.trauma=Math.max(0,this.trauma-this.shakeDecay*dt*.55);
    const t=this.trauma*this.trauma*intensity;
    const f=this.time*34;
    this.shakeX=Math.sin(f*1.13)*t*26;
    this.shakeY=Math.cos(f*0.97)*t*22;
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
