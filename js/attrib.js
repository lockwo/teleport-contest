// attrib.js — attribute exercise / abuse.
// C ref: attrib.c.  Only the RNG-bearing routine exercised by the quaff /
// zap / cast gameplay sessions is ported here.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { A_STR, A_INT, A_WIS, A_CON, A_CHA, A_MAX } from './const.js';

const AVAL = 50; // C ref: attrib.c — tune value for exercise gains.

// C ref: attrib.h ACURR(x) — current attribute value.  acurr.a is in
// [Str,Int,Wis,Dex,Con,Cha] order.
function ACURR(i) {
    return game.u?.acurr?.a?.[i] ?? 0;
}

// C ref: attrib.h AEXE(x) — exercise accumulator; lazily allocated to zeros.
function ensureAexe() {
    game.u = game.u || {};
    if (!game.u.aexe) game.u.aexe = { a: Array(A_MAX).fill(0) };
    return game.u.aexe.a;
}

// C ref: attrib.c exercise(i, inc_or_dec).  A_INT/A_CHA can't be exercised
// (early return, no RNG).  Polymorph blocks all but A_WIS (no Upolyd at game
// start).  When |AEXE(i)| < AVAL the accumulator is nudged: a gain rolls
// rn2(19) > ACURR(i) (harder at higher attributes), a loss is -rn2(2).
// encumber_msg() (A_STR/A_CON when moves>0) consumes no RNG.
export function exercise(i, inc_or_dec) {
    if (i === A_INT || i === A_CHA)
        return;
    if (game.u?.Upolyd && i !== A_WIS)
        return;
    const aexe = ensureAexe();
    if (Math.abs(aexe[i] ?? 0) < AVAL) {
        aexe[i] = (aexe[i] ?? 0)
            + (inc_or_dec ? (rn2(19) > ACURR(i) ? 1 : 0) : -rn2(2));
    }
    // encumber_msg() for A_STR/A_CON is display-only; no RNG, omitted.
}
