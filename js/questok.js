// questok.js — quest.c's purity test and ok_to_quest() as a LEAF module.
//
// questpgr.js (the rest of quest.c) statically imports half the game, so the
// early-loaded callers of ok_to_quest() (hack.js, dokick.js, pager.js, do.js,
// zap.js) import it from here instead and avoid module-init cycles.
import { game } from './gstate.js';

// C ref: quest.h MIN_QUEST_ALIGN — at least this align.record to start.
export const MIN_QUEST_ALIGN = 20;

const A_CURRENT = 0, A_ORIGINAL = 1;   // C ref: align.h
const A_NEUTRAL = 0;

// C ref: u.ualignbase[A_ORIGINAL].
export function align_original() {
    const u = game.u || {};
    return u.ualignbase?.[A_ORIGINAL] ?? u.ualign?.type ?? A_NEUTRAL;
}

// C ref: quest.c is_pure()'s result computation (everything after the
// wizard-mode feedback block): 1 pure, 0 not yet acceptable, -1 converted.
export function purity_of() {
    const u = game.u || {};
    const orig = align_original();
    const rec = u.ualign?.record ?? 0;
    const cur = u.ualignbase?.[A_CURRENT] ?? orig;
    return (rec >= MIN_QUEST_ALIGN && u.ualign?.type === orig && cur === orig) ? 1
        : (cur !== orig) ? -1 : 0;
}

// C ref: quest.c ok_to_quest() — external hook for do.c (stairs down from the
// quest home level), dokick.c, pager.c and zap.c:
// `((got_quest || got_thanks) && is_pure(FALSE) > 0) || killed_leader`.
export function ok_to_quest() {
    const q = game.quest_status || {};
    return !!(((q.got_quest || q.got_thanks) && purity_of() > 0) || q.killed_leader);
}

// C ref: `on_level(&u.uz, &qstart_level)` — the hero is on the quest home level.
export function on_qstart_level() {
    const uz = game.u?.uz, q = game.qstart_level;
    return !!(uz && q && uz.dnum === q.dnum && uz.dlevel === q.dlevel);
}
