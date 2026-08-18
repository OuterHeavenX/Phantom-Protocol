import {WEAPONS,MAX_WEAPON_LEVEL,MAX_WEAPON_SLOTS,evolutionFor} from '../../data/weapons.js';
import {PASSIVES,MAX_PASSIVE_LEVEL,MAX_PASSIVE_SLOTS} from '../../data/passives.js';

// Field adaptation (level-up) offer screen.
//
// The previous build offered the same three hard-coded options every level.
// This builds a weighted pool from what the player actually owns and what is
// unlocked, respects slot limits, highlights evolution-enabling picks, and
// supports rerolls and banishes earned from the development tree.

const RARITY={
  common:{name:'STANDARD',color:'#9fb6b8',weight:100},
  uncommon:{name:'UNCOMMON',color:'#76e7d4',weight:56},
  rare:{name:'RARE',color:'#7db2ff',weight:26},
  prototype:{name:'PROTOTYPE',color:'#c79bff',weight:10},
  classified:{name:'CLASSIFIED',color:'#ffb35c',weight:3}
};

export class LevelUpScreen{
  constructor(engine,save){
    this.engine=engine;
    this.save=save;
    this.banished=new Set();
    this.element=null;
  }

  // Build the pool of legal offers for the current state.
  buildPool(){
    const engine=this.engine;
    const loadout=engine.loadout;
    const pool=[];
    const weaponSlotsFull=loadout.weapons.length>=MAX_WEAPON_SLOTS;
    const passiveSlotsFull=loadout.passives.size>=MAX_PASSIVE_SLOTS;

    for(const weapon of WEAPONS){
      if(this.banished.has(`weapon:${weapon.id}`))continue;
      if(!this.save.weapons[weapon.id]?.unlocked)continue;
      const owned=loadout.weapons.find(w=>w.id===weapon.id);
      if(owned){
        if(owned.evolved||owned.level>=MAX_WEAPON_LEVEL)continue;
        const evolution=evolutionFor(weapon.id);
        // Flag the pick that would complete an evolution.
        const enablesEvolution=evolution&&owned.level===MAX_WEAPON_LEVEL-1&&
          loadout.passiveLevel(evolution.passive)>=MAX_PASSIVE_LEVEL;
        pool.push({
          kind:'weapon',id:weapon.id,name:weapon.name,
          rarity:weapon.rarity,
          headline:`LEVEL ${owned.level+1}`,
          desc:weapon.levelText?weapon.levelText(owned.level+1):weapon.desc,
          sub:weapon.desc,
          icon:weapon.short,
          weight:RARITY[weapon.rarity].weight*1.35,
          evolution:enablesEvolution?evolution:null
        });
      }else if(!weaponSlotsFull){
        pool.push({
          kind:'weapon',id:weapon.id,name:weapon.name,
          rarity:weapon.rarity,
          headline:'NEW WEAPON',
          desc:weapon.desc,
          sub:`${weapon.category.toUpperCase()} · ${weapon.behavior.toUpperCase()}`,
          icon:weapon.short,
          weight:RARITY[weapon.rarity].weight,
          isNew:true
        });
      }
    }

    for(const passive of PASSIVES){
      if(this.banished.has(`passive:${passive.id}`))continue;
      const rank=loadout.passiveLevel(passive.id);
      if(rank>=MAX_PASSIVE_LEVEL)continue;
      if(!rank&&passiveSlotsFull)continue;
      const nextValue=passive.perLevel*(rank+1);
      pool.push({
        kind:'passive',id:passive.id,name:passive.name,
        rarity:rank>=4?'rare':rank>=2?'uncommon':'common',
        headline:rank?`RANK ${rank+1}`:'NEW SUPPORT',
        desc:passive.format(nextValue),
        sub:passive.desc,
        icon:passive.icon,
        weight:(rank?70:52)
      });
    }

    // Consolation options guarantee the screen is never empty.
    pool.push({
      kind:'heal',id:'heal',name:'Field Medical',rarity:'common',
      headline:'RECOVERY',desc:'Restore 40% of maximum health.',
      sub:'Immediate field treatment.',icon:'✚',weight:26
    });
    pool.push({
      kind:'credits',id:'credits',name:'Requisition Draw',rarity:'common',
      headline:'+250 CREDITS',desc:'Immediate credit transfer.',
      sub:'Supply contract payout.',icon:'$',weight:18,value:250
    });

    return pool;
  }

  // Weighted sample without replacement, luck-biased toward rarer entries.
  roll(){
    const engine=this.engine;
    const pool=this.buildPool();
    const count=engine.extraChoice?4:3;
    const luck=engine.stats.luck||1;
    const picks=[];
    const remaining=pool.slice();

    // Guarantee an evolution-enabling option appears when one exists.
    const evolutionPick=remaining.find(entry=>entry.evolution);
    if(evolutionPick){
      picks.push(evolutionPick);
      remaining.splice(remaining.indexOf(evolutionPick),1);
    }

    while(picks.length<count&&remaining.length){
      let total=0;
      for(const entry of remaining){
        total+=entry.weight*(entry.rarity==='common'?1:luck);
      }
      let value=engine.rng.next()*total;
      let chosen=remaining[remaining.length-1];
      for(const entry of remaining){
        value-=entry.weight*(entry.rarity==='common'?1:luck);
        if(value<=0){chosen=entry;break}
      }
      picks.push(chosen);
      remaining.splice(remaining.indexOf(chosen),1);
    }
    return picks;
  }

  show(onPick){
    this.onPick=onPick;
    this.options=this.roll();
    this.render();
  }

  render(){
    const engine=this.engine;
    this.destroy();

    const cards=this.options.map((option,index)=>{
      const rarity=RARITY[option.rarity]||RARITY.common;
      return `<button class="adapt-card rarity-${option.rarity}" data-index="${index}" style="--rarity:${rarity.color}">
        ${option.evolution?`<span class="evolution-flag">EVOLUTION READY // ${option.evolution.name}</span>`:''}
        <span class="adapt-rarity">${rarity.name}</span>
        <span class="adapt-icon">${option.icon}</span>
        <h3>${option.name}</h3>
        <span class="adapt-headline">${option.headline}</span>
        <p class="adapt-desc">${option.desc}</p>
        <p class="adapt-sub">${option.sub||''}</p>
        <span class="adapt-key">${index+1}</span>
        ${engine.banishes>0?`<span class="banish-btn" data-banish="${index}" title="Remove from this operation's pool">✕</span>`:''}
      </button>`;
    }).join('');

    const element=document.createElement('div');
    element.className='overlay adapt-overlay';
    element.innerHTML=`
      <div class="adapt-panel">
        <div class="adapt-head">
          <span class="eyebrow">FIELD ADAPTATION AVAILABLE</span>
          <h2>LEVEL ${engine.level}</h2>
          <span class="adapt-queue">${engine.pendingLevelUps>1?`${engine.pendingLevelUps-1} more queued`:''}</span>
        </div>
        <div class="adapt-cards">${cards}</div>
        <div class="adapt-tools">
          <button class="tool-btn" id="rerollBtn" ${engine.rerolls>0?'':'disabled'}>
            REROLL <b>${engine.rerolls}</b>
          </button>
          <span class="adapt-hint">1–4 or click to select${engine.banishes>0?` · ✕ to banish (${engine.banishes})`:''}</span>
          <button class="tool-btn ghost" id="skipBtn">SKIP (+120 CR)</button>
        </div>
      </div>`;

    document.getElementById('gameScreen').append(element);
    this.element=element;

    element.querySelectorAll('.adapt-card').forEach(card=>{
      card.addEventListener('click',event=>{
        if(event.target.dataset.banish!==undefined){
          event.stopPropagation();
          this.banish(Number(event.target.dataset.banish));
          return;
        }
        this.pick(Number(card.dataset.index));
      });
    });

    element.querySelector('#rerollBtn')?.addEventListener('click',()=>{
      if(engine.rerolls<=0)return;
      engine.rerolls--;
      engine.audio.play('select');
      this.options=this.roll();
      this.render();
    });

    element.querySelector('#skipBtn').addEventListener('click',()=>{
      engine.credits+=120;
      engine.audio.play('coin');
      // Skipping still consumes the queued level-up.
      engine.pendingLevelUps=Math.max(0,engine.pendingLevelUps-1);
      this.finish();
    });

    this.keyHandler=event=>{
      const index=Number(event.key)-1;
      if(index>=0&&index<this.options.length)this.pick(index);
      if(event.key.toLowerCase()==='r')element.querySelector('#rerollBtn')?.click();
    };
    window.addEventListener('keydown',this.keyHandler);
    engine.audio.play('levelup',{volume:.6});
  }

  banish(index){
    const engine=this.engine;
    if(engine.banishes<=0)return;
    const option=this.options[index];
    engine.banishes--;
    this.banished.add(`${option.kind}:${option.id}`);
    engine.audio.play('deny');
    // Replace the banished card in place.
    this.options=this.roll();
    this.render();
  }

  pick(index){
    const option=this.options[index];
    if(!option)return;
    this.engine.applyUpgrade(option);
    this.finish();
  }

  finish(){
    this.destroy();
    this.onPick?.();
  }

  destroy(){
    if(this.keyHandler){
      window.removeEventListener('keydown',this.keyHandler);
      this.keyHandler=null;
    }
    this.element?.remove();
    this.element=null;
  }
}

export {RARITY};
