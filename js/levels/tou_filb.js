// levels/tou_filb.js - special level builder makemaz_tou_filb() (dat/Tou-filb.lua).
// Structurally identical to Tou-fila (a plain joined/walled/smoothed Mines-style
// cavern filler level for the quest branch) with different stock; reuses
// tou_fila.js's join-capable mkmap.c engine and random-stair helper exactly as
// js/levels/pri_goal.js reuses pri_loca.js's mkmap_mines().

import { COLNO, ROOM, ROWNO, STONE } from '../const.js';
import { game } from '../gstate.js';
import {
    bigrm_wallification, quest_level_init_solidfill, reset_xystart_size, shuffle,
} from '../sp_lev.js';
import { quest_object_rnd, quest_trap_random } from './quest_common.js';
import { S_CENTAUR, quest_monster } from './quest_home_common.js';
import { tou_mkmap_mines, tou_random_stair } from './tou_fila.js';

// C ref: defsym.h MONSYM(34, 'H', GIANT, S_GIANT, ...); MONSYM(19,'s',SPIDER,...).
const S_GIANT = 34, S_SPIDER = 19;

// C ref: mklev.c makelevel() -> makemaz("Tou-filb") -> load_special("Tou-filb.lua").
export async function makemaz_tou_filb() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    reset_xystart_size();                  // sp_level_coder_init (sp_lev.c:6373)

    // des.level_init({ style="solidfill", fg=" " }) -- rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel", "noflip") -- no RNG.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({ style="mines", fg=".", bg=" ", smoothed=true,
    //                  joined=true, walled=true })
    tou_mkmap_mines(STONE, ROOM, true, true, true);

    // des.stair("up"); des.stair("down") -- both random location.
    tou_random_stair(true);
    tou_random_stair(false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        for (let i = 0; i < 11; i++) quest_object_rnd();
        for (let i = 0; i < 4; i++) await quest_trap_random();
        quest_monster({ name: 'soldier', peaceful: false });
        quest_monster({ name: 'captain', peaceful: false });
        quest_monster({ name: 'captain', peaceful: false });
        quest_monster({ cls: S_GIANT, peaceful: false });
        quest_monster({ cls: S_GIANT, peaceful: false });
        quest_monster({ cls: S_CENTAUR, peaceful: false });
        quest_monster({ cls: S_SPIDER });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // load_special() tail: wallification(1,0,COLNO-1,ROWNO-1); "noflip" is set,
    // so flip_level_rnd(allow_flips=0, FALSE) draws nothing.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
