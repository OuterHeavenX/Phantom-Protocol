// Colour vision support.
//
// The setting has been written into every save since the settings screen
// shipped and read by absolutely nothing, which is worse than not offering it:
// a player who needs it turns it on, sees no change, and concludes the game
// does not care.
//
// This is deliberately not a full-canvas filter. Filtering everything shifts
// the theatre art too, costs a fullscreen pass on a phone, and does nothing
// about the real problem — which is not that the game is red, it is that two
// things that mean different things are the same colour.
//
// So only the handful of colours that carry *meaning* are remapped, and the
// most important distinction is reinforced with something that is not colour
// at all. See `HOSTILE_OUTLINE`.

// The semantic roles. Anything the operative has to read quickly and cannot
// afford to misread.
const BASE={
  hostile:'#ff5b5b',        // incoming fire, hostile marks
  warning:'#ffa14f',        // a telegraph: something is about to happen here
  hazard:'#ff7043',         // it is happening now
  friendly:'#76e7d4',       // the operative's own ordnance and squad
  objective:'#f5d27a',      // where to go
  pickup:'#8ffff0'          // what to take
};

// Red-green deficiencies are by far the most common, and the pair that fails
// in this game is not red against green — there is no green — but red against
// orange. Incoming fire and a hazard telegraph both land in the same muddy
// yellow-brown, which is the difference between moving and not.
//
// So hostile stays red and the warning family is pushed to a bright neutral
// yellow that separates from it by lightness as well as hue. Lightness is the
// channel every form of colour blindness keeps.
const DEUTERANOPIA={
  hostile:'#ff5b5b', warning:'#ffe066', hazard:'#ffd23f',
  friendly:'#69d7ec', objective:'#f2f2f2', pickup:'#9ad9ff'
};

// Protanopia additionally darkens reds badly, so a red that reads as urgent to
// most people reads as dim. Brightened and pushed toward orange to keep it
// salient rather than merely present.
const PROTANOPIA={
  hostile:'#ff8a5c', warning:'#ffe066', hazard:'#ffc23f',
  friendly:'#66d0ea', objective:'#f2f2f2', pickup:'#9ad9ff'
};

// Blue-yellow. Here the collision is at the other end: the cyan of friendly
// ordnance and the gold of an objective converge, so the objective moves to a
// pink that survives the deficiency and friendly stays cool.
const TRITANOPIA={
  hostile:'#ff5b5b', warning:'#ff9d9d', hazard:'#ff7043',
  friendly:'#7fd4d4', objective:'#ff8ac4', pickup:'#c9f5f5'
};

export const PALETTES={
  none:BASE, deuteranopia:DEUTERANOPIA, protanopia:PROTANOPIA, tritanopia:TRITANOPIA
};

export const COLORBLIND_MODES=[
  ['none','OFF'],
  ['deuteranopia','DEUTERAN'],
  ['protanopia','PROTAN'],
  ['tritanopia','TRITAN']
];

// A dark ring drawn around hostile projectiles whenever any mode is active.
//
// This is the part that matters most, and it is not a colour. No remap can
// make two hues reliably distinguishable for every kind of colour blindness at
// once — but a hard dark edge against a bright core is read by contrast, which
// every form of colour vision keeps. It also happens to help on a phone in
// daylight, which is a good sign that it is the right kind of fix.
export const HOSTILE_OUTLINE='rgba(8,6,10,.92)';

// The mode is a per-client display preference, so it lives here rather than
// being threaded through every draw call as an argument. Set once when settings
// are applied; read wherever a semantic colour is needed.
let active='none';

export function setColorblindMode(mode){
  active=PALETTES[mode]?mode:'none';
}

export function colorblindMode(){return active}

// True when any accommodation is on — the cue for non-colour reinforcement.
export function colorblindActive(){return active!=='none'}

// The colour for a semantic role under the active mode.
//
// Unknown roles return whatever the caller passed as a fallback rather than a
// palette entry, so this can be dropped in beside an existing literal without
// having to move every colour in the game into the table first.
export function roleColor(role,fallback=null){
  const palette=PALETTES[active]||BASE;
  return palette[role]||fallback||BASE[role]||fallback;
}
