// Deterministic material detail baked once per theatre. No per-frame noise.
export function buildSurface(ctx,palette){
  const tile=document.createElement('canvas');
  tile.width=tile.height=384;
  const c=tile.getContext('2d');
  let seed=0x51a7;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
  c.fillStyle=palette.floor;c.fillRect(0,0,384,384);
  for(let row=0;row<4;row++)for(let col=0;col<4;col++){
    const x=col*96,y=row*96;
    c.fillStyle=(row+col)%3===0?palette.floorAlt:palette.floor;
    c.fillRect(x+1,y+1,94,94);
    const wash=c.createLinearGradient(x,y,x+96,y+96);
    wash.addColorStop(0,'rgba(176,202,211,.055)');wash.addColorStop(1,'rgba(0,0,0,.15)');
    c.fillStyle=wash;c.fillRect(x+1,y+1,94,94);
    c.strokeStyle='rgba(0,0,0,.35)';c.lineWidth=2;c.strokeRect(x+1,y+1,94,94);
    c.fillStyle='rgba(190,211,214,.10)';c.fillRect(x+3,y+3,89,1);
    for(const bx of [7,89])for(const by of [7,89]){
      c.fillStyle='#080e12';c.fillRect(x+bx-1,y+by-1,3,3);
      c.fillStyle='rgba(209,222,217,.15)';c.fillRect(x+bx,y+by,1,1);
    }
  }
  for(let i=0;i<6000;i++){
    c.fillStyle=random()>.5?'rgba(215,221,209,.027)':'rgba(0,0,0,.075)';
    c.fillRect(random()*384,random()*384,random()*2+.4,.7);
  }
  // Occasional scored paint, utility stencil and recessed drain.
  c.fillStyle='rgba(173,153,99,.12)';
  for(let y=208;y<266;y+=11)c.fillRect(288,y,4,7);
  c.font='7px ui-monospace,monospace';c.fillStyle='rgba(183,198,191,.16)';
  c.fillText('SCD / 04',301,277);
  c.fillStyle='rgba(0,0,0,.48)';c.fillRect(109,305,66,27);
  for(let x=113;x<172;x+=5){c.fillStyle='rgba(151,174,180,.14)';c.fillRect(x,308,2,21)}
  return ctx.createPattern(tile,'repeat');
}

export function wallMaterial(ctx,wall,palette){
  const x=wall.x-wall.hw,y=wall.y-wall.hh;
  // A shallow fascia supplies depth without shifting the collision silhouette.
  ctx.fillStyle='rgba(0,0,0,.45)';ctx.fillRect(x+4,y+wall.h,wall.w,6);
  ctx.fillStyle='rgba(177,202,204,.17)';ctx.fillRect(x+2,y+2,Math.max(0,wall.w-4),2);
  ctx.fillStyle='rgba(0,0,0,.27)';ctx.fillRect(x+2,y+wall.h-4,Math.max(0,wall.w-4),3);
  ctx.fillStyle=palette.accent;
  ctx.globalAlpha=.5;
  if(wall.w>wall.h){ctx.fillRect(x+8,y+wall.h-3,10,2);ctx.fillRect(x+wall.w-18,y+wall.h-3,10,2)}
  else{ctx.fillRect(x+wall.w-3,y+8,2,10);ctx.fillRect(x+wall.w-3,y+wall.h-18,2,10)}
  ctx.globalAlpha=1;
}
