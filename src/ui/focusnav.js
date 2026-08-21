// Spatial focus navigation.
//
// The menus were built for a mouse. Exactly one screen had keyboard
// navigation, and none of them read the gamepad at all, so on a console or a
// television box — where a controller or a remote is the only input there is —
// the game could not be started, let alone played.
//
// Rather than teach each screen to navigate itself, this drives the browser's
// own focus. Every control in this project is a real `<button>`, so the set of
// things worth moving between is just what is focusable and visible, and
// activating one is `.click()`. That means screens nobody thought about while
// writing this — a screen added next month — are navigable the day they ship.
//
// Direction is geometric rather than document order, because the layouts are
// grids and racks and rows of cards, and tabbing through a Gunsmith rack in
// source order is not what pressing "right" means to anyone holding a pad.

const FOCUSABLE=
  'button:not([disabled]):not([tabindex="-1"]),'+
  '[href]:not([tabindex="-1"]),'+
  'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),'+
  '[tabindex]:not([tabindex="-1"])';

// Only the topmost layer is navigable: while the adaptation cards or the pause
// menu are up, the screen behind them is not a place focus may wander to.
function activeLayer(){
  const overlays=[...document.querySelectorAll('.overlay,.pause-overlay,[data-layer]')]
    .filter(isVisible);
  if(overlays.length)return overlays[overlays.length-1];
  return document.querySelector('.splash')||document.querySelector('#app')||document.body;
}

function isVisible(element){
  if(!element||element.hidden)return false;
  const rect=element.getBoundingClientRect();
  if(rect.width<=0||rect.height<=0)return false;
  // Off the bottom of a long scrolling panel still counts; off-screen entirely
  // because a parent is hidden does not.
  const style=getComputedStyle(element);
  return style.visibility!=='hidden'&&style.display!=='none'&&style.opacity!=='0';
}

export function candidates(){
  const layer=activeLayer();
  if(!layer)return [];
  return [...layer.querySelectorAll(FOCUSABLE)].filter(isVisible);
}

const centre=element=>{
  const r=element.getBoundingClientRect();
  return{x:r.left+r.width/2,y:r.top+r.height/2,r};
};

// Picks the best control in a direction. Candidates are scored by how far away
// they are along the axis of travel, penalised by how far they stray off it —
// so "down" from a card prefers the card directly beneath over one further
// along the row, without ever refusing to move at all when nothing is exactly
// in line.
function best(from,dir,list){
  const a=centre(from);
  let winner=null,score=Infinity;
  for(const element of list){
    if(element===from)continue;
    const b=centre(element);
    const dx=b.x-a.x,dy=b.y-a.y;
    const along=dir.x?dx*dir.x:dy*dir.y;
    const off=dir.x?Math.abs(dy):Math.abs(dx);
    // Must actually be in the direction asked for, by enough to not be a
    // rounding artefact between two controls on the same line.
    if(along<=2)continue;
    // Overlapping on the cross axis counts as perfectly in line: a wide button
    // beneath a narrow one is still "down".
    const overlap=dir.x
      ?Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)
      :Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left);
    const strayed=overlap>0?0:off;
    const value=along+strayed*2.4;
    if(value<score){score=value;winner=element}
  }
  return winner;
}

export class FocusNav{
  constructor(){
    this.enabled=false;
  }

  get current(){
    const active=document.activeElement;
    if(active&&active!==document.body&&isVisible(active))return active;
    return null;
  }

  // Puts focus somewhere sensible for a freshly rendered screen. Prefers a
  // control marked as the screen's primary action, then the first one there is.
  focusFirst(){
    const list=candidates();
    if(!list.length)return false;
    const preferred=list.find(el=>el.classList.contains('primary'))||list[0];
    preferred.focus({preventScroll:false});
    return true;
  }

  // True when focus is already on something inside the current layer, so a
  // direction press moves rather than re-anchoring.
  focused(){
    const active=this.current;
    return !!active&&candidates().includes(active);
  }

  move(direction){
    const list=candidates();
    if(!list.length)return false;
    if(!this.focused())return this.focusFirst();
    const dirs={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
    const dir=dirs[direction];
    if(!dir)return false;
    const next=best(this.current,dir,list);
    if(!next)return false;
    next.focus({preventScroll:true});
    next.scrollIntoView({block:'nearest',inline:'nearest'});
    return true;
  }

  activate(){
    const active=this.current;
    if(!active)return this.focusFirst();
    active.click();
    return true;
  }

  // The universal "back". Every screen in this project either carries a
  // marked back control or is the top of the tree, where back means nothing.
  back(){
    const layer=activeLayer();
    const button=layer?.querySelector('[data-back],#commandBtn,#abortOp,#resumeBtn');
    if(!button||!isVisible(button))return false;
    button.click();
    return true;
  }
}
