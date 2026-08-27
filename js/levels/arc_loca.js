// levels/arc_loca.js — the Archeologist quest "locate" level (dat/Arc-loca.lua),
// the labyrinthine temple complex.  sp_lev.js re-exports makemaz_arc_loca.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Arc-loca")
// -> load_special("Arc-loca.lua").  Loading nhlib.lua first runs
// shuffle(align) (rn2(3),rn2(2)) — and THIS level indexes that shuffled table
// for its three altars, so the shuffle result is load-bearing here, unlike on
// Arc-strt.  level_init solidfill draws one rn2(2); then the des.* program runs
// in file order.  No levregion is registered, so fixup_special() places nothing.

import {
    ANTI_MAGIC, COLNO, DART_TRAP, MAGIC_TRAP, OROOM, PIT, ROLLING_BOULDER_TRAP,
    ROWNO, SLP_GAS_TRAP, SPIKED_PIT, STATUE_TRAP,
} from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    ARC_S_MUMMY, ARC_S_SNAKE, TEMPLE_RTYPE, bigrm_load_map, bigrm_wallification,
    flip_level, quest_level_init_solidfill, quest_place_stair, quest_region_light,
    quest_set_door, shuffle, splev_link_doors_rooms, vly_altar, vly_non_diggable,
    vly_region,
} from '../sp_lev.js';
import {
    QUEST_ALIGN_AMASK, quest_engraving_random, quest_monster_class_rnd,
    quest_monster_named_rnd, quest_object_rnd, quest_trap_typed_at,
    quest_trap_typed_random,
} from './quest_common.js';

// C ref: sp_lev.c lspo_region "filled" — 2 is the "level flags only" value:
// fill_special_room() skips its switch entirely and only sets has_temple.
const FILL_LVLFLAGS_ONLY = 2;

const ARC_LOCA_MAP = [
    '............................................................................',
    '............................................................................',
    '............................................................................',
    '........................-------------------------------.....................',
    '........................|....|.S......................|.....................',
    '........................|....|.|.|+------------------.|.....................',
    '........................|....|.|.|.|.........|......|.|.....................',
    '........................|....|.|.|.|.........|......|.|.....................',
    '........................|---+-.|.|.|..---....+......|.|.....................',
    '........................|....|.|.|.---|.|....|......|.|.....................',
    '........................|....S.|.|.+..S.|--S-----S--|.|.....................',
    '........................|....|.|.|.---|.|....|......+.|.....................',
    '........................|---+-.|.|.|..---....|.------.|.....................',
    '........................|....|.|.|.|.........|.|....+.|.....................',
    '........................|....|.|.|.|.........|+|....|-|.....................',
    '........................|....|.|.|------------+------.S.....................',
    '........................|....|.S......................|.....................',
    '........................-------------------------------.....................',
    '............................................................................',
    '............................................................................',
].join('\n');

export async function makemaz_arc_loca() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    const align = shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel", "hardfloor") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.hardfloor = true;
    }
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(ARC_LOCA_MAP, false);

    // des.region(...) — the whole level lit, then the three temples and the
    // lit/unlit chambers.  Every table-form region names `lit` explicitly, so
    // litstate_rnd() never draws.  The temple/irregular ones create rooms (C
    // only skips room creation for a rectangular, non-irregular OROOM).
    quest_region_light(0, 0, 75, 19, true);
    vly_region(25, 4, 28, 7, 1, TEMPLE_RTYPE, FILL_LVLFLAGS_ONLY, false);
    vly_region(25, 9, 28, 11, 0, TEMPLE_RTYPE, FILL_LVLFLAGS_ONLY, false);
    vly_region(25, 13, 28, 16, 1, TEMPLE_RTYPE, FILL_LVLFLAGS_ONLY, false);
    quest_region_light(30, 4, 30, 16, true);
    quest_region_light(32, 4, 32, 16, false);
    vly_region(33, 4, 53, 4, 0, OROOM, 0, true);
    quest_region_light(36, 10, 37, 10, false);
    quest_region_light(39, 9, 39, 11, false);
    vly_region(36, 6, 42, 8, 0, OROOM, 0, true);
    vly_region(36, 12, 42, 14, 0, OROOM, 0, true);
    quest_region_light(46, 6, 51, 9, false);
    vly_region(46, 11, 49, 11, 0, OROOM, 0, true);
    quest_region_light(48, 13, 51, 14, false);

    // des.door(...) x16 — explicit states, no RNG.
    quest_set_door(31, 4, 'closed');
    quest_set_door(28, 8, 'closed');
    quest_set_door(29, 10, 'locked');
    quest_set_door(28, 12, 'closed');
    quest_set_door(31, 16, 'closed');
    quest_set_door(34, 5, 'locked');
    quest_set_door(35, 10, 'locked');
    quest_set_door(38, 10, 'locked');
    quest_set_door(43, 10, 'closed');
    quest_set_door(45, 8, 'closed');
    quest_set_door(46, 14, 'locked');
    quest_set_door(46, 15, 'locked');
    quest_set_door(49, 10, 'locked');
    quest_set_door(52, 11, 'locked');
    quest_set_door(52, 13, 'closed');
    quest_set_door(54, 15, 'closed');

    // des.stair("up",03,17) / des.stair("down",39,10) — no RNG.
    quest_place_stair(3, 17, true);
    quest_place_stair(39, 10, false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.altar(...) x3 — one per temple, in the order of the shuffled
        // nhlib `align` table.  type="altar" is shrine==0, so no priestini and
        // no RNG at all: the alignment came out of the load-time shuffle.
        vly_altar(26, 5, QUEST_ALIGN_AMASK[align[0]], 0);
        vly_altar(26, 10, QUEST_ALIGN_AMASK[align[1]], 0);
        vly_altar(26, 15, QUEST_ALIGN_AMASK[align[2]], 0);
        // des.non_diggable(selection.area(00,00,75,19)) — no RNG.
        vly_non_diggable(0, 0, 75, 19);
        // des.object() x15 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 15; i++) quest_object_rnd();
        // des.engraving({type="engrave", text="X marks the spot."}) x4 — each
        // draws its own random DRY location; make_engr_at itself draws nothing.
        for (let i = 0; i < 4; i++) quest_engraving_random('X marks the spot.');
        // des.trap(type, x, y) — fixed type at a fixed coord: maketrap plus the
        // always-drawn mktrap victim check rnd(4).  The 12 pits/magic trap draw
        // nothing but that rnd(4); the statue traps make a statue (rndmonnum)
        // and its inhabitant, and the rolling boulders a launch coord.
        await quest_trap_typed_at(SPIKED_PIT, 24, 2);
        await quest_trap_typed_at(SPIKED_PIT, 37, 0);
        await quest_trap_typed_at(SPIKED_PIT, 23, 5);
        await quest_trap_typed_at(SPIKED_PIT, 26, 19);
        await quest_trap_typed_at(SPIKED_PIT, 55, 10);
        await quest_trap_typed_at(SPIKED_PIT, 55, 8);
        await quest_trap_typed_at(PIT, 51, 1);
        await quest_trap_typed_at(PIT, 23, 18);
        await quest_trap_typed_at(PIT, 31, 18);
        await quest_trap_typed_at(PIT, 48, 19);
        await quest_trap_typed_at(PIT, 55, 15);
        await quest_trap_typed_at(MAGIC_TRAP, 60, 4);
        await quest_trap_typed_at(STATUE_TRAP, 72, 7);
        // des.trap("name") — fixed type, RANDOM location: the DRY get_location
        // loop (rejecting stairs), then the same mktrap tail.
        await quest_trap_typed_random(STATUE_TRAP);
        await quest_trap_typed_random(STATUE_TRAP);
        await quest_trap_typed_at(ANTI_MAGIC, 64, 12);
        await quest_trap_typed_random(SLP_GAS_TRAP);
        await quest_trap_typed_random(SLP_GAS_TRAP);
        await quest_trap_typed_random(DART_TRAP);
        await quest_trap_typed_random(DART_TRAP);
        await quest_trap_typed_random(DART_TRAP);
        await quest_trap_typed_at(ROLLING_BOULDER_TRAP, 32, 10);
        await quest_trap_typed_at(ROLLING_BOULDER_TRAP, 40, 16);
        // des.monster("S") x18 / "M" / "human mummy" x7 / "M" — all at random
        // locations, none with a `peaceful` field (so makemon's own answer
        // stands).  The class form skips find_montype (no gender roll).  A snake
        // class pick is often a swimmer, and on this waterless level that costs
        // the 100+100+1 get_location iterations quest_place_monster models.
        for (let i = 0; i < 18; i++) quest_monster_class_rnd(ARC_S_SNAKE, null);
        quest_monster_class_rnd(ARC_S_MUMMY, null);
        for (let i = 0; i < 7; i++) quest_monster_named_rnd('human mummy', null);
        quest_monster_class_rnd(ARC_S_MUMMY, null);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> link_doors_rooms() then
    // wallification(1,0,COLNO-1,ROWNO-1) then flip_level_rnd(3, FALSE).
    splev_link_doors_rooms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
