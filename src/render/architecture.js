// Raised architecture drawn from the exact simulation footprints. Height is
// a visual projection only: bases, door gaps and collision never drift apart.
const BASE=new URL('../../assets/sprites/architecture/',import.meta.url);
const imageCache=new Map();
const COLORS={
  blacksite:{floor:'#273237',face:'#3c4445',cap:'#697471',trim:'#a7b5ac',joint:'#172124',light:'#ffd098'},
  crossfall:{floor:'#273135',face:'#344149',cap:'#68767b',trim:'#a7bfc3',joint:'#17232c',light:'#ffce94'},
  hollow:{floor:'#6c7e88',face:'#344552',cap:'#92a5ae',trim:'#d4e1e2',joint:'#23333f',light:'#ffce99'}
};
function loadImage(name){
  if(!imageCache.has(name))imageCache.set(name,new Promise(resolve=>{
    const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);
    image.src=new URL(name+'.webp',BASE).href;
  }));
  return imageCache.get(name);
}
function polygon(ctx,points,fill){
  ctx.fillStyle=fill;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();
}

export class Architecture{
  constructor(world,ctx){
    this.world=world;this.theme=world.architecture;this.active=!!this.theme;
    this.colors=COLORS[this.theme];this.disposed=false;this.items=[];
    this.footprints=[...world.walls,...world.cover];
    this.floor=null;this.stone=null;this.ready=Promise.resolve();
    this.rocks=[];
    this.spriteCache=new Map();
    if(!this.active)return;
    this.ready=Promise.all([loadImage(this.theme+'-floor'),loadImage(this.theme+'-wall'),
      ...(this.theme==='hollow'?[0,1,2].map(i=>loadImage('hollow-rock-'+i)):[])]).then(([floor,wall,...rocks])=>{
      if(this.disposed)return;
      if(floor){this.floor=ctx.createPattern(floor,'repeat');this.floor.setTransform(new DOMMatrix().scale(this.theme==='hollow'?.7:.3))}
      if(wall){this.stone=ctx.createPattern(wall,'repeat');this.stone.setTransform(new DOMMatrix().scale(.28))}
      this.rocks=rocks;
      this.prepareSprites();
    });
    // Short visual sections support painter sorting near vertical walls, while
    // collision keeps the unbroken source rectangle in its spatial index.
    for(const wall of world.walls){
      const across=wall.w>=wall.h;
      const length=across?wall.w:wall.h,count=wall.type==='ridge'?1:Math.ceil(length/120);
      for(let i=0;i<count;i++){
        const span=length/count;
        const piece={...wall,w:across?span:wall.w,h:across?wall.h:span,
          x:wall.x+(across?-wall.w/2+span*(i+.5):0),
          y:wall.y+(across?0:-wall.h/2+span*(i+.5)),
          architectureItem:true,source:wall,section:i,lastSection:i===count-1};
        piece.hw=piece.w/2;piece.hh=piece.h/2;piece.depth=piece.y+piece.hh;
        piece.height=wall.height||(wall.type==='vault'?48:wall.type==='perimeter'?78:64);
        this.items.push(piece);
      }
    }
    for(const cover of world.cover){
      const height=cover.height||({pillar:84,machinery:48,container:43,crate:30,barrier:30,lowcover:18,vaultSeal:48,vaultTerminal:30}[cover.type]||34);
      this.items.push({...cover,source:cover,architectureItem:true,depth:cover.y+cover.hh,height,cover:true});
    }
  }
  dispose(){this.disposed=true}
  visible(item,camera){return !item.source.broken&&camera.isVisible(item.x,item.y-item.height*.5,Math.max(item.w,item.h)/2+item.height+70)}

  prepareSprites(){
    // Bake repeated facade work once. Each frame then draws a small set of
    // reusable sprites rather than rebuilding masonry, bevels and gradients.
    for(const p of this.items){
      if(['ridge','boulder','vaultSeal','vaultTerminal'].includes(p.type))continue;
      const key=[p.type,p.w.toFixed(3),p.h.toFixed(3),p.height,p.cover,p.section===0,p.section%3===0,p.lastSection].join(':');
      if(!this.spriteCache.has(key)){
        const left=p.x-p.hw-p.height*.12-7,top=p.y-p.hh-p.height-20;
        const width=Math.ceil(p.w+p.height*.12+15),height=Math.ceil(p.h+p.height+28);
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(width*1.5);canvas.height=Math.ceil(height*1.5);
        const c=canvas.getContext('2d');c.scale(1.5,1.5);c.translate(-left,-top);
        this.paintItem(c,p,null);
        this.spriteCache.set(key,{canvas,width,height});
      }
      p.sprite=this.spriteCache.get(key);
    }
  }

  drawFloor(ctx,camera){
    if(!this.active)return;
    const world=this.world,C=this.colors;
    for(const z of world.floorZones){
      if(!camera.isVisible(z.x,z.y,Math.max(z.w,z.h)))continue;
      const x=z.x-z.w/2,y=z.y-z.h/2;
      ctx.save();
      ctx.fillStyle=z.style==='bunker'?'#475961':this.floor||C.floor;
      ctx.fillRect(x,y,z.w,z.h);
      if(z.style!=='snow'){
        ctx.fillStyle=this.theme==='blacksite'?'rgba(5,16,21,.46)':'rgba(5,15,24,.32)';ctx.fillRect(x,y,z.w,z.h);
        ctx.strokeStyle='rgba(177,186,165,.32)';ctx.lineWidth=2;ctx.strokeRect(x+14,y+14,z.w-28,z.h-28);
        ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=6;ctx.strokeRect(x+5,y+5,z.w-10,z.h-10);
      }
      if(z.style==='room'){
        // Flush service inlay: a visual landmark with no invented collision.
        ctx.strokeStyle='#a7b5a33b';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(z.x,z.y,100,0,Math.PI*2);ctx.stroke();
        ctx.setLineDash([14,9]);ctx.lineWidth=5;ctx.strokeStyle='#c0b38724';
        ctx.beginPath();ctx.arc(z.x,z.y,109,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
        ctx.font='600 25px ui-monospace,monospace';ctx.textAlign='center';ctx.fillStyle='#b6c0b533';
        ctx.fillText(z.label.split('/')[1]?.trim()||'SCD',z.x,z.y+8);
        // Shallow utility trenches run along the walls, leaving door centers clear.
        ctx.fillStyle='#111d2380';
        for(const sx of [x+35,x+z.w-48])for(let sy=y+35;sy<y+z.h-35;sy+=12)ctx.fillRect(sx,sy,13,4);
      }
      if(z.style==='road'){
        ctx.setLineDash([30,27]);ctx.strokeStyle='rgba(209,186,135,.52)';ctx.lineWidth=3;
        for(const offset of [-50,50]){ctx.beginPath();ctx.moveTo(x,z.y+offset);ctx.lineTo(x+z.w,z.y+offset);ctx.stroke()}
        ctx.setLineDash([]);
        // Bridge expansion joints and pedestrian safety borders.
        ctx.fillStyle='#121c2380';for(let bx=x+120;bx<x+z.w;bx+=290)ctx.fillRect(bx,y,6,z.h);
        ctx.strokeStyle='#cfb88388';ctx.lineWidth=3;
        for(const by of [y+38,y+z.h-38]){ctx.beginPath();ctx.moveTo(x,by);ctx.lineTo(x+z.w,by);ctx.stroke()}
      }
      if(z.style==='snow'){
        // Dark compacted path winding through the basin, with tire tracks.
        ctx.strokeStyle='rgba(35,55,67,.18)';ctx.lineWidth=116;
        ctx.beginPath();ctx.moveTo(x,z.y);ctx.bezierCurveTo(z.x-z.w*.2,z.y+65,z.x+z.w*.2,z.y-65,x+z.w,z.y);ctx.stroke();
        ctx.setLineDash([3,8]);ctx.strokeStyle='rgba(29,44,56,.15)';ctx.lineWidth=8;
        for(const sy of [-26,26]){ctx.beginPath();ctx.moveTo(x,z.y+sy);ctx.lineTo(x+z.w,z.y+sy);ctx.stroke()}
      }
      ctx.setLineDash([]);
      ctx.font='600 14px ui-monospace,monospace';ctx.textAlign='center';
      ctx.fillStyle=this.theme==='hollow'?'#223e4e99':'#c4c5ac66';
      ctx.fillText(z.label,z.x,z.y-z.h/2+53);
      ctx.restore();
    }
    for(const d of world.doorways){
      if(!camera.isVisible(d.x,d.y,160))continue;
      ctx.save();ctx.translate(d.x,d.y);
      const w=d.w,h=d.h;
      ctx.fillStyle='#172529';ctx.fillRect(-w/2,-h/2,w,h);
      ctx.strokeStyle='#b8c5b6';ctx.lineWidth=2;ctx.strokeRect(-w/2,-h/2,w,h);
      ctx.strokeStyle='#c4a26988';ctx.lineWidth=3;ctx.setLineDash([5,6]);
      ctx.strokeRect(-w/2+5,-h/2+5,w-10,h-10);
      ctx.restore();
    }
    // Contact shadows make each collider's ground footprint unambiguous.
    for(const p of this.footprints){
      if(p.broken||!camera.isVisible(p.x,p.y,Math.max(p.w,p.h)/2+180))continue;
      const x=p.x-p.hw,y=p.y-p.hh;
      const reach=(p.height||56)*.48;
      polygon(ctx,[[x,y],[x+p.w,y],[x+p.w+reach,y+p.h+reach*.55],[x+reach,y+p.h+reach*.55]],'rgba(0,0,0,.25)');
      ctx.fillStyle='rgba(0,0,0,.22)';ctx.fillRect(x+4,y+5,p.w+3,p.h+5);
      ctx.fillStyle=this.colors.joint;ctx.fillRect(x-2,y-2,p.w+4,p.h+4);
      ctx.strokeStyle='rgba(185,200,193,.19)';ctx.lineWidth=1;ctx.strokeRect(x-3,y-3,p.w+6,p.h+6);
    }
    // Static warm/cool pools are visible even with the expensive light pass off.
    for(const l of world.structureLights){
      if(!camera.isVisible(l.x,l.y,l.radius))continue;
      const g=ctx.createRadialGradient(l.x,l.y,2,l.x,l.y,l.radius);
      g.addColorStop(0,l.color+'20');g.addColorStop(1,l.color+'00');
      ctx.fillStyle=g;ctx.fillRect(l.x-l.radius,l.y-l.radius,l.radius*2,l.radius*2);
    }
  }

  drawItem(ctx,p,player){
    if(p.source.broken)return;
    if(!p.sprite||(p.source.destructible&&p.source.hp<p.source.maxHp))return this.paintItem(ctx,p,player);
    const x=p.x-p.hw,y=p.y-p.hh,z=p.height;
    const occludes=player&&player.x>x-16&&player.x<x+p.w+16&&player.y<p.y+p.hh&&player.y>y-z-30;
    ctx.save();if(occludes)ctx.globalAlpha=.35;
    ctx.drawImage(p.sprite.canvas,x-z*.12-7,y-z-20,p.sprite.width,p.sprite.height);ctx.restore();
  }

  paintItem(ctx,p,player){
    if(p.source.broken)return;
    const C=this.colors,x=p.x-p.hw,y=p.y-p.hh,z=p.height,bottom=p.y+p.hh;
    ctx.save();
    // Fade only the raised portion that can hide the player; the solid base
    // remains drawn in the ground pass, so the collision boundary stays clear.
    const occludes=player&&player.x>x-16&&player.x<x+p.w+16&&player.y<bottom&&player.y>y-z-30;
    if(occludes)ctx.globalAlpha=.35;
    if(p.type==='ridge'||p.type==='boulder'){
      this.drawRock(ctx,p);ctx.restore();return;
    }
    const lean=z*.12;
    // Front fascia extends UP from its real southern collision edge.
    ctx.fillStyle=this.stone||C.face;ctx.fillRect(x,y-z,p.w,p.h+z);
    const grad=ctx.createLinearGradient(0,bottom-z,0,bottom);
    grad.addColorStop(0,'rgba(4,12,19,.30)');grad.addColorStop(.65,'rgba(4,12,19,.50)');grad.addColorStop(1,'rgba(1,5,9,.83)');
    ctx.fillStyle=grad;ctx.fillRect(x,bottom-z,p.w,z);
    // Recessed courses, anchor points and a heavy foundation plinth.
    ctx.fillStyle='#090e1166';ctx.fillRect(x,bottom-10,p.w,10);
    ctx.fillStyle='#85918b40';ctx.fillRect(x,bottom-11,p.w,2);
    for(let by=bottom-z+18;by<bottom-12;by+=22){ctx.fillStyle='#03090c55';ctx.fillRect(x,by,p.w,1)}
    polygon(ctx,[[x-lean,bottom-z],[x+p.w-lean,bottom-z],[x+p.w,bottom],[x,bottom]],this.stone||C.face);
    ctx.save();ctx.beginPath();ctx.moveTo(x-lean,bottom-z);ctx.lineTo(x+p.w-lean,bottom-z);ctx.lineTo(x+p.w,bottom);ctx.lineTo(x,bottom);ctx.closePath();ctx.clip();
    ctx.fillStyle=grad;ctx.fillRect(x-lean,bottom-z,p.w+lean,z);ctx.restore();
    if(p.lastSection||p.cover||p.w<p.h)polygon(ctx,[[x+p.w-lean,y-z],[x+p.w,y],[x+p.w,bottom],[x+p.w-lean,bottom-z]],'#17242ce6');
    ctx.fillStyle=this.stone||C.cap;ctx.fillRect(x-lean,y-z,p.w,p.h);
    ctx.fillStyle=this.theme==='hollow'?'rgba(205,224,231,.30)':'rgba(130,154,146,.12)';ctx.fillRect(x-lean,y-z,p.w,p.h);
    ctx.strokeStyle=C.trim;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x-lean,y-z);ctx.lineTo(x+p.w-lean,y-z);ctx.moveTo(x-lean,bottom-z);ctx.lineTo(x+p.w-lean,bottom-z);ctx.stroke();
    if(p.cover||p.w<p.h||p.section===0){ctx.beginPath();ctx.moveTo(x-lean,y-z);ctx.lineTo(x-lean,bottom-z);ctx.stroke()}
    if(p.cover||p.w<p.h||p.lastSection){ctx.beginPath();ctx.moveTo(x+p.w-lean,y-z);ctx.lineTo(x+p.w-lean,bottom-z);ctx.stroke()}
    ctx.fillStyle='#d6ded733';ctx.fillRect(x-lean+2,y-z+2,p.w-4,2);
    if(p.type==='pier'||p.type==='pillar'){
      ctx.fillStyle='#17232b66';ctx.fillRect(x+p.w*.22,bottom-z+12,p.w*.16,z-22);ctx.fillRect(x+p.w*.64,bottom-z+12,p.w*.16,z-22);
      ctx.fillStyle=C.cap;ctx.fillRect(x-lean-3,y-z-8,p.w+6,9);ctx.strokeStyle=C.trim;ctx.strokeRect(x-lean-3,y-z-8,p.w+6,9);
    }
    if(p.cover)this.drawEquipment(ctx,p,x-lean,y,z);
    else if(p.section%3===0&&p.w>50&&p.type!=='perimeter'){
      ctx.fillStyle='#141f24';ctx.fillRect(p.x-8,bottom-z+10,16,9);
      ctx.fillStyle=C.light;ctx.fillRect(p.x-5,bottom-z+12,10,4);
    }
    if(p.type==='vaultSeal'){
      const lit=p.source.vault?.discovered?'#f5d27a':'#9fc7bc';
      ctx.strokeStyle=lit;ctx.lineWidth=3;ctx.strokeRect(x+5,y-z+5,p.w-10,p.h-10);
    }
    if(p.source.destructible&&p.source.hp<p.source.maxHp){
      ctx.fillStyle='#071218';ctx.fillRect(p.x-18,bottom+4,36,3);
      ctx.fillStyle='#d5ab67';ctx.fillRect(p.x-18,bottom+4,36*Math.max(0,p.source.hp/p.source.maxHp),3);
    }
    ctx.restore();
  }

  drawEquipment(ctx,p,x,y,z){
    const top=y-z;
    if(['crate','container','barrier','lowcover'].includes(p.type)){
      ctx.fillStyle=p.type==='crate'?'#776348':'#465b5b';ctx.fillRect(x+3,top+3,p.w-6,p.h-6);
      ctx.strokeStyle='#a1ac9377';ctx.lineWidth=2;ctx.strokeRect(x+6,top+6,p.w-12,p.h-12);
      ctx.strokeStyle='#19272caa';ctx.lineWidth=3;
      for(let bx=x+14;bx<x+p.w-8;bx+=16){ctx.beginPath();ctx.moveTo(bx,top+5);ctx.lineTo(bx,top+p.h-5);ctx.stroke()}
      // Yellow corner tabs consistently identify destructible cover.
      ctx.fillStyle='#d3ae68';ctx.fillRect(x+4,top+4,10,3);ctx.fillRect(x+p.w-14,top+p.h-7,10,3);
    }
    if(p.type==='machinery'){
      ctx.fillStyle='#192c32';ctx.fillRect(x+8,top+8,p.w-16,p.h-16);
      ctx.fillStyle='#80b8b1';ctx.fillRect(x+12,top+12,18,9);
      ctx.fillStyle='#8c99926b';for(let bx=x+38;bx<x+p.w-10;bx+=7)ctx.fillRect(bx,top+12,3,p.h-24);
    }
  }

  drawRock(ctx,p){
    const x=p.x-p.hw,y=p.y-p.hh,z=p.height,w=p.w,h=p.h,seed=(p.section??p.variant??0)%3;
    const top=y-z;
    const rock=this.rocks[(Math.floor(p.x/180)+(p.variant||0))%3];
    if(rock){
      // A dark base still marks the full collider beneath the ragged silhouette.
      ctx.fillStyle='#243b46';ctx.fillRect(x,y+h-14,w,14);
      ctx.drawImage(rock,x-3,top-15,w+6,z+h+15);
      return;
    }
    polygon(ctx,[[x,y+h],[x+w,y+h],[x+w,top+20],[x+w*.7,top-5],[x+w*.32,top+8],[x,top+30]],'#344957');
    polygon(ctx,[[x,y+h],[x+w*.30,y+h-8],[x+w*.40,top+22],[x+w*.25,top+12],[x,top+30]],'#516574');
    polygon(ctx,[[x+w*.3,y+h-8],[x+w*.65,y+h],[x+w*.75,top+8],[x+w*.4,top+22]],seed===1?'#273d4d':'#3e5566');
    polygon(ctx,[[x+w*.65,y+h],[x+w,y+h],[x+w,top+20],[x+w*.75,top+8]],'#223746');
    if(this.stone){ctx.save();ctx.globalAlpha*=.35;ctx.fillStyle=this.stone;ctx.fillRect(x,top+32,w,Math.max(0,z+h-32));ctx.restore()}
    // A snow cornice sits directly on the rock cap, never in the walk lane.
    polygon(ctx,[[x,top+30],[x+w*.25,top+7],[x+w*.7,top-8],[x+w,top+20],[x+w,top+29],[x+w*.6,top+12],[x+w*.25,top+24],[x,top+40]],'#b1c2c9');
    ctx.strokeStyle='#10253299';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+w*.43,top+30);ctx.lineTo(x+w*.38,top+z*.6);ctx.lineTo(x+w*.48,y+h-8);ctx.stroke();
  }
}
