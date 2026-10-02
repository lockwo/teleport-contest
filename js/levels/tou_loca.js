// levels/tou_loca.js - special level builder makemaz_tou_loca() (dat/Tou-loca.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { ROOM } from '../const.js';
import { game } from '../gstate.js';
import {
    bigrm_load_map, gx, gy, lspo_region, quest_place_stair, quest_region_light,
    quest_rndcoord, quest_set_door, reset_xystart_size,
} from '../sp_lev.js';
import { quest_named_object_at, quest_object_rnd } from './quest_common.js';
import {
    S_SPIDER, quest_align_shuffle, quest_finalize, quest_level_init_fill,
    quest_monster, quest_non_diggable, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Tourist quest "locate" level (dat/Tou-loca.lua) — a sprawling town map with
// two shops, a morgue, three barracks, a zoo and a temple, all `filled=1`
// rooms stocked by the generic post-mklev fill_special_room() pass, plus a
// scatter of `type="ordinary"` sub-regions layered over the des.map floor
// plan (each one an independent litstate_rnd() draw — order matters).
//
// C ref: mklev.c makelevel() -> makemaz("Tou-loca") -> load_special.
// ════════════════════════════════════════════════════════════════════════

const TOU_LOCA_MAP = [
    '----------------------------------------------------------------------------',
    '|....|......|..........|......|......|...|....|.....|......|...............|',
    '|....|......|.|------|.|......|......|.|.|....|..}..|......|.|----------|..|',
    '|....|--+----.|......|.|-S---+|+-----|.|.S....|.....|---+--|.|..........+..|',
    '|....|........|......|.|...|.........|.|------|..............|..........|-+|',
    '|....+...}}...+......|.|...|.|-----|.|..............|--+----------------|..|',
    '|----|........|------|.|---|.|.....|......|-----+-|.|.......|...........|--|',
    '|............................|.....|.|--+-|.......|.|.......|...........|..|',
    '|----|.....|-------------|...|--+--|.|....|.......|.|-----------+-------|..|',
    '|....+.....+.........S...|...........|....|-------|........................|',
    '|....|.....|.........|...|.|---------|....|.........|-------|.|----------|.|',
    '|....|.....|---------|---|.|......|..+....|-------|.|.......|.+......S.\\.|.|',
    '|....|.....+.........S...|.|......|..|....|.......|.|.......|.|......|...|.|',
    '|-------|..|.........|---|.|+-------------------+-|.|.......+.|----------|.|',
    '|.......+..|---------|.........|.........|..........|.......|.|..........|.|',
    '|.......|..............|--+--|.|.........|.|----+-----------|.|..........|.|',
    '|---------+-|--+-----|-|.....|.|.........|.|........|.|.....+.|..........+.|',
    '|...........|........|.S.....|.|----+----|.|--------|.|.....|.|----------|.|',
    '|...........|........|.|.....|........................|.....|..............|',
    '----------------------------------------------------------------------------',
].join('\n');

// C ref: selection.area(00,00,75,19):filter_mapchar('.') minus one or more
// excluded rectangles — selvar.c selection_filter_mapchar() matches the
// CURRENT levl typ (ROOM for '.'), not the raw des.map character, and draws no
// RNG.  Coordinates are map-relative; the returned Set holds absolute keys,
// matching quest_rndcoord()'s convention.
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

export async function makemaz_tou_loca() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    quest_level_init_fill(0 /* STONE */);
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.hardfloor = true;
    }
    bigrm_load_map(TOU_LOCA_MAP, false);  // des.map bare string -> lit=FALSE

    quest_region_light(0, 0, 75, 19, true);
    // des.non_diggable(selection.area(00,00,75,19)) x2 -- the .lua calls this
    // twice (once here, once again right before the doors); RNG-free either way.
    quest_non_diggable(0, 0, 75, 19);
    lspo_region({ region: [1, 1, 4, 5], lit: 0, type: 'morgue', filled: 1 });
    lspo_region({ region: [15, 3, 20, 5], lit: 1, type: 'shop', filled: 1 });
    lspo_region({ region: [62, 3, 71, 4], lit: 1, type: 'shop', filled: 1 });
    lspo_region({ region: [1, 17, 11, 18], lit: 1, type: 'barracks', filled: 1 });
    lspo_region({ region: [12, 9, 20, 10], lit: 1, type: 'barracks', filled: 1 });
    lspo_region({ region: [53, 11, 59, 14], lit: 1, type: 'zoo', filled: 1 });
    lspo_region({ region: [63, 14, 72, 16], lit: 1, type: 'barracks', filled: 1 });
    lspo_region({ region: [32, 14, 40, 16], lit: 1, type: 'temple', filled: 1 });
    // Sub-regions with no explicit lit: each one draws its own litstate_rnd().
    lspo_region({ region: [6, 1, 11, 2], type: 'ordinary' });
    lspo_region({ region: [24, 1, 29, 2], type: 'ordinary' });
    lspo_region({ region: [31, 1, 36, 2], type: 'ordinary' });
    lspo_region({ region: [42, 1, 45, 3], type: 'ordinary' });
    lspo_region({ region: [53, 1, 58, 2], type: 'ordinary' });
    lspo_region({ region: [24, 4, 26, 5], type: 'ordinary' });
    lspo_region({ region: [30, 6, 34, 7], type: 'ordinary' });
    quest_region_light(73, 5, 74, 5, false);
    lspo_region({ region: [1, 9, 4, 12], type: 'ordinary' });
    lspo_region({ region: [1, 14, 7, 15], type: 'ordinary' });
    lspo_region({ region: [12, 12, 20, 13], type: 'ordinary' });
    lspo_region({ region: [13, 17, 20, 18], type: 'ordinary' });
    lspo_region({ region: [22, 9, 24, 10], type: 'ordinary' });
    lspo_region({ region: [22, 12, 24, 12], type: 'ordinary' });
    lspo_region({ region: [24, 16, 28, 18], type: 'ordinary' });
    lspo_region({ region: [28, 11, 33, 12], type: 'ordinary' });
    quest_region_light(35, 11, 36, 12, true);
    lspo_region({ region: [38, 8, 41, 12], type: 'ordinary' });
    lspo_region({ region: [43, 7, 49, 8], type: 'ordinary' });
    lspo_region({ region: [43, 12, 49, 12], type: 'ordinary' });
    lspo_region({ region: [44, 16, 51, 16], type: 'ordinary' });
    lspo_region({ region: [53, 6, 59, 7], type: 'ordinary' });
    lspo_region({ region: [61, 6, 71, 7], type: 'ordinary' });
    lspo_region({ region: [55, 16, 59, 18], type: 'ordinary' });
    lspo_region({ region: [63, 11, 68, 12], type: 'ordinary' });
    lspo_region({ region: [70, 11, 72, 12], type: 'ordinary' });

    quest_place_stair(10, 4, true);
    quest_place_stair(73, 5, false);
    quest_non_diggable(0, 0, 75, 19);     // second call, see above.

    quest_set_door(5, 5, 'closed'); quest_set_door(5, 9, 'closed');
    quest_set_door(8, 14, 'closed'); quest_set_door(8, 3, 'closed');
    quest_set_door(11, 9, 'closed'); quest_set_door(11, 12, 'closed');
    quest_set_door(10, 16, 'closed'); quest_set_door(14, 5, 'closed');
    quest_set_door(15, 16, 'closed'); quest_set_door(21, 9, 'locked');
    quest_set_door(21, 12, 'locked'); quest_set_door(23, 17, 'closed');
    quest_set_door(25, 3, 'closed'); quest_set_door(26, 15, 'closed');
    quest_set_door(29, 3, 'closed'); quest_set_door(28, 13, 'closed');
    quest_set_door(31, 3, 'closed'); quest_set_door(32, 8, 'closed');
    quest_set_door(37, 11, 'closed'); quest_set_door(36, 17, 'closed');
    quest_set_door(41, 3, 'locked'); quest_set_door(40, 7, 'closed');
    quest_set_door(48, 6, 'closed'); quest_set_door(48, 13, 'closed');
    quest_set_door(48, 15, 'closed'); quest_set_door(56, 3, 'closed');
    quest_set_door(55, 5, 'closed'); quest_set_door(72, 3, 'closed');
    quest_set_door(74, 4, 'locked'); quest_set_door(64, 8, 'closed');
    quest_set_door(62, 11, 'closed'); quest_set_door(69, 11, 'closed');
    quest_set_door(60, 13, 'closed'); quest_set_door(60, 16, 'closed');
    quest_set_door(73, 16, 'closed');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        for (let i = 0; i < 14; i++) quest_object_rnd();
        // des.object("blank paper", 71, 12) x2 -- explicit coord, no spe/buc.
        quest_named_object_at(365 /* SCR_BLANK_PAPER */, 71, 12, {});
        quest_named_object_at(365 /* SCR_BLANK_PAPER */, 71, 12, {});

        // Random traps, avoiding the two shops.
        const validtraps = tou_valid_trap_cells([[15, 3, 20, 5], [62, 3, 71, 4]]);
        for (let i = 0; i < 9; i++) {
            const c = quest_rndcoord(validtraps);
            if (c) await quest_trap(null, c.x - gx.xstart, c.y - gy.ystart);
        }

        for (let i = 0; i < 16; i++) quest_monster({ name: 'giant spider' });
        for (let i = 0; i < 2; i++) quest_monster({ cls: S_SPIDER });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
