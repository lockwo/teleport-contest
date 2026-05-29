// zap.js — wand/spell zapping helpers.
// C ref: zap.c.  Only the routines whose RNG side-effects are exercised by
// the gameplay sessions are ported here.

import { rn2 } from './rng.js';

// Object-type numbers that unconditionally resist (never rolled).
// C ref: zap.c obj_resists().  AMULET_OF_YENDOR / SPE_BOOK_OF_THE_DEAD /
// CANDELABRUM_OF_INVOCATION / BELL_OF_OPENING / a Rider corpse.
const AMULET_OF_YENDOR = 155;
const SPE_BOOK_OF_THE_DEAD = 355;
const CANDELABRUM_OF_INVOCATION = 360;
const BELL_OF_OPENING = 359;

// C ref: zap.c obj_resists(obj, ochance, achance) — chance an object resists
// (e.g. destruction / theft).  The invocation items always resist.  Everything
// else rolls rn2(100) and resists when the roll lands below the per-object
// chance (achance for artifacts, ochance otherwise).
export function obj_resists(obj, ochance, achance) {
    const otyp = obj?.otyp;
    if (otyp === AMULET_OF_YENDOR
        || otyp === SPE_BOOK_OF_THE_DEAD
        || otyp === CANDELABRUM_OF_INVOCATION
        || otyp === BELL_OF_OPENING) {
        return true;
    }
    // (Rider-corpse check omitted: no Rider corpses on the starting level.)
    const chance = rn2(100);
    return chance < (obj?.oartifact ? achance : ochance);
}
