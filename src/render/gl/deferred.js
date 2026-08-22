// The deferred WebGL2 renderer.
//
// A drop-in replacement for the Canvas 2D renderer, with the same public
// surface — construct it, resize it, call render() once a frame, destroy it —
// so main.js chooses between them in one place and nothing else in the game
// knows which one is running.
//
// The pipeline:
//
//   1. G-buffer      instanced quads, one per surface the theatre dressed,
//                    writing albedo/roughness and a height field. Several
//                    hundred surfaces in one draw call.
//   2. Ambient       the theatre's sky term plus every emissive surface.
//   3. Lights        one instanced quad per light, sized to its radius and
//                    blended additively, so a light shades only the pixels it
//                    reaches instead of the whole screen once per light.
//   4. Particles     one instanced additive quad each, the whole system in one
//                    draw call, fed from the existing pooled Fx arrays.
//   5. Bloom         bright-pass plus a separable blur at quarter resolution.
//   6. Composite     tonemap, the sprite layer over the top, then grain,
//                    scanlines and vignette.
//
// Sprites are deliberately NOT reimplemented. Hostiles, projectiles, pickups,
// decals, landmarks, hazards and every world-space marker are drawn by the
// production Canvas 2D code into an offscreen canvas and uploaded as one
// texture per frame. Every one of those pixels is therefore identical to the
// shipping game — readability is the thing this must not break — and the whole
// of src/render/sprites.js stays the single source of truth for what a hostile
// looks like.
//
// Screen-space UI (weather, the minimap, off-screen markers, announcements)
// goes on a plain 2D canvas stacked over the GL one. It is not uploaded, not
// tonemapped and not blurred: a minimap that has been through a filmic curve
// is a worse minimap.

import {createContext,describe,createProgram,createTarget,resizeTarget,
  createQuad,bindTarget,useTexture,FULLSCREEN_VS} from './glcore.js';
import * as S from './shaders.js';
import {buildDressing,LIGHT,hexToRgb} from './dressing.js';
import {presetForSettings} from './presets.js';
import {probeWebGL2} from './support.js';
import {Renderer} from '../renderer.js';

const MAX_PARTICLES=20000;
const MAX_DYNAMIC_LIGHTS=192;

export class DeferredRenderer{
  constructor(canvas,engine,options={}){
    this.canvas=canvas;
    this.engine=engine;
    this.settings=engine.settings;
    this._quality=this.settings.particles||'high';
    this.contextLost=false;

    this.gl=createContext(canvas,{capture:!!options.capture});
    this.failed=!this.gl;
    this.info=describe(this.gl);
    if(this.failed)return;

    // Feature switches. The visual test replaces this wholesale with its own
    // preset; the game derives it from the player's settings.
    this.quality=options.quality||presetForSettings(this.settings);

    // The sector, dressed for its theatre. Built from the engine's own arena,
    // so what is drawn and what the operative collides with are one thing.
    this.scene=buildDressing(engine.world,engine.map,options.seed??engine.seed??1);
    this.time=0;
    this.lastFrame=performance.now();
    this.frameTimes=[];
    this.fps=60;

    // CPU time spent issuing each pass. GL commands are asynchronous, so on a
    // working GPU these are submission costs and near zero.
    //
    // `syncTiming` instead measures the whole frame including the GPU: the
    // clock starts at the top of render() and stops after a finish(), so
    // `timings.gpu` is directly comparable to the frame interval. That is the
    // number that says whether a run is at its ceiling or merely at the
    // monitor's. It destroys pipelining, so it is a diagnostic and not a mode
    // to play in.
    this.timings={gbuffer:0,lights:0,particles:0,bloom:0,composite:0,upload:0,sprites:0,gpu:0};
    this.syncTiming=false;

    this.buildLayers();
    this.initGL();

    // A lost context is recoverable: everything here is rebuilt from the scene
    // description, which is pure data. Without preventDefault the browser
    // never fires the restore event at all.
    this.onContextLost=event=>{
      event.preventDefault();
      this.contextLost=true;
    };
    this.onContextRestored=()=>{
      this.contextLost=false;
      this.initGL();
      this.resize(this.width||canvas.width,this.height||canvas.height);
    };
    canvas.addEventListener('webglcontextlost',this.onContextLost,false);
    canvas.addEventListener('webglcontextrestored',this.onContextRestored,false);

    this.resize(canvas.width,canvas.height);
    this.initAtmosphere();
  }

  // Effect density, shared with the 2D renderer so one setting drives both.
  get quality(){return this._quality}
  set quality(value){
    if(typeof value==='string'){
      this._quality=value;
      this.gpuQuality=presetForSettings({...this.settings,particles:value});
      if(this.sprites)this.sprites.quality=value;
      // The render scale changed with the preset, so the targets must follow.
      if(this.width)this.resize(this.width,this.height);
      if(this.motes)this.initAtmosphere();
    }else{
      // The visual test hands over a full preset object.
      this.gpuQuality=value;
    }
  }

  // Every read of the feature switches goes through this, so both forms of
  // `quality` above end up at the same object.
  get q(){return this.gpuQuality||{}}

  // ---- layers -------------------------------------------------------------

  buildLayers(){
    // Painted floor art, when the theatre has any, laid into the G-buffer as
    // albedo so the lighting pass treats it like any other surface.
    this.groundCanvas=document.createElement('canvas');
    this.groundCtx=this.groundCanvas.getContext('2d');
    this.groundActive=false;

    // World-space sprite layer, uploaded to GL each frame.
    this.spriteCanvas=document.createElement('canvas');
    this.spriteCtx=this.spriteCanvas.getContext('2d');
    // The production renderer, used for its sprite passes only. It draws onto
    // the offscreen layer and never presents to a screen.
    this.sprites=new Renderer(this.spriteCanvas,this.spriteCtx,this.engine);
    this.sprites.quality=this._quality;

    // Screen-space UI, stacked over the GL canvas as a real DOM element rather
    // than uploaded. Costs nothing per frame and stays pixel-crisp.
    this.uiCanvas=document.createElement('canvas');
    this.uiCanvas.className='gl-ui-layer';
    this.uiCanvas.style.cssText=
      'position:absolute;inset:0;width:100%;height:100%;'+
      'pointer-events:none;display:block;z-index:1';
    this.canvas.parentNode?.insertBefore(this.uiCanvas,this.canvas.nextSibling);
    this.uiCtx=this.uiCanvas.getContext('2d');
  }

  initGL(){
    const gl=this.gl;
    this.quad=createQuad(gl);
    this.programs={
      gbuffer:createProgram(gl,S.GBUFFER_VS,S.GBUFFER_FS,'gbuffer'),
      light:createProgram(gl,S.LIGHT_VS,S.LIGHT_FS,'light'),
      ambient:createProgram(gl,FULLSCREEN_VS,S.AMBIENT_FS,'ambient'),
      particle:createProgram(gl,S.PARTICLE_VS,S.PARTICLE_FS,'particle'),
      bright:createProgram(gl,FULLSCREEN_VS,S.BRIGHT_FS,'bright'),
      blur:createProgram(gl,FULLSCREEN_VS,S.BLUR_FS,'blur'),
      composite:createProgram(gl,FULLSCREEN_VS,S.COMPOSITE_FS,'composite'),
      ground:createProgram(gl,FULLSCREEN_VS,S.GROUND_FS,'ground')
    };
    this.buildPropBuffers();
    this.buildLightBuffers();
    this.buildParticleBuffers();
    this.buildSpriteTexture();
    this.groundTexture=this.makeLayerTexture();
    this.groundTextureSize={w:0,h:0};
    this.targets={};
    this.gbufferFbo=null;
  }

  // ---- static geometry ----------------------------------------------------

  buildPropBuffers(){
    const gl=this.gl;
    const props=this.scene.props;
    const rect=new Float32Array(props.length*4);
    const color=new Float32Array(props.length*4);
    const params=new Float32Array(props.length*4);
    const extra=new Float32Array(props.length*2);
    props.forEach((p,i)=>{
      rect.set([p.x,p.y,p.hw,p.hh],i*4);
      color.set([p.r,p.g,p.b,p.roughness],i*4);
      params.set([p.material,p.emissive,p.height,p.rotation],i*4);
      extra.set([p.phase,p.animation],i*2);
    });
    this.propVao=gl.createVertexArray();
    gl.bindVertexArray(this.propVao);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    const attrib=(location,data,size)=>{
      const buffer=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);
      gl.vertexAttribDivisor(location,1);
      return buffer;
    };
    attrib(1,rect,4);attrib(2,color,4);attrib(3,params,4);attrib(4,extra,2);
    gl.bindVertexArray(null);
    this.propCount=props.length;
  }

  buildLightBuffers(){
    const gl=this.gl;
    const max=this.scene.lights.length+MAX_DYNAMIC_LIGHTS;
    this.lightData=new Float32Array(max*4);
    this.lightColor=new Float32Array(max*4);
    this.lightVao=gl.createVertexArray();
    gl.bindVertexArray(this.lightVao);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    const dynamic=(location,data)=>{
      const buffer=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,data.byteLength,gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location,4,gl.FLOAT,false,0,0);
      gl.vertexAttribDivisor(location,1);
      return buffer;
    };
    this.lightBuffer=dynamic(1,this.lightData);
    this.lightColorBuffer=dynamic(2,this.lightColor);
    gl.bindVertexArray(null);
  }

  buildParticleBuffers(){
    const gl=this.gl;
    this.particleData=new Float32Array(MAX_PARTICLES*4);
    this.particleColor=new Float32Array(MAX_PARTICLES*4);
    this.particleVao=gl.createVertexArray();
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    const dynamic=(location,data)=>{
      const buffer=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,data.byteLength,gl.STREAM_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location,4,gl.FLOAT,false,0,0);
      gl.vertexAttribDivisor(location,1);
      return buffer;
    };
    this.particleBuffer=dynamic(1,this.particleData);
    this.particleColorBuffer=dynamic(2,this.particleColor);
    gl.bindVertexArray(null);
  }

  makeLayerTexture(){
    const gl=this.gl;
    const texture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return texture;
  }

  buildSpriteTexture(){
    this.spriteTexture=this.makeLayerTexture();
    this.spriteTextureSize={w:0,h:0};
  }

  // Canvas to texture, reallocating only when the size actually changed.
  uploadLayer(texture,canvas,size){
    const gl=this.gl;
    gl.bindTexture(gl.TEXTURE_2D,texture);
    if(size.w!==canvas.width||size.h!==canvas.height){
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
      size.w=canvas.width;size.h=canvas.height;
    }else{
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    }
  }

  resize(width,height){
    if(this.failed||this.contextLost)return;
    const gl=this.gl;
    this.width=width;this.height=height;
    // The G-buffer and lighting run at a scale the preset controls: fill rate
    // is the whole cost of this pipeline, and resolution is the one dial that
    // moves it linearly.
    const scale=this.q.renderScale??1;
    const w=Math.max(2,Math.round(width*scale));
    const h=Math.max(2,Math.round(height*scale));
    const bw=Math.max(2,w>>2),bh=Math.max(2,h>>2);
    const make=(key,tw,th,opts)=>{
      if(this.targets[key])resizeTarget(gl,this.targets[key],tw,th);
      else this.targets[key]=createTarget(gl,tw,th,opts);
    };
    make('albedo',w,h,{filter:'nearest'});
    make('surface',w,h,{filter:'nearest'});
    make('lit',w,h,{float:this.info.floatBuffers});
    make('bloomA',bw,bh,{float:this.info.floatBuffers});
    make('bloomB',bw,bh,{float:this.info.floatBuffers});
    this.internalWidth=w;this.internalHeight=h;

    if(!this.gbufferFbo)this.gbufferFbo=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.gbufferFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.targets.albedo.texture,0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,this.targets.surface.texture,0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);

    this.spriteCanvas.width=width;
    this.spriteCanvas.height=height;
    this.groundCanvas.width=width;
    this.groundCanvas.height=height;
    this.groundTextureSize={w:0,h:0};
    this.uiCanvas.width=width;
    this.uiCanvas.height=height;
    this.sprites.resize?.(width,height);
  }

  // World to clip. Matches the 2D camera exactly, so switching renderer does
  // not move anything by a pixel.
  viewMatrix(){
    const camera=this.engine.camera;
    const zoom=camera.zoom;
    const sx=2*zoom/this.width;
    const sy=-2*zoom/this.height;
    return new Float32Array([sx,0,0, 0,sy,0, -camera.x*sx,-camera.y*sy,1]);
  }

  invViewMatrix(){
    const camera=this.engine.camera;
    const zoom=camera.zoom;
    const sx=2*zoom/this.width;
    const sy=-2*zoom/this.height;
    return new Float32Array([1/sx,0,0, 0,1/sy,0, camera.x,camera.y,1]);
  }

  // ---- lights -------------------------------------------------------------

  // The theatre's own fixtures plus everything the fight is producing. Culled
  // to the view: a light off screen still costs a draw call and a buffer slot.
  //
  // The dynamic half deliberately mirrors what the 2D lighting pass emits, so
  // the same events light the room under either renderer and nothing that used
  // to glow stops glowing.
  collectLights(){
    const engine=this.engine;
    const camera=engine.camera;
    const t=this.time;
    const q=this.q;
    const data=this.lightData,color=this.lightColor;
    const max=data.length/4;
    let n=0;
    const halfW=this.width/(2*camera.zoom)+400;
    const halfH=this.height/(2*camera.zoom)+400;
    const push=(x,y,radius,rgb,intensity,z)=>{
      if(n>=max)return;
      if(!(radius>0))return;
      if(Math.abs(x-camera.x)>halfW+radius||Math.abs(y-camera.y)>halfH+radius)return;
      data[n*4]=x;data[n*4+1]=y;data[n*4+2]=radius;data[n*4+3]=z;
      color[n*4]=rgb[0];color[n*4+1]=rgb[1];color[n*4+2]=rgb[2];color[n*4+3]=intensity;
      n++;
    };

    if(q.sceneLights!==false){
      for(const L of this.scene.lights){
        let intensity=L.intensity;
        if(L.kind===LIGHT.flicker){
          intensity*=.72+.28*Math.sin(t*L.speed*6+L.phase)*Math.sin(t*L.speed*11+L.phase*2);
        }else if(L.kind===LIGHT.pulse){
          intensity*=.6+.4*Math.sin(t*L.speed*2+L.phase);
        }else if(L.kind===LIGHT.strobe){
          intensity*=Math.sin(t*L.speed+L.phase)>.55?1.6:.08;
        }else if(L.kind===LIGHT.rotate){
          const sweep=(Math.sin(t*L.speed+L.phase)+1)/2;
          intensity*=.1+Math.pow(sweep,3)*1.9;
        }
        push(L.x,L.y,L.radius,[L.r,L.g,L.b],intensity,L.z);
      }
    }

    if(q.combatLights!==false){
      push(engine.player.x,engine.player.y,240,hexToRgb(engine.operative.color),.85,26);
      for(const p of engine.projectiles){
        push(p.x,p.y,p.heavy?140:90,hexToRgb(p.color||'#ffe08a'),1.1,14);
      }
      for(const p of engine.enemyProjectiles){
        push(p.x,p.y,80,hexToRgb(p.color||'#ff8a5c'),.9,14);
      }
      // Beams light along their length rather than at their origin.
      for(const beam of engine.beams){
        const steps=6;
        for(let i=0;i<=steps;i++){
          const f=i/steps;
          push(beam.x+Math.cos(beam.angle)*beam.length*f,
               beam.y+Math.sin(beam.angle)*beam.length*f,
               150,hexToRgb(beam.color||'#9be8ff'),.8,18);
        }
      }
      // Every ring the effects system spawns becomes a light, which covers
      // muzzle flashes, impacts and explosions under one rule — Fx.muzzle and
      // Fx.explosion both emit a ring. The flash lighting the wall beside the
      // operative is the single most effective thing in this pipeline for
      // making a firefight feel physical.
      for(const ring of engine.fx.rings.active){
        const life=Math.max(0,ring.life/ring.maxLife);
        push(ring.x,ring.y,ring.radius*2.2+60,hexToRgb(ring.color||'#ffb35c'),2.4*life,24);
      }
      // Incoming ordnance, so a strike marker is visible before it lands.
      for(const strike of engine.strikes){
        const ramp=Math.min(1,strike.age/Math.max(.001,strike.delay));
        push(strike.x,strike.y,strike.blastRadius*1.6,
          hexToRgb(strike.color||'#ffb35c'),ramp*1.4,20);
      }
      // Theatre hazards. These are the one light source that is also a damage
      // source, so they must never be subtle.
      for(const hazard of engine.world.hazards){
        if(hazard.active)push(hazard.x,hazard.y,hazard.radius*2.2,hexToRgb(hazard.color),1.5,18);
        else if(hazard.passive&&hazard.damage)push(hazard.x,hazard.y,hazard.radius*1.4,hexToRgb(hazard.color),.5,10);
      }
      // Elites and bosses are self-lit so they stand out in a crowd.
      for(const enemy of engine.enemies){
        if(enemy.dead||!enemy.elite)continue;
        push(enemy.x,enemy.y,180,hexToRgb(enemy.color),.9,22);
      }
      if(engine.boss&&!engine.boss.dead){
        push(engine.boss.x,engine.boss.y,engine.boss.radius*6,
          hexToRgb(engine.boss.def.color),1.3,30);
      }
      if(engine.extraction&&engine.extractionPoint){
        push(engine.extractionPoint.x,engine.extractionPoint.y,420,
          hexToRgb('#f5d27a'),1.4,40);
      }
    }
    this.lightCount=n;
    return n;
  }

  // ---- particles ----------------------------------------------------------

  collectParticles(){
    const engine=this.engine;
    const camera=engine.camera;
    const data=this.particleData,color=this.particleColor;
    let n=0;
    const halfW=this.width/(2*camera.zoom)+120;
    const halfH=this.height/(2*camera.zoom)+120;
    const push=(x,y,size,kind,r,g,b,a)=>{
      if(n>=MAX_PARTICLES)return;
      if(Math.abs(x-camera.x)>halfW||Math.abs(y-camera.y)>halfH)return;
      data[n*4]=x;data[n*4+1]=y;data[n*4+2]=size;data[n*4+3]=kind;
      color[n*4]=r;color[n*4+1]=g;color[n*4+2]=b;color[n*4+3]=a;
      n++;
    };
    for(const p of engine.fx.particles.active){
      const life=Math.max(0,p.life/p.maxLife);
      const [r,g,b]=hexToRgb(p.color);
      const kind=p.glow?2:p.kind==='circle'?0:3;
      push(p.x,p.y,p.size*1.8,kind,r*1.4,g*1.4,b*1.4,life*.95);
    }
    if(this.q.atmosphere!==false&&this.motes){
      for(const m of this.motes)if(m.life>0)push(m.x,m.y,m.size,m.kind,m.r,m.g,m.b,m.a*m.fade);
    }
    this.particleCount=n;
    return n;
  }

  // ---- atmosphere ---------------------------------------------------------
  //
  // A self-contained, pooled, fixed-size mote system that belongs to the
  // renderer rather than to the simulation. It is what fills the air between
  // the emitters the theatre placed — steam off a vent, embers off a molten
  // channel, spores under a dead canopy, snow across a valley floor.

  initAtmosphere(){
    this.emitters=this.scene.emitters||[];
    const budget=this.q.atmosphereCount??900;
    this.motes=[];
    for(let i=0;i<budget;i++){
      this.motes.push({x:0,y:0,vx:0,vy:0,size:1,kind:1,r:1,g:1,b:1,a:0,fade:0,life:0,maxLife:1});
    }
    this.moteCursor=0;
  }

  spawnMote(x,y,kind,scale){
    if(!this.motes.length)return;
    const m=this.motes[this.moteCursor];
    this.moteCursor=(this.moteCursor+1)%this.motes.length;
    const jitter=(k=24)=>(Math.random()-.5)*k;
    m.x=x+jitter();m.y=y+jitter();
    m.fade=1;
    switch(kind){
      case 'steam':
        m.vx=jitter(30);m.vy=-18-Math.random()*26;
        m.size=8*scale;m.kind=1;m.r=.5;m.g=.58;m.b=.62;m.a=.32;
        m.maxLife=m.life=1.6+Math.random()*1.4;break;
      case 'smoke':
        m.vx=jitter(16);m.vy=-8-Math.random()*14;
        m.size=12*scale;m.kind=1;m.r=.16;m.g=.16;m.b=.18;m.a=.4;
        m.maxLife=m.life=2.4+Math.random()*2;break;
      case 'glow':
        m.vx=jitter(20);m.vy=-6-Math.random()*18;
        m.size=3*scale;m.kind=2;m.r=.35;m.g=1;m.b=.95;m.a=.75;
        m.maxLife=m.life=1.2+Math.random();break;
      case 'ember':
        m.vx=jitter(26);m.vy=-24-Math.random()*40;
        m.size=2.2*scale;m.kind=2;m.r=1;m.g=.5;m.b=.18;m.a=.9;
        m.maxLife=m.life=1.1+Math.random()*1.3;break;
      case 'spore':
        m.vx=jitter(9);m.vy=-3-Math.random()*7;
        m.size=2*scale;m.kind=2;m.r=.6;m.g=.95;m.b=.45;m.a=.55;
        m.maxLife=m.life=4+Math.random()*4;break;
      case 'snowblow':
        // Driven sideways rather than falling: this is ground snow picked up
        // by the wind, and the theatre already has falling snow above it.
        m.vx=-70-Math.random()*130;m.vy=jitter(30);
        m.size=1.8*scale;m.kind=3;m.r=.86;m.g=.92;m.b=1;m.a=.3;
        m.maxLife=m.life=1.8+Math.random()*1.6;break;
      case 'mist':
        m.vx=jitter(12);m.vy=jitter(8);
        m.size=22*scale;m.kind=1;m.r=.34;m.g=.42;m.b=.44;m.a=.14;
        m.maxLife=m.life=5+Math.random()*4;break;
      case 'rain':
        // Spray coming off the deck, not the rain itself.
        m.vx=-40-Math.random()*60;m.vy=-10-Math.random()*20;
        m.size=1.6*scale;m.kind=3;m.r=.6;m.g=.72;m.b=.8;m.a=.24;
        m.maxLife=m.life=.7+Math.random()*.6;break;
      default:                                        // drifting dust
        m.vx=jitter(14);m.vy=jitter(10);
        m.size=1.4*scale;m.kind=3;m.r=.6;m.g=.62;m.b=.6;m.a=.16;
        m.maxLife=m.life=3+Math.random()*3;
    }
  }

  updateAtmosphere(dt){
    if(!this.motes||this.q.atmosphere===false)return;
    for(const m of this.motes){
      if(m.life<=0)continue;
      m.life-=dt;
      m.x+=m.vx*dt;m.y+=m.vy*dt;
      m.vx*=.985;m.vy*=.985;
      m.size+=dt*(m.kind===1?26:2);
      m.fade=Math.max(0,m.life/m.maxLife);
    }
    const camera=this.engine.camera;
    const rate=this.q.atmosphereRate??1;
    for(const e of this.emitters){
      if(Math.abs(e.x-camera.x)>1600||Math.abs(e.y-camera.y)>1200)continue;
      if(Math.random()<e.rate*dt*rate)this.spawnMote(e.x,e.y,e.kind,e.scale);
    }
    // The theatre's own ambient, spawned across the visible area so empty
    // ground is never truly empty.
    const ambient=Math.round(6*rate);
    for(let i=0;i<ambient;i++){
      if(Math.random()<dt*4){
        this.spawnMote(
          camera.x+(Math.random()-.5)*1800,
          camera.y+(Math.random()-.5)*1300,
          this.scene.ambientKind,1);
      }
    }
  }

  // ---- frame --------------------------------------------------------------

  render(){
    if(this.failed)return;
    const now=performance.now();
    const dt=Math.min(.1,(now-this.lastFrame)/1000);
    this.lastFrame=now;
    this.frameTimes.push(dt*1000);
    if(this.frameTimes.length>40)this.frameTimes.shift();
    this.fps=Math.round(1000/Math.max(1,
      this.frameTimes.reduce((a,b)=>a+b,0)/this.frameTimes.length));
    // The UI layer is drawn whatever happens: a lost context must not also
    // take the minimap and the pause prompt with it.
    if(this.contextLost){this.drawUiLayer(dt);return}

    const gl=this.gl;
    const q=this.q;
    this.time+=dt;
    this.updateAtmosphere(dt);

    const view=this.viewMatrix();
    const frameStart=now;
    let mark=frameStart;

    // 1. G-buffer. A theatre with painted floor art lays that in first and
    // skips its own floor plates; everything else starts from a clear buffer.
    this.drawGroundLayer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.gbufferFbo);
    gl.viewport(0,0,this.internalWidth,this.internalHeight);
    gl.disable(gl.BLEND);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if(this.groundActive){
      this.uploadLayer(this.groundTexture,this.groundCanvas,this.groundTextureSize);
      const grp=this.programs.ground;
      gl.useProgram(grp.program);
      useTexture(gl,0,this.groundTexture,grp.uniforms.uGround);
      gl.uniform1f(grp.uniforms.uRoughness,.72);
      gl.uniform1f(grp.uniforms.uGain,this.q.groundGain??.9);
      gl.bindVertexArray(this.quad.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    const gp=this.programs.gbuffer;
    gl.useProgram(gp.program);
    gl.uniformMatrix3fv(gp.uniforms.uView,false,view);
    gl.uniform1f(gp.uniforms.uTime,this.time);
    gl.uniform1f(gp.uniforms.uDetail,q.materialDetail===false?0:1);
    gl.uniform1i(gp.uniforms.uSkip,this.groundActive?(this.scene.floorCount||0):0);
    gl.bindVertexArray(this.propVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,this.propCount);
    this.timings.gbuffer=performance.now()-mark;

    // 2. Ambient + emissive into the lit buffer.
    mark=performance.now();
    bindTarget(gl,this.targets.lit);
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const ap=this.programs.ambient;
    gl.useProgram(ap.program);
    useTexture(gl,0,this.targets.albedo.texture,ap.uniforms.uAlbedo);
    useTexture(gl,1,this.targets.surface.texture,ap.uniforms.uSurface);
    // The theatre's sky term, scaled by the preset's ambient dial. Outdoors
    // this is most of the light in the frame; indoors it is the floor under
    // the fixtures.
    const sky=this.scene.ambient;
    const k=(q.ambient??.17)/.17;
    gl.uniform3f(ap.uniforms.uAmbient,sky[0]*k,sky[1]*k,sky[2]*k);
    gl.bindVertexArray(this.quad.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    // 3. Lights, additively.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE,gl.ONE);
    const count=q.lighting===false?0:this.collectLights();
    if(count){
      gl.bindBuffer(gl.ARRAY_BUFFER,this.lightBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,this.lightData,0,count*4);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.lightColorBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,this.lightColor,0,count*4);
      const lp=this.programs.light;
      gl.useProgram(lp.program);
      gl.uniformMatrix3fv(lp.uniforms.uView,false,view);
      gl.uniformMatrix3fv(lp.uniforms.uInvView,false,this.invViewMatrix());
      gl.uniform2f(lp.uniforms.uTexel,1/this.internalWidth,1/this.internalHeight);
      gl.uniform1f(lp.uniforms.uShadows,q.shadows===false?0:1);
      useTexture(gl,0,this.targets.albedo.texture,lp.uniforms.uAlbedo);
      useTexture(gl,1,this.targets.surface.texture,lp.uniforms.uSurface);
      gl.bindVertexArray(this.lightVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,count);
    }else{
      this.lightCount=0;
    }
    this.timings.lights=performance.now()-mark;

    // 4. Particles, still additive into the lit buffer.
    mark=performance.now();
    const particles=q.particles===false?0:this.collectParticles();
    if(particles){
      gl.bindBuffer(gl.ARRAY_BUFFER,this.particleBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,this.particleData,0,particles*4);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.particleColorBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,this.particleColor,0,particles*4);
      const pp=this.programs.particle;
      gl.useProgram(pp.program);
      gl.uniformMatrix3fv(pp.uniforms.uView,false,view);
      gl.uniform1f(pp.uniforms.uTime,this.time);
      gl.bindVertexArray(this.particleVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,particles);
    }else{
      this.particleCount=0;
    }
    this.timings.particles=performance.now()-mark;
    gl.disable(gl.BLEND);

    // 5. Bloom.
    mark=performance.now();
    if(q.bloom!==false){
      bindTarget(gl,this.targets.bloomA);
      const bp=this.programs.bright;
      gl.useProgram(bp.program);
      gl.uniform1f(bp.uniforms.uThreshold,q.bloomThreshold??.85);
      useTexture(gl,0,this.targets.lit.texture,bp.uniforms.uSource);
      gl.bindVertexArray(this.quad.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

      const blur=this.programs.blur;
      gl.useProgram(blur.program);
      const passes=q.bloomPasses??2;
      for(let i=0;i<passes;i++){
        bindTarget(gl,this.targets.bloomB);
        gl.uniform2f(blur.uniforms.uDirection,1/this.targets.bloomA.width,0);
        useTexture(gl,0,this.targets.bloomA.texture,blur.uniforms.uSource);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        bindTarget(gl,this.targets.bloomA);
        gl.uniform2f(blur.uniforms.uDirection,0,1/this.targets.bloomB.height);
        useTexture(gl,0,this.targets.bloomB.texture,blur.uniforms.uSource);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      }
    }
    this.timings.bloom=performance.now()-mark;

    // 6. Sprites, drawn by the production 2D code, then uploaded.
    mark=performance.now();
    this.drawSpriteLayer();
    this.timings.sprites=performance.now()-mark;
    mark=performance.now();
    this.uploadLayer(this.spriteTexture,this.spriteCanvas,this.spriteTextureSize);
    this.timings.upload=performance.now()-mark;

    // 7. Composite to the screen.
    mark=performance.now();
    bindTarget(gl,null);
    const cp=this.programs.composite;
    gl.useProgram(cp.program);
    useTexture(gl,0,this.targets.lit.texture,cp.uniforms.uScene);
    useTexture(gl,1,this.targets.bloomA.texture,cp.uniforms.uBloom);
    useTexture(gl,2,this.spriteTexture,cp.uniforms.uEntities);
    gl.uniform1f(cp.uniforms.uBloomAmount,q.bloom===false?0:(q.bloomAmount??.85));
    gl.uniform1f(cp.uniforms.uTime,this.time);
    gl.uniform1f(cp.uniforms.uGrain,this.settings.reducedFlashing?0:(q.grain??.04));
    gl.uniform1f(cp.uniforms.uVignette,q.vignette??.85);
    gl.uniform1f(cp.uniforms.uScanline,q.scanline??.35);
    gl.uniform1f(cp.uniforms.uExposure,q.exposure??1.25);
    gl.uniform2f(cp.uniforms.uEntityTexel,1/this.spriteCanvas.width,1/this.spriteCanvas.height);
    gl.uniform1f(cp.uniforms.uRim,q.silhouetteRim??.75);
    gl.bindVertexArray(this.quad.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.bindVertexArray(null);
    this.timings.composite=performance.now()-mark;

    if(this.syncTiming){
      gl.finish();
      this.timings.gpu=performance.now()-frameStart;
    }

    // 8. Screen-space UI, on its own canvas over the top.
    this.drawUiLayer(dt);
  }

  // Everything in world space that the deferred path does not draw itself.
  // Reuses the production renderer's own passes, so no sprite is
  // reimplemented and a hostile looks exactly as it does under Canvas 2D.
  drawSpriteLayer(){
    const ctx=this.spriteCtx;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,this.spriteCanvas.width,this.spriteCanvas.height);
    this.engine.camera.apply(ctx);
    this.sprites.drawWorldLayer(ctx,{particles:this.q.engineParticles!==false});
    ctx.restore();
  }

  // Painted floor art into its own canvas, or nothing at all when the theatre
  // has none — which is nine of the ten, and every one of them draws its floor
  // in GL instead.
  drawGroundLayer(){
    const ctx=this.groundCtx;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,this.groundCanvas.width,this.groundCanvas.height);
    this.engine.camera.apply(ctx);
    this.groundActive=this.sprites.drawAuthoredGround(ctx);
    ctx.restore();
  }

  drawUiLayer(dt){
    const ctx=this.uiCtx;
    const w=this.uiCanvas.width,h=this.uiCanvas.height;
    if(!w||!h)return;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,w,h);
    // World-space markers ride up here with the screen-space UI: they are
    // navigation, not sector, and they must not go through the composite's
    // silhouette rim.
    this.engine.camera.apply(ctx);
    this.sprites.drawWorldMarkers(ctx);
    ctx.restore();
    // The vignette is the composite shader's job here, so the 2D pass skips
    // its own rather than drawing a second one over it.
    this.sprites.drawScreenLayer(ctx,w,h,{vignette:false,delta:dt});
  }

  // ---- reporting ----------------------------------------------------------
  // Read by the visual test's overlay and by the in-game performance readout.

  get propTotal(){return this.propCount}

  describe(){
    return{
      renderer:'Deferred WebGL2',
      theatre:this.scene?.theatre,
      hardware:this.info?.renderer,
      software:!!this.info?.software,
      props:this.propCount,
      sceneLights:this.scene?.lights.length||0,
      internal:[this.internalWidth,this.internalHeight]
    };
  }

  destroy(){
    this.sprites?.destroy?.();
    this.uiCanvas?.remove();
    this.canvas.removeEventListener('webglcontextlost',this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored',this.onContextRestored);
    if(this.failed||this.contextLost)return;
    const gl=this.gl;
    for(const key of Object.keys(this.targets||{})){
      gl.deleteTexture(this.targets[key].texture);
      gl.deleteFramebuffer(this.targets[key].framebuffer);
    }
    for(const key of Object.keys(this.programs||{}))gl.deleteProgram(this.programs[key].program);
    gl.deleteTexture(this.spriteTexture);
    gl.deleteTexture(this.groundTexture);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // The 2D renderer exposes this and main.js does not care which is running.
  dispose(){this.destroy()}
}

export {probeWebGL2,shouldUseGL} from './support.js';
