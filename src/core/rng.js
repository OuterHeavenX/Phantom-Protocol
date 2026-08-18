// Deterministic pseudo-random generator (mulberry32).
// Seeded RNG keeps sector layouts, decor and daily contracts reproducible.
export class Rng{
  constructor(seed=Date.now()){this.seed=seed>>>0;this.state=this.seed||0x9e3779b9}

  next(){
    let t=this.state+=0x6d2b79f5;
    t=Math.imul(t^t>>>15,t|1);
    t^=t+Math.imul(t^t>>>7,t|61);
    return ((t^t>>>14)>>>0)/4294967296;
  }

  range(min,max){return min+this.next()*(max-min)}
  int(min,max){return Math.floor(this.range(min,max+1))}
  bool(chance=.5){return this.next()<chance}
  pick(list){return list[Math.floor(this.next()*list.length)]}
  angle(){return this.next()*Math.PI*2}

  // Weighted pick: entries are objects carrying a numeric `weight`.
  weighted(list,weightOf=x=>x.weight||1){
    let total=0;
    for(const item of list)total+=weightOf(item);
    let roll=this.next()*total;
    for(const item of list){roll-=weightOf(item);if(roll<=0)return item}
    return list[list.length-1];
  }

  // Fisher-Yates, returns a new array.
  shuffle(list){
    const out=list.slice();
    for(let i=out.length-1;i>0;i--){
      const j=Math.floor(this.next()*(i+1));
      [out[i],out[j]]=[out[j],out[i]];
    }
    return out;
  }

  fork(offset=1){return new Rng((this.seed^Math.imul(offset,0x85ebca6b))>>>0)}
}

// Shared instance for cosmetic randomness that does not need reproducibility.
export const rng=new Rng(Date.now());

// Stable string -> seed hash, used for daily/named contracts.
export function hashSeed(str){
  let h=2166136261;
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}
  return h>>>0;
}
