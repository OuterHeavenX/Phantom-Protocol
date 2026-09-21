// Dump the authored opening level from the 2D game as JSON.
//
// op1 is no longer procedurally generated: src/game/opening-levels.js builds
// Blacksite Zero as nine named rooms on a 3x3 grid. Exporting it, rather than
// re-deriving it in GDScript, is what makes the 3D build provably the same
// level — walls, cover, doorways, lamps and their authored heights included.
import {World} from '../../src/game/world.js';
import {MAPS_BY_ID} from '../../data/maps.js';

const seed=Number(process.argv[2]||1234);
const world=new World(MAPS_BY_ID.blacksite,{seed,sizeMult:1});
const round3=n=>+Number(n).toFixed(3);
const rect=o=>({x:round3(o.x),y:round3(o.y),w:round3(o.w),h:round3(o.h),
  type:o.type,height:round3(o.height??(o.type==='perimeter'?90:64)),
  blocksSight:o.blocksSight!==false,destructible:!!o.destructible});

const out={
  seed,width:world.width,height:world.height,
  architecture:world.architecture||null,
  spawn:world.spawnPoint?{x:round3(world.spawnPoint.x),y:round3(world.spawnPoint.y)}:null,
  extraction:null,
  walls:world.walls.map(rect),
  cover:world.cover.filter(c=>!c.broken).map(rect),
  floorZones:(world.floorZones||[]).map(z=>({x:round3(z.x),y:round3(z.y),w:round3(z.w),h:round3(z.h),label:z.label,style:z.style})),
  doorways:(world.doorways||[]).map(d=>({x:round3(d.x),y:round3(d.y),w:round3(d.w),h:round3(d.h),vertical:!!d.vertical})),
  lights:(world.structureLights||[]).map(l=>({x:round3(l.x),y:round3(l.y),color:l.color,radius:round3(l.radius)})),
  hazards:world.hazards.map(h=>({id:h.id,x:round3(h.x),y:round3(h.y),radius:round3(h.radius),passive:!!h.passive,color:h.color})),
  rooms:world.rooms.map(r=>({x:round3(r.x),y:round3(r.y),w:round3(r.w),h:round3(r.h)}))
};
const ep=world.extractionPoint?.(world.spawnPoint);
if(ep)out.extraction={x:round3(ep.x),y:round3(ep.y)};
process.stdout.write(JSON.stringify(out,null,1));
