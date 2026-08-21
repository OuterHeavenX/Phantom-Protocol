import {clamp,TAU,dist,formatTime} from '../core/math.js';
import {Weather} from './weather.js';
import {profiler} from '../core/profiler.js';
import {drawLandmark} from './landmarks.js';
import {EnvironmentArt,drawSprite,drawSlicedWall} from './environment.js';
import {EXTRACTION_RADIUS,EXTRACTION_HOLD} from '../game/engine.js';
import {vaultKind} from '../../data/vaults.js';
import {REVIVE_RADIUS} from '../game/squadmate.js';
import {
  drawPlayer,drawSquadmate,drawEnemy,drawBoss,drawPhantom,drawTurret,drawMine,drawPickup,
  drawShadow,withAlpha,shade,roundedRect
} from './sprites.js';

// Layered renderer.
//
// Draw order (back to front):
//   1. Floor        — tiled ground with per-theatre palette
//   2. Decals       — persistent blood, scorch marks
//   3. Hazards      — ground effects and their warning telegraphs
//   4. Geometry     — walls and cover, with height offsets
//   5. Ground FX    — strike markers, fields, mines
//   6. Entities     — y-sorted so things overlap correctly
//   7. Projectiles  — trails and heads
//   8. Particles    — pooled effects
//   9. Lighting     — additive glow pass
//  10. Post         — vignette, flash, scanlines, minimap, off-screen markers
//
// The previous build drew everything in a fixed order with no sorting, no
// lighting pass and no culling.

// Cover whose visible form is an authored landmark rather than a generic box.
const LANDMARK_COLLIDERS=new Set(['fuselage','trunk','boulder','wreck']);

export class Renderer{
  constructor(canvas,ctx,engine){
    this.canvas=canvas;
    this.ctx=ctx;
    this.engine=engine;
    this.settings=engine.settings;
    this.quality=this.settings.particles||'high';

    // Offscreen buffer for the additive lighting pass.
    this.lightCanvas=document.createElement('canvas');
    this.lightCtx=this.lightCanvas.getContext('2d');

    this.sortBuffer=[];
    this.frameTimes=[];
    this.lastFrame=performance.now();
    this.fps=60;
    this.floorPattern=null;
    this.buildFloorPattern();
    // Per-theatre ambient weather; theatres without a profile cost nothing.
    this.weather=new Weather(engine.map?.weather,this.settings);

    // Authored environment art for this theatre, when a pack has been shipped
    // for it. A theatre opts in with `art` in its map definition — `true` to
    // name the pack directory after the theatre id, or a string to name it
    // explicitly. Without the flag nothing is fetched at all, which is the
    // state every unpainted theatre is in.
    //
    // The load is asynchronous and deliberately unawaited: the first frame runs
    // long before any image decodes, and until the whole pack has resolved
    // `art.active` stays false and every draw path below takes its procedural
    // branch. A frame is therefore either fully procedural or fully authored,
    // never half-dressed.
    this.artFloorPattern=null;
    const pack=engine.map?.art===true?engine.map.id:(engine.map?.art||null);
    this.art=new EnvironmentArt(pack);
    this.art.load().then(()=>{
      if(this.art.active)this.artFloorPattern=this.art.buildFloorPattern(this.ctx);
    });
  }

  get lightingEnabled(){
    return this.quality!=='low'&&!this.settings.performanceMode;
  }

  resize(width,height){
    this.lightCanvas.width=Math.ceil(width/2);
    this.lightCanvas.height=Math.ceil(height/2);
  }

  // Called when a session tears down, so an art pack still in flight cannot
  // build a pattern on a context that has already been released.
  destroy(){
    this.art?.dispose();
    this.artFloorPattern=null;
  }

  // A small tiling texture beats drawing thousands of grid lines each frame.
  buildFloorPattern(){
    const palette=this.engine.world.palette;
    const size=128;
    const tile=document.createElement('canvas');
    tile.width=tile.height=size;
    const c=tile.getContext('2d');

    c.fillStyle=palette.floor;
    c.fillRect(0,0,size,size);

    // Panel seams.
    c.fillStyle=palette.floorAlt;
    c.fillRect(0,0,size/2,size/2);
    c.fillRect(size/2,size/2,size/2,size/2);

    c.strokeStyle=palette.grid;
    c.lineWidth=1;
    c.strokeRect(.5,.5,size-1,size-1);
    c.beginPath();
    c.moveTo(size/2,0);c.lineTo(size/2,size);
    c.moveTo(0,size/2);c.lineTo(size,size/2);
    c.stroke();

    // Surface noise so large floors do not read as flat colour.
    c.fillStyle='rgba(255,255,255,.014)';
    for(let i=0;i<70;i++){
      c.fillRect(Math.random()*size,Math.random()*size,2,2);
    }
    this.floorPattern=this.ctx.createPattern(tile,'repeat');
  }

  render(interpolation=0){
    const engine=this.engine;
    const ctx=this.ctx;
    const width=this.canvas.width;
    const height=this.canvas.height;

    const now=performance.now();
    this.trackFps(now);

    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle='#03080d';
    ctx.fillRect(0,0,width,height);

    engine.camera.apply(ctx);

    this.drawFloor(ctx);
    this.drawDecals(ctx);
    this.drawLandmarks(ctx);
    this.drawHazards(ctx);
    this.drawGroundEffects(ctx);
    this.drawGeometry(ctx);
    this.drawEntities(ctx);
    this.drawProjectiles(ctx);
    this.drawBeams(ctx);
    this.drawParticles(ctx);
    this.drawExtractionBeacon(ctx);
    this.drawVaultMarkers(ctx);
    this.drawMissionMarkers(ctx);
    this.drawSquadMarkers(ctx);
    this.drawOptic(ctx);

    ctx.restore();

    if(this.lightingEnabled)this.drawLighting();

    // Weather sits above the lit world but below the HUD, so the sector is
    // seen through it rather than behind it.
    if(this.weather.active){
      ctx.setTransform(1,0,0,1,0,0);
      this.weather.update(this.lastDelta??1/60);
      this.weather.draw(ctx,width,height,engine.camera,engine.elapsed);
    }

    this.drawPost(ctx,width,height);
    // Closes the render section and the frame. The simulation half was marked
    // in Engine.update, so the two together account for the whole frame.
    profiler.mark('render');
    profiler.end();
  }

  trackFps(now){
    const delta=now-this.lastFrame;
    this.lastFrame=now;
    this.frameTimes.push(delta);
    if(this.frameTimes.length>40)this.frameTimes.shift();
    const average=this.frameTimes.reduce((a,b)=>a+b,0)/this.frameTimes.length;
    this.fps=Math.round(1000/Math.max(1,average));
    // Weather advances on real frame time, not the fixed simulation step, so
    // it keeps drifting while the run is paused behind an overlay.
    this.lastDelta=clamp(delta/1000,0,.05);
  }

  // ---- 1. Floor -----------------------------------------------------------
  drawFloor(ctx){
    const camera=this.engine.camera;
    const world=this.engine.world;
    const halfW=camera.viewHalfWidth(120);
    const halfH=camera.viewHalfHeight(120);
    const x=clamp(camera.x-halfW,-200,world.width+200);
    const y=clamp(camera.y-halfH,-200,world.height+200);

    ctx.save();
    if(this.artFloorPattern){
      // An authored tile is authored above world scale and resampled down, so
      // smoothing is set here rather than inherited from whichever block last
      // happened to touch it. The pattern is filled under the camera transform,
      // which puts its origin on world (0,0): the plates stay bolted to the
      // floor instead of swimming with the camera.
      ctx.imageSmoothingEnabled=true;
      ctx.imageSmoothingQuality='high';
      ctx.fillStyle=this.artFloorPattern;
    }else{
      ctx.fillStyle=this.floorPattern||world.palette.floor;
    }
    ctx.fillRect(x,y,halfW*2,halfH*2);

    // Out-of-bounds shading beyond the arena edge.
    ctx.fillStyle='rgba(0,0,0,.55)';
    if(x<0)ctx.fillRect(x,y,-x,halfH*2);
    if(y<0)ctx.fillRect(x,y,halfW*2,-y);
    if(x+halfW*2>world.width)ctx.fillRect(world.width,y,x+halfW*2-world.width,halfH*2);
    if(y+halfH*2>world.height)ctx.fillRect(x,world.height,halfW*2,y+halfH*2-world.height);
    this.drawWater(ctx,x,y,halfW,halfH);
    ctx.restore();

    // Perimeter boundary line.
    ctx.save();
    ctx.strokeStyle=withAlpha(world.palette.accent,.35);
    ctx.lineWidth=3;
    ctx.setLineDash([18,12]);
    ctx.strokeRect(0,0,world.width,world.height);
    ctx.restore();

    this.drawDecor(ctx);
  }

  // Open water beyond a theatre's playable bands — drawn as part of the floor
  // so the deck reads as a structure over something, not a hole in the grid.
  drawWater(ctx,x,y,halfW,halfH){
    const world=this.engine.world;
    if(!world.water)return;
    const time=this.engine.elapsed;
    const bands=[[world.water.y0-400,world.water.y1],[world.water.y2,world.water.y3+400]];
    ctx.save();
    for(const [top,bottom] of bands){
      if(bottom<y||top>y+halfH*2)continue;
      ctx.fillStyle='#0a141d';
      ctx.fillRect(x,top,halfW*2,bottom-top);
      // Slow swell lines give the surface motion without a shader.
      ctx.strokeStyle='rgba(120,168,200,.10)';
      ctx.lineWidth=2;
      ctx.beginPath();
      for(let wy=Math.floor(top/46)*46;wy<bottom;wy+=46){
        const phase=Math.sin(time*.5+wy*.03)*22;
        ctx.moveTo(x+phase,wy);
        ctx.lineTo(x+halfW*2+phase,wy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Authored theatre furniture: towers, wrecks, trees, airframes.
  drawLandmarks(ctx){
    const world=this.engine.world;
    if(!world.landmarks?.length)return;
    const camera=this.engine.camera;
    const time=this.engine.elapsed;
    for(const item of world.landmarks){
      if(!camera.isVisible(item.x,item.y,item.span||item.r||item.size||260))continue;
      drawLandmark(ctx,item,world.palette,time);
    }
  }

  drawDecor(ctx){
    const camera=this.engine.camera;
    const world=this.engine.world;
    ctx.save();
    for(const item of world.decor){
      if(!camera.isVisible(item.x,item.y,item.size))continue;
      ctx.globalAlpha=item.alpha;
      ctx.strokeStyle=world.palette.wallEdge;
      ctx.fillStyle=world.palette.wall;
      ctx.save();
      ctx.translate(item.x,item.y);
      ctx.rotate(item.rotation);
      // Decor is scattered at arbitrary rotation, so its art has to be
      // light-neutral: the sprite is blitted under the same transform the
      // vector form uses rather than being given an upright pass of its own.
      const sprite=this.art.active?this.art.image(`decor.${item.kind}`):null;
      if(sprite){
        drawSprite(ctx,sprite,-item.size/2,-item.size/2,item.size,item.size);
      }else switch(item.kind){
        case 0:ctx.fillRect(-item.size/2,-item.size/6,item.size,item.size/3);break;
        case 1:ctx.beginPath();ctx.arc(0,0,item.size/3,0,TAU);ctx.stroke();break;
        case 2:
          ctx.beginPath();
          ctx.moveTo(-item.size/2,0);ctx.lineTo(item.size/2,0);
          ctx.stroke();
          break;
        case 3:ctx.strokeRect(-item.size/2,-item.size/2,item.size,item.size);break;
        default:
          ctx.beginPath();
          for(let i=0;i<3;i++){
            const a=i/3*TAU;
            const px=Math.cos(a)*item.size/2,py=Math.sin(a)*item.size/2;
            i?ctx.lineTo(px,py):ctx.moveTo(px,py);
          }
          ctx.closePath();ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // ---- 2. Decals ----------------------------------------------------------
  //
  // Floor staining lasts the whole contract, so the count only ever grows. The
  // recent ones are drawn as crisp shapes; once there are enough of them the
  // oldest are baked into a single half-resolution layer and dropped from the
  // list. Blood is permanent and unbounded, and costs one drawImage per frame
  // plus a few dozen fresh shapes.
  ensureStainLayer(){
    if(this.stainCanvas)return;
    const world=this.engine.world;
    this.stainScale=world.width*world.height>7e6?.3:.42;
    this.stainCanvas=document.createElement('canvas');
    this.stainCanvas.width=Math.max(1,Math.ceil(world.width*this.stainScale));
    this.stainCanvas.height=Math.max(1,Math.ceil(world.height*this.stainScale));
    this.stainCtx=this.stainCanvas.getContext('2d');
  }

  paintStain(ctx,decal,scale=1){
    ctx.save();
    ctx.globalAlpha=decal.alpha;
    ctx.fillStyle=decal.color;
    ctx.translate(decal.x*scale,decal.y*scale);
    ctx.rotate(decal.rotation);
    ctx.beginPath();
    // Irregular splat rather than a plain circle; the seed keeps a given
    // stain the same shape whether it is drawn fresh or baked.
    const points=7;
    for(let i=0;i<points;i++){
      const a=i/points*TAU;
      const r=decal.radius*scale*(.6+((i*37+decal.seed)%10)/22);
      const x=Math.cos(a)*r,y=Math.sin(a)*r*(decal.squash??.7);
      i?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawDecals(ctx){
    const camera=this.engine.camera;
    const world=this.engine.world;
    this.ensureStainLayer();

    // Bake everything past the fresh window into the layer, then forget it.
    const FRESH=90;
    if(world.decals.length>FRESH){
      const bake=world.decals.splice(0,world.decals.length-FRESH);
      for(const decal of bake)this.paintStain(this.stainCtx,decal,this.stainScale);
    }

    ctx.save();
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(this.stainCanvas,0,0,world.width,world.height);
    for(const decal of world.decals){
      if(!camera.isVisible(decal.x,decal.y,decal.radius))continue;
      this.paintStain(ctx,decal,1);
    }
    ctx.restore();
  }

  // ---- 3. Hazards ---------------------------------------------------------
  drawHazards(ctx){
    const camera=this.engine.camera;
    const time=this.engine.elapsed;
    ctx.save();
    for(const hazard of this.engine.world.hazards){
      if(!camera.isVisible(hazard.x,hazard.y,hazard.radius))continue;

      if(hazard.passive){
        ctx.globalAlpha=.16+Math.sin(time*1.6+hazard.phase)*.04;
        ctx.fillStyle=hazard.color;
        ctx.beginPath();ctx.arc(hazard.x,hazard.y,hazard.radius,0,TAU);ctx.fill();
        ctx.globalAlpha=.3;
        ctx.strokeStyle=hazard.color;
        ctx.lineWidth=1.5;
        ctx.stroke();
        continue;
      }

      if(hazard.warning>0){
        // Countdown telegraph: ring closes in as detonation approaches.
        const progress=1-hazard.warning/(hazard.warn||1);
        ctx.globalAlpha=.2+progress*.4;
        ctx.strokeStyle=hazard.color;
        ctx.lineWidth=3;
        ctx.setLineDash([10,8]);
        ctx.beginPath();ctx.arc(hazard.x,hazard.y,hazard.radius,0,TAU);ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha=.12+progress*.28;
        ctx.fillStyle=hazard.color;
        ctx.beginPath();ctx.arc(hazard.x,hazard.y,hazard.radius*progress,0,TAU);ctx.fill();
      }else if(hazard.active){
        ctx.globalAlpha=.6;
        if(!this.drawAuthoredHazard(ctx,hazard,'active',hazard.radius)){
          ctx.fillStyle=hazard.color;
          ctx.beginPath();ctx.arc(hazard.x,hazard.y,hazard.radius,0,TAU);ctx.fill();
        }
      }else{
        // Dormant marker so the player learns where hazards live.
        ctx.globalAlpha=.1;
        if(!this.drawAuthoredHazard(ctx,hazard,'dormant',hazard.radius*.8)){
          ctx.strokeStyle=hazard.color;
          ctx.lineWidth=1;
          ctx.beginPath();ctx.arc(hazard.x,hazard.y,hazard.radius*.8,0,TAU);ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // ---- 4. Geometry --------------------------------------------------------
  drawGeometry(ctx){
    const camera=this.engine.camera;
    const palette=this.engine.world.palette;
    ctx.save();

    for(const wall of this.engine.world.walls){
      if(wall.type==='perimeter')continue;
      if(!camera.isVisible(wall.x,wall.y,Math.max(wall.hw,wall.hh)))continue;
      // Faux height: a dark base offset down, then the lit top face. A pack
      // that bakes its own shadows switches this off in its manifest so the
      // two do not stack.
      if(this.art.shadows){
        ctx.fillStyle='rgba(0,0,0,.45)';
        ctx.fillRect(wall.x-wall.hw+4,wall.y-wall.hh+7,wall.w,wall.h);
      }
      if(this.drawAuthoredWall(ctx,wall))continue;
      ctx.fillStyle=palette.wall;
      ctx.fillRect(wall.x-wall.hw,wall.y-wall.hh,wall.w,wall.h);
      ctx.strokeStyle=palette.wallEdge;
      ctx.lineWidth=1.4;
      ctx.strokeRect(wall.x-wall.hw,wall.y-wall.hh,wall.w,wall.h);
      // Panel detail on long spans.
      if(wall.w>60||wall.h>60){
        ctx.strokeStyle=withAlpha(palette.wallEdge,.25);
        ctx.lineWidth=1;
        ctx.beginPath();
        if(wall.w>wall.h){
          for(let x=wall.x-wall.hw+18;x<wall.x+wall.hw;x+=26){
            ctx.moveTo(x,wall.y-wall.hh+3);ctx.lineTo(x,wall.y+wall.hh-3);
          }
        }else{
          for(let y=wall.y-wall.hh+18;y<wall.y+wall.hh;y+=26){
            ctx.moveTo(wall.x-wall.hw+3,y);ctx.lineTo(wall.x+wall.hw-3,y);
          }
        }
        ctx.stroke();
      }
    }

    for(const cover of this.engine.world.cover){
      if(cover.broken)continue;
      if(!camera.isVisible(cover.x,cover.y,Math.max(cover.hw,cover.hh)))continue;
      ctx.save();
      // Damage shake.
      if(cover.shake>0){
        ctx.translate((Math.random()-.5)*cover.shake*14,(Math.random()-.5)*cover.shake*14);
      }
      this.drawCoverPiece(ctx,cover,palette);
      ctx.restore();
    }
    ctx.restore();
  }

  // Authored art for one wall, or false when this theatre has no pack — or
  // none for this kind of wall — and the caller should draw its rectangle.
  //
  // A chamber wall is one of exactly two sizes, 148x16 or 16x148, so it is a
  // plain blit. A partition segment is an arbitrary length at a fixed 26-unit
  // thickness, so it is three-sliced along its long axis instead: stretching
  // one sprite across the generated range would smear it at up to 27:1.
  drawAuthoredWall(ctx,wall){
    if(!this.art.active)return false;
    const x=wall.x-wall.hw,y=wall.y-wall.hh;
    const horizontal=wall.w>=wall.h;
    if(wall.type==='vault'){
      return drawSprite(ctx,this.art.image(horizontal?'vault.wall.h':'vault.wall.v',wall.variant),
        x,y,wall.w,wall.h);
    }
    return drawSlicedWall(ctx,this.art.slice(horizontal?'wall.h':'wall.v',wall.variant),
      x,y,wall.w,wall.h,horizontal);
  }

  // Authored art for one cover piece, or false to fall through to the vector
  // form. Cover is the easy half of the theatre: six fixed footprints, never
  // scaled and never rotated, so each is a single stretch-to-collider blit and
  // `variant` picks the face the generator already chose for this piece.
  //
  // The vault seal is the exception. It has two orientations and swaps art once
  // the scanner has resolved what is behind it, and if a pack ships the sealed
  // state but not the found one the whole seal falls back rather than losing
  // the indicator that tells the operative it is worth breaching.
  drawAuthoredCover(ctx,cover,x,y){
    if(!this.art.active)return false;
    let key=`cover.${cover.type}`;
    if(cover.type==='vaultSeal'){
      key=`vault.seal.${cover.w>cover.h?'h':'v'}`;
      if(cover.vault?.discovered)key+='.found';
    }
    return drawSprite(ctx,this.art.image(key,cover.variant),x,y,cover.w,cover.h);
  }

  // Authored hazard art, or false for the vector ring. The engine's alpha is
  // left in place over the blit so an authored vent sits in the same visual
  // register as the ring it replaces — a pack compensates in the art rather
  // than by quietly changing how loudly hazards read.
  drawAuthoredHazard(ctx,hazard,state,radius){
    if(!this.art.active)return false;
    return drawSprite(ctx,this.art.image(`hazard.${hazard.id}.${state}`),
      hazard.x-radius,hazard.y-radius,radius*2,radius*2);
  }

  drawCoverPiece(ctx,cover,palette){
    // Some cover exists only to give a landmark its collision footprint; the
    // prop itself is drawn from world.landmarks, so drawing a generic box here
    // would sit a grey rectangle on top of the aircraft or the tree.
    if(LANDMARK_COLLIDERS.has(cover.type))return;
    const x=cover.x-cover.hw,y=cover.y-cover.hh;
    // Shadow. As with walls, a pack that bakes its own switches this off.
    if(this.art.shadows){
      ctx.fillStyle='rgba(0,0,0,.4)';
      ctx.fillRect(x+3,y+5,cover.w,cover.h);
    }

    if(!this.drawAuthoredCover(ctx,cover,x,y))switch(cover.type){
      case 'vaultSeal':{
        // Reads as heavy blast door either way; only the live indicator strip
        // tells the operative the scanner has resolved what is behind it.
        const found=cover.vault?.discovered;
        ctx.fillStyle='#1a2228';
        ctx.strokeStyle=found?'#f5d27a':palette.wallEdge;
        ctx.lineWidth=found?2:1.4;
        ctx.fillRect(x,y,cover.w,cover.h);
        ctx.strokeRect(x,y,cover.w,cover.h);
        // Interlock plates.
        ctx.strokeStyle=withAlpha(found?'#f5d27a':palette.wallEdge,.45);
        ctx.lineWidth=1;
        ctx.beginPath();
        if(cover.w>cover.h){
          for(let px=x+14;px<x+cover.w-6;px+=18){ctx.moveTo(px,y+3);ctx.lineTo(px,y+cover.h-3)}
        }else{
          for(let py=y+14;py<y+cover.h-6;py+=18){ctx.moveTo(x+3,py);ctx.lineTo(x+cover.w-3,py)}
        }
        ctx.stroke();
        if(found){
          const glow=.4+Math.abs(Math.sin(this.engine.elapsed*3))*.45;
          ctx.fillStyle=withAlpha('#f5d27a',glow);
          if(cover.w>cover.h)ctx.fillRect(x+4,cover.y-1.5,cover.w-8,3);
          else ctx.fillRect(cover.x-1.5,y+4,3,cover.h-8);
        }
        break;
      }
      case 'vaultTerminal':{
        // A lock console: waist-high, lit, and unmistakably not a crate. The
        // screen keeps working right up until the housing stops existing.
        const live=cover.vault&&!cover.vault.breached;
        const accent=live?'#c895ff':palette.wallEdge;
        ctx.fillStyle='#171d26';
        ctx.fillRect(x,y,cover.w,cover.h);
        ctx.strokeStyle=accent;
        ctx.lineWidth=1.4;
        ctx.strokeRect(x,y,cover.w,cover.h);
        // Canted screen.
        ctx.fillStyle=withAlpha(accent,live?.34+Math.abs(Math.sin(this.engine.elapsed*4))*.3:.16);
        ctx.fillRect(x+5,y+5,cover.w-10,cover.h*.42);
        // Key rows underneath.
        ctx.strokeStyle=withAlpha(accent,.4);
        ctx.lineWidth=1;
        ctx.beginPath();
        for(let py=y+cover.h*.6;py<y+cover.h-4;py+=5){
          ctx.moveTo(x+5,py);ctx.lineTo(x+cover.w-5,py);
        }
        ctx.stroke();
        break;
      }
      case 'log':{
        // Half-sunk trunk: rounded, with a waterline stain.
        const horizontal=cover.w>cover.h;
        ctx.fillStyle='#2b2419';
        ctx.strokeStyle='#5c6a48';
        ctx.lineWidth=1.4;
        ctx.beginPath();roundedRect(ctx,x,y,cover.w,cover.h,Math.min(cover.w,cover.h)/2);
        ctx.fill();ctx.stroke();
        ctx.strokeStyle='rgba(140,170,120,.25)';
        ctx.beginPath();
        if(horizontal){ctx.moveTo(x+6,cover.y);ctx.lineTo(x+cover.w-6,cover.y)}
        else{ctx.moveTo(cover.x,y+6);ctx.lineTo(cover.x,y+cover.h-6)}
        ctx.stroke();
        break;
      }
      case 'crate':
        ctx.fillStyle='#3d3324';
        ctx.strokeStyle='#c6a45e';
        ctx.lineWidth=1.4;
        ctx.fillRect(x,y,cover.w,cover.h);
        ctx.strokeRect(x,y,cover.w,cover.h);
        ctx.strokeStyle='rgba(198,164,94,.4)';
        ctx.beginPath();
        ctx.moveTo(x,y);ctx.lineTo(x+cover.w,y+cover.h);
        ctx.moveTo(x+cover.w,y);ctx.lineTo(x,y+cover.h);
        ctx.stroke();
        break;
      case 'barrier':
      case 'lowcover':
        ctx.fillStyle=cover.type==='lowcover'?'#2a3a3e':'#33413f';
        ctx.strokeStyle=palette.wallEdge;
        ctx.lineWidth=1.2;
        ctx.fillRect(x,y,cover.w,cover.h);
        ctx.strokeRect(x,y,cover.w,cover.h);
        // Hazard striping.
        ctx.save();
        ctx.beginPath();ctx.rect(x,y,cover.w,cover.h);ctx.clip();
        ctx.strokeStyle=withAlpha(palette.hazard,.3);
        ctx.lineWidth=5;
        ctx.beginPath();
        for(let i=-cover.h;i<cover.w;i+=16){
          ctx.moveTo(x+i,y+cover.h);ctx.lineTo(x+i+cover.h,y);
        }
        ctx.stroke();
        ctx.restore();
        break;
      case 'pillar':
        ctx.fillStyle=palette.wall;
        ctx.strokeStyle=palette.wallEdge;
        ctx.lineWidth=1.6;
        ctx.beginPath();
        ctx.arc(cover.x,cover.y,cover.hw,0,TAU);
        ctx.fill();ctx.stroke();
        break;
      case 'machinery':
        ctx.fillStyle='#122a30';
        ctx.strokeStyle=palette.wallEdge;
        ctx.lineWidth=1.4;
        ctx.fillRect(x,y,cover.w,cover.h);
        ctx.strokeRect(x,y,cover.w,cover.h);
        ctx.fillStyle=withAlpha(palette.accent,.5);
        ctx.fillRect(x+7,y+7,7,3);
        ctx.fillStyle='#22383d';
        for(let py=y+16;py<y+cover.h-6;py+=11)ctx.fillRect(x+7,py,cover.w-14,4);
        break;
      case 'container':
      default:
        ctx.fillStyle='#243036';
        ctx.strokeStyle=palette.wallEdge;
        ctx.lineWidth=1.4;
        ctx.fillRect(x,y,cover.w,cover.h);
        ctx.strokeRect(x,y,cover.w,cover.h);
        ctx.strokeStyle=withAlpha(palette.wallEdge,.3);
        ctx.beginPath();
        for(let px=x+10;px<x+cover.w;px+=14){ctx.moveTo(px,y+3);ctx.lineTo(px,y+cover.h-3)}
        ctx.stroke();
    }

    // Integrity bar on damaged destructibles.
    if(cover.destructible&&cover.hp<cover.maxHp){
      const ratio=Math.max(0,cover.hp/cover.maxHp);
      ctx.fillStyle='rgba(0,0,0,.6)';
      ctx.fillRect(cover.x-14,cover.y-cover.hh-7,28,3);
      ctx.fillStyle='#ffb35c';
      ctx.fillRect(cover.x-14,cover.y-cover.hh-7,28*ratio,3);
    }
  }

  // ---- 5. Ground effects --------------------------------------------------
  drawGroundEffects(ctx){
    const engine=this.engine;
    const time=engine.elapsed;
    ctx.save();

    // Incoming strike markers — the single most important readability cue.
    for(const strike of engine.strikes){
      const progress=clamp(strike.age/strike.delay,0,1);
      const color=strike.color||'#ffb35c';
      ctx.globalAlpha=.25+progress*.45;
      ctx.strokeStyle=color;
      ctx.lineWidth=2.5;
      ctx.beginPath();ctx.arc(strike.x,strike.y,strike.blastRadius,0,TAU);ctx.stroke();
      // Filling interior shows time to impact.
      ctx.globalAlpha=.14+progress*.2;
      ctx.fillStyle=color;
      ctx.beginPath();ctx.arc(strike.x,strike.y,strike.blastRadius*progress,0,TAU);ctx.fill();
      // Crosshair.
      ctx.globalAlpha=.5;
      ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.moveTo(strike.x-strike.blastRadius,strike.y);
      ctx.lineTo(strike.x+strike.blastRadius,strike.y);
      ctx.moveTo(strike.x,strike.y-strike.blastRadius);
      ctx.lineTo(strike.x,strike.y+strike.blastRadius);
      ctx.stroke();
    }

    // Persistent fields.
    for(const field of engine.fields){
      const fade=1-field.age/field.duration;
      ctx.globalAlpha=.16*fade;
      ctx.fillStyle=field.color;
      ctx.beginPath();ctx.arc(field.x,field.y,field.radius,0,TAU);ctx.fill();
      ctx.globalAlpha=.4*fade;
      ctx.strokeStyle=field.color;
      ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(field.x,field.y,field.radius,0,TAU);ctx.stroke();
    }

    // Shockwave rings.
    for(const wave of engine.shockwaves){
      const fade=1-wave.age/wave.duration;
      ctx.globalAlpha=fade*.7;
      ctx.strokeStyle=wave.color||'#8fd8ff';
      ctx.lineWidth=4*fade+1;
      ctx.beginPath();ctx.arc(wave.x,wave.y,wave.current,0,TAU);ctx.stroke();
    }

    // Aura weapons.
    for(const weapon of engine.loadout.weapons){
      if(weapon.def.behavior!=='aura'||!weapon.auraRadius)continue;
      ctx.globalAlpha=.1+Math.sin(time*5)*.03;
      ctx.fillStyle=weapon.evolved?'#c79bff':'#ff8a4c';
      ctx.beginPath();ctx.arc(engine.player.x,engine.player.y,weapon.auraRadius,0,TAU);ctx.fill();
      ctx.globalAlpha=.35;
      ctx.strokeStyle=weapon.evolved?'#c79bff':'#ff8a4c';
      ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(engine.player.x,engine.player.y,weapon.auraRadius,0,TAU);ctx.stroke();
    }

    // Melee arc sweeps.
    for(const arc of engine.meleeArcs){
      const fade=1-arc.age/arc.duration;
      ctx.globalAlpha=fade*.55;
      ctx.fillStyle='#9be8ff';
      ctx.beginPath();
      ctx.moveTo(arc.x,arc.y);
      ctx.arc(arc.x,arc.y,arc.reach,arc.angle-arc.arc/2,arc.angle+arc.arc/2);
      ctx.closePath();
      ctx.fill();
    }

    // Decoys.
    for(const decoy of engine.decoys){
      ctx.globalAlpha=.3*(decoy.life/3);
      ctx.strokeStyle='#c79bff';
      ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(decoy.x,decoy.y,14,0,TAU);ctx.stroke();
    }

    ctx.globalAlpha=1;
    for(const mine of engine.mines)if(this.engine.camera.isVisible(mine.x,mine.y,30))drawMine(ctx,mine,time);
    ctx.restore();
  }

  // ---- 6. Entities (y-sorted) ---------------------------------------------
  drawEntities(ctx){
    const engine=this.engine;
    const camera=engine.camera;
    const time=engine.elapsed;
    const sortable=this.sortBuffer;
    sortable.length=0;

    for(const enemy of engine.enemies){
      if(enemy.dead)continue;
      if(!camera.isVisible(enemy.x,enemy.y,enemy.radius+30))continue;
      sortable.push(enemy);
    }
    for(const pickup of engine.pickups){
      if(camera.isVisible(pickup.x,pickup.y,24))sortable.push(pickup);
    }
    for(const turret of engine.turrets)sortable.push(turret);
    for(const phantom of engine.phantoms)sortable.push(phantom);
    if(engine.boss)sortable.push(engine.boss);
    for(const mate of engine.squad)sortable.push(mate);
    sortable.push(engine.player);

    // Painter's algorithm on Y so nearer things overlap further ones.
    sortable.sort((a,b)=>a.y-b.y);

    for(const entity of sortable){
      if(entity===engine.player){
        drawPlayer(ctx,engine.player,engine.operative,time,engine.liveryBody?.(engine.primaryId));
      }else if(entity.codename!==undefined&&entity.operative!==undefined){
        drawSquadmate(ctx,entity,time);
      }else if(entity.boss){
        drawBoss(ctx,entity,time);
      }else if(entity.kind){
        drawPickup(ctx,entity,time);
      }else if(entity.fireRate!==undefined&&entity.range!==undefined&&!entity.archetype){
        drawTurret(ctx,entity,time);
      }else if(entity.render!==undefined&&entity.life!==undefined&&!entity.archetype){
        drawPhantom(ctx,entity,time);
      }else{
        drawEnemy(ctx,entity,time,this.settings);
      }
    }

    // Orbiting drones sit above everything they circle.
    for(const weapon of engine.loadout.weapons){
      if(!weapon.orbiters?.length)continue;
      for(const orbiter of weapon.orbiters){
        if(orbiter.x===undefined)continue;
        ctx.save();
        ctx.translate(orbiter.x,orbiter.y);
        ctx.rotate(orbiter.angle||0);
        const color=weapon.evolved?'#ffb35c':'#76e7d4';
        ctx.fillStyle='#123036';
        ctx.strokeStyle=color;
        ctx.lineWidth=1.4;
        ctx.beginPath();
        ctx.moveTo(9,0);ctx.lineTo(-4,-6);ctx.lineTo(-4,6);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle=color;
        ctx.beginPath();ctx.arc(1,0,2.2,0,TAU);ctx.fill();
        ctx.restore();
      }
    }

    // Grenades.
    for(const grenade of engine.grenades){
      ctx.save();
      ctx.translate(grenade.x,grenade.y);
      ctx.rotate(grenade.age*9);
      ctx.fillStyle='#4a4436';
      ctx.strokeStyle=grenade.fuse<.35?'#ff5b30':'#ffd166';
      ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(0,0,5,0,TAU);ctx.fill();ctx.stroke();
      ctx.restore();
      // Fuse warning ring.
      if(grenade.fuse<.5){
        ctx.save();
        ctx.globalAlpha=Math.abs(Math.sin(time*20))*.5;
        ctx.strokeStyle='#ff5b30';
        ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(grenade.x,grenade.y,grenade.blastRadius*.5,0,TAU);ctx.stroke();
        ctx.restore();
      }
    }

    // Boss telegraphs are drawn over entities so they are never hidden.
    if(engine.boss?.telegraph)this.drawBossTelegraph(ctx,engine.boss);
  }

  drawBossTelegraph(ctx,boss){
    const telegraph=boss.telegraph;
    const progress=boss.windupMax?1-boss.windup/boss.windupMax:0;
    ctx.save();
    ctx.globalAlpha=.3+progress*.4;
    ctx.strokeStyle=boss.def.color;
    ctx.fillStyle=withAlpha(boss.def.color,.12);

    if(telegraph.type==='line'){
      ctx.save();
      ctx.translate(boss.x,boss.y);
      ctx.rotate(telegraph.angle);
      ctx.fillRect(0,-telegraph.width/2,telegraph.length,telegraph.width);
      ctx.lineWidth=2;
      ctx.strokeRect(0,-telegraph.width/2,telegraph.length,telegraph.width);
      ctx.restore();
    }else if(telegraph.type==='sweep'){
      ctx.beginPath();
      ctx.moveTo(boss.x,boss.y);
      ctx.arc(boss.x,boss.y,telegraph.length,
        telegraph.angle-telegraph.arc/2,telegraph.angle+telegraph.arc/2);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth=2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 7. Projectiles -----------------------------------------------------
  drawProjectiles(ctx){
    const engine=this.engine;
    const camera=engine.camera;
    ctx.save();
    ctx.lineCap='round';

    for(const p of engine.projectiles){
      if(!camera.isVisible(p.x,p.y,40))continue;
      // Motion trail.
      if(p.trail!==false){
        ctx.strokeStyle=withAlpha(p.color||'#ffe08a',.4);
        ctx.lineWidth=p.heavy?4:p.beam?5:2;
        ctx.beginPath();ctx.moveTo(p.px,p.py);ctx.lineTo(p.x,p.y);ctx.stroke();
      }
      ctx.fillStyle=p.color||'#fff1b0';
      ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,TAU);ctx.fill();
      if(p.heavy||p.beam){
        ctx.strokeStyle='rgba(255,255,255,.8)';
        ctx.lineWidth=1;
        ctx.beginPath();ctx.arc(p.x,p.y,p.radius+2,0,TAU);ctx.stroke();
      }
    }

    for(const p of engine.enemyProjectiles){
      if(!camera.isVisible(p.x,p.y,40))continue;
      const color=p.reflected?'#76e7d4':(p.color||'#ffcf73');
      ctx.strokeStyle=withAlpha(color,.5);
      ctx.lineWidth=p.fromBoss?3:2;
      ctx.beginPath();ctx.moveTo(p.px,p.py);ctx.lineTo(p.x,p.y);ctx.stroke();
      ctx.fillStyle=color;
      ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,TAU);ctx.fill();
      // Hostile rounds get a white core so they read against the background.
      ctx.fillStyle='rgba(255,255,255,.85)';
      ctx.beginPath();ctx.arc(p.x,p.y,p.radius*.42,0,TAU);ctx.fill();
    }
    ctx.restore();
  }

  // ---- 7b. Beams ----------------------------------------------------------
  drawBeams(ctx){
    const engine=this.engine;
    ctx.save();
    for(const beam of engine.beams){
      const fade=1-beam.age/beam.duration;
      const endX=beam.x+Math.cos(beam.angle)*beam.length;
      const endY=beam.y+Math.sin(beam.angle)*beam.length;
      const color=beam.color||(beam.hostile?'#ff5b5b':'#9be8ff');

      // Outer glow.
      ctx.globalAlpha=fade*.25;
      ctx.strokeStyle=color;
      ctx.lineWidth=beam.width*2.2;
      ctx.beginPath();ctx.moveTo(beam.x,beam.y);ctx.lineTo(endX,endY);ctx.stroke();
      // Core.
      ctx.globalAlpha=fade*.9;
      ctx.lineWidth=beam.width*.5;
      ctx.beginPath();ctx.moveTo(beam.x,beam.y);ctx.lineTo(endX,endY);ctx.stroke();
      ctx.globalAlpha=fade;
      ctx.strokeStyle='#ffffff';
      ctx.lineWidth=Math.max(1.5,beam.width*.18);
      ctx.beginPath();ctx.moveTo(beam.x,beam.y);ctx.lineTo(endX,endY);ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 8. Particles -------------------------------------------------------
  drawParticles(ctx){
    const fx=this.engine.fx;
    const camera=this.engine.camera;
    ctx.save();

    for(const p of fx.particles.active){
      if(!camera.isVisible(p.x,p.y,20))continue;
      const alpha=clamp(p.life/p.maxLife,0,1);
      ctx.globalAlpha=alpha;
      ctx.fillStyle=p.color;
      if(p.kind==='circle'){
        ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,TAU);ctx.fill();
      }else{
        ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);
      }
    }

    // Expanding rings.
    for(const ring of fx.rings.active){
      const alpha=clamp(ring.life/ring.maxLife,0,1);
      ctx.globalAlpha=alpha*.8;
      ctx.strokeStyle=ring.color;
      ctx.lineWidth=ring.width*alpha;
      ctx.beginPath();ctx.arc(ring.x,ring.y,ring.current||ring.radius,0,TAU);ctx.stroke();
    }

    // Streaks.
    for(const streak of fx.streaks.active){
      const alpha=clamp(streak.life/streak.maxLife,0,1);
      ctx.globalAlpha=alpha;
      ctx.strokeStyle=streak.color;
      ctx.lineWidth=streak.width*alpha;
      ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(streak.x1,streak.y1);ctx.lineTo(streak.x2,streak.y2);ctx.stroke();
    }

    // Chain lightning — jittered polyline between hop points.
    for(const chain of fx.chains){
      const alpha=clamp(chain.life/chain.maxLife,0,1);
      ctx.globalAlpha=alpha;
      ctx.strokeStyle=chain.color;
      ctx.lineWidth=2.5*alpha;
      ctx.beginPath();
      for(let i=0;i<chain.points.length-1;i++){
        const a=chain.points[i],b=chain.points[i+1];
        ctx.moveTo(a.x,a.y);
        const segments=4;
        for(let s=1;s<=segments;s++){
          const t=s/segments;
          const jitter=s===segments?0:(Math.random()-.5)*16;
          ctx.lineTo(
            a.x+(b.x-a.x)*t+jitter,
            a.y+(b.y-a.y)*t+jitter
          );
        }
      }
      ctx.stroke();
    }

    // Floating combat text.
    ctx.textAlign='center';
    for(const text of fx.texts.active){
      const alpha=clamp(text.life/text.maxLife,0,1);
      ctx.globalAlpha=alpha;
      ctx.font=`${text.crit?'bold ':''}${text.size}px ui-monospace,SFMono-Regular,monospace`;
      ctx.lineWidth=3;
      ctx.strokeStyle='rgba(0,0,0,.7)';
      ctx.strokeText(text.text,text.x,text.y);
      ctx.fillStyle=text.color;
      ctx.fillText(text.text,text.x,text.y);
    }
    ctx.restore();
  }

  // Scanned vaults get a floor sigil and a label so the player can tell at a
  // glance which chamber the scanner flagged and whether it is still sealed.
  drawVaultMarkers(ctx){
    const engine=this.engine;
    const camera=engine.camera;
    const time=engine.elapsed;

    for(const vault of engine.world.vaults){
      if(!vault.discovered)continue;
      if(!camera.isVisible(vault.x,vault.y,vault.half+140))continue;
      const open=vault.breached;
      const kind=vaultKind(vault.kind);
      const color=open?'#8bff9b':'#f5d27a';

      ctx.save();
      // Floor sigil inside the chamber.
      ctx.globalAlpha=open?.18:.12+Math.abs(Math.sin(time*2+vault.pulse))*.1;
      const sigilRadius=vault.half*.7;
      const sigil=this.art.active?this.art.image(open?'vault.sigil.open':'vault.sigil'):null;
      if(!drawSprite(ctx,sigil,vault.x-sigilRadius,vault.y-sigilRadius,sigilRadius*2,sigilRadius*2)){
        ctx.fillStyle=color;
        ctx.beginPath();ctx.arc(vault.x,vault.y,sigilRadius,0,TAU);ctx.fill();
      }

      ctx.globalAlpha=1;
      ctx.strokeStyle=color;
      ctx.lineWidth=1.5;
      ctx.setLineDash([9,7]);
      ctx.lineDashOffset=open?0:-time*22;
      ctx.strokeRect(vault.x-vault.half,vault.y-vault.half,vault.half*2,vault.half*2);
      ctx.setLineDash([]);

      ctx.fillStyle=color;
      ctx.font='bold 10px ui-monospace,monospace';
      ctx.textAlign='center';
      ctx.fillText(open?'VAULT OPEN':kind.label,vault.x,vault.y-vault.half-22);

      // A manual override needs a stand-here ring and a progress arc, because
      // there is no other way to tell the operative that walking two paces is
      // the difference between finishing and losing it.
      if(!open&&vault.kind==='hold'&&vault.holdRadius>0){
        const running=vault.hold>0;
        ctx.strokeStyle=withAlpha(kind.color,running?.34:.16);
        ctx.lineWidth=1.4;
        ctx.setLineDash([6,10]);
        ctx.lineDashOffset=-time*14;
        ctx.beginPath();ctx.arc(vault.x,vault.y,vault.holdRadius,0,TAU);ctx.stroke();
        ctx.setLineDash([]);
        if(running){
          const ratio=clamp(vault.hold/vault.holdTime,0,1);
          ctx.strokeStyle=kind.color;
          ctx.lineWidth=4;
          ctx.beginPath();
          ctx.arc(vault.x,vault.y,vault.half+18,-Math.PI/2,-Math.PI/2+TAU*ratio);
          ctx.stroke();
          ctx.fillStyle=kind.color;
          ctx.fillText(
            `OVERRIDE ${Math.ceil(vault.holdTime-vault.hold)}s`,
            vault.x,vault.y-vault.half-36
          );
        }
      }
      ctx.restore();

      // The console for a remote lock is elsewhere in the sector, so it gets
      // its own marker wherever it happens to be standing.
      const terminal=vault.terminal;
      if(!open&&terminal&&!terminal.broken&&camera.isVisible(terminal.x,terminal.y,90)){
        ctx.save();
        ctx.strokeStyle=withAlpha(kind.color,.5);
        ctx.lineWidth=1.4;
        ctx.setLineDash([5,6]);
        ctx.lineDashOffset=-time*18;
        ctx.beginPath();ctx.arc(terminal.x,terminal.y,34,0,TAU);ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle=kind.color;
        ctx.font='bold 9px ui-monospace,monospace';
        ctx.textAlign='center';
        ctx.fillText('VAULT LOCK',terminal.x,terminal.y-30);
        ctx.restore();
      }
    }
  }

  // Fitted optic: a reticle on the acquired contact, and a sight line back to
  // the operative for glass that ranges rather than just steadies.
  drawOptic(ctx){
    const engine=this.engine;
    const optic=engine.opticProfile;
    const target=engine.opticTarget;
    if(!optic||!optic.reticle||!target||target.dead)return;
    const camera=engine.camera;
    if(!camera.isVisible(target.x,target.y,80))return;

    const time=engine.elapsed;
    const color=engine.operative.color;
    const r=(target.radius||14)+9;
    ctx.save();
    ctx.strokeStyle=withAlpha(color,.85);
    ctx.lineWidth=1.6;

    switch(optic.reticle){
      case 'dot':
        // Reflex: a single illuminated dot, nothing around it.
        ctx.fillStyle=withAlpha(color,.9);
        ctx.beginPath();ctx.arc(target.x,target.y,2.6,0,TAU);ctx.fill();
        ctx.globalAlpha=.5;
        ctx.beginPath();ctx.arc(target.x,target.y,r*.55,0,TAU);ctx.stroke();
        break;
      case 'holo':{
        // Holographic ring with a broken circle around the contact.
        ctx.globalAlpha=.8;
        for(let i=0;i<4;i++){
          const a=i*(TAU/4)+time*.4;
          ctx.beginPath();ctx.arc(target.x,target.y,r,a,a+.7);ctx.stroke();
        }
        ctx.fillStyle=withAlpha(color,.9);
        ctx.beginPath();ctx.arc(target.x,target.y,2,0,TAU);ctx.fill();
        break;
      }
      case 'thermal':{
        // Thermal box with corner ticks, the way a marked contact reads.
        const s=r*.95;
        ctx.globalAlpha=.85;
        ctx.beginPath();
        for(const [sx,sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
          ctx.moveTo(target.x+sx*s,target.y+sy*s-sy*s*.45);
          ctx.lineTo(target.x+sx*s,target.y+sy*s);
          ctx.lineTo(target.x+sx*s-sx*s*.45,target.y+sy*s);
        }
        ctx.stroke();
        break;
      }
      default:{
        // Ranging crosshair with a gap at the centre so the contact stays read.
        ctx.globalAlpha=.85;
        ctx.beginPath();ctx.arc(target.x,target.y,r,0,TAU);ctx.stroke();
        ctx.beginPath();
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          ctx.moveTo(target.x+dx*r*.45,target.y+dy*r*.45);
          ctx.lineTo(target.x+dx*r*1.35,target.y+dy*r*1.35);
        }
        ctx.stroke();
        break;
      }
    }

    // Ranging glass draws the sight line and the distance to the contact.
    if(optic.marks){
      const player=engine.player;
      ctx.globalAlpha=.22;
      ctx.setLineDash([6,9]);
      ctx.beginPath();
      ctx.moveTo(player.x,player.y);
      ctx.lineTo(target.x,target.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha=.7;
      ctx.fillStyle=withAlpha(color,.9);
      ctx.font='bold 9px ui-monospace,monospace';
      ctx.textAlign='center';
      ctx.fillText(`${Math.round(dist(player.x,player.y,target.x,target.y))}m`,target.x,target.y-r-9);
    }
    ctx.restore();
  }

  // Campaign objective markers: data caches and the escorted asset.
  // A downed squadmate is only worth reaching if you can find them, and they
  // go down wherever the fight took them — often off the edge of the screen.
  // The pull ring marks them on the ground; the arrow finds them when they are
  // outside it.
  drawSquadMarkers(ctx){
    const engine=this.engine;
    const camera=engine.camera;
    const time=engine.elapsed;
    for(const mate of engine.squad){
      if(!mate.downed)continue;
      if(camera.isVisible(mate.x,mate.y,120)){
        ctx.save();
        ctx.globalAlpha=.16+Math.abs(Math.sin(time*2.4))*.1;
        ctx.fillStyle='#ff7068';
        ctx.beginPath();ctx.arc(mate.x,mate.y,REVIVE_RADIUS,0,TAU);ctx.fill();
        ctx.globalAlpha=.85;
        ctx.strokeStyle='#ff7068';
        ctx.lineWidth=2;
        ctx.setLineDash([7,6]);
        ctx.lineDashOffset=-time*22;
        ctx.beginPath();ctx.arc(mate.x,mate.y,REVIVE_RADIUS,0,TAU);ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        continue;
      }
      // Off screen: an arrow pinned inside the frame, pointing at them.
      const player=engine.player;
      const angle=Math.atan2(mate.y-player.y,mate.x-player.x);
      const inset=Math.min(camera.viewHalfWidth(0),camera.viewHalfHeight(0))*.78;
      const x=player.x+Math.cos(angle)*inset;
      const y=player.y+Math.sin(angle)*inset;
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(angle);
      ctx.globalAlpha=.6+Math.abs(Math.sin(time*4))*.35;
      ctx.fillStyle='#ff7068';
      ctx.beginPath();
      ctx.moveTo(16,0);ctx.lineTo(-8,-9);ctx.lineTo(-8,9);
      ctx.closePath();ctx.fill();
      ctx.restore();
    }
  }

  drawMissionMarkers(ctx){
    const engine=this.engine;
    const mission=engine.mission;
    if(!mission)return;
    const camera=engine.camera;
    const time=engine.elapsed;

    for(const cache of mission.caches){
      if(!camera.isVisible(cache.x,cache.y,90))continue;
      const done=cache.recovered;
      const color=done?'#8bff9b':'#8fd8ff';
      ctx.save();
      // Ground ring, filled by the download.
      ctx.globalAlpha=done?.2:.14+Math.abs(Math.sin(time*2+cache.phase))*.1;
      ctx.fillStyle=color;
      ctx.beginPath();ctx.arc(cache.x,cache.y,86,0,TAU);ctx.fill();
      ctx.globalAlpha=1;
      ctx.strokeStyle=color;
      ctx.lineWidth=2;
      ctx.setLineDash([8,7]);
      ctx.lineDashOffset=done?0:-time*20;
      ctx.beginPath();ctx.arc(cache.x,cache.y,86,0,TAU);ctx.stroke();
      ctx.setLineDash([]);
      if(cache.progress>0&&!done){
        ctx.lineWidth=5;
        ctx.beginPath();
        ctx.arc(cache.x,cache.y,86,-Math.PI/2,-Math.PI/2+TAU*cache.progress);
        ctx.stroke();
      }
      // The cache itself: a squat data brick.
      ctx.translate(cache.x,cache.y);
      ctx.fillStyle=done?'#16301c':'#12242e';
      ctx.strokeStyle=color;
      ctx.lineWidth=1.6;
      ctx.beginPath();roundedRect(ctx,-9,-11,18,22,2);ctx.fill();ctx.stroke();
      ctx.fillStyle=color;
      for(let i=0;i<3;i++)ctx.fillRect(-5,-7+i*6,10,1.6);
      ctx.restore();

      ctx.save();
      ctx.fillStyle=color;
      ctx.font='bold 10px ui-monospace,monospace';
      ctx.textAlign='center';
      ctx.fillText(done?'RECOVERED':'DATA CACHE',cache.x,cache.y-100);
      ctx.restore();
    }

    const asset=mission.asset;
    if(asset&&!asset.downed&&camera.isVisible(asset.x,asset.y,80)){
      ctx.save();
      const color=asset.aboard?'#8bff9b':'#ffd166';
      // Locator ring before pickup, follow marker after.
      ctx.globalAlpha=.16+Math.abs(Math.sin(time*2.4))*.12;
      ctx.fillStyle=color;
      ctx.beginPath();ctx.arc(asset.x,asset.y,asset.aboard?36:120,0,TAU);ctx.fill();
      ctx.globalAlpha=1;
      drawShadow(ctx,asset.x,asset.y,11,.3);
      ctx.translate(asset.x,asset.y);
      // A civilian silhouette, not an operative.
      ctx.fillStyle=asset.hitFlash>0?'#ffffff':'#243b46';
      ctx.strokeStyle=color;
      ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(0,-7,5.4,0,TAU);ctx.fill();ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-7,9);ctx.quadraticCurveTo(0,-3,7,9);
      ctx.closePath();ctx.fill();ctx.stroke();
      ctx.restore();

      // Health bar once the asset can be hurt.
      if(asset.aboard&&asset.hp<asset.maxHp){
        const ratio=Math.max(0,asset.hp/asset.maxHp);
        ctx.save();
        ctx.fillStyle='rgba(0,0,0,.6)';
        ctx.fillRect(asset.x-16,asset.y-26,32,3.5);
        ctx.fillStyle=ratio>.5?'#8bff9b':ratio>.25?'#ffd166':'#ff7068';
        ctx.fillRect(asset.x-16,asset.y-26,32*ratio,3.5);
        ctx.restore();
      }
      ctx.save();
      ctx.fillStyle=color;
      ctx.font='bold 10px ui-monospace,monospace';
      ctx.textAlign='center';
      ctx.fillText(asset.aboard?'ASSET':'ASSET // LOCATE',asset.x,asset.y-34);
      ctx.restore();
    }
  }

  drawExtractionBeacon(ctx){
    const engine=this.engine;
    if(!engine.extraction||!engine.extractionPoint)return;
    const point=engine.extractionPoint;
    const time=engine.elapsed;
    const pulse=(time*.7)%1;

    ctx.save();
    // Expanding beacon rings.
    for(let i=0;i<3;i++){
      const t=(pulse+i/3)%1;
      ctx.globalAlpha=(1-t)*.6;
      ctx.strokeStyle='#f5d27a';
      ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(point.x,point.y,20+t*80,0,TAU);ctx.stroke();
    }
    ctx.globalAlpha=.2;
    ctx.fillStyle='#f5d27a';
    ctx.beginPath();ctx.arc(point.x,point.y,EXTRACTION_RADIUS,0,TAU);ctx.fill();
    ctx.globalAlpha=1;
    ctx.strokeStyle='#f5d27a';
    ctx.lineWidth=3;
    ctx.setLineDash([12,10]);
    ctx.beginPath();ctx.arc(point.x,point.y,EXTRACTION_RADIUS,0,TAU);ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='#f5d27a';
    ctx.font='bold 13px ui-monospace,monospace';
    ctx.textAlign='center';
    ctx.fillText('EXTRACTION',point.x,point.y-EXTRACTION_RADIUS-16);
    // Hold progress while standing in the zone.
    if(engine.extractionHold>0){
      const progress=clamp(engine.extractionHold/EXTRACTION_HOLD,0,1);
      ctx.strokeStyle='#8bff9b';
      ctx.lineWidth=6;
      ctx.beginPath();
      ctx.arc(point.x,point.y,EXTRACTION_RADIUS,-Math.PI/2,-Math.PI/2+TAU*progress);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 9. Lighting --------------------------------------------------------
  // Additive pass at half resolution: cheap, and gives muzzle flashes,
  // explosions and projectiles real presence against the dark floor.
  drawLighting(){
    const engine=this.engine;
    const camera=engine.camera;
    const lctx=this.lightCtx;
    const w=this.lightCanvas.width;
    const h=this.lightCanvas.height;
    if(!w||!h)return;

    lctx.setTransform(1,0,0,1,0,0);
    lctx.clearRect(0,0,w,h);
    lctx.globalCompositeOperation='lighter';

    const scale=.5;
    const toScreen=(x,y)=>({
      x:((x-camera.x)*camera.zoom+camera.width/2)*scale,
      y:((y-camera.y)*camera.zoom+camera.height/2)*scale
    });

    const addLight=(x,y,radius,color,intensity=1)=>{
      const p=toScreen(x,y);
      const r=radius*camera.zoom*scale;
      // A caller computing a degenerate radius must not take down the whole
      // frame: createRadialGradient throws outright on a negative r1.
      if(!(r>0))return;
      if(p.x<-r||p.y<-r||p.x>w+r||p.y>h+r)return;
      const gradient=lctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
      gradient.addColorStop(0,withAlpha(color,.55*intensity));
      gradient.addColorStop(.5,withAlpha(color,.16*intensity));
      gradient.addColorStop(1,withAlpha(color,0));
      lctx.fillStyle=gradient;
      lctx.fillRect(p.x-r,p.y-r,r*2,r*2);
    };

    // Operative light.
    addLight(engine.player.x,engine.player.y,190,engine.operative.color,.6);

    // Projectiles glow.
    for(const p of engine.projectiles)addLight(p.x,p.y,p.heavy?70:44,p.color||'#ffe08a',.7);
    for(const p of engine.enemyProjectiles)addLight(p.x,p.y,38,p.color||'#ff8a5c',.55);

    // Beams light along their length.
    for(const beam of engine.beams){
      const steps=6;
      for(let i=0;i<=steps;i++){
        const t=i/steps;
        addLight(
          beam.x+Math.cos(beam.angle)*beam.length*t,
          beam.y+Math.sin(beam.angle)*beam.length*t,
          90,beam.color||'#9be8ff',.5
        );
      }
    }

    // Explosions and rings.
    for(const ring of engine.fx.rings.active){
      const alpha=clamp(ring.life/ring.maxLife,0,1);
      addLight(ring.x,ring.y,(ring.current||ring.radius)*1.4,ring.color,alpha*.9);
    }

    // Hazards and strike markers.
    for(const strike of engine.strikes){
      addLight(strike.x,strike.y,strike.blastRadius*1.1,strike.color||'#ffb35c',
        clamp(strike.age/strike.delay,0,1)*.6);
    }
    for(const hazard of engine.world.hazards){
      if(hazard.active)addLight(hazard.x,hazard.y,hazard.radius*1.6,hazard.color,.8);
      else if(hazard.passive&&hazard.damage)addLight(hazard.x,hazard.y,hazard.radius,hazard.color,.3);
    }

    // Elites and bosses are self-lit so they stand out in a crowd.
    for(const enemy of engine.enemies){
      if(enemy.dead||!enemy.elite)continue;
      addLight(enemy.x,enemy.y,110,enemy.color,.5);
    }
    if(engine.boss)addLight(engine.boss.x,engine.boss.y,engine.boss.radius*4,engine.boss.def.color,.7);
    if(engine.extraction&&engine.extractionPoint){
      addLight(engine.extractionPoint.x,engine.extractionPoint.y,220,'#f5d27a',.8);
    }

    lctx.globalCompositeOperation='source-over';

    // Composite up to full resolution.
    const ctx=this.ctx;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='lighter';
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(this.lightCanvas,0,0,camera.width,camera.height);
    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  // ---- 10. Post -----------------------------------------------------------
  drawPost(ctx,width,height){
    const engine=this.engine;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);

    // Vignette.
    const vignette=ctx.createRadialGradient(
      width/2,height/2,Math.min(width,height)*.32,
      width/2,height/2,Math.max(width,height)*.78
    );
    vignette.addColorStop(0,'rgba(0,0,0,0)');
    vignette.addColorStop(1,engine.world.palette.fog||'rgba(0,4,8,.55)');
    ctx.fillStyle=vignette;
    ctx.fillRect(0,0,width,height);

    // Low-health pulse.
    const healthRatio=engine.player.hp/engine.player.maxHp;
    if(healthRatio<.35&&!this.settings.reducedFlashing){
      const intensity=(1-healthRatio/.35)*(.14+Math.sin(engine.elapsed*6)*.06);
      ctx.fillStyle=`rgba(255,40,40,${clamp(intensity,0,.3)})`;
      ctx.fillRect(0,0,width,height);
    }

    // Damage / event flash.
    if(engine.fx.screenFlash>0){
      ctx.globalAlpha=clamp(engine.fx.screenFlash,0,.6);
      ctx.fillStyle=engine.fx.screenFlashColor;
      ctx.fillRect(0,0,width,height);
      ctx.globalAlpha=1;
    }

    this.drawOffscreenMarkers(ctx,width,height);
    if(this.settings.showMinimap!==false)this.drawMinimap(ctx,width,height);
    this.drawAnnouncements(ctx,width,height);
    // The profiler only records while the readout is on, so a player who never
    // opens it pays nothing for it existing.
    profiler.setEnabled(!!this.settings.showFps);
    if(this.settings.showFps)this.drawDebug(ctx,width,height);

    ctx.restore();
  }

  // Edge arrows pointing at threats and objectives outside the view.
  drawOffscreenMarkers(ctx,width,height){
    const engine=this.engine;
    if(this.settings.showThreatIndicators===false)return;
    const camera=engine.camera;
    const margin=42;
    const centerX=width/2,centerY=height/2;

    const mark=(worldX,worldY,color,size=8)=>{
      const screen=camera.worldToScreen(worldX,worldY);
      if(screen.x>margin&&screen.x<width-margin&&screen.y>margin&&screen.y<height-margin)return;
      const angle=Math.atan2(screen.y-centerY,screen.x-centerX);
      const radiusX=width/2-margin;
      const radiusY=height/2-margin;
      // Project onto the screen-edge ellipse.
      const scale=1/Math.max(
        Math.abs(Math.cos(angle))/radiusX,
        Math.abs(Math.sin(angle))/radiusY
      );
      const x=centerX+Math.cos(angle)*scale;
      const y=centerY+Math.sin(angle)*scale;
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(angle);
      ctx.fillStyle=color;
      ctx.globalAlpha=.85;
      ctx.beginPath();
      ctx.moveTo(size,0);ctx.lineTo(-size*.7,-size*.7);ctx.lineTo(-size*.7,size*.7);
      ctx.closePath();ctx.fill();
      ctx.restore();
    };

    if(engine.boss)mark(engine.boss.x,engine.boss.y,engine.boss.def.color,12);
    if(engine.extraction&&engine.extractionPoint){
      mark(engine.extractionPoint.x,engine.extractionPoint.y,'#f5d27a',12);
    }
    // Objective markers take priority: they are what the operation is for.
    for(const cache of engine.mission?.caches||[]){
      if(!cache.recovered)mark(cache.x,cache.y,'#8fd8ff',10);
    }
    if(engine.mission?.asset&&!engine.mission.asset.downed&&!engine.mission.asset.aboard){
      mark(engine.mission.asset.x,engine.mission.asset.y,'#ffd166',11);
    }
    // A scanned vault stays flagged off-screen until it has been opened, and
    // so does the console holding it shut — that one is the objective, not the
    // chamber, until it goes down.
    for(const vault of engine.world.vaults){
      if(!vault.discovered||vault.breached)continue;
      mark(vault.x,vault.y,'#f5d27a',9);
      if(vault.terminal&&!vault.terminal.broken){
        mark(vault.terminal.x,vault.terminal.y,'#c895ff',9);
      }
    }
    let eliteCount=0;
    for(const enemy of engine.enemies){
      if(enemy.dead||!enemy.elite||eliteCount>=6)continue;
      mark(enemy.x,enemy.y,enemy.color,8);
      eliteCount++;
    }
    // Incoming strikes near the player but off-screen.
    for(const strike of engine.strikes){
      if(strike.hostile)mark(strike.x,strike.y,'#ff5b5b',7);
    }
  }

  drawMinimap(ctx,width,height){
    const engine=this.engine;
    const world=engine.world;
    // Sized and positioned to clear the bottom-right action cluster (ability,
    // dash and pause buttons), which previously drew on top of it.
    const compact=width<820||height<560;
    const size=Math.round(Math.min(compact?104:150,Math.max(84,width*.11)));
    const pad=14;
    const x=width-size-pad;
    const y=height-size-pad-(compact?58:78);
    const scaleX=size/world.width;
    const scaleY=size/world.height;

    ctx.save();
    ctx.globalAlpha=.82;
    ctx.fillStyle='rgba(3,10,14,.86)';
    ctx.fillRect(x,y,size,size);
    ctx.strokeStyle='rgba(118,231,212,.35)';
    ctx.lineWidth=1;
    ctx.strokeRect(x+.5,y+.5,size-1,size-1);

    // Geometry.
    ctx.fillStyle='rgba(120,170,175,.4)';
    for(const wall of world.walls){
      if(wall.type==='perimeter')continue;
      ctx.fillRect(x+(wall.x-wall.hw)*scaleX,y+(wall.y-wall.hh)*scaleY,
        Math.max(1,wall.w*scaleX),Math.max(1,wall.h*scaleY));
    }

    // Hostiles.
    ctx.fillStyle='rgba(255,110,100,.75)';
    for(const enemy of engine.enemies){
      if(enemy.dead||enemy.elite)continue;
      ctx.fillRect(x+enemy.x*scaleX-1,y+enemy.y*scaleY-1,2,2);
    }
    for(const enemy of engine.enemies){
      if(enemy.dead||!enemy.elite)continue;
      ctx.fillStyle=enemy.color;
      ctx.fillRect(x+enemy.x*scaleX-2,y+enemy.y*scaleY-2,4,4);
    }

    // Boss.
    if(engine.boss){
      ctx.fillStyle=engine.boss.def.color;
      ctx.beginPath();
      ctx.arc(x+engine.boss.x*scaleX,y+engine.boss.y*scaleY,4,0,TAU);
      ctx.fill();
    }

    // Extraction.
    if(engine.extraction&&engine.extractionPoint){
      ctx.strokeStyle='#f5d27a';
      ctx.lineWidth=2;
      ctx.beginPath();
      ctx.arc(x+engine.extractionPoint.x*scaleX,y+engine.extractionPoint.y*scaleY,
        4+Math.sin(engine.elapsed*5)*1.5,0,TAU);
      ctx.stroke();
    }

    // Scanned vaults: hollow diamond while sealed, filled once opened. A
    // remote lock also plots its console, so the route is readable from the
    // map rather than only from the compass.
    for(const vault of engine.world.vaults){
      if(!vault.discovered)continue;
      const terminal=vault.terminal;
      if(terminal&&!terminal.broken&&!vault.breached){
        ctx.fillStyle='rgba(200,149,255,.85)';
        ctx.fillRect(x+terminal.x*scaleX-2,y+terminal.y*scaleY-2,4,4);
      }
      const vx=x+vault.x*scaleX,vy=y+vault.y*scaleY;
      ctx.beginPath();
      ctx.moveTo(vx,vy-4);ctx.lineTo(vx+4,vy);ctx.lineTo(vx,vy+4);ctx.lineTo(vx-4,vy);
      ctx.closePath();
      if(vault.breached){
        ctx.fillStyle='rgba(139,255,155,.75)';
        ctx.fill();
      }else{
        ctx.strokeStyle='#f5d27a';
        ctx.lineWidth=1.5;
        ctx.stroke();
      }
    }

    // Operative + facing.
    const px=x+engine.player.x*scaleX;
    const py=y+engine.player.y*scaleY;
    ctx.fillStyle=engine.operative.color;
    ctx.beginPath();ctx.arc(px,py,3,0,TAU);ctx.fill();
    ctx.strokeStyle=engine.operative.color;
    ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(px,py);
    ctx.lineTo(px+Math.cos(engine.player.angle)*7,py+Math.sin(engine.player.angle)*7);
    ctx.stroke();

    // View rectangle.
    ctx.strokeStyle='rgba(255,255,255,.2)';
    ctx.lineWidth=1;
    ctx.strokeRect(
      x+(engine.camera.x-engine.camera.viewHalfWidth())*scaleX,
      y+(engine.camera.y-engine.camera.viewHalfHeight())*scaleY,
      engine.camera.viewHalfWidth()*2*scaleX,
      engine.camera.viewHalfHeight()*2*scaleY
    );
    ctx.restore();
  }

  drawAnnouncements(ctx,width,height){
    const engine=this.engine;
    if(!engine.announcements.length)return;
    ctx.save();
    ctx.textAlign='center';
    let y=height*.24;
    for(const announcement of engine.announcements){
      const fade=clamp(announcement.life/Math.min(.6,announcement.maxLife),0,1);
      const rise=(1-clamp(announcement.life/announcement.maxLife,0,1))*10;
      ctx.globalAlpha=fade;
      ctx.font='bold 20px ui-monospace,SFMono-Regular,monospace';
      ctx.lineWidth=4;
      ctx.strokeStyle='rgba(0,0,0,.65)';
      ctx.strokeText(announcement.text,width/2,y-rise);
      ctx.fillStyle=announcement.color;
      ctx.fillText(announcement.text,width/2,y-rise);
      y+=30;
    }
    ctx.restore();
  }

  // Readable off a phone screen without a console attached, because that is the
  // hardware the numbers are actually needed from.
  drawDebug(ctx,width,height){
    const engine=this.engine;
    const stats=engine.fx.stats;
    const p=profiler.snapshot();
    const clamps=p.counters.stepClamps||0;
    const dropped=p.counters.droppedMs||0;

    ctx.save();
    ctx.font='10px ui-monospace,monospace';
    ctx.textAlign='left';

    const lines=[
      [`${p.frameMs.p50||'--'}ms p50   ${p.frameMs.p95||'--'} p95   ${p.frameMs.p99||'--'} p99`,'#8ce6dc'],
      [`worst ${p.frameMs.max||'--'}ms  (${p.fps.p50||0} fps typical, ${p.fps.worst||0} worst)`,'#8ce6dc'],
      [`sim ${p.phasesMs.sim??'--'}ms   render ${p.phasesMs.render??'--'}ms`,'#8ce6dc'],
      // The clamp line is the point of the whole overlay. Anything above zero
      // means the simulation is discarding time and the contract is running
      // slower than its own clock.
      [clamps
        ? `STEP CLAMPS ${clamps}  ·  ${dropped}ms of contract discarded`
        : 'step clamps 0  ·  simulation keeping pace',
       clamps?'#ff7068':'#7fd48a'],
      [`hostiles ${engine.enemies.length}/${engine.director.enemyCap}  peak ${p.peak.enemies}`,'rgba(140,230,220,.75)'],
      [`proj ${engine.projectiles.length}+${engine.enemyProjectiles.length}   particles ${stats.particles} peak ${p.peak.particles}`,'rgba(140,230,220,.75)'],
      [`cover ${engine.world.cover.length}  decor ${engine.world.decor.length}  decals ${engine.world.decals?.length??0}`,'rgba(140,230,220,.75)'],
      [`quality ${this.settings.particles||'high'}${this.settings.performanceMode?' · perf mode':''}${p.heapMb?`   heap ${p.heapMb}MB`:''}`,'rgba(140,230,220,.75)']
    ];

    const boxH=lines.length*13+12;
    ctx.fillStyle='rgba(2,10,14,.72)';
    ctx.fillRect(8,height-boxH-10,332,boxH);
    lines.forEach(([line,color],i)=>{
      ctx.fillStyle=color;
      ctx.fillText(line,16,height-boxH+4+i*13);
    });
    ctx.restore();
  }
}
