// Real-browser smoke check. Supply PLAYWRIGHT_MODULE when it is not on NODE_PATH.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const path=require('node:path');
const out=path.join(__dirname,'visual-qa-output');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const seedProgress=()=>localStorage.setItem('red-static-save',JSON.stringify({version:3,campaign:{op1:{completed:true}},statistics:{missions:2}}));
  await page.addInitScript(seedProgress);
  await page.goto('http://127.0.0.1:8080');
  await page.locator('.splash-hit[data-splash="start"]').click();
  await page.waitForTimeout(1200);
  await page.screenshot({path:path.join(out,'command.png')});
  await page.locator('[data-route="deploy"]').click();
  await page.locator('#deployBtn').click();
  await page.waitForTimeout(2000);
  const loaded=await page.evaluate(async()=>{
    const {loadCombatants,combatantStatus}=await import('/src/render/combatants.js');
    await loadCombatants();return combatantStatus();
  });
  if(loaded.loaded!==36)throw Error('Incomplete roster: '+JSON.stringify(loaded));
  // Deploy every hostile through the game's actual factories. Freeze the
  // simulation after capture setup to make a repeatable visual review scene.
  await page.evaluate(async()=>{
    const {ENEMIES,ELITES,CHOPPER,CARRIER}=await import('/data/enemies.js');
    const e=window.__pp.engine;
    e.player.invulnerable=999;
    const units=[...ENEMIES,CHOPPER,CARRIER];
    for(let i=0;i<units.length;i++){
      const a=i/units.length*Math.PI*2;
      const p=e.player;
      const enemy=e.spawnEnemy(units[i],p.x+Math.cos(a)*210,p.y+Math.sin(a)*170);
      if(enemy){enemy.awareness=1;enemy.angle=a+Math.PI}
    }
    e.spawnEliteEnemy(ELITES[1],e.player.x+130,e.player.y+30);
  });
  await page.waitForTimeout(500);
  await page.screenshot({path:path.join(out,'combat.png')});
  const runtime=await page.evaluate(()=>({enemies:window.__pp.engine.enemies.length,fps:window.__pp.renderer?.fps}));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const pause=await page.locator('body').innerText();
  if(!/PAUS|RESUME/i.test(pause))throw Error('Pause did not open');
  await page.setViewportSize({width:390,height:844});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.screenshot({path:path.join(out,'mobile.png')});
  // Pixel evidence for every atlas, heading and damage state is also available
  // independently of random encounter positioning.
  await page.evaluate(async()=>{
    const {drawCombatant}=await import('/src/render/combatants.js');
    const m=await (await fetch('/assets/sprites/combatants/manifest.json')).json();
    const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=1080;
    const c=canvas.getContext('2d');c.fillStyle='#0d171d';c.fillRect(0,0,1440,1080);
    Object.keys(m.actors).forEach((key,i)=>{
      const x=(i%6)*240+110,y=Math.floor(i/6)*180+120;
      drawCombatant(c,key,{x,y,radius:25,angle:Math.PI/4},{phase:2,moving:true});
      c.fillStyle='#bdd5d3';c.font='12px monospace';c.fillText(key,x-95,y+40);
    });
    window.__atlasPreview=canvas.toDataURL('image/png');
  });
  const png=await page.evaluate(()=>window.__atlasPreview);
  fs.writeFileSync(path.join(out,'runtime-roster.png'),Buffer.from(png.split(',')[1],'base64'));
  const theatres=await page.evaluate(async()=>{
    const {MAPS,DURATIONS,DIFFICULTIES}=await import('/data/maps.js');
    const {OPERATIVES}=await import('/data/operatives.js');
    const {Boss}=await import('/src/game/boss.js');
    const {BOSSES}=await import('/data/bosses.js');
    const checked=[];
    for(const map of MAPS){
      window.__screens.startGame({operative:OPERATIVES[0],map,duration:5,durationSpec:DURATIONS[0],difficulty:DIFFICULTIES[0],seed:412});
      const s=window.__pp;
      s.engine.bosses=BOSSES.map((b,i)=>new Boss(b,s.engine.player.x+(i-1.5)*100,s.engine.player.y+100));
      s.renderer.render();checked.push(map.id);
    }
    return checked;
  });
  const fallback=await browser.newPage({viewport:{width:960,height:640}});
  fallback.on('pageerror',e=>errors.push(e.message));
  await fallback.route('**/assets/sprites/combatants/**',route=>route.abort());
  await fallback.addInitScript(seedProgress);
  await fallback.goto('http://127.0.0.1:8080');
  await fallback.locator('.splash-hit[data-splash="start"]').click();
  await fallback.locator('[data-route="deploy"]').click();
  await fallback.locator('#deployBtn').click();
  await fallback.waitForTimeout(500);
  const fallbackCount=await fallback.evaluate(async()=>{
    const {loadCombatants}=await import('/src/render/combatants.js');
    return await loadCombatants();
  });
  if(fallbackCount!==0)throw Error('Fallback test unexpectedly loaded assets');
  await fallback.screenshot({path:path.join(out,'fallback.png')});
  if(errors.length)throw Error(errors.join('\n'));
  const results={loaded,runtime,errors,pause:true,mobile:true,theatres,fallback:true};
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
