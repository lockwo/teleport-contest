// levels/hea_filb.js - special level builder makemaz_hea_filb() (dat/Hea-filb.lua).

import { COLNO, POOL, ROOM, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import { bigrm_wallification, reset_xystart_size, vly_object } from '../sp_lev.js';
import { quest_align_shuffle, quest_monster } from './quest_home_common.js';
import { mkmap_mines, pri_create_trap } from './pri_loca.js';
import { hea_place_stair_rnd } from './hea_fila.js';

// ════════════════════════════════════════════════════════════════════════
// Healer quest "filler B" level (dat/Hea-filb.lua) — sibling of hea_fila.js:
// an unthemed joined mines cavern, same shape, more monsters/objects.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Hea-filb") ->
// load_special("Hea-filb.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3), rn2(2)) runs first, then the des.* program in file order.
// ════════════════════════════════════════════════════════════════════════

// C ref: monsym.h S_* class indices (def_char_to_monclass()).
const S_RODENT = 18, S_DRAGON = 30, S_SPIDER = 19;

export async function makemaz_hea_filb() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)

    // des.level_init({ style="solidfill", fg="P" }) — one rn2(2); the fill
    // itself is wholesale overwritten by the mines init below.
    rn2(2);                                              // sp_lev.c:2992

    // des.level_flags("mazelevel", "noflip") — no hardfloor; noflip means the
    // finalize tail draws no flip rn2(2)s.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noflip = true;
    }

    // des.level_init({ style="mines", fg=".", bg="P", smoothed=false,
    //                  joined=true, lit=1, walled=false })
    mkmap_mines(POOL, ROOM, false, true, 1, false);

    // des.stair("up"); des.stair("down") — both fully random.
    await hea_place_stair_rnd(true);
    await hea_place_stair_rnd(false);

    // 11 x des.object() — fully random class at a random DRY square.
    for (let i = 0; i < 11; i++) vly_object({});

    // 4 x des.trap() — fully random type and location.  hardfloor is NOT set
    // on this level, so pri_create_trap's Can_fall_thru() check leaves any
    // hole/trapdoor roll alone.
    for (let i = 0; i < 4; i++) await pri_create_trap(0, null, null);

    // Random monsters.
    for (let i = 0; i < 2; i++) quest_monster({ name: 'rabid rat' });
    for (let i = 0; i < 2; i++) quest_monster({ cls: S_RODENT, peaceful: 0 });
    for (let i = 0; i < 5; i++) quest_monster({ name: 'giant eel' });
    for (let i = 0; i < 2; i++) quest_monster({ name: 'electric eel' });
    for (let i = 0; i < 4; i++) quest_monster({ cls: S_DRAGON, peaceful: 0 });
    for (let i = 0; i < 3; i++) quest_monster({ cls: S_SPIDER, peaceful: 0 });

    // lspo_finalize_level: wallification only — noflip is set, so
    // flip_level_rnd() draws nothing.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
