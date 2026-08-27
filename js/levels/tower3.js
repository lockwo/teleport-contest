// levels/tower3.js - special level builder makemaz_tower3(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_tower3 so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import {
    COLNO, FIRE_TRAP, HOLE, LANDMINE, LEVEL_TELEP, MAGIC_PORTAL, NO_TRAP, POLY_TRAP, ROCKTRAP,
    ROLLING_BOULDER_TRAP, ROWNO, SLP_GAS_TRAP, SPIKED_PIT, STATUE_TRAP, TELEP_TRAP, TRAPDOOR,
    TRAPNUM, TRAPPED_CHEST, TRAPPED_DOOR, VIBRATING_SQUARE, WEB,
} from '../const.js';
import { In_hell } from '../dungeon.js';
import { game } from '../gstate.js';
import { enexto_spawn, level_difficulty_ext, makemon, mm_mon_at } from '../makemon.js';
import { rn2, rnd } from '../rng.js';
import { Can_fall_thru, maketrap } from '../trap.js';
import {
    BLINDFOLD, ELVEN_CLOAK, LOCK_PICK, LONG_SWORD, S_DRAGON, bigrm_get_location_dry, flip_level,
    q_absx, q_absy, quest_create_monster_class, quest_create_object, quest_flip_branch,
    quest_level_init_solidfill, quest_register_branch, quest_set_door, shuffle, tower1_load_map,
    tower_place_ladder, tower_wallification,
} from '../sp_lev.js';

// ════════════════════════════════════════════════════════════════════════
// Vlad's Tower entry stage (dat/tower3.lua) — the branch level reached from
// Gehennom, below tower2/tower1.  Same skeleton as tower1/tower2: nhlib
// shuffle(align), solidfill level_init, a fixed map with
// halign="half-left"/valign="center", then monsters/objects/traps in file
// order, wallification and flip_level_rnd.
// ════════════════════════════════════════════════════════════════════════

const TOWER3_MAP = [
    '    --- --- ---    ',
    '    |.| |.| |.|    ',
    '  ---S---S---S---  ',
    '  |.S.........S.|  ',
    '-----.........-----',
    '|...|.........+...|',
    '|.---.........---.|',
    '|.|.S.........S.|.|',
    '|.---S---S---S---.|',
    '|...|.|.|.|.|.|...|',
    '---.---.---.---.---',
    '  |.............|  ',
    '  ---------------  ',
].join('\n');

// C ref: sp_lev.c create_monster with no class and no id (`des.monster()` /
// `des.monster({x=,y=})`): sp_amask_to_amask draws induced_align rn2(3), pm
// stays NULL so get_location_coord uses DRY (explicit coord -> no RNG; no
// coord -> the random retry loop), then makemon(NULL, ...) rolls the species.
function tower_create_monster_random(mx, my) {
    rn2(3);                                          // induced_align (dungeon.c:2012)
    let x, y;
    if (mx != null) { x = q_absx(mx); y = q_absy(my); }
    else { const c = bigrm_get_location_dry(); x = c.x; y = c.y; }
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, null);
        if (cc) { x = cc.x; y = cc.y; }
    }
    return makemon(null, x, y, 0);
}

// C ref: mklev.c traptype_rnd() as reached from sp_lev.c create_trap with no
// type.  lvl is level_difficulty() (not dlevel — Vlad's Tower builds up, so
// the two differ), and FIRE_TRAP is only allowed In_hell.
function tower_traptype_rnd() {
    const lvl = level_difficulty_ext();
    const noteleport = !!game.level?.flags?.noteleport;
    let kind = rnd(TRAPNUM - 1);                     // mklev.c:1941
    switch (kind) {
    case TRAPPED_DOOR: case TRAPPED_CHEST: case MAGIC_PORTAL: case VIBRATING_SQUARE:
        kind = NO_TRAP; break;
    case ROLLING_BOULDER_TRAP: case SLP_GAS_TRAP:
        if (lvl < 2) kind = NO_TRAP; break;
    case LEVEL_TELEP:
        if (lvl < 5 || noteleport) kind = NO_TRAP; break;
    case SPIKED_PIT:
        if (lvl < 5) kind = NO_TRAP; break;
    case LANDMINE:
        if (lvl < 6) kind = NO_TRAP; break;
    case WEB:
        if (lvl < 7) kind = NO_TRAP; break;
    case STATUE_TRAP: case POLY_TRAP:
        if (lvl < 8) kind = NO_TRAP; break;
    case FIRE_TRAP:
        if (!In_hell(game.u?.uz)) kind = NO_TRAP; break;
    case TELEP_TRAP:
        if (noteleport) kind = NO_TRAP; break;
    case HOLE:
        if (rn2(7)) kind = NO_TRAP; break;           // mklev.c:1993
    }
    return kind;
}

// C ref: sp_lev.c create_trap with an explicit coord and no type ->
// mktrap(NO_TRAP, MKTRAP_MAZEFLAG|MKTRAP_NOSPIDERONWEB): retry traptype_rnd()
// until it yields a type, demote a hole/trapdoor when the floor is hard, then
// the always-drawn victim check rnd(4) (mklev.c:2137).
async function tower_create_trap_random_at(mx, my) {
    const x = q_absx(mx), y = q_absy(my);
    let kind;
    do { kind = tower_traptype_rnd(); } while (kind === NO_TRAP);
    if ((kind === HOLE || kind === TRAPDOOR) && !Can_fall_thru(game.u?.uz))
        kind = ROCKTRAP;
    await maketrap(x, y, kind);
    rnd(4);                                          // mktrap victim check
}

// Main executor.  C ref: makemaz("tower3") -> load_special.  Unlike tower1/2
// this one registers a "branch" levregion, so fixup_special places THAT (one
// rn2(1)/rn2(1) pair) instead of falling back to the whole-level LR_BRANCH loop.
export async function makemaz_tower3() {
    const g = game;
    shuffle(['law', 'neutral', 'chaos']);            // nhlib.lua top level
    quest_level_init_solidfill();                    // splev_initlev rn2(2)
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    tower1_load_map(TOWER3_MAP, false);              // 19x13, half-left/center

    // `place` is used directly here — tower3.lua does NOT shuffle it.
    const place = [[5, 1], [9, 1], [13, 1], [3, 3], [15, 3],
                   [3, 7], [15, 7], [5, 9], [9, 9], [13, 9]];

    quest_register_branch(2, 5);                     // des.levregion type="branch"
    tower_place_ladder(5, 7, true);                  // des.ladder("up", 05,07)
    quest_set_door(14, 5, 'locked');

    g._full_mon_gen = true;
    try {
        quest_create_monster_class(S_DRAGON, 13, 5); // des.monster("D",13,05)
        tower_create_monster_random(12, 4);
        tower_create_monster_random(12, 6);
        for (let i = 0; i < 6; i++) tower_create_monster_random(null, null);
    } finally {
        g._full_mon_gen = false;
    }

    g._full_mon_gen = true;
    try {
        quest_create_object(LONG_SWORD, place[3][0], place[3][1], null, null);
        await tower_create_trap_random_at(place[3][0], place[3][1]);
        quest_create_object(LOCK_PICK, place[0][0], place[0][1], null, null);
        await tower_create_trap_random_at(place[0][0], place[0][1]);
        quest_create_object(ELVEN_CLOAK, place[1][0], place[1][1], null, null);
        await tower_create_trap_random_at(place[1][0], place[1][1]);
        quest_create_object(BLINDFOLD, place[2][0], place[2][1], null, null);
        await tower_create_trap_random_at(place[2][0], place[2][1]);
    } finally {
        g._full_mon_gen = false;
    }

    // des.non_diggable(selection.area(0,0,18,12)) — no RNG.
    tower_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); quest_flip_branch(flp); }
}
