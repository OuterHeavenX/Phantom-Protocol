// Authored environment art: manifest loader, sprite resolution and the
// three-slice wall blitter.
//
// A theatre is procedural until somebody paints it. This module is the seam
// between the two: it looks for an art pack, and if it finds one the renderer
// blits sprites where it used to draw rectangles. Nothing here changes what
// the world *is* — geometry, collision and generation are untouched. It only
// changes what a wall looks like once a wall has a picture.
//
// Three rules govern the design:
//
//   1. Absence is normal, not an error. A theatre with no pack is the default
//      state of this project, so a missing manifest resolves quietly to
//      `absent` and every draw path stays on its procedural branch forever.
//   2. Loading never blocks a frame. The renderer's constructor is synchronous
//      and the first `render()` runs on the next animation frame, long before
//      any image decodes. `active` stays false until the whole pack has
//      resolved, so a frame is either fully procedural or fully authored —
//      never half-dressed.
//   3. Failure degrades per key. One 404 inside an otherwise good pack drops
//      that one sprite; the piece it would have covered draws procedurally and
//      the rest of the theatre is unaffected.
//
// ---------------------------------------------------------------------------
// Manifest format
// ---------------------------------------------------------------------------
//
// A theatre opts in by setting `art` in its `data/maps.js` definition. Without
// it no request is made at all, so the game does not spend a round trip per
// contract probing for files that do not exist yet. Shipping a pack is
// therefore two steps: drop the directory in, then set the flag.
//
//   art:true      the pack directory is named after the theatre id
//   art:'a name'  the pack directory is named explicitly, for a directory that
//                 does not match the id
//
// The manifest is looked for at
// `assets/sprites/environment/<pack>/manifest.json`. Paths inside it are
// relative to that directory, and every URL is passed through `encodeURI`, so
// a directory or file name containing spaces resolves without being renamed.
//
//   {
//     "theatre": "blacksite",
//     "version": 1,
//     "shadows": true,
//     "sprites": {
//       "floor":       {"src":"floor/floor-tile.webp","world":[128,128]},
//
//       "wall.h":      {"cap":26,"world":[32,26],"slice":{
//                         "capA":"walls/wall-h-cap-l.webp",
//                         "mid":"walls/wall-h-mid.webp",
//                         "capB":"walls/wall-h-cap-r.webp"}},
//       "wall.v":      {"cap":26,"world":[26,32],"slice":{
//                         "capA":"walls/wall-v-cap-t.webp",
//                         "mid":"walls/wall-v-mid.webp",
//                         "capB":"walls/wall-v-cap-b.webp"}},
//
//       "cover.crate": {"variants":["cover/crate-0.webp","cover/crate-1.webp",
//                                   "cover/crate-2.webp","cover/crate-3.webp"]},
//       "cover.pillar":    {"src":"cover/pillar.webp"},
//       "cover.barrier":   {"src":"cover/barrier.webp"},
//       "cover.machinery": {"src":"cover/machinery.webp"},
//       "cover.lowcover":  {"src":"cover/lowcover.webp"},
//       "cover.container": {"src":"cover/container.webp"},
//
//       "vault.wall.h":       {"src":"vault/chamber-wall-h.webp"},
//       "vault.wall.v":       {"src":"vault/chamber-wall-v.webp"},
//       "vault.seal.h":       {"src":"vault/seal-h-sealed.webp"},
//       "vault.seal.h.found": {"src":"vault/seal-h-found.webp"},
//       "vault.seal.v":       {"src":"vault/seal-v-sealed.webp"},
//       "vault.seal.v.found": {"src":"vault/seal-v-found.webp"},
//       "vault.sigil":        {"src":"vault/sigil-sealed.webp"},
//       "vault.sigil.open":   {"src":"vault/sigil-open.webp"},
//
//       "hazard.steamVent.dormant":     {"src":"hazards/steam-dormant.webp"},
//       "hazard.steamVent.active":      {"src":"hazards/steam-active.webp"},
//       "hazard.electricFloor.dormant": {"src":"hazards/live-dormant.webp"},
//       "hazard.electricFloor.active":  {"src":"hazards/live-active.webp"},
//
//       "decor.0": {"src":"decor/decor-0.webp"}
//     }
//   }
//
// `world` is the sprite's footprint in world units. It matters in exactly two
// places: the floor tile, where it sets the repeat period, and a wall slice,
// where it sets the tiling step of the middle piece. Everywhere else the
// renderer already knows the footprint from the collider and the sprite is
// simply stretched to it, so `world` may be omitted.
//
// `variants` is an ordered list selected by the `variant` field the world
// generator already stores on every wall and cover piece (0..3). A single
// `src` is shorthand for a one-entry list.
//
// `shadows` (default true) keeps the engine's faux-height drop shadow under
// authored pieces. Set it false when the pack bakes its own shadows in, or the
// two will stack.

const MANIFEST='manifest.json';

export class EnvironmentArt{
  constructor(pack,options={}){
    // The pack directory name, which is usually but not always the theatre id.
    this.pack=pack||null;
    this.root=options.root||(this.pack?`./assets/sprites/environment/${this.pack}/`:null);
    this.entries=new Map();
    // idle -> loading -> active | absent. `absent` is terminal and is by far
    // the most common outcome: it means this theatre has no art pack. A theatre
    // that never opted in starts there and never leaves.
    this.state=this.root?'idle':'absent';
    this.shadows=true;
    this.disposed=false;
  }

  // True only when a manifest resolved and at least one sprite decoded. Every
  // caller in the renderer tests this before looking anything up, so a single
  // false here puts the whole theatre back on its procedural path.
  get active(){return this.state==='active'}

  has(key){return this.active&&this.entries.has(key)}

  // Resolve one sprite, picking a variant when the pack ships more than one.
  // `variant` is the value the generator stored on the piece, so a given crate
  // keeps the same face for the whole contract and across a reload of the same
  // seed. Out-of-range indices wrap rather than fail, which lets a pack ship
  // two variants against the generator's four.
  image(key,variant=0){
    if(!this.active)return null;
    const entry=this.entries.get(key);
    if(!entry||entry.kind!=='sprite')return null;
    const images=entry.images;
    return images[((variant%images.length)+images.length)%images.length];
  }

  // A three-piece wall set, or null. Returned whole because the blitter needs
  // the caps, the middle and the tiling step together. A pack may ship variant
  // sets as `wall.h.0`, `wall.h.1` and so on; an unsuffixed key covers the
  // whole theatre when it ships only one.
  slice(key,variant=null){
    if(!this.active)return null;
    const entry=(variant!==null&&this.entries.get(`${key}.${variant}`))||this.entries.get(key);
    return entry&&entry.kind==='slice'?entry:null;
  }

  // ---- Loading ------------------------------------------------------------

  async load(){
    if(this.state!=='idle'||!this.root)return this;
    this.state='loading';

    let manifest=null;
    try{
      const response=await fetch(encodeURI(this.root+MANIFEST),{cache:'force-cache'});
      if(!response.ok)throw new Error(`manifest ${response.status}`);
      manifest=await response.json();
    }catch(err){
      // No pack for this theatre. This is the expected case while the game is
      // still procedural, so it is not logged as a failure.
      this.state='absent';
      return this;
    }

    if(this.disposed){this.state='absent';return this}
    this.shadows=manifest.shadows!==false;

    const sprites=manifest.sprites||{};
    await Promise.all(
      Object.keys(sprites).map(key=>this.resolve(key,sprites[key]))
    );

    if(this.disposed){this.entries.clear();this.state='absent';return this}
    // A manifest that listed sprites but decoded none is indistinguishable
    // from having no pack at all, and is treated as such.
    this.state=this.entries.size>0?'active':'absent';
    return this;
  }

  async resolve(key,spec){
    if(!spec)return;
    const world=Array.isArray(spec.world)&&spec.world.length===2?spec.world:null;

    if(spec.slice){
      const [capA,mid,capB]=await Promise.all([
        this.loadImage(spec.slice.capA),
        this.loadImage(spec.slice.mid),
        this.loadImage(spec.slice.capB)
      ]);
      // A partial slice cannot be blitted — half a wall is worse than none, so
      // the whole key falls back rather than shipping a gap.
      if(!capA||!mid||!capB)return;
      this.entries.set(key,{kind:'slice',capA,mid,capB,world,cap:spec.cap>0?spec.cap:0});
      return;
    }

    const sources=Array.isArray(spec.variants)&&spec.variants.length
      ?spec.variants
      :[spec.src];
    const loaded=await Promise.all(sources.map(src=>this.loadImage(src)));
    const images=loaded.filter(Boolean);
    if(!images.length)return;
    this.entries.set(key,{kind:'sprite',images,world});
  }

  loadImage(src){
    if(!src)return Promise.resolve(null);
    return new Promise(resolve=>{
      const image=new Image();
      image.decoding='async';
      // A broken file drops one sprite, never the pack and never the frame.
      image.onload=()=>resolve(image.naturalWidth>0?image:null);
      image.onerror=()=>resolve(null);
      image.src=encodeURI(this.root+src);
    });
  }

  // ---- Floor --------------------------------------------------------------

  // The floor is the one asset drawn as a repeating pattern rather than a
  // blit, so it needs its own build step. The tile is authored at some
  // multiple of its world footprint and the pattern has to be mapped back down
  // to world units: `CanvasPattern.setTransform` does that for free, and where
  // it is missing (Safari below 14.1) the tile is resampled once into a 1:1
  // canvas instead. Either way the per-frame cost stays a single fillRect.
  buildFloorPattern(ctx){
    const entry=this.active?this.entries.get('floor'):null;
    if(!entry||entry.kind!=='sprite')return null;
    const image=entry.images[0];
    const [worldW,worldH]=entry.world||[image.naturalWidth,image.naturalHeight];
    if(!(worldW>0&&worldH>0)||!image.naturalWidth||!image.naturalHeight)return null;

    const sx=worldW/image.naturalWidth;
    const sy=worldH/image.naturalHeight;
    if(sx===1&&sy===1)return ctx.createPattern(image,'repeat');

    if(typeof DOMMatrix!=='undefined'&&
       typeof CanvasPattern!=='undefined'&&CanvasPattern.prototype.setTransform){
      const pattern=ctx.createPattern(image,'repeat');
      if(pattern){
        pattern.setTransform(new DOMMatrix().scale(sx,sy));
        return pattern;
      }
    }

    // Resample fallback: one draw at load time, nothing per frame.
    const tile=document.createElement('canvas');
    tile.width=Math.max(1,Math.round(worldW));
    tile.height=Math.max(1,Math.round(worldH));
    const tctx=tile.getContext('2d');
    tctx.imageSmoothingEnabled=true;
    tctx.drawImage(image,0,0,tile.width,tile.height);
    return ctx.createPattern(tile,'repeat');
  }

  // Marks a pack stale so a load that lands after the session tore down cannot
  // write into a dead renderer or build a pattern on a released context.
  dispose(){
    this.disposed=true;
    this.entries.clear();
    if(this.state!=='loading')this.state='absent';
  }
}

// ---------------------------------------------------------------------------
// Blitters
// ---------------------------------------------------------------------------

// Every authored draw goes through here so smoothing is set explicitly. The
// renderer leaves `imageSmoothingEnabled` wherever the last block that cared
// about it left it, which is fine while nothing in the geometry pass is an
// image and a silent source of softness the moment something is.
export function drawSprite(ctx,image,x,y,w,h){
  if(!image||!(w>0)||!(h>0))return false;
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(image,x,y,w,h);
  return true;
}

// Three-slice a wall along its long axis.
//
// Generated wall segments are continuous reals — measured across 120 seeds of
// Blacksite they run from 35 to 695 world units at a fixed 26-unit thickness,
// spread near-uniformly with no modal length. A stretched sprite would smear
// at up to 27:1, so the middle piece tiles at its authored world step and the
// last tile is cut with a source rect rather than squashed.
//
// Short segments are the awkward case. Blacksite generates horizontal walls as
// short as 35 world units, well under the 26 + 32 + 26 a full three-slice needs,
// so a pair of caps has to fit somewhere that cannot hold them. They are cut
// rather than squashed: each cap keeps its authored pixels-per-unit scale and
// its outer end — the end that reads as the end of a wall — and gives up its
// inner edge to a source rect. The middle is skipped entirely.
export function drawSlicedWall(ctx,entry,x,y,w,h,horizontal){
  if(!entry)return false;
  const length=horizontal?w:h;
  const thickness=horizontal?h:w;
  if(!(length>0)||!(thickness>0))return false;

  // The blit is never an upscale — a slice is authored at four source pixels
  // per world unit and the camera tops out at four device pixels per world
  // unit — so smoothing is wanted on every path, and is set here rather than
  // inherited from whichever block last happened to touch it. Saved and
  // restored so the geometry pass hands back the state it was given.
  ctx.save();
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';

  const capWorld=entry.cap>0?entry.cap:thickness;
  const cap=Math.min(capWorld,length/2);
  const span=length-cap*2;

  if(cap>0){
    const capA=entry.capA,capB=entry.capB;
    // Full-size caps blit whole; a cap that had to be trimmed takes the same
    // fraction off its source, keeping the art at its authored scale.
    const fraction=cap/capWorld;
    const sa=horizontal?capA.naturalWidth:capA.naturalHeight;
    const sb=horizontal?capB.naturalWidth:capB.naturalHeight;
    const cutA=Math.min(sa,sa*fraction);
    const cutB=Math.min(sb,sb*fraction);
    if(horizontal){
      ctx.drawImage(capA,0,0,cutA,capA.naturalHeight,x,y,cap,h);
      // capB keeps its right-hand end, so the source window starts at its far
      // edge and runs back to meet the middle.
      ctx.drawImage(capB,sb-cutB,0,cutB,capB.naturalHeight,x+length-cap,y,cap,h);
    }else{
      ctx.drawImage(capA,0,0,capA.naturalWidth,cutA,x,y,w,cap);
      ctx.drawImage(capB,0,sb-cutB,capB.naturalWidth,cutB,x,y+length-cap,w,cap);
    }
  }
  if(!(span>0)){ctx.restore();return true}

  const mid=entry.mid;
  const step=entry.world?(horizontal?entry.world[0]:entry.world[1]):thickness;
  // A zero or negative step would spin forever; fall back to one stretched
  // middle rather than hanging the frame.
  if(!(step>0)){
    if(horizontal)ctx.drawImage(mid,x+cap,y,span,h);
    else ctx.drawImage(mid,x,y+cap,w,span);
    ctx.restore();
    return true;
  }

  let drawn=0;
  while(drawn<span){
    const remain=span-drawn;
    const piece=Math.min(step,remain);
    // The final partial tile is cut from the source rather than compressed, so
    // the seam pattern stays on its authored pitch all the way to the cap.
    const sw=piece<step?mid.naturalWidth*(horizontal?piece/step:1):mid.naturalWidth;
    const sh=piece<step?mid.naturalHeight*(horizontal?1:piece/step):mid.naturalHeight;
    if(horizontal)ctx.drawImage(mid,0,0,sw,sh,x+cap+drawn,y,piece,h);
    else ctx.drawImage(mid,0,0,sw,sh,x,y+cap+drawn,w,piece);
    drawn+=piece;
  }
  ctx.restore();
  return true;
}
