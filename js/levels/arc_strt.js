// levels/arc_strt.js - special level builder makemaz_arc_strt(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_arc_strt so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    ARC_S_MUMMY, ARC_S_SNAKE, bigrm_load_map, bigrm_wallification, flip_level,
    quest_create_monster, quest_create_monster_class, quest_create_object,
    quest_create_trap_random, quest_drop_default_invent, quest_flip_branch,
    quest_level_init_solidfill, quest_place_stair, quest_region_light, quest_register_branch,
    quest_set_door, shuffle,
} from '../sp_lev.js';

// ════════════════════════════════════════════════════════════════════════
// Archeologist quest "home" level loader (dat/Arc-strt.lua).
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Arc-strt")
// -> load_special("Arc-strt.lua").  Same splev engine as Bar-strt: loading
// nhlib.lua first runs shuffle(align) (rn2(3),rn2(2)); level_init solidfill
// draws one rn2(2); then the des.* program runs in file order consuming the
// PRNG exactly.  Hand-ported so the stream matches C's recorded trace.
//
// The fort is a moated keep; Lord Carnarvon + guards inside, siege monsters
// (random snakes/mummies via des.monster("S"/"M")) outside, six random traps,
// and a moat that gets kelp during mineralize() at level finalize.
// ════════════════════════════════════════════════════════════════════════

const ARC_STRT_MAP = [
    '............................................................................',
    '............................................................................',
    '............................................................................',
    '............................................................................',
    '....................}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}.................',
    '....................}-------------------------------------}.................',
    '....................}|..S......+.................+.......|}.................',
    '....................}-S---------------+----------|.......|}.................',
    '....................}|.|...............|.......+.|.......|}.................',
    '....................}|.|...............---------.---------}.................',
    '....................}|.S.\\.............+.................+..................',
    '....................}|.|...............---------.---------}.................',
    '....................}|.|...............|.......+.|.......|}.................',
    '....................}-S---------------+----------|.......|}.................',
    '....................}|..S......+.................+.......|}.................',
    '....................}-------------------------------------}.................',
    '....................}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}.................',
    '............................................................................',
    '............................................................................',
    '............................................................................',
].join('\n');

// Main executor.  C ref: makemaz("Arc-strt") -> load_special.
export async function makemaz_arc_strt() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_flags("mazelevel", "noteleport", "hardfloor") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    const lit = quest_level_init_solidfill();
    // des.map([[...]]) — full-level map, SPLEV_CENTER offset.  No RNG.
    bigrm_load_map(ARC_STRT_MAP, false);  // des.map bare string -> lit=FALSE
    // des.region(...) x16 — whole level lit, then lit/unlit sub-rooms.  No RNG.
    quest_region_light(0, 0, 75, 19, true);
    quest_region_light(22, 6, 23, 6, false);
    quest_region_light(25, 6, 30, 6, false);
    quest_region_light(32, 6, 48, 6, false);
    quest_region_light(50, 6, 56, 8, true);
    quest_region_light(40, 8, 46, 8, false);
    quest_region_light(22, 8, 22, 12, false);
    quest_region_light(24, 8, 38, 12, false);
    quest_region_light(48, 8, 48, 8, true);
    quest_region_light(40, 10, 56, 10, true);
    quest_region_light(48, 12, 48, 12, true);
    quest_region_light(40, 12, 46, 12, false);
    quest_region_light(50, 12, 56, 14, true);
    quest_region_light(22, 14, 23, 14, false);
    quest_region_light(25, 14, 30, 14, false);
    quest_region_light(32, 14, 48, 14, false);
    // des.stair("down", 55, 7) — no RNG.
    quest_place_stair(55, 7, false);
    // des.levregion({ region={63,6,63,6}, type="branch" }) — register, no RNG.
    quest_register_branch(63, 6);
    // des.door(...) x12 — explicit states, no RNG.
    quest_set_door(22, 7, 'closed'); quest_set_door(38, 7, 'closed');
    quest_set_door(47, 8, 'locked'); quest_set_door(23, 10, 'locked');
    quest_set_door(39, 10, 'locked'); quest_set_door(57, 10, 'locked');
    quest_set_door(47, 12, 'locked'); quest_set_door(22, 13, 'closed');
    quest_set_door(38, 13, 'closed'); quest_set_door(24, 14, 'locked');
    quest_set_door(31, 14, 'closed'); quest_set_door(49, 14, 'locked');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // Lord Carnarvon + custom inventory (fedora+5, bullwhip+4).
        const carnarvon = quest_create_monster('Lord Carnarvon', 25, 10, null);
        // custom inventory replaces makemon's default: mdrop_special_objs +
        // discard_minvent (one obj_resists rn2(100) for his defensive item).
        quest_drop_default_invent(carnarvon);
        quest_create_object(92 /*FEDORA*/, null, null, 5, carnarvon);
        quest_create_object(82 /*BULLWHIP*/, null, null, 4, carnarvon);
        // The treasure of Lord Carnarvon.
        quest_create_object(CHEST, 25, 10, null, null);
        // student guards for the audience chamber.
        const students = [[26, 9], [27, 9], [28, 9], [26, 10],
                          [28, 10], [26, 11], [27, 11], [28, 11]];
        for (const [sx, sy] of students) quest_create_monster('student', sx, sy, null);
        // city watch guards in the antechambers.
        quest_create_monster('watchman', 50, 6, null);
        quest_create_monster('watchman', 50, 14, null);
        // Eels in the moat.
        quest_create_monster('giant eel', 20, 10, null);
        quest_create_monster('giant eel', 45, 4, null);
        quest_create_monster('giant eel', 33, 16, null);
        // des.non_diggable — no RNG.
        // Six random traps.
        for (let i = 0; i < 6; i++) await quest_create_trap_random();
        // Monsters on siege duty (random snakes "S" / mummies "M").
        const siege = [
            [ARC_S_SNAKE, 60, 9], [ARC_S_MUMMY, 60, 10], [ARC_S_SNAKE, 60, 11],
            [ARC_S_SNAKE, 60, 12], [ARC_S_MUMMY, 60, 13], [ARC_S_SNAKE, 61, 10],
            [ARC_S_SNAKE, 61, 11], [ARC_S_SNAKE, 61, 12], [ARC_S_SNAKE, 30, 3],
            [ARC_S_MUMMY, 20, 17], [ARC_S_SNAKE, 67, 2], [ARC_S_SNAKE, 10, 19],
        ];
        for (const [cls, cx, cy] of siege) quest_create_monster_class(cls, cx, cy);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> wallification(1,0,COLNO-1,ROWNO-1) (!corrmaze)
    // then flip_level_rnd(allow_flips=3, FALSE): one rn2(2) per enabled axis.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); quest_flip_branch(flp); }
}
