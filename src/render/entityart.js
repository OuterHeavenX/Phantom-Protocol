// Authored entity art.
//
// Renders produced by tools/blender/render.py, drawn in place of the
// procedural sprite routine where one exists.
//
// Three rules govern what is baked and what is not:
//
// 1. **Moving parts stay procedural.** A boss's legs are animated from its
//    gait and walk phase, and a gunship's rotor disc from its spin rate.
//    Baking either would freeze it — a walker that glides is the single most
//    obvious way to make an expensive asset look cheap. So these images are
//    hulls, and the runtime still draws the parts that move.
// 2. **Nothing is required.** Every entity keeps its procedural routine, and
//    that routine draws until the image has decoded — and forever, if the
//    image is missing or fails. A dropped asset degrades to the art that
//    shipped before it rather than to a hole in the sector.
// 3. **Runtime colour still works.** Elites, cloaking and the walker's
//    accumulated damage all recolour entities from `enemy.color`, which a flat
//    PNG cannot do. Tinting is applied through a small cache of pre-composited
//    canvases rather than per frame.

// `ref` is the collision radius the image was rendered for. Drawing scales by
// `radius/ref`, so an elite at 1.5x scale gets a bigger sprite rather than a
// stretched one, and re-rendering at a different size needs no code change.
export const ENTITY_ART={
  chopper:{file:'gunship.png',ref:26},
  apc:{file:'carrier.png',ref:30},
  soldier:{file:'soldier.png',ref:11}
};

export const BOSS_ART={
  manticore:{file:'manticore.png',ref:52},
  carrion:{file:'carrion.png',ref:56},
  aegis:{file:'aegis.png',ref:54},
  arbiter:{file:'arbiter.png',ref:54}
};

const ROOT='assets/sprites/entities/';

// Decoded images, keyed by file. A miss returns null and the caller falls back;
// it never blocks a frame waiting for a decode.
const images=new Map();
// Tinted variants, keyed by file + colour. Bounded by the number of distinct
// colours the game actually uses, which is small — elites and the base
// archetypes — so this fills once and is read thereafter.
const tinted=new Map();

// A page can start with the layer off. Used by the alignment harness, which
// locates entities by tinting them and therefore has to measure the procedural
// path; the art layer's own alignment is asserted separately.
let enabled=typeof window==='undefined'||!window.__ppDisableEntityArt;

// Off switches the whole layer back to the procedural art, which is what the
// harness uses to compare the two and what a player would want if the authored
// art ever looked worse to them than what it replaced.
export function setEntityArtEnabled(on){enabled=!!on}
export function entityArtEnabled(){return enabled}

function load(file){
  if(images.has(file))return images.get(file);
  // Placed in the map immediately, so a second request during the same frame
  // does not start a second download.
  images.set(file,null);
  if(typeof Image==='undefined')return null;
  const img=new Image();
  img.decoding='async';
  img.onload=()=>{images.set(file,img)};
  // Left as null on failure rather than retried. A missing asset is a build
  // problem, and retrying it every frame turns one into a stall.
  img.onerror=()=>{images.set(file,null)};
  img.src=ROOT+file;
  return null;
}

// The art for a render kind, or null to draw procedurally.
export function entityArt(kind,boss=false){
  if(!enabled)return null;
  const spec=(boss?BOSS_ART:ENTITY_ART)[kind];
  if(!spec)return null;
  const img=load(spec.file);
  return img?{img,ref:spec.ref}:null;
}

// A colour-shifted copy, cached.
//
// `source-atop` over the sprite keeps its shading and alpha and shifts only the
// hue, which is what the procedural routines achieve by drawing in the colour
// directly. Done at a low alpha: a full wash flattens the render into a
// silhouette and throws away the thing that made it worth baking.
export function tintedArt(img,file,color,strength=.45){
  if(!color)return img;
  const key=file+'|'+color+'|'+strength;
  const hit=tinted.get(key);
  if(hit)return hit;
  if(typeof document==='undefined')return img;
  const c=document.createElement('canvas');
  c.width=img.naturalWidth||img.width;
  c.height=img.naturalHeight||img.height;
  const ctx=c.getContext('2d');
  ctx.drawImage(img,0,0);
  ctx.globalCompositeOperation='source-atop';
  ctx.globalAlpha=strength;
  ctx.fillStyle=color;
  ctx.fillRect(0,0,c.width,c.height);
  tinted.set(key,c);
  return c;
}

// Whether an entity's sprite should be recoloured, and with what.
//
// A function rather than an expression at the call site, so the policy can be
// asserted directly. Buried in the draw call it was only observable through
// the pixels it produced — and elites carry colour-based decoration outside
// this layer, which differs between two colours whether or not the sprite is
// tinted at all, so those pixels could not tell the two apart.
export function tintFor(entity){
  // Elites are the case that matters: they are drawn in their own colour and
  // must keep reading as elites rather than as a bigger version of the base
  // archetype. Everything else takes the render as authored.
  if(entity&&entity.elite&&entity.color)return{color:entity.color,tint:.4};
  return{color:null,tint:0};
}

// Draw a hull, centred on the current transform.
//
// The caller has already translated to the entity and rotated by its facing,
// exactly as it does for the procedural routine — so this is a straight
// centred blit and the two paths cannot disagree about where an entity is.
export function drawEntityArt(ctx,art,radius,{color=null,file=null,tint=0}={}){
  const scale=radius/art.ref;
  const source=tint>0&&color&&file?tintedArt(art.img,file,color,tint):art.img;
  const w=(source.naturalWidth||source.width)*scale;
  const h=(source.naturalHeight||source.height)*scale;
  ctx.drawImage(source,-w/2,-h/2,w,h);
}

// Test seam. Lets a harness prove the fallback path without a network failure.
export function __clearEntityArtCache(){images.clear();tinted.clear()}
