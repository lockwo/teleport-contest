// levels/wiz_loca.js — the Wizard quest "locate" level (dat/Wiz-loca.lua): the
// cloud-wracked plain around a moated nest of concentric walled rings.
// sp_lev.js re-exports makemaz_wiz_loca.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Wiz-loca")
// -> load_special("Wiz-loca.lua").  Loading nhlib.lua first runs shuffle(align)
// (rn2(3),rn2(2)); this level never indexes `align`, but the two draws are real.
// level_init solidfill draws one rn2(2), then the des.* program runs in file
// order.  No levregion is registered, so fixup_special() places nothing.
//
// The three des.replace_terrain() scans dominate the level's PRNG stream: 744
// rn2(100) draws, one per MATCHING square, before the first door is placed.

import {
    ANTI_MAGIC, CLOUD, COLNO, DART_TRAP, MAGIC_TRAP, MOAT, OROOM, POLY_TRAP,
    ROCKTRAP, ROOM, ROWNO, SLP_GAS_TRAP, SPIKED_PIT, STATUE_TRAP,
} from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, lspo_door_relative,
    quest_level_init_solidfill, quest_place_stair, quest_region_light,
    quest_replace_terrain, quest_set_door, remove_boundary_syms, shuffle,
    splev_link_doors_rooms, vly_non_diggable, vly_region, vly_terrain_at,
} from '../sp_lev.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd,
    quest_trap_typed_at, quest_trap_typed_random,
} from './quest_common.js';

// C ref: defsym.h MONSYM(28,'B',...) and MONSYM(9,'i',...) —
// def_char_to_monclass('B') / ('i').
const WIZ_S_BAT = 28, WIZ_S_IMP = 9;

const WIZ_LOCA_MAP = [
    ".............        .......................................................",
    "..............       .............}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}.......",
    "..............      ..............}.................................}.......",
    "..............      ..............}.-------------------------------.}.......",
    "...............     .........C....}.|.............................|.}.......",
    "...............    ..........C....}.|.---------------------------.|.}.......",
    "...............    .........CCC...}.|.|.........................|.|.}.......",
    "................   ....C....CCC...}.|.|.-----------------------.|.|.}.......",
    ".......C..C.....  .....C....CCC...}.|.|.|......+.......+......|.|.|.}.......",
    ".............C..CC.....C....CCC...}.|.|.|......|-------|......|.|.|.}.......",
    "................   ....C....CCC...}.|.|.|......|.......|......|.|.|.}.......",
    "......C..C.....    ....C....CCC...}.|.|.|......|-------|......|.|.|.}.......",
    "............C..     ...C....CCC...}.|.|.|......+.......+......|.|.|.}.......",
    "........C......    ....C....CCC...}.|.|.-----------------------.|.|.}.......",
    "....C......C...     ........CCC...}.|.|.........................|.|.}.......",
    "......C..C....      .........C....}.|.---------------------------.|.}.......",
    "..............      .........C....}.|.............................|.}.......",
    ".............       ..............}.-------------------------------.}.......",
    ".............        .............}.................................}.......",
    ".............        .............}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}.......",
    ".............        .......................................................",
].join('\n');

// C ref: nhlib.lua:10 math.random(lo, hi) 2-arg form -> nh.random(lo, hi+1-lo),
// i.e. lo + rn2(hi+1-lo).  Wiz-loca.lua:53/61 use it to pick which wall of the
// inner chamber carries the secret door.
function lua_random_range(lo, hi) {
    return lo + rn2(hi + 1 - lo);
}

// des.region({..., irregular=1, contents=function() des.door{state="secret",
// wall=<w>} end}).  The region's flood-filled room IS gc.coder->croom for the
// duration of contents(), so create_door() measures its rn2(span) against the
// FLOODED extent, not the region rectangle.
function wiz_loca_secret_door(wall) {
    return (croom) => lspo_door_relative({ state: 'secret', wall }, croom);
}

export async function makemaz_wiz_loca() {
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
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).  76x21, so
    // lspo_map's ystart recovery arm fires (ysize == ROWNO -> ystart = 0).
    bigrm_load_map(WIZ_LOCA_MAP, false);

    // The three des.replace_terrain() scans, in file order.  Scan 2 can turn a
    // '.' at map column 68 into a '}', which scan 3 then re-scans — hence the
    // order matters as much as the counts.
    quest_replace_terrain(0, 0, 30, 20, ROOM, CLOUD, 15);
    quest_replace_terrain(68, 0, 75, 20, ROOM, MOAT, 25);
    quest_replace_terrain(34, 1, 68, 19, MOAT, ROOM, 2);

    // des.region(selection.area(00,00,75,20), "lit") — no RNG, no room.
    quest_region_light(0, 0, 75, 20, true);

    // The five irregular regions.  Each names `lit` explicitly, so
    // litstate_rnd() never draws; each creates a room (irregular=1) and then
    // runs its contents() -> des.door{state="secret"}, whose create_door()
    // costs one rn2(4) per retry plus one rn2(span) when that side is allowed.
    vly_region(37, 4, 65, 16, 0, OROOM, 0, true, wiz_loca_secret_door('random'));
    vly_region(39, 6, 63, 14, 0, OROOM, 0, true, wiz_loca_secret_door('random'));
    vly_region(41, 8, 46, 12, 1, OROOM, 0, true, (croom) => {
        const walls = ['north', 'south', 'west'];        // Wiz-loca.lua:52
        const widx = lua_random_range(1, walls.length);  // Wiz-loca.lua:53
        lspo_door_relative({ state: 'secret', wall: walls[widx - 1] }, croom);
    });
    vly_region(56, 8, 61, 12, 1, OROOM, 0, true, (croom) => {
        const walls = ['north', 'south', 'east'];        // Wiz-loca.lua:60
        const widx = lua_random_range(1, walls.length);  // Wiz-loca.lua:61
        lspo_door_relative({ state: 'secret', wall: walls[widx - 1] }, croom);
    });
    quest_region_light(48, 8, 54, 8, false);
    quest_region_light(48, 12, 54, 12, false);
    vly_region(48, 10, 54, 10, 0, OROOM, 0, true, wiz_loca_secret_door('random'));

    // des.door("locked", x, y) x4 — explicit state over map-drawn '+' cells.
    quest_set_door(55, 8, 'locked');
    quest_set_door(55, 12, 'locked');
    quest_set_door(47, 8, 'locked');
    quest_set_door(47, 12, 'locked');

    // des.terrain({03,17}, ".") — the up stairs land on a '.' the map draws as
    // '.' already; C stamps it anyway.  No RNG.
    vly_terrain_at(3, 17, ROOM);
    quest_place_stair(3, 17, true);
    quest_place_stair(48, 10, false);

    // des.non_diggable(selection.area(00,00,75,20)) — no RNG.
    vly_non_diggable(0, 0, 75, 20);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object() x15 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 15; i++) quest_object_rnd();

        // des.trap(type, x, y) — fixed type at a fixed coord: maketrap plus the
        // always-drawn mktrap victim check rnd(4).
        await quest_trap_typed_at(SPIKED_PIT, 24, 2);
        await quest_trap_typed_at(SPIKED_PIT, 7, 10);
        await quest_trap_typed_at(SPIKED_PIT, 23, 5);
        await quest_trap_typed_at(SPIKED_PIT, 26, 19);
        await quest_trap_typed_at(SPIKED_PIT, 72, 2);
        await quest_trap_typed_at(SPIKED_PIT, 72, 12);
        await quest_trap_typed_at(ROCKTRAP, 45, 16);
        await quest_trap_typed_at(ROCKTRAP, 65, 13);
        await quest_trap_typed_at(ROCKTRAP, 55, 6);
        await quest_trap_typed_at(ROCKTRAP, 39, 11);
        await quest_trap_typed_at(ROCKTRAP, 57, 9);
        // des.trap("name") — fixed type, RANDOM location: the DRY get_location
        // loop (rejecting stairs), then the same mktrap tail.
        await quest_trap_typed_random(MAGIC_TRAP);
        await quest_trap_typed_random(STATUE_TRAP);
        await quest_trap_typed_random(STATUE_TRAP);
        await quest_trap_typed_random(POLY_TRAP);
        await quest_trap_typed_at(ANTI_MAGIC, 53, 10);
        await quest_trap_typed_random(SLP_GAS_TRAP);
        await quest_trap_typed_random(SLP_GAS_TRAP);
        await quest_trap_typed_random(DART_TRAP);
        await quest_trap_typed_random(DART_TRAP);
        await quest_trap_typed_random(DART_TRAP);

        // des.monster({class="X", peaceful=0}) — the TABLE form with only
        // class/peaceful reads no "id", so get_table_montype() returns NON_PM
        // without a gender roll: same draws as the bare class-char string form.
        // `peaceful=0` is applied after makemon() and costs nothing.
        for (let i = 0; i < 12; i++) quest_monster_class_rnd(WIZ_S_BAT, 0);
        for (let i = 0; i < 7; i++) quest_monster_class_rnd(WIZ_S_IMP, 0);
        // des.monster("vampire bat") — the string form with a multi-char name
        // goes through find_montype(), whose gender roll is a real rn2(2).
        for (let i = 0; i < 7; i++) quest_monster_named_rnd('vampire bat', null);
        quest_monster_class_rnd(WIZ_S_IMP, 0);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level() — link_doors_rooms(), remove_boundary_syms()
    // and map_cleanup() (no RNG), wallification(1,0,COLNO-1,ROWNO-1), then
    // flip_level_rnd(allow_flips=3): one rn2(2) per axis.
    splev_link_doors_rooms();
    remove_boundary_syms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
