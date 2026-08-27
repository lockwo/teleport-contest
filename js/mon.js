// mon.js — Monster turn bookkeeping for the move loop.
// C ref: mon.c — mcalcmove(), mcalcdistress(), movemon(), movemon_singlemon().
//
// This is the GENERAL (data-driven) port of the per-turn monster machinery
// used by allmain.js moveloop_core().  It iterates the real monster list
// (game.level.monsters / game.fmon) so that gameplay RNG + display are
// generated naturally for any session whose level state is materialized.

import { game } from './gstate.js';
import { rn2, rn1 } from './rng.js';
import { NORMAL_SPEED, A_NEUTRAL, ROOM, is_pit, MAX_CARR_CAP, WT_HUMAN,
    W_ARM, W_ARMC, W_ARMH, W_ARMS, W_ARMG, W_ARMF, W_ARMU, I_SPECIAL,
    IS_DOOR, IS_POOL, IS_LAVA, WATER, Is_waterlevel,
    D_CLOSED, D_LOCKED } from './const.js';
import { Conflict, resist_conflict, m_canseeu } from './monmove.js';
import { mattackm } from './mhitm.js';
import { M_ATTK_HIT, M_ATTK_DEF_DIED, M_ATTK_AGR_DIED, MON_MIGRATING } from './const.js';
import { dochugw, initMonMoveState, m_next2u, hideunder, hides_under_pm, mon_regen,
    m_everyturn_effect, monflee, onscary } from './monmove.js';
import { cansee, Blind } from './vision.js';
import { t_at } from './trap.js';
import { night, FULL_MOON } from './calendar.js';
import { is_were_flag, is_human_flag, mflags1_of, mflags2_of, mflags3_of,
    M1_NOTAKE, M1_NOHANDS, M1_AMORPHOUS, M1_HIDE, M1_CLING, M1_FLY, M1_TPORT,
    M1_BREATHLESS, M1_SLITHY, M2_DEMON, M3_COVETOUS, mindless,
    humanoid, is_animal, nohands,
    strongmonst_flag, throws_rocks_flag } from './monflags_data.js';
import { attacktype, AT_ENGL } from './monattk_data.js';
import { objects as OBJECTS, CORPSE, BOULDER, BELL_OF_OPENING,
    COIN_CLASS, GEM_CLASS, ROCK_CLASS, place_object } from './mkobj.js';
import { monster_by_pmidx, newcham, enexto_spawn,
    pickvampshape_pub, set_mimic_sym } from './makemon.js';
import { newsym, pline, update_topl, see_with_infrared, canseemon_shared,
    tp_sensemon } from './display.js';
import { dist2 } from './hacklib.js';
import { Monnam } from './uhitm.js';

// Additional bindings used ONLY by the "mon.c completion" block at the end of
// this file.  They are separate import statements from modules mon.js already
// imports, so the module GRAPH (and therefore every module's top-level
// evaluation order) is unchanged; anything from a module mon.js does not
// already import is reached with `await import()` inside the function body.
import { isok } from './hacklib.js';
import { NON_PM, LOW_PM, G_GENOD, MON_FLOOR, MON_OFFMAP, MON_DETACH, MON_LIMBO,
    MON_ENDGAME_FREE, MON_ENDGAME_MIGR, MON_OBLITERATE, STRAT_WAITMASK,
    W_SADDLE, MIGR_APPROX_XY, MIGR_RANDOM, POOL, MOAT, LAVAPOOL, LAVAWALL,
    ACCESSIBLE, thats_enough_tries, ismnum, engulfing_u, Has_contents,
    M_AP_TYPE, OBJ_AT, EDOG, MGIVENNAME, has_eshk, has_epri, has_emin,
    has_egd, has_edog, In_endgame, Is_astralevel } from './const.js';
import { M1_NOHEAD, M2_UNDEAD, M2_ELF, M2_DWARF, M2_GNOME, M2_ORC,
    M2_SHAPESHIFTER } from './monflags_data.js';
import { AT_GAZE, AT_EXPL, AT_BOOM, mattk_of } from './monattk_data.js';
import { EGG, ICE_BOX } from './mkobj.js';
import { name_to_pmidx, pm_to_cham, dead_species, mpickobj,
    is_home_elemental } from './makemon.js';
import { impossible, m_at } from './display.js';
import { couldsee } from './vision.js';

// Speed-modifier flags (permonst.mspeed); C ref: monst.h.
const MSLOW = 1;
const MFAST = 2;

// Base movement rate (permonst.mmove) for every species, indexed by pmidx in
// the makemon.js MONS-table order (the same `MONS_NAMES` convention mklev /
// makemon use to place dungeon monsters).  C ref: include/monsters.h
// LVL(mlevel, MMOVE, ac, mr, align) — this is the full MMOVE column, mapped
// from each makemon.js monster name to its NetHack-5.0 base speed.  The
// RNDMONST data table in makemon.js does not carry mmove, so mcalcmove looks
// it up here.  A monster whose pmidx falls outside this table falls back to
// NORMAL_SPEED (which still emits the rn2(NORMAL_SPEED) rounding roll).
//
// NOTE: the rounding roll mcalc_round() always uses rn2(NORMAL_SPEED), so an
// incorrect base speed does NOT change the *RNG draw*; it changes the
// per-turn movement-point allotment (mmove_adj = mmove % NORMAL_SPEED), which
// governs whether/when a monster reaches NORMAL_SPEED and acts.  Getting the
// base speeds right therefore keeps downstream monster-move RNG (distfleeck /
// dog_move / m_move) and the rendered monster positions in sync with C.
//
// Built by mapping each makemon.js MONS_NAMES[pmidx] species to its base speed
// in the RECORDER's include/monsters.h (nethack-c/recorder), the C build that
// produced the recorded sessions.  The previous version of this table was
// indexed against a *different* monster enumeration (one that included extra
// 5.0.0 species such as Cerberus/beholder that the recorder's MONS_NAMES does
// not), so every entry from pmidx 153 (stalker) onward was shifted by the
// accumulated offset and read out the wrong species' speed — e.g. gnome
// (pmidx 165) was 1 instead of 6, the elementals (153-157) were rotated, and
// the giants / golems / demons were all off by one or more.  Looking each
// MONS_NAMES entry up by NAME in the recorder fixes the alignment.
//
// The mail-daemon splice (mons[] gained PM_MAIL_DAEMON at pmidx 314 under
// MAIL_STRUCTURES) never reached this table, so every species from 314 on read
// its SUCCESSOR's speed — jellyfish got the djinni's 18 against C's 3, piranha
// 12 instead of 18, kraken 6 instead of 3.  A wrong speed does not shift the
// RNG *stream*, but it hands the rn2(NORMAL_SPEED) allotment to the wrong
// monsters, so a different SET of monsters acts and their m_move draws land in
// a different order.  Verified index-for-index with swarm/bin/speedaudit.mjs.
const MMOVE_BY_PMIDX = Object.freeze([
    /*   0 */ 18, 18, 18, 18, 6, 24, 3, 1, 6, 4, 6, 6, 12, 15, 12, 12,
    /*  16 */ 18, 16, 16, 15, 12, 12, 12, 12, 12, 12, 14, 3, 1, 13, 13, 13,
    /*  32 */ 18, 16, 15, 15, 15, 15, 12, 12, 12, 10, 15, 9, 6, 9, 6, 6,
    /*  48 */ 12, 12, 3, 12, 12, 3, 15, 13, 0, 0, 3, 6, 6, 6, 6, 15,
    /*  64 */ 3, 3, 3, 12, 12, 12, 6, 9, 9, 9, 5, 7, 9, 5, 1, 1,
    /*  80 */ 1, 9, 9, 18, 3, 12, 12, 12, 12, 10, 12, 12, 3, 3, 12, 4,
    /*  96 */ 15, 15, 3, 3, 16, 24, 24, 24, 20, 24, 1, 20, 20, 20, 22, 22,
    /* 112 */ 3, 3, 3, 9, 12, 18, 15, 15, 8, 10, 8, 10, 18, 16, 22, 22,
    /* 128 */ 20, 20, 18, 18, 20, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
    /* 144 */ 9, 9, 9, 9, 9, 9, 9, 9, 9, 12, 36, 12, 6, 5, 1, 0,
    /* 160 */ 0, 0, 0, 1, 1, 6, 8, 10, 10, 6, 6, 10, 12, 12, 12, 12,
    /* 176 */ 18, 15, 12, 6, 8, 10, 12, 6, 9, 9, 9, 8, 10, 10, 10, 12,
    /* 192 */ 12, 12, 14, 10, 10, 10, 10, 12, 14, 14, 16, 10, 12, 14, 1, 3,
    /* 208 */ 6, 6, 12, 12, 18, 12, 8, 15, 15, 3, 15, 18, 12, 10, 12, 14,
    /* 224 */ 12, 6, 12, 14, 26, 12, 12, 12, 9, 12, 12, 12, 15, 12, 15, 6,
    /* 240 */ 6, 6, 6, 6, 6, 8, 6, 8, 8, 12, 12, 9, 9, 6, 3, 8,
    /* 256 */ 7, 6, 6, 6, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 16,
    /* 272 */ 12, 12, 0, 12, 15, 10, 10, 6, 10, 10, 10, 10, 12, 12, 15, 3,
    /* 288 */ 10, 12, 12, 9, 12, 12, 12, 12, 6, 15, 6, 9, 6, 12, 5, 3,
    /* 304 */ 18, 9, 3, 15, 9, 12, 15, 12, 12, 12, 24, 12, 3, 18, 12, 9,
    /* 320 */ 10, 3, 6, 6, 6, 6, 6, 5, 9, 12, 0, 12, 12, 12, 12, 12,
    /* 336 */ 12, 12, 12, 12, 12, 12, 12, 12, 15, 15, 15, 15, 15, 15, 15, 15,
    /* 352 */ 15, 15, 15, 15, 15, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
    /* 368 */ 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
]);

// Starting pets get a hand-built permonst stand-in from dog.js with no mmove
// field, so they miss the `d.mmove != null` fast path below.  Their pmidx now
// agrees with MONS (little dog 16, kitten 32, pony 100), which makes this table
// redundant with MMOVE_BY_PMIDX — keep it as the explicit statement of the
// three species speeds C gives them (monsters.h LVL(.,18,.) / LVL(.,16,.)).
const PET_MMOVE_BY_PMIDX = Object.freeze({
    16: 18,  // little dog (PM_LITTLE_DOG)
    32: 18,  // kitten (PM_KITTEN)
    100: 16, // pony (PM_PONY)
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

// C ref: monsters.h LVL() mmove — the SPECIES base speed, which is what
// exper.c experience() reads (not the monster's adjusted movement).
export function mmove_of(data) {
    return MMOVE_BY_PMIDX[data?.pmidx] ?? PET_MMOVE_BY_PMIDX[data?.pmidx] ?? NORMAL_SPEED;
}

// C ref: mon.c:3135 — mondead() tallies svm.mvitals[monsndx(data)].died
// (capped at 255) for EVERY monster death, not just the hero's kills; it drives
// insight.c list_vanquished()'s ntypes/total and extinction.
export function mvitals_died(mon) {
    const mndx = mon?.data?.pmidx;
    if (mndx == null) return;
    const mv = (game.mvitals = game.mvitals || []);
    const e = (mv[mndx] = mv[mndx] || { died: 0, mvflags: 0 });
    if (e.died < 255) e.died++;
}

// C ref: mon.c DEADMONSTER(mon) — hp <= 0.
export function DEADMONSTER(mon) {
    return !mon || (mon.mhp != null && mon.mhp <= 0);
}

// The live monster list for the current level.  C uses the `fmon` chain; our
// level stores monsters in an array.  This is the RAW list — dead and off-map
// monsters are still in it (C's dmonsfree() unlink is not modelled), so every
// caller applies its own DEADMONSTER() / mon_offmap() filter, exactly as C's
// iter_mons_safe() does.
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

// C ref: mon.c:1126 mcalcmove(mon, m_moving) — the species/speed math BEFORE
// the random rounding.  Draws only for a galloping steed (see below).
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
    // C ref: mon.c:1147 — `if (mon == u.usteed && u.ugallop && svc.context.mv)
    // mmove = ((rn2(2) ? 4 : 5) * mmove) / 3;`.  This DRAWS, and it draws for
    // BOTH values of m_moving (the mounted hero's u_calc_moveamt call and the
    // steed's own reallocation-loop call), one rn2(2) ahead of the rounding
    // roll.  Nothing in this port sets u.ugallop yet (steed.js only clears it
    // on dismount), so it is latent — but the guard is C's, not an assumption.
    if (mon && mon === game.u?.usteed && game.u?.ugallop && game.context?.mv)
        mmove = Math.trunc(((rn2(2) ? 4 : 5) * mmove) / 3);
    return mmove;
}

// C ref: mon.c:1155-1166 mcalcmove()'s trailing `if (m_moving)` block — randomly
// round `mmove` up to a multiple of NORMAL_SPEED.  There is no `if (mmove)`
// guard in C, so the rn2(NORMAL_SPEED) is drawn for EVERY monster on every
// reallocation, even a speed-0 sessile one whose mmove_adj is 0 (the draw
// happens, the `< 0` comparison then always fails) — which is why an incorrect
// base speed shifts allotments but never shifts the RNG stream.
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
export function mcalcmove(mon, m_moving, inline = false) {
    if (!m_moving)
        return mcalcmove_base(mon);

    // C ref: allmain.c u_calc_moveamt() — a RIDING hero who moved gets
    // moveamt = mcalcmove(u.usteed, TRUE).  This is a SEPARATE roll from the
    // steed's per-turn reallocation-loop roll (the steed is in fmon and is
    // rolled there too), so it must NOT be served from / re-trigger the batch
    // cache.  `inline` forces a single fresh rn2(NORMAL_SPEED) roll.
    if (inline)
        return mcalc_round(mcalcmove_base(mon));

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

// ── lycanthropes (were.c) ────────────────────────────────────────────────────
// C ref: mondata.h is_were(ptr) = (mflags2 & M2_WERE); is_human(ptr) =
// (mflags2 & M2_HUMAN).  Both come from js/monflags_data.js, which is generated
// from the recorder's monsters.h and verified index-for-index against
// js/makemon.js's table.  The port's usual name-keyed workaround CANNOT be used
// here: monsters.h gives the animal and human forms of each lycanthrope THE SAME
// NAME ("werewolf" appears twice, once as S_DOG and once as S_HUMAN), so
// M2_HUMAN_NAMES calls both forms human and would take the wrong branch every
// time.  Only the flag bits distinguish them.
// C ref: were.c counter_were(pm) — the opposite form of a lycanthrope.  Keyed by
// pmidx because that IS the C monster index (verified by the generator).
const COUNTER_WERE = { 15: 262, 21: 263, 91: 261, 261: 91, 262: 15, 263: 21 };
function is_were(ptr) { return is_were_flag(ptr); }
function counter_were(pmidx) {
    const c = COUNTER_WERE[pmidx];
    return c === undefined ? -1 : c;
}
function is_human_were(ptr) { return is_were_flag(ptr) && is_human_flag(ptr); }
// C ref: youprop.h Protection_from_shape_changers — extrinsic only (the ring).
// Read from the same uprops bag the rest of the port uses.  Nothing sets it
// yet, so it is False throughout; note that when it DOES get set, C also runs
// mon.c:4622 rescham() (every chameleon/mimic snaps back to its natural shape
// and every were reverts to human) on put-on and mon.c:4646 restartcham() on
// take-off.  Neither is ported, and both change monster forms wholesale.
export function Protection_from_shape_changers() {
    return !!game.u?.uprops?.Protection_from_shape_changers;
}

// C ref: mon.c:2476 monnear(mon, x, y) — within one (king) step; a grid bug
// can't reach a diagonal neighbour.  Needed by new_were's flee check.
const PM_GRID_BUG = 116;
function monnear(mon, x, y) {
    const distance = dist2(mon.mx, mon.my, x, y);
    if (distance === 2 && mon.data?.pmidx === PM_GRID_BUG) return false;
    return distance < 3;
}

// C ref: were.c:96 new_were(mon) — swap a lycanthrope to its counterpart form.
// The order matters: C plines BEFORE set_mon_data (so the message and the
// newsym() that erases/redraws the monster land on either side of a --More--
// boundary the way C renders them), and the trailing
// `monflee(mon, rn1(9,2), TRUE, TRUE)` DRAWS whenever this runs during monster
// movement (svc.context.mon_moving) next to something scary.  That branch is
// unreachable from were_change() — mcalcdistress runs in the once-per-turn
// block with mon_moving FALSE (allmain.c:216 clears it before allmain.c:228) —
// but new_were has three other C call sites (mhitu.c:980/983 when a were bites
// the hero, potion.c's water-prayer revert) that DO run with mon_moving set, so
// the guard is ported rather than assumed away.
// Still not modelled: mon_break_armor()/possibly_unwield() (worn.c) shed armor
// and weapons that no longer fit the new form.  Neither draws RNG, but both
// change the monster's AC / wielded weapon, which later attack rolls read.
async function new_were(mon) {
    // C: the hero's extrinsic pins a were in critter form; it can still revert.
    if (Protection_from_shape_changers() && is_human_were(mon.data)) return;
    const pm = counter_were(mon.data?.pmidx);
    if (pm < 0) return; // C: impossible("unknown lycanthrope")
    const ptr = monster_by_pmidx(pm);
    if (!ptr) return;
    // C ref: were.c:110 — pline() runs with the monster still in its OLD form.
    if (canseemon_mon(mon) && !game.u?.uhallu) {
        // C: pmname(&mons[pm]) + 4 — skip past the "were" prefix.
        const into = is_human_flag(ptr) ? 'human' : (ptr.name || '').slice(4);
        await pline(`${Monnam(mon)} changes into a ${into}.`);
    }
    mon.data = ptr;
    // C: helpless(mon) -> the transformation wakens and revitalizes.
    if (mon.msleeping || !mon.mcanmove) {
        mon.msleeping = 0;
        mon.mfrozen = 0;
        mon.mcanmove = 1;
    }
    // C: healmon(mon, (mhpmax - mhp) / 4, 0) — regain a quarter of lost HP.
    healmon(mon, Math.floor(((mon.mhpmax || 0) - (mon.mhp || 0)) / 4), 0);
    newsym(mon.mx, mon.my);
    // C ref: were.c:132 — mon_break_armor(mon, FALSE).  possibly_unwield() is
    // still unported: it only re-checks the WIELDED weapon, which this port
    // does not give were-forms.
    await mon_break_armor(mon, false);
    if (game.context?.mon_moving && !mon.mpeaceful
        && onscary(mon.mux, mon.muy, mon) && monnear(mon, mon.mux, mon.muy))
        await monflee(mon, rn1(9, 2), true, true); /* 2..10 turns */
}

// C ref: were.c were_change(mon) — each lycanthrope rolls once per turn to
// flip form.  THE DRAW IS THE POINT: a human-form were draws
// rn2(night() ? (FULL_MOON ? 3 : 30) : (FULL_MOON ? 10 : 50)) and an
// animal-form were draws rn2(30), every turn, for the whole game.  Omitting it
// desynced every session containing a lycanthrope from the first turn one was
// alive onward.
// Note the short-circuit order in each branch: the human branch tests
// !Protection_from_shape_changers FIRST (so no draw while protected), while the
// animal branch tests !rn2(30) first (so the draw ALWAYS happens).
// C ref: youprop.h Deaf — HDeaf (a timed intrinsic) or EDeaf (worn).  Same
// shape as sounds.js Deaf_hero(); only the timed intrinsic is reachable.
function Deaf() {
    const u = game.u;
    return ((u?.uprops?.HDeaf ?? 0) > 0) || !!u?.Deaf;
}

// C ref: makemon MONS-table indices of the ANIMAL lycanthrope forms (the human
// forms are 261/262/263).  were.c's howl switch names only PM_WEREWOLF and
// PM_WEREJACKAL — a wererat makes no noise.
const PM_WEREJACKAL = 15, PM_WEREWOLF = 21;

async function were_change(mon) {
    const ptr = mon.data;
    if (!is_were(ptr)) return;

    if (is_human_were(ptr)) {
        const full = game.flags?.moonphase === FULL_MOON;
        if (!Protection_from_shape_changers()
            && !rn2(night() ? (full ? 3 : 30) : (full ? 10 : 50))) {
            await new_were(mon); // change into animal form
            game.were_changes = (game.were_changes || 0) + 1;
            // C ref: were.c:20-38 — an UNSEEN were that just took animal form
            // howls.  This is not cosmetic: wake_nearto() clears msleeping on
            // every monster within 16 squared units, and a monster C woke but
            // this port left asleep skips its entire dochug() (every m_move
            // rn2, every attack roll) from the next monster phase onward.
            if (!Deaf() && !canseemon_mon(mon)) {
                const mndx = mon.data?.pmidx;
                const howler = mndx === PM_WEREWOLF ? 'wolf'
                             : mndx === PM_WEREJACKAL ? 'jackal' : null;
                if (howler) {
                    // C ref: were.c:37 You_hear() -> pline -> vpline ->
                    // update_topl, which APPENDS to an unacknowledged top line.
                    // mon_break_armor's "You hear a thud." fires first (were.c
                    // :129 runs before this), and C renders both on one line.
                    await update_topl(`You hear a ${howler} howling at the moon.`);
                    const { wake_nearto } = await import('./cmd.js');
                    await wake_nearto(mon.mx, mon.my, 4 * 4);
                }
            }
        }
    } else if (!rn2(30) || Protection_from_shape_changers()) {
        await new_were(mon); // change back into human form
        game.were_changes = (game.were_changes || 0) + 1;
    }
}

// C ref: display.h:118 _canseemon(mon) ==
//     (cansee(mx, my) || see_with_infrared(mon)) && mon_visible(mon)
// with display.h:91 _mon_visible(mon) ==
//     (!mon->minvis || See_invisible) && !mon->mundetected
// The infravision half is what lets a non-human hero (dwarf/gnome/orc/elf) see
// a warm-blooded monster on an unlit square that is still in line of sight;
// omitting it silently suppressed those monsters' messages.  The mundetected
// half was ALSO missing, which made a hidden monster (a piercer on the ceiling,
// a snake under a boulder) read as visible to every mon.js caller — the hide
// message would print and the eel re-hide roll below would be skipped.
// (There is no uswallow special case in C: a swallowed hero sees mon_visible
// monsters only where cansee() says so, which inside a swallower is the
// swallower's own square.)
function canseemon_mon(mtmp) {
    if (!mtmp) return false;
    if (!(cansee(mtmp.mx, mtmp.my) || see_with_infrared(mtmp))) return false;
    if (mtmp.minvis && !game.u?.see_invis) return false;
    return !mtmp.mundetected;
}

// C ref: mon.c:4596 healmon(mtmp, amt, overheal) — give a monster hit points,
// capped at mhpmax (+overheal, which also raises mhpmax).  Consumes no RNG.
// The &youmonst branch is the hero's healup(); no caller in this port passes
// the hero, so only the monster arm is needed.
export function healmon(mtmp, amt, overheal) {
    const oldhp = mtmp.mhp || 0;
    const mhpmax = mtmp.mhpmax || 0;
    if (oldhp + amt > mhpmax + overheal) {
        mtmp.mhpmax = mhpmax + overheal;
        mtmp.mhp = mtmp.mhpmax;
    } else {
        mtmp.mhp = oldhp + amt;
        if (mtmp.mhp > mhpmax) mtmp.mhpmax = mtmp.mhp;
    }
    return mtmp.mhp - oldhp;
}

// C ref: mon.c:1180 m_calcdistress(mtmp) — per-turn liquid check / regen /
// shapeshift / timeouts.  mon_regen consumes no RNG; decide_to_shapeshift and
// were_change BOTH do, every turn, for every monster with a cham form or the
// M2_WERE bit (an earlier comment here claimed decide_to_shapeshift was
// RNG-free "for the species our sessions exercise" — it is not, and the draw
// order note immediately below always contradicted it).
// C ref: mon.c:4871-4936 decide_to_shapeshift(mon) — the per-turn shapeshift
// check run from m_calcdistress for every monster with a cham form.
//
// Draw order: a plain shapeshifter costs one rn2(6) per turn (plus rn2(10) when
// it fires); a vampshifter in a shifted form costs the fog-cloud rn2(4)
// (mon.c:4899), and a vampire in its own form the rn2(6) at mon.c:4921 — the
// canseemon/mdistu guards sit AFTER those draws, so they never suppress them.
const STRAT_WAITFORU = 0x20000000;
const PM_FOG_CLOUD_IDX = 106;
const BOLT_LIM_SQ = 8 * 8;
function decide_to_shapeshift(mon) {
    let ptr = null;
    const was_female = mon.female;
    let dochng = false;

    if (!is_vampshifter(mon)) {
        if (!mon.mspec_used && !rn2(6)) {          // mon.c:4879
            dochng = true;
            mon.mspec_used = 3 + rn2(10);          // mon.c:4881
        }
    } else if (!((mon.mstrategy || 0) & STRAT_WAITFORU)) {
        const far_or_unseen = () => (!canseemon_shared(mon)
                                     || mdistu(mon) > BOLT_LIM_SQ);
        if (mon.data?.mcls !== S_VAMPIRE) {
            if ((mon.mhp <= Math.floor((mon.mhpmax + 5) / 6)) && rn2(4)  // mon.c:4894
                && (mon.cham ?? -1) >= 0) {
                ptr = monster_by_pmidx(mon.cham);
                dochng = true;
            } else if (mon.data?.pmidx === PM_FOG_CLOUD_IDX
                       && mon.mhp === mon.mhpmax && !rn2(4)              // mon.c:4899
                       && far_or_unseen()) {
                const mndx = pickvampshape_pub(mon);
                if (mndx >= 0) {
                    ptr = monster_by_pmidx(mndx);
                    dochng = (ptr !== mon.data);
                }
            }
            // C: an amorphous form standing in a closed doorway steps aside
            // first, because its new shape would not fit.  enexto() draws.
            if (dochng && (mflags1_of(mon.data) & M1_AMORPHOUS)
                && closed_door_at(mon.mx, mon.my)) {
                const cc = enexto_spawn(mon.mx, mon.my, ptr);
                if (cc) { mon.mx = cc.x; mon.my = cc.y; newsym(cc.x, cc.y); }
            }
        } else if (mon.mhp >= Math.floor(9 * mon.mhpmax / 10) && !rn2(6)  // mon.c:4921
                   && far_or_unseen()) {
            dochng = true;                         /* 'ptr' stays Null */
        }
    }
    if (dochng && newcham(mon, ptr)) {
        // vampshift overrides newcham's 10% sex change by restoring the
        // original gender when the new form allows either.  No RNG.
        if (is_vampshifter(mon)) {
            const np = mon.data;
            if (np && np.gcode === 0) mon.female = was_female;
        }
    }
}

// C ref: rm.h closed_door(x, y).
function closed_door_at(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return IS_DOOR(loc.typ) && ((loc.doormask & (D_CLOSED | D_LOCKED)) !== 0);
}

// C ref: mondata.h mdistu(mon) — squared distance from the hero.
function mdistu(mon) {
    return dist2(mon.mx, mon.my, game.u?.ux ?? 0, game.u?.uy ?? 0);
}

// C ref: monsym.h S_EYE=5, S_LIGHT=25 — mondata.h is_floater(ptr) is exactly
// `mlet == S_EYE || mlet == S_LIGHT`.
const S_EYE_MCLS = 5, S_LIGHT_MCLS = 25;
function is_floater(ptr) {
    return ptr?.mcls === S_EYE_MCLS || ptr?.mcls === S_LIGHT_MCLS;
}
function is_flyer_m(ptr) { return (mflags1_of(ptr) & M1_FLY) !== 0; }
// C ref: mondata.h breathless(ptr) = (mflags1 & M1_BREATHLESS).
function breathless(ptr) { return (mflags1_of(ptr) & M1_BREATHLESS) !== 0; }

// C ref: mon.c:947 minliquid(mtmp) / mon.c:961 minliquid_core(mtmp) — reconcile
// a monster with the water or lava it is standing in.  C runs this from TWO
// places this port had left out entirely: m_calcdistress()'s leading
// `mtmp->data->mmove == 0` guard (mon.c:1185) and movemon_singlemon() right
// after the movement-point deduction (mon.c:1254), i.e. for EVERY monster on
// EVERY move.
//
// Ported completely: the trailing "but eels have a difficult time outside" arm,
// the only one whose RNG is self-contained —
//     if (mtmp->mhp > 1 && rn2(mtmp->mhp) > rn2(8)) mtmp->mhp--;
//     monflee(mtmp, 2, FALSE, FALSE);
// two draws every turn an eel spends out of water, plus a flee timer that
// steers its m_move for the next two turns.
//
// DEFERRED, and drawing NOTHING rather than half of C's stream (a partial guard
// would trade one wrong stream for another):
//   * gremlin in a pool/fountain (mon.c:987): rn2(3), then split_mon() clones
//     it — makemon-level RNG with no entry point in this port — plus dryup().
//   * iron golem in a pool (mon.c:994): rn2(5), then d(2,6) rust damage and
//     possibly mondied().
//   * the inpool arm (mon.c:1064): mondied() leaves a cadaver, so it needs
//     make_corpse's corpse_chance rolls in the right order.
// The INLAVA arm (mon.c:1010) IS ported below: a non-clinging, non-lava-liking
// monster standing in lava is destroyed the next time movemon hands it a move,
// and for the ordinary case (no M1_TPORT, no MR_FIRE) that costs ZERO RNG —
// which is exactly why it was invisible here.  Leaving it out kept a monster
// alive that C deletes, and that monster then runs a whole dochug() the C
// stream does not have (seed0360 wizard2: a mumak on the lava at <55,9>).
// Returns 1 if the monster died.
// C ref: mondata.h:190 likes_lava(ptr) — fire elemental and salamander only.
const LAVA_LIKER_NAMES = new Set(['fire elemental', 'salamander']);
function mon_likes_lava(ptr) { return LAVA_LIKER_NAMES.has(ptr?.name); }
// C ref: permonst.h MR_FIRE.
const MR_FIRE_BIT = 0x01;
async function minliquid(mtmp) {
    const loc = game.level?.at(mtmp.mx, mtmp.my);
    const typ = loc?.typ;
    if (typ == null) return 0;
    const ptr = mtmp.data;
    const airborne = is_flyer_m(ptr) || is_floater(ptr);
    // C ref: dbridge.c is_pool(x,y)/is_lava(x,y) are the POSITION forms, which
    // read a raised drawbridge's DB_UNDER mask.  rm.h's IS_POOL(typ) counts
    // every DRAWBRIDGE_UP as water, so it is a strict SUPERSET: using it here
    // can only SUPPRESS the eel arm on a dry drawbridge, never fire it on a
    // square C considers dry.
    const waterwall = (typ === WATER);
    const inpool = IS_POOL(typ) && (!airborne || Is_waterlevel(game.u?.uz));
    const inlava = IS_LAVA(typ) && !airborne;

    if (inlava) {
        // C ref: mon.c:1010 — a ceiling clinger hangs above the lava and a
        // lava-liker is at home in it; everything else burns.
        if (((mflags1_of(ptr) & M1_CLING) === 0) && !mon_likes_lava(ptr)) {
            // C ref: mon.c:1015 — a teleporter escapes instead (rloc's RNG).
            if ((mflags1_of(ptr) & M1_TPORT) !== 0) {
                const { rloc, tele_restrict, RLOC_MSG } = await import('./teleport.js');
                if (!(await tele_restrict(mtmp)) && await rloc(mtmp, RLOC_MSG))
                    return 0;
            }
            const { mon_kill_leaving } = await import('./monmove.js');
            if (((ptr?.mresists ?? 0) & MR_FIRE_BIT) === 0) {
                if (cansee(mtmp.mx, mtmp.my))
                    await pline(`${Monnam(mtmp)} burns to a crisp.`);
                // C: svc.context.mon_moving is set for every minliquid() call
                // reached from movemon, so this is mondead() — no corpse, and
                // no corpse_chance roll.
                mon_kill_leaving(mtmp, true);
                return 1;
            }
            // Fire-resistant but not a lava-liker: 1 point of damage, then it
            // is teleported clear of the lava (rloc draws).
            mtmp.mhp -= 1;
            if (mtmp.mhp <= 0) {
                if (cansee(mtmp.mx, mtmp.my))
                    await pline(`${Monnam(mtmp)} surrenders to the fire.`);
                mon_kill_leaving(mtmp, true);
                return 1;
            }
            if (cansee(mtmp.mx, mtmp.my))
                await pline(`${Monnam(mtmp)} burns slightly.`);
            if (!(is_flyer_m(ptr) || mtmp.mlevitating)) {
                // fire_damage_chain(minvent) is deferred (no monster here
                // carries burnable gear at a lava square); the rloc is not.
                const { rloc, RLOC_MSG } = await import('./teleport.js');
                await rloc(mtmp, RLOC_MSG);
            }
            return 0;
        }
    }
    if (inpool || waterwall)
        return 0; /* deferred: see the drown arm above */

    // C ref: mon.c:1108 — out of liquid entirely; only eels care.
    if (ptr?.mcls === S_EEL_MCLS && !Is_waterlevel(game.u?.uz)
        && !breathless(ptr)) {
        // C: "as mhp gets lower, the rate of further loss slows down".
        if (mtmp.mhp > 1 && rn2(mtmp.mhp) > rn2(8))
            mtmp.mhp--;
        await monflee(mtmp, 2, false, false);
    }
    return 0;
}

async function m_calcdistress(mtmp) {
    // C ref: mon.c:1183-1189 — a sessile species (data->mmove == 0) is checked
    // against water/lava once per turn even though it never moves, because it
    // can be carried/teleported into liquid.  The `if (gv.vision_full_recalc)
    // vision_recalc(0);` that precedes it is display bookkeeping and draws
    // nothing.
    if (mmove_of(mtmp.data) === 0 && await minliquid(mtmp))
        return;
    // C ref: mon.c:1193 — regenerate hit points, BEFORE the shapeshift and
    // timeout blocks.  RNG-free but state-critical: see monmove.js mon_regen.
    mon_regen(mtmp, false);
    // C ref: mon.c:1196 `if (ismnum(mtmp->cham)) decide_to_shapeshift(mtmp);`
    // — BEFORE were_change().
    if ((mtmp.cham ?? -1) >= 0) decide_to_shapeshift(mtmp);
    await were_change(mtmp);
    if (mtmp.mblinded && !--mtmp.mblinded) mtmp.mcansee = 1;
    if (mtmp.mfrozen && !--mtmp.mfrozen) mtmp.mcanmove = 1;
    if (mtmp.mfleetim && !--mtmp.mfleetim) mtmp.mflee = 0;
}

// C ref: mon.c mcalcdistress(void) — iterates fmon (newest-first).
export async function mcalcdistress() {
    for (const mtmp of fmonOrder()) {
        if (DEADMONSTER(mtmp)) continue;
        await m_calcdistress(mtmp);
    }
}

// C ref: mondata.h:38 is_hider(ptr) = (mflags1 & M1_HIDE).  monflags_data.js
// carries the real mflags1 column, so read the bit instead of the hand-listed
// pmidx set this replaces — that list named exactly today's eight M1_HIDE
// species, so it happened to be right, but it answers FALSE for any hider the
// tables gain and it is keyed on an index convention only makemon.js owns.
function is_hider(ptr) {
    return ptr != null && (mflags1_of(ptr) & M1_HIDE) !== 0;
}

// C ref: monsym.h S_MIMIC=13 (S_PIERCER=16 / S_TRAPPER=20 are reached through
// the mflags1 bits now, not by class number).
const S_MIMIC = 13;
// C ref: mondata.h:43
//   #define ceiling_hider(ptr) \
//       (is_hider(ptr) && ((is_clinger(ptr) && (ptr)->mlet != S_MIMIC) \
//                          || is_flyer(ptr)))
// Mimics are flagged M1_CLING but have nothing to do with ceilings, hence the
// mlet exclusion; the lurker above qualifies through M1_FLY.  The previous
// `mcls === S_PIERCER || pmidx === 98` shortcut agreed with this on the current
// table but was a hardcode of the answer rather than the test.
function ceiling_hider(ptr) {
    if (!is_hider(ptr)) return false;
    const f1 = mflags1_of(ptr);
    return (((f1 & M1_CLING) !== 0) && ptr?.mcls !== S_MIMIC)
        || ((f1 & M1_FLY) !== 0);
}

export function sensemon(mtmp) {
    if (!mtmp) return false;
    const u = game.u, p = u?.uprops || {};
    if (u?.uswallow && mtmp !== u.ustuck) return false;
    if (u?.uunderwater
        && !(mdistu(mtmp) <= 2 && IS_POOL(game.level?.at(mtmp.mx, mtmp.my)?.typ)))
        return false;
    // C ref: youprop.h Detect_monsters == (HDetect_monsters || EDetect_monsters);
    // detect.c:854 sets the EXTRINSIC half for the one-shot browse, so leaving
    // it out made every detected monster read as "it".
    return !!((p.Detect_monsters ?? 0) || (p.HDetect_monsters ?? 0)
              || (p.EDetect_monsters ?? 0))
        || tp_sensemon(mtmp);
}

// C ref: mon.c restrap(mtmp) — an unwatched hider may re-hide.  Returns true if
// the monster successfully hid (in which case movemon_singlemon skips dochug,
// so the monster does not move and its distfleeck/m_move RNG is not consumed).
// The leading short-circuit chain decides whether the rn2(3) "stays revealed"
// roll fires AT ALL — it only rolls when the hero cannot see the monster's
// square and the earlier disqualifiers are all false.
function restrap(mtmp) {
    const u = game.u;
    const t = (mtmp.mtrapped) ? t_at(mtmp.mx, mtmp.my) : null;
    if (mtmp.mcan
        || mtmp.m_ap_type            // M_AP_TYPE(mtmp): wearing an appearance
        || cansee(mtmp.mx, mtmp.my)  // hero can see the square -> stays visible
        || rn2(3)
        || mtmp === u?.ustuck
        // can't hide while trapped except in pits
        || (mtmp.mtrapped && t && !is_pit(t.ttyp))
        // can't hide on ceiling if there isn't one (always has one in dungeon)
        || (ceiling_hider(mtmp.data) && !has_ceiling())
        // won't hide when adjacent to hero and magically sensed
        || (sensemon(mtmp) && m_next2u(mtmp)))
        return false;

    if (mtmp.data?.mcls === S_MIMIC) {
        if (mtmp.msleeping || mtmp.mfrozen) return false;
        // C ref: mon.c:4682 set_mimic_sym(mtmp) — the mimic picks a disguise.
        // This was skipped with "not reached by our piercer-only sessions", but
        // it is the single biggest RNG call in restrap(): makemon.js's port of
        // it draws ROLL_FROM(syms) rn2(17), a whole mkobj() for the chosen
        // class, rn2(2)/rn2(10)/get_shop_item in a maze or a shop, and
        // rndmonnum() for a statue/corpse/egg/tin appearance.  It also SETS
        // m_ap_type, which movemon_singlemon() reads on the very next line to
        // decide whether the mimic skips its move, and which hide_monst()'s
        // second restrap() call keys off.
        set_mimic_sym(mtmp);
        return true;
    } else if (game.level?.at(mtmp.mx, mtmp.my)?.typ === ROOM) {
        mtmp.mundetected = 1;
        return true;
    }
    return false;
}

// C ref: dungeon.c:1690 has_ceiling(lev) —
//   `if (In_endgame(lev) && !Is_earthlevel(lev)) return FALSE; return TRUE;`
// i.e. false on the Plane of Air/Fire/Water/Astral, true on the Plane of Earth
// and everywhere in the dungeon.  dungeon.js does not model the endgame branch
// (dungeon.js:815) so dnum can't identify those levels yet; the C test is
// spelled out here so the day it can, this is a one-line change instead of a
// rediscovery.  (Reached only through ceiling_hider(), i.e. a piercer or lurker
// above on an endgame plane.)
function has_ceiling() {
    return true;
}

// C ref: monsym.h S_EEL=57.
const S_EEL_MCLS = 57;

// C ref: mon.c:4806 hide_monst(mon) — give a hider a chance to hide before its
// next move.  Called from restore.c getlev() when the hero returns to a level
// that was left, and from a couple of monster-placement paths.  A monster
// already hidden (mundetected) or wearing an appearance is skipped.  is_hider
// species (mimics, piercers, lurker above, trapper) re-hide via restrap()
// (which rolls rn2(3) internally); M1_CONCEAL species and eels re-hide via
// hideunder() (no RNG).
//
// The viz_array bracket is NOT display-only, which is why it is modelled now:
//
//     char save_viz = gv.viz_array[y][x];
//     gv.viz_array[y][x] &= ~(IN_SIGHT | COULD_SEE);
//     ... restrap(mon) ...
//     gv.viz_array[y][x] = save_viz;
//
// restrap()'s short-circuit chain tests `cansee(mtmp->mx, mtmp->my)` BEFORE its
// rn2(3), and cansee() is exactly `viz_array[y][x] & IN_SIGHT`.  Clearing the
// bit forces that test false, so C ALWAYS reaches the rn2(3) here (twice for a
// mimic).  Leaving the override out made a hider standing on a lit, in-sight
// square bail out of restrap() with no draw at all — a silently missing rn2 in
// the level-arrival stream, and one that also decides whether the monster is
// hidden when the hero first sees the level.
const VIZ_IN_SIGHT = 0x2, VIZ_COULD_SEE = 0x1;
export async function hide_monst(mon) {
    const hider_under = hides_under_pm(mon.data) || mon.data?.mcls === S_EEL_MCLS;
    if ((is_hider(mon.data) || hider_under)
        && !(mon.mundetected || mon.m_ap_type)) {
        const x = mon.mx, y = mon.my;
        const row = game.viz_array?.[y];
        const save_viz = row ? row[x] : undefined;
        if (row) row[x] &= ~(VIZ_IN_SIGHT | VIZ_COULD_SEE);
        if (is_hider(mon.data))
            restrap(mon);
        // try again if a mimic missed its 1/3 chance to hide
        if (mon.data?.mcls === S_MIMIC && !mon.m_ap_type)
            restrap(mon);
        if (row) row[x] = save_viz;
        if (hider_under)
            await hideunder(mon);
    }
}

// ---------------------------------------------------------------------------
// C ref: worn.c:756 m_dowear() / worn.c:799 m_dowear_type() — monster armour.
// Was entirely unported, which is not cosmetic: worn.c:956 charges a monster
// `mfrozen = m_delay` turns for putting a piece on, and movemon_singlemon()
// returns before dochug() while that runs, so C spends whole monster turns
// with ZERO RNG draws that this port used to spend moving and attacking.
//
// Creation-time equipment is initialized synchronously by worn.js from
// makemon.js, after m_initinv().  This movement-loop implementation retains
// the !creation path, where wear delays and messages must remain in turn order.
// Combat paths use worn.js's shared find_mac(), so the object masks set here
// affect every monster to-hit calculation.

// C ref: include/objects.h ARMOR()/HELM()/CLOAK()/SHIELD()/GLOVES()/BOOTS() —
// [otyp, a_ac, oc_delay] for the whole armour otyp range 89..172 in
// js/mkobj.js order.  a_ac is the macro's `10 - ac` field (so plate mail's
// `ac 3` is a_ac 7); ARM_BONUS (hack.h:1526) and worn.c's m_delay read exactly
// these two columns and OBJECT_DATA carries neither.  js/invent.js's
// ARMOR_OC_DELAY is the hero-side delay subset (it has no entry for the
// dragon-scale suits 101..120), so it is not reused.
const ARMOR_AC_DELAY = new Map([
    [89,1,1], [90,1,1], [91,2,1], [92,0,0], [93,0,1], [94,0,1], [95,1,0], [96,1,1],
    [97,1,1], [98,1,1], [99,1,1], [100,1,1], [101,9,5], [102,9,5], [103,9,5], [104,9,5],
    [105,9,5], [106,9,5], [107,9,5], [108,9,5], [109,9,5], [110,9,5], [111,3,5], [112,3,5],
    [113,3,5], [114,3,5], [115,3,5], [116,3,5], [117,3,5], [118,3,5], [119,3,5], [120,3,5],
    [121,7,5], [122,7,5], [123,6,5], [124,6,5], [125,6,5], [126,6,1], [127,5,1], [128,5,5],
    [129,4,5], [130,4,5], [131,3,3], [132,3,5], [133,2,5], [134,2,3], [135,1,0], [136,0,0],
    [137,0,0], [138,0,0], [139,1,0], [140,0,0], [141,0,0], [142,1,0], [143,2,0], [144,1,0],
    [145,1,0], [146,3,0], [147,1,0], [148,1,0], [149,1,0], [150,1,0], [151,1,0], [152,1,0],
    [153,2,0], [154,1,0], [155,1,0], [156,2,0], [157,2,0], [158,2,0], [159,1,1], [160,1,1],
    [161,1,1], [162,1,1], [163,1,2], [164,2,2], [165,2,2], [166,1,2], [167,1,2], [168,1,2],
    [169,1,2], [170,1,2], [171,1,2], [172,1,2],
].map((r) => [r[0], r]));

// C ref: objects.h oc_armcat — the ARM_* slot of an armour otyp.  Each slot is
// one contiguous otyp run in objects.h, so the ranges ARE the column.  (Do NOT
// route this through js/invent.js:3206 armor_slot_mask(): that one is a subset
// table whose `default:` sends every cloak but three, and every shield but
// one, to the body-suit slot.)
//
// prop.h W_AMUL and the js/mkobj.js otyps / js/makemon.js pmidx values the
// worn.c predicates name.  (js/invent.js remaps its own W_* block, so the
// monster masks all come from js/const.js — see the imports above.)
const W_AMUL_MON = 0x00010000;
// C stores a monster's worn state on obj->owornmask.  Inventory-removal paths
// clear that state before an object reaches the floor, so armour, combat, and
// pet-dropping code all observe the same source of truth.
const WORNF = 'owornmask';
const AMULET_CLASS_M = 5;
const SPEED_BOOTS_OTYP = 166, MUMMY_WRAPPING_OTYP = 138, DUNCE_CAP_OTYP = 94,
    HELM_OF_OPPOSITE_ALIGNMENT_OTYP = 99, RUBBER_HOSE_OTYP = 78,
    AMULET_OF_LIFE_SAVING_OTYP = 202, AMULET_OF_REFLECTION_OTYP = 208,
    AMULET_OF_GUARDING_OTYP = 210,
    ELVEN_LEATHER_HELM = 89, ELVEN_MITHRIL_COAT = 127, ELVEN_CLOAK = 139,
    ELVEN_SHIELD = 153, ELVEN_BOOTS = 169;
// C ref: permonst.h MZ_* / monsym.h S_* / objclass.h material enum.
const MZ_SMALL_M = 1, MZ_HUMAN_M = 2, MZ_LARGE_M = 3, MZ_HUGE_M = 4;
const S_VORTEX_M = 22, S_CENTAUR_M = 29, S_MUMMY_M = 39, S_GHOST_M = 54;
const LEATHER_MATERIAL = 7;
const PM_WINGED_GARGOYLE = 42, PM_HOBBIT = 43, PM_WHITE_UNICORN = 101,
    PM_GRAY_UNICORN = 102, PM_BLACK_UNICORN = 103, PM_KI_RIN = 124,
    PM_AIR_ELEMENTAL = 154, PM_MINOTAUR = 177, PM_SKELETON = 248,
    PM_HORNED_DEVIL = 291, PM_MARILITH = 294, PM_BALROG = 302, PM_ASMODEUS = 309;
function armor_slot_of(otyp) {
    if (otyp >= 89 && otyp <= 100) return W_ARMH;
    if (otyp >= 101 && otyp <= 135) return W_ARM;
    if (otyp >= 136 && otyp <= 137) return W_ARMU;
    if (otyp >= 138 && otyp <= 149) return W_ARMC;
    if (otyp >= 150 && otyp <= 158) return W_ARMS;
    if (otyp >= 159 && otyp <= 162) return W_ARMG;
    if (otyp >= 163 && otyp <= 172) return W_ARMF;
    return 0;
}
function oc_delay_arm(otyp) { return ARMOR_AC_DELAY.get(otyp)?.[2] ?? 0; }
// C ref: obj.h:126 greatest_erosion(otmp).
function greatest_erosion(obj) {
    return Math.max(obj?.oeroded | 0, obj?.oeroded2 | 0);
}
// C ref: hack.h:1526 ARM_BONUS(obj).
function ARM_BONUS(obj) {
    const a_ac = ARMOR_AC_DELAY.get(obj?.otyp)?.[1] ?? 0;
    return a_ac + (obj?.spe | 0) - Math.min(greatest_erosion(obj), a_ac);
}
// C ref: worn.c:1339 extra_pref(mon, obj) — the only special-benefit bias.
// mtmp->permspeed is not persisted by this port's makemon; every monster that
// could pick speed boots up off the floor here is a non-MFAST species, which
// is the branch C takes for them too.
function extra_pref(mon, obj) {
    return (obj && obj.otyp === SPEED_BOOTS_OTYP && (mon?.permspeed | 0) !== MFAST) ? 20 : 0;
}
// C ref: worn.c:1360 racial_exception(mon, obj) — hobbits may wear elven armour.
function racial_exception(mon, obj) {
    return (monsndx_mon(mon) === PM_HOBBIT && is_elven_armor(obj)) ? 1 : 0;
}
function is_elven_armor(obj) {
    const o = obj?.otyp;
    return o === ELVEN_LEATHER_HELM || o === ELVEN_MITHRIL_COAT || o === ELVEN_CLOAK
        || o === ELVEN_SHIELD || o === ELVEN_BOOTS;
}
// C ref: worn.c which_armor(mon, slot).
function which_armor_mon(mon, slot) {
    for (const o of (mon?.minvent || []))
        if (((o[WORNF] || 0) & slot) !== 0) return o;
    return null;
}
// C ref: mondata.c:632 sliparm / :640 breakarm / mondata.h:133 cantweararm.
function sliparm_mon(ptr) {
    return is_whirly_mon(ptr) || (ptr?.msize ?? 0) <= MZ_SMALL_M || noncorporeal_mon(ptr);
}
function cantweararm_mon(ptr) {
    if (sliparm_mon(ptr)) return true;                       // breakarm's guard
    return (ptr?.msize ?? 0) >= MZ_LARGE_M
        || ((ptr?.msize ?? 0) > MZ_SMALL_M && !humanoid(ptr))
        || ptr?.pmidx === PM_MARILITH || ptr?.pmidx === PM_WINGED_GARGOYLE;
}
function is_whirly_mon(ptr) {
    return ptr?.mcls === S_VORTEX_M || ptr?.pmidx === PM_AIR_ELEMENTAL;
}
function noncorporeal_mon(ptr) { return ptr?.mcls === S_GHOST_M; }
// C ref: obj.h:444 WrappingAllowed(mptr).
function WrappingAllowed(ptr) {
    const sz = ptr?.msize ?? 0;
    return humanoid(ptr) && sz >= MZ_SMALL_M && sz <= MZ_HUGE_M
        && !noncorporeal_mon(ptr) && ptr?.mcls !== S_CENTAUR_M
        && ptr?.pmidx !== PM_WINGED_GARGOYLE && ptr?.pmidx !== PM_MARILITH;
}
// C ref: mondata.c:678 num_horns(ptr) / mondata.h:56 has_horns(ptr).
const HORNED_PMIDX = new Set([PM_HORNED_DEVIL, PM_MINOTAUR, PM_ASMODEUS, PM_BALROG,
    PM_WHITE_UNICORN, PM_GRAY_UNICORN, PM_BLACK_UNICORN, PM_KI_RIN]);
function has_horns(ptr) { return HORNED_PMIDX.has(ptr?.pmidx); }
// C ref: obj.h:418 is_flimsy(otmp) — oc_material <= LEATHER (objclass.h:20)
// or a rubber hose.
function is_flimsy(obj) {
    return (OBJECTS[obj?.otyp]?.material ?? 99) <= LEATHER_MATERIAL
        || obj?.otyp === RUBBER_HOSE_OTYP;
}
function monsndx_mon(mon) { return mon?.data?.pmidx ?? -1; }
function slithy_mon(ptr) { return (mflags1_of(ptr) & M1_SLITHY) !== 0; }
// C ref: youprop.h See_invisible.  js/display.js:335 has the shared reader but
// does not export it; this port spells the hero's copy several ways.
function See_invisible_mon() {
    const u = game.u || {}, p = u.uprops || {};
    return !!(u.see_invis || p.HSee_invisible || u.HSee_invisible
        || p.ESee_invisible || u.ESee_invisible || p.See_invisible || u.See_invisible);
}

// C ref: worn.c:799 m_dowear_type(mon, flag, creation, racialexception).
// Draws no CORE rng anywhere along this path (nor does curse()).
//
// NOT ported, and it is NOT free: C's worn.c:532 opens with
//   Strcpy(nambuf, See_invisible ? Monnam(mon) : mon_nam(mon));
// unconditionally on all eight m_dowear() calls.  While the hero hallucinates
// each of those names is an x_monnam() -> rndmonnam() pick off the DISPLAY rng
// (2-3 draws each), so C advances that stream 15 times in the turn a monster
// sorts its armour (seed0383 step 199 measured against the recorder's
// NETHACK_RNGLOG_DISP log).  Adding the call here measured WORSE (-1 screen,
// frontier 199 -> 196) because this port ALSO runs m_dowear() on a turn C does
// not: at seed0383 step 196 we spend 8 names where C spends none, and at 199 we
// spend 13 where C spends 15.  Fix the firing turn (I_SPECIAL / mfrozen state)
// FIRST, then add the snapshot; see RECON_NOTES.md.
async function m_dowear_type(mon, flag, creation, racialexception) {
    if (mon.mfrozen)
        return;                            /* probably putting previous item on */
    const sawmon = canseemon_shared(mon);
    let old = which_armor_mon(mon, flag);
    if (old && old.cursed) return;
    if (old && flag === W_AMUL_MON && old.otyp !== AMULET_OF_GUARDING_OTYP) return;
    let best = old;

    for (const obj of (mon.minvent || [])) {
        if (flag === W_AMUL_MON) {
            if (obj.oclass !== AMULET_CLASS_M
                || (obj.otyp !== AMULET_OF_LIFE_SAVING_OTYP
                    && obj.otyp !== AMULET_OF_REFLECTION_OTYP
                    && obj.otyp !== AMULET_OF_GUARDING_OTYP))
                continue;
            if (!best || obj.otyp !== AMULET_OF_GUARDING_OTYP) {
                best = obj;
                if (best.otyp !== AMULET_OF_GUARDING_OTYP) break;  // C goto outer_break
            }
            continue;                      /* skip post-switch armor handling */
        }
        if (armor_slot_of(obj.otyp) !== flag) continue;
        if (flag === W_ARMC) {
            // mummy wrapping is the only cloak allowed above human size, and a
            // monster that is already invisible won't put one on (it blocks
            // invisibility and would reveal it).
            if ((mon.data?.msize ?? 0) > MZ_HUMAN_M && obj.otyp !== MUMMY_WRAPPING_OTYP)
                continue;
            if (mon.minvis && obj.otyp === MUMMY_WRAPPING_OTYP
                && !See_invisible_mon() && !creation)
                continue;
        } else if (flag === W_ARMH) {
            if (obj.otyp === HELM_OF_OPPOSITE_ALIGNMENT_OTYP
                && (mon.ispriest || mon.isminion)) continue;
            if (has_horns(mon.data) && !is_flimsy(obj)) continue;
        } else if (flag === W_ARM) {
            if (racialexception && racial_exception(mon, obj) < 1) continue;
        }
        if (obj[WORNF]) continue;
        if (best && (ARM_BONUS(best) + extra_pref(mon, best)
                     >= ARM_BONUS(obj) + extra_pref(mon, obj)))
            continue;
        best = obj;
    }
    if (!best || best === old) return;

    // C ref: worn.c:906 — same auto-cursing behaviour as for the hero.
    const autocurse = ((best.otyp === HELM_OF_OPPOSITE_ALIGNMENT_OTYP
                        || best.otyp === DUNCE_CAP_OTYP) && !best.cursed);
    let m_delay = 0;
    // wearing a cloak costs 2 extra turns to get a suit or shirt on under it
    if ((flag === W_ARM || flag === W_ARMU) && ((mon.misc_worn_check | 0) & W_ARMC))
        m_delay += 2;
    if (old) {
        m_delay += oc_delay_arm(old.otyp);
        old[WORNF] = 0;                 /* avoid doname() "(being worn)" */
    }
    if (!creation) {
        if (sawmon) {
            // C ref: worn.c:924-947 — "<Mon> [removes <old> and ]puts on <new>."
            const { distant_doname, distant_far } = await import('./invent.js');
            let newarm = distant_doname(best, distant_far(best, mon.mx, mon.my)), buf = '';
            if (old) {
                const oldarm = distant_doname(old, distant_far(old, mon.mx, mon.my));
                buf = ` removes ${oldarm} and`;
                // identical descriptions read "another <armour>", not "a <armour>"
                if (newarm.toLowerCase() === oldarm.toLowerCase())
                    newarm = newarm.replace(/^an? /i, 'another ');
            }
            await update_topl(`${Monnam(mon)}${buf} puts on ${newarm}.`);
            if (autocurse)
                await pline(`${Monnam(mon)}'s ${OBJECTS[best.otyp]?.name
                             || 'armor'} glows black for a moment.`);
        }
        m_delay += oc_delay_arm(best.otyp);
        mon.mfrozen = m_delay;
        if (mon.mfrozen) mon.mcanmove = 0;
    }
    if (old) old[WORNF] = 0;
    mon.misc_worn_check = (mon.misc_worn_check | 0) | flag;
    best[WORNF] = (best[WORNF] | 0) | flag;
    if (autocurse) { best.cursed = 1; best.blessed = 0; }  // C ref: mkobj.c curse()
    // C ref: worn.c:964/977 update_mon_extrinsics(mon, old|best, ..) `case FAST`.
    await mon_adjust_speed_worn(mon, creation);
}

// C ref: worn.c:488 mon_adjust_speed(mon, 0, obj) — adjust==0 does nothing but
// recompute mspeed from the monster's WORN items, and speed boots are the only
// armour whose oc_oprop is FAST.  This is the one arm of update_mon_extrinsics
// that changes the RNG stream rather than just the monster's resistances:
// mspeed == MFAST turns mcalcmove_base()'s allotment from mmove into
// (4*mmove+2)/3, so a booted monster reaches NORMAL_SPEED — and draws its
// distfleeck/m_move rolls — on turns a barefoot one does not.
// mon->permspeed is not persisted by this port's makemon (no monster here is
// intrinsically fast or slow), so the else arm reproduces `mspeed = permspeed`.
async function mon_adjust_speed_worn(mon, creation) {
    const oldspeed = mon.mspeed | 0;
    let boots = null;
    for (const o of (mon.minvent || []))
        if ((o[WORNF] | 0) !== 0 && o.otyp === SPEED_BOOTS_OTYP) { boots = o; break; }
    mon.mspeed = boots ? MFAST : (mon.permspeed | 0);
    // give_msg = !gi.in_mklev: the creation-time pass is C's in_mklev one.
    if (creation || (mon.mspeed | 0) === oldspeed) return;
    if (!mmove_of(mon.data) || mon.mfrozen || mon.msleeping) return;
    if (!canseemon_shared(mon)) return;
    const howmuch = ((mon.mspeed | 0) + oldspeed === MFAST + MSLOW) ? 'much ' : '';
    await pline((mon.mspeed | 0) === MFAST
        ? `${Monnam(mon)} is suddenly moving ${howmuch}faster.`
        : `${Monnam(mon)} seems to be moving ${howmuch}slower.`);
}

// C ref: worn.c:756 m_dowear(mon, creation) — wear the best object of each
// slot.  Slot order is load-bearing: m_dowear_type() returns immediately once
// mon->mfrozen is set, so only the FIRST slot that upgrades charges a delay.
export async function m_dowear(mon, creation) {
    const ptr = mon?.data;
    if (!ptr) return;
    if ((ptr.msize ?? 0) < MZ_SMALL_M || nohands(ptr) || is_animal(ptr)) return;
    // mummies get a chance to wear their wrappings; skeletons their armour
    if (mindless(ptr)
        && (!creation || (ptr.mcls !== S_MUMMY_M && ptr.pmidx !== PM_SKELETON)))
        return;

    await m_dowear_type(mon, W_AMUL_MON, creation, false);
    const can_wear_armor = !cantweararm_mon(ptr);       /* suit, cloak, shirt */
    if (can_wear_armor && !((mon.misc_worn_check | 0) & W_ARM))
        await m_dowear_type(mon, W_ARMU, creation, false);
    if (can_wear_armor || WrappingAllowed(ptr))
        await m_dowear_type(mon, W_ARMC, creation, false);
    await m_dowear_type(mon, W_ARMH, creation, false);
    const wep = mon.mw || null;
    if (!wep || !OBJECTS[wep.otyp]?.bimanual)
        await m_dowear_type(mon, W_ARMS, creation, false);
    await m_dowear_type(mon, W_ARMG, creation, false);
    if (!slithy_mon(ptr) && ptr.mcls !== S_CENTAUR_M)
        await m_dowear_type(mon, W_ARMF, creation, false);
    // C ref: worn.c:793 — RACE_EXCEPTION for monsters that can't wear suits
    await m_dowear_type(mon, W_ARM, creation, !can_wear_armor);
}

// C ref: worn.c:1163 m_lose_armor(mon, obj, polyspot) —
// extract_from_minvent + place_object + newsym.  No RNG.
function m_lose_armor(mon, obj) {
    const inv = mon.minvent || [];
    const ix = inv.indexOf(obj);
    if (ix >= 0) inv.splice(ix, 1);
    mon.misc_worn_check = (mon.misc_worn_check | 0) & ~(obj[WORNF] | 0);
    obj[WORNF] = 0;
    obj.owornmask = 0;
    place_object(obj, mon.mx, mon.my);
    newsym(mon.mx, mon.my);
}
// C ref: mon.c m_useup(mon, obj) — the armour is destroyed outright.
function m_useup_armor(mon, obj) {
    const inv = mon.minvent || [];
    const ix = inv.indexOf(obj);
    if (ix >= 0) inv.splice(ix, 1);
    mon.misc_worn_check = (mon.misc_worn_check | 0) & ~(obj[WORNF] | 0);
    obj[WORNF] = 0;
}
// C ref: objnam.c cloak_simple_name(cloak).
function cloak_simple_name_mon(obj) {
    if (obj?.otyp === MUMMY_WRAPPING_OTYP) return 'wrapping';
    if (obj?.otyp === 143 /* ROBE */) return 'robe';
    if (obj?.otyp === 144 /* ALCHEMY_SMOCK */) return 'apron';
    return 'cloak';
}
function s_suffix_mon(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }
function mhis_mon(mon) { return mon?.female ? 'her' : 'his'; }
function mhim_mon(mon) { return mon?.female ? 'her' : 'him'; }

// C ref: worn.c:1177 mon_break_armor(mon, polyspot) — a monster whose FORM just
// changed (new_were, newcham, polymorph) sheds or bursts the armour that no
// longer fits.  Draws no RNG, but the "You hear a thud." / "a cracking sound."
// lines are top-line output and the dropped object lands on the floor.
// NOT ported: the W_SADDLE / u.usteed arm at worn.c:1312 (this port keeps the
// saddle's mask in obj.owornmask via js/dog.js:304, not in the monster-worn
// field, and the dismount path lives in js/steed.js).
export async function mon_break_armor(mon, polyspot) {
    const mdat = mon?.data;
    if (!mdat) return;
    const vis = cansee(mon.mx, mon.my);
    const handless_or_tiny = nohands(mdat) || (mdat.msize ?? 0) < MZ_SMALL_M;
    const ppronoun = mhis_mon(mon), pronoun = mhim_mon(mon);
    const hear = async (what) => { if (!Deaf()) await update_topl(`You hear ${what}`); };
    let otmp;
    if (!sliparm_mon(mdat) && cantweararm_mon(mdat)) {   /* C: breakarm(mdat) */
        if ((otmp = which_armor_mon(mon, W_ARM)) != null) {
            // (the dragon-scales-merging special case has no message either way)
            if (vis) await update_topl(`${Monnam(mon)} breaks out of ${ppronoun} armor!`);
            else await hear('a cracking sound.');
            m_useup_armor(mon, otmp);
        }
        if ((otmp = which_armor_mon(mon, W_ARMC)) != null
            && (otmp.otyp !== MUMMY_WRAPPING_OTYP || !WrappingAllowed(mdat))) {
            if (vis) await update_topl(`${s_suffix_mon(Monnam(mon))} ${cloak_simple_name_mon(otmp)} tears apart!`);
            else await hear('a ripping sound.');
            m_useup_armor(mon, otmp);
        }
        if ((otmp = which_armor_mon(mon, W_ARMU)) != null) {
            if (vis) await update_topl(`${s_suffix_mon(Monnam(mon))} shirt rips to shreds!`);
            else await hear('a ripping sound.');
            m_useup_armor(mon, otmp);
        }
    } else if (sliparm_mon(mdat)) {
        const passes_thru_clothes = !((mdat.msize ?? 0) <= MZ_SMALL_M);
        if ((otmp = which_armor_mon(mon, W_ARM)) != null) {
            if (vis) await update_topl(`${s_suffix_mon(Monnam(mon))} armor falls around ${pronoun}!`);
            else await hear('a thud.');
            m_lose_armor(mon, otmp, polyspot);
        }
        if ((otmp = which_armor_mon(mon, W_ARMC)) != null
            && (otmp.otyp !== MUMMY_WRAPPING_OTYP || !WrappingAllowed(mdat))) {
            if (vis)
                await update_topl(is_whirly_mon(mdat)
                    ? `${s_suffix_mon(Monnam(mon))} ${cloak_simple_name_mon(otmp)} falls, unsupported!`
                    : `${Monnam(mon)} shrinks out of ${ppronoun} ${cloak_simple_name_mon(otmp)}!`);
            m_lose_armor(mon, otmp, polyspot);
        }
        if ((otmp = which_armor_mon(mon, W_ARMU)) != null) {
            if (vis)
                await update_topl(passes_thru_clothes
                    ? `${Monnam(mon)} seeps right through ${ppronoun} shirt!`
                    : `${Monnam(mon)} becomes much too small for ${ppronoun} shirt!`);
            m_lose_armor(mon, otmp, polyspot);
        }
    }
    if (handless_or_tiny) {
        if ((otmp = which_armor_mon(mon, W_ARMG)) != null) {
            if (vis) await update_topl(`${Monnam(mon)} drops ${ppronoun} gloves${mon.mw ? ' and weapon' : ''}!`);
            m_lose_armor(mon, otmp, polyspot);
        }
        if ((otmp = which_armor_mon(mon, W_ARMS)) != null) {
            if (vis) await update_topl(`${Monnam(mon)} can no longer hold ${ppronoun} shield!`);
            else await hear('a clank.');
            m_lose_armor(mon, otmp, polyspot);
        }
    }
    if (handless_or_tiny || has_horns(mdat)) {
        if ((otmp = which_armor_mon(mon, W_ARMH)) != null
            && (handless_or_tiny || !is_flimsy(otmp))) {
            if (vis) await update_topl(`${s_suffix_mon(Monnam(mon))} helmet falls to the ${surface_mon(mon)}!`);
            else await hear('a clank.');
            m_lose_armor(mon, otmp, polyspot);
        }
    }
    if (handless_or_tiny || slithy_mon(mdat) || mdat.mcls === S_CENTAUR_M) {
        if ((otmp = which_armor_mon(mon, W_ARMF)) != null) {
            if (vis)
                await update_topl(is_whirly_mon(mdat)
                    ? `${s_suffix_mon(Monnam(mon))} boots fall away!`
                    : `${s_suffix_mon(Monnam(mon))} boots ${(mdat.msize ?? 0) < MZ_SMALL_M
                        ? 'slide' : 'are pushed'} off ${ppronoun} feet!`);
            m_lose_armor(mon, otmp, polyspot);
        }
    }
}
// C ref: hack.c surface(x, y) — only the message-bearing cases a monster can
// stand on while shedding a helmet are reachable here.
function surface_mon(mon) {
    const typ = game.level?.at?.(mon.mx, mon.my)?.typ;
    if (typ === WATER || IS_POOL(typ)) return 'water';
    if (IS_LAVA(typ)) return 'lava';
    return 'floor';
}

// C ref: mon.c movemon_singlemon(mtmp) — drive one monster's move, returning
// true if it still has movement points left after this action.
async function movemon_singlemon(mtmp) {
    // C ref: mon.c:1233 — one DEAD monster still gets a move: a vault guard
    // parked at <0,0> whose temporary corridor is still on the map.  gd_move()
    // is what tears that corridor down and finally clears isgd.  This test
    // precedes both the DEADMONSTER() and the off-map returns below.
    if (mtmp.isgd && !mtmp.mx && !(mtmp.mstate & MON_MIGRATING)) {
        if ((game.moves || 0) > (mtmp.mlstmv || 0)) {
            await (await import('./vault.js')).gd_move(mtmp);
            mtmp.mlstmv = game.moves || 0;
        }
        return false;
    }
    if (DEADMONSTER(mtmp)) return false;
    if (mtmp.mx == null || mtmp.mx <= 0) return false; // off-map

    // C ref: mon.c:1248 — m_everyturn_effect() runs BEFORE the movement-point
    // gate, so a fog cloud trails vapor every turn even on turns it is too slow
    // to act (and rolls that cloud's rn1(3,4) lifespan).
    await m_everyturn_effect(mtmp);

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

    // C ref: mon.c:1254 — `if (minliquid(mtmp)) return FALSE;`, run for every
    // monster on every move (see minliquid() above for what is and isn't
    // ported).  The `if (gv.vision_full_recalc) vision_recalc(0);` and the
    // clear_bypasses()/clear_splitobjs() that sit between the movement
    // deduction and this call are obj-flag/display bookkeeping and draw nothing.
    if (await minliquid(mtmp)) return false;

    // C ref: mon.c:1269-1284 — after gaining or losing equipment a monster
    // re-runs m_dowear() and SPENDS THE WHOLE TURN doing so (returns FALSE
    // before dochugw, so it draws nothing at all that turn).  Hostiles that
    // believe the hero is within dist2 <= 9 keep the bit set for later instead.
    if (((mtmp.misc_worn_check | 0) & I_SPECIAL) !== 0) {
        if (mtmp.mpeaceful || mtmp.mtame
            || dist2(mtmp.mx, mtmp.my, mtmp.mux | 0, mtmp.muy | 0) > (3 * 3)) {
            mtmp.misc_worn_check = (mtmp.misc_worn_check | 0) & ~I_SPECIAL;
            const oldworn = mtmp.misc_worn_check | 0;
            await m_dowear(mtmp, false);
            if ((mtmp.misc_worn_check | 0) !== oldworn || !mtmp.mcanmove)
                return false;              /* is spending this turn equipping */
        }
    }

    //
    // C ref: mon.c:1300-1313 — the Conflict branch (fightm()).  Nothing in this
    // port grants Conflict, so m_canseeu/fightm is unreachable; fightm() would
    // draw (it picks a victim and runs a full mattackm).

    // C ref: mon.c movemon_singlemon() — hiding monsters (mimics, piercers,
    // lurker above / trapper; M1_HIDE) get a chance to re-hide BEFORE dochug.
    // If restrap() succeeds the monster hides and skips its move entirely.
    if (is_hider(mtmp.data)) {
        // unwatched mimics and piercers may hide again
        if (restrap(mtmp)) return false;
        // C ref: mon.c:1287-1290 — a hider still wearing a FURNITURE/OBJECT
        // appearance (a mimic disguised as an object/furniture it never gave
        // up) skips its move ENTIRELY: it neither moves nor attacks while
        // camouflaged.  This must be checked BEFORE the mundetected gate.
        // (seed5002 step-190: a small mimic disguised as a `(` was attacking
        // the hero in JS — `The small mimic bites!` — while C left it inert.)
        if (mtmp.m_ap_type === 'furniture' || mtmp.m_ap_type === 'obj')
            return false;
        if (mtmp.mundetected) return false;
    } else if (mtmp.data?.mcls === S_EEL_MCLS && !mtmp.mundetected
               && (mtmp.mflee || !m_next2u(mtmp))
               && !canseemon_mon(mtmp) && !rn2(4)) {
        // C ref: mon.c:1291-1298 — the `else if` arm of the is_hider test.
        // "some eels end up stuck in isolated pools, where they can't--or at
        // least won't--move, so they never reach their post-move chance to
        // re-hide".  The rn2(4) is unconditional once the three RNG-free guards
        // pass, so every unwatched, non-adjacent eel costs a draw per turn for
        // as long as it is alive — the same shape of omission that desynced
        // every session with a lycanthrope before were_change() was ported.
        if (await hideunder(mtmp))
            return false;
    }

    // C ref: mon.c:1305-1319 — Conflict: the monster may fight another monster.
    if (Conflict() && !mtmp.iswiz && m_canseeu(mtmp)) {
        if (cansee(mtmp.mx, mtmp.my)
            && dist2(mtmp.mx, mtmp.my, game.u.ux, game.u.uy) <= 8 * 8
            && await fightm(mtmp))
            return false;
    }

    await dochugw(mtmp, true);
    return false;
}

// C ref: mhitm.c:106 fightm(mtmp) — conflicted monsters fight each other.
async function fightm(mtmp) {
    if (resist_conflict(mtmp)) return 0;
    // (u.ustuck / engulfing_u cases not modelled)
    for (const mon of fmonOrder()) {
        if (mon !== mtmp && !DEADMONSTER(mon)) {
            if (monnear(mtmp, mon.mx, mon.my)) {
                const result = await mattackm(mtmp, mon);
                if (result & M_ATTK_AGR_DIED) return 1;
                if ((result & (M_ATTK_HIT | M_ATTK_DEF_DIED)) === M_ATTK_HIT
                    && rn2(4) && (mon.movement | 0) > rn2(NORMAL_SPEED)) {
                    if ((mon.movement | 0) > NORMAL_SPEED) mon.movement -= NORMAL_SPEED;
                    else mon.movement = 0;
                    await mattackm(mon, mtmp);
                }
                return (result & M_ATTK_HIT) ? 1 : 0;
            }
        }
    }
    return 0;
}

// C ref: mon.c movemon(void) — one pass over every monster.  Returns true if
// at least one monster still has a full NORMAL_SPEED of movement left (so the
// caller's inner loop should run another pass).
async function movemon_pass() {
    game._somebody_can_move = false;
    // iter_mons_safe: snapshot the list so deaths/spawns mid-iteration are safe.
    // C iterates the `fmon` chain, into which makemon prepends each new
    // monster (makemon.c:1249 `mtmp->nmon = fmon; fmon = mtmp;`).  fmon is
    // therefore in reverse-creation order — newest monster first.  Our level
    // stores monsters in creation order, so iterate the snapshot reversed to
    // reproduce C's per-monster RNG ordering.
    const snapshot = fmonOrder();
    for (const mtmp of snapshot) {
        // C ref: mon.c movemon()/done() — when a monster's attack kills the
        // hero, C's done()->really_done() longjmps out and never returns to
        // iter_mons_safe(); the remaining monsters never move this turn.  With
        // no longjmp here, detect the death (program_state.gameover, set by
        // end.js done()) and stop the pass immediately so we don't fabricate
        // the next monster's move rolls (seed0030 step-62 death blow: C's next
        // RNG call is can_make_bones(), not another distfleeck()).
        if (game.program_state?.gameover) break;
        await movemon_singlemon(mtmp);
    }
    return !!game._somebody_can_move;
}

// C ref: mon.c:1326 movemon(void).  One pass over every monster, returning
// gs.somebody_can_move.  (The repeat passes that let a fast monster act twice
// in a turn ARE modelled — they live in the caller, allmain.js's
// `do { monscanmove = await movemon(); } while (monscanmove)`, exactly as in
// allmain.c:211-215.  An older comment here claimed they were unimplemented.)
//
// Not modelled from C's movemon(): any_light_source()/vision_full_recalc,
// clear_bypasses()/clear_splitobjs() (obj bypass flags aren't tracked),
// dmonsfree() (dead monsters stay in game.level.monsters and are skipped by
// DEADMONSTER instead of being unlinked), and the `u.utotype -> deferred_goto()`
// level-change handoff.  None of them draws; dmonsfree's absence is visible
// only to code that counts list entries.
export async function movemon() {
    return await movemon_pass();
}

/* ------------------------------------------------------------------------ *
 * mon.c — object-pickup capability.
 *
 * curr_mon_load() / max_mon_load() / can_touch_safely() / can_carry() are the
 * four mon.c predicates that decide whether a monster may take a floor object.
 * They are the load half of monmove.c's mon_would_take_item(): the `pctload`
 * that gates every branch of that function is curr_mon_load*100/max_mon_load,
 * and m_search_items() only redirects a monster's goal toward loot when
 * can_carry() comes back positive.  Getting them wrong therefore moves
 * monsters, not just inventories.
 * ------------------------------------------------------------------------ */

// C ref: objclass.h obj_material_types.  mkobj.js keeps these private, so the
// three bands mon.c's pickup rules consult are restated here.
const SILVER = 14;
// C ref: monflag.h MZ_MEDIUM (== MZ_HUMAN).
const MZ_HUMAN = 2;
// C ref: defsym.h MONSYM() indices — the same numbering makemon.js stores in
// permonst.mcls (C's ptr->mlet).
const S_DRAGON = 30, S_NYMPH = 14;

// C ref: mondata.h notake(ptr) == (mflags1 & M1_NOTAKE).
export function notake(ptr) { return (mflags1_of(ptr) & M1_NOTAKE) !== 0; }

// C ref: mondata.h touch_petrifies(ptr) — cockatrice / chickatrice.
function touch_petrifies_pm(corpsenm) {
    const nm = monster_by_pmidx(corpsenm)?.name;
    return nm === 'cockatrice' || nm === 'chickatrice';
}
// C ref: mondata.h is_rider(ptr) — Death / Famine / Pestilence.
function is_rider_pm(corpsenm) {
    const nm = monster_by_pmidx(corpsenm)?.name;
    return nm === 'Death' || nm === 'Famine' || nm === 'Pestilence';
}
// C ref: monst.h is_vampshifter(mon) — mon->cham is a vampire form.  The same
// three pmidx monmove.js uses; kept local so mon.js does not have to reach into
// monmove.js for a two-line predicate.
const PM_VAMPIRE = 226, PM_VAMPIRE_LEADER = 227, PM_VLAD_THE_IMPALER = 228;
function is_vampshifter(mon) {
    return mon.cham === PM_VAMPIRE || mon.cham === PM_VAMPIRE_LEADER
        || mon.cham === PM_VLAD_THE_IMPALER;
}
// C ref: mondata.c:524 hates_silver(ptr).
const S_VAMPIRE = 48, S_IMP = 9;
function hates_silver(ptr) {
    if (!ptr) return false;
    if (is_were_flag(ptr)) return true;
    if (ptr.mcls === S_VAMPIRE) return true;
    if ((mflags2_of(ptr) & M2_DEMON) !== 0) return true;
    if (ptr.name === 'shade') return true;
    if (ptr.mcls === S_IMP && ptr.name !== 'tengu') return true;
    return false;
}
// C ref: mondata.c:517 mon_hates_silver(mon).
export function mon_hates_silver(mon) {
    return is_vampshifter(mon) || hates_silver(mon.data);
}
// C ref: monst.h resists_ston(mon) == Resists_Elem(mon, STONE_RES), i.e.
// (mresists | mextrinsics | mintrinsics) & MR_STONE.  Monster extrinsics from
// worn gear are not tracked on our monster record, so this reads the species
// bit only — the two acquired sources (an amulet of ... / eating a lizard) are
// not reachable for a floor-scanning monster in the recorded sessions.
const MR_STONE = 0x80;
export function resists_ston(mon) {
    return ((mon?.data?.mresists ?? 0) & MR_STONE) !== 0;
}
// C ref: artifact.c:912 touch_artifact(obj, mon).  An ordinary object is always
// safe (get_artifact returns ART_NONARTIFACT -> 1).  The MONSTER arm is not
// modelled and always returns "touchable"; C's is:
//     else if (!is_covetous(mon->data) && !is_mplayer(mon->data)) {
//         badclass = self_willed && oart->role != NON_PM
//                    && oart != &artilist[ART_EXCALIBUR];
//         badalign = (oart->spfx & SPFX_RESTR) && oart->alignment != A_NONE
//                    && (oart->alignment != mon_aligntyp(mon));
//     } else badclass = badalign = FALSE;
//     if (!badalign) badalign = bane_applies(oart, mon);
//     if (((badclass || badalign) && self_willed) || badalign) return 0;
// It draws NOTHING for a monster (the rn2(4) at artifact.c:945 is guarded by
// `badalign && (!yours || !rn2(4))`, and !yours short-circuits it), so this is
// a state omission, not an RNG one: an unaligned monster that C leaves standing
// next to Stormbringer picks it up here.  Implementing it needs the artilist
// SPFX/alignment columns (invent.js has them as a private ARTI_TOUCH_PROPS
// table), mon_aligntyp(), and bane_applies() — none reachable from mon.js yet.
function touch_artifact(_otmp, _mtmp) { return true; }

// C ref: mon.c:1960 can_touch_safely(mtmp, otmp).
export function can_touch_safely(mtmp, otmp) {
    const otyp = otmp.otyp;
    const mdat = mtmp.data;
    if (otyp === CORPSE && otmp.corpsenm != null && otmp.corpsenm >= 0
        && touch_petrifies_pm(otmp.corpsenm)
        && !((mtmp.misc_worn_check ?? 0) & W_ARMG) && !resists_ston(mtmp))
        return false;
    if (otyp === CORPSE && otmp.corpsenm != null && otmp.corpsenm >= 0
        && is_rider_pm(otmp.corpsenm))
        return false;
    if (OBJECTS[otyp]?.material === SILVER && mon_hates_silver(mtmp)
        && (otyp !== BELL_OF_OPENING || (mflags3_of(mdat) & M3_COVETOUS) === 0))
        return false;
    if (!touch_artifact(otmp, mtmp))
        return false;
    return true;
}

// C ref: mon.c:1903 curr_mon_load(mtmp) — summed owt of the monster's
// inventory, with boulders free for a rock-thrower.
export function curr_mon_load(mtmp) {
    let curload = 0;
    for (const obj of (mtmp.minvent || [])) {
        // C: `curload += obj->owt;` — the raw weight, no floor.  (mkobj.js
        // weight() already reproduces 5.0's `max(wt, 1)` for coins, so the
        // Math.max(1, ...) this replaces was a second, non-C floor applied to
        // every object.)
        if (obj.otyp !== BOULDER || !throws_rocks_flag(mtmp.data))
            curload += (obj.owt | 0);
    }
    return curload;
}

// C ref: mon.c:1917 max_mon_load(mtmp).
export function max_mon_load(mtmp) {
    const d = mtmp.data || {};
    const strong = strongmonst_flag(d);
    let maxload;
    if (!d.cwt)
        maxload = (MAX_CARR_CAP * (d.msize | 0)) / MZ_HUMAN;
    else if (!strong || (strong && d.cwt > WT_HUMAN))
        maxload = (MAX_CARR_CAP * d.cwt) / WT_HUMAN;
    else
        maxload = MAX_CARR_CAP; /* strong monsters w/cwt <= WT_HUMAN */
    // C does these in long arithmetic, so each step truncates toward zero.
    maxload = Math.trunc(maxload);
    if (!strong) maxload = Math.trunc(maxload / 2);
    if (maxload < 1) maxload = 1;
    return maxload;
}

// C ref: mon.c:1997 can_carry(mtmp, otmp) — how many of otmp mtmp could take
// off the floor (0 = none).  Note the ORDER: the NOHANDS "only one of a stack"
// rule returns BEFORE the peaceful and load-cap tests, so a handless hostile
// always manages a single item from a pile however overloaded it is.
export function can_carry(mtmp, otmp) {
    const otyp = otmp.otyp;
    const newload = (otmp.owt | 0); // C: `int newload = otmp->owt;` — no floor
    const mdat = mtmp.data;

    if (notake(mdat)) return 0;
    if (!can_touch_safely(mtmp, otmp)) return 0;

    // C ref: mon.c:2002 —
    //   iquan = (otmp->quan > (long) LARGEST_INT)
    //              ? 20000 + rn2(LARGEST_INT - 20000 + 1) : (int) otmp->quan;
    // The overflow arm DRAWS, but it needs a stack of more than 2^31-1 items;
    // nothing in this port (or in C's own object creation) makes one, so the
    // plain cast is exact and the missing rn2 is unreachable, not skipped.
    const iquan = otmp.quan || 1;

    if (iquan > 1) {
        let glomper = false;
        if (mdat?.mcls === S_DRAGON
            && (otmp.oclass === COIN_CLASS || otmp.oclass === GEM_CLASS))
            glomper = true;
        else if (attacktype(mdat, AT_ENGL))
            glomper = true;
        if ((mflags1_of(mdat) & M1_NOHANDS) !== 0 && !glomper)
            return 1;
    }

    // C ref: mon.c:2038 — steeds don't pick up stuff (to avoid shop abuse).
    // u.usteed IS a live monster pointer here (dogmove.js:553 compares it), so
    // the test is real rather than the no-op the old comment assumed.
    if (mtmp === game.u?.usteed) return 0;
    if (mtmp.isshk) return iquan; /* no limit */
    if (mtmp.mpeaceful && !mtmp.mtame) return 0;

    if (throws_rocks_flag(mdat) && otyp === BOULDER) return iquan;
    if (mdat?.mcls === S_NYMPH) return (otmp.oclass === ROCK_CLASS) ? 0 : iquan;

    if (curr_mon_load(mtmp) + newload > max_mon_load(mtmp)) return 0;

    return iquan;
}


/* ==========================================================================
 * mon.c completion — INERT BY CONSTRUCTION.
 *
 * Every function below this banner is a translation of a mon.c routine the
 * port had not reached.  NOTHING above the banner calls anything below it and
 * no other file imports any of it: monster bookkeeping is the most
 * RNG-order-sensitive part of this port, so each hookup has to be measured on
 * its own rather than arriving as a side effect of filling the file in.
 *
 * Two rules were followed throughout:
 *   * control flow, statement order and RNG order are C's, including the
 *     short-circuits that decide whether a draw happens at all (see
 *     elemental_clog's `!msgmv || rn2(2)` and peacefuls_respond's chain);
 *   * where the port's copy of a C callee is module-private or absent, the
 *     call site is NAMED in a comment instead of being approximated.  A
 *     plausible-looking substitute would make a future hookup measure a
 *     different stream than C's, which is worse than a documented hole.
 *
 * Cross-module needs use `await import()` inside the body (the pattern the
 * rest of this file already uses for teleport.js / invent.js / cmd.js /
 * vault.js) so mon.js gains no new static import edge and the program's
 * module-evaluation ORDER is untouched.
 * ========================================================================== */

// ── local spellings of C macros and of private helpers ──────────────────────

// C ref: sym.h enum mon_syms (defsym.h MONSYMS_S_ENUM) — the mons[].mcls
// numbering.  js/symbols.js exports the whole enum, but mon.js deliberately
// does not import it (a new static edge would reorder module evaluation), so
// the classes used below are restated the way the rest of this file does.
const S_DOG_C = 4, S_HUMANOID_C = 8, S_KOBOLD_C = 11, S_ORC_C = 15,
    S_UNICORN_C = 21, S_VORTEX_C = 22, S_BAT_C = 28, S_ELEMENTAL_C = 31,
    S_FUNGUS_C = 32, S_GNOME_C = 33, S_GIANT_C = 34, S_KOP_C = 37,
    S_ZOMBIE_C = 52, S_HUMAN_C = 53, S_GOLEM_C = 55;

// C ref: monst.h:52 enum M_AP_TYPE.  This port stores the appearance KIND as a
// STRING on the monster (js/makemon.js set_mimic_sym), 0 meaning "none", so
// the enum is spelled as those strings.
const MAP_NOTHING = 0, MAP_FURNITURE = 'furniture', MAP_OBJECT = 'obj',
    MAP_MONSTER = 'mon';

// C ref: monflag.h G_UNIQ (mons[].geno bit).
const G_UNIQ_M = 0x1000;
// C ref: rm.h D_NODOOR / D_TRAPPED.
const D_NODOOR_M = 0x00, D_TRAPPED_M = 0x10;
// C ref: objects.h SADDLE / CANDELABRUM_OF_INVOCATION /
// SPE_BOOK_OF_THE_DEAD / SPE_HEALING / SPE_EXTRA_HEALING (js/mkobj.js otyps).
const SADDLE_OTYP = 322, CANDELABRUM_OTYP = 217, BOOK_OF_THE_DEAD_OTYP = 228,
    SPE_HEALING_OTYP = 385, SPE_EXTRA_HEALING_OTYP = 386;
// C ref: monattk.h NATTK.  monattk_data.js exports it, but js/const.js (which
// this file already imports) exports a same-named binding, so it is restated.
const NATTK_MON = 6;
// C ref: you.h enum achievements — ACH_MEDU = 12 (killed Medusa).
const ACH_MEDU_M = 12;
// C ref: decl.c c_obj_colors[] indexed by objects[].oc_color (color.h CLR_*).
// js/apply.js and js/do_name.js each keep a private copy of this table.
const C_OBJ_COLORS_M = [
    'black', 'red', 'green', 'brown', 'blue', 'magenta', 'cyan', 'gray',
    'transparent', 'orange', 'bright green', 'yellow', 'bright blue',
    'bright magenta', 'bright cyan', 'white',
];

// C ref: mondata.h monsndx(ptr) — the mons[] index of a permonst.  mon.js's
// monsndx_mon() takes a MONST; this is the permonst form C's mon.c uses.
function monsndx(ptr) { return ptr?.pmidx ?? NON_PM; }

// Lazy, memoized PM_* lookup.  It must stay lazy: a top-level name_to_pmidx()
// call would run during mon.js's own module evaluation, when makemon.js's MONS
// table is only guaranteed built in the absence of an import cycle.
let _PMCACHE = null;
function PM(name) {
    if (!_PMCACHE) _PMCACHE = new Map();
    if (!_PMCACHE.has(name)) _PMCACHE.set(name, name_to_pmidx(name));
    return _PMCACHE.get(name);
}

// C ref: makemon.c svm.mvitals[] — {died, mvflags}; seen_close/photographed
// are the two 5.0 additions see_monster_closeup() writes.
function mvitals_at(mndx) {
    const mv = (game.mvitals = game.mvitals || []);
    return (mv[mndx] = mv[mndx] || { died: 0, mvflags: 0 });
}
function genocided_pm(mndx) { return ((mvitals_at(mndx).mvflags | 0) & G_GENOD) !== 0; }

// C ref: monst.h:255 mon_offmap(mon) == (mon->mstate != MON_FLOOR).
function mon_offmap(mon) { return (mon?.mstate | 0) !== MON_FLOOR; }

// C ref: mondata.h flag predicates.  Restated locally rather than imported so
// mon.js keeps its current static-import set (see the banner).
function is_undead_m(ptr) { return (mflags2_of(ptr) & M2_UNDEAD) !== 0; }
function is_elf_m(ptr) { return (mflags2_of(ptr) & M2_ELF) !== 0; }
function is_dwarf_m(ptr) { return (mflags2_of(ptr) & M2_DWARF) !== 0; }
function is_gnome_m(ptr) { return (mflags2_of(ptr) & M2_GNOME) !== 0; }
function is_orc_m(ptr) { return (mflags2_of(ptr) & M2_ORC) !== 0; }
function is_shapeshifter_m(ptr) { return (mflags2_of(ptr) & M2_SHAPESHIFTER) !== 0; }
function has_head_m(ptr) { return (mflags1_of(ptr) & M1_NOHEAD) === 0; }
function amorphous_m(ptr) { return (mflags1_of(ptr) & M1_AMORPHOUS) !== 0; }
function is_golem_m(ptr) { return ptr?.mcls === S_GOLEM_C; }
// C ref: mondata.h nonliving(ptr) == is_undead || PM_MANES || weirdnonliving
// (is_golem || mlet == S_VORTEX).
function nonliving_m(ptr) {
    return is_undead_m(ptr) || monsndx(ptr) === PM('manes')
        || is_golem_m(ptr) || ptr?.mcls === S_VORTEX_C;
}
// C ref: mondata.h is_vampire(ptr) == (mlet == S_VAMPIRE).
function is_vampire_m(ptr) { return ptr?.mcls === S_VAMPIRE; }
// C ref: mondata.h unique_corpstat(ptr) == ((ptr)->geno & G_UNIQ) != 0.
function unique_corpstat_m(ptr) { return ((ptr?.geno | 0) & G_UNIQ_M) !== 0; }
// C ref: mondata.h is_watch(ptr) — the Minetown watch (js/fountain.js and
// js/dokick.js each carry the same two-name test).
function is_watch_m(ptr) {
    const nm = ptr?.name;
    return nm === 'watchman' || nm === 'watch captain';
}
// C ref: mondata.h flesh_petrifies(pm) — cockatrice, chickatrice OR Medusa.
// (mon.js's touch_petrifies_pm above is the different macro touch_petrifies(),
// which excludes Medusa.)
function flesh_petrifies_pm(corpsenm) {
    const nm = monster_by_pmidx(corpsenm)?.name;
    return nm === 'cockatrice' || nm === 'chickatrice' || nm === 'Medusa';
}
// C ref: hacklib.c online2(x0,y0,x1,y1) — same row, column or diagonal.
// js/monmove.js:652 has a private copy.
function online2_mon(x0, y0, x1, y1) {
    const dx = x0 - x1, dy = y0 - y1;
    return dy === 0 || dx === 0 || dy === dx || dy === -dx;
}
// C ref: hacklib.c ordin(n) — the ordinal suffix.
function ordin_mon(n) {
    const dd = n % 10;
    return (dd === 0 || dd > 3 || Math.trunc((n % 100) / 10) === 1) ? 'th'
        : (dd === 1) ? 'st' : (dd === 2) ? 'nd' : 'rd';
}
// C ref: objnam.c an(str) / The(str).
function an_mon(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }
function The_mon(s) { return /^[A-Z]/.test(s) ? s : `The ${s}`; }
// C ref: pline.c verbalize(line) — the line in double quotes (js/pray.js:328
// has the same one-liner, module-private).
async function verbalize_mon(line) { await update_topl(`"${line}"`); }

// C ref: youprop.h Hallucination / Blind_telepat, spelled the way the rest of
// the port spells them (js/allmain.js:1415, js/mhitu.js:987).
function Hallucination_mon() {
    const u = game.u;
    return ((u?.uprops?.Hallucination || 0) > 0) || !!u?.HHallucination
        || !!u?.uhallu;
}
function Blind_telepat_mon() {
    return !!(game.u?.ublindf || game.u?.uprops?.Blind_telepat);
}

// C ref: mon.c:4322 wake_msg(mtmp, interesting).  js/monmove.js:640 has a copy
// that requires `interesting` to be TRUE — C's condition is just
// `msleeping && canseemon(mtmp)`, so wake_nearto_core()'s wake_msg(mtmp, FALSE)
// prints there and is silent in monmove's version.  That divergence is why the
// C form is restated here instead of reusing (or "fixing") the other copy.
async function wake_msg_core(mtmp, interesting) {
    if (mtmp.msleeping && canseemon_shared(mtmp))
        await pline(`${Monnam(mtmp)} wakes up${interesting ? '!' : '.'}`
            + `${monsndx(mtmp.data) === PM('flesh golem') ? " It's alive!" : ''}`);
}

// C ref: mon.c's `svl.level.monsters[x][y]` map slot.  This port has no
// per-square monster grid: game.level.monsters is the fmon list AND the map
// (js/display.js m_at() scans it), so "take the monster off the map" is
// "unlink it from that array" — which is what js/uhitm.js killed() does too.
function remove_monster_at(x, y) {
    const list = game.level?.monsters;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (m.mx === x && m.my === y && !m.mridden) { list.splice(i, 1); return; }
    }
}

// ── mon.c:57 pet_sanity_check() ─────────────────────────────────────────────
export async function pet_sanity_check(mtmp, msgarg) {
    if (has_edog(mtmp)) {
        const edog = EDOG(mtmp);
        if ((edog?.droptime | 0) > (game.moves | 0))
            await impossible(`insane pet #${mtmp.m_id} has droptime`
                + ` (${edog.droptime}) in the future (${game.moves}) (${msgarg})`);
        /* C's own TODO: verify some of the other edog fields */
    }
}

// ── mon.c:73 sanity_check_single_mon() ──────────────────────────────────────
// The body is all impossible()/panic() reporting, so it draws nothing and
// changes no state except the one `mtmp->mnum = mndx` repair C makes.
export async function sanity_check_single_mon(mtmp, chk_geno, msg) {
    const mptr = mtmp.data;
    let mx = mtmp.mx, my = mtmp.my;

    if (!mptr || monsndx(mptr) < LOW_PM) {
        /* C panics here rather than continuing with an illegal permonst */
        await impossible(`illegal mon data ${msg}; mnum=${mtmp.mnum}`);
        return;
    }
    const mndx = monsndx(mptr);
    if (mtmp.mnum !== mndx) {
        await impossible(`monster mnum=${mtmp.mnum}, monsndx=${mndx} (${msg})`);
        mtmp.mnum = mndx;
    }
    /* C ref: mon.c:97 — checked BEFORE DEADMONSTER() because a dead monster
       should still have a sane mhpmax.  (The `mhpmax < m_lev` half is disabled
       in C too: gremlins don't obey that rule.) */
    if ((mtmp.mhpmax | 0) < 1 || (mtmp.mhp | 0) > (mtmp.mhpmax | 0))
        await impossible(`${msg}: level ${mtmp.m_lev | 0} ${mptr.name}`
            + ` #${mtmp.m_id} has ${mtmp.mhp} cur HP, ${mtmp.mhpmax} max HP`);
    if (DEADMONSTER(mtmp))
        return;
    if (chk_geno && genocided_pm(mndx))
        await impossible(`genocided ${mptr.name} in play (${msg})`);
    if (mtmp.mtame && !mtmp.mpeaceful)
        await impossible(`tame ${mptr.name} is not peaceful (${msg})`);

    if (mtmp.isshk && !has_eshk(mtmp))
        await impossible(`shk without eshk (${msg})`);
    if (mtmp.ispriest && !has_epri(mtmp))
        await impossible(`priest without epri (${msg})`);
    if (mtmp.isgd && !has_egd(mtmp))
        await impossible(`guard without egd (${msg})`);
    if (mtmp.isminion && !has_emin(mtmp))
        await impossible(`minion without emin (${msg})`);
    /* the Astral guardian angel is tame but carries emin, not edog */
    if (mtmp.mtame) {
        if (!has_edog(mtmp) && !mtmp.isminion)
            await impossible(`pet without edog (${msg})`);
        else
            await pet_sanity_check(mtmp, msg);
    }
    /* a steed should be tame and saddled */
    if (mtmp === game.u?.usteed) {
        const { m_carrying } = await import('./monmove.js');
        const nt = !mtmp.mtame ? 'not tame' : null;
        /* which_armor_mon() reads the monster-side mask; this port keeps a
           SADDLE's mask in obj.owornmask (js/dog.js:304), so the "not worn"
           arm can currently fire for a properly saddled steed. */
        const ns = !m_carrying(mtmp, SADDLE_OTYP) ? 'no saddle'
            : !which_armor_mon(mtmp, W_SADDLE) ? 'saddle not worn' : null;
        if (ns || nt)
            await impossible(`steed: ${ns || ''}${(ns && nt) ? ', ' : ''}`
                + `${nt || ''} (${msg})`);
    }

    if (mtmp.mtrapped) {
        if (mtmp.wormno) {
            /* C's own TODO: how to check a worm in a trap? */
        } else if (!t_at(mx, my)) {
            await impossible(`trapped without a trap (${msg})`);
        }
    }
    /* C ref: mon.c:163 — code that sets mfrozen must also clear mcanmove,
       otherwise helpless() is unreliable */
    if (mtmp.mfrozen && mtmp.mcanmove)
        await impossible(`frozen monster [${mtmp.mtame ? 'tame '
            : mtmp.mpeaceful ? 'peaceful ' : ''}${mptr.name}]`
            + ` is able to move (${msg})`);

    if (mtmp.mundetected) {
        if (!isok(mx, my)) { mx = 0; my = 0; }
        if (mtmp === game.u?.ustuck)
            await impossible(`hiding monster stuck to you (${msg})`);
        if (m_at(mx, my) === mtmp && hides_under_pm(mptr) && !OBJ_AT(mx, my))
            await impossible(`mon hiding under nonexistent obj (${msg})`);
        if (mptr.mcls === S_EEL_MCLS) {
            const { is_pool } = await import('./dbridge.js');
            if (!(is_pool(mx, my) && !Is_waterlevel(game.u?.uz)))
                await impossible(`eel hiding ${!Is_waterlevel(game.u?.uz)
                    ? 'out of water' : 'on Plane of Water'} (${msg})`);
        }
        const typ = game.level?.at(mx, my)?.typ;
        /* normally !accessible would be overridable with passes_walls, but not
           for hiding on the ceiling */
        if (ceiling_hider(mptr)
            && (!has_ceiling()
                || !(typ === POOL || typ === MOAT || typ === WATER
                     || typ === LAVAPOOL || typ === LAVAWALL
                     || (typ != null && ACCESSIBLE(typ)))))
            await impossible(`ceiling hider hiding ${!has_ceiling()
                ? 'without ceiling' : 'in solid stone'} (${msg})`);
        const t = t_at(mx, my);
        if (mtmp.mtrapped && t && !is_pit(t.ttyp))
            await impossible(`hiding while trapped in a non-pit (${msg})`);
    } else if (M_AP_TYPE(mtmp) !== MAP_NOTHING) {
        const is_mimic = (mptr.mcls === S_MIMIC);
        const what = (M_AP_TYPE(mtmp) === MAP_FURNITURE) ? 'furniture'
            : (M_AP_TYPE(mtmp) === MAP_MONSTER) ? 'a monster'
            : (M_AP_TYPE(mtmp) === MAP_OBJECT) ? 'an object'
            : 'something strange';

        if (msg === 'migr') {
            if (M_AP_TYPE(mtmp) !== MAP_MONSTER)
                await impossible(`migrating ${is_mimic ? 'mimic' : 'monster'}`
                    + ` mimicking ${what} ${msg}`);
        } else if (Protection_from_shape_changers()) {
            await impossible(`mimic${is_mimic ? '' : 'ker'} concealed as`
                + ` ${what} despite Prot-from-shape-changers ${msg}`);
        }
        /* the Wizard's "double trouble" clone starts out mimicking a monster,
           and a pet's quickmimic lasts until it finishes the mimic corpse */
        if (!(is_mimic || mtmp.meating
              || (mtmp.iswiz && M_AP_TYPE(mtmp) === MAP_MONSTER)))
            await impossible(`non-mimic (${mptr.name}) posing as ${what} (${msg})`);
    }
    if (mtmp.mleashed) {
        /* C ref: apply.c get_mleash(mtmp) — unported; the leash OBJECT is the
           thing being looked for, so there is nothing to stand in for it. */
        if (!mtmp.mtame)
            await impossible(`monst ${mtmp.m_id}: leashed but not tame`
                + ` ${mptr.name}`);
    }
}

// ── mon.c:258 mon_sanity_check() ────────────────────────────────────────────
export async function mon_sanity_check() {
    for (const mtmp of fmonOrder()) {
        /* dead monsters should still have sane data */
        await sanity_check_single_mon(mtmp, true, 'fmon');
        if (DEADMONSTER(mtmp) && !mtmp.isgd)
            continue;

        const x = mtmp.mx, y = mtmp.my;
        if (!isok(x, y) && !(mtmp.isgd && x === 0 && y === 0)) {
            await impossible(`mon claims to be at <${x},${y}>?`);
        } else if (mtmp === game.u?.usteed) {
            /* the steed is in fmon but not on the map; its coordinates should
               track the hero's location */
            if (x !== game.u.ux || y !== game.u.uy)
                await impossible(`steed claims to be at <${x},${y}>?`);
        } else if (m_at(x, y) !== mtmp) {
            await impossible(`mon at <${x},${y}> is not there!`);
        } else if (mtmp.wormno) {
            const { sanity_check_worm } = await import('./worm.js');
            sanity_check_worm(mtmp);
        } else if (mon_offmap(mtmp)) {
            /* some temp mstate bits are expected while a mon is being removed,
               but the DEADMONSTER check above skips those */
            await impossible(`floor mon with mstate set to`
                + ` 0x${(mtmp.mstate | 0).toString(16)}`);
        }
    }

    /* C ref: mon.c:293 — the reverse sweep over the level.monsters GRID.  This
       port has no grid (see remove_monster_at above), so "map mon not in fmon"
       and "map mon found at <x,y>" have nothing to compare against; the one arm
       that still means something is the steed-on-map test. */
    const st = game.u?.usteed;
    if (st && m_at(st.mx, st.my) === st)
        await impossible(`steed is on the map at <${st.mx},${st.my}>!`);

    for (const mtmp of (game.migrating_mons || [])) {
        await sanity_check_single_mon(mtmp, false, 'migr');
        const ms = mtmp.mstate | 0;
        if ((ms & ~(MON_MIGRATING | MON_LIMBO | MON_ENDGAME_MIGR | MON_OFFMAP)) !== 0
            || !(ms & MON_MIGRATING))
            await impossible(`migrating mon with mstate set to`
                + ` 0x${ms.toString(16)}`);
    }

    const { wormno_sanity_check } = await import('./worm.js');
    wormno_sanity_check(); /* test for a bogus worm tail */
}

// ── mon.c:386 zombie_form() ─────────────────────────────────────────────────
// The PM index of the zombie counterpart, or NON_PM.  js/monmove.js:1520 has
// zombie_form_exists() (a boolean reduction for mm_2way_aggression) and
// js/mkobj.js:1322 a class-only variant; neither yields the index, which is
// what mon.c's zombify path and xkilled() actually need.
// Note C's S_HUMANOID arm: a NON-dwarf humanoid `break`s out of the switch and
// falls to the final NON_PM — it does NOT fall through into S_GNOME.
export function zombie_form(pm) {
    switch (pm?.mcls) {
    case S_ZOMBIE_C: /* already a zombie/ghoul/skeleton: stays as it is */
        return NON_PM;
    case S_KOBOLD_C:
        return PM('kobold zombie');
    case S_ORC_C:
        return PM('orc zombie');
    case S_GIANT_C:
        if (monsndx(pm) === PM('ettin'))
            return PM('ettin zombie');
        return PM('giant zombie');
    case S_HUMAN_C:
    case S_KOP_C:
        if (is_elf_m(pm))
            return PM('elf zombie');
        return PM('human zombie');
    case S_HUMANOID_C:
        if (is_dwarf_m(pm))
            return PM('dwarf zombie');
        break;
    case S_GNOME_C:
        return PM('gnome zombie');
    default:
        break;
    }
    return NON_PM;
}

// ── mon.c:470 genus() ───────────────────────────────────────────────────────
// mode 0 -> species (human/elf/dwarf/gnome/orc), mode 1 -> character class.
// The thirteen quest guardians are named individually because their permonst
// flags do not distinguish them from ordinary humans.
const QUEST_GUARDIAN_GENUS = [
    ['student', 'archeologist'], ['chieftain', 'barbarian'],
    ['neanderthal', 'caveman'], ['attendant', 'healer'],
    ['page', 'knight'], ['abbot', 'monk'], ['acolyte', 'priest'],
    ['hunter', 'ranger'], ['thug', 'rogue'], ['roshi', 'samurai'],
    ['guide', 'tourist'], ['apprentice', 'wizard'], ['warrior', 'valkyrie'],
];
export function genus(mndx, mode) {
    for (const [guardian, klass] of QUEST_GUARDIAN_GENUS) {
        const g = PM(guardian);
        if (g >= 0 && mndx === g)
            return mode ? PM(klass) : PM('human');
    }
    if (ismnum(mndx)) {
        const ptr = monster_by_pmidx(mndx);
        if (is_human_flag(ptr)) mndx = PM('human');
        else if (is_elf_m(ptr)) mndx = PM('elf');
        else if (is_dwarf_m(ptr)) mndx = PM('dwarf');
        else if (is_gnome_m(ptr)) mndx = PM('gnome');
        else if (is_orc_m(ptr)) mndx = PM('orc');
    }
    return mndx;
}

// ── mon.c:1354 meatbox() ────────────────────────────────────────────────────
// Dispose of the contents of an eaten container: a gelatinous cube engulfs
// them (mpickobj), everything else spills them onto the floor.  No RNG of its
// own; flooreffects() is the only thing under it that can draw.
export async function meatbox(mon, otmp) {
    const engulf_contents = (monsndx(mon.data) === PM('gelatinous cube'));
    const x = mon.mx, y = mon.my;

    if (!Has_contents(otmp) || !isok(x, y))
        return;

    /* contents of eaten containers become engulfed or dropped onto the floor;
       arbitrary, but otherwise g-cubes are too powerful */
    if (!engulf_contents && cansee(x, y)) {
        const { xname } = await import('./invent.js');
        const { surface } = await import('./dungeon.js');
        /* C: s_suffix(The(distant_name(otmp, xname))).  js/invent.js keeps
           distant_name() private and exports only the doname flavour, so the
           plain xname is used; the "far away" pretense only ever suppresses
           BUC/enchantment detail. */
        await pline(`${s_suffix_mon(The_mon(xname(otmp)))} contents spill out`
            + ` onto the ${surface(x, y)}.`);
    }
    const { obj_extract_self } = await import('./invent.js');
    const { removed_from_icebox } = await import('./pickup.js');
    let cobj;
    while ((cobj = otmp.cobj) != null) {
        obj_extract_self(cobj);
        if (otmp.otyp === ICE_BOX)
            removed_from_icebox(cobj);
        if (engulf_contents) {
            mpickobj(mon, cobj);
        } else {
            /* C ref: mon.c:1378 `if (!flooreffects(cobj, x, y, ""))` — the
               water/lava/pit interaction, which can destroy the object and
               DRAWS while doing so.  Unported, so the guard is named rather
               than assumed false. */
            place_object(cobj, x, y);
        }
    }
}

// ── mon.c:1656 meatcorpse() ─────────────────────────────────────────────────
// 0 = nothing eaten, 1 = ate a corpse, 2 = died.
export async function meatcorpse(mtmp) {
    const original_ptr = mtmp.data;
    const x = mtmp.mx, y = mtmp.my;

    /* if a pet, eating is handled separately, in dog.c */
    if (mtmp.mtame)
        return 0;

    const { sobj_at, nxtobj, splitobj, distant_doname } = await import('./invent.js');
    const { vegan } = await import('./eat.js');

    /* skips past any globs */
    for (let otmp = sobj_at(CORPSE, x, y); otmp;
         /* won't get back here if otmp is split or gets used up */
         otmp = nxtobj(otmp, CORPSE, true)) {

        const corpsepm = monster_by_pmidx(otmp.corpsenm);
        /* skip veggy corpses even when omnivorous, and harmful ones */
        if (vegan(corpsepm)
            || (flesh_petrifies_pm(otmp.corpsenm) && !resists_ston(mtmp)))
            continue;
        if (is_rider_pm(otmp.corpsenm)) {
            /* C ref: mon.c:1679 revive_corpse(otmp) — unported; it makemon's
               the Rider back onto the map, so it DRAWS.  C `break`s on a
               successful revival and `continue`s on failure, and both arms
               newsym() first. */
            newsym(x, y);
            continue;
        }

        if ((otmp.quan | 0) > 1)
            otmp = splitobj(otmp, 1);

        if (cansee(x, y) && canseemon_shared(mtmp)) {
            /* C calls distant_name() for its side effects even when the result
               won't be printed */
            const otmpname = distant_doname(otmp, false);
            if (game.flags?.verbose)
                await pline(`${Monnam(mtmp)} eats ${otmpname}!`);
        } else if (game.flags?.verbose) {
            await update_topl('You hear a masticating sound.');
        }

        /* C ref: mon.c:1709 m_consume_obj(mtmp, otmp).  The port's copy is
           js/monmove.js:4749 and is module-private, so THIS is the one call
           site that has to be filled in before meatcorpse() may be wired up.
           It draws (delobj -> obj_resists rn2(100), plus grow_up/newcham when
           the meal polymorphs the eater), so faking it here would hand a
           future hookup a different stream than C's. */
        await m_consume_obj_unported(mtmp, otmp);

        /* in case it polymorphed or died */
        const ptr = mtmp.data;
        if (ptr !== original_ptr)
            return !ptr ? 2 : 1;

        /* engulf & devour is instant, so meating is not set */
        if (mtmp.minvis)
            newsym(x, y);

        return 1;
    }
    return 0;
}
/* See the comment at its call site: deliberately does nothing. */
async function m_consume_obj_unported(_mtmp, _otmp) { /* js/monmove.js:4749 */ }

// ── mon.c:1726 mon_give_prop() ──────────────────────────────────────────────
// Grant a monster an intrinsic resistance.  No RNG: should_givit()'s die roll
// is the caller's job.
// C ref: prop.h PROP indices and permonst.h MR_* bits; mondata.c res_to_mr()
// is the mapping between them.
const FIRE_RES_P = 1, SLEEP_RES_P = 2, COLD_RES_P = 3, DISINT_RES_P = 4,
    SHOCK_RES_P = 5, POISON_RES_P = 6;
const MR_FIRE_P = 0x01, MR_COLD_P = 0x02, MR_SLEEP_P = 0x04,
    MR_DISINT_P = 0x08, MR_ELEC_P = 0x10, MR_POISON_P = 0x20;
function res_to_mr(prop) {
    switch (prop) {
    case FIRE_RES_P: return MR_FIRE_P;
    case COLD_RES_P: return MR_COLD_P;
    case SLEEP_RES_P: return MR_SLEEP_P;
    case DISINT_RES_P: return MR_DISINT_P;
    case SHOCK_RES_P: return MR_ELEC_P;
    case POISON_RES_P: return MR_POISON_P;
    default: return 0;
    }
}
export async function mon_give_prop(mtmp, prop) {
    let msg = null;

    /* Pets lack most of the hero's fields, so anything outside these six is
       silently dropped (C: "if it happens to choose strength gain or teleport
       control or whatever, ignore it") */
    switch (prop) {
    case FIRE_RES_P:   msg = '%s shivers slightly.'; break;
    case COLD_RES_P:   msg = '%s looks quite warm.'; break;
    case SLEEP_RES_P:  msg = '%s looks wide awake.'; break;
    case DISINT_RES_P: msg = '%s looks very firm.'; break;
    case SHOCK_RES_P:  msg = '%s crackles with static electricity.'; break;
    case POISON_RES_P: msg = '%s looks healthy.'; break;
    default:
        return; /* can't give it */
    }
    const intrinsic = res_to_mr(prop);

    /* No message if it already had the property INTRINSICALLY, but the
       intrinsic is still granted when it only had it from mresists.  A purely
       EXTRINSIC source does still print, which is why mon_resistancebits() is
       not what C tests here. */
    if (((mtmp.data?.mresists | 0) | (mtmp.mintrinsics | 0)) & intrinsic)
        msg = null;

    if (intrinsic)
        mtmp.mintrinsics = (mtmp.mintrinsics | 0) | intrinsic;

    if (canseemon_shared(mtmp) && msg)
        await pline(msg.replace('%s', Monnam(mtmp)));
}

// ── mon.c:1778 mon_givit() ──────────────────────────────────────────────────
// Maybe give a monster an intrinsic from the corpse it just ate.
export async function mon_givit(mtmp, ptr) {
    /* C ref: eat.c corpse_intrinsic(ptr) — unported (js/eat.js:1522 records the
       deferral).  It decides WHICH prop a corpse conveys and DRAWS rn2(count)
       while doing so, so it cannot be guessed; prop therefore stays 0, which
       makes the tail below a no-op rather than a wrong one. */
    const prop = 0;
    const vis = canseemon_shared(mtmp);

    if (DEADMONSTER(mtmp))
        return;

    if (monsndx(ptr) === PM('invisible stalker')) {
        /*
         * The stalker isn't flagged as conferring invisibility, so prop is 0
         * for it.  A monster can only gain PERMANENT invisibility (temporary
         * invisibility and see invisible aren't implemented for monsters), and
         * since that is a net negative for a pet, C grants it anyway and lets
         * the player live with it.
         */
        if (!mtmp.perminvis || mtmp.invis_blkd) {
            const mtmpbuf = Monnam(mtmp);
            /* C ref: mon.c:1806 mon_set_minvis(mtmp, FALSE) — unported; it
               sets perminvis/minvis and redoes the light/vision bookkeeping. */
            if (vis) {
                const { canspotmon } = await import('./uhitm.js');
                await pline(`${mtmpbuf} ${!canspotmon(mtmp) ? 'vanishes'
                    : mtmp.invis_blkd ? 'seems to flicker'
                    : 'becomes invisible'}.`);
            }
        }
        mtmp.mstun = 1; /* no timeout but will eventually wear off */
        return;
    }

    if (prop === 0)
        return; /* no intrinsic from this corpse */

    /* C ref: eat.c should_givit(prop, ptr) — the failed-die-roll gate; also
       unported, and it DRAWS.  Reaching here needs corpse_intrinsic() first. */
    await mon_give_prop(mtmp, prop);
}

// ── mon.c:2057 monlineu() ───────────────────────────────────────────────────
// Is <nx,ny> in a straight line from where 'mon' THINKS the hero is?
export function monlineu(mon, nx, ny) {
    return online2_mon(nx, ny, mon.mux, mon.muy);
}

// ── mon.c:2487 dmonsfree() ──────────────────────────────────────────────────
// Really free the dead monsters.  This port keeps dead monsters in
// game.level.monsters and filters them with DEADMONSTER() everywhere, so
// wiring this up changes what every list-walking predicate sees.
export async function dmonsfree() {
    const list = game.level?.monsters;
    if (!list) return;
    let count = 0;
    /* C walks the fmon chain forwards; a reverse index walk is the splice-safe
       equivalent over an array and removes the same set. */
    for (let i = list.length - 1; i >= 0; i--) {
        const freetmp = list[i];
        if (DEADMONSTER(freetmp) && !freetmp.isgd) {
            list.splice(i, 1);
            freetmp.nmon = null;
            dealloc_monst(freetmp);
            count++;
        }
    }
    if (count !== (game.iflags?.purge_monsters | 0))
        await impossible(`dmonsfree: ${count} removed doesn't match`
            + ` ${game.iflags?.purge_monsters | 0} pending`);
    if (game.iflags) game.iflags.purge_monsters = 0;
}

// ── mon.c:2515 replmon() ────────────────────────────────────────────────────
// Move a monster into a larger struct (one that has mextra).  JS needs no
// reallocation, but the bookkeeping around it — inventory ownership, the
// polearm target, the light source, ustuck/usteed, the fmon head — is real.
export async function replmon(mtmp, mtmp2) {
    /* transfer the monster's inventory */
    for (const otmp of (mtmp2.minvent || [])) {
        if (otmp.ocarry !== mtmp)
            await impossible('replmon: minvent inconsistency');
        otmp.ocarry = mtmp2;
    }
    mtmp.minvent = [];
    /* before relmon(mtmp), because that could clear polearm.hitmon */
    if (game.context?.polearm?.hitmon === mtmp)
        game.context.polearm.hitmon = mtmp2;

    /* remove the old monster from the map and from the `fmon' list */
    await relmon_local(mtmp, null);

    /* finish adding its replacement */
    if (mtmp !== game.u?.usteed) { /* don't place a steed onto the map */
        const list = (game.level.monsters = game.level.monsters || []);
        if (!list.includes(mtmp2)) list.push(mtmp2);
    }
    if (mtmp2.wormno) { /* update the map for the worm's segments */
        const { place_wsegs } = await import('./worm.js');
        place_wsegs(mtmp2, mtmp);
    }
    const { emits_light, new_light_source, del_light_source, LS_MONSTER }
        = await import('./light.js');
    if (emits_light(mtmp2.data)) {
        /* too rare to warrant a `mon_move_light_source' */
        new_light_source(mtmp2.mx, mtmp2.my, emits_light(mtmp2.data),
                         LS_MONSTER, mtmp2);
        /* relies on `mtmp' not actually having been freed yet */
        del_light_source(LS_MONSTER, mtmp);
    }
    if (game.u?.ustuck === mtmp)
        set_ustuck(mtmp2);
    if (game.u?.usteed === mtmp)
        game.u.usteed = mtmp2;
    /* C ref: shk.c replshk(mtmp, mtmp2) — unported; it repoints ESHK's bill
       and customer back-pointers at the new struct. */

    /* discard the old monster */
    dealloc_monst(mtmp);
}

// C ref: mon.c:2561 relmon(mon, monst_list).  js/muse.js and js/vault.js each
// carry a private copy; this one is local to the new code so replmon() and
// m_detach() can express C's ordering (mon_leaving_level FIRST, then the
// unlink, then the optional re-link into mydogs / migrating_mons).
async function relmon_local(mon, monst_list) {
    await mon_leaving_level(mon);
    const list = game.level?.monsters;
    if (list) {
        const ix = list.indexOf(mon);
        if (ix >= 0) list.splice(ix, 1);
    }
    mon.nmon = null;              /* an orphan has no next monster */
    if (monst_list) monst_list.push(mon);
}

// ── mon.c:2597 copy_mextra() ────────────────────────────────────────────────
// C allocates each sub-struct on demand and then structure-copies it; a
// `*EGD(mtmp2) = *EGD(mtmp1)` is exactly a shallow copy of the members.
export function copy_mextra(mtmp2, mtmp1) {
    if (!mtmp2 || !mtmp1 || !mtmp1.mextra)
        return;

    if (!mtmp2.mextra) mtmp2.mextra = {};
    const x1 = mtmp1.mextra, x2 = mtmp2.mextra;
    if (MGIVENNAME(mtmp1)) x2.mgivenname = MGIVENNAME(mtmp1);
    if (x1.egd) x2.egd = { ...x1.egd };
    if (x1.epri) x2.epri = { ...x1.epri };
    if (x1.eshk) x2.eshk = { ...x1.eshk };
    if (x1.emin) x2.emin = { ...x1.emin };
    if (x1.edog) x2.edog = { ...x1.edog };
    if (x1.ebones) x2.ebones = { ...x1.ebones };
    if (x1.mcorpsenm != null) x2.mcorpsenm = x1.mcorpsenm;
}

// ── mon.c:2649 dealloc_mextra() ─────────────────────────────────────────────
// C frees each sub-allocation and zeroes the pointer.  In JS dropping the
// reference is what releases it; the one member that is NOT just a
// deallocation is mcorpsenm, which C resets to NON_PM.
export function dealloc_mextra(m) {
    const x = m?.mextra;
    if (x) {
        x.mgivenname = 0;
        x.egd = 0; x.epri = 0; x.eshk = 0; x.emin = 0; x.edog = 0; x.ebones = 0;
        x.mcorpsenm = NON_PM; /* no allocation to release */
        m.mextra = null;
    }
}

// ── mon.c:2676 dealloc_monst() ──────────────────────────────────────────────
// C panics if the monster is still linked, then wipes the struct so that stale
// reads are obvious.  The wipe is the part that matters here: several places in
// this port keep a reference to a monster after it dies.
export function dealloc_monst(mon) {
    if (!mon) return;
    if (mon.nmon)
        return; /* C: panic("dealloc_monst with nmon on %s") */
    if (mon.mextra)
        dealloc_mextra(mon);
    /* C: *mon = cg.zeromonst — clear out of date information contained in the
       about-to-become-stale memory; see dealloc_obj() */
    for (const k of Object.keys(mon)) delete mon[k];
}

// ── mon.c:2696 mon_leaving_level() ──────────────────────────────────────────
// 'mon' is leaving the level, either by migrating (relmon) or by dying
// (m_detach).  Draws nothing itself; the unstuck() inside it can draw rnd(2).
export async function mon_leaving_level(mon) {
    const mx = mon.mx, my = mon.my;
    const onmap = (isok(mx, my) && m_at(mx, my) === mon);

    /* to prevent an infinite relobj-flooreffects-hmon-killed loop */
    mon.mtrapped = 0;
    /* C ref: mon.c:2703 unstuck(mon) — mon is neither swallowing nor holding
       the hero, nor held by the hero.  The port's copy is js/uhitm.js
       unstuck_mon() (module-private); its rnd(2) tail IS exported. */
    if (game.u?.ustuck === mon) {
        set_ustuck(null);
        const { unstuck_mspec_used } = await import('./uhitm.js');
        unstuck_mspec_used(mon);
    }

    /* a vault guard might be at <0,0> */
    if (onmap || (mx === 0 && my === 0)) {
        if (mon.wormno) {
            const { remove_worm } = await import('./worm.js');
            remove_worm(mon);
        } else {
            remove_monster_at(mx, my);
        }
        /* C deliberately leaves mon->mx,my alone: too many places assume the
           stale coordinates are still readable */
    }
    if (onmap) {
        mon.mundetected = 0; /* for migration; irrelevant for death */
        /* unhide a mimic in case its shape was blocking line of sight, or it
           is accompanying the hero to another level */
        if (M_AP_TYPE(mon) !== MAP_NOTHING && M_AP_TYPE(mon) !== MAP_MONSTER) {
            const { seemimicLocal } = await import('./uhitm.js');
            seemimicLocal(mon);
        }
        /* if mon is pinned by a boulder, removing mon lets the boulder drop */
        const { fill_pit } = await import('./trap.js');
        await fill_pit(mx, my);
        newsym(mx, my);
    }
    /* a remembered polearm target that isn't here any more is forgotten */
    if (game.context?.polearm?.hitmon === mon)
        game.context.polearm.hitmon = null;
}

// ── mon.c:2734 m_detach() ───────────────────────────────────────────────────
// 'mtmp' is going away; remove its effects from the other data structures.
// mptr reflects mtmp->data BEFORE the death (newcham may have changed it).
export async function m_detach(mtmp, mptr, due_to_death) {
    const mx = mtmp.mx, my = mtmp.my;

    /* C ref: apply.c m_unleash(mtmp, FALSE) — unported; it also drops the
       leash object and prints "Your leash falls slack." */
    if (mtmp.mleashed) mtmp.mleashed = 0;

    const { emits_light, del_light_source, LS_MONSTER } = await import('./light.js');
    if (mx > 0 && emits_light(mptr))
        del_light_source(LS_MONSTER, mtmp);

    /*
     * Take mtmp off the map but not out of the fmon list yet (dmonsfree does
     * that).  Sequencing: the inventory ought to be dropped before mtmp comes
     * off the map, but if it holds a boulder and mtmp is in a pit the drop has
     * to wait for the corpse; C compromises by taking mtmp off the map first.
     */
    await mon_leaving_level(mtmp);

    mtmp.mhp = 0; /* simplify some tests: force mhp to 0 */
    /* the Wizard's death handling runs even when he leaves the dungeon alive */
    if (mtmp.iswiz) {
        const { wizdeadorgone } = await import('./wizard.js');
        wizdeadorgone();
    }
    /* foodead() feedback is skipped for mongone(): saving bones or a wizard
       mode genocide of "*" removes special monsters without killing them */
    if (due_to_death) {
        /* C ref: quest.c nemdead()/leaddead() plus mon.c stinky_nemesis() and
           nemesis_stinks() — none ported; they set quest_status bits and, for
           three roles, fill the nemesis's square with noxious gas. */
        const { relobj } = await import('./uhitm.js');
        /* drop mtmp->minvent onto the map and issue newsym(mx,my) */
        relobj(mtmp, mx, my);
    }

    /* C ref: steal.c thiefdead() (gs.stealmid) and shk.c shkgone() — neither
       ported; the first resets theft-in-progress state, the second the shop. */
    if (mtmp.wormno) {
        const { wormgone } = await import('./worm.js');
        wormgone(mtmp);
    }
    if (In_endgame(game.u?.uz))
        mtmp.mstate = (mtmp.mstate | 0) | MON_ENDGAME_FREE;

    if (((mtmp.mstate | 0) & MON_DETACH) !== 0) {
        await impossible(`m_detach: ${mptr?.name} is already detached?`);
    } else {
        mtmp.mstate = (mtmp.mstate | 0) | MON_DETACH;
        game.iflags = game.iflags || {};
        game.iflags.purge_monsters = (game.iflags.purge_monsters | 0) + 1;
    }

    /* the hero is thrown from a steed that dies or is genocided */
    if (mtmp === game.u?.usteed) {
        /* C ref: steed.c dismount_steed(DISMOUNT_GENERIC) — js/steed.js owns
           that path; js/artifact.js:2799 has a one-line stand-in. */
        game.u.usteed = null;
    }
}

// ── mon.c:2808 set_mon_min_mhpmax() ─────────────────────────────────────────
// Give a life-saved monster a sane mhpmax after excessive life draining.
export function set_mon_min_mhpmax(mon, minimum_mhpmax) {
    /* can't be less than m_lev+1: using m_lev itself would let a level 0
       monster end up allowing a minimum of 0.  Life draining reduces m_lev, so
       this usually isn't much of a boost. */
    if ((mon.mhpmax | 0) < (mon.m_lev | 0) + 1)
        mon.mhpmax = (mon.m_lev | 0) + 1;
    /* the caller's alternate minimum wins iff it is bigger; the traditional 10
       always boosts level 0 and level 1 monsters */
    if ((mon.mhpmax | 0) < minimum_mhpmax)
        mon.mhpmax = minimum_mhpmax;
}

// ── mon.c:2827 mlifesaver() ─────────────────────────────────────────────────
// Find the WORN amulet of life saving that will save this monster.
export function mlifesaver(mon) {
    if (!nonliving_m(mon.data) || is_vampshifter(mon)) {
        const otmp = which_armor_mon(mon, W_AMUL_MON);
        if (otmp && otmp.otyp === AMULET_OF_LIFE_SAVING_OTYP)
            return otmp;
    }
    return null;
}

// ── mon.c:2839 lifesaved_monster() ──────────────────────────────────────────
export async function lifesaved_monster(mtmp) {
    const lifesave = mlifesaver(mtmp);

    if (lifesave) {
        /* not canseemon: amulets are worn on the head, so this shouldn't show
           for a long worm with only a tail visible.  Invisibility is not
           checked either — a glowing/disintegrating amulet is always visible. */
        if (cansee(mtmp.mx, mtmp.my)) {
            await pline('But wait...');
            await pline(`${s_suffix_mon(Monnam(mtmp))} medallion begins to glow!`);
            const { makeknown } = await import('./invent.js');
            makeknown(AMULET_OF_LIFE_SAVING_OTYP);
            /* the amulet is visible even when the monster is not */
            if (canseemon_shared(mtmp)) {
                await pline(attacktype(mtmp.data, AT_EXPL)
                            || attacktype(mtmp.data, AT_BOOM)
                    ? `${Monnam(mtmp)} reconstitutes!`
                    : `${Monnam(mtmp)} looks much better!`);
            }
            await pline('The medallion crumbles to dust!');
        }
        m_useup_armor(mtmp, lifesave);
        /* equip a replacement amulet, if any, on the next move */
        check_gear_next_turn(mtmp);

        const surviver = !genocided_pm(monsndx(mtmp.data));
        mtmp.mcanmove = 1;
        mtmp.mfrozen = 0;
        if (mtmp.mtame && !mtmp.isminion) {
            /* C ref: dog.c wary_dog(mtmp, !surviver) — unported; it rebuilds
               the pet's edog fields and DRAWS while doing so. */
        }
        set_mon_min_mhpmax(mtmp, 10); /* mhpmax = max(m_lev+1, 10) */
        mtmp.mhp = mtmp.mhpmax;

        if (!surviver) {
            /* a genocided monster can't be life-saved */
            if (cansee(mtmp.mx, mtmp.my)) {
                const { mon_nam } = await import('./uhitm.js');
                await pline(`Unfortunately, ${mon_nam(mtmp)} is still`
                    + ` genocided...`);
            }
            mtmp.mhp = 0;
        }
    }
}

// ── mon.c:2890 vamprises() ──────────────────────────────────────────────────
// A shape-shifted vampire that is killed reverts to its base form instead of
// dying.  Returns true if it revived (it can still be killed by a booby
// trapped door on the way back).  Protection from shape changers needs no test:
// a protected vampire is already in normal form.
export async function vamprises(mtmp) {
    const mndx = mtmp.cham;

    if (ismnum(mndx) && mndx !== monsndx(mtmp.data) && !genocided_pm(mndx)) {
        const { x_monnam, canspotmon } = await import('./uhitm.js');
        const { ARTICLE_THE, ARTICLE_A, SUPPRESS_INVISIBLE, SUPPRESS_NAME,
            SUPPRESS_IT, AUGMENT_IT } = await import('./do_name.js');
        /* alternate message phrasing for some monster types */
        const spec_mon = (nonliving_m(mtmp.data) || noncorporeal_mon(mtmp.data)
                          || amorphous_m(mtmp.data));
        const spec_death = (!!game.disintegested /* disintegrated/digested */
                            || noncorporeal_mon(mtmp.data)
                            || amorphous_m(mtmp.data));
        const x = mtmp.mx, y = mtmp.my;
        const Unaware = !!(game.u?.usleep || game.u?.uprops?.Unaware);

        /* build the 'before' argument while it is still in its shifted form */
        const action = `${Unaware ? 'you dream that ' : ''}`
            + `${x_monnam(mtmp, ARTICLE_THE, spec_mon ? null : 'seemingly dead',
                          SUPPRESS_INVISIBLE | AUGMENT_IT, false)} `
            + `${Unaware ? '' : 'suddenly '}`
            + `${spec_death ? 'reconstitutes' : 'transforms'} and rises as`;
        mtmp.mcanmove = 1;
        mtmp.mfrozen = 0;
        set_mon_min_mhpmax(mtmp, 10); /* mhpmax = max(m_lev+1, 10) */
        mtmp.mhp = mtmp.mhpmax;
        /* mtmp==u.ustuck happens if it was a fog cloud, or a poly'd hero is
           hugging a vampire bat */
        if (mtmp === game.u?.ustuck) {
            if (game.u.uswallow) {
                const { expels } = await import('./mhitu.js');
                await expels(mtmp, mtmp.data, false);
            } else {
                /* C ref: uhitm.c uunstick() — not ported under that name; its
                   body is set_ustuck(0) plus a "You get released!" line. */
                set_ustuck(null);
            }
        }

        if (!newcham(mtmp, monster_by_pmidx(mndx)))
            return !DEADMONSTER(mtmp);
        mtmp.cham = (monsndx(mtmp.data) === mndx) ? NON_PM : mndx;

        if (canspotmon(mtmp)) {
            await pline(`${action.charAt(0).toUpperCase()}${action.slice(1)}`
                + ` ${x_monnam(mtmp, ARTICLE_A, null,
                               SUPPRESS_NAME | SUPPRESS_IT | SUPPRESS_INVISIBLE,
                               false)}!`);
            game.vamp_rise_msg = true;
        }
        /* the revived vampire is in normal shape and so can't be amorphous; on
           a closed door square, destroy the door and blow it up if trapped */
        if (closed_door_at(x, y)) {
            const door = game.level.at(x, y);
            const trapped = ((door.doormask | 0) & D_TRAPPED_M) !== 0;
            const seeit = cansee(x, y);

            if (!seeit)
                await update_topl(`You hear ${trapped ? 'an explosion'
                    : 'a door being smashed'}.`);
            else if (!canspotmon(mtmp))
                await pline(`You see ${trapped ? 'a door exploding'
                    : 'a door being smashed'}.`);
            else if (!Unaware)
                await pline(`The door is smashed${trapped
                    ? ' and it explodes!' : '.'}`);

            door.doormask = D_NODOOR_M;
            const { recalc_block_point } = await import('./vision.js');
            recalc_block_point(x, y);
            if (trapped) {
                /* C ref: mon.c:2974 mb_trapped(mtmp, seeit) with flags.verbose
                   forced off.  js/monmove.js:3126 has it, module-private; it
                   rolls the door-trap damage, so the call is NAMED here rather
                   than reproduced, and trap_killed stays false. */
                const trap_killed = false;
                /* mtmp was a vampire, so use the unconditional "destroyed" */
                if (trap_killed && canspotmon(mtmp) && !Unaware)
                    await pline(`${Monnam(mtmp)} is destroyed!`);
            }
        }
        newsym(x, y);
        return true;
    }
    return false;
}

// ── mon.c:2997 logdeadmon() ─────────────────────────────────────────────────
// Record an achievement / emit a livelog line for a notable death.  No RNG.
export async function logdeadmon(mtmp, mndx) {
    let howmany = mvitals_at(mndx).died | 0;

    if (mndx === PM('Medusa') && howmany === 1) {
        const { record_achievement } = await import('./insight.js');
        record_achievement(ACH_MEDU_M); /* also generates a livelog event */
        return;
    }
    /* unique_corpstat() includes the Wizard and any High Priest even though
       they aren't actually unique.  Shopkeeper kills are logged only the first
       time per shopkeeper (their kill counter is shared). */
    if (!((unique_corpstat_m(mtmp.data)
           && (mndx !== PM('high priest') || !mtmp.mrevived))
          || (mtmp.isshk && !mtmp.mrevived)))
        return;

    const { livelog_printf, LL_UMONST, LL_ACHIEVE } = await import('./livelog.js');
    const { x_monnam } = await import('./uhitm.js');
    const { ARTICLE_THE, EXACT_NAME } = await import('./do_name.js');
    /* show what was actually killed even when unseen or hallucinated */
    const llmonnam = x_monnam(mtmp, ARTICLE_THE, null, EXACT_NAME, false);
    const herodidit = !game.context?.mon_moving;
    let shkdetail = '';

    if (mtmp.isshk) {
        howmany = 1;
        /* C ref: mon.c:3025 — ", the <shoptype> proprietor".  shtypes[] is
           js/shknam.js's table and is not exported, so the shop TYPE is the one
           piece of this string that cannot be filled in yet.  The trailing
           comma is C's, for the "<shk>, shkdetails, has been killed" phrasing
           when the hero isn't directly responsible. */
        shkdetail = `, the ${mtmp.female ? 'proprietrix' : 'proprietor'}`
            + `${herodidit ? '' : ','}`;
    } else if (mndx === PM('high priest')) {
        /* the high priest[ess] isn't unique, but !mrevived above means this is
           the first death for THIS one */
        howmany = 1;
    }

    /* killing a unique more than once isn't logged every time; the Wizard and
       the Riders can die more than once "naturally" */
    if (howmany <= 3 || howmany === 5 || howmany === 10 || howmany === 25
        || (howmany % 50) === 0) { /* 50, 100, 150, 200, 250 */
        let llevent_type = LL_UMONST;
        /* the first kill of any unique is a major event, as is every logged
           kill of the Wizard or a Rider */
        if (howmany === 1 || mtmp.iswiz || is_rider_pm(mndx))
            llevent_type |= LL_ACHIEVE;
        const xtra = (howmany > 1) ? ` (${howmany}${ordin_mon(howmany)} time)` : '';
        const mkilled = nonliving_m(mtmp.data) ? 'destroyed' : 'killed';
        if (herodidit) /* "killed <monst>" */
            livelog_printf(llevent_type,
                `${mkilled} ${llmonnam}${shkdetail}${xtra}`);
        else /* trap, pet, conflict: "<monst> has been killed" */
            livelog_printf(llevent_type,
                `${llmonnam}${shkdetail} has been ${mkilled}${xtra}`);
    }
}

// ── mon.c:3072 anger_quest_guardians() ──────────────────────────────────────
// iter_mons() callback: anger every guardian of the hero's own quest.
export async function anger_quest_guardians(mtmp) {
    const guardnum = urole_guardnum();
    if (guardnum != null && monsndx(mtmp.data) === guardnum) {
        const { setmangry } = await import('./uhitm.js');
        await setmangry(mtmp, true);
    }
}
// C ref: role.c roles[].guardnum, read through gu.urole.  Not modelled on
// game.urole yet, in which case there is nothing to compare against and the
// callbacks above become no-ops rather than acting on the wrong species.
function urole_guardnum() {
    const g = game.urole?.guardnum;
    return (g == null) ? null : g;
}

// ── mon.c:3421 set_ustuck() ─────────────────────────────────────────────────
// The single writer of u.ustuck.  Fourteen sites in this port open-code it.
// The disp.botl set is load-bearing: rows 22/23 only change when bot() next
// runs, so the release point decides which screen shows the change.
export function set_ustuck(mtmp) {
    const u = game.u;
    if (!u) return;
    if (game.iflags?.sanity_check || game.iflags?.debug_fuzzer) {
        if (mtmp && !m_next2u(mtmp))
            impossible(`Sticking to a monster at distu ${mdistu(mtmp)}?`)
                .catch(() => {});
    }
    if (game.disp) game.disp.botl = true;
    u.ustuck = mtmp;
    if (!u.ustuck) {
        u.uswallow = 0;
        u.uswldtim = 0;
    }
}

// ── mon.c:3748 mon_to_stone() ───────────────────────────────────────────────
// Turn a golem into a stone golem; only valid when poly_when_stoned() is true.
export async function mon_to_stone(mtmp) {
    if (mtmp.data?.mcls === S_GOLEM_C) {
        /* it's a golem, and not a stone golem */
        if (canseemon_shared(mtmp))
            await pline(`${Monnam(mtmp)} solidifies...`);
        if (newcham(mtmp, monster_by_pmidx(PM('stone golem')))) {
            if (canseemon_shared(mtmp))
                await pline(`Now it's ${an_mon(mtmp.data?.name || 'golem')}.`);
        } else {
            if (canseemon_shared(mtmp))
                await pline('... and returns to normal.');
        }
    } else {
        await impossible(`Can't polystone ${mtmp.data?.name}!`);
    }
}

// ── mon.c:3766 vamp_stone() ─────────────────────────────────────────────────
// Returns true if the monster really does petrify.
export async function vamp_stone(mtmp) {
    if (is_vampshifter(mtmp)) {
        const mndx = mtmp.cham;
        const x = mtmp.mx, y = mtmp.my;

        /* this only happens if shapeshifted */
        if (mndx >= LOW_PM && mndx !== monsndx(mtmp.data) && !genocided_pm(mndx)) {
            const { x_monnam, canspotmon } = await import('./uhitm.js');
            const { Amonnam, ARTICLE_NONE, SUPPRESS_SADDLE,
                SUPPRESS_HALLUCINATION, SUPPRESS_INVISIBLE, SUPPRESS_IT }
                = await import('./do_name.js');
            const { surface } = await import('./dungeon.js');

            /* construct the format string BEFORE the transformation */
            const buf = 'The lapidifying '
                + `${x_monnam(mtmp, ARTICLE_NONE, null,
                              SUPPRESS_SADDLE | SUPPRESS_HALLUCINATION
                              | SUPPRESS_INVISIBLE | SUPPRESS_IT, false)} `
                + `${amorphous_m(mtmp.data) ? 'coalesces on the'
                    : is_flyer_m(mtmp.data) ? 'drops to the'
                    : 'writhes on the'} ${surface(x, y)}`;
            mtmp.mcanmove = 1;
            mtmp.mfrozen = 0;
            set_mon_min_mhpmax(mtmp, 10); /* mhpmax = max(m_lev+1, 10) */
            mtmp.mhp = mtmp.mhpmax;
            /* can happen if it was previously a fog cloud */
            if (engulfing_u(mtmp)) {
                const { expels } = await import('./mhitu.js');
                await expels(mtmp, mtmp.data, false);
            }
            if (amorphous_m(mtmp.data) && closed_door_at(mtmp.mx, mtmp.my)) {
                const cc = enexto_spawn(mtmp.mx, mtmp.my, monster_by_pmidx(mndx));
                if (cc) {
                    const { rloc_to } = await import('./teleport.js');
                    await rloc_to(mtmp, cc.x, cc.y);
                }
            }
            if (canspotmon(mtmp)) {
                await pline(`${buf}!`);
                /* C: display_nhwindow(WIN_MESSAGE, FALSE) — flush the message
                   window so the two halves land on separate lines. */
            }
            newcham(mtmp, monster_by_pmidx(mndx));
            mtmp.cham = (monsndx(mtmp.data) === mndx) ? NON_PM : mndx;
            if (canspotmon(mtmp))
                await pline(`${Amonnam(mtmp)} rises from the`
                    + ` ${surface(mtmp.mx, mtmp.my)} with renewed agility!`);
            newsym(mtmp.mx, mtmp.my);
            return false; /* didn't petrify */
        }
    } else if (ismnum(mtmp.cham)
               && ((monster_by_pmidx(mtmp.cham)?.mresists | 0) & MR_STONE)) {
        /* sandestins are stoning-immune, so stoning damage reverts them to
           their innate shape rather than making a statue */
        mtmp.mcanmove = 1;
        mtmp.mfrozen = 0;
        set_mon_min_mhpmax(mtmp, 10); /* mhpmax = max(m_lev+1, 10) */
        mtmp.mhp = mtmp.mhpmax;
        newcham(mtmp, monster_by_pmidx(mtmp.cham)); /* C: NC_SHOW_MSG */
        newsym(mtmp.mx, mtmp.my);
        return false; /* didn't petrify */
    }
    return true;
}

// ── mon.c:3864 ok_to_obliterate() ───────────────────────────────────────────
// Monsters elemental_clog() must not delete.
export function ok_to_obliterate(mtmp) {
    const mndx = monsndx(mtmp.data);
    if (mndx === PM('Wizard of Yendor') || is_rider_pm(mndx)
        || has_emin(mtmp) || has_epri(mtmp) || has_eshk(mtmp)
        || mtmp === game.u?.ustuck || mtmp === game.u?.usteed)
        return false;
    return true;
}

// ── mon.c:3878 elemental_clog() ─────────────────────────────────────────────
// Endgame overcrowding relief: obliterate the least valuable other monster and
// move 'mon' into its square, or push 'mon' down to the next plane.
// The rn2(2) sits inside a short-circuit: `!msgmv || rn2(2)` SKIPS the draw the
// first time (msgmv == 0) and draws on every later visit.
let _elemental_clog_msgmv = 0;
export async function elemental_clog(mon) {
    let m_lev = 0;
    let m1 = null, m2 = null, m3 = null, m4 = null, m5 = null;
    const zm = null;

    if (!In_endgame(game.u?.uz))
        return;
    if (!_elemental_clog_msgmv
        || ((game.moves | 0) - _elemental_clog_msgmv) > 200) {
        if (!_elemental_clog_msgmv || rn2(2))
            await pline('You feel besieged.');
        _elemental_clog_msgmv = game.moves | 0;
    }
    /*
     * m1 an elemental from another plane.
     * m2 an elemental from this plane.
     * m3 the least powerful monster encountered in the loop so far.
     * m4 some other non-tame monster.
     * m5 a pet.
     */
    const { mon_has_amulet } = await import('./wizard.js');
    for (const mtmp of fmonOrder()) {
        if (DEADMONSTER(mtmp) || mtmp === mon)
            continue;
        if (mtmp.mx === 0 && mtmp.my === 0)
            continue;
        if (mon_has_amulet(mtmp) || !ok_to_obliterate(mtmp))
            continue;
        if (mtmp.data?.mcls === S_ELEMENTAL_C) {
            if (!is_home_elemental(mtmp.data)) {
                if (!m1) m1 = mtmp;
            } else {
                if (!m2) m2 = mtmp;
            }
        } else if (!mtmp.mtame) {
            if (!m_lev || (mtmp.m_lev | 0) < m_lev) {
                m_lev = mtmp.m_lev | 0;
                m3 = mtmp;
            } else if (!m4) {
                m4 = mtmp;
            }
        } else {
            if (!m5) m5 = mtmp;
            break;
        }
    }
    const victim = m1 || m2 || m3 || m4 || m5 || zm;
    if (victim) {
        const mx = victim.mx, my = victim.my;

        victim.mstate = (victim.mstate | 0) | MON_OBLITERATE;
        /* C ref: mon.c:3933 mongone(mtmp) — js/muse.js and js/vault.js both
           carry a private copy; m_detach(due_to_death=FALSE) is its core. */
        await m_detach(victim, victim.data, false);
        /* C leaves victim->mx,my alone: other code still reads them */
        const { rloc_to } = await import('./teleport.js');
        await rloc_to(mon, mx, my);           /* note: mon, not victim */

    /* last resort: migrate mon to the next plane */
    } else if (!Is_astralevel(game.u?.uz)) {
        const dest = { ...game.u.uz };
        dest.dlevel -= 1;
        mon.mstate = (mon.mstate | 0) | MON_ENDGAME_MIGR;
        await migrate_mon_local(mon, dest, MIGR_RANDOM);
    }
}
// C ref: mon.c:3843 migrate_mon(mtmp, target_lev, xyloc).  js/artifact.js has a
// copy; this one keeps the two steps that have no port NAMED.
async function migrate_mon_local(mtmp, dest, xyloc) {
    /*
     * If mtmp->mx is zero this was a failed arrival from an earlier migration
     * and mtmp isn't on the map, so it can't be holding the hero and will
     * already have dropped its special objects.
     */
    if (mtmp.mx) {
        if (game.u?.ustuck === mtmp) {
            set_ustuck(null);
            const { unstuck_mspec_used } = await import('./uhitm.js');
            unstuck_mspec_used(mtmp);
        }
        /* C ref: mon.c:3858 mdrop_special_objs(mtmp) — unported; it drops the
           Amulet and the invocation items so they can't leave the level. */
    }
    /* C ref: dungeon.c migrate_to_level(mtmp, ledger_no(dest), xyloc, 0) —
       js/muse.js's copy takes only the monster, and ledger_no() lives in
       js/bones.js (module-private).  Both the ledger number and the MIGR_*
       placement are therefore named rather than approximated. */
    void dest; void xyloc;
}

// ── mon.c:3986 deal_with_overcrowding() ─────────────────────────────────────
export async function deal_with_overcrowding(mtmp) {
    if (In_endgame(game.u?.uz)) {
        await elemental_clog(mtmp);
    } else {
        /* C ref: mon.c:3834 m_into_limbo(mtmp) — migrate to the CURRENT level;
           js/vault.js has a copy. */
        mtmp.mstate = (mtmp.mstate | 0) | MON_LIMBO;
        await migrate_mon_local(mtmp, game.u?.uz, MIGR_APPROX_XY);
    }
}

// ── mon.c:4031 mnearto() ────────────────────────────────────────────────────
// Put a monster at (or near) a location.  2 = another monster was moved out of
// the way, 1 = relocated (also when already there), 0 = failed.  Recurses once
// at most: the nested call always passes move_other == false.
export async function mnearto(mtmp, x, y, move_other, rlocflags) {
    let othermon = null;
    let res = 1;

    if (mtmp.mx === x && mtmp.my === y && m_at(x, y) === mtmp)
        return res;

    if (move_other && (othermon = m_at(x, y)) != null) {
        /* take othermon off the map; it might come straight back, but for the
           moment it is leaving */
        await mon_leaving_level(othermon);
        othermon.mx = 0; othermon.my = 0; /* 'othermon' is not on the map */
        othermon.mstate = (othermon.mstate | 0) | MON_OFFMAP;
    }

    let newx = x, newy = y;
    const { goodpos, rloc_to } = await import('./teleport.js');
    if (!goodpos(newx, newy, mtmp, 0)) {
        /* real trouble if enexto ever fails: migrating_mons that need placing
           cause no end of problems */
        const mm = enexto_spawn(newx, newy, mtmp.data);
        if (!mm || !isok(mm.x, mm.y)) {
            if (othermon) {
                /* othermon's mx,my were zeroed above, so a bare `return 0`
                   would shortly trip a sanity check; the caller only knows
                   about mtmp, not othermon */
                await deal_with_overcrowding(othermon);
            }
            return 0;
        }
        newx = mm.x;
        newy = mm.y;
    }
    /* C: rloc_to_flag(mtmp, newx, newy, rlocflags); this doesn't honor the
       'montelecontrol' option, and js/teleport.js has no flag-taking form. */
    await rloc_to(mtmp, newx, newy);
    void rlocflags;

    if (move_other && othermon) {
        res = 2; /* moving another monster out of the way */
        /* 'move_other'==FALSE this time: fail rather than recurse */
        if (!await mnearto(othermon, x, y, false, rlocflags))
            await deal_with_overcrowding(othermon);
    }

    return res;
}

// ── mon.c:4109 m_respond_medusa() ───────────────────────────────────────────
// Medusa's response to a player action: gaze at the hero.
export async function m_respond_medusa(mtmp) {
    const rows = mattk_of(mtmp.data) || [];
    for (let i = 0; i < NATTK_MON; i++) {
        if (rows[i] && rows[i].aatyp === AT_GAZE) {
            const { gazemu } = await import('./mhitu.js');
            await gazemu(mtmp, rows[i]);
            break;
        }
    }
}

// ── mon.c:4135 qst_guardians_respond() ──────────────────────────────────────
// How the quest guardians react when the hero attacks the quest leader.
export async function qst_guardians_respond() {
    const q_guardian_idx = urole_guardnum();
    if (q_guardian_idx == null) return;
    let got_mad = 0;

    /* guardians sense the attack even when they can't see it */
    for (const mon of fmonOrder()) {
        if (DEADMONSTER(mon))
            continue;
        if (monsndx(mon.data) === q_guardian_idx && mon.mpeaceful) {
            mon.mpeaceful = 0;
            if (canseemon_shared(mon))
                ++got_mad;
        }
    }
    if (got_mad && !Hallucination_mon()) {
        const { makeplural } = await import('./invent.js');
        let who = monster_by_pmidx(q_guardian_idx)?.name || 'guardian';
        if (got_mad > 1) who = makeplural(who);
        await pline(`The ${who} ${got_mad > 1 ? 'appear' : 'appears'}`
            + ' to be angry too...');
    }
}
// C ref: quest.c quest_info(MS_LEADER) — the hero's role-specific quest leader
// species.  js/quest.js does not expose it and game.urole carries no ldrnum, so
// the peaceful-leader arm of peacefuls_respond() below has nothing to match and
// falls through, rather than matching the wrong species.
function quest_leader_pm() {
    const v = game.urole?.ldrnum;
    return (v == null) ? null : v;
}

// ── mon.c:4163 peacefuls_respond() ──────────────────────────────────────────
// How the OTHER peacefuls react when the hero attacks a peaceful monster.
// RNG order in the humanoid arm: rn2(5) (gasp) -> rn2(10) (mlevel) ->
// monflee's rn2(50)+25.  In the same-class arm: rn2(3) -> rn2(4) (growl) ->
// rn2(6) -> monflee's rn2(25)+15.  Each draw is gated by the RNG-free guards
// above it, so those guards have to be exact.
export async function peacefuls_respond(mtmp) {
    const mndx = monsndx(mtmp.data);

    for (const mon of fmonOrder()) {
        if (DEADMONSTER(mon))
            continue;
        if (mon === mtmp) /* the mpeaceful test catches this since mtmp is no
                             longer peaceful, but be explicit... */
            continue;

        if (!mindless(mon.data) && mon.mpeaceful
            && couldsee(mon.mx, mon.my) && !mon.msleeping
            && mon.mcansee && m_canseeu(mon)) {
            let buf = '';
            let exclaimed = false, needpunct = false, alreadyfleeing;

            if (humanoid(mon.data) || mon.isshk || mon.ispriest) {
                if (is_watch_m(mon.data)) {
                    await verbalize_mon("Halt!  You're under arrest!");
                    /* C ref: mon.c:4185 angry_guards(!!Deaf) — js/dokick.js,
                       js/fountain.js and js/shkroom.js each carry a private
                       copy, so the call is named rather than duplicated. */
                } else {
                    if (!Deaf() && !rn2(5)) {
                        /* C ref: sounds.c maybe_gasp(mon) — unported.  It picks
                           one of several exclamations and DRAWS while doing so,
                           so gasp stays null and the buf/exclaimed bookkeeping
                           below is skipped rather than half-faked. */
                        const gasp = null;
                        if (gasp) {
                            if (/^gasp/i.test(gasp)) {
                                buf = `${Monnam(mon)} gasps`;
                                needpunct = true;
                            } else {
                                buf = `${Monnam(mon)} exclaims "${gasp}"`;
                            }
                            exclaimed = true;
                        }
                    }
                    /* shopkeepers and temple priests might gasp in surprise but
                       won't become angry here; the quest leader only gets angry
                       if the hero attacks his own quest guardians */
                    const leader_idx = quest_leader_pm();
                    const guardnum = urole_guardnum();
                    if (mon.isshk || mon.ispriest
                        || (leader_idx != null && monsndx(mon.data) === leader_idx
                            && mndx !== guardnum)) {
                        if (exclaimed)
                            await pline(`${buf} then shrugs.`);
                        continue;
                    }

                    if ((mon.data?.mlevel | 0) < rn2(10)
                        /* don't have quest guardians turn to flee */
                        && monsndx(mon.data) !== guardnum) {
                        alreadyfleeing = !!(mon.mflee || mon.mfleetim);
                        await monflee(mon, rn2(50) + 25, true, !exclaimed);
                        if (exclaimed) {
                            if (game.flags?.verbose && !alreadyfleeing) {
                                buf += ' and then turns to flee.';
                                needpunct = false;
                            }
                        } else {
                            exclaimed = true; /* got a msg from monflee() */
                        }
                    }
                    if (buf)
                        await pline(`${buf}${needpunct ? '.' : ''}`);
                    if (mon.mtame) {
                        /* mustn't clear mpeaceful as below; perhaps reduce
                           tameness? */
                    } else {
                        mon.mpeaceful = 0;
                        mon.mstrategy = (mon.mstrategy | 0) & ~STRAT_WAITMASK;
                        const { adjalign } = await import('./attrib.js');
                        adjalign(-1);
                        if (!exclaimed)
                            await pline(`${Monnam(mon)} gets angry!`);
                    }
                }
            } else if (mon.data?.mcls === mtmp.data?.mcls
                       && big_little_match_mon(mndx, monsndx(mon.data))
                       && !rn2(3)) {
                if (!rn2(4)) {
                    const { growl } = await import('./sounds.js');
                    await growl(mon);
                    exclaimed = (game.iflags?.last_msg === 'PLNMSG_GROWL');
                }
                if (rn2(6)) {
                    alreadyfleeing = !!(mon.mflee || mon.mfleetim);
                    await monflee(mon, rn2(25) + 15, true, !exclaimed);
                    if (exclaimed && !alreadyfleeing)
                        /* worded as its own sentence so we don't have to poke
                           around inside growl() */
                        await pline('And then starts to flee.');
                }
            }
        }
    }
}
// C ref: makemon.c big_little_match(montype, magic) — true when the two indices
// are the small and large form of one species (or the same species).
// js/makemon.js's little_to_big / big_to_little are module-private, so only the
// identity case — which is the common one — can be answered here.
function big_little_match_mon(a, b) {
    return a === b;
}

// ── mon.c:4374 wake_nearto_core() ───────────────────────────────────────────
// Wake monsters near a location.  distance == 0 means "the whole level".  No
// RNG, but clearing msleeping decides whether each monster runs a whole
// dochug() (and therefore all of its m_move draws) next turn.
export async function wake_nearto_core(x, y, distance, petcall) {
    for (const mtmp of fmonOrder()) {
        if (DEADMONSTER(mtmp))
            continue;
        if (distance === 0 || dist2(mtmp.mx, mtmp.my, x, y) < distance) {
            /* "sleep for N turns" uses mfrozen, but so does paralysis, so
               mfrozen monsters are left alone */
            await wake_msg_core(mtmp, false);
            mtmp.msleeping = 0; /* wake indeterminate sleep */
            if (!((mtmp.data?.geno | 0) & G_UNIQ_M))
                mtmp.mstrategy = (mtmp.mstrategy | 0) & ~STRAT_WAITMASK;
            if (game.context?.mon_moving || !petcall)
                continue;
            if (mtmp.mtame) {
                if (!mtmp.isminion && EDOG(mtmp))
                    EDOG(mtmp).whistletime = game.moves | 0;
                /* fix up a pet who is stuck "fleeing" its master */
                mtmp.mtrack = []; /* C: mon_track_clear(mtmp) */
            }
        }
    }
    /* C ref: zombie.c disturb_buried_zombies(x, y) — js/monmove.js:4296 models
       it as a no-op (this port has no buried monsters). */
}

// ── mon.c:4431 normal_shape() ───────────────────────────────────────────────
// Force one monster back to its natural shape.  Split out of rescham() so
// restore_cham() can share it.  newcham() DRAWS.
export async function normal_shape(mon) {
    const mcham = mon.cham | 0;

    if (ismnum(mcham)) {
        const mcan = mon.mcan;

        newcham(mon, monster_by_pmidx(mcham)); /* C: NC_SHOW_MSG */
        mon.cham = NON_PM;
        /* newcham() may uncancel a polymorphing monster; override that */
        if (mcan) mon.mcan = 1;
        newsym(mon.mx, mon.my);
    }
    if (is_were(mon.data) && mon.data?.mcls !== S_HUMAN_C)
        await new_were_pub(mon);
    if (M_AP_TYPE(mon) !== MAP_NOTHING) {
        /* this used to include a cansee() check, but
           Protection_from_shape_changers shouldn't be trumped by being unseen */
        if (!mon.meating) {
            /* a revealed mimic falls asleep in lieu of a shape change */
            if (M_AP_TYPE(mon) !== MAP_MONSTER)
                mon.msleeping = 1;
            const { seemimicLocal } = await import('./uhitm.js');
            seemimicLocal(mon);
        } else {
            /* quickmimic: a pet part way through a mimic corpse ends the meal
               early.  C ref: dogmove.c finish_meating(mon), js/dogmove.js:2300
               (module-private), which also clears m_ap_type/mappearance. */
            mon.meating = 0;
        }
    }
}
// new_were() is this file's own (private) port, and normal_shape is its only
// new caller; a thin alias keeps that function untouched.
async function new_were_pub(mon) { await new_were(mon); }
// mhitu.c invokes the same form swap from summonmu(); export a lazy-cycle-safe
// wrapper rather than duplicating were.c's message/healing/armor behavior.
export async function new_were_for_mhitu(mon) { await new_were(mon); }

// ── mon.c:4471 alloc_itermonarr() ───────────────────────────────────────────
// C keeps one reusable struct monst *[] between monster-movement loops,
// overallocating by 20 and releasing it when the request is 0 or shrinks by
// more than 40.  The sizing rules are kept so iter_mons_safe() reads as C's.
let _itermonarr = null;
let _itermonsiz = 0;
export function alloc_itermonarr(count) {
    /* release when count is 0, bigger than itermonsiz, or much smaller */
    if (!count || count > _itermonsiz || count + 40 < _itermonsiz) {
        _itermonarr = null;
        _itermonsiz = 0;
    }
    /* allocate when count exceeds itermonsiz (implies count > 0) */
    if (count > _itermonsiz) {
        /* overallocate to reduce thrashing as the monster count varies */
        _itermonsiz = count + 20;
        _itermonarr = new Array(_itermonsiz);
    }
}

// ── mon.c:4500 iter_mons_safe() ─────────────────────────────────────────────
// Visit EVERY monster on the level — dead and off-map ones included — calling
// bfunc; stop early if it returns true.  Safe against insertions and deletions
// because the list is snapshotted first, which is what mon.js's movemon_pass()
// already does for the same reason.
export async function iter_mons_safe(bfunc) {
    const snapshot = fmonOrder();
    const nmons = snapshot.length;

    /* make sure itermonarr[] is big enough to hold nmons entries */
    alloc_itermonarr(nmons);

    if (nmons) {
        for (let i = 0; i < nmons; i++) _itermonarr[i] = snapshot[i];
        for (let i = 0; i < nmons; i++) {
            if (await bfunc(_itermonarr[i]))
                break;
        }
    }
}

// ── mon.c:4527 iter_mons() ──────────────────────────────────────────────────
// Visit every LIVING, on-map monster.  C reads mtmp->nmon before calling vfunc
// so the callback may unlink the monster it was handed; the snapshot from
// fmonOrder() does the same job.
export async function iter_mons(vfunc) {
    for (const mtmp of fmonOrder()) {
        if (DEADMONSTER(mtmp) || mon_offmap(mtmp))
            continue;
        await vfunc(mtmp);
    }
}

// ── mon.c:4621 rescham() ────────────────────────────────────────────────────
// Every chameleon and mimic becomes itself and every werecreature reverts to
// human form; called when Protection_from_shape_changers is activated.
export async function rescham() {
    await iter_mons(normal_shape);
}

// ── mon.c:4627 m_restartcham() ──────────────────────────────────────────────
export function m_restartcham(mtmp) {
    if (!mtmp.mcan)
        mtmp.cham = pm_to_cham(monsndx(mtmp.data));
    if (mtmp.data?.mcls === S_MIMIC && mtmp.msleeping) {
        set_mimic_sym(mtmp);        /* DRAWS — see restrap()'s note above */
        newsym(mtmp.mx, mtmp.my);
    }
}

// ── mon.c:4640 restartcham() ────────────────────────────────────────────────
// Let chameleons change and mimics hide again; called when the ring of
// protection from shape changers comes off.
export async function restartcham() {
    await iter_mons(m_restartcham);
}

// ── mon.c:4649 restore_cham() ───────────────────────────────────────────────
// Called when restoring a monster from a saved level: the protection state may
// differ from what it was when the level was written out.
export async function restore_cham(mon) {
    if (Protection_from_shape_changers() || mon.mcan) {
        /* force a chameleon or mimic back to its natural shape */
        await normal_shape(mon);
    } else if (mon.cham === NON_PM) {
        /* the chameleon doesn't change shape here, it just becomes able to */
        mon.cham = pm_to_cham(monsndx(mon.data));
    }
}

// ── mon.c:4983 isspecmon() ──────────────────────────────────────────────────
// Non-shapechangers that warrant special polymorph handling.
export function isspecmon(mon) {
    return !!(mon.isshk || mon.ispriest || mon.isgd
              || (game.quest_status?.leader_m_id != null
                  && mon.m_id === game.quest_status.leader_m_id));
}

// ── mon.c:5015 valid_vampshiftform() ────────────────────────────────────────
// Used for hero polyself handling.
export function valid_vampshiftform(base, form) {
    if (base >= LOW_PM && is_vampire_m(monster_by_pmidx(base))) {
        if (form === PM('vampire bat') || form === PM('fog cloud')
            || (form === PM('wolf') && base !== PM_VAMPIRE))
            return true;
    }
    return false;
}

// ── mon.c:5028 validvamp() ──────────────────────────────────────────────────
// Keep a wizard-mode monpolycontrol answer to a legal vampshifter shape.
// C passes mndx by pointer; here it is returned alongside the boolean as
// { ok, mndx } so the caller can see both halves.
export function validvamp(mon, mndx, monclass) {
    /* simplify the caller's usage */
    if (!is_vampshifter(mon))
        return { ok: !!validspecmon_local(mon, mndx), mndx };

    if (mon.cham === PM_VLAD_THE_IMPALER && mon_has_special_local(mon)) {
        /* Vlad with the Candelabrum: override the choice, then accept it */
        return { ok: true, mndx: PM_VLAD_THE_IMPALER };
    }
    if (ismnum(mndx) && is_shapeshifter_m(monster_by_pmidx(mndx))) {
        /* the player picked some kind of shapeshifter; use mon's own self
           (vampire or chameleon) */
        return { ok: true, mndx: mon.cham };
    }
    /* basic vampires can't become wolves; any of them can become fog or a bat
       (upper-case-only on the rogue level is not enforced here) */
    if (mndx === PM('wolf'))
        return { ok: mon.cham !== PM_VAMPIRE, mndx };
    if (mndx === PM('fog cloud') || mndx === PM('vampire bat'))
        return { ok: true, mndx };

    /* the specific type was no good; try by class */
    switch (monclass) {
    case S_VAMPIRE:
        mndx = mon.cham;
        break;
    case S_BAT_C:
        mndx = PM('vampire bat');
        break;
    case S_VORTEX_C:
        mndx = PM('fog cloud');
        break;
    case S_DOG_C:
        if (mon.cham !== PM_VAMPIRE) {
            mndx = PM('wolf');
            break;
        }
        /* FALLTHRU */
    default:
        mndx = NON_PM;
        break;
    }
    return { ok: mndx !== NON_PM, mndx };
}
// C ref: mon.c:4993 validspecmon(mon, mndx).  js/makemon.js:2978 has it, and
// js/makemon.js:2991 accept_newcham_form(), but both are module-private; the
// geno'd/!polyok gate is therefore NAMED rather than re-derived, because a
// wrong answer here would admit an illegal form.
function validspecmon_local(mon, mndx) {
    if (mndx === NON_PM)
        return true; /* caller wants random */
    /* C ref: mon.c:4998 `if (!accept_newcham_form(mon, mndx)) return FALSE;` */
    if (isspecmon(mon)) {
        const ptr = monster_by_pmidx(mndx);
        /* reject notake (object manipulation is expected) and nohead (speech
           capability is expected).  C's own note: should we check msound too? */
        if (notake(ptr) || !has_head_m(ptr))
            return false;
    }
    return true; /* the potential new form is ok */
}
// C ref: muse.c mon_has_special(mon) — the Amulet, the Bell, the Candelabrum or
// the Book.  js/muse.js:451 reduces it to mon_has_amulet(); the full test is
// what validvamp()'s Vlad arm needs, so it is spelled out.
function mon_has_special_local(mon) {
    return (mon.minvent || []).some((o) => o.otyp === CANDELABRUM_OTYP
        || o.otyp === BELL_OF_OPENING || o.otyp === BOOK_OF_THE_DEAD_OTYP);
}

// ── mon.c:5078 wiz_force_cham_form() ────────────────────────────────────────
// The wizard-mode 'monpolycontrol' prompt: five tries at getlin(), then fall
// back to a random form (or, for a vampshifter, pickvampshape).
export async function wiz_force_cham_form(mon) {
    let monclass = 0, mndx = NON_PM;
    const { noit_mon_nam } = await import('./do_name.js');

    /* the prompt is built in two pieces and clipped to QBUFSZ-1 overall; if it
       is too long that has to be the monster's name, so that is what is cut */
    const QBUFSZ = 128;
    let pprompt = `Change ${noit_mon_nam(mon)}`;
    /* C ref: getpos.c coord_desc(..., GPCOORDS_MAP) — "<x,y>" */
    const parttwo = ` @ <${mon.mx},${mon.my}> into what?`;
    if (pprompt.length + parttwo.length >= QBUFSZ)
        pprompt = pprompt.slice(0, QBUFSZ - 1 - parttwo.length);
    pprompt += parttwo;

    const TRYLIMIT = 5;
    let tryct = TRYLIMIT;
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    do {
        if (tryct === TRYLIMIT - 1) { /* first retry */
            /* change "into what?" to "into what kind of monster?" */
            if (pprompt.length + ' kind of monster'.length < QBUFSZ)
                pprompt = `${pprompt.slice(0, -1)} kind of monster?`;
        }
        monclass = 0;
        const buf = (await hooked_tty_getlin(pprompt, null)) ?? '';
        /* for ESC, take the form selected above (might be NON_PM) */
        if (buf.charCodeAt(0) === 27)
            break;
        /* for "*", use NON_PM to pick an arbitrary shape below */
        if (buf === '*' || buf.toLowerCase() === 'random') {
            mndx = NON_PM;
            break;
        }
        mndx = name_to_pmidx(buf.replace(/\s+/g, ' ').trim()); /* C: name_to_mon */
        if (mndx === NON_PM) {
            /* C ref: mon.c:5124 `monclass = name_to_monclass(buf, &mndx); if
               (monclass && mndx == NON_PM) mndx = mkclass_poly(monclass);` —
               js/polyself.js has both, module-private, so the CLASS half of the
               prompt has nothing to resolve against. */
            monclass = 0;
        }
        if (ismnum(mndx)) {
            /* got a specific type of monster; use it if we can */
            const v = validvamp(mon, mndx, monclass);
            mndx = v.mndx;
            if (v.ok)
                break;
            /* can't; revert to random in case we exhaust tryct */
            mndx = NON_PM;
        }
        await pline("It can't become that.");
    } while (--tryct > 0);

    if (!tryct)
        await pline(thats_enough_tries);
    if (is_vampshifter(mon)) {
        const v = validvamp(mon, mndx, monclass);
        mndx = v.ok ? v.mndx : pickvampshape_pub(mon); /* not arbitrary */
    }
    return mndx;
}

// ── mon.c:5569 egg_type_from_parent() ───────────────────────────────────────
// The type of egg laid by #sit; usually the parent's own type.  The caller is
// responsible for the lays_eggs() check.
// C ref: mon.c BREEDER_EGG == !gi.in_mklev, so during level creation the queen
// bee / winged gargoyle downgrade applies and afterwards it does not.
export function egg_type_from_parent(mnum, force_ordinary) {
    const BREEDER_EGG = !game.in_mklev;
    if (force_ordinary || !BREEDER_EGG) {
        if (mnum === PM('queen bee'))
            mnum = PM('killer bee');
        else if (mnum === PM('winged gargoyle'))
            mnum = PM('gargoyle');
    }
    return mnum;
}

// ── mon.c:5609 kill_eggs() ──────────────────────────────────────────────────
// Kill off any eggs of genocided monsters in one object list, recursing into
// containers.  obj_list is this port's array flavour of C's nobj chain.
export async function kill_eggs(obj_list) {
    for (const otmp of (obj_list || [])) {
        if (otmp.otyp === EGG) {
            if (dead_species(otmp.corpsenm, true)) {
                /* C ref: timeout.c kill_egg(otmp) — unported; it stops the
                   hatch timer and marks the egg dead.  No RNG.  (C's own note:
                   this could be caught at hatch time instead of searching every
                   objlist.) */
                otmp.corpsenm = NON_PM;
            }
        } else if (Has_contents(otmp)) {
            await kill_eggs(otmp.cobj);
        }
    }
}

// ── mon.c:5639 kill_genocided_monsters() ────────────────────────────────────
// Called during a genocide, and again on every level change so that migrating
// monsters are caught as they arrive (and deposit their possessions there).
//
// Chameleon handling:
//  1) if chameleons themselves have been genocided, destroy them whatever form
//     they are currently in;
//  2) otherwise force every chameleon imitating a genocided species to take a
//     new form — which DRAWS (newcham).
export async function kill_genocided_monsters() {
    for (const mtmp of fmonOrder()) {
        if (DEADMONSTER(mtmp))
            continue;
        const mndx = monsndx(mtmp.data);
        const kill_cham = (ismnum(mtmp.cham) && genocided_pm(mtmp.cham));
        if (genocided_pm(mndx) || kill_cham) {
            if (ismnum(mtmp.cham) && !kill_cham) {
                newcham(mtmp, null);            /* C: NC_SHOW_MSG */
            } else {
                /* C ref: mon.c:3081 mondead(mtmp) — js/muse.js has a private
                   copy; the pieces of it that live in this file are
                   mvitals_died() and m_detach(due_to_death=TRUE).  The
                   lifesaving / vamprises / make_corpse arms of mondead() are
                   NOT reproduced here. */
                mvitals_died(mtmp);
                await m_detach(mtmp, mtmp.data, true);
            }
        }
        if (mtmp.minvent?.length)
            await kill_eggs(mtmp.minvent);
    }

    await kill_eggs(game.invent);
    await kill_eggs(game.level?.objects);         /* C: fobj */
    await kill_eggs(game.migrating_objs);
    await kill_eggs(game.level?.buriedobjlist);
}

// ── mon.c:5763 pacify_guard() / mon.c:5770 pacify_guards() ──────────────────
export function pacify_guard(mtmp) {
    if (is_watch_m(mtmp.data))
        mtmp.mpeaceful = 1;
}
export async function pacify_guards() {
    await iter_mons(pacify_guard);
}

// ── mon.c:5776 mimic_hit_msg() ──────────────────────────────────────────────
// A healing spell cast at a mimic disguised as an object brightens the object.
export async function mimic_hit_msg(mtmp, otyp) {
    const ap = mtmp.mappearance;

    switch (M_AP_TYPE(mtmp)) {
    case MAP_NOTHING:
    case MAP_FURNITURE:
    case MAP_MONSTER:
        break;
    case MAP_OBJECT:
        if (otyp === SPE_HEALING_OTYP || otyp === SPE_EXTRA_HEALING_OTYP) {
            const { simple_typename } = await import('./invent.js');
            const color = C_OBJ_COLORS_M[OBJECTS[ap]?.oc_color | 0];
            await pline(`${The_mon(simple_typename(ap))} seems a more vivid`
                + ` ${color} than before.`);
        }
        break;
    default:
        break;
    }
}

// ── mon.c:5796 usmellmon() ──────────────────────────────────────────────────
// Whether the hero (in a form with a sense of smell) notices a monster's
// odour.  No RNG; returns true if a message was given.
// C's switch has three deliberately SILENT groups — the demon lords, the three
// unicorns and the jellyfish — which exist only to keep those species out of
// the `default: nonspecific = TRUE` arm below.
export async function usmellmon(mdat) {
    let nonspecific = false;
    let msg_given = false;

    if (!mdat) return false;
    const { olfaction } = await import('./eat.js');
    if (!olfaction(game.youmonst?.data ?? game.u?.data))
        return false;
    const mndx = monsndx(mdat);

    if (mndx === PM('rothe') || mndx === PM('minotaur')) {
        await pline('You notice a bovine smell.');
        msg_given = true;
    } else if (mndx === PM('caveman') || mndx === PM('barbarian')
               || mndx === PM('neanderthal')) {
        await pline('You smell body odor.');
        msg_given = true;
    } else if (mndx === PM('horned devil') || mndx === PM('balrog')
               || mndx === PM('Asmodeus') || mndx === PM('Dispater')
               || mndx === PM('Yeenoghu') || mndx === PM('Orcus')) {
        /* silent, and kept out of the nonspecific default */
    } else if (mndx === PM('human werejackal') || mndx === PM('human wererat')
               || mndx === PM('human werewolf') || mndx === PM('werejackal')
               || mndx === PM('wererat') || mndx === PM('werewolf')
               || mndx === PM('owlbear')) {
        await pline("You detect an odor reminiscent of an animal's den.");
        msg_given = true;
    } else if (mndx === PM('steam vortex')) {
        await pline('You smell steam.');
        msg_given = true;
    } else if (mndx === PM('green slime')) {
        await pline('Something stinks.');
        msg_given = true;
    } else if (mndx === PM('violet fungus') || mndx === PM('shrieker')) {
        await pline('You smell mushrooms.');
        msg_given = true;
    } else if (mndx === PM('white unicorn') || mndx === PM('gray unicorn')
               || mndx === PM('black unicorn') || mndx === PM('jellyfish')) {
        /* silent, and kept out of the nonspecific default */
    } else {
        nonspecific = true;
    }

    if (nonspecific) {
        switch (mdat.mcls) {
        case S_DOG_C:
            await pline('You notice a dog smell.');
            msg_given = true;
            break;
        case S_DRAGON:
            await pline('You smell a dragon!');
            msg_given = true;
            break;
        case S_FUNGUS_C:
            await pline('Something smells moldy.');
            msg_given = true;
            break;
        case S_UNICORN_C:
            await pline(`You detect a${(mndx === PM('pony')) ? 'n' : ' strong'}`
                + ' odor reminiscent of a stable.');
            msg_given = true;
            break;
        case S_ZOMBIE_C:
            await pline('You smell rotting flesh.');
            msg_given = true;
            break;
        case S_EEL_MCLS:
            await pline('You smell fish.');
            msg_given = true;
            break;
        case S_ORC_C:
            /* C: maybe_polyd(is_orc(youmonst.data), Race_if(PM_ORC)) */
            if (game.u?.Upolyd ? is_orc_m(game.youmonst?.data)
                               : (game.urace?.mnum === PM('orc')))
                await pline('You notice an attractive smell.');
            else
                await pline('A foul stench makes you feel a little nauseated.');
            msg_given = true;
            break;
        default:
            break;
        }
    }
    return msg_given;
}

// ── mon.c:5915 check_gear_next_turn() ───────────────────────────────────────
// Setting misc_worn_check's I_SPECIAL bit flags a monster to reassess (and
// maybe re-equip) its gear at the start of its next move; this file's
// movemon_singlemon() reads exactly that bit.
export function check_gear_next_turn(mon) {
    mon.misc_worn_check = (mon.misc_worn_check | 0) | I_SPECIAL;
}

// ── mon.c:5971 see_monster_closeup() ────────────────────────────────────────
// Note this monster type as having been seen from close up (and, for a camera
// shot, as photographed).  The Tourist EXP bonus is the only part with a
// gameplay effect; the rest feeds insight.c's lifelist counts.
export async function see_monster_closeup(mtmp, photo) {
    if (Hallucination_mon() || (Blind() && !Blind_telepat_mon()))
        return;

    let mndx = monsndx(mtmp.data);
    if (M_AP_TYPE(mtmp) === MAP_MONSTER && !sensemon(mtmp))
        mndx = mtmp.mappearance;
    if (mndx === PM('long worm') && game.notonhead)
        mndx = PM('long worm tail');

    const lifelist = ((game.context = game.context || {}).lifelist
        = game.context.lifelist
          || { total_seen_upclose: 0, total_photographed: 0 });
    const mv = mvitals_at(mndx);
    if (!mv.seen_close) {
        mv.seen_close = 1;
        lifelist.total_seen_upclose = (lifelist.total_seen_upclose | 0) + 1;
    }

    /* hallucinatory monsters never get here (they aren't recorded); seeing
       invisible doesn't put invisible monsters on photos, and telepathy shows
       hidden monsters without making them photographable */
    if (photo && !mtmp.minvis && !mtmp.mundetected
        && (M_AP_TYPE(mtmp) === MAP_NOTHING || M_AP_TYPE(mtmp) === MAP_MONSTER)) {
        if (M_AP_TYPE(mtmp) === MAP_MONSTER) /* cloned Wizard of Yendor */
            mndx = mtmp.mappearance;

        const mv2 = mvitals_at(mndx);
        if (!mv2.photographed) {
            mv2.photographed = 1;
            lifelist.total_photographed = (lifelist.total_photographed | 0) + 1;

            /* a Tourist earns EXP (but not score) for the first photo of each
               monster type; the starting pet and a worm tail yield no bonus */
            if (game.urole?.mnum === PM('tourist')
                && (mtmp.m_id !== game.context?.startingpet_mid
                    || mndx !== game.context?.startingpet_typ)
                /* the monsndx() check covers the worm tail and a disguised
                   Wizard, for which experience() has no sensible value */
                && mndx === monsndx(mtmp.data)) {
                /* C ref: exper.c experience(mtmp, 0) — js/uhitm.js:1911 has it,
                   module-private, so there is no value to award yet. */
                const { newexplevel } = await import('./exper.js');
                await newexplevel();
            }
        }
    }
}

// ── mon.c:6025 see_nearby_monsters() ────────────────────────────────────────
export async function see_nearby_monsters() {
    if (Hallucination_mon() || (Blind() && !Blind_telepat_mon()))
        return;

    const ux = game.u?.ux | 0, uy = game.u?.uy | 0;
    for (let x = ux - 1; x <= ux + 1; x++)
        for (let y = uy - 1; y <= uy + 1; y++) {
            if (!isok(x, y))
                continue;
            const mtmp = m_at(x, y);
            if (!mtmp)
                continue;
            let mndx = monsndx(mtmp.data);
            if (M_AP_TYPE(mtmp) === MAP_MONSTER)
                mndx = mtmp.mappearance;
            /* skip the closeup handling if this type has already been done */
            if (mvitals_at(mndx).seen_close)
                continue;
            /* a disguised mimic passes canseemon(); an undetected hider does not */
            if (canseemon_shared(mtmp) || (mtmp.mundetected && sensemon(mtmp))) {
                game.bhitpos = { x, y };
                game.notonhead = (x !== mtmp.mx || y !== mtmp.my);
                await see_monster_closeup(mtmp, false);
            }
        }
}

// ── mon.c:6058 shieldeff_mon() ──────────────────────────────────────────────
// A monster resists something: a shield effect at its square plus a message.
// The message does NOT depend on seeing the monster — the shield is visible.
export async function shieldeff_mon(mtmp) {
    /* C ref: display.c shieldeff(x, y) — the four-frame tmp_at() animation.
       Unported (nothing in this port draws temporary glyph animations); it
       consumes no RNG. */
    if (cansee(mtmp.mx, mtmp.my))
        await pline(`${Monnam(mtmp)} resists!`);
}

// ── mon.c:6067 flash_mon() ──────────────────────────────────────────────────
// Flash a monster's glyph in place.  The viz_array override is the same trick
// hide_monst() above uses: it forces the square to count as seen for the
// duration and restores the saved byte afterwards.
export function flash_mon(mtmp) {
    const mx = mtmp.mx, my = mtmp.my;
    let count = couldsee(mx, my) ? 8 : 4;
    const row = game.viz_array?.[my];
    const saveviz = row ? row[mx] : undefined;

    if (!game.flags?.sparkle)
        count = Math.trunc(count / 2);
    if (row) row[mx] |= (VIZ_IN_SIGHT | VIZ_COULD_SEE);
    /* C ref: display.c flash_glyph_at(x, y, mon_to_glyph(mtmp, newsym_rn2),
       count) — neither flash_glyph_at() nor the newsym_rn2 glyph pick (which
       DRAWS off the DISPLAY rng for a hallucinated monster) has a port yet. */
    void count;
    if (row) row[mx] = saveviz;
    newsym(mx, my);
}
