// levels/soko_upper.js - special level builder makemaz_soko_upper(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_soko_upper so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import { COLNO, ROWNO } from '../const.js';
import { premap_detect } from '../detect.js';
import { Is_special } from '../dungeon.js';
import { game } from '../gstate.js';
import { BOULDER, FOOD_CLASS, RING_CLASS, SCR_EARTH, WAND_CLASS, mksobj_at } from '../mkobj.js';
import { rn2, rnd } from '../rng.js';
import {
    bigrm_level_init_solidfill, bigrm_load_map, bigrm_wallification, flip_level, q_absx, q_absy,
    quest_flip_branch, quest_place_stair, quest_register_branch, quest_set_door, shuffle,
    soko_create_object_class_random, soko_mktrap, soko_region_lit_grow,
    soko_solidify_and_nondig,
} from '../sp_lev.js';
import { soko_exclusion_mongen, soko_flip_exclusions } from './soko1.js';

// ════════════════════════════════════════════════════════════════════════
// Sokoban levels 2-4 (dat/soko{2,3,4}-{1,2}.lua).
//
// Same des.* program as soko1 minus the reward room: level_init, map, one down
// and one up stair, the locked door(s), the lit/non-diggable/non-passwall
// region, the boulders, the exclusion, the hole row and six random objects.
// Only the boulders (mksobj's next_ident rnd(2)), the traps (maketrap +
// mktrap's victim gate) and the six des.object({class=...}) draws consume RNG.
// ════════════════════════════════════════════════════════════════════════

const SOKO_UPPER_MAPS = {
    '2-1':
        '--------------------\n' +
        '|........|...|.....|\n' +
        '|.....-..|.-.|.....|\n' +
        '|..|.....|...|.....|\n' +
        '|-.|..-..|.-.|.....|\n' +
        '|...--.......|.....|\n' +
        '|...|...-...-|.....|\n' +
        '|...|..|...--|.....|\n' +
        '|-..|..|----------+|\n' +
        '|..................|\n' +
        '|...|..|------------\n' +
        '--------            ',
    '2-2':
        '  --------            \n' +
        '--|.|....|            \n' +
        '|........|----------  \n' +
        '|.-...-..|.|.......|  \n' +
        '|...-......|.......|  \n' +
        '|.-....|...|.......|  \n' +
        '|....-.--.-|.......|  \n' +
        '|..........|.......|  \n' +
        '|.--...|...|.......---\n' +
        '|....-.|---|.......+.|\n' +
        '--|....|------------.|\n' +
        '  |................+.|\n' +
        '  --------------------',
    '3-1':
        '-----------       -----------\n' +
        '|....|....|--     |.........|\n' +
        '|....|......|     |.........|\n' +
        '|.........|--     |.........|\n' +
        '|....|....|       |.........|\n' +
        '|-.---------      |.........|\n' +
        '|....|.....|      |.........|\n' +
        '|....|.....|      |.........|\n' +
        '|..........|      |.........|\n' +
        '|....|.....|---------------+|\n' +
        '|....|......................|\n' +
        '-----------------------------',
    '3-2':
        ' ----          -----------\n' +
        '-|..|-------   |.........|\n' +
        '|..........|   |.........|\n' +
        '|..-----.-.|   |.........|\n' +
        '|..|...|...|   |.........|\n' +
        '|.........-|   |.........|\n' +
        '|.......|..|   |.........|\n' +
        '|.----..--.|   |.........|\n' +
        '|........|.--  |.........|\n' +
        '|.---.-.....------------+|\n' +
        '|...|...-................|\n' +
        '|.........----------------\n' +
        '----|..|..|               \n' +
        '    -------               ',
    '4-1':
        '------  ----- \n' +
        '|....|  |...| \n' +
        '|....----...| \n' +
        '|...........| \n' +
        '|..|-|.|-|..| \n' +
        '---------|.---\n' +
        '|......|.....|\n' +
        '|..----|.....|\n' +
        '--.|   |.....|\n' +
        ' |.|---|.....|\n' +
        ' |...........|\n' +
        ' |..|---------\n' +
        ' ----         ',
    '4-2':
        '-------- ------\n' +
        '|.|....|-|....|\n' +
        '|.|-..........|\n' +
        '|.||....|.....|\n' +
        '|.||....|.....|\n' +
        '|.|-----|.-----\n' +
        '|.|    |......|\n' +
        '|.-----|......|\n' +
        '|.............|\n' +
        '|..|---|......|\n' +
        '----   --------',
};

const SOKO_UPPER_VARIANTS = {
    '2-1': {
        map: SOKO_UPPER_MAPS['2-1'],
        dnstair: [6, 10], upstair: [16, 4],
        doors: [[18, 8, 'locked']],
        area: [0, 0, 19, 11],
        exclusions: [[7, 9, 18, 9]],
        boulders: [
            [2, 2], [3, 2],
            [5, 3], [7, 3], [7, 2], [8, 2],
            [10, 3], [11, 3],
            [2, 7], [2, 8], [3, 9],
            [5, 7], [6, 6],
        ],
        traps: [[7, 9, 'rolling boulder']]
            .concat(Array.from({ length: 10 }, (_, i) => [8 + i, 9, 'hole'])),
    },
    '2-2': {
        map: SOKO_UPPER_MAPS['2-2'],
        dnstair: [6, 11], upstair: [15, 6],
        doors: [[19, 9, 'locked'], [19, 11, 'locked']],
        area: [0, 0, 21, 12],
        exclusions: [[6, 11, 18, 11]],
        boulders: [
            [4, 2], [4, 3], [5, 3], [7, 3], [8, 3], [2, 4], [3, 4], [5, 5],
            [6, 6], [9, 6], [3, 7], [4, 7], [7, 7], [6, 9], [5, 10], [5, 11],
        ],
        traps: [[7, 11, 'rolling boulder']]
            .concat(Array.from({ length: 11 }, (_, i) => [8 + i, 11, 'hole'])),
    },
    '3-1': {
        map: SOKO_UPPER_MAPS['3-1'],
        dnstair: [11, 2], upstair: [23, 4],
        doors: [[27, 9, 'locked']],
        area: [0, 0, 28, 11],
        exclusions: [[11, 10, 27, 10]],
        boulders: [
            [3, 2], [4, 2], [6, 2], [6, 3], [7, 2],
            [3, 6], [2, 7], [3, 7], [3, 8], [2, 9], [3, 9], [4, 9],
            [6, 7], [6, 9], [8, 7], [8, 10], [9, 8], [9, 9], [10, 7], [10, 10],
        ],
        traps: [[11, 10, 'rolling boulder']]
            .concat(Array.from({ length: 15 }, (_, i) => [12 + i, 10, 'hole'])),
    },
    '3-2': {
        map: SOKO_UPPER_MAPS['3-2'],
        dnstair: [3, 1], upstair: [20, 4],
        doors: [[24, 9, 'locked']],
        area: [0, 0, 25, 13],
        exclusions: [[11, 10, 24, 10]],
        boulders: [
            [2, 3], [8, 3], [9, 4], [2, 5], [4, 5], [9, 5], [2, 6], [5, 6],
            [6, 7], [3, 8], [7, 8], [5, 9], [10, 9], [7, 10], [10, 10], [3, 11],
        ],
        traps: [[11, 10, 'rolling boulder']]
            .concat(Array.from({ length: 12 }, (_, i) => [12 + i, 10, 'hole'])),
    },
    // soko4 is the BOTTOM level: no down stair, a "branch" levregion instead,
    // pit traps rather than holes, and two scrolls of earth as "a little help".
    '4-1': {
        map: SOKO_UPPER_MAPS['4-1'],
        branch: [6, 4], upstair: [6, 6],
        doors: [],
        area: [0, 0, 13, 12],
        exclusions: [[1, 6, 7, 11]],
        boulders: [
            [2, 2], [2, 3],
            [10, 2], [9, 3], [10, 4],
            [8, 7], [9, 8], [9, 9], [8, 10], [10, 10],
        ],
        traps: [
            [4, 6, 'pit'],
            [2, 6, 'pit'], [2, 7, 'pit'], [2, 8, 'pit'], [2, 9, 'rolling boulder'],
            [2, 10, 'pit'], [3, 10, 'pit'], [4, 10, 'pit'], [5, 10, 'pit'],
            [6, 10, 'pit'], [7, 10, 'rolling boulder'],
        ],
        help: [[2, 11], [3, 11]],
    },
    '4-2': {
        map: SOKO_UPPER_MAPS['4-2'],
        branch: [3, 1], upstair: [1, 1],
        doors: [],
        area: [0, 0, 14, 10],
        // soko4-2 is the only variant with TWO exclusion rectangles.
        exclusions: [[1, 1, 1, 9], [1, 8, 7, 9]],
        boulders: [
            [5, 2], [6, 2], [6, 3], [7, 3],
            [9, 5], [10, 3], [11, 2], [12, 3],
            [7, 8], [8, 8], [9, 8], [10, 8],
        ],
        traps: [
            [1, 2, 'pit'], [1, 3, 'pit'], [1, 4, 'pit'], [1, 5, 'pit'],
            [1, 6, 'pit'], [1, 7, 'rolling boulder'],
            [1, 8, 'pit'], [2, 8, 'pit'], [3, 8, 'pit'], [4, 8, 'pit'],
            [5, 8, 'pit'], [6, 8, 'rolling boulder'],
        ],
        help: [[1, 9], [2, 9]],
    },
};

// C ref: makemaz("soko2"/"soko3"/"soko4") -> rnd(2) + load_special(proto-N).
export async function makemaz_soko_upper(proto) {
    const g = game;
    const slev = Is_special(g.u?.uz);
    const rndlevs = slev?.rndlevs || 2;
    const variant = rnd(rndlevs);            // mkmaze.c:1136 rnd(sp->rndlevs)
    shuffle(['law', 'neutral', 'chaos']);    // nhlib.lua top level: rn2(3), rn2(2)
    const V = SOKO_UPPER_VARIANTS[proto.slice(4) + '-' + variant];
    if (!V) return;
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.sokoban_rules = true;
        // soko4-1/soko4-2 alone add "hardfloor" to des.level_flags (sp_lev.c:3774);
        // it is what makes Can_dig_down()/Can_fall_thru() FALSE on Sokoban's
        // bottom level, so a dug/fallen-through floor there behaves as rock.
        if (V.branch) g.level.flags.hardfloor = true;
    }
    bigrm_level_init_solidfill();            // level_init solidfill -> rn2(2)
    bigrm_load_map(V.map, false);

    if (V.dnstair) quest_place_stair(V.dnstair[0], V.dnstair[1], false);
    if (V.branch) quest_register_branch(V.branch[0], V.branch[1]);
    quest_place_stair(V.upstair[0], V.upstair[1], true);
    for (const [dx, dy, dstate] of V.doors) quest_set_door(dx, dy, dstate);
    soko_region_lit_grow(V.area[0], V.area[1], V.area[2], V.area[3]);

    for (const [bx, by] of V.boulders)
        mksobj_at(BOULDER, q_absx(bx), q_absy(by), true, false);

    // des.exclusion({type="monster-generation"}) — precedes the traps in every
    // soko{2,3,4}-N.lua; state only, no RNG.
    for (const [ex1, ey1, ex2, ey2] of V.exclusions)
        soko_exclusion_mongen(ex1, ey1, ex2, ey2);

    for (const [tx, ty, kind] of V.traps) await soko_mktrap(tx, ty, kind);

    // "A little help": des.object("scroll of earth", x, y) — explicit id and
    // coord, so only mksobj's own draws (next_ident + blessorcurse).
    for (const [hx, hy] of (V.help || []))
        mksobj_at(SCR_EARTH, q_absx(hx), q_absy(hy), true, true);

    soko_create_object_class_random(FOOD_CLASS);
    soko_create_object_class_random(FOOD_CLASS);
    soko_create_object_class_random(FOOD_CLASS);
    soko_create_object_class_random(FOOD_CLASS);
    soko_create_object_class_random(RING_CLASS);
    soko_create_object_class_random(WAND_CLASS);

    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;
    if (rn2(2)) flp |= 2;
    if (flp) {
        flip_level(flp);
        soko_flip_exclusions(flp);
        // C's flip_level flips the registered lregions with the map; without
        // this soko4's branch cell stays at its pre-flip coordinate, fails
        // bad_location() and burns place_lregion's whole 200-try loop.
        quest_flip_branch(flp);
    }
    soko_solidify_and_nondig();
    // C ref: sp_lev.c:6048 — "This must be done before premap_detect(),
    // otherwise branch stairs won't be premapped."  Running place_lregions()
    // from the caller (after premap_detect) froze soko4's map memory before the
    // branch '>' existed, so it rendered as the remembered floor.
    // Dynamic import: mklev.js statically imports this module.
    if (V.branch) {
        const { quest_place_branch } = await import('../mklev.js');
        await quest_place_branch();
    }
    premap_detect();
    return false;   /* the branch is already placed */
}
