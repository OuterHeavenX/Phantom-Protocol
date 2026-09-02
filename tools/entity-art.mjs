// Does the authored art actually reach the screen?
//
// This harness exists because of a specific failure: a full Blender pipeline
// was built, rendered, compared and reported on, and none of it changed a
// single pixel of the running game — there was no loading path, and the report
// did not make that plain enough. So the assertions here are about pixels in a
// real contract, not about the loader's internals.
//
// The other half is what must NOT be baked. Boss legs are animated from the
// gait and the gunship's rotor from its spin rate; freezing either is the most
// obvious way to make an expensive asset look cheap.
import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const p=await b.newPage({viewport:{width:900,height:600}});
const errs=[];p.on('pageerror',e=>errs.push(String(e&&e.stack||e).split('\n')[0]));
const failed=[];p.on('requestfailed',r=>{if(/entities\//.test(r.url()))failed.push(r.url())});
await p.goto('http://127.0.0.1:8931/index.html',{waitUntil:'load'});
await p.waitForTimeout(500);

const out=await p.evaluate(async()=>{
  const art=await import('/src/render/entityart.js');
  const {drawEnemy,drawBoss}=await import('/src/render/sprites.js');
  const {BOSSES}=await import('/data/bosses.js');
  const res={};

  // 1. Every declared asset exists and decodes. A 404 here is a shipped hole.
  const specs=[...Object.entries(art.ENTITY_ART).map(([k,v])=>[k,v,false]),
               ...Object.entries(art.BOSS_ART).map(([k,v])=>[k,v,true])];
  res.declared=specs.length;
  const decode=src=>new Promise(r=>{const i=new Image();
    i.onload=()=>r({ok:true,w:i.naturalWidth,h:i.naturalHeight});
    i.onerror=()=>r({ok:false});i.src=src});
  res.assets={};
  for(const [kind,spec] of specs){
    res.assets[kind]=await decode('assets/sprites/entities/'+spec.file);
  }
  res.missing=Object.entries(res.assets).filter(([,v])=>!v.ok).map(([k])=>k);

  // Give the loader's own images time to arrive.
  for(const [kind,,boss] of specs)art.entityArt(kind,boss);
  await new Promise(r=>setTimeout(r,900));
  res.loaded=specs.filter(([k,,boss])=>!!art.entityArt(k,boss)).length;

  // 2. PIXELS. Draw the same entity with the art layer on and off and confirm
  //    the frames actually differ — the assertion that would have caught the
  //    whole pipeline never being wired in.
  const paint=(px,fn)=>{
    const c=document.createElement('canvas');c.width=px;c.height=px;
    const ctx=c.getContext('2d');ctx.translate(px/2,px/2);fn(ctx);
    return ctx.getImageData(0,0,px,px).data;
  };
  // Alpha only: "is something drawn in this pixel that was not before".
  const differ=(a,b)=>{let n=0;for(let i=3;i<a.length;i+=4)if(Math.abs(a[i]-b[i])>8)n++;
    return n};
  // Colour. Needed for the tint check, which changes RGB and leaves alpha
  // untouched — comparing alpha there reported two differently coloured elites
  // as identical, which looked like the recolouring being lost when it was the
  // test unable to see colour at all.
  const differRgb=(a,b)=>{let n=0;
    for(let i=0;i<a.length;i+=4){
      if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>24)n++;
    }
    return n};
  const compare=(px,fn)=>{
    art.setEntityArtEnabled(true);const on=paint(px,fn);
    art.setEntityArtEnabled(false);const off=paint(px,fn);
    art.setEntityArtEnabled(true);
    return{changed:differ(on,off),onInk:differ(on,new Uint8ClampedArray(on.length))};
  };
  const chopper=e=>drawEnemy(e,{x:0,y:0,angle:0,radius:26,color:'#c8d2d6',
    render:'chopper',rotor:0,flying:true,altitude:0},0,{});
  res.chopper=compare(200,chopper);
  res.apc=compare(200,ctx=>drawEnemy(ctx,{x:0,y:0,angle:0,radius:30,
    color:'#8d8468',render:'apc',machine:true},0,{}));
  const def=BOSSES[0];
  res.boss=compare(260,ctx=>drawBoss(ctx,{x:0,y:0,angle:0,radius:52,def,
    render:def.render,hp:2600,maxHp:2600,stridePhase:0},0));

  // 3. Moving parts must still move with the art on.
  const spin=t=>paint(200,ctx=>drawEnemy(ctx,{x:0,y:0,angle:0,radius:26,
    color:'#c8d2d6',render:'chopper',rotor:t,flying:true,altitude:0},0,{}));
  res.rotorMoves=differ(spin(0),spin(0.8));
  // `stridePhase` is the field the legs are actually driven from. An earlier
  // version varied three plausible-looking names that do not exist, so the
  // legs correctly did not move and the harness reported the walker as frozen
  // — a failure invented entirely by the test.
  const walk=t=>paint(260,ctx=>drawBoss(ctx,{x:0,y:0,angle:0,radius:52,def,
    render:def.render,hp:2600,maxHp:2600,stridePhase:t},t));
  res.legsMove=differ(walk(0),walk(1.1));

  // 4. Fallback. A missing asset must draw the PROCEDURAL SPRITE — not merely
  //    something. Comparing against an empty frame passed on a build with the
  //    fallback branch deleted outright, because the drop shadow is drawn
  //    before either path and counted as ink all by itself. The real property
  //    is that the fallback frame matches what the procedural renderer draws.
  art.setEntityArtEnabled(false);
  const procedural=paint(200,chopper);
  art.setEntityArtEnabled(true);
  art.__clearEntityArtCache();
  const beforeDecode=paint(200,chopper);
  res.fallbackInk=differ(beforeDecode,new Uint8ClampedArray(beforeDecode.length));
  res.fallbackUnlikeProcedural=differ(beforeDecode,procedural);
  // The shadow is drawn before either path, so "something was drawn" is not
  // evidence of a fallback. Measured: a full procedural gunship inks ~17,500
  // pixels and the shadow alone ~1,300, so the threshold below sits between
  // them rather than being guessed. Comparing against `procedural` alone is
  // not enough either — with the fallback branch deleted, both sides take the
  // same missing path and agree perfectly.
  res.shadowOnlyBaseline=1300;

  // 5. Elites keep their identity through the tint path.
  //
  // The art has to be back before this runs. Measured straight after the cache
  // clear above, both elites went down the procedural path — which colours from
  // `enemy.color` regardless — so the assertion passed on a build with tinting
  // switched off entirely. It was testing the fallback, not the tint.
  art.entityArt('chopper');
  for(let i=0;i<40&&!art.entityArt('chopper');i++)await new Promise(r=>setTimeout(r,50));
  res.artReadyForTint=!!art.entityArt('chopper');
  const elite=color=>paint(200,ctx=>drawEnemy(ctx,{x:0,y:0,angle:0,radius:30,
    color,render:'chopper',rotor:0,elite:true,flying:true,altitude:0},0,{}));
  res.eliteTintPixels=differRgb(elite('#ff6d65'),elite('#77e6ff'));
  // A threshold on the drawn frame is not enough on its own: elites carry
  // colour-based decoration outside the art layer, which differs between two
  // colours whether or not the sprite is tinted at all, and that baseline
  // alone cleared a naive threshold. So the wiring is also checked directly —
  // does the draw path actually ask for a tint for an elite, and not for a
  // regular hostile.
  const elitePolicy=art.tintFor({elite:true,color:'#ff6d65'});
  const plainPolicy=art.tintFor({color:'#c8d2d6'});
  res.eliteTintAsked=elitePolicy.tint;
  res.plainTintAsked=plainPolicy.tint;
  res.eliteTintColor=elitePolicy.color;
  // The tint function itself must produce different output for different
  // colours, independent of any call site.
  // Guarded. On a build where the art layer returns nothing at all, reading
  // through the null here killed the harness on a stack trace instead of
  // letting the earlier assertions report — and "the art never reaches the
  // screen" is the single failure this file was written for.
  const chopperArt=art.entityArt('chopper');
  if(chopperArt){
    const img=chopperArt.img;
    const a=art.tintedArt(img,'gunship.png','#ff0000',.45);
    const bb=art.tintedArt(img,'gunship.png','#00ff00',.45);
    const read=c=>{const cv=document.createElement('canvas');cv.width=32;cv.height=32;
      const cx=cv.getContext('2d');cx.drawImage(c,0,0,32,32);
      return cx.getImageData(0,0,32,32).data};
    res.tintFunctionDiffers=differRgb(read(a),read(bb))>50;
  }else{
    res.tintFunctionDiffers=false;
  }
  res.eliteTintDiffers=res.eliteTintPixels>200;
  // 6. Centring. A baked sprite that is offset from its entity draws every
  //    hostile in the wrong place — the bug class align.mjs exists for, and
  //    one that harness can no longer see for art-backed entities because it
  //    finds them by tint.
  // Measured against the procedural sprite rather than against the image
  // centre.
  //
  // Centroid-of-ink is not alignment: a gunship's tail is long and thin, so its
  // ink sits behind its origin even when perfectly placed, and an absolute
  // threshold just measures how asymmetric the silhouette is. The procedural
  // sprite is known-good and drawn about the same origin, so the two centroids
  // agreeing is the property that actually matters — and it stays valid for
  // any shape.
  const centroidOf=px=>d=>{
    let sx=0,sy=0,n=0;
    for(let y=0;y<px;y++)for(let x=0;x<px;x++){
      const a=d[(y*px+x)*4+3];
      if(a>40){sx+=x;sy+=y;n++}
    }
    return n?{x:sx/n-px/2,y:sy/n-px/2,n}:null;
  };
  const grounded=ctx=>drawEnemy(ctx,{x:0,y:0,angle:0,radius:26,
    color:'#c8d2d6',render:'chopper',rotor:0,flying:false},0,{});
  const at=centroidOf(200);
  art.setEntityArtEnabled(true);
  const artCentroid=at(paint(200,grounded));
  art.setEntityArtEnabled(false);
  const procCentroid=at(paint(200,grounded));
  art.setEntityArtEnabled(true);
  res.centroid=artCentroid;
  res.centroidDrift=artCentroid&&procCentroid
    ?+Math.hypot(artCentroid.x-procCentroid.x,artCentroid.y-procCentroid.y).toFixed(2)
    :null;
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('errors:',errs.length?errs.slice(0,4):'none');
console.log('failed asset requests:',failed.length?failed:'none');

const fail=[];
if(failed.length)fail.push(`${failed.length} asset request(s) failed: ${failed[0]}`);
if(out.missing.length)fail.push(`declared assets missing from disk: ${out.missing}`);
if(out.loaded<out.declared)fail.push(`${out.loaded}/${out.declared} assets reached the loader`);
if(!(out.chopper.changed>200))fail.push(`the gunship draws identically with the art layer on and off (${out.chopper.changed} px) — the art is not reaching the screen`);
if(!(out.apc.changed>200))fail.push(`the carrier draws identically with the art layer on and off (${out.apc.changed} px)`);
if(!(out.boss.changed>200))fail.push(`the boss draws identically with the art layer on and off (${out.boss.changed} px) — this is the exact failure this file exists for`);
if(!(out.chopper.onInk>500))fail.push('the gunship draws almost nothing with the art layer on');
if(!(out.boss.onInk>500))fail.push('the boss draws almost nothing with the art layer on');
if(!(out.rotorMoves>50))fail.push(`the rotor is frozen with the art layer on (${out.rotorMoves} px changed across a spin)`);
if(!(out.legsMove>50))fail.push(`the boss legs are frozen with the art layer on (${out.legsMove} px changed across a stride) — the walker glides`);
if(!(out.fallbackInk>500))fail.push('an entity with no decoded image draws nothing');
if(out.fallbackUnlikeProcedural>400)fail.push(`the fallback frame differs from the procedural render by ${out.fallbackUnlikeProcedural} px — it is not falling back to the shipped art`);
if(out.fallbackInk<out.shadowOnlyBaseline*3)fail.push(`the fallback drew only ${out.fallbackInk} px, barely more than the drop shadow alone — nothing fell back`);
if(!out.artReadyForTint)fail.push('the art never came back, so the tint assertion below would be testing the fallback path');
if(!out.eliteTintDiffers)fail.push(`two elites of different colours draw near-identically (${out.eliteTintPixels} px) — runtime recolouring was lost`);
if(!out.tintFunctionDiffers)fail.push('the tint function returns the same pixels for different colours');
if(!(out.eliteTintAsked>0))fail.push(`the draw path asks for no tint on an elite (${out.eliteTintAsked}) — runtime recolouring is not requested at all`);
if(out.eliteTintColor!=='#ff6d65')fail.push(`an elite's own colour is not passed to the tint (${out.eliteTintColor})`);
if(out.plainTintAsked!==0)fail.push('a regular hostile is being tinted, which flattens the authored art for no reason');
// Measured with the aircraft grounded, so its deliberately offset airborne
// shadow does not bias the result. What is left is the sprite, and it must sit
// on the origin the game rotates it about.
if(!out.centroid)fail.push('nothing was drawn when checking centring');
if(out.centroidDrift===null)fail.push('could not compare the art and procedural centroids');
else if(out.centroidDrift>10)fail.push(`the baked sprite sits ${out.centroidDrift}px away from where the procedural one draws — it will orbit its own position instead of turning in place`);
if(fail.length){console.log('\nFAILURES');for(const f of fail)console.log('  '+f);process.exitCode=1;}
else console.log('\nthe authored art is on screen, and the moving parts still move');
await b.close();
