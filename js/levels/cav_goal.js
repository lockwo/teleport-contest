// levels/cav_goal.js — the Caveman quest "goal" level (dat/Cav-goal.lua), a
// diamond-shaped cavern where the Chromatic Dragon guards the Sceptre of
// Might.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Cav-goal")
// -> load_special("Cav-goal.lua").  nhlib.lua's shuffle(align) (rn2(3),rn2(2))
// runs first — this level does not index the table, but the draws still
// happen; level_init solidfill draws one rn2(2); then the des.* program runs
// in file order.  No levregion, so fixup_special() places nothing.

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { objects as OBJDATA, STRANGE_OBJECT } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, gx, gy,
    quest_create_monster, quest_level_init_solidfill, quest_region_light,
    shuffle, splev_create_monster, splev_link_doors_rooms, vly_non_diggable,
} from '../sp_lev.js';
import { cav_stair_random } from './cav_fila.js';
import { quest_wallify_map } from './quest_home_common.js';
import { quest_named_object_at, quest_object_rnd } from './quest_common.js';

// C ref: onames.h — the one otyp this file needs that js/mkobj.js does not
// export as a named constant.  Resolved by NAME from the generated object
// table rather than written as a literal: a table shift would silently
// retarget a literal ([[wrong-constant-sweep]]).
function otyp_by_name(nm) {
    for (let i = 0; i < OBJDATA.length; i++)
        if (OBJDATA[i]?.name === nm) return i;
    return STRANGE_OBJECT;
}

const CAV_GOAL_MAP = [
    '                                                                            ',
    '                          .....................                             ',
    '                         .......................                            ',
    '                        .........................                           ',
    '                       ...........................                          ',
    '                      .............................                         ',
    '                     ...............................                        ',
    '                    .................................                       ',
    '                   ...................................                      ',
    '                  .....................................                     ',
    '                 .......................................                    ',
    '                  .....................................                     ',
    '                   ...................................                      ',
    '                    .................................                       ',
    '                     ...............................                        ',
    '                      .............................                         ',
    '                       ...........................                          ',
    '                        .........................                           ',
    '                         .......................                            ',
    '                                                                            ',
].join('\n');

export async function makemaz_cav_goal() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel") — no RNG, and no "noflip".
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(CAV_GOAL_MAP, false);

    // des.region(selection.area(00,00,75,19), "lit") — no RNG.
    quest_region_light(0, 0, 75, 19, true);

    // des.stair("up") — fully random (no down stair: bottom of the branch).
    cav_stair_random(true);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.non_diggable(selection.area(00,00,75,19)) — no RNG.
        vly_non_diggable(0, 0, 75, 19);

        // des.object({ id="mace", x=23, y=10, buc="blessed", spe=0,
        //              name="The Sceptre of Might" }) — the quest artifact.
        quest_named_object_at(otyp_by_name('mace'), 23, 10,
                              { spe: 0, buc: 'blessed', name: 'The Sceptre of Might' });
        // des.object() x14 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 14; i++) quest_object_rnd();

        // des.monster({ id="Chromatic Dragon", x=23, y=10, asleep=1 }) — the
        // nemesis, on top of the artifact.  splev_create_monster (unlike the
        // fixed-coord quest_create_monster()) also applies `asleep`.
        splev_create_monster({ name: 'Chromatic Dragon', mx: 23, my: 10, asleep: true });
        // des.monster("shrieker", x, y) x3 — the 3-arg string form: fixed
        // coord, no peaceful override (makemon's own answer stands).
        quest_create_monster('shrieker', 26, 13, null);
        quest_create_monster('shrieker', 25, 8, null);
        quest_create_monster('shrieker', 45, 11, null);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // des.wallify() with no arguments — mkmap.c wallify_map() over the
    // des.map footprint, before lspo_finalize_level's own wallification().
    quest_wallify_map(gx.xstart - 1, gy.ystart - 1,
                      gx.xstart + gx.xsize + 1, gy.ystart + gy.ysize + 1);

    // C ref: lspo_finalize_level -> link_doors_rooms() then
    // wallification(1,0,COLNO-1,ROWNO-1) then flip_level_rnd(3, FALSE) — no
    // "noflip" here, so both rn2(2) draws happen as usual.
    splev_link_doors_rooms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
