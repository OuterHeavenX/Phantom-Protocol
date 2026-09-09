// Authored circulation plans for the opening campaign. All solid architecture
// is made with World.addWall/addCover; decorative ground paint never collides.
export const OPENING_LEVELS=new Set(['blacksite','crossfall','hollow']);

function wall(world,x,y,w,h,kind='masonry',height=64){
  const o=world.addWall(x,y,w,h,{type:kind});o.height=height;return o;
}
function cover(world,x,y,w,h,kind='crate',height=30){
  const permanent=['pillar','machinery','boulder'].includes(kind);
  const o=world.addCover(x,y,{type:kind,w,h,hp:permanent?0:150,blocksSight:true,destructible:!permanent});
  o.height=height;return o;
}
function zone(world,x,y,w,h,label,style='room'){
  world.floorZones.push({x,y,w,h,label,style});
  world.rooms.push({x,y,w:w-90,h:h-90});
}
function lamp(world,x,y,color='#ffc781',radius=150){world.structureLights.push({x,y,color,radius})}
function doorway(world,x,y,w,h,vertical=false){
  world.doorways.push({x,y,w,h,vertical});
  lamp(world,x+(vertical?0:-w/2+14),y+(vertical?-h/2+14:0),'#9ed9d2',100);
  lamp(world,x+(vertical?0:w/2-14),y+(vertical?h/2-14:0),'#9ed9d2',100);
}

export function buildOpeningLevel(world){
  if(!OPENING_LEVELS.has(world.map.id))return false;
  world.architecture=world.map.id;
  world.floorZones=[];world.doorways=[];world.structureLights=[];
  world.protectedRoutes=[];
  if(world.map.id==='blacksite')blacksite(world);
  else if(world.map.id==='crossfall')crossfall(world);
  else hollow(world);
  return true;
}

function blacksite(world){
  const W=world.width,H=world.height,cw=W/3,ch=H/3,t=42,gap=180;
  const names=['ARCHIVE / 01','REACTOR / 02','CONTAINMENT / 03','TRANSIT / 04','CONTROL / 05','LABORATORY / 06','STORES / 07','INTAKE / 08','MEDICAL / 09'];
  world.vaultSites=[];
  // Nine rooms linked by wide, centered doors. Every room has at least two
  // entrances, and the central control chamber has all four.
  for(let row=0;row<3;row++)for(let col=0;col<3;col++){
    const x=(col+.5)*cw,y=(row+.5)*ch;
    zone(world,x,y,cw-t,ch-t,names[row*3+col]);
    if(row!==1&&col!==1)world.vaultSites.push({x:x+(col===0?-1:1)*(cw/2-140),y:y+ch/2-140});
    world.protectedRoutes.push({x,y,w:cw,h:140},{x,y,w:140,h:ch});
    // Heavy buttresses and equipment bays are visibly flush to room edges.
    for(const side of [-1,1]){
      cover(world,x+side*(cw/2-100),y-ch/2+108,62,62,'pillar',92);
      // Keep the lower quadrants of the corner rooms free for sealed vaults.
      if(row===1||col===1)cover(world,x+side*(cw/2-100),y+ch/2-108,62,62,'pillar',92);
      cover(world,x+side*(cw/2-130),y-145,98,48,col===1?'machinery':'container',46);
      lamp(world,x+side*(cw/2-92),y+ch/2-92,'#ffbf79',190);
    }
    if(col<2){
      const wx=(col+1)*cw,part=(ch-gap)/2;
      wall(world,wx,row*ch+part/2,t,part);
      wall(world,wx,(row+1)*ch-part/2,t,part);
      doorway(world,wx,y,t+16,gap,true);
    }
    if(row<2){
      const wy=(row+1)*ch,part=(cw-gap)/2;
      wall(world,col*cw+part/2,wy,part,t);
      wall(world,(col+1)*cw-part/2,wy,part,t);
      doorway(world,x,wy,gap,t+16);
    }
  }
  world.authoredSpawn={x:W/2,y:H/2};
}

function crossfall(world){
  const W=world.width,H=world.height,cy=H/2,half=Math.min(H*.32,390),rail=38;
  wall(world,W/2,cy-half,W,rail,'parapet',62);
  wall(world,W/2,cy+half,W,rail,'parapet',62);
  world.water={y0:0,y1:cy-half-rail/2,y2:cy+half+rail/2,y3:H};
  world.protectedRoutes.push({x:W/2,y:cy,w:W,h:160});
  zone(world,W/2,cy,W-120,half*2-rail,'CROSSFALL / TRANSIT DECK','road');
  // Symmetric piers frame each bay; the middle lane is never blocked.
  for(let i=0;i<5;i++){
    const x=W*(i+.5)/5;
    world.rooms.push({x,y:cy,w:W/5-100,h:half*1.2});
    for(const side of [-1,1]){
      wall(world,x,cy+side*(half-65),84,94,'pier',124);
      lamp(world,x,cy+side*(half-120),'#ffd095',205);
      if(i>0&&i<4){
        cover(world,x+150,cy+side*155,130,66,'container',48);
        cover(world,x-120,cy+side*165,74,38,'barrier',32);
      }
    }
  }
  world.authoredSpawn={x:W*.5,y:cy};
}

function hollow(world){
  const W=world.width,H=world.height,ridge=H*.19,cy=H/2;
  world.playBounds={minX:40,maxX:W-40,minY:ridge+55,maxY:H-ridge-55};
  // A continuous collision ridge, with individually faceted rock faces.
  for(const y of [ridge,H-ridge]){
    for(let x=0;x<W;x+=180)wall(world,x+Math.min(180,W-x)/2,y,Math.min(180,W-x),108,'ridge',98+(Math.floor(x/180)%3)*14);
  }
  zone(world,W/2,cy,W-160,H-ridge*2-110,'HOLLOW / RESCUE CORRIDOR','snow');
  world.protectedRoutes.push({x:W/2,y:cy,w:W,h:190});
  // Two open-ended bunker compounds and a wide route through the middle.
  for(const side of [-1,1]){
    const bx=W*(side<0?.27:.73),by=cy+side*205,bw=310,bh=190;
    wall(world,bx,by+side*bh/2,bw,40,'bunker',66);
    wall(world,bx-bw/2,by,40,bh,'bunker',66);
    wall(world,bx+bw/2,by,40,bh,'bunker',66);
    zone(world,bx,by,bw-40,bh-40,side<0?'RELAY / A':'SHELTER / B','bunker');
    doorway(world,bx,by-side*bh/2,bw-40,38);
    lamp(world,bx,by-side*bh/2,'#ffbe7c',220);
    cover(world,bx+80,by+side*30,65,40,'crate',32);
  }
  for(let i=0;i<10;i++){
    const x=150+(W-300)*i/9,side=i%2?1:-1,y=cy+side*(170+(i%3)*38);
    if(world.overlapsSolid(x,y,100))continue;
    cover(world,x,y,90+(i%3)*18,72,'boulder',70+(i%3)*14);
  }
  for(let i=0;i<5;i++)world.rooms.push({x:W*(i+.5)/5,y:cy,w:W/5-60,h:220});
  world.authoredSpawn={x:W*.5,y:cy};
}

// Reserve continuous circulation and doorway approaches, not just the spawn.
export function intersectsRoute(world,x,y,hw,hh){
  return world.protectedRoutes?.some(r=>Math.abs(x-r.x)<r.w/2+hw&&Math.abs(y-r.y)<r.h/2+hh)||
    world.doorways?.some(d=>Math.abs(x-d.x)<d.w/2+hw+65&&Math.abs(y-d.y)<d.h/2+hh+65);
}
