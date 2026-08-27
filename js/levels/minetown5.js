// levels/minetown5.js - special level builder makemaz_minetown5(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_minetown5 so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import { COLNO, FILL_NORMAL, FOUNTAIN, HWALL, ROOM, ROWNO, SHOPBASE, VWALL } from '../const.js';
import { game } from '../gstate.js';
import { CHEST, RING_CLASS, STATUE, TOOL_CLASS } from '../mkobj.js';
import { rn2 } from '../rng.js';
import { roles } from '../roles.js';
import {
    S_GNOME, TEMPLE_RTYPE, bigrm_load_map, bigrm_wallification, flip_level, percent,
    quest_level_init_solidfill, quest_place_stair, remove_boundary_syms, shuffle,
    splev_create_monster, splev_door_at, splev_feature, splev_link_doors_rooms, splev_object_at,
    splev_region_lit, splev_terrain_area, vly_altar, vly_region, vly_terrain_at,
    vly_terrain_line,
} from '../sp_lev.js';

// ============================================================
// Mine Town (C ref: makemaz("minetn") -> dat/minetn-<N>.lua)
//
// mkmaze.c:1136 — an s_level carrying rndlevs picks its script with
// rnd(sp->rndlevs); "minetn" has rndlevs 7.  Only the "-5" variant
// ("Grotto Town" by Kelly Bailey) is ported so far.
// ============================================================

const MINETN5_MAP = [
    '-----         ---------                                                    ',
    '|...---  ------.......--    -------                       ---------------  ',
    '|.....----.........--..|    |.....|          -------      |.............|  ',
    '--..-....-.----------..|    |.....|          |.....|     --+---+--.----+-  ',
    ' --.--.....----     ----    |.....|  ------  --....----  |..-...--.-.+..|  ',
    '  ---.........----  -----   ---+---  |..+.|   ---..-..----..---+-..---..|  ',
    '    ----.-....|..----...--    |.|    |..|.|    ---+-.....-+--........--+-  ',
    '       -----..|....-.....---- |.|    |..|.------......--................|  ',
    '    ------ |..|.............---.--   ----.+..|-.......--..--------+--..--  ',
    '    |....| --......---...........-----  |.|..|-...{....---|.........|..--  ',
    '    |....|  |........-...-...........----.|..|--.......|  |.........|...|  ',
    '    ---+--------....-------...---......--.-------....---- -----------...|  ',
    ' ------.---...--...--..-..--...-..---...|.--..-...-....------- |.......--  ',
    ' |..|-.........-..---..-..---.....--....|........---...-|....| |.-------   ',
    ' |..+...............-+---+-----..--..........--....--...+....| |.|...S.    ',
    '-----.....{....----...............-...........--...-...-|....| |.|...|     ',
    '|..............-- --+--.---------.........--..-........------- |.--+-------',
    '-+-----.........| |...|.|....|  --.......------...|....---------.....|....|',
    '|...| --..------- |...|.+....|   ---...---    --..|...--......-...{..+..-+|',
    '|...|  ----       ------|....|     -----       -----.....----........|..|.|',
    '-----                   ------                     -------  ---------------',
].join('\n');

// C ref: mkroom.h shop room types.  room_types[] (sp_lev.c:3960) names them in
// this order, and stock_room() indexes shtypes[] with rtype - SHOPBASE.
const SHOP_RTYPE_BY_NAME = {
    'shop': SHOPBASE, 'armor shop': SHOPBASE + 1, 'scroll shop': SHOPBASE + 2,
    'potion shop': SHOPBASE + 3, 'weapon shop': SHOPBASE + 4,
    'food shop': SHOPBASE + 5, 'ring shop': SHOPBASE + 6,
    'wand shop': SHOPBASE + 7, 'tool shop': SHOPBASE + 8,
    'book shop': SHOPBASE + 9, 'health food shop': SHOPBASE + 10,
    'candle shop': SHOPBASE + 11,
};

// C ref: dat/nhlib.lua monkfoodshop() — a Monk hero gets the health food store.
function minetn_monkfoodshop() {
    const rl = roles[game.initrole];
    return (rl && rl.name && rl.name.m === 'Monk') ? 'health food shop'
                                                   : 'food shop';
}

// C ref: nhlib.lua's shuffled `align` table, indexed 1-based from Lua, mapped
// through sp_lev.c's aligns[] to an align.h AM_* mask.
const MINETN_ALIGN_AMASK = {
    law: 0x04 /* AM_LAWFUL */, neutral: 0x02 /* AM_NEUTRAL */,
    chaos: 0x01 /* AM_CHAOTIC */,
};

// Entry point.  C ref: makemaz("minetn") -> load_special("minetn-5.lua").
export async function makemaz_minetown5() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    const align = shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    const lit = quest_level_init_solidfill();
    // des.level_flags("mazelevel") — no RNG.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // The trailing fill_special_room() pass (which stocks the four shops) must
    // use the same faithful makemon path this generator does.
    if (g.level) g.level._splev_fullmon = true;
    // des.map([[...]]) — 75x21, SPLEV_CENTER offset.  No RNG.
    bigrm_load_map(MINETN5_MAP, false);   // des.map bare string -> lit=FALSE

    // Five percent() gates; a nested one is only reached when the outer one
    // passes (Lua short-circuits, so its rn2(100) is then not drawn).
    if (percent(75)) {
        if (percent(50)) vly_terrain_line(25, 8, 25, 9, VWALL);
        else vly_terrain_line(16, 13, 17, 13, HWALL);
    }
    if (percent(75)) {
        if (percent(50)) vly_terrain_line(36, 10, 36, 11, VWALL);
        else vly_terrain_line(32, 15, 33, 15, HWALL);
    }
    if (percent(50)) {
        splev_terrain_area(21, 4, 22, 5, ROOM);
        vly_terrain_line(14, 9, 14, 10, VWALL);
    }
    if (percent(50)) {
        vly_terrain_at(46, 13, VWALL);
        vly_terrain_line(43, 5, 47, 5, HWALL);
        vly_terrain_line(42, 6, 46, 6, ROOM);
        vly_terrain_line(46, 7, 47, 7, ROOM);
    }
    if (percent(50)) splev_terrain_area(69, 11, 71, 11, HWALL);

    // Stairs / fountains / lighting — no RNG.
    quest_place_stair(1, 1, true);
    quest_place_stair(46, 3, false);
    splev_feature(50, 9, FOUNTAIN);
    splev_feature(10, 15, FOUNTAIN);
    splev_feature(66, 18, FOUNTAIN);

    splev_region_lit(0, 0, 74, 20, 0);
    splev_region_lit(9, 13, 11, 17, 1);
    splev_region_lit(8, 14, 12, 16, 1);
    splev_region_lit(49, 7, 51, 11, 1);
    splev_region_lit(48, 8, 52, 10, 1);
    splev_region_lit(64, 17, 68, 19, 1);
    splev_region_lit(37, 13, 39, 17, 1);
    splev_region_lit(36, 14, 40, 17, 1);
    splev_region_lit(59, 2, 72, 10, 1);

    g._full_mon_gen = true;
    try {
        // The watch, then the townsfolk.
        for (let i = 0; i < 4; i++)
            splev_create_monster({ name: 'watchman', peaceful: 1 });
        splev_create_monster({ name: 'watch captain', peaceful: 1 });
        for (let i = 0; i < 6; i++) splev_create_monster({ name: 'gnome' });
        for (let i = 0; i < 2; i++) splev_create_monster({ name: 'gnome lord' });
        for (let i = 0; i < 3; i++) splev_create_monster({ name: 'dwarf' });

        // The shops.  filled=1 is FILL_NORMAL: the stocking itself happens in
        // lspo_finalize_level's trailing fill_special_room() loop, long after
        // the doors below have joined the rooms via link_doors_rooms().
        vly_region(25, 17, 28, 19, 1, SHOP_RTYPE_BY_NAME['candle shop'],
                   FILL_NORMAL, false);
        splev_door_at('closed', 24, 18);
        vly_region(59, 9, 67, 10, 1, SHOP_RTYPE_BY_NAME['shop'],
                   FILL_NORMAL, false);
        splev_door_at('closed', 66, 8);
        vly_region(57, 13, 60, 15, 1, SHOP_RTYPE_BY_NAME['tool shop'],
                   FILL_NORMAL, false);
        splev_door_at('closed', 56, 14);
        vly_region(5, 9, 8, 10, 1, SHOP_RTYPE_BY_NAME[minetn_monkfoodshop()],
                   FILL_NORMAL, false);
        splev_door_at('closed', 7, 11);

        // Gnome homes.
        splev_door_at('closed', 4, 14);
        splev_door_at('locked', 1, 17);
        splev_create_monster({ name: 'gnomish wizard', mx: 2, my: 19 });
        splev_door_at('locked', 20, 16);
        splev_create_monster({ cls: S_GNOME, mx: 20, my: 18 });
        splev_door_at('random', 21, 14);
        splev_door_at('random', 25, 14);
        splev_door_at('random', 42, 8);
        splev_door_at('locked', 40, 5);
        splev_create_monster({ cls: S_GNOME, mx: 38, my: 7 });
        splev_door_at('random', 59, 3);
        splev_door_at('random', 58, 6);
        splev_door_at('random', 63, 3);
        splev_door_at('random', 63, 5);
        splev_door_at('locked', 71, 3);
        splev_door_at('locked', 71, 6);
        splev_door_at('closed', 69, 4);
        splev_door_at('closed', 67, 16);
        splev_create_monster({ name: 'gnomish wizard', mx: 67, my: 14 });
        splev_object_at({ oclass: RING_CLASS }, 70, 14);
        splev_door_at('locked', 69, 18);
        splev_create_monster({ name: 'gnome lord', mx: 71, my: 19 });
        splev_door_at('locked', 73, 18);
        splev_object_at({ otyp: CHEST }, 73, 19);
        splev_door_at('locked', 50, 6);
        splev_object_at({ oclass: TOOL_CLASS }, 50, 3);
        splev_object_at({ otyp: STATUE, montype: 'gnome king', historic: 1 },
                        38, 15);

        // The temple.
        vly_region(29, 2, 33, 4, 1, TEMPLE_RTYPE, FILL_NORMAL, false);
        splev_door_at('closed', 31, 5);
        vly_altar(31, 3, MINETN_ALIGN_AMASK[align[0]], 1);
    } finally {
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level() — link_doors_rooms, remove_boundary_syms,
    // map_cleanup (no RNG), wallification (no RNG, !corrmaze), then
    // flip_level_rnd(allow_flips=3): one rn2(2) per axis.
    splev_link_doors_rooms();
    remove_boundary_syms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
