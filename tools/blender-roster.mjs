// Export the actual content registry for the Blender authoring script.
import {writeFileSync,mkdirSync} from 'node:fs';
import {OPERATIVES} from '../data/operatives.js';
import {ENEMIES,ELITES,CHOPPER,CARRIER} from '../data/enemies.js';
import {BOSSES} from '../data/bosses.js';
const roster=[
  ...OPERATIVES.map(x=>({...x,key:`op-${x.id}`,kind:'operative'})),
  ...[...ENEMIES,CHOPPER,CARRIER].map(x=>({...x,key:`enemy-${x.id}`,kind:x.render})),
  ...ELITES.map(x=>({...x,key:`elite-${x.id}`,kind:x.render,elite:true})),
  ...BOSSES.map(x=>({...x,key:`boss-${x.id}`,kind:x.render})),
  {key:'boss-nemesis',id:'nemesis',name:'NEMESIS',kind:'nemesis',color:'#e0533f'}
];
mkdirSync('assets/models',{recursive:true});
writeFileSync('assets/models/roster.json',JSON.stringify(roster.map(({key,id,name,codename,kind,color,weapon,elite})=>({key,id,name:codename||name,kind,color,weapon,elite})),null,2)+'\n');
