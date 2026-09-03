import {Rng} from '../core/rng.js';
import {clamp,dist2,TAU,segmentIntersectsRect,segmentRectEntry,resolveCircleRect,pointInRect,SpatialHash} from '../core/math.js';
import {HAZARDS} from '../../data/maps.js';
import {vaultKind,rollVaultKind} from '../../data/vaults.js';

// Ceiling on how finely one frame's movement is chopped up for collision. A
// normal step needs one; a dash needs three. The cap exists so a velocity
// nothing in the game should ever produce cannot turn a frame into hundreds of
// obstacle queries.
const MAX_MOVE_SUBSTEPS=8;

// Clearance the operative's start needs. Comfortably more than the 12-unit
// body, so a spawn is in open ground rather than wedged against a crate.
const PLAYER_SPAWN_CLEARANCE=34;

// Grid pitch of the reachability map. Coarse on purpose: it answers "which
// side of the geometry is this" and nothing finer.
const REACH_CELL=32;

// How many times depenetration is allowed to iterate before giving up. Three
// resolves every corner geometry the generators produce; the loop exits early
// the moment a pass moves nothing, which is the common case.
const DEPENETRATION_PASSES=3;
// A hazard keeps at least this fraction of its radius clear of solid
// geometry, vaults and water, and hazard centres stay this fraction of their
// combined radii apart.
const HAZARD_CLEARANCE=.55;
// Bridge wreck footprint: drawVehicle's body plus wheels. Yaw in radians.
const WRECK_W=112,WRECK_H=58,WRECK_YAW=.12;
// Ridge wall depth and how far its centre shifts toward the valley, matching
// drawRidge's crest (36 behind the line, 60 in front).
const RIDGE_DEPTH=96,RIDGE_CREST_SHIFT=12;
// Conifer trunk collider as a fraction of the drawn size.
const CONIFER_TRUNK=.3;
// Aircraft panel colliders: boxes laid along the centreline of each swept
// wing and the tail, in drawAircraft's unscaled model units. The wing root is
// at (25,14) and the tip at (-20,106); the tail root at (-90,-9) and its tip
// at (-125,-71).
const WING_BOX=34;
// Proving Ground chamber wall: square blocks around the ring, overlapping.
const ARENA_SEGMENTS=128,ARENA_BLOCK=36;
const WING_LINE=[[25,14],[-20,106]];
const TAIL_LINE=[[-90,-9],[-125,-71]];
function alongLine([[x0,y0],[x1,y1]],ts){
  return ts.map(t=>[x0+(x1-x0)*t,y0+(y1-y0)*t]);
}
function aircraftPanelBoxes(scale,facing,wingBroken,tailBroken){
  const boxes=[];
  // A sheared wing keeps its root panel only.
  const wingTs=wingBroken?[.17]:[.17,.5,.83];
  for(const [px,py] of alongLine(WING_LINE,wingTs)){
    boxes.push([px,py]);
    boxes.push([px,-py]);
  }
  if(!tailBroken)for(const p of alongLine(TAIL_LINE,[.3,.75]))boxes.push(p);
  // facing is 0 or PI: a rotation by PI is a mirror through the origin.
  const flip=Math.cos(facing)<0?-1:1;
  return boxes.map(([px,py])=>[px*scale*flip,py*scale*flip]);
}
const HAZARD_SEPARATION=.7;

// Procedural sector generation. The world is a finite, fully-authored bounded
// arena built from rooms and corridors rather than the previous build's
// screen-sized tile that wrapped around the player.

const COVER_TYPES=[
  {type:'crate',w:46,h:46,hp:70,blocksSight:true,destructible:true},
  {type:'barrier',w:96,h:26,hp:120,blocksSight:true,destructible:true},
  {type:'pillar',w:40,h:40,hp:0,blocksSight:true,destructible:false},
  {type:'machinery',w:96,h:74,hp:0,blocksSight:true,destructible:false},
  {type:'lowcover',w:80,h:24,hp:90,blocksSight:false,destructible:true},
  {type:'container',w:128,h:60,hp:180,blocksSight:true,destructible:true}
];

export class World{
  constructor(map,options={}){
    this.map=map;
    this.palette=map.palette;
    this.seed=options.seed??Math.floor(Math.random()*1e9);
    this.rng=new Rng(this.seed);
    this.layout=map.layout;
    this.sizeMult=options.sizeMult||1;

    this.width=0;this.height=0;
    this.rooms=[];
    this.walls=[];        // solid, blocks movement and sight
    this.cover=[];        // destructible / partial cover
    this.hazards=[];
    this.decor=[];
    this.coverPoints=[];  // AI-usable cover positions
    this.decals=[];
    this.vaults=[];       // sealed chambers, hidden until scanned
    this.landmarks=[];    // large authored props the renderer draws by kind
    this.water=null;      // open water bands, for theatres that have them
    this.obstacleHash=new SpatialHash(140);
    this.globalHazards=[];

    this.generate();
  }

  get bounds(){
    return{minX:0,minY:0,maxX:this.width,maxY:this.height};
  }

  generate(){
    const rng=this.rng;
    const layout=this.layout;
    // Arena size scales with the contract length so 30-minute runs get room
    // to breathe without 5-minute runs feeling empty.
    const base=2100*this.sizeMult;
    // Aspect follows the layout: a suspension span is long and narrow, a
    // valley runs between two ridgelines, an evaluation chamber is compact.
    const shape={
      open:[1.2,1.12],
      bridge:[1.75,.52],
      valley:[1.4,.86],
      hangar:[1.25,.82],
      arena:[.62,.62]
    }[layout.type]||[1,1];
    this.width=Math.round(base*shape[0]);
    this.height=Math.round(base*shape[1]);

    this.buildPerimeter();

    switch(layout.type){
      case 'open':this.generateOpenField();break;
      case 'streets':this.generateStreets();break;
      case 'industrial':this.generateIndustrial();break;
      case 'modular':this.generateModular();break;
      case 'bridge':this.generateBridge();break;
      case 'valley':this.generateValley();break;
      case 'swamp':this.generateSwamp();break;
      case 'hangar':this.generateHangar();break;
      case 'arena':this.generateArena();break;
      default:this.generateComplex();
    }

    // Resolve the start position before anything else competes for space.
    this.spawnPoint=this.computePlayerSpawn();

    // Vaults claim their footprint before cover is scattered — the interior
    // layouts are dense enough that anything placed afterwards can almost
    // never find a clear chamber-sized gap.
    this.placeVaults();
    this.scatterCover();
    this.placeHazards();
    this.scatterDecor();
    this.buildCoverPoints();
    this.rebuildHash();

    // Re-check the start once every last piece of geometry exists.
    // (buildReachability runs after this, since it fills from the start.) It is
    // resolved early so vaults and cover can be kept off it, but "kept off"
    // was an intention rather than a guarantee: across eighty generated
    // sectors the operative began inside solid geometry in fourteen of them.
    // This is the only point in generation where the question can actually be
    // answered.
    const start=this.spawnPoint;
    if(this.overlapsSolid(start.x,start.y,PLAYER_SPAWN_CLEARANCE)||
       !this.playable(start.x,start.y,60)){
      const clear=this.openPointNear(start.x,start.y,PLAYER_SPAWN_CLEARANCE,
        {avoidVaults:true,pad:60});
      if(clear){this.spawnPoint=clear}
      else{
        // Nothing within reach has the clearance, so make some. Carving is
        // preferable to starting the operative inside a wall.
        this.carve({x:start.x,y:start.y,w:180,h:180});
        this.cover=this.cover.filter(c=>
          Math.abs(c.x-start.x)>c.hw+90||Math.abs(c.y-start.y)>c.hh+90);
        this.buildCoverPoints();
        this.rebuildHash();
      }
    }

    this.buildReachability();
  }

  // A coarse map of the ground the operative can actually walk to, flood
  // filled from their start.
  //
  // Deploying a hostile somewhere it cannot path out of is not a spawn that
  // looks wrong, it is a spawn that quietly removes a hostile from the
  // contract — and in a sector with a sealed pocket it happens repeatedly.
  // Generation leaves small enclosed pockets in a couple of theatres, so the
  // spawn search now has to know which side of the geometry a candidate is on.
  //
  // One fill over a 32-unit grid at generation time, and a constant-time
  // lookup per spawn afterwards.
  buildReachability(){
    const cell=REACH_CELL;
    const cols=Math.ceil(this.width/cell),rows=Math.ceil(this.height/cell);
    this.reachCols=cols;this.reachRows=rows;
    const open=new Uint8Array(cols*rows);
    for(let cx=0;cx<cols;cx++)for(let cy=0;cy<rows;cy++){
      const x=cx*cell+cell/2,y=cy*cell+cell/2;
      if(this.playable(x,y,16)&&!this.overlapsSolid(x,y,16))open[cx*rows+cy]=1;
    }
    const reach=new Uint8Array(cols*rows);
    const start=this.playerSpawn();
    const sx=clamp(Math.floor(start.x/cell),0,cols-1);
    const sy=clamp(Math.floor(start.y/cell),0,rows-1);
    const stack=[];
    const seed=sx*rows+sy;
    if(open[seed]){reach[seed]=1;stack.push(seed)}
    while(stack.length){
      const id=stack.pop();
      const cx=(id/rows)|0,cy=id%rows;
      for(let k=0;k<4;k++){
        const nx=cx+(k===0?1:k===1?-1:0);
        const ny=cy+(k===2?1:k===3?-1:0);
        if(nx<0||ny<0||nx>=cols||ny>=rows)continue;
        const nid=nx*rows+ny;
        if(reach[nid]||!open[nid])continue;
        reach[nid]=1;stack.push(nid);
      }
    }
    this.reachGrid=reach;
  }

  // True when a point is on ground connected to the operative's own. Unknown
  // points answer true: a coarse grid can miss a legitimately open spot, and
  // refusing every spawn is worse than allowing a rare bad one.
  reachable(x,y){
    if(!this.reachGrid)return true;
    const cx=clamp(Math.floor(x/REACH_CELL),0,this.reachCols-1);
    const cy=clamp(Math.floor(y/REACH_CELL),0,this.reachRows-1);
    if(this.reachGrid[cx*this.reachRows+cy])return true;
    // The cell centre may be blocked while the point itself is fine, so a
    // one-cell neighbourhood is consulted before refusing.
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      const nx=cx+dx,ny=cy+dy;
      if(nx<0||ny<0||nx>=this.reachCols||ny>=this.reachRows)continue;
      if(this.reachGrid[nx*this.reachRows+ny])return true;
    }
    return false;
  }

  // Sealed vaults. The chamber walls are ordinary geometry that reads as part
  // of the sector — nothing is invisible and nothing blocks movement without
  // being drawn. What is hidden is that the chamber is worth opening: that is
  // only revealed once the operative's scanner picks it up at close range.
  placeVaults(){
    // A duel chamber is deliberately bare — no caches, no side rooms.
    if(this.layout.vaults===false)return;
    const rng=this.rng;
    const target=rng.int(2,3);
    const half=58;                       // interior half-extent
    const t=16;                          // chamber wall thickness
    const attemptBudget=360;
    let attempts=0;

    // The operative must never start inside a chamber they would have to
    // breach from the wrong side.
    const spawn=this.spawnPoint||this.computePlayerSpawn();
    const clearOfSpawn=(x,y)=>dist2(x,y,spawn.x,spawn.y)>460*460;

    // Room interiors are the only reliably open ground in the tighter
    // layouts, so they are tried first; random placement then fills the rest.
    const seeds=this.rooms
      .filter(room=>room.w>(half+t)*2.4&&room.h>(half+t)*2.4)
      .filter(room=>clearOfSpawn(room.x,room.y))
      .map(room=>({x:room.x,y:room.y,sort:rng.next()}))
      .sort((a,b)=>a.sort-b.sort);

    while(this.vaults.length<target&&attempts<attemptBudget){
      attempts++;
      const seed=seeds.shift();
      const x=seed?seed.x:rng.range(half+150,this.width-half-150);
      const y=seed?seed.y:rng.range(half+150,this.height-half-150);
      // The chamber needs its own clear footprint plus room to breach. Dense
      // theatres cannot always afford the ideal approach margin, so the
      // requirement relaxes as the budget runs down rather than giving up and
      // shipping a sector with no vaults in it at all.
      const relief=attempts<attemptBudget*.4?40:attempts<attemptBudget*.75?18:2;
      if(!clearOfSpawn(x,y))continue;
      if(!this.playable(x,y,half+t+40))continue;
      if(this.overlapsSolid(x,y,half+t+relief))continue;
      // Keep vaults apart so one scan never reveals two.
      if(this.vaults.some(v=>dist2(v.x,v.y,x,y)<520*520))continue;

      const span=(half+t)*2;
      const sides=[
        {dx:0,dy:-(half+t/2),w:span,h:t,out:[0,-1]},
        {dx:half+t/2,dy:0,w:t,h:span,out:[1,0]},
        {dx:0,dy:half+t/2,w:span,h:t,out:[0,1]},
        {dx:-(half+t/2),dy:0,w:t,h:span,out:[-1,0]}
      ];

      // Three solid sides; the fourth is the seal the operative must breach.
      // The door has to face ground the operative can actually stand on, so
      // the side is chosen by probing the approach rather than at random.
      const approaches=sides
        .map((side,index)=>({index,side}))
        .filter(({side})=>[46,86,126].every(d=>{
          const ax=x+side.out[0]*(half+d);
          const ay=y+side.out[1]*(half+d);
          return ax>60&&ay>60&&ax<this.width-60&&ay<this.height-60&&
                 !this.overlapsSolid(ax,ay,15);
        }));
      if(!approaches.length)continue;
      const facing=rng.pick(approaches).index;
      const walls=[];
      sides.forEach((side,index)=>{
        if(index===facing)return;
        walls.push(this.addWall(x+side.dx,y+side.dy,side.w,side.h,{type:'vault'}));
      });

      // Which lock this chamber carries. Drawn from the world's own seeded
      // stream and nothing else — two operatives running the same contract
      // seed have to be handed the same sector, whatever their progression.
      let kindId=rollVaultKind(rng);

      // A remote lock needs a console the operative can actually reach. When
      // there is nowhere to put one the chamber falls back to a plain cache
      // rather than shipping a vault that cannot be opened at all.
      let terminal=null;
      if(kindId==='terminal'){
        terminal=this.placeVaultTerminal(x,y,rng);
        if(!terminal)kindId='cache';
      }
      const kind=vaultKind(kindId);

      // A sealed lock's plate does not take damage: shooting it is not the
      // route in, so it must not read as destructible to weapons, breachers
      // or the AI's cover logic.
      const door=sides[facing];
      const seal=this.addCover(x+door.dx,y+door.dy,{
        type:'vaultSeal',w:door.w,h:door.h,
        hp:kind.sealed?0:520,blocksSight:true,destructible:!kind.sealed
      });
      seal.vaultSeal=true;

      const vault={
        x,y,half,seal,walls,facing,
        kind:kindId,terminal,
        // A guarded vault trades a bigger payout for a garrison on breach.
        guarded:kindId==='garrison',
        // Manual-override progress, in seconds. Unused by the other locks.
        hold:0,holding:false,
        holdTime:kind.holdTime||0,holdRadius:kind.holdRadius||0,
        discovered:false,breached:false,
        pulse:rng.next()*10
      };
      // The renderer reads discovery state off the seal it is drawing, and off
      // the console for the vault the console belongs to.
      seal.vault=vault;
      if(terminal)terminal.vault=vault;
      this.vaults.push(vault);
    }
  }

  // A console for a remote-locked vault. Far enough that reaching it is a
  // decision the operative has to make under fire, close enough that the
  // chamber is still worth walking back to. Returns null when the sector has
  // no open ground in that band, which is the caller's cue to pick a lock the
  // sector can actually support.
  placeVaultTerminal(vx,vy,rng){
    for(let attempt=0;attempt<48;attempt++){
      const angle=rng.angle();
      const distance=rng.range(300,560);
      const x=vx+Math.cos(angle)*distance;
      const y=vy+Math.sin(angle)*distance;
      if(!this.playable(x,y,70))continue;
      if(this.overlapsSolid(x,y,54))continue;
      if(this.insideVault(x,y,40))continue;
      return this.addCover(x,y,{type:'vaultTerminal',w:34,h:34,
        hp:120,blocksSight:false,destructible:true});
    }
    return null;
  }

  addWall(x,y,w,h,opts={}){
    const wall={x,y,w,h,hw:w/2,hh:h/2,type:opts.type||'wall',
      blocksSight:opts.blocksSight!==false,destructible:false,broken:false,
      hp:0,maxHp:0,variant:opts.variant??this.rng.int(0,3)};
    this.walls.push(wall);
    return wall;
  }

  addCover(x,y,spec){
    const cover={x,y,w:spec.w,h:spec.h,hw:spec.w/2,hh:spec.h/2,
      type:spec.type,blocksSight:spec.blocksSight,destructible:spec.destructible,
      hp:spec.hp,maxHp:spec.hp,broken:false,shake:0,variant:this.rng.int(0,3)};
    this.cover.push(cover);
    return cover;
  }

  buildPerimeter(){
    const t=60;
    this.addWall(this.width/2,-t/2,this.width+t*2,t,{type:'perimeter'});
    this.addWall(this.width/2,this.height+t/2,this.width+t*2,t,{type:'perimeter'});
    this.addWall(-t/2,this.height/2,t,this.height+t*2,{type:'perimeter'});
    this.addWall(this.width+t/2,this.height/2,t,this.height+t*2,{type:'perimeter'});
  }

  // Interior complex: a grid of rooms joined by doorways punched into shared
  // walls, so there is always a route between any two rooms.
  generateComplex(){
    const rng=this.rng;
    const cols=4,rows=4;
    const cellW=this.width/cols,cellH=this.height/rows;
    const thickness=26;

    for(let cx=0;cx<cols;cx++)for(let cy=0;cy<rows;cy++){
      this.rooms.push({
        x:cellW*(cx+.5),y:cellH*(cy+.5),
        w:cellW-thickness*2,h:cellH-thickness*2,cx,cy
      });
    }

    // Vertical partitions with a doorway gap per segment.
    for(let cx=1;cx<cols;cx++){
      const x=cellW*cx;
      for(let cy=0;cy<rows;cy++){
        if(rng.bool(.28))continue; // open the partition entirely
        const top=cellH*cy,bottom=cellH*(cy+1);
        const gapCenter=rng.range(top+90,bottom-90);
        const gap=this.layout.corridorWidth;
        const upperH=Math.max(0,gapCenter-gap/2-top);
        const lowerH=Math.max(0,bottom-(gapCenter+gap/2));
        if(upperH>20)this.addWall(x,top+upperH/2,thickness,upperH);
        if(lowerH>20)this.addWall(x,bottom-lowerH/2,thickness,lowerH);
      }
    }
    // Horizontal partitions, same treatment.
    for(let cy=1;cy<rows;cy++){
      const y=cellH*cy;
      for(let cx=0;cx<cols;cx++){
        if(rng.bool(.28))continue;
        const left=cellW*cx,right=cellW*(cx+1);
        const gapCenter=rng.range(left+90,right-90);
        const gap=this.layout.corridorWidth;
        const leftW=Math.max(0,gapCenter-gap/2-left);
        const rightW=Math.max(0,right-(gapCenter+gap/2));
        if(leftW>20)this.addWall(left+leftW/2,y,leftW,thickness);
        if(rightW>20)this.addWall(right-rightW/2,y,rightW,thickness);
      }
    }
  }

  // Open field: almost no walls, a handful of structures for sightline breaks.
  generateOpenField(){
    const rng=this.rng;
    const count=rng.int(5,8);
    for(let i=0;i<count;i++){
      const w=rng.range(180,340),h=rng.range(140,300);
      const x=rng.range(w,this.width-w),y=rng.range(h,this.height-h);
      // Hollow structures: four walls with one side left open.
      const open=rng.int(0,3);
      const t=24;
      if(open!==0)this.addWall(x,y-h/2,w,t);
      if(open!==1)this.addWall(x+w/2,y,t,h);
      if(open!==2)this.addWall(x,y+h/2,w,t);
      if(open!==3)this.addWall(x-w/2,y,t,h);
      this.rooms.push({x,y,w:w-t*2,h:h-t*2});
    }
    this.rooms.push({x:this.width/2,y:this.height/2,w:this.width*.5,h:this.height*.5,open:true});
  }

  // Flooded streets: a city block grid with wide avenues between buildings.
  generateStreets(){
    const rng=this.rng;
    const blocks=3;
    const street=this.layout.corridorWidth;
    const blockW=(this.width-street*(blocks+1))/blocks;
    const blockH=(this.height-street*(blocks+1))/blocks;

    for(let bx=0;bx<blocks;bx++)for(let by=0;by<blocks;by++){
      const x=street+blockW/2+bx*(blockW+street);
      const y=street+blockH/2+by*(blockH+street);
      if(rng.bool(.25)){
        // Collapsed block: rubble field instead of a building.
        this.rooms.push({x,y,w:blockW,h:blockH,rubble:true});
        continue;
      }
      const t=28;
      this.addWall(x,y-blockH/2,blockW,t);
      this.addWall(x,y+blockH/2,blockW,t);
      this.addWall(x-blockW/2,y,t,blockH);
      this.addWall(x+blockW/2,y,t,blockH);
      // Punch an entrance so buildings are enterable.
      const side=rng.int(0,3);
      const gap=90;
      const holes=[
        {x,y:y-blockH/2,w:gap,h:t},{x:x+blockW/2,y,w:t,h:gap},
        {x,y:y+blockH/2,w:gap,h:t},{x:x-blockW/2,y,w:t,h:gap}
      ][side];
      this.carve(holes);
      this.rooms.push({x,y,w:blockW-t*2,h:blockH-t*2,interior:true});
    }
  }

  // Industrial floor: long production lines with heavy machinery clusters.
  generateIndustrial(){
    const rng=this.rng;
    const lanes=5;
    const laneH=this.height/lanes;
    for(let i=1;i<lanes;i++){
      const y=laneH*i;
      let x=80;
      while(x<this.width-80){
        const segment=rng.range(180,420);
        if(rng.bool(.72))this.addWall(x+segment/2,y,segment,30);
        x+=segment+rng.range(90,190);
      }
    }
    for(let i=0;i<lanes;i++){
      this.rooms.push({x:this.width/2,y:laneH*(i+.5),w:this.width*.8,h:laneH*.7});
    }
    // Vertical support columns.
    for(let i=0;i<14;i++){
      this.addWall(rng.range(150,this.width-150),rng.range(150,this.height-150),44,44,{type:'column'});
    }
  }

  // Orbital modular decks: hexagonal-ish module clusters joined by gangways.
  generateModular(){
    const rng=this.rng;
    const modules=rng.int(7,10);
    const placed=[];
    for(let i=0;i<modules;i++){
      const r=rng.range(150,260);
      let x,y,attempts=0;
      do{
        x=rng.range(r+80,this.width-r-80);
        y=rng.range(r+80,this.height-r-80);
        attempts++;
      }while(attempts<24&&placed.some(p=>dist2(x,y,p.x,p.y)<(r+p.r+120)**2));
      placed.push({x,y,r});
      this.rooms.push({x,y,w:r*1.6,h:r*1.6,module:true});
      // Ring the module with wall segments, leaving two gangway gaps.
      const segments=10;
      const gapA=rng.int(0,segments-1),gapB=(gapA+rng.int(3,6))%segments;
      for(let s=0;s<segments;s++){
        if(s===gapA||s===gapB)continue;
        const a=s/segments*Math.PI*2;
        const wx=x+Math.cos(a)*r,wy=y+Math.sin(a)*r;
        const horizontal=Math.abs(Math.cos(a))>Math.abs(Math.sin(a));
        this.addWall(wx,wy,horizontal?26:r*.7,horizontal?r*.7:26,{type:'module'});
      }
    }
  }

  // Suspension crossing: a long roadway boxed in by parapets, with towers and
  // stalled traffic on the deck. Landmarks are recorded separately from cover
  // so the renderer can draw the span's own furniture.
  generateBridge(){
    const rng=this.rng;
    const deckHalf=Math.min(this.height*.3,420);
    const midY=this.height/2;

    // Parapets run the length of the span; everything outside them is water.
    this.addWall(this.width/2,midY-deckHalf,this.width,54,{type:'parapet'});
    this.addWall(this.width/2,midY+deckHalf,this.width,54,{type:'parapet'});
    this.water={y0:0,y1:midY-deckHalf-27,y2:midY+deckHalf+27,y3:this.height};

    const towers=3;
    for(let i=1;i<=towers;i++){
      const x=this.width*(i/(towers+1));
      // Tower legs sit inside the parapets and leave a gap to run through.
      this.addWall(x,midY-deckHalf+120,46,150,{type:'tower'});
      this.addWall(x,midY+deckHalf-120,46,150,{type:'tower'});
      this.landmarks.push({kind:'bridgeTower',x,y:midY,span:deckHalf});
      this.rooms.push({x,y:midY,w:this.width/(towers+1)*.8,h:deckHalf*1.6});
    }
    // Stalled and burnt-out vehicles make the only mid-deck cover.
    const wrecks=Math.round(this.width/230);
    for(let i=0;i<wrecks;i++){
      const x=rng.range(160,this.width-160);
      const y=midY+rng.range(-deckHalf*.72,deckHalf*.72);
      if(this.overlapsSolid(x,y,90))continue;
      // The vehicle is drawn at a fixed 108x44 with wheels to 64 tall, so the
      // collider is that footprint. A random 84-132 wide box under fixed art
      // left up to twelve units of invisible wall past one bumper and let the
      // operative into the other. The yaw is kept small for the same reason:
      // the collider cannot turn with the art.
      this.addCover(x,y,{type:'wreck',w:WRECK_W,h:WRECK_H,
        hp:210,blocksSight:true,destructible:true});
      this.landmarks.push({kind:'vehicle',x,y,burnt:rng.bool(.4),rotation:rng.range(-WRECK_YAW,WRECK_YAW)});
    }
  }

  // Glacial basin: ridgelines down both long edges, boulder fields and a
  // scattered treeline for cover on the valley floor.
  generateValley(){
    const rng=this.rng;
    const ridge=Math.min(this.height*.22,300);
    // Ridge walls are broken into segments so the basin has entry points.
    for(const side of [-1,1]){
      const baseY=side<0?ridge:this.height-ridge;
      let x=60;
      while(x<this.width-60){
        const w=rng.range(180,420);
        if(rng.bool(.78)){
          // drawRidge puts a snow crest from 36 units behind the ridge line to
          // 60 units in front of it, on the valley side. The wall spans the
          // same 96 units, so the operative stops at the crest, not 25 units
          // into it.
          this.addWall(x+w/2,baseY-side*RIDGE_CREST_SHIFT,w,RIDGE_DEPTH,{type:'ridge'});
          this.landmarks.push({kind:'ridge',x:x+w/2,y:baseY,w,side});
        }
        x+=w+rng.range(70,190);
      }
    }
    this.rooms.push({x:this.width/2,y:this.height/2,w:this.width*.7,h:this.height-ridge*2.4,open:true});

    const boulders=Math.round(this.width*this.height/150000);
    for(let i=0;i<boulders;i++){
      const x=rng.range(140,this.width-140);
      const y=rng.range(ridge+110,this.height-ridge-110);
      if(this.overlapsSolid(x,y,80))continue;
      const r=rng.range(34,62);
      this.addCover(x,y,{type:'boulder',w:r*2,h:r*1.7,hp:0,blocksSight:true,destructible:false});
      this.landmarks.push({kind:'boulder',x,y,r,rotation:rng.angle()});
    }
    // A thin treeline: bare conifers. The canopy is overhead and is walked
    // under; the trunk is not, and used to have no collider at all — the one
    // upright thing in the valley the operative passed straight through.
    const trees=Math.round(this.width*this.height/90000);
    for(let i=0;i<trees;i++){
      const x=rng.range(90,this.width-90);
      const y=rng.range(ridge+80,this.height-ridge-80);
      if(this.overlapsSolid(x,y,44))continue;
      const size=rng.range(30,58);
      const trunk=Math.round(size*CONIFER_TRUNK);
      this.addCover(x,y,{type:'conifer',w:trunk,h:trunk,hp:0,blocksSight:false,destructible:false});
      this.landmarks.push({kind:'conifer',x,y,size,rotation:rng.range(-.08,.08)});
    }
  }

  // Drowned forest: dense trunk cover, standing water, no long sightlines.
  generateSwamp(){
    const rng=this.rng;
    const clusters=rng.int(7,10);
    for(let c=0;c<clusters;c++){
      const cx=rng.range(240,this.width-240);
      const cy=rng.range(240,this.height-240);
      this.rooms.push({x:cx,y:cy,w:rng.range(240,400),h:rng.range(240,400)});
      // Trunks ring each clearing rather than filling it.
      const trunks=rng.int(5,9);
      for(let i=0;i<trunks;i++){
        const a=i/trunks*Math.PI*2+rng.range(-.3,.3);
        const d=rng.range(150,260);
        const x=clamp(cx+Math.cos(a)*d,80,this.width-80);
        const y=clamp(cy+Math.sin(a)*d,80,this.height-80);
        if(this.overlapsSolid(x,y,52))continue;
        const r=rng.range(22,34);
        this.addCover(x,y,{type:'trunk',w:r*2,h:r*2,hp:0,blocksSight:true,destructible:false});
        this.landmarks.push({kind:'deadTree',x,y,r,rotation:rng.angle(),lean:rng.range(-.16,.16)});
      }
    }
    // Half-sunk logs give low cover between the clearings.
    const logs=Math.round(this.width*this.height/160000);
    for(let i=0;i<logs;i++){
      const x=rng.range(140,this.width-140);
      const y=rng.range(140,this.height-140);
      if(this.overlapsSolid(x,y,90))continue;
      const horizontal=rng.bool();
      this.addCover(x,y,{type:'log',w:horizontal?rng.range(120,190):32,h:horizontal?32:rng.range(120,190),
        hp:150,blocksSight:false,destructible:true});
    }
  }

  // Airlift facility: a clear deck with parked and wrecked transport airframes
  // standing in as the cover field.
  generateHangar(){
    const rng=this.rng;
    const t=64;
    // Structural bays down both sides of the deck.
    for(const side of [-1,1]){
      const y=side<0?t*1.6:this.height-t*1.6;
      let x=140;
      while(x<this.width-140){
        const w=rng.range(150,260);
        this.addWall(x+w/2,y,w,t,{type:'bay'});
        x+=w+rng.range(140,240);
      }
    }
    this.rooms.push({x:this.width/2,y:this.height/2,w:this.width*.78,h:this.height*.66,open:true});

    // Airframes parked in rows. The fuselage blocks sight; the wings do not.
    const rows=2,perRow=rng.int(2,3);
    for(let r=0;r<rows;r++){
      for(let i=0;i<perRow;i++){
        const x=this.width*((i+1)/(perRow+1))+rng.range(-90,90);
        const y=this.height*((r+1)/(rows+1))+rng.range(-70,70);
        if(this.overlapsSolid(x,y,220))continue;
        const facing=rng.bool()?0:Math.PI;
        const scale=rng.range(.85,1.2);
        const wrecked=rng.bool(.45);
        this.addCover(x,y,{type:'fuselage',w:250*scale,h:56*scale,
          hp:0,blocksSight:true,destructible:false});
        const tailBroken=wrecked&&rng.bool(.6),wingBroken=wrecked&&rng.bool(.5);
        this.landmarks.push({kind:'aircraft',x,y,scale,rotation:facing,wrecked,tailBroken,wingBroken});
        // The wings and tail are drawn 108 units out from the fuselage and
        // had no collider, so the operative walked through two thirds of
        // every airframe. They block movement now, in boxes laid along each
        // swept panel; they still do not block sight, because the airframe's
        // fuselage is the sightline cover and a wing is knee height.
        for(const [px,py] of aircraftPanelBoxes(scale,facing,wingBroken,tailBroken)){
          this.addCover(x+px,y+py,{type:'wing',w:WING_BOX*scale,h:WING_BOX*scale,
            hp:0,blocksSight:false,destructible:false});
        }
        this.rooms.push({x,y,w:300*scale,h:200*scale});
      }
    }
    // Loose ground equipment.
    const crates=Math.round(this.width*this.height/220000);
    for(let i=0;i<crates;i++){
      const x=rng.range(160,this.width-160);
      const y=rng.range(160,this.height-160);
      if(this.overlapsSolid(x,y,70))continue;
      this.addCover(x,y,{type:'crate',w:52,h:52,hp:70,blocksSight:true,destructible:true});
    }
  }

  // Evaluation chamber: one sealed circular floor, no cover, no exit. Built
  // for a duel, so nothing here is allowed to break line of sight.
  generateArena(){
    const radius=Math.min(this.width,this.height)*.42;
    const cx=this.width/2,cy=this.height/2;
    // Forty-four axis-aligned slabs each 18% of the radius long made a ring
    // whose inner face wandered fifty units in and out around the circle: the
    // operative was stopped a body-length short of the wall on the diagonals
    // and touched it on the axes. Small square blocks, one every 30 units,
    // keep that wander under fifteen (measured in tools/stage-collision.mjs).
    const segments=ARENA_SEGMENTS;
    for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2;
      const wx=cx+Math.cos(a)*radius;
      const wy=cy+Math.sin(a)*radius;
      this.addWall(wx,wy,ARENA_BLOCK,ARENA_BLOCK,{type:'chamber'});
    }
    this.rooms.push({x:cx,y:cy,w:radius*1.5,h:radius*1.5,open:true});
    this.landmarks.push({kind:'arenaRing',x:cx,y:cy,r:radius});
  }

  // Remove wall area overlapping a rectangle — used to punch doorways.
  carve(hole){
    if(!hole)return;
    this.walls=this.walls.filter(wall=>{
      if(wall.type==='perimeter')return true;
      return !(Math.abs(wall.x-hole.x)<wall.hw+hole.w/2&&Math.abs(wall.y-hole.y)<wall.hh+hole.h/2);
    });
  }

  scatterCover(){
    const rng=this.rng;
    // A theatre that authors its own cover field (or deliberately has none)
    // must not have generic crates sprinkled over it.
    if(!this.layout.coverDensity)return;
    const target=Math.round(this.width*this.height/26000*this.layout.coverDensity);
    let placed=0,attempts=0;
    while(placed<target&&attempts<target*14){
      attempts++;
      const spec=rng.pick(COVER_TYPES);
      const x=rng.range(120,this.width-120);
      const y=rng.range(120,this.height-120);
      if(!this.playable(x,y,60))continue;
      if(this.overlapsSolid(x,y,Math.max(spec.w,spec.h)/2+34))continue;
      // Leave vault interiors clear so the payout has somewhere to land.
      if(this.insideVault(x,y,30))continue;
      // And leave the operative's start clear. Cover is scattered after the
      // start is chosen, so without this a crate can be dropped straight onto
      // it and the contract opens with the operative inside solid geometry.
      if(this.spawnPoint&&
         Math.abs(x-this.spawnPoint.x)<spec.w/2+PLAYER_SPAWN_CLEARANCE+20&&
         Math.abs(y-this.spawnPoint.y)<spec.h/2+PLAYER_SPAWN_CLEARANCE+20)continue;
      this.addCover(x,y,spec);
      placed++;
    }
  }

  placeHazards(){
    const rng=this.rng;
    for(const key of this.map.hazards||[]){
      const spec=HAZARDS[key];
      if(!spec)continue;
      if(spec.global){this.globalHazards.push({id:key,...spec});continue}
      const count=spec.passive?rng.int(4,7):rng.int(3,5);
      // Retry per hazard rather than per attempt: dense cover fields would
      // otherwise reject almost every candidate and leave theatres empty.
      for(let i=0;i<count;i++){
        let placed=null;
        for(let attempt=0;attempt<40&&!placed;attempt++){
          // The clearance used to relax to 18% of the radius as attempts ran
          // out, which put drifts across ridge walls, spore blooms half under
          // a parapet and slicks inside sealed vaults: a zone that slows or
          // burns the operative while most of it is buried in geometry reads
          // as the geometry misbehaving. It now holds at just over half the
          // radius and the hazard is dropped instead. Fewer, all of them on
          // open ground.
          const clearance=Math.max(30,spec.radius*HAZARD_CLEARANCE);
          const x=rng.range(180,this.width-180);
          const y=rng.range(180,this.height-180);
          if(this.overlapsSolid(x,y,clearance))continue;
          if(this.insideVault(x,y,spec.radius*HAZARD_CLEARANCE))continue;
          if(!this.playable(x,y,spec.radius*HAZARD_CLEARANCE))continue;
          // Two zones stacked on one spot read as one zone with the wrong
          // radius. Centres stay apart by most of the two radii.
          if(this.hazards.some(h=>Math.hypot(h.x-x,h.y-y)<(h.radius+spec.radius)*HAZARD_SEPARATION))continue;
          placed={x,y};
        }
        if(!placed)continue;
        this.hazards.push({
          id:key,...spec,x:placed.x,y:placed.y,
          timer:rng.range(0,spec.interval||3),
          warning:0,active:false,phase:rng.next()*10
        });
      }
    }
  }

  scatterDecor(){
    const rng=this.rng;
    const count=Math.round(this.width*this.height/9000);
    for(let i=0;i<count;i++){
      const x=rng.range(30,this.width-30);
      const y=rng.range(30,this.height-30);
      this.decor.push({
        x,y,kind:rng.int(0,5),
        size:rng.range(10,42),
        rotation:rng.angle(),
        alpha:rng.range(.035,.1)
      });
    }
  }

  // Positions adjacent to solid geometry that the AI can use as firing cover.
  // Precomputed once so the AI never has to search geometry at runtime.
  buildCoverPoints(){
    const points=[];
    const consider=obstacle=>{
      if(!obstacle.blocksSight)return;
      const offsets=[[0,-1],[0,1],[-1,0],[1,0]];
      for(const [ox,oy] of offsets){
        const px=obstacle.x+ox*(obstacle.hw+26);
        const py=obstacle.y+oy*(obstacle.hh+26);
        if(px<40||py<40||px>this.width-40||py>this.height-40)continue;
        if(this.overlapsSolid(px,py,20))continue;
        points.push({x:px,y:py,nx:ox,ny:oy,obstacle,claimedBy:null});
      }
    };
    for(const wall of this.walls)if(wall.type!=='perimeter')consider(wall);
    for(const cover of this.cover)consider(cover);
    this.coverPoints=points;
  }

  rebuildHash(){
    this.obstacleHash.clear();
    for(const wall of this.walls)this.obstacleHash.insert(wall);
    for(const cover of this.cover)if(!cover.broken)this.obstacleHash.insert(cover);
  }

  // Ground the operative and hostiles can actually stand on. Most layouts use
  // the whole rectangle; the ones with dead zones — open water beyond a
  // bridge's parapets — carve those out so nothing is placed where it would be
  // stranded or unreachable.
  playable(x,y,pad=0){
    if(this.water){
      if(y<this.water.y1+pad||y>this.water.y2-pad)return false;
    }
    return x>pad&&y>pad&&x<this.width-pad&&y<this.height-pad;
  }

  // True inside a vault chamber. Spawners use this to keep hostiles and
  // hazards out of a sealed room nobody can reach yet.
  insideVault(x,y,pad=0){
    for(const vault of this.vaults){
      if(Math.abs(x-vault.x)<vault.half+pad&&Math.abs(y-vault.y)<vault.half+pad)return true;
    }
    return false;
  }

  // Any solid geometry overlapping a circle.
  overlapsSolid(x,y,radius){
    for(const wall of this.walls){
      if(Math.abs(x-wall.x)<wall.hw+radius&&Math.abs(y-wall.y)<wall.hh+radius)return true;
    }
    for(const cover of this.cover){
      if(cover.broken)continue;
      if(Math.abs(x-cover.x)<cover.hw+radius&&Math.abs(y-cover.y)<cover.hh+radius)return true;
    }
    return false;
  }

  // Move a circular entity by a displacement, resolving geometry on the way.
  //
  // Every mover in the game goes through this. The previous arrangement added
  // the whole displacement and then called resolveCollision to push the entity
  // back out of anything it had ended up inside, which only works while one
  // step is shorter than the geometry it crosses. A dashing operative covers
  // roughly 21 world units in a 1/60 step and the shallowest cover in the game
  // is 24 units deep, so a dash into low cover could finish on the far side
  // with nothing left overlapping to push it back — the wall-clipping the
  // owner reported.
  //
  // Substepping by the entity's own radius makes that impossible by
  // construction rather than by tuning: no substep is longer than the entity
  // is wide, so it cannot step over a solid it would have had to pass through.
  // Almost every call is a single substep, so the normal cost is one compare;
  // the substep count is capped so a pathological velocity cannot turn one
  // frame into a hundred collision queries.
  moveEntity(entity,dx,dy,radius=entity.radius||12){
    const distance=Math.hypot(dx,dy);
    const limit=Math.max(4,radius*.75);
    const steps=distance>limit?Math.min(MAX_MOVE_SUBSTEPS,Math.ceil(distance/limit)):1;
    const stepX=dx/steps,stepY=dy/steps;
    let corrected=false;
    for(let i=0;i<steps;i++){
      entity.x+=stepX;
      entity.y+=stepY;
      if(this.resolveCollision(entity,radius))corrected=true;
    }
    return corrected;
  }

  // Push a circular entity out of every obstacle it is currently inside.
  // Returns true when a correction was applied.
  resolveCollision(entity,radius=entity.radius||12){
    let corrected=false;
    // Arena bounds first, depenetration second. The clamp used to run last,
    // which meant that for any solid sitting near the sector edge it could
    // shove the entity back into the geometry depenetration had just pushed it
    // out of, and the entity stayed buried. Whatever runs last wins, so the
    // thing that must win runs last.
    const clampedX=clamp(entity.x,radius+8,this.width-radius-8);
    const clampedY=clamp(entity.y,radius+8,this.height-radius-8);
    if(clampedX!==entity.x||clampedY!==entity.y){
      entity.x=clampedX;entity.y=clampedY;corrected=true;
    }
    const nearby=this.obstacleHash.query(entity.x,entity.y,radius+90,queryScratch);
    // Several passes, because one is not enough in a corner: pushing out of
    // the wall on the left can push straight into the crate below, and that
    // crate has already been visited. A single pass left a body buried in
    // roughly one squeeze in a hundred. Passes stop as soon as nothing moves,
    // so open ground still costs exactly one.
    for(let pass=0;pass<DEPENETRATION_PASSES;pass++){
      let moved=false;
      for(const obstacle of nearby){
        if(obstacle.broken)continue;
        const push=resolveCircleRect(entity.x,entity.y,radius,obstacle.x,obstacle.y,obstacle.hw,obstacle.hh);
        if(push){entity.x+=push.x;entity.y+=push.y;moved=true}
      }
      if(!moved)break;
      corrected=true;
    }
    return corrected;
  }

  // True when nothing sight-blocking sits between the two points.
  hasLineOfSight(x1,y1,x2,y2){
    const midX=(x1+x2)/2,midY=(y1+y2)/2;
    const radius=Math.hypot(x2-x1,y2-y1)/2+80;
    const nearby=this.obstacleHash.query(midX,midY,radius,queryScratch);
    for(const obstacle of nearby){
      if(obstacle.broken||!obstacle.blocksSight)continue;
      if(segmentIntersectsRect(x1,y1,x2,y2,obstacle.x,obstacle.y,obstacle.hw,obstacle.hh))return false;
    }
    return true;
  }

  // Does a projectile path hit geometry? Returns the obstacle or null.
  raycastObstacle(x1,y1,x2,y2,ignoreLowCover=false){
    const midX=(x1+x2)/2,midY=(y1+y2)/2;
    const radius=Math.hypot(x2-x1,y2-y1)/2+80;
    const nearby=this.obstacleHash.query(midX,midY,radius,queryScratch);
    let closest=null,closestT=Infinity;
    for(const obstacle of nearby){
      if(obstacle.broken)continue;
      if(ignoreLowCover&&!obstacle.blocksSight)continue;
      const t=segmentRectEntry(x1,y1,x2,y2,obstacle.x,obstacle.y,obstacle.hw,obstacle.hh);
      if(t===null)continue;
      // Nearest along the ray, not nearest centre: a long thin pipe whose
      // centre is far away can still be the first thing a shot meets.
      if(t<closestT){closestT=t;closest=obstacle}
    }
    // Where the shot actually met the surface, so the impact mark lands on the
    // wall rather than at wherever the projectile had been integrated to. At
    // 1500 units/second that was up to 25 units deep inside the geometry.
    this.lastHitT=closest?closestT:0;
    this.lastHitX=x1+(x2-x1)*this.lastHitT;
    this.lastHitY=y1+(y2-y1)*this.lastHitT;
    return closest;
  }

  damageCover(cover,amount){
    if(!cover.destructible||cover.broken)return false;
    cover.hp-=amount;
    cover.shake=.22;
    if(cover.hp<=0){
      cover.broken=true;
      this.rebuildHash();
      this.buildCoverPoints();
      return true;
    }
    return false;
  }

  // A valid open spawn position, biased away from the player.
  //
  // `radius` is the entity that has to fit there. It used to be a fixed 26 for
  // everything, so a carrier or a command signature — three times that across
  // — was routinely deployed already overlapping a wall, and arrived shoved
  // out of it by the depenetration pass or wedged against it.
  findSpawn(rng,awayFrom,minDistance=520,maxDistance=1100,radius=26){
    const fromX=awayFrom?.x??this.width/2;
    const fromY=awayFrom?.y??this.height/2;
    // Clearance relaxes as the attempts run out: a dense industrial floor has
    // very few points with a carrier's full clearance, and refusing to deploy
    // at all is worse than deploying somewhere merely tight.
    for(let attempt=0;attempt<32;attempt++){
      const ease=attempt/32;
      const clearance=Math.max(20,radius*(1-ease*.55));
      const angle=rng.angle();
      const distance=rng.range(minDistance,maxDistance);
      const x=clamp(fromX+Math.cos(angle)*distance,80,this.width-80);
      const y=clamp(fromY+Math.sin(angle)*distance,80,this.height-80);
      // Never deploy hostiles into a sealed chamber they cannot leave, or
      // into a dead zone they cannot path out of.
      if(!this.overlapsSolid(x,y,clearance)&&!this.insideVault(x,y,24)&&
         this.playable(x,y,70)&&this.reachable(x,y))return{x,y};
    }
    return this.fallbackSpawn(radius);
  }

  // Open ground near a point, found by walking rings outwards from it.
  //
  // The one primitive both fallback paths need. It never consults
  // `playerSpawn`, so the player's own start can be resolved with it without
  // recursing.
  openPointNear(x,y,radius=26,{avoidVaults=true,pad=70}={}){
    if(!this.overlapsSolid(x,y,radius)&&
       (!avoidVaults||!this.insideVault(x,y,24))&&
       this.playable(x,y,pad))return{x,y};
    for(let ring=1;ring<=14;ring++){
      const distance=ring*90;
      const steps=8+ring*2;
      for(let i=0;i<steps;i++){
        const angle=(i/steps)*TAU+ring*.37;
        const px=clamp(x+Math.cos(angle)*distance,80,this.width-80);
        const py=clamp(y+Math.sin(angle)*distance,80,this.height-80);
        if(!this.overlapsSolid(px,py,radius)&&
           (!avoidVaults||!this.insideVault(px,py,24))&&
           this.playable(px,py,pad))return{x:px,y:py};
      }
    }
    return null;
  }

  // Somewhere known to be open, for when the biased search has failed.
  //
  // This used to return the arena centre on the stated assumption that
  // "generation keeps it clear". Three layouts put geometry there — the arena
  // ring, the modular grid and the vault chamber — so the assumption was
  // wrong and the failure mode was a hostile deployed inside a wall. The
  // operative's own start is a point generation now guarantees, so a ring walk
  // outwards from it is a fallback that has actually been checked.
  fallbackSpawn(radius=26){
    const start=this.playerSpawn();
    return this.openPointNear(start.x,start.y,radius)||{x:start.x,y:start.y};
  }

  // Player start: the most open room we generated. Resolved once during
  // generation, before vaults and cover are placed, so both can be kept clear
  // of it — a vault built around the spawn would seal the operative in.
  computePlayerSpawn(){
    // Every candidate is validated before it is returned, and an unvalidated
    // one is never returned at all. The previous version fell back to
    // `rooms[0]` when no room had clearance, and to the bare arena centre when
    // a layout produced no rooms; across eighty generated sectors that put the
    // operative inside solid geometry in fourteen of them, which is the
    // wall-clipping-at-spawn the owner hit.
    const fits=(x,y)=>!this.overlapsSolid(x,y,PLAYER_SPAWN_CLEARANCE)&&
                      this.playable(x,y,60);
    let best=null,bestArea=-1;
    for(const room of this.rooms){
      const area=room.w*room.h;
      if(area>bestArea&&fits(room.x,room.y)){bestArea=area;best=room}
    }
    if(best)return{x:best.x,y:best.y};
    // No room had the clearance. Search outwards from the largest room we do
    // have, or from the middle of the sector when there are no rooms at all.
    const anchor=this.rooms.reduce((a,r)=>!a||r.w*r.h>a.w*a.h?r:a,null)
      ||{x:this.width/2,y:this.height/2};
    const open=this.openPointNear(anchor.x,anchor.y,PLAYER_SPAWN_CLEARANCE,
      {avoidVaults:true,pad:60});
    if(open)return open;
    // Nothing in the sector has operative clearance. Generation should make
    // this impossible; carving a hole is better than starting inside a wall.
    this.carve({x:this.width/2,y:this.height/2,w:200,h:200});
    this.rebuildHash();
    return{x:this.width/2,y:this.height/2};
  }

  playerSpawn(){
    return this.spawnPoint||(this.spawnPoint=this.computePlayerSpawn());
  }

  // Extraction zone: a room a meaningful distance away, but not the far
  // corner of the map — the beacon has to be reachable inside the extraction
  // window while under fire, without pathfinding assistance.
  extractionPoint(from){
    const candidates=this.rooms
      .filter(room=>!this.overlapsSolid(room.x,room.y,50))
      .map(room=>({room,d:Math.sqrt(dist2(room.x,room.y,from.x,from.y))}))
      .sort((a,b)=>a.d-b.d);
    if(!candidates.length)return{x:this.width/2,y:this.height/2};
    // A third of the way out: far enough to be a withdrawal under fire, close
    // enough that the window is spent fighting through rather than sprinting.
    const pick=candidates[Math.min(candidates.length-1,Math.floor(candidates.length*.35))];
    return{x:pick.room.x,y:pick.room.y};
  }

  // Floor staining. Decals are permanent for the whole contract: the renderer
  // bakes older ones into a single layer, so the list only ever holds the
  // recent ones and the count is not a reason to throw any away.
  addDecal(x,y,radius,color,alpha=.35,kind='splat'){
    this.decals.push({
      x,y,radius,color,alpha,kind,
      rotation:this.rng.next()*Math.PI*2,
      squash:.55+this.rng.next()*.45,
      seed:this.rng.int(0,999)
    });
  }

  // A kill's worth of staining: a main pool with satellite spatter thrown
  // along the direction of the killing blow.
  // `drops` scales the satellite count on its own, so a wetter kill can throw
  // more spatter without also throwing it further — the two used to be the same
  // number, which meant asking for more mess also asked for it across half the
  // sector.
  splatter(x,y,{radius=14,color='#4a1f22',alpha=.3,angle=null,intensity=1,drops=1,kind='splat'}={}){
    const rng=this.rng;
    this.addDecal(x,y,radius*rng.range(.9,1.25),color,alpha,kind);
    const count=Math.round(rng.range(3,6)*intensity*drops);
    for(let i=0;i<count;i++){
      // Spatter cones along the hit direction when there is one, and throws in
      // all directions when the kill had no clear vector.
      const a=angle!==null?angle+rng.range(-.7,.7):rng.angle();
      const distance=radius*rng.range(.8,3.4)*intensity;
      const px=x+Math.cos(a)*distance;
      const py=y+Math.sin(a)*distance;
      if(!this.isInside(px,py,4))continue;
      this.addDecal(px,py,radius*rng.range(.16,.5),color,alpha*rng.range(.6,1),kind);
    }
  }

  update(dt,engine){
    for(const cover of this.cover)if(cover.shake>0)cover.shake=Math.max(0,cover.shake-dt*3);
    this.updateHazards(dt,engine);
  }

  updateHazards(dt,engine){
    for(const hazard of this.hazards){
      if(hazard.passive)continue;
      hazard.timer-=dt;
      if(hazard.warning>0){
        hazard.warning-=dt;
        if(hazard.warning<=0){
          hazard.active=true;
          hazard.activeTimer=.35;
          engine?.onHazardFire?.(hazard);
        }
      }else if(hazard.active){
        hazard.activeTimer-=dt;
        if(hazard.activeTimer<=0)hazard.active=false;
      }else if(hazard.timer<=0){
        hazard.timer=hazard.interval||4;
        hazard.warning=hazard.warn||1;
      }
    }
  }

  // Passive hazards the given point is standing in (water, ice, molten metal).
  passiveHazardAt(x,y){
    for(const hazard of this.hazards){
      if(!hazard.passive)continue;
      if(dist2(x,y,hazard.x,hazard.y)<hazard.radius*hazard.radius)return hazard;
    }
    return null;
  }

  isInside(x,y,margin=0){
    return x>margin&&y>margin&&x<this.width-margin&&y<this.height-margin;
  }
}

const queryScratch=[];

export {pointInRect};
