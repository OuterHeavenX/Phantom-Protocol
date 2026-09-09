const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1000,height:700}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8080');
 await page.locator('.splash-hit[data-splash="start"]').click();
 const result=await page.evaluate(async()=>{
  const {MAPS,DURATIONS,DIFFICULTIES}=await import('/data/maps.js');
  const {OPERATIVES}=await import('/data/operatives.js');
  const {loadCombatants,drawCombatant}=await import('/src/render/combatants.js');
  window.__screens.startGame({operative:OPERATIVES.find(o=>o.id==='wraith'),map:MAPS[0],duration:5,durationSpec:DURATIONS[0],difficulty:DIFFICULTIES[0],seed:412});
  const s=window.__pp,e=s.engine,r=s.renderer;
  await r.architecture.ready;await loadCombatants();e.paused=true;
  e.camera.x=e.player.x;e.camera.y=e.player.y;
  e.fx.activeMuzzleLights=()=>[];r.drawLighting();
  const c=r.lightCtx,w=r.lightCanvas.width,h=r.lightCanvas.height;
  const before=c.getImageData(0,0,w,h).data;
  e.fx.activeMuzzleLights=()=>[{x:e.player.x,y:e.player.y,radius:120,r:1,g:.8,b:.5,intensity:1}];
  r.drawLighting();const after=c.getImageData(0,0,w,h).data;
  const radius=120*e.camera.zoom*.5,cx=Math.floor(w/2),cy=Math.floor(h/2);
  const delta=(x,y)=>{const i=(y*w+x)*4;return [...after.slice(i,i+4)].reduce((v,n,j)=>v+Math.abs(n-before[i+j]),0)};
  const corner=delta(cx+Math.floor(radius*.85),cy+Math.floor(radius*.85));
  const center=delta(cx,cy);
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const ctx=canvas.getContext('2d');const poses=[];
  for(let p=0;p<4;p++){
   drawCombatant(ctx,'op-wraith',{x:64+p*128,y:90,radius:18,angle:0},{phase:p*Math.PI/2+.01,moving:true});
   poses.push(Array.from(ctx.getImageData(p*128,0,128,128).data).join(','));
  }
  window.__walkPreview=canvas.toDataURL();
  return {corner,center,distinctWalkFrames:new Set(poses).size};
 });
 assert.ok(result.corner<=2,'Muzzle corners must remain transparent within Canvas rounding');
 assert.ok(result.center>0,'Muzzle must still illuminate the center');
 assert.ok(result.distinctWalkFrames>=3,'Walking must have distinct stride poses');
 assert.deepEqual(errors,[]);
 const png=await page.evaluate(()=>window.__walkPreview.split(',')[1]);
 fs.writeFileSync('tools/visual-qa-output/walk-preview.png',Buffer.from(png,'base64'));
 console.log(JSON.stringify(result));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});


