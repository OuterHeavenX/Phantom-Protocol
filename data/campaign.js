// The campaign: an ordered sequence of story operations.
//
// Each operation carries its own briefing and debrief dialogue, a mission
// objective the engine enforces, and one document fragment recovered on
// completion. Read end to end, the documents are the Glasshouse disclosure —
// the network was not studying the battlefield, it was building the people it
// sent onto one.
//
// Speakers:
//   VECTOR    — handler. Reads from a script and knows it.
//   ARCHIVIST — analyst decrypting what comes back. Increasingly not okay.
//   SIGNAL    — an unattributed voice on a channel that should be empty.
//   OPERATIVE — the player. Says little.

export const OBJECTIVE_TYPES={
  extract:{
    id:'extract',name:'EXTRACT',
    summary:'Survive the contract window and reach the extraction beacon.'
  },
  recover:{
    id:'recover',name:'RECOVER',
    summary:'Locate the marked data caches, then extract with what you find.'
  },
  rescue:{
    id:'rescue',name:'RESCUE',
    summary:'Locate the asset, keep them alive, and walk them to the beacon.'
  },
  duel:{
    id:'duel',name:'DUEL',
    summary:'No reinforcements on either side. Put it down.'
  }
};

export const CAMPAIGN=[
  {
    id:'op1',index:1,act:1,name:'COLD OPEN',
    map:'blacksite',duration:5,difficulty:0,
    objective:{type:'extract'},
    tagline:'A routine sweep of a facility that should be empty.',
    briefing:[
      {speaker:'VECTOR',text:'Blacksite Zero. Decommissioned nine months ago, power still drawn on the main bus. Walk it, confirm it is empty, come home.'},
      {speaker:'OPERATIVE',text:'Empty facilities do not draw power.'},
      {speaker:'VECTOR',text:'No. They do not.'}
    ],
    debrief:[
      {speaker:'VECTOR',text:'Contact volume was not consistent with a decommissioned site.'},
      {speaker:'ARCHIVIST',text:'It is consistent with a staffed one. Someone filed the closure and nobody left.'}
    ],
    document:{
      id:'doc_intake',name:'INTAKE VARIANCE',classification:'ADMIN // RECOVERED',
      body:'Facility closure was filed on schedule and countersigned. Personnel egress records for the same period list four departures against a standing complement of sixty-one. The remaining fifty-seven have continued to draw hazard pay at a site that does not, on paper, exist.'
    }
  },
  {
    id:'op2',index:2,act:1,name:'CROSSFALL',
    map:'crossfall',duration:5,difficulty:1,
    objective:{type:'recover',caches:3},
    tagline:'A courier went into the water. His case did not.',
    briefing:[
      {speaker:'VECTOR',text:'A courier ran Crossfall Span four nights ago and did not come off it. His escort reported the case went over the rail. It did not — it is in three pieces on the deck, and the rain is the only reason nobody has collected them yet.'},
      {speaker:'ARCHIVIST',text:'Split cases are a Glasshouse habit. One fragment is an accident. Three is a filing convention.'},
      {speaker:'VECTOR',text:'Recover all three. Do not open them on the bridge.'}
    ],
    debrief:[
      {speaker:'ARCHIVIST',text:'Decrypted the first fragment. It is a procurement schedule, and the line items are people.'},
      {speaker:'VECTOR',text:'Say that again.'},
      {speaker:'ARCHIVIST',text:'Unit cost, lead time, expected yield. For people.'}
    ],
    document:{
      id:'doc_procurement',name:'PROCUREMENT SCHEDULE',classification:'GLASSHOUSE // FRAGMENT 1 OF 3',
      body:'Line 4408: candidate intake, forty units, staged delivery across nine quarters. Lead time from intake to field readiness is given as eleven months. Expected yield is 12%. There is no line describing what happens to the other 88%, which suggests it is handled somewhere the schedule does not have to account for it.'
    }
  },
  {
    id:'op3',index:3,act:1,name:'HOLLOW',
    map:'hollow',duration:5,difficulty:1,
    objective:{type:'rescue'},
    tagline:'The analyst who flagged the schedule is in a valley she was not sent to.',
    briefing:[
      {speaker:'ARCHIVIST',text:'The analyst who first flagged line 4408 filed a transfer request the same day. It was approved in forty minutes. Nobody gets approved in forty minutes.'},
      {speaker:'VECTOR',text:'Her transport put down in Hollow Valley and stopped transmitting. She is alive — her beacon is still moving.'},
      {speaker:'ARCHIVIST',text:'Get her out. She has seen the part of the schedule we have not.'}
    ],
    debrief:[
      {speaker:'ARCHIVIST',text:'She says the yield figure is not a survival rate. It is a compliance rate.'},
      {speaker:'VECTOR',text:'Compliance with what?'},
      {speaker:'ARCHIVIST',text:'She stopped talking at that point.'}
    ],
    document:{
      id:'doc_yield',name:'YIELD CLARIFICATION',classification:'GLASSHOUSE // FRAGMENT 2 OF 3',
      body:'Yield is not a measure of candidates surviving conditioning. Conditioning survival runs above ninety percent and has since the second cohort. Yield measures candidates who, after conditioning, continue to follow instruction when the instruction is illegible to them. The remainder are not lost. They are reassigned to a program that does not require them to understand it.'
    }
  },
  {
    id:'op4',index:4,act:1,name:'ASHEN',
    map:'mire',duration:5,difficulty:1,
    objective:{type:'recover',caches:3},
    tagline:'The reassignment program has an address.',
    briefing:[
      {speaker:'VECTOR',text:'Ashen Mire. A forestry concession that stopped harvesting timber in 2043 and kept its payroll. The third case fragment routed through here.'},
      {speaker:'ARCHIVIST',text:'Watch the treeline. Whatever they moved through this place, they moved it on foot and at night.'},
      {speaker:'OPERATIVE',text:'Understood.'},
      {speaker:'SIGNAL',text:'— you have been here before —'},
      {speaker:'VECTOR',text:'Ignore that. Channel is dirty. Go.'}
    ],
    debrief:[
      {speaker:'ARCHIVIST',text:'Third fragment. It is a facility manifest, and one of the facilities is the site you swept on your first operation.'},
      {speaker:'VECTOR',text:'Blacksite Zero was a research annex.'},
      {speaker:'ARCHIVIST',text:'It was an intake centre. You have been inside the program since the day you started working for me.'}
    ],
    document:{
      id:'doc_manifest',name:'FACILITY MANIFEST',classification:'GLASSHOUSE // FRAGMENT 3 OF 3',
      body:'Intake is distributed across six sites to keep any single complement below the threshold that triggers external review. Site designations are rotated annually. Blacksite Zero appears under four designations across the period on file. Candidate records are not held at intake; they are held at the evaluation facility, against a designation that does not appear on this manifest.'
    }
  },
  {
    id:'op5',index:5,act:1,name:'DERELICT',
    map:'hangar',duration:10,difficulty:1,
    objective:{type:'recover',caches:4},
    tagline:'Eleven ascents. Eleven descents. Zero manifests.',
    briefing:[
      {speaker:'ARCHIVIST',text:'The evaluation facility is not on any manifest because it is not reached by road. It is reached from this hangar.'},
      {speaker:'VECTOR',text:'Strategic airlift, written off six years ago. The airframes are still parked where they were left. So is the flight documentation.'},
      {speaker:'ARCHIVIST',text:'Find the load records. I want to know what those aircraft were carrying, and I want to know why the descent masses were higher.'}
    ],
    debrief:[
      {speaker:'ARCHIVIST',text:'The descent masses were higher because the candidates came back heavier than they went up.'},
      {speaker:'VECTOR',text:'Heavier.'},
      {speaker:'ARCHIVIST',text:'Augmented. Every gram of it documented, costed and signed for. They are not conditioning soldiers. They are building them.'}
    ],
    document:{
      id:'doc_load',name:'LOAD RECORDS',classification:'GLASSHOUSE // AUGMENTATION',
      body:'Ascent manifests list candidates by intake number at an average of 74 kilograms. Descent manifests list the same intake numbers at an average of 96. The difference is itemised: frame reinforcement, tissue substrate, an onboard regulator, and a compliance module with its own part number and its own warranty. The warranty is voided if the module is removed by anyone other than the manufacturer.'
    }
  },
  {
    id:'op6',index:6,act:1,name:'PROVING GROUND',
    map:'proving',duration:5,difficulty:1,
    objective:{type:'duel'},
    tagline:'They want to see how the old model performs against the new one.',
    briefing:[
      {speaker:'ARCHIVIST',text:'I found the evaluation facility. I also found why nobody has ever recovered a candidate record from it.'},
      {speaker:'VECTOR',text:'Because the record is the candidate.'},
      {speaker:'ARCHIVIST',text:'Prototype designation ONE. Intake number matches a file with your recruitment date on it, and a behavioural profile written fourteen months before you were recruited.'},
      {speaker:'VECTOR',text:'They built it from you. And now they want a control measurement.'},
      {speaker:'SIGNAL',text:'— chamber is sealed — no reinforcement on either side — begin —'}
    ],
    debrief:[
      {speaker:'ARCHIVIST',text:'It stopped moving. The telemetry did not.'},
      {speaker:'VECTOR',text:'Meaning what.'},
      {speaker:'ARCHIVIST',text:'Meaning the measurement completed. Whatever they wanted to learn from putting you in that room, they learned it. This was never an audit. It was the eleventh trial in a series, and you have been the control the whole way.'},
      {speaker:'SIGNAL',text:'— result logged — next candidate —'}
    ],
    document:{
      id:'doc_prototype',name:'PROTOTYPE ONE',classification:'GLASSHOUSE // EVALUATION',
      body:'Prototype ONE was constructed against a reconstructed behavioural profile rather than a living candidate. The profile source is listed as a serving operative, designated CONTROL, who has not been informed and whose continued field performance constitutes the baseline the prototype is measured against. Trial eleven closed on schedule. The recommendation is unchanged from trials one through ten: the control performs better than the build, and the build is cheaper to replace.'
    }
  },

  // ---- ACT II -------------------------------------------------------------
  // Act I closed on the recommendation: the control performs better than the
  // build, and the build is cheaper to replace. Act II is what a network does
  // with a baseline it no longer needs, and what SIGNAL turns out to be.
  {
    id:'op7',index:7,act:2,name:'GLASS FLOOR',
    map:'arctic',duration:10,difficulty:1,
    objective:{type:'recover',caches:3},
    tagline:'The recommendation from trial eleven has been actioned.',
    briefing:[
      {speaker:'ARCHIVIST',text:'Arctic Relay filed a records disposal at 0400. Eleven trials, every candidate file, every measurement taken against the control. Scheduled, countersigned, routine.'},
      {speaker:'OPERATIVE',text:'Routine.'},
      {speaker:'ARCHIVIST',text:'They only scrub a baseline when they have stopped measuring against it.'},
      {speaker:'VECTOR',text:'The disposal team is four hours in. Whatever is still on that relay is what you can carry off it.'}
    ],
    debrief:[
      {speaker:'ARCHIVIST',text:'Three fragments. Enough to count.'},
      {speaker:'VECTOR',text:'Count what.'},
      {speaker:'ARCHIVIST',text:'Trials. There are eleven on the ledger and the numbering starts at zero.'},
      {speaker:'VECTOR',text:'That is twelve.'},
      {speaker:'ARCHIVIST',text:'That is twelve, and only eleven have closed.'}
    ],
    document:{
      id:'doc_scrub',name:'DISPOSAL SCHEDULE',classification:'ADMIN // RECOVERED',
      body:'Records disposal is authorised for the Glasshouse evaluation series on the closure of the final trial. Retention of candidate files past that point serves no ongoing programme requirement. Note that the control file is scheduled alongside the candidate files rather than retained, which is inconsistent with the control being a serving asset. Query raised. Query closed without comment.'
    }
  },
  {
    id:'op8',index:8,act:2,name:'DEAD CHANNEL',
    map:'sunken',duration:10,difficulty:2,
    objective:{type:'rescue'},
    tagline:'The voice on the empty channel has a position, and a pulse.',
    briefing:[
      {speaker:'ARCHIVIST',text:'I stopped trying to decrypt SIGNAL and started trying to locate it. It is not a broadcast. It is a man on a handset in a flooded district, and he has been talking for nine months.'},
      {speaker:'VECTOR',text:'Talking to whom.'},
      {speaker:'ARCHIVIST',text:'To the trial log. He thinks he is still filing.'},
      {speaker:'SIGNAL',text:'— control zero — reporting — reporting — is anyone taking this —'},
      {speaker:'OPERATIVE',text:'Control zero.'},
      {speaker:'ARCHIVIST',text:'You are eleven. He is the one they measured before you.'}
    ],
    debrief:[
      {speaker:'SIGNAL',text:'You are the new one. They told me there would be a new one.'},
      {speaker:'OPERATIVE',text:'They did not tell me there was an old one.'},
      {speaker:'SIGNAL',text:'They never do. That is the measurement. You have to not know, or the number comes out wrong.'},
      {speaker:'ARCHIVIST',text:'His file says deceased. It has said deceased for nine months.'},
      {speaker:'SIGNAL',text:'It is not wrong. They closed me. I just did not stop.'}
    ],
    document:{
      id:'doc_control_zero',name:'CONTROL ZERO',classification:'GLASSHOUSE // PERSONNEL',
      body:'The control designation is not permanent. It transfers on the closure of a trial series, and the outgoing control is closed with it. Closure is administrative. It requires no field action and produces no remains, because the designation is the thing being retired and the man carrying it is incidental to the record. Control zero was closed on schedule. Control zero has continued to transmit for two hundred and seventy-one days, which the ledger notes as a data quality issue.'
    }
  },
  {
    id:'op9',index:9,act:2,name:'CINDER LINE',
    map:'foundry',duration:15,difficulty:2,
    objective:{type:'extract'},
    tagline:'Where the builds come from. Walk it end to end.',
    briefing:[
      {speaker:'ARCHIVIST',text:'Cinder Foundry is on the programme manifest as a fabrication site. I assumed ordnance. It is not ordnance.'},
      {speaker:'VECTOR',text:'Say it.'},
      {speaker:'ARCHIVIST',text:'It is an assembly line for candidates. The prototypes are not designed. They are iterated — a profile goes in one end and whatever comes off the other end gets a trial number.'},
      {speaker:'SIGNAL',text:'I walked it. Do not look at the racks.'},
      {speaker:'VECTOR',text:'Walk it end to end and get off it. That is all.'}
    ],
    debrief:[
      {speaker:'OPERATIVE',text:'The racks were full.'},
      {speaker:'ARCHIVIST',text:'I know.'},
      {speaker:'OPERATIVE',text:'They were all the same build.'},
      {speaker:'ARCHIVIST',text:'They were all the same profile. There is one profile in that facility and it has been iterated four thousand times, and the source of it is a serving operative who was never asked.'},
      {speaker:'VECTOR',text:'Do not say the next part.'},
      {speaker:'ARCHIVIST',text:'You already know the next part.'}
    ],
    document:{
      id:'doc_assembly',name:'ITERATION LOG',classification:'GLASSHOUSE // FABRICATION',
      body:'Candidate production does not proceed from a specification. It proceeds from a reconstructed behavioural profile, iterated against field performance until the divergence from source falls inside tolerance. Four thousand one hundred and six iterations are recorded against the current profile. The tolerance has never been met. The programme notes, without apparent concern, that the profile source continues to outperform every build derived from it, and that this is the reason the series cannot be closed.'
    }
  },
  {
    id:'op10',index:10,act:2,name:'SIXTY-ONE',
    map:'blacksite',duration:15,difficulty:2,
    objective:{type:'recover',caches:4},
    tagline:'Back to the first facility, for the fifty-seven who never left.',
    briefing:[
      {speaker:'ARCHIVIST',text:'Your first contract. Blacksite Zero, closure filed, four departures against a complement of sixty-one.'},
      {speaker:'OPERATIVE',text:'Fifty-seven still drawing hazard pay.'},
      {speaker:'ARCHIVIST',text:'They are not staff. I pulled the intake numbers. Fifty-seven intake numbers, all issued the same week, all against the same profile.'},
      {speaker:'VECTOR',text:'They were candidates.'},
      {speaker:'ARCHIVIST',text:'They were the first fifty-seven iterations, and the facility was not decommissioned. It was left running because nothing in it was ever going to leave.'},
      {speaker:'SIGNAL',text:'That was trial one. I was there for trial one.'}
    ],
    debrief:[
      {speaker:'ARCHIVIST',text:'The hazard pay is not an accounting error. It is a control variable. They kept paying because a candidate that stops being paid stops behaving like the source, and the whole point is that it behaves like the source.'},
      {speaker:'OPERATIVE',text:'They paid fifty-seven copies of me to keep being me.'},
      {speaker:'ARCHIVIST',text:'For nine months. And then they filed a closure and walked out of the building.'},
      {speaker:'VECTOR',text:'I countersigned that closure. I want that on the record before this goes any further.'}
    ],
    document:{
      id:'doc_complement',name:'STANDING COMPLEMENT',classification:'ADMIN // RECOVERED',
      body:'The complement of sixty-one comprises four programme staff and fifty-seven candidates issued against a single profile. Candidate remuneration is maintained post-closure as a behavioural control: withdrawal of pay produces divergence from source within eleven days and invalidates the trial. Facility power is maintained on the same basis. Neither cost is recoverable and neither has been queried, because the line item is filed against a site that was decommissioned on schedule and countersigned.'
    }
  },
  {
    id:'op11',index:11,act:2,name:'TRIAL TWELVE',
    map:'orbital',duration:20,difficulty:3,
    objective:{type:'duel'},
    tagline:'Eleven trials have closed. Nobody told you about the twelfth.',
    briefing:[
      {speaker:'VECTOR',text:'Meridian Platform. Your extraction is scheduled off it in ninety minutes and I need you to understand that I did not write that order.'},
      {speaker:'ARCHIVIST',text:'Trial twelve opened four days ago. Candidate is a full iteration. Control is —'},
      {speaker:'OPERATIVE',text:'Say it.'},
      {speaker:'ARCHIVIST',text:'Control is you, and the trial is already running. It has been running since Arctic Relay. Every contract since the disposal has been a measurement.'},
      {speaker:'VECTOR',text:'I have been reading you a script for eleven operations. I am going to stop doing that now.'},
      {speaker:'SIGNAL',text:'This is the part where they close you. Do not let it be administrative.'}
    ],
    debrief:[
      {speaker:'ARCHIVIST',text:'Trial twelve is logged. Result is unchanged from the previous eleven.'},
      {speaker:'OPERATIVE',text:'The control performs better than the build.'},
      {speaker:'ARCHIVIST',text:'Yes. And the recommendation is unchanged too, which means they will open trial thirteen, and they will need a control, and they have exactly one that has ever passed.'},
      {speaker:'VECTOR',text:'Then we stop being somewhere they can file the paperwork.'},
      {speaker:'SIGNAL',text:'There is one place the paperwork is written. I can give you the room.'}
    ],
    document:{
      id:'doc_trial_twelve',name:'TRIAL TWELVE',classification:'GLASSHOUSE // EVALUATION',
      body:'Trial twelve was opened without notification to the control, consistent with series protocol: an informed control adjusts, and an adjusted control is not a baseline. Measurement was taken across routine field assignments issued through the standing handler. The handler was not informed either. Result matches trials zero through eleven. The recommendation is unchanged and has been unchanged for twelve trials, and the programme has not at any point treated it as a finding.'
    }
  },
  {
    id:'op12',index:12,act:2,name:'GLASSHOUSE',
    map:'proving',duration:20,difficulty:3,
    objective:{type:'extract'},
    tagline:'Not a facility. A room, with a desk, where the war gets written.',
    briefing:[
      {speaker:'SIGNAL',text:'It is not a bunker. It is an office. I stood outside it for six years and never went in, because going in is how you find out you were always a line item.'},
      {speaker:'ARCHIVIST',text:'The Glasshouse is a committee. Twelve trials, four thousand iterations, fifty-seven people paid to keep being someone else — all of it is minutes and countersignatures.'},
      {speaker:'OPERATIVE',text:'Nobody built this.'},
      {speaker:'ARCHIVIST',text:'No. They approved it, on schedule, one item at a time, and every one of them could tell you their part was reasonable.'},
      {speaker:'VECTOR',text:'Walk in. Take the minutes. I will read them out on every channel I have ever been given, and then I am finished being a voice that reads.'}
    ],
    debrief:[
      {speaker:'ARCHIVIST',text:'It is out. All of it — the ledger, the iteration log, the complement, the disposal schedule. Every channel, unencrypted, no redactions.'},
      {speaker:'VECTOR',text:'And?'},
      {speaker:'ARCHIVIST',text:'And nothing has happened. Nine hours and nothing has happened. Nobody has denied it. Nobody has resigned.'},
      {speaker:'SIGNAL',text:'They will not. It was countersigned. That is what countersigning is for.'},
      {speaker:'OPERATIVE',text:'Then it stays out, and I stay a control they cannot file.'},
      {speaker:'VECTOR',text:'Trial thirteen opens without a baseline. Let them measure that.'}
    ],
    document:{
      id:'doc_glasshouse',name:'THE GLASSHOUSE',classification:'GLASSHOUSE // MINUTES',
      body:'The programme has no author. It has a standing item, reviewed at interval, carried forward by consensus and countersigned by whoever holds the chair that quarter. No individual approval in the record exceeds its own remit and no individual approval, read alone, is unreasonable. Read in sequence they authorise the construction of four thousand people against the profile of a man who was never asked, the retention of fifty-seven of them on hazard pay at a site that does not exist, and the administrative closure of every control who has ever passed the trial. The recommendation has been unchanged for twelve trials. The item remains on the schedule.'
    }
  }
];

export const CAMPAIGN_BY_ID=Object.fromEntries(CAMPAIGN.map(op=>[op.id,op]));

// The campaign runs in two acts. Act I is the audit; Act II is what the
// programme does with the answer it got.
export const ACTS=[
  {number:1,name:'THE AUDIT',
   blurb:'Six contracts, six documents, and the discovery that the operative carrying them is the measurement.'},
  {number:2,name:'THE GLASSHOUSE',
   blurb:'Eleven trials have closed and the recommendation has never changed. This is what a programme does with a baseline it no longer needs.'}
];

export function operationsInAct(number){
  return CAMPAIGN.filter(op=>(op.act||1)===number);
}

// An act opens once every operation in the act before it is closed.
export function actUnlocked(save,number){
  if(number<=1)return true;
  return operationsInAct(number-1).every(op=>save.campaign?.[op.id]?.completed);
}

// The first operation not yet completed, or null once the campaign is done.
export function nextOperation(save){
  return CAMPAIGN.find(op=>!save.campaign?.[op.id]?.completed)||null;
}

export function campaignProgress(save){
  const done=CAMPAIGN.filter(op=>save.campaign?.[op.id]?.completed).length;
  return{done,total:CAMPAIGN.length,pct:done/CAMPAIGN.length,complete:done>=CAMPAIGN.length};
}

// An operation is playable when every operation before it is complete.
export function operationUnlocked(save,op){
  const index=CAMPAIGN.indexOf(op);
  if(index<=0)return true;
  return CAMPAIGN.slice(0,index).every(prior=>save.campaign?.[prior.id]?.completed);
}
