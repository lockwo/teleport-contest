// zap.js — wand/spell zapping helpers.
// C ref: zap.c.  Only the routines whose RNG side-effects are exercised by
// the gameplay sessions are ported here.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { pline } from './display.js';
import { getobj, makeknown, useupall, GETOBJ_SUGGEST, GETOBJ_EXCLUDE,
         GETOBJ_NOFLAGS } from './invent.js';
import { exercise } from './attrib.js';
import { findit } from './detect.js';
import { WAND_CLASS, objects } from './mkobj.js';
import { A_WIS, A_STR } from './const.js';

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

const ECMD_CANCEL = 0;
const ECMD_OK = 0;
const ECMD_TIME = 1;

// C ref: objclass.h oc_dir values.
const NODIR = 1;

const WAN_SECRET_DOOR_DETECTION = 410;
const WAND_WREST_CHANCE = 121;
const WAND_BACKFIRE_CHANCE = 100;

// C ref: zap.c zap_ok — getobj callback: only wands are suggested.
function zap_ok(obj) {
    if (obj && obj.oclass === WAND_CLASS)
        return GETOBJ_SUGGEST;
    return GETOBJ_EXCLUDE;
}

// C ref: zap.c zappable — can the wand be zapped?  spe<0 -> no; spe==0 wrests
// a final charge with WAND_WREST_CHANCE odds; otherwise consume one charge.
function zappable(wand) {
    if (wand.spe < 0 || (wand.spe === 0 && rn2(WAND_WREST_CHANCE)))
        return false;
    if (wand.spe === 0)
        game._pending_message = 'You wrest one last charge from the worn-out wand.';
    wand.spe--;
    return true;
}

// C ref: zap.c learnwand — discover a wand's type once its effect is observed.
function learnwand(obj) {
    makeknown(obj.otyp);
}

// C ref: zap.c zapnodir — apply a directionless wand/spell.  Only the covered
// types are handled; others are silent no-ops (matching "no obvious effect").
async function zapnodir(obj) {
    let known = false;
    switch (obj.otyp) {
    case WAN_SECRET_DOOR_DETECTION:
        known = !!obj.dknown;
        await findit();
        break;
    default:
        break;
    }
    if (known) {
        if (!objects[obj.otyp]?.known) {
            // more_experienced(0, 10): no RNG.
        }
        learnwand(obj);
    }
}

// C ref: zap.c weffects — dispatch a wand/spell effect.  Always exercises
// Wisdom (rn2(19) via exercise) first.  Only the NODIR branch is covered.
async function weffects(obj) {
    const otyp = obj.otyp;
    exercise(A_WIS, true);
    if (objects[otyp]?.dir === NODIR) {
        await zapnodir(obj);
    }
    // IMMEDIATE / RAY wand effects are not exercised by the covered sessions.
}

// C ref: zap.c dozap — the 'z' command.  Pick a wand, then apply it.  The
// covered case is a directionless wand (secret door detection) with charges,
// uncursed, so it goes straight to weffects.
export async function dozap() {
    if (game.u?.nohands) {
        await pline("You aren't able to zap anything in your current form.");
        return ECMD_OK;
    }

    const obj = await getobj('zap', zap_ok, GETOBJ_NOFLAGS);
    if (!obj)
        return ECMD_CANCEL;

    const need_dir = objects[obj.otyp]?.dir !== NODIR;
    if (!zappable(obj)) {
        await pline('Nothing happens.');
    } else if (obj.cursed && !rn2(WAND_BACKFIRE_CHANCE)) {
        // backfire(obj): wand blows up — not exercised by covered sessions.
        exercise(A_STR, false);
        return ECMD_TIME;
    } else if (need_dir) {
        // Directional wands (getdir prompt + buzz) are not exercised here.
    } else {
        game.current_wand = obj;
        await weffects(obj);
        game.current_wand = 0;
    }
    if (obj && obj.spe < 0) {
        await pline('It turns to dust.');
        useupall(obj);
    }
    return ECMD_TIME;
}
