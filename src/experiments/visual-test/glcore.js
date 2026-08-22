// Minimal WebGL2 helpers for the visual test.
//
// Deliberately small and dependency-free: the point of this experiment is to
// find out what the browser can do for RED STATIC, not to adopt a rendering
// library. Nothing in here is imported by the production game.

// `capture` keeps the drawing buffer readable so a screenshot tool can see the
// frame. It costs a copy every frame, so it is opt-in via ?vtcapture=1 and off
// for any run whose numbers matter.
export function createContext(canvas,{capture=false}={}){
  const gl=canvas.getContext('webgl2',{
    alpha:false,
    antialias:false,        // resolved by the composite pass instead
    depth:false,
    stencil:false,
    premultipliedAlpha:false,
    powerPreference:'high-performance',
    preserveDrawingBuffer:capture
  });
  if(!gl)return null;
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  return gl;
}

// What the machine actually is. Reported in the overlay because a performance
// number without it is meaningless — a software rasteriser and a discrete GPU
// are the same API and three orders of magnitude apart.
export function describe(gl){
  if(!gl)return{ok:false,renderer:'none',vendor:'none',software:false};
  const dbg=gl.getExtension('WEBGL_debug_renderer_info');
  const renderer=dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  const vendor=dbg?gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR);
  return{
    ok:true,renderer,vendor,
    version:gl.getParameter(gl.VERSION),
    maxTexture:gl.getParameter(gl.MAX_TEXTURE_SIZE),
    floatBuffers:!!gl.getExtension('EXT_color_buffer_float'),
    // SwiftShader and llvmpipe shade every fragment on the CPU. Fill-heavy
    // work — which all of this is — behaves nothing like it does on a GPU.
    software:/swiftshader|llvmpipe|software|basic render/i.test(String(renderer))
  };
}

function compile(gl,type,source,label){
  const shader=gl.createShader(type);
  gl.shaderSource(shader,source);
  gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
    const log=gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`[visual-test] ${label} shader failed:\n${log}\n${numbered(source)}`);
  }
  return shader;
}

const numbered=src=>src.split('\n').map((l,i)=>`${String(i+1).padStart(3)}| ${l}`).join('\n');

export function createProgram(gl,vertexSource,fragmentSource,label='program'){
  const program=gl.createProgram();
  const vs=compile(gl,gl.VERTEX_SHADER,vertexSource,`${label} vertex`);
  const fs=compile(gl,gl.FRAGMENT_SHADER,fragmentSource,`${label} fragment`);
  gl.attachShader(program,vs);
  gl.attachShader(program,fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
    const log=gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`[visual-test] ${label} link failed:\n${log}`);
  }
  // Uniform locations resolved once. Looking them up per draw is a
  // surprisingly large slice of a frame with this many passes.
  const uniforms={};
  const count=gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);
  for(let i=0;i<count;i++){
    const info=gl.getActiveUniform(program,i);
    const name=info.name.replace(/\[0\]$/,'');
    uniforms[name]=gl.getUniformLocation(program,name);
  }
  return{program,uniforms,label};
}

// A render target. `float` asks for half-float, which the bloom chain wants so
// bright pixels can exceed 1.0 and still carry colour.
export function createTarget(gl,width,height,{float=false,filter='linear'}={}){
  const texture=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,texture);
  const mode=filter==='nearest'?gl.NEAREST:gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mode);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,mode);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const internal=float?gl.RGBA16F:gl.RGBA8;
  const type=float?gl.HALF_FLOAT:gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D,0,internal,width,height,0,gl.RGBA,type,null);
  const framebuffer=gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  if(status!==gl.FRAMEBUFFER_COMPLETE){
    throw new Error(`[visual-test] framebuffer incomplete (0x${status.toString(16)}) at ${width}x${height}`);
  }
  return{texture,framebuffer,width,height,float};
}

export function resizeTarget(gl,target,width,height){
  if(target.width===width&&target.height===height)return target;
  gl.bindTexture(gl.TEXTURE_2D,target.texture);
  const internal=target.float?gl.RGBA16F:gl.RGBA8;
  const type=target.float?gl.HALF_FLOAT:gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D,0,internal,width,height,0,gl.RGBA,type,null);
  target.width=width;target.height=height;
  return target;
}

// A unit quad shared by every full-screen pass.
export function createQuad(gl){
  const vao=gl.createVertexArray();
  const buffer=gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.bindVertexArray(null);
  return{vao,buffer};
}

export const FULLSCREEN_VS=`#version 300 es
layout(location=0) in vec2 aCorner;
out vec2 vUv;
void main(){
  vUv=aCorner;
  gl_Position=vec4(aCorner*2.0-1.0,0.0,1.0);
}`;

export function bindTarget(gl,target){
  gl.bindFramebuffer(gl.FRAMEBUFFER,target?target.framebuffer:null);
  const w=target?target.width:gl.drawingBufferWidth;
  const h=target?target.height:gl.drawingBufferHeight;
  gl.viewport(0,0,w,h);
  return{w,h};
}

export function useTexture(gl,unit,texture,location){
  gl.activeTexture(gl.TEXTURE0+unit);
  gl.bindTexture(gl.TEXTURE_2D,texture);
  if(location)gl.uniform1i(location,unit);
}
