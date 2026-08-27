// levels/ran_strt.js - special level builder makemaz_ran_strt() (dat/Ran-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { ROOM, TREE } from '../const.js';
import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import {
    quest_create_monster, quest_create_object, quest_drop_default_invent,
    quest_place_stair, quest_region_light, quest_replace_terrain,
    reset_xystart_size, tower1_load_map,
} from '../sp_lev.js';
import {
    ARROW_TRAP, BEAR_TRAP, PIT, SPIKED_PIT, quest_align_shuffle, quest_finalize,
    quest_level_init_fill, quest_level_init_mines_flat, quest_monster,
    quest_register_branch_region, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Ranger quest "home" level loader (dat/Ran-strt.lua) — Orion's forest maze,
// besieged by centaurs.
//
// C ref: mklev.c makelevel() -> makemaz("Ran-strt") -> load_special.
// Ran-strt is the only quest home whose des.replace_terrain runs BEFORE its
// des.map, so its region is offset by the coder's INITIAL xstart/ystart (1/0
// from sp_level_coder_init), not by a map origin — 77x20 squares, every one of
// them ROOM after the mines-style level_init, so it is a flat 1540 rn2(100)
// draws.  The map itself is placed halign="left"/valign="center"
// (SPLEV_H_LEFT/SPLEV_CENTER), the same offset arithmetic Vlad's tower uses.
// ════════════════════════════════════════════════════════════════════════

const RAN_STRT_MAP = [
    '                                       xx',
    '   ...................................  x',
    '  ..                                 ..  ',
    ' ..  ...............F...............  .. ',
    ' .  ..             .F.             ..  . ',
    ' . ..  .............F.............  .. . ',
    ' . .  ..                         ..  . . ',
    ' . . ..  .......................  .. ... ',
    ' . . .  ..                     ..  .     ',
    ' ... . ..  .|..................... ......',
    ' FFF . .  ..S..................          ',
    ' ... . ..  .|.................  .... ... ',
    ' . . .  ..                     ..  . . . ',
    ' . . ..  .......................  .. . . ',
    ' . .  ..                         ..  . . ',
    ' . ..  .............F.............  .. . ',
    ' .  ..             .F.             ..  . ',
    ' ..  ...............F...............  .. ',
    '  ..                                 ..  ',
    '   ...................................  x',
    '                                       xx',
].join('\n');

// Main executor.  C ref: makemaz("Ran-strt") -> load_special.
export async function makemaz_ran_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    quest_level_init_fill(ROOM);          // style="solidfill", fg="."
    // des.level_flags("mazelevel", "noteleport", "hardfloor", "arboreal").
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
        g.level.flags.arboreal = true;
    }
    quest_level_init_mines_flat();
    quest_replace_terrain(0, 0, 76, 19, ROOM, TREE, 5);
    // des.map({ halign="left", valign="center", map=... }).
    tower1_load_map(RAN_STRT_MAP, false);  // des.map lit option unset -> FALSE
    quest_region_light(0, 0, 40, 20, true);
    quest_place_stair(10, 10, false);
    // Portal arrival point; anywhere on the right-hand side of the LEVEL
    // (region_islev = 1, so these are absolute coordinates).
    quest_register_branch_region(51, 2, 77, 18, true);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        const orion = quest_create_monster('Orion', 20, 10, null);
        quest_drop_default_invent(orion);
        quest_create_object(134 /*LEATHER_ARMOR*/, null, null, 4, orion);
        quest_create_object(86 /*YUMI*/, null, null, 4, orion);
        const ya = quest_create_object(22 /*YA*/, null, null, 4, orion);
        if (ya) ya.quan = 50;
        quest_create_object(CHEST, 20, 10, null, null);
        const hunters = [[19, 9], [20, 9], [21, 9], [19, 10],
                         [21, 10], [19, 11], [20, 11], [21, 11]];
        for (const [hx, hy] of hunters) quest_create_monster('hunter', hx, hy, null);
        // des.non_diggable — no RNG.
        await quest_trap(ARROW_TRAP, 30, 9);
        await quest_trap(ARROW_TRAP, 30, 10);
        await quest_trap(PIT, 40, 9);
        await quest_trap(SPIKED_PIT);
        await quest_trap(BEAR_TRAP);
        await quest_trap(BEAR_TRAP);
        // Monsters on siege duty.
        quest_monster({ name: 'minotaur', mx: 33, my: 9, peaceful: 0, asleep: 1 });
        const centaurs = [[19, 3], [19, 4], [19, 5], [21, 3], [21, 4], [21, 5],
                          [1, 9], [2, 9], [3, 9], [1, 11], [2, 11], [3, 11],
                          [19, 15], [19, 16], [19, 17], [21, 15], [21, 16], [21, 17]];
        for (const [cx, cy] of centaurs)
            quest_monster({ name: 'forest centaur', mx: cx, my: cy, peaceful: 0 });
        for (let i = 0; i < 6; i++)
            quest_monster({ name: 'plains centaur', peaceful: 0 });
        for (let i = 0; i < 2; i++)
            quest_monster({ name: 'scorpion', peaceful: 0 });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
