// Graphics presets and individual feature switches for the deferred renderer.
//
// Every expensive thing is separately switchable. In the game that is what
// lets one quality setting turn off the four things that actually cost
// something on a weak machine; in the visual test it is what makes it possible
// to find out what costs what, which a single slider never tells you.

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
  // Tuned against the Canvas 2D renderer in the same sector rather than by
  // eye: at 1.5 exposure the deferred path came out around 40% brighter in
  // the mean with its top decile clipping to white, which read as washed out
  // and cost the theatre its palette.
  ambient:.14,
  exposure:1.2,
  bloomAmount:.85,
  bloomThreshold:.85,
  // How much of a painted floor's own value survives into albedo. Set by
  // measurement against the Canvas 2D renderer in the same sector.
  groundGain:1.05,
  // Contrast-adaptive outline on sprite silhouettes. Not decoration: without it
  // a hostile against lit plating is harder to pick out than the same hostile
  // against the Canvas 2D renderer's flat floor.
  silhouetteRim:.75,
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
    grain:0,scanline:0,vignette:.6,ambient:.22,silhouetteRim:.7
  },
  MEDIUM:{
    ...base,
    renderScale:.8,
    lighting:true,shadows:false,sceneLights:true,combatLights:true,
    bloom:true,bloomPasses:1,particles:true,engineParticles:true,
    atmosphere:true,atmosphereCount:350,atmosphereRate:.5,
    materialDetail:true,decals:true,
    grain:.02,scanline:.2,ambient:.17
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
    grain:.05,scanline:.4,vignette:.95,ambient:.12,exposure:1.3
  }
};

export const PRESET_NAMES=['LOW','MEDIUM','HIGH','ULTRA'];

export function preset(name){
  return{...(PRESETS[name]||PRESETS.HIGH)};
}

// The game exposes one effect-density setting, shared with the Canvas 2D
// renderer, plus performance mode. This is the whole mapping from those to a
// GL preset: LOW when the player has asked for less, and never ULTRA, which
// exists to find a ceiling rather than to be played at.
export function presetForSettings(settings={}){
  if(settings.performanceMode)return preset('LOW');
  const density=settings.particles||'high';
  return preset(density==='low'?'LOW':density==='medium'?'MEDIUM':'HIGH');
}
