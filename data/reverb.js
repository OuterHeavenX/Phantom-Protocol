// Environmental reverb profiles.
//
// The point of this system is location, not effect. A gunshot in a flooded
// basement and the same gunshot on an open span should tell you which one you
// are in before you look — and neither should sound like a cathedral.
//
// Everything here is deliberately short. A convolver's cost scales with the
// length of its impulse and this game is played on phones, so the longest room
// in it is 1.4 seconds and most are well under one. Restraint is also the
// correct artistic answer: long tails smear transients, and the weapons were
// just tuned to have transients worth keeping.
//
//   decay    impulse length in seconds — the room's size
//   curve    how fast it dies inside that length. Higher is a deader room:
//            soft furnishings, snow, mud. Lower rings on.
//   damping  lowpass on the tail in Hz. Concrete and snow eat the top end;
//            sheet metal does not, which is most of why a hangar sounds like
//            a hangar.
//   predelay seconds before the tail starts. Larger spaces have a longer gap
//            between the sound and the first wall answering it.
//   wet      send level. This is the single most abusable number here, so
//            outdoor spaces sit near a tenth and nothing exceeds a third.
//   early    discrete early reflections as [seconds, gain]. Hard parallel
//            surfaces produce distinct slaps rather than a smooth tail, which
//            is the difference between a corridor and a field.
export const REVERB={
  // Sealed concrete underground. Tight, dark, and closer than it looks.
  blacksite:{decay:.9,curve:2.4,damping:2600,predelay:.011,wet:.22,
    early:[[.013,.34],[.027,.22],[.041,.14]]},
  // A powered installation cut into ice. Hard interior surfaces, but the
  // structure is packed with insulation.
  arctic:{decay:.55,curve:3,damping:3400,predelay:.008,wet:.15,
    early:[[.009,.28],[.019,.16]]},
  // Flooded, roofless, and full of standing water and broken concrete.
  sunken:{decay:1.1,curve:2.1,damping:2000,predelay:.016,wet:.25,
    early:[[.018,.3],[.037,.2],[.058,.12]]},
  // A working foundry: enormous, and made almost entirely of steel.
  foundry:{decay:1.4,curve:1.6,damping:5200,predelay:.021,wet:.29,
    early:[[.023,.4],[.047,.3],[.072,.22],[.101,.14]]},
  // Metal interior, but a small one, and half the air has been gone a while.
  orbital:{decay:.7,curve:2.2,damping:4600,predelay:.007,wet:.2,
    early:[[.008,.36],[.017,.24],[.029,.15]]},
  // Open exterior in rain. Almost nothing comes back, and what does is the
  // deck under the span rather than a room.
  crossfall:{decay:.34,curve:3.6,damping:2200,predelay:.014,wet:.1,
    early:[[.016,.18]]},
  // Snow is the most absorbent surface in the game. This is the deadest
  // profile on purpose: a whiteout should sound like the sector is swallowing
  // every shot, because it is.
  hollow:{decay:.28,curve:4.2,damping:1500,predelay:.012,wet:.07,early:[]},
  // Waterlogged forestry. Soft, damp, and irregular — no parallel surfaces at
  // all, so no early reflections.
  mire:{decay:.46,curve:3.4,damping:1700,predelay:.013,wet:.12,early:[]},
  // The biggest hard-surfaced volume in the game, and empty.
  hangar:{decay:1.3,curve:1.7,damping:4800,predelay:.024,wet:.27,
    early:[[.026,.38],[.053,.26],[.084,.18]]},
  // A laboratory. Glass and composite: bright, controlled, slightly artificial.
  proving:{decay:.62,curve:2.6,damping:6000,predelay:.006,wet:.18,
    early:[[.007,.3],[.015,.2],[.024,.12]]}
};

// The room a theatre is.
//
// Returns null rather than a default for an unknown key, and the caller treats
// null as dry. A theatre nobody wrote a room for should sound like the open
// air, not like whichever room happened to be first in the table.
export function reverbFor(mapId){
  return REVERB[mapId]||null;
}
