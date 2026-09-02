// Per-theatre lighting.
//
// The dressing file already gives each theatre its own fixtures, emitters and
// sky tint. What it does not give them is a *grade*: how bright the frame sits,
// how hard the falloff into shadow is, how much the edges close in, and whether
// the light is steady. Ten sectors currently share one grade, so a glacial
// basin and a sealed bunker are lit the same way with different props in them.
//
// Everything here is a multiplier on the quality preset rather than a
// replacement for it. That matters twice over: the performance and low-end
// presets keep their meaning, and no profile can make the frame darker than the
// preset was going to allow — which is the mechanism that stops atmosphere
// eating readability.
//
//   exposure  overall brightness, multiplied onto the preset
//   ambient   the flat sky term. Lower is a place lit only by its own fixtures
//   tint      [r,g,b] on the ambient. Kept close to 1 on purpose: this is a
//             temperature nudge, not a colour filter over the game
//   vignette  how much the edges close in
//   flicker   [hz, depth] on exposure. Depth is small everywhere — a frame
//             that visibly pulses is a frame you cannot read
//
// The clamps below are enforced in code, not just intended here.
export const LIGHTING={
  // Sealed, powered, and lit by strip fixtures rather than by any sky.
  blacksite:{exposure:.94,ambient:.72,tint:[.94,1,1.04],vignette:1.12,flicker:[7.3,.018]},
  // Snow bounces everything. The brightest ambient in the game, and the one
  // theatre where the ground is lighter than the things standing on it — which
  // is what gives a whiteout its hard silhouettes.
  hollow:{exposure:1.1,ambient:1.5,tint:[.97,1.01,1.08],vignette:.86,flicker:null},
  // A powered installation in the same cold light, but with a roof.
  arctic:{exposure:1.02,ambient:1.12,tint:[.95,1,1.07],vignette:.98,flicker:[5.1,.012]},
  // Roofless and wet. Open sky, but everything under it is dark.
  sunken:{exposure:.97,ambient:1.05,tint:[.93,1,1.02],vignette:1.05,flicker:null},
  // Furnace light: warm, uneven, and the only theatre where the light itself
  // reads as dangerous.
  foundry:{exposure:1.05,ambient:.8,tint:[1.1,.97,.88],vignette:1.08,flicker:[3.4,.05]},
  // Decommissioned. Very little ambient, hard local pools, deep surrounds.
  orbital:{exposure:.9,ambient:.6,tint:[.97,.98,1.06],vignette:1.18,flicker:[2.2,.03]},
  // Sustained rain under a working span. Flat, grey, even.
  crossfall:{exposure:.99,ambient:1.18,tint:[.96,.99,1.03],vignette:.95,flicker:null},
  // Fog does the vignetting for us, so the lens does less of it.
  mire:{exposure:.95,ambient:1.0,tint:[.97,1.02,.96],vignette:1.0,flicker:null},
  // Enormous, unlit, and full of holes in the roof.
  hangar:{exposure:.96,ambient:.86,tint:[1.03,1,.95],vignette:1.1,flicker:[6.7,.022]},
  // A working laboratory: bright, even, clinical, and slightly too white.
  proving:{exposure:1.06,ambient:1.05,tint:[1.01,1,1.03],vignette:.92,flicker:[9.4,.014]}
};

// How far a profile is allowed to move the frame.
//
// These are the readability guarantee, and they are enforced rather than
// documented: a profile cannot darken the sector past the point where a hostile
// stops being visible against it, however atmospheric that would be. Anyone
// tuning a theatre works inside them or does not get the change.
export const LIGHTING_LIMITS={
  exposure:[.85,1.15],
  ambient:[.5,1.6],
  tint:[.85,1.15],
  vignette:[.8,1.25],
  flickerDepth:.06
};

function clamp(value,[min,max]){return Math.min(max,Math.max(min,value))}

// A theatre's grade, clamped. Returns a neutral profile for anything unlisted,
// so a theatre added later is lit like the game rather than not lit at all.
export function lightingFor(mapId){
  const raw=LIGHTING[mapId];
  if(!raw)return{exposure:1,ambient:1,tint:[1,1,1],vignette:1,flicker:null};
  return{
    exposure:clamp(raw.exposure??1,LIGHTING_LIMITS.exposure),
    ambient:clamp(raw.ambient??1,LIGHTING_LIMITS.ambient),
    tint:(raw.tint||[1,1,1]).map(c=>clamp(c,LIGHTING_LIMITS.tint)),
    vignette:clamp(raw.vignette??1,LIGHTING_LIMITS.vignette),
    flicker:raw.flicker
      ?[raw.flicker[0],Math.min(raw.flicker[1],LIGHTING_LIMITS.flickerDepth)]
      :null
  };
}

// The exposure multiplier at a moment in time, including any flicker.
//
// Separated from the profile so the flicker is computed once per frame in one
// place rather than being reinvented by each renderer, and so a test can ask
// what the value will be without rendering anything.
//
// `reduced` is the reduce-flashing setting: a theatre that pulses is exactly
// what that setting exists to switch off, so it holds the frame steady rather
// than merely damping it.
export function exposureAt(profile,time,reduced=false){
  if(!profile)return 1;
  if(!profile.flicker||reduced)return profile.exposure;
  const [rate,depth]=profile.flicker;
  // Two incommensurate rates so the pattern does not settle into something the
  // eye can predict, which is what makes a flicker read as a failing fixture
  // rather than as an effect.
  const wave=Math.sin(time*rate)*.6+Math.sin(time*rate*2.37+1.1)*.4;
  return profile.exposure*(1+wave*depth);
}
