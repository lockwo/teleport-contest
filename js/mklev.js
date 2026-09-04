// mklev.js — Level generation.
// C ref: mklev.c — makelevel, makerooms, makecorridors, generate_stairs.
// Also includes parts of sp_lev.c (create_room) and mkmap.c (litstate_rnd).
// Stripped-down version for contest: generates regular dungeon levels with
// room placement, corridors, doors, stairs, niches, and fill.
// Uses the real game PRNG (not a separate layout PRNG) for bit-exact parity.

import { game } from './gstate.js';
import { GameMap } from './game.js';
import { rn2, rnd, rn1 } from './rng.js';
import { init_rect, rnd_rect, get_rect, split_rects, within_bounded_area } from './rect.js';
import { depth as depth_of_level, distmin } from './hacklib.js';
import { set_mktrap_victim, filler_region, lspo_map, lspo_region, fill_special_room, themeroom_fill, themeroom_map_contents, makemaz_bigroom, makemaz_bar_strt, makemaz_bar_loca, makemaz_bar_goal, makemaz_arc_strt, makemaz_arc_loca, makemaz_arc_goal, makemaz_pri_strt, makemaz_pri_loca, makemaz_pri_goal, makemaz_tower1, makemaz_tower2, makemaz_tower3, makemaz_soko1, makemaz_soko_upper, makemaz_valley, makemaz_sanctum, makemaz_minetown2, makemaz_minetown3, makemaz_minetown5, makemaz_minetown7, makemaz_minend1, makemaz_minend2, makemaz_minend3, makemaz_medusa1, makemaz_medusa2, makemaz_medusa3, makemaz_medusa4, makemaz_asmodeus, makemaz_baalz, makemaz_juiblex, makemaz_orcus, makemaz_wizard1, makemaz_wizard2, makemaz_wizard3, makemaz_fakewiz1, makemaz_fakewiz2, makemaz_air, makemaz_earth, makemaz_fire, makemaz_water, makemaz_astral, makemaz_cav_strt, makemaz_cav_loca, makemaz_cav_goal, makemaz_cav_fila, makemaz_cav_filb, makemaz_hea_strt, makemaz_hea_loca, makemaz_hea_goal, makemaz_hea_fila, makemaz_hea_filb, makemaz_kni_strt, makemaz_kni_goal, makemaz_kni_loca, makemaz_kni_fila, makemaz_kni_filb, makemaz_mon_strt, makemaz_mon_loca, makemaz_mon_goal, makemaz_ran_strt, makemaz_ran_loca, makemaz_ran_goal, makemaz_ran_fila, makemaz_ran_filb, makemaz_rog_strt, makemaz_rog_loca, makemaz_rog_goal, makemaz_sam_strt, makemaz_sam_loca, makemaz_sam_goal, makemaz_sam_fila, makemaz_sam_filb, makemaz_tou_strt, makemaz_tou_loca, makemaz_tou_goal, makemaz_tou_fila, makemaz_tou_filb, makemaz_val_strt, makemaz_val_loca, makemaz_val_goal, makemaz_val_fila, makemaz_val_filb, makemaz_wiz_loca, makemaz_wiz_goal, makemaz_wiz_strt, shuffle,
         mapfrag_fromstr, mapfrag_match, selection_match, set_levltyp_lit,
         splev_map_origin, reset_xystart_size, flip_level, bigrm_get_level_extends, set_door_orientation,
         okdoor, bydoor, create_door, lspo_door_relative,
         is_ok_location, pm_to_humidity, LOC_DRY,
         run_themeroom_postprocess,
         q_absx, q_absy, quest_floodfill_match, splev_object_at, splev_feature,
         splev_door_at, vly_altar, vly_region, splev_region_lit,
         splev_create_monster, splev_link_doors_rooms, remove_boundary_syms,
         bigrm_get_location_dry, lspo_replace_terrain, bigrm_load_map,
         SET_LIT_NOCHANGE } from './sp_lev.js';
import { create_maze, walkfrom, mz, reset_maze_bounds, mkportal } from './mkmaze.js';
import {
    selection_new, selection_clone, selection_clear, selection_setpoint,
    selection_getpoint, selection_getbounds, selection_iterate,
    selection_numpoints, selection_rndcoord, selection_filter_percent,
    l_selection_iterate,
    selection_filter_mapchar, l_selection_negate, l_selection_and,
    l_selection_or, l_selection_grow, l_selection_fillrect, l_selection_rect,
    l_selection_randline, W_ANY, W_RANDOM, W_NORTH, W_SOUTH, W_EAST, W_WEST,
} from './selvar.js';
import { Is_special, builds_up, In_hell, Is_valley, dunlevs_in_dungeon, level_difficulty_c } from './dungeon.js';
import { In_quest, BR_PORTAL, BR_NO_END1, BR_NO_END2,
         Is_knox_level } from './const.js';
import { roles, races } from './role.js';
import { mflags2_of } from './monflags_data.js';
import { priestini } from './priest.js';
import { somex, somey, somexy, somexyspace, occupied, has_dnstairs, has_upstairs, inside_room, nexttodoor } from './mkroom.js';
import { maketrap, Can_fall_thru, Can_dig_down, t_at, Invocation_lev, deltrap } from './trap.js';
import { makemon as make_monster, rndmonst, mkclass,
         name_to_pmidx, monster_by_pmidx, enexto_spawn, placeOnLevel,
         name_gender_hint, MGEND_MALE, MGEND_FEMALE, MGEND_NEUTRAL } from './makemon.js';
import { m_at, newsym } from './display.js';
import { getbones } from './bones.js';
import { set_corpsenm } from './mkobj.js';
import { make_engr_at, random_engraving, wipe_engr_at, get_rnd_epitaph,
         make_grave } from './engrave.js';
import {
    RANDOM_CLASS, WEAPON_CLASS, ARMOR_CLASS, RING_CLASS, FOOD_CLASS,
    SCROLL_CLASS, POTION_CLASS, TOOL_CLASS, GEM_CLASS, ROCK_CLASS, SPBOOK_no_NOVEL,
    ARROW, DART, BOULDER, GOLD_PIECE, ROCK, KELP_FROND,
    SCR_TELEPORTATION, BELL, CORPSE, STATUE, POT_HEALING, WAN_WISHING,
    POT_GAIN_LEVEL,
    POT_EXTRA_HEALING, POT_SPEED, POT_GAIN_ENERGY, SCR_ENCHANT_WEAPON,
    SCR_ENCHANT_ARMOR, SCR_CONFUSE_MONSTER, SCR_SCARE_MONSTER,
    WAN_DIGGING, SPE_HEALING, LARGE_BOX, CHEST, FOOD_RATION,
    CRAM_RATION, LEMBAS_WAFER, WAND_CLASS, SPBOOK_CLASS,
    WAX_CANDLE, TALLOW_CANDLE, OIL_LAMP,
    mkobj, mkobj_at, mksobj, mksobj_at, mkcorpstat, mkgold, curse,
    unbless, uncurse,
    place_object, weight, objects, add_to_container,
    obj_extract_self_mkobj, dealloc_oextra, GEM_CLASS as GEM_CLASS_MK,
} from './mkobj.js';
import { shtypes } from './shtypes.js';
import { obj_resists } from './zap.js';
import { spell_level } from './u_init.js';
import {
    COLNO, ROWNO, STONE, ROOM, CORR, DOOR, STAIRS,
    HWALL, VWALL, TLCORNER, TRCORNER, BLCORNER, BRCORNER,
    CROSSWALL, TUWALL, TDWALL, TLWALL, TRWALL,
    D_NODOOR, D_CLOSED, D_ISOPEN, D_LOCKED, D_TRAPPED, D_BROKEN, D_SECRET,
    OROOM, VAULT, THEMEROOM, ROOMOFFSET, MAXNROFROOMS, SHARED, NO_ROOM,
    SHOPBASE, COURT, ZOO, BEEHIVE, MORGUE, BARRACKS, SWAMP, TEMPLE,
    LEPREHALL, COCKNEST, ANTHOLE,
    SDOOR, SCORR, IRONBARS, FOUNTAIN, SINK, ALTAR, GRAVE,
    DIR_N, DIR_S, DIR_E, DIR_W, DIR_180,
    IS_WALL, IS_STWALL, IS_DOOR, IS_OBSTRUCTED, IS_FURNITURE, IS_POOL, IS_ROOM,
    IS_SDOOR,
    SPACE_POS, isok, W_NONDIGGABLE, FILL_NONE, FILL_NORMAL, OBJ_AT,
    MATCH_WALL, INVALID_TYPE,
    ICE, MOAT, POOL, WATER, LAVAPOOL, LAVAWALL, DBWALL, AIR, TREE, CLOUD,
    DRAWBRIDGE_UP, DRAWBRIDGE_DOWN,
    WM_MASK, WM_W_LEFT, WM_W_RIGHT, WM_W_TOP, WM_W_BOTTOM,
    WM_T_LONG, WM_T_BL, WM_T_BR,
    WM_C_OUTER, WM_C_INNER,
    WM_X_TL, WM_X_TR, WM_X_BL, WM_X_BR, WM_X_TLBR, WM_X_BLTR,
    A_LAWFUL, A_NONE, Align2amask, AM_SHRINE, AM_NONE,
    LR_UPTELE, LR_DOWNTELE, LR_TELE, LR_UPSTAIR, LR_DOWNSTAIR,
    LR_PORTAL, LR_BRANCH, LA_UP, LA_DOWN,
    In_endgame, BURN,
    DUST, MARK, HEADSTONE,
    TAINT_AGE,
    COULD_SEE, IN_SIGHT,
} from './const.js';

const XLIM = 4;
const YLIM = 3;

// Direction deltas
const xdir = [-1, -1, 0, 1, 1, 1, 0, -1];
const ydir = [0, -1, -1, -1, 0, 1, 1, 1];

// Trap constants
const NO_TRAP = 0;
const TRAPNUM = 26;
const ARROW_TRAP = 1;
const DART_TRAP = 2;
const ROCKTRAP = 3;
const SQKY_BOARD = 4;
const BEAR_TRAP = 5;
const LANDMINE = 6;
const ROLLING_BOULDER_TRAP = 7;
const SLP_GAS_TRAP = 8;
const RUST_TRAP = 9;
const FIRE_TRAP = 10;
const PIT = 11;
const SPIKED_PIT = 12;
const HOLE = 13;
const TRAPDOOR = 14;
const TELEP_TRAP = 15;
const LEVEL_TELEP = 16;
const MAGIC_PORTAL = 17;
const WEB = 18;
const STATUE_TRAP = 19;
const MAGIC_TRAP = 20;
const ANTI_MAGIC = 21;
const POLY_TRAP = 22;
const VIBRATING_SQUARE = 23;
const TRAPPED_DOOR = 24;
const TRAPPED_CHEST = 25;

function is_hole(t) { return t === HOLE || t === TRAPDOOR; }
function is_pit(t) { return t === PIT || t === SPIKED_PIT; }

// Monster indices for makelevel()'s extinction guards.  These were all 0
// ("giant ant") while mvitals_gone() was a constant FALSE; now that it reads
// mvitals they are load-bearing, so they are the real pmidx values.
const PM_LEPRECHAUN = 63;
const PM_KILLER_BEE = 1;
const PM_SOLDIER = 277;
const PM_COCKATRICE = 10;
const PM_SMALL_MIMIC = 64;
const PM_LARGE_MIMIC = 65;
const PM_GIANT_MIMIC = 66;

// C ref: monsym.h MONSYM(13, 'm', MIMIC, S_MIMIC, ...) — makemon.js keys its
// set_mimic_sym() dispatch off the same 13.
const S_MIMIC = 13;

const trap_engravings = {
    [TRAPDOOR]: 'Vlad was here',
    [TELEP_TRAP]: 'ad aerarium',
    [LEVEL_TELEP]: 'ad aerarium',
};

// Stairway list management
function stairway_add(x, y, up, isladder, dest) {
    const node = { sx: x, sy: y, up, isladder, tolev: { ...dest }, next: game.stairs };
    game.stairs = node;
}

// ── Stairway lookup ──

function stairway_find_dir(up) {
    for (let s = game.stairs; s; s = s.next)
        if (s.up === up) return s;
    return null;
}

function stairway_find_special_dir(up) {
    for (let s = game.stairs; s; s = s.next)
        if (s.tolev.dnum !== (game.u?.uz?.dnum ?? 0) && s.up !== up) return s;
    return null;
}

// ── Hero placement (C ref: stairs.c, mkmaze.c) ──

function u_on_newpos(x, y) {
    game.u.ux = x;
    game.u.uy = y;
}

// C ref: mkmaze.c bad_location() — the FULL predicate.  Two terms were missing
// and both change how many rn1() pairs place_lregion() burns before it settles:
//   occupied(x,y)  — a trap, furniture, lava or pool square is rejected;
//   typ == AIR     — accepted alongside ROOM (the Plane of Air is all AIR, so
//                    without it every square there is "bad" and the whole 200-
//                    iteration probabilistic loop runs before the fallback).
function bad_location(x, y, nlx, nly, nhx, nhy) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    if (occupied(x, y)) return true;
    // C: within_bounded_area(x, y, nlx, nly, nhx, nhy) — the `nlx &&` guard is
    // ours, and inert: place_lregion clamps lx to >= 1, so a 0,0,0,0 exclusion
    // can only match x == 0, which never comes out of the rn1.
    if (nlx && x >= nlx && x <= nhx && y >= nly && y <= nhy) return true;
    return !((loc.typ === CORR && !!game.level?.flags?.is_maze_lev)
             || loc.typ === ROOM || loc.typ === AIR);
}

// C ref: mkmaze.c put_lregion_here().  Only the LR_*TELE arms are reachable
// from this port's callers (u_on_upstairs and do.js's level-teleport), so the
// LR_PORTAL / LR_UPSTAIR / LR_DOWNSTAIR / LR_BRANCH arms stay unported — they
// would need this function to be async (mkportal/place_branch are).  The
// is_exclusion_zone(rtype, x, y) test C ANDs into the bad_location check is
// also unported; no exclusion zone is registered on a level that reaches here.
function put_lregion_here(x, y, nlx, nly, nhx, nhy, rtype, oneshot, lev) {
    if (bad_location(x, y, nlx, nly, nhx, nhy)) {
        // C's oneshot arm deletes a destroyable trap and re-tests; we only
        // re-test, so a lone trapped square still fails instead of being freed.
        if (!oneshot) return false;
        if (bad_location(x, y, nlx, nly, nhx, nhy)) return false;
    }
    switch (rtype) {
    case LR_TELE:
    case LR_UPTELE:
    case LR_DOWNTELE:
        // C: a monster on the spot means "try again" unless this is the only
        // square left (then it rloc()s the monster, which draws).  Skipping the
        // retry silently accepted squares C rejects, shortening the rn1 loop.
        if (m_at(x, y) && !oneshot) return false;
        u_on_newpos(x, y);
        break;
    default:
        // C does the rtype's work and returns TRUE; we can't, but returning
        // TRUE keeps the caller's rn1 loop the right length, which is the only
        // thing an unported arm can still get right.
        break;
    }
    return true;
}

// C ref: mkmaze.c place_lregion — place hero (LR_UPTELE/LR_DOWNTELE)
export function place_lregion(lx, ly, hx, hy, nlx, nly, nhx, nhy, rtype, lev) {
    if (!lx) {
        lx = 1; hx = COLNO - 1; ly = 0; hy = ROWNO - 1;
    }
    if (lx < 1) lx = 1;
    if (hx > COLNO - 1) hx = COLNO - 1;
    if (ly < 0) ly = 0;
    if (hy > ROWNO - 1) hy = ROWNO - 1;

    // C: oneshot = (lx == hx && ly == hy) — a 1-cell region has no alternative,
    // so put_lregion_here() must not reject it.
    let oneshot = (lx === hx && ly === hy);
    for (let trycnt = 0; trycnt < 200; trycnt++) {
        const x = rn1((hx - lx) + 1, lx);
        const y = rn1((hy - ly) + 1, ly);
        if (put_lregion_here(x, y, nlx, nly, nhx, nhy, rtype, oneshot, lev))
            return;
    }
    // Deterministic fallback
    oneshot = true;
    for (let x = lx; x <= hx; x++)
        for (let y = ly; y <= hy; y++)
            if (put_lregion_here(x, y, nlx, nly, nhx, nhy, rtype, oneshot, lev))
                return;
}

// C ref: stairs.c u_on_upstairs — place hero on upstairs or fallback
export function u_on_upstairs() {
    const stway = stairway_find_dir(true);
    if (stway) { u_on_newpos(stway.sx, stway.sy); return; }
    // No upstair — try special stairs, then random
    const special = stairway_find_special_dir(0);
    if (special) { u_on_newpos(special.sx, special.sy); return; }
    // Random placement via place_lregion
    place_lregion(0, 0, 0, 0, 0, 0, 0, 0, LR_UPTELE, null);
}

// oinit stub (level-dependent object probability reset)
function oinit() { /* no-op for contest */ }

// C ref: dungeon.c level_difficulty() — depth(&u.uz), plus a compensating
// bump in a "builds up" branch (Vlad's Tower, Sokoban); see makemon.js's copy
// of this same C function for the full rationale.
function level_difficulty() { return level_difficulty_c(); }

// ============================================================
// Stub functions for monster/trap/engraving creation.
// Object creation lives in mkobj.js.
// ============================================================

function rndmonnum() {
    return rndmonst()?.pmidx ?? 0;
}

// makemon — create a monster and (when it has a real position) place it
// on the level so the renderer can draw it.  C ref: makemon.c makemon /
// mon.c place_monster.  The RNG side-effects all live in make_monster();
// here we just record the placement for display.
async function makemon(mdat, x, y, mmflags) {
    const mtmp = make_monster(mdat, x, y, mmflags);
    if (mtmp && x > 0 && y > 0 && game.level) {
        // Via placeOnLevel so a group leader lands BEFORE the members m_initgrp
        // just appended: C links the leader into fmon at makemon.c:1248, ahead of
        // the group block at 1430.  A plain push put the leader AFTER them, which
        // reversed the visit order inside every group.
        placeOnLevel(mtmp, x, y);
    }
    return mtmp;
}

// C ref: mkroom.c in_rooms(x, y, typewanted) — the list of room numbers at/next
// to <x,y> whose rtype matches (SHOPBASE matches any shop).  Stubbed empty, and
// that is exact for this file's ONE caller: dosdoor()'s `shdoor` reads it with
// SHOPBASE, and every dosdoor() call site here (join/makecorridors, makeniche,
// makevtele) runs before do_mkroom(SHOPBASE) assigns any room a shop rtype, so
// C's answer is also "no shop" there.  It is NOT a general stub — a caller that
// runs after mkshop() would need the real scan, which also decides whether
// dosdoor draws its rn2(25)/rn2(5)/rn2(20).
function in_rooms(x, y, rtype) { return []; }

// ============================================================
// Core mklev functions (ported from main project's mklev.js)
// ============================================================

// C ref: bones.c getbones() — now the single source of truth in bones.js
// (imported above).  In the harness it draws the rn2(3) "find bones?" gate and,
// when a prior segment left a bones blob in the shared storage handle for this
// level, prompts + reloads it (wizard "Get bones?"/"Unlink bones?").

// C ref: allmain.c l_nhcore_init()
export function l_nhcore_init() {
    const align = [0, 0, 0]; // A_LAWFUL, A_NEUTRAL, A_CHAOTIC
    for (let i = align.length; i > 1; i--) {
        const j = rn2(i);
        [align[i - 1], align[j]] = [align[j], align[i - 1]];
    }
    game.splev_align = align;
}

// C ref: mklev.c mklev()
export async function mklev() {
    const g = game;
    if (await getbones()) return;   // bones loaded → level already grafted
    g.in_mklev = true;
    await makelevel();
    recount_level_features();
    level_finalize_topology();
    g.in_mklev = false;
}

function recount_level_features() {
    const lvl = game.level;
    if (!lvl?.flags) return;
    let nfountains = 0, nsinks = 0;
    for (let y = 0; y < ROWNO; y++)
        for (let x = 1; x < COLNO; x++) {
            const typ = lvl.at(x, y)?.typ;
            if (typ === FOUNTAIN) nfountains++;
            if (typ === SINK) nsinks++;
        }
    lvl.flags.nfountains = nfountains;
    lvl.flags.nsinks = nsinks;
}

// C ref: mklev.c clear_level_structures()
function clear_level_structures() {
    const g = game;
    g.fmon = null;
    g.level = new GameMap();
    g.level.nroom = 0;
    g.level.nsubroom = 0;
    g.level.subrooms = [];
    g.level.rooms = [];
    g.made_branch = false;
    g.smeq = new Array(MAXNROFROOMS + 1).fill(0);
    g.level.doorindex = 0;
    g.level.doors = [];
    g.stairs = null;
    g.vault_x = -1;
    g.in_mk_themerooms = false; // C: flag is only TRUE inside the themeroom maker
    const lf = g.level.flags;
    lf.nfountains = 0;
    lf.nsinks = 0;
    lf.has_shop = false;
    lf.has_vault = false;
    lf.has_zoo = false;
    lf.has_court = false;
    lf.has_morgue = false;
    lf.graveyard = false;
    lf.has_beehive = false;
    lf.has_barracks = false;
    lf.has_temple = false;
    lf.has_swamp = false;
    lf.noteleport = false;
    lf.hardfloor = false;
    lf.nommap = false;
    lf.hero_memory = true;
    lf.shortsighted = false;
    lf.sokoban_rules = false;
    lf.is_maze_lev = false;
    lf.is_cavernous_lev = false;
    lf.arboreal = false;
    lf.has_town = false;
    lf.wizard_bones = false;
    lf.corrmaze = false;
    // C ref: mklev.c clear_level_structures() — svl.level.flags.temperature =
    // In_hell(&u.uz) ? 1 : 0.  Every Gehennom level starts "hot" (overridden by
    // a special level's own "cold"/"temperate" level_flags, e.g. hellfill's
    // cold-maze style) — this drives hellish_smoke_mesg()/temperature_change_msg()
    // on arrival (do.js goto_level).
    lf.temperature = In_hell(g.u?.uz) ? 1 : 0;
    lf.rndmongen = true;
    lf.deathdrops = true;
    lf.noautosearch = false;
    lf.fumaroles = false;
    lf.stormy = false;
    lf.stasis_until = 0;
    init_rect();
}

// C ref: mkmap.c litstate_rnd()
function litstate_rnd(litstate) {
    if (litstate < 0) {
        const d = depth_of_level(game.u?.uz);
        return (rnd(1 + Math.abs(d)) < 11 && rn2(77)) ? true : false;
    }
    return !!litstate;
}

// C ref: mklev.c makelevel()
async function makelevel() {
    const g = game;
    oinit();
    clear_level_structures();

    // C ref: mklev.c:1267-1270 — special (named) levels dispatch to makemaz()
    // BEFORE the ordinary-level path (and before the medusa rn2(5) check).
    // Currently only the Big Room special level is ported; other named levels
    // fall through to the regular generator (their sessions diverge earlier
    // anyway, so this cannot regress them).
    const slev = Is_special(g.u?.uz);
    if (slev && slev.proto && slev.proto.toLowerCase() === 'bigrm') {
        await makemaz_bigroom();
        // C ref: sp_lev.c:6050 lspo_finalize_level -> fixup_special().  No
        // bigrm-N registers a levregion, so this is the `!added_branch &&
        // Is_branchlev()` arm: place_lregion(0,...,LR_BRANCH), and because the
        // 2-arg des.region(sel,"lit") form adds no room svn.nroom is 0, so the
        // LR_BRANCH->place_branch shortcut is NOT taken and the whole-level rn1
        // loop runs.  Missing it cost both the rn1 pair AND the MAGIC_PORTAL
        // trap it leaves behind, which the hero's own place_lregion then has to
        // reject (seed0367 step 235: the quest portal lands on (74,9), the very
        // square our arrival loop was accepting).
        await mk_fixup_branch();
        return;
    }
    if (slev && slev.proto && slev.proto.toLowerCase() === 'oracle') {
        await makemaz_oracle();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the stronghold (castle.lua),
    // the bottom level of the Dungeons of Doom and the Gehennom branch level.
    if (slev && slev.proto === 'castle') {
        await makemaz_castle();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the Sokoban levels.  soko1
    // carries the reward zoo and the achievement prize; soko2/3/4 share a
    // simpler des.* program.  Both variant files of soko1 and soko2 are ported.
    if (slev && slev.proto === 'soko1') {
        await makemaz_soko1();
        return;
    }
    if (slev && (slev.proto === 'soko2' || slev.proto === 'soko3'
                 || slev.proto === 'soko4')) {
        // soko4 registers a 1-cell "branch" levregion; place_lregions() runs it
        // at level finalize (place_lregion draws rn2(1) for x and y).
        if (await makemaz_soko_upper(slev.proto)) await quest_place_branch();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the Barbarian quest "home"
    // (start) level.  Only Bar-strt is ported; other quest levels fall through.
    if (slev && slev.proto === 'Bar-strt') {
        await makemaz_bar_strt();
        // C ref: place_lregions() at level finalize — place the registered
        // "branch" levregion.  A 1-cell region so place_lregion's rn1 loop draws
        // exactly rn2(1) for x and rn2(1) for y (mkmaze.c:396/397).
        await quest_place_branch();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the Barbarian quest "locate"
    // level (a desert oasis).  Registers no branch levregion, so unlike
    // Bar-strt there is no quest_place_branch() finalize step here.
    if (slev && slev.proto === 'Bar-loca') {
        await makemaz_bar_loca();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the remaining role-quest
    // "locate"/"goal" levels.  Their builders were landed (js/levels/*.js) but
    // never wired into this dispatcher, so every one of them fell through to the
    // generic maze and desynced the whole level's PRNG stream.  None of these
    // .lua files registers a "branch" levregion (only the *-strt files do), so
    // there is no quest_place_branch() finalize; each builder already ends with
    // its own wallification/flip.
    if (slev && slev.proto === 'Bar-goal') {
        await makemaz_bar_goal();
        return;
    }
    if (slev && slev.proto === 'Arc-loca') {
        await makemaz_arc_loca();
        return;
    }
    if (slev && slev.proto === 'Arc-goal') {
        await makemaz_arc_goal();
        return;
    }
    if (slev && slev.proto === 'Pri-loca') {
        await makemaz_pri_loca();
        return;
    }
    if (slev && slev.proto === 'Pri-goal') {
        await makemaz_pri_goal();
        return;
    }
    if (slev && slev.proto === 'Kni-goal') {
        await makemaz_kni_goal();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the remaining role-quest
    // "locate"/"goal" levels (Caveman, Healer, Knight, Monk, Ranger, Rogue,
    // Samurai, Tourist, Valkyrie, and Wizard's goal).  None of these .lua
    // files registers a "branch" levregion (only the *-strt files do;
    // Rog-goal registers its own stair levregion and places it internally at
    // the end of its own builder), so there is no quest_place_branch()
    // finalize here; each builder already ends with its own
    // wallification/flip.
    {
        const QUEST_LOCA_GOAL = {
            'Cav-loca': makemaz_cav_loca, 'Cav-goal': makemaz_cav_goal,
            'Hea-loca': makemaz_hea_loca, 'Hea-goal': makemaz_hea_goal,
            'Kni-loca': makemaz_kni_loca,
            'Mon-loca': makemaz_mon_loca, 'Mon-goal': makemaz_mon_goal,
            'Ran-loca': makemaz_ran_loca, 'Ran-goal': makemaz_ran_goal,
            'Rog-loca': makemaz_rog_loca, 'Rog-goal': makemaz_rog_goal,
            'Sam-loca': makemaz_sam_loca, 'Sam-goal': makemaz_sam_goal,
            'Tou-loca': makemaz_tou_loca, 'Tou-goal': makemaz_tou_goal,
            'Val-loca': makemaz_val_loca, 'Val-goal': makemaz_val_goal,
            'Wiz-goal': makemaz_wiz_goal,
        };
        if (slev && QUEST_LOCA_GOAL[slev.proto]) {
            await QUEST_LOCA_GOAL[slev.proto]();
            return;
        }
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the Wizard quest "locate"
    // level (Wiz-loca.lua), a moated ring-fort on a cloudy plain.  Registers no
    // branch levregion, so no quest_place_branch() finalize.
    if (slev && slev.proto === 'Wiz-loca') {
        await makemaz_wiz_loca();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the Archeologist quest "home"
    // (start) level, a moated keep.  Same finalize as Bar-strt: place the 1-cell
    // "branch" levregion (place_lregion rn2(1)/rn2(1)); then makelevel() runs
    // mineralize(-1,-1,-1,-1,FALSE), whose kelp loop draws rn2(30) per MOAT cell
    // (gold/gem seeding is suppressed on this special level), matching the trace.
    if (slev && slev.proto === 'Arc-strt') {
        await makemaz_arc_strt();
        await quest_place_branch();
        // C ref: mineralize() (moat kelp) is NOT called here — the JS engine
        // defers the fill phase (fill_special_room loop + mineralize) into
        // fastforward_fill_mineralize(), which runs at C's level_finalize_topology
        // point (kelp rn2(30) per MOAT cell just before the hero arrival spot).
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the Priest quest "home"
    // (start) level, the besieged Great Temple.  Same finalize as Bar-strt:
    // place the 1-cell "branch" levregion (place_lregion rn2(1)/rn2(1)).
    if (slev && slev.proto === 'Pri-strt') {
        await makemaz_pri_strt();
        await quest_place_branch();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — Vlad's Tower upper stage.
    if (slev && slev.proto === 'tower1') {
        await makemaz_tower1();
        // C ref: fixup_special() -> no explicit lregion, so the default
        // place_lregion(0,0,0,0,...,LR_BRANCH) runs its whole-level rn1 loop
        // (mkmaze.c:396/397) until it lands on a valid ROOM/CORR cell.  This is
        // exactly the mines' mk_fixup_branch() whole-level probabilistic loop.
        await mk_fixup_branch();
        // C ref: lspo_finalize_level -> level_finalize_topology -> set_wall_state()
        // assigns the WM_MASK wall-mode bits that wall_angle() needs to render
        // cross/T-junction walls correctly (the tower's internal walls).
        set_wall_state();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) for 'tower2'/'tower3'.
    // tower3 finalizes with quest_place_branch(), NOT mk_fixup_branch(): C emits
    // tower3.lua:27's 1-cell LR_BRANCH rn2(1)/rn2(1) pair first.
    if (slev && slev.proto === 'tower2') {
        await makemaz_tower2();
        await mk_fixup_branch();
        set_wall_state();
        return;
    }
    if (slev && slev.proto === 'tower3') {
        await makemaz_tower3();
        await quest_place_branch();
        set_wall_state();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the Valley of the Dead, the
    // gateway level of Gehennom.  lspo_finalize_level's tail order is
    // load-bearing here: the flip (inside makemaz_valley) comes first, then
    // fixup_special() places the "branch" levregion, and only THEN does the
    // fill_special_room() loop stock the three morgues.
    if (slev && slev.proto === 'valley') {
        await makemaz_valley();
        // C ref: fixup_special() places the registered "branch" levregion; the
        // teleport_region is only stored (goto_level places the hero from it).
        await quest_place_branch();
        // The fill_special_room() loop that closes lspo_finalize_level is the
        // engine's generic post-mklev pass (fastforward_fill_mineralize), which
        // runs right after mklev() returns — i.e. already in C's order, after
        // the branch lregion and after level_finalize_topology's mineralize().
        set_wall_state();
        return;
    }

    // C ref: mklev.c:1269 makemaz(slev->proto) — the four named Gehennom demon
    // lairs.  Each script registers and places its OWN levregion list
    // (geh_place_lregions), so there is no quest_place_branch() here.
    if (slev && (slev.proto === 'asmodeus' || slev.proto === 'baalz'
                 || slev.proto === 'juiblex' || slev.proto === 'orcus')) {
        if (slev.proto === 'asmodeus') await makemaz_asmodeus();
        else if (slev.proto === 'baalz') await makemaz_baalz();
        else if (slev.proto === 'juiblex') await makemaz_juiblex();
        else await makemaz_orcus();
        set_wall_state();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the Wizard's tower and the two
    // fake towers.  wiz_place_lregions() runs inside each builder.
    if (slev && (slev.proto === 'wizard1' || slev.proto === 'wizard2'
                 || slev.proto === 'wizard3' || slev.proto === 'fakewiz1'
                 || slev.proto === 'fakewiz2')) {
        if (slev.proto === 'wizard1') await makemaz_wizard1();
        else if (slev.proto === 'wizard2') await makemaz_wizard2();
        else if (slev.proto === 'wizard3') await makemaz_wizard3();
        else if (slev.proto === 'fakewiz1') await makemaz_fakewiz1();
        else await makemaz_fakewiz2();
        set_wall_state();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the four Elemental Planes and
    // the Astral Plane.  plane_place_lregions() runs inside each builder.
    if (slev && (slev.proto === 'air' || slev.proto === 'earth'
                 || slev.proto === 'fire' || slev.proto === 'water'
                 || slev.proto === 'astral')) {
        if (slev.proto === 'air') await makemaz_air();
        else if (slev.proto === 'earth') await makemaz_earth();
        else if (slev.proto === 'fire') await makemaz_fire();
        else if (slev.proto === 'water') await makemaz_water();
        else await makemaz_astral();
        set_wall_state();
        return;
    }
    // C ref: mklev.c:1269 makemaz(slev->proto) — the ten remaining quest "home"
    // (start) levels.  Same finalize as Bar-strt/Arc-strt/Pri-strt: the script
    // registers a 1-cell "branch" levregion, so place_lregion draws rn2(1) for
    // x and rn2(1) for y (mkmaze.c:396/397).
    {
        const QUEST_STRT = {
            'Cav-strt': makemaz_cav_strt, 'Hea-strt': makemaz_hea_strt,
            'Kni-strt': makemaz_kni_strt, 'Mon-strt': makemaz_mon_strt,
            'Ran-strt': makemaz_ran_strt, 'Rog-strt': makemaz_rog_strt,
            'Sam-strt': makemaz_sam_strt, 'Tou-strt': makemaz_tou_strt,
            'Val-strt': makemaz_val_strt, 'Wiz-strt': makemaz_wiz_strt,
        };
        if (slev && QUEST_STRT[slev.proto]) {
            await QUEST_STRT[slev.proto]();
            await quest_place_branch();
            return;
        }
    }

    // C ref: mklev.c:1269 makemaz(slev->proto) — Moloch's Sanctum, the bottom
    // level of Gehennom.  sanctum.lua registers no branch levregion, so unlike
    // the Valley there is no quest_place_branch() here; its des.teleport_region
    // is stored in svd.dndest and consumed by goto_level's own place_lregion.
    if (slev && slev.proto === 'sanctum') {
        await makemaz_sanctum();
        set_wall_state();
        return;
    }

    // C ref: mklev.c:1269 makemaz(slev->proto) — Mine Town.  mkmaze.c:1136:
    // an s_level carrying rndlevs picks its script with rnd(sp->rndlevs); all
    // seven variants (1-7) are ported, so this always dispatches.
    // Mine Town registers no branch levregion (the Mines branch sits on the
    // main-dungeon side), so fixup_special() places nothing here.
    if (slev && slev.proto === 'minetn') {
        const variant = rnd(slev.rndlevs || 1);   // mkmaze.c:1136
        if (variant === 1) {
            await makemaz_minetown1();   // sets its own wall state after flip
            return;
        }
        if (variant === 5) {
            await makemaz_minetown5();
            set_wall_state();
            return;
        }
        if (variant === 4) {
            await makemaz_minetown4();   // sets its own wall state after flip
            return;
        }
        if (variant === 6) {
            await makemaz_minetown6();   // sets its own wall state after flip
            return;
        }
        // minetn-2/3/7 set their own wall state after the flip; they return
        // false only if the _minetn_room_api export below is missing, in which
        // case makelevel() falls through instead of throwing.
        if (variant === 2 && await makemaz_minetown2()) return;
        if (variant === 3 && await makemaz_minetown3()) return;
        if (variant === 7 && await makemaz_minetown7()) return;
    }

    // C ref: mklev.c:1269 makemaz(slev->proto) — Medusa's level.  rndlevs is 4
    // and all four variants are ported, so the rnd(4) always dispatches.
    if (slev && slev.proto === 'medusa') {
        const variant = rnd(slev.rndlevs || 1);   // mkmaze.c:1136
        if (variant === 1) await makemaz_medusa1();
        else if (variant === 2) await makemaz_medusa2();
        else if (variant === 3) await makemaz_medusa3();
        else await makemaz_medusa4();
        set_wall_state();
        return;
    }

    // C ref: mklev.c:1269 makemaz(slev->proto) — Mine's End, the bottom of the
    // Gnomish Mines.  rndlevs is 3 and all three variants are ported.
    if (slev && slev.proto === 'minend') {
        const variant = rnd(slev.rndlevs || 1);   // mkmaze.c:1136
        if (variant === 1) await makemaz_minend1();
        else if (variant === 2) await makemaz_minend2();
        else await makemaz_minend3();
        set_wall_state();
        return;
    }

    // C ref: mklev.c:1271 — svd.dungeons[dnum].fill_lvl[0] dispatch (the mines
    // filler), BEFORE the regular path and the below-Medusa rn2(5) check.
    // Only the Gnomish Mines "minefill" filler is ported; other fill levels (if
    // any) fall through to the regular generator.
    {
        const dnum0 = g.u?.uz?.dnum ?? 0;
        const fill = g.dungeons?.[dnum0]?.fill_lvl;
        if (!slev && fill && fill.toLowerCase() === 'minefill') {
            await makemaz_minefill();
            return;
        }
        // C ref: mklev.c:1273-1274 — svd.dungeons[dnum].fill_lvl[0] dispatch,
        // Gehennom's own filler (js/dungeon.js:57 already carries
        // lvlfill:'hellfill').  This branch sits BEFORE the below-Medusa
        // rn2(5) check below, so (matching C's if/else-if chain) taking it
        // here means that check's rn2(5) is correctly never drawn for any
        // ordinary (non-named) Gehennom level.
        if (!slev && fill && fill.toLowerCase() === 'hellfill') {
            await makemaz_hellfill();
            return;
        }
    }

    // C ref: mklev.c:1275 — `else if (In_quest(&u.uz))`: a quest-branch level
    // that is none of the three named levels dispatches to "{filecode}-fila"
    // (dlevel < the locate level's) or "{filecode}-filb" (>=).  This is an
    // else-if arm in C, so when it fires the below-Medusa rn2(5) check (and
    // the regular generator) are NOT reached at all — no RNG is drawn for
    // them.  Barbarian, Caveman, Healer, Knight, Ranger, Samurai, Tourist and
    // Valkyrie each have their own dedicated builder (their .lua fillers are
    // NOT the generic six-des.room() shape); every other role (Archeologist,
    // Monk, Priest, Rogue, Wizard) uses the generic QUEST_FILLERS data table
    // below via makemaz_quest_fill().
    if (!slev && In_quest(g.u?.uz)) {
        const fc = roles[g.initrole]?.filecode;
        const ql = g.qlocate_level;
        const DEDICATED_FILLERS = {
            Bar: [makemaz_bar_fila, makemaz_bar_filb],
            Cav: [makemaz_cav_fila, makemaz_cav_filb],
            Hea: [makemaz_hea_fila, makemaz_hea_filb],
            Kni: [makemaz_kni_fila, makemaz_kni_filb],
            Ran: [makemaz_ran_fila, makemaz_ran_filb],
            Sam: [makemaz_sam_fila, makemaz_sam_filb],
            Tou: [makemaz_tou_fila, makemaz_tou_filb],
            Val: [makemaz_val_fila, makemaz_val_filb],
        };
        if (DEDICATED_FILLERS[fc] && ql) {
            const [fila, filb] = DEDICATED_FILLERS[fc];
            await (g.u.uz.dlevel < ql.dlevel ? fila : filb)();
            return;
        }
        // Every other ported role's filler is the six-des.room() program.
        if (fc && ql) {
            const nm = fc + (g.u.uz.dlevel < ql.dlevel ? '-fila' : '-filb');
            if (await makemaz_quest_fill(nm)) return;
        }
    }

    // C ref: mklev.c:1286-1288 — `In_hell(&u.uz) || (rn2(5) && ...)`.  This is
    // a logical OR: when the level is In_hell, the right-hand side (including
    // the rn2(5) draw) is never evaluated at all.  Every Gehennom level takes
    // an earlier branch (slev or the fill_lvl check above) in practice, so
    // this line is normally unreachable for In_hell levels anyway — but guard
    // it explicitly too, for any not-yet-ported named Gehennom special that
    // falls through to here.
    const medusa = g.medusa_level;
    if (!In_hell(g.u?.uz) && rn2(5) && g.u?.uz?.dnum === medusa?.dnum
        && (g.u?.uz?.dlevel ?? 1) > (medusa?.dlevel ?? 999)) {
        // Would generate maze — not applicable for contest level 1
    }

    // Regular level generation
    // C ref: mklev.c:1294 — the Rogue-emulation level replaces makerooms()
    // wholesale and then jumps to skip0 (no themerms.lua load, no corridors,
    // no niches, no vault, no special room).
    const isRogue = Is_rogue_level_mk();
    if (isRogue) {
        makeroguerooms();
        makerogueghost();
    } else {
    // C ref: mklev.c:382-388 — load themerms.lua for themed rooms
    // nhlib.lua shuffle when loading themerms.lua (first level of branch)
    const dnum = g.u?.uz?.dnum ?? 0;
    if (!g._luathemes_loaded) g._luathemes_loaded = {};
    if (!g._luathemes_loaded[dnum]) {
        const themedAlign = ['law', 'neutral', 'chaos'];
        for (let i = themedAlign.length; i > 1; i--) {
            const j = rn2(i);
            [themedAlign[i - 1], themedAlign[j]] = [themedAlign[j], themedAlign[i - 1]];
        }
        g._luathemes_loaded[dnum] = true;
    }

    await makerooms();
    }

    if (g.level.nroom <= 0) return;
    sort_rooms();
    await generate_stairs();

    // Branch check
    const branchp = is_branchlev();
    // C ref: mklev.c:1306 — minimum number of rooms needed to allow a random
    // special room (4 on branch levels, otherwise 3).  Incremented when a
    // secret vault is added (mklev.c:1328).
    let room_threshold = branchp ? 4 : 3;

    // C ref: mklev.c:1308 `if (Is_rogue_level(&u.uz)) goto skip0;`
    if (!isRogue) {
    makecorridors();
    await make_niches();

    // Vault creation (simplified for contest)
    if (g.vault_x !== -1) {
        const vw = { v: 1 }, vh = { v: 1 };
        const vx = { v: g.vault_x }, vy = { v: g.vault_y };
        if (check_room(vx, vw, vy, vh, true)) {
            add_room(vx.v, vy.v, vx.v + vw.v, vy.v + vh.v, true, VAULT, false);
            g.level.flags.has_vault = true;
            room_threshold++;                   // C ref: mklev.c:1328
            const vaultRoom = g.level.rooms[g.level.nroom - 1];
            if (vaultRoom) vaultRoom.needfill = FILL_NORMAL;
            fill_special_room(vaultRoom);       // C ref: mklev.c:1330
            await mk_knox_portal(vx.v + vw.v, vy.v + vh.v);
            // C ref: mklev.c:1332 `if (!svl.level.flags.noteleport && !rn2(3))
            // makevtele();` — the flag test short-circuits the rn2(3) away.
            if (!g.level.flags.noteleport && !rn2(3)) await makevtele();
        } else if (rnd_rect() && create_vault()) {
            // C ref: mklev.c:1334 — fallback vault attempt with fresh rnd_rect
            g.vault_x = g.level.rooms[g.level.nroom]?.lx ?? -1;
            g.vault_y = g.level.rooms[g.level.nroom]?.ly ?? -1;
            const vx2 = { v: g.vault_x }, vy2 = { v: g.vault_y };
            if (check_room(vx2, vw, vy2, vh, true)) {
                add_room(vx2.v, vy2.v, vx2.v + vw.v, vy2.v + vh.v, true, VAULT, false);
                g.level.flags.has_vault = true;
                room_threshold++;
                const vaultRoom2 = g.level.rooms[g.level.nroom - 1];
                if (vaultRoom2) vaultRoom2.needfill = FILL_NORMAL;
                fill_special_room(vaultRoom2);
                await mk_knox_portal(vx2.v + vw.v, vy2.v + vh.v);
                if (!g.level.flags.noteleport && !rn2(3)) await makevtele();
            } else {
                if (g.level.rooms[g.level.nroom]) g.level.rooms[g.level.nroom].hx = -1;
            }
        }
    }

    // C ref: mklev.c:1344-1375 — make up to 1 special room, type depends on
    // depth.  do_mkroom only sets the room's rtype/needfill; the room is filled
    // later by the fill_special_room loop.  The rn2() gating conditions here are
    // consumed regardless of whether the room maker succeeds, so they must run
    // in this exact order to keep the PRNG aligned with C.
    {
        const u_depth = depth_of_level(g.u?.uz);
        const medusaDepth = g.medusa_level
            ? depth_of_level(g.medusa_level) : 999;
        const wizardEnv = false; // contest build never sets SHOPTYPE env
        if (g.flags?.debug && wizardEnv) {
            await do_mkroom(SHOPBASE);
        } else if (u_depth > 1 && u_depth < medusaDepth
                   && g.level.nroom >= room_threshold && rn2(u_depth) < 3) {
            await do_mkroom(SHOPBASE);
        } else if (u_depth > 4 && !rn2(6)) {
            await do_mkroom(COURT);
        } else if (u_depth > 5 && !rn2(8) && !mvitals_gone(PM_LEPRECHAUN)) {
            await do_mkroom(LEPREHALL);
        } else if (u_depth > 6 && !rn2(7)) {
            await do_mkroom(ZOO);
        } else if (u_depth > 8 && !rn2(5)) {
            await do_mkroom(TEMPLE);
        } else if (u_depth > 9 && !rn2(5) && !mvitals_gone(PM_KILLER_BEE)) {
            await do_mkroom(BEEHIVE);
        } else if (u_depth > 11 && !rn2(6)) {
            await do_mkroom(MORGUE);
        } else if (u_depth > 12 && !rn2(8) && antholemon()) {
            await do_mkroom(ANTHOLE);
        } else if (u_depth > 14 && !rn2(4) && !mvitals_gone(PM_SOLDIER)) {
            await do_mkroom(BARRACKS);
        } else if (u_depth > 15 && !rn2(6)) {
            await do_mkroom(SWAMP);
        } else if (u_depth > 16 && !rn2(8) && !mvitals_gone(PM_COCKATRICE)) {
            await do_mkroom(COCKNEST);
        }
    }
    }   /* skip0: */

    // Place dungeon branch
    if (branchp) {
        const prevstairs = g.stairs; /* test for place_branch() success */
        await place_branch(branchp, 0, 0);
        // C ref: mklev.c:1382-1387 — for main dungeon level 1, the up stairs
        // where the hero starts are branch stairs; treat them as if the hero
        // had just come down them by marking them traversed.  This makes
        // known_branch_stairs() true so the staircase renders as a branch
        // staircase (CLR_YELLOW) rather than a plain one.
        if ((g.u?.uz?.dnum ?? 0) === 0 && (g.u?.uz?.dlevel ?? 1) === 1
            && g.stairs !== prevstairs)
            g.stairs.u_traversed = true;
    }

    // C ref: mklev.c:1392-1402 — choose which fillable room gets bonus items
    // This rn2(fillable_room_count) call must happen here regardless of whether
    // fill_ordinary_room is called immediately or deferred to fastforward.
    {
        let fillable_room_count = 0;
        for (let i = 0; i < (g.level.rooms?.length ?? 0); i++) {
            const croom = g.level.rooms[i];
            if (!croom || croom.hx <= 0) break;
            if ((croom.rtype === OROOM || croom.rtype === THEMEROOM)
                && croom.needfill === FILL_NORMAL)
                fillable_room_count++;
        }
        g.level._bonus_room_idx = (fillable_room_count > 0) ? rn2(fillable_room_count) : -1;
    }

    // Fill rooms + mineralize: handled by fastforward_fill_mineralize (seed8000)
    // or real fill loop (all other seeds), called from allmain.js.
}

// ── Rogue-emulation level (C ref: src/extralev.c) ───────────────────────────
// Rogue levels are a 3x3 grid of cells, each holding either a real room or a
// bare intersection ("dummy"), joined by a mini maze walk.  makelevel() takes
// this instead of makerooms() and then jumps straight to place_branch(),
// skipping makecorridors/make_niches/the vault/do_mkroom entirely (C's
// `goto skip0`).
const XL_UP = 1, XL_DOWN = 2, XL_LEFT = 4, XL_RIGHT = 8;

// gr.r[3][3]
let rogue_r = null;
function rogue_cell(x, y) { return rogue_r[x][y]; }

// C ref: extralev.c:277 corr(x, y) — 1 corridor square in 50 is secret.
function rogue_corr_sq(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) { rn2(50); return; }
    if (rn2(50)) loc.typ = CORR;
    else loc.typ = SCORR;
}

// C ref: extralev.c:21 roguejoin() — an L/Z-shaped corridor between two door
// stubs, with the bend picked by one rn2 over the span.
function roguejoin(x1, y1, x2, y2, horiz) {
    let x, y, middle;
    if (horiz) {
        middle = x1 + rn2(x2 - x1 + 1);
        for (x = Math.min(x1, middle); x <= Math.max(x1, middle); x++) rogue_corr_sq(x, y1);
        for (y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) rogue_corr_sq(middle, y);
        for (x = Math.min(middle, x2); x <= Math.max(middle, x2); x++) rogue_corr_sq(x, y2);
    } else {
        middle = y1 + rn2(y2 - y1 + 1);
        for (y = Math.min(y1, middle); y <= Math.max(y1, middle); y++) rogue_corr_sq(x1, y);
        for (x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) rogue_corr_sq(x, middle);
        for (y = Math.min(middle, y2); y <= Math.max(middle, y2); y++) rogue_corr_sq(x2, y);
    }
}

// C ref: extralev.c:45 roguecorr() — punch the two doors and join them.
function roguecorr(x, y, dir) {
    let fromx, fromy, tox, toy;
    if (dir === XL_DOWN) {
        const cell = rogue_cell(x, y);
        cell.doortable &= ~XL_DOWN;
        if (!cell.real) {
            fromx = cell.rlx; fromy = cell.rly;
            fromx += 1 + 26 * x; fromy += 7 * y;
        } else {
            fromx = cell.rlx + rn2(cell.dx);
            fromy = cell.rly + cell.dy;
            fromx += 1 + 26 * x; fromy += 7 * y;
            dodoor(fromx, fromy, game.level.rooms[cell.nroom]);
            const l = game.level.at(fromx, fromy);
            if (l) l.doormask = D_NODOOR;
            fromy++;
        }
        if (y >= 2) return;
        y++;
        const cell2 = rogue_cell(x, y);
        cell2.doortable &= ~XL_UP;
        if (!cell2.real) {
            tox = cell2.rlx; toy = cell2.rly;
            tox += 1 + 26 * x; toy += 7 * y;
        } else {
            tox = cell2.rlx + rn2(cell2.dx);
            toy = cell2.rly - 1;
            tox += 1 + 26 * x; toy += 7 * y;
            dodoor(tox, toy, game.level.rooms[cell2.nroom]);
            const l = game.level.at(tox, toy);
            if (l) l.doormask = D_NODOOR;
            toy--;
        }
        roguejoin(fromx, fromy, tox, toy, false);
        return;
    } else if (dir === XL_RIGHT) {
        const cell = rogue_cell(x, y);
        cell.doortable &= ~XL_RIGHT;
        if (!cell.real) {
            fromx = cell.rlx; fromy = cell.rly;
            fromx += 1 + 26 * x; fromy += 7 * y;
        } else {
            fromx = cell.rlx + cell.dx;
            fromy = cell.rly + rn2(cell.dy);
            fromx += 1 + 26 * x; fromy += 7 * y;
            dodoor(fromx, fromy, game.level.rooms[cell.nroom]);
            const l = game.level.at(fromx, fromy);
            if (l) l.doormask = D_NODOOR;
            fromx++;
        }
        if (x >= 2) return;
        x++;
        const cell2 = rogue_cell(x, y);
        cell2.doortable &= ~XL_LEFT;
        if (!cell2.real) {
            tox = cell2.rlx; toy = cell2.rly;
            tox += 1 + 26 * x; toy += 7 * y;
        } else {
            tox = cell2.rlx - 1;
            toy = cell2.rly + rn2(cell2.dy);
            tox += 1 + 26 * x; toy += 7 * y;
            dodoor(tox, toy, game.level.rooms[cell2.nroom]);
            const l = game.level.at(tox, toy);
            if (l) l.doormask = D_NODOOR;
            tox--;
        }
        roguejoin(fromx, fromy, tox, toy, true);
        return;
    }
}

// C ref: extralev.c:138 miniwalk() — walkfrom() over the 3x3 grid.  The
// `|| !rn2(10)` arms are what give a Rogue level its extra connections, and
// each one draws whether or not it is taken.
function miniwalk(x, y) {
    const dirs = [0, 0, 0, 0];
    for (;;) {
        let q = 0;
        const here = () => rogue_cell(x, y);
        if (x > 0 && !(here().doortable & XL_LEFT)
            && (!rogue_cell(x - 1, y).doortable || !rn2(10)))
            dirs[q++] = 0;
        if (x < 2 && !(here().doortable & XL_RIGHT)
            && (!rogue_cell(x + 1, y).doortable || !rn2(10)))
            dirs[q++] = 1;
        if (y > 0 && !(here().doortable & XL_UP)
            && (!rogue_cell(x, y - 1).doortable || !rn2(10)))
            dirs[q++] = 2;
        if (y < 2 && !(here().doortable & XL_DOWN)
            && (!rogue_cell(x, y + 1).doortable || !rn2(10)))
            dirs[q++] = 3;
        if (!q) return;
        const dir = dirs[rn2(q)];
        switch (dir) {
        case 0: rogue_cell(x, y).doortable |= XL_LEFT;  x--; rogue_cell(x, y).doortable |= XL_RIGHT; break;
        case 1: rogue_cell(x, y).doortable |= XL_RIGHT; x++; rogue_cell(x, y).doortable |= XL_LEFT;  break;
        case 2: rogue_cell(x, y).doortable |= XL_UP;    y--; rogue_cell(x, y).doortable |= XL_DOWN;  break;
        case 3: rogue_cell(x, y).doortable |= XL_DOWN;  y++; rogue_cell(x, y).doortable |= XL_UP;    break;
        }
        miniwalk(x, y);
    }
}

// C ref: extralev.c:190 makeroguerooms().
function makeroguerooms() {
    const g = game;
    rogue_r = [];
    for (let i = 0; i < 3; i++) {
        rogue_r.push([]);
        for (let j = 0; j < 3; j++)
            rogue_r[i].push({ rlx: 0, rly: 0, dx: 0, dy: 0, real: false, doortable: 0, nroom: 0 });
    }
    g.level.nroom = 0;
    for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++) {
            const here = rogue_r[x][y];
            // C: at least one real room — if the first 8 are dummies the last
            // is forced real.
            if (!rn2(5) && (g.level.nroom || (x < 2 && y < 2))) {
                here.real = false;
                here.rlx = rn1(22, 2);
                here.rly = rn1((y === 2) ? 4 : 3, 2);
            } else {
                here.real = true;
                here.dx = rn1(22, 2);                       /* 2-23 long */
                here.dy = rn1((y === 2) ? 4 : 3, 2);        /* 2-5 high  */
                here.rlx = rnd(23 - here.dx + 1);
                here.rly = rnd(((y === 2) ? 5 : 4) - here.dy + 1);
                g.level.nroom++;
            }
            here.doortable = 0;
        }
    miniwalk(rn2(3), rn2(3));
    g.level.nroom = 0;
    for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++) {
            const here = rogue_r[x][y];
            if (here.real) {
                here.nroom = g.level.nroom;
                g.smeq[g.level.nroom] = g.level.nroom;
                const lowx = 1 + 26 * x + here.rlx;
                const lowy = 7 * y + here.rly;
                const hix = 1 + 26 * x + here.rlx + here.dx - 1;
                const hiy = 7 * y + here.rly + here.dy - 1;
                // C: "should be lit only above level 10, but Rogue rooms are
                // only encountered below level 10, so use !rn2(7)".
                add_room(lowx, lowy, hix, hiy, !rn2(7), OROOM, false);
            }
        }
    for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++) {
            const here = rogue_r[x][y];
            if (here.doortable & XL_DOWN) roguecorr(x, y, XL_DOWN);
            if (here.doortable & XL_RIGHT) roguecorr(x, y, XL_RIGHT);
        }
}

// C ref: do_name.c:1437 roguename().
function roguename() {
    return rn2(3) ? (rn2(2) ? 'Michael Toy' : 'Kenneth Arnold') : 'Glenn Wichman';
}

// C ref: extralev.c:288 makerogueghost() — a sleeping ghost with Rogue's own
// starting kit.  Every rn2 here fires unconditionally in this order.
const PM_GHOST_IDX = name_to_pmidx('ghost');
const MACE_OTYP = 73, TWO_HANDED_SWORD_OTYP = 55, BOW_OTYP = 83;
const RING_MAIL_OTYP = 132, PLATE_MAIL_OTYP = 121, FAKE_AMULET_OTYP = 212;
function makerogueghost() {
    const g = game;
    if (!g.level.nroom) return;
    const croom = g.level.rooms[rn2(g.level.nroom)];
    const x = somex(croom), y = somey(croom);
    const ghost = make_monster(monster_by_pmidx(PM_GHOST_IDX), x, y, 0);
    if (!ghost) return;
    ghost.msleeping = 1;
    ghost.mname = roguename();
    ghost.mnamelth = 1;

    let o;
    if (rn2(4)) {
        o = mksobj_at(FOOD_RATION, x, y, false, false);
        if (o) { o.quan = rnd(7); o.owt = weight(o); }
    }
    if (rn2(2)) {
        o = mksobj_at(MACE_OTYP, x, y, false, false);
        if (o) o.spe = rnd(3);
        if (rn2(4) && o) curse(o);
    } else {
        o = mksobj_at(TWO_HANDED_SWORD_OTYP, x, y, false, false);
        if (o) o.spe = rnd(5) - 2;
        if (rn2(4) && o) curse(o);
    }
    o = mksobj_at(BOW_OTYP, x, y, false, false);
    if (o) o.spe = 1;
    if (rn2(4) && o) curse(o);

    o = mksobj_at(ARROW, x, y, false, false);
    if (o) { o.spe = 0; o.quan = rn1(10, 25); o.owt = weight(o); }
    if (rn2(4) && o) curse(o);

    if (rn2(2)) {
        o = mksobj_at(RING_MAIL_OTYP, x, y, false, false);
        if (o) o.spe = rn2(3);
        if (!rn2(3) && o) o.oerodeproof = true;
        if (rn2(4) && o) curse(o);
    } else {
        o = mksobj_at(PLATE_MAIL_OTYP, x, y, false, false);
        if (o) o.spe = rnd(5) - 2;
        if (!rn2(3) && o) o.oerodeproof = true;
        if (rn2(4) && o) curse(o);
    }
    if (rn2(2)) {
        o = mksobj_at(FAKE_AMULET_OTYP, x, y, true, false);
        if (o) o.known = true;
    }
}

// C ref: dungeon.h Is_rogue_level(uz).
function Is_rogue_level_mk() {
    const uz = game.u?.uz, rl = game.rogue_level;
    return !!uz && !!rl && uz.dnum === rl.dnum && uz.dlevel === rl.dlevel;
}

// C ref: mklev.c makerooms()
async function makerooms() {
    const g = game;
    let tried_vault = false;
    const difficulty = depth_of_level(g.u?.uz);
    let themeroom_tries = 0;

    while (g.level.nroom < (MAXNROFROOMS - 1) && rnd_rect()) {
        if (g.level.nroom >= Math.trunc(MAXNROFROOMS / 6) && rn2(2) && !tried_vault) {
            tried_vault = true;
            if (create_vault()) {
                g.vault_x = g.level.rooms[g.level.nroom]?.lx ?? -1;
                g.vault_y = g.level.rooms[g.level.nroom]?.ly ?? -1;
                if (g.level.rooms[g.level.nroom]) g.level.rooms[g.level.nroom].hx = -1;
            }
        } else {
            // Themed room selection (reservoir sampling).
            // C ref: mklev.c:413-417 — gi.in_mk_themerooms is TRUE only for the
            // duration of the themerooms_generate lua call (it is FALSE in the
            // vault branch and outside the maker). check_room() reads this flag
            // and *rejects* a room that needed shrinking instead of
            // shrinking+accepting it; rejecting skips an extra rect split and
            // keeps the subsequent rnd_rect args aligned with C. themeroom_failed
            // is also reset to FALSE around the call (mklev.c:414).
            g.themeroom_failed = false;
            g.in_mk_themerooms = true;
            let themed_ok;
            try {
                themed_ok = await themerooms_generate(difficulty);
            } finally {
                g.in_mk_themerooms = false;
            }
            if (!themed_ok) {
                if (themeroom_tries++ > 10
                    || g.level.nroom >= Math.trunc(MAXNROFROOMS / 6))
                    break;
            }
        }
    }
}

// Themed room metadata — must match C's themerms.lua frequency table exactly.
// Generated from themeroom_meta.js (31 rooms).
const THEMEROOM_META = [
    { name: 'default', frequency: 1000 },
    { name: 'Fake Delphi', frequency: 1 },
    { name: 'Room in a room', frequency: 1 },
    { name: 'Huge room with another room inside', frequency: 1 },
    { name: 'Nesting rooms', frequency: 1 },
    { name: 'Default room with themed fill', frequency: 6 },
    { name: 'Unlit room with themed fill', frequency: 2 },
    { name: 'Room with both normal contents and themed fill', frequency: 2 },
    { name: 'Pillars', frequency: 1 },
    { name: 'Mausoleum', frequency: 1 },
    { name: 'Random dungeon feature', frequency: 1 },
    { name: 'L-shaped', frequency: 1 },
    { name: 'L-shaped, rot 1', frequency: 1 },
    { name: 'L-shaped, rot 2', frequency: 1 },
    { name: 'L-shaped, rot 3', frequency: 1 },
    { name: 'Blocked center', frequency: 1 },
    { name: 'Circular, small', frequency: 1 },
    { name: 'Circular, medium', frequency: 1 },
    { name: 'Circular, big', frequency: 1 },
    { name: 'T-shaped', frequency: 1 },
    { name: 'T-shaped, rot 1', frequency: 1 },
    { name: 'T-shaped, rot 2', frequency: 1 },
    { name: 'T-shaped, rot 3', frequency: 1 },
    { name: 'S-shaped', frequency: 1 },
    { name: 'S-shaped, rot 1', frequency: 1 },
    { name: 'Z-shaped', frequency: 1 },
    { name: 'Z-shaped, rot 1', frequency: 1 },
    { name: 'Cross', frequency: 1 },
    { name: 'Four-leaf clover', frequency: 1 },
    { name: 'Water-surrounded vault', frequency: 1 },
    { name: 'Twin businesses', frequency: 1, mindiff: 4 },
];

const THEMEROOM_MAPS = {
    'L-shaped': {
        filler: [1, 1],
        map: `-----xxx
|...|xxx
|...|xxx
|...----
|......|
|......|
|......|
--------`,
    },
    'L-shaped, rot 1': {
        filler: [5, 1],
        map: `xxx-----
xxx|...|
xxx|...|
----...|
|......|
|......|
|......|
--------`,
    },
    'L-shaped, rot 2': {
        filler: [1, 1],
        map: `--------
|......|
|......|
|......|
----...|
xxx|...|
xxx|...|
xxx-----`,
    },
    'L-shaped, rot 3': {
        filler: [1, 1],
        map: `--------
|......|
|......|
|......|
|...----
|...|xxx
|...|xxx
-----xxx`,
    },
    'Blocked center': {
        filler: [1, 1],
        map: `-----------
|.........|
|.........|
|.........|
|...LLL...|
|...LLL...|
|...LLL...|
|.........|
|.........|
|.........|
-----------`,
    },
    'Circular, small': {
        filler: [3, 3],
        map: `xx---xx
x--.--x
--...--
|.....|
--...--
x--.--x
xx---xx`,
    },
    'Circular, medium': {
        filler: [4, 4],
        map: `xx-----xx
x--...--x
--.....--
|.......|
|.......|
|.......|
--.....--
x--...--x
xx-----xx`,
    },
    'Circular, big': {
        filler: [5, 5],
        map: `xxx-----xxx
x---...---x
x-.......-x
--.......--
|.........|
|.........|
|.........|
--.......--
x-.......-x
x---...---x
xxx-----xxx`,
    },
    'T-shaped': {
        filler: [5, 5],
        map: `xxx-----xxx
xxx|...|xxx
xxx|...|xxx
----...----
|.........|
|.........|
|.........|
-----------`,
    },
    'T-shaped, rot 1': {
        filler: [2, 2],
        map: `-----xxx
|...|xxx
|...|xxx
|...----
|......|
|......|
|......|
|...----
|...|xxx
|...|xxx
-----xxx`,
    },
    'T-shaped, rot 2': {
        filler: [2, 2],
        map: `-----------
|.........|
|.........|
|.........|
----...----
xxx|...|xxx
xxx|...|xxx
xxx-----xxx`,
    },
    'T-shaped, rot 3': {
        filler: [5, 5],
        map: `xxx-----
xxx|...|
xxx|...|
----...|
|......|
|......|
|......|
----...|
xxx|...|
xxx|...|
xxx-----`,
    },
    'S-shaped': {
        filler: [2, 2],
        map: `-----xxx
|...|xxx
|...|xxx
|...----
|......|
|......|
|......|
----...|
xxx|...|
xxx|...|
xxx-----`,
    },
    'S-shaped, rot 1': {
        filler: [5, 5],
        map: `xxx--------
xxx|......|
xxx|......|
----......|
|......----
|......|xxx
|......|xxx
--------xxx`,
    },
    'Z-shaped': {
        filler: [5, 5],
        map: `xxx-----
xxx|...|
xxx|...|
----...|
|......|
|......|
|......|
|...----
|...|xxx
|...|xxx
-----xxx`,
    },
    'Z-shaped, rot 1': {
        filler: [2, 2],
        map: `--------xxx
|......|xxx
|......|xxx
|......----
----......|
xxx|......|
xxx|......|
xxx--------`,
    },
    'Cross': {
        filler: [6, 6],
        map: `xxx-----xxx
xxx|...|xxx
xxx|...|xxx
----...----
|.........|
|.........|
|.........|
----...----
xxx|...|xxx
xxx|...|xxx
xxx-----xxx`,
    },
    'Four-leaf clover': {
        filler: [6, 6],
        map: `-----x-----
|...|x|...|
|...---...|
|.........|
---.....---
xx|.....|xx
---.....---
|.........|
|...---...|
|...|x|...|
-----x-----`,
    },
    'Water-surrounded vault': {
        filler: null,
        map: `}}}}}}
}----}
}|..|}
}|..|}
}----}
}}}}}}`,
    },
};

// Themerooms whose contents() body is implemented in sp_lev.js even though they
// declare no filler_region().
const THEMEROOM_CONTENTS_NAMES = new Set(['Water-surrounded vault']);

function is_themeroom_eligible(room, difficulty) {
    if (room.mindiff != null && difficulty < room.mindiff) return false;
    if (room.maxdiff != null && difficulty > room.maxdiff) return false;
    return true;
}

// C ref: themerms.lua themerooms_generate()
// Reservoir sampling picks one themed room. For seed8000 level 1,
// 'ordinary' always wins (frequency 1000 vs others ~1-10).
async function themerooms_generate(difficulty) {
    let pick = null;
    let total_frequency = 0;
    for (const meta of THEMEROOM_META) {
        if (!is_themeroom_eligible(meta, difficulty)) continue;
        const this_frequency = meta.frequency || 1;
        total_frequency += this_frequency;
        if (this_frequency > 0 && rn2(total_frequency) < this_frequency) {
            pick = meta;
        }
    }
    if (!pick) return false;
    const mapSpec = THEMEROOM_MAPS[pick.name];
    if (mapSpec) {
        // A themeroom with no filler_region() can still have a contents body of
        // its own (the Water-surrounded vault builds a vault, four chests and an
        // undead), so hand the callback over whenever we have an implementation
        // for the name — not only when there is a filler.
        const hasContents = !!mapSpec.filler || THEMEROOM_CONTENTS_NAMES.has(pick.name);
        const placed = lspo_map({
            map: mapSpec.map,
            contents: hasContents
                ? () => themeroom_map_contents(pick.name,
                                               mapSpec.filler ? mapSpec.filler[0] : -1,
                                               mapSpec.filler ? mapSpec.filler[1] : -1)
                : null,
        });
        return !!placed && !game.themeroom_failed;
    }
    // C ref: themerms.lua:400-419 'Pillars' — des.room({type="themed", w=10,
    // h=10, contents=...}).  Fixed 10x10 size (no size roll), random position
    // + alignment, random lit (all handled by the generic w/h path below).
    if (pick.name === 'Pillars') return themeroom_build_pillars();
    // C ref: themerms.lua "Fake Delphi" / "Room in a room" / "Huge room with
    // another room inside" / "Nesting rooms" — plain OROOM(s) nested via
    // des.room()'s recursive contents callback (build_room/create_subroom).
    if (NESTED_ROOM_BUILDERS[pick.name]) {
        const aroom = await NESTED_ROOM_BUILDERS[pick.name]();
        return !!aroom;
    }
    // C ref: themerms.lua — the three "themed fill" themerooms call
    //   des.room({ type = "themed", [lit=0|filled=1,] contents = themeroom_fill })
    // i.e. a THEMEROOM whose contents() runs the themeroom_fill reservoir
    // (themerms.lua:1039).  des.room inside in_mk_themerooms defaults needfill
    // to 0 (FILL_NONE) unless filled=1 is passed (sp_lev.c:4076-4077).  All
    // other non-map picks fall through to the plain "default" room
    // (des.room({type="ordinary", filled=1}) -> OROOM, FILL_NORMAL, no fill).
    const roomSpecs = {
        'Default room with themed fill': {
            rtype: THEMEROOM, rlit: -1, needfill: FILL_NONE, contents: themeroom_fill,
        },
        'Unlit room with themed fill': {
            rtype: THEMEROOM, rlit: 0, needfill: FILL_NONE, contents: themeroom_fill,
        },
        'Room with both normal contents and themed fill': {
            rtype: THEMEROOM, rlit: -1, needfill: FILL_NORMAL, contents: themeroom_fill,
        },
    };
    const spec = roomSpecs[pick.name]
        || { rtype: OROOM, rlit: -1, needfill: FILL_NORMAL, contents: null };
    rn2(100); // build_room chance check
    const ok = create_room(-1, -1, -1, -1, -1, -1, spec.rtype, spec.rlit);
    if (ok) {
        // C ref: sp_lev.c:2824 — build_room calls topologize after create_room
        const aroom = game.level.rooms[game.level.nroom - 1];
        if (aroom) {
            topologize(aroom);
            aroom.needfill = spec.needfill;
            if (spec.contents) spec.contents(aroom);
        }
    }
    return ok;
}

// ------------------------------------------------------------------
// Nested-room themerooms: "Fake Delphi", "Room in a room", "Huge room
// with another room inside", "Nesting rooms" (themerms.lua).  These all
// call des.room() recursively from within a room's own contents callback
// (build_room()/lspo_room() in sp_lev.c): the nested room is a subroom of
// the currently-active room (create_subroom), and des.door() places a
// door directly on a wall of whichever room is currently active
// (gc.coder->croom).  game._splevRoomStack tracks that "currently active
// room" (mirrors the coder's tmproomlist/croom stack) for the duration of
// these themeroom builds only.
// ------------------------------------------------------------------

function splev_current_room() {
    const stack = game._splevRoomStack;
    return stack && stack.length ? stack[stack.length - 1] : null;
}

// C ref: dat/nhlib.lua math.random(lo,hi) override -> nh.random(lo,hi+1-lo)
// = lo + rn2(hi+1-lo).  Raw Lua math.random (an independent xoshiro256**
// generator per nhlua.c) is shadowed by this nhlib.lua wrapper for the
// entire game Lua state, so — unlike the upstream comment's disclaimer —
// themerms.lua's math.random() calls DO consume the ISAAC64 stream.
function lua_math_random(lo, hi) {
    return lo + rn2(hi + 1 - lo);
}

// C ref: sp_lev.c build_room() + lspo_room() — create a room (top-level via
// create_room, nested inside the currently-active room via create_subroom
// when one exists), then run its `contents` callback with the new room
// pushed as the active room for any nested des_room()/des_door() calls.
async function des_room(spec, contentsFn) {
    const chance = spec.chance != null ? spec.chance : 100;
    const rtype0 = spec.rtype != null ? spec.rtype : OROOM;
    // C: xint16 rtype = (!r->chance || rn2(100) < r->chance) ? r->rtype : OROOM;
    const rtype = (!chance || rn2(100) < chance) ? rtype0 : OROOM;
    const parent = splev_current_room();
    let aroom;
    if (parent) {
        const ok = create_subroom(parent,
            spec.x != null ? spec.x : -1, spec.y != null ? spec.y : -1,
            spec.w != null ? spec.w : -1, spec.h != null ? spec.h : -1,
            rtype, spec.rlit != null ? spec.rlit : -1);
        if (!ok) { game.themeroom_failed = true; return null; }
        parent.irregular = true; // C: added a subroom -> parent room goes irregular
        aroom = parent.sbrooms[parent.nsubrooms - 1];
    } else {
        const ok = create_room(
            spec.x != null ? spec.x : -1, spec.y != null ? spec.y : -1,
            spec.w != null ? spec.w : -1, spec.h != null ? spec.h : -1,
            spec.xalign != null ? spec.xalign : -1, spec.yalign != null ? spec.yalign : -1,
            rtype, spec.rlit != null ? spec.rlit : -1);
        if (!ok) { game.themeroom_failed = true; return null; }
        aroom = game.level.rooms[game.level.nroom - 1];
    }
    topologize(aroom);
    aroom.needfill = spec.needfill != null ? spec.needfill : FILL_NONE;
    aroom.needjoining = spec.joined != null ? spec.joined : true;
    if (!game._splevRoomStack) game._splevRoomStack = [];
    game._splevRoomStack.push(aroom);
    if (contentsFn) await contentsFn(aroom);
    game._splevRoomStack.pop();
    splev_add_doors_to_room(aroom);
    return aroom;
}

// C ref: sp_lev.c shared_with_room() — is x,y right next to room droom?
function splev_shared_with_room(x, y, droom) {
    if (!isok(x, y)) return false;
    const rmno = (droom.roomnoidx ?? -1) + ROOMOFFSET;
    const loc = game.level.at(x, y);
    if (loc.roomno === rmno && !loc.edge) return false;
    if (isok(x - 1, y) && game.level.at(x - 1, y).roomno === rmno && x - 1 <= droom.hx) return true;
    if (isok(x + 1, y) && game.level.at(x + 1, y).roomno === rmno && x + 1 >= droom.lx) return true;
    if (isok(x, y - 1) && game.level.at(x, y - 1).roomno === rmno && y - 1 <= droom.hy) return true;
    if (isok(x, y + 1) && game.level.at(x, y + 1).roomno === rmno && y + 1 >= droom.ly) return true;
    return false;
}

// C ref: sp_lev.c maybe_add_door() — register x,y as a door of droom if it
// actually borders/belongs to it.  No RNG.
function splev_maybe_add_door(x, y, droom) {
    if (droom.hx == null || droom.hx < 0) return;
    const rmno = (droom.roomnoidx ?? -1) + ROOMOFFSET;
    const loc = game.level.at(x, y);
    if ((!droom.irregular && inside_room(droom, x, y))
        || loc.roomno === rmno
        || splev_shared_with_room(x, y, droom)) {
        add_door(x, y, droom);
    }
}

// C ref: sp_lev.c add_doors_to_room() — after a themeroom finishes building,
// pull any door on its border (or a subroom's border) into its door list so
// makecorridors()/finddpos() can find it later.  No RNG.
function splev_add_doors_to_room(croom) {
    for (let x = croom.lx - 1; x <= croom.hx + 1; x++)
        for (let y = croom.ly - 1; y <= croom.hy + 1; y++) {
            const loc = game.level.at(x, y);
            if (loc && (IS_DOOR(loc.typ) || loc.typ === SDOOR))
                splev_maybe_add_door(x, y, croom);
        }
    for (const sub of croom.sbrooms || []) splev_add_doors_to_room(sub);
}

// C ref: sp_lev.c lspo_door() x==-1&&y==-1 path (themerooms' only form) —
// now a thin wrapper on the shared sp_lev.js implementation.
function des_door(spec) {
    lspo_door_relative(spec, splev_current_room());
}

// C ref: themerms.lua "Fake Delphi".
async function themeroom_fake_delphi() {
    return des_room({ rtype: OROOM, w: 11, h: 9, needfill: FILL_NORMAL }, async () => {
        await des_room({ rtype: OROOM, x: 4, y: 3, w: 3, h: 3, needfill: FILL_NORMAL }, async () => {
            des_door({ state: 'random', wall: 'all' });
        });
    });
}

// C ref: themerms.lua "Room in a room".
async function themeroom_room_in_a_room() {
    return des_room({ rtype: OROOM, needfill: FILL_NORMAL }, async () => {
        await des_room({ rtype: OROOM }, async () => {
            des_door({ state: 'random', wall: 'all' });
        });
    });
}

// C ref: themerms.lua "Huge room with another room inside".
async function themeroom_huge_room_with_inner() {
    const w = rn2(10) + 11, h = rn2(5) + 8;
    return des_room({ rtype: OROOM, w, h, needfill: FILL_NORMAL }, async () => {
        if (mk_percent(90)) {
            await des_room({ rtype: OROOM, needfill: FILL_NORMAL }, async () => {
                des_door({ state: 'random', wall: 'all' });
                if (mk_percent(50)) des_door({ state: 'random', wall: 'all' });
            });
        }
    });
}

// C ref: themerms.lua "Nesting rooms".
async function themeroom_nesting_rooms() {
    const w = 9 + rn2(4), h = 9 + rn2(4);
    return des_room({ rtype: OROOM, w, h, needfill: FILL_NORMAL }, async (rm) => {
        const width = rm.hx - rm.lx + 1, height = rm.hy - rm.ly + 1;
        const wid = lua_math_random(Math.floor(width / 2), width - 2);
        const hei = lua_math_random(Math.floor(height / 2), height - 2);
        await des_room({ rtype: OROOM, w: wid, h: hei, needfill: FILL_NORMAL }, async () => {
            if (mk_percent(90)) {
                await des_room({ rtype: OROOM, needfill: FILL_NORMAL }, async () => {
                    des_door({ state: 'random', wall: 'all' });
                    if (mk_percent(15)) des_door({ state: 'random', wall: 'all' });
                });
            }
            des_door({ state: 'random', wall: 'all' });
            if (mk_percent(15)) des_door({ state: 'random', wall: 'all' });
        });
    });
}

// C ref: dat/nhlib.lua:17 shuffle(list) — Fisher-Yates from the tail down,
// drawing `math.random(i)` == 1 + rn2(i) for i = #list .. 2.
function lua_shuffle(list) {
    for (let i = list.length; i >= 2; i--) {
        const j = 1 + rn2(i);
        const t = list[i - 1]; list[i - 1] = list[j - 1]; list[j - 1] = t;
    }
}

// C ref: sp_lev.c create_monster() with an explicit (non-random) coord — same
// induced_align -> mkclass -> makemon order as mk_monster_class(), minus
// get_location's random spot roll.
function mk_monster_class_at(classChar, x, y, waiting) {
    const klass = MK_CLASS_CHAR[classChar] ?? 0;
    oracle_induced_align();
    const data = mk_mines_race_suppress(mkclass(klass, 0x0200 /* G_NOGEN */));
    const c = { x, y };
    mk_enexto_if_occupied(c, data);
    const mtmp = make_monster(data, c.x, c.y, 0);
    if (mtmp) {
        mtmp.female = 0;
        // C ref: sp_lev.c create_monster() `mtmp->mstrategy |= STRAT_WAITMASK`
        // for des.monster({waiting=1}); no RNG, but it keeps the monster put.
        if (waiting) mtmp.mstrategy = (mtmp.mstrategy | 0) | STRAT_WAITMASK_MK;
    }
    return mtmp;
}
// mon.h STRAT_CLOSE|STRAT_WAITFORU.
const STRAT_WAITMASK_MK = 0x10000000 | 0x20000000;

// C ref: themerms.lua:419-441 'Mausoleum' — an odd-sized themed room with a
// sealed 1x1 crypt at its centre holding either a waiting undead or a human
// corpse, and a 20% secret door.  The two nh.rn2(3) size rolls happen BEFORE
// des.room()'s build_room chance roll.
async function themeroom_mausoleum() {
    const w = 5 + rn2(3) * 2;
    const h = 5 + rn2(3) * 2;
    return des_room({ rtype: THEMEROOM, w, h }, async (rm) => {
        const width = rm.hx - rm.lx + 1, height = rm.hy - rm.ly + 1;
        await des_room({
            rtype: THEMEROOM, joined: false,
            x: Math.trunc((width - 1) / 2), y: Math.trunc((height - 1) / 2),
            w: 1, h: 1,
        }, async (sub) => {
            if (mk_percent(50)) {
                const mons = ['M', 'V', 'L', 'Z'];
                lua_shuffle(mons);
                mk_monster_class_at(mons[0], sub.lx, sub.ly, true);
            } else {
                // des.object({id="corpse", montype="@", coord={0,0}}) — the
                // montype class pre-roll (mkclass) precedes mksobj, as in
                // oracle_place_statue().
                const pm = mkclass(MK_CLASS_CHAR['@'], 0);
                const otmp = mksobj_at(CORPSE, sub.lx, sub.ly, true, false);
                if (pm && otmp) set_corpsenm(otmp, pm.pmidx);
            }
            if (mk_percent(20)) des_door({ state: 'secret', wall: 'all' });
        });
    });
}

// C ref: themerms.lua:445-457 'Random dungeon feature in the middle of an
// odd-sized room' — two nh.rn2(3) size rolls BEFORE des.room()'s build_room
// chance roll, then one of five features at the exact centre.  Falling through
// to the generic "default room" path instead left those two rn2(3)s undrawn,
// which shifts every later mklev draw on the level by two calls.
async function themeroom_random_feature() {
    const wid = 3 + rn2(3) * 2;
    const hei = 3 + rn2(3) * 2;
    return des_room({ rtype: OROOM, needfill: FILL_NORMAL, w: wid, h: hei },
        (rm) => {
            // local feature = { "C", "L", "I", "P", "T" } (nhlua.c char2typ[]).
            const feature = [CLOUD, LAVAPOOL, ICE, POOL, TREE];
            lua_shuffle(feature);
            // des.terrain((rm.width-1)/2, (rm.height-1)/2, feature[1]) — both
            // dimensions are odd, so Lua's float divide lands on an integer.
            const width = rm.hx - rm.lx + 1, height = rm.hy - rm.ly + 1;
            set_levltyp_lit(rm.lx + (width - 1) / 2, rm.ly + (height - 1) / 2,
                            feature[0], SET_LIT_NOCHANGE);
        });
}

const NESTED_ROOM_BUILDERS = {
    'Fake Delphi': themeroom_fake_delphi,
    'Room in a room': themeroom_room_in_a_room,
    'Huge room with another room inside': themeroom_huge_room_with_inner,
    'Nesting rooms': themeroom_nesting_rooms,
    'Mausoleum': themeroom_mausoleum,
    'Random dungeon feature': themeroom_random_feature,
};

// C ref: sp_lev.c set_levltyp_lit() with lit=SET_LIT_NOCHANGE (-2) — set the
// terrain type only, leaving the lit state untouched (no RNG either way).
function themeroom_set_terrain(x, y, typ) {
    const loc = game.level.at(x, y);
    if (!loc) return;
    loc.typ = typ;
    if (typ === HWALL) loc.horizontal = true;
    else if (typ === VWALL) loc.horizontal = false;
}

// C ref: themerms.lua:399-419 'Pillars' theme room.
function themeroom_build_pillars() {
    rn2(100); // build_room chance check (sp_lev.c:2811)
    const ok = create_room(-1, -1, 10, 10, -1, -1, THEMEROOM, -1);
    if (!ok) return false;
    const aroom = game.level.rooms[game.level.nroom - 1];
    if (!aroom) return true;
    topologize(aroom);
    aroom.needfill = FILL_NONE;
    // local terr = { "-", "-", "-", "-", "L", "P", "T" }; shuffle(terr);
    const terr = [HWALL, HWALL, HWALL, HWALL, LAVAPOOL, POOL, TREE];
    shuffle(terr);
    const pick = terr[0];
    const width = aroom.hx - aroom.lx + 1;
    const height = aroom.hy - aroom.ly + 1;
    for (let x = 0; x <= Math.trunc(width / 4) - 1; x++) {
        for (let y = 0; y <= Math.trunc(height / 4) - 1; y++) {
            themeroom_set_terrain(aroom.lx + x * 4 + 2, aroom.ly + y * 4 + 2, pick);
            themeroom_set_terrain(aroom.lx + x * 4 + 3, aroom.ly + y * 4 + 2, pick);
            themeroom_set_terrain(aroom.lx + x * 4 + 2, aroom.ly + y * 4 + 3, pick);
            themeroom_set_terrain(aroom.lx + x * 4 + 3, aroom.ly + y * 4 + 3, pick);
        }
    }
    return true;
}

// C ref: sp_lev.c check_room()
function check_room(lowx, ddx, lowy, ddy, vault) {
    const map = game.level;
    let hix = lowx.v + ddx.v, hiy = lowy.v + ddy.v;
    const xlim = XLIM + (vault ? 1 : 0);
    const ylim = YLIM + (vault ? 1 : 0);
    const s_lowx = lowx.v, s_ddx = ddx.v;
    const s_lowy = lowy.v, s_ddy = ddy.v;
    if (lowx.v < 3) lowx.v = 3;
    if (lowy.v < 2) lowy.v = 2;
    if (hix > COLNO - 3) hix = COLNO - 3;
    if (hiy > ROWNO - 3) hiy = ROWNO - 3;
    for (;;) {
        if (hix <= lowx.v || hiy <= lowy.v) return false;
        if (game.in_mk_themerooms
            && s_lowx !== lowx.v && s_ddx !== ddx.v
            && s_lowy !== lowy.v && s_ddy !== ddy.v) {
            return false;
        }
        let retry = false;
        for (let x = lowx.v - xlim; x <= hix + xlim && !retry; x++) {
            if (x <= 0 || x >= COLNO) continue;
            let y = Math.max(lowy.v - ylim, 0);
            const ymax = Math.min(hiy + ylim, ROWNO - 1);
            for (; y <= ymax; y++) {
                const loc = map.at(x, y);
                if (loc && loc.typ !== STONE) {
                    if (!rn2(3)) return false;
                    if (game.in_mk_themerooms) return false;
                    if (x < lowx.v) lowx.v = x + xlim + 1;
                    else hix = x - xlim - 1;
                    if (y < lowy.v) lowy.v = y + ylim + 1;
                    else hiy = y - ylim - 1;
                    retry = true;
                    break;
                }
            }
        }
        if (!retry) break;
    }
    ddx.v = hix - lowx.v;
    ddy.v = hiy - lowy.v;
    if (game.in_mk_themerooms
        && s_lowx !== lowx.v && s_ddx !== ddx.v
        && s_lowy !== lowy.v && s_ddy !== ddy.v) {
        return false;
    }
    return true;
}

// C ref: sp_lev.c create_room()
function create_room(x, y, w, h, xal, yal, rtype, rlit) {
    const g = game;
    let xabs = 0, yabs = 0;
    let r1 = null, r2 = null;
    let wtmp, htmp;
    let trycnt = 0;
    let vault = false;
    let xlim = XLIM, ylim = YLIM;
    if (rtype === -1) rtype = OROOM;
    if (rtype === VAULT) {
        vault = true;
        xlim++;
        ylim++;
    }
    rlit = litstate_rnd(rlit);
    do {
        wtmp = w; htmp = h;
        let xtmp = x, ytmp = y;
        let xaltmp = xal, yaltmp = yal;
        if ((xtmp < 0 && ytmp < 0 && wtmp < 0 && xaltmp < 0 && yaltmp < 0) || vault) {
            r1 = rnd_rect();
            if (!r1) return false;
            const hx = r1.hx, hy = r1.hy, lx = r1.lx, ly = r1.ly;
            let dx, dy;
            if (vault) {
                dx = dy = 1;
            } else {
                dx = 2 + rn2((hx - lx > 28) ? 12 : 8);
                dy = 2 + rn2(4);
                if (dx * dy > 50) dy = Math.trunc(50 / dx);
            }
            const xborder = (lx > 0 && hx < COLNO - 1) ? 2 * xlim : xlim + 1;
            const yborder = (ly > 0 && hy < ROWNO - 1) ? 2 * ylim : ylim + 1;
            if (hx - lx < dx + 3 + xborder || hy - ly < dy + 3 + yborder) {
                r1 = null;
                continue;
            }
            xabs = lx + (lx > 0 ? xlim : 3)
                   + rn2(hx - (lx > 0 ? lx : 3) - dx - xborder + 1);
            yabs = ly + (ly > 0 ? ylim : 2)
                   + rn2(hy - (ly > 0 ? ly : 2) - dy - yborder + 1);
            if (ly === 0 && hy >= ROWNO - 1
                && (!g.level.nroom || !rn2(g.level.nroom))
                && (yabs + dy > Math.trunc(ROWNO / 2))) {
                yabs = rn1(3, 2);
                if (g.level.nroom < 4 && dy > 1) dy--;
            }
            const lowx = { v: xabs }, ddx = { v: dx };
            const lowy = { v: yabs }, ddy = { v: dy };
            if (!check_room(lowx, ddx, lowy, ddy, vault)) {
                r1 = null;
                continue;
            }
            xabs = lowx.v;
            yabs = lowy.v;
            wtmp = ddx.v + 1;
            htmp = ddy.v + 1;
            r2 = { lx: xabs - 1, ly: yabs - 1, hx: xabs + wtmp, hy: yabs + htmp };
        } else {
            // C ref: sp_lev.c:1580-1645 — "Only some parameters are random".
            // Used by special levels (e.g. Oracle) with explicit/aligned coords.
            let rndpos = 0;
            if (xtmp < 0 && ytmp < 0) { // Position is RANDOM
                xtmp = rnd(5);
                ytmp = rnd(5);
                rndpos = 1;
            }
            if (wtmp < 0 || htmp < 0) { // Size is RANDOM
                wtmp = rn1(15, 3);
                htmp = rn1(8, 2);
            }
            if (xaltmp === -1) xaltmp = rnd(3); // Horizontal alignment RANDOM
            if (yaltmp === -1) yaltmp = rnd(3); // Vertical alignment RANDOM

            xabs = Math.trunc(((xtmp - 1) * COLNO) / 5) + 1;
            yabs = Math.trunc(((ytmp - 1) * ROWNO) / 5) + 1;
            // SPLEV_LEFT=1, SPLEV_CENTER=3, SPLEV_RIGHT=5; TOP=1, BOTTOM=5.
            switch (xaltmp) {
            case 1: break;                                   // SPLEV_LEFT
            case 5: xabs += Math.trunc(COLNO / 5) - wtmp; break; // SPLEV_RIGHT
            case 3: xabs += Math.trunc((Math.trunc(COLNO / 5) - wtmp) / 2); break; // CENTER
            }
            switch (yaltmp) {
            case 1: break;                                   // TOP
            case 5: yabs += Math.trunc(ROWNO / 5) - htmp; break; // BOTTOM
            case 3: yabs += Math.trunc((Math.trunc(ROWNO / 5) - htmp) / 2); break; // CENTER
            }
            if (xabs + wtmp - 1 > COLNO - 2) xabs = COLNO - wtmp - 3;
            if (xabs < 2) xabs = 2;
            if (yabs + htmp - 1 > ROWNO - 2) yabs = ROWNO - htmp - 3;
            if (yabs < 2) yabs = 2;
            // C ref: sp_lev.c:1634-1644. r2 is the scratch rect passed to
            // get_rect AND later to split_rects (with its PRE-check_room coords);
            // check_room may shift xabs/yabs but does NOT touch r2. add_room uses
            // wtmp/htmp (the original sizes), not dx/dy.
            r2 = { lx: xabs - 1, ly: yabs - 1, hx: xabs + wtmp + rndpos, hy: yabs + htmp + rndpos };
            r1 = get_rect(r2);
            const dx = wtmp, dy = htmp;
            if (r1) {
                const lowx = { v: xabs }, ddx = { v: dx };
                const lowy = { v: yabs }, ddy = { v: dy };
                if (!check_room(lowx, ddx, lowy, ddy, vault)) {
                    r1 = null;
                } else {
                    xabs = lowx.v; yabs = lowy.v;
                }
            }
        }
    } while (++trycnt <= 100 && !r1);
    if (!r1) return false;
    split_rects(r1, r2);
    if (!vault) {
        g.smeq[g.level.nroom] = g.level.nroom;
        add_room(xabs, yabs, xabs + wtmp - 1, yabs + htmp - 1, rlit, rtype, false);
    } else {
        if (!g.level.rooms[g.level.nroom]) g.level.rooms[g.level.nroom] = {};
        g.level.rooms[g.level.nroom].lx = xabs;
        g.level.rooms[g.level.nroom].ly = yabs;
    }
    return true;
}

function create_vault() {
    return create_room(-1, -1, 2, 2, -1, -1, VAULT, true);
}

// ============================================================
// Special rooms (C ref: mkroom.c do_mkroom/mkshop/mkzoo/mktemple/mkswamp)
//
// These set a room's rtype + needfill so the later fill_special_room() loop
// stocks them.  Only their *RNG side effects* and rtype assignment are
// load-bearing for parity; the actual stocking (stock_room / fill_zoo) is
// owned by sp_lev.js and runs from the fill loop, not here.
// ============================================================

// C ref: mon.h G_GONE == (G_GENOD | G_EXTINCT), tested as
// `svm.mvitals[mndx].mvflags & G_GONE`.  Consumes no RNG, but it is a LIVE
// predicate: G_GENOD comes from #genocide and G_EXTINCT from makemon.js's
// propagate() when born reaches mbirth_limit().  It used to return a constant
// FALSE, which takes the wrong makelevel() branch for any session that
// genocides or exhausts a gated species.
const G_GONE_MV = 0x03;
function mvitals_gone(mndx) {
    return ((game.mvitals?.[mndx]?.mvflags ?? 0) & G_GONE_MV) !== 0;
}

// C ref: mkroom.c antholemon() — picks one of SOLDIER_ANT/FIRE_ANT/GIANT_ANT
// from ((ubirthday % 3) + level_difficulty() + trycnt) % 3, retrying up to 3
// times past an extinct species, and returns NULL only if all three are gone.
// No RNG.  makelevel() uses it purely as a truthiness gate on the ANTHOLE arm,
// which this constant answers correctly (see mvitals_gone above).  The chosen
// SPECIES is a different consumer — mkroom.c fill_zoo()'s ANTHOLE arm — and
// that arm is not ported (sp_lev.js fill_special_room leaves ANTHOLE a no-op),
// so nothing reads a return value yet.  Porting fill_zoo(ANTHOLE) means
// returning a real permonst here, which needs ubirthday threaded through.
function antholemon() {
    return true;
}

// C ref: mkroom.c do_mkroom()
async function do_mkroom(roomtype) {
    if (roomtype >= SHOPBASE) {
        mkshop();
    } else {
        switch (roomtype) {
        case COURT: mkzoo(COURT); break;
        case ZOO: mkzoo(ZOO); break;
        case BEEHIVE: mkzoo(BEEHIVE); break;
        case MORGUE: mkzoo(MORGUE); break;
        case BARRACKS: mkzoo(BARRACKS); break;
        case SWAMP: await mkswamp(); break;
        case TEMPLE: mktemple(); break;
        case LEPREHALL: mkzoo(LEPREHALL); break;
        case COCKNEST: mkzoo(COCKNEST); break;
        case ANTHOLE: mkzoo(ANTHOLE); break;
        default: break;
        }
    }
}

// C ref: mkroom.c invalid_shop_shape() — irregular or sub-divided shops are
// rejected.  Regular rectangular rooms (the only kind we generate) are valid.
function invalid_shop_shape(sroom) {
    return !!sroom.irregular || (sroom.nsubrooms ?? 0) > 0;
}

// C ref: mkroom.c isbig() — room area > 20.
function isbig(sroom) {
    const area = (sroom.hx - sroom.lx + 1) * (sroom.hy - sroom.ly + 1);
    return area > 20;
}

// C ref: mkroom.c mkshop().  Contest build never sets the SHOPTYPE env, so the
// wizard-getenv branch is skipped; we only model the room search + the random
// shop-type roll (rnd(100)).  Stocking happens later in fill_special_room().
function mkshop() {
    const g = game;
    if (process.env.SHOPDBG) console.error(`[mkshop] dlvl=${JSON.stringify(g.u?.uz)} nroom=${g.level.nroom} rooms=` + JSON.stringify((g.level.rooms||[]).slice(0,12).map(r=>r&&({lx:r.lx,hx:r.hx,ly:r.ly,hy:r.hy,rtype:r.rtype,doorct:r.doorct,irr:r.irregular,sub:r.nsubrooms}))));
    let i = -1; // shoptype not yet determined
    // Find an eligible room: OROOM, no stairs, exactly one door.
    let sroom = null;
    for (let r = 0; ; r++) {
        const cur = g.level.rooms[r];
        if (!cur || cur.hx < 0) { if (process.env.SHOPDBG) console.error(`[mkshop] no room (r=${r})`); return; }
        if (r >= g.level.nroom) { if (process.env.SHOPDBG) console.error('[mkshop] nroom end'); return; }
        if (cur.rtype !== OROOM) continue;
        if (process.env.SHOPDBG) console.error(`[mkshop] r=${r} dn=${has_dnstairs(cur)} up=${has_upstairs(cur)} doorct=${cur.doorct}`);
        if (has_dnstairs(cur) || has_upstairs(cur)) continue;
        if (cur.doorct === 1) {
            if (invalid_shop_shape(cur)) continue;
            sroom = cur;
            break;
        }
    }
    if (!sroom.rlit) {
        for (let x = sroom.lx - 1; x <= sroom.hx + 1; x++)
            for (let y = sroom.ly - 1; y <= sroom.hy + 1; y++) {
                const loc = g.level.at(x, y);
                if (loc) loc.lit = true;
            }
        sroom.rlit = 1;
    }
    if (process.env.SHOPDBG) console.error(`[mkshop] chose lx=${sroom.lx} ly=${sroom.ly} rlit=${sroom.rlit}`);
    if (i < 0) {
        // C ref: mkroom.c mkshop() — weighted random shop-type pick over
        // shtypes[].prob, then force wand/book shops in big rooms to a
        // general store instead (no RNG for the override itself).
        let j = rnd(100);
        i = 0;
        while ((j -= shtypes[i].prob) > 0) i++;
        if (isbig(sroom) && (shtypes[i].symb === WAND_CLASS || shtypes[i].symb === SPBOOK_CLASS))
            i = 0;
    }
    sroom.rtype = SHOPBASE + i;
    topologize(sroom);
    sroom.needfill = FILL_NORMAL;
}

// C ref: mkroom.c pick_room() — pick an unused room, preferably single-door.
function pick_room(strict) {
    const g = game;
    const n = g.level.nroom;
    if (n <= 0) return null;
    let idx = rn2(n);
    for (let i = n; i-- > 0; idx++) {
        if (idx === n) idx = 0;
        const sroom = g.level.rooms[idx];
        if (!sroom || sroom.hx < 0) return null;
        if (sroom.rtype !== OROOM) continue;
        if (!strict) {
            if (has_upstairs(sroom) || (has_dnstairs(sroom) && rn2(3))) continue;
        } else if (has_upstairs(sroom) || has_dnstairs(sroom)) {
            continue;
        }
        if (sroom.doorct === 1 || !rn2(5) || g.flags?.debug) return sroom;
    }
    return null;
}

// C ref: mkroom.c mkzoo() — pick a room and mark it; fill happens later.
function mkzoo(type) {
    const sroom = pick_room(false);
    if (sroom) {
        sroom.rtype = type;
        sroom.needfill = FILL_NORMAL;
    }
}

// C ref: mkroom.c shrine_pos() — center of a temple room (with rn2(2) tie-break
// when a dimension is even).
function shrine_pos(roomno) {
    const g = game;
    const troom = g.level.rooms[roomno - ROOMOFFSET];
    let bx, by;
    let delta = troom.hx - troom.lx;
    bx = troom.lx + Math.trunc(delta / 2);
    if ((delta % 2) && rn2(2)) bx++;
    delta = troom.hy - troom.ly;
    by = troom.ly + Math.trunc(delta / 2);
    if ((delta % 2) && rn2(2)) by++;
    return { x: bx, y: by };
}

// C ref: mkroom.c mktemple().  The shrine altar is placed at the room center
// and its alignment comes from induced_align(80), which DOES draw (rn2(100)
// per align source, then rn2(3)) — the port used to hardcode A_LAWFUL and skip
// the draws entirely.  AM_SHRINE is OR'd in afterwards so the square renders as
// a temple altar rather than a plain one.  C does NOT set needfill here, so
// fill_special_room() returns at its `needfill == FILL_NONE` gate; the port set
// FILL_NORMAL, pushing the room through the fill switch C never runs.
// priestini() (the temple priest) is still unported — see the deferred list.
function mktemple() {
    const g = game;
    const sroom = pick_room(true);
    if (!sroom) return;
    sroom.rtype = TEMPLE;
    const idx = g.level.rooms.indexOf(sroom);
    const spot = shrine_pos(idx + ROOMOFFSET);
    const loc = g.level.at(spot.x, spot.y);
    if (loc) {
        loc.typ = ALTAR;
        loc.flags = loc.altarmask = induced_align(80);
    }
    // C ref: mklev.c mktemple() — `priestini(&u.uz, sroom, sx, sy, FALSE);`
    // runs BEFORE the AM_SHRINE bit is or'd in, and it makes the temple priest
    // (a makemon + its inventory), which is a whole block of missing draws.
    priestini(g.u?.uz, sroom, spot.x, spot.y, false);
    if (loc) loc.flags = loc.altarmask = (loc.altarmask | AM_SHRINE);
    if (g.level.flags) g.level.flags.has_temple = true;
}

// S_* monster-class index for mold/fungus (mkclass's `klass` argument).
// C ref: include/monsym.h MONSYM(32, 'F', FUNGUS, S_FUNGUS, ...).
const S_FUNGUS = 32;
const PM_GIANT_EEL = name_to_pmidx('giant eel');
const PM_GIANT_SPIDER = name_to_pmidx('giant spider');
const PM_PIRANHA = name_to_pmidx('piranha');
const PM_ELECTRIC_EEL = name_to_pmidx('electric eel');

// C ref: mkroom.c mkswamp() — turn up to 5 eligible OROOMs into swamps: a
// checkerboard of POOL cells (each maybe stocked with an eel) alternating
// with dry cells (maybe stocked with a mold), skipping any cell that already
// holds an object, monster, trap, or sits next to a door.
async function mkswamp() {
    const g = game;
    let eelct = 0;
    for (let i = 0; i < 5; i++) {
        const sroom = g.level.rooms[rn2(g.level.nroom)];
        if (!sroom || sroom.hx < 0 || sroom.rtype !== OROOM
            || has_upstairs(sroom) || has_dnstairs(sroom))
            continue;

        const rmno = g.level.rooms.indexOf(sroom) + ROOMOFFSET;
        sroom.rtype = SWAMP;
        for (let sx = sroom.lx; sx <= sroom.hx; sx++) {
            for (let sy = sroom.ly; sy <= sroom.hy; sy++) {
                const loc = g.level.at(sx, sy);
                if (!loc || !IS_ROOM(loc.typ) || loc.roomno !== rmno) continue;
                if (OBJ_AT(sx, sy) || m_at(sx, sy) || t_at(sx, sy) || nexttodoor(sx, sy))
                    continue;
                if ((sx + sy) % 2) {
                    if (g.level.engravings) {
                        g.level.engravings = g.level.engravings.filter(
                            (ep) => ep.engr_x !== sx || ep.engr_y !== sy);
                    }
                    loc.typ = POOL;
                    if (!eelct || !rn2(4)) {
                        const pm = rn2(5) ? PM_GIANT_EEL
                            : rn2(2) ? PM_PIRANHA : PM_ELECTRIC_EEL;
                        const mtmp = await makemon(monster_by_pmidx(pm), sx, sy, 0);
                        // C ref: makemon.c:1322 `case S_EEL: if (gi.in_mklev)
                        // hideunder(mtmp);` -> mon.c hideunder() S_EEL arm:
                        // undetected = is_pool(x,y) && !Is_waterlevel && (!Underwater
                        // || !couldsee).  All three hold here (the cell was set POOL
                        // one line up, mklev is never the water level, and the hero
                        // isn't underwater during generation), so the eel always
                        // hides.  No RNG.  makemon.js has no S_EEL arm; doing it
                        // here keeps every other in_mklev eel path untouched.
                        if (mtmp) mtmp.mundetected = 1;
                        eelct++;
                    }
                } else if (!rn2(4)) {
                    await makemon(mkclass(S_FUNGUS, 0), sx, sy, 0);
                }
            }
        }
        if (g.level.flags) g.level.flags.has_swamp = true;
    }
}

// C ref: mklev.c add_room()
function add_room(lowx, lowy, hix, hiy, lit, rtype, special) {
    const g = game;
    const croom = {
        lx: lowx, ly: lowy, hx: hix, hy: hiy,
        rtype, rlit: lit ? 1 : 0,
        doorct: 0, fdoor: g.level.doorindex,
        irregular: false, needjoining: !special,
        nsubrooms: 0, sbrooms: [],
        roomnoidx: g.level.nroom,
        needfill: 0,
    };
    do_room_or_subroom(croom, lowx, lowy, hix, hiy, lit, rtype, special, true);
    g.level.rooms[g.level.nroom] = croom;
    g.level.nroom++;
    if (g.level.nroom < MAXNROFROOMS) {
        g.level.rooms[g.level.nroom] = { hx: -1 };
    }
}

// C ref: mklev.c do_room_or_subroom()
function do_room_or_subroom(croom, lowx, lowy, hix, hiy, lit, _rtype, special, is_room) {
    const map = game.level;
    if (!lowx) lowx++;
    if (!lowy) lowy++;
    if (hix >= COLNO - 1) hix = COLNO - 2;
    if (hiy >= ROWNO - 1) hiy = ROWNO - 2;
    if (lit) {
        for (let x = lowx - 1; x <= hix + 1; x++)
            for (let y = Math.max(lowy - 1, 0); y <= hiy + 1; y++)
                if (map.at(x, y)) map.at(x, y).lit = true;
        croom.rlit = 1;
    } else {
        croom.rlit = 0;
    }
    croom.lx = lowx; croom.hx = hix;
    croom.ly = lowy; croom.hy = hiy;
    croom.rtype = _rtype;
    croom.doorct = 0;
    croom.fdoor = game.level.doorindex;
    croom.irregular = false;
    croom.nsubrooms = 0;
    croom.sbrooms = [];
    if (!special) {
        croom.needjoining = true;
        for (let x = lowx - 1; x <= hix + 1; x++)
            for (let y = lowy - 1; y <= hiy + 1; y += (hiy - lowy + 2)) {
                const loc = map.at(x, y);
                if (loc) { loc.typ = HWALL; loc.horizontal = true; }
            }
        for (let x = lowx - 1; x <= hix + 1; x += (hix - lowx + 2))
            for (let y = lowy; y <= hiy; y++) {
                const loc = map.at(x, y);
                if (loc) { loc.typ = VWALL; loc.horizontal = false; }
            }
        for (let x = lowx; x <= hix; x++)
            for (let y = lowy; y <= hiy; y++) {
                const loc = map.at(x, y);
                if (loc) loc.typ = ROOM;
            }
        if (is_room) {
            const tl = map.at(lowx - 1, lowy - 1);
            const tr = map.at(hix + 1, lowy - 1);
            const bl = map.at(lowx - 1, hiy + 1);
            const br = map.at(hix + 1, hiy + 1);
            if (tl) tl.typ = TLCORNER;
            if (tr) tr.typ = TRCORNER;
            if (bl) bl.typ = BLCORNER;
            if (br) br.typ = BRCORNER;
        } else {
            wallification(lowx - 1, lowy - 1, hix + 1, hiy + 1);
        }
    }
}

// C ref: mklev.c sort_rooms()
function sort_rooms() {
    const g = game;
    const n = g.level.nroom;
    const oldToNew = new Array(n).fill(0);
    const liveRooms = g.level.rooms.slice(0, n)
        .sort((a, b) => (a?.lx || 0) - (b?.lx || 0));
    g.level.rooms = liveRooms;
    if (n < MAXNROFROOMS) g.level.rooms[n] = { hx: -1 };
    for (let i = 0; i < n; i++) {
        if (g.level.rooms[i]) {
            oldToNew[g.level.rooms[i].roomnoidx] = i;
            g.level.rooms[i].roomnoidx = i;
        }
    }
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = g.level.at(x, y);
            const rno = loc?.roomno ?? 0;
            if (rno >= ROOMOFFSET && rno < MAXNROFROOMS + 1) {
                loc.roomno = oldToNew[rno - ROOMOFFSET] + ROOMOFFSET;
            }
        }
}

// C ref: mklev.c topologize()
function topologize(croom) {
    if (!croom || croom.irregular) return;
    const roomno = (croom.roomnoidx ?? -1) + ROOMOFFSET;
    const lowx = croom.lx, lowy = croom.ly;
    const hix = croom.hx, hiy = croom.hy;
    if (!game.level || roomno < ROOMOFFSET) return;
    if ((game.level.at(lowx, lowy)?.roomno ?? 0) === roomno) return;
    for (let x = lowx; x <= hix; x++)
        for (let y = lowy; y <= hiy; y++) {
            const loc = game.level.at(x, y);
            if (loc) loc.roomno = roomno;
        }
    for (let x = lowx - 1; x <= hix + 1; x++)
        for (let y = lowy - 1; y <= hiy + 1; y += (hiy - lowy + 2)) {
            const loc = game.level.at(x, y);
            if (loc) { loc.edge = true; loc.roomno = loc.roomno ? SHARED : roomno; }
        }
    for (let x = lowx - 1; x <= hix + 1; x += (hix - lowx + 2))
        for (let y = lowy; y <= hiy; y++) {
            const loc = game.level.at(x, y);
            if (loc) { loc.edge = true; loc.roomno = loc.roomno ? SHARED : roomno; }
        }
}

// ============================================================
// Corridors
// ============================================================

function good_rm_wall_doorpos(x, y, dir, room) {
    const map = game.level;
    const rmno = game.level.rooms.indexOf(room) + ROOMOFFSET;
    if (!isok(x, y) || !room.needjoining) return false;
    const loc = map.at(x, y);
    if (!loc) return false;
    if (!(loc.typ === HWALL || loc.typ === VWALL || IS_DOOR(loc.typ) || loc.typ === SDOOR))
        return false;
    if (bydoor(x, y)) return false;
    const tx = x + xdir[dir], ty = y + ydir[dir];
    if (!isok(tx, ty)) return false;
    const tloc = map.at(tx, ty);
    if (!tloc || IS_OBSTRUCTED(tloc.typ)) return false;
    if (rmno !== tloc.roomno) return false;
    return true;
}

// C ref: mklev.c finddpos_shift()
// starting from x,y going towards dir, find a good location for a door
function finddpos_shift(xp, yp, dir, aroom) {
    const map = game.level;
    const rdir = DIR_180(dir);
    const dx = xdir[rdir];
    const dy = ydir[rdir];

    if (good_rm_wall_doorpos(xp.v, yp.v, rdir, aroom)) return true;

    // irregular rooms may have the room wall away from the room rectangular
    // area; go into the area until we encounter something
    if (aroom.irregular) {
        let rx = xp.v, ry = yp.v;
        let fail = false;
        let rloc = map.at(rx, ry);
        while (!fail && isok(rx, ry)
               && rloc && (rloc.typ === STONE || rloc.typ === CORR)) {
            rx += dx;
            ry += dy;
            if (good_rm_wall_doorpos(rx, ry, rdir, aroom)) {
                xp.v = rx;
                yp.v = ry;
                return true;
            }
            rloc = map.at(rx, ry);
            if (!rloc || !(rloc.typ === STONE || rloc.typ === CORR))
                fail = true;
            if (rx < aroom.lx || rx > aroom.hx
                || ry < aroom.ly || ry > aroom.hy)
                fail = true;
        }
    }
    return false;
}

// C ref: mklev.c finddpos()
function finddpos(cc, dir, aroom) {
    let x1, y1, x2, y2;
    switch (dir) {
    case DIR_N: x1 = aroom.lx; x2 = aroom.hx; y1 = y2 = aroom.ly - 1; break;
    case DIR_S: x1 = aroom.lx; x2 = aroom.hx; y1 = y2 = aroom.hy + 1; break;
    case DIR_W: x1 = x2 = aroom.lx - 1; y1 = aroom.ly; y2 = aroom.hy; break;
    case DIR_E: x1 = x2 = aroom.hx + 1; y1 = aroom.ly; y2 = aroom.hy; break;
    default: return false;
    }
    let tryct = 0;
    let x, y;
    do {
        x = (x2 - x1) ? rn1(x2 - x1 + 1, x1) : x1;
        y = (y2 - y1) ? rn1(y2 - y1 + 1, y1) : y1;
        const xp = { v: x }, yp = { v: y };
        if (finddpos_shift(xp, yp, dir, aroom)) {
            cc.x = xp.v; cc.y = yp.v;
            return true;
        }
    } while (++tryct < 20);
    for (x = x1; x <= x2; x++)
        for (y = y1; y <= y2; y++) {
            const xp = { v: x }, yp = { v: y };
            if (finddpos_shift(xp, yp, dir, aroom)) {
                cc.x = xp.v; cc.y = yp.v;
                return true;
            }
        }
    cc.x = x1; cc.y = y1;
    return false;
}

function maybe_sdoor(chance) {
    const d = depth_of_level(game.u?.uz);
    return (d > 2) && !rn2(Math.max(2, chance));
}

// C ref: sp_lev.c dig_corridor()
function dig_corridor(org, dest, npoints_out, nxcor, ftyp, btyp) {
    const map = game.level;
    let dx = 0, dy = 0;
    let xx = org.x, yy = org.y;
    const tx = dest.x, ty = dest.y;
    let npoints = 0;
    if (npoints_out) npoints_out.v = 0;
    if (xx <= 0 || yy <= 0 || tx <= 0 || ty <= 0
        || xx > COLNO - 1 || tx > COLNO - 1 || yy > ROWNO - 1 || ty > ROWNO - 1)
        return false;
    if (tx > xx) dx = 1;
    else if (ty > yy) dy = 1;
    else if (tx < xx) dx = -1;
    else dy = -1;
    xx -= dx; yy -= dy;
    let cct = 0;
    while (xx !== tx || yy !== ty) {
        if (cct++ > 500 || (nxcor && !rn2(35))) return false;
        xx += dx; yy += dy;
        if (xx >= COLNO - 1 || xx <= 0 || yy <= 0 || yy >= ROWNO - 1) return false;
        const crm = map.at(xx, yy);
        if (!crm) return false;
        if (crm.typ === btyp) {
            if (ftyp === CORR && maybe_sdoor(100)) {
                npoints++;
                if (npoints_out) npoints_out.v = npoints;
                crm.typ = SCORR;
            } else {
                npoints++;
                if (npoints_out) npoints_out.v = npoints;
                crm.typ = ftyp;
                if (nxcor && !rn2(50)) {
                    mksobj_at(BOULDER, xx, yy, true, false);
                }
            }
        } else if (crm.typ !== ftyp && crm.typ !== SCORR) {
            return false;
        }
        let dix = Math.abs(xx - tx);
        let diy = Math.abs(yy - ty);
        if ((dix > diy) && diy && !rn2(dix - diy + 1)) dix = 0;
        else if ((diy > dix) && dix && !rn2(diy - dix + 1)) diy = 0;
        if (dy && dix > diy) {
            const ddx = (xx > tx) ? -1 : 1;
            const ncr = map.at(xx + ddx, yy);
            if (ncr && (ncr.typ === btyp || ncr.typ === ftyp || ncr.typ === SCORR)) {
                dx = ddx; dy = 0; continue;
            }
        } else if (dx && diy > dix) {
            const ddy = (yy > ty) ? -1 : 1;
            const ncr = map.at(xx, yy + ddy);
            if (ncr && (ncr.typ === btyp || ncr.typ === ftyp || ncr.typ === SCORR)) {
                dy = ddy; dx = 0; continue;
            }
        }
        const straight = map.at(xx + dx, yy + dy);
        if (straight && (straight.typ === btyp || straight.typ === ftyp || straight.typ === SCORR))
            continue;
        if (dx) { dx = 0; dy = (ty < yy) ? -1 : 1; }
        else { dy = 0; dx = (tx < xx) ? -1 : 1; }
        const alt = map.at(xx + dx, yy + dy);
        if (alt && (alt.typ === btyp || alt.typ === ftyp || alt.typ === SCORR)) continue;
        dy = -dy; dx = -dx;
    }
    if (npoints_out) npoints_out.v = npoints;
    return true;
}

// C ref: mklev.c dosdoor()
function dosdoor(x, y, aroom, type) {
    const map = game.level;
    const loc = map.at(x, y);
    if (!loc) return;
    const shdoor = in_rooms(x, y, SHOPBASE).length > 0;
    if (!IS_WALL(loc.typ)) type = DOOR;
    loc.typ = type;
    // C ref: rm.h — doormask is an alias for the cell's flags field.
    if (type === DOOR) {
        if (!rn2(3)) {
            if (!rn2(5)) loc.doormask = D_ISOPEN;
            else if (!rn2(6)) loc.doormask = D_LOCKED;
            else loc.doormask = D_CLOSED;
            if (loc.doormask !== D_ISOPEN && !shdoor
                && level_difficulty() >= 5 && !rn2(25))
                loc.doormask |= D_TRAPPED;
        } else {
            loc.doormask = shdoor ? D_ISOPEN : D_NODOOR;
        }
        if (loc.doormask & D_TRAPPED) {
            // C ref: mklev.c:653-663 — a deep trapped door is sometimes a mimic
            // instead.  The port used to stop at the D_NODOOR assignment, which
            // silently dropped mkclass(S_MIMIC,0)'s rn2 walk, makemon()'s whole
            // draw block and set_mimic_sym() (run from makemon for S_MIMIC), and
            // left the monster off fmon so every later movemon() pass was short
            // one mcalcmove().  The mvitals guard is "all three mimic species
            // extinct", never true at generation time.
            if (level_difficulty() >= 9 && !rn2(5)
                && !(mvitals_gone(PM_SMALL_MIMIC) && mvitals_gone(PM_LARGE_MIMIC)
                     && mvitals_gone(PM_GIANT_MIMIC))) {
                loc.doormask = D_NODOOR;
                // C's extra set_mimic_sym(mtmp) after makemon() re-runs the same
                // dispatch; on a DOOR square it takes the RNG-free M_AP_FURNITURE
                // arm, so the one call inside makemon() is state-identical.
                const mtmp = make_monster(mkclass(S_MIMIC, 0), x, y, 0);
                if (mtmp) placeOnLevel(mtmp, x, y);
            }
        }
        loc.flags = loc.doormask;
    } else {
        // SDOOR/SCORR: rm.flags is overloaded for wall_info here, so the
        // door state lives only in the separate doormask field (the
        // renderer keys SDOOR display off loc.horizontal, not flags).
        if (shdoor || !rn2(5)) loc.doormask = D_LOCKED;
        else loc.doormask = D_CLOSED;
        if (!shdoor && level_difficulty() >= 4 && !rn2(20))
            loc.doormask |= D_TRAPPED;
    }
    add_door(x, y, aroom);
}

function dodoor(x, y, aroom) {
    dosdoor(x, y, aroom, maybe_sdoor(8) ? SDOOR : DOOR);
}

function add_door(x, y, aroom) {
    const g = game;
    if (!g.level.doors) g.level.doors = [];
    for (let i = 0; i < aroom.doorct; i++) {
        const d = g.level.doors[aroom.fdoor + i];
        if (d && d.x === x && d.y === y) return;
    }
    if (aroom.doorct === 0) aroom.fdoor = g.level.doorindex;
    aroom.doorct++;
    for (let tmp = g.level.doorindex; tmp > aroom.fdoor; tmp--)
        g.level.doors[tmp] = g.level.doors[tmp - 1];
    for (const broom of g.level.rooms || []) {
        if (!broom || broom.hx <= 0 || broom === aroom || !(broom.doorct > 0)) continue;
        if ((broom.fdoor ?? 0) >= aroom.fdoor) broom.fdoor++;
    }
    // C ref: mklev.c:602 — the SAME bump runs a second time over gs.subrooms[].
    // Without it a nested shop/temple keeps a door index that the parent's
    // insertion already shifted, so good_shopdoor() rejects it.
    for (const broom of g.level.subrooms || []) {
        if (!broom || broom === aroom || !(broom.doorct > 0)) continue;
        if ((broom.fdoor ?? 0) >= aroom.fdoor) broom.fdoor++;
    }
    g.level.doors[aroom.fdoor] = { x, y };
    g.level.doorindex++;
}

// C ref: mklev.c join()
function join(a, b, nxcor) {
    const g = game;
    const croom = g.level.rooms[a];
    const troom = g.level.rooms[b];
    if (!croom || !troom) return;
    if (!croom.needjoining || !troom.needjoining) return;
    if (troom.hx < 0 || croom.hx < 0) return;
    let dx, dy;
    const cc = { x: 0, y: 0 }, tt = { x: 0, y: 0 };
    if (troom.lx > croom.hx) {
        dx = 1; dy = 0;
        if (!finddpos(cc, DIR_E, croom)) return;
        if (!finddpos(tt, DIR_W, troom)) return;
    } else if (troom.hy < croom.ly) {
        dy = -1; dx = 0;
        if (!finddpos(cc, DIR_N, croom)) return;
        if (!finddpos(tt, DIR_S, troom)) return;
    } else if (troom.hx < croom.lx) {
        dx = -1; dy = 0;
        if (!finddpos(cc, DIR_W, croom)) return;
        if (!finddpos(tt, DIR_E, troom)) return;
    } else {
        dy = 1; dx = 0;
        if (!finddpos(cc, DIR_S, croom)) return;
        if (!finddpos(tt, DIR_N, troom)) return;
    }
    const xx = cc.x, yy = cc.y;
    const tx = tt.x - dx, ty = tt.y - dy;
    if (nxcor) {
        const loc = game.level.at(xx + dx, yy + dy);
        if (loc && loc.typ !== STONE) return;
    }
    const org = { x: xx + dx, y: yy + dy };
    const dest = { x: tx, y: ty };
    const npoints = { v: 0 };
    const ftyp = CORR;
    const dig_result = dig_corridor(org, dest, npoints, nxcor, ftyp, STONE);
    if ((npoints.v > 0) && (okdoor(xx, yy) || !nxcor))
        dodoor(xx, yy, croom);
    if (!dig_result) return;
    if (okdoor(tt.x, tt.y) || !nxcor)
        dodoor(tt.x, tt.y, troom);
    if (g.smeq[a] < g.smeq[b]) g.smeq[b] = g.smeq[a];
    else g.smeq[a] = g.smeq[b];
}

// C ref: mklev.c makecorridors()
function makecorridors() {
    const g = game;
    let any = true;
    for (let i = 0; i < g.level.nroom; i++) g.smeq[i] = i;
    for (let a = 0; a < g.level.nroom - 1; a++) {
        join(a, a + 1, false);
        if (!rn2(50)) break;
    }
    for (let a = 0; a < g.level.nroom - 2; a++)
        if (g.smeq[a] !== g.smeq[a + 2]) join(a, a + 2, false);
    for (let a = 0; any && a < g.level.nroom; a++) {
        any = false;
        for (let b = 0; b < g.level.nroom; b++)
            if (g.smeq[a] !== g.smeq[b]) { join(a, b, false); any = true; }
    }
    if (g.level.nroom > 2) {
        const count = rn2(g.level.nroom) + 4;
        for (let i = 0; i < count; i++) {
            let a = rn2(g.level.nroom);
            let b = rn2(g.level.nroom - 2);
            if (b >= a) b += 2;
            join(a, b, true);
        }
    }
}

// ============================================================
// Stairs
// ============================================================

function generate_stairs_room_good(croom, phase) {
    if (!croom || croom.hx < 0) return false;
    if (!croom.needjoining && phase >= 0) return false;
    let hasDown = false, hasUp = false;
    for (let st = game.stairs; st; st = st.next) {
        const inRoom = st.sx >= croom.lx && st.sx <= croom.hx
            && st.sy >= croom.ly && st.sy <= croom.hy;
        if (!inRoom) continue;
        if (st.up) hasUp = true; else hasDown = true;
    }
    if (phase >= 1 && (hasDown || hasUp)) return false;
    if (croom.rtype !== OROOM && !(phase < 2 && croom.rtype === THEMEROOM)) return false;
    return true;
}

function generate_stairs_find_room() {
    const g = game;
    if (!g.level.nroom) return null;
    for (let phase = 2; phase > -1; phase--) {
        const candidates = [];
        for (let i = 0; i < g.level.nroom; i++)
            if (generate_stairs_room_good(g.level.rooms[i], phase))
                candidates.push(i);
        if (candidates.length > 0) {
            const pick = rn2(candidates.length);
            return g.level.rooms[candidates[pick]];
        }
    }
    return g.level.rooms[rn2(g.level.nroom)];
}

function mkstairs(x, y, up, croom) {
    const g = game;
    // C ref: mklev.c:2188 `if (dunlev(&u.uz) == (up ? 1 :
    // dunlevs_in_dungeon(&u.uz))) return;`, before BOTH stairway_add() and
    // set_levltyp(STAIRS).  Without it Mines 1 gets a phantom `<`.
    // u.uz.dlevel is already dungeon-relative, so dunlev(&u.uz) == it.
    // Fires on des-file stairs at a dungeon end (minefill's des.stair("up") on
    // Mines 1, minend's des.stair("down") on Mines 8) as well as on
    // generate_stairs().  MEASURED 2026-08-14: +18 seed4500, seed0360 flat.
    // Deliberately WITHOUT mklev.c:2258's Is_botlevel guard in
    // generate_stairs() — see the note there; adding that costs 4 more.
    if ((g.u?.uz?.dlevel ?? 1) === (up ? 1 : dunlevs_in_dungeon(g.u?.uz)))
        return;
    const loc = g.level.at(x, y);
    if (loc) {
        loc.typ = STAIRS;
        loc.ladder = up ? 1 : 2;
    }
    const dest = {
        dnum: g.u?.uz?.dnum ?? 0,
        dlevel: (g.u?.uz?.dlevel ?? 1) + (up ? -1 : 1),
    };
    stairway_add(x, y, !!up, false, dest);
    if (up) g.level.upstair = { x, y };
    else g.level.dnstair = { x, y };
}

async function generate_stairs() {
    const g = game;
    const pos = { x: 0, y: 0 };
    // Down stairs.
    //
    // NOT PORTED — C ref: mklev.c:2258 wraps this whole block in
    // `if (!Is_botlevel(&u.uz))`, so on a dungeon's last level neither
    // generate_stairs_find_room()'s rn2 nor somexyspace()'s draws happen.
    // The guard is genuinely C-faithful, but it only fires on the two levels
    // that reach this generator and shouldn't: Wiz-goal {3,6} (the non-Bar
    // quest "{filecode}-filb" filler is unported) and Vlad's-Tower-bottom
    // {6,3} (makemaz("tower3") is written but not dispatched — see makelevel).
    // On those two, EVERY draw we make is already off C's stream, so removing
    // three of them is a coin flip.
    // MEASURED 2026-08-14 on top of the mkstairs() guard below, i.e. exactly
    // the "land the pair together" this comment used to prescribe: seed0360
    // 290 -> 287, seed4500 845 -> 844.  Both worse.  Land it only with a real
    // tower3 / quest-filb dispatch, and re-measure — do not re-test the pair.
    {
        const croom = generate_stairs_find_room();
        if (croom) {
            if (!somexyspace(croom, pos)) {
                pos.x = somex(croom);
                pos.y = somey(croom);
            }
            mkstairs(pos.x, pos.y, 0, croom);
        }
    }
    // Up stairs only if not level 1
    if ((g.u?.uz?.dlevel ?? 1) !== 1) {
        const croom = generate_stairs_find_room();
        if (croom) {
            if (!somexyspace(croom, pos)) {
                pos.x = somex(croom);
                pos.y = somey(croom);
            }
            mkstairs(pos.x, pos.y, 1, croom);
        }
    }
}

// ============================================================
// Oracle special level (C ref: dat/oracle.lua, loaded via makemaz("oracle")
// -> load_special -> the des.* program).  Reuses create_room/makecorridors/
// wallification.  Only entered for the Oracle level position; gated so it
// cannot affect ordinary level generation.
// ============================================================

// C ref: dungeon.c induced_align(pct) — returns an ALTARMASK, not an aligntyp.
// A special level's own flags.align gets first refusal (rn2(100) < pct), then
// the fallthrough Align2amask(rn2(3) - 1).
//
// C's second arm (`if (svd.dungeons[u.uz.dnum].flags.align)`) is DEAD and must
// stay unported: dungeon.h declares `Bitfield(align, 3)` while dungeon.c:1092
// assigns the unshifted dgn_align (D_ALIGN_LAWFUL == AM_LAWFUL << 4 == 0x40),
// so every dungeon's flags.align truncates to 0 and its rn2(100) never runs.
// s_level's align IS shifted (dungeon.c:588 `>> 4`), which is why arm one lives.
function induced_align(pct = 80) {
    const slev = Is_special(game.u?.uz);
    if (slev && slev.flags && slev.flags.align) {
        if (rn2(100) < pct) return slev.flags.align;
    }
    return Align2amask(rn2(3) - 1);
}

// Kept as the des.monster() call site's name; identical RNG, result discarded.
function oracle_induced_align(pct = 80) {
    induced_align(pct);
}

// C ref: sp_lev.c create_subroom() — random size/pos within parent.
function create_subroom(proom, x, y, w, h, rtype, rlit) {
    const width = proom.hx - proom.lx + 1;
    const height = proom.hy - proom.ly + 1;
    if (width < 4 || height < 4) return false;
    if (w === -1) w = rnd(width - 3);
    if (h === -1) h = rnd(height - 3);
    if (x === -1) x = rnd(width - w);
    if (y === -1) y = rnd(height - h);
    if (x === 1) x = 0;
    if (y === 1) y = 0;
    if ((x + w + 1) === width) x++;
    if ((y + h + 1) === height) y++;
    if (rtype === -1) rtype = OROOM;
    rlit = litstate_rnd(rlit);
    add_subroom(proom, proom.lx + x, proom.ly + y,
                proom.lx + x + w - 1, proom.ly + y + h - 1, rlit, rtype, false);
    return true;
}

// C ref: mklev.c add_subroom().
function add_subroom(proom, lowx, lowy, hix, hiy, lit, rtype, special) {
    const g = game;
    const croom = {
        lx: lowx, ly: lowy, hx: hix, hy: hiy,
        rtype, rlit: lit ? 1 : 0,
        doorct: 0, fdoor: g.level.doorindex,
        irregular: false, needjoining: !special,
        nsubrooms: 0, sbrooms: [],
        // C ref: mklev.c add_subroom() — `gs.subrooms = &svr.rooms[MAXNROFROOMS + 1]`,
        // so a subroom's roomno is MAXNROFROOMS+1+n, NOT its parent's.  Sharing
        // the parent's index made every subroom roomno comparison answer wrong.
        roomnoidx: MAXNROFROOMS + 1 + (g.level.nsubroom || 0),
        needfill: 0,
    };
    g.level.nsubroom = (g.level.nsubroom || 0) + 1;
    // C ref: decl.c gs.subrooms[] — the flat, level-wide subroom array that
    // add_door()'s second fdoor loop walks (proom.sbrooms is per-parent).
    (g.level.subrooms || (g.level.subrooms = [])).push(croom);
    do_room_or_subroom(croom, lowx, lowy, hix, hiy, lit, rtype, special, false);
    if (!proom.sbrooms) proom.sbrooms = [];
    proom.sbrooms[proom.nsubrooms++] = croom;
    return croom;
}

// C ref: get_free_room_loc -> get_location_coord(random) -> somexy(croom).
function oracle_get_free_room_loc(croom) {
    const c = { x: 0, y: 0 };
    somexy(croom, c);
    return c;
}

// Place a random STATUE with the given montype monster-class index (the
// historic statue gets a random corpsenm from the class, then create_object
// overrides corpsenm with the montype species; statue internals consume the
// rndmonnum + spellbook rolls inside mksobj_init).  x,y are absolute.
function oracle_place_statue(x, y, monclass) {
    // C: lspo_object pre-roll — mkclass(monclass, G_NOGEN|G_IGNORE) for montype.
    const pm = mkclass(monclass, 0);
    // create_object -> mksobj_at(STATUE, x, y, init=true)
    const otmp = mksobj_at(STATUE, x, y, true, true);
    // create_object: o->corpsenm != NON_PM -> set_corpsenm(otmp, montype species)
    if (pm && otmp) set_corpsenm(otmp, pm.pmidx);
    return otmp;
}

// ============================================================
// Gnomish Mines fill level (C ref: dat/minefill.lua loaded via
// makemaz("minefill") -> load_special -> the des.* program; the cave is built
// by the cellular-automaton generator mkmap.c).  Gated so it only runs for the
// mines fill levels and cannot perturb ordinary level generation.
// ============================================================

// mkmap.c constants.
const MK_HEIGHT = ROWNO - 1;   // 20
const MK_WIDTH = COLNO - 2;    // 78

// mkmap.c dirs[16] — 8 neighbor offsets.
const MK_DIRS = [
    -1, -1,  -1, 0,  -1, 1,  0, -1,
     0,  1,   1, -1,  1, 0,  1,  1,
];

// C ref: mkmap.c get_map()
function mk_get_map(col, row, bg_typ) {
    if (col <= 0 || row < 0 || col > MK_WIDTH || row >= MK_HEIGHT)
        return bg_typ;
    return game.level.at(col, row).typ;
}

// C ref: mkmap.c init_map()
function mk_init_map(bg_typ) {
    const map = game.level;
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = map.at(x, y);
            loc.roomno = NO_ROOM;
            loc.typ = bg_typ;
            loc.lit = false;
        }
}

// C ref: mkmap.c init_fill()
function mk_init_fill(bg_typ, fg_typ) {
    const map = game.level;
    const limit = Math.trunc((MK_WIDTH * MK_HEIGHT * 2) / 5);
    let count = 0;
    while (count < limit) {
        const x = rn1(MK_WIDTH - 1, 2);   // rn1(77, 2) = 2 + rn2(77)
        const y = rnd(MK_HEIGHT - 1);     // rnd(19)
        const loc = map.at(x, y);
        if (loc && loc.typ === bg_typ) {
            loc.typ = fg_typ;
            count++;
        }
    }
}

// C ref: mkmap.c pass_one()
function mk_pass_one(bg_typ, fg_typ) {
    const map = game.level;
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            let count = 0;
            for (let dr = 0; dr < 8; dr++)
                if (mk_get_map(x + MK_DIRS[dr * 2], y + MK_DIRS[dr * 2 + 1], bg_typ) === fg_typ)
                    count++;
            const loc = map.at(x, y);
            switch (count) {
            case 0: case 1: case 2:
                loc.typ = bg_typ; break;
            case 5: case 6: case 7: case 8:
                loc.typ = fg_typ; break;
            default: break;
            }
        }
}

// C ref: mkmap.c pass_two()
function mk_pass_two(bg_typ, fg_typ) {
    const map = game.level;
    const newloc = new Array((MK_WIDTH + 1) * MK_HEIGHT);
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            let count = 0;
            for (let dr = 0; dr < 8; dr++)
                if (mk_get_map(x + MK_DIRS[dr * 2], y + MK_DIRS[dr * 2 + 1], bg_typ) === fg_typ)
                    count++;
            newloc[y * (MK_WIDTH + 1) + x] = (count === 5) ? bg_typ : mk_get_map(x, y, bg_typ);
        }
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++)
            map.at(x, y).typ = newloc[y * (MK_WIDTH + 1) + x];
}

// C ref: mkmap.c pass_three()
function mk_pass_three(bg_typ, fg_typ) {
    const map = game.level;
    const newloc = new Array((MK_WIDTH + 1) * MK_HEIGHT);
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            let count = 0;
            for (let dr = 0; dr < 8; dr++)
                if (mk_get_map(x + MK_DIRS[dr * 2], y + MK_DIRS[dr * 2 + 1], bg_typ) === fg_typ)
                    count++;
            newloc[y * (MK_WIDTH + 1) + x] = (count < 3) ? bg_typ : mk_get_map(x, y, bg_typ);
        }
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++)
            map.at(x, y).typ = newloc[y * (MK_WIDTH + 1) + x];
}

// flood_fill_rm bookkeeping (C ref: gm.min_rx etc.).
let mk_min_rx, mk_max_rx, mk_min_ry, mk_max_ry, mk_n_loc_filled;

// C ref: mkmap.c flood_fill_rm() — anyroom=FALSE path only (used by join_map).
function mk_flood_fill_rm(sx, sy, rmno) {
    const map = game.level;
    const fg_typ = map.at(sx, sy).typ;

    while (sx > 0 && map.at(sx, sy).typ === fg_typ
           && map.at(sx, sy).roomno !== rmno)
        sx--;
    sx++;

    if (sx < mk_min_rx) mk_min_rx = sx;
    if (sy < mk_min_ry) mk_min_ry = sy;

    let i;
    for (i = sx; i <= MK_WIDTH && map.at(i, sy).typ === fg_typ; i++) {
        map.at(i, sy).roomno = rmno;
        map.at(i, sy).lit = false;
        mk_n_loc_filled++;
    }
    const nx = i;

    if (isok(sx, sy - 1)) {
        for (i = sx; i < nx; i++)
            if (map.at(i, sy - 1).typ === fg_typ) {
                if (map.at(i, sy - 1).roomno !== rmno)
                    mk_flood_fill_rm(i, sy - 1, rmno);
            } else {
                if ((i > sx || isok(i - 1, sy - 1))
                    && map.at(i - 1, sy - 1).typ === fg_typ) {
                    if (map.at(i - 1, sy - 1).roomno !== rmno)
                        mk_flood_fill_rm(i - 1, sy - 1, rmno);
                }
                if ((i < nx - 1 || isok(i + 1, sy - 1))
                    && map.at(i + 1, sy - 1).typ === fg_typ) {
                    if (map.at(i + 1, sy - 1).roomno !== rmno)
                        mk_flood_fill_rm(i + 1, sy - 1, rmno);
                }
            }
    }
    if (isok(sx, sy + 1)) {
        for (i = sx; i < nx; i++)
            if (map.at(i, sy + 1).typ === fg_typ) {
                if (map.at(i, sy + 1).roomno !== rmno)
                    mk_flood_fill_rm(i, sy + 1, rmno);
            } else {
                if ((i > sx || isok(i - 1, sy + 1))
                    && map.at(i - 1, sy + 1).typ === fg_typ) {
                    if (map.at(i - 1, sy + 1).roomno !== rmno)
                        mk_flood_fill_rm(i - 1, sy + 1, rmno);
                }
                if ((i < nx - 1 || isok(i + 1, sy + 1))
                    && map.at(i + 1, sy + 1).typ === fg_typ) {
                    if (map.at(i + 1, sy + 1).roomno !== rmno)
                        mk_flood_fill_rm(i + 1, sy + 1, rmno);
                }
            }
    }

    if (nx > mk_max_rx) mk_max_rx = nx - 1;
    if (sy > mk_max_ry) mk_max_ry = sy;
}

// C ref: mkmap.c join_map_cleanup()
function mk_join_map_cleanup() {
    const map = game.level;
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++)
            map.at(x, y).roomno = NO_ROOM;
    game.level.nroom = 0;
    game.level.rooms[0] = { hx: -1 };
}

// C ref: mkmap.c join_map()
function mk_join_map(bg_typ, fg_typ) {
    const g = game;
    const map = g.level;

    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            const loc = map.at(x, y);
            if (loc.typ === fg_typ && loc.roomno === NO_ROOM) {
                mk_min_rx = mk_max_rx = x;
                mk_min_ry = mk_max_ry = y;
                mk_n_loc_filled = 0;
                mk_flood_fill_rm(x, y, g.level.nroom + ROOMOFFSET);
                if (mk_n_loc_filled > 3) {
                    add_room(mk_min_rx, mk_min_ry, mk_max_rx, mk_max_ry,
                             false, OROOM, true);
                    g.level.rooms[g.level.nroom - 1].irregular = true;
                    if (g.level.nroom >= (MAXNROFROOMS * 2)) {
                        return mk_join_map_corridors(bg_typ, fg_typ);
                    }
                } else {
                    for (let sx = mk_min_rx; sx <= mk_max_rx; sx++)
                        for (let sy = mk_min_ry; sy <= mk_max_ry; sy++) {
                            const l2 = map.at(sx, sy);
                            if (l2.roomno === g.level.nroom + ROOMOFFSET) {
                                l2.typ = bg_typ;
                                l2.roomno = NO_ROOM;
                            }
                        }
                }
            }
        }
    return mk_join_map_corridors(bg_typ, fg_typ);
}

// C ref: mkmap.c join_map() second half — connect regions with corridors.
function mk_join_map_corridors(bg_typ, fg_typ) {
    const g = game;
    const rooms = g.level.rooms;
    let ci = 0, c2i = 1;
    const sm = { x: 0, y: 0 }, em = { x: 0, y: 0 };
    while (c2i < g.level.nroom) {
        const croom = rooms[ci], croom2 = rooms[c2i];
        if (!somexy(croom, sm) || !somexy(croom2, em)) {
            sm.x = croom.lx + Math.trunc((croom.hx - croom.lx) / 2);
            sm.y = croom.ly + Math.trunc((croom.hy - croom.ly) / 2);
            em.x = croom2.lx + Math.trunc((croom2.hx - croom2.lx) / 2);
            em.y = croom2.ly + Math.trunc((croom2.hy - croom2.ly) / 2);
        }
        dig_corridor(sm, em, null, false, fg_typ, bg_typ);
        if (croom2.lx > croom.hx
            || ((croom2.ly > croom.hy || croom2.hy < croom.ly) && rn2(3))) {
            ci = c2i;
        }
        c2i++;
    }
    mk_join_map_cleanup();
}

// C ref: sp_lev.c wallify_map() — convert STONE cells adjacent to a ROOM (or
// crosswall) into HWALL (vertically adjacent) or VWALL (horizontally adjacent).
// No RNG.  This is what gives the cave its walls; the corner/T types are set
// later by wallification().
function mk_wallify_map(x1, y1, x2, y2) {
    const map = game.level;
    y1 = Math.max(y1, 0); x1 = Math.max(x1, 1);
    y2 = Math.min(y2, ROWNO - 1); x2 = Math.min(x2, COLNO - 1);
    for (let y = y1; y <= y2; y++) {
        const loYY = (y > 0) ? y - 1 : 0;
        const hiYY = (y < y2) ? y + 1 : y2;
        for (let x = x1; x <= x2; x++) {
            if (map.at(x, y)?.typ !== STONE) continue;
            const loXX = (x > 1) ? x - 1 : 1;
            const hiXX = (x < x2) ? x + 1 : x2;
            let done = false;
            for (let yy = loYY; yy <= hiYY && !done; yy++)
                for (let xx = loXX; xx <= hiXX; xx++) {
                    const t = map.at(xx, yy)?.typ;
                    if (IS_ROOM(t) || t === CROSSWALL) {
                        map.at(x, y).typ = (yy !== y) ? HWALL : VWALL;
                        done = true; break;
                    }
                }
        }
    }
}

// C ref: mkmap.c finish_map() — walled + lit handling (smooth/join already done).
function mk_finish_map(fg_typ, bg_typ, lit, walled) {
    const map = game.level;
    if (walled)
        mk_wallify_map(1, 0, COLNO - 1, ROWNO - 1);
    if (lit) {
        for (let x = 1; x < COLNO; x++)
            for (let y = 0; y < ROWNO; y++) {
                const t = map.at(x, y).typ;
                if ((!IS_OBSTRUCTED(fg_typ) && t === fg_typ)
                    || (!IS_OBSTRUCTED(bg_typ) && t === bg_typ)
                    || (walled && IS_WALL(t)))
                    map.at(x, y).lit = true;
            }
        for (let x = 0; x < game.level.nroom; x++)
            game.level.rooms[x].rlit = 1;
    }
}

// C ref: mkmap.c mkmap() — smooth+join always run (every covered caller sets
// smoothed/joined); bg_typ/fg_typ/walled are the only params that vary.
function mk_mkmap(lit, bg_typ = STONE, fg_typ = ROOM, walled = true) {
    mk_init_map(bg_typ);
    mk_init_fill(bg_typ, fg_typ);
    mk_pass_one(bg_typ, fg_typ);     // N_P1_ITER = 1
    mk_pass_two(bg_typ, fg_typ);     // N_P2_ITER = 1
    mk_pass_three(bg_typ, fg_typ);   // N_P3_ITER = 2 (smoothed)
    mk_pass_three(bg_typ, fg_typ);
    mk_join_map(bg_typ, fg_typ);     // joined
    mk_finish_map(fg_typ, bg_typ, lit, walled);
    // a walled, joined level is cavernous, not mazelike
    if (walled) {
        game.level.flags.is_maze_lev = false;
        game.level.flags.is_cavernous_lev = true;
    }
}

// ── lspo helpers for minefill ──

// C ref: sp_lev.c get_location() random spot (croom=NULL), then is_ok_location.
// Returns {x,y}.  okfn(typ-cell) gates acceptance (DRY-equivalent default).
function mk_get_location_random(okfn) {
    const map = game.level;
    const mx = 1, my = 0, sx = COLNO - 1, sy = ROWNO; // xstart/ystart/xsize/ysize
    let cpt = 0;
    let x = -1, y = -1;
    do {
        x = mx + rn2(sx);   // 1 + rn2(79)
        y = my + rn2(sy);   // 0 + rn2(21)
        if (okfn(x, y)) break;
    } while (++cpt < 100);
    if (cpt >= 100) {
        for (let xx = 0; xx < sx; xx++)
            for (let yy = 0; yy < sy; yy++) {
                x = mx + xx; y = my + yy;
                if (okfn(x, y)) return { x, y };
            }
    }
    return { x, y };
}

// is_ok_location DRY: SPACE_POS(typ) && no boulder (sp_lev.c:1296).
// The boulder test is load-bearing, not defensive: minefill's
// `des.object("boulder")` runs BEFORE the monsters/traps, and a
// ROLLING_BOULDER_TRAP drops another boulder at its launch coord
// (trap.c:3680 mkroll_launch), so later get_location(DRY) rolls must reject
// those squares and re-roll.
function mk_ok_dry(x, y) {
    const loc = game.level.at(x, y);
    if (!loc) return false;
    if (!SPACE_POS(loc.typ)) return false;
    return !mk_sobj_at_boulder(x, y);
}

// good_stair_loc: ROOM || CORR || ICE.
function mk_ok_stair(x, y) {
    const loc = game.level.at(x, y);
    if (!loc) return false;
    return loc.typ === ROOM || loc.typ === CORR || loc.typ === ICE;
}

// des.stair(dir) random spot: get_location_coord(DRY) with good_stair_loc, then
// mkstairs.  C ref: l_create_stairway().
function mk_stair(up) {
    const c = mk_get_location_random(mk_ok_stair);
    const t = game.level.at(c.x, c.y);
    if (t) t.typ = ROOM; // SpLev_Map mark; cell becomes floor for the stair
    mkstairs(c.x, c.y, up ? 1 : 0, null);
}

// des.object(class) at a random DRY spot.  oclass: GEM_CLASS / WEAPON_CLASS /
// RANDOM_CLASS / BOULDER(specific id).  C ref: create_object().
function mk_object(oclass, specificId) {
    const c = mk_get_location_random(mk_ok_dry);
    if (specificId != null) {
        mksobj_at(specificId, c.x, c.y, true, true);
    } else if (oclass === RANDOM_CLASS) {
        mkobj_at(RANDOM_CLASS, c.x, c.y, true);
    } else {
        mkobj_at(oclass, c.x, c.y, true);
    }
}

// Name-implied gender for find_montype comes from makemon.js's table-derived
// name_gender_hint(): the NEUTRAL name ("gnome leader") answers NEUTRAL and
// still rolls, only the male/female forms ("gnome lord"/"gnome lady") skip it.
// (The hand-written Set this replaced listed the neutral names as male, and
// knew only 5 of the 15 NAMS() species.)

// The JS monster table stores gender-neutral canonical names ("gnome leader",
// "gnome ruler"); the lua uses gendered aliases ("gnome lord", "gnome king").
// Resolve a gendered name to the canonical species name for lookup.
const MK_NAME_ALIAS = {
    // C ref: mons[].pmnames[] — 'caveman'/'cavewoman' are the male/female
    // display names of the species whose neutral name is 'cave dweller', and
    // name_to_mon() matches any of the three.
    caveman: 'cave dweller', cavewoman: 'cave dweller',
    'gnome lord': 'gnome leader', 'gnome lady': 'gnome leader',
    'gnome king': 'gnome ruler', 'gnome queen': 'gnome ruler',
    'dwarf lord': 'dwarf leader', 'dwarf lady': 'dwarf leader',
    'dwarf king': 'dwarf ruler', 'dwarf queen': 'dwarf ruler',
};
function mk_resolve_name(name) {
    return MK_NAME_ALIAS[name] || name;
}

// is_male/is_female: species fixed gender (gcode 1=male, 2=female).
function mk_is_fixed_gender(data) {
    return !!data && (data.gcode === 1 || data.gcode === 2);
}

// C ref: sp_lev.c find_montype() — name lookup + conditional gender roll.
// Rolls rn2(2) only when the species is not fixed-gender AND the name does not
// imply a gender.  Returns { data, mgend }: the resolved mgend is what
// lspo_monster stores in tmpmons.female and create_monster then ASSIGNS to the
// monster (sp_lev.c `mtmp->female = m->female;`), overwriting whatever
// makemon()'s own rn2(2) picked — so a des.monster() gender is NOT the makemon
// draw, and the two disagree half the time.
function mk_find_montype(name) {
    const pm = name_to_pmidx(mk_resolve_name(name));
    const data = monster_by_pmidx(pm);
    let mgend;
    if (mk_is_fixed_gender(data)) {
        mgend = (data.gcode === 2) ? MGEND_FEMALE : MGEND_MALE;
    } else {
        mgend = name_gender_hint(name);
        if (mgend === MGEND_NEUTRAL) mgend = rn2(2);   // mgend = rn2(2)
    }
    return { data, mgend };
}

// des.monster(name) — a multi-char monster name (id given, no mkclass).
// C ref: lspo_monster (find_montype) + create_monster (induced_align + makemon).
// C ref: sp_lev.c create_monster():1959 — `if (In_mines(&u.uz) && your_race(pm)
// && (Race_if(PM_DWARF) || Race_if(PM_GNOME)) && rn2(3)) pm = NULL;`.  The gate
// was commented out as "hero is not gnome/dwarf race", which is only true of the
// seed it was written against; it draws rn2(3) whenever it applies.
// your_race() is a FLAG test (mondata.h:102), so every M2_GNOME species counts.
function mk_mines_race_suppress(data) {
    const inMines = game.mines_dnum != null && game.u?.uz?.dnum === game.mines_dnum;
    if (!inMines || !data) return data;
    const r = races[game.initrace];
    if (!r || r.selfmask == null) return data;
    if (!(mflags2_of(data) & r.selfmask)) return data;
    if (!(r.name === 'dwarf' || r.name === 'gnome')) return data;
    return rn2(3) ? null : data;
}

function mk_monster_named(name, peacefulOverride) {
    const { data, mgend } = mk_find_montype(name);
    // sp_amask_to_amask(AM_SPLEV_RANDOM) -> induced_align(80).
    oracle_induced_align();
    const data2 = mk_mines_race_suppress(data);
    // pm_to_humidity(pm) — DRY for these mines monsters (no swimmers/flyers).
    const c = mk_get_location_random(mk_ok_dry);
    mk_enexto_if_occupied(c, data2);
    const mtmp = make_monster(data2, c.x, c.y, 0);
    // C ref: sp_lev.c create_monster() `mtmp->female = m->female;` (no RNG).
    if (mtmp) mtmp.female = mgend;
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    return mtmp;
}

// C ref: sp_lev.c create_monster():1977 — "try to find a close place if someone
// else is already there": `if (MON_AT(x,y) && enexto(&cc,x,y,pm)) x=cc.x,y=cc.y`.
// The enexto ring shuffles are 8+16+24 rn2() draws, so omitting this desynced
// every later draw on a filler level whose random spot happened to be taken.
function mk_enexto_if_occupied(c, data) {
    if (!m_at(c.x, c.y)) return;
    const cc = enexto_spawn(c.x, c.y, data);
    if (cc) { c.x = cc.x; c.y = cc.y; }
}

// des.monster("G"/"h") — a single-char monster CLASS (no find_montype gender
// roll).  C ref: create_monster -> mkclass(class, G_NOGEN), then induced_align
// + makemon.  S_GNOME=33 ('G'), S_HUMANOID=8 ('h').
// S_OGRE=41, S_TROLL=46 (defsym.h), needed by Bar-fila's "O"/"T" class picks.
// defsym.h MONSYM(): L 38 lich, M 39 mummy, V 48 vampire, Z 52 zombie
// (themerms.lua 'Mausoleum'), '@' 53 human.
// S 45 snake (Arc-fil[ab]), W 49 wraith (Pri-fil[ab]).
const MK_CLASS_CHAR = { G: 33, h: 8, O: 41, T: 46, L: 38, M: 39, V: 48, Z: 52, '@': 53,
                        S: 45, W: 49, E: 31, X: 50, i: 9, l: 12 };
function mk_monster_class(classChar, peacefulOverride) {
    const klass = MK_CLASS_CHAR[classChar] ?? 0;
    // C ref: create_monster — amask = sp_amask_to_amask(AM_SPLEV_RANDOM) ->
    // induced_align(80) is computed FIRST, then pm = mkclass(class, G_NOGEN),
    // then get_location + makemon.
    oracle_induced_align();
    const data = mk_mines_race_suppress(mkclass(klass, 0x0200 /* G_NOGEN (monflag.h); was 1 */));
    const c = mk_get_location_random(mk_ok_dry);
    mk_enexto_if_occupied(c, data);
    const mtmp = make_monster(data, c.x, c.y, 0);
    // C ref: sp_lev.c lspo_monster() — the single-char CLASS form never touches
    // tmpmons.female, so it keeps its `= 0` initialiser and create_monster's
    // `mtmp->female = m->female;` makes every des.monster("G") male.
    if (mtmp) mtmp.female = 0;
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    return mtmp;
}

// dispatch: single-char -> class; else named.
function mk_monster(spec, peacefulOverride) {
    if (spec.length === 1) return mk_monster_class(spec, peacefulOverride);
    return mk_monster_named(spec, peacefulOverride);
}

// des.trap() random type at a random DRY spot (avoiding stairs/ladders).
// C ref: create_trap() croom==NULL path + mktrap().
async function mk_trap() {
    const map = game.level;
    let c, trycnt = 0;
    do {
        c = mk_get_location_random(mk_ok_dry);
        const t = map.at(c.x, c.y);
        if (!(t && (t.typ === STAIRS))) break; // LADDER not present here
    } while (++trycnt <= 100);
    await qf_mktrap_at(c.x, c.y);
}

// mktrap(type=-1 random): traptype loop + maketrap + victim gate.  Shared by
// des.trap() with and without a croom.
async function qf_mktrap_at(cx, cy) {
    const c = { x: cx, y: cy };
    let kind;
    kind = mktrap_random_kind();
    const dungeon = game.dungeons?.[game.u?.uz?.dnum ?? 0];
    const canFallThru = (game.u?.uz?.dlevel ?? 1)
        < (dungeon?.num_dunlevs ?? 99);
    if (is_hole(kind) && !canFallThru) kind = ROCKTRAP;
    const trap = await maketrap(c.x, c.y, kind);
    kind = trap ? trap.ttyp : NO_TRAP;
    // C ref: sp_lev.c create_trap() -> mktrap(..., mktrap_flags, ...) — a
    // lua des.trap() defaults spider_on_web=TRUE (lspo_trap, sp_lev.c:4405),
    // so MKTRAP_NOSPIDERONWEB is normally NOT set; mktrap() then spawns a
    // giant spider on a freshly made WEB trap.
    if (kind === WEB) {
        const spiderPm = monster_by_pmidx(name_to_pmidx('giant spider'));
        if (spiderPm) make_monster(spiderPm, c.x, c.y, 0);
    }
    const lvl = level_difficulty();
    if (kind !== NO_TRAP
        && lvl <= rnd(4)
        && kind !== SQKY_BOARD && kind !== RUST_TRAP
        && !(kind === ROLLING_BOULDER_TRAP && trap.launch?.x === trap.tx && trap.launch?.y === trap.ty)
        && !is_pit(kind) && (kind < HOLE || kind === MAGIC_TRAP)) {
        if (kind === LANDMINE) { trap.ttyp = PIT; trap.tseen = true; }
        mktrap_victim(trap);
    }
}

// math.random(lo,hi) = lo + rn2(hi+1-lo).
function mk_mrandom(lo, hi) { return lo + rn2(hi + 1 - lo); }
// percent(n) = rn2(100) < n.
function mk_percent(n) { return rn2(100) < n; }

// C ref: dat/minefill.lua + mkmap.c + load_special finalize + mineralize.
async function makemaz_minefill() {
    const g = game;

    // load_special -> load_lua -> nhlib.lua prelude shuffle(align): rn2(3),rn2(2)
    const align = ['law', 'neutral', 'chaos'];
    for (let i = align.length; i >= 2; i--) {
        const j = 1 + rn2(i);
        const a = i - 1, b = j - 1;
        const t = align[a]; align[a] = align[b]; align[b] = t;
    }

    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    const was_mklev = g.in_mklev;
    g.in_mklev = true;
    try {
        // des.level_init({ style="solidfill", fg=" " })
        //   splev_initlev SOLIDFILL: lit = rn2(2); lvlfill_solid(STONE, lit).
        rn2(2);
        // des.level_flags("mazelevel","noflip") — no PRNG.
        // des.level_init({ style="mines", fg=".", bg=" ", smoothed, joined, walled })
        //   splev_initlev MINES: lit = rn2(2); lvlfill_solid(ROOM,0); mkmap().
        const minesLit = rn2(2);
        // litstate_rnd(lit): lit >= 0 -> returns lit, no PRNG.
        mk_mkmap(!!minesLit);

        // des.stair("up"); des.stair("down")
        mk_stair(true);
        mk_stair(false);

        // for i=1,math.random(2,5) do des.object("*") end  (gems)
        let n = mk_mrandom(2, 5);
        for (let i = 0; i < n; i++) mk_object(GEM_CLASS);
        // des.object("(")   (tool, '(' == TOOL_CLASS)
        mk_object(TOOL_CLASS);
        // for i=1,math.random(2,4) do des.object() end  (random class)
        n = mk_mrandom(2, 4);
        for (let i = 0; i < n; i++) mk_object(RANDOM_CLASS);
        // if percent(75) then for i=1,math.random(1,2) do des.object("boulder")
        if (mk_percent(75)) {
            n = mk_mrandom(1, 2);
            for (let i = 0; i < n; i++) mk_object(null, BOULDER);
        }

        // for i=1,math.random(6,8) do des.monster("gnome") end
        n = mk_mrandom(6, 8);
        for (let i = 0; i < n; i++) mk_monster('gnome');
        mk_monster('gnome lord');
        mk_monster('dwarf');
        mk_monster('dwarf');
        mk_monster('G');               // random gnome class
        mk_monster('G');
        mk_monster(mk_percent(50) ? 'h' : 'G');

        // des.trap() x6
        for (let i = 0; i < 6; i++) await mk_trap();
    } finally {
        g._full_mon_gen = was_full;
        g.in_mklev = was_mklev;
    }

    // load_special finalize: !corrmaze -> wallification(1,0,COLNO-1,ROWNO-1).
    // (mkmap already wallified; this is idempotent for our purposes — no PRNG.)
    wallification(1, 0, COLNO - 1, ROWNO - 1);

    // fixup_special: place the dungeon branch staircase (place_lregion LR_BRANCH
    // probabilistic loop, since join_map_cleanup left svn.nroom == 0).
    await mk_fixup_branch();

    // NOTE: level_finalize_topology -> mineralize() is NOT called here; the JS
    // engine factors mineralize() into fastforward_fill_mineralize(), which
    // goto_level() runs immediately after mklev().  For minefill the room-fill
    // loop there is a no-op (join_map_cleanup left nroom == 0) and only
    // mineralize() runs, matching C's level_finalize_topology ordering.
}

// ============================================================
// dat/minetn-4.lua — Mine Town variant 4, "College Town" (Kelly Bailey).
//
// Unlike minetn-5 (a des.map bitmap) this variant is a rooms-and-corridors
// script: one big centred `des.room` holding 12 nested subrooms (shops,
// a temple, gnome homes), four fully random rooms and des.random_corridors().
// The engine pieces it needs — create_room/create_subroom/topologize/
// create_door/makecorridors — are the same ones makemaz_oracle() drives, so
// this reuses them rather than re-entering the sp_lev.js coder.
//
// C ref: mkmaze.c:1136 makemaz("minetn") -> load_special("minetn-4.lua"),
// sp_lev.c lspo_room()/build_room()/create_door()/create_monster().
// ============================================================

// C ref: sp_lev.c room_types[] — the des `type=` strings this script uses.
// Offsets are from mkroom.h: SHOPBASE 14, FOODSHOP 19, TOOLSHOP 22,
// BOOKSHOP 23, FODDERSHOP 24, CANDLESHOP 25.
const MT4_SHOP_RTYPE = {
    'shop': SHOPBASE, 'tool shop': SHOPBASE + 8, 'book shop': SHOPBASE + 9,
    'food shop': SHOPBASE + 5, 'health food shop': SHOPBASE + 10,
    'candle shop': SHOPBASE + 11, 'temple': TEMPLE, 'ordinary': OROOM,
};

// C ref: dat/nhlib.lua:47 monkfoodshop() — role-dependent, no RNG.
function mt4_monkfoodshop() {
    return (roles[game.initrole]?.name === 'Monk')
        ? 'health food shop' : 'food shop';
}

// C ref: sp_lev.c lspo_room() -> build_room() for a nested subroom with
// explicit geometry.  `chance` defaults to 100 in lspo_room, so the rn2(100)
// is drawn for EVERY room even when it can never fail.
function mt4_subroom(parent, x, y, w, h, typeName, lit, chance = 100) {
    const wanted = MT4_SHOP_RTYPE[typeName] ?? OROOM;
    const rtype = (!chance || rn2(100) < chance) ? wanted : OROOM;
    const ok = create_subroom(parent, x, y, w, h, rtype, lit);
    parent.irregular = true;                 // lspo_room: parent goes irregular
    if (!ok) return null;
    const sub = parent.sbrooms[parent.nsubrooms - 1];
    topologize(sub);
    // lspo_room's `filled` defaults to 1 outside themerooms; fill_special_room
    // ignores OROOM anyway, and FILL_NONE keeps our fill_ordinary_room loop
    // (which C's des finalize does not run) off the plain rooms.
    sub.needfill = (rtype === OROOM) ? FILL_NONE : FILL_NORMAL;
    sub.needjoining = true;
    return sub;
}

const MT4_WALL = { north: W_NORTH, south: W_SOUTH, east: W_EAST, west: W_WEST };
const MT4_DOORSTATE = { closed: D_CLOSED, locked: D_LOCKED, nodoor: D_NODOOR };

// C ref: sp_lev.c lspo_door() table form -> create_door().  An explicit
// `state` fixes the mask and an explicit `wall` fixes the wall, so the only
// draws are the trycnt loop's rn2(4) plus one rn2(span) per accepted wall.
function mt4_door(croom, state, wall) {
    create_door({ secret: 0, mask: MT4_DOORSTATE[state], pos: -1,
                  wall: MT4_WALL[wall] }, croom);
}

// C ref: sp_lev.c lspo_feature() with croom coords — get_location_coord()
// offsets by croom->lx/ly and sel_set_feature() leaves furniture alone.
function mt4_feature(croom, rx, ry, typ) {
    const loc = game.level?.at(croom.lx + rx, croom.ly + ry);
    if (!loc || IS_FURNITURE(loc.typ)) return;
    loc.typ = typ;
    if (typ === FOUNTAIN && game.level?.flags) game.level.flags.nfountains =
        (game.level.flags.nfountains || 0) + 1;
}

// C ref: sp_lev.c create_altar() with an explicit coord and shrine=1 — no RNG
// of its own; priestini() supplies the whole draw sequence.
async function mt4_altar(croom, rx, ry, alignName) {
    const x = croom.lx + rx, y = croom.ly + ry;
    const loc = game.level?.at(x, y);
    if (!loc) return;
    loc.typ = ALTAR;
    const a = alignName === 'law' ? 1 : alignName === 'chaos' ? -1 : 0;
    loc.altarmask = Align2amask(a);
    if (croom.rtype !== TEMPLE) return;
    await priestini(game.u?.uz, croom, x, y, false);
    loc.altarmask |= AM_SHRINE;
    if (game.level?.flags) game.level.flags.has_temple = true;
}

// C ref: sp_lev.c create_monster() with croom != NULL — get_free_room_loc()
// (somexy), then the enexto() relocation and the inside_room() reject.
function mt4_place_monster(data, croom, peaceful) {
    const c = oracle_get_free_room_loc(croom);
    if (m_at(c.x, c.y)) {
        const cc = enexto_spawn(c.x, c.y, data);
        if (cc) { c.x = cc.x; c.y = cc.y; }
    }
    if (!inside_room(croom, c.x, c.y)) return null;
    const mtmp = make_monster(data, c.x, c.y, 0);
    if (mtmp && peaceful != null) mtmp.mpeaceful = !!peaceful;
    return mtmp;
}

// des.monster("name") / des.monster({id="name", peaceful=1}) inside a room.
function mt4_monster(name, croom, peaceful) {
    const { data, mgend } = mk_find_montype(name);   // find_montype gender roll
    oracle_induced_align();                          // sp_amask_to_amask
    const mtmp = mt4_place_monster(mk_mines_race_suppress(data), croom, peaceful);
    if (mtmp) mtmp.female = mgend;                   // create_monster: mtmp->female = m->female
    return mtmp;
}

// des.monster("G"/"f") — a monster CLASS inside a room.
function mt4_monster_class(classChar, croom, peaceful) {
    const klass = MT4_CLASS_CHAR[classChar] ?? 0;
    oracle_induced_align();                          // amask computed first
    const data = mk_mines_race_suppress(mkclass(klass, 0x0200 /* G_NOGEN */));
    return mt4_place_monster(data, croom, peaceful);
}
// monsym.h monsterclass enum: lowercase a..z are 1..26, so 'f' == S_FELINE 6;
// uppercase restarts at S_ANGEL 27, so 'G' == S_GNOME 33.
const MT4_CLASS_CHAR = { G: 33, f: 6 };

// C ref: sp_lev.c lspo_room() for a fully random top-level room.
async function mt4_room(contents) {
    const g = game;
    rn2(100);                                        // build_room chance
    const ok = create_room(-1, -1, -1, -1, -1, -1, OROOM, -1);
    if (!ok) return;
    const croom = g.level.rooms[g.level.nroom - 1];
    if (!croom) return;
    topologize(croom);
    croom.needfill = FILL_NONE;
    if (contents) await contents(croom);
    splev_add_doors_to_room(croom);
}

// Entry point.  C ref: makemaz("minetn") -> load_special("minetn-4.lua").
async function makemaz_minetown4() {
    const g = game;
    // load_special -> load_lua -> nhlib.lua prelude shuffle(align).
    const align = ['law', 'neutral', 'chaos'];
    for (let i = align.length; i >= 2; i--) {
        const j = 1 + rn2(i);
        const a = i - 1, b = j - 1;
        const t = align[a]; align[a] = align[b]; align[b] = t;
    }

    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    const was_mklev = g.in_mklev;
    g.in_mklev = true;
    if (g.level) g.level._splev_fullmon = true;
    try {
        // des.room({ type="ordinary", lit=1, x=3,y=3, xalign="center",
        //            yalign="center", w=30, h=15, contents=... })
        rn2(100);                                    // build_room chance
        const okmain = create_room(3, 3, 30, 15, 3 /*CENTER*/, 3 /*CENTER*/,
                                   OROOM, 1);
        const town = okmain ? g.level.rooms[g.level.nroom - 1] : null;
        if (town) {
            topologize(town);
            town.needfill = FILL_NONE;
            mt4_feature(town, 8, 7, FOUNTAIN);
            mt4_feature(town, 18, 7, FOUNTAIN);

            let sub;
            sub = mt4_subroom(town, 4, 2, 3, 3, 'book shop', 1);
            if (sub) { mt4_door(sub, 'closed', 'south'); splev_add_doors_to_room(sub); }

            sub = mt4_subroom(town, 8, 2, 2, 2, 'ordinary', -1);
            if (sub) { mt4_door(sub, 'closed', 'south'); splev_add_doors_to_room(sub); }

            sub = mt4_subroom(town, 11, 3, 5, 4, 'temple', 1);
            if (sub) {
                mt4_door(sub, 'closed', 'south');
                await mt4_altar(sub, 2, 1, align[0]);
                mt4_monster('gnomish wizard', sub);
                mt4_monster('gnomish wizard', sub);
                splev_add_doors_to_room(sub);
            }

            sub = mt4_subroom(town, 19, 2, 2, 2, 'ordinary', -1);
            if (sub) {
                mt4_door(sub, 'closed', 'south');
                mt4_monster_class('G', sub);
                splev_add_doors_to_room(sub);
            }

            sub = mt4_subroom(town, 22, 2, 3, 3, 'candle shop', 1);
            if (sub) { mt4_door(sub, 'closed', 'south'); splev_add_doors_to_room(sub); }

            sub = mt4_subroom(town, 26, 2, 2, 2, 'ordinary', -1);
            if (sub) {
                mt4_door(sub, 'locked', 'east');
                mt4_monster_class('G', sub);
                splev_add_doors_to_room(sub);
            }

            sub = mt4_subroom(town, 4, 10, 3, 3, 'tool shop', 1, 90);
            if (sub) { mt4_door(sub, 'closed', 'north'); splev_add_doors_to_room(sub); }

            sub = mt4_subroom(town, 8, 11, 2, 2, 'ordinary', -1);
            if (sub) {
                mt4_door(sub, 'locked', 'south');
                mt4_monster('kobold shaman', sub);
                mt4_monster('kobold shaman', sub);
                mt4_monster('kitten', sub);
                mt4_monster_class('f', sub);
                splev_add_doors_to_room(sub);
            }

            sub = mt4_subroom(town, 11, 11, 3, 2, mt4_monkfoodshop(), 1, 90);
            if (sub) { mt4_door(sub, 'closed', 'east'); splev_add_doors_to_room(sub); }

            sub = mt4_subroom(town, 17, 11, 2, 2, 'ordinary', -1);
            if (sub) { mt4_door(sub, 'closed', 'west'); splev_add_doors_to_room(sub); }

            sub = mt4_subroom(town, 20, 10, 2, 2, 'ordinary', -1);
            if (sub) {
                mt4_door(sub, 'locked', 'north');
                mt4_monster_class('G', sub);
                splev_add_doors_to_room(sub);
            }

            sub = mt4_subroom(town, 23, 10, 3, 3, 'shop', 1, 90);
            if (sub) { mt4_door(sub, 'closed', 'north'); splev_add_doors_to_room(sub); }

            for (let i = 0; i < 4; i++) mt4_monster('watchman', town, 1);
            mt4_monster('watch captain', town, 1);
            splev_add_doors_to_room(town);
        }

        // des.room({ type="ordinary", contents={ stair("up") } })
        await mt4_room(async (croom) => { await oracle_stair(croom, true); });
        // { stair("down"), trap(), monster("gnome") x2 }
        await mt4_room(async (croom) => {
            await oracle_stair(croom, false);
            await oracle_trap(croom);
            mt4_monster('gnome', croom);
            mt4_monster('gnome', croom);
        });
        // { monster("dwarf") }
        await mt4_room(async (croom) => { mt4_monster('dwarf', croom); });
        // { trap(), monster("gnome") }
        await mt4_room(async (croom) => {
            await oracle_trap(croom);
            mt4_monster('gnome', croom);
        });

        // des.random_corridors() -> create_corridor(src=-1) -> makecorridors
        makecorridors();
    } finally {
        g._full_mon_gen = was_full;
        g.in_mklev = was_mklev;
    }

    // lspo_finalize_level: wallification, then flip_level_rnd(allow_flips).
    wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                            // sp_lev.c:975
    if (rn2(2)) flp |= 2;                            // sp_lev.c:977
    if (flp) { flip_level(flp); mt4_flip_subrooms(flp); }
    set_wall_state();
}

// C ref: sp_lev.c flip_level():788-809 — the per-room loop also flips each
// croom->sbrooms[i].  js/sp_lev.js flip_level()'s `// rooms` loop walks only
// map.rooms[], so a nested shop kept its UNflipped rectangle while its door
// moved: good_shopdoor() then rejected every one and stock_room() never ran.
// BELONGS in flip_level(); kept here because minetn-4 is the only caller today
// and sp_lev.js was outside this change's write-lease.  Fold it in when a lane
// owns that file — the two loops are equivalent (every subroom on the level
// belongs to some room inside the extents).
function mt4_flip_subrooms(flp) {
    const { minx, maxx, miny, maxy } = bigrm_get_level_extends();
    for (const r of game.level?.subrooms || []) {
        if (!r) continue;
        if (flp & 1) {
            r.ly = miny + maxy - r.ly; r.hy = miny + maxy - r.hy;
            if (r.ly > r.hy) { const t = r.ly; r.ly = r.hy; r.hy = t; }
        }
        if (flp & 2) {
            r.lx = minx + maxx - r.lx; r.hx = minx + maxx - r.hx;
            if (r.lx > r.hx) { const t = r.lx; r.lx = r.hx; r.hx = t; }
        }
    }
}


// The rooms-and-corridors engine pieces the other three room-script Mine Town
// variants (minetn-2/3/7, js/levels/minetown_rooms.js) need.  They are module-
// private here and that module may not edit this file, so they travel as one
// bundle; it reads them through a namespace import, so a missing bundle makes
// those builders return false and makelevel() fall through, never throw.
export const _minetn_room_api = {
    create_room, create_subroom, topologize, makecorridors, oracle_stair,
    oracle_trap, oracle_induced_align, mk_find_montype, mk_mines_race_suppress,
    mt4_place_monster, mt4_altar, mt4_flip_subrooms,
};

// ============================================================
// dat/minetn-1.lua — Mine Town variant 1, "Orcish Town".  Unlike minetn-2/3/4/7
// (a des.room tree) or minetn-5 (a des.map over a plain solidfill), variants
// 1 and 6 run des.level_init({style="mines", ...}) themselves: the WHOLE level
// is first generated as a random smoothed/joined mines cavern (mk_mkmap, the
// same engine makemaz_minefill() above already drives), and only THEN does a
// des.map() stamp a fixed town layout over a sub-rectangle of it — every cell
// the fixed map does NOT cover (there are none inside minetn-1's box; some ring
// minetn-6's, via the 'x' "leave alone" char) keeps the random cavern terrain.
//
// C ref: dat/minetn-1.lua, mkmaze.c:1136, mkmap.c mkmap(), sp_lev.c
// create_object()/create_monster()/lspo_replace_terrain()/place_lregion().
// ============================================================

// obj.h otyps not exported by mkobj.js's named-const list (verified against
// its objects[] table rows).
const WAN_STRIKING = 417, WAN_MAGIC_MISSILE = 429;

const MINETN1_MAP = [
    '.....................................',
    '.----------------F------------------.',
    '.|.................................|.',
    '.|.-------------......------------.|.',
    '.|.|...|...|...|......|..|...|...|.|.',
    '.F.|...|...|...|......|..|...|...|.|.',
    '.|.|...|...|...|......|..|...|...|.F.',
    '.|.|...|...|----......------------.|.',
    '.|.---------.......................|.',
    '.|.................................|.',
    '.|.---------.....--...--...........|.',
    '.|.|...|...|----.|.....|.---------.|.',
    '.|.|...|...|...|.|.....|.|..|....|.|.',
    '.|.|...|...|...|.|.....|.|..|....|.|.',
    '.|.|...|...|...|.|.....|.|..|....|.|.',
    '.|.-------------.-------.---------.|.',
    '.|.................................F.',
    '.-----------F------------F----------.',
    '.....................................',
].join('\n');

// C ref: sp_lev.c lspo_teleport_region() -> levregion_add(), dir defaults to
// "both" (LR_TELE), which fixup_special() copies into BOTH svu.updest and
// svd.dndest.  `region` is level-absolute (region_islev=1); `exclude` has no
// exclude_islev so it goes through get_location() (the des.map() origin).
function mtown1_teleport_region(lx, ly, hx, hy, ex1, ey1, ex2, ey2) {
    const rgn = { lx, ly, hx, hy,
                  nlx: q_absx(ex1), nly: q_absy(ey1),
                  nhx: q_absx(ex2), nhy: q_absy(ey2) };
    game.updest = { ...rgn };
    game.dndest = { ...rgn };
}

// C ref: sp_lev.c lspo_levregion() -> levregion_add() for a "stair-up"/
// "stair-down" region -> fixup_special() -> place_lregion()/put_lregion_here().
// castle_place_stair_lregion() (below) already implements exactly this random
// placement loop for castle.lua's own stair levregions; reused verbatim.
function mtown_stair_lregion(rtype, lx, ly, hx, hy, ex1, ey1, ex2, ey2) {
    castle_place_stair_lregion({
        rtype, lx, ly, hx, hy,
        nlx: q_absx(ex1), nly: q_absy(ey1), nhx: q_absx(ex2), nhy: q_absy(ey2),
    });
}

// C ref: sp_lev.c create_object() override tail (sp_lev.c:2230-2296) — spe,
// buc (only the "uncursed" case these scripts use: unbless+uncurse, no RNG)
// and quantity are all applied to the object mksobj_at already built, AFTER
// its own internal rolls (mksobj's owt recompute at the very end means a
// quantity override needs its own weight() recompute too).  Map-relative.
function mtown1_object(otyp, mx, my, { spe = null, uncursedBuc = false,
                                       quan = null } = {}) {
    const otmp = mksobj_at(otyp, q_absx(mx), q_absy(my), true, true);
    if (spe != null) otmp.spe = spe;
    if (uncursedBuc) { unbless(otmp); uncurse(otmp); }
    if (quan != null) { otmp.quan = quan; otmp.owt = weight(otmp); }
    return otmp;
}

// des.object("boulder"/"rock") with no coordinate: random DRY spot inside the
// last des.map()'s own box (bigrm_get_location_dry, not the whole level).
function mtown1_object_random(otyp) {
    const c = bigrm_get_location_dry();
    return mksobj_at(otyp, c.x, c.y, true, true);
}

// des.object({id="corpse", montype=...}) with no coordinate.
function mtown1_corpse_random(montype) {
    const c = bigrm_get_location_dry();
    const otmp = mksobj_at(CORPSE, c.x, c.y, true, true);
    const pmidx = name_to_pmidx(montype);
    if (pmidx >= 0) set_corpsenm(otmp, pmidx);
    return otmp;
}

// selection.area(x1,y1,x2,y2) as an absolute-coordinate point Set, matching
// quest_floodfill_match()'s own key format so the two can intersect.
function mtown1_area_abs(x1, y1, x2, y2) {
    const ax1 = q_absx(x1), ay1 = q_absy(y1);
    const ax2 = q_absx(x2), ay2 = q_absy(y2);
    const s = new Set();
    for (let x = ax1; x <= ax2; x++)
        for (let y = ay1; y <= ay2; y++) s.add(x + ',' + y);
    return s;
}
function mtown1_intersect(a, b) {
    const s = new Set();
    for (const k of a) if (b.has(k)) s.add(k);
    return s;
}

// C ref: selvar.c selection_rndcoord(sel, removeit) — quest_rndcoord() (in
// sp_lev.js) always removes; minetn-1 needs both (`inside:rndcoord(1)` and
// `near_temple:rndcoord(0)`), so this is the same bounding-box scan with the
// removal made conditional.
function mtown1_rndcoord(sel, removeit) {
    const pts = [];
    let lx = COLNO, hx = -1, ly = ROWNO, hy = -1;
    for (const k of sel) {
        const [x, y] = k.split(',').map(Number);
        if (x < lx) lx = x; if (x > hx) hx = x;
        if (y < ly) ly = y; if (y > hy) hy = y;
    }
    for (let x = lx; x <= hx; x++)
        for (let y = ly; y <= hy; y++)
            if (sel.has(x + ',' + y)) pts.push([x, y]);
    if (!pts.length) return null;
    const [px, py] = pts[rn2(pts.length)];
    if (removeit) sel.delete(px + ',' + py);
    return { x: px, y: py };
}

// C ref: sp_lev.c create_monster() for a named monster at an explicit (already
// level-absolute) coordinate — the `inside`/`near_temple` selections are built
// from quest_floodfill_match()'s absolute keys, so this must NOT re-apply the
// des.map() origin offset the way splev_create_monster()'s mx/my branch does.
function mtown1_monster_abs(name, x, y, peaceful, levAdj) {
    const { data, mgend } = mk_find_montype(name);
    oracle_induced_align();
    const data2 = mk_mines_race_suppress(data);
    const c = { x, y };
    mk_enexto_if_occupied(c, data2);
    const mtmp = make_monster(data2, c.x, c.y, 0);
    if (mtmp) mtmp.female = mgend;
    if (mtmp && peaceful != null) mtmp.mpeaceful = !!peaceful;
    if (mtmp && levAdj) {                              // sp_lev.c:2168-2175
        if (mtmp.m_lev + levAdj > 49) mtmp.m_lev = 49;
        else if (mtmp.m_lev + levAdj < 0) mtmp.m_lev = 0;
        else mtmp.m_lev += levAdj;
    }
    return mtmp;
}

// Entry point.  C ref: makemaz("minetn") -> load_special("minetn-1.lua").
async function makemaz_minetown1() {
    const g = game;
    // des.level_flags("mazelevel") — overwritten to FALSE by mk_mkmap below
    // (walled&&joined always sets is_maze_lev=false, mkmap.c:481); no RNG.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({style="mines", fg=".", bg=" ", smoothed=true,
    // joined=true, walled=true}) — lit unset -> BOOL_RANDOM -> one rn2(2)
    // (sp_lev.c:3005-3006), then mkmap() (mk_mkmap always smooths+joins,
    // matching every one of its other callers).
    mk_mkmap(!!rn2(2), STONE, ROOM, true);

    // des.map([[...]]) — 37x19, bare string -> SPLEV_CENTER, lit=FALSE.
    bigrm_load_map(MINETN1_MAP, false);

    // "used to explicitly exclude the town, but that meant you couldn't
    // teleport out as well as not in" — hero can leave, never arrive inside.
    mtown1_teleport_region(1, 1, 75, 19, 1, 0, 35, 21);
    splev_region_lit(1, 1, 35, 17, 1);

    mtown_stair_lregion(LR_UPSTAIR, 1, 3, 21, 19, 0, 1, 36, 17);
    mtown_stair_lregion(LR_DOWNSTAIR, 57, 3, 75, 19, 0, 1, 36, 17);

    splev_feature(16, 9, FOUNTAIN);
    splev_feature(25, 9, FOUNTAIN);
    // "the altar's defiled ... never coaligned" — no des.region(type="temple")
    // wraps it, so vly_altar's TEMPLE_RTYPE check bails before priestini().
    vly_altar(20, 13, AM_NONE, 1);

    for (const [dx, dy] of [[5, 8], [9, 8], [13, 7], [22, 5], [27, 7], [31, 7],
                            [5, 10], [9, 10], [15, 13], [25, 13], [31, 11]])
        splev_door_at('random', dx, dy);

    // "knock a few holes in the shop interior walls" — one rn2(100) per
    // matching cell, drawn even at chance==100 (none of these are).
    lspo_replace_terrain({ totyp: ROOM, fromtyp: VWALL, chance: 18,
                           region: [7, 4, 11, 6] });
    lspo_replace_terrain({ totyp: ROOM, fromtyp: VWALL, chance: 18,
                           region: [25, 4, 29, 6] });
    lspo_replace_terrain({ totyp: ROOM, fromtyp: VWALL, chance: 18,
                           region: [7, 12, 11, 14] });
    lspo_replace_terrain({ totyp: ROOM, fromtyp: VWALL, chance: 33,
                           region: [28, 12, 28, 14] });

    // "One spot each in most shops..." shuffle(place); place[] is 1-based Lua.
    const place = shuffle([[5, 4], [9, 5], [13, 4], [26, 4], [31, 5],
                           [30, 14], [5, 14], [10, 13], [26, 14], [27, 13]]);
    const P = (i) => place[i - 1];

    g._full_mon_gen = true;
    if (g.level) g.level._splev_fullmon = true;
    try {
        // "scatter some bodies"
        splev_object_at({ otyp: CORPSE, montype: 'aligned cleric' }, 20, 12);
        for (let i = 1; i <= 5; i++)
            splev_object_at({ otyp: CORPSE, montype: 'shopkeeper' }, ...P(i));
        for (let i = 0; i < 4; i++) mtown1_corpse_random('watchman');
        mtown1_corpse_random('watch captain');

        // "Rubble!"
        const nRubble = mk_mrandom(10, 19);
        for (let i = 0; i < nRubble; i++) {
            if (mk_percent(90)) mtown1_object_random(BOULDER);
            mtown1_object_random(ROCK);
        }

        // "Guarantee 7 candles since we won't have Izchak available"
        mtown1_object(WAX_CANDLE, ...P(4), { quan: mk_mrandom(1, 2) });
        mtown1_object(WAX_CANDLE, ...P(1), { quan: mk_mrandom(2, 4) });
        mtown1_object(WAX_CANDLE, ...P(2), { quan: mk_mrandom(1, 2) });
        mtown1_object(TALLOW_CANDLE, ...P(3), { quan: mk_mrandom(1, 3) });
        mtown1_object(TALLOW_CANDLE, ...P(2), { quan: mk_mrandom(1, 2) });
        mtown1_object(TALLOW_CANDLE, ...P(4), { quan: mk_mrandom(1, 2) });

        // "leave a lamp next to one corpse ... and some empty wands..."
        mtown1_object(OIL_LAMP, ...P(2));
        mtown1_object(WAN_STRIKING, ...P(1), { uncursedBuc: true, spe: 0 });
        mtown1_object(WAN_STRIKING, ...P(3), { uncursedBuc: true, spe: 0 });
        mtown1_object(WAN_STRIKING, ...P(4), { uncursedBuc: true, spe: 0 });
        mtown1_object(WAN_MAGIC_MISSILE, ...P(4), { uncursedBuc: true, spe: 0 });
        mtown1_object(WAN_MAGIC_MISSILE, ...P(5), { uncursedBuc: true, spe: 0 });

        // "the Orcish Army"
        const inside = quest_floodfill_match(18, 8);
        const near_temple = mtown1_intersect(mtown1_area_abs(17, 8, 23, 14),
                                             inside);

        const nArmy = mk_mrandom(5, 15);
        for (let i = 0; i < nArmy; i++) {
            let name;
            if (mk_percent(50)) name = 'orc-captain';
            else name = mk_percent(80) ? 'Uruk-hai' : 'Mordor orc';
            const c = mtown1_rndcoord(inside, true);
            if (c) mtown1_monster_abs(name, c.x, c.y, false);
        }
        // "shamans can be hanging out in/near the temple; one ... is higher
        // level" — m_lev_adj=3 on the FIRST shaman only.
        const nShaman = mk_mrandom(1, 6);
        for (let i = 0; i < nShaman; i++) {
            const c = mtown1_rndcoord(near_temple, false);
            if (c) mtown1_monster_abs('orc shaman', c.x, c.y, false,
                                      (i === 0) ? 3 : 0);
        }
        // "not such a big deal to run into outside the bars" — random
        // position inside the town's own box, not restricted to `inside`.
        const nRabble = mk_mrandom(10, 19);
        for (let i = 0; i < nRabble; i++) {
            if (mk_percent(90)) splev_create_monster({ name: 'hill orc', peaceful: 0 });
            else splev_create_monster({ name: 'goblin', peaceful: 0 });
        }
    } finally {
        g._full_mon_gen = false;
    }

    // "Hack to force full-level wallification" — des.wallify() with no args
    // is scoped to (xstart-1..xstart+xsize+1, ystart-1..ystart+ysize+1)
    // (sp_lev.c:5983-5986), not the whole level.  The box has no leftover
    // STONE (every cell inside it was map-drawn) and the border strip was
    // already wallified by mk_mkmap's own full-level finish_map(), so this is
    // a faithful no-op — kept for completeness (it draws no RNG either way).
    {
        const o = splev_map_origin();
        mk_wallify_map(o.xstart - 1, o.ystart - 1,
                       o.xstart + o.xsize + 1, o.ystart + o.ysize + 1);
    }

    // lspo_finalize_level(): link_doors_rooms, remove_boundary_syms,
    // wallification (!corrmaze), flip_level_rnd(allow_flips=3).  No branch
    // levregion is registered for Mine Town (the Mines branch sits on the
    // main-dungeon side), so fixup_special() places nothing here.
    splev_link_doors_rooms();
    remove_boundary_syms();
    wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;
    if (rn2(2)) flp |= 2;
    if (flp) flip_level(flp);
    set_wall_state();
}

// ============================================================
// dat/minetn-6.lua — Mine Town variant 6, "Bustling Town" by Kelly Bailey.
// Same mines-cavern-then-map-overlay shape as minetn-1 above, but bg="-"
// (HWALL) instead of bg=" " (STONE): the untouched cavern displays as solid
// wall rather than unlit rock, which is what the .lua's own comment says the
// "inaccessibles" level flag is there to compensate for ("creating backdoors
// into adjacent shops which we don't want").  That repair pass — C's
// ensure_way_out(), a floodfill accessibility check that digs a corridor when
// (and only when) the random cavern actually left a pocket unreachable — is
// NOT ported; it only draws RNG in that unreachable-pocket case, which the
// des.map overlay's own doors make rare.  See RECON_NOTES.md.
// ============================================================

const MINETN6_MAP = [
    'x--------xxxxxxxxxxx-------------------x',
    'x------xxxxxxxxxxxxxx-----------------xx',
    '.-----................----------------.x',
    '.|...|................|...|..|...|...|..',
    '.|...+..--+--.........|...|..|...|...|..',
    '.|...|..|...|..-----..|...|..|-+---+--..',
    '.-----..|...|--|...|..--+---+-.........x',
    '........|...|..|...+.............-----.x',
    '........-----..|...|......--+-...|...|..',
    'x----...|...|+------..{...|..|...+...|..',
    'x|..+...|...|.............|..|...|...|..',
    '.|..|...|...|-+-.....---+-------------.x',
    '.----...--+--..|..-+-|..................',
    '...|........|..|..|..|----....--------.x',
    '...|..T.....----..|..|...+....|......|..',
    '...|-....{........|..|...|....+......|x.',
    '...--..-....T.....--------....|......|x.',
    '.......--.....................----------',
    '.xxxx-----xxxxxxxxxxxxxxxxxx------------',
    'xxxx-------xxxxxxxxxxxxxxx--------------',
].join('\n');

// align.h AM_LAWFUL/AM_NEUTRAL/AM_CHAOTIC bit values (matches minetown5.js's
// own MINETN_ALIGN_AMASK — Align2amask() takes an alignment TYPE, not a name).
const MT6_ALIGN_AMASK = { law: 0x04, neutral: 0x02, chaos: 0x01 };

// C ref: dat/nhlib.lua:47 monkfoodshop() — role-dependent, no RNG.
function mtown6_monkfoodshop() {
    const rl = roles[game.initrole];
    return (rl && rl.name && rl.name.m === 'Monk') ? SHOPBASE + 10
                                                    : SHOPBASE + 5;
}

// Entry point.  C ref: makemaz("minetn") -> load_special("minetn-6.lua").
async function makemaz_minetown6() {
    const g = game;
    // des.level_init({style="solidfill", fg=" "}) — draws one rn2(2) (lit);
    // fully overwritten by the mines-style init below (sp_lev.c:2990-2993),
    // so only the draw itself matters.
    rn2(2);
    // des.level_flags("mazelevel","inaccessibles") — is_maze_lev is set here
    // but overwritten to FALSE by mk_mkmap (walled&&joined, mkmap.c:481);
    // check_inaccessibles isn't tracked since ensure_way_out() isn't ported.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({style="mines", fg=".", bg="-", smoothed=true,
    // joined=true, lit=1, walled=true}) — lit is explicit, no rn2 draw.
    mk_mkmap(true, HWALL, ROOM, true);

    // des.map({halign="center", valign="top", map=[[...]]}) — 41x20; 'x'
    // cells leave the mines cavern above untouched.
    hf_map({ map: MINETN6_MAP, halign: 'center', valign: 'top', lit: false });

    const align = shuffle(['law', 'neutral', 'chaos']);

    splev_region_lit(0, 0, 39, 19, 1);

    mtown_stair_lregion(LR_UPSTAIR, 1, 3, 21, 19, 1, 0, 39, 18);
    mtown_stair_lregion(LR_DOWNSTAIR, 60, 3, 75, 19, 0, 0, 38, 18);

    splev_region_lit(13, 7, 14, 8, 0);
    vly_region(9, 9, 11, 11, 1, SHOPBASE + 11, FILL_NORMAL, false);   // candle
    vly_region(16, 6, 18, 8, 1, SHOPBASE + 8, FILL_NORMAL, false);    // tool
    vly_region(23, 3, 25, 5, 1, SHOPBASE, FILL_NORMAL, false);        // shop
    vly_region(22, 14, 24, 15, 1, mtown6_monkfoodshop(), FILL_NORMAL, false);
    vly_region(31, 14, 36, 16, 1, TEMPLE, FILL_NORMAL, false);
    vly_altar(35, 15, MT6_ALIGN_AMASK[align[0]], 1);

    for (const [dst, dx, dy] of [
        ['closed', 5, 4], ['locked', 4, 10], ['closed', 10, 4],
        ['closed', 10, 12], ['locked', 13, 9], ['locked', 14, 11],
        ['closed', 19, 7], ['closed', 19, 12], ['closed', 24, 6],
        ['closed', 24, 11], ['closed', 25, 14], ['closed', 28, 6],
        ['locked', 28, 8], ['closed', 30, 15], ['closed', 31, 5],
        ['closed', 35, 5], ['closed', 33, 9],
    ]) splev_door_at(dst, dx, dy);

    g._full_mon_gen = true;
    if (g.level) g.level._splev_fullmon = true;
    try {
        for (let i = 0; i < 6; i++) splev_create_monster({ name: 'gnome' });
        splev_create_monster({ name: 'gnome', mx: 14, my: 8 });
        splev_create_monster({ name: 'gnome lord', mx: 14, my: 7 });
        splev_create_monster({ name: 'gnome', mx: 27, my: 10 });
        splev_create_monster({ name: 'gnome lord' });
        splev_create_monster({ name: 'gnome lord' });
        for (let i = 0; i < 3; i++) splev_create_monster({ name: 'dwarf' });
        for (let i = 0; i < 2; i++)
            splev_create_monster({ name: 'dwarf', peaceful: 1 });
        for (let i = 0; i < 2; i++)
            splev_create_monster({ name: 'gnome', peaceful: 1 });
        splev_create_monster({ name: 'hobbit', peaceful: 1 });
        splev_create_monster({ name: 'goblin', peaceful: 1 });
        splev_create_monster({ name: 'kobold', peaceful: 1 });
        splev_create_monster({ name: 'dog', peaceful: 1 });
        for (let i = 0; i < 3; i++)
            splev_create_monster({ name: 'watchman', peaceful: 1 });
        for (let i = 0; i < 2; i++)
            splev_create_monster({ name: 'watch captain', peaceful: 1 });
    } finally {
        g._full_mon_gen = false;
    }

    // lspo_finalize_level() — see makemaz_minetown1's identical tail comment.
    // minetn-6.lua has no trailing des.wallify() call of its own.
    splev_link_doors_rooms();
    remove_boundary_syms();
    wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;
    if (rn2(2)) flp |= 2;
    if (flp) flip_level(flp);
    set_wall_state();
}


// ============================================================
// dat/hellfill.lua — the "fill" level for Gehennom: every Gehennom dlvl that
// is not one of the ~9 named specials (valley/sanctum/juiblex/baalz/asmodeus/
// wizard1-3) routes here via svd.dungeons[dnum].fill_lvl.
//
// C ref: dat/hellfill.lua + dat/nhlib.lua (hell_tweaks, percent, shuffle),
// executed by the des.* engine in src/sp_lev.c, on top of src/mkmaze.c
// (create_maze/walkfrom), src/mkmap.c (mkmap) and src/selvar.c (selections).
//
// The .lua picks one of 7 "hells" styles uniformly and runs it, then places
// the stairs (or the vibrating square on the invocation level) and finally
// populatemaze()'s object/monster/gold/trap budget.
// ============================================================

// C ref: sp_lev.c get_location() with croom == NULL — a des.* coordinate is
// relative to the last des.map() origin (gx.xstart / gy.ystart), which is
// (1, 0) at a level script's top level.
function hf_loc(x, y) {
    const o = splev_map_origin();
    return { x: x + o.xstart, y: y + o.ystart };
}

// C ref: nhlsel.c l_selection_fillrect / l_selection_rect — both run their
// corner coordinates through get_location_coord() first.
function hf_sel_area(x1, y1, x2, y2) {
    const a = hf_loc(x1, y1), b = hf_loc(x2, y2);
    return l_selection_fillrect(null, a.x, a.y, b.x, b.y);
}
function hf_sel_rect(x1, y1, x2, y2) {
    const a = hf_loc(x1, y1), b = hf_loc(x2, y2);
    return l_selection_rect(null, a.x, a.y, b.x, b.y);
}

// C ref: sp_lev.c lspo_terrain() — des.terrain(selection, "X") and
// des.terrain({selection=..., typ="X", lit=N}).  No RNG.
function hf_terrain_sel(sel, typ, tolit = SET_LIT_NOCHANGE) {
    selection_iterate(sel, (x, y) => set_levltyp_lit(x, y, typ, tolit));
}

// C ref: sp_lev.c lspo_terrain() 3-argument form des.terrain(x, y, "X") — the
// coordinate goes through get_location_coord(), so it is map-origin relative.
function hf_terrain_at(x, y, typ) {
    const c = hf_loc(x, y);
    set_levltyp_lit(c.x, c.y, typ, SET_LIT_NOCHANGE);
}

// C ref: sp_lev.c lspo_replace_terrain().  One rn2(100) per cell that matches
// `fromtyp` / the map fragment — the roll happens even at chance == 100.
// With neither region nor selection given the scan covers the whole map.
function hf_replace_terrain({ totyp, fromtyp = INVALID_TYPE, mapfragstr = null,
                              chance = 100, tolit = SET_LIT_NOCHANGE,
                              region = null, sel: selIn = null }) {
    const mf = (fromtyp === INVALID_TYPE && mapfragstr != null)
        ? mapfrag_fromstr(mapfragstr) : null;

    let sel = selIn;
    if (!sel) {
        sel = selection_new();
        if (!region) {
            selection_clear(sel, 1);
        } else {
            const a = hf_loc(region[0], region[1]);
            const b = hf_loc(region[2], region[3]);
            for (let x = Math.max(a.x, 0); x <= Math.min(b.x, COLNO - 1); x++)
                for (let y = Math.max(a.y, 0); y <= Math.min(b.y, ROWNO - 1); y++)
                    selection_setpoint(x, y, sel, 1);
        }
    }

    const rect = selection_getbounds(sel);
    for (let x = Math.max(1, rect.lx); x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++) {
            if (!selection_getpoint(x, y, sel)) continue;
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (mf) {
                if (mapfrag_match(mf, x, y) && rn2(100) < chance)
                    set_levltyp_lit(x, y, totyp, tolit);
            } else if (((fromtyp === MATCH_WALL && IS_STWALL(loc.typ))
                        || loc.typ === fromtyp)
                       && rn2(100) < chance) {
                set_levltyp_lit(x, y, totyp, tolit);
            }
        }
}

// C ref: sp_lev.c lvlfill_solid() — des.level_init({style="solidfill"}).
function hf_lvlfill_solid(filling, lit) {
    for (let x = 2; x <= mz.x_maze_max; x++)
        for (let y = 0; y <= mz.y_maze_max; y++) {
            if (!set_levltyp_lit(x, y, filling, lit)) continue;
            const loc = game.level.at(x, y);
            loc.flags = 0;
            loc.horizontal = false;
            loc.roomno = 0;
            loc.edge = false;
        }
}

// C ref: sp_lev.c lvlfill_maze_grid() — des.level_init({style="mazegrid"}).
function hf_lvlfill_maze_grid(x1, y1, x2, y2, filling) {
    const corrmaze = !!game.level?.flags?.corrmaze;
    for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++) {
            const loc = game.level.at(x, y);
            if (!loc) continue;
            loc.typ = corrmaze ? STONE
                : ((y < 2 || ((x % 2) && (y % 2))) ? STONE : filling);
        }
}

// C ref: sp_lev.c lspo_mazewalk().  hellfill's only call passes an explicit
// direction and stocked=false, so neither random_wdir() nor fill_empty_maze()
// runs; the RNG cost is entirely walkfrom()'s.
function hf_mazewalk(mx, my, dir, ftyp) {
    const c = hf_loc(mx, my);
    let x = c.x, y = c.y;
    if (!isok(x, y)) return;
    if (ftyp == null || ftyp < 1)
        ftyp = game.level?.flags?.corrmaze ? CORR : ROOM;

    switch (dir) {
    case W_NORTH: y--; break;
    case W_SOUTH: y++; break;
    case W_EAST: x++; break;
    case W_WEST: x--; break;
    default: break;
    }

    let loc = game.level?.at(x, y);
    if (loc && !IS_DOOR(loc.typ)) { loc.typ = ftyp; loc.flags = 0; }

    // walkfrom() needs odd parity, biased away from the entry direction.
    if (!(x % 2)) {
        x += (dir === W_EAST) ? 1 : -1;
        loc = game.level?.at(x, y);
        if (loc) { loc.typ = ftyp; loc.flags = 0; }
    }
    if (!(y % 2)) y += (dir === W_SOUTH) ? 1 : -1;

    walkfrom(x, y, ftyp);
}

// C ref: include/defsym.h MONSYM() — monster class letter -> S_* index, used
// by des.monster("X") to pick a class rather than a species.
const HF_MONSYM = {
    a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10,
    k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17, r: 18, s: 19, t: 20,
    u: 21, v: 22, w: 23, x: 24, y: 25, z: 26,
    A: 27, B: 28, C: 29, D: 30, E: 31, F: 32, G: 33, H: 34, I: 35, J: 36,
    K: 37, L: 38, M: 39, N: 40, O: 41, P: 42, Q: 43, R: 44, S: 45, T: 46,
    U: 47, V: 48, W: 49, X: 50, Y: 51, Z: 52,
    '@': 53, ' ': 54, "'": 55, '&': 56, ';': 57, ':': 58, '~': 59, ']': 60,
};

// des.monster("X", x, y) — a monster CLASS at a fixed (map-relative) spot.
// C ref: sp_lev.c create_monster(): induced_align first, then mkclass, then
// the location, then makemon.
function hf_monster_class_at(classChar, x, y, peacefulOverride) {
    oracle_induced_align();
    const data = mkclass(HF_MONSYM[classChar] ?? 0, 0x0200 /* G_NOGEN */);
    const c = hf_loc(x, y);
    const mtmp = make_monster(data, c.x, c.y, 0);
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    return mtmp;
}

// des.monster("name", x, y) — a named species at a fixed (map-relative) spot.
function hf_monster_named_at(name, x, y, peacefulOverride) {
    const { data, mgend } = mk_find_montype(name);
    oracle_induced_align();
    const c = hf_loc(x, y);
    const mtmp = make_monster(data, c.x, c.y, 0);
    if (mtmp) mtmp.female = mgend;                   // create_monster: mtmp->female = m->female
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    return mtmp;
}

function hf_monster_at(spec, x, y, peacefulOverride) {
    if (spec.length === 1) return hf_monster_class_at(spec, x, y, peacefulOverride);
    return hf_monster_named_at(spec, x, y, peacefulOverride);
}

// des.object("boulder", x, y) — a named object at a fixed (map-relative) spot.
function hf_object_at(objId, x, y) {
    const c = hf_loc(x, y);
    return mksobj_at(objId, c.x, c.y, true, true);
}

// des.gold() with neither amount nor coord: DRY random location FIRST, then
// rnd(200) for the amount (C ref: lspo_gold's call order).
function mk_gold() {
    const c = mk_get_location_random(mk_ok_dry);
    mkgold(rnd(200), c.x, c.y);
}

// des.monster({peaceful=...}) with neither class nor id: a fully random
// monster.  C ref: sp_lev.c create_monster() — amask (induced_align rn2(3))
// is computed FIRST regardless of class/id, then (pm == NULL) the location is
// picked DRY, then makemon(NULL, ...) chooses the species.
function mk_monster_random(peacefulOverride) {
    oracle_induced_align();
    const c = mk_get_location_random(mk_ok_dry);
    const mtmp = make_monster(null, c.x, c.y, 0);
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    return mtmp;
}

// ── nhlib.lua hell_tweaks(protected_area) ────────────────────────────────
// Random lava pools, a lava river, and wall-to-boulder / wall-to-iron-bars
// substitutions.  Shared by hellfill style 2 and several named Gehennom
// levels (asmodeus/orcus/wizard1-3/fakewiz1-2).
function hf_hell_tweaks(protected_area) {
    const liquid = LAVAPOOL, ground = ROOM;
    const n_prot = selection_numpoints(protected_area);
    const prot = l_selection_negate(protected_area);
    const depth = depth_of_level(game.u?.uz);

    // random pools
    if (mk_percent(20 + depth)) {
        let pools = selection_new();
        const maxpools = 5 + mk_mrandom(1, depth);
        for (let i = 0; i < maxpools; i++) hf_sel_set_random(pools);
        pools = l_selection_or(pools,
            l_selection_grow(hf_sel_set_random(selection_new()), W_WEST));
        pools = l_selection_or(pools,
            l_selection_grow(hf_sel_set_random(selection_new()), W_NORTH));
        pools = l_selection_or(pools,
            l_selection_grow(hf_sel_set_random(selection_new()), W_RANDOM));
        pools = l_selection_and(pools, prot);

        if (mk_percent(80)) {
            const poolground = l_selection_and(
                l_selection_grow(selection_clone(pools), W_ANY), prot);
            const pval = mk_mrandom(1, 8) * 10;
            hf_terrain_sel(selection_filter_percent(poolground, pval), ground);
        }
        hf_terrain_sel(pools, liquid);
    }

    // river
    if (mk_percent(50)) {
        let allrivers = selection_new();
        const reqpts = ((COLNO * ROWNO) - n_prot) / 12;
        let rpts = 0, rivertries = 0;
        do {
            const floor = selection_match('.');
            const a = hf_rndcoord(floor);
            const b = hf_rndcoord(floor);
            const ca = hf_loc(a.x, a.y), cb = hf_loc(b.x, b.y);
            let lavariver = l_selection_randline(selection_new(),
                                                 ca.x, ca.y, cb.x, cb.y, 10);
            if (mk_percent(50)) lavariver = l_selection_grow(lavariver, W_NORTH);
            if (mk_percent(50)) lavariver = l_selection_grow(lavariver, W_WEST);
            allrivers = l_selection_or(allrivers, lavariver);
            allrivers = l_selection_and(allrivers, prot);
            rpts = selection_numpoints(allrivers);
            rivertries++;
        } while (!(rpts > reqpts || rivertries > 7));

        if (mk_percent(60)) {
            const prc = 10 * mk_mrandom(1, 6);
            let riverbanks = l_selection_grow(allrivers, W_ANY);
            riverbanks = l_selection_and(riverbanks, prot);
            hf_terrain_sel(selection_filter_percent(riverbanks, prc), ground);
        }
        hf_terrain_sel(allrivers, liquid);
    }

    // replacing some walls with boulders
    if (mk_percent(20)) {
        const amount = 3 * mk_mrandom(1, 8);
        let bwalls = l_selection_or(
            selection_filter_percent(selection_match('.w.'), amount),
            selection_filter_percent(selection_match('.\nw\n.'), amount));
        bwalls = l_selection_and(bwalls, prot);
        // C ref: nhlsel.c l_selection_iterate() — the callback gets MAP-RELATIVE
        // coordinates (cvt_to_relcoord), which des.terrain()/des.object() then
        // run back through get_location_coord(), so the boulder lands on the
        // wall square that was selected.  The walk is y-outer / x-inner, which
        // fixes the order the boulders are created in (and thus their o_ids).
        const pts = [];
        l_selection_iterate(bwalls, splev_map_origin(),
                            (x, y) => pts.push({ x, y }));
        for (const p of pts) {
            hf_terrain_at(p.x, p.y, ROOM);
            hf_object_at(BOULDER, p.x, p.y);
        }
    }

    // replacing some walls with iron bars
    if (mk_percent(20)) {
        const amount = 3 * mk_mrandom(1, 8);
        let fwalls = l_selection_or(
            selection_filter_percent(selection_match('.w.'), amount),
            selection_filter_percent(selection_match('.\nw\n.'), amount));
        fwalls = l_selection_and(l_selection_grow(fwalls, W_ANY),
                                 selection_match('w'));
        fwalls = l_selection_and(fwalls, prot);
        hf_terrain_sel(fwalls, IRONBARS);
    }
}

// C ref: nhlsel.c l_selection_setpoint() called as sel:set() — a random
// ANY_LOC spot, i.e. two rn2 draws against the current map origin/size.
function hf_sel_set_random(sel) {
    const o = splev_map_origin();
    const x = o.xstart + rn2(o.xsize);
    const y = o.ystart + rn2(o.ysize);
    selection_setpoint(x, y, sel, 1);
    return sel;
}

// C ref: nhlsel.c l_selection_rndcoord() — the returned coordinate is made
// map-origin RELATIVE before it goes back to Lua.
function hf_rndcoord(sel) {
    const c = selection_rndcoord(sel, false);
    if (c.x === -1 && c.y === -1) return c;
    const o = splev_map_origin();
    return { x: c.x - o.xstart, y: c.y - o.ystart };
}

// ── hell prefabs (hellfill.lua hell_prefabs[]) ───────────────────────────

// rnd_halign()/rnd_valign(): one math.random(1,3) each.
const HF_HALIGNS = ['half-left', 'center', 'half-right'];
const HF_VALIGNS = ['top', 'center', 'bottom'];
function hf_rnd_halign() { return HF_HALIGNS[mk_mrandom(1, 3) - 1]; }
function hf_rnd_valign() { return HF_VALIGNS[mk_mrandom(1, 3) - 1]; }

const HF_PREFAB1_MAP = Array(16).fill('......').join('\n');

const HF_PREFAB2_MAP = [
    'xxxxxx.....xxxxxx',
    'xxxx.........xxxx',
    'xx.............xx',
    'xx.............xx',
    'x...............x',
    'x...............x',
    '.................',
    '.................',
    '.................',
    '.................',
    '.................',
    'x...............x',
    'x...............x',
    'xx.............xx',
    'xx.............xx',
    'xxxx.........xxxx',
    'xxxxxx.....xxxxxx',
].join('\n');

const HF_PREFAB3_MAP = [
    'xxxxxx.xxxxxx',
    'xLLLLLLLLLLLx',
    'xL---------Lx',
    'xL|.......|Lx',
    'xL|.......|Lx',
    '.L|.......|L.',
    'xL|.......|Lx',
    'xL|.......|Lx',
    'xL---------Lx',
    'xLLLLLLLLLLLx',
    'xxxxxx.xxxxxx',
].join('\n');

const HF_PREFAB4_MAP = Array(5).fill('.'.repeat(62)).join('\n');

const HF_PREFAB5_MAP = [
    'x.....x', '.......', '.......', '.......', '.......', '.......', 'x.....x',
].join('\n');

const HF_PREFAB6_MAP = [
    'BBBBBBB', 'B.....B', 'B.....B', 'B.....B', 'B.....B', 'B.....B', 'BBBBBBB',
].join('\n');

const HF_PREFAB7_MAP = [
    '..........', '..........', '..........', '...FFFF...', '...F..F...',
    '...F..F...', '...FFFF...', '..........', '..........', '..........',
].join('\n');

const HF_PREFAB8_MAP = [
    '.........',
    '.}}}}}}}.',
    '.}}---}}.',
    '.}--.--}.',
    '.}|...|}.',
    '.}--.--}.',
    '.}}---}}.',
    '.}}}}}}}.',
    '.........',
].join('\n');

const HF_PREFAB9_LAVA = ['.....', '.LLL.', '.LZL.', '.LLL.', '.....'].join('\n');
const HF_PREFAB9_WATER = ['.....', '.PPP.', '.PWP.', '.PPP.', '.....'].join('\n');
const HF_PREFAB10_MAP = Array(17).fill('...').join('\n');

// A des.map() call from inside a hell prefab: never a themeroom, so C's
// "never overwrite anything" retry check does not apply.
function hf_map(opts) {
    return lspo_map({ ...opts, in_themerooms: false });
}

// hell_prefabs[3] — the lava-moated inner keep with drawbridges.
function hf_prefab_keep(coldhell) {
    const halign = hf_rnd_halign(), valign = hf_rnd_valign();
    hf_map({
        halign, valign, map: HF_PREFAB3_MAP,
        contents: () => {
            set_wallprop_selection(hf_sel_area(2, 2, 10, 8), W_NONDIGGABLE);
            hf_region_lit(hf_sel_area(4, 4, 8, 6));
            hf_exclusion('teleport', 2, 2, 10, 8);
            if (coldhell) {
                hf_replace_terrain({ region: [1, 1, 11, 9],
                                     fromtyp: LAVAPOOL, totyp: POOL });
            }
            const dblocs = [
                { x: 1, y: 5, dir: 'east' }, { x: 11, y: 5, dir: 'west' },
                { x: 6, y: 1, dir: 'south' }, { x: 6, y: 9, dir: 'north' },
            ];
            shuffle(dblocs);
            const nbridge = mk_mrandom(1, dblocs.length);
            for (let i = 0; i < nbridge; i++) hf_drawbridge(dblocs[i]);
            const mons = ['H', 'T', '@'];
            shuffle(mons);
            const nmon = 3 + mk_mrandom(1, 5);
            for (let i = 0; i < nmon; i++) hf_monster_at(mons[0], 6, 5);
        },
    });
}

// hell_prefabs[6] — Moloch's little shrine.
function hf_prefab_shrine() {
    const halign = hf_rnd_halign(), valign = hf_rnd_valign();
    hf_map({
        halign, valign, map: HF_PREFAB6_MAP,
        contents: () => {
            lspo_region({ region: [2, 2, 2, 2], type: 'temple',
                          filled: 1, irregular: true });
            const shrine = mk_percent(75) ? 0 : 1;   // "altar" or "shrine"
            hf_altar(3, 3, shrine);
        },
    });
}

// hell_prefabs[7] — an iron-barred cell with one big monster inside.
function hf_prefab_cage() {
    const halign = hf_rnd_halign(), valign = hf_rnd_valign();
    hf_map({
        halign, valign, map: HF_PREFAB7_MAP,
        contents: () => {
            hf_exclusion('teleport', 4, 4, 5, 5);
            const mons = ['Angel', 'D', 'H', 'L'];
            hf_monster_at(mons[mk_mrandom(1, mons.length) - 1], 4, 4);
        },
    });
}

// hell_prefabs[8] — a moated vault with a lich in it.
function hf_prefab_moat() {
    const halign = hf_rnd_halign(), valign = hf_rnd_valign();
    hf_map({
        halign, valign, map: HF_PREFAB8_MAP,
        contents: () => {
            hf_exclusion('teleport', 3, 3, 5, 5);
            hf_monster_at('L', 4, 4);
        },
    });
}

// hell_prefabs[9] — five little lava (or water) pockets across the level.
function hf_prefab_pockets() {
    const mapstr = mk_percent(30) ? HF_PREFAB9_LAVA : HF_PREFAB9_WATER;
    for (let dx = 1; dx <= 5; dx++)
        hf_map({ x: dx * 14 - 4, y: mk_mrandom(3, 15), map: mapstr,
                 contents: () => {} });
}

// hell_prefabs[10] — three tall 3-wide open shafts.
function hf_prefab_shafts() {
    for (let dx = 1; dx <= 3; dx++)
        hf_map({ x: mk_mrandom(3, 75), y: 3, map: HF_PREFAB10_MAP,
                 contents: () => {} });
}

// The hell_prefabs[] table itself.  `repeatable` entries can be stamped more
// than once; plain functions always end the loop.
const HF_PREFABS = [
    { repeatable: true, contents: () => hf_map({
        halign: hf_rnd_halign(), valign: 'center', map: HF_PREFAB1_MAP,
        contents: () => {} }) },
    { repeatable: true, contents: () => hf_map({
        halign: hf_rnd_halign(), valign: 'center', map: HF_PREFAB2_MAP,
        contents: () => {} }) },
    hf_prefab_keep,
    { repeatable: true, contents: () => hf_map({
        halign: 'center', valign: 'center', map: HF_PREFAB4_MAP,
        contents: () => {} }) },
    { repeatable: true, contents: () => hf_map({
        halign: hf_rnd_halign(), valign: hf_rnd_valign(), lit: true,
        map: HF_PREFAB5_MAP, contents: () => {} }) },
    hf_prefab_shrine,
    hf_prefab_cage,
    hf_prefab_moat,
    hf_prefab_pockets,
    { repeatable: true, contents: hf_prefab_shafts },
];

// C ref: dat/hellfill.lua rnd_hell_prefab().
function hf_rnd_hell_prefab(coldhell) {
    let dorepeat = true;
    let nloops = 0;
    do {
        nloops++;
        const pf = mk_mrandom(1, HF_PREFABS.length);
        const fab = HF_PREFABS[pf - 1];
        if (typeof fab === 'function') {
            fab(coldhell);
            dorepeat = false;
        } else {
            fab.contents(coldhell);
            dorepeat = !(fab.repeatable && mk_mrandom(0, nloops * 2) === 0);
        }
    } while (!(!dorepeat || nloops > 5));
}

// ── the 7 hells[] styles ─────────────────────────────────────────────────
//
// Every style opens with the same two statements:
//   des.level_init({ style = "solidfill", fg = " ", lit = 0 });
//   des.level_flags("mazelevel", "noflip");
// `lit = 0` is explicit, so SOLIDFILL draws NO rn2(2) here (unlike minefill's
// implicit BOOL_RANDOM).  "noflip" only clears coder->allow_flips.
function hf_style_prologue(...flags) {
    hf_lvlfill_solid(STONE, 0);
    const lf = game.level.flags;
    for (const f of flags) {
        if (f === 'mazelevel') lf.is_maze_lev = true;
        else if (f === 'cold') lf.temperature = -1;
    }
}

// hells[1]: "mines"-style cavern flooded with lava.
function hf_style_mines_lava() {
    hf_style_prologue('mazelevel');
    // MINES: lit=0 explicit (no roll); filling defaults to fg (".") so the map
    // is pre-filled with floor, then mkmap() re-initialises it from bg anyway.
    hf_lvlfill_solid(ROOM, 0);
    mk_mkmap(false, STONE, ROOM, true);
    hf_replace_terrain({ fromtyp: STONE, totyp: LAVAPOOL });
    hf_replace_terrain({ fromtyp: ROOM, totyp: LAVAPOOL, chance: 5 });
    hf_replace_terrain({ mapfragstr: 'w', totyp: LAVAPOOL, chance: 20 });
    hf_replace_terrain({ mapfragstr: 'w', totyp: ROOM, chance: 15 });
}

// hells[2]: a mazegrid walked east from the left edge, then hell_tweaks().
function hf_style_mazegrid_tweaks() {
    hf_style_prologue('mazelevel');
    hf_lvlfill_maze_grid(2, 0, mz.x_maze_max, mz.y_maze_max, HWALL);
    hf_mazewalk(1, 10, W_EAST, ROOM);
    const tmpbounds = selection_match('-');
    const bnds = selection_getbounds(tmpbounds);
    // NOTE: bnds is already absolute, and selection.fillrect() adds the map
    // origin again — reproduced verbatim (hf_sel_area does the same shift).
    const protected_area = hf_sel_area(bnds.lx, bnds.ly + 1,
                                       bnds.hx - 2, bnds.hy - 1);
    hf_hell_tweaks(l_selection_negate(protected_area));
    if (mk_percent(25)) hf_rnd_hell_prefab(false);
}

// hells[3]: plain maze, wall thickness 1, random corridor width.
function hf_style_plain_maze() {
    hf_style_prologue('mazelevel');
    create_maze(-1, 1, false);
}

// hells[4]: maze whose walls become iron bars or lava.
function hf_style_bars_or_lava_maze() {
    const cwid = mk_mrandom(1, 4);
    hf_style_prologue('mazelevel');
    create_maze(cwid, 1, false);
    const outside_walls = selection_match(' ');
    const wallterrain = ['F', 'L'];
    shuffle(wallterrain);
    const wt = wallterrain[0] === 'F' ? IRONBARS : LAVAPOOL;
    hf_replace_terrain({ mapfragstr: 'w', totyp: wt });
    if (cwid === 1) {
        if (wallterrain[0] === 'F' && mk_percent(80)) {
            // knock holes in some horizontal iron-bar walls
            hf_replace_terrain({ mapfragstr: '.\nF\n.', totyp: ROOM,
                                 chance: 25 * mk_mrandom(1, 4) });
        } else if (mk_percent(25)) {
            hf_rnd_hell_prefab(false);
        }
    }
    hf_terrain_sel(outside_walls, STONE);   // return the outside to solid wall
}

// hells[5]: thick-walled maze, sometimes with lava walls and lava-wall blocks.
function hf_style_thick_maze() {
    const wwid = 1 + mk_mrandom(1, 2);
    hf_style_prologue('mazelevel');
    create_maze(mk_mrandom(1, 2), wwid, false);
    if (mk_percent(50)) {
        const outside_walls = selection_match(' ');
        hf_replace_terrain({ mapfragstr: 'w', totyp: LAVAPOOL });
        hf_terrain_sel(outside_walls, STONE);
        if (wwid === 3 && mk_percent(40)) {
            const sel = selection_match('LLL\nLLL\nLLL');
            hf_terrain_sel(selection_filter_percent(sel, 30 * mk_mrandom(1, 4)),
                           LAVAWALL);
        }
    }
}

// hells[6]: the cold maze — ice, water walls and a few pools.
function hf_style_cold_maze() {
    const cwid = mk_mrandom(1, 4);
    hf_style_prologue('mazelevel', 'cold');
    create_maze(cwid, 1, false);
    const outside_walls = selection_match(' ');
    const icey = selection_filter_mapchar(
        l_selection_grow(selection_filter_percent(l_selection_negate(null), 10),
                         W_ANY),
        ROOM);
    hf_terrain_sel(icey, ICE);
    if (cwid > 1) hf_terrain_sel(selection_filter_percent(icey, 1), WATER);
    hf_terrain_sel(selection_filter_percent(icey, 5), POOL);
    if (mk_percent(25)) hf_terrain_sel(selection_match('w'), WATER);
    if (cwid === 1 && mk_percent(25)) hf_rnd_hell_prefab(true);
    hf_terrain_sel(outside_walls, STONE);
}

// hells[7]: open cavern — "mines" with wider corridors; walls stone or lava.
function hf_style_open_cavern() {
    const wter = mk_percent(50) ? STONE : LAVAPOOL;
    hf_style_prologue('mazelevel');
    hf_lvlfill_solid(ROOM, 0);
    mk_mkmap(false, wter, ROOM, false);
    const sel = l_selection_grow(selection_match('.'), W_ANY);
    hf_terrain_sel(sel, ROOM, 0);
    const border = hf_sel_rect(0, 0, 78, 20);
    hf_terrain_sel(border, wter, 0);
    // des.wallify() with no args: wallify_map(xstart-1, ystart-1,
    // xstart+xsize+1, ystart+ysize+1), which clamps to the whole map.
    const o = splev_map_origin();
    mk_wallify_map(o.xstart - 1, o.ystart - 1,
                   o.xstart + o.xsize + 1, o.ystart + o.ysize + 1);
}

// C ref: dat/hellfill.lua populatemaze() — the object/monster/gold/trap
// budget shared by every hellfill style.
async function hf_populatemaze() {
    let n = mk_mrandom(1, 8) + 11;
    for (let i = 0; i < n; i++) {
        if (mk_percent(50)) mk_object(GEM_CLASS);
        else mk_object(RANDOM_CLASS);
    }
    n = mk_mrandom(1, 10) + 2;
    for (let i = 0; i < n; i++) mk_object(ROCK_CLASS);
    n = mk_mrandom(1, 3);
    for (let i = 0; i < n; i++) mk_monster('minotaur', false);
    n = mk_mrandom(1, 5) + 7;
    for (let i = 0; i < n; i++) mk_monster_random(false);
    n = mk_mrandom(1, 6) + 7;
    for (let i = 0; i < n; i++) mk_gold();
    n = mk_mrandom(1, 6) + 7;
    for (let i = 0; i < n; i++) await mk_trap();
}

// C ref: dat/hellfill.lua — the file's top level.
async function makemaz_hellfill() {
    const g = game;

    // load_special -> load_lua -> nhlib.lua prelude shuffle(align): rn2(3),rn2(2)
    const align = ['law', 'neutral', 'chaos'];
    shuffle(align);

    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    const was_mklev = g.in_mklev;
    g.in_mklev = true;
    reset_maze_bounds();
    // C ref: sp_lev.c:6373 sp_level_coder_init() ends with reset_xystart_size(),
    // so every level's Lua starts from xstart=1/ystart=0.  hellfill.lua has no
    // des.map to re-anchor them, so without this it inherited the PREVIOUS
    // special level's map origin: arriving from the Valley (a 76x20 des.map ->
    // xstart=3, ystart=1) shifted des.mazewalk's {01,10} and walkfrom() started
    // at (5,11) instead of C's (3,9), changing okay()'s count from 3 to 4 and
    // desynchronising the whole maze carve.
    reset_xystart_size();
    try {
        const hellno = mk_mrandom(1, 7);
        switch (hellno) {
        case 1: hf_style_mines_lava(); break;
        case 2: hf_style_mazegrid_tweaks(); break;
        case 3: hf_style_plain_maze(); break;
        case 4: hf_style_bars_or_lava_maze(); break;
        case 5: hf_style_thick_maze(); break;
        case 6: hf_style_cold_maze(); break;
        default: hf_style_open_cavern(); break;
        }

        mk_stair(true);
        if (Invocation_lev(g.u?.uz)) await maketrap_vibrating_square();
        else mk_stair(false);

        await hf_populatemaze();
    } finally {
        g._full_mon_gen = was_full;
        g.in_mklev = was_mklev;
    }

    // load_special finalize: !corrmaze -> wallification(1,0,COLNO-1,ROWNO-1).
    wallification(1, 0, COLNO - 1, ROWNO - 1);

    // fixup_special: place the dungeon branch staircase if this level is one.
    await mk_fixup_branch();
}

// C ref: mkmaze.c pick_vibrasquare_location() — VIBRATING_SQUARE is special-
// cased ahead of create_trap()'s normal DRY-location loop (sp_lev.c
// create_trap(): `if (t->type == VIBRATING_SQUARE) { pick_vibrasquare_location();
// maketrap(...); return; }`), so it does NOT go through mk_get_location_random.
function hf_pick_vibrasquare_location() {
    const X_MAZE_MIN = 2, Y_MAZE_MIN = 2;
    const INVPOS_X_MARGIN = 4, INVPOS_Y_MARGIN = 3, INVPOS_DISTANCE = 11;
    const x_range = mz.x_maze_max - X_MAZE_MIN - 2 * INVPOS_X_MARGIN - 1;
    const y_range = mz.y_maze_max - Y_MAZE_MIN - 2 * INVPOS_Y_MARGIN - 1;
    let x = 0, y = 0, trycnt = 0;
    for (;;) {
        x = (X_MAZE_MIN + INVPOS_X_MARGIN + 1) + rn2(x_range);
        y = (Y_MAZE_MIN + INVPOS_Y_MARGIN + 1) + rn2(y_range);
        if (++trycnt > 1000) break;
        const stway = stairway_find_dir(true);
        if (!stway) break;
        const reject = (x === stway.sx || y === stway.sy
            || Math.abs(x - stway.sx) === Math.abs(y - stway.sy)
            || distmin(x, y, stway.sx, stway.sy) <= INVPOS_DISTANCE
            || !SPACE_POS(game.level.at(x, y)?.typ) || occupied(x, y));
        if (!reject) break;
    }
    return { x, y };
}

// des.trap("vibrating square").  C ref: lspo_trap's named-type path ->
// create_trap() -> the VIBRATING_SQUARE special case above.
async function maketrap_vibrating_square() {
    const c = hf_pick_vibrasquare_location();
    await maketrap(c.x, c.y, VIBRATING_SQUARE);
}

// ── small des.* helpers used only by the hell prefabs ────────────────────

// C ref: sp_lev.c set_wallprop_in_selection() — des.non_diggable(sel).  No RNG.
function set_wallprop_selection(sel, prop) {
    selection_iterate(sel, (x, y) => {
        const loc = game.level?.at(x, y);
        if (loc && IS_STWALL(loc.typ)) loc.wall_info = (loc.wall_info || 0) | prop;
    });
}

// C ref: sp_lev.c lspo_region() two-argument form des.region(sel, "lit") —
// clone, grow in every direction, light every cell.  No RNG.
function hf_region_lit(sel) {
    const grown = l_selection_grow(sel, W_ANY);
    selection_iterate(grown, (x, y) => {
        const loc = game.level?.at(x, y);
        if (loc) loc.lit = true;
    });
}

// C ref: sp_lev.c lspo_exclusion() — registers a no-teleport zone.  No RNG.
function hf_exclusion(zonetype, x1, y1, x2, y2) {
    const a = hf_loc(x1, y1), b = hf_loc(x2, y2);
    const g = game;
    if (!g.exclusion_zones) g.exclusion_zones = [];
    g.exclusion_zones.push({ zonetype, lx: a.x, ly: a.y, hx: b.x, hy: b.y });
}

// C ref: sp_lev.c create_altar() — with an explicit `type` there is no rn2(2)
// shrine roll here; the percent(75) that chose altar-vs-shrine was already
// drawn by the .lua.  NOTE: the shrine branch's priestini() (which would spawn
// Moloch's priest, and draw RNG) is not ported — see RECON_NOTES.
function hf_altar(x, y, shrine) {
    const c = hf_loc(x, y);
    const loc = game.level?.at(c.x, c.y);
    if (!loc) return;
    loc.typ = ALTAR;
    loc.altarmask = Align2amask(A_NONE /* "noalign" */);
    if (shrine) game.level.flags.has_temple = true;
}

// C ref: sp_lev.c lspo_drawbridge() + dbridge.c create_drawbridge().  With an
// explicit state and direction there is no RNG; the effect is terrain only —
// the moat square becomes the bridge and the wall beside it the portcullis.
// DB_NORTH/SOUTH/EAST/WEST are the rm.h drawbridgemask direction values.
const DB_NORTH = 0, DB_SOUTH = 1, DB_EAST = 2, DB_WEST = 3, DB_LAVA = 0x04;
function hf_drawbridge({ x, y, dir, state }) {
    const c = hf_loc(x, y);
    const loc = game.level?.at(c.x, c.y);
    if (!loc) return false;
    const lava = (loc.typ === LAVAPOOL);
    let x2 = c.x, y2 = c.y, horiz;
    let dirv;
    switch (dir) {
    case 'north': dirv = DB_NORTH; horiz = true; y2--; break;
    case 'south': dirv = DB_SOUTH; horiz = true; y2++; break;
    case 'east': dirv = DB_EAST; horiz = false; x2++; break;
    default: dirv = DB_WEST; horiz = false; x2--; break;
    }
    const wall = game.level?.at(x2, y2);
    if (!wall || !IS_WALL(wall.typ)) return false;
    if (state === 'open') {
        loc.typ = DRAWBRIDGE_DOWN;
        wall.typ = DOOR;
        wall.doormask = D_NODOOR;
    } else {
        loc.typ = DRAWBRIDGE_UP;
        wall.typ = DBWALL;
        wall.wall_info = (wall.wall_info || 0) | W_NONDIGGABLE;
    }
    loc.horizontal = !horiz;
    wall.horizontal = horiz;
    loc.drawbridgemask = dirv | (lava ? DB_LAVA : 0);
    splev_map_set(c.x, c.y);
    return true;
}

// ============================================================
// dat/castle.lua — the stronghold at the bottom of the Dungeons of Doom, and
// the level that carries the Gehennom branch.  A fixed 63x17 map laid over a
// "mazegrid" init, four storerooms, the wand of wishing in one of the four
// towers, a throne room, two barracks, soldiers/dragons/sea monsters, and two
// mazewalk-carved moat mazes that fill_empty_maze() then stocks.
//
// C ref: mklev.c makelevel() -> makemaz("castle") -> load_special("castle.lua")
// running the des.* engine in src/sp_lev.c, then the load_special finalize
// (wallification / flip_level_rnd / fixup_special) and makelevel()'s own
// fill_special_room loop + level_finalize_topology -> mineralize().
// ============================================================

// C ref: dat/castle.lua des.map — 63 wide x 17 tall.
const CASTLE_MAP = [
    '}}}}}}}}}.............................................}}}}}}}}}',
    '}-------}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}-------}',
    '}|.....|-----------------------------------------------|.....|}',
    '}|.....+...............................................+.....|}',
    '}-------------------------------+-----------------------------}',
    '}}}}}}|........|..........+...........|.......S.S.......|}}}}}}',
    '.....}|........|..........|...........|.......|.|.......|}.....',
    '.....}|........------------...........---------S---------}.....',
    '.....}|...{....+..........+.........\\.S.................+......',
    '.....}|........------------...........---------S---------}.....',
    '.....}|........|..........|...........|.......|.|.......|}.....',
    '}}}}}}|........|..........+...........|.......S.S.......|}}}}}}',
    '}-------------------------------+-----------------------------}',
    '}|.....+...............................................+.....|}',
    '}|.....|-----------------------------------------------|.....|}',
    '}-------}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}-------}',
    '}}}}}}}}}.............................................}}}}}}}}}',
].join('\n');

// C ref: sp_lev.c def_char_to_objclass() for the class chars castle.lua uses.
const CASTLE_OBJCLASS = {
    '[': ARMOR_CLASS, ')': WEAPON_CLASS, '*': GEM_CLASS, '%': FOOD_CLASS,
};

// des.object(class, x, y) — an explicit (map-relative) coordinate, so
// get_location_coord() draws nothing; the only RNG is mkobj_at()'s.
// C ref: sp_lev.c create_object() with o->class set and o->id == -1.
function castle_object_class_at(classCh, x, y) {
    const c = hf_loc(x, y);
    return mkobj_at(CASTLE_OBJCLASS[classCh] ?? RANDOM_CLASS, c.x, c.y, true);
}

// One storeroom: 14 objects of one class, two rows of seven.
function castle_storeroom(classCh, x0, x1, y) {
    for (let ry = y; ry <= y + 1; ry++)
        for (let x = x0; x <= x1; x++) castle_object_class_at(classCh, x, ry);
}

// C ref: sp_lev.c lspo_teleport_region() / lspo_levregion() -> levregion_add().
// Registration only; place_lregions() (fixup_special) consumes them later.
// `region_islev` marks the *region* coordinates as already-absolute level
// coordinates; `exclude` has its own `exclude_islev` flag, which castle.lua
// never sets — so the exclusion rectangle IS map-relative and goes through
// get_location() (i.e. gets the des.map origin added).
function castle_levregion_add(rtype, inarea, delarea) {
    const g = game;
    if (!g.lregions) g.lregions = [];
    const a = hf_loc(delarea[0], delarea[1]), b = hf_loc(delarea[2], delarea[3]);
    g.lregions.push({
        rtype,
        lx: inarea[0], ly: inarea[1], hx: inarea[2], hy: inarea[3],
        nlx: a.x, nly: a.y, nhx: b.x, nhy: b.y,
    });
}

// C ref: sp_lev.c lspo_feature() with an explicit coord — sets the terrain and
// (for a fountain) bumps the level's fountain count.  No RNG.
function castle_feature(typ, x, y) {
    const c = hf_loc(x, y);
    const loc = game.level?.at(c.x, c.y);
    if (!loc) return;
    loc.typ = typ;
    loc.flags = 0;
    loc.horizontal = false;
    if (typ === FOUNTAIN && game.level?.flags) {
        game.level.flags.nfountains = (game.level.flags.nfountains || 0) + 1;
    }
}

// C ref: sp_lev.c sel_set_door() — an explicit door state, so rnddoor() is not
// called and no RNG is drawn.  A cell that is already a (secret) door keeps its
// terrain; everything else becomes DOOR (or SDOOR for a secret state).
function castle_door(state, x, y) {
    const c = hf_loc(x, y);
    const loc = game.level?.at(c.x, c.y);
    if (!loc) return;
    let typ = state;
    if (!IS_DOOR(loc.typ) && loc.typ !== SDOOR)
        loc.typ = (typ & D_SECRET) ? SDOOR : DOOR;
    if (typ & D_SECRET) {
        typ &= ~D_SECRET;
        if (typ < D_CLOSED) typ = D_CLOSED;
    }
    set_door_orientation(c.x, c.y);
    loc.doormask = typ;
    splev_map_set(c.x, c.y);
}

// C ref: sp_lev.c create_monster() for des.monster("name", x, y) — the name is
// resolved (find_montype, one rn2(2) gender roll for a non-fixed-gender
// species), then induced_align, then makemon at the explicit coordinate.
function castle_monster_named_at(name, x, y) {
    const { data, mgend } = mk_find_montype(name);
    oracle_induced_align();
    const c = hf_loc(x, y);
    const mtmp = make_monster(data, c.x, c.y, 0);
    if (mtmp) mtmp.female = mgend;                   // create_monster: mtmp->female = m->female
    return mtmp;
}

// C ref: sp_lev.c create_monster() for des.monster("D", x, y) — a class char
// takes no find_montype gender roll; induced_align runs first, then mkclass
// picks the species, then makemon at the explicit coordinate.
function castle_monster_class_at(classCh, x, y) {
    oracle_induced_align();
    const data = mkclass(HF_MONSYM[classCh] ?? 0, 0x0200 /* G_NOGEN */);
    const c = hf_loc(x, y);
    return make_monster(data, c.x, c.y, 0);
}

// C ref: dat/castle.lua lines 195-221 — the throne-room court.  Each entry is
// [1-based index into the shuffled monster[] table, map x, map y].
const CASTLE_COURT = [
    [10, 27, 5], [1, 30, 5], [2, 33, 5], [3, 36, 5], [4, 28, 6],
    [5, 31, 6], [6, 34, 6], [7, 37, 6], [8, 27, 7], [9, 30, 7],
    [10, 33, 7], [1, 36, 7], [2, 28, 8], [3, 31, 8], [4, 34, 8],
    [5, 27, 9], [6, 30, 9], [7, 33, 9], [8, 36, 9], [9, 28, 10],
    [10, 31, 10], [1, 34, 10], [2, 37, 10], [3, 27, 11], [4, 30, 11],
    [5, 33, 11], [6, 36, 11],
];

// C ref: dat/castle.lua — the door list (state, map x, map y).
const CASTLE_DOORS = [
    [D_CLOSED, 7, 3], [D_CLOSED, 55, 3], [D_LOCKED, 32, 4],
    [D_LOCKED, 26, 5], [D_LOCKED, 46, 5], [D_LOCKED, 48, 5],
    [D_LOCKED, 47, 7], [D_CLOSED, 15, 8], [D_CLOSED, 26, 8],
    [D_LOCKED, 38, 8], [D_LOCKED, 56, 8], [D_LOCKED, 47, 9],
    [D_LOCKED, 26, 11], [D_LOCKED, 46, 11], [D_LOCKED, 48, 11],
    [D_LOCKED, 32, 12], [D_CLOSED, 7, 13], [D_CLOSED, 55, 13],
];

// C ref: dat/castle.lua — the two-argument des.region(selection.area(...),
// "lit"/"unlit") calls, in file order.  [x1,y1,x2,y2,lit].
const CASTLE_LIT_REGIONS = [
    [0, 0, 62, 16, 0],
    [0, 5, 5, 11, 1], [57, 5, 62, 11, 1],
    [7, 5, 14, 11, 1],
    [39, 5, 45, 6, 1], [39, 10, 45, 11, 1],
    [49, 5, 55, 6, 1], [49, 10, 55, 11, 1],
    [2, 2, 6, 3, 1], [56, 2, 60, 3, 1], [2, 13, 6, 14, 1], [56, 13, 60, 14, 1],
    [8, 3, 54, 3, 0], [8, 13, 54, 13, 0],
    [16, 8, 25, 8, 0], [39, 8, 55, 8, 0],
    [47, 5, 47, 6, 0], [47, 10, 47, 11, 0],
];

// C ref: sp_lev.c lspo_region() argc==2 form — clone the selection, grow it in
// every direction when lighting (NOT when unlighting), then set each cell's
// lit flag.  No RNG.
function castle_region_lit(sel, lit) {
    const s = lit ? l_selection_grow(sel, W_ANY) : sel;
    selection_iterate(s, (x, y) => {
        const loc = game.level?.at(x, y);
        if (loc) loc.lit = !!lit;
    });
}

// C ref: dat/castle.lua — the whole des.* program.
async function makemaz_castle() {
    const g = game;

    // load_special -> load_lua -> nhlib.lua prelude shuffle(align): rn2(3),rn2(2)
    shuffle(['law', 'neutral', 'chaos']);

    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    const was_mklev = g.in_mklev;
    g.in_mklev = true;
    // The later fill_special_room() pass (makelevel's tail) must use the same
    // faithful makemon path this generator does.
    if (g.level) g.level._splev_fullmon = true;
    reset_maze_bounds();
    try {
        // des.level_init({ style="mazegrid", bg="-" }) — no RNG.
        hf_lvlfill_maze_grid(2, 0, mz.x_maze_max, mz.y_maze_max, HWALL);
        // des.level_flags("mazelevel", "noteleport", "noflipy"): "noflipy"
        // clears bit 1 of coder->allow_flips, leaving 2 (horizontal flips
        // still allowed) — that costs exactly one rn2(2) at finalize.
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;

        // des.map([[...]]) with a bare string argument: halign = valign =
        // SPLEV_CENTER.  Stamps the fixed castle at (9,3) and returns the
        // stamped cells — C's SpLev_Map, which maze1xy() must avoid.
        const stamped = lspo_map({
            map: CASTLE_MAP, halign: 'center', valign: 'center',
            in_themerooms: false,
        });
        splev_map_reset();
        for (const p of stamped || []) splev_map_set(p.x, p.y);

        // local object = { "[", ")", "*", "%" }; shuffle(object)
        const object = ['[', ')', '*', '%'];
        shuffle(object);

        // local place = selection.new(); place:set(...) x4 — the four tower
        // interiors.  selection:set() runs its coords through
        // get_location_coord(), so they are map-relative like everything else.
        const place = selection_new();
        for (const [px, py] of [[4, 2], [58, 2], [4, 14], [58, 14]]) {
            const c = hf_loc(px, py);
            selection_setpoint(c.x, c.y, place, 1);
        }

        // local monster = { L,N,E,H,M,O,R,T,X,Z }; shuffle(monster)
        const monster = ['L', 'N', 'E', 'H', 'M', 'O', 'R', 'T', 'X', 'Z'];
        shuffle(monster);

        // des.teleport_region x2 + des.levregion("stair-up"): registration
        // only (region_islev=1, so the coordinates are already absolute).
        castle_levregion_add(LR_DOWNTELE, [1, 0, 10, 20], [1, 1, 61, 15]);
        castle_levregion_add(LR_UPTELE, [69, 0, 79, 20], [1, 1, 61, 15]);
        castle_levregion_add(LR_UPSTAIR, [1, 0, 10, 20], [0, 0, 62, 16]);

        // des.feature("fountain", 10, 8)
        castle_feature(FOUNTAIN, 10, 8);

        // des.door(state, x, y) x18 — explicit states, no RNG.
        for (const [st, dx, dy] of CASTLE_DOORS) castle_door(st, dx, dy);

        // des.drawbridge({ dir="east", state="closed", x=5, y=8 }) — no RNG.
        hf_drawbridge({ x: 5, y: 8, dir: 'east', state: 'closed' });

        // Storerooms 1-4: 14 objects each of the shuffled classes.
        castle_storeroom(object[0], 39, 45, 5);
        castle_storeroom(object[1], 49, 55, 5);
        castle_storeroom(object[2], 39, 45, 10);
        castle_storeroom(object[3], 49, 55, 10);

        // THE WAND OF WISHING in one of the four towers.
        // local loc = place:rndcoord(1) — one rn2(4), and the point is removed.
        const loc = selection_rndcoord(place, true);

        // des.object({ id="chest", trapped=0, locked=1, coord=loc,
        //              contents = function() ... end })
        const chest = mksobj_at(CHEST, loc.x, loc.y, true, true);
        if (chest) {
            // create_object()'s SP_OBJ_CONTAINER arm: delete_contents() throws
            // away whatever mkbox_cnts() rolled before the lua contents run.
            chest.cobj = [];
            chest.otrapped = 0;
            chest.olocked = 1;
        }
        // The two contained objects.  create_object() picks a random DRY
        // location for each one FIRST (that is where the RNG goes), makes the
        // object, then moves it straight into the container.
        for (const otyp of [WAN_WISHING, POT_GAIN_LEVEL]) {
            castle_get_location_dry();
            const o = mksobj(otyp, true, true);
            if (o && chest) {
                add_to_container(chest, o);
                chest.owt = weight(chest);
            }
        }

        // des.engraving({ coord=loc, type="burn", text="Elbereth" }) — no RNG.
        make_engr_at(loc.x, loc.y, 'Elbereth', 0, BURN);
        // des.object({ id="scroll of scare monster", coord=loc, buc="cursed" })
        {
            const s = mksobj_at(SCR_SCARE_MONSTER, loc.x, loc.y, true, true);
            if (s) curse(s);
        }
        // des.object("chest", 37, 8) — the treasure of the lord.
        { const c = hf_loc(37, 8); mksobj_at(CHEST, c.x, c.y, true, true); }

        // des.trap("trap door", x, y) x5 — create_trap() -> mktrap() with an
        // explicit type and coordinate.  is_hole(TRAPDOOR) survives because the
        // stronghold has Can_fall_thru; the only RNG is mktrap()'s victim gate
        // (mklev.c:2137), whose rnd(4) is drawn before the depth comparison
        // fails at Dlvl 25.
        for (const [tx, ty] of [[40, 8], [44, 8], [48, 8], [52, 8], [55, 8]]) {
            const c = hf_loc(tx, ty);
            const t = await maketrap(c.x, c.y, TRAPDOOR);
            const kind = t ? t.ttyp : NO_TRAP;
            if (kind !== NO_TRAP && level_difficulty() <= rnd(4)
                && !is_pit(kind) && (kind < HOLE || kind === MAGIC_TRAP))
                mktrap_victim(t);
        }

        // Soldiers guarding the entry hall, then the towers.
        for (const [mx, my] of [[8, 6], [9, 5], [11, 5], [12, 6],
                                [8, 10], [9, 11], [11, 11], [12, 10]])
            castle_monster_named_at('soldier', mx, my);
        castle_monster_named_at('lieutenant', 9, 8);
        for (const [mx, my] of [[3, 2], [5, 2], [57, 2], [59, 2],
                                [3, 14], [5, 14], [57, 14], [59, 14]])
            castle_monster_named_at('soldier', mx, my);
        // The four dragons guarding the storerooms.
        for (const [mx, my] of [[47, 5], [47, 6], [47, 10], [47, 11]])
            castle_monster_class_at('D', mx, my);
        // Sea monsters in the moat.
        for (const [mx, my] of [[5, 7], [5, 9], [57, 7], [57, 9]])
            castle_monster_named_at('giant eel', mx, my);
        for (const [mx, my] of [[5, 0], [5, 16], [57, 0], [57, 16]])
            castle_monster_named_at('shark', mx, my);
        // The throne room court.
        for (const [li, cx, cy] of CASTLE_COURT)
            castle_monster_class_at(monster[li - 1], cx, cy);

        // des.mazewalk(x, y, dir) — the 3-argument form defaults stocked=TRUE,
        // so each call carves its flank maze and then stocks it.
        await castle_mazewalk(0, 10, W_WEST);
        await castle_mazewalk(62, 6, W_EAST);

        // des.non_diggable(selection.area(0,0, 62,16)) — no RNG.
        set_wallprop_selection(hf_sel_area(0, 0, 62, 16), W_NONDIGGABLE);

        // des.region(...) — the lit/unlit areas, then the three real rooms.
        // File order puts the whole-castle "unlit" first; the throne room and
        // the two barracks are interleaved with the lit areas but only their
        // room-creation order matters (they are the only rooms on the level).
        castle_region_lit(hf_sel_area(0, 0, 62, 16), 0);
        castle_region_lit(hf_sel_area(0, 5, 5, 11), 1);
        castle_region_lit(hf_sel_area(57, 5, 62, 11), 1);
        // des.region({ region={27,05,37,11}, lit=1, type="throne", filled=2 })
        lspo_region({ region: [27, 5, 37, 11], type: 'throne',
                      filled: 2, lit: 1 });
        castle_region_lit(hf_sel_area(7, 5, 14, 11), 1);
        for (const [x1, y1, x2, y2] of [[39, 5, 45, 6], [39, 10, 45, 11],
                                        [49, 5, 55, 6], [49, 10, 55, 11],
                                        [2, 2, 6, 3], [56, 2, 60, 3],
                                        [2, 13, 6, 14], [56, 13, 60, 14]])
            castle_region_lit(hf_sel_area(x1, y1, x2, y2), 1);
        // des.region({ region={16,05,25,06}, lit=1, type="barracks", filled=1 })
        lspo_region({ region: [16, 5, 25, 6], type: 'barracks',
                      filled: 1, lit: 1 });
        lspo_region({ region: [16, 10, 25, 11], type: 'barracks',
                      filled: 1, lit: 1 });
        for (const [x1, y1, x2, y2] of [[8, 3, 54, 3], [8, 13, 54, 13],
                                        [16, 8, 25, 8], [39, 8, 55, 8],
                                        [47, 5, 47, 6], [47, 10, 47, 11]])
            castle_region_lit(hf_sel_area(x1, y1, x2, y2), 0);
    } finally {
        g._full_mon_gen = was_full;
        g.in_mklev = was_mklev;
    }

    // load_special finalize: !corrmaze -> wallification(1,0,COLNO-1,ROWNO-1),
    // then flip_level_rnd(allow_flips) with allow_flips == 2 ("noflipy"), which
    // draws exactly one rn2(2) for the horizontal axis.
    wallification(1, 0, COLNO - 1, ROWNO - 1);
    if (rn2(2)) flip_level(2);

    // fixup_special(): walk the registered lregions, then (no LR_BRANCH among
    // them) place the dungeon branch.
    castle_place_lregions();
    await castle_place_branch();
    // Is_stronghold -> level.flags.graveyard = 1.  No RNG.
    if (g.level?.flags) g.level.flags.graveyard = true;
}

// C ref: sp_lev.c get_location(DRY) with croom == NULL and a random coord —
// x = xstart + rn2(xsize), y = ystart + rn2(ysize), retried up to 100 times
// until is_ok_location(DRY).
function castle_get_location_dry() {
    const o = splev_map_origin();
    let x = o.xstart, y = o.ystart, cpt = 0;
    do {
        x = o.xstart + rn2(o.xsize);
        y = o.ystart + rn2(o.ysize);
        const loc = game.level?.at(x, y);
        if (loc && SPACE_POS(loc.typ)) break;
    } while (++cpt < 100);
    return { x, y };
}

// C ref: sp_lev.c lspo_mazewalk() 3-argument form — explicit direction and the
// default stocked=TRUE, so random_wdir() is not called but fill_empty_maze()
// is.  Shares hf_mazewalk's carve; only the stocking differs.
async function castle_mazewalk(mx, my, dir) {
    hf_mazewalk(mx, my, dir, ROOM);
    await castle_fill_empty_maze();
}

// C ref: sp_lev.c maze1xy(m, DRY) — a random odd/odd cell outside every part of
// the special level (SpLev_Map) that is a DRY spot.
function castle_maze1xy() {
    let x = 3, y = 3, tryct = 2000;
    do {
        x = rn1(mz.x_maze_max - 3, 3);
        y = rn1(mz.y_maze_max - 3, 3);
        if (--tryct < 0) break;
    } while (!(x % 2) || !(y % 2) || castle_splev_at(x, y)
             || !castle_ok_dry(x, y));
    return { x, y };
}

// C ref: sp_lev.c SpLev_Map[x][y] — "this square was touched by the level
// loader".  maze1xy() uses it to keep the maze filler out of the special
// level's own footprint.
//
// Stored as `_castle_splev_map`, NOT `_splev_map`: js/sp_lev.js already keeps a
// Set of "x,y" strings under that name for the same concept, and having two
// modules write one game field with two different shapes made
// themerooms_generate()'s splev_map_mark() call `.add()` on a Uint8Array —
// crashing seed0360/0361/4500 to zero screens.  The grid form is what maze1xy()
// wants here; the two are kept separate rather than unified because sp_lev's Set
// is load-bearing for the already-gated themeroom path.
function splev_map_reset() {
    game._castle_splev_map = Array.from({ length: COLNO }, () => new Uint8Array(ROWNO));
}
function splev_map_set(x, y) {
    const m = game._castle_splev_map;
    if (m && m[x] && y >= 0 && y < ROWNO) m[x][y] = 1;
}
function castle_splev_at(x, y) {
    return !!(game._castle_splev_map?.[x]?.[y]);
}

// is_ok_location(x, y, DRY): SPACE_POS(typ) and no boulder on the square.
function castle_ok_dry(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc || !SPACE_POS(loc.typ)) return false;
    return !castle_sobj_at(BOULDER, x, y);
}

function castle_sobj_at(otyp, x, y) {
    for (const o of game.level?.objects || [])
        if (o.otyp === otyp && o.ox === x && o.oy === y) return true;
    return false;
}

// C ref: sp_lev.c fill_empty_maze() — proportionally stock whatever part of the
// maze the special level did not cover.
async function castle_fill_empty_maze() {
    const mapcountmax = Math.trunc(((mz.x_maze_max - 2) * (mz.y_maze_max - 2)) / 2);
    let mapcount = (mz.x_maze_max - 2) * (mz.y_maze_max - 2);
    for (let x = 2; x < mz.x_maze_max; x++)
        for (let y = 0; y < mz.y_maze_max; y++)
            if (castle_splev_at(x, y)) mapcount--;
    if (mapcount <= Math.trunc(mapcountmax / 10)) return;

    const mapfact = Math.trunc((mapcount * 100) / mapcountmax);
    let cnt;
    for (cnt = rnd(Math.trunc((20 * mapfact) / 100)); cnt; cnt--) {
        const mm = castle_maze1xy();
        mkobj_at(rn2(2) ? GEM_CLASS : RANDOM_CLASS, mm.x, mm.y, true);
    }
    for (cnt = rnd(Math.trunc((12 * mapfact) / 100)); cnt; cnt--) {
        const mm = castle_maze1xy();
        const tt = t_at(mm.x, mm.y);
        if (tt && (is_pit(tt.ttyp) || is_hole(tt.ttyp))) continue;
        mksobj_at(BOULDER, mm.x, mm.y, true, false);
    }
    for (cnt = rn2(2); cnt; cnt--) {
        const mm = castle_maze1xy();
        make_monster(monster_by_pmidx(name_to_pmidx('minotaur')),
                     mm.x, mm.y, 0);
    }
    for (cnt = rnd(Math.trunc((12 * mapfact) / 100)); cnt; cnt--) {
        const mm = castle_maze1xy();
        make_monster(null, mm.x, mm.y, 0);
    }
    for (cnt = rn2(Math.trunc((15 * mapfact) / 100)); cnt; cnt--) {
        const mm = castle_maze1xy();
        mkgold(0, mm.x, mm.y);
    }
    for (cnt = rn2(Math.trunc((15 * mapfact) / 100)); cnt; cnt--) {
        const mm = castle_maze1xy();
        let trytrap = castle_rndtrap();
        if (castle_sobj_at(BOULDER, mm.x, mm.y))
            while (is_pit(trytrap) || is_hole(trytrap)) trytrap = castle_rndtrap();
        await maketrap(mm.x, mm.y, trytrap);
    }
}

// C ref: sp_lev.c rndtrap() — reroll until a trap type allowed on this level.
function castle_rndtrap() {
    let rtrap;
    do {
        rtrap = rnd(TRAPNUM - 1);
        switch (rtrap) {
        case HOLE: case VIBRATING_SQUARE: case MAGIC_PORTAL:
            rtrap = NO_TRAP; break;
        case TRAPDOOR:
            if (!Can_dig_down(game.u?.uz)) rtrap = NO_TRAP;
            break;
        case LEVEL_TELEP: case TELEP_TRAP:
            if (game.level?.flags?.noteleport) rtrap = NO_TRAP;
            break;
        case ROLLING_BOULDER_TRAP: case ROCKTRAP:
            if (In_endgame(game.u?.uz)) rtrap = NO_TRAP;
            break;
        default: break;
        }
    } while (rtrap === NO_TRAP);
    return rtrap;
}

// C ref: mkmaze.c fixup_special() — walk gl.lregions.  LR_*TELE only records
// the region for goto_level(); LR_UPSTAIR/LR_DOWNSTAIR/LR_BRANCH place now.
function castle_place_lregions() {
    const g = game;
    for (const r of g.lregions || []) {
        if (r.rtype === LR_TELE || r.rtype === LR_UPTELE) {
            g.updest = { lx: r.lx, ly: r.ly, hx: r.hx, hy: r.hy,
                         nlx: r.nlx, nly: r.nly, nhx: r.nhx, nhy: r.nhy };
        }
        if (r.rtype === LR_TELE || r.rtype === LR_DOWNTELE) {
            g.dndest = { lx: r.lx, ly: r.ly, hx: r.hx, hy: r.hy,
                         nlx: r.nlx, nly: r.nly, nhx: r.nhx, nhy: r.nhy };
        }
        if (r.rtype === LR_UPSTAIR || r.rtype === LR_DOWNSTAIR)
            castle_place_stair_lregion(r);
    }
}

// C ref: mkmaze.c place_lregion() + put_lregion_here() for LR_UPSTAIR — the
// probabilistic loop draws rn1((hx-lx)+1, lx) / rn1((hy-ly)+1, ly) per attempt.
function castle_place_stair_lregion(r) {
    const up = (r.rtype === LR_UPSTAIR);
    const lx = Math.max(r.lx, 1), hx = Math.min(r.hx, COLNO - 1);
    const ly = Math.max(r.ly, 0), hy = Math.min(r.hy, ROWNO - 1);
    for (let trycnt = 0; trycnt < 200; trycnt++) {
        const x = rn1((hx - lx) + 1, lx);
        const y = rn1((hy - ly) + 1, ly);
        if (castle_put_stair_here(x, y, r, up)) return;
    }
    for (let x = lx; x <= hx; x++)
        for (let y = ly; y <= hy; y++)
            if (castle_put_stair_here(x, y, r, up)) return;
}

function castle_put_stair_here(x, y, r, up) {
    if (castle_bad_location(x, y, r.nlx, r.nly, r.nhx, r.nhy)) return false;
    mkstairs(x, y, up ? 1 : 0, null);
    return true;
}

// C ref: mkmaze.c bad_location() — occupied, inside the excluded region, or not
// a ROOM/maze-CORR/AIR square.
function castle_bad_location(x, y, nlx, nly, nhx, nhy) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    if (occupied(x, y)) return true;
    if (nlx && x >= nlx && x <= nhx && y >= nly && y <= nhy) return true;
    const is_maze = !!game.level?.flags?.is_maze_lev;
    return !((loc.typ === CORR && is_maze) || loc.typ === ROOM || loc.typ === AIR);
}

// C ref: mkmaze.c fixup_special() tail — no LR_BRANCH lregion was registered,
// so place_lregion(0,...,LR_BRANCH) runs, and because nroom > 0 it delegates
// straight to place_branch() -> find_branch_room().
async function castle_place_branch() {
    const branchp = is_branchlev();
    if (!branchp) return;
    const croom = castle_find_branch_room();
    if (!croom) return;
    const m = { x: 0, y: 0 };
    if (!somexyspace(croom, m)) return;
    await place_branch(branchp, m.x, m.y);
}

// C ref: mklev.c generate_stairs_find_room() — three relaxation phases over the
// room list; the first phase with any candidate draws one rn2(candidates).
function castle_find_branch_room() {
    const g = game;
    const nroom = g.level?.nroom || 0;
    if (!nroom) return null;
    for (let phase = 2; phase > -1; phase--) {
        const cand = [];
        for (let i = 0; i < nroom; i++)
            if (castle_stairs_room_good(g.level.rooms[i], phase)) cand.push(i);
        if (cand.length) return g.level.rooms[cand[rn2(cand.length)]];
    }
    return g.level.rooms[rn2(nroom)];
}

// C ref: mklev.c generate_stairs_room_good().
function castle_stairs_room_good(croom, phase) {
    if (!croom) return false;
    if (!(croom.needjoining || phase < 0)) return false;
    if (!((!has_dnstairs(croom) && !has_upstairs(croom)) || phase < 1)) return false;
    return croom.rtype === OROOM || (phase < 2 && croom.rtype === THEMEROOM);
}


// C ref: mklev.c makelevel() `In_quest(&u.uz)` branch — a quest-branch level
// that is NOT one of the three named levels (start/locate/goal) dispatches to
// "{filecode}-fila" (before the locate level) or "{filecode}-filb" (at/after
// it).  dat/Bar-fila.lua: same splev engine as minefill (mines-style init_fill
// + smoothed + joined cave), but bg==fg==ROOM and walled=false (a fully open,
// unwalled cavern) and an explicit lit=0 (no BOOL_RANDOM roll, unlike
// minefill's implicit lit).  Only the Barbarian's "before locate" filler is
// ported; other roles/filb fall through to the regular generator.
async function makemaz_bar_fila() {
    const g = game;

    // load_special -> load_lua -> nhlib.lua prelude shuffle(align): rn2(3),rn2(2)
    const align = ['law', 'neutral', 'chaos'];
    for (let i = align.length; i >= 2; i--) {
        const j = 1 + rn2(i);
        const a = i - 1, b = j - 1;
        const t = align[a]; align[a] = align[b]; align[b] = t;
    }

    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    const was_mklev = g.in_mklev;
    g.in_mklev = true;
    try {
        // des.level_init({ style="solidfill", fg=" " })
        //   splev_initlev SOLIDFILL: lit = rn2(2); lvlfill_solid(STONE, lit).
        rn2(2);
        // des.level_flags("mazelevel","noflip") — no PRNG; is_maze_lev stays
        // TRUE below since mk_mkmap's walled&&joined override only fires when
        // walled (it isn't, here).
        if (g.level?.flags) g.level.flags.is_maze_lev = true;
        // des.level_init({ style="mines", fg=".", bg=".", smoothed=true,
        //                  joined=true, lit=0, walled=false })
        //   splev_initlev MINES: lit is an explicit boolean (0), so
        //   litstate_rnd draws NO rn2 (unlike minefill's implicit/random lit).
        mk_mkmap(false, ROOM, ROOM, false);

        // des.stair("up"); des.stair("down")
        mk_stair(true);
        mk_stair(false);

        // des.object() x8 — fully random class, random DRY spot.
        for (let i = 0; i < 8; i++) mk_object(RANDOM_CLASS);

        // des.trap() x4
        for (let i = 0; i < 4; i++) await mk_trap();

        // des.monster({id=,peaceful=0}) x2 + class "O" + named "rock troll",
        // all forced hostile regardless of induced_align.
        mk_monster('ogre', false);
        mk_monster('ogre', false);
        mk_monster('O', false);
        mk_monster('rock troll', false);
    } finally {
        g._full_mon_gen = was_full;
        g.in_mklev = was_mklev;
    }

    // load_special finalize: !corrmaze -> wallification(1,0,COLNO-1,ROWNO-1).
    // A no-op here (the level has no wall tiles at all — walled=false, bg==fg)
    // but kept for fidelity/consistency with every other special-level path.
    wallification(1, 0, COLNO - 1, ROWNO - 1);

    // fixup_special: place the dungeon branch staircase, if this level happens
    // to be one (it isn't, for the Barbarian's Bar-fila — the quest branch
    // point is Bar-strt — but mirrors minefill's unconditional call).
    await mk_fixup_branch();
}

// -- Room-style quest filler levels (dat/<Fc>-fila.lua / <Fc>-filb.lua) ----
// Every role except the Barbarian's has the same shape: six
// des.room({ type=..., contents=function() ... end }) blocks and a closing
// des.random_corridors().  C ref: mklev.c:1275 makelevel()'s In_quest arm.

// C ref: sp_lev.c get_location() -- one 100-try loop, then the deterministic
// footprint scan; NO_LOC_WARN turns the give-up into (-1,-1).  With a croom
// the candidate comes from somexy(croom) instead of rn2(xsize)/rn2(ysize).
function qf_getloc_once(okfn, croom, nowarn) {
    const mx = croom ? croom.lx : 1, my = croom ? croom.ly : 0;
    const sx = croom ? (croom.hx - croom.lx + 1) : (COLNO - 1);
    const sy = croom ? (croom.hy - croom.ly + 1) : ROWNO;
    let x = -1, y = -1, cpt = 0;
    do {
        if (croom) {
            const c = { x: -1, y: -1 };
            somexy(croom, c);   // C discards the return; c is set either way
            x = c.x; y = c.y;
        } else {
            x = mx + rn2(sx);
            y = my + rn2(sy);
        }
        if (okfn(x, y)) return { x, y };
    } while (++cpt < 100);
    for (let xx = 0; xx < sx; xx++)
        for (let yy = 0; yy < sy; yy++)
            if (okfn(mx + xx, my + yy)) return { x: mx + xx, y: my + yy };
    if (nowarn) return { x: -1, y: -1 };
    return { x: COLNO - 1, y: ROWNO - 1 };
}

// C ref: sp_lev.c get_location_coord() for SP_COORD_PACK_RANDOM -- get_location
// runs TWICE, the first pass always with NO_LOC_WARN forced on.
function qf_getloc_coord(okfn, croom, nowarn) {
    const c = qf_getloc_once(okfn, croom, true);
    if (c.x !== -1 || c.y !== -1) return c;
    return qf_getloc_once(okfn, croom, nowarn);
}

const qf_ok_hum = (hum) => (x, y) => is_ok_location(x, y, hum);

// C ref: sp_lev.c l_create_stairway() -- good_stair_loc via set_ok_location_func.
function qf_stair(croom, up) {
    const c = qf_getloc_coord(mk_ok_stair, croom, false);
    const t = game.level.at(c.x, c.y);
    if (t) t.typ = ROOM;
    mkstairs(c.x, c.y, up ? 1 : 0, null);
}

// C ref: sp_lev.c create_object() with no id/class -- mkobj_at(RANDOM_CLASS).
function qf_object(croom) {
    const c = qf_getloc_coord(mk_ok_dry, croom, false);
    mkobj_at(RANDOM_CLASS, c.x, c.y, true);
}

// C ref: sp_lev.c create_trap() -> get_free_room_loc() (DRY, then a ROOM-only
// retry), then mktrap() with a random type.
async function qf_trap(croom) {
    const c = qf_getloc_coord(mk_ok_dry, croom, false);
    let trycnt = 0;
    while (game.level.at(c.x, c.y)?.typ !== ROOM && ++trycnt <= 100) {
        const r = qf_getloc_once(() => true, croom, false);
        c.x = r.x; c.y = r.y;
    }
    await qf_mktrap_at(c.x, c.y);
}

// C ref: sp_lev.c create_monster() with a croom -- pm_to_humidity's two-step
// (a water-liking species burns two whole get_location_coord passes on a dry
// level before the DRY retry), then the MON_AT/enexto nudge.
function qf_place_monster(data, croom) {
    const hum = data ? pm_to_humidity(data) : LOC_DRY;
    let c = qf_getloc_coord(qf_ok_hum(hum), croom, true);
    if (c.x === -1 && c.y === -1)
        c = qf_getloc_coord(qf_ok_hum(hum | LOC_DRY), croom, false);
    mk_enexto_if_occupied(c, data);
    if (croom && !inside_room(croom, c.x, c.y)) return null;
    return make_monster(data, c.x, c.y, 0);
}

// C ref: sp_lev.c lspo_monster()+create_monster() -- the single-char CLASS form
// (no find_montype gender roll) and the named form (find_montype first).
function qf_monster(croom, spec, peacefulOverride) {
    if (spec.length === 1) {
        const klass = MK_CLASS_CHAR[spec] ?? 0;
        oracle_induced_align();
        const data = mk_mines_race_suppress(mkclass(klass, 0x0200 /* G_NOGEN */));
        const mtmp = qf_place_monster(data, croom);
        if (mtmp) mtmp.female = 0;
        // C ref: sp_lev.c create_monster() -- `peaceful=0` in the des table
        // overrides makemon's own answer (no RNG).
        if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
        return mtmp;
    }
    const { data, mgend } = mk_find_montype(spec);
    oracle_induced_align();
    const mtmp = qf_place_monster(mk_mines_race_suppress(data), croom);
    if (mtmp) mtmp.female = mgend;
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    return mtmp;
}

// dat/<Fc>-fil[ab].lua room programs.  Each entry is one des.room(); the
// contents list is in file order.  'u'/'d' = des.stair("up"/"down"),
// 'o' = des.object(), 't' = des.trap(), anything else = des.monster(<spec>).
const QUEST_FILLERS = {
    'Arc-fila': [[OROOM, ['u', 'o', 'S']], [OROOM, ['o', 'o', 'S']],
                 [OROOM, ['o', 't', 'o', 'S']],
                 [OROOM, ['d', 'o', 't', 'S', 'human mummy']],
                 [OROOM, ['o', 'o', 't', 'S']], [OROOM, ['o', 't', 'S']]],
    'Arc-filb': [[OROOM, ['u', 'o', 'M']], [OROOM, ['o', 'o', 'M']],
                 [OROOM, ['o', 't', 'o', 'M']],
                 [OROOM, ['d', 'o', 't', 'S', 'human mummy']],
                 [OROOM, ['o', 'o', 't', 'S']], [OROOM, ['o', 't', 'S']]],
    'Mon-fila': [[OROOM, ['u', 'o', ['E', 0]]], [OROOM, ['o', 'o', ['E', 0]]],
                 [OROOM, ['o', 't', 'o', 'xorn', 'earth elemental']],
                 [OROOM, ['d', 'o', 't', ['E', 0], 'earth elemental']],
                 [OROOM, ['o', 'o', 't', ['X', 0]]],
                 [OROOM, ['o', 't', 'earth elemental']]],
    'Mon-filb': [[OROOM, ['u', 'o', ['X', 0]]], [OROOM, ['o', 'o', ['X', 0]]],
                 [OROOM, ['o', 't', 'o', ['E', 0]]],
                 [OROOM, ['d', 'o', 't', ['E', 0], 'earth elemental']],
                 [OROOM, ['o', 'o', 't', ['X', 0]]],
                 [OROOM, ['o', 't', 'earth elemental']]],
    // dat/Pri-fila.lua / Pri-filb.lua — the only room-style fillers with
    // `type = "morgue"` rooms (rooms 4 and 6 of fila; 2, 4 and 6 of filb), so
    // these are the first entries here whose rtype is not OROOM and whose
    // needfill therefore reaches fill_special_room().
    'Pri-fila': [[OROOM, ['u', 'o', 'human zombie']],
                 [OROOM, ['o', 'o']],
                 [OROOM, ['o', 't', 'o', 'human zombie']],
                 [MORGUE, ['d', 'o', 't']],
                 [OROOM, ['o', 'o', 't', 'wraith']],
                 [MORGUE, ['o', 't']]],
    'Pri-filb': [[OROOM, ['u', 'o', 'human zombie', 'wraith']],
                 [MORGUE, ['o', 'o', 'o']],
                 [OROOM, ['o', 't', 'o', 'human zombie', 'wraith']],
                 [MORGUE, ['d', 'o', 'o', 't']],
                 [OROOM, ['o', 'o', 't', 'human zombie', 'wraith']],
                 [MORGUE, ['o', 't']]],
    'Rog-fila': [[OROOM, ['u', 'o', ['leprechaun', 0]]],
                 [OROOM, ['o', 'o', ['leprechaun', 0], ['guardian naga', 0]]],
                 [OROOM, ['o', 't', 't', 'o', ['water nymph', 0]]],
                 [OROOM, ['d', 'o', 't', 't', ['l', 0], ['guardian naga', 0]]],
                 [OROOM, ['o', 'o', 't', 't', ['leprechaun', 0]]],
                 [OROOM, ['o', 't', 't', ['leprechaun', 0], ['water nymph', 0]]]],
    'Wiz-fila': [[OROOM, ['u', 'o', ['i', 0]]], [OROOM, ['o', 'o', ['i', 0]]],
                 [OROOM, ['o', 't', 'o', 'vampire bat', 'vampire bat']],
                 [OROOM, ['d', 'o', 't', ['i', 0], 'vampire bat']],
                 [OROOM, ['o', 'o', 't', ['i', 0]]],
                 [OROOM, ['o', 't', 'vampire bat']]],
    'Wiz-filb': [[OROOM, ['u', 'o', ['X', 0]]], [OROOM, ['o', 'o', ['i', 0]]],
                 [OROOM, ['o', 't', 'o', ['X', 0]]],
                 [OROOM, ['d', 'o', 't', ['i', 0], 'vampire bat']],
                 [OROOM, ['o', 'o', 't', ['i', 0]]],
                 [OROOM, ['o', 't', 'vampire bat']]],
};
// Rog-filb is byte-identical to Rog-fila.
QUEST_FILLERS['Rog-filb'] = QUEST_FILLERS['Rog-fila'];

async function makemaz_quest_fill(name) {
    const g = game;
    const rooms = QUEST_FILLERS[name];
    if (!rooms) return false;

    // load_special -> load_lua -> nhlib.lua prelude shuffle(align): rn2(3),rn2(2)
    shuffle(['law', 'neutral', 'chaos']);

    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    const was_mklev = g.in_mklev;
    g.in_mklev = true;
    try {
        for (const [rtype, contents] of rooms) {
            // C ref: sp_lev.c lspo_room() -- a level-file room defaults
            // filled=1 and joined=true, but C's fill_special_room() returns
            // immediately for an OROOM, so FILL_NORMAL is inert there.  This
            // port's fastforward_fill_mineralize() DOES stock an OROOM with
            // FILL_NORMAL (that is makelevel()'s regular arm, which a special
            // level never reaches), so ordinary rooms must carry FILL_NONE.
            await des_room({ rtype,
                             needfill: rtype === OROOM ? FILL_NONE : FILL_NORMAL,
                             joined: true },
                async (croom) => {
                    for (const item of contents) {
                        if (item === 'u') qf_stair(croom, true);
                        else if (item === 'd') qf_stair(croom, false);
                        else if (item === 'o') qf_object(croom);
                        else if (item === 't') await qf_trap(croom);
                        else if (Array.isArray(item)) qf_monster(croom, item[0], item[1]);
                        else qf_monster(croom, item);
                    }
                });
        }
    } finally {
        g._full_mon_gen = was_full;
        g.in_mklev = was_mklev;
    }

    // des.random_corridors() -> create_corridor() with src.room == -1 is a
    // bare makecorridors() -- NO sort_rooms(), so the rooms are joined in
    // creation order (sorting them re-pairs every join and desyncs finddpos).
    if (g.level.nroom > 0) makecorridors();

    // lspo_finalize_level: wallification, then flip_level_rnd(allow_flips).
    // Neither file declares "noflip", so both bits roll.
    wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                            // sp_lev.c:975
    if (rn2(2)) flp |= 2;                            // sp_lev.c:977
    if (flp) flip_level(flp);
    return true;
}

// C ref: dat/Bar-filb.lua — the "at/after locate" quest filler.  Same engine
// as Bar-fila but bg=STONE (not ROOM) and walled=true (an ordinary walled
// mines cave, exactly like makemaz_minefill's shape), 11 objects, and a
// bigger monster roster (7 ogres + class O + 3 rock trolls + class T).
async function makemaz_bar_filb() {
    const g = game;

    // load_special -> load_lua -> nhlib.lua prelude shuffle(align): rn2(3),rn2(2)
    const align = ['law', 'neutral', 'chaos'];
    for (let i = align.length; i >= 2; i--) {
        const j = 1 + rn2(i);
        const a = i - 1, b = j - 1;
        const t = align[a]; align[a] = align[b]; align[b] = t;
    }

    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    const was_mklev = g.in_mklev;
    g.in_mklev = true;
    try {
        // des.level_init({ style="solidfill", fg=" " }) — rn2(2), discarded.
        rn2(2);
        // des.level_flags("mazelevel","noflip") — no PRNG; walled&&joined in
        // mk_mkmap below overrides is_maze_lev to false (cavernous), same as
        // minefill, so no explicit flag set here is needed.
        // des.level_init({ style="mines", fg=".", bg=" ", smoothed=true,
        //                  joined=true, lit=0, walled=true })
        //   lit is an explicit boolean (0): litstate_rnd draws NO rn2.
        mk_mkmap(false, STONE, ROOM, true);

        // des.stair("up"); des.stair("down")
        mk_stair(true);
        mk_stair(false);

        // des.object() x11 — fully random class, random DRY spot.
        for (let i = 0; i < 11; i++) mk_object(RANDOM_CLASS);

        // des.trap() x4
        for (let i = 0; i < 4; i++) await mk_trap();

        // des.monster({id=,peaceful=0}) x7 ogres + class "O" + 3x named
        // "rock troll" + class "T", all forced hostile.
        for (let i = 0; i < 7; i++) mk_monster('ogre', false);
        mk_monster('O', false);
        for (let i = 0; i < 3; i++) mk_monster('rock troll', false);
        mk_monster('T', false);
    } finally {
        g._full_mon_gen = was_full;
        g.in_mklev = was_mklev;
    }

    // load_special finalize: !corrmaze -> wallification(1,0,COLNO-1,ROWNO-1).
    wallification(1, 0, COLNO - 1, ROWNO - 1);

    // fixup_special: place the dungeon branch staircase (not applicable here
    // either — mirrors minefill's/Bar-fila's unconditional call).
    await mk_fixup_branch();
}

// C ref: mkmaze.c fixup_special() — for a branch level with no rooms left
// (join_map_cleanup reset svn.nroom to 0), the branch is placed via
// place_lregion(0,...,LR_BRANCH).  Because nroom==0 the LR_BRANCH early-return
// (place_branch) is NOT taken; instead place_lregion runs its probabilistic
// rn1 loop: x = rn1(79,1), y = rn1(21,0) until put_lregion_here succeeds.
// put_lregion_here(LR_BRANCH): valid iff !bad_location -> !occupied && typ==ROOM
// (cavernous, not is_maze_lev), then place_branch(branchp, x, y).
async function mk_fixup_branch() {
    const branchp = is_branchlev();
    if (!branchp) return;
    let x = 0, y = 0;
    for (let trycnt = 0; trycnt < 200; trycnt++) {
        x = rn1(COLNO - 1 - 1 + 1, 1);  // rn1((hx-lx)+1, lx) = rn1(79, 1)
        y = rn1(ROWNO - 1 - 0 + 1, 0);  // rn1((hy-ly)+1, ly) = rn1(21, 0)
        if (await mk_put_branch_here(x, y, branchp)) return;
    }
    // deterministic fallback (no PRNG)
    for (x = 1; x <= COLNO - 1; x++)
        for (y = 0; y <= ROWNO - 1; y++)
            if (await mk_put_branch_here(x, y, branchp, true)) return;
}

function mk_bad_branch_location(x, y) {
    const loc = game.level.at(x, y);
    if (!loc) return true;
    if (occupied(x, y)) return true;
    // C ref: mkmaze.c bad_location — (CORR && is_maze_lev) || ROOM || AIR.
    // Cavernous mines (is_maze_lev false) reduce this to ROOM; a solidfill maze
    // like Vlad's Tower (is_maze_lev true) has only ROOM floors so it is the
    // same set of cells, but keep the faithful predicate.
    const is_maze = !!game.level?.flags?.is_maze_lev;
    return !((loc.typ === CORR && is_maze) || loc.typ === ROOM || loc.typ === AIR);
}

// C ref: mkmaze.c place_lregions() — place the levregion a special level
// registered with des.levregion({region=..., type=...}).  game._quest_lregion
// holds the (already flipped) region and its LR_* rtype; place_lregion's
// probabilistic loop draws rn1((hx-lx)+1,lx) for x and rn1((hy-ly)+1,ly) for y
// (so exactly rn2(1)+x / rn2(1)+y for the 1-cell regions the quest home levels
// use), then hands the accepted spot to put_lregion_here().
export async function quest_place_branch() {
    const reg = game._quest_lregion;
    if (!reg) return;
    const lx = reg.x1, ly = reg.y1, hx = reg.x2, hy = reg.y2;
    const rtype = reg.rtype ?? LR_BRANCH;
    const oneshot = (lx === hx && ly === hy);
    for (let trycnt = 0; trycnt < 200; trycnt++) {
        const x = rn1((hx - lx) + 1, lx);
        const y = rn1((hy - ly) + 1, ly);
        if (await quest_put_lregion_here(x, y, rtype, oneshot)) return;
    }
    for (let x = lx; x <= hx; x++)
        for (let y = ly; y <= hy; y++)
            if (await quest_put_lregion_here(x, y, rtype, true)) return;
}

// C ref: mkmaze.c put_lregion_here() — the two rtypes a des.levregion{} on a
// quest home level can carry.  LR_*TELE goes through place_lregion() above and
// LR_*STAIR through castle_place_stair_lregion(), so neither reaches here; C's
// `oneshot` deltrap() retry has no registered region small enough to need it.
async function quest_put_lregion_here(x, y, rtype, _oneshot) {
    // C ref: bad_location() — occupied() plus the ROOM/(CORR on a maze)/AIR
    // terrain test.  On the quest home levels the registered cell is ROOM.
    if (mk_bad_branch_location(x, y)) return false;
    switch (rtype) {
    case LR_PORTAL: {
        // C: mkportal(x, y, lev->dnum, lev->dlevel) — the destination comes
        // from the levregion's own d_level (des.levregion{ dungeon=..., ...}),
        // which sp_lev stores alongside the region.
        const lev = game._quest_lregion?.lev;
        await mkportal(x, y, lev?.dnum ?? 0, lev?.dlevel ?? 0);
        break;
    }
    case LR_BRANCH:
        await place_branch(is_branchlev(), x, y);
        break;
    default:
        return false;
    }
    return true;
}

async function mk_put_branch_here(x, y, branchp) {
    if (mk_bad_branch_location(x, y)) return false;
    await place_branch(branchp, x, y);
    return true;
}

// C ref: oracle.lua — the full des.* program.
async function makemaz_oracle() {
    const g = game;
    g.level.flags.is_maze_lev = false;
    // load_special -> load_lua -> nhlib.lua top-level shuffle(align): rn2(3),rn2(2)
    const align = ['law', 'neutral', 'chaos'];
    for (let i = align.length; i >= 2; i--) {
        const j = 1 + rn2(i);
        const a = i - 1, b = j - 1;
        const t = align[a]; align[a] = align[b]; align[b] = t;
    }
    // des.level_flags("noflip") — sets allow_flips=0 (handled at finalize: no rng)

    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    const was_mklev = g.in_mklev;
    g.in_mklev = true;
    try {
        // ---- Room 1: the big ordinary center room (lit) -------------------
        // des.room({ type="ordinary", lit=1, x=3,y=3, xalign="center",
        //            yalign="center", w=11,h=9, contents=... })
        rn2(100);                                   // build_room chance
        let ok = create_room(3, 3, 11, 9, 3 /*CENTER*/, 3 /*CENTER*/, OROOM, 1);
        const room1 = g.level.rooms[g.level.nroom - 1];
        if (ok && room1) {
            topologize(room1);
            // C: special-level rooms are filled inline (here) during gen and
            // are NOT re-filled by the ordinary fill_ordinary_room loop, so mark
            // them FILL_NONE to keep fastforward_fill_mineralize from re-stocking.
            room1.needfill = FILL_NONE;
            // 8 historic centaur statues at fixed room-relative coords.
            const S_CENTAUR = 29;
            const statpos = [[0,0],[0,8],[10,0],[10,8],[5,1],[5,7],[2,4],[8,4]];
            for (const [rx, ry] of statpos) {
                oracle_place_statue(room1.lx + rx, room1.ly + ry, S_CENTAUR);
            }
            // delphi subroom: des.room({ type="delphi", lit=1, x=4,y=3, w=3,h=3 })
            rn2(100);                               // build_room chance (subroom)
            const oksub = create_subroom(room1, 4, 3, 3, 3, OROOM, 1);
            if (oksub) {
                const delphi = room1.sbrooms[room1.nsubrooms - 1];
                // C ref: sp_lev.c build_room():2826 — topologize() runs for a
                // SUBROOM too, BEFORE lspo_room marks the parent irregular
                // (sp_lev.c:4088).  Without it the delphi's cells kept the outer
                // room's roomno, so somexy()'s irregular arm accepted a spot
                // inside the delphi on the first try where C rejects it and
                // re-rolls somex/somey (elf-wiz Dlvl 5, step 205).
                topologize(delphi);
            }
            room1.irregular = true;                 // parent made irregular
            if (oksub) {
                const delphi = room1.sbrooms[room1.nsubrooms - 1];
                // four fountains at fixed delphi-relative coords (no rng)
                const setfeat = (rx, ry, typ) => {
                    const loc = g.level.at(delphi.lx + rx, delphi.ly + ry);
                    if (loc) loc.typ = typ;
                };
                setfeat(0, 1, FOUNTAIN);
                setfeat(1, 0, FOUNTAIN);
                setfeat(1, 2, FOUNTAIN);
                setfeat(2, 1, FOUNTAIN);
                // des.monster("Oracle", 1, 1) — fixed coords inside delphi.
                oracle_induced_align();             // sp_amask_to_amask
                const ox = delphi.lx + 1, oy = delphi.ly + 1;
                make_monster(monster_by_pmidx(name_to_pmidx('Oracle')), ox, oy, 0);
                // des.door({ state="nodoor", wall="all" })
                // C ref: oracle.lua des.door({ state="nodoor", wall="random" })
                // -> lspo_door -> create_door() with mask != -1.
                create_door({ secret: 0, mask: D_NODOOR, pos: -1, wall: W_ANY },
                            delphi);
            }
            // des.monster(); des.monster() — two random monsters in room 1.
            // Uses the same create_monster() collision->enexto relocation as the
            // random rooms below (oracle_monster).
            for (let i = 0; i < 2; i++) {
                oracle_monster(room1);
            }
        }

        // ---- Rooms 2..6: fully random rooms with contents -----------------
        // Room 2: { stair("up"), object() }
        await oracle_random_room(async (croom) => {
            await oracle_stair(croom, true);
            oracle_object(croom);
        });
        // Room 3: { stair("down"), object(), trap(), monster(), monster() }
        await oracle_random_room(async (croom) => {
            await oracle_stair(croom, false);
            oracle_object(croom);
            await oracle_trap(croom);
            oracle_monster(croom);
            oracle_monster(croom);
        });
        // Room 4: { object(), object(), monster() }
        await oracle_random_room(async (croom) => {
            oracle_object(croom);
            oracle_object(croom);
            oracle_monster(croom);
        });
        // Room 5: { object(), trap(), monster() }
        await oracle_random_room(async (croom) => {
            oracle_object(croom);
            await oracle_trap(croom);
            oracle_monster(croom);
        });
        // Room 6: { object(), trap(), monster() }
        await oracle_random_room(async (croom) => {
            oracle_object(croom);
            await oracle_trap(croom);
            oracle_monster(croom);
        });

        // ---- des.random_corridors() -> create_corridor(src=-1) -> makecorridors
        makecorridors();
    } finally {
        g._full_mon_gen = was_full;
        g.in_mklev = was_mklev;
    }

    // load_special finalize: wallification(1,0,COLNO-1,ROWNO-1) (not corrmaze).
    wallification(1, 0, COLNO - 1, ROWNO - 1);
}

// Build a fully-random room (no coords/size/align) and run its contents.
async function oracle_random_room(contents) {
    const g = game;
    rn2(100);                                       // build_room chance
    const ok = create_room(-1, -1, -1, -1, -1, -1, OROOM, -1);
    if (!ok) return;
    const croom = g.level.rooms[g.level.nroom - 1];
    if (!croom) return;
    topologize(croom);
    croom.needfill = FILL_NONE;   // filled inline, not by fill_ordinary_room
    if (contents) await contents(croom);
}

// des.stair(dir) with random coord: get_location_coord(random) -> somexy.
async function oracle_stair(croom, up) {
    const c = oracle_get_free_room_loc(croom);
    mkstairs(c.x, c.y, up ? 1 : 0, croom);
}

// des.object() fully random: get_location(random)->somexy, then mkobj_at(RANDOM).
function oracle_object(croom) {
    const c = oracle_get_free_room_loc(croom);
    mkobj_at(RANDOM_CLASS, c.x, c.y, true);
}

// des.monster() fully random: induced_align, somexy, makemon(rndmonst).
// C ref: sp_lev.c create_monster() — a random des.monster() resolves pm==NULL,
// picks a spot via get_location_coord(random)->somexy, then, if that spot is
// already occupied by a monster, relocates to a close free spot via enexto()
// (which shuffles collect_coords rings, consuming rn2 exactly as the C engine
// does).  If the relocated spot falls outside croom the monster is skipped.
function oracle_monster(croom) {
    oracle_induced_align();
    const c = oracle_get_free_room_loc(croom);
    // C: if (MON_AT(x, y) && enexto(&cc, x, y, pm)) x = cc.x, y = cc.y;  (pm==NULL)
    if (m_at(c.x, c.y)) {
        const cc = enexto_spawn(c.x, c.y, null);
        if (cc) { c.x = cc.x; c.y = cc.y; }
    }
    // C: if (croom && !inside_room(croom, x, y)) return;
    if (croom && !inside_room(croom, c.x, c.y)) return;
    make_monster(null, c.x, c.y, 0);
}

// des.trap() fully random: create_trap -> get_free_room_loc(somexy) ->
// mktrap(type=-1, MKTRAP_MAZEFLAG, croom=NULL, tm) — random traptype loop +
// victim gate.  C ref: sp_lev.c create_trap + mklev.c mktrap.
async function oracle_trap(croom) {
    const g = game;
    const c = oracle_get_free_room_loc(croom);      // somexy (get_free_room_loc)
    // is_pool_or_lava(tm) check: room floor is never pool here.
    let kind;
    kind = mktrap_random_kind();
    // C ref: mklev.c mktrap() `if (is_hole(kind) && !Can_fall_thru(&u.uz))`.
    // The local "dlevel < num_dunlevs" stand-in dropped Can_dig_down()'s
    // hardfloor and Invocation_lev tests, so a hole survived on levels C turns
    // into a ROCKTRAP — a different maketrap() and a different draw count.
    if (is_hole(kind) && !Can_fall_thru(g.u?.uz)) kind = ROCKTRAP;
    const trap = await maketrap(c.x, c.y, kind);
    kind = trap ? trap.ttyp : NO_TRAP;
    // C ref: sp_lev.c create_trap() -> mktrap(..., mktrap_flags, ...) — a
    // lua des.trap() defaults spider_on_web=TRUE (lspo_trap, sp_lev.c:4405),
    // so MKTRAP_NOSPIDERONWEB is normally NOT set; mktrap() then spawns a
    // giant spider on a freshly made WEB trap.
    if (kind === WEB) {
        const spiderPm = monster_by_pmidx(name_to_pmidx('giant spider'));
        if (spiderPm) make_monster(spiderPm, c.x, c.y, 0);
    }
    const lvl = level_difficulty();
    // victim gate (gi.in_mklev is true during gen)
    if (kind !== NO_TRAP
        && lvl <= rnd(4)
        && kind !== SQKY_BOARD && kind !== RUST_TRAP
        && !(kind === ROLLING_BOULDER_TRAP && trap.launch?.x === trap.tx && trap.launch?.y === trap.ty)
        && !is_pit(kind) && (kind < HOLE || kind === MAGIC_TRAP)) {
        if (kind === LANDMINE) { trap.ttyp = PIT; trap.tseen = true; }
        mktrap_victim(trap);
    }
}

// ============================================================
// Niches
// ============================================================

function cardinal_nextto_room(aroom, x, y) {
    const map = game.level;
    const rmno = game.level.rooms.indexOf(aroom) + ROOMOFFSET;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        if (!isok(x + dx, y + dy)) continue;
        const loc = map.at(x + dx, y + dy);
        if (loc && !loc.edge && loc.roomno === rmno) return true;
    }
    return false;
}

function place_niche(aroom) {
    let dy;
    const dd = { x: 0, y: 0 };
    if (rn2(2)) {
        dy = 1;
        if (!finddpos(dd, DIR_S, aroom)) return null;
    } else {
        dy = -1;
        if (!finddpos(dd, DIR_N, aroom)) return null;
    }
    const xx = dd.x, yy = dd.y;
    const niche = game.level.at(xx, yy + dy);
    const back = game.level.at(xx, yy - dy);
    if (!niche || niche.typ !== STONE) return null;
    if (!back || IS_POOL(back.typ) || IS_FURNITURE(back.typ)) return null;
    if (!cardinal_nextto_room(aroom, xx, yy)) return null;
    return { dy, xx, yy };
}

async function makeniche(trap_type) {
    const g = game;
    let vct = 8;
    while (vct--) {
        const aroom = g.level.rooms[rn2(g.level.nroom)];
        if (!aroom || aroom.rtype !== OROOM) continue;
        if (aroom.doorct === 1 && rn2(5)) continue;
        const niche = place_niche(aroom);
        if (!niche) continue;
        const { dy, xx, yy } = niche;
        const rm = g.level.at(xx, yy + dy);
        if (!rm) continue;
        if (trap_type || !rn2(4)) {
            rm.typ = SCORR;
            if (trap_type) {
                let actualTrap = trap_type;
                // C ref: mklev.c:762 `if (is_hole(trap_type) && !Can_fall_thru(&u.uz))
                // trap_type = ROCKTRAP;` — a hole/trapdoor niche degrades to a rock
                // trap ONLY on levels you cannot fall through (hardfloor, bottom of
                // the branch, the invocation level).  We used to downgrade
                // UNCONDITIONALLY, which cost hole_destination()'s rn2(4) and — since
                // trap_engravings[ROCKTRAP] is null where trap_engravings[TRAPDOOR] is
                // "Vlad was here" — the whole make_engr_at + wipe_engr_at cluster.
                if (is_hole(actualTrap) && !Can_fall_thru(game.u?.uz)) actualTrap = ROCKTRAP;
                const ttmp = await maketrap(xx, yy + dy, actualTrap);
                if (ttmp) {
                    if (actualTrap !== ROCKTRAP) ttmp.once = true;
                    const trapText = trap_engravings[actualTrap];
                    if (trapText) {
                        make_engr_at(xx, yy - dy, trapText, null, 0, DUST);
                        wipe_engr_at(xx, yy - dy, 5, false);
                    }
                }
            }
            dosdoor(xx, yy, aroom, SDOOR);
        } else {
            rm.typ = CORR;
            if (rn2(7)) {
                dosdoor(xx, yy, aroom, rn2(5) ? SDOOR : DOOR);
            } else {
                const loc = g.level.at(xx, yy);
                if (!rn2(5) && loc && IS_WALL(loc.typ)) {
                    loc.typ = IRONBARS;
                    if (rn2(3)) {
                        // inaccessible niches occasionally have iron bars with
                        // a human corpse behind them.  C: mkcorpstat(CORPSE,
                        // NULL, mkclass(S_HUMAN, 0), ...).  mkclass() consumes
                        // the rn2(9)-per-candidate / rn2(2) / rnd(num) stream.
                        const S_HUMAN = 53;
                        const hptr = mkclass(S_HUMAN, 0);
                        mkcorpstat(CORPSE, null, hptr ? hptr.pmidx : 0,
                                   xx, yy + dy, 1);
                    }
                }
                if (!g.level.flags.noteleport) {
                    mksobj_at(SCR_TELEPORTATION, xx, yy + dy, true, false);
                }
                if (!rn2(3)) {
                    mkobj_at(RANDOM_CLASS, xx, yy + dy, true);
                }
            }
        }
        return;
    }
}

// C ref: mklev.c makevtele() — `makeniche(TELEP_TRAP)`, nothing more.
async function makevtele() {
    await makeniche(TELEP_TRAP);
}

async function make_niches() {
    const g = game;
    // C ref: mklev.c:804-807 — `ct = rnd((svn.nroom >> 1) + 1), dep = depth(&u.uz)`
    // and `ltptr = (!svl.level.flags.noteleport && dep > 15)`.  Both gates read
    // depth(), NOT u.uz.dlevel: they differ in every branch dungeon (the Mines,
    // the Quest, Sokoban/Vlad's build upwards), and the missing noteleport test
    // let a no-teleport level draw the LEVEL_TELEP niche's rn2(6).
    let ct = rnd(Math.trunc(g.level.nroom / 2) + 1);
    const dep = depth_of_level(g.u?.uz);
    let ltptr = (!g.level.flags.noteleport && dep > 15);
    let vamp = (dep > 5 && dep < 25);
    while (ct--) {
        if (ltptr && !rn2(6)) {
            ltptr = false;
            await makeniche(LEVEL_TELEP);
        } else if (vamp && !rn2(6)) {
            vamp = false;
            await makeniche(TRAPDOOR);
        } else {
            await makeniche(NO_TRAP);
        }
    }
}

// ============================================================
// Branch placement
// ============================================================

function is_branchlev() {
    const g = game;
    if (!g.branches) return null;
    for (const br of g.branches) {
        if (br?.end1?.dnum === (g.u?.uz?.dnum ?? 0) && br?.end1?.dlevel === (g.u?.uz?.dlevel ?? 1)) return br;
        if (br?.end2?.dnum === (g.u?.uz?.dnum ?? 0) && br?.end2?.dlevel === (g.u?.uz?.dlevel ?? 1)) return br;
    }
    return null;
}

// C ref: mklev.c find_branch_room().  With rooms, the branch goes in a room
// picked by generate_stairs_find_room() at a somexyspace() spot inside it; with
// no rooms at all C falls back to mazexy().  Levels that reach branch placement
// with svn.nroom == 0 never call this in our port: place_lregion() (mkmaze.c)
// short-circuits to place_branch() only when nroom is non-zero, and otherwise
// runs its own whole-level rn1 loop and passes explicit coordinates
// (mk_fixup_branch below), so the mazexy() arm is unreachable here.
function find_branch_room(mp) {
    const croom = generate_stairs_find_room();
    if (croom) somexyspace(croom, mp);
    return croom;
}

// C ref: mklev.c mktrap() — the random-trap-type selection chain for a call
// with no explicit type:
//   Is_rogue_level -> traptype_roguelvl()
//   Inhell && !rn2(5) -> FIRE_TRAP        ("bias the frequency of fire traps
//                                          in Gehennom")
//   otherwise -> the do/while traptype_rnd() loop.
// The rn2(5) is only reached in Gehennom, so this is RNG-neutral elsewhere.
function mktrap_random_kind() {
    if (In_hell(game.u?.uz) && !rn2(5)) return FIRE_TRAP;  // mklev.c:2070
    let kind;
    do { kind = traptype_rnd(); } while (kind === NO_TRAP);
    return kind;
}

// C ref: mklev.c place_branch(br, x, y) — "If given a branch, randomly place a
// special stair or portal."  x == 0 means "find random coordinates" (the
// makelevel() call); every other caller — put_lregion_here(LR_BRANCH), the
// castle/mines fixup_special loops — hands it an explicit spot.
// A BR_PORTAL branch (the Quest) puts a MAGIC_PORTAL trap on the square and
// leaves the terrain alone, everything else gets a staircase — and a
// BR_NO_END1/BR_NO_END2 branch gets neither on the end declared stairless.
// C ref: mklev.c mk_knox_portal(x, y) — offer this level as the Fort Ludios
// entrance.  The rn2(3) "defer to a later level" roll is only reached while the
// branch is still floating (end1.dnum == n_dgns, the init_dungeons kludge); once
// Knox has been placed every later vault level skips the roll entirely, which is
// what keeps the makevtele() gate that follows it aligned.
async function mk_knox_portal(x, y) {
    const g = game;
    if (process.env.DBG_KNOX) console.error('DBG mk_knox_portal uz=', JSON.stringify(g.u?.uz));
    const knox = g.knox_level;
    if (!knox) return;
    const br = (g.branches || []).find(
        (b) => b?.end2?.dnum === knox.dnum && b?.end2?.dlevel === knox.dlevel);
    if (!br) return;

    let source;
    if (br.end1.dnum === knox.dnum && br.end1.dlevel === knox.dlevel) {
        source = br.end2;
    } else {
        // disallow Knox branch on a level with one branch already
        if (is_branchlev()) return;
        source = br.end1;
    }
    // Already set, or 2/3 chance of deferring until a later level (the roll is
    // left of the `&& !wizard`, so debug mode still consumes it).
    if (source.dnum < g.n_dgns || (rn2(3) && !g.flags?.debug)) return;

    const uz = g.u?.uz || { dnum: 0, dlevel: 1 };
    const u_depth = depth_of_level(uz);
    const oracle_dnum = g.oracle_level?.dnum ?? 0;
    const medusaDepth = g.medusa_level ? depth_of_level(g.medusa_level) : 999;
    // at_dgn_entrance("The Quest"): this level is the quest branch's parent end.
    const questBr = (g.branches || []).find((b) => b?.end2?.dnum === g.quest_dnum);
    const at_quest_entrance = !!questBr && questBr.end1.dnum === uz.dnum
        && questBr.end1.dlevel === uz.dlevel;
    if (!(uz.dnum === oracle_dnum && !at_quest_entrance
          && u_depth > 10 && u_depth < medusaDepth))
        return;

    source.dnum = uz.dnum;
    source.dlevel = uz.dlevel;
    // insert_branch(br, TRUE) only re-sorts svb.branches; no RNG, no state the
    // rest of this port reads by list position.
    await place_branch(br, x, y);
}

async function place_branch(br, x, y) {
    const g = game;
    // C ref: mklev.c:1230 — "Return immediately if there is no branch to make
    // or we have already made one."  A special level that names an SSTAIR spot
    // gets here twice.
    if (!br || g.made_branch) return;

    if (!x) { // find random coordinates for branch
        const m = { x: 0, y: 0 };
        const croom = find_branch_room(m);
        x = m.x; y = m.y;
        // C asserts croom != NULL and impossible()s when somexyspace() fails;
        // bail out rather than write the branch to an off-map cell, but still
        // set made_branch as C does below.
        if (!croom || !x) { g.made_branch = true; return; }
    }
    // C's `else (void) pos_to_room(x, y);` only caches gl.lastseentyp; no RNG.

    const on_end1 = (br.end1?.dnum === g.u?.uz?.dnum
                     && br.end1?.dlevel === g.u?.uz?.dlevel);
    const dest = on_end1 ? br.end2 : br.end1;
    const make_stairs = on_end1 ? (br.type !== BR_NO_END1)
                                : (br.type !== BR_NO_END2);

    if (br.type === BR_PORTAL) {
        // C's other arm needs iflags.debug_fuzzer, never set in a recording.
        await mkportal(x, y, dest?.dnum ?? 0, dest?.dlevel ?? 0);
    } else if (make_stairs) {
        const goes_up = on_end1 ? !!br.end1_up : !br.end1_up;
        stairway_add(x, y, goes_up, false, dest || { dnum: 0, dlevel: 0 });
        const loc = g.level?.at(x, y);
        if (loc) {
            loc.typ = STAIRS;
            loc.ladder = goes_up ? LA_UP : LA_DOWN;
        }
        if (goes_up) g.level.upstair = { x, y };
        else g.level.dnstair = { x, y };
    }
    // C: set made_branch even when no stairwell was made (make_stairs false) —
    // there is only one branch per level, so a retry would fail the same way.
    g.made_branch = true;
}

// ============================================================
// Wallification
// ============================================================

function isSolidTile(x, y) {
    if (!isok(x, y)) return true;
    return IS_STWALL(game.level?.at(x, y)?.typ ?? STONE);
}
function isWallOrStone(x, y) {
    if (!isok(x, y)) return 1;
    const typ = game.level?.at(x, y)?.typ ?? STONE;
    return (typ === STONE || isWallTile(x, y)) ? 1 : 0;
}
function isWallTile(x, y) {
    if (!isok(x, y)) return 0;
    const typ = game.level?.at(x, y)?.typ ?? STONE;
    return (IS_WALL(typ) || IS_DOOR(typ) || typ === LAVAWALL
        || typ === WATER || typ === SDOOR || typ === IRONBARS) ? 1 : 0;
}
function extend_spine(locale, wall_there, dx, dy) {
    const nx = 1 + dx, ny = 1 + dy;
    if (!wall_there) return 0;
    if (dx) {
        if (locale[1][0] && locale[1][2] && locale[nx][0] && locale[nx][2]) return 0;
        return 1;
    }
    if (locale[0][1] && locale[2][1] && locale[0][ny] && locale[2][ny]) return 0;
    return 1;
}
function wall_cleanup(x1, y1, x2, y2) {
    const map = game.level;
    if (!map) return;
    for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++) {
            const loc = map.at(x, y);
            const typ = loc?.typ ?? STONE;
            if (!(IS_WALL(typ) && typ !== DBWALL)) continue;
            if (isSolidTile(x-1,y-1) && isSolidTile(x-1,y) && isSolidTile(x-1,y+1)
                && isSolidTile(x,y-1) && isSolidTile(x,y+1)
                && isSolidTile(x+1,y-1) && isSolidTile(x+1,y) && isSolidTile(x+1,y+1))
                loc.typ = STONE;
        }
}
function fix_wall_spines(x1, y1, x2, y2) {
    const spineArray = [VWALL, HWALL, HWALL, HWALL,
        VWALL, TRCORNER, TLCORNER, TDWALL,
        VWALL, BRCORNER, BLCORNER, TUWALL,
        VWALL, TLWALL, TRWALL, CROSSWALL];
    const map = game.level;
    if (!map) return;
    for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++) {
            const loc = map.at(x, y);
            const typ = loc?.typ ?? STONE;
            if (!(IS_WALL(typ) && typ !== DBWALL)) continue;
            const locale = [
                [isWallOrStone(x-1,y-1), isWallOrStone(x-1,y), isWallOrStone(x-1,y+1)],
                [isWallOrStone(x,y-1), 0, isWallOrStone(x,y+1)],
                [isWallOrStone(x+1,y-1), isWallOrStone(x+1,y), isWallOrStone(x+1,y+1)],
            ];
            const bits = (extend_spine(locale, isWallTile(x,y-1), 0, -1) << 3)
                | (extend_spine(locale, isWallTile(x,y+1), 0, 1) << 2)
                | (extend_spine(locale, isWallTile(x+1,y), 1, 0) << 1)
                | extend_spine(locale, isWallTile(x-1,y), -1, 0);
            if (bits) loc.typ = spineArray[bits];
        }
}
export function wallification(x1, y1, x2, y2) {
    wall_cleanup(x1, y1, x2, y2);
    fix_wall_spines(x1, y1, x2, y2);
}

// ============================================================
// Fill ordinary room
// ============================================================

function traptype_rnd() {
    const lvl = level_difficulty();
    let kind = rnd(TRAPNUM - 1);
    switch (kind) {
    case TRAPPED_DOOR: case TRAPPED_CHEST: case MAGIC_PORTAL: case VIBRATING_SQUARE:
        kind = NO_TRAP; break;
    case ROLLING_BOULDER_TRAP: case SLP_GAS_TRAP:
        if (lvl < 2) kind = NO_TRAP; break;
    case LEVEL_TELEP:
        // C ref: mklev.c:1962 — the third term, `single_level_branch(&u.uz)`,
        // was missing.  dungeon.c's body is literally `return Is_knox(lev)`, so
        // on Fort Ludios C refuses a LEVEL_TELEP and we accepted one: a
        // different trap type, and every later mklev draw shifted.
        if (lvl < 5 || game.level?.flags?.noteleport
            || Is_knox_level(game.u?.uz)) kind = NO_TRAP;
        break;
    case SPIKED_PIT:
        if (lvl < 5) kind = NO_TRAP; break;
    case LANDMINE:
        if (lvl < 6) kind = NO_TRAP; break;
    case WEB:
        if (lvl < 7) kind = NO_TRAP; break;
    case STATUE_TRAP: case POLY_TRAP:
        if (lvl < 8) kind = NO_TRAP; break;
    case FIRE_TRAP:
        // C ref: mklev.c traptype_rnd() — `if (!Inhell) kind = NO_TRAP;`.
        // Fire traps only generate randomly in Gehennom.
        if (!In_hell(game.u?.uz)) kind = NO_TRAP;
        break;
    case TELEP_TRAP:
        if (game.level?.flags?.noteleport) kind = NO_TRAP; break;
    case HOLE:
        if (rn2(7)) kind = NO_TRAP; break;
    }
    return kind;
}

function find_okay_roompos(croom, crd) {
    let tryct = 0;
    do {
        if (++tryct > 200) return false;
        if (!somexyspace(croom, crd)) return false;
    } while (occupied(crd.x, crd.y) || bydoor(crd.x, crd.y));
    return true;
}

// C ref: dothrow.c breaktest(obj) — used by mktrap_victim()'s PIT (exploded
// landmine) branch to discard fragile possessions.  Rolls obj_resists(obj,1,99)
// (rn2(100)); only the RNG side-effect + glass/potion/egg/etc verdict matter
// here.  No glass armor reaches a trap-victim, so the ARMOR/GLASS nonbreakchance
// tweak is irrelevant but kept faithful.
function breaktest(otmp) {
    const GLASS_MATERIAL = 19; // objclass.h obj_material_types GLASS
    const POT_WATER = 322, EGG = 266, EXPENSIVE_CAMERA = 229;
    const CREAM_PIE = 287, MELON = 280, ACID_VENOM = 480, BLINDING_VENOM = 479;
    const od = objects[otmp.otyp] || {};
    let nonbreakchance = 1;
    if (otmp.oclass === ARMOR_CLASS && od.material === GLASS_MATERIAL)
        nonbreakchance = 90;
    if (obj_resists(otmp, nonbreakchance, 99))
        return false;
    if (od.material === GLASS_MATERIAL && !otmp.oartifact
        && otmp.oclass !== GEM_CLASS)
        return true;
    const key = (otmp.oclass === POTION_CLASS) ? POT_WATER : otmp.otyp;
    switch (key) {
    case EXPENSIVE_CAMERA:
    case POT_WATER:
    case EGG:
    case CREAM_PIE:
    case MELON:
    case ACID_VENOM:
    case BLINDING_VENOM:
        return true;
    default:
        return false;
    }
}

set_mktrap_victim(mktrap_victim);
function mktrap_victim(trap) {
    const lvl = game.u?.uz?.dlevel ?? 1;
    const kind = trap.ttyp;
    const x = trap.tx, y = trap.ty;
    // Object generated by the trap (placed on the floor at the trap square).
    // C ref: mklev.c mktrap_victim() — ARROW_TRAP also clears opoisoned.
    let otmp = null;
    switch (kind) {
    case ARROW_TRAP: otmp = mksobj(ARROW, true, false); otmp.opoisoned = 0; break;
    case DART_TRAP: otmp = mksobj(DART, true, false); break;
    case ROCKTRAP: otmp = mksobj(ROCK, true, false); break;
    default: break;
    }
    if (otmp) place_object(otmp, x, y);
    // Random items on victim — each cursed and placed at (x,y).  C ref: mklev.c
    // mktrap_victim() do/while loop; for a PIT (exploded landmine) a fragile item
    // is destroyed (breaktest) instead of placed.
    do {
        const cls = [WEAPON_CLASS, TOOL_CLASS, FOOD_CLASS, GEM_CLASS][rn2(4)];
        otmp = mkobj(cls, false);
        curse(otmp);
        if (kind === PIT && breaktest(otmp)) {
            // dealloc: object never reaches the floor (matches C dealloc_obj).
        } else {
            place_object(otmp, x, y);
        }
    } while (!rn2(5));
    // Victim type.  C ref: include/monsters.h / pm.h global mons[] indices —
    // these are the real PM_* constants (the corpse's corpsenm, which drives the
    // displayed corpse color via mon_color = mons[corpsenm].mcolor).  The prior
    // placeholder values (18..22, 338, 350) produced wrong-species corpses (e.g.
    // an "orc" rendered as a gray wolf corpse instead of the red orc C records).
    const PM_ELF = 264, PM_DWARF = 44, PM_ORC = 72, PM_GNOME = 165, PM_HUMAN = 260;
    const PM_ARCHEOLOGIST = 331, PM_WIZARD = 343;
    let victim_mnum;
    switch (rn2(15)) {
    case 0:
        victim_mnum = PM_ELF;
        if (kind === SLP_GAS_TRAP && !(lvl <= 2 && rn2(2))) victim_mnum = PM_HUMAN;
        break;
    case 1: case 2: victim_mnum = PM_DWARF; break;
    case 3: case 4: case 5: victim_mnum = PM_ORC; break;
    case 6: case 7: case 8: case 9:
        victim_mnum = PM_GNOME;
        // 10% chance of a candle too — placed on the floor and (if the square is
        // unlit) lit.  C ref: mklev.c mktrap_victim().
        if (!rn2(10)) {
            otmp = mksobj(rn2(4) ? 370 : 371, true, false); // TALLOW_CANDLE / WAX_CANDLE
            otmp.quan = 1;
            otmp.owt = weight(otmp);
            curse(otmp);
            place_object(otmp, x, y);
            // C begin_burn(otmp, FALSE): mark the candle lit on an unlit square.
            // No RNG; the light-source list isn't modelled, so just set lamplit.
            if (!game.level?.at(x, y)?.lit) otmp.lamplit = 1;
        }
        break;
    default: victim_mnum = PM_HUMAN; break;
    }
    if (victim_mnum === PM_HUMAN && rn2(25))
        victim_mnum = rn1(PM_WIZARD - PM_ARCHEOLOGIST, PM_ARCHEOLOGIST);
    // C ref: mklev.c — the corpse is placed at (x,y) (mksobj_at via mkcorpstat)
    // and aged past TAINT_AGE so it can't be safely eaten.
    otmp = mkcorpstat(CORPSE, null, victim_mnum, x, y, 8); // CORPSTAT_INIT
    if (otmp) otmp.age = (otmp.age || 0) - (TAINT_AGE + 1);
}

// C ref: invent.c sobj_at(BOULDER, x, y) — mktrap()'s pit/hole placement test.
function mk_sobj_at_boulder(x, y) {
    for (const o of game.level?.objects ?? [])
        if (o.where === 'floor' && o.ox === x && o.oy === y && o.otyp === BOULDER)
            return true;
    return false;
}

async function mktrap_room(croom) {
    let kind;
    kind = mktrap_random_kind();
    // C ref: mklev.c mktrap() — Can_fall_thru(), not a bare bottom-level test.
    if (is_hole(kind) && !Can_fall_thru(game.u?.uz)) kind = ROCKTRAP;
    // C ref: mklev.c mktrap() — retry the spot until it is neither occupied()
    // nor (for a pit/hole) on top of a boulder.  somexyspace() already rejects
    // occupied squares, so in practice only the boulder test re-rolls.
    const pos = { x: 0, y: 0 };
    {
        const avoid_boulder = (is_pit(kind) || is_hole(kind));
        let tryct = 0;
        do {
            if (++tryct > 200) return;
            if (!somexyspace(croom, pos)) return;
        } while (occupied(pos.x, pos.y)
                 || (avoid_boulder && mk_sobj_at_boulder(pos.x, pos.y)));
    }
    const trap = await maketrap(pos.x, pos.y, kind);
    kind = trap ? trap.ttyp : NO_TRAP;
    // C ref: mklev.c mktrap() — `if (kind == WEB && !(mktrapflags &
    // MKTRAP_NOSPIDERONWEB)) makemon(&mons[PM_GIANT_SPIDER], m.x, m.y,
    // NO_MM_FLAGS);`.  fill_ordinary_room() calls mktrap() with mktrapflags
    // 0, so the flag is clear and the spider is always made.  This is the
    // same call the maze (mk_trap) and des.trap (oracle_trap) paths already
    // make; it was missing only here.
    if (kind === WEB) {
        const spiderPm = monster_by_pmidx(name_to_pmidx('giant spider'));
        // Through the local makemon() wrapper, not the bare make_monster():
        // C links the spider into fmon like any other monster, and calling
        // make_monster() directly created it (consuming the right RNG) but
        // never put it on the level — so it was absent from the map and, more
        // damagingly, missing from every later movemon()/mcalcmove() pass,
        // which costs one rn2(12) per turn for the rest of the level.
        if (spiderPm) await makemon(spiderPm, pos.x, pos.y, 0);
    }
    // C ref: mklev.c mktrap() — `unsigned lvl = level_difficulty();`, not the
    // raw dlevel: in a branch dungeon (Mines/Quest/Gehennom) depth differs
    // from dlevel, and Sokoban/Vlad's Tower build upwards.
    const lvl = level_difficulty();
    const was_in_mklev = game.in_mklev;
    game.in_mklev = true;
    try {
        if (kind !== NO_TRAP
            && lvl <= rnd(4)
            && kind !== SQKY_BOARD && kind !== RUST_TRAP
            && !(kind === ROLLING_BOULDER_TRAP && trap.launch?.x === trap.tx && trap.launch?.y === trap.ty)
            && !is_pit(kind) && (kind < HOLE || kind === MAGIC_TRAP)) {
            if (kind === LANDMINE) { trap.ttyp = PIT; trap.tseen = true; }
            mktrap_victim(trap);
        }
    } finally {
        game.in_mklev = was_in_mklev;
    }
}

function mkfount(croom) {
    const pos = { x: 0, y: 0 };
    if (!find_okay_roompos(croom, pos)) return;
    const loc = game.level?.at(pos.x, pos.y);
    if (loc) {
        loc.typ = FOUNTAIN;
        if (!rn2(7)) loc.blessedftn = 1;
        game.level.flags.nfountains++;
    }
}

function mkaltar(croom) {
    if (!croom || croom.rtype !== OROOM) return;
    const pos = { x: 0, y: 0 };
    if (!find_okay_roompos(croom, pos)) return;
    const loc = game.level?.at(pos.x, pos.y);
    if (!loc) return;
    loc.typ = ALTAR;
    const al = rn2(A_LAWFUL + 2) - 1;
    loc.flags = Align2amask(al);
}

function mkgrave_room(croom) {
    // C ref: mklev.c mkgrave() — `boolean dobell = !rn2(10);` is a DECLARATION
    // INITIALISER, so it runs before the `croom->rtype != OROOM` return.  The
    // port had the rtype test first, which silently skipped the rn2(10) for
    // every THEMEROOM (fill_ordinary_room admits OROOM *and* THEMEROOM, so a
    // themed room reaching the grave gate desynced the stream from here on).
    const dobell = !rn2(10);
    if (croom.rtype !== OROOM) return;
    const pos = { x: 0, y: 0 };
    if (!find_okay_roompos(croom, pos)) return;
    make_grave(pos.x, pos.y, dobell ? 'Saved by the bell!' : null);
    if (!rn2(3)) {
        const gold = mksobj(GOLD_PIECE, true, false);
        if (gold) {
            // C: rnd(20) + level_difficulty() * rnd(5) — not u.uz.dlevel.
            gold.quan = rnd(20) + level_difficulty() * rnd(5);
            gold.owt = weight(gold);
            gold.ox = pos.x; gold.oy = pos.y;
            bury_object(gold);
        }
    }
    for (let tryct = rn2(5); tryct > 0; tryct--) {
        const otmp = mkobj(RANDOM_CLASS, true);
        if (!otmp) return;
        curse(otmp);
        otmp.ox = pos.x; otmp.oy = pos.y;
        bury_object(otmp);
    }
    if (dobell) mksobj_at(BELL, pos.x, pos.y, true, false);
}

export async function fill_ordinary_room(croom, bonus_items) {
    const g = game;
    if (!croom || (croom.rtype !== OROOM && croom.rtype !== THEMEROOM)) return;
    // C ref: mklev.c:954-963 — subrooms are filled BEFORE the needfill gate, so
    // an unfilled outer room can't block a fillable inner one.  Omitting this
    // spent the subroom's draws on the PARENT: somex/somey took the parent's
    // dimensions as their rn2 modulus, so the objects landed in the wrong room.
    for (let si = 0; si < (croom.nsubrooms ?? 0); ++si) {
        const subroom = croom.sbrooms?.[si];
        if (!subroom) return;               // C: impossible() then return
        await fill_ordinary_room(subroom, false);
    }
    if (croom.needfill !== FILL_NORMAL) return;

    const pos = { x: 0, y: 0 };
    // Sleeping monster.  C ref: mklev.c:974 `(u.uhave.amulet || !rn2(3))` — the
    // Amulet short-circuits the roll away entirely (every room gets a monster
    // and no rn2(3) is drawn), and a giant spider that lands on a free square
    // gets a WEB under it.  Both halves were missing: the web is a real trap
    // object (t_at/occupied/display) and maketrap() writes level state.
    if ((g.u?.uhave?.amulet || !rn2(3)) && somexyspace(croom, pos)) {
        const tmonst = await makemon(null, pos.x, pos.y, 0x00002000); // MM_NOGRP
        if (tmonst && tmonst.data?.pmidx === PM_GIANT_SPIDER
            && !occupied(pos.x, pos.y))
            await maketrap(pos.x, pos.y, WEB);
    }
    // Traps.  C ref: mklev.c:988 `x = 8 - (level_difficulty() / 6);` — the trap
    // count modulus is level_difficulty(), NOT u.uz.dlevel; they differ in every
    // branch dungeon (depth_start offset) and in the two build-up branches.
    let x = 8 - Math.trunc(level_difficulty() / 6);
    if (x <= 1) x = 2;
    let trycnt = 0;
    while (!rn2(x) && ++trycnt < 1000) {
        await mktrap_room(croom);
    }
    // Gold
    if (!rn2(3) && somexyspace(croom, pos)) {
        mkgold(0, pos.x, pos.y);
    }
    // Fountain
    if (!rn2(10)) mkfount(croom);
    // Sink
    if (!rn2(60)) {
        if (find_okay_roompos(croom, pos)) {
            const loc = g.level?.at(pos.x, pos.y);
            if (loc) { loc.typ = SINK; g.level.flags.nsinks = (g.level.flags.nsinks || 0) + 1; }
        }
    }
    // Altar
    if (!rn2(60)) mkaltar(croom);
    // Grave.  C ref: mklev.c:1000 `x = 80 - (depth(&u.uz) * 2);` — depth(), not
    // u.uz.dlevel: the modulus is wrong in every branch dungeon.
    x = 80 - (depth_of_level(g.u?.uz) * 2);
    if (x < 2) x = 2;
    if (!rn2(x)) mkgrave_room(croom);
    // Statue
    if (!rn2(20) && somexyspace(croom, pos)) {
        mkcorpstat(STATUE, null, null, pos.x, pos.y, 8);
    }
    // Bonus items
    let skip_chests = false;
    if (bonus_items && somexyspace(croom, pos)) {
        const branchp = is_branchlev();
        const uz = g.u?.uz ?? { dnum: 0, dlevel: 1 };
        const mines_dnum = g.mines_dnum;
        const oracle_level = g.oracle_level ?? { dnum: 0, dlevel: 5 };
        const uz_branch = Number.isInteger(branchp?.id) ? branchp : null;
        if (uz_branch && uz.dnum !== mines_dnum
            && (uz_branch.end1?.dnum === mines_dnum || uz_branch.end2?.dnum === mines_dnum)) {
            // Mines entrance bonus food
            mksobj_at((rn2(5) < 3) ? FOOD_RATION : rn2(2) ? CRAM_RATION : LEMBAS_WAFER,
                pos.x, pos.y, true, false);
        } else if (uz.dnum === oracle_level.dnum && uz.dlevel < oracle_level.dlevel && rn2(3)) {
            // Supply chest.  C ref: mklev.c fill_ordinary_room() supply-chest
            // branch — the rolled items are added INTO the chest (add_to_container);
            // the chest weight is recomputed at the end.  (The previous port rolled
            // the items but discarded them, leaving the chest empty, which broke
            // #force/loot of the chest's contents downstream.)
            const supply_chest = mksobj_at(rn2(3) ? CHEST : LARGE_BOX, pos.x, pos.y, false, false);
            if (supply_chest) {
                supply_chest.olocked = !!rn2(6);
                let tryct2 = 0;
                let cursed_item;
                do {
                    let otyp;
                    const supply_items = [POT_EXTRA_HEALING, POT_SPEED, POT_GAIN_ENERGY,
                        SCR_ENCHANT_WEAPON, SCR_ENCHANT_ARMOR, SCR_CONFUSE_MONSTER,
                        SCR_SCARE_MONSTER, WAN_DIGGING, SPE_HEALING];
                    if (rn2(2)) otyp = POT_HEALING;
                    else otyp = supply_items[rn2(supply_items.length)];
                    const otmp = mksobj(otyp, true, false);
                    if (otmp && otyp === POT_HEALING && rn2(2)) {
                        otmp.quan = 2;
                        otmp.owt = weight(otmp);
                    }
                    cursed_item = otmp?.cursed ?? false;
                    add_to_container(supply_chest, otmp);
                    if (++tryct2 >= 50) break;
                } while (cursed_item || !rn2(5));
                if (rn2(3)) {
                    const extra_classes = [FOOD_CLASS, WEAPON_CLASS, ARMOR_CLASS, GEM_CLASS,
                        SCROLL_CLASS, POTION_CLASS, RING_CLASS,
                        SPBOOK_no_NOVEL, SPBOOK_no_NOVEL, SPBOOK_no_NOVEL];
                    const oclass = extra_classes[rn2(extra_classes.length)];
                    let otmp = mkobj(oclass, false);
                    if (oclass === SPBOOK_no_NOVEL && otmp) {
                        // Bias towards a lower-level spellbook: re-roll maxpass
                        // times and keep the lowest-oc_level book.  C ref:
                        // mklev.c — compares objects[].oc_level, dealloc the
                        // higher one.
                        // C: maxpass = (depth(&u.uz) > 2) ? 2 : 3.
                        const maxpass = (depth_of_level(g.u?.uz) > 2) ? 2 : 3;
                        for (let pass = 1; pass <= maxpass; pass++) {
                            const otmp2 = mkobj(oclass, false);
                            if (spell_level(otmp.otyp) <= spell_level(otmp2.otyp)) {
                                // keep otmp (otmp2 discarded)
                            } else {
                                otmp = otmp2;
                            }
                        }
                    }
                    add_to_container(supply_chest, otmp);
                }
                // C: add_to_container() doesn't update the container weight.
                supply_chest.owt = weight(supply_chest);
            }
            skip_chests = true;
        }
    }
    // Box/chest check
    if (!skip_chests && !rn2(Math.trunc(g.level.nroom * 5 / 2)) && somexyspace(croom, pos)) {
        mksobj_at(rn2(3) ? LARGE_BOX : CHEST, pos.x, pos.y, true, false);
    }
    // Graffiti.  C ref: mklev.c:1131 `!rn2(27 + 3 * abs(depth(&u.uz)))` —
    // depth(), not u.uz.dlevel.
    const depth = depth_of_level(g.u?.uz);
    if (!rn2(27 + 3 * Math.abs(depth))) {
        const { text: engrText, pristine } = random_engraving();
        if (engrText) {
            do {
                somexyspace(croom, pos);
                if (g.level?.at(pos.x, pos.y)?.typ === ROOM) break;
            } while (!rn2(40));
            if (g.level?.at(pos.x, pos.y)?.typ === ROOM)
                make_engr_at(pos.x, pos.y, engrText, pristine, 0, MARK);
        }
    }
    // Random objects
    if (!rn2(3) && somexyspace(croom, pos)) {
        mkobj_at(RANDOM_CLASS, pos.x, pos.y, true);
        let objTrycnt = 0;
        while (!rn2(5)) {
            if (++objTrycnt > 100) break;
            if (somexyspace(croom, pos)) mkobj_at(RANDOM_CLASS, pos.x, pos.y, true);
        }
    }
}

// ============================================================
// Mineralize
// ============================================================

function water_has_kelp(x, y, kelp_pool, kelp_moat) {
    const loc = game.level.at(x, y);
    if (!loc) return false;
    if (kelp_pool && (loc.typ === POOL || loc.typ === WATER) && !rn2(kelp_pool)) return true;
    if (kelp_moat && loc.typ === MOAT && !rn2(kelp_moat)) return true;
    return false;
}

function mineralize_kelp(kelp_pool, kelp_moat) {
    if (kelp_pool < 0) kelp_pool = 10;
    if (kelp_moat < 0) kelp_moat = 30;
    for (let x = 2; x < COLNO - 2; x++)
        for (let y = 1; y < ROWNO - 1; y++)
            if (water_has_kelp(x, y, kelp_pool, kelp_moat))
                mksobj_at(KELP_FROND, x, y, true, false);
}

// C ref: mkobj.c add_to_buried(otmp) — moves the object onto the level's buried
// chain (svl.level.buriedobjlist).  Buried objects are NOT on the floor (fobj),
// so the pet's dog_goal scan never sees them; we only need them off level.objects.
// Tracking them keeps weight/RNG bookkeeping faithful without affecting display.
function bury_object(otmp) {
    if (!otmp) return otmp;
    otmp.where = 'buried';
    const lvl = game.level;
    if (lvl) {
        if (!lvl.buriedobjs) lvl.buriedobjs = [];
        lvl.buriedobjs.push(otmp);
    }
    return otmp;
}

export function mineralize(kelp_pool, kelp_moat, goldprob, gemprob, skip_lvl_checks) {
    const map = game.level;
    // C ref: mklev.c:1461 — "Place kelp, except on the plane of water": the
    // In_endgame() bail sits BEFORE the kelp scan, and water_has_kelp() draws an
    // rn2 per POOL/WATER/MOAT square.  The Plane of Water is almost entirely
    // water, so omitting this guard spent thousands of draws C never makes.
    if (!skip_lvl_checks && In_endgame(game.u?.uz)) return;
    mineralize_kelp(kelp_pool, kelp_moat);
    // C ref: mklev.c mineralize() — gold/gem seeding is skipped (after kelp) for
    // almost all special levels: In_hell || In_V_tower || Is_rogue_level ||
    // arboreal || (Is_special && !Is_oracle && (!In_mines || sp->flags.town)).
    // In_V_tower is subsumed here: every Vlad's Tower level is a named special
    // (tower1/2/3) with a non-oracle proto outside the Mines, so the Is_special
    // clause already returns for it.
    // The `town` half is what decides Mine Town: it IS a mines special level,
    // so the !In_mines half is false, but flags.town makes the clause true and
    // the gold/gem loop is suppressed.  A non-town mines special (minend) keeps
    // its minerals.  This used to read `proto !== 'minetn'`, i.e. exactly
    // backwards on both counts.
    if (!skip_lvl_checks) {
        const uz = game.u?.uz;
        const sp = Is_special(uz);
        const inMines = game.mines_dnum != null && uz?.dnum === game.mines_dnum;
        const isTown = !!(sp && sp.flags && sp.flags.town);
        if (In_hell(uz) || game.level?.flags?.arboreal
            || (sp && sp.proto && sp.proto.toLowerCase() !== 'oracle'
                && (!inMines || isTown))) {
            return;
        }
    }
    const absDepth = depth_of_level(game.u?.uz);
    const dunLevel = game.u?.uz?.dlevel ?? 1;
    if (goldprob < 0) goldprob = 20 + Math.trunc(absDepth / 3);
    if (gemprob < 0) gemprob = Math.trunc(goldprob / 4);
    // C ref: mklev.c mineralize() — mines have MORE goodies, quest fewer.
    if (!skip_lvl_checks) {
        const dnum = game.u?.uz?.dnum ?? 0;
        if (game.mines_dnum != null && dnum === game.mines_dnum) {
            goldprob *= 2; gemprob *= 3;
        } else if (game.quest_dnum != null && dnum === game.quest_dnum) {
            goldprob = Math.trunc(goldprob / 4);
            gemprob = Math.trunc(gemprob / 6);
        }
    }
    for (let x = 2; x < COLNO - 2; x++) {
        for (let y = 1; y < ROWNO - 1; y++) {
            const loc = map.at(x, y);
            const locBelow = map.at(x, y + 1);
            if (!loc || !locBelow) continue;
            if (locBelow.typ !== STONE) { y += 2; continue; }
            if (loc.typ !== STONE) { y += 1; continue; }
            const n = (d) => { const l = map.at(x + d[0], y + d[1]); return l && l.typ === STONE; };
            if (!(loc.wall_info & W_NONDIGGABLE)
                && n([0,-1]) && n([1,-1]) && n([-1,-1])
                && n([1,0]) && n([-1,0])
                && n([1,1]) && n([-1,1])) {
                // C ref: mklev.c mineralize() — seed rock areas with gold/gems.
                // ~2/3 land on the floor (place_object) and ~1/3 are buried
                // (add_to_buried); the rn2(3) chooses.  These floor objects sit
                // on UNSEEN/DARK stone squares, so they never show on the map,
                // but they DO join the fobj chain and are scanned by the pet's
                // dog_goal object loop (obj_resists rn2(100) each).  Earlier the
                // JS port created them (matching RNG) but discarded both branches,
                // under-populating fobj and desyncing the multi-pass pet scan.
                if (rn2(1000) < goldprob) {
                    const otmp = mksobj(GOLD_PIECE, false, false);
                    if (otmp) {
                        otmp.ox = x; otmp.oy = y;
                        otmp.quan = 1 + rnd(goldprob * 3);
                        otmp.owt = weight(otmp);
                        if (!rn2(3)) bury_object(otmp);
                        else place_object(otmp, x, y);
                    }
                }
                if (rn2(1000) < gemprob) {
                    const cnt = rnd(2 + Math.trunc(dunLevel / 3));
                    for (let i = 0; i < cnt; i++) {
                        const otmp = mkobj(GEM_CLASS, false);
                        if (!otmp) continue;
                        if (otmp.otyp === ROCK) {
                            // C: dealloc_obj(otmp) — discard (no rn2(3), no place).
                        } else {
                            otmp.ox = x; otmp.oy = y;
                            if (!rn2(3)) bury_object(otmp);
                            else place_object(otmp, x, y);
                        }
                    }
                }
            }
        }
    }
}

// ============================================================
// Level finalize topology
// ============================================================

function get_level_extends() {
    const map = game.level;
    let xmin = 0, xmax = COLNO - 1, ymin = 0, ymax = ROWNO - 1;
    let found = false, nonwall = false;
    for (xmin = 0; !found && xmin <= COLNO - 1; xmin++) {
        for (let y = 0; y <= ROWNO - 1; y++) {
            const typ = map.at(xmin, y)?.typ ?? STONE;
            if (typ !== STONE) { found = true; if (!IS_WALL(typ)) nonwall = true; }
        }
    }
    xmin -= (nonwall || !game.level?.flags?.is_maze_lev) ? 2 : 1;
    found = false; nonwall = false;
    for (xmax = COLNO - 1; !found && xmax >= 0; xmax--) {
        for (let y = 0; y <= ROWNO - 1; y++) {
            const typ = map.at(xmax, y)?.typ ?? STONE;
            if (typ !== STONE) { found = true; if (!IS_WALL(typ)) nonwall = true; }
        }
    }
    xmax += (nonwall || !game.level?.flags?.is_maze_lev) ? 2 : 1;
    found = false; nonwall = false;
    for (ymin = 0; !found && ymin <= ROWNO - 1; ymin++) {
        for (let x = xmin; x <= xmax; x++) {
            const typ = map.at(x, ymin)?.typ ?? STONE;
            if (typ !== STONE) { found = true; if (!IS_WALL(typ)) nonwall = true; }
        }
    }
    ymin -= (nonwall || !game.level?.flags?.is_maze_lev) ? 2 : 1;
    found = false; nonwall = false;
    for (ymax = ROWNO - 1; !found && ymax >= 0; ymax--) {
        for (let x = xmin; x <= xmax; x++) {
            const typ = map.at(x, ymax)?.typ ?? STONE;
            if (typ !== STONE) { found = true; if (!IS_WALL(typ)) nonwall = true; }
        }
    }
    ymax += (nonwall || !game.level?.flags?.is_maze_lev) ? 2 : 1;
    return { xmin, xmax, ymin, ymax };
}

function bound_digging() {
    const map = game.level;
    const { xmin, xmax, ymin, ymax } = get_level_extends();
    for (let x = 0; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = map.at(x, y);
            if (!loc) continue;
            if (IS_STWALL(loc.typ) && (y <= ymin || y >= ymax || x <= xmin || x >= xmax)) {
                loc.wall_info = (loc.wall_info || 0) | W_NONDIGGABLE;
            }
        }
}

// C ref: display.c check_pos — return `which` if the position implies an
// unfinished exterior (rock / corridor / secret door), else 0.
function check_pos(x, y, which) {
    if (!isok(x, y)) return which;
    const type = game.level?.at(x, y)?.typ ?? STONE;
    // Everything below POOL excluding TREE: STWALL, CORR, SCORR, SDOOR
    if (IS_STWALL(type) || type === CORR || type === SCORR || IS_SDOOR(type))
        return which;
    return 0;
}

// C ref: display.c more_than_one(x,y,a,b,c)
function more_than_one(a, b, c) {
    return ((a && (b | c)) || (b && (a | c)) || (c && (a | b)));
}

// C ref: display.c set_wall(x,y,horiz) — wall mode for H/V wall.
function set_wall(x, y, horiz) {
    let is_1, is_2;
    if (horiz) {
        is_1 = check_pos(x, y - 1, WM_W_TOP);
        is_2 = check_pos(x, y + 1, WM_W_BOTTOM);
    } else {
        is_1 = check_pos(x - 1, y, WM_W_LEFT);
        is_2 = check_pos(x + 1, y, WM_W_RIGHT);
    }
    return more_than_one(is_1, is_2, 0) ? 0 : (is_1 + is_2);
}

// C ref: display.c set_twall(...) — wall mode for a T wall.
function set_twall(x1, y1, x2, y2, x3, y3) {
    const is_1 = check_pos(x1, y1, WM_T_LONG);
    const is_2 = check_pos(x2, y2, WM_T_BL);
    const is_3 = check_pos(x3, y3, WM_T_BR);
    return more_than_one(is_1, is_2, is_3) ? 0 : (is_1 + is_2 + is_3);
}

// C ref: display.c set_corn(...) — wall mode for a corner wall.
// (x4,y4) is the "inner" position.
function set_corn(x1, y1, x2, y2, x3, y3, x4, y4) {
    const is_1 = check_pos(x1, y1, 1);
    const is_2 = check_pos(x2, y2, 1);
    const is_3 = check_pos(x3, y3, 1);
    const is_4 = check_pos(x4, y4, 1); /* inner location */
    if (is_4) return WM_C_INNER;
    if (is_1 && is_2 && is_3) return WM_C_OUTER;
    return 0; /* finished walls on all sides */
}

// C ref: display.c set_crosswall(x,y) — mode for a crosswall.
function set_crosswall(x, y) {
    const is_1 = check_pos(x - 1, y - 1, 1);
    const is_2 = check_pos(x + 1, y - 1, 1);
    const is_3 = check_pos(x + 1, y + 1, 1);
    const is_4 = check_pos(x - 1, y + 1, 1);
    let wmode = is_1 + is_2 + is_3 + is_4;
    if (wmode > 1) {
        if (is_1 && is_3 && (is_2 + is_4 === 0)) wmode = WM_X_TLBR;
        else if (is_2 && is_4 && (is_1 + is_3 === 0)) wmode = WM_X_BLTR;
        else wmode = 0;
    } else if (is_1) wmode = WM_X_TL;
    else if (is_2) wmode = WM_X_TR;
    else if (is_3) wmode = WM_X_BR;
    else if (is_4) wmode = WM_X_BL;
    return wmode;
}

// C ref: display.c xy_set_wall_state(x,y)
function xy_set_wall_state(x, y) {
    const lev = game.level?.at(x, y);
    if (!lev) return;
    let wmode;
    switch (lev.typ) {
    case SDOOR:
        wmode = set_wall(x, y, lev.horizontal ? 1 : 0);
        break;
    case VWALL:
        wmode = set_wall(x, y, 0);
        break;
    case HWALL:
        wmode = set_wall(x, y, 1);
        break;
    case TDWALL:
        wmode = set_twall(x, y - 1, x - 1, y + 1, x + 1, y + 1);
        break;
    case TUWALL:
        wmode = set_twall(x, y + 1, x + 1, y - 1, x - 1, y - 1);
        break;
    case TLWALL:
        wmode = set_twall(x + 1, y, x - 1, y - 1, x - 1, y + 1);
        break;
    case TRWALL:
        wmode = set_twall(x - 1, y, x + 1, y + 1, x + 1, y - 1);
        break;
    case TLCORNER:
        wmode = set_corn(x - 1, y - 1, x, y - 1, x - 1, y, x + 1, y + 1);
        break;
    case TRCORNER:
        wmode = set_corn(x, y - 1, x + 1, y - 1, x + 1, y, x - 1, y + 1);
        break;
    case BLCORNER:
        wmode = set_corn(x, y + 1, x - 1, y + 1, x - 1, y, x + 1, y - 1);
        break;
    case BRCORNER:
        wmode = set_corn(x + 1, y, x + 1, y + 1, x, y + 1, x - 1, y - 1);
        break;
    case CROSSWALL:
        wmode = set_crosswall(x, y);
        break;
    default:
        wmode = -1; /* don't set wall info */
        break;
    }
    if (wmode >= 0)
        lev.wall_info = (lev.wall_info & ~WM_MASK) | wmode;
}

// C ref: display.c set_wall_state() — scan the level and set wall modes.
export function set_wall_state() {
    for (let x = 0; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++)
            xy_set_wall_state(x, y);
}

function level_finalize_topology() {
    bound_digging();
    // mineralize is consumed by fastforward_fill_mineralize
    game.in_mklev = false;
    // C ref: mklev.c:1559-1560 — has_morgue implies graveyard (has_morgue is
    // cleared once the morgue is entered, graveyard is permanent).  This is not
    // cosmetic: mon.c's LEVEL_SPECIFIC_NOCORPSE macro reads it as
    // `svl.level.flags.graveyard && is_undead(mdat) && rn2(3)`, so on a morgue
    // level every undead death rolls an extra rn2(3) before leaving a corpse.
    if (game.level?.flags?.has_morgue) game.level.flags.graveyard = true;
    // C ref: mklev.c themerooms_post_level_generate() runs the level-wide
    // wallification(1, 0, COLNO-1, ROWNO-1) at the very end of makelevel()
    // (mklev.c:1190), BEFORE mklev()'s topologize + set_wall_state() pass
    // (mklev.c:1561-1569).  It converts HWALL/VWALL spines into proper corner
    // and T-junction wall types so the room borders (including irregular
    // themeroom borders) carry the right typ for set_wall_state()/wall_angle().
    // Our fill loop runs after mklev() returns, but wallification only depends
    // on the room/corridor wall layout (fixed by makerooms/makecorridors) and
    // consumes no RNG, so running it here is terrain-equivalent and keeps the
    // PRNG aligned.  Without it, irregular lit rooms render straight walls
    // instead of corners.  C ref: mklev.c wallification().
    wallification(1, 0, COLNO - 1, ROWNO - 1);
    if (!game.level?.flags?.is_maze_lev) {
        const nroom = game.level?.nroom ?? 0;
        for (let i = 0; i < nroom; i++)
            topologize(game.level.rooms?.[i]);
    }
    set_wall_state();
    const rooms = game.level?.rooms ?? [];
    for (let i = 0; i < rooms.length; i++) {
        const rm = rooms[i];
        if (rm && rm.rtype != null) rm.orig_rtype = rm.rtype;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// mklev.c — remaining functions.  INERT: nothing above calls into this section
// and no existing call site was rewired.  The RNG-drawing ones (mktrap,
// mkgrave, mkinvpos) go through the same maketrap()/rn2() the live builders
// use, so wiring one up reorders the shared draw stream and is a measured
// change, not a refactor.
// ═══════════════════════════════════════════════════════════════════════════

// hack.h:1429-1433 — mktrap()'s flag word.
export const MKTRAP_NOFLAGS = 0x0;
export const MKTRAP_SEEN = 0x1;          /* trap is seen */
export const MKTRAP_MAZEFLAG = 0x2;      /* random coords instead of a room */
export const MKTRAP_NOSPIDERONWEB = 0x4; /* web will not generate a spider */
export const MKTRAP_NOVICTIM = 0x8;      /* no victim corpse or items on it */

// hack.h:427-430 enum lua_theme_group.
export const all_themes = 1;   /* for end of game */
export const most_themes = 2;  /* for entering endgame */
export const tut_themes = 3;   /* for leaving tutorial */

// global.h:387 — svd.doors grows by this many entries at a time.
const DOORINC = 20;

// C ref: mklev.c:59 mkroom_cmp(vx, vy) — sort_rooms()'s qsort comparator,
// ordering rooms by left edge.  Note C returns the BOOLEAN `x->lx > y->lx`
// (i.e. 0 or 1) for the not-less case, never a magnitude; transcribed as is.
// sort_rooms() (mklev.js:2351) inlines the same key.
export function mkroom_cmp(vx, vy) {
    const x = vx, y = vy;
    if (x.lx < y.lx)
        return -1;
    return (x.lx > y.lx) ? 1 : 0;
}

// C ref: mklev.c:555 — (re)allocate space for the svd.doors array.  C grows a
// flat coord[] by DOORINC whenever doorindex catches up with the allocation and
// memcpy()s the old contents over; a JS array grows implicitly, so the only
// observable part is the zero-fill of the new slots (add_door() at mklev.js:2620
// writes into g.level.doors[] directly and never reads an uninitialised slot).
// Kept so a save/restore pass that has to reproduce doors_alloc has the rule.
export function alloc_doors() {
    const g = game;
    if (!g.level) return;
    if (!g.level.doors) g.level.doors = [];
    if (g.level.doors_alloc == null) g.level.doors_alloc = 0;
    if (!g.level.doors.length || g.level.doorindex >= g.level.doors_alloc) {
        const c = g.level.doors_alloc + DOORINC;
        for (let i = g.level.doors.length; i < c; i++)
            g.level.doors[i] = { x: 0, y: 0 };   /* memset(doortmp, 0, ...) */
        g.level.doors_alloc = c;
    }
}

// C ref: mklev.c:344 free_luathemes(theme_group) — release the per-dungeon
// themeroom lua states.  `tut_themes` frees only the tutorial's, `most_themes`
// keeps the Astral one (that dungeon is being entered), `all_themes` frees
// everything.  This port has no lua_State; mklev.js:771-778 records "themes
// loaded for dnum" in game._luathemes_loaded, which is the same lifetime, so
// that is what gets cleared.  js/save.js:1111 records this as UNPORTED.
export function free_luathemes(theme_group) {
    const g = game;
    const luathemes = g._luathemes_loaded;
    if (!luathemes) return;
    const n_dgns = g.dungeons?.length ?? 0;
    const tutorial_dnum = g.tutorial_dnum ?? -1;
    const astral_dnum = g.astral_level?.dnum ?? -1;

    for (let i = 0; i < n_dgns; ++i) {
        if ((theme_group === tut_themes && i !== tutorial_dnum)
            || (theme_group === most_themes && i === astral_dnum))
            continue;
        if (luathemes[i]) {
            luathemes[i] = 0;               /* nhl_done(); pointer cleared */
        }
    }
}

// C ref: mklev.c:1173 — the tail of makelevel(): run themerms.lua's
// post_level_generate() (this port queues its work and replays it in
// sp_lev.js's run_themeroom_postprocess()), then wallify the WHOLE map.
// `if (!themes) return` matters: a dungeon with no themes file skips the
// wallification too, which is why makelevel() and not mklev() owns it.
export async function themerooms_post_level_generate() {
    const g = game;
    const themes = g._luathemes_loaded?.[g.u?.uz?.dnum ?? 0];

    /* themes should already be loaded by makerooms(); if not, skip this too */
    if (!themes)
        return;

    reset_xystart_size();
    g.in_lua = g.in_mk_themerooms = true;
    if (g.level) g.level.themeroom_failed = false;
    await run_themeroom_postprocess();      /* lua post_level_generate() */
    g.in_lua = g.in_mk_themerooms = false;

    wallification(1, 0, COLNO - 1, ROWNO - 1);
    /* C also frees gc.coder and runs lua_gc(themes, LUA_GCCOLLECT) */
}

// C ref: mklev.c:1197 — does a door open into solid terrain?  The four tests
// are "one side is passable and the other is not"; `typ > TREE` is the
// passable half of rm.h's terrain ordering (STONE..TREE are the solid ones).
// Note both arms return FALSE for a MISMATCH, so a door with solid terrain on
// BOTH sides (or open on both) is reported ok.
export function chk_okdoor(x, y) {
    const loc = game.level?.at(x, y);
    if (loc && IS_DOOR(loc.typ)) {
        if (loc.horizontal) {
            if ((isok(x, y - 1) && (game.level.at(x, y - 1).typ > TREE))
                && (isok(x, y + 1) && (game.level.at(x, y + 1).typ <= TREE)))
                return false;
            if ((isok(x, y - 1) && (game.level.at(x, y - 1).typ <= TREE))
                && (isok(x, y + 1) && (game.level.at(x, y + 1).typ > TREE)))
                return false;
        } else {
            if ((isok(x - 1, y) && (game.level.at(x - 1, y).typ > TREE))
                && (isok(x + 1, y) && (game.level.at(x + 1, y).typ <= TREE)))
                return false;
            if ((isok(x - 1, y) && (game.level.at(x - 1, y).typ <= TREE))
                && (isok(x + 1, y) && (game.level.at(x + 1, y).typ > TREE)))
                return false;
        }
        return true;
    }
    return true;
}

// C ref: mklev.c:1222 — post-mklev sanity check, gated on iflags.sanity_check
// or the fuzzer (neither is set in any recorded session, so C's body never
// runs).  Returns the complaints instead of calling impossible(), so a caller
// can assert on it; C's `rmno` walk only ever latches the FIRST needjoining
// room's smeq value, exactly as transcribed.
export function mklev_sanity_check() {
    const g = game;
    const complaints = [];
    let rmno = -1;
    let x, y, i;

    if (!(g.iflags?.sanity_check || g.iflags?.debug_fuzzer))
        return complaints;

    for (y = 0; y < ROWNO; y++) {
        for (x = 1; x < COLNO; x++) {
            if (!chk_okdoor(x, y))
                complaints.push(`levl[${x}][${y}] door not ok`);
        }
    }

    const nroom = g.level?.nroom ?? 0;
    for (i = 0; i < nroom; i++) {
        if (!g.level.rooms[i].needjoining)
            continue;
        if (rmno === -1)
            rmno = g.smeq[i];
        if (rmno !== -1 && g.smeq[i] !== rmno)
            complaints.push(`room ${i} not connected?`);
    }
    return complaints;
}

// C ref: mklev.c:1676 — find the room containing (x,y), or Null.  The live
// mklev.js:6126 call site notes C's `else (void) pos_to_room(x, y);` only
// caches gl.lastseentyp, which is why nothing needed this until now.
export function pos_to_room(x, y) {
    const rooms = game.level?.rooms ?? [];
    const nroom = game.level?.nroom ?? 0;
    for (let i = 0; i < nroom; i++) {
        const curr = rooms[i];
        if (curr && inside_room(curr, x, y))
            return curr;
    }
    return null;
}

// C ref: mklev.c:2001 — the Rogue level's own trap table.  `default:` is the
// rn2(7)==0 arm, so BEAR_TRAP is what 0 gives; every other value has its own
// case, so the switch is total and the ordering below is C's.
export function traptype_roguelvl() {
    let kind;

    switch (rn2(7)) {
    default:
        kind = BEAR_TRAP;
        break; /* 0 */
    case 1:
        kind = ARROW_TRAP;
        break;
    case 2:
        kind = DART_TRAP;
        break;
    case 3:
        kind = TRAPDOOR;
        break;
    case 4:
        kind = PIT;
        break;
    case 5:
        kind = SLP_GAS_TRAP;
        break;
    case 6:
        kind = RUST_TRAP;
        break;
    }
    return kind;
}

// C ref: rm.h is_pool_or_lava(x,y).  Private copies also sit at hack.js:85 and
// polyself.js:1832; mktrap()'s only use is the `tm` early-out.
function mklev_is_pool_or_lava(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return IS_POOL(t) || t === LAVAPOOL || t === LAVAWALL;
}

// C ref: mkmaze.c:1316 mazexy(cc) — rnd(x_maze_max)/rnd(y_maze_max) until the
// square is the maze's own floor type, up to 100 tries, then a systematic scan.
// js/mkmaze.js exports maze0xy() (the odd-cell carve start) but NOT mazexy, so
// this local copy is what mktrap()'s MKTRAP_MAZEFLAG arm needs; if mkmaze.js
// gains a mazexy() export, delete this and import that instead.
function mklev_mazexy(cc) {
    const allowedtyp = game.level?.flags?.corrmaze ? CORR : ROOM;
    let cpt = 0;
    let x, y;

    do {
        x = rnd(mz.x_maze_max);
        y = rnd(mz.y_maze_max);
        if (game.level?.at(x, y)?.typ === allowedtyp) {
            cc.x = x;
            cc.y = y;
            return;
        }
    } while (++cpt < 100);
    /* 100 random attempts failed; systematically try every possibility */
    for (x = 1; x <= mz.x_maze_max; x++)
        for (y = 1; y <= mz.y_maze_max; y++)
            if (game.level?.at(x, y)?.typ === allowedtyp) {
                cc.x = x;
                cc.y = y;
                return;
            }
    /* C: panic("mazexy: can't find a place!") */
}

/* mklev.c:2042 `static int mktrap_err` — the paniclog is issued once per run. */
let mktrap_err = 0;

// C ref: mklev.c:2035 mktrap(num, mktrapflags, croom, tm) — the general form.
// mktrap_room() (mklev.js:6378) is the croom-only, flagless specialisation the
// live fill path uses; this is the whole function, including the `tm` and
// MKTRAP_MAZEFLAG placement arms and the three flag tests.
//
// RNG: the kind selection draws (traptype_rnd's rnd(TRAPNUM-1) in a NO_TRAP
// retry loop, or traptype_roguelvl's rn2(7), or Gehennom's rn2(5) which is
// drawn BEFORE the fire-trap shortcut and therefore always), then one
// somexyspace()/mazexy() per placement attempt, then maketrap(), then the
// victim gate's rnd(4) — which is the RIGHT operand of `lvl <= rnd(4)` and so
// is drawn whenever the earlier conditions hold.
//
// CAVEAT: traptype_rnd() at mklev.js:6229 takes no argument, so C's
// `case WEB: if (lvl < 7 && !(mktrapflags & MKTRAP_NOSPIDERONWEB))` degrades to
// `if (lvl < 7)` here.  Identical for every flagless caller; a caller that
// passes MKTRAP_NOSPIDERONWEB (a des.trap() with spider_on_web=false) would get
// NO_TRAP where C gets a web.  Fixing that means editing traptype_rnd().
export async function mktrap(num, mktrapflags, croom, tm) {
    let t, kind;
    const m = { x: 0, y: 0 };
    const lvl = level_difficulty();

    if (!tm && !croom && !(mktrapflags & MKTRAP_MAZEFLAG)) {
        /* complain when the combination of arguments will never set 'm' */
        if (!mktrap_err++) {
            /* paniclog("mktrap", "args (...) are invalid") */
        }
        return;
    }
    m.x = m.y = 0;

    /* no traps in pools */
    if (tm && mklev_is_pool_or_lava(tm.x, tm.y))
        return;

    if (num > NO_TRAP && num < TRAPNUM) {
        kind = num;
    } else if (Is_rogue_level_mk()) {
        kind = traptype_roguelvl();
    } else if (In_hell(game.u?.uz) && !rn2(5)) {
        /* bias the frequency of fire traps in Gehennom */
        kind = FIRE_TRAP;
    } else {
        do {
            kind = traptype_rnd(mktrapflags);
        } while (kind === NO_TRAP);
    }

    if (is_hole(kind) && !Can_fall_thru(game.u?.uz))
        kind = ROCKTRAP;

    if (tm) {
        m.x = tm.x; m.y = tm.y;
    } else {
        let tryct = 0;
        const avoid_boulder = (is_pit(kind) || is_hole(kind));

        do {
            if (++tryct > 200)
                return;
            if ((mktrapflags & MKTRAP_MAZEFLAG) !== 0)
                mklev_mazexy(m);
            else if (croom && !somexyspace(croom, m))
                return;
        } while (occupied(m.x, m.y)
                 || (avoid_boulder && mk_sobj_at_boulder(m.x, m.y)));
    }

    t = await maketrap(m.x, m.y, kind);
    /* we should always get the type of trap we're asking for (the occupied()
       test should prevent cases where that might not happen) but be paranoid */
    kind = t ? t.ttyp : NO_TRAP;

    if (kind === WEB && !(mktrapflags & MKTRAP_NOSPIDERONWEB)) {
        const spiderPm = monster_by_pmidx(name_to_pmidx('giant spider'));
        /* through the local makemon() wrapper so the spider is linked into
           fmon — see the note at mklev.js:6406 */
        if (spiderPm) await makemon(spiderPm, m.x, m.y, 0);
    }
    if (t && (mktrapflags & MKTRAP_SEEN))
        t.tseen = true;
    if (kind === MAGIC_PORTAL
        && (game.u?.ucamefrom?.dnum || game.u?.ucamefrom?.dlevel)) {
        t.dst = { dnum: game.u.ucamefrom.dnum,      /* assign_level() */
                  dlevel: game.u.ucamefrom.dlevel };
    }

    /* The hero isn't the only person who's entered the dungeon in search of
       treasure: on the shallowest levels a created trap may already have
       killed something (guaranteed on Dlvl 1).  Nonlethal and later/fancier
       trap types are excluded, and pits because an item in an unseen pit is
       weird. */
    if (game.in_mklev
        && kind !== NO_TRAP && !(mktrapflags & MKTRAP_NOVICTIM)
        && lvl <= rnd(4)
        && kind !== SQKY_BOARD && kind !== RUST_TRAP
        /* a rolling boulder trap might have no boulder if there was no viable
           path, in which case tx,ty == launch.x,y; no boulder => no corpse */
        && !(kind === ROLLING_BOULDER_TRAP
             && t.launch?.x === t.tx && t.launch?.y === t.ty)
        && !is_pit(kind) && (kind < HOLE || kind === MAGIC_TRAP)) {
        if (kind === LANDMINE) {
            /* a victim killed by a land mine scatters no objects; treat the
               mine as exploded, i.e. an unconcealed pit */
            t.ttyp = PIT;
            t.tseen = 1;
        }
        mktrap_victim(t);
    }
    return;
}

// C ref: mklev.c:2316 — a sink, if a free non-doorway square can be found.
// find_okay_roompos() (mklev.js:6260) draws somexyspace() per attempt.  The
// live fill_ordinary_room() (mklev.js:6529) inlines this; the difference is
// C's set_levltyp() refusal to overwrite STAIRS/LADDER, which the inline copy
// does not honour — a sink can only lose that race on a stairs square, which
// occupied() already rejects, so the two agree in practice.
export function mksink(croom) {
    const m = { x: 0, y: 0 };

    if (!find_okay_roompos(croom, m))
        return;

    /* Put a sink at m.x, m.y */
    if (!set_levltyp_lit(m.x, m.y, SINK, SET_LIT_NOCHANGE))
        return;

    game.level.flags.nsinks = (game.level.flags.nsinks || 0) + 1;
}

// ── C names for ports that already exist under a local name ────────────────
// mkgrave() is fully ported as mkgrave_room() (mklev.js:6456) — including the
// `dobell = !rn2(10)` declaration-initialiser ordering fix.  Re-exported under
// the C spelling rather than re-implemented; renaming the original would touch
// its live call site in fill_ordinary_room().
export function mkgrave(croom) { return mkgrave_room(croom); }

// ── invocation area (mklev.c:2409-2613) ────────────────────────────────────

// C ref: mklev.c:2602 — reduces clutter in mkinvokearea() while keeping the
// isok() guard on the levl[][] access.  IRONBARS counts as a wall here, which
// is why the "walls bend and crumble" line can appear on a barred level.
export function mkinvk_check_wall(x, y) {
    if (!isok(x, y))
        return 0;
    const ltyp = game.level?.at(x, y)?.typ;
    return (IS_STWALL(ltyp) || ltyp === IRONBARS) ? 1 : 0;
}

/* mkinvpos()'s local #defines: maze levels keep 2 columns/rows of margin. */
const X_MAZE_MIN = 2;
const Y_MAZE_MIN = 2;

// C ref: mklev.c:2409 mkinvokearea() — the earthquake that opens the stairs to
// the Sanctum after the Book of the Dead is read on the vibrating square.
// Two passes over the same 13x9-ish diamond: the first only COUNTS walls (to
// decide whether to print the crumbling line), the second calls mkinvpos() to
// actually retopologise, with a flush_screen()+delay per ring so the animation
// plays outward.  `dist != 3` is C's comment "the area is wider than it is
// high" — the y extent stops growing for one ring.
//
// No RNG of its own; mkinvpos()'s maketrap(FIRE_TRAP) and fracture_rock() draw.
export async function mkinvokearea() {
    let dist, wallct;
    let xmin, xmax, ymin, ymax;
    let i;
    const g = game;
    const { pline, flush_screen } = await import('./display.js');

    /* slightly odd if levitating, but not wrong */
    await pline('The floor shakes violently under you!');   /* pline_The() */
    /* decide whether to issue the crumbling walls message */
    {
        xmin = xmax = g.inv_pos.x;
        ymin = ymax = g.inv_pos.y;
        wallct = mkinvk_check_wall(xmin, ymin);
        /* replicates the loop below, working out from the stair position,
           except for stopping early when walls are found */
        for (dist = 1; !wallct && dist < 7; ++dist) {
            xmin--, xmax++;
            /* top and bottom */
            if (dist !== 3) { /* the area is wider than it is high */
                ymin--, ymax++;
                for (i = xmin + 1; i < xmax; i++) {
                    if (mkinvk_check_wall(i, ymin))
                        ++wallct;
                    if (mkinvk_check_wall(i, ymax))
                        ++wallct;
                }
            }
            /* left and right */
            if (!wallct) { /* skip the y loop if the x loop found any walls */
                for (i = ymin; i <= ymax; i++) {
                    if (mkinvk_check_wall(xmin, i))
                        ++wallct;
                    if (mkinvk_check_wall(xmax, i))
                        ++wallct;
                }
            }
        }
        /* the message won't appear if this level's maze 'walls' are lava or if
           every wall in range has been dug away; iron bars read as "walls" */
        if (wallct)
            await pline('The walls around you begin to bend and crumble!');
    }
    /* display_nhwindow(WIN_MESSAGE, TRUE) — force the --More-- */

    /* any trap the hero is stuck in is going away now */
    if (g.u?.utrap) {
        if (g.u.utraptype === 6 /* TT_BURIEDBALL */) {
            const { buried_ball_to_punishment } = await import('./dig.js');
            await buried_ball_to_punishment();
        }
        g.u.utrap = 0;                          /* reset_utrap(FALSE) */
    }

    xmin = xmax = g.inv_pos.x;  /* reset after the check for walls */
    ymin = ymax = g.inv_pos.y;
    await mkinvpos(xmin, ymin, 0); /* middle, before placing stairs */

    for (dist = 1; dist < 7; dist++) {
        xmin--;
        xmax++;

        /* top and bottom */
        if (dist !== 3) { /* the area is wider than it is high */
            ymin--;
            ymax++;
            for (i = xmin + 1; i < xmax; i++) {
                await mkinvpos(i, ymin, dist);
                await mkinvpos(i, ymax, dist);
            }
        }

        /* left and right */
        for (i = ymin; i <= ymax; i++) {
            await mkinvpos(xmin, i, dist);
            await mkinvpos(xmax, i, dist);
        }

        await flush_screen(1); /* make sure the new glyphs show up */
        /* nh_delay_output() */
    }

    await pline('You are standing at the top of a stairwell leading down!');
    /* C: mkstairs(u.ux, u.uy, 0, (struct mkroom *) 0, FALSE) — mklev.js's
       mkstairs() has no `force` parameter, and FALSE is the no-force case. */
    mkstairs(g.u.ux, g.u.uy, 0, null);          /* down */
    newsym(g.u.ux, g.u.uy);
    g.vision_full_recalc = 1;                   /* everything changed */
}

// C ref: zap.c fracture_rock(obj) — a boulder becomes rn1(60,7) rocks.  Private
// copies already sit at vault.js:283, dig.js:956 and explode.js:630; none is
// exported, so mkinvpos() gets a fourth.  The fix is to export ONE of them (the
// dig.js copy is the C shape) and delete the rest — not to keep adding copies.
// The rn1(60, 7) is the only draw and happens whether or not obj is on a floor.
function mkinv_fracture_rock(obj) {
    if (!obj) return;
    obj.otyp = ROCK;
    obj.oclass = GEM_CLASS_MK;
    obj.quan = rn1(60, 7);
    obj.owt = weight(obj);
    obj.dknown = obj.bknown = obj.rknown = 0;
    obj.known = 1;                       /* rocks have no oc_uses_known */
    dealloc_oextra(obj);
    if (obj.where === 'floor') {
        const ox = obj.ox, oy = obj.oy;
        obj_extract_self_mkobj(obj);
        place_object(obj, ox, oy);
    }
}

// C ref: invent.c sobj_at(otyp, x, y) — the first floor object of that type.
// mk_sobj_at_boulder() (mklev.js:6371) answers the same question as a boolean;
// mkinvpos() needs the object itself so it can fracture or free it.
function mkinv_sobj_at(otyp, x, y) {
    for (const o of game.level?.objects ?? [])
        if (o.where === 'floor' && o.ox === x && o.oy === y && o.otyp === otyp)
            return o;
    return null;
}

// C ref: mklev.c:2502 mkinvpos(x, y, dist) — retopologise one square of the
// invocation area.  `dist` selects the terrain: 1 => fire traps, 4/5 => moat,
// everything else => ROOM, and dist < 6 is the lit part.  It writes viz_array
// directly to short-circuit the vision recalc so the animation is visible.
//
// Boulder handling draws: the FIRST boulder on a non-{moat,trap} square is
// fractured (rn1(60,7)), the rest are freed outright.
export async function mkinvpos(x, y, dist) {
    let ttmp, otmp;
    let make_rocks;
    const lev = game.level?.at(x, y);
    if (!lev) return;

    /* clip at existing map borders if necessary */
    if (!within_bounded_area(x, y, X_MAZE_MIN, Y_MAZE_MIN,
                             mz.x_maze_max, mz.y_maze_max)) {
        /* the outermost 2 columns and/or rows may be truncated by the edge;
           C panics when !isok(x,y) and impossible()s otherwise */
        return;
    }

    /* clear traps */
    if ((ttmp = t_at(x, y)) != null)
        deltrap(ttmp);

    /* clear boulders; leave some rocks for non-{moat|trap} locations */
    make_rocks = (dist !== 1 && dist !== 4 && dist !== 5) ? true : false;
    while ((otmp = mkinv_sobj_at(BOULDER, x, y)) != null) {
        if (make_rocks) {
            mkinv_fracture_rock(otmp);
            make_rocks = false; /* don't bother with more rocks */
        } else {
            obj_extract_self_mkobj(otmp);
            const { obfree } = await import('./invent.js');
            obfree(otmp, null);
        }
    }

    /* fake out saved state */
    lev.seenv = 0;
    lev.doormask = 0;
    if (dist < 6)
        lev.lit = true;
    lev.waslit = true;
    lev.horizontal = false;
    /* short-circuit vision recalc */
    if (game.viz_array?.[y])
        game.viz_array[y][x] = (dist < 6) ? (IN_SIGHT | COULD_SEE) : COULD_SEE;

    switch (dist) {
    case 1: /* fire traps */
        if (IS_POOL(lev.typ))
            break;
        lev.typ = ROOM;
        ttmp = await maketrap(x, y, FIRE_TRAP);
        if (ttmp)
            ttmp.tseen = true;
        break;
    case 0: /* lit room locations */
    case 2:
    case 3:
    case 6: /* unlit room locations */
        lev.typ = ROOM;
        break;
    case 4: /* pools (aka a wide moat) */
    case 5:
        lev.typ = MOAT;
        /* No kelp! */
        break;
    default:
        /* impossible("mkinvpos called with dist %d", dist) */
        break;
    }

    const mon = m_at(x, y);
    if (mon) {
        /* wake up mimics; don't want to deal with them blocking vision */
        if (mon.m_ap_type)
            mon.m_ap_type = 0;                  /* seemimic(mon) */

        /* NOT PORTED: mintrap() (trap.c) has no JS counterpart and
           minliquid() is private at js/mon.js:591, so a monster caught by the
           new fire trap or moat is left alone here. */
    }

    {
        const { does_block, unblock_point } = await import('./vision.js');
        /* this port's does_block() takes (x,y); C also passes &levl[x][y] */
        if (!does_block(x, y))
            unblock_point(x, y); /* make sure vision knows the spot is open */
    }

    /* display the new value of the position; there could be a monster or
       object on it */
    newsym(x, y);
}
