// Wall-clipping stress test, run directly against the collision code.
//
// Drives a body with the operative's radius at dash speed into geometry from
// every direction, and counts two failures:
//
//   tunnel — the body crossed a solid's centre plane in one step while inside
//            that solid's other axis span. That is passing through a wall,
//            whatever the end position looks like.
//   sunk   — the body finished a step buried more than half its radius inside
//            solid geometry.
//
// `--legacy` runs the old integrate-then-depenetrate path for comparison.
import {World} from '../src/game/world.js';
import {MAPS} from '../data/maps.js';
import {Rng} from '../src/core/rng.js';

const LEGACY=process.argv.includes('--legacy');
const RADIUS=12;
const DASH=250*1.5*4.2;
const STEP=1/60;
const STEPS=Number(process.argv[2]||6000);

// Strictly within the face span at BOTH ends, so a body that went round the
// short end of a wall segment — legal movement — is not counted as a tunnel.
// The looser +RADIUS version of this produced false positives on the arena
// ring, which is built from short segments with gaps between them.
function crossed(prev,cur,o){
  const spanY=Math.abs(prev.y-o.y)<o.hh&&Math.abs(cur.y-o.y)<o.hh;
  if(spanY&&(prev.x-o.x)*(cur.x-o.x)<0)return true;
  const spanX=Math.abs(prev.x-o.x)<o.hw&&Math.abs(cur.x-o.x)<o.hw;
  return spanX&&(prev.y-o.y)*(cur.y-o.y)<0;
}

let totals={tunnel:0,sunk:0,steps:0};
const rows=[];
for(const map of MAPS){
  let tunnel=0,sunk=0;
  for(let s=0;s<3;s++){
    const seed=311+s*15485863;
    const world=new World(map,new Rng(seed),{});
    const rng=new Rng(seed^0xabcdef);
    const start=world.playerSpawn();
    const body={x:start.x,y:start.y,radius:RADIUS};
    const solids=[...world.walls,...world.cover.filter(c=>!c.broken)];
    for(let i=0;i<STEPS;i++){
      let angle;
      if(i%4===0){
        angle=rng.angle();
      }else if(i%4===1){
        // Straight at the nearest solid's centre.
        let best=null,bestD=Infinity;
        for(const o of solids){
          const d=(o.x-body.x)**2+(o.y-body.y)**2;
          if(d<bestD){bestD=d;best=o}
        }
        angle=best?Math.atan2(best.y-body.y,best.x-body.x)+rng.range(-.35,.35):rng.angle();
      }else{
        // At a random point along a long solid's FACE, then teleport to just
        // outside it and charge. Aiming only at centres is what let a
        // centre-only spatial hash pass this test while the operative walked
        // through the middle of every long wall in the game: the contact point
        // that mattered was hundreds of units from the centre the broad phase
        // was indexed by.
        const long=solids.filter(o=>Math.max(o.hw,o.hh)>90);
        const o=long.length?long[Math.floor(rng.next()*long.length)]
                           :solids[Math.floor(rng.next()*solids.length)];
        if(o){
          const alongX=o.hw>o.hh;
          const t=rng.range(-.85,.85);
          const side=rng.next()<.5?-1:1;
          const tx=alongX?o.x+o.hw*t:o.x+side*(o.hw+RADIUS+18);
          const ty=alongX?o.y+side*(o.hh+RADIUS+18):o.y+o.hh*t;
          if(!world.overlapsSolid(tx,ty,RADIUS)&&world.playable(tx,ty,20)){
            body.x=tx;body.y=ty;
          }
          angle=Math.atan2(o.y-body.y,o.x-body.x);
        }else angle=rng.angle();
      }
      const prev={x:body.x,y:body.y};
      const dx=Math.cos(angle)*DASH*STEP,dy=Math.sin(angle)*DASH*STEP;
      if(LEGACY){
        body.x+=dx;body.y+=dy;
        world.resolveCollision(body,RADIUS);
      }else{
        world.moveEntity(body,dx,dy,RADIUS);
      }
      totals.steps++;
      for(const o of solids)if(crossed(prev,body,o)){tunnel++;break}
      if(world.overlapsSolid(body.x,body.y,RADIUS*.5))sunk++;
    }
  }
  totals.tunnel+=tunnel;totals.sunk+=sunk;
  rows.push([map.id,tunnel,sunk]);
}
console.log((LEGACY?'LEGACY integrate-then-push':'SWEPT moveEntity')+
  `  -  ${totals.steps} dash steps at ${Math.round(DASH)} units/s\n`);
console.log('theatre      tunnelled  sunk-in-geometry');
for(const [id,t,k] of rows)console.log(id.padEnd(12),String(t).padStart(9),String(k).padStart(17));
console.log('\nTOTAL       ',String(totals.tunnel).padStart(9),String(totals.sunk).padStart(17));
