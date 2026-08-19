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
    id:'op1',index:1,name:'COLD OPEN',
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
    id:'op2',index:2,name:'CROSSFALL',
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
    id:'op3',index:3,name:'HOLLOW',
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
    id:'op4',index:4,name:'ASHEN',
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
    id:'op5',index:5,name:'DERELICT',
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
    id:'op6',index:6,name:'PROVING GROUND',
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
  }
];

export const CAMPAIGN_BY_ID=Object.fromEntries(CAMPAIGN.map(op=>[op.id,op]));

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
