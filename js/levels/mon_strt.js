// levels/mon_strt.js - special level builder makemaz_mon_strt() (dat/Mon-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { ALTAR, ROOM, TREE } from '../const.js';
import { game } from '../gstate.js';
import { rnd } from '../rng.js';
import { maketrap } from '../trap.js';
import {
    bigrm_load_map, lspo_region, q_absx, q_absy, quest_create_monster,
    quest_create_monster_at, quest_create_object, quest_drop_default_invent,
    quest_floodfill_match, quest_place_stair, quest_region_light,
    quest_register_branch, quest_replace_terrain, quest_rndcoord, quest_set_door,
    splev_object_at,
    reset_xystart_size,
} from '../sp_lev.js';
import {
    DART_TRAP, quest_align_shuffle, quest_finalize, quest_level_init_fill,
    quest_terrain_at, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Monk quest "home" level loader (dat/Mon-strt.lua) — the Grand Master's
// monastery, under siege by earth elementals and xorns.
//
// C ref: mklev.c makelevel() -> makemaz("Mon-strt") -> load_special.
// Mon-strt.lua and Pri-strt.lua share a map and a skeleton; the differences
// that matter to the stream are all here:
//   * the temple region carries NO `filled` key, and lspo_region defaults it to
//     0 (FILL_NONE), so fill_special_room() returns early and this level does
//     NOT get svl.level.flags.has_temple — no per-turn dosounds rn2(200);
//   * selection.floodfill(05,04) runs BEFORE des.terrain({05,04}, "."), so it
//     matches whatever replace_terrain left under the portal square (a tree at
//     10%), not the floor Pri-strt guarantees first;
//   * the leader has one inventory item, no treasure chest, and the siege is
//     8 earth elementals + 4 xorns instead of 12 human zombies.
// ════════════════════════════════════════════════════════════════════════

const MON_STRT_MAP = [
    '............................................................................',
    '............................................................................',
    '............................................................................',
    '....................------------------------------------....................',
    '....................|................|.....|.....|.....|....................',
    '....................|..------------..|--+-----+-----+--|....................',
    '....................|..|..........|..|.................|....................',
    '....................|..|..........|..|+---+---+-----+--|....................',
    '..................---..|..........|......|...|...|.....|....................',
    '..................+....|..........+......|...|...|.....|....................',
    '..................+....|..........+......|...|...|.....|....................',
    '..................---..|..........|......|...|...|.....|....................',
    '....................|..|..........|..|+-----+---+---+--|....................',
    '....................|..|..........|..|.................|....................',
    '....................|..------------..|--+-----+-----+--|....................',
    '....................|................|.....|.....|.....|....................',
    '....................------------------------------------....................',
    '............................................................................',
    '............................................................................',
    '............................................................................',
].join('\n');

// Main executor.  C ref: makemaz("Mon-strt") -> load_special.
export async function makemaz_mon_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    quest_level_init_fill(0 /* STONE */);
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    bigrm_load_map(MON_STRT_MAP, false);   // des.map bare string -> lit=FALSE
    quest_region_light(0, 0, 75, 19, true);
    lspo_region({ region: [24, 6, 33, 13], lit: 1, type: 'temple' });
    quest_replace_terrain(0, 0, 10, 19, ROOM, TREE, 10);
    quest_replace_terrain(65, 0, 75, 19, ROOM, TREE, 10);
    // local spacelocs = selection.floodfill(05,04) — no RNG, and it runs before
    // the portal square is forced back to floor.
    const spacelocs = quest_floodfill_match(5, 4);
    quest_terrain_at(5, 4, ROOM);
    quest_register_branch(5, 4);
    quest_place_stair(52, 9, false);
    quest_set_door(18, 9, 'locked'); quest_set_door(18, 10, 'locked');
    quest_set_door(34, 9, 'closed'); quest_set_door(34, 10, 'closed');
    quest_set_door(40, 5, 'closed'); quest_set_door(46, 5, 'closed');
    quest_set_door(52, 5, 'closed'); quest_set_door(38, 7, 'locked');
    quest_set_door(42, 7, 'closed'); quest_set_door(46, 7, 'closed');
    quest_set_door(52, 7, 'closed'); quest_set_door(38, 12, 'locked');
    quest_set_door(44, 12, 'closed'); quest_set_door(48, 12, 'closed');
    quest_set_door(52, 12, 'closed'); quest_set_door(40, 14, 'closed');
    quest_set_door(46, 14, 'closed'); quest_set_door(52, 14, 'closed');
    // Unattended altar: align="noalign" and type="altar" (shrine 0), so
    // create_altar() returns before priestini()/has_temple.  No RNG.
    { const loc = g.level?.at(q_absx(28), q_absy(9));
      if (loc) { loc.typ = ALTAR; loc.altarmask = 0 /* AM_NONE */; } }

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        const master = quest_create_monster('Grand Master', 28, 10, null);
        quest_drop_default_invent(master);
        quest_create_object(143 /*ROBE*/, null, null, 6, master);
        // No treasure chest!
        const abbots = [[32, 7], [32, 8], [32, 11], [32, 12],
                        [33, 7], [33, 8], [33, 11], [33, 12]];
        for (const [ax, ay] of abbots) quest_create_monster('abbot', ax, ay, null);
        // des.non_diggable — no RNG.
        for (let i = 0; i < 2; i++) {
            const c = quest_rndcoord(spacelocs);
            if (c) { await maketrap(c.x, c.y, DART_TRAP); rnd(4); }
        }
        for (let i = 0; i < 4; i++) await quest_trap();
        for (let i = 0; i < 8; i++) {
            const c = quest_rndcoord(spacelocs);
            if (c) quest_create_monster_at('earth elemental', c.x, c.y, null);
        }
        for (let i = 0; i < 4; i++) {
            const c = quest_rndcoord(spacelocs);
            if (c) quest_create_monster_at('xorn', c.x, c.y, null);
        }
        // C ref: sp_lev.c lspo_object:3676 — id="tin" with montype="spinach"
        // leaves corpsenm at NON_PM and sets spe = 1 (that IS a spinach tin).
        const tin = splev_object_at({ otyp: 296 /*TIN*/ }, 29, 9);
        if (tin) { tin.spe = 1; tin.quan = 2; }
        const rations = splev_object_at({ otyp: 293 /*FOOD_RATION*/ }, 46, 4);
        if (rations) rations.quan = 4;
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
