// levels/sam_strt.js - special level builder makemaz_sam_strt() (dat/Sam-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import {
    bigrm_load_map, lspo_region, quest_create_monster, quest_create_object,
    quest_drop_default_invent, quest_place_stair, quest_region_light,
    quest_set_door,
    reset_xystart_size,
} from '../sp_lev.js';
import {
    quest_align_shuffle, quest_finalize, quest_level_init_fill, quest_monster,
    quest_register_branch_region, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Samurai quest "home" level loader (dat/Sam-strt.lua) — Lord Sato's castle,
// besieged by ninjas.
//
// C ref: mklev.c makelevel() -> makemaz("Sam-strt") -> load_special.
// Two things here differ from the already-landed quest homes:
//   * the audience chamber is type="throne" with filled=2 (FILL_LVLFLAGS_ONLY),
//     so fill_special_room() skips fill_zoo() entirely and only sets
//     svl.level.flags.has_court — which is what the .lua's own comment means by
//     "produces random atmospheric messages but doesn't contain any throne";
//   * the branch levregion is a 9x6 RECTANGLE, so place_lregion()'s retry loop
//     draws rn1(9, lx) / rn1(6, ly) rather than the 1-cell rn2(1) pair.
// ════════════════════════════════════════════════════════════════════════

const SAM_STRT_MAP = [
    '..............................................................PP............',
    '...............................................................PP...........',
    '..........---------------------------------------------------...PPP.........',
    '..........|......|.........|...|..............|...|.........|....PPPPP......',
    '......... |......|.........S...|..............|...S.........|.....PPPP......',
    '..........|......|.........|---|..............|---|.........|.....PPP.......',
    '..........+......|.........+...-------++-------...+.........|......PP.......',
    '..........+......|.........|......................|.........|......PP.......',
    '......... |......---------------------++--------------------|........PP.....',
    '..........|.................................................|.........PP....',
    '..........|.................................................|...........PP..',
    '..........----------------------------------------...-------|............PP.',
    '..........................................|.................|.............PP',
    '.............. ................. .........|.................|..............P',
    '............. } ............... } ........|.................|...............',
    '.............. ........PP....... .........|.................|...............',
    '.....................PPP..................|.................|...............',
    '......................PP..................-------------------...............',
    '............................................................................',
    '............................................................................',
].join('\n');

// Main executor.  C ref: makemaz("Sam-strt") -> load_special.
export async function makemaz_sam_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    quest_level_init_fill(0 /* STONE */);
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    bigrm_load_map(SAM_STRT_MAP, false);   // des.map bare string -> lit=FALSE
    quest_region_light(0, 0, 75, 19, true);
    lspo_region({ region: [18, 3, 26, 7], lit: 1, type: 'throne', filled: 2 });
    quest_register_branch_region(62, 12, 70, 17, false);
    quest_place_stair(29, 4, false);
    quest_set_door(10, 6, 'locked'); quest_set_door(10, 7, 'locked');
    quest_set_door(27, 4, 'closed'); quest_set_door(27, 6, 'closed');
    quest_set_door(38, 6, 'closed'); quest_set_door(38, 8, 'locked');
    quest_set_door(39, 6, 'closed'); quest_set_door(39, 8, 'locked');
    quest_set_door(50, 4, 'closed'); quest_set_door(50, 6, 'closed');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        const sato = quest_create_monster('Lord Sato', 20, 4, null);
        quest_drop_default_invent(sato);
        // eroded=-1 / buc="not-cursed" are post-mksobj overrides in
        // create_object(); they draw nothing.
        const mail = quest_create_object(124 /*SPLINT_MAIL*/, null, null, 5, sato);
        if (mail) { mail.oerodeproof = 1; mail.cursed = 0; }
        const katana = quest_create_object(56 /*KATANA*/, null, null, 4, sato);
        if (katana) { katana.oerodeproof = 1; katana.cursed = 0; }
        quest_create_object(CHEST, 20, 4, null, null);
        const roshi = [[18, 4], [18, 5], [18, 6], [18, 7],
                       [26, 4], [26, 5], [26, 6], [26, 7]];
        for (const [rx, ry] of roshi) quest_create_monster('roshi', rx, ry, null);
        // des.non_diggable — no RNG.
        for (let i = 0; i < 6; i++) await quest_trap();
        // Monsters on siege duty.
        quest_monster({ name: 'ninja', mx: 64, my: 0, peaceful: 0 });
        quest_create_monster('wolf', 65, 1, null);
        quest_monster({ name: 'ninja', mx: 67, my: 2, peaceful: 0 });
        quest_monster({ name: 'ninja', mx: 69, my: 5, peaceful: 0 });
        quest_monster({ name: 'ninja', mx: 69, my: 6, peaceful: 0 });
        quest_create_monster('wolf', 69, 7, null);
        quest_monster({ name: 'ninja', mx: 70, my: 6, peaceful: 0 });
        quest_monster({ name: 'ninja', mx: 70, my: 7, peaceful: 0 });
        quest_monster({ name: 'ninja', mx: 72, my: 1, peaceful: 0 });
        quest_create_monster('wolf', 75, 9, null);
        quest_monster({ name: 'ninja', mx: 73, my: 5, peaceful: 0 });
        quest_monster({ name: 'ninja', mx: 68, my: 2, peaceful: 0 });
        quest_monster({ name: 'stalker' });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
