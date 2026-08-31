// levels/kni_goal.js -- Knight quest goal level (dat/Kni-goal.lua).
//
// Ixoth's lair is a map-only special level: its des.* program has no
// levregions, so mklev's normal special-level finalize path needs no extra
// branch-placement work after this builder returns.

import { COLNO, ROWNO, SPIKED_PIT } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, quest_create_monster,
    quest_level_init_solidfill, quest_place_stair, quest_region_light,
    shuffle, splev_object_at, vly_non_diggable,
} from '../sp_lev.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_named_object_at,
    quest_object_rnd, quest_trap_random, quest_trap_typed_at,
} from './quest_common.js';

const MIRROR = 230;
const S_IMP = 9;
const S_JELLY = 10;

// dat/Kni-goal.lua's 76x20 centered des.map.  padEnd keeps the source map's
// right-side stone area significant to lspo_map's centering calculation.
const KNI_GOAL_MAP = [
    '....PPPP..PPP..',
    '.PPPPP...PP..     ..........     .................................',
    '..PPPPP...P..    ...........    ...................................',
    '..PPP.......   ...........    ......................................',
    '...PPP.......    .........     ...............   .....................',
    '...........    ............    ............     ......................',
    '............   .............      .......     .....................',
    '..............................            .........................',
    '...............................   ..................................',
    '.............................    ....................................',
    '.........    ......................................................',
    '.....PP...    .....................................................',
    '.....PPP....    ....................................................',
    '......PPP....   ..............   ....................................',
    '.......PPP....  .............    .....................................',
    '........PP...    ............    ......................................',
    '...PPP........     ..........     ..................................',
    '..PPPPP........     ..........     ..............................',
    '....PPPPP......       .........     ..........................',
    '.......PPPP...',
].map((line) => line.padEnd(76, ' ')).join('\n');

export async function makemaz_kni_goal() {
    const g = game;
    // load_special() loads nhlib.lua before the level file.
    shuffle(['law', 'neutral', 'chaos']);
    quest_level_init_solidfill();
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    bigrm_load_map(KNI_GOAL_MAP, false);

    // The lair entrance is lit; the rest of the cavern remains dark.
    quest_region_light(0, 0, 14, 19, true);
    quest_region_light(15, 0, 75, 19, false);
    quest_place_stair(3, 8, true);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        vly_non_diggable(0, 0, 75, 19);
        quest_named_object_at(MIRROR, 50, 6, {
            spe: 0,
            buc: 'blessed',
            name: 'The Magic Mirror of Merlin',
        });
        for (let x = 33; x <= 35; x++)
            for (let y = 1; y <= 5; y++)
                splev_object_at({}, x, y);
        for (let i = 0; i < 6; i++) quest_object_rnd();

        await quest_trap_typed_at(SPIKED_PIT, 13, 7);
        await quest_trap_typed_at(SPIKED_PIT, 12, 8);
        await quest_trap_typed_at(SPIKED_PIT, 12, 9);
        for (let i = 0; i < 5; i++) await quest_trap_random();

        quest_create_monster('Ixoth', 50, 6, false);
        for (let i = 0; i < 16; i++) quest_monster_named_rnd('quasit', false);
        for (let i = 0; i < 2; i++) quest_monster_class_rnd(S_IMP, false);
        for (let i = 0; i < 8; i++) quest_monster_named_rnd('ochre jelly', false);
        quest_monster_class_rnd(S_JELLY, false);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: wallification then independent vertical/horizontal
    // flip rolls.  This map has no explicit noflip flag.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;
    if (rn2(2)) flp |= 2;
    if (flp) flip_level(flp);
}
