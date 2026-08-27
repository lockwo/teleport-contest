// do.js — level changes (descent / ascent) and the level-teleport command.
//
// C ref: do.c dodown()/doup()/goto_level(); dungeon.c next_level()/u_on_rndspot();
//        teleport.c level_tele()/wiz_level_tele(); mkmaze.c place_lregion().
//
// Scope: this port covers the wizard-mode level-teleport command (^V, the
// "wizlevelport" command) and the shared goto_level() machinery that
// re-invokes mklev() to generate a dlvl >= 2 the first time the hero visits
// it.  The exact C rn2/rnd/rn1 call sequence is reproduced left-to-right:
//
//   goto_level()  →  getbones() [rn2(3), inside mklev()]
//                 →  makelevel() structural generation
//                 →  fill_ordinary_room()/fill_special_room()/mineralize()
//                    (C does this inside makelevel(); the JS port factors the
//                     fill phase into fastforward_fill_mineralize())
//                 →  u_on_rndspot() → place_lregion(LR_UP/DOWNTELE)
//                 →  losedogs() → mon_arrive(With_you): rn2(10) + mnexto()
//
// The structural + fill phases reuse the real mklev.js / fastforward.js code
// paths that already generate the level-1 layout bit-for-bit; the placement
// and pet-follow phases are ported here (teleport.c collect_coords/enexto and
// dog.c mon_arrive are not otherwise available in the JS engine).

import { game } from './gstate.js';
import { exercise } from './attrib.js';
import { A_STR } from './const.js';
import { rn2, rn1, rnd, rnl, d } from './rng.js';
import { print_dungeon, builds_up, In_hell, Is_valley, surface,
         find_hell, dunlevs_in_dungeon, single_level_branch, level_difficulty_c,
         at_dgn_entrance, Is_bigroom } from './dungeon.js';

// insight.c record_achievement(), reached lazily: insight.js -> u_init.js ->
// mkobj.js is a static cycle this file must not join.
async function record_ach(achidx) {
    const { record_achievement } = await import('./insight.js');
    record_achievement(achidx);
}
import { mklev, place_lregion, u_on_upstairs } from './mklev.js';
import { fumaroles, movebubbles } from './mkmaze.js';
const PM_ROGUE_DO = 339;   // mons[] index; C's Role_if(PM_ROGUE)
import { clear_regions } from './region.js';
import { fastforward_fill_mineralize } from './fastforward.js';
import { depth as depth_of_level } from './hacklib.js';
import { COLNO, ROWNO, ROOM, CORR, AIR, LR_DOWNTELE, LR_UPTELE, STRAT_WAITFORU,
         STRAT_WAITMASK,
         ACCESSIBLE, IS_DOOR, D_CLOSED, D_LOCKED, In_quest, In_mines, In_endgame,
         MAGIC_PORTAL, POOL, MOAT, WATER, LAVAPOOL, LAVAWALL,
         STAIRS, LADDER, VIBRATING_SQUARE, TT_PIT, TOOKPLUNGE, is_pit, is_hole,
         UNENCUMBERED, SLT_ENCUMBER, In_sokoban, Is_knox_level,
         Is_rogue_level, Is_waterlevel, Is_airlevel,
         // additions used only by the do.c completeness ports at the end of
         // this file (const.js is a leaf module, so no new import edge).
         SINK, FOUNTAIN, THRONE, ALTAR, GRAVE, IS_ALTAR, IS_WATERWALL,
         DRAWBRIDGE_UP, DB_FLOOR, DB_UNDER, AM_NONE, Align2amask, F_LOOTED,
         T_LOOTED, SET_LIT_NOCHANGE, NO_TRAP, PIT, HOLE, TRAPDOOR,
         WT_SPLASH_THRESHOLD, ER_DESTROYED, HAND, LEG, Has_contents, WRITING,
         CXN_SINGULAR, REVIVE_MON, ROT_CORPSE, TIMER_OBJECT, RLOC_NOMSG,
         NON_PM, G_GENOD, LEFT_SIDE, RIGHT_SIDE, BOTH_SIDES, UTOTYPE_NONE,
         UTOTYPE_DEFERRED, UTOTYPE_ATSTAIRS, UTOTYPE_FALLING, UTOTYPE_PORTAL,
         UTOTYPE_RMPORTAL } from './const.js';
import { docrt, flush_screen, pline, update_topl, topl_more, y_n, newsym,
         see_nearby_objects } from './display.js';
import { seetrap, dotrap } from './trap.js';
import { check_special_room } from './shkroom.js';
import { near_capacity, addinv, prinv } from './invent.js';
import { BOULDER, run_object_timers, mksobj, AMULET_OF_YENDOR } from './mkobj.js';
import { vision_reset, vision_recalc, Blind, cansee,
         recalc_block_point } from './vision.js';
import { hide_monst } from './mon.js';
import { mflags2_of, M2_STALK, is_swimmer_flag, throws_rocks_flag,
         is_flyer_flag, mflags1_of, mflags3_of, M1_WALLWALK, M2_UNDEAD,
         M3_DISPLACES } from './monflags_data.js';
import { more_experienced, newexplevel } from './exper.js';
import { olfaction } from './eat.js';
import { placebc, unplacebc } from './ball.js';

// C ref: dungeon.c level_difficulty() — factor of difficulty from depth,
// bumped in a "builds up" branch (Sokoban / Vlad's Tower) to compensate for
// depth() alone making their harder-to-reach levels look easier.  The amulet
// / endgame variants are not exercised.
const PM_TOURIST = 10; // makemon/exper PM index
function level_difficulty() { return level_difficulty_c(); }
import { mon_catchup_elapsed_time, monnear } from './dogmove.js';
import { onquest, com_pager } from './questpgr.js';
import { initrack } from './track.js';

// ── small geometry / occupancy helpers (C ref: mklev.c occupied,
//    mkmaze.c bad_location, teleport.c goodpos/collect_coords/enexto) ──

function isok(x, y) {
    return x >= 1 && x < COLNO && y >= 0 && y < ROWNO;
}

// C ref: trap.c t_at — is there a trap at <x,y>?
function t_at(x, y) {
    for (const t of game.level?.traps ?? [])
        if (t.tx === x && t.ty === y) return t;
    return null;
}

// C ref: mon.c m_at — is there a (live) monster at <x,y>?
function m_at(x, y) {
    for (const m of game.level?.monsters ?? [])
        if (m.mx === x && m.my === y) return m;
    return null;
}

function within_bounded_area(x, y, lx, ly, hx, hy) {
    return x >= lx && x <= hx && y >= ly && y <= hy;
}

// C ref: mklev.c occupied() — a trap, furniture, lava, pool or invocation
// spot makes a square unusable for hero/monster placement.  Furniture and
// liquids are already excluded by the ROOM/CORR/AIR typ test in
// bad_location(), so the only extra rejection here is t_at().
function occupied(x, y) {
    return !!t_at(x, y);
}

// C ref: mkmaze.c bad_location().  Faithful to the C predicate so that
// place_lregion()'s probabilistic loop consumes exactly the same number of
// rn1() draws as the C engine.  (mklev.js has a simplified bad_location that
// omits the t_at() check; we use this trap-aware version for level-teleport
// arrival to keep the loop length in sync.)
function bad_location(x, y, nlx, nly, nhx, nhy) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    if (occupied(x, y)) return true;
    if (within_bounded_area(x, y, nlx, nly, nhx, nhy)) return true;
    const typ = loc.typ;
    const is_maze = !!game.level?.flags?.is_maze_lev;
    return !((typ === CORR && is_maze) || typ === ROOM || typ === AIR);
}

// C ref: mkmaze.c place_lregion() — place the hero at a random location
// within the region (the whole level when lx==0), retrying on bad squares.
// This is the level-teleport / fall-through arrival placement.  Each retry
// draws rn1((hx-lx)+1, lx) for x and rn1((hy-ly)+1, ly) for y.
function place_hero_lregion(lx, ly, hx, hy, nlx, nly, nhx, nhy) {
    if (!lx) { lx = 1; hx = COLNO - 1; ly = 0; hy = ROWNO - 1; }
    if (lx < 1) lx = 1;
    if (hx > COLNO - 1) hx = COLNO - 1;
    if (ly < 0) ly = 0;
    if (hy > ROWNO - 1) hy = ROWNO - 1;

    // C ref: put_lregion_here() for LR_*TELE — besides bad_location, a square
    // occupied by a monster is rejected (return FALSE -> try again) unless this
    // is the deterministic one-shot fallback (oneshot, lx==hx&&ly==hy), where
    // the monster is relocated instead.  The Big Room is densely populated, so
    // this monster rejection is what makes the C placement loop iterate.
    for (let trycnt = 0; trycnt < 200; trycnt++) {
        const x = rn1((hx - lx) + 1, lx);
        const y = rn1((hy - ly) + 1, ly);
        if (!bad_location(x, y, nlx, nly, nhx, nhy) && !m_at(x, y)) {
            game.u.ux = x; game.u.uy = y;
            return;
        }
    }
    // deterministic fallback (oneshot): bad_location only; a monster here would
    // be relocated by rloc in C.
    for (let x = lx; x <= hx; x++)
        for (let y = ly; y <= hy; y++)
            if (!bad_location(x, y, nlx, nly, nhx, nhy)) {
                game.u.ux = x; game.u.uy = y;
                return;
            }
}

// C ref: dungeon.c u_on_newpos(x, y) — put the hero on a specific square.
// The off-map validation is a panic()/impossible() in C, i.e. never reached
// with a legal argument.  The "still on same level" arm is the one hack.c's
// domove_core() takes (see cmd.js, which inlines it); goto_level() always takes
// the other arm, because u.uz was already switched to the destination and u.uz0
// still names the level being left.  There map_location() only seeds
// lastseentyp for a later switch_terrain(), and the subsequent docrt() repaints
// the whole level anyway, so it has no observable effect here.  Consumes no RNG.
export function u_on_newpos(x, y) {
    const u = game.u;
    u.ux = x;
    u.uy = y;
    u.uundetected = 0;
    /* a ridden steed always shares the hero's location */
    if (u.usteed) { u.usteed.mx = u.ux; u.usteed.my = u.uy; }
    if (u.uz?.dnum !== u.uz0?.dnum || u.uz?.dlevel !== u.uz0?.dlevel) {
        /* changing levels: don't leave the old position set with stale values */
        u.ux0 = u.ux; u.uy0 = u.uy;
    } else {
        see_nearby_objects();
    }
}

// C ref: dungeon.c u_on_rndspot().  Level-teleport / fall arrival uses the
// up/down-teleport destination region (both default to the whole level when
// goto_level memset svu.updest / svd.dndest to zero).
function u_on_rndspot(upflag) {
    const up = (upflag & 1);
    // C: goto_level() memsets svu.updest / svd.dndest to zero before mklev(),
    // and a special level's des.teleport_region() (via fixup_special()'s
    // LR_*TELE arm) fills the matching one back in.  An unspecified region
    // (.lx == 0) makes place_lregion() default to the entire level.
    // (The was_in_W_tower arm is Vlad's-Tower-only and never reached here.)
    const dest = up ? game.updest : game.dndest;
    place_hero_lregion(dest?.lx || 0, dest?.ly || 0, dest?.hx || 0, dest?.hy || 0,
                       dest?.nlx || 0, dest?.nly || 0, dest?.nhx || 0, dest?.nhy || 0,
                       up ? LR_UPTELE : LR_DOWNTELE);
}

// ── pet follow (C ref: dog.c keepdogs()/losedogs()/mon_arrive(With_you)) ──

// C ref: rm.h closed_door(x, y) == (IS_DOOR(levl[x][y].typ)
//                                   && (levl[x][y].doormask & (D_CLOSED|D_LOCKED)))
function closed_door(x, y) {
    const lev = game.level?.at(x, y);
    if (!lev) return false;
    return IS_DOOR(lev.typ) && ((lev.doormask & (D_CLOSED | D_LOCKED)) !== 0);
}

// C ref: monmove.c accessible(x, y) == (ACCESSIBLE(SURFACE_AT(x,y))
//                                      && !closed_door(x, y)).
// goodpos() calls THIS, not the bare ACCESSIBLE() macro — a closed or locked
// door is NOT a good position for an ordinary monster (only amorphous ones get
// the `amorphous(mdata) && closed_door(x,y) -> TRUE` early-out above it, and no
// pet is amorphous).  SURFACE_AT's drawbridge indirection is not modelled: no
// session places a monster in front of a closed drawbridge.
function accessible_mon(x, y) {
    const typ = game.level?.at(x, y)?.typ;
    return typ != null && ACCESSIBLE(typ) && !closed_door(x, y);
}

function goodpos_mon(x, y, mtmp) {
    if (!isok(x, y)) return false;
    if (game.u?.ux === x && game.u?.uy === y) return false;
    if (m_at(x, y)) return false;
    // C ref: teleport.c goodpos() — `if (!accessible(x, y)) return FALSE;`.
    // enexto() takes the FIRST goodpos candidate out of the collect_coords ring
    // order, so accepting a square C refuses relocates the monster while
    // consuming IDENTICAL RNG — an invisible, non-RNG placement fork.  Two bugs
    // lived here: the threshold was `typ >= 13` with a comment claiming 13 was
    // DOOR (it is TREE; DOOR is 23), and the closed-door rejection was missing
    // entirely.  A pet arriving on a new level was landing in a closed doorway.
    //
    // The three tests below sit AHEAD of accessible() in C, and their order is
    // observable through enexto(): each one C applies and we don't lets a pet
    // take an earlier ring square than C does, forking placement while the RNG
    // stream stays identical.
    // C ref: dbridge.c is_pool() — POOL/MOAT/WATER (is_moat()'s drawbridge
    // indirection is unmodelled).  These used to be flat rejections justified by
    // "no contest pet swims or flies"; C's real answers are the mondata.h flag
    // tests, and goodpos() feeds enexto(), which takes the FIRST accepted ring
    // square — so a wrong answer relocates the monster while the RNG stream
    // stays identical (an invisible placement fork).
    const mdat = mtmp?.data ?? null;
    const typ = game.level?.at(x, y)?.typ;
    if (typ === POOL || typ === MOAT || typ === WATER)
        return is_swimmer_flag(mdat) || m_in_air_do(mtmp);
    // C ref: teleport.c goodpos() — an out-of-water eel usually refuses the
    // square, and this rn2(13) FIRES whenever an eel is offered one.
    if (mdat?.mcls === S_EEL_DO && rn2(13)) return false;
    // C ref: dbridge.c is_lava() — LAVAPOOL/LAVAWALL; mondata.h:190 likes_lava.
    if (typ === LAVAPOOL || typ === LAVAWALL)
        return m_in_air_do(mtmp) || likes_lava_do(mdat);
    if (!accessible_mon(x, y)) return false;
    // C ref: teleport.c goodpos() — `sobj_at(BOULDER, x, y) && !throws_rocks`.
    if (sobj_at(BOULDER, x, y) && !throws_rocks_flag(mdat)) return false;
    return true;
}

// C ref: mon.c m_in_air(mon) — `is_flyer(mon->data) || is_floater(mon->data)
// || (is_clinger(mon->data) && has_ceiling(&u.uz) && mon->mundetected)`.  It
// reads the SPECIES, not per-monster flags: `mtmp->mflying` does not exist in
// C, so this answered FALSE for every flyer and goodpos() refused pool/lava
// squares C accepts — an invisible, RNG-free enexto() placement fork.
// goodpos()'s caller here is enexto_core(), which passes a zeroed fake monst
// carrying only mdat, so the is_clinger arm's mundetected is always 0.
function m_in_air_do(mtmp) {
    const d = mtmp?.data;
    if (!d) return false;
    // C ref: mondata.h is_floater(ptr) — mlet == S_EYE || mlet == S_LIGHT.
    return is_flyer_flag(d) || d.mcls === S_EYE_DO || d.mcls === S_LIGHT_DO;
}
const S_EYE_DO = 5, S_LIGHT_DO = 25;  // defsym.h MONSYM S_EYE / S_LIGHT
// C ref: mondata.h:190 likes_lava(ptr) — fire elemental / salamander only.
function likes_lava_do(mdat) {
    return mdat?.pmidx === 155 /*PM_FIRE_ELEMENTAL*/
        || mdat?.pmidx === 329 /*PM_SALAMANDER*/;
}
const S_EEL_DO = 57;   // defsym.h MONSYM(57, ';', EEL, S_EEL, ...)

// C ref: teleport.c collect_coords — candidate spots in expanding rings,
// each ring shuffled with rn2 in the same order as the C engine.
function collect_coords(cx, cy, maxradius) {
    const out = [];
    const rowrange = (cy < ROWNO / 2) ? (ROWNO - 1 - cy) : cy;
    const colrange = (cx < COLNO / 2) ? (COLNO - 1 - cx) : cx;
    const kmax = Math.max(rowrange, colrange);
    maxradius = maxradius ? Math.min(maxradius, kmax) : kmax;

    for (let radius = 1; radius <= maxradius; radius++) {
        const ringStart = out.length;
        const lox = cx - radius, hix = cx + radius;
        const loy = cy - radius, hiy = cy + radius;
        for (let y = Math.max(loy, 0); y <= hiy; y++) {
            if (y > ROWNO - 1) break;
            for (let x = Math.max(lox, 1); x <= hix; x++) {
                if (x > COLNO - 1) break;
                if (x !== lox && x !== hix && y !== loy && y !== hiy) continue;
                out.push({ x, y });
            }
        }
        let n = out.length - ringStart;
        let base = ringStart;
        while (n > 1) {
            const kk = rn2(n);
            if (kk) {
                const tmp = out[base];
                out[base] = out[base + kk];
                out[base + kk] = tmp;
            }
            base++;
            n--;
        }
    }
    return out;
}

// C ref: teleport.c enexto_core — first goodpos spot, nearest rings first
// (radius 1-3), then the whole map.
function enexto(xx, yy, mtmp) {
    const near = collect_coords(xx, yy, 3);
    for (const c of near)
        if (goodpos_mon(c.x, c.y, mtmp)) return c;
    const all = collect_coords(xx, yy, 0);
    for (let i = near.length; i < all.length; i++)
        if (goodpos_mon(all[i].x, all[i].y, mtmp)) return all[i];
    return null;
}

// C ref: mon.c:3955 mnexto(mtmp, rlocflags) — put the monster next to the hero.
// The enexto() search DRAWS (collect_coords shuffles every ring it gathers), so
// a caller that "leaves the relocation to someone else" loses those calls.
// C's enexto() is enexto_core(GP_CHECKSCARY) || enexto_core(NO_MM_FLAGS); the
// scary-square filter only matters on a square with a scare-monster item or
// Elbereth, so the first pass answers here and the second never runs.
// (the module-private mnexto() below is the same C routine minus the
// rloc_to_core() display/track bookkeeping; kept separate so the pet-arrival
// path it serves is not perturbed.)
export async function mnexto_rloc(mtmp, rlocflags = 0) {
    const u = game.u;
    if (mtmp === u?.usteed) { mtmp.mx = u.ux; mtmp.my = u.uy; return; }
    // C ref: mon.c mnexto() — `enexto(&mm, u.ux, u.uy, mtmp->data)`.  The mdat
    // was being dropped, so goodpos() judged every candidate square as if for a
    // species with no flags: a flying engulfer was refused the pool square C
    // puts it on (seed0383 step 177) with the ring shuffle drawing identically.
    // enexto_core() builds a zeroed fake monst carrying only mdat, so pass the
    // same thing rather than the live monster.
    const mm = enexto(u.ux, u.uy, { data: mtmp?.data ?? null });
    if (!mm || !isok(mm.x, mm.y)) return;   // deal_with_overcrowding -> limbo
    const { rloc_to_core } = await import('./teleport.js');
    await rloc_to_core(mtmp, mm.x, mm.y, rlocflags);
}

// C ref: dog.c mon_arrive(mtmp, With_you).  A tame pet either lands on the
// hero's exact spot (1-in-10 when that square is free) or, far more often,
// is relocated next to the hero via mnexto()->enexto().
function mon_arrive_with_you(mtmp) {
    const u = game.u;
    // C ref: dog.c mon_arrive() — before placing the arriving monster, clear its
    // movement track (mon_track_clear) and refresh the apparent-hero position
    // (mtmp->mux = u.ux, mtmp->muy = u.uy) so the pet's dog_move backtrack
    // avoidance and goal logic don't reuse coordinates from the level just left.
    mtmp.mtrack = [];
    mtmp.mux = u.ux; mtmp.muy = u.uy;
    if (!m_at(u.ux, u.uy) && !rn2(mtmp.mtame ? 10 : mtmp.mpeaceful ? 5 : 2)) {
        // rloc_to(mtmp, u.ux, u.uy) — lands on hero's square (no extra rng)
        mtmp.mx = u.ux; mtmp.my = u.uy;
    } else {
        const cc = enexto(u.ux, u.uy, mtmp); // mnexto -> enexto
        if (cc) { mtmp.mx = cc.x; mtmp.my = cc.y; }
    }
}

// C ref: mondata.c:1211 levl_follower(mtmp) — used by keepdogs() to decide
// whether a nearby monster accompanies a level change.  Tame pets, the Wizard
// of Yendor and a following shopkeeper always qualify (even while fleeing); a
// hostile M2_STALK monster (e.g. the water demon a fountain can unleash)
// follows unless it is currently fleeing and the hero has no Amulet.  The one
// monster that refuses is the Wizard once HE holds the Amulet — he wants to
// fight, not chase.  This was a species-name Set that had drifted off M2_STALK:
// it listed the vampire mage and the Goblin King (neither stalks) and omitted
// the vampire lord/lady/leader and incubus/succubus/amorous demon.  The iswiz
// arms were then omitted as "no recorded session drives a followed Wizard",
// which is false: seed0373's wizard-mode level teleports drag him from the
// Plane of Fire to the Plane of Air (step 110, C's second mon_arrive rn2(2)).
function levl_follower(m) {
    if (m === game.u.usteed) return true;
    /* Wizard with Amulet won't bother trying to follow across levels */
    if (m.iswiz && mon_has_amulet(m)) return false;
    /* some monsters will follow even while intending to flee from you */
    if (m.mtame || m.iswiz || is_fshk(m)) return true;
    if (mflags2_of(m.data) & M2_STALK)
        return !m.mflee || !!game.u.uhave?.amulet;
    return false;
}

// C ref: wizard.c:106 mon_has_amulet(mtmp) — the REAL Amulet in its inventory
// (the plastic imitation, otyp 212, does not count).
function mon_has_amulet(m) {
    return (m?.minvent || []).some((o) => o.otyp === AMULET_OF_YENDOR);
}

// C ref: shk.c:5012 is_fshk(mtmp) — `mtmp->isshk && ESHK(mtmp)->following`, a
// shopkeeper chasing the hero over an unpaid bill.  eshk.following is not
// modelled in this port, so this answers FALSE for every shopkeeper; the
// hostile-shk chase itself is unported, not merely unreached.
function is_fshk(_m) { return false; }

// C ref: include/monst.h helpless(mon) = msleeping || !mcanmove.
function keepdogs_helpless(m) {
    return !!(m.msleeping || !m.mcanmove);
}

// C ref: dog.c keepdogs()/losedogs().  Capture the monsters that accompany
// the hero across a level change before the level is torn down by mklev():
// a nearby tame pet, or a nearby non-fleeing M2_STALK hostile (levl_follower),
// as long as it isn't helpless, isn't still waiting to notice the hero
// (STRAT_WAITFORU), and isn't mid-meal/trapped (which leaves it behind rather
// than following).  Re-placed next to the hero on the new level by
// losedogs_place(); the only RNG this consumes is mon_arrive(With_you)'s
// rn2(10)/rn2(5)/rn2(2).
function keepdogs_capture() {
    const lev = game.level;
    if (!lev?.monsters) return [];
    const u = game.u;
    const kept = [];
    const remain = [];
    for (const m of lev.monsters) {
        const follows = monnear(m, u.ux, u.uy) && levl_follower(m);
        const eligible = follows
            && (!keepdogs_helpless(m) || m === u.usteed)
            && !((m.mstrategy || 0) & STRAT_WAITFORU)
            && !m.meating && !m.mtrapped;
        if (eligible) kept.push(m);
        else remain.push(m);
    }
    lev.monsters = remain;
    return kept;
}

function losedogs_place(kept) {
    if (!game.level.monsters) game.level.monsters = [];
    for (const m of kept) {
        mon_arrive_with_you(m);
        game.level.monsters.push(m);
    }
}

// C ref: you.h next2u(px,py) — distu(px,py) <= 2 (within one step of hero).
function next2u(x, y) {
    const u = game.u;
    const dx = x - u.ux, dy = y - u.uy;
    return (dx * dx + dy * dy) <= 2;
}

// C ref: mon.c mnexto(mtmp, rlocflags) — relocate mtmp to a free spot next to
// the hero via enexto(); on failure the monster goes to limbo (off-map).  The
// enexto() near-ring scan consumes the same collect_coords rn2() draws as C.
function mnexto(mtmp) {
    const cc = enexto(game.u.ux, game.u.uy, mtmp); // enexto(&mm, u.ux, u.uy, mtmp->data)
    if (!cc) {
        // deal_with_overcrowding -> m_into_limbo: remove from the live level.
        const mons = game.level?.monsters;
        if (mons) { const i = mons.indexOf(mtmp); if (i >= 0) mons.splice(i, 1); }
        return;
    }
    mtmp.mx = cc.x; mtmp.my = cc.y; // rloc_to(mtmp, mm.x, mm.y)
}

// C ref: do.c u_collide_m() — on level arrival a monster shares the hero's
// square (typically the pet that accompanied the hero and landed on the hero's
// exact spot in mon_arrive()).  Randomly move the hero to an adjacent spot or,
// far more often, move the monster to any nearby location.
function u_collide_m(mtmp) {
    const u = game.u;
    // C: if (!rn2(2) && enexto(&cc, u.ux, u.uy, youmonst.data) && next2u(cc.x, cc.y))
    //        u_on_newpos(cc.x, cc.y);  else  mnexto(mtmp, RLOC_NOMSG);
    // The && short-circuits: rn2(2) is always drawn; enexto only when !rn2(2).
    let cc;
    if (!rn2(2) && (cc = enexto(u.ux, u.uy)) && next2u(cc.x, cc.y)) {
        u.ux = cc.x; u.uy = cc.y; // u_on_newpos
    } else {
        mnexto(mtmp);
    }
    // C: if still a monster in the hero's way, rloc it; if that fails, limbo it.
    const still = m_at(u.ux, u.uy);
    if (still) {
        const mons = game.level?.monsters;
        if (mons) { const i = mons.indexOf(still); if (i >= 0) mons.splice(i, 1); }
    }
}

// C ref: hack.c losehp() — HP subtraction only; death handling isn't reached by
// the covered sessions (matching every other file-local losehp() in this port).
async function losehp_do(n) {
    const u = game.u;
    if (!u || n <= 0) return;
    u.uhp = (u.uhp ?? 0) - n;
    if (u.uhp > u.uhpmax) u.uhpmax = u.uhp;
    if (u.uhp < 0) u.uhp = 0;
    // C ref: hack.c losehp() — lethal damage emits urgent_pline("You die...")
    // and immediately enters done(DIED).  Keeping this in the shared helper
    // covers fall/lava/trap damage, whose callers otherwise continue one input
    // boundary past death and start disclosure out of phase.
    if (u.uhp < 1 && !game.program_state?.gameover) {
        await update_topl('You die...');
        const { done, DIED } = await import('./end.js');
        await done(DIED);
        return;
    }
    // C ref: hack.c losehp() tail — the low-HP warning is the nonlethal arm;
    // a lethal hit takes the branch above before maybe_wail() can run.
    if (n > 0 && u.uhp * 10 < (u.uhpmax ?? 0)) await maybe_wail();
}

// C ref: hack.c maybe_wail() — the low-HP warning, throttled to once per 50
// moves through gw.wailmsg.
async function maybe_wail() {
    const u = game.u;
    if ((game.moves ?? 0) <= (game._wailmsg ?? 0) + 50) return;
    game._wailmsg = game.moves ?? 0;
    const isWiz = game.urole?.name?.m === 'Wizard';
    const isValk = game.urole?.name?.m === 'Valkyrie';
    const isElf = String(game.urace?.noun || '').toLowerCase() === 'elf';
    if (isWiz || isElf || isValk) {
        const who = (isWiz || isValk) ? game.urole?.name?.m : 'Elf';
        if (u.uhp === 1) await update_topl(`${who} is about to die.`);
        else await update_topl(`${who}, your life force is running out.`);
    } else {
        await update_topl(u.uhp === 1 ? 'You hear the wailing of the Banshee...'
                                      : 'You hear the howling of the CwnAnnwn...');
    }
    game._toplin = 1;
}
// C ref: youprop.h Fumbling / Flying — the two transit modifiers do.c:1776-1781
// tests.  Fumbling comes from HFumbling/EFumbling (allmain.js reads the same
// pair); Flying/Levitation are carried in u.uprops by polyself.js/potion.js.
function Fumbling_do() { return !!(game.u?.HFumbling || game.u?.EFumbling); }
function Flying_do() {
    return !!(game.u?.HFlying || game.u?.EFlying || game.u?.uprops?.Flying);
}
function Levitation_do() { return !!game.u?.uprops?.Levitation; }
// C ref: youprop.h Punished — u.uball is set only while punished.
function Punished_do() { return !!game.u?.uball; }

// C ref: ball.c drag_down() — the punishment ball follows the hero down the
// stairs.  Its cls() first flushes WIN_MESSAGE (the --More-- the hoisted
// transit message already emitted) and then clears the map + status windows,
// which is why the next captured frame is blank except for the topline.
async function drag_down_hero() {
    const u = game.u;
    const uball = u?.uball;
    let dragchance = 3;
    const carried_ball = !!uball && uball.where === 'invent';
    const welded_ball = false;   // welded(uball) needs a cursed WIELDED ball
    const forward = carried_ball && (u.uwep === uball || !u.uwep || !rn2(3));
    if (carried_ball && !welded_ball) await pline('You lose your grip on the iron ball.');
    // cls(): clear_nhwindow(WIN_MAP) clears the PHYSICAL screen.  goto_level's
    // following docrt() only rebuilds gg.gbuf; its flush_screen(-1) toggles
    // delay_flushing, so nothing reaches the terminal until more()'s docorner().
    game._screenBlank = true;
    if (forward) {
        if (rn2(6)) {
            await pline('The iron ball drags you downstairs!');
            await losehp_do(rnd(6));
        }
    } else {
        if (rn2(2)) {
            await pline('The iron ball smacks into you!');
            game._toplin = 1;   // C pline() leaves toplin == TOPLINE_NEED_MORE
            await losehp_do(rnd(20));
            exercise(A_STR, false);
            dragchance -= 2;
        }
        if (dragchance >= rnd(6)) {
            await pline('The iron ball drags you downstairs!');
            await losehp_do(rnd(3));
            exercise(A_STR, false);
        }
    }
}

// C ref: hack.c u_locomotion(def) — the verb for the hero's mode of travel.
// locomotion(youmonst.data, def) below it only differs for a polymorphed hero
// (nolimbs -> "slither", etc.), which no covered role reaches.
function u_locomotion(def) {
    return Levitation_do() ? 'float' : Flying_do() ? 'fly' : def;
}

// C ref: trap.c uteetering_at_seen_pit()/uescaped_shaft() — the hero is standing
// on a seen pit (without being caught in it) or on a seen hole/trap door.  Both
// make '>' a deliberate plunge rather than a "you can't go down here".
function uteetering_at_seen_pit(trap) {
    const u = game.u;
    return !!trap && is_pit(trap.ttyp) && !!trap.tseen
        && trap.tx === u.ux && trap.ty === u.uy
        && !(u.utrap && u.utraptype === TT_PIT);
}
function uescaped_shaft(trap) {
    const u = game.u;
    return !!trap && is_hole(trap.ttyp) && !!trap.tseen
        && trap.tx === u.ux && trap.ty === u.uy;
}

// C ref: hack.c u_rooted() — a hero whose current form has mmove == 0 (a
// polymorphed-into-a-tree/lichen case) cannot move at all, and BOTH callers
// return ECMD_TIME, so the failed '>'/'<' still costs the turn (the monsters
// move, drawing RNG).  nomul(0) must leave go.occupation armed (see rngstep
// notes), which hack.js nomul(0) preserves.
async function u_rooted() {
    const mdat = game.u?.data;
    if (!mdat || mdat.mmove !== 0) return false;
    await pline(`You are rooted ${
        (Levitation_do() || Flying_do()) ? 'in place' : 'to the ground'}.`);
    const { nomul } = await import('./hack.js');
    nomul(0);
    return true;
}

// C ref: steed.c stucksteed(checkfeeding) — a helpless or still-eating steed
// refuses to move; the command is aborted with no time passing.
async function stucksteed(checkfeeding) {
    const steed = game.u?.usteed;
    if (!steed) return false;
    if (steed.msleeping || !steed.mcanmove) {
        await pline(`Your ${steed.data?.name ?? 'steed'} won't move!`);
        return true;
    }
    if (checkfeeding && steed.meating) {
        await pline(`Your ${steed.data?.name ?? 'steed'} is still eating.`);
        return true;
    }
    return false;
}

// C ref: pline.c Norep() — suppress the message when it is identical to the
// persistent top line (gt.toplines), which survives the command prompt.
async function Norep_do(msg) {
    if (game._toplines === msg) return;
    await update_topl(msg);
}

// C ref: mkobj.c sobj_at(otyp, x, y).  NOT js/invent.js's sobj_at: that one
// indexes game.level.objects as a 2-D `[x][y]` grid while place_object() keeps
// it as a FLAT push-ordered array, so it answered null for every square and
// silently disabled the boulder test in climb_pit() below (js/muse.js keeps the
// same private copy for the same reason).  Boolean use only, so pile order
// doesn't matter.
function sobj_at(otyp, x, y) {
    for (const o of game.level?.objects ?? [])
        if (o.where === 'floor' && o.ox === x && o.oy === y && o.otyp === otyp)
            return o;
    return null;
}

// C ref: trap.c climb_pit() — what '<' does when the hero is caught in a pit.
// The rn2(2) is ALWAYS drawn (C evaluates `!rn2(2) && sobj_at(...)` left to
// right), so this is not an RNG-free branch even when there is no boulder.
// Passes_walls needs a polymorph/amulet and is not modelled.
async function climb_pit() {
    const u = game.u;
    if (!u.utrap || u.utraptype !== TT_PIT) return;
    if (!rn2(2) && sobj_at(BOULDER, u.ux, u.uy)) {
        await pline('Your leg gets stuck in a crevice.');
        // C: display_nhwindow(WIN_MESSAGE, FALSE) + clear_nhwindow() — force the
        // --More-- so the second line starts a fresh top line.
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
        await pline('You free your leg.');
    } else if (Flying_do() && !In_sokoban(u.uz)) {
        // C also admits is_clinger(youmonst.data) here (polymorph only).
        u.utrap = 0; u.utraptype = 0;
        await pline(`You ${u_locomotion('climb')} from the pit.`);
        game.vision_full_recalc = 1;
    } else if (!(--u.utrap) || m_easy_escape_pit()) {
        u.utrap = 0; u.utraptype = 0;
        await pline(`You ${
            (In_sokoban(u.uz) && Levitation_do())
                ? 'struggle against the air currents and float'
                : u.usteed ? 'ride' : 'crawl'} to the edge of the pit.`);
        game.vision_full_recalc = 1;
    } else if (u.dz || game.flags?.verbose !== false) {
        if (u.usteed)
            await Norep_do(`Your ${u.usteed.data?.name ?? 'steed'} is still in a pit.`);
        else
            await Norep_do((game.u?.uhallu && !rn2(5))
                ? "You've fallen, and you can't get up."
                : 'You are still in a pit.');
    }
}
// C ref: trap.c m_easy_escape_pit() — a pit fiend or any MZ_HUGE-or-bigger
// monster steps straight out.  MZ_HUGE == 4 (include/monflag.h).
function m_easy_escape_pit() {
    const mdat = game.u?.data;
    return !!mdat && (mdat.msize ?? 0) >= 4;
}

// C ref: dungeon.c on_level(&u.uz, &qstart_level); game.qstart_level comes from
// dungeon.js's branch table.
function on_qstart_level_do() {
    const uz = game.u?.uz, q = game.qstart_level;
    return !!(uz && q && uz.dnum === q.dnum && uz.dlevel === q.dlevel);
}

// C ref: quest.c ok_to_quest() — `((got_quest || got_thanks) && is_pure() > 0)
// || killed_leader`.
function ok_to_quest_do() { return !!game._quest_got_quest; }

// ── goto_level (C ref: do.c goto_level) ──
//
// Restricted to the level-teleport / first-visit-makelevel path used by the
// wizard ^V command in the recorded sessions: makes the destination level if
// it has not been visited, places the hero at a random spot, and brings the
// adjacent pet along.
export async function goto_level(newlevel, at_stairs, falling, portal) {
    const g = game;
    const u = g.u;
    g._goto_familiar = false;

    // C ref: do.c goto_level():1503 — a destination past the bottom of its own
    // dungeon is clamped BEFORE anything reads it, so `up`, `newdungeon`, the
    // ledger and mklev() all see the clamped level.  Reachable from a branch
    // stairway into a shorter dungeon and from a hole/trap-door destination.
    // (guarded on >0: dunlevs_in_dungeon() answers 0 for a dnum the JS ledger
    // hasn't built, where C always has a real dungeon record.)
    const ndunlevs = dunlevs_in_dungeon(newlevel);
    if (ndunlevs > 0 && newlevel.dlevel > ndunlevs)
        newlevel.dlevel = ndunlevs;

    const up = depth_of_level(newlevel) < depth_of_level(u.uz);
    const newdungeon = u.uz.dnum !== newlevel.dnum;
    // C ref: do.c:1499 `int dist = depth(newlevel) - depth(&u.uz)` — the fall
    // damage roll at the very end of the arrival is d(max(dist,1), 6).
    const dist = depth_of_level(newlevel) - depth_of_level(u.uz);
    // C ref: do.c:1506 — the first endgame level demands the Amulet; without it
    // goto_level() returns and the hero stays put.
    if (newdungeon && In_endgame(newlevel) && !u.uhave?.amulet) return;
    // C ref: do.c goto_level() — ga.at_ladder, set by dodown()/doup() from the
    // terrain under the hero, selects the stairway to arrive on and the wording
    // of the transit message ("ladder" vs "stairs").
    const at_ladder = !!g.at_ladder;
    let do_fall_dmg = false;

    // C ref: do.c:1578 — "Prevent the player from going past the first quest
    // level unless (s)he has been given the go-ahead by the leader."
    // quest.c ok_to_quest() = ((got_quest || got_thanks) && is_pure() > 0)
    // || killed_leader; questpgr.js tracks got_quest, and neither of the other
    // two flags can be true before it is.
    if (on_qstart_level_do() && !newdungeon && !ok_to_quest_do()) {
        await pline('A mysterious force prevents you from descending.');
        return;
    }

    if (newlevel.dnum === u.uz.dnum && newlevel.dlevel === u.uz.dlevel)
        return; // on_level(newlevel, &u.uz): nothing to do

    // C ref: do.c:1607 — discard the context that applies to the level we're
    // leaving.  travelcc is what getpos() opens the '_' prompt's cursor on, so
    // a stale one puts the cursor on the previous level's destination instead
    // of the hero (seed0014 step 647).
    (game.iflags = game.iflags || {}).travelcc = { x: 0, y: 0 };

    // C ref: do.c:1615 check_special_room(TRUE) — clears u.urooms/u.ushops for
    // the level being left so the arrival scan below sees a clean slate.
    await check_special_room(true);

    // C ref: do.c:1616-1617 `if (Punished) unplacebc();` — lift the ball and
    // chain off the DEPARTING level, before it is stashed below, so placebc()
    // can put them back down on the arrival square.  Without this pair they stay
    // linked into the old level's object list at the old coordinates: the
    // arrival square holds nothing, so goto_level's closing pickup(1) draws no
    // "Things that are here:" menu (seed4500 step 772) and the first move on the
    // new level takes drag_ball()'s teleport arm instead of "nothing moved".
    if (Punished_do()) unplacebc();

    // C ref: do.c:1618-1623 — reset_utrap(FALSE); fill_pit(u.ux, u.uy);
    // set_ustuck(0) (clears u.ustuck AND u.uswallow); set_uinwater(0);
    // u.uundetected = 0.  This is hero state that belongs to the level being
    // left.  Leaving u.utrap/u.ustuck set made the first move on the destination
    // take domove()'s trapped/held arm — a DIFFERENT rn2 modulus — so this is
    // the "RNG-free state steers a later draw" pattern, not cosmetics.
    // fill_pit()'s boulder settle is not ported (it needs flooreffects()); it
    // only affects the square being vacated.
    u.utrap = 0;
    u.utraptype = 0;
    u.ustuck = null;
    u.uswallow = 0;
    u.uinwater = 0;
    u.uundetected = 0;

    // Capture accompanying pet(s) before the old level is freed by mklev().
    const kept = at_stairs || !at_stairs ? keepdogs_capture() : [];

    // C ref: do.c goto_level() — the ordinary on-foot transit message ("You
    // descend the stairs." / "You climb up the stairs.") is delivered at do.c
    // ~1799, AFTER mklev() but BEFORE the deferred docrt() (do.c:1840) repaints
    // the destination map.  In the tty the display buffer therefore still holds
    // the OLD level (and the OLD Dlvl on the status line) when the message's
    // --More-- is captured: the recorder shows "You descend the stairs.--More--"
    // over the level being LEFT, then the next acked frame shows the new level
    // (seed0030 global-28/231/368).  The JS renderer rebuilds the grid from the
    // live game state on every capture, so to reproduce that old-level frame we
    // emit the message + force its --More-- HERE, while u.uz and game.level still
    // refer to the level being left, before switching below.  This consumes no
    // RNG, so the mklev()/makelevel() PRNG stream that follows is unaffected.
    // C ref: do.c goto_level arrival block — the "You descend/climb the stairs."
    // ordinary-transit message is emitted for any at_stairs move (including a
    // branch crossing into the Gnomish Mines), not just same-dungeon descents.
    // C ref: do.c:1780 — an over-loaded (near_capacity() > UNENCUMBERED),
    // Punished or Fumbling hero FALLS down instead of descending: the message is
    // printed unconditionally (unlike the flags.verbose-gated ordinary one) and
    // costs rnd(3) hp.  do.c:1777 takes the Flying arm FIRST, so a flying hero
    // never falls.  Only the message can be hoisted to this old-level frame; the
    // losehp roll stays at C's position, in the at_stairs arrival arm below.
    // C ref: do.c:1789 — `if (Punished) { drag_down(); ballrelease(); }`.
    // drag_down() is now ported (drag_down_hero below); litter()'s per-item
    // rnd(weight_cap) is still missing, as is the u.usteed
    // dismount_steed(DISMOUNT_FELL) alternative to the losehp() below.
    // C ref: topl.c — a topline the CALLING command left unacknowledged (the
    // wizard '?' level teleport's prinv("Endgame prerequisite:", amu),
    // teleport.c:1244) fires its --More-- before the destination map is drawn,
    // and C paints that frame over the pre-departure screen: nothing flushes the
    // map between here and goto_level's closing flush_screen(-1), so the tty
    // still shows the departing level with the accompanying pet on it.  This
    // port re-renders live state at every --More--, so the frame has to be taken
    // HERE, while the departing level's glyph buffer is still intact — ahead of
    // the keepdogs pet-cell redraw and vision_recalc(2)'s blanking sweep below.
    // (seed0373 step 99.)
    if (game._toplin === 1) {
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
    }

    const fell_downstairs = at_stairs && !up
        && !Flying_do() && (near_capacity() > UNENCUMBERED || Punished_do() || Fumbling_do());
    if (at_stairs && !In_endgame(newlevel)) {
        // C ref: do.c:1758-1795.  Up: "%s %s up%s the %s." with "With great
        // effort, you" when Punished && !Levitation (which also overrides
        // flags.verbose), u_locomotion("climb"), " along" for Flying+ladder.
        // Down: Flying first ("You fly down the stairs" / "...along the ladder"),
        // then the fall, then the ordinary descent.
        const great_effort = up && Punished_do() && !Levitation_do();
        const verbose = game.flags?.verbose !== false;
        let msg = null;
        if (up) {
            if (verbose || great_effort)
                msg = `${great_effort ? 'With great effort, you' : 'You'}`
                    + ` ${u_locomotion('climb')} up`
                    + `${(Flying_do() && at_ladder) ? ' along' : ''}`
                    + ` the ${at_ladder ? 'ladder' : 'stairs'}.`;
        } else if (Flying_do()) {
            if (verbose)
                msg = `You fly down ${at_ladder ? 'along the ladder'
                                                : 'the stairs'}.`;
        } else if (fell_downstairs) {
            msg = `You fall down the ${at_ladder ? 'ladder' : 'stairs'}.`;
        } else if (verbose) {
            msg = at_ladder ? 'You climb down the ladder.'
                            : 'You descend the stairs.';
        }
        if (msg) {
            await update_topl(msg);
            await topl_more();      // capture the old-level transit frame
            game._pending_message = '';
            game._toplin = 0;
        }
    }

    // C ref: keepdogs()/mon leaving the level — the accompanying pet is no
    // longer on the departing level, so the tty shows the terrain it stood on.
    // Redraw each captured pet's old cell now: AFTER the on-foot transit frame
    // ("You descend the stairs.--More--") has been captured with the pet still
    // shown (C's gbuf keeps it there), but BEFORE mklev() — so a mid-mklev prompt
    // over the departing level (wizard bones "Get bones?" on a ^V level-teleport,
    // which has no transit frame) is captured with the pet already gone, exactly
    // as C shows it.  u.uz still refers to the departing level here, so the
    // hero's vision (and thus the redrawn terrain) is correct.
    for (const m of kept) newsym(m.mx, m.my);

    // C ref: do.c goto_level():1637 `vision_recalc(2)` — "we no longer see
    // anything on the level", between keepdogs()/recalc_mapseen() and the save
    // of the level being left.  Shutting vision down newsym()s every square
    // that WAS in sight, so while hallucinating it re-picks a display-rng glyph
    // for each of them (seed0383 step 195: nine warning glyphs on the bigroom
    // level the hero level-teleports off, then nine more from the arrival
    // docrt()).  It sits AFTER the hoisted transit-message frame above rather
    // than at C's textual position because that frame is RNG-free: C emits the
    // message at do.c:1799 (post-mklev) and the tty still shows the departing
    // level, which this port reproduces by rendering live state early.  Running
    // the vision shutdown first would blank that frame's monsters and costs 19
    // screens across seed0030/0014/0002; the draw ORDER is identical either way.
    vision_recalc(2);

    // Move to the destination level.
    g._visited_levels = g._visited_levels || {};
    g._level_store = g._level_store || {};
    const ledger = `${newlevel.dnum}:${newlevel.dlevel}`;
    // C ref: do.c goto_level() — "entering this level for first time" is gated on
    // !(level_info[new_ledger].flags & LFILE_EXISTS): a level file exists once the
    // level has been saved by a prior departure.  The per-ledger store is the JS
    // analog of that saved file, so a stored copy means "reload it" (getlev),
    // never "make it" (mklev) — this also covers the game-start level, which was
    // built by chargen (not marked in _visited_levels) but is stored the first
    // time the hero leaves it.
    const firstVisit = !g._visited_levels[ledger] && !g._level_store[ledger];

    // C ref: do.c goto_level() — savelev() writes out (and frees) the level we
    // are leaving before the destination is made or reloaded.  The JS port keeps
    // each visited level's live object graph in a per-ledger store; the
    // reference-swap here plays the role of savelev()/getlev()'s serialize-free /
    // read-back (the object state is identical either way, and no RNG is used).
    // Stash AFTER keepdogs_capture() has pulled any accompanying pet off the
    // level (C likewise runs keepdogs(FALSE) before savelev()) and BEFORE u.uz
    // switches, keyed by the OLD ledger.
    const oldLedger = `${u.uz.dnum}:${u.uz.dlevel}`;
    g._level_store[oldLedger] = {
        level: g.level, stairs: g.stairs, omoves: g.moves ?? 0,
        // C ref: track.c save_track() (called from savelev()) — the hero's
        // footprint ring (utrack) is written into the departing level's save
        // file, then save_track's release_data() branch runs initrack() to clear
        // the live ring.  So each level owns its own footprints; gettrack() on
        // the destination never sees squares the hero walked on a DIFFERENT
        // level.  Mirror that here: stash the ring by reference into the old
        // level's store, then initrack() below installs a fresh empty ring.
        utrack: g._utrack, utcnt: g._utcnt, utpnt: g._utpnt,
        // C ref: region.c save_regions() — the region list is part of the
        // DEPARTING level's save file, and its release_data() arm then runs
        // clear_regions().  Without this a gas cloud (m_everyturn_effect's fog
        // vapour) survived the level change and painted its S_cloud '#' over
        // the new level's terrain.
        regions: g.regions, regionMoves: g.moves ?? 0,
        // C ref: save.c:518 savelev_core() — `Sfo_dest_area(nhfp, &svu.updest)`
        // / `&svd.dndest`.  The level-change destination regions belong to the
        // LEVEL, not the game, so getlev() reads them back (restore.c:1114) and
        // a revisit lands inside the same des.teleport_region() box as the first
        // arrival.  Stashed here (before goto_level zeroes them) by reference.
        updest: g.updest, dndest: g.dndest,
    };
    clear_regions();
    // C ref: save_track() release_data() -> initrack().  Clear the live ring so
    // a freshly-made destination (mklev, no saved track) starts with none, and a
    // reloaded destination gets its own ring back via getlev_restore().
    initrack();

    // C ref: display.c cls():2196 display_nhwindow(WIN_MESSAGE,FALSE)
    { const { topl_more } = await import('./display.js');
      if (game._toplin === 1) { await topl_more(); game._toplin = 0; } }
    // C ref: do.c:1672 — "record this level transition as a potential seen
    // branch unless using some non-standard means of transportation (level
    // teleport)".  Runs BEFORE u.uz is reassigned; it is what puts the
    // "Stairs down to The Gnomish Mines." line in #overview.
    if ((at_stairs || falling || portal) && u.uz.dnum !== newlevel.dnum) {
        const { recbranch_mapseen } = await import('./dungeon.js');
        recbranch_mapseen(u.uz, newlevel);
    }
    u.uz0 = { dnum: u.uz.dnum, dlevel: u.uz.dlevel };
    u.uz = { dnum: newlevel.dnum, dlevel: newlevel.dlevel };

    // C ref: do.c goto_level() — `(void) memset(&svu.updest, 0, ...)` and the
    // same for svd.dndest: the arrival regions belong to the level being left,
    // so they are cleared before the destination is built (a special level's
    // des.teleport_region() refills them from fixup_special).
    g.updest = null;
    g.dndest = null;

    // C ref: do.c goto_level() — track the deepest (or, in a builds-up branch,
    // shallowest) dlevel reached in this dungeon so far.  dng_bottom() (trap.c,
    // hole/trapdoor destinations) reads this to decide whether the Quest
    // branch's "don't fall past locate until you've been there" cutoff still
    // applies; leaving it unset would pin that cutoff forever.
    {
        const dng = game.dungeons?.[u.uz.dnum];
        if (dng) {
            if (!builds_up(u.uz)) {
                if (u.uz.dlevel > dng.dunlev_ureached) dng.dunlev_ureached = u.uz.dlevel;
            } else if (dng.dunlev_ureached === 0 || u.uz.dlevel < dng.dunlev_ureached) {
                dng.dunlev_ureached = u.uz.dlevel;
            }
        }
    }

    // C ref: do.c goto_level() ~1499 — `prev_temperature = level.flags.temperature`
    // captured before the level switch (still the DEPARTING level's value here:
    // g.level hasn't been reassigned yet — that happens inside mklev()'s
    // clear_level_structures()/getlev_restore() below).
    const prevTemperature = g.level?.flags?.temperature ?? 0;

    // C ref: do.c goto_level():1688-1691 — "set default level change destination
    // areas; the special level code may override these": both regions are zeroed
    // BEFORE mklev(), so a des.teleport_region() on the level being generated
    // takes effect for this very arrival.
    g.updest = null;
    g.dndest = null;

    if (firstVisit) {
        g._visited_levels[ledger] = true;
        // C: mklev() — getbones() rn2(3) + makelevel() structural generation.
        // When getbones() reloads a bones file it grafts the level and returns
        // early from mklev() (setting g._bones_loaded); makelevel()/the room fill
        // + mineralize pass are then NOT run (C's mklev() returns before
        // makelevel()), so the reloaded legacy level is used verbatim.
        g._bones_loaded = false;
        await mklev();
        if (!g._bones_loaded) {
            // C does the room fill + mineralize inside makelevel(); the JS engine
            // factors it into fastforward_fill_mineralize().
            await fastforward_fill_mineralize();
        }
        // C ref: do.c:1701 goto_level() `familiar = bones_include_name(svp.plname)`
        // — only ever set on this first-visit/mklev() branch.  A prefix match of
        // the player's name against the cemetery entries savebones() attached to
        // the level: bones left by a DIFFERENT hero (multi-character sessions
        // share one bones store) are not familiar, so neither the message nor
        // familiar_level_msg()'s rn2(4) happens.
        const { bones_include_name } = await import('./bones.js');
        g._goto_familiar = g._bones_loaded && bones_include_name(g.plname);
    } else {
        // C ref: do.c goto_level() "returning to previously visited level;
        // reload it" -> reseed_random() (a no-op in this build:
        // has_strong_rngseed is FALSE) + getlev().  Swap the stored level graph
        // back in and run getlev()'s monster catch-up + re-hide pass, the only
        // RNG the reload consumes.
        await getlev_restore(ledger);
    }

    // Hero placement.  C ref: do.c goto_level() arrival block, whose three arms
    // are tested in this order: portal, then at_stairs, then everything else.
    if (portal && !In_endgame(u.uz)) {
        // C ref: do.c:1722-1745 — "find the portal on the new level".  A
        // BR_PORTAL branch has a matching MAGIC_PORTAL on each side (mkportal(),
        // called from place_branch()), and there is at most one per level, so
        // the first one in the trap list is the way back in; the hero comes out
        // standing on it.
        let ttrap = null;
        for (const t of g.level?.traps ?? [])
            if (t.ttyp === MAGIC_PORTAL) { ttrap = t; break; }

        if (!ttrap) {
            // No portal here.  C only expects this after expulsion(TRUE) sealed
            // the quest off — it deletes the near portal itself and the far one
            // on arrival — in which case it lands the hero at random without
            // complaint; otherwise it is an impossible() and lands the hero at
            // random anyway.  Either way, the placement is the same.
            u_on_rndspot(0);
        } else {
            seetrap(ttrap);
            u_on_newpos(ttrap.tx, ttrap.ty);
        }
    } else if (at_stairs && !In_endgame(u.uz)) {
        // Prefer the stairway on the new level that leads back to the level we
        // just left (uz0) — for a branch crossing this is the branch staircase.
        // C ref: do.c:1750/1774 stairway_find_from(&u.uz0, ga.at_ladder): the
        // ladder flag is PART of the match, so a level reachable by both a
        // staircase and a ladder lands the hero on the kind actually used.
        const back = stairway_find_from(u.uz0, at_ladder);
        if (back) {
            u_on_newpos(back.sx, back.sy);
            back.u_traversed = true;
        } else if (up) {
            // C ref: do.c:1753 — climbing up with no matching stairway lands on
            // the branch stairs (new dungeon) or the destination's DOWN
            // staircase.  This used to call u_on_upstairs() for both directions,
            // which put an ascending hero on the wrong staircase (and, when the
            // level has no up stair at all, on a random place_lregion() square
            // that draws rn1 pairs C never draws).
            if (newdungeon) u_on_sstairs(1); else u_on_dnstairs();
        } else {
            if (newdungeon) u_on_sstairs(0);
            else u_on_upstairs(); /* descent lands on the new level's UP stair */
        }
        // C ref: do.c:1792 — the fall's damage roll, at its real position in the
        // stream (after mklev()/placement, before losedogs()).  Maybe_Half_Phys
        // is the identity here and selftouch("Falling, you") only bites a hero
        // wielding a petrifying corpse, so neither adds a draw.
        if (fell_downstairs && Punished_do()) await drag_down_hero();
        if (fell_downstairs) await losehp_do(rnd(3));
    } else {
        // trap door / level teleport / endgame.  (The was_in_W_tower `| 2` flag
        // of C's u_on_rndspot() call is Vlad's-Tower-only and never set here.)
        u_on_rndspot((up ? 1 : 0));
        // C ref: do.c:1805 — a fall (trap door / hole) also does ballfall(),
        // selftouch("Falling, you") and defers d(max(dist,1),6) damage to the
        // very end of the arrival.  ballfall/selftouch need a punished hero or a
        // wielded petrifying corpse; the damage roll is real RNG and is applied
        // below at C's position.
        if (falling) do_fall_dmg = true;
    }

    // C ref: do.c:1813-1814 `if (Punished) placebc();` — immediately after the
    // three arrival arms and BEFORE obj_delivery()/losedogs()/run_timers(), so
    // the ball and chain are the FIRST things on the arrival square's pile.
    // Position matters: at goto_level's tail instead (after losedogs) the pile
    // order is wrong and seed4500 loses 4 steps to gain 2.
    if (Punished_do()) placebc();

    // Bring the pet(s) along.  C ref: do.c goto_level() -> losedogs().
    losedogs_place(kept);

    // C ref: do.c:1821 run_timers() — "expire all timers that have gone off
    // while away; must be after migrating monsters and objects are delivered".
    // A revisited level's corpses have kept rotting in the JS per-ledger store
    // exactly as C's saved timers do, so without this they linger on the map
    // until the arrival turn's own nh_timeout.  ROT_CORPSE draws no RNG.
    run_object_timers();

    // C ref: do.c goto_level() ~1827 — the hero might be arriving at a spot that
    // now holds a monster (commonly the pet that accompanied the hero and landed
    // on the hero's exact square in mon_arrive()); if so move one or the other.
    {
        const mtmp = m_at(game.u.ux, game.u.uy);
        if (mtmp && mtmp !== game.u.usteed) u_collide_m(mtmp);
    }

    // C ref: do.c:1831-1834 — `if (Is_waterlevel || Is_airlevel) movebubbles();
    // else if (svl.level.flags.fumaroles) fumaroles();`.  The Planes of Water
    // and Air get their first bubble sweep here, and the Plane of Fire draws
    // its fumarole rolls, both on ARRIVAL and before the screen reset.
    if (Is_waterlevel(u.uz) || Is_airlevel(u.uz)) await movebubbles();
    else if (g.level?.flags?.fumaroles) fumaroles();

    // Reset the screen and draw the new level.  C ref: do.c goto_level()
    // lines ~1837-1841: vision_reset() (clear old level's line-of-sight),
    // reset_glyphmap(gm_levelchange), docrt() (full vision recalc + redraw),
    // flush_screen(-1).  There is NO vision_recalc() of its own here — docrt()
    // does the whole recalc.  Adding one made docrt()'s leading
    // vision_recalc(2) find squares still in sight and spend an extra
    // display-rng draw on each (seed0383 step 195).
    game.vision_full_recalc = 0;
    vision_reset();
    // C ref: display.c docrt_flags() -> cls() -> display_nhwindow(WIN_MESSAGE,
    // FALSE): an unacknowledged topline (drag_down's "The iron ball smacks into
    // you!") is paged HERE, while the physical screen is still the blank one
    // drag_down's own cls() left behind (do.c:1720's flush_screen(-1) has map
    // flushes postponed).  Only afterwards does cls() clear WIN_MAP and docrt()
    // repaint it, which do.c:1841's flush_screen(-1) then finally flushes.
    if (game._toplin === 1) {
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
    }
    delete game._screenBlank;
    await docrt();
    await flush_screen(-1);

    // C ref: do.c:1843-1845 — `if (gd.dfr_post_msg) maybe_lvltport_feedback();`
    // is the FIRST message after the screen reset, i.e. before the Gehennom /
    // familiar / arrival lines, before check_special_room(FALSE)'s shop greeting
    // and before the closing pickup(1).  The caller stashes the text (there is
    // no gd.dfr_post_msg here) and this delivers it at C's position; emitting it
    // from the caller instead put it AFTER pickup(1)'s "You see here ..." line
    // (w3-human-knight-debug step 131 shows the two in the opposite order).
    if (g._goto_post_msg) {
        const pmsg = g._goto_post_msg;
        g._goto_post_msg = null;
        await update_topl(pmsg);
    }

    // C ref: do.c:1858 deliver_splev_message() — "special levels can have a
    // custom arrival message", i.e. every des.message() the .lua script ran,
    // delivered one pline() per line (questpgr.c:423 deliver_by_pline splits at
    // the newlines lspo_message() joined them with) right after the deferred
    // level-teleport feedback and before the Gehennom / familiar lines.
    if (g.lev_message) {
        const lines = String(g.lev_message).split('\n');
        g.lev_message = null;
        for (const line of lines) if (line) await update_topl(line);
    }

    // C ref: do.c goto_level() ~1861 — "Check whether we just entered
    // Gehennom."  No RNG.  Fires once, the first time In_hell flips from
    // false to true (the Valley of the Dead is Gehennom's own entry level).
    if (!In_hell(u.uz0) && In_hell(u.uz) && Is_valley(u.uz)) {
        await update_topl('You arrive at the Valley of the Dead...');
        await update_topl('The odor of burnt flesh and decay pervades the air.');
        // C ref: pline.c You_hear() — gated on Deaf/acoustics (unlike the two
        // plines above, which always print).
        if (!game.u?.Deaf && game.flags?.acoustics !== false)
            await update_topl('You hear groans and moans everywhere.');
        await record_ach(2 /* you.h ACH_HELL */);
    }
    // C ref: do.c:1876 — "in case we've managed to bypass the Valley's stairway
    // down": ANY Gehennom level other than the Valley marks the gate as already
    // entered.  That flag is what suppresses dodown()'s "Are you sure you want
    // to enter?" y_n prompt on a later visit to the Valley, so leaving it unset
    // makes a prompt appear that C does not ask — and its keystroke would then
    // be eaten by the prompt instead of running as a command.
    if (In_hell(u.uz) && !Is_valley(u.uz)) {
        u.uevent = u.uevent || {};
        u.uevent.gehennom_entered = 1;
    }

    // C ref: do.c:1884 `if (familiar) familiar_level_msg();` — its rn2(4) is
    // drawn here, after the Gehennom check and BEFORE the quest/Knox arrival
    // block and the Tourist reward-XP block (which can itself draw via
    // newexplevel() -> pluslvl()).  Nothing between the docrt() above and this
    // point draws, so the stream position is fixed by this ordering alone.
    if (g._goto_familiar) {
        const fmsg = resolve_familiar_msg();
        if (fmsg) await update_topl(fmsg);
    }

    // C ref: do.c:1887-1934 — the "special location arrival messages/events"
    // if/else chain: In_endgame / In_quest -> onquest() / Is_knox -> alarm /
    // In_mines / In_sokoban / else.  Only the quest and Knox arms have output
    // here; onquest() draws no RNG (it opens com_pager text windows).
    if (In_endgame(u.uz)) {
        // C ref: do.c:1881-1890 — the endgame arm.  Astral gets final_level()
        // (not ported); every other plane entered while carrying the Amulet
        // forces the confrontation with the Wizard of Yendor.
        const astral = g.astral_level;
        const onAstral = !!astral && u.uz.dnum === astral.dnum
                         && u.uz.dlevel === astral.dlevel;
        if (newdungeon) await record_ach(7 /* ACH_ENDG */);
        if (firstVisit && onAstral) await record_ach(8 /* ACH_ASTR */);
        if (!(firstVisit && onAstral) && newdungeon && u.uhave?.amulet)
            await resurrect();
    } else if (In_quest(u.uz)) {
        await onquest(); /* might be reaching locate|goal level */
    } else if (Is_knox_level(u.uz)) {
        // C ref: do.c:1897 — arriving in Fort Ludios trips the alarm: two plines
        // AND every monster on the level is woken (msleeping = 0).  A sleeping
        // monster is skipped by dochug() before it can draw, so waking the level
        // changes the very next monster-movement pass's RNG.
        // C re-arms it on every visit unless Croesus has died
        // (`new || !svm.mvitals[PM_CROESUS].died`); mvitals is not modelled here
        // and Croesus can only die on this level, so the alarm always sounds.
        await update_topl('You have penetrated a high security area!');
        await update_topl('An alarm sounds!');
        for (const mtmp of g.level?.monsters ?? []) mtmp.msleeping = 0;
    } else if (In_mines(u.uz)) {
        if (newdungeon) await record_ach(15 /* ACH_MINE */);
    } else if (In_sokoban(u.uz)) {
        if (newdungeon) await record_ach(21 /* ACH_SOKO */);
    } else {
        // C ref: do.c:1912 — the final `else` arm of that chain.  Only the
        // Rogue-level line produces output; Is_bigroom just records an
        // achievement.
        if (firstVisit && Is_rogue_level(u.uz))
            await update_topl('You enter what seems to be an older, more primitive world.');
        else if (firstVisit && Is_bigroom(u.uz))
            await record_ach(22 /* ACH_BGRM */);
        // C ref: do.c:1917-1932 — "main dungeon message from your quest
        // leader".  Fires on the PARENT-side level of the Quest branch (the one
        // fixup_special() drops the magic portal on), so it needs mklev()'s
        // LR_BRANCH placement to have run.  com_pager() itself is not free: it
        // rebuilds the Lua state, so nhlib.lua's top-level shuffle(align) draws
        // rn2(3) then rn2(2) before a single line is printed.
        if (!In_quest(u.uz0) && at_dgn_entrance('The Quest')
            && !(u.uevent?.qcompleted || u.uevent?.qexpelled
                 || game.quest_status?.leader_is_dead)) {
            if (!u.uevent?.qcalled) {
                u.uevent = u.uevent || {};
                u.uevent.qcalled = 1;
                await com_pager('quest_portal');
            } else {
                await com_pager((game.urole?.mnum) === PM_ROGUE_DO
                                ? 'quest_portal_demand' : 'quest_portal_again');
            }
        }
    }

    // C ref: do.c:1937 temperature_change_msg(prev_temperature), right after the
    // quest/endgame arrival block.  Every Gehennom level starts "hot" (mklev.js
    // clear_level_structures) unless its own generator marks it cold/temperate,
    // so this fires on nearly every first-time Gehennom arrival.
    {
        const newTemperature = g.level?.flags?.temperature ?? 0;
        if (prevTemperature !== newTemperature) {
            if (newTemperature) {
                await update_topl(`It is ${newTemperature > 0 ? 'hot' : 'cold'} here.`);
                if (In_hell(u.uz) && newTemperature > 0)
                    await update_topl(`You ${olfaction(game.u?.data) ? 'smell' : 'sense'} smoke...`);
            } else if (prevTemperature > 0) {
                await update_topl(`The heat ${In_hell(u.uz0) ? 'and smoke are' : 'is'} gone.`);
            } else if (prevTemperature < 0) {
                await update_topl('You are out of the cold.');
            }
        }
    }

    // C ref: do.c goto_level() — on first entry to a level ("if (new)"), a
    // Tourist gains reward-experience scaled by the level's difficulty:
    //   if (Role_if(PM_TOURIST)) { more_experienced(level_difficulty(), 0);
    //                              newexplevel(); }
    // No RNG unless the gain crosses an experience-level boundary (newexplevel
    // -> pluslvl), which does not happen on the shallow covered levels.  This
    // feeds u.urexp for the end-of-game score (rip.c / end.c).
    // C ref: do.c:1958 — the same `if (new)` block first logs the arrival to
    // the #chronicle: `describe_level(dloc, 2)` -> "level <depth>, <dungeon
    // name>" with a leading "The " lowercased.  LL_ACHIEVE only for the
    // endgame/quest; the main dungeon logs LL_DEBUG, which show_gamelog() still
    // lists (it filters on LL_SPOILER, not LL_DEBUG).  Without this the
    // chronicle window showed only the "entered the dungeon" line.
    if (firstVisit) {
        const major = !!(In_endgame(u.uz) || In_quest(u.uz));
        const dname = String(game.dungeons?.[u.uz.dnum]?.dname || 'The Dungeons of Doom')
            .replace(/^The /, 'the ');
        const { livelog_printf, LL_ACHIEVE, LL_DEBUG } = await import('./livelog.js');
        livelog_printf(major ? LL_ACHIEVE : LL_DEBUG,
                       `entered level ${depth_of_level(u.uz)}, ${dname}`);
    }
    if (firstVisit && game.urole?.mnum === PM_TOURIST) {
        more_experienced(level_difficulty(), 0);
        await newexplevel();
    }

    // C ref: do.c:1974 print_level_annotation().
    const annotation = game._level_annotations?.[ledger];
    if (annotation) await update_topl(`You remember this level as ${annotation}.`);
    // The on-foot transit message + its --More-- frame were already delivered
    // above (before the level switch) so that the captured frame shows the OLD
    // level, exactly as the deferred-docrt() tty does.

    // C ref: do.c:1976 check_special_room(FALSE) — "give room entrance message,
    // if any" for the square the hero arrived on.  This is one of the LAST
    // things goto_level() does: after maybe_lvltport_feedback()'s "You
    // materialize on a different level!" and the familiar / Knox / temperature
    // lines above, and before the closing pickup(1).  It used to run BEFORE the
    // docrt() (with a caller-side deferral hook for the level-teleport path),
    // which put the shop greeting ahead of the arrival message.
    await check_special_room(false);

    // C ref: do.c:1990 — a trap-door/hole fall costs d(max(dist,1), 6) hp, rolled
    // at the very END of the arrival (after every message above and after
    // check_special_room(FALSE)).  Maybe_Half_Phys is the identity here.
    if (do_fall_dmg) {
        await losehp_do(d(Math.max(dist, 1), 6));
        // C's losehp()->done() does not return to goto_level() on a real
        // death.  A wizard/discover lifesave can return normally, so only
        // abandon the arrival when the game was actually ended.
        if (game.program_state?.gameover) return;
    }
    // MEASURED NEGATIVE, do not re-add here: C's do.c:1814 `if (Punished)
    // placebc();` belongs EARLIER in goto_level (before obj_delivery()/
    // losedogs()/run_timers()), so the arrival square's nexthere order is C's.
    // Adding it at this tail costs seed4500 4 steps (1585/1586/1797/1798) for 2
    // gained.  Port it at the right position instead.
    // C ref: do.c:1996 goto_level()'s last statement, `(void) pickup(1)`.  It
    // was left unported; the resulting missing "Things that are here:" window
    // dumps the acknowledging ' ' into rhack() ("Unknown command ' '.") on
    // every arrival that lands on objects.
    {
        const { pickup_after_move } = await import('./cmd.js');
        await pickup_after_move(u.ux, u.uy);
    }
}

// ── resurrect (C ref: wizard.c resurrect()) ──
// Only the `no_of_wizards == 0` arm is reachable here: goto_level() calls this
// the first time the hero enters the endgame carrying the Amulet, before any
// Wizard has been created.  makemon(ptr, u.ux, u.uy, MM_NOWAIT) takes makemon's
// `byyou && !in_mklev` branch, so the placement spends enexto_core()'s three
// ring shuffles (45 rn2 calls) BEFORE next_ident/newmonhp — skipping the whole
// call left the stream 54 draws short at the arrival boundary.
const MM_NOWAIT_DO = 0x00000002;   // C ref: makemon.h MM_NOWAIT
async function resurrect() {
    const M = await import('./makemon.js');
    const U = await import('./uhitm.js');
    const made = M.create_particular_monster('Wizard of Yendor', MM_NOWAIT_DO);
    if (!made) return;
    const mtmp = made.mtmp;
    mtmp.mrevived = 1;
    // C ref: makemon.c:1472-1500 — makemon's own tail prints the arrival line
    // (no MM_NOEXCLAM here, so " suddenly" and a trailing '!').
    newsym(made.x, made.y);
    if (U.canspotmon(mtmp)) {
        const what = U.x_monnam(mtmp, /*ARTICLE_A*/ 2, null, 0, false);
        const dx = made.x - game.u.ux, dy = made.y - game.u.uy;
        const place = made.next2u ? ' next to you'
            : (dx * dx + dy * dy <= 8 * 8) ? ' close by' : '';
        await update_topl(
            `${what.charAt(0).toUpperCase()}${what.slice(1)} suddenly appears${place}!`);
    }
    mtmp.mstrategy = (mtmp.mstrategy | 0) & ~STRAT_WAITMASK;
    mtmp.mtame = 0;
    mtmp.mpeaceful = 0;
    M.set_malign(mtmp);
    // C: `if (!Deaf) { pline("A voice booms out..."); verbalize(...); }`
    if (!game.u?.Deaf) {
        await update_topl('A voice booms out...');
        await update_topl('"So thou thought thou couldst kill me, fool."');
    }
}

// ── familiar_level_msg (C ref: do.c familiar_level_msg) ──
// Draws the rn2(4) that picks one of three random flavor lines (or no message
// at all) for a freshly bones-loaded, name-matching level.  The Hallucination
// variant swaps in a joke set, and the "This place %s familiar..." / "Whoa!
// Everything %s different." lines fill in "looks" or "seems" depending on
// Blind, exactly as C's Sprintf(buf, mesg, ...) does.  Returns the resolved
// string (or null for the 1-in-4 "no message" roll) — called from inside
// goto_level() so the rn2(4) lands at the same point in the RNG stream as C;
// the caller displays the text once it is safe to (see goto_level()).
const FAM_MSGS = [
    "You have a sense of deja vu.",
    "You feel like you've been here before.",
    'This place %s familiar...',
    null,
];
const HALU_FAM_MSGS = [
    'Whoa!  Everything %s different.',
    'You are surrounded by twisty little passages, all alike.',
    "Gee, this %s like uncle Conan's place...",
    null,
];
function resolve_familiar_msg() {
    const which = rn2(4);
    let mesg = (game.u?.uhallu ? HALU_FAM_MSGS : FAM_MSGS)[which];
    if (mesg && mesg.includes('%s'))
        mesg = mesg.replace('%s', Blind() ? 'seems' : 'looks');
    return mesg;
}

// ── getlev_restore (C ref: restore.c getlev(), goto_level() reload path) ──
//
// Runs when goto_level() returns to a previously-visited level: swap the stored
// level graph (map / stairs / monster list) back into place, then walk the
// monster chain applying each monster's elapsed-time catch-up
// (dog.c mon_catchup_elapsed_time) and giving hiders a chance to re-hide.  The
// only RNG the reload consumes is the per-monster re-hide guard (rnd(10) when
// elapsed > 0) plus mon_catchup's conditional recovery rolls
// (trapped/confused/stunned/going-wild), matching restore.c:1200-1220.
async function getlev_restore(ledger) {
    const g = game;
    const store = g._level_store?.[ledger];
    if (!store) return; // level was never actually left (shouldn't happen)
    g.level = store.level;
    g.stairs = store.stairs;
    g.fmon = g.level.monsters;

    // C ref: restore.c:1114 getlev() — `Sfi_dest_area(nhfp, &svu.updest)` /
    // `&svd.dndest`, read back straight after save_stairs' counterpart.
    // goto_level() zeroed both before coming here; only mklev() refills them (a
    // special level's des.teleport_region()), so without this a REVISIT had no
    // region and u_on_rndspot() fell back to the whole-level default.  seed4500
    // returns to the Valley at step 1256 and C draws place_lregion's
    // rn2(15)/rn2(10) over valley.lua's {58,09,72,18} where we drew rn2(79)/
    // rn2(21) over the entire map.
    g.updest = store.updest ?? null;
    g.dndest = store.dndest ?? null;

    // C ref: track.c rest_track() (called from getlev()) — restore this level's
    // saved footprint ring.  goto_level() cleared the live ring (initrack) when
    // it left the previous level, so a level we never departed keeps its empty
    // ring; one we saved gets its own footprints back (utrack was stashed by
    // reference so it is exactly the ring as of our last departure).
    if (store.utrack) {
        g._utrack = store.utrack;
        g._utcnt = store.utcnt ?? 0;
        g._utpnt = store.utpnt ?? 0;
    }

    // C ref: region.c rest_regions() — clear_regions(), then this level's saved
    // regions come back with their ttl aged by the turns spent away
    // (`r->ttl = (r->ttl > tmstamp) ? r->ttl - tmstamp : 0`, ttl -1/-2 exempt).
    {
        const away = (g.moves ?? 0) - (store.regionMoves ?? 0);
        g.regions = store.regions || [];
        for (const r of g.regions)
            if (r.ttl >= 0) r.ttl = (r.ttl > away) ? r.ttl - away : 0;
    }

    // C ref: restore.c getlev() — elapsed = svm.moves - svo.omoves (turns spent
    // away from this level).
    const elapsed = (g.moves ?? 0) - (store.omoves ?? 0);

    // C ref: restore.c:1181-1220 monster loop.  program_state.restoring is not
    // REST_LEVELS (an ordinary in-game level change) and u.uz.dlevel != 0, so no
    // monster is skipped by the "regenerate monsters while on another level"
    // continue; ghostly is FALSE (this is not a bones file).
    // C walks the chain restmonchn() just rebuilt, which preserves the order
    // savelev() wrote it in -- i.e. fmon order, newest monster first
    // (makemon.c:1249 prepends).  Our level array is in creation order, so
    // iterate it reversed, the same convention mon.c's fmonOrder() uses for
    // movemon().  Forward order gave the rnd(10)/hide_monst rolls to the wrong
    // monsters: on seed4500's Dlvl 14 revisit the level's one eligible hider (a
    // lurker above) is C's 13th of 14 and our 2nd, so our restrap() drew an
    // extra rn2(3) 11 monsters early and shifted the whole PRNG stream by one.
    for (const mtmp of fmon_order(g.level.monsters)) {
        if (mtmp === g.u?.usteed) continue; // steed kept on list but off map
        if (elapsed > 0)
            mon_catchup_elapsed_time(mtmp, elapsed);
        // restore_cham(mtmp): shape-changer fixup — no RNG, not modelled.
        // "give hiders a chance to hide before their next move"
        if (elapsed > 0 && elapsed > rnd(10))
            await hide_monst(mtmp);
    }
}

// C ref: the `fmon` chain — makemon prepends (makemon.c:1249), so C visits
// monsters newest-first while our level array is in creation order.  Same
// helper mon.c/polyself.c/read.c keep privately (mon.js fmonOrder()).
function fmon_order(list) {
    const src = list || [];
    const out = new Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[src.length - 1 - i];
    return out;
}

// ── prev_level (C ref: dungeon.c prev_level) — climb toward the level above ──
// When ascending an up staircase whose destination is a different dungeon
// branch we cross that branch; otherwise we simply decrement dlevel within the
// current branch.  goto_level() then reloads/makes the destination.
export async function prev_level(at_stairs) {
    const u = game.u;
    // C: dungeon.c:1530 — `if (!u.uz.dnum && u.uz.dlevel == 1 && !u.uhave.amulet)
    // done(ESCAPED);`.  C reaches it via the branch arm below, but the else arm
    // would goto_level(dlevel 0) there, so on Dlvl 1 it is unconditional.
    if (!u.uz.dnum && u.uz.dlevel === 1 && !u.uhave?.amulet) {
        const { done, ESCAPED } = await import('./end.js');
        await done(ESCAPED);
        return;
    }
    const stway = stairway_at(u.ux, u.uy);
    if (at_stairs && stway) stway.u_traversed = true;
    if (at_stairs && stway && stway.tolev.dnum !== u.uz.dnum) {
        // Taking an up dungeon branch (KMH: okay if not depth 1).
        // C: if (!u.uz.dnum && u.uz.dlevel == 1 && !u.uhave.amulet) done(ESCAPED)
        const newlevel = { dnum: stway.tolev.dnum, dlevel: stway.tolev.dlevel };
        await goto_level(newlevel, at_stairs, false, false);
    } else {
        // Going up a staircase (or rising through the ceiling).
        const newlevel = { dnum: u.uz.dnum, dlevel: u.uz.dlevel - 1 };
        await goto_level(newlevel, at_stairs, false, false);
    }
}

// ── doup (C ref: do.c doup) — climb an up staircase/ladder (the '<' command).
// Covers the on-foot ascent plus the pit-climb, rooted, stuck-steed,
// held-in-place and over-encumbrance branches (each with C's turn cost).
export async function doup() {
    const u = game.u;
    const stway = stairway_at(u.ux, u.uy);
    // C ref: do.c doup -> set_move_cmd(DIR_UP, 0): u.dz = -1 (up), u.dx=u.dy=0.
    u.dz = -1; u.dx = 0; u.dy = 0;

    // C ref: do.c:1303 u_rooted() — costs the turn (ECMD_TIME).
    if (await u_rooted()) return 1;

    // C ref: do.c:1306 — "'up' to get out of a pit": a hero caught in a pit
    // climbs instead of ascending, and climb_pit() ALWAYS draws its rn2(2)
    // boulder check.  This was missing entirely, so a trapped hero pressing '<'
    // on a staircase changed level (drawing a whole mklev()) where C only
    // struggles.
    if (u.utrap && u.utraptype === TT_PIT) {
        await climb_pit();
        return 1; // ECMD_TIME
    }

    // C ref: do.c doup — must be standing on an up staircase.
    if (!stway || !stway.up) {
        await pline("You can't go up here.");
        return 0; // ECMD_OK
    }

    // C ref: do.c:1318 stucksteed(TRUE) — no time passes.
    if (await stucksteed(true)) return 0; // ECMD_OK

    if (await u_stuck_cannot_go('up')) return 1;     // do.c:1321, ECMD_TIME

    // C ref: do.c:1325 — a Stressed-or-worse hero cannot climb, and the refusal
    // COSTS THE TURN (ECMD_TIME): the monsters get a move and draw RNG.  This
    // was skipped as "the light contest heroes never trigger it".
    if (near_capacity() > SLT_ENCUMBER) {
        await pline(`Your load is too heavy to climb the ${
            game.level?.at(u.ux, u.uy)?.typ === STAIRS ? 'stairs' : 'ladder'}.`);
        return 1; // ECMD_TIME
    }

    // C ref: do.c doup — climbing up from ledger 1 (dnum 0, dlevel 1: the top of
    // the Dungeons of Doom) leaves the dungeon, so confirm first.
    if (u.uz.dnum === 0 && u.uz.dlevel === 1) {
        const ans = await y_n('Beware, there will be no return!  Still climb?',
                              'yn\x1b', 'n');
        if (ans !== 'y') return 0; // ECMD_OK
    }

    // C ref: do.c doup — pet leash check before transit.
    if (!next_to_u()) {
        await pline('You are held back by your pet!');
        return 0; // ECMD_OK
    }

    // C: ga.at_ladder = (levl[u.ux][u.uy].typ == LADDER); prev_level(TRUE).
    game.at_ladder = (game.level?.at(u.ux, u.uy)?.typ === LADDER);
    await prev_level(true);
    game.at_ladder = false;
    return 1; // ECMD_TIME
}

// ── next_level (C ref: dungeon.c next_level) ──
// When descending an actual staircase, the destination comes from the
// stairway's tolev (which, for branch stairs, points into another dungeon
// branch such as the Gnomish Mines).  Only when not on a staircase (e.g.
// falling through a hole) do we increment dlevel within the same branch.
export async function next_level(at_stairs) {
    const u = game.u;
    const stway = stairway_at(u.ux, u.uy);
    if (at_stairs && stway) {
        stway.u_traversed = true;
        const newlevel = { dnum: stway.tolev.dnum, dlevel: stway.tolev.dlevel };
        await goto_level(newlevel, at_stairs, false, false);
    } else {
        const newlevel = { dnum: u.uz.dnum, dlevel: u.uz.dlevel + 1 };
        await goto_level(newlevel, at_stairs, !at_stairs, false);
    }
}

// ── wiz_level_tele (C ref: teleport.c level_tele + cmd.c wiz_level_tele) ──
//
// The ^V wizard command.  Prompts "To what level do you want to teleport?",
// reads a level number, and (for a valid positive in-dungeon level) schedules
// goto_level() to that dlvl.  The prompt itself consumes no RNG.
//
// `readLevel` is injected by the dispatcher (cmd.js) so this module stays free
// of the input/getlin plumbing; it must return the typed string (or null/ESC
// to cancel).
export async function wiz_level_tele(readLevel) {
    const u = game.u;
    // C ref: teleport.c:1194 — qbuf is declared OUTSIDE the do-while and the
    // hint is Strcat'd once, so passes 3..10 keep the long prompt.  Without the
    // loop an unparseable answer read as a cancel and printed nothing at all,
    // where C re-prompts: measured 2026-08-19, both `dp-named-tour` sessions
    // died at step 7 on exactly this (7/1410 and 7/216).
    let qbuf = 'To what level do you want to teleport?';
    let trycnt = 0;
    let buf = null;
    let gotoRandom = false;
    let namedLev = 0;
    for (;;) {
        if (++trycnt === 2)
            qbuf += ' [type a number, name, or ? for a menu]';
        buf = await readLevel(qbuf);

        // C ref: wizcmds.c wiz_level_tele() is just level_tele(), so ^V runs the
        // same getlin loop: teleport.c:1212-1221 tests "*" and the confused
        // mispronunciation BEFORE the ESC check, and both `goto random_levtport`.
        // A confused hero therefore lands on a random level whatever was typed —
        // including ESC.
        gotoRandom = String(buf) === '*';
        if (!gotoRandom && (u.uprops?.Confusion || 0) > 0 && rnl(5)) {
            await pline('Oops...');
            // Same deferred-docrt capture as level_tele() below: the "Oops..."
            // --More-- is drawn over the OLD level, before goto_level() switches.
            game._toplin = 1;
            await topl_more();
            game._pending_message = '';
            game._toplin = 0;
            gotoRandom = true;
        }
        if (gotoRandom) break;
        if (buf == null || buf === '\x1b') return 0; // cancelled (ESC)
        if (String(buf) === '?') break;             // the print_dungeon menu

        // C: `else if ((newlev = lev_by_name(buf)) == 0) newlev = atoi(buf);`
        // then the do-while repeats while newlev is 0 AND buf does not start a
        // (optionally negative) number AND trycnt < 10.
        namedLev = lev_by_name(String(buf)) || 0;
        const s = String(buf);
        const dig = (c) => c >= '0' && c <= '9';
        if (namedLev || dig(s[0]) || (s[0] === '-' && dig(s[1])) || trycnt >= 10)
            break;
    }

    if (gotoRandom) {
        // C ref: teleport.c random_levtport: — the involuntary branch, which
        // skips the Knox/Quest adjustments of the controlled one.
        const rlev = random_teleport_level();
        if (rlev === depth_of_level(u.uz)) {
            await pline('You shudder for a moment.');
            return 0;
        }
        if (!next_to_u()) {
            await pline('You shudder for a moment.');
            return 0;
        }
        const rdest = await level_tele_destination(rlev);
        if (!rdest) return 0;
        if (rdest.dnum === u.uz.dnum && rdest.dlevel === u.uz.dlevel) return 0;
        game._goto_post_msg = (game.flags?.verbose !== false)
            ? 'You materialize on a different level!' : null;
        await goto_level(rdest, false, false, false);
        game._goto_post_msg = null;
        return 0; // ECMD_OK
    }

    // C ref: teleport.c level_tele() — wizard "?" opens the print_dungeon level
    // menu.  The menu consumes no RNG and force_dest bypasses the usual range
    // checks: the chosen (dnum, dlevel) is taken verbatim.
    let newlevel;
    if (String(buf) === '?') {
        const choice = await print_dungeon(true);
        if (!choice) return 0; // print_dungeon returned 0 (cancel)
        newlevel = { dnum: choice.destdnum, dlevel: choice.destlev };
        // C ref: teleport.c:1233-1245 — picking an endgame level from the wizard
        // menu while not already there hands the hero the Amulet of Yendor
        // (goto_level() refuses the endgame without it, do.js:647).  mksobj()
        // draws next_ident + the AMULET_CLASS rn2(10)/blessorcurse pair.
        if (In_endgame(newlevel) && !In_endgame(u.uz) && !u.uhave?.amulet) {
            const amu0 = mksobj(AMULET_OF_YENDOR, true, false);
            if (amu0) {
                const amu = addinv(amu0);
                prinv('Endgame prerequisite:', amu, 0);
            }
        }
        // force_dest: no further validation; teleport straight to the target.
        if (newlevel.dnum === u.uz.dnum && newlevel.dlevel === u.uz.dlevel)
            return 0;
        // C ref: teleport.c:1426 schedule_goto(..., post_msg) -> gd.dfr_post_msg,
        // which goto_level() delivers via maybe_lvltport_feedback() right after
        // its docrt() — ahead of the Gehennom/familiar/Knox/temperature lines,
        // the shop greeting and the closing pickup(1).  All of those now come
        // out of goto_level() itself, at C's positions.
        game._goto_post_msg = (game.flags?.verbose !== false)
            ? 'You materialize on a different level!' : null;
        await goto_level(newlevel, false, false, false);
        game._goto_post_msg = null;
        // C ref: wizcmds.c wiz_level_tele() returns ECMD_OK — the wizard-mode
        // level teleport does NOT cost a game turn (no movemon / gethungry /
        // monster-spawn pass).  Returning ECMD_TIME here advanced moves by one
        // and let the pet take an extra dog_move, landing it off-position.
        return 0; // ECMD_OK
    }

    if (buf === '') return 0; // empty line: cancelled

    // C ref: teleport.c:1246 — lev_by_name() wins over atoi(), so a level or
    // branch NAME ("oracle", "mine end") is a legal ^V destination.  This path
    // used to fall through the digits-only regex below and silently return.
    let newlev;
    if (namedLev) {
        newlev = namedLev;
    } else {
        const m = String(buf).match(/^(-?\d+)/);
        if (!m) return 0;
        newlev = parseInt(m[1], 10);
    }
    if (newlev === 0) return 0; // "Go to Nowhere" path not modelled

    // C ref: teleport.c level_tele():1305 — while already IN the endgame the
    // typed number selects a plane directly: dlevel = dunlevs_in_dungeon + n
    // (so -1 is the last plane, -4 the first), with no arrival message.  This
    // arm sits ahead of every other range check, and without it a ^V to another
    // plane silently did nothing (seed0373 step 110, Fire -> Air).
    if (In_endgame(u.uz)) {
        const llimit = dunlevs_in_dungeon(u.uz);
        if (newlev >= 0 || newlev <= -llimit) {
            await pline("You can't get there from here.");
            return 0;
        }
        game._goto_post_msg = null;
        await goto_level({ dnum: u.uz.dnum, dlevel: llimit + newlev },
                         false, false, false);
        return 0;
    }

    // C ref: teleport.c level_tele() — "if in Knox and the requested level > 0,
    // stay put".  force_dest is only set by the wizard "?" menu, handled above.
    if (single_level_branch(u.uz) && newlev > 0) {
        await pline('You shudder for a moment.');
        return 0;
    }

    // Negative levels (heaven/clouds) are not modelled.
    if (newlev < 0) return 0;

    // C ref: teleport.c level_tele() — "if in Quest, the player sees 'Home 1',
    // etc., on the status line, instead of the logical depth of the level.
    // [...] it should be incremented to the value of the logical depth of the
    // target level": a typed destination is relative to that "Home N" display,
    // so convert it to an absolute logical depth before the generic
    // depth->(dnum,dlevel) translation below (get_level() subtracts
    // depth_start right back out, so for same-dungeon targets this nets out
    // to "dlevel = the typed number").
    if (In_quest(u.uz) && newlev > 0)
        newlev = newlev + (game.dungeons?.[u.uz.dnum]?.depth_start ?? 1) - 1;

    newlevel = await level_tele_destination(newlev);
    if (!newlevel) return 0; // C returned after "You can't get there from ...".
    // C ref: do.c deferred_goto() — `if (!on_level(&u.uz, &gu.utolev))`.  Asking
    // for the level the hero is already on is a complete no-op: goto_level() is
    // never entered, so its deferred arrival message is never delivered either.
    if (newlevel.dnum === u.uz.dnum && newlevel.dlevel === u.uz.dlevel)
        return 0;

    // C ref: teleport.c level_tele() -> schedule_goto(..., "You materialize on
    // a different level!"); the deferred top line is delivered by goto_level()
    // itself (maybe_lvltport_feedback, right after its docrt()).  Only shown
    // when flags.verbose (the default).
    game._goto_post_msg = (game.flags?.verbose !== false)
        ? 'You materialize on a different level!' : null;
    await goto_level(newlevel, false, false, false);
    game._goto_post_msg = null;
    // C ref: wizcmds.c wiz_level_tele() returns ECMD_OK — no game turn elapses.
    return 0; // ECMD_OK
}


// ── level_tele (C ref: teleport.c level_tele) ──
//
// The controlled / random level teleport reached by reading a confused or
// cursed scroll of teleportation (read.c seffect_teleportation).  With teleport
// control (or in debug/wizard mode) the hero is prompted for a destination
// level; a confused hero usually mispronounces and is sent to a random level
// ("Oops...").  Without control the teleport is always random.  The exotic
// destinations (heaven/clouds via a negative level, quest/endgame, the wizard
// "?" menu, "Go to Nowhere") are not exercised by the recorded sessions and are
// not modelled; the common in-dungeon random/controlled cases are.
//
// `readLevel(query)` reads the destination line via the top-line getlin; it is
// injected so this module stays free of the input plumbing (read.js supplies
// hooked_tty_getlin).  The confused-scroll caller has a still-pending topline
// ("Being confused, ...") when this runs; getlin's own more() (C getline.c:53)
// pages it before the prompt is drawn.
export async function level_tele(readLevel) {
    const u = game.u;
    const wizard = !!game.flags?.debug;

    // C ref: teleport.c level_tele — carrying the Amulet / being in the endgame
    // or Sokoban blocks a (non-wizard) level teleport.  Not exercised on the
    // covered starts, kept as a faithful guard.
    if ((u.uhave_amulet || false) && !wizard) {
        await pline('You feel very disoriented for a moment.');
        return;
    }

    const confused = (u.uprops?.Confusion || 0) > 0;
    const teleport_control = (u.uprops?.Teleport_control || 0) > 0
        || !!u.Teleport_control;
    const stunned = (u.uprops?.Stun || 0) > 0 || !!u.Stunned;
    const cur_depth = depth_of_level(u.uz);

    let newlev = 0;
    let gotoRandom = false;

    if ((teleport_control && !stunned) || wizard) {
        // Controlled level teleport: prompt for a destination.
        let trycnt = 0;
        let cancelled = false;
        // C ref: teleport.c:1194 — qbuf is declared OUTSIDE the do-while and the
        // hint is Strcat'd once, so passes 3..10 keep the long prompt.
        let qbuf = 'To what level do you want to teleport?';
        for (;;) {
            // C: on the second and later passes the prompt gains a usage hint.
            if (++trycnt === 2)
                qbuf += wizard ? ' [type a number, name, or ? for a menu]'
                               : ' [type a number or name]';
            const buf = await readLevel(qbuf);
            if (buf === '*') { gotoRandom = true; break; }
            // C ref: teleport.c — a confused hero mispronounces the destination
            // and (rnl(5) != 0) is teleported to a random level instead.  The
            // "Oops..." message + its --More-- are shown over the OLD level
            // (before goto_level switches), matching the deferred-docrt tty
            // capture the recorder took (cf. the stair-transit handling below).
            if (confused && rnl(5)) {
                await pline('Oops...');
                game._toplin = 1;
                await topl_more();
                game._pending_message = '';
                game._toplin = 0;
                gotoRandom = true;
                break;
            }
            if (buf === '\x1b' || buf == null) { cancelled = true; break; }
            // wizard "?" opens print_dungeon; not modelled for the scroll path.
            newlev = lev_by_name(buf);
            if (!newlev) newlev = parseInt(String(buf), 10) || 0;
            // C do-while: repeat while newlev==0 and buf isn't a (leading-sign)
            // digit and trycnt < 10.
            const b0 = String(buf).charCodeAt(0);
            const b1 = String(buf).charCodeAt(1);
            const isDigit = (c) => c >= 48 && c <= 57;
            if (newlev || isDigit(b0) || (String(buf)[0] === '-' && isDigit(b1))
                || trycnt >= 10)
                break;
        }
        if (cancelled) return;
        // C ref: teleport.c:1251 — `if (newlev == 0) { if (trycnt >= 10) goto
        // random_levtport; if (ynq("Go to Nowhere. ...") != 'y') return; ... }`.
        // Falling out of the loop with newlev 0 used to hit the `newlev <= 0`
        // no-op guard below, silently swallowing the involuntary teleport.
        if (!gotoRandom && newlev === 0) {
            if (trycnt >= 10) {
                gotoRandom = true;
            } else {
                const { yn_function } = await import('./extcmd-handlers.js');
                const c = await yn_function('Go to Nowhere.  Are you sure?', 'ynq', 'q');
                if (c !== 'y') return;
                // C then kills the hero (done(DIED) "committed suicide"); not
                // ported — a declined prompt is the only reachable outcome here.
                return;
            }
        }
        // C ref: teleport.c level_tele() — these two adjustments sit at the end
        // of the controlled branch, so the "*"/confused `goto random_levtport`
        // (which jumps into the involuntary branch) skips them.
        if (!gotoRandom) {
            // "if in Knox and the requested level > 0, stay put."
            if (single_level_branch(u.uz) && newlev > 0) {
                await pline('You shudder for a moment.');
                return;
            }
            // The same "Home N" -> logical-depth conversion as wiz_level_tele():
            // the Quest status line shows "Home N" rather than the logical
            // depth, so a typed destination is relative to that.
            if (In_quest(u.uz) && newlev > 0)
                newlev = newlev + (game.dungeons?.[u.uz.dnum]?.depth_start ?? 1) - 1;
        }
    } else {
        // Involuntary level teleport (no control): straight to a random level.
        gotoRandom = true;
    }

    if (gotoRandom) {
        newlev = random_teleport_level();
        if (newlev === cur_depth) { await pline('You shudder for a moment.'); return; }
    }

    // C ref: teleport.c — TT_BURIEDBALL / next_to_u / endgame / negative-level
    // (heaven & clouds) handling is omitted (not exercised); the pet-adjacency
    // check is the only one that applies and it is always TRUE here.
    if (!next_to_u()) { await pline('You shudder for a moment.'); return; }

    // Negative levels (heaven / clouds) and quest/hell adjustments are not
    // modelled; the covered scroll teleport always yields an in-dungeon level.
    if (newlev <= 0) return; // faithful no-op guard (unmodelled destinations)

    const newlevel = await level_tele_destination(newlev);
    if (!newlevel) return; // C returned after "You can't get there from ...".

    // C ref: read.c seffect_teleportation — a completed level teleport marks the
    // scroll type known (gk.known); doread() then discovers it via makeknown().
    game.known = true;

    // C ref: teleport.c schedule_goto(&newlevel, UTOTYPE_NONE, 0, "You
    // materialize on a different level!").  C DEFERS the level change to
    // deferred_goto(), called right after rhack() — i.e. AFTER doread()'s
    // learnscroll()/makeknown() (which draws rn2(19) via exercise(A_WIS)).  So
    // we must NOT run goto_level() here: mklev() must follow that exercise in
    // the PRNG stream.  Record the pending destination; doread() runs
    // run_deferred_lvltport() after makeknown() to fire it.  The scroll type is
    // already known, so goto_level's mklev() then starts from the right state.
    game._lvltport_dest = {
        newlevel,
        post_msg: (game.flags?.verbose !== false)
            ? 'You materialize on a different level!' : null,
    };
}

// C ref: do.c deferred_goto() for a level-teleport UTOTYPE_NONE — perform the
// pending goto_level() scheduled by level_tele(), then deliver its arrival
// message over the freshly drawn level (maybe_lvltport_feedback()).  Called
// from doread() after the scroll has been discovered + used up, matching C's
// "deferred_goto() right after rhack()" ordering (no RNG is drawn in between).
export async function run_deferred_lvltport() {
    const pend = game._lvltport_dest;
    if (!pend) return;
    game._lvltport_dest = null;
    // C ref: do.c:1839 goto_level() -> docrt() -> display.c cls() ->
    // display_nhwindow(WIN_MESSAGE, FALSE), which pages a still-unacknowledged
    // top line ("You feel disoriented.") over the DEPARTING level's map.  Our
    // cls() just drops the pending message; page it here (scoped to this
    // function — a global cls() change is the pline-vs-update_topl -341 trap).
    if (game._toplin === 1) {
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
    }
    // C ref: do.c deferred_goto() -> goto_level(), which delivers gd.dfr_post_msg
    // itself via maybe_lvltport_feedback() right after its docrt().
    game._goto_post_msg = pend.post_msg;
    // C ref: do.c deferred_goto() passes `!!(typmask & UTOTYPE_FALLING)` as
    // goto_level's `falling`; trap.c fall_through() schedules with that bit set
    // (js/trap.js sets pend.falling), level_tele() with UTOTYPE_NONE.
    await goto_level(pend.newlevel, false, !!pend.falling, false);
    game._goto_post_msg = null;
}

// C ref: dungeon.c Is_botlevel — is <lev> the bottom level of its dungeon?
function is_botlevel(lev) {
    const dng = game.dungeons?.[lev.dnum];
    return !!dng && lev.dlevel === dng.num_dunlevs;
}

// C ref: dungeon.c get_level(newlevel, levnum) — translate a logical depth into
// a (dnum, dlevel).
//
// The branch-walk used to be omitted as "not exercised", but a level-teleport
// that asks for a depth ABOVE the current dungeon's start needs it: seed4500
// does `^V 1` from Dlvl 40, which is Gehennom (dnum 1, depth_start 27).  Without
// the walk, `levnum - depth_start + 1` produced dlevel -25, so the ledger was
// "1:-25" — a level never visited — and the port ran a full mklev() (6588 RNG
// draws) where C reloaded the saved Dlvl 1 with 28.  Every screen from there on
// was on a different dungeon.
function get_level(levnum) {
    const u = game.u;
    let dgn = u.uz.dnum;
    const dngOf = (d) => game.dungeons?.[d];
    let dng = dngOf(dgn);
    if (levnum <= 0) {
        /* can only currently happen in endgame */
        levnum = u.uz.dlevel;
    } else if (levnum > (dng.depth_start + dng.num_dunlevs - 1)) {
        /* beyond end of dungeon, jump to last level */
        levnum = dng.num_dunlevs;
    } else {
        // "The desired level is in this dungeon or a 'higher' one."  Branch up
        // the tree until we reach a dungeon that contains levnum; C assumes
        // end2 is always the unique child, so the parent of `dgn` is the end1
        // of the branch whose end2.dnum is dgn.
        if (levnum < dng.depth_start) {
            do {
                const br = (game.branches || []).find((b) => b?.end2?.dnum === dgn);
                if (!br) break;         /* C panics; nothing better to do here */
                dgn = br.end1.dnum;
                dng = dngOf(dgn);
            } while (dng && levnum < dng.depth_start);
        }
        /* We're within the same dungeon; calculate the level. */
        levnum = levnum - (dng?.depth_start ?? 1) + 1;
    }
    return { dnum: dgn, dlevel: levnum };
}

// C ref: teleport.c level_tele()'s destination chain — the find_hell() arm and
// the generic `else` arm (Gehennom pre-invocation clamp, quest clamp,
// get_level(), refusal), shared by the ^V wizard command and the scroll path.
// Returns null where C returns without scheduling a goto.  No RNG.
//
// The `escape_by_flying` (negative depth) and `force_dest` (wizard "?" menu)
// arms of C's if-chain are handled by the callers; this is the pair of arms a
// plain positive depth reaches.
async function level_tele_destination(newlev) {
    const u = game.u;
    const dng = game.dungeons?.[u.uz.dnum];
    const medusa_dnum = game.medusa_level?.dnum;
    // C: `u.uz.dnum == medusa_level.dnum && newlev >= depth_start
    //     + dunlevs_in_dungeon(&u.uz)` -> find_hell().  Asking, from the
    // Dungeons of Doom, for a level at or past the bottom (the Castle) drops the
    // hero into the Valley of the Dead rather than clamping: you cannot skip the
    // Valley on the way into Gehennom.
    if (medusa_dnum != null && u.uz.dnum === medusa_dnum && dng
        && newlev >= (dng.depth_start ?? 1) + (dng.num_dunlevs ?? 0))
        return find_hell();

    // C: the deepest reachable level of the branch the hero is currently in —
    // used both for the pre-invocation Gehennom clamp and to choose between
    // "from here" and "from anywhere" in the refusal message.
    const qbranch = In_quest(u.uz) ? game.qstart_level
                  : In_mines(u.uz) ? game.mineend_level
                                   : game.sanctum_level;
    // Infinity when that branch's dungeon isn't in the ledger yet: both uses
    // then fall through to the same answer C gives with a fully-built dungeon.
    const deepest = (qbranch && game.dungeons?.[qbranch.dnum])
        ? game.dungeons[qbranch.dnum].depth_start
          + dunlevs_in_dungeon(qbranch) - 1
        : Infinity;

    // C: `if (!wizard && Inhell && !u.uevent.invoked && newlev >= deepest)` —
    // before the invocation, teleporting into the last level of Gehennom is
    // forbidden; wizard mode is exempt.
    if (!game.flags?.debug && In_hell(u.uz) && !u.uevent?.invoked
        && newlev >= deepest) {
        newlev = deepest - 1;
        await pline('Sorry...');
    }
    // C: no teleporting out of the quest dungeon.
    if (In_quest(u.uz) && game.qstart_level
        && newlev < depth_of_level(game.qstart_level))
        newlev = depth_of_level(game.qstart_level);

    const newlevel = get_level(newlev);
    if (newlevel.dnum === u.uz.dnum && newlevel.dlevel === u.uz.dlevel
        && newlev !== depth_of_level(u.uz)) {
        await pline(`You can't get there from ${newlev > deepest ? 'anywhere' : 'here'}.`);
        return null;
    }
    return newlevel;
}

// C ref: dungeon.c lev_by_name — resolve a level *name* ("mines end", branch
// names, annotations) to a logical depth.  Named-level lookup isn't exercised
// by the recorded scroll teleports (the destination is a number or the confused
// "Oops..." random path), so this returns 0 (not a name).
function lev_by_name(_nam) {
    return 0;
}

// C ref: teleport.c random_teleport_level() — pick a random destination depth
// for an uncontrolled level teleport.  The Dungeons-of-Doom (non-quest,
// non-endgame, non-hell) case is modelled; the RNG draws (the initial rn2(5),
// the rn2(range) selection, and the rnd(3) botlevel/min-depth adjustments) are
// reproduced left-to-right so the mklev() stream that follows stays in sync.
function random_teleport_level() {
    const u = game.u;
    const cur_depth = depth_of_level(u.uz);
    const dng = game.dungeons[u.uz.dnum];

    // single_level_branch / In_endgame are false for the covered DoD teleport.
    if (!rn2(5)) return cur_depth;

    // In_quest not modelled (no quest teleport on the covered starts).
    const min_depth = 1;
    let max_depth = dng.num_dunlevs + (dng.depth_start - 1);
    // Inhell && !invoked adjustment omitted (not in hell).

    // Range is 1..current+3, current not counting.
    let nlev = rn2(cur_depth + 3 - min_depth) + min_depth;
    if (nlev >= cur_depth) nlev++;

    if (nlev > max_depth) {
        nlev = max_depth;
        if (is_botlevel(u.uz)) nlev -= rnd(3);
    }
    if (nlev < min_depth) {
        nlev = min_depth;
        if (nlev === cur_depth) {
            nlev += rnd(3);
            if (nlev > max_depth) nlev = max_depth;
        }
    }
    return nlev;
}

// C ref: stairs.c stairway_at — find the stairway node at <x,y>.
function stairway_at(x, y) {
    for (let s = game.stairs; s; s = s.next)
        if (s.sx === x && s.sy === y) return s;
    return null;
}

// C ref: stairs.c stairway_find_from(fromdlev, isladder) — find the stairway on
// the current level whose destination is the given level AND whose isladder flag
// matches the way the hero travelled (used to land the hero on the staircase
// that leads back to the level just left, e.g. the mines branch stair).
function stairway_find_from(dlev, isladder) {
    if (!dlev) return null;
    for (let s = game.stairs; s; s = s.next)
        if (s.tolev && s.tolev.dnum === dlev.dnum && s.tolev.dlevel === dlev.dlevel
            && !!s.isladder === !!isladder)
            return s;
    return null;
}

// C ref: stairs.c stairway_find_dir(up) — first stairway going the given way.
function stairway_find_dir(up) {
    for (let s = game.stairs; s; s = s.next)
        if (!!s.up === !!up) return s;
    return null;
}
// C ref: stairs.c stairway_find_special_dir(up) — the branch ("special")
// stairway, i.e. one whose destination leaves this dungeon, going the other way.
function stairway_find_special_dir(up) {
    for (let s = game.stairs; s; s = s.next)
        if (s.tolev?.dnum !== game.u?.uz?.dnum && !!s.up !== !!up) return s;
    return null;
}
// C ref: stairs.c u_on_dnstairs()/u_on_sstairs() — the two placement fallbacks
// goto_level()'s at_stairs arm uses when the destination has no stairway back
// to the level just left.  (mklev.js exports only u_on_upstairs.)
function u_on_sstairs(upflag) {
    const stway = stairway_find_special_dir(upflag);
    if (stway) u_on_newpos(stway.sx, stway.sy);
    else u_on_rndspot(upflag);
}
function u_on_dnstairs() {
    const stway = stairway_find_dir(false);
    if (stway) u_on_newpos(stway.sx, stway.sy);
    else u_on_sstairs(1); /* destination dnstairs implies moving up */
}

// C ref: apply.c next_to_u — FALSE only when a leashed pet (or amulet-bearing
// steed) can't follow.  Leashes/steeds are not modelled in the recorded
// sessions, so this is always TRUE (the pet follows down the stairs).
function next_to_u() {
    return true;
}

// ── dodown (C ref: do.c dodown) — descend stairs or a ladder.
// Covers the on-foot descent, the deliberate plunge into a seen pit/hole
// (dotrap TOOKPLUNGE), the Gehennom gate confirmation, levitation, the rooted /
// stuck-steed / held refusals and their ECMD_TIME-vs-ECMD_OK turn cost.  Still
// missing: flags.autodig (default off), the Upolyd ceiling-hider drop-out, and
// controlled-levitation float_down().
// C ref: do.c:1110 u_stuck_cannot_go(updn) — a held hero can't take the stairs,
// and the failed attempt COSTS THE TURN (both callers return ECMD_TIME), so the
// monsters get a move.  The sticks()/uswallow arms need a polymorphed or
// engulfed hero, neither of which occurs here.
async function u_stuck_cannot_go(updn) {
    if (!game.u.ustuck) return false;
    await pline(`You are being held, and cannot go ${updn}.`);
    return true;
}

export async function dodown() {
    const u = game.u;

    // C ref: do.c:1135 set_move_cmd(DIR_DOWN, 0): u.dz = 1, u.dx = u.dy = 0.
    u.dz = 1; u.dx = 0; u.dy = 0;

    // C ref: do.c:1137 u_rooted() — costs the turn (ECMD_TIME).
    if (await u_rooted()) return 1;
    // C ref: do.c:1140 stucksteed(TRUE) — no time passes.
    if (await stucksteed(true)) return 0; // ECMD_OK

    // C ref: do.c:1145 — stairs_down / ladder_down.  A DOWN LADDER is a legal
    // descent in C; treating it as "not stairs" made '>' on one print "You can't
    // go down here." and skip the whole level change.
    let stairs_down = false, ladder_down = false;
    const stway = stairway_at(u.ux, u.uy);
    if (stway && !stway.up) {
        stairs_down = !stway.isladder;
        ladder_down = !stairs_down;
    }

    // C ref: do.c:1153 — a levitating hero floats above the stairs and does not
    // descend; ECMD_OK, so no turn passes.  The controlled-levitation early-out
    // above it (HLevitation & I_SPECIAL / ELevitation & W_ARTI -> float_down(),
    // with its rnz(100) artifact-age bump) needs an artifact or #sit-granted
    // levitation and is not modelled; nor is the Blind "don't reveal an unknown
    // staircase" glyph check (it needs the remembered-glyph map).
    if (Levitation_do()) {
        // C ref: hack.c floating_above(what) — "You are floating high above %s."
        await pline(`You are floating high above the ${
            stairs_down ? 'stairs' : ladder_down ? 'ladder'
                        : surface(u.ux, u.uy)}.`);
        return 0; // ECMD_OK
    }

    // (do.c:1201's Upolyd && ceiling_hider drop-out-of-hiding arm needs a
    // piercer/lurker-above polymorph.)

    if (await u_stuck_cannot_go('down')) return 1;   // do.c:1221, ECMD_TIME

    if (!stairs_down && !ladder_down) {
        const trap = t_at(u.ux, u.uy);
        // C ref: do.c:1224 — '>' while teetering at the edge of a SEEN pit, or
        // standing on a SEEN hole/trap door, deliberately enters it:
        // dotrap(trap, TOOKPLUNGE) draws the trap's own RNG and costs the turn.
        // This used to fall through to "You can't go down here." and consume
        // nothing at all.
        if (uteetering_at_seen_pit(trap) || uescaped_shaft(trap)) {
            await dotrap(trap, TOOKPLUNGE);
            return 1; // ECMD_TIME
        }
        // C ref: do.c:1231 — with flags.autodig (default off) and a wielded
        // pick-axe C digs down here instead; not modelled.
        // C ref: do.c:1236 — a VIBRATING_SQUARE reads "You can't go down here yet."
        await pline(`You can't go down here${
            (trap && trap.ttyp === VIBRATING_SQUARE) ? ' yet' : ''}.`);
        return 0; // ECMD_OK
    }

    // C ref: do.c:1241 — the Valley's down staircase is the gate to Gehennom and
    // asks for confirmation the first time.  This is a y_n PROMPT: omitting it
    // does not merely drop two messages, it leaves the answering keystroke in the
    // input stream for the command parser to run as a command.
    if (Is_valley(u.uz) && !game.u.uevent?.gehennom_entered) {
        await pline('You are standing at the gate to Gehennom.');
        await pline('Unspeakable cruelty and harm lurk down there.');
        const ans = await y_n('Are you sure you want to enter?', 'yn\x1b', 'n');
        if (ans !== 'y') return 0; // ECMD_OK
        await pline('So be it.');
        u.uevent = u.uevent || {};
        u.uevent.gehennom_entered = 1; /* don't ask again */
    }

    // C ref: do.c dodown — pet leash check before transit.
    if (!next_to_u()) {
        await pline('You are held back by your pet!');
        return 0; // ECMD_OK
    }

    // (do.c:1274's `if (trap)` jump-down-the-hole block and the goto_hell() /
    // clamp_hole_destination() arms below it are dead in 3.7: any seen hole under
    // the hero already returned above via uescaped_shaft() -> dotrap().)

    // C: ga.at_ladder = (levl[u.ux][u.uy].typ == LADDER); next_level(!trap).
    game.at_ladder = (game.level?.at(u.ux, u.uy)?.typ === LADDER);
    await next_level(true);
    game.at_ladder = false;
    return 1; // ECMD_TIME
}

// ═══════════════════════════════════════════════════════════════════════════
// do.c completeness ports.
//
// INERT BY CONSTRUCTION: nothing above this banner calls anything below it, and
// every cross-module dependency is reached through a lazy `await import()`, so
// this block adds NO static import edge to js/do.js.  (An sp_lev -> mklev edge
// once flipped ESM evaluation order and the whole program failed to load; do.js
// sits on the drop / level-change path the corpus exercises constantly, so a
// load-order accident here is not survivable.)  Wire these in ONE AT A TIME,
// each behind its own measurement.
//
// Overlaps recorded rather than duplicated:
//   * familiar_level_msg() below delegates to resolve_familiar_msg() above —
//     that is the rn2(4)-drawing half, split out so goto_level() can draw at
//     C's stream position and print the line later.
//   * temperature_change_msg() / hellish_smoke_mesg() also exist INLINE inside
//     goto_level() (the prevTemperature block); these are the named C forms.
//   * schedule_goto() / deferred_goto() have a reduced level-teleport-only twin
//     above in `game._lvltport_dest` + run_deferred_lvltport().
// ═══════════════════════════════════════════════════════════════════════════

// ── local shims ─────────────────────────────────────────────────────────────
// The port's convention for the objnam/pline string helpers is a file-private
// copy (js/dothrow.js:74-115, js/dbridge.js:899-916, js/muse.js:275, ...)
// because the real ones are module-private in js/invent.js / js/cmd.js.

// C ref: objnam.c an(str) / the(str) / upstart(str).
function an(s) { return /^[aeiou]/i.test(String(s)) ? `an ${s}` : `a ${s}`; }
function the(s) { return /^[A-Z]/.test(String(s)) ? String(s) : `the ${s}`; }
function upstart(s) {
    return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s;
}

// C ref: objnam.c vtense(subj, verb) — 2nd->3rd person unless `subj` reads as
// plural.  The special_subjs[] false-match table and the " of "/" from " head
// noun scan are omitted (js/dothrow.js:74 documents the same reduction).
function vtense(subj, verb) {
    const s = subj == null ? '' : String(subj);
    if (s && !/^an? /i.test(s)) {
        const last = s.charAt(s.length - 1).toLowerCase();
        const prev = s.length > 1 ? s.charAt(s.length - 2).toLowerCase() : '';
        if ((last === 's' && s.length > 1 && prev !== 'u' && prev !== 's')
            || /eeth$|feet$|ia$|ae$/i.test(s))
            return String(verb);
        if (/^(they|you|we)$/i.test(s)) return String(verb);
    }
    const v = String(verb), lc = v.toLowerCase();
    if (lc === 'are') return 'is';
    if (lc === 'have') return `${v.slice(0, -2)}s`;
    const end = lc.charAt(lc.length - 1);
    if ('zxs'.includes(end)
        || (v.length >= 2 && end === 'h' && 'cs'.includes(lc.charAt(lc.length - 2)))
        || (v.length === 2 && end === 'o'))
        return `${v}es`;
    if (end === 'y' && !'aeiou'.includes(lc.charAt(lc.length - 2)))
        return `${v.slice(0, -1)}ies`;
    return `${v}s`;
}

// C ref: hack.h distu(x,y) — squared distance from the hero; hack.h u_at(x,y).
function distu(x, y) {
    const u = game.u;
    const dx = x - (u?.ux ?? 0), dy = y - (u?.uy ?? 0);
    return dx * dx + dy * dy;
}
function u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }

// ── hero properties (youprop.h), following this file's existing `_do` suffix
//    convention (Levitation_do / Flying_do / Punished_do / Fumbling_do above) ──
function uprop_do(...keys) {
    const u = game.u;
    for (const k of keys) {
        const v = u?.uprops?.[k] ?? u?.[k];
        if (v) return typeof v === 'number' ? v : 1;
    }
    return 0;
}
function Deaf_do() { return uprop_do('Deaf', 'HDeaf', 'EDeaf') > 0; }
function Hallucination_do() {
    return uprop_do('Hallucination', 'HHallucination') > 0 || !!game.u?.uhallu;
}
function Underwater_do() { return !!(game.u?.uinwater || game.u?.uunderwater); }
function Fire_resistance_do() {
    return uprop_do('Fire_resistance', 'HFire_resistance', 'EFire_resistance') > 0;
}
function Passes_walls_do() {
    return uprop_do('Passes_walls', 'HPasses_walls', 'EPasses_walls') > 0;
}
function Stoned_do() { return uprop_do('Stoned') > 0; }
function Slimed_do() { return uprop_do('Slimed') > 0; }
function Strangled_do() { return uprop_do('Strangled') > 0; }
function Sick_do() { return uprop_do('Sick') > 0 || !!game.u?.sick; }
// C ref: youprop.h Half_physical_damage / Maybe_Half_Phys(dmg) — no RNG.
function Half_physical_damage_do() {
    return uprop_do('Half_physical_damage', 'HHalf_physical_damage',
                    'EHalf_physical_damage') > 0;
}
function Maybe_Half_Phys_do(dmg) {
    return Half_physical_damage_do() ? Math.floor((dmg + 1) / 2) : dmg;
}
// C ref: youprop.h EWounded_legs (u.uprops[WOUNDED_LEGS].extrinsic).
// js/allmain.js:1405 keeps the same private pair.
function EWounded_legs_do() {
    return (game.u?.EWounded_legs | 0) || (game.u?.uprops?.EWounded_legs | 0);
}

// C ref: dungeon.c on_level(a,b) / assign_level(dst,src).  Private copies also
// live in js/dig.js:636, js/questpgr.js:2883 and js/wizcmds.js:106; js/dungeon.js
// is the file that should own the single export.
function on_level(a, b) {
    return !!a && !!b && a.dnum === b.dnum && a.dlevel === b.dlevel;
}
function assign_level(dst, src) {
    dst.dnum = src?.dnum ?? 0;
    dst.dlevel = src?.dlevel ?? 0;
    return dst;
}

// C ref: pager.c waterbody_name(x,y).  js/cmd.js:593 has the full version (the
// three MOAT special-level overrides plus hliquid()); this is the reduced form
// js/trap.js:3264 also keeps.  pager.c is where the single export belongs.
function waterbody_name_do(x, y) {
    const typ = game.level?.at(x, y)?.typ;
    if (typ === LAVAPOOL) return 'molten lava';
    if (typ === MOAT) return 'moat';
    if (typ === WATER) return 'wall of water';
    if (typ === LAVAWALL) return 'wall of lava';
    return 'pool of water';
}

// C ref: objclass.h object classes.  js/allmain.js:48, js/display.js:49/115 and
// js/artifact.js:136 each keep the same private set.
const RING_CLASS = 4, POTION_CLASS = 8, COIN_CLASS = 12;
// C ref: onames.h (generated) — the ring block, rows 173..200 of js/mkobj.js's
// OBJECT_DATA table, which is the port's authority for otyp numbering.  mkobj.js
// exports only the four rings it needs itself, so the rest are named here.
const RIN_ADORNMENT = 173, RIN_GAIN_STRENGTH = 174, RIN_GAIN_CONSTITUTION = 175,
      RIN_INCREASE_ACCURACY = 176, RIN_INCREASE_DAMAGE = 177,
      RIN_PROTECTION = 178, RIN_REGENERATION = 179, RIN_SEARCHING = 180,
      RIN_STEALTH = 181, RIN_SUSTAIN_ABILITY = 182, RIN_LEVITATION = 183,
      RIN_HUNGER = 184, RIN_AGGRAVATE_MONSTER = 185, RIN_CONFLICT = 186,
      RIN_WARNING = 187, RIN_POISON_RESISTANCE = 188, RIN_FIRE_RESISTANCE = 189,
      RIN_COLD_RESISTANCE = 190, RIN_SHOCK_RESISTANCE = 191,
      RIN_FREE_ACTION = 192, RIN_SLOW_DIGESTION = 193,
      RIN_TELEPORTATION = 194, RIN_TELEPORT_CONTROL = 195,
      RIN_POLYMORPH = 196, RIN_POLYMORPH_CONTROL = 197,
      RIN_INVISIBILITY = 198, RIN_SEE_INVISIBLE = 199,
      RIN_PROTECTION_FROM_SHAPE_CHAN = 200;
// C ref: onames.h — the weapon/food otyps the two digestion paths test (same
// OBJECT_DATA rows).  CORPSE/GLOB_OF_GREEN_SLIME/POT_OIL/WORM_TOOTH are also
// exported by js/mkobj.js; named here so the whole set reads from one place.
const WORM_TOOTH = 42, CRYSKNIFE = 43, CORPSE = 265, MEATBALL = 267,
      MEAT_STICK = 268, ENORMOUS_MEATBALL = 269, MEAT_RING = 270,
      GLOB_OF_GREEN_SLIME = 273, POT_OIL = 321;
// C ref: defsym.h MONSYM() — monster classes (js/symbols.js owns the table).
const S_VORTEX = 22, S_TROLL = 46, S_ZOMBIE = 52, S_GOLEM = 55;

// C ref: monsters.h PM_* indices, resolved from the species NAME at first use
// (js/mkobj.js:203 documents why literals are unsafe here: mons[] shifts).
const _do_pm_cache = new Map();
async function PM_do(name) {
    if (!_do_pm_cache.has(name)) {
        const M = await import('./makemon.js');
        _do_pm_cache.set(name, M.name_to_pmidx(name));
    }
    return _do_pm_cache.get(name);
}

// C ref: pline.c impossible() — js/display.js owns the one implementation.
async function impossible_do(msg) {
    const { impossible } = await import('./display.js');
    await impossible(msg);
}
// C ref: pline.c You_hear() — suppressed when Deaf.
async function You_hear_do(msg) {
    if (!Deaf_do()) await pline(`You hear ${msg}`);
}
// C ref: mondata.h is_whirly(ptr) = mlet == S_VORTEX || ptr == &mons[PM_AIR_ELEMENTAL].
async function is_whirly_do(ptr) {
    if (!ptr) return false;
    return ptr.mcls === S_VORTEX || ptr.pmidx === await PM_do('air elemental');
}

// C ref: zap.c revive(corpse, by_hero) — NOT PORTED: nothing in js/ defines it
// (js/mkobj.js only has corpse_revive_type(), the vampire-corpse helper).  Kept
// as the call site so revive_corpse()'s control flow below is C's; answering
// null takes C's `return FALSE` tail.
async function revive_unported(_corpse, _by_hero) { return null; }

// C ref: objnam.c Tobjnam(obj, verb) / Doname2(obj) / is_plural(obj).
async function Tobjnam_do(obj, verb) {
    const I = await import('./invent.js');
    return `${upstart(the(I.xname(obj)))} ${I.otense(obj, verb)}`;
}
async function Doname2_do(obj) {
    const I = await import('./invent.js');
    return upstart(I.obj_doname(obj));
}
// C ref: trap.c reset_utrap(msg) — clear the trapped state (js/dothrow.js:166
// and js/dig.js:702 keep the same private copy).
function reset_utrap_do(_msg) {
    const u = game.u;
    u.utrap = 0;
    u.utraptype = 0;
}
// C ref: mondata.h passes_walls(ptr) / nonliving(ptr) / is_vampshifter(mon).
function passes_walls_do(ptr) { return (mflags1_of(ptr) & M1_WALLWALK) !== 0; }
function nonliving_do(mtmp) {
    const ptr = mtmp?.data ?? mtmp;
    if (!ptr) return false;
    return (mflags2_of(ptr) & M2_UNDEAD) !== 0 || ptr.name === 'manes'
        || ptr.mcls === S_GOLEM || ptr.mcls === S_VORTEX;
}
async function is_vampshifter_do(mon) {
    const cham = mon?.cham;
    if (cham == null || cham < 0) return false;
    return cham === await PM_do('vampire') || cham === await PM_do('vampire leader')
        || cham === await PM_do('Vlad the Impaler');
}

// ── boulder_hits_pool (C ref: do.c:50) ──────────────────────────────────────
// A boulder dropped, thrown or pushed into water or lava either fills the pool
// or sinks away; either way it is gone.  The single rn2(10) is drawn for EVERY
// pool-or-lava destination, BEFORE the fills_up decision — including on the
// Plane of Water where fills_up is unconditionally FALSE.
export async function boulder_hits_pool(otmp, rx, ry, pushing) {
    const DB = await import('./dbridge.js');

    if (!otmp || otmp.otyp !== BOULDER) {
        await impossible_do('Not a boulder?');
    } else if (DB.is_pool_or_lava(rx, ry)) {
        const loc = game.level?.at(rx, ry);
        const lava = DB.is_lava(rx, ry);
        const what = waterbody_name_do(rx, ry);
        const ltyp = loc?.typ;
        const chance = rn2(10); /* water: 90%; lava: 10% */
        let mtmp;

        /* Plane of Water 0%, lava 10%, wall of water 50%, other water 90% */
        const fills_up = Is_waterlevel(game.u.uz) ? false
                       : IS_WATERWALL(ltyp) ? (chance < 5)
                       : lava ? (chance === 0) : (chance !== 0);

        if (fills_up) {
            const ttmp = t_at(rx, ry);

            if (ltyp === DRAWBRIDGE_UP) {
                loc.drawbridgemask = (loc.drawbridgemask | 0) & ~DB_UNDER; /* clear lava */
                loc.drawbridgemask |= DB_FLOOR;
            } else {
                loc.typ = ROOM; loc.flags = 0;
                recalc_block_point(rx, ry);
            }
            // C ref: do.c:80-90 — DEADMONSTER() is tested even though we are not
            // walking fmon: a giant drowned by melting ice is still on the map
            // while it drops inventory, and killing it twice trips dmonsfree().
            const MN = await import('./mon.js');
            if ((mtmp = m_at(rx, ry)) != null && !MN.DEADMONSTER(mtmp)
                && !m_in_air_do(mtmp)) {
                const MM = await import('./mhitm.js');
                await MM.mondied_mm(mtmp);
            }

            if (ttmp) {
                const T = await import('./trap.js');
                T.delfloortrap(ttmp);
            }
            const DIG = await import('./dig.js');
            await DIG.bury_objs(rx, ry);

            newsym(rx, ry);
            if (pushing) {
                let whobuf = 'you';
                if (game.u.usteed) {
                    const DN = await import('./do_name.js');
                    whobuf = DN.y_monnam(game.u.usteed);
                }
                const I = await import('./invent.js');
                await pline(`${upstart(whobuf)} ${vtense(whobuf, 'push')} `
                            + `${the(I.xname(otmp))} into the ${what}.`);
                if (game.flags?.verbose && !Blind())
                    await pline('Now you can cross it!');
                /* no splashing in this case */
            }
        }
        if (!fills_up || !pushing) { /* splashing occurs */
            if (!game.u.uinwater) {
                if (pushing ? !Blind() : cansee(rx, ry)) {
                    const I = await import('./invent.js');
                    await pline(`There is a large splash as ${the(I.xname(otmp))} `
                                + `${fills_up ? 'fills' : 'falls into'} the ${what}.`);
                } else if (!Deaf_do()) {
                    /* C: Soundeffect(se_sizzling|se_splash, 100) then You_hear() */
                    await pline(`You hear a${lava ? ' sizzling' : ''} splash.`);
                }
                const C = await import('./cmd.js');
                await C.wake_nearto(rx, ry, 40);
            }

            if (fills_up && game.u.uinwater && distu(rx, ry) === 0) {
                // C ref: do.c:128 set_uinwater(0) — NOT PORTED (nothing in js/
                // defines it); it clears u.uinwater and redoes the underwater
                // display bookkeeping.  The flag is what every caller reads.
                game.u.uinwater = 0;
                await docrt();
                game.vision_full_recalc = 1;
                await pline('You find yourself on dry land again!');
            } else if (lava && next2u(rx, ry)) {
                const DN = await import('./do_name.js');
                await pline(`You are hit by molten ${DN.hliquid('lava')}`
                            + `${Fire_resistance_do() ? '.' : '!'}`);
                const TO = await import('./timeout.js');
                await TO.burn_away_slime();
                const dmg = d(Fire_resistance_do() ? 1 : 3, 6);
                /* C: losehp(Maybe_Half_Phys(dmg), "molten lava", KILLED_BY) */
                await losehp_do(Maybe_Half_Phys_do(dmg));
            } else if (!fills_up && game.flags?.verbose
                       && (pushing ? !Blind() : cansee(rx, ry))) {
                await pline('It sinks without a trace!');
            }
        }

        /* boulder is now gone */
        const I = await import('./invent.js');
        if (pushing) I.useupf(otmp, otmp.quan);
        else I.obfree(otmp, null);
        return true;
    }
    return false;
}

// ── flooreffects (C ref: do.c:162) ──────────────────────────────────────────
// What happens to an object as it lands on <x,y>; must be called with the object
// in no chain at all.  Returns TRUE if the object went away.
//
// Unported dependencies, each kept as its call site so the control flow is C's:
//   * uhitm.c hmon()      — ported but module-private in js/uhitm.js:1145 under
//                           a reduced signature with no HMON_* mode argument.
//   * trap.c lava_damage()— no port anywhere in js/.
//   * dig.c  ship_object()— no port anywhere in js/.
//   * display.c map_background() — no port; newsym() is what redraws here.
export async function flooreffects(obj, x, y, verb) {
    let t, mtmp;
    let tseen = false;
    let ttyp = NO_TRAP, res = false;
    let deletedwithboulder = false;

    // C: `if (obj->where != OBJ_FREE) panic("flooreffects: obj not free")`.  This
    // port stores obj.where as the lower-cased OBJ_* name (js/invent.js
    // objects_at(), js/dig.js rot_corpse()); js/ has no panic().
    if (obj.where !== 'free') {
        await impossible_do('flooreffects: obj not free');
        return false;
    }
    /* make sure things like water_damage() have no pointers to follow */
    obj.nobj = obj.nexthere = null;
    // C ref: do.c:179-183 — erode_obj() (from water_damage()/lava_damage())
    // needs bhitpos, but that broke wand zaps arriving through rloco(), so C
    // saves it here and restores it on EVERY exit path.
    const save_bhitpos = game.bhitpos ? { x: game.bhitpos.x, y: game.bhitpos.y }
                                      : { x: 0, y: 0 };
    game.bhitpos = { x, y };

    const DB = await import('./dbridge.js');
    const I = await import('./invent.js');
    const MO = await import('./mkobj.js');
    const T = await import('./trap.js');
    const DIG = await import('./dig.js');
    const MN = await import('./mon.js');

    if (obj.otyp === BOULDER && await boulder_hits_pool(obj, x, y, false)) {
        res = true;
    } else if (obj.otyp === BOULDER && (t = t_at(x, y)) != null
               && (is_pit(t.ttyp) || is_hole(t.ttyp))) {
        ttyp = t.ttyp;
        tseen = t.tseen ? true : false;
        // C ref: do.c:191 — the assignment to mtmp happens INSIDE the condition,
        // so a non-trapped monster standing here still lands in `mtmp` when it
        // was the second clause (a trapped HERO) that fired; C then takes the
        // `if (mtmp)` arm and hits that monster.  Keep the short-circuit exactly.
        if (((mtmp = m_at(x, y)) != null && mtmp.mtrapped)
            || (game.u.utrap && u_at(x, y))) {
            if (verb && (cansee(x, y) || distu(x, y) === 0))
                await pline(`${Blind() ? 'A' : 'The'} boulder `
                            + `${vtense(null, verb)} into the pit`
                            + `${mtmp ? '' : ' with you'}.`);
            if (mtmp) {
                if (!passes_walls_do(mtmp.data) && !throws_rocks_flag(mtmp.data)) {
                    /* dieroll was rnd(20); 1 == maximum chance to hit, since a
                       trapped target is a sitting duck */
                    const dieroll = 1;

                    if (game.context?.mon_moving) {
                        /* normally ohitmon(), but that can re-enter flooreffects */
                        const W = await import('./weapon.js');
                        const damage = W.dmgval(obj, mtmp);
                        mtmp.mhp -= damage;
                        if (MN.DEADMONSTER(mtmp)) {
                            const U = await import('./uhitm.js');
                            if (U.canspotmon(mtmp)) {
                                const DN = await import('./do_name.js');
                                const dead = nonliving_do(mtmp)
                                          || await is_vampshifter_do(mtmp);
                                await pline(`${DN.Monnam(mtmp)} is `
                                            + `${dead ? 'destroyed' : 'killed'}!`);
                            }
                            const MM = await import('./mhitm.js');
                            await MM.mondied_mm(mtmp);
                        }
                    } else {
                        // C ref: do.c:223 `(void) hmon(mtmp, obj, HMON_THROWN,
                        // dieroll);` — see the header note; exporting the full
                        // hmon() is the fix.  Skipped, so the trapped monster
                        // takes no damage here.
                        void dieroll;
                    }
                    if (!MN.DEADMONSTER(mtmp) && !await is_whirly_do(mtmp.data))
                        res = false; /* still alive, boulder still intact */
                    /* C: nhUse(res) */
                }
                mtmp.mtrapped = 0;
            } else {
                if (!Passes_walls_do() && !throws_rocks_flag(game.u.data)) {
                    /* C: losehp(Maybe_Half_Phys(rnd(15)),
                              "squished under a boulder", NO_KILLER_PREFIX) */
                    await losehp_do(Maybe_Half_Phys_do(rnd(15)));
                    deletedwithboulder = true; /* C: goto deletedwithboulder */
                } else {
                    reset_utrap_do(true);
                }
            }
        }
        if (!deletedwithboulder && verb) {
            if (Blind() && u_at(x, y)) {
                await You_hear_do('a CRASH! beneath you.');
            } else if (!Blind() && cansee(x, y)) {
                await pline('The boulder '
                    + `${(ttyp === TRAPDOOR && !tseen) ? 'triggers and ' : ''}`
                    + `${(ttyp === TRAPDOOR) ? 'plugs a trap door'
                        : (ttyp === HOLE) ? 'plugs a hole' : 'fills a pit'}.`);
            } else {
                await You_hear_do(`a boulder ${verb}.`);
            }
        }
        /* deletedwithboulder: — the trap may already have gone away through
           mondied -> mondead -> m_detach -> fill_pit.  A pit in ice turns that
           ice into floor, so no special ice handling is needed here. */
        if ((t = t_at(x, y)) != null) {
            T.delfloortrap(t);
            if (game.u.utrap && u_at(x, y)) reset_utrap_do(false);
        }
        I.useupf(obj, 1);
        await DIG.bury_objs(x, y);
        newsym(x, y);
        res = true;
    } else if (DB.is_lava(x, y)) {
        // C ref: do.c:271 `res = lava_damage(obj, x, y);` — trap.c lava_damage()
        // has no port in js/ (only water_damage(), js/trap.js:707), so an object
        // that C burns up survives here.
        res = false;
    } else if (DB.is_pool(x, y)) {
        /* Reasonably bulky objects splash when dropped; if you are floating
           above the water even small things make noise.  Stuff dropped near
           fountains always misses. */
        if ((Blind() || (Levitation_do() || Flying_do())) && !Deaf_do()
            && u_at(x, y)) {
            if (!Underwater_do()) {
                if (MO.weight(obj) > WT_SPLASH_THRESHOLD) {
                    await pline('Splash!');
                } else if (Levitation_do() || Flying_do()) {
                    await pline('Plop!');
                }
            }
            /* C: map_background(x, y, 0) — unported; newsym() is the redraw */
            newsym(x, y);
        }
        res = (await T.water_damage(obj, null, false)) === ER_DESTROYED;
    } else if (u_at(x, y) && (t = t_at(x, y)) != null
               && (uteetering_at_seen_pit(t) || uescaped_shaft(t))) {
        if (is_pit(t.ttyp)) {
            if (Blind() && !Deaf_do()) {
                await You_hear_do(`${the(I.xname(obj))} tumble downwards.`);
            } else {
                await pline(`${await Tobjnam_do(obj, 'tumble')} into `
                            + `${t.madeby_u ? 'your' : 'the'} pit.`);
            }
        } else {
            // C ref: do.c:298 `else if (ship_object(obj, x, y, FALSE)) res=TRUE;`
            // — dig.c ship_object() has no port in js/; it drops the object to
            // the level below and prints its own message.
            void 0;
        }
    } else if (obj.globby) {
        /* Globby things like puddings might stick together.  C passes &globbyobj
           and &otmp, and obj_meld() may null either out; js/mkobj.js models the
           two by-reference parameters as {obj} boxes. */
        const g1 = { obj }, g2 = { obj: null };
        while (g1.obj && (g2.obj = MO.obj_nexto_xy(g1.obj, x, y, true)) != null) {
            /* C: pudding_merge_message(globbyobj, otmp) — js/invent.js:485 keeps
               it as a private no-op (the merge lines are not modelled). */
            MO.obj_meld(g1, g2);
        }
        res = !g1.obj;
    } else if (game.context?.mon_moving && IS_ALTAR(game.level?.at(x, y)?.typ)
               && cansee(x, y)) {
        await doaltarobj(obj);
    } else if (obj.oclass === POTION_CLASS
               && (game.level?.flags?.temperature | 0) > 0
               && (game.level?.at(x, y)?.typ === ROOM
                   || game.level?.at(x, y)?.typ === CORR)) {
        /* Potions are sometimes destroyed when landing on very hot ground: 50%
           for nonblessed, 30% for blessed, adjusted by 2% per point of Luck if
           the hero has ever handled the object.  Oil is exempt (its boiling and
           flash points are both above water's). */
        if (cansee(x, y)) {
            /* unconditional "ground": this arm only runs for ROOM and CORR */
            await pline(`${await Tobjnam_do(obj, 'heat')} up as `
                        + `${I.is_plural(obj) ? 'they hit' : 'it hits'} `
                        + 'the hot ground.');
        }

        let survival_chance = obj.blessed ? 70 : 50;
        if (obj.invlet) survival_chance += Luck_do() * 2;
        if (obj.otyp === POT_OIL) survival_chance = 100;

        if (!I.obj_resists(obj, survival_chance, 100)) {
            if (cansee(x, y)) {
                await pline(I.is_plural(obj) ? 'They shatter from the heat!'
                                            : 'It shatters from the heat!');
            } else {
                await You_hear_do('a shattering noise.');
            }
            const DT = await import('./dothrow.js');
            await DT.breakobj(obj, x, y, false, false);
            res = true;
        }
    }

    game.bhitpos = save_bhitpos;
    return res;
}

// ── doaltarobj (C ref: do.c:363) ────────────────────────────────────────────
// An object dropped on an altar: the amber/black flash reveals its BUC status.
export async function doaltarobj(obj) {
    if (Blind()) return;

    const I = await import('./invent.js');
    if (obj.oclass !== COIN_CLASS) {
        /* KMH, conduct — the post-increment happens even when mon_moving */
        if (!game.context?.mon_moving) {
            const uc = (game.u.uconduct = game.u.uconduct || {});
            const was = uc.gnostic | 0;
            uc.gnostic = was + 1;
            if (!was) {
                const LL = await import('./livelog.js');
                LL.livelog_printf(LL.LL_CONDUCT ?? 0x0008,
                    `eschewed atheism, by dropping ${I.obj_doname(obj)} on an altar`);
            }
        }
    } else {
        /* coins don't have bless/curse status */
        obj.blessed = obj.cursed = 0;
    }

    if (obj.blessed || obj.cursed) {
        const DN = await import('./do_name.js');
        await pline(`There is ${an(DN.hcolor(obj.blessed ? 'amber' : 'black'))} `
                    + `flash as ${I.obj_doname(obj)} ${I.otense(obj, 'hit')} `
                    + 'the altar.');
        if (!Hallucination_do()) obj.bknown = 1; /* ok to bypass set_bknown() */
    } else {
        await pline(`${await Doname2_do(obj)} ${I.otense(obj, 'land')} `
                    + 'on the altar.');
        if (obj.oclass !== COIN_CLASS) obj.bknown = 1;
    }
}

// ── polymorph_sink (C ref: do.c:404) ────────────────────────────────────────
// A ring of polymorph down the drain turns the sink into a fountain, throne,
// altar or grave.  RNG: rn2(4) picks the form; the ALTAR arm then draws rn2(3)
// for the alignment and, ONLY when Inhell, a second rn2(3) for the AM_NONE roll.
export async function polymorph_sink() {
    const u = game.u;
    const loc = game.level?.at(u.ux, u.uy);
    const SY = await import('./symbols.js');
    const SP = await import('./sp_lev.js');
    let sym = SY.S_sink;

    if (loc?.typ !== SINK) return;

    const sinklooted = (loc.looted | 0) !== 0;
    /* C: svl.level.flags.nsinks-- is commented out — set_levltyp() recounts.
       NOTE: mkmaze.c set_levltyp()'s count_level_features() call is NOT ported
       (js/mklev.js recount_level_features() is private and only mklev calls it),
       so level.flags.nsinks/nfountains do not follow these edits. */
    loc.flags = 0;
    switch (rn2(4)) {
    default:
    case 0:
        sym = SY.S_fountain;
        SP.set_levltyp_lit(u.ux, u.uy, FOUNTAIN, SET_LIT_NOCHANGE);
        loc.blessedftn = 0;
        if (sinklooted) loc.looted = (loc.looted | 0) | F_LOOTED; /* SET_FOUNTAIN_LOOTED */
        break;
    case 1:
        sym = SY.S_throne;
        SP.set_levltyp_lit(u.ux, u.uy, THRONE, SET_LIT_NOCHANGE);
        if (sinklooted) loc.looted = T_LOOTED;
        break;
    case 2: {
        sym = SY.S_altar;
        SP.set_levltyp_lit(u.ux, u.uy, ALTAR, SET_LIT_NOCHANGE);
        /* 3.6.3: this used to pass 'rn2(A_LAWFUL + 2) - 1' to Align2amask() but
           that evaluates its argument more than once */
        const algn = rn2(3) - 1; /* -1 (A_Cha) or 0 (A_Neu) or +1 (A_Law) */
        loc.altarmask = (In_hell(u.uz) && rn2(3)) ? AM_NONE : Align2amask(algn);
        break;
    }
    case 3: {
        sym = SY.S_room;
        SP.set_levltyp_lit(u.ux, u.uy, ROOM, SET_LIT_NOCHANGE);
        const EN = await import('./engrave.js');
        EN.make_grave(u.ux, u.uy, null);
        if (game.level?.at(u.ux, u.uy)?.typ === GRAVE) sym = SY.S_grave;
        break;
    }
    }
    /* give the message even if blind: we know we are not levitating, so the
       outcome can be felt even when it cannot be seen */
    if (game.level?.at(u.ux, u.uy)?.typ !== ROOM)
        await pline(`The sink transforms into ${an(SY.defsyms[sym].explanation)}!`);
    else
        await pline('The sink vanishes.');
    newsym(u.ux, u.uy);
}

// ── teleport_sink (C ref: do.c:460) ─────────────────────────────────────────
// Move the sink under the hero somewhere else.  RNG: each of up to 200 tries
// draws rnd(COLNO-3) then rn2(ROWNO-2), IN THAT ORDER, and the loop stops on the
// first acceptable square — so the draw count is data-dependent on the map.
export async function teleport_sink() {
    const u = game.u;
    const SP = await import('./sp_lev.js');
    const EN = await import('./engrave.js');
    let trycnt = 0;

    do {
        /* C keeps a disabled `rnd(COLNO-1)/rn2(ROWNO)` variant above this one:
           edge squares are almost never ROOM, so picking them wastes tries. */
        const cx = 1 + rnd((COLNO - 1) - 2); /* 2..COLNO-2 */
        const cy = 1 + rn2(ROWNO - 2);       /* 1..ROWNO-2 */

        if (game.level?.at(cx, cy)?.typ === ROOM
            && !t_at(cx, cy) && !EN.engr_at(cx, cy)
            && (!cansee(cx, cy) || distu(cx, cy) > 3 * 3)) {
            /* this makes set_levltyp() count every sink and fountain on the
               level twice, which is harmless */
            const alreadylooted = game.level.at(u.ux, u.uy).looted;
            /* remove old sink */
            SP.set_levltyp_lit(u.ux, u.uy, ROOM, SET_LIT_NOCHANGE);
            game.level.at(u.ux, u.uy).looted = 0;
            newsym(u.ux, u.uy);
            /* create sink at new position */
            SP.set_levltyp_lit(cx, cy, SINK, SET_LIT_NOCHANGE);
            game.level.at(cx, cy).looted = alreadylooted ? 1 : 0;
            newsym(cx, cy);
            return true;
        }
    } while (++trycnt < 200);

    return false;
}

// ── dosinkring (C ref: do.c:498) ────────────────────────────────────────────
// A ring dropped down a kitchen sink.  Two switches: the first covers effects
// noticeable without eyes, the second (only when sighted and the first produced
// nothing) the visual ones.  The tail draws rn2(20) and then, only if that was
// non-zero, rn2(5) — deciding between backing up, being buried, and vanishing.
export async function dosinkring(obj) {
    const I = await import('./invent.js');
    const u = game.u;
    let ideed = true;
    let nosink = false;

    await pline(`You drop ${I.obj_doname(obj)} down the drain.`);
    obj.in_use = true; /* block free identification via interrupt */

    let giveback = false;
    switch (obj.otyp) { /* effects that can be noticed without eyes */
    case RIN_SEARCHING:
        await pline(`You thought ${I.yname(obj)} got lost in the sink, `
                    + 'but there it is!');
        giveback = true;
        break;
    case RIN_SLOW_DIGESTION:
        await pline('The ring is regurgitated!');
        giveback = true;
        break;
    case RIN_LEVITATION:
        await pline('The sink quivers upward for a moment.');
        break;
    case RIN_POISON_RESISTANCE: {
        const O = await import('./objnam.js');
        await pline(`You smell rotten ${I.makeplural(O.fruitname(false))}.`);
        break;
    }
    case RIN_AGGRAVATE_MONSTER: {
        const DN = await import('./do_name.js');
        await pline(`Several ${Hallucination_do()
            ? I.makeplural(DN.rndmonnam()) : 'flies'} buzz angrily around the sink.`);
        break;
    }
    case RIN_SHOCK_RESISTANCE:
        await pline('Static electricity surrounds the sink.');
        break;
    case RIN_CONFLICT:
        await You_hear_do('loud noises coming from the drain.');
        break;
    case RIN_SUSTAIN_ABILITY: /* KMH */
        await pline(`The ${await hliquid_do('water')} flow seems fixed.`);
        break;
    case RIN_GAIN_STRENGTH:
        await pline(`The ${await hliquid_do('water')} flow seems `
                    + `${(obj.spe < 0) ? 'weak' : 'strong'}er now.`);
        break;
    case RIN_GAIN_CONSTITUTION:
        await pline(`The ${await hliquid_do('water')} flow seems `
                    + `${(obj.spe < 0) ? 'less' : 'great'}er now.`);
        break;
    case RIN_INCREASE_ACCURACY: /* KMH */
        await pline(`The ${await hliquid_do('water')} flow `
                    + `${(obj.spe < 0) ? 'misses' : 'hits'} the drain.`);
        break;
    case RIN_INCREASE_DAMAGE:
        await pline("The water's force seems "
                    + `${(obj.spe < 0) ? 'small' : 'great'}er now.`);
        break;
    case RIN_HUNGER: {
        ideed = false;
        /* C walks svl.level.objects[u.ux][u.uy] via ->nexthere, saving otmp2
           first because delobj() unlinks otmp; objects_at() returns that same
           pile topmost-first as a snapshot array. */
        for (const otmp of I.objects_at(u.ux, u.uy)) {
            if (otmp !== game.uball && otmp !== game.uchain
                && !I.obj_resists(otmp, 1, 99)) {
                if (!Blind()) {
                    await pline(`Suddenly, ${I.obj_doname(otmp)} `
                                + `${I.otense(otmp, 'vanish')} from the sink!`);
                    ideed = true;
                }
                I.delobj(otmp);
            }
        }
        break;
    }
    case MEAT_RING:
        /* Not the same as aggravate monster; besides, it's obvious. */
        await pline('Several flies buzz around the sink.');
        break;
    case RIN_TELEPORTATION:
        nosink = await teleport_sink();
        /* message even if blind: not levitating, so the outcome is felt */
        await pline(`The sink ${nosink ? '' : 'momentarily '}vanishes.`);
        ideed = false;
        break;
    case RIN_POLYMORPH:
        await polymorph_sink();
        nosink = true;
        /* for the S_room case the teleportation message is given instead */
        ideed = (game.level?.at(u.ux, u.uy)?.typ !== ROOM);
        break;
    default:
        ideed = false;
        break;
    }
    if (giveback) { /* C: the `giveback:` label */
        obj.in_use = false;
        I.dropx(obj);
        await I.trycall(obj);
        return;
    }

    if (!Blind() && !ideed) {
        ideed = true;
        const DN = await import('./do_name.js');
        switch (obj.otyp) { /* effects that need eyes */
        case RIN_ADORNMENT:
            await pline('The faucets flash brightly for a moment.');
            break;
        case RIN_REGENERATION:
            await pline('The sink looks as good as new.');
            break;
        case RIN_INVISIBILITY:
            await pline("You don't see anything happen to the sink.");
            break;
        case RIN_FREE_ACTION:
            await pline('You see the ring slide right down the drain!');
            break;
        case RIN_SEE_INVISIBLE:
            await pline(`You see some ${Hallucination_do()
                ? 'oxygen molecules' : 'air'} in the sink.`);
            break;
        case RIN_STEALTH:
            await pline('The sink seems to blend into the floor for a moment.');
            break;
        case RIN_FIRE_RESISTANCE:
            await pline(`The hot ${await hliquid_do('water')} faucet flashes `
                        + 'brightly for a moment.');
            break;
        case RIN_COLD_RESISTANCE:
            await pline(`The cold ${await hliquid_do('water')} faucet flashes `
                        + 'brightly for a moment.');
            break;
        case RIN_PROTECTION_FROM_SHAPE_CHAN:
            await pline('The sink looks nothing like a fountain.');
            break;
        case RIN_PROTECTION:
            await pline(`The sink glows ${DN.hcolor((obj.spe < 0)
                ? 'black' : 'silver')} for a moment.`);
            break;
        case RIN_WARNING:
            await pline(`The sink glows ${DN.hcolor('white')} for a moment.`);
            break;
        case RIN_TELEPORT_CONTROL:
            await pline('The sink looks like it is being beamed aboard somewhere.');
            break;
        case RIN_POLYMORPH_CONTROL:
            await pline('The sink momentarily looks like a regularly '
                        + 'erupting geyser.');
            break;
        default:
            break;
        }
    }
    if (ideed) {
        await I.trycall(obj);
    } else if (!nosink) {
        await You_hear_do('the ring bouncing down the drainpipe.');
    }
    if (!rn2(20) && !nosink) {
        await pline(`The sink backs up, leaving ${I.obj_doname(obj)}.`);
        obj.in_use = false;
        I.dropx(obj);
    } else if (!rn2(5)) {
        I.freeinv(obj);
        obj.in_use = false;
        obj.ox = u.ux;
        obj.oy = u.uy;
        const MO = await import('./mkobj.js');
        MO.add_to_buried(obj);
    } else {
        I.useup(obj);
    }
}

// ── engulfer_digests_food (C ref: do.c:849) ─────────────────────────────────
// While swallowed, a dropped object moves into u.ustuck's inventory; an animal
// swallower (purple worm) instead eats any corpse, glob or meat item outright.
// Returns TRUE if the object was used up.
export async function engulfer_digests_food(obj) {
    const u = game.u;
    const ustuck = u.ustuck;

    if (await digests_do(ustuck?.data)
        && (obj.otyp === CORPSE || obj.globby
            || obj.otyp === MEATBALL || obj.otyp === ENORMOUS_MEATBALL
            || obj.otyp === MEAT_RING || obj.otyp === MEAT_STICK)) {
        let could_petrify = false, could_poly = false, could_slime = false,
            could_grow = false, could_heal = false;

        if (obj.otyp === CORPSE) {
            const MK = await import('./makemon.js');
            could_petrify = await touch_petrifies_do(
                                MK.monster_by_pmidx(obj.corpsenm));
            // C ref: do.c:863 polyfood(obj) — eat.c polyfood() has no port in
            // js/, so a chameleon/genetic-engineer corpse will not re-poly the
            // engulfer here.
            could_poly = false;
            could_grow = (obj.corpsenm === await PM_do('wraith'));
            could_heal = (obj.corpsenm === await PM_do('nurse'));
        } else if (obj.otyp === GLOB_OF_GREEN_SLIME) {
            could_slime = true;
        }
        /* see or feel the effect */
        await pline(`${await Tobjnam_do(obj, 'are')} instantly digested!`);

        if (could_poly || could_slime) {
            const MK = await import('./makemon.js');
            const slime = could_slime
                ? MK.monster_by_pmidx(await PM_do('green slime')) : null;
            /* C: newcham(u.ustuck, slime, could_slime ? NC_SHOW_MSG : 0) */
            MK.newcham(ustuck, slime);
        } else if (could_petrify) {
            // C ref: do.c:876 minstapetrify(u.ustuck, TRUE) — mon.c
            // minstapetrify() has no port in js/, so the engulfer survives.
            void 0;
        } else if (could_grow) {
            // C ref: do.c:878 grow_up(u.ustuck, NULL) — makemon.c grow_up() is
            // ported but module-private in js/mhitm.js:693 under a two-monster
            // (magr, mdef) signature; exporting it is the fix.
            void 0;
        } else if (could_heal) {
            const MNS = await import('./mon.js');
            MNS.healmon(ustuck, ustuck.mhpmax, 0);
            /* FALSE: don't realize that sight is cured from inside */
            const MU = await import('./muse.js');
            await MU.mcureblindness(ustuck, false);
        }
        const I = await import('./invent.js');
        I.delobj(obj); /* always used up */
        return true;
    }
    return false;
}

// ── obj_no_longer_held (C ref: do.c:893) ────────────────────────────────────
// Things that must change when an object stops being held; recurses into
// containers.  Called for both the hero and monsters.  RNG: a FIXED (erodeproof)
// crysknife draws rn2(10), an ordinary one draws nothing.
export async function obj_no_longer_held(obj) {
    if (!obj) {
        return;
    } else if (Has_contents(obj)) {
        for (let contents = obj.cobj; contents; contents = contents.nobj)
            await obj_no_longer_held(contents);
    }
    switch (obj.otyp) {
    case CRYSKNIFE:
        /* A normal crysknife reverts to a worm tooth when not held by hero or
           monster; a fixed one has only a 10% chance of reverting.  A stack of
           the latter should arguably get a per-item roll, but stack splitting
           cannot be handled here. */
        if (!obj.oerodeproof || !rn2(10)) {
            /* if monsters aren't moving, assume the player is responsible */
            if (!game.context?.mon_moving && !game.program_state_gameover) {
                // C ref: do.c:914 costly_alteration(obj, COST_DEGRD) — shk.c
                // costly_alteration() is a private no-op stub at js/trap.js:829;
                // the shop bill is therefore not adjusted.
                void 0;
            }
            obj.otyp = WORM_TOOTH;
            obj.oerodeproof = 0;
        }
        break;
    default:
        break;
    }
}

// ── better_not_try_to_drop_that (C ref: do.c:947) ───────────────────────────
// The paranoid confirmation before dropping a corpse that could petrify you
// bare-handed.  Returns TRUE when the drop should be abandoned.
export async function better_not_try_to_drop_that(otmp) {
    const P = await import('./pickup.js');
    const I = await import('./invent.js');

    /* u_safe_from_fatal_corpse() with st_all checks for gloves and stoning
       resistance before bothering to prompt you. */
    if (otmp.otyp === CORPSE && !P.u_safe_from_fatal_corpse(otmp, P.st_all)) {
        const DN = await import('./do_name.js');
        const buf = `Drop the ${DN.obj_pmname(otmp)} corpse without `
                  + `${I.body_part(HAND)} protection on?`;
        // C ref: do.c:959 paranoid_ynq(TRUE, buf, FALSE) — cmd.c paranoid_ynq()
        // is ported but module-private (js/eat.js:669, js/wizcmds.js:130); the
        // shape of the query is a plain y_n with 'n' as the ESC/default answer.
        const ans = await y_n(buf, 'yn\x1b', 'n');
        return ans !== 'y';
    }
    return false;
}

// ── currentlevel_rewrite (C ref: do.c:1348) ─────────────────────────────────
// Check that the current level can be written out before leaving it.  A failure
// is not impossible (disk quota, unwritable directory) and means the hero can
// neither leave the level nor save.
export async function currentlevel_rewrite() {
    /* since a level change can be slow, flush any buffered screen output (like
       "you fall through a trap door") */
    // C ref: do.c:1355 mark_synch() — windowport bookkeeping; frozen/terminal.js
    // owns the grid in this port and there is nothing to mark.
    await flush_screen(1);

    // C ref: files.c create_levelfile(ledger_no(&u.uz), whynot) — there are no
    // level files in this port at all (files.c is judge-frozen territory);
    // js/save.js:945 keeps the same seam as a null-returning
    // create_levelfile_sv().  Null here is exactly C's failure branch.
    void ledger_no_do(game.u?.uz);
    const nhfp = null;
    if (!nhfp) {
        /*
         * This is not quite impossible: e.g., we may have exceeded our quota.
         * If that is the case then we cannot leave this level, and cannot save
         * either.  Another possibility is that the directory was not writable.
         */
        await pline('Cannot create level file.'); /* C: pline1(whynot) */
        return null;
    }
    return nhfp;
}

// C ref: dungeon.c:1376 ledger_no(lev).  js/bones.js:69 has the faithful private
// copy and js/dig.js:924 a reduced one; js/dungeon.js should own the export.
function ledger_no_do(lev) {
    if (!lev) return 0;
    const dng = game.dungeons?.[lev.dnum];
    return (lev.dlevel | 0) + ((dng?.ledger_start | 0) || 0);
}

// ── save_currentstate (C ref: do.c:1375) ────────────────────────────────────
// The INSURANCE checkpoint: write the just-attained level (with pets and
// everything) plus the non-level state.  INSURANCE is not enabled in the
// recorder build, which is why nothing calls this.
export async function save_currentstate() {
    const S = await import('./save.js');

    game.program_state = game.program_state || {};
    game.program_state.in_checkpoint = (game.program_state.in_checkpoint | 0) + 1;
    if (game.flags?.ins_chkpt) {
        /* write out just-attained level, with pets and everything */
        const nhfp = await currentlevel_rewrite();
        if (!nhfp) {
            game.program_state.in_checkpoint -= 1;
            return;
        }
        /* C: if (nhfp->structlevel) bufon(nhfp->fd); nhfp->mode = WRITING */
        await S.savelev(ledger_no_do(game.u?.uz), WRITING);
        /* C: close_nhfile(nhfp) */
    }

    /* write out non-level state */
    await S.savestateinlock();
    game.program_state.in_checkpoint -= 1;
}

// ── badspot (C ref: do.c:1400) ──────────────────────────────────────────────
// COMMENTED OUT in 3.7's do.c (it sits inside a /* */ block right above
// u_collide_m); ported under its C name for completeness.  A square is "bad"
// for arrival if it is not plain floor/air/corridor or a monster is on it.
export function badspot(x, y) {
    const typ = game.level?.at(x, y)?.typ;
    return (typ !== ROOM && typ !== AIR && typ !== CORR) || !!m_at(x, y);
}

// ── familiar_level_msg (C ref: do.c:1448) ───────────────────────────────────
// The flavour line for arriving on a bones level whose ghost shares the hero's
// name.  resolve_familiar_msg() above is this function's rn2(4)-drawing half,
// split out so goto_level() draws at C's stream position; this is the C-shaped
// wrapper (draw AND print together).
export async function familiar_level_msg() {
    const mesg = resolve_familiar_msg();
    if (mesg) await pline(mesg); /* C: pline1(mesg) */
}

// ── hellish_smoke_mesg (C ref: do.c:2003) ───────────────────────────────────
// The temperature line on entering a Gehennom level other than the Valley; also
// given when restoring a game in that situation.
export async function hellish_smoke_mesg() {
    const temp = game.level?.flags?.temperature | 0;
    if (temp)
        await pline(`It is ${temp > 0 ? 'hot' : 'cold'} here.`);

    if (In_hell(game.u.uz) && temp > 0)
        await pline(`You ${olfaction(game.u?.data) ? 'smell' : 'sense'} smoke...`);
}

// ── temperature_change_msg (C ref: do.c:2016) ───────────────────────────────
// The message when the level temperature differs from the previous level's.
// goto_level() above carries an inline copy of this at its prevTemperature
// block; this is the named C form.
export async function temperature_change_msg(prev_temperature) {
    const temp = game.level?.flags?.temperature | 0;
    if (prev_temperature !== temp) {
        if (temp) {
            await hellish_smoke_mesg();
        } else if (prev_temperature > 0) {
            await pline(`The heat ${In_hell(game.u.uz0) ? 'and smoke are' : 'is'} gone.`);
        } else if (prev_temperature < 0) {
            await pline('You are out of the cold.');
        }
    }
}

// ── maybe_lvltport_feedback (C ref: do.c:2032) ──────────────────────────────
// Deliver the deferred "You materialize on a different level!" over the freshly
// drawn map.  Usually called from goto_level(); might be called from
// Sting_effects().  Only a message that STARTS with "You materialize" is
// consumed — anything else stays pending for deferred_goto()'s own tail.
export async function maybe_lvltport_feedback() {
    const msg = game.dfr_post_msg;
    if (msg && String(msg).slice(0, 15).toLowerCase() === 'you materialize') {
        await pline(String(msg));
        game.dfr_post_msg = null; /* C: free() + NULL */
    }
}

// ── final_level (C ref: do.c:2043) ──────────────────────────────────────────
// Arrival on the Astral Plane.
export async function final_level() {
    /* reset monster hostility relative to player */
    // C ref: do.c:2046 iter_mons(reset_hostility) — mon.c reset_hostility() has
    // no port in js/; it clears mpeaceful/mtame for player-monsters and Riders.
    void 0;

    /* create some player-monsters */
    // C ref: do.c:2049 create_mplayers(rn1(4, 3), TRUE).  The rn1(4,3) count is
    // C's ARGUMENT, drawn here, so keep the draw even though makemon.c
    // create_mplayers() has no port in js/ — the stream position is C's.
    const nplayers = rn1(4, 3);
    void nplayers;

    /* create a guardian angel next to player, if worthy */
    // C ref: do.c:2052 gain_guardian_angel() — priest.c gain_guardian_angel()
    // has no port in js/ (it draws through makemon() when u.ualign.record > 8).
    void 0;
}

// ── schedule_goto (C ref: do.c:2057) ────────────────────────────────────────
// Change levels at the end of this turn, after the monsters finish moving.
// UTOTYPE_DEFERRED is always ORed in so that a UTOTYPE_NONE transit still trips
// moveloop_core()'s `if (u.utotype) deferred_goto()` test.
export function schedule_goto(tolev, utotype_flags, pre_msg, post_msg) {
    const u = game.u;
    u.utotype = utotype_flags | UTOTYPE_DEFERRED;
    /* destination level */
    u.utolev = u.utolev || { dnum: 0, dlevel: 0 };
    assign_level(u.utolev, tolev);

    if (pre_msg) game.dfr_pre_msg = String(pre_msg);   /* C: dupstr() */
    if (post_msg) game.dfr_post_msg = String(post_msg);
}

// ── deferred_goto (C ref: do.c:2075) ────────────────────────────────────────
// Perform a scheduled level change (portal ejection, trap door, level tele).
// run_deferred_lvltport() above is the reduced level-teleport-only twin that the
// covered scroll path uses; this is the general C form.
export async function deferred_goto() {
    const u = game.u;
    if (!on_level(u.uz, u.utolev)) {
        const dest = { dnum: 0, dlevel: 0 }, oldlev = { dnum: 0, dlevel: 0 };
        const typmask = u.utotype; /* save it; goto_level zeroes u.utotype */

        assign_level(dest, u.utolev);
        assign_level(oldlev, u.uz);
        if (game.dfr_pre_msg) await pline(String(game.dfr_pre_msg));
        await goto_level(dest, !!(typmask & UTOTYPE_ATSTAIRS),
                         !!(typmask & UTOTYPE_FALLING),
                         !!(typmask & UTOTYPE_PORTAL));
        if (typmask & UTOTYPE_RMPORTAL) { /* remove portal */
            const t = t_at(u.ux, u.uy);
            if (t) {
                const T = await import('./trap.js');
                T.deltrap(t);
                newsym(u.ux, u.uy);
            }
        }
        if (game.dfr_post_msg && !on_level(u.uz, oldlev))
            await pline(String(game.dfr_post_msg));
    }
    u.utotype = UTOTYPE_NONE; /* our caller keys off of this */
    if (game.dfr_pre_msg) game.dfr_pre_msg = null;
    if (game.dfr_post_msg) game.dfr_post_msg = null;
}

// ── revive_corpse (C ref: do.c:2111) ────────────────────────────────────────
// Turn a corpse back into its monster.  Returns TRUE (corpse gone) on success.
// The whole of the RNG spend is inside zap.c revive(), which has NO port in js/
// (see revive_unported above), so this currently always takes C's FALSE tail.
export async function revive_corpse(corpse) {
    const I = await import('./invent.js');
    const MK = await import('./makemon.js');
    const U = await import('./uhitm.js');
    const DN = await import('./do_name.js');

    let container = null;
    let container_where = 0;
    let mcarry;

    const where = corpse.where;
    const montype = corpse.corpsenm;
    /* treat a buried auto-reviver (troll, Rider?) like a zombie so that it can
       dig itself out of the ground if it revives */
    const mons_row = MK.monster_by_pmidx(montype);
    const is_zomb = (mons_row?.mcls === S_ZOMBIE)
                 || (where === 'buried' && await is_reviver_do(mons_row));
    const is_uwep = (corpse === game.u.uwep);
    const chewed = (corpse.oeaten | 0) !== 0;
    // C ref: do.c:2131 corpse_xname(corpse, chewed ? "bite-covered" : NULL,
    // CXN_SINGULAR) — objnam.c corpse_xname() is ported but module-private at
    // js/invent.js:657; exporting it is the fix.  xname() drops the adjective.
    const cname = I.xname(corpse);
    void CXN_SINGULAR;
    mcarry = (where === 'minvent') ? corpse.ocarry : null;
    /* mcarry is NULL for 'buried' and 'contained' now */

    /* C: get_obj_location(corpse, &corpsex, &corpsey, CONTAINED_TOO|BURIED_TOO) */
    const corpsex = corpse.ox, corpsey = corpse.oy;

    if (where === 'contained') {
        container = corpse.ocontainer;
        // C ref: do.c:2144 get_container_location(container, &where, NULL) —
        // pickup.c get_container_location() has no port in js/; without it the
        // nested-container message arm cannot pick between INVENT and FLOOR.
        container_where = 0;
    }
    const mtmp = await revive_unported(corpse, false); /* corpse gone on success */

    if (mtmp) {
        switch (where) {
        case 'invent':
            if (is_uwep)
                await pline(`The ${cname} writhes out of your grasp!`);
            else
                await pline('You feel squirming in your backpack!');
            break;

        case 'floor':
            if (cansee(corpsex, corpsey) || await canseemon_do(mtmp)) {
                let effect = '';

                if (mtmp.data?.pmidx === await PM_do('Death'))
                    effect = ' in a whirl of spectral skulls';
                else if (mtmp.data?.pmidx === await PM_do('Pestilence'))
                    effect = ' in a churning pillar of flies';
                else if (mtmp.data?.pmidx === await PM_do('Famine'))
                    effect = ' in a ring of withered crops';

                if (await canseemon_do(mtmp)) {
                    await pline(`${chewed ? DN.Adjmonnam(mtmp, 'bite-covered')
                                          : DN.Monnam(mtmp)} `
                                + `rises from the dead${effect}!`);
                } else {
                    await pline(`${upstart(the(cname))} disappears${effect}!`);
                }
            }
            break;

        case 'minvent': /* probably a nymph's */
            if (cansee(mtmp.mx, mtmp.my)) {
                if (mcarry && await canseemon_do(mcarry))
                    await pline(`Startled, ${DN.mon_nam(mcarry)} drops `
                                + `${an(cname)} as it `
                                + `${U.canspotmon(mtmp) ? 'revives' : 'disappears'}!`);
                else if (U.canspotmon(mtmp))
                    await pline(`${chewed ? DN.Adjmonnam(mtmp, 'bite-covered')
                                          : DN.Monnam(mtmp)} suddenly appears!`);
            }
            break;
        case 'contained': {
            /* Could use x_monnam(..., AUGMENT_IT) but that would say "someone"
               for humanoid monsters, a distinction the hero cannot make here. */
            const mnam = U.canspotmon(mtmp) ? DN.Amonnam(mtmp) : 'Something';

            if (!container) {
                await impossible_do('reviving corpse from non-existent container');
            } else if (mcarry && await canseemon_do(mcarry)) {
                await pline(`${mnam} writhes out of ${I.yname(container)}!`);
            } else if (container_where === 'invent') {
                await pline(`${mnam} ${locomotion_do(mtmp.data, 'writhes')} `
                            + `out of ${an(I.xname(container))} in your pack!`);
            } else if (container_where === 'floor' && cansee(corpsex, corpsey)) {
                await pline(`${mnam} escapes from ${an(I.xname(container))}!`);
            }
            break;
        }
        case 'buried':
            if (is_zomb) {
                const T = await import('./trap.js');
                T.maketrap(mtmp.mx, mtmp.my, PIT);
                if (cansee(mtmp.mx, mtmp.my)) {
                    const ttmp = t_at(mtmp.mx, mtmp.my);
                    if (ttmp) ttmp.tseen = true;
                    await pline(`${U.canspotmon(mtmp) ? DN.Amonnam(mtmp)
                                                      : 'Something'} `
                                + 'claws itself out of the ground!');
                    newsym(mtmp.mx, mtmp.my);
                } else if (distu(mtmp.mx, mtmp.my) < 5 * 5) {
                    await You_hear_do('scratching noises.');
                }
                T.fill_pit(mtmp.mx, mtmp.my);
                break;
            }
            /* FALLTHRU */
        default:
            /* we should be able to handle the other cases... */
            await impossible_do(`revive_corpse: lost corpse @ ${where}`);
            break;
        }
        return true;
    }
    return false;
}

// C ref: mondata.c locomotion(ptr, def) — js/dogmove.js:2056, js/monmove.js:1876
// and js/muse.js:297 each keep the same private copy.
function locomotion_do(_ptr, def) { return def; }

// ── revive_mon (C ref: do.c:2251) ───────────────────────────────────────────
// The REVIVE_MON timeout callback.  A displacer (Rider) bumps whatever is
// standing on its corpse out of the way first; on failure the corpse either
// re-arms the Rider retry (rn2(99)) or falls back to rotting (d(5,50)).
export async function revive_mon(arg, timeout) {
    const body = arg.a_obj;
    const MK = await import('./makemon.js');
    const MO = await import('./mkobj.js');
    const mptr = MK.monster_by_pmidx(body.corpsenm);
    let mtmp;

    /* corpse will revive somewhere else if there is a monster in the way;
       Riders get a chance to try to bump the obstacle out of their way */
    if (is_displacer_do(mptr) && body.where === 'floor'
        && (mtmp = m_at(body.ox, body.oy)) != null
        && (game.level?.flags?.stasis_until | 0) < (game.moves | 0)) {
        const U = await import('./uhitm.js');
        const DN = await import('./do_name.js');
        const x = body.ox, y = body.oy;
        const notice_it = await canseemon_do(mtmp); /* before rloc() */
        const monname = DN.Monnam(mtmp);

        const TP = await import('./teleport.js');
        if (await TP.rloc(mtmp, RLOC_NOMSG)) {
            if (notice_it && !await canseemon_do(mtmp))
                await pline(`${monname} vanishes.`);
            else if (!notice_it && await canseemon_do(mtmp))
                await pline(`${DN.Monnam(mtmp)} appears.`); /* not pre-rloc monname */
            else if (notice_it
                     && ((mtmp.mx - x) * (mtmp.mx - x)
                         + (mtmp.my - y) * (mtmp.my - y)) > 2)
                await pline(`${monname} teleports.`); /* saw it and still see it */
        }
    }

    /* if we succeed, the corpse is gone */
    if (!await revive_corpse(body)) {
        let when, action;
        const TO = await import('./timeout.js');

        if (MO.is_rider_pm(body.corpsenm) && rn2(99)) { /* Rider usually retries */
            action = REVIVE_MON;
            // C ref: do.c:2283 rider_revival_time(body, TRUE) — ported but
            // module-private at js/mkobj.js:1404; exporting it is the fix.  The
            // C form is 12 + rnd(500) rescaled by the corpse's age.
            when = 12 + rnd(500);
        } else { /* rot this corpse away */
            if (!TO.obj_has_timer(body, ROT_CORPSE))
                await pline(`You feel ${MO.is_rider_pm(body.corpsenm) ? 'much ' : ''}`
                            + 'less hassled.');
            action = ROT_CORPSE;
            when = d(5, 50) - ((game.moves | 0) - (body.age | 0));
            if (when < 1) when = 1;
        }
        if (!TO.obj_has_timer(body, action))
            await TO.start_timer(when, TIMER_OBJECT, action, arg);
    }
    void timeout;
}

// ── zombify_mon (C ref: do.c:2299) ──────────────────────────────────────────
// The ZOMBIFY_MON timeout callback: re-type the corpse as its zombie form and
// fall into revive_mon(), or just rot if there is no (non-genocided) zombie.
export async function zombify_mon(arg, timeout) {
    const body = arg.a_obj;
    const MNS = await import('./mon.js');
    const MK = await import('./makemon.js');
    const MO = await import('./mkobj.js');
    const zmon = MNS.zombie_form(MK.monster_by_pmidx(body.corpsenm));

    if (zmon !== NON_PM && !((game.mvitals?.[zmon]?.mvflags | 0) & G_GENOD)) {
        if (MO.has_omid(body)) MO.free_omid(body);
        if (MO.has_omonst(body)) MO.free_omonst(body);

        MO.set_corpsenm(body, zmon);
        await revive_mon(arg, timeout);
    } else {
        const DIG = await import('./dig.js');
        await DIG.rot_corpse(arg, timeout);
    }
}

// ── danger_uprops (C ref: do.c:2319) ────────────────────────────────────────
// TRUE when a hero property is actively dangerous, i.e. waiting is a bad idea.
// Used by cmd_safety_prevention() to decide whether to nag about #wait.
export function danger_uprops() {
    return Stoned_do() || Slimed_do() || Strangled_do() || Sick_do();
}

// ── legs_in_no_shape (C ref: do.c:2408) ─────────────────────────────────────
// The common wounded-legs refusal for jumping / kicking / riding.
export async function legs_in_no_shape(for_what, by_steed) {
    const u = game.u;
    if (by_steed && u.usteed) {
        const DN = await import('./do_name.js');
        await pline(`${DN.Monnam(u.usteed)} is in no shape for ${for_what}.`);
    } else {
        const I = await import('./invent.js');
        const wl = EWounded_legs_do() & BOTH_SIDES;
        let bp = I.body_part(LEG);

        if (wl === BOTH_SIDES) bp = I.makeplural(bp);
        await pline(`Your ${(wl === LEFT_SIDE) ? 'left '
                          : (wl === RIGHT_SIDE) ? 'right ' : ''}${bp} `
                    + `${(wl === BOTH_SIDES) ? 'are' : 'is'} in no shape `
                    + `for ${for_what}.`);
    }
}

// C ref: do_name.c hliquid(liquidpref) — js/do_name.js owns the one copy; it
// draws off the DISPLAY rng while Hallucination, not the core rng.
async function hliquid_do(pref) {
    const DN = await import('./do_name.js');
    return DN.hliquid(pref);
}

// C ref: hack.h Luck — u.uluck plus the moon / Friday-13th moreluck term
// (js/zap.js:374, js/dig.js:652, js/readobjnam.js:125 keep the same copy).
function Luck_do() { return (game.u?.uluck | 0) + (game.u?.moreluck | 0); }

// C ref: mondata.h digests(ptr) = dmgtype_fromattack(ptr, AD_DGST, AT_ENGL).
// js/monattk_data.js owns the attack table; its attacktype_fordmg() takes the
// attack type FIRST, so the two argument orders are not interchangeable.
async function digests_do(ptr) {
    const A = await import('./monattk_data.js');
    return !!A.attacktype_fordmg(ptr, A.AT_ENGL, A.AD_DGST);
}
// C ref: mondata.h:200 touch_petrifies(ptr) — cockatrice or chickatrice ONLY
// (Medusa is flesh_petrifies, not this).  js/mon.js:1477 and js/muse.js:366
// keep the same private pmidx-keyed copy.
async function touch_petrifies_do(ptr) {
    if (!ptr) return false;
    const idx = ptr.pmidx;
    return idx === await PM_do('cockatrice') || idx === await PM_do('chickatrice');
}
// C ref: mondata.h:170 is_reviver(ptr) = is_rider(ptr) || mlet == S_TROLL.
async function is_reviver_do(ptr) {
    if (!ptr) return false;
    if (ptr.mcls === S_TROLL) return true;
    const idx = ptr.pmidx;
    return idx === await PM_do('Death') || idx === await PM_do('Famine')
        || idx === await PM_do('Pestilence');
}
// C ref: mondata.h:156 is_displacer(ptr) = (mflags3 & M3_DISPLACES) != 0.
function is_displacer_do(ptr) {
    return (mflags3_of(ptr) & M3_DISPLACES) !== 0;
}
// C ref: display.h canseemon(mon) — js/display.js:398 owns canseemon_shared().
async function canseemon_do(mon) {
    const D = await import('./display.js');
    return D.canseemon_shared(mon);
}
