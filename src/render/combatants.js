// Blender-authored directional sprites. One shared asynchronous cache survives
// menu/run transitions. Missing files retain the complete vector fallback.
const BASE=new URL('../../assets/sprites/combatants/',import.meta.url);
const actors=new Map();
let loading;
let manifest;

export function loadCombatants(){
  if(loading)return loading;
  loading=fetch(new URL('manifest.json',BASE))
    .then(response=>{if(!response.ok)throw new Error('Combatant manifest unavailable');return response.json()})
    .then(async data=>{
      manifest=data;
      await Promise.all(Object.entries(data.actors).map(async([key,spec])=>{
        const image=new Image();
        image.src=new URL(spec.file,BASE).href;
        try{
          await image.decode();
          if(image.width!==data.frameSize*data.directions||image.height!==data.frameSize*data.poses)return;
          // Cache a damage silhouette once; never apply expensive CSS filters
          // to individual actors in the combat loop.
          const flash=document.createElement('canvas');
          flash.width=image.width;flash.height=image.height;
          const c=flash.getContext('2d');
          c.drawImage(image,0,0);c.globalCompositeOperation='source-in';
          c.fillStyle='#ffffff';c.fillRect(0,0,flash.width,flash.height);
          actors.set(key,{image,flash,...spec});
        }catch{/* An unavailable actor uses its procedural rendering. */}
      }));
      return actors.size;
    }).catch(()=>0);
  return loading;
}

// Called in world coordinates, before the old sprite's facing transform.
export function drawCombatant(ctx,key,entity,{phase=0,moving=false,scale=1}={}){
  const actor=actors.get(key);
  if(!actor||!manifest)return false;
  const {frameSize:size,directions,poses}=manifest;
  const angle=Number.isFinite(entity.angle)?entity.angle:0;
  const direction=((Math.round(angle/(Math.PI*2)*directions)%directions)+directions)%directions;
  const pose=moving?((Math.floor(phase/(Math.PI*2)*poses)%poses)+poses)%poses:0;
  const width=entity.radius*5.6*scale;
  const bob=entity.flying?Math.sin(phase)*1.3:0;
  ctx.save();
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(entity.hitFlash>0?actor.flash:actor.image,direction*size,pose*size,size,size,
    entity.x-width*actor.anchor[0],entity.y-width*actor.anchor[1]+bob,width,width);
  ctx.restore();
  return true;
}

export function combatantStatus(){return {loaded:actors.size,expected:manifest?Object.keys(manifest.actors).length:0}}
