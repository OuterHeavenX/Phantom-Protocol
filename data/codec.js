// Codec traffic.
//
// Every dossier card in assets/images/Character_profile carries a CODEC panel
// with a channel number and CONNECTED under it. This is what comes over it.
//
// Two people talk. The OPERATIVE is whoever deployed, speaking for themselves.
// The HANDLER is whoever is running comms from the operations room: VIPER, the
// team commander, unless VIPER is the one in the field — in which case RAVEN
// takes the desk, since reading a sector at range is her job anyway.
//
// A beat is one exchange: an ordered list of lines, each attributed to `self`
// (the deployed operative) or `handler`. Lines are chosen per operative where
// a voice exists for them and fall back to `default` where one does not, so
// adding an operative never leaves a gap and writing a line for one never
// obliges writing eight.

// Transcribed from the cards. Two pairs share a channel — 02 and 04 each
// appear on two files — which is what the art says, so it is what ships.
export const CODEC_CHANNELS={
  mirage:'01',oracle:'02',requiem:'02',vesper:'04',
  cipher:'04',bastion:'05',wraith:'07',ferrous:'11'
};

export const DEFAULT_HANDLER='mirage';   // VIPER, team commander
export const RELIEF_HANDLER='vesper';    // RAVEN, when VIPER is deployed

export function handlerFor(operativeId){
  return operativeId===DEFAULT_HANDLER?RELIEF_HANDLER:DEFAULT_HANDLER;
}

export function channelFor(operativeId){
  return CODEC_CHANNELS[operativeId]||'00';
}

// `once` — fires at most once per contract.
// `cooldown` — seconds before the same beat can fire again.
// `priority` — a higher number interrupts a lower one already on screen.
export const CODEC_EVENTS={
  deploy:{once:true,priority:2},
  firstContact:{once:true,priority:1},
  gunship:{cooldown:45,priority:3},
  elite:{cooldown:40,priority:2},
  eliteDown:{cooldown:50,priority:1},
  boss:{priority:4},
  bossDown:{priority:4},
  vaultDetected:{cooldown:20,priority:2},
  vaultBreached:{cooldown:20,priority:2},
  garrison:{cooldown:30,priority:3},
  personnelCache:{cooldown:30,priority:2},
  personnelFound:{priority:3},
  objectiveCleared:{cooldown:55,priority:1},
  missionProgress:{cooldown:20,priority:3},
  evolution:{cooldown:30,priority:2},
  critical:{cooldown:35,priority:4},
  halfway:{once:true,priority:1},
  nemesisFirst:{priority:5},
  nemesisReturn:{priority:5},
  nemesisWithdraw:{priority:5},
  nemesisDown:{priority:5},
  squadDown:{priority:4},
  squadRevived:{priority:3},
  squadAbility:{cooldown:70,priority:1},
  extraction:{priority:4},
  extractionBlocked:{cooldown:25,priority:4},
  combo:{once:true,priority:1}
};

// Handler lines are written for VIPER's register — calm, procedural, three
// steps ahead — and read correctly in RAVEN's too, which is the point of
// having one desk voice rather than eight.
const HANDLER={
  deploy:[
    'Channel open. You are inside their perimeter and nobody is coming for you.',
    'Comms are up. Sector is theirs until you make it otherwise.',
    'You are on the ground. Work the contract, then get to the beacon.'
  ],
  firstContact:[
    'Contact confirmed. They know the sector is compromised now.',
    'That is first contact. Expect the response to organize.'
  ],
  gunship:[
    'Rotary signature inbound. Gunship — it will hold off your range and work you over.',
    'Air support, theirs. It will not close. You will have to reach for it.'
  ],
  elite:['Elite signature on the net. That one has a file.',
    'Command-grade hostile. Treat it like it has read yours.'],
  eliteDown:['Elite signature terminated. Their net just got quieter.',
    'That is one they cannot replace this week.'],
  boss:['Command signature. This is what the sector was protecting.',
    'That is the thing the audit was about. Do not trade with it.'],
  bossDown:['Command signature is down. Somebody is rewriting a report right now.',
    'Signature terminated. That will cost them more than the sector.'],
  vaultDetected:['Scanner resolved a sealed chamber. It is not on any manifest.',
    'There is a void in the floor plan near you. Somebody built it to stay unlisted.'],
  vaultBreached:['Chamber is open. Take what is in it.',
    'Vault breached. Whatever they sealed in there is yours now.'],
  garrison:['They sealed a garrison in with the loot. Of course they did.',
    'Vault was guarded from the inside. Watch the door.'],
  personnelCache:['That is a personnel cache. Somebody we lost is in it.',
    'Cache reads as a personnel file. Recover it — we do not leave people filed.'],
  personnelFound:['File recovered. We will start their counseling when you are home.',
    'That is one of ours coming back. Good.'],
  objectiveCleared:['Objective closed. Logged and paid.',
    'That one is done. Next one is already on your list.'],
  missionProgress:['Objective advanced. Keep it moving.',
    'That is progress command can actually use.'],
  evolution:['Your loadout just became something the armory has no name for.',
    'Weapon signature changed. Whatever you did to it, it took.'],
  critical:['Your vitals are falling off a cliff. Break contact.',
    'You are about to become a casualty report. Disengage.'],
  halfway:['Halfway. The response scales from here, not the clock.',
    'You are through half of it. It gets heavier, not longer.'],
  nemesisFirst:['That is not sector defence. It walked here, and it walked here for you.',
    'Bipedal chassis, no garrison markings. It is not protecting anything. It is hunting.'],
  nemesisReturn:['It is the same machine. Look at the holes — you put those there.',
    'Same designation, heavier loadout. It has been refitted since you last met.'],
  nemesisWithdraw:['It is disengaging. That is not mercy, that is it deciding it has learned enough.',
    'Breaking contact under its own power. Whatever it takes home, it comes back with.'],
  nemesisDown:['It is down and it is staying down. That one does not get refitted.',
    'Chassis destroyed. Somebody just lost a very expensive argument.'],
  squadDown:['Your second is down. They are not dead. Reach them.',
    'One of yours is on the ground and still breathing. That is a clock.'],
  squadRevived:['They are up. Do not make a habit of this.',
    'Back on their feet. Keep them there.'],
  squadAbility:['Your second just spent something expensive. Use the room it bought you.',
    'That was their signature move. It does not come back quickly.'],
  extraction:['Beacon is live. Reach it and you are out.',
    'Extraction window is open. Nothing about it stays open forever.'],
  extractionBlocked:['Beacon will not lift you. The contract is not finished.',
    'Extraction refused. Close the objective first.'],
  combo:['Whatever you are doing out there, keep doing it.',
    'Your kill chain is off the scale. Command noticed.']
};

// Operative lines. `default` covers anyone without a written voice for a beat.
const SELF={
  deploy:{
    vesper:'Signal is clean. If they are looking for me they are looking at the wrong ghost.',
    bastion:'Frame is sealed. I will hold whatever needs holding.',
    mirage:'I have read this sector twice. It still does not add up.',
    wraith:'Then I will make sure nobody sees me arrive.',
    oracle:'I have eyes on more of this place than they think I do.',
    ferrous:'Give me a wall and a reason. I will give you a door.',
    cipher:'Their hardware is already talking to me. It does not know that yet.',
    requiem:'Understood. Nobody is coming. Nobody needs to.',
    default:'Copy. Working the contract.'
  },
  firstContact:{
    wraith:'They found me. That is a mistake with a short life.',
    ferrous:'Good. I was starting to feel unwelcome.',
    requiem:'They saw me. Fear is a liability — theirs.',
    bastion:'Let them come to the wall.',
    default:'Contact. Handling it.'
  },
  gunship:{
    vesper:'It is painting me. Let me see if I can make it paint something else.',
    bastion:'It is out of my reach and I am not out of its. Wonderful.',
    mirage:'It will hold its band and strafe. Break its pattern and it has nothing.',
    wraith:'Hard to be unseen under a spotlight.',
    oracle:'It flies a predictable arc. That is all I need.',
    ferrous:'Everything comes down eventually. Some things need help.',
    cipher:'It is a machine. Machines can be argued with.',
    requiem:'Then it can come lower.',
    default:'I see it. Working the angle.'
  },
  elite:{
    oracle:'That one moves like it was trained by whoever trained us.',
    cipher:'Its hardware is a generation ahead. Interesting.',
    requiem:'Finally.',
    default:'I see the signature. Engaging.'
  },
  eliteDown:{
    requiem:'Next.',
    ferrous:'There is not enough left to file.',
    default:'Signature down.'
  },
  boss:{
    bastion:'Then this is where the line goes.',
    wraith:'It is too big to hide from. So I will not.',
    oracle:'I can read it. Give me a moment and I can read it well.',
    requiem:'It is not the biggest thing I have buried.',
    default:'I see it. Committing.'
  },
  bossDown:{
    ferrous:'Structural failure. My favourite kind.',
    mirage:'Log it. Every part of it. Somebody authorized that thing.',
    default:'It is down.'
  },
  vaultDetected:{
    cipher:'A room nobody wrote down. That is where the truth lives.',
    ferrous:'Sealed. Not for long.',
    wraith:'Hidden. So was I.',
    default:'Scanner has it. Moving to the door.'
  },
  vaultBreached:{
    ferrous:'Door is a suggestion.',
    cipher:'Now let us see what they were ashamed of.',
    default:'I am inside.'
  },
  garrison:{
    bastion:'They were waiting in the dark for someone. Today it is me.',
    requiem:'They sealed themselves in with me. Poor planning.',
    default:'Garrison inside. Handling it.'
  },
  personnelCache:{
    mirage:'One of ours. We are getting them back.',
    vesper:'A file with a person in it. I hate that this is normal now.',
    default:'Personnel cache. Recovering it.'
  },
  personnelFound:{
    mirage:'Welcome back. You do not know it yet, but welcome back.',
    bastion:'Nobody stays filed. Not while I am walking.',
    default:'File is secure.'
  },
  missionProgress:{
    oracle:'That is the piece we came for.',
    cipher:'Another page of a story they paid to have shredded.',
    default:'Objective advanced.'
  },
  evolution:{
    cipher:'The weapon just rewrote itself. I only suggested it.',
    ferrous:'Whatever that is now, it is louder.',
    default:'Loadout changed. It feels different.'
  },
  critical:{
    bastion:'The frame is holding. I am not sure I am.',
    requiem:'I know what this costs. I am still here.',
    wraith:'I let one get close. That is on me.',
    mirage:'I miscounted. That is the one thing I never do.',
    default:'I am hit. Still moving.'
  },
  halfway:{
    oracle:'The pattern is tightening. They are learning me.',
    default:'Halfway. Still standing.'
  },
  nemesisFirst:{
    bastion:'Big. Good. I have been waiting for something worth bracing against.',
    wraith:'It is too large to hide from and too slow to catch me. I like those odds.',
    requiem:'It came all this way. The least I can do is meet it.',
    oracle:'Two legs. Two legs means a gait, and a gait means a rhythm.',
    default:'I see it. Big, and walking straight at me.'
  },
  nemesisReturn:{
    ferrous:'I remember where I opened it. Let us do that again.',
    oracle:'Same gait, more weight on it. It has been fed.',
    requiem:'Back for the rest of it, then.',
    default:'It is the same one. Fine.'
  },
  nemesisWithdraw:{
    requiem:'Do not walk away from me.',
    ferrous:'It is leaving under its own power. That is my fault.',
    bastion:'Let it go. It will be somebody else\'s problem for a while.',
    default:'It is pulling out. I could not finish it.'
  },
  nemesisDown:{
    requiem:'Now it is finished.',
    ferrous:'That is the sound a very large budget makes.',
    bastion:'It fell where it stood. Good.',
    default:'It is down. Confirmed.'
  },
  squadDown:{
    bastion:'I told them to stay behind the wall.',
    mirage:'That is on me. I put them there.',
    requiem:'Get up. I am not carrying you and the contract.',
    default:'I see them. Going to get them.'
  },
  squadRevived:{
    ferrous:'Try the other side of the explosion next time.',
    mirage:'Nobody stays on the ground while I am running this.',
    default:'They are up.'
  },
  extraction:{
    wraith:'Then you will never see me leave either.',
    requiem:'On my way. Nothing follows me out.',
    bastion:'Falling back in order. Not running.',
    default:'Moving to the beacon.'
  },
  extractionBlocked:{
    ferrous:'It will lift me when I am finished making noise.',
    default:'Understood. Finishing the job first.'
  }
};

// One exchange per beat. Which side opens depends on the beat: command calls
// the things command can see, the operative answers for what is in front of
// them, and a couple of beats are the operative speaking first.
const OPENS_WITH_SELF=new Set(['eliteDown','bossDown','vaultBreached','evolution']);

function pick(list,rng){
  if(!list||!list.length)return null;
  return list[Math.floor(rng()*list.length)%list.length];
}

// Builds the lines for one beat. Returns [] when the event has nothing to say,
// so a caller can fire freely without checking first.
export function codecBeat(event,operativeId,rng=Math.random){
  const handlerText=pick(HANDLER[event],rng);
  const voices=SELF[event];
  const selfText=voices?(voices[operativeId]||voices.default||null):null;
  const lines=[];
  const handlerLine=handlerText?{from:'handler',text:handlerText}:null;
  const selfLine=selfText?{from:'self',text:selfText}:null;
  if(OPENS_WITH_SELF.has(event)){
    if(selfLine)lines.push(selfLine);
    if(handlerLine)lines.push(handlerLine);
  }else{
    if(handlerLine)lines.push(handlerLine);
    if(selfLine)lines.push(selfLine);
  }
  return lines;
}
