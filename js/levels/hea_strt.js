// levels/hea_strt.js - special level builder makemaz_hea_strt() (dat/Hea-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { ALTAR, AM_NEUTRAL, POOL, ROOM } from '../const.js';
import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import {
    bigrm_load_map, q_absx, q_absy, quest_create_monster, quest_create_object,
    quest_drop_default_invent, quest_place_stair, quest_region_light,
    quest_register_branch, quest_replace_terrain, quest_set_door,
    reset_xystart_size,
} from '../sp_lev.js';
import {
    S_DRAGON, S_EEL, S_SNAKE, quest_align_shuffle, quest_finalize,
    quest_level_init_fill, quest_monster, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Healer quest "home" level loader (dat/Hea-strt.lua) — Hippocrates' clinic
// on an island in a swamp.
//
// C ref: mklev.c makelevel() -> makemaz("Hea-strt") -> load_special.
// The altar is align="neutral", type="altar": an explicit alignment means
// sp_amask_to_amask() takes the `sp_amask & AM_MASK` arm (no induced_align
// rn2(3)) and shrine == 0 makes create_altar() return before priestini().
// ════════════════════════════════════════════════════════════════════════

const HEA_STRT_MAP = [
    'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP',
    'PPPP........PPPP.....PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP.P..PPPPP......PPPPPPPP',
    'PPP..........PPPP...PPPPP.........................PPPP..PPPPP........PPPPPPP',
    'PP............PPPPPPPP..............................PPP...PPPP......PPPPPPPP',
    'P.....PPPPPPPPPPPPPPP................................PPPPPPPPPPPPPPPPPPPPPPP',
    'PPPP....PPPPPPPPPPPP...................................PPPPP.PPPPPPPPPPPPPPP',
    'PPPP........PPPPP.........-----------------------........PP...PPPPPPP.....PP',
    'PPP............PPPPP....--|.|......S..........S.|--.....PPPP.PPPPPPP.......P',
    'PPPP..........PPPPP.....|.S.|......-----------|S|.|......PPPPPP.PPP.......PP',
    'PPPPPP......PPPPPP......|.|.|......|...|......|.|.|.....PPPPPP...PP.......PP',
    'PPPPPPPPPPPPPPPPPPP.....+.|.|......S.\\.S......|.|.+......PPPPPP.PPPP.......P',
    'PPP...PPPPP...PPPP......|.|.|......|...|......|.|.|.......PPPPPPPPPPP.....PP',
    'PP.....PPP.....PPP......|.|S|-----------......|.S.|......PPPPPPPPPPPPPPPPPPP',
    'PPP..PPPPP...PPPP.......--|.S..........S......|.|--.....PPPPPPPPP....PPPPPPP',
    'PPPPPPPPPPPPPPPP..........-----------------------..........PPPPP..........PP',
    'PPPPPPPPPPPPPPPPP........................................PPPPPP............P',
    'PPP.............PPPP...................................PPP..PPPP..........PP',
    'PP...............PPPPP................................PPPP...PPPP........PPP',
    'PPP.............PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP....PPPPPP',
    'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP',
].join('\n');

// Main executor.  C ref: makemaz("Hea-strt") -> load_special.
export async function makemaz_hea_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    quest_level_init_fill(0 /* STONE */);
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    bigrm_load_map(HEA_STRT_MAP, false);   // des.map bare string -> lit=FALSE
    quest_replace_terrain(1, 1, 74, 18, POOL, ROOM, 10);
    quest_region_light(0, 0, 75, 19, true);
    quest_place_stair(37, 9, false);
    quest_register_branch(4, 12);
    { const loc = g.level?.at(q_absx(32), q_absy(9));
      if (loc) { loc.typ = ALTAR; loc.altarmask = AM_NEUTRAL; } }
    quest_set_door(24, 10, 'locked'); quest_set_door(26, 8, 'closed');
    quest_set_door(27, 12, 'closed'); quest_set_door(28, 13, 'locked');
    quest_set_door(35, 7, 'closed'); quest_set_door(35, 10, 'locked');
    quest_set_door(39, 10, 'locked'); quest_set_door(39, 13, 'closed');
    quest_set_door(46, 7, 'locked'); quest_set_door(47, 8, 'closed');
    quest_set_door(48, 12, 'closed'); quest_set_door(50, 10, 'locked');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        const hippocrates = quest_create_monster('Hippocrates', 37, 10, null);
        quest_drop_default_invent(hippocrates);
        quest_create_object(37 /*SILVER_DAGGER*/, null, null, 5, hippocrates);
        quest_create_object(CHEST, 37, 10, null, null);
        const attendants = [[29, 8], [29, 9], [29, 10], [29, 11],
                            [40, 9], [40, 10], [40, 11], [40, 13]];
        for (const [ax, ay] of attendants) quest_create_monster('attendant', ax, ay, null);
        // des.non_diggable — no RNG.
        for (let i = 0; i < 6; i++) await quest_trap();
        // Monsters on siege duty — all at random locations, so each one's
        // get_location_coord runs the rn2(xsize)/rn2(ysize) loop for the
        // species' own humidity (the eel/shark ones accept water first).
        for (let i = 0; i < 10; i++) quest_monster({ name: 'rabid rat' });
        quest_monster({ name: 'giant eel' });
        quest_monster({ name: 'shark' });
        quest_monster({ cls: S_EEL });
        for (let i = 0; i < 5; i++) quest_monster({ cls: S_DRAGON, peaceful: 0 });
        for (let i = 0; i < 5; i++) quest_monster({ cls: S_SNAKE, peaceful: 0 });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
