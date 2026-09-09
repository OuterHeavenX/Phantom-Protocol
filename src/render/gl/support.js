// Can this browser run the deferred renderer, and should it?
//
// Split out from deferred.js because the settings screen asks the question and
// has no business importing an entire renderer to get the answer.

import {createContext,describe} from './glcore.js';

// Whether this browser can run the deferred path at all, and whether it should.
// Called before a canvas is committed to a context, because a canvas gets
// exactly one context for its lifetime and probing on the real one would spend
// it.
let probed=null;
export function probeWebGL2(){
  if(probed)return probed;
  let canvas=null;
  try{
    canvas=document.createElement('canvas');
    canvas.width=canvas.height=1;
    const gl=createContext(canvas);
    if(!gl){
      probed={ok:false,reason:'WebGL2 not available',software:false,renderer:'none'};
    }else{
      const info=describe(gl);
      probed={
        ok:true,
        reason:'',
        software:info.software,
        renderer:info.renderer,
        vendor:info.vendor,
        floatBuffers:info.floatBuffers
      };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }catch(err){
    probed={ok:false,reason:String(err&&err.message||err),software:false,renderer:'none'};
  }
  return probed;
}

// What `renderer:'auto'` decides. A software rasteriser reports itself as
// WebGL2 and then shades every fragment on the CPU: the deferred path is
// entirely fill-bound, so on SwiftShader it is many times slower than the 2D
// renderer it would replace. Auto declines it.
export function shouldUseGL(settings={}){
  const choice=settings.renderer||'auto';
  if(choice==='2d')return false;
  const cap=probeWebGL2();
  if(!cap.ok)return false;
  if(choice==='gl')return true;
  return !cap.software;
}
