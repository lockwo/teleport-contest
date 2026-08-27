// levels/wiz_strt.js - special level builder makemaz_wiz_strt() (dat/Wiz-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { CLOUD, ROOM } from '../const.js';
import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import {
    lspo_region, quest_create_monster, quest_create_object,
    quest_drop_default_invent, quest_place_stair, quest_region_light,
    quest_register_branch, quest_replace_terrain, quest_set_door,
    bigrm_load_map,
    reset_xystart_size,
} from '../sp_lev.js';
import {
    S_BAT, S_IMP, S_WRAITH, quest_align_shuffle, quest_finalize,
    quest_level_init_fill, quest_monster, quest_terrain_at, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Wizard quest "home" level loader (dat/Wiz-strt.lua) — Neferet the Green's
// besieged tower, ringed by clouds.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Wiz-strt")
// -> load_special("Wiz-strt.lua").  Verified against the recorded C RNG trace
// (sessions/seed0360-wizard-world-tour, flat step 373): 1846 calls, opening
// getbones + nhlib's shuffle(align) (rn2(3), rn2(2)) + splev_initlev's rn2(2),
// then exactly 1222 lspo_replace_terrain rn2(100) draws — 1205 for the
// floor->cloud pass over the whole map and 17 for the cloud->floor pass over
// the tower interior, which is what pins the map transcription and the
// x-outer/y-inner iteration order below.
// ════════════════════════════════════════════════════════════════════════

const WIZ_STRT_MAP = [
    '............................................................................',
    '.....................C....CC.C........................C.....................',
    '..........CCC.....................CCC.......................................',
    '........CC........-----------.......C.C...C...C....C........................',
    '.......C.....---------------------...C..C..C..C.............................',
    '......C..C...------....\\....------....C.....C...............................',
    '........C...||....|.........|....||.........................................',
    '.......C....||....|.........+....||.........................................',
    '.......C...||---+--.........|....|||........................................',
    '......C....||...............|--S--||........................................',
    '...........||--+--|++----|---|..|.SS..........C......C......................',
    '........C..||.....|..|...|...|--|.||..CC..C.....C..........C................',
    '.......C...||.....|..|.--|.|.|....||.................C..C...................',
    '.....C......||....|..|.....|.|.--||..C..C..........C...........}}}..........',
    '......C.C...||....|..-----.|.....||...C.C.C..............C....}}}}}}........',
    '.........C...------........|------....C..C.....C..CC.C......}}}}}}}}}}}.....',
    '.........CC..---------------------...C.C..C.....CCCCC.C.......}}}}}}}}......',
    '.........C........-----------..........C.C.......CCC.........}}}}}}}}}......',
    '..........C.C.........................C............C...........}}}}}........',
    '......................CCC.C.................................................',
].join('\n');

// Main executor.  C ref: makemaz("Wiz-strt") -> load_special.
export async function makemaz_wiz_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_fill(0 /* STONE */);
    // des.level_flags("mazelevel", "noteleport", "hardfloor") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    bigrm_load_map(WIZ_STRT_MAP, false);   // des.map bare string -> lit=FALSE
    // "first do cloud everywhere", "then replace clouds inside the tower back
    // to floor".  chance=100 still draws its rn2(100) per matching square.
    quest_replace_terrain(0, 0, 75, 19, ROOM, CLOUD, 10);
    quest_replace_terrain(13, 5, 33, 15, CLOUD, ROOM, 100);
    // des.region — the plain lit/unlit selection form draws nothing.
    quest_region_light(0, 0, 75, 19, true);
    quest_region_light(35, 0, 49, 3, false);
    quest_region_light(43, 12, 49, 16, false);
    // The one region that really builds a room: irregular => lspo_region's
    // room_not_needed test fails, so it flood-fills a room instead of just
    // relighting a rectangle.  type="ordinary" + no `filled` (default 0) means
    // fill_special_room() returns before touching it.
    lspo_region({ region: [19, 11, 33, 15], lit: 0, type: 'ordinary', irregular: true });
    quest_region_light(30, 10, 31, 10, false);
    quest_place_stair(30, 10, false);
    // Portal arrival point: force the square to floor, then register it.
    quest_terrain_at(63, 6, ROOM);
    quest_register_branch(63, 6);
    quest_set_door(31, 9, 'closed'); quest_set_door(16, 8, 'closed');
    quest_set_door(28, 7, 'closed'); quest_set_door(34, 10, 'locked');
    quest_set_door(35, 10, 'locked'); quest_set_door(15, 10, 'closed');
    quest_set_door(19, 10, 'locked'); quest_set_door(20, 10, 'locked');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // Neferet the Green + custom inventory (elven cloak+5, quarterstaff+5).
        const neferet = quest_create_monster('Neferet the Green', 23, 5, null);
        quest_drop_default_invent(neferet);
        quest_create_object(139 /*ELVEN_CLOAK*/, null, null, 5, neferet);
        quest_create_object(79 /*QUARTERSTAFF*/, null, null, 5, neferet);
        quest_create_object(CHEST, 24, 5, null, null);
        const apprentices = [[30, 7], [24, 6], [15, 6], [15, 12],
                             [26, 11], [27, 11], [19, 9], [20, 9]];
        for (const [ax, ay] of apprentices) quest_create_monster('apprentice', ax, ay, null);
        // Eels in the pond.
        quest_create_monster('giant eel', 62, 14, null);
        quest_create_monster('giant eel', 69, 15, null);
        quest_create_monster('giant eel', 67, 17, null);
        // des.non_diggable — no RNG.
        for (let i = 0; i < 6; i++) await quest_trap();
        // Monsters on siege duty: bats, wraiths and imps, all hostile.
        const siege = [
            [S_BAT, 60, 9], [S_WRAITH, 60, 10], [S_BAT, 60, 11], [S_BAT, 60, 12],
            [S_IMP, 60, 13], [S_BAT, 61, 10], [S_BAT, 61, 11], [S_BAT, 61, 12],
            [S_BAT, 35, 3], [S_IMP, 35, 17], [S_BAT, 36, 17], [S_BAT, 34, 16],
            [S_IMP, 34, 17], [S_WRAITH, 67, 2], [S_BAT, 10, 19],
        ];
        for (const [cls, cx, cy] of siege)
            quest_monster({ cls, mx: cx, my: cy, peaceful: 0 });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
