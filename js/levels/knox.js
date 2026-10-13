// levels/knox.js - special level builder makemaz_knox(), dat/knox.lua.
// Fort Ludios: Croesus's vault, a throne room, zoo, barracks, and a moated
// treasury ringed by gems.

import {
    BARRACKS, COLNO, COURT, FILL_NORMAL, OROOM, ROWNO, SDOOR, ROOM, THRONE, VWALL, ZOO,
} from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import { objects } from '../mkobj.js';
import {
    bigrm_load_map, bigrm_wallification, create_des_coder, flip_level, lspo_gold, percent,
    quest_create_object, quest_flip_branch, quest_level_init_solidfill,
    quest_register_branch, remove_boundary_syms, map_cleanup, shuffle,
    splev_create_monster, splev_door_at, splev_finish_object,
    splev_link_doors_rooms, splev_region_lit, vly_flip_dndest, vly_flip_updest,
    vly_non_diggable, vly_region, vly_teleport_region, vly_terrain_at, vly_trap,
} from '../sp_lev.js';
import { WIZ_MONSYM } from './wiz_common.js';

// C ref: dat/knox.lua (Fort Ludios).  Loading nhlib.lua first runs
// shuffle(align) (rn2(3), rn2(2)); then the des.* program runs in file order.
const KNOX_MAP = [
    '----------------------------------------------------------------------------',
    '| |........|...............................................................|',
    '| |........|.................................................------------..|',
    '| --S----S--.................................................|..........|..|',
    '|   #   |........}}}}}}}....................}}}}}}}..........|..........|..|',
    '|   #   |........}-----}....................}-----}..........--+--+--...|..|',
    '|   # ---........}|...|}}}}}}}}}}}}}}}}}}}}}}|...|}.................|...|..|',
    '|   # |..........}---S------------------------S---}.................|...|..|',
    '|   # |..........}}}|...............|..........|}}}.................+...|..|',
    '| --S----..........}|...............S..........|}...................|...|..|',
    '| |.....|..........}|...............|......\\...S}...................|...|..|',
    '| |.....+........}}}|...............|..........|}}}.................+...|..|',
    '| |.....|........}---S------------------------S---}.................|...|..|',
    '| |.....|........}|...|}}}}}}}}}}}}}}}}}}}}}}|...|}.................|...|..|',
    '| |..-S----......}-----}....................}-----}..........--+--+--...|..|',
    '| |..|....|......}}}}}}}....................}}}}}}}..........|..........|..|',
    '| |..|....|..................................................|..........|..|',
    '| -----------................................................------------..|',
    '|           |..............................................................|',
    '----------------------------------------------------------------------------',
].join('\n');

// C ref: trap.h trap numbers named by knox.lua's treasure_spot().
const KNOX_LAND_MINE = 6, KNOX_SPIKED_PIT = 12;

// C ref: nhlib.lua math.random(lo,hi) -> lo + rn2(hi+1-lo).
function lua_random(lo, hi) { return lo + rn2(hi + 1 - lo); }

// des.object("<gem>", x, y): explicit coordinate, so no location draw.
function knox_gem(name, mx, my) {
    const otyp = objects.findIndex((o) => o && o.name === name);
    splev_finish_object(quest_create_object(otyp, mx, my, null, null));
}

// C ref: knox.lua treasure_spot(x, y).
async function treasure_spot(x, y) {
    lspo_gold(600 + lua_random(0, 300), x, y);
    if (lua_random(0, 2) === 0) {
        if (lua_random(0, 2) === 0) await vly_trap(KNOX_SPIKED_PIT, x, y);
        else await vly_trap(KNOX_LAND_MINE, x, y);
    }
}

// Entry point.  C ref: makemaz("knox") -> load_special("knox.lua").
export async function makemaz_knox() {
    const g = game;
    // load_special() builds the des coder (and resets xstart/ystart) up front;
    // lspo_gold() would otherwise build it lazily in the middle of the level.
    create_des_coder();
    shuffle(['law', 'neutral', 'chaos']);
    quest_level_init_solidfill();
    // des.level_flags("mazelevel", "noteleport") - no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
    }
    bigrm_load_map(KNOX_MAP, false);
    vly_non_diggable(0, 0, 75, 19);
    quest_register_branch(8, 16);
    vly_teleport_region(6, 15, 9, 16, false, 'up');
    vly_teleport_region(6, 15, 9, 16, false, 'down');
    g._full_mon_gen = true;
    try {
        vly_region(37, 8, 46, 11, 1, COURT, FILL_NORMAL, false);
        if (percent(50)) {
            splev_create_monster({ name: 'Croesus', mx: 43, my: 10, peaceful: false });
        } else {
            splev_create_monster({ name: 'Croesus', mx: 43, my: 9, peaceful: false });
            vly_terrain_at(43, 9, THRONE);
            vly_terrain_at(43, 10, ROOM);
        }
        if (percent(50)) {
            vly_terrain_at(47, 9, SDOOR);
            vly_terrain_at(47, 10, VWALL);
        }
        vly_region(21, 8, 35, 11, 1, OROOM, 0, false);
        // selection.area(21,08,35,11):iterate() is nhlsel.c l_selection_iterate():
        // y outer, x inner (unlike selvar.c's internal column-major iterate).
        for (let y = 8; y <= 11; y++)
            for (let x = 21; x <= 35; x++) await treasure_spot(x, y);
        if (percent(50)) {
            vly_terrain_at(36, 9, VWALL);
            vly_terrain_at(36, 10, SDOOR);
        }
        splev_region_lit(19, 6, 21, 6, true);
        splev_region_lit(46, 6, 48, 6, true);
        splev_region_lit(19, 13, 21, 13, true);
        splev_region_lit(46, 13, 48, 13, true);
        vly_region(3, 10, 7, 13, 1, ZOO, FILL_NORMAL, true);
        vly_region(6, 15, 9, 16, 0, OROOM, 0, false);
        splev_region_lit(5, 14, 5, 17, false);
        splev_region_lit(5, 14, 9, 14, false);
        vly_region(62, 3, 71, 4, 1, BARRACKS, FILL_NORMAL, true);
    splev_door_at('closed', 6, 14);
    splev_door_at('closed', 9, 3);
    splev_door_at('open', 63, 5);
    splev_door_at('open', 66, 5);
    splev_door_at('open', 68, 8);
    splev_door_at('locked', 8, 11);
    splev_door_at('open', 68, 11);
    splev_door_at('closed', 63, 14);
    splev_door_at('closed', 66, 14);
    splev_door_at('closed', 4, 3);
    splev_door_at('closed', 4, 9);
    splev_create_monster({ name: 'soldier', mx: 12, my: 14 });
    splev_create_monster({ name: 'soldier', mx: 12, my: 13 });
    splev_create_monster({ name: 'soldier', mx: 11, my: 10 });
    splev_create_monster({ name: 'soldier', mx: 13, my: 2 });
    splev_create_monster({ name: 'soldier', mx: 14, my: 3 });
    splev_create_monster({ name: 'soldier', mx: 20, my: 2 });
    splev_create_monster({ name: 'soldier', mx: 30, my: 2 });
    splev_create_monster({ name: 'soldier', mx: 40, my: 2 });
    splev_create_monster({ name: 'soldier', mx: 30, my: 16 });
    splev_create_monster({ name: 'soldier', mx: 32, my: 16 });
    splev_create_monster({ name: 'soldier', mx: 40, my: 16 });
    splev_create_monster({ name: 'soldier', mx: 54, my: 16 });
    splev_create_monster({ name: 'soldier', mx: 54, my: 14 });
    splev_create_monster({ name: 'soldier', mx: 54, my: 13 });
    splev_create_monster({ name: 'soldier', mx: 57, my: 10 });
    splev_create_monster({ name: 'soldier', mx: 57, my: 9 });
    splev_create_monster({ name: 'lieutenant', mx: 15, my: 8 });
    splev_create_monster({ name: 'stone giant', mx: 3, my: 1 });
    splev_create_monster({ cls: WIZ_MONSYM.D, mx: 18, my: 9 });
    splev_create_monster({ cls: WIZ_MONSYM.D, mx: 49, my: 10 });
    splev_create_monster({ cls: WIZ_MONSYM.D, mx: 33, my: 5 });
    splev_create_monster({ cls: WIZ_MONSYM.D, mx: 33, my: 14 });
    splev_create_monster({ name: 'giant eel', mx: 17, my: 8 });
    splev_create_monster({ name: 'giant eel', mx: 17, my: 11 });
    splev_create_monster({ name: 'giant eel', mx: 48, my: 8 });
    splev_create_monster({ name: 'giant eel', mx: 48, my: 11 });
    knox_gem('diamond', 19, 6);
    knox_gem('diamond', 20, 6);
    knox_gem('diamond', 21, 6);
    knox_gem('emerald', 19, 13);
    knox_gem('emerald', 20, 13);
    knox_gem('emerald', 21, 13);
    knox_gem('ruby', 46, 6);
    knox_gem('ruby', 47, 6);
    knox_gem('ruby', 48, 6);
    knox_gem('amethyst', 46, 13);
    knox_gem('amethyst', 47, 13);
    knox_gem('amethyst', 48, 13);
    } finally {
        g._full_mon_gen = false;
    }

    // lspo_finalize_level(): doors linked, boundary syms removed, wallified,
    // then flip_level_rnd(allow_flips=3).
    splev_link_doors_rooms();
    remove_boundary_syms();
    map_cleanup();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;
    if (rn2(2)) flp |= 2;
    if (flp) {
        flip_level(flp);
        quest_flip_branch(flp);
        vly_flip_dndest(flp);
        vly_flip_updest(flp);
    }
}
