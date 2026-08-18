import {formatTime,clamp} from '../core/math.js';
import {PASSIVES_BY_ID} from '../../data/passives.js';

// In-run HUD. Built once, then updated by mutating only the values that
// changed — the previous build rebuilt strings and re-queried the DOM for
// every element on every single frame.

const template=(operative,ability)=>`
<canvas id="gameCanvas"></canvas>
<div class="hud" id="hud">
  <div class="hud-top">
    <div class="hud-panel vitals">
      <div class="vital-head">
        <span class="op-tag" style="--op:${operative.color}">${operative.codename}</span>
        <span class="hp-text"><b id="hpValue">100</b><i>/</i><span id="hpMax">100</span></span>
      </div>
      <div class="bar hp"><i id="hpBar"></i><u id="hpGhost"></u></div>
      <div class="xp-row">
        <span class="lvl">LV <b id="levelValue">1</b></span>
        <div class="bar xp"><i id="xpBar"></i></div>
        <span class="xp-text" id="xpText">0/22</span>
      </div>
    </div>

    <div class="hud-panel mission">
      <div class="mission-head">
        <span id="mapName">—</span>
        <div class="timer-group">
          <b id="timerValue">00:00</b>
          <span id="extractionTimer" class="extraction-label" hidden>EXTRACT <b>00:00</b></span>
        </div>
      </div>
      <div class="phase" id="phaseValue">INFILTRATION</div>
      <div class="mission-bar"><i id="missionBar"></i></div>
    </div>

    <div class="hud-panel tally">
      <div class="tally-row"><span>ELIM</span><b id="killsValue">0</b></div>
      <div class="tally-row"><span>CR</span><b id="creditsValue">0</b></div>
      <div class="tally-row"><span>JP</span><b id="jpValue">0</b></div>
      <div class="combo" id="comboValue"></div>
    </div>
  </div>

  <div class="boss-bar" id="bossBar" hidden>
    <div class="boss-name"><span id="bossName"></span><em id="bossPhase"></em></div>
    <div class="bar boss"><i id="bossHp"></i></div>
  </div>

  <div class="hud-bottom">
    <div class="loadout" id="loadoutStrip"></div>
    <div class="hud-actions">
      <button class="ability-btn" id="abilityBtn" type="button" title="${ability.desc}">
        <span class="ability-name">${ability.name}</span>
        <span class="ability-state" id="abilityState">READY</span>
        <i class="ability-fill" id="abilityFill"></i>
      </button>
      <button class="dash-btn" id="dashBtn" type="button" title="Dash">
        <span>DASH</span><i class="dash-fill" id="dashFill"></i>
      </button>
      <button class="icon-btn" id="pauseBtn" type="button" title="Pause">❚❚</button>
    </div>
  </div>

  <div class="status-strip" id="statusStrip"></div>
</div>

<div class="stick stick-move" id="stickMove"><span class="stick-ring"></span><span class="stick-knob" id="knobMove"></span></div>
<div class="stick stick-aim" id="stickAim"><span class="stick-ring"></span><span class="stick-knob" id="knobAim"></span></div>
`;

export class Hud{
  constructor(root,engine){
    this.engine=engine;
    this.root=root;
    root.innerHTML=`<div id="gameScreen" class="screen game-screen">${
      template(engine.operative,engine.operative.ability)
    }</div>`;

    const $=id=>document.getElementById(id);
    this.el={
      screen:$('gameScreen'),canvas:$('gameCanvas'),
      hpValue:$('hpValue'),hpMax:$('hpMax'),hpBar:$('hpBar'),hpGhost:$('hpGhost'),
      levelValue:$('levelValue'),xpBar:$('xpBar'),xpText:$('xpText'),
      mapName:$('mapName'),timerValue:$('timerValue'),extractionTimer:$('extractionTimer'),phaseValue:$('phaseValue'),
      missionBar:$('missionBar'),
      killsValue:$('killsValue'),creditsValue:$('creditsValue'),jpValue:$('jpValue'),
      comboValue:$('comboValue'),
      bossBar:$('bossBar'),bossName:$('bossName'),bossPhase:$('bossPhase'),bossHp:$('bossHp'),
      loadoutStrip:$('loadoutStrip'),statusStrip:$('statusStrip'),
      abilityBtn:$('abilityBtn'),abilityState:$('abilityState'),abilityFill:$('abilityFill'),
      dashBtn:$('dashBtn'),dashFill:$('dashFill'),pauseBtn:$('pauseBtn'),
      stickMove:$('stickMove'),knobMove:$('knobMove'),
      stickAim:$('stickAim'),knobAim:$('knobAim')
    };

    this.el.mapName.textContent=engine.map.name;
    this.cache={};
    this.ghostHp=1;
    this.loadoutSignature='';
    this.statusSignature='';
  }

  // Only touch the DOM when a displayed value actually changes.
  set(key,element,value){
    if(this.cache[key]===value)return;
    this.cache[key]=value;
    element.textContent=value;
  }

  update(dt){
    const engine=this.engine;
    const player=engine.player;
    const el=this.el;

    // Vitals — the ghost bar trails the real one to show recent damage.
    const hpRatio=clamp(player.hp/player.maxHp,0,1);
    this.ghostHp+=(hpRatio-this.ghostHp)*Math.min(1,dt*3);
    if(this.ghostHp<hpRatio)this.ghostHp=hpRatio;
    this.set('hp',el.hpValue,String(Math.ceil(player.hp)));
    this.set('hpMax',el.hpMax,String(player.maxHp));
    el.hpBar.style.width=`${hpRatio*100}%`;
    el.hpGhost.style.width=`${this.ghostHp*100}%`;
    el.hpBar.classList.toggle('critical',hpRatio<.3);

    this.set('level',el.levelValue,String(engine.level));
    el.xpBar.style.width=`${clamp(engine.xp/engine.xpNeeded,0,1)*100}%`;
    this.set('xpText',el.xpText,`${Math.floor(engine.xp)}/${engine.xpNeeded}`);

    // Mission.
    if(engine.extraction){
      this.set('timerMission',el.timerValue,formatTime(engine.durationMinutes*60));
      el.timerValue.classList.toggle('urgent',false);
      el.extractionTimer.hidden=false;
      const extractText=el.extractionTimer.querySelector('b');
      this.set('timerExtraction',extractText,formatTime(engine.extractionTimer));
      el.extractionTimer.classList.toggle('urgent',true);
    }else{
      this.set('timer',el.timerValue,formatTime(engine.timeRemaining));
      el.timerValue.classList.toggle('urgent',engine.timeRemaining<30);
      el.extractionTimer.hidden=true;
    }
    this.set('phase',el.phaseValue,engine.director.phaseLabel());
    el.missionBar.style.width=`${engine.director.progress*100}%`;

    this.set('kills',el.killsValue,String(engine.kills));
    this.set('credits',el.creditsValue,String(Math.round(engine.credits)));
    this.set('jp',el.jpValue,String(Math.round(engine.jp)));

    // Combo meter.
    const comboText=engine.combo>=5?`×${engine.combo}`:'';
    this.set('combo',el.comboValue,comboText);
    el.comboValue.classList.toggle('hot',engine.combo>=25);

    // Boss.
    if(engine.boss){
      el.bossBar.hidden=false;
      this.set('bossName',el.bossName,engine.boss.name);
      this.set('bossPhase',el.bossPhase,engine.boss.phase.name);
      el.bossHp.style.width=`${clamp(engine.boss.healthRatio,0,1)*100}%`;
      el.bossBar.classList.toggle('shielded',engine.boss.shieldReduction>0);
    }else if(!el.bossBar.hidden){
      el.bossBar.hidden=true;
    }

    // Ability / dash.
    const abilityRatio=1-clamp(player.abilityCooldown/player.abilityMax,0,1);
    el.abilityFill.style.transform=`scaleX(${abilityRatio})`;
    const abilityReady=player.abilityCooldown<=0;
    this.set('abilityState',el.abilityState,
      abilityReady?'READY':`${player.abilityCooldown.toFixed(1)}s`);
    el.abilityBtn.classList.toggle('ready',abilityReady);

    const dashRatio=1-clamp(player.dashCooldown/1.15,0,1);
    el.dashFill.style.transform=`scaleX(${dashRatio})`;
    el.dashBtn.classList.toggle('ready',player.dashCooldown<=0);

    this.updateLoadout();
    this.updateStatuses();
  }

  updateLoadout(){
    const engine=this.engine;
    // Rebuild only when the loadout composition changes.
    const signature=engine.loadout.weapons.map(w=>`${w.id}:${w.level}`).join(',')+
      '|'+[...engine.loadout.passives].map(([id,rank])=>`${id}:${rank}`).join(',');
    if(signature===this.loadoutSignature)return;
    this.loadoutSignature=signature;

    const weapons=engine.loadout.weapons.map(weapon=>{
      const info=engine.loadout.describe(weapon);
      return `<div class="slot weapon${weapon.evolved?' evolved':''}" title="${weapon.name} — ${weapon.def.desc||''}">
        <span class="slot-icon">${weapon.def.short}</span>
        <span class="slot-meta">
          <b>${weapon.name}</b>
          <i>${weapon.evolved?'EVOLVED':`LV ${weapon.level}`} · ${info.dps} DPS</i>
        </span>
        <span class="slot-level">${weapon.evolved?'★':weapon.level}</span>
      </div>`;
    }).join('');

    const passives=[...engine.loadout.passives].map(([id,rank])=>{
      const passive=PASSIVES_BY_ID[id];
      if(!passive)return '';
      return `<div class="slot passive" title="${passive.desc}">
        <span class="slot-icon small">${passive.icon}</span>
        <span class="slot-rank">${rank}</span>
      </div>`;
    }).join('');

    this.el.loadoutStrip.innerHTML=weapons+(passives?`<div class="slot-divider"></div>${passives}`:'');
  }

  updateStatuses(){
    const engine=this.engine;
    const player=engine.player;
    const active=[];
    if(player.damageBuffTimer>0)active.push(['DMG+',player.damageBuffTimer,'#c79bff']);
    if(player.shieldTimer>0)active.push(['SHIELD',player.shieldTimer,'#ffb35c']);
    if(engine.timeDilation<1)active.push(['DILATION',0,'#ff8d82']);
    for(const [,status] of player.statuses)active.push([status.name.toUpperCase(),status.timer,status.color]);
    if(player.revives>0)active.push([`REVIVE ×${player.revives}`,0,'#76e7d4']);

    const signature=active.map(([name])=>name).join(',');
    if(signature===this.statusSignature&&!active.some(([,timer])=>timer>0))return;
    this.statusSignature=signature;
    this.el.statusStrip.innerHTML=active.map(([name,timer,color])=>
      `<span class="status-pill" style="--c:${color}">${name}${timer>0?` ${timer.toFixed(1)}`:''}</span>`
    ).join('');
  }

  destroy(){
    this.root.innerHTML='';
  }
}
