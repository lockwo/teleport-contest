// levels/tou_strt.js - special level builder makemaz_tou_strt() (dat/Tou-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import {
    bigrm_load_map, lspo_region, quest_create_monster, quest_create_object,
    quest_drop_default_invent, quest_place_stair, quest_region_light,
    quest_register_branch, quest_set_door,
    reset_xystart_size,
} from '../sp_lev.js';
import {
    S_CENTAUR, S_SPIDER, quest_align_shuffle, quest_finalize,
    quest_level_init_fill, quest_monster, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Tourist quest "home" level loader (dat/Tou-strt.lua) — Twoflower's city
// of Ankh-Morpork, with a river and a graveyard.
//
// C ref: mklev.c makelevel() -> makemaz("Tou-strt") -> load_special.
// The graveyard is type="morgue" with filled=1 (FILL_NORMAL), so unlike the
// throne rooms on Kni/Sam-strt this room really is stocked: lspo_finalize_level's
// closing fill_special_room() loop runs fill_zoo(MORGUE) over it (a morguemon()
// per square plus the per-square corpse/box/grave rolls).  That loop is the
// engine's post-mklev fill pass here, exactly as it is for the Valley's morgues.
// ════════════════════════════════════════════════════════════════════════

const TOU_STRT_MAP = [
    '.......}}....---------..-------------------------------------------------...',
    '........}}...|.......|..|.-------------------------------------------...|...',
    '.........}}..|.......|..|.|......|......|.............|......|......|...|...',
    '..........}}.|.......|..|.|......+......+.............+......+..\\...|...|...',
    '...........}}}..........|.|......|......|.............|......|......|...|...',
    '.............}}.........|.|----S-|--S---|S----------S-|---S--|------|...|...',
    '..............}}}.......|...............................................|...',
    '................}}}.....----S------++--S----------S----------S-----------...',
    '..................}}...........    ..    ...................................',
    '......-------......}}}}........}}}}..}}}}..}}}}..}}}}.......................',
    '......|.....|.......}}}}}}..}}}}   ..   }}}}..}}}}..}}}.....................',
    '......|.....+...........}}}}}}........................}}}..}}}}..}}}..}}}...',
    '......|.....|...........................................}}}}..}}}..}}}}.}}}}',
    '......-------...............................................................',
    '............................................................................',
    '...-------......-------.....................................................',
    '...|.....|......|.....|.....................................................',
    '...|.....+......+.....|.....................................................',
    '...|.....|......|.....|.....................................................',
    '...-------......-------.....................................................',
].join('\n');

// Main executor.  C ref: makemaz("Tou-strt") -> load_special.
export async function makemaz_tou_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    quest_level_init_fill(0 /* STONE */);
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    bigrm_load_map(TOU_STRT_MAP, false);   // des.map bare string -> lit=FALSE
    quest_region_light(0, 0, 75, 19, true);
    lspo_region({ region: [14, 1, 20, 3], lit: 0, type: 'morgue', filled: 1 });
    quest_region_light(7, 10, 11, 12, false);
    quest_region_light(4, 16, 8, 18, false);
    quest_region_light(17, 16, 21, 18, false);
    quest_region_light(27, 2, 32, 4, false);
    quest_region_light(34, 2, 39, 4, false);
    quest_region_light(41, 2, 53, 4, false);
    quest_region_light(55, 2, 60, 4, false);
    quest_region_light(62, 2, 67, 4, true);
    quest_place_stair(66, 3, false);
    quest_register_branch(68, 14);
    // des.non_diggable — no RNG.
    quest_set_door(31, 5, 'locked'); quest_set_door(36, 5, 'locked');
    quest_set_door(41, 5, 'locked'); quest_set_door(52, 5, 'locked');
    quest_set_door(58, 5, 'locked'); quest_set_door(28, 7, 'locked');
    quest_set_door(39, 7, 'locked'); quest_set_door(50, 7, 'locked');
    quest_set_door(61, 7, 'locked'); quest_set_door(33, 3, 'closed');
    quest_set_door(40, 3, 'closed'); quest_set_door(54, 3, 'closed');
    quest_set_door(61, 3, 'closed'); quest_set_door(12, 11, 'open');
    quest_set_door(9, 17, 'open'); quest_set_door(16, 17, 'open');
    quest_set_door(35, 7, 'locked'); quest_set_door(36, 7, 'locked');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // Monsters on siege duty come BEFORE the leader in this .lua.
        for (let i = 0; i < 12; i++) quest_monster({ name: 'giant spider' });
        for (let i = 0; i < 2; i++) quest_monster({ cls: S_SPIDER });
        for (let i = 0; i < 8; i++) quest_monster({ name: 'forest centaur' });
        quest_monster({ cls: S_CENTAUR });
        // Twoflower + custom inventory (walking shoes+3, Hawaiian shirt+3).
        // "walking shoes" is LOW_BOOTS' OBJ_DESCR, which find_objtype() falls
        // back to after the OBJ_NAME scan misses.
        const twoflower = quest_create_monster('Twoflower', 64, 3, null);
        quest_drop_default_invent(twoflower);
        quest_create_object(163 /*LOW_BOOTS*/, null, null, 3, twoflower);
        quest_create_object(136 /*HAWAIIAN_SHIRT*/, null, null, 3, twoflower);
        quest_create_object(CHEST, 64, 3, null, null);
        const guides = [[29, 3], [32, 4], [35, 2], [38, 3], [45, 3], [48, 2],
                        [49, 4], [51, 3], [57, 3], [62, 4], [66, 4]];
        for (const [gx2, gy2] of guides) quest_create_monster('guide', gx2, gy2, null);
        quest_create_monster('watchman', 35, 8, null);
        quest_create_monster('watchman', 36, 8, null);
        quest_create_monster('giant eel', 62, 12, null);
        quest_create_monster('piranha', 47, 10, null);
        quest_create_monster('piranha', 29, 11, null);
        quest_create_monster('kraken', 34, 9, null);
        quest_create_monster('kraken', 37, 9, null);
        for (let i = 0; i < 9; i++) await quest_trap();
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
