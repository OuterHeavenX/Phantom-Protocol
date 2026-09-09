import assert from 'node:assert/strict';
import {World} from '../src/game/world.js';
import {SpatialHash} from '../src/core/math.js';
import {MAPS} from '../data/maps.js';
import {Rng} from '../src/core/rng.js';
import {Mission} from '../src/game/mission.js';
import {CAMPAIGN} from '../data/campaign.js';
const levels=['blacksite','crossfall','hollow'];

// The regression: the end of a long wall used to be absent from local queries.
const long={x:1500,y:500,hw:1400,hh:25};
const hash=new SpatialHash(140);hash.insertBounds(long);
assert.equal(hash.query(110,500,30).includes(long),true);
assert.equal(hash.query(2890,500,30).includes(long),true);
assert.equal(hash.query(1500,500,2000).length,1,'Broad-phase duplicates must not push an actor twice');
hash.clear();hash.insert(long);assert.equal(hash.query(1500,500,40).length,1);
const collisionWorld=new World(MAPS[0],{seed:412});
collisionWorld.width=3200;collisionWorld.height=2000;
collisionWorld.walls=[{...long,w:2800,h:50,blocksSight:true}];collisionWorld.cover=[];collisionWorld.rebuildHash();
for(const x of [115,1500,2885]){
  const actor={x,y:530,radius:12};
  assert(collisionWorld.resolveCollision(actor),'Wall must physically stop movement at its ends');
  assert.equal(actor.y,537);
  assert.equal(collisionWorld.hasLineOfSight(x,450,x,550),false);
}

function reachable(world){
  const cell=32,cols=Math.ceil(world.width/cell),rows=Math.ceil(world.height/cell);
  const seen=new Set(),blocked=new Map();
  const valid=(x,y)=>{
    if(x<0||y<0||x>=cols||y>=rows)return false;
    const key=y*cols+x;
    if(!blocked.has(key))blocked.set(key,world.playable(x*cell,y*cell,18)&&!world.overlapsSolid(x*cell,y*cell,18));
    return blocked.get(key);
  };
  const nearest=p=>{
    const x=Math.round(p.x/cell),y=Math.round(p.y/cell);
    for(let r=0;r<=2;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(valid(x+dx,y+dy))return [x+dx,y+dy];
    return null;
  };
  const start=nearest(world.playerSpawn());assert(start,'Spawn must be walkable');
  const queue=[start];seen.add(start[1]*cols+start[0]);
  for(let i=0;i<queue.length;i++){
    const [x,y]=queue[i];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy,key=ny*cols+nx;
      if(!seen.has(key)&&valid(nx,ny)){seen.add(key);queue.push([nx,ny])}
    }
  }
  return p=>{const q=nearest(p);return q&&seen.has(q[1]*cols+q[0])};
}

const report=[];
for(const id of levels)for(const seed of [1,17,412,90210,481516])for(const sizeMult of [.75+5/28,1.3,1.6]){
  const world=new World(MAPS.find(m=>m.id===id),{seed,sizeMult});
  const canReach=reachable(world),spawn=world.playerSpawn();
  assert(world.vaults.length>=2,id+' lost its sealed vaults');
  assert(!world.overlapsSolid(spawn.x,spawn.y,18),id+' spawn obstructed');
  assert(canReach(world.extractionPoint(spawn)),id+' extraction disconnected');
  const mission=new Mission({world,rng:new Rng(seed),announce:()=>{}},CAMPAIGN.find(o=>o.map===id).objective);
  if(id==='crossfall')assert.equal(mission.caches.length,3,'All three fragments must spawn');
  for(const cache of mission.caches)assert(canReach(cache),id+' mission cache disconnected');
  if(mission.asset)assert(canReach(mission.asset),id+' rescue asset disconnected');
  for(const door of world.doorways){
    assert(!world.overlapsSolid(door.x,door.y,18),id+' doorway blocked');
    assert(canReach(door),id+' doorway disconnected');
  }
  for(const room of world.rooms)if(!world.overlapsSolid(room.x,room.y,20))assert(canReach(room),id+' room disconnected');
  for(const wall of world.walls.filter(w=>w.type!=='perimeter')){
    for(const t of [-.9,0,.9]){
      const x=wall.x+wall.hw*t,y=wall.y+wall.hh+3;
      assert(world.obstacleHash.query(x,y,32).includes(wall),id+' wall absent from broad phase');
      assert(world.raycastObstacle(x,wall.y-wall.hh-10,x,wall.y+wall.hh+10),id+' shot passed through wall');
    }
  }
  const rng=new Rng(seed+70);
  for(let i=0;i<25;i++){
    const point=world.findSpawn(rng,spawn,400,1400);
    assert(canReach(point),id+' reinforcement disconnected');
  }
  report.push({id,seed,sizeMult,walls:world.walls.length,vaults:world.vaults.length});
}
console.log(JSON.stringify({passed:report.length+' generated sectors',report},null,2));
