// levels/earth.js — makemaz_earth(), the Plane of Earth (C ref: dat/earth.lua).
// Reached only from the Plane of Air's portal at the very end of a game, so no
// recorded session exercises it; ported from the script, not from a trace.

import { COLNO, ROOM, ROWNO, STONE } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import { BOULDER } from '../mkobj.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, vly_flip_dndest, vly_flip_updest, quest_level_init_solidfill,
    set_levltyp_lit, shuffle, vly_object,
} from '../sp_lev.js';
import {
    plane_abs, plane_coder_init, plane_level_flags, plane_levregion_add, plane_message,
    plane_monster, plane_place_lregions, plane_teleport_region,
} from './planes.js';

// The map has no outer boundary: the caverns float in diggable rock, and
// replace_terrain scatters a further 5% of that rock as unlit floor.
const EARTH_MAP = [
    '                                                                            ',
    '  ...                                                                       ',
    ' ....                ..                                                     ',
    ' .....             ...                                      ..              ',
    '  ....              ....                                     ...            ',
    '   ....              ...                ....                 ...      .     ',
    '    ..                ..              .......                 .      ..     ',
    '                                      ..  ...                        .      ',
    '              .                      ..    .                         ...    ',
    '             ..  ..                  .     ..                         .     ',
    '            ..   ...                        .                               ',
    '            ...   ...                                                       ',
    '              .. ...                                 ..                     ',
    '               ....                                 ..                      ',
    '                          ..                                       ...      ',
    '                         ..                                       .....     ',
    '  ...                                                              ...      ',
    ' ....                                                                       ',
    '   ..                                                                       ',
    '                                                                            ',
].join('\n');

// C ref: earth.lua's monster list, in file order.  A bare name is
// des.monster(name, x, y) (peaceful left random); the {id=...} entries all
// carry peaceful=0.
const EARTH_MONSTERS = [
    ['Elvenking', 67, 16, null], ['minotaur', 67, 14, null],
    ['earth elemental', 52, 13, 0], ['earth elemental', 53, 13, 0],
    ['rock troll', 53, 12, null], ['stone giant', 54, 12, null],
    ['pit viper', 70, 5, null], ['barbed devil', 69, 6, null],
    ['stone giant', 69, 8, null], ['stone golem', 71, 8, null],
    ['pit fiend', 70, 9, null], ['earth elemental', 70, 8, 0],
    ['earth elemental', 60, 3, 0], ['stone giant', 61, 4, null],
    ['earth elemental', 62, 4, 0], ['earth elemental', 61, 5, 0],
    ['scorpion', 62, 5, null], ['rock piercer', 63, 5, null],
    ['umber hulk', 40, 5, null], ['dust vortex', 42, 5, null],
    ['rock troll', 38, 6, null], ['earth elemental', 39, 6, 0],
    ['earth elemental', 41, 6, 0], ['earth elemental', 38, 7, 0],
    ['stone giant', 39, 7, null], ['earth elemental', 43, 7, 0],
    ['stone golem', 37, 8, null], ['pit viper', 43, 8, null],
    ['pit viper', 43, 9, null], ['rock troll', 44, 10, null],
    ['earth elemental', 2, 1, 0], ['earth elemental', 3, 1, 0],
    ['stone golem', 1, 2, null], ['earth elemental', 2, 2, 0],
    ['rock troll', 4, 3, null], ['rock troll', 3, 3, null],
    ['pit fiend', 3, 4, null], ['earth elemental', 4, 5, 0],
    ['pit viper', 5, 6, null],
    ['earth elemental', 21, 2, 0], ['earth elemental', 21, 3, 0],
    ['minotaur', 21, 4, null], ['earth elemental', 21, 5, 0],
    ['rock troll', 22, 5, null], ['earth elemental', 22, 6, 0],
    ['earth elemental', 23, 6, 0],
    ['pit viper', 14, 8, null], ['barbed devil', 14, 9, null],
    ['earth elemental', 13, 10, 0], ['rock troll', 12, 11, null],
    ['earth elemental', 14, 12, 0], ['earth elemental', 15, 13, 0],
    ['stone giant', 17, 13, null], ['stone golem', 18, 13, null],
    ['pit fiend', 18, 12, null], ['earth elemental', 18, 11, 0],
    ['earth elemental', 18, 10, 0],
    ['barbed devil', 2, 16, null], ['earth elemental', 3, 16, 0],
    ['rock troll', 2, 17, null], ['earth elemental', 4, 17, 0],
    ['earth elemental', 4, 18, 0],
];

// C ref: sp_lev.c lspo_replace_terrain() region form with lit = 0 — one rn2(100)
// per matching cell of the region, replaced when it comes up < chance.
function earth_scatter_rock() {
    const a = plane_abs(0, 0), b = plane_abs(75, 19);
    const lox = Math.max(1, Math.min(a.x, COLNO - 1)), hix = Math.min(b.x, COLNO - 1);
    const loy = Math.max(0, a.y), hiy = Math.min(b.y, ROWNO - 1);
    for (let x = lox; x <= hix; x++)
        for (let y = loy; y <= hiy; y++) {
            const loc = game.level?.at(x, y);
            if (!loc || loc.typ !== STONE) continue;
            if (rn2(100) < 5) set_levltyp_lit(x, y, ROOM, 0);
        }
}

export async function makemaz_earth() {
    plane_coder_init();
    shuffle(['law', 'neutral', 'chaos']);        // nhlib.lua top level
    quest_level_init_solidfill();                // rn2(2) + fill STONE
    plane_level_flags('mazelevel', 'noteleport', 'hardfloor', 'shortsighted');
    plane_message('Well done, mortal!');
    plane_message('But now thou must face the final Test...');
    plane_message('Prove thyself worthy or perish!');
    bigrm_load_map(EARTH_MAP, false);
    earth_scatter_rock();
    plane_teleport_region([69, 16, 69, 16]);
    plane_levregion_add('portal', [0, 0, 75, 19], [65, 13, 75, 19]);
    game._full_mon_gen = true;
    try {
        for (const [name, x, y, peaceful] of EARTH_MONSTERS)
            plane_monster({ name, x, y, peaceful });
        vly_object({ otyp: BOULDER });           // des.object("boulder")
    } finally {
        game._full_mon_gen = false;
    }
    // lspo_finalize_level(): wallification then flip_level_rnd(allow_flips) —
    // earth.lua declares no noflip, so allow_flips stays 3 and both axes draw.
    // fixup_special() (place_lregions, the portal) runs after that, back in
    // makemaz().
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;
    if (rn2(2)) flp |= 2;
    // C ref: sp_lev.c flip_level() mirrors gl.lregions[] too, and
    // fixup_special() only then copies the teleport region into svd.dndest.
    if (flp) { flip_level(flp); vly_flip_dndest(flp); vly_flip_updest(flp); }
    await plane_place_lregions();
}
