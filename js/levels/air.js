// levels/air.js — makemaz_air(), the Plane of Air (C ref: dat/air.lua).
// The whole map is AIR; every monster is placed at a random location, so this
// level is almost pure create_monster RNG.

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, vly_flip_dndest, vly_flip_updest, quest_level_init_solidfill, shuffle,
} from '../sp_lev.js';
import {
    S_DRAGON, S_ELEMENTAL, S_JABBERWOCK, plane_coder_init, plane_level_flags,
    plane_levregion_add, plane_message, plane_monster, plane_place_lregions,
    plane_region_lit, plane_teleport_region,
} from './planes.js';

const AIR_MAP = Array.from({ length: 20 }, () => 'A'.repeat(76)).join('\n');

// C ref: air.lua's monster list, in file order.  Every entry is coordinate-less
// (a random get_location); the {id=...} ones all carry peaceful=0, the bare
// names ("couatl") leave peacefulness to makemon, and the single-letter ones
// ("D"/"E"/"J") are monster CLASSES resolved by mkclass(class, G_NOGEN).
const AIR_MONSTERS = [
    ...Array(11).fill(['air elemental', 0]),
    ...Array(3).fill(['floating eye', 0]),
    ...Array(3).fill(['yellow light', 0]),
    ['couatl', null],
];
const AIR_CLASSES = [S_DRAGON, S_DRAGON, S_DRAGON, S_DRAGON, S_DRAGON,
                     S_ELEMENTAL, S_ELEMENTAL, S_ELEMENTAL,
                     S_JABBERWOCK, S_JABBERWOCK];
const AIR_MONSTERS2 = [
    ...Array(3).fill(['djinni', 0]),
    ...Array(9).fill(['fog cloud', 0]),
    ...Array(5).fill(['energy vortex', 0]),
    ...Array(5).fill(['steam vortex', 0]),
];

export async function makemaz_air() {
    plane_coder_init();
    shuffle(['law', 'neutral', 'chaos']);
    quest_level_init_solidfill();
    plane_level_flags('mazelevel', 'noteleport', 'hardfloor', 'shortsighted', 'stormy');
    plane_message('What a strange feeling!');
    plane_message('You notice that there is no gravity here.');
    bigrm_load_map(AIR_MAP, false);
    // Both teleport_regions carry region_islev=1 / exclude_islev=1, so their
    // coordinates are whole-level absolute.  They partition the level so a
    // teleport can't cross from one third to another: the "up" one is where the
    // hero lands coming in, the "down" one is where the exit portal goes.
    game.updest = { lx: 1, ly: 0, hx: 24, hy: 20,
                    nlx: 25, nly: 0, nhx: 79, nhy: 20 };
    plane_teleport_region([56, 0, 79, 20], [1, 0, 55, 20], true, 'down');
    plane_levregion_add('portal', [57, 1, 78, 19], null, true);
    plane_region_lit(0, 0, 75, 19);
    game._full_mon_gen = true;
    try {
        for (const [name, peaceful] of AIR_MONSTERS) plane_monster({ name, peaceful });
        for (const cls of AIR_CLASSES) plane_monster({ cls });
        for (const [name, peaceful] of AIR_MONSTERS2) plane_monster({ name, peaceful });
    } finally {
        game._full_mon_gen = false;
    }
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;
    if (rn2(2)) flp |= 2;
    // C ref: sp_lev.c flip_level() mirrors gl.lregions[] too, and
    // fixup_special() only then copies the teleport region into svd.dndest.
    if (flp) { flip_level(flp); vly_flip_dndest(flp); vly_flip_updest(flp); }
    await plane_place_lregions();
}
