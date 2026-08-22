// BLACKSITE VISUAL TEST — the experimental WebGL2 renderer.
//
// Nothing in src/experiments is imported by the production game. The
// production renderer (Canvas 2D, src/render/renderer.js) is untouched and
// still runs every other level.
//
// The pipeline, and why it is shaped this way:
//
//   1. G-buffer      instanced quads, one per prop, writing albedo/roughness
//                    and a height field. 300-odd props in one draw call.
//   2. Ambient       a floor of light plus every emissive surface.
//   3. Lights        one instanced quad per light, sized to its radius,
//                    blended additively. Fifty lights shade only the pixels
//                    they actually reach rather than the whole screen each.
//   4. Particles     one instanced additive quad each, whole system in one
//                    draw call, fed from the existing pooled Fx arrays.
//   5. Bloom         bright-pass and a separable blur at quarter resolution.
//   6. Composite     tonemap, the Canvas 2D entity layer over the top, and
//                    the screen-space atmosphere.
//
// Entities are deliberately NOT reimplemented here. They are drawn by the
// production sprite code into an offscreen 2D canvas and uploaded as one
// texture per frame. That keeps every hostile, projectile and pickup pixel
// identical to the shipping game — readability is the thing this experiment
// must not break — and it makes the interesting production question directly
// measurable: can the existing 2D sprite pipeline keep its art and gain GPU
// lighting? The upload is timed separately and reported.

import {createContext,describe,createProgram,createTarget,resizeTarget,
  createQuad,bindTarget,useTexture,FULLSCREEN_VS} from './glcore.js';
import * as S from './shaders.js';
import {buildScene,LIGHT} from './scene.js';

const MAX_PARTICLES=20000;

export class VisualTestRenderer{
  constructor(canvas,engine,options={}){
    this.canvas=canvas;
    this.engine=engine;
    this.gl=createContext(canvas,{capture:!!options.capture});
    this.info=describe(this.gl);
    this.failed=!this.gl;
    if(this.failed)return;

    this.quality=options.quality||{};
    // Built from the engine's own arena so the visible room and the collision
    // world are the same thing.
    this.scene=buildScene(options.seed||1337,engine.world);
    this.time=0;
    // Per-pass GPU-side timings are not available without a rare extension, so
    // the overlay reports CPU time spent issuing each pass, which is what the
    // main thread actually loses.
    // CPU time spent issuing each pass. GL commands are asynchronous, so on a
    // working GPU these are submission costs and near zero — the honest
    // whole-frame number is the interval the harness measures.
    //
    // `syncTiming` measures the whole frame including the GPU: the clock starts
    // at the top of render() and stops after a finish(), so `timings.gpu` is
    // directly comparable to the frame interval. That is the number that says
    // whether a run is at its ceiling or merely at the monitor's — a frame
    // interval of 4.2 ms with 1 ms of work in it has four times the headroom
    // and looks identical without this. It destroys pipelining, so it is a
    // diagnostic rather than a mode to benchmark in.
    this.timings={gbuffer:0,lights:0,particles:0,bloom:0,composite:0,upload:0,entities:0,gpu:0};
    this.syncTiming=false;

    const gl=this.gl;
    this.quad=createQuad(gl);
    this.programs={
      gbuffer:createProgram(gl,S.GBUFFER_VS,S.GBUFFER_FS,'gbuffer'),
      light:createProgram(gl,S.LIGHT_VS,S.LIGHT_FS,'light'),
      ambient:createProgram(gl,FULLSCREEN_VS,S.AMBIENT_FS,'ambient'),
      particle:createProgram(gl,S.PARTICLE_VS,S.PARTICLE_FS,'particle'),
      bright:createProgram(gl,FULLSCREEN_VS,S.BRIGHT_FS,'bright'),
      blur:createProgram(gl,FULLSCREEN_VS,S.BLUR_FS,'blur'),
      composite:createProgram(gl,FULLSCREEN_VS,S.COMPOSITE_FS,'composite')
    };

    this.buildPropBuffers();
    this.buildLightBuffers();
    this.buildParticleBuffers();
    this.buildEntityLayer();
    this.targets={};
    // Declared before resize(), which creates it on first call.
    this.gbufferFbo=null;
    this.resize(canvas.width,canvas.height);
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
    const max=this.scene.lights.length+64;   // headroom for combat lights
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

  // The offscreen 2D surface the production sprite code draws onto.
  buildEntityLayer(){
    const gl=this.gl;
    this.entityCanvas=document.createElement('canvas');
    this.entityCtx=this.entityCanvas.getContext('2d');
    this.entityTexture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,this.entityTexture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.entityTextureSize={w:0,h:0};
  }

  resize(width,height){
    if(this.failed)return;
    const gl=this.gl;
    this.width=width;this.height=height;
    // The G-buffer and lighting run at a scale the presets control: fill rate
    // is the whole cost of this pipeline, and resolution is the one dial that
    // moves it linearly.
    const scale=this.quality.renderScale??1;
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

    // The G-buffer writes two attachments from one pass.
    if(!this.gbufferFbo)this.gbufferFbo=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.gbufferFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.targets.albedo.texture,0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,this.targets.surface.texture,0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);

    this.entityCanvas.width=width;
    this.entityCanvas.height=height;
  }

  // World to clip. Matches the production camera exactly so the two renderers
  // can be compared frame for frame.
  viewMatrix(){
    const camera=this.engine.camera;
    const zoom=camera.zoom;
    const sx=2*zoom/this.width;
    const sy=-2*zoom/this.height;
    return new Float32Array([
      sx,0,0,
      0,sy,0,
      -camera.x*sx,-camera.y*sy,1
    ]);
  }

  invViewMatrix(){
    const camera=this.engine.camera;
    const zoom=camera.zoom;
    const sx=2*zoom/this.width;
    const sy=-2*zoom/this.height;
    return new Float32Array([
      1/sx,0,0,
      0,1/sy,0,
      camera.x,camera.y,1
    ]);
  }

  // ---- lights -------------------------------------------------------------

  // Scene lights plus everything the fight is producing. Culled to the view,
  // because a light off screen still costs a draw call and a buffer slot.
  collectLights(){
    const engine=this.engine;
    const camera=engine.camera;
    const t=this.time;
    const data=this.lightData,color=this.lightColor;
    const max=data.length/4;
    let n=0;
    const halfW=this.width/(2*camera.zoom)+400;
    const halfH=this.height/(2*camera.zoom)+400;
    const push=(x,y,radius,r,g,b,intensity,z)=>{
      if(n>=max)return;
      if(Math.abs(x-camera.x)>halfW+radius||Math.abs(y-camera.y)>halfH+radius)return;
      data[n*4]=x;data[n*4+1]=y;data[n*4+2]=radius;data[n*4+3]=z;
      color[n*4]=r;color[n*4+1]=g;color[n*4+2]=b;color[n*4+3]=intensity;
      n++;
    };

    if(this.quality.sceneLights!==false){
      for(const L of this.scene.lights){
        let intensity=L.intensity;
        if(L.kind===LIGHT.flicker){
          intensity*=.72+.28*Math.sin(t*L.speed*6+L.phase)*Math.sin(t*L.speed*11+L.phase*2);
        }else if(L.kind===LIGHT.pulse){
          intensity*=.6+.4*Math.sin(t*L.speed*2+L.phase);
        }else if(L.kind===LIGHT.strobe){
          intensity*=Math.sin(t*L.speed+L.phase)>.55?1.6:.08;
        }else if(L.kind===LIGHT.rotate){
          // A sweeping beacon: bright as the beam comes round, dim behind it.
          const sweep=(Math.sin(t*L.speed+L.phase)+1)/2;
          intensity*=.1+Math.pow(sweep,3)*1.9;
        }
        push(L.x,L.y,L.radius,L.r,L.g,L.b,intensity,L.z);
      }
    }

    if(this.quality.combatLights!==false){
      const op=engine.operative;
      push(engine.player.x,engine.player.y,240,...hexToRgb(op.color),.85,26);
      for(const p of engine.projectiles){
        push(p.x,p.y,p.heavy?140:90,...hexToRgb(p.color||'#ffe08a'),1.1,14);
      }
      for(const p of engine.enemyProjectiles){
        push(p.x,p.y,80,...hexToRgb(p.color||'#ff8a5c'),.9,14);
      }
      // Every ring the effects system spawns becomes a light. That covers
      // muzzle flashes, impacts and explosions in one rule, because Fx.muzzle
      // and Fx.explosion both emit a ring — and the flash lighting the wall
      // beside the operative is the single most effective thing in this whole
      // experiment for making a firefight feel physical.
      for(const ring of engine.fx.rings.active){
        const life=Math.max(0,ring.life/ring.maxLife);
        push(ring.x,ring.y,ring.radius*2.2+60,...hexToRgb(ring.color||'#ffb35c'),2.4*life,24);
      }
    }
    this.lightCount=n;
    return n;
  }

  // ---- particles ----------------------------------------------------------

  collectParticles(){
    const engine=this.engine;
    const camera=this.engine.camera;
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
      // Fx tags particles 'circle' or 'square'; glowing ones are the hot
      // sparks and the rest is debris.
      const kind=p.glow?2:p.kind==='circle'?0:3;
      push(p.x,p.y,p.size*(kind===1?4.5:1.8),kind,r*1.4,g*1.4,b*1.4,life*(kind===1?.5:.95));
    }
    // Ambient atmosphere: steam, drifting dust, vent exhaust. Simulated here
    // rather than in the engine so the production simulation is untouched.
    if(this.quality.atmosphere!==false){
      for(const m of this.motes)push(m.x,m.y,m.size,m.kind,m.r,m.g,m.b,m.a*m.fade);
    }
    this.particleCount=n;
    return n;
  }

  // A self-contained atmosphere system, pooled and fixed size, that belongs to
  // the renderer rather than to the simulation.
  initAtmosphere(emitterList){
    this.emitters=emitterList;
    this.motes=[];
    const budget=this.quality.atmosphereCount??900;
    for(let i=0;i<budget;i++){
      this.motes.push({x:0,y:0,vx:0,vy:0,size:1,kind:1,r:1,g:1,b:1,a:0,fade:0,life:0,maxLife:1});
    }
    this.moteCursor=0;
  }

  updateAtmosphere(dt){
    if(!this.motes||this.quality.atmosphere===false)return;
    for(const m of this.motes){
      if(m.life<=0)continue;
      m.life-=dt;
      m.x+=m.vx*dt;m.y+=m.vy*dt;
      m.vx*=.985;m.vy*=.985;
      m.size+=dt*(m.kind===1?26:2);
      m.fade=Math.max(0,m.life/m.maxLife);
    }
    const camera=this.engine.camera;
    const spawn=(x,y,kind,scale)=>{
      const m=this.motes[this.moteCursor];
      this.moteCursor=(this.moteCursor+1)%this.motes.length;
      m.x=x+(Math.random()-.5)*24;
      m.y=y+(Math.random()-.5)*24;
      if(kind==='steam'){
        m.vx=(Math.random()-.5)*30;m.vy=-18-Math.random()*26;
        m.size=8*scale;m.kind=1;m.r=.5;m.g=.58;m.b=.62;m.a=.32;
        m.maxLife=m.life=1.6+Math.random()*1.4;
      }else if(kind==='smoke'){
        m.vx=(Math.random()-.5)*16;m.vy=-8-Math.random()*14;
        m.size=12*scale;m.kind=1;m.r=.16;m.g=.16;m.b=.18;m.a=.4;
        m.maxLife=m.life=2.4+Math.random()*2;
      }else if(kind==='glow'){
        m.vx=(Math.random()-.5)*20;m.vy=-6-Math.random()*18;
        m.size=3*scale;m.kind=2;m.r=.35;m.g=1;m.b=.95;m.a=.75;
        m.maxLife=m.life=1.2+Math.random();
      }else{                                   // drifting dust
        m.vx=(Math.random()-.5)*14;m.vy=(Math.random()-.5)*10;
        m.size=1.4;m.kind=3;m.r=.6;m.g=.62;m.b=.6;m.a=.16;
        m.maxLife=m.life=3+Math.random()*3;
      }
      m.fade=1;
    };
    const rate=this.quality.atmosphereRate??1;
    for(const e of this.emitters||[]){
      if(Math.abs(e.x-camera.x)>1600||Math.abs(e.y-camera.y)>1200)continue;
      if(Math.random()<e.rate*dt*rate)spawn(e.x,e.y,e.kind,e.scale);
    }
    // Dust across the visible area, so empty floor is never truly empty.
    const dust=Math.round(6*rate);
    for(let i=0;i<dust;i++){
      if(Math.random()<dt*4){
        spawn(camera.x+(Math.random()-.5)*1800,camera.y+(Math.random()-.5)*1300,'dust',1);
      }
    }
  }

  // ---- frame --------------------------------------------------------------

  render(dt){
    if(this.failed)return;
    const gl=this.gl;
    const q=this.quality;
    this.time+=dt;
    this.updateAtmosphere(dt);

    const view=this.viewMatrix();
    const frameStart=performance.now();
    let mark=frameStart;

    // 1. G-buffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.gbufferFbo);
    gl.viewport(0,0,this.internalWidth,this.internalHeight);
    gl.disable(gl.BLEND);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const gp=this.programs.gbuffer;
    gl.useProgram(gp.program);
    gl.uniformMatrix3fv(gp.uniforms.uView,false,view);
    gl.uniform1f(gp.uniforms.uTime,this.time);
    gl.uniform1f(gp.uniforms.uDetail,q.materialDetail===false?0:1);
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
    const amb=q.ambient??.10;
    gl.uniform3f(ap.uniforms.uAmbient,amb*.85,amb*.95,amb*1.15);
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

    // 6. Entities, drawn by the production sprite code, then uploaded.
    mark=performance.now();
    this.drawEntityLayer();
    this.timings.entities=performance.now()-mark;
    mark=performance.now();
    gl.bindTexture(gl.TEXTURE_2D,this.entityTexture);
    if(this.entityTextureSize.w!==this.entityCanvas.width||
       this.entityTextureSize.h!==this.entityCanvas.height){
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.entityCanvas);
      this.entityTextureSize={w:this.entityCanvas.width,h:this.entityCanvas.height};
    }else{
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,this.entityCanvas);
    }
    this.timings.upload=performance.now()-mark;

    // 7. Composite to the screen.
    mark=performance.now();
    bindTarget(gl,null);
    const cp=this.programs.composite;
    gl.useProgram(cp.program);
    useTexture(gl,0,this.targets.lit.texture,cp.uniforms.uScene);
    useTexture(gl,1,this.targets.bloomA.texture,cp.uniforms.uBloom);
    useTexture(gl,2,this.entityTexture,cp.uniforms.uEntities);
    gl.uniform1f(cp.uniforms.uBloomAmount,q.bloom===false?0:(q.bloomAmount??.85));
    gl.uniform1f(cp.uniforms.uTime,this.time);
    gl.uniform1f(cp.uniforms.uGrain,q.grain??.04);
    gl.uniform1f(cp.uniforms.uVignette,q.vignette??.85);
    gl.uniform1f(cp.uniforms.uScanline,q.scanline??.35);
    gl.uniform1f(cp.uniforms.uExposure,q.exposure??1.25);
    gl.bindVertexArray(this.quad.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.bindVertexArray(null);
    this.timings.composite=performance.now()-mark;

    if(this.syncTiming){
      gl.finish();
      this.timings.gpu=performance.now()-frameStart;
    }
  }

  // Reuses the production renderer's own entity passes. No sprite is
  // reimplemented, so a hostile looks exactly as it does in the shipping game.
  drawEntityLayer(){
    const ctx=this.entityCtx;
    const engine=this.engine;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,this.entityCanvas.width,this.entityCanvas.height);
    engine.camera.apply(ctx);
    const proxy=this.spriteProxy;
    if(proxy){
      proxy.drawGroundEffects(ctx);
      proxy.drawEntities(ctx);
      proxy.drawProjectiles(ctx);
      proxy.drawBeams(ctx);
      if(this.quality.engineParticles!==false)proxy.drawParticles(ctx);
    }
    ctx.restore();
  }

  dispose(){
    if(this.failed)return;
    const gl=this.gl;
    for(const key of Object.keys(this.targets||{})){
      gl.deleteTexture(this.targets[key].texture);
      gl.deleteFramebuffer(this.targets[key].framebuffer);
    }
    for(const key of Object.keys(this.programs||{}))gl.deleteProgram(this.programs[key].program);
    gl.deleteTexture(this.entityTexture);
    const ext=gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}

const hexCache=new Map();
function hexToRgb(hex){
  let v=hexCache.get(hex);
  if(v)return v;
  const s=String(hex||'#ffffff').replace('#','');
  const n=parseInt(s.length===3?s.split('').map(c=>c+c).join(''):s,16);
  v=[((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255];
  hexCache.set(hex,v);
  return v;
}
