import {TAU} from '../core/math.js';
import {withAlpha,shade,roundedRect} from './sprites.js';

// Authored theatre furniture: the large, recognisable props that make a
// sector read as a bridge or a hangar rather than a recoloured grid. Each is
// drawn from world.landmarks by kind; collision for them is registered
// separately as ordinary cover in the layout generator.

export function drawLandmark(ctx,item,palette,time){
  switch(item.kind){
    case 'bridgeTower':return drawBridgeTower(ctx,item,palette,time);
    case 'vehicle':return drawVehicle(ctx,item,palette);
    case 'boulder':return drawBoulder(ctx,item,palette);
    case 'conifer':return drawConifer(ctx,item,palette);
    case 'ridge':return drawRidge(ctx,item,palette);
    case 'deadTree':return drawDeadTree(ctx,item,palette);
    case 'aircraft':return drawAircraft(ctx,item,palette,time);
    case 'arenaRing':return drawArenaRing(ctx,item,palette,time);
    default:return;
  }
}

// ---- Crossfall Span ------------------------------------------------------

function drawBridgeTower(ctx,item,palette,time){
  const {x,y,span}=item;
  ctx.save();
  // Suspension cables sweeping between towers, drawn behind the deck furniture.
  ctx.strokeStyle=withAlpha(palette.wallEdge,.5);
  ctx.lineWidth=3;
  for(const side of [-1,1]){
    ctx.beginPath();
    ctx.moveTo(x-460,y+side*span*.55);
    ctx.quadraticCurveTo(x,y+side*(span+70),x+460,y+side*span*.55);
    ctx.stroke();
  }
  // Vertical hangers.
  ctx.strokeStyle=withAlpha(palette.wallEdge,.28);
  ctx.lineWidth=1.4;
  ctx.beginPath();
  for(let i=-4;i<=4;i++){
    const hx=x+i*90;
    for(const side of [-1,1]){
      ctx.moveTo(hx,y+side*span*.72);
      ctx.lineTo(hx,y+side*span*.94);
    }
  }
  ctx.stroke();

  // Tower legs.
  for(const side of [-1,1]){
    const ty=y+side*(span-120);
    ctx.fillStyle=shade(palette.wall,-.22);
    ctx.strokeStyle=palette.wallEdge;
    ctx.lineWidth=2;
    ctx.beginPath();roundedRect(ctx,x-26,ty-84,52,168,4);ctx.fill();ctx.stroke();
    // Aircraft warning light.
    const blink=(Math.sin(time*2.4+side)+1)/2;
    ctx.fillStyle=`rgba(255,90,80,${(.35+blink*.55).toFixed(3)})`;
    ctx.beginPath();ctx.arc(x,ty-84,5,0,TAU);ctx.fill();
  }
  ctx.restore();
}

function drawVehicle(ctx,item,palette){
  ctx.save();
  ctx.translate(item.x,item.y);
  ctx.rotate(item.rotation||0);
  const body=item.burnt?'#211c19':shade(palette.wall,.12);
  ctx.fillStyle='rgba(0,0,0,.35)';
  ctx.fillRect(-52,-20,110,44);
  ctx.fillStyle=body;
  ctx.strokeStyle=item.burnt?'#4a3a30':palette.wallEdge;
  ctx.lineWidth=1.5;
  ctx.beginPath();roundedRect(ctx,-54,-22,108,44,6);ctx.fill();ctx.stroke();
  // Cabin.
  ctx.fillStyle=item.burnt?'#16120f':withAlpha(palette.accent,.18);
  ctx.beginPath();roundedRect(ctx,-16,-15,42,30,3);ctx.fill();
  // Wheels.
  ctx.fillStyle='#15161a';
  for(const wx of [-34,30]){
    ctx.beginPath();ctx.arc(wx,-24,8,0,TAU);ctx.fill();
    ctx.beginPath();ctx.arc(wx,24,8,0,TAU);ctx.fill();
  }
  if(item.burnt){
    ctx.strokeStyle='rgba(70,50,40,.8)';
    ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(-40,-10);ctx.lineTo(-20,8);ctx.moveTo(-8,-14);ctx.lineTo(14,10);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Hollow Valley -------------------------------------------------------

function drawRidge(ctx,item,palette){
  const {x,y,w,side}=item;
  ctx.save();
  // A jagged snow crest sitting on top of the ridge wall.
  ctx.fillStyle=shade(palette.wall,-.28);
  ctx.strokeStyle=withAlpha(palette.wallEdge,.7);
  ctx.lineWidth=1.6;
  ctx.beginPath();
  ctx.moveTo(x-w/2,y+side*36);
  const peaks=Math.max(3,Math.round(w/120));
  for(let i=0;i<=peaks;i++){
    const px=x-w/2+(w*i)/peaks;
    const py=y-side*(26+((i%2)?16:34));
    ctx.lineTo(px,py);
  }
  ctx.lineTo(x+w/2,y+side*36);
  ctx.closePath();ctx.fill();ctx.stroke();
  // Snow cap along the crest.
  ctx.strokeStyle='rgba(226,244,255,.5)';
  ctx.lineWidth=3;
  ctx.beginPath();
  for(let i=0;i<=peaks;i++){
    const px=x-w/2+(w*i)/peaks;
    const py=y-side*(26+((i%2)?16:34));
    i?ctx.lineTo(px,py):ctx.moveTo(px,py);
  }
  ctx.stroke();
  ctx.restore();
}

function drawBoulder(ctx,item,palette){
  ctx.save();
  ctx.translate(item.x,item.y);
  ctx.rotate(item.rotation);
  const r=item.r;
  ctx.fillStyle='rgba(0,0,0,.32)';
  ctx.beginPath();ctx.ellipse(3,6,r,r*.82,0,0,TAU);ctx.fill();
  ctx.fillStyle='#3d4a57';
  ctx.strokeStyle=palette.wallEdge;
  ctx.lineWidth=1.6;
  ctx.beginPath();
  const facets=7;
  for(let i=0;i<facets;i++){
    const a=i/facets*TAU;
    const rr=r*(.78+((i*37)%13)/40);
    const px=Math.cos(a)*rr,py=Math.sin(a)*rr*.86;
    i?ctx.lineTo(px,py):ctx.moveTo(px,py);
  }
  ctx.closePath();ctx.fill();ctx.stroke();
  // Snow sitting on the windward face.
  ctx.fillStyle='rgba(226,244,255,.35)';
  ctx.beginPath();
  ctx.ellipse(-r*.15,-r*.42,r*.6,r*.26,-.2,0,TAU);
  ctx.fill();
  ctx.restore();
}

function drawConifer(ctx,item,palette){
  ctx.save();
  ctx.translate(item.x,item.y);
  ctx.rotate(item.rotation);
  const s=item.size;
  ctx.fillStyle='rgba(0,0,0,.3)';
  ctx.beginPath();ctx.ellipse(4,s*.22,s*.34,s*.16,0,0,TAU);ctx.fill();
  // Trunk.
  ctx.fillStyle='#2b2620';
  ctx.fillRect(-s*.05,-s*.1,s*.1,s*.36);
  // Three stacked tiers of needles, snow-laden.
  for(let tier=0;tier<3;tier++){
    const ty=-s*(.12+tier*.26);
    const tw=s*(.46-tier*.11);
    ctx.fillStyle=shade('#1d3128',tier*.09);
    ctx.beginPath();
    ctx.moveTo(0,ty-s*.30);
    ctx.lineTo(tw,ty+s*.06);
    ctx.lineTo(-tw,ty+s*.06);
    ctx.closePath();ctx.fill();
    ctx.fillStyle='rgba(226,244,255,.4)';
    ctx.beginPath();
    ctx.moveTo(0,ty-s*.30);
    ctx.lineTo(tw*.55,ty-s*.06);
    ctx.lineTo(-tw*.55,ty-s*.06);
    ctx.closePath();ctx.fill();
  }
  ctx.restore();
}

// ---- Ashen Mire ----------------------------------------------------------

function drawDeadTree(ctx,item,palette){
  ctx.save();
  ctx.translate(item.x,item.y);
  ctx.rotate(item.lean||0);
  const r=item.r;
  ctx.fillStyle='rgba(0,0,0,.34)';
  ctx.beginPath();ctx.ellipse(4,5,r*1.2,r*.9,0,0,TAU);ctx.fill();
  // Trunk with a slight taper.
  ctx.fillStyle='#2f271f';
  ctx.strokeStyle=withAlpha(palette.wallEdge,.85);
  ctx.lineWidth=1.4;
  ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.fill();ctx.stroke();
  ctx.fillStyle='#181410';
  ctx.beginPath();ctx.arc(-r*.2,-r*.2,r*.55,0,TAU);ctx.fill();
  // Bare branches reaching out past the trunk.
  ctx.strokeStyle='#4a4034';
  ctx.lineWidth=3.4;
  ctx.beginPath();
  for(let i=0;i<5;i++){
    const a=item.rotation+i*1.27;
    const len=r*(1.7+((i*29)%11)/9);
    ctx.moveTo(Math.cos(a)*r*.7,Math.sin(a)*r*.7);
    ctx.lineTo(Math.cos(a)*len,Math.sin(a)*len);
  }
  ctx.stroke();
  // Waterline stain around the base.
  ctx.strokeStyle='rgba(120,150,110,.3)';
  ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(0,0,r*1.35,0,TAU);ctx.stroke();
  ctx.restore();
}

// ---- Derelict Hangar -----------------------------------------------------

function drawAircraft(ctx,item,palette,time){
  ctx.save();
  ctx.translate(item.x,item.y);
  ctx.rotate(item.rotation||0);
  ctx.scale(item.scale||1,item.scale||1);

  const hull=item.wrecked?'#2a2723':shade(palette.wall,.30);
  const edge=item.wrecked?'#6a5a48':palette.wallEdge;

  ctx.fillStyle='rgba(0,0,0,.38)';
  ctx.beginPath();ctx.ellipse(6,10,132,34,0,0,TAU);ctx.fill();

  // Wings first so the fuselage sits on top of them.
  ctx.fillStyle=shade(hull,-.14);
  ctx.strokeStyle=edge;
  ctx.lineWidth=1.6;
  if(!item.wingBroken){
    ctx.beginPath();
    ctx.moveTo(10,-14);ctx.lineTo(-34,-104);ctx.lineTo(-6,-108);ctx.lineTo(40,-14);
    ctx.closePath();ctx.fill();ctx.stroke();
  }else{
    // Sheared wing root, with the outer panel lying nearby.
    ctx.beginPath();
    ctx.moveTo(10,-14);ctx.lineTo(-6,-52);ctx.lineTo(20,-56);ctx.lineTo(40,-14);
    ctx.closePath();ctx.fill();ctx.stroke();
    ctx.save();
    ctx.translate(-58,-96);ctx.rotate(.7);
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-52,-14);ctx.lineTo(-48,6);ctx.lineTo(4,16);
    ctx.closePath();ctx.fill();ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(10,14);ctx.lineTo(-34,104);ctx.lineTo(-6,108);ctx.lineTo(40,14);
  ctx.closePath();ctx.fill();ctx.stroke();

  // Engine nacelles.
  ctx.fillStyle=shade(hull,-.24);
  for(const ny of [-64,64]){
    ctx.beginPath();roundedRect(ctx,-24,ny-11,54,22,8);ctx.fill();ctx.stroke();
  }

  // Fuselage.
  ctx.fillStyle=hull;
  ctx.beginPath();
  ctx.moveTo(124,0);
  ctx.quadraticCurveTo(96,-26,20,-27);
  ctx.lineTo(-96,-22);
  ctx.quadraticCurveTo(-124,-14,-124,0);
  ctx.quadraticCurveTo(-124,14,-96,22);
  ctx.lineTo(20,27);
  ctx.quadraticCurveTo(96,26,124,0);
  ctx.closePath();ctx.fill();ctx.stroke();

  // Cockpit glazing.
  ctx.fillStyle=item.wrecked?'#12100e':withAlpha(palette.accent,.3);
  ctx.beginPath();roundedRect(ctx,78,-13,32,26,6);ctx.fill();

  // Tail.
  if(!item.tailBroken){
    ctx.fillStyle=shade(hull,-.10);
    ctx.beginPath();
    ctx.moveTo(-96,-8);ctx.lineTo(-138,-70);ctx.lineTo(-112,-72);ctx.lineTo(-84,-10);
    ctx.closePath();ctx.fill();ctx.stroke();
  }else{
    // Torn-off empennage: a ragged stump and scorching.
    ctx.strokeStyle='#5a4634';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(-96,-18);ctx.lineTo(-108,-6);ctx.lineTo(-98,4);ctx.lineTo(-112,16);
    ctx.stroke();
  }

  // Hull plating lines.
  ctx.strokeStyle=withAlpha(edge,.3);
  ctx.lineWidth=1;
  ctx.beginPath();
  for(let px=-88;px<108;px+=26){ctx.moveTo(px,-24);ctx.lineTo(px,24)}
  ctx.stroke();

  if(item.wrecked){
    // Scorch marks and a slow heat shimmer at the breaks.
    ctx.fillStyle='rgba(20,14,10,.55)';
    ctx.beginPath();ctx.ellipse(-70,0,40,20,0,0,TAU);ctx.fill();
    const glow=(Math.sin(time*1.7+item.x*.01)+1)/2;
    ctx.fillStyle=`rgba(255,120,60,${(.05+glow*.07).toFixed(3)})`;
    ctx.beginPath();ctx.arc(-96,0,34,0,TAU);ctx.fill();
  }
  ctx.restore();
}

// ---- Proving Ground ------------------------------------------------------

function drawArenaRing(ctx,item,palette,time){
  const {x,y,r}=item;
  ctx.save();
  // Concentric evaluation markings on the chamber floor.
  ctx.strokeStyle=withAlpha(palette.accent,.16);
  ctx.lineWidth=2;
  for(const scale of [.28,.52,.76]){
    ctx.beginPath();ctx.arc(x,y,r*scale,0,TAU);ctx.stroke();
  }
  // Radial spokes.
  ctx.strokeStyle=withAlpha(palette.accent,.09);
  ctx.lineWidth=1.5;
  ctx.beginPath();
  for(let i=0;i<12;i++){
    const a=i/12*TAU;
    ctx.moveTo(x+Math.cos(a)*r*.2,y+Math.sin(a)*r*.2);
    ctx.lineTo(x+Math.cos(a)*r*.86,y+Math.sin(a)*r*.86);
  }
  ctx.stroke();
  // A sweeping observation scan, because something is watching this.
  const sweep=time*.5;
  ctx.strokeStyle=withAlpha(palette.accent,.3);
  ctx.lineWidth=3;
  ctx.beginPath();
  ctx.arc(x,y,r*.9,sweep,sweep+.5);
  ctx.stroke();
  ctx.restore();
}
