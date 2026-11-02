// montraps.js — mondata.c's trap-knowledge accessors.  A leaf module (const.js
// only) so makemon.js, priest.js and monmove.js can all reach ONE copy without
// the mondata.js <-> makemon.js import cycle.
import { ALL_TRAPS, NO_TRAP } from './const.js';

// C ref: mondata.c:1617 mon_knows_traps(mtmp, ttyp) — has this monster seen
// this trap type before?  mtrapseen is a bitmask, bit (ttyp-1).
export function mon_knows_traps(mtmp, ttyp) {
    const seen = mtmp.mtrapseen || 0;
    if (ttyp === ALL_TRAPS) return seen !== 0;
    if (ttyp === NO_TRAP) return seen === 0;
    return (seen & (1 << (ttyp - 1))) !== 0;
}

// C ref: mondata.c:1629 mon_learns_traps(mtmp, ttyp) — record knowledge of a
// trap type (ALL_TRAPS: every type, NO_TRAP: forget them all).
export function mon_learns_traps(mtmp, ttyp) {
    if (ttyp === ALL_TRAPS) mtmp.mtrapseen = ~0;
    else if (ttyp === NO_TRAP) mtmp.mtrapseen = 0;
    else mtmp.mtrapseen = (mtmp.mtrapseen || 0) | (1 << (ttyp - 1));
}
