// Shader sources for the deferred renderer, kept apart from the plumbing so
// the pipeline in deferred.js stays readable.
//
// Every surface here is procedural. There is not one image file in the GL
// path: materials are generated from position and a handful of per-prop
// parameters, which keeps it original to RED STATIC, keeps the download at
// zero, and makes it trivial to see what each material costs by switching one
// branch off.
//
// Materials 0-14 are the built interior set the Blacksite experiment started
// from. 15-21 are the outdoor set the other nine theatres needed: ground,
// water, foliage, roadway, rock, snow and molten slag. Which of them a
// theatre uses is decided in dressing.js, not here.

// ---------------------------------------------------------------------------
// Shared noise. Cheap value noise — a hash and two mixes — rather than
// gradient noise, because this is called several times per fragment across a
// full screen and the difference is not visible under grime.
// ---------------------------------------------------------------------------
const NOISE=`
float hash21(vec2 p){
  p=fract(p*vec2(123.34,345.45));
  p+=dot(p,p+34.345);
  return fract(p.x*p.y);
}
float valueNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.0-2.0*f);
  float a=hash21(i),b=hash21(i+vec2(1.0,0.0));
  float c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float fbm(vec2 p){
  float v=0.0,a=0.5;
  for(int i=0;i<4;i++){v+=a*valueNoise(p);p*=2.03;a*=0.5;}
  return v;
}
float boxEdge(vec2 uv,vec2 px){
  vec2 d=min(uv,1.0-uv)/max(px,vec2(1e-4));
  return min(d.x,d.y);
}`;

// ---------------------------------------------------------------------------
// G-buffer: one instanced quad per prop, writing albedo/roughness and
// normal/height/emissive. Deferred rather than forward because the room has
// more than fifty lights and forward shading would multiply every material
// branch by every light touching it.
// ---------------------------------------------------------------------------
export const GBUFFER_VS=`#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aRect;      // x, y, halfWidth, halfHeight
layout(location=2) in vec4 aColor;     // rgb albedo, a roughness
layout(location=3) in vec4 aParams;    // material, emissive, height, rotation
layout(location=4) in vec2 aExtra;     // phase, animation flag
uniform mat3 uView;
// Instances below this index are skipped. It exists for one case: a theatre
// with an authored floor blits that floor into the G-buffer instead, and its
// procedural floor plates — which are always the first instances — must not
// paint over it.
uniform int uSkip;
out vec2 vUv;
out vec2 vWorld;
out vec4 vColor;
out vec4 vParams;
out vec2 vExtra;
out vec2 vHalf;
void main(){
  if(gl_InstanceID<uSkip){
    // Off-screen and degenerate: clipped before it costs a fragment.
    gl_Position=vec4(2.0,2.0,2.0,1.0);
    return;
  }
  vUv=aCorner;
  vec2 local=(aCorner-0.5)*2.0*aRect.zw;
  float c=cos(aParams.w),s=sin(aParams.w);
  vec2 rotated=vec2(local.x*c-local.y*s,local.x*s+local.y*c);
  vec2 world=aRect.xy+rotated;
  vWorld=world;
  vColor=aColor;
  vParams=aParams;
  vExtra=aExtra;
  vHalf=aRect.zw;
  vec3 clip=uView*vec3(world,1.0);
  gl_Position=vec4(clip.xy,0.0,1.0);
}`;

export const GBUFFER_FS=`#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vWorld;
in vec4 vColor;
in vec4 vParams;
in vec2 vExtra;
in vec2 vHalf;
uniform float uTime;
uniform float uDetail;       // 0 flat, 1 full material detail
layout(location=0) out vec4 oAlbedo;   // rgb albedo, a roughness
layout(location=1) out vec4 oSurface;  // rg normal.xy, b height, a emissive
${NOISE}

// Height is carried through to the lighting pass, which differences it to get
// a normal. Writing the height rather than a baked normal means an edge is
// sharp at any zoom and costs nothing extra to author.
void main(){
  int mat=int(vParams.x+0.5);
  float phase=vExtra.x;
  float anim=vExtra.y;
  vec3 albedo=vColor.rgb;
  float rough=vColor.a;
  float emissive=vParams.y;
  float height=vParams.z;
  vec2 uv=vUv;
  vec2 world=vWorld;

  if(uDetail>0.5){
    if(mat==0){                                   // worn floor plate
      float seam=1.0-smoothstep(0.0,0.035,min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y)));
      float grime=fbm(world*0.035+phase);
      float scuff=fbm(world*0.18+phase*2.0);
      albedo*=0.72+grime*0.5;
      albedo=mix(albedo,albedo*0.55,seam*0.85);
      albedo+=vec3(0.02,0.018,0.014)*scuff;
      rough=clamp(rough+scuff*0.3-grime*0.2,0.05,1.0);
      height=mix(height,height-2.0,seam);
      // Rivets at the plate corners.
      vec2 rc=abs(uv-0.5);
      float rivet=smoothstep(0.44,0.47,max(rc.x,rc.y))*step(0.42,min(rc.x,rc.y));
      height+=rivet*1.5;
      albedo+=rivet*0.05;
    }else if(mat==1){                             // grating over a void
      vec2 g=fract(world*0.09);
      float bar=step(0.72,g.x)+step(0.86,g.y);
      float open=1.0-clamp(bar,0.0,1.0);
      albedo=mix(albedo*0.18,albedo*1.35,1.0-open);
      height=mix(-6.0,height+3.0,1.0-open);
      rough=mix(0.95,0.35,1.0-open);
    }else if(mat==2){                             // hazard paint
      float d=fract((world.x+world.y)*0.05);
      float stripe=step(0.5,d);
      vec3 warn=mix(vec3(0.55,0.4,0.05),vec3(0.07,0.07,0.075),stripe);
      float worn=fbm(world*0.22+phase);
      albedo=mix(warn,albedo*0.5,worn*0.55);
      rough=0.9;
    }else if(mat==3){                             // wall panel
      vec2 p=fract(world*0.014);
      float panel=1.0-smoothstep(0.0,0.05,min(min(p.x,1.0-p.x),min(p.y,1.0-p.y)));
      float grime=fbm(world*0.05+phase);
      albedo*=0.8+grime*0.45;
      albedo=mix(albedo,albedo*0.6,panel*0.7);
      // Top edge catches the overheads, which is what makes a wall read as
      // standing up rather than painted on.
      float lip=smoothstep(0.78,1.0,uv.y);
      albedo+=lip*0.16;
      height=mix(height,height+8.0,lip);
      rough=clamp(rough-lip*0.25,0.05,1.0);
    }else if(mat==4){                             // pipe
      float across=abs(uv.y-0.5)*2.0;
      float round_=sqrt(max(0.0,1.0-across*across));
      albedo*=0.55+round_*0.85;
      height=height*round_;
      rough=clamp(rough*(1.2-round_*0.6),0.03,1.0);
      float band=step(0.94,fract(world.x*0.02+phase));
      albedo=mix(albedo,albedo*0.5,band);
    }else if(mat==5){                             // vent louvres
      float l=fract(uv.y*7.0);
      float slat=smoothstep(0.35,0.5,l);
      albedo*=0.4+slat*0.9;
      height=mix(height-4.0,height,slat);
      rough=0.65;
    }else if(mat==6){                             // machinery
      float lines=step(0.9,fract(uv.x*6.0))+step(0.93,fract(uv.y*4.0));
      albedo*=0.85+clamp(lines,0.0,1.0)*0.4;
      float grime=fbm(world*0.06+phase);
      albedo*=0.75+grime*0.5;
      // A slow thermal cycle across the casing.
      if(anim>0.5){
        float cycle=0.5+0.5*sin(uTime*0.7+phase);
        albedo+=vec3(0.06,0.02,0.0)*cycle;
      }
      float bevel=1.0-smoothstep(0.0,0.09,boxEdge(uv,vec2(1.0)));
      height=mix(height,height*0.55,bevel);
      rough=clamp(rough+grime*0.25,0.05,1.0);
    }else if(mat==7){                             // monitor
      float scan=0.5+0.5*sin((uv.y+uTime*0.25+phase)*80.0);
      float rows=step(0.5,fract(uv.y*9.0-uTime*0.6+phase));
      float chatter=step(0.6,hash21(floor(vec2(uv.x*14.0,uv.y*9.0-uTime*0.6+phase))));
      vec3 glow=vColor.rgb*(0.4+rows*chatter*1.6);
      albedo=glow;
      emissive=vParams.y*(0.55+rows*chatter*0.9)*(0.85+scan*0.15);
      // Bezel.
      float edge=1.0-step(0.06,boxEdge(uv,vec2(1.0)));
      albedo=mix(albedo,vec3(0.05),edge);
      emissive*=1.0-edge;
      rough=0.2;
    }else if(mat==8){                             // control panel
      float blink=step(0.5,fract(uTime*(0.6+phase*0.02)+phase));
      emissive=vParams.y*(0.5+blink*0.8);
      albedo=vColor.rgb;
      rough=0.25;
    }else if(mat==9){                             // crate
      float bevel=1.0-smoothstep(0.0,0.13,boxEdge(uv,vec2(1.0)));
      float grain=fbm(world*0.3+phase);
      albedo*=0.72+grain*0.55;
      albedo=mix(albedo,albedo*1.5,bevel*0.5);
      // Diagonal strapping.
      float strap=step(0.96,fract((uv.x+uv.y)*3.0));
      albedo=mix(albedo,vec3(0.1,0.1,0.11),strap);
      height=mix(height,height*0.4,bevel);
      rough=0.8;
    }else if(mat==10){                            // cable
      float across=abs(uv.y-0.5)*2.0;
      albedo*=0.5+sqrt(max(0.0,1.0-across*across))*0.7;
      rough=0.95;
    }else if(mat==11){                            // stencilled signage
      float glyph=step(0.55,hash21(floor(vec2(uv.x*7.0,uv.y*2.0))+phase));
      albedo=mix(albedo*0.25,albedo,glyph);
      emissive=vParams.y*glyph;
      rough=0.9;
    }else if(mat==12){                            // containment cylinder
      vec2 c=uv-0.5;
      float r=length(c)*2.0;
      if(r>1.0)discard;
      float dome=sqrt(max(0.0,1.0-r*r));
      float fluid=fbm(vec2(world.x*0.05,world.y*0.05-uTime*0.4)+phase);
      albedo=vColor.rgb*(0.5+fluid*1.1);
      emissive=vParams.y*(0.6+fluid*0.9)*dome;
      height=height*dome;
      rough=0.1;
      // Rim highlight where the glass turns away.
      albedo+=pow(1.0-dome,3.0)*0.5;
      // A bolted metal collar. Without it the cylinder is a soft pale disc on
      // the floor, which at gameplay zoom reads as a rendering artefact rather
      // than as a piece of plant.
      float collar=smoothstep(0.82,0.90,r);
      float bolt=step(0.55,fract(atan(c.y,c.x)*2.55));
      albedo=mix(albedo,vec3(0.15,0.16,0.18)*(0.8+bolt*1.0),collar);
      emissive*=1.0-collar;
      rough=mix(rough,0.55,collar);
      height=mix(height,height*0.4+8.0,collar);
    }else if(mat==13){                            // light fixture
      float live=1.0;
      if(anim>0.5)live=0.55+0.45*sin(uTime*2.6+phase*3.0);
      emissive=vParams.y*live;
      albedo=vColor.rgb*live;
      rough=0.3;
    }else if(mat==14){                            // standing water
      // Broken edge, because a perfect ellipse of water on a floor reads as a
      // decal someone forgot to mask.
      vec2 c=uv-0.5;
      if(length(c)+fbm(uv*6.0+phase)*0.22-0.14>0.5)discard;
      float ripple=fbm(world*0.09+vec2(uTime*0.15,uTime*0.11)+phase);
      albedo=vColor.rgb*(0.4+ripple*0.5);
      rough=0.03+ripple*0.06;
      // A wet surface reads by being smoother than everything around it and
      // by lifting a little, so the lighting pass finds a highlight on it.
      height=1.5+ripple*1.5;
    }else if(mat==15){                            // open ground
      // Soil, mud, gravel, snowpack — anything outdoors that is not built.
      // No seams and no rivets: the whole read is broad low-frequency
      // mottling plus a fine grain, which is what stops a five-hundred-metre
      // valley floor from looking like one flat fill.
      float broad=fbm(world*0.008+phase);
      float mid=fbm(world*0.045+phase*1.7);
      float grain=valueNoise(world*0.55);
      albedo*=0.70+broad*0.55+mid*0.22;
      albedo+=vec3(0.014,0.013,0.011)*grain;
      rough=clamp(rough+mid*0.25-broad*0.12,0.2,1.0);
      height+=(broad-0.5)*3.0;
    }else if(mat==16){                            // sheet water
      // Rectangular standing water: flooded street, tidal flat, marsh. Two
      // ripple fields crossing at different speeds so the surface never
      // resolves into a repeating pattern.
      float a=fbm(world*0.055+vec2(uTime*0.13,uTime*0.09)+phase);
      float b=fbm(world*0.021-vec2(uTime*0.07,uTime*0.05)+phase*2.0);
      float surf=a*0.6+b*0.4;
      albedo=vColor.rgb*(0.35+surf*0.75);
      // The specular read is the whole point of water, so it stays very
      // smooth and lifts slightly out of the ground plane.
      rough=0.04+surf*0.07;
      height=2.0+surf*2.5;
      // Wind chop catching the light in lines.
      float chop=smoothstep(0.72,0.85,fbm(world*0.14+vec2(uTime*0.4,0.0)));
      albedo+=chop*0.10;
      rough=mix(rough,0.02,chop);
    }else if(mat==17){                            // foliage
      // Canopy and scrub. A soft-edged clump rather than a box, because a
      // rectangular bush is the single most obvious tell that a scene is
      // instanced quads.
      vec2 c=(uv-0.5)*2.0;
      float edge=length(c)+fbm(uv*7.0+phase)*0.45-0.30;
      if(edge>1.0)discard;
      float dome=sqrt(max(0.0,1.0-clamp(edge,0.0,1.0)));
      float leaf=fbm(world*0.32+phase);
      float clump=fbm(world*0.09+phase*3.0);
      albedo*=0.55+leaf*0.7+clump*0.35;
      // Underside darkens, so a canopy reads as having volume under it.
      albedo*=0.45+dome*0.85;
      rough=0.92;
      height=height*dome;
    }else if(mat==18){                            // roadway deck
      // Asphalt and poured concrete: the bridge, the hangar apron, platform
      // decking. Expansion joints on a coarse grid and cracks between them.
      vec2 j=fract(world*0.006+phase*0.01);
      float joint=1.0-smoothstep(0.0,0.03,min(min(j.x,1.0-j.x),min(j.y,1.0-j.y)));
      float wear=fbm(world*0.05+phase);
      float crack=smoothstep(0.62,0.66,fbm(world*0.13+phase*2.0));
      albedo*=0.78+wear*0.42;
      albedo=mix(albedo,albedo*0.45,joint*0.8);
      albedo=mix(albedo,albedo*0.35,crack*0.5);
      rough=clamp(0.82+wear*0.18-crack*0.1,0.2,1.0);
      height=mix(height,height-1.5,max(joint,crack));
    }else if(mat==19){                            // rock
      // Boulders, ridge stone, rubble. Domed with a faceted noise break-up so
      // the silhouette is not a circle.
      vec2 c=(uv-0.5)*2.0;
      float r=length(c)*(0.82+fbm(uv*5.0+phase)*0.34);
      if(r>1.0)discard;
      float dome=sqrt(max(0.0,1.0-r*r));
      float facet=fbm(world*0.11+phase);
      float grit=valueNoise(world*0.7);
      albedo*=0.6+facet*0.7;
      albedo+=vec3(0.02)*grit;
      albedo*=0.5+dome*0.8;
      rough=clamp(0.75+grit*0.2,0.3,1.0);
      height=height*dome;
    }else if(mat==20){                            // snow and ice
      // Bright, near-white, and the one material in the set that is mostly
      // about the highlight: wind-packed drift with a specular sparkle and a
      // few scoured patches showing what is underneath.
      float drift=fbm(world*0.018+phase);
      float ridge=fbm(world*0.07+phase*1.4);
      float sparkle=step(0.985,hash21(floor(world*1.6)));
      albedo*=0.88+drift*0.35;
      albedo+=vec3(0.06,0.07,0.09)*ridge;
      albedo+=sparkle*0.55;
      // Scoured to the ground where the wind has run.
      float scour=smoothstep(0.66,0.74,fbm(world*0.032-phase));
      albedo=mix(albedo,albedo*0.5,scour*0.6);
      rough=clamp(0.55-ridge*0.3+scour*0.35,0.05,1.0);
      height+=drift*4.0-scour*2.0;
    }else if(mat==21){                            // molten channel
      // Flowing slag. Emissive is driven by the flow rather than constant, so
      // the channel has hot and cooling stretches instead of glowing evenly.
      float flow=fbm(world*0.03+vec2(uTime*0.22,uTime*0.05)+phase);
      float crust=smoothstep(0.48,0.62,fbm(world*0.08-vec2(uTime*0.12,0.0)+phase));
      vec3 hot=vColor.rgb*(1.1+flow*1.4);
      vec3 cool=vColor.rgb*0.16;
      albedo=mix(hot,cool,crust*0.85);
      emissive=vParams.y*(1.0-crust*0.8)*(0.55+flow*1.1);
      rough=mix(0.35,0.85,crust);
      height=1.0+flow*2.0;
    }
  }

  // Height differences into a normal in the lighting pass; the xy here is a
  // cheap in-plane tilt so flat props still catch a raking light.
  vec2 tilt=(uv-0.5)*2.0;
  oAlbedo=vec4(albedo,rough);
  oSurface=vec4(tilt*0.5+0.5,clamp(height/64.0,0.0,1.0),clamp(emissive/4.0,0.0,1.0));
}`;

// ---------------------------------------------------------------------------
// Lighting. One instanced quad per light, sized to its radius and blended
// additively, so a light only shades the pixels it can reach. A full-screen
// loop over fifty lights shades every pixel fifty times; this shades each
// pixel once per light actually covering it.
// ---------------------------------------------------------------------------
export const LIGHT_VS=`#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aLight;    // x, y, radius, z
layout(location=2) in vec4 aColor;    // rgb, intensity
uniform mat3 uView;
out vec2 vScreen;
out vec4 vLight;
out vec4 vColor;
void main(){
  vec2 world=aLight.xy+(aCorner-0.5)*2.0*aLight.z;
  vLight=aLight;
  vColor=aColor;
  vec3 clip=uView*vec3(world,1.0);
  vScreen=clip.xy*0.5+0.5;
  gl_Position=vec4(clip.xy,0.0,1.0);
}`;

export const LIGHT_FS=`#version 300 es
precision highp float;
in vec2 vScreen;
in vec4 vLight;
in vec4 vColor;
uniform sampler2D uAlbedo;
uniform sampler2D uSurface;
uniform mat3 uInvView;
uniform vec2 uTexel;
uniform float uShadows;
out vec4 oColor;

void main(){
  vec4 albedo=texture(uAlbedo,vScreen);
  vec4 surface=texture(uSurface,vScreen);
  // Screen back to world, so distance is measured in the units the scene is
  // authored in rather than in pixels, and zoom does not change the falloff.
  vec3 w=uInvView*vec3(vScreen*2.0-1.0,1.0);
  vec2 world=w.xy;
  float height=surface.b*64.0;
  vec3 toLight=vec3(vLight.xy-world,vLight.w-height);
  float dist=length(toLight);
  float radius=vLight.z;
  if(dist>radius)discard;

  // Inverse-square, windowed so it reaches zero at the radius instead of
  // leaving a visible disc edge. The constant is tuned to the scale the sector
  // is authored at — lights with a 400-600 unit radius — and getting it an
  // order of magnitude too steep, which the first pass did, renders a fully
  // lit room as black.
  float atten=1.0/(1.0+dist*dist*0.000021);
  float window=1.0-dist/radius;
  atten*=window*window;

  // Normal from the height field. Sampling the neighbours is what turns a
  // flat quad into something with an edge the light can rake across.
  float hL=texture(uSurface,vScreen-vec2(uTexel.x,0.0)).b;
  float hR=texture(uSurface,vScreen+vec2(uTexel.x,0.0)).b;
  float hD=texture(uSurface,vScreen-vec2(0.0,uTexel.y)).b;
  float hU=texture(uSurface,vScreen+vec2(0.0,uTexel.y)).b;
  vec3 normal=normalize(vec3((hL-hR)*40.0,(hD-hU)*40.0,1.0));
  vec3 lightDir=normalize(toLight);
  float ndl=clamp(dot(normal,lightDir),0.0,1.0);
  // Half-lambert: a hard terminator on a top-down view loses the silhouette.
  ndl=ndl*0.6+0.4;

  // Specular, tightened by the material's roughness. This is what separates
  // wet floor and bare metal from painted concrete.
  float rough=max(0.04,albedo.a);
  vec3 view=vec3(0.0,0.0,1.0);
  vec3 half_=normalize(lightDir+view);
  float spec=pow(clamp(dot(normal,half_),0.0,1.0),mix(180.0,6.0,rough))*(1.0-rough);

  // A contact shadow: step toward the light and see if the height field is
  // higher along the way. Four taps is enough to ground a crate without
  // costing what a real shadow map would.
  float shadow=1.0;
  if(uShadows>0.5){
    vec2 step_=normalize(vLight.xy-world)*uTexel*7.0;
    for(int i=1;i<=4;i++){
      float h=texture(uSurface,vScreen+step_*float(i)).b*64.0;
      shadow-=step(height+3.0,h)*0.22;
    }
    shadow=clamp(shadow,0.35,1.0);
  }

  vec3 lit=albedo.rgb*vColor.rgb*vColor.a*atten*ndl*shadow;
  lit+=vColor.rgb*vColor.a*atten*spec*shadow*0.85;
  oColor=vec4(lit,1.0);
}`;

// ---------------------------------------------------------------------------
// Ambient plus emissive. One full-screen pass so unlit corners are dark but
// not black, and so glowing surfaces light themselves.
// ---------------------------------------------------------------------------
export const AMBIENT_FS=`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uAlbedo;
uniform sampler2D uSurface;
uniform vec3 uAmbient;
out vec4 oColor;
void main(){
  vec4 albedo=texture(uAlbedo,vUv);
  vec4 surface=texture(uSurface,vUv);
  float emissive=surface.a*4.0;
  vec3 c=albedo.rgb*uAmbient+albedo.rgb*emissive;
  oColor=vec4(c,1.0);
}`;

// ---------------------------------------------------------------------------
// Particles: one instanced additive quad each, the whole system in one draw.
// ---------------------------------------------------------------------------
export const PARTICLE_VS=`#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aParticle;  // x, y, size, kind
layout(location=2) in vec4 aColor;     // rgb, alpha
uniform mat3 uView;
out vec2 vUv;
out vec4 vColor;
out float vKind;
void main(){
  vUv=aCorner;
  vColor=aColor;
  vKind=aParticle.w;
  vec2 world=aParticle.xy+(aCorner-0.5)*2.0*aParticle.z;
  vec3 clip=uView*vec3(world,1.0);
  gl_Position=vec4(clip.xy,0.0,1.0);
}`;

export const PARTICLE_FS=`#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vColor;
in float vKind;
uniform float uTime;
out vec4 oColor;
${NOISE}
void main(){
  vec2 c=(vUv-0.5)*2.0;
  float r=length(c);
  if(r>1.0)discard;
  int kind=int(vKind+0.5);
  float a=vColor.a;
  if(kind==0){                       // spark: hot core, hard edge
    a*=pow(1.0-r,1.6);
  }else if(kind==1){                 // smoke / steam: soft and eaten by noise
    float n=fbm(vUv*3.0+uTime*0.2);
    a*=smoothstep(1.0,0.15,r)*(0.35+n*0.9);
  }else if(kind==2){                 // glow
    a*=pow(1.0-r,2.4);
  }else{                             // debris chip
    a*=step(r,0.85);
  }
  oColor=vec4(vColor.rgb*a,a);
}`;

// ---------------------------------------------------------------------------
// Bloom: bright-pass, then separable blur at quarter resolution.
// ---------------------------------------------------------------------------
export const BRIGHT_FS=`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform float uThreshold;
out vec4 oColor;
void main(){
  vec3 c=texture(uSource,vUv).rgb;
  float luma=dot(c,vec3(0.2126,0.7152,0.0722));
  float keep=max(0.0,luma-uThreshold)/max(luma,1e-4);
  oColor=vec4(c*keep,1.0);
}`;

export const BLUR_FS=`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uDirection;
out vec4 oColor;
// Nine taps folded into five with linear sampling.
const float W0=0.2270270270;
const float W1=0.3162162162;
const float W2=0.0702702703;
const float O1=1.3846153846;
const float O2=3.2307692308;
void main(){
  vec3 c=texture(uSource,vUv).rgb*W0;
  c+=texture(uSource,vUv+uDirection*O1).rgb*W1;
  c+=texture(uSource,vUv-uDirection*O1).rgb*W1;
  c+=texture(uSource,vUv+uDirection*O2).rgb*W2;
  c+=texture(uSource,vUv-uDirection*O2).rgb*W2;
  oColor=vec4(c,1.0);
}`;

// ---------------------------------------------------------------------------
// Composite: tonemap the lit scene, lay the Canvas 2D entity layer over it
// with a guaranteed ambient floor so hostiles never disappear into the dark,
// then the screen-space atmosphere.
// ---------------------------------------------------------------------------
export const COMPOSITE_FS=`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uEntities;
uniform float uBloomAmount;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uScanline;
uniform float uExposure;
uniform vec2 uEntityTexel;
uniform float uRim;
out vec4 oColor;
${NOISE}

// Filmic-ish curve. Reinhard alone washes the emissive surfaces out; this
// keeps the monitors and the beacons hot without clipping them to white.
vec3 tonemap(vec3 x){
  x*=uExposure;
  vec3 a=x*(2.51*x+0.03);
  vec3 b=x*(2.43*x+0.59)+0.14;
  return clamp(a/b,0.0,1.0);
}

void main(){
  vec3 scene=texture(uScene,vUv).rgb;
  scene+=texture(uBloom,vUv).rgb*uBloomAmount;
  vec3 c=tonemap(scene);

  // Entities are drawn by the existing Canvas 2D sprite code and composited
  // here. They take the scene's light, but never less than a readable floor:
  // a hostile crossing an unlit corridor is a gameplay problem, not a mood.
  vec4 ent=texture(uEntities,vUv);

  // Contrast-adaptive silhouette rim, applied outside the sprite.
  //
  // This exists because of a measured regression, not for style. Against the
  // flat floor of the Canvas 2D renderer a grey hostile has high contrast;
  // against lit, grimy, seamed plating it does not, and the composite's light
  // floor alone did not fix it. The rim samples the four neighbours' coverage,
  // finds the pixels just outside a solid silhouette, and darkens them over a
  // bright background or lightens them over a dark one. A hostile is therefore
  // separated from whatever is behind it no matter what the lighting is doing.
  if(uRim>0.0&&ent.a<0.85){
    float n=texture(uEntities,vUv+vec2(0.0,-uEntityTexel.y)).a;
    float s=texture(uEntities,vUv+vec2(0.0, uEntityTexel.y)).a;
    float w=texture(uEntities,vUv+vec2(-uEntityTexel.x,0.0)).a;
    float e=texture(uEntities,vUv+vec2( uEntityTexel.x,0.0)).a;
    float around=max(max(n,s),max(w,e));
    // Only solid things get an outline. Particles, smoke and decals are soft,
    // their coverage never reaches this, and they are left alone.
    float edge=clamp(around-ent.a,0.0,1.0)*smoothstep(0.55,0.85,around);
    if(edge>0.0){
      float bg=dot(c,vec3(0.2126,0.7152,0.0722));
      vec3 rim=mix(vec3(0.86,0.90,0.95),vec3(0.015,0.02,0.03),smoothstep(0.18,0.42,bg));
      c=mix(c,rim,edge*uRim);
    }
  }

  if(ent.a>0.001){
    float lightHere=clamp(dot(c,vec3(0.33)),0.0,1.0);
    vec3 entityLit=ent.rgb*(0.62+lightHere*0.75);
    c=mix(c,entityLit,ent.a);
  }

  if(uVignette>0.0){
    vec2 d=vUv-0.5;
    float v=1.0-dot(d,d)*uVignette;
    c*=clamp(v,0.0,1.0);
  }
  if(uScanline>0.0){
    float s=0.94+0.06*sin(vUv.y*1400.0);
    c*=mix(1.0,s,uScanline);
  }
  if(uGrain>0.0){
    float n=hash21(vUv*vec2(1920.0,1080.0)+fract(uTime)*97.0);
    c+=(n-0.5)*uGrain;
  }
  oColor=vec4(c,1.0);
}`;

// ---------------------------------------------------------------------------
// Authored-ground blit.
//
// A theatre that ships painted floor art has that art drawn by the Canvas 2D
// renderer and laid into the G-buffer here, as albedo, before anything else.
// The lighting pass then treats it exactly like a procedural surface: the
// painted floor gets per-pixel falloff, contact shadows and every muzzle flash
// that lands on it, which is strictly more than it got under Canvas 2D.
// ---------------------------------------------------------------------------
export const GROUND_FS=`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uGround;
uniform float uRoughness;
uniform float uGain;
layout(location=0) out vec4 oAlbedo;
layout(location=1) out vec4 oSurface;
void main(){
  vec4 g=texture(uGround,vec2(vUv.x,1.0-vUv.y));
  // Painted art is authored as a finished pixel under flat light. Taken as
  // albedo it would come out doubled once the lighting pass multiplies it, so
  // it is scaled back to a reflectance the fixtures then light.
  oAlbedo=vec4(g.rgb*g.a*uGain,uRoughness);
  // Flat, unlit, ground level: the floor is a plane, and the props drawn over
  // it carry all the height in the scene.
  oSurface=vec4(0.5,0.5,0.0,0.0);
}`;
