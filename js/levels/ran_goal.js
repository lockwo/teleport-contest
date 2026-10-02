// levels/ran_goal.js — the Ranger quest "goal" level (dat/Ran-goal.lua), a
// walled compound where Scorpius guards the Longbow of Diana.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Ran-goal")
// -> load_special("Ran-goal.lua").  nhlib.lua's shuffle(align) (rn2(3),rn2(2))
// runs first — this level does not index the table, but the draws still
// happen; level_init solidfill draws one rn2(2); then the des.* program runs
// in file order.  No levregion, so fixup_special() places nothing.  This
// file DOES call des.wallify() explicitly (unlike Ran-loca) right before the
// implicit finalize wallification.

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { CHEST, objects as OBJDATA, STRANGE_OBJECT } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, gx, gy,
    quest_create_monster, quest_level_init_solidfill, quest_place_stair,
    quest_region_light, quest_set_door, shuffle, splev_link_doors_rooms,
    splev_object_at, vly_non_diggable,
} from '../sp_lev.js';
import { S_CENTAUR, S_SNAKE, quest_wallify_map } from './quest_home_common.js';
import { quest_monster_class_rnd, quest_monster_named_rnd, quest_named_object_at,
         quest_object_rnd, quest_trap_random } from './quest_common.js';

// C ref: onames.h — the one otyp this file needs that js/mkobj.js does not
// export as a named constant.  Resolved by NAME from the generated object
// table rather than written as a literal: a table shift would silently
// retarget a literal ([[wrong-constant-sweep]]).
function otyp_by_name(nm) {
    for (let i = 0; i < OBJDATA.length; i++)
        if (OBJDATA[i]?.name === nm) return i;
    return STRANGE_OBJECT;
}

const RAN_GOAL_MAP = [
    '                                                                            ',
    '  ...                                                                  ...  ',
    ' .......................................................................... ',
    '  ...                                +                                 ...  ',
    '   .     ............     .......    .                   .......        .   ',
    '   .  .............................  .       ........   .........S..    .   ',
    '   .   ............    .  ......     .       .      .    .......   ..   .   ',
    '   .     .........     .   ....      +       . ...  .               ..  .   ',
    '   .        S          .         .........   .S.    .S...............   .   ',
    '   .  ...   .     ...  .         .........          .                   .   ',
    '   . ........    .....S.+.......+....\\....+........+.                   .   ',
    '   .  ...         ...    S       .........           ..      .....      .   ',
    '   .                    ..       .........            ..      ......    .   ',
    '   .      .......     ...            +       ....    ....    .......... .   ',
    '   . ..............  ..              .      ......  ..  .............   .   ',
    '   .     .............               .     ..........          ......   .   ',
    '  ...                                +                                 ...  ',
    ' .......................................................................... ',
    '  ...                                                                  ...  ',
    '                                                                            ',
].join('\n');

export async function makemaz_ran_goal() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style = "solidfill", fg = " " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel") — no RNG, and no "noflip".
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(RAN_GOAL_MAP, false);

    // des.region(selection.area(00,00,75,19), "lit") — no RNG.
    quest_region_light(0, 0, 75, 19, true);
    // des.stair("up",19,10) — no down stair: bottom of the branch.
    quest_place_stair(19, 10, true);
    // des.non_diggable(selection.area(00,00,75,19)) — no RNG.
    vly_non_diggable(0, 0, 75, 19);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object({ id="bow", x=37, y=10, buc="blessed", spe=0,
        //              name="The Longbow of Diana" }) — the quest artifact.
        quest_named_object_at(otyp_by_name('bow'), 37, 10,
                              { spe: 0, buc: 'blessed', name: 'The Longbow of Diana' });
        // des.object("chest", 37, 10) — a specific id at an explicit coord, no
        // name: mksobj_at(CHEST, x, y, TRUE, artif=!named=TRUE).
        splev_object_at({ otyp: CHEST }, 37, 10);
        // des.object({ coord = {x,y} }) x8 — RANDOM_CLASS at an explicit coord
        // (no search, so no RNG for the placement itself).
        for (const [ox, oy] of [[36, 9], [36, 10], [36, 11], [37, 9],
                                 [37, 11], [38, 9], [38, 10], [38, 11]])
            splev_object_at({}, ox, oy);
        // des.object() x5 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 5; i++) quest_object_rnd();

        // des.trap() x6 — fully random type at a random DRY spot.
        for (let i = 0; i < 6; i++) await quest_trap_random();

        // des.door(state,x,y) x14 — explicit coordinate + state, no RNG.  The
        // map string already places DOOR-typed cells at every '+'; these calls
        // only set the lock/open state, so their position relative to the
        // object/trap/monster placements above/below has no RNG consequence.
        quest_set_door(12, 8, 'locked');
        quest_set_door(22, 10, 'closed');
        quest_set_door(24, 10, 'locked');
        quest_set_door(25, 11, 'closed');
        quest_set_door(32, 10, 'closed');
        quest_set_door(37, 3, 'closed');
        quest_set_door(37, 7, 'closed');
        quest_set_door(37, 13, 'closed');
        quest_set_door(37, 16, 'closed');
        quest_set_door(42, 10, 'closed');
        quest_set_door(46, 8, 'locked');
        quest_set_door(51, 10, 'closed');
        quest_set_door(53, 8, 'locked');
        quest_set_door(65, 5, 'closed');

        // des.monster({ id="Scorpius", x=37, y=10, peaceful=0 }) — the nemesis,
        // on top of the artifact.
        quest_create_monster('Scorpius', 37, 10, 0);
        // des.monster({ id="forest centaur", x=,y=, peaceful=0 }) x6 — fixed
        // coords ringing the artifact chamber.
        for (const [mx, my] of [[36, 9], [36, 10], [36, 11], [37, 9], [37, 11], [38, 9]])
            quest_create_monster('forest centaur', mx, my, 0);
        // des.monster({ id="mountain centaur", x=,y=, peaceful=0 }) x2 — fixed
        // coords finishing the chamber ring.
        quest_create_monster('mountain centaur', 38, 10, 0);
        quest_create_monster('mountain centaur', 38, 11, 0);
        // des.monster({ id="mountain centaur", x=,y=, peaceful=0 }) x4 — the
        // four corner guards.
        for (const [mx, my] of [[2, 2], [71, 2], [2, 16], [71, 16]])
            quest_create_monster('mountain centaur', mx, my, 0);
        // des.monster({id="forest centaur",peaceful=0}) x2 — random position.
        for (let i = 0; i < 2; i++) quest_monster_named_rnd('forest centaur', 0);
        // des.monster({id="mountain centaur",peaceful=0}) x2 — random position.
        for (let i = 0; i < 2; i++) quest_monster_named_rnd('mountain centaur', 0);
        // des.monster({class="C",peaceful=0}) x2 — random S_CENTAUR species.
        for (let i = 0; i < 2; i++) quest_monster_class_rnd(S_CENTAUR, 0);
        // des.monster({ id="scorpion", x=,y=, peaceful=0 }) x6 — fixed coords.
        for (const [mx, my] of [[3, 2], [72, 2], [3, 17], [72, 17], [41, 10], [33, 9]])
            quest_create_monster('scorpion', mx, my, 0);
        // des.monster({id="scorpion",peaceful=0}) x2 — random position.
        for (let i = 0; i < 2; i++) quest_monster_named_rnd('scorpion', 0);
        // des.monster({class="s",peaceful=0}) — random S_SNAKE species.
        quest_monster_class_rnd(S_SNAKE, 0);
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
