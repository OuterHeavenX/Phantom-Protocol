// Vault locks.
//
// Every sealed chamber is worth the same core payout — credits, a supply
// cache, a heal and the best personnel-file odds in the sector. What differs
// is the lock, and each lock asks the operative for a different thing:
//
//   cache     nothing. Shoot the plate off and walk in.
//   garrison  a fight, after the fact. The plate opens easily; what was
//             sealed in with the cache comes out.
//   hold      time, in the open. The plate cannot be shot. A manual override
//             runs only while the operative stands at the door, and the
//             override broadcasts — everything nearby knows where they are.
//   terminal  ground. The plate cannot be shot either; the lock is on a
//             console somewhere else in the sector, which has to be found and
//             put down before the chamber will open at all.
//
// `sealed: true` means damage will not open the plate, which is what makes the
// alternate route the only route. Bonus credits pay back whatever the lock
// cost that a plain cache did not.

export const VAULT_KINDS={
  cache:{
    id:'cache',sealed:false,color:'#f5d27a',
    label:'SEALED VAULT',
    detect:'SEALED VAULT DETECTED',
    bonusCredits:0
  },
  garrison:{
    id:'garrison',sealed:false,color:'#ff7068',
    label:'SEALED VAULT // GARRISON',
    detect:'SEALED VAULT // GARRISON SIGNATURE',
    bonusCredits:220
  },
  hold:{
    id:'hold',sealed:true,color:'#8fd8ff',
    label:'SEALED VAULT // MANUAL OVERRIDE',
    detect:'SEALED VAULT // MANUAL OVERRIDE REQUIRED',
    // Seconds of unbroken presence at the door, and how far from the chamber
    // centre still counts as being at it. The radius has to reach past the
    // seal itself: the plate is shut, so the hold is stood in the open.
    holdTime:14,holdRadius:150,
    bonusCredits:180
  },
  terminal:{
    id:'terminal',sealed:true,color:'#c895ff',
    label:'SEALED VAULT // REMOTE LOCK',
    detect:'SEALED VAULT // LOCK SIGNAL OFFSITE',
    bonusCredits:160
  }
};

export const VAULT_KIND_IDS=Object.keys(VAULT_KINDS);

// Draws a lock from a seeded stream. Weighted so a sector reliably contains at
// least one chamber that can simply be shot open — the alternate locks are the
// variation, not the baseline.
export function rollVaultKind(rng){
  const roll=rng.next();
  if(roll<.32)return 'cache';
  if(roll<.56)return 'garrison';
  if(roll<.80)return 'hold';
  return 'terminal';
}

export const vaultKind=id=>VAULT_KINDS[id]||VAULT_KINDS.cache;
