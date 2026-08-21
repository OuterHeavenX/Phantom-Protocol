import {clamp,damp,dist,dist2,normalize,TAU} from '../core/math.js';
import {WEAPONS_BY_ID} from '../../data/weapons.js';
import {ABILITIES} from './abilities.js';

// A second operative on the ground.
//
// The roster was eight people you could read about and one you could play. A
// squadmate makes one of the other seven present: they carry their own issue
// weapon, they fire their own ability off their own cooldown, and hostiles
// treat them as something worth shooting at. They do not die — they go down,
// and you decide whether reaching them is worth the exposure.
//
// They are deliberately not a second player. The damage multiplier below keeps
// them supporting rather than carrying, and their fire cadence is slower than
// yours, so a contract is still yours to win.

const DAMAGE_SHARE=.72;      // of the weapon's listed damage
const CADENCE=1.3;           // multiplier on the weapon's cooldown
// The operative's own output climbs steeply across a contract — levels,
// support systems, evolutions. A squadmate frozen at their issue weapon's
// printed damage is a decoration by the ten-minute mark, so they track the
// same clock. Deliberately shallower than the player's curve: they should
// still be worth having at the end without ever being the reason you won.
const GROWTH_PER_LEVEL=.11;
const ABILITY_PATIENCE=1.4;  // multiplier on the operative's own cooldown

const LEASH=430;             // beyond this, rejoin the operative before fighting
const REJOIN=210;            // and close to here before returning to the fight
const ENGAGE_FLOOR=340;      // a melee operative still needs somewhere to shoot from

export const REVIVE_RADIUS=76;
export const REVIVE_SECONDS=2.6;
const REVIVE_HP=.45;         // fraction of max returned on being picked up

// Weapons whose real behaviour cannot be expressed as a projectile volley still
// need the squadmate to be doing something legible, so they fire the weapon's
// damage as ordinary rounds. It reads as covering fire, which is what an ally
// at range is for.
function firingProfile(weapon){
  const range=Math.max(ENGAGE_FLOOR,weapon.range||420);
  return{
    damage:(weapon.damage||10)*DAMAGE_SHARE,
    cooldown:Math.max(.22,(weapon.cooldown||.7)*CADENCE),
    speed:weapon.speed||620,
    count:Math.min(4,weapon.count||1),
    spread:weapon.spread??.05,
    pierce:weapon.pierce||0,
    knockback:(weapon.knockback||40)*.6,
    sound:weapon.sound||'shoot',
    range
  };
}

export class Squadmate{
  constructor(engine,operative,spawn){
    this.engine=engine;
    this.operative=operative;
    this.id=operative.id;
    this.codename=operative.codename;
    this.color=operative.color;

    const weapon=WEAPONS_BY_ID[operative.weapon]||WEAPONS_BY_ID.needle;
    this.weapon=weapon;
    this.fire=firingProfile(weapon);

    this.x=spawn.x;this.y=spawn.y;
    this.vx=0;this.vy=0;
    this.radius=12;
    this.angle=-Math.PI/2;
    // Scaled off the contract's difficulty the same way hostile durability is,
    // so an ally on a nightmare deployment is not made of paper.
    this.maxHp=Math.round(operative.hp*.9*(engine.difficulty?.hpMult||1));
    this.hp=this.maxHp;
    this.armor=operative.armor;
    this.speed=operative.speed*.96;

    this.fireTimer=engine.rng.range(0,this.fire.cooldown);
    this.abilityMax=(operative.ability?.cooldown||20)*ABILITY_PATIENCE;
    this.abilityCooldown=this.abilityMax*.5;

    this.downed=false;
    this.reviveProgress=0;
    this.downedFor=0;
    this.invulnerable=0;
    this.hitFlash=0;
    this.walkPhase=0;
    this.strafeDir=engine.rng.bool()?1:-1;
    this.strafeTimer=0;

    // Its own tally, so the results screen can say what they were worth.
    this.kills=0;
    this.damageDealt=0;

    // Present for the ability implementations, which are written against the
    // player object and read these without asking whose they are.
    this.statuses=new Map();
    this.shieldTimer=0;this.shieldAngle=0;this.shieldReflect=false;
    this.damageBuff=1;this.damageBuffTimer=0;
    this.dashTimer=0;this.knockbackResist=1;
  }

  get alive(){return !this.downed}

  update(dt){
    const engine=this.engine;
    this.hitFlash=Math.max(0,this.hitFlash-dt);
    this.invulnerable=Math.max(0,this.invulnerable-dt);

    if(this.downed){
      this.downedFor+=dt;
      this.vx=damp(this.vx,0,8,dt);
      this.vy=damp(this.vy,0,8,dt);
      this.updateRevive(dt);
      return;
    }

    this.abilityCooldown=Math.max(0,this.abilityCooldown-dt);
    this.fireTimer-=dt;
    this.strafeTimer-=dt;
    if(this.strafeTimer<=0){
      this.strafeTimer=engine.rng.range(1.4,3.2);
      this.strafeDir*=-1;
    }

    const target=this.acquire();
    this.move(dt,target);
    if(target){
      this.angle=Math.atan2(target.y-this.y,target.x-this.x);
      if(this.fireTimer<=0)this.shoot(target);
      if(this.abilityCooldown<=0)this.useAbility(target);
    }

    this.x+=this.vx*dt;
    this.y+=this.vy*dt;
    engine.world.resolveCollision(this,this.radius);
    this.x=clamp(this.x,this.radius,engine.world.width-this.radius);
    this.y=clamp(this.y,this.radius,engine.world.height-this.radius);
    this.walkPhase+=dt*Math.min(1,Math.hypot(this.vx,this.vy)/90)*7;
  }

  // Nearest live hostile inside the weapon's reach, preferring whatever is
  // already shooting at them.
  acquire(){
    const engine=this.engine;
    const reach=this.fire.range;
    const found=engine.enemyHash.nearest(this.x,this.y,reach,e=>!e.dead);
    if(found)return found;
    const boss=engine.boss;
    if(boss&&!boss.dead&&dist2(this.x,this.y,boss.x,boss.y)<reach*reach)return boss;
    return null;
  }

  move(dt,target){
    const player=this.engine.player;
    const toPlayer=dist(this.x,this.y,player.x,player.y);

    // The leash comes first: an ally who wanders off to fight is an ally who
    // is not where you need them, and who dies alone.
    let desiredX,desiredY,speed=this.speed;
    if(toPlayer>LEASH||(this.rejoining&&toPlayer>REJOIN)){
      this.rejoining=toPlayer>REJOIN;
      desiredX=player.x;desiredY=player.y;
      speed*=1.25;
    }else if(target){
      this.rejoining=false;
      // Hold at a working distance, strafing rather than standing still.
      const preferred=Math.max(120,this.fire.range*.55);
      const angle=Math.atan2(this.y-target.y,this.x-target.x);
      const orbit=angle+this.strafeDir*.5;
      desiredX=target.x+Math.cos(orbit)*preferred;
      desiredY=target.y+Math.sin(orbit)*preferred;
    }else{
      this.rejoining=false;
      // Nothing to shoot: take station off the operative's shoulder.
      const behind=Math.atan2(player.y-this.y,player.x-this.x)+Math.PI;
      desiredX=player.x+Math.cos(behind+this.strafeDir*.6)*74;
      desiredY=player.y+Math.sin(behind+this.strafeDir*.6)*74;
    }

    const delta=normalize(desiredX-this.x,desiredY-this.y);
    const gap=dist(this.x,this.y,desiredX,desiredY);
    const throttle=clamp(gap/60,0,1);
    // Never crowd the operative — two bodies in one doorway helps nobody.
    const crowding=toPlayer<44?-.7:1;
    this.vx=damp(this.vx,delta.x*speed*throttle*crowding,7,dt);
    this.vy=damp(this.vy,delta.y*speed*throttle*crowding,7,dt);
  }

  // What one round is worth right now, against the operative's level.
  get shotDamage(){
    const level=Math.max(1,this.engine.level||1);
    // Fireteam Doctrine rides on top of the level curve rather than replacing
    // it, so the branch is worth the same proportion late as it is early.
    return this.fire.damage*(1+GROWTH_PER_LEVEL*(level-1))*(this.engine.squadDamageMult??1);
  }

  shoot(target){
    const engine=this.engine;
    const profile=this.fire;
    if(!engine.world.hasLineOfSight(this.x,this.y,target.x,target.y))return;
    this.fireTimer=profile.cooldown;
    const damage=this.shotDamage;

    const base=Math.atan2(target.y-this.y,target.x-this.x);
    for(let i=0;i<profile.count;i++){
      const spread=(engine.rng.next()-.5)*profile.spread*2
        +(profile.count>1?(i-(profile.count-1)/2)*profile.spread:0);
      const angle=base+spread;
      engine.spawnPlayerProjectile({
        x:this.x+Math.cos(angle)*this.radius,
        y:this.y+Math.sin(angle)*this.radius,
        vx:Math.cos(angle)*profile.speed,
        vy:Math.sin(angle)*profile.speed,
        damage,
        radius:4,
        pierce:profile.pierce,
        knockback:profile.knockback,
        color:this.color,
        life:Math.max(.5,profile.range/profile.speed),
        // Marked so kills and damage are credited to the ally rather than to
        // whatever the operative happens to be carrying.
        ally:this
      });
    }
    engine.audio.play(profile.sound,{volume:.28});
  }

  useAbility(target){
    const engine=this.engine;
    const id=this.operative.ability?.id;
    const ability=ABILITIES[id];
    if(!ability)return;
    // Worth spending only when it has something to land on.
    if(dist2(this.x,this.y,target.x,target.y)>360*360)return;
    this.abilityCooldown=this.abilityMax;
    try{
      ability(engine,this);
    }catch(err){
      // An ability that cannot run for an ally must not take the run down
      // with it; the squadmate simply keeps shooting.
      console.warn('[red-static] squadmate ability failed',id,err);
    }
    engine.codec?.fire('squadAbility');
  }

  updateRevive(dt){
    const engine=this.engine;
    const player=engine.player;
    const near=player.alive&&dist2(player.x,player.y,this.x,this.y)<REVIVE_RADIUS**2;
    if(near){
      // Fireteam Doctrine shortens the time spent kneeling over them.
      this.reviveProgress=Math.min(1,this.reviveProgress+dt/(REVIVE_SECONDS*(engine.squadReviveMult??1)));
      if(this.reviveProgress>=1)this.revive();
    }else{
      this.reviveProgress=Math.max(0,this.reviveProgress-dt*.6);
    }
  }

  revive(){
    const engine=this.engine;
    this.downed=false;
    this.downedFor=0;
    this.reviveProgress=0;
    this.hp=Math.round(this.maxHp*REVIVE_HP);
    this.invulnerable=1.6;
    this.abilityCooldown=Math.max(this.abilityCooldown,this.abilityMax*.5);
    engine.fx.ring(this.x,this.y,10,80,.5,this.color,3);
    engine.audio.play('heal',{volume:.7});
    engine.announce(`${this.codename} BACK ON THEIR FEET`,this.color,2);
    engine.codec?.fire('squadRevived');
  }

  damage(amount,options={}){
    if(this.downed||this.invulnerable>0)return 0;
    const armor=this.armor;
    let final=Math.max(1,amount*(1-clamp(armor/(armor+42),0,.6)));
    this.hp-=final;
    this.hitFlash=.16;
    this.engine.fx.blood(this.x,this.y,'#ff9b6b',.6);
    if(this.hp<=0)this.down();
    return final;
  }

  down(){
    const engine=this.engine;
    this.downed=true;
    this.hp=0;
    this.reviveProgress=0;
    this.downedFor=0;
    this.vx=0;this.vy=0;
    engine.fx.ring(this.x,this.y,8,64,.5,'#ff7068',3);
    engine.audio.play('hurt',{volume:.9});
    engine.announce(`${this.codename} IS DOWN`,'#ff7068',2.6);
    engine.codec?.fire('squadDown');
  }
}
