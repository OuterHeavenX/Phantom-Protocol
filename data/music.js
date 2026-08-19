// Authored music tracks.
//
// Keys are resolved in this order by AudioEngine.startMusic:
//   1. the campaign operation id, so a track written for a story operation
//      plays on that operation specifically;
//   2. the theatre id, so the same track plays when that sector is deployed to
//      outside the campaign;
//   3. nothing — the runtime-synthesized bed covers everything else.
//
// Filenames are used verbatim and URL-encoded at load, so a track can keep the
// name it was delivered under, spaces and all.

export const MUSIC_BASE='assets/audio/music/';

export const MUSIC_TRACKS={
  // Title screen and every menu behind it.
  menu:{file:'PHANTOM PROTOCOL TITLE SCREEN.ogg',title:'PHANTOM PROTOCOL'},

  // Operation 01 — COLD OPEN, Blacksite Zero.
  op1:{file:'COLD OPEN.ogg',title:'COLD OPEN'},
  blacksite:{file:'COLD OPEN.ogg',title:'COLD OPEN'},

  // Operation 02 — CROSSFALL, Crossfall Span.
  op2:{file:'CROSSFALL.ogg',title:'CROSSFALL'},
  crossfall:{file:'CROSSFALL.ogg',title:'CROSSFALL'}
};

// Formats the loader will offer the browser, best-supported last so the list
// reads in delivery order. Only the .ogg files ship today; dropping an .m4a or
// .mp3 of the same name beside one makes it play on browsers that refuse
// Vorbis — notably Safari and iOS — with no code change.
export const MUSIC_FORMATS=[
  {ext:'.ogg',type:'audio/ogg; codecs="vorbis"'},
  {ext:'.m4a',type:'audio/mp4; codecs="mp4a.40.2"'},
  {ext:'.mp3',type:'audio/mpeg'}
];

export function trackFor(key){
  return MUSIC_TRACKS[key]||null;
}

// Every candidate URL for a track, in the order the browser should try them.
export function trackSources(track){
  const base=track.file.replace(/\.[a-z0-9]+$/i,'');
  return MUSIC_FORMATS.map(format=>({
    src:MUSIC_BASE+encodeURIComponent(base+format.ext),
    type:format.type
  }));
}
