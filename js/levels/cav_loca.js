// levels/cav_loca.js — the Caveman quest "locate" level (dat/Cav-loca.lua),
// a wide unlit cavern holding one lit treasure vault.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Cav-loca")
// -> load_special("Cav-loca.lua").  Loading nhlib.lua first runs
// shuffle(align) (rn2(3),rn2(2)); level_init solidfill draws one rn2(2); then
// the des.* program runs in file order.  No levregion is registered, so
// fixup_special() places nothing.

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, gx, gy, lspo_region,
    quest_create_monster, quest_level_init_solidfill, quest_place_stair,
    quest_region_light, quest_set_door, shuffle, splev_link_doors_rooms,
    vly_non_diggable,
} from '../sp_lev.js';
import { quest_wallify_map } from './quest_home_common.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd, quest_trap_random,
} from './quest_common.js';

// C ref: monsym.h — the two class letters this level rolls.
const S_HUMANOID = 8, S_GIANT = 34;

const CAV_LOCA_MAP = [
    '                                                                            ',
    '    .............                     ...........                           ',
    '   ...............                   .............                          ',
    '    .............                  ...............        ..........        ',
    '     ...........                    .............      ...............      ',
    '        ...                                    ...   ..................     ',
    '         ...                ..........          ... ..................      ',
    '          ...              ............          BBB...................     ',
    '           ...              ..........          ......................      ',
    '            .....                 ..      .....B........................    ',
    '  ....       ...............      .    ........B..........................  ',
    ' ......     .. .............S..............         ..................      ',
    '  ....     ..                ...........             ...............        ',
    '     ..  ...                                    ....................        ',
    '      ....                                      BB...................       ',
    '         ..                 ..                 ..  ...............          ',
    '          ..   .......     ....  .....  ....  ..     .......   S            ',
    '           ............     ....... ..  .......       .....    ...  ....    ',
    '               .......       .....   ......                      .......    ',
    '                                                                            ',
].join('\n');

export async function makemaz_cav_loca() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel", "hardfloor") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.hardfloor = true;
    }
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(CAV_LOCA_MAP, false);

    // des.region(selection.area(00,00,75,19), "unlit") — no RNG.
    quest_region_light(0, 0, 75, 19, false);
    // des.region({ region={52,06,73,15}, lit=1, type="ordinary", irregular=1 })
    // — an irregular OROOM flood-filled from its top-left corner, same call
    // shape cav_strt.js already uses for its own irregular "occupied" rooms.
    lspo_region({ region: [52, 6, 73, 15], lit: 1, type: 'ordinary', irregular: true });

    // des.door("locked",28,11) — no RNG.
    quest_set_door(28, 11, 'locked');
    // des.stair("up",04,03) / des.stair("down",73,10) — no RNG.
    quest_place_stair(4, 3, true);
    quest_place_stair(73, 10, false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.non_diggable(selection.area(00,00,75,19)) — no RNG.
        vly_non_diggable(0, 0, 75, 19);
        // des.object() x15 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 15; i++) quest_object_rnd();
        // des.trap() x6 — random type at a random DRY spot.
        for (let i = 0; i < 6; i++) await quest_trap_random();
        // des.monster({id="bugbear",x=,y=,peaceful=0}) x13 — explicit coords.
        const bugbearSpots = [
            [2, 10], [3, 11], [4, 12], [2, 11],
            [16, 16], [17, 17], [18, 18], [19, 16],
            [30, 6], [31, 7], [32, 8], [33, 6], [34, 7],
        ];
        for (const [mx, my] of bugbearSpots) quest_create_monster('bugbear', mx, my, false);
        // des.monster({id="bugbear",peaceful=0}) x4 — random position.
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('bugbear', 0);
        // des.monster({class="h",peaceful=0}) — random S_HUMANOID.
        quest_monster_class_rnd(S_HUMANOID, 0);
        // des.monster({class="H",peaceful=0}) — random S_GIANT.
        quest_monster_class_rnd(S_GIANT, 0);
        // des.monster({id="hill giant",x=,y=,peaceful=0}) x3 — explicit coords.
        for (const [mx, my] of [[3, 12], [20, 17], [35, 8]])
            quest_create_monster('hill giant', mx, my, false);
        // des.monster({id="hill giant",peaceful=0}) x4 — random position.
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('hill giant', 0);
        // des.monster({class="H",peaceful=0}) — random S_GIANT.
        quest_monster_class_rnd(S_GIANT, 0);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // des.wallify() with no arguments — mkmap.c wallify_map() over the
    // des.map footprint, before lspo_finalize_level's own wallification().
    quest_wallify_map(gx.xstart - 1, gy.ystart - 1,
                      gx.xstart + gx.xsize + 1, gy.ystart + gy.ysize + 1);

    // C ref: lspo_finalize_level -> link_doors_rooms() then
    // wallification(1,0,COLNO-1,ROWNO-1) then flip_level_rnd(3, FALSE).
    splev_link_doors_rooms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
