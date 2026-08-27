// levels/kni_strt.js - special level builder makemaz_kni_strt() (dat/Kni-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { ROOM } from '../const.js';
import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import {
    bigrm_load_map, lspo_region, percent, quest_create_object,
    quest_drop_default_invent, quest_place_stair, quest_region_light,
    quest_register_branch, quest_set_door, reset_xystart_size,
} from '../sp_lev.js';
import { rn2 } from '../rng.js';
import {
    SLP_GAS_TRAP, quest_align_shuffle, quest_finalize, quest_level_init_fill,
    quest_level_init_mines_flat, quest_monster, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Knight quest "home" level loader (dat/Kni-strt.lua) — King Arthur's keep,
// besieged by quasits.
//
// C ref: mklev.c makelevel() -> makemaz("Kni-strt") -> load_special.
// The .lua runs level_init TWICE: a solidfill with fg="." and then, as its own
// comment says, "a kludge to init the level as a lit field" — style="mines"
// with fg == bg == "." and lit=1.  That second call is not decorative: mkmap()'s
// init_fill draws a fixed 1248 PRNG calls there (see
// quest_level_init_mines_flat).  The throne room is filled=2
// (FILL_LVLFLAGS_ONLY), so it only sets svl.level.flags.has_court — fill_zoo()
// never runs and the room stays as the .lua drew it.
// ════════════════════════════════════════════════════════════════════════

const KNI_STRT_MAP = [
    '..................................................',
    '.-----......................................-----.',
    '.|...|......................................|...|.',
    '.--|+-------------------++-------------------+|--.',
    '...|...................+..+...................|...',
    '...|.|-----------------|++|-----------------|.|...',
    '...|.|.................|..|.........|.......|.|...',
    '...|.|...\\.............+..+.........|.......|.|...',
    '...|.|.................+..+.........+.......|.|...',
    '...|.|.................|..|.........|.......|.|...',
    '...|.|--------------------------------------|.|...',
    '...|..........................................|...',
    '.--|+----------------------------------------+|--.',
    '.|...|......................................|...|.',
    '.-----......................................-----.',
    '..................................................',
].join('\n');

// Main executor.  C ref: makemaz("Kni-strt") -> load_special.
export async function makemaz_kni_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    // des.level_init({ style="solidfill", fg="." }) — rn2(2) + fill ROOM
    // (`filling` defaults to `fg`, so this is floor, not stone).
    quest_level_init_fill(ROOM);
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    quest_level_init_mines_flat();
    bigrm_load_map(KNI_STRT_MAP, false);   // des.map bare string -> lit=FALSE
    quest_region_light(0, 0, 49, 15, true);
    quest_region_light(4, 4, 45, 11, false);
    lspo_region({ region: [6, 6, 22, 9], lit: 1, type: 'throne', filled: 2 });
    quest_region_light(27, 6, 43, 9, true);
    quest_register_branch(20, 14);
    quest_place_stair(40, 7, false);
    // Outside doors.
    quest_set_door(24, 3, 'locked'); quest_set_door(25, 3, 'locked');
    // Inside doors.
    quest_set_door(23, 4, 'closed'); quest_set_door(26, 4, 'closed');
    quest_set_door(24, 5, 'locked'); quest_set_door(25, 5, 'locked');
    quest_set_door(23, 7, 'closed'); quest_set_door(26, 7, 'closed');
    quest_set_door(23, 8, 'closed'); quest_set_door(26, 8, 'closed');
    quest_set_door(36, 8, 'closed');
    // Watchroom doors.
    quest_set_door(4, 3, 'closed'); quest_set_door(45, 3, 'closed');
    quest_set_door(4, 12, 'closed'); quest_set_door(45, 12, 'closed');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        const arthur = quest_monster({ name: 'King Arthur', mx: 9, my: 7 });
        quest_drop_default_invent(arthur);
        const excalibur = quest_create_object(54 /*LONG_SWORD*/, null, null, 4, arthur);
        if (excalibur) { excalibur.blessed = 1; excalibur.cursed = 0; excalibur.oname = 'Excalibur'; }
        quest_create_object(121 /*PLATE_MAIL*/, null, null, 4, arthur);
        quest_create_object(CHEST, 9, 7, null, null);
        for (const [kx, ky] of [[4, 2], [4, 13], [45, 2], [45, 13]])
            quest_monster({ name: 'knight', mx: kx, my: ky, peaceful: 1 });
        for (const [px, py] of [[16, 6], [18, 6], [20, 6], [16, 9], [18, 9], [20, 9]])
            quest_monster({ name: 'page', mx: px, my: py });
        // des.non_diggable — no RNG.
        await quest_trap(SLP_GAS_TRAP, 24, 4);
        await quest_trap(SLP_GAS_TRAP, 25, 4);
        for (let i = 0; i < 4; i++) await quest_trap();
        for (let qx = 14; qx <= 36; qx += 2)
            quest_monster({ name: 'quasit', mx: qx, my: 0, peaceful: 0 });
        // Some warhorses: `for i = 1, 2 + nh.rn2(3)`, each with a CUSTOM
        // inventory function (so makemon's default invent is dropped first) that
        // rolls percent(50) for a saddle.
        const nhorses = 2 + rn2(3);
        for (let i = 0; i < nhorses; i++) {
            const horse = quest_monster({ name: 'warhorse', peaceful: 1 });
            quest_drop_default_invent(horse);
            if (percent(50)) quest_create_object(235 /*SADDLE*/, null, null, null, horse);
        }
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
