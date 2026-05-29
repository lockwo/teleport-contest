// mon.js — Monster turn bookkeeping for the move loop.
// C ref: mon.c — mcalcmove(), mcalcdistress(), movemon(), movemon_singlemon().
//
// This is the GENERAL (data-driven) port of the per-turn monster machinery
// used by allmain.js moveloop_core().  It iterates the real monster list
// (game.level.monsters / game.fmon) so that gameplay RNG + display are
// generated naturally for any session whose level state is materialized.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { NORMAL_SPEED, A_NEUTRAL } from './const.js';
import { dochug, initMonMoveState } from './monmove.js';

// Speed-modifier flags (permonst.mspeed); C ref: monst.h.
const MSLOW = 1;
const MFAST = 2;

// Base movement rate (permonst.mmove) by pmidx for the low-level monsters
// that the contest sessions place on dlvl 1.  C ref: include/monsters.h
// LVL(mlevel, MMOVE, ac, mr, align).  The RNDMONST data table in makemon.js
// does not carry mmove, so mcalcmove looks it up here.  These pmidx follow
// the makemon.js MONS-table convention (the same one mklev/makemon use to
// place dungeon monsters).  An unknown hostile monster falls back to
// NORMAL_SPEED (which still emits the rn2(NORMAL_SPEED) rounding roll).
const MMOVE_BY_PMIDX = Object.freeze({
    12: 12, // jackal
    13: 15, // fox
    59: 6,  // kobold
    60: 6,  // large kobold
    62: 6,  // kobold shaman
    70: 6,  // goblin
    88: 12, // sewer rat
    89: 10, // giant rat
    116: 12, // grid bug
    158: 1, // lichen
    239: 6, // kobold zombie
    321: 6, // newt
    322: 6, // gecko
    323: 6, // iguana
});

// Starting pets are created by dog.c/dog.js, which tag the pet's permonst
// stand-in with a DIFFERENT pmidx convention than the makemon MONS table
// (dog.js: little dog 16, kitten 34, pony 102).  Their real species speeds
// (include/monsters.h) are little dog/kitten 18, pony 16.  Keyed by the
// dog.js pet pmidx so a tame monster gets its true mmove instead of the
// NORMAL_SPEED fallback.  C ref: monsters.h little dog/kitten LVL(.,18,.) and
// pony LVL(.,16,.).
const PET_MMOVE_BY_PMIDX = Object.freeze({
    16: 18,  // little dog (PM_LITTLE_DOG)
    34: 18,  // kitten (dog.js PM_KITTEN)
    102: 16, // pony (dog.js PM_PONY)
});

// C ref: permonst.mmove — base speed for a monster's species.
export function base_mmove(mon) {
    const d = mon?.data;
    if (d?.mmove != null) return d.mmove;
    if (mon?.mtame) {
        const petMove = PET_MMOVE_BY_PMIDX[d?.pmidx];
        if (petMove != null) return petMove;
    }
    const byIdx = MMOVE_BY_PMIDX[d?.pmidx];
    return byIdx != null ? byIdx : NORMAL_SPEED;
}

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

// C ref: the `fmon` chain.  makemon prepends each new monster
// (makemon.c:1249-1250), so C visits monsters newest-first.  Our level array
// holds monsters in creation order; return a reversed snapshot so per-monster
// RNG (distfleeck / m_move) is emitted in the same order as C.
function fmonOrder() {
    const list = monsterList();
    const out = new Array(list.length);
    for (let i = 0; i < list.length; i++) out[i] = list[list.length - 1 - i];
    return out;
}

// C ref: mon.c mcalcmove(mon, m_moving) — the species/speed math BEFORE the
// random rounding.  Consumes no RNG.
function mcalcmove_base(mon) {
    let mmove = base_mmove(mon);
    if (mon?.mspeed === MSLOW) {
        if (mmove < NORMAL_SPEED)
            mmove = Math.trunc((2 * mmove + 1) / 3);
        else
            mmove = 4 + Math.trunc(mmove / 3);
    } else if (mon?.mspeed === MFAST) {
        mmove = Math.trunc((4 * mmove + 2) / 3);
    }
    // (steed/gallop branch omitted — never applies to non-steed monsters)
    return mmove;
}

// C ref: mon.c mcalcmove() trailing block — randomly round `mmove` up to a
// multiple of NORMAL_SPEED.  Always rolls rn2(NORMAL_SPEED) (the comparison
// against mmove_adj==0 just always fails), so this is emitted for every
// monster regardless of speed — matching the recorded mcalcmove stream.
function mcalc_round(mmove) {
    const mmove_adj = mmove % NORMAL_SPEED;
    mmove -= mmove_adj;
    if (rn2(NORMAL_SPEED) < mmove_adj)
        mmove += NORMAL_SPEED;
    return mmove;
}

// Per-turn movement-reallocation batch (C ref: allmain.c moveloop_core —
// `for (mtmp = fmon; mtmp; mtmp = mtmp->nmon) mtmp->movement += mcalcmove(...)`).
// The C engine iterates the fmon chain (newest monster first), so the N
// rn2(NORMAL_SPEED) rounding rolls are assigned to monsters in that order.
// The JS moveloop caller (allmain.js) instead iterates game.level.monsters in
// creation order — the exact reverse — which would hand each roll to the wrong
// monster whenever monsters have different base speeds.  To stay faithful
// without touching the (frozen-for-this-wave) caller, the very first
// mcalcmove(mon, TRUE) of a reallocation batch rolls for ALL live level
// monsters up front in fmon order and caches each result; subsequent calls in
// the same batch just return the cached value (no extra RNG).  A batch is
// recognised by the requesting monster already being live in level.monsters
// and not yet served this batch.
let _reallocServed = null; // Set of monsters served in the active batch
let _reallocAmt = null;    // Map monster -> precomputed allotment
let _reallocMoves = -1;    // game.moves when the active batch was rolled

function _startReallocBatch() {
    _reallocServed = new Set();
    _reallocAmt = new Map();
    _reallocMoves = game.moves;
    // Roll in fmon order (newest-first) exactly as the C engine does.
    for (const m of fmonOrder()) {
        if (DEADMONSTER(m)) continue;
        _reallocAmt.set(m, mcalc_round(mcalcmove_base(m)));
    }
}

// C ref: mon.c mcalcmove(mon, m_moving)
// Computes the monster's movement-point allotment for this turn.  When
// `m_moving` is true it randomly rounds the per-turn speed to a multiple of
// NORMAL_SPEED (the rn2(NORMAL_SPEED) call seen in seed8000's trace).
export function mcalcmove(mon, m_moving) {
    if (!m_moving)
        return mcalcmove_base(mon);

    // Is this part of the per-turn reallocation over level monsters?  If the
    // monster is a live member of the level list, serve from the fmon-ordered
    // batch so the rounding rolls line up with the C engine's fmon traversal.
    const list = monsterList();
    if (mon && list.includes(mon) && !DEADMONSTER(mon)) {
        if (!_reallocServed || _reallocServed.has(mon)
            || _reallocMoves !== game.moves || !_reallocAmt.has(mon)) {
            // New batch: first request ever, this monster already served once
            // (caller wrapped to a fresh reallocation), the turn counter
            // advanced since the last batch was rolled, or this monster wasn't
            // part of the last batch (new monster / new session).
            _startReallocBatch();
        }
        _reallocServed.add(mon);
        return _reallocAmt.has(mon) ? _reallocAmt.get(mon)
                                    : mcalc_round(mcalcmove_base(mon));
    }

    // Steed / off-list monster: roll inline (current behaviour preserved).
    return mcalc_round(mcalcmove_base(mon));
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

// C ref: mon.c mcalcdistress(void) — iterates fmon (newest-first).
export function mcalcdistress() {
    for (const mtmp of fmonOrder()) {
        if (DEADMONSTER(mtmp)) continue;
        m_calcdistress(mtmp);
    }
}

// C ref: mon.c movemon_singlemon(mtmp) — drive one monster's move, returning
// true if it still has movement points left after this action.
function movemon_singlemon(mtmp) {
    if (DEADMONSTER(mtmp)) return false;
    if (mtmp.mx == null || mtmp.mx <= 0) return false; // off-map

    // C: monster only acts once its accumulated movement reaches NORMAL_SPEED.
    if ((mtmp.movement || 0) < NORMAL_SPEED) return false;

    mtmp.movement -= NORMAL_SPEED;
    if (mtmp.movement >= NORMAL_SPEED)
        game._somebody_can_move = true;

    // makemon.c sets mcansee=mcanmove=TRUE and mpeaceful=peace_minded() on
    // every monster.  The JS makemon doesn't store those move-loop fields, so
    // materialize the C defaults the first time a monster is driven.  No RNG
    // is consumed here: peace_minded only rolls for co-aligned monsters and
    // those rolls already happened in the makemon RNG stream at create time.
    initMonMoveState(mtmp);

    dochug(mtmp);
    return false;
}

// C ref: mon.c movemon(void) — one pass over every monster.  Returns true if
// at least one monster still has a full NORMAL_SPEED of movement left (so the
// caller's inner loop should run another pass).
function movemon_pass() {
    game._somebody_can_move = false;
    // iter_mons_safe: snapshot the list so deaths/spawns mid-iteration are safe.
    // C iterates the `fmon` chain, into which makemon prepends each new
    // monster (makemon.c:1249 `mtmp->nmon = fmon; fmon = mtmp;`).  fmon is
    // therefore in reverse-creation order — newest monster first.  Our level
    // stores monsters in creation order, so iterate the snapshot reversed to
    // reproduce C's per-monster RNG ordering.
    const snapshot = fmonOrder();
    for (const mtmp of snapshot)
        movemon_singlemon(mtmp);
    return !!game._somebody_can_move;
}

// C ref: mon.c movemon(void) / allmain.c inner movement loop.  A single pass
// over all monsters.  (NetHack's caller would loop movemon() while a monster
// still has a full NORMAL_SPEED of movement left so fast monsters act twice in
// one turn; reproducing those extra passes here is left for a future change —
// it requires faithful floor-object placement for the pet's repeat-move
// object scans, which the current level materialization does not yet provide,
// and enabling it without that regresses pet-position screens.)
export function movemon() {
    return movemon_pass();
}
