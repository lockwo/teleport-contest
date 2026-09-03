// levels/val_strt.js - special level builder makemaz_val_strt() (dat/Val-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { FOUNTAIN, ICE, LAVAPOOL, POOL } from '../const.js';
import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import {
    bigrm_load_map, quest_create_monster, quest_create_object,
    quest_drop_default_invent, quest_place_stair, quest_region_light,
    quest_register_branch, quest_set_door, splev_feature,
    reset_xystart_size,
} from '../sp_lev.js';
import {
    FIRE_TRAP, W_ANY, W_NORTH, W_RANDOM, W_WEST, quest_align_shuffle,
    quest_finalize, quest_level_init_fill, quest_monster, quest_non_diggable,
    quest_sel_grow, quest_sel_set_random, quest_sel_terrain, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Valkyrie quest "home" level loader (dat/Val-strt.lua) — the Norn's hall on
// an ice field, besieged by fire ants and fire giants.
//
// C ref: mklev.c makelevel() -> makemaz("Val-strt") -> load_special.
// This is the only quest home that builds selections before its des.map, so
// the pool coordinates come from the DEFAULT xstart/ystart/xsize/ysize
// (1/0/COLNO-1/ROWNO), not from a map origin: each `pools:set()` packs
// SP_COORD_PACK_RANDOM and get_location_coord(ANY_LOC) accepts the first roll,
// i.e. exactly one rn2(xsize) + one rn2(ysize).  16 of those, plus one rn2(4)
// for the "random" grow direction, are the whole cost of the pool field; the
// terrain writes and the map itself draw nothing.
// ════════════════════════════════════════════════════════════════════════

const VAL_STRT_MAP = [
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxxx..xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...xxxxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxx..xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..{..xxxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxx..xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.....xxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxx..xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxx..xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxx..xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..xxxxxxxxxxxxxxxxxxx',
    'xxxxxxxx.....xxxxxxxxxxxxx|----------------|xxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxx',
    'xxxxxxx..xxx...xxxxxxxxxxx|................|xxxxxxxxxx..xxxxxxxxxxxxxxxxxxxx',
    'xxxxxx..xxxxxx......xxxxx.|................|.xxxxxxxxx.xxxxxxxxxxxxxxxxxxxxx',
    'xxxxx..xxxxxxxxxxxx.......+................+...xxxxxxx.xxxxxxxxxxxxxxxxxxxxx',
    'xxxx..xxxxxxxxx.....xxxxx.|................|.x...xxxxx.xxxxxxxxxxxxxxxxxxxxx',
    'xxx..xxxxxxxxx..xxxxxxxxxx|................|xxxx.......xxxxxxxxxxxxxxxxxxxxx',
    'xxxx..xxxxxxx..xxxxxxxxxxx|----------------|xxxxxxxxxx...xxxxxxxxxxxxxxxxxxx',
    'xxxxxx..xxxx..xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...xxxxxxxxxxxxxxxxx',
    'xxxxxxx......xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...xxxxxxxxxxxxxxx',
    'xxxxxxxxx...xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...x......xxxxxx',
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.........xxxxx',
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.......xxxxxx',
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
].join('\n');

// C ref: nhlsel.c `selection.grow(selection.set(selection.new()), dir)` — a
// brand-new selection with one random point, cloned and grown one step.
function val_grown_pool(dir) {
    const sel = quest_sel_set_random(new Set());
    return quest_sel_grow(new Set(sel), dir);
}

// Main executor.  C ref: makemaz("Val-strt") -> load_special.
export async function makemaz_val_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    // des.level_flags("mazelevel","noteleport","hardfloor","icedpools").
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
        g.level.flags.icedpools = true;
    }
    // des.level_init({ style="solidfill", fg="I" }) — rn2(2) + fill ICE.
    quest_level_init_fill(ICE);

    const pools = new Set();
    for (let i = 0; i < 13; i++) quest_sel_set_random(pools);   // random locations
    for (const d of [W_WEST, W_NORTH, W_RANDOM])                // some bigger ones
        for (const k of val_grown_pool(d)) pools.add(k);
    // Lava pools surrounded by water: the grown copy becomes POOL first, then
    // the core is overwritten with LAVAPOOL.
    quest_sel_terrain(quest_sel_grow(new Set(pools), W_ANY), POOL);
    quest_sel_terrain(pools, LAVAPOOL);

    bigrm_load_map(VAL_STRT_MAP, false);   // des.map bare string -> lit=FALSE
    quest_region_light(0, 0, 75, 19, true);
    quest_register_branch(66, 17);
    quest_place_stair(18, 1, false);
    splev_feature(53, 2, FOUNTAIN);
    quest_set_door(26, 10, 'locked');
    quest_set_door(43, 10, 'locked');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        const norn = quest_create_monster('Norn', 35, 10, null);
        quest_drop_default_invent(norn);
        quest_create_object(125 /*BANDED_MAIL*/, null, null, 5, norn);
        quest_create_object(54 /*LONG_SWORD*/, null, null, 4, norn);
        quest_create_object(CHEST, 36, 10, null, null);
        const warriors = [[27, 8], [27, 9], [27, 11], [27, 12],
                          [42, 8], [42, 9], [42, 11], [42, 12]];
        for (const [wx, wy] of warriors) quest_create_monster('warrior', wx, wy, null);
        quest_non_diggable(26, 7, 43, 13);    // des.non_diggable — no RNG.
        // Six fire traps: a FIXED type at a RANDOM location, so each one costs
        // the get_location(DRY) loop plus mktrap's victim rnd(4) — and NO
        // traptype_rnd() rolls, unlike the bare des.trap() the other homes use.
        for (let i = 0; i < 6; i++) await quest_trap(FIRE_TRAP);
        const ants = [[4, 12], [8, 8], [14, 4], [17, 11], [24, 10],
                      [45, 10], [54, 2], [55, 7], [58, 14], [63, 17]];
        for (const [ax, ay] of ants) quest_create_monster('fire ant', ax, ay, null);
        quest_monster({ name: 'fire giant', mx: 18, my: 1, peaceful: 0 });
        quest_monster({ name: 'fire giant', mx: 10, my: 16, peaceful: 0 });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
