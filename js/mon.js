// mon.js — Monster turn bookkeeping for the move loop.
// C ref: mon.c — mcalcmove(), mcalcdistress(), movemon(), movemon_singlemon().
//
// This is the GENERAL (data-driven) port of the per-turn monster machinery
// used by allmain.js moveloop_core().  It iterates the real monster list
// (game.level.monsters / game.fmon) so that gameplay RNG + display are
// generated naturally for any session whose level state is materialized.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { NORMAL_SPEED } from './const.js';
import { dochug } from './monmove.js';

// Speed-modifier flags (permonst.mspeed); C ref: monst.h.
const MSLOW = 1;
const MFAST = 2;

// C ref: mon.c DEADMONSTER(mon) — hp <= 0.
export function DEADMONSTER(mon) {
    return !mon || (mon.mhp != null && mon.mhp <= 0);
}

// The live monster list for the current level.  C uses the `fmon` chain;
// our level stores monsters in an array.  Filter out dead / off-map.
export function monsterList() {
    const list = game.level?.monsters || [];
    return list;
}

// C ref: mon.c mcalcmove(mon, m_moving)
// Computes the monster's movement-point allotment for this turn.  When
// `m_moving` is true it randomly rounds the per-turn speed to a multiple of
// NORMAL_SPEED (the rn2(NORMAL_SPEED) call seen in seed8000's trace).
export function mcalcmove(mon, m_moving) {
    let mmove = mon?.data?.mmove ?? NORMAL_SPEED;

    if (mon?.mspeed === MSLOW) {
        if (mmove < NORMAL_SPEED)
            mmove = Math.trunc((2 * mmove + 1) / 3);
        else
            mmove = 4 + Math.trunc(mmove / 3);
    } else if (mon?.mspeed === MFAST) {
        mmove = Math.trunc((4 * mmove + 2) / 3);
    }

    // (steed/gallop branch omitted — never applies to non-steed monsters)

    if (m_moving) {
        const mmove_adj = mmove % NORMAL_SPEED;
        mmove -= mmove_adj;
        if (rn2(NORMAL_SPEED) < mmove_adj)
            mmove += NORMAL_SPEED;
    }
    return mmove;
}

// C ref: mon.c m_calcdistress(mtmp) — per-turn timeouts/regen.  For the
// monsters our sessions exercise (no liquids, no shapeshifters) this is a
// no-op as far as RNG is concerned, but we keep the structure so the loop
// is faithful and extensible.
function m_calcdistress(mtmp) {
    // mon_regen / decide_to_shapeshift / were_change consume no RNG here.
    if (mtmp.mblinded && !--mtmp.mblinded) mtmp.mcansee = 1;
    if (mtmp.mfrozen && !--mtmp.mfrozen) mtmp.mcanmove = 1;
    if (mtmp.mfleetim && !--mtmp.mfleetim) mtmp.mflee = 0;
}

// C ref: mon.c mcalcdistress(void)
export function mcalcdistress() {
    for (const mtmp of monsterList()) {
        if (DEADMONSTER(mtmp)) continue;
        m_calcdistress(mtmp);
    }
}

// C ref: mon.c movemon_singlemon(mtmp) — drive one monster's move, returning
// true if it still has movement points left after this action.
function movemon_singlemon(mtmp) {
    if (DEADMONSTER(mtmp)) return false;
    if (mtmp.mx == null || mtmp.mx <= 0) return false; // off-map

    if ((mtmp.movement || 0) < NORMAL_SPEED) return false;

    mtmp.movement -= NORMAL_SPEED;
    if (mtmp.movement >= NORMAL_SPEED)
        game._somebody_can_move = true;

    dochug(mtmp);
    return false;
}

// C ref: mon.c movemon(void) — perform movement for all monsters.
// Returns true if at least one monster can still move this round.
export function movemon() {
    game._somebody_can_move = false;
    // iter_mons_safe: snapshot the list so deaths/spawns mid-iteration are safe.
    const snapshot = monsterList().slice();
    for (const mtmp of snapshot)
        movemon_singlemon(mtmp);
    return !!game._somebody_can_move;
}
