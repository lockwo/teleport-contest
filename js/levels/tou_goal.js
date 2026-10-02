// levels/tou_goal.js - special level builder makemaz_tou_goal() (dat/Tou-goal.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { COLNO, ROOM, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, gx, gy, lspo_region, quest_create_monster,
    quest_place_stair, quest_region_light, quest_rndcoord, quest_set_door,
    reset_xystart_size,
} from '../sp_lev.js';
import { quest_named_object_at, quest_object_rnd } from './quest_common.js';
import {
    S_SPIDER, quest_align_shuffle, quest_finalize, quest_level_init_fill,
    quest_monster, quest_non_diggable, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Tourist quest "goal" level (dat/Tou-goal.lua) — Ankh-Morpork's town square:
// an inn, a police station, a morgue, two shops and the Master of Thieves'
// den.  No des.levregion branch and no "noflip" flag, so the tail is a plain
// quest_finalize()-shaped wallify+flip -- except the .lua ALSO calls
// des.wallify() itself right before that implicit finalize runs (matching
// js/levels/bar_goal.js's identical double-wallify shape).
//
// C ref: mklev.c makelevel() -> makemaz("Tou-goal") -> load_special.
// ════════════════════════════════════════════════════════════════════════

const TOU_GOAL_MAP = [
    '----------------------------------------------------------------------------',
    '|.........|.........|..........|..| |.................|........|........|..|',
    '|.........|.........|..........|..| |....--------.....|........|........|..|',
    '|------S--|--+-----------+------..| |....|......|.....|........|........|..|',
    '|.........|.......................| |....|......+.....--+-------------+--..|',
    '|.........|.......................| |....|......|..........................|',
    '|-S-----S-|......----------.......| |....|......|..........................|',
    '|..|..|...|......|........|.......| |....-----------.........----..........|',
    '|..+..+...|......|........|.......| |....|.........|.........|}}|..........|',
    '|..|..|...|......+........|.......| |....|.........+.........|}}|..........|',
    '|..|..|...|......|........|.......S.S....|.........|.........----..........|',
    '|---..----|......|........|.......| |....|.........|.......................|',
    '|.........+......|+F-+F-+F|.......| |....-----------.......................|',
    '|---..----|......|..|..|..|.......| |......................--------------..|',
    '|..|..|...|......--F-F--F--.......| |......................+............|..|',
    '|..+..+...|.......................| |--.---...-----+-----..|............|..|',
    '|--|..----|--+-----------+------..| |.....|...|.........|..|------------|..|',
    '|..+..+...|.........|..........|..| |.....|...|.........|..+............|..|',
    '|..|..|...|.........|..........|..| |.....|...|.........|..|............|..|',
    '----------------------------------------------------------------------------',
].join('\n');

// C ref: sp_lev.c rnddoor() -- ROLL_FROM({D_NODOOR,D_BROKEN,D_ISOPEN,D_CLOSED,
// D_LOCKED}) == a single rn2(5), reused by quest_set_door()'s existing
// state-name table so its wall-orientation logic stays the single implementation.
const RNDDOOR_NAMES = ['nodoor', 'broken', 'open', 'closed', 'locked'];
function tou_random_door(mx, my) {
    quest_set_door(mx, my, RNDDOOR_NAMES[rn2(5)]);
}

// C ref: selection.area(00,00,75,19):filter_mapchar('.') minus one excluded
// rectangle -- selvar.c selection_filter_mapchar() matches the CURRENT levl
// typ (ROOM for '.'), not the raw des.map character, and draws no RNG.
// Coordinates are map-relative; the returned Set holds absolute keys, matching
// quest_rndcoord()'s convention.
function tou_valid_trap_cells(exclude) {
    const cells = new Set();
    for (let x = 0; x <= 75; x++)
        for (let y = 0; y <= 19; y++) {
            const loc = game.level?.at(gx.xstart + x, gy.ystart + y);
            if (loc && loc.typ === ROOM) cells.add((gx.xstart + x) + ',' + (gy.ystart + y));
        }
    for (const [ex1, ey1, ex2, ey2] of exclude)
        for (let x = ex1; x <= ex2; x++)
            for (let y = ey1; y <= ey2; y++)
                cells.delete((gx.xstart + x) + ',' + (gy.ystart + y));
    return cells;
}

export async function makemaz_tou_goal() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    quest_level_init_fill(0 /* STONE */);
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    bigrm_load_map(TOU_GOAL_MAP, false);  // des.map bare string -> lit=FALSE

    quest_region_light(0, 0, 75, 19, true);
    // The Inn.
    quest_region_light(1, 1, 9, 2, true);
    lspo_region({ region: [1, 4, 9, 5], lit: 1, type: 'barracks', filled: 1 });
    quest_region_light(1, 7, 2, 10, false);
    quest_region_light(7, 7, 9, 10, false);
    quest_region_light(1, 14, 2, 15, false);
    quest_region_light(7, 14, 9, 15, false);
    quest_region_light(1, 17, 2, 18, false);
    quest_region_light(7, 17, 9, 18, false);
    lspo_region({ region: [11, 1, 19, 2], lit: 0, type: 'barracks', filled: 1 });
    quest_region_light(21, 1, 30, 2, false);
    lspo_region({ region: [11, 17, 19, 18], lit: 0, type: 'barracks', filled: 1 });
    quest_region_light(21, 17, 30, 18, false);
    // Police Station.
    quest_region_light(18, 7, 25, 11, true);
    quest_region_light(18, 13, 19, 13, false);
    quest_region_light(21, 13, 22, 13, false);
    quest_region_light(24, 13, 25, 13, false);
    // The town itself.
    quest_region_light(42, 3, 47, 6, false);
    quest_region_light(42, 8, 50, 11, false);
    lspo_region({ region: [37, 16, 41, 18], lit: 0, type: 'morgue', filled: 1 });
    quest_region_light(47, 16, 55, 18, false);
    quest_region_light(55, 1, 62, 3, false);
    quest_region_light(64, 1, 71, 3, false);
    lspo_region({ region: [60, 14, 71, 15], lit: 1, type: 'shop', filled: 1 });
    lspo_region({ region: [60, 17, 71, 18], lit: 1, type: 'shop', filled: 1 });
    quest_non_diggable(0, 0, 75, 19);     // des.non_diggable — no RNG.
    quest_place_stair(70, 8, true);

    quest_set_door(7, 3, 'locked'); quest_set_door(2, 6, 'locked');
    quest_set_door(8, 6, 'locked'); quest_set_door(3, 8, 'closed');
    quest_set_door(6, 8, 'closed'); quest_set_door(10, 12, 'open');
    quest_set_door(3, 15, 'closed'); quest_set_door(6, 15, 'closed');
    quest_set_door(3, 17, 'closed'); quest_set_door(6, 17, 'closed');
    quest_set_door(13, 3, 'closed'); tou_random_door(25, 3);
    quest_set_door(13, 16, 'closed'); tou_random_door(25, 16);
    quest_set_door(17, 9, 'locked'); quest_set_door(18, 12, 'locked');
    quest_set_door(21, 12, 'locked'); quest_set_door(24, 12, 'locked');
    quest_set_door(34, 10, 'locked'); quest_set_door(36, 10, 'locked');
    tou_random_door(48, 4); tou_random_door(56, 4); tou_random_door(70, 4);
    tou_random_door(51, 9); tou_random_door(51, 15);
    quest_set_door(59, 14, 'open'); quest_set_door(59, 17, 'open');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // The Master of Thieves' credit card artifact.
        quest_named_object_at(223 /* CREDIT_CARD */, 4, 1,
                              { spe: 0, buc: 'blessed',
                                name: 'The Platinum Yendorian Express Card' });
        for (let i = 0; i < 14; i++) quest_object_rnd();

        // Random traps, avoiding the two shops.
        const validtraps = tou_valid_trap_cells([[60, 14, 71, 18]]);
        for (let i = 0; i < 6; i++) {
            const c = quest_rndcoord(validtraps);
            if (c) await quest_trap(null, c.x - gx.xstart, c.y - gy.ystart);
        }

        quest_create_monster('Master of Thieves', 4, 1, false);
        for (let i = 0; i < 16; i++) quest_monster({ name: 'giant spider' });
        for (let i = 0; i < 2; i++) quest_monster({ cls: S_SPIDER });
        // Ladies of the evening.
        quest_create_monster('succubus', 2, 8, null);
        quest_create_monster('succubus', 8, 8, null);
        quest_create_monster('incubus', 2, 14, null);
        quest_create_monster('incubus', 8, 14, null);
        quest_create_monster('incubus', 2, 17, null);
        quest_create_monster('incubus', 8, 17, null);
        // Police station (with drunken prisoners).
        quest_create_monster('Kop Kaptain', 24, 9, false);
        quest_create_monster('Kop Lieutenant', 20, 9, false);
        quest_create_monster('Kop Lieutenant', 22, 11, false);
        quest_create_monster('Kop Lieutenant', 22, 7, false);
        quest_create_monster('Keystone Kop', 19, 7, false);
        quest_create_monster('Keystone Kop', 19, 8, false);
        quest_create_monster('Keystone Kop', 22, 9, false);
        quest_create_monster('Keystone Kop', 24, 11, false);
        quest_create_monster('Keystone Kop', 19, 11, false);
        quest_create_monster('prisoner', 19, 13, null);
        quest_create_monster('prisoner', 21, 13, null);
        quest_create_monster('prisoner', 24, 13, null);
        quest_create_monster('watchman', 33, 10, false);
        // des.wallify() -- explicit, RNG-free; the finalize pass below repeats
        // it over the same area (matches js/levels/bar_goal.js's ending).
        bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
