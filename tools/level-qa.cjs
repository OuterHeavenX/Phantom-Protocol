const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path');
const out=path.join(__dirname,'visual-qa-output');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8080');
  await page.locator('.splash-hit[data-splash="start"]').click();
  const results=[];
  for(const id of ['blacksite','crossfall','hollow']){
    const result=await page.evaluate(async id=>{
      const {MAPS,DURATIONS,DIFFICULTIES}=await import('/data/maps.js');
      const {OPERATIVES}=await import('/data/operatives.js');
      const {CAMPAIGN}=await import('/data/campaign.js');
      const {loadCombatants}=await import('/src/render/combatants.js');
      window.__screens.startGame({operative:OPERATIVES[0],map:MAPS.find(m=>m.id===id),duration:5,durationSpec:DURATIONS[0],difficulty:DIFFICULTIES[0],operation:CAMPAIGN.find(o=>o.map===id),seed:412});
      const s=window.__pp;await s.renderer.architecture.ready;await loadCombatants();
      s.engine.player.invulnerable=0;s.engine.director.suppressed=true;
      s.engine.camera.x=s.engine.player.x;s.engine.camera.y=s.engine.player.y;
      const {ENEMIES}=await import('/data/enemies.js');
      for(let i=0;i<6;i++)s.engine.spawnEnemy(ENEMIES[i],s.engine.player.x-170+i*75,s.engine.player.y-110);
      return {id,architecture:s.renderer.architecture.active,textures:!!s.renderer.architecture.floor,walls:s.engine.world.walls.length,cover:s.engine.world.cover.length,mission:s.engine.mission.type,caches:s.engine.mission.caches.length};
    },id);
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(out,id+'-level.png')});
    // Inspect the same geometry at an entrance to judge wall and actor depth.
    await page.evaluate(()=>{
      const s=window.__pp,d=s.engine.world.doorways[0]||{x:s.engine.world.width*.5,y:s.engine.world.height*.5-190};
      s.engine.player.x=d.x+(d.vertical?85:0);s.engine.player.y=d.y+(d.vertical?0:85);s.engine.camera.x=d.x;s.engine.camera.y=d.y+40;
    });
    await page.waitForTimeout(300);await page.screenshot({path:path.join(out,id+'-entrance.png')});
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
    await page.screenshot({path:path.join(out,id+'-mobile.png')});
    await page.setViewportSize({width:1440,height:900});results.push(result);
  }
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync(path.join(out,'level-results.json'),JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({results,errors}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
