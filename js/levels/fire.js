// levels/fire.js — makemaz_fire(), the Plane of Fire (C ref: dat/fire.lua).
// Lava lakes with 40 fire traps and a long fixed monster roster, all at random
// locations.

import { COLNO, FIRE_TRAP, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { BOULDER } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, vly_flip_dndest, vly_flip_updest, quest_level_init_solidfill, shuffle,
    vly_object, vly_trap,
} from '../sp_lev.js';
import {
    plane_coder_init, plane_level_flags, plane_levregion_add, plane_monster,
    plane_place_lregions, plane_teleport_region,
} from './planes.js';

const FIRE_MAP = [
    'LL.............LL..............L...LL.........LL.................LL...........L',
    'LL....LLLLLLLL............L...L.............LL....LLL.......................LL.',
    'L....LL...................L......................LLLL................LL........',
    '.....L.............LLLL...LL....LL...............LLLLL.............LLL.........',
    '.L.LLLL..............LL....L.....LLL..............LLLL..............LLLL......L',
    'LL..........LLLL...LLLL...LLL....LLL......L........LLLL....LL........LLL......L',
    'LL........LLLLLLL...LL.....L......L......LL.........LL......LL........LL...L...',
    'L.........LL..LLL..LL......LL......LLLL..L.........LL......LLL............LL...',
    '......L..LL....LLLLL.................LLLLLLL.......L......LL............LLLLLL.',
    '......L..L.....LL.LLLL.......L............L........LLLLL.LL......LL.........LL.',
    '......LL........L...LL......LL.............LLL.....L...LLL.......LLL.........L.',
    '.L.....LLLLLL........L.......LLL.............L....LL...L.LLL......LLLLLLL......',
    'LL..........LLLL............LL.L.............L....L...LL.........LLL..LLL......',
    '.L...........................LLLLL...........LL...L...L........LLLL..LLLLLL...L',
    '.L.....LLLL.............LL....LL.......LLL...LL.......L..LLL....LLLLLLL.......L',
    '.........LLL.........LLLLLLLLLLL......LLLLL...L...........LL...LL...LL.........',
    '...........LL.......LL.........LL.......LLL....L..LLL....LL.........LL.........',
    '............LLLLLLLLL...........LL....LLL.......LLLLL.....LL........LL.........',
    '.LL...............L.............LLLLLL............LL...LLLL.........LL.......L.',
    'LL.....L..........................LL....................LL..................LLL',
    'L.....LLL......................LLLLL.........L.........LLLLLLLL..............LL',
].join('\n');

// C ref: fire.lua's monster list, in file order.  A bare name leaves
// peacefulness to makemon; the {id=...} entries all carry peaceful = 0.
const FIRE_MONSTERS = [
    ['red dragon', null], ['balrog', null],
    ['fire elemental', 0], ['fire elemental', 0],
    ['fire vortex', null], ['hell hound', null],
    ['fire giant', null], ['barbed devil', null], ['hell hound', null],
    ['stone golem', null], ['pit fiend', null], ['fire elemental', 0],
    ['fire elemental', 0], ['hell hound', null], ['fire elemental', 0],
    ['fire elemental', 0], ['scorpion', null], ['fire giant', null],
    ['hell hound', null], ['dust vortex', null], ['fire vortex', null],
    ['fire elemental', 0], ['fire elemental', 0], ['fire elemental', 0],
    ['hell hound', null], ['fire elemental', 0], ['stone golem', null],
    ['pit viper', null], ['pit viper', null], ['fire vortex', null],
    ['fire elemental', 0], ['fire elemental', 0], ['fire giant', null],
    ['fire elemental', 0], ['fire vortex', null], ['fire vortex', null],
    ['pit fiend', null], ['fire elemental', 0], ['pit viper', null],
    ['salamander', 0], ['salamander', 0], ['minotaur', null],
    ['salamander', 0], ['steam vortex', null], ['salamander', 0],
    ['salamander', 0],
    ['fire giant', null], ['barbed devil', null], ['fire elemental', 0],
    ['fire vortex', null], ['fire elemental', 0], ['fire elemental', 0],
    ['hell hound', null], ['fire giant', null], ['pit fiend', null],
    ['fire elemental', 0], ['fire elemental', 0],
    ['barbed devil', null], ['salamander', 0], ['steam vortex', null],
    ['salamander', 0], ['salamander', 0],
];

export async function makemaz_fire() {
    plane_coder_init();
    shuffle(['law', 'neutral', 'chaos']);
    quest_level_init_solidfill();
    plane_level_flags('mazelevel', 'noteleport', 'hardfloor', 'shortsighted',
                      'hot', 'fumaroles');
    bigrm_load_map(FIRE_MAP, false);
    plane_teleport_region([71, 16, 71, 16]);
    plane_levregion_add('portal', [0, 0, 78, 19], [67, 13, 78, 19]);
    game._full_mon_gen = true;
    try {
        for (let i = 0; i < 40; i++) await vly_trap(FIRE_TRAP);
        for (const [name, peaceful] of FIRE_MONSTERS) plane_monster({ name, peaceful });
        for (let i = 0; i < 5; i++) vly_object({ otyp: BOULDER });
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
