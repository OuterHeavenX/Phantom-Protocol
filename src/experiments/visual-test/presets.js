// Graphics presets and individual feature switches for the visual test.
//
// Every expensive thing is separately switchable, because the point of the
// experiment is to find out what costs what — a single quality slider tells
// you the frame got slower but never which effect did it.

export const TOGGLES=[
  ['lighting','Dynamic lighting','Per-pixel point lights with falloff'],
  ['shadows','Contact shadows','Height-field ray march, 4 taps per light'],
  ['sceneLights','Scene lights','The room’s own fixtures and beacons'],
  ['combatLights','Combat lights','Muzzle flashes, tracers, explosions'],
  ['bloom','Bloom','Bright-pass plus separable blur'],
  ['particles','GPU particles','Instanced additive quads'],
  ['engineParticles','2D particles','The production Canvas 2D particle pass'],
  ['atmosphere','Steam and dust','Renderer-side atmosphere system'],
  ['materialDetail','Material detail','Procedural wear, grime, seams, panels'],
  ['decals','Decals','Persistent floor staining'],
  ['grain','Film grain','Screen-space noise'],
  ['scanline','Scanlines','Screen-space banding'],
  ['vignette','Vignette','Edge darkening']
];

const base={
  renderScale:1,
  ambient:.17,
  exposure:1.5,
  bloomAmount:.85,
  bloomThreshold:.85,
  bloomPasses:2,
  atmosphereCount:900,
  atmosphereRate:1,
  grain:.04,
  scanline:.35,
  vignette:.85
};

export const PRESETS={
  LOW:{
    ...base,
    renderScale:.6,
    lighting:true,shadows:false,sceneLights:true,combatLights:false,
    bloom:false,particles:true,engineParticles:true,atmosphere:false,
    materialDetail:false,decals:false,
    atmosphereCount:0,atmosphereRate:0,
    grain:0,scanline:0,vignette:.6,ambient:.26
  },
  MEDIUM:{
    ...base,
    renderScale:.8,
    lighting:true,shadows:false,sceneLights:true,combatLights:true,
    bloom:true,bloomPasses:1,particles:true,engineParticles:true,
    atmosphere:true,atmosphereCount:350,atmosphereRate:.5,
    materialDetail:true,decals:true,
    grain:.02,scanline:.2,ambient:.2
  },
  HIGH:{
    ...base,
    renderScale:1,
    lighting:true,shadows:true,sceneLights:true,combatLights:true,
    bloom:true,bloomPasses:2,particles:true,engineParticles:true,
    atmosphere:true,atmosphereCount:900,atmosphereRate:1,
    materialDetail:true,decals:true
  },
  // Deliberately past what is sensible. This is the setting that answers
  // "where is the ceiling" rather than "what should ship".
  ULTRA:{
    ...base,
    renderScale:1,
    lighting:true,shadows:true,sceneLights:true,combatLights:true,
    bloom:true,bloomPasses:4,bloomAmount:1.1,bloomThreshold:.7,
    particles:true,engineParticles:true,
    atmosphere:true,atmosphereCount:2600,atmosphereRate:2.4,
    materialDetail:true,decals:true,
    grain:.05,scanline:.4,vignette:.95,ambient:.14,exposure:1.6
  }
};

export const PRESET_NAMES=['LOW','MEDIUM','HIGH','ULTRA'];

export function preset(name){
  return{...(PRESETS[name]||PRESETS.HIGH)};
}
