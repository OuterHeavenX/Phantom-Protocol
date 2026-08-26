// Texture-orientation check for the authored-floor blit.
//
// A 2D canvas puts its top row at texture v=0; a full-screen pass's vUv.y=1 is
// the top of the screen. Every canvas the deferred renderer uploads therefore
// has to be sampled upside down, and getting it wrong is invisible in review
// because the operative sits near the screen centre where a vertical mirror
// barely moves anything. It shipped wrong once, on the sprite layer.
//
// This paints a bright patch in the ground canvas's top-left quadrant and
// diffs the composited frame against the same frame without it. Differential
// rather than colour-matched, because the blit writes albedo: whatever colour
// goes in comes out multiplied by the theatre's lighting.
//
// Threshold matters. At a low one the bloom spread across the whole frame
// dominates and the centroid lands dead centre, which reads as a failure when
// nothing is wrong — so the verdict is taken from the per-quadrant counts of
// strongly-changed pixels, not from a centroid alone.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
import {readPng} from './png.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:800,height:600}});
p.on('pageerror',e=>console.log('PAGEERROR',String(e).slice(0,200)));
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(400);
await p.evaluate(()=>{const raw=JSON.parse(localStorage.getItem('phantom-protocol-save')||'{}');
  raw.settings={...(raw.settings||{}),renderer:'gl',showMinimap:false};
  localStorage.setItem('phantom-protocol-save',JSON.stringify(raw))});
await p.reload({waitUntil:'load'});await p.waitForTimeout(700);
await p.evaluate(()=>document.querySelector('[data-splash="start"]')?.click());
await p.waitForTimeout(300);
await p.evaluate(()=>{[...document.querySelectorAll('button,a')].find(e=>/DEPLOY/i.test(e.textContent))?.click()});
await p.waitForTimeout(250);
await p.evaluate(()=>{const r=Math.random;Math.random=()=>0.4242;
  try{document.querySelector('#deployBtn')?.click()}finally{Math.random=r}});
await p.waitForTimeout(2400);
const shoot=async(withMarker)=>{
  await p.evaluate(m=>{
    const r=window.__pp.renderer;
    r.drawGroundLayer=function(){
      const c=this.groundCtx,W=this.groundCanvas.width,H=this.groundCanvas.height;
      c.setTransform(1,0,0,1,0,0);
      c.clearRect(0,0,W,H);
      c.fillStyle='#101014';
      c.fillRect(0,0,W,H);
      if(m){c.fillStyle='#ffffff';
        c.fillRect(Math.round(W*0.10),Math.round(H*0.10),Math.round(W*0.16),Math.round(H*0.16));}
      this.groundActive=true;
    };
    r.drawSpriteLayer=function(){
      const c=this.spriteCtx;
      c.setTransform(1,0,0,1,0,0);
      c.clearRect(0,0,this.spriteCanvas.width,this.spriteCanvas.height);
    };
  },withMarker);
  await p.waitForTimeout(1100);
  return p.screenshot({timeout:180000});
};
const state=await p.evaluate(()=>{
  const r=window.__pp.renderer;
  const wasActive=r.groundActive;
  // Marker in the ground canvas's TOP-LEFT quadrant, and force the blit on.
  r.drawGroundLayer=function(){
    const c=this.groundCtx,W=this.groundCanvas.width,H=this.groundCanvas.height;
    c.setTransform(1,0,0,1,0,0);
    c.clearRect(0,0,W,H);
    c.fillStyle='#ff00ff';
    c.fillRect(Math.round(W*0.10),Math.round(H*0.10),Math.round(W*0.16),Math.round(H*0.16));
    this.groundActive=true;
  };
  // Nothing drawn over the top, so the marker is unobstructed.
  r.drawSpriteLayer=function(){
    const c=this.spriteCtx;
    c.setTransform(1,0,0,1,0,0);
    c.clearRect(0,0,this.spriteCanvas.width,this.spriteCanvas.height);
  };
  return{authoredArtWasActive:!!wasActive,theatre:r.scene.theatre};
});
const withM=await shoot(true), without=await shoot(false);
await b.close();
const a=readPng(withM),c0=readPng(without),ch=a.channels;
let sx=0,sy=0,n=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1;
const quad=[0,0,0,0];   // TL, TR, BL, BR
// A high threshold so only the marker itself counts, not its bloom halo.
for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){
  const i=(y*a.width+x)*ch;
  const d=Math.abs(a.data[i]-c0.data[i])+Math.abs(a.data[i+1]-c0.data[i+1])+
          Math.abs(a.data[i+2]-c0.data[i+2]);
  if(d<200)continue;
  sx+=x;sy+=y;n++;
  if(x<minX)minX=x; if(x>maxX)maxX=x;
  if(y<minY)minY=y; if(y>maxY)maxY=y;
  quad[(y<a.height/2?0:2)+(x<a.width/2?0:1)]++;
}
console.log('changed-pixel bounding box',n?`x ${minX}-${maxX}, y ${minY}-${maxY}`:'(none)');
console.log('per quadrant  TL',quad[0],' TR',quad[1],' BL',quad[2],' BR',quad[3]);
console.log('theatre',state.theatre,'| authored floor art active in normal play:',state.authoredArtWasActive);
if(!n)console.log('marker NOT FOUND');
else{
  const cx=sx/n,cy=sy/n;
  console.log(`marker drawn at ground-canvas TOP-LEFT, composited at (${cx.toFixed(0)},${cy.toFixed(0)}) of ${a.width}x${a.height}  (${n} px changed)`);
  const ok=quad[0]>quad[1]+quad[2]+quad[3];
  console.log(ok?'GROUND BLIT ORIENTATION OK'
    :quad[2]>quad[0]?'*** AUTHORED FLOOR IS VERTICALLY FLIPPED ***'
    :'*** AUTHORED FLOOR IS MISPLACED ***');
  process.exitCode=ok?0:1;
}
