// Procedural operative portraits.
//
// Each portrait is a deterministic SVG bust derived from the operative id, so
// the roster looks hand-authored without shipping any image assets. The same
// geometry renders as a pure black silhouette for operatives whose file has
// not been recovered yet — the shape reads as a person, the identity does not.

const SKIN=['#e6c6a4','#c99669','#8f6142','#f0d8bd','#a8764f','#6f4a31'];
const HAIR=['#15110f','#3b2a1c','#6d573f','#8f8c86','#243642','#4a1f22'];

// FNV-1a. Small, stable, and dependency free — the same id always produces
// the same face across sessions and machines.
function hash(text){
  let h=0x811c9dc5;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,0x01000193)>>>0;
  }
  return h>>>0;
}

// Feature picks are separate slices of the hash so changing one operative's
// id never shifts another's face.
function features(id){
  const h=hash(id);
  const pick=(shift,length)=>(h>>>shift)%length;
  return{
    skin:SKIN[pick(0,SKIN.length)],
    hair:HAIR[pick(4,HAIR.length)],
    crown:pick(8,5),   // hair / helmet / hood
    optic:pick(12,4),  // visor / goggles / eyes / single optic
    lower:pick(16,3),  // respirator / collar wrap / bare
    mark:pick(20,3)    // shoulder insignia
  };
}

const HEAD='M43,45 C43,30 50,23 60,23 C70,23 77,30 77,45 L77,55 C77,67 70,75 60,75 C50,75 43,67 43,55 Z';
const NECK='M53,68 L67,68 L67,86 L53,86 Z';
const TORSO='M60,83 C41,83 25,93 21,120 L99,120 C95,93 79,83 60,83 Z';

function crownPath(variant){
  switch(variant){
    case 0: // swept crop
      return 'M42,47 C42,27 50,20 60,20 C71,20 78,28 78,47 C74,38 70,34 60,34 C51,34 45,39 42,47 Z';
    case 1: // hard helmet shell
      return 'M41,48 C41,28 49,19 60,19 C71,19 79,28 79,48 L74,44 C74,33 68,29 60,29 C52,29 46,33 46,44 Z';
    case 2: // hood
      return 'M38,72 C34,42 44,17 60,17 C76,17 86,42 82,72 L77,66 C79,42 72,28 60,28 C48,28 41,42 43,66 Z';
    case 3: // long fall
      return 'M41,46 C41,26 49,19 60,19 C71,19 79,26 79,46 L79,80 L73,80 L73,44 C73,34 68,30 60,30 C52,30 47,34 47,44 L47,80 L41,80 Z';
    default: // shaved band
      return 'M43,44 C43,29 50,22 60,22 C70,22 77,29 77,44 L72,42 C71,33 67,30 60,30 C53,30 49,33 48,42 Z';
  }
}

function opticMarkup(variant,accent){
  switch(variant){
    case 0: // full visor bar
      return `<rect x="42" y="45" width="36" height="10" rx="4" fill="#0a1417"/>
        <rect x="43.5" y="46.5" width="33" height="7" rx="3" fill="${accent}" opacity=".55"/>
        <rect x="45" y="48" width="12" height="2" rx="1" fill="#ffffff" opacity=".5"/>`;
    case 1: // twin lenses
      return `<circle cx="51" cy="51" r="6.5" fill="#0a1417"/><circle cx="69" cy="51" r="6.5" fill="#0a1417"/>
        <circle cx="51" cy="51" r="4.5" fill="${accent}" opacity=".6"/><circle cx="69" cy="51" r="4.5" fill="${accent}" opacity=".6"/>
        <circle cx="49.4" cy="49.4" r="1.5" fill="#ffffff" opacity=".65"/>
        <circle cx="67.4" cy="49.4" r="1.5" fill="#ffffff" opacity=".65"/>
        <rect x="57" y="50" width="6" height="2" rx="1" fill="#0a1417"/>`;
    case 2: // bare eyes
      return `<path d="M46,45 L56,47" stroke="#0a1417" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>
        <path d="M74,45 L64,47" stroke="#0a1417" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>
        <ellipse cx="51" cy="52" rx="3.4" ry="2.4" fill="#f4fbfb"/>
        <ellipse cx="69" cy="52" rx="3.4" ry="2.4" fill="#f4fbfb"/>
        <circle cx="51.4" cy="52" r="1.7" fill="#12242a"/><circle cx="69.4" cy="52" r="1.7" fill="#12242a"/>`;
    default: // single combat optic
      return `<ellipse cx="51" cy="52" rx="3.4" ry="2.4" fill="#f4fbfb"/>
        <circle cx="51.4" cy="52" r="1.7" fill="#12242a"/>
        <path d="M46,45 L56,47" stroke="#0a1417" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>
        <rect x="62" y="45" width="17" height="11" rx="3" fill="#0a1417"/>
        <circle cx="69.5" cy="50.5" r="3.2" fill="${accent}" opacity=".75"/>
        <circle cx="69.5" cy="50.5" r="1.2" fill="#ffffff" opacity=".7"/>`;
  }
}

function lowerMarkup(variant,accent){
  switch(variant){
    case 0: // respirator
      return `<path d="M49,58 L71,58 L68,70 C66,73 54,73 52,70 Z" fill="#152b31" stroke="#0a1417" stroke-width="1"/>
        <path d="M53,62 H67 M54,66 H66" stroke="${accent}" stroke-width="1.2" opacity=".55" stroke-linecap="round"/>`;
    case 1: // collar wrap pulled up
      return `<path d="M45,63 C50,72 70,72 75,63 L75,74 C68,79 52,79 45,74 Z" fill="#16262b" stroke="#0a1417" stroke-width="1"/>
        <path d="M60,66 L60,74" stroke="${accent}" stroke-width="1" opacity=".4"/>`;
    default: // bare
      return `<path d="M55,64 C58,66 62,66 65,64" stroke="#0a1417" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".6"/>`;
  }
}

function markMarkup(variant,accent){
  switch(variant){
    case 0:
      return `<path d="M30,104 L38,98 L46,104 L38,110 Z" fill="${accent}" opacity=".75"/>`;
    case 1:
      return `<path d="M29,100 H45 M29,105 H45 M29,110 H39" stroke="${accent}" stroke-width="2" opacity=".7" stroke-linecap="round"/>`;
    default:
      return `<circle cx="37" cy="104" r="6" fill="none" stroke="${accent}" stroke-width="2" opacity=".7"/>
        <circle cx="37" cy="104" r="2" fill="${accent}" opacity=".8"/>`;
  }
}

/**
 * Renders one operative bust as an inline SVG string.
 * @param {object} operative roster entry (id + color are all that is read)
 * @param {{silhouette?:boolean,size?:number,tint?:string}} options
 */
export function portraitSvg(operative,{silhouette=false,size=120,tint=null}={}){
  const id=operative?.id||'unknown';
  const accent=tint||operative?.color||'#76e7d4';
  const f=features(id);
  const uid=`p${hash(id+(silhouette?'-s':'')).toString(36)}`;

  const frame=`
    <defs>
      <linearGradient id="${uid}bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${accent}" stop-opacity="${silhouette?.06:.16}"/>
        <stop offset="1" stop-color="#050b0d" stop-opacity=".95"/>
      </linearGradient>
      <linearGradient id="${uid}rim" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${accent}" stop-opacity=".9"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="${uid}clip"><rect x="0" y="0" width="120" height="120" rx="4"/></clipPath>
    </defs>
    <rect x="0" y="0" width="120" height="120" rx="4" fill="url(#${uid}bg)"/>`;

  // Faint technical grid + corner ticks, shared by both modes.
  const chrome=`
    <g opacity="${silhouette?.16:.22}" stroke="${accent}" stroke-width=".5">
      <path d="M0,30 H120 M0,60 H120 M0,90 H120 M30,0 V120 M60,0 V120 M90,0 V120"/>
    </g>
    <g stroke="${accent}" stroke-width="1.4" fill="none" opacity=".8">
      <path d="M4,14 V4 H14"/><path d="M106,4 H116 V14"/>
      <path d="M4,106 V116 H14"/><path d="M116,106 V116 H106"/>
    </g>`;

  if(silhouette){
    // Pure black bust: shape only, lit from the left so it does not read flat.
    const body=`
      <g fill="#03080a">
        <path d="${TORSO}"/><path d="${NECK}"/><path d="${HEAD}"/><path d="${crownPath(f.crown)}"/>
      </g>
      <g fill="none" stroke="url(#${uid}rim)" stroke-width="1.6" opacity=".55">
        <path d="${HEAD}"/><path d="${crownPath(f.crown)}"/><path d="${TORSO}"/>
      </g>
      <text x="60" y="58" text-anchor="middle" font-size="22" font-weight="700"
            fill="${accent}" opacity=".28" font-family="inherit">?</text>`;
    return `<svg class="portrait-svg" viewBox="0 0 120 120" width="${size}" height="${size}"
      role="img" aria-label="Unidentified operative silhouette">
      ${frame}<g clip-path="url(#${uid}clip)">${chrome}${body}</g></svg>`;
  }

  const body=`
    <path d="${TORSO}" fill="#16262b" stroke="#0a1417" stroke-width="1.2"/>
    <path d="M60,83 L44,92 L60,120 L76,92 Z" fill="#1d3339" opacity=".9"/>
    <path d="M60,86 L52,92 L60,104 L68,92 Z" fill="${accent}" opacity=".35"/>
    ${markMarkup(f.mark,accent)}
    <path d="${NECK}" fill="${f.skin}" stroke="#0a1417" stroke-width="1"/>
    <path d="M53,68 L67,68 L67,74 L53,74 Z" fill="#000000" opacity=".22"/>
    <path d="${HEAD}" fill="${f.skin}" stroke="#0a1417" stroke-width="1.2"/>
    <rect x="40.5" y="49" width="3" height="8" rx="1.5" fill="${f.skin}" stroke="#0a1417" stroke-width=".8"/>
    <rect x="76.5" y="49" width="3" height="8" rx="1.5" fill="${f.skin}" stroke="#0a1417" stroke-width=".8"/>
    <path d="${crownPath(f.crown)}" fill="${f.hair}" stroke="#0a1417" stroke-width="1"/>
    ${opticMarkup(f.optic,accent)}
    ${lowerMarkup(f.lower,accent)}
    <path d="M43,45 C43,30 50,23 60,23 L60,75 C50,75 43,67 43,55 Z" fill="#ffffff" opacity=".05"/>
    <path d="M77,45 C77,30 70,23 60,23 L60,75 C70,75 77,67 77,55 Z" fill="#000000" opacity=".12"/>`;

  return `<svg class="portrait-svg" viewBox="0 0 120 120" width="${size}" height="${size}"
    role="img" aria-label="${operative?.codename||'Operative'} portrait">
    ${frame}<g clip-path="url(#${uid}clip)">${chrome}${body}</g></svg>`;
}
