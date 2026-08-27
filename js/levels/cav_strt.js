// levels/cav_strt.js - special level builder makemaz_cav_strt() (dat/Cav-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { AM_LAWFUL, AM_CHAOTIC, AM_NEUTRAL } from '../const.js';
import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import {
    bigrm_load_map, gx, gy, lspo_region, quest_create_monster,
    quest_create_object, quest_drop_default_invent, quest_place_stair,
    quest_region_light, quest_register_branch, quest_set_door, vly_altar,
    reset_xystart_size,
} from '../sp_lev.js';
import {
    PIT, quest_align_shuffle, quest_finalize, quest_level_init_fill,
    quest_monster, quest_trap, quest_wallify_map,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Caveman quest "home" level loader (dat/Cav-strt.lua) — Shaman Karnov's
// cave system, with a real (co-aligned) shrine.
//
// C ref: mklev.c makelevel() -> makemaz("Cav-strt") -> load_special.
// Two things distinguish it from the other quest homes:
//   * every region is irregular, so lspo_region flood-fills a room from the
//     region's top-left corner instead of just relighting a rectangle;
//   * the altar is align="coaligned", type="shrine".  sp_amask_to_amask()
//     takes the AM_SPLEV_CO arm — Align2amask(u.ualignbase[A_ORIGINAL]), NOT
//     induced_align, so no rn2(3) — and shrine == 1 with the square inside a
//     TEMPLE room reaches priestini(), which makes an aligned priest (that IS
//     what the .lua's "this will force a priest(ess) to be created" means).
//   * des.wallify() closes the file: mkmap.c's wallify_map() over the des.map
//     footprint, before lspo_finalize_level's own wallification().
// ════════════════════════════════════════════════════════════════════════

const CAV_STRT_MAP = [
    '                                                                            ',
    '  ......     ..........................       ...        ....  ......       ',
    ' ......       ..........................     ........       ....    .....   ',
    '  ..BB      .............................    .........            ....  ..  ',
    '     ..    ......................              .......      ..     ....  .. ',
    '     ..     ....................                     ..  .......    ..  ... ',
    '   ..              S   BB                .....     .......   ....      .... ',
    '    ..        ...  .   ..               ........  ..     ..   ..       ...  ',
    '     ..      ......     ..             ............       ..          ...   ',
    '       .      ....       ..             ........           ..  ...........  ',
    '  ...   ..     ..        .............                  ................... ',
    ' .....   .....            ...............................      ...........  ',
    '  .....B................            ...                               ...   ',
    '  .....     .  ..........        .... .      ...  ..........           ...  ',
    '   ...     ..          .............  ..    ...................        .... ',
    '          BB       ..   .........      BB    ...  ..........  ..   ...  ... ',
    '       ......    .....  B          ........         ..         .. ....  ... ',
    '     ..........  ..........         ..... ...      .....        ........    ',
    '       ..  ...    .  .....         ....    ..       ...            ..       ',
    '                                                                            ',
].join('\n');

// C ref: align.h Align2amask(u.ualignbase[A_ORIGINAL]) for des.altar's
// align="coaligned" (sp_amask_to_amask()'s AM_SPLEV_CO arm).  No RNG.
function cav_coaligned_amask() {
    const a = game.u?.ualignbase?.[0] ?? game.u?.ualign?.type ?? 0;
    if (a > 0) return AM_LAWFUL;
    if (a < 0) return AM_CHAOTIC;
    return AM_NEUTRAL;
}

// Main executor.  C ref: makemaz("Cav-strt") -> load_special.
export async function makemaz_cav_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    quest_level_init_fill(0 /* STONE */);
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    bigrm_load_map(CAV_STRT_MAP, false);   // des.map bare string -> lit=FALSE
    quest_region_light(0, 0, 75, 19, false);
    lspo_region({ region: [13, 1, 40, 5], lit: 1, type: 'temple', filled: 1, irregular: true });
    // The occupied rooms.
    for (const r of [[2, 1, 8, 3], [1, 11, 6, 14], [13, 8, 18, 10],
                     [5, 17, 14, 18], [17, 16, 23, 18], [35, 16, 44, 18]])
        lspo_region({ region: r, lit: 1, type: 'ordinary', irregular: true });
    quest_place_stair(2, 3, false);
    quest_register_branch(71, 9);
    quest_set_door(19, 6, 'locked');
    // The temple altar — a shrine, so priestini() runs and makes the priest.
    vly_altar(36, 2, cav_coaligned_amask(), 1);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        const karnov = quest_create_monster('Shaman Karnov', 35, 2, null);
        quest_drop_default_invent(karnov);
        quest_create_object(134 /*LEATHER_ARMOR*/, null, null, 5, karnov);
        quest_create_object(77 /*CLUB*/, null, null, 5, karnov);
        quest_create_object(CHEST, 34, 2, null, null);
        const neanderthals = [[20, 3], [20, 2], [20, 1], [21, 3],
                              [21, 2], [21, 1], [22, 1], [26, 9]];
        for (const [nx, ny] of neanderthals)
            quest_create_monster('neanderthal', nx, ny, null);
        // des.non_diggable — no RNG.
        await quest_trap(PIT, 47, 11);
        await quest_trap(PIT, 57, 10);
        for (let i = 0; i < 4; i++) await quest_trap();
        const bugbears = [[47, 2], [48, 3], [49, 4], [67, 3], [69, 4], [51, 13],
                          [53, 14], [55, 15], [63, 10], [65, 9], [67, 10], [69, 11]];
        for (const [bx, by] of bugbears)
            quest_monster({ name: 'bugbear', mx: bx, my: by, peaceful: 0 });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // des.wallify() with no arguments — mkmap.c wallify_map() over
    // (xstart-1, ystart-1) .. (xstart+xsize+1, ystart+ysize+1).  No RNG.
    quest_wallify_map(gx.xstart - 1, gy.ystart - 1,
                      gx.xstart + gx.xsize + 1, gy.ystart + gy.ysize + 1);

    quest_finalize();
}
