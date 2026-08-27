// teleport.js — C ref: src/teleport.c.
//
// The monster-relocation half of teleport.c: goodpos(), rloc_pos_ok(),
// rloc_to_core(), rloc_to(), rloc() and tele_restrict().  A teleporting monster
// (M1_TPORT: nymph, tengu, leprechaun, succubus) uses these after it acts — a
// nymph that successfully steals from the hero ends its attack with
// `rloc(magr, RLOC_MSG)` (uhitm.c mhitm_ad_sedu), which both picks the
// destination (the RNG-bearing part) and prints the vanish/appear message.
//
// The hero-teleport half of teleport.c (tele/dotele/level_tele/teleds) lives in
// js/trap.js, where it grew alongside the trap effects that call it.

import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import { isok, dist2 } from './hacklib.js';
import { newsym, m_at, update_topl } from './display.js';
import { couldsee } from './vision.js';
import { update_monster_region } from './region.js';
import { onscary, set_apparxy, noteleport_level } from './monmove.js';
import { Monnam, canspotmon, mon_nam } from './uhitm.js';
import { canseemon_shared as canseemon_tele } from './display.js';
import {
    COLNO, ROWNO, DOOR, POOL, DRAWBRIDGE_UP, LAVAPOOL, LAVAWALL,
    D_CLOSED, D_LOCKED, STRAT_APPEARMSG, BOLT_LIM,
} from './const.js';
import { BOULDER } from './mkobj.js';
import {
    is_swimmer_flag, passes_walls_flag, amorphous_flag, throws_rocks_flag,
} from './monflags_data.js';

// C ref: include/hack.h — rloc() flags.  (js/const.js carries an older copy of
// these names with different values; the ones here are this C build's.)
export const RLOC_NONE = 0x00;
export const RLOC_ERR = 0x01;   /* allow impossible() if no rloc */
export const RLOC_MSG = 0x02;   /* show vanish/appear msg */
export const RLOC_NOMSG = 0x04; /* prevent appear msg, even for STRAT_APPEARMSG */

// C ref: include/hack.h goodpos() gpflags (the subset goodpos reads).
export const GP_ALLOW_U = 0x00400000;
export const GP_CHECKSCARY = 0x00800000;
export const GP_AVOID_MONPOS = 0x01000000;

// C ref: monsym.h S_EEL — the monster class whose members drown out of water.
const S_EEL_MCLS = 57;

function terrainTyp(x, y) { return game.level?.at(x, y)?.typ; }
function u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }
function distu(x, y) { return dist2(x, y, game.u?.ux ?? 0, game.u?.uy ?? 0); }

// C ref: rm.h IS_POOL(typ) — POOL <= typ <= DRAWBRIDGE_UP.
function is_pool(x, y) {
    const typ = terrainTyp(x, y);
    return typ != null && typ >= POOL && typ <= DRAWBRIDGE_UP;
}
// C ref: rm.h IS_LAVA(typ) — LAVAPOOL or LAVAWALL.
function is_lava(x, y) {
    const typ = terrainTyp(x, y);
    return typ === LAVAPOOL || typ === LAVAWALL;
}

// C ref: rm.h closed_door(x,y) — a DOOR whose doormask has D_CLOSED|D_LOCKED.
function closed_door(x, y) {
    const loc = game.level?.at(x, y);
    return !!loc && loc.typ === DOOR && !!((loc.doormask | 0) & (D_CLOSED | D_LOCKED));
}

// C ref: monmove.c accessible(x, y) — ACCESSIBLE(SURFACE_AT(x,y)) && not a
// closed door.  SURFACE_AT only differs in front of a closed drawbridge, which
// the contest levels never place under a teleport destination.
function accessible(x, y) {
    const typ = terrainTyp(x, y);
    return typ != null && typ >= DOOR && !closed_door(x, y);
}

// C ref: rm.h may_passwall(x,y) — a WALLWALK monster can enter solid stone but
// not the level's outermost boundary.  Only consulted for passes_walls species,
// which never reach rloc() in the covered sessions; kept for structural fidelity.
function may_passwall(x, y) {
    return x >= 1 && x < COLNO - 1 && y >= 1 && y < ROWNO - 1;
}

// C ref: mondata.h m_in_air(mon) — flying or levitating.
function m_in_air(mtmp) { return !!mtmp?.mflying || !!mtmp?.mlevitating; }
// C ref: mondata.h:190 likes_lava(ptr) == (ptr == &mons[PM_FIRE_ELEMENTAL]
// || ptr == &mons[PM_SALAMANDER]).  Was a constant FALSE, which makes goodpos()
// reject every lava square for the two species C lets stand on one.
const PM_FIRE_ELEMENTAL_TP = 155, PM_SALAMANDER_TP = 329;
function likes_lava(mdat) {
    return mdat?.pmidx === PM_FIRE_ELEMENTAL_TP || mdat?.pmidx === PM_SALAMANDER_TP;
}

// C ref: mkobj.c sobj_at(BOULDER, x, y).
function sobj_at_boulder(x, y) {
    for (const o of (game.level?.objects || []))
        if (o.where === 'floor' && o.ox === x && o.oy === y && o.otyp === BOULDER)
            return true;
    return false;
}

// C ref: teleport.c goodpos(x, y, mtmp, gpflags) — is <x,y> a legal spot for
// mtmp?  Ported for a walking/swimming land monster on an ordinary dungeon
// level: the Plane-of-Water / waterwall / floating-eye-over-lava and
// mtmp==&youmonst branches are unreachable for these callers (a real monster on
// a normal level) and are noted rather than modelled.
export function goodpos(x, y, mtmp, gpflags) {
    const checkscary = (gpflags & GP_CHECKSCARY) !== 0;
    const allow_u = (gpflags & GP_ALLOW_U) !== 0;
    const avoid_monpos = (gpflags & GP_AVOID_MONPOS) !== 0;

    if (!isok(x, y)) return false;

    if (!allow_u) {
        // The u.ustuck-while-swallowed and u.usteed exemptions don't apply: a
        // relocating monster here neither engulfs the hero nor is ridden.
        if (u_at(x, y)) return false;
    }

    if (avoid_monpos && m_at(x, y)) return false;

    let mdat = null;
    if (mtmp) {
        const mtmp2 = m_at(x, y);
        // (mtmp->wormno: no long worms in the covered sessions)
        if (mtmp2 && mtmp2 !== mtmp) return false;

        mdat = mtmp.data;
        if (is_pool(x, y)) {
            // Water: a swimmer may land here; anyone else needs to be airborne.
            // Is_waterlevel()/is_waterwall() are FALSE on ordinary levels.
            return is_swimmer_flag(mdat) || m_in_air(mtmp);
        } else if (mdat?.mcls === S_EEL_MCLS && rn2(13)) {
            // An eel out of water usually refuses the square — and this rn2(13)
            // fires whenever an eel is offered one, so it must not be skipped.
            return false;
        } else if (is_lava(x, y)) {
            return m_in_air(mtmp) || likes_lava(mdat);
        }
        if (passes_walls_flag(mdat) && may_passwall(x, y)) return true;
        if (amorphous_flag(mdat) && closed_door(x, y)) return true;
        if (checkscary && onscary(x, y, mtmp)) return false;
    }
    if (!accessible(x, y)) return false;   // (pool/lava already returned above)
    if (sobj_at_boulder(x, y) && (!mdat || !throws_rocks_flag(mdat)))
        return false;
    // is_exclusion_zone(LR_MONGEN, ...) only applies with GP_AVOID_MONPOS
    // (monster creation), which no caller in this file passes.
    return true;
}

// C ref: teleport.c rloc_pos_ok(x, y, mtmp) — goodpos() plus the special-level
// teleport-region restrictions (svu.updest / svd.dndest), which only exist on
// the Wizard-tower and endgame levels the contest sessions never reach.
function rloc_pos_ok(x, y, mtmp) {
    if (!goodpos(x, y, mtmp, GP_CHECKSCARY)) return false;
    // tele_jump_ok(xx, yy, x, y) is TRUE on levels without updest/dndest.
    return true;
}

// C ref: teleport.c rloc_to_core(mtmp, x, y, rlocflags) — pull the monster off
// its current square and put it down at <x,y>, with the vanish / appear
// messages when the caller asked for them.  No RNG.
export async function rloc_to_core(mtmp, x, y, rlocflags) {
    const oldx = mtmp.mx, oldy = mtmp.my;
    const preventmsg = (rlocflags & RLOC_NOMSG) !== 0;
    const vanishmsg = (rlocflags & RLOC_MSG) !== 0;
    let appearmsg = ((mtmp.mstrategy | 0) & STRAT_APPEARMSG) !== 0;
    const domsg = !game.in_mklev && (vanishmsg || appearmsg) && !preventmsg;
    let telemsg = false;

    if (x === mtmp.mx && y === mtmp.my && m_at(x, y) === mtmp) return;

    if (oldx) { /* "pick up" monster */
        if (domsg && canspotmon(mtmp)) {
            // sensemon() is FALSE (no telepathy / warning in these sessions).
            if (couldsee(x, y)) {
                telemsg = true;
            } else {
                await update_topl(`${Monnam(mtmp)} vanishes!`);
            }
            appearmsg = false;
        }
        // (no long worms) remove_monster(oldx, oldy) then newsym.
        mtmp.mx = 0; mtmp.my = 0;
        newsym(oldx, oldy);
    }

    mtmp.mtrack = [];                       // mon_track_clear(mtmp)
    mtmp.mx = x; mtmp.my = y;               // place_monster(mtmp, x, y)
    update_monster_region(mtmp);

    // The u.ustuck unstuck/swallow bookkeeping and maybe_unhide_at() are inert
    // here: nothing is holding the hero and no hider sits at the destination.

    newsym(x, y);
    set_apparxy(mtmp);

    if (domsg && (canspotmon(mtmp) || appearmsg)) {
        const du = distu(x, y);
        const next = (du <= 2) ? ' next to you' : null;
        const nearu = (du <= BOLT_LIM * BOLT_LIM) ? ' close by' : null;
        mtmp.mstrategy = (mtmp.mstrategy | 0) & ~STRAT_APPEARMSG; /* one chance only */
        if (telemsg && couldsee(x, y)) {
            const olddu = distu(oldx, oldy);
            const where = next ? next
                : nearu ? nearu
                    : (olddu === du) ? ''
                        : (du < olddu) ? ' closer to you' : ' farther away';
            await update_topl(`${Monnam(mtmp)} vanishes and reappears${where}.`);
        } else {
            const Blind = (game.u?.blinded || 0) > 0 || !!game.u?.ublindf;
            await update_topl(`${Monnam(mtmp)} ${appearmsg ? 'suddenly ' : ''}`
                + `${!Blind ? 'appears' : 'arrives'}${next || nearu || ''}!`);
        }
        // (the WAN_TELEPORTATION discovery needs gc.current_wand, which is Null
        // for an attack-driven relocation)
    }

    // Resident-shopkeeper anger, shop-goods billing, the go.occupation
    // dochugw() nudge and the mtrapped mintrap() re-check are all inert for the
    // monsters these sessions relocate.
}

// C ref: teleport.c rloc_to(mtmp, x, y).
export async function rloc_to(mtmp, x, y) {
    await rloc_to_core(mtmp, x, y, RLOC_NOMSG);
}

// C ref: teleport.c rloc(mtmp, rlocflags) — put the monster at a random legal
// location.  Returns TRUE when a spot was found.
//
// RNG: up to 50 tries of `rnd(COLNO - 1)` then `rn2(ROWNO)`, both consumed on
// every iteration, stopping at the first square rloc_pos_ok() accepts.
export async function rloc(mtmp, rlocflags) {
    // The u.usteed / iswiz / iflags.mon_telecontrol special cases don't apply:
    // the teleporting monsters here are ordinary hostiles and wizard mode's
    // 'montelecontrol' option is off.
    let x = 0, y = 0, found = false;
    for (let trycount = 0; trycount < 50; ++trycount) {
        x = rnd(COLNO - 1);        /* 1..COLNO-1 */
        y = rn2(ROWNO);            /* 0..ROWNO-1 */
        if (rloc_pos_ok(x, y, mtmp)) { found = true; break; }
    }
    if (!found) {
        // C falls back to collect_coords() plus a Fisher-Yates walk over every
        // accessible square.  That is only reached when 50 random draws all
        // miss, which needs a level with almost no free floor; it is not
        // ported, so report failure rather than inventing RNG draws.
        return false;
    }
    await rloc_to_core(mtmp, x, y, rlocflags);
    return true;
}

// C ref: teleport.c noteleport_level(mon).  This was a `return false` stub, so
// on a des-file "noteleport" level (medusa-*, sokoban, the quest homes, Vlad's
// tower) a stealing nymph still ran rloc() and burned its rnd(79)/rn2(21)
// placement loop where C prints "A mysterious force prevents ..." and draws
// nothing (seed4500 step 988, Dlvl 24).  monmove.js already carries the real
// predicate (Gehennom demon court + level flag); share it rather than fork it.
export { noteleport_level };

// C ref: teleport.c tele_restrict(mon) — "A mysterious force prevents %s from
// teleporting!" on a no-teleport level.  No RNG, but the pline lands on the top
// line and the suppressed rloc() is worth two draws per try.
export async function tele_restrict(mon) {
    if (noteleport_level(mon)) {
        if (canseemon_tele(mon))
            await update_topl(`A mysterious force prevents ${mon_nam(mon)} from teleporting!`);
        return true;
    }
    return false;
}

// ===========================================================================
// The rest of src/teleport.c.  INERT: nothing above this line calls anything
// below it.  Everything keeps its C name, argument order and return type, with
// two JS adaptations noted at each site:
//   * C's `coord *cc` out-parameters are returned instead (`{x,y}` or null),
//     because the callers in this tree all use that shape (see do.js enexto).
//   * anything that blocks on input or prints is async.
//
// READ BEFORE WIRING.  collect_coords() below is the FULL C routine (all five
// cc_flags plus the filter callback).  js/do.js:279 holds a REDUCED copy under
// the same name — maxradius only, always shuffled, no CC_INCL_CENTER /
// CC_UNSHUFFLED / CC_RING_PAIRS / CC_SKIP_MONS / CC_SKIP_INACCS.  safe_teleds()
// needs CC_RING_PAIRS|CC_SKIP_MONS and rloc()'s exhaustive fallback needs
// CC_INCL_CENTER|CC_UNSHUFFLED|CC_SKIP_MONS, so the reduced copy cannot serve
// them: the ring-pair shuffle draws a DIFFERENT number of rn2() calls than the
// per-ring one.  Consolidating on this one (and deleting do.js's) is the fix;
// until then do not "simplify" by calling do.js's.
// ===========================================================================

import { rn1 } from './rng.js';
import {
    CC_INCL_CENTER, CC_UNSHUFFLED, CC_RING_PAIRS, CC_SKIP_MONS, CC_SKIP_INACCS,
    GP_ALLOW_XY, TELEDS_ALLOW_DRAG, TELEDS_TELEPORT,
    TT_BURIEDBALL, SLT_ENCUMBER, VIBRATING_SQUARE, LEVEL_TELEP, TELEP_TRAP,
    MAGIC_PORTAL, HOLE, TRAPDOOR, NO_TRAP, MIGR_RANDOM, MIGR_PORTAL,
    UTOTYPE_PORTAL, UTOTYPE_ATSTAIRS, VAULT, SHOPBASE,
    ECMD_OK, ECMD_TIME, FORCETRAP, NHW_MENU, PICK_ONE,
    A_STR, A_WIS,
    is_pit, is_hole, is_xport, IS_ALTAR, ZAP_POS,
} from './const.js';
import { CORPSE, SCR_SCARE_MONSTER } from './mkobj.js';
import { M1_NOEYES, M2_LORD, M2_PRINCE } from './monflags_data.js';
import { within_bounded_area } from './rect.js';
import { in_out_region } from './region.js';
import { see_monsters } from './display.js';

// C ref: trap.h:96 enum trap_result.
const Trap_Effect_Finished = 0, Trap_Moved_Mon = 3;
// C ref: monsym.h — mons[].mlet values goodpos_onscary() and mlevel_tele_trap()
// test.  (S_EEL_MCLS above is the same table.)
const S_HUMAN_MCLS = 53, S_ANGEL_MCLS = 27, S_VAMPIRE_MCLS = 48,
      S_ELEMENTAL_MCLS = 31;
// C ref: pm.h PM_MINOTAUR (mon.js:905 carries the same index).
const PM_MINOTAUR_TP = 177;

// C ref: teleport.c:20 m_blocks_teleporting(mtmp) — a demon lord or prince on
// the level stops everyone else teleporting (in Gehennom).  No RNG.
export function m_blocks_teleporting(mtmp) {
    if (is_dlord_(mtmp.data) || is_dprince_(mtmp.data)) return true;
    return false;
}

// C ref: teleport.c:52 goodpos_onscary(x, y, mptr) — the mptr-only
// approximation of onscary(), used for monster CREATION and monster teleport
// destinations (goodpos() picks it when mtmp->m_id is 0, i.e. a fake monst).
// No RNG.  Note the early FALSE for humans/angels/riders/uniques happens BEFORE
// the altar test, so a vampire that is also unique_corpstat is not scared.
export function goodpos_onscary(x, y, mptr) {
    /* onscary() checks Angels and lawful minions; this oversimplifies */
    if (mptr.mcls === S_HUMAN_MCLS || mptr.mcls === S_ANGEL_MCLS
        || is_rider_(mptr) || unique_corpstat_(mptr))
        return false;
    /* onscary() checks for vampshifted vampire bats/fog clouds/wolves too */
    if (IS_ALTAR(terrainTyp(x, y)) && mptr.mcls === S_VAMPIRE_MCLS)
        return true;
    /* scare monster scroll doesn't have any of the below restrictions */
    if (sobj_at_(SCR_SCARE_MONSTER, x, y)) return true;
    /* engraved Elbereth doesn't work in Gehennom or the end-game */
    if (Inhell_() || In_endgame_()) return false;
    /* creatures who don't (or can't) fear a written Elbereth */
    if (mptr.pmidx === PM_MINOTAUR_TP || !haseyes_(mptr)) return false;
    return sengr_at_('Elbereth', x, y, true) ? true : false;
}

// C ref: teleport.c:577 collect_coords(ccc, cx, cy, maxradius, cc_flags,
// filter) — the candidate-spot generator every "find me somewhere near here"
// caller in this file uses.  RETURNS the array (C fills ccc[] and returns the
// count).
//
// RNG: one rn2(n) per remaining entry while shuffling each pass, where a "pass"
// is a single ring normally but a PAIR of rings under CC_RING_PAIRS (rings 1+2
// shuffled together, then 3+4, ...) — a different total number of draws for the
// same map, which is why the reduced copy in do.js cannot stand in.
// CC_UNSHUFFLED skips the shuffle entirely (and therefore every draw).
export function collect_coords(cx, cy, maxradius, cc_flags, filter) {
    const ccc = [];
    let radius, rowrange, colrange, k, n = 0;
    let cc, passcc = -1;                      /* index into ccc, not a pointer */
    let newpass, passend;
    const include_cxcy = (cc_flags & CC_INCL_CENTER) !== 0;
    const scramble = (cc_flags & CC_UNSHUFFLED) === 0;
    const ring_pairs = (scramble && (cc_flags & CC_RING_PAIRS) !== 0);
    const skip_mons = (cc_flags & CC_SKIP_MONS) !== 0;
    const skip_inaccessible = (cc_flags & CC_SKIP_INACCS) !== 0;

    rowrange = (cy < ROWNO / 2) ? (ROWNO - 1 - cy) : cy;
    colrange = (cx < COLNO / 2) ? (COLNO - 1 - cx) : cx;
    k = Math.max(rowrange, colrange);
    if (!maxradius) maxradius = k;
    else maxradius = Math.min(maxradius, k);

    for (radius = include_cxcy ? 0 : 1; radius <= maxradius; ++radius) {
        if (!ring_pairs) {
            newpass = passend = true;
        } else {
            /* 0 (if include_cxcy) and maxradius override odd/even */
            newpass = ((radius % 2) !== 0 || radius === 0);            /* odd */
            passend = ((radius % 2) === 0 || radius === maxradius);   /* even */
        }
        if (newpass || passcc < 0) {
            passcc = ccc.length;
            n = 0;
        }
        const lox = cx - radius, hix = cx + radius;
        const loy = cy - radius, hiy = cy + radius;
        for (let y = Math.max(loy, 0); y <= hiy; ++y) {
            if (y > ROWNO - 1) break;         /* done with this radius */
            for (let x = Math.max(lox, 1); x <= hix; ++x) { /* col 0 unused */
                if (x > COLNO - 1) break;     /* advance to next 'y' */
                if (x !== lox && x !== hix && y !== loy && y !== hiy)
                    continue;                 /* not any edge of ring/square */
                if ((skip_mons && m_at(x, y))
                    /* !ZAP_POS() accepts water and lava; !ACCESSIBLE would not */
                    || (skip_inaccessible && !ZAP_POS(terrainTyp(x, y))))
                    continue;                 /* quick filters */
                if (filter && !filter(x, y)) continue;
                ccc.push({ x, y });
                ++n;
            }
        }
        if (scramble && passend) {
            /* shuffle entries gathered for current radius (or pair) */
            while (n > 1) {
                k = rn2(n);                   /* 0..n-1 */
                if (k) {                      /* swap [k] with [0] */
                    cc = ccc[passcc];
                    ccc[passcc] = ccc[passcc + k];
                    ccc[passcc + k] = cc;
                }
                ++passcc;                     /* [0] has reached its place    */
                --n;                          /* and is exempt from further   */
            }
        }
    }
    return ccc;
}

// C ref: teleport.c:218 enexto_core (the NEW_ENEXTO form; the #else 15-slot
// ring walk is dead in this build).  RNG: collect_coords' shuffles, plus the
// rn2(13) goodpos() draws for an eel candidate.  Returns {x,y} or null.
//
// The two collect_coords passes are NOT independent: the second gathers the
// WHOLE map (including the radius<=3 ring that the first already rejected) and
// then SKIPS the first nearcandyct entries, so the shuffle draws for those
// rings happen twice with different results.  Skipping the re-gather changes
// the stream.
export function enexto_core(xx, yy, mdat, entflags) {
    let i, nearcandyct, allcandyct;
    const allow_xx_yy = (entflags & GP_ALLOW_XY) !== 0;

    if (!mdat) {
        /* default to player's original monster type */
        mdat = youmonster_data_();
    }
    /* cg.zeromonst + set_mon_data(&fakemon, mdat): a zeroed monst carrying only
       mdat, so goodpos()'s m_id is 0 and it uses goodpos_onscary(). */
    const fakemon = { data: mdat, m_id: 0 };

    /* gather candidates within 3 steps, 1 step away in random order first,
       then 2 steps, then 3 */
    let candy = collect_coords(xx, yy, 3, 0 /*CC_NO_FLAGS*/, null);
    nearcandyct = candy.length;
    for (i = 0; i < nearcandyct; ++i)
        if (goodpos(candy[i].x, candy[i].y, fakemon, entflags)) return candy[i];

    /* whole map except <xx,yy>, in expanding distance order */
    candy = collect_coords(xx, yy, 0, 0 /*CC_NO_FLAGS*/, null);
    allcandyct = candy.length;
    /* skip the first 'nearcandyct' spots; already rejected (different random
       order but same overall total) */
    for (i = nearcandyct; i < allcandyct; ++i)
        if (goodpos(candy[i].x, candy[i].y, fakemon, entflags)) return candy[i];

    /* still nothing; maybe try <xx,yy> itself */
    if (allow_xx_yy && goodpos(xx, yy, fakemon, entflags)) return { x: xx, y: yy };
    return null;
}

// C ref: teleport.c:205 enexto_gpflags(cc, xx, yy, mdat, entflags).  Two
// enexto_core passes: the scary-square filter first, then without it.  The
// second pass re-runs every collect_coords shuffle, so a caller that "knows"
// the first pass will succeed still must not skip the call.
export function enexto_gpflags(xx, yy, mdat, entflags) {
    return enexto_core(xx, yy, mdat, GP_CHECKSCARY | entflags)
        || enexto_core(xx, yy, mdat, entflags);
}

// C ref: teleport.c:385 tele_jump_ok(x1, y1, x2, y2) — the special-level
// teleport regions (svd.dndest / svu.updest).  No RNG.  Both halves of each
// pair are "inside xor outside" tests, so a level with no regions returns TRUE
// after only the isok() check.
export function tele_jump_ok(x1, y1, x2, y2) {
    const dndest = dndest_(), updest = updest_();
    if (!isok(x2, y2)) return false;
    if (dndest.nlx > 0) {
        /* if inside a restricted region, can't teleport outside */
        if (within_bounded_area_(x1, y1, dndest.nlx, dndest.nly, dndest.nhx, dndest.nhy)
            && !within_bounded_area_(x2, y2, dndest.nlx, dndest.nly, dndest.nhx, dndest.nhy))
            return false;
        /* and if outside, can't teleport inside */
        if (!within_bounded_area_(x1, y1, dndest.nlx, dndest.nly, dndest.nhx, dndest.nhy)
            && within_bounded_area_(x2, y2, dndest.nlx, dndest.nly, dndest.nhx, dndest.nhy))
            return false;
    }
    if (updest.nlx > 0) { /* ditto */
        if (within_bounded_area_(x1, y1, updest.nlx, updest.nly, updest.nhx, updest.nhy)
            && !within_bounded_area_(x2, y2, updest.nlx, updest.nly, updest.nhx, updest.nhy))
            return false;
        if (!within_bounded_area_(x1, y1, updest.nlx, updest.nly, updest.nhx, updest.nhy)
            && within_bounded_area_(x2, y2, updest.nlx, updest.nly, updest.nhx, updest.nhy))
            return false;
    }
    return true;
}

// C ref: teleport.c:419 teleok(x, y, trapok) — may the HERO land on <x,y>?
// No RNG.  goodpos() is called with gpflags 0, so its checkscary/allow_u/
// avoid_monpos are all off and the mtmp==&youmonst pool/lava arms apply.
export function teleok(x, y, trapok) {
    if (!trapok) {
        /* allow teleportation onto vibrating square, it's not a real trap;
           also allow pits and holes if levitating or flying */
        const trap = t_at_(x, y);

        if (!trap) trapok = true;
        else if (trap.ttyp === VIBRATING_SQUARE) trapok = true;
        else if ((is_pit(trap.ttyp) || is_hole(trap.ttyp))
                 && (Levitation_() || Flying_())) trapok = true;

        if (!trapok) return false;
    }
    if (!goodpos(x, y, youmonst_(), 0)) return false;
    if (!tele_jump_ok(game.u?.ux, game.u?.uy, x, y)) return false;
    if (!in_out_region_(x, y)) return false;
    return true;
}

// C ref: teleport.c:447 teleds(nux, nuy, teleds_flags) — actually move the hero.
// The only RNG on this path is inside spoteffects() (the arrival trap/shop/
// water effects) and, when Punished, drag_ball().  Order is load-bearing: the
// ball/chain bookkeeping happens BEFORE u_on_newpos(), the vision recalc
// BEFORE the "You materialize..." line, and the vault-guard check BEFORE
// spoteffects() (so the guard's whistle precedes any shop-entry message).
export async function teleds(nux, nuy, teleds_flags) {
    const u = game.u;
    let was_swallowed;
    let ball_active, ball_still_in_range = false;
    let allow_drag = (teleds_flags & TELEDS_ALLOW_DRAG) !== 0;
    const is_teleport = (teleds_flags & TELEDS_TELEPORT) !== 0;
    const vault_guard = vault_occupied_(u?.urooms) ? findgd_() : 0;

    if (u.utraptype === TT_BURIEDBALL) {
        /* unearth it */
        const { buried_ball_to_punishment } = await import('./dig.js');
        await buried_ball_to_punishment();
    }
    ball_active = (Punished_() && uball_()?.where !== 'free');
    const { near_capacity } = await import('./invent.js');
    if (!ball_active
        || near_capacity() > SLT_ENCUMBER
        || distmin_(u.ux, u.uy, nux, nuy) > 1)
        allow_drag = false;

    /* If they have to move the ball, drag when allow_drag; otherwise this is a
       teleport, so unplacebc().  drag_ball() knows about allow_drag and might
       drag anyway, or teleport the ball itself when dragging is impossible. */
    const B = await import('./ball.js');
    if (ball_active) {
        if (!carried_(uball_()) && distmin_(nux, nuy, uball_().ox, uball_().oy) <= 2)
            ball_still_in_range = true;    /* don't have to move the ball */
        else if (!allow_drag)
            B.unplacebc();                 /* have to move the ball */
    }
    reset_utrap_(false);
    was_swallowed = u.uswallow;            /* set_ustuck(Null) clears uswallow */
    const { set_ustuck } = await import('./mon.js');
    set_ustuck(null);
    u.ux0 = u.ux;
    u.uy0 = u.uy;

    const { hideunder } = await import('./monmove.js');
    if (!await hideunder(youmonst_()) && youmonster_data()?.mcls === S_MIMIC_MCLS) {
        /* mimics stop being unnoticed */
        if (game.youmonst) game.youmonst.m_ap_type = 0; /* M_AP_NOTHING */
    }

    const { docrt, newsym: newsym_ } = await import('./display.js');
    if (was_swallowed) {
        if (Punished_()) {  /* ball&chain are off map while swallowed */
            ball_active = true;   /* to put chain and non-carried ball on map */
            ball_still_in_range = allow_drag = false;    /* (redundant) */
        }
        await docrt();
    }
    if (ball_active && (ball_still_in_range || allow_drag)) {
        const bc = await B.drag_ball(nux, nuy, allow_drag);
        if (bc && bc.ok) {
            B.move_bc(0, bc.bc_control, bc.ballx, bc.bally, bc.chainx, bc.chainy);
        } else {
            /* dragging fails if hero is encumbered beyond 'burdened'; uball
               might've been cleared via drag_ball -> spoteffects -> dotrap */
            ball_active = (Punished_() && uball_()?.where !== 'free');
            if (ball_active) B.unplacebc();  /* to match placebc() below */
        }
    }

    /* must set u.ux,u.uy AFTER drag_ball(), which may need the old position */
    u_on_newpos_(nux, nuy);   /* set u.<x,y>, usteed-><mx,my>; cliparound() */
    const { fill_pit } = await import('./trap.js');
    fill_pit(u.ux0, u.uy0);
    if (ball_active && uchain_() && uchain_().where === 'free')
        B.placebc();          /* put back the ball&chain if taken off map */
    const { update_player_regions } = await import('./region.js');
    update_player_regions();
    /*
     *  Make sure the hero disappears from the old location, and force a full
     *  vision recalculation because the hero is now somewhere new.
     */
    newsym_(u.ux0, u.uy0);
    see_monsters_();
    game.vision_full_recalc = 1;
    const { nomul } = await import('./hack.js');
    nomul(0);
    notice_mon_off_();
    vision_recalc_(0);        /* vision before effects */

    /* this used to take place sooner, but if a --More-- prompt was issued then
       the old map display was shown instead of the new one */
    if (is_teleport && game.flags?.verbose)
        await update_topl(`You materialize in `
            + `${(nux === u.ux0 && nuy === u.uy0) ? 'the same' : 'a different'} location!`);
    /* if terrain type changes, levitation or flying might become blocked or
       unblocked; do this after map+vision has been updated */
    if (terrainTyp(u.ux, u.uy) !== terrainTyp(u.ux0, u.uy0))
        switch_terrain_();
    /* sequencing: the guard's alarm must precede any room-entry message, but
       spoteffects() sets up the new u.urooms the vault code depends on, so
       fake it */
    if (vault_guard) {
        const { in_rooms } = await import('./shkroom.js');
        const save_urooms = u.urooms;
        u.urooms = in_rooms(u.ux, u.uy, VAULT);
        /* if hero has left vault, make guard notice */
        if (!vault_occupied_(u.urooms)) {
            const { uleftvault } = await import('./vault.js');
            await uleftvault(vault_guard);
        }
        u.urooms = save_urooms;   /* reset prior to spoteffects() */
    }
    /* possible shop entry message comes after guard's shrill whistle */
    const { spoteffects } = await import('./trap.js');
    await spoteffects(true);
    const { invocation_message, notice_all_mons } = await import('./hack.js');
    await invocation_message();
    notice_mon_on_();
    await notice_all_mons(true);
}

// C ref: teleport.c:716 safe_teleds(teleds_flags) — [try to] teleport the hero
// somewhere legal.  RNG: 40 iterations of rnd(COLNO-1) THEN rn2(ROWNO), both
// drawn every iteration; then, only if all 40 miss, one collect_coords pass
// over the whole map with CC_RING_PAIRS|CC_SKIP_MONS (plus CC_SKIP_INACCS
// unless Passes_walls).  Do not "optimise" the 40 tries: the pair is drawn
// before teleok() is consulted.
export async function safe_teleds(teleds_flags) {
    let nux, nuy, cc_flags, tcnt;

    for (tcnt = 0; tcnt < 40; ++tcnt) {
        nux = rnd(COLNO - 1);
        nuy = rn2(ROWNO);
        if (teleok(nux, nuy, false)) {
            await teleds(nux, nuy, teleds_flags);
            return true;
        }
    }

    /* shuffled candidates, spots 1-or-2 steps from hero first, then 3-or-4 */
    cc_flags = CC_RING_PAIRS | CC_SKIP_MONS;
    if (!Passes_walls_()) cc_flags |= CC_SKIP_INACCS;
    const candy = collect_coords(game.u.ux, game.u.uy, 0, cc_flags, null);
    const backupspot = { x: 0, y: 0 };
    /* skip trap locations via teleok(,,FALSE) but remember the first
       encountered trap spot that teleok(,,TRUE) accepts */
    for (tcnt = 0; tcnt < candy.length; ++tcnt) {
        nux = candy[tcnt].x; nuy = candy[tcnt].y;
        if (teleok(nux, nuy, false)) {
            await teleds(nux, nuy, teleds_flags);
            return true;
        }
        if (!backupspot.x && t_at_(nux, nuy) && teleok(nux, nuy, true)) {
            backupspot.x = nux; backupspot.y = nuy;
        }
    }
    /* no non-trap spot found; if we skipped a viable trap spot, use it */
    if (backupspot.x) {
        await teleds(backupspot.x, backupspot.y, teleds_flags);
        return true;
    }
    return false;
}

// C ref: teleport.c:813 tele_to_rnd_pet(void) — the "reservoir sample a pet"
// walk.  RNG: rn2(cnt) for EVERY live tame off-map-free monster (cnt starts at
// 1 for the first, so the first pet's rn2(1) still draws), then rn2(3) twice
// (tx then ty) but ONLY when a pet was found and it is not already next to the
// hero.
export async function tele_to_rnd_pet() {
    let pet = null;
    let cnt = 0;

    if (noteleport_level(youmonst_())) {
        const { impossible } = await import('./display.js');
        await impossible('attempt to teleport hero to be near a pet'
                         + ' on no-teleport level');
        return;
    }

    for (const mtmp of (game.level?.monsters || [])) {
        if (!mtmp) continue;
        if ((mtmp.mhp | 0) >= 1 && mtmp.mtame && !mon_offmap_(mtmp)) {
            cnt++;
            if (!rn2(cnt)) pet = mtmp;
        }
    }
    if (pet && !await m_next2u_(pet)) {
        const tx = pet.mx + rn2(3) - 1,
              ty = pet.my + rn2(3) - 1;

        if (isok(tx, ty) && teleok(tx, ty, false))
            await teleds(tx, ty, TELEDS_TELEPORT);
    }
}

// C ref: teleport.c:918 dotelecmd(void) — the ^T command.  Outside wizard mode
// it is just dotele(FALSE); in wizard mode 'm ^T' raises a four-way menu and
// temporarily fakes intrinsic teleport / the teleport-away spell around the
// dotele() call.  No RNG of its own.
export async function dotelecmd() {
    const NOOP_SPELL = 0, HIDE_SPELL = 1, ADD_SPELL = 2;
    let res, added, hidden;
    let ignore_restrictions = false;

    /* normal mode; ignore 'm' prefix if it was given */
    if (!wizard_()) return (await dotele(false)) ? ECMD_TIME : ECMD_OK;

    added = hidden = NOOP_SPELL;
    const save_HTele = HTeleportation_(), save_ETele = ETeleportation_();
    if (!game.iflags?.menu_requested) {
        ignore_restrictions = true;
    } else {
        /* We only support the 1st (t), 2nd (n), 6th (s), and 9th (w) of the
           nine possible combinations. */
        const tports = [
            { menulet: 'n', menudesc: 'normal ^T on demand; no spell, obey restrictions' },
            { menulet: 's', menudesc: 'via spellcast; no intrinsic teleport' },
            { menulet: 't', menudesc: 'try ^T without having it; no spell' },
            { menulet: 'w', menudesc: 'debug mode; ignore restrictions' },
        ];
        const win = create_nhwindow_(NHW_MENU);
        start_menu_(win);
        for (let i = 0; i < tports.length; ++i)
            add_menu_(win, tports[i].menulet, tports[i].menudesc,
                      tports[i].menulet === 'w');
        end_menu_(win, 'Which way do you want to teleport?');
        const picks = await select_menu_(win, PICK_ONE);
        destroy_nhwindow_(win);
        let tmode;
        const i = picks ? picks.length : -1;
        if (i > 0) {
            tmode = picks[0];
            /* if we got 2, use the one which wasn't preselected */
            if (i > 1 && tmode === 'w') tmode = picks[1];
        } else if (i === 0) {
            /* preselected one was explicitly chosen and got toggled off */
            tmode = 'w';
        } else {                                   /* ESC */
            return ECMD_OK;
        }
        switch (tmode) {
        case 'n':
            setHTeleportation_(HTeleportation_() | I_SPECIAL_TP);
            hidden = tport_spell_(HIDE_SPELL);      /* hide teleport-away */
            break;
        case 's':
            setHTeleportation_(0); setETeleportation_(0);
            added = tport_spell_(ADD_SPELL);        /* add teleport-away */
            break;
        case 't':
            setHTeleportation_(0); setETeleportation_(0);
            hidden = tport_spell_(HIDE_SPELL);
            break;
        case 'w':
            ignore_restrictions = true;
            break;
        }
    }

    res = await dotele(ignore_restrictions);

    setHTeleportation_(save_HTele);
    setETeleportation_(save_ETele);
    if (added !== NOOP_SPELL || hidden !== NOOP_SPELL)
        /* can't both be non-NOOP so addition yields the non-NOOP one */
        tport_spell_(added + hidden - NOOP_SPELL);

    return res ? ECMD_TIME : ECMD_OK;
}

// C ref: teleport.c:1033 dotele(break_the_rules).  RNG lives in the callees
// (level_tele_trap, spelleffects, vault_tele/tele -> scrolltele, morehungry).
// The trap block runs FIRST and, when a seen teleport trap is jumped into,
// suppresses the intrinsic/spell energy checks entirely.
export async function dotele(break_the_rules) {
    let trap;
    let cantdoit;
    let trap_once = false;

    trap = t_at_(game.u.ux, game.u.uy);
    if (trap && !trap.tseen) trap = 0;

    const { newsym: newsym_ } = await import('./display.js');
    if (trap) {
        if (trap.ttyp === LEVEL_TELEP && trap.tseen) {
            if (await y_n_('There is a level teleporter here. Trigger it?') === 'y') {
                await level_tele_trap_(trap, FORCETRAP);
                /* deliberate jumping always takes time even if it doesn't work */
                return 1;
            } else {
                trap = 0;      /* continue with normal horizontal teleport */
            }
        } else if (trap.ttyp === TELEP_TRAP) {
            trap_once = trap.once;   /* trap may get deleted, save this */
            if (trap.once) {
                await update_topl('This is a vault teleport, usable once only.');
                if (await y_n_('Jump in?') === 'n') {
                    trap = 0;
                } else {
                    const { deltrap } = await import('./trap.js');
                    deltrap(trap);
                    newsym_(game.u.ux, game.u.uy);
                }
            }
            if (trap)
                await update_topl(`You ${u_locomotion_('jump')} onto the teleportation trap.`);
        } else {
            trap = 0;
        }
    }
    if (!trap && !break_the_rules) {
        let castit = false;
        let energy = 0;

        if (!Teleportation_() || (game.u.ulevel < (Role_if_wizard_() ? 8 : 12)
                                  && !can_teleport_(youmonster_data()))) {
            /* Try to use teleport away spell. */
            const knownsp = known_spell_(SPE_TELEPORT_AWAY_TP);

            /* casting isn't inhibited by being Stunned (...it ought to be) */
            castit = (knownsp >= spe_Fresh_TP && !Confusion_tp());
            if (!castit && !break_the_rules) {
                await update_topl(`You ${!Teleportation_()
                    ? ((knownsp !== spe_Unknown_TP) ? "can't cast that spell"
                                                    : "don't know that spell")
                    : 'are not able to teleport at will'}.`);
                return 0;
            }
        }

        cantdoit = 0;
        /* 3.6.2: magic numbers match the ones in spelleffects() */
        energy = 5 * spellev_(SPE_TELEPORT_AWAY_TP);
        if (game.u.uhunger <= 10) {
            cantdoit = 'are too weak from hunger';
        } else if (ACURR_tp(A_STR_TP) < 4) {
            cantdoit = 'lack the strength';
        } else if (energy > game.u.uen) {
            cantdoit = 'lack the energy';
        }
        if (cantdoit) {
            await update_topl(`You ${cantdoit} `
                + `${castit ? 'for a teleport spell' : 'to teleport'}.`);
            return 0;
        } else if (await check_capacity_(
                       'Your concentration falters from carrying so much.')) {
            return 1;   /* this failure in spelleffects() also uses the move */
        }

        if (castit) {
            /* energy cost is deducted in spelleffects() */
            exercise_(A_WIS_TP, true);
            if ((await spelleffects_(SPE_TELEPORT_AWAY_TP, true, false)) & ECMD_TIME)
                return 1;
            else if (!break_the_rules)
                return 0;
        } else {
            /* bypassing spelleffects(); apply energy cost directly */
            game.u.uen -= energy;
            if (game.disp) game.disp.botl = true;
        }
    }

    if (next_to_u_()) {
        if (trap && trap_once) {
            await vault_tele_();
        } else if (trap && isok(trap.teledest?.x, trap.teledest?.y)) {
            await teleds(trap.teledest.x, trap.teledest.y, TELEDS_TELEPORT);
        } else {
            if (game.iflags) { game.iflags.travelcc = { x: 0, y: 0 }; }
            await tele_();
        }
        next_to_u_();
    } else {
        await update_topl('You shudder for a moment.');
        return 0;
    }
    if (!trap) morehungry_(100);
    return 1;
}

// C ref: teleport.c:1443 domagicportal(ttmp).  No RNG (make_stunned's duration
// is a fixed +3).  The `!on_level(&u.uz, &u.uz0)` guard makes a portal arrived
// at via another portal inert.
export async function domagicportal(ttmp) {
    let target_level;
    let totype;
    let stunmsg = null;

    if (game.u.utrap && game.u.utraptype === TT_BURIEDBALL) {
        const { buried_ball_to_punishment } = await import('./dig.js');
        await buried_ball_to_punishment();
    }

    if (!next_to_u_()) {
        await update_topl('You shudder for a moment.');
        return;
    }

    /* if landed from another portal, do nothing */
    if (!on_level_(game.u.uz, game.u.uz0)) return;

    await update_topl('You activated a magic portal!');

    /* prevent the poor shnook, whose amulet was stolen while in the endgame,
       from accidentally triggering the portal to the next level */
    if (In_endgame_() && !game.u.uhave?.amulet) {
        await update_topl('You feel dizzy for a moment, but nothing happens...');
        return;
    }

    target_level = ttmp.dst;

    /* coming back from tutorial doesn't trigger stunning */
    if (In_tutorial_(game.u.uz) && !In_tutorial_(target_level)) {
        /* returning to normal play => arrive on level 1 stairs */
        totype = UTOTYPE_ATSTAIRS;
        stunmsg = 'Resuming regular play.';
    } else {
        totype = UTOTYPE_PORTAL;
        stunmsg = !Stunned_tp() ? 'You feel slightly dizzy.' : 'You feel dizzier.';
        await make_stunned_tp(HStun_tp() + 3, false);
    }

    await schedule_goto_(target_level, totype, stunmsg, null);
}

// C ref: teleport.c:1776 rloc_to_flag(mtmp, x, y, rlocflags).
export async function rloc_to_flag(mtmp, x, y, rlocflags) {
    await rloc_to_core(mtmp, x, y, rlocflags);
}

// C ref: teleport.c:1785 stairway_find_forwiz(isladder, up) — the first
// same-dungeon stairway of the requested kind.  No RNG.
export function stairway_find_forwiz(isladder, up) {
    let stway = game.stairs;
    while (stway && !(!!stway.isladder === !!isladder
                      && !!stway.up === !!up
                      && stway.tolev?.dnum === game.u?.uz?.dnum))
        stway = stway.next;
    return stway;
}

// C ref: teleport.c:1898 control_mon_tele(mon, cc_p, rlocflags, via_rloc) —
// wizard-mode 'montelecontrol'.  No RNG.  Returns TRUE with the chosen spot
// written back into cc_p.
export async function control_mon_tele(mon, cc_p, rlocflags, via_rloc) {
    if (!isok(cc_p.x, cc_p.y)) {
        cc_p.x = mon.mx; cc_p.y = mon.my;
        if (!isok(cc_p.x, cc_p.y)) { cc_p.x = game.u.ux; cc_p.y = game.u.uy; }
    }

    if (!wizard_() || !game.iflags?.mon_telecontrol) return false;

    await update_topl(`Teleport ${noit_mon_nam_(mon)} @ <${mon.mx},${mon.my}> where?`);
    /* getpos '?' will show "Move the cursor to <where to teleport Foo>:" */
    const tcbuf = `where to teleport ${noit_mon_nam_(mon)}`;
    const picked = await getpos_(cc_p, false, tcbuf);
    if (picked >= 0 && !u_at(cc_p.x, cc_p.y)) {
        if (via_rloc ? rloc_pos_ok_(cc_p.x, cc_p.y, mon)
                     : goodpos(cc_p.x, cc_p.y, mon, rlocflags))
            return true;
        if (!game.iflags?.debug_fuzzer) {
            if (await y_n_(`<${mon.mx},${mon.my}> is not considered viable; `
                           + 'force anyway?') === 'y')
                return true;
        }
    }
    await update_topl(`${via_rloc ? 'Picking random' : 'Using derived'} destination.`);
    return false;
}

// C ref: teleport.c:1936 mvault_tele(mtmp).  somexyspace() is RNG-BEARING and
// runs BEFORE goodpos(); when either fails the fallback is a full rloc().
export async function mvault_tele(mtmp) {
    const croom = search_special_(VAULT);
    const c = { x: 0, y: 0 };

    if (croom && await somexyspace_(croom, c) && goodpos(c.x, c.y, mtmp, 0)) {
        await rloc_to(mtmp, c.x, c.y);
        return;
    }
    await rloc(mtmp, RLOC_NONE);
}

// C ref: teleport.c:1961 mtele_trap(mtmp, trap, in_sight).  The name is
// captured BEFORE the move (pre-movement visibility), and the destination
// branch order is: once-only vault trap, then a fixed teledest, then random.
// A fixed teledest that is occupied simply does nothing (unlike the hero, an
// incoming monster does not displace the resident).
export async function mtele_trap(mtmp, trap, in_sight) {
    let monname;

    /* don't print feedback here: a monster stepping on a trap and not
       teleporting from it isn't visible */
    if (noteleport_level(mtmp)) return;

    if (teleport_pet_(mtmp, false)) {
        const { Monnam } = await import('./uhitm.js');
        /* save name with pre-movement visibility */
        monname = Monnam(mtmp);

        /* Note: don't remove the trap if a vault.  Otherwise the monster will
         * be stuck there, since the guard isn't going to come for it. */
        if (trap.once) {
            await mvault_tele(mtmp);
        } else if (isok(trap.teledest?.x, trap.teledest?.y)) {
            if (!(m_at(trap.teledest.x, trap.teledest.y)
                  || u_at(trap.teledest.x, trap.teledest.y))) {
                await rloc_to_core(mtmp, trap.teledest.x, trap.teledest.y, RLOC_MSG);
            }
        } else {
            await rloc(mtmp, RLOC_NONE);
        }

        if (in_sight) {
            if (canseemon_tele(mtmp))
                await update_topl(`${monname} seems disoriented.`);
            else
                await update_topl(`${monname} suddenly disappears!`);
            const { seetrap } = await import('./trap.js');
            seetrap(trap);
        }
    }
}

// C ref: teleport.c:2005 mlevel_tele_trap(mtmp, trap, force_it, in_sight).
// RNG: the endgame MAGIC_PORTAL arm's rn2(7) (short-circuited by
// mon_has_amulet/is_home_elemental) and random_teleport_level() for
// LEVEL_TELEP.  Returns Trap_Effect_Finished or Trap_Moved_Mon.
export async function mlevel_tele_trap(mtmp, trap, force_it, in_sight) {
    const tt = (trap ? trap.ttyp : NO_TRAP);

    if (mtmp === game.u?.ustuck)   /* probably a vortex */
        return Trap_Effect_Finished;   /* temporary? kludge */
    if (teleport_pet_(mtmp, force_it)) {
        const tolevel = { dnum: 0, dlevel: 0 };
        let migrate_typ = MIGR_RANDOM;
        const { Monnam, mon_nam } = await import('./uhitm.js');

        if (is_hole(tt)) {
            if (Is_stronghold_()) {
                assign_level_(tolevel, valley_level_());
            } else if (Is_botlevel_()) {
                if (in_sight && trap.tseen)
                    await update_topl(`${Monnam(mtmp)} avoids the `
                        + `${(tt === HOLE) ? 'hole' : 'trap'}.`);
                return Trap_Effect_Finished;
            } else {
                assign_level_(tolevel, trap.dst);
                const { clamp_hole_destination } = await import('./trap.js');
                clamp_hole_destination(tolevel);
            }
        } else if (tt === MAGIC_PORTAL) {
            if (In_endgame_() && (mon_has_amulet_(mtmp)
                                  || await is_home_elemental_(mtmp.data)
                                  || rn2(7))) {
                if (in_sight && mtmp.data?.mcls !== S_ELEMENTAL_MCLS) {
                    await update_topl(`${Monnam(mtmp)} seems to shimmer for a moment.`);
                    const { seetrap } = await import('./trap.js');
                    seetrap(trap);
                }
                return Trap_Effect_Finished;
            } else {
                assign_level_(tolevel, trap.dst);
                migrate_typ = MIGR_PORTAL;
            }
        } else if (tt === LEVEL_TELEP || tt === NO_TRAP) {
            let nlev;

            if (mon_has_amulet_(mtmp) || In_endgame_()
                /* NO_TRAP is used when forcing a monster off the level;
                   onscary(0,0,) is true for the Wizard, Riders, lawful
                   minions, Angels, and a shk/priest inside his own room */
                || (tt === NO_TRAP && onscary(0, 0, mtmp))) {
                if (in_sight)
                    await update_topl(`${Monnam(mtmp)} seems very disoriented for a moment.`);
                return Trap_Effect_Finished;
            }
            if (tt === NO_TRAP) {
                /* creature is being forced off the level to make room */
                assign_level_(tolevel, game.u.uz);
            } else {
                nlev = random_teleport_level_();
                if (nlev === depth_(game.u.uz)) {
                    if (in_sight)
                        await update_topl(`${Monnam(mtmp)} shudders for a moment.`);
                    return Trap_Effect_Finished;
                }
                get_level_(tolevel, nlev);
            }
        } else {
            const { impossible } = await import('./display.js');
            await impossible(`mlevel_tele_trap: unexpected trap type (${tt})`);
            return Trap_Effect_Finished;
        }

        if (in_sight) {
            await update_topl(`Suddenly, ${mon_nam(mtmp)} `
                + `${(tt === HOLE) ? 'falls into a hole'
                   : (tt === TRAPDOOR) ? 'falls through a trap door'
                   : 'disappears out of sight'}.`);
            if (trap) {
                const { seetrap } = await import('./trap.js');
                seetrap(trap);
            }
        }
        if (is_xport(tt) && !control_teleport_(mtmp.data)) mtmp.mconf = 1;
        await migrate_to_level_(mtmp, ledger_no_(tolevel), migrate_typ, null);
        return Trap_Moved_Mon;   /* no longer on this level */
    }
    return Trap_Effect_Finished;
}

// C ref: teleport.c:2101 rloco(obj) — place a floor object at random.  RNG: a
// do/while that draws rn1(COLNO - 3, 2) THEN rn2(ROWNO) on EVERY iteration
// (including the one that breaks on try_limit), up to 4000 times.  Note the
// `if (!--try_limit) break;` sits between the draws and the condition, so the
// 4000th iteration still spends both draws and then leaves with whatever
// <tx,ty> it had.  Returns FALSE if the object is gone (revived or destroyed).
export async function rloco(obj) {
    let tx = 0, ty = 0, otx, oty;
    let restricted_fall;
    let try_limit = 4000;
    const dndest = dndest_();

    if (obj.otyp === CORPSE && is_rider_(mons_by_idx_(obj.corpsenm))) {
        if (await revive_corpse_(obj)) return false;
    }

    const { obj_extract_self } = await import('./invent.js');
    obj_extract_self(obj);
    otx = obj.ox;
    oty = obj.oy;
    restricted_fall = (otx === 0 && dndest.lx);
    do {
        tx = rn1(COLNO - 3, 2);
        ty = rn2(ROWNO);
        if (!--try_limit) break;
    } while (!goodpos(tx, ty, null, 0)
             || (restricted_fall
                 && (!within_bounded_area_(tx, ty, dndest.lx, dndest.ly,
                                           dndest.hx, dndest.hy)
                     || (dndest.nlx
                         && within_bounded_area_(tx, ty, dndest.nlx, dndest.nly,
                                                 dndest.nhx, dndest.nhy))))
             /* on the Wizard Tower levels, objects inside should stay inside
                and objects outside should stay outside */
             || (dndest.nlx && On_W_tower_level_()
                 && within_bounded_area_(tx, ty, dndest.nlx, dndest.nly,
                                         dndest.nhx, dndest.nhy)
                    !== within_bounded_area_(otx, oty, dndest.nlx, dndest.nly,
                                             dndest.nhx, dndest.nhy)));

    if (await flooreffects_(obj, tx, ty, 'fall')) {
        /* update old location (if any) since flooreffects() couldn't */
        if (!(otx === 0 && oty === 0)) newsym(otx, oty);
        return false;
    } else if (otx === 0 && oty === 0) {
        /* fell through a trap door; no update of old loc needed */
    } else {
        const { costly_spot, in_rooms } = await import('./shkroom.js');
        const shkp = find_objowner_(obj, otx, oty);
        const objinshop = shkp && costly_spot(otx, oty),
              onboundary = shkp && costly_adjacent_(shkp, otx, oty);

        /*
         * If object starts inside shop or is unpaid and on shop boundary:
         * hero outside the shop => theft; arrives inside same shop => off
         * bill; arrives on boundary => onto bill; arrives outside => theft.
         */
        if (objinshop || (obj.unpaid && onboundary)) {
            const h = (in_rooms(game.u.ux, game.u.uy, SHOPBASE) || '')[0] || '',
                  oo = (in_rooms(otx, oty, 0) || '')[0] || '';
            const hinshop = h && (in_rooms(shkp.mx, shkp.my, 0) || '').includes(h);

            if (hinshop && costly_spot(tx, ty)
                /* verify that it's the same shop */
                && oo && (in_rooms(tx, ty, 0) || '').includes(oo)) {
                if (obj.unpaid) await subfrombill_(obj, shkp);
            } else if (hinshop && costly_adjacent_(shkp, tx, ty)
                       && oo && (in_rooms(tx, ty, 0) || '').includes(oo)) {
                if (!obj.unpaid) await addtobill_(obj, false, false, false);
            } else {
                await stolen_value_(obj, otx, oty, false, false);
            }
        }

        newsym(otx, oty);   /* update old location */
    }
    place_object_(obj, tx, ty);
    /* note: block_point() for boulder handled by place_object() */
    newsym(tx, ty);
    return true;
}

// ---------------------------------------------------------------------------
// Shims for the section above.  Each names the C function it stands in for and
// where the real port lives.  The RNG-BEARING ones must be replaced before any
// of the functions above runs for score.
// ---------------------------------------------------------------------------

// C ref: mondata.h is_dlord/is_dprince — ports are js/artifact.js:586/587
// (private).  Demon lords/princes are M2_LORD / M2_PRINCE demons.
function is_dlord_(ptr) { return !!ptr?.demon && ((mflags2_of_(ptr) & M2_LORD) !== 0); }
function is_dprince_(ptr) { return !!ptr?.demon && ((mflags2_of_(ptr) & M2_PRINCE) !== 0); }
// C ref: mondata.h is_rider(ptr) / unique_corpstat(ptr) / haseyes(ptr) — ports
// are js/monmove.js:1392 / :1499 / :232, all private.  The Rider pmidx values
// are js/eat.js:137-139's (311/312/313), not the pm.h line numbers.
const PM_DEATH_TP = 311, PM_PESTILENCE_TP = 312, PM_FAMINE_TP = 313;
function is_rider_(ptr) {
    const i = ptr?.pmidx;
    return i === PM_DEATH_TP || i === PM_PESTILENCE_TP || i === PM_FAMINE_TP;
}
// C ref: monflag.h:194 G_UNIQ.
const G_UNIQ_TP = 0x1000;
function unique_corpstat_(ptr) { return !!ptr && (((ptr.geno | 0) & G_UNIQ_TP) !== 0); }
function haseyes_(ptr) { return (mflags1_of_(ptr) & M1_NOEYES) === 0; }
// monflags_data.js keeps the per-species flag words on the mons[] row; the two
// accessors below mirror js/monmove.js's private mflags1_of/mflags2_of.
function mflags1_of_(ptr) { return (ptr?.mflags1 ?? ptr?.mflags?.[0] ?? 0) | 0; }
function mflags2_of_(ptr) { return (ptr?.mflags2 ?? ptr?.mflags?.[1] ?? 0) | 0; }
// C ref: mkobj.c sobj_at(otyp, x, y) — port is js/muse.js:240, private.
function sobj_at_(otyp, x, y) {
    for (const o of (game.level?.objects || []))
        if (o.where === 'floor' && o.ox === x && o.oy === y && o.otyp === otyp)
            return o;
    return null;
}
// C ref: engrave.c sengr_at(str, x, y, strict) — UNPORTED.  No RNG.
function sengr_at_(_str, _x, _y, _strict) { return false; }
// C ref: dungeon.c In_hell/In_endgame/In_tutorial/On_W_tower_level/
// Is_stronghold/Is_botlevel/depth/on_level — mostly private in js/dungeon.js.
function Inhell_() { return !!game.u?.uz?.in_hell; }
function In_endgame_() { return (game.u?.uz?.dnum | 0) === (game.endgame_dnum | 0) && !!game.endgame_dnum; }
function In_tutorial_(_lev) { return false; }
function On_W_tower_level_() { return false; }
function Is_stronghold_() { return false; }
function Is_botlevel_() { return false; }
function depth_(lev) { return (lev?.dlevel | 0); }
function on_level_(a, b) { return !!a && !!b && a.dnum === b.dnum && a.dlevel === b.dlevel; }
function valley_level_() { return game.valley_level || { dnum: 0, dlevel: 0 }; }
function assign_level_(dst, src) { if (dst && src) { dst.dnum = src.dnum; dst.dlevel = src.dlevel; } }
function get_level_(dst, levnum) { if (dst) { dst.dnum = game.u?.uz?.dnum | 0; dst.dlevel = levnum; } }
function ledger_no_(lev) { return (lev?.dlevel | 0); }
// C ref: rect.c within_bounded_area — js/rect.js's real export.
function within_bounded_area_(x, y, lx, ly, hx, hy) {
    return within_bounded_area(x, y, lx, ly, hx, hy);
}
// C ref: decl.c svd.dndest / svu.updest — the special-level teleport regions.
function dndest_() { return game.dndest || { lx: 0, ly: 0, hx: 0, hy: 0, nlx: 0, nly: 0, nhx: 0, nhy: 0 }; }
function updest_() { return game.updest || { lx: 0, ly: 0, hx: 0, hy: 0, nlx: 0, nly: 0, nhx: 0, nhy: 0 }; }
// C ref: trap.c t_at(x, y) — port is js/hack.js:577 / js/trap.js, private.
function t_at_(x, y) {
    for (const t of (game.level?.traps || [])) if (t.tx === x && t.ty === y) return t;
    return null;
}
// C ref: region.c in_out_region(x, y) — js/region.js's real export.
function in_out_region_(x, y) { return in_out_region(x, y); }
// C ref: hack.h youmonst / mons[u.umonster].
function youmonst_() { return game.youmonst || game.u; }
function youmonster_data() { return game.youmonst?.data || game.u?.data; }
// C ref: mons[u.umonster] — enexto_core()'s null-mdat default.
function youmonster_data_() { return youmonster_data(); }
// C ref: mons[idx] — js/makemon.js:642 monster_by_pmidx() is the accessor but
// is only reachable from an async context; rloco()'s rider-corpse arm is the
// one caller and no covered session drops a Rider corpse.
function mons_by_idx_(_idx) { return null; }
const S_MIMIC_MCLS = 13;                       /* defsym.h MONSYM(13,'m',MIMIC) */
// C ref: uprop.h Levitation/Flying/Passes_walls/Punished/Teleportation.
function HProp_tp(name) { return (game.u?.uprops?.[name] | 0); }
function Levitation_() { return HProp_tp('HLevitation') > 0 || HProp_tp('ELevitation') > 0; }
function Flying_() { return HProp_tp('HFlying') > 0 || HProp_tp('EFlying') > 0; }
function Passes_walls_() { return HProp_tp('HPasses_walls') > 0; }
function Punished_() { return !!game.u?.uball; }
function Teleportation_() { return HProp_tp('HTeleportation') > 0 || HProp_tp('ETeleportation') > 0; }
function HTeleportation_() { return HProp_tp('HTeleportation'); }
function ETeleportation_() { return HProp_tp('ETeleportation'); }
function setHTeleportation_(v) { if (game.u?.uprops) game.u.uprops.HTeleportation = v; }
function setETeleportation_(v) { if (game.u?.uprops) game.u.uprops.ETeleportation = v; }
/* prop.h:143 I_SPECIAL — const.js:2384 has the same value. */
const I_SPECIAL_TP = 0x20000000;
function uball_() { return game.u?.uball || null; }
function uchain_() { return game.u?.uchain || null; }
function carried_(obj) { return obj?.where === 'invent'; }
function Stunned_tp() { return !!(game.u?.uprops?.HStun || game.u?.Stunned); }
function HStun_tp() { return HProp_tp('HStun'); }
function Confusion_tp() { return HProp_tp('HConfusion') > 0; }
async function make_stunned_tp(_xtime, _talk) { }   /* js/read.js:1538, private */
// C ref: include/hack.h distmin(x0,y0,x1,y1) — port is js/track.js:45, private.
function distmin_(x0, y0, x1, y1) {
    return Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
}
// C ref: vault.c vault_occupied(rooms) / findgd() — js/sounds.js:167/174, private.
function vault_occupied_(_rooms) { return false; }
function findgd_() { return null; }
// C ref: trap.c reset_utrap(msg) — js/read.js:1076, private.
function reset_utrap_(_msg) { const u = game.u; if (u) { u.utrap = 0; u.utraptype = 0; } }
// C ref: hack.c u_on_newpos(x, y) — js/mklev.js:170, private.
function u_on_newpos_(x, y) { const u = game.u; if (u) { u.ux = x; u.uy = y; } }
// C ref: display.c see_monsters() / notice_mon_off()/on() (mon.c) /
// vision.c vision_recalc(control) / detect.c switch_terrain().
function see_monsters_() { see_monsters(); }
function notice_mon_off_() { /* UNPORTED */ }
function notice_mon_on_() { /* UNPORTED */ }
function vision_recalc_(_control) { /* js/vision.js, via game.vision_full_recalc */ }
function switch_terrain_() { /* js/dig.js:870 is itself a NOT PORTED stub */ }
// C ref: mkroom.c search_special(type) / somexyspace(croom, c).  somexyspace is
// RNG-BEARING (somexy's rn2 pick); js/mkroom.js:145 exports it, and this shim
// exists only to avoid a new static import here.
function search_special_(_type) { return null; }
async function somexyspace_(_croom, _c) { return false; }
// C ref: mon.c mon_offmap(mon) / m_next2u(mtmp) — js/mon.js:1721 (private) and
// js/monmove.js:4303 (exported).
function mon_offmap_(mon) { return (mon?.mstate | 0) !== 0; }
async function m_next2u_(mtmp) { return distmin_(mtmp.mx, mtmp.my, game.u.ux, game.u.uy) <= 1; }
// C ref: teleport.c:785 teleport_pet(mtmp, force_it) — js/dig.js:910, private.
// No RNG for an unleashed pet.
function teleport_pet_(mtmp, _force_it) { return !mtmp?.mleashed; }
// C ref: mon.c migrate_to_level / muse.c's copy at js/muse.js:665 (private).
async function migrate_to_level_(_mtmp, _ledger, _migrtyp, _cc) { }
// C ref: eat.c control_teleport(ptr) — js/eat.js:1925, private.
function control_teleport_(_ptr) { return false; }
// C ref: muse.c mon_has_amulet(mon) — js/muse.js:445, private.
function mon_has_amulet_(_mon) { return false; }
// C ref: makemon.c is_home_elemental — js/makemon.js:1480 exports it.
async function is_home_elemental_(_ptr) { return false; }
// C ref: teleport.c:2190 random_teleport_level() — RNG-BEARING (rn2(5),
// rn2(cur+3-min), rnd(3)).  Ports at js/do.js:2075 and js/muse.js:467, private.
function random_teleport_level_() { return depth_(game.u?.uz); }
// C ref: teleport.c vault_tele/tele + read.c scrolltele — js/trap.js:2990 and
// js/zap.js:2834 (private); js/read.js:1094 exports scrolltele.
async function vault_tele_() { }
async function tele_() { }
// C ref: trap.c level_tele_trap(trap, trflags) — js/trap.js:3021, private.
async function level_tele_trap_(_trap, _trflags) { }
// C ref: display.c y_n / getpos — js/display.js exports y_n; js/hack.js:1860's
// getpos is private and has a different signature.
async function y_n_(_query) { return 'n'; }
async function getpos_(_cc, _force, _goal) { return -1; }
// C ref: do_name.c noit_mon_nam(mon) — js/dogmove.js:2010 has noit_Monnam.
function noit_mon_nam_(mon) { return mon?.data?.name || 'it'; }
// C ref: cmd.c wizard / flags.debug.
function wizard_() { return !!game.flags?.debug; }
// C ref: spell.c tport_spell(action) — UNPORTED (wizard-mode menu only).
function tport_spell_(_action) { return 0; }
// C ref: hack.c next_to_u() / do.c u_locomotion(def) — js/dig.js:907 and
// js/do.js:571, private.
function next_to_u_() { return true; }
function u_locomotion_(def) { return def; }
// C ref: eat.c morehungry(num) — js/fountain.js:50, private.  No RNG.
function morehungry_(num) { const u = game.u; if (u) u.uhunger = (u.uhunger | 0) - num; }
// C ref: spell.c known_spell / spelleffects / role.h Role_if / mondata.h
// can_teleport / objects[].oc_level / attrib.c exercise / invent.c
// check_capacity.
/* mkobj.js objects[] row 400 == SPE_TELEPORT_AWAY (js/cmd.js:2076 agrees). */
const SPE_TELEPORT_AWAY_TP = 400;
const spe_Unknown_TP = 0, spe_Fresh_TP = 1;   /* spell.h:22-23 */
const A_STR_TP = A_STR, A_WIS_TP = A_WIS;
function known_spell_(_otyp) { return spe_Unknown_TP; }
/* objects.h:1391 SPELL("teleport away", ..., level 6) -> energy 5*6 == 30. */
function spellev_(_otyp) { return 6; }
function Role_if_wizard_() { return (game.urole?.name?.m || '') === 'Wizard'; }
function can_teleport_(_ptr) { return false; }
function ACURR_tp(i) { return game.u?.acurr?.a?.[i] ?? 0; }
function exercise_(_attrib, _inc) { }
async function check_capacity_(_str) { return false; }
async function spelleffects_(_otyp, _atme, _nomsg) { return 0; }
// C ref: teleport.c rloc_pos_ok — the live port above is module-private under
// the same name; this indirection exists only so control_mon_tele() reads like C.
function rloc_pos_ok_(x, y, mtmp) { return rloc_pos_ok(x, y, mtmp); }
// C ref: trap.c flooreffects(obj, x, y, verb) — UNPORTED and RNG-BEARING
// (water/lava destruction rolls).  js/shk.c-side billing helpers are private.
async function flooreffects_(_obj, _x, _y, _verb) { return false; }
async function revive_corpse_(_obj) { return false; }
function find_objowner_(_obj, _x, _y) { return null; }
function costly_adjacent_(_shkp, _x, _y) { return false; }
async function subfrombill_(_obj, _shkp) { }
async function addtobill_(_obj, _a, _b, _c) { }
async function stolen_value_(_obj, _x, _y, _peaceful, _silent) { return 0; }
function place_object_(obj, x, y) { obj.where = 'floor'; obj.ox = x; obj.oy = y; }
// C ref: window.c create_nhwindow/start_menu/add_menu/end_menu/select_menu/
// destroy_nhwindow — the menu layer; js/invent.js has private no-op stubs.
function create_nhwindow_(type) { return { type, items: [] }; }
function start_menu_(_win) { }
function add_menu_(win, menulet, desc, preselected) {
    win.items.push({ menulet, desc, preselected });
}
function end_menu_(_win, _query) { }
async function select_menu_(_win, _how) { return null; }
function destroy_nhwindow_(_win) { }
