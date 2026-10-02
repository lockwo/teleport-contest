// levels/hea_loca.js - special level builder makemaz_hea_loca() (dat/Hea-loca.lua).

import { AM_CHAOTIC, COLNO, POOL, ROOM, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, quest_place_stair,
    quest_set_door, reset_xystart_size, splev_region_lit, vly_altar,
    vly_non_diggable, vly_object, TEMPLE_RTYPE,
} from '../sp_lev.js';
import { quest_align_shuffle, quest_monster } from './quest_home_common.js';
import { mkmap_mines, pri_create_trap, pri_region_rect } from './pri_loca.js';

// ════════════════════════════════════════════════════════════════════════
// Healer quest "locate" level (dat/Hea-loca.lua) — a walled temple compound
// (Hippocrates' faith shrine) sitting on an island in a joined mines cavern.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Hea-loca") ->
// load_special("Hea-loca.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3), rn2(2)) runs first, then the des.* program in file order.
// ════════════════════════════════════════════════════════════════════════

// C ref: monsym.h S_* class indices (def_char_to_monclass()).
const S_RODENT = 18, S_EEL = 57, S_DRAGON = 30, S_SPIDER = 19;

const HEA_LOCA_MAP = [
    'PPPPPPPPPPPPP.......PPPPPPPPPPP',
    'PPPPPPPP...............PPPPPPPP',
    'PPPP.....-------------...PPPPPP',
    'PPPPP....|.S.........|....PPPPP',
    'PPP......+.|.........|...PPPPPP',
    'PPP......+.|.........|..PPPPPPP',
    'PPPP.....|.S.........|..PPPPPPP',
    'PPPPP....-------------....PPPPP',
    'PPPPPPPP...............PPPPPPPP',
    'PPPPPPPPPPP........PPPPPPPPPPPP',
].join('\n');

export async function makemaz_hea_loca() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)

    // des.level_init({ style="solidfill", fg=" " }) — one rn2(2); the fill
    // itself (STONE, column 0 only observable) is wholesale overwritten by
    // the mines init below (mkmap_init_map fills every x>=1 cell already).
    rn2(2);                                              // sp_lev.c:2992

    // des.level_flags("mazelevel", "hardfloor") — no "noflip" here (unlike
    // Pri-loca), so the finalize tail below draws the flip rn2(2)s.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.hardfloor = true;
    }

    // des.level_init({ style="mines", fg=".", bg="P", smoothed=true,
    //                  joined=true, lit=1, walled=false })
    mkmap_mines(POOL, ROOM, true, true, 1, false);

    // des.map([[...]]) — 31x10, SPLEV_CENTER.  Bare string => lit = FALSE.
    bigrm_load_map(HEA_LOCA_MAP, false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    if (g.level) g.level._splev_fullmon = true;
    try {
        // des.region(selection.area(0,0,30,9), "lit") — 2-arg form: no room,
        // no RNG.
        splev_region_lit(0, 0, 30, 9, 1);

        // des.region({region={12,03,20,06}, lit=1, type="temple", filled=1})
        // — non-irregular, so this is add_room+topologize, not flood_fill_rm.
        pri_region_rect(12, 3, 20, 6, 1, TEMPLE_RTYPE, 1 /* FILL_NORMAL */);

        // Doors — explicit states over map-drawn cells, no RNG.
        quest_set_door(9, 4, 'closed'); quest_set_door(9, 5, 'closed');
        quest_set_door(11, 3, 'locked'); quest_set_door(11, 6, 'locked');

        // Stairs.
        quest_place_stair(4, 4, true);
        quest_place_stair(20, 6, false);

        // des.non_diggable(selection.area(11,02,21,07)) — no RNG.
        vly_non_diggable(11, 2, 21, 7);

        // des.altar({x=13,y=05, align="chaos", type="shrine"}) — explicit
        // align, so sp_amask_to_amask takes the AM_MASK arm (no induced_align
        // rn2(3)); the square is inside the temple region and shrine is set,
        // so create_altar() reaches priestini() (its own cleric + inventory).
        // Hea-loca declares no separate des.monster roamer, unlike Pri-loca.
        vly_altar(13, 5, AM_CHAOTIC, 1);

        // 15 x des.object() — fully random class at a random DRY square.
        for (let i = 0; i < 15; i++) vly_object({});

        // 6 x des.trap() — fully random type and location.  hardfloor is set,
        // so pri_create_trap's Can_fall_thru() check rewrites any
        // hole/trapdoor roll into a falling-rock trap.
        for (let i = 0; i < 6; i++) await pri_create_trap(0, null, null);

        // Random monsters.
        for (let i = 0; i < 8; i++) quest_monster({ name: 'rabid rat' });
        quest_monster({ cls: S_RODENT, peaceful: 0 });
        for (let i = 0; i < 5; i++) quest_monster({ name: 'giant eel' });
        for (let i = 0; i < 2; i++) quest_monster({ name: 'electric eel' });
        quest_monster({ name: 'kraken' });
        for (let i = 0; i < 2; i++) quest_monster({ name: 'shark' });
        for (let i = 0; i < 2; i++) quest_monster({ cls: S_EEL, peaceful: 0 });
        for (let i = 0; i < 5; i++) quest_monster({ cls: S_DRAGON, peaceful: 0 });
        for (let i = 0; i < 9; i++) quest_monster({ cls: S_SPIDER, peaceful: 0 });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: wallification, then flip_level_rnd(3, FALSE) —
    // one rn2(2) per axis (no "noflip" on this level, unlike Pri-loca).
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                                 // sp_lev.c:975
    if (rn2(2)) flp |= 2;                                 // sp_lev.c:977
    if (flp) flip_level(flp);
}
