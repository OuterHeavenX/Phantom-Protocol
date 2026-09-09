// Theatre ambience.
//
// The mixer has carried an `ambience` bus since the audio rebuild. Nothing has
// ever routed a single sound to it — ten theatres, from a flooded exclusion
// zone to a glacial basin to an active munitions plant, and all ten sounded
// like the same empty room between gunshots.
//
// A bed is two continuous layers and a set of things that happen occasionally:
//
//   air     broadband noise through a filter — wind, rain, room tone. The
//           filter drifts, because a static filter on static noise reads as a
//           fault in the hardware rather than as weather.
//   hum     a low oscillator — mains, machinery, structure under load. This is
//           what tells you whether a place still has power.
//   events  intermittent one-shots. Occupancy matters more than the sounds
//           themselves: a drip every four seconds is a wet room, and the same
//           drip every forty is a room somebody left.
//
// Levels are deliberately low. Ambience is the floor the rest of the mix stands
// on; the moment it is something you notice on purpose, it is too loud.

// Ranges are seconds between occurrences, picked uniformly. Never fixed
// intervals — a metronome is the one thing nature never does, and the ear
// identifies it immediately as a machine.
export const AMBIENCE={
  // Subterranean, sealed, still powered. The hum is the loudest thing in it.
  blacksite:{
    air:{freq:220,q:.6,gain:.05,filter:'lowpass',drift:[.05,60]},
    hum:{freq:58,gain:.035,type:'sine'},
    events:[{sound:'drip',every:[4,11],gain:.5},{sound:'arc',every:[9,24],gain:.35}]
  },
  // Wind outside a structure that is working hard to stay cold.
  arctic:{
    air:{freq:480,q:.5,gain:.07,filter:'bandpass',drift:[.08,180]},
    hum:{freq:84,gain:.03,type:'sine'},
    events:[{sound:'gust',every:[6,15],gain:.6},{sound:'iceCrack',every:[8,20],gain:.4}]
  },
  // Standing water in a place with no roof left to speak of.
  sunken:{
    air:{freq:340,q:.5,gain:.06,filter:'lowpass',drift:[.06,90]},
    hum:{freq:44,gain:.03,type:'sine'},
    events:[{sound:'drip',every:[2.5,7],gain:.55},{sound:'groan',every:[12,28],gain:.4}]
  },
  // The only theatre where the ambience is itself dangerous.
  foundry:{
    air:{freq:300,q:.7,gain:.07,filter:'bandpass',drift:[.09,110]},
    hum:{freq:72,gain:.05,type:'sawtooth'},
    events:[{sound:'emberPop',every:[3,9],gain:.4},{sound:'boom',every:[10,22],gain:.45}]
  },
  // Decommissioned: almost no air, so almost no air layer. What is left is the
  // structure complaining and the last circuits that nobody switched off.
  orbital:{
    air:{freq:160,q:.4,gain:.04,filter:'lowpass',drift:[.04,40]},
    hum:{freq:96,gain:.025,type:'sine'},
    events:[{sound:'groan',every:[7,18],gain:.5},{sound:'arc',every:[11,26],gain:.3}]
  },
  // Sustained rainfall on a suspension span. The rain is the bed; the cables
  // are the events.
  crossfall:{
    air:{freq:1500,q:.7,gain:.1,filter:'bandpass',drift:[.11,260]},
    hum:{freq:40,gain:.02,type:'sine'},
    events:[{sound:'boom',every:[14,34],gain:.35},{sound:'groan',every:[9,21],gain:.45}]
  },
  // Whiteout. No structure, no power, nothing but moving air.
  hollow:{
    air:{freq:640,q:.45,gain:.11,filter:'bandpass',drift:[.13,300]},
    hum:null,
    events:[{sound:'gust',every:[4,10],gain:.7},{sound:'iceCrack',every:[10,24],gain:.35}]
  },
  // Drowned forestry. Wet and organic rather than wet and industrial.
  mire:{
    air:{freq:420,q:.5,gain:.055,filter:'lowpass',drift:[.05,70]},
    hum:{freq:52,gain:.02,type:'sine'},
    events:[{sound:'drip',every:[3,8],gain:.45},{sound:'creak',every:[6,16],gain:.5}]
  },
  // Enormous, empty, and made entirely of sheet metal.
  hangar:{
    air:{freq:260,q:.45,gain:.05,filter:'lowpass',drift:[.05,80]},
    hum:{freq:66,gain:.02,type:'sine'},
    events:[{sound:'groan',every:[5,14],gain:.55},{sound:'creak',every:[8,19],gain:.4}]
  },
  // A laboratory, not a ruin. Everything in it is powered and working.
  proving:{
    air:{freq:900,q:.8,gain:.05,filter:'bandpass',drift:[.1,140]},
    hum:{freq:120,gain:.04,type:'square'},
    events:[{sound:'arc',every:[6,15],gain:.4},{sound:'emberPop',every:[9,20],gain:.3}]
  }
};

// The bed for a theatre.
//
// Falls back to the blacksite bed rather than to silence: a theatre added later
// and forgotten here sounds like the wrong room, which somebody reports, rather
// than like no room, which reads as the feature simply not working.
export function ambienceFor(mapId){
  return AMBIENCE[mapId]||AMBIENCE.blacksite;
}
