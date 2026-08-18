export const TAU=Math.PI*2;

export const clamp=(v,min,max)=>v<min?min:v>max?max:v;
export const lerp=(a,b,t)=>a+(b-a)*t;
export const invLerp=(a,b,v)=>a===b?0:(v-a)/(b-a);
export const smoothstep=t=>{const x=clamp(t,0,1);return x*x*(3-2*x)};

// Frame-rate independent exponential approach. `rate` is roughly
// "fraction of the remaining distance closed per second".
export const damp=(a,b,rate,dt)=>lerp(a,b,1-Math.exp(-rate*dt));

export const dist=(ax,ay,bx,by)=>Math.hypot(ax-bx,ay-by);
export const dist2=(ax,ay,bx,by)=>{const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy};

// Shortest signed difference between two angles, in (-PI, PI].
export function angleDelta(from,to){
  let d=(to-from)%TAU;
  if(d>Math.PI)d-=TAU;
  if(d<-Math.PI)d+=TAU;
  return d;
}

export function approachAngle(from,to,maxStep){
  const d=angleDelta(from,to);
  return from+clamp(d,-maxStep,maxStep);
}

export function normalize(x,y){
  const m=Math.hypot(x,y);
  return m>1e-6?{x:x/m,y:y/m,m}:{x:0,y:0,m:0};
}

// Axis-aligned rectangles, stored as centre + half extents.
export function rectOverlap(ax,ay,ahw,ahh,bx,by,bhw,bhh){
  return Math.abs(ax-bx)<ahw+bhw&&Math.abs(ay-by)<ahh+bhh;
}

export function pointInRect(px,py,rx,ry,hw,hh){
  return px>rx-hw&&px<rx+hw&&py>ry-hh&&py<ry+hh;
}

export function circleRectOverlap(cx,cy,r,rx,ry,hw,hh){
  const nx=clamp(cx,rx-hw,rx+hw),ny=clamp(cy,ry-hh,ry+hh);
  return dist2(cx,cy,nx,ny)<r*r;
}

// Push a circle out of an axis-aligned box along the shallowest axis.
// Returns the applied correction, or null when there was no overlap.
export function resolveCircleRect(cx,cy,r,rx,ry,hw,hh){
  const dx=cx-rx,dy=cy-ry;
  const overlapX=hw+r-Math.abs(dx);
  const overlapY=hh+r-Math.abs(dy);
  if(overlapX<=0||overlapY<=0)return null;
  if(overlapX<overlapY)return{x:Math.sign(dx||1)*overlapX,y:0};
  return{x:0,y:Math.sign(dy||1)*overlapY};
}

export function segmentIntersectsRect(x1,y1,x2,y2,rx,ry,hw,hh){
  const left=rx-hw,right=rx+hw,top=ry-hh,bottom=ry+hh;
  if(pointInRect(x1,y1,rx,ry,hw,hh)||pointInRect(x2,y2,rx,ry,hw,hh))return true;
  // Slab clipping against the box.
  let t0=0,t1=1;
  const dx=x2-x1,dy=y2-y1;
  for(const [p,q] of [[-dx,x1-left],[dx,right-x1],[-dy,y1-top],[dy,bottom-y1]]){
    if(Math.abs(p)<1e-9){if(q<0)return false;continue}
    const t=q/p;
    if(p<0){if(t>t1)return false;if(t>t0)t0=t}
    else{if(t<t0)return false;if(t<t1)t1=t}
  }
  return true;
}

// Uniform grid used for broad-phase neighbour queries. Rebuilt each frame;
// far cheaper than the O(n^2) sweeps the previous build ran on every enemy.
export class SpatialHash{
  constructor(cellSize=96){this.cellSize=cellSize;this.cells=new Map()}

  clear(){this.cells.clear()}

  key(cx,cy){return cx*73856093^cy*19349663}

  insert(item){
    const c=this.cellSize;
    const cx=Math.floor(item.x/c),cy=Math.floor(item.y/c);
    const k=this.key(cx,cy);
    let bucket=this.cells.get(k);
    if(!bucket){bucket=[];this.cells.set(k,bucket)}
    bucket.push(item);
  }

  rebuild(items){
    this.clear();
    for(const item of items)this.insert(item);
  }

  // Collect every item within `radius` of (x,y) into `out` (cell granularity,
  // so callers still filter by exact distance).
  query(x,y,radius,out=[]){
    out.length=0;
    const c=this.cellSize;
    const minX=Math.floor((x-radius)/c),maxX=Math.floor((x+radius)/c);
    const minY=Math.floor((y-radius)/c),maxY=Math.floor((y+radius)/c);
    for(let cx=minX;cx<=maxX;cx++)for(let cy=minY;cy<=maxY;cy++){
      const bucket=this.cells.get(this.key(cx,cy));
      if(bucket)for(const item of bucket)out.push(item);
    }
    return out;
  }

  nearest(x,y,radius,filter){
    let best=null,bestD=radius*radius;
    const found=this.query(x,y,radius,scratch);
    for(const item of found){
      if(filter&&!filter(item))continue;
      const d=dist2(x,y,item.x,item.y);
      if(d<bestD){bestD=d;best=item}
    }
    return best;
  }
}

const scratch=[];

// Removes dead entries in place without allocating a new array.
export function compact(list,isAlive){
  let write=0;
  for(let read=0;read<list.length;read++){
    const item=list[read];
    if(isAlive(item))list[write++]=item;
  }
  list.length=write;
  return list;
}

export const formatTime=seconds=>{
  const s=Math.max(0,Math.floor(seconds));
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
};

export const formatDuration=seconds=>{
  const s=Math.max(0,Math.floor(seconds));
  if(s<60)return `${s}s`;
  const h=Math.floor(s/3600);
  return h?`${h}h ${Math.floor(s%3600/60)}m`:`${Math.floor(s/60)}m ${s%60}s`;
};

export const formatNumber=n=>{
  const v=Math.round(n);
  if(Math.abs(v)>=1e6)return `${(v/1e6).toFixed(1)}M`;
  if(Math.abs(v)>=1e4)return `${(v/1e3).toFixed(1)}K`;
  return String(v);
};
