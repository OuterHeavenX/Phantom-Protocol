import {OPERATIVES,masteryProgress,masteryRank,MASTERY_RANKS} from '../../data/operatives.js';
import {WEAPONS,EVOLUTIONS,WEAPON_RARITY,MAX_WEAPON_LEVEL,weaponUnlockLevel} from '../../data/weapons.js';
import {PASSIVES,MAX_PASSIVE_LEVEL} from '../../data/passives.js';
import {MAPS,DURATIONS,DIFFICULTIES,DIFFICULTIES_BY_ID} from '../../data/maps.js';
import {ENEMIES,ELITES} from '../../data/enemies.js';
import {BOSSES_BY_ID} from '../../data/bosses.js';
import {
  DEV_TREE,devNodeCost,devRequirementsMet,devBonuses,accountLevel,
  ACHIEVEMENTS,ACHIEVEMENT_CATEGORIES,MILESTONES,INTEL_FILES
} from '../../data/meta.js';
import {
  readMetric,achievementProgress,milestoneProgress,purchaseDevNode,respecDev,
  unlockedOperatives,unlockedMaps,unlockedDifficulties,
  recruitmentProgress,startRecruitment,counselHours,medicalProgress,MEDICAL_HOURS
} from '../save/progression.js';
import {portraitSvg,portraitMarkup,dossierCardMarkup} from '../render/portraits.js';
import {CAMPAIGN,OBJECTIVE_TYPES,nextOperation,campaignProgress,operationUnlocked} from '../../data/campaign.js';
import {activeContracts,resolveDifficulty,timeRemaining} from '../../data/contracts.js';
import {ORDNANCE,ORDNANCE_BY_ID,ORDNANCE_UNLOCK,ordnanceUnlocked} from '../../data/ordnance.js';
import {contractRecord} from '../save/contracts.js';
import {
  SLOTS,slotLabel,attachmentsFor,ATTACHMENTS_BY_ID,defaultBuild,MAX_WEAPON_RANK
} from '../../data/attachments.js';
import {
  resolveBuild,sanitizeBuild,previewStats,buildProfile,
  weaponRank,weaponRankProgress,attachmentUnlocked
} from '../game/gunsmith.js';
import {saveGame,exportSave,importSave,resetSave,defaultSettings} from '../save/storage.js';
import {formatDuration,formatNumber,formatTime,clamp} from '../core/math.js';
import {MenuBackground} from './menuBackground.js';

const root=()=>document.querySelector('#app');
const escape=text=>String(text).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// Menu system. Every screen is a small render function plus a wiring function;
// navigation is keyboard/gamepad friendly and all state changes are persisted.

export class Screens{
  constructor(save,startGame,audio){
    this.save=save;
    this.startGame=startGame;
    this.audio=audio;
    this.background=null;
    this.deployConfig={
      operative:save.profile.lastOperative||'vesper',
      map:save.profile.lastMap||'blacksite',
      duration:save.profile.lastDuration||10,
      difficulty:save.profile.lastDifficulty??1,
      squadmate:save.profile.lastSquadmate||null,
      secondWeapon:null
    };
    this.armoryTab='weapons';
    this.achievementTab='survival';
  }

  setSave(save){this.save=save}

  persist(){saveGame(this.save)}

  click(){this.audio?.play('select')}

  // ---- shell -------------------------------------------------------------

  shell(content,options={}){
    this.teardownBackground();
    root().innerHTML=`
      <div class="screen menu-screen ${options.scan===false?'':'scanlines'}">
        <canvas class="menu-bg" id="menuBg"></canvas>
        ${content}
      </div>`;
    const canvas=document.getElementById('menuBg');
    if(canvas)this.background=new MenuBackground(canvas);
  }

  teardownBackground(){
    this.background?.destroy();
    this.background=null;
  }

  panel(title,subtitle,body,options={}){
    return `
      <div class="panel ${options.wide?'wide':''}">
        <header class="panel-head">
          <div>
            <span class="eyebrow">${escape(options.eyebrow||'STRATEGIC CONFLICT DIVISION')}</span>
            <h2>${escape(title)}</h2>
            <p class="sub">${subtitle}</p>
          </div>
          <div class="panel-actions">
            ${options.actions||''}
            <button class="btn ghost" data-back>← COMMAND</button>
          </div>
        </header>
        <div class="panel-body">${body}</div>
      </div>`;
  }

  wireBack(){
    root().querySelector('[data-back]')?.addEventListener('click',()=>{
      this.click();
      this.menu();
    });
  }

  // ---- main menu ---------------------------------------------------------

  menu(){
    const save=this.save;
    const account=accountLevel(save.profile.accountXp||0);
    const stats=save.statistics;
    const achievementsDone=ACHIEVEMENTS.filter(a=>save.achievements[a.id]).length;
    const milestonesDone=MILESTONES.filter(m=>save.milestones[m.id]).length;
    const nextMilestone=MILESTONES.find(m=>!save.milestones[m.id]);
    const nextProgress=nextMilestone?milestoneProgress(save,nextMilestone):null;

    const nav=[
      ['CAMPAIGN','Story operations and recovered documents','campaign'],
      ['CONTRACTS','Rotating daily and weekly assignments','contracts'],
      ['DEPLOY','Configure and launch an operation','deploy'],
      ['OPERATIVES','Roster, mastery and dossiers','operatives'],
      ['GUNSMITH','Fit optics, barrels and internals','gunsmith'],
      ['ARMORY','Weapons, support systems, evolutions','armory'],
      ['DEVELOPMENT','Spend job points on permanent upgrades','development'],
      ['DIRECTIVES','Milestones and achievements','directives'],
      ['INTELLIGENCE','Recovered files','intel'],
      ['RECORD','Lifetime statistics and run history','stats'],
      ['SETTINGS','Audio, video, controls, data','settings']
    ];

    this.shell(`
      <div class="menu-shell">
        <section class="brand">
          <div class="brand-head">
            <span class="eyebrow">STRATEGIC CONFLICT DIVISION // ACCESS GRANTED</span>
            <h1>RED<br>STATIC</h1>
            <p class="tagline">Enter manufactured conflict zones. Survive the response. Recover intelligence. Determine who is writing the war.</p>
          </div>
          <nav class="nav">
            ${nav.map(([label,hint,route],i)=>`
              <button class="nav-item" data-route="${route}" data-index="${i}">
                <span class="nav-label">${label}</span>
                <span class="nav-hint">${hint}</span>
              </button>`).join('')}
          </nav>
          <div class="brand-foot">
            <span class="eyebrow">BUILD v0.3.0 // FIELD REBUILD</span>
          </div>
        </section>

        <section class="intel-panel">
          <div class="operator-card">
            <div class="operator-head">
              <span class="eyebrow">OPERATOR PROFILE</span>
              <b class="account-level">COMMAND RATING ${account.level}</b>
            </div>
            <div class="bar account"><i style="width:${account.pct*100}%"></i></div>
            <span class="account-xp">${formatNumber(account.current)} / ${formatNumber(account.needed)} XP</span>
          </div>

          <div class="status-grid">
            <div class="statbox"><b>${formatNumber(save.profile.jp)}</b><span>JOB POINTS</span></div>
            <div class="statbox"><b>${formatNumber(save.profile.credits)}</b><span>CREDITS</span></div>
            <div class="statbox"><b>${formatNumber(stats.kills)}</b><span>ELIMINATIONS</span></div>
            <div class="statbox"><b>${stats.wins}</b><span>OPERATIONS CLEARED</span></div>
            <div class="statbox"><b>${stats.bosses}</b><span>SIGNATURES DOWN</span></div>
            <div class="statbox"><b>${formatDuration(stats.playtime)}</b><span>FIELD TIME</span></div>
          </div>

          ${nextMilestone?`
          <div class="next-directive">
            <span class="eyebrow">NEXT DIRECTIVE</span>
            <h4>${escape(nextMilestone.name)}</h4>
            <p>${escape(nextMilestone.desc)}</p>
            <div class="bar mini"><i style="width:${nextProgress.pct*100}%"></i></div>
            <span class="progress-text">${formatNumber(nextProgress.current)} / ${formatNumber(nextProgress.target)}${
              nextMilestone.reward?.unlock?` · unlocks ${nextMilestone.reward.unlock.split(':')[1].toUpperCase()}`:''}</span>
          </div>`:`
          <div class="next-directive complete">
            <span class="eyebrow">DIRECTIVE LADDER</span>
            <h4>ALL DIRECTIVES COMPLETE</h4>
            <p>Every command directive on file has been satisfied.</p>
          </div>`}

          <div class="completion-row">
            <div class="completion">
              <span>ACHIEVEMENTS</span>
              <div class="bar mini"><i style="width:${achievementsDone/ACHIEVEMENTS.length*100}%"></i></div>
              <b>${achievementsDone}/${ACHIEVEMENTS.length}</b>
            </div>
            <div class="completion">
              <span>DIRECTIVES</span>
              <div class="bar mini"><i style="width:${milestonesDone/MILESTONES.length*100}%"></i></div>
              <b>${milestonesDone}/${MILESTONES.length}</b>
            </div>
            <div class="completion">
              <span>INTELLIGENCE</span>
              <div class="bar mini"><i style="width:${Object.keys(save.intelligence).length/INTEL_FILES.length*100}%"></i></div>
              <b>${Object.keys(save.intelligence).length}/${INTEL_FILES.length}</b>
            </div>
          </div>
        </section>
      </div>`);

    root().querySelectorAll('[data-route]').forEach(button=>{
      button.addEventListener('click',()=>{
        this.click();
        this.route(button.dataset.route);
      });
    });
    this.enableKeyboardNav('.nav-item');
  }

  route(name){
    const routes={
      campaign:()=>this.campaign(),
      contracts:()=>this.contracts(),
      gunsmith:()=>this.gunsmith(),
      deploy:()=>this.deploy(),operatives:()=>this.operatives(),
      armory:()=>this.armory(),development:()=>this.development(),
      directives:()=>this.directives(),intel:()=>this.intel(),
      stats:()=>this.stats(),settings:()=>this.settings()
    };
    (routes[name]||(()=>this.menu()))();
  }

  // Arrow/enter navigation for a list of buttons.
  enableKeyboardNav(selector){
    const items=[...root().querySelectorAll(selector)];
    if(!items.length)return;
    let index=0;
    items[0].classList.add('focused');
    const move=step=>{
      items[index].classList.remove('focused');
      index=(index+step+items.length)%items.length;
      items[index].classList.add('focused');
      items[index].scrollIntoView({block:'nearest'});
    };
    const handler=event=>{
      if(event.key==='ArrowDown'||event.key==='ArrowRight'){move(1);event.preventDefault()}
      else if(event.key==='ArrowUp'||event.key==='ArrowLeft'){move(-1);event.preventDefault()}
      else if(event.key==='Enter'){items[index].click();event.preventDefault()}
      else if(event.key==='Escape'){
        const back=root().querySelector('[data-back]');
        if(back)back.click();
      }
    };
    window.addEventListener('keydown',handler);
    this.navHandler&&window.removeEventListener('keydown',this.navHandler);
    this.navHandler=handler;
  }

  // ---- rotating contracts -------------------------------------------------

  // The board. Both contracts are computed from today's date rather than
  // stored, so this screen is a pure read — there is nothing to sync and
  // nothing to expire, and two operators opening it on the same day see the
  // same two assignments.
  contracts(){
    const save=this.save;
    const now=Date.now();
    const list=activeContracts();

    this.shell(this.panel('CONTRACT BOARD',
      'Two standing assignments, drawn from the calendar. Everybody gets the same sector, the same response and the same command signature — the seed comes from the date, not from your machine.',
      `<div class="op-list">
        ${list.map(c=>{
          const record=contractRecord(save,c);
          const resolved=resolveDifficulty(c);
          const remaining=timeRemaining(c,now);
          return `<article class="op-row ${record?.survived?'done':''}">
            <span class="op-index">${c.kind==='weekly'?'WK':'DY'}</span>
            <div class="op-body">
              <span class="eyebrow">${escape(c.label)} · ${escape(c.key)} · RESETS IN ${escape(remaining)}</span>
              <h3>${escape(c.map.name)} · ${escape(c.duration.label)}</h3>
              <p class="muted">${escape(c.modifier.name)} — ${escape(c.modifier.desc)}</p>
              <div class="contract-terms">
                <span>${escape(c.difficulty.name)}</span>
                <span>JP x${resolved.jpMult.toFixed(2)}</span>
                <span>SEED ${c.seed}</span>
              </div>
              ${record?`<p class="muted contract-best">BEST · ${record.survived?'EXTRACTED':'LOST'} · ${record.score.toLocaleString()} pts · ${record.kills} kills · ${record.attempts} attempt${record.attempts===1?'':'s'}</p>`
                      :'<p class="muted contract-best">No attempt recorded.</p>'}
            </div>
            <div class="op-action">
              <button class="btn primary small" data-contract="${escape(c.kind)}">DEPLOY</button>
            </div>
          </article>`;
        }).join('')}
      </div>`,
      {eyebrow:'ASSIGNMENTS',wide:true}));

    this.wireBack();
    root().querySelectorAll('[data-contract]').forEach(button=>{
      button.addEventListener('click',()=>{
        this.click();
        const contract=list.find(c=>c.kind===button.dataset.contract);
        if(!contract)return;
        const operativeId=this.deployConfig.operative;
        this.startGame({
          operative:OPERATIVES.find(o=>o.id===operativeId)||OPERATIVES[0],
          map:contract.map,
          duration:contract.duration.minutes,
          durationSpec:contract.duration,
          // The modifier is folded in here rather than in the engine, so a
          // contract needs no simulation code of its own.
          difficulty:resolveDifficulty(contract),
          primary:this.currentPrimary(),
          seed:contract.seed,
          contract
        });
      });
    });
  }

  // ---- campaign ----------------------------------------------------------

  campaign(){
    const save=this.save;
    const progress=campaignProgress(save);
    const next=nextOperation(save);

    this.shell(this.panel('RED STATIC',
      'The audit, in order. Each operation returns one document; read end to end they are the disclosure.',
      `<div class="campaign-progress">
        <span class="eyebrow">DISCLOSURE ${progress.done}/${progress.total}</span>
        <div class="bar mini"><i style="width:${progress.pct*100}%"></i></div>
      </div>
      <div class="op-list">
        ${CAMPAIGN.map(op=>{
          const record=save.campaign?.[op.id];
          const done=!!record?.completed;
          const unlocked=operationUnlocked(save,op);
          const isNext=next&&next.id===op.id;
          const map=MAPS.find(m=>m.id===op.map);
          if(!unlocked){
            return `<article class="op-row locked">
              <span class="op-index">${String(op.index).padStart(2,'0')}</span>
              <div class="op-body">
                <h3>CLASSIFIED</h3>
                <p class="muted">Preceding operations must be closed before this file opens.</p>
              </div>
            </article>`;
          }
          return `<article class="op-row ${done?'done':''} ${isNext?'next':''}">
            <span class="op-index">${String(op.index).padStart(2,'0')}</span>
            <div class="op-body">
              <span class="eyebrow">${OBJECTIVE_TYPES[op.objective.type].name} · ${escape(map?.name||op.map)}</span>
              <h3>${escape(op.name)}</h3>
              <p class="muted">${escape(op.tagline)}</p>
              ${done?`<div class="op-doc"><b>${escape(op.document.name)}</b><span>${escape(op.document.classification)}</span></div>`:''}
            </div>
            <div class="op-action">
              ${done
                ? `<button class="btn small" data-readdoc="${op.id}">READ FILE</button>`
                : `<button class="btn ${isNext?'primary':''} small" data-startop="${op.id}">BRIEFING</button>`}
            </div>
          </article>`;
        }).join('')}
      </div>
      ${progress.complete?`<p class="campaign-closing muted">
        Every document is recovered. The audit is closed, which is not the same as finished.
      </p>`:''}`,
      {eyebrow:'OPERATIONS',wide:true}));

    this.wireBack();
    root().querySelectorAll('[data-startop]').forEach(button=>{
      button.addEventListener('click',()=>{
        this.click();
        this.briefing(CAMPAIGN.find(op=>op.id===button.dataset.startop));
      });
    });
    root().querySelectorAll('[data-readdoc]').forEach(button=>{
      button.addEventListener('click',()=>{
        this.click();
        this.documentScreen(CAMPAIGN.find(op=>op.id===button.dataset.readdoc),()=>this.campaign());
      });
    });
  }

  // Pre-mission dialogue. Short, skippable, and it states the objective.
  briefing(op){
    if(!op)return this.campaign();
    const map=MAPS.find(m=>m.id===op.map);
    const objective=OBJECTIVE_TYPES[op.objective.type];

    this.shell(`
      <div class="briefing">
        <div class="briefing-inner">
          <span class="eyebrow">OPERATION ${String(op.index).padStart(2,'0')} // ${escape(map?.name||'')}</span>
          <h1>${escape(op.name)}</h1>
          <div class="dialogue">
            ${op.briefing.map((line,index)=>`
              <div class="line speaker-${line.speaker.toLowerCase()}" style="animation-delay:${index*.5}s">
                <b>${line.speaker}</b>
                <p>${escape(line.text)}</p>
              </div>`).join('')}
          </div>
          <div class="objective-card">
            <span class="eyebrow">OBJECTIVE // ${objective.name}</span>
            <p>${escape(objective.summary)}</p>
            <div class="objective-meta">
              <span>THEATRE <b>${escape(map?.name||op.map)}</b></span>
              <span>WINDOW <b>${op.duration} MIN</b></span>
              <span>THREAT <b>${escape(DIFFICULTIES_BY_ID[op.difficulty]?.name||'')}</b></span>
            </div>
          </div>
          <div class="briefing-loadout">
            ${this.primaryPickerMarkup(OPERATIVES.find(o=>o.id===(this.save.profile.lastOperative||'vesper')))}
          </div>

          <div class="button-row center">
            <button class="btn primary large" id="launchOp">DEPLOY</button>
            <button class="btn" id="abortOp">BACK</button>
          </div>
        </div>
      </div>`,{scan:false});

    this.wirePrimaryPicker(()=>this.briefing(op));
    root().querySelector('#abortOp').addEventListener('click',()=>{this.click();this.campaign()});
    root().querySelector('#launchOp').addEventListener('click',()=>{
      this.audio?.play('confirm');
      this.teardownBackground();
      const operativeId=this.save.profile.lastOperative||'vesper';
      this.startGame({
        operative:OPERATIVES.find(o=>o.id===operativeId)||OPERATIVES[0],
        map:MAPS.find(m=>m.id===op.map),
        duration:op.duration,
        durationSpec:DURATIONS.find(d=>d.minutes===op.duration),
        difficulty:DIFFICULTIES_BY_ID[op.difficulty],
        primary:this.currentPrimary(),
        operation:op
      });
    });
  }

  // Post-mission dialogue plus the document the operation returned.
  debrief(op,onDone){
    this.shell(`
      <div class="briefing">
        <div class="briefing-inner">
          <span class="eyebrow">DEBRIEF // OPERATION ${String(op.index).padStart(2,'0')}</span>
          <h1>${escape(op.name)}</h1>
          <div class="dialogue">
            ${op.debrief.map((line,index)=>`
              <div class="line speaker-${line.speaker.toLowerCase()}" style="animation-delay:${index*.5}s">
                <b>${line.speaker}</b>
                <p>${escape(line.text)}</p>
              </div>`).join('')}
          </div>
          <div class="button-row center">
            <button class="btn primary large" id="readDoc">OPEN RECOVERED FILE</button>
          </div>
        </div>
      </div>`,{scan:false});
    root().querySelector('#readDoc').addEventListener('click',()=>{
      this.audio?.play('confirm');
      this.documentScreen(op,onDone);
    });
  }

  documentScreen(op,onDone){
    const doc=op.document;
    this.shell(`
      <div class="briefing document">
        <div class="briefing-inner">
          <span class="eyebrow">${escape(doc.classification)}</span>
          <h1>${escape(doc.name)}</h1>
          <div class="doc-body"><p>${escape(doc.body)}</p></div>
          <div class="button-row center">
            <button class="btn primary" id="closeDoc">CLOSE FILE</button>
          </div>
        </div>
      </div>`,{scan:false});
    root().querySelector('#closeDoc').addEventListener('click',()=>{
      this.click();
      (onDone||(()=>this.campaign()))();
    });
  }


  // The primary weapon carried into a run, with its bench build. Falls back to
  // the operative's own issue weapon when nothing has been selected.
  currentPrimary(){
    const save=this.save;
    const stored=save.profile.lastPrimary;
    const weapon=stored&&WEAPONS.find(w=>w.id===stored.weaponId);
    if(!weapon||!save.weapons[weapon.id]?.unlocked)return null;
    const record=save.weapons[weapon.id];
    const rank=weaponRank(record);
    return{
      weapon,record,rank,
      build:sanitizeBuild(weapon,stored.build||record.build,rank),
      // Kept off the attachment build on purpose — sanitizeBuild rebuilds from
      // the known slot list and would silently drop an unrecognised key.
      ordnance:ORDNANCE_BY_ID[record.ordnance]||ORDNANCE[0]
    };
  }

  // Markup for the loadout strip shown before deployment.
  // The second operative on the ground. Optional — a contract run alone is
  // still the default — and it lists everyone unlocked except whoever is
  // deploying and anyone still in medical.
  squadCandidates(){
    const save=this.save;
    return OPERATIVES.filter(op=>{
      if(op.id===this.deployConfig.operative)return false;
      return !!save.operatives[op.id]?.unlocked;
    });
  }

  squadPickerMarkup(){
    const candidates=this.squadCandidates();
    if(!candidates.length)return '';
    const chosen=this.deployConfig.squadmate;
    return `
      <div class="field-group">
        <label class="eyebrow">SECOND OPERATIVE</label>
        <div class="chip-row compact" id="squadChips">
          <button class="chip small ${chosen?'':'active'}" data-squad="">
            <b>ALONE</b><span>No second on the ground</span>
          </button>
          ${candidates.map(op=>{
            const medical=medicalProgress(this.save,op.id);
            const blocked=medical&&!medical.complete;
            return `<button class="chip small ${chosen===op.id?'active':''}"
                    data-squad="${op.id}" style="--c:${op.color}" ${blocked?'disabled':''}>
              <b>${op.codename}</b>
              <span>${blocked
                ? `IN MEDICAL // ${formatDuration(medical.remaining/1000)}`
                : escape(op.role)}</span>
            </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  primaryPickerMarkup(operative){
    const save=this.save;
    const owned=WEAPONS.filter(w=>save.weapons[w.id]?.unlocked);
    const primary=this.currentPrimary();
    const issue=WEAPONS.find(w=>w.id===operative?.weapon);
    return `<div class="field-group">
      <label class="eyebrow">PRIMARY WEAPON</label>
      <div class="chip-row" id="primaryChips">
        <button class="chip small ${primary?'':'active'}" data-primary="">
          <b>ISSUE</b><span>${escape(issue?.name||'Operative default')}</span>
        </button>
        ${owned.map(w=>{
          const rank=weaponRank(save.weapons[w.id]);
          return `<button class="chip small ${primary?.weapon.id===w.id?'active':''}" data-primary="${w.id}"
                    style="--c:${WEAPON_RARITY[w.rarity]||'#9fb6b8'}">
            <b>${escape(w.name)}</b><span>RANK ${rank}</span>
          </button>`;
        }).join('')}
      </div>
      ${primary?`<div class="primary-fitted">
        ${SLOTS.map(slot=>{
          const fitted=ATTACHMENTS_BY_ID[primary.build[slot.id]];
          if(!fitted||fitted.rank<=1)return '';
          return `<span class="fitted-tag" title="${escape(fitted.desc)}">${escape(fitted.name)}</span>`;
        }).join('')||'<span class="muted small">Stock configuration.</span>'}
      </div>`:''}
    </div>`;
  }

  wirePrimaryPicker(rerender){
    root().querySelectorAll('[data-primary]').forEach(button=>{
      button.addEventListener('click',()=>{
        this.click();
        const id=button.dataset.primary;
        if(!id){
          this.save.profile.lastPrimary=null;
        }else{
          const weapon=WEAPONS.find(w=>w.id===id);
          const record=this.save.weapons[id];
          this.save.profile.lastPrimary={
            weaponId:id,
            build:record.build||defaultBuild(weapon)
          };
        }
        this.persist();
        rerender();
      });
    });
  }

  // ---- gunsmith ----------------------------------------------------------

  // The bench. Left: which weapon. Right: what is fitted to it, what that
  // does to the numbers, and what is still to earn.
  gunsmith(weaponId){
    const save=this.save;
    const owned=WEAPONS.filter(w=>save.weapons[w.id]?.unlocked);
    if(!owned.length)return this.menu();

    this.benchWeapon=weaponId||this.benchWeapon||save.profile.lastPrimary?.weaponId||owned[0].id;
    if(!owned.find(w=>w.id===this.benchWeapon))this.benchWeapon=owned[0].id;

    const weapon=WEAPONS.find(w=>w.id===this.benchWeapon);
    const record=save.weapons[weapon.id];
    const rank=weaponRank(record);
    const progress=weaponRankProgress(record);
    const build=sanitizeBuild(weapon,record.build,rank);
    // Command rating gates which secondary-fire modules the bench will fit.
    const rating=accountLevel(save.profile.accountXp||0).level;
    const stats=previewStats(weapon,build,rank);
    const profile=buildProfile(weapon,build,rank);
    const rarity=WEAPON_RARITY[weapon.rarity]||'#9fb6b8';

    const statRow=entry=>{
      const fmt=v=>entry.key==='cooldown'?`${v.toFixed(2)}s`:
                   entry.key==='spread'?v.toFixed(3):
                   Number.isInteger(v)?String(v):v.toFixed(1);
      const cls=entry.better?'better':entry.worse?'worse':'';
      const pct=Math.round(entry.delta*100);
      return `<div class="gs-stat ${cls}">
        <span>${entry.key.toUpperCase()}</span>
        <b>${fmt(entry.built)}</b>
        ${pct?`<i>${pct>0?'+':''}${pct}%</i>`:'<i></i>'}
      </div>`;
    };

    const bar=(label,value)=>`
      <div class="gs-axis"><span>${label}</span>
        <div class="bar mini"><i style="width:${Math.round(value*100)}%"></i></div>
      </div>`;

    this.shell(this.panel('GUNSMITH',
      'Field experience is held by the weapon, not the operative. Anything earned here is fitted for everyone who carries it.',
      `<div class="gs-layout">
        <aside class="gs-rack">
          <span class="eyebrow">RACK</span>
          ${owned.map(w=>{
            const r=weaponRank(save.weapons[w.id]);
            return `<button class="gs-rack-item ${w.id===weapon.id?'active':''}" data-bench="${w.id}"
                      style="--c:${WEAPON_RARITY[w.rarity]||'#9fb6b8'}">
              <span class="gs-rack-glyph">${w.short}</span>
              <span class="gs-rack-name">${escape(w.name)}</span>
              <span class="gs-rack-rank">R${r}</span>
            </button>`;
          }).join('')}
        </aside>

        <section class="gs-bench">
          <header class="gs-head" style="--c:${rarity}">
            <div>
              <span class="eyebrow">${weapon.category.toUpperCase()} · ${weapon.rarity.toUpperCase()}</span>
              <h3>${escape(weapon.name)}</h3>
              <p class="muted">${escape(weapon.desc)}</p>
            </div>
            <div class="gs-rank">
              <b>RANK ${rank}${rank>=MAX_WEAPON_RANK?' // MAX':''}</b>
              <div class="bar mini"><i style="width:${progress.pct*100}%"></i></div>
              <span class="progress-text">${progress.max?'Fully ranked':
                `${formatNumber(progress.current)} / ${formatNumber(progress.needed)} XP`}</span>
            </div>
          </header>

          <div class="gs-columns">
            <div class="gs-slots">
              ${SLOTS.map(slot=>{
                const fitted=ATTACHMENTS_BY_ID[build[slot.id]];
                const pool=attachmentsFor(slot.id,weapon.category);
                const nextLocked=pool.find(a=>!attachmentUnlocked(a,rank));
                return `<div class="gs-slot" data-slot="${slot.id}">
                  <div class="gs-slot-head">
                    <span class="eyebrow">${slotLabel(slot.id,weapon.category)}</span>
                    ${nextLocked?`<i class="gs-next">NEXT R${nextLocked.rank}</i>`:'<i class="gs-next done">COMPLETE</i>'}
                  </div>
                  <div class="gs-options">
                    ${pool.map(option=>{
                      const unlocked=attachmentUnlocked(option,rank);
                      const active=fitted?.id===option.id;
                      return `<button class="gs-option ${active?'active':''} ${unlocked?'':'locked'}"
                                data-fit="${option.id}" data-slot="${slot.id}"
                                ${unlocked?'':'disabled'}
                                title="${escape(option.desc)}">
                        <b>${escape(option.name)}</b>
                        <span>${unlocked?escape(option.desc):`Locked · rank ${option.rank}`}</span>
                      </button>`;
                    }).join('')}
                  </div>
                </div>`;
              }).join('')}

              <div class="gs-slot" data-slot="ordnance">
                <div class="gs-slot-head">
                  <span class="eyebrow">SECONDARY FIRE</span>
                  <i class="gs-next">R KEY · RIGHT STICK</i>
                </div>
                <div class="gs-options">
                  ${ORDNANCE.map(module=>{
                    const unlocked=ordnanceUnlocked(module.id,rating);
                    const active=(record.ordnance||ORDNANCE[0].id)===module.id;
                    return `<button class="gs-option ${active?'active':''} ${unlocked?'':'locked'}"
                              data-ordnance="${module.id}" ${unlocked?'':'disabled'}
                              title="${escape(module.desc)}">
                      <b>${escape(module.icon)} ${escape(module.name)}</b>
                      <span>${unlocked
                        ? `${escape(module.desc)} · ${module.cooldown}s`
                        : `Locked · command rating ${ORDNANCE_UNLOCK[module.id]}`}</span>
                    </button>`;
                  }).join('')}
                </div>
              </div>
            </div>

            <aside class="gs-readout">
              <span class="eyebrow">AS BUILT</span>
              <div class="gs-stats">${stats.map(statRow).join('')}</div>
              <div class="gs-profile">
                ${bar('POWER',profile.power)}
                ${bar('RATE',profile.rate)}
                ${bar('REACH',profile.reach)}
                ${bar('CONTROL',profile.control)}
              </div>
              <div class="gs-record">
                <span>ELIMINATIONS <b>${formatNumber(record.kills||0)}</b></span>
                <span>DEPLOYMENTS <b>${record.timesTaken||0}</b></span>
                <span>TOTAL XP <b>${formatNumber(record.xp||0)}</b></span>
              </div>
              <div class="button-row">
                <button class="btn small" id="gsReset">STRIP TO STOCK</button>
                <button class="btn small primary" id="gsPrimary">SET AS PRIMARY</button>
              </div>
              ${save.profile.lastPrimary?.weaponId===weapon.id
                ? '<span class="gs-primary-note">Currently deploying with this weapon.</span>':''}
            </aside>
          </div>
        </section>
      </div>`,{eyebrow:'WEAPON BENCH',wide:true}));

    this.wireBack();

    root().querySelectorAll('[data-bench]').forEach(button=>{
      button.addEventListener('click',()=>{this.click();this.gunsmith(button.dataset.bench)});
    });

    root().querySelectorAll('[data-ordnance]').forEach(button=>{
      button.addEventListener('click',()=>{
        if(button.disabled)return;
        this.audio?.play('tech');
        // The module lives on the weapon record rather than in the build, so a
        // weapon keeps the secondary that suits it.
        record.ordnance=button.dataset.ordnance;
        this.persist();
        this.gunsmith(weapon.id);
      });
    });

    root().querySelectorAll('[data-fit]').forEach(button=>{
      button.addEventListener('click',()=>{
        if(button.disabled)return;
        this.audio?.play('tech');
        const next={...build,[button.dataset.slot]:button.dataset.fit};
        record.build=next;
        // Fitting an attachment marks it seen, which clears its "new" badge.
        record.seenAttachments=[...new Set([...(record.seenAttachments||[]),button.dataset.fit])];
        // The primary loadout follows the bench, so a change here is what
        // deploys without needing to be confirmed twice.
        if(save.profile.lastPrimary?.weaponId===weapon.id){
          save.profile.lastPrimary={weaponId:weapon.id,build:next};
        }
        this.persist();
        this.gunsmith(weapon.id);
      });
    });

    root().querySelector('#gsReset')?.addEventListener('click',()=>{
      this.click();
      record.build=defaultBuild(weapon);
      if(save.profile.lastPrimary?.weaponId===weapon.id){
        save.profile.lastPrimary={weaponId:weapon.id,build:record.build};
      }
      this.persist();
      this.gunsmith(weapon.id);
    });

    root().querySelector('#gsPrimary')?.addEventListener('click',()=>{
      this.audio?.play('confirm');
      save.profile.lastPrimary={weaponId:weapon.id,build:record.build||defaultBuild(weapon)};
      this.persist();
      this.gunsmith(weapon.id);
    });
  }

  // ---- deploy ------------------------------------------------------------

  deploy(){
    const save=this.save;
    const operatives=unlockedOperatives(save);
    const maps=unlockedMaps(save);
    const difficulties=unlockedDifficulties(save);

    if(!operatives.find(o=>o.id===this.deployConfig.operative))this.deployConfig.operative=operatives[0].id;
    if(!maps.find(m=>m.id===this.deployConfig.map))this.deployConfig.map=maps[0].id;
    if(!difficulties.find(d=>d.id===this.deployConfig.difficulty))this.deployConfig.difficulty=difficulties[0].id;

    this.shell(this.panel('DEPLOYMENT CONTROL',
      'Select operative, theatre and contract terms. Rewards scale with contract length and threat level.',
      `<div class="deploy-grid">
        <div class="deploy-column">
          <div class="field-group">
            <label class="eyebrow">OPERATIVE</label>
            <div class="chip-row" id="opChips">
              ${operatives.map(op=>`
                <button class="chip ${op.id===this.deployConfig.operative?'active':''}"
                        data-op="${op.id}" style="--c:${op.color}">
                  <b>${op.codename}</b><span>${escape(op.role)}</span>
                </button>`).join('')}
            </div>
          </div>

          ${this.primaryPickerMarkup(OPERATIVES.find(o=>o.id===this.deployConfig.operative))}
          ${this.squadPickerMarkup()}

          <div class="field-group">
            <label class="eyebrow">THEATRE</label>
            <div class="chip-row" id="mapChips">
              ${maps.map(map=>`
                <button class="chip ${map.id===this.deployConfig.map?'active':''}" data-map="${map.id}"
                        style="--c:${map.palette.accent}">
                  <b>${map.name}</b><span>${escape(map.condition)}</span>
                </button>`).join('')}
            </div>
          </div>

          <div class="field-group">
            <label class="eyebrow">CONTRACT LENGTH</label>
            <div class="chip-row compact" id="durChips">
              ${DURATIONS.map(d=>`
                <button class="chip small ${d.minutes===this.deployConfig.duration?'active':''}" data-dur="${d.minutes}">
                  <b>${d.minutes}m</b><span>${d.tag}</span>
                </button>`).join('')}
            </div>
          </div>

          <div class="field-group">
            <label class="eyebrow">THREAT LEVEL</label>
            <div class="chip-row compact" id="diffChips">
              ${DIFFICULTIES.map(d=>{
                const unlocked=save.difficulties[d.id]?.unlocked;
                return `<button class="chip small ${d.id===this.deployConfig.difficulty?'active':''} ${unlocked?'':'locked'}"
                          data-diff="${d.id}" ${unlocked?'':'disabled'}
                          title="${unlocked?escape(d.desc):escape(d.unlock?.label||'Locked')}">
                  <b>${d.name}</b><span>${unlocked?`×${d.jpMult} JP`:'LOCKED'}</span>
                </button>`;
              }).join('')}
            </div>
          </div>

          <button class="btn primary large" id="deployBtn">DEPLOY OPERATIVE</button>
        </div>

        <aside class="deploy-brief" id="deployBrief"></aside>
      </div>`,
      {eyebrow:'OPERATION PLANNING',wide:true}));

    this.wireBack();
    this.renderBrief();

    const bind=(selector,attribute,key,parse=v=>v)=>{
      root().querySelectorAll(selector).forEach(button=>{
        button.addEventListener('click',()=>{
          if(button.disabled)return;
          this.click();
          this.deployConfig[key]=parse(button.dataset[attribute]);
          root().querySelectorAll(selector).forEach(b=>b.classList.remove('active'));
          button.classList.add('active');
          this.renderBrief();
        });
      });
    };
    this.wirePrimaryPicker(()=>this.deploy());
    bind('[data-op]','op','operative');
    bind('[data-squad]','squad','squadmate');
    bind('[data-map]','map','map');
    bind('[data-dur]','dur','duration',Number);
    bind('[data-diff]','diff','difficulty',Number);

    root().querySelector('#deployBtn').addEventListener('click',()=>{
      this.audio?.play('confirm');
      const config=this.deployConfig;
      this.save.profile.lastOperative=config.operative;
      this.save.profile.lastMap=config.map;
      this.save.profile.lastDuration=config.duration;
      this.save.profile.lastDifficulty=config.difficulty;
      this.save.profile.lastSquadmate=config.squadmate||null;
      this.persist();
      this.teardownBackground();
      this.startGame({
        operative:OPERATIVES.find(o=>o.id===config.operative),
        map:MAPS.find(m=>m.id===config.map),
        duration:config.duration,
        durationSpec:DURATIONS.find(d=>d.minutes===config.duration),
        difficulty:DIFFICULTIES_BY_ID[config.difficulty],
        primary:this.currentPrimary(),
        squadmate:config.squadmate?OPERATIVES.find(o=>o.id===config.squadmate):null
      });
    });
  }

  renderBrief(){
    const config=this.deployConfig;
    const operative=OPERATIVES.find(o=>o.id===config.operative);
    const map=MAPS.find(m=>m.id===config.map);
    const duration=DURATIONS.find(d=>d.minutes===config.duration);
    const difficulty=DIFFICULTIES_BY_ID[config.difficulty];
    const boss=BOSSES_BY_ID[map.boss];
    const record=this.save.operatives[operative.id];
    const mastery=masteryProgress(record?.masteryXp||0);
    const payout=Math.round(100*duration.jpMult*difficulty.jpMult);

    const threats=ENEMIES
      .filter(e=>e.tier<=Math.min(4,Math.floor(config.duration/7)+1))
      .slice(0,7)
      .map(e=>`<span class="tag">${e.name}</span>`).join('');

    root().querySelector('#deployBrief').innerHTML=`
      <div class="brief-block">
        <span class="eyebrow">OPERATIVE</span>
        <div class="brief-identity">
          <div class="portrait small">${portraitMarkup(operative,{size:84})}</div>
          <div>
            <h3 style="color:${operative.color}">${operative.codename}</h3>
            <span class="real-name">${escape(operative.name)}</span>
          </div>
        </div>
        <p class="muted">${escape(operative.desc)}</p>
        <div class="stat-bars">
          ${statBar('HEALTH',operative.hp,160)}
          ${statBar('SPEED',operative.speed,240)}
          ${statBar('ARMOR',operative.armor,10)}
        </div>
        <div class="brief-line"><b>TRAIT</b><span>${escape(operative.trait.name)} — ${escape(operative.trait.desc)}</span></div>
        <div class="brief-line"><b>ABILITY</b><span>${escape(operative.ability.name)} — ${escape(operative.ability.desc)} (${operative.ability.cooldown}s)</span></div>
        <div class="brief-line"><b>MASTERY</b><span>Rank ${mastery.rank}${mastery.max?' (MAX)':` — ${formatNumber(mastery.current)}/${formatNumber(mastery.needed)}`}</span></div>
      </div>

      <div class="brief-block">
        <span class="eyebrow">THEATRE</span>
        <h3 style="color:${map.palette.accent}">${map.name}</h3>
        <p class="muted">${escape(map.desc)}</p>
        <div class="brief-line"><b>HAZARDS</b><span>${map.hazards.map(h=>h.replace(/([A-Z])/g,' $1').toUpperCase()).join(', ')||'NONE'}</span></div>
        <div class="brief-line"><b>SIGNATURE</b><span>${boss?escape(boss.name):'UNKNOWN'}</span></div>
      </div>

      <div class="brief-block">
        <span class="eyebrow">CONTRACT</span>
        <div class="brief-line"><b>LENGTH</b><span>${duration.label} — ${escape(duration.desc)}</span></div>
        <div class="brief-line"><b>THREAT</b><span>${difficulty.name} — ${escape(difficulty.desc)}</span></div>
        <div class="brief-line"><b>MODIFIERS</b><span>
          Hostile HP ×${difficulty.hpMult} · Damage ×${difficulty.damageMult} · Density ×${difficulty.densityMult}
        </span></div>
        <div class="payout"><span>ESTIMATED PAYOUT</span><b>${payout} JP</b></div>
      </div>

      <div class="brief-block">
        <span class="eyebrow">EXPECTED CONTACTS</span>
        <div class="tag-row">${threats}</div>
      </div>`;
  }

  // ---- operatives --------------------------------------------------------

  operatives(){
    const save=this.save;
    this.shell(this.panel('OPERATIVE DOSSIERS',
      'Field assets, mastery records and unlock conditions.',
      `<div class="card-grid">
        ${OPERATIVES.map(op=>{
          const record=save.operatives[op.id];
          const unlocked=record?.unlocked;
          const recruitment=recruitmentProgress(save,op.id);
          const mastery=masteryProgress(record?.masteryXp||0);
          const rank=masteryRank(record?.masteryXp||0);
          const nextBonus=MASTERY_RANKS.find(r=>r.rank===rank.rank+1)?.bonus;
          if(!unlocked){
            // Counseling running: the file is in hand, the clock is not.
            if(recruitment){
              return `<article class="card locked operative-card recruiting" style="--c:${op.color}">
                <div class="portrait">${portraitSvg(op,{silhouette:true})}</div>
                <span class="eyebrow">COUNSELING IN SESSION</span>
                <h3>${op.codename}</h3>
                <p class="muted">Psychological clearance underway. The operative deploys when the session closes.</p>
                <div class="bar mini"><i style="width:${recruitment.progress*100}%"></i></div>
                <span class="progress-text">${formatDuration(recruitment.remaining/1000)} remaining</span>
              </article>`;
            }
            // File recovered in the field, counseling not yet scheduled.
            if(record?.discovered){
              return `<article class="card locked operative-card discovered" style="--c:${op.color}">
                <div class="portrait">${portraitSvg(op,{silhouette:true})}</div>
                <span class="eyebrow">FILE RECOVERED</span>
                <h3>${op.codename}</h3>
                <p class="muted">${escape(op.role)} — cleared for counseling. ${counselHours(op.id)} hours to field readiness.</p>
                <button class="btn small counsel-btn" data-counsel="${op.id}">
                  BEGIN COUNSELING // ${counselHours(op.id)}H
                </button>
              </article>`;
            }
            return `<article class="card locked operative-card">
              <div class="portrait">${portraitSvg(op,{silhouette:true,tint:'#9fb6b8'})}</div>
              <span class="eyebrow">ACCESS DENIED</span>
              <h3>CLASSIFIED</h3>
              <p class="muted">Identity compartmentalized. Recover the personnel file in the field, or satisfy the standing condition.</p>
              <div class="unlock-req"><b>REQUIREMENT</b><span>${escape(op.unlock?.label||'Unknown')}</span></div>
              ${op.unlock?`<div class="bar mini"><i style="width:${
                clamp(readMetric(save,op.unlock.stat)/op.unlock.value,0,1)*100}%"></i></div>
                <span class="progress-text">${formatNumber(readMetric(save,op.unlock.stat))} / ${formatNumber(op.unlock.value)}</span>`:''}
            </article>`;
          }
          return `<article class="card operative-card" style="--c:${op.color}">
            <div class="portrait">${portraitMarkup(op)}</div>
            <span class="eyebrow">${escape(op.role)}</span>
            <h3 style="color:${op.color}">${op.codename}</h3>
            <span class="real-name">${escape(op.name)}${op.specialty?` // ${escape(op.specialty)}`:''}</span>
            <p class="muted">${escape(op.desc)}</p>
            ${op.creed?`<p class="creed">${escape(op.creed)}</p>`:''}
            <div class="stat-bars">
              ${statBar('HP',op.hp,160)}
              ${statBar('SPD',op.speed,240)}
              ${statBar('ARM',op.armor,10)}
            </div>
            <div class="brief-line"><b>TRAIT</b><span>${escape(op.trait.name)}</span></div>
            <div class="brief-line"><b>ABILITY</b><span>${escape(op.ability.name)}</span></div>
            <div class="mastery">
              <span class="eyebrow">MASTERY RANK ${mastery.rank}${mastery.max?' // MAX':''}</span>
              <div class="bar mini"><i style="width:${mastery.pct*100}%"></i></div>
              ${nextBonus?`<span class="progress-text">Next: ${escape(nextBonus.label)}</span>`:''}
            </div>
            <div class="record-row">
              <span>RUNS <b>${record.runs||0}</b></span>
              <span>CLEARS <b>${record.wins||0}</b></span>
              <span>KILLS <b>${formatNumber(record.kills||0)}</b></span>
            </div>
            ${op.card?`<button class="btn small ghost file-btn" data-file="${op.id}">
              OPEN PERSONNEL FILE
            </button>`:''}
          </article>`;
        }).join('')}
      </div>`,{eyebrow:'PERSONNEL',wide:true}));
    this.wireBack();
    this.wireCounselButtons(()=>this.operatives());
    root().querySelectorAll('[data-file]').forEach(button=>{
      button.addEventListener('click',()=>{
        this.audio?.play('confirm');
        this.personnelFile(button.dataset.file);
      });
    });
  }

  // The authored dossier card, full size. Everything on it — codename, real
  // name, role, specialty, file code and creed — is painted into the art, so
  // this screen adds nothing but the frame and a way back.
  personnelFile(id){
    const op=OPERATIVES.find(o=>o.id===id);
    if(!op)return this.operatives();
    this.shell(`
      <div class="briefing personnel-file">
        <div class="briefing-inner narrow">
          <span class="eyebrow">PERSONNEL FILE ${escape(op.file||'')} // ${escape(op.role)}</span>
          ${dossierCardMarkup(op)}
          <div class="button-row center">
            <button class="btn primary" id="closeFile">CLOSE FILE</button>
          </div>
        </div>
      </div>`,{scan:false});
    root().querySelector('#closeFile').addEventListener('click',()=>{
      this.click();
      this.operatives();
    });
  }

  // Shared by the roster screen and the debrief: any [data-counsel] button
  // schedules that operative's counseling session and re-renders in place.
  wireCounselButtons(rerender){
    root().querySelectorAll('[data-counsel]').forEach(button=>{
      button.addEventListener('click',()=>{
        const id=button.dataset.counsel;
        if(!startRecruitment(this.save,id))return;
        this.audio?.play('confirm');
        this.persist();
        rerender();
      });
    });
  }

  // ---- armory ------------------------------------------------------------

  armory(){
    const save=this.save;
    const tab=this.armoryTab;
    const tabs=[['weapons','WEAPONS'],['support','SUPPORT SYSTEMS'],['evolutions','EVOLUTIONS'],['threats','THREAT LIBRARY']];

    let body='';
    if(tab==='weapons'){
      body=`<div class="card-grid">${WEAPONS.map(weapon=>{
        const record=save.weapons[weapon.id];
        const unlocked=record?.unlocked;
        const rarity=WEAPON_RARITY[weapon.rarity]||'#9fb6b8';
        if(!unlocked){
          const needed=weaponUnlockLevel(weapon.id);
          const current=accountLevel(save.profile.accountXp||0).level;
          return `<article class="card locked">
            <span class="eyebrow">${weapon.category.toUpperCase()}</span>
            <h3>█████████</h3>
            <p class="muted">Requisition restricted.</p>
            <div class="unlock-req"><b>COMMAND RATING</b><span>${needed}</span></div>
            <div class="bar mini"><i style="width:${clamp(current/needed,0,1)*100}%"></i></div>
            <span class="progress-text">RATING ${current} / ${needed}</span>
          </article>`;
        }
        return `<article class="card weapon-card" style="--c:${rarity}">
          <div class="card-top">
            <span class="weapon-glyph">${weapon.short}</span>
            <div>
              <span class="eyebrow">${weapon.rarity.toUpperCase()} · ${weapon.category.toUpperCase()}</span>
              <h3>${escape(weapon.name)}</h3>
            </div>
          </div>
          <p class="muted">${escape(weapon.desc)}</p>
          <div class="mini-stats">
            <span>DMG <b>${weapon.damage}</b></span>
            <span>${weapon.cooldown?`RATE <b>${weapon.cooldown.toFixed(2)}s</b>`:'CONTINUOUS'}</span>
            <span>MODE <b>${weapon.behavior.toUpperCase()}</b></span>
          </div>
          <div class="record-row">
            <span>BEST LV <b>${record.maxLevel||0}/${MAX_WEAPON_LEVEL}</b></span>
            <span>TAKEN <b>${record.timesTaken||0}</b></span>
            <span>KILLS <b>${formatNumber(record.kills||0)}</b></span>
          </div>
          <div class="bar mini"><i style="width:${(record.maxLevel||0)/MAX_WEAPON_LEVEL*100}%"></i></div>
        </article>`;
      }).join('')}</div>`;
    }else if(tab==='support'){
      body=`<div class="card-grid">${PASSIVES.map(passive=>`
        <article class="card">
          <div class="card-top">
            <span class="weapon-glyph small">${passive.icon}</span>
            <div><span class="eyebrow">SUPPORT SYSTEM</span><h3>${escape(passive.name)}</h3></div>
          </div>
          <p class="muted">${escape(passive.desc)}</p>
          <div class="mini-stats">
            <span>RANK 1 <b>${escape(passive.format(passive.perLevel))}</b></span>
            <span>RANK ${MAX_PASSIVE_LEVEL} <b>${escape(passive.format(passive.perLevel*MAX_PASSIVE_LEVEL))}</b></span>
          </div>
        </article>`).join('')}</div>`;
    }else if(tab==='evolutions'){
      body=`<div class="card-grid">${EVOLUTIONS.map(evolution=>{
        const discovered=save.statistics.uniqueEvolutions?.[evolution.id];
        const base=WEAPONS.find(w=>w.id===evolution.base);
        const passive=PASSIVES.find(p=>p.id===evolution.passive);
        return `<article class="card evolution-card ${discovered?'':'undiscovered'}">
          <span class="eyebrow">${discovered?'RECORDED':'THEORETICAL'}</span>
          <h3>${discovered?escape(evolution.name):'████████'}</h3>
          <div class="fusion">
            <span class="fusion-part">${escape(base?.name||'?')}<i>LV ${MAX_WEAPON_LEVEL}</i></span>
            <span class="fusion-op">+</span>
            <span class="fusion-part">${escape(passive?.name||'?')}<i>RANK ${MAX_PASSIVE_LEVEL}</i></span>
          </div>
          <p class="muted">${discovered?escape(evolution.desc):'Fuse the listed weapon and support system at maximum rank during an operation to record this evolution.'}</p>
        </article>`;
      }).join('')}</div>`;
    }else{
      body=`
        <h3 class="section-title">HOSTILE ARCHETYPES</h3>
        <div class="card-grid">${ENEMIES.map(enemy=>`
          <article class="card threat-card" style="--c:${enemy.color}">
            <span class="eyebrow">TIER ${enemy.tier} · ${enemy.ai.toUpperCase()}</span>
            <h3>${escape(enemy.name)}</h3>
            <p class="muted">${escape(enemy.desc)}</p>
            <div class="mini-stats">
              <span>HP <b>${enemy.hp}</b></span>
              <span>DMG <b>${enemy.damage}</b></span>
              <span>SPD <b>${enemy.speed}</b></span>
            </div>
          </article>`).join('')}</div>
        <h3 class="section-title">ELITE SIGNATURES</h3>
        <div class="card-grid">${ELITES.map(elite=>`
          <article class="card threat-card elite" style="--c:${elite.color}">
            <span class="eyebrow">ELITE</span>
            <h3 style="color:${elite.color}">${escape(elite.name)}</h3>
            <p class="muted">${escape(elite.desc)}</p>
            <div class="tag-row">${elite.modifiers.map(m=>`<span class="tag">${m.replace(/([A-Z])/g,' $1').toUpperCase()}</span>`).join('')}</div>
          </article>`).join('')}</div>
        <h3 class="section-title">COMMAND SIGNATURES</h3>
        <div class="card-grid">${Object.values(BOSSES_BY_ID).map(boss=>{
          const known=save.statistics.bossKills?.[boss.id];
          return `<article class="card threat-card ${known?'':'locked'}" style="--c:${boss.color}">
            <span class="eyebrow">${known?`DEFEATED ×${known}`:'UNENCOUNTERED'}</span>
            <h3 style="color:${boss.color}">${known?escape(boss.name):'████████████'}</h3>
            <p class="muted">${known?escape(boss.title):'No engagement data on file.'}</p>
            ${known?`<div class="mini-stats"><span>HP <b>${formatNumber(boss.hp)}</b></span><span>PHASES <b>${boss.phases.length}</b></span></div>`:''}
          </article>`;
        }).join('')}</div>`;
    }

    this.shell(this.panel('ARMORY',
      'Requisition catalogue, support systems, evolution records and hostile intelligence.',
      `<div class="tabs">${tabs.map(([id,label])=>
        `<button class="tab ${tab===id?'active':''}" data-tab="${id}">${label}</button>`).join('')}</div>
       ${body}`,{eyebrow:'REQUISITION',wide:true}));

    this.wireBack();
    root().querySelectorAll('[data-tab]').forEach(button=>{
      button.addEventListener('click',()=>{
        this.click();
        this.armoryTab=button.dataset.tab;
        this.armory();
      });
    });
  }

  // ---- development -------------------------------------------------------

  development(){
    const save=this.save;
    const ranks=save.dev||{};
    const bonuses=devBonuses(ranks);
    const tiers=[1,2,3,4];
    const branches={offense:'OFFENSE',defense:'DEFENSE',utility:'UTILITY'};

    const summary=Object.entries(bonuses)
      .filter(([,value])=>value)
      .map(([key,value])=>{
        const percent=['damage','fireRate','area','moveSpeed','cooldown','critChance','dodge','luck','xpGain','magnet','creditGain','eliteDamage','detection'].includes(key);
        const text=percent?`${value>0?'+':''}${Math.round(value*100)}%`:`${value>0?'+':''}${Number(value.toFixed(2))}`;
        return `<span class="tag">${key.replace(/([A-Z])/g,' $1').toUpperCase()} ${text}</span>`;
      }).join('');

    this.shell(this.panel('OPERATIVE DEVELOPMENT',
      `Permanent upgrades purchased with job points. Available: <b class="jp">${formatNumber(save.profile.jp)} JP</b>`,
      `<div class="dev-summary">
         <span class="eyebrow">ACTIVE BONUSES</span>
         <div class="tag-row">${summary||'<span class="muted">No development purchased.</span>'}</div>
       </div>
       ${tiers.map(tier=>`
        <div class="dev-tier">
          <div class="tier-label"><span>TIER ${tier}</span></div>
          <div class="dev-row">
            ${DEV_TREE.filter(node=>node.tier===tier).map(node=>{
              const rank=ranks[node.id]||0;
              const maxed=rank>=node.max;
              const available=devRequirementsMet(node,ranks);
              const cost=devNodeCost(node,rank);
              const affordable=save.profile.jp>=cost;
              const state=maxed?'maxed':!available?'blocked':affordable?'ready':'poor';
              return `<button class="dev-node ${state} branch-${node.branch}"
                        data-node="${node.id}" ${maxed||!available?'disabled':''}>
                <span class="node-branch">${branches[node.branch]}</span>
                <h4>${escape(node.name)}</h4>
                <div class="pips">${Array.from({length:node.max},(_,i)=>
                  `<i class="${i<rank?'on':''}"></i>`).join('')}</div>
                <p class="muted">${escape(node.desc)}</p>
                <div class="node-effect">${rank?escape(node.format(rank)):'—'}${
                  maxed?'':` → <b>${escape(node.format(rank+1))}</b>`}</div>
                <span class="node-cost">${maxed?'MASTERED':!available
                  ?`REQUIRES ${node.requires.map(r=>{
                      const [id,need]=r.split(':');
                      return `${DEV_TREE.find(n=>n.id===id)?.name||id} ${need}`;
                    }).join(', ')}`
                  :`${cost} JP`}</span>
              </button>`;
            }).join('')}
          </div>
        </div>`).join('')}`,
      {eyebrow:'PROGRESSION',wide:true,
       actions:`<button class="btn ghost small" id="respecBtn">RESPEC (80% REFUND)</button>`}));

    this.wireBack();
    root().querySelectorAll('[data-node]').forEach(button=>{
      button.addEventListener('click',()=>{
        if(purchaseDevNode(this.save,button.dataset.node)){
          this.audio?.play('confirm');
          this.development();
        }else{
          this.audio?.play('deny');
        }
      });
    });
    root().querySelector('#respecBtn')?.addEventListener('click',()=>{
      if(!confirm('Refund all development ranks for 80% of job points spent?'))return;
      const refund=respecDev(this.save);
      this.audio?.play(refund?'confirm':'deny');
      this.development();
    });
  }

  // ---- directives --------------------------------------------------------

  directives(){
    const save=this.save;
    const category=this.achievementTab;
    const list=ACHIEVEMENTS.filter(a=>a.category===category);
    const done=ACHIEVEMENTS.filter(a=>save.achievements[a.id]).length;

    this.shell(this.panel('DIRECTIVES & ACHIEVEMENTS',
      `Command directives pay job points and unlock content. Achievements: <b>${done}/${ACHIEVEMENTS.length}</b>`,
      `<h3 class="section-title">DIRECTIVE LADDER</h3>
       <div class="directive-ladder">
        ${MILESTONES.map((milestone,index)=>{
          const progress=milestoneProgress(save,milestone);
          const unlock=milestone.reward?.unlock;
          return `<div class="directive ${progress.done?'done':''}">
            <span class="directive-index">${String(index+1).padStart(2,'0')}</span>
            <div class="directive-body">
              <h4>${escape(milestone.name)}</h4>
              <p class="muted">${escape(milestone.desc)}</p>
              <div class="bar mini"><i style="width:${progress.pct*100}%"></i></div>
            </div>
            <div class="directive-reward">
              <b>${milestone.reward.jp} JP</b>
              ${unlock?`<span class="tag">${unlock.split(':')[1].toUpperCase()}</span>`:''}
              <span class="progress-text">${formatNumber(progress.current)}/${formatNumber(progress.target)}</span>
            </div>
          </div>`;
        }).join('')}
       </div>

       <h3 class="section-title">ACHIEVEMENTS</h3>
       <div class="tabs">${ACHIEVEMENT_CATEGORIES.map(cat=>{
         const total=ACHIEVEMENTS.filter(a=>a.category===cat.id).length;
         const earned=ACHIEVEMENTS.filter(a=>a.category===cat.id&&save.achievements[a.id]).length;
         return `<button class="tab ${category===cat.id?'active':''}" data-cat="${cat.id}">
           ${cat.name} <i>${earned}/${total}</i></button>`;
       }).join('')}</div>
       <div class="card-grid tight">
        ${list.map(achievement=>{
          const progress=achievementProgress(save,achievement);
          return `<article class="card achievement ${progress.done?'earned':''}">
            <span class="eyebrow">${progress.done?'EARNED':'IN PROGRESS'}</span>
            <h4>${escape(achievement.name)}</h4>
            <p class="muted">${escape(achievement.desc)}</p>
            <div class="bar mini"><i style="width:${progress.pct*100}%"></i></div>
            <div class="achievement-foot">
              <span class="progress-text">${formatNumber(progress.current)}/${formatNumber(progress.target)}</span>
              <b>${achievement.reward.jp} JP</b>
            </div>
          </article>`;
        }).join('')}
       </div>`,
      {eyebrow:'COMMAND OBJECTIVES',wide:true}));

    this.wireBack();
    root().querySelectorAll('[data-cat]').forEach(button=>{
      button.addEventListener('click',()=>{
        this.click();
        this.achievementTab=button.dataset.cat;
        this.directives();
      });
    });
  }

  // ---- intelligence ------------------------------------------------------

  intel(){
    const save=this.save;
    const recovered=Object.keys(save.intelligence).length;
    this.shell(this.panel('INTELLIGENCE DATABASE',
      `Recovered fragments // ${recovered} of ${INTEL_FILES.length} files accessible. Additional material is recovered through field performance.`,
      `<div class="intel-list">
        ${INTEL_FILES.map(file=>{
          const unlocked=save.intelligence[file.id];
          const current=readMetric(save,file.metric);
          return `<article class="intel-file ${unlocked?'':'locked'}">
            <div class="intel-head">
              <span class="eyebrow">${unlocked?escape(file.classification):'ENCRYPTED'}</span>
              <h3>${unlocked?escape(file.name):'████████████'}</h3>
            </div>
            ${unlocked
              ?`<p class="intel-body">${escape(file.body)}</p>`
              :`<div class="intel-locked">
                  <p class="muted">Decryption threshold not met.</p>
                  <div class="bar mini"><i style="width:${clamp(current/Math.max(1,file.target),0,1)*100}%"></i></div>
                  <span class="progress-text">${formatNumber(current)} / ${formatNumber(file.target)} ${file.metric}</span>
                </div>`}
          </article>`;
        }).join('')}
      </div>`,{eyebrow:'CLASSIFIED MATERIAL',wide:true}));
    this.wireBack();
  }

  // ---- statistics --------------------------------------------------------

  stats(){
    const save=this.save;
    const s=save.statistics;
    const rate=s.missions?Math.round(s.wins/s.missions*100):0;
    const account=accountLevel(save.profile.accountXp||0);

    const groups=[
      ['OPERATIONS',[
        ['MISSIONS RUN',s.missions],['CLEARED',s.wins],['FAILED',s.losses],
        ['SUCCESS RATE',`${rate}%`],['COMMAND RATING',account.level],
        ['FIELD TIME',formatDuration(s.playtime)]
      ]],
      ['COMBAT',[
        ['ELIMINATIONS',formatNumber(s.kills)],['ELITES',formatNumber(s.eliteKills)],
        ['SIGNATURES',s.bosses],['CRITICAL HITS',formatNumber(s.criticalHits)],
        ['DAMAGE DEALT',formatNumber(s.damageDealt)],['DAMAGE TAKEN',formatNumber(s.damageTaken)]
      ]],
      ['RECORDS',[
        ['LONGEST SURVIVAL',formatTime(s.longestSurvival)],['HIGHEST LEVEL',s.highestLevel],
        ['BEST RUN KILLS',formatNumber(s.maxKillsInRun)],['BEST COMBO',s.maxCombo],
        ['MOST HOSTILES AT ONCE',s.maxAlive],['FLAWLESS RUNS',s.perfectRuns]
      ]],
      ['PROGRESSION',[
        ['TOTAL JP',formatNumber(s.totalJp)],['TOTAL CREDITS',formatNumber(s.totalCredits)],
        ['EVOLUTIONS FORGED',s.evolutionsForged],['WEAPONS MASTERED',readMetric(save,'weaponsMaxed')],
        ['DEV RANKS',readMetric(save,'devRanks')],['INTEL RECOVERED',readMetric(save,'intelRecovered')]
      ]],
      ['FIELD CRAFT',[
        ['DISTANCE',`${(s.distanceTravelled/1000).toFixed(1)} km`],['DASHES',formatNumber(s.dashes)],
        ['ABILITIES USED',formatNumber(s.abilitiesUsed)],['PICKUPS',formatNumber(s.pickups)],
        ['HAZARD KILLS',formatNumber(s.hazardKills)],['PHANTOM KILLS',formatNumber(s.minionKills)]
      ]]
    ];

    const history=(save.runHistory||[]).slice().reverse().slice(0,12);

    this.shell(this.panel('FIELD RECORD',
      'Lifetime telemetry archive and recent operation log.',
      `${groups.map(([title,rows])=>`
        <h3 class="section-title">${title}</h3>
        <div class="stat-grid">
          ${rows.map(([label,value])=>`
            <div class="stat-cell"><span>${label}</span><b>${value}</b></div>`).join('')}
        </div>`).join('')}

       <h3 class="section-title">RECENT OPERATIONS</h3>
       ${history.length?`<div class="history">
         <div class="history-row head">
           <span>RESULT</span><span>OPERATIVE</span><span>THEATRE</span>
           <span>THREAT</span><span>TIME</span><span>KILLS</span><span>LV</span><span>JP</span>
         </div>
         ${history.map(run=>`
          <div class="history-row ${run.victory?'win':'loss'}">
            <span>${run.victory?'CLEARED':'FAILED'}</span>
            <span>${(OPERATIVES.find(o=>o.id===run.operative)?.codename)||run.operative}</span>
            <span>${(MAPS.find(m=>m.id===run.map)?.name)||run.map}</span>
            <span>${DIFFICULTIES_BY_ID[run.difficulty]?.name||run.difficulty}</span>
            <span>${formatTime(run.elapsed)}</span>
            <span>${formatNumber(run.kills)}</span>
            <span>${run.level}</span>
            <span>${run.jp}</span>
          </div>`).join('')}
       </div>`:'<p class="muted">No operations on file.</p>'}`,
      {eyebrow:'TELEMETRY',wide:true}));
    this.wireBack();
  }

  // ---- settings ----------------------------------------------------------

  settings(){
    const settings=this.save.settings;
    const slider=(id,label,value,min=0,max=1,step=.05,suffix='%')=>`
      <div class="setting">
        <label>${label}<b id="${id}Value">${suffix==='%'?Math.round(value*100)+'%':value}</b></label>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
      </div>`;
    const toggle=(id,label,value,hint='')=>`
      <div class="setting toggle">
        <label for="${id}">${label}${hint?`<i>${hint}</i>`:''}</label>
        <button class="switch ${value?'on':''}" id="${id}" role="switch" aria-checked="${value}"><i></i></button>
      </div>`;
    const select=(id,label,value,options)=>`
      <div class="setting">
        <label>${label}</label>
        <select id="${id}">${options.map(([v,l])=>
          `<option value="${v}" ${String(v)===String(value)?'selected':''}>${l}</option>`).join('')}</select>
      </div>`;

    this.shell(this.panel('SETTINGS',
      'Audio, presentation, accessibility, controls and save data.',
      `<div class="settings-grid">
        <section class="settings-block">
          <h3 class="section-title">AUDIO</h3>
          ${slider('master','Master volume',settings.master)}
          ${slider('music','Music',settings.music)}
          ${slider('sfx','Effects',settings.sfx)}
          ${toggle('muted','Mute all',settings.muted)}
        </section>

        <section class="settings-block">
          <h3 class="section-title">PRESENTATION</h3>
          ${select('particles','Effect density',settings.particles,[['low','LOW'],['medium','MEDIUM'],['high','HIGH']])}
          ${slider('screenShake','Screen shake',settings.screenShake,0,1.5,.1)}
          ${toggle('damageNumbers','Damage numbers',settings.damageNumbers)}
          ${toggle('showMinimap','Minimap',settings.showMinimap)}
          ${toggle('showHealthBars','Hostile health bars',settings.showHealthBars)}
          ${toggle('showThreatIndicators','Threat & awareness markers',settings.showThreatIndicators)}
          ${toggle('showFps','Performance readout',settings.showFps)}
          ${toggle('codec','Codec traffic',settings.codec!==false,'Radio chatter between the operative and command during a contract')}
        </section>

        <section class="settings-block">
          <h3 class="section-title">ACCESSIBILITY</h3>
          ${toggle('reducedFlashing','Reduce flashing',settings.reducedFlashing,'Dampens screen flashes and low-health pulse')}
          ${toggle('performanceMode','Performance mode',settings.performanceMode,'Fewer hostiles, no lighting pass')}
          ${slider('uiScale','Interface scale',settings.uiScale,.8,1.4,.05,'x')}
        </section>

        <section class="settings-block">
          <h3 class="section-title">CONTROLS</h3>
          ${toggle('autoAim','Auto-target',settings.autoAim,'Weapons acquire targets when not manually aiming')}
          ${toggle('leftHanded','Left-handed touch layout',settings.leftHanded)}
          ${slider('touchSize','Touch control size',settings.touchSize,.7,1.5,.05,'x')}
          <div class="control-legend">
            <span><b>WASD / Arrows</b> Move</span>
            <span><b>Mouse</b> Aim</span>
            <span><b>Shift / Space</b> Dash</span>
            <span><b>E / Q</b> Ability</span>
            <span><b>Esc / P</b> Pause</span>
            <span><b>1–4</b> Select adaptation</span>
            <span><b>R</b> Reroll adaptation</span>
            <span><b>Gamepad</b> Twin-stick supported</span>
          </div>
        </section>

        <section class="settings-block">
          <h3 class="section-title">SAVE DATA</h3>
          <div class="button-row">
            <button class="btn" id="exportBtn">EXPORT SAVE</button>
            <button class="btn" id="importBtn">IMPORT SAVE</button>
            <button class="btn ghost" id="defaultsBtn">RESTORE DEFAULTS</button>
            <button class="btn danger" id="resetBtn">RESET ALL PROGRESS</button>
          </div>
          <p class="muted">Save data is stored locally in this browser. Export produces a portable code.</p>
        </section>
      </div>`,{eyebrow:'CONFIGURATION',wide:true}));

    this.wireBack();
    this.wireSettings();
  }

  wireSettings(){
    const settings=this.save.settings;
    const commit=()=>{
      this.persist();
      this.audio?.applySettings({
        master:settings.master,music:settings.music,
        sfx:settings.sfx,muted:settings.muted
      });
      document.documentElement.style.setProperty('--ui-scale',settings.uiScale);
    };

    for(const id of ['master','music','sfx','screenShake','uiScale','touchSize']){
      const input=document.getElementById(id);
      if(!input)continue;
      input.addEventListener('input',()=>{
        settings[id]=Number(input.value);
        const label=document.getElementById(`${id}Value`);
        if(label){
          label.textContent=['master','music','sfx'].includes(id)
            ?`${Math.round(settings[id]*100)}%`
            :settings[id];
        }
        commit();
      });
    }

    for(const id of ['muted','damageNumbers','showMinimap','showHealthBars',
                     'showThreatIndicators','showFps','codec','reducedFlashing',
                     'performanceMode','autoAim','leftHanded']){
      const button=document.getElementById(id);
      if(!button)continue;
      button.addEventListener('click',()=>{
        settings[id]=!settings[id];
        button.classList.toggle('on',settings[id]);
        button.setAttribute('aria-checked',String(settings[id]));
        this.click();
        commit();
      });
    }

    document.getElementById('particles')?.addEventListener('change',event=>{
      settings.particles=event.target.value;
      commit();
    });

    document.getElementById('exportBtn')?.addEventListener('click',()=>{
      const code=exportSave(this.save);
      // Clipboard where available, prompt as the universal fallback.
      navigator.clipboard?.writeText(code).then(
        ()=>alert('Save code copied to clipboard.'),
        ()=>prompt('Copy your save code:',code)
      )||prompt('Copy your save code:',code);
    });

    document.getElementById('importBtn')?.addEventListener('click',()=>{
      const code=prompt('Paste a save code:');
      if(!code)return;
      try{
        this.save=importSave(code);
        saveGame(this.save);
        this.audio?.play('confirm');
        this.onSaveReplaced?.(this.save);
        this.menu();
      }catch{
        this.audio?.play('deny');
        alert('That save code could not be read.');
      }
    });

    document.getElementById('defaultsBtn')?.addEventListener('click',()=>{
      this.save.settings=defaultSettings();
      this.persist();
      this.settings();
    });

    document.getElementById('resetBtn')?.addEventListener('click',()=>{
      if(!confirm('Permanently erase all Red Static progress? This cannot be undone.'))return;
      this.save=resetSave();
      this.onSaveReplaced?.(this.save);
      this.menu();
    });
  }

  // ---- results -----------------------------------------------------------

  results(summary,payout,config){
    const save=this.save;
    const awards=payout.awards||[];
    const account=accountLevel(save.profile.accountXp||0);
    // Files recovered this run that still need a counseling session booked.
    // An operative whose standing unlock condition also landed this run is
    // already on the roster, so no session is owed.
    const recovered=(payout.recovered||[])
      .map(id=>OPERATIVES.find(op=>op.id===id))
      .filter(op=>{
        const record=op&&save.operatives[op.id];
        return record&&!record.unlocked&&!record.recruitment;
      });

    const breakdown=[
      ['SURVIVAL TIME',formatTime(summary.elapsed)],
      ['ELIMINATIONS',formatNumber(summary.kills)],
      ['ELITE KILLS',summary.eliteKills],
      ['OBJECTIVES CLEARED',summary.objectivesCleared||0],
      ['VAULTS BREACHED',`${summary.vaultsBreached||0}/${summary.vaultsFound||0}`],
      ['TURRETS DEPLOYED',summary.turretsDeployed||0],
      ['COMMAND SIGNATURES',summary.bossesDefeated.length],
      ['LEVEL REACHED',summary.level],
      ['BEST COMBO',summary.maxCombo],
      ['DAMAGE DEALT',formatNumber(summary.damageDealt)],
      ['DAMAGE TAKEN',formatNumber(summary.damageTaken)]
    ];

    this.shell(`
      <div class="results ${summary.victory?'victory':'defeat'}">
        <div class="results-inner">
          <span class="eyebrow">${summary.victory?'EXTRACTION CONFIRMED':'OPERATIVE SIGNAL LOST'}</span>
          <h1>${summary.victory?'OPERATION COMPLETE':'OPERATION FAILED'}</h1>
          <p class="results-reason">${escape(summary.reason||'')}</p>

          <div class="payout-row">
            <div class="payout-cell"><span>JOB POINTS</span><b>+${formatNumber(payout.jp)}</b></div>
            <div class="payout-cell"><span>CREDITS</span><b>+${formatNumber(payout.credits)}</b></div>
            <div class="payout-cell"><span>COMMAND XP</span><b>+${formatNumber(payout.accountXp)}</b></div>
            <div class="payout-cell"><span>RATING</span><b>${account.level}</b></div>
          </div>

          <div class="results-columns">
            <section>
              <h3 class="section-title">PERFORMANCE</h3>
              <div class="stat-grid compact">
                ${breakdown.map(([label,value])=>
                  `<div class="stat-cell"><span>${label}</span><b>${value}</b></div>`).join('')}
              </div>
            </section>

            ${summary.squad?.length?`
            <section>
              <h3 class="section-title">SECOND OPERATIVE</h3>
              <div class="loadout-list">
                ${summary.squad.map(mate=>`
                  <div class="loadout-row ${mate.downed?'passive':''}" style="--c:${mate.color}">
                    <span style="color:${mate.color}">${mate.codename}</span>
                    <i>${mate.downed
                      ? `LEFT BEHIND // ${MEDICAL_HOURS}H MEDICAL`
                      : `${mate.kills} ELIM`}</i>
                    <b>${formatNumber(mate.damageDealt)}</b>
                  </div>`).join('')}
              </div>
            </section>`:''}

            <section>
              <h3 class="section-title">FINAL LOADOUT</h3>
              <div class="loadout-list">
                ${summary.weapons.map(weapon=>`
                  <div class="loadout-row ${weapon.evolved?'evolved':''}">
                    <span>${escape(weaponName(weapon.form))}</span>
                    <i>${weapon.evolved?'EVOLVED':`LV ${weapon.level}`}</i>
                    <b>${formatNumber(weapon.damage)}</b>
                  </div>`).join('')}
                ${summary.passives.map(passive=>`
                  <div class="loadout-row passive">
                    <span>${escape(PASSIVES.find(p=>p.id===passive.id)?.name||passive.id)}</span>
                    <i>RANK ${passive.rank}</i>
                  </div>`).join('')}
              </div>
            </section>
          </div>

          ${recovered.length?`
          <section class="recovered">
            <h3 class="section-title">PERSONNEL RECOVERED</h3>
            <div class="recovered-list">
              ${recovered.map(op=>`
                <article class="recovered-card" style="--c:${op.color}">
                  <div class="portrait">${portraitSvg(op,{silhouette:true,size:96})}</div>
                  <div class="recovered-body">
                    <span class="eyebrow">FILE ${op.codename}</span>
                    <p class="muted">Counseling clears this operative for deployment in ${counselHours(op.id)} hours.</p>
                    <button class="btn small counsel-btn" data-counsel="${op.id}">
                      BEGIN COUNSELING // ${counselHours(op.id)}H
                    </button>
                  </div>
                </article>`).join('')}
            </div>
          </section>`:''}

          ${awards.length?`
          <section class="awards">
            <h3 class="section-title">EARNED THIS OPERATION</h3>
            <div class="award-list">
              ${awards.map(award=>`
                <div class="award award-${award.type}">
                  <span class="award-type">${award.type.toUpperCase()}</span>
                  <b>${escape(award.name)}</b>
                  ${award.jp?`<i>+${award.jp} JP</i>`:''}
                </div>`).join('')}
            </div>
          </section>`:''}

          <div class="button-row center">
            <button class="btn primary" id="againBtn">RUN AGAIN</button>
            <button class="btn" id="commandBtn">RETURN TO COMMAND</button>
          </div>
        </div>
      </div>`,{scan:false});

    this.wireCounselButtons(()=>this.results(summary,payout,config));
    document.getElementById('commandBtn').addEventListener('click',()=>{
      this.click();
      this.menu();
    });
    document.getElementById('againBtn').addEventListener('click',()=>{
      this.audio?.play('confirm');
      this.teardownBackground();
      this.startGame(config);
    });
  }
}

function statBar(label,value,max){
  const pct=clamp(value/max,0,1)*100;
  return `<div class="stat-bar">
    <span>${label}</span>
    <div class="bar mini"><i style="width:${pct}%"></i></div>
    <b>${value}</b>
  </div>`;
}

function weaponName(id){
  return WEAPONS.find(w=>w.id===id)?.name||
         EVOLUTIONS.find(e=>e.id===id)?.name||id;
}

export {escape as escapeHtml};
