export const PASSIVES=['Targeting Optics','Armored Plating','Combat Stimulants','Tactical Harness','Ammunition Processor','Cooling System','Nanomedical Kit','Signal Amplifier','Magnetic Loader','Mobility Frame','EW Module','Field Scanner','Reactor Weave'];
export const EVOLUTIONS=['Predator Network','Horizon Driver','Glass Rain','Silent Geometry','Black Aurora','Dead Channel','Iron Halo','Witchlight Array','Graviton Choir','Cerberus Bloom','Ash Meridian'];
export const ENEMIES=['Patrol Scout','Rifle Cell','Shield Trooper','Pursuit Drone','Hunter Drone','Longshot Sniper','Breacher Heavy','Signal Jammer','Crawler Robot','Veil Operative','Augment Marauder','Mortar Team'];
export const ELITES=['Null Hunter','Iron Vicar','Signal Warden','Glass Hound','Red Auditor'];
export const BOSSES=['MANTICORE SIEGE PLATFORM','CARRION ARRAY','AEGIS BREAKER'];
export const MAPS=[
{id:'blacksite',name:'BLACKSITE ZERO',condition:'Subterranean research complex',color:'#18313a'},
{id:'arctic',name:'ARCTIC RELAY',condition:'Cryogenic communications base',color:'#27414f'},
{id:'sunken',name:'SUNKEN DISTRICT',condition:'Flooded coastal exclusion zone',color:'#123b3d'}
];
export const DURATIONS=[5,10,15,20,25,30];
export const MILESTONES=Array.from({length:64},(_,i)=>({id:`m${i+1}`,name:i<8?`Survive ${[1,3,5,10,15,20,25,30][i]} minute${i? 's':''}`:`Directive Milestone ${String(i+1).padStart(2,'0')}`,reward:i%5===0?'CLASSIFIED UNLOCK':i%3===0?'100 JP':'Intel Fragment'}));
export const ACHIEVEMENTS=Array.from({length:72},(_,i)=>({id:`a${i+1}`,name:['Survival','Elimination','Weapon','Evolution','Secrets','Mastery'][i%6]+` Protocol ${i+1}`,desc:`Complete classified performance condition ${String(i+1).padStart(2,'0')}.`}));
