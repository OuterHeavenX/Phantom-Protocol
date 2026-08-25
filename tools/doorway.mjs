// Static geometry audit, run in node against the real world generator.
// Nothing here touches a renderer: it asks the simulation directly.
import {World} from '../src/game/world.js';
import {MAPS} from '../data/maps.js';
import {Rng} from '../src/core/rng.js';

const PLAYER_RADIUS=12;
const SEEDS=Number(process.argv[2]||12);

// Flood fill over a coarse grid of standable cells, from the operative's own
// start. Anything the fill cannot reach is either walled off on purpose (a
// sealed vault) or an accessibility bug.
function reachability(world,radius){
  const cell=24;
  const cols=Math.ceil(world.width/cell),rows=Math.ceil(world.height/cell);
  const open=new Uint8Array(cols*rows);
  let openCount=0;
  for(let cx=0;cx<cols;cx++)for(let cy=0;cy<rows;cy++){
    const x=cx*cell+cell/2,y=cy*cell+cell/2;
    if(world.playable(x,y,radius)&&!world.overlapsSolid(x,y,radius)){
      open[cx*rows+cy]=1;openCount++;
    }
  }
  const start=world.playerSpawn();
  const sx=Math.min(cols-1,Math.max(0,Math.floor(start.x/cell)));
  const sy=Math.min(rows-1,Math.max(0,Math.floor(start.y/cell)));
  const seen=new Uint8Array(cols*rows);
  const stack=[];
  if(open[sx*rows+sy]){stack.push(sx*rows+sy);seen[sx*rows+sy]=1}
  let reached=0;
  while(stack.length){
    const id=stack.pop();reached++;
    const cx=Math.floor(id/rows),cy=id%rows;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=cx+dx,ny=cy+dy;
      if(nx<0||ny<0||nx>=cols||ny>=rows)continue;
      const nid=nx*rows+ny;
      if(seen[nid]||!open[nid])continue;
      seen[nid]=1;stack.push(nid);
    }
  }
  // Cells that are open but unreachable, minus anything inside a vault, which
  // is sealed on purpose until it is breached.
  let stranded=0;
  for(let cx=0;cx<cols;cx++)for(let cy=0;cy<rows;cy++){
    const id=cx*rows+cy;
    if(!open[id]||seen[id])continue;
    if(world.insideVault(cx*cell+cell/2,cy*cell+cell/2,0))continue;
    stranded++;
  }
  return{openCount,reached,stranded,cells:cols*rows};
}

// Every point the simulation may place something, checked for clearance.
function spawnAudit(world,rng){
  let bad=0,checked=0;
  for(let i=0;i<400;i++){
    const p=world.findSpawn(rng,{x:world.width/2,y:world.height/2},0,900,26);
    checked++;
    if(world.overlapsSolid(p.x,p.y,14))bad++;
  }
  const fb=world.fallbackSpawn(30);
  const fallbackBad=world.overlapsSolid(fb.x,fb.y,14)?1:0;
  const start=world.playerSpawn();
  const startBad=world.overlapsSolid(start.x,start.y,PLAYER_RADIUS)?1:0;
  return{checked,bad,fallbackBad,startBad};
}

let totals={stranded:0,spawnBad:0,fallbackBad:0,startBad:0,hazardBad:0,runs:0};
const rows=[];
for(const map of MAPS){
  let stranded=0,spawnBad=0,fallbackBad=0,startBad=0,hazardBad=0,openPct=0;
  for(let s=0;s<SEEDS;s++){
    const seed=1000+s*7919;
    const world=new World(map,new Rng(seed),{});
    const r=reachability(world,PLAYER_RADIUS);
    const a=spawnAudit(world,new Rng(seed^0x5bf03635));
    // A hazard the operative can never stand in is a hazard that does nothing.
    for(const h of world.hazards)if(world.overlapsSolid(h.x,h.y,4))hazardBad++;
    stranded+=r.stranded;spawnBad+=a.bad;fallbackBad+=a.fallbackBad;startBad+=a.startBad;
    openPct+=r.reached/Math.max(1,r.openCount);
    totals.runs++;
  }
  totals.stranded+=stranded;totals.spawnBad+=spawnBad;
  totals.fallbackBad+=fallbackBad;totals.startBad+=startBad;totals.hazardBad+=hazardBad;
  rows.push([map.id,(openPct/SEEDS*100).toFixed(1)+'%',stranded,spawnBad,fallbackBad,startBad,hazardBad]);
}
console.log('theatre     reachable  stranded  spawn-in-wall  fallback-bad  start-bad  hazard-in-wall');
for(const r of rows){
  console.log(r[0].padEnd(11),String(r[1]).padStart(6),String(r[2]).padStart(10),
    String(r[3]).padStart(14),String(r[4]).padStart(13),String(r[5]).padStart(10),String(r[6]).padStart(15));
}
console.log('\nTOTAL over',totals.runs,'generated sectors:',JSON.stringify(totals));

// Second pass: are spawns on ground connected to the operative's?
{
  let unreachable=0,checked=0;
  for(const map of MAPS){
    for(let s=0;s<6;s++){
      const seed=7000+s*104729;
      const world=new World(map,new Rng(seed),{});
      const rng=new Rng(seed^0x1234567);
      for(let i=0;i<200;i++){
        const p=world.findSpawn(rng,{x:world.playerSpawn().x,y:world.playerSpawn().y},400,1000,26);
        checked++;
        if(!world.reachable(p.x,p.y))unreachable++;
      }
    }
  }
  console.log(`\nspawn reachability: ${unreachable} of ${checked} deployed onto ground not connected to the operative's`);
}
