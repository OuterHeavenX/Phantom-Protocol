import {Rng} from '../core/rng.js';
import {clamp,dist2,segmentIntersectsRect,resolveCircleRect,pointInRect,SpatialHash} from '../core/math.js';
import {HAZARDS} from '../../data/maps.js';

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
    this.width=Math.round(base*(layout.type==='open'?1.2:1));
    this.height=Math.round(base*(layout.type==='open'?1.12:1));

    this.buildPerimeter();

    switch(layout.type){
      case 'open':this.generateOpenField();break;
      case 'streets':this.generateStreets();break;
      case 'industrial':this.generateIndustrial();break;
      case 'modular':this.generateModular();break;
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
  }

  // Sealed vaults. The chamber walls are ordinary geometry that reads as part
  // of the sector — nothing is invisible and nothing blocks movement without
  // being drawn. What is hidden is that the chamber is worth opening: that is
  // only revealed once the operative's scanner picks it up at close range.
  placeVaults(){
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

      const door=sides[facing];
      const seal=this.addCover(x+door.dx,y+door.dy,{
        type:'vaultSeal',w:door.w,h:door.h,
        hp:520,blocksSight:true,destructible:true
      });
      seal.vaultSeal=true;

      const vault={
        x,y,half,seal,walls,facing,
        // A guarded vault trades a bigger payout for a garrison on breach.
        guarded:rng.next()<.4,
        discovered:false,breached:false,
        pulse:rng.next()*10
      };
      // The renderer reads discovery state off the seal it is drawing.
      seal.vault=vault;
      this.vaults.push(vault);
    }
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
    const target=Math.round(this.width*this.height/26000*this.layout.coverDensity);
    let placed=0,attempts=0;
    while(placed<target&&attempts<target*14){
      attempts++;
      const spec=rng.pick(COVER_TYPES);
      const x=rng.range(120,this.width-120);
      const y=rng.range(120,this.height-120);
      if(this.overlapsSolid(x,y,Math.max(spec.w,spec.h)/2+34))continue;
      // Leave vault interiors clear so the payout has somewhere to land.
      if(this.insideVault(x,y,30))continue;
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
        for(let attempt=0;attempt<30&&!placed;attempt++){
          const clearance=Math.max(30,spec.radius*(attempt<10?.5:attempt<20?.3:.18));
          const x=rng.range(180,this.width-180);
          const y=rng.range(180,this.height-180);
          if(!this.overlapsSolid(x,y,clearance)&&!this.insideVault(x,y,20))placed={x,y};
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

  // Push a circular entity out of every obstacle it is currently inside.
  // Returns true when a correction was applied.
  resolveCollision(entity,radius=entity.radius||12){
    let corrected=false;
    const nearby=this.obstacleHash.query(entity.x,entity.y,radius+90,queryScratch);
    for(const obstacle of nearby){
      if(obstacle.broken)continue;
      const push=resolveCircleRect(entity.x,entity.y,radius,obstacle.x,obstacle.y,obstacle.hw,obstacle.hh);
      if(push){entity.x+=push.x;entity.y+=push.y;corrected=true}
    }
    entity.x=clamp(entity.x,radius+8,this.width-radius-8);
    entity.y=clamp(entity.y,radius+8,this.height-radius-8);
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
    let closest=null,closestD=Infinity;
    for(const obstacle of nearby){
      if(obstacle.broken)continue;
      if(ignoreLowCover&&!obstacle.blocksSight)continue;
      if(!segmentIntersectsRect(x1,y1,x2,y2,obstacle.x,obstacle.y,obstacle.hw,obstacle.hh))continue;
      const d=dist2(x1,y1,obstacle.x,obstacle.y);
      if(d<closestD){closestD=d;closest=obstacle}
    }
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
  findSpawn(rng,awayFrom,minDistance=520,maxDistance=1100){
    for(let attempt=0;attempt<28;attempt++){
      const angle=rng.angle();
      const distance=rng.range(minDistance,maxDistance);
      const x=clamp((awayFrom?.x??this.width/2)+Math.cos(angle)*distance,80,this.width-80);
      const y=clamp((awayFrom?.y??this.height/2)+Math.sin(angle)*distance,80,this.height-80);
      // Never deploy hostiles into a sealed chamber they cannot leave.
      if(!this.overlapsSolid(x,y,26)&&!this.insideVault(x,y,24))return{x,y};
    }
    // Fall back to the arena centre offset, which generation keeps clear.
    return{x:clamp(this.width/2,80,this.width-80),y:clamp(this.height/2,80,this.height-80)};
  }

  // Player start: the most open room we generated. Resolved once during
  // generation, before vaults and cover are placed, so both can be kept clear
  // of it — a vault built around the spawn would seal the operative in.
  computePlayerSpawn(){
    if(!this.rooms.length)return{x:this.width/2,y:this.height/2};
    let best=this.rooms[0],bestArea=0;
    for(const room of this.rooms){
      const area=room.w*room.h;
      if(area>bestArea&&!this.overlapsSolid(room.x,room.y,40)){bestArea=area;best=room}
    }
    return{x:best.x,y:best.y};
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
    // Around the 70th percentile of distance: a real trek, not a map crossing.
    const pick=candidates[Math.min(candidates.length-1,Math.floor(candidates.length*.7))];
    return{x:pick.room.x,y:pick.room.y};
  }

  addDecal(x,y,radius,color,alpha=.35,kind='splat'){
    this.decals.push({x,y,radius,color,alpha,kind,rotation:Math.random()*Math.PI*2,life:1});
    // Bounded so long runs never accumulate unbounded draw work.
    if(this.decals.length>320)this.decals.splice(0,this.decals.length-320);
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
