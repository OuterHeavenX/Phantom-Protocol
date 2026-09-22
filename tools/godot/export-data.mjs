// Dump the JS data registries to JSON for the Godot port.
//
// The Godot FPS is a presentation change, not a design change: it must play
// from the same numbers the 2D game plays from. Rather than retyping thirty
// weapons and twenty-one archetypes into GDScript (where they would drift the
// first time either side was edited), the registries are exported here and
// read as data on both sides. Functions (`levelText`) do not survive JSON and
// are dropped; they are UI copy, not simulation.
import {writeFileSync,mkdirSync} from 'node:fs';
import {WEAPONS,EVOLUTIONS,weaponVoice} from '../../data/weapons.js';
import {ENEMIES,ELITES,CHOPPER,CARRIER,enemyVoice,enemyChassis} from '../../data/enemies.js';
import {MAPS,HAZARDS,DURATIONS,DIFFICULTIES} from '../../data/maps.js';
import {CAMPAIGN} from '../../data/campaign.js';
import {OPERATIVES} from '../../data/operatives.js';
import {BOSSES} from '../../data/bosses.js';

const OUT=new URL('../../godot/data/',import.meta.url).pathname;
mkdirSync(OUT,{recursive:true});

// Drop functions, keep everything else verbatim.
const plain=v=>JSON.parse(JSON.stringify(v,(k,val)=>typeof val==='function'?undefined:val));

const write=(name,value)=>{
  const path=OUT+name+'.json';
  writeFileSync(path,JSON.stringify(value,null,1)+'\n');
  console.log('wrote',name+'.json',Array.isArray(value)?`${value.length} entries`:'');
};

write('weapons',plain(WEAPONS).map(w=>({...w,voice:weaponVoice(w)})));
write('evolutions',plain(EVOLUTIONS).map(w=>({...w,voice:weaponVoice(w)})));
write('enemies',plain(ENEMIES).map(e=>({...e,voice:enemyVoice(e),chassis:enemyChassis(e)})));
write('elites',plain(ELITES));
write('air',plain({chopper:CHOPPER,carrier:CARRIER}));
write('maps',plain(MAPS));
write('hazards',plain(HAZARDS));
write('durations',plain(DURATIONS));
write('difficulties',plain(DIFFICULTIES));
write('bosses',plain(BOSSES));
write('operatives',plain(OPERATIVES));
// The whole campaign, not just its first entry.
//
// Only op1 was exported while the Godot build could run exactly one contract.
// It now runs them in sequence, and the operation carries the map, the
// duration, the difficulty and the objective, so the list has to come across
// whole or the second contract has nothing to read. op1.json stays beside it
// because the port's opening sector is hand-authored against that file.
write('campaign',plain(CAMPAIGN));
write('op1',plain(CAMPAIGN.find(o=>o.id==='op1')));
