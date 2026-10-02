// levels/ran_loca.js — the Ranger quest "locate" level (dat/Ran-loca.lua), a
// concentric onion-ring maze holding a sleeping wumpus at its stair-down core.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Ran-loca")
// -> load_special("Ran-loca.lua").  Loading nhlib.lua first runs
// shuffle(align) (rn2(3),rn2(2)); level_init solidfill draws one rn2(2); then
// the des.* program runs in file order.  No levregion is registered, so
// fixup_special() places nothing.  This file has no des.wallify() call (unlike
// Ran-goal), so the tail is the plain implicit finalize.

import { COLNO, ROWNO, TELEP_TRAP } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, quest_level_init_solidfill,
    quest_place_stair, quest_region_light, shuffle, splev_create_monster,
    splev_link_doors_rooms, vly_non_diggable,
} from '../sp_lev.js';
import { ARROW_TRAP, S_SNAKE, SPIKED_PIT } from './quest_home_common.js';
import { quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd,
         quest_trap_typed_random } from './quest_common.js';

const RAN_LOCA_MAP = [
    '              .......  .........  .......              ',
    '     ...................       ...................     ',
    '  ....        .......             .......        ....  ',
    '...    .....     .       .....       .     .....    ...',
    '.   .......... .....  ...........  ..... ..........   .',
    '.  ..  ..... ..........  .....  .......... .....  ..  .',
    '.  .     .     .....       .       .....     .     .  .',
    '.  .   .....         .............         .....   .  .',
    '.  .  ................  .......  ................  .  .',
    '.  .   .....            .......            .....   .  .',
    '.  .     .    ......               ......    .     .  .',
    '.  .     ...........   .........   ...........     .  .',
    '.  .          ..........       ..........          .  .',
    '.  ..  .....     .       .....       .     .....  ..  .',
    '.   .......... .....  ...........  ..... ..........   .',
    '.      ..... ..........  .....  .......... .....      .',
    '.        .     .....       .       .....     .        .',
    '...   .......           .......           .......   ...',
    '  ..............     .............     ..............  ',
    '      .......  .......  .......  .......  .......      ',
].join('\n');

export async function makemaz_ran_loca() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style = "solidfill", fg = " " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel", "hardfloor") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.hardfloor = true;
    }
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(RAN_LOCA_MAP, false);

    // des.region(selection.area(00,00,54,19), "lit") — no RNG.
    quest_region_light(0, 0, 54, 19, true);
    // des.stair("up",25,05) / des.stair("down",27,18) — no RNG.
    quest_place_stair(25, 5, true);
    quest_place_stair(27, 18, false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.non_diggable(selection.area(00,00,54,19)) — no RNG.
        vly_non_diggable(0, 0, 54, 19);
        // des.object() x8 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 8; i++) quest_object_rnd();
        // des.trap("spiked pit") x2, des.trap("teleport") x2, des.trap("arrow")
        // x2 — a fixed type at a random DRY spot each (no traptype_rnd draw).
        await quest_trap_typed_random(SPIKED_PIT);
        await quest_trap_typed_random(SPIKED_PIT);
        await quest_trap_typed_random(TELEP_TRAP);
        await quest_trap_typed_random(TELEP_TRAP);
        await quest_trap_typed_random(ARROW_TRAP);
        await quest_trap_typed_random(ARROW_TRAP);

        // des.monster({ id="wumpus", x=27, y=18, peaceful=0, asleep=1 }) — the
        // sleeping guardian sitting on the down stair.  splev_create_monster
        // (unlike the fixed-coord quest_create_monster()) also applies `asleep`.
        splev_create_monster({ name: 'wumpus', mx: 27, my: 18, peaceful: 0, asleep: true });
        // des.monster({id="giant bat",peaceful=0}) x4 — random position.
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('giant bat', 0);
        // des.monster({id="forest centaur",peaceful=0}) x4 — random position.
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('forest centaur', 0);
        // des.monster({id="mountain centaur",peaceful=0}) x8 — random position.
        for (let i = 0; i < 8; i++) quest_monster_named_rnd('mountain centaur', 0);
        // des.monster({id="scorpion",peaceful=0}) x4 — random position.
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('scorpion', 0);
        // des.monster({class="s",peaceful=0}) x2 — random S_SNAKE species.
        for (let i = 0; i < 2; i++) quest_monster_class_rnd(S_SNAKE, 0);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> link_doors_rooms() then
    // wallification(1,0,COLNO-1,ROWNO-1) then flip_level_rnd(3, FALSE) — no
    // "noflip" here, so both rn2(2) draws happen as usual.  No des.wallify()
    // call in this file (unlike Ran-goal), so this IS the whole tail.
    splev_link_doors_rooms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
