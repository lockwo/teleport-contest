// potion.js — quaffing potions.
// C ref: potion.c.  Ports the command entry (dodrink), the quaff dispatch
// (dopotion / peffects) and the per-potion effects exercised by the gameplay
// sessions.  Effects with no recorded coverage fall back to the generic
// "peculiar feeling" path so the RNG / message sequence stays faithful.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { pline } from './display.js';
import { getobj, makeknown, useup, GETOBJ_SUGGEST, GETOBJ_EXCLUDE,
         GETOBJ_NOFLAGS } from './invent.js';
import { exercise } from './attrib.js';
import { POTION_CLASS, POT_OIL, objects } from './mkobj.js';
import { A_WIS } from './const.js';

const ECMD_CANCEL = 0;
const ECMD_OK = 0;
const ECMD_TIME = 1;

// C ref: potion.c drink_ok — getobj callback: only potions are suggested.
function drink_ok(obj) {
    if (!obj)
        return GETOBJ_EXCLUDE;
    if (obj.oclass === POTION_CLASS)
        return GETOBJ_SUGGEST;
    return GETOBJ_EXCLUDE;
}

// C ref: potion.c peffect_oil — drinking a potion of oil.  Unlit + uncursed
// (the only case covered) prints "That was smooth!" then exercises Wisdom in
// the "not good for you" direction (-rn2(2)).
function peffect_oil(otmp) {
    let good_for_you = false;
    if (otmp.lamplit) {
        // No lamplit potions of oil are quaffed in the covered sessions.
        good_for_you = false;
    } else if (otmp.cursed) {
        game.potion_unkn = (game.potion_unkn || 0); // no extra flagging
        pline_sync('This tastes like castor oil.');
    } else {
        pline_sync('That was smooth!');
    }
    exercise(A_WIS, good_for_you);
}

// pline is async (sets the pending message); for the synchronous peffect bodies
// we only need to stash the message, so call the setter directly.
function pline_sync(msg) { game._pending_message = msg; }

// C ref: potion.c peffects — dispatch by potion type; returns -1 to signal
// "used up with possible discovery", >=0 to signal an already-handled result.
function peffects(otmp) {
    switch (otmp.otyp) {
    case POT_OIL:
        peffect_oil(otmp);
        break;
    default:
        // Uncovered potion type: treat as "nothing obvious happened" so the
        // generic dopotion tail emits the peculiar-feeling message.
        game.potion_nothing = (game.potion_nothing || 0) + 1;
        break;
    }
    return -1;
}

// C ref: potion.c dopotion — apply a quaffed potion and handle discovery.
async function dopotion(otmp) {
    otmp.in_use = true;
    game.potion_nothing = 0;
    game.potion_unkn = 0;
    const retval = peffects(otmp);
    if (retval >= 0)
        return retval ? ECMD_TIME : ECMD_OK;

    if (game.potion_nothing) {
        game.potion_unkn = (game.potion_unkn || 0) + 1;
        await pline(`You have a ${game.u?.Hallucination ? 'normal' : 'peculiar'} feeling for a moment, then it passes.`);
    }
    if (otmp.dknown && !objects[otmp.otyp]?.known) {
        if (!game.potion_unkn) {
            makeknown(otmp.otyp);
            // more_experienced(0, 10): no RNG, score-only.
        }
        // trycall(otmp): naming prompt, not modeled.
    }
    useup(otmp);
    return ECMD_TIME;
}

// C ref: potion.c dodrink — the 'q' command.  The fountain / sink / underwater
// pre-checks don't apply on the covered open-room starts, so we go straight to
// the getobj prompt.
export async function dodrink() {
    if (game.u?.Strangled) {
        await pline("If you can't breathe air, how can you drink liquid?");
        return ECMD_OK;
    }

    const otmp = await getobj('drink', drink_ok, GETOBJ_NOFLAGS);
    if (!otmp)
        return ECMD_CANCEL;

    otmp.in_use = true; // you've opened the stopper

    // The milky/smoky ghost/djinni bottle checks require a ghost/djinni still
    // alive; not modeled (no such potions in the covered sessions).
    return await dopotion(otmp);
}
