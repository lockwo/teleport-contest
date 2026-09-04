// levels/sam_loca.js — the Samurai quest "locate" level (dat/Sam-loca.lua), a
// symmetric fortress courtyard with four treasure alcoves and samurai guards.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Sam-loca")
// -> load_special("Sam-loca.lua").  Loading nhlib.lua first runs the
// top-level shuffle(align) (rn2(3), rn2(2)) — unused by this level, but the
// draws still happen; level_init solidfill draws one rn2(2); then the des.*
// program runs in file order.  No levregion is registered, so
// fixup_special() places nothing.

import { COLNO, ROWNO } from '../const.js';
import { ARMOR_CLASS, GEM_CLASS, TOOL_CLASS, WEAPON_CLASS, mkobj_at } from '../mkobj.js';
import { enexto_spawn, makemon, mkclass, mm_mon_at } from '../makemon.js';
import { S_DOG } from '../symbols.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, q_absx, q_absy,
    quest_create_monster, quest_place_stair, quest_region_light, quest_set_door,
    shuffle, vly_non_diggable,
} from '../sp_lev.js';
import { quest_monster } from './quest_home_common.js';
import { quest_monster_named_rnd, quest_trap_random } from './quest_common.js';

const SAM_LOCA_MAP = [
    '............................................................................',
    '............................................................................',
    '........-----..................................................-----........',
    '........|...|..................................................|...|........',
    '........|...---..}..--+------------------------------+--..}..---...|........',
    '........|-|...|.....|...|....|....|....|....|....|.|...|.....|...|-|........',
    '..........|...-------...|....|....|....|....|....S.|...-------...|..........',
    '..........|-|.........------+----+-+-------+-+--------.........|-|..........',
    '............|..--------.|}........................}|.--------..|............',
    '............|..+........+..........................+........+..|............',
    '............|..+........+..........................+........+..|............',
    '............|..--------.|}........................}|.--------..|............',
    '..........|-|.........--------+-+-------+-+----+------.........|-|..........',
    '..........|...-------...|.S....|....|....|....|....|...-------...|..........',
    '........|-|...|.....|...|.|....|....|....|....|....|...|.....|...|-|........',
    '........|...---..}..--+------------------------------+--..}..---...|........',
    '........|...|..................................................|...|........',
    '........-----..................................................-----........',
    '............................................................................',
    '............................................................................',
].join('\n');

// C ref: sp_lev.c create_object() for `des.object(class, x, y)` — an explicit
// class letter (GEM/ARMOR/WEAPON/TOOL) at an explicit coord.  No get_location
// RNG at all; mkobj_at()'s own weighted pick within the class still draws.
function loca_object_at(oclass, mx, my) {
    mkobj_at(oclass, q_absx(mx), q_absy(my), true);
}

// C ref: sp_lev.c create_monster() for the 3-arg des.monster(classChar, x, y)
// form (Sam-loca's lone "d", 59, 14) — a single-char string is ALWAYS a class
// letter, regardless of an explicit coordinate following it (sp_lev.c:3249
// `strlen(paramstr) == 1`), so find_montype's gender roll is skipped entirely.
function loca_monster_class_at(classNum, mx, my) {
    rn2(3);                                    // induced_align (dungeon.c:2012)
    const ptr = mkclass(classNum, 0x0200 /* G_NOGEN */);
    if (!ptr) return null;
    let x = q_absx(mx), y = q_absy(my);
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    return makemon(ptr, x, y, 0);
}

export async function makemaz_sam_loca() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style = "solidfill", fg = " " }) — rn2(2) + fill STONE.
    rn2(2);
    // des.level_flags("mazelevel", "hardfloor") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.hardfloor = true;
    }
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(SAM_LOCA_MAP, false);
    // des.region(selection.area(00,00,75,19), "lit") — no RNG.
    quest_region_light(0, 0, 75, 19, true);

    // des.door(...) x24 — explicit states, no RNG.
    quest_set_door(22, 4, 'locked'); quest_set_door(22, 15, 'locked');
    quest_set_door(53, 4, 'locked'); quest_set_door(53, 15, 'locked');
    quest_set_door(49, 6, 'locked'); quest_set_door(26, 13, 'locked');
    quest_set_door(28, 7, 'locked'); quest_set_door(30, 12, 'locked');
    quest_set_door(33, 7, 'locked'); quest_set_door(32, 12, 'locked');
    quest_set_door(35, 7, 'locked'); quest_set_door(40, 12, 'locked');
    quest_set_door(43, 7, 'locked'); quest_set_door(42, 12, 'locked');
    quest_set_door(45, 7, 'locked'); quest_set_door(47, 12, 'locked');
    quest_set_door(15, 9, 'closed'); quest_set_door(15, 10, 'closed');
    quest_set_door(24, 9, 'closed'); quest_set_door(24, 10, 'closed');
    quest_set_door(51, 9, 'closed'); quest_set_door(51, 10, 'closed');
    quest_set_door(60, 9, 'closed'); quest_set_door(60, 10, 'closed');

    // des.stair("up",10,10) / des.stair("down",25,14) — no RNG.
    quest_place_stair(10, 10, true);
    quest_place_stair(25, 14, false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.non_diggable(selection.area(00,00,75,19)) — no RNG.
        vly_non_diggable(0, 0, 75, 19);

        // des.object(class, x, y) x32 — 8 gems, 8 armor, 8 weapons, 8 tools,
        // each at its own fixed coord.  No get_location RNG; mkobj_at's own
        // weighted class pick still draws.
        for (const [ox, oy] of [[25, 5], [26, 5], [27, 5], [28, 5],
                                [25, 6], [26, 6], [27, 6], [28, 6]])
            loca_object_at(GEM_CLASS, ox, oy);
        for (const [ox, oy] of [[40, 5], [41, 5], [42, 5], [43, 5],
                                [40, 6], [41, 6], [42, 6], [43, 6]])
            loca_object_at(ARMOR_CLASS, ox, oy);
        for (const [ox, oy] of [[27, 13], [28, 13], [29, 13], [30, 13],
                                [27, 14], [28, 14], [29, 14], [30, 14]])
            loca_object_at(WEAPON_CLASS, ox, oy);
        for (const [ox, oy] of [[37, 13], [38, 13], [39, 13], [40, 13],
                                [37, 14], [38, 14], [39, 14], [40, 14]])
            loca_object_at(TOOL_CLASS, ox, oy);

        // des.trap() x6 — random type at a random DRY spot.  No "hardfloor"
        // shortcut is baked in here: quest_trap_random() reads the level's
        // real Can_fall_thru() state, and this level DOES set hardfloor.
        for (let i = 0; i < 6; i++) await quest_trap_random();

        // Random monsters — ninjas/wolves interleaved with explicit coords,
        // one class-letter dog, then 9 random-position stalkers.
        quest_monster({ name: 'ninja', mx: 15, my: 5, peaceful: 0 });
        quest_monster({ name: 'ninja', mx: 16, my: 5, peaceful: 0 });
        quest_create_monster('wolf', 17, 5, null);
        quest_create_monster('wolf', 18, 5, null);
        quest_monster({ name: 'ninja', mx: 19, my: 5, peaceful: 0 });
        quest_create_monster('wolf', 15, 14, null);
        quest_create_monster('wolf', 16, 14, null);
        quest_monster({ name: 'ninja', mx: 17, my: 14, peaceful: 0 });
        quest_monster({ name: 'ninja', mx: 18, my: 14, peaceful: 0 });
        quest_create_monster('wolf', 56, 5, null);
        quest_monster({ name: 'ninja', mx: 57, my: 5, peaceful: 0 });
        quest_create_monster('wolf', 58, 5, null);
        quest_create_monster('wolf', 59, 5, null);
        quest_monster({ name: 'ninja', mx: 56, my: 14, peaceful: 0 });
        quest_create_monster('wolf', 57, 14, null);
        quest_monster({ name: 'ninja', mx: 58, my: 14, peaceful: 0 });
        loca_monster_class_at(S_DOG, 59, 14);
        quest_create_monster('wolf', 60, 14, null);
        for (let i = 0; i < 9; i++) quest_monster_named_rnd('stalker', null);

        // "guards" for the central courtyard.
        quest_monster({ name: 'samurai', mx: 30, my: 5, peaceful: 0 });
        quest_monster({ name: 'samurai', mx: 31, my: 5, peaceful: 0 });
        quest_monster({ name: 'samurai', mx: 32, my: 5, peaceful: 0 });
        quest_monster({ name: 'samurai', mx: 32, my: 14, peaceful: 0 });
        quest_monster({ name: 'samurai', mx: 33, my: 14, peaceful: 0 });
        quest_monster({ name: 'samurai', mx: 34, my: 14, peaceful: 0 });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> wallification(1,0,COLNO-1,ROWNO-1) then
    // flip_level_rnd(allow_flips=3, FALSE) — no "noflip" here, so both bits
    // roll.  No levregion is registered on this level, so there is nothing
    // else to flip alongside the map.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
