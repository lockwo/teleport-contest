// levels/water.js — makemaz_water(), the Plane of Water (C ref: dat/water.lua).
// The map is solid WATER; the air bubbles the hero actually stands in are made
// by mkmaze.c's bubble code at level-arrival time, not by the script.

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, vly_flip_dndest, vly_flip_updest, quest_level_init_solidfill, shuffle,
} from '../sp_lev.js';
import {
    S_EEL, plane_coder_init, plane_level_flags, plane_levregion_add, plane_message,
    plane_monster, plane_place_lregions, plane_teleport_region,
} from './planes.js';

const WATER_MAP = Array.from({ length: 20 }, () => 'W'.repeat(76)).join('\n');

// C ref: water.lua's monster list, in file order.  All coordinate-less.
const WATER_MONSTERS = [
    ...Array(8).fill(['giant eel', null]),
    ...Array(8).fill(['electric eel', null]),
    ...Array(9).fill(['kraken', null]),
    ...Array(4).fill(['shark', null]),
    ...Array(4).fill(['piranha', null]),
    ...Array(4).fill(['jellyfish', null]),
];

export async function makemaz_water() {
    plane_coder_init();
    shuffle(['law', 'neutral', 'chaos']);
    quest_level_init_solidfill();
    plane_level_flags('mazelevel', 'noteleport', 'hardfloor', 'shortsighted');
    plane_message('You find yourself suspended in an air bubble surrounded by water.');
    bigrm_load_map(WATER_MAP, false);
    plane_teleport_region([0, 0, 25, 19]);
    plane_levregion_add('portal', [51, 0, 75, 19], null);
    game._full_mon_gen = true;
    try {
        for (const [name, peaceful] of WATER_MONSTERS) plane_monster({ name, peaceful });
        for (let i = 0; i < 4; i++) plane_monster({ cls: S_EEL });   // des.monster(";")
        for (let i = 0; i < 19; i++) plane_monster({ name: 'water elemental', peaceful: 0 });
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
