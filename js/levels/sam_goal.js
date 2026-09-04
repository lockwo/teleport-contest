// levels/sam_goal.js — the Samurai quest "goal" level (dat/Sam-goal.lua), a
// concentric ring fortress where Ashikaga Takauji guards the Tsurugi of
// Muramasa.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Sam-goal")
// -> load_special("Sam-goal.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3), rn2(2)) runs first — unused here, but the draws still happen;
// level_init solidfill draws one rn2(2).  Three `local place = {...};
// local placeidx = math.random(1, #place)` statements run INLINE at their
// textual position in the file (nhlib.lua's math.random(lo,hi) ==
// nh.random(lo, hi+1-lo) == quest_lua_random) — the first picks which of two
// symmetric spots gets the up stair, the other two each carve one hole in
// the ring walls.  No levregion is registered, so fixup_special() places
// nothing.

import { COLNO, ROOM, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, quest_create_monster,
    quest_place_stair, quest_region_light, quest_set_door, shuffle,
    vly_non_diggable,
} from '../sp_lev.js';
import { quest_lua_random, quest_terrain_at } from './quest_home_common.js';
import { S_DOG } from '../symbols.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_named_object_at,
    quest_object_rnd, quest_trap_random, quest_trap_typed_at,
} from './quest_common.js';

const SAM_GOAL_MAP = [
    '                                             ',
    '           .......................           ',
    '       ......-------------------......       ',
    '    ......----.................----......    ',
    '   ....----.....-------------.....----....   ',
    '  ....--.....----...........----.....--....  ',
    '  ...||....---....---------....---....||...  ',
    '  ...|....--....---.......---....--....|...  ',
    ' ....|...||...---...--+--...---...||...|.... ',
    ' ....|...|....|....|-...-|....|....|...|.... ',
    ' ....|...|....|....+.....+....|....|...|.... ',
    ' ....|...|....|....|-...-|....|....|...|.... ',
    ' ....|...||...---...--+--...---...||...|.... ',
    '  ...|....--....---.......---....--....|...  ',
    '  ...||....---....---------....---....||...  ',
    '  ....--.....----...........----.....--....  ',
    '   ....----.....-------------.....----....   ',
    '    ......----.................----......    ',
    '       ......-------------------......       ',
    '           .......................           ',
].join('\n');

// C ref: dat/Sam-goal.lua's "The Tsurugi of Muramasa" — mkobj.js data row 57.
const TSURUGI = 57;

export async function makemaz_sam_goal() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style = "solidfill", fg = " " }) — rn2(2) + fill STONE.
    rn2(2);
    // des.level_flags("mazelevel", "noteleport") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
    }
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(SAM_GOAL_MAP, false);

    // `local place = { {02,11},{42,09} }; local placeidx = math.random(1,2)`
    // — runs here, BEFORE des.region/des.door, exactly at its textual spot.
    const stairPlaces = [[2, 11], [42, 9]];
    const stairXY = stairPlaces[quest_lua_random(1, stairPlaces.length) - 1];

    // des.region(selection.area(00,00,44,19), "unlit") — no RNG.
    quest_region_light(0, 0, 44, 19, false);

    // des.door(...) x4 — explicit states, no RNG.
    quest_set_door(19, 10, 'closed');
    quest_set_door(22, 8, 'closed');
    quest_set_door(22, 12, 'closed');
    quest_set_door(25, 10, 'closed');

    // des.stair({ dir="up", coord=place[placeidx] }) — an explicit (if
    // lua-randomised) coordinate: no further get_location RNG.
    quest_place_stair(stairXY[0], stairXY[1], true);

    // Two more `local place = {...}; local placeidx = math.random(1, #place)`
    // statements, each immediately followed by its des.terrain() call.
    const hole1 = [[22, 14], [30, 10], [22, 6], [14, 10]];
    const h1 = hole1[quest_lua_random(1, hole1.length) - 1];
    quest_terrain_at(h1[0], h1[1], ROOM);
    const hole2 = [[22, 4], [35, 10], [22, 16], [9, 10]];
    const h2 = hole2[quest_lua_random(1, hole2.length) - 1];
    quest_terrain_at(h2[0], h2[1], ROOM);
    const hole3 = [[22, 2], [22, 18]];
    const h3 = hole3[quest_lua_random(1, hole3.length) - 1];
    quest_terrain_at(h3[0], h3[1], ROOM);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.non_diggable(selection.area(00,00,44,19)) — no RNG.
        vly_non_diggable(0, 0, 44, 19);

        // des.object({id="tsurugi", x=22,y=10, buc="blessed", spe=0,
        //             name="The Tsurugi of Muramasa"}) — the quest artifact.
        quest_named_object_at(TSURUGI, 22, 10,
                              { spe: 0, buc: 'blessed', name: 'The Tsurugi of Muramasa' });
        // des.object() x14 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 14; i++) quest_object_rnd();

        // des.trap("board", x, y) x3 — fixed type at a fixed coord.
        await quest_trap_typed_at(4 /* SQKY_BOARD */, 22, 9);
        await quest_trap_typed_at(4 /* SQKY_BOARD */, 24, 10);
        await quest_trap_typed_at(4 /* SQKY_BOARD */, 22, 11);
        // des.trap() x6 — random type at a random DRY spot.  No "hardfloor"
        // shortcut here: this level does NOT set hardfloor, and
        // quest_trap_random() reads the real Can_fall_thru() state.
        for (let i = 0; i < 6; i++) await quest_trap_random();

        // des.monster("Ashikaga Takauji", 22, 10) — the nemesis, on the altar
        // spot.  No `peaceful` key, so makemon's own answer stands.
        quest_create_monster('Ashikaga Takauji', 22, 10, null);
        for (let i = 0; i < 5; i++) quest_monster_named_rnd('samurai', false);
        for (let i = 0; i < 5; i++) quest_monster_named_rnd('ninja', false);
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('wolf', null);
        for (let i = 0; i < 2; i++) quest_monster_class_rnd(S_DOG, null);
        for (let i = 0; i < 9; i++) quest_monster_named_rnd('stalker', null);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> wallification(1,0,COLNO-1,ROWNO-1) then
    // flip_level_rnd(allow_flips=3, FALSE) — no "noflip" here, so both bits
    // roll.  No levregion is registered on this level.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
