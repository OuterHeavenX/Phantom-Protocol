import {TAU} from '../core/math.js';

// Vector sprite library. Every character is drawn procedurally with animated
// limbs, a directional weapon and a ground shadow — no image assets, which
// keeps the project build-free while still reading as an actual soldier
// rather than the flat arrow the previous build used.

// Shared helper: a walking figure with swinging legs and a shouldered weapon.
function drawHumanoid(ctx,options){
  const{
    bodyColor,accentColor,outline='rgba(230,244,242,.55)',
    scale=1,phase=0,moving=1,weapon='rifle',weaponColor=accentColor,
    flash=false,armor=0
  }=options;

  ctx.scale(scale,scale);

  // Legs — counter-swinging, amplitude driven by movement speed.
  const swing=Math.sin(phase)*4.5*moving;
  ctx.strokeStyle=shade(bodyColor,-.35);
  ctx.lineWidth=3.6;
  ctx.lineCap='round';
  ctx.beginPath();
  ctx.moveTo(-1,-3.5);ctx.lineTo(-3+swing*.5,-7.5-swing*.35);
  ctx.moveTo(-1,3.5);ctx.lineTo(-3-swing*.5,7.5+swing*.35);
  ctx.stroke();

  // Torso.
  ctx.fillStyle=flash?'#ffffff':bodyColor;
  ctx.strokeStyle=outline;
  ctx.lineWidth=1.1;
  ctx.beginPath();
  roundedRect(ctx,-4.5,-6,11,12,3);
  ctx.fill();
  ctx.stroke();

  // Chest plating for armored types.
  if(armor>0){
    ctx.fillStyle=shade(accentColor,-.2);
    ctx.globalAlpha=.75;
    ctx.beginPath();
    roundedRect(ctx,-2.5,-5,6.5,10,2);
    ctx.fill();
    ctx.globalAlpha=1;
  }

  // Arms holding the weapon forward.
  ctx.strokeStyle=shade(bodyColor,-.2);
  ctx.lineWidth=3;
  ctx.beginPath();
  ctx.moveTo(1,-4.5);ctx.lineTo(7,-2.5);
  ctx.moveTo(1,4.5);ctx.lineTo(7,2);
  ctx.stroke();

  // Weapon.
  drawWeapon(ctx,weapon,weaponColor);

  // Head — offset back from centre so the figure reads as facing forward.
  ctx.fillStyle=flash?'#ffffff':shade(bodyColor,.18);
  ctx.strokeStyle=outline;
  ctx.lineWidth=1;
  ctx.beginPath();
  ctx.arc(-2.5,0,4.4,0,TAU);
  ctx.fill();
  ctx.stroke();

  // Visor.
  ctx.fillStyle=accentColor;
  ctx.globalAlpha=.9;
  ctx.beginPath();
  roundedRect(ctx,-1.5,-2.4,3.4,4.8,1.4);
  ctx.fill();
  ctx.globalAlpha=1;
}

function drawWeapon(ctx,kind,color){
  ctx.fillStyle=shade(color,-.35);
  ctx.strokeStyle=color;
  ctx.lineWidth=1;
  switch(kind){
    case 'rifle':
      ctx.fillRect(6,-1.6,15,3.2);
      ctx.fillRect(9,1.6,3,2.6);
      break;
    case 'sniper':
      ctx.fillRect(6,-1.4,24,2.8);
      ctx.fillRect(13,-4,5,2.4);   // scope
      ctx.fillRect(11,1.4,3,3);
      break;
    case 'heavy':
      ctx.fillRect(5,-3,18,6);
      ctx.fillStyle=color;
      ctx.fillRect(20,-2,5,4);
      break;
    case 'smg':
      ctx.fillRect(6,-1.4,10,2.8);
      ctx.fillRect(8,1.4,3,3.4);
      break;
    case 'blade':
      ctx.strokeStyle=color;
      ctx.lineWidth=2.2;
      ctx.beginPath();
      ctx.moveTo(6,0);ctx.lineTo(20,-5);
      ctx.stroke();
      break;
    case 'launcher':
      ctx.fillRect(5,-2.6,16,5.2);
      ctx.fillStyle=color;
      ctx.beginPath();ctx.arc(21,0,2.6,0,TAU);ctx.fill();
      break;
    case 'none':
    default:break;
  }
}

function roundedRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

// Lighten (t>0) or darken (t<0) a hex colour.
function shade(hex,t){
  const parsed=parseHex(hex);
  if(!parsed)return hex;
  const mix=t>=0?255:0;
  const amount=Math.abs(t);
  const r=Math.round(parsed.r+(mix-parsed.r)*amount);
  const g=Math.round(parsed.g+(mix-parsed.g)*amount);
  const b=Math.round(parsed.b+(mix-parsed.b)*amount);
  return `rgb(${r},${g},${b})`;
}

const hexCache=new Map();
function parseHex(hex){
  if(typeof hex!=='string'||hex[0]!=='#')return null;
  if(hexCache.has(hex))return hexCache.get(hex);
  let value=hex.slice(1);
  if(value.length===3)value=value.split('').map(c=>c+c).join('');
  if(value.length!==6)return null;
  const num=parseInt(value,16);
  const parsed={r:num>>16&255,g:num>>8&255,b:num&255};
  hexCache.set(hex,parsed);
  return parsed;
}

export function withAlpha(hex,alpha){
  const parsed=parseHex(hex);
  if(!parsed)return hex;
  return `rgba(${parsed.r},${parsed.g},${parsed.b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Ground shadow, drawn for every entity before the sprite itself.
// ---------------------------------------------------------------------------
export function drawShadow(ctx,x,y,radius,opacity=.34){
  ctx.save();
  ctx.globalAlpha=opacity;
  ctx.fillStyle='#000';
  ctx.beginPath();
  ctx.ellipse(x,y+radius*.55,radius*1.05,radius*.45,0,0,TAU);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
// A squadmate is drawn as the operative they are, one shade quieter than the
// one you are holding, with a nameplate so you can tell at a glance which of
// the roster is out there with you. Downed, they read as a body on the ground
// with a ring that fills while you stand over them.
export function drawSquadmate(ctx,mate,time){
  if(mate.downed){
    drawShadow(ctx,mate.x,mate.y,mate.radius*1.2,.34);
    ctx.save();
    ctx.translate(mate.x,mate.y);
    ctx.globalAlpha=.85;
    ctx.fillStyle='#1b2226';
    ctx.strokeStyle=mate.color;
    ctx.lineWidth=1.4;
    ctx.beginPath();ctx.ellipse(0,2,mate.radius*1.35,mate.radius*.72,.4,0,TAU);
    ctx.fill();ctx.stroke();
    // Revive ring: how much of the pickup is done.
    if(mate.reviveProgress>0){
      ctx.globalAlpha=1;
      ctx.strokeStyle='#8bff9b';
      ctx.lineWidth=2.6;
      ctx.beginPath();
      ctx.arc(0,0,mate.radius*2.1,-Math.PI/2,-Math.PI/2+TAU*mate.reviveProgress);
      ctx.stroke();
    }
    ctx.globalAlpha=.55+Math.sin(time*5)*.2;
    ctx.strokeStyle='#ff7068';
    ctx.lineWidth=1.6;
    ctx.beginPath();ctx.arc(0,0,mate.radius*1.7,0,TAU);ctx.stroke();
    ctx.restore();
    nameplate(ctx,mate,'#ff7068',mate.codename+' DOWN');
    return;
  }

  drawPlayer(ctx,mate,mate.operative,time);
  if(mate.invulnerable>0){
    ctx.save();
    ctx.globalAlpha=.4+Math.sin(time*14)*.2;
    ctx.strokeStyle=mate.color;ctx.lineWidth=1.6;
    ctx.beginPath();ctx.arc(mate.x,mate.y,mate.radius+7,0,TAU);ctx.stroke();
    ctx.restore();
  }
  nameplate(ctx,mate,mate.color,mate.codename);
}

function nameplate(ctx,mate,color,text){
  ctx.save();
  ctx.translate(mate.x,mate.y-mate.radius-16);
  ctx.font='600 9px ui-monospace,monospace';
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillStyle='rgba(3,10,14,.72)';
  const width=ctx.measureText(text).width+10;
  ctx.fillRect(-width/2,-7,width,13);
  ctx.fillStyle=color;
  ctx.fillText(text,0,0);
  // Health, only while it means something.
  if(!mate.downed&&mate.hp<mate.maxHp){
    const barWidth=Math.max(26,width);
    ctx.fillStyle='rgba(255,255,255,.14)';
    ctx.fillRect(-barWidth/2,7,barWidth,2.4);
    ctx.fillStyle=color;
    ctx.fillRect(-barWidth/2,7,barWidth*Math.max(0,mate.hp/mate.maxHp),2.4);
  }
  ctx.restore();
}

export function drawPlayer(ctx,player,operative,time){
  const moving=Math.min(1,Math.hypot(player.vx,player.vy)/120);
  drawShadow(ctx,player.x,player.y,player.radius,.4);

  ctx.save();
  ctx.translate(player.x,player.y);
  ctx.rotate(player.angle);

  // Dash trail wedge.
  if(player.dashTimer>0){
    ctx.save();
    ctx.globalAlpha=.35;
    ctx.fillStyle=operative.color;
    ctx.beginPath();
    ctx.moveTo(-6,-9);ctx.lineTo(-30,0);ctx.lineTo(-6,9);
    ctx.closePath();ctx.fill();
    ctx.restore();
  }

  drawHumanoid(ctx,{
    bodyColor:'#22484c',
    accentColor:operative.color,
    outline:'rgba(200,255,248,.7)',
    scale:1.28,
    phase:player.walkPhase*7,
    moving,
    weapon:WEAPON_LOOK[operative.weapon]||'rifle',
    weaponColor:operative.color,
    flash:player.hitFlash>0,
    armor:1
  });
  ctx.restore();

  // Directional shield arc.
  if(player.shieldTimer>0){
    ctx.save();
    ctx.translate(player.x,player.y);
    ctx.rotate(player.shieldAngle);
    ctx.strokeStyle=withAlpha('#ffb35c',.6+Math.sin(time*8)*.2);
    ctx.lineWidth=4;
    ctx.beginPath();
    ctx.arc(0,0,30,-.9,.9);
    ctx.stroke();
    ctx.strokeStyle=withAlpha('#ffb35c',.18);
    ctx.lineWidth=12;
    ctx.stroke();
    ctx.restore();
  }

  // Invulnerability shimmer.
  if(player.invulnerable>0){
    ctx.save();
    ctx.strokeStyle=withAlpha(operative.color,.35+Math.sin(time*22)*.2);
    ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.arc(player.x,player.y,player.radius+7,0,TAU);
    ctx.stroke();
    ctx.restore();
  }
}

const WEAPON_LOOK={
  needle:'smg',bulwark:'rifle',kite:'none',monofilament:'blade',
  specter:'sniper',scatter:'heavy',vector:'smg',shard:'launcher',
  tripmine:'smg',microwave:'none',emp:'none',sentry:'smg',
  micro:'launcher',rail:'sniper',nanite:'none',lance:'sniper',
  orbital:'launcher',revenant:'blade'
};

// ---------------------------------------------------------------------------
// Enemies — one routine per render kind.
// ---------------------------------------------------------------------------

export function drawEnemy(ctx,enemy,time,settings){
  // Cloaked infiltrators are barely visible until they commit.
  const cloaked=enemy.cloaked;
  ctx.save();
  if(cloaked)ctx.globalAlpha=.22;

  const scale=enemy.radius/11;
  // An aircraft's shadow sits offset and smaller, which is what sells it as
  // being above the deck rather than on it.
  if(enemy.flying)drawShadow(ctx,enemy.x+16,enemy.y+22,enemy.radius*.7,.34);
  else drawShadow(ctx,enemy.x,enemy.y,enemy.radius,cloaked?.1:.3);

  ctx.translate(enemy.x,enemy.y);
  ctx.rotate(enemy.angle);

  const kind=enemy.render||'soldier';
  const renderer=ENEMY_RENDERERS[kind]||ENEMY_RENDERERS.soldier;
  renderer(ctx,enemy,scale,time);

  ctx.restore();

  if(!cloaked)drawEnemyOverlays(ctx,enemy,time,settings);
}

// Rotary gunship, drawn nose-forward along its facing.
function drawChopper(ctx,enemy,scale,time){
  const s=scale*.92;
  const body=enemy.color||'#c8d2d6';

  // Tail boom and stabiliser.
  ctx.fillStyle='#2b3338';
  ctx.strokeStyle=body;
  ctx.lineWidth=1.4;
  ctx.beginPath();roundedRect(ctx,-30*s,-3.5*s,26*s,7*s,3*s);ctx.fill();ctx.stroke();
  ctx.beginPath();roundedRect(ctx,-34*s,-10*s,6*s,20*s,2*s);ctx.fill();ctx.stroke();

  // Fuselage.
  ctx.fillStyle='#3a444a';
  ctx.beginPath();
  ctx.moveTo(20*s,0);
  ctx.quadraticCurveTo(16*s,-11*s,2*s,-11*s);
  ctx.lineTo(-8*s,-8*s);
  ctx.lineTo(-8*s,8*s);
  ctx.lineTo(2*s,11*s);
  ctx.quadraticCurveTo(16*s,11*s,20*s,0);
  ctx.closePath();ctx.fill();ctx.stroke();

  // Canopy.
  ctx.fillStyle=withAlpha('#8fd8ff',.5);
  ctx.beginPath();
  ctx.moveTo(19*s,0);ctx.quadraticCurveTo(14*s,-7*s,6*s,-7*s);
  ctx.lineTo(6*s,7*s);ctx.quadraticCurveTo(14*s,7*s,19*s,0);
  ctx.closePath();ctx.fill();

  // Stub wings with underslung pods.
  ctx.fillStyle='#2b3338';
  ctx.beginPath();roundedRect(ctx,-4*s,-19*s,12*s,8*s,2*s);ctx.fill();ctx.stroke();
  ctx.beginPath();roundedRect(ctx,-4*s,11*s,12*s,8*s,2*s);ctx.fill();ctx.stroke();

  // Main rotor: a fast disc plus blades, so it reads as turning at any speed.
  const spin=enemy.rotor||time*26;
  ctx.save();
  ctx.globalAlpha=.11;
  ctx.fillStyle='#dfe9ee';
  ctx.beginPath();ctx.arc(0,0,34*s,0,TAU);ctx.fill();
  // The blades sit under the disc in weight so the airframe still reads.
  ctx.globalAlpha=.5;
  ctx.strokeStyle='#e6eef2';
  ctx.lineWidth=1.8*s;
  ctx.beginPath();
  for(let i=0;i<4;i++){
    const a=spin+i*(TAU/4);
    ctx.moveTo(0,0);
    ctx.lineTo(Math.cos(a)*34*s,Math.sin(a)*34*s);
  }
  ctx.stroke();
  ctx.restore();

  // Tail rotor.
  ctx.save();
  ctx.translate(-34*s,0);
  ctx.globalAlpha=.6;
  ctx.strokeStyle='#dfe9ee';
  ctx.lineWidth=1.4*s;
  ctx.beginPath();
  for(let i=0;i<3;i++){
    const a=spin*1.7+i*(TAU/3);
    ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*9*s,Math.sin(a)*9*s);
  }
  ctx.stroke();
  ctx.restore();

  // Navigation strobe.
  const blink=(Math.sin(time*5)+1)/2;
  ctx.fillStyle=`rgba(255,90,80,${(.3+blink*.7).toFixed(2)})`;
  ctx.beginPath();ctx.arc(-24*s,0,2.2*s,0,TAU);ctx.fill();
}

const ENEMY_RENDERERS={
  chopper:drawChopper,
  soldier(ctx,enemy,scale,time){
    drawHumanoid(ctx,{
      bodyColor:enemy.color,accentColor:shade(enemy.color,.3),
      scale,phase:enemy.walkPhase,
      moving:Math.min(1,Math.hypot(enemy.vx,enemy.vy)/90),
      weapon:enemy.range?'rifle':'smg',
      weaponColor:shade(enemy.color,.35),
      flash:enemy.hitFlash>0
    });
  },

  shield(ctx,enemy,scale,time){
    drawHumanoid(ctx,{
      bodyColor:enemy.color,accentColor:'#e0c982',
      scale,phase:enemy.walkPhase,moving:.6,
      weapon:'smg',flash:enemy.hitFlash>0,armor:1
    });
    // Ballistic shield on the leading side.
    ctx.save();
    ctx.scale(scale,scale);
    ctx.fillStyle='rgba(200,177,105,.55)';
    ctx.strokeStyle='#e0c982';
    ctx.lineWidth=1.4;
    ctx.beginPath();
    roundedRect(ctx,10,-11,6,22,2);
    ctx.fill();ctx.stroke();
    ctx.strokeStyle='rgba(255,230,160,.5)';
    ctx.beginPath();ctx.moveTo(13,-8);ctx.lineTo(13,8);ctx.stroke();
    ctx.restore();
  },

  sniper(ctx,enemy,scale,time){
    drawHumanoid(ctx,{
      bodyColor:enemy.color,accentColor:'#e6b9d2',
      scale:scale*.96,phase:enemy.walkPhase,moving:.4,
      weapon:'sniper',weaponColor:'#e6b9d2',flash:enemy.hitFlash>0
    });
  },

  heavy(ctx,enemy,scale,time){
    ctx.save();
    ctx.scale(scale*1.18,scale*1.18);
    // Bulky exoskeleton torso.
    ctx.fillStyle=enemy.hitFlash>0?'#fff':enemy.color;
    ctx.strokeStyle='rgba(255,225,200,.5)';
    ctx.lineWidth=1.3;
    ctx.beginPath();roundedRect(ctx,-7,-9,15,18,4);ctx.fill();ctx.stroke();
    // Shoulder blocks.
    ctx.fillStyle=shade(enemy.color,-.3);
    ctx.fillRect(-4,-12,9,4);
    ctx.fillRect(-4,8,9,4);
    // Legs.
    ctx.strokeStyle=shade(enemy.color,-.45);
    ctx.lineWidth=4.5;ctx.lineCap='round';
    const swing=Math.sin(enemy.walkPhase)*3;
    ctx.beginPath();
    ctx.moveTo(-2,-6);ctx.lineTo(-5+swing,-11);
    ctx.moveTo(-2,6);ctx.lineTo(-5-swing,11);
    ctx.stroke();
    // Head + heavy weapon.
    ctx.fillStyle=shade(enemy.color,.2);
    ctx.beginPath();ctx.arc(-3,0,4.2,0,TAU);ctx.fill();
    drawWeapon(ctx,'heavy',shade(enemy.color,.4));
    ctx.restore();
  },

  drone(ctx,enemy,scale,time){
    const hover=Math.sin(time*7+enemy.walkPhase)*2;
    ctx.save();
    ctx.scale(scale,scale);
    ctx.translate(0,hover*.3);
    // Fuselage.
    ctx.fillStyle=enemy.hitFlash>0?'#fff':'#1a3238';
    ctx.strokeStyle=enemy.color;
    ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(13,0);ctx.lineTo(3,-8);ctx.lineTo(-9,-6);
    ctx.lineTo(-12,0);ctx.lineTo(-9,6);ctx.lineTo(3,8);
    ctx.closePath();ctx.fill();ctx.stroke();
    // Rotors — spin fast enough to blur into arcs.
    ctx.strokeStyle=withAlpha(enemy.color,.4);
    ctx.lineWidth=1;
    const spin=time*26+enemy.walkPhase;
    for(const [rx,ry] of [[-4,-9],[-4,9]]){
      ctx.beginPath();
      ctx.arc(rx,ry,5,spin%TAU,spin%TAU+2.4);
      ctx.stroke();
    }
    // Sensor eye.
    ctx.fillStyle=enemy.color;
    ctx.beginPath();ctx.arc(3,0,2.8,0,TAU);ctx.fill();
    ctx.restore();
  },

  crawler(ctx,enemy,scale,time){
    ctx.save();
    ctx.scale(scale,scale);
    const legPhase=Math.sin(enemy.walkPhase*2)*2.6;
    ctx.strokeStyle=shade(enemy.color,-.2);
    ctx.lineWidth=1.6;
    ctx.lineCap='round';
    ctx.beginPath();
    for(const side of [-1,1]){
      for(let i=0;i<3;i++){
        const ox=(i-1)*5;
        const wobble=(i%2?legPhase:-legPhase)*side;
        ctx.moveTo(ox,side*5);
        ctx.lineTo(ox+wobble,side*12);
      }
    }
    ctx.stroke();
    // Chassis.
    ctx.fillStyle=enemy.hitFlash>0?'#fff':'#1e3438';
    ctx.strokeStyle=enemy.color;
    ctx.lineWidth=1.3;
    ctx.beginPath();roundedRect(ctx,-8,-6,17,12,3);ctx.fill();ctx.stroke();
    ctx.fillStyle=enemy.color;
    ctx.fillRect(5,-1.6,5,3.2);
    ctx.restore();
  },

  jammer(ctx,enemy,scale,time){
    ctx.save();
    ctx.scale(scale,scale);
    ctx.fillStyle=enemy.hitFlash>0?'#fff':enemy.color;
    ctx.strokeStyle='rgba(220,210,255,.6)';
    ctx.lineWidth=1.2;
    ctx.beginPath();roundedRect(ctx,-6,-7,13,14,4);ctx.fill();ctx.stroke();
    // Rotating dish.
    ctx.save();
    ctx.rotate(time*1.6);
    ctx.strokeStyle='#c8b6ff';
    ctx.lineWidth=1.6;
    ctx.beginPath();ctx.arc(0,0,10,-.9,.9);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(10,0);ctx.stroke();
    ctx.restore();
    // Emission pulses.
    const pulse=(time*.8+enemy.walkPhase*.1)%1;
    ctx.strokeStyle=withAlpha('#b29ae9',(1-pulse)*.4);
    ctx.lineWidth=1.4;
    ctx.beginPath();ctx.arc(0,0,10+pulse*22,0,TAU);ctx.stroke();
    ctx.restore();
  },

  veil(ctx,enemy,scale,time){
    ctx.save();
    ctx.scale(scale,scale);
    // Slim, angular silhouette.
    drawHumanoid(ctx,{
      bodyColor:enemy.color,accentColor:'#d6e2ff',
      scale:.92,phase:enemy.walkPhase,moving:1,
      weapon:'blade',weaponColor:'#d6e2ff',flash:enemy.hitFlash>0
    });
    ctx.restore();
    // Phase distortion shimmer.
    ctx.save();
    ctx.scale(scale,scale);
    ctx.strokeStyle=withAlpha('#b58cff',.3);
    ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(0,0,13+Math.sin(time*6)*2,0,TAU);ctx.stroke();
    ctx.restore();
  },

  augment(ctx,enemy,scale,time){
    const enraged=enemy.enraged;
    ctx.save();
    ctx.scale(scale*1.08,scale*1.08);
    drawHumanoid(ctx,{
      bodyColor:enraged?'#ff5b45':enemy.color,
      accentColor:enraged?'#ffd166':'#ffb0a0',
      scale:1,phase:enemy.walkPhase*(enraged?1.8:1),moving:1,
      weapon:'blade',flash:enemy.hitFlash>0,armor:1
    });
    ctx.restore();
    if(enraged){
      ctx.save();
      ctx.scale(scale,scale);
      ctx.strokeStyle=withAlpha('#ff5b30',.45+Math.sin(time*14)*.2);
      ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(0,0,16,0,TAU);ctx.stroke();
      ctx.restore();
    }
  },

  mortar(ctx,enemy,scale,time){
    ctx.save();
    ctx.scale(scale,scale);
    // Tripod base.
    ctx.strokeStyle=shade(enemy.color,-.35);
    ctx.lineWidth=2.2;
    ctx.beginPath();
    for(let i=0;i<3;i++){
      const a=i/3*TAU+.5;
      ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*10,Math.sin(a)*10);
    }
    ctx.stroke();
    // Tube, angled upward.
    ctx.fillStyle=enemy.hitFlash>0?'#fff':enemy.color;
    ctx.strokeStyle='rgba(255,240,200,.5)';
    ctx.lineWidth=1.2;
    ctx.save();
    ctx.rotate(-.5);
    ctx.beginPath();roundedRect(ctx,-2,-10,5,18,2);ctx.fill();ctx.stroke();
    ctx.restore();
    ctx.fillStyle=shade(enemy.color,.25);
    ctx.beginPath();ctx.arc(0,0,4,0,TAU);ctx.fill();
    ctx.restore();
  },

  sapper(ctx,enemy,scale,time){
    // Charge pack pulses faster as the fuse burns down.
    const armed=enemy.windup>0;
    const rate=armed?26:5;
    ctx.save();
    ctx.scale(scale,scale);
    drawHumanoid(ctx,{
      bodyColor:enemy.color,accentColor:'#ffd166',
      scale:.95,phase:enemy.walkPhase*1.6,moving:1,
      weapon:'none',flash:enemy.hitFlash>0||armed
    });
    ctx.fillStyle=armed
      ?withAlpha('#ff3b30',.55+Math.sin(time*rate)*.45)
      :withAlpha('#ffa14f',.6);
    ctx.beginPath();ctx.arc(-6,0,4.5,0,TAU);ctx.fill();
    ctx.restore();
  },

  warden(ctx,enemy,scale,time){
    ctx.save();
    ctx.scale(scale,scale);
    // Hexagonal chassis.
    ctx.fillStyle=enemy.hitFlash>0?'#fff':'#123832';
    ctx.strokeStyle=enemy.color;
    ctx.lineWidth=1.6;
    ctx.beginPath();
    for(let i=0;i<6;i++){
      const a=i/6*TAU;
      const x=Math.cos(a)*11,y=Math.sin(a)*11;
      i?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }
    ctx.closePath();ctx.fill();ctx.stroke();
    // Core.
    ctx.fillStyle=enemy.color;
    ctx.beginPath();ctx.arc(0,0,4,0,TAU);ctx.fill();
    // Counter-rotating shield ring.
    ctx.save();
    ctx.rotate(-time*1.1);
    ctx.strokeStyle=withAlpha(enemy.color,.5);
    ctx.lineWidth=2;
    ctx.setLineDash([6,6]);
    ctx.beginPath();ctx.arc(0,0,17,0,TAU);ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
};

// Health bars, elite rings, awareness markers and telegraph cues.
function drawEnemyOverlays(ctx,enemy,time,settings){
  const top=enemy.y-enemy.radius-11;

  // Elite aura ring.
  if(enemy.elite){
    ctx.save();
    ctx.strokeStyle=withAlpha(enemy.color,.4+Math.sin(time*4)*.15);
    ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(enemy.x,enemy.y,enemy.radius+7,0,TAU);ctx.stroke();
    ctx.restore();
  }

  // Health bar — only once damaged, always for elites.
  if(settings.showHealthBars!==false&&(enemy.hp<enemy.maxHp||enemy.elite)){
    const width=enemy.elite?38:24;
    const ratio=Math.max(0,enemy.hp/enemy.maxHp);
    ctx.fillStyle='rgba(2,8,10,.75)';
    ctx.fillRect(enemy.x-width/2,top,width,3.5);
    ctx.fillStyle=enemy.elite?'#ff655c':'#c8ded9';
    ctx.fillRect(enemy.x-width/2,top,width*ratio,3.5);
  }

  // Awareness state marker — makes stealth legible.
  if(settings.showThreatIndicators!==false){
    ctx.save();
    ctx.textAlign='center';
    ctx.font='bold 9px ui-monospace,monospace';
    if(enemy.confusedTimer>0){
      ctx.fillStyle='#76e7d4';
      ctx.fillText('?!',enemy.x,top-5);
    }else if(enemy.awareness>=.9){
      ctx.fillStyle='rgba(255,104,94,.9)';
      ctx.fillText('!',enemy.x,top-5);
    }else if(enemy.awareness>.25){
      ctx.fillStyle='rgba(255,199,91,.85)';
      ctx.fillText('?',enemy.x,top-5);
    }
    ctx.restore();
  }

  // Status effect pips.
  if(enemy.statuses?.size){
    let offset=0;
    ctx.save();
    for(const [,status] of enemy.statuses){
      ctx.fillStyle=status.color;
      ctx.fillRect(enemy.x-8+offset,top-11,4,4);
      offset+=6;
    }
    ctx.restore();
  }

  // Windup telegraph — a growing arc the player can read and react to.
  if(enemy.windup>0&&enemy.windupMax){
    const progress=1-enemy.windup/enemy.windupMax;
    ctx.save();
    ctx.strokeStyle=enemy.windupAction==='detonate'?'#ff3b30':'#ffb35c';
    ctx.lineWidth=2.5;
    ctx.beginPath();
    ctx.arc(enemy.x,enemy.y,enemy.radius+11,-Math.PI/2,-Math.PI/2+TAU*progress);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------

export function drawBoss(ctx,boss,time){
  drawShadow(ctx,boss.x,boss.y,boss.radius,.45);
  ctx.save();
  ctx.translate(boss.x,boss.y);

  const flash=boss.hitFlash>0;
  const body=flash?'#ffffff':'#2a1418';
  const renderer=BOSS_RENDERERS[boss.def.render]||BOSS_RENDERERS.manticore;
  renderer(ctx,boss,time,body);

  ctx.restore();

  // Adaptive shield overlay.
  if(boss.shieldReduction>0){
    ctx.save();
    ctx.strokeStyle=withAlpha('#8fd8ff',.5+Math.sin(time*10)*.2);
    ctx.lineWidth=3;
    ctx.setLineDash([10,8]);
    ctx.beginPath();ctx.arc(boss.x,boss.y,boss.radius+16,0,TAU);ctx.stroke();
    ctx.restore();
  }
}

const BOSS_RENDERERS={
  // The Nemesis walker.
  //
  // Read from above, a biped only reads as a biped if its feet clear the hull:
  // legs tucked under a torso just look like a tank. So the leg span is wider
  // than the chassis and the stride carries each foot well past the nose and
  // tail, where the eye can see them alternate. The legs align to travel and
  // the torso to whatever it is shooting at, which is what stops something
  // this size from appearing to slide.
  nemesis(ctx,boss,time,body){
    const s=boss.radius/54;
    const accent=boss.def.accent||'#ffb35c';
    const hot=boss.def.color||'#e0533f';
    const flash=boss.hitFlash>0;
    const shell=flash?'#ffffff':'#333b41';
    const plate=flash?'#ffffff':'#454e55';
    const dark=flash?'#dddddd':'#1d2429';

    const moving=Math.min(1,Math.hypot(boss.vx,boss.vy)/40);
    const limp=boss.strideLimp?.5:1;
    boss.stridePhase=(boss.stridePhase||0)+(.7+moving*3)*.016*limp;
    const stride=boss.stridePhase;

    // ---- Legs: outboard of the hull, aligned to travel ----
    // Each foot travels fore and aft along its own rail. Letting them swing
    // laterally as well read as flailing rather than walking, because from
    // overhead there is no vertical axis to sell the arc. The limbs are filled
    // and outlined rather than stroked in the hull's own value, or they
    // disappear into it at any distance.
    ctx.save();
    const speed=Math.hypot(boss.vx,boss.vy);
    ctx.rotate((speed>6?Math.atan2(boss.vy,boss.vx):boss.angle)-boss.angle);
    for(const side of [-1,1]){
      const swing=Math.sin(stride+(side>0?0:Math.PI));
      const planted=swing<0;
      const reach=swing*32*s;
      const rail=side*34*s;

      // Thigh: a tapered plate from the hip out to the rail.
      ctx.fillStyle=planted?plate:shell;
      ctx.strokeStyle=accent;
      ctx.lineWidth=1.6;
      ctx.beginPath();
      ctx.moveTo(-6*s,side*10*s);
      ctx.lineTo(8*s,side*10*s);
      ctx.lineTo(reach+9*s,rail);
      ctx.lineTo(reach-9*s,rail);
      ctx.closePath();ctx.fill();ctx.stroke();

      // Foot, square to the rail and clearly outboard of the hull. The planted
      // one is lit, which is what makes the alternation legible.
      ctx.save();
      ctx.translate(reach,rail);
      ctx.fillStyle=planted?plate:dark;
      ctx.strokeStyle=planted?'#ffd9a8':accent;
      ctx.lineWidth=2;
      ctx.beginPath();roundedRect(ctx,-19*s,-12*s,38*s,24*s,3*s);ctx.fill();ctx.stroke();
      ctx.fillStyle=dark;
      ctx.fillRect(-14*s,-7*s,9*s,14*s);
      ctx.fillRect(5*s,-7*s,9*s,14*s);
      // Toe lights, so a planted foot reads even in the dark.
      if(planted){
        ctx.fillStyle=withAlpha(hot,.7);
        ctx.fillRect(15*s,-3*s,3*s,6*s);
      }
      ctx.restore();
    }
    ctx.restore();

    // ---- Hull: angular, and narrower than the leg span ----
    ctx.fillStyle=shell;
    ctx.strokeStyle=accent;
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(32*s,-5*s);
    ctx.lineTo(17*s,-17*s);
    ctx.lineTo(-16*s,-18*s);
    ctx.lineTo(-30*s,-9*s);
    ctx.lineTo(-30*s,9*s);
    ctx.lineTo(-16*s,18*s);
    ctx.lineTo(17*s,17*s);
    ctx.lineTo(32*s,5*s);
    ctx.closePath();ctx.fill();ctx.stroke();

    // Spine plating, to give the hull some read at a distance.
    ctx.strokeStyle=withAlpha('#000000',.35);
    ctx.lineWidth=1.4;
    for(const x of [-16,-6,4]){
      ctx.beginPath();ctx.moveTo(x*s,-14*s);ctx.lineTo(x*s,14*s);ctx.stroke();
    }

    // ---- Shoulder hardpoints, one box per bolted-on weapon ----
    const fitted=Math.min(4,boss.record?.hardpoints?.length||1);
    for(let i=0;i<fitted;i++){
      const side=i%2?1:-1;
      const back=-6*s-Math.floor(i/2)*13*s;
      ctx.save();
      ctx.translate(back,side*19*s);
      ctx.fillStyle=plate;
      ctx.strokeStyle=accent;ctx.lineWidth=1.4;
      ctx.beginPath();roundedRect(ctx,-9*s,-7*s,22*s,14*s,2*s);ctx.fill();ctx.stroke();
      // Muzzle, pointed the way the hull faces.
      ctx.fillStyle=dark;
      ctx.fillRect(11*s,-2.5*s,9*s,5*s);
      ctx.restore();
    }

    // ---- Cockpit: the lit thing on an otherwise dead machine ----
    ctx.save();
    ctx.translate(19*s,0);
    ctx.fillStyle=dark;
    ctx.strokeStyle=accent;ctx.lineWidth=1.6;
    ctx.beginPath();
    ctx.moveTo(11*s,0);ctx.lineTo(2*s,-9*s);ctx.lineTo(-9*s,-8*s);
    ctx.lineTo(-9*s,8*s);ctx.lineTo(2*s,9*s);
    ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=withAlpha(hot,.5+Math.sin(time*2.6)*.28);
    ctx.beginPath();
    ctx.moveTo(8*s,0);ctx.lineTo(1*s,-6*s);ctx.lineTo(-6*s,-5*s);
    ctx.lineTo(-6*s,5*s);ctx.lineTo(1*s,6*s);
    ctx.closePath();ctx.fill();
    ctx.restore();

    // ---- Scars: small, sparse, and on the hull rather than over it ----
    if(boss.scars?.length){
      ctx.save();
      ctx.globalAlpha=.9;
      for(const scar of boss.scars.slice(0,10)){
        const x=Math.cos(scar.a)*scar.r*17*s;
        const y=Math.sin(scar.a)*scar.r*14*s;
        const size=1.6*s+scar.r*1.4*s;
        ctx.fillStyle='#15191d';
        ctx.beginPath();ctx.arc(x,y,size,0,TAU);ctx.fill();
        ctx.strokeStyle=withAlpha('#c08a5a',.45);
        ctx.lineWidth=.9;
        ctx.beginPath();ctx.arc(x,y,size+1.1,0,TAU);ctx.stroke();
      }
      ctx.restore();
    }
  },

  manticore(ctx,boss,time,body){
    const r=boss.radius;
    ctx.save();
    ctx.rotate(boss.spinAngle);
    // Six rotary barrels around the hull.
    ctx.fillStyle=body;
    ctx.strokeStyle=boss.def.color;
    ctx.lineWidth=2.5;
    for(let i=0;i<6;i++){
      ctx.save();
      ctx.rotate(i/6*TAU);
      ctx.beginPath();roundedRect(ctx,r*.5,-r*.16,r*.72,r*.32,4);
      ctx.fill();ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // Hull.
    ctx.fillStyle=body;
    ctx.strokeStyle=boss.def.color;
    ctx.lineWidth=3;
    ctx.beginPath();ctx.arc(0,0,r*.56,0,TAU);ctx.fill();ctx.stroke();
    // Core.
    ctx.fillStyle=boss.def.accent;
    ctx.globalAlpha=.6+Math.sin(time*4)*.3;
    ctx.beginPath();ctx.arc(0,0,r*.24,0,TAU);ctx.fill();
    ctx.globalAlpha=1;
  },

  carrion(ctx,boss,time,body){
    const r=boss.radius;
    ctx.save();
    ctx.rotate(-boss.spinAngle*.6);
    ctx.fillStyle=body;
    ctx.strokeStyle=boss.def.color;
    ctx.lineWidth=2.5;
    // Eight-pointed relay star.
    ctx.beginPath();
    for(let i=0;i<16;i++){
      const a=i/16*TAU;
      const radius=i%2?r*.52:r;
      const x=Math.cos(a)*radius,y=Math.sin(a)*radius;
      i?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }
    ctx.closePath();ctx.fill();ctx.stroke();
    ctx.restore();
    // Rotating inner ring.
    ctx.save();
    ctx.rotate(boss.spinAngle*1.4);
    ctx.strokeStyle=withAlpha(boss.def.accent,.7);
    ctx.lineWidth=2;
    ctx.setLineDash([8,10]);
    ctx.beginPath();ctx.arc(0,0,r*.66,0,TAU);ctx.stroke();
    ctx.restore();
    ctx.fillStyle=boss.def.accent;
    ctx.globalAlpha=.55+Math.sin(time*5)*.35;
    ctx.beginPath();ctx.arc(0,0,r*.2,0,TAU);ctx.fill();
    ctx.globalAlpha=1;
  },

  aegis(ctx,boss,time,body){
    const r=boss.radius;
    ctx.rotate(boss.angle);
    // Armoured slab chassis.
    ctx.fillStyle=body;
    ctx.strokeStyle=boss.def.color;
    ctx.lineWidth=3;
    ctx.beginPath();roundedRect(ctx,-r*.75,-r*.55,r*1.5,r*1.1,8);
    ctx.fill();ctx.stroke();
    // Forward ram.
    ctx.fillStyle=boss.def.accent;
    ctx.beginPath();
    ctx.moveTo(r*.72,-r*.34);ctx.lineTo(r*1.1,0);ctx.lineTo(r*.72,r*.34);
    ctx.closePath();ctx.fill();
    // Track pods.
    ctx.fillStyle=shade(boss.def.color,-.5);
    ctx.fillRect(-r*.7,-r*.78,r*1.3,r*.22);
    ctx.fillRect(-r*.7,r*.56,r*1.3,r*.22);
    // Sensor bar.
    ctx.fillStyle=withAlpha(boss.def.accent,.5+Math.sin(time*6)*.4);
    ctx.fillRect(-r*.1,-r*.12,r*.5,r*.24);
  },

  arbiter(ctx,boss,time,body){
    const r=boss.radius;
    // Three counter-rotating rings.
    for(let ring=0;ring<3;ring++){
      ctx.save();
      ctx.rotate(boss.spinAngle*(ring%2?-1:1)*(1+ring*.4));
      ctx.strokeStyle=withAlpha(ring%2?boss.def.accent:boss.def.color,.75);
      ctx.lineWidth=3-ring*.5;
      ctx.setLineDash([14,9]);
      ctx.beginPath();ctx.arc(0,0,r*(.55+ring*.22),0,TAU);ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash([]);
    // Inner monolith — deliberately humanoid in silhouette.
    ctx.fillStyle=body;
    ctx.strokeStyle=boss.def.color;
    ctx.lineWidth=2.5;
    ctx.save();
    ctx.rotate(boss.angle);
    ctx.beginPath();roundedRect(ctx,-r*.28,-r*.42,r*.56,r*.84,6);
    ctx.fill();ctx.stroke();
    ctx.fillStyle=boss.def.accent;
    ctx.globalAlpha=.7+Math.sin(time*3)*.3;
    ctx.beginPath();ctx.arc(0,-r*.16,r*.11,0,TAU);ctx.fill();
    ctx.globalAlpha=1;
    ctx.restore();
  }
};

export function drawPhantom(ctx,phantom,time){
  ctx.save();
  ctx.globalAlpha=.55+Math.sin(time*6+phantom.age*3)*.12;
  drawShadow(ctx,phantom.x,phantom.y,phantom.radius,.18);
  ctx.translate(phantom.x,phantom.y);
  ctx.rotate(phantom.angle);
  drawHumanoid(ctx,{
    bodyColor:'#5c6c78',accentColor:'#e0e6ea',
    outline:'rgba(224,230,234,.6)',
    scale:1,phase:phantom.age*9,moving:1,weapon:'smg',weaponColor:'#e0e6ea'
  });
  ctx.restore();
}

export function drawTurret(ctx,turret,time){
  drawShadow(ctx,turret.x,turret.y,10,.28);
  ctx.save();
  ctx.translate(turret.x,turret.y);
  const color=turret.color||'#76e7d4';
  // Planted turrets are heavier hardware than a weapon-spawned drone: they
  // get a deployed footplate so the two read differently at a glance.
  if(turret.planted){
    ctx.strokeStyle=withAlpha(color,.4);
    ctx.lineWidth=1.2;
    ctx.beginPath();
    for(let i=0;i<3;i++){
      const a=i/3*TAU+turret.angle*.15;
      ctx.moveTo(Math.cos(a)*7,Math.sin(a)*7);
      ctx.lineTo(Math.cos(a)*13,Math.sin(a)*13);
    }
    ctx.stroke();
  }
  // Base.
  ctx.fillStyle=turret.hitFlash>0?'#5a2b2b':'#123036';
  ctx.strokeStyle=color;
  ctx.lineWidth=1.4;
  ctx.beginPath();ctx.arc(0,0,8,0,TAU);ctx.fill();ctx.stroke();
  // Rotating head.
  ctx.rotate(turret.angle);
  ctx.fillStyle=color;
  ctx.fillRect(2,-2,13,4);
  ctx.beginPath();ctx.arc(0,0,4,0,TAU);ctx.fill();
  ctx.restore();

  // Durability bar, shown once a planted turret has taken a hit.
  if(turret.planted&&turret.maxHp&&turret.hp<turret.maxHp){
    const ratio=Math.max(0,turret.hp/turret.maxHp);
    ctx.fillStyle='rgba(0,0,0,.6)';
    ctx.fillRect(turret.x-12,turret.y-18,24,3);
    ctx.fillStyle=ratio>.5?'#8bff9b':ratio>.25?'#ffd166':'#ff7068';
    ctx.fillRect(turret.x-12,turret.y-18,24*ratio,3);
  }
  // Expiry warning blink.
  if(turret.life<3){
    ctx.save();
    ctx.strokeStyle=withAlpha('#ff7068',Math.abs(Math.sin(time*10)));
    ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(turret.x,turret.y,12,0,TAU);ctx.stroke();
    ctx.restore();
  }
}

export function drawMine(ctx,mine,time){
  const pulse=mine.armed?Math.abs(Math.sin(time*4)):.25;
  ctx.save();
  ctx.translate(mine.x,mine.y);
  ctx.fillStyle='#1d2b22';
  ctx.strokeStyle=mine.armed?withAlpha('#ffd166',.5+pulse*.5):'rgba(150,150,150,.4)';
  ctx.lineWidth=1.4;
  ctx.beginPath();
  for(let i=0;i<6;i++){
    const a=i/6*TAU;
    const x=Math.cos(a)*7,y=Math.sin(a)*7;
    i?ctx.lineTo(x,y):ctx.moveTo(x,y);
  }
  ctx.closePath();ctx.fill();ctx.stroke();
  if(mine.armed){
    ctx.fillStyle=withAlpha('#ffd166',pulse);
    ctx.beginPath();ctx.arc(0,0,2.6,0,TAU);ctx.fill();
    // Trigger radius hint.
    ctx.strokeStyle=withAlpha('#ffd166',.12);
    ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(0,0,mine.blastRadius*.4,0,TAU);ctx.stroke();
  }
  ctx.restore();
}

export function drawPickup(ctx,pickup,time){
  const bob=Math.sin(time*4+pickup.phase)*2;
  ctx.save();
  ctx.translate(pickup.x,pickup.y+bob);

  switch(pickup.kind){
    case 'xp':{
      const size=pickup.value>=6?7:pickup.value>=3?5.5:4.2;
      const color=pickup.value>=6?'#b6a6ff':pickup.value>=3?'#8fd8ff':'#76e7d4';
      ctx.rotate(Math.PI/4);
      ctx.fillStyle=withAlpha(color,.25);
      ctx.fillRect(-size*1.5,-size*1.5,size*3,size*3);
      ctx.fillStyle=color;
      ctx.fillRect(-size,-size,size*2,size*2);
      break;
    }
    case 'credit':
      ctx.fillStyle='rgba(255,209,102,.25)';
      ctx.beginPath();ctx.arc(0,0,8,0,TAU);ctx.fill();
      ctx.fillStyle='#ffd166';
      ctx.beginPath();ctx.arc(0,0,4.5,0,TAU);ctx.fill();
      break;
    case 'health':
      ctx.fillStyle='rgba(139,255,155,.22)';
      ctx.beginPath();ctx.arc(0,0,11,0,TAU);ctx.fill();
      ctx.fillStyle='#8bff9b';
      ctx.fillRect(-6,-2,12,4);
      ctx.fillRect(-2,-6,4,12);
      break;
    case 'magnet':
      ctx.strokeStyle='#76e7d4';
      ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,7,Math.PI*.15,Math.PI*.85,true);ctx.stroke();
      ctx.fillStyle='#76e7d4';
      ctx.fillRect(-8,-2,3,5);ctx.fillRect(5,-2,3,5);
      break;
    case 'bomb':
      ctx.fillStyle='rgba(255,112,104,.25)';
      ctx.beginPath();ctx.arc(0,0,12,0,TAU);ctx.fill();
      ctx.fillStyle='#ff7068';
      ctx.beginPath();ctx.arc(0,0,6,0,TAU);ctx.fill();
      ctx.strokeStyle='#ffd166';
      ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(3,-5);ctx.lineTo(7,-9);ctx.stroke();
      break;
    case 'dossier':{
      // A sealed personnel folder, pulsing hard enough to be spotted in a fight.
      const glow=.5+Math.sin(time*6)*.3;
      ctx.fillStyle=withAlpha('#f5d27a',glow*.35);
      ctx.beginPath();ctx.arc(0,0,24,0,TAU);ctx.fill();
      ctx.strokeStyle=withAlpha('#f5d27a',glow);
      ctx.lineWidth=1.2;
      ctx.beginPath();ctx.arc(0,0,16+Math.sin(time*3)*2,0,TAU);ctx.stroke();
      ctx.rotate(Math.sin(time*2)*.12);
      ctx.fillStyle='#2b2417';
      ctx.strokeStyle='#f5d27a';
      ctx.lineWidth=1.6;
      ctx.beginPath();roundedRect(ctx,-8,-10,16,20,1.5);ctx.fill();ctx.stroke();
      ctx.fillStyle='#f5d27a';
      ctx.fillRect(-5,-6,10,1.4);
      ctx.fillRect(-5,-3,7,1.4);
      // Silhouetted head-and-shoulders stamp on the cover.
      ctx.beginPath();ctx.arc(0,2,2.4,0,TAU);ctx.fill();
      ctx.beginPath();ctx.moveTo(-4.5,8);ctx.quadraticCurveTo(0,3.2,4.5,8);ctx.closePath();ctx.fill();
      break;
    }
    case 'chest':{
      const glow=.4+Math.sin(time*5)*.25;
      ctx.fillStyle=withAlpha('#ffd166',glow*.4);
      ctx.beginPath();ctx.arc(0,0,20,0,TAU);ctx.fill();
      ctx.fillStyle='#3a2c14';
      ctx.strokeStyle='#ffd166';
      ctx.lineWidth=1.8;
      ctx.beginPath();roundedRect(ctx,-10,-8,20,16,2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#ffd166';
      ctx.fillRect(-2,-8,4,16);
      break;
    }
    default:break;
  }
  ctx.restore();
}

export {shade,roundedRect,drawHumanoid,drawWeapon};
