// levels/bar_loca.js - special level builder makemaz_bar_loca(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_bar_loca so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { enexto_spawn, makemon, mkclass, mm_mon_at } from '../makemon.js';
import { mkobj_at } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    bigrm_get_location_dry, bigrm_load_map, bigrm_wallification, flip_level, q_absx, q_absy,
    quest_create_monster, quest_create_monster_randpos, quest_create_trap,
    quest_create_trap_random, quest_level_init_solidfill, quest_place_stair, quest_region_light,
    quest_set_door, shuffle,
} from '../sp_lev.js';

// C ref: sp_lev.c create_object() with c==0 (no class given) at an EXPLICIT
// map-relative coord — mkobj_at(RANDOM_CLASS, x, y, !named); named is always
// false for these des.object({x=,y=}) calls (no "name" field).
function quest_create_object_random(mx, my) {
    const x = q_absx(mx), y = q_absy(my);
    mkobj_at(0 /* RANDOM_CLASS */, x, y, true);
}

// C ref: sp_lev.c create_monster — bare class char ("O"/"T"), NO explicit
// coord.  Order: induced_align (no gender roll — find_montype is only reached
// via an "id" field); mkclass(class, G_NOGEN) [mkclass_aligned RNG]; then
// get_location_coord(DRY); enexto if occupied; then makemon().
function quest_create_monster_class_randpos(classNum, peacefulOverride) {
    rn2(3);                                             // induced_align (dungeon.c:2012)
    const ptr = mkclass(classNum, 0x0200 /* G_NOGEN */);
    if (!ptr) return null;
    const c = bigrm_get_location_dry();
    let x = c.x, y = c.y;
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    const mtmp = makemon(ptr, x, y, 0);
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    return mtmp;
}

// ════════════════════════════════════════════════════════════════════════
// Barbarian quest "locate" level loader (dat/Bar-loca.lua) — a desert oasis.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Bar-loca")
// -> load_special("Bar-loca.lua").  Same splev engine as Bar-strt: loading
// nhlib.lua first runs shuffle(align) (rn2(3),rn2(2)); level_init solidfill
// draws one rn2(2); then the des.* program runs in file order consuming the
// PRNG exactly.  Unlike Bar-strt this level registers no branch levregion, so
// finalize is just wallification + a flip_level_rnd (no quest_flip_branch).
// The mineralize()/kelp pass (hundreds of rn2(10) draws over the huge pool
// field) is NOT invoked here — it runs generically after mklev() returns via
// fastforward_fill_mineralize(), exactly as for Bar-strt.
// ════════════════════════════════════════════════════════════════════════

const BAR_LOCA_MAP = [
    "..........PPP.........................................                      ",
    "...........PP..........................................        .......      ",
    "..........PP...........-----..........------------------     ..........     ",
    "...........PP..........+...|..........|....S...........|..  ............    ",
    "..........PPP..........|...|..........|-----...........|...  .............  ",
    "...........PPP.........-----..........+....+...........|...  .............  ",
    "..........PPPPPPPPP...................+....+...........S.................   ",
    "........PPPPPPPPPPPPP.........-----...|-----...........|................    ",
    "......PPPPPPPPPPPPPP..P.......+...|...|....S...........|          ...       ",
    ".....PPPPPPP......P..PPPP.....|...|...------------------..         ...      ",
    "....PPPPPPP.........PPPPPP....-----........................      ........   ",
    "...PPPPPPP..........PPPPPPP..................................   ..........  ",
    "....PPPPPPP........PPPPPPP....................................  ..........  ",
    ".....PPPPP........PPPPPPP.........-----........................   ........  ",
    "......PPP..PPPPPPPPPPPP...........+...|.........................    .....   ",
    "..........PPPPPPPPPPP.............|...|.........................     ....   ",
    "..........PPPPPPPPP...............-----.........................       .    ",
    "..............PPP.................................................          ",
    "...............PP....................................................       ",
    "................PPP...................................................      ",
].join('\n');

export async function makemaz_bar_loca() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_flags("mazelevel", "hardfloor") — no RNG.  (No "noteleport"
    // this time, unlike Bar-strt.)
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.hardfloor = true;
    }
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    const lit = quest_level_init_solidfill();
    // des.map([[...]]) — full-level map, SPLEV_CENTER offset.  No RNG.
    bigrm_load_map(BAR_LOCA_MAP, false);  // des.map bare string -> lit=FALSE
    // des.region(...) x7 — light/unlit rectangles.  No RNG.
    quest_region_light(0, 0, 75, 19, true);
    quest_region_light(24, 3, 26, 4, false);
    quest_region_light(31, 8, 33, 9, false);
    quest_region_light(35, 14, 37, 15, false);
    quest_region_light(39, 3, 54, 8, true);
    quest_region_light(56, 0, 75, 8, false);
    quest_region_light(64, 9, 75, 16, false);
    // des.door(...) x10 — explicit states, no RNG.
    quest_set_door(23, 3, 'open');
    quest_set_door(30, 8, 'open');
    quest_set_door(34, 14, 'open');
    quest_set_door(38, 5, 'locked');
    quest_set_door(38, 6, 'locked');
    quest_set_door(43, 3, 'closed');
    quest_set_door(43, 5, 'closed');
    quest_set_door(43, 6, 'closed');
    quest_set_door(43, 8, 'closed');
    quest_set_door(55, 6, 'locked');
    // des.stair("up",5,2) / des.stair("down",70,13) — no RNG.
    quest_place_stair(5, 2, true);
    quest_place_stair(70, 13, false);
    // des.object({x=,y=}) x15 — random object at an explicit coord.
    // des.monster(...)'s full (non-abbreviated) m_initweap/m_initinv path is
    // gated on game._quest_gen / game._full_mon_gen (makemon.js) — set for the
    // whole objects+traps+monsters block, exactly as makemaz_bar_strt() does.
    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        for (let i = 0; i < 3; i++) quest_create_object_random(42, 3);
        for (let i = 0; i < 4; i++) quest_create_object_random(41, 3);
        for (let i = 0; i < 2; i++) quest_create_object_random(41, 8);
        for (let i = 0; i < 3; i++) quest_create_object_random(42, 8);
        for (let i = 0; i < 3; i++) quest_create_object_random(71, 13);
        // des.trap("spiked pit", x, y) x4 — fixed type + coord.
        await quest_create_trap(12 /*SPIKED_PIT*/, 10, 13);
        await quest_create_trap(12 /*SPIKED_PIT*/, 21, 7);
        await quest_create_trap(12 /*SPIKED_PIT*/, 67, 8);
        await quest_create_trap(12 /*SPIKED_PIT*/, 68, 9);
        // des.trap() x4 — random type + random location.
        for (let i = 0; i < 4; i++) await quest_create_trap_random();
        // des.monster(...) — 14 explicit-coord ogres, guarding the oasis rooms.
        const ogreSpots = [
            [12, 9], [18, 11], [45, 5], [45, 6], [47, 5], [46, 5],
            [56, 3], [56, 4], [56, 5], [56, 6], [57, 3], [57, 4], [57, 5], [57, 6],
        ];
        for (const [mx, my] of ogreSpots) quest_create_monster('ogre', mx, my, false);
        // 3 more ogres + a random ogre-class + a random troll-class, all at a
        // random DRY spot.
        for (let i = 0; i < 3; i++) quest_create_monster_randpos('ogre', false);
        quest_create_monster_class_randpos(41 /* S_OGRE */, false);
        quest_create_monster_class_randpos(46 /* S_TROLL */, false);
        // 5 explicit-coord rock trolls.
        const trollSpots = [[46, 6], [47, 6], [56, 7], [57, 7], [70, 13]];
        for (const [mx, my] of trollSpots) quest_create_monster('rock troll', mx, my, false);
        // 2 more rock trolls + a random troll-class, all at a random DRY spot.
        for (let i = 0; i < 2; i++) quest_create_monster_randpos('rock troll', false);
        quest_create_monster_class_randpos(46 /* S_TROLL */, false);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> wallification(1,0,COLNO-1,ROWNO-1) then
    // flip_level_rnd(allow_flips=3, FALSE): one rn2(2) per enabled axis.  No
    // branch levregion is registered on this level, so (unlike Bar-strt)
    // there is nothing to flip alongside the map.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
