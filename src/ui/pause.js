import {formatTime,formatNumber} from '../core/math.js';
import {PASSIVES_BY_ID} from '../../data/passives.js';

// In-run pause overlay: live loadout readout, run telemetry and quick settings.
// The previous build's pause was a button that froze the loop with no UI.

export class PauseMenu{
  constructor(engine,save,callbacks){
    this.engine=engine;
    this.save=save;
    this.callbacks=callbacks;
    this.element=null;
  }

  get open(){return !!this.element}

  toggle(){this.open?this.close():this.show()}

  show(){
    if(this.open)return;
    const engine=this.engine;
    engine.paused=true;

    const weapons=engine.loadout.weapons.map(weapon=>{
      const info=engine.loadout.describe(weapon);
      return `<div class="pause-item ${weapon.evolved?'evolved':''}">
        <span class="pause-glyph">${weapon.def.short}</span>
        <div>
          <b>${weapon.name}</b>
          <i>${weapon.evolved?'EVOLVED':`LEVEL ${weapon.level}`} · ${info.damage} dmg · ${info.dps} dps</i>
        </div>
      </div>`;
    }).join('');

    const passives=[...engine.loadout.passives].map(([id,rank])=>{
      const passive=PASSIVES_BY_ID[id];
      if(!passive)return '';
      return `<div class="pause-item">
        <span class="pause-glyph small">${passive.icon}</span>
        <div><b>${passive.name}</b><i>RANK ${rank} · ${passive.format(passive.perLevel*rank)}</i></div>
      </div>`;
    }).join('');

    const stats=engine.stats;
    const derived=[
      ['DAMAGE',`${Math.round(stats.damage*100)}%`],
      ['FIRE RATE',`${Math.round(stats.fireRate*100)}%`],
      ['AREA',`${Math.round(stats.area*100)}%`],
      ['COOLDOWN',`${Math.round(stats.cooldown*100)}%`],
      ['MOVE SPEED',`${Math.round(stats.moveSpeed*100)}%`],
      ['CRIT CHANCE',`${Math.round(stats.critChance*100)}%`],
      ['ARMOR',Math.round(engine.player.armor)],
      ['REGEN',`${(stats.regen||0).toFixed(1)}/s`],
      ['MAGNET',`${Math.round(stats.magnet*100)}%`],
      ['LUCK',`${Math.round(stats.luck*100)}%`]
    ];

    const element=document.createElement('div');
    element.className='overlay pause-overlay';
    element.innerHTML=`
      <div class="pause-panel">
        <header class="pause-head">
          <div>
            <span class="eyebrow">OPERATION PAUSED</span>
            <h2>${engine.map.name}</h2>
          </div>
          <div class="pause-timer">
            <b>${formatTime(engine.extraction?engine.extractionTimer:engine.timeRemaining)}</b>
            <span>${engine.director.phaseLabel()}</span>
          </div>
        </header>

        <div class="pause-grid">
          <section>
            <h3 class="section-title">LOADOUT</h3>
            <div class="pause-list">${weapons}${passives?`<hr>${passives}`:''}</div>
          </section>

          <section>
            <h3 class="section-title">DERIVED STATS</h3>
            <div class="stat-grid compact">
              ${derived.map(([label,value])=>
                `<div class="stat-cell"><span>${label}</span><b>${value}</b></div>`).join('')}
            </div>
            <h3 class="section-title">THIS OPERATION</h3>
            <div class="stat-grid compact">
              <div class="stat-cell"><span>ELIMINATIONS</span><b>${formatNumber(engine.kills)}</b></div>
              <div class="stat-cell"><span>LEVEL</span><b>${engine.level}</b></div>
              <div class="stat-cell"><span>BEST COMBO</span><b>${engine.maxCombo}</b></div>
              <div class="stat-cell"><span>DAMAGE</span><b>${formatNumber(engine.telemetry.damageDealt)}</b></div>
              <div class="stat-cell"><span>CREDITS</span><b>${formatNumber(engine.credits)}</b></div>
              <div class="stat-cell"><span>JP</span><b>${formatNumber(engine.jp)}</b></div>
            </div>
          </section>
        </div>

        <div class="pause-quick">
          ${quickToggle('pauseDamageNumbers','Damage numbers',this.save.settings.damageNumbers)}
          ${quickToggle('pauseMinimap','Minimap',this.save.settings.showMinimap)}
          ${quickToggle('pauseMuted','Mute audio',this.save.settings.muted)}
          ${quickToggle('pauseShake','Screen shake',this.save.settings.screenShake>0)}
        </div>

        <div class="button-row center">
          <button class="btn primary" id="resumeBtn">RESUME</button>
          <button class="btn danger" id="abortBtn">ABORT OPERATION</button>
        </div>
        <p class="muted center small">Aborting forfeits this operation. Job points earned so far are still credited.</p>
      </div>`;

    document.getElementById('gameScreen').append(element);
    this.element=element;

    element.querySelector('#resumeBtn').addEventListener('click',()=>this.close());
    element.querySelector('#abortBtn').addEventListener('click',()=>{
      if(!confirm('Abort the operation and return to command?'))return;
      this.close();
      engine.finish(false,'OPERATION ABORTED BY OPERATOR');
    });

    const bindToggle=(id,key,onChange)=>{
      element.querySelector(`#${id}`)?.addEventListener('click',event=>{
        const button=event.currentTarget;
        const next=!button.classList.contains('on');
        button.classList.toggle('on',next);
        onChange(next);
        this.callbacks.onSettingsChange?.();
      });
    };
    bindToggle('pauseDamageNumbers','damageNumbers',v=>{this.save.settings.damageNumbers=v});
    bindToggle('pauseMinimap','showMinimap',v=>{this.save.settings.showMinimap=v});
    bindToggle('pauseMuted','muted',v=>{this.save.settings.muted=v});
    bindToggle('pauseShake','screenShake',v=>{this.save.settings.screenShake=v?1:0});

    engine.audio.play('select');
  }

  close(){
    if(!this.element)return;
    this.element.remove();
    this.element=null;
    this.engine.paused=false;
    // Reset the frame accumulator so the sim does not fast-forward.
    this.engine.accumulator=0;
  }
}

function quickToggle(id,label,value){
  return `<button class="switch labelled ${value?'on':''}" id="${id}"><i></i><span>${label}</span></button>`;
}
